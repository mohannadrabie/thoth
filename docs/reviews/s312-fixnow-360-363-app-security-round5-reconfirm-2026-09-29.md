# App Security re-confirm, round 5 -- delta e1d8a8a..4720e8b (Issue #371)

Reviewer: app-security-reviewer (Horus) - Date: 2026-09-29 - Tier: CRITICAL - Scope: `s312-fixnow-360-363`
Prior: `docs/reviews/s312-fixnow-360-363-app-security-round4-reconfirm-2026-09-29.md` (finding 1 MED #371, finding 2 LOW).

ADR: `node docs/adr-cache.mjs --ensure` -> `ADR cache HIT: reused 37 ADR(s) ... [CACHE=HIT]`. No applicable security ADR violated (delta = `sanitize.test.ts` + CHANGELOG; `hooks/*.mjs`, `ci.yml` zero diff).

## Method
Own worktree `../thoth-as5` at 4720e8b (node_modules junction). Each mutant was inserted after `const input = JSON.parse(raw);` in the worktree hook copy only. Guard = full `src/policy/config/sanitize.test.ts`; probe = the registry-pinned sandbox spawning the real (mutated) hook with a hostile rationale (ESC, NL, NUL, C1) under three triggers (base, env `THOTH_X=1`, tool name `xtrig`), checking the decoded deny reason for raw ESC/NUL. Baseline: guard 86 pass / 0 fail / 0 skipped (control mutant: same, probe clean on all 3 triggers). Hook restored via `git checkout`; worktree deregistered (`git worktree list` shows the main tree only). The empty directory `C:/playground/thoth-as5` could not be removed (Windows: device or resource busy, same as round 4); a human may `rmdir` it.

## Round-4 routes re-run on 4720e8b (all CLOSED)
| Shape | Guard | Probe (proves mutant live) | Evidence |
|---|---|---|---|
| 6 reflective routes (Reflect.get string, quoted key, computed key, getOwnPropertyDescriptor, template key, fromCharCode) | each FAILS AC-3 (4 of 6 also AC-3f) | env=X raw ESC/NUL leaks in all 6 | demonstrated |
| `String.prototype.replace = ...` under tool trigger | FAILS AC-3 + AC-3f | tool=xtrig raw ESC/NUL leaks | demonstrated |
| `Reflect.set(RegExp.prototype, Symbol.replace, ...)` | FAILS AC-3 + AC-3f | no leak on this payload (guard closes it regardless) | demonstrated |

Round-4 findings 1 and 2 are closed for the shapes named.

## Attack on the new design
Function/env reach: no route found. With `constructor`, string/computed keys, element access, `Reflect`/`Object`/`String`/`Symbol` all refused, the reachable objects are `Promise`, `JSON`, `Error`, `process.{stdin,stdout,stderr,exit}` and imports. I found no way to obtain `Function` or `process.env` from them (`__proto__` yields prototypes but not `.constructor`; a standalone check that `Error.prepareStackTrace` CallSites expose no `getThis`/`getFunction` in this ESM runtime returned empty). Shadowing (`const JSON/Promise/Error/undefined` in a block), optional chaining, tagged template, labels, thenables, `class extends Promise`, a replacer array with a concatenated name: guard green, no capability gained (probe clean). `with` fails to load (strict ESM, round 4). Getters/Proxy via imported exports are outside the header's stated scope ("NOT proven ... a global reached only through an imported module's exports"), recorded.

## Findings

### 1. [MED][demonstrated] NEW: the "no write to a global" rule (header claim 3) is bypassed by aliasing, `__proto__`/`prototype` as identifiers, and literal roots; a String.prototype patch disables the sanitizer with the guard green
`findEnvironmentAccess` (sanitize.test.ts:520-532) roots the write check at a free-global IDENTIFIER (`memberChainRoot`, `isFreeGlobal`) and bans `__proto__`/`prototype`/`constructor` only as string LITERALS (FORBIDDEN_KEY_STRINGS); the identifier property names `.__proto__` and `.prototype` are unchecked. Mutants (each guard 86/0/0: AC-3, AC-3e, AC-3f all green):
- n1: assign to `replace` on `"".__proto__` with an identity function (root is a literal, not an identifier) -> tool=xtrig `rawESC=true rawNUL=true`
- n2: `const s = ""; s.__proto__.replace = ...` (root is a local) -> leaks
- b8: `const s = ""; ({ x: s.__proto__.replace } = { x: ... });` -> leaks
- n6: `"".__proto__.__defineGetter__("replace", () => ...)` (a call, not an assignment) -> leaks
- Guard-green, effect not shown on my payload: `const J = JSON; J.stringify = ...` (alias of an ALLOWED global), `const P = Promise; P.prototype.then = ...`, `const E = Error; E.prepareStackTrace = ...`, `[].__proto__.map = ...`, `({}).__proto__.x = 1`, `Error.captureStackTrace("".__proto__)`.

Attack sketch: a hostile diff to the gate hook patches `String.prototype.replace` under a model-controlled trigger (tool name) via an alias or `.__proto__`, so the sanitizer's replace path returns raw bytes; AC-7 (wiring) and AC-3 (header item 3: "no global prototype or stream can be patched") stay green.

Fix (ban the vehicles, do not chase the write root): forbid `__proto__`, `prototype` and `__defineGetter__`/`__defineSetter__`/`__lookupGetter__`/`__lookupSetter__` as NAMES in every position (identifier property names, not only strings). Narrow header claim 3 to what remains.

Exposure: ~100% of these 4 leaking shapes pass the guard, basis: measured (guard 86/0/0 on each; probe leaks on n1/n2/b8/n6). Needs a reviewed write to a named sensitive-area hook; hook unwired (#308), live exposure 0%. PRINCIPLES rule 21: narrow blast radius, second layer (human review of the sensitive-area diff; AC-9 catches the unconditional form) -> non-gating. Not a recorded residual (docs/decisions.md 2026-09-29 records only JSDoc erasure, extension/nested enumeration, snapshot bootstrap, lint hint). Same class as round-4 finding 2, incompletely closed by the "rooted at a global" rule.

Failing test (one): `AC-3g: an __proto__/prototype identifier property name or an __define/lookup Getter/Setter__ call is flagged, however the write is rooted` (sources n1, n2, b8, n6 must each give a non-empty `findEnvironmentAccess` result).

### 2. [CLEAN][demonstrated] #371 spelling class: all six reflective routes and both round-4 patching routes fail AC-3 on the real hook; AC-3f pins the allow-set to the hook's five free globals (baseline 86/0/0); deny-by-default holds for Reflect/Object/String/Symbol/RegExp/Function/eval/globalThis/console.

### 3. [CLEAN][demonstrated] Shadowing of JSON/Promise/Error/undefined, optional chaining, tagged templates, labels, thenables, `class extends Promise`, a replacer array with a concatenated key: guard green, probe clean, no capability gained; `process` allowed-member use (stdin/stdout/stderr/exit) offers no route to env.

## Scope limit, not a finding (header: runtime behaviour NOT proven)
A payload-triggered raw writer that never calls `renderHookOutput` (my b1 attempt) also passes the source scan; my mutant exited 2 (payload shape wrong), so its effect is NOT demonstrated. Inherent to any source-text check; AC-9 covers the unconditional form only.

## Editorial
- AC-3 header claim 3 overstates; narrow it or land finding 1's fix.

## Verdict: APPROVE-WITH-CONDITIONS
Nothing gates (rule 21; live exposure 0%; hook unwired per #308). #371's named class (spelling of Function; global-rooted writes) is closed and verified; one successor MED, filed as Issue #372.

Closeability: **#371 closable now** for its stated scope (six reflective routes, both patching routes, AC-3f allow-set pin); the successor class is tracked in the new Issue, not by reopening #371.

Open findings 1 (MED 1); failing tests to write 1 (`AC-3g`). Not REWORK; does not advance rule 16.

Next action: write `AC-3g`, add the forbidden-name set in identifier position, then close #371.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked):
1. [ISSUE][MED][demonstrated] src/policy/config/sanitize.test.ts:520-532 findEnvironmentAccess -- write rule rooted at a free-global identifier is bypassed by literal root, local alias, destructuring target and __defineGetter__ call; __proto__/prototype banned only as strings; 4 shapes disable the sanitizer under a tool-name trigger with guard 86/0/0; Exposure: ~100% of these shapes, basis: measured; fix: forbid __proto__/prototype/__define|lookup{Getter,Setter}__ as names in every position. NEW (#372).
2. [CLEAN][demonstrated] #371 spelling class: 6 reflective routes + 2 patching routes rejected on the real hook; AC-3f pins the allow-set.
3. [CLEAN][demonstrated] Shadowing, optional chaining, tagged template, label, thenable, class-extends-Promise, process allowed members: no capability, probe clean.
counts (a CHECKSUM): issues=1 suspicions=0 clean=2
evidence (a CHECKSUM): demonstrated=3 code-traced=0 derived=0
checks="86/0/0"
adr=HIT(37)
report=docs/reviews/s312-fixnow-360-363-app-security-round5-reconfirm-2026-09-29.md
