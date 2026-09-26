// docs/qa/tool-inventory.json is the vendored, human-captured snapshot of Claude Code's own
// documented built-in tool names (SUR-05's "vendored built-in-tool snapshot" — see
// src/qa/gate-matcher-drift-check.ts, which diffs referenced tool names against it). See that
// JSON file's own "evidenceNote" field for how and when it was captured, and its disclosed
// evidence tier — same offline, re-vendor-on-a-human-cadence convention QA-17's
// runtime-settings-inventory.json already established; this instrument never fetches the live docs
// page itself.
//
// This file has a SECOND job: it is also SUR-03's real "shipped defaults" tool-CLASSIFICATION
// layer — `mergeToolClassificationLayers`'s first argument (src/policy/rule/precedence.ts) — that
// `hooks/sessionstart-tool-enum.mjs` merges with a "central" layer loaded at runtime from
// docs/qa/s5-central-classification.json (a committed, separately-reviewable fixture, the single
// source of truth for that layer — see src/policy/tools/central-classification.ts's own header
// comment for the full disclosure; it has no expiry). CORRECTED (S5 Stage-3 CRITICAL review round 1, GitHub Issue #91):
// this comment previously called the central layer "currently empty, S6-pending" — as of this
// story's own fix-now pass it is populated, and no ratified milestone currently owns building a
// real central-override CONFIG LOADER (checked directly against every open milestone's `gh`
// description); until one does, the fixture above is the only central layer that exists. This is
// DELIBERATELY SEPARATE from src/policy/fixtures/tool-classification.ts's three-tool fixture
// (`shippedToolClassificationLayer` et al.) — that file stays S3's own pure TEST fixture, unchanged,
// still consumed only by classification.test.ts / precedence.test.ts. This file is the real
// bootstrap catalog S5's live hook actually runs against.
//
// EVERY classification below is `story-implementer`'s own disclosed, reviewable judgment call —
// NOT a §0.4-compliance claim (same disclosure criterion 13 already makes for bootstrap-
// ruleset.ts's placeholder RuleSet). SUR-03's own acceptance bar here is narrower than "is this
// classification perfectly correct": it only asks whether a tool is CLASSIFIED AT ALL (unclassified
// halts the session) — the specific bucket (read-only / workspace-mutating / remote-mutating)
// gates no decision: since S7 (GitHub Issue #93) the tool-class normalizer turns a CENTRAL
// layer entry's class into a rule-matchable marker verb for MCP tool calls, but the gate evaluates
// only Bash and mcp__ names (plan R-B), so a BUILT-IN tool's class below still drives no enforcement
// decision. Where a tool's
// real-world blast radius is ambiguous (e.g. TodoWrite, SlashCommand), the more conservative
// (higher) bucket is chosen deliberately.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ToolClass, ToolClassificationSet } from "./classification.ts";

export interface BuiltinToolInventory {
  sourceUrl: string;
  capturedAt: string;
  evidenceTier: string;
  tools: string[];
}

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INVENTORY_PATH = join(THIS_DIR, "..", "..", "..", "docs", "qa", "tool-inventory.json");

/** Pure parse/validate — separated from the file read (`loadBuiltinToolInventory` below) so this
 * is independently testable against an in-memory string, same DI shape this repo already uses
 * elsewhere (e.g. runtime-settings-drift-check.ts's own vendored-JSON parsing). */
export function parseBuiltinToolInventory(json: string): BuiltinToolInventory {
  const parsed = JSON.parse(json) as Partial<BuiltinToolInventory>;
  if (!Array.isArray(parsed.tools) || !parsed.tools.every((t) => typeof t === "string")) {
    throw new Error('tool-inventory.json: "tools" must be an array of strings');
  }
  return {
    sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : "unknown",
    capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : "unknown",
    evidenceTier: typeof parsed.evidenceTier === "string" ? parsed.evidenceTier : "unknown",
    tools: parsed.tools,
  };
}

export function loadBuiltinToolInventory(path: string = DEFAULT_INVENTORY_PATH): BuiltinToolInventory {
  return parseBuiltinToolInventory(readFileSync(path, "utf8"));
}

/** See this file's header comment — every value here is a disclosed judgment call, not a
 * §0.4-compliance claim. Every tool name in docs/qa/tool-inventory.json MUST have an entry here,
 * or a vanilla, unconfigured session (no MCP servers at all) would halt on Claude Code's own
 * built-ins — the exact regression `builtinToolClassificationLayer`'s own self-test below guards
 * against. */
const CLASSIFICATION: Readonly<Record<string, ToolClass>> = Object.freeze({
  Read: "read-only",
  Glob: "read-only",
  Grep: "read-only",
  WebSearch: "remote-mutating", // network egress; no "remote-read-only" bucket exists (see header)
  WebFetch: "remote-mutating", // network egress
  ListMcpResources: "read-only",
  ReadMcpResource: "read-only",
  AskUserQuestion: "read-only",
  ExitPlanMode: "read-only",
  BashOutput: "read-only", // reads an already-running background process's output
  TodoWrite: "workspace-mutating", // conservative: no dedicated "session-state" bucket exists
  KillShell: "workspace-mutating", // terminates a process — mutates process state
  SlashCommand: "workspace-mutating", // can invoke an arbitrary slash command
  Bash: "workspace-mutating", // per-call verdict is governed separately by S2-S4's kernel/normalizer
  Edit: "workspace-mutating",
  Write: "workspace-mutating",
  MultiEdit: "workspace-mutating",
  NotebookEdit: "workspace-mutating",
  Task: "workspace-mutating", // delegates to a subagent; conservative (SUR-14 governs its own grant)
});

/**
 * Builds the real "shipped defaults" ToolClassificationSet from the vendored inventory, applying
 * `CLASSIFICATION` above. A vendored tool name with NO entry in `CLASSIFICATION` is a bug in this
 * file (not a runtime condition) — surfaced as a thrown error immediately, not a silent
 * "unclassified" pass-through, since that silent shape is exactly what would let a vanilla session
 * halt unexpectedly (and would defeat this instrument's whole purpose).
 */
export function buildBuiltinToolClassificationLayer(inventory: BuiltinToolInventory): ToolClassificationSet {
  const tools = inventory.tools.map((name) => {
    const toolClass = CLASSIFICATION[name];
    if (!toolClass) {
      throw new Error(
        `builtin-tool-inventory.ts: "${name}" is in docs/qa/tool-inventory.json but has no CLASSIFICATION entry`,
      );
    }
    return { name, class: toolClass };
  });
  return { version: inventory.capturedAt, tools };
}

export function loadBuiltinToolClassificationLayer(path?: string): ToolClassificationSet {
  return buildBuiltinToolClassificationLayer(loadBuiltinToolInventory(path));
}
