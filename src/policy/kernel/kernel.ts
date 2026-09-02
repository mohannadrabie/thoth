// ADR-0021 "Rules for agents" this file implements directly:
//   - "The policy kernel MUST be pure: no filesystem, network, or process access; every world
//     fact it decides against is passed in as an argument, never fetched (POL-11)."
//   - "The kernel MUST deny a mutating action whose Action record has source: opaque or a
//     non-empty unresolved array (POL-05)."
//   - "The kernel MUST evaluate the Action record's deferred field as execution, not as a lesser
//     class of action (SUR-09)."
//   - "No filesystem, network, process-spawning, timer, or vendor-SDK import MAY appear anywhere
//     under the kernel's own module boundary ... enforced by a lint rule or structural test"
//     — that structural test is src/qa/kernel-purity-check.ts, wired into CI, scanning every
//     production .ts file under src/policy/kernel/**.
//
// docs/decisions.md's 2026-09-01 S2 row scopes this story to shapes 1 (kernel) + 2 (Action
// record) only, pure in-memory: no config-file loader (S6's job), no normalizer registry
// (ADR-0021 shape 3, a later story). `decide()` therefore consumes an already-resolved,
// already-validated RuleSet as data (via WorldFacts) — merging layers (POL-08,
// src/policy/rule/precedence.ts) and validating shape (POL-06, src/policy/rule/schema.ts) both
// happen OUTSIDE the kernel boundary, on the caller's side, and their output is passed in whole.

import type { ActionRecord } from "./action-record.ts";
import type { Rule, RuleSet } from "./rule-types.ts";
import type { Verdict, VerdictOutcome } from "./verdict.ts";

/**
 * Verbs this kernel treats as mutating (state-changing). POL-05 governs a MUTATING action only
 * ("deny a mutating action whose record is opaque...") — a read/inspect-only action with an
 * opaque source is not itself a POL-05 violation. This set is deliberately small and named, not
 * derived: the normalizer registry (ADR-0021 shape 3, deferred out of S2 per docs/decisions.md's
 * 2026-09-01 S2 row) is what will eventually own tool-specific verb vocabularies; the kernel only
 * needs to know which of the ALREADY-NORMALIZED verbs it receives count as mutating.
 */
const MUTATING_VERBS: ReadonlySet<string> = new Set([
  "write",
  "create",
  "modify",
  "delete",
  "move",
  "rename",
  "execute",
]);

/**
 * True if any of the action's verbs is mutating, OR the record carries any unresolved field.
 * Deliberately does NOT read `action.deferred` — SUR-09 requires a deferred/indirect action to be
 * evaluated as execution, not a lesser class, so this function has no special case for it at all.
 * The fix for SUR-09 is the absence of a branch; kernel.test.ts proves it by asserting identical
 * verdicts for otherwise-identical deferred vs. immediate actions.
 *
 * ISSUE #62 HISTORY (app-security-reviewer, S2 review 2026-09-01, re-confirmed on re-review):
 * this function originally gated POL-05's fail-closed check on the hardcoded verb list ALONE. The
 * first fix-now pass added a code comment documenting a normalizer invariant ("any unresolved
 * verb MUST be surfaced via `unresolved`") but did not change this function's actual behavior —
 * so an action whose verb this function did not classify as mutating, and which ALSO had a
 * non-empty `unresolved` array, was still invisible to POL-05: `isMutating` returned `false`,
 * `pol05Rule` never even inspected `unresolved`, and the action silently resolved to `allow`. The
 * reviewer reproduced this directly (verbs: ["patch"], unresolved: ["verbs[0]"] -> allow). That is
 * the actual bug this function now fixes: `isMutating` returns `true` whenever
 * `action.unresolved.length > 0`, independent of verb classification — ambiguity forces the check
 * to run regardless of whether the verb list recognizes the verb. This is additive (OR) to the
 * existing verb-list check, not a replacement for it.
 *
 * REMAINING, DELIBERATELY-DEFERRED GAP (tracked in docs/backlog.md, "S2 re-confirm" entry, owned
 * by ADR-0021 shape 3 / the normalizer registry, a later story, needing a real action catalog): a
 * normalizer that emits an unclassifiable verb WITHOUT reporting it via `unresolved` at all (verb
 * outside MUTATING_VERBS, `unresolved` empty) is still not caught here — that failure mode is a
 * normalizer bug, out of this function's power to detect from the Action record alone, and must
 * be prevented at the point the record is produced. This function does not attempt to guess at an
 * unrecognized verb's mutating-ness; it only guarantees that a verb the normalizer FLAGGED as
 * ambiguous (via `unresolved`) is never silently exempted from POL-05, no matter what the verb
 * string itself is.
 */
export function isMutating(action: ActionRecord): boolean {
  return action.verbs.some((v) => MUTATING_VERBS.has(v)) || action.unresolved.length > 0;
}

/**
 * POL-05, evaluated inside the kernel (ADR-0021): a mutating action whose source is "opaque", or
 * which carries any unresolved field, is denied — unconditionally. This is the one hard-coded,
 * always-on kernel rule ("one rule, one place" per REQUIREMENTS.md POL-05's acceptance text);
 * every other verdict comes from data (see matchRules/decide below). Also does not read
 * `action.deferred` (SUR-09 — see isMutating above). Returns null when POL-05 does not fire (a
 * non-mutating action, or a mutating action with a resolved source and no unresolved fields) —
 * decide() then falls through to data-driven rule matching.
 *
 * Gates on `isMutating(action)` FIRST. Since `isMutating` itself now returns `true` whenever
 * `action.unresolved.length > 0` (Issue #62 fix, see isMutating above), this early gate can no
 * longer skip an action that carries unresolved fields, regardless of its verb classification —
 * the ambiguity check below is always reached for any record `unresolved` flags as ambiguous. The
 * only case this gate still exits early on is a genuinely non-mutating, non-ambiguous action
 * (verb not in MUTATING_VERBS AND `unresolved` empty) — see isMutating's REMAINING GAP note for
 * the one normalizer failure mode still outside this function's power to detect.
 */
export function pol05Rule(action: ActionRecord): Verdict | null {
  if (!isMutating(action)) return null;

  if (action.source === "opaque") {
    return {
      outcome: "deny",
      reason: "POL-05: mutating action's source is opaque — fail-closed on ambiguity",
      ruleId: "POL-05",
    };
  }

  if (action.unresolved.length > 0) {
    return {
      outcome: "deny",
      reason: `POL-05: mutating action has unresolved field(s) [${action.unresolved.join(", ")}] — fail-closed on ambiguity`,
      ruleId: "POL-05",
    };
  }

  return null;
}

function matchesVerb(rule: Rule, action: ActionRecord): boolean {
  const verbs = rule.verbs;
  if (!verbs || verbs.length === 0) return true;
  return action.verbs.some((v) => verbs.includes(v));
}

function matchesTarget(rule: Rule, action: ActionRecord): boolean {
  const targets = rule.targets;
  if (!targets || targets.length === 0) return true;
  return action.targets.some((t) =>
    targets.some((pattern) => (pattern.endsWith("/") ? t.startsWith(pattern) : t === pattern)),
  );
}

function matchesEnvironment(rule: Rule, action: ActionRecord): boolean {
  const environments = rule.environments;
  if (!environments || environments.length === 0) return true;
  return environments.includes(action.environment);
}

/**
 * POL-01 ("policy shall be expressed as data. No rule an operator is expected to tune shall live
 * in a code literal"): the rules from `rules` that apply to `action`. `rules` is data passed in
 * (see WorldFacts) — this function contains no forbidden-action/protected-path/tool-class/tier
 * literals of its own. Exported for inspectability (POL-08's "deterministic, documented,
 * inspectable").
 */
export function matchRules(rules: readonly Rule[], action: ActionRecord): Rule[] {
  return rules.filter(
    (r) => matchesVerb(r, action) && matchesTarget(r, action) && matchesEnvironment(r, action),
  );
}

export interface WorldFacts {
  /** The resolved, already-merged policy (POL-08's precedence merge — see
   * src/policy/rule/precedence.ts — happens OUTSIDE the kernel boundary; its output is passed in
   * whole, per POL-11: the kernel never merges layers or reads a config file itself). */
  rules: RuleSet;
  /** Verdict when no rule in `rules` matches `action` and POL-05 did not fire. A value, not an
   * inferred default — POL-01's "no rule ... lives in a code literal" applies to this baseline
   * posture too. */
  defaultOutcome: VerdictOutcome;
}

/**
 * decide(worldFacts, action) — the single kernel decision function (ADR-0021 shape 1).
 * Precedence, highest first:
 *   1. POL-05's fail-closed rule (unconditional, SUR-09-consistent — see pol05Rule).
 *   2. A matching configured rule from worldFacts.rules — DENY wins over ALLOW when both match
 *      (fail-closed leaning, consistent with POL-05's own spirit).
 *   3. worldFacts.defaultOutcome.
 */
export function decide(worldFacts: WorldFacts, action: ActionRecord): Verdict {
  const pol05 = pol05Rule(action);
  if (pol05) return pol05;

  const matched = matchRules(worldFacts.rules.rules, action);

  const denyMatch = matched.find((r) => r.effect === "deny");
  if (denyMatch) {
    return {
      outcome: "deny",
      reason: denyMatch.rationale ?? `denied by rule ${denyMatch.id}`,
      ruleId: denyMatch.id,
    };
  }

  const allowMatch = matched.find((r) => r.effect === "allow");
  if (allowMatch) {
    return {
      outcome: "allow",
      reason: allowMatch.rationale ?? `allowed by rule ${allowMatch.id}`,
      ruleId: allowMatch.id,
    };
  }

  return {
    outcome: worldFacts.defaultOutcome,
    reason: "no kernel-level or configured rule matched this action — falling back to the configured default outcome",
  };
}
