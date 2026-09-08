import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLayers, mergeLayersWithMandatoryLock, mergeToolClassificationLayers, type NamedRuleLayer } from "./precedence.ts";
import type { Rule, RuleSet } from "../kernel/rule-types.ts";
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

// --- mergeLayersWithMandatoryLock (S6, POL-07 general form) --------------------------------------

const MANDATORY_ID = "shipped-mandatory-deny-secrets";

function rule(id: string, effect: "allow" | "deny", mandatory?: boolean): Rule {
  return mandatory === undefined ? { id, effect } : { id, effect, mandatory };
}

function layer(name: NamedRuleLayer["name"], version: string, items: readonly Rule[]): NamedRuleLayer {
  return { name, version, items };
}

test("mergeLayersWithMandatoryLock: no mandatory rules anywhere -> behaves identically to mergeLayers (AC1 baseline)", () => {
  const layers: NamedRuleLayer[] = [
    layer("shipped-defaults", "1.0.0", [rule("allow-dev-writes", "allow")]),
    layer("central", "1.0.0", []),
    layer("project", "1.0.0", [rule("project-only", "deny")]),
  ];
  const result = mergeLayersWithMandatoryLock(layers);
  assert.deepEqual(result.voidedLayers, []);
  assert.deepEqual(
    result.merged.rules.map((r) => r.id),
    ["allow-dev-writes", "project-only"],
  );
});

// --- Stage-3 round-1 fix-now (2026-09-08), Issue #108 [MED] — VOID-ONLY-THE-OFFENDING-LAYER -------
// (previously: the FIRST collision voided the WHOLE call, including earlier, innocent layers —
// see this function's own header comment for why that inverted POL-07's trust direction)

test("mergeLayersWithMandatoryLock (Issue #108): project redefining a mandatory CENTRAL id voids ONLY the project layer — shipped-defaults and central still resolve", () => {
  const layers: NamedRuleLayer[] = [
    layer("shipped-defaults", "1.0.0", [rule("shipped-only", "allow")]),
    layer("central", "1.1.0", [rule(MANDATORY_ID, "deny", true)]),
    layer("project", "1.1.1", [rule(MANDATORY_ID, "allow")]),
  ];
  const result = mergeLayersWithMandatoryLock(layers);
  assert.deepEqual(result.voidedLayers, [{ layer: "project", ruleId: MANDATORY_ID }]);
  // The mandatory rule itself, and every OTHER layer's innocent rule, still resolve.
  assert.deepEqual(
    result.merged.rules.map((r) => r.id).sort(),
    ["shipped-only", MANDATORY_ID].sort(),
  );
  const mandatory = result.merged.rules.find((r) => r.id === MANDATORY_ID);
  assert.equal(mandatory?.effect, "deny", "central's mandatory definition must survive, not project's colliding one");
  assert.equal(mandatory?.sourceLayer, "central");
});

test("mergeLayersWithMandatoryLock (Issue #108): a BYTE-IDENTICAL project redefinition of a mandatory central id is still voided — no field-by-field diff (Q1's ruling), unchanged by this fix", () => {
  const mandatoryRule = rule(MANDATORY_ID, "deny", true);
  const layers: NamedRuleLayer[] = [
    layer("shipped-defaults", "1.0.0", []),
    layer("central", "1.1.0", [mandatoryRule]),
    layer("project", "1.1.1", [{ ...mandatoryRule }]),
  ];
  const result = mergeLayersWithMandatoryLock(layers);
  assert.equal(result.voidedLayers.length, 1, "byte-identical redefinition must still be rejected outright");
  assert.equal(result.voidedLayers[0]?.layer, "project");
});

test("mergeLayersWithMandatoryLock (AC1): an UNTOUCHED mandatory id passes through unchanged when project doesn't touch it", () => {
  const layers: NamedRuleLayer[] = [
    layer("shipped-defaults", "1.0.0", []),
    layer("central", "1.1.0", [rule(MANDATORY_ID, "deny", true)]),
    layer("project", "1.1.1", [rule("project-only-id", "allow")]),
  ];
  const result = mergeLayersWithMandatoryLock(layers);
  assert.deepEqual(result.voidedLayers, []);
  const mandatory = result.merged.rules.find((r) => r.id === MANDATORY_ID);
  assert.ok(mandatory, "the untouched mandatory rule must still resolve");
  assert.equal(mandatory.effect, "deny");
  assert.equal(mandatory.sourceLayer, "central");
});

test("mergeLayersWithMandatoryLock (AC1): a NON-mandatory override still works normally", () => {
  const layers: NamedRuleLayer[] = [
    layer("shipped-defaults", "1.0.0", [rule("ordinary-id", "deny")]),
    layer("central", "1.0.0", []),
    layer("project", "1.0.1", [rule("ordinary-id", "allow")]),
  ];
  const result = mergeLayersWithMandatoryLock(layers);
  assert.deepEqual(result.voidedLayers, []);
  const ordinary = result.merged.rules.find((r) => r.id === "ordinary-id");
  assert.equal(ordinary?.effect, "allow");
  assert.equal(ordinary?.sourceLayer, "project");
});

test("mergeLayersWithMandatoryLock (AC9, Issue #108-refined): whole-LAYER (not whole-load) rejection granularity — a project layer with 1 violating rule + 1 valid non-conflicting override loses BOTH from THAT layer, but shipped-defaults/central still resolve and the valid override does NOT silently take effect on its own", () => {
  const layers: NamedRuleLayer[] = [
    layer("shipped-defaults", "1.0.0", [rule("shipped-baseline", "deny")]),
    layer("central", "1.1.0", [rule(MANDATORY_ID, "deny", true)]),
    layer("project", "1.1.1", [rule(MANDATORY_ID, "allow"), rule("valid-non-conflicting-override", "allow")]),
  ];
  const result = mergeLayersWithMandatoryLock(layers);
  assert.deepEqual(result.voidedLayers, [{ layer: "project", ruleId: MANDATORY_ID }]);
  // The valid, non-conflicting override never silently takes effect -- the WHOLE project layer,
  // including that otherwise-fine rule, is dropped.
  assert.equal(
    result.merged.rules.some((r) => r.id === "valid-non-conflicting-override"),
    false,
    "the valid override must NOT silently take effect when its own layer is voided",
  );
  // But shipped-defaults and central are UNAFFECTED -- this is the whole point of Issue #108.
  assert.ok(result.merged.rules.some((r) => r.id === "shipped-baseline"));
  assert.ok(result.merged.rules.some((r) => r.id === MANDATORY_ID));
});

test("mergeLayersWithMandatoryLock (design-challenger S6 Attack C / docs/decisions.md 2026-09-08 ruling, option (a)): SHIPPED-DEFAULTS -> CENTRAL is the SAME general mechanism as central -> project, not a special case — a central redefinition of a shipped-defaults mandatory id voids ONLY central, shipped-defaults' own definition still resolves", () => {
  const layers: NamedRuleLayer[] = [
    layer("shipped-defaults", "1.0.0", [rule(MANDATORY_ID, "deny", true)]),
    layer("central", "1.1.0", [rule(MANDATORY_ID, "allow")]),
    layer("project", "1.1.1", []),
  ];
  const result = mergeLayersWithMandatoryLock(layers);
  assert.deepEqual(
    result.voidedLayers,
    [{ layer: "central", ruleId: MANDATORY_ID }],
    "the violation must be attributed to the layer that ATTEMPTED the redefinition (central), proving the check is general — not hardcoded to only ever report against \"project\"",
  );
  const mandatory = result.merged.rules.find((r) => r.id === MANDATORY_ID);
  assert.equal(mandatory?.effect, "deny", "shipped-defaults' own mandatory definition must survive central's voided attempt to override it");
  assert.equal(mandatory?.sourceLayer, "shipped-defaults");
});

test("mergeLayersWithMandatoryLock (Issue #108): a voided layer's OWN mandatory rules do not lock anything for a still-later layer — the layer is treated as never having happened", () => {
  const layers: NamedRuleLayer[] = [
    layer("shipped-defaults", "1.0.0", [rule(MANDATORY_ID, "deny", true)]),
    // central collides with shipped-defaults' mandatory id -> central is VOIDED entirely,
    // including its own (otherwise-would-be) mandatory "central-only-mandatory" rule.
    layer("central", "1.1.0", [rule(MANDATORY_ID, "allow"), rule("central-only-mandatory", "deny", true)]),
    // project redefines "central-only-mandatory" -- this must NOT be treated as a lock violation,
    // since central's contribution (including this "mandatory" declaration) was fully discarded.
    layer("project", "1.1.1", [rule("central-only-mandatory", "allow")]),
  ];
  const result = mergeLayersWithMandatoryLock(layers);
  assert.deepEqual(result.voidedLayers, [{ layer: "central", ruleId: MANDATORY_ID }]);
  const overridden = result.merged.rules.find((r) => r.id === "central-only-mandatory");
  assert.equal(overridden?.effect, "allow", "project must be free to define this id -- central's own mandatory declaration never actually took effect");
  assert.equal(overridden?.sourceLayer, "project");
});

test("mergeLayersWithMandatoryLock: version resolves the same way mergeLayers does — the last ACCEPTED layer (in order) that contributes any rule wins", () => {
  const onlyShipped = mergeLayersWithMandatoryLock([
    layer("shipped-defaults", "1.0.0", [rule("a", "allow")]),
    layer("central", "1.1.0", []),
    layer("project", "1.1.1", []),
  ]);
  assert.equal(onlyShipped.merged.version, "1.0.0");

  const throughCentral = mergeLayersWithMandatoryLock([
    layer("shipped-defaults", "1.0.0", [rule("a", "allow")]),
    layer("central", "1.1.0", [rule("b", "allow")]),
    layer("project", "1.1.1", []),
  ]);
  assert.equal(throughCentral.merged.version, "1.1.0");

  const allEmpty = mergeLayersWithMandatoryLock([
    layer("shipped-defaults", "0.0.0", []),
    layer("central", "9.9.9", []),
    layer("project", "9.9.9", []),
  ]);
  assert.equal(allEmpty.merged.version, "0.0.0");
});
