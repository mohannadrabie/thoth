// Unit tests for src/policy/config/sanitize.ts (Issue #294): the one helper that strips
// terminal-active characters from policy-derived text before `policy:print` writes it to stdout.
//
// Written FIRST (failing), by story-implementer, per the approved Phase 1 plan
// (docs/plans/s6-294-echoed-key-sanitize-phase1-2026-09-26.md, criteria 1 to 4).
//
// The oracle for "exactly which characters are stripped" is an EXPLICIT range list, deliberately
// not the same regex the implementation uses: a test that re-derives its expectation from the
// implementation's own literal cannot catch that literal being wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { sanitizeForTerminal } from "./sanitize.ts";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "..", "..", "..");

/** Independent oracle: C0 (0x00-0x1F), DEL and C1 (0x7F-0x9F), U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR. */
function isStripped(codeUnit: number): boolean {
  return (codeUnit >= 0x00 && codeUnit <= 0x1f) || (codeUnit >= 0x7f && codeUnit <= 0x9f) || codeUnit === 0x2028 || codeUnit === 0x2029;
}

test("sanitizeForTerminal strips exactly the C0, DEL, C1, U+2028 and U+2029 code points across the whole BMP", () => {
  const stripped: number[] = [];
  const kept: number[] = [];
  for (let cu = 0; cu <= 0xffff; cu++) {
    const ch = String.fromCharCode(cu); // includes lone surrogates on purpose
    const out = sanitizeForTerminal(`a${ch}b`);
    if (out === "ab") stripped.push(cu);
    else if (out === `a${ch}b`) kept.push(cu);
    else assert.fail(`code unit U+${cu.toString(16)} produced neither a strip nor a pass-through: ${JSON.stringify(out)}`);
  }
  const expectedStripped: number[] = [];
  for (let cu = 0; cu <= 0xffff; cu++) if (isStripped(cu)) expectedStripped.push(cu);
  assert.deepEqual(stripped, expectedStripped);
  assert.equal(stripped.length + kept.length, 0x10000);
});

test("sanitizeForTerminal leaves format characters (bidi, zero-width) and astral characters alone: the accepted S5 #278 residual", () => {
  for (const ch of ["\u202e", "\u200b", "\u2066", "\ufeff", "\u00ad", "\u{1f600}"]) {
    assert.equal(sanitizeForTerminal(`x${ch}y`), `x${ch}y`);
  }
});

test("sanitizeForTerminal leaves clean text byte-identical", () => {
  const clean = [
    "",
    "plain ascii rule-id_1.2",
    'unknown key "bogus"',
    "\ufeffwith a BOM",
    "caf\u00e9 \u4e2d\u6587 \u{1f600}",
    "C:\\Users\\someone\\.thoth\\policy.json",
    "HKLM\\SOFTWARE\\Policies\\Thoth\\CentralPolicyJson",
    "tab-free; punctuation: ()[]{}<>|&$%",
  ];
  for (const text of clean) {
    assert.equal(sanitizeForTerminal(text), text);
    assert.deepEqual(Buffer.from(sanitizeForTerminal(text), "utf8"), Buffer.from(text, "utf8"));
  }
});

test("sanitizeForTerminal strips, it does not escape or replace: the surrounding visible text is kept", () => {
  assert.equal(sanitizeForTerminal("\u001b[31mred\u001b[0m"), "[31mred[0m");
  assert.equal(sanitizeForTerminal("line1\nREJECTED-LOOKALIKE: forged\r\nline3\u2028x\u2029y\u0085z"), "line1REJECTED-LOOKALIKE: forgedline3xyz");
});

test("sanitizeForTerminal is idempotent", () => {
  const samples = ["\u001b[2J\nfoo\u2028bar", "clean", "", "\u0000\u007f\u009b", "a\u202eb"];
  for (const s of samples) {
    const once = sanitizeForTerminal(s);
    assert.equal(sanitizeForTerminal(once), once);
  }
});

// Drift guard (plan criterion 4). hooks/userpromptsubmit-halt-relay.mjs keeps its own inline copy of
// the class (S5 #278). That hook is a UserPromptSubmit enforcement point and is deliberately not
// edited by this story, so the two literals are compared here instead of shared.
function extractStripLiteral(source: string, where: string): string {
  const m = /\.replace\((\/\[\\p\{Cc\}[^/]*\/[a-z]*),\s*""\)/.exec(source);
  assert.ok(m, `no strip-class .replace literal found in ${where}`);
  return m[1] as string;
}

test("sanitize class literal matches userpromptsubmit-halt-relay.mjs", () => {
  const hook = readFileSync(path.join(REPO_ROOT, "hooks", "userpromptsubmit-halt-relay.mjs"), "utf8");
  const impl = readFileSync(path.join(THIS_DIR, "sanitize.ts"), "utf8");
  const hookLiteral = extractStripLiteral(hook, "hooks/userpromptsubmit-halt-relay.mjs");
  const implLiteral = extractStripLiteral(impl, "src/policy/config/sanitize.ts");
  assert.equal(implLiteral, hookLiteral);
  assert.equal(implLiteral, "/[\\p{Cc}\\p{Zl}\\p{Zp}]/gu");
});

// Issue #312 (AC-7): the PreToolUse gate hook is a SECOND consumer, but it does not carry its own
// copy of the strip-class regex the way userpromptsubmit-halt-relay.mjs does above — it reuses this
// module's `sanitizeForTerminal` directly (an injected port into renderHookOutput; src/policy/gate/**
// and src/policy/kernel/** cannot import config/sanitize.ts themselves, see render-hook-output.ts's
// header). So there is no third literal to compare here; instead this is a structural drift guard of
// a different shape: it fails loud if a future refactor quietly drops the import (or the call site
// that passes it to renderHookOutput), which would silently reopen the Issue #312 hole with zero
// signal from the two-way literal comparison above.
//
// Issue #360 fix-now (red-team F3, 2026-09-28): the ORIGINAL AC-7 matched
// `renderHookOutput\([\s\S]*?\.sanitizeForTerminal\)` — unbounded across the whole file, satisfied
// by the literal text `.sanitizeForTerminal)` appearing ANYWHERE after a `renderHookOutput(`. An
// env-gated ternary bypass (`renderHookOutput(x, cond ? identity : sanitizeMod.sanitizeForTerminal)`)
// still contains that substring and passed, while leaking raw ESC/NUL through the real hook. AC-7
// is now an AST check (the TypeScript parser can parse plain ESM `.mjs`, per kernel-purity-check.ts's
// own precedent): it finds the real `renderHookOutput(...)` call and requires its second argument to
// UNCONDITIONALLY resolve to `*.sanitizeForTerminal` — either directly, or via exactly one local
// `const` alias assignment (a benign hoist, red-team's own drill M9, was accepted then; REVERSED
// 2026-09-29, see the round-5 block below and the AC-7b flipped test) — with no
// ternary/conditional/function-wrapper in between. This is still a cheap SOURCE-TEXT smoke check,
// not the load-bearing guard: AC-9 below (a real, spawned-hook behavioral test with env vars set and
// unset) is what actually proves the sanitizer fires unconditionally at runtime.
//
// Issue #360 fix-now round 2 (red-team round 2 findings R2/R3, 2026-09-28): two composing gaps in
// the round-1 fix, both closed here:
//   - AC-7b: `isSanitizeForTerminalAccess` matched ANY property access NAMED "sanitizeForTerminal",
//     never checking what the object actually WAS. A local object literal ported as
//     `{ sanitizeForTerminal: cond ? identity : sanitizeMod.sanitizeForTerminal }` satisfied it
//     while an env var still gated a raw-ESC/NUL leak (drill N4). Fixed by tracing the property
//     access's OBJECT back to a real `import(".../config/sanitize.ts")` call — directly, or through
//     the array-destructured `const [.., sanitizeMod] = await Promise.all([.., import(...)])` idiom
//     the real hook uses — and rejecting anything else (an object literal, an unrelated module, a
//     renamed but unrelated binding), regardless of the property's own name.
//   - AC-7c: `findRenderHookOutputSecondArg` returned on the FIRST `renderHookOutput` call found,
//     with no check that it was the ONLY one. A decoy call ahead of the real one (behind a
//     never-taken env guard) satisfied AC-7 while the real call passed a raw identity function
//     (drill N5). Fixed by finding ALL call sites and requiring exactly one.
// Issue #366 (app-security HIGH) + red-team round-3 finding R3 (2026-09-28), same root-cause class
// via two different routes, fixed together:
//   - HIGH: `isSanitizeModuleImportCall` matched the import specifier via `.endsWith("/config/
//     sanitize.ts")` — `import("../../attacker-controlled/config/sanitize.ts")` also ends with
//     that suffix and passed. Fixed by EXACT equality against the one real relative specifier this
//     hook must use (there is exactly one valid answer: `hooks/pretooluse-kernel-gate.mjs` importing
//     its sibling `src/policy/config/sanitize.ts`).
//   - HIGH (same report): a SEPARATE raw-text regex assertion (`assert.match(hook, /import\(...\)/)`)
//     used to run alongside the AST check, checking only that the literal specifier string appeared
//     SOMEWHERE in the file — dead code and comments included — structurally independent of which
//     import actually fed `renderHookOutput`'s second argument. A dead-code decoy import satisfying
//     that regex, combined with the real call site wired to an attacker-controlled module, passed
//     both checks. REMOVED: the AST check below, once it requires the exact specifier, already
//     enforces everything that regex was trying to enforce, and enforces it on the import that is
//     ACTUALLY USED, not merely present somewhere in the file.
//   - R3: `findBindingDeclaration` searched the whole file in tree order and returned the FIRST
//     same-named declaration, with no notion of lexical scope — an inner-scope shadow of
//     `sanitizeMod` resolved to the OUTER (real) binding here while the real spawned hook's runtime
//     correctly used the INNER (shadow) one. Fixed with real (though intentionally narrower-than-
//     full-ECMAScript) lexical scope resolution — SUPERSEDED in full by the compiler-symbol-backed,
//     deny-by-default shape guard below (post-merge round, 2026-09-29); kept for history: starting from the reference's own position, walk
//     outward through enclosing `Block`/`SourceFile` scopes (nearest first), searching each scope's
//     OWN direct statements before moving to its parent scope — the same order a real inner-scope
//     shadow would actually resolve at runtime. Disclosed narrower-than-full-JS-scoping residual:
//     no hoisting, no `var`, no function-parameter binding, no TDZ — sufficient for this guard's own
//     `const`/`let` idiom (the only shape the real hook and every constructed drill use).
// Issue #360, post-merge fix-now round (2026-09-29; app-security round-2 finding 2, red-team round-4
// N1) — the third consecutive round on this guard's root-cause class: a hand-rolled resolver written
// inside a test fails OPEN on every binding form it does not model (function parameter, object
// binding pattern, catch/for-of/var shadow, let reassignment, Promise.all spread, module-object
// assignment, bracket/destructured call). Fixed at the root, not by teaching the resolver one more
// shape: the guard now DENIES BY DEFAULT on SHAPE, and the one question that needs real scoping
// ("which declaration does this identifier resolve to?") is answered by the compiler's own symbol
// table (`ts.Program` + `checker.getSymbolAtLocation`), not by a scope walk written here. The shape
// the real hook must have, and nothing else is accepted:
//   - exactly one `renderHookOutput` name anywhere in the file (identifier or string literal), and it
//     is the property name of the one `render.renderHookOutput(...)` call — so no decoy, bracket,
//     computed-key or destructured call can coexist with (or replace) the real one;
//   - that call's second argument is literally `sanitizeMod.sanitizeForTerminal` — no alias, no
//     ternary, no wrapper, no other object (the round-1 "alias hoist is fine" ruling is reversed:
//     app-security round-2 finding 2, Manager ruling 2026-09-29);
//   - `sanitizeMod` and `render` each appear exactly twice in the file (the one declaration, the one
//     use), so no shadow, reassignment, alias, spread or module-object assignment can exist;
//   - `sanitizeMod` resolves, by the type checker, to a single `const` array-destructuring element
//     of `await Promise.all([...])` (no default, no rest), whose array literal has no spread or hole,
//     and whose element at the same index is exactly `import("../src/policy/config/sanitize.ts")`;
//   - `Promise` in that expression is the unresolved global, not a local shadow.
// Still a source-text smoke check, not the load-bearing guard: AC-9 (the real spawned hook, a finite
// env matrix) proves the sanitizer at runtime, and the no-`process.env` assertion below closes the
// open set that finite matrix cannot.
const SANITIZE_MODULE_SPECIFIER = "../src/policy/config/sanitize.ts";

const CHECKERS = new WeakMap<ts.SourceFile, ts.TypeChecker>();

/** Parses `text` as a one-file `ts.Program` (in-memory host, no lib, no module resolution — symbol
 * binding needs none of them) and registers its type checker for `diagnoseSanitizeWiring`. The
 * returned SourceFile is the program's own, so `checker.getSymbolAtLocation` works on its nodes. */
function parseWithChecker(fileName: string, text: string): ts.SourceFile {
  const virtualName = `/${fileName}`;
  const host: ts.CompilerHost = {
    getSourceFile: (name, languageVersion) => (name === virtualName ? ts.createSourceFile(name, text, languageVersion, true, ts.ScriptKind.JS) : undefined),
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (name) => name === virtualName,
    readFile: (name) => (name === virtualName ? text : undefined),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram({
    rootNames: [virtualName],
    options: { allowJs: true, noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    host,
  });
  const sourceFile = program.getSourceFile(virtualName);
  assert.ok(sourceFile, `ts.Program produced no source file for ${fileName}`);
  CHECKERS.set(sourceFile, program.getTypeChecker());
  return sourceFile;
}

/** True when `expr` is EXACTLY `import("../src/policy/config/sanitize.ts")` — the one real
 * relative specifier `hooks/pretooluse-kernel-gate.mjs` must use, not merely a path ending in the
 * same suffix (Issue #366). */
function isImportCallOf(expr: ts.Expression | undefined, specifier: string): boolean {
  if (expr === undefined || !ts.isCallExpression(expr) || expr.expression.kind !== ts.SyntaxKind.ImportKeyword || expr.arguments.length !== 1) return false;
  const arg0 = expr.arguments[0];
  return arg0 !== undefined && ts.isStringLiteralLike(arg0) && arg0.text === specifier;
}

/** True when `expr` is exactly `<name>()` — a plain call of a bare identifier, no arguments. */
function isPlainCallOf(expr: ts.Expression | undefined, name: string): boolean {
  return expr !== undefined && ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === name && expr.arguments.length === 0;
}

/** The exact destructuring pattern and `Promise.all` array the hook must have, index by index
 * (Issue #369). `specifier: undefined` marks the stdin read. */
const PROMISE_ALL_SHAPE: ReadonlyArray<{ name: string; specifier: string | undefined }> = [
  { name: "raw", specifier: undefined },
  { name: "gate", specifier: "../src/policy/gate/decide-tool-call.ts" },
  { name: "render", specifier: "../src/policy/gate/render-hook-output.ts" },
  { name: "loader", specifier: "../src/policy/config/loader.ts" },
  { name: "central", specifier: "../src/policy/config/central-source.ts" },
  { name: "catalog", specifier: "../src/policy/tools/classification-catalog.ts" },
  { name: "sanitizeMod", specifier: SANITIZE_MODULE_SPECIFIER },
];

function countNodes(root: ts.Node, predicate: (node: ts.Node) => boolean): number {
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (predicate(node)) n++;
    ts.forEachChild(node, visit);
  };
  visit(root);
  return n;
}

const isNamed =
  (name: string) =>
  (node: ts.Node): boolean =>
    ts.isIdentifier(node) && node.text === name;
const isNamedOrStringNamed =
  (name: string) =>
  (node: ts.Node): boolean =>
    (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === name;

/** Why the sanitize wiring is NOT the one accepted shape, or `undefined` when it is. `secondArg` is
 * the second argument of the ONE `renderHookOutput(...)` call. Deny by default: see the comment
 * block above for the whole accepted shape. */
function diagnoseSanitizeWiring(secondArg: ts.Expression | undefined): string | undefined {
  if (secondArg === undefined) return "the renderHookOutput call has no second argument";
  const sourceFile = secondArg.getSourceFile();
  const checker = CHECKERS.get(sourceFile);
  if (!checker) return "internal: the source file was not parsed through parseWithChecker";

  if (!ts.isPropertyAccessExpression(secondArg) || secondArg.name.text !== "sanitizeForTerminal" || !ts.isIdentifier(secondArg.expression) || secondArg.expression.text !== "sanitizeMod") {
    return "the second argument must be literally `sanitizeMod.sanitizeForTerminal` (no alias, ternary, wrapper, other object or port literal)";
  }
  const call = secondArg.parent;
  if (!ts.isCallExpression(call) || call.arguments[1] !== secondArg || call.arguments.some((a) => ts.isSpreadElement(a))) {
    return "the sanitizer must be the plain second argument of the call (no spread arguments)";
  }
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "renderHookOutput" || !ts.isIdentifier(call.expression.expression) || call.expression.expression.text !== "render") {
    return "the call must be literally `render.renderHookOutput(...)`";
  }
  const renderHookOutputNames = countNodes(sourceFile, isNamedOrStringNamed("renderHookOutput"));
  if (renderHookOutputNames !== 1) {
    return `exactly one \`renderHookOutput\` name may exist in the file (found ${renderHookOutputNames}): a decoy call, bracket access, or destructured alias defeats the one-call-site check`;
  }
  const renderUses = countNodes(sourceFile, isNamed("render"));
  if (renderUses !== 2) return `\`render\` must appear exactly twice (its one declaration and the one call), found ${renderUses}: an alias, shadow or computed-key access is possible`;
  const sanitizeModUses = countNodes(sourceFile, isNamed("sanitizeMod"));
  if (sanitizeModUses !== 2) {
    return `\`sanitizeMod\` must appear exactly twice (its one declaration and the one use), found ${sanitizeModUses}: a shadow (parameter, pattern, catch, for-of, var), a reassignment, an alias or a module-object assignment is possible`;
  }

  // The one question that needs real scoping goes to the compiler's symbol table.
  const symbol = checker.getSymbolAtLocation(secondArg.expression);
  const declarations = symbol?.declarations ?? [];
  const decl = declarations[0];
  if (declarations.length !== 1 || decl === undefined || !ts.isBindingElement(decl) || !ts.isArrayBindingPattern(decl.parent)) {
    return "`sanitizeMod` must resolve to exactly one array-destructuring element";
  }
  if (decl.initializer !== undefined || decl.dotDotDotToken !== undefined || !ts.isIdentifier(decl.name) || decl.name.text !== "sanitizeMod") {
    return "`sanitizeMod` must be a plain array-destructuring element (no default value, no rest)";
  }
  const pattern = decl.parent;
  const variable = pattern.parent;
  if (!ts.isVariableDeclaration(variable) || !ts.isVariableDeclarationList(variable.parent) || (variable.parent.flags & ts.NodeFlags.Const) === 0) {
    return "`sanitizeMod` must be declared by a `const` destructuring (a let/var binding can be reassigned)";
  }
  const init = variable.initializer;
  if (init === undefined || !ts.isAwaitExpression(init) || !ts.isCallExpression(init.expression)) return "`sanitizeMod` must come from `await Promise.all([...])`";
  const promiseAll = init.expression;
  if (!ts.isPropertyAccessExpression(promiseAll.expression) || !ts.isIdentifier(promiseAll.expression.expression) || promiseAll.expression.expression.text !== "Promise" || promiseAll.expression.name.text !== "all" || promiseAll.arguments.length !== 1) {
    return "`sanitizeMod` must come from `await Promise.all([...])` with exactly one argument";
  }
  if (checker.getSymbolAtLocation(promiseAll.expression.expression) !== undefined) return "`Promise` must be the unresolved global, not a local declaration";
  const list = promiseAll.arguments[0];
  if (list === undefined || !ts.isArrayLiteralExpression(list) || list.elements.some((e) => ts.isSpreadElement(e) || ts.isOmittedExpression(e))) {
    return "the `Promise.all` argument must be a plain array literal (no spread, no holes): a spread shifts the runtime index against the source index";
  }
  // Issue #369: EVERY element is pinned, index by index — a retargeted `render` (or gate, loader,
  // central, catalog) import is as dangerous as a retargeted sanitizer, since the module can ignore
  // the sanitize port. The pattern's names are pinned too, so a name cannot be moved to another index.
  if (pattern.elements.length !== PROMISE_ALL_SHAPE.length || list.elements.length !== PROMISE_ALL_SHAPE.length) {
    return `the destructuring pattern and the Promise.all array must each have exactly ${PROMISE_ALL_SHAPE.length} elements (found ${pattern.elements.length} and ${list.elements.length})`;
  }
  for (const [i, expected] of PROMISE_ALL_SHAPE.entries()) {
    const element = pattern.elements[i];
    if (element === undefined || !ts.isBindingElement(element) || !ts.isIdentifier(element.name) || element.name.text !== expected.name) {
      return `destructured binding at index ${i} must be \`${expected.name}\``;
    }
    const value = list.elements[i];
    const ok = expected.specifier === undefined ? isPlainCallOf(value, "readStdin") : isImportCallOf(value, expected.specifier);
    if (!ok) {
      return `the Promise.all element for \`${expected.name}\` (index ${i}) must be exactly ${expected.specifier === undefined ? "readStdin()" : `import(${JSON.stringify(expected.specifier)})`} — no lookalike path, no other module`;
    }
  }
  return undefined;
}

/** True when the wiring is the accepted shape. `expr` is the second argument of the one call. */
function resolvesToSanitizeForTerminal(expr: ts.Expression | undefined): boolean {
  return diagnoseSanitizeWiring(expr) === undefined;
}

/** ALL `renderHookOutput(...)` call sites found anywhere in `sourceFile`, in source order — never
 * just the first (Issue #360 finding R3/AC-7c: the original implementation returned on the first
 * match, so a decoy call ahead of the real one went unnoticed). */
function findAllRenderHookOutputCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "renderHookOutput") {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

test("AC-7/AC-7c: hooks/pretooluse-kernel-gate.mjs contains exactly ONE renderHookOutput call site, and its second argument unconditionally resolves to the real sanitizeForTerminal import (no conditional/ternary bypass, no port-object masquerade, no decoy call, no path-suffix lookalike, no alias, no shadow — the second argument is literally sanitizeMod.sanitizeForTerminal)", () => {
  const hook = readFileSync(path.join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs"), "utf8");
  // Issue #366 (app-security HIGH): the standalone raw-text regex that used to run here (checking
  // only that the literal specifier string appeared SOMEWHERE in the file) is REMOVED — it was
  // structurally independent of which import actually fed renderHookOutput's second argument, so a
  // dead-code decoy import satisfying it, combined with the real call site wired to an
  // attacker-controlled module, passed both checks. The AST resolution below, requiring the EXACT
  // specifier on the import that is ACTUALLY USED, is now the only check, and is strictly stronger.
  const sourceFile = parseWithChecker("pretooluse-kernel-gate.mjs", hook);
  const calls = findAllRenderHookOutputCalls(sourceFile);
  assert.equal(calls.length, 1, `expected exactly one renderHookOutput(...) call site, found ${calls.length}`);
  const call = calls[0];
  assert.ok(call, "expected exactly one renderHookOutput(...) call site");
  const secondArg = call.arguments[1];
  assert.ok(secondArg, "the one renderHookOutput(...) call has no second argument");
  assert.ok(
    resolvesToSanitizeForTerminal(secondArg),
    `hooks/pretooluse-kernel-gate.mjs must pass literally sanitizeMod.sanitizeForTerminal, the real import, as renderHookOutput's second argument. Rejected because: ${diagnoseSanitizeWiring(secondArg)}. Got: ${hook.slice(secondArg.getStart(sourceFile), secondArg.getEnd())}`,
  );
});

// Issue #360 / red-team round-3 R3 + round-4 N1, the half AC-9's finite env matrix cannot cover, and
// Issue #371 (app-security round 4): the hook must not reach the environment, the terminal streams or
// the sanitizer's own machinery through anything but what it actually uses. WHAT THIS PROVES, exactly,
// about hooks/pretooluse-kernel-gate.mjs (a source-text check, never a runtime one):
//   1. Free globals, deny by default (checker-backed, #371): every identifier reference that resolves to
//      NO declaration in the hook (an ambient/lib global) is in ALLOWED_FREE_GLOBALS, a set pinned by
//      test to exactly the free globals the real hook uses. Reflect, Object, String, Symbol, RegExp,
//      Function, eval, globalThis, console and any other ambient name are therefore refused, however
//      they are spelled or reached, because the check is on the resolved symbol, not on a spelling.
//   2. `process` is used only as process.stdin / stdout / stderr / exit.
//   3. Member writes are deny-by-default (#372): no assignment (=, compound, ++/--, delete,
//      destructuring or for-in/of target) to ANY member expression (literal, local, global or call-result
//      root) unless its text is on ALLOWED_MEMBER_WRITES, a set pinned by test to exactly the member
//      writes the real hook contains (none). A write to a free global itself is refused too.
//   4. The names `__proto__`, `prototype`, `constructor`, `__defineGetter__`, `__defineSetter__`,
//      `__lookupGetter__`, `__lookupSetter__` appear nowhere in the hook: not as a property access, an
//      object-literal or destructuring key, a shorthand, a method name, or a string/template literal (#372).
//      No computed property key that is not a plain string/numeric literal; no element access with a
//      non-numeric key.
//   5. An allowed global (Error, JSON, Promise) appears only as the object of a member access or the
//      callee of a call/new, never as a bare value, so it cannot be aliased, passed, returned,
//      destructured from, spread or extended (#372). `undefined` is exempt: it is an immutable constant.
//   6. Module specifiers (static import, export ... from, runtime import()) are an exact allow-list.
// First layer, kept from #370: the named checks below (Function/eval/constructor/require...).
// NOT proven: runtime behaviour, anything outside this one file (the imported modules are pinned by
// specifier only), and a global that the hook reaches only through an imported module's exports.
const ALLOWED_PROCESS_MEMBERS = new Set(["stdin", "stdout", "stderr", "exit"]);
// Issue #370 adds `Function`, `eval` and `constructor`: each reaches `process` (and so the
// environment) without naming it, defeating any list of process members or import specifiers.
const FORBIDDEN_IDENTIFIERS = new Set(["globalThis", "global", "require", "createRequire", "Function", "eval"]);
/** The free (undeclared, ambient) globals the real hook references, derived by a script over the real
 * hook and pinned here; a test proves the set is exactly what the hook uses, so it cannot silently grow. */
const ALLOWED_FREE_GLOBALS: ReadonlySet<string> = new Set(["Error", "JSON", "Promise", "process", "undefined"]);
/** Property NAMES banned in every position (#372): the vehicles for reaching Function or patching a
 * built-in prototype. Banning the names, not chasing each write root, is what stops `"".__proto__.x = ...`. */
const BANNED_NAMES: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);
/** The member writes (`obj.key = ...`, `obj.n++`, `delete obj.k`, ...) the real hook contains, by
 * normalised source text, derived by script and pinned by test (AC-3h pin). The real hook has none,
 * so any member write fails; adding one is a reviewed change to this set, never inherited. */
const ALLOWED_MEMBER_WRITES: ReadonlySet<string> = new Set<string>();
// Exact ALLOW-LIST of module specifiers (Issue #370 residual): the hook's own two node built-ins and
// its 6 pinned Promise.all imports. Anything else (node:vm, node:child_process, node:worker_threads,
// node:fs, a project module outside the six) is refused, whether static, re-exported or runtime.
const ALLOWED_SPECIFIERS: ReadonlySet<string> = new Set(["node:path", "node:url", "../src/policy/config/path-trust-check.ts", ...PROMISE_ALL_SHAPE.flatMap((e) => (e.specifier === undefined ? [] : [e.specifier]))]);

/** True when `id` is in a position that REFERENCES a value binding (as opposed to naming a property,
 * a key, a label or a meta-property, which never resolve through scope). */
function isValueReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p) && p.right === id) return false;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isMetaProperty(p)) return false;
  if ((ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.name === id) return false;
  if ((ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) && p.label === id) return false;
  return true;
}

/** True when the value `id` references has NO declaration in this file (an ambient/lib global,
 * including `undefined`, whose checker symbol carries no declarations). */
function isFreeGlobal(id: ts.Identifier, checker: ts.TypeChecker, sourceFile: ts.SourceFile): boolean {
  const symbol = ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id ? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id);
  // In a JS file the binder turns `process.x = 1` or `Obj.a.b = 1` into an "expando" declaration whose
  // node is the root Identifier itself, which would make the ambient global look declared in-file. Only
  // a real binding form counts as a declaration (a whitelist, so an unrecognised kind is not trusted).
  const isBindingDeclaration = (d: ts.Declaration): boolean =>
    ts.isVariableDeclaration(d) ||
    ts.isParameter(d) ||
    ts.isBindingElement(d) ||
    ts.isFunctionDeclaration(d) ||
    ts.isFunctionExpression(d) ||
    ts.isClassDeclaration(d) ||
    ts.isClassExpression(d) ||
    ts.isImportClause(d) ||
    ts.isImportSpecifier(d) ||
    ts.isNamespaceImport(d);
  return symbol === undefined || !(symbol.declarations ?? []).some((d) => d.getSourceFile() === sourceFile && isBindingDeclaration(d));
}

/** Every value reference in `sourceFile` that resolves to a free global, in source order. */
function freeGlobalReferences(sourceFile: ts.SourceFile): ts.Identifier[] {
  const checker = CHECKERS.get(sourceFile);
  assert.ok(checker, "source file was not parsed through parseWithChecker");
  const out: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isValueReference(node) && isFreeGlobal(node, checker, sourceFile)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/** `expr` with any wrapping parentheses removed. */
function unparen(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

/** The expressions an assignment-like node writes to (destructuring patterns flattened). */
function assignmentTargets(node: ts.Node): ts.Expression[] {
  const out: ts.Expression[] = [];
  const collect = (expr: ts.Expression): void => {
    const e = unparen(expr);
    if (ts.isArrayLiteralExpression(e)) {
      for (const el of e.elements) collect(ts.isSpreadElement(el) ? el.expression : el);
    } else if (ts.isObjectLiteralExpression(e)) {
      for (const prop of e.properties) {
        if (ts.isPropertyAssignment(prop)) collect(prop.initializer);
        else if (ts.isShorthandPropertyAssignment(prop)) out.push(prop.name);
        else if (ts.isSpreadAssignment(prop)) collect(prop.expression);
      }
    } else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      collect(e.left);
    } else {
      out.push(e);
    }
  };
  if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) collect(node.left);
  else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) collect(node.operand);
  else if (ts.isDeleteExpression(node)) collect(node.expression);
  else if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) collect(node.initializer);
  return out;
}

/** The identifier at the root of a member chain (`a.b[c].d` -> `a`), or undefined when the root is not an identifier. */
function memberChainRoot(expr: ts.Expression): ts.Identifier | undefined {
  let e: ts.Expression = unparen(expr);
  while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isNonNullExpression(e)) e = unparen(e.expression);
  return ts.isIdentifier(e) ? e : undefined;
}

const normaliseText = (node: ts.Node, sourceFile: ts.SourceFile): string => node.getText(sourceFile).replace(/\s+/g, "");

/** Normalised text of every member-expression write target in `sourceFile` (any root), in source order. */
function memberWriteTargets(sourceFile: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    for (const target of assignmentTargets(node)) {
      const t = unparen(target);
      if (ts.isPropertyAccessExpression(t) || ts.isElementAccessExpression(t)) out.push(normaliseText(t, sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/** Every way this source could reach the environment, or patch a global, one line each; empty when it cannot. */
function findEnvironmentAccess(sourceFile: ts.SourceFile): string[] {
  const found: string[] = [];
  const checker = CHECKERS.get(sourceFile);
  if (!checker) return ["internal: the source file was not parsed through parseWithChecker"];
  const where = (node: ts.Node): string => `line ${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isPropertyName && node.text === "process") {
        const member = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent.name.text : undefined;
        if (member === undefined || !ALLOWED_PROCESS_MEMBERS.has(member)) found.push(`${where(node)}: \`process\` used other than as process.stdin/stdout/stderr/exit (${member === undefined ? "bare reference, bracket access or alias" : `process.${member}`})`);
      }
      if (!isPropertyName && FORBIDDEN_IDENTIFIERS.has(node.text)) found.push(`${where(node)}: forbidden identifier \`${node.text}\``);
      // #372 AC-3g: the dangerous NAMES in ANY position (property access, object-literal or destructuring
      // key, shorthand, method name, plain identifier), not only as string literals.
      if (BANNED_NAMES.has(node.text)) found.push(`${where(node)}: banned name \`${node.text}\` (reaches Function or patches a built-in prototype)`);
      // #371 layer 1: deny by default on free globals, by resolved symbol rather than by spelling.
      if (isValueReference(node) && isFreeGlobal(node, checker, sourceFile) && !ALLOWED_FREE_GLOBALS.has(node.text)) {
        found.push(`${where(node)}: free global \`${node.text}\` is not on the allow-set of globals the hook uses (${[...ALLOWED_FREE_GLOBALS].join(", ")})`);
      }
      // #372 AC-3i: an allowed global is only ever the object of a member access or the callee of a
      // call/new, never a bare value (which could be aliased, passed, returned, destructured or spread).
      if (isValueReference(node) && isFreeGlobal(node, checker, sourceFile) && ALLOWED_FREE_GLOBALS.has(node.text) && node.text !== "undefined" && node.text !== "process") {
        const p = node.parent;
        const asMemberObject = ts.isPropertyAccessExpression(p) && p.expression === node;
        const asCallee = (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === node;
        if (!asMemberObject && !asCallee) found.push(`${where(node)}: allowed global \`${node.text}\` used as a bare value (aliasing); only \`${node.text}.x\` or \`${node.text}(...)\`/\`new ${node.text}(...)\` is allowed`);
      }
    }
    // #371: a string or template literal that IS a dangerous key name, wherever it appears (a call
    // argument, a quoted destructuring key, a template key).
    if (ts.isStringLiteralLike(node) && BANNED_NAMES.has(node.text)) {
      found.push(`${where(node)}: string "${node.text}" (a key that reaches Function or the prototype chain)`);
    }
    // #371: a computed property key must be a plain string or numeric literal; anything else cannot be
    // proven not to spell "constructor".
    if (ts.isComputedPropertyName(node) && !ts.isStringLiteralLike(node.expression) && !ts.isNumericLiteral(node.expression)) {
      found.push(`${where(node)}: computed property key that is not a plain literal (cannot be proven not to spell "constructor")`);
    }
    // #371: no write (=, compound, ++/--, delete, destructuring, for-in/of target) to a member chain
    // rooted at a global, and no write to a global itself.
    for (const target of assignmentTargets(node)) {
      const root = memberChainRoot(target);
      if (root !== undefined && isFreeGlobal(root, checker, sourceFile)) found.push(`${where(node)}: write to \`${root.text}\` or a member of it (a global cannot be patched)`);
      // #372 AC-3h: ANY member write (any root) must be on the pinned allow-list.
      const t = unparen(target);
      if ((ts.isPropertyAccessExpression(t) || ts.isElementAccessExpression(t)) && !ALLOWED_MEMBER_WRITES.has(normaliseText(t, sourceFile))) {
        found.push(`${where(node)}: member write \`${normaliseText(t, sourceFile)}\` is not on the pinned allow-list (the real hook has none)`);
      }
    }
    // Any element access other than a plain numeric literal index: `x["constructor"]` and
    // `x["con" + "structor"]` both spell a property name the identifier scan cannot see.
    if (ts.isElementAccessExpression(node) && !ts.isNumericLiteral(node.argumentExpression)) {
      found.push(`${where(node)}: element access with a non-numeric key (can spell "constructor" or "env")`);
    }
    // A dynamic import() must name its module with a plain string literal, never a computed value.
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (specifier === undefined || !ts.isStringLiteralLike(specifier)) found.push(`${where(node)}: import() specifier is not a plain string literal`);
      else if (!ALLOWED_SPECIFIERS.has(specifier.text)) found.push(`${where(node)}: import("${specifier.text}") is not on the exact module allow-list`);
    }
    // Static `import ... from`, `export ... from` and `import x = require(...)`. A JSDoc type-only
    // `import("...")` lives in a comment (an ImportTypeNode), is not code, and is not visited here.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined && (!ts.isStringLiteralLike(specifier) || !ALLOWED_SPECIFIERS.has(specifier.text))) {
        found.push(`${where(node)}: module specifier ${ts.isStringLiteralLike(specifier) ? `"${specifier.text}"` : "(computed)"} is not on the exact module allow-list`);
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      found.push(`${where(node)}: import = require() is not on the exact module allow-list`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

test("AC-3h pin (#372): the allow-list of member writes is EXACTLY the member writes the real hook contains — it cannot silently grow", () => {
  const hook = readFileSync(path.join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs"), "utf8");
  assert.deepEqual([...new Set(memberWriteTargets(parseWithChecker("pretooluse-kernel-gate.mjs", hook)))].sort(), [...ALLOWED_MEMBER_WRITES].sort());
});

test("AC-3f (#371): the allow-set of free globals is EXACTLY the set of free globals the real hook uses — it cannot silently grow (a new global is added here in a reviewed change, never inherited)", () => {
  const hook = readFileSync(path.join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs"), "utf8");
  const used = [...new Set(freeGlobalReferences(parseWithChecker("pretooluse-kernel-gate.mjs", hook)).map((id) => id.text))].sort();
  assert.deepEqual(used, [...ALLOWED_FREE_GLOBALS].sort());
});

test("AC-3: hooks/pretooluse-kernel-gate.mjs contains no process.env access and no route to the environment — the open set AC-9's finite env matrix cannot cover", () => {
  const hook = readFileSync(path.join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs"), "utf8");
  assert.deepEqual(findEnvironmentAccess(parseWithChecker("pretooluse-kernel-gate.mjs", hook)), []);
});

const ENV_ACCESS_SHAPES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["process.env member read", "const x = process.env.THOTH_X;"],
  ["process bracket access", 'const x = process["env"].THOTH_X;'],
  ["process aliased to a local", "const p = process;\nconst x = p.env.THOTH_X;"],
  ["env destructured from process", "const { env } = process;"],
  ["globalThis route", "const x = globalThis.process.env.THOTH_X;"],
  ["dynamic import of node:process", 'const p = await import("node:process");'],
  ["static import of node:process", 'import p from "node:process";'],
  ["createRequire route", 'import { createRequire } from "node:module";\nconst r = createRequire(import.meta.url);'],
];

for (const [name, source] of ENV_ACCESS_SHAPES) {
  test(`AC-3: the environment-access scan flags this shape — ${name}`, () => {
    assert.ok(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)).length > 0, `expected the scan to flag: ${name}`);
  });
}

test("AC-3 positive control: the stream/exit members the hook really uses are not flagged", () => {
  const source = 'process.stdin.setEncoding("utf8");\nprocess.stdout.on("error", () => {});\nprocess.stderr.write("x");\nprocess.exit(2);';
  assert.deepEqual(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)), []);
});

// Issue #360 fix-now round 2 (red-team round 2 finding R2, drill N4, regression pin): an env-gated
// object literal keyed "sanitizeForTerminal" — but not sourced from the real import — must be
// rejected even though the property NAME matches exactly what AC-7 looks for.
test("AC-7b regression: an env-gated object-literal port keyed \"sanitizeForTerminal\" is rejected, even though the property name matches — the object must resolve back to the real config/sanitize.ts import", () => {
  const source = [
    'const [raw, gate, render, loader, central, catalog, sanitizeMod] = await Promise.all([',
    "  readStdin(),",
    '  import("../src/policy/gate/decide-tool-call.ts"),',
    '  import("../src/policy/gate/render-hook-output.ts"),',
    '  import("../src/policy/config/loader.ts"),',
    '  import("../src/policy/config/central-source.ts"),',
    '  import("../src/policy/tools/classification-catalog.ts"),',
    '  import("../src/policy/config/sanitize.ts"),',
    "]);",
    "const sanitizePort = { sanitizeForTerminal: process.env.THOTH_PLAIN_REASON ? ((s) => s) : sanitizeMod.sanitizeForTerminal };",
    "const output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizePort.sanitizeForTerminal);",
  ].join("\n");
  const sourceFile = parseWithChecker("synthetic.mjs", source);
  const calls = findAllRenderHookOutputCalls(sourceFile);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call, "expected exactly one renderHookOutput(...) call site");
  assert.equal(
    resolvesToSanitizeForTerminal(call.arguments[1]),
    false,
    "an object-literal port must NOT resolve, even with a property name that matches sanitizeForTerminal exactly",
  );
});

// Round-1 M9 alias hoist (`const sanitizePort = sanitizeMod.sanitizeForTerminal;`). FLIPPED to
// "rejected" (post-merge round, app-security round-2 finding 2, Manager ruling 2026-09-29): the
// second argument must be literally `sanitizeMod.sanitizeForTerminal`, no alias. This STRENGTHENS the
// guard, so it is not a weakening under SE ADR-0010; the round-1 false-positive worry is superseded
// by the deny-by-default shape rule.
test("AC-7b flipped: a local-const alias of the real sanitizeForTerminal property access is now REJECTED (the second argument must be literally sanitizeMod.sanitizeForTerminal, no alias)", () => {
  const source = [
    'const [raw, gate, render, loader, central, catalog, sanitizeMod] = await Promise.all([',
    "  readStdin(),",
    '  import("../src/policy/gate/decide-tool-call.ts"),',
    '  import("../src/policy/gate/render-hook-output.ts"),',
    '  import("../src/policy/config/loader.ts"),',
    '  import("../src/policy/config/central-source.ts"),',
    '  import("../src/policy/tools/classification-catalog.ts"),',
    '  import("../src/policy/config/sanitize.ts"),',
    "]);",
    "const sanitizePort = sanitizeMod.sanitizeForTerminal;",
    "const output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizePort);",
  ].join("\n");
  const sourceFile = parseWithChecker("synthetic.mjs", source);
  const calls = findAllRenderHookOutputCalls(sourceFile);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call, "expected exactly one renderHookOutput(...) call site");
  assert.equal(resolvesToSanitizeForTerminal(call.arguments[1]), false, "an alias of the real property access must NOT resolve — the argument must be literally sanitizeMod.sanitizeForTerminal");
});

// Issue #360 fix-now round 2 (red-team round 2 finding R3, drill N5, regression pin): a decoy
// renderHookOutput call ahead of the real one must be VISIBLE to the scan, not silently ignored —
// the original bug returned on the first match found, so this fixture's second (real) call, which
// passes a raw identity function, was never inspected.
test("AC-7c regression: findAllRenderHookOutputCalls finds every renderHookOutput call site, not just the first — a decoy call ahead of the real one is visible", () => {
  const source = [
    "if (process.env.THOTH_NEVER_SET) render.renderHookOutput(null, sanitizeMod.sanitizeForTerminal);",
    "const output = render.renderHookOutput(gate.decideToolCall(input, ports), (s) => s);",
  ].join("\n");
  const sourceFile = parseWithChecker("synthetic.mjs", source);
  const calls = findAllRenderHookOutputCalls(sourceFile);
  assert.equal(calls.length, 2, "both the decoy and the real call site must be found — the original bug stopped at the first match");
});

// Issue #366 (app-security HIGH, demonstrated): a real import whose specifier ENDS WITH
// "/config/sanitize.ts" but is not the one real relative path must be rejected — the original
// endsWith-based check accepted any module living at that suffix, from any directory depth.
test("Issue #366 regression: an attacker-controlled module whose path merely ENDS with /config/sanitize.ts is rejected — only the exact real relative specifier resolves", () => {
  const source = [
    'const [raw, gate, render, loader, central, catalog, sanitizeMod] = await Promise.all([',
    "  readStdin(),",
    '  import("../src/policy/gate/decide-tool-call.ts"),',
    '  import("../src/policy/gate/render-hook-output.ts"),',
    '  import("../src/policy/config/loader.ts"),',
    '  import("../src/policy/config/central-source.ts"),',
    '  import("../src/policy/tools/classification-catalog.ts"),',
    '  import("../../attacker-controlled/config/sanitize.ts"),',
    "]);",
    "const output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);",
  ].join("\n");
  const sourceFile = parseWithChecker("synthetic.mjs", source);
  const calls = findAllRenderHookOutputCalls(sourceFile);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call, "expected exactly one renderHookOutput(...) call site");
  assert.equal(
    resolvesToSanitizeForTerminal(call.arguments[1]),
    false,
    "a module path ending in the same suffix but not equal to the real relative specifier must NOT resolve",
  );
});

// Red-team round-3 finding R3 (drill N9, demonstrated): a nested-block, env-gated shadow of the
// same binding name must be rejected — the real spawned hook's runtime uses the INNER (shadow)
// binding, so a checker that resolves to the OUTER (real) one by flat tree-order search would pass
// while raw ESC/NUL leak through the shadow at runtime.
test("R3 regression (drill N9): an inner-scope shadow of sanitizeMod is rejected — resolution must use the reference's OWN scope, not the first same-named declaration in the whole file", () => {
  const source = [
    'const [raw, gate, render, loader, central, catalog, sanitizeMod] = await Promise.all([',
    "  readStdin(),",
    '  import("../src/policy/gate/decide-tool-call.ts"),',
    '  import("../src/policy/gate/render-hook-output.ts"),',
    '  import("../src/policy/config/loader.ts"),',
    '  import("../src/policy/config/central-source.ts"),',
    '  import("../src/policy/tools/classification-catalog.ts"),',
    '  import("../src/policy/config/sanitize.ts"),',
    "]);",
    "const realS = sanitizeMod.sanitizeForTerminal;",
    "let output;",
    "{",
    "  const sanitizeMod = { sanitizeForTerminal: process.env.THOTH_PLAIN_REASON ? ((s) => s) : realS };",
    "  output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);",
    "}",
  ].join("\n");
  const sourceFile = parseWithChecker("synthetic.mjs", source);
  const calls = findAllRenderHookOutputCalls(sourceFile);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call, "expected exactly one renderHookOutput(...) call site");
  assert.equal(
    resolvesToSanitizeForTerminal(call.arguments[1]),
    false,
    "an inner-scope shadow (an object literal, not the real import) must NOT resolve, even though an outer scope has a same-named real binding",
  );
});

// Non-regression: the REAL hook's own shape (destructure and call site in the SAME scope, no
// shadow anywhere) must still resolve — the scope-walk fix must not turn into a false positive on
// the one real, legitimate shape it exists to keep passing.
test("R3 non-regression: a same-scope (non-shadowed) binding still resolves correctly under the new scope-aware search", () => {
  const source = [
    'const [raw, gate, render, loader, central, catalog, sanitizeMod] = await Promise.all([',
    "  readStdin(),",
    '  import("../src/policy/gate/decide-tool-call.ts"),',
    '  import("../src/policy/gate/render-hook-output.ts"),',
    '  import("../src/policy/config/loader.ts"),',
    '  import("../src/policy/config/central-source.ts"),',
    '  import("../src/policy/tools/classification-catalog.ts"),',
    '  import("../src/policy/config/sanitize.ts"),',
    "]);",
    "{",
    "  const output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);",
    "}",
  ].join("\n");
  const sourceFile = parseWithChecker("synthetic.mjs", source);
  const calls = findAllRenderHookOutputCalls(sourceFile);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call, "expected exactly one renderHookOutput(...) call site");
  assert.equal(
    resolvesToSanitizeForTerminal(call.arguments[1]),
    true,
    "resolving sanitizeMod from a NESTED block, with no shadow, must still find the outer real import binding",
  );
});

// Post-merge fix-now (2026-09-29): Issue #360, app-security round-2 finding 2 + red-team round-4 N1.
// Third consecutive round on the same root-cause class (a hand-rolled resolver that fails OPEN on any
// shape it does not model), so the fix is architectural: deny by default on SHAPE, backed by the
// compiler's own symbol table, not one more shape patched into a resolver. Every table entry below
// is one demonstrated bypass; each runs the SAME whole-source entry point as the real-hook test.
const IMPORTS_BEFORE_SANITIZE = [
  "  readStdin(),",
  '  import("../src/policy/gate/decide-tool-call.ts"),',
  '  import("../src/policy/gate/render-hook-output.ts"),',
  '  import("../src/policy/config/loader.ts"),',
  '  import("../src/policy/config/central-source.ts"),',
  '  import("../src/policy/tools/classification-catalog.ts"),',
];
const SANITIZE_IMPORT = '  import("../src/policy/config/sanitize.ts"),';
const REAL_DESTRUCTURE = ["const [raw, gate, render, loader, central, catalog, sanitizeMod] = await Promise.all([", ...IMPORTS_BEFORE_SANITIZE, SANITIZE_IMPORT, "]);"];
const REAL_CALL = "const output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);";
const IDENTITY_PORT = "{ sanitizeForTerminal: (s) => s }";

/** The whole-source entry point every case below runs: does the guard ACCEPT this source? */
function guardAccepts(source: string): boolean {
  const sourceFile = parseWithChecker("synthetic.mjs", source);
  const calls = findAllRenderHookOutputCalls(sourceFile);
  if (calls.length !== 1) return false;
  const call = calls[0];
  return call !== undefined && resolvesToSanitizeForTerminal(call.arguments[1]);
}

const join = (lines: string[]): string => lines.join("\n");

const BYPASS_SHAPES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["let-reassign: a local let alias reassigned under an env gate", join([...REAL_DESTRUCTURE, "let san = sanitizeMod.sanitizeForTerminal;", "if (process.env.THOTH_X) san = (s) => s;", "const output = render.renderHookOutput(gate.decideToolCall(input, ports), san);"])],
  ["let-declared sanitizeMod itself reassigned", join(["let [raw, gate, render, loader, central, catalog, sanitizeMod] = await Promise.all([", ...IMPORTS_BEFORE_SANITIZE, SANITIZE_IMPORT, "]);", `if (process.env.THOTH_X) sanitizeMod = ${IDENTITY_PORT};`, REAL_CALL])],
  ["function-parameter shadow", join([...REAL_DESTRUCTURE, "function emit(sanitizeMod) {", "  return render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);", "}", `const output = emit(process.env.THOTH_X ? ${IDENTITY_PORT} : sanitizeMod);`])],
  ["arrow-parameter shadow", join([...REAL_DESTRUCTURE, "const emit = (sanitizeMod) => render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);", `const output = emit(process.env.THOTH_X ? ${IDENTITY_PORT} : sanitizeMod);`])],
  ["object-binding-pattern shadow in a nested block", join([...REAL_DESTRUCTURE, "let output;", "{", `  const { sanitizeMod } = { sanitizeMod: process.env.THOTH_X ? ${IDENTITY_PORT} : sanitizeMod };`, "  output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);", "}"])],
  ["catch-clause shadow", join([...REAL_DESTRUCTURE, "let output;", "try {", "  throw process.env.THOTH_X ? { sanitizeForTerminal: (s) => s } : sanitizeMod;", "} catch (sanitizeMod) {", "  output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);", "}"])],
  ["for-of shadow", join([...REAL_DESTRUCTURE, "let output;", `for (const sanitizeMod of [process.env.THOTH_X ? ${IDENTITY_PORT} : {}]) {`, "  output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);", "}"])],
  ["var hoisted out of a block inside a function", join([...REAL_DESTRUCTURE, "function emit() {", `  if (process.env.THOTH_X) { var sanitizeMod = ${IDENTITY_PORT}; }`, "  return render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);", "}", "const output = emit();"])],
  [
    "Promise.all spread shifts the runtime index against the AST index",
    join([
      "const [raw, gate, render, loader, sanitizeMod] = await Promise.all([",
      "  readStdin(),",
      '  import("../src/policy/gate/decide-tool-call.ts"),',
      '  import("../src/policy/gate/render-hook-output.ts"),',
      '  import("../src/policy/config/loader.ts"),',
      '  ...[import("../src/policy/tools/classification-catalog.ts"), import("../../attacker-controlled/sanitize.ts")],',
      SANITIZE_IMPORT,
      "]);",
      REAL_CALL,
    ]),
  ],
  ["module-object assignment under an env gate", join([...REAL_DESTRUCTURE, "if (process.env.THOTH_X) sanitizeMod.sanitizeForTerminal = (s) => s;", REAL_CALL])],
  ["local Promise shadow feeds the destructure", join(["const Promise = { all: async () => [1, 2, 3, 4, 5, 6, { sanitizeForTerminal: (s) => s }] };", ...REAL_DESTRUCTURE, REAL_CALL])],
  ["decoy property-access call kept, real call via bracket access", join([...REAL_DESTRUCTURE, "if (process.env.THOTH_NEVER) render.renderHookOutput(null, sanitizeMod.sanitizeForTerminal);", 'const output = render["renderHookOutput"](gate.decideToolCall(input, ports), (s) => s);'])],
  ["decoy property-access call kept, real call via computed-key bracket access", join([...REAL_DESTRUCTURE, "if (process.env.THOTH_NEVER) render.renderHookOutput(null, sanitizeMod.sanitizeForTerminal);", 'const output = render["render" + "HookOutput"](gate.decideToolCall(input, ports), (s) => s);'])],
  ["decoy property-access call kept, real call via a destructured alias", join([...REAL_DESTRUCTURE, "if (process.env.THOTH_NEVER) render.renderHookOutput(null, sanitizeMod.sanitizeForTerminal);", "const { renderHookOutput: r } = render;", "const output = r(gate.decideToolCall(input, ports), (s) => s);"])],
];

for (const [name, source] of BYPASS_SHAPES) {
  test(`AC-7d: the sanitize-wiring guard REJECTS this bypass shape — ${name}`, () => {
    assert.equal(guardAccepts(source), false, `the guard must reject: ${name}`);
  });
}

test("AC-7d positive control: the real hook's own shape (const array-destructure of Promise.all imports, one direct sanitizeMod.sanitizeForTerminal argument) is still ACCEPTED, so the table above rejects for the shape, not for a broken fixture", () => {
  assert.equal(guardAccepts(join([...REAL_DESTRUCTURE, REAL_CALL])), true);
});

test("AC-7e: a function-parameter and an object-binding-pattern shadow of sanitizeMod are both rejected — the resolver enumerates every binding form in the reference's scope chain, not only Block/SourceFile variable statements with an Identifier or array-pattern name", () => {
  const paramShadow = join([...REAL_DESTRUCTURE, "function emit(sanitizeMod) {", "  return render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);", "}", `const output = emit(process.env.THOTH_X ? ${IDENTITY_PORT} : sanitizeMod);`]);
  const patternShadow = join([...REAL_DESTRUCTURE, "let output;", "{", `  const { sanitizeMod } = { sanitizeMod: process.env.THOTH_X ? ${IDENTITY_PORT} : sanitizeMod };`, "  output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);", "}"]);
  assert.equal(guardAccepts(paramShadow), false, "function-parameter shadow");
  assert.equal(guardAccepts(patternShadow), false, "object-binding-pattern shadow");
});

// Issue #369 (app-security round 3, MED, demonstrated): only the `sanitizeMod` element of the
// `Promise.all` array was pinned to its exact specifier, so retargeting the `render` import to a
// module that swaps in an identity sanitizer under an env gate kept every guard green. EVERY element
// is now pinned, index by index, to its exact expected specifier (and the pattern to its exact names).
const EXPECTED_SPECIFIERS = [
  "../src/policy/gate/decide-tool-call.ts",
  "../src/policy/gate/render-hook-output.ts",
  "../src/policy/config/loader.ts",
  "../src/policy/config/central-source.ts",
  "../src/policy/tools/classification-catalog.ts",
  "../src/policy/config/sanitize.ts",
];

function destructureWithElements(elements: string[]): string {
  return join(["const [raw, gate, render, loader, central, catalog, sanitizeMod] = await Promise.all([", ...elements.map((e) => `  ${e},`), "]);", REAL_CALL]);
}
const REAL_ELEMENTS = ["readStdin()", ...EXPECTED_SPECIFIERS.map((s) => `import("${s}")`)];

test("#369 control: the exact expected Promise.all element list is ACCEPTED (so the retargets below fail for the specifier, not the fixture)", () => {
  assert.equal(guardAccepts(destructureWithElements(REAL_ELEMENTS)), true);
});

for (let i = 1; i < REAL_ELEMENTS.length - 1; i++) {
  test(`#369: retargeting the Promise.all import at index ${i} (${EXPECTED_SPECIFIERS[i - 1]}) to an attacker module is REJECTED`, () => {
    const elements = [...REAL_ELEMENTS];
    elements[i] = 'import("../src/policy/gate/evil-render.ts")';
    assert.equal(guardAccepts(destructureWithElements(elements)), false);
  });
}

test("#369: replacing the readStdin() element, or appending an extra Promise.all element, is REJECTED", () => {
  assert.equal(guardAccepts(destructureWithElements(["attackerStdin()", ...REAL_ELEMENTS.slice(1)])), false, "index 0 must be readStdin()");
  assert.equal(guardAccepts(destructureWithElements([...REAL_ELEMENTS, 'import("../src/policy/gate/evil-extra.ts")'])), false, "an extra element beyond the 7 expected");
});

test("#369: renaming a destructured binding (render bound at the wrong index) is REJECTED", () => {
  const swapped = join(["const [raw, gate, loader, render, central, catalog, sanitizeMod] = await Promise.all([", ...REAL_ELEMENTS.map((e) => `  ${e},`), "]);", REAL_CALL]);
  assert.equal(guardAccepts(swapped), false);
});

// Issue #370 (app-security round 3, MED, demonstrated): AC-3 was a NAME deny-list. Each of the four
// shapes below reaches `process.env` while every name check stays green. Now also forbidden anywhere
// in the hook: a `Function` or `eval` reference (direct or indirect), any `constructor` access (dot,
// bracket or destructured), any computed element access, and a dynamic import() whose specifier is
// not a plain string literal. The real hook needs none of these (asserted by the real-hook test above).
const ENV_ROUTE_SHAPES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["Function constructor call", 'const env = Function("return process")().env;'],
  ["new Function", 'const env = new Function("return process")().env;'],
  ["constructor reached through an allowed member (dot)", 'const env = process.exit.constructor("return process")().env;'],
  ["constructor reached through an allowed member (bracket)", 'const env = process.exit["constructor"]("return process")().env;'],
  ["constructor spelled by concatenation (computed element access)", 'const env = process.exit["con" + "structor"]("return process")().env;'],
  ["constructor destructured", 'const { constructor: F } = process.exit;\nconst env = F("return process")().env;'],
  ["computed import specifier (concatenation)", 'const env = (await import("node:" + "process")).env;'],
  ["computed import specifier (variable)", 'const spec = "node:process";\nconst env = (await import(spec)).env;'],
  ["template import specifier with a substitution", "const n = \"process\";\nconst env = (await import(`node:${n}`)).env;"],
  ["indirect eval", 'const env = (0, eval)("process.env");'],
  ["direct eval", 'const env = eval("process.env");'],
];

for (const [name, source] of ENV_ROUTE_SHAPES) {
  test(`AC-3b (#370): the environment-access scan flags this route — ${name}`, () => {
    assert.ok(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)).length > 0, `expected the scan to flag: ${name}`);
  });
}

test("AC-3b positive control: a plain string-literal dynamic import() and ordinary member access are not flagged", () => {
  const source = 'const m = await import("../src/policy/config/sanitize.ts");\nconst f = m.sanitizeForTerminal;\nprocess.exit(2);';
  assert.deepEqual(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)), []);
});

// Issue #370 residual (disclosed by the build, closed here): the forbidden-specifier list was still a
// deny-list (a literal import("node:vm") passed). Every module specifier in the hook — static
// `import ... from`, `export ... from`, and runtime `import()` — must now be one of an EXACT
// allow-list: node:path, node:url, plus the 6 pinned Promise.all specifiers. JSDoc type-only
// `import("...")` in a comment is not code and stays legal.
const SPECIFIER_SHAPES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["static import of node:vm", 'import vm from "node:vm";'],
  ["static import of node:child_process", 'import { execSync } from "node:child_process";'],
  ["dynamic import of node:vm", 'const vm = await import("node:vm");'],
  ["dynamic import of node:worker_threads", 'const w = await import("node:worker_threads");'],
  ["export-star from node:fs", 'export * from "node:fs";'],
  ["named re-export from node:fs", 'export { readFileSync } from "node:fs";'],
  ["dynamic import of a project module outside the pinned six", 'const m = await import("../src/policy/gate/evil-render.ts");'],
];

for (const [name, source] of SPECIFIER_SHAPES) {
  test(`AC-3c (#370): a module specifier outside the exact allow-list is flagged — ${name}`, () => {
    assert.ok(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)).length > 0, `expected the scan to flag: ${name}`);
  });
}

test("AC-3c positive control: the allow-listed specifiers (node:path, node:url, the 6 pinned imports) and a JSDoc type-only import() in a comment are not flagged", () => {
  const source = [
    'import { dirname, join } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "/** @returns {import(\"node:vm\").Script} */",
    "function typed() { return undefined; }",
    ...PROMISE_ALL_SHAPE.filter((e) => e.specifier !== undefined).map((e) => `const m_${e.name} = await import("${e.specifier}");`),
  ].join("\n");
  assert.deepEqual(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)), []);
});

// Issue #371 (app-security round 4, MED + LOW, demonstrated): the AC-3 scan still found `Function` by
// SPELLING. A property name held in a quoted key, computed key, template, call argument or
// `String.fromCharCode` was never inspected, so six routes reached Function (and so process.env)
// with AC-3 green. The root fix stops the spelling chase: every free (undeclared, ambient) global
// the hook references must be on a short allow-set pinned to what the real hook uses.
const REFLECTIVE_SHAPES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["Reflect.get on the prototype with a string key", 'const env = Reflect.get(Object.getPrototypeOf(process.exit), "constructor")("return process")().env;'],
  ["quoted key destructure", 'const { "constructor": F } = process.exit;\nconst env = F("return process")().env;'],
  ["computed key destructure", 'const { ["con" + "structor"]: F } = process.exit;\nconst env = F("return process")().env;'],
  ["getOwnPropertyDescriptor with a string key", 'const F = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(process.exit), "constructor").value;'],
  ["template-literal key", "const F = Reflect.get(process.exit, `constructor`);"],
  ["String.fromCharCode key", "const F = Reflect.get(process.exit, String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114));"],
  ["prototype string key", 'const p = { "prototype": 1 };'],
  ["__proto__ computed key", 'const k = "__pro" + "to__";\nconst o = { [k]: 1 };'],
];

for (const [name, source] of REFLECTIVE_SHAPES) {
  test(`AC-3d (#371): the environment-access scan flags a reflective, quoted, computed or template route — ${name}`, () => {
    assert.ok(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)).length > 0, `expected the scan to flag: ${name}`);
  });
}

const GLOBAL_MUTATION_SHAPES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["String.prototype.replace assignment", "String.prototype.replace = function () { return String(this); };"],
  ["Reflect.set on RegExp.prototype with Symbol.replace", "Reflect.set(RegExp.prototype, Symbol.replace, () => \"\");"],
  ["assignment to a member of an allowed global (process.stdout.write)", "process.stdout.write = () => true;"],
  ["compound assignment rooted at a global", "process.stdout.count += 1;"],
  ["increment rooted at a global", "process.stdout.count++;"],
  ["delete rooted at a global", "delete process.exit;"],
  ["destructuring assignment target rooted at a global", "[process.exit] = [() => 0];"],
  ["an unlisted free global (console)", 'console.log("x");'],
  ["an unlisted free global (Object)", "const k = Object.keys({});"],
];

for (const [name, source] of GLOBAL_MUTATION_SHAPES) {
  test(`AC-3e (#371): an assignment rooted at a global, or an unlisted free global, is flagged — ${name}`, () => {
    assert.ok(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)).length > 0, `expected the scan to flag: ${name}`);
  });
}

// #372 narrowed this control: member WRITES are now deny-by-default (AC-3h), so the benign refactor
// it models builds its object literal in one expression instead of mutating it afterwards.
test("AC-3d/3e positive control: a benign refactor (a local const helper, a local object literal, JSON, Error, Promise, undefined) is not flagged", () => {
  const source = [
    "const helper = (s) => s.trim();",
    'const label = helper("x");',
    "const local = { value: 1, count: 2 };",
    'const parsed = JSON.parse("{}");',
    "const p = new Promise((resolve) => resolve(undefined));",
    'const e = new Error("x");',
  ].join("\n");
  assert.deepEqual(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)), []);
});

// Issue #372 (app-security round 5, MED, demonstrated; successor to #371): the "no write rooted at a
// global" rule rooted only at a global IDENTIFIER, and banned `__proto__`/`prototype` only as strings.
// A literal or local root (`"".__proto__.replace = ...`), a destructuring write target, a
// `__defineGetter__` call, and an alias of an allowed global (`const J = JSON; J.stringify = ...`) all
// patch a built-in and disable the sanitizer with AC-3/3e/3f green. Deny by default on the vehicles:
// AC-3g bans the dangerous property NAMES in every position; AC-3h denies every member write not on an
// allow-list pinned to the real hook; AC-3i lets an allowed global appear only as a member-access
// object or a call/new callee, never as a value that could be aliased.
const BANNED_NAME_SHAPES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["__proto__ property access on a string literal root", '"".__proto__.replace = function () { return ""; };'],
  ["__proto__ property access on a local root", 'const s = "";\ns.__proto__.replace = function () { return ""; };'],
  ["__proto__ destructuring write target", '[("").__proto__.replace] = [() => ""];'],
  ["__defineGetter__ call", 'const o = {};\no.__defineGetter__("x", () => 1);'],
  ["__defineSetter__ call", 'const o = {};\no.__defineSetter__("x", () => 1);'],
  ["__lookupGetter__ call", 'const o = {};\nconst g = o.__lookupGetter__("x");'],
  ["__lookupSetter__ call", 'const o = {};\nconst g = o.__lookupSetter__("x");'],
  ["prototype as an identifier property", "function F() {}\nconst p = F.prototype;"],
  ["__proto__ as an object-literal key", "const o = { __proto__: null };"],
  ["__proto__ as a destructuring key", "const { __proto__: p } = {};"],
  ["__proto__ as a shorthand property", "const __proto__ = 1;\nconst o = { __proto__ };"],
  ["__defineGetter__ as a method name", "const o = { __defineGetter__() {} };"],
];

for (const [name, source] of BANNED_NAME_SHAPES) {
  test(`AC-3g (#372): a dangerous property name is banned in every position — ${name}`, () => {
    assert.ok(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)).length > 0, `expected the scan to flag: ${name}`);
  });
}

const MEMBER_WRITE_SHAPES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["assignment to a member of a local object", "const o = {};\no.x = 1;"],
  ["assignment to a member of a string literal", '"".x = 1;'],
  ["assignment to a member of a call result", "const f = () => ({});\nf().x = 1;"],
  ["compound assignment to a local member", "const o = { n: 1 };\no.n += 1;"],
  ["increment of a local member", "const o = { n: 1 };\no.n++;"],
  ["delete of a local member", "const o = { n: 1 };\ndelete o.n;"],
  ["destructuring write to a local member", "const o = {};\n[o.x] = [1];"],
  ["for-of target that is a local member", "const o = {};\nfor (o.x of [1]) {}"],
];

for (const [name, source] of MEMBER_WRITE_SHAPES) {
  test(`AC-3h (#372): a member write not on the pinned allow-list is flagged — ${name}`, () => {
    assert.ok(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)).length > 0, `expected the scan to flag: ${name}`);
  });
}

const ALIAS_SHAPES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["JSON aliased, then written", 'const J = JSON;\nJ.stringify = () => "";'],
  ["Promise aliased as a value", "const P = Promise;"],
  ["Error aliased as a value", "const E = Error;"],
  ["JSON passed as an argument", "const f = (x) => x;\nf(JSON);"],
  ["JSON returned as a value", "const f = () => JSON;"],
  ["JSON destructured from", 'const { stringify } = JSON;'],
  ["JSON as a shorthand property value", "const o = { JSON };"],
  ["JSON spread", "const o = { ...JSON };"],
  ["class extending Promise", "class X extends Promise {}"],
];

for (const [name, source] of ALIAS_SHAPES) {
  test(`AC-3i (#372): an allowed global may only be a member-access object or a call/new callee, never a bare value — ${name}`, () => {
    assert.ok(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)).length > 0, `expected the scan to flag: ${name}`);
  });
}

test("AC-3i positive control: allowed globals used as member-access objects and call/new callees, and undefined as a value, are not flagged", () => {
  const source = ['const a = JSON.parse("{}");', "const b = new Error(String_ok);", "const c = Promise.all([]);", "const d = new Promise((r) => r(undefined));", "process.exit(2);", "const String_ok = 1;"].join("\n");
  assert.deepEqual(findEnvironmentAccess(parseWithChecker("synthetic.mjs", source)), []);
});
