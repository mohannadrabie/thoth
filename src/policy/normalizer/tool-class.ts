// SUR-03 ("the classification shall drive enforcement"), Issue #93: the normalizer that turns a
// classified MCP tool call into a canonical Action record whose `verbs` carry the tool's CLASS as a
// rule-matchable marker verb and whose `targets` carry its identity. ADR-0021 route (a): no eighth
// Action-record field, no kernel change, no change to any other normalizer; registered by
// declaration on the normalizer registry (POL-12). The grammar (marker table, name mapping, the
// rule-author facts) lives in tool-class-format.ts, the one builder and parser.
//
// An unclassified, ambiguous or unparseable call is reported as an OPAQUE record with one
// `unresolved` cause, so the kernel's POL-05 denies it unconditionally, before any rule.
//
// This normalizer accepts ONLY mcp__ names: a built-in tool name is never given a class record here
// (plan R-B: no built-in is routed through classification in this story). It never returns a
// verdict and never throws on malformed input (tool-class.test.ts N7).
import type { ActionRecord } from "../kernel/action-record.ts";
import type { MergedToolClassificationSet } from "../tools/classification.ts";
import { registerNormalizer } from "./registry.ts";
import { CLASS_MARKER_VERBS, buildMcpTarget, buildServerIndex, parseMcpToolName } from "./tool-class-format.ts";

export interface ToolClassCall {
  toolName: unknown;
  catalog: unknown;
  environment: string;
  identity: string;
  deferred?: boolean;
}

function str(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === "string" ? v : "unknown";
}

function opaque(environment: string, identity: string, deferred: boolean, cause: string): ActionRecord {
  return { source: "opaque", verbs: [], targets: [], environment, identity, deferred, unresolved: [cause] };
}

function isCatalog(x: unknown): x is MergedToolClassificationSet {
  return typeof x === "object" && x !== null && Array.isArray((x as { tools?: unknown }).tools);
}

export function normalizeToolClassCall(raw: unknown): ActionRecord {
  const obj: Record<string, unknown> = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const environment = str(obj, "environment");
  const identity = str(obj, "identity");
  const deferred = obj.deferred === true;
  const toolName = obj.toolName;

  if (typeof toolName !== "string" || toolName.length === 0) {
    return opaque(environment, identity, deferred, "tool name is not a non-empty string");
  }
  if (!toolName.startsWith("mcp__")) {
    return opaque(environment, identity, deferred, `tool name ${JSON.stringify(toolName)} is not an mcp__ tool name`);
  }
  const parsed = parseMcpToolName(toolName);
  if (parsed === undefined) {
    return opaque(environment, identity, deferred, `tool name ${JSON.stringify(toolName)} does not split into one server segment and one tool segment`);
  }
  if (!isCatalog(obj.catalog)) {
    return opaque(environment, identity, deferred, "classification catalog is missing or malformed");
  }
  const cls = buildServerIndex(obj.catalog).byName.get(parsed.server);
  const target = buildMcpTarget(parsed);
  if (cls === undefined || target === undefined) {
    return opaque(environment, identity, deferred, `server ${JSON.stringify(parsed.server)} is not classified`);
  }
  return {
    source: "structured",
    verbs: [CLASS_MARKER_VERBS[cls]],
    targets: [target],
    environment,
    identity,
    deferred,
    unresolved: [],
  };
}

registerNormalizer({
  toolType: "tool-class",
  normalize: (raw) => normalizeToolClassCall(raw),
});
