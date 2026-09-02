import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRule, validateRuleSet } from "./schema.ts";
import { validRule } from "../fixtures/rules.ts";

function omit(obj: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
}

test("validateRule: a well-formed rule -> 0 errors", () => {
  assert.deepEqual(validateRule(validRule), []);
});

test("validateRule: non-object input -> 1 error naming the root", () => {
  const errors = validateRule("not-an-object");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.field, "<root>");
});

test("validateRule (POL-06): an unknown key is an error, naming the key and the expected set", () => {
  const errors = validateRule({ ...validRule, extra: "surprise" });
  const unknown = errors.find((e) => e.field === "extra");
  assert.ok(unknown, "unknown key must be reported, not silently dropped");
  assert.match(unknown.message, /unknown key "extra"/);
  assert.match(unknown.expected, /id, effect, verbs, targets, environments, rationale/);
});

test("validateRule: missing id -> error naming field=id and expected shape", () => {
  const errors = validateRule(omit(validRule, "id"));
  const idError = errors.find((e) => e.field === "id");
  assert.ok(idError);
  assert.equal(idError.expected, "non-empty string");
});

test("validateRule: empty-string id is rejected", () => {
  const errors = validateRule({ ...validRule, id: "" });
  assert.ok(errors.some((e) => e.field === "id"));
});

test('validateRule: effect must be "allow" or "deny"', () => {
  const errors = validateRule({ ...validRule, effect: "maybe" });
  const effectError = errors.find((e) => e.field === "effect");
  assert.ok(effectError);
  assert.equal(effectError.expected, '"allow" | "deny"');
});

test("validateRule: verbs/targets/environments must be string arrays when present", () => {
  for (const field of ["verbs", "targets", "environments"] as const) {
    const errors = validateRule({ ...validRule, [field]: [1, 2] });
    assert.ok(errors.some((e) => e.field === field), `${field} with non-string entries should error`);
  }
});

test("validateRule: rationale must be a string when present", () => {
  const errors = validateRule({ ...validRule, rationale: 42 });
  assert.ok(errors.some((e) => e.field === "rationale"));
});

test("validateRuleSet: a well-formed rule set -> 0 errors", () => {
  const ruleSet = { version: "1.0.0", rules: [validRule] };
  assert.deepEqual(validateRuleSet(ruleSet), []);
});

test("validateRuleSet: non-object input -> 1 error naming the root", () => {
  const errors = validateRuleSet(null);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.field, "<root>");
});

test("validateRuleSet (POL-06): an unknown top-level key is an error, not a silent no-op", () => {
  const errors = validateRuleSet({ version: "1.0.0", rules: [], mystery: true });
  const unknown = errors.find((e) => e.field === "mystery");
  assert.ok(unknown);
  assert.match(unknown.expected, /version, rules/);
});

test("validateRuleSet: missing version -> error naming field=version", () => {
  const errors = validateRuleSet({ rules: [] });
  assert.ok(errors.some((e) => e.field === "version"));
});

test("validateRuleSet: rules must be an array; missing rules short-circuits without a per-rule scan", () => {
  const errors = validateRuleSet({ version: "1.0.0" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.field, "rules");
});

test("validateRuleSet: a bad rule inside the array is reported with an indexed, nested field path", () => {
  const errors = validateRuleSet({ version: "1.0.0", rules: [{ id: "", effect: "deny" }] });
  const idError = errors.find((e) => e.field === "rules[0].id");
  assert.ok(idError, "nested rule errors must carry the indexed path, e.g. rules[0].id");
});

test("validateRuleSet: multiple rules are each validated independently", () => {
  const errors = validateRuleSet({
    version: "1.0.0",
    rules: [{ id: "ok", effect: "allow" }, { id: "", effect: "bogus" }],
  });
  assert.ok(errors.some((e) => e.field === "rules[1].id"));
  assert.ok(errors.some((e) => e.field === "rules[1].effect"));
  assert.equal(errors.filter((e) => e.field.startsWith("rules[0]")).length, 0);
});
