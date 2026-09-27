# s7a-gate-hook-robustness: application security review (Horus), 2026-09-26

[app-security-reviewer] App Security Reviewer (Horus): reviewing for exploitable weakness

- Scope: Issues 303 and 304, branch fix/s7a-gate-hook-robustness at 7d25865 versus master. Tier CRITICAL (ratified by the Manager). Post-build. The hook is UNWIRED (activation is Issue 308), so live exposure today is 0%.
- ADR gate: node docs/adr-cache.mjs --ensure printed: ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] [CACHE=HIT] (after initializing the ADR submodule). Applicable to my domain: SE ADR-0021, SE ADR-0005, SE ADR-0010, THOTH-ADR-0001. No violation found (section 10).
- Method: read the plan, the newest decisions row, the hook, the scanner diff and the probe diff; ran the suites; attacked the built hook in a scratch copy of the tree (now deleted); mutation-tested the guards in this worktree only, reverting each. Production code was not modified.

## 1. Verdict

APPROVE. Both Issues are closed by the code as measured. No blocking finding. Two LOW hardening items and two LOW suspicions are recorded; none gates the merge and none needs a bug Issue (LOW never spawns one).

## 2. Raw evidence (commands and output)

| Command | Result |
|---|---|
| npm test (node --test, whole repo) | tests 1289, pass 1289, fail 0, cancelled 0, skipped 0 |
| npm run qa:redirect-differential | PASS: 2696822 cases, 0 mismatches (C1 exhaustive 2396745, C2 random 200000, C3 fixtures 53, C4 shape sweeps 24, C5 pieces 100000) |
| npm run qa:gate-latency-budget | PASS: p99 380.44 ms against the 2000 ms ceiling, 70 iterations, corpus now includes three 128 KB redirect-dense entries |
| npm run qa:mutation-shell | PASS: 56 of 56 mutants KILLED |
| npm run typecheck, npm run lint, npm run qa:kernel-purity, npm run qa:normalizer-registry-purity | all clean; kernel purity: 4 production files, zero violations |

## 3. Does the fix close 303 and 304 without a new hole (demonstrated)

- 303, module load. The hook now has only node: built-ins as static imports and loads the five project modules with import() inside the one try. Tests A1 (no type stripping), A2 (static-import audit) and A3 (src tree missing) pass, and mutation M5 (failClosed exits 1) turns A1, A3, A6, A7 red, so the exit-2 outcome is really asserted.
- 304, size. The redirect scan builds one token index per call and answers each match with a binary search plus a suffix slice. The real hook decided 128 KB glued, fd-dup and word-form inputs inside the latency corpus at p99 380 ms. The 2.69 million-case differential shows identical output to the frozen old scan.
- No new hole found in the change itself: Promise.all with the stdin read means an import rejection or a stdin error both reach the same catch; a second catch on main() covers a throw inside the catch (with the one exception in finding 1).

## 4. Import target resolution (demonstrated)

Question: can cwd, NODE_PATH or a planted module redirect the import target? Test: I copied the hook, src, docs and the project policy folder to a scratch tree, built a decoy tree containing a planted gate module with a marker print, set the working directory to the decoy and NODE_PATH to it, and ran the hook on a payload the real gate denies. Result: the real deny JSON (POL-05, exit 0); the planted module never loaded. Relative specifiers in import() resolve against the importing file URL, not the cwd, and ESM ignores NODE_PATH. The shipped-defaults, project-policy and fixture paths are module-relative too. Env routes that DO change what runs (NODE_OPTIONS import flags) act before hook code and are the launcher residual in section 6.

## 5. Stderr and stdout behaviour (demonstrated)

Hostile-throw matrix. In the scratch copy I added a function to the gate module that the hook calls, threw each value below, and read exit code and the stderr tail from the real hook. Every row exited 2 with the fixed line; stdout empty:

| Thrown value | Error type printed |
|---|---|
| Error whose name is a Windows-path-like string | Error |
| a string containing a path; null | Error |
| cyclic object whose name is itself | Error |
| revoked Proxy | TypeError |
| Proxy whose get trap throws; object whose name getter throws | Error |
| name with spaces (an instruction-like sentence) | Error |
| name of 18 letters only | printed verbatim (the allow-list admits up to 40 letters, so at most 40 letters of attacker text can reach the model; only planted project code can set it, not a payload) |

The same values thrown at module evaluation (a top-level throw in a project module) also exit 2. No path, stack frame or raw message appeared in any run.

Stdout ordering. The deny JSON is written with a completion callback; the exit runs only after the callback resolves; a callback error and a stdout error event both call failClosed (exit 2). Mutation M1 (callback error ignored) turns A8 callback-error red; M2 (listener removed) turns A8 error-event red; M3 (raw name printed) turns A7 red. All reverted.

## 6. Residuals: are they honest, is anything in-process still fixable

Honest. An interpreter that is not on PATH, an unknown NODE_OPTIONS flag and a nonexistent SYSTEMROOT all end the process before line one of the hook runs; no in-process code can catch that, and the three rows stay probed as PROCEEDS with AP-13 and the word residual. Guidance for Issue 308 (not a finding): a launcher command form that maps every exit other than 0 and 2 to 2 (the interpreter call followed by a shell fallback that exits 2) would close the interpreter-missing and NODE_OPTIONS rows in the shell; it cannot help when the shell itself fails, or for a timeout. Nothing further is fixable inside the script.

## 7. Scanner equivalence, a different check from the project instrument (demonstrated)

I ran a separate differential: the master version of the scanner against the branch version, 400000 random strings over a 31-symbol alphabet I chose (redirect operators, single and double quotes, backslashes, escaped operators, quoted operators, whitespace variants, non-ASCII, carriage returns, a non-breaking space), comparing all four public outputs (extractRedirectTargets, findLiveRedirectOperatorPositions, tokenize, tokenizeWithOffsets) as serialized JSON. Result: 400000 cases, 210523 with at least one target, 0 mismatches. Reasoning check: firstTokenFrom is exact because every caller passes the offset right after a live greater-than or ampersand, a step boundary with quote state none; a token can never start exactly at that offset (the operator itself is non-whitespace, so a token is already open), so the start-comparison mutation is an equivalent mutant (survived, expected). Deny-rule write-target detection is unchanged.

## 8. Mutation results in this worktree (each reverted; working tree clean after)

| # | Mutation | Test file run | Result |
|---|---|---|---|
| M1 | ignore write-callback error | launch and stderr tests | KILLED (A8 callback error) |
| M2 | remove stdout error listener | same | KILLED (A8 error event) |
| M3 | print raw error name | same | KILLED (A7) |
| M5 | failClosed exits 1 | same | KILLED (A1, A3, A6, A7) |
| M6 | off-by-one in suffix slice | shell-scanner-linear test | KILLED |
| M7 | token start comparison from at-least to greater-than | same | survived: equivalent mutant (section 7) |
| M8 | put back the per-match tokenize of the remainder for the fd-dup word check | redirect-scan-linear test | SURVIVED (exit 0, only slowly); the wall-clock latency test file then FAILED (exit 1), so the second guard caught it. See finding 2 |
| M9 | flip the input-size probe row to PROCEEDS | probe test | KILLED |

## 9. Probe coverage and the both-ways rule

The G9 test builds observed = runProbe plus runAsyncProbe, requires every observed id to be recorded with probed true and an equal outcome, requires every recorded probed row for this platform to appear in observed, requires every PROCEEDS row to carry an AP and every BLOCKS row to carry none, and pins the PROCEEDS set to the three launcher rows. It passed (and M9 breaks it). The destroyed-stdout row is probed on win32 only, so ubuntu CI runs only the injected-failure tests for that path; the plan and the row note disclose this.

## 10. ADR compliance

- SE ADR-0021: no kernel file touched (qa:kernel-purity PASS); one decision path kept (the hook still calls the same gate export); normalizer output unchanged per section 7, so POL-05 inputs are identical. No violation.
- SE ADR-0005 and 0010: new behavior has tests written with the change; full suite green with real counts; the expected-PROCEEDS list shrank only because rows flipped to BLOCKS (strengthening). No test deleted or weakened. Note for the human: the locked AC-H13 is satisfied by a comment in static-import spelling (finding 3).
- THOTH-ADR-0001: the fixture and loader are untouched; no committed entry name is typed in the new tests.
- Dependencies and secrets: package.json adds one script line, package-lock.json is unchanged, no new dependency, no secret material in the diff.

## 11. Findings, ranked by exploitability times impact

1. LOW, demonstrated. hooks/pretooluse-kernel-gate.mjs, function failClosed: the error-name lookup runs before the try/finally. A thrown value whose name getter throws another value that also throws (a self-referencing throwing getter) makes both catch paths throw, Node reports an unhandled rejection and the process exits 1 (non-blocking). Not payload-reachable: only project code could throw such a value. Attack sketch: none from a payload; needs planted code, which already implies compromise. Minimal fix: compute the name inside a try with a default of Error. Exposure: not blocking; basis counted in code, 0 known paths from a hook payload. Executable form: a launch test that plants such a thrown value and expects exit 2 (named: fail-closed-survives-a-throwing-error-name). Not filed as an Issue (LOW).
2. LOW, demonstrated. src/qa/redirect-scan-linear.test.ts: the deterministic work meter counts only the quote walk and the internal token scan given a meter, so a re-introduced per-match call to the public tokenize function is invisible to it (mutation M8 survived). The wall-clock real-hook test still fails on it, so the regression would be caught, but the plan states the meter is the proof of linearity. Minimal fix: count characters in tokenize as well, or add a named case that fails when tokenize is called from the scan. Executable form: named case redirect-scan-work-meter-sees-every-tokenizer-call. Not filed (LOW).
3. LOW suspicion, code-traced. hooks/pretooluse-kernel-gate.mjs comment near the dynamic imports: the locked test AC-H13 discovers the gate export name by reading a static import spelling that exists only in a comment. If the export is renamed and the comment is not, H13 wraps a name the hook never calls and can pass on a fail-closed exit. Already flagged by the implementer (decisions row item 6); needs a Manager or human reading.
4. LOW suspicion, derived. Destroyed-stdout behaviour on Linux and reach in a live Claude Code session are unmeasured; the code path is covered by injected-failure tests everywhere and the real fault is reproduced on Windows. Settle by running the async probe on a Linux runner; owner: whoever owns CI.
5 to 13: CLEAN, see the receipt below for each.

## 12. Blockers versus hardening

- Blockers: none.
- Hardening: findings 1 and 2 (small, test-first, optional in this PR); suspicions 3 and 4 for the human and CI owner.
- Open findings versus failing tests: findings 1 and 2 each have a named failing test still to be written (none exists today, so no test is red yet). Suspicions 3 and 4 have no executable form yet (3 needs a design ruling, 4 needs a Linux runner).

## 13. Next action

Manager: merge per the human-only rule, carrying Closes for Issues 303 and 304; optionally have story-implementer add the two named LOW tests first. Post the launcher-form guidance from section 6 on Issue 308.

## Editorial

- The plan says the meter proves linearity; finding 2 qualifies that. Nothing else.

RECEIPT: verdict=APPROVE
findings (ranked by exploitability x impact):
1. [ISSUE][LOW][demonstrated] hooks/pretooluse-kernel-gate.mjs failClosed: error-name lookup is outside the try, so a doubly-hostile thrown value (throwing name getter that throws again) exits 1 not 2; not payload-reachable; move the lookup inside a try defaulting to Error
2. [ISSUE][LOW][demonstrated] src/qa/redirect-scan-linear.test.ts: work meter is blind to a re-introduced per-match tokenize (mutation M8 survived); wall-clock latency test still catches it; meter tokenize too
3. [SUSPICION][LOW][code-traced] hooks/pretooluse-kernel-gate.mjs: AC-H13 is satisfied by a comment in static-import spelling that can go stale; needs a human reading
4. [SUSPICION][LOW][derived] destroyed-stdout fault unmeasured on Linux and unproven in a live session; run the async probe on a Linux runner
5. [CLEAN][demonstrated] 303 closed: module-load and missing-tree faults exit 2
6. [CLEAN][demonstrated] 304 closed: 128 KB inputs decided, p99 380 ms, no size cap
7. [CLEAN][demonstrated] import resolution is module-relative; cwd and NODE_PATH decoy ignored
8. [CLEAN][demonstrated] stderr leaks nothing across the hostile-throw matrix
9. [CLEAN][demonstrated] scanner rewrite output-identical: 400000 own plus 2696822 project cases, 0 mismatches
10. [CLEAN][demonstrated] guard tests killed the intended mutants (M1, M2, M3, M5, M6, M9)
11. [CLEAN][code-traced] launcher residuals honestly recorded; nothing further fixable in-script
12. [CLEAN][code-traced] ADR 0021, 0005, 0010 and THOTH-ADR-0001 compliance; no dependency or secret change
13. [CLEAN][code-traced] G9 both-ways rule holds between RECORDED_DECISIONS and the probes
counts: issues=2 suspicions=2 clean=9
evidence: demonstrated=8 code-traced=4 derived=1
checks="1289/0/0"
adr=HIT(37)
report=docs/reviews/s7a-gate-hook-robustness-app-security-2026-09-26.md
