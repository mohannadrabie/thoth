import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRule, validateRuleSet, findDuplicateTopLevelKeys, findTopLevelKeys } from "./schema.ts";
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

// --- Stage-3 round-3 fix-now (2026-09-08), Issue #115 [MED], red-team round-2-demonstrated --------
// Round 1's findDuplicateTopLevelKeys compared RAW escaped key text; JSON.parse compares unescaped
// values, so a \uXXXX-escaped duplicate "rules" key slipped past round 1's check entirely. Fixed by
// unescaping via JSON.parse's own decoder before counting, PLUS a general tokenizer/parser-agreement
// invariant (not a blocklist entry for this one escape shape).

test("findTopLevelKeys: unescapes a \\uXXXX-escaped key to its real value", () => {
  const text = `{"\\u0072ules": [1,2,3]}`;
  assert.deepEqual(findTopLevelKeys(text), ["rules"]);
});

test("findDuplicateTopLevelKeys (Issue #115): a \\u0072-escaped duplicate of \"rules\" is caught — red-team's exact round-2 repro", () => {
  const text = `{
  "version": "1.0.0",
  "rules": [ { "id": "decoy-allow", "effect": "allow" } ],
  "\\u0072ules": [ { "id": "real-deny", "effect": "deny" } ]
}`;
  assert.deepEqual(findDuplicateTopLevelKeys(text), ["rules"]);
});

test("validateRuleSet (Issue #115): a top-level key written with a \\uXXXX escape that normalizes to a duplicate of another top-level key is rejected", () => {
  const text = `{
  "version": "1.0.0",
  "rules": [ { "id": "decoy-allow", "effect": "allow", "verbs": ["get"], "targets": ["pod"] } ],
  "\\u0072ules": [ { "id": "real-deny", "effect": "deny", "verbs": ["get"], "targets": ["pod"] } ]
}`;
  const parsed = JSON.parse(text) as unknown;
  const errors = validateRuleSet(parsed, text);
  const dupError = errors.find((e) => e.field === "rules" && /duplicate top-level key "rules"/.test(e.message));
  assert.ok(dupError, "the escaped duplicate must be rejected exactly like a byte-identical literal duplicate");
});

test("validateRuleSet (Issue #115): the tokenizer/parser-agreement invariant — a well-formed document with no escape tricks never false-positives", () => {
  const text = `{"version":"1.0.0","rules":[{"id":"a","effect":"allow","rationale":"contains \\"version\\": 1 as text, and a decoy \\"rules\\" word too"}]}`;
  const parsed = JSON.parse(text) as unknown;
  assert.deepEqual(validateRuleSet(parsed, text), []);
});

test("validateRuleSet (Issue #115): the tokenizer/parser-agreement invariant holds across escape-heavy CRLF/unicode documents (differential-style check)", () => {
  const documents = [
    `{"version":"1.0.0","rules":[{"id":"a","effect":"allow","rationale":"line1\\nline2\\ttabbed"}]}`,
    `{"version":"1.0.0","rules":[{"id":"a","effect":"allow","rationale":"emoji \\ud83d\\ude00 astral"}]}`,
    `{\r\n  "version": "1.0.0",\r\n  "rules": []\r\n}`,
    `{"version":"1.0.0","rules":[{"id":"a","effect":"allow","rationale":"backslash \\\\ and quote \\" inline"}]}`,
  ];
  for (const text of documents) {
    const parsed = JSON.parse(text) as unknown;
    assert.deepEqual(validateRuleSet(parsed, text), [], `expected 0 errors for: ${text}`);
    assert.deepEqual(new Set(findTopLevelKeys(text)), new Set(Object.keys(parsed as Record<string, unknown>)), `scanner/parser key-set disagreement for: ${text}`);
  }
});

// --- Issue #112 (test-writer, 2026-09-24, written before the production change): `defaultOutcome`, ---
// the baseline posture, as an optional top-level RuleSet key (POL-01: no operator-tunable value in a
// code literal). Enum is exactly "allow" | "deny" (VerdictOutcome) -- there is no "ask" outcome.
// Ruling D1 (Manager): NO separate "mandatory" flag key for the posture; central's declaration is
// locked implicitly by trust rank (see mandatory-lock-conformance.test.ts Part E/F).

// B1 (Issue #112)
test('validateRuleSet (Issue #112 B1): defaultOutcome "allow" and "deny" are accepted (0 errors)', () => {
  for (const outcome of ["allow", "deny"] as const) {
    assert.deepEqual(validateRuleSet({ version: "1.0.0", rules: [validRule], defaultOutcome: outcome }), [], `defaultOutcome=${outcome}`);
  }
});

// B2 (Issue #112): the error must be the field's own enum error -- not the generic "unknown key"
// error, which is what an implementation without this key produces (same field name, wrong reason).
test('validateRuleSet (Issue #112 B2): a non-enum defaultOutcome ("ask", "DENY", true, null, 1) is rejected by name with expected \'"allow" | "deny"\', not as an unknown key', () => {
  for (const bad of ["ask", "DENY", "Allow", "", true, null, 1] as const) {
    const errors = validateRuleSet({ version: "1.0.0", rules: [], defaultOutcome: bad });
    assert.equal(errors.length, 1, `defaultOutcome=${JSON.stringify(bad)} must yield exactly one error; got ${JSON.stringify(errors)}`);
    const err = errors[0];
    assert.equal(err?.field, "defaultOutcome", `defaultOutcome=${JSON.stringify(bad)}`);
    assert.equal(err?.expected, '"allow" | "deny"', `defaultOutcome=${JSON.stringify(bad)}: expected shape must be the enum, got ${JSON.stringify(err)}`);
    assert.doesNotMatch(err?.message ?? "", /unknown key/, `defaultOutcome=${JSON.stringify(bad)} is a KNOWN key with a bad value, never an unknown key`);
  }
});

// B3 (Issue #112): back-compat. Green at HEAD by construction (the key is optional and absent).
test("validateRuleSet (Issue #112 B3): a rule set with no defaultOutcome still validates (0 errors) -- the key is optional", () => {
  assert.deepEqual(validateRuleSet({ version: "1.0.0", rules: [validRule] }), []);
  assert.deepEqual(validateRuleSet({ version: "1.0.0", rules: [] }), []);
});

// B4 (Issue #112): relax-by-duplicate. JSON.parse keeps only the LAST duplicate key, so a document
// declaring deny then allow parses as allow; only the raw-text scan can see it. Expected to pass at
// HEAD through the generic duplicate-key scan; kept as a named regression for the new key.
test('validateRuleSet (Issue #112 B4): a duplicate top-level "defaultOutcome" key (deny then allow) is rejected when rawText is supplied, literal and \\u-escaped alike', () => {
  const literal = `{
  "version": "1.0.0",
  "rules": [],
  "defaultOutcome": "deny",
  "defaultOutcome": "allow"
}`;
  const escaped = `{
  "version": "1.0.0",
  "rules": [],
  "defaultOutcome": "deny",
  "defaultOutcom\\u0065": "allow"
}`;
  for (const text of [literal, escaped]) {
    const errors = validateRuleSet(JSON.parse(text) as unknown, text);
    assert.ok(
      errors.some((e) => e.field === "defaultOutcome" && /duplicate top-level key "defaultOutcome"/.test(e.message)),
      `expected a duplicate-top-level-key error naming defaultOutcome for:\n${text}\ngot ${JSON.stringify(errors)}`,
    );
  }
});

// B5 (Issue #112): "defaultOutcome" belongs to the RuleSet, not to a single rule.
test('validateRule (Issue #112 B5): "defaultOutcome" inside a single rule is still an unknown-key error -- it is a RuleSet key only', () => {
  const errors = validateRule({ ...validRule, defaultOutcome: "deny" });
  const unknown = errors.find((e) => e.field === "defaultOutcome");
  assert.ok(unknown, "a per-rule defaultOutcome must be reported, not silently accepted");
  assert.match(unknown.message, /unknown key "defaultOutcome"/);
});

// B5b (Issue #112, derived from D1): there is no companion lock-flag key; declaring one is an
// unknown-key error, not a silent no-op (POL-06). Green at HEAD by construction.
test('validateRuleSet (Issue #112 B5b, ruling D1): a "defaultOutcomeMandatory" key does not exist -- it is rejected as an unknown key, so central cannot be led to believe a flag protects the posture', () => {
  const errors = validateRuleSet({ version: "1.0.0", rules: [], defaultOutcome: "deny", defaultOutcomeMandatory: true });
  const unknown = errors.find((e) => e.field === "defaultOutcomeMandatory");
  assert.ok(unknown, "an unknown companion key must be reported by name");
  assert.match(unknown.message, /unknown key "defaultOutcomeMandatory"/);
});

// B5c (Issue #112, derived from POL-06): the unknown-key error names the expected shape; the new
// key must be listed, and LAST -- the older unknown-key test above asserts /version, rules/ and
// must keep passing untouched, which fixes the order as version, rules, defaultOutcome.
test('validateRuleSet (Issue #112 B5c): the unknown-key error lists defaultOutcome as an allowed top-level key, after "version, rules"', () => {
  const errors = validateRuleSet({ version: "1.0.0", rules: [], mystery: true });
  const unknown = errors.find((e) => e.field === "mystery");
  assert.ok(unknown);
  assert.match(unknown.expected, /version, rules, defaultOutcome/);
});
