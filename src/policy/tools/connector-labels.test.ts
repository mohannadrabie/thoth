// Story C of #308 (AP-3, human ruling form (a)): every entry of the fixture's knownConnectors carries a
// `remote-mutating` label in centralLayer.tools. Names are read from the fixture at run time (THOTH-ADR-0001: the
// fixture is the single source; nothing here types a connector name).
//
// The labels are INERT under grammar v1: a server name is admitted to the class path only when it matches
// [A-Za-z0-9-]+ (ADMISSIBLE_SERVER_NAME), and connectors arrive as `claude_ai_<Name>` at runtime, so connector
// calls stay opaque and POL-05-denied once the gate is wired. Widening the grammar is Backlog Issue #381. The
// third test pins that inertness so a grammar change cannot silently turn the labels on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCentralClassificationFixture } from "./central-classification.ts";
import { ADMISSIBLE_SERVER_NAME } from "../normalizer/tool-class-format.ts";

interface Labelled {
  knownConnectors: string[];
  centralLayer: { tools: ReadonlyArray<{ name: string; class: string }> };
}

function missingLabels(fixture: Labelled): string[] {
  return fixture.knownConnectors.filter((c) => !fixture.centralLayer.tools.some((t) => t.name === c && t.class === "remote-mutating"));
}

test("C4: every knownConnectors entry has a remote-mutating label in the central layer", () => {
  const fixture = loadCentralClassificationFixture();
  assert.ok(fixture.knownConnectors.length > 0);
  assert.deepEqual(missingLabels(fixture), []);
});

test("C4 seeded mutant: a fixture missing one connector's label is flagged, and so is one labelled below remote-mutating", () => {
  const fixture = loadCentralClassificationFixture();
  const [victim] = fixture.knownConnectors;
  assert.ok(victim !== undefined);
  const dropped = { ...fixture, centralLayer: { ...fixture.centralLayer, tools: fixture.centralLayer.tools.filter((t) => t.name !== victim) } };
  assert.deepEqual(missingLabels(dropped), [victim]);
  const lowered = { ...fixture, centralLayer: { ...fixture.centralLayer, tools: fixture.centralLayer.tools.map((t) => (t.name === victim ? { ...t, class: "read-only" } : t)) } };
  assert.deepEqual(missingLabels(lowered), [victim]);
});

test("C4 inertness pin: no connector label is an admitted server name under grammar v1 (the labels drive no decision; Issue #381)", () => {
  const fixture = loadCentralClassificationFixture();
  for (const c of fixture.knownConnectors) assert.ok(!ADMISSIBLE_SERVER_NAME.test(c), `${c} would now be admitted: the labels are live, so re-review them (Issue #381)`);
});
