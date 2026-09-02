// In-memory RuleSet/layer fixtures (S2 scope: pure fixtures only, no config-file I/O — see
// docs/decisions.md's 2026-09-01 S2 row). Used by src/policy/rule/precedence.test.ts,
// src/policy/rule/schema.test.ts, and src/policy/kernel/kernel.test.ts.
import type { Rule, RuleSet } from "../kernel/rule-types.ts";

/** POL-08 three-layer-conflict case: the SAME rule id, defined with a DIFFERENT effect in all
 * three layers. Precedence order is shipped-defaults, then central, then project (last wins), so
 * the merged result must resolve to `project`'s "deny" — proving the merge is real, not a
 * first-write-wins or a naive union. */
export const CONFLICTING_RULE_ID = "protect-prod-delete";

export const shippedDefaultsLayer: RuleSet = {
  version: "1.0.0",
  rules: [
    {
      id: CONFLICTING_RULE_ID,
      effect: "deny",
      verbs: ["delete"],
      targets: ["prod/"],
      environments: ["prod"],
      rationale: "shipped baseline: never allow delete under prod/ by default",
    },
    {
      id: "allow-dev-writes",
      effect: "allow",
      verbs: ["write"],
      environments: ["dev"],
      rationale: "shipped baseline: writes are unrestricted in dev",
    },
  ],
};

export const centralLayer: RuleSet = {
  version: "1.1.0",
  rules: [
    {
      id: CONFLICTING_RULE_ID,
      effect: "allow",
      verbs: ["delete"],
      targets: ["prod/"],
      environments: ["prod"],
      rationale: "central override: ops team may delete under prod/ during the migration window",
    },
  ],
};

export const projectLayer: RuleSet = {
  version: "1.1.1",
  rules: [
    {
      id: CONFLICTING_RULE_ID,
      effect: "deny",
      verbs: ["delete"],
      targets: ["prod/"],
      environments: ["prod"],
      rationale: "project override: this project reinstates the deny — migration window closed",
    },
  ],
};

export const emptyRuleSet: RuleSet = { version: "0.0.0", rules: [] };

/** A single well-formed rule, reused by schema.test.ts's "valid input" cases. */
export const validRule: Rule = {
  id: "example-rule",
  effect: "deny",
  verbs: ["delete"],
  targets: ["prod/"],
  environments: ["prod"],
  rationale: "example rationale, adjacent to the rule (POL-02)",
};
