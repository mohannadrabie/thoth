// The tool-class GRAMMAR: the one builder and parser for how a classified MCP tool call becomes
// the canonical Action record's `verbs` and `targets` (S7, docs/plans/s7-kernel-gate-
// classification-phase1-2026-09-26.md section 4; mirrors target-format.ts, which does the same for
// cluster targets). ADR-0021 route (a): class is DATA a rule can match, carried in fields that
// already exist; the kernel branches on no new field.
//
// GRAMMAR_VERSION "1". A change to anything below is a visible diff in tool-class-golden.test.ts
// (G13) and needs a decisions row plus a migration note for central rule authors. Markers are
// append-only: a marker is never renamed.
//
// WHAT A RECORD LOOKS LIKE
//   classified MCP tool : source "structured", verbs [<one marker>], targets [mcp/<server>/<tool>]
//   anything else       : source "opaque", verbs [], targets [], unresolved [<one cause>]
// The three markers are tool-class:read-only, tool-class:workspace-mutating and
// tool-class:remote-mutating. They are OWNED BY THE TOOL-CLASS NORMALIZER and are NOT in
// KNOWN_VERBS (action-catalog.ts), so the shell and cluster normalizers cannot emit them: their
// verbs come only from resolveVerb (KNOWN_VERBS) plus the constant "write". A shell verb token equal
// to a marker fails resolveVerb and becomes unresolved (tool-class.test.ts N8, N9b).
//
// RULE-AUTHOR FACTS (schema.ts cannot check any of these: it validates verbs and targets as string
// arrays only, schema.ts line 189, and this story may not touch it; G13b documents each one against
// the real validator and kernel):
//   1. Class records carry NO legacy verb. A deny keyed on write, create, modify, delete, move,
//      rename or execute never sees a tool-class record.
//   2. A marker-paired deny follows the fixture (flip the class and it stops matching). An
//      identity-keyed deny (a target like mcp/<server>/, no marker) survives the flip. "This server
//      is always denied" is an identity-keyed deny; "this class is denied" is a marker rule.
//   3. A shell redirect can forge an identity TARGET string, so an ALLOW rule keyed on identity MUST
//      also carry the marker verb. A deny rule may be target-only: a forged match only denies.
//   4. The rule schema accepts any string, so a typo loads clean and never matches. The four natural
//      inert deny shapes: a misspelled marker; a server target without the trailing slash (the
//      kernel matches a target exactly unless the pattern ends in "/"); the legacy mutating verbs
//      plus the mcp target prefix; the DECLARED server name instead of the sanitized runtime name.
//   5. GRAMMAR_VERSION is invisible to out-of-repo (central) rule authors and a rule carries no
//      version. A bump needs a decisions row and a central-rule migration note.
//
// The TOOL segment is admitted only if it consists solely of [A-Za-z0-9_-] (no leading or embedded
// "__", no "/"); anything else is unresolved.
//
// NAME MAPPING (injective-or-unresolved). The runtime reports an MCP tool as
// mcp__<server>__<tool> with every character of the configured server name outside [A-Za-z0-9_-]
// replaced by "_" (observed for space and dot, plan S-1; other characters are unmeasured, X-2).
// That map is many-to-one, so a fixture entry is ADMITTED only if its name consists solely of
// [A-Za-z0-9-] (no underscore, space, dot, colon or any character the runtime sanitizes): only then
// is the runtime spelling of the server identical to the entry, and an unlisted server can never
// present a name that an admitted entry would claim. Every other entry is REJECTED (reported with a
// reason, its tools unclassified and therefore denied). Lookup is an exact match of the server
// segment against the admitted names: no prefix, no longest match.
import type { MergedToolClassificationSet, ToolClass } from "../tools/classification.ts";

export const GRAMMAR_VERSION = "1";

/** One marker verb per class. `Record<ToolClass, string>`: a fourth class is a compile error. */
export const CLASS_MARKER_VERBS: Readonly<Record<ToolClass, string>> = {
  "read-only": "tool-class:read-only",
  "workspace-mutating": "tool-class:workspace-mutating",
  "remote-mutating": "tool-class:remote-mutating",
};

const MCP_PREFIX = "mcp__";
const ADMISSIBLE_SERVER_NAME = /^[A-Za-z0-9-]+$/;
const ADMISSIBLE_TOOL_NAME = /^[A-Za-z0-9_-]+$/;

/** The runtime's spelling of a configured server or tool name: every character outside
 * [A-Za-z0-9_-] becomes "_" (observed for space and dot; plan S-1). */
export function sanitizeMcpName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

export interface ParsedMcpToolName {
  server: string;
  tool: string;
}

/** Splits mcp__<server>__<tool> at the FIRST "__" after the prefix. Returns undefined (unresolved)
 * unless both segments are non-empty, the tool segment does not start with "_" and contains no
 * "__" (either would allow a second, different split of the same string), and neither segment
 * contains the target delimiter "/". */
export function parseMcpToolName(name: string): ParsedMcpToolName | undefined {
  if (!name.startsWith(MCP_PREFIX)) return undefined;
  const rest = name.slice(MCP_PREFIX.length);
  const at = rest.indexOf("__");
  if (at <= 0) return undefined;
  const server = rest.slice(0, at);
  const tool = rest.slice(at + 2);
  if (tool.length === 0 || tool.startsWith("_") || tool.includes("__")) return undefined;
  if (server.includes("/") || tool.includes("/")) return undefined;
  // The TOOL segment is as strict as the server segment (S7 fix-now, app-security 5 / red-team 4): the
  // runtime's tool names consist of [A-Za-z0-9_-] only (S-1), so anything else (whitespace, NUL, a
  // zero-width or lookalike character, a dot) cannot be a real tool name and would land verbatim in the
  // identity target, letting an exact per-tool rule be evaded by a same-server tool spelled differently.
  if (!ADMISSIBLE_TOOL_NAME.test(tool)) return undefined;
  return { server, tool };
}

/** mcp/<server>/<tool>. Returns undefined when a segment contains the delimiter (never a silent,
 * ambiguous longer target; the Issue #66 discipline of target-format.ts). */
export function buildMcpTarget(parts: ParsedMcpToolName): string | undefined {
  if (parts.server.includes("/") || parts.tool.includes("/")) return undefined;
  return `mcp/${parts.server}/${parts.tool}`;
}

export interface RejectedServerEntry {
  name: string;
  reason: string;
}

export interface ServerIndex {
  /** Admitted server name to its class. */
  byName: ReadonlyMap<string, ToolClass>;
  /** Every catalog entry that was not admitted, with the reason. */
  rejected: RejectedServerEntry[];
}

function isToolClass(value: unknown): value is ToolClass {
  return typeof value === "string" && Object.hasOwn(CLASS_MARKER_VERBS, value);
}

/** Builds the exact-match index from the merged catalog. Only entries whose `sourceLayer` is
 * "central" are considered (the built-in layer names built-in tools, never MCP servers). */
export function buildServerIndex(catalog: MergedToolClassificationSet): ServerIndex {
  const byName = new Map<string, ToolClass>();
  const rejected: RejectedServerEntry[] = [];
  const seen = new Map<string, ToolClass>();
  const collided = new Set<string>();
  for (const entry of catalog.tools) {
    if (entry.sourceLayer !== "central") continue;
    const name: unknown = entry.name;
    if (typeof name !== "string" || !ADMISSIBLE_SERVER_NAME.test(name)) {
      rejected.push({ name: typeof name === "string" ? name : String(name), reason: "name is not solely [A-Za-z0-9-]" });
      continue;
    }
    if (!isToolClass(entry.class)) {
      rejected.push({ name, reason: "class is not one of read-only, workspace-mutating, remote-mutating" });
      continue;
    }
    const previous = seen.get(name);
    if (previous !== undefined) {
      if (previous !== entry.class) collided.add(name);
      continue;
    }
    seen.set(name, entry.class);
  }
  for (const [name, cls] of seen) {
    if (collided.has(name)) rejected.push({ name, reason: "listed twice with different classes" });
    else byName.set(name, cls);
  }
  return { byName, rejected };
}
