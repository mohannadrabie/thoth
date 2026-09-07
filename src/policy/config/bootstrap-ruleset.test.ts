// Criterion 21: "bootstrap-ruleset.ts exports loadBootstrapRuleSet(): RuleSet, not a bare
// constant." This test imports it AS A FUNCTION and calls it — a bare constant export would fail
// at the `loadBootstrapRuleSet()` call site (TypeError: not a function), not merely typecheck
// differently, so this is a real behavioral assertion, not a type-only one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_DEFAULT_OUTCOME, loadBootstrapRuleSet } from "./bootstrap-ruleset.ts";

test("loadBootstrapRuleSet is a function, not a bare constant, and returns a well-formed empty RuleSet", () => {
  assert.equal(typeof loadBootstrapRuleSet, "function");
  const ruleSet = loadBootstrapRuleSet();
  assert.equal(typeof ruleSet.version, "string");
  assert.deepEqual(ruleSet.rules, []);
});

test("loadBootstrapRuleSet returns a fresh array each call (never a shared mutable reference a caller could corrupt)", () => {
  const a = loadBootstrapRuleSet();
  const b = loadBootstrapRuleSet();
  assert.notEqual(a.rules, b.rules);
});

test("BOOTSTRAP_DEFAULT_OUTCOME is \"allow\" (see this module's own header comment for the full justification)", () => {
  assert.equal(BOOTSTRAP_DEFAULT_OUTCOME, "allow");
});
