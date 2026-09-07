// S5 Phase 1 plan v3 (docs/plans/S5-phase1-2026-09-06.md), criterion 16, council-ruled fix for
// Issue #89: reading `~/.claude.json` for MCP-server enumeration is architecturally sound
// (ADR-0021 — no kernel-purity or normalizer-registry boundary crossed, a hook script is already
// the documented impure shell, POL-11) but was not shown to satisfy OPS-02
// (REQUIREMENTS.md:584, P0, quoted verbatim): "Thoth shall never read, log or emit credential
// material. Posture output names identities and outcomes, never secrets. Fixture asserts no
// secret-shaped content in any artifact."
//
// This module is the fix: a pure, names-only extraction function. It NEVER reads, destructures,
// logs, or re-serializes any `env`/`args`/`command` field, or any field of a declared MCP server
// object OTHER THAN its own key — no `JSON.stringify(server)`, no spread of a server object, ever,
// anywhere in this file. All file I/O (`readFileSync`, `${HOME}`/`${CLAUDE_PROJECT_DIR}`
// resolution) stays in the calling hook script (`hooks/sessionstart-tool-enum.mjs`) — this module
// only ever receives an already-parsed JSON value, keeping it pure and independently unit-testable
// (POL-11's impure-shell/pure-core split, applied here even though this file sits outside the
// kernel purity boundary proper).
//
// Two input shapes, both covered (architecture-reviewer's council-seat condition — extend the
// canary fixture to `.mcp.json` too, identical risk shape, not only `~/.claude.json`):
//   - `.mcp.json` (project scope):        { mcpServers: { <name>: { command, args, env, ... } } }
//   - `~/.claude.json` (user/local scope): { mcpServers: {...}, claudeAiMcpEverConnected: [...], ... }
// `claudeAiMcpEverConnected` is claude.ai account-connector IDENTITY only (no tool-schema mapping —
// a connector is fetched live and never written to any local file, structurally outside static-
// config enumeration, per this plan's own disclosed limit) — its string values are names, already
// bare, never nested objects, so surfacing them carries the exact same no-secrets guarantee as
// `mcpServers`' keys.
//
// The canary-secret test for this file (mcp-enumeration.test.ts) is `story-implementer`'s own unit
// test (plan §4's Constraints: "it tests a pure internal function's data-handling contract, not an
// externally-observable UI/API surface"), not test-writer's.
export type McpDeclarationSource = "mcp.json" | "claude.json";

/**
 * Given an already-parsed JSON value shaped like `.mcp.json` or `~/.claude.json`, returns ONLY the
 * declared MCP server names (`Object.keys(mcpServers)`), plus — for `source: "claude.json"` only —
 * the string values of `claudeAiMcpEverConnected` (already bare names). Never touches any other
 * field of a server object. Tolerant of a malformed/missing/wrong-shaped input: returns an empty
 * array rather than throwing, so a caller's own try/catch around JSON.parse is the only place an
 * exception can originate — this function itself is not a source of one (see
 * mcp-enumeration.test.ts's canary test (b) for the exact property this guarantees).
 */
export function extractMcpServerNames(input: unknown, source: McpDeclarationSource): string[] {
  const names: string[] = [];
  if (typeof input !== "object" || input === null) return names;
  const obj = input as Record<string, unknown>;

  const mcpServers = obj.mcpServers;
  if (typeof mcpServers === "object" && mcpServers !== null && !Array.isArray(mcpServers)) {
    // Object.keys only — the server object's OWN fields (command/args/env/...) are never read,
    // destructured, or otherwise touched anywhere in this function.
    names.push(...Object.keys(mcpServers));
  }

  if (source === "claude.json") {
    names.push(...extractConnectorIdentities(input));
  }

  return names;
}

/**
 * CONNECTOR-IDENTITY SCHEMA DECISION (`story-implementer`, made explicit here per test-writer's own
 * flagged ambiguity — docs/reviews/s5-deny-by-default-hook-wiring-test-writer-2026-09-06.md — since
 * the plan text and its one schema example never pinned down a distinguishable black-box shape):
 *
 * A claude.ai account connector (`claudeAiMcpEverConnected`) is NEVER treated as an ordinary
 * classification-eligible "tool" alongside a statically-declared MCP server — it carries CONNECTOR
 * IDENTITY only, no tool-schema mapping is possible (the connector's actual exposed tools are
 * fetched live and never written to any local file this repo can statically read). Building a
 * classification-catalog entry for a connector NAME would be a category error: there is nothing to
 * classify it AGAINST.
 *
 * The concrete decision: `hooks/sessionstart-tool-enum.mjs` keeps connector identities OUT of the
 * tool-schema `sessionTools` list it hands to `evaluateToolInventory` (this function's return value
 * is used only to SUBTRACT connector names back out — see that hook's own `computeSessionTools`),
 * and instead writes them under a SEPARATE, distinctly-named halt-state reason key —
 * `"SUR-03-unclassified-connector"` — never the shared `"SUR-03-unclassified-tool"` key ordinary
 * MCP server declarations use. A connector's mere presence is unconditionally reported this way
 * (there is no "classified" state a connector identity could ever reach). This is a small, simple,
 * additive halt-state schema extension (one more reason key, same `{set, detail, setAt}` shape
 * criterion 20 already defines) — not a new mechanism.
 *
 * This function is exported separately (not folded silently into `extractMcpServerNames` above)
 * specifically so the calling hook can keep the two categories apart without re-deriving the split
 * itself from `claudeAiMcpEverConnected` a second time. Same purity/no-secrets guarantee as
 * `extractMcpServerNames`: only ever reads `claudeAiMcpEverConnected`'s own string values, nothing
 * else on the input object.
 */
export function extractConnectorIdentities(input: unknown): string[] {
  const names: string[] = [];
  if (typeof input !== "object" || input === null) return names;
  const connected = (input as Record<string, unknown>).claudeAiMcpEverConnected;
  if (Array.isArray(connected)) {
    for (const value of connected) {
      if (typeof value === "string") names.push(value);
    }
  }
  return names;
}
