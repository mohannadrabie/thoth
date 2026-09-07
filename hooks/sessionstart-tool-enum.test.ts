// Black-box acceptance tests for `hooks/sessionstart-tool-enum.mjs` — written FIRST, before that
// file exists (test-writer, per CLAUDE.md's test-first workflow: story-implementer writes zero
// application code until these are RED-CONFIRMED). The script does not exist yet; every test below
// is expected to fail with a "module/file not found" style error right now — that IS the RED
// confirmation, not a test bug.
//
// Source of truth for the tests below:
//   - docs/plans/S5-phase1-2026-09-06.md (v3) acceptance criteria 4 (SUR-03 real half: every tool
//     in the session's real, config-derived tool universe is classified at session start; any
//     unclassified tool halts the session at the next UserPromptSubmit), 16 (REVISED — real
//     enumeration reads MCP server declarations from every statically-readable local scope: project
//     `.mcp.json`, user/local `~/.claude.json`, via a names-only extraction), and 17
//     (`sessionstart-tool-enum.mjs` wraps its computation in try/catch; any internal exception still
//     results in a halt-state file being written under a generic reason, never a silent no-halt).
//   - Plan §5 "New files": `hooks/sessionstart-tool-enum.mjs` "computes the real tool universe...
//     merged into evaluateToolInventory's catalog (S3, already shipped); on haltRequired, writes the
//     multi-reason halt-state file (criterion 20). Criterion 17: the whole computation wrapped in
//     try/catch; any internal exception still results in a halt-state file being written under a
//     generic "SUR-03-enumeration-failed" reason key."
//   - Plan §2 criterion 20's exact halt-state schema (also see hooks/userpromptsubmit-halt-relay.mjs's
//     own test file for the matching relay-side contract):
//       { "sessionId": "<uuid>", "reasons": { "<reason-key>": { "set": true, "detail": "...",
//         "setAt": "<ISO-8601>" } } } at `${CLAUDE_PROJECT_DIR}/.thoth/halt-state/<session_id>.json`.
//   - Claude Code's documented SessionStart hook contract (code.claude.com/docs/en/hooks, confirmed
//     this session): stdin carries `session_id`, `hook_event_name: "SessionStart"`, `source`; "exit
//     2 prevents the session from starting." ADR-0021's own disclosed gap G5 ("SessionStart alone
//     cannot halt a session -- the halt point is UserPromptSubmit", plan line 34/69) means this
//     script's OWN exit code is never expected to be 2 -- it writes a side-effect file for
//     `hooks/userpromptsubmit-halt-relay.mjs` to act on later, it does not block session start
//     itself. Every test below therefore asserts on the halt-state FILE, not on this script's own
//     exit code (asserted only as a secondary, "never 2" sanity check).
//
// INTERPRETATION CHOICES made explicit here (flagged per this project's convention rather than
// silently guessed), because the hook implementation does not exist yet to confirm against:
//
// 1. "An MCP server declared in `.mcp.json`/`~/.claude.json` is sufficient, by itself, to guarantee
//    an unclassified tool." This follows directly from the plan's own Named Finding 1 ("No live
//    tool-enumeration API exists... A future MCP server whose tools can't be statically enumerated
//    counts as unclassified/fail-closed", plan line 79) -- an MCP server's actual exposed tool names
//    (`mcp__<server>__<tool>`) cannot be known without invoking it, so ANY genuinely novel server
//    name is unclassified by construction, not merely "likely" unclassified. This is the most
//    deterministic, implementation-independent fixture available and is used throughout below.
// 2. To remove ambiguity about `.claude/settings.json`'s enable/disable defaults for project-scoped
//    `.mcp.json` servers (`enableAllProjectMcpServers`/`enabledMcpjsonServers`/
//    `disabledMcpjsonServers`, all three named in the plan's own "New files" section as this hook's
//    real input), every fixture that plants a `.mcp.json` server also sets
//    `enableAllProjectMcpServers: true` explicitly in a project `.claude/settings.json`, so the test
//    does not depend on guessing which way an unset default resolves.
// 3. The malformed-input/internal-exception fixture (criterion 17) plants garbage into
//    `~/.claude.json` rather than project `.mcp.json`, specifically because `~/.claude.json` is a
//    user-global file this hook must read for user/local-scope MCP servers regardless of any
//    project-level enable/disable flag -- guaranteeing the malformed content is actually parsed
//    (and thus actually throws) rather than potentially being skipped by an enable-flag short
//    circuit that would make the fixture prove nothing.
// 4. A vanilla fixture tree with NO `.mcp.json`, NO `~/.claude.json`, and NO `.claude/settings.json`
//    at all is assumed to be the fully-classified/no-halt case -- i.e. Claude Code's own built-in
//    tools (Read, Bash, Edit, ...) are assumed fully covered by the shipped/vendored classification
//    catalog (SUR-05's whole purpose) with zero MCP servers configured. This is the ordinary,
//    unconfigured-project case and must not halt every vanilla session by construction.
//
// C16's own verification-table sub-clause about a claude.ai-connector-shaped name (from
// `claudeAiMcpEverConnected`) needing to be "absent from the tool-schema enumeration... while
// present in the connector-identity halt condition" is NOT tested here -- its precise black-box
// OUTPUT shape (how a caller distinguishes a "connector-identity" halt reason from a "tool-schema"
// halt reason in the halt-state file) is not pinned down anywhere in the plan text or the schema
// example given (only one example reason key, `SUR-03-unclassified-tool`, is shown). Flagged back
// per this project's convention rather than guessing at an unspecified schema distinction -- see
// this pass's persisted report / receipt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook, sessionStartStdin, fakeSessionId } from "./test-support/spawn-hook.ts";
import {
  makeFixtureTree,
  writeProjectMcpJson,
  writeHomeClaudeJson,
  writeProjectSettingsJson,
  readHaltState,
  fixtureEnv,
} from "./test-support/fixture-tree.ts";

const SCRIPT = "hooks/sessionstart-tool-enum.mjs";

/** Narrow a parsed halt-state file down to its `reasons` map, or undefined if the shape doesn't
 * match (a malformed/absent file both read back as `undefined` from `readHaltState`). */
function reasonsOf(haltState: unknown): Record<string, unknown> | undefined {
  if (typeof haltState !== "object" || haltState === null) return undefined;
  const reasons = (haltState as Record<string, unknown>).reasons;
  return typeof reasons === "object" && reasons !== null ? (reasons as Record<string, unknown>) : undefined;
}

function reasonIsSet(haltState: unknown, key: string): boolean {
  const reasons = reasonsOf(haltState);
  if (!reasons) return false;
  const entry = reasons[key];
  return typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).set === true;
}

/** True iff ANY reason in the halt-state file is set -- mirrors what
 * `hooks/userpromptsubmit-halt-relay.mjs` itself must check per criterion 20. */
function anyReasonSet(haltState: unknown): boolean {
  const reasons = reasonsOf(haltState);
  if (!reasons) return false;
  return Object.values(reasons).some(
    (entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).set === true,
  );
}

// --- AC-4 / AC-16: a project-scoped MCP server (.mcp.json) is unclassified -> halts ------------

test("AC-4/AC-16: a session whose ONLY extra tool is a novel MCP server declared in project .mcp.json is unclassified -> a halt-state file is written for this session", () => {
  const tree = makeFixtureTree("sessionstart-mcpjson-unclassified");
  try {
    const sessionId = fakeSessionId("ss-mcpjson-unclassified");
    writeProjectSettingsJson(tree, { enableAllProjectMcpServers: true });
    writeProjectMcpJson(tree, {
      mcpServers: { "totally-fake-server-xyz": { command: "node", args: ["fake.js"] } },
    });

    const result = runHook(SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));

    assert.notEqual(result.code, 2, `SessionStart itself must never block session start (ADR-0021 gap G5) -- got code=${result.code} stderr=${result.stderr}`);
    const haltState = readHaltState(tree, sessionId);
    assert.notEqual(haltState, undefined, `expected a halt-state file to be written for an unclassified MCP server; stdout=${result.stdout} stderr=${result.stderr}`);
    assert.equal(anyReasonSet(haltState), true, `expected at least one reason with set:true in the halt-state file; got ${JSON.stringify(haltState)}`);
  } finally {
    tree.cleanup();
  }
});

test("AC-4/AC-16: a session whose ONLY extra tool is a novel MCP server declared in user/local ~/.claude.json is unclassified -> a halt-state file is written (second local scope, architecture-reviewer's condition)", () => {
  const tree = makeFixtureTree("sessionstart-claudejson-unclassified");
  try {
    const sessionId = fakeSessionId("ss-claudejson-unclassified");
    writeHomeClaudeJson(tree, {
      mcpServers: { "another-fake-server-abc": { command: "node", args: ["fake2.js"] } },
    });

    const result = runHook(SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));

    assert.notEqual(result.code, 2, `SessionStart itself must never block session start (ADR-0021 gap G5) -- got code=${result.code} stderr=${result.stderr}`);
    const haltState = readHaltState(tree, sessionId);
    assert.notEqual(haltState, undefined, `expected a halt-state file to be written for an unclassified MCP server declared only in ~/.claude.json; stdout=${result.stdout} stderr=${result.stderr}`);
    assert.equal(anyReasonSet(haltState), true, `expected at least one reason with set:true in the halt-state file; got ${JSON.stringify(haltState)}`);
  } finally {
    tree.cleanup();
  }
});

// --- AC-4: a fully-classified (vanilla, no MCP servers) session does not halt -------------------

test("AC-4: a vanilla session with NO .mcp.json, NO ~/.claude.json, NO project settings.json (only Claude Code's own built-in tools) is fully classified -> no halt-state file is written", () => {
  const tree = makeFixtureTree("sessionstart-fully-classified");
  try {
    const sessionId = fakeSessionId("ss-fully-classified");

    const result = runHook(SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));

    // NOTE: asserting `code === 0` here (a positive "ran to a clean, successful completion" check),
    // not merely `code !== 2`, is deliberate -- a script that does not exist at all ALSO produces no
    // halt-state file and a code that happens not to be 2 (spawnSync module-not-found exits 1), which
    // would make the "no halt-state file" assertion below a false-positive PASS that hides a missing
    // implementation rather than proving a working no-halt path. See this file's AC-2 sibling fix in
    // hooks/pretooluse-kernel-gate.test.ts for the same class of bug.
    assert.equal(result.code, 0, `expected a clean exit 0 for a fully-classified, unconfigured session; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
    const haltState = readHaltState(tree, sessionId);
    assert.equal(haltState, undefined, `expected NO halt-state file for a fully-classified, unconfigured session; got ${JSON.stringify(haltState)} stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    tree.cleanup();
  }
});

// --- AC-17 (SUR-10-shaped fail-closed): an internal exception still results in a halt-state write

test("AC-17: malformed (non-JSON) ~/.claude.json throws internally during enumeration -> the whole computation's try/catch still writes a halt-state file (\"SUR-03-enumeration-failed\"), never a silent no-halt", () => {
  const tree = makeFixtureTree("sessionstart-malformed-exception");
  try {
    const sessionId = fakeSessionId("ss-malformed-exception");
    writeHomeClaudeJson(tree, "{ this is not valid JSON at all °§¶ [[[");

    const result = runHook(SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));

    assert.notEqual(result.code, 2, `even on internal exception, SessionStart must never itself block session start (ADR-0021 gap G5) -- the halt is relayed later via UserPromptSubmit, not here; got code=${result.code} stderr=${result.stderr}`);
    const haltState = readHaltState(tree, sessionId);
    assert.notEqual(haltState, undefined, `an internal exception during enumeration must still result in a halt-state file being written (criterion 17's fail-closed contract), not a silent no-halt; stdout=${result.stdout} stderr=${result.stderr}`);
    assert.equal(
      reasonIsSet(haltState, "SUR-03-enumeration-failed"),
      true,
      `expected the generic "SUR-03-enumeration-failed" reason key (named verbatim in the plan's "New files" section) to be set:true; got ${JSON.stringify(haltState)}`,
    );
  } finally {
    tree.cleanup();
  }
});
