// S7-B (Issue #305, ruling R1), catalog level: a central fixture entry may keep or RAISE a built-in
// tool's class and may never LOWER it; a lowering entry is a load error from assembleCatalog, the one
// funnel both hooks use (docs/plans/s7b-policy-authoring-safety-phase1-2026-09-26.md, R1-1 to R1-6).
// story-implementer's own tests, written failing first. The hook-level half (R1-8, PT-7) is
// test-writer's hooks/pretooluse-kernel-gate-builtin-override.test.ts and is not edited here.
//
// RUN-TIME ENUMERATION (no hand-typed completeness claim). Built-in names and classes come from the
// real built-in layer (loadBuiltinToolClassificationLayer); the class list comes from the class table
// in tool-class-format.ts. The class ORDER below is the ruling's own oracle (read-only <
// workspace-mutating < remote-mutating), kept independent of the production rank table on purpose; a
// test asserts its members equal the class table's keys, so a fourth class fails loudly. The tests
// print the counts they computed.
//
// NAMES. No committed fixture entry name is typed here (THOTH-ADR-0001 rule 1, G19): the committed
// overlap is derived from the fixture at run time, and every temp fixture uses built-in names read
// from the built-in layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleCatalog, moduleRelativeFixtureLocation, type FixtureLocation } from "./classification-catalog.ts";
import { loadBuiltinToolClassificationLayer } from "./builtin-tool-inventory.ts";
import { loadCentralClassificationFixture } from "./central-classification.ts";
import type { ToolClass } from "./classification.ts";
import { CLASS_MARKER_VERBS } from "../normalizer/tool-class-format.ts";
import { stripComments } from "../../qa/kernel-purity-check.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** The ruling's class order, lowest first. The oracle, independent of the production rank table. */
const CLASS_ORDER: readonly ToolClass[] = ["read-only", "workspace-mutating", "remote-mutating"];

function rank(toolClass: string): number {
  const r = CLASS_ORDER.indexOf(toolClass as ToolClass);
  if (r < 0) throw new Error(`class ${JSON.stringify(toolClass)} is not in the ruled class order`);
  return r;
}

const tempRoot = mkdtempSync(join(tmpdir(), "thoth-s7b-r1-"));
process.on("exit", () => {
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

let fileCounter = 0;
function writeFixture(entries: { name: string; class: string }[]): FixtureLocation {
  fileCounter += 1;
  const dir = join(tempRoot, `f${String(fileCounter)}`);
  mkdirSync(dir, { recursive: true });
  const fixturePath = join(dir, "s5-central-classification.json");
  writeFileSync(fixturePath, JSON.stringify({ version: "0.0.0-r1-test", centralLayer: { tools: entries }, knownConnectors: [] }), "utf8");
  return { fixtureSource: "project-relative", fixturePath };
}

interface PairResult {
  name: string;
  builtinClass: ToolClass;
  entryClass: ToolClass;
  lowers: boolean;
  threw: boolean;
  message: string;
  mergedClass: string | undefined;
  mergedLayer: string | undefined;
}

let cachedPairs: PairResult[] | undefined;

/** Every (built-in name, class) pair, run through assembleCatalog against a one-entry temp fixture. */
function runAllPairs(): PairResult[] {
  if (cachedPairs !== undefined) return cachedPairs;
  const results: PairResult[] = [];
  for (const b of loadBuiltinToolClassificationLayer().tools) {
    for (const c of CLASS_ORDER) {
      const location = writeFixture([{ name: b.name, class: c }]);
      let threw = false;
      let message = "";
      let mergedClass: string | undefined;
      let mergedLayer: string | undefined;
      try {
        const { merged } = assembleCatalog(location);
        const entry = merged.tools.find((t) => t.name === b.name);
        mergedClass = entry?.class;
        mergedLayer = entry?.sourceLayer;
      } catch (err) {
        threw = true;
        message = (err as Error).message;
      }
      results.push({ name: b.name, builtinClass: b.class, entryClass: c, lowers: rank(c) < rank(b.class), threw, message, mergedClass, mergedLayer });
    }
  }
  cachedPairs = results;
  return results;
}

test("R1 instrument: the ruled class order equals the class table's keys, and the run-time enumeration is non-empty with lowering, raising and same-class pairs", () => {
  assert.deepEqual([...CLASS_ORDER].sort(), Object.keys(CLASS_MARKER_VERBS).sort(), "a class added to the class table must be added to the ruled order (and the production rank table)");
  const builtins = loadBuiltinToolClassificationLayer().tools;
  for (const b of builtins) rank(b.class);
  const pairs = runAllPairs();
  const lowering = pairs.filter((p) => p.lowers).length;
  const same = pairs.filter((p) => p.entryClass === p.builtinClass).length;
  const raising = pairs.length - lowering - same;
  console.log(`R1 instrument: ${String(builtins.length)} built-ins x ${String(CLASS_ORDER.length)} classes = ${String(pairs.length)} pairs; ${String(lowering)} lowering, ${String(raising)} raising, ${String(same)} same-class`);
  assert.equal(pairs.length, builtins.length * CLASS_ORDER.length);
  assert.ok(lowering > 0 && raising > 0 && same > 0);
});

test("R1-1 builtin-lowering-enumerated: assembleCatalog throws exactly when the entry's class ranks below the built-in's; otherwise central wins with the entry's class", () => {
  const pairs = runAllPairs();
  const wrong: string[] = [];
  for (const p of pairs) {
    const label = `${JSON.stringify(p.name)} (${p.builtinClass}) planted as ${p.entryClass}`;
    if (p.lowers && !p.threw) wrong.push(`${label}: lowering entry did not throw`);
    if (!p.lowers && p.threw) wrong.push(`${label}: non-lowering entry threw: ${p.message}`);
    if (!p.lowers && !p.threw && (p.mergedClass !== p.entryClass || p.mergedLayer !== "central")) {
      wrong.push(`${label}: merged entry is ${String(p.mergedClass)} from ${String(p.mergedLayer)}; expected the entry's class from central`);
    }
  }
  console.log(`R1-1: ${String(pairs.length)} pairs computed at run time; ${String(wrong.length)} wrong`);
  assert.equal(wrong.length, 0, wrong.join("\n"));
});

test("R1-2 error-names-entry-and-class: the message names the entry, the built-in's class, the entry's class and the unlock, built from the run-time pair", () => {
  const lowering = runAllPairs().filter((p) => p.lowers);
  assert.ok(lowering.length > 0);
  const wrong: string[] = [];
  for (const p of lowering) {
    const has = (needle: string): boolean => p.message.includes(needle);
    if (!has(JSON.stringify(p.name))) wrong.push(`${p.name}: message does not name the quoted entry`);
    if (!has(p.builtinClass)) wrong.push(`${p.name}: message does not name the built-in class ${p.builtinClass}`);
    if (!has(p.entryClass)) wrong.push(`${p.name}: message does not name the entry class ${p.entryClass}`);
    if (!has("Unlock:")) wrong.push(`${p.name}: message has no Unlock clause`);
    if (!/raise/i.test(p.message) || !/remove/i.test(p.message)) wrong.push(`${p.name}: the Unlock clause names neither raising the class nor removing the entry`);
  }
  console.log(`R1-2: ${String(lowering.length)} lowering messages checked`);
  assert.equal(wrong.length, 0, wrong.join("\n"));
});

test("R1-3 within-fixture-order-independent: a raising entry and a lowering entry for the same built-in throw in both orders (each entry is checked, not only the one that wins the merge)", () => {
  const builtins = loadBuiltinToolClassificationLayer().tools;
  const middle = builtins.filter((b) => rank(b.class) > 0 && rank(b.class) < CLASS_ORDER.length - 1);
  assert.ok(middle.length > 0, "a built-in with a class both above and below it exists");
  for (const b of middle) {
    const raise = CLASS_ORDER[CLASS_ORDER.length - 1] as ToolClass;
    const lower = CLASS_ORDER[0] as ToolClass;
    assert.throws(() => assembleCatalog(writeFixture([{ name: b.name, class: raise }, { name: b.name, class: lower }])), /Unlock:/, `${b.name}: raise then lower`);
    assert.throws(() => assembleCatalog(writeFixture([{ name: b.name, class: lower }, { name: b.name, class: raise }])), /Unlock:/, `${b.name}: lower then raise`);
  }
  console.log(`R1-3: ${String(middle.length)} built-ins checked in both orders`);
});

test("R1-3b every-offender-reported: two lowering entries in one fixture are both named in the one error", () => {
  const lowerable = loadBuiltinToolClassificationLayer().tools.filter((b) => rank(b.class) > 0);
  assert.ok(lowerable.length >= 2);
  const [a, b] = [lowerable[0], lowerable[1]];
  assert.ok(a !== undefined && b !== undefined);
  const lower = CLASS_ORDER[0] as ToolClass;
  let message = "";
  try {
    assembleCatalog(writeFixture([{ name: a.name, class: lower }, { name: b.name, class: lower }]));
  } catch (err) {
    message = (err as Error).message;
  }
  assert.ok(message.includes(JSON.stringify(a.name)) && message.includes(JSON.stringify(b.name)), `both entries are named; got: ${message}`);
});

test("R1-4 committed-fixture-passes: the committed fixture assembles; the overlap with the built-in names is derived by script and no committed entry lowers a built-in", () => {
  const location = moduleRelativeFixtureLocation();
  assert.doesNotThrow(() => assembleCatalog(location));
  const builtinByName = new Map(loadBuiltinToolClassificationLayer().tools.map((t) => [t.name, t.class]));
  const committed = loadCentralClassificationFixture(location.fixturePath).centralLayer.tools;
  const overlap = committed.filter((e) => builtinByName.has(e.name));
  console.log(`R1-4: ${String(committed.length)} committed entries, ${String(overlap.length)} share a built-in name`);
  for (const e of overlap) {
    assert.ok(rank(e.class) >= rank(builtinByName.get(e.name) as string), `committed entry ${JSON.stringify(e.name)} lowers a built-in`);
  }
});

test("R1-5 merged-never-below-builtin: for every accepted pair, the merged class ranks at or above the built-in's", () => {
  const accepted = runAllPairs().filter((p) => !p.threw);
  assert.ok(accepted.length > 0);
  for (const p of accepted) {
    assert.ok(p.mergedClass !== undefined && rank(p.mergedClass) >= rank(p.builtinClass), `${p.name}: merged ${String(p.mergedClass)} is below the built-in ${p.builtinClass}`);
  }
  // and an untouched built-in keeps its own class from the built-in layer
  const { merged } = assembleCatalog(writeFixture([]));
  for (const b of loadBuiltinToolClassificationLayer().tools) {
    const m = merged.tools.find((t) => t.name === b.name);
    assert.ok(m !== undefined && m.class === b.class, `${b.name}: an untouched built-in keeps its class`);
  }
  console.log(`R1-5: ${String(accepted.length)} accepted pairs checked`);
});

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|mjs|js)$/.test(name) && !/\.test\.(ts|mjs|js)$/.test(name)) out.push(full);
  }
}

test("R1-6 single-merge-site: the only production files naming the merge or the fixture loader/parser are their definitions and classification-catalog.ts (comment-stripped scan of src/ and hooks/, tests excluded)", () => {
  const files: string[] = [];
  walk(join(REPO_ROOT, "src"), files);
  walk(join(REPO_ROOT, "hooks"), files);
  const holders = (pattern: RegExp): string[] =>
    files
      .filter((f) => pattern.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => relative(REPO_ROOT, f).replaceAll("\\", "/"))
      .sort();
  const merge = holders(/\bmergeToolClassificationLayers\b/);
  const loader = holders(/\b(loadCentralClassificationFixture|parseCentralClassificationFixture)\b/);
  console.log(`R1-6: ${String(files.length)} production files scanned; merge named in ${JSON.stringify(merge)}; fixture loader/parser named in ${JSON.stringify(loader)}`);
  assert.deepEqual(merge, ["src/policy/rule/precedence.ts", "src/policy/tools/classification-catalog.ts"], `only the definition and classification-catalog.ts may name mergeToolClassificationLayers; got ${JSON.stringify(merge)}`);
  assert.deepEqual(loader, ["src/policy/tools/central-classification.ts", "src/policy/tools/classification-catalog.ts"], `only the definition and classification-catalog.ts may name the fixture loader/parser; got ${JSON.stringify(loader)}`);
});
