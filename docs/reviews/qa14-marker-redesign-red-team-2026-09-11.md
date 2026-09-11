# Red Team (Sutekh) — `fix/qa14-marker-redesign`, round 1

**Date:** 2026-09-11
**Scope:** branch `fix/qa14-marker-redesign` (`f1f6fd8`, `64a18ed`) vs `master` (`c598312`) — `src/qa/reference-resolver.ts` bare-`#N` citation classification redesign.
**Tier:** CRITICAL (ratified, `docs/.maat-state.json`).
**Verdict: no-go** — one `[HIGH][demonstrated]` gate-weakening regression. Everything else on the brief survived, including every number the build claimed on the diff-scope range.

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]

**ADR pass (attack-surface slice: CI-gate/quality/evidence tags).** ADR-0008 (devops, *CI/CD gates and policy-as-code*) and ADR-0010 (SE, *code quality gates*) are the only catalog entries whose rules touch a CI gate's blocking surface. The plan declared **all 35 NOT-APPLICABLE**. That is contestable for one rule — see finding 5; raised as a SUSPICION, not a blocker.

---

## Method — what I actually ran

All measurements come from the **shipped classifier itself**, not a re-derived copy of its regexes. Both versions of `src/qa/reference-resolver.ts` (at `c598312` and at `64a18ed`) were extracted with `git show` into a scratchpad, their two `../lib/*.ts` imports rewritten to absolute paths, and imported side by side. Where per-match visibility was needed, a copy of the HEAD version carrying **exactly one added line** (a log push) was used, proven by diff:

```
$ diff scratchpad/new.ts scratchpad/new-instr.ts
289a290
>     (globalThis as any).__CONT_LOG?.push({ raw: ..., ctx: JSON.stringify(...) });
```

Issue existence was resolved once, per distinct number, against the real `gh issue view --repo mohannadrabie/thoth --json state` (124 distinct numbers, one call each, cached) and the **same cache fed both versions**, so before/after is apples-to-apples rather than two nondeterministic live runs.

Baseline gates, run by me on a clean tree at `64a18ed`:

```
$ npm run typecheck   -> tsc --noEmit, clean (exit 0)
$ npm run lint        -> eslint ., clean (exit 0)
$ npm test            -> tests 708 | pass 708 | fail 0 | cancelled 0 | skipped 0 | todo 0
```

The build's `708/708, 0 fail, 0 skipped` claim reproduces exactly.

---

## Findings, ranked by blast radius

### 1. [ISSUE][HIGH][demonstrated] — an unmarked bare `#N` permanently shadows a later **marked** citation of the same number in the same file; the gate flips FAIL -> PASS

**Attack.** The redesign's whole promise is: *marked => goes through real classification against `issueExists`; unmarked => loud, non-blocking `unclassified`*. `scanReferences`'s dedup (`record`'s `seen` set, `src/qa/reference-resolver.ts:303-308`) is keyed on the **raw string alone** — and `#9999` is the same raw whether it was recorded as an `unclassified` candidate or as a real citation. Before this branch, the first (unmarked) occurrence was itself recorded as a real citation and verified, so the number got checked either way. Now the unmarked occurrence lands in the non-blocking bucket, takes the key, and **every later marked occurrence of that number in the same file is silently swallowed.**

**Scenario.** A review report or CHANGELOG entry mentions a number bare in passing — a table row, a quoted log line, an upstream tracker's number — and later in the same file writes `Closes #N` / `Fixes #N` with a number that does not exist here (a typo, or another repo's number). QA-14 used to fail the run. It now passes it.

```
in : "The table's row #9999 was cosmetic.\n\nCloses #9999."
OLD (c598312): ok=false :: #9999=unresolved-authority
NEW (64a18ed): ok=true  :: #9999=unclassified

in : "The upstream tracker's #2604 entry is unrelated.\n\nFixes #2604."
OLD: ok=false :: #2604=unresolved-authority
NEW: ok=true  :: #2604=unclassified
```

Order-dependent, which confirms the root cause is the dedup key and not the marker logic:

```
in : "Closes #9999.\n\nThe table's row #9999 was cosmetic."   (marked FIRST)
OLD: ok=false    NEW: ok=false     <- still blocks, correctly
```

**Exposure: ~17.4% of marked citations (61 of 351 distinct `(file, #N)` pairs that have at least one marked occurrence), basis: measured** — the shipped classifier run over all 213 scanned tracked files at `64a18ed`, logging every bare-hash match's classification, then flagging every raw whose first occurrence in a file was `unmarked` and which has a later `marked` occurrence:

```
classification counts, full tree: {"already-recorded":1971,"marked":550,"unmarked":1451}
E-class SHADOWED distinct (file,#N) pairs: 61
distinct (file,#N) pairs with >=1 MARKED occurrence: 351
=> 17.4% of distinct marked citations in this repo are never verified
   (files hit include CHANGELOG.md, docs/STATE.md, docs/decisions.md, docs/REVIEW_LOG.md,
    docs/decisions-archive.md, docs/qa/secret-scan-allowlist.json, docs/reviews/*.md)
```

No live gate miss exists **today** — all 61 happen to be real, existing issues — but the mechanism is armed, the failure is silent, and it hits the single class of defect QA-14 exists to catch (a citation to a nonexistent authority).

**Current defense, honestly assessed.** None. The plan's section 5.2 specifies `"marked" -> record(raw, () => classifyIssue(raw, deps))` and says "unchanged downstream"; the implementation cannot honor that once the key is taken. No test covers a number appearing twice in one text with different marker status. The build's own before/after set-diff could not see it either: shadowing moves a verdict **blocking -> non-blocking**, so it shows up as a *removed* failure, and the verification only asked whether any failure was *added*.

**Verdict: BREAKS.**

**Named proof-test required before merge** (`src/qa/reference-resolver.test.ts`):
`"QA-14 (marker redesign): an unmarked bare #N earlier in a file must NOT prevent a later 'Closes #N' from being verified — the run still FAILS for a nonexistent issue"` — input `"The table's row #9999 was cosmetic.\n\nCloses #9999."` with `issueExists: () => false`; assert a citation with `kind: "issue"` / `verdict: "unresolved-authority"` exists and `summarizeCitations(...).ok === false`. Plus the symmetric case asserting the marked occurrence resolves when the issue does exist. Fix shape (implementer's call): key the dedup set on kind-plus-raw, or upgrade an already-recorded `issue-candidate` in place when a marked occurrence of the same raw is later found.

---

### 2. [ISSUE][MED][demonstrated] — list continuation never starts after the **singular** `Issue #N` marker; `Issue #A/#B` silently leaves `#B` unverified while `Issues #A/#B` verifies both

**Attack.** `classifyBareHashMatch` (`src/qa/reference-resolver.ts:277-295`) returns `"already-recorded"` at branch (a) **without seeding `state.lastMarkedListEnd`**. `ISSUE_WORD_CANDIDATE_RE` (`/\bIssue\s*#\d+/gi`) matches only the singular form, so `Issue #114` takes branch (a) and the list never opens; `Issues #114` misses branch (a) (the `s` blocks it), takes the marker branch, and the list opens normally.

```
in : "Issues #7, #8 are both fixed."     NEW: #7=resolved | #8=resolved
in : "Issue  #7, #8 are both fixed."     NEW: Issue#7=resolved | #8=unclassified
in : "Issue  #7, #8 are both fixed."     OLD: Issue#7=resolved | #8=resolved
in : "Issue  #7-#8 both fixed."          NEW: Issue#7=resolved | #8=unclassified
```

Same gate-weakening direction as finding 1:

```
in : "Issue #7/#9999 both closed."   OLD: ok=false (#9999=unresolved-authority)   NEW: ok=true (#9999=unclassified)
in : "Issue #7, #9999 both closed."  OLD: ok=false                                NEW: ok=true
```

**Exposure: 26 occurrences / 24 distinct `(file, #N)` pairs, basis: measured** — every one is a genuine citation list in this repo's own prose: `Issue #105/#119`, `Issue #125/#127/#128`, `Issue #113/#130`, `Issue #129/#135`, `Issue #70-#74`, `Issue #61/#62`, `Issue #114/#115`, `Issue #96/#97`, `Issue #27/#120`, `Issue #137/#120`, `Issue #62/#63`, `Issue #75/#78`, `Issue #18 and #57` (files: `docs/.maat-state.json`, `docs/REVIEW_LOG.md`, `docs/backlog.md`, `docs/qa/secret-scan-allowlist.json`, six `docs/reviews/*.md`). All 24 are real citations that master verified and this branch does not.

**Current defense, honestly assessed.** None, and this one is not a ruled design choice: the plan's AC6 non-regression list names `Closes #7, #8` and the *new* plural `Issues #138, #139, #140` test, but never the singular `Issue #A/#B` shape, so the asymmetry was never seen. Nothing in `docs/decisions.md` row 61 rules that `Issues` and `Issue` should behave differently.

**Verdict: BREAKS** (MED — narrower than finding 1, and no silent *resolved*, only lost verification).

**Named proof-test:** `"QA-14 (marker redesign): a singular 'Issue #A/#B' list verifies BOTH members, identically to the plural 'Issues #A/#B' form"` — assert `Issue #7/#9999` with `issueExists: (n) => n === 7` yields a blocking verdict for `#9999` and `summarizeCitations(...).ok === false`.

---

### 3. [ISSUE][MED][demonstrated] — R4's and R5's "never" claims in CHANGELOG.md / docs/decisions.md / the plan are falsified by the list-continuation path

**Attack.** The close-out prose states as fact:

- R4 — "*every* ordinal/count-word-adjacent bare `#N` shape ... and **any future unlisted ordinal word** — classifies `unclassified`, **never** `resolved`. Achieved **structurally**";
- R5 — "an all-digit hex literal ... classifies `unclassified`, **never** `unresolved-authority`".

Both are hand-derived absolutes, and both are false, because branch (c) (continuation) fires *after* the marker check and hands marked status to whatever number follows a marked one separated only by the continuation class (space, tab, comma, slash, ampersand, hyphen, en-dash, em-dash) or the word "and":

```
in : "Closes #7 - #3 of the findings remain open."   NEW: #7=resolved | #3=resolved      <- R4 violated, silently
in : "Fixes  #7 - #4 in the table is unrelated."     NEW: #7=resolved | #4=resolved      <- R4 violated, silently
in : "Closes #7 and #4 of five tasks."               NEW: #7=resolved | #4=resolved      <- R4 violated, silently
in : "Closes #7, #000 is the palette token."         NEW: #7=resolved | #000=unresolved-authority, ok=false   <- R5 violated, blocking
in : "Fixed #3 of the 5 open findings."              NEW: #3=resolved                    <- marker word + ordinal collision
```

The first case was checked against master too: master also resolves `#3` there, so this is not a regression — it is a residual channel in a mechanism whose documentation claims the channel was closed structurally.

The R4 test (`src/qa/reference-resolver.test.ts:558-583`) is itself strong (`issueCitations.length === 0`), but every one of its 15 cases is an ordinal **in isolation**; no case places an ordinal inside a marked list, which is the only shape that breaks the claim.

**Exposure: 0 of 316 continuation-marked matches in this repo today, basis: measured** — every continuation-marked number full-tree was mechanically adjudicated against the real `gh` existence cache, and all 316 are genuine, existing issues. So this is a **claim-accuracy defect first** (CLAUDE.md hard rule: no hand-derived completeness claims; "every ... never ... achieved structurally" is exactly that) and a latent precision defect second.

**Current defense, honestly assessed.** The ordinal shape is only ever evaluated *after* the marker/continuation check, so an ordinal inside a marked list can never be seen as an ordinal. There is no defense; there is a claim that there is one.

**Verdict: BREAKS** on the claim; UNPROVEN as a live defect (measured incidence zero).

**Named proof-test:** `"QA-14 (marker redesign, R4/R5 boundary): list continuation must not carry marked status onto a non-citation"` — either assert the documented behavior (both `unclassified`) after tightening continuation, or, if the residual is accepted, the prose must be corrected to state the exception and the test must pin the accepted behavior explicitly. Either way the unqualified "never"/"structurally" wording cannot stand as written.

---

### 4. [ISSUE][LOW][demonstrated] — the full-tree control figures in CHANGELOG.md / docs/decisions.md do not reproduce at HEAD

Claimed: full-tree blocking **284 -> 270** (down 14), **507** newly unclassified. My independent re-run of the same mechanical comparison at `64a18ed`:

```
=== full: files=213
OLD blocking=292 total=3224   NEW blocking=271 total=3293 unclassified=514
```

That is **292 -> 271** (down 21), **514** unclassified. The diff-scope figures, by contrast, reproduce **exactly**:

```
=== diff: files=6
OLD blocking=34 total=516     NEW blocking=23 total=527 unclassified=93    (claimed 34 -> 23)
```

Most likely cause is benign HEAD drift: the full-tree numbers were taken at `f1f6fd8`, before the close-out commit added this very changelog text to the tree. The entry discloses the self-referential shape for the *diff* range but presents the full-tree figures unqualified. LOW, and editorial in character, but the numbers are published as measurements of "this PR".

---

### 5. [SUSPICION][MED][derived] — the plan's blanket "NOT-APPLICABLE, all 35" over-reads ADR-0008's ratchet rule

ADR-0008 (`adr/devops/0008-cicd-gates-and-policy-as-code.md`, Accepted, `applicableTo: cdk, pipeline, quality, security, supply-chain`) carries this rule verbatim:

```
MUST NOT lower gate thresholds, delete tests, or broaden suppression/ignore lists (ratchet only).
```

This change moves 424 full-tree citations out of `resolved` into a new non-blocking bucket and takes the QA-14 gate's blocking count from 34 to 23 on its own diff. The plan's section 1 dismisses ADR-0008 on the grounds that it governs "whether a PR may merge with a gate open/failing, not how an instrument computes pass/fail" — a defensible reading, but the ratchet rule is worded about gate strength, not merge mechanics, and `docs/decisions.md` row 61's non-blocking ruling is a Manager ruling, which does not outrank an accepted ADR (PRINCIPLES rule 9).

**Evidence tier is `derived`** — I read the ADR's rule text and the plan, not a failing artifact. It therefore **cannot gate**, and I am not claiming it does. It needs one ruling, not a fix: either the Manager / `architecture-reviewer` records why the ratchet rule does not reach an in-house QA instrument's own classification semantics, or `/maat:adr-amend` is the right route. `cross-domain-reviewer` reads the whole catalog and is the natural owner.

---

## What survived

| # | Attack | Result |
|---|---|---|
| S1 | **`unclassified` never gates `ok`.** Code-traced `src/qa/reference-resolver.ts:392` (`bad` filters out both `resolved` and `unclassified`), plus run: only-unclassified gives `ok:true`, both counts in `summary`, every line present in `details`; mixed bad+unclassified gives `ok:false` with "1 of 2 ... ; 1 more unclassified" and BOTH lines in `details` on the FAIL run. | **SURVIVES** |
| S2 | **R3 routing holds in shipped code.** `"See claude-mem#2604 ..."` with a THROWING `issueExists` stub gives `#2604 = unclassified (issue-candidate)`, `ok=true`, stub never invoked. Never `cross-repo-issue`, never `gh`. Master gives `unresolved-authority`, `ok=false`. | **SURVIVES** |
| S3 | **"Zero new blocking failures" is real, not eyeballed.** Mechanical set-diff of blocking detail keys, both ranges: new-only keys `[]` in both; after is a strict subset of before (diff-scope 19 of 23 distinct, full-tree 190 of 194). The 4 removed keys are exactly `#2604`, `#000`, `#333`, `#999999`, in BOTH ranges — matching the claim. The per-file verdict-transition table shows ZERO transitions into `resolved` anywhere: no new false-positive `resolved` class materialized on the real corpus. | **SURVIVES** |
| S4 | **Scope boundary intact**, verified mechanically (md5 over extracted function bodies, not eyeballing): `classifyAdr`, `classifyMilestone`, `classifyIssue`, `verifyLocalIssue`, `resolveWithinRepo`, `classifyPath`, `checkIssueViaGh`, `parseMaxDistinctIssues`, `resolveIssueCitations`, `shouldScanFile`, `main` all byte-identical; `ADR_CANDIDATE_RE`, `ISSUE_CANDIDATE_RE`, `ISSUE_WORD_CANDIDATE_RE`, `MILESTONE_CANDIDATE_RE`, `BACKTICK_PATH_RE` all byte-identical. R1/R2 untouched, as ruled. | **SURVIVES** |
| S5 | **The 4 test amendments are one principle applied 4x, not a smuggled design call.** All four are the section-5.1-ruled "bare unmarked #N: resolved to unclassified" shape: parenthetical `(#120)`; line-start `#120`; the Issue #141 cross-file-dedup test, whose FIXTURE TEXT was changed so it keeps testing dedup rather than its assertion being weakened; the NEW-4 milestone-line-boundary case. Each carries a dated comment naming the plan's section 5.1. Nothing else was relaxed; the dogfood test still asserts "verdict is not resolved" gives an empty set, i.e. it is STRICTER under the new verdict, not weaker. | **SURVIVES** |
| S6 | **Continuation cannot cross a line break.** The newline character is absent from `LIST_CONTINUATION_RE`'s class — a marked citation at end of line never marks a number on the next line. Confirmed by construction and by zero cross-line continuations in 316 corpus hits. | **SURVIVES** |
| S7 | **`GH_MARKER_RE` does not false-positive on prose.** `\bGH-?$` requires "gh"/"gh-" at a word start, so "through"/"high"/"enough" cannot match; `"run gh #7 to view it."` gives `unclassified`, correctly. `GH#7`/`GH-#8` both resolve. | **SURVIVES** |
| S8 | **Baseline gates.** `typecheck` clean, `lint` clean, `npm test` 708 pass / 0 fail / **0 skipped** — the claimed counts, reproduced. | **SURVIVES** |

---

## Editorial (verdict-neutral, fix as plain edits, no re-review)

- `CHANGELOG.md`'s full-tree line presents 284 to 270 / 507 without the self-referential-drift qualifier it correctly attaches to the diff-scope line (finding 4).
- `docs/STATE.md` is not touched by either commit, though this project's Definition of Done lists "CHANGELOG entry + `docs/STATE.md` updated". That is `/maat:verify`'s call, not mine.
- An untracked junk file whose NAME is a mangled Windows path (`C:UsersmohanAppData...scratchpadfulltest1.log`) sits in the repo root from an earlier session's unquoted redirect. Not from this branch; delete it before merge so the tree is clean.
- Environment anomaly worth one line for the next session: mid-review, the working-tree copy of `src/qa/reference-resolver.ts` was observed reverted to its `c598312` content AND staged, with no command of mine doing so. Restored via `git restore --source=HEAD --staged --worktree` and md5-verified against `HEAD` before and after every measurement above; all reported numbers were taken with the file verified byte-identical to `64a18ed`. Flagged because a silent working-tree revert during a review is exactly the thing that makes evidence untrustworthy if it recurs unnoticed.

---

## Open findings and failing tests

4 open findings (3 that gate or nearly gate, 1 LOW) and 1 suspicion. Executable forms:

| Finding | Named failing test |
|---|---|
| 1 (HIGH) | `QA-14 (marker redesign): an unmarked bare #N earlier in a file must NOT prevent a later 'Closes #N' from being verified` |
| 2 (MED) | `QA-14 (marker redesign): a singular 'Issue #A/#B' list verifies BOTH members, identically to the plural form` |
| 3 (MED) | `QA-14 (marker redesign, R4/R5 boundary): list continuation must not carry marked status onto a non-citation` |
| 4 (LOW) | No executable form — a prose-accuracy correction to two close-out entries. Resolves as an edit, or as a re-measurement recorded at the merge commit. |
| 5 (SUSPICION) | No executable form — needs a Manager/`architecture-reviewer` ruling or an `/maat:adr-amend`, not a test. |

---

## The single scariest unproven assumption

**That "no new blocking failures" is the safety property that matters.** It is the property the build measured, and it holds — I reproduced it mechanically in both ranges. But every defect found above moves in the OTHER direction: blocking to non-blocking, verified to unverified. That direction is invisible to an "added failures" set-diff, is silent by construction (an unverified citation and a deliberately-unclassified one print identically), and today already covers 17.4% of this repo's marked citations. A gate that has stopped checking is indistinguishable from a gate that checked and passed, right up until the citation that mattered was wrong.

**Go/no-go: no-go.**

**Single next action:** add finding 1's proof test (an unmarked bare `#N` earlier in a file must not prevent a later `Closes #N` from being verified), watch it go red against `64a18ed`, then fix the dedup key — findings 2 and 3 fold into the same fix-now round.

---

```
RECEIPT: verdict=no-go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] Unmarked bare #N takes the per-file dedup key and permanently shadows a later MARKED "Closes/Fixes #N" — gate flips FAIL->PASS vs master on identical input; 61/351 (17.4%) of distinct marked citations in-tree are currently unverified; no defense, no test, and invisible to the build's added-failures set-diff.
2. [ISSUE][MED][demonstrated] The "already-recorded" branch returns without seeding lastMarkedListEnd, so singular "Issue #A/#B" never opens a list while plural "Issues #A/#B" does — 24 distinct real in-tree citations silently lose verification; "Issue #7/#9999" flips ok=false to ok=true.
3. [ISSUE][MED][demonstrated] R4's "every ordinal ... never resolved, achieved structurally" and R5's "never unresolved-authority" are falsified by the continuation path ("Closes #7 - #3 of the findings" gives #3=resolved; "Closes #7, #000" gives a blocking verdict) — a hand-derived completeness claim in CHANGELOG/decisions.md/plan; measured corpus incidence 0/316, so claim-accuracy first, latent defect second.
4. [ISSUE][LOW][demonstrated] Full-tree control figures do not reproduce at HEAD: claimed 284->270 / 507 unclassified, measured 292->271 / 514 (diff-scope 34->23 reproduces exactly) — likely benign HEAD drift, but published unqualified.
5. [SUSPICION][MED][derived] The plan's blanket "NOT-APPLICABLE, all 35" over-reads ADR-0008's "MUST NOT lower gate thresholds ... (ratchet only)"; a Manager ruling does not outrank an accepted ADR (PRINCIPLES rule 9) — needs one ruling or an adr-amend; derived evidence, cannot gate.
6. [CLEAN][demonstrated] "unclassified" never flips summarizeCitations' ok — code-traced line 392 and run both ways (only-unclassified ok:true; mixed bad+unclassified ok:false with both lines in details).
7. [CLEAN][demonstrated] R3 routing holds in shipped code: claude-mem#2604 goes to unclassified, never cross-repo-issue, and a throwing issueExists stub is never invoked.
8. [CLEAN][demonstrated] "Zero new blocking failures" independently reproduced by mechanical set-diff in BOTH ranges (new-only keys empty, after a strict subset of before, same 4 removed keys #2604/#000/#333/#999999); zero transitions into "resolved" anywhere on the real corpus.
9. [CLEAN][demonstrated] Scope boundary intact — 11 out-of-scope functions and 5 regexes byte-identical by md5 over extracted bodies; R1 / classifyPath / ADR_CANDIDATE_RE untouched.
10. [CLEAN][code-traced] The 4 amended tests are the plan's own ruled section-5.1 principle applied consistently (2 named + 2 of identical shape), each dated-commented; the dogfood test is stricter, not weaker.
11. [CLEAN][demonstrated] LIST_CONTINUATION_RE cannot cross a newline (newline absent from its class) — 0 cross-line continuations in 316 corpus hits.
12. [CLEAN][demonstrated] GH_MARKER_RE does not false-positive on prose ("run gh #7" gives unclassified; through/high/enough cannot match the word-start anchor).
13. [CLEAN][demonstrated] Baseline gates: typecheck clean, lint clean, npm test 708 pass / 0 fail / 0 skipped — the build's claimed counts reproduced.
counts (CHECKSUM): issues=4 suspicions=1 clean=8
evidence (CHECKSUM): demonstrated=11 code-traced=1 derived=1
checks=npm test 708 pass / 0 fail / 0 skipped; npm run typecheck exit 0; npm run lint exit 0; 6 custom probes driving the SHIPPED classifier over 213 tracked files, plus 124 real `gh issue view` lookups shared by both versions
adr=HIT(35)
report=docs/reviews/qa14-marker-redesign-red-team-2026-09-11.md
```
