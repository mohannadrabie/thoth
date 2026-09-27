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
// V2 AND V3 APPLY ONLY TO A RULE WITH AT LEAST ONE VERB WHOSE VERBS ARE ALL CLASS MARKERS (S7-B fix-now
// H1, Issue #328, Manager ruling). The target namespace under the MCP prefix is SHARED with the shell
// normalizer, which emits a redirect target verbatim: a redirect into a directory named like the prefix
// (a dot or underscore in the second segment, no slash, a trailing slash, deeper nesting) is a real
// emitted record and the kernel matches a deny rule on it. Only a marker verb is unreachable from the
// shell (the markers are not in KNOWN_VERBS), so only a marker-only rule provably cannot match a
// shell-emitted record. A rule with no verbs, a legacy verb, or a mix can, and is never rejected by V2
// or V3. R2-13 (loader-reachability.test.ts) proves both halves against the real shell normalizer and
// kernel. Accepted cost: an operator's inert target-only or legacy-verb rule on a mistyped server target
// loads silently (the residual of Issues #328 and #329, routed to the activation story).
//
// NOT rejected, on purpose: the bare MCP prefix (matches every MCP target), a server plus trailing "/",
// a server plus tool, and the legacy mutating verbs plus an MCP target (shape c: matches only
// shell-emitted records and never a class record; documented in tool-class-format.ts, rule-author fact 4,
// and a disclosed residual, Issue #329). A verb that does not start with the marker prefix is out of scope
// (docs/backlog.md).
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
import type { RuleSet } from "../kernel/rule-types.ts";
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

/** True when the rule has at least one verb and every verb is a class marker: the only kind of rule that
 * cannot match a record a shell (or cluster) normalizer emits. No verbs field, or an empty array, matches
 * EVERY verb and is therefore reachable from the shell. */
function hasOnlyMarkerVerbs(verbs: readonly string[] | undefined): boolean {
  return verbs !== undefined && verbs.length > 0 && verbs.every((v) => MARKERS.includes(v));
}

function checkTarget(ruleId: string, target: string, field: string, source: ReachabilitySource): ReachabilityError[] {
  if (!target.startsWith(MCP_TARGET_PREFIX)) return [];
  const rest = target.slice(MCP_TARGET_PREFIX.length);
  if (rest.length === 0) return [];
  const errors: ReachabilityError[] = [];
  const slash = rest.indexOf("/");
  if (slash < 0) {
    errors.push({
      field,
      message: `rule ${quote(ruleId)}: target ${quote(target)} has no "/" after the server name; a target without a trailing "/" matches exactly and no class record's target is a server alone and this rule's verbs are class markers only, so it can never match. ${unlock(source, `write ${quote(`${target}/`)} for every tool of the server, or ${quote(`${target}/<tool>`)} for one tool`)}`,
    });
  }
  const server = slash < 0 ? rest : rest.slice(0, slash);
  if (!ADMISSIBLE_SERVER_NAME.test(server)) {
    errors.push({
      field,
      message: `rule ${quote(ruleId)}: target ${quote(target)} has server segment ${quote(server)}, which is not an admitted server name (${ADMISSIBLE_SERVER_NAME.source}) and this rule's verbs are class markers only, so it can never match a record. ${unlock(source, "use the sanitized runtime name (letters, digits and hyphens only)")}`,
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
    if (hasOnlyMarkerVerbs(rule.verbs)) {
      (rule.targets ?? []).forEach((target, j) => errors.push(...checkTarget(rule.id, target, `rules[${String(i)}].targets[${String(j)}]`, source)));
    }
  });
  return errors;
}
