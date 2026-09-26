// docs/qa/s5-central-classification.json is the committed fixture backing hooks/sessionstart-tool-enum.mjs's
// two disclosed interim exemption mechanisms, and it is the SINGLE SOURCE OF TRUTH for both
// allowlists: this module is the ONLY code path that reads that file, and nothing else in hooks/ or
// src/ re-declares an entry (S5 Stage-3 CRITICAL review round 1 finding: `red-team` F1/F10,
// `app-security-reviewer` finding 1, `cross-domain-reviewer` finding 1 -- GitHub Issues #90/#92/#98).
//
// (1) `centralLayer` -- SUR-03's "central override" classification tier (T5,
//     src/policy/rule/precedence.ts's `mergeToolClassificationLayers` second argument) for
//     locally-declared MCP servers. Two consumers read it: hooks/sessionstart-tool-enum.mjs (a
//     classified name is removed from SUR-03's unclassified/halt set) and, since S7 (GitHub Issue
//     #93), the tool-class normalizer (src/policy/normalizer/tool-class.ts), which turns an entry's
//     `class` into a rule-matchable marker verb on the Action record of an MCP tool call. The
//     kernel-gate hook that runs that normalizer is BUILT BUT NOT WIRED (no PreToolUse entry), and no
//     shipped policy rule matches a class yet (baseline allow content is an activation precondition,
//     plan AP-1), so today a `class` value drives no live enforcement decision. Only server names
//     consisting solely of [A-Za-z0-9-] are admitted to the class path (tool-class-format.ts).
//
// (2) `knownConnectors` -- a claude.ai account-connector display-name allowlist, a KNOWN, SPOOFABLE
//     residual risk. This is a pure display-name STRING match against `~/.claude.json`'s
//     `claudeAiMcpEverConnected` array -- no connector ID, URL, OAuth scope, or any other
//     identity-binding signal exists at this layer (confirmed via direct `~/.claude.json` inspection
//     during this story's own investigation; `src/policy/tools/mcp-enumeration.ts` deliberately never
//     reads anything else). It is NOT a real security control: a connector renamed, or a new
//     connector deliberately named identically to one of the entries in the JSON, defeats this
//     exemption completely (GitHub Issue #90). An unverified third party's claim about its own
//     identity is all that gates this exemption, accepted knowingly by the human.
//
// NO TIMER, NO PIN (`fixture-single-source-of-truth`, GitHub Issue #217; human directive 2026-09-18:
// "remove the timer, remove the pinned list, the json is the single source of truth"). Entries apply
// until someone removes them from the JSON. There is no expiry date, no runtime expiry check, and no
// test that pins the JSON's exact contents: the PR diff of docs/qa/s5-central-classification.json IS
// the review. Consequence, stated plainly: adding a name to either list silently suppresses that
// name's SUR-03 halt at the next SessionStart, and no test fails. The exemption is a scoped, standing
// exception to ADR-0021 INT-07, recorded in the project-tier ADR under docs/adr/ and in
// docs/decisions.md's 2026-09-19 row; it ends when an out-of-repo classification source ships
// (owned by GitHub Issue #224).
//
// What DOES still protect the JSON's integrity: this parser throws loudly on any malformed field (the
// hook's own top-level try/catch then records SUR-03-enumeration-failed, never "no exemption"
// silently), and no environment variable can select an arbitrary fixture FILE (GitHub Issue #99; see
// hooks/sessionstart-tool-enum.mjs's `resolveFixtureLocation`). The project root the fixture is read
// from comes from CLAUDE_PROJECT_DIR, or the hook's working directory when it is unset.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ToolClass, ToolClassificationSet } from "./classification.ts";

export interface CentralClassificationFixture {
  version: string;
  centralLayer: ToolClassificationSet;
  knownConnectors: string[];
}

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
// Exported (not just module-internal) so hooks/sessionstart-tool-enum.mjs can name this exact path
// in the halt-state file's `fixturePath` field when its own project-relative resolution attempt
// misses and it falls back to this module-adjacent, env-immune copy -- see that file's own
// `resolveFixtureLocation()` for the two-way split this constant feeds (S5 fix-now condition: "record
// the resolved fixture path in halt-state, so a non-default load is never silent", both council
// reports docs/reviews/s5-fixnow-council-impact-analyst-2026-09-07.md and
// docs/reviews/s5-central-classification-architecture-council-2026-09-07.md, red-team's own stated
// prerequisite in docs/reviews/s5-fixnow-round2-red-team-2026-09-07.md).
export const DEFAULT_FIXTURE_PATH = join(THIS_DIR, "..", "..", "..", "docs", "qa", "s5-central-classification.json");

const VALID_TOOL_CLASSES: ReadonlySet<string> = new Set<ToolClass>(["read-only", "workspace-mutating", "remote-mutating"]);

/** Pure parse/validate -- separated from the file read (`loadCentralClassificationFixture` below)
 * so this is independently testable against an in-memory string, same DI shape this repo already
 * uses for `builtin-tool-inventory.ts`'s vendored JSON. Throws loudly (never silently drops a
 * malformed field) -- a malformed fixture must not resolve to "no exemption" silently; it must
 * surface as a real, visible failure (this hook's caller already wraps this in its own top-level
 * try/catch per criterion 17, which itself writes a halt-state file on any exception). Unknown
 * fields (`notes`, per-entry `note`, or a legacy `expiresOn`/`ratifiedBy`) are ignored, never
 * consumed. */
interface RawCentralClassificationFixture {
  version?: unknown;
  centralLayer?: { tools?: unknown };
  knownConnectors?: unknown;
}

export function parseCentralClassificationFixture(json: string): CentralClassificationFixture {
  const parsed = JSON.parse(json) as RawCentralClassificationFixture;
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error('s5-central-classification.json: "version" must be a non-empty string');
  }
  const tools = parsed.centralLayer?.tools;
  if (!Array.isArray(tools)) {
    throw new Error('s5-central-classification.json: "centralLayer.tools" must be an array');
  }
  const parsedTools = tools.map((entry, i) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).name !== "string" ||
      typeof (entry as Record<string, unknown>).class !== "string" ||
      !VALID_TOOL_CLASSES.has((entry as Record<string, unknown>).class as string)
    ) {
      throw new Error(`s5-central-classification.json: centralLayer.tools[${i}] needs a string "name" and a valid "class"`);
    }
    const e = entry as { name: string; class: ToolClass };
    return { name: e.name, class: e.class };
  });
  if (!Array.isArray(parsed.knownConnectors) || !parsed.knownConnectors.every((n) => typeof n === "string")) {
    throw new Error('s5-central-classification.json: "knownConnectors" must be an array of strings');
  }
  return {
    version: parsed.version,
    centralLayer: { version: parsed.version, tools: parsedTools },
    knownConnectors: parsed.knownConnectors,
  };
}

export function loadCentralClassificationFixture(path: string = DEFAULT_FIXTURE_PATH): CentralClassificationFixture {
  return parseCentralClassificationFixture(readFileSync(path, "utf8"));
}
