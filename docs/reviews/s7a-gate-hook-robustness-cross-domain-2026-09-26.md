# Cross-domain review: s7a-gate-hook-robustness (Issues #303, #304) — 2026-09-26

[cross-domain-reviewer] Ra. HEAD 7d25865 (branch fix/s7a-gate-hook-robustness) against master. Tier CRITICAL (ratified, run-log event). Standing pass, whole ADR catalog, no domain filter.

HEAD: 7d25865

## 1. Lanes and ground covered

- Lanes named by the plan (section 10): `red-team` and `app-security-reviewer`. The state file (`docs/.maat-state.json`) says no review round had run yet and their reports are pending; neither report is in the branch at HEAD. I did not assume their coverage: everything below is checked from code and by running instruments.
- My ground: whole ADR catalog against the diff; the seams between hook, shell scanner, probe, latency corpus, mutation shadow and CI; record-keeping (CHANGELOG, decisions row, state file, plan) against the running instruments; Issue discipline.
- Diff scope (19 files): hook `hooks/pretooluse-kernel-gate.mjs`; scanner `src/policy/normalizer/shell-scanner.ts`; probe, latency, mutant and differential instruments under `src/qa/`; new tests; `package.json` (one script); CHANGELOG, decisions row, run-log event, state file, plan.

## 2. Cross-domain ADR verdict (whole catalog: 37 ADRs; `node docs/adr-cache.mjs --ensure` printed `📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] [CACHE=HIT]`)

| ADR | Verdict | Basis |
|---|---|---|
| SE ADR-0021 (POL-03 single decision path, identical verdicts) | NO COLLISION | Hook still calls the same gate module through the same loader; the scanner is shared by every gate and its outputs are unchanged (independent differential, section 4 item 1: 1,711,111 cases, 0 mismatches). No kernel file touched (`qa:kernel-purity` PASS, `qa:normalizer-registry-purity` PASS). The three exit-2 refusals stay pre-kernel enumerated fail-closed rows, as recorded in the S7 addendum. |
| SE ADR-0005 (no delete or weaken of a failing test) | NO VIOLATION, one reading recorded (finding 9) | No test deleted or edited: the diff numstat shows `hooks/` gains one new test file plus the hook itself; the only edited test is the implementer's own `src/qa/gate-fail-open-probe.test.ts` (87 added, 18 removed; the G9 expected-PROCEEDS list shrinks and gains a stricter BLOCKS-carries-no-AP assertion, named up front in plan section 8). No sleeps or waits in the new tests (search over the new and edited test files: none). |
| SE ADR-0010 (CI gates, nothing lowered) | NO COLLISION | Typecheck and lint clean; no test removed; no lint ignore broadened; the CI workflow file is untouched. |
| SE ADR-0003 and ADR-0002 (SOLID, layers) | NO COLLISION | Scanner defines its own optional meter type and imports nothing from `src/qa/`; the hook stays a thin adapter; qa files import the scanner, not the reverse. |
| THOTH-ADR-0001 (fixture standing exception) | NO COLLISION | Fixture and loader untouched; the structure test that forbids hardcoded fixture entry names passes in the full run. |
| THOTH-ADR-0002 (proposed), SE ADR-0004/0006/0007/0008/0009/0011-0020, DevOps ADR-0001-0010 | NOT APPLICABLE | No data store, IaC, tagging, ported file or secret-scan allowlist touched; the hook mutates nothing. |

## 3. Raw evidence (isolated worktree at 7d25865, Node 24.15 on Windows unless stated)

```
npm test
ℹ tests 1289 | pass 1288 | fail 1 | cancelled 0 | skipped 0
  the one failure: src/secret-scan/pre-commit-scan.test.ts R4 "fresh LOCAL clone": EBUSY rmdir on the temp clone (known intermittent Windows cleanup, Issue 293)
node --test src/secret-scan/pre-commit-scan.test.ts   (isolated rerun)
ℹ tests 26 | pass 26 | fail 0 | skipped 0
npm run qa:redirect-differential
PASS: redirect scan differential: 2696822 cases, 0 mismatches (C1 2396745 + C2 200000 + C3 53 + C4 24 + C5 100000 = 2696822)
npm run qa:mutation-shell     PASS: 56 of 56 mutant(s) KILLED
npm run qa:gate-latency-budget  PASS p99 333.35ms (iterations=70 max=333.35ms ceiling=2000ms)
npm run typecheck, npm run lint: clean
completeness-claim-checker: PASS: 2 file(s) checked, all completeness claims verified
kernel-purity, normalizer-registry-purity, gate-command-path, gate-manifest, gate-matcher-drift: PASS
QA-14 reference-resolver, base master, head HEAD: PASS: 214 citation(s): 169 resolved, 45 unclassified (non-blocking), 0 failed
```

Count claim: 1289 tests and 0 skipped reproduce exactly. On my run 1288 passed and one Windows temp-directory cleanup (Issue 293, already filed, unrelated to this diff) failed under full-suite load; it passes 26 of 26 alone.

## 4. Seam checks

1. **Old scan versus new scan, independent of the in-repo oracle.** The differential instrument builds its frozen "old" scan from the NEW module's tokenizer and quote walk, so a behavior change inside `tokenize` or `tokenizeWithOffsets` (both were refactored onto a shared core) would be invisible to it. I compared the true base-commit scanner file (extracted from master) with the new one directly, on a different seed and alphabet (adds tab, CR, NBSP, a non-ASCII letter, an emoji, U+2028, dollar, pipe, semicolon, parentheses, `>|`, `&>>`, quoted and escaped fd-dup words), six functions per case:
   ```
   {"cases":1711111,"bad":0,"ex":[]}
   (300000 random + 300000 piece strings + every string up to length 6 over a 10-symbol alphabet; extractRedirectTargets, findLiveRedirectOperatorPositions, tokenize, tokenizeWithOffsets, quoteStates, escapedChars)
   ```
   The rewrite preserves outputs on this corpus, including the functions the shell normalizer consumes. Not a proof over all strings (the claim the instrument itself states).
2. **The old scan really was quadratic (the instrument is not aiming at a phantom).** Base scanner, glued shape, 16 KB, in-process: old 7062 ms, new 47 ms, outputs equal, 8190 targets.
3. **Hook on the CI runtime.** Node 22.18.0 (package engines floor and CI version), from a cached npm copy: an allow-shaped call decides (exit 0, deny JSON, empty stderr); the same call with type stripping disabled exits 2 with the fixed one-line message ending `Error type: TypeError`. Real-hook wall clock on 22.18, six redirect shapes: 16 KB 243-272 ms; 128 KB 332-355 ms; 512 KB 504-588 ms (linear; all exit 0). Targeted run of the probe, launch, classification, stderr, linear, differential and latency tests under 22.18: the async destroyed-stdout test passes; the single failure is the G9 row `systemroot-nonexistent` (observed BLOCKS on 22.18, recorded PROCEEDS), exactly Issue 320, so not a new finding.
4. **The latency corpus covers only redirect shapes: is anything else super-linear?** 16 non-redirect shapes (chain operators, pipes, substitutions, backticks, quote runs, backslash runs, long whitespace, nested wrappers, heredoc, flag runs, env-assignment runs, input redirect, unterminated quote) at 16, 64 and 256 KB through the real hook: none exceeded 800 ms or exited non-zero. The gap is real but low-risk; no finding.
5. **State file shape (Issue 316 class).** Top-level keys at HEAD: scope, tier, review counters, note_2026-09-26b, priorScope, adrCatalog. `adrCatalog` is byte-identical to master (37 ADRs; keys version, location, roots, adrs); the prior scope chain is preserved intact one level deeper (that nesting is why the diff shows about 4489 changed lines). No loss.
6. **Record-keeping versus instruments.** CHANGELOG: 2696822 cases and 0 mismatches reproduced by the instrument (classes and sizes match its printed output); 56 killed and 0 survived reproduced; the 53 to 56 marker move matches the live instrument (master had 53; three mutants added; QA-15 PASS) and follows the precedent of earlier sections that keep this marker in sync; 1289 tests and 0 skipped reproduced; "Verified on Node 22.18" reproduced (item 3). The 2696822 figure is prose, not a marker, but it is attributed to the instrument ("rerun it for the current counts") and matches, so the hard rule on hand-derived completeness claims is met. The decisions row is honest: its ratification column says `pending`, item 6 flags the AC-H13 accommodation, item 4 says Linux unmeasured and real-session reach unproven.
7. **Sensitive-area rule.** CLAUDE.md requires a fresh dated review report for the session-gate hook and the guard-adjacent normalizer. None exists on the branch at HEAD except this one. The `red-team` and `app-security-reviewer` reports must be committed before merge (a merge condition, not a finding).
8. **Issue discipline.** `Closes #304` is exact. `Closes #303` is defensible: the issue body lists a missing interpreter, which is not fixed in the script; it stays tracked as the AP-13 precondition inside Issue 308 (open). That only holds if the narrowing comment is posted on Issue 308 before or with the merge (finding 1).
9. **AC-H13 (locked test) and the documenting comment.** The locked test finds the gate export name by a regex over the raw hook source for a static import line; the hook now uses dynamic import, so it carries a comment in that spelling. Reading: not an ADR-0005 violation. No test was deleted, weakened or edited; the test still drives the real hook end to end. It is not vacuous: the wrapper module exports only the names taken from the comment, and the hook calls `decideToolCall` on the loaded module, so if the comment drifted from the real name the control scenario (expects silent allow, must see the wrapped function called) would fail. The comment IS production text shaped to a test's discovery regex; the honest disposition is the one already in the decisions row (needs a Manager or human reading), and a later test-writer amendment could make discovery read the dynamic import. A2 (comment-stripped static import extraction) confirms the comment is not counted as a static import.
10. **package.json versus CI.** `qa:redirect-differential` is not a CI step, but the same instrument runs inside `npm test` via `src/qa/redirect-scan-differential.test.ts` (which CI runs), so nothing is unguarded; the script exists for reruns. Placement deviations from the plan (work-meter test in `src/qa/redirect-scan-linear.test.ts`, shape builder in `src/qa/redirect-shapes.ts`) are harmless. Consequence worth knowing: the mutation shadow copies only `src/policy/**`, so mutation-shell kills only via the pin tests in `src/policy/normalizer/shell-scanner-linear.test.ts`; linearity itself is guarded by the meter test and the real-hook timing tests in the normal suite, which is the intended split.

## 5. Findings

1. **[ISSUE][LOW][code-traced] The Issue 308 comment draft (plan section 12, lines 170-172) overclaims in three places; fix the wording before the Manager posts it.** (a) "fixed in the hook and probe-verified BLOCKS" for the stdout fault: the probe row is Windows-only and in-process (`src/qa/gate-fail-open-probe.ts`, row `stdout-closed-before-write`, platform win32), Linux is unmeasured, real-session reach is unproven; say so. (b) It lists the `SYSTEMROOT` residual as exit 134 with no Node version; it is PROCEEDS on Node 24 and BLOCKS on Node 22.18 (Issue 320; my run, section 4 item 3). (c) It points to the S7-A build report (and the decisions row cites the build report and the raw output): no such file is in the branch (no `docs/reviews/s7a-*` file other than this report). Cite the committed review reports instead. Minimal fix: three word edits in the draft, no code. Exposure: none (record wording; hook unwired, 0% live). Kept as a finding rather than editorial because it steers an activation precondition.
2. **[ISSUE][LOW][demonstrated] The AP-13 residual list names three launcher faults; a fourth of the same class is unlisted: the hook script itself failing to parse or being unreadable.** Demonstrated on a scratch copy of the shipped hook with one extra closing brace appended: Node printed a SyntaxError and exited 1 (non-blocking) before any hook code ran. Before merge this is caught (hook tests execute the script in CI); after merge it is a corruption or tamper path that belongs to the S7 self-protection milestone. Minimal fix: add a fourth bullet to the Issue 308 comment and one clause to the hook header residual line (`hooks/pretooluse-kernel-gate.mjs`, lines 52-56), naming an unparseable or missing hook script, owned by the launcher form plus the manifest and command-path checks. Exposure: ~0% of runs today, basis: counted in code (no settings entry references the hook).
3. **[SUSPICION][LOW][demonstrated] The plan wall-clock margin gate (4x) is not met under full-suite load.** Plan step 1 (spike S1) says to stop and tell the Manager if the margin is under 4x under parallel `node --test` load. In my full run the 18 real-hook A15 cases (`src/qa/gate-latency-budget-check.test.ts`, lines 121-141) took 562-721 ms against the 2000 ms ceiling (2.8x to 3.6x); the decisions row figure "about seven times" is the unloaded one (about 290 ms). Size is not the driver (16 KB cases took as long as 128 KB): cold process start under load is. CI Linux timing is unmeasured (flake rate basis: assumption, so LOW, recommendation: measure it). A flake here is a false red, not a false green, and the deterministic meter test (A14) is the primary linearity guard. Resolves to: read the A15 durations on the first CI run; if any exceeds 1400 ms, move the 64 and 128 KB cases to the latency check only.
4. **[CLEAN][demonstrated]** Independent differential against the true base scanner: 1,711,111 cases times 6 functions, 0 mismatches; old 7062 ms versus new 47 ms at 16 KB, equal outputs.
5. **[CLEAN][demonstrated]** Test-count claim: 1289 tests, 0 skipped reproduced; the one failure is the known Windows temp cleanup (Issue 293), 26 of 26 alone.
6. **[CLEAN][demonstrated]** Instruments reproduce: differential 2696822 cases 0 mismatches (classes sum exactly); mutation-shell 56 of 56 killed; latency p99 333.35 ms.
7. **[CLEAN][demonstrated]** CI runtime (Node 22.18.0): hook fails closed with type stripping off; 128 KB and 512 KB redirect-dense inputs linear (about 0.35 s and 0.55 s); the one 22.18 failure is the filed row of Issue 320.
8. **[CLEAN][demonstrated]** 16 non-redirect adversarial shapes up to 256 KB stay under 800 ms through the real hook; the latency-corpus scope gap is low-risk.
9. **[CLEAN][code-traced]** The AC-H13 documenting comment is not an ADR-0005 violation (reading in section 4 item 9); keep the decisions-row flag.
10. **[CLEAN][code-traced]** State file: `adrCatalog` byte-identical to master, prior-scope chain intact (the Issue 316 loss did not recur).
11. **[CLEAN][code-traced]** Whole-catalog ADR pass (section 2): no collision in SE ADR-0021, 0005, 0010, 0003, 0002 or THOTH-ADR-0001; DevOps and data ADRs not applicable.
12. **[CLEAN][demonstrated]** Records: CHANGELOG counts, QA-15 marker 53 to 56 legitimate (QA-15 PASS), QA-14 diff mode 0 failed, typecheck, lint, purity and gate checks pass.
13. **[CLEAN][code-traced]** Issue discipline, package.json script versus CI, placement deviations (section 4 items 8 and 10).

## 6. Coverage gaps named

- Lane reports (`red-team`, `app-security-reviewer`) are pending at HEAD; their ground (counterexample hunt beyond the corpus, destroyed-stdout path, residual wording) is not claimed here beyond the independent differential and the Node 22 runs above.
- Linux behavior of the destroyed-stdout fault is unmeasured by anyone (CI is Linux; the row is Windows-only; injected-write-failure tests cover the code path). Intentionally low-risk: hook unwired, real-session reach unproven.
- Non-redirect shapes are not in the latency corpus (checked once here: linear).

## 7. Verdict and single next action

Verdict: APPROVE-WITH-CONDITIONS. No ADR collision, no HIGH, no MED. Conditions, all fix-now and wording or process only: (1) correct the three overclaims and add the fourth residual in the Issue 308 comment draft before posting it (findings 1 and 2); (2) commit the `red-team` and `app-security-reviewer` reports before merge (CLAUDE.md sensitive-area rule); (3) read the A15 durations on the first CI run (finding 3).

Findings to tests: open findings 3 (2 issues, 1 suspicion); failing tests 0. None has an executable form: findings 1 and 2 are wording in a not-yet-posted comment, and finding 3 resolves by a measurement on CI (its named test already exists: the A15 real-hook cases). I am read-only on production code and wrote no tests.

Single next action: the Manager edits the Issue 308 comment draft (three corrections plus the fourth residual) and posts it, then confirms the two lane reports are committed before the merge handoff.

## Editorial (verdict-neutral)

- Decisions row item 3: "about seven times under the ceiling" is the unloaded figure; add the word unloaded.
- CHANGELOG and decisions row cite the build report; point at the committed review reports.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by blast radius):
1. [ISSUE][LOW][code-traced] docs/plans/s7a-gate-hook-robustness-phase1-2026-09-26.md:170-172 - Issue 308 comment draft overclaims (stdout fix probe-verified is Windows-only and in-process; SYSTEMROOT exit 134 is Node-24-only per Issue 320; cites a build report that is not committed); three word edits before posting
2. [ISSUE][LOW][demonstrated] hooks/pretooluse-kernel-gate.mjs:52-56 - AP-13 residual omits a fourth launcher-class fault (hook script unparseable or unreadable exits 1, shown on a scratch copy); add a bullet to the Issue 308 comment and one clause to the header
3. [SUSPICION][LOW][demonstrated] src/qa/gate-latency-budget-check.test.ts:121-141 - 18 real-hook wall-clock cases took 562-721 ms under full-suite load (2.8x to 3.6x margin versus the plan 4x gate); CI unmeasured (basis: assumption); read first CI durations, false-red risk only
4. [CLEAN][demonstrated] independent differential versus the true base scanner, 1,711,111 cases x 6 functions, 0 mismatches; old 7062 ms versus new 47 ms at 16 KB
5. [CLEAN][demonstrated] npm test 1289 tests, 0 skipped reproduced; 1 known Windows EBUSY (Issue 293) passes 26 of 26 alone
6. [CLEAN][demonstrated] qa:redirect-differential 2696822/0 (classes sum), qa:mutation-shell 56 of 56 killed, qa:gate-latency-budget p99 333.35 ms
7. [CLEAN][demonstrated] Node 22.18.0 (CI runtime): fail-closed with type stripping off; 128 KB and 512 KB linear; only failure is the filed Issue 320 row
8. [CLEAN][demonstrated] 16 non-redirect adversarial shapes to 256 KB under 800 ms through the real hook
9. [CLEAN][code-traced] AC-H13 documenting comment is not an ADR-0005 violation (no test edited; drift would fail the control scenario); keep the decisions-row reading flag
10. [CLEAN][code-traced] docs/.maat-state.json: adrCatalog byte-identical to master, prior chain intact (Issue 316 class did not recur)
11. [CLEAN][code-traced] whole-catalog ADR pass (37): no collision in SE ADR-0021/0005/0010/0003/0002, THOTH-ADR-0001; DevOps and data ADRs not applicable
12. [CLEAN][demonstrated] CHANGELOG counts and QA-15 marker 53 to 56 legitimate; QA-14 diff mode 0 failed; typecheck, lint, purity and gate checks pass
13. [CLEAN][code-traced] Issue discipline (Closes 303 and 304 defensible given AP-13 tracked in 308), package.json script versus CI (covered by npm test), placement deviations harmless
counts: issues=2 suspicions=1 clean=10
evidence: demonstrated=8 code-traced=5 derived=0
checks=npm test 1289 tests / 1288 pass / 1 fail (known Issue 293 EBUSY, 26/26 alone) / 0 skipped; qa:redirect-differential PASS 2696822/0; qa:mutation-shell PASS 56/56; qa:gate-latency-budget PASS p99 333.35ms; typecheck clean; lint clean; QA-14 0 failed; QA-15 PASS; purity and gate checks PASS; Node 22.18 targeted run 1 failure = Issue 320 row
adr=HIT(37, whole catalog)
report=docs/reviews/s7a-gate-hook-robustness-cross-domain-2026-09-26.md
