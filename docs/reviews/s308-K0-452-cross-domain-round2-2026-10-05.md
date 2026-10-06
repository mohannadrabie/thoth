# Cross-domain review, round 2: s308-K0 (#308 K stage 0) and s308-452 (#452 extraction check)

Reviewer: cross-domain-reviewer (Ra). Tier CRITICAL. HEAD 9767b05, worktree review/r2-cd. Delta read: `git diff 79f0b44..9767b05` (28 files).
📊 ADR cache BUILT: cataloged 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3], catalog now current (fp da6ef03) [CACHE=HIT]

## Lanes
Parallel: red-team round 2 and app-security round 2. Their ground: attack surface and authz/injection of the fix-now code. Mine: whole ADR catalog, the seams, the coverage gaps.

## Round-1 findings re-confirmed by execution
| # | Check | Result |
|---|---|---|
| 1 | #457 real `npm run qa:k-readiness` | PASS. k-blocker row lists 8 issues (#464 #463 #462 #455 #452 #444 #442 #438); #397 and #406 are gone. Row total 8 PASS / 6 FAIL / 2 MISSING, NOT READY. |
| 2 | #459 archive read | PASS. Real tree: K4 row sits in decisions.md (1 hit, archive 0), PASS. Appended a well-formed K1 row (date-led, 6 cells, Human ratified Y) to docs/decisions-archive.md only: K1 went FAIL to PASS; restored with git checkout. My first temp row was malformed and correctly stayed FAIL. |
| 3 | F3, F5 and the drift line in the runbook | PASS. Runbook section 5 (K1 cell form incl. `Y (human, 2026-10-06: "approved")`, archive named), section 6 (regenerate fixture with `--out`, retire k-readiness.real-run.ts and its npm script), section 2 (drift line, #463, human-reviewed, never bump the pin). All asserted by new tests in k-runbook.test.ts. |

## Seam: generated settings vs every other reader (wired-state replay)
Dry run `node src/qa/k-settings-merge.ts`: exit 0, equals docs/qa/k-proposed-merged-settings.fixture.txt byte for byte; 155 distinct `Edit(` lines (the 117 protected paths expand to more Edit forms; K3 confirms all 117 paths covered). I ran `--write` in my worktree (backup first), ran every reader, then restored the file (git status clean):
- qa:k3 PASS (117 paths), qa:k5 PASS (exactly the merge entry, only PreToolUse group, disableAllHooks unset), gate-command-path PASS (3 entries), launcher-pin PASS, matcher-drift PASS (43 names), manifest PASS (1 file), latency-budget PASS (p99 502 ms of 2000), protected-path-list PASS (117), QA-17 runtime-settings-drift PASS (18 keys). In readiness the K3 and K5 rows flip FAIL to PASS; only external rows stay red. No reader disagrees. [CLEAN]

## Seam: npm test on a CI-like runner
- Isolated HOME, USERPROFILE, LOCALAPPDATA, APPDATA, PATH holding only node: `node --test src/qa/claude-code-write-deny.test.ts` = tests 19, pass 17, fail 0, skipped 2. Both skips print a reason and count as skipped, not pass (`CC-installed-extraction-fully-judged`, `installed-live`). Green.
- Same file locally (VS Code 2.1.289 binary present): 19 tests, 18 pass, 1 fail (`installed-live`). Expected until #463.
- Full `npm test` locally, while two other review lanes ran on the same machine: 2575 tests, 2568 pass, 6 fail, 1 skipped. Failures: `installed-live`, plus five wall-clock tests (REAL_SHELL_FORM_TIMER, three A15 redirect-dense 2.0 s ceilings at 2.0-2.3 s, R4 clone-hook at 46 s). The five are load-sensitive; `qa:gate-latency-budget` alone passed at p99 502-692 ms. Not caused by this diff; UNPROVEN as load flake, settle by re-running on an idle machine.
- Judgment on local npm test being red on a developer machine whose Claude Code differs from the judged version: it satisfies the DoD (tests green in CI with real counts) because CI has no claude binary and reports 2 skipped. It is acceptable and intended as a drift alarm, and CHANGELOG.md:13 discloses it. What the human should know: (a) today every local `npm test` on this machine is red until #463 re-judges 2.1.289; (b) any Claude Code or extension auto-update turns every developer local run red until someone re-judges, which is the design; (c) CI never enforces this check (no ci.yml step, no binary), so its only enforcement point is `qa:k-readiness` run by the human before wiring; (d) ADR-0010 (no skip without a justification and a human-approved exception) is not violated in my reading: the skip is an environment guard with a reason string, six other test files use the same pattern, and it is not used to turn a red test green. The human acceptance in the PR is the cheap exception record; no code change needed.

## ADR verdicts (whole catalog, 38)
- devops ADR-0001..0010: not applicable (no IaC, tags, pipeline or IAM in the diff). No collision.
- SE ADR-0004 idempotency: the merge is idempotent (existing test; my `--write` replay restored cleanly). OK.
- SE ADR-0005 testing: new behaviour has tests (k-runbook, k-readiness, k5, protected-path-list, write-deny); skips report as skips. OK.
- SE ADR-0010 quality: see (d). No test loosened in the delta. OK.
- SE ADR-0016/0019/0020/0021 (self-protection, port, kernel): new protected paths strengthen self-protection; no kernel or normalizer files touched. OK.
- THOTH-ADR-0001/0003 (classification fixture): docs/qa/s5-central-classification.json is untouched in the delta (empty `git diff --stat`). The 116 added lines in src/policy/config/shipped-defaults.json are 6 `protect-*` deny rules plus `protect-parent-docs-plans`, generated by protected-path-list; `qa:protected-path-list` confirms committed rules equal the generator. This is policy-delivery surface (a CLAUDE.md sensitive area), not the fixture, so the entry-only exemption does not apply; this report and the lane reports are the fresh dated review. No collision.
- THOTH-ADR-0002 (proposed): not applicable.
No cross-domain ADR collision. No blocker.

## Stage 1 probe plan vs the UNPROVEN items
Generated by script (keyword presence in the plan for each item from the K plan lines 39-52, 104-107, 139-141, red-team K0 and red-team 452). 20 items: 17 matched, 3 not found; on reading, 2 of the 17 matches are hollow (#444 matches only the words Program Files in the settings table; env-levers #9 matches the P-K3 NODE_OPTIONS write-refusal probe, a right control but not the merge warning the red-team asked for).
Covered: P1 gaps (P-K2, P-K2b), real-path Edit, Write under bypass, NotebookEdit, MultiEdit, worktree forms (P-K4), lowercase case spike, macOS ACL (R1b residual, honest), alias probe, latency allow-path, P-K5, planted kubectl, subdirectory (P-K1b), anchored matcher (P-K1c), mods (P-K7), probe the 2.1.289 binary after #463.
Not covered or hollow (all LOW, none a stage-1 blocker):
- #444 (Program Files writability): the K plan says a human-run probe at activation; the probe plan has no row or residual for it. It is a k-blocker in readiness, so it cannot be forgotten at wiring.
- #460 absolute-form candidate: code is fixed (`absoluteEditBody`; my run prints `Edit(//c/...)`; test at protected-path-list.test.ts:45) but the plan does not say P-K4 uses the corrected form, and #460 is still open. One sentence plus closing #460.
- Red-team K0 #4 (parallel PreToolUse hooks, `updatedInput`): K5 now fails closed on any second settings group, but the real hook set already includes plugin PreToolUse[Bash] hooks (org-synced guard.mjs) running in parallel with the gate, which K5 cannot see. The plan has no probe asking whether a parallel hook updatedInput can rewrite what the gate sees, and no residual line.
- Red-team 452 #3 (extraction window scope: `.claude` shapes rules, CLAUDE.md, worktrees, ide outside the window): not a live probe; it belongs in #463 re-judge acceptance and is not written there.

## New k-blockers #462 #463 #464
All three open with `k-blocker` and appear in the readiness blocker row. #463 and #464 are named in the runbook (sections 2 and 7) and the probe plan (header, setup, P-K7). The #462 fix (every installed binary checked, final line names each) is in code and runbook; the issue stays open until merge, which is coherent. The runbook states the mods residual as live (2.1.289 is past 2.1.287). Coherent. [CLEAN]

## Seam findings
1. [LOW][code-traced] Probe plan gaps above (#444 row, #460 corrected form, parallel-hook updatedInput, window-scope acceptance). Minimal fix: four sentences in the plan or in the #463 acceptance text. Not blocking; no Issue filed (LOW). No executable form (plan prose); resolves to a residual-register line.
2. [LOW][derived] The CC-extraction check has no CI enforcement (no ci.yml step, no binary on the runner); enforcement lives only in readiness. State it in the PR so the human does not assume CI guards drift. No fix needed.
3. [LOW][derived] Five timing-bound tests failed under concurrent lane load on this machine; re-run on an idle machine (`npm test`, no other lane running) to confirm.

Coverage gap: shipped-defaults.json is generated output whose only reviewer is the generator drift check; I confirmed it passes. Intentionally low-risk. Prose docs under docs/plans and docs/reviews are not claimed by any lane.

## Editorial
- THOTH-ADR-0003 line 40 says shipped-defaults carries `rules: []`; it already carries 100+ deny rules (pre-existing staleness).
- #460 appears fixed; close it with a commit reference.

## Verdict
APPROVE-WITH-CONDITIONS. All round-1 items fixed and re-confirmed by execution; no seam breaks; no ADR collision. Conditions (non-blocking): the four probe-plan sentences, and the PR note about the local red and the absence of CI enforcement. Single next action: the human reviews the stage 1 probe plan with those gaps added, and the #463 re-judge runs before any probe.

REVIEW_LOG row: | 2026-10-05 | s308-K0 + s308-452 | cross-domain-reviewer (Ra) | round 2 APPROVE-WITH-CONDITIONS | docs/reviews/s308-K0-452-cross-domain-round2-2026-10-05.md: round-1 #457/#459/F3/F5/drift line confirmed fixed by execution; wired-state replay agrees across 9 readers; 3 LOW (probe-plan gaps, no CI enforcement of drift check, load-flaky timing tests) |

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][LOW][code-traced] docs/plans/s308-K-stage1-probe-plan-2026-10-05.md: no row for #444, no note that P-K4 uses the corrected //c/ form (#460 still open), no probe or residual for plugin-parallel PreToolUse updatedInput, window-scope not in #463 acceptance; add four sentences.
2. [SUSPICION][LOW][derived] CC-extraction-covers-judged has no CI enforcement (skips on runner); only readiness enforces; say so in the PR.
3. [SUSPICION][LOW][derived] 5 wall-clock tests red under concurrent load locally (A15 x3, REAL_SHELL_FORM_TIMER, R4); re-run idle to confirm.
4. [CLEAN][demonstrated] #457 fixed: readiness no longer lists #397/#406.
5. [CLEAN][demonstrated] #459 fixed: K1 FAIL to PASS from a temp archive row, restored.
6. [CLEAN][code-traced] F3/F5/drift line in runbook, asserted by k-runbook.test.ts.
7. [CLEAN][demonstrated] wired-state replay: dry run equals fixture; k3, k5, command-path, launcher-pin, matcher-drift, manifest, latency, protected-path-list, QA-17 all PASS; restored.
8. [CLEAN][demonstrated] CI-like isolated run of write-deny file: 19 tests, 17 pass, 0 fail, 2 skipped; skips reported as skips.
9. [CLEAN][code-traced] #462/#463/#464 coherent with readiness, runbook, probe plan.
10. [CLEAN][code-traced] shipped-defaults.json 117-path regen: no ADR or THOTH-ADR-0001/0003 collision; fixture untouched; ADR-0010 skip pattern judged not a violation.
counts: issues=1 suspicions=2 clean=7
evidence: demonstrated=4 code-traced=3 derived=3
checks=qa:k-readiness 8 PASS/6 FAIL/2 MISSING (expected red); write-deny file isolated 17 pass/0 fail/2 skip, local 18 pass/1 fail (installed-live, expected); wired replay 9 readers PASS; full npm test 2568 pass/6 fail/1 skip (5 wall-clock under load, 1 expected); no live claude -p, no vendor-tool-inventory
adr=HIT(38, whole catalog)
report=docs/reviews/s308-K0-452-cross-domain-round2-2026-10-05.md
HEAD: 9767b05
issues: none new filed (no MED/HIGH); commented FIXED on #457, #459
