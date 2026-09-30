// AC-3j (Issue #308 precondition X-20, plan docs/plans/s308-precondition-instruments-phase1-2026-09-30.md):
// pins what hooks/pretooluse-kernel-gate.mjs USES from the six project modules it loads, and which
// environment reads those modules can make. Sibling of the AC-3 environment guard in sanitize.test.ts
// (same deny-by-default, pinned-allow-set, generated-by-AST style); its helpers are private there, so this
// file carries its own small syntactic ones.
//
// What is proven (source scans, not runtime):
//   AC-3j-1  the namespace.member pairs the real hook uses from its pinned imports are EXACTLY the pinned set.
//   AC-3j-2  no namespace is used bare, aliased, destructured, spread, computed-keyed, shadowed or re-declared.
//   AC-3j-3  every pinned pair names a real export of the module it points at, and no pair names a function
//            that reads the environment (the env-reader names are DERIVED from the AC-3j-4 scan, not typed).
//   AC-3j-4  the environment reads (process.env / cwd / argv / any process member but `platform`, the
//            env-relevant node built-ins, computed import(), ambient code-eval routes) found in the relative-import
//            graph rooted at the hook's imports are EXACTLY the pinned allow-set. Sites are keyed by scope, by
//            property text (`process.env.X`, `env.X`) AND by occurrence count (`|xN`), so a second read of a
//            pinned thing in a pinned scope fails (Issue #377). Each pinned entry is disclosed with a rationale.
//            Ambient code-eval routes flagged: `eval`, the `Function` constructor (call or new), and any
//            `.constructor(` / `["constructor"](` call chain. NOT flagged: other string-to-code routes
//            (setTimeout with a string, import of a data: URL built at run time -- the latter is caught as a
//            computed import()), and a `Function` reached only through an assembled name.
//            Node built-in decision: fs, fs/promises, net, http, https, http2, dns, dns/promises, dgram, tls
//            are scanned too. The graph legitimately uses node:fs today (four modules), pinned as an allow-set
//            below; no network built-in is imported, so any new importer of one is deny-by-default. node:path
//            and node:url are inert string helpers and stay unscanned.
//   AC-3j-5  synthetic controls: every scan flags each seeded violation; the real inputs are not flagged.
// NOT proven: runtime behaviour; a read through an assembled name, a `require`d or dynamically computed
// module, or an `env` object handed across a call boundary (the same disclosed-not-chased class as #355
// shapes 3 and 4); reachability (the graph scan is a superset: it pins every read in the graph's modules,
// and `projectDir`, which the hook's pairs cannot reach, is shown unreferenced by a separate test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "..", "..", "..");
const HOOK_PATH = path.join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs");

// ---- pinned allow-sets (a change here is a reviewed change, never inherited) ----

/** The Promise.all import namespaces of the hook, by binding name. */
const PINNED_NAMESPACES: Readonly<Record<string, string>> = {
  gate: "../src/policy/gate/decide-tool-call.ts",
  render: "../src/policy/gate/render-hook-output.ts",
  loader: "../src/policy/config/loader.ts",
  central: "../src/policy/config/central-source.ts",
  catalog: "../src/policy/tools/classification-catalog.ts",
  sanitizeMod: "../src/policy/config/sanitize.ts",
};

/** The namespace.member pairs the real hook uses, found by the AST scan below and pinned. */
const PINNED_PAIRS: ReadonlySet<string> = new Set([
  "catalog.assembleCatalog",
  "catalog.moduleRelativeFixtureLocation",
  "central.defaultCentralPolicySource",
  "gate.decideToolCall",
  "loader.loadEffectivePolicy",
  "render.renderHookOutput",
  "sanitizeMod.sanitizeForTerminal",
]);

/** Environment-read sites in the hook's relative-import graph: `file|scope|what`. Rationale per entry:
 *  - central-source.ts resolveSystemRegExePath reads SystemRoot / windir to build the absolute reg.exe path
 *    (Issue #106). An attacker who controls the environment picks the binary that answers for the registry;
 *    see #320 (SYSTEMROOT nonexistent still fails open on Node 24) and #308 precondition X-8. Reachable from
 *    `central.defaultCentralPolicySource` on win32. Accepted, disclosed.
 *  - central-source.ts imports node:child_process to run reg.exe (same rationale).
 *  - loader.ts, builtin-tool-inventory.ts, central-classification.ts and classification-catalog.ts import node:fs
 *    to read the local policy / fixture / inventory files they are named for (pinned so a NEW fs importer in the
 *    graph is a reviewed change). The `|xN` suffix is the occurrence count of that site in that scope.
 *  - classification-catalog.ts projectDir reads CLAUDE_PROJECT_DIR / cwd. It is exported but the hook uses
 *    none of the pinned pairs that reach it; a separate test proves nothing in the graph references it. */
const PINNED_ENV_SITES: ReadonlySet<string> = new Set([
  "src/policy/config/central-source.ts|<module>|import node:child_process|x1",
  "src/policy/config/central-source.ts|resolveSystemRegExePath|process.env|x1",
  "src/policy/config/central-source.ts|resolveSystemRegExePath|env.SystemRoot|x1",
  "src/policy/config/central-source.ts|resolveSystemRegExePath|env.windir|x1",
  "src/policy/tools/classification-catalog.ts|projectDir|process.cwd|x1",
  "src/policy/tools/classification-catalog.ts|projectDir|process.env|x1",
  "src/policy/tools/classification-catalog.ts|projectDir|env.CLAUDE_PROJECT_DIR|x1",
  // node:fs importers (allow-set, deny-by-default for any new one): each reads a pinned local file/dir; no network built-in is imported.
  "src/policy/config/loader.ts|<module>|import node:fs|x1",
  "src/policy/tools/builtin-tool-inventory.ts|<module>|import node:fs|x1",
  "src/policy/tools/central-classification.ts|<module>|import node:fs|x1",
  "src/policy/tools/classification-catalog.ts|<module>|import node:fs|x1",
]);

/** `process` members that are not an environment/working-directory/argument read. */
const ALLOWED_PROCESS_MEMBERS: ReadonlySet<string> = new Set(["platform"]);
/** Node built-ins whose import is an environment or execution route (a site, pinned above when real). */
const ENV_BUILTINS: ReadonlySet<string> = new Set([
  "process", "child_process", "os", "module", "worker_threads", "vm", "cluster",
  // file-system and network built-ins: the graph legitimately imports node:fs today (pinned below, one entry per
  // importing scope); every other one, and every NEW importer of node:fs, is deny-by-default.
  "fs", "fs/promises", "net", "http", "https", "http2", "dns", "dns/promises", "dgram", "tls",
]);
const AMBIENT_ROUTES: ReadonlySet<string> = new Set(["globalThis", "global", "require", "createRequire"]);

// ---- AC-3j-1/2: namespace pair scan ----

interface NamespaceScan {
  namespaces: Record<string, string>;
  pairs: string[];
  violations: string[];
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
}

const lineOf = (sf: ts.SourceFile, node: ts.Node): string => `line ${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

/** True when `id` names a property/key rather than referencing a binding. */
function isNamePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === id) ||
    (ts.isPropertyAssignment(p) && p.name === id) ||
    (ts.isBindingElement(p) && p.propertyName === id) ||
    ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === id) ||
    ts.isMetaProperty(p) ||
    ((ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) && p.label === id)
  );
}

function scanHookNamespaces(text: string): NamespaceScan {
  const sf = parse("hook.mjs", text);
  const namespaces: Record<string, string> = {};
  const declared = new Set<ts.Node>();
  const violations: string[] = [];
  let destructures = 0;
  const findDestructure = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer !== undefined) {
      const init = node.initializer;
      const call = ts.isAwaitExpression(init) ? init.expression : undefined;
      if (call !== undefined && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.getText(sf) === "Promise.all") {
        destructures++;
        const list = call.arguments[0];
        if (list === undefined || !ts.isArrayLiteralExpression(list)) violations.push(`${lineOf(sf, node)}: Promise.all argument is not an array literal`);
        else {
          node.name.elements.forEach((el, i) => {
            const item = list.elements[i];
            if (ts.isOmittedExpression(el) || !ts.isIdentifier(el.name) || el.initializer !== undefined || el.dotDotDotToken !== undefined) {
              violations.push(`${lineOf(sf, el)}: Promise.all destructuring element ${i} is not a plain binding`);
              return;
            }
            declared.add(el.name);
            if (item !== undefined && ts.isCallExpression(item) && item.expression.kind === ts.SyntaxKind.ImportKeyword) {
              const arg = item.arguments[0];
              if (arg !== undefined && ts.isStringLiteralLike(arg)) namespaces[el.name.text] = arg.text;
              else violations.push(`${lineOf(sf, item)}: import() specifier is not a plain string literal`);
            }
          });
          if (list.elements.some((e) => ts.isSpreadElement(e))) violations.push(`${lineOf(sf, list)}: spread in the Promise.all array`);
        }
      }
    }
    ts.forEachChild(node, findDestructure);
  };
  findDestructure(sf);
  if (destructures !== 1) violations.push(`expected exactly one \`await Promise.all([...])\` destructure, found ${destructures}`);

  const names = new Set(Object.keys(namespaces));
  const pairs = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && names.has(node.text) && !declared.has(node) && !isNamePosition(node)) {
      const p = node.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === node) pairs.add(`${node.text}.${p.name.text}`);
      else violations.push(`${lineOf(sf, node)}: namespace \`${node.text}\` used other than as the object of a dotted member access (bare, alias, destructure, spread, computed key, shorthand or re-declaration)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { namespaces, pairs: [...pairs].sort(), violations };
}

// ---- AC-3j-4: environment-read scan over the relative-import graph ----

const isFunctionLike = (n: ts.Node): n is ts.FunctionLikeDeclaration => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);

function scopeName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node; n !== undefined; n = n.parent) {
    if (!isFunctionLike(n)) continue;
    if (n.name !== undefined && ts.isIdentifier(n.name)) return n.name.text;
    const p = n.parent;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    // an anonymous function (for example a `cwd = () => process.cwd()` parameter default) is attributed to its named enclosing scope
  }
  return "<module>";
}

function importSpecifierText(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) return node.moduleSpecifier.text;
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const a = node.arguments[0];
    return a !== undefined && ts.isStringLiteralLike(a) ? a.text : "(computed)";
  }
  return undefined;
}

/** Environment/execution sites in one module: sorted unique `file|scope|what`. */
function scanEnvSites(file: string, text: string): string[] {
  const sf = parse(file, text);
  // one entry per (scope, what) with its OCCURRENCE COUNT: a second read of the same thing in a pinned scope changes the count.
  const counts = new Map<string, number>();
  const add = (node: ts.Node, what: string): void => {
    const key = `${file}|${scopeName(node)}|${what}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const envParams: Array<{ fn: ts.FunctionLikeDeclaration; name: string }> = [];
  const visit = (node: ts.Node): void => {
    const spec = importSpecifierText(node);
    if (spec !== undefined) {
      const bare = spec.replace(/^node:/, "");
      if (spec === "(computed)") add(node, "import() computed specifier");
      else if (ENV_BUILTINS.has(bare)) add(node, `import ${spec}`);
    }
    if (ts.isIdentifier(node) && !isNamePosition(node)) {
      if (node.text === "process") {
        const p = node.parent;
        const member = ts.isPropertyAccessExpression(p) && p.expression === node ? p.name.text : undefined;
        if (member === undefined) add(node, "process (bare or computed)");
        else if (!ALLOWED_PROCESS_MEMBERS.has(member)) {
          add(node, `process.${member}`);
          if (member === "env" && ts.isPropertyAccessExpression(p.parent) && p.parent.expression === p) add(node, `process.env.${p.parent.name.text}`);
          if (member === "env") {
            for (let a: ts.Node | undefined = node; a !== undefined; a = a.parent) {
              if (ts.isParameter(a) && a.initializer !== undefined && ts.isIdentifier(a.name) && isFunctionLike(a.parent)) envParams.push({ fn: a.parent, name: a.name.text });
              if (ts.isBlock(a)) break;
            }
          }
        }
      } else if (AMBIENT_ROUTES.has(node.text)) add(node, `ambient route ${node.text}`);
      else if (node.text === "eval") add(node, "code-eval eval");
      else if (node.text === "Function" && !ts.isTypeReferenceNode(node.parent) && !ts.isExpressionWithTypeArguments(node.parent)) add(node, "code-eval Function constructor");
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if ((ts.isPropertyAccessExpression(callee) && callee.name.text === "constructor") || (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression) && callee.argumentExpression.text === "constructor")) add(node, "code-eval .constructor( call");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const { fn, name } of envParams) {
    const walk = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === name && !isNamePosition(node) && !ts.isParameter(node.parent)) {
        const p = node.parent;
        if (ts.isPropertyAccessExpression(p) && p.expression === node) add(node, `env.${p.name.text}`);
        else add(node, "env (bare or computed)");
      }
      ts.forEachChild(node, walk);
    };
    if (fn.body !== undefined) walk(fn.body);
  }
  return [...counts].map(([k, n]) => `${k}|x${String(n)}`).sort();
}

interface Graph {
  modules: Map<string, string>; // repo-relative posix path -> source
  violations: string[];
}

const toRel = (abs: string): string => path.relative(REPO_ROOT, abs).split(path.sep).join("/");

/** BFS over relative imports from `roots` (specifiers relative to `fromDir`). `read` returns undefined for a missing file. */
function collectGraph(fromDir: string, roots: readonly string[], read: (abs: string) => string | undefined): Graph {
  const modules = new Map<string, string>();
  const violations: string[] = [];
  const queue = roots.map((r) => path.resolve(fromDir, r));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const abs = queue.shift();
    if (abs === undefined || seen.has(abs)) continue;
    seen.add(abs);
    const text = read(abs);
    if (text === undefined) {
      violations.push(`unresolvable relative import: ${toRel(abs)}`);
      continue;
    }
    modules.set(toRel(abs), text);
    const sf = parse(abs, text);
    const visit = (node: ts.Node): void => {
      const spec = importSpecifierText(node);
      if (spec !== undefined) {
        if (spec === "(computed)") violations.push(`${toRel(abs)}: import() with a non-literal specifier`);
        else if (spec.startsWith(".")) queue.push(path.resolve(path.dirname(abs), spec));
        else if (!spec.startsWith("node:")) violations.push(`${toRel(abs)}: non-relative, non-node: import "${spec}"`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { modules, violations };
}

const readReal = (abs: string): string | undefined => (existsSync(abs) ? readFileSync(abs, "utf8") : undefined);
const graphEnvSites = (g: Graph): string[] => [...new Set([...g.modules].flatMap(([file, text]) => scanEnvSites(file, text)))].sort();

const realHook = readFileSync(HOOK_PATH, "utf8");
const realGraph = collectGraph(path.dirname(HOOK_PATH), Object.values(PINNED_NAMESPACES), readReal);

// ---- real-input tests ----

test("AC-3j-1: the namespace.member pairs the real hook uses from its pinned imports are EXACTLY the pinned allow-set", () => {
  const scan = scanHookNamespaces(realHook);
  assert.deepEqual(scan.namespaces, PINNED_NAMESPACES);
  assert.deepEqual(scan.pairs, [...PINNED_PAIRS].sort());
});

test("AC-3j-2: no namespace is used bare, aliased, destructured, spread, computed-keyed, shadowed or re-declared in the real hook", () => {
  assert.deepEqual(scanHookNamespaces(realHook).violations, []);
});

test("AC-3j-3: every pinned pair resolves to an export of the named module, and no pair is an environment-reading function", () => {
  const options: ts.CompilerOptions = { allowJs: true, noResolve: true, noLib: true, types: [], noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, allowImportingTsExtensions: true };
  const envFunctions = new Set(graphEnvSites(realGraph).map((s) => s.split("|")[1]));
  assert.ok(envFunctions.size > 0, "expected the graph scan to find at least one env-reading function");
  for (const pair of PINNED_PAIRS) {
    const [ns, member] = pair.split(".");
    assert.ok(ns !== undefined && member !== undefined, pair);
    const spec = PINNED_NAMESPACES[ns];
    assert.ok(spec !== undefined, `pair ${pair}: namespace not pinned`);
    const file = path.resolve(path.dirname(HOOK_PATH), spec);
    const program = ts.createProgram({ rootNames: [file], options });
    const checker = program.getTypeChecker();
    const sf = program.getSourceFile(file);
    assert.ok(sf, `no source file for ${spec}`);
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    assert.ok(moduleSymbol, `${spec} is not a module`);
    const exported = checker.getExportsOfModule(moduleSymbol).map((s) => s.name);
    assert.ok(exported.includes(member), `pair ${pair}: ${spec} has no export named ${member}`);
    assert.ok(!envFunctions.has(member), `pair ${pair}: ${member} is a function that reads the environment (AC-3j-4 scan)`);
  }
});

test("AC-3j-4: the relative-import graph is fully resolved and every module is a literal, relative or node: import", () => {
  assert.deepEqual(realGraph.violations, []);
  for (const spec of Object.values(PINNED_NAMESPACES)) assert.ok(realGraph.modules.has(toRel(path.resolve(path.dirname(HOOK_PATH), spec))), `root ${spec} missing from the graph`);
});

test("AC-3j-4: env reads reachable in the hook's import graph are EXACTLY the pinned allow-set (SystemRoot/windir in resolveSystemRegExePath, plus the unreferenced projectDir)", () => {
  assert.deepEqual(graphEnvSites(realGraph), [...PINNED_ENV_SITES].sort());
});

test("AC-3j-4: nothing in the graph references projectDir (the pinned env reader the hook's pairs cannot reach)", () => {
  const refs: string[] = [];
  for (const [file, text] of realGraph.modules) {
    const sf = parse(file, text);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "projectDir" && !isNamePosition(node) && !(ts.isFunctionDeclaration(node.parent) && node.parent.name === node)) refs.push(`${file}: ${lineOf(sf, node)}`);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  assert.deepEqual(refs, []);
});

// ---- AC-3j-5: synthetic controls (each pin can fail) ----

const FRAME = (uses: string, extraImport = ""): string =>
  [
    "const [raw, gate, render, loader, central, catalog, sanitizeMod] = await Promise.all([",
    "  readStdin(),",
    '  import("../src/policy/gate/decide-tool-call.ts"),',
    '  import("../src/policy/gate/render-hook-output.ts"),',
    '  import("../src/policy/config/loader.ts"),',
    '  import("../src/policy/config/central-source.ts"),',
    '  import("../src/policy/tools/classification-catalog.ts"),',
    '  import("../src/policy/config/sanitize.ts"),',
    extraImport,
    "]);",
    uses,
  ].join("\n");

test("AC-3j-5 positive control: the frame with only real pairs scans clean and yields exactly its pairs", () => {
  const scan = scanHookNamespaces(FRAME("catalog.assembleCatalog(catalog.moduleRelativeFixtureLocation());"));
  assert.deepEqual(scan.violations, []);
  assert.deepEqual(scan.pairs, ["catalog.assembleCatalog", "catalog.moduleRelativeFixtureLocation"]);
});

test("AC-3j-5: a new pair (catalog.projectDir) changes the pair set, so AC-3j-1 would fail", () => {
  const scan = scanHookNamespaces(FRAME("catalog.projectDir();"));
  assert.ok(scan.pairs.includes("catalog.projectDir"));
  assert.ok(!PINNED_PAIRS.has("catalog.projectDir"));
});

const NAMESPACE_EVASIONS: ReadonlyArray<readonly [name: string, uses: string]> = [
  ["bare namespace passed as a value", "f(catalog);"],
  ["alias of a namespace", "const c = catalog;\nc.projectDir();"],
  ["destructure from a namespace", "const { projectDir } = catalog;"],
  ["computed key", 'render["renderHookOutput"](x);'],
  ["spread of a namespace", "const o = { ...loader };"],
  ["shorthand property", "const o = { central };"],
  ["shadowing parameter", "function h(catalog) { return catalog.assembleCatalog; }"],
  ["re-declaration", "let gate = null;"],
  ["namespace returned", "const f = () => sanitizeMod;"],
];

for (const [name, uses] of NAMESPACE_EVASIONS) {
  test(`AC-3j-5: the namespace scan flags this evasion (AC-3j-2): ${name}`, () => {
    assert.ok(scanHookNamespaces(FRAME(uses)).violations.length > 0, `expected a violation for: ${name}`);
  });
}

test("AC-3j-5: a seventh import changes the namespace map, so AC-3j-1 would fail", () => {
  const text = FRAME("", 'import("../src/policy/extra.ts"),').replace("sanitizeMod] =", "sanitizeMod, extra] =");
  assert.notDeepEqual(scanHookNamespaces(text).namespaces, PINNED_NAMESPACES);
});

test("AC-3j-5: a second Promise.all destructure is flagged", () => {
  assert.ok(scanHookNamespaces(`${FRAME("")}\n${FRAME("")}`).violations.length > 0);
});

const ENV_EVASIONS: ReadonlyArray<readonly [name: string, source: string]> = [
  ["process.env read in a new function", "export function f() { return process.env.SECRET; }"],
  ["process.argv", "export const a = () => process.argv;"],
  ["process.cwd", "export function g() { return process.cwd(); }"],
  ["process bracket access", 'export function g() { return process["env"]; }'],
  ["process aliased", "const p = process;"],
  ["child_process static import", 'import { execSync } from "node:child_process";'],
  ["os dynamic import", 'export async function h() { return import("node:os"); }'],
  ["computed dynamic import", "export async function h(x) { return import(x); }"],
  ["globalThis route", "export const v = globalThis;"],
  ["env param default read by a new member", "export function r(env = process.env) { return env.HOME; }"],
];

for (const [name, source] of ENV_EVASIONS) {
  test(`AC-3j-5: the env-read scan flags this shape, and it is not on the pinned allow-set: ${name}`, () => {
    const sites = scanEnvSites("src/policy/x.ts", source);
    assert.ok(sites.length > 0, `expected a site for: ${name}`);
    assert.ok(sites.every((s) => !PINNED_ENV_SITES.has(s)), "a synthetic site must not collide with a pinned one");
  });
}

test("AC-3j-5 positive control: process.platform and pure code are not sites", () => {
  assert.deepEqual(scanEnvSites("src/policy/x.ts", 'export function p(platform = process.platform) { return platform === "win32"; }'), []);
});

test("AC-3j-5: a module added to the graph that reads process.env is flagged (graph-level control), and a missing module is a violation", () => {
  const files = new Map<string, string>([
    ["/g/a.ts", 'import { b } from "./b.ts";\nexport const a = b;'],
    ["/g/b.ts", "export const b = () => process.env.LEAK;"],
  ]);
  const graph = collectGraph("/g", ["./a.ts"], (abs) => files.get(abs.split(path.sep).join("/").replace(/^[A-Za-z]:/, "")));
  assert.deepEqual(graph.violations, []);
  assert.ok(graph.modules.size === 2);
  const sites = [...graph.modules].flatMap(([file, text]) => scanEnvSites(file, text));
  assert.ok(sites.some((s) => s.includes("|process.env|")), "the added module's env read must be found");
  const broken = collectGraph("/g", ["./a.ts"], (abs) => (abs.replace(/\\/g, "/").endsWith("/a.ts") ? files.get("/g/a.ts") : undefined));
  assert.ok(broken.violations.length > 0, "an unresolvable import must be a violation");
});

test("AC-3j-5: a bare-package import in the graph is a violation", () => {
  const g = collectGraph("/g", ["./a.ts"], () => 'import x from "left-pad";');
  assert.ok(g.violations.some((v) => v.includes("left-pad")));
});

// ---- Issues #377 and hardening: occurrence counts, property text, ambient code-eval routes ----

const realSource = (rel: string): string => {
  const text = realGraph.modules.get(rel);
  assert.ok(text !== undefined, `${rel} is in the graph`);
  return text;
};

test("AC-3j-4: a second process.env read in resolveSystemRegExePath changes the site set", () => {
  const rel = "src/policy/config/central-source.ts";
  const text = realSource(rel);
  const before = scanEnvSites(rel, text);
  const anchor = "const systemRoot = env.SystemRoot || env.windir ||";
  assert.ok(text.includes(anchor), "anchor line present");
  const mutants: ReadonlyArray<readonly [name: string, line: string]> = [
    ["a second process.env.PATH read", `const p = process.env.PATH;\n  ${anchor}`],
    ["a second process.env.SystemRoot read (same property text, one more occurrence)", `const p = process.env.SystemRoot;\n  ${anchor}`],
    ["a second use of the env parameter's SystemRoot", `const q = env.SystemRoot;\n  ${anchor}`],
  ];
  for (const [name, line] of mutants) {
    const after = scanEnvSites(rel, text.replace(anchor, line));
    assert.notDeepEqual(after, before, `the site set must change for: ${name}`);
    assert.notDeepEqual(after, [...PINNED_ENV_SITES].sort(), `the pin must fail for: ${name}`);
  }
});

test("AC-3j-4: a second process.env read in projectDir changes the site set", () => {
  const rel = "src/policy/tools/classification-catalog.ts";
  const text = realSource(rel);
  const anchor = "return env.CLAUDE_PROJECT_DIR ?? cwd();";
  assert.ok(text.includes(anchor), "anchor line present");
  const after = scanEnvSites(rel, text.replace(anchor, `void process.env.HOME;\n  ${anchor}`));
  assert.notDeepEqual(after, scanEnvSites(rel, text));
});

test("AC-3j-4: process.env.<property> reads are recorded by property text", () => {
  assert.ok(scanEnvSites("src/policy/x.ts", "export const a = () => process.env.SECRET;").some((s) => s.includes("|process.env.SECRET|")));
  assert.notDeepEqual(scanEnvSites("src/policy/x.ts", "export const a = () => process.env.A;"), scanEnvSites("src/policy/x.ts", "export const a = () => process.env.B;"));
});

const EVAL_ROUTES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["eval call", "export const e = (s) => eval(s);"],
  ["indirect eval", "export const e = (s) => (0, eval)(s);"],
  ["Function constructor with new", 'export const f = () => new Function("return process")();'],
  ["Function constructor without new", 'export const f = () => Function("return process")();'],
  [".constructor( call chain", 'export const f = () => (() => 1).constructor("return process")();'],
  ["constructor.constructor chain", 'export const f = (x) => x.constructor.constructor("return process")();'],
  ["computed constructor call", 'export const f = (x) => x["constructor"]("return process")();'],
];

for (const [name, source] of EVAL_ROUTES) {
  test(`AC-3j-4: the env-read scan flags this ambient code-eval route: ${name}`, () => {
    const sites = scanEnvSites("src/policy/x.ts", source);
    assert.ok(sites.some((s) => s.includes("|code-eval ")), `expected a code-eval site for: ${name}; got ${JSON.stringify(sites)}`);
    assert.ok(sites.every((s) => !PINNED_ENV_SITES.has(s)));
  });
}

test("AC-3j-4: pure code that merely names a `constructor` member or a `Function` type is not a code-eval site", () => {
  assert.deepEqual(scanEnvSites("src/policy/x.ts", "export class A { constructor(public n: number) {} }\nexport const t = (f: Function) => f.name;"), []);
});

const FS_NET_MODULES = ["fs", "fs/promises", "net", "http", "https", "dns", "dns/promises", "dgram", "tls", "http2"];
for (const m of FS_NET_MODULES) {
  test(`AC-3j-4: an import of node:${m} in the graph is a site (deny-by-default outside the pinned allow-set): ${m}`, () => {
    const sites = scanEnvSites("src/policy/x.ts", `import * as m from "node:${m}";\nexport const v = m;`);
    assert.ok(sites.some((s) => s.includes(`|import node:${m}|`)), JSON.stringify(sites));
    assert.ok(sites.every((s) => !PINNED_ENV_SITES.has(s)));
  });
}

test("AC-3j-4: the fs/net built-in sites pinned today are derived from the real graph and the pinned set contains exactly those", () => {
  const found = graphEnvSites(realGraph).filter((s) => /\|import node:(fs|net|http|https|dns|dgram|tls|http2)(\/promises)?\|/.test(s));
  const pinned = [...PINNED_ENV_SITES].filter((s) => /\|import node:(fs|net|http|https|dns|dgram|tls|http2)(\/promises)?\|/.test(s)).sort();
  assert.deepEqual(found, pinned);
  assert.ok(found.length > 0, "the graph legitimately imports node:fs today (loader, classification-catalog)");
  assert.ok(!found.some((s) => /node:(net|http|https|dns|dgram|tls|http2)/.test(s)), "no network module is imported by the graph today");
});
