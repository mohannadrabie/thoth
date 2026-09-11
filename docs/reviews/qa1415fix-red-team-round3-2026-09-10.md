# Red Team (Sutekh) — `qa1415fix` ROUND 3 re-confirm
**Date:** 2026-09-10
**Scope:** branch `fix/qa1415-issue-existence-and-decisions-scope`, HEAD `7cd9a16` (round-3 fix-now over `bc2b984`)
**Tier:** CRITICAL (ratified 2026-09-10, `docs/.maat-state.json`)
**Verdict: `go`** — no HIGH. Three MED + two LOW findings, all demonstrated, none blocking. **Recommendation attached: stop patching this class.**

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]
ADR rules read for this attack surface (QA instrument correctness / evidence trail / silent-skip doctrine): the QA-16 "never silently skip a citation" doctrine this file's own header names, and ADR-0021's structural-gate rules. No ADR rule is violated by this diff.

---

## What I ran (raw)

```
$ npm test
tests 700 / pass 700 / fail 0 / cancelled 0 / skipped 0 / todo 0 / duration_ms 24602.3399

$ npm run typecheck      -> clean (no output)
$ npm run lint           -> clean (no output)

$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.   exit=0

$ node src/qa/reference-resolver.ts bc2b984 7cd9a16
[QA-14 reference-resolver] FAIL: 31 of 563 citation(s) failed to resolve.   exit=1
  ... includes:
  - [unresolved-authority] #000 — Issue #0 does not exist in this repository
  - [unresolved-authority] #333 — Issue #333 does not exist in this repository

$ node src/qa/reference-resolver.ts 3b8d3eb 6f61d44      # master-only range, control
[QA-14 reference-resolver] FAIL: 8 of 367 citation(s) failed to resolve.
```

My own re-measurement instruments (scratchpad, not committed — reproducible from the descriptions below):

* `probe2.ts` — for every tracked md/ts/mjs/js/json/yml file passing `shouldScanFile`, enumerate every bare-hash-number occurrence and feed the **real, shipped** `scanReferences` the line truncated at that occurrence (faithful: every round-3 guard is same-line only, so per-line evaluation reproduces the shipped decision exactly, including `lastOrdinalListEnd` state).

```
PER_OCCURRENCE recorded=3445 excluded=202      (205 files)
```

* `cases.ts` — 22 adversarial strings through the shipped `scanReferences` + 10 inputs through the shipped `parseMaxDistinctIssues`.

---

## Findings, ranked by blast radius (exposure x irreversibility x silence)

### 1. [ISSUE][MED][demonstrated] The round-3 list-continuation guard silently DROPS real issue citations — a new, silent false negative this round introduced

**Attack.** The fix for "Findings #3, #4, #6" inherits the ordinal exclusion across any separator made only of space/tab/comma/slash, "and", or "&". Prose that names findings by their *issue number* — which is exactly how this repo's reviewers write — collides with that rule head-on.

**Scenario (real, in-tree, not synthetic).** `docs/reviews/s6-policy-centralization-cross-domain-round2-2026-09-08.md:19` reads "surfacing two new non-gating MED findings #118/#119, both fixed same-turn". #118 and #119 are **real GitHub Issues** (`gh issue view 118/119` -> both exist, CLOSED). At HEAD both are invisible to QA-14:

```
LINE FRAGMENT: surfacing two new non-gating MED findings #118/#119, both fixed same-t
citations: (NONE)
```

Synthetic minimal cases through the shipped scanner:

```
A3 ordinal then real       "Finding #3, #143 filed on GitHub."   => (none)
A4 ordinal slash then real "Findings #1/#2 and #144 filed."      => (none)
```

**Measured exposure (full-tree, all 205 scanned files):** 202 bare-hash-number occurrences are excluded; 23 of them are excluded by the continuation rule rather than by a directly-adjacent word; **5 excluded occurrences carry an issue-number-sized value (>= 20), and all 5 are real, existing GitHub Issues** (#114, #115, #118, #119 — two verified live via `gh`):

```
docs/reviews/s6-policy-centralization-cross-domain-round2-2026-09-08.md:19   #118 / #119
docs/reviews/s6-policy-centralization-design-challenger-council-stopbrief-2026-09-08.md:216,221,233   #114 / #115 / #114
```

`Exposure: ~0.14% of bare-#N occurrences (5 of 3,672), 0 on this diff's own scope, basis: measured`

**Current defense (honestly assessed):** none. The guard has no escape hatch, and the direction of failure is silence — the citation is never classified, never counted, never reported as "could not verify". That is precisely the QA-16 silent-skip failure mode this file's own header forbids. The four round-3 tests around the continuation rule all assert the *ordinal* direction plus one real-list case ("Closes #7, #8"); none asserts a real citation following an ordinal in the same list.

**Verdict: BREAKS.** Named proof-test required: `QA-14: a REAL issue citation that follows an excluded ordinal in the same comma/slash list is still classified — "Finding #3, #143 filed" resolves #143` (currently fails).

Honest counterweight: the two directions are genuinely irreconcilable by this mechanism — "findings #1/#2" (ordinals) and "findings #118/#119" (issue citations) are byte-identical in shape. See the structural note at the end.

---

### 2. [ISSUE][MED][demonstrated] Issue #143 is only partially closed, and the shipped "0 full-tree" claim is falsified by a counterexample using the denylist's own word

**Attack.** `NON_ISSUE_ORDINAL_WORD_RE` (`src/qa/reference-resolver.ts:112-113`) is an **allowlist of exclusions** — a 9-word denylist anchored at the end of the same-line prefix. Two ways past it, both live in this repo today: (a) an ordinal word the list doesn't contain; (b) a listed word separated from the hash by any non-space character.

**Scenario.** Demonstrated through the shipped scanner (`issueExists: () => true`):

```
D1 parenthesized ordinals   "Two findings (#1, #2) are BREAKS."      => #1[resolved] #2[resolved]
D9 marker-wrapped           "Build task >>#1<< (count)"              => #1[resolved]
D8 backtick ordinal         "every `#1`/`#2` match"                  => #1[resolved] #2[resolved]
D2 items                    "residuals=3 (items #3, #4, #6 above)."  => #3 #4 #6 all resolved
D3 rule                     "ADR-0021 entry, rule #2, verbatim"      => #2[resolved]
D4 coverage gap             "This CORRECTS Coverage gap #1 above."   => #1[resolved]
D5 Next                     "see Next #2 in STATE.md"                => #2[resolved]
D6 recommendation/residual/criterion                                 => #4 #3 #6 all resolved
D7 HIGH ordinal             "round 1's HIGH #1 recurred"             => #1[resolved]
```

`D1` and `D9` matter most: `findings` and `task` **are** in the denylist. `D9` is verbatim the example the finding itself named ("Build task #N") — it survives only because my own round-2 report quotes it wrapped in angle markers.

Full-tree count from `probe2.ts` over the 3,445 recorded occurrences: **21 occurrences where a denylist word is present but adjacency is broken by punctuation, and 20 where the adjacent word is an ordinal word not in the list.** Adjudicating those 41 by hand (some are genuine citations — "findings (#139-#142)" really are issues), **~30 are true residual ordinal false positives** across >= 12 distinct shapes: `items`, `rule`, `criterion`, `Next`, `recommendation`, `residual`, `Coverage gap`, `HIGH #N`, `LOW #N`, open-paren, backtick, angle-markers.

`Exposure: ~0.9% of classified bare-#N occurrences (~30 of 3,445), basis: measured + hand-adjudicated`

**The claim.** `CHANGELOG.md:40` and `docs/decisions.md:58` both state: *"the TRUE ordinal-adjacent-at-classification-time false-positive count is 0, full-tree"*. Under any reading that is not circular with the denylist itself, that is false — D1 is ordinal-adjacent by the plainest reading (the word `findings`, one paren away) and classifies as a resolved issue citation. This is the CLAUDE.md hard-rule class ("no hand-derived completeness claims"): the number came from an instrument, but the instrument encoded the denylist as its own definition of truth. Same defect shape as the already-filed Issue #138.

**Current defense (honestly assessed):** the code comment (`reference-resolver.ts:105-111`) does disclose "this is a denylist, not a completeness claim" — good and correct in spirit. But it then says it "is expected to need new entries **if this repo starts using** a new ordinal word", which understates reality: the repo **already** uses >= 8 unlisted ordinal words, today, in tracked files. The disclosure is calibrated to a tree that does not exist.

**Verdict: BREAKS (partial).** Required before this is called closed: (a) a correction row in `docs/decisions.md` + `CHANGELOG.md` retracting the "0 full-tree" figure with the measured residual, and (b) named failing test `QA-14: an ordinal word separated from the hash by a single punctuation char ("Two findings (#1, #2)") is still excluded`. My recommendation is **not** to write (b) — see the structural note.

---

### 3. [ISSUE][MED][demonstrated] Issue #144 is only partially closed — the same hex literal quoted in prose still hard-fails the gate, live at HEAD

**Attack.** The `(?<!:)` lookbehind excludes `property:#000`. It does nothing for the identical literal written in prose or backticks, which is how any document *discussing* the colour writes it — including the review reports this very commit adds.

**Scenario.** Demonstrated at HEAD against the real instrument:

```
$ node src/qa/reference-resolver.ts bc2b984 7cd9a16
  - [unresolved-authority] #000 — Issue #0 does not exist in this repository
  - [unresolved-authority] #333 — Issue #333 does not exist in this repository
```

and through the scanner:

```
C3 css decl         ".x{background:#000; color:#333;}"     => (none)        <- fixed
C4 hex in prose     "the palette uses (#000, #333) tokens" => #000 #333     <- NOT fixed
C5 hex in backticks "colours `#000` and `#333`"            => #000 #333     <- NOT fixed
```

Issue #144's filed symptom was "classifies as Issue #0 and **hard-fails the gate**". That symptom is still reproducible at HEAD; only its source file moved (`docs/dashboard.mjs:646` -> `docs/reviews/qa1415fix-red-team-round2-2026-09-10.md:258`, the report about the fix).

`Exposure: 2 of the 31 gate failures on this diff's own scope, basis: measured`

**Current defense:** the lookbehind plus two new tests, both of which cover only the declaration shape. No test covers the prose shape.

**Verdict: BREAKS (partial).** Named proof-test: `QA-14: an all-digit hex literal quoted in prose or backticks ("#000", "#333") is NOT classified as an issue citation`.

---

### 4. [ISSUE][LOW][demonstrated] `ISSUE_WORD_CANDIDATE_RE` still spans line boundaries while the round-3 guard no longer does — a cross-line reference is now double-counted

**Attack.** LOW-item 2 changed `MILESTONE_CANDIDATE_RE` to same-line whitespace and made `shouldExcludeBareIssueMatch` same-line-only, but left `ISSUE_WORD_CANDIDATE_RE` (`reference-resolver.ts:92`) using `\s*`, which spans a newline. The two passes now disagree.

```
B1 cross-line issue word   "this is the issue\n#143 is still open"
                           => issue#143[issue/resolved]  #143[issue/resolved]   <- TWO citations, one reference
B2 cross-line milestone    "see the milestone\n#23 is open"  => #23[issue/resolved]  <- correct, LOW-2 fix works
```

Before round 3 the bare match was suppressed (the old guard tested the whole preceding text with a newline-spanning anchor), so this produced one citation. Harm is benign — both records resolve identically — but the citation denominator inflates and the two passes' premises no longer match.

`Exposure: 0 occurrences in tracked files today, basis: measured (probe2 found none); the shape is latent`

**Verdict: BREAKS (cosmetic).** Fold into the same follow-up as findings 1-3: `ISSUE_WORD_CANDIDATE_RE` should use same-line whitespace for symmetry.

---

### 5. [ISSUE][LOW][code-traced] The instrument behind the "74 -> 0" re-measurement was not committed, so the headline numeric claim cannot be re-run

`git diff --stat bc2b984 7cd9a16` shows 7 files: CHANGELOG, REVIEW_LOG, decisions.md, two review reports, `reference-resolver.ts`, `reference-resolver.test.ts`. No measurement script. The CLAUDE.md hard rule requires completeness claims to be "generated by a running instrument" — the instrument ran, but it is gone, so nobody can reproduce or audit either the 74 or the 0. (This is why my own numbers above carry their construction in prose.)

**Verdict: BREAKS (process).** Fix: commit the measurement script under `src/qa/`, or paste its source into the report, next time a numeric claim like this ships.

---

## What genuinely SURVIVES (verified, not taken on the implementer's word)

6. **[CLEAN][demonstrated] The real-citation non-regression holds.** `"Closes #7, #8 in this PR."` -> `#7[resolved] #8[resolved]`. The continuation rule does not eat an ordinary multi-issue citation list; the failure mode in finding 1 needs an ordinal *word* in front of the list's first member.
7. **[CLEAN][demonstrated] The colon lookbehind introduces no false negative for the shapes this repo actually writes.** `"Milestone: #23 is the home."` -> `#23[resolved]`. `git grep -E ':#[0-9]'` across all tracked files returns 12 hits: 4 in `docs/dashboard.mjs` (CSS), 8 in prose/tests *about* this fix. Zero real citations use a colon with no space. The only true false negative is the contrived `"Fixes:#42"` (0 occurrences in-tree).
8. **[CLEAN][demonstrated] CSS-declaration and HTML-entity exclusions both work.** `".x{background:#000; color:#333;}"` -> none; `"renders as &#39; here"` -> none.
9. **[CLEAN][demonstrated] LOW-1 (cross-repo) is really fixed.** `"Issue owner/repo#77 tracked"` -> `owner/repo#77[cross-repo-issue]`, no longer silently dropped.
10. **[CLEAN][demonstrated] LOW-2 (milestone line boundary) is really fixed.** See B2 above — the cross-line join no longer mis-kinds a real Issue citation as an unverified milestone.
11. **[CLEAN][demonstrated] LOW-3 (`parseMaxDistinctIssues`) is really fixed, and I attacked the parser, not just the happy path:**

```
undefined => 300    ""  => 300    "abc" => 300    "0"  => 300    "-5"  => 300
"12.5"    => 300    "Infinity" => 300    "50" => 50    " 50 " => 50    "1e3" => 1000
```

Fails closed to the default with a loud warning on every malformed form, including the empty-string GitHub-Actions case. (`"1e3"` -> 1000 is accepted; that is a finite positive integer, so it is correct, not a hole.)

12. **[CLEAN][code-traced] LOW-4 (decisions.md strikethrough) is really fixed.** `docs/decisions.md:55` now reads `~~node src/qa/reference-resolver.ts and~~ node src/qa/completeness-claim-checker.ts ~~both~~ exits 0 at HEAD` — struck through, not deleted, per `docs/decisions.md:8`.
13. **[CLEAN][demonstrated] Nothing regressed.** 700/700 tests pass, **0 failed, 0 skipped**; typecheck clean; lint clean; QA-15 exits 0. 16 new tests in this round, all in `reference-resolver.test.ts`.
14. **[CLEAN][demonstrated] Issue #137's scope is untouched, and QA-14's red is chronic, not branch-specific.** QA-14 fails 31 of 563 on this diff, and 8 of 367 on a master-only commit range (`3b8d3eb..6f61d44`) — the same pre-existing path/ADR/cross-repo classes #137 tracks. The step at `.github/workflows/ci.yml:231` is a hard gate with no `continue-on-error`, so **this repo's CI cannot go green on the QA-14 step today, on any branch.** That is Issue #137/#120's already-disclosed condition, not something this round caused, and I flagged the same fact at round 2 without gating on it. It is the Manager's call, and it should be made explicitly rather than discovered on push.

---

## The structural observation you asked for — name it, do not patch it again

Three rounds, same class, each round smaller but never zero: round 2 introduced the bare-hash match; round 3 measured 74 ordinal false positives and eliminated the 9 named words; I measure ~30 remaining across >= 12 shapes it did not name, plus a new silent false negative in the other direction.

That is not sloppiness. It is the mechanism's ceiling, and it is **provable** from this repo's own corpus:

> `findings #1/#2` — ordinals (`s4-shell-semantic-detector-app-security-2026-09-02.md:72`)
> `findings #118/#119` — real Issue citations (`s6-policy-centralization-cross-domain-round2-2026-09-08.md:19`)

Byte-identical shape, opposite meaning, both authored by this project's own reviewers. **No word-boundary regex can separate them**, because the distinguishing information is not in the text. Every future round of this loop trades one direction's error for the other's, and the denylist direction trades a loud false positive for a *silent* false negative — the strictly worse currency.

**Recommendation to the Manager (not a blocker):** stop extending the denylist. Change the **signal requirement** instead — classify a bare hash-number only when it carries an explicit citation marker (`Issue #N`, `Closes/Fixes/Resolves #N`, `GH-#N`, `owner/repo#N`, a markdown link), and report everything else as an explicitly *unclassified* candidate rather than silently including or silently excluding it. That flips the residual from "silently resolved / silently skipped" to "loudly unrecognized", which is the QA-16 doctrine this file already claims to follow, and it bounds the tail instead of chasing it. Track it on Issue #137 (the precision-gap tracker that already exists), with the three MED Issues from this report as its named sub-cases. Do **not** spend a round-4 fix-now on this story.

---

## Scariest unproven assumption

**That "QA-14 now verifies the citations it claims to verify" is true in the direction that matters.** It verifies far more of them than it did two rounds ago, but as of HEAD it *silently omits* 5 real issue citations from its own report corpus, and it *silently claims to have verified* ~30 things that were never citations. Both directions are invisible in the instrument's own output — it prints "563 citations, 31 failed" and says nothing about what it decided, wrongly, not to look at. The unproven assumption is the denominator.

## Go / no-go

**go.** No HIGH. Every finding here is MED or below, every one is demonstrated, and none makes the instrument worse than the stub it replaced — `issueExists` really does look issues up now, the round-1 and round-2 mutants stay caught, and 700 tests pass with zero skips. Ship it, file the three MEDs against #137's class, and take the structural recommendation instead of a round 4.

## Single next action

Append the correction row retracting "0 full-tree" to `docs/decisions.md` and `CHANGELOG.md` (finding 2) — it is the only item that touches an append-only evidence artifact, so it is the only one that gets harder to fix later.

## Editorial (verdict-neutral)

* `reference-resolver.ts:107` — "a mutation's M1-style mutant #1" is confusingly worded; M-numbering and hash ordinals are different notations.
* `reference-resolver.ts:105-111` — "expected to need new entries **if** this repo starts using a new ordinal word" should read "already needs new entries; the repo uses >= 8 unlisted ordinal words today".
* The round-3 `docs/decisions.md` row runs ~700 words for a 6-item fix round; the table is becoming unreadable as a table. Not a gate, but worth a format decision soon.

---

RECEIPT: verdict=go
attacks (ALL, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Round-3's list-continuation guard silently DROPS real issue citations — "findings #118/#119" (both real Issues) yields ZERO citations at HEAD; 5 of 3,672 bare-hash occurrences full-tree are real issues now unverified, 0 on diff scope; defense: none, no escape hatch, silent direction
2. [ISSUE][MED][demonstrated] Issue #143 only partially closed — ~30 residual ordinal false positives across >= 12 unlisted/adjacency-broken shapes (items/rule/criterion/Next/residual/HIGH/open-paren/backtick/angle-markers), and the shipped "0 full-tree" claim in CHANGELOG.md:40 + decisions.md:58 is falsified by "Two findings (#1, #2)", which uses the denylist's own word; defense: comment discloses denylist-ness but understates the live gap
3. [ISSUE][MED][demonstrated] Issue #144 only partially closed — the colon lookbehind fixes `property:#000` but the same literal in prose/backticks still classifies; #000 and #333 are 2 of the 31 live gate failures at HEAD, sourced from the round-2 report this commit adds; defense: 2 new tests, both declaration-shape only
4. [ISSUE][LOW][demonstrated] ISSUE_WORD_CANDIDATE_RE still spans newlines while the round-3 guard went same-line-only — cross-line "issue / #143" now yields two citations for one reference (was one pre-round-3); 0 live occurrences
5. [ISSUE][LOW][code-traced] The measurement script behind "74 -> 0" was not committed (7-file diffstat) — the headline numeric claim cannot be re-run or audited
6. [CLEAN][demonstrated] Real-citation non-regression holds — "Closes #7, #8" still resolves BOTH members
7. [CLEAN][demonstrated] The colon lookbehind introduces no real false negative — "Milestone: #23" still resolves; all 12 colon-hash hits in tracked files are CSS or prose about this fix
8. [CLEAN][demonstrated] CSS-declaration and HTML numeric-entity exclusions both work
9. [CLEAN][demonstrated] LOW-1 fixed — "Issue owner/repo#77" classifies as cross-repo, no longer silently dropped
10. [CLEAN][demonstrated] LOW-2 fixed — cross-line "milestone / #23" no longer mis-kinds a real Issue citation as an unverified milestone
11. [CLEAN][demonstrated] LOW-3 fixed — parseMaxDistinctIssues fails closed to 300 on ""/abc/0/-5/12.5/Infinity, accepts 50 and 1e3
12. [CLEAN][code-traced] LOW-4 fixed — decisions.md:55 Issue #138 correction restored as strikethrough per decisions.md:8
13. [CLEAN][demonstrated] No regression — 700/700 pass, 0 fail, 0 skipped; typecheck clean; lint clean; QA-15 exit 0
14. [CLEAN][demonstrated] Issue #137 scope untouched and QA-14's CI red is chronic, not branch-specific (master-only range also fails 8/367; ci.yml:231 is a hard gate) — Manager's call, not this round's defect
counts (CHECKSUM): issues=5 suspicions=0 clean=9
evidence (CHECKSUM): demonstrated=12 code-traced=2 derived=0
checks=npm test 700 pass / 0 fail / 0 skipped; typecheck clean; lint clean; QA-15 exit 0; QA-14 exit 1 (31/563 diff scope, 8/367 master control); own probes: 3,445 recorded + 202 excluded bare-hash occurrences over 205 files; 22 adversarial scanner cases; 10 parser cases
adr=HIT(35)
report=docs/reviews/qa1415fix-red-team-round3-2026-09-10.md
