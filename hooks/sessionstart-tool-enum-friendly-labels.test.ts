// Regression tests for hooks/sessionstart-tool-enum.mjs's `friendly-halt-messages` story
// (`story-implementer`'s own tests -- no `test-writer` dispatch this pass, same rationale as this
// file's userpromptsubmit-halt-relay sibling: the halt-state schema and reconciliation logic are
// unchanged -- only the DETAIL text's shape changes, at the two reconcileReason(...) call sites for
// SUR-03-unclassified-tool/-connector: names are now individually double-quoted and the redundant
// "unclassified:"/"connector identity present:" prefixes are dropped, since
// hooks/userpromptsubmit-halt-relay.mjs's own new FRIENDLY_LABELS prefix now carries that meaning).
// test-writer's own hooks/sessionstart-tool-enum.test.ts (and the round-1/round-2 fix-now sibling
// hooks/sessionstart-tool-enum-fixnow.test.ts) are left completely untouched -- this is a new,
// sibling file, never an edit to either.
//
// ENUMERATION_FAILED_REASON_KEY / FIXTURE_EXPIRED_REASON_KEY detail construction is untouched per
// this pass's own plan -- not covered here (already covered by the fixnow sibling file / the
// friendly-label-prefix regression above in the relay's own test file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook, sessionStartStdin, fakeSessionId } from "./test-support/spawn-hook.ts";
import { makeFixtureTree, writeProjectMcpJson, writeProjectSettingsJson, writeHomeClaudeJson, readHaltState, fixtureEnv } from "./test-support/fixture-tree.ts";

const SESSIONSTART_SCRIPT = "hooks/sessionstart-tool-enum.mjs";

function reasonsOf(haltState: unknown): Record<string, { detail?: unknown; set?: unknown }> {
  if (typeof haltState !== "object" || haltState === null) return {};
  const reasons = (haltState as Record<string, unknown>).reasons;
  return typeof reasons === "object" && reasons !== null ? (reasons as Record<string, { detail?: unknown; set?: unknown }>) : {};
}

test("quoteNames: an unclassified project .mcp.json server's detail text individually double-quotes the server name and drops the redundant 'unclassified:' prefix", () => {
  const tree = makeFixtureTree("quote-names-unclassified-tool");
  try {
    const sessionId = fakeSessionId("quote-names-unclassified-tool");
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, {
      mcpServers: { "totally-fake-server-xyz": { command: "node", args: ["fake.js"] } },
    });

    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 0, `SessionStart itself must never block session start; got code=${result.code} stderr=${result.stderr}`);

    const reasons = reasonsOf(readHaltState(tree, sessionId));
    const entry = reasons["SUR-03-unclassified-tool"];
    assert.equal(entry?.set, true, `expected SUR-03-unclassified-tool to be set:true; got reasons=${JSON.stringify(reasons)}`);
    const detail = String(entry?.detail ?? "");
    assert.match(detail, /"totally-fake-server-xyz"/, `expected the server name to be individually double-quoted; got detail=${detail}`);
    assert.doesNotMatch(detail, /^unclassified:/, `expected the redundant "unclassified:" prefix to be dropped (the relay's own friendly label now carries that meaning); got detail=${detail}`);
  } finally {
    tree.cleanup();
  }
});

test("quoteNames: an unclassified claude.ai connector's detail text individually double-quotes the connector name and drops the redundant 'connector identity present:' prefix", () => {
  const tree = makeFixtureTree("quote-names-unclassified-connector");
  try {
    const sessionId = fakeSessionId("quote-names-unclassified-connector");
    writeHomeClaudeJson(tree, { claudeAiMcpEverConnected: ["totally-fake-connector-xyz"] });

    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 0, `SessionStart itself must never block session start; got code=${result.code} stderr=${result.stderr}`);

    const reasons = reasonsOf(readHaltState(tree, sessionId));
    const entry = reasons["SUR-03-unclassified-connector"];
    assert.equal(entry?.set, true, `expected SUR-03-unclassified-connector to be set:true; got reasons=${JSON.stringify(reasons)}`);
    const detail = String(entry?.detail ?? "");
    assert.match(detail, /"totally-fake-connector-xyz"/, `expected the connector name to be individually double-quoted; got detail=${detail}`);
    assert.doesNotMatch(detail, /^connector identity present:/, `expected the redundant "connector identity present:" prefix to be dropped; got detail=${detail}`);
  } finally {
    tree.cleanup();
  }
});

test("quoteNames: multiple unclassified names are each individually double-quoted and comma-separated", () => {
  const tree = makeFixtureTree("quote-names-multiple");
  try {
    const sessionId = fakeSessionId("quote-names-multiple");
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, {
      mcpServers: {
        "fake-server-one": { command: "node", args: ["one.js"] },
        "fake-server-two": { command: "node", args: ["two.js"] },
      },
    });

    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 0, `SessionStart itself must never block session start; got code=${result.code} stderr=${result.stderr}`);

    const reasons = reasonsOf(readHaltState(tree, sessionId));
    const entry = reasons["SUR-03-unclassified-tool"];
    assert.equal(entry?.set, true, `expected SUR-03-unclassified-tool to be set:true; got reasons=${JSON.stringify(reasons)}`);
    const detail = String(entry?.detail ?? "");
    assert.match(detail, /"fake-server-one"/, `expected fake-server-one to be individually double-quoted; got detail=${detail}`);
    assert.match(detail, /"fake-server-two"/, `expected fake-server-two to be individually double-quoted; got detail=${detail}`);
  } finally {
    tree.cleanup();
  }
});
