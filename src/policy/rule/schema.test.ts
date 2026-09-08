import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRule, validateRuleSet, findDuplicateTopLevelKeys } from "./schema.ts";
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

// --- AC4 (S6, POL-07): the "mandatory" key ------------------------------------------------------

test("validateRule (AC4): mandatory=true is accepted (0 errors)", () => {
  assert.deepEqual(validateRule({ ...validRule, mandatory: true }), []);
});

test("validateRule (AC4): mandatory=false is accepted (0 errors)", () => {
  assert.deepEqual(validateRule({ ...validRule, mandatory: false }), []);
});

test("validateRule (AC4): a non-boolean mandatory value is rejected, naming the field and expected shape", () => {
  const errors = validateRule({ ...validRule, mandatory: "true" });
  const mandatoryError = errors.find((e) => e.field === "mandatory");
  assert.ok(mandatoryError, "a string \"true\" must not silently pass as the boolean true");
  assert.equal(mandatoryError.expected, "boolean");
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

// --- Stage-3 round-1 fix-now (2026-09-08), Issue #105 + red-team's extension [MED] --------------

test("validateRuleSet (Issue #105): a duplicate rule id within one rule set is rejected, naming the id and both indices", () => {
  const errors = validateRuleSet({
    version: "1.0.0",
    rules: [{ id: "dup", effect: "allow" }, { id: "dup", effect: "deny" }],
  });
  const dupError = errors.find((e) => e.field === "rules[1].id");
  assert.ok(dupError, "the SECOND occurrence must be flagged, naming both indices");
  assert.match(dupError.message, /duplicate rule id "dup"/);
  assert.match(dupError.message, /rules\[0\]/);
  assert.match(dupError.message, /rules\[1\]/);
  assert.equal(errors.filter((e) => e.field === "rules[0].id").length, 0, "the FIRST occurrence is not itself flagged");
});

test("validateRuleSet (Issue #105): three-way duplicate rule id flags the 2nd and 3rd occurrences, not the 1st", () => {
  const errors = validateRuleSet({
    version: "1.0.0",
    rules: [{ id: "x", effect: "allow" }, { id: "x", effect: "deny" }, { id: "x", effect: "allow" }],
  });
  assert.equal(errors.filter((e) => e.field === "rules[0].id").length, 0);
  assert.ok(errors.some((e) => e.field === "rules[1].id"));
  assert.ok(errors.some((e) => e.field === "rules[2].id"));
});

test("validateRuleSet: distinct rule ids never false-positive as duplicates", () => {
  assert.deepEqual(
    validateRuleSet({ version: "1.0.0", rules: [{ id: "a", effect: "allow" }, { id: "b", effect: "deny" }] }),
    [],
  );
});

test("findDuplicateTopLevelKeys: a document with two top-level \"rules\" keys reports \"rules\" as duplicated", () => {
  const text = `{
  "version": "1.0.0",
  "rules": [ { "id": "decoy", "effect": "allow" } ],
  "rules": [ { "id": "real", "effect": "deny" } ]
}`;
  assert.deepEqual(findDuplicateTopLevelKeys(text), ["rules"]);
});

test("findDuplicateTopLevelKeys: no duplicates -> empty array, including when a nested rule contains a key with the same name as a top-level key", () => {
  const text = `{"version":"1.0.0","rules":[{"id":"a","effect":"allow","rationale":"contains \\"version\\": 1 as text"}]}`;
  assert.deepEqual(findDuplicateTopLevelKeys(text), []);
});

test("findDuplicateTopLevelKeys: braces/brackets/quotes INSIDE a string value never perturb depth tracking", () => {
  const text = `{"version":"1.0.0","rules":[{"id":"a","effect":"allow","rationale":"{\\"nested\\":[1,2]} looks like JSON but is just text"}]}`;
  assert.deepEqual(findDuplicateTopLevelKeys(text), []);
});

test("validateRuleSet (Issue #105): a duplicate top-level \"rules\" key is rejected when rawText is supplied, and the SILENTLY-KEPT (last) array is still validated per-rule", () => {
  const text = `{
  "version": "1.0.0",
  "rules": [ { "id": "decoy" } ],
  "rules": [ { "id": "real", "effect": "deny" } ]
}`;
  const parsed = JSON.parse(text) as unknown;
  const errors = validateRuleSet(parsed, text);
  const dupError = errors.find((e) => e.field === "rules");
  assert.ok(dupError, "expected a duplicate-top-level-key error naming field \"rules\"");
  assert.match(dupError.message, /duplicate top-level key "rules"/);
});

test("validateRuleSet: without rawText, a duplicate top-level key cannot be detected (JSON.parse already collapsed it) — 0 errors, same as before this fix", () => {
  // Documents the boundary of this fix: detection REQUIRES the raw source text. A plain object
  // literal (as every other test in this file passes) can never expose this shape.
  const collapsed = { version: "1.0.0", rules: [{ id: "real", effect: "deny" }] };
  assert.deepEqual(validateRuleSet(collapsed), []);
});
