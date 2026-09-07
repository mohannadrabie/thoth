#!/usr/bin/env node
// SessionStart hook (ADR-0021 shape 4, gap G5): computes the session's real, config-derived tool
// universe and halts a session with an unclassified tool — but NOT by itself. ADR-0021's own gap G5
// ("a SessionStart hook cannot halt a session on this runtime; exit code 2 shows stderr and the
// session proceeds") means this script's job is limited to a SIDE EFFECT: writing a halt-state file
// for hooks/userpromptsubmit-halt-relay.mjs (the earliest surface that actually blocks) to act on
// at the next prompt. This script's OWN exit code is therefore never 2 by design, not by accident.
//
// SUR-03's real half (criterion 4): "every tool in the session's real, config-derived tool universe
// is classified at session start; any unclassified tool halts the session at the next
// UserPromptSubmit." No live tool-enumeration API exists on this runtime (S5 plan Named Finding 1,
// re-confirmed: anthropics/claude-code#6574 is an open upstream feature request) — this script
// therefore APPROXIMATES the session's tool universe as:
//   Claude Code's own vendored built-in tool names (src/policy/tools/builtin-tool-inventory.ts)
//   UNION every statically-declared MCP server name from every locally-readable scope (project
//   .mcp.json, user/local ~/.claude.json) — criterion 16, via the pure, names-only
//   src/policy/tools/mcp-enumeration.ts (OPS-02: never reads/logs/emits env/args/command values).
// A declared MCP server's OWN exposed tool names cannot be known without invoking it, so the
// server's own declared NAME stands in as an unclassified "tool" surrogate — sufficient BY ITSELF
// to guarantee unclassified, per Named Finding 1's own text ("a future MCP server whose tools can't
// be statically enumerated counts as unclassified/fail-closed"). This is a disclosed approximation,
// not a live introspection claim (criterion 13's same disclosed-placeholder pattern, applied here).
//
// CONNECTOR-IDENTITY SCHEMA DECISION (criterion 16(b), test-writer's flagged ambiguity resolved
// here — see src/policy/tools/mcp-enumeration.ts's own header comment on
// `extractConnectorIdentities` for the full text): a claude.ai account connector name
// (`~/.claude.json`'s `claudeAiMcpEverConnected`) is NEVER folded into the tool-schema
// `sessionTools` universe below — it carries connector IDENTITY only, no tool-schema mapping is
// possible. It is instead reported, unconditionally whenever present, under its own distinct
// halt-state reason key, `"SUR-03-unclassified-connector"` — kept apart from the shared
// `"SUR-03-unclassified-tool"` key ordinary MCP server declarations use.
//
// Project-scope `.mcp.json` servers are only counted as part of the session's tool universe when
// enabled per `.claude/settings.json`'s own real enable/disable semantics
// (enableAllProjectMcpServers / enabledMcpjsonServers / disabledMcpjsonServers) — mirroring this
// runtime's own real approval model (a project-scope server needs explicit trust; a user/local
// ~/.claude.json server is already-approved/global and is always counted). Absent any of these three
// keys, a project .mcp.json server is treated as NOT enabled (the runtime's own real default is
// opt-in) — a disclosed judgment call, untested either way by this story's own acceptance criteria
// (every fixture that plants a project .mcp.json server explicitly sets
// enableAllProjectMcpServers: true, precisely to avoid depending on this default).
//
// Criterion 17: the ENTIRE computation below is wrapped in one try/catch. Any internal exception
// (e.g. a malformed ~/.claude.json) still results in a halt-state file being written, under the
// generic "SUR-03-enumeration-failed" reason key — never a silent no-halt. This is SUR-10's
// fail-closed discipline applied to a hook that itself never blocks (see gap G5 above): failing
// open here would mean a broken enumeration silently never halts anything, forever.
//
// Halt-state schema (criterion 20 — see hooks/userpromptsubmit-halt-relay.mjs for the matching
// reader): a small JSON object keyed by reason, additive by construction (a write here MERGES its
// own reason key into any existing file rather than overwriting it, so a hypothetical future
// second writer's own reason, e.g. S11b's, is never clobbered).
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateToolInventory } from "../src/policy/tools/classification.ts";
import { mergeToolClassificationLayers } from "../src/policy/rule/precedence.ts";
import { loadBuiltinToolClassificationLayer } from "../src/policy/tools/builtin-tool-inventory.ts";
import { extractConnectorIdentities, extractMcpServerNames } from "../src/policy/tools/mcp-enumeration.ts";

const UNCLASSIFIED_REASON_KEY = "SUR-03-unclassified-tool";
// Connector-identity schema decision (see src/policy/tools/mcp-enumeration.ts's own header comment
// on extractConnectorIdentities for the full text): a claude.ai account connector is ALWAYS
// reported under this distinct reason key, never merged into UNCLASSIFIED_REASON_KEY above — it
// carries identity only, no tool-schema mapping is possible, so it is never a member of the
// tool-schema `sessionTools` universe evaluateToolInventory classifies against.
const UNCLASSIFIED_CONNECTOR_REASON_KEY = "SUR-03-unclassified-connector";
const ENUMERATION_FAILED_REASON_KEY = "SUR-03-enumeration-failed";

function readStdin() {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", (err) => rejectPromise(err));
  });
}

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

function homeDir() {
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function haltStatePath(sessionId) {
  return join(projectDir(), ".thoth", "halt-state", `${sessionId}.json`);
}

/** Best-effort read of an already-existing halt-state file for merge purposes. A malformed
 * existing file is NOT this script's fail-closed concern (that property belongs to
 * hooks/userpromptsubmit-halt-relay.mjs, tested there) — treated as "nothing to merge with" so this
 * writer can still make forward progress recording its own reason. */
function readExistingHaltState(sessionId) {
  const p = haltStatePath(sessionId);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
}

/** Merges `reasonKey`/`detail` into the existing halt-state file for `sessionId` (criterion 20:
 * additive by construction — every OTHER reason key already present is preserved untouched). */
function writeHaltReason(sessionId, reasonKey, detail) {
  const existing = readExistingHaltState(sessionId);
  const reasons =
    existing && typeof existing === "object" && existing.reasons && typeof existing.reasons === "object"
      ? { ...existing.reasons }
      : {};
  reasons[reasonKey] = { set: true, detail, setAt: new Date().toISOString() };

  const p = haltStatePath(sessionId);
  mkdirSync(join(projectDir(), ".thoth", "halt-state"), { recursive: true });
  writeFileSync(p, JSON.stringify({ sessionId, reasons }, null, 2), "utf8");
}

function readJsonFileIfExists(path) {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  return JSON.parse(text); // deliberately NOT caught here — a malformed file must propagate up to
  // this script's own top-level try/catch, which is exactly what criterion 17 requires: an
  // internal exception during enumeration still results in a halt-state write, never a silent
  // no-halt.
}

function isProjectMcpServerEnabled(serverName, projectSettings) {
  if (!projectSettings || typeof projectSettings !== "object") return false;
  if (projectSettings.enableAllProjectMcpServers === true) return true;
  const enabledList = projectSettings.enabledMcpjsonServers;
  if (Array.isArray(enabledList) && enabledList.includes(serverName)) return true;
  const disabledList = projectSettings.disabledMcpjsonServers;
  if (Array.isArray(disabledList) && disabledList.includes(serverName)) return false;
  return false; // real runtime default is opt-in; see this file's header comment
}

/** Computes the session's approximated tool-schema universe (builtin names ∪ enabled MCP server
 * names from every statically-readable local scope — CONNECTOR IDENTITIES DELIBERATELY EXCLUDED,
 * see the connector-identity schema decision above and in mcp-enumeration.ts) and evaluates it
 * against the merged classification catalog. Also returns any declared connector identities
 * separately, for main() to report under their own distinct reason key. Throws on any malformed
 * input file — caught by main()'s own top-level try/catch. */
function computeSessionTools() {
  const projectSettingsPath = join(projectDir(), ".claude", "settings.json");
  const projectSettings = readJsonFileIfExists(projectSettingsPath);

  const projectMcpPath = join(projectDir(), ".mcp.json");
  const projectMcpJson = readJsonFileIfExists(projectMcpPath);
  const allProjectMcpNames = projectMcpJson ? extractMcpServerNames(projectMcpJson, "mcp.json") : [];
  const enabledProjectMcpNames = allProjectMcpNames.filter((name) => isProjectMcpServerEnabled(name, projectSettings));

  const homeClaudeJsonPath = join(homeDir(), ".claude.json");
  const homeClaudeJson = readJsonFileIfExists(homeClaudeJsonPath);
  // extractMcpServerNames("claude.json") merges server names + connector identities (by design,
  // see mcp-enumeration.ts) — connectorNames is subtracted back out below so the tool-schema
  // universe below never includes a connector identity, per the schema decision.
  const homeAllNames = homeClaudeJson ? extractMcpServerNames(homeClaudeJson, "claude.json") : [];
  const connectorNames = homeClaudeJson ? extractConnectorIdentities(homeClaudeJson) : [];
  const homeMcpServerOnlyNames = homeAllNames.filter((name) => !connectorNames.includes(name));

  const builtinLayer = loadBuiltinToolClassificationLayer();
  const centralLayer = { version: "0.0.0-bootstrap", tools: [] }; // disclosed placeholder pending S6/T5
  const merged = mergeToolClassificationLayers(builtinLayer, centralLayer);

  const builtinNames = builtinLayer.tools.map((t) => t.name);
  const sessionTools = [...builtinNames, ...enabledProjectMcpNames, ...homeMcpServerOnlyNames];

  return { inventoryResult: evaluateToolInventory(merged, sessionTools), connectorNames };
}

async function main() {
  // sessionId is resolved OUTSIDE the try block's own scope-of-concern (reading/parsing stdin is
  // not itself the "enumeration" criterion 17 guards — it is Claude Code's own documented, always
  // well-formed hook payload) but the try/catch still wraps it: a malformed/empty stdin is exactly
  // as much an "internal exception during enumeration" as a malformed ~/.claude.json is, and both
  // must still result in a best-effort halt-state write, never a silent no-halt.
  let sessionId = "unknown-session";
  try {
    const raw = await readStdin();
    const input = raw.trim() === "" ? {} : JSON.parse(raw);
    sessionId = typeof input.session_id === "string" ? input.session_id : "unknown-session";

    const { inventoryResult, connectorNames } = computeSessionTools();
    if (inventoryResult.haltRequired) {
      writeHaltReason(sessionId, UNCLASSIFIED_REASON_KEY, `unclassified: ${inventoryResult.unclassified.join(", ")}`);
    }
    if (connectorNames.length > 0) {
      // Connector-identity schema decision: always its own reason key, never merged into
      // UNCLASSIFIED_REASON_KEY above — see this file's own header and mcp-enumeration.ts.
      writeHaltReason(sessionId, UNCLASSIFIED_CONNECTOR_REASON_KEY, `connector identity present: ${connectorNames.join(", ")}`);
    }
    // Neither condition: deliberately do NOT touch the halt-state file at all (a vanilla,
    // fully-classified session must leave no file, per this story's own AC-4 test).
  } catch (err) {
    // Criterion 17: the whole computation's own exception path still results in a halt-state
    // write, under the generic reason key — never a silent no-halt. Best-effort: if even THIS
    // write fails, there is nothing further to do — SessionStart can never block regardless (gap
    // G5), so this script still exits 0 either way.
    try {
      writeHaltReason(
        sessionId,
        ENUMERATION_FAILED_REASON_KEY,
        `internal exception during tool enumeration: ${err?.message ?? String(err)}`,
      );
    } catch (writeErr) {
      process.stderr.write(
        `sessionstart-tool-enum.mjs: failed to write halt-state on exception: ${writeErr?.stack ?? writeErr}\n`,
      );
    }
    process.stderr.write(`sessionstart-tool-enum.mjs: internal exception during enumeration: ${err?.stack ?? err}\n`);
  }
  process.exit(0); // never 2 — SessionStart cannot block on this runtime (gap G5)
}

await main();
