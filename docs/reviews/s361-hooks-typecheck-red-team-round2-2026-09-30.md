# Red Team (Sutekh): s361-hooks-typecheck round 2 (re-confirm), 2026-09-30

Scope: Issue #361 round-2 fix-now delta for #374 (MED) and round-1 finding 6 (LOW, mutant M8), CRITICAL tier. `git diff eb0b2d2 c0755bb -- hooks src/qa/hook-typecheck* tsconfig.hooks*.json CHANGELOG.md`, which covers commits 20effa5, 46a1069, 1c10aee and c0755bb.
Reviewed at `c0755bb` in an isolated worktree (`git worktree add ../thoth-rt361b c0755bb --detach`). `node_modules` and `adr/` were junction-linked read-only, and every mutant was planted there and reverted with `git checkout` (`git status --short` was clean after each batch). I unlinked both junctions before running `git worktree remove`. The main tree's `node_modules` is intact (83 entries), and I edited nothing in the main tree except this report and the REVIEW_LOG row.
ADR: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`. Rules read: SE ADR-0010 (no inline type suppression without a comment and a human-approved exception), SE ADR-0021 (gate surfaces), ADR-0016 (self-protection).

## Verdict: go

The live part of #374 is closed. `computeSessionTools` is typed honestly, the call site that used to be hidden is now checked (N6e: `computeSessionTools(123)` makes `npm run build` return rc=2 with TS2345), and the compiler now forces the degraded arm to be handled (removing the guard gives TS2345). A checker-based instrument finds exactly 8 `any`-typed JSDoc nodes in the real hooks, which equals the 8 pinned allow-list occurrences.

AC-7 holds, measured with the round-1 instrument. SessionStart differs from e26e7aa by exactly 17 guard tokens plus 4 paren pairs (25 tokens). Halt-relay and the pretooluse gate differ by 0. When I forced the degraded path at runtime, the old and new hook both write `SUR-03-enumeration-failed set:true` and exit 0; only the disclosed detail text changes. M8 is killed, and so are four new scan mutants. N6 still fires.

**#374 is not fully closed as a class, though.** The widened scan is still a spelling regex, and four spellings of explicit `any` get a real TS2345 in the real halt-relay past tsc, QA-18 and lint (all rc=0). Exposure today is 0 sites (measured), and the behavioural hook tests backstop the plant, so this stays MED and non-blocking. It is tracked as a comment on #374, not as a new Issue.

## Attacks (ranked by exposure x irreversibility x silence)

### 1. [ISSUE][MED][demonstrated] The widened JSDoc-`any` scan can still be evaded by alternate spellings of `any`
**Assumption:** the CHANGELOG and the `scanHookSuppressions` doc say QA-18 "flags `any`, `Object` and bare `*` in ANY JSDoc type".
**How it breaks:** `collectJsdocTypeAnnotations` (`src/qa/hook-typecheck-coverage-check.ts`, the new function after the allow-list) only matches `@tag[ \t]*{` with the type immediately after the tag. It balances braces without knowing about string literals, and `ANY_LIKE_TYPE` never matches the JSDoc unknown type `?`. TypeScript accepts every one of the forms below.

Harness (scratchpad `harness.mts`): `g` takes a number, `f(x)` returns `g(x)`, and `f("s")` is called, so an honest type produces TS2345.

    control-ok  | control honest {string}                       | tsc=TS2345 | scan=[]
    caught      | {any} {?any} {any=} {...any}, @arg, @argument, @typedef {any} X, unicode-escaped any | tsc=none | scan=[flagged]
    EVADES      | {?}  (JSDoc unknown type)                     | tsc=none   | scan=[]
    EVADES      | name-before-type   @param x {any}             | tsc=none   | scan=[]
    EVADES      | tag/type split by newline   @param NL * {any} x | tsc=none | scan=[]
    EVADES      | string-literal brace   {"}" | any}            | tsc=none   | scan=[]
    EVADES      | lib-derived {ReturnType<typeof JSON.parse>} (out of the claimed class) | tsc=none | scan=[]
    not-a-supp  | {!Object} {Object<string,*>} {Array<*>}: strict JSDoc Object is not any; the scan flags them anyway (fail-closed)

End to end on the real hook: I planted `haltStatePath(123)` in `hooks/userpromptsubmit-halt-relay.mjs` and hid it by respelling the callee JSDoc `@param`.

    E0 real bug, no hiding                         | tsc rc=2 [TS2345] | QA-18 rc=1 | lint rc=0
    E1 @param {?} sessionId                        | tsc rc=0          | QA-18 rc=0 | lint rc=0
    E2 @param sessionId {any}                      | tsc rc=0          | QA-18 rc=0 | lint rc=0
    E3 @param NL * {any} sessionId                 | tsc rc=0          | QA-18 rc=0 | lint rc=0
    E4 @param {"}" | any} sessionId                | tsc rc=0          | QA-18 rc=0 | lint rc=0
    E5 @param {ReturnType<typeof JSON.parse>} ...  | tsc rc=0          | QA-18 rc=0 | lint rc=0
    C1 @param {any} sessionId (control)            | tsc rc=0          | QA-18 rc=1 | lint rc=0

**Current defence, assessed honestly:**
- The behavioural suite still catches this particular plant: E2 in place gives halt-relay tests 6 pass / 37 fail / 0 skipped.
- The real hooks carry none of these spellings today. My checker-based instrument (scratchpad `astany.mts`) walks every JSDoc `typeExpression` and asks `checker.getTypeFromTypeNode(node).flags & Any`. On the real hooks it reports `TOTAL any-typed JSDoc type nodes: 8`: the same 8 sites as `JSDOC_ANY_ALLOWLIST` (1+2+1+1+1+2), with no hidden ones.
- The same instrument flags every evasion above (E1-E5 all reported, 6 nodes), so a spelling-independent fix is proven feasible.

**Exposure:** 0 of 8 current any-typed JSDoc nodes use an evading spelling (basis: measured). 4 of 4 tested alternate in-class spellings pass every static gate (basis: measured).
**Verdict:** BREAKS (MED). This is the same finding class as #374, so it goes on #374 as a comment rather than a new Issue. It does not block: there are no live sites, and the behavioural backstop holds.
**Named failing test:** `hook-typecheck-coverage-check.fixnow.test.ts`, "#374 class: every JSDoc type node that resolves to `any` via the TypeScript checker (not a regex) is on the allow-list". Cases: `{?}`, `@param x {any}`, `@param` NL ` * {any} x`, `{"}" | any}`, `{ReturnType<typeof JSON.parse>}`. Cheapest fix: replace or augment `collectJsdocTypeAnnotations` with the checker walk, keyed per site.

### 2. [ISSUE][LOW][demonstrated] The allow-list is keyed by annotation text, not by site, so a count-neutral swap can re-home an `any`
**Scenario:** I made one real site more honest (on `reconcileReason`, `@param {any} initialHaltState` became `{unknown}`) and renamed the parameter of `computeSessionTools` to `initialHaltState` with `@param {any} initialHaltState`. Then I planted `computeSessionTools(123)` at the call site.

    tsc rc=0 | QA-18 rc=0 | lint rc=0 | QA-18 tests 51 pass / 0 fail / 0 skipped | sessionstart tests 24 pass / 6 fail / 0 skipped

The allow-list key is `@param {any} initialHaltState` x2, and a pure count-and-string check cannot tell which function carries it.
**Current defence:** it needs a visible parameter rename in a sensitive-area diff, and the behavioural tests catch this plant.
**Exposure:** 0% (basis: counted in code; no such swap exists, and the checker instrument shows the 8 sites unchanged).
**Named failing test:** "#374 allow-list is per-site: each entry is pinned to its enclosing function name as well as the annotation text". LOW, so no Issue.

### 3. [ISSUE][LOW][demonstrated] The new guard's fail-closed property has no test
**Scenario:** G1 changes the guard's `throw` into `return { inventoryResult: { haltRequired: false, unclassified: [] }, unknownConnectorNames: [] }`, a fail-open that is silent: no halt reason is written.

    G1 fail-open guard:            tsc rc=0 | sessionstart tests 30 pass / 0 fail / 0 skipped   (survives)
    G2 inverted guard (!==):       sessionstart tests 9 pass / 21 fail                          (killed)
    G3 guard removed (if (false)): tsc rc=2 TS2345                                              (killed by the new typing)

This gap predates the change. The implicit `readFileSync(null)` throw it replaced was not tested either. The explicit branch is simply an easier point to weaken.
**Exposure:** 0% of SessionStart runs (basis: counted in code). `resolveFixtureLocation` is pure and non-throwing (`src/policy/tools/classification-catalog.ts:60-65`), so the degraded arm is unreachable in production.
**Named failing test:** `hooks/sessionstart-tool-enum.test.ts`, "when fixture resolution fails, SessionStart writes SUR-03-enumeration-failed set:true (degraded arm is fail-closed)". It needs an injection seam, or a spawned copy with the resolver forced to throw, as in my drill in attack 7. LOW, so no Issue.

### 4. [ISSUE][LOW][demonstrated] Suppression by type assertion (`@type {T}` over `@type {unknown}`) is outside every gate
The harness case `g(/** @type {number} */ (/** @type {unknown} */ (x)))` with `x: string` gives `tsc=none`, `scan=[]`. This is the JS spelling of `as unknown as T`, and no scan, lint rule or baseline sees it. It is out of the scan's claimed class (pragmas, eslint-disable, explicit `any`), so this is a disclosed residual, not a defect in the #374 fix.
**Exposure:** 0 casts through `unknown` in hooks today (basis: counted, `grep -cE '@type \{unknown\}' hooks/*.mjs`: 0/0/0). The only assertions are the 4 `@type {Error}` catch-variable casts.
**Named failing test:** "QA-18 flags a JSDoc `@type` assertion whose operand is itself an `@type {unknown}` assertion (double cast)", or a decisions.md line ruling the class a residual. LOW, so no Issue.

### 5. [CLEAN][demonstrated] The live #374 site is genuinely closed, and N6 still fires

    N6a sessionstart evaluateToolInventory(merged)         npm run build rc=2 [(535,22) TS2554] QA-18 rc=1
    N6b relay trustedUnlockHint(key)                       npm run build rc=2 [(457,89) TS2554] QA-18 rc=1
    N6c relay composeFullMessage([trustedLine], ...)       npm run build rc=2 [(421,42) TS2345] QA-18 rc=1
    N6d sessionstart writeHaltReason(..., "true", ...)     npm run build rc=2 [(368,43) TS2345] QA-18 rc=1
    N6e computeSessionTools(123) (round-1 hidden site)     npm run build rc=2 [(613,76) TS2345] QA-18 rc=1

The checker instrument finds no `any` on `fixtureLocation`. G3 (guard removed) gives TS2345, so the union typing forces the degraded arm to be handled. Baseline at c0755bb: `npm run build` rc=0, `tsc -p tsconfig.hooks.json` rc=0, QA-18 PASS (3 hooks, 0 diagnostics), `npx eslint hooks/ src/qa/` rc=0, and `npm test` 1690 tests, 1690 pass / 0 fail / 0 skipped (with `adr/` linked). **SURVIVES.**

### 6. [CLEAN][demonstrated] The allow-list cannot be silently extended, and M8 plus the new scan arms are killed

    QA-18 tests baseline                                 51 pass / 0 fail / 0 skipped
    A1 new allow-list entry + new any site               QA-18 rc=0 | tests 49/2/0  (pinned-contents + fixtureLocation tests)
    A2 bump initialHaltState x2->x3 + 3rd site           QA-18 rc=0 | tests 50/1/0  (pinned-contents test)
    A3 new any site, list untouched                      QA-18 rc=1 | tests 47/4/0
    M8 countByIdentity occurrence count -> set           tests 50/1/0  (killed by the new M8 test; survived in round 1)
    M10 scan restricted to @type only                    tests 42/9/0
    M11 allow-list hook key ignored                      tests 50/1/0
    M12 per-annotation count cap dropped                 tests 50/1/0
    M13 Object arm of ANY_LIKE_TYPE dropped              tests 46/5/0

Extension (A1/A2) is caught by `npm test` and not by the QA-18 CLI step itself. That is by design: the test file pins the list, so extending it means a visible test edit. The swap residual is attack 2. **SURVIVES.**

### 7. [CLEAN][demonstrated] AC-7: the runtime delta is exactly the enumerated guard, and halt/allow is unchanged
Round-1 instrument (`tokdiff.mjs`: leaf AST tokens without JSDoc, LCS diff) against e26e7aa:

    hooks/sessionstart-tool-enum.mjs:      old=1341 new=1366 diffs=25
      + if ( fixtureLocation . fixtureSource === "unknown" ) { throw new Error ( "the classification fixture location could not be resolved" ) ; }   (17 tokens)
      + ( ) x4   (the 4 cast paren pairs, unchanged from round 1)
    hooks/userpromptsubmit-halt-relay.mjs: old=1130 new=1130 diffs=0
    hooks/pretooluse-kernel-gate.mjs:      old=630  new=630  diffs=0   (git diff e26e7aa c0755bb: 0 lines)

Controls, re-based on c0755bb: the file against itself gives diffs=0. NC `===` to `!==` gives 2 diffs. NC changed message text gives 2 diffs. PC comment-only and JSDoc-prose edits give 0 diffs. My first control against e26e7aa was not discriminating (every guard token is already a `+`), so I discarded it and re-based.

Runtime drill: in copies of the eb0b2d2 and c0755bb hooks, I forced `resolveFixtureLocation` to throw and ran each with a temp `CLAUDE_PROJECT_DIR` and `session_id: rt-drill-1`.

    eb0b2d2 exit=0  SUR-03-enumeration-failed set=true | internal exception during tool enumeration: The "path" argument must be of type string ... Received null
    c0755bb exit=0  SUR-03-enumeration-failed set=true | internal exception during tool enumeration: the classification fixture location could not be resolved

Halt/allow is identical, and the halt-state keys are identical (sessionId, reasons, fixtureSource, fixturePath). Only the disclosed detail changed, and the new text is clearer. The default parameter of `loadCentralClassificationFixture` does not fire on `null`, so the old path did throw and never silently loaded the default fixture. No test pins the old message (grep over hooks and src tests: 0 hits). **SURVIVES.**

## Scariest unproven assumption
That anyone silencing a type error in a hook will spell it `{any}`. The gate is still a spelling list. `@param x {any}` is ordinary JSDoc that TypeScript accepts, and it hides a real bug from tsc, QA-18 and lint (E2). Only the behavioural tests stand behind it, and they cover what they happen to exercise.

## Go / no-go
**go.** No HIGH. The one MED (attack 1) has 0 live sites, a behavioural backstop, and a proven spelling-independent fix. It is tracked on #374.

## Single next action
Manager: decide whether #374 closes on this round, with attack 1 recorded as a ruled residual in decisions.md, or stays open until QA-18 uses the checker walk (attack 1's named test). The walk is about 40 lines; the proof is `astany.mts` in the review scratchpad.

## Open findings to failing tests
Open findings: 4 (#1 MED, #2-#4 LOW). Named failing tests: 4, one per finding, named above. They match. #4 may instead resolve to a residual-register line.

## Editorial (uncounted, verdict-neutral)
- CHANGELOG.md, #374 entry: "QA-18 now flags `any`, `Object` and bare `*` in ANY JSDoc type" overclaims (attack 1: `{?}`, name-first, split-line and brace-desync forms are not flagged).
- CHANGELOG.md, older #361 residual line: "fixed in round 2 below". The round-2 (#374) entry sits above it (newest on top).
- `scanHookSuppressions` doc: "The class, not a list of spellings" does not match the implementation, which is a regex over spellings.
- `tsconfig.hooks.json` header: "QA-18 bans `any`/`Object`/`*` in JSDoc" inherits the same overclaim.

RECEIPT: verdict=go
attacks:
1. [ISSUE][MED][demonstrated] widened JSDoc-any scan is still spelling-evadable: `{?}`, `@param x {any}`, `@param` NL ` * {any} x`, `{"}" | any}` (+ lib-derived ReturnType<typeof JSON.parse>) hide a real TS2345 in real halt-relay with tsc/QA-18/lint all rc=0; 0 live sites (checker instrument: 8 any-nodes = 8 allow-listed); behavioural tests catch the plant (37 fail); tracked on #374 (same class), not a new Issue
2. [ISSUE][LOW][demonstrated] allow-list keyed by annotation text, not site: count-neutral swap re-homes `@param {any} initialHaltState` onto computeSessionTools + `computeSessionTools(123)`; tsc/QA-18/lint/51 QA-18 tests green, sessionstart tests 6 fail
3. [ISSUE][LOW][demonstrated] new degraded-arm guard's fail-closed property untested: G1 throw->clean return survives tsc + 30/30 sessionstart tests; 0% exposure (resolveFixtureLocation pure, arm unreachable); pre-existing gap
4. [ISSUE][LOW][demonstrated] double-cast `@type {T}` over `@type {unknown}` hides a mismatch outside every gate; out of the scan's claimed class; 0 sites in hooks today
5. [CLEAN][demonstrated] live #374 site closed: N6a-d fire, N6e computeSessionTools(123) build rc=2 TS2345, guard removal TS2345; build/tsc/QA-18/eslint green; npm test 1690/0/0
6. [CLEAN][demonstrated] allow-list extension caught (A1 2 fail, A2 1 fail, A3 QA-18 rc=1 + 4 fail); M8 killed (was surviving); M10-M13 scan mutants killed
7. [CLEAN][demonstrated] AC-7: sessionstart exactly +17 guard + 4 paren pairs (25) vs e26e7aa, relay 0, kernel gate 0, controls 2 NC + 1 PC + self 0; forced degraded path old vs new: identical ENUMERATION_FAILED set:true, exit 0, detail text only
counts: issues=4 suspicions=0 clean=3
evidence: demonstrated=7 code-traced=0 derived=0
checks=build rc=0; tsc hooks rc=0; QA-18 PASS; QA-18 tests 51/0/0; hook tests 73/0/0; npm test 1690/0/0; eslint rc=0; evasion harness 22 cases (7 evade [4 in-class + 2 lib-derived + 1 double-cast], 8 caught, 6 not-a-suppression, 1 control-ok); real-hook evasion drill E0-E5 + C1 as reported; checker instrument real hooks 8 = allow-list 8, evasions 5/5 flagged; allow-list mutants A1-A3 3/3 caught; M8 + M10-M13 5/5 killed; guard mutants G1 survived, G2/G3 killed; swap drill static-green / behavioural 6 fail; N6a-e 5/5 build rc=2; tokdiff 25/0/0 with 4/4 controls as expected; degraded-path runtime drill 2/2 identical halt
adr=HIT(37)
report=docs/reviews/s361-hooks-typecheck-red-team-round2-2026-09-30.md
