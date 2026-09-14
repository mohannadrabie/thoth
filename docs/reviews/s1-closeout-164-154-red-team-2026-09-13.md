# Red Team (Sutekh) — `s1-closeout-164-154` (Issues #164 + #154)

- **Date:** 2026-09-13
- **Target:** branch `fix/s1-closeout-164-154` @ `b9fed71` (parent `master` @ `ad196c5`); diff scope `src/qa/marker-corpus-probe.ts`, `src/qa/marker-corpus-probe.test.ts`, `CHANGELOG.md`, `docs/STATE.md`
- **Tier:** CRITICAL (ratified — `docs/run-log.jsonl:37`, `tier-ratified`, `2026-09-13T23:08:44.544Z`, verified present)
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]`
- **Verdict:** **go** — 3 MED issues filed, 1 LOW suspicion, 9 attacks survived. No HIGH.

## ADR slice read (attack surface: code correctness, evidence integrity, failure modes)

From `adrCatalog.adrs` in `docs/.maat-state.json`, filtered to this diff's surface: SE ADR-0004 (idempotency by default), ADR-0005 (testing strategy), ADR-0010 (code quality gates), ADR-0003 (SOLID), ADR-0006 (blast radius control), ADR-0021 (thoth-native architecture, kernel/evidence trail). No ADR rule is violated: the change deletes a parameter, adds one real-subprocess regression test, and touches no kernel, normalizer, gate surface, or evidence-trail component. ADR-0004's idempotency rule is better served after the change (output no longer depends on argv). ADR fingerprint `83b2e3e` unchanged by this diff.

## Scope shapes I am NOT attacking, and why (stated, not skipped)

- **Partial apply / resource-N-of-M.** N/A, honestly. This change ships no resource, no deploy, no migration, no runtime surface. There is no apply to die halfway through, no orphan to leak. Manufacturing an attack here would be noise.
- **Concurrency / racing pipelines / crashed-run locks.** N/A. The instrument is a short-lived, read-only, single-process CLI with no lock, no shared mutable state, no write path. Two concurrent runs are two independent reads of the same tree.
- **Provider throttling / quota / eventual consistency / AZ degradation.** N/A — no cloud provider in this diff's path. The one network dependency in the neighbouring instrument (`gh` in `continuation-residual-probe.ts --field=continuation-residual`) is already capped by `QA14_MAX_ISSUES` and fails loud; I exercised it, see attack 9.
- **Hostile lens** is NOT N/A and is attacked below (attack 13).

---

## Attacks, ranked by blast radius

### 1. [ISSUE][MED][demonstrated] The ref/content-mismatch bug is narrowed, not closed — the file LIST still comes from HEAD while CONTENT comes from the working tree, and the shipped comment asserts otherwise

**Scenario.** A maintainer follows this repo's own workflow: adds a new `docs/reviews/<scope>-<agent>-<date>.md` (dense with bare-hash citations), then, before committing, runs `node src/qa/marker-corpus-probe.ts --field=total` to publish a corpus figure in `CHANGELOG.md`. The probe silently excludes the new file. The published number is wrong, exit code 0, no warning. This is the same list/content skew class as Issues #164 and #161, narrowed from "any ref" to "HEAD vs. a dirty tree".

**Current defense, honestly assessed.** None. `collectFullTreeFileTexts` (`src/qa/marker-corpus-probe.ts:124-139`) calls `resolveChangedFiles(git, <zero-sha>, "HEAD")`, which routes to `git.lsTree("HEAD")` (`src/lib/git.ts:52-57`, `:82-84`) — HEAD's tracked blobs — then reads each path's bytes from disk with `readFile` (`:133`). The two halves come from two different tree states, which is the defect's definition. The comment added by this diff at `src/qa/marker-corpus-probe.ts:42-44` states the opposite: "`main()` always resolves both the file list AND the content from the current working tree". The list half of that sentence is false.

**Raw evidence** (throwaway worktree at `b9fed71`, shipped code, main tree untouched):

```
restored to shipped code
=== baseline (clean tree) ===
[QA-14 marker-corpus-probe] PASS: total=989
=== (1) modify a TRACKED file in the working tree: append 3 bare hash-N ===
[QA-14 marker-corpus-probe] PASS: total=992
=== (2) revert that, instead add an UNTRACKED new file with the same 3 bare hash-N ===
[QA-14 marker-corpus-probe] PASS: total=989
=== git sees the untracked file? ===
?? docs/zz-untracked-probe-file.md
```

Content is read from the working tree (992). The list is not (989 — three identical citations, invisible, because the file is not a blob at HEAD).

How often that state exists, measured over real history:

```
commits examined: 60 ; commits adding >=1 new .md/.ts/.mjs/.yml/.json file: 32
pct: 53%
```

`Exposure: ~100% of probe runs executed in a tree holding uncommitted new scannable files; ~53% of the last 60 non-merge commits created such a window, basis: measured (git history + shouldScanFile, which excludes only *.test.ts per src/qa/reference-resolver.ts:534-536, so the real figure is a floor)`

**Verdict: BREAKS** (as a claim; the code shape is inherited from the shipped Issue #161 precedent, but this diff newly asserts the defect is closed).

**Named proof-test required:** `marker-corpus-probe.test.ts` -> "QA-14 marker-corpus-probe: a scannable file present in the working tree but absent from HEAD is either counted or loudly disclosed — the file list and the content must come from the SAME tree state". Minimal fix: enumerate the working tree so both halves agree, or read content from HEAD blobs (`git cat-file`), or, cheapest, correct `:42-44` to say the list is HEAD's tracked blobs and file the skew as the disclosed residual it is.

---

### 2. [ISSUE][MED][demonstrated] A stray positional argument is now silently swallowed — and the exact ref-passing invocation is copy-pasteable out of this repo's own committed review reports

**Scenario.** The next auditor (or the `/maat:audit` pass on this very story) re-runs the documented repro to confirm Issue #164 is fixed, copying the command verbatim from `docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md:205` (`node src/qa/marker-corpus-probe.ts 64a18ed`). They get a number, exit 0, no warning, and read it as "the count at 64a18ed". It is the working-tree count. The machine is now self-consistent; the human is misled exactly as before, because nothing tells them their argument was ignored.

**Current defense, honestly assessed.** None, and it contradicts the file's own convention. `parseMarkerCorpusField` deliberately throws on a bad `--field` value ("fails loud, not silently ignored", `:75-84`); the neighbouring instrument fails loud on cap exhaustion rather than degrading silently (`continuation-residual-probe.ts:242-253`). Positional arguments, and unknown flags, get the opposite treatment. The new regression test actively pins the silent behavior as desired ("a positional argument must have zero effect").

**Raw evidence:**

```
=== no arg ===
[QA-14 marker-corpus-probe] PASS: total=989
exit=0
=== stray a26e55a ===
[QA-14 marker-corpus-probe] PASS: total=989
exit=0
=== stray garbage ref (not-a-ref-at-all) ===
[QA-14 marker-corpus-probe] PASS: total=989
exit=0
=== stray HEAD~5 ===
[QA-14 marker-corpus-probe] PASS: total=989
exit=0
=== unknown flag (--bogus-flag) ===
[QA-14 marker-corpus-probe] PASS: total=989
exit=0
```

Committed copy-paste sources (grep, this repo):

```
docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md:205:node src/qa/marker-corpus-probe.ts 64a18ed
docs/reviews/qa14-marker-redesign-cross-domain-round2-2026-09-11.md:235: node src/qa/marker-corpus-probe.ts HEAD -> 422/427/849
docs/reviews/qa14-marker-redesign-red-team-round5-2026-09-11.md:109:node src/qa/continuation-residual-probe.ts --field=continuation-marked a26e55a
docs/reviews/qa14-marker-redesign-red-team-round6-2026-09-11.md:212:node src/qa/continuation-residual-probe.ts --field=continuation-marked a26e55a -> continuation-marked=281
```

`Exposure: ~100% of invocations that pass any positional argument; the single most likely such invocation is the next auditor re-running the documented Issue #164 repro, basis: counted in code (argv is read only by parseMarkerCorpusField, marker-corpus-probe.ts:143-144) + measured (4 committed copy-paste sources)`

**Verdict: BREAKS** (the human-facing half of Issue #164's harm is still reachable).

**Named proof-test required:** `marker-corpus-probe.test.ts` -> "QA-14 marker-corpus-probe: an unrecognized argv token (positional or unknown flag) exits non-zero with a message naming it — never a silent working-tree answer". Fix is roughly 3 lines in `main()`: reject any argv token that is not `--field=...`, same throw-shape `parseMarkerCorpusField` already uses. The shipped twin (`continuation-residual-probe.ts`) has the identical gap — that half is a backlog line, not this diff.

---

### 3. [ISSUE][MED][demonstrated] Issues #164 and #154 were closed COMPLETED 76 seconds BEFORE the commit that fixes them was authored, on an unpushed branch, before Stage 3 review

**Scenario.** This review returns REWORK (or the Manager's verify stage does). The GitHub record says both issues are done, `state_reason: completed`, with a closing comment asserting verification. Milestone S1 rolls up as closed-out. The only thing that would reopen them is somebody remembering to.

**Current defense, honestly assessed.** None operating. `CLAUDE.md` Issue Discipline #2 is explicit: "An issue closes ONLY when its work is genuinely done: shipped and verified ... Link the commit/PR that closes an issue with a `Closes #N` ... so the closure is tied to a real artifact, not a manual status flip with nothing behind it." The commit does carry `Closes #164, closes #154`, which is the correct mechanism and would have closed them automatically on merge. The manual pre-close is what defeats it.

**Raw evidence:**

```
=== issue 164 ===
state=CLOSED reason=COMPLETED closedAt=2026-09-13T23:29:43Z
=== issue 154 ===
state=CLOSED reason=COMPLETED closedAt=2026-09-13T23:29:54Z
=== commit author/commit dates ===
authored=2026-09-13T19:30:59-04:00 committed=2026-09-13T19:30:59-04:00   (== 23:30:59Z)
=== is b9fed71 on any remote branch? ===
(empty = unpushed/unmerged)
```

`23:29:43Z` precedes `23:30:59Z` by 76 seconds. The branch is unpushed, unreviewed, unmerged, and CI has never run on it.

`Exposure: 2 of 2 issues in this story's scope; 100% of this story's GitHub tracking record, basis: measured (gh closedAt vs git author date)`

**Verdict: BREAKS** (process/traceability, not code).

**Named proof-test required:** none is executable — this is a state correction, and I say so rather than invent a test (PRINCIPLES rule 19's explain-the-gap clause). Unlock: `gh issue reopen 164 154` with a `[red-team]`-prefixed comment naming "closed pre-review; the commit's own Closes-N will close them on merge", then let the merge close them. Open findings 3 / failing tests 2 — this is the finding with no executable form.

---

### 4. [SUSPICION][LOW][demonstrated] The suite reported a full green while registering one fewer test than it does on every subsequent run

**Scenario.** A build receipt records "npm test 773/773 pass, 0 fail, 0 skipped" and every reader treats it as the full suite. One test never registered. A missing test is invisible in exactly the way a failing one is not — this project's own DoD says skipped is never passed, and an unregistered test is worse than skipped because it is not even counted.

**Raw evidence.** All four runs below are the identical clean tree at `b9fed71`, `git status --porcelain` empty, main checkout:

```
run 1 (first of session):        tests 773  pass 773  fail 0  cancelled 0  skipped 0
run 2:                           tests 774  pass 774  fail 0  cancelled 0  skipped 0
run 3:                           tests 774  pass 774  fail 0  cancelled 0  skipped 0
run 4 (after worktrees removed): tests 774  pass 774  fail 0  cancelled 0  skipped 0
```

I tested and rejected the obvious mechanism (my own `git worktree add` altering a dynamically-generated test count — run 4 removed them and the count stayed 774). I could not reproduce the 773 on demand. It matches a previously-recorded anomaly on these same instruments (`docs/REVIEW_LOG.md:97`: "a one-off different value on this session's first cold invocation only, stable on all repeats after — no code-level mechanism found"), and it pre-dates this diff.

`Exposure: 1 of 4 observed runs in this session; unknown in CI, basis: measured (4 runs) for the observation, assumption for the mechanism`

**Verdict: UNPROVEN.** I will not convert an unreproducible one-off into a blocker. Settling command for whoever reproduces it next: run `node --test --test-reporter=tap` on a cold checkout twice and diff the emitted test-name sets. Runnable by any maintainer.

---

### 5. [CLEAN][code-traced] Is the `ref` deletion actually complete, or is there a residual code path?

Complete. Every `argv` read in the file:

```
143:  const argv = process.argv.slice(2);
144:  const field = parseMarkerCorpusField(argv);
175: if (process.argv[1] === fileURLToPath(import.meta.url)) {
```

`collectFullTreeFileTexts` is module-private (not in the export set: `MarkerCorpusField`, `parseMarkerCorpusField`, `MarkerCorpusStats`, `computeMarkerCorpusStats`) and hardcodes `"HEAD"` at `:126`. There is no second entry point, no default parameter, no env-var fallback, no dormant overload. The word `ref` survives only in comments. **SURVIVES.**

---

### 6. [CLEAN][demonstrated] Does the new regression test prove anything, or is it a tautology that would pass on the buggy code too?

It is real. I restored the pre-fix hybrid (positional ref drives the file list, content from the worktree) in a throwaway worktree and ran the new test against it:

```
MUTATION APPLIED (pre-fix hybrid restored)
--- mutated behavior ---
[QA-14 marker-corpus-probe] PASS: total=989
[QA-14 marker-corpus-probe] PASS: total=951        <- same command plus `a26e55a`
--- new regression test against MUTANT ---
FAIL: QA-14 marker-corpus-probe (real subprocess, regression): a stray positional argument no longer
changes the result — working-tree-only, the ref/content-mismatch bug is deleted not merely dormant
```

The mutant reproduces the defect (989 vs 951) and the test goes red on it. It is a real subprocess (`realRunner("node", [...])`), not a unit stub. Worktree removed, main tree verified clean afterwards. **SURVIVES.**

---

### 7. [CLEAN][demonstrated] "Zero real callers pass a ref today" — checked myself, not taken on the build receipt's grep

True, and stronger than claimed: `package.json` and `.github/workflows/ci.yml` do not invoke this probe at all. Repo-wide grep for `marker-corpus-probe` returns only `CHANGELOG.md`, `docs/.maat-state.json`, `docs/decisions.md`, 11 `docs/reviews/*.md`, `docs/REVIEW_LOG.md`, `docs/STATE.md`, and 6 `src/qa/*.ts` files — no workflow, no script, no hook, no `.claude/` command. The only programmatic invocation path is `completeness-claim-checker.ts`'s `KNOWN_INSTRUMENTS` (`:51`, `:57-59`), whose four entries pass `--field=...` and nothing else, with args owned by code rather than by marker prose. **SURVIVES.**

---

### 8. [CLEAN][demonstrated] Issue #154's scope boundary — did this story touch the comma/list-continuation classification logic the human ruled off-limits?

No. `src/qa/reference-resolver.ts` is byte-identical across the range:

```
$ git rev-parse ad196c5:src/qa/reference-resolver.ts b9fed71:src/qa/reference-resolver.ts
ac0cd1b247a9fff133b720f9c059d9249e053885
ac0cd1b247a9fff133b720f9c059d9249e053885

$ git diff --name-only ad196c5 b9fed71 -- src/
src/qa/marker-corpus-probe.test.ts
src/qa/marker-corpus-probe.ts
```

Same blob SHA, and only two files under `src/` changed at all. The ruling ("verify-and-close only, no new code", `docs/decisions.md`, 2026-09-13 "Next story picked" row, human via AskUserQuestion) was honored exactly. **SURVIVES.**

---

### 9. [CLEAN][demonstrated] Is the "fresh re-measurement" real, and is the qualitative claim ("real, non-zero, single-digit-percent, fails LOUD") true right now?

I re-measured independently rather than trusting the claim. Both commands run, current tree:

```
$ node src/qa/continuation-residual-probe.ts --field=continuation-marked
[QA-14 continuation-residual-probe] PASS: continuation-marked=293            (0.9s)

$ node src/qa/continuation-residual-probe.ts --field=continuation-residual
[QA-14 continuation-residual-probe] PASS: continuation-residual=5
  - continuation-marked=293
  - distinct issue numbers queried=130                                       (44.7s, real gh)
```

5 of 293 = **1.7%** — real, non-zero, single-digit percent of the continuation-marked population, all three as stated. "Fails LOUD" holds structurally: a residual citation carries `verdict: "unresolved-authority"`, which `summarizeCitations` counts as `bad` (`reference-resolver.ts:552`) and which drives a non-zero exit — observed directly in attack 11. The denominator has moved 281 to 293 since round 6, which is precisely why the prose points at the command instead of freezing a figure. **SURVIVES.**

> Durability note, not a finding: "single-digit-percent" is itself a qualitative bound living in permanently-scanned prose, phrased below QA-15's detection threshold, that no instrument can check. It is true today (measured). If the ratio ever crosses 10% or reaches zero, nothing in this repo will notice. The mitigation already present — naming the live command on the same line — is the right one; I flag only that the bound is uninstrumented by construction.

---

### 10. [CLEAN][demonstrated] Is there a live, unqualified "never"-class or frozen-figure claim about this residual in CHANGELOG.md / docs/STATE.md right now?

No. I ran my own strikethrough-aware per-line scan (an instrument, not an eyeball) over both files — every occurrence, with its struck status:

```
CHANGELOG.md:103 struck=True :: continuation-marked=273
CHANGELOG.md:103 struck=True :: continuation-residual=3
CHANGELOG.md:103 struck=True :: continuation-residual=3
CHANGELOG.md:109 struck=True :: continuation-residual=3
CHANGELOG.md:113 struck=True :: continuation-marked=273
CHANGELOG.md:113 struck=True :: continuation-residual=3
docs/STATE.md:55 struck=True :: continuation-marked=273
docs/STATE.md:55 struck=True :: continuation-residual=3
docs/STATE.md:62 struck=True :: continuation-marked=273
docs/STATE.md:62 struck=True :: continuation-residual=3
```

10 of 10 occurrences struck, each followed by a dated CORRECTED annotation. The story's claim reproduces. Independently, the project's own gate agrees:

```
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
exit=0
```

This is not merely a manual sweep, as the CHANGELOG modestly says: QA-15's `BARE_CLAIM_PHRASES` includes the `continuation-marked=<N>` / `continuation-residual=<N>` pattern and tests it against the strikethrough-stripped line, so a live unstruck figure would fail the gate mechanically. The claim is instrument-backed, which is what `CLAUDE.md`'s no-hand-derived-completeness rule requires. **SURVIVES.**

---

### 11. [CLEAN][demonstrated] Does this story's new prose introduce a new blocking QA-14 citation — does it make CI worse?

No. The QA-14 gate, run exactly as CI runs it on this range, fails — but the failure is entirely pre-existing text:

```
$ node src/qa/reference-resolver.ts ad196c5 b9fed71
[QA-14 reference-resolver] FAIL: 17 of 829 citation(s) failed to resolve; 112 more unclassified (non-blocking).
exit=1
```

Every one of the 17 blocking citations traces to historical evidence prose (Issue-zero, `foo.ts:42`, `ADR-003`, `.claude/settings.local.json`, `docs/reviews/_probe.md`, a cross-repo `anthropics/claude-code` issue, and so on). Token-by-token check against this story's own added lines (occurrences in added lines, then token):

```
0  Issue#0                 0  settings.local.json     0  _probe.md
0  report-subject-gate     0  fullstack/plugin.json   0  test-guard.sh
0  ADR-003                 0  ADR-007                 0  ADR-12
0  foo.ts:42               0  claude-code#6574        0  #000
0  errorlevel.html
```

Zero hits — none of the blocking strings appear in a line this story added. And every issue number this story did cite resolves to a real issue (63 OPEN, 136 OPEN, 137 CLOSED, 154 CLOSED, 160 CLOSED, 161 CLOSED, 164 CLOSED, 169 MERGED). **SURVIVES.**

> **Verify-stage caveat, named so it is not skipped silently (PRINCIPLES rule 13).** CI is red on `master` and on all 12 most recent runs, failing at the `QA-14 reference-resolver` step (`gh run view 34787793955` reports that step as the failure; no `continue-on-error` on `.github/workflows/ci.yml:225-231`). This is a known, human-accepted residual (`docs/decisions.md`, 2026-09-13 Issue #126 row: "QA-14 still exits 1 in that run on the separate, disclosed residual — expected, not this Issue's concern"), it pre-dates this story, and this story adds nothing to it. It is NOT a finding against this diff. It IS a fact the Manager must not paper over at verify: the DoD line "tests green in CI" cannot be honestly checked off for this branch, and the correct wording is "green except the standing, ratified QA-14 residual".

---

### 12. [CLEAN][demonstrated] Is the 774/774 verification claim true?

Yes — and I nearly filed a false finding here, so the working is shown. My first run reported 773 (see attack 4). Baseline/head counts measured in two identical throwaway worktrees, same environment on both sides:

```
worktree @ ad196c5 (baseline):     tests 773  pass 772  fail 1   (the 1 failure is the missing adr/ submodule inside a worktree, not a real defect)
worktree @ b9fed71 (this diff):    tests 774  pass 773  fail 1   (same submodule failure)
main checkout @ b9fed71, runs 2-4: tests 774  pass 774  fail 0  skipped 0
```

Delta is exactly +1, matching "773 carried + 1 new", and corroborated independently by `docs/decisions.md`'s CI-run row recording 773/773 at `ad196c5`. The claim reproduces. **SURVIVES.**

---

### 13. [CLEAN][code-traced] Hostile lens — a compromised CI runner, and the weakest link in this instrument's trust chain

The weakest link is **`completeness-claim-checker.ts`'s `KNOWN_INSTRUMENTS` allowlist**, because it is the one component that turns attacker-editable prose (a completeness marker in `CHANGELOG.md`, which a fork PR can write) into an executed subprocess in CI. That boundary holds here and is narrowed by this diff, not widened: `cmd=` is a symbolic name resolved only against the frozen, code-owned allowlist (`:45`, `Object.freeze`), args are code-owned (`:51`, `:57-59`), and marker text never reaches `argv`. Before this change the probe read a positional token out of `argv` and handed it to `git ls-tree <ref>`; after it, that argv-to-git path is gone entirely. A compromised runner gains nothing new — the probe is read-only, makes no network call (`stubDeps.issueExists` returns `null` unconditionally, `:52-61`), and holds no credential. **SURVIVES.**

---

## Editorial (verdict-neutral, fix as plain edits, no re-review)

1. `CHANGELOG.md` — "byte-for-byte the same shape as `continuation-residual-probe.ts`'s own helper of the same name" is imprecise: the two helper bodies differ by exactly one blank line (`diff -u` of the extracted bodies). Semantically identical; "byte-for-byte" is not. In a file family repeatedly burned by over-precise claims, prefer "structurally identical apart from whitespace".
2. `CHANGELOG.md` and the commit message — "manual grep confirmed every figure sits inside a struck-through, dated correction" undersells its own evidence: QA-15's strikethrough-aware scan proves this mechanically. Credit the instrument, not the sweep.
3. `src/qa/marker-corpus-probe.ts:122-123` — the helper's own docstring ("Content is always read from the current working tree ... there is no `ref` parameter left to diverge from it") is accurate; the header comment at `:42-44` contradicts it. Fixing attack 1's wording resolves the contradiction.

---

## The single scariest unproven assumption

**That "delete the parameter" closed Issue #164, when what it closed was the machine-visible half.** The instrument is now internally consistent about content and still mixes two tree states for the list (attack 1), and it still answers a ref-bearing command with a working-tree number in total silence (attack 2) — while four committed review reports carry that exact command as copy-pasteable text. The shape of the original bug was "a number for a tree state that never existed". A human who passes `a26e55a` today still gets a number they will label `a26e55a`. Nothing shouts.

## Verdict and next action

**go.** The code change is correct, complete at the parameter level, genuinely mutation-tested, and the Issue #154 half is honest — the scope boundary was not crossed, the re-measurement reproduces, and no false claim is live. Three MED findings are filed as Issues; none is a security, data-integrity, legal or safety matter, none is irreversible, and each fix is a handful of lines or a state correction. "go" here does not mean "nothing to do" — it means none of these should hold the branch.

**Single next action:** reopen Issues #164 and #154 (`gh issue reopen 164 154`, with a comment naming "closed pre-review; the commit's own Closes-N reference closes them on merge") — the tracking record currently says shipped for work that is unpushed and unreviewed, and that is the one finding that decays if left.

---

## Addendum, same day (PRINCIPLES rule 11 — appended, nothing above edited)

- **Issues filed for this report's three BREAKS findings:** attack 1 -> #172, attack 2 -> #173, attack 3 -> #174 (each `bug` + `severity:med`, Milestone "S1 — Protect the baseline"; #172/#173 also `qa`, #174 `chore` as a process finding with no Feature ID home). Duplicate-checked against all open and closed issues before filing; none pre-existed.
- **Cross-reference on attack 4, added after reading `cross-domain-reviewer`'s parallel report:** Issue #170 ("new Issue #164 regression test is flaky under real concurrent `npm test` execution, 1 fail / 6 full-suite runs", root-caused to `src/qa/marker-corpus-probe.ts:132-136`) is a stronger, already-filed finding against the same test, from a different symptom. My attack 4 observed a missing *registration* (773 vs 774 with `fail 0`), not a failure, so the two are adjacent rather than identical — but #170 is the one with a traced root cause, and whoever settles attack 4 should start there rather than from my unreproducible one-off. I file nothing new for attack 4; it stays UNPROVEN and non-gating.
- **Tree integrity after my testing:** three throwaway `git worktree` checkouts created and all three removed (`git worktree list` shows only `C:/playground/thoth b9fed71`); the mutation was applied only inside a worktree and never in the main checkout; `git status --porcelain` on the main tree shows only this review round's own report files and `docs/REVIEW_LOG.md`. No source file was modified by this review.

---

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated] ref/content mismatch narrowed not closed - file LIST still from HEAD (git.ts:52-57) while CONTENT is worktree; untracked scannable files silently excluded (989 vs 992 demo); shipped comment marker-corpus-probe.ts:42-44 asserts both come from the worktree. Defense: none. Exposure: ~100% of runs in a tree with uncommitted new scannable files, ~53% of last 60 commits create that window, basis: measured
2. [ISSUE][MED][demonstrated] stray positional args AND unknown flags silently swallowed (not-a-ref-at-all, HEAD~5, --bogus-flag all give total=989, exit 0) while 4 committed review reports carry the ref-passing command as copy-paste text; contradicts the file's own fail-loud convention (:75-84) and the new test pins the silence as desired. Exposure: ~100% of arg-passing invocations, basis: counted in code + 4 measured sources
3. [ISSUE][MED][demonstrated] Issues #164/#154 closed COMPLETED at 23:29:43Z/23:29:54Z - 76s BEFORE the fixing commit was authored (23:30:59Z), branch unpushed/unreviewed/unmerged; violates CLAUDE.md Issue Discipline rule 2. Defense: the commit's own Closes-N was correct and was pre-empted. Exposure: 2 of 2 issues in scope, basis: measured
4. [SUSPICION][LOW][demonstrated] first suite run of the session reported tests 773 / pass 773 / fail 0 / skipped 0 on the identical clean tree where 3 later runs report 774/774 - an unregistered test reads as a full green; worktree-mutation hypothesis tested and rejected; matches a pre-existing recorded cold-run anomaly; not reproducible on demand. Exposure: 1 of 4 observed runs, basis: measured/assumption
5. [CLEAN][code-traced] ref deletion is complete - argv reaches only parseMarkerCorpusField; helper is module-private and hardcodes "HEAD"; no dormant path, no default param, no env fallback
6. [CLEAN][demonstrated] new regression test is real and mutation-catching - pre-fix hybrid restored in a throwaway worktree reproduces 989 vs 951 and the test goes RED
7. [CLEAN][demonstrated] "zero callers pass a ref" verified independently and is stronger than claimed - package.json and ci.yml never invoke the probe; KNOWN_INSTRUMENTS' 4 entries pass --field= only
8. [CLEAN][demonstrated] Issue #154 scope boundary genuinely untouched - reference-resolver.ts identical blob sha ac0cd1b across the range; only 2 files under src/ changed
9. [CLEAN][demonstrated] fresh re-measurement reproduces and its qualitative claim is true today - continuation-marked=293, continuation-residual=5 (1.7%), gh-backed, 44.7s; loud-fail path code-traced
10. [CLEAN][demonstrated] no live unqualified/"never"-class claim - own strikethrough-aware scan: 10 of 10 frozen figures struck with dated corrections; QA-15 PASS (2 files) corroborates mechanically
11. [CLEAN][demonstrated] this story introduces zero new blocking QA-14 citations - 0 of 13 blocking tokens appear in added lines; all 8 cited issue numbers exist; the standing red CI is the ratified pre-existing residual (named as a verify-stage caveat, not a finding)
12. [CLEAN][demonstrated] 774/774 pass, 0 fail, 0 skipped is true - baseline/head worktrees measure 773 then 774, delta exactly +1, reproduced 3x in the main checkout
13. [CLEAN][code-traced] hostile lens: weakest link named (KNOWN_INSTRUMENTS, the prose-to-subprocess boundary); it holds and is narrowed by this diff - the argv-to-git-ls-tree path is gone; probe is read-only, no network, no credential
counts (CHECKSUM): issues=3 suspicions=1 clean=9
evidence (CHECKSUM): demonstrated=11 code-traced=2 derived=0
checks=npm test 774/774 pass 0 fail 0 skipped (3 runs; a 4th, first-of-session run reported 773/773 pass 0 fail 0 skipped - attack 4); node --test src/qa/marker-corpus-probe.test.ts 10/10 pass 0 fail 0 skipped; MUTATION pre-fix hybrid restored in throwaway worktree gives new regression test FAIL (989 vs 951), reverted, worktree removed, main tree clean; node src/qa/completeness-claim-checker.ts PASS (2 files) exit 0; continuation-residual-probe --field=continuation-marked gives 293, --field=continuation-residual gives 5 (130 gh lookups, 44.7s); node src/qa/reference-resolver.ts ad196c5 b9fed71 gives FAIL 17 of 829 blocking + 112 unclassified exit 1 (pre-existing, 0 tokens attributable to this diff); marker-corpus-probe --field=total with no arg / a26e55a / not-a-ref-at-all / HEAD~5 / --bogus-flag gives total=989 exit 0 on all five; worktree baseline ad196c5 gives 773 tests, worktree b9fed71 gives 774 tests; strikethrough scan gives 10/10 struck; git rev-parse reference-resolver.ts blob identical across range
adr=HIT(35)
report=docs/reviews/s1-closeout-164-154-red-team-2026-09-13.md
HEAD: b9fed71c3f0b78130b1ce7fe5388596a13f17aa1
