// ADR-0021 / REQUIREMENTS.md POL-04: "Every governed tool call MUST be normalized into exactly
// one canonical Action record — fields source, verbs, targets, environment, identity, deferred,
// unresolved — before it reaches the kernel." This is a FLOOR, not a ceiling: a later story MAY
// carry additional non-kernel-branching fields (e.g. audit metadata) on top of these seven; the
// kernel itself (kernel.ts) MUST NOT branch on anything outside them.
//
// The per-tool-type normalizer that PRODUCES a real ActionRecord from a raw tool call (ADR-0021
// shape 3, the normalizer registry) is out of S2's scope — see docs/decisions.md's 2026-09-01 S2
// row ("shape 3 ... deferred out of S2"). This file owns the canonical shape only;
// src/policy/fixtures/action-records.ts supplies in-memory sample records until a real normalizer
// exists.
//
// This file lives inside the kernel purity boundary (src/policy/kernel/**, enforced by
// src/qa/kernel-purity-check.ts, wired into CI) — no filesystem/network/process/timer imports, no
// bare/non-relative imports, no import reaching outside this directory.

export interface ActionRecord {
  /** How confidently the normalizer understood the call — a parse-confidence enum, NOT a
   * tool-family/tool-type field (ADR-0021's Decision table, `adr/software-engineering/0021-
   * thoth-native-architecture.md:111`; REQUIREMENTS.md section 3.1: "source as parsed, structured
   * or opaque"). "parsed" = regex/heuristic understanding; "structured" = the call arrived in an
   * already-structured/typed shape; "opaque" is the fail-closed sentinel a normalizer reports
   * when it cannot classify the call at all (POL-05 denies a mutating action on this value). If a
   * normalizer also wants to track which tool produced the call, that is a SEPARATE,
   * non-kernel-branching field (POL-04's floor-not-ceiling rule) — it does not belong here. */
  source: "parsed" | "structured" | "opaque";
  /** Normalized verb(s), e.g. ["write"], ["delete", "move"]. */
  verbs: string[];
  /** Normalized target identifier(s) — paths, resource names, etc. */
  targets: string[];
  /** Environment the action executes against (e.g. "prod", "staging", "dev"). */
  environment: string;
  /** Acting identity/principal. */
  identity: string;
  /** True when execution is deferred/indirect (e.g. scheduled, queued, triggered by another
   * action) rather than immediate. SUR-09: the kernel evaluates this as execution, never as a
   * lesser class — see kernel.ts's isMutating/pol05Rule, which deliberately never reads this
   * field. */
  deferred: boolean;
  /** Names of fields/facets a normalizer could not resolve. A non-empty array on a mutating
   * action is denied by POL-05, unconditionally. */
  unresolved: string[];
}

const REQUIRED_FIELDS = [
  "source",
  "verbs",
  "targets",
  "environment",
  "identity",
  "deferred",
  "unresolved",
] as const;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Structural floor check: true iff `input` has all seven canonical fields, correctly typed. Extra
 * fields are tolerated (the floor is a minimum, not an exhaustive shape) — POL-04's own "floor,
 * not ceiling" language (ADR-0021).
 */
export function isActionRecord(input: unknown): input is ActionRecord {
  if (typeof input !== "object" || input === null) return false;
  const obj = input as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) return false;
  }
  if (obj.source !== "parsed" && obj.source !== "structured" && obj.source !== "opaque") return false;
  if (!isStringArray(obj.verbs)) return false;
  if (!isStringArray(obj.targets)) return false;
  if (typeof obj.environment !== "string") return false;
  if (typeof obj.identity !== "string") return false;
  if (typeof obj.deferred !== "boolean") return false;
  if (!isStringArray(obj.unresolved)) return false;
  return true;
}
