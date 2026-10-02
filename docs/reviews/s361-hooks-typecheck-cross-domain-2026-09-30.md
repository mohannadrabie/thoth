# s361-hooks-typecheck cross-domain review (Ra) - 2026-09-30

Scope: Issue #361, CRITICAL, diff e26e7aa..eb0b2d2 (branch s7/closeout). HEAD: eb0b2d2.
Own worktree at eb0b2d2 (removed before end of turn).

[cross-domain-reviewer] Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes

📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog - ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]

## Lanes
CRITICAL tier: red-team + app-security-reviewer (app-security report already logged: APPROVE, 2 LOW suspicions). Their ground: hook runtime equivalence, suppression scan, TS2554 mutation, sanitize force.
Whole catalog (37) read unfiltered; changed files are hooks/*.mjs (annotation-only), tsconfig*.json, QA instrument + tests, one policy test, CHANGELOG. No pipeline/IaC/data/API ADR is touched (ci.yml unchanged). No collision found.

## ADR verdict (out-of-lane)
- Pipeline/CI ADRs: ci.yml unchanged; the gate step `npm run typecheck` (ci.yml:197) runs `tsc -p tsconfig.hooks.json`, so the widened include IS what CI executes. Satisfied.
- SE test-integrity ADRs (0005/0010, no-test-weakening): the re-pinned tests are not weakened. Real-hook 30/22 assertions became 0/0 (still assert the pin), and the "identity is position-independent", "not clean fails" and R4 offset drills moved to self-contained fixtures, each gaining an UNMUTATED CONTROL assertion (new test "N3 control"; C2 control `ok===true`). Mutation strength preserved (offset drill still asserts `2554:… (new, x1)` with total unchanged). R1-11 regex edit makes the JSDoc cast optional; assertion text unchanged. Satisfied.
- Hard rule "no changes to sensitive areas without a fresh dated review report": app-security report exists for this diff; this report is the cross-domain one.
- Hard rule "no hand-derived completeness claims": see F3.

## Evidence (raw)
```
$ npm run typecheck            -> tsc -p tsconfig.json && tsc -p tsconfig.hooks.json  (no output, exit 0)
$ node src/qa/hook-typecheck-coverage-check.ts
PASS: 3 production hook(s) ... 0 diagnostic(s), fully covered (x3)
$ node --test hook-typecheck-coverage-check.test.ts hook-typecheck-coverage-check.fixnow.test.ts classification-builtin-override.test.ts
tests 50 / pass 50 / fail 0 / skipped 0
$ node src/qa/kernel-purity-check.ts -> PASS
$ node src/qa/reference-resolver.ts -> PASS (9 citations, 0 failed; #367/#368 unclassified, non-blocking)
$ node src/qa/completeness-claim-checker.ts -> FAIL (qa-mutation-shell: no parseable number); IDENTICAL FAIL at base e26e7aa
$ git diff -U0 e26e7aa..eb0b2d2 -- hooks/ (code lines only): 4 changed code lines, each adding one `/** @type {Error} */ (x)` cast; all else comments.
```

## Seam findings
No new blocking seam.
- CI seam: the build step CI runs covers the widened tsconfig; QA-18 remains a separate CI step (ci.yml:254-255) and passes on an empty baseline. No gap.
- #308 seam: Issue #308 body and comments contain no citation of #361 (grep of body and comments empty); STATE.md's "14 preconditions" lists do not name #361. Nothing needs updating for #308. STATE.md line 90 ("hook stays outside the real build gate until debt paid down") is a historical entry, now superseded; the Manager's close-out STATE update should say #361 resolved (not a diff defect).

## Findings
F1 [LOW][code-traced] Stale wording that now contradicts reality: `.github/workflows/ci.yml:254` step name and `src/qa/hook-typecheck-coverage-check.ts:269` message ("pre-existing debt, not yet fixed" branch is unreachable with an empty baseline); AC-13 test title still says "exceeding its pinned Issue #361 baseline". Editorial, verdict-neutral.
F2 [LOW][code-traced] `@param {any}` residual on JSON-shaped inputs (CHANGELOG discloses; QA-18 bans only `@type {any}`/`{*}`). Already named by app-security as a LOW suspicion, disclosed by the author: not re-listed as new; noted so the gate's strength is read correctly (those five params are not type-checked at call sites).
F3 [LOW][derived] CHANGELOG "52 sites" equals 30+22 diagnostics, not a counted annotation-site total; "34 identities" is the generated regenerate output. The "exactly 4 token differences" claim matches my own diff count (4 cast lines). Not a QA-15 marker, so no instrument enforces these; low-stakes prose. QA-15 itself fails locally identically on base (environmental, instrument timing), so it is not attributable to this diff: UNPROVEN-pending-verification in CI; settle with `node src/qa/completeness-claim-checker.ts` on the CI runner.

## Coverage gaps
- CHANGELOG numbers (F3) have no instrument behind them; acceptable, low-risk prose.
- None else: every changed file is claimed by a lane or covered by the instruments above.

## Verdict
APPROVE. No collision, no seam failure. Single next action: Manager folds F1 (three stale strings) as plain edits during close-out and updates STATE.md to mark #361 resolved.

Editorial: F1, F3.

RECEIPT: verdict=APPROVE
findings:
1. [LOW][ISSUE][code-traced] ci.yml:254 / hook-typecheck-coverage-check.ts:269 / AC-13 title: stale "pre-existing debt / excepted baseline" wording; plain edit, no re-review
2. [LOW][SUSPICION][code-traced] hooks: residual `@param {any}` on 5 JSON inputs weaken the gate there; disclosed and already an app-security LOW, not new
3. [LOW][SUSPICION][derived] CHANGELOG "52 sites"/"34 identities" hand-typed, no QA-15 marker; QA-15 fails identically on base (env), unproven in CI
4. [CLEAN][demonstrated] CI seam: `npm run typecheck` (ci.yml:197) runs tsconfig.hooks.json with all 3 hooks; QA-18 passes on empty baseline
5. [CLEAN][demonstrated] test re-pinning + R1-11: not weakened (controls added, 50/0/0); assertion text unchanged
6. [CLEAN][code-traced] #308 references: no citation of #361 in #308; nothing to update
7. [CLEAN][demonstrated] whole-catalog ADR pass (37): no collision; hooks diff is 4 cast-only code lines
counts: issues=1 suspicions=2 clean=4
evidence: demonstrated=3 code-traced=3 derived=1
checks=typecheck rc=0; tests 50 pass/0 fail/0 skip; QA-18 PASS; QA-14 PASS; kernel-purity PASS; QA-15 FAIL (identical at base e26e7aa, env)
adr=HIT(37, whole catalog)
report=docs/reviews/s361-hooks-typecheck-cross-domain-2026-09-30.md
