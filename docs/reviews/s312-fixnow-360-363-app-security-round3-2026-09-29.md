# App Security Review, round 3 -- fix-now delta 12a4454..e63cd4b (Issues #360, #367, #368)

Reviewer: app-security-reviewer (Horus) - Date: 2026-09-29 - Tier: CRITICAL - Scope: `s312-fixnow-360-363`
Prior: `docs/reviews/s312-fixnow-360-363-app-security-round2-postmerge-2026-09-29.md` (REWORK: HIGH #367, MED #360, LOW).

ADR: `node docs/adr-cache.mjs --ensure` -> `ADR cache HIT: reused 37 ADR(s) ... [CACHE=HIT]`. No applicable security ADR violated (delta touches only lint config, QA instrument, tests, snapshot JSON; `hooks/*.mjs`, `ci.yml` zero diff).

## Method
Own worktree `../thoth-as3` at e63cd4b (node_modules junction), mutants planted only there, worktree removed at the end; main tree untouched. Baseline in worktree: 78 pass / 0 fail / 0 skipped (sanitize, coverage, coverage-fixnow, gate-sanitize tests); `npm run lint` clean; `qa:hook-typecheck-coverage` PASS (30 == 30, 22 == 22).

## Round-2 attack table re-run

| Round-2 shape | Result now | Evidence |
|---|---|---|
| V0 new unsuppressed bug appended to sessionstart-tool-enum.mjs | coverage FAIL (1 identity exceeds pin), eslint 0 | demonstrated |
| V2 `// @ts-expect-error legacy shim, tracked elsewhere` | coverage FAIL "type-suppression found (@ts-expect-error)", eslint rc=1 | demonstrated |
| V3 `eslint-disable-next-line` + `@ts-ignore` | coverage FAIL "(@ts-ignore, eslint-disable)", eslint rc=1 (noInlineConfig: "has no effect") | demonstrated |
| block-comment `@ts-ignore`, `@TS-IGNORE` | block: FAIL + lint rc=1; uppercase is not a TS pragma (diagnostic surfaces, FAIL) | demonstrated |
| `hooks/x.js` with `@ts-ignore` | lint 2 errors, coverage FAIL (enumerated, not in tsconfig include) | demonstrated |
| AC-7d shapes (let-reassign, param/catch/for-of/var shadow, spread, bracket/destructured call, module-object assign) | all rejected by the 14-row table; real-hook mutants let-reassign, bracket call, module-object assign, ternary each 38 pass / 1 fail; positive control 39/0 | demonstrated |
| sandbox ESC/NUL probe on the clean hook | env={} rawESC=false rawNUL=false; env={THOTH_X=ESC[2J} rawESC=false | demonstrated |

Round-2 HIGH #367 (pragma/eslint-disable class) is CLOSED. Round-2 MED #360 shapes are CLOSED. The deny-by-default name-count + symbol-lookup design holds for every shape that touches `sanitizeMod`, `render` or `renderHookOutput` by name.

## Findings

### 1. [MED][demonstrated] NEW, undisclosed: the sanitize guard pins the `sanitizeMod` import but not the `render` import
`src/policy/config/sanitize.test.ts` `diagnoseSanitizeWiring` checks the array element for `sanitizeMod` against the exact specifier and never checks the element bound to `render`. Planted in the real hook: `import("../src/policy/gate/render-hook-output.ts")` -> `import("../src/policy/gate/evil-render.ts")` (re-exports the real function but swaps in an identity sanitizer when `THOTH_X` is set; env read inside that module).
Raw: sanitize.test + gate-sanitize (AC-9) 43 pass / 0 fail; sandbox probe `env={} rawESC=false rawNUL=false`, `env={"THOTH_X":"1"} rawESC=true rawNUL=true`.
Attack sketch: a hostile diff retargets the `render` specifier to a module that ignores the sanitize port under a trigger outside the AC-9 6-name matrix; AC-3 scans only the hook file.
Fix: assert every `Promise.all` element equals an exact expected specifier (at minimum the `render` index). One assertion.
Exposure: ~100% of this shape passes the guard, basis: measured (mutant). Needs a reviewed write to a named sensitive-area hook; hook unwired (#308), live exposure 0%. Rule 21: narrow blast radius, second layer (human review of a sensitive-area diff; AC-9 catches the unconditional form) -> non-gating.

### 2. [MED][demonstrated] NEW, undisclosed: AC-3 is a name deny-list, not "no route to the environment"
`findEnvironmentAccess` forbids `process` members other than stdin/stdout/stderr/exit, `globalThis`/`global`/`require`/`createRequire`, and literal `process`/`module` import specifiers. Planted after the render call in the real hook, each keeping AC-7 and AC-3 green:
- `Function("return process")().env.THOTH_X`
- `process.exit.constructor("return process")().env.THOTH_X` (`exit` is an allowed member)
- `(await import("node:" + "process")).env.THOTH_X`
- `(0, eval)("process.env.THOTH_X")`
Raw: each -> sanitize.test + gate-sanitize 43 pass / 0 fail. With the `Function` form overwriting stdout from the env value: probe `env={} rawESC=false`, `env={THOTH_X=ESC[2J} rawESC=true`.
Attack sketch: env-gated raw terminal bytes with the AC-3 assertion green, though the comment claims an "open set" structural assertion.
Fix: also forbid `Function`, `eval`, any `.constructor` access and non-literal `import()` specifiers in the hook (it needs none).
Exposure: ~100% of these routes pass AC-3, basis: measured (4 mutants). Same preconditions as finding 1 -> non-gating MED.

### 3. [LOW][demonstrated] JSDoc type-erasure class wider than `@type {any}`/`{*}` (extends round-2 LOW 3)
Dropped-argument calls hidden via `/** @type {Function} */ (f)(..)`, `/** @typedef {any} Anything */` + `@type {Anything}`, `@type {any | string}`, `@type {?}`, an `@returns {any}` wrapper, and the disclosed `@param {any}` wrapper: all coverage PASS 30 == 30, eslint 0. The pragma class is closed; this is the inherent residual of a diagnostic ratchet. A committer able to do this could equally hand-edit the baseline JSON (visible in review). Residual register.

### 4. [LOW][demonstrated] Hook-extension allow-list (N5 residual)
`hooks/*.js` is now covered. `hooks/*.cjs` (parse error only), `hooks/*.mts` / `.ts` (lint: "File ignored because no matching configuration", coverage PASS) are outside lint, enumeration and the suppression scan. Subdirectories are disclosed. Fix: enumerate deny-by-default (every non-`*.test.ts`, non-`test-support` file under `hooks/`). Live exposure 0%; a new wired hook needs a reviewed settings change.

### 5. [CLEAN][demonstrated] #367 pragma class: explicit `ban-ts-comment` options, `noInlineConfig` on hooks, `.js` glob, and the instrument own scan each independently catch the round-2 V2/V3 shapes.
### 6. [CLEAN][demonstrated] #360 round-2 MED shapes and the 14-row AC-7d table rejected, positive control accepted, clean-hook sandbox probe clean.
### 7. [CLEAN][code-traced] #368: identity is code + normalised line; `--regenerate-baseline` refuses any new identity and any hook with a suppression (`hook-typecheck-coverage-check.ts:319-374`); a missing snapshot pins nothing (fails safe); 0 of 34 snapshot excerpts hit the 200-char cap (measured with a script), so truncation cannot mask an appended bug.

## Verdict: APPROVE-WITH-CONDITIONS
No finding gates (MEDs are rule-21 narrow-blast: unwired hook, human-reviewed sensitive area). Conditions, one failing test each:
- F1: sanitize.test.ts: retargeting the `render` (or any) `Promise.all` specifier is rejected.
- F2: sanitize.test.ts AC-3: `Function(...)`, `.constructor(...)`, `eval`, computed `import()` specifiers are flagged.
- F4: `listProductionHooks` deny-by-default test (optional, LOW). F3 has no executable form (inherent).
Open findings 4 (MED 2, LOW 2); failing tests to write 3 (F1, F2, F4); F3 has none.

Closeability: **#367 closable now** (pragma/eslint-disable class verified closed; F3 recorded as a residual comment). **#360 closable once F1+F2 land** (two small assertions); the original conditional-bypass defect and every round-2 shape are verified closed. F1/F2 are the last two unpinned inputs of the same guard (render import, env open set), not a design gap; if the Manager prefers not to spend a round they can be accepted as filed residuals. A non-REWORK verdict does not advance rule 16 (reviewRoundsSinceClean=2).

Next action: add the F1 and F2 assertions with failing tests on the same branch, then close #367 and #360.

## Editorial
- The typescript-eslint message on `@ts-ignore` still says "Use @ts-expect-error instead", which is now also banned; the eslint.config.mjs comment could note it.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked):
1. [ISSUE][MED][demonstrated] src/policy/config/sanitize.test.ts diagnoseSanitizeWiring -- render Promise.all import specifier not pinned; swap to an env-gated module keeps 43/43 green while probe leaks raw ESC/NUL; fix: pin every Promise.all element to its exact specifier. NEW.
2. [ISSUE][MED][demonstrated] src/policy/config/sanitize.test.ts findEnvironmentAccess (AC-3) -- name deny-list misses Function(return process), process.exit.constructor, computed import of node:process, indirect eval; fix: forbid Function/eval/.constructor/non-literal import in the hook. NEW.
3. [ISSUE][LOW][demonstrated] src/qa/hook-typecheck-coverage-check.ts scanHookSuppressions -- @type Function, typedef-any alias, any-union, ? type, @returns any wrapper hide a new bug (PASS 30==30); inherent, residual register; extends round-2 LOW.
4. [ISSUE][LOW][demonstrated] src/qa/hook-typecheck-coverage-check.ts listProductionHooks / eslint.config.mjs -- .cjs/.mts/.ts hooks outside lint, enumeration and scan; fix: enumerate deny-by-default. Partly disclosed (subdirs).
5. [CLEAN][demonstrated] #367 pragma class (ts-expect-error, eslint-disable, block ts-ignore, .js) caught by lint and by the instrument independently.
6. [CLEAN][demonstrated] #360 round-2 shapes + 14-row AC-7d table + real-hook mutants rejected; clean-hook sandbox probe no raw ESC/NUL.
7. [CLEAN][code-traced] #368 identity + regenerate-baseline refusal + fail-safe missing snapshot; 0/34 excerpts hit the 200-char cap.
counts (a CHECKSUM): issues=4 suspicions=0 clean=3
evidence (a CHECKSUM): demonstrated=6 code-traced=1 derived=0
checks="78/0/0"
adr=HIT(37)
report=docs/reviews/s312-fixnow-360-363-app-security-round3-2026-09-29.md
