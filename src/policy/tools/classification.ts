// SUR-03: "Every tool available to the session shall be inventoried and classified as read-only,
// workspace-mutating or remote-mutating, and the classification shall drive enforcement."
// Acceptance: "Session start enumerates tools and halts on any unclassified one."
//
// This story (S3) builds the classification/halt-decision function only, against a fixture tool
// list — real session-tool introspection and the hook wiring that halts a live session is
// ADR-0021 shape 4 (gate surfaces), which lands in S5 (docs/decisions.md, 2026-09-01 S3-intake
// row, point 2).
//
// T5 (docs/decisions.md, 2026-09-01 S3-intake row, point 1): the classification catalog is
// two-tier layered — shipped defaults + central override, central wins — the same
// deterministic/inspectable shape POL-08 already established for rule precedence
// (src/policy/rule/precedence.ts's mergeLayers), extended rather than reinvented (see
// mergeToolClassificationLayers there). Pure in-memory/fixture data — real central-config loading
// stays deferred to S6, same as POL-08's own rules (docs/decisions.md, 2026-09-01 S2-scope row
// precedent).
import type { LayerName } from "../rule/precedence.ts";

export type ToolClass = "read-only" | "workspace-mutating" | "remote-mutating";

export interface ToolClassificationEntry {
  /** The tool's name as the runtime reports it. SUR-05 (verifying gate matchers against the
   * runtime's actual tool names) is out of S3's scope — this field just carries whatever name the
   * catalog was authored against. */
  name: string;
  class: ToolClass;
}

export interface ToolClassificationSet {
  version: string;
  tools: ToolClassificationEntry[];
}

export interface MergedToolClassification extends ToolClassificationEntry {
  /** Which layer's definition won for this tool name — same "inspectable" property POL-08's
   * MergedRule.sourceLayer already provides. */
  sourceLayer: LayerName;
}

export interface MergedToolClassificationSet {
  version: string;
  tools: MergedToolClassification[];
}

export interface ToolInventoryResult {
  /** Every session tool that WAS classified, with its resolved class. */
  classified: { name: string; class: ToolClass }[];
  /** Every session tool with no entry in the merged catalog. */
  unclassified: string[];
  /** True the instant `unclassified` is non-empty — SUR-03's "halts on any unclassified one",
   * fail-closed by construction: ANY single unclassified tool halts the whole evaluation, never
   * defaulting an unrecognized tool to an implicit class. This mirrors POL-05's own "one rule, one
   * place" fail-closed shape rather than repeating the shape of S2's Issue #62 near-miss (an
   * unrecognized case silently defaulting to a permissive outcome) — see docs/backlog.md. */
  haltRequired: boolean;
}

/**
 * The classification/halt-decision function (S3's scope, per the 2026-09-01 S3-intake ruling) —
 * pure, no session introspection: `sessionTools` is a caller-supplied fixture list, not read from
 * a live session.
 */
export function evaluateToolInventory(
  catalog: MergedToolClassificationSet,
  sessionTools: readonly string[],
): ToolInventoryResult {
  const byName = new Map(catalog.tools.map((t) => [t.name, t.class]));
  const classified: { name: string; class: ToolClass }[] = [];
  const unclassified: string[] = [];

  for (const name of sessionTools) {
    const toolClass = byName.get(name);
    if (toolClass) {
      classified.push({ name, class: toolClass });
    } else {
      unclassified.push(name);
    }
  }

  return { classified, unclassified, haltRequired: unclassified.length > 0 };
}
