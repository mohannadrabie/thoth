# Cross-Domain Review (Ra): s7c-reachability-residuals (Issues #334, #335), CRITICAL

HEAD: 66378338a2824874c9e3ff291615767c6fa212df (branch feat/s7c-reachability-residuals; S7-C-only diff is 1aba7df to HEAD)
Reviewer: cross-domain-reviewer (Ra). Date: 2026-09-27. Worktree used: C:\playground\thoth\.claude\worktrees\agent-a24081afb3e1c4888 (it started at another commit; I reset it to 6637833, nothing else was touched).

## Lanes and ground covered

- The plan (docs/plans/s7c-reachability-residuals-phase1-2026-09-27.md, section 8) seats `red-team` and `app-security-reviewer` alongside me. No S7-C report from either existed in docs/reviews at my run, and `docs/.maat-state.json` still carries the S7-B scope with no S7-C entry, so I could not read their lane coverage. I did not re-cover their named ground (soundness attack on the check, allow-guard bypass, message quoting). I checked the code for what falls between lanes.
- Diff (diff --stat 1aba7df HEAD): 6 files. Production: `src/policy/config/rule-reachability.ts` (scope function plus per-scope messages). Comment only: `src/policy/normalizer/tool-class-format.ts`. Test: `src/policy/config/rule-reachability.test.ts`. Records: `CHANGELOG.md`, `docs/decisions.md`, the Phase 1 plan.
- ADR step: `node docs/adr-cache.mjs --ensure` printed: 📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]. I read the whole catalog unfiltered and the rules for agents of every ADR the diff can touch.

## Cross-domain ADR verdict (whole catalog, diff vs each)

| ADR | Verdict | Basis |
|---|---|---|
| SE ADR-0002 (layers) | CLEAR | New value import KNOWN_VERBS from the normalizer directory into the config module. `src/policy/normalizer/action-catalog.ts` has no import lines (grep for a line starting with import returned nothing), so it is pure data. `node src/qa/kernel-purity-check.ts` and `node src/qa/normalizer-registry-purity-check.ts` both PASS. Same direction S7-B already ruled acceptable. |
| SE ADR-0003 (SOLID) | CLEAR | One module, small pure functions, none near 40 lines. |
| SE ADR-0005 (testing) | CLEAR | See verified claim 2: one row flipped to stricter, nothing deleted or weakened, replacement recorded in `docs/decisions.md` (pending human ratification). |
| SE ADR-0006 (blast radius) | CLEAR | The diff stat shows no file outside the plan's list. Follow-ups are in Issues (338) or backlog. |
| SE ADR-0010 (quality gates) | CLEAR with a note | tsc exit 0, eslint on the two touched source directories exit 0. Full suite: see Checks. No test deleted, no coverage threshold touched. |
| SE ADR-0021 (thoth-native) | CLEAR | Kernel, record, schema, loader and hooks are absent from the diff stat. The kernel is only called by tests. |
| THOTH-ADR-0001 (fixture) | NOT-APPLICABLE claim CONFIRMED | Scan: the 14 names in `docs/qa/s5-central-classification.json` (tools plus connectors) searched case-insensitively in the whole src diff: 0 hits. The G19 test in `src/policy/gate/gate-structure.test.ts` lists `src/policy/config/rule-reachability.test.ts` and stayed green in the full run. |
| SE ADR-0016 to 0020 (port and self-protection) | NOT-APPLICABLE | No ported-tree file touched. |
| All DevOps ADRs, SE 0001, 0004, 0007 to 0009, 0011 to 0015, THOTH-ADR-0002 | NOT-APPLICABLE | No IaC, data store, tagging or secret-scan allowlist touched. |

No ADR collision. Nothing to amend.

## Verified claims (records assert them; I ran them)

1. **Acceptance criteria map to tests that fail without the change.** I put the 1aba7df copy of `rule-reachability.ts` under the HEAD test file and ran it: tests 16, pass 10, fail 6. The six failures are R2-12, R2-8, R2-16 part 1, R2-16 part 2, R2-17 part 2 and R2-20. That equals the "ten passing and six failing" in the decisions row. The four tests green before the change (R2-17 part 1, R2-17 part 3, R2-19, and the kept R2-6) are declared in the plan as guards, not red tests. The test file is unchanged since the red commit a6cb893 (that commit touches only the test file; commit 1ce6133 touches only the two source files).
2. **R2-12 replacement is a real strengthening.** Old matrix (1aba7df) versus new (HEAD): the one row "a marker plus a verb outside the marker namespace" flips from loads to rejects; every other old row keeps its expectation; the matrix gains an effect dimension and stray-verb rows; the V1 assertions are unchanged. The header comment names the replacement. No deletion.
3. **Spot mutants reproduced.** Applied by hand, each restored afterwards. M1 revert to all-markers-only: killed by R2-12, R2-16 part 1, R2-16 part 2, R2-20. M2 allow branch on every effect: R2-12, R2-13, R2-17 part 3, R2-5, R2-6. M3 drop the empty-array case: R2-12, R2-17 part 2. M4 retyped verb set: R2-8 (and R2-12 through my crude set). M5 flip the subset direction: R2-12, R2-13. Extra M6 case-insensitive match: R2-12, R2-16 part 1, R2-16 part 2. All match the killers named in the decisions row (including its disclosed correction that R2-6 does not kill M5).
4. **Untouched-files claim.** The diff stat lists six files. `src/policy/config/loader.ts`, `src/policy/config/loader-reachability.test.ts`, kernel, schema, hooks, G13b (`src/policy/normalizer/tool-class-golden.test.ts`) and every test-writer file are absent.
5. **Live exposure zero.** `.claude/settings.json` holds the PreToolUse entry only inside comment text (the hook is unwired); the only non-test caller of the check is `src/policy/config/loader.ts`; R2-10 prints: shipped-defaults holds 0 rules, project policy holds 0 rules.
6. **Instrument-produced counts.** The tests print computed counts at run time (R2-12 492 cases; R2-16 part 2 552 rules over 23 targets and 207 records, 0 matches; R2-17 part 1 23 of 23 no-verbs allow rules returned allow and the single-verb set is ["write"]; R2-19 14 distinct verbs, 11 catalog plus 3 markers). `node src/qa/completeness-claim-checker.ts`: PASS. `node src/qa/reference-resolver.ts 1aba7df HEAD`: PASS, 62 citations, 60 resolved, 2 unclassified non-blocking (bare Issue numbers in the plan, not failures).
7. **Stacking.** The tip of the branch behind PR 337 (fix/s7a-gate-hook-robustness on origin) is 1aba7dfbfcdf0fb0c55b5483967b0d47d57b1274, the S7-C base. PR 337 (base master) is OPEN. So S7-C merges cleanly after PR 337; opened before it, it would show S7-B's diff against master, and against the stacked branch it gets no required CI. Merge order: PR 337 first, then retarget S7-C to master.

## Findings

### 1. [ISSUE][MED][demonstrated] The drift test claims a new emitting normalizer fails a test, but it drives three hard-coded normalizers and the registry is open by design

Exposure: ~0% of policy loads today, basis: counted-in-code (three modules call registerNormalizer: shell, structured-cluster, tool-class; the hook is unwired; both committed policy files hold 0 rules). MED because it is an instrument-strength gap against a stated completeness claim, not a live defect.

- Claim: `src/policy/config/rule-reachability.ts:36` to line 40 say R2-19 makes a normalizer that emits a new verb fail a test "instead of silently making this check unsound". The plan (AC-334-7) and decisions row (c) say the same.
- Instrument: `src/policy/config/rule-reachability.test.ts:521` (R2-19) collects verbs from emittedCorpus() plus explicit cluster (line 526) and shell (line 531) calls; the tool-class calls are inside emittedCorpus(). Three fixed tool types. `src/policy/normalizer/registry.ts:38` says an Nth normalizer is added from a NEW file with no edit to any existing file (POL-12), and the registry map has no enumeration function, so nothing pins the set the test drives.
- Demonstration (raw): a scratch script registered a fourth normalizer emitting verb "frobnicate" on the target "mcp/bad_x/y", then ran the real kernel and the real check on a deny rule of a class marker plus "frobnicate" on that target. Output: "kernel outcome with rule, default allow: deny" and "reachability errors: 1". So the rule can match a real emitted record and the check rejects it (a false rejection; on the central layer that is a whole-load rejection). Running R2-19, R2-16 and R2-6 with that normalizer preloaded: all pass (pass 16, fail 0); they never call it, which is by construction from the fixed tool types. Scratch files were deleted and the tree is clean.
- The same fixed set also carries the premise "only the tool-class normalizer emits a marker verb", which makes a marker-plus-stray rule class-only.
- Minimal fix: add one instrument to R2-19 (or a sibling) that scans production files under src for a registerNormalizer call, excluding registry.ts and tests, asserts the set equals the three modules the test drives, and fails naming the new file (a labelled heuristic, worded as one, in the style of R1-6b, Issue #332). Or, cheaper, reword the header and decisions row to say "the three registered normalizers" and route the instrument to Issue #308's preconditions.
- Failing test that maps to this finding (named, not yet written): R2-21 emitted-verbs-drift-covers-every-registrant.

### 2. [ISSUE][LOW][code-traced] The residual "an allow rule with a catalog verb (write) on an unpresentable target loads and widens" is named in no open Issue body once #335 closes

Exposure: ~0% of loads, basis: counted-in-code (0 rules in either committed policy file; gate unwired).

- `src/policy/config/rule-reachability.test.ts:433` (R2-17 part 1) prints that the verbs whose single-verb allow rule returns allow are ["write"]; `src/policy/config/rule-reachability.test.ts:495` (R2-17 part 3) asserts an allow with write on a bad target keeps loading. Red-team round 2 finding 3 named "or a legacy verb" as part of the same widening. The decisions row (a) states the ruling; the Manager's comment on Issue #308 says to resolve Issue #338 "including the shapes the S7-C rulings left loading".
- Gap: Issue #338's body (read with gh) names only "an allow rule on a presentable server target with no marker verb", and the fact 4 header text says nothing about allow plus a catalog verb on an unpresentable target. A Closes reference on #335 removes the last Issue that carried it.
- Minimal fix: one comment on Issue #338 (Manager) widening its stated scope to include allow plus a catalog verb on an unpresentable target. No code change.
- No executable form: a record-scope gap, not a behavior defect (behavior is pinned as ruled by R2-17 part 3). LOW, so no bug Issue is filed.

### 3 to 10. Seams checked, sound

3. [CLEAN][demonstrated] Whole-catalog ADR pass: no collision; THOTH-ADR-0001 not-applicable claim confirmed by the 14-name scan (0 hits).
4. [CLEAN][demonstrated] AC-to-test mapping is real: 6 named tests fail against the 1aba7df module, 10 pass; guards declared.
5. [CLEAN][demonstrated] R2-12 replacement is an honest strengthening; only the one row flipped.
6. [CLEAN][demonstrated] Mutants M1 to M5 (plus M6) killed by the tests the decisions row names.
7. [CLEAN][demonstrated] Untouched-files claim holds (six files in the diff stat).
8. [CLEAN][code-traced] Exposure claim holds: hook unwired, 0 rules in both committed files, one production caller.
9. [CLEAN][demonstrated] Stacking: PR 337's branch tip equals the S7-C base; merge PR 337 first.
10. [CLEAN][demonstrated] Gates: tsc exit 0, eslint exit 0, QA-14 PASS, QA-15 PASS, kernel-purity and normalizer-registry-purity PASS.

## Coverage gaps

- No lane claims the record surfaces beyond the three files the plan fixes: `docs/STATE.md` (lines 10 to 13 still say #334 and #335 are deferred; correct until the Manager's close-out update, not a defect) and `docs/.maat-state.json` (no S7-C entry; the Manager persists it). Intentionally low risk; noted so both are updated at close.
- The whole-load rejection on the central layer is an availability risk carried over from S7-B (ruled). The new rejections widen the set of rules that trigger it; migration exposure is 0 rules today. Covered by the plan's own text, no new finding.

## Checks run (raw)

- Three test files: node --test on rule-reachability.test.ts, loader-reachability.test.ts, tool-class-golden.test.ts: tests 26, pass 26, fail 0, skipped 0.
- Same rule-reachability test file against the 1aba7df module: tests 16, pass 10, fail 6.
- Mutants M1 to M6, each restored after; working tree clean after.
- Full suite (node --test), run while the QA scripts ran in the background: tests 1496, pass 1493, fail 3, skipped 0. The 3 failures: "A15 real-hook-redirect-dense-under-2000ms" (2953 ms against a 2000 ms ceiling), "gate-path-scaling-sweep", "R4 fresh LOCAL clone" (40.8 s). None touches the diff (no file under src/qa, src/secret-scan or hooks changed). Isolated rerun of their three files (src/qa/gate-latency-budget-check.test.ts, src/qa/gate-path-scaling-sweep.test.ts, src/secret-scan/pre-commit-scan.test.ts): tests 74, pass 74, fail 0. Load-timing failures in my concurrent run, not defects, but I did not get one uninterrupted green full pass; CI or the Manager's own run settles it.
- tsc --noEmit -p tsconfig.json: exit 0. eslint on src/policy/config and src/policy/normalizer: exit 0 (full npm run lint not run; the worktree has no node_modules, I used the parent checkout's binaries).

## Editorial (verdict-neutral, plain edits, no re-review)

1. `src/policy/normalizer/tool-class-format.ts:39` (fact 4, the paragraph this story rewrote) still says the loader rejects the two target shapes "ONLY for a rule whose verbs are all class markers", then two sentences later says two more shapes "are now rejected too". Reword line 39 to name the S7-C scope.
2. Same stale "only when the verbs are all class markers" wording in `src/policy/normalizer/tool-class-golden.test.ts:15` (G13b comment) and `src/policy/config/loader-reachability.test.ts:9`. Comment-only; the plan's grep step (AC-334-9) named only three sentences, so these were missed.
3. The CHANGELOG bullet "five spot mutants ... each fail at least one named test" and the decisions row rest on a mutation script kept outside the repo (disclosed). I reproduced them; a future reader cannot without rewriting it. Optional: say "run by hand" in the row.

## Verdict

APPROVE-WITH-CONDITIONS. No HIGH, no ADR collision; the acceptance-criteria-to-test mapping and the R2-12 replacement hold under reproduction. Condition (fix-now or route): finding 1, the drift instrument covers three hard-coded normalizers while the header and decisions row claim it covers any normalizer. Finding 2 is one Issue comment by the Manager.

Open findings 2 (one MED, one LOW); failing tests 1 (R2-21 emitted-verbs-drift-covers-every-registrant, for finding 1). They differ by one: finding 2 has no executable form (record-scope gap; the behavior is already pinned as ruled by R2-17 part 3).

## Single next action

Add R2-21 (the set of registerNormalizer callers equals the three driven modules) or reword the R2-19 claim to the three registered normalizers; then merge PR 337 before retargeting this branch to master.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] src/policy/config/rule-reachability.test.ts:521 (R2-19) drives three hard-coded normalizers while rule-reachability.ts:36 claims any new emitting normalizer fails a test; a fourth registrant (POL-12 open registry) emitting a non-catalog verb makes the check falsely reject a matchable rule and no test notices; add R2-21 registrant scan or reword the claim. Exposure: ~0% of policy loads, basis: counted-in-code.
2. [ISSUE][LOW][code-traced] src/policy/config/rule-reachability.test.ts:495 (R2-17 part 3): allow plus catalog verb (write) on an unpresentable target still loads and widens by ruling; named in no open Issue body once #335 closes (#338 covers presentable targets only); widen #338 scope by one comment.
3. [CLEAN][demonstrated] whole-catalog ADR pass (SE 0002, 0003, 0005, 0006, 0010, 0021, THOTH-ADR-0001): no collision; 0 of 14 fixture names in the src diff.
4. [CLEAN][demonstrated] AC-to-test mapping real: 6 named tests fail against the 1aba7df module (10 pass, 6 fail) and pass at HEAD; the four green-now guards are declared.
5. [CLEAN][demonstrated] R2-12 replacement is a strengthening: one row flipped, every other row and the V1 assertions kept, effect dimension added.
6. [CLEAN][demonstrated] mutants M1 to M5 (plus M6) killed by the tests the decisions row names.
7. [CLEAN][demonstrated] untouched-files claim holds: diff stat lists six files, none of loader, kernel, schema, hooks, G13b, test-writer files.
8. [CLEAN][code-traced] exposure zero: hook unwired, 0 rules in both committed policy files, one production caller.
9. [CLEAN][demonstrated] stacking: PR 337 branch tip equals the S7-C base (1aba7df); merge PR 337 first, then retarget.
10. [CLEAN][demonstrated] gates: tsc 0, eslint 0, QA-14 PASS, QA-15 PASS, purity gates PASS; full suite 1493 of 1496 with 3 load-timing failures unrelated to the diff, isolated rerun 74 of 74.
counts: issues=2 suspicions=0 clean=8
evidence: demonstrated=8 code-traced=2 derived=0
checks=focused 26/26 pass 0 fail 0 skip; against old module 10 pass 6 fail; full suite 1493 pass 3 fail (timing under concurrent load) 0 skip; isolated rerun of those 3 files 74/74; tsc exit 0; eslint (two dirs) exit 0; QA-14 PASS; QA-15 PASS; purity x2 PASS
adr=HIT(37, whole catalog)
report=docs/reviews/s7c-reachability-residuals-cross-domain-2026-09-27.md
