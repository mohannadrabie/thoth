// docs/qa/s5-central-classification.json is the committed, dated, separately-reviewable fixture
// backing hooks/sessionstart-tool-enum.mjs's two disclosed interim exemption mechanisms. This
// module is the ONLY code path that reads that file -- the hook never hardcodes either allowlist
// inline (S5 Stage-3 CRITICAL review round 1 finding: `red-team` F1/F10, `app-security-reviewer`
// finding 1, `cross-domain-reviewer` finding 1 -- GitHub Issues #90/#92/#98).
//
// (1) `centralLayer` -- SUR-03's "central override" classification tier (T5,
//     src/policy/rule/precedence.ts's `mergeToolClassificationLayers` second argument) for
//     locally-declared MCP servers. Its `class` field is presence-only / inert today (GitHub Issue
//     #93, confirmed by `red-team`: mutating an entry to `class:"read-only"` left the full test/lint/
//     qa-gate suite green) -- no consumer reads it before S6's real central policy ships. Classifying
//     a tool here only removes it from SUR-03's unclassified/halt set; it does not itself drive any
//     enforcement decision. Tracked at docs/backlog.md ("Issue #93" entry) as S6's job, not built here.
//
// (2) `knownConnectors` -- a claude.ai account-connector display-name allowlist, human-ratified as a
//     KNOWN, DATED, SPOOFABLE residual risk -- see docs/decisions.md's 2026-09-07 row ("S5 Stage-3
//     CRITICAL review round 1 (`red-team` no-go, `app-security-reviewer`/`cross-domain-reviewer`
//     REWORK)..."), item (1). This is a pure display-name STRING match against `~/.claude.json`'s
//     `claudeAiMcpEverConnected` array -- no connector ID, URL, OAuth scope, or any other
//     identity-binding signal exists at this layer (confirmed via direct `~/.claude.json` inspection
//     during this story's own investigation; `src/policy/tools/mcp-enumeration.ts` deliberately never
//     reads anything else). It is NOT a real security control: a connector renamed, or a new
//     connector deliberately named identically to one of the entries below, defeats this exemption
//     completely (GitHub Issue #90). It ships anyway ONLY because the human explicitly reviewed and
//     accepted this exact risk, dated and time-boxed via `expiresOn` below to force renewal -- an
//     unverified third party's claim about its own identity IS the control here, accepted knowingly.
//
// EXPIRY IS ENFORCED AT RUNTIME, NOT ONLY IN CI: `isFixtureExpired()` below is checked by
// hooks/sessionstart-tool-enum.mjs on every SessionStart run (see that file's own
// `computeSessionTools`). Once today's date reaches the fixture's own `expiresOn`, BOTH exemptions
// stop being applied automatically -- every locally-declared MCP server in `centralLayer.tools`
// reverts to unclassified (halts), and every connector name reverts to unknown (halts) -- until a
// human re-ratifies with a fresh `expiresOn` (a new docs/decisions.md row) or removes the exemption
// outright. This is the concrete mechanism behind "never silently rolled forward": an unrenewed
// exemption fails CLOSED at runtime, it does not keep running on its last-known-good state.
//
// A day-1 regression test (central-classification.test.ts) separately pins this fixture's exact
// contents (one assertion per allowlist, per `red-team`'s own named-test requirement) and asserts
// `expiresOn` is still in the future -- CI fails loudly, forcing a human decision, well before the
// runtime enforcement above would otherwise change live behavior with no build-time warning.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ToolClass, ToolClassificationSet } from "./classification.ts";

export interface CentralClassificationFixture {
  version: string;
  expiresOn: string; // YYYY-MM-DD, UTC-midnight boundary -- see isFixtureExpired below
  ratifiedBy: string;
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
 * try/catch per criterion 17, which itself writes a halt-state file on any exception). */
interface RawCentralClassificationFixture {
  version?: unknown;
  expiresOn?: unknown;
  ratifiedBy?: unknown;
  centralLayer?: { tools?: unknown };
  knownConnectors?: unknown;
}

export function parseCentralClassificationFixture(json: string): CentralClassificationFixture {
  const parsed = JSON.parse(json) as RawCentralClassificationFixture;
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error('s5-central-classification.json: "version" must be a non-empty string');
  }
  if (typeof parsed.expiresOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.expiresOn)) {
    throw new Error('s5-central-classification.json: "expiresOn" must be a YYYY-MM-DD string');
  }
  if (typeof parsed.ratifiedBy !== "string" || parsed.ratifiedBy.length === 0) {
    throw new Error('s5-central-classification.json: "ratifiedBy" must be a non-empty string (cite the ratifying decisions.md row)');
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
    expiresOn: parsed.expiresOn,
    ratifiedBy: parsed.ratifiedBy,
    centralLayer: { version: parsed.version, tools: parsedTools },
    knownConnectors: parsed.knownConnectors,
  };
}

export function loadCentralClassificationFixture(path: string = DEFAULT_FIXTURE_PATH): CentralClassificationFixture {
  return parseCentralClassificationFixture(readFileSync(path, "utf8"));
}

/** True once `now` (default: real current time) has reached or passed the fixture's own
 * `expiresOn` date -- see this file's header comment ("EXPIRY IS ENFORCED AT RUNTIME"). Compared
 * as a UTC-midnight boundary, not the caller's own local timezone -- this exact diff's own earlier
 * draft mixed UTC and local dates in its comments (red-team's provenance note), so this function
 * makes the comparison basis explicit and untestable-wrong rather than relying on every caller to
 * remember it. */
export function isFixtureExpired(fixture: Pick<CentralClassificationFixture, "expiresOn">, now: Date = new Date()): boolean {
  const expiry = new Date(`${fixture.expiresOn}T00:00:00.000Z`);
  return now.getTime() >= expiry.getTime();
}
