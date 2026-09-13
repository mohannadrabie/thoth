# Red Team (Sutekh) — `fix/qa14-marker-redesign`, round 3 (targeted re-confirm)

**Date:** 2026-09-11
**Scope:** branch `fix/qa14-marker-redesign` @ `4896420` (round-2 fix-now pass), narrow — GitHub Issues #154 and #150 only, plus a general sweep for regressions the round-2 fix introduced.
**Tier:** CRITICAL (ratified, `docs/.maat-state.json`).
**Verdict: go.** #150 is genuinely, independently resolved — four methodologies agree on the published figure and I reproduced the wrong-`expect` catch myself. #154 is **not** resolved: its replacement figure is stale again at the commit that ships it (published `10 of 400` / `5 of 33`; measured `15 of 412` / `6 of 35`). The no-code-fix rationale is sound and I endorse it; the number is not. Two further MEDs, both introduced by the #150 fix itself. No HIGH, no gate-weakening regression.

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp `83b2e3e`) [CACHE=HIT]

**ADR pass (attack-surface slice: CI-gate / quality / evidence tags).** Same slice as rounds 1-2 — devops ADR-0008 (CI/CD gates), SE ADR-0010 (code-quality gates), SE ADR-0005 (testing strategy). The ADR-0008 ratchet ruling (`docs/decisions.md` row 63, re-confirmed rounds 1-2) stands and is not re-litigated. SE ADR-0005's first MUST ("unit tests for every new/changed behavior — happy path, error paths, and boundaries") is the rule finding 3 below is measured against; read from `adrCatalog.adrs`, not assumed.

---

## Method — file-state integrity, re-verified

Round 1 suffered a silent working-tree revert. Round 2 removed the exposure with pinned `git archive` snapshots. This round adds one more layer: **every mutation ran in a detached `git worktree` at `4896420`**, never in the shared tree, and the shared tree was md5-pinned before and after.

```
$ git rev-parse HEAD          -> 4896420ab1f12ea890029151330c9b218818c4d9
$ git status --porcelain      -> (empty, before any measurement)
$ md5sum  (pinned at start, re-verified at end — all IDENTICAL)
  5683618586401dfb422fca97e0d205f8  src/qa/marker-corpus-probe.ts
  82a2f11dedef52ab340304985f97c3b4  src/qa/completeness-claim-checker.ts
  83a633c07810bb0b832d5f8f86fc6024  src/qa/marker-corpus-probe.test.ts
  8782a035ded4e6fc8ea34749cadde4c4  CHANGELOG.md
  5111c7b54fced5f006f7caba8a3c511c  docs/decisions.md
$ git worktree add SCRATCH/wt-m1 4896420 --detach   (all mutation work isolated here)
```

Per-occurrence visibility again used a copy of the shipped classifier carrying **exactly four added lines**, proven by diff against the shipped file (import paths normalised back before diffing):

```
$ diff <(sed 's|file:///C:/playground/thoth/src/lib/|../lib/|g' rr-instr.ts) src/qa/reference-resolver.ts
329d328 <     (globalThis as any).__LOG?.push({ idx, kind: "already-recorded" });
334d332 <     (globalThis as any).__LOG?.push({ idx, kind: "direct-marked", ... });
340d337 <     (globalThis as any).__LOG?.push({ idx, kind: "continuation-marked", ... });
344d340 <     (globalThis as any).__LOG?.push({ idx, kind: "unmarked", ... });
DIFF_LINES=4     (no other difference)
```

Issue existence resolved against the real `gh issue view --repo mohannadrabie/thoth --json state`, one call per distinct number (87 distinct numbers in the continuation-marked population).

Baseline gates, run by me on the committed tree at `4896420`:

```
$ npm run typecheck  -> tsc --noEmit, exit 0, clean
$ npm run lint       -> eslint ., exit 0, clean
$ npm test           -> tests 727 | pass 727 | fail 0 | skipped 0
$ node src/qa/completeness-claim-checker.ts -> PASS: 2 file(s) checked, exit 0  (21.9 s)
```

All three claimed counts reproduce exactly.

---

## Issue #150 — genuinely resolved. Closing.

### The published figure reproduces, by four independent routes

| Route | Result |
|---|---|
| Shipped probe, default mode, shared tree | `marked=430 unmarked=456 total=886 — approx 51% ... (220 files scanned)` |
| Shipped probe, `--field=marked` / `-unmarked` / `-total` | `430` / `456` / `886`, one number per invocation, nothing else in stdout |
| My own reimplementation (`git ls-tree -r --name-only HEAD` + `shouldScanFile` + `computeMarkerCorpusStats`) — a *different* enumeration path than the probe's `resolveChangedFiles` zero-SHA fallback | `{"marked":430,"unmarked":456,"total":886,"filesScanned":220}` |
| Pristine detached `git worktree` at `4896420` (no session artefacts, no untracked files) | `marked=430 unmarked=456 total=886` |

The round-2 root cause is confirmed correct: the figure is a function of the tracked corpus, and `git ls-tree` cannot see an untracked file, so a mid-build measurement always undercounts. `CHANGELOG.md:47` states that root cause plainly.

### The markers are real, and QA-15 genuinely catches a wrong expect

I did not take the build's word for the `expect=0` test. I ran the real checker against a scratch file carrying one deliberately-wrong and one correct marker, in the same invocation:

```
$ cat SCRATCH/wrongclaim.md
marked=[[completeness: cmd="qa14-marker-corpus-probe-marked" expect=0]]
total=[[completeness: cmd="qa14-marker-corpus-probe-total" expect=886]]

$ node src/qa/completeness-claim-checker.ts SCRATCH/wrongclaim.md
[QA-15 completeness-claim-checker] FAIL: 1 of 1 file(s) had a failing completeness claim.
  - wrongclaim.md: 1 of 2 numeric completeness claim(s) failed.
  -   MISMATCH: claim says 0, instrument "qa14-marker-corpus-probe-marked" re-run reports 430
EXIT=1
```

Both directions in one run: the wrong expect fails loud with the real re-run's number; the correct expect passes silently. Wiring confirmed end to end, not asserted.

- `src/qa/completeness-claim-checker.ts:57-59` — three `qa14-marker-corpus-probe-<field>` entries, each pinned to the exact args a marker needs (code-traced).
- `CHANGELOG.md:47` — three live completeness markers, expect 430/456/886.
- `CHANGELOG.md` is in `DEFAULT_FILES` (`src/qa/completeness-claim-checker.ts:213`) and `.github/workflows/ci.yml:233-234` runs QA-15 unconditionally. The markers are on a blocking path, not decorative.
- `cmd=` remains a symbolic name resolved only against the frozen allowlist; an unknown name fails closed without executing (code-traced, `verifyMarkerClaim`). The new entries do not widen that boundary — all three are `node src/qa/marker-corpus-probe.ts` with a fixed flag.
- Probe latency 277-290 ms over 3 runs, against the runner's 60 s budget — roughly 200x headroom, no CI-timeout flake risk from the new subprocess test.

**Verdict: SURVIVES.** Issue #150's stated scope is met. Closing.

Two defects *introduced by* this fix are findings 2 and 3 below. They are new problems, not #150 reopened.

---

## Issue #154 — the mechanism judgement is right; the number is wrong again. Staying open.

### (a) Is "disclosed, no code fix" still defensible now the real number is known? Yes — I endorse it.

I checked the risk direction rather than accepting it. Every one of the 6 distinct leak pairs in the corpus surfaces as a **blocking `unresolved-authority`** in the real gate run — loud, in the output, with the offending number printed. Zero of them are silent false-verifies:

```
$ node src/qa/reference-resolver.ts c598312 HEAD
[QA-14 reference-resolver] FAIL: 35 of 1008 citation(s) failed to resolve; 164 more unclassified (non-blocking).
  - [unresolved-authority] #000  — Issue #0 does not exist in this repository      (x3)
  - [unresolved-authority] #9999 — Issue #9999 does not exist in this repository   (x3)
GATE_EXIT=1
```

The two alternatives are both worse, and this is not hypothetical reasoning — R3-R6 of this very story exist because the denylist approach failed:

- A word list reintroduces the unbounded-enumeration failure mode the redesign deleted.
- Dropping comma continuation entirely silently un-verifies every genuine comma-joined citation list — a *silent* loss of verification, the direction this project's design explicitly refuses.

Incidence is 3.6% of the continuation-marked population, the failure is loud, and it is pinned by a regression test. **Shipping it disclosed is the right call.** I am not gating on the mechanism.

### (b) Does the corrected figure hold at the shipping commit? No. Measured, at `4896420`:

```
CLASSIFICATION COUNTS (instrumented shipped classifier, 220 tracked scanned files):
  {"already-recorded":2112,"direct-marked":284,"continuation-marked":412,"unmarked":1611}

continuation-marked occurrences ........................ 412   (published: 400)
of which the number does not exist as a real issue ...... 15   (published: 10)
distinct (file,number) leak pairs ........................ 6   (published: 5)
real gate run, blocking findings that are this residual .. 6 of 35   (published: 5 of 33)
```

The six pairs, by occurrence count:

```
docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md  #9999   x5   <- NEW this round
docs/reviews/qa14-marker-redesign-red-team-2026-09-11.md         #9999   x4
docs/reviews/qa14-marker-redesign-red-team-2026-09-11.md         #000    x2
docs/decisions.md                                                #000    x2
docs/REVIEW_LOG.md                                               #9999   x1
docs/REVIEW_LOG.md                                               #000    x1
```

The mechanism is exactly the one round 2 named: **the act of documenting the residual creates instances of it.** The round-2 red-team report — the document that established the 10-of-400 figure — is itself the file that invalidated it, contributing 5 new #9999 occurrences the moment it became tracked.

Where the stale figure now ships, verbatim:

| Location | Claim |
|---|---|
| `src/qa/reference-resolver.ts:172-176` | "400 continuation-marked occurrences, 10 of which (5 distinct file/number pairs) ... 5 of this branch's own 33 real blocking gate failures" |
| `src/qa/reference-resolver.test.ts` | residual-test comment, same figure |
| `CHANGELOG.md:46` | "400 continuation-marked occurrences full-tree, 10 of which (5 distinct file/number pairs)" |
| `docs/STATE.md:10` | same |

The comment at `src/qa/reference-resolver.ts:181-183` states the correct rule, and the round then broke it:

> "Any 'never'/'0 occurrences' claim about this residual must say so plainly and be **re-measured before being repeated**, not asserted from memory — this project has now had to correct this exact shape of claim on this file three rounds running."

Four rounds running, now. And the mechanism to stop it existed **in the same commit**: the round-2 build disclosed the post-commit-re-measurement lesson at `CHANGELOG.md:47` and built `--field` plus live markers for #150 — then applied neither to #154.

### (c) Is the #9999 case now correctly disclosed? Partially — counted, never named, and the count is wrong.

Round 2's specific complaint was that #9999 appears nowhere in the close-out. At `4896420` it is *numerically* folded into "5 distinct file/number pairs" — a grep for that number across `CHANGELOG.md`, `docs/STATE.md` and `src/qa/reference-resolver.ts` returns no disclosure hit (only unrelated test fixtures in `reference-resolver.test.ts`). A reader still cannot tell which pairs the count refers to, and the count itself is now 6, not 5. Round 2's specific ask is not met.

**Exposure: 2 of 2 published #154 figures are wrong at the commit that ships them (occurrence figure understated 33%, gate figure understated 17%), across 4 shipped locations including 2 source/test comments. Basis: measured.**

**Current defense, honestly assessed.** The disclosure prose is good, the mechanism argument is sound, the regression test is real, and the source comment even states the rule that was then broken. What is missing is the same thing that was missing in round 2: any mechanism that keeps the number true. The project has now built that mechanism and applied it to one of the two findings in the same commit.

**Verdict: BREAKS** (MED — on the claim, not the mechanism). **Issue #154 stays open.**

**Named proof-test required:** `QA-14 (Issue #154): the comma-continuation residual's published incidence is produced by a live instrument, not typed` — add `--field=continuation-leaks` and `--field=continuation-marked` to `src/qa/marker-corpus-probe.ts`, and replace the typed sentences with live completeness markers, exactly as the #150 fix did. **Read finding 2 first** — that fix inherits the self-referential-CI-gate problem, and both should be designed together rather than shipped one at a time.

---

## New defects the round-2 fix introduced

### 2. [MED] The three live markers turn a legitimately-drifting corpus statistic into a hard CI gate that this very report will turn red.

**Scenario.** A maintainer lands any commit that adds or edits a tracked file containing bare issue-number text — a review report, a CHANGELOG entry, a `docs/STATE.md` resume point, a decisions row. The corpus statistic moves. `.github/workflows/ci.yml:233` runs `node src/qa/completeness-claim-checker.ts`, which re-runs the probe and compares against the expect values in `CHANGELOG.md`. The job exits 1. The commit is unrelated to QA-14.

**Measured drift sensitivity — a single review report moves all three numbers:**

```
BASE (all 220 tracked scanned files)          : marked=430 unmarked=456 total=886
WITHOUT docs/reviews/...red-team-round2....md : marked=424 unmarked=448 total=872
DELTA from that ONE file                      : marked +6  unmarked +8  total +14
```

**Measured historical volatility** — the probe replayed over the last 20 commits (content read via `git show <sha>:<file>`, enumeration via `git ls-tree <sha>`). Restricting to the window where the classifier itself was unchanged (`89c7acd`..`c598312`, 8 transitions), **4 of 8 transitions changed at least one of the three numbers**:

```
89c7acd marked=322 unmarked=318 total=640 files=206
3b8d3eb 322/318/640  same
6f61d44 322/318/640  same
d05ca33 322/318/640  same
bc2b984 331/329/660  CHANGED
7cd9a16 344/363/707  CHANGED
12f6ac7 358/392/750  CHANGED
c944362 358/392/750  same
c598312 358/393/751  CHANGED      <- classifier redesign begins after this point
f1f6fd8 367/411/778  CHANGED
64a18ed 368/418/786  CHANGED
95e3a21 422/427/849  CHANGED
4896420 430/456/886  CHANGED
```

**Demonstrated against this very report** — see the closing addendum: committing this file alone breaks all three markers.

**Current defense, honestly assessed.** It fails loud, it fails fast, and the remedy is a one-line edit — genuinely the safe direction, and the direction this project prefers everywhere else. But the remedy is *replace the number with whatever the instrument just printed*, every time. That makes these three markers assert nothing: there is no invariant behind them, only a value that legitimately changes with every docs commit. Contrast `qa-mutation-shell expect=53`, where a change in the number means something is actually wrong. Worse, it trains the reviewer reflex this whole story exists to break: see a red number, overwrite it, move on. A marker whose only failure mode is "the corpus grew" is a rubber-stamp generator wired into CI.

**Exposure: ~50% of commits (4 of 8 measured transitions in the constant-classifier window) change at least one of the three published numbers and turn CI's QA-15 step red. Basis: measured.**

**Verdict: BREAKS** (MED — loud, fully reversible, zero silence; held below HIGH by exactly those three properties).

**Named proof-test required:** `QA-15: the marker-corpus figure survives a docs-only commit` — a test that adds a synthetic tracked doc containing bare issue-number text and asserts the QA-15 run still passes. It fails today, which is the point. The design fix is to publish an *invariant* rather than a raw count: a marker over something that should not drift (e.g. a `shadowed-pairs` field expected at 0, the #152 invariant, which is stable and meaningful), and to state the raw corpus triple with its measurement commit as ordinary prose. This is the same design decision the #154 fix needs, which is why the two belong together.

### 3. [MED] The `--field` output path — the exact thing round 2 fixed — has no test that fails when it breaks.

**Mutation M1**, run in the isolated worktree at `4896420`: suppress the `--field` output branch so the probe falls back to the round-1 human-readable summary — i.e. reintroduce the precise defect round 2 was fixing (last integer in stdout becomes `filesScanned`, not the published figure).

```
$ node --test src/qa/completeness-claim-checker.test.ts src/qa/marker-corpus-probe.test.ts
  tests 24 | pass 24 | fail 0 | skipped 0        <- ALL GREEN under the mutation

$ node --test          (full suite, in the worktree)
  under M1   : tests 727 | pass 726 | fail 1 | skipped 0
  M1 REVERTED: tests 727 | pass 726 | fail 1 | skipped 0   <- identical
```

The single failure is a worktree artefact (the `adr/` submodule is not populated in a fresh worktree, so the dogfood test's ADR citation does not resolve) — it is present with **and** without the mutation, so it is not a kill. **727 tests, zero of them detect the regression.**

The build's close-out claims: "A new end-to-end test ... proves this against a REAL subprocess (deliberately wrong `expect=0`, confirmed caught by a real re-run), not a fake runner." The subprocess is real and the test is a good test — but it only asserts that `expect=0` **mismatches**, which is true whether stdout ends in 430 or 220. It cannot distinguish the fixed code from the broken code; its assertion regex accepts any number.

**The real defense exists, just not where claimed** — CI's own QA-15 run catches it immediately and loudly:

```
$ node src/qa/completeness-claim-checker.ts      (in the M1 worktree)
[QA-15 completeness-claim-checker] FAIL: 1 of 2 file(s) had a failing completeness claim.
  - CHANGELOG.md: 3 of 4 numeric completeness claim(s) failed.
  -   MISMATCH: claim says 430, instrument "qa14-marker-corpus-probe-marked" re-run reports 220
  -   MISMATCH: claim says 456, ... reports 220
  -   MISMATCH: claim says 886, ... reports 220
EXIT=1
```

So this is a test-quality defect, not a live one. It matters because SE ADR-0005's first MUST covers boundaries of new behavior, and because round 1's Issue #149 was filed HIGH for structurally the identical gap on this same file — an untested new branch, mutation-demonstrated, shipped behavior itself correct. This is the second occurrence of that pattern inside this one story.

**Exposure: 1 of 1 new output paths added by the #150 fix; 0 of 727 tests detect its regression. Basis: measured.**

**Verdict: BREAKS** (MED). **Named proof-test:** `QA-14 marker-corpus-probe: --field prints ONLY that field's number, so it is the last integer in stdout` — spawn the probe with `--field=total` and with no flag, assert the last integer of the first equals the parsed total of the second and does **not** equal `filesScanned`. M1 must turn it red.

### 4. [LOW] `docs/decisions.md` row 66 publishes a marker-corpus triple that reproduces at no tree state.

Row 66 states `marked=422 unmarked=434 total=856` (217 files). Measured:

```
95e3a21 : 422 / 427 / 849   (217 files)
4896420 : 430 / 456 / 886   (220 files)
CHANGELOG.md:47's own disclosed pre-commit working-tree figure : 424 / 433 / 857
```

That is a fourth distinct triple, matching none of them. The row does hedge (it points at `CHANGELOG.md`'s entry for "the exact figure this round ships with"), and `docs/decisions.md` is append-only so it can never be corrected in place — which is precisely why a number that was never true should not have been written into it. Same recurrence class as finding 1, lower stakes.

**Exposure: 1 permanently-uncorrectable row. Basis: measured.** **Verdict: BREAKS** (LOW). No executable form; the residual register is the right home.

### 5. [LOW] Round-2 finding 8 not fixed: the probe still mislabels what it counts, and now does so with CI-verified authority.

`src/qa/marker-corpus-probe.ts:140` still prints "approx 51% of this repo's **bare #N occurrences**". It counts distinct (file, raw) pairs — `scanReferences` dedupes per file, as the probe's own test pins. Occurrence-level truth at `4896420`, from the instrumented classifier:

```
bare #N occurrences = direct-marked 284 + continuation-marked 412 + unmarked 1611 = 2307
unmarked share = 1611 / 2307 = 69.8%          (the probe reports 51%)
```

`CHANGELOG.md:47` repeats the phrasing. The numbers 430/456/886 are correctly *defined* (distinct per-file citations) and now CI-verified — which makes the mislabel worse, not better: a reader now sees a machine-checked number attached to a description of a different quantity.

**Verdict: BREAKS** (LOW, labelling). Fix is one phrase in the summary string (occurrences -> distinct per-file citations) plus the matching CHANGELOG clause.

### 6. [LOW] Round-2 finding 7 still open (correctly out of round-2 scope): a Milestone word-form list verifies its next member as an Issue.

`src/qa/reference-resolver.ts:327` is unchanged — the already-recorded branch's guard matches both `issue` and `milestone` and seeds `state.lastMarkedListEnd` for both, so a Milestone word-form opens list continuation and the next number is verified against the **Issue** namespace. `MILESTONE_CANDIDATE_RE`'s own comment names this as the thing that must never happen. Measured corpus incidence 0; `master` behaves identically, so it is not a regression against the merge target. No test pins it either way. Re-stated, not re-litigated — round 2's triage correctly scoped this out.

**Verdict: BREAKS** (LOW, latent). **Named proof-test:** `QA-14: a Milestone word-form list must not verify its next member as an Issue (separate numbering namespace)`.

### 7. [LOW] The probe's positional ref argument produces figures for a tree state that never existed.

`src/qa/marker-corpus-probe.ts:107/114/121` — the positional argument selects the **file list** from that ref (`resolveChangedFiles(git, zeroSHA, ref)`) but the content is read from the **working tree** (`readFile(file)`). Passing an old SHA therefore reports old-file-list crossed with current content: a number describing no commit. Round 2 used this affordance and got "213 files" at `64a18ed`. In an instrument built specifically to stop unreproducible figures, an argument that manufactures them is a footgun. Not exercised by any marker (all three use the default ref), so incidence today is zero.

**Verdict: BREAKS** (LOW, code-traced). Fix: read content via `git show <ref>:<file>` when a ref is given, or reject a non-HEAD ref.

---

## What survived

| # | Attack | Result |
|---|---|---|
| S1 | **#150's published figure reproduces exactly** — 430/456/886 over 220 files, by four routes: the shipped probe's default mode, its three `--field` modes, my own independent `git ls-tree` reimplementation, and a pristine detached worktree at `4896420`. | **SURVIVES** |
| S2 | **QA-15 genuinely catches a wrong expect, verified by me, not taken on claim** — `expect=0` gives FAIL with "re-run reports 430" and exit 1; `expect=886` in the same file passes. Both directions, one invocation. | **SURVIVES** |
| S3 | **The markers are on a real blocking path** — `CHANGELOG.md` is in `DEFAULT_FILES` (`completeness-claim-checker.ts:213`) and `ci.yml:233` runs QA-15 unconditionally; three live markers present at `CHANGELOG.md:47`. Not decorative. | **SURVIVES** |
| S4 | **The allowlist security boundary is not widened** — all three new `KNOWN_INSTRUMENTS` entries are `node src/qa/marker-corpus-probe.ts` plus a fixed flag; `cmd=` stays symbolic; an unknown name fails closed without executing. | **SURVIVES** |
| S5 | **#154's residual fails in the safe direction, verified not assumed** — all 6 leak pairs surface as loud blocking `unresolved-authority` in the real gate run; zero silent false-verifies. The no-code-fix architectural argument holds. | **SURVIVES** |
| S6 | **#150's root cause is correct** — the untracked-to-tracked `git ls-tree` visibility gap reproduces: my own enumeration confirms untracked files are invisible, so any mid-build measurement undercounts. | **SURVIVES** |
| S7 | **No CI-timeout flake from the new subprocess test** — probe runs in 277-290 ms over 3 runs against the runner's 60 s budget. Full QA-15 takes 22 s, dominated by pre-existing instruments. | **SURVIVES** |
| S8 | **Gates reproduce exactly** — typecheck exit 0, lint exit 0, `npm test` 727 tests / 727 pass / 0 fail / **0 skipped**, `completeness-claim-checker` PASS exit 0. Every claimed count confirmed. | **SURVIVES** |
| S9 | **Working-tree integrity held** — md5 pinned on 5 files before and after, identical; `git status` clean throughout; every mutation confined to a detached worktree. | **SURVIVES** |

---

## Editorial (verdict-neutral, plain edits, no re-review)

- `CHANGELOG.md:38` discloses the self-referential-drift limit ("this very entry's own bare-#N mentions shift the count again with each edit") for the full-tree reference-resolver figures, but the same entry's sibling claim at line 46 carries no such caveat. One sentence, copied across, would have made finding 1 a disclosed limit rather than a false number.
- `CHANGELOG.md:47`'s description of the round-1 registration as a gap that "could never have been marker-verified" is accurate and is the clearest sentence in the close-out. Worth keeping as the template for how a correction should read.
- `src/qa/reference-resolver.ts:181-183`'s "must be re-measured before being repeated" rule is correct and belongs somewhere enforceable, not in a comment above the code it failed to protect.

---

## Open findings and failing tests

7 open findings, 0 suspicions. Executable forms — 5 of 7 map to a named test; 2 are claim/labelling corrections with no executable form (stated, not hidden):

| Finding | Named failing test |
|---|---|
| 1 (MED, #154 incidence stale again) | `QA-14 (Issue #154): the comma-continuation residual's published incidence is produced by a live instrument, not typed` |
| 2 (MED, self-referential CI marker) | `QA-15: the marker-corpus figure survives a docs-only commit` |
| 3 (MED, --field untested) | `QA-14 marker-corpus-probe: --field prints ONLY that field's number, so it is the last integer in stdout` |
| 6 (LOW, milestone continuation) | `QA-14: a Milestone word-form list must not verify its next member as an Issue (separate numbering namespace)` |
| 7 (LOW, probe ref affordance) | `QA-14 marker-corpus-probe: a non-HEAD ref reads that ref's CONTENT, never the working tree's` |
| 4 (LOW, decisions row 66 triple) | No executable form — append-only row, permanently uncorrectable; residual-register line. |
| 5 (LOW, probe label) | No executable form — a one-phrase correction in the summary string and the CHANGELOG clause. |

---

## The single scariest unproven assumption

**That wiring a drifting number into a blocking CI gate makes it trustworthy.** The #150 fix is real work and it closed the gap it was given. But it closed it by pinning three values that legitimately change on roughly half of all commits, into a gate that fails the build when they do — and the only available remedy is to overwrite the number with whatever the instrument just printed. That is the rubber-stamp reflex this entire story exists to break, now with CI enforcing it on a schedule. Meanwhile the #154 figure, which had the same problem and the same available cure sitting in the same commit, was left as typed prose and went stale before the commit landed. The project has now built the right mechanism and aimed it at the wrong quantity. The durable fix is to publish an **invariant** under a marker — a shadowed-pairs count expected at 0 is stable, meaningful, and would have caught the #152 HIGH — and to leave raw corpus counts as prose stamped with the commit they were measured at.

**Go/no-go: go.** No HIGH. The shipped mechanism is sound, the residual fails loud, every gate reproduces, and both round-2 findings were worked in good faith with real instrumentation. What remains is claim accuracy plus one self-inflicted CI hazard that announces itself the moment it fires.

**Single next action:** design findings 1 and 2 together — replace the three raw-count markers with one invariant marker, add a continuation-leaks field to the probe, and restate both raw triples as commit-stamped prose. One change closes both and stops the fifth recurrence.

---

## Addendum — finding 2, demonstrated against this report

The probe's own `computeMarkerCorpusStats`, run over the current tracked set and over the same set plus this file:

```
TRACKED NOW (220 files)      : {"marked":430,"unmarked":456,"total":886}
+ this round-3 report (221)  : {"marked":432,"unmarked":459,"total":891}
```

All three `CHANGELOG.md` markers (`expect=430/456/886`) mismatch the moment this report is committed. `node src/qa/completeness-claim-checker.ts` will exit 1 and `.github/workflows/ci.yml`'s QA-15 step will fail on a commit whose only content is a review report. Finding 2 is not predicted; it is scheduled.

(Measured before this addendum was appended — appending it moves the numbers again, which is the finding restating itself.)

---

## Issue filing (self-performed, same turn)

| Finding | Action |
|---|---|
| 1 (MED, #154 stale figure) | Issue #154 **REOPENED** with the measurement. It had been closed `completed` by `cross-domain-reviewer` at 19:58 UTC, minutes before this pass finished; I agree with its mechanism judgement and disagree with the closure on the number. Reopened rather than duplicated, per CLAUDE.md Issue Discipline. |
| 2 (MED, self-referential CI marker) | Issue #155 filed — `bug`, `severity:med`, `qa`, milestone S6. |
| 3 (MED, `--field` untested) | Issue #156 filed — `bug`, `severity:med`, `qa`, milestone S6. |
| #150 | Confirmed resolved; left closed, confirming comment added. |
| 4, 5, 6, 7 (LOW) | No Issue per CLAUDE.md; residual-register lines. |

---

```
RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Issue #154's corrected figure is stale at the commit that ships it - published "10 of 400 / 5 of 33" in reference-resolver.ts:172-176, reference-resolver.test.ts, CHANGELOG.md:46 and STATE.md:10; instrumented shipped classifier over 220 tracked files measures 15 leaks of 412 continuation-marked (6 distinct file/number pairs) and the real gate run shows 6 of 35 blocking findings are that residual; the round-2 report that established 10/400 is itself the file that invalidated it (+5 occurrences); 4th recurrence, and the cure (--field + live marker) shipped in the same commit for #150 but not here. Issue stays OPEN.
2. [ISSUE][MED][demonstrated] The #150 fix wires three raw corpus counts (expect=430/456/886) into an unconditional CI gate over a self-referential corpus: one review report moves them +6/+8/+14, 4 of 8 constant-classifier commit transitions changed at least one, and committing THIS report alone yields 432/459/891, failing QA-15 and reddening CI on a docs-only commit. Loud and reversible, but the only remedy is overwriting the number with whatever the instrument printed - a marker with no invariant behind it.
3. [ISSUE][MED][demonstrated] The --field output path, the exact defect round 2 fixed, is pinned by no test: mutation M1 (suppress --field emission, reverting last-integer to filesScanned) leaves the suite green - 24/24 on the two touched files, and full-suite 726/1 identical with and without M1 (the 1 is a worktree ADR-submodule artefact). The claimed end-to-end test only asserts expect=0 mismatches, which holds at 430 and at 220. CI's real QA-15 run does catch it, so the defense exists, just not where claimed; SE ADR-0005 boundary MUST, same shape as round 1's HIGH #149.
4. [ISSUE][LOW][demonstrated] docs/decisions.md row 66 publishes marked=422/unmarked=434/total=856 (217 files) - a fourth distinct triple matching no measured state (95e3a21=422/427/849, 4896420=430/456/886, the CHANGELOG's own pre-commit figure=424/433/857); append-only, so permanently uncorrectable.
5. [ISSUE][LOW][demonstrated] Round-2 finding 8 unfixed: marker-corpus-probe.ts:140 still says "% of this repo's bare #N occurrences" while counting distinct per-file pairs; occurrence-level truth is 1611/2307 = 69.8% against the published 51%, now carrying CI-verified authority.
6. [ISSUE][LOW][code-traced] Round-2 finding 7 unchanged (correctly out of round-2 scope): reference-resolver.ts:327's guard still seeds list continuation from a Milestone word-form, so the next number is verified against the Issue namespace - the conflation MILESTONE_CANDIDATE_RE's own comment forbids. Measured incidence 0, identical on master, no test either way.
7. [ISSUE][LOW][code-traced] marker-corpus-probe.ts:107/114/121 - the positional ref selects the file LIST from that ref but reads CONTENT from the working tree, so any non-HEAD invocation reports a tree state no commit contains; an unreproducible-figure generator inside the instrument built to stop them. Not exercised by any marker today.
8. [CLEAN][demonstrated] Issue #150's published figure reproduces exactly - 430/456/886 over 220 files by four routes: shipped probe default mode, its three --field modes, my own independent git-ls-tree reimplementation, and a pristine detached worktree at 4896420.
9. [CLEAN][demonstrated] QA-15 genuinely catches a wrong expect, verified by me not taken on claim: expect=0 -> FAIL "instrument re-run reports 430", exit 1; expect=886 in the same file passes. Both directions, one invocation.
10. [CLEAN][demonstrated] Issue #154's residual fails in the SAFE direction, verified not assumed - all 6 leak pairs surface as loud blocking unresolved-authority in the real gate run, zero silent false-verifies; the no-code-fix architectural argument (word list = the deleted denylist failure mode; dropping comma continuation = silent loss of verification) holds and I endorse it.
11. [CLEAN][demonstrated] Issue #150's root cause is correct - the untracked-to-tracked git ls-tree visibility gap reproduces; a mid-build measurement structurally undercounts.
12. [CLEAN][demonstrated] Gates reproduce exactly - typecheck exit 0, lint exit 0, npm test 727/727 pass 0 fail 0 skipped, completeness-claim-checker PASS exit 0.
13. [CLEAN][demonstrated] No CI-timeout flake from the new real-subprocess test - probe 277-290 ms over 3 runs against the runner's 60 s budget; full QA-15 22 s, dominated by pre-existing instruments.
14. [CLEAN][demonstrated] Working-tree integrity held - md5 pinned on 5 files before and after (identical), git status clean throughout, every mutation confined to a detached git worktree rather than the shared tree.
15. [CLEAN][code-traced] The three markers are on a real blocking path - CHANGELOG.md is in DEFAULT_FILES (completeness-claim-checker.ts:213) and ci.yml:233-234 runs QA-15 unconditionally; markers live at CHANGELOG.md:47. Not decorative.
16. [CLEAN][code-traced] The allowlist security boundary is not widened - all three new KNOWN_INSTRUMENTS entries are node src/qa/marker-corpus-probe.ts plus a fixed flag, cmd= stays symbolic, an unknown name fails closed without executing.
counts (CHECKSUM): issues=7 suspicions=0 clean=9
evidence (CHECKSUM): demonstrated=12 code-traced=4 derived=0
checks=npm test: tests 727 | pass 727 | fail 0 | skipped 0; npm run typecheck exit 0; npm run lint exit 0; node src/qa/completeness-claim-checker.ts PASS exit 0 (21.9s); wrong-expect proof: same checker on a scratch marker file -> FAIL exit 1 "claim says 0 ... reports 430" while expect=886 passes; node src/qa/reference-resolver.ts c598312 HEAD -> FAIL 35 of 1008, exit 1 (28 unresolved-authority + 5 unparseable + 2 cross-repo); mutation M1 in a detached worktree -> 24/24 green on the two touched test files, full suite 726/1 identical with and without (1 = worktree submodule artefact), CI QA-15 in the same worktree -> FAIL exit 1 on all 3 markers; instrumented shipped classifier (4 added lines, diff-proofed) over 220 tracked files + 87 real gh issue-existence lookups; probe replayed over the last 20 commits via git ls-tree/git show
adr=HIT(35)
report=docs/reviews/qa14-marker-redesign-red-team-round3-2026-09-11.md
```
