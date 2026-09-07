// S5 Phase 1 plan v3 (docs/plans/S5-phase1-2026-09-06.md), criterion 13 (DERIVED, load-bearing):
// "the bootstrap RuleSet/environment/identity values are explicit, disclosed placeholders pending
// S6/S11a — not a §0.4-compliance claim." With no real central-policy loader yet (S6, T10 still
// open), the live `PreToolUse` hook needs SOME concrete `WorldFacts` to call `kernel.decide()`
// against today, or the whole mechanism cannot go live before S6 ships. This file is that
// disclosed placeholder — nothing here claims to BE the real, centrally-authored policy §0.4
// requires.
//
// `rules: []` — no bootstrap rule exists yet. POL-08's real three-layer merge
// (shipped-defaults/central/project, src/policy/rule/precedence.ts's `mergeLayers`) is S6's job;
// this file does not attempt it. Real deny-by-default policy content (an authored, reviewed
// allow/deny rule set) is what S6 delivers.
//
// `defaultOutcome: "allow"` — a real decision, not an oversight, made explicit here because
// test-writer's own report (docs/reviews/s5-deny-by-default-hook-wiring-test-writer-2026-09-06.md)
// flagged this exact value as load-bearing and ambiguous, requiring "a build-time conversation with
// story-implementer, not a silent edit." Resolved as follows:
//   1. This matches this repo's OWN established test-fixture convention, not a fresh guess:
//      src/policy/kernel/kernel.test.ts:258 and src/policy/normalizer/registry.test.ts:80 both
//      already use `defaultOutcome: "allow"` as the baseline in every existing kernel/registry
//      test — this file's value is consistent with that precedent, not invented for S5.
//   2. Milestone #23's own name ("Deny-by-default") does NOT mean this placeholder's default must
//      itself be "deny" — the actual deny-by-default MECHANISM already shipped and stays fully
//      load-bearing regardless of this value: POL-05 (S2, kernel.ts's `pol05Rule`) unconditionally
//      denies any MUTATING action whose source is "opaque" or whose `unresolved` array is
//      non-empty, BEFORE `defaultOutcome` is ever reached (see kernel.ts's `decide()` precedence
//      order: POL-05 first, configured rules second, `defaultOutcome` last). `defaultOutcome` only
//      governs the residual case of a CLEANLY-RESOLVED, NON-mutating, NON-ambiguous action (e.g. a
//      `kubectl get`, not a `kubectl delete`) that matches no configured rule.
//   3. Setting this to "deny" here would deny literally every read-only call made through this
//      hook in any session with no real policy loaded yet — an untested, materially different and
//      more disruptive shape than any reviewer round or acceptance criterion for this story has
//      asked for (hooks/pretooluse-kernel-gate.test.ts's own AC-2 test asserts the opposite).
//      Recorded here, once, per this file's own header, rather than silently resolved in code with
//      no trace — see docs/decisions.md's S5 build-time row for the same statement in the decision
//      log.
import type { RuleSet } from "../kernel/rule-types.ts";
import type { VerdictOutcome } from "../kernel/verdict.ts";

/** See this file's header comment, point 2/3 above, for why "allow" is the correct bootstrap
 * value — not itself a claim that the mechanism is permissive; POL-05 governs ambiguity
 * unconditionally regardless of this value. */
export const BOOTSTRAP_DEFAULT_OUTCOME: VerdictOutcome = "allow";

export function loadBootstrapRuleSet(): RuleSet {
  return {
    version: "0.0.0-bootstrap",
    rules: [],
  };
}
