// Regression tests for hooks/sessionstart-tool-enum.mjs's S5 Stage-3 CRITICAL review round 1
// fix-now changes (`story-implementer`'s own tests — no `test-writer` dispatch this pass; the
// existing black-box hook contract/schema is unchanged, only new VALUES are emitted/validated on
// it, per this pass's own Phase 1 plan "test-first dispatch check"). test-writer's own
// hooks/sessionstart-tool-enum.test.ts is left completely untouched — these are a new, sibling
// file, never an edit to the file test-writer authored.
//
// Covers:
//   - AC1 (revised): both allowlists are runtime-loaded from docs/qa/s5-central-classification.json;
//     end-to-end spawned-process tests inject a synthetic fixture via true dependency injection --
//     writing it to the REAL project-relative path inside the test's own isolated CLAUDE_PROJECT_DIR
//     tree (writeCentralClassificationFixture) -- never an ambient environment variable (S5 Stage-3
//     CRITICAL review round 2 fix-now, GitHub Issue #99: the THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH
//     seam this file previously used here is REMOVED from production entirely). The exemption is NOT
//     applied once the fixture's own `expiresOn` has passed ("EXPIRY IS ENFORCED AT RUNTIME" —
//     central-classification.ts's own header comment).
//   - AC5: the SUR-03-owned reason keys are reconciled to `set:false` on a SessionStart run once
//     their condition no longer holds (red-team's F5 sticky-halt finding, GitHub Issue #94) -- with
//     ONE deliberate exception: the shared "unknown-session" fallback bucket is never reconciled to
//     set:false (S5 Stage-3 CRITICAL review round 2 fix-now, `app-security-reviewer` finding 6 /
//     `red-team`'s Stop Brief escalation, GitHub Issue #96's escalated direction).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runHook, sessionStartStdin, userPromptSubmitStdin, fakeSessionId } from "./test-support/spawn-hook.ts";
import {
  makeFixtureTree,
  writeProjectMcpJson,
  writeHomeClaudeJson,
  writeProjectSettingsJson,
  writeCentralClassificationFixture,
  readHaltState,
  fixtureEnv,
  type FixtureTree,
} from "./test-support/fixture-tree.ts";
import { DEFAULT_FIXTURE_PATH } from "../src/policy/tools/central-classification.ts";

const SESSIONSTART_SCRIPT = "hooks/sessionstart-tool-enum.mjs";
const RELAY_SCRIPT = "hooks/userpromptsubmit-halt-relay.mjs";

function reasonsOf(haltState: unknown): Record<string, { set?: unknown; detail?: unknown }> {
  if (typeof haltState !== "object" || haltState === null) return {};
  const reasons = (haltState as Record<string, unknown>).reasons;
  return typeof reasons === "object" && reasons !== null ? (reasons as Record<string, { set?: unknown; detail?: unknown }>) : {};
}

/** Writes a synthetic central-classification fixture to THE REAL project-relative path
 * (`<projectDir>/docs/qa/s5-central-classification.json`) this hook's production code resolves via
 * its own already-isolated `CLAUDE_PROJECT_DIR` -- true dependency injection through the same seam
 * `fixtureEnv` already uses for every other input file, per `architecture-reviewer`'s S5 Stage-3
 * CRITICAL review round 2 council-seat ruling (GitHub Issue #99: no environment variable of any
 * kind may control which fixture file the production code path loads -- the removed
 * `THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH` env seam this file used to set here is gone).
 * Mirrors the real committed fixture's shape exactly (central-classification.ts's own parser is
 * strict about required fields). */
function writeSyntheticFixture(tree: FixtureTree, opts: { expiresOn: string }): void {
  writeCentralClassificationFixture(tree, {
    version: "test-fixture-1.0.0",
    expiresOn: opts.expiresOn,
    ratifiedBy: "docs/decisions.md, test fixture, not a real ratification",
    centralLayer: { tools: [{ name: "fixture-github-standin", class: "remote-mutating" }] },
    knownConnectors: ["claude.ai FixtureConnector"],
  });
}

// --- AC1: the exemption is genuinely fixture-driven, not hardcoded -------------------------------

test("AC1: an MCP server named identically to a centralLayer fixture entry is classified (no halt) when the fixture is not expired", () => {
  const tree = makeFixtureTree("ac1-not-expired-tool");
  try {
    const sessionId = fakeSessionId("ac1-not-expired-tool");
    writeSyntheticFixture(tree, { expiresOn: "2099-01-01" });
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, { mcpServers: { "fixture-github-standin": { command: "node", args: [] } } });

    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 0, `expected clean exit 0; got stderr=${result.stderr}`);

    const haltState = readHaltState(tree, sessionId);
    const reasons = reasonsOf(haltState);
    const unclassifiedDetail = String(reasons["SUR-03-unclassified-tool"]?.detail ?? "");
    assert.ok(
      !unclassifiedDetail.includes("fixture-github-standin"),
      `expected the fixture-classified tool name to be absent from the unclassified-tool detail; got ${JSON.stringify(reasons)}`,
    );
  } finally {
    tree.cleanup();
  }
});

test("AC1: the SAME MCP server name reverts to unclassified (halts) once the fixture's expiresOn has passed -- 'never silently rolled forward' enforced at runtime", () => {
  const tree = makeFixtureTree("ac1-expired-tool");
  try {
    const sessionId = fakeSessionId("ac1-expired-tool");
    writeSyntheticFixture(tree, { expiresOn: "2020-01-01" }); // long past
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, { mcpServers: { "fixture-github-standin": { command: "node", args: [] } } });

    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 0, `expected clean exit 0 (SessionStart never itself blocks); got stderr=${result.stderr}`);

    const haltState = readHaltState(tree, sessionId);
    const reasons = reasonsOf(haltState);
    assert.equal(reasons["SUR-03-unclassified-tool"]?.set, true, `expected the halt to fire once the fixture is expired; got ${JSON.stringify(reasons)}`);
    const unclassifiedDetail = String(reasons["SUR-03-unclassified-tool"]?.detail ?? "");
    assert.ok(unclassifiedDetail.includes("fixture-github-standin"), `expected the expired-exemption tool name in the halt detail; got ${unclassifiedDetail}`);
  } finally {
    tree.cleanup();
  }
});

test("AC1: a connector identity matching a knownConnectors fixture entry is exempted (no halt) when the fixture is not expired, but halts once the fixture has expired", () => {
  const treeActive = makeFixtureTree("ac1-connector-active");
  const treeExpired = makeFixtureTree("ac1-connector-expired");
  try {
    writeSyntheticFixture(treeActive, { expiresOn: "2099-01-01" });
    const sessionIdActive = fakeSessionId("ac1-connector-active");
    writeHomeClaudeJson(treeActive, { claudeAiMcpEverConnected: ["claude.ai FixtureConnector"] });
    const activeResult = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId: sessionIdActive }), fixtureEnv(treeActive));
    assert.equal(activeResult.code, 0);
    const activeReasons = reasonsOf(readHaltState(treeActive, sessionIdActive));
    // An exempted connector was never active, and it wasn't active before either -- per AC5's own
    // "don't fabricate a set:false entry for a condition that was never active" rule, the key is
    // absent entirely, not present-and-false. Either way, it must NOT be set:true.
    assert.notEqual(activeReasons["SUR-03-unclassified-connector"]?.set, true, `expected the allowlisted connector to be exempted (not an active halt); got ${JSON.stringify(activeReasons)}`);

    writeSyntheticFixture(treeExpired, { expiresOn: "2020-01-01" });
    const sessionIdExpired = fakeSessionId("ac1-connector-expired");
    writeHomeClaudeJson(treeExpired, { claudeAiMcpEverConnected: ["claude.ai FixtureConnector"] });
    const expiredResult = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId: sessionIdExpired }), fixtureEnv(treeExpired));
    assert.equal(expiredResult.code, 0);
    const expiredReasons = reasonsOf(readHaltState(treeExpired, sessionIdExpired));
    assert.equal(
      expiredReasons["SUR-03-unclassified-connector"]?.set,
      true,
      `expected the SAME connector name to halt once the fixture is expired; got ${JSON.stringify(expiredReasons)}`,
    );
  } finally {
    treeActive.cleanup();
    treeExpired.cleanup();
  }
});

// --- S5-R2-N1 (GitHub Issue #99): the removed env-var seam has ZERO effect on production ---------

test("S5-R2-N1: THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH (the removed env-var seam) has NO effect whatsoever on which fixture the production hook loads -- setting it to an attacker-controlled, nonexistent path changes nothing, because the production code path never reads this variable at all", () => {
  const tree = makeFixtureTree("s5r2n1-env-var-inert");
  try {
    const sessionId = fakeSessionId("s5r2n1-env-var-inert");
    // Deliberately NOT calling writeSyntheticFixture -- this tree has no central-classification
    // fixture of its own, so the hook's fallback-to-the-real-committed-fixture path is exercised
    // (see hooks/sessionstart-tool-enum.mjs's own header comment on projectRelativeFixturePath).
    // A vanilla, unconfigured session with the real fixture's 6 servers / 7 connectors (none of
    // which are declared here) must be fully classified regardless of the env var below.
    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), {
      ...fixtureEnv(tree),
      // The attacker's own intended payload from red-team's round-2 report: point this at a
      // nonexistent path (or, in a real attack, a hostile fixture). Before this fix, this alone
      // was sufficient to replace the ENTIRE ratified fixture, including expiresOn, invisibly.
      THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH: "/definitely/does/not/exist/attacker.json",
    });
    assert.equal(result.code, 0, `expected clean exit 0; got stderr=${result.stderr}`);
    const haltState = readHaltState(tree, sessionId);
    assert.equal(
      haltState,
      undefined,
      `expected the leftover/attacker-set env var to have ZERO effect -- a vanilla session must stay fully classified (no halt-state file at all), not fail closed on a bogus path or load a hostile fixture; got ${JSON.stringify(haltState)} stderr=${result.stderr}`,
    );
  } finally {
    tree.cleanup();
  }
});

// --- S5-R2 Issue #96 escalation (app-security round 2 finding 6): unknown-session bucket ----------
// is additive-only, never reconciled to set:false. MANDATORY boundary-crossing proof-test per
// `design-challenger`'s Stop Brief -- confirmed RED against the pre-fix `reconcileReason` (which
// cleared the shared bucket unconditionally), GREEN after the fix (this bucket's set:true entries
// are never cleared by a different colliding invocation).

test("S5-R2-Issue96-escalation: the shared 'unknown-session' fallback bucket is NEVER reconciled to set:false -- a second, different colliding invocation whose OWN condition is resolved must not silently clear a still-active halt that belongs to a different invocation", () => {
  const tree = makeFixtureTree("issue96-escalation");
  try {
    // Run A: session_id is absent from stdin entirely (Issue #96's own precondition -- "should
    // never happen per the documented contract"), and this invocation's own real condition IS
    // active (an unclassified MCP server is present) -- sessionId resolves to the shared fallback
    // bucket, "unknown-session", and writes SUR-03-unclassified-tool: set:true there.
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, { mcpServers: { "session-a-bad-server": { command: "node", args: [] } } });
    const runA = runHook(SESSIONSTART_SCRIPT, { hook_event_name: "SessionStart", source: "startup" }, fixtureEnv(tree));
    assert.equal(runA.code, 0, `expected clean exit 0; got stderr=${runA.stderr}`);
    const afterA = reasonsOf(readHaltState(tree, "unknown-session"));
    assert.equal(
      afterA["SUR-03-unclassified-tool"]?.set,
      true,
      `expected run A's own genuinely-active condition to be recorded under the shared fallback bucket; got ${JSON.stringify(afterA)}`,
    );
    const relayAfterA = runHook(RELAY_SCRIPT, { hook_event_name: "UserPromptSubmit", prompt: "hi" }, fixtureEnv(tree));
    assert.equal(relayAfterA.code, 2, "expected the relay to block for the shared fallback session right after run A");

    // Run B: a DIFFERENT logical invocation (different underlying condition -- its own MCP server
    // config is now fully resolved/classified) that ALSO fails to resolve a real session_id, so it
    // ALSO lands in the exact same "unknown-session" bucket. Before this fix, AC5's reconciliation
    // would see the bucket's OWN prior set:true entry and reconcile it to set:false, silently
    // discharging run A's still-genuinely-active halt. After this fix, the bucket is additive-only:
    // this write must be skipped entirely for the fallback bucket.
    writeProjectMcpJson(tree, { mcpServers: {} }); // run B's OWN condition is now resolved
    const runB = runHook(SESSIONSTART_SCRIPT, { hook_event_name: "SessionStart", source: "startup" }, fixtureEnv(tree));
    assert.equal(runB.code, 0, `expected clean exit 0; got stderr=${runB.stderr}`);
    const afterB = reasonsOf(readHaltState(tree, "unknown-session"));
    assert.equal(
      afterB["SUR-03-unclassified-tool"]?.set,
      true,
      `expected run A's active halt under the shared fallback bucket to remain set:true -- a second, DIFFERENT colliding invocation must never clear it; got ${JSON.stringify(afterB)}`,
    );

    const relayAfterB = runHook(RELAY_SCRIPT, { hook_event_name: "UserPromptSubmit", prompt: "hi" }, fixtureEnv(tree));
    assert.equal(
      relayAfterB.code,
      2,
      "expected the relay to STILL block for the shared fallback session after run B -- a fail-open regression here would silently discharge a genuinely-still-active halt belonging to a different invocation (GitHub Issue #96's escalated, worse direction)",
    );
  } finally {
    tree.cleanup();
  }
});

// --- S5-R2-N3 (GitHub Issue #101): fixture expiry is its own nameable, correctly-hinted cause -----

test("S5-R2-N3: once the exemption fixture expires, a distinct SUR-03-central-fixture-expired reason fires and the relay's message names re-ratification/removal as the unlock -- not the generic 'reclassify the tool' hint, which is a no-op once the fixture itself has expired", () => {
  const tree = makeFixtureTree("s5r2n3-expiry-cause");
  try {
    const sessionId = fakeSessionId("s5r2n3-expiry-cause");
    writeSyntheticFixture(tree, { expiresOn: "2020-01-01" }); // long past
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, { mcpServers: { "fixture-github-standin": { command: "node", args: [] } } });

    const sessionStartResult = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(sessionStartResult.code, 0);
    const reasons = reasonsOf(readHaltState(tree, sessionId));
    assert.equal(
      reasons["SUR-03-central-fixture-expired"]?.set,
      true,
      `expected the distinct fixture-expired reason to fire once the fixture is expired; got ${JSON.stringify(reasons)}`,
    );

    const relayResult = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(relayResult.code, 2);
    const json = relayResult.json as { hookSpecificOutput?: { systemMessage?: unknown } } | undefined;
    const msg = String(json?.hookSpecificOutput?.systemMessage ?? "");
    assert.match(msg, /expir/i, `expected the block message to name expiry as a cause; got: ${msg}`);
    assert.match(
      msg,
      /re-ratify/i,
      `expected the block message to name re-ratification (or removal) as the real unlock for the expiry cause, not just the generic reclassify-the-tool hint; got: ${msg}`,
    );
  } finally {
    tree.cleanup();
  }
});

// --- AC5: reconciliation to set:false, and the sticky-halt fix end-to-end ------------------------

test("AC5: a session halted on an unclassified MCP server is automatically un-halted on the NEXT SessionStart run once the server is removed -- reason reconciles to set:false, relay unblocks", () => {
  const tree = makeFixtureTree("ac5-reconcile-tool");
  try {
    const sessionId = fakeSessionId("ac5-reconcile-tool");
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, { mcpServers: { "totally-fake-server-xyz": { command: "node", args: [] } } });

    const firstRun = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(firstRun.code, 0);
    const firstReasons = reasonsOf(readHaltState(tree, sessionId));
    assert.equal(firstReasons["SUR-03-unclassified-tool"]?.set, true, `expected the halt to be active after the first run; got ${JSON.stringify(firstReasons)}`);

    const firstRelay = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(firstRelay.code, 2, "expected the relay to block while the reason is still active");

    // Fix the underlying condition (remove the unclassified server) and re-run SessionStart for the
    // SAME session id -- simulating a resumed session per red-team's own F5 demonstration that
    // SessionStart genuinely re-runs on --resume.
    writeProjectMcpJson(tree, { mcpServers: {} });
    const secondRun = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(secondRun.code, 0);
    const secondReasons = reasonsOf(readHaltState(tree, sessionId));
    assert.equal(
      secondReasons["SUR-03-unclassified-tool"]?.set,
      false,
      `expected the reason to be explicitly reconciled to set:false once the condition no longer holds; got ${JSON.stringify(secondReasons)}`,
    );

    const secondRelay = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(secondRelay.code, 0, "expected the relay to unblock once SessionStart reconciled the reason -- the sticky-halt (red-team F5) is fixed");
  } finally {
    tree.cleanup();
  }
});

test("AC5: a vanilla, fully-classified session still writes NO halt-state file at all -- reconciliation never fabricates a set:false entry for a condition that was never active (criterion 4's own no-file contract, unmodified by AC5)", () => {
  const tree = makeFixtureTree("ac5-vanilla-no-file");
  try {
    const sessionId = fakeSessionId("ac5-vanilla-no-file");

    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 0);

    assert.equal(readHaltState(tree, sessionId), undefined, "a vanilla session with nothing ever active must leave no halt-state file, even after AC5's reconciliation logic runs");
  } finally {
    tree.cleanup();
  }
});

test("AC5: once a session halts on an unclassified tool and is then resolved, ONLY that one reason key is ever written -- the two keys that were never active are never fabricated into the file", () => {
  const tree = makeFixtureTree("ac5-only-touched-key");
  try {
    const sessionId = fakeSessionId("ac5-only-touched-key");
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, { mcpServers: { "totally-fake-server-xyz": { command: "node", args: [] } } });
    runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));

    writeProjectMcpJson(tree, { mcpServers: {} }); // resolve it
    runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));

    const reasons = reasonsOf(readHaltState(tree, sessionId));
    assert.deepEqual(
      Object.keys(reasons),
      ["SUR-03-unclassified-tool"],
      `expected only the key that was ever actually active to appear in the file; got ${JSON.stringify(reasons)}`,
    );
    assert.equal(reasons["SUR-03-unclassified-tool"]?.set, false);
  } finally {
    tree.cleanup();
  }
});

test("AC5: SUR-03-enumeration-failed reconciles back to set:false on the run AFTER the malformed input is fixed", () => {
  const tree = makeFixtureTree("ac5-reconcile-enum-failed");
  try {
    const sessionId = fakeSessionId("ac5-reconcile-enum-failed");
    writeHomeClaudeJson(tree, "{ not valid JSON at all [[[");

    const firstRun = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(firstRun.code, 0);
    const firstReasons = reasonsOf(readHaltState(tree, sessionId));
    assert.equal(firstReasons["SUR-03-enumeration-failed"]?.set, true, `expected the enumeration-failed reason active after malformed input; got ${JSON.stringify(firstReasons)}`);

    writeHomeClaudeJson(tree, { mcpServers: {} }); // fix the malformed file
    const secondRun = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(secondRun.code, 0);
    const secondReasons = reasonsOf(readHaltState(tree, sessionId));
    assert.equal(
      secondReasons["SUR-03-enumeration-failed"]?.set,
      false,
      `expected SUR-03-enumeration-failed to reconcile to set:false once the malformed file is fixed; got ${JSON.stringify(secondReasons)}`,
    );
  } finally {
    tree.cleanup();
  }
});

// --- S5 fix-now condition: "record the resolved fixture path in halt-state, so a non-default load
// is never silent" (both council reports' SAFE-TO-PATCH/APPROVE-WITH-CONDITIONS verdicts --
// docs/reviews/s5-fixnow-council-impact-analyst-2026-09-07.md,
// docs/reviews/s5-central-classification-architecture-council-2026-09-07.md -- and red-team round
// 2's own stated prerequisite, docs/reviews/s5-fixnow-round2-red-team-2026-09-07.md, for its N2
// date-pin to mean anything). Scoped per AC-4 (unmodified below): the resolved-path record is
// written only on the runs that DO already produce a halt-state file for some other, genuine
// reason -- never fabricated into an otherwise-nonexistent file.

test('S5-fixnow-fixture-source: a halt caused by an unclassified tool records fixtureSource="project-relative" and the exact fixturePath used, when this fixture tree provides its own central-classification fixture', () => {
  const tree = makeFixtureTree("fixture-source-project-relative");
  try {
    const sessionId = fakeSessionId("fixture-source-project-relative");
    writeSyntheticFixture(tree, { expiresOn: "2099-01-01" });
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, { mcpServers: { "brand-new-unreviewed-mcp": { command: "node", args: [] } } });

    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 0, `expected clean exit 0; got stderr=${result.stderr}`);

    const haltState = readHaltState(tree, sessionId) as Record<string, unknown> | undefined;
    assert.ok(haltState, "expected a halt-state file to exist -- an unclassified tool is present, a genuine halt");
    assert.equal(
      haltState?.fixtureSource,
      "project-relative",
      `expected fixtureSource to record the project-relative fixture; got ${JSON.stringify(haltState)}`,
    );
    assert.equal(
      haltState?.fixturePath,
      join(tree.projectDir, "docs", "qa", "s5-central-classification.json"),
      `expected fixturePath to be the exact absolute path this run's fixture was actually read from; got ${JSON.stringify(haltState)}`,
    );
  } finally {
    tree.cleanup();
  }
});

test('S5-fixnow-fixture-source: a halt caused by an unclassified tool records fixtureSource="fallback-default" and the module-adjacent DEFAULT_FIXTURE_PATH, when this fixture tree provides NO central-classification fixture of its own', () => {
  const tree = makeFixtureTree("fixture-source-fallback-default");
  try {
    const sessionId = fakeSessionId("fixture-source-fallback-default");
    // Deliberately NOT calling writeSyntheticFixture -- this tree has no fixture of its own, so the
    // hook's production fallback path (the module-adjacent, real committed fixture) is exercised.
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, { mcpServers: { "brand-new-unreviewed-mcp-fallback-case": { command: "node", args: [] } } });

    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 0, `expected clean exit 0; got stderr=${result.stderr}`);

    const haltState = readHaltState(tree, sessionId) as Record<string, unknown> | undefined;
    assert.ok(haltState, "expected a halt-state file to exist -- an unclassified tool is present, a genuine halt");
    assert.equal(
      haltState?.fixtureSource,
      "fallback-default",
      `expected fixtureSource to record the module-adjacent fallback; got ${JSON.stringify(haltState)}`,
    );
    assert.equal(
      haltState?.fixturePath,
      DEFAULT_FIXTURE_PATH,
      `expected fixturePath to be the exact module-adjacent DEFAULT_FIXTURE_PATH; got ${JSON.stringify(haltState)}`,
    );
  } finally {
    tree.cleanup();
  }
});

test("S5-fixnow-fixture-source: AC-4's vanilla no-file contract is unregressed by fixtureSource/fixturePath recording -- a fully-classified session still writes NO halt-state file at all, regardless of which fixture path would have resolved", () => {
  const tree = makeFixtureTree("fixture-source-ac4-unregressed");
  try {
    const sessionId = fakeSessionId("fixture-source-ac4-unregressed");
    // No fixture of its own (fallback path resolves), no MCP servers, no connectors -- vanilla,
    // fully classified: nothing is ever active, so writeHaltReason must never be called at all.
    const result = runHook(SESSIONSTART_SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 0, `expected clean exit 0; got stderr=${result.stderr}`);
    assert.equal(
      readHaltState(tree, sessionId),
      undefined,
      "expected NO halt-state file at all -- fixtureSource/fixturePath recording must never fabricate a file for a session with nothing active (AC-4, unmodified)",
    );
  } finally {
    tree.cleanup();
  }
});
