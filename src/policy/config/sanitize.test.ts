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
function isSanitizeForTerminalAccess(expr: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expr) && expr.name.text === "sanitizeForTerminal";
}

/** Resolves `expr` to `*.sanitizeForTerminal`, directly or via exactly one local `const` alias
 * assignment found anywhere in `sourceFile` — never through a ternary, call, or other operator. */
function resolvesToSanitizeForTerminal(expr: ts.Expression, sourceFile: ts.SourceFile, seen = new Set<string>()): boolean {
  if (isSanitizeForTerminalAccess(expr)) return true;
  if (!ts.isIdentifier(expr) || seen.has(expr.text)) return false;
  seen.add(expr.text);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === expr.text && node.initializer) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return initializer !== undefined && resolvesToSanitizeForTerminal(initializer, sourceFile, seen);
}

/** The second argument of the first `renderHookOutput(...)` call found in `sourceFile`, or undefined. */
function findRenderHookOutputSecondArg(sourceFile: ts.SourceFile): ts.Expression | undefined {
  let result: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (result) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "renderHookOutput") {
      result = node.arguments[1];
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

test("AC-7: hooks/pretooluse-kernel-gate.mjs unconditionally wires sanitizeForTerminal as renderHookOutput's second argument (no conditional/ternary bypass; a local-alias hoist is accepted)", () => {
  const hook = readFileSync(path.join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs"), "utf8");
  assert.match(
    hook,
    /import\(\s*["']\.\.\/src\/policy\/config\/sanitize\.ts["']\s*\)/,
    "hooks/pretooluse-kernel-gate.mjs must dynamically import ../src/policy/config/sanitize.ts",
  );
  const sourceFile = ts.createSourceFile("pretooluse-kernel-gate.mjs", hook, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const secondArg = findRenderHookOutputSecondArg(sourceFile);
  assert.ok(secondArg, "no renderHookOutput(...) call with a second argument found");
  assert.ok(
    resolvesToSanitizeForTerminal(secondArg, sourceFile),
    "hooks/pretooluse-kernel-gate.mjs must pass an UNCONDITIONAL reference to sanitizeForTerminal (directly, or via one local " +
      `alias assignment) as renderHookOutput's second argument — no ternary/conditional. Got: ${hook.slice(secondArg.getStart(sourceFile), secondArg.getEnd())}`,
  );
});
