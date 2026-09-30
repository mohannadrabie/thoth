# App Security Review, round 2 (post-merge) -- PR #365 fix-now delta (Issues #366, #367)

Reviewer: app-security-reviewer (Horus) - Date: 2026-09-29 - Tier: CRITICAL - Scope: `s312-fixnow-360-363`
Audited: shipped code on master (merge 949b108, round-4 fix commit 49097d3; diff 46ee31a..949b108 excluding docs), working tree on `review/365-post-merge-reconfirm`. Prior report: `docs/reviews/s312-fixnow-360-363-app-security-2026-09-28.md` (REWORK, 2 HIGH).

ADR: `node docs/adr-cache.mjs --ensure` -> `ADR cache HIT: reused 37 ADR(s) ... [CACHE=HIT]`. Round-1 ADR read stands; the delta touches no ported file, boundary or allowlist. No applicable ADR violated.

## Method
Planted each mutant in the real `hooks/pretooluse-kernel-gate.mjs` / `hooks/sessionstart-tool-enum.mjs` (backup in scratchpad, restored after every run; `git status --short` empty at the end), ran the real instrument, reverted. Nothing committed.

Baseline: `node --test` on kernel-purity-check, hook-typecheck-coverage-check, sanitize, gate-structure and pretooluse-kernel-gate-sanitize tests -> 92 pass / 0 fail / 0 skipped. `npm run lint` clean.

## Round-1 findings: re-run of my original bypass shapes

| Issue | Shape | Result on merged code | Evidence |
|---|---|---|---|
| #366 | import path ../../attacker-controlled/config/sanitize.ts (hypothetical attacker path) + dead-code decoy of the real literal | sanitize.test.ts 12 pass / 1 fail (caught: exact-specifier equality, raw-text regex removed) | demonstrated |
| #366 | import attributes `import(spec, {with:{...}})` | 1 fail (arity != 1) | demonstrated |
| #366 | template literal with substitution | 1 fail | demonstrated |
| #366 | alias chain `a = sanitizeMod; b = a; b.sanitizeForTerminal` | 1 fail (rejected, conservative) | demonstrated |
| #366 | ternary choosing a second attacker import | 1 fail | demonstrated |
| #367 | bare `// @ts-ignore` above a dropped-argument call in sessionstart-tool-enum.mjs | coverage check PASS (30 == 30) but eslint rc=1 (ban-ts-comment): caught by lint | demonstrated |
| #367 | `/* @ts-ignore */` | eslint rc=1 | demonstrated |
| #367 | unsuppressed new bug | coverage FAIL: `2554:629 (new, x1)` | demonstrated |

Original #366 and the bare-`@ts-ignore` form of #367 are closed.

## Findings

### 1. [HIGH][demonstrated] ban-ts-comment is at its default, which ALLOWS `@ts-expect-error` with a description; an inline eslint-disable also defeats it. #367 is not closed.
`eslint.config.mjs` (hooks block): `"@typescript-eslint/ban-ts-comment": "error"`, no options. typescript-eslint v8 default is `ts-expect-error: "allow-with-description"`, so the in-file comment ("neither pragma may appear anywhere under hooks/") is not what the rule does. `@ts-expect-error` removes the diagnostic from `getPreEmitDiagnostics` exactly like `@ts-ignore`.

Attack sketch: append a new dropped-argument call to a pinned hook with `// @ts-expect-error legacy shim, tracked elsewhere` above it; the ratchet sees 30 == 30 and eslint passes.

Raw evidence (JSDoc-typed `newInvariant(a,b)`, called as `newInvariant([1])`, appended to hooks/sessionstart-tool-enum.mjs):

    V2 // @ts-expect-error legacy shim, tracked elsewhere -> coverage PASS (30 == pinned 30); eslint exit=0
    V3 // eslint-disable-next-line @typescript-eslint/ban-ts-comment + // @ts-ignore -> coverage PASS; eslint exit=0
    V0 (no pragma)                                        -> coverage FAIL 2554:629 (new, x1)

Fix verified: rule options `{"ts-expect-error":true,"ts-ignore":true,"ts-nocheck":true}` flag V2; the inline-disable variant is flagged only with `--no-inline-config` (or global `linterOptions.noInlineConfig`). Simplest durable fix: make `hook-typecheck-coverage-check.ts` itself fail if any `hooks/*.mjs` contains `@ts-(ignore|expect-error|nocheck)` or `eslint-disable`, independent of lint config.

Exposure: ~100% of attempts to hide a new type bug in the two pinned hooks via a described `@ts-expect-error` succeed, basis: measured (mutant run above). Live exposure of hook-output defects is 0% (hook unwired, Issue #308); the CI guard itself is live.

### 2. [MED][demonstrated] Sanitize-binding AST guard still accepts sanitizer bypasses that resolve to the real import statically but not at runtime
The #366 fix and the R3 scope walk hold, but the guard discloses only "no hoisting, no var, no function-parameter binding, no TDZ". Undisclosed shapes, each planted in the real hook and gated on `process.env.THOTH_X` (a name outside the AC-9 fixed 6-case matrix); sanitize.test.ts gave 13 pass / 0 fail for all:
- `let san = sanitizeMod.sanitizeForTerminal; if (env) san = (s)=>s; renderHookOutput(d, san)` (let reassignment)
- arrow-parameter shadow, `catch (sanitizeMod)`, `for (const sanitizeMod of ...)`, `var` in a block (scope walk knows only Block/SourceFile)
- `...[import(catalog), import(attacker)]` spread in the `Promise.all` array shifts runtime index vs AST index
- decoy `render.renderHookOutput(...)` kept, real call via `render["renderHookOutput"](...)` or `const {renderHookOutput: r} = render` (call finder matches property access only, so "exactly one" holds)
- `sanitizeMod.sanitizeForTerminal = (s)=>s` assignment to the module object

End-to-end (let-reassign and bracket-call mutants): AST guard + pretooluse-kernel-gate-sanitize.test.ts -> 17 pass / 0 fail, while a probe through the real sandbox gave `env={} rawESC=false rawNUL=false` and `env={"THOTH_X":"1"} rawESC=true rawNUL=true`.

Attack sketch: a hostile hook diff env-gates the sanitizer with any structure above and a trigger name not in the matrix; every guard stays green, raw ESC/NUL reach the terminal.
Fix: stop growing the resolver; make it deny-by-default by shape: exactly one `renderHookOutput` identifier anywhere, second argument literally `sanitizeMod.sanitizeForTerminal` (no alias), `sanitizeMod` declared once and never assigned or shadowed, array has no SpreadElement.
Exposure: ~100% of these shapes pass the guard, basis: measured; needs write access to a named sensitive-area hook (reviewed change), a behavioural test covers 6 env names; live exposure 0% (hook unwired, #308). Capped MED (narrow blast radius, second layer exists). Tracked as a residual on open Issue #360.

### 3. [LOW][demonstrated] Type suppression without a pragma is invisible to the ratchet
`/** @type {any} */ (newInvariant)([1]);` -> coverage PASS, eslint exit=0. Inherent to a diagnostic-based ratchet; equal-identity swaps (new diagnostic at an already-pinned code:line) are line-anchored and disclosed in the check header. No worthwhile executable form; residual register.

### 4. [CLEAN][demonstrated] #366 fix: exact-specifier equality, raw-text regex removed; template-substitution, import attributes, alias chain and ternary rejected (table). #366 can close.
### 5. [CLEAN][demonstrated] #367 multiset identity: a new unsuppressed diagnostic in a pinned hook is named individually rather than netted against paid-down debt.
### 6. [CLEAN][code-traced] THOTH_PLAIN_REASON added to AC-9 (hooks/pretooluse-kernel-gate-sanitize.test.ts), honestly scoped in-file as finite defence-in-depth (the THOTH_X name in finding 2 passes it).

## Verdict: REWORK (for #367 only)
- Issue #366: fix verified; safe to close.
- Issue #367: not closable until finding 1 lands (one config or QA-check change).
- Issue #360: stays open; finding 2 recorded there.
- Post-merge: nothing live is exposed (hook unwired); this is a CI-guard integrity gap.

Open findings = 3 (HIGH 1, MED 1, LOW 1); failing tests to write = 2:
- hook-typecheck-coverage-check: no hooks/*.mjs contains @ts-ignore, @ts-expect-error, @ts-nocheck or eslint-disable (finding 1)
- sanitize AC-7d: let reassignment, Promise.all spread, param/catch/for-of/var shadow, bracket or destructured renderHookOutput call, and module-object assignment are each rejected (finding 2)
- Finding 3 has no executable form (inherent to typing a diagnostic away); route to the residual register.

Next action: add the pragma and eslint-disable scan to hook-typecheck-coverage-check.ts with its failing test, then close #367.

## Editorial
- The eslint.config.mjs comment claims both pragmas are banned "full stop"; the rule as configured bans only ts-ignore, ts-nocheck and undescribed ts-expect-error. Correct it with the fix.

RECEIPT: verdict=REWORK
findings (ranked):
1. [ISSUE][HIGH][demonstrated] eslint.config.mjs (hooks block, ban-ts-comment default) -- described ts-expect-error comment and eslint-disable-next-line plus ts-ignore both hide a new bug from the #367 ratchet (coverage PASS 30==30, eslint rc=0); fix: explicit options plus noInlineConfig, or a pragma/eslint-disable scan inside hook-typecheck-coverage-check.ts.
2. [ISSUE][MED][demonstrated] src/policy/config/sanitize.test.ts (resolveModuleBinding/findBindingDeclaration/findAllRenderHookOutputCalls) -- let reassignment, param/catch/for-of/var shadow, Promise.all spread index shift, bracket/destructured decoy call, module-object assignment all pass 13/13 while the real hook leaks raw ESC/NUL under an unlisted env var; fix: deny-by-default shape check. Tracked on #360.
3. [ISSUE][LOW][demonstrated] src/qa/hook-typecheck-coverage-check.ts -- JSDoc any-cast suppresses the diagnostic with no pragma; inherent, residual-register only.
4. [CLEAN][demonstrated] #366 exact-specifier fix -- original suffix+decoy, import attributes, template substitution, alias chain, ternary all rejected.
5. [CLEAN][demonstrated] #367 multiset identity plus bare ts-ignore ban -- new unsuppressed diagnostic named 2554:629 (new, x1); bare/block ts-ignore fails eslint.
6. [CLEAN][code-traced] THOTH_PLAIN_REASON in AC-9 matrix -- present, honestly scoped as finite defence-in-depth.
counts (checksum): issues=3 suspicions=0 clean=3
evidence (checksum): demonstrated=5 code-traced=1 derived=0
checks="92/0/0"
adr=HIT(37)
report=docs/reviews/s312-fixnow-360-363-app-security-round2-postmerge-2026-09-29.md
