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
const SANITIZE_MODULE_SUFFIX = "/config/sanitize.ts";

/** True when `expr` is a dynamic `import(".../config/sanitize.ts")` call — the one binding source
 * AC-7b accepts as "the real sanitizer", independent of what property name is later read off it. */
function isSanitizeModuleImportCall(expr: ts.Expression): boolean {
  if (!ts.isCallExpression(expr) || expr.expression.kind !== ts.SyntaxKind.ImportKeyword || expr.arguments.length !== 1) return false;
  const arg0 = expr.arguments[0];
  return arg0 !== undefined && ts.isStringLiteralLike(arg0) && arg0.text.endsWith(SANITIZE_MODULE_SUFFIX);
}

/** Finds the `VariableDeclaration` (anywhere in `sourceFile`) that binds `name`, either as a plain
 * identifier or as an element of an array-binding pattern (`const [a, b] = ...`), and returns its
 * initializer plus the array index `name` was bound at (`undefined` for a plain identifier). */
function findBindingDeclaration(
  name: string,
  sourceFile: ts.SourceFile,
): { initializer: ts.Expression; arrayIndex: number | undefined } | undefined {
  let found: { initializer: ts.Expression; arrayIndex: number | undefined } | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name) && node.name.text === name) {
        found = { initializer: node.initializer, arrayIndex: undefined };
        return;
      }
      if (ts.isArrayBindingPattern(node.name)) {
        const index = node.name.elements.findIndex((el) => ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === name);
        if (index !== -1) {
          found = { initializer: node.initializer, arrayIndex: index };
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function unwrapAwait(expr: ts.Expression): ts.Expression {
  return ts.isAwaitExpression(expr) ? expr.expression : expr;
}

/** Resolves identifier `name` back to the module-load expression it's bound to: directly
 * (`const sanitizeMod = await import(...)`), or as the Nth element of the `await
 * Promise.all([...imports])` array this hook's own destructuring idiom uses. Anything else
 * (bound to an object literal, a function call result, an unresolvable pattern) yields `undefined`. */
function resolveModuleBinding(name: string, sourceFile: ts.SourceFile): ts.Expression | undefined {
  const binding = findBindingDeclaration(name, sourceFile);
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

/** True when `objExpr` (the object side of a `<obj>.sanitizeForTerminal` access) resolves all the
 * way back to a real `import(".../config/sanitize.ts")` call — never merely because a property
 * happens to be named "sanitizeForTerminal" on some other value (Issue #360 finding R2/AC-7b). */
function resolvesToSanitizeModuleImport(objExpr: ts.Expression, sourceFile: ts.SourceFile): boolean {
  if (!ts.isIdentifier(objExpr)) return false;
  const resolved = resolveModuleBinding(objExpr.text, sourceFile);
  return resolved !== undefined && isSanitizeModuleImportCall(resolved);
}

function isSanitizeForTerminalAccess(expr: ts.Expression, sourceFile: ts.SourceFile): boolean {
  return ts.isPropertyAccessExpression(expr) && expr.name.text === "sanitizeForTerminal" && resolvesToSanitizeModuleImport(expr.expression, sourceFile);
}

/** Resolves `expr` to `*.sanitizeForTerminal` sourced from the real sanitize module import,
 * directly or via exactly one local `const` alias assignment found anywhere in `sourceFile` — never
 * through a ternary, call, other operator, or an object literal masquerading under the same
 * property name (Issue #360 findings R2/R3). */
function resolvesToSanitizeForTerminal(expr: ts.Expression | undefined, sourceFile: ts.SourceFile, seen = new Set<string>()): boolean {
  if (expr === undefined) return false;
  if (isSanitizeForTerminalAccess(expr, sourceFile)) return true;
  if (!ts.isIdentifier(expr) || seen.has(expr.text)) return false;
  seen.add(expr.text);
  const binding = findBindingDeclaration(expr.text, sourceFile);
  return binding !== undefined && binding.arrayIndex === undefined && resolvesToSanitizeForTerminal(binding.initializer, sourceFile, seen);
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

test("AC-7/AC-7c: hooks/pretooluse-kernel-gate.mjs contains exactly ONE renderHookOutput call site, and its second argument unconditionally resolves to the real sanitizeForTerminal import (no conditional/ternary bypass, no port-object masquerade, no decoy call; a local-alias hoist is accepted)", () => {
  const hook = readFileSync(path.join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs"), "utf8");
  assert.match(
    hook,
    /import\(\s*["']\.\.\/src\/policy\/config\/sanitize\.ts["']\s*\)/,
    "hooks/pretooluse-kernel-gate.mjs must dynamically import ../src/policy/config/sanitize.ts",
  );
  const sourceFile = ts.createSourceFile("pretooluse-kernel-gate.mjs", hook, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const calls = findAllRenderHookOutputCalls(sourceFile);
  assert.equal(calls.length, 1, `expected exactly one renderHookOutput(...) call site, found ${calls.length}`);
  const call = calls[0];
  assert.ok(call, "expected exactly one renderHookOutput(...) call site");
  const secondArg = call.arguments[1];
  assert.ok(secondArg, "the one renderHookOutput(...) call has no second argument");
  assert.ok(
    resolvesToSanitizeForTerminal(secondArg, sourceFile),
    "hooks/pretooluse-kernel-gate.mjs must pass an UNCONDITIONAL reference to the real sanitizeForTerminal import (directly, or via one " +
      `local alias assignment) as renderHookOutput's second argument — no ternary/conditional, no port-object masquerade. Got: ${hook.slice(secondArg.getStart(sourceFile), secondArg.getEnd())}`,
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
    resolvesToSanitizeForTerminal(call.arguments[1], sourceFile),
    false,
    "an object-literal port must NOT resolve, even with a property name that matches sanitizeForTerminal exactly",
  );
});

// Round-1 M9 non-regression: a benign local-`const` alias hoist of the REAL sanitizeForTerminal
// property access (`const sanitizePort = sanitizeMod.sanitizeForTerminal;`) must still resolve —
// the AC-7b object-resolution fix above must not reintroduce round-1's own false positive (a guard
// that blocks a benign refactor trains the next author to loosen the guard, not fix the code).
test("AC-7b non-regression: a benign local-const alias of the real sanitizeForTerminal property access still resolves (round-1 M9 — must not regress)", () => {
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
  assert.equal(resolvesToSanitizeForTerminal(call.arguments[1], sourceFile), true, "a benign local-const alias hoist of the real property access must still resolve");
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
