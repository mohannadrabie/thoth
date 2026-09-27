// S7-A fix-now round 1 (Issue #321 sweep), story-implementer's own test. Runs the scaling sweep once and asserts
// (a) no function exceeded the bound, (b) the enumeration is real (functions from the module exports in both
// directions, operator tokens parsed from the scanner source, whitespace and shape floors), and (c) the sweep
// DETECTS a quadratic scan: it is handed the OLD separator scan (taken from the frozen oracle) and must fail it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUND_MS, SWEEP_ADAPTERS, SWEEP_SIZES, WHITESPACE_KINDS, buildShapes, operatorTokens, runSweep, summarizeSweep, sweepCoverage, tableFromScannerSource } from "./gate-path-scaling-sweep.ts";
import { findLiveTrailingSensitiveSeparator as oldSeparatorScan } from "./frozen-shell-scanner-s7a-base.ts";

const report = runSweep();

test("gate-path-scaling-sweep: every exported scanner and shell-normalizer function stays under the bound on every enumerated shape at 16, 64 and 128 KB", () => {
  const result = summarizeSweep(report);
  assert.equal(result.ok, true, `${result.summary}\n${result.details.join("\n")}`);
  assert.deepEqual(report.failures, []);
  console.log(`# ${result.summary}`);
  for (const line of result.details) console.log(`#   ${line}`);
});

test("gate-path-scaling-sweep: the function list is the module export enumeration, in both directions, and the sweep ran every listed function on every shape and size", () => {
  const coverage = sweepCoverage();
  assert.deepEqual(coverage.uncovered, [], "an exported function without an adapter is not measured");
  assert.deepEqual(coverage.stale, [], "an adapter for a function nobody exports is stale");
  assert.ok(coverage.exported.length >= 15, `the enumeration found only ${coverage.exported.length} functions: the enumerator is blind`);
  assert.ok(coverage.exported.includes("shell.normalizeShellCall"), "the shell normalizer's entry point is swept");
  assert.ok(coverage.exported.includes("shell-scanner.findLiveTrailingSensitiveSeparator"), "the separator scan (Issue #321) is swept");
  assert.deepEqual(Object.keys(SWEEP_ADAPTERS).sort(), coverage.exported);
  assert.equal(report.functions.length, coverage.exported.length);
  for (const f of report.functions) assert.equal(f.calls, report.shapes * SWEEP_SIZES.length, `${f.fn}: every shape at every size`);
  assert.deepEqual([...SWEEP_SIZES], [16 * 1024, 64 * 1024, 128 * 1024]);
});

test("gate-path-scaling-sweep: operator tokens are parsed from the scanner source, and the shapes cover every whitespace kind and every token", () => {
  const chain = tableFromScannerSource("CHAIN_OPERATORS");
  const substitution = tableFromScannerSource("SUBSTITUTION_MARKERS");
  assert.ok(chain.length >= 4 && chain.includes("&&") && chain.includes(";"), `parsed chain operators: ${JSON.stringify(chain)}`);
  assert.ok(substitution.length >= 4 && substitution.includes("$(") && substitution.includes("`"), `parsed substitution markers: ${JSON.stringify(substitution)}`);
  const tokens = operatorTokens();
  for (const t of [...chain, ...substitution]) assert.ok(tokens.includes(t), `token ${JSON.stringify(t)} from the source tables is swept`);
  assert.throws(() => tableFromScannerSource("NO_SUCH_TABLE"), /enumeration is blind/);
  for (const w of ["\n", "\r\n", "\t", " "]) assert.ok(WHITESPACE_KINDS.includes(w as never), `whitespace kind ${JSON.stringify(w)}`);
  const shapes = buildShapes();
  const names = shapes.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, "shape names are unique");
  assert.ok(names.some((n) => n.startsWith("command then trailing whitespace")), "the Issue #321 shape is swept");
  assert.ok(shapes.length >= 100, `only ${shapes.length} shapes`);
  for (const shape of shapes) assert.ok(shape.build(16 * 1024).length >= 16 * 1024, `${shape.name} reaches the requested size`);
  assert.ok(BOUND_MS <= 1000, "the bound is the documented 1000 ms");
});

test("gate-path-scaling-sweep is not vacuous: handed the OLD (quadratic) separator scan it reports it over the bound on a trailing-newline shape", () => {
  const shapes = buildShapes().filter((s) => s.name === 'command then trailing whitespace "\\n"');
  assert.equal(shapes.length, 1);
  const quadratic = runSweep({ "shell-scanner.findLiveTrailingSensitiveSeparator": (t) => oldSeparatorScan(t) }, 500, [16 * 1024], shapes);
  assert.equal(quadratic.failures.length, 1, "the old scan takes about two seconds on 16 KB of newlines");
  assert.match(summarizeSweep(quadratic).summary, /over the 500 ms bound/);
  const linear = runSweep({ "shell-scanner.findLiveTrailingSensitiveSeparator": SWEEP_ADAPTERS["shell-scanner.findLiveTrailingSensitiveSeparator"] as (t: string) => unknown }, 500, [16 * 1024, 128 * 1024], shapes);
  assert.deepEqual(linear.failures, [], "the current scan passes the same shape at 16 and 128 KB");
});

test("gate-path-scaling-sweep: an exported function without an adapter fails the summary (the enumeration is a gate, not a note)", () => {
  const synthetic = { ...report, coverage: { ...report.coverage, uncovered: ["shell-scanner.someNewScan"] } };
  const result = summarizeSweep(synthetic);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /COVERAGE: exported function shell-scanner.someNewScan has no sweep adapter/);
});
