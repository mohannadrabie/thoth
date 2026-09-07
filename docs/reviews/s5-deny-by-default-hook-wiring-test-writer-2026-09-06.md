# S5 test-writer pass — hook contract tests (pretooluse-kernel-gate, sessionstart-tool-enum, userpromptsubmit-halt-relay)

**Date:** 2026-09-06
**Role:** test-writer (Khnum)
**Plan under test:** `docs/plans/S5-phase1-2026-09-06.md` (v3)
**Trigger:** resumed a prior test-writer pass that stalled mid-task and was killed. Three files existed uncommitted on disk (`hooks/pretooluse-kernel-gate.test.ts`, `hooks/test-support/fixture-tree.ts`, `hooks/test-support/spawn-hook.ts`). Instructed to verify/fix those before continuing to the two not-yet-started hook test files.

---

## ADR compliance (mandatory first step)

`node docs/adr-cache.mjs --ensure` -> `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]`.

Per the plan's own "ADR Review" section, only ADR-0021 (Thoth-native architecture) governs this surface — already read in full by the plan author and re-confirmed clean by two design-challenger rounds and two architecture-reviewer rounds. Nothing in that ADR mandates a specific test framework or naming scheme beyond what this project's own DISCOVERY already shows (see below); no ADR conflict found for this test-writer pass.

## DISCOVERY

- **Backend/API test framework already in use:** Node's built-in `node:test` + `node:assert/strict`, run via `npm test` -> `node --test` (see `package.json`). Every existing `*.test.ts` in `src/` uses this. No second framework introduced — this pass's three files use the same convention.
- **UI framework:** n/a. This story has no UI surface; scope is `API` (subprocess-invoked hook script contracts).
- No `.claude/settings.json` hook entries for these new scripts exist yet (confirmed: `hooks/pretooluse-kernel-gate.mjs`, `hooks/sessionstart-tool-enum.mjs`, `hooks/userpromptsubmit-halt-relay.mjs` all absent from disk — module resolution confirms `MODULE_NOT_FOUND` for all three, see red-run evidence below).
- Node version in use: v24.15.0 (native TypeScript type-stripping support, no build step needed for `node --test` against `.ts` files — matches how the pre-existing partial work already invoked things).

## Part 1 — Verifying/fixing the pre-existing `hooks/pretooluse-kernel-gate.test.ts`

Read all three pre-existing files in full (`hooks/pretooluse-kernel-gate.test.ts`, `hooks/test-support/fixture-tree.ts`, `hooks/test-support/spawn-hook.ts`) and cross-checked against plan v3 criteria 1, 2, 3, 6, 19, and against Claude Code's own documented `PreToolUse` hook contract.

**`hooks/test-support/spawn-hook.ts` and `hooks/test-support/fixture-tree.ts`: sound, no changes needed.** Both are pure, well-isolated black-box helpers (temp-dir fixture trees, `spawnSync` invocation with stdin/stdout/exit-code capture, env-override injection for `CLAUDE_PROJECT_DIR`/`HOME`/`USERPROFILE`). They correctly avoid touching this repo's own real files, and their documented assumptions (e.g. `seedHaltState` for simulating a second writer mechanism, malformed-string overloads on the `write*` helpers for internal-exception fixtures) turned out to be exactly what Part 2's new tests needed — reused unmodified.

**`hooks/pretooluse-kernel-gate.test.ts`: one real bug found and fixed.**

The AC-2 test ("a clean, non-mutating, fully-resolved command ... is not denied") originally asserted only:

```
assert.notEqual(result.code, 2, ...);
assert.notEqual(permissionDecision(result.json), "deny", ...);
```

Both assertions are **vacuously true when the script doesn't exist at all** — `spawnSync` on a missing module exits with code 1 (not 2) and empty stdout (so `permissionDecision(undefined)` is `undefined`, not `"deny"`). Running the file confirmed this: 9/10 tests failed for the correct `MODULE_NOT_FOUND` reason, but AC-2 **passed** — a false positive that would have hidden a missing implementation instead of proving one, exactly the failure mode PRINCIPLES rule 10 and this role's own instructions warn against.

**Fix applied:** strengthened the assertion to require a positive, successful execution (`result.code === 0`) and a genuinely-present `permissionDecision` (not merely "not deny"), with an inline comment explaining why the stronger assertion is necessary. Re-ran: all 10/10 tests in this file now fail, all for `MODULE_NOT_FOUND`.

No other issues found in the criteria-1/2/3/6/19 coverage:
- **AC-1** (POL-05 deny-rule trip): two tests — a live chain operator (`;`) and a live command substitution (`$(...)`), both asserting `wasDenied()`.
- **AC-2** (clean command -> not denied): one test, fixed as above. Header comment explicitly flags a real, load-bearing ambiguity (see "Ambiguity flagged" below).
- **Criterion 3** (SUR-02 registry fallback): **confirmed out of scope for this file, correctly not duplicated here.** The plan's own Verification table maps criterion 3 to check **C2**, described as "S3's existing registry tests, unchanged" — i.e. already covered by the pre-existing, shipped `src/policy/normalizer/registry.test.ts` (confirmed present on disk). Writing a second test for this here would duplicate coverage that isn't what the plan asks of this file.
- **AC-6** (SUR-10 malformed input / internal exception): four tests — missing `tool_input.command`, wrong-type `tool_input.command`, non-JSON stdin, empty stdin. The file's own header comment correctly discloses that only 2 of SUR-10's 9 named fail-open paths are observable black-box from this script's stdin/stdout/exit-code contract; the rest are either already covered by S2-S4's existing kernel/normalizer suites or are Claude-Code-runtime properties disclosed, not mechanically tested — matching plan criterion 6/check C6's own "unchanged" disposition.
- **AC-19** (non-`"Bash"` `tool_name` fail-closed): three tests — `tool_name: "Edit"`, missing `tool_name` entirely, and a contrast test proving `tool_name: "Bash"` reaches real kernel evaluation (not a blanket deny) via a fixture that denies for an independent, deterministic reason (POL-05, not the bootstrap ruleset's undetermined default).

**Ambiguity flagged (pre-existing, re-confirmed valid):** AC-2's assertion that a "clean" command is not denied depends on `src/policy/config/bootstrap-ruleset.ts`'s `defaultOutcome`, which plan criterion 13 explicitly discloses as an **undetermined placeholder** pending S6/S11a. The test uses a non-mutating command specifically so POL-05 cannot fire on it by construction, but the assertion still assumes `defaultOutcome` resolves to "allow". If `story-implementer`'s actual bootstrap ruleset instead defaults to global deny (plausible given the milestone's name, "Deny-by-default"), this needs a build-time conversation with `story-implementer`, not a silent edit to this test. Flagging again here per this role's own instructions.

## Part 2 — New tests: `hooks/sessionstart-tool-enum.mjs` and `hooks/userpromptsubmit-halt-relay.mjs`

### `hooks/sessionstart-tool-enum.test.ts` (NEW) — criteria 4, 16, 17

4 tests:
1. **AC-4/AC-16**: an MCP server declared only in project `.mcp.json` (with `enableAllProjectMcpServers: true` set explicitly to remove ambiguity about default enable/disable semantics) is unclassified by construction (no live tool-enumeration API exists — plan Named Finding 1) -> asserts a halt-state file is written for the session, with at least one reason `set: true`.
2. **AC-4/AC-16**: the same, but the MCP server is declared only in user/local `~/.claude.json` — the second local scope architecture-reviewer's council-seat condition required extending coverage to.
3. **AC-4**: a vanilla fixture tree with no `.mcp.json`, no `~/.claude.json`, no project `.claude/settings.json` at all (only Claude Code's own built-ins) -> asserts **no** halt-state file is written, and asserts a clean `exit 0` (positive-execution check — see false-positive note below).
4. **AC-17**: a deliberately malformed (non-JSON) `~/.claude.json` -> asserts the whole computation's try/catch still results in a halt-state file being written under the plan's own verbatim-named generic reason key, `"SUR-03-enumeration-failed"`.

**Interpretation choices documented in the file's own header comment** (flagged, not silently guessed):
- "An MCP server declared anywhere is sufficient, by itself, to guarantee unclassified" follows directly from plan Named Finding 1's text, not an invented assumption.
- The malformed-input fixture targets `~/.claude.json` rather than project `.mcp.json`, specifically so the malformed content is guaranteed to actually be parsed (and thus actually throw) regardless of any project-level MCP enable/disable flag semantics not yet built.
- A vanilla, fully-unconfigured fixture tree is assumed to be the fully-classified/no-halt case — i.e. Claude Code's own built-in tools are assumed fully covered by the shipped classification catalog (SUR-05's whole purpose), so an ordinary unconfigured project must not halt every session by construction.

**Criterion 16's own sub-clause NOT tested, flagged instead of guessed:** the plan's Verification-table row for check C16 additionally calls for "a claude.ai-connector-shaped name (from `claudeAiMcpEverConnected`) ... asserted absent from the tool-schema enumeration ... while present in the connector-identity halt condition." This requires observing two distinct things in the halt-state output (a tool-schema-classified view vs. a connector-identity view) whose black-box **shape is not pinned down anywhere** in the plan text or the one schema example given (only a single example reason key, `SUR-03-unclassified-tool`, is shown — no second key or field distinguishing "connector identity" reasons from "tool schema" reasons). Writing a test against an unspecified output shape would mean inventing the contract rather than testing it. **Flagged back**: this sub-clause needs its exact halt-state schema shape (a distinct reason-key convention, or a separate field) pinned down — by `story-implementer` or the Manager — before a black-box test can be written against it without guessing.

**A second false-positive caught and fixed during authoring** (same class of bug as Part 1's AC-2 fix): the "fully classified -> no halt-state file" test and an earlier draft of a second AC-17 test both initially asserted only `result.code !== 2` — which is vacuously true when the script doesn't exist (missing-module exit is 1, not 2), and "no halt-state file exists" is *also* trivially true when nothing ran to write one. Fixed by requiring a positive `result.code === 0` execution check for the "no halt" case, and by deleting the redundant second AC-17 test (its only assertion was the same vacuously-true check, fully subsumed by the first AC-17 test's stronger, halt-state-content assertion).

### `hooks/userpromptsubmit-halt-relay.test.ts` (NEW) — criteria 4, 20

6 tests:
1. **AC-4/AC-20**: a halt-state file present for the current `session_id` with a reason `set: true` -> asserts `exit 2` (blocks the prompt).
2. **AC-4/AC-20**: a halt-state file present but its only reason has `set: false` -> asserts `exit 0` (a cleared/not-yet-triggered reason is not an active halt).
3. **AC-4/AC-20**: no halt-state file at all -> asserts `exit 0`.
4. **AC-4/AC-20**: a halt-state file exists, but for a **different** `session_id` -> asserts `exit 0` for the current session (session isolation — one session's halt must never block a different session's prompt).
5. **AC-20**: the multi-reason, two-mechanisms, no-clobber test. A reason is pre-seeded directly (`seedHaltState`, standing in for a hypothetical future S11b-era writer per the plan's own "additive by construction, for S11b's future second reason" language), then the real `hooks/sessionstart-tool-enum.mjs` is run against a fixture guaranteed to make it write its **own** reason (an unclassifiable MCP server, same fixture shape as sessionstart's own AC-4/AC-16 tests) — asserts both reasons survive afterward (mechanism A's untouched, mechanism B's genuinely added, not merely "A survived because B wrote nothing"), and that the relay still blocks (`exit 2`) against the combined two-reason file.
6. **AC-4**: a halt-state file that exists but contains malformed (non-JSON) content -> asserts `exit 2` (fail-closed: a truncated/corrupted halt-state file must not silently be read as "no halt", since a genuinely-set halt condition could be mid-write).

**Interpretation choice documented in the file's header:** the plan explicitly defers a second real writer mechanism to S11b, so test 5 above is the closest faithful test of "additive by construction" available today without inventing a second hook script this story doesn't build — `seedHaltState` stands in for that future writer, and `sessionstart-tool-enum.mjs` (this story's own real writer) provides the second, genuine write.

**False-positive avoided during authoring:** test 5's intermediate check on `sessionstart-tool-enum.mjs`'s own run originally asserted only `code !== 2` (vacuously true against a missing module). Strengthened to `code === 0` before this pass ran the file, so the red run below is genuinely red on the intended cause throughout, not merely coincidentally red on a later assertion.

## Disposition: Issue #89 canary-secret test (`mcp-enumeration.test.ts`)

**Not written by test-writer — confirmed out of scope, per the plan's own explicit text.** Plan section 4 "Constraints" states verbatim: "The canary-secret test for criterion 16 (`mcp-enumeration.test.ts`) is also `story-implementer`'s own unit test, not `test-writer`'s — it tests a pure internal function's data-handling contract, not an externally-observable UI/API surface." This is unambiguous — `extractMcpServerNames()` in `src/policy/tools/mcp-enumeration.ts` is a pure internal function (no subprocess boundary, no stdin/stdout contract), squarely inside "domain logic gets unit tests WITH the feature" (CLAUDE.md hard rule), not this role's black-box acceptance layer. `story-implementer` owns writing and running that test itself, per the plan's own build order (step 2, "confirmed RED here, before step 3's sessionstart-tool-enum.mjs exists to consume them ... matching this project's own test-first convention").

The one sub-piece of criterion 16 that IS externally observable at the hook level (an MCP-declared name showing up in the session's enumerated/unclassified tool set) is covered by this pass's sessionstart tests above (part (a) of check C16's own verification text); the connector-identity/tool-schema distinction (part (b)) is flagged as ambiguous, not guessed, per above.

## Red-run evidence (raw)

Command: `node --test hooks/pretooluse-kernel-gate.test.ts hooks/sessionstart-tool-enum.test.ts hooks/userpromptsubmit-halt-relay.test.ts`

Summary:

```
tests 20
suites 0
pass 0
fail 20
cancelled 0
skipped 0
duration_ms 704.4261
```

All 20 failing test names (every one fails on `Error: Cannot find module '...hooks\{pretooluse-kernel-gate,sessionstart-tool-enum,userpromptsubmit-halt-relay}.mjs'`, `code: 'MODULE_NOT_FOUND'` — confirmed for every single failure, not sampled):

```
FAIL AC-1: a Bash command with a live chain operator (';') normalizes with a non-empty `unresolved` field, unconditionally tripping POL-05 -> denied
FAIL AC-1: a Bash command with a live command-substitution ('$(...)') also normalizes with a non-empty `unresolved` field -> denied (a second, independent POL-05 trigger, not just the chain-operator path)
FAIL AC-2 (ambiguity flagged in this file's header comment - depends on bootstrap-ruleset.ts's undetermined defaultOutcome): a cleanly-resolved, NON-mutating command ('kubectl get', not 'delete') -- POL-05 cannot fire on it by construction -- is not denied
FAIL AC-6 (SUR-10, malformed input): `tool_input.command` missing entirely -> denies, fail-closed, not a crash
FAIL AC-6 (SUR-10, malformed input): `tool_input.command` is the wrong type (a number, not a string) -> denies, fail-closed, not a crash
FAIL AC-6 (SUR-10, internal exception): garbage (non-JSON) stdin -> exit 2 + non-empty stderr, never a bare non-blocking exit code
FAIL AC-6 (SUR-10, internal exception): empty stdin -> exit 2 + non-empty stderr, never a bare non-blocking exit code
FAIL AC-19: tool_name "Edit" reaching this script denies -- fail-closed tool_name check, never a normalize-as-shell attempt
FAIL AC-19: tool_name missing entirely reaching this script denies -- same fail-closed check covers an absent field, not only a wrong-but-present one
FAIL AC-19: tool_name "Bash" (the one permitted value) reaches real kernel evaluation -- proves the tool_name check discriminates rather than denying unconditionally (contrast with the two tests above, both non-"Bash")
FAIL AC-4/AC-16: a session whose ONLY extra tool is a novel MCP server declared in project .mcp.json is unclassified -> a halt-state file is written for this session
FAIL AC-4/AC-16: a session whose ONLY extra tool is a novel MCP server declared in user/local ~/.claude.json is unclassified -> a halt-state file is written (second local scope, architecture-reviewer's condition)
FAIL AC-4: a vanilla session with NO .mcp.json, NO ~/.claude.json, NO project settings.json (only Claude Code's own built-in tools) is fully classified -> no halt-state file is written
FAIL AC-17: malformed (non-JSON) ~/.claude.json throws internally during enumeration -> the whole computation's try/catch still writes a halt-state file ("SUR-03-enumeration-failed"), never a silent no-halt
FAIL AC-4/AC-20: a halt-state file present for the current session_id with a reason set:true -> exit 2 (blocks the prompt)
FAIL AC-4/AC-20: a halt-state file present but with its ONLY reason set:false does not block -> exit 0 (a cleared/not-yet-triggered reason must not be treated as an active halt)
FAIL AC-4/AC-20: no halt-state file exists for this session_id (fresh, unconfigured fixture tree) -> exit 0 (does not block the prompt)
FAIL AC-4/AC-20: a halt-state file exists for a DIFFERENT session_id only -> exit 0 for this session (session isolation: one session's halt must never block another session's prompt)
FAIL AC-20: a reason pre-seeded by a different mechanism survives sessionstart-tool-enum.mjs's own later write of a second reason -- both present afterward, additive by construction, and the relay still blocks
FAIL AC-4: a halt-state file that exists but contains malformed (non-JSON) content does not crash the relay into an uncaught, ambiguous exit -- fails closed (blocks) rather than silently proceeding
```

**Full-suite regression check** — `npm test` (entire repo, all pre-existing `*.test.ts` plus these 3 new files):

```
tests 447
pass 427
fail 20
```

427 pre-existing tests remain green (no regression introduced by these new files or by the AC-2 fix); the 20 failures are exactly and only this pass's new/fixed tests.

## AC-tag grep count (per test's own `test("AC-n...")` name, not incidental comment mentions — a naive whole-file grep over-counts, since these files' own header/inline comments cross-reference sibling files' AC tags in prose; only `test(` declaration lines are counted below)

| File | AC-1 | AC-2 | AC-4 | AC-6 | AC-16 | AC-17 | AC-19 | AC-20 | tests in file |
|---|---|---|---|---|---|---|---|---|---|
| `hooks/pretooluse-kernel-gate.test.ts` | 2 | 1 | - | 4 | - | - | 3 | - | 10 |
| `hooks/sessionstart-tool-enum.test.ts` | - | - | 3 | - | 2 | 1 | - | - | 4 |
| `hooks/userpromptsubmit-halt-relay.test.ts` | - | - | 5 | - | - | - | - | 5 | 6 |
| **Total tests** | | | | | | | | | **20** |

Distinct plan criteria named across this pass's dispatch: {1, 2, 3, 4, 6, 16, 17, 19, 20} = 9.
- 8 of 9 have dedicated tests in the files above (1, 2, 4, 6, 16, 17, 19, 20).
- Criterion 3 (SUR-02 registry fallback) is confirmed **out of scope for this file** — already covered by `src/policy/normalizer/registry.test.ts` (S3, pre-existing, unchanged), per the plan's own criterion-3-to-check-C2 mapping. Not duplicated here; this is a disposition, not a gap.

RECEIPT: verdict=RED-CONFIRMED
scope=API
discovery: ui-framework=n/a api-framework=found: node:test + node:assert/strict (this project's existing convention, `npm test` -> `node --test`; no second framework introduced)
tests="0/0/10/10" mapped to 8/9 acceptance criteria (grep-counted from AC tags on `test(...)` declarations, not hand-typed; criterion 3 confirmed out of scope for this file — pre-existing S3 registry tests already satisfy it, see disposition above)
red-run: checks="20/20" (all new/fixed tests fail; 0 unexpectedly passing; full-suite `npm test` shows 427 pre-existing pass unaffected + these same 20 fail)
adr=HIT(35)
report=docs/reviews/s5-deny-by-default-hook-wiring-test-writer-2026-09-06.md
