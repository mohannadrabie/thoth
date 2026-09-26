// Issue #313 (app-security, MED): print-cli.ts writes lines a test cannot reach (it hard-wires the
// real registry reader and repo paths, and Issue #99 bars adding a seam), and the interpolation scan
// in echo-sanitize.test.ts missed plain concatenation and a sanitizer call followed by the raw value.
//
// Written FIRST (failing), by story-implementer. Two parts:
//   1. The pin line is rendered by an exported function in printer.ts (same pattern as
//      renderInertMandatoryNote) and tested here behaviorally with a hostile channel.
//   2. A source guard on print-cli.ts: every `process.stdout.write(...)` argument must be a printer.ts
//      renderer call, or a named PrinterResult string field, followed by the newline. print-cli.ts
//      therefore builds no line of its own, so it has nothing to sanitize and nothing to forget.
//      HEURISTIC, like the scan in echo-sanitize.test.ts (a source scan, not a proof); the behavioral
//      tests of the renderers are the backstop. The guard's own self-test runs it against the two
//      mutants app-security demonstrated (a NOTE line built by concatenation; an empty sanitize call
//      followed by the raw channel) and requires it to flag both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPinLine } from "./printer.ts";
import type { PolicyPin } from "./pin.ts";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

const HOSTILE = "\u001b[31m\nREJECTED-LOOKALIKE: forged line\u2028second\u0085third\rfourth\u0000\u007f\u009b[2J";
const HOSTILE_VISIBLE = "[31mREJECTED-LOOKALIKE: forged linesecondthirdfourth[2J";

function isTerminalActive(codeUnit: number): boolean {
  return codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f) || codeUnit === 0x2028 || codeUnit === 0x2029;
}

const DIGEST = "a".repeat(64);
const AT = "2026-09-26T10:11:12.000Z";

test("renderPinLine for a clean pin equals the pre-change literal", () => {
  const pin: PolicyPin = { digest: DIGEST, channel: "HKLM\\SOFTWARE\\Policies\\Thoth\\CentralPolicyJson", computedAt: AT };
  assert.equal(renderPinLine(pin), `pin: sha256:${DIGEST} channel=HKLM\\SOFTWARE\\Policies\\Thoth\\CentralPolicyJson computedAt=${AT}`);
  assert.equal(renderPinLine({ digest: DIGEST, channel: "(absent)", computedAt: AT }), `pin: sha256:${DIGEST} channel=(absent) computedAt=${AT}`);
});

test("renderPinLine with a hostile channel descriptor is one line with no terminal-active character", () => {
  const line = renderPinLine({ digest: DIGEST, channel: `chan ${HOSTILE}`, computedAt: AT });
  assert.equal(line, `pin: sha256:${DIGEST} channel=chan ${HOSTILE_VISIBLE} computedAt=${AT}`);
  for (let i = 0; i < line.length; i++) assert.ok(!isTerminalActive(line.charCodeAt(i)), `terminal-active code unit at offset ${i}`);
  assert.equal(line.split("\n").length, 1);
});

// ---------------------------------------------------------------------------------------------
// Guard on print-cli.ts
// ---------------------------------------------------------------------------------------------

/** The only argument shapes print-cli.ts may write: a printer.ts renderer applied to one named value, or a named PrinterResult string. */
const ALLOWED_WRITE_ARG = /^(?:result\.(?:stdout|postureLine|disclosure)|render[A-Z]\w*\((?:result\.pin|d)\)) \+ "\\n"$/;

/** Findings for a print-cli.ts source text; an empty array means the guard is satisfied. */
function printCliViolations(source: string): string[] {
  const code = source
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
  const out: string[] = [];
  const writes = [...code.matchAll(/process\.stdout\.write\(([^;]*?)\);/g)].map((m) => (m[1] ?? "").trim());
  if (writes.length === 0) out.push("no process.stdout.write call found (scanner broken?)");
  for (const arg of writes) if (!ALLOWED_WRITE_ARG.test(arg)) out.push(`stdout write is not a renderer call or a PrinterResult field: ${arg}`);
  const anyWrite = [...code.matchAll(/\.write\(/g)].length;
  if (anyWrite !== writes.length) out.push(`${anyWrite - writes.length} output call(s) other than process.stdout.write`);
  if (/\bconsole\.|process\.stderr/.test(code)) out.push("console or stderr output");
  if (/`/.test(code)) out.push("a template literal: print-cli.ts builds no text of its own");
  return out;
}

const MUTANT_NOTE_BY_CONCATENATION = `
  for (const d of result.inertMandatoryDeclarations) {
    process.stdout.write("NOTE: rule id=" + d.ruleId + " declares mandatory:true" + "\\n");
  }`;
const MUTANT_PIN_WRAPPER_PLUS_RAW = `
  if (result.pin) {
    process.stdout.write(sanitizeForTerminal("") + String(result.pin.channel) + "\\n");
  }`;
const MUTANT_PIN_TEMPLATE = `
  if (result.pin) {
    process.stdout.write(\`pin: \${result.pin.channel}\\n\`);
  }`;
const CLEAN_SNIPPET = `
  process.stdout.write(result.stdout + "\\n");
  if (result.pin) {
    process.stdout.write(renderPinLine(result.pin) + "\\n");
  }
  for (const d of result.inertMandatoryDeclarations) {
    process.stdout.write(renderInertMandatoryNote(d) + "\\n");
  }`;

test("the print-cli guard bites: it flags concatenation, wrapper-plus-raw and a template literal, and accepts renderer calls", () => {
  assert.deepEqual(printCliViolations(CLEAN_SNIPPET), []);
  assert.notDeepEqual(printCliViolations(MUTANT_NOTE_BY_CONCATENATION), []);
  assert.notDeepEqual(printCliViolations(MUTANT_PIN_WRAPPER_PLUS_RAW), []);
  assert.notDeepEqual(printCliViolations(MUTANT_PIN_TEMPLATE), []);
  assert.notDeepEqual(printCliViolations(`${CLEAN_SNIPPET}\n  console.log(result.pin.channel);`), []);
  assert.notDeepEqual(printCliViolations(`${CLEAN_SNIPPET}\n  process.stderr.write(result.pin.channel);`), []);
});

test("print-cli.ts writes only printer.ts renderer output or named PrinterResult fields, and uses both renderers", () => {
  const source = readFileSync(path.join(THIS_DIR, "print-cli.ts"), "utf8");
  assert.deepEqual(printCliViolations(source), [], "print-cli.ts builds a line of its own");
  assert.match(source, /renderPinLine\(result\.pin\)/, "print-cli.ts must render the pin line through printer.ts");
  assert.match(source, /renderInertMandatoryNote\(d\)/, "print-cli.ts must render the NOTE line through printer.ts");
});
