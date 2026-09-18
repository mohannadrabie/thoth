# App Security Re-confirm — feat/kernel-purity-ast-hardening (fix-now round, Issues #210/#211)

**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-17
**Scope:** git diff d227090..3bde1a2 — targeted re-confirm of the fix-now commit on top of my own round-1 report (docs/reviews/kernel-purity-ast-hardening-app-security-2026-09-17.md, verdict REWORK).
**Tier:** STANDARD (unchanged from round 1 — Manager-ratified).

## ADR compliance

node docs/adr-cache.mjs --ensure returned ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, CACHE=HIT. Same applicable ADR as round 1: ADR-0021 POL-11 (kernel purity structural test). No change to the ADR-compliance analysis from round 1 — this is a fix-now delta to the same structural test, not a new surface. No other applicable ADR (authn/authz, secrets, dependencies, data-exposure) implicated.

## What changed (d227090..3bde1a2)

src/qa/kernel-purity-check.ts: two new detection functions wired into detectUsages's ts.CallExpression branch:
- detectDirectCallViolation (lines 290-300): closes Issue #211 -- a direct call through a forbidden root or tracked alias with no property/element access on the callee.
- detectConstructorPivotViolation + asConstructorPropertyAccess (lines 302-328): closes Issue #210's demonstrated escape -- the adjacent .constructor.constructor(...) chain, root-independent.

Plus header-comment disclosure updates, two new fixture files (clean/safe-single-constructor-access.ts, violating/constructor-pivot.ts), an extended violating/aliased-network-timer.ts, and 7 new tests in kernel-purity-check.test.ts (43 to 50).

## Independent adversarial re-probe

Ran directly against the shipped scanForbiddenGlobals/scanForbiddenGlobalsAst at HEAD 3bde1a2 (ad-hoc probe script importing the two exported functions).

### Issue #211 -- alias-then-call bypass

    fetch:       const f = fetch; f(url);                              regex: []   AST: [direct call through "fetch"]
    setTimeout:  const t = setTimeout; t(() => {}, 1000);              regex: []   AST: [direct call through "setTimeout"]
    setInterval: const i = setInterval; i(() => {}, 1000);             regex: []   AST: [direct call through "setInterval"]
    require:     const r = require; r("node:child_process");          regex: []   AST: [direct call through "require"]
    eval (control): const e = eval; e("1+1");                         regex: [eval] AST: [direct call through "eval"]

All 4 originally-bypassed roots now caught; eval control still caught (no regression).

Variant -- double-aliasing:

    const a = fetch; const b = a; b(url);                              AST: [direct call through "fetch"]
    const a = require; const b = a; b(url);                            AST: [direct call through "require"]

Caught -- collectAliases's single sequential pass resolves b transitively because a's alias entry is already in the map (written top-to-bottom in source order) by the time b's declaration is visited.

Variant -- cast-wrapped alias, both at the declaration and at the call site:

    const f = fetch as unknown as typeof fetch; f(url);                AST: [direct call through "fetch"]
    const f = fetch; (f as any)(url);                                  AST: [direct call through "fetch"]
    const f = (fetch as any); ((f) as any)(url);                       AST: [direct call through "fetch"]

Caught in all 3 shapes -- resolveExpressionRoot's unwrapCasts is applied uniformly at both the alias-collection site and the call site.

Variant -- .call()/.apply()/.bind() indirection (flagged in the task as untested territory):

    fetch.call(null, url);                                             AST: [property access ".call" on "fetch"]
    const f = fetch; f.call(null, url);                                AST: [property access ".call" on "fetch"]
    (fetch.bind(null))(url);                                           AST: [property access ".bind" on "fetch"]
    const f = fetch; const g = f.bind(null); g(url);                   AST: [property access ".bind" on "fetch"]
    require.apply(null, [id]);                                         AST: [property access ".apply" on "require"]

All 5 caught. This was not actually live territory to begin with -- .call/.apply/.bind are ordinary property accesses on the root/alias, and detectPropertyAccessViolation (pre-existing since round 1, unchanged by this fix-now commit) fires on any .prop access regardless of the property name. Worth naming as CLEAN, confirmed, not assumed.

Verdict on Issue #211: genuinely fixed. No bypass found across the original probe plus every variant tried (double-alias, cast-wrapped both ends, and the three explicit indirection methods named in this round's brief). Closed the issue (see Issue Discipline below).

### Issue #210 -- constructor-pivot prototype escape

    ({}).constructor.constructor("return this")();                     AST: [constructor-pivot]

Direct escape caught, as claimed.

Disclosed residual (header, kernel-purity-check.ts:69-73) -- confirmed real, honestly framed for the shape it names:

    const step1 = ({}).constructor; const step2 = step1.constructor; step2("return this")();   regex: []  AST: []
    const c = ({}).constructor; const cc = c.constructor; cc("return globalThis.process")();     regex: [process, globalThis] (only because the payload string happens to contain those literal tokens)  AST: []

The variable-split residual reproduces exactly as documented. This is honest, not overstated or understated, for the specific shape it names.

New finding -- undisclosed bypass, narrower/easier than the disclosed one: bracket-notation .constructor access, in a single expression, with no variable-splitting or aliasing at all:

    ({})["constructor"]["constructor"]("return this")();                regex: []   AST: []
    ({})["constructor"].constructor("return this")();                   regex: []   AST: []   (mixed bracket+dot)
    ({}).constructor["constructor"]("return this")();                   regex: []   AST: []   (mixed dot+bracket)

asConstructorPropertyAccess (kernel-purity-check.ts:302-306) only checks ts.isPropertyAccessExpression -- it never checks ts.isElementAccessExpression with a literal "constructor" key. The header comment's framing ("splitting the chain across two variables ... is NOT caught") implies that keeping the chain in one expression is always caught; that's false for bracket notation, which requires no split and no alias, and is arguably a lower-effort evasion than the one actually disclosed.

Negative controls confirm the detector is otherwise narrow as intended (no false positives): a single-level .constructor access/call is not flagged; a triple-level dot chain and a chain reached off a plain variable holding {} are both still correctly caught (the check is genuinely adjacent-token, not root-restricted).

Verdict on Issue #210: NOT closing. The demonstrated escape the issue was originally filed against is closed. The disclosed residual is honest for the shape it names, but the disclosure is incomplete -- it omits a same-expression, no-split bracket-notation variant that is at least as easy to write as the documented one. Filed as a comment on the existing #210 (same underlying defect class -- narrow syntactic-only .constructor.constructor check -- not a new duplicate issue; gh issue list --search "constructor bracket" / "bracket notation" returned no existing matches before commenting).

## Regression check

    npm test
    tests 876, pass 874, fail 2, skipped 0
    Failing: AC1-b (connector-fixture drift, central-classification.test.ts:43) and QA-15 (STATE.md bare-claim, completeness-claim-checker.test.ts:235) -- both match this round's brief's named pre-existing/disclosed/unrelated failures exactly. No new failures.

    node --test src/qa/kernel-purity-check.test.ts
    tests 50, pass 50, fail 0  (up from round 1's 43/43 -- 7 new tests: Issue #211 direct-call coverage, Issue #210 constructor-pivot coverage + false-positive guard fixture)

    npm run qa:kernel-purity
    [QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
    (non-vacuous, against the real production kernel -- matches round 1)

## Findings

### 1. [CLEAN][demonstrated] Issue #211 (alias-then-call bypass on fetch/setTimeout/setInterval/require) -- genuinely fixed
kernel-purity-check.ts:290-300 (detectDirectCallViolation), wired at kernel-purity-check.ts:338-340. All variants probed (basic, double-alias, cast-wrapped both ends) caught; eval control unaffected. Confirmed fixed -- issue closed.

### 2. [CLEAN][demonstrated] .call/.apply/.bind indirection was never live territory
Any property access on a forbidden root/alias fires regardless of method name (detectPropertyAccessViolation, pre-existing). Confirmed across 5 variants, zero bypasses.

### 3. [ISSUE][MED][demonstrated] Issue #210's disclosed variable-split residual is real and honestly disclosed for that shape
kernel-purity-check.ts:69-73 header disclosure; reproduced exactly, including a novel-payload variant. Already tracked by open Issue #210 -- no new issue needed for this part.

### 4. [ISSUE][MED][demonstrated] Issue #210's disclosure is incomplete -- an undisclosed, easier, same-expression bracket-notation bypass exists
asConstructorPropertyAccess (kernel-purity-check.ts:302-306) checks only ts.isPropertyAccessExpression, never ts.isElementAccessExpression with a literal "constructor" key -- ({})["constructor"]["constructor"]("return this")() and both mixed dot/bracket variants fully bypass both layers in a single expression, no split or alias required. Not exploitable today (same no-live-gate-wiring mitigating context as the original #210 finding). Minimal fix: extend asConstructorPropertyAccess to also match a literal-string-keyed ElementAccessExpression, or at minimum update the header comment to name this shape. Filed as a comment on the existing Issue #210 (duplicate-checked first); issue kept OPEN.

### 5. [CLEAN][demonstrated] No regression
876 tests, same 2 pre-existing/disclosed failures (AC1-b, QA-15), 0 new failures; kernel-purity-check.test.ts 50/50 (7 new, all passing); npm run qa:kernel-purity PASS non-vacuous against real src/policy/kernel/**.

## Findings to failing tests

Finding 3 and 4 map to one still-missing named test: "detectConstructorPivotViolation: a single-expression bracket-notation .constructor.constructor chain (obj["constructor"]["constructor"](...)), and the disclosed variable-split residual, are NOT currently detected (Issue #210)." Neither exists yet in the shipped diff -- this is the residual register entry for #210, which stays open.

## Verdict

APPROVE-WITH-CONDITIONS.

The blocking finding from round 1 (Issue #211, HIGH, demonstrated) is genuinely closed -- re-confirmed against the original probe plus every variant requested this round (double-aliasing, cast-wrapped alias at both ends, and .call/.apply/.bind indirection), with zero bypasses found. The remaining open item (Issue #210) is MED, exotic, and -- per the same mitigating context this reviewer's own precedent already established on this issue in round 1 -- not exploitable today because the kernel is not wired to a live gate. Its core demonstrated escape is closed; the residual (now shown to be broader than what the header discloses) does not itself block, consistent with round 1's own MED-non-blocking treatment of this same issue.

Condition: update the header comment (kernel-purity-check.ts:69-73) to also name the bracket-notation residual, or close it by extending asConstructorPropertyAccess to check ElementAccessExpression too -- either is acceptable, tracked on the reopened comment thread on Issue #210, not gating this ship.

Single next action: story-implementer either extends asConstructorPropertyAccess to cover literal-keyed ElementAccessExpression (closing Issue #210 for real) or updates the header disclosure to name the bracket-notation gap explicitly; either way, Issue #210 stays open and tracked, not silently dropped.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, ranked by exploitability x impact):
1. [CLEAN][demonstrated] src/qa/kernel-purity-check.ts:290-300 detectDirectCallViolation -- Issue #211 alias-then-call bypass on fetch/setTimeout/setInterval/require genuinely fixed; re-probed with original shape + double-alias + cast-wrapped-both-ends variants, zero bypasses, eval control intact. Issue #211 closed (state_reason: completed).
2. [CLEAN][demonstrated] src/qa/kernel-purity-check.ts:258-268 detectPropertyAccessViolation (pre-existing, unchanged) -- .call/.apply/.bind indirection was never live territory; any property access on a root/alias fires regardless of method name, confirmed across 5 variants.
3. [ISSUE][MED][demonstrated] src/qa/kernel-purity-check.ts:69-73 header disclosure -- Issue #210's disclosed variable-split .constructor.constructor residual is real and honestly disclosed for that shape; already tracked by open Issue #210, no new issue filed.
4. [ISSUE][MED][demonstrated] src/qa/kernel-purity-check.ts:302-306 asConstructorPropertyAccess -- undisclosed, easier bypass: single-expression bracket-notation .constructor chain (obj["constructor"]["constructor"](...)) fully bypasses both layers with no split/alias needed, not named in the header's disclosed-residual paragraph. Not exploitable today (no live gate wiring). Filed as a comment on existing Issue #210 (duplicate-checked, no new issue), kept open.
5. [CLEAN][demonstrated] npm test 876 tests, 874 pass, 2 fail (AC1-b, QA-15 -- both match this round's named pre-existing/disclosed failures exactly), 0 skipped, 0 new failures; node --test src/qa/kernel-purity-check.test.ts 50/50 (up from 43/43, 7 new tests); npm run qa:kernel-purity PASS non-vacuous against real src/policy/kernel/**, 4 files, zero violations.
counts (checksum): issues=2 suspicions=0 clean=3
evidence (checksum): demonstrated=5 code-traced=0 derived=0
checks="876/2/0 (npm test, 2 pre-existing/disclosed, 0 new) + 50/0/0 (kernel-purity-check.test.ts) + qa:kernel-purity PASS + 20+ independent adversarial probe samples across both issues|n/a"
adr=HIT(35)
report=docs/reviews/kernel-purity-ast-hardening-app-security-reconfirm-2026-09-17.md
