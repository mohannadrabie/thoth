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
import type { Rule, RuleSet } from "../kernel/rule-types.ts";

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
  const layers: { name: LayerName; ruleSet: RuleSet }[] = [
    { name: "shipped-defaults", ruleSet: shippedDefaults },
    { name: "central", ruleSet: central },
    { name: "project", ruleSet: project },
  ];

  const byId = new Map<string, MergedRule>();
  const order: string[] = [];
  for (const layer of layers) {
    for (const rule of layer.ruleSet.rules) {
      if (!byId.has(rule.id)) order.push(rule.id);
      byId.set(rule.id, { ...rule, sourceLayer: layer.name });
    }
  }

  const version =
    project.rules.length > 0 ? project.version : central.rules.length > 0 ? central.version : shippedDefaults.version;

  const rules: MergedRule[] = [];
  for (const id of order) {
    const rule = byId.get(id);
    if (rule) rules.push(rule);
  }

  return { version, rules };
}
