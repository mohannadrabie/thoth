# App Security re-confirm, round 4 -- delta 4454413..a1f3d27 (Issues #360, #369, #370)

Reviewer: app-security-reviewer (Horus) - Date: 2026-09-29 - Tier: CRITICAL - Scope: `s312-fixnow-360-363`
Prior: `docs/reviews/s312-fixnow-360-363-app-security-round3-2026-09-29.md` (APPROVE-WITH-CONDITIONS; F1 render pin, F2 AC-3 routes).

ADR: `node docs/adr-cache.mjs --ensure` -> `ADR cache HIT: reused 37 ADR(s) ... [CACHE=HIT]`. No applicable security ADR violated (delta = `sanitize.test.ts` + CHANGELOG; `hooks/*.mjs`, `ci.yml` zero diff).

## Method
Own worktree `../thoth-as4` at a1f3d27 (node_modules junction). Mutants planted only in the worktree hook copy; a probe test spawned the real hook (registry-pinned sandbox, hostile rationale with ESC, NL, NUL, C1) and inspected the decoded deny reason plus raw stdout. Guard = the two real-hook tests of `sanitize.test.ts` (AC-7/AC-7c wiring, AC-3 environment scan). Baseline in worktree: `sanitize.test.ts` + `pretooluse-kernel-gate-sanitize.test.ts` 71 pass / 0 fail / 0 skipped; control mutant: guard 2/0, probe clean on all 3 triggers.
Cleanup: hook restored via `git checkout`, probe file and planted `evil-render.ts` deleted, worktree deregistered (`git worktree list` shows only the main tree). The now-empty directory `C:/playground/thoth-as4` could not be removed (Windows reports device or resource busy; no git object left); a human may `rmdir` it.

## Round-3 findings 1 and 2, re-run against a1f3d27

| Round-3 shape (planted in the real hook) | Guard result | Probe | Evidence |
|---|---|---|---|
| F1: `render` import retargeted to `evil-render.ts` (env-gated identity sanitizer) | AC-7 + AC-3 both FAIL (0 pass / 2 fail) | n/a | demonstrated |
| Retarget `gate`, `catalog` imports | FAIL 0/2 each | hook exit 2 | demonstrated |
| Swap `render`/`loader` element order | AC-7 FAIL (1 pass / 1 fail) | -- | demonstrated |
| `import(spec, { with: {} })` for render | AC-7 FAIL (1/1) | -- | demonstrated |
| F2: `Function("return process")().env` | AC-3 FAIL (1/1) | env=X raw ESC/NUL leaks (proves the mutant was live) | demonstrated |
| F2: `process.exit.constructor(...)` | AC-3 FAIL | leaks | demonstrated |
| F2: `import("node:" + "process")` | AC-3 FAIL | leaks | demonstrated |
| F2: `(0, eval)("process.env")` | AC-3 FAIL | leaks | demonstrated |
| Control: extra `import(/* c */ "<sanitize spec>" /* d */)` | green (benign, same module; comments inside specifiers do not confuse `.text`) | clean | demonstrated |
| `with (process.exit) {...}` | AC-3 FAIL; hook does not even load (ESM strict) | -- | demonstrated |

Round-3 F1 and F2 are CLOSED for the shapes named. The allow-list, the index pins and the JSDoc type-only `import()` carve-out behave as the tests state; node:url and node:path expose no route to `process` on their own.

## Findings

### 1. [MED][demonstrated] NEW, not a recorded residual: AC-3 still finds Function by spelling; reflective lookups with a string key reach it unflagged
`findEnvironmentAccess` flags the identifier `constructor` and non-numeric ELEMENT access, but a property NAME held in a string literal, template, computed key or `String.fromCharCode` is never inspected when it is a call argument or a binding-pattern key. Six planted routes, each keeping AC-7 and AC-3 green (guard 2 pass / 0 fail) while the env-gated probe leaks raw ESC and NUL (`env={} rawESC=false rawNUL=false`, `env={THOTH_X=1} rawESC=true rawNUL=true`):
- `Reflect.get(Object.getPrototypeOf(process.exit), "constructor")("return process")().env`
- `const { "constructor": F } = process.exit;` (quoted key)
- `const { ["con" + "structor"]: F } = process.exit;` (computed key)
- `Object.getOwnPropertyDescriptor(Object.getPrototypeOf(process.exit), "constructor").value`
- `Reflect.get(process.exit, <template literal constructor>)` (template key)
- `Reflect.get(process.exit, String.fromCharCode(99,111,...))`

Attack sketch: a hostile diff to the gate hook spells Function through a string key, reads `process.env`, and gates raw terminal bytes on an env var outside AC-9's finite matrix, with the "open set" AC-3 assertion green.
Fix (root, not a seventh spelling): deny by default on free globals, the move the wiring guard already made. Through the checker, every identifier with no declaration (`getSymbolAtLocation` undefined) must be in a short allow-set (`process` with its 4 members, `Promise`, `JSON`, `Error`, plus whatever the hook really uses); `Reflect`, `Object`, `String`, `Symbol` are not needed by the hook. The same class was found and closed once before in kernel-purity-check.ts (Issue #210, prototype-constructor pivot): a name list is never complete.
Exposure: ~100% of these 6 shapes pass AC-3, basis: measured (6 mutants). Needs a reviewed write to a named sensitive-area hook; hook unwired (#308), live exposure 0%. PRINCIPLES rule 21: narrow blast radius, second layer (human review of a sensitive-area diff; AC-9 catches the unconditional form) -> non-gating.
Failing test (one): `AC-3d: the environment-access scan flags a reflective, quoted, computed or template spelling of constructor` (the six sources above must each give `findEnvironmentAccess(...).length > 0`).

### 2. [LOW][demonstrated] NEW: sanitizer disabled by global-prototype patching under a payload-derived trigger; wiring guard and AC-3 blind (neither claims it)
Planted after `JSON.parse(raw)`: `if (raw.includes("__xtrig")) { String.prototype.replace = function () { return String(this); }; }`, and the variant `Reflect.set(RegExp.prototype, Symbol.replace, ...)`. Guard 2 pass / 0 fail; probe `env={} rawESC=false`, `env={THOTH_X=1} rawESC=false`, `tool=xtrig rawESC=true rawNUL=true`. The trigger is the tool name (model-controlled), not an env var. AC-7 pins wiring only and AC-3 is documented as env-only, so this is outside both stated claims; it is plain visible code, no obfuscation. Same fix as finding 1 (unresolved globals `String`, `RegExp`, `Reflect` fall outside the allow-set; assignment to a member of an unresolved global also rejected).
Exposure: ~100% of this shape passes, basis: measured (2 mutants); unwired, human-reviewed. Rule 21 -> non-gating, LOW (no Issue filed).
Failing test (one): `AC-3e: an assignment to a member of an unresolved global (String.prototype.replace) or a Reflect/Object call is flagged`.

### 3. [CLEAN][demonstrated] #369: all seven names and every Promise.all element pinned index by index; retarget of gate, render, catalog, an element swap and an import-attributes second argument are all rejected on the real hook.
### 4. [CLEAN][demonstrated] #370 named shapes and the specifier allow-list: the four round-3 routes, `with`, and off-list static, export-from and dynamic specifiers rejected; benign comment-in-specifier accepted; unicode-escaped identifier spellings are cooked by the TS scanner, so escapes of `constructor`/`process` are still seen.

## Recorded residuals (docs/decisions.md 2026-09-29), not re-raised
JSDoc erasure spellings, extension/nested hook enumeration, snapshot bootstrap, lint hint. Findings 1 and 2 are NEW: that row scopes #370 to Function, eval, .constructor and computed import(), which are fixed.

## Verdict: APPROVE-WITH-CONDITIONS
Nothing gates (rule 21; live exposure 0%; hook unwired per #308). This class is now four rounds old and each round finds another spelling; recommend the deny-by-default global scan rather than more spellings, or accept finding 1 as a filed residual and narrow the AC-3 comment from "no route to the environment" to "no named route".

Closeability: **#369 closable now.** **#360 closable now** (round-3 conditions F1 and F2 landed and verified; successors tracked separately). **#370 closable now** for its stated scope (Function, eval, .constructor, computed import and the allow-list verified); the successor class is tracked in the new Issue.

Open findings 2 (MED 1, LOW 1); failing tests to write 2 (one each). This verdict is not REWORK, so it does not advance rule 16.

Next action: write the two failing tests, switch `findEnvironmentAccess` to a checker-backed unresolved-global allow-set (or accept and narrow the comment), then close #360, #369, #370.

## Editorial
- The AC-3 header comment ("no route to the environment", "open set") overstates what a spelling scan proves; narrow it if the deny-by-default fix is not taken.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked):
1. [ISSUE][MED][demonstrated] src/policy/config/sanitize.test.ts findEnvironmentAccess (AC-3) -- Reflect.get/getOwnPropertyDescriptor with a "constructor" string, quoted/computed/template-key destructure and fromCharCode key reach Function+process.env with AC-3 green (6/6 mutants leak raw ESC/NUL under env); Exposure: ~100% of these shapes, basis: measured; fix: deny-by-default on unresolved globals via the checker. NEW.
2. [ISSUE][LOW][demonstrated] src/policy/config/sanitize.test.ts wiring guard -- String.prototype.replace assign / Reflect.set(RegExp.prototype, Symbol.replace) under a tool-name trigger disables the sanitizer with AC-7/AC-3 green; outside both stated claims; same fix. NEW.
3. [CLEAN][demonstrated] #369: all 7 names and every Promise.all element pinned; gate/render/catalog retarget, element swap, import-attributes arg rejected on the real hook.
4. [CLEAN][demonstrated] #370: round-3 four routes, with-statement and static/export-from/dynamic allow-list all rejected; benign comment-in-specifier accepted.
counts (a CHECKSUM): issues=2 suspicions=0 clean=2
evidence (a CHECKSUM): demonstrated=4 code-traced=0 derived=0
checks="71/0/0"
adr=HIT(37)
report=docs/reviews/s312-fixnow-360-363-app-security-round4-reconfirm-2026-09-29.md
