// S7-B (Issue #306, ruling R2): a rule that provably cannot match any record the normalizers emit is a
// load error, not a silent no-op. The rule schema (src/policy/rule/schema.ts, locked) validates verbs and
// targets as string arrays only, so a typo loads clean and never matches; under an active gate that is a
// deny rule that silently denies nothing. This module is called by loader.ts's parseLayerText after the
// schema check passes, and its errors join the same `schema-invalid` failure (no new failure kind).
//
// Three checks, applied per ELEMENT of `verbs` and `targets` (a rule listing one valid and one mistyped
// marker is rejected, because the mistyped element is inert):
//   V1  a verb that starts with the class-marker prefix and is not one of the class markers.
//   V2  a target that is the MCP target prefix plus a server name with no "/" after it: no CLASS record's
//       target is a server alone (class records are prefix/server/tool), and a pattern without a
//       trailing "/" matches exactly, so it can never match a class record.
//   V3  a target under the MCP prefix whose server segment (up to the first "/") is not an admitted
//       server name (empty, or outside the pattern the server index admits with): the runtime never
//       presents such a name to a class record.
//
// V2 AND V3 APPLY TO A RULE IN EXACTLY TWO CASES (S7-B Issue #328 narrowed them; S7-C Issues #334 and #335,
// Manager rulings, closed the two residuals). The target namespace under the MCP prefix is SHARED with the
// shell normalizer, which emits a redirect target verbatim: a redirect into a directory named like the
// prefix (a dot or underscore in the second segment, no slash, a trailing slash, deeper nesting) is a real
// emitted record and the kernel matches a deny rule on it. So V2 and V3 may reject a rule only when no
// record a normalizer emits can match it, or when accepting it is a silent allow widening:
//   (i)  CLASS-ONLY: the rule's verbs are non-empty, hold at least one class marker, and hold no verb a
//        normalizer emits. The kernel requires the record's verbs to intersect the rule's, and a marker is
//        carried only by a class record (the markers are not in KNOWN_VERBS, so no shell or cluster record
//        has one), so such a rule can match only a class record, and no class record carries a target V2 or
//        V3 rejects. This covers a list of markers only and a marker plus a stray verb (an empty string, a
//        case-variant or a near-miss of a catalog verb, a marker-free stray): the stray verb matches nothing.
//   (ii) ALLOW-WIDENING: the rule's effect is allow and it has no verbs (an absent field or an empty array;
//        both match EVERY verb in the kernel, and schema.ts accepts both). Such a rule CAN match a shell
//        redirect record into a directory of that name (a file write, verb write), so it is not
//        unreachable; it is rejected as a safety rule, because it loads clean and silently widens allow
//        beyond a class record (demonstrated through the real loader and kernel: R2-17 in
//        rule-reachability.test.ts measures that only the write verb widens). A deny rule with no verbs is
//        never checked here: for a deny the same shape only denies more, which fails closed.
// The emitted set is `KNOWN_VERBS` (the action catalog), imported and never retyped: the shell normalizer
// emits a catalog verb plus the write verb (also in the catalog), the cluster normalizer a catalog verb, and
// the tool-class normalizer only a marker. R2-8 scans this file for a retyped verb and R2-19 enumerates the
// verbs the real normalizers emit at run time and fails if one is outside the catalog, so a normalizer that
// someday emits a new verb fails a test instead of silently making this check unsound. Case is exact,
// matching the kernel's verb comparison, so a case-variant of a catalog verb is a stray verb.
// R2-13 (loader-reachability.test.ts) proves the shared-namespace half against the real shell normalizer
// and kernel.
//
// NOT rejected, on purpose: the bare MCP prefix (matches every MCP target), a server plus trailing "/",
// a server plus tool, and the legacy mutating verbs plus an MCP target (shape c: matches only
// shell-emitted records and never a class record; documented in tool-class-format.ts, rule-author fact 4,
// and a disclosed residual, Issue #329). A verb list with no class marker (only stray verbs, none a verb a
// normalizer emits) is out of scope (docs/backlog.md), as is an allow rule keyed on a presentable server
// target without a marker verb (Issue #338).
//
// LAYER-AWARE UNLOCK (S7-B fix-now H6, Issue #333). Every message ends with an `Unlock:` clause naming what the
// person who is BLOCKED can do. A shipped-defaults or project rule lives in a file the operator can edit, so
// the clause names that file. A central rule lives at an out-of-session source that no session can edit, so
// the clause says the central policy owner must correct it and that a session cannot repair it. Availability
// caveat, stated: a schema-valid central rule the check rejects fails the WHOLE load (parseLayerText's
// central failure is a whole-load rejection, as before), so every governed call is denied until the owner
// corrects the source; the message says which layer failed, and the gate's own line is a separate,
// activation-time matter (Issue #308). Ruled by the Manager: keep the whole-load rejection.
//
// The vocabulary (marker prefix, marker table, target prefix, server-name pattern) is IMPORTED from the
// grammar file, never retyped: rule-reachability.test.ts scans this file for a retyped literal and
// drift-checks the check against the vocabulary the normalizers emit. Pure, no I/O.
import type { Rule, RuleSet } from "../kernel/rule-types.ts";
import { KNOWN_VERBS } from "../normalizer/action-catalog.ts";
import { ADMISSIBLE_SERVER_NAME, CLASS_MARKER_PREFIX, CLASS_MARKER_VERBS, MCP_TARGET_PREFIX } from "../normalizer/tool-class-format.ts";

/** Which layer holds the rules being checked, and, for a file-backed layer, the file the operator edits. */
export interface ReachabilitySource {
  layer: "central" | "shipped-defaults" | "project";
  /** The layer's file path (shipped-defaults, project). Absent for central (an out-of-session source). */
  file?: string;
}

export interface ReachabilityError {
  /** Dotted path to the offending element, e.g. "rules[2].verbs[1]" (the loader prints `field: message`). */
  field: string;
  message: string;
}

const MAX_QUOTED = 80;
const MARKERS: readonly string[] = Object.values(CLASS_MARKER_VERBS);

/** Author text (a rule id, a verb, a target) shown in a message: JSON-quoted (so control characters are
 * visible escapes, never raw) and length-bounded. */
function quote(text: string): string {
  return JSON.stringify(text.length > MAX_QUOTED ? `${text.slice(0, MAX_QUOTED)}...` : text);
}

/** The `Unlock: ...` clause: who acts, then the fix. Central: the out-of-session owner (a session cannot edit
 * that source). File-backed layers: the file edit. */
function unlock(source: ReachabilitySource, fix: string): string {
  if (source.layer === "central") {
    return `Unlock: the central policy owner must correct the out-of-session source (a session cannot repair it): ${fix}`;
  }
  return `Unlock: edit ${source.file ?? `the ${source.layer} policy file`}: ${fix}`;
}

function checkVerb(ruleId: string, verb: string, field: string, source: ReachabilitySource): ReachabilityError[] {
  if (!verb.startsWith(CLASS_MARKER_PREFIX) || MARKERS.includes(verb)) return [];
  return [
    {
      field,
      message: `rule ${quote(ruleId)}: verb ${quote(verb)} starts with ${quote(CLASS_MARKER_PREFIX)} but is not a class marker, so it can never match a record. ${unlock(source, `use one of ${MARKERS.join(", ")}`)}`,
    },
  ];
}

/** Why V2 and V3 apply to a rule (they never apply to a rule that can match a shell-emitted record through a
 * verb a normalizer emits, and never to a deny rule with no verbs). */
type TargetScope = "markers-only" | "marker-and-stray" | "allow-widening";

/** The V2/V3 scope of a rule, or undefined when V2 and V3 do not apply. */
function targetScope(rule: Rule): TargetScope | undefined {
  const verbs = rule.verbs;
  if (verbs === undefined || verbs.length === 0) return rule.effect === "allow" ? "allow-widening" : undefined;
  if (verbs.some((v) => KNOWN_VERBS.has(v))) return undefined;
  if (!verbs.some((v) => MARKERS.includes(v))) return undefined;
  return verbs.every((v) => MARKERS.includes(v)) ? "markers-only" : "marker-and-stray";
}

/** The clause of a V2 or V3 message that says why the rule is rejected for this scope. */
function whyRejected(scope: TargetScope): string {
  if (scope === "markers-only") return "this rule's verbs are class markers only, so it can never match a record";
  if (scope === "marker-and-stray") return "this rule's verbs hold a class marker and no verb any normalizer emits, so it can match only a class record and can never match a record";
  return "the rule has no verbs, so it matches every verb and, as an allow rule, can match only a shell redirect into a directory of that name (a file write the baseline may deny), which silently widens allow";
}

/** The fix clause: an allow rule with no verbs needs a class marker verb as well as the corrected target. */
function withMarkerFix(scope: TargetScope, fix: string): string {
  return scope === "allow-widening" ? `add a class marker verb (one of ${MARKERS.join(", ")}) and ${fix}` : fix;
}

function checkTarget(ruleId: string, target: string, field: string, source: ReachabilitySource, scope: TargetScope): ReachabilityError[] {
  if (!target.startsWith(MCP_TARGET_PREFIX)) return [];
  const rest = target.slice(MCP_TARGET_PREFIX.length);
  if (rest.length === 0) return [];
  const errors: ReachabilityError[] = [];
  const slash = rest.indexOf("/");
  if (slash < 0) {
    const fix = withMarkerFix(scope, `write ${quote(`${target}/`)} for every tool of the server, or ${quote(`${target}/<tool>`)} for one tool`);
    errors.push({
      field,
      message: `rule ${quote(ruleId)}: target ${quote(target)} has no "/" after the server name; a target without a trailing "/" matches exactly and no class record's target is a server alone and ${whyRejected(scope)}. ${unlock(source, fix)}`,
    });
  }
  const server = slash < 0 ? rest : rest.slice(0, slash);
  if (!ADMISSIBLE_SERVER_NAME.test(server)) {
    const fix = withMarkerFix(scope, 'use the sanitized runtime name (letters, digits and hyphens only) followed by "/"');
    errors.push({
      field,
      message: `rule ${quote(ruleId)}: target ${quote(target)} has server segment ${quote(server)}, which is not an admitted server name (${ADMISSIBLE_SERVER_NAME.source}) and ${whyRejected(scope)}. ${unlock(source, fix)}`,
    });
  }
  return errors;
}

/** Returns one error per element that can never match. Empty means every rule's verbs and targets pass.
 * `source` shapes the Unlock clause only (never which rules are rejected); the default is the project layer. */
export function checkRuleReachability(ruleSet: RuleSet, source: ReachabilitySource = { layer: "project" }): ReachabilityError[] {
  const errors: ReachabilityError[] = [];
  ruleSet.rules.forEach((rule, i) => {
    (rule.verbs ?? []).forEach((verb, j) => errors.push(...checkVerb(rule.id, verb, `rules[${String(i)}].verbs[${String(j)}]`, source)));
    const scope = targetScope(rule);
    if (scope !== undefined) {
      (rule.targets ?? []).forEach((target, j) => errors.push(...checkTarget(rule.id, target, `rules[${String(i)}].targets[${String(j)}]`, source, scope)));
    }
  });
  return errors;
}
