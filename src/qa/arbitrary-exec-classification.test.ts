// AP-12 (Issue #308 activation precondition, plan docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md
// section 14; addendum docs/plans/s308-precondition-instruments-phase1-2026-09-30.md, step S3):
// "no arbitrary-execution tool (PowerShell, Skill, Workflow, CronCreate, RemoteTrigger) may be classifiable
// read-only; checked mechanically over the inventory".
//
// What the instrument does: for every name in ARBITRARY_EXEC (below), over the REAL layers, it reports a
// violation when
//   (1) the merged catalog (built-in layer + central fixture) classifies that name `read-only`, or
//   (2) the built-in layer or the central fixture carries an entry for that name with class `read-only`
//       (so it is flagged even if a later merge would hide it), or
//   (3) an entry has a class the instrument does not know (fail closed: an unknown class is not proven safe).
// Names compare case-insensitively. REPLACED 2026-10-02 (Issue #308 story C, recorded act, decisions row 2026-10-02
// "#308 remainder: AP-3 form ..." item (4)): AP-2 re-vendored the inventory from the live init event and all five AP-12
// names are now vendored, so the earlier "absent from the inventory, adding one throws" test (which asserted the
// ABSENCE of the five and told its reader to replace it with this assertion once they were vendored) is replaced by
// the real assertion: each of the five is PRESENT in the real inventory and classed workspace-mutating or
// remote-mutating, never read-only. This is a strengthening (absent-allowed became present-and-non-read-only), not a
// weakening or deletion under SE ADR-0005. What stays pinned:
//   - every one of the five is present (a later inventory drop cannot make the assertion vacuous, C3d);
//   - the real built-in layer with one of them flipped to read-only is flagged (C3c);
//   - a classification-less addition of an unknown name still throws (no classified-by-default).
//
// ARBITRARY_EXEC is the five AP-12 names PLUS three built-ins this instrument adds on its own judgement
// (Bash, SlashCommand, Task: each runs caller-chosen commands or delegates to an agent that can). The
// addition is a tightening only; removing a name is a reviewed change. The set is NOT a proof that no
// other tool can execute arbitrary code (an MCP server tool can; MCP classes come from the fixture).
//
// Seeded mutants (each MUST be flagged): a merged catalog with Bash at read-only; the real merge fed a
// central entry that lowers Task; a fixture entry PowerShell at read-only; an unknown class; a differently
// cased name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeToolClassificationLayers } from "../policy/rule/precedence.ts";
import { buildBuiltinToolClassificationLayer, loadBuiltinToolClassificationLayer, loadBuiltinToolInventory } from "../policy/tools/builtin-tool-inventory.ts";
import { loadCentralClassificationFixture } from "../policy/tools/central-classification.ts";
import type { ToolClassificationSet } from "../policy/tools/classification.ts";

const AP12_NAMED: readonly string[] = ["PowerShell", "Skill", "Workflow", "CronCreate", "RemoteTrigger"];
const ADDED_BUILTINS: readonly string[] = ["Bash", "SlashCommand", "Task"];
const ARBITRARY_EXEC: ReadonlySet<string> = new Set([...AP12_NAMED, ...ADDED_BUILTINS].map((n) => n.toLowerCase()));
const KNOWN_CLASSES: ReadonlySet<string> = new Set(["read-only", "workspace-mutating", "remote-mutating"]);

interface Layers {
  builtin: { tools: ReadonlyArray<{ name: string; class: string }> };
  central: { tools: ReadonlyArray<{ name: string; class: string }> };
  merged: { tools: ReadonlyArray<{ name: string; class: string }> };
}

/** One line per violation; empty when no arbitrary-execution tool is classifiable read-only. */
function findReadOnlyArbitraryExec(layers: Layers): string[] {
  const out: string[] = [];
  for (const [layerName, set] of Object.entries(layers) as Array<[string, Layers["builtin"]]>) {
    for (const entry of set.tools) {
      if (!ARBITRARY_EXEC.has(entry.name.toLowerCase())) continue;
      if (!KNOWN_CLASSES.has(entry.class)) out.push(`${layerName}: ${entry.name} has unknown class ${JSON.stringify(entry.class)}`);
      else if (entry.class === "read-only") out.push(`${layerName}: ${entry.name} is classified read-only`);
    }
  }
  return out;
}

interface RealLayers extends Layers {
  builtin: ToolClassificationSet;
  central: ToolClassificationSet;
}

function realLayers(): RealLayers {
  const builtin = loadBuiltinToolClassificationLayer();
  const central = loadCentralClassificationFixture().centralLayer;
  return { builtin, central, merged: mergeToolClassificationLayers(builtin, central) };
}

test("AP-12: no arbitrary-execution tool in the real inventory + classification catalog is classifiable read-only", () => {
  const layers = realLayers();
  assert.deepEqual(findReadOnlyArbitraryExec(layers), []);
  // The instrument must have something to judge: the exec names present in the real merged catalog.
  const present = layers.merged.tools.filter((t) => ARBITRARY_EXEC.has(t.name.toLowerCase()));
  assert.ok(present.length > 0, "expected at least one arbitrary-execution built-in in the merged catalog (Bash is vendored)");
  for (const t of present) assert.notEqual(t.class, "read-only", t.name);
});

test("AP-12 (C3, C3d): each of the five named tools is PRESENT in the real inventory and classed workspace-mutating or remote-mutating", () => {
  const inventory = loadBuiltinToolInventory();
  const layer = loadBuiltinToolClassificationLayer();
  const present = AP12_NAMED.filter((n) => inventory.tools.includes(n));
  assert.deepEqual(present, [...AP12_NAMED], "every AP-12 name must be vendored; a drop would make this assertion vacuous");
  for (const name of AP12_NAMED) {
    const cls = layer.tools.find((t) => t.name === name)?.class;
    assert.ok(cls === "workspace-mutating" || cls === "remote-mutating", `${name} is classed ${String(cls)}`);
  }
});

test("AP-12: an inventory gaining an unclassified name still throws (no classified-by-default)", () => {
  const inventory = loadBuiltinToolInventory();
  assert.throws(() => buildBuiltinToolClassificationLayer({ ...inventory, tools: [...inventory.tools, "TotallyUnknownFutureExecTool"] }), /no CLASSIFICATION entry/);
});

for (const name of AP12_NAMED) {
  test(`AP-12 seeded mutant (C3c): the REAL built-in layer with ${name} flipped to read-only is flagged`, () => {
    const real = realLayers();
    const builtin = asSet(real.builtin.tools.map((t) => (t.name === name ? { name: t.name, class: "read-only" } : t)));
    const found = findReadOnlyArbitraryExec({ builtin, central: real.central, merged: mergeToolClassificationLayers(builtin, real.central) });
    assert.ok(found.some((l) => l.startsWith("builtin: ") && l.includes(name)), found.join("\n"));
  });
}

const asSet = (tools: Array<{ name: string; class: string }>): ToolClassificationSet => ({ version: "mutant", tools: tools as ToolClassificationSet["tools"] });

test("AP-12 seeded mutant: Bash reclassified read-only in the merged catalog is flagged", () => {
  const real = realLayers();
  const merged = { tools: real.merged.tools.map((t) => (t.name === "Bash" ? { name: t.name, class: "read-only" } : t)) };
  const found = findReadOnlyArbitraryExec({ ...real, merged });
  assert.ok(found.some((l) => l.startsWith("merged: Bash")), found.join("\n"));
});

test("AP-12 seeded mutant: the REAL merge fed a central entry that lowers Task to read-only is flagged", () => {
  const real = realLayers();
  const central = asSet([...real.central.tools, { name: "Task", class: "read-only" }]);
  const found = findReadOnlyArbitraryExec({ builtin: real.builtin, central, merged: mergeToolClassificationLayers(real.builtin, central) });
  assert.ok(found.some((l) => l.startsWith("merged: Task")) && found.some((l) => l.startsWith("central: Task")), found.join("\n"));
});

for (const name of AP12_NAMED) {
  test(`AP-12 seeded mutant: a central fixture entry ${name} at read-only is flagged`, () => {
    const real = realLayers();
    const central = asSet([...real.central.tools, { name, class: "read-only" }]);
    const found = findReadOnlyArbitraryExec({ builtin: real.builtin, central, merged: mergeToolClassificationLayers(real.builtin, central) });
    assert.ok(found.some((l) => l.includes(name)), found.join("\n"));
  });
}

test("AP-12 seeded mutants: a differently cased name and an unknown class are flagged", () => {
  const real = realLayers();
  const cased = findReadOnlyArbitraryExec({ ...real, central: asSet([{ name: "powershell", class: "read-only" }]) });
  assert.ok(cased.length > 0, "case-insensitive match");
  const unknown = findReadOnlyArbitraryExec({ ...real, central: asSet([{ name: "Skill", class: "sandboxed" }]) });
  assert.ok(unknown.some((l) => l.includes("unknown class")), unknown.join("\n"));
});

test("AP-12 positive control: a non-exec tool at read-only (Read) and an exec tool at a mutating class are not flagged", () => {
  const real = realLayers();
  assert.ok(real.merged.tools.some((t) => t.name === "Read" && t.class === "read-only"));
  assert.deepEqual(findReadOnlyArbitraryExec({ builtin: asSet([{ name: "Read", class: "read-only" }]), central: asSet([{ name: "PowerShell", class: "workspace-mutating" }]), merged: asSet([]) }), []);
});
