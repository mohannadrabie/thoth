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
// Names compare case-insensitively. Names absent from the catalog are not a violation today: the vendored
// inventory (docs/qa/tool-inventory.json) does not contain the five AP-12 names, so a real assertion that the
// five are non-read-only cannot exist until AP-2 re-vendors the inventory. What CAN be pinned now, and is:
//   - adding any of the five to an inventory without a classification throws (no classified-by-default), so
//     the re-vendor forces a reviewed classification, and this instrument then judges that classification;
//   - a central fixture entry named like one of them at `read-only` is flagged.
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

test("AP-12: an inventory that gains an AP-12 name without a classification throws (no classified-by-default), so a re-vendor forces a reviewed class", () => {
  const inventory = loadBuiltinToolInventory();
  for (const name of AP12_NAMED) {
    assert.ok(!inventory.tools.includes(name), `${name} is now vendored: replace this test with a non-read-only assertion over the real class`);
    assert.throws(() => buildBuiltinToolClassificationLayer({ ...inventory, tools: [...inventory.tools, name] }), /no CLASSIFICATION entry/, name);
  }
});

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
