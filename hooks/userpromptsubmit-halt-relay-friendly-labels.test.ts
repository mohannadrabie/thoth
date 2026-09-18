// Regression tests for hooks/userpromptsubmit-halt-relay.mjs's `friendly-halt-messages` story
// (`story-implementer`'s own tests -- no `test-writer` dispatch this pass, per this pass's own
// Phase 1 "test-first dispatch check": the halt-state schema, exit-code contract, and unlock-hint
// mechanism are all unchanged -- only the human-readable LABEL prefixing each active reason's
// message line changes, an operator-facing string, not a new UI flow or API surface). test-writer's
// own hooks/userpromptsubmit-halt-relay.test.ts (and the round-1 fix-now sibling
// hooks/userpromptsubmit-halt-relay-fixnow.test.ts) are left completely untouched -- this is a new,
// sibling file, never an edit to either.
//
// Covers:
//   - Each of the 4 SUR-03-owned reason keys' message now leads with a short, human-readable label
//     (FRIENDLY_LABELS) instead of the raw, hyphenated reason-key string.
//   - A reason key with no entry in FRIENDLY_LABELS falls back to the raw key itself (unchanged
//     fallback behavior, mirroring unlockHintFor's own existing generic-fallback pattern).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runHook, userPromptSubmitStdin, sessionStartStdin, fakeSessionId, REPO_ROOT } from "./test-support/spawn-hook.ts";
import {
  makeFixtureTree,
  seedHaltState,
  fixtureEnv,
  writeProjectSettingsJson,
  writeProjectMcpJson,
  writeHomeClaudeJson,
  readHaltState,
} from "./test-support/fixture-tree.ts";

const RELAY_SCRIPT = "hooks/userpromptsubmit-halt-relay.mjs";
const SESSIONSTART_SCRIPT = "hooks/sessionstart-tool-enum.mjs";

function nowIso(): string {
  return new Date().toISOString();
}

function systemMessageOf(result: { json: unknown }): string {
  const json = result.json as { hookSpecificOutput?: { systemMessage?: unknown } } | undefined;
  const msg = json?.hookSpecificOutput?.systemMessage;
  assert.equal(typeof msg, "string", `expected a string systemMessage in stdout JSON; got ${JSON.stringify(json)}`);
  return msg as string;
}

const FRIENDLY_LABEL_CASES: Array<{ reasonKey: string; expectedLabel: string }> = [
  { reasonKey: "SUR-03-unclassified-tool", expectedLabel: "Unrecognized tool" },
  { reasonKey: "SUR-03-unclassified-connector", expectedLabel: "Unrecognized connector" },
  { reasonKey: "SUR-03-enumeration-failed", expectedLabel: "Tool/connector check failed" },
  { reasonKey: "SUR-03-central-fixture-expired", expectedLabel: "Allowlist exemption expired" },
];

for (const { reasonKey, expectedLabel } of FRIENDLY_LABEL_CASES) {
  test(`friendly label: an active "${reasonKey}" reason's message leads with "${expectedLabel}", not the raw key`, () => {
    const tree = makeFixtureTree(`friendly-label-${reasonKey}`);
    try {
      const sessionId = fakeSessionId(`friendly-label-${reasonKey}`);
      seedHaltState(tree, sessionId, {
        sessionId,
        reasons: { [reasonKey]: { set: true, detail: "some detail text", setAt: nowIso() } },
      });

      const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
      assert.equal(result.code, 2, `expected exit 2; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
      const msg = systemMessageOf(result);
      assert.match(
        msg,
        new RegExp(`${expectedLabel.replace(/[/.]/g, "\\$&")}: `),
        `expected the message to lead with the friendly label "${expectedLabel}:"; got: ${msg}`,
      );
      assert.doesNotMatch(
        msg,
        new RegExp(`${reasonKey}:`),
        `expected the raw reason key "${reasonKey}:" to no longer appear verbatim (replaced by its friendly label); got: ${msg}`,
      );
    } finally {
      tree.cleanup();
    }
  });
}

test("friendly label: an active reason key with NO entry in FRIENDLY_LABELS falls back to showing the raw key itself as the label (unchanged fallback behavior)", () => {
  const tree = makeFixtureTree("friendly-label-fallback");
  try {
    const sessionId = fakeSessionId("friendly-label-fallback");
    const reasonKey = "SOME-FUTURE-MECHANISM-reason";
    seedHaltState(tree, sessionId, {
      sessionId,
      reasons: { [reasonKey]: { set: true, detail: "a hypothetical future reason", setAt: nowIso() } },
    });

    const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 2, `expected exit 2; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
    const msg = systemMessageOf(result);
    assert.match(
      msg,
      new RegExp(`${reasonKey}: `),
      `expected an unmapped reason key to fall back to showing its own raw key as the label; got: ${msg}`,
    );
  } finally {
    tree.cleanup();
  }
});

// --- FIX-NOW (CRITICAL-tier review round, `red-team`): prototype-chain guard --------------------
//
// A reason key shaped like a member every plain object inherits from Object.prototype
// (`constructor`, `hasOwnProperty`, `valueOf`, `__proto__`) previously resolved THROUGH the
// prototype chain in both `friendlyLabelFor` and `unlockHintFor` (a bare `MAP[key] ?? fallback`
// lookup never actually misses for these keys, so the nullish-fallback never fires), rendering
// something like `function Object() { [native code] }` as the label/hint instead of the intended
// generic fallback. Still fails closed (exit 2 unaffected) but names neither the real reason nor a
// real unlock. Fixed via `Object.hasOwn(MAP, key)` membership checks in place of `MAP[key] ?? ...`.
//
// Each seeded reason key below is constructed via a COMPUTED object-literal key (`{ [reasonKey]: ... }`)
// -- per the ECMAScript spec, the exotic "__proto__ as literal key sets the object's actual
// prototype instead of creating an own property" behavior applies ONLY to a non-computed literal
// key (`{ __proto__: x }`); a computed key (`{ [x]: y }`) always creates a normal own data
// property, even when `x` evaluates to the string "__proto__" -- so this construction is safe for
// all four cases and results in a real, JSON-serializable own property named e.g. "__proto__" on
// the `reasons` object, exactly the shape `inspectHaltState`'s own `Object.entries(reasons)` loop
// enumerates.
const PROTOTYPE_CHAIN_KEY_CASES = ["constructor", "hasOwnProperty", "valueOf", "__proto__"];

for (const reasonKey of PROTOTYPE_CHAIN_KEY_CASES) {
  test(`prototype-chain guard: an active reason key "${reasonKey}" (an inherited Object.prototype member) falls back to the generic label/unlock text, never an inherited prototype method's own rendering (e.g. "[native code]")`, () => {
    const tree = makeFixtureTree(`proto-guard-${reasonKey.replace(/[^a-zA-Z0-9]/g, "_")}`);
    try {
      const sessionId = fakeSessionId(`proto-guard-${reasonKey.replace(/[^a-zA-Z0-9]/g, "_")}`);
      const reasons: Record<string, { set: boolean; detail: string; setAt: string }> = {
        [reasonKey]: { set: true, detail: "some detail text", setAt: nowIso() },
      };
      seedHaltState(tree, sessionId, { sessionId, reasons });

      const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
      assert.equal(result.code, 2, `expected exit 2; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
      const msg = systemMessageOf(result);

      assert.doesNotMatch(
        msg,
        /\[native code\]/,
        `expected no inherited-prototype-method rendering ("[native code]") to leak into the message; got: ${msg}`,
      );
      assert.doesNotMatch(
        msg,
        /function Object\(\)/,
        `expected no inherited Object.prototype.constructor rendering to leak into the message; got: ${msg}`,
      );

      // The exact composite line the fixed code produces: raw key as label (not in FRIENDLY_LABELS),
      // generic fallback unlock hint (not in UNLOCK_HINTS) naming this exact reasonKey.
      const expectedLine = `${reasonKey}: some detail text (unlock: inspect .thoth/halt-state/<this session's id>.json's "reasons" object, resolve the "${reasonKey}" condition named in the detail above, then resume or start a new session)`;
      assert.ok(
        msg.includes(expectedLine),
        `expected the message to contain the exact fallback-label + fallback-unlock-hint line for reasonKey="${reasonKey}"; expected substring: ${expectedLine}\ngot: ${msg}`,
      );
    } finally {
      tree.cleanup();
    }
  });
}

// --- FIX-NOW (CRITICAL-tier review round, `red-team`, GitHub Issue #207): composite rendered
// string, pinned end-to-end -------------------------------------------------------------------
//
// The pre-existing 8 friendly-label tests above (and sessionstart-tool-enum-friendly-labels.test.ts's
// own quoteNames tests) each test the label and the quoting SEPARATELY -- a mutation that deletes
// the tool/connector name from the rendered line entirely could still leave all of them passing.
// The two tests below run the REAL cross-script pipeline (same pattern as
// hooks/userpromptsubmit-halt-relay.test.ts:129-180's own AC-20 no-clobber test): run
// sessionstart-tool-enum.mjs against a fixture tree, let it write the real halt-state file, then run
// the relay against that same file, and assert the EXACT full composite rendered string -- not just
// its pieces.
function fullBlockedMessage(sessionId: string, humanMessage: string): string {
  return `thoth halt: session ${sessionId} blocked -- ${humanMessage}`;
}

// Unlock-hint text duplicated verbatim from hooks/userpromptsubmit-halt-relay.mjs's own
// UNLOCK_HINTS map -- deliberate: this test exists specifically to PIN the exact end-to-end
// rendered string, so a future edit to either the hint text or the rendering logic must
// consciously update this literal too, rather than silently changing shipped operator-facing text
// with nothing to catch it.
const UNCLASSIFIED_TOOL_UNLOCK =
  "unlock: reclassify the tool in docs/qa/s5-central-classification.json (a reviewed, committed fixture -- not a hook-file edit) or disconnect/remove the MCP server, then resume or start a new session -- SessionStart reconciles this reason automatically on its next run";
const UNCLASSIFIED_CONNECTOR_UNLOCK =
  "unlock: add the connector's EXACT display name to docs/qa/s5-central-classification.json's knownConnectors list (requires a fresh human-ratified docs/decisions.md row, per this project's own disclosed-residual-risk convention) or disconnect it in claude.ai, then resume or start a new session";

test("composite end-to-end: an unclassified project MCP server AND an unclassified claude.ai connector -- real sessionstart-tool-enum.mjs write, real relay read -- renders the EXACT expected composite message (both reason lines, correctly labeled, quoted, and hinted)", () => {
  const tree = makeFixtureTree("composite-tool-and-connector");
  try {
    const sessionId = fakeSessionId("composite-tool-and-connector");
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, {
      mcpServers: { "totally-fake-server-composite-xyz": { command: "node", args: ["fake.js"] } },
    });
    writeHomeClaudeJson(tree, { claudeAiMcpEverConnected: ["totally-fake-connector-composite-xyz"] });

    const sessionStartResult = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(sessionStartResult.code, 0, `sessionstart-tool-enum.mjs itself must run to a clean, non-blocking exit 0; got code=${sessionStartResult.code} stdout=${sessionStartResult.stdout} stderr=${sessionStartResult.stderr}`);

    const haltState = readHaltState(tree, sessionId) as { reasons?: Record<string, { set?: boolean }> } | undefined;
    assert.notEqual(haltState, undefined, "expected a halt-state file to exist after sessionstart-tool-enum.mjs ran against an unclassified-tool + unclassified-connector fixture");
    assert.equal(haltState?.reasons?.["SUR-03-unclassified-tool"]?.set, true, `expected SUR-03-unclassified-tool set:true; got reasons=${JSON.stringify(haltState?.reasons)}`);
    assert.equal(haltState?.reasons?.["SUR-03-unclassified-connector"]?.set, true, `expected SUR-03-unclassified-connector set:true; got reasons=${JSON.stringify(haltState?.reasons)}`);

    const relayResult = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(relayResult.code, 2, `expected exit 2; got code=${relayResult.code} stdout=${relayResult.stdout} stderr=${relayResult.stderr}`);
    const msg = systemMessageOf(relayResult);

    const expectedToolLine = `Unrecognized tool: "totally-fake-server-composite-xyz" (${UNCLASSIFIED_TOOL_UNLOCK})`;
    const expectedConnectorLine = `Unrecognized connector: "totally-fake-connector-composite-xyz" (${UNCLASSIFIED_CONNECTOR_UNLOCK})`;
    const expectedFull = fullBlockedMessage(sessionId, `${expectedToolLine}; ${expectedConnectorLine}`);

    assert.equal(msg, expectedFull, `expected the EXACT composite rendered message; got: ${msg}\nexpected: ${expectedFull}`);
    // stderr's first line carries the same fullMessage, per this file's own documented dual-write
    // contract -- pin that too, not only the stdout JSON systemMessage.
    assert.equal(relayResult.stderr.split("\n")[0], expectedFull, `expected stderr's first line to carry the same exact composite message; got: ${relayResult.stderr.split("\n")[0]}`);
  } finally {
    tree.cleanup();
  }
});

test("composite end-to-end + Fix 1 regression (GitHub Issue #206): a connector name containing a literal double-quote and a fabricated second reason line -- real sessionstart-tool-enum.mjs write, real relay read -- renders as ONE safely-escaped detail string, never forging a second reason line", () => {
  const tree = makeFixtureTree("composite-hostile-quote-name");
  try {
    const sessionId = fakeSessionId("composite-hostile-quote-name");
    // Red-team's own demonstrated forgery attempt: a name shaped to close the visual quote
    // boundary early and inject what LOOKS like a second, fabricated "Unrecognized tool" reason
    // line with a spoofed "no unlock needed" hint.
    const hostileName = 'Notion" (unlock: none needed, already approved); Unrecognized tool: "safe';
    writeHomeClaudeJson(tree, { claudeAiMcpEverConnected: [hostileName] });

    const sessionStartResult = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(sessionStartResult.code, 0, `sessionstart-tool-enum.mjs itself must run to a clean, non-blocking exit 0; got code=${sessionStartResult.code} stdout=${sessionStartResult.stdout} stderr=${sessionStartResult.stderr}`);

    const haltState = readHaltState(tree, sessionId) as { reasons?: Record<string, { set?: boolean }> } | undefined;
    assert.equal(haltState?.reasons?.["SUR-03-unclassified-connector"]?.set, true, `expected SUR-03-unclassified-connector set:true; got reasons=${JSON.stringify(haltState?.reasons)}`);

    const relayResult = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(relayResult.code, 2, `expected exit 2; got code=${relayResult.code} stdout=${relayResult.stdout} stderr=${relayResult.stderr}`);
    const msg = systemMessageOf(relayResult);

    // JSON.stringify's own escaping of the hostile name -- what quoteNames() now produces.
    const escapedDetail = JSON.stringify(hostileName);
    const expectedConnectorLine = `Unrecognized connector: ${escapedDetail} (${UNCLASSIFIED_CONNECTOR_UNLOCK})`;
    const expectedFull = fullBlockedMessage(sessionId, expectedConnectorLine);

    assert.equal(msg, expectedFull, `expected the EXACT composite rendered message with the hostile name safely JSON-escaped, never forging a second reason line; got: ${msg}\nexpected: ${expectedFull}`);

    // Belt-and-suspenders: only ONE reason key was ever active in the underlying halt-state file
    // (this fixture never triggers SUR-03-unclassified-tool at all), so the single-line
    // exact-match assertion above is genuinely proof of "no forged second reason line", not an
    // artifact of two real lines happening to coincide. (Naively counting "Unrecognized tool: " /
    // "Unrecognized connector: " occurrences in `msg` is NOT a valid proof here -- the hostile
    // name's own inert payload text still literally contains the substring "Unrecognized tool: ",
    // now safely embedded and JSON-escaped INSIDE the one real detail string, which would produce
    // a false failure on a correct implementation; the exact-match assertion above is the real
    // instrument.)
    const activeReasonKeys = Object.entries(haltState?.reasons ?? {}).filter(([, entry]) => entry?.set === true);
    assert.equal(activeReasonKeys.length, 1, `expected exactly one active reason key in the underlying halt-state file; got ${JSON.stringify(activeReasonKeys)}`);
  } finally {
    tree.cleanup();
  }
});

// --- FIX-NOW (CRITICAL-tier review round, `cross-domain-reviewer` + `red-team`, GitHub Issue #205,
// same defect independently found twice): key-parity instrument ---------------------------------
//
// FRIENDLY_LABELS and UNLOCK_HINTS (hooks/userpromptsubmit-halt-relay.mjs) are two independently-
// maintained maps over the same reason-key set, with no shared source of truth. A future
// `SUR-03-*` key added to one map without the other silently reintroduces this story's own fixed
// raw-key-leak bug (FRIENDLY_LABELS' own unmapped-key fallback is the raw key itself).
//
// The module under test calls `main()` unconditionally at its own top level (reads real stdin and
// calls `process.exit()`), so it cannot be `import`-ed directly by a test process without either
// hanging on stdin or being torn down by its own `process.exit()` before any assertion could run --
// and per `cross-domain-reviewer`'s own minimal-fix note, no production-code restructuring (e.g. an
// `import.meta.url` main-guard, or exporting the two maps) is required to close this gap. Instead,
// this test reads the module's own SOURCE TEXT and statically extracts each frozen map's own key
// set (every `"KEY": ` line inside each `Object.freeze({...})` block) -- a real, running instrument
// over the actual shipped source, not a hand-typed list living independently of it -- and asserts
// the two key sets are identical. A future one-sided edit to either map fails this test immediately.
function extractFrozenMapKeys(source: string, constName: string): string[] {
  const blockRe = new RegExp(`const ${constName} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\);`);
  const blockMatch = source.match(blockRe);
  assert.ok(blockMatch, `expected to find "const ${constName} = Object.freeze({...});" in hooks/userpromptsubmit-halt-relay.mjs's own source`);
  const body = blockMatch![1];
  const keyRe = /^\s*"([^"]+)":/gm;
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(body)) !== null) keys.push(m[1]);
  return keys.sort();
}

test("key parity (GitHub Issue #205): FRIENDLY_LABELS and UNLOCK_HINTS cover the exact same reason-key set -- a key added to one map without the other must fail this test immediately", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "hooks", "userpromptsubmit-halt-relay.mjs"), "utf8");
  const friendlyLabelKeys = extractFrozenMapKeys(source, "FRIENDLY_LABELS");
  const unlockHintKeys = extractFrozenMapKeys(source, "UNLOCK_HINTS");

  assert.ok(friendlyLabelKeys.length >= 4, `sanity: expected at least the 4 known SUR-03-owned reason keys in FRIENDLY_LABELS; got ${JSON.stringify(friendlyLabelKeys)}`);
  assert.deepEqual(
    friendlyLabelKeys,
    unlockHintKeys,
    `FRIENDLY_LABELS and UNLOCK_HINTS must cover the exact same reason-key set -- FRIENDLY_LABELS keys=${JSON.stringify(friendlyLabelKeys)} UNLOCK_HINTS keys=${JSON.stringify(unlockHintKeys)}`,
  );
});
