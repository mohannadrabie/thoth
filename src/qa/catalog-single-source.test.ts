// R1-6c one-catalog-source (Issue #308 activation precondition X-15, plan
// docs/plans/s308-precondition-instruments-phase1-2026-09-30.md, step S4; closes the "settle with an instrument that
// enumerates catalog sources" note left by Issue #332).
//
// Question: does every classification catalog that reaches the kernel gate come from assembleCatalog
// (src/policy/tools/classification-catalog.ts), the one funnel that loads the fixture, rejects a lowering entry
// and merges? R1-6 and R1-6b pin who READS the fixture; neither pins that nothing hands the gate a hand-built catalog
// (which needs neither the merge nor the fixture and satisfies both).
//
// What this instrument enumerates, by AST over every production file under src/ and hooks/ (tests and
// hooks/test-support excluded), at run time:
//   1. DEFINITION sites of a `loadCatalog` member (the gate's catalog port): method, property, shorthand,
//      signature, or any string-literal/computed key spelling it. Pinned: the port declaration in
//      src/policy/gate/decide-tool-call.ts and the one implementation in hooks/pretooluse-kernel-gate.mjs.
//   2. CALL sites of `.loadCatalog(`. Pinned: the one in decide-tool-call.ts (the only route a catalog enters the gate).
//   3. WRITERS of a `catalog` object-literal property (the field the normalizer reads). Pinned: decide-tool-call.ts
//      (shorthand, the value of the call in 2) and tool-routing.ts (`catalog: ctx.catalog`).
//   4. HOLDERS of the type name MergedToolClassificationSet. Pinned to the files listed below, so a new module that
//      handles a catalog surfaces here for review.
//   5. The implementation body: the hook's `loadCatalog` is exactly `return <catalogNs>.assembleCatalog(
//      <catalogNs>.moduleRelativeFixtureLocation()).merged;`, where <catalogNs> is the Promise.all binding of
//      "../src/policy/tools/classification-catalog.ts" (the namespace that AC-3j-2 shows is never aliased),
//      and the object literal holding it has no spread and no computed key (nothing else can inject a port).
//
// COVERAGE vs the #355 shapes (read this before citing the instrument):
//   - #355 shapes 3 and 4 (a promise file-handle read; a synchronous read via an assembled file name): NOT covered
//     BY DESIGN. Those are fixture-READ shapes; this instrument asks who SUPPLIES the catalog value, and an
//     assembled-name read is invisible to a name-based scan. Their exposure is measured by the existing real-tree
//     scan (R1-6b, src/policy/tools/classification-builtin-override.test.ts), a labelled heuristic, not by this test.
//   - A catalog built from any source but passed to the gate through one of the enumerated sites is caught only at
//     the implementation (5). A value that reaches the kernel by a route this scan does not enumerate (a future
//     second port, a runtime property write on the merged object, a test double in production wiring) is NOT covered.
//   - Static, source-level, run once: no runtime provenance tag is proven.
// Seeded mutants (each MUST be flagged): a second loadCatalog implementation returning a literal; a hook whose
// loadCatalog returns a hand-built literal; returns `.builtinLayer` (not `.merged`); passes a different location;
// a spread into the ports object; a second call site; a new `catalog:` writer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CATALOG_SPECIFIER = "../src/policy/tools/classification-catalog.ts";
const HOOK_REL = "hooks/pretooluse-kernel-gate.mjs";
const GATE_REL = "src/policy/gate/decide-tool-call.ts";
const ROUTING_REL = "src/policy/gate/tool-routing.ts";

const PINNED_DEFINITIONS = [`${GATE_REL}`, HOOK_REL];
const PINNED_CALL_SITES = [GATE_REL];
const PINNED_CATALOG_WRITERS = [GATE_REL, ROUTING_REL];
const PINNED_TYPE_HOLDERS = [
  "src/policy/gate/decide-tool-call.ts",
  "src/policy/gate/tool-routing.ts",
  "src/policy/normalizer/tool-class-format.ts",
  "src/policy/normalizer/tool-class.ts",
  "src/policy/rule/precedence.ts",
  "src/policy/tools/classification-catalog.ts",
  "src/policy/tools/classification.ts",
];

interface Src {
  rel: string;
  text: string;
}

function collect(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "test-support") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(ts|mjs|js)$/.test(name) && !/\.test\.(ts|mjs|js)$/.test(name)) out.push(full);
  }
}

function realSources(): Src[] {
  const files: string[] = [];
  collect(path.join(REPO_ROOT, "src"), files);
  collect(path.join(REPO_ROOT, "hooks"), files);
  return files.map((f) => ({ rel: path.relative(REPO_ROOT, f).split(path.sep).join("/"), text: readFileSync(f, "utf8") }));
}

const parse = (rel: string, text: string): ts.SourceFile => ts.createSourceFile(rel, text, ts.ScriptTarget.ESNext, true, rel.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
const lineOf = (sf: ts.SourceFile, n: ts.Node): string => `${sf.fileName}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;

const keyText = (name: ts.PropertyName | undefined): string | undefined => {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return ts.isStringLiteralLike(name.expression) ? name.expression.text : "(computed)";
  return undefined;
};

interface Enumeration {
  definitions: string[];
  callSites: string[];
  catalogWriters: string[];
  typeHolders: string[];
  problems: string[];
}

function enumerate(sources: readonly Src[]): Enumeration {
  const definitions = new Set<string>();
  const callSites = new Set<string>();
  const writers = new Set<string>();
  const holders = new Set<string>();
  const problems: string[] = [];
  for (const { rel, text } of sources) {
    const sf = parse(rel, text);
    const visit = (node: ts.Node): void => {
      if ((ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isPropertyAssignment(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && keyText(node.name) === "loadCatalog") definitions.add(rel);
      if (ts.isShorthandPropertyAssignment(node)) {
        if (node.name.text === "loadCatalog") definitions.add(rel);
        if (node.name.text === "catalog") writers.add(rel);
      }
      if ((ts.isPropertyAssignment(node) || ts.isPropertySignature(node)) && keyText(node.name) === "catalog" && !ts.isPropertySignature(node)) writers.add(rel);
      if (ts.isStringLiteralLike(node) && node.text === "loadCatalog" && !(ts.isPropertyAssignment(node.parent) || ts.isMethodDeclaration(node.parent))) problems.push(`${lineOf(sf, node)}: the string "loadCatalog" outside a plain member definition`);
      if (ts.isElementAccessExpression(node) && !ts.isNumericLiteral(node.argumentExpression) && !ts.isStringLiteralLike(node.argumentExpression)) {
        /* computed access is not enumerable here; only flagged when it touches a ports-like object */
        if (/ports/i.test(node.expression.getText(sf))) problems.push(`${lineOf(sf, node)}: computed access on a ports-like object`);
      }
      if (ts.isBindingElement(node) && ((ts.isIdentifier(node.name) && node.name.text === "loadCatalog") || (node.propertyName !== undefined && keyText(node.propertyName) === "loadCatalog"))) problems.push(`${lineOf(sf, node)}: loadCatalog destructured out of an object (an alias of the port)`);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "loadCatalog") callSites.add(rel);
      if (ts.isIdentifier(node) && node.text === "MergedToolClassificationSet") holders.add(rel);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { definitions: [...definitions].sort(), callSites: [...callSites].sort(), catalogWriters: [...writers].sort(), typeHolders: [...holders].sort(), problems };
}

/** Problems with the hook's loadCatalog implementation (empty when it is exactly the pinned funnel call). */
function checkHookImplementation(hookText: string): string[] {
  const sf = parse(HOOK_REL, hookText);
  const problems: string[] = [];
  // the namespace bound to the classification-catalog module by the Promise.all destructure
  const namespaces = new Set<string>();
  const findBind = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer !== undefined && ts.isAwaitExpression(node.initializer) && ts.isCallExpression(node.initializer.expression)) {
      const list = node.initializer.expression.arguments[0];
      if (list !== undefined && ts.isArrayLiteralExpression(list)) {
        node.name.elements.forEach((el, i) => {
          const item = list.elements[i];
          if (!ts.isOmittedExpression(el) && ts.isIdentifier(el.name) && item !== undefined && ts.isCallExpression(item) && item.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const a = item.arguments[0];
            if (a !== undefined && ts.isStringLiteralLike(a) && a.text === CATALOG_SPECIFIER) namespaces.add(el.name.text);
          }
        });
      }
    }
    ts.forEachChild(node, findBind);
  };
  findBind(sf);
  if (namespaces.size !== 1) return [`expected exactly one Promise.all binding of ${CATALOG_SPECIFIER}, found ${namespaces.size}`];
  const ns = [...namespaces][0] as string;

  const impls: ts.MethodDeclaration[] = [];
  const holdersOfPort: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && keyText(node.name) === "loadCatalog") {
      impls.push(node);
      if (ts.isObjectLiteralExpression(node.parent)) holdersOfPort.push(node.parent);
    }
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && keyText(node.name) === "loadCatalog") problems.push(`${lineOf(sf, node)}: loadCatalog defined as a property, not the pinned method`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (impls.length !== 1) return [...problems, `expected exactly one loadCatalog method in the hook, found ${impls.length}`];
  const impl = impls[0] as ts.MethodDeclaration;
  for (const holder of holdersOfPort) {
    for (const p of holder.properties) {
      if (ts.isSpreadAssignment(p)) problems.push(`${lineOf(sf, p)}: spread inside the ports object`);
      if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && p.name !== undefined && ts.isComputedPropertyName(p.name)) problems.push(`${lineOf(sf, p)}: computed key inside the ports object`);
    }
  }
  const body = impl.body?.statements ?? [];
  const ret = body[0];
  if (body.length !== 1 || ret === undefined || !ts.isReturnStatement(ret) || ret.expression === undefined) return [...problems, "loadCatalog body is not a single return statement"];
  const merged = ret.expression;
  const isNsCall = (e: ts.Expression, member: string): e is ts.CallExpression => ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression) && e.expression.expression.text === ns && e.expression.name.text === member && !e.expression.questionDotToken && !e.questionDotToken;
  if (!ts.isPropertyAccessExpression(merged) || merged.name.text !== "merged" || !isNsCall(merged.expression, "assembleCatalog")) return [...problems, `loadCatalog must return ${ns}.assembleCatalog(...).merged`];
  const args = merged.expression.arguments;
  const loc = args[0];
  if (args.length !== 1 || loc === undefined || !isNsCall(loc, "moduleRelativeFixtureLocation") || loc.arguments.length !== 0) problems.push(`assembleCatalog must be called with exactly ${ns}.moduleRelativeFixtureLocation() (the gate's env-free location)`);
  return problems;
}

const real = realSources();
const realHook = (): string => (real.find((s) => s.rel === HOOK_REL) as Src).text;

test("R1-6c: every catalog definition site, call site, `catalog` writer and type holder in production is on the pinned enumeration (derived by AST at run time)", () => {
  const e = enumerate(real);
  console.log(`R1-6c: ${String(real.length)} production files scanned; definitions ${JSON.stringify(e.definitions)}; call sites ${JSON.stringify(e.callSites)}; catalog writers ${JSON.stringify(e.catalogWriters)}; type holders ${String(e.typeHolders.length)}`);
  assert.deepEqual(e.problems, []);
  assert.deepEqual(e.definitions, [...PINNED_DEFINITIONS].sort());
  assert.deepEqual(e.callSites, [...PINNED_CALL_SITES].sort());
  assert.deepEqual(e.catalogWriters, [...PINNED_CATALOG_WRITERS].sort());
  assert.deepEqual(e.typeHolders, [...PINNED_TYPE_HOLDERS].sort());
});

test("R1-6c: the hook's loadCatalog is exactly the assembleCatalog funnel (module-relative location, .merged) and the ports object cannot be injected into", () => {
  assert.deepEqual(checkHookImplementation(realHook()), []);
});

// ---- seeded mutants (each pin can fail) ----

const HOOK_FRAME = (impl: string, extra = ""): string =>
  [
    "const [raw, gate, render, loader, central, catalog, sanitizeMod] = await Promise.all([",
    "  readStdin(),",
    '  import("../src/policy/gate/decide-tool-call.ts"),',
    '  import("../src/policy/gate/render-hook-output.ts"),',
    '  import("../src/policy/config/loader.ts"),',
    '  import("../src/policy/config/central-source.ts"),',
    '  import("../src/policy/tools/classification-catalog.ts"),',
    '  import("../src/policy/config/sanitize.ts"),',
    "]);",
    `const ports = { ${extra} loadPolicy() { return null; }, ${impl} };`,
  ].join("\n");

const REAL_IMPL = "loadCatalog() { return catalog.assembleCatalog(catalog.moduleRelativeFixtureLocation()).merged; }";

test("R1-6c positive control: the pinned implementation, framed synthetically, is clean", () => {
  assert.deepEqual(checkHookImplementation(HOOK_FRAME(REAL_IMPL)), []);
});

const IMPL_MUTANTS: ReadonlyArray<readonly [name: string, frame: string]> = [
  ["a hand-built literal catalog", HOOK_FRAME('loadCatalog() { return { version: "x", tools: [] }; }')],
  ["the built-in layer instead of .merged", HOOK_FRAME("loadCatalog() { return catalog.assembleCatalog(catalog.moduleRelativeFixtureLocation()).builtinLayer; }")],
  ["assembleCatalog with an env-controlled location", HOOK_FRAME("loadCatalog() { return catalog.assembleCatalog(catalog.resolveFixtureLocation(process.cwd())).merged; }")],
  ["a location passed that is not the module-relative call", HOOK_FRAME('loadCatalog() { return catalog.assembleCatalog({ fixtureSource: "module-relative", fixturePath: "/x" }).merged; }')],
  ["a second statement before the return", HOOK_FRAME("loadCatalog() { const c = null; return catalog.assembleCatalog(catalog.moduleRelativeFixtureLocation()).merged; }")],
  ["a spread into the ports object", HOOK_FRAME(REAL_IMPL, "...other,")],
  ["a computed key in the ports object", HOOK_FRAME(REAL_IMPL, "[k]: 1,")],
  ["loadCatalog as a property instead of the method", HOOK_FRAME("loadCatalog: () => catalog.assembleCatalog(catalog.moduleRelativeFixtureLocation()).merged")],
  ["a second loadCatalog implementation", HOOK_FRAME(`${REAL_IMPL}, loadCatalog() { return null; }`)],
  ["optional-chained funnel call", HOOK_FRAME("loadCatalog() { return catalog?.assembleCatalog(catalog.moduleRelativeFixtureLocation()).merged; }")],
];

for (const [name, frame] of IMPL_MUTANTS) {
  test(`R1-6c seeded mutant: the implementation check flags ${name}`, () => {
    assert.ok(checkHookImplementation(frame).length > 0, `expected a problem for: ${name}`);
  });
}

test("R1-6c seeded mutant: a second production loadCatalog implementation, a second call site, a new catalog writer and a new type holder each change the enumeration", () => {
  const base: Src[] = [
    { rel: GATE_REL, text: "export interface P { loadCatalog(): MergedToolClassificationSet }\nconst catalog = ports.loadCatalog();\nbuild({ catalog });" },
    { rel: ROUTING_REL, text: "const raw = { catalog: ctx.catalog };" },
    { rel: HOOK_REL, text: "const ports = { loadCatalog() { return 1; } };" },
  ];
  const clean = enumerate(base);
  assert.deepEqual(clean.definitions, [...PINNED_DEFINITIONS].sort());
  assert.deepEqual(clean.callSites, [GATE_REL]);
  const extra = (text: string): Enumeration => enumerate([...base, { rel: "src/policy/rogue.ts", text }]);
  assert.ok(extra("export const p = { loadCatalog() { return { version: 'x', tools: [] }; } };").definitions.includes("src/policy/rogue.ts"));
  assert.ok(extra('export const p = { "loadCatalog": () => 1 };').definitions.includes("src/policy/rogue.ts"));
  assert.ok(extra("const { loadCatalog } = ports;").problems.length > 0, "destructuring the port out is a problem");
  assert.ok(extra("const o = { loadCatalog };").definitions.includes("src/policy/rogue.ts"));
  assert.ok(extra("const c = other.loadCatalog();").callSites.includes("src/policy/rogue.ts"));
  assert.ok(extra("const r = { catalog: handBuilt };").catalogWriters.includes("src/policy/rogue.ts"));
  assert.ok(extra("const r = { catalog };").catalogWriters.includes("src/policy/rogue.ts"));
  assert.ok(extra("let c: MergedToolClassificationSet;").typeHolders.includes("src/policy/rogue.ts"));
  assert.ok(extra('const k = "loadCatalog"; ports[k]();').problems.length > 0, "a string spelling of the port name outside a member definition is a problem");
});
