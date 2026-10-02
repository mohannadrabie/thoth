# #308 remainder, Story H (X-11): gate-side unlock wording. Phase 1 plan

- Date: 2026-10-02. Branch: `s308/activation` (no switch, no commit in this phase).
- Source: `docs/plans/s308-activation-phase0-2026-10-02.md` story H and section 5a; Manager ruling Q3 = Option 2 (`docs/decisions.md`, 2026-10-02 row "#308 remainder", item 1).
- Phase 0 / ADR check: ran `node docs/adr-cache.mjs --ensure` (HIT, 37 ADRs). See ADR table below.

## 1. Story and tier

- Story: a gate failure names its real unlock, by failure kind, from a closed table; no free text, path or stack reaches the model.
- Tier proposed: **CRITICAL.** Edits `hooks/pretooluse-kernel-gate.mjs` and `src/policy/gate/*` (policy enforcement / session gate, CLAUDE.md sensitive area).
- Reviewers: red-team, app-security-reviewer, cross-domain-reviewer (standing). Fresh dated report in `docs/reviews/` required before ship.
- Phase 0 listed H as "Session gate: app-security + cross-domain"; the Manager's CRITICAL expectation adds red-team. Manager ratifies.
- `test-writer`: not dispatched. No new UI flow or API surface; the change is wording on an existing fail-closed channel. The tests below are written by the implementer, failing first.

## 2. ADR review

| ADR | Verdict | Rule honored |
|---|---|---|
| SE ADR-0005 (testing strategy) | APPLICABLE | A test is never edited or deleted to turn it green; any pin change is a recorded act (decisions row) |
| SE ADR-0010 (code quality) | APPLICABLE | "MUST NOT ... delete tests"; one closed table, no duplicated string beyond the one the hook must hold |
| THOTH-ADR-0001 (central classification fixture) | NOT-APPLICABLE | Fixture entries are not edited; only the hook's reading of a failure changes |
| Other 34 ADRs | NOT-APPLICABLE | No infra, schema, secret-scan or API surface touched |

- PRINCIPLES rule 2 (a block names its unlock) is the governing rule; it is the reason for the story.
- No UNCLEAR ADR.

## 3. Facts found by instrument (grep, not memory)

- `UNLOCK` literal: defined once, `hooks/pretooluse-kernel-gate.mjs:87`, used once in `failClosed` (line 121).
- Refusal text: built once, `src/policy/gate/decide-tool-call.ts:86` (`policy load failed: layer <L>, kind <K>; fail-closed`). No test asserts the full string.
- `renderHookOutput` (`src/policy/gate/render-hook-output.ts`) passes every refusal `reason` through the injected `sanitize` (one site, `sanitizedDenyJson`). The new clause rides that path unchanged.
- Closed enums already exist: `FailedLayerName = "central" | "shipped-defaults" | "project"`, `LoadFailureReasonKind` (`src/policy/config/loader.ts:66,72`). The gate types both as `string` (`decide-tool-call.ts:33-34`), so the table must treat any other value as unknown.
- Catalog failure path: `ports.loadCatalog()` in the hook calls `assembleCatalog(...)`. It throws on a lowering entry and also on a malformed fixture (`classification-catalog.ts:110-125`). Both reach `catch -> failClosed("internal exception", err)`. The throw message is discarded by design.
- `UNLOCK` text outside the gate hook (`userpromptsubmit-halt-relay`, `history-scan`, `printer`, `rule-reachability`) is a different channel; not touched.

## 4. Design

### 4.1 Where the closed map lives

- New file `src/policy/gate/unlock-text.ts`: pure, no imports, no `node:*`, no `config/` (G15 holds; `gate-structure.test.ts` scans `src/policy/gate/*` dynamically, so the new file is covered by G11/G15/G18 with no list edit).
- Exports:
  - `GENERIC_UNLOCK` (the current line, unchanged).
  - `CATALOG_FAILURE_ERROR_NAME = "ClassificationCatalogError"` (26 letters; passes `/^[A-Za-z]{1,40}$/`).
  - `hookFailureUnlock(errorName: unknown): string` (closed table keyed by error name; unknown, non-string or missing returns `GENERIC_UNLOCK`).
  - `policyLoadUnlock(failedLayer: unknown): string` (closed table keyed by layer; anything else returns `GENERIC_UNLOCK`).
- Consumers:
  - `decide-tool-call.ts` imports `policyLoadUnlock` (relative import inside the gate; no new hook import).
  - `render-hook-output.ts` re-exports `CATALOG_FAILURE_ERROR_NAME` and `hookFailureUnlock`, so the hook reads them through the namespace it already imports.
- Why TS gate side, not the `.mjs`:
  - The hook is the one file that must work when module loading fails, so it should stay small; each line added there widens the AC-3 / AC-3j / typecheck surface.
  - The table is pure data plus two total functions: unit-testable without spawning a process, and covered by the `qa:gate-*` and purity scans.
  - The hook keeps only (a) its own literal `UNLOCK` as the load-failure fallback, (b) a wrapper in the `loadCatalog` port, (c) one lookup in `failClosed`.
- Why a new file rather than growing `render-hook-output.ts`: two consumers (decide and render) need the table; one module avoids two tables that can drift.

### 4.2 Hook change (small)

- `loadCatalog` port: wrap `assembleCatalog(...)` in try/catch; on any throw, throw a fresh `Error` with no message and `name = render.CATALOG_FAILURE_ERROR_NAME`. The original message and cause are dropped (they carry a path and the entry name).
- `failClosed`: module-level `let unlockFor = undefined`, set after the imports resolve to `render.hookFailureUnlock`. `failClosed` uses `unlockFor?.(name) ?? UNLOCK`, inside the existing try/finally, so the exit 2 is unaffected and a module-load failure still prints the literal `UNLOCK`.
- `UNLOCK` literal stays byte-identical to `GENERIC_UNLOCK`; a test asserts the equality by reading both (the duplicate exists because the hook must print it with no module loaded).
- New namespace.member pairs: `render.CATALOG_FAILURE_ERROR_NAME`, `render.hookFailureUnlock`. No new import, so the namespace map (6 `Promise.all` imports plus stdin) is unchanged.

### 4.3 Final strings

| Kind | Channel | Final text |
|---|---|---|
| Catalog / fixture failure (name `ClassificationCatalogError`) | stderr, exit 2 | `Unlock: a human must fix the tool classification file through a reviewed pull request; retrying will not help.` |
| Generic / unknown (unchanged) | stderr, exit 2 | `Unlock: retry the call; if it fails again a human must repair the gate hook (it needs Node 22.18 or newer and an intact checkout).` |
| Policy load failure, layer `project` | deny JSON reason | `policy load failed: layer project, kind <K>; fail-closed. Unlock: a human must correct the project policy file through a reviewed change; retrying will not help.` |
| Policy load failure, layer `shipped-defaults` | deny JSON reason | `policy load failed: layer shipped-defaults, kind <K>; fail-closed. Unlock: a human must correct the shipped-defaults policy file through a reviewed change; retrying will not help.` |
| Policy load failure, layer `central` | deny JSON reason | `policy load failed: layer central, kind <K>; fail-closed. Unlock: the central policy owner must correct the central policy outside this session; retrying will not help.` |
| Policy load failure, layer not in the closed set | deny JSON reason | `policy load failed: layer unknown, kind <K>; fail-closed. ` + generic unlock line |

- stderr full shape for the catalog case: `pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2). <catalog unlock> Error type: ClassificationCatalogError`.
- All strings are ASCII, fixed, contain no class name (`read-only`, `workspace-mutating`, `remote-mutating`), no path, no entry name. Passes `sanitizeForTerminal` unchanged (asserted).
- Kind-bounding (decision for Manager, Q2): `<K>` and the layer are today reflected as raw strings typed `string`. Plan bounds both: a value outside its closed set prints as `unknown`. Real loader output never leaves the set, so no existing behavior changes.

## 5. Acceptance criteria and failing-first tests

All tests are written first, run red for the stated reason, then the code lands. Test files are new unless marked.

| # | Criterion | Named test | File | Red because |
|---|---|---|---|---|
| H1 | A lowering fixture entry on an MCP call prints the catalog unlock on stderr, exit 2, stdout empty | `H1-lowering-entry-prints-classification-file-unlock` | `hooks/pretooluse-kernel-gate-unlock.test.ts` (uses `plantEntry`-style setup from `GateSandbox.setEntries`) | stderr still carries the generic line |
| H1b | A malformed fixture (not only lowering) prints the same line | `H1b-malformed-fixture-prints-classification-file-unlock` | same | same |
| H1c | The catalog line never says "retry the call" or "Node" | `H1c-catalog-unlock-does-not-misdirect` | same | generic line says both |
| H1d | Bash call with the same lowering fixture is unaffected (verdict, no catalog load) | `H1d-bash-unaffected-by-catalog-failure` | same | passes before and after; control row |
| H2 | Project schema-invalid policy file: deny JSON reason carries the project unlock | `H2-project-schema-invalid-deny-names-project-unlock` | same (uses `writeProjectPolicy`) | reason has no unlock clause |
| H2b | Table: every `failedLayer` (3) x `reasonKind` (3) yields the layer's exact unlock string, for Bash and MCP | `H2b-refusal-unlock-per-layer-and-kind` | `src/policy/gate/render-hook-output.test.ts` (new test in existing file; G1 stays untouched) | reason has no unlock clause |
| H2c | Central layer text names the central policy owner and "outside this session"; not "reviewed change" | `H2c-central-unlock-is-out-of-session` | `src/policy/gate/unlock-text.test.ts` | module absent |
| H3 | No path, no `\n   at `, no raw loader message, no class name in either channel | `H3-no-path-stack-or-parser-text-in-unlock-paths` | `hooks/pretooluse-kernel-gate-unlock.test.ts` with canary path in fixture and policy file | n/a (guard); must stay green. Existing G22 and `pretooluse-kernel-gate-sanitize.test.ts` also must stay green unmodified |
| H4 | Unknown `failedLayer` (e.g. `"x\u001b[2J"`, `42`, `undefined`) falls back to the generic line; layer and kind print as `unknown` | `H4-unknown-layer-falls-back-to-generic-and-is-bounded` | `unlock-text.test.ts` and `render-hook-output.test.ts` | table absent |
| H4b | Unknown error name (`Error`, `TypeError`, non-string, throwing `name` getter) maps to generic stderr line | `H4b-unknown-error-name-falls-back-to-generic` | `unlock-text.test.ts`; hook-level case via existing A6 payload failure in `-unlock.test.ts` | table absent |
| H5 | `FIXED_LINE` in `pretooluse-kernel-gate-builtin-override.test.ts:72` still matches the catalog line, unmodified | existing test, run unchanged | existing | none expected |
| H6 | Module-load failure (no type stripping, missing `src`) still prints the literal `UNLOCK` | existing A6 (`pretooluse-kernel-gate-launch.test.ts`), run unchanged | existing | none expected |
| H7 | Closedness: both tables are total over their closed sets, and every value is non-empty, letters/punctuation ASCII only, one line | `H7-tables-are-closed-total-and-single-line` | `unlock-text.test.ts`; keys derived from the loader's enum types via a `Record<FailedLayerName, ...>` compile-time exhaustiveness check, not typed by hand | table absent |
| H8 | Hook literal `UNLOCK` equals `GENERIC_UNLOCK` | `H8-hook-generic-unlock-in-sync` | `unlock-text.test.ts` (reads hook source, extracts the literal) | module absent |
| H9 | Sanitizer: every table string is unchanged by `sanitizeForTerminal` and non-empty after it | `H9-unlock-strings-survive-sanitizer-unchanged` | `unlock-text.test.ts` (imports `src/policy/config/sanitize.ts`; test files may) | module absent |
| H10 | Exit codes and stdout polarity unchanged: refusal is still exit 0 with deny JSON; catalog failure still exit 2 with empty stdout | covered inside H1 and H2 | `-unlock.test.ts` | n/a |

- Completeness claim rule (CLAUDE.md): "every layer x kind" is enumerated from the loader's exported types by the test, not by prose here.
- Mutations the reviewers can run: swap two layers' text; return the catalog line for every name; drop the try/catch in `loadCatalog`; let the original message through. Each must redden at least one named test above (implementer runs these before handoff and records the results).

## 6. Existing tests and pins: change or not

| Pin | Affected? | Change | Recorded act? |
|---|---|---|---|
| `FIXED_LINE` regex, `hooks/pretooluse-kernel-gate-builtin-override.test.ts:72` | No: `Unlock: [^\n]*Error type: [A-Za-z]{1,40}` matches the new line | none | n/a (no edit) |
| Leak terms in the same test (entry name, fixture path, sandbox root, class strings) | No: new text contains none | none | n/a |
| `hooks/pretooluse-kernel-gate-launch.test.ts` A6 (`/Unlock: \S/`, no path) | No | none | n/a |
| `hooks/pretooluse-kernel-gate-stderr.test.ts` (G22), `-sanitize.test.ts`, `-reason-cap.test.ts` (7168 byte stdout cap) | No: refusal reason grows by about 130 bytes; refusal reasons are far below the cap. Verify by running | none | n/a |
| `src/policy/gate/decide-tool-call.test.ts` G1 (reason includes layer and kind; no canary) | No: still true | none (new tests added in new file) | n/a |
| `src/policy/config/hook-import-pins.test.ts` `PINNED_PAIRS` (AC-3j-1/3) | **Yes**: add `render.CATALOG_FAILURE_ERROR_NAME`, `render.hookFailureUnlock`. AC-3j-3 re-checks they are real exports and not env readers (they are not) | edit the pinned set | **Yes**: reviewed change recorded in a `docs/decisions.md` row. The pair set is the answer key for what the hook uses; a new pair is a deliberate widening (the same status as the #312 import). Not a weakening: pins stay exact |
| `src/policy/config/sanitize.test.ts` AC-3 (no `process.env` / route to env in the hook) | Expected No: no env read added. Run to confirm | none | n/a |
| AC-3j-4 env-read graph (hook import graph now includes `unlock-text.ts` via `render` and `decide`) | Expected No: the module has no env access; scan must list it as a pure file | none | n/a; if the scan's pinned allow-set needs a line, that is a recorded act |
| Hook typecheck gate (#361), `src/qa/hook-typecheck-coverage-check.ts` and its baseline snapshot | Verify. The hook is `// @ts-check` JS: `unlockFor` must be JSDoc-typed (`@type {((name: string) => string) | undefined}`) and no suppression comment is allowed (the check rejects them) | none if clean | If a baseline entry shifts, that is a hand edit of the snapshot: a recorded act |
| `src/qa/gate-fail-open-probe.ts` rows | No: rows classify by exit code and stdout; stderr is only sliced into the detail text. `empty-stdin`, `invalid-json-stdin` stay "exit 2 with stderr" | none | n/a |
| `src/qa/catalog-single-source.test.ts`, `src/qa/kernel-purity-check.test.ts` (both name `render-hook-output`) | Run to confirm | none expected | n/a |
| `src/policy/gate/gate-structure.test.ts` (G11, G15, G18; `STORY_TEST_FILES` list of test files that must not type a fixture entry name) | New source file is scanned automatically. New test files that plant a lowering entry must read the name at run time like `plantEntry`, and be added to `STORY_TEST_FILES` | add two new test file paths to the list | **Yes**, minor: a list extension in a locked test (adds coverage; record in the same decisions row) |
| `docs/qa/s5-central-classification.json` | Not touched | none | n/a |
| Phase 0 text `docs/plans/s308-activation-phase0-2026-10-02.md` H5 | Says "regex change is a recorded act"; no regex change is planned | none | n/a |

- Instrument for completeness: before build, run `rg -n "Unlock: retry|repair the gate hook|policy load failed:" hooks src` and re-run the `npm test` file set that mentions `pretooluse-kernel-gate`; the diff of test names before and after is the evidence, per the 2026-09-19 precedent.
- No existing test is deleted or weakened. The only locked-test edits are the two additive ones above.

## 7. Verification plan

- Red run: new tests, expected failures listed in section 5, saved as evidence.
- Green run: `npm test` real counts (skipped is not passed), `npm run typecheck`, lint.
- `qa:*` set that touches the gate: `qa:gate-command-path`, `qa:gate-matcher-drift`, `qa:gate-manifest`, `qa:gate-latency-budget`, hook typecheck coverage, kernel purity, `qa:reference-resolver origin/master HEAD` (QA-14 diff mode), QA-15.
- Latency: the added work is one string lookup on a failure path only; the budget check is run, not argued.
- Reviews: red-team, app-security-reviewer, cross-domain-reviewer; reports in `docs/reviews/`.

## 8. Risks and residuals

- A thrown value named `ClassificationCatalogError` from anywhere in the trust base would print the catalog line. Only repo code can throw it; the model cannot choose an error name. Accepted for the Manager's chosen mechanism; alternative (a private flag set in the port's catch, no name matching) is stricter (see Q1).
- Catalog wrapper discards every cause, including a missing built-in layer, so that case also says "fix the classification file". The remedy is still a reviewed change to the repo; wording says "tool classification file" only.
- Central layer text cannot be driven end to end in the sandbox (the registry source is pinned absent); covered at unit level only. A live check belongs to story J's scratch session.
- `reasonKind` is not used to pick text (per the ruling, the unlock depends on layer only); a central `read-error` and a central `schema-invalid` get the same remedy.

## 9. Blocking questions (max 3)

1. **Name-matching versus a private flag for the catalog case.** Ruling says the hook maps a fixed error name. Proceed with name mapping (plan as written), or have the port set a module-private flag so no thrown name can select the text? Default if no answer: name mapping.
2. **Bound unknown layer and kind to `unknown` in the refusal text?** Closes the last place a non-enum string could be reflected; changes nothing for real loader output. Default: yes.
3. **Recorded act for the pin edits.** Confirm that a `docs/decisions.md` row (Manager-written, with the human column filled as your process requires) covers the `PINNED_PAIRS` edit and the `STORY_TEST_FILES` extension, or say if the human must confirm these first. Default: Manager row, same PR.

## 10. Next single action

- Manager answers Q1 to Q3 (or accepts defaults) and ratifies CRITICAL; then Phase 2 starts with the red tests in section 5.

📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]

RECEIPT: verdict=BLOCKED criteria="13/13 mapped" checks="0/0/0" adr=HIT(37) pr=n/a
