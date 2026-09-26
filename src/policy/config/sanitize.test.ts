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
