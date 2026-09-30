# Cross-domain review: s325-separator-meter-proof-test (Issue #325, STANDARD, 2026-09-29)

[cross-domain-reviewer] Ra. Delta `a1f3d27..9f993c9`: shell-scanner-work.test.ts (+21), shell-detector-mutants.ts (+7), CHANGELOG.md, docs/STATE.md. No production file changed. Lane alongside: code-reviewer (test and mutant correctness), not re-covered.

ADR cache: HIT, 37 ADRs (devops 12, software-engineering 23, docs/adr 2), whole catalog read unfiltered.

## Tier
The Manager's STANDARD holds; I agree. CLAUDE.md Sensitive areas name `src/policy/guard/*`, the audit-log hook and evidence/incapability verification. A test file under src/policy/normalizer/ and the QA-06 mutant list (src/qa/shell-detector-mutants.ts) are neither. The mutant list is a CI instrument, not a runtime evidence recorder, and it adds a mutant without weakening any existing one. Same class as precedent s332.

## ADR verdicts
- SE ADR-0021 POL-11/POL-12 (kernel/normalizer purity): test-only diff. `npm run qa:kernel-purity` PASS (4 files); `npm run qa:normalizer-registry-purity` PASS. No collision.
- SE ADR-0010 / ADR-0005 (test discipline): one test added, none removed or edited. No collision.
- SE ADR-0020 (mutation gate): new mutant registered through `textMutant` with an anchor; killed. Consistent.
- Remaining 33 ADRs (devops IaC/IAM/tagging/cost, data, DR, tagging, ADR-0016..0019 port fidelity, thoth-0001/0002): no changed file in their scope. No collision.

## Seams
- CI wiring: `.github/workflows/ci.yml:228-229` runs `node src/qa/shell-detector-mutants.ts` (same as `qa:mutation-shell`, package.json:22), and `npm test` (ci.yml:203) runs the new test file. Both pick up the new test and mutant with no wiring change. [CLEAN]
- CHANGELOG/STATE claims vs code: `meterAdd(j - i - 1);` exists at shell-scanner.ts:243 (the mutant anchor); "60 of 60 killed" reproduced; the test suite passes 11/11. [CLEAN]
- Append-only collision with concurrent s312 fix-now commits: CHANGELOG puts the #325 entry on top, the #360/#367-#370 entry follows intact. STATE addendum sits after the s312 addendum, and prior entries are intact. Nothing dropped. [CLEAN]
- Editorial: the CHANGELOG entry says STANDARD, but docs/.maat-state.json still carries scope s312-fixnow-360-363 at CRITICAL, so s325's tier was never persisted there. Verdict-neutral; the Manager can persist it in the next state edit.

## Coverage gaps
None. The diff is all test/QA/docs and both lanes are covered (code-reviewer for the test and mutant, this pass for the ADRs, CI and docs).

## Checks run (read-only, main tree, nothing planted)
- qa:kernel-purity PASS; qa:normalizer-registry-purity PASS
- qa:mutation-shell: 60 of 60 killed
- `node --test`-style run of shell-scanner-work.test.ts: 11 pass, 0 fail, 0 skipped

Verdict: APPROVE. Next action: the Manager persists the s325 tier and closes #325 once code-reviewer returns clean.

RECEIPT: verdict=APPROVE
findings:
1. [CLEAN][code-traced] .github/workflows/ci.yml:203,228-229: the new test (npm test) and the new mutant (shell-detector-mutants) are both picked up with no wiring change
2. [CLEAN][demonstrated] qa:kernel-purity and qa:normalizer-registry-purity PASS; the change is test-only, so ADR-0021 POL-11/12 holds
3. [CLEAN][code-traced] CHANGELOG.md:7 and docs/STATE.md:21 claims match shell-scanner.ts:243 and the reproduced 60/60; the append-only ordering with the s312 entries is intact
4. [CLEAN][code-traced] STANDARD tier is not a CLAUDE.md sensitive area (mutant list is a CI instrument, not the evidence trail or the guard engine)
counts: issues=0 suspicions=0 clean=4
evidence: demonstrated=1 code-traced=3 derived=0
checks=qa:kernel-purity PASS, qa:normalizer-registry-purity PASS, qa:mutation-shell 60/60 killed, shell-scanner-work.test.ts 11 pass/0 fail/0 skip
adr=HIT(37, whole catalog)
report=docs/reviews/s325-separator-meter-proof-test-cross-domain-2026-09-29.md
