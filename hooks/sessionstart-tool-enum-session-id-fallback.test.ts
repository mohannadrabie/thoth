// Regression tests for GitHub Issue #96 (`story-implementer`'s own tests -- no `test-writer`
// dispatch this pass, per this pass's own Phase 1 "test-first dispatch check": the halt-state
// schema, exit-code contract, and stdin/stdout hook contract are all unchanged -- only the internal
// session-id-resolution FALLBACK (consulted only when stdin itself is degraded) gains a new source,
// never a new UI flow or API surface). Neither test-writer's own hooks/sessionstart-tool-enum.test.ts
// / hooks/userpromptsubmit-halt-relay.test.ts, nor either fixnow/friendly-labels sibling file, is
// touched here -- this is a new, sibling file.
//
// Background (see hooks/sessionstart-tool-enum.mjs's own UNKNOWN_SESSION_ID /
// resolveFallbackSessionId header comments for the full citation): when stdin fails to parse (or
// parses but its own `session_id` field isn't a usable string), sessionstart-tool-enum.mjs
// previously fell straight back to the literal "unknown-session" bucket. Since
// userpromptsubmit-halt-relay.mjs only ever consults the halt-state file for the CURRENT session's
// own real session_id, a genuine halt recorded under "unknown-session.json" was invisible to the
// real session's relay check -- a fail-open gap in a mechanism whose whole point (criterion 17) is
// fail-closed. The fix: both scripts now consult `process.env.CLAUDE_CODE_SESSION_ID` (a real,
// host-supplied environment variable, confirmed by MEASUREMENT -- see
// hooks/sessionstart-tool-enum.mjs's own `resolveFallbackSessionId` header comment for the exact
// spike -- not by documentation prose) BEFORE falling back to the shared literal.
//
// S5 Stage-3 CRITICAL review round 3 fix-now: this file's own PREVIOUS version tested
// `CLAUDE_SESSION_ID` (the WRONG variable name the round-2 build of this fix mistakenly read) and
// injected that exact variable into the child environment itself -- red-team's own finding F1 named
// this precisely: "the test fabricates the very fact under measurement, so it can only ever confirm
// it." Every `CLAUDE_SESSION_ID` reference below is now `CLAUDE_CODE_SESSION_ID`, the CORRECT,
// measured name, and a new dedicated test (see "Issue #96 wrong-name guard" below) proves the OLD
// name is no longer, and was never meant to be, consulted.
//
// Covers:
//   (a) malformed/empty stdin + CLAUDE_CODE_SESSION_ID set in the environment -> the halt-state file
//       is written under the REAL session id, not unknown-session.json.
//   (b) end-to-end: userpromptsubmit-halt-relay.mjs (given the SAME degraded stdin + the SAME
//       CLAUDE_CODE_SESSION_ID) finds and blocks on that exact file -- the full fail-closed path
//       works, not just the write side.
//   (c) double failure (stdin degraded AND CLAUDE_CODE_SESSION_ID also unset/empty): both scripts
//       still fall back to the literal UNKNOWN_SESSION_ID = "unknown-session" exactly as before -- the
//       disclosed residual and reconcileReason's set:false exemption for that shared bucket
//       (GitHub Issue #96's round-2 escalation fix) are unregressed.
//   (d) the HAPPY PATH (stdin parses fine, session_id present and a string) never consults
//       CLAUDE_CODE_SESSION_ID at all -- byte-identical to before this fix, proven by setting
//       CLAUDE_CODE_SESSION_ID to a DIFFERENT value than the real stdin session_id and asserting the
//       stdin value always wins.
//   (e) [round 3, NEW] the OLD, wrong env var name (`CLAUDE_SESSION_ID`) being set, with the CORRECT
//       name absent, does NOT satisfy the fallback -- proving this fix does not accidentally accept
//       both names (which would silently mask a future regression back to the wrong one).
//   (f) [round 3, NEW, GitHub Issue #274 / red-team F2] the cross-session anti-collision guard: an
//       env-resolved session id that happens to name a DIFFERENT, currently-active live session must
//       never reconcile that OTHER session's genuinely-active halt to set:false.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook, sessionStartStdin, userPromptSubmitStdin, fakeSessionId } from "./test-support/spawn-hook.ts";
import {
  makeFixtureTree,
  writeProjectSettingsJson,
  writeProjectMcpJson,
  readHaltState,
  haltStatePath,
  seedHaltState,
  fixtureEnv,
} from "./test-support/fixture-tree.ts";
import fs from "node:fs";

const SESSIONSTART_SCRIPT = "hooks/sessionstart-tool-enum.mjs";
const RELAY_SCRIPT = "hooks/userpromptsubmit-halt-relay.mjs";
const UNKNOWN_SESSION_ID = "unknown-session";

function nowIso(): string {
  return new Date().toISOString();
}

function reasonsOf(haltState: unknown): Record<string, { set?: unknown; detail?: unknown }> {
  if (typeof haltState !== "object" || haltState === null) return {};
  const reasons = (haltState as Record<string, unknown>).reasons;
  return typeof reasons === "object" && reasons !== null ? (reasons as Record<string, { set?: unknown; detail?: unknown }>) : {};
}

// --- (a)+(b): malformed stdin, CLAUDE_CODE_SESSION_ID set -- real session id used, relay finds it -

test("Issue #96: malformed (non-JSON) stdin with CLAUDE_CODE_SESSION_ID set in the environment -- the halt-state file is written under the REAL session id, not unknown-session.json, and the relay (same env, same degraded stdin) finds and blocks on it", () => {
  const tree = makeFixtureTree("issue96-malformed-stdin-env-set");
  try {
    const realSessionId = fakeSessionId("issue96-real-session");
    const env = { ...fixtureEnv(tree), CLAUDE_CODE_SESSION_ID: realSessionId };

    // Malformed, non-empty, non-JSON stdin -- JSON.parse throws BEFORE session_id is ever read from
    // the payload, so sessionstart-tool-enum.mjs's own session_id resolution never reaches its
    // `typeof input.session_id === "string"` check at all; it must resolve from the pre-try fallback
    // (CLAUDE_CODE_SESSION_ID) instead. The parse failure itself is what criterion 17's own top-level
    // try/catch reports (SUR-03-enumeration-failed) -- the genuine halt reason here IS the malformed
    // stdin, which is exactly the scenario Issue #96 is about: does that genuine halt land somewhere
    // the relay can actually find?
    const sessionStartResult = runHook(SESSIONSTART_SCRIPT, "{ this is not valid JSON [[[", env);
    assert.equal(sessionStartResult.code, 0, `SessionStart itself must still exit 0 (never 2 -- gap G5); got stderr=${sessionStartResult.stderr}`);

    // The halt-state file must land under the REAL session id...
    const realHaltState = readHaltState(tree, realSessionId) as { reasons?: Record<string, unknown> } | undefined;
    assert.ok(realHaltState, `expected a halt-state file at the REAL session id's own path; got none. stderr=${sessionStartResult.stderr}`);
    const realReasons = reasonsOf(realHaltState);
    assert.equal(
      realReasons["SUR-03-enumeration-failed"]?.set,
      true,
      `expected the malformed-stdin failure to be recorded under the REAL session id; got ${JSON.stringify(realReasons)}`,
    );

    // ...and NEVER under the shared "unknown-session" bucket.
    assert.equal(
      fs.existsSync(haltStatePath(tree, UNKNOWN_SESSION_ID)),
      false,
      "expected NO unknown-session.json to be written when CLAUDE_CODE_SESSION_ID successfully resolves a real session id",
    );

    // End-to-end: the relay, given the SAME env and the SAME kind of degraded stdin (missing
    // session_id field entirely -- a distinct but equally realistic malformed-stdin shape for the
    // relay's own UserPromptSubmit payload), must find and block on the REAL session's file. THIS is
    // the crux of Issue #96: before the fix, the relay's real-session lookup found nothing (the
    // reason was filed under unknown-session.json instead) and the session proceeded unblocked.
    const relayResult = runHook(RELAY_SCRIPT, { hook_event_name: "UserPromptSubmit", prompt: "hi" }, env);
    assert.equal(
      relayResult.code,
      2,
      `expected the relay to find and block on the real session's halt-state file; got code=${relayResult.code} stdout=${relayResult.stdout} stderr=${relayResult.stderr}`,
    );
    assert.match(
      relayResult.stderr,
      /Tool\/connector check failed/,
      `expected the real halt reason's friendly label to appear in the block message; got stderr=${relayResult.stderr}`,
    );
  } finally {
    tree.cleanup();
  }
});

test("Issue #96: EMPTY stdin (not malformed JSON, just blank) with CLAUDE_CODE_SESSION_ID set -- same fallback applies (session_id field is simply absent from the resulting {} payload)", () => {
  const tree = makeFixtureTree("issue96-empty-stdin-env-set");
  try {
    const realSessionId = fakeSessionId("issue96-empty-stdin-real");
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, { mcpServers: { "issue96-empty-stdin-server": { command: "node", args: [] } } });

    const env = { ...fixtureEnv(tree), CLAUDE_CODE_SESSION_ID: realSessionId };
    const result = runHook(SESSIONSTART_SCRIPT, "", env);
    assert.equal(result.code, 0, `expected clean exit 0; got stderr=${result.stderr}`);

    const reasons = reasonsOf(readHaltState(tree, realSessionId));
    assert.equal(reasons["SUR-03-unclassified-tool"]?.set, true, `expected the halt to be recorded under the real session id even for blank stdin; got ${JSON.stringify(reasons)}`);
    assert.equal(fs.existsSync(haltStatePath(tree, UNKNOWN_SESSION_ID)), false, "expected no unknown-session.json for blank stdin when CLAUDE_CODE_SESSION_ID resolves");
  } finally {
    tree.cleanup();
  }
});

// --- (c): double failure -- both scripts still fall back to the shared literal, unregressed -------

test("Issue #96 double-failure (unregressed): malformed stdin AND CLAUDE_CODE_SESSION_ID unset/empty -- both scripts still fall back to the literal UNKNOWN_SESSION_ID bucket exactly as before, and the round-2 sticky-halt guard (never reconciled to set:false) still protects it", () => {
  const tree = makeFixtureTree("issue96-double-failure");
  try {
    // Explicitly force CLAUDE_CODE_SESSION_ID to an empty string -- deterministic regardless of the
    // ambient shell environment this test happens to run in (see this file's own header: this is
    // the one case that must NOT depend on incidental absence).
    const env = { ...fixtureEnv(tree), CLAUDE_CODE_SESSION_ID: "" };

    // Both runs use malformed (non-JSON) stdin -- run A's and run B's own "conditions" are the parse
    // failure itself (SUR-03-enumeration-failed), which is identical every run; the point here is
    // purely whether the shared bucket's set:true entry from run A survives run B's own write.
    const runA = runHook(SESSIONSTART_SCRIPT, "not valid json at all [[[", env);
    assert.equal(runA.code, 0, `expected clean exit 0; got stderr=${runA.stderr}`);
    const afterA = reasonsOf(readHaltState(tree, UNKNOWN_SESSION_ID));
    assert.equal(
      afterA["SUR-03-enumeration-failed"]?.set,
      true,
      `expected run A's genuinely-active condition to still land in the shared "unknown-session" bucket when BOTH stdin and CLAUDE_CODE_SESSION_ID fail; got ${JSON.stringify(afterA)}`,
    );

    const relayAfterA = runHook(RELAY_SCRIPT, { hook_event_name: "UserPromptSubmit", prompt: "hi" }, env);
    assert.equal(relayAfterA.code, 2, "expected the relay to block for the shared fallback session right after run A");

    // A SECOND, different colliding invocation -- the round-2 fix (reconcileReason's
    // UNKNOWN_SESSION_ID guard) must still refuse to clear run A's still-active halt via this shared
    // bucket, even though run B's OWN malformed-stdin condition is (trivially) "the same" condition
    // re-triggering, not a resolved one. Unregressed by the #96 fix above: sessionId only equals the
    // literal bucket in this exact double-failure case, which this test forces deterministically.
    const runB = runHook(SESSIONSTART_SCRIPT, "not valid json at all [[[", env);
    assert.equal(runB.code, 0, `expected clean exit 0; got stderr=${runB.stderr}`);
    const afterB = reasonsOf(readHaltState(tree, UNKNOWN_SESSION_ID));
    assert.equal(
      afterB["SUR-03-enumeration-failed"]?.set,
      true,
      `expected run A's active halt under the shared bucket to remain set:true after run B; got ${JSON.stringify(afterB)}`,
    );

    const relayAfterB = runHook(RELAY_SCRIPT, { hook_event_name: "UserPromptSubmit", prompt: "hi" }, env);
    assert.equal(relayAfterB.code, 2, "expected the relay to STILL block after run B -- the round-2 sticky-halt guard must remain intact under the #96 fix");
  } finally {
    tree.cleanup();
  }
});

// --- (d): happy path is byte-identical -- CLAUDE_CODE_SESSION_ID is never consulted when stdin is
// fine ------------------------------------------------------------------------------------------

test("Issue #96 happy-path guard: when stdin parses fine and carries a real session_id, CLAUDE_CODE_SESSION_ID is NEVER consulted, even when it names a DIFFERENT session id -- the stdin value always wins", () => {
  const tree = makeFixtureTree("issue96-happy-path-guard");
  try {
    const stdinSessionId = fakeSessionId("issue96-happy-stdin-session");
    const differentEnvSessionId = fakeSessionId("issue96-happy-DIFFERENT-env-session");
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, { mcpServers: { "happy-path-server": { command: "node", args: [] } } });

    const env = { ...fixtureEnv(tree), CLAUDE_CODE_SESSION_ID: differentEnvSessionId };
    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId: stdinSessionId }), env);
    assert.equal(result.code, 0, `expected clean exit 0; got stderr=${result.stderr}`);

    const stdinReasons = reasonsOf(readHaltState(tree, stdinSessionId));
    assert.equal(stdinReasons["SUR-03-unclassified-tool"]?.set, true, `expected the halt to be recorded under stdin's OWN session id; got ${JSON.stringify(stdinReasons)}`);

    assert.equal(
      fs.existsSync(haltStatePath(tree, differentEnvSessionId)),
      false,
      "expected NO halt-state file under CLAUDE_CODE_SESSION_ID's differing value -- the env fallback must never override a well-formed stdin session_id",
    );

    const relayResult = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId: stdinSessionId }), env);
    assert.equal(relayResult.code, 2, "expected the relay to block using stdin's own session_id, matching the writer's happy-path choice");
  } finally {
    tree.cleanup();
  }
});

// --- (e) [round 3, NEW]: the OLD, wrong env var name is never consulted -----------------------------

test("Issue #96 wrong-name guard: the OLD, incorrect env var name (CLAUDE_SESSION_ID) being set does NOT satisfy the fallback when the CORRECT CLAUDE_CODE_SESSION_ID is absent -- both scripts still fall back to the shared literal bucket, never to the wrong-name value", () => {
  const tree = makeFixtureTree("issue96-wrong-env-name");
  try {
    const wrongNameValue = fakeSessionId("issue96-wrong-name-value");
    // CLAUDE_SESSION_ID (the round-2 build's WRONG, non-existent variable) is set; the CORRECT
    // CLAUDE_CODE_SESSION_ID is explicitly forced empty -- deterministic regardless of the ambient
    // shell environment this test happens to run in (matches the double-failure test's own
    // convention above). If this fix accidentally accepted EITHER name, that would silently mask a
    // future regression back to the wrong one.
    const env = { ...fixtureEnv(tree), CLAUDE_SESSION_ID: wrongNameValue, CLAUDE_CODE_SESSION_ID: "" };

    const result = runHook(SESSIONSTART_SCRIPT, "not valid json at all [[[", env);
    assert.equal(result.code, 0, `expected clean exit 0; got stderr=${result.stderr}`);

    // Must NOT land under the wrong-name value's own "session id"...
    assert.equal(
      fs.existsSync(haltStatePath(tree, wrongNameValue)),
      false,
      "expected NO halt-state file under the WRONG env var's own value -- CLAUDE_SESSION_ID must never be consulted",
    );
    // ...it must fall all the way through to the shared literal bucket, exactly like the
    // double-failure case.
    const reasons = reasonsOf(readHaltState(tree, UNKNOWN_SESSION_ID));
    assert.equal(
      reasons["SUR-03-enumeration-failed"]?.set,
      true,
      `expected the malformed-stdin failure to fall back to the shared "unknown-session" bucket when only the WRONG env var name is set; got ${JSON.stringify(reasons)}`,
    );

    const relayResult = runHook(RELAY_SCRIPT, { hook_event_name: "UserPromptSubmit", prompt: "hi" }, env);
    assert.equal(relayResult.code, 2, "expected the relay to block for the shared fallback session (never for the wrong-name value's own non-existent session)");
  } finally {
    tree.cleanup();
  }
});

// --- (f) [round 3, NEW, GitHub Issue #274 / red-team F2]: cross-session anti-collision guard --------

test("Issue #274 / red-team F2: an env-resolved session id naming a DIFFERENT, currently-active live session must NEVER reconcile that OTHER session's genuinely-active halt to set:false", () => {
  const tree = makeFixtureTree("issue274-cross-session-guard");
  try {
    const victimSessionId = fakeSessionId("issue274-victim");
    // The victim has a genuinely-active halt (as if an EARLIER, real SessionStart run found a real
    // unclassified tool for the victim's own session).
    seedHaltState(tree, victimSessionId, {
      sessionId: victimSessionId,
      reasons: { "SUR-03-unclassified-tool": { set: true, detail: '"victim-unclassified-server"', setAt: nowIso() } },
    });

    // Control: the victim is blocked BEFORE the colliding invocation.
    const relayBefore = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId: victimSessionId }), fixtureEnv(tree));
    assert.equal(relayBefore.code, 2, `expected the victim to be blocked BEFORE the colliding invocation; got code=${relayBefore.code}`);

    // A SECOND, unrelated SessionStart invocation: its own stdin PARSES but carries no usable
    // session_id field (red-team's own demonstrated DRILL5 shape -- deliberately NOT malformed JSON,
    // which would route through the catch block and always be additive/set:true regardless of this
    // guard). It falls to the env fallback, which in this drill resolves to the VICTIM's own session
    // id (a real, supported collision shape -- see resolveFallbackSessionId's own header comment: a
    // nested Claude Code session, an inherited shell export, or a settings.json env block can all
    // legitimately produce this). This colliding invocation's OWN tool universe is fully classified
    // (no fixture configured in this fresh tree), so absent the fix, it would reconcile
    // SUR-03-unclassified-tool to set:false under the VICTIM's own session id -- silently clearing
    // the victim's real, still-active halt.
    const collidingEnv = { ...fixtureEnv(tree), CLAUDE_CODE_SESSION_ID: victimSessionId };
    const collidingResult = runHook(SESSIONSTART_SCRIPT, JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }), collidingEnv);
    assert.equal(collidingResult.code, 0, `expected clean exit 0; got stderr=${collidingResult.stderr}`);

    // The victim's own halt-state entry must remain set:true -- untouched by the colliding
    // invocation's env-resolved id.
    const victimReasons = reasonsOf(readHaltState(tree, victimSessionId));
    assert.equal(
      victimReasons["SUR-03-unclassified-tool"]?.set,
      true,
      `expected the victim's genuinely-active halt to remain set:true after a colliding env-resolved invocation; got ${JSON.stringify(victimReasons)}`,
    );

    // End-to-end: the relay must STILL block for the victim.
    const relayAfter = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId: victimSessionId }), fixtureEnv(tree));
    assert.equal(
      relayAfter.code,
      2,
      `expected the victim to remain blocked AFTER the colliding invocation; got code=${relayAfter.code} stdout=${relayAfter.stdout} stderr=${relayAfter.stderr}`,
    );
  } finally {
    tree.cleanup();
  }
});
