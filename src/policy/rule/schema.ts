// POL-06: "Configuration shall be schema-validated and versioned, rejected with a message naming
// the offending key and expected shape." Acceptance: "Unknown key is an error, not a silent
// no-op."
//
// Operates on `unknown` input by design — S2 has no real config-file loader (see
// docs/decisions.md's 2026-09-01 S2 row; that is S6's job), but this validator is written to
// accept untyped/parsed-JSON-shaped input from day one so S6 can call it directly on a loader's
// parsed output with no rewrite. Lives outside the kernel purity boundary
// (src/policy/kernel/**) — the kernel never validates configuration itself (POL-11).
import type { ValidationError } from "../kernel/rule-types.ts";

const RULE_KEYS = ["id", "effect", "verbs", "targets", "environments", "rationale"] as const;
const RULE_SET_KEYS = ["version", "rules"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * POL-06: validates a single rule. Every unknown key is reported (not silently dropped); every
 * error names the offending field (dotted path, honoring `pathPrefix` for nested callers) and the
 * expected shape.
 */
export function validateRule(input: unknown, pathPrefix = ""): ValidationError[] {
  const at = (field: string): string => (pathPrefix ? `${pathPrefix}.${field}` : field);

  if (!isRecord(input)) {
    return [{ message: "rule must be an object", field: pathPrefix || "<root>", expected: "object" }];
  }

  const errors: ValidationError[] = [];

  for (const key of Object.keys(input)) {
    if (!(RULE_KEYS as readonly string[]).includes(key)) {
      errors.push({
        message: `unknown key "${key}"`,
        field: at(key),
        expected: `one of: ${RULE_KEYS.join(", ")}`,
      });
    }
  }

  if (typeof input.id !== "string" || input.id.length === 0) {
    errors.push({ message: "id is required and must be a non-empty string", field: at("id"), expected: "non-empty string" });
  }

  if (input.effect !== "allow" && input.effect !== "deny") {
    errors.push({ message: 'effect must be "allow" or "deny"', field: at("effect"), expected: '"allow" | "deny"' });
  }

  for (const field of ["verbs", "targets", "environments"] as const) {
    if (field in input && input[field] !== undefined && !isStringArray(input[field])) {
      errors.push({ message: `${field} must be an array of strings`, field: at(field), expected: "string[]" });
    }
  }

  if ("rationale" in input && input.rationale !== undefined && typeof input.rationale !== "string") {
    errors.push({ message: "rationale must be a string", field: at("rationale"), expected: "string" });
  }

  return errors;
}

/**
 * POL-06: validates a whole rule set — versioned, schema-checked, every rule validated in turn.
 */
export function validateRuleSet(input: unknown): ValidationError[] {
  if (!isRecord(input)) {
    return [{ message: "rule set must be an object", field: "<root>", expected: "object" }];
  }

  const errors: ValidationError[] = [];

  for (const key of Object.keys(input)) {
    if (!(RULE_SET_KEYS as readonly string[]).includes(key)) {
      errors.push({
        message: `unknown key "${key}"`,
        field: key,
        expected: `one of: ${RULE_SET_KEYS.join(", ")}`,
      });
    }
  }

  if (typeof input.version !== "string" || input.version.length === 0) {
    errors.push({ message: "version is required and must be a non-empty string", field: "version", expected: "non-empty string" });
  }

  if (!Array.isArray(input.rules)) {
    errors.push({ message: "rules is required and must be an array", field: "rules", expected: "Rule[]" });
    return errors;
  }

  input.rules.forEach((rule: unknown, i: number) => {
    errors.push(...validateRule(rule, `rules[${i}]`));
  });

  return errors;
}
