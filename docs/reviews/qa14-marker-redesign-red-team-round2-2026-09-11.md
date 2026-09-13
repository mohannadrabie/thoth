# Red Team (Sutekh) — `fix/qa14-marker-redesign`, round 2 (re-confirm)

**Date:** 2026-09-11
**Scope:** branch `fix/qa14-marker-redesign` @ `95e3a21` (round-1 fix-now pass) vs its own prior state `64a18ed` and vs `master` `c598312` — `src/qa/reference-resolver.ts`, `src/qa/marker-corpus-probe.ts`, `src/qa/completeness-claim-checker.ts`.
**Tier:** CRITICAL (ratified, `docs/.maat-state.json`).
**Verdict: go** — all three of my round-1 code defects (#152 HIGH, #153 MED, #154-dash) are genuinely fixed, mutation-verified, and reproduce clean on the real corpus. What remains is claim-accuracy and instrument-verification debt: 2 MED, 3 LOW, no HIGH, no gate-weakening regression.

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]

**ADR pass (attack-surface slice: CI-gate / quality / evidence tags).** ADR-0008 (devops) and ADR-0010 (SE) remain the only catalog entries whose rules touch a gate's blocking surface. The Manager's triage ruling (`docs/decisions.md` row 63) reads ADR-0008's ratchet rule as scoped to the named IaC/supply-chain gate stack, from the source text, not assumed. I accept that ruling and did not re-litigate it; my round-1 SUSPICION 5 is withdrawn as ruled, not as refuted.

---

## Method — what I actually ran, and how I made it revert-proof

The shared working tree was silently reverted mid-review in round 1 (documented in `docs/decisions.md` row 63). This round I removed the exposure rather than monitoring it: both classifier versions and the entire scanned corpus were extracted with `git archive` into pinned scratchpad snapshots (`new/` = `95e3a21`, `mid/` = `64a18ed`, `old/` = `c598312`) and every measurement ran against those snapshots, never the live tree.

```
$ md5sum $SCRATCH/new/src/qa/reference-resolver.ts  C:/playground/thoth/src/qa/reference-resolver.ts
c69399b27cbdd5ceee8f5589474bea66  (both, identical — verified again at end of review, unchanged)
$ git rev-parse HEAD -> 95e3a2126b931e34266d6507e563aac2933c1cc6   (tree clean of my own edits throughout)
```

Where per-occurrence visibility was needed, a copy of the shipped classifier carrying **exactly four added lines** (one log push per branch of `classifyBareHashMatch`) was used, proven by diff:

```
$ diff new/src/qa/reference-resolver.ts new/src/qa/rr-instr.ts
314a315 >     (globalThis as any).__LOG?.push({ idx, kind: "already-recorded", ... });
318a320 >     (globalThis as any).__LOG?.push({ idx, kind: "direct-marked", ... });
323a326 >     (globalThis as any).__LOG?.push({ idx, kind: "continuation-marked", ... });
326a330 >   (globalThis as any).__LOG?.push({ idx, kind: "unmarked", ... });
```

Issue existence was resolved once per distinct number against the real `gh issue view --repo mohannadrabie/thoth --json state` (132 distinct numbers, one call each, cached) and the **same cache fed all three classifier versions**, so every before/after below is apples-to-apples.

Baseline gates, run by me on the committed tree at `95e3a21`:

```
$ npm run typecheck  -> tsc --noEmit, exit 0, clean
$ npm run lint       -> eslint ., exit 0, clean
$ npm test  x6       -> tests 722 | pass 722 | fail 0 | skipped 0   (every run)
$ node src/qa/completeness-claim-checker.ts -> PASS: 2 file(s) checked, exit 0
```

---

## Re-verification of round-1 findings

### 1. Issue #152 (HIGH, dedup shadowing) — FIXED, independently confirmed. Closing.

My original attack inputs, run against all three versions with a real existence stub:

```
in : "The table's row #9999 was cosmetic.\n\nCloses #9999."
  OLD(master c598312) ok=false :: #9999=unresolved-authority
  MID(64a18ed)        ok=true  :: #9999=unclassified(cand)      <- the round-1 defect
  NEW(95e3a21)        ok=false :: #9999=unresolved-authority    <- fixed
in : "The upstream tracker's #2604 entry is unrelated.\n\nFixes #2604."
  MID ok=true  :: #2604=unclassified   NEW ok=false :: #2604=unresolved-authority
in : "Closes #9999.\n\nThe table's row #9999 was cosmetic."   (marked first — must not downgrade)
  MID ok=false   NEW ok=false
in : "Row #9999 cosmetic. Closes #9999. Row #9999 again."     (unmarked after the upgrade)
  MID ok=true    NEW ok=false
```

The 17.4% figure re-measured with the instrumented classifier across all 217 scanned tracked files at `95e3a21`:

```
classification counts, full tree: {"already-recorded":2038,"direct-marked":274,"continuation-marked":400,"unmarked":1515}
distinct (file,#N) pairs with >=1 MARKED occurrence: 422
E-class SHADOWED distinct (file,#N) pairs: 0
=> 0.0% (was 61/351 = 17.4% at 64a18ed)
```

Mutation-verified — reverting only the fix (`recordBareHash(raw, () => classifyIssue(raw, deps), true)` back to `record(...)`) in an isolated copy turns exactly the new tests red:

```
### M1  -> tests 69  pass 66  fail 3
  X QA-14 (Issue #152, HIGH): an unmarked bare #N earlier in a file must NOT prevent a later 'Closes #N'...
  X QA-14 (Issue #152, HIGH, symmetric case): the same shape resolves cleanly when the marked issue genuinely exists
  (3rd failure is the cwd-dependent dogfood test, an artifact of my isolated root, not the mutation)
```

Code-traced, the upgrade is also correctly one-directional and cannot collide across kinds: the upgrade branch requires `existing.kind === "issue-candidate"`, `classifyIssue` always returns `kind:"issue"`/`"unparseable"`, so a raw is re-classified at most once (no repeated `gh` traffic), and no other `record()` caller can ever produce the bare `#N` raw shape (ADR raws start `ADR-`, cross-repo raws contain `/`, word-form raws are normalized, backtick paths never match the bare-number shape).

**Verdict: SURVIVES.**

### 2. Issue #153 (MED, singular/plural seeding asymmetry) — FIXED, independently confirmed. Closing.

```
in : "Issues #7, #9999 are both fixed."   MID ok=false   NEW ok=false   (plural — always worked)
in : "Issue #7, #9999 are both fixed."    MID ok=true    NEW ok=false   <- fixed
in : "Issue #7/#9999 both closed."        MID ok=true    NEW ok=false   <- fixed
in : "Issue #7-#9999 both closed."        MID ok=true    NEW ok=false   <- fixed
```

Mutation-verified (M2, dropping the one added seeding line): `tests 69 pass 67 fail 2`, the failure being exactly `QA-14 (Issue #153): a singular 'Issue #A, #B' list verifies BOTH members...`.

Real-corpus effect, measured MID -> NEW over the full tree: **118 citations moved out of the non-blocking `unclassified` bucket into real classification** (`unclassified` 545 -> 427). I adjudicated all 118 individually against their source context — 114 are genuine issue citations in this repo's own prose, i.e. verification correctly restored. The other 4 are the known #154 residual (below). **No silent false-resolve wave was introduced.**

**Verdict: SURVIVES.**

### 3. Issue #154 (MED, false "never" claims) — dash fix real; the replacement incidence claim is false at the commit that ships it. Staying open.

**(a) Is the dash fix correct and tested? Yes.**

```
in : "Closes #7 - #3 of the findings remain open."    MID: #3=resolved   NEW: #3=unclassified   <- closed
in : "Closes #7 [en-dash] #3 of the findings ..."     MID: #3=resolved   NEW: #3=unclassified   <- closed
in : "Closes #7-#3 of the findings remain open."      NEW: #3=resolved   (tight range still continues, as designed)
in : "Closes #105-#113 fixed."                        NEW: both resolved (genuine tight range preserved)
```

Mutation-verified (M3, widening TIGHT_DASH_CONTINUATION_RE back to a loose class): `fail 2`, exactly `QA-14 (Issue #154, dash leak CLOSED)`.

**The corpus grounding for the tight-dash choice holds.** I re-ran the grep myself rather than trusting it — every dash-joined pair in the tree, shape-normalised:

```
     37  #N-#N          (tight hyphen)
      8  #N - #N        (space-padded)
      6  #N[en-dash]#N  (tight)
      1  #N[em-dash]#N  (tight)
```

All 8 space-padded hits are this round's own repro/documentation text (my round-1 report x3, CHANGELOG.md, docs/decisions.md, docs/REVIEW_LOG.md, the new test). **Zero genuine citation ranges lose verification** to the tightening. The design call is grounded, not a guess.

**(b) Is leaving the comma/whitespace leak open defensible? Yes — the architectural reasoning holds.** Closing it requires either a word list (re-introducing the exact denylist failure mode R3-R6 deleted, which this project has already proven unbounded) or dropping comma continuation entirely (which would silently un-verify every real comma-joined citation list — the far larger and *silent* harm). The residual is loud in the blocking direction and pinned by a test. I do not gate on it.

**(c) Are the corrected claims accurate now? No — and this is the finding.** The replacement for the false "never" is a measured figure, and the figure is wrong at `95e3a21`:

| Where the claim lives | What it says | Measured at `95e3a21` |
|---|---|---|
| `src/qa/reference-resolver.ts` (TIGHT_DASH comment) | "Measured full-tree incidence: 0 real occurrences of this shape in this repo's own tracked corpus" | **10 occurrences** |
| `src/qa/reference-resolver.test.ts` (residual test comment) | "Measured full-tree incidence of this exact shape: 0/316 real occurrences" | **10/400** |
| `CHANGELOG.md` | "(0/316 real-corpus incidence)" / "**0 real occurrences**" | same |
| `docs/decisions.md` row 64, `docs/STATE.md` item 4 | "0 real-corpus occurrences measured" | same |

```
continuation-marked occurrences: 400
continuation-marked whose number does NOT exist as an issue (visible leak): 10
  docs/REVIEW_LOG.md #9999 / #000, docs/decisions.md #000 (x2),
  docs/reviews/qa14-marker-redesign-red-team-2026-09-11.md #9999 (x3) / #000 (x2)
```

And it is not theoretical: the **real shipped gate**, run by me on this branch's own PR range, is red and 5 of its 33 blocking findings are this residual:

```
node src/qa/reference-resolver.ts c598312 HEAD   -> exit 1
[QA-14 reference-resolver] FAIL: 33 of 932 citation(s) failed to resolve; 135 more unclassified (non-blocking).
   ... blocking detail counts:  3x #000,  2x #9999  (the rest are the pre-existing, out-of-scope R1 path failures)
```

Against the branch's own prior state the round therefore **adds** blocking failures, which the close-out prose under-reports. `docs/decisions.md` row 64 names exactly one (the `#000` inside its own row 63). Measured:

```
=== full: files=217
  64a18ed blocking=272 total=3424 unclassified=545
  95e3a21 blocking=276 total=3424 unclassified=427
  NEW-ONLY blocking keys (4):  REVIEW_LOG.md|#000, REVIEW_LOG.md|#9999, decisions.md|#000, red-team-report|#9999
  REMOVED blocking keys (0)
=== pr-scope (c598312..95e3a21, 13 files): 29 -> 33 blocking, same 4 new keys
```

`#9999` is never mentioned anywhere in the close-out. The build's own "zero new distinct failure reasons" claim is true *against master* (I reproduced it: new-only keys empty, `after` a strict subset of `before`, same 3 removed keys `#2604`/`#333`/`#999999`) — but that comparison structurally cannot see a regression the round introduces relative to its own prior state, which is the comparison that matters for a fix-now round.

**Exposure: 5 of 33 (15%) of the blocking findings in this branch's own real gate run are artifacts of the residual; 4 distinct new blocking keys vs. the pre-fix branch state; 2 of the 5 documents carrying the corrected claim are shipped source/test comments. Basis: measured.**

**Current defense, honestly assessed.** The residual itself is honestly disclosed, pinned by a test, and argued in code — that part is genuinely good work. The defense that is missing is any mechanism keeping the *incidence number* true: it was measured before the round's own documentation was written, and writing that documentation falsified it. The project has now corrected this exact shape of claim three times (`cifix` x2, this story).

**Verdict: BREAKS** (on the claim, MED — not on the mechanism).

**Named proof-test required:** `"QA-14 (Issue #154): the comma-continuation residual's documented corpus incidence is produced by a running instrument, not typed"` — extend `src/qa/marker-corpus-probe.ts` with a `continuationLeaks` counter (continuation-marked matches whose number fails `issueExists`), print it, and replace every "0 real occurrences" sentence with a QA-15 completeness marker referencing `qa14-marker-corpus-probe` so CI re-runs it and fails on drift. That single change also resolves finding 5 below.

### 4. LOW full-tree drift — still does not reproduce, and now provably cannot.

Claimed (CHANGELOG/decisions/STATE): full-tree `295/3270 -> 275/3339` over **213 files**; diff-scope `34/541 -> 25/552`.
Measured by me, same methodology, shared `gh` cache, at the committed HEAD:

```
=== full: files=217
  OLD(c598312) blocking=304 total=3356 unclassified=0
  NEW(95e3a21) blocking=276 total=3424 unclassified=427
=== diff (c598312..64a18ed file list, current content): files=6
  OLD blocking=34 total=542   NEW blocking=24 total=552
```

The file-count discrepancy is the root cause and it is structural, not drift: **213** is the tracked-blob count at `64a18ed`, i.e. the measurement was taken before the commit that adds `src/qa/marker-corpus-probe.ts` and the 3 round-1 review reports (217 at `95e3a21`). The published figures are measurements of a tree state that no commit contains. The *substantive* claim — zero new distinct blocking reasons vs. master, same 3 removed — reproduces exactly.

**Verdict: BREAKS** (LOW, claim-accuracy; the conclusion it supports is sound).

### 5. New files — probe is real and registered; the claim it exists to support is still unverified.

`src/qa/marker-corpus-probe.ts` exists, runs, reuses the shipped `scanReferences` (no second copy of the regexes — code-traced), has 5 real assertions, and **is** registered:

```
git diff 64a18ed 95e3a21 -- src/qa/completeness-claim-checker.ts
+  "qa14-marker-corpus-probe": { cmd: "node", args: ["src/qa/marker-corpus-probe.ts"] },
```

That is the mechanical half of Issue #150. The half that matters is not done:

```
node src/qa/marker-corpus-probe.ts
  -> PASS: marked=422 unmarked=427 total=849 - approx 50% ... (217 files scanned)
node src/qa/marker-corpus-probe.ts 64a18ed      (the file list the claim was taken against)
  -> PASS: marked=388 unmarked=416 total=804 ... (213 files scanned)
CLAIMED in CHANGELOG.md / decisions.md / STATE.md: marked=380 unmarked=416 total=796
grep for a QA-15 completeness marker naming this instrument -> no hit anywhere
lastInteger(probe stdout), i.e. what verifyMarkerClaim would compare -> 217
```

Three things follow. (i) The published triple **does not reproduce** at any tree state — not at HEAD, not even at the file list it names. (ii) **No completeness marker references the new instrument**, so QA-15 never re-runs it; `node src/qa/completeness-claim-checker.ts` passes with "2 file(s) checked" while this claim sails past, because the bare-claim heuristic's phrase list does not match the `marked=... unmarked=... total=...` shape (documented as heuristic, so this is a gap in the fix, not in QA-15). (iii) Even if a marker were added, `verifyMarkerClaim` compares the **last integer in stdout** (`lastInteger`, `src/qa/completeness-claim-checker.ts`), which for this probe is `filesScanned` = 217 — so the marked/unmarked/total triple is currently **unverifiable through the only mechanism this project has**. Registering an instrument whose output shape cannot answer the claim is a fix that looks complete and is not.

**Exposure: 1 of 1 claims the instrument was built to verify, basis: measured.**

**Verdict: BREAKS** (MED). **Named proof-test:** `"QA-15: the marker-corpus figure in CHANGELOG.md is verified by a re-run instrument"` — make the probe print the claimed quantity **last** (or emit one number per invocation via an argument), annotate the CHANGELOG sentence with the completeness marker, and confirm `node src/qa/completeness-claim-checker.ts` fails when the expected number is wrong.

`docs/STATE.md` (Issue #151) **is** updated with a real, specific resume point reflecting this round's actual state. Confirmed fixed.

### 6. Flaky summarizeCitations test — not reproduced; the claim is credible.

```
RUN 1..6: tests 722 | pass 722 | fail 0 | skipped 0
```

16 consecutive clean full-suite runs between the build's 10 and my 6, on an unmodified tree. Reporting a single non-reproducing anomaly honestly instead of "fixing" it was the right call. No further action; if it recurs it needs a seed/ordering hypothesis, not a retry count.

---

## New defects this round's fix introduced

### 7. [LOW] A `Milestone #N` now opens list continuation — the next number is verified as an **Issue**, across namespaces.

Seeding `state.lastMarkedListEnd` in the `"already-recorded"` branch fires for `milestone` as well as `issue`, because both share that branch's guard `/\b(?:issue|milestone)[ \t]*$/i`.

```
in : "Milestone #23, #24 are both tracked."
  MID(64a18ed) ok=true :: Milestone #23=resolved | #24=unclassified(cand)     <- safe
  NEW(95e3a21) ok=true :: Milestone #23=resolved | #24=resolved               <- #24 verified as an ISSUE
in : "Milestone #23, #9999 are both tracked."   NEW: #9999=unresolved-authority, ok=false
```

This is the precise thing `MILESTONE_CANDIDATE_RE`'s own comment says must never happen: conflating a Milestone reference with an Issue citation of the same number "would silently verify the WRONG entity (an issue that happens to share the number, or a false failure when no issue shares it)". Master behaves the same way, so it is not a regression against the merge target — but the redesign had incidentally closed it and this round re-opened it, silently, in the direction the module documents as forbidden.

**Exposure: 0 occurrences in the current corpus, basis: measured** (a grep for a milestone word-form followed by a connector and another number returns 0 hits tree-wide). Latent, not live. No test pins the behavior either way.

**Verdict: BREAKS** (LOW — measured exposure zero; the fix is a pinning test plus a one-line split of the guard so only `issue` seeds continuation, or an explicit ruling that milestone lists inherit issue semantics).

### 8. [LOW] The probe's own summary line mislabels what it counts, and the "correction" it justified may have replaced a correct figure with a differently-defined one.

`marker-corpus-probe.ts` prints "approx 50% of this repo's **bare #N occurrences**". It does not count occurrences — `scanReferences` dedupes per file, so it counts distinct `(file, raw)` pairs (the probe's own test even pins "dedupes within a file"). At occurrence level, from the instrumented classifier:

```
bare #N occurrences = direct-marked 274 + continuation-marked 400 + unmarked 1515 = 2189
unmarked share = 1515/2189 = 69.2%        (the probe reports 50%)
```

69.2% is close to the superseded scratchpad figure (~73%) that this round declared a hard-rule violation and "corrected" to ~52%. The old number may well have been *right* at occurrence level; what was wrong with it was that it was unreproducible, not necessarily that it was inaccurate. Calling a methodology change a correction, in prose, without saying which denominator moved, is how a future reader mis-learns the corpus. The design conclusion is unaffected either way.

**Verdict: BREAKS** (LOW, labelling/claim accuracy). Fix is one phrase in the summary string (`occurrences` -> `distinct per-file citations`) plus one clause in the CHANGELOG.

---

## What survived

| # | Attack | Result |
|---|---|---|
| S1 | **Dedup shadowing is gone, both scan orders, full corpus** — 0 shadowed `(file,#N)` pairs of 422 marked (was 61/351); mutation-verified (2 tests red on revert). | **SURVIVES** |
| S2 | **Singular/plural seeding asymmetry closed** — all 4 shapes now behave identically to the plural form; mutation-verified. | **SURVIVES** |
| S3 | **Tight-dash guard is corpus-grounded, not a guess** — 37 tight + 6 en-dash + 1 em-dash genuine ranges preserved; all 8 space-padded hits are this round's own repro text, so no real citation loses verification. Mutation-verified. | **SURVIVES** |
| S4 | **No silent false-resolve wave** — all 118 citations promoted out of `unclassified` (545 -> 427) adjudicated individually against source context: 114 genuine citations, 4 the disclosed residual. The dangerous direction (silently starting to "resolve" non-citations) did not materialize. | **SURVIVES** |
| S5 | **Upgrade-in-place is one-directional and collision-free** — requires `kind === "issue-candidate"`, `classifyIssue` never returns that kind, so at most one re-classification per raw (no extra `gh` traffic, no downgrade); no other `record()` caller can produce a bare `#N` key. | **SURVIVES** |
| S6 | **Out-of-scope R1/R2 boundary byte-identical to master** — md5 over extracted bodies: `classifyPath`, `resolveWithinRepo`, `checkIssueViaGh`, `resolveIssueCitations`, `parseMaxDistinctIssues`, `classifyIssue`, `verifyLocalIssue`, `classifyAdr`, `classifyMilestone`, `shouldScanFile`, plus `ADR_CANDIDATE_RE`, `ISSUE_CANDIDATE_RE`, `ISSUE_WORD_CANDIDATE_RE`, `MILESTONE_CANDIDATE_RE`, `BACKTICK_PATH_RE` — all IDENTICAL. Only `summarizeCitations` differs, by design and in scope. | **SURVIVES** |
| S7 | **"Zero new blocking reasons vs master" reproduced exactly** — mechanical set-diff both scopes: new-only keys empty, `after` a subset of `before`, same 3 removed keys. | **SURVIVES** |
| S8 | **docs/STATE.md resume point (Issue #151)** is real, specific and reflects this round's actual state, not a template. | **SURVIVES** |
| S9 | **Gates** — typecheck exit 0, lint exit 0, `npm test` 722/722/0 fail/**0 skipped** across 6 independent runs; `completeness-claim-checker` PASS. Claimed counts reproduced exactly. | **SURVIVES** |

---

## Editorial (verdict-neutral, plain edits, no re-review)

- `docs/STATE.md`'s new resume point still says "not yet committed / not yet re-reviewed" — true when written, stale at `95e3a21`.
- `CHANGELOG.md`'s R4/R5 paragraph still describes `LIST_CONTINUATION_RE` as including a dash-range class; the dash separator moved out of that regex into `TIGHT_DASH_CONTINUATION_RE` this round.
- `reference-resolver.ts`'s branch-(c) doc comment mentions a parenthesized range as a supported shape; it is not — a parenthesized range leaves **both** members unclassified because the `(` breaks `CITATION_MARKER_WORD_RE`'s trailing anchor. Pre-existing (identical on `64a18ed`), verdict-neutral, but the comment over-promises.
- The mangled-filename junk file noted in round 1 is gone from the repo root. Good.

---

## Open findings and failing tests

5 open findings, 0 suspicions. Executable forms — 3 of 5 map to a named test; 2 are prose-accuracy corrections with no executable form (stated, not hidden):

| Finding | Named failing test |
|---|---|
| 3 (MED, #154 incidence claim) | `QA-14 (Issue #154): the comma-continuation residual's documented corpus incidence is produced by a running instrument, not typed` |
| 5 (MED, #150 unverified claim) | `QA-15: the marker-corpus figure in CHANGELOG.md is verified by a re-run instrument` |
| 7 (LOW, milestone continuation) | `QA-14: a "Milestone #A, #B" list must not verify #B as an Issue (separate numbering namespace)` |
| 4 (LOW, control-figure drift) | No executable form — the figures describe a pre-commit tree state; correct by re-measuring at the merge commit or qualifying the file-count basis. |
| 8 (LOW, probe label) | No executable form — a one-phrase correction in the summary string and the CHANGELOG clause. |

---

## The single scariest unproven assumption

**That a measured number stays true after you write it down.** Every gate-weakening defect I found in round 1 is genuinely closed, and closed well — the mechanism is now stronger than master in the direction that matters. What has recurred for the third time in this project's history is the *claim* layer: "never" became "0/316 measured", and the act of documenting the residual created 10 instances of it, 5 of which are blocking findings in the branch's own gate run right now. This corpus is self-referential — the checker scans the documents that describe the checker — so any incidence figure typed into prose about this file is stale the moment it is typed. The only durable fix is to stop typing them: the probe already exists and is allowlisted; it just needs to emit the number the claim makes and be referenced by a QA-15 completeness marker so CI re-derives it. Until then this project will keep correcting the same sentence.

**Go/no-go: go.** No HIGH, no gate-weakening regression, all three round-1 code defects fixed and mutation-verified. The two MEDs are documentation-and-instrument debt on a gate that is already red for known, out-of-scope reasons, and neither can silently mislead the *checker* — only its readers.

**Single next action:** add a `continuationLeaks` counter to `src/qa/marker-corpus-probe.ts`, print it last, and replace every "0 real occurrences" sentence in `reference-resolver.ts`, `reference-resolver.test.ts`, `CHANGELOG.md`, `docs/decisions.md` and `docs/STATE.md` with a QA-15 completeness marker — one change closes findings 3 and 5 and stops the recurrence.

---

```
RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Issue #154's replacement claim is false at the shipping commit: "0 real occurrences / 0-of-316" is asserted in reference-resolver.ts, reference-resolver.test.ts, CHANGELOG.md, decisions.md and STATE.md, while the instrumented classifier measures 10 continuation leaks of 400 and the REAL gate run (node src/qa/reference-resolver.ts c598312 HEAD, exit 1) shows 5 of its 33 blocking findings ARE that residual; close-out names 1 of 4 new blocking keys and never mentions #9999 - defense is honest disclosure of the mechanism but nothing keeps the number true.
2. [ISSUE][MED][demonstrated] Issue #150 half-closed: probe is real, reuses the shipped classifier and IS in KNOWN_INSTRUMENTS, but no QA-15 completeness marker references it, the published triple (380/416/796) reproduces at no tree state (388/416/804 at its own file list, 422/427/849 at HEAD), and verifyMarkerClaim's last-integer parse yields 217 (filesScanned) so the triple is unverifiable through the only mechanism this project has - a fix that looks complete and is not.
3. [ISSUE][LOW][demonstrated] Full-tree/diff control figures still do not reproduce (claimed 295/3270->275/3339 over 213 files; measured 304/3356->276/3424 over 217) - structural, not drift: 213 is the tracked-blob count at 64a18ed, so the published numbers describe a tree no commit contains; the substantive "zero new reasons vs master" claim reproduces exactly.
4. [ISSUE][LOW][demonstrated] New hazard from the #153 seeding fix: "Milestone #23, #24" now verifies #24 as an ISSUE via continuation - the cross-namespace conflation MILESTONE_CANDIDATE_RE's own comment forbids; 64a18ed left it unclassified. Measured corpus incidence 0, no test pins it either way.
5. [ISSUE][LOW][demonstrated] marker-corpus-probe's summary calls its figure "% of bare #N occurrences" but counts distinct per-file pairs; occurrence-level truth is 1515/2189 = 69%, near the ~73% scratchpad figure this round declared a violation and "corrected" to ~52% - a methodology change presented as a correction.
6. [CLEAN][demonstrated] Issue #152 (HIGH) genuinely fixed: 0 shadowed (file,#N) pairs of 422 marked full-tree (was 61/351 = 17.4%); original attack inputs flip back to ok=false in both scan orders; mutation-verified (2 tests red on revert).
7. [CLEAN][demonstrated] Issue #153 (MED) genuinely fixed: singular "Issue #A, #B" now verifies both members identically to the plural form; mutation-verified; 114 genuine citations restored to real verification full-tree.
8. [CLEAN][demonstrated] Issue #154's dash sub-case genuinely closed and corpus-grounded: 37 tight + 6 en-dash + 1 em-dash genuine ranges preserved and all 8 space-padded hits are this round's own repro text - no real citation loses verification; mutation-verified.
9. [CLEAN][demonstrated] No silent false-resolve wave: all 118 citations promoted out of unclassified (545->427) adjudicated individually - 114 genuine, 4 the disclosed residual; the dangerous direction did not materialize.
10. [CLEAN][code-traced] Upgrade-in-place is one-directional and collision-free - requires kind "issue-candidate", classifyIssue never returns it (at most one re-classify per raw, no extra gh traffic, no downgrade), and no other record() caller can produce a bare #N key.
11. [CLEAN][demonstrated] Out-of-scope R1/R2 boundary byte-identical to master by md5 over extracted bodies: classifyPath, resolveWithinRepo, checkIssueViaGh, resolveIssueCitations, parseMaxDistinctIssues, classifyIssue, verifyLocalIssue, classifyAdr, classifyMilestone, shouldScanFile + 5 regexes.
12. [CLEAN][demonstrated] "Zero new blocking reasons vs master" reproduced exactly in both scopes (new-only keys empty, after a subset of before, same 3 removed keys).
13. [CLEAN][demonstrated] Issue #151 fixed - docs/STATE.md carries a real, specific resume point for this round, not a template.
14. [CLEAN][demonstrated] Flaky summarizeCitations test not reproduced in 6 further full-suite runs (16 clean runs including the build's 10); the honest "unreproduced, not fixed" report is credible.
counts (CHECKSUM): issues=5 suspicions=0 clean=9
evidence (CHECKSUM): demonstrated=13 code-traced=1 derived=0
checks=npm test x6: tests 722 | pass 722 | fail 0 | skipped 0 (every run); npm run typecheck exit 0; npm run lint exit 0; node src/qa/completeness-claim-checker.ts PASS exit 0; node src/qa/reference-resolver.ts c598312 HEAD -> FAIL 33/932, exit 1; 3 targeted mutations of the shipped classifier, each turning exactly its own new test red (M1 fail 3, M2 fail 2, M3 fail 2); 5 custom probes driving three pinned classifier versions over 217 tracked files, sharing 132 real gh issue view lookups
adr=HIT(35)
report=docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md
```
