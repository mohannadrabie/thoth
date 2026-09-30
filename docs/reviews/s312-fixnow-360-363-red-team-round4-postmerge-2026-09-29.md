# Red Team (Sutekh) — ROUND 4 POST-MERGE re-confirm — PR #365's round-4 fix-now delta (Issues #360, #361, #366, #367)

- **Date:** 2026-09-29
- **Round:** 4 (post-merge re-confirm of my own round-3 report `docs/reviews/s312-fixnow-360-363-red-team-round3-2026-09-28.md` and of `app-security-reviewer`'s round-1 HIGHs `docs/reviews/s312-fixnow-360-363-app-security-2026-09-28.md`)
- **Scope:** `s312-fixnow-360-363`. Tier: CRITICAL. Delta: `49097d3` on top of `46ee31a`; overall `git diff c806c95..949b108 -- . ':!docs'`.
- **HEAD:** `dfc574be849e9e40e6581a734116179b2a6dc3e1` (branch `review/365-post-merge-reconfirm`, cut from master; code identical to master's)
- **Status of the change:** **already merged** by the human (merge commit `949b108` on master) before this re-confirm ran. This is an audit of shipped code, not a PR gate. "go" here means no revert is warranted; it is not a claim that every named Issue can close.
- **ADR cache:** `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT]`
- **Worktree:** the main tree. Every mutation below was planted and reverted in place; `git status --porcelain` at close shows only `docs/REVIEW_LOG.md` (modified by this session's sibling reviewers) and their two untracked reports. `HEAD` unmoved. Zero `.bak` files left.
- **Live exposure context (given, and honoured in every exposure line):** the `PreToolUse` gate hook is **not** wired into `settings` (Issue #308), so live exposure of any hook-output defect is **0% today**. The CI guards themselves **are** live (`typecheck` / `lint` / `test` / QA-18 are all real `ci.yml` steps).
- **Verdict:** **go.** No HIGH. 4 MED + 1 LOW open, every one a guard-precision or guard-coverage gap; no defect in shipped sanitization behaviour. **Issue #366 is closeable. Issues #360 and #367 are NOT — each has a demonstrated live bypass of the exact control the round-4 fix installed. Issue #361 stays open on its own title.**

## Baseline (merged code, before any mutation)

```
$ git rev-parse HEAD                     dfc574be849e9e40e6581a734116179b2a6dc3e1
$ npm run build                          rc=0     # tsc --noEmit -p tsconfig.json && -p tsconfig.hooks.json
$ npm run lint                           rc=0     # eslint .
$ node --test
  tests 1532 / suites 0 / pass 1532 / fail 0 / cancelled 0 / skipped 0 / todo 0
$ npm run qa:kernel-purity               PASS rc=0  (4 production .ts files under src/policy/kernel/)
$ npm run qa:normalizer-registry-purity  PASS rc=0
$ npm run qa:gate-manifest               PASS rc=0
$ npm run qa:gate-matcher-drift          PASS rc=0
$ npm run qa:gate-command-path           PASS rc=0
$ npm run qa:completeness-claims         PASS rc=0
$ npm run qa:hook-typecheck-coverage     PASS rc=0
  - hooks/pretooluse-kernel-gate.mjs: 0 diagnostic(s), fully covered
  - hooks/sessionstart-tool-enum.mjs: 30 diagnostic(s) (pinned Issue #361 baseline: 30, pre-existing debt, not yet fixed)
  - hooks/userpromptsubmit-halt-relay.mjs: 22 diagnostic(s) (pinned Issue #361 baseline: 22, pre-existing debt, not yet fixed)
```

Closing re-run, after every mutation was reverted: identical — `build rc=0`, `lint rc=0`, all 7 instruments `rc=0`, `node --test` **1532 / 1532 pass / 0 fail / 0 skipped**.

> Flake note, recorded rather than hidden: my *first* baseline `node --test` had 2 failures — `gate-latency-budget-check.test.ts` (measured p95 2016.30ms against a 2000ms ceiling, on a machine running three reviewers at once) and `pre-commit-scan.test.ts` R4 (`EBUSY: rmdir` on a Windows temp clone). Both passed on an unloaded re-run. Neither is in the delta; both are load/OS-sensitive, not regressions.

## One praised decision

**`process` in `FORBIDDEN_ROOTS` is the fix that actually mattered, and it is placed at the layer that cannot be blinded.** Round 3's scariest finding (R1 / drill N7b) was an ordinary-looking pure helper added to `src/policy/kernel/` whose path regex ending in an escaped slash blinded the rest of its line, hiding a live `process.env` read, with `qa:kernel-purity` reporting `PASS rc=0`. Round 4 fixes this twice: the differential's lane list is now generated, **and** `process` moved into the AST layer (`kernel-purity-check.ts:304-315`), which parses the source directly and is immune to the `stripComments` regex residual by construction. I re-planted N7b verbatim:

```
$ (a new file under src/policy/kernel/ — the exact round-3 N7b payload; planted, measured, reverted, never committed)
$ npm run qa:kernel-purity
[QA kernel-purity-check] FAIL: 1 kernel-purity violation(s) found across 5 file(s) under src/policy/kernel/.
  - <the drill file>: [forbidden-global] forbidden global/pattern "process" found
    (AST: property access ".env" on forbidden global "process" (possibly via alias))
rc=1
```

Round 3: `PASS rc=0` on 5 files. That is a root-cause fix at the right layer, not a wider net at the same layer.

Second credit: the normalizer lane in `enforcedLaneSources()` does not merely *happen* to match its control — it **imports `REGISTRY_PATH` from `normalizer-registry-purity-check.ts` itself** (`kernel-purity-check.test.ts:6,94`), so the guard's lane and the control's lane cannot drift apart. That is the shape I asked for, implemented better than I specified.

## Scorecard

Ranked by exposure x irreversibility x silence.

| # | Attack | Status | Severity | Evidence |
|---|---|---|---|---|
| N1 | The new lexical scope model covers only `Block`/`SourceFile` **variable statements**, so a function parameter or an object-binding-pattern shadow still resolves to the real import — raw ESC and NUL through the real spawned hook, 32/32 guard tests green | BREAKS | MED | demonstrated |
| N2 | A JSDoc any-cast is a type-suppression vector no layer detects: not the eslint ban, not the pragma regex test, not the identity multiset, not the build gate | BREAKS | MED | demonstrated |
| N3 | The code-plus-line identity pin false-fails on any line-count-changing edit to either excepted hook (measured: 1050 of 1175 lines, 89.4%) — one blank line reports **16 identities as "a NEW regression"** — and its only remediation (regenerate a 52-string hand-typed pin) launders any concurrent real diagnostic into the baseline | BREAKS | MED | demonstrated |
| N4 | The eslint `ban-ts-comment` ban is a **no-op for a described `@ts-expect-error`** at its default options, and its own error message on `@ts-ignore` instructs the author to switch to the allowed form; the config's claim that neither pragma may appear anywhere under `hooks/` is false | BREAKS | MED | demonstrated |
| N5 | A new production hook added with a `.js` extension escapes `listProductionHooks`, the `hooks/**/*.mjs` eslint block, and the `.mjs`-only pragma regex test simultaneously: a `@ts-nocheck` plus an arity bug, every gate green | BREAKS | LOW | demonstrated |
| K1 | Round-3 R1 / drill N7b (new kernel file, blinded `process.env`) | SURVIVES (fix confirmed, twice over) | — | demonstrated |
| K2 | Round-3 R2 / drill N8 (trailing same-line comment false-positiving two guards) | SURVIVES (fix confirmed) | — | demonstrated |
| K3 | The new `getTrailingCommentRanges` call does not make the oracle over-strip | SURVIVES | — | demonstrated |
| K4 | Round-3 R4 / drill C2 (the offset attack on the ratchet), re-run in a **no-line-shift** variant | SURVIVES (fix confirmed) | — | demonstrated |
| K5 | Issue #366 (path-suffix lookalike) at the real call site | SURVIVES (fix confirmed) | — | demonstrated |
| K6 | Round-2 drill N2 (string-literal comment opener blinding the kernel scan) | SURVIVES (re-confirmed) | — | demonstrated |
| K7 | Round-2 drill N4 (env-gated object-literal port at the real call site) | SURVIVES (re-confirmed) | — | demonstrated |
| K8 | Round-3 R5's committed full-corpus lossy differential is real and mutation-sensitive | SURVIVES | — | demonstrated |
| K9 | The normalizer lane cannot drift from its control (imports `REGISTRY_PATH`) | SURVIVES | — | code-traced |
| K10 | Round-3 R6 (untracked-file sensitivity breaking `npm test`) | SURVIVES (no longer reproducible) | — | demonstrated |
| K11 | CI wiring of the round-4 delta (lint, typecheck, test, QA-18 all live steps) | SURVIVES | — | demonstrated |
| K12 | ADR compliance on this attack surface, including the one assertion round 4 **deleted** | SURVIVES | — | code-traced |

---

## Part 1 — the named attacks from rounds 2 and 3, and app-security's HIGHs, re-run against the MERGED code

### K1 — round-3 R1 / drill N7b CLOSED, twice over [demonstrated]

See "One praised decision". The production CI instrument now fails `rc=1`, and independently the differential fires:

```
$ node --test src/qa/kernel-purity-check.test.ts
FAIL stripComments agrees with a TypeScript-scanner-derived oracle on every scanned production source
FAIL stripComments never loses real code ... on every .ts/.mjs/.js source under src/ and hooks/
FAIL checkKernelPurity: the REAL src/policy/kernel production code is itself pure
```

The kernel lane is now `listFilesRecursive`-generated, so a new kernel file is covered the day it lands — measured, not assumed: the drill file was the 5th file and all three assertions saw it.

### K2 — round-3 R2 / drill N8 CLOSED [demonstrated]

The one-line `getTrailingCommentRanges` fix is in (`kernel-purity-check.ts:269`). Re-planting the benign trailing comment that broke two guards in round 3:

```
$ (src/policy/gate/render-hook-output.ts: added a trailing line comment after the HookOutput interface opener)
$ node --test src/policy/gate/gate-structure.test.ts src/qa/kernel-purity-check.test.ts
tests 66 / pass 66 / fail 0 / skipped 0
```

Round 3: `64 / 62 / 2`. The 22.8%-of-repo false-positive class is gone, the 14 shapes are pinned individually as a table (`kernel-purity-check.test.ts:148-`), and the disagreement message now names the direction (`stripDisagreementMessage`, `:101-104`) — the carried half of round-2 R4, discharged.

### K3 — the new trailing-range call does not make the oracle over-strip [demonstrated]

This matters more than it looks. The full-corpus test flags only the case where `stripComments` output is SHORTER than the oracle's (the dangerous direction). If the *new* trailing call over-stripped, an oracle that also deleted real code could mask a genuine `stripComments` loss, and the benign direction is deliberately unflagged. So I re-derived the oracle's ranges exactly as shipped (leading + trailing, `getChildren` walk, TSX script kind) and asserted every removed range's text actually opens a comment:

```
files scanned: 194
comment ranges the oracle removes: 8240
ranges removed that are NOT comments (oracle deletes real code): 0
```

Round-3 K8's soundness property (unsound by omission only, never by over-reach) still holds after the fix. The full-corpus detector remains mathematically valid. **SURVIVES.**

### K4 — round-3 R4 / drill C2 (the offset attack) CLOSED, proven without a line shift [demonstrated]

An insert-a-line drill would fail for the wrong reason (N3 below). So I ran the offset attack **in place**, changing no line count: an inline JSDoc annotation that kills one `TS7006` at line 135, plus a dropped required argument at line 341.

```
$ line 135: function isValidSessionId(/** @type {string} */ id) {
$ line 341:   } else if (wasReasonActive(initialHaltState)) {
$ npm run qa:hook-typecheck-coverage
[QA hook-typecheck-coverage-check] FAIL: 1 of 3 production hook(s) under hooks/ failed typecheck-coverage.
  - hooks/sessionstart-tool-enum.mjs: 30 diagnostic(s) found, 1 identity(ies) exceed the pinned Issue #361
    baseline — a NEW regression, not the known pre-existing debt: 2345:182 (new, x1)
rc=1
```

The total is **exactly 30** — the pinned count. A raw `count > baseline` check passes this; a strict-equality `count !== baseline` check also passes it. The identity multiset catches it. That is the right fix for the right reason, and the duplicate-preserving multiset (rather than a `Set`) is a detail the builder got right for a stated, checkable reason.

### K5 — Issue #366 (path-suffix match) CLOSED [demonstrated]

Planted at the real call site, a specifier that is path-**equivalent** but not string-identical:

```
$ (hooks/pretooluse-kernel-gate.mjs: the sanitize import respelled with an interior /../ segment)
$ node --test src/policy/config/sanitize.test.ts
FAIL AC-7/AC-7c: ... AssertionError: ... no path-suffix lookalike. Got: sanitizeMod.sanitizeForTerminal
```

Exact equality fires. The decoupled raw-text regex assertion app-security's HIGH-1 named is removed rather than patched — the right call, verified in K12. `app-security-reviewer`'s own round-2 post-merge report independently reached the same conclusion on this Issue; I concur, on my own evidence, that **#366 is closeable**.

### K6 — round-2 drill N2 CLOSED (re-confirmed on merged code) [demonstrated]

```
$ (src/policy/kernel/kernel.ts: a node:fs import, a KERNEL_GLOB string constant whose value contains a
   comment-opener sequence, and a live readFileSync — the identical round-2 payload)
$ npm run qa:kernel-purity
[QA kernel-purity-check] FAIL: 1 kernel-purity violation(s) ... [non-relative-import] import "node:fs" ...
rc=1
$ node --test src/qa/kernel-purity-check.test.ts
FAIL every scanned kernel file reports its real import count
FAIL checkKernelPurity: the REAL src/policy/kernel production code is itself pure
```

### K7 — round-2 drill N4 CLOSED (re-confirmed at the real call site) [demonstrated]

```
$ (the env-gated object-literal port, planted at hooks/pretooluse-kernel-gate.mjs's one call site)
$ node --test src/policy/config/sanitize.test.ts
FAIL AC-7/AC-7c ... AssertionError: ... no port-object masquerade ... Got: sanitizePort.sanitizeForTerminal
```

### K8 — round-3 R5's proof-test is committed, and it bites [demonstrated]

`kernel-purity-check.test.ts:126-140` is the instrument I asked for, widened from 8 files to the whole `src/` + `hooks/` corpus (at least 150 files asserted). It passes at baseline — so the two lossy files round 3 measured (`gate-structure.test.ts`, `marker-corpus-probe.test.ts`, both in this diff) are genuinely fixed. Mutation-sensitivity, because a green passing test proves nothing on its own:

```
$ (src/policy/gate/render-hook-output.ts: added a path-matching regex literal ending in an escaped slash)
$ node --test src/qa/kernel-purity-check.test.ts
FAIL stripComments agrees with a TypeScript-scanner-derived oracle on every scanned production source
FAIL stripComments never loses real code ... on every .ts/.mjs/.js source under src/ and hooks/
tests 60 / pass 58 / fail 2 / skipped 0
```

Both directions of the R5 remediation are real. **SURVIVES.**

### K9 — the normalizer lane cannot drift from its control [code-traced]

`enforcedLaneSources()` imports `REGISTRY_PATH` from `normalizer-registry-purity-check.ts:71` rather than re-typing the path, and `checkNormalizerRegistryPurity` defaults to that same constant (`:80`). The enforced set is exactly one file by design, and the guard's set is that file by derivation. The 8 other production `.ts` files under `src/policy/normalizer/` are outside the control's own scope, so there is no differential gap — and the full-corpus lossy test (K8) covers them anyway. **SURVIVES.**

### K10 — round-3 R6 is no longer reproducible [demonstrated]

```
$ (one innocuous untracked one-line .ts file created under src/policy/kernel/)
$ node --test src/secret-scan/pre-commit-scan.test.ts
tests 26 / pass 26 / fail 0 / skipped 0
```

Round 3: `26 / 25 / 1`. And the closing full-suite run was 1532/1532 with two untracked sibling reports sitting in `docs/reviews/`. Whatever fixed it, it is fixed. **SURVIVES** — I am withdrawing round-3 R6 rather than restating it.

### K11 — CI wiring of the delta is live, not nominal [demonstrated]

```
ci.yml:196-203    Typecheck -> npm run typecheck  |  Lint -> npm run lint (= eslint .)  |  Test -> npm test
ci.yml:254-255    QA-18 hook-typecheck-coverage-check -> node src/qa/hook-typecheck-coverage-check.ts
```

`npm run lint` is `eslint .`, broader than the `eslint src hooks` I used locally, so the new `ban-ts-comment` block genuinely runs in CI (verified firing in N4 below). **SURVIVES.**

### K12 — ADR compliance, including the one deleted assertion [code-traced]

- **SE ADR-0021 POL-11** — enforcement strictly strengthened: `process` moved into the parse-based AST layer, lane enumeration generated. No relaxation anywhere.
- **SE ADR-0021 POL-12** — normalizer lane derived from the control's own constant (K9).
- **SE ADR-0005 / ADR-0010 ("MUST NOT delete or weaken a failing test to make CI pass")** — round 4 **deletes** one assertion: the raw-text import-specifier `assert.match` in `sanitize.test.ts`. Not a violation. That assertion was *demonstrated* unsound (app-security HIGH-1: satisfiable by a dead-code decoy), it lived inside a named test that still exists and still runs, and the assertion that replaced it is strictly stronger on the same property — proven, not asserted, by K5 firing on the exact shape the old pair let through. This is the one deletion in the delta and it is the correct kind.
- **SE ADR-0010 ("MUST NOT disable, skip, or inline-suppress linter/type/test rules to get green ... without a comment justifying it AND a human-approved exception in the PR")** — this is the clause **N2 and N4 land against**: the eslint default enforces only the *comment* half of that MUST (any 3-character description satisfies it), and a JSDoc any-cast satisfies neither half while being undetected entirely. The delta itself introduces zero suppressions (measured: 0 `@ts-*` pragmas and 0 JSDoc any-casts under `hooks/` today).
- **THOTH-ADR-0001 / THOTH-ADR-0002** — no fixture loader, halt-state, allowlist or baseline-guard code touched. ADR-0001's "a change to the hooks that read the fixture still needs a fresh dated review report" clause is discharged by this report plus the two sibling reports dated today.

No ADR violation in the delta. **SURVIVES.**

---

## Part 2 — new findings against the round-4 code itself

## N1 — [ISSUE][MED][demonstrated] the new lexical scope model resolves only Block/SourceFile variable statements, so a function-parameter or object-binding-pattern shadow still walks past it — raw ESC and NUL through the real spawned hook, with 32/32 guard tests green

`Exposure: 100% of future refactors of the ONE guarded call site that bind sanitizeMod as a function parameter or via an object binding pattern; 0% live today (measured: the shipped hook's own shape resolves correctly, and the PreToolUse hook is unwired per Issue #308). Basis: counted in code (findBindingInScope iterates scope.statements and matches only ts.isIdentifier / ts.isArrayBindingPattern, src/policy/config/sanitize.test.ts:187-202) + measured end-to-end.`
*(Security / control-integrity category.)*

**The gap, code-traced first.** `findEnclosingScope` (`:178-182`) walks to the nearest `SourceFile`/`Block`. `findBindingInScope` (`:187-202`) then searches **only that scope's `scope.statements`**, and only accepts `ts.isIdentifier(decl.name)` or `ts.isArrayBindingPattern(decl.name)`. Every other binding form in JavaScript is invisible to it — and invisibility here means "keep walking outward", i.e. **resolve to the real import and return green**. The file's own comment (`:154-156`) discloses part of this ("no hoisting, no `var`, no function-parameter binding, no TDZ"). Disclosure is not defence, and the disclosed list is incomplete: object binding patterns are not mentioned.

**Drill N1a — a function parameter.** Planted at the real hook's one call site: a JSDoc-annotated `function emit(sanitizeMod) { return render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal); }`, called with an env-gated object literal built from the real sanitizer.

```
$ npm run build                            rc=0
$ npx eslint src hooks                     rc=0
$ npm run qa:hook-typecheck-coverage       PASS rc=0  (- hooks/pretooluse-kernel-gate.mjs: 0 diagnostic(s), fully covered)
$ node --test src/policy/config/sanitize.test.ts hooks/pretooluse-kernel-gate-sanitize.test.ts \
             src/policy/gate/render-hook-output.test.ts src/policy/gate/gate-structure.test.ts
tests 32 / pass 32 / fail 0 / skipped 0
```

Still one `renderHookOutput` call site, so AC-7c is satisfied. AC-7b resolves `sanitizeMod` from the function body's `Block` (which holds no matching variable statement) outward to the real array-destructured import, and returns true. AC-9's env matrix does not contain the env name I used — it is a finite 6-case list that its own header admits cannot prove a negative over an open set. Live, through the **real spawned hook** in the pinned copy-tree sandbox:

```
RT env={}                              policyDenied=true rawESC=false rawNUL=false
RT env={"<one unlisted name>":"1"}     policyDenied=true rawESC=true  rawNUL=true
```

**Drill N1b — an object binding pattern, in the exact nested-block shape round 4 pinned.** The new committed regression test (`sanitize.test.ts:413`) pins drill N9's shape using `const sanitizeMod = {...}` — an *Identifier*. Changing one token to an object binding pattern (`const { sanitizeMod } = { sanitizeMod: {...} }`) walks straight through the new pin:

```
$ npm run build                        rc=0
$ npx eslint src hooks                 rc=0
$ npm run qa:hook-typecheck-coverage   PASS rc=0  (- hooks/pretooluse-kernel-gate.mjs: 0 diagnostic(s), fully covered)
$ node --test src/policy/config/sanitize.test.ts hooks/pretooluse-kernel-gate-sanitize.test.ts
tests 17 / pass 17 / fail 0 / skipped 0
RT env={}                              policyDenied=true rawESC=false rawNUL=false
RT env={"<one unlisted name>":"1"}     policyDenied=true rawESC=true  rawNUL=true
```

**Current defense, credited honestly.**
- The scope walk is a **real** improvement and it does exactly what I named in round 3 for the shape I named: drill N9's `const`-Identifier shadow is dead, pinned by its own regression test, and I confirmed the non-regression test (a same-scope alias hoist) still resolves.
- The exactly-one-call-site assertion still forces an attacker to reuse the single call site rather than add one — a genuine constraint that shapes every drill above.
- `THOTH_PLAIN_REASON` was added to AC-9's matrix as I asked. It is a pin on the one name a demonstrated drill used, which is honest and useful, and it is also why a one-token rename walks past it.
- This is a **source-text smoke check**, explicitly not the load-bearing guard by its own header; the load-bearing guard is AC-9, whose finite env matrix is the composing half. Both halves of round-3 R3 therefore remain open in a new form.

**Why MED, not HIGH, stated plainly for the auditor.** Round 3 rated the identical class MED, live exposure is measured at 0% (Issue #308), and no shipped behaviour is defective. Rating it HIGH now, after the team delivered the remediation I named, would be goalpost-moving. `app-security-reviewer`'s round-2 post-merge report reached the same MED on overlapping routes (arrow-param, catch, for-of, `var`); my two routes are additional, independently demonstrated, and end-to-end. **Same root-cause class as round-3 R3, recurring in a new form** — the Manager should weigh that against PRINCIPLES rule 16's repeat-root-cause counter, which is its call, not mine.

**Verdict: BREAKS. Issue #360 is NOT closeable.**

**Named proof-test required.**
`src/policy/config/sanitize.test.ts :: "AC-7e: a function-parameter and an object-binding-pattern shadow of sanitizeMod are both rejected — the resolver enumerates every binding form in the reference's scope chain, not only Block/SourceFile variable statements with an Identifier or array-pattern name"`. The durable fix is to stop hand-rolling scope resolution: build a real `ts.Program` over the hook (`tsconfig.hooks.json` already covers exactly this file, cleanly) and ask the **type checker** for the symbol — `checker.getSymbolAtLocation(objExpr)` plus `symbol.declarations` — which gets parameters, patterns, hoisting and TDZ for free. Pair it with the structural assertion I named in round 3 and which is still not present: **no `process.env` read may occur between the sanitize import and the call site**, which closes the whole open set AC-9's finite list cannot.

---

## N2 — [ISSUE][MED][demonstrated] a JSDoc any-cast is a type-suppression vector no layer detects — the same defect class as Issue #367, with zero backstop

`Exposure: 100% of type-only defects introduced in the 3 production hooks under a JSDoc any-cast; 0 such casts exist under hooks/ today (measured: grep returns 0). Basis: measured.`

**The gap.** Issue #367's root cause is "a suppression removes the diagnostic entirely, so no counting or identity scheme can see it." Round 4 closes that by banning the three `@ts-*` pragmas — at two layers (eslint, plus a regex test). Neither layer knows about JSDoc casts, which suppress `checkJs` diagnostics just as completely and are not pragmas.

**Drill N2 — against `hooks/pretooluse-kernel-gate.mjs`, the one hook held to ZERO diagnostics and the only hook inside the real build gate.** `failClosed(what, err)` takes two required parameters; the mutant casts the callee through a JSDoc any-type and drops one argument, degrading the fail-closed error path of the `PreToolUse` gate.

```
$ npm run build                                 rc=0
$ npx eslint src hooks                          rc=0
$ npm run qa:hook-typecheck-coverage
[QA hook-typecheck-coverage-check] PASS: 3 production hook(s) under hooks/, each resolves inside a tsconfig project and stays within its coverage bar.
  - hooks/pretooluse-kernel-gate.mjs: 0 diagnostic(s), fully covered
rc=0
$ node --test src/qa/hook-typecheck-coverage-check.test.ts
PASS Issue #367: no hooks/*.mjs file contains @ts-ignore, @ts-expect-error, or @ts-nocheck — the suppression
     vector the pinned-baseline ratchet alone cannot detect
tests 9 / pass 9 / fail 0 / skipped 0
```

Four layers green, including the one named "the suppression vector the ratchet alone cannot detect", over a suppressed real bug in the security-critical fail-closed path. `@typescript-eslint/no-explicit-any` is scoped to `src/**/*.ts` and does not read JSDoc anyway.

**Current defense, credited honestly.** The hook's own behavioural tests **do** catch this mutant loudly (`hooks/pretooluse-kernel-gate-launch.test.ts`: `FAIL A6 fail-closed-stderr-names-error-type-only-and-an-unlock`, `FAIL A7 fail-closed-error-name-is-sanitized`). So this is defence-in-depth, not an unguarded hole — the same reasoning that kept round-3 R4 at MED, applied consistently. The unguarded residual is exactly the layer Issues #361/#367 exist to add: **a type-only defect on a path no behavioural test exercises** (a widened union, a nullable narrowing, an arity change on a cold branch) is invisible everywhere.

Calibration note, stated rather than buried: `app-security-reviewer` rated this route LOW ("inherent") in its round-2 post-merge report. I rate it MED, because it is the *only* route in the whole #367 family with **no** detecting layer — every pragma spelling, including the ones they rated HIGH, is caught by the regex test. Strictly worse coverage, therefore not lower severity. The calibration call is the Manager's (PRINCIPLES rule 21).

**Verdict: BREAKS. Issue #367 is NOT closeable.**

**Named proof-test required.**
`src/qa/hook-typecheck-coverage-check.test.ts :: "no hooks/*.mjs file contains a type-widening suppression — a @ts-* pragma, a JSDoc any-type cast, or an inline eslint-disable of ban-ts-comment"` — widen the existing regex test from three pragma spellings to the suppression **class**, and make the test the named authority rather than eslint (see N4). Per SE ADR-0010 the durable form pairs that with an explicit, human-approved exception list, not an implicit "any description will do".

---

## N3 — [ISSUE][MED][demonstrated] the code-plus-line identity pin false-fails on almost any edit to the excepted hooks, and its own remediation is a silent re-baseline vector

`Exposure: 89.4% of the two excepted hooks — measured: any line-count-changing edit at or above line 618 of 624 in hooks/sessionstart-tool-enum.mjs (99.0%) or line 432 of 551 in hooks/userpromptsubmit-halt-relay.mjs (78.4%), i.e. 1050 of 1175 lines, shifts at least one pinned identity. Basis: measured.`

**Drill N3 — one blank line, sixteen "NEW regressions".** A single empty line inserted after the file's first line — no semantic change whatsoever:

```
$ npm run qa:hook-typecheck-coverage
[QA hook-typecheck-coverage-check] FAIL: 1 of 3 production hook(s) under hooks/ failed typecheck-coverage.
  - hooks/sessionstart-tool-enum.mjs: 30 diagnostic(s) found, 16 identity(ies) exceed the pinned Issue #361
    baseline — a NEW regression, not the known pre-existing debt: 7006:136 (new, x1), 7006:206 (new, x1),
    7006:235 (new, x1), 7006:242 (new, x1), 7006:270 (new, x5), 2339:283 (new, x1), 7006:292 (new, x2),
    7006:328 (new, x7), 7006:348 (new, x1), 7006:390 (new, x2), 7006:411 (new, x1), 2322:527 (new, x1),
    2339:530 (new, x1), 2339:611 (new, x1), 2339:616 (new, x1), 2339:619 (new, x1)
rc=1
$ npx eslint hooks    rc=0
$ npm run build       rc=0
```

Total count is still exactly 30. The instrument asserts "**a NEW regression, not the known pre-existing debt**" — sixteen times — over whitespace.

**Why this is more than an annoyance.** The header (`hook-typecheck-coverage-check.ts:53-57`) discloses line fragility as "an accepted, disclosed characteristic ... it forces a visible, reviewable pin update". The visible, reviewable pin update is **a 30-entry and/or 22-entry hand-typed array of code-colon-line strings that no reviewer can meaningfully diff**. And because the pin is regenerated wholesale from the file's current state, **any genuine new diagnostic present in that same commit is laundered into the baseline** — the exact "pay down debt, bank the headroom" failure round-3 R4 attacked, restored at the moment of remediation rather than in the comparison. It is also the Issue #332 shape the team has hit repeatedly: a guard that fires on the benign edit trains the next author to loosen it.

Two further mechanical notes: `PINNED_BASELINES` is a **hand-typed** 52-string list against CLAUDE.md's "no hand-derived completeness claims" (the values are measured, the list is typed); and `resolveProjectAndDiagnostics` (`:170-178`) silently `continue`s on any diagnostic without a `file`, so a project-level diagnostic is invisible to the ratchet by construction.

**Current defense, credited honestly.** It fails **loud** and in the safe direction, and the identity scheme is genuinely the right answer to the offset attack (K4 — it caught a no-line-shift offset that both a raw-count and a strict-equality count check would have passed). The defect is precision, not direction. `cross-domain-reviewer` filed the same shape today as LOW (F3); I rate it MED on the measured 89.4% figure and the re-baseline-laundering coupling.

**Verdict: BREAKS.**

**Named proof-test required.**
`src/qa/hook-typecheck-coverage-check.test.ts :: "a purely cosmetic edit that shifts line numbers does not report a NEW regression — diagnostic identity is position-independent"` — replace the code-plus-line identity with a position-independent one (the error code plus a normalized excerpt of the diagnostic's own source line, or the code plus the enclosing declaration's name), and **generate** `PINNED_BASELINES` from a committed, script-written snapshot with a regenerate flag that refuses to run when the total count would rise.

---

## N4 — [ISSUE][MED][demonstrated] the eslint ban-ts-comment ban is a no-op for a described `@ts-expect-error`, and its error message on `@ts-ignore` recommends exactly that bypass

`Exposure: 100% of @ts-expect-error uses carrying a 3-character-or-longer description; 0 such uses exist under hooks/ today (measured). Basis: measured.`

**The gap, code-traced.** `eslint.config.mjs:85` is `"@typescript-eslint/ban-ts-comment": "error"` — **no options**, so the rule's defaults apply:

```
$ node -e "console.log(JSON.stringify(require('<plugin>/dist/rules/ban-ts-comment.js').default.defaultOptions))"
[{"minimumDescriptionLength":3,"ts-check":false,"ts-expect-error":"allow-with-description","ts-ignore":true,"ts-nocheck":true}]
```

`ts-expect-error: "allow-with-description"`. The config comment at `:79-84` states the opposite: *"neither pragma may appear anywhere under `hooks/`, full stop"*. That claim is false as configured.

**Drill N4 — measured all three spellings against the real hook, with a real dropped-argument bug beneath each.**

```
a bare @ts-ignore                             -> eslint rc=1
   "Use \"@ts-expect-error\" instead of \"@ts-ignore\", as \"@ts-ignore\" will do nothing if the following
    line is error-free"   @typescript-eslint/ban-ts-comment
@ts-expect-error with a 2-character description -> eslint rc=1  ("description must be 3 characters or longer")
@ts-expect-error with a real description        -> eslint rc=0     <-- ALLOWED
    with: npm run build rc=0, and
    qa:hook-typecheck-coverage PASS rc=0 — "hooks/pretooluse-kernel-gate.mjs: 0 diagnostic(s), fully covered"
```

Note the second-order defect: the rule's **own unlock message for the banned spelling names the allowed spelling**. An author blocked on `@ts-ignore` is instructed by the tool to switch to the form that passes. PRINCIPLES rule 2 wants every block to name its unlock; this one names a bypass.

**Current defense, credited honestly.** The committed regex test `src/qa/hook-typecheck-coverage-check.test.ts:18-23` catches **all three** spellings textually, and I confirmed it firing. So the vector is closed — by the test, not by the thing the fix commit and the config comment both credit. That inverted attribution is the finding: the test's own failure message tells the author the pragma is *"banned by eslint.config.mjs"*, which is false for the spelling eslint itself recommends, so a future author who "fixes" the lint error lands on the allowed form and is then confused by a test failure that blames a file that permits it. One layer of the claimed two exists. Fixing it is one line.

**Verdict: BREAKS** (the guard does not do what it is documented and credited to do), **not a live bypass** (the test holds).

**Named proof-test required.**
`eslint.config.mjs` plus a test pinning the resolved rule options :: "the hooks lint block bans all three @ts-* pragmas outright — ban-ts-comment is configured with explicit options, not defaults" — set the rule to `["error", { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": true }]`, and pin the resolved options in a test so a future default change in the plugin cannot silently reopen it. Consider `noInlineConfig` for the hooks block in the same edit (an inline eslint-disable defeats any rule here; `app-security-reviewer` demonstrated that route today).

---

## N5 — [ISSUE][LOW][demonstrated] a new production hook added with a `.js` extension escapes the coverage enumeration, the eslint ban, and the pragma test at once

`Exposure: 0 of 3 production hooks today (measured: 0 .js files under hooks/); latent on the first one. Basis: measured.`

All three layers key on the `.mjs` extension: `listProductionHooks` filters on that suffix (`hook-typecheck-coverage-check.ts:133-138`), the eslint block is `files: ["hooks/**/*.mjs"]`, and the pragma regex test iterates `listProductionHooks`. `package.json` has `"type": "module"`, so a `.js` file under `hooks/` is ESM and runs as a hook unchanged.

**Drill N5** — a new `hooks/*.js` file carrying a `@ts-nocheck` and a dropped-argument call:

```
$ npx eslint src hooks                  rc=0
$ npm run build                         rc=0
$ npm run qa:hook-typecheck-coverage    PASS rc=0   ("3 production hook(s) under hooks/" — the 4th is invisible)
$ node --test src/qa/hook-typecheck-coverage-check.test.ts   tests 9 / pass 9 / fail 0
$ qa:kernel-purity rc=0  qa:completeness-claims rc=0  qa:gate-command-path rc=0  qa:gate-manifest rc=0
```

A first attempt that referenced `process` **was** caught, incidentally, by `no-undef` (the Node globals are declared only in the `.mjs` block) — so the escape needs a hook that touches no Node global, which the drill above is. Credited: a new `.mjs` hook fails loud in three places (the exact-3-name `deepEqual` pin, the hardcoded `tsconfig.hooks-coverage.json` include list, and the "does not resolve inside ... no tsconfig project covers it at all" branch). The extension is the only hole, and it is a convention slip rather than an attack. Round 3 noted this as an unfiled hypothetical; it is now demonstrated, so it graduates to a filed LOW.

**Verdict: BREAKS.**

**Named proof-test required.**
`src/qa/hook-typecheck-coverage-check.test.ts :: "listProductionHooks enumerates every executable hook under hooks/, .mjs and .js alike — a new .js hook is covered, linted and pragma-scanned the day it lands"` — widen the filter to both extensions, widen the eslint block's `files` glob to match, and assert the eslint config's own glob covers exactly what `listProductionHooks` returns.

---

## Partial failure, concurrency, dependency reality, hostile lens

No apply path and no shared mutable state in this delta, so the classic partial-apply questions are largely N/A. What I did check:

- **Partial application.** The four pieces (the `eslint.config.mjs` rule, `PINNED_BASELINES`, the regex test, the CI step) landed in one commit. If `tsconfig.hooks-coverage.json` were missing, `resolveProjectAndDiagnostics` throws a named error (`failed to read tsconfig.hooks-coverage.json: ...`) — loud, not a silent skip. If the eslint rule were dropped, the regex test still holds (N4). If the regex test were dropped, eslint still catches two of three spellings. The layers degrade gracefully in the right direction.
- **Drift between the two tsconfig projects.** `tsconfig.hooks-coverage.json` extends `./tsconfig.json`, so enabling a new strict flag at the root moves the diagnostic set and breaks QA-18 in a change unrelated to hooks. With the round-4 **identity** pin this is now worse than with a count pin: a strictness change does not merely raise a number, it invalidates the whole 52-entry multiset, and the remediation is N3's bulk re-baseline. Carried for the Manager, folded into N3 rather than filed twice.
- **Concurrency.** The AC-13 test writes a pid-and-timestamp temp directory at the repo root and removes it in a `finally`; collision between concurrent runs is implausible. A killed run leaves the directory — previously that broke `npm test` via round-3 R6, which is now fixed (K10), so the two-benign-designs-composing-badly coupling I flagged in round 3 is gone.
- **Dependency reality.** `ban-ts-comment`'s behaviour here is decided entirely by the plugin's **default options**, a vendor value that can change across a `typescript-eslint` minor. N4's proof-test pins them explicitly; today's config inherits them. That is the one genuine vendor-semantics dependency in the delta.
- **Provider throttling, quotas, AZ degradation, console/plan drift:** not applicable.

**Hostile lens — a contributor with ordinary commit access, no workflow-editing rights.** Ranked by how reviewable the diff looks:

1. **Wrap the one guarded call site in a small named helper** (N1a). The diff reads as an extraction refactor. Every guard, including the behavioural env matrix, is green; the leak is gated on an env-var name the matrix does not enumerate. This is the strongest path because the control that exists to stop it reports success.
2. **Change an identifier binding to an object-destructuring binding** inside the nested block round 4 just pinned (N1b). A one-token diff that walks past the brand-new regression test.
3. **Cast a call through a JSDoc any-type** (N2). Reads as a pragmatic JSDoc annotation, and it is the only suppression route with zero detecting layer.
4. **Write a described `@ts-expect-error`** (N4) — allowed by lint, caught by one test whose message misattributes the ban.

The weakest link in the trust chain is unchanged from round 3 in kind but has moved in location: it is no longer "a scan that does not parse the language", it is **"a guard that hand-rolls a language feature the compiler in the same repo already implements"**. `tsconfig.hooks.json` builds a real, clean program over exactly the file `sanitize.test.ts` inspects by hand.

## Editorial (verdict-neutral, plain edits, no re-review)

- `eslint.config.mjs:82-84` — "neither pragma may appear anywhere under `hooks/`, full stop" is false as configured (N4). Either add the options or reword the claim.
- `src/policy/config/sanitize.test.ts:154-156` — the disclosed scoping residual lists "no hoisting, no `var`, no function-parameter binding, no TDZ" but omits **object binding patterns**, which N1b exploits, and omits that an unresolvable binding **fails open** (resolution continues outward) rather than closed.
- `src/qa/hook-typecheck-coverage-check.test.ts:21` — the failure message says a pragma is "banned by `eslint.config.mjs` under `hooks/**/*.mjs`". For `@ts-expect-error` it is not; this test is the only thing banning it.
- `src/qa/hook-typecheck-coverage-check.ts:70-127` — `PINNED_BASELINES` is a 52-string hand-typed list. The values are measured; the list is not generated. Ship the generator alongside it (N3).
- `src/qa/kernel-purity-check.test.ts:91-93` and `src/policy/gate/gate-structure.test.ts:15` — the gate lane is enumerated with non-recursive `readdirSync` in **both** the guard and its consumer, so they cannot drift from each other, but a future `src/policy/gate/<subdir>/` would be invisible to both. Pre-existing, outside this delta, noted only so it is on the record.
- A 9th private `stripComments` implementation exists in `print-lines.test.ts` (found by `cross-domain-reviewer` today); round-3 R5's "8 importers" count is now stale.

## Open findings vs failing tests

5 open findings, 5 named failing tests — equal, no gap to explain:

| Finding | Failing test |
|---|---|
| N1 | `sanitize.test.ts` — AC-7e: a function-parameter and an object-binding-pattern shadow are both rejected |
| N2 | `hook-typecheck-coverage-check.test.ts` — no hook contains a type-widening suppression of any spelling, pragma or JSDoc cast |
| N3 | `hook-typecheck-coverage-check.test.ts` — a cosmetic line shift does not report a NEW regression |
| N4 | `eslint.config.mjs` plus a test pinning the resolved `ban-ts-comment` options — all three pragmas banned outright |
| N5 | `hook-typecheck-coverage-check.test.ts` — `listProductionHooks` covers both hook extensions |

## Per-issue closeability, stated explicitly

- **#360 — NOT closeable, stays OPEN.** The scope-model fix is real and closes the shape I named (drill N9's const-Identifier shadow, pinned by its own test). Two other binding forms — a function parameter and an object binding pattern — still resolve to the real import while the real spawned hook leaks raw ESC and NUL under an env var outside AC-9's matrix (N1, demonstrated twice, end-to-end). The second half of round-2 R2 (AC-9's finite env matrix) is still finite, by its own design.
- **#361 — stays OPEN.** The ratchet's offset route is genuinely closed, proven without a line shift (K4). But the real build gate (`tsconfig.hooks.json`) still covers 1 of 3 hooks, which is the Issue's own title and its declared, Manager-approved scope — not a defect, just not done. N3 and N5 are new gaps against its instrument.
- **#366 — CLOSEABLE.** Exact-specifier equality fires at the real call site on a path-equivalent respelling (K5); the structurally decoupled raw-text regex is removed rather than patched, and its removal is not an ADR-0005/0010 test-weakening (K12). `app-security-reviewer` independently concurs today.
- **#367 — NOT closeable, stays OPEN.** The three pragma spellings are closed, by the regex test (eslint closes two of three, N4). The suppression **class** is not: a JSDoc any-cast hides a real bug in the one hook held to zero diagnostics, with build, lint, QA-18 and the #367 test itself all green (N2). The Issue's root cause — "a suppression removes the diagnostic entirely" — is unaddressed for a route that requires no pragma at all.

## Scariest unproven assumption

**That a hand-rolled re-implementation of JavaScript's lexical scoping — written inside a test, in a repo whose CI already builds a clean, real `ts.Program` over the very file being inspected — is close enough to the real thing to be a security control.** It is not, and the gap is not theoretical: I changed one identifier binding to an object-destructuring binding inside the exact nested block round 4 pinned, and 17 of 17 guard tests stayed green while the real spawned hook emitted raw ESC and raw NUL under one env var. Round 2's lesson was that a purity claim rested on a scanner being right about a language it does not parse. Round 3's was that the claim rested on a guard being pointed at every file it covers. Round 4's is the same lesson a third time, one layer up: **the claim now rests on a guard being right about a language feature the compiler in the same repository already implements correctly.** `checker.getSymbolAtLocation` is available, `tsconfig.hooks.json` already resolves this file cleanly, and the guard does not use it.

## Go / no-go

**go.** No HIGH. The round-4 delta delivers, and I independently confirmed it by re-running the original attacks rather than by reading the diff: round-3 R1/N7b is closed twice over and `process` is now backstopped at the layer that cannot be blinded; round-3 R2/N8's 22.8%-of-repo false-positive class is gone and the oracle still never over-strips after the new call; round-3 R4's offset attack is closed for the right reason, proven at exactly 30 == 30 with no line shift; round-3 R5's full-corpus differential is committed, passing, and mutation-sensitive; Issue #366's suffix match is closed; round-2 drills N2 and N4 remain closed on merged code; round-3 R6 is no longer reproducible and I am withdrawing it. Shipped sanitization behaviour — what story #312 set out to do — is unchanged and still correct, and the full suite is 1532/1532 with 0 skipped.

What is open is guard precision and guard coverage, again: 4 MED and 1 LOW, each with a named failing test, live exposure measured at 0% on every surface (Issue #308 keeps the hook unwired; 0 pragmas and 0 JSDoc any-casts exist today). The code is already merged, so this verdict is about what happens next, not about a gate: **nothing here warrants a revert.**

**Conditions the Manager should carry (not gating a merge that already happened):**
1. **Issues #360 and #367 must not close.** Each has a demonstrated live bypass of the control the round-4 fix installed. #366 can close. #361 stays open on its own title.
2. **This is the same root-cause class for the third consecutive round** on the sanitize guard (round-2 R2 → round-3 R3 → round-4 N1) and the second on the suppression vector (#367 → N2). PRINCIPLES rule 16's repeat-root-cause counter is the Manager's to apply, but the pattern is now a fact rather than an impression, and the remedy is architectural (use the type checker; widen from spellings to classes) rather than another round of shape-by-shape patching.
3. **N3 has immediate operational cost.** The next line-count-changing edit to either excepted hook — 89.4% of their lines, measured — fails CI with "a NEW regression" over whitespace, and the prescribed remediation is a 52-string bulk re-baseline that would launder any concurrent real diagnostic. Schedule it; do not backlog it.

## Single next action

Replace `findBindingDeclaration`'s hand-rolled scope walk in `src/policy/config/sanitize.test.ts` with a real `ts.Program` symbol lookup over `tsconfig.hooks.json` (`checker.getSymbolAtLocation` plus `symbol.declarations`), and in the same edit widen `src/qa/hook-typecheck-coverage-check.test.ts:21`'s regex from three pragma spellings to the suppression class (pragmas **plus** JSDoc any-type casts **plus** inline eslint-disable of `ban-ts-comment`). Those two changes close N1, N2 and N4 together, and they replace three hand-rolled approximations with the compiler that is already in the build.

---

```
RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] The round-4 lexical scope model resolves only Block/SourceFile variable statements whose name is an Identifier or array-binding-pattern element (findBindingInScope, src/policy/config/sanitize.test.ts:187-202), so every other binding form FAILS OPEN — resolution keeps walking outward and finds the real import. Drill N1a (a JSDoc-annotated function declaration taking sanitizeMod as a parameter, planted at the real hook's one call site): build rc=0, eslint rc=0, qa:hook-typecheck-coverage PASS rc=0 "0 diagnostic(s), fully covered", 32/32 guard tests green, and the REAL spawned hook in the pinned copy-tree sandbox emitted rawESC=true rawNUL=true under one unlisted env var (env={} clean). Drill N1b (one token: an identifier binding changed to an object-destructuring binding, inside the EXACT nested block sanitize.test.ts:413 was just written to pin): 17/17 green, same live ESC+NUL leak. Defense credited honestly: the fix is real and kills drill N9's own shape, the non-regression alias hoist still resolves, and the exactly-one-call-site assertion forces reuse of the single call site; AC-9 gained THOTH_PLAIN_REASON as I asked but remains a finite 6-case matrix its own header admits cannot prove a negative, so a renamed env var walks past it. The disclosed residual at :154-156 omits object binding patterns and omits that unresolved bindings fail OPEN. Same root-cause class as round-3 R3, third consecutive round on this guard; MED not HIGH to match my own round-3 calibration, not because the risk shrank. Issue #360 NOT closeable. Exposure: 100% of future refactors of the one guarded call site binding sanitizeMod as a parameter or object pattern; 0% live today (PreToolUse hook unwired, Issue #308), basis: counted in code + measured end-to-end.
2. [ISSUE][MED][demonstrated] A JSDoc any-type cast is a type-suppression vector NO layer detects — the same defect class as Issue #367 via a route that needs no pragma at all. Drill N2 cast failClosed through a JSDoc any-type and dropped a required argument in hooks/pretooluse-kernel-gate.mjs (the ONE hook held to zero diagnostics and the only hook inside the real build gate), degrading the security-critical fail-closed path: npm run build rc=0, npx eslint src hooks rc=0, qa:hook-typecheck-coverage PASS rc=0 printing "hooks/pretooluse-kernel-gate.mjs: 0 diagnostic(s), fully covered", and the test literally named "the suppression vector the pinned-baseline ratchet alone cannot detect" PASSED 9/9. Lands against SE ADR-0010's inline-suppress MUST. Defense credited: the hook's own behavioural tests catch THIS mutant loudly (pretooluse-kernel-gate-launch.test.ts A6 and A7 both fail), so defence-in-depth not an unguarded hole — the unguarded residual is a type-only defect on a path no behavioural test exercises, exactly the layer #361/#367 exist to add. Calibration stated: app-security rated this route LOW today; I rate MED because it is the ONLY route in the #367 family with zero detecting layer (every pragma spelling is caught by the regex test), so strictly worse coverage cannot be lower severity — the call is the Manager's per rule 21. Issue #367 NOT closeable. Exposure: 100% of type-only defects introduced under a JSDoc any-cast in the 3 production hooks; 0 such casts exist under hooks/ today, basis: measured.
3. [ISSUE][MED][demonstrated] The code-plus-line identity pin false-fails on almost any edit to the two excepted hooks, and its own remediation is a silent re-baseline vector. Drill N3 inserted ONE blank line after line 1 of hooks/sessionstart-tool-enum.mjs — zero semantic change — and qa:hook-typecheck-coverage FAILED rc=1 asserting "16 identity(ies) exceed the pinned Issue #361 baseline — a NEW regression, not the known pre-existing debt: 7006:136 (new, x1) ... 2339:619 (new, x1)", with the total still exactly 30 and eslint rc=0, build rc=0. Measured trigger surface: any line-count-changing edit at or above line 618 of 624 (99.0%) in sessionstart-tool-enum.mjs or line 432 of 551 (78.4%) in userpromptsubmit-halt-relay.mjs = 1050 of 1175 lines, 89.4%. The disclosed "forces a visible, reviewable pin update" remediation is a 52-string hand-typed array no reviewer can meaningfully diff, and regenerating it wholesale LAUNDERS any genuine new diagnostic present in the same commit — round-3 R4's banked-headroom failure restored at the moment of remediation. Also: PINNED_BASELINES is hand-typed against CLAUDE.md's no-hand-derived-completeness rule, and resolveProjectAndDiagnostics:170-178 silently skips any diagnostic without a .file, so a project-level diagnostic is invisible by construction. Defense credited: fails LOUD in the safe direction, and the identity scheme IS the right answer to the offset attack (see finding 9). cross-domain filed the same shape LOW today; MED here on the measured 89.4% and the laundering coupling. Exposure: 89.4% of the two excepted hooks' lines, basis: measured.
4. [ISSUE][MED][demonstrated] The eslint ban-ts-comment ban is a NO-OP for a described @ts-expect-error, and its error message on @ts-ignore recommends exactly that bypass. eslint.config.mjs:85 is "error" with no options, so the plugin's defaults apply — verified directly: {"minimumDescriptionLength":3,"ts-check":false,"ts-expect-error":"allow-with-description","ts-ignore":true,"ts-nocheck":true}. Measured all three spellings above a real dropped-argument bug in the real hook: a bare @ts-ignore gives rc=1 with the message "Use \"@ts-expect-error\" instead of \"@ts-ignore\"..."; @ts-expect-error with a 2-character description gives rc=1 (too short); @ts-expect-error with a real description gives eslint rc=0, build rc=0, qa:hook-typecheck-coverage PASS rc=0 "0 diagnostic(s), fully covered". So the rule's own unlock names the allowed bypass (PRINCIPLES rule 2 inverted). The config comment's claim at :79-84 — "neither pragma may appear anywhere under hooks/, full stop" — is false as configured, and the round-4 commit credits eslint as the durable closure. Defense credited: the committed regex test hook-typecheck-coverage-check.test.ts:18-23 DOES catch all three spellings and I confirmed it firing, so the vector is closed — by the test, not by the layer both the commit message and the config comment credit; and that test's own failure message misattributes the ban to eslint.config.mjs. One layer of the claimed two exists; the fix is one line plus a pin on the resolved options, since the behaviour depends on a vendor default that can move in a typescript-eslint minor. Exposure: 100% of @ts-expect-error uses with a 3-character-or-longer description; 0 today, basis: measured.
5. [ISSUE][LOW][demonstrated] A new production hook added with a .js extension escapes all three extension-keyed layers at once: listProductionHooks filters on .mjs (hook-typecheck-coverage-check.ts:133-138), the eslint block is files:["hooks/**/*.mjs"], and the #367 pragma regex test iterates listProductionHooks. package.json is "type":"module", so a .js hook is ESM and runs unchanged. Drill N5 (a new hooks/*.js carrying a @ts-nocheck plus a dropped-argument call, referencing no Node global): npx eslint src hooks rc=0, npm run build rc=0, qa:hook-typecheck-coverage PASS rc=0 still reporting "3 production hook(s) under hooks/", the #367 test 9/9 pass, and qa:kernel-purity / qa:completeness-claims / qa:gate-command-path / qa:gate-manifest all rc=0. A first attempt referencing process WAS caught incidentally by no-undef (Node globals are declared only in the .mjs block), so the escape needs a hook touching no Node global. Credited: a new .mjs hook fails loud in three places (the exact-3-name deepEqual pin, the hardcoded tsconfig.hooks-coverage.json include list, and the "no tsconfig project covers it at all" branch) — the extension is the only hole, and it is a convention slip, not an attack. Round 3 noted this as an unfiled hypothetical; now demonstrated. Exposure: 0 of 3 production hooks today (0 .js files under hooks/), latent on the first one, basis: measured.
6. [CLEAN][demonstrated] Round-3 R1 / drill N7b CLOSED TWICE OVER, and this is the praised decision: re-planting the identical N7b payload (a new src/policy/kernel/ file whose path regex ending in an escaped slash blinds the rest of the line, hiding a live process.env read) now gives qa:kernel-purity FAIL rc=1 — "[forbidden-global] forbidden global/pattern \"process\" found (AST: property access \".env\" on forbidden global \"process\")" — where round 3 gave PASS rc=0 on 5 files. process was added to FORBIDDEN_ROOTS at the parse-based AST layer (kernel-purity-check.ts:304-315), immune to the stripComments regex residual by construction, AND the differential's kernel lane is now listFilesRecursive-generated so all three of its assertions saw the new 5th file. Root-cause fix at the right layer, not a wider net at the same layer.
7. [CLEAN][demonstrated] Round-3 R2 / drill N8 CLOSED: the one-line ts.getTrailingCommentRanges call is in (kernel-purity-check.ts:269), and re-planting the benign trailing comment on a gate file that broke TWO guards in round 3 now gives 66/66 pass 0 fail 0 skipped, against round 3's 64/62/2. The 22.8%-of-repo false-positive class is gone, the 14 shapes are pinned individually as a table (:148-), and stripDisagreementMessage (:101-104) now names which side lost characters — the carried half of round-2 R4, discharged.
8. [CLEAN][demonstrated] The new trailing-range call does NOT make the oracle over-strip, which is what keeps the full-corpus detector mathematically valid (that test flags only the shorter-than-oracle direction, so an over-stripping oracle could MASK a real stripComments loss). Re-derived the oracle's ranges exactly as shipped (leading+trailing, getChildren walk, TSX script kind) and asserted every removed range's text opens a comment: files scanned 194, comment ranges removed 8240, ranges removed that are NOT comments 0. Round-3 K8's soundness property (unsound by omission only, never by over-reach) survives the fix.
9. [CLEAN][demonstrated] Round-3 R4 / drill C2 (the offset attack on the ratchet) CLOSED, and proven WITHOUT a line shift so it cannot pass for the wrong reason: an in-place inline JSDoc annotation killing one TS7006 at line 135 plus a dropped required argument at line 341 left the total at EXACTLY 30 — which a raw count-greater-than check passes and a strict-equality count check also passes — and qa:hook-typecheck-coverage still FAILED rc=1, naming "2345:182 (new, x1)". The multiset-of-identities design (duplicates preserved deliberately rather than a Set) is the right fix for a stated, checkable reason.
10. [CLEAN][demonstrated] Issue #366's path-suffix match CLOSED: planting a path-EQUIVALENT but not string-identical specifier at the real call site (the sanitize import respelled with an interior /../ segment) now fails AC-7/AC-7c with "no path-suffix lookalike. Got: sanitizeMod.sanitizeForTerminal". Exact-specifier equality fires; the structurally decoupled raw-text regex assertion app-security's HIGH-1 named was removed rather than patched, which is the right call. #366 is closeable, independently concurring with app-security-reviewer's own finding today.
11. [CLEAN][demonstrated] Round-2 drill N2 re-confirmed CLOSED on the merged code: a node:fs import plus a string constant whose value contains a comment-opener sequence plus a live readFileSync, planted in src/policy/kernel/kernel.ts, gives qa:kernel-purity FAIL rc=1 naming the non-relative import, plus 2 test failures (the real-import-count pin and the real-kernel-code purity pin).
12. [CLEAN][demonstrated] Round-2 drill N4 re-confirmed CLOSED at the REAL call site (not just the synthetic fixture): the env-gated object-literal port keyed sanitizeForTerminal planted in hooks/pretooluse-kernel-gate.mjs fails AC-7/AC-7c with "no port-object masquerade ... Got: sanitizePort.sanitizeForTerminal".
13. [CLEAN][demonstrated] Round-3 R5's named proof-test is committed AND bites: kernel-purity-check.test.ts:126-140 widens the lossy check from the 8 enforced-lane files to every .ts/.mjs/.js under src/ and hooks/ (at least 150 asserted), it passes at baseline — so the 2 files round 3 measured as lossy are genuinely fixed — and it is mutation-sensitive: planting a path-matching regex literal in a gate file fails BOTH differentials, 60/58/2. A green test that cannot fail proves nothing; this one fails.
14. [CLEAN][code-traced] The normalizer lane cannot drift from its control: enforcedLaneSources imports REGISTRY_PATH from normalizer-registry-purity-check.ts:71 rather than re-typing it, and checkNormalizerRegistryPurity defaults to the same constant (:80). Better than the fix I specified in round 3. The 8 other production .ts files under src/policy/normalizer/ are outside the control's own scope so there is no differential gap, and the full-corpus lossy test covers them regardless.
15. [CLEAN][demonstrated] Round-3 R6 (untracked-file sensitivity breaking npm test) is no longer reproducible and I am WITHDRAWING it rather than restating it: an innocuous untracked src/policy/kernel/ file now gives pre-commit-scan.test.ts 26/26 pass 0 fail (round 3: 26/25/1), and the closing full-suite run was 1532/1532 with two untracked sibling reports sitting in docs/reviews/.
16. [CLEAN][code-traced] ADR compliance on this attack surface, including the delta's ONE deletion: SE ADR-0021 POL-11/POL-12 enforcement strictly strengthened (process moved to the parse-based layer, lane enumeration generated, nothing relaxed); SE ADR-0005/ADR-0010's "MUST NOT delete or weaken a failing test" NOT violated by removing the raw-text import-specifier assert.match from sanitize.test.ts — that assertion was demonstrated unsound (satisfiable by a dead-code decoy), the named test still exists and runs, and the replacement is strictly stronger on the same property, proven by finding 10 firing on the exact shape the old pair let through; SE ADR-0010's inline-suppress MUST is the clause findings 2 and 4 land against (the eslint default enforces only the "comment justifying it" half, and a JSDoc any-cast satisfies neither half while being undetected); THOTH-ADR-0001/0002 untouched, ADR-0001's fresh-dated-review-report clause discharged by this report plus the two sibling reports dated today.
17. [CLEAN][demonstrated] CI wiring of the delta is live, not nominal: ci.yml:196-203 runs Typecheck (npm run typecheck), Lint (npm run lint = eslint ., broader than the eslint src hooks I used locally, so the new ban-ts-comment block genuinely runs in CI — confirmed firing in finding 4) and Test (npm test), and ci.yml:254-255 runs QA-18 as node src/qa/hook-typecheck-coverage-check.ts. All four gates were exercised by the drills above and every one of them responded.
counts (CHECKSUM): issues=5 suspicions=0 clean=12
evidence (CHECKSUM): demonstrated=15 code-traced=2 derived=0
checks=Baseline at dfc574b (merged code, identical to master): npm run build rc=0; npm run lint (eslint .) rc=0; node --test tests 1532 / suites 0 / pass 1532 / fail 0 / cancelled 0 / skipped 0 / todo 0; all 7 QA instruments PASS rc=0 (kernel-purity 4 files, normalizer-registry-purity, gate-manifest, gate-matcher-drift, gate-command-path, completeness-claims, hook-typecheck-coverage with pinned 30/22 equal to measured 30/22). Closing re-run after every revert: identical — build rc=0, lint rc=0, all 7 instruments rc=0, node --test 1532/1532 pass/0 fail/0 skipped. Flake disclosed rather than hidden: the FIRST baseline node --test had 2 failures, gate-latency-budget-check (p95 2016.30ms vs a 2000ms ceiling, three reviewers running concurrently) and pre-commit-scan R4 (Windows EBUSY rmdir on a temp clone); both passed on an unloaded re-run, neither is in the delta. 11 mutation drills planted in the real tree and reverted (round-2 N2 and N4; round-3 N7b, N8 and C2-no-line-shift; #366 respelling; N1a function-parameter shadow; N1b object-binding-pattern shadow; N2 JSDoc any-cast; N3 cosmetic blank line; N4 three pragma spellings; N5 .js hook; plus an E1 mutation-sensitivity probe of the new full-corpus differential). 2 purpose-built instruments (a 194-file oracle over-strip auditor over 8240 comment ranges; a ban-ts-comment resolved-default-options reader). 1 real-spawned-hook sandbox probe across 2 env cases, run twice (once per scope-shadow route). Tree clean of my own artifacts at close: git status shows only docs/REVIEW_LOG.md (modified by this session's sibling reviewers) and their 2 untracked reports; 0 .bak files; HEAD unmoved at dfc574b.
adr=HIT(37)
report=docs/reviews/s312-fixnow-360-363-red-team-round4-postmerge-2026-09-29.md
```
