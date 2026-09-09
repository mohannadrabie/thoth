// Black-box acceptance tests for `src/policy/config/printer.ts` (POL-10) — written FIRST, before
// that file (or `src/policy/config/central-source.ts`) exists (test-writer, per CLAUDE.md's
// test-first workflow: story-implementer writes zero application code until these are
// RED-CONFIRMED). Neither module exists yet; the expected RED failure is a clean
// ERR_MODULE_NOT_FOUND on the `./printer.ts` import below, not a flaky/ambiguous failure.
//
// Source of truth:
//   - docs/plans/S6-phase1-v2-2026-09-08.md (v2, authoritative) §7 (test-first dispatch: the
//     printer is the ONE new API/CLI surface this story introduces; loader/lock/pin internals are
//     story-implementer's own unit tests, out of this file's scope), §8's verification table
//     (AC3, AC5a, AC5b, AC5c, AC10), §8's `CentralPolicyResult` discriminated-union shape
//     (architecture-reviewer condition #2/#4), §3a (this file's tests exercise the INJECTED
//     `CentralPolicySource` fixture reader ONLY — never the real Windows registry; a human runs
//     the one-time real-registry confidence check separately, §3a point 3).
//   - REQUIREMENTS.md POL-10 (line 434): "The resolved effective policy shall be printable with
//     the origin file and line of every rule... One command answers 'why is this blocked' without
//     reading a script."
//   - src/policy/rule/precedence.ts's `mergeLayers` (already shipped, S2/S3): the merge-order
//     convention this file's expected fixture output follows verbatim (first-appearance order
//     across shipped-defaults -> central -> project; later layer's VALUE wins, but a rule id's
//     ORDER position is fixed by whichever layer first introduced it).
//
// ============================================================================================
// THE CONTRACT THIS FILE SPECIFIES (the "answer key" — story-implementer builds to this, it does
// not invent its own shape; anything here it believes is wrong or impossible flags back to
// test-writer/the Manager rather than being silently edited, per CLAUDE.md's DoD).
// ============================================================================================
//
// `src/policy/config/printer.ts` exports:
//
//   export interface PrinterInput {
//     shippedDefaultsPath: string;   // real file path; printer reads+parses it itself
//     projectPolicyPath: string;     // real file path; printer reads+parses it itself
//     centralSource: CentralPolicySource;  // injected (SE ADR-0003) — production wires the real
//                                            // win32-registry reader; tests inject a fixture
//   }
//   export interface PrinterResult {
//     stdout: string;
//     exitCode: number;
//   }
//   export function printEffectivePolicy(input: PrinterInput): PrinterResult;
//
// `printEffectivePolicy` NEVER throws — any failure (JSON.parse throwing, schema validation
// failing, or `centralSource.read()` itself throwing) is caught internally and turned into a
// PrinterResult with exitCode 1, matching this project's established "wrap in try/catch, never a
// silent crash" convention (hooks/sessionstart-tool-enum.mjs's own criterion 17, same shape).
//
// STDOUT GRAMMAR (exact, byte-for-byte, `\n`-joined regardless of platform or of the CENTRAL
// layer's own raw-text line-ending style):
//
//   Success (central status is "absent", "unsupported", or "present"-and-valid; exitCode 0):
//     Line 1:      `central-channel status=<absent|unsupported|present>[ channel=<channel>]`
//                    - the trailing ` channel=<channel>` suffix appears ONLY for status=present
//                      (the one variant that actually carries a channel descriptor per
//                      `CentralPolicyResult`).
//     Line 2:      `--- resolved rules (<n>) ---`
//     Lines 3..:   one line per resolved rule, in `mergeLayers`-order (first-appearance order
//                  across shipped-defaults -> central -> project):
//                    `rule id=<id> effect=<allow|deny> layer=<shipped-defaults|central|project> origin=<origin> line=<line> mandatory=<true|false>`
//                  where:
//                    - <layer> is whichever layer's VALUE won for this id (last-write-wins, same
//                      as `mergeLayers`'s own `sourceLayer` tag) — NOT necessarily the layer that
//                      first introduced the id into the order.
//                    - <origin> is, for a file-backed layer, the EXACT `shippedDefaultsPath` /
//                      `projectPolicyPath` string passed to `printEffectivePolicy` (verbatim, not
//                      resolved/canonicalized); for the central layer, the exact `channel` string
//                      the winning `CentralPolicyResult` carried.
//                    - <line> is the 1-indexed line number of the `{` that opens the rule's JSON
//                      object in its winning layer's raw source text — POL-10 names "line", not
//                      "line+column"; column-level tokenizer correctness is
//                      `position-parser.test.ts`'s own scope (story-implementer's unit test), not
//                      exposed by this printer contract at all.
//                    - <mandatory> is `Rule.mandatory ?? false`, always printed explicitly (never
//                      omitted) so a reader never has to guess whether an absent field means
//                      "not mandatory" or "printer forgot to say."
//
//   Fail-closed rejection (central status is "present" but content is invalid, OR
//   `centralSource.read()` itself threw, OR the shipped-defaults/project file itself fails to
//   parse/validate; exitCode 1; AC5b/AC5c — "whole load rejected", so NO `rule id=` line ever
//   appears, regardless of how many rules the other layers alone would otherwise have resolved):
//     Line 1:      `central-channel status=present channel=<channel>`   (malformed-JSON / schema-invalid
//                                                                         IN THE CENTRAL layer)
//                  `central-channel status=read-error`                  (`.read()` itself threw —
//                                                                         no channel is ever known)
//                  `central-channel status=<absent|unsupported|present...>` (unchanged/whatever the
//                                                                         real central status was,
//                                                                         when a NON-central layer
//                                                                         is the one that failed)
//     Line 2:      `REJECTED: <layer> policy load failed (<reason-kind>): <message>`
//                  <layer> in {"central", "shipped-defaults", "project"} — names WHICHEVER layer
//                  actually failed to read/parse/validate. AMENDED 2026-09-08 (Issue #108 [MED],
//                  test-writer): the ORIGINAL locked answer key hardcoded the literal "central"
//                  here for every reason kind, including shipped-defaults/project failures — see
//                  INTERPRETATION CHOICE 6 below for the full history and why this is a test-file
//                  fix, not a code-side second bug.
//                  <reason-kind> in {"json-parse-error", "schema-invalid", "read-error"} — three
//                  distinct, nameable causes (AC5b/AC5c's own "distinguishable... asserted
//                  structurally identical in kind" bar: same exitCode, same 2-line shape, same
//                  "REJECTED:" prefix, across all three).
//     Total stdout is EXACTLY these two lines — asserted by exact string equality below, not
//     merely "contains", so nothing from a partially-parsed rule can leak through.
//
// ============================================================================================
// INTERPRETATION CHOICES made explicitly here (flagged per this project's convention, since the
// printer implementation does not exist yet to confirm against — see CLAUDE.md's DoD and this
// pass's own dispatch instructions):
// ============================================================================================
//
// 1. STDOUT FORMAT ITSELF is invented here, not found anywhere in the plan — POL-10's acceptance
//    text only says "the origin file and line of every rule" / "one command answers 'why is this
//    blocked'", with no literal format given. Per this project's test-first discipline
//    (test-writer's tests ARE the specification a black-box CLI must satisfy), a concrete,
//    greppable `key=value` line format is chosen deliberately over free-text prose so exact-string
//    assertions are meaningful and stable. This is the single largest judgment call in this file.
//
// 2. CLI INVOCATION SHAPE: the task dispatching this pass explicitly authorizes test-writer to
//    pick the exact `npm run` command name since the plan only says "`npm run policy:print` or
//    similar" without pinning it. Picked: `policy:print`, exactly as the plan's own suggestion —
//    see the dedicated "runnable entry point" test below, and this file's own RECEIPT.
//
// 3. TEST MECHANISM DELIBERATELY DEVIATES FROM THE hooks/*.test.ts SUBPROCESS-SPAWN PRECEDENT —
//    disclosed here, not silently different. Hooks are spawned as real child processes
//    (`runHook`/`spawnSync`) because that IS their only real entry point — Claude Code itself
//    invokes them that way, so there is no other way to test their stdin/stdout contract.
//    `printer.ts`'s CLI entry, by contrast, is a thin, near-zero-logic wrapper: production wiring
//    constructs the REAL default `CentralPolicySource` (the win32 `reg query` reader) and calls
//    `printEffectivePolicy()`. Testing `printEffectivePolicy()` directly, in-process, via a normal
//    TypeScript import — exactly this repo's own established pattern for testable core logic
//    (bootstrap-ruleset.test.ts imports and calls `loadBootstrapRuleSet()` directly rather than
//    spawning a process) — exercises the EXACT SAME PUBLIC FUNCTION the thin CLI wrapper itself
//    calls, so this is still a genuine black-box test of the printer's own externally observable
//    behavior, not a peek at private internals.
//
//    This choice is not merely stylistic — it is the only responsible option available. A
//    subprocess-spawn test of the real `npm run policy:print` command would need SOME
//    process-boundary mechanism (an env var or CLI flag) to substitute a fixture
//    `CentralPolicySource` for the real registry reader in a test run. This project has ALREADY
//    shipped, and then reverted for a proven CRITICAL security reason, exactly that shape of
//    seam: `hooks/sessionstart-tool-enum-fixnow.test.ts`'s own header records that
//    `THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH` (an env var letting a caller pick which
//    fixture file a SIBLING sensitive-config mechanism loads) was REMOVED FROM PRODUCTION ENTIRELY
//    per GitHub Issue #99, because any env-var-selectable fixture path is an attacker-controlled
//    substitution point for a "Policy delivery / config surface" (CLAUDE.md's own named sensitive
//    area, which `central-source.ts` sits squarely inside). Inventing the equivalent seam for
//    `central-source.ts`/`printer.ts` here — unilaterally, in a test file, with no named-reviewer
//    scrutiny — would silently reintroduce the exact defect shape this project already paid to
//    fix once. Designing that seam (if this project ever wants an automated real-subprocess
//    printer test) is a PRODUCTION CODE decision belonging to story-implementer's plan and this
//    sensitive area's required reviewers, not something test-writer invents in a test file that
//    "never touches application source."
//
//    Separately, and independent of the above: `.gitattributes` (`*.json text eol=lf`) forces LF
//    normalization on every committed `.json` file at checkout, on this Windows repo
//    (`core.autocrlf=true`, confirmed this pass). A checked-in "CRLF fixture" `.json` file would
//    therefore be silently rewritten to LF by git itself and prove nothing about AC10's CRLF case
//    — confirmed by reading `.gitattributes` directly, not assumed. The CRLF fixture below is
//    therefore an in-memory string built with explicit `\r\n` (a JS escape sequence, unaffected by
//    the .ts source FILE's own EOL normalization), never a committed raw-CRLF file.
//
// 4. The "runnable entry point" (`npm run policy:print`'s target script) is asserted to EXIST as a
//    file and to be named in `package.json`, but is NOT executed by this file at all — executing
//    it for real would either hit the real Windows registry (out of this file's scope per §3a) or
//    require the same fixture-injection seam disclaimed in point 3. This is a deliberate,
//    narrower check than a full subprocess integration test; the full real-registry path is the
//    human-owned, one-time manual step §3a point 3 already names.
//
// 5. `mandatory=<bool>` is printed on EVERY rule line, not only mandatory ones. Not literally
//    required by POL-10's own acceptance text, but directly motivated by AC9's own justification
//    text ("gives the operator one loud, unambiguous printer-visible signal") which imagines the
//    printer as exactly where mandatory-lock status becomes visible. This file's fixture includes
//    one mandatory-locked id (per this pass's own dispatch instructions) to prove the printer
//    displays it correctly on the ordinary SUCCESS path — it deliberately does NOT test a
//    mandatory-lock REJECTION scenario, which is `precedence.test.ts`'s own scope (AC9, ratified
//    to story-implementer's own unit tests by §7's dispatch check, not this file's).
//
// 6. AMENDMENT, 2026-09-08 (Issue #108 [MED], red-team round 4 — test-writer, per this project's
//    DoD: only test-writer may amend a locked answer key, and only when the test itself pins a
//    bug rather than the code being wrong). The ORIGINAL version of this file's fail-closed
//    rejection grammar (INTERPRETATION CHOICE point above, and `buildExpectedRejectionStdout`)
//    hardcoded the literal prefix `REJECTED: central policy load failed (<reason-kind>): ...` for
//    ALL THREE reason kinds, regardless of which of the three layers (central / shipped-defaults /
//    project) actually produced the failure. Verified against `src/policy/config/printer.ts`
//    (`renderRejection`, then at line 67) and `loader.ts` (the three separate `return { ok: false,
//    ... }` branches for central-parse-failure, shipped-defaults-parse-failure, and
//    project-parse-failure) before amending: the ORIGINAL 9/9-passing test suite was genuinely
//    pinning printer.ts's bug, not exposing a second loader.ts defect — `loader.ts`'s `message`
//    field already embeds the correct failing file's own origin path/channel (via
//    `parseLayerText`'s `${origin}: ${...}` prefix), so the layer information IS available at the
//    call site; `printer.ts`'s `renderRejection` simply never used it, defaulting to "central" in
//    the literal string unconditionally. This is a printer.ts fix, not a loader.ts fix.
//
//    Real-world repro reproduced verbatim before amending (a UTF-8-BOM'd PROJECT-layer file,
//    Windows PowerShell 5.1 `Out-File -Encoding utf8` / Notepad "UTF-8 with BOM"): central absent
//    and wholly uninvolved, yet the original grammar rendered `REJECTED: central policy load
//    failed (json-parse-error): ...project-bom....json: Unexpected token...` — misnaming the
//    offending layer. `docs/qa/s6-policy-loader-fixtures/printer-project-bom-malformed.json`
//    (added by this amendment) is that exact fixture: a real 3-byte EF BB BF BOM prefix (not an
//    escaped `﻿` string — proving this against the SAME on-disk byte shape a real Windows
//    save produces, through printer.ts's own real `readFileSync` call, not a simulated string).
//
//    Two named regression tests were requested for this Issue: (a) "a rejection caused by the
//    PROJECT layer never claims the central channel failed" — added below, immediately after the
//    AC5c test. (b) a loader-level "a UTF-8 BOM on any layer file is either tolerated or rejected
//    with that layer named" test in `loader.test.ts` — confirmed NOT separately needed:
//    `loader.test.ts` is story-implementer's own white-box unit-test file (plain `node:test`
//    unit tests against temp-dir fixtures, no test-writer header/lock language — out of this
//    file's ownership per this project's "two layers, two authors" rule), and (a)'s own fixture
//    already exercises the REAL (non-BOM-tolerant) `loadEffectivePolicy` code path end-to-end
//    through the real printer, satisfying (b)'s own disjunctive text ("either tolerated OR
//    rejected with that layer named" — it is rejected, and named) without a second file. Reading
//    `loader.ts` directly confirms it never strips a BOM (`readFileSync(path, "utf8")` feeds the
//    raw text, BOM included, straight into `JSON.parse`) — BOM-tolerance itself (stripping it
//    instead of rejecting) is a separate, NOT-currently-broken design choice this amendment does
//    not take a position on; noted here rather than silently expanded into.
//
//    A third, symmetric shipped-defaults-layer misattribution case is added alongside (a) for the
//    same reason (a), not the loader-level case, sits in this file's scope: the defect as described
//    to test-writer names all three layers ("central / shipped-defaults / project"), and leaving
//    the shipped-defaults branch of `renderRejection`/`loader.ts` completely unverified by this
//    suite would leave a real gap in the very fix this Issue asks for — this is completing the
//    fix's own stated scope, not scope creep beyond it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printEffectivePolicy, type PrinterInput, type PrinterResult } from "./printer.ts";
import type { CentralPolicySource, CentralPolicyResult } from "./central-source.ts";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "..", "..", "..");
const FIXTURES_DIR = path.join(REPO_ROOT, "docs", "qa", "s6-policy-loader-fixtures");
const SHIPPED_DEFAULTS_PATH = path.join(FIXTURES_DIR, "printer-shipped-defaults.json");
const PROJECT_POLICY_PATH = path.join(FIXTURES_DIR, "printer-project.json");
// Issue #108 [MED] amendment fixtures (see INTERPRETATION CHOICE 6 above) — a PROJECT-layer file
// with a real leading UTF-8 BOM (the exact repro), and a SHIPPED-DEFAULTS-layer file with plain
// malformed JSON (no BOM needed to prove this branch; the defect is the same regardless of WHY
// the layer failed to parse).
const PROJECT_BOM_MALFORMED_PATH = path.join(FIXTURES_DIR, "printer-project-bom-malformed.json");
const SHIPPED_DEFAULTS_MALFORMED_PATH = path.join(FIXTURES_DIR, "printer-shipped-defaults-malformed.json");

// Sanity check on this file's OWN fixtures (fails loudly here, not silently downstream, if a
// future edit to the committed fixture files disagrees with this file's hand-verified line
// numbers baked into the expected-output builder below). Not itself an AC-tagged printer-contract
// test -- a guard on this test file's own fixture integrity.
test("fixture-integrity: printer-shipped-defaults.json and printer-project.json's rule objects open on the exact lines this file's expected-output builder hard-codes", () => {
  assert.ok(existsSync(SHIPPED_DEFAULTS_PATH), `expected fixture file to exist: ${SHIPPED_DEFAULTS_PATH}`);
  assert.ok(existsSync(PROJECT_POLICY_PATH), `expected fixture file to exist: ${PROJECT_POLICY_PATH}`);
  const shippedLines = readFileSync(SHIPPED_DEFAULTS_PATH, "utf8").split("\n");
  assert.match(shippedLines[3] ?? "", /^\s*\{\s*$/, "expected printer-shipped-defaults.json's rule object to open on line 4 (0-indexed line 3) -- this file's hand-computed line numbers depend on it");
  const projectLines = readFileSync(PROJECT_POLICY_PATH, "utf8").split("\n");
  assert.match(projectLines[3] ?? "", /^\s*\{\s*$/, "expected printer-project.json's FIRST rule object to open on line 4");
  assert.match(projectLines[9] ?? "", /^\s*\{\s*$/, "expected printer-project.json's SECOND rule (shared-override-example) to open on line 10");
});

/** The central layer's "present, valid" fixture raw text -- CRLF line endings throughout (AC10)
 * plus a non-ASCII rationale (café, 🔒) on the first rule, built as an in-memory string with
 * explicit `\r\n` (see INTERPRETATION CHOICE 3 above for why this is never a committed file).
 * Hand-verified line numbers (1-indexed, counting `\r\n` as one line break each):
 *   line 4  -> central-require-mfa-for-deploy's opening `{`
 *   line 10 -> shared-override-example's opening `{` (central's SHADOWED copy -- project.json's
 *              copy of the same id wins; this line number must NEVER appear in this fixture's own
 *              expected printer output). */
const CENTRAL_VALID_RAW = [
  "{",
  '  "version": "1.0.0-fixture-central",',
  '  "rules": [',
  "    {",
  '      "id": "central-require-mfa-for-deploy",',
  '      "effect": "deny",',
  '      "verbs": ["deploy"],',
  '      "rationale": "Central policy (fixture, injected -- never the real registry): deploy without MFA context is denied. Non-ASCII tokenizer probe: café, emoji 🔒."',
  "    },",
  "    {",
  '      "id": "shared-override-example",',
  '      "effect": "deny",',
  '      "rationale": "Central\'s copy of shared-override-example -- project.json overrides this id, so this copy must never be the one the printer reports as the winning origin."',
  "    }",
  "  ]",
  "}",
].join("\r\n");

const CENTRAL_MALFORMED_JSON_RAW = '{ "version": "1.0.0", "rules": [ { "id": "x", "effect": "deny"';

/** Syntactically valid JSON; fails src/policy/rule/schema.ts's real `validateRuleSet` because
 * "effect" must be exactly "allow" or "deny" (confirmed by reading schema.ts directly, not
 * guessed) -- "MAYBE" is neither. */
const CENTRAL_SCHEMA_INVALID_RAW = '{"version":"1.0.0","rules":[{"id":"bad-central-rule","effect":"MAYBE"}]}';

const CENTRAL_CHANNEL = "test-fixture:central-channel";

function centralSourceReturning(result: CentralPolicyResult): CentralPolicySource {
  return { read: () => result };
}

function centralSourceThrowing(message: string): CentralPolicySource {
  return {
    read: () => {
      throw new Error(message);
    },
  };
}

function baseInput(centralSource: CentralPolicySource): PrinterInput {
  return {
    shippedDefaultsPath: SHIPPED_DEFAULTS_PATH,
    projectPolicyPath: PROJECT_POLICY_PATH,
    centralSource,
  };
}

interface ExpectedRuleLine {
  id: string;
  effect: "allow" | "deny";
  layer: "shipped-defaults" | "central" | "project";
  origin: string;
  line: number;
  mandatory: boolean;
}

function buildExpectedSuccessStdout(centralStatusLine: string, rules: ExpectedRuleLine[]): string {
  const header = [centralStatusLine, `--- resolved rules (${rules.length}) ---`];
  const ruleLines = rules.map(
    (r) => `rule id=${r.id} effect=${r.effect} layer=${r.layer} origin=${r.origin} line=${r.line} mandatory=${r.mandatory}`,
  );
  return [...header, ...ruleLines].join("\n");
}

// `layer` (Issue #108 [MED] amendment, see INTERPRETATION CHOICE 6): the layer name the REJECTED
// line must attribute the failure to — "central", "shipped-defaults", or "project" — WHICHEVER
// one actually produced this failure, never hardcoded regardless of the true offender.
function buildExpectedRejectionStdout(centralStatusLine: string, layer: "central" | "shipped-defaults" | "project", reasonKind: string, messagePattern: RegExp): (actual: string) => void {
  return (actual: string) => {
    const lines = actual.split("\n");
    assert.equal(lines.length, 2, `expected EXACTLY 2 lines on a fail-closed rejection (no rule lines may leak through); got:\n${actual}`);
    assert.equal(lines[0], centralStatusLine, `expected line 1 to be the central-channel status line; got:\n${actual}`);
    assert.match(
      lines[1] ?? "",
      new RegExp(`^REJECTED: ${layer} policy load failed \\(${reasonKind}\\): `),
      `expected line 2 to start with the exact "REJECTED: ${layer} policy load failed (${reasonKind}):" prefix -- naming the layer that ACTUALLY failed, not hardcoded to "central" regardless of the true offender (Issue #108 [MED]); got:\n${actual}`,
    );
    assert.match(lines[1] ?? "", messagePattern, `expected the rejection message to match ${messagePattern}; got:\n${actual}`);
    assert.doesNotMatch(actual, /rule id=/, `expected NO rule data to leak through a fail-closed rejection (AC5b/AC5c "whole load rejected"); got:\n${actual}`);
  };
}

// The rules shipped-defaults and project alone would resolve to, absent any central contribution
// -- reused by both the "absent" and "unsupported" cases (AC5a and the union's third state both
// contribute zero central rules, but must remain textually distinguishable per this pass's own
// dispatch instructions).
const RULES_WITH_NO_CENTRAL_CONTRIBUTION: ExpectedRuleLine[] = [
  { id: "shipped-baseline-deny-secrets", effect: "deny", layer: "shipped-defaults", origin: SHIPPED_DEFAULTS_PATH, line: 4, mandatory: true },
  { id: "project-allow-readonly-status", effect: "allow", layer: "project", origin: PROJECT_POLICY_PATH, line: 4, mandatory: false },
  { id: "shared-override-example", effect: "allow", layer: "project", origin: PROJECT_POLICY_PATH, line: 10, mandatory: false },
];

// --- AC5a: central channel ABSENT -----------------------------------------------------------

test("AC3/AC5a: central channel ABSENT -- central contributes zero rules, load is NOT rejected, shipped-defaults+project resolve normally with correct id/effect/layer/origin/line/mandatory, exit code 0", () => {
  const result: PrinterResult = printEffectivePolicy(baseInput(centralSourceReturning({ status: "absent" })));
  assert.equal(result.exitCode, 0, `expected exit code 0 for an absent (non-rejecting) central channel; stdout=${result.stdout}`);
  assert.equal(result.stdout, buildExpectedSuccessStdout("central-channel status=absent", RULES_WITH_NO_CENTRAL_CONTRIBUTION));
});

// --- architecture-reviewer finding 2/4: UNSUPPORTED must be distinguishable from ABSENT ------

test("AC3: central channel UNSUPPORTED (no reader implemented for this platform) -- same non-rejecting rule set as ABSENT, but the central-channel status line is textually DISTINCT from absent (architecture-reviewer finding 2 -- 'unsupported' must never silently read as 'confirmed absent'), exit code 0", () => {
  const result: PrinterResult = printEffectivePolicy(baseInput(centralSourceReturning({ status: "unsupported" })));
  assert.equal(result.exitCode, 0, `expected exit code 0 for an unsupported-platform central channel (not itself an error); stdout=${result.stdout}`);
  const expected = buildExpectedSuccessStdout("central-channel status=unsupported", RULES_WITH_NO_CENTRAL_CONTRIBUTION);
  assert.equal(result.stdout, expected);
  assert.notEqual(result.stdout.split("\n")[0], "central-channel status=absent", "expected the unsupported-platform status line to be textually distinct from the confirmed-absent status line");
});

// --- AC3/AC10: central PRESENT and valid, CRLF + non-ASCII tokenizer edge case ---------------

test("AC3/AC10: central channel PRESENT and valid (CRLF line endings + a non-ASCII rationale in the central layer's raw text) -- exact origin+line per rule in mergeLayers order, the mandatory-locked shipped-defaults rule shows mandatory=true, the ordinary override resolves to project's (winning) origin+line not central's shadowed copy, and CRLF/non-ASCII do not perturb any rule's line number, exit code 0", () => {
  const result: PrinterResult = printEffectivePolicy(
    baseInput(centralSourceReturning({ status: "present", raw: CENTRAL_VALID_RAW, channel: CENTRAL_CHANNEL })),
  );
  assert.equal(result.exitCode, 0, `expected exit code 0 for a valid central channel; stdout=${result.stdout}`);

  const expectedRules: ExpectedRuleLine[] = [
    { id: "shipped-baseline-deny-secrets", effect: "deny", layer: "shipped-defaults", origin: SHIPPED_DEFAULTS_PATH, line: 4, mandatory: true },
    { id: "central-require-mfa-for-deploy", effect: "deny", layer: "central", origin: CENTRAL_CHANNEL, line: 4, mandatory: false },
    // order position fixed by CENTRAL's first appearance (3rd overall), but the WINNING value
    // (effect/origin/line) is project's -- last-write-wins per mergeLayers, same as POL-08 today.
    { id: "shared-override-example", effect: "allow", layer: "project", origin: PROJECT_POLICY_PATH, line: 10, mandatory: false },
    { id: "project-allow-readonly-status", effect: "allow", layer: "project", origin: PROJECT_POLICY_PATH, line: 4, mandatory: false },
  ];
  const expected = buildExpectedSuccessStdout(`central-channel status=present channel=${CENTRAL_CHANNEL}`, expectedRules);
  assert.equal(result.stdout, expected);

  // Belt-and-suspenders: central's own SHADOWED line-10 copy of shared-override-example must
  // never appear paired with layer=central anywhere in the output.
  assert.doesNotMatch(result.stdout, /id=shared-override-example effect=deny layer=central/, "expected central's shadowed (losing) copy of shared-override-example to be fully absent from the output, not merely reordered");
});

// --- AC5b: central PRESENT but malformed (two distinct sub-shapes, same fail-closed KIND) ----

test("AC5b: central channel PRESENT but syntactically invalid JSON -- whole load rejected (no shipped-defaults/project rules leak through either), exit code 1, distinct json-parse-error reason", () => {
  const result: PrinterResult = printEffectivePolicy(
    baseInput(centralSourceReturning({ status: "present", raw: CENTRAL_MALFORMED_JSON_RAW, channel: CENTRAL_CHANNEL })),
  );
  assert.equal(result.exitCode, 1, `expected exit code 1 for malformed-JSON central content (fail-closed); stdout=${result.stdout}`);
  buildExpectedRejectionStdout(`central-channel status=present channel=${CENTRAL_CHANNEL}`, "central", "json-parse-error", /./)(result.stdout);
});

test("AC5b: central channel PRESENT, syntactically valid JSON, but fails schema validation (effect=\"MAYBE\", per src/policy/rule/schema.ts's real validateRuleSet) -- whole load rejected, exit code 1 (SAME exit code as the JSON-parse-error case above -- 'structurally identical in kind'), distinct schema-invalid reason", () => {
  const result: PrinterResult = printEffectivePolicy(
    baseInput(centralSourceReturning({ status: "present", raw: CENTRAL_SCHEMA_INVALID_RAW, channel: CENTRAL_CHANNEL })),
  );
  assert.equal(result.exitCode, 1, `expected exit code 1 for schema-invalid central content (fail-closed); stdout=${result.stdout}`);
  buildExpectedRejectionStdout(`central-channel status=present channel=${CENTRAL_CHANNEL}`, "central", "schema-invalid", /./)(result.stdout);
});

// --- AC5c: CentralPolicySource.read() itself throws (simulated subprocess/timeout failure) ---

test("AC5c: centralSource.read() itself THROWS (simulated reg-query subprocess failure/timeout/oversized-output) -- whole load rejected, exit code 1, distinct read-error reason, NEVER silently treated as absent", () => {
  const result: PrinterResult = printEffectivePolicy(
    baseInput(centralSourceThrowing("simulated: reg query exited with code 1 (subprocess failure fixture)")),
  );
  assert.equal(result.exitCode, 1, `expected exit code 1 when the injected CentralPolicySource itself throws (fail-closed, never silently absent); stdout=${result.stdout}`);
  buildExpectedRejectionStdout("central-channel status=read-error", "central", "read-error", /./)(result.stdout);
});

// --- Issue #108 [MED] amendment (2026-09-08, red-team round 4): a rejection caused by a NON- ---
// central layer must never claim the central channel failed. Two new regression tests below,
// immediately after the existing AC5c test (see INTERPRETATION CHOICE 6 above for full history).

test("ISSUE-108(a): central channel ABSENT and wholly uninvolved, but the PROJECT layer itself fails to parse (a real UTF-8 BOM, this Issue's own repro: PowerShell 5.1 Out-File -Encoding utf8 / Notepad 'UTF-8 with BOM') -- the rejection must name the PROJECT layer, NEVER claim 'central policy load failed'; exit code 1, fail-closed, no rule data leaks", () => {
  const result: PrinterResult = printEffectivePolicy({
    shippedDefaultsPath: SHIPPED_DEFAULTS_PATH,
    projectPolicyPath: PROJECT_BOM_MALFORMED_PATH,
    centralSource: centralSourceReturning({ status: "absent" }),
  });
  assert.equal(result.exitCode, 1, `expected exit code 1 for a PROJECT-layer parse failure (fail-closed); stdout=${result.stdout}`);
  buildExpectedRejectionStdout("central-channel status=absent", "project", "json-parse-error", /./)(result.stdout);
  assert.doesNotMatch(result.stdout, /REJECTED: central policy load failed/, `expected the rejection to NEVER claim "central policy load failed" when central was absent and uninvolved -- the PROJECT layer is the true offender; got:\n${result.stdout}`);
});

test("ISSUE-108(b): central channel ABSENT and wholly uninvolved, but the SHIPPED-DEFAULTS layer itself fails to parse -- the rejection must name the SHIPPED-DEFAULTS layer, NEVER claim 'central policy load failed'; exit code 1, fail-closed, no rule data leaks (symmetric case completing this Issue's own 'central / shipped-defaults / project' scope -- see INTERPRETATION CHOICE 6 above)", () => {
  const result: PrinterResult = printEffectivePolicy({
    shippedDefaultsPath: SHIPPED_DEFAULTS_MALFORMED_PATH,
    projectPolicyPath: PROJECT_POLICY_PATH,
    centralSource: centralSourceReturning({ status: "absent" }),
  });
  assert.equal(result.exitCode, 1, `expected exit code 1 for a SHIPPED-DEFAULTS-layer parse failure (fail-closed); stdout=${result.stdout}`);
  buildExpectedRejectionStdout("central-channel status=absent", "shipped-defaults", "json-parse-error", /./)(result.stdout);
  assert.doesNotMatch(result.stdout, /REJECTED: central policy load failed/, `expected the rejection to NEVER claim "central policy load failed" when central was absent and uninvolved -- the SHIPPED-DEFAULTS layer is the true offender; got:\n${result.stdout}`);
});

// --- AC5a/AC5b/AC5c table test: every state pairwise distinguishable, none collapses into the --
// non-rejecting "absent" bucket (this pass's own dispatch instructions, echoing AC5c's own text) --

test("AC5a/AC5b/AC5c table: absent, unsupported, present-valid, malformed-json, schema-invalid, and read-error are ALL pairwise distinguishable by their FULL (exit code + stdout) rendering, and EXACTLY the three fail-closed states share exit code 1 while the other three share exit code 0 -- no fail-closed state collapses into the absent/non-rejecting bucket. NOTE: the central-channel status LINE ALONE is deliberately NOT required to be pairwise distinct across all six -- present-valid, malformed-json and schema-invalid all genuinely read status=\"present\" with the SAME channel (the read itself succeeded identically in all three; only the CONTENT's validity differs), so they legitimately share line 1 by this file's own grammar. They remain fully distinguishable once line 2 (rule listing vs. REJECTED reason) is included, which is what an operator actually reads.", () => {
  const cases: { label: string; input: PrinterInput; expectExitCode: 0 | 1 }[] = [
    { label: "absent", input: baseInput(centralSourceReturning({ status: "absent" })), expectExitCode: 0 },
    { label: "unsupported", input: baseInput(centralSourceReturning({ status: "unsupported" })), expectExitCode: 0 },
    { label: "present-valid", input: baseInput(centralSourceReturning({ status: "present", raw: CENTRAL_VALID_RAW, channel: CENTRAL_CHANNEL })), expectExitCode: 0 },
    { label: "malformed-json", input: baseInput(centralSourceReturning({ status: "present", raw: CENTRAL_MALFORMED_JSON_RAW, channel: CENTRAL_CHANNEL })), expectExitCode: 1 },
    { label: "schema-invalid", input: baseInput(centralSourceReturning({ status: "present", raw: CENTRAL_SCHEMA_INVALID_RAW, channel: CENTRAL_CHANNEL })), expectExitCode: 1 },
    { label: "read-error", input: baseInput(centralSourceThrowing("simulated subprocess failure")), expectExitCode: 1 },
  ];

  const renderings = new Map<string, string>();
  for (const c of cases) {
    const result = printEffectivePolicy(c.input);
    assert.equal(result.exitCode, c.expectExitCode, `case "${c.label}": expected exit code ${c.expectExitCode}; got ${result.exitCode}, stdout=${result.stdout}`);
    renderings.set(c.label, `${result.exitCode}\n${result.stdout}`);
  }

  const seen = new Set<string>();
  for (const [label, rendering] of renderings) {
    assert.ok(!seen.has(rendering), `expected every case's full (exit code + stdout) rendering to be pairwise distinct; "${label}" collided with an earlier case on:\n${rendering}`);
    seen.add(rendering);
  }
  assert.equal(seen.size, cases.length, "expected exactly one distinct full rendering per case (six total) -- an operator can always tell the six states apart by reading the whole output, even when two states happen to share line 1");
});

// --- AC3: the printer ships a runnable entry point (npm run policy:print, per this task's own ---
// authorization to name the command since the plan only said "or similar") --------------------

test("AC3: package.json defines a policy:print script, and the file it points at exists in this repo (the printer's 'runnable entry point' named in the plan's own file list) -- NOT executed here (that would either touch the real registry, out of this file's scope per §3a, or require the disclaimed fixture-injection seam, see INTERPRETATION CHOICE 3 above)", () => {
  const packageJsonPath = path.join(REPO_ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
  const script = pkg.scripts?.["policy:print"];
  assert.ok(typeof script === "string" && script.length > 0, `expected package.json's scripts to define "policy:print"; got scripts=${JSON.stringify(pkg.scripts)}`);

  // The script is expected to be a bare `node <path>` invocation, matching this repo's own
  // existing `qa:*` script convention (see package.json's other entries, all `node src/qa/*.ts`).
  const match = /^node\s+(\S+)$/.exec(script);
  assert.ok(match, `expected "policy:print" to follow this repo's own "node <path>" script convention (see the qa:* scripts already in package.json); got: ${script}`);
  const targetRelative = match?.[1] ?? "";
  const targetAbsolute = path.join(REPO_ROOT, targetRelative);
  assert.ok(existsSync(targetAbsolute), `expected the file "policy:print" points at to exist: ${targetAbsolute} (from script: ${script})`);
});
