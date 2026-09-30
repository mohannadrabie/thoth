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
// `const` alias assignment (a benign hoist, red-team's own drill M9, is accepted) — with no
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
//     full-ECMAScript) lexical scope resolution: starting from the reference's own position, walk
//     outward through enclosing `Block`/`SourceFile` scopes (nearest first), searching each scope's
//     OWN direct statements before moving to its parent scope — the same order a real inner-scope
//     shadow would actually resolve at runtime. Disclosed narrower-than-full-JS-scoping residual:
//     no hoisting, no `var`, no function-parameter binding, no TDZ — sufficient for this guard's own
//     `const`/`let` idiom (the only shape the real hook and every constructed drill use).
const SANITIZE_MODULE_SPECIFIER = "../src/policy/config/sanitize.ts";

/** True when `expr` is EXACTLY `import("../src/policy/config/sanitize.ts")` — the one real
 * relative specifier `hooks/pretooluse-kernel-gate.mjs` must use, not merely a path ending in the
 * same suffix (Issue #366). */
function isSanitizeModuleImportCall(expr: ts.Expression): boolean {
  if (!ts.isCallExpression(expr) || expr.expression.kind !== ts.SyntaxKind.ImportKeyword || expr.arguments.length !== 1) return false;
  const arg0 = expr.arguments[0];
  return arg0 !== undefined && ts.isStringLiteralLike(arg0) && arg0.text === SANITIZE_MODULE_SPECIFIER;
}

interface ResolvedBinding {
  initializer: ts.Expression;
  arrayIndex: number | undefined;
}

function isLexicalScopeNode(node: ts.Node): node is ts.SourceFile | ts.Block {
  return ts.isSourceFile(node) || ts.isBlock(node);
}

/** The nearest `Block`/`SourceFile` STRICTLY ENCLOSING `node` (never `node` itself). */
function findEnclosingScope(node: ts.Node): ts.SourceFile | ts.Block | undefined {
  let n: ts.Node | undefined = node.parent;
  while (n && !isLexicalScopeNode(n)) n = n.parent;
  return n;
}

/** Searches ONE scope's own direct statements (never descending into a nested block) for a
 * `const`/`let` binding of `name`, either a plain identifier or an element of an array-binding
 * pattern (`const [a, b] = ...`). */
function findBindingInScope(scope: ts.SourceFile | ts.Block, name: string): ResolvedBinding | undefined {
  let found: ResolvedBinding | undefined;
  for (const stmt of scope.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer) continue;
      if (ts.isIdentifier(decl.name) && decl.name.text === name) {
        found = { initializer: decl.initializer, arrayIndex: undefined };
      } else if (ts.isArrayBindingPattern(decl.name)) {
        const index = decl.name.elements.findIndex((el) => ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === name);
        if (index !== -1) found = { initializer: decl.initializer, arrayIndex: index };
      }
    }
  }
  return found;
}

/** Resolves `name` starting from `referenceNode`'s OWN lexical position, walking outward through
 * enclosing scopes (nearest first) and returning the FIRST match — real scope resolution, replacing
 * a flat whole-file, tree-order search that could resolve to the wrong (outer) declaration when an
 * inner scope shadows the same name (Issue #360 finding R3). */
function findBindingDeclaration(name: string, referenceNode: ts.Node): ResolvedBinding | undefined {
  let scope = findEnclosingScope(referenceNode);
  while (scope) {
    const found = findBindingInScope(scope, name);
    if (found) return found;
    scope = findEnclosingScope(scope);
  }
  return undefined;
}

function unwrapAwait(expr: ts.Expression): ts.Expression {
  return ts.isAwaitExpression(expr) ? expr.expression : expr;
}

/** Resolves identifier `name`, referenced at `referenceNode`'s own lexical position, back to the
 * module-load expression it's bound to: directly (`const sanitizeMod = await import(...)`), or as
 * the Nth element of the `await Promise.all([...imports])` array this hook's own destructuring
 * idiom uses. Anything else (bound to an object literal, a function call result, an unresolvable
 * pattern) yields `undefined`. */
function resolveModuleBinding(name: string, referenceNode: ts.Node): ts.Expression | undefined {
  const binding = findBindingDeclaration(name, referenceNode);
  if (!binding) return undefined;
  const init = unwrapAwait(binding.initializer);
  if (binding.arrayIndex === undefined) return init;
  if (
    !ts.isCallExpression(init) ||
    !ts.isPropertyAccessExpression(init.expression) ||
    !ts.isIdentifier(init.expression.expression) ||
    init.expression.expression.text !== "Promise" ||
    init.expression.name.text !== "all" ||
    init.arguments.length !== 1
  ) {
    return undefined;
  }
  const arrayArg = init.arguments[0];
  if (!arrayArg || !ts.isArrayLiteralExpression(arrayArg)) return undefined;
  return arrayArg.elements[binding.arrayIndex];
}

/** True when `objExpr` (the object side of a `<obj>.sanitizeForTerminal` access) resolves — from
 * `objExpr`'s OWN scope, not a flat whole-file search — all the way back to the one real
 * `import("../src/policy/config/sanitize.ts")` call. Never merely because a property happens to be
 * named "sanitizeForTerminal" on some other value (Issue #360 finding R2/AC-7b), and never merely
 * because SOME same-named declaration exists somewhere else in the file (Issue #360 finding R3). */
function resolvesToSanitizeModuleImport(objExpr: ts.Expression): boolean {
  if (!ts.isIdentifier(objExpr)) return false;
  const resolved = resolveModuleBinding(objExpr.text, objExpr);
  return resolved !== undefined && isSanitizeModuleImportCall(resolved);
}

function isSanitizeForTerminalAccess(expr: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expr) && expr.name.text === "sanitizeForTerminal" && resolvesToSanitizeModuleImport(expr.expression);
}

/** Resolves `expr` to `*.sanitizeForTerminal` sourced from the real sanitize module import,
 * directly or via exactly one local `const` alias assignment resolved from `expr`'s OWN scope —
 * never through a ternary, call, other operator, an object literal masquerading under the same
 * property name, or a same-named declaration in the WRONG scope (Issue #360 findings R2/R3). */
function resolvesToSanitizeForTerminal(expr: ts.Expression | undefined, seen = new Set<string>()): boolean {
  if (expr === undefined) return false;
  if (isSanitizeForTerminalAccess(expr)) return true;
  if (!ts.isIdentifier(expr) || seen.has(expr.text)) return false;
  seen.add(expr.text);
  const binding = findBindingDeclaration(expr.text, expr);
  return binding !== undefined && binding.arrayIndex === undefined && resolvesToSanitizeForTerminal(binding.initializer, seen);
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

test("AC-7/AC-7c: hooks/pretooluse-kernel-gate.mjs contains exactly ONE renderHookOutput call site, and its second argument unconditionally resolves to the real sanitizeForTerminal import (no conditional/ternary bypass, no port-object masquerade, no decoy call, no path-suffix lookalike; a local-alias hoist is accepted)", () => {
  const hook = readFileSync(path.join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs"), "utf8");
  // Issue #366 (app-security HIGH): the standalone raw-text regex that used to run here (checking
  // only that the literal specifier string appeared SOMEWHERE in the file) is REMOVED — it was
  // structurally independent of which import actually fed renderHookOutput's second argument, so a
  // dead-code decoy import satisfying it, combined with the real call site wired to an
  // attacker-controlled module, passed both checks. The AST resolution below, requiring the EXACT
  // specifier on the import that is ACTUALLY USED, is now the only check, and is strictly stronger.
  const sourceFile = ts.createSourceFile("pretooluse-kernel-gate.mjs", hook, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const calls = findAllRenderHookOutputCalls(sourceFile);
  assert.equal(calls.length, 1, `expected exactly one renderHookOutput(...) call site, found ${calls.length}`);
  const call = calls[0];
  assert.ok(call, "expected exactly one renderHookOutput(...) call site");
  const secondArg = call.arguments[1];
  assert.ok(secondArg, "the one renderHookOutput(...) call has no second argument");
  assert.ok(
    resolvesToSanitizeForTerminal(secondArg),
    "hooks/pretooluse-kernel-gate.mjs must pass an UNCONDITIONAL reference to the real sanitizeForTerminal import (directly, or via one " +
      `local alias assignment) as renderHookOutput's second argument — no ternary/conditional, no port-object masquerade, no path-suffix lookalike. Got: ${hook.slice(secondArg.getStart(sourceFile), secondArg.getEnd())}`,
  );
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
  const sourceFile = ts.createSourceFile("synthetic.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
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
  const sourceFile = ts.createSourceFile("synthetic.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
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
  const sourceFile = ts.createSourceFile("synthetic.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
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
  const sourceFile = ts.createSourceFile("synthetic.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
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
  const sourceFile = ts.createSourceFile("synthetic.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
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
  const sourceFile = ts.createSourceFile("synthetic.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
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
  const sourceFile = ts.createSourceFile("synthetic.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
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
