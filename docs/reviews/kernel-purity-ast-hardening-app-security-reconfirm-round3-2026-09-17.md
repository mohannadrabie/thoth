# App Security Re-confirm, Round 3 -- feat/kernel-purity-ast-hardening (Issue #210 close-out)

**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-17
**Scope:** git diff f852b18~1..f852b18 -- targeted re-confirm of the bracket-notation bypass fix, on top of my own round-2 report (docs/reviews/kernel-purity-ast-hardening-app-security-reconfirm-2026-09-17.md, verdict APPROVE-WITH-CONDITIONS, Issue #210 left open).
**Tier:** STANDARD (unchanged -- Manager-ratified).

## ADR compliance

node docs/adr-cache.mjs --ensure returned ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, CACHE=HIT (fp 83b2e3e). Same applicable ADR as rounds 1-2: ADR-0021 POL-11 (kernel-purity structural test). This commit strengthens that same structural test (closes a detection gap); no ADR text conflicts with it. No other applicable ADR (authn/authz, secrets, dependencies, data-exposure) implicated -- this is a static-analysis QA script, not a new endpoint, credential, or dependency. No applicable ADR is violated.

## What changed (f852b18~1..f852b18)

src/qa/kernel-purity-check.ts: asConstructorPropertyAccess (dot-only, matched ts.PropertyAccessExpression) replaced by asConstructorAccess, which resolves a .constructor hop via EITHER dot notation or ts.ElementAccessExpression with a key that constant-folds (via the pre-existing foldStringConcat) to the literal "constructor". detectConstructorPivotViolation now calls the generic resolver at both hops of the two-deep chain, so dot/dot, bracket/bracket, and both mixed orderings all funnel through one check. Plus header-comment disclosure rewrite naming the fix and the (narrower) remaining residual, 2 new violating-fixture functions (pivotViaBracketNotation, pivotViaMixedNotation), 2 new clean false-positive-guard functions (bracket-only single hop), and 3 new tests (50 to 53).
## Independent re-probe (own harness, not the repo's fixtures)

Wrote a standalone script importing the shipped scanFileContent directly and fed it strings written from this task's own brief -- not copied from the repo's violating/constructor-pivot.ts fixture -- to avoid grading the fix against its own test data:

    [PASS] exact task probe (bracket-bracket): ({})["constructor"]["constructor"]("return this")()  -> flagged: constructor-pivot
    [PASS] mixed dot then bracket:              x.constructor["constructor"]("return this")()        -> flagged: constructor-pivot
    [PASS] mixed bracket then dot:              x["constructor"].constructor("return this")()        -> flagged: constructor-pivot
    [PASS] single bracket ACCESS only (no 2nd hop), x["constructor"]      -> NOT flagged (correct)
    [PASS] single bracket CALL only (no 2nd hop),   x["constructor"]()    -> NOT flagged (correct)

All 5 outcomes are as required.

Re-checked the previously-disclosed variable-split residual (independent probe, not the fixture file) to confirm the header's honesty:

    const step1 = x.constructor; const step2 = step1.constructor; step2("return this")();   -> []  (still not caught, as disclosed)

Confirmed real and exactly as the rewritten header now discloses (kernel-purity-check.ts's point-(d) residual paragraph): splitting the chain across two variable declarations, in either notation, still is not caught, because the check is adjacent-token/single-expression only and does not track aliases of .constructor itself. This is honestly narrower than before (round 2 found the disclosure incomplete because it omitted the bracket-notation case; that omission is now closed) and is not a new gap -- it is the same inherent-limit residual round 1 originally named, now correctly scoped in prose to match what the code actually does.
## Regression check

    npm test
    tests 879
    pass 877
    fail 2
    cancelled 0
    skipped 0

Failing: AC1-b (central-classification.test.ts -- known connector-fixture drift) and QA-15 (completeness-claim-checker.test.ts -- STATE.md bare-claim) -- both match every prior round's named pre-existing/disclosed/unrelated failures exactly, by name and file:line. 0 new failures. (877/879 matches the fix-now commit's own claimed count exactly.)

    npm run qa:kernel-purity
    [QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.

Non-vacuous -- 4 real files scanned under the real production kernel root, zero violations, consistent with every prior round.

## Findings

### 1. [CLEAN][demonstrated] Bracket-notation bypass of the constructor-pivot check is closed
src/qa/kernel-purity-check.ts -- asConstructorAccess (dot/bracket-generic resolver) + detectConstructorPivotViolation (two-hop check now notation-agnostic). Independently re-probed with this task's exact string (({})["constructor"]["constructor"]("return this")()) and both mixed dot/bracket orderings -- all 3 now flagged as constructor-pivot. This closes the specific gap round 2 found undisclosed and open on Issue #210.

### 2. [CLEAN][demonstrated] No false-positive regression on legitimate single-hop bracket access
obj["constructor"] (property read) and obj["constructor"]() (single call, no second .constructor hop) are both correctly left unflagged -- confirmed via my own independent probe, matching the shipped clean/safe-single-constructor-access.ts fixture's own bracket-notation additions.

### 3. [CLEAN][demonstrated] Remaining variable-split residual is real, disclosed, and honestly scoped
The header (kernel-purity-check.ts, point (d)'s residual paragraph) now correctly states that splitting the chain across two const declarations is not caught, in either notation -- confirmed by direct probe. This is the same class of inherent-limit disclosure the header already used for the regex layer and for round 1's original finding; nothing here is overstated. Per this task's own framing and this project's disclosed-residual convention: this checker is not wired to any live gate yet, this is the third round on the same narrow mechanism, and the residual requires an extra two statements plus intent to evade a QA lint -- genuinely diminishing-returns territory. Judgment: disclose-and-defer is the right call here, not a fourth fix-now round.

### 4. [CLEAN][demonstrated] No regression
879 tests, 877 pass, 2 fail (AC1-b, QA-15 -- both pre-existing/disclosed, unrelated to this diff), 0 skipped, 0 new failures. npm run qa:kernel-purity PASS, non-vacuous, against the real src/policy/kernel/** production tree.
## Findings to failing tests

No open findings from this round map to a missing test -- the shipped diff already added the 3 tests (bracket-bracket, mixed dot/bracket at the outer hop) that pin the fix, and my own independent probe corroborates them from outside the repo's own fixtures. The one remaining residual (variable-split aliasing) is a disclosed, accepted limitation, not a live gap -- it does not get a failing-test entry because this round's judgment call is to defer it, not fix it now; if a future round decides to close it, the test would be: "detectConstructorPivotViolation: a .constructor chain split across two const declarations is NOT currently detected (disclosed residual, Issue #210 closed on this later reconfirm -- reopen if this becomes live-gate-wired and this residual becomes a real concern)."

## Verdict

APPROVE.

The specific, demonstrated finding that kept Issue #210 open across two prior rounds -- the undisclosed bracket-notation bypass -- is closed, re-confirmed independently against this task's exact repro plus a mixed-notation variant, with the false-positive side (single-hop bracket access) also verified clean. No regression: same 2 pre-existing/disclosed test failures, 0 new; qa:kernel-purity PASS non-vacuous. The one remaining residual (cross-variable aliasing) is honestly disclosed in the shipped header, requires deliberate multi-statement evasion, and the checker still isn't wired to any live enforcement gate -- consistent with this project's disclosed-residual convention and this task's own guidance to lean toward disclose-and-defer at round 3 on the same narrow mechanism. Nothing found here rises to "genuinely severe" or "must fix now."

Issue #210: closing (state_reason: completed) -- this was the last open finding on this story across both reviewers' full round-1 to round-2 to round-3 arc.

Single next action: none required to ship this fix. If the kernel-purity checker is later wired to a live enforcement gate (rather than an informational QA instrument), re-open Issue #210 (do not file a new issue) to weigh the disclosed variable-split residual under an actual-exploitability lens at that time.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by exploitability x impact):
1. [CLEAN][demonstrated] src/qa/kernel-purity-check.ts asConstructorAccess/detectConstructorPivotViolation -- bracket-notation bypass of the constructor-pivot check (Issue #210's last open finding) is closed; independently re-probed with this task's exact repro ({})["constructor"]["constructor"]("return this")() plus both mixed dot/bracket orderings, all now flagged as constructor-pivot.
2. [CLEAN][demonstrated] src/qa/kernel-purity-check.ts asConstructorAccess -- no false-positive regression: single-hop bracket access (obj["constructor"], obj["constructor"](), no second hop) correctly left unflagged, independently probed.
3. [CLEAN][demonstrated] src/qa/kernel-purity-check.ts header disclosure (point (d) residual paragraph) -- remaining variable-split-across-two-const residual is real, reproduces exactly as disclosed, honestly scoped (no longer omits the bracket case round 2 flagged); judged disclose-and-defer given no live-gate wiring and third-round diminishing returns.
4. [CLEAN][demonstrated] npm test 879 tests, 877 pass, 2 fail (AC1-b, QA-15 -- both pre-existing/disclosed, matching every prior round by name), 0 skipped, 0 new failures; npm run qa:kernel-purity PASS non-vacuous, 4 files, zero violations.
counts (checksum): issues=0 suspicions=0 clean=4
evidence (checksum): demonstrated=4 code-traced=0 derived=0
checks="879/2/0 (npm test, 2 pre-existing/disclosed, 0 new) + qa:kernel-purity PASS + 5-case independent adversarial probe script (own harness, not repo fixtures), all 5 correct|n/a"
adr=HIT(35)
report=docs/reviews/kernel-purity-ast-hardening-app-security-reconfirm-round3-2026-09-17.md
