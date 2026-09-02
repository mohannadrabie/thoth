// POL-08: "Precedence shall be: shipped defaults, then central policy, then project." Acceptance:
// "Deterministic, documented, inspectable."
//
// This module lives OUTSIDE the kernel purity boundary (src/policy/kernel/**, enforced by
// src/qa/kernel-purity-check.ts) — merging three named layers into one resolved RuleSet is a
// data-preparation step the kernel CONSUMES (via WorldFacts.rules, see
// src/policy/kernel/kernel.ts's decide()), not something the kernel does itself (POL-11: the
// kernel never merges layers or reads a config file). No real config-file loader here either —
// S2 operates on in-memory RuleSet values only; S6 owns loading real layers from disk
// (docs/decisions.md's 2026-09-01 S2 row).
//
// S3 (docs/decisions.md, 2026-09-01 S3-intake row, point 1): SUR-03's tool-classification catalog
// is "built by extending this file's mergeLayers shape, not reinventing it." `mergeLayers` itself
// is UNCHANGED below — same signature, same behavior, same tests still pass — its three-layer
// merge-by-id logic is factored into the generic `mergeLayersById` core, which
// `mergeToolClassificationLayers` (two-tier: shipped + central, per the T5 ruling) also calls.
import type { Rule, RuleSet } from "../kernel/rule-types.ts";
import type {
  MergedToolClassification,
  MergedToolClassificationSet,
  ToolClassificationEntry,
  ToolClassificationSet,
} from "../tools/classification.ts";

export type LayerName = "shipped-defaults" | "central" | "project";

export interface MergedRule extends Rule {
  /** Which layer's definition won for this rule id — POL-08's "inspectable". */
  sourceLayer: LayerName;
}

export interface MergedRuleSet {
  /** The effective configuration's version — see mergeLayers' doc comment for how it resolves. */
  version: string;
  rules: MergedRule[];
}

/**
 * Generic last-layer-wins-by-key merge, shared by `mergeLayers` (POL-08, three-tier, keyed by
 * `Rule.id`) and `mergeToolClassificationLayers` (SUR-03/T5, two-tier, keyed by
 * `ToolClassificationEntry.name`). `keyOf` is the only thing that varies between the two callers —
 * the merge algorithm itself (later layer overrides, first-appearance order preserved) is written
 * exactly once here.
 */
function mergeLayersById<T>(
  layers: readonly { name: LayerName; items: readonly T[] }[],
  keyOf: (item: T) => string,
): { order: string[]; byId: Map<string, { item: T; sourceLayer: LayerName }> } {
  const byId = new Map<string, { item: T; sourceLayer: LayerName }>();
  const order: string[] = [];
  for (const layer of layers) {
    for (const item of layer.items) {
      const key = keyOf(item);
      if (!byId.has(key)) order.push(key);
      byId.set(key, { item, sourceLayer: layer.name });
    }
  }
  return { order, byId };
}

/**
 * Deterministic three-layer merge, in the exact precedence order POL-08 names: `shippedDefaults`
 * applies first, `central` next (overriding any rule id it also defines), `project` last
 * (overriding both). A rule id present in only one layer passes through unchanged, tagged with
 * that layer's name. Rule order in the output follows first-appearance order across the three
 * layers (shipped-defaults, then central, then project) — deterministic and stable regardless of
 * which layer's VALUE ultimately won.
 *
 * `version` resolves to `project`'s version when `project` defines any rule, else `central`'s,
 * else `shippedDefaults`'s — the effective configuration's version is the version of whichever
 * layer actually has the final say over at least one rule.
 */
export function mergeLayers(shippedDefaults: RuleSet, central: RuleSet, project: RuleSet): MergedRuleSet {
  const layers: { name: LayerName; items: readonly Rule[] }[] = [
    { name: "shipped-defaults", items: shippedDefaults.rules },
    { name: "central", items: central.rules },
    { name: "project", items: project.rules },
  ];

  const { order, byId } = mergeLayersById(layers, (rule) => rule.id);

  const version =
    project.rules.length > 0 ? project.version : central.rules.length > 0 ? central.version : shippedDefaults.version;

  const rules: MergedRule[] = [];
  for (const id of order) {
    const entry = byId.get(id);
    if (entry) rules.push({ ...entry.item, sourceLayer: entry.sourceLayer });
  }

  return { version, rules };
}

/**
 * SUR-03 / T5: two-tier tool-classification merge — shipped defaults, then central (overriding
 * any tool name it also defines). No `project` layer: the 2026-09-01 S3-intake ruling names this
 * catalog "shipped defaults + central override, central wins" only, unlike POL-08's three-tier
 * rule precedence. `version` resolves to `central`'s version when `central` classifies any tool,
 * else `shippedDefaults`'s — same resolution rule as `mergeLayers`, one tier shorter.
 */
export function mergeToolClassificationLayers(
  shippedDefaults: ToolClassificationSet,
  central: ToolClassificationSet,
): MergedToolClassificationSet {
  const layers: { name: LayerName; items: readonly ToolClassificationEntry[] }[] = [
    { name: "shipped-defaults", items: shippedDefaults.tools },
    { name: "central", items: central.tools },
  ];

  const { order, byId } = mergeLayersById(layers, (entry) => entry.name);

  const version = central.tools.length > 0 ? central.version : shippedDefaults.version;

  const tools: MergedToolClassification[] = [];
  for (const name of order) {
    const entry = byId.get(name);
    if (entry) tools.push({ ...entry.item, sourceLayer: entry.sourceLayer });
  }

  return { version, tools };
}
