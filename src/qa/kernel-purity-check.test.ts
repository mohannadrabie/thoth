import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkKernelPurity,
  classifyImport,
  extractImportSpecifiers,
  scanFileContent,
  scanForbiddenGlobals,
  stripComments,
} from "./kernel-purity-check.ts";

const repoRoot = process.cwd();

// --- stripComments -----------------------------------------------------------

test("stripComments: removes // line comments", () => {
  assert.equal(stripComments('const x = 1; // process.env is fine to mention here'), "const x = 1; ");
});

test("stripComments: removes block comments, including multi-line ones", () => {
  const source = "/* no filesystem, network, or process access */\nconst x = 1;";
  assert.equal(stripComments(source), "\nconst x = 1;");
});

// --- scanForbiddenGlobals -----------------------------------------------------

test("scanForbiddenGlobals: catches each forbidden global/pattern individually", () => {
  const cases: [string, string][] = [
    ["process", "return process.cwd();"],
    ["fetch(", 'await fetch("https://example.com");'],
    ["setTimeout(", "setTimeout(fn, 100);"],
    ["setInterval(", "setInterval(fn, 100);"],
    ["require(", 'const x = require("fs");'],
    ["dynamic import(", 'const x = await import("./y.ts");'],
    ["__dirname", "console.log(__dirname);"],
    ["__filename", "console.log(__filename);"],
  ];
  for (const [name, snippet] of cases) {
    const found = scanForbiddenGlobals(snippet);
    assert.ok(found.some((f) => f.name === name), `expected "${name}" to be flagged in: ${snippet}`);
  }
});

test("scanForbiddenGlobals: does NOT flag pure code with none of the forbidden patterns", () => {
  assert.deepEqual(scanForbiddenGlobals("export function add(a: number, b: number) { return a + b; }"), []);
});

test("scanForbiddenGlobals (Issue #63 fix-now): catches each widened bare-identifier/constructor pattern individually", () => {
  const cases: [string, string][] = [
    ["globalThis", "return globalThis;"],
    ["global", 'return global["proc" + "ess"];'],
    ["Reflect", 'return Reflect.get(o, "x");'],
    ["eval", 'return eval("1 + 1");'],
    ["Function(", 'const f = new Function("return 1");'],
    ["Function(", 'const f = Function("return 1");'],
  ];
  for (const [name, snippet] of cases) {
    const found = scanForbiddenGlobals(snippet);
    assert.ok(found.some((f) => f.name === name), `expected "${name}" to be flagged in: ${snippet}`);
  }
});

test("scanForbiddenGlobals (Issue #63 addendum, S2 re-confirm): bare `global` — distinct from `globalThis` — is caught, closing the gap app-security-reviewer demonstrated (`global[\"proc\"+\"ess\"]` had zero detections before this fix)", () => {
  const found = scanForbiddenGlobals('return global["proc" + "ess"];');
  assert.ok(found.some((f) => f.name === "global"));
});

test("scanForbiddenGlobals (Issue #63 addendum, false-positive check): `global` is word-bounded — does NOT fire merely because `globalThis` or another word containing \"global\" as a substring appears", () => {
  assert.deepEqual(scanForbiddenGlobals("return globalization;").filter((f) => f.name === "global"), []);
  const globalThisFound = scanForbiddenGlobals("return globalThis;");
  assert.deepEqual(
    globalThisFound.filter((f) => f.name === "global"),
    [],
    "the bare-`global` pattern must not double-match inside `globalThis`",
  );
  assert.ok(globalThisFound.some((f) => f.name === "globalThis"), "globalThis itself must still be flagged under its own pattern");
});

test("scanForbiddenGlobals: a bare \"Function\" type annotation (not a call) is NOT flagged", () => {
  assert.deepEqual(scanForbiddenGlobals("export function wrap(cb: Function): void { cb(); }"), []);
});

test("scanForbiddenGlobals (Issue #63 regression): string-concatenation obfuscation of \"process\" is caught via the literal Reflect/globalThis identifiers, even though the reassembled string never appears", () => {
  const source = 'Reflect.get(globalThis, "proc" + "ess");';
  // The old process-only regex is exactly what this obfuscation defeats — confirm that directly.
  assert.deepEqual(scanForbiddenGlobals(source).filter((f) => f.name === "process"), []);
  const found = scanForbiddenGlobals(source);
  assert.ok(found.some((f) => f.name === "globalThis"));
  assert.ok(found.some((f) => f.name === "Reflect"));
});

test("scanForbiddenGlobals (false-positive regression): the word \"process\" inside a comment is NOT flagged", () => {
  const source = "// no filesystem, network, or process access\nexport function pure() { return 1; }";
  assert.deepEqual(scanForbiddenGlobals(source), []);
});

test("scanForbiddenGlobals: a real import statement for a module is not itself a dynamic-import() violation", () => {
  const source = 'import { readFile } from "node:fs/promises";';
  assert.deepEqual(scanForbiddenGlobals(source), []);
});

// --- extractImportSpecifiers ---------------------------------------------------

test("extractImportSpecifiers: extracts named, type, and bare (side-effect) imports", () => {
  const source = [
    'import { x } from "./a.ts";',
    'import type { Y } from "./b.ts";',
    'import "./c.ts";',
    'import z from "node:path";',
  ].join("\n");
  const specifiers = extractImportSpecifiers(source);
  assert.deepEqual(specifiers.sort(), ["./a.ts", "./b.ts", "./c.ts", "node:path"].sort());
});

test("extractImportSpecifiers: ignores an import specifier mentioned only in a comment", () => {
  const source = '// import { x } from "node:fs";\nexport const y = 1;';
  assert.deepEqual(extractImportSpecifiers(source), []);
});

// --- classifyImport -------------------------------------------------------------

test("classifyImport: a bare/non-relative specifier is a non-relative-import violation", () => {
  const v = classifyImport("node:fs", "src/policy/kernel/kernel.ts", "src/policy/kernel");
  assert.equal(v?.kind, "non-relative-import");
});

test("classifyImport: a relative import resolving inside kernelRoot is NOT a violation", () => {
  const v = classifyImport("./verdict.ts", "src/policy/kernel/kernel.ts", "src/policy/kernel");
  assert.equal(v, null);
});

test("classifyImport: a relative import resolving outside kernelRoot is an out-of-directory-import violation", () => {
  const v = classifyImport("../fixtures/rules.ts", "src/policy/kernel/kernel.ts", "src/policy/kernel");
  assert.equal(v?.kind, "out-of-directory-import");
  assert.match(v?.detail ?? "", /src\/policy\/fixtures\/rules\.ts/);
});

// --- scanFileContent -------------------------------------------------------------

test("scanFileContent: combines import and forbidden-global violations for one file", () => {
  const source = ['import { readFile } from "node:fs";', "export function f() { return process.cwd(); }"].join("\n");
  const violations = scanFileContent("src/policy/kernel/kernel.ts", source, "src/policy/kernel");
  assert.equal(violations.length, 2);
  assert.ok(violations.some((v) => v.kind === "non-relative-import"));
  assert.ok(violations.some((v) => v.kind === "forbidden-global"));
});

test("scanFileContent: a clean file produces zero violations", () => {
  const source = 'import { x } from "./sibling.ts";\nexport const y = x;';
  assert.deepEqual(scanFileContent("src/policy/kernel/kernel.ts", source, "src/policy/kernel"), []);
});

// --- checkKernelPurity (integration, real fixture files on disk) -----------------

test("checkKernelPurity: the CLEAN self-test fixture passes", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/clean");
  assert.equal(result.ok, true, result.details.join("\n"));
  assert.equal(result.vacuous, false);
});

test("checkKernelPurity: the VIOLATING self-test fixture fails, naming all three violation classes", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /non-relative-import/);
  assert.match(details, /out-of-directory-import/);
  assert.match(details, /forbidden-global/);
});

test("checkKernelPurity (Issue #63 fix-now, non-vacuous): the widened check catches the string-concatenation-obfuscated globalThis/Reflect fixture in the VIOLATING self-test directory", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /obfuscated-globals\.ts/);
  assert.match(details, /globalThis/);
  assert.match(details, /Reflect/);
});

test("checkKernelPurity (Issue #63 addendum, S2 re-confirm, non-vacuous): the bare-`global` variant in the same VIOLATING self-test fixture (`global[\"proc\"+\"ess\"]`) is now caught", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /obfuscated-globals\.ts/);
  assert.match(details, /forbidden global\/pattern "global" found/);
});

test("checkKernelPurity: an empty/nonexistent root -> vacuous pass, disclosed loudly", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/does-not-exist");
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("checkKernelPurity: the REAL src/policy/kernel production code is itself pure (proof, not just self-test fixtures)", async () => {
  const result = await checkKernelPurity(repoRoot, "src/policy/kernel");
  assert.equal(result.ok, true, result.details.join("\n"));
  assert.equal(result.vacuous, false, "src/policy/kernel must contain real production files by S2, not be empty");
});
