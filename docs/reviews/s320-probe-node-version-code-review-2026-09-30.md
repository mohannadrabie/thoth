[code-reviewer]
⚖️ Code Reviewer (Anubis) — reviewing for correctness & user-facing trust

# Code review: #320 (scope s320-probe-node-version), 678d932^..be8633b, STANDARD tier
📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog [CACHE=HIT]. No applicable ADR standard violated.
Verdict: SHIP-WITH-NOTES (verdict enum: SHIP). Reviewed in a private worktree at be8633b (Node v24.15.0, win32), removed after.

## Scorecard
- Correctness vs ruling (decisions.md 2026-09-30 row 3): SOLID. Row keeps expect PROCEEDS, probed, no skip, ap AP-13; alsoAccepts ["BLOCKS"]; win32-only.
- Scope isolation: SOLID. A20 loops RECORDED_DECISIONS: no other row may carry alsoAccepts. Widening to ["BLOCKS","PROCEEDS"] is killed by A20.
- Third outcome / Linux+CI rows: SOLID. outcomeAccepted is exact-match for every row without alsoAccepts; all Linux/CI rows are unchanged, so a real fail-open regression (BLOCKS row observing PROCEEDS) still fails G9. AP rules (G9 loop, `expect === "BLOCKS"` => no ap) still key on expect.
- Verification: gate-fail-open-probe.test.ts 14 pass / 0 fail / 0 skipped (real run, Node 24.15).

## Mutations (demonstrated)
- outcomeAccepted -> `return true`: A21 fails (killed)
- ignore alsoAccepts: A21 fails (killed)
- inverted predicate: G9 + A21 fail (killed)
- drop alsoAccepts from row: A20 fails (killed)
- widen alsoAccepts to both outcomes: A20 fails (killed)
- G9 reverted to `assert.equal(o.outcome, r.expect, ...)`: 14 pass / 0 fail, SURVIVES (finding 1)

## Findings
1. [LOW][demonstrated] src/qa/gate-fail-open-probe.test.ts:52 - G9's use of outcomeAccepted (and the observed-driven expectedProceeds at :60-61) is not killed on Node 24, where the row observes PROCEEDS == expect; the wiring only matters on Node 22.18 (BLOCKS). Reverting G9 to exact-match stays green here, so a future Node-22 CI/dev run would be the first to notice. Minimal fix (optional): a G9-level test feeding a stub observed BLOCKS for the systemroot row, or run G9 on Node 22.18 in CI. Not a blocker: predicate itself is pinned by A21, row shape by A20. Exposure: ~0% of Node-24 runs; affects only Node 22.18 win32 runs, basis: measured (mutation above).
2. [LOW][code-traced] Test file was edited in the fix commit 783df05 (G9 assertion + expectedProceeds, and A21's `as` cast dropped for a direct import). The G9 edit is required by the ruling (G9 is the consumer the ruling changes) and A20/A21 were not weakened (the cast removal is cosmetic, the assertions are identical). Note for the record, not a violation: the red-authored A20/A21 assertions are unchanged.

## Missing checks
- G9 unit-level check with an injected observed BLOCKS for systemroot (finding 1).

## Praised
Keeping `expect` as the primary decision and adding a separate pure `outcomeAccepted` predicate: the loosening is narrow, named, and unit-pinned, and no row can silently inherit it.

## Editorial
- None material. CHANGELOG entry matches behavior.

Open findings: 0 blocking. Failing tests: 0 (finding 1 is LOW, no filed Issue per policy).
Single next action: merge #320 as is; optionally add the injected-BLOCKS G9 check when Node 22 coverage is next touched.

RECEIPT: verdict=SHIP
findings:
1. [SUSPICION][LOW][demonstrated] gate-fail-open-probe.test.ts:52 - G9 outcomeAccepted wiring survives revert-to-exact-match mutation on Node 24; add injected-BLOCKS check or Node 22.18 run
2. [CLEAN][code-traced] gate-fail-open-probe.ts:66-70,77 - outcomeAccepted exact-match for all rows without alsoAccepts; only systemroot row loosened; AP rules keyed on expect
3. [CLEAN][demonstrated] gate-fail-open-probe.test.ts:185-207 - A20/A21 kill 5 of 5 predicate/row mutants; 14 pass/0 fail/0 skip
counts: issues=0 suspicions=1 clean=2
evidence: demonstrated=2 code-traced=1 derived=0
checks="14/0/0"
adr=HIT(37)
report=docs/reviews/s320-probe-node-version-code-review-2026-09-30.md
