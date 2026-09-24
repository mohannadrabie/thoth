// Shared, pure vocabulary for data-driven policy (POL-01, POL-02, POL-06, POL-08). Lives inside
// the kernel purity boundary (src/policy/kernel/**) even though the modules that VALIDATE
// (src/policy/rule/schema.ts) and MERGE (src/policy/rule/precedence.ts) this shape live outside
// it — those consume this vocabulary, the kernel boundary is one-directional (what the kernel
// itself may import), not a wall against being depended on.
//
// No standalone .test.ts: this file is pure interface/type declarations with zero runtime logic
// — `npm run typecheck` is its check, matching this repo's convention for type-only modules (e.g.
// src/lib/fs-snapshot.ts's SnapshotDiff has no dedicated behavior test either; logic that touches
// these types is tested where the logic lives — kernel.test.ts, schema.test.ts,
// precedence.test.ts).

import type { VerdictOutcome } from "./verdict.ts";

export type RuleEffect = "allow" | "deny";

export interface Rule {
  id: string;
  effect: RuleEffect;
  /** Verb(s) this rule matches; absent/empty matches any verb. */
  verbs?: string[];
  /** Target pattern(s) this rule matches — exact match, or a prefix when the pattern ends with
   * "/"; absent/empty matches any target. */
  targets?: string[];
  /** Environment(s) this rule applies to; absent/empty matches any environment. */
  environments?: string[];
  /** POL-02: "The configuration format shall support comments and multi-line rationale adjacent
   * to the rule." Carried as data on the rule itself, not stripped by the format. */
  rationale?: string;
  /** POL-07 (S6): when true, no later layer may redefine this rule id — rejected outright,
   * unconditionally, even for a byte-identical redefinition (no field-by-field diff). See
   * src/policy/rule/precedence.ts's `mergeLayersWithMandatoryLock` for the enforcement mechanism;
   * this field itself is pure data — the kernel purity boundary is unaffected (no I/O, no logic). */
  mandatory?: boolean;
}

export interface RuleSet {
  /** POL-06: "Configuration shall be schema-validated and versioned." */
  version: string;
  rules: Rule[];
  /** POL-01 (Issue #112): this layer's declared baseline posture -- the verdict when no rule
   * matches and POL-05 did not fire. Optional; resolved across layers by trust rank (see
   * src/policy/rule/precedence.ts's `mergeLayersWithMandatoryLock`). Pure data: the kernel itself
   * still reads only `WorldFacts.defaultOutcome`, never this field. */
  defaultOutcome?: VerdictOutcome;
}

export interface ValidationError {
  message: string;
  /** Dotted path to the offending key, e.g. "rules[2].effect". */
  field: string;
  expected: string;
}
