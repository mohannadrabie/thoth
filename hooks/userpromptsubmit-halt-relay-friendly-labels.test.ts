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
import { runHook, userPromptSubmitStdin, fakeSessionId } from "./test-support/spawn-hook.ts";
import { makeFixtureTree, seedHaltState, fixtureEnv } from "./test-support/fixture-tree.ts";

const RELAY_SCRIPT = "hooks/userpromptsubmit-halt-relay.mjs";

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
