import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLayers, mergeToolClassificationLayers } from "./precedence.ts";
import type { RuleSet } from "../kernel/rule-types.ts";
import {
  centralLayer,
  CONFLICTING_RULE_ID,
  emptyRuleSet,
  projectLayer,
  shippedDefaultsLayer,
} from "../fixtures/rules.ts";
import {
  centralToolClassificationLayer,
  emptyToolClassificationSet,
  shippedToolClassificationLayer,
} from "../fixtures/tool-classification.ts";

test("mergeLayers: all three layers empty -> empty merged set", () => {
  const merged = mergeLayers(emptyRuleSet, emptyRuleSet, emptyRuleSet);
  assert.deepEqual(merged.rules, []);
  assert.equal(merged.version, emptyRuleSet.version);
});

test("mergeLayers (POL-08 three-layer-conflict fixture): the project layer's definition wins", () => {
  const merged = mergeLayers(shippedDefaultsLayer, centralLayer, projectLayer);
  const conflicting = merged.rules.find((r) => r.id === CONFLICTING_RULE_ID);
  assert.ok(conflicting, "the conflicting rule id must be present in the merged result");
  assert.equal(conflicting.effect, "deny", "project layer's deny must win over central's allow and shipped's deny");
  assert.equal(conflicting.sourceLayer, "project", "the merged rule must be inspectable — attributed to the winning layer");
});

test("mergeLayers: a rule id present in only one layer passes through unchanged, tagged with its layer", () => {
  const merged = mergeLayers(shippedDefaultsLayer, centralLayer, projectLayer);
  const devOnly = merged.rules.find((r) => r.id === "allow-dev-writes");
  assert.ok(devOnly);
  assert.equal(devOnly.effect, "allow");
  assert.equal(devOnly.sourceLayer, "shipped-defaults");
});

test("mergeLayers: deterministic — merging the same three layers twice yields identical results", () => {
  const first = mergeLayers(shippedDefaultsLayer, centralLayer, projectLayer);
  const second = mergeLayers(shippedDefaultsLayer, centralLayer, projectLayer);
  assert.deepEqual(first, second);
});

test("mergeLayers: version resolves to the highest-precedence layer that actually contributes a rule", () => {
  const onlyShipped = mergeLayers(shippedDefaultsLayer, emptyRuleSet, emptyRuleSet);
  assert.equal(onlyShipped.version, shippedDefaultsLayer.version);

  const shippedAndCentral = mergeLayers(shippedDefaultsLayer, centralLayer, emptyRuleSet);
  assert.equal(shippedAndCentral.version, centralLayer.version);

  const allThree = mergeLayers(shippedDefaultsLayer, centralLayer, projectLayer);
  assert.equal(allThree.version, projectLayer.version);
});

test("mergeLayers: central overrides shipped-defaults when project defines nothing for that id", () => {
  const projectDefinesNothing: RuleSet = { version: "9.9.9", rules: [] };
  const merged = mergeLayers(shippedDefaultsLayer, centralLayer, projectDefinesNothing);
  const conflicting = merged.rules.find((r) => r.id === CONFLICTING_RULE_ID);
  assert.equal(conflicting?.effect, "allow", "central's allow should win when project is silent on this id");
  assert.equal(conflicting?.sourceLayer, "central");
});

test("mergeLayers: rule order follows first-appearance across shipped -> central -> project", () => {
  const merged = mergeLayers(shippedDefaultsLayer, centralLayer, projectLayer);
  const ids = merged.rules.map((r) => r.id);
  // shippedDefaultsLayer defines CONFLICTING_RULE_ID first, then "allow-dev-writes" — that
  // first-appearance order must be preserved even though CONFLICTING_RULE_ID's VALUE came from
  // the project layer.
  assert.deepEqual(ids, [CONFLICTING_RULE_ID, "allow-dev-writes"]);
});

// --- mergeToolClassificationLayers (SUR-03 / T5: extends mergeLayers' shape, two-tier) ----------

test("mergeToolClassificationLayers: both layers empty -> empty merged set", () => {
  const merged = mergeToolClassificationLayers(emptyToolClassificationSet, emptyToolClassificationSet);
  assert.deepEqual(merged.tools, []);
  assert.equal(merged.version, emptyToolClassificationSet.version);
});

test("mergeToolClassificationLayers (T5 conflict fixture): central overrides shipped for the same tool name", () => {
  const merged = mergeToolClassificationLayers(shippedToolClassificationLayer, centralToolClassificationLayer);
  const bash = merged.tools.find((t) => t.name === "Bash");
  assert.ok(bash);
  assert.equal(bash.class, "remote-mutating", "central's reclassification must win over shipped's");
  assert.equal(bash.sourceLayer, "central");
});

test("mergeToolClassificationLayers: a tool name present only in the shipped layer passes through unchanged, tagged with its layer", () => {
  const merged = mergeToolClassificationLayers(shippedToolClassificationLayer, centralToolClassificationLayer);
  const read = merged.tools.find((t) => t.name === "Read");
  assert.ok(read);
  assert.equal(read.class, "read-only");
  assert.equal(read.sourceLayer, "shipped-defaults");
});

test("mergeToolClassificationLayers: version resolves to central's when central classifies any tool, else shipped's", () => {
  const shippedOnly = mergeToolClassificationLayers(shippedToolClassificationLayer, emptyToolClassificationSet);
  assert.equal(shippedOnly.version, shippedToolClassificationLayer.version);

  const withCentral = mergeToolClassificationLayers(shippedToolClassificationLayer, centralToolClassificationLayer);
  assert.equal(withCentral.version, centralToolClassificationLayer.version);
});

test("mergeToolClassificationLayers: deterministic — merging the same two layers twice yields identical results", () => {
  const first = mergeToolClassificationLayers(shippedToolClassificationLayer, centralToolClassificationLayer);
  const second = mergeToolClassificationLayers(shippedToolClassificationLayer, centralToolClassificationLayer);
  assert.deepEqual(first, second);
});
