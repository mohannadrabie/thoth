# App Security re-confirm, round 6 -- delta 4720e8b..b94ed3e (Issue #372)

Reviewer: app-security-reviewer (Horus) - Date: 2026-09-29 - Tier: CRITICAL - Scope: `s312-fixnow-360-363`
Prior: `docs/reviews/s312-fixnow-360-363-app-security-round5-reconfirm-2026-09-29.md` (finding 1 MED, Issue #372).

ADR: `node docs/adr-cache.mjs --ensure` -> `ADR cache HIT: reused 37 ADR(s) ... [CACHE=HIT]`. No applicable security ADR violated (delta = `sanitize.test.ts` + CHANGELOG; `hooks/*.mjs`, `ci.yml` zero diff).

## Method
Own worktree `../thoth-as6` at b94ed3e (node_modules junction). Each mutant was inserted after `const input = JSON.parse(raw);` in the worktree hook copy only, under a tool-name trigger (`input.tool_name.endsWith("xtrig")`). Guard = full `src/policy/config/sanitize.test.ts`; probe = the registry-pinned gate sandbox spawning the real (mutated) hook with a hostile rationale (ESC, NL, NUL, C1) under three triggers (base, env `THOTH_X=1`, tool `xtrig`), checking the decoded deny reason for raw ESC/NUL. Baseline control mutant: guard 117 pass / 0 fail / 0 skipped, probe clean on all 3 triggers. Hook restored via `git checkout`, worktree removed (`git worktree list` shows the main tree only, directory gone).

## Round-5 shapes re-run on b94ed3e (all CLOSED)
| Shape | Guard | Probe (proves mutant live) | Evidence |
|---|---|---|---|
| K1 `"".__proto__.replace = ...` | FAILS AC-3 + AC-3h pin | tool: raw ESC/NUL leak | demonstrated |
| K2 `const s=""; s.__proto__.replace = ...` | FAILS AC-3 + AC-3h pin | leak | demonstrated |
| K3 `[("").__proto__.replace] = [...]` | FAILS AC-3 + AC-3h pin | leak | demonstrated |
| K4 `"".__proto__.__defineGetter__("replace", ...)` | FAILS AC-3 (banned name) | leak | demonstrated |
| K5 `const J = JSON; J.parse = ...` | FAILS AC-3 + AC-3h pin | (hook broken by mutant) | demonstrated |
| K6 `const P = Promise; P.prototype.then = ...` | FAILS AC-3 + AC-3h pin | no leak on this payload | demonstrated |

The probe leaks on K1-K4 prove those mutants are live, so the guard rejection is not vacuous.

## Attack on the combined AC-3 design
Goal: disable the sanitizer or reach `process.env`/`Function` from the gate hook with the guard green. About 60 mutants, all in the worktree copy.
- Write syntaxes (W1-W16, X1-X3): `??=`, `||=`, `&&=`, for-in/for-await targets, object/array rest targets, default targets, nested destructuring, `static {}` `this.x`, `super.x`, comma-parenthesised target, `import.meta.x`, `Error.prepareStackTrace =`, `[Error.prepareStackTrace] = [f]`, `delete Error.stackTraceLimit`. Every one FAILS AC-3h pin + AC-3. Unicode-escaped `.__proto__` and `constructor`: TS decodes the escape, still flagged (W10; W9 also broke the hook syntax).
- `process` (P1-P7): bare, in a template, shadowed as a parameter, aliasing: flagged by the name-based rule. `process.stdout`/`process.exit` as values, `.bind`, `._handle`, `.on(... function(){ this })` pass the guard and give no capability (probe clean).
- `undefined` (U1-U2): shadowed or passed as a value; guard green, nothing to gain (immutable constant).
- Allowed-global APIs (E1-E3, J1-J4, X4-X7): `Error.captureStackTrace(local)`, reviver `this`, object-literal getters into `JSON.stringify`, a thenable getter into `Promise.resolve`, `Promise.withResolvers`, long `.then/.catch/.finally` chains, `Promise.all.call(fake)`: guard green, probe clean, no capability. `Promise.prototype` is banned by name (K6), so no prototype handle exists.
- Handle reachability, measured: a property-graph search (own plus inherited, getters invoked, depth 5) from `process.stdin/stdout/stderr/exit`, `Error`, `JSON`, `Promise`, `node:path`, `node:url` and the six pinned module namespaces, with the seven banned names removed as edges, found NO path to `process`, `process.env`, `Function`, `AsyncFunction`, `Object`, `Reflect`, `globalThis` or any built-in prototype (266 objects visited). Control (same search with `constructor`/`__proto__`/`prototype` allowed) finds `process.exit.constructor => Function` and `process.stdin.constructor.once.constructor => AsyncFunction`, so the search is capable of finding them.
- Parser divergence (S2-S3): `accessor` fields break the hook under Node 24 (not a bypass); `using` needs `Symbol` (fails AC-3f). No TS-vs-Node divergence found that hides code from the scan.

## Findings

### 1. [LOW][demonstrated] AC-3 does not cover env reads made inside an imported module export (`catalog.projectDir()`); disclosed scope limit with a concrete instance
The hook already imports `classification-catalog.ts`, whose export `projectDir(env = process.env, ...)` (`src/policy/tools/classification-catalog.ts:55-57`) returns `CLAUDE_PROJECT_DIR ?? cwd()`. Mutant: `if (catalog.projectDir().endsWith("xtrig")) { process.exit(0); }` -> guard 117/0/0; probe with `CLAUDE_PROJECT_DIR=C:/xtrig`: exit 0, stdout length 0 (silent allow) versus exit 0, stdout length 115 (deny JSON) without it. So a diff can make the gate env-dependent with AC-3 green, evading the finite env matrix of AC-9.

Attack sketch: a hostile diff branches on an env value read through a pinned module default parameter. It adds nothing a model-controlled trigger (tool name; `process.exit(0)` is an allowed member) does not already give, so it is not a new capability, only a way around the env-matrix test.
Fix (hardening): pin the `namespace.member` pairs the hook uses (`loader.loadEffectivePolicy`, `catalog.assembleCatalog`, `catalog.moduleRelativeFixtureLocation`, `render.renderHookOutput`, ...) as an allow-list, same shape as ALLOWED_FREE_GLOBALS, or narrow the header to state the limit.
Exposure: ~0% of live requests, basis: counted in code (hook unwired, #308); needs a reviewed write to a named sensitive-area hook. Already named in the AC-3 header ("NOT proven ... a global that the hook reaches only through an imported module exports"). Non-gating, not filed (LOW).
Failing test (one, deferred to #308): `AC-3j: the hook uses only pinned namespace.member pairs of its imports`.

### 2. [CLEAN][demonstrated] The four #372 shapes plus the JSON and Promise aliases are closed by AC-3g/3h/3i; each fails the guard on the real-hook mutant (guard 115-116 pass / 1-2 fail); the leaks prove the mutants live.
### 3. [CLEAN][demonstrated] Deny-by-default member writes (AC-3h) hold across every assignment syntax tried (W1-W16, X1-X3); the AC-3h pin makes the empty allow-list follow the real hook.
### 4. [CLEAN][demonstrated] No name-free handle to Function, process.env or a built-in prototype: measured property-graph search from every reachable root, with a positive control; the `process` and `undefined` exemptions from AC-3i give no route.

## Scope limits, not findings (header: runtime behaviour NOT proven)
- A raw writer or `process.exit(0)` under a trigger passes any source-text scan (X8, and finding 1 mutant). AC-9 covers the unconditional form only. Inherent, already disclosed.

## Editorial
- The AC-3 header final "NOT proven" line is where finding 1 limit is stated; consider naming `projectDir` there.

## Verdict: APPROVE
Nothing gates (rule 21; live exposure 0%; hook unwired per #308). The successor class #372 named is closed and verified by mutation; no HIGH or MED found. One LOW hardening, deferred to #308 activation per the Manager plan.

Closeability: **#372 closable now** (reason: completed) for its stated scope: literal-rooted, local-rooted, destructuring and `__defineGetter__` patches, and alias-of-allowed-global writes.

Open findings 1 (LOW, no gate); failing tests to write 1 (`AC-3j`, deferred). No HIGH/MED.

Next action: close #372, then defer finding 1 to #308 activation.

RECEIPT: verdict=APPROVE
findings (ranked):
1. [ISSUE][LOW][demonstrated] src/policy/tools/classification-catalog.ts:55 via hooks/pretooluse-kernel-gate.mjs -- catalog.projectDir() reads CLAUDE_PROJECT_DIR through an imported export; env-triggered process.exit(0) passes AC-3 117/0/0 and yields silent allow; disclosed scope limit; fix: pin namespace.member allow-list (AC-3j) or narrow header; Exposure: ~0% of live requests, basis: counted in code (hook unwired #308).
2. [CLEAN][demonstrated] #372 shapes K1-K6 (literal/local/destructuring/__defineGetter__/JSON alias/Promise alias) all fail the guard on real-hook mutants; probe leaks prove mutants live.
3. [CLEAN][demonstrated] AC-3h member-write deny holds for 19 write syntaxes incl. Error.prepareStackTrace, logical assignment, rest/default/nested targets.
4. [CLEAN][demonstrated] No name-free route to Function/process.env/built-in prototype (266-object property-graph search with positive control); process and undefined exemptions give no route.
counts (a CHECKSUM): issues=1 suspicions=0 clean=3
evidence (a CHECKSUM): demonstrated=4 code-traced=0 derived=0
checks="117/0/0"
adr=HIT(37)
report=docs/reviews/s312-fixnow-360-363-app-security-round6-reconfirm-2026-09-29.md
