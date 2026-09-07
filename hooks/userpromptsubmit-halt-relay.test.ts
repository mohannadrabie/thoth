// Black-box acceptance tests for `hooks/userpromptsubmit-halt-relay.mjs` -- written FIRST, before
// that file (or `hooks/sessionstart-tool-enum.mjs`, used below only as the "second writer" fixture
// for the no-clobber test) exists. The scripts do not exist yet; every test below is expected to
// fail with a "module/file not found" style error right now -- that IS the RED confirmation, not a
// test bug.
//
// Source of truth for the tests below:
//   - docs/plans/S5-phase1-2026-09-06.md (v3) acceptance criteria 4 (SUR-03's halt point is
//     UserPromptSubmit, ADR-0021 gap G5) and 20 (the halt-state file's schema is a small JSON
//     object keyed by reason, not a bare boolean/flag file -- additive by construction for S11b's
//     future second reason).
//   - Plan §5 "New files": "`hooks/userpromptsubmit-halt-relay.mjs` (unchanged from v2, criterion
//     20) -- reads the halt-state file for the current session_id; exit 2 if any reason's set is
//     true, else exit 0." Schema (quoted verbatim):
//       { "sessionId": "<uuid>", "reasons": { "SUR-03-unclassified-tool": { "set": true, "detail":
//         "unclassified: mcp__foo__bar", "setAt": "<ISO-8601>" } } }
//       at `${CLAUDE_PROJECT_DIR}/.thoth/halt-state/<session_id>.json`. "Each writer owns one key
//       under `reasons`, additive by construction."
//   - Claude Code's documented UserPromptSubmit hook contract (code.claude.com/docs/en/hooks,
//     confirmed this session): stdin carries `session_id`, `hook_event_name: "UserPromptSubmit"`,
//     `prompt`; "exit 2 blocks [the prompt] and erases the prompt."
//
// INTERPRETATION CHOICE made explicit: "additive by construction... never clobbers" (criterion 20)
// is a property of a WRITER's own update logic, not of this relay script (the relay is read-only
// per its own plan description above -- it never writes the halt-state file). Since S5 ships only
// one real writer (`hooks/sessionstart-tool-enum.mjs`) and the plan explicitly defers a second real
// writer to S11b, the only way to black-box-test "two different mechanisms" today is: (a) seed one
// reason directly (`test-support/fixture-tree.ts`'s `seedHaltState`, built specifically for this --
// "simulating a reason already written by a DIFFERENT mechanism"), standing in for a hypothetical
// S11b-era writer, then (b) run the real `sessionstart-tool-enum.mjs` (this story's own writer)
// against a fixture that makes IT ALSO want to set a different reason, then (c) assert both reasons
// survive in the file afterward, and that this relay still exits 2 against the combined file. This
// is the closest faithful test of "additive by construction" available without inventing a second
// hook script that isn't part of this story.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook, userPromptSubmitStdin, sessionStartStdin, fakeSessionId } from "./test-support/spawn-hook.ts";
import {
  makeFixtureTree,
  writeProjectSettingsJson,
  writeProjectMcpJson,
  seedHaltState,
  readHaltState,
  fixtureEnv,
} from "./test-support/fixture-tree.ts";

const RELAY_SCRIPT = "hooks/userpromptsubmit-halt-relay.mjs";
const SESSIONSTART_SCRIPT = "hooks/sessionstart-tool-enum.mjs";

function nowIso(): string {
  return new Date().toISOString();
}

// --- AC-4/AC-20: a halt-state file present with a set reason for the current session blocks ----

test("AC-4/AC-20: a halt-state file present for the current session_id with a reason set:true -> exit 2 (blocks the prompt)", () => {
  const tree = makeFixtureTree("relay-halt-present");
  try {
    const sessionId = fakeSessionId("relay-halt-present");
    seedHaltState(tree, sessionId, {
      sessionId,
      reasons: {
        "SUR-03-unclassified-tool": { set: true, detail: "unclassified: mcp__foo__bar", setAt: nowIso() },
      },
    });

    const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));

    assert.equal(result.code, 2, `expected exit 2 (blocks the prompt per Claude Code's documented UserPromptSubmit contract) when a halt reason is set:true; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    tree.cleanup();
  }
});

test("AC-4/AC-20: a halt-state file present but with its ONLY reason set:false does not block -> exit 0 (a cleared/not-yet-triggered reason must not be treated as an active halt)", () => {
  const tree = makeFixtureTree("relay-halt-not-set");
  try {
    const sessionId = fakeSessionId("relay-halt-not-set");
    seedHaltState(tree, sessionId, {
      sessionId,
      reasons: {
        "SUR-03-unclassified-tool": { set: false, detail: "previously unclassified, now resolved", setAt: nowIso() },
      },
    });

    const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));

    assert.equal(result.code, 0, `expected exit 0 when the only reason present has set:false; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    tree.cleanup();
  }
});

// --- AC-4/AC-20: no halt-state file at all does not block ---------------------------------------

test("AC-4/AC-20: no halt-state file exists for this session_id (fresh, unconfigured fixture tree) -> exit 0 (does not block the prompt)", () => {
  const tree = makeFixtureTree("relay-no-halt-file");
  try {
    const sessionId = fakeSessionId("relay-no-halt-file");

    const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));

    assert.equal(result.code, 0, `expected exit 0 when no halt-state file exists at all; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    tree.cleanup();
  }
});

test("AC-4/AC-20: a halt-state file exists for a DIFFERENT session_id only -> exit 0 for this session (session isolation: one session's halt must never block another session's prompt)", () => {
  const tree = makeFixtureTree("relay-different-session");
  try {
    const haltedSessionId = fakeSessionId("relay-other-session-halted");
    const thisSessionId = fakeSessionId("relay-this-session-clean");
    seedHaltState(tree, haltedSessionId, {
      sessionId: haltedSessionId,
      reasons: { "SUR-03-unclassified-tool": { set: true, detail: "unclassified: mcp__foo__bar", setAt: nowIso() } },
    });

    const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId: thisSessionId }), fixtureEnv(tree));

    assert.equal(result.code, 0, `a halt-state file for a DIFFERENT session_id must not block this session's prompt; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    tree.cleanup();
  }
});

// --- AC-20: two reasons written by two different mechanisms -- neither clobbers the other -------

test("AC-20: a reason pre-seeded by a different mechanism survives sessionstart-tool-enum.mjs's own later write of a second reason -- both present afterward, additive by construction, and the relay still blocks", () => {
  const tree = makeFixtureTree("relay-multi-reason-no-clobber");
  try {
    const sessionId = fakeSessionId("relay-multi-reason");
    // Mechanism A (stands in for a hypothetical S11b-era writer, per this file's header comment):
    // pre-seed an unrelated reason key directly.
    seedHaltState(tree, sessionId, {
      sessionId,
      reasons: {
        "S11B-FUTURE-MECHANISM-reason": { set: true, detail: "seeded by a different mechanism", setAt: nowIso() },
      },
    });

    // Mechanism B: this story's own real writer, sessionstart-tool-enum.mjs, run against a fixture
    // guaranteed to make IT ALSO want to set its own reason (a novel, unclassifiable MCP server --
    // see hooks/sessionstart-tool-enum.test.ts's own header comment for why this fixture shape is
    // deterministic).
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, {
      mcpServers: { "yet-another-fake-server": { command: "node", args: ["fake3.js"] } },
    });
    const sessionStartResult = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    // Asserting `code === 0` (not merely `!== 2`) here is deliberate: a script that does not exist
    // at all also satisfies "code !== 2" (module-not-found exits 1), which would let this whole test
    // limp forward on a false premise instead of failing clearly at the point of the real cause. See
    // hooks/sessionstart-tool-enum.test.ts's own equivalent note.
    assert.equal(sessionStartResult.code, 0, `sessionstart-tool-enum.mjs itself must run to a clean, non-blocking exit 0; got code=${sessionStartResult.code} stdout=${sessionStartResult.stdout} stderr=${sessionStartResult.stderr}`);

    const haltState = readHaltState(tree, sessionId) as { reasons?: Record<string, { set?: boolean }> } | undefined;
    assert.notEqual(haltState, undefined, `expected a halt-state file to exist after sessionstart-tool-enum.mjs ran against an unclassifiable-MCP-server fixture; stdout=${sessionStartResult.stdout} stderr=${sessionStartResult.stderr}`);
    const reasons = haltState?.reasons ?? {};
    assert.equal(
      reasons["S11B-FUTURE-MECHANISM-reason"]?.set,
      true,
      `mechanism A's pre-seeded reason must survive mechanism B's own write untouched (additive by construction, criterion 20) -- got reasons=${JSON.stringify(reasons)}`,
    );
    const mechanismBWroteSomethingElse = Object.keys(reasons).some(
      (key) => key !== "S11B-FUTURE-MECHANISM-reason" && reasons[key]?.set === true,
    );
    assert.equal(
      mechanismBWroteSomethingElse,
      true,
      `expected sessionstart-tool-enum.mjs to have added its OWN reason key alongside mechanism A's (proving this is a real merge, not merely "mechanism A's write happened to survive because mechanism B wrote nothing") -- got reasons=${JSON.stringify(reasons)}`,
    );

    // Finally: the relay, reading this same two-reason file, must still block -- unconfused by
    // multiple simultaneously-set reasons.
    const relayResult = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(relayResult.code, 2, `expected exit 2 -- the relay must block on ANY reason being set:true, including when multiple reasons from different mechanisms are present simultaneously; got code=${relayResult.code} stdout=${relayResult.stdout} stderr=${relayResult.stderr}`);
  } finally {
    tree.cleanup();
  }
});

// --- AC-4 (SUR-10-shaped fail-closed, symmetry with the other two hooks): malformed halt-state
// file content must not crash the relay into a bare non-blocking exit --------------------------

test("AC-4: a halt-state file that exists but contains malformed (non-JSON) content does not crash the relay into an uncaught, ambiguous exit -- fails closed (blocks) rather than silently proceeding", () => {
  const tree = makeFixtureTree("relay-malformed-haltstate");
  try {
    const sessionId = fakeSessionId("relay-malformed-haltstate");
    seedHaltState(tree, sessionId, "{ not actually valid JSON at all [[[ °");

    const result = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));

    assert.equal(result.code, 2, `a halt-state file that exists but fails to parse must fail CLOSED (block, exit 2) -- a bare non-blocking exit here would silently let a genuinely-set halt condition through if the file were merely truncated mid-write, not absent; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    tree.cleanup();
  }
});
