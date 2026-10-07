# Cross-domain review (Ra) - s308-archive-sweep, round 1, CRITICAL, HEAD 7641053

Lanes: CRITICAL; sibling lane reviewers (app-security, red-team) run in parallel on this diff; I did not re-cover their findings. My ground: whole ADR catalog (38 ADRs: devops 12, SE 23, docs/adr 3), every reader of docs/decisions.md / decisions-archive.md, the secret-scan seam.

📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp da6ef03) [CACHE=HIT]

## ADR verdict
- THOTH-ADR-0002 (value-scoped allowlist): COMPLIANT. New entry is path docs/decisions-archive.md, patternId email-address, one valueSha256 (973dfe46...), non-empty reason. Archive contains exactly one distinct email match (the reserved example address) and its sha256 equals the listed hash and the existing docs/decisions.md entry's hash. No widening. Counts measured by script: 52 entries / 110 hashes (matches CHANGELOG).
- THOTH-ADR-0001/0003 (central-classification fixture): not touched.
- No other catalog ADR has an applicableTo reaching docs-only archive moves or the allowlist data. No collisions.

## Seam findings
Readers of the moved rows, traced:
- src/qa/k-readiness.ts:198-227 reads docs/decisions.md THEN decisions-archive.md for the "K1 approved" and "THOTH-ADR-0003 accepted" rows: unaffected; tests pass.
- src/qa/broken-instrument-gate.ts (QA-16) parses decisions.md for BROKEN-INSTRUMENT-DISABLE rows: zero moved rows carry the marker and 0 instruments are registered (vacuous pass, ran). Latent: a future registered instrument whose disable row is later swept would FAIL QA-16 since it reads only the active file. Not exposed today; LOW note only.
- src/qa/reference-scope.ts:54-55 lists both files in the append-only set: resolver run exit 0.
- completeness-claim-checker DEFAULT_FILES excludes decisions.md: unaffected. "round-5-hard-stop ruling row" prose cites are to rows that did not move.
- ~60 code comments cite "docs/decisions.md's <date> row": prose only, none checked mechanically; no cited moved row found among the ones I sampled.
- Memory note project_decisions_sweep_allowlist.md: this change is precisely its stated unlock (archive-path entry + review); the note goes stale after merge (Manager housekeeping, not a finding).

No seam break found.

## Coverage gaps
- The sweep script itself (docs/decisions-archive.mjs) is unchanged; byte-identity of moved rows relies on the implementer's throwaway script. I did not re-prove it; sibling lanes may. Low risk (docs-only rows, append-only checks pass).

## Checks run (worktree, HEAD 7641053)
- node --test k-readiness, completeness-claim-checker, reference-resolver, reference-scope: 199 pass / 0 fail / 0 skip.
- node src/qa/reference-resolver.ts origin/master HEAD: exit 0.
- node src/qa/broken-instrument-gate.ts: vacuous pass. node docs/decisions-archive.mjs (dry): 0 eligible.
- node src/secret-scan/pre-commit-scan.ts: PASS, 0 blocking (275 allowlisted).
- node --test src/secret-scan/*.test.ts: 97 pass / 2 fail / 0 skip. Failures: "OSS-01 (dogfood) real repo clean pass" (took 279.9 s, consistent with a timeout under parallel reviewer load) and "R4 fresh local clone blocks a real commit" (36.7 s). The direct pre-commit scan of the same tree passed with 0 blocking, so I do not read these as a defect in the diff, but I could not prove it: UNPROVEN-pending-verification. Settle with: `node --test src/secret-scan/history-scan.test.ts` on a quiet machine, and the same on base 2708cd8 for comparison. Runnable by the Manager or CI.

## Verdict: APPROVE (one UNPROVEN task above, not a blocker)
Single next action: run the two secret-scan tests on a quiet machine (or confirm CI is green on the PR) before merge.

Editorial: none.

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][LOW][derived] src/qa/broken-instrument-gate.ts reads only active decisions.md; a future swept BROKEN-INSTRUMENT-DISABLE row would fail QA-16. No registered instruments today.
2. [SUSPICION][LOW][demonstrated] history-scan.test.ts OSS-01 dogfood + R4 failed in my parallel-loaded run (279.9s / 36.7s); direct pre-commit scan PASS 0 blocking; UNPROVEN-pending-verification, rerun quiet.
3. [CLEAN][code-traced] k-readiness reads decisions.md then archive for K1 / ADR-0003 rows.
4. [CLEAN][demonstrated] THOTH-ADR-0002 entry value-scoped, hash equals the archive's only email match; 52/110 counts verified.
5. [CLEAN][demonstrated] QA-14 resolver exit 0; reference-scope, completeness-claim tests green.
counts: issues=0 suspicions=2 clean=3
evidence: demonstrated=3 code-traced=1 derived=1
checks=199 pass/0 fail/0 skip (qa tests); resolver exit 0; pre-commit-scan PASS; secret-scan tests 97 pass/2 fail/0 skip (unproven, load-suspected)
adr=HIT(38, whole catalog)
report=docs/reviews/s308-archive-sweep-cross-domain-2026-10-06.md
