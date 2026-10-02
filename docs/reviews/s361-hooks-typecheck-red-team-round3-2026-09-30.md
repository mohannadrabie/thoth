# Red Team (Sutekh): s361-hooks-typecheck round 3 (final re-confirm), 2026-09-30

Scope: Issue #361 / #374 round-3 delta, CRITICAL tier. `git diff c0755bb 2e79a16 -- hooks src/qa/hook-typecheck* tsconfig.hooks*.json CHANGELOG.md` (commits 6bb9c40 red tests, c2e3040 fix; 2e79a16 is #326 editorial, skimmed only).
Bounded by the Manager ruling on #374: this is the final round. Any evasion of the checker-based scan is classified honestly and recommended as a ruled residual, not a round 4.

Method:
- Reviewed at `2e79a16` in an isolated worktree (`git worktree add ../thoth-rt361c 2e79a16 --detach`).
- `node_modules` and `adr/` were junction-linked read-only. Every mutant was planted there and reverted with `git checkout -- hooks` or `git checkout -- src/qa/...`. `git diff --stat -- hooks src tsconfig*.json` was empty before teardown.
- Both junctions were unlinked with `rmdir` before `git worktree remove --force`. The main tree's `node_modules` is intact (83 entries). Nothing in the main tree was edited except this report and the REVIEW_LOG row.

ADR: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`. Rules read: SE ADR-0010 (no inline type suppression without a comment and a human-approved exception), SE ADR-0021 (gate surfaces), ADR-0016 (self-protection).

## Verdict: go

What round 3 claimed, and what I confirmed:
- All five round-2 evasions (E1-E5) are now caught on the real relay hook. Each one gives QA-18 rc=1, with `npm run build` at rc=0, so QA-18 is the gate that catches it.
- The round-2 swap drill is caught.
- Guard mutant G1 (the throw turned into a fail-open return) is killed by the new real-process test.
- AC-7 holds: the delta changes 0 code tokens in all three hooks.
- N6a-e still fire.
- No test was weakened.

The checker approach is sound for what it inspects. It still has two blind spots, and both are **in the #374 class**:
- It only walks `tag.typeExpression`. An `any` written in a `@template` default (`[T=any]`) or in an `@extends {Base<any>}` clause is never looked at.
- It only asks whether each type node resolves to `any` at its top level. `any` nested inside a lib or imported alias passes: `{ReturnType<typeof Object.values>}` is `any[]` under another name.

Both hide a planted type error in the real SessionStart hook past build, QA-18 and lint (all rc=0). Exposure today is 0, measured: the 53 JSDoc type expressions in the hooks contain 8 `any`-syntax nodes, all 8 on the allow-list, plus 0 unspelled nested-`any` types and 0 `Function` references. A behavioural test catches the drill.

Per the ruling, this is MED, non-blocking, and should be recorded as a ruled residual. #374 can close.

## Attacks (ranked by exposure x irreversibility x silence)

### 1. [ISSUE][MED][demonstrated] The checker-based scan still misses `any` in unscanned JSDoc positions and `any` nested inside an alias
**Assumption broken:** the `collectJsdocAnySites` doc says it covers "Every JSDoc type node (any tag, any position ...)" and is "Spelling-independent by construction". The CHANGELOG says it "walks every JSDoc type node".

**Code:** `src/qa/hook-typecheck-coverage-check.ts:244` reads only `(tag as { typeExpression?: ts.Node }).typeExpression`, and `:224` tests only `checker.getTypeFromTypeNode(n).flags & Any` at each node. Two things follow:
- `JSDocTemplateTag.typeParameters[i].default` and `.constraint` are never visited, and neither is `JSDocAugmentsTag.class` / `JSDocImplementsTag.class`.
- A type whose top level is not `any` but which carries `any` inside it (element, property, index signature) passes.

Synthetic harness (scratchpad `.rt-harness3.mts`). `g` takes a number, the value that reaches it is a string, and an honest annotation gives TS2345. Rows are outcomes; the full per-case table was 54 cases across two runs.

| Result | Case | tsc | scan |
|---|---|---|---|
| control-ok | honest `{string}` / `{string[]}` | TS2345 | [] |
| caught | R2-E1 `{?}`, R2-E2 `@param x {any}`, R2-E3 split line, R2-E4 brace-desync string union with any, R2-E5 `ReturnType<typeof JSON.parse>` | none | flagged |
| caught | `@this {any}` | none | flagged |
| caught | `@overload @param {any}` over an honest `{string}` impl | none | flagged |
| caught | inline `/** @type {any} */ (x)` in a call arg | none | flagged |
| caught | `ReturnType<typeof h>` (h returns JSON.parse) | none | flagged |
| caught | `{typeof j}` (j = JSON.parse) | none | flagged |
| caught | `{...*}` | none | flagged |
| caught | `{function(any): void}` | none | flagged |
| caught | `{import("./anyt.js").Any}` (Any = any) | none | flagged |
| caught | orphan typedef at EOF | none | flagged |
| caught | typedef inside a function body | none | flagged |
| caught | `@callback`, `@property {any}` | none | flagged |
| not a suppression | `@template {any} T` | TS2345 | - |
| not a suppression | `@satisfies {any}`, `@enum {any}` | TS2345 (flagged anyway) | - |
| not a suppression | `@implements {I<any>}`, multi-declarator `@type {any}`, `{Object<string, any>}`, `{Record<string, any>}` | TS2345 | - |
| **EVADES** | `@template [T=any]` + `@typedef {{v: T}} Box`, `@param {Box} x` | none | [] |
| **EVADES** | `@template [T=any]` + `@typedef {T[]} List` | none | [] |
| **EVADES** | `@extends {Base<any>}` | none | [] |
| **EVADES** | `{import("./anyt.js").Loose}`, `@import { Loose }` (Loose = `{v: any}`) | none | [] |
| **EVADES** | `{ReturnType<typeof Object.values>}` (= `any[]`) | none | [] |
| **EVADES** | `{PropertyDescriptor}` (`.value: any`) | none | [] |
| **EVADES** | `{ReturnType<typeof Object.entries>}` | none | [] |
| **EVADES** (adjacent: not `any`, but untyped like `Object`) | `{Function}`, `{function}` | none | [] |
| EVADES (known residual) | double cast through `unknown` | none | [] |
| EVADES (out of class: no JSDoc) | `arguments[0]` | none | [] |

End to end on the real hook. The plant is `quoteNames(unknownConnectorNames)` changed to `quoteNames([unknownConnectorNames])` in `hooks/sessionstart-tool-enum.mjs`. It is a real bug: the connector detail text becomes a JSON array literal. It is hidden with a JSDoc-only respelling of the `@param {string[]} names` on `quoteNames`.

    N0 plant only (control)                              | build rc=2 TS2322 | QA-18 rc=1 | lint rc=0 | sessionstart tests 30 pass / 1 fail / 0 skipped
    N1 @template [T=any] + @typedef {T[]} NameList       | build rc=0        | QA-18 rc=0 | lint rc=0 | sessionstart tests 30 / 1 / 0
    N2 @param {ReturnType<typeof Object.values>} names   | build rc=0        | QA-18 rc=0 | lint rc=0 | sessionstart tests 30 / 1 / 0
    baseline (clean tree)                                | build rc=0        | QA-18 rc=0 | lint rc=0 | sessionstart tests 31 / 0 / 0

The one failing test in N1/N2 is `quoteNames: a name containing a literal double-quote is backslash-escaped`. That is the entire backstop for this plant.

**Current defence, assessed honestly:**
- Live exposure is 0, measured. My instrument (scratchpad `.rt-deepany.mts`) walks every JSDoc subtree in the three hooks, not only `typeExpression`, and runs a structural contains-`any` check over each type expression. It skips methods, arrays and tuples, so `string[]` stays a negative control.
- On the real hooks it reports `TOTAL jsdoc type expressions=53 any-syntax nodes=8 deep-any-unspelled=0 Function-refs=0`. The 8 `any`-syntax nodes are exactly the 8 allow-listed sites.
- Instrument controls: `ReturnType<typeof Object.values>`, `PropertyDescriptor` and `Box` (template default) are each flagged. `string[]` and `Record<string, unknown>` are not.
- Each evasion needs a visible JSDoc edit in a sensitive-area file under CRITICAL review.

**Exposure:** 0 of 53 JSDoc type expressions in hooks use an evading form (basis: measured). 2 of 2 real-hook respellings pass every static gate (basis: measured).

**Verdict:** BREAKS (MED). It is the same class as #374, so it goes on #374 as a comment rather than a new Issue. It does not block: there are no live sites.

**Recommendation within the ruling: record as a ruled residual and close #374.** Two cheap options, neither required:
- About 3 lines: `visitType` the whole JSDoc tag subtree (`ts.forEachChild(tag, ...)`) instead of only `typeExpression`. This closes the `@template` default and `@extends` forms, where the literal `any` keyword is in the text of the hook.
- The class-level fix for nested and alias `any`, and for `Function`, is not a better scanner. It is typed linting on the hooks: `@typescript-eslint/no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-return` and `no-unsafe-call`, with `parserOptions.project: tsconfig.hooks.json`. That catches the `any` where it is used, however it was spelled. `src/**/*.ts` already has `recommendedTypeChecked`, and the hooks block does not. This is backlog material, not a round 4.

**Named failing test (if the residual is not ruled):** `hook-typecheck-coverage-check.round3.test.ts`, "#374 r3: `any` in a `@template` default or an `@extends` clause is flagged". Cases: `@template [T=any]` + `@typedef {T[]} List` + `@param {List} x`, and `@extends {Base<any>}`.

### 2. [ISSUE][LOW][demonstrated] The site key is the enclosing function NAME, so a same-named or inner function can carry an allowed site
**Code:** `enclosingFunctionName` (`src/qa/hook-typecheck-coverage-check.ts:195-198`) walks up from the JSDoc owner. A JSDoc on a `const inner = (x) => ...` statement inside `f` resolves to `f`. So does a nested `function f` inside another function, or an object method named `f`.

Synthetic, with allow-list `f: @param x` x1 and the own param of `f` made honest:

    S1 inner const-arrow in f carries @param {any} x   | tsc none | scan []
    S2 same-name nested function f inside h            | tsc none | scan []
    S3 object method named f                           | tsc none | scan []
    S4 control: new function k                          | tsc none | scan [flagged "k: @param x"]

On the real hook, in `hooks/sessionstart-tool-enum.mjs`:
- The `@param {any} initialHaltState` on `reconcileReason` became `{unknown}`.
- An inner `/** @param {any} initialHaltState */ const loose = (initialHaltState) => initialHaltState;` was added.
- The planted bug was `writeHaltReason(sessionId, reasonKey, loose("true"), ...)`.

    SP0 control (plant, no wrapper)  | build rc=2 TS2345 | QA-18 rc=1 | lint rc=0
    SP1 spoof                        | build rc=0        | QA-18 rc=0 | lint rc=0 | sessionstart tests 18 pass / 13 fail / 0 skipped

The round-2 swap (re-homing the `any` onto `computeSessionTools`) is now caught: `QA-18 rc=1 [site computeSessionTools: @param initialHaltState]`. The spoof is narrower than round 2. It needs a new binding inside an allowed function (or a same-named function), which is a code-token change that AC-7-style review sees.

**Exposure:** 0% (basis: counted in code). The live test pins each of the 8 sites at an exact count, and the instrument shows the 8 `any`-syntax nodes unchanged.

**Named failing test:** "#374 allow-list site is bound to the declaring function node, not its name: an inner arrow or a same-named nested function does not inherit it". LOW, so no Issue.

### 3. [ISSUE][LOW][demonstrated] Test gap: nothing kills "the allow-list ignores which hook it is for"
Mutant K4 changes `if (a.hook === hook)` to `if (true)` (line 312). It survives 67 pass / 0 fail / 0 skipped. Round 2 had an equivalent mutant (M11), and it was killed. When the exact-contents pin moved to site keys, no test was left asserting that an allowed site in hook A does not excuse the same site string in hook B.

**Exposure:** 0%. The code is correct today. This is a test-coverage gap, not a defect. It would matter if, for example, `function failClosed(err)` with `@param {any} err` were copied into another hook.

**Named failing test:** "#374 r3: an allow-list entry for hook A does not excuse the identical site in hook B". LOW, so no Issue.

### 4. [ISSUE][LOW][demonstrated] An `any` from a production helper under a hooks/ subdirectory is never scanned
**Code:** `listProductionHooks` is non-recursive and only matches `.mjs` / `.js` (`src/qa/hook-typecheck-coverage-check.ts:137-142`). The suppression scan only sees listed hooks. The lint block for hooks is recursive (`hooks/**/*.mjs`), so `ban-ts-comment` still applies there, but lint has no JSDoc-`any` rule.

Drill: I created `hooks/lib/pass.mjs` with `/** @param {any} x */ export function pass(x) { return x; }`. The relay imported it and called `haltStatePath(pass(123))`.

    H1  build rc=0 | QA-18 rc=0 | lint rc=0 | relay tests 6 pass / 37 fail / 0 skipped
    // @ts-nocheck in the same helper: eslint reports 1 ban-ts-comment error (caught)

Related, code-traced and not a finding: a wired `.cjs`, `.mts` or `.cts` hook fails `qa:gate-command-path`, which needs a `.mjs` path in the command (`src/qa/gate-command-path-check.ts:52-54,116-118`). A wired `.mjs` in a hooks subdirectory would pass that check without QA-18 coverage.

**Exposure:** 0 production helper or subdirectory `.mjs` files exist (`ls hooks`: 3 hooks plus `test-support/`, basis: counted). The drill also needs a code-token change in a hook (the import and the call).

**Named failing test:** "QA-18 scans every .mjs/.js under hooks/ outside test-support/, recursively, or fails if one exists". LOW, so no Issue.

### 5. [CLEAN][demonstrated] The round-2 evasions and the swap drill are closed on the real hook
Plant: `haltStatePath(sessionId)` changed to `haltStatePath(123)` at `hooks/userpromptsubmit-halt-relay.mjs:486`, hidden by respelling the `@param` of the callee at `:349`.

    E0 plant only             | build rc=2 | QA-18 rc=1 | lint rc=0
    E1 {?}                    | build rc=0 | QA-18 rc=1 [@param {?} sessionId [site haltStatePath: @param sessionId]]
    E2 @param x {any}         | build rc=0 | QA-18 rc=1
    E3 split line             | build rc=0 | QA-18 rc=1
    E4 brace-desync union     | build rc=0 | QA-18 rc=1
    E5 ReturnType<JSON.parse> | build rc=0 | QA-18 rc=1
    SWAP (round-2 attack 2)   | build rc=0 | QA-18 rc=1 [site computeSessionTools: @param initialHaltState]

The new tag coverage also holds for `@this`, `@overload`, inline casts, `typeof` of `any`-returning functions and variables, rest `*`, callback `any`, orphan EOF typedefs and in-body typedefs (table in attack 1). **SURVIVES.**

### 6. [CLEAN][demonstrated] The degraded-arm guard is now pinned fail-closed
Target: `hooks/sessionstart-tool-enum-degraded-guard.test.ts`. Baseline: 1 pass / 0 fail / 0 skipped.

    G1 throw -> fail-open return { haltRequired:false ... }   | build rc=0 | guard test 0/1/0  (killed; survived in round 2)
    G2 === -> !==                                              | guard test 0/1/0  (killed)
    G4 guard message changed                                   | guard test 0/1/0  (killed: the test pins the detail text of the guard)
    G3 guard removed (if (false))                              | build rc=2        (killed by the union typing)

The test is not vacuous. It asserts that stderr contains `failed to resolve fixture location`, which proves the degraded arm was reached. **SURVIVES.**

### 7. [CLEAN][demonstrated] AC-7 holds (0 code tokens), and N6 still fires
Token diff (round-1 `tokdiff.mjs`, leaf AST tokens without JSDoc, LCS):

    vs c0755bb: sessionstart old=1366 new=1366 diffs=0 | relay 1130/1130 diffs=0 | kernel gate 630/630 diffs=0
    vs e26e7aa: sessionstart diffs=25 (unchanged from round 2) | relay 0 | kernel gate 0
    git diff --stat c0755bb 2e79a16 -- hooks/*.mjs: empty

    N6a evaluateToolInventory(merged)               | build rc=2 [(535,22) TS2554] | QA-18 rc=1
    N6b trustedUnlockHint(key)                      | build rc=2 [(457,89) TS2554] | QA-18 rc=1
    N6c composeFullMessage([trustedLine], ...)      | build rc=2 [(421,42) TS2345] | QA-18 rc=1
    N6d writeHaltReason(..., "true", ...)           | build rc=2 [(368,43) TS2345] | QA-18 rc=1
    N6e computeSessionTools(123)                    | build rc=2 [(613,76) TS2345] | QA-18 rc=1

**SURVIVES.**

### 8. [CLEAN][demonstrated] No test was weakened, and the scanner mutants are mostly killed
**The fixnow.test.ts pin replacement.** The annotation-keyed exact-contents pin was removed and re-created as a site-keyed exact pin in `round3.test.ts` (8 sites, exact counts).

The live test now checks, per entry:
- that removing the entry reports the site;
- that lowering its count by 1 reports the site.

Over-count is already a scan failure. That is equivalent to or stronger than the old `source.split(annotation)` equality.

The three dropped real-relay assertions (orphan `@param {any} haltState`, `brandNew` and `Object` appended at EOF) still hold under the new scanner. I ran all three: each is flagged at `[site <module>: ...]`. Their replacements (the same annotations attached to a new function) are stricter in meaning, not looser.

**Scanner mutants,** run over the three QA-18 test files (baseline 67 pass / 0 fail / 0 skipped):

    K3 site drops the function name          60/7/0   killed
    K6 Object arm dropped                    61/6/0   killed
    K7 site count ignored (presence only)    65/2/0   killed
    K8 top-level statements only             62/5/0   killed
    K9 no descent into type children         38/29/0  killed
    K10 site drops the tag target            60/7/0   killed
    K1 drop JSDocAll/Unknown from isTypeLike 67/0/0   EQUIVALENT (ts.isTypeNode already returns true for JSDocUnknownType and JSDocAllType, verified)
    K2 descend into a flagged any            67/0/0   fail-closed direction only (double-counts a union that absorbs any; cannot excuse anything)
    K4 allow-list ignores hook               67/0/0   SURVIVES -> attack 3
    K5 "not in program" returns findings     67/0/0   unreachable (checkHookTypecheckCoverage guards with fileNames.includes at :390; regenerateBaseline at :508)

**SURVIVES.**

## Scariest unproven assumption
That the `any` which hides a bug will be written where the scanner looks. The scanner now looks at the resolved type of every `typeExpression` node. `any` can still enter through a `@template` default the walk never enters, or sit one level down inside a lib type (`ReturnType<typeof Object.values>`). In the drill, one quoting test was all that stood behind it. The class-level answer is typed linting on the hooks (no-unsafe-*), not a fourth scanner revision.

## Go / no-go
**go.** No HIGH. The one MED (attack 1) is in the #374 class, has 0 live sites (measured over all 53 JSDoc type expressions), and is caught by a behavioural test in the drill. Per the ruling of the Manager it is a ruled residual, and #374 can close.

## Single next action
Manager: record attack 1 as the ruled residual for #374 in `docs/decisions.md` and close #374. Optionally take the 3-line whole-tag-subtree walk now. File the hooks typed-lint hardening (`no-unsafe-*` with `parserOptions.project: tsconfig.hooks.json`) as a Backlog chore.

## Open findings to failing tests
Open findings: 4 (#1 MED, #2-#4 LOW). Named failing tests: 4, one per finding, named above. They match. #1 is expected to resolve to a residual-register line under the ruling instead.

## Environment note (not a finding)
In my worktree, `npm test` gave 1716 tests: 1715 pass / 1 fail / 0 skipped. The failure is `src/secret-scan/pre-commit-scan.test.ts:201` "R4: a fresh LOCAL clone ... blocks a real commit containing a secret". The error was `EBUSY: resource busy or locked, rmdir C:\Users\mohan\AppData\Local\Temp\thoth-fresh-clone-*`. It reproduced in isolation (25 pass / 1 fail / 0 skipped). The file is untouched by c0755bb..2e79a16, and the failure is a Windows temp-directory lock during cleanup, not an assertion. UNPROVEN-pending-verification: the CI run on the PR settles it (owner: Manager).

## Editorial (uncounted, verdict-neutral)
- `src/qa/hook-typecheck-coverage-check.ts` `collectJsdocAnySites` doc says "Every JSDoc type node (any tag, any position ...)" and "Spelling-independent by construction". `@template` defaults and constraints and `@extends` / `@implements` class expressions are not walked, and nested `any` behind an alias is not seen.
- The `scanHookSuppressions` "WHAT IT DOES NOT CATCH" list names only the double cast and unattached JSDoc. It should add the `@template` default, `@extends`, nested `any` via lib or imported alias, `{Function}`, and helper modules outside `hooks/*.mjs`.
- The `tsconfig.hooks.json` header, "flags every JSDoc type node the checker resolves to `any` (... aliases ...)", has the same overclaim for aliases whose `any` is nested.
- The CHANGELOG round-3 entry, "walks every JSDoc type node in each `hooks/*.mjs`", has the same overclaim.

RECEIPT: verdict=go
attacks:
1. [ISSUE][MED][demonstrated] checker scan still evadable in-class: `@template [T=any]` default and `@extends {Base<any>}` are unvisited (only tag.typeExpression is walked, :244), and nested any via lib/imported alias (`ReturnType<typeof Object.values>`=any[], PropertyDescriptor, import Loose) passes (top-level-only check, :224); also `{Function}`; real-hook N1/N2 hide a TS2322 with build/QA-18/lint rc=0, 1 behavioural test catches it; 0/53 live JSDoc type exprs (measured); ruled-residual recommended, commented on #374, no new Issue
2. [ISSUE][LOW][demonstrated] site key = enclosing function NAME: inner const-arrow or same-named nested function/method inherits an allowed site; real SP1 (reconcileReason honest + inner `loose`) build/QA-18/lint rc=0, sessionstart 13 fail; needs a code-token change; round-2 swap now caught
3. [ISSUE][LOW][demonstrated] test gap: mutant K4 (allow-list ignores hook) survives 67/0/0; round-2 M11 was killed; 0% exposure, code correct today
4. [ISSUE][LOW][demonstrated] any from a hooks/lib/*.mjs helper is never scanned (listProductionHooks non-recursive, :137-142): H1 build/QA-18/lint rc=0, relay 37 fail; @ts-nocheck there caught by lint; 0 such files; wired .cjs/.mts fail gate-command-path
5. [CLEAN][demonstrated] round-2 E1-E5 each QA-18 rc=1 on real relay (build rc=0); swap drill QA-18 rc=1; @this/@overload/inline cast/typeof any/rest */callback/EOF + in-body typedef/@callback/@property all flagged
6. [CLEAN][demonstrated] degraded guard pinned: G1 fail-open killed (0/1), G2 killed, G4 message killed, G3 build rc=2
7. [CLEAN][demonstrated] AC-7: 0 token diffs vs c0755bb for all three hooks (git diff empty); vs e26e7aa 25/0/0 unchanged; N6a-e build rc=2 + QA-18 rc=1
8. [CLEAN][demonstrated] no test weakened: site-keyed exact pin replaces text pin; live without/lowered checks at least as strong; the 3 dropped orphan-EOF assertions still flagged by the new scanner; K3/K6-K10 killed, K1 equivalent, K2 fail-closed only, K5 unreachable
counts: issues=4 suspicions=0 clean=4
evidence: demonstrated=8 code-traced=0 derived=0
checks=build rc=0; tsc hooks rc=0; QA-18 PASS (3 hooks); eslint hooks+src/qa rc=0; QA-18+guard tests 68/0/0; npm test 1716: 1715/1/0 (1 = EBUSY rmdir in secret-scan fresh-clone test, reproduced in isolation 25/1/0, file outside delta, environmental); synthetic harness 54 cases (13 evade: 2 template-default, 1 extends, 5 nested/alias, 2 Function, 1 double-cast residual, 1 arguments out-of-class, plus the 2-row control set ok); real-hook E0-E5 6/6 as expected; SWAP caught; N0-N2 (2 evade static, behavioural 1 fail); SP0/SP1 (spoof static-green, behavioural 13 fail); H1 static-green, behavioural 37 fail; guard G1-G4 4/4 killed; N6a-e 5/5 build rc=2; scanner mutants K1-K10: 6 killed, 1 equivalent, 1 fail-closed-only, 1 unreachable, 1 survives (K4); deep-any instrument: real hooks 53 exprs / 8 any-syntax = 8 allow-listed / 0 unspelled / 0 Function, controls 3/3 flagged + 2/2 negatives clean; tokdiff 0/0/0 vs c0755bb
adr=HIT(37)
report=docs/reviews/s361-hooks-typecheck-red-team-round3-2026-09-30.md
