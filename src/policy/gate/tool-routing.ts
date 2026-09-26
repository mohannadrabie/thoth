// The ONE place that maps a runtime `tool_name` to a registered normalizer `toolType` (S7 plan
// section 4; ADR-0021 has no rule on how a tool_name reaches a toolType, plan section 17 item 4).
// This is a DATA table, not a dispatch chain: each row says how to match a name, which toolType
// handles it, whether the call needs the classification catalog, and how to build the raw call the
// normalizer expects (a pure builder; the only "logic" in a builder is a malformed-input check,
// which is an enumerated SUR-10 refusal, never policy).
//
// SCOPE (plan R-B): the gate evaluates ONLY `Bash` and names starting `mcp__`. Every other name has
// no row and is refused fail-closed by the caller. This file is the only file in the gate directory
// allowed to hold the literals Bash, mcp__, shell and tool-class (G11, G11b).
//
// EVOLUTION: at the third normalizer (a filesystem one is the first candidate) move this mapping to
// registration-time declaration and delete the table. Until then adding a tool type edits two
// shared lines: a row here and the side-effect import below.
import "../normalizer/shell.ts";
import "../normalizer/tool-class.ts";
import type { MergedToolClassificationSet } from "../tools/classification.ts";

export interface RouteCallContext {
  toolName: string;
  toolInput: unknown;
  identity: string;
  /** Present only when the row says `needsCatalog`. */
  catalog: MergedToolClassificationSet | undefined;
}

export type BuildRawResult = { ok: true; raw: unknown } | { ok: false; reason: string };

export interface ToolRoute {
  match: { kind: "exact" | "prefix"; value: string };
  toolType: string;
  needsCatalog: boolean;
  buildRaw: (ctx: RouteCallContext) => BuildRawResult;
}

// No real environment or identity model exists yet (S6/S11a): the disclosed-placeholder pattern
// bootstrap-ruleset.ts already uses. `environment` is "unknown" for both tool types.
const ENVIRONMENT = "unknown";

export const ROUTES: readonly ToolRoute[] = [
  {
    match: { kind: "exact", value: "Bash" },
    toolType: "shell",
    needsCatalog: false,
    buildRaw: (ctx) => {
      const input = ctx.toolInput;
      const command = typeof input === "object" && input !== null ? (input as Record<string, unknown>).command : undefined;
      if (typeof command !== "string") {
        return { ok: false, reason: "tool_input.command is missing or not a string; fail-closed, cannot evaluate" };
      }
      return { ok: true, raw: { command, environment: ENVIRONMENT, identity: ctx.identity, deferred: false } };
    },
  },
  {
    match: { kind: "prefix", value: "mcp__" },
    toolType: "tool-class",
    needsCatalog: true,
    buildRaw: (ctx) => ({
      ok: true,
      raw: { toolName: ctx.toolName, catalog: ctx.catalog, environment: ENVIRONMENT, identity: ctx.identity, deferred: false },
    }),
  },
];

/** The first row whose match applies, or undefined (the caller refuses an unroutable name). */
export function routeToolName(toolName: string): ToolRoute | undefined {
  return ROUTES.find((row) => (row.match.kind === "exact" ? toolName === row.match.value : toolName.startsWith(row.match.value)));
}
