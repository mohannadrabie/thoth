# Red team: #308 story H, gate-side unlock wording (X-11)

- Reviewer: red-team (Sutekh)
- Tier: CRITICAL (ratified; not re-litigated)
- Reviewed range: `b2b7de1^..a3d9d68` (b2b7de1 feat, e458bac pin edits, a3d9d68 docs)
- **Reviewed commit: a3d9d68**
- Date: 2026-10-02
- Execution: detached worktree at a3d9d68 (scratchpad `wt-h-rt`, `npm ci --ignore-scripts`, ADR submodule initialised for QA-14), removed after the run. Main tree untouched except this report and the REVIEW_LOG row.
- ADR cache: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`. Rules read: SE ADR-0021 (gate surfaces, fail-closed, kernel purity), THOTH-ADR-0001 (fixture loader MUST throw on malformed input; no env-selected fixture), SE ADR-0005 / ADR-0010 (no test edited to go green; recorded acts), ADR-0016.

## Scope of the change

- `src/policy/gate/unlock-text.ts` (new): closed tables. `hookFailureUnlock(name)` returns the catalog line only for the exact string `ClassificationCatalogError`, else `GENERIC_UNLOCK`; `policyLoadUnlock(layer)` / `boundedLayerName` / `boundedReasonKind` use own-property / `includes` lookups and print `unknown` outside the set.
- `src/policy/tools/classification-catalog.ts:72-83,123,135-141`: typed `ClassificationCatalogError` thrown at the source (lowering check, and a try/catch around built-in layer load and fixture load), message kept, `cause` attached.
- `hooks/pretooluse-kernel-gate.mjs:91-93,127,173`: `unlockFor` set after modules load; `failClosed` prints `unlockFor?.(name) ?? UNLOCK`, still inside `try { ... } finally { process.exit(2) }`.
- `src/policy/gate/decide-tool-call.ts:24-26,88-93`: re-export of `hookFailureUnlock`; policy-load refusal text bounded and carries a layer unlock.

## Attacks (ranked by exposure x irreversibility x silence)

### A1. Hostile input selects the unlock text, injects text, or flips deny to allow. SURVIVES (demonstrated)
Assumption: only the catalog code path can make stderr say "fix the tool classification file", and no input text is reflected into the new clauses.
Scenario: a prompt-injected model emits `tool_name` / `tool_input` carrying `ClassificationCatalogError`, a newline and a fake `Unlock:` line; a JSON payload with a `__proto__` key naming the error; `Object.prototype` polluted with a layer key; a non-string `String` object for layer/kind.
Defense assessed: stderr text is `fixed what + table string + name filtered by /^[A-Za-z]{1,40}$/` (hook:118-127). The table lookups use `Object.prototype.hasOwnProperty.call` (unlock-text.ts:35-37) and `typeof === "string"` guards (unlock-text.ts:31-33, 50-52). The policy-load refusal reflects only bounded layer and kind (decide-tool-call.ts:90-93). Layer and kind come from the loader's closed enums, chosen by code, not by any registry/policy content.
Evidence: proof tests RT-H-6 (5 hostile payloads: none prints `Error type: ClassificationCatalogError`, every run exits 0 or 2, the unroutable name stays a deny) and RT-H-9 (`__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf`, a polluted `Object.prototype` key, `new String(...)`, ` project`, `Project`: all generic / `unknown`). Both pass. Also the story's own H4/H4b.

### A2. Fail-closed (exit 2) on every catalog failure shape. SURVIVES (demonstrated)
Scenario: the fixture is missing, is a directory (unreadable), is valid JSON but schema-invalid, is malformed (H1b), has a lowering entry (H1); the built-in inventory is corrupt or missing; a non-Error is thrown.
Defense assessed: all built-in and fixture load failures are wrapped (classification-catalog.ts:135-141); the lowering check throws the typed error directly (:123). Any throw lands in the hook's catch, and `failClosed` exits 2 in a `finally` regardless of what `unlockFor` does. A non-Error throw goes through `String(err)`; if `String` itself threw (a hostile `toString`), the resulting TypeError still reaches `failClosed` (generic line, exit 2). The loader functions are repo code that throw only `Error`, so that branch is not reachable from input (code-traced: builtin-tool-inventory.ts:56,137; central-classification.ts:84-114).
Evidence: RT-H-1 (ENOENT), RT-H-2 (EISDIR), RT-H-3 (schema-invalid), RT-H-4 (corrupt inventory), RT-H-5 (missing inventory) each assert exit 2, empty stdout, byte-exact catalog line, sandbox root absent from stderr. 5/5 pass.

### A3. The built-in-layer half of the typed wrap is unpinned by the story's tests. BREAKS (LOW, demonstrated)
Scenario: a later refactor hoists `loadBuiltinToolClassificationLayer()` out of the try (a natural "only the fixture is untrusted" edit). A corrupt or missing `docs/qa/tool-inventory.json` (for example a bad re-vendor merge, story C's area) then prints the generic "retry the call ... needs Node 22.18" line instead of the classification-file unlock. This is the X-11 misdirection the story exists to remove, and it returns with no red test.
Defense assessed: the story's tests drive only the fixture shapes (H1 lowering, H1b malformed, H3 malformed). Plan line 136 states the built-in case also gets the catalog line, but no test checks it.
Evidence (mutation applied in the worktree, then reverted):

    mutant M1: classification-catalog.ts, `const builtinLayer = loadBuiltinToolClassificationLayer();` moved above the try
    node --test src/policy/gate/unlock-text.test.ts hooks/pretooluse-kernel-gate-unlock.test.ts
      src/policy/gate/render-hook-output.test.ts src/policy/tools/*.test.ts hooks/pretooluse-kernel-gate*.test.ts
      -> story-tests-exit=0; tests 142, pass 142, fail 0, skipped 0   (mutant SURVIVES)
    node --test <worktree>/hooks/(red-team scratch proof test, not committed)
      -> pass 8, fail 2: RT-H-4 corrupted built-in inventory; RT-H-5 missing built-in inventory   (mutant KILLED)

Fail-closed is not affected (exit 2 either way): the damage is wording only, so severity is LOW.
Exposure: 100% of built-in-inventory load failures would get the wrong unlock under the mutant; basis: counted in code (one call site, classification-catalog.ts:136). Current shipped behavior is correct.
Named proof-test: `H1e-builtin-inventory-failure-prints-classification-file-unlock` (= RT-H-4 + RT-H-5 below), to go into `hooks/pretooluse-kernel-gate-unlock.test.ts`. Today it is green on a3d9d68 and red on M1.

### A4. A transient fixture read error is told "retrying will not help". UNPROVEN (LOW, code-traced)
Scenario: on Windows, a transient `readFileSync` failure on the fixture (EBUSY/EPERM while an editor or scanner holds the file, EMFILE under fd pressure) is wrapped as `ClassificationCatalogError` (classification-catalog.ts:136-140). The operator is told a human must fix the file through a PR and that retrying will not help, which is false for a transient fault. Fail-closed still holds (exit 2). The plan discloses the analogous policy-layer `read-error` case (plan line 138) and the built-in case (line 136), but not a transient fixture read.
Exposure: unknown; basis: assumption. It caps at LOW, and the only recommendation is to measure it.
Settling action: count non-ENOENT read errors on the fixture in a session's real lifetime (story J scratch session); the owner is the Manager's team at the live measurements step. No executable failing test: the shipped wording is the deliberate ruling (decisions row "#308 remainder: story breakdown", item 1). Residual-register line suggested.

### A5. A different error named ClassificationCatalogError misleads the operator. SURVIVES (code-traced)
Assumption: only the catalog throws that name in the hook process.
Evidence: a `git grep` at a3d9d68 over `src/policy` and `hooks` (non-test) for non-`Error` throws and for `.name =` assignments finds the name assignment only at classification-catalog.ts:81 and the typed throws only at :123/:140. The other rethrow (central-source.ts:347) rethrows a child-process error (`Error`). `JSON.parse` cannot produce a prototype-bearing object (RT-H-6 payload with `__proto__`). Spoofing needs repo write access, and an attacker with that already owns the gate. The worst case is that the operator gets the catalog wording, with exit 2 intact. The app-security report carries the same point as a LOW residual. Not duplicated.

### A6. Cause chaining leaks the path, stack or parser text to a model-visible channel. SURVIVES (demonstrated)
Defense: the gate hook prints the filtered name only (hook:118-127). It never prints `.message`, `.stack` or `.cause`. SessionStart (`hooks/sessionstart-tool-enum.mjs:666,674`) prints `.message` (same text as before) and `.stack`. A V8 `.stack` string does not include `cause`, so the cause adds nothing. Side effect, not a leak: SessionStart's stderr stack now starts `ClassificationCatalogError: ...` at the wrap site, so the inner frame (which line of central-classification.ts threw) is no longer in that stack. The message is unchanged. Diagnostic depth only.
Evidence: story H3 (canary, sandbox root, fixture path, stack-frame marker, `SyntaxError`, class names absent) and RT-H-1..5 (stderr does not include the sandbox root) pass. RT-H-10 shows `stack` line 1 = `ClassificationCatalogError: ENOENT...`, the cause is an `Error`, and there is no `central-classification.ts` frame in the wrapper stack.

### A7. Regression in fail-open probe rows, latency budget, or locked pins. SURVIVES (demonstrated)
- Fail-open probe: `node --test src/qa/gate-fail-open-probe.test.ts`: tests 14, pass 14, fail 0, skipped 0.
- Latency: `npm run qa:gate-latency-budget`: PASS, `iterations=100 min=206.18ms p50=283.67ms p95=390.31ms p99=412.70ms max=412.70ms ceiling=2000ms`. In the full-suite run, `REAL_SHELL_FORM_TIMER` failed once with p99 2049.86 ms over 5 iterations, while the suite, the probe and the latency check all ran concurrently on the same machine. Re-run in isolation: `node --test src/qa/gate-latency-budget-check.test.ts`: tests 43, pass 43, fail 0, skipped 0. The change adds one pure 53-line module to an import set that is already loaded, so this is contention, not regression.
- Pins: `git diff b2b7de1^..a3d9d68 -- '*.test.ts'`, counting removed lines, gives `0` (no test line removed anywhere). Locked files edited: `hook-import-pins.test.ts` +1 pair `gate.hookFailureUnlock` (the one allowed pair, decisions row "stories C and H" item 2), `gate-structure.test.ts` +2 `STORY_TEST_FILES`, and `render-hook-output.test.ts` +47 appended cases. AC-3 (`sanitize.test.ts`), R1-6c (`classification-builtin-override.test.ts`) and `catalog-single-source.test.ts` are unedited in the range. The hook's new line `unlockFor = gate.hookFailureUnlock` is a module-local binding, not a member write (AC-3h allow-list stays empty; full suite green on those files).
- Full suite in worktree: `npm test`: tests 1840, pass 1838, fail 2, skipped 0. Both failures were environmental and re-ran green in isolation: the latency one above, and QA-14 dogfood `reference-resolver.test.ts`, which failed only because the worktree's `adr/` submodule was empty (`adr-entries=0`). After `git submodule update --init adr`: tests 85, pass 85, fail 0, skipped 0.
- `npm run typecheck`: rc=0. eslint on changed sources: 0 errors.

## Proof tests (scratch proof-test file in the red-team worktree, not committed; copy kept in the session scratchpad)

Run on a3d9d68: tests 10, pass 10, fail 0, skipped 0. Under mutant M1: pass 8, fail 2 (RT-H-4, RT-H-5).
- RT-H-1 missing fixture (ENOENT) gives the catalog line, exit 2
- RT-H-2 fixture replaced by a directory (EISDIR) gives the catalog line, exit 2
- RT-H-3 schema-invalid fixture (`version: ""`) gives the catalog line, exit 2
- RT-H-4 corrupt `docs/qa/tool-inventory.json` gives the catalog line, exit 2 **(adopt as H1e)**
- RT-H-5 missing `docs/qa/tool-inventory.json` gives the catalog line, exit 2 **(adopt as H1e)**
- RT-H-6 hostile `tool_name`/`tool_input`/`__proto__` payloads never print `Error type: ClassificationCatalogError` and exit only 0 or 2
- RT-H-7 project policy path is a directory: deny, `layer project, kind read-error`, project unlock
- RT-H-8 malformed shipped-defaults: deny, `layer shipped-defaults, kind json-parse-error`, shipped-defaults unlock
- RT-H-9 prototype keys, polluted prototype, boxed strings and near-miss casing all print generic / `unknown`
- RT-H-10 `assembleCatalog` on a missing path throws `ClassificationCatalogError` with message and `cause` kept; stack line 1 names the new type

The assertion all of RT-H-1..5 share (sandbox from `hooks/test-support/gate-sandbox.ts`): exit code 2, empty stdout, stderr byte-equal to
`pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2). Unlock: a human must fix the tool classification file through a reviewed pull request; retrying will not help. Error type: ClassificationCatalogError` plus a newline, and stderr does not contain the sandbox root. RT-H-4 writes `{ not json` to the sandbox's `docs/qa/tool-inventory.json`; RT-H-5 deletes it; both then call `sb.mcp(firstCommittedEntryName(), "x")`.

## Scariest unproven assumption
That a catalog failure is always a content defect. Every read error on the fixture, transient ones included, is reported with "retrying will not help" (A4). It fails closed either way, so this costs operator time, not safety.

## Verdict
**go.** No BREAKS above LOW. Fail-closed holds on every catalog shape tried. No input reaches the unlock text or the error name. Pins are additions only, plus the one allowed pair.
Next action: add RT-H-4/RT-H-5 as `H1e-builtin-inventory-failure-prints-classification-file-unlock` to `hooks/pretooluse-kernel-gate-unlock.test.ts` (fix-now or Backlog, at the Manager's call). It closes the one surviving mutant.

Open findings = failing tests: 1 open BREAKS (A3), mapped to H1e (red on mutant M1). A4 has no executable form (it is a wording ruling plus a field measurement) and goes to the residual register.

## Editorial (verdict-neutral)
1. `src/policy/gate/unlock-text.ts:15-16` says the name is the one "the hook's `loadCatalog` port throws ... The original message and cause are dropped". Under design B the catalog module throws it, and message and cause are KEPT (classification-catalog.ts:140). That is a misleading safety claim in a sensitive file. Fix the comment.
2. `src/policy/gate/unlock-text.ts:3-4` says the hook reads the table "through render-hook-output.ts". It reads it through the `decide-tool-call.ts` re-export (decide-tool-call.ts:25).
3. `docs/decisions.md` row "#308 remainder: AP-3 form, Phase 1 answers" item (3) still names the pairs `render.CATALOG_FAILURE_ERROR_NAME` and `render.hookFailureUnlock`. The shipped pair is `gate.hookFailureUnlock`, under row "stories C and H" item (2). The cross-domain report noted the same.

RECEIPT: verdict=go
attacks:
1. [ISSUE][LOW][demonstrated] Built-in-inventory half of the typed wrap is unpinned: mutant M1 (built-in load hoisted out of the try) survives the story's tests 142/0/0 and reverts a corrupt or missing inventory to the generic retry/Node line; killed by RT-H-4/5. Proposed test: H1e
2. [SUSPICION][LOW][code-traced] A transient fixture read error (EBUSY/EPERM/EMFILE) is wrapped as a catalog failure and told "retrying will not help" (classification-catalog.ts:136-140); still exit 2; exposure assumption: measure it
3. [CLEAN][demonstrated] Hostile tool_name/tool_input/__proto__/prototype pollution/out-of-set layer or kind cannot select unlock text, inject text, or flip a deny (RT-H-6, RT-H-9, H4/H4b)
4. [CLEAN][demonstrated] Exit 2 with byte-exact catalog line on ENOENT, EISDIR, schema-invalid, malformed, lowering, corrupt and missing built-in inventory (RT-H-1..5, H1/H1b); failClosed exits in a finally
5. [CLEAN][demonstrated] Cause chaining leaks nothing model-visible: gate prints the filtered name only; .stack excludes cause; H3 + RT-H-1..5 + RT-H-10
6. [CLEAN][demonstrated] No regression: fail-open probe 14/0/0, latency p99 412.70ms < 2000ms, test diff has 0 removed lines, only the allowed pin pair added
7. [CLEAN][code-traced] Name spoofing: only classification-catalog.ts:81/123/140 produce the name; JSON input cannot; a spoof changes wording only, exit 2 holds
counts: issues=1 suspicions=1 clean=5
evidence: demonstrated=5 code-traced=2 derived=0
checks=full suite 1838 pass/2 fail/0 skip (both environmental; isolated re-runs latency 43/0/0, reference-resolver 85/0/0); proof tests 10/0/0; mutant M1 story tests 142/0/0 (survived), proof 8/2/0 (killed); fail-open probe 14/0/0; qa:gate-latency-budget PASS; typecheck rc=0; eslint 0 errors
adr=HIT(37)
report=docs/reviews/s308-H-unlock-red-team-2026-10-02.md
