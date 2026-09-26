// Issue #313 (app-security, MED): print-cli.ts writes lines a test cannot reach (it hard-wires the
// real registry reader and repo paths, and Issue #99 bars adding a seam), and the interpolation scan
// in echo-sanitize.test.ts missed plain concatenation and a sanitizer call followed by the raw value.
//
// Written FIRST (failing), by story-implementer. Two parts:
//   1. The pin line is rendered by an exported function in printer.ts (same pattern as
//      renderInertMandatoryNote) and tested here behaviorally with a hostile channel.
//   2. A source guard on print-cli.ts: every `process.stdout.write(...)` argument must be a printer.ts
//      renderer call (the renderer must be a binding imported from ./printer.ts), or a named
//      PrinterResult string field, followed by the newline. HEURISTIC, like the scan in
//      echo-sanitize.test.ts: it checks that each write LOOKS like an imported-renderer call, it does
//      not prove the file builds no text; the behavioral tests of the renderers are the backstop. The guard's own self-test runs it against the two
//      mutants app-security demonstrated (a NOTE line built by concatenation; an empty sanitize call
//      followed by the raw channel) and requires it to flag both. Round 2 (Issues #317, #318) added a
//      locally defined renderer, trailing comments containing a backtick, and non-string descriptors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderInertMandatoryNote, renderPinLine } from "./printer.ts";
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

// Issue #318 (red-team round 2, MED): the pin renderer handed its channel descriptor to the string-typed
// sanitizer with no coercion, so a non-string descriptor from a port threw a TypeError after the rules
// block and before the posture line (print-cli.ts has no try). The renderer must return one line for ANY
// value, including ones whose own string conversion throws.
const UNPRINTABLE = "(unprintable value)";
function nullPrototype(): unknown {
  return Object.create(null);
}
const THROWING_TO_STRING = {
  toString(): string {
    throw new Error("boom");
  },
};
const HOSTILE_TO_STRING = {
  toString(): string {
    return "x\u001b[2Jy\nREJECTED: forged";
  },
};
const NON_STRING_DESCRIPTORS: readonly [string, unknown, string][] = [
  ["undefined", undefined, "undefined"],
  ["null", null, "null"],
  ["a number", 42, "42"],
  ["a plain object", { a: 1 }, "[object Object]"],
  ["a symbol", Symbol("chan"), "Symbol(chan)"],
  ["a null-prototype object", nullPrototype(), UNPRINTABLE],
  ["an object whose toString throws", THROWING_TO_STRING, UNPRINTABLE],
  ["an object whose toString returns hostile text", HOSTILE_TO_STRING, "x[2JyREJECTED: forged"],
];

test("the pin renderer returns a line, not a throw, for a non-string channel descriptor", () => {
  for (const [label, channel, visible] of NON_STRING_DESCRIPTORS) {
    let line = "";
    assert.doesNotThrow(() => {
      line = renderPinLine({ digest: DIGEST, channel: channel as string, computedAt: AT });
    }, label);
    assert.equal(line, `pin: sha256:${DIGEST} channel=${visible} computedAt=${AT}`, label);
    for (let i = 0; i < line.length; i++) assert.ok(!isTerminalActive(line.charCodeAt(i)), `${label}: terminal-active code unit at offset ${i}`);
  }
});

test("the inert-mandatory renderer returns a line, not a throw, for a non-string layer or rule id", () => {
  for (const [label, value, visible] of NON_STRING_DESCRIPTORS) {
    let line = "";
    assert.doesNotThrow(() => {
      line = renderInertMandatoryNote({ layer: value as string, ruleId: value as string });
    }, label);
    assert.ok(line.startsWith(`NOTE: rule id="${visible}" (layer=${visible}) declares mandatory:true`), label);
    for (let i = 0; i < line.length; i++) assert.ok(!isTerminalActive(line.charCodeAt(i)), `${label}: terminal-active code unit at offset ${i}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Guard on print-cli.ts
// ---------------------------------------------------------------------------------------------

/** The only argument shapes print-cli.ts may write: a printer.ts renderer applied to one named value, or a named PrinterResult string.
 * Group 1 is the renderer identifier, when the argument is a renderer call. */
const ALLOWED_WRITE_ARG = /^(?:result\.(?:stdout|postureLine|disclosure)|(render[A-Z]\w*)\((?:result\.pin|d)\)) \+ "\\n"$/;

/** Removes `//` and block comments, leaving string literals intact (a `//` inside quotes is not a comment).
 * Backticks are NOT treated as string delimiters: a template literal is itself a violation, so it must stay
 * visible to the checks below. Heuristic, like the rest of this guard: a regex literal holding a quote is not handled. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The local names bound by `import { ... } from "./printer.ts"` (an `a as b` binding contributes `b`). */
function printerImports(code: string): Set<string> {
  const names = new Set<string>();
  for (const m of code.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']\.\/printer\.ts["']/g)) {
    for (const part of (m[1] ?? "").split(",")) {
      const local = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (local) names.add(local);
    }
  }
  return names;
}

const GUARD_UNLOCK = "fix: route the text through an exported renderer in printer.ts (add one there, with a test) and call it from print-cli.ts";

/** Findings for a print-cli.ts source text; an empty array means the guard is satisfied. Every message names its unlock. */
function printCliViolations(source: string): string[] {
  const code = stripComments(source);
  const imported = printerImports(code);
  const out: string[] = [];
  const writes = [...code.matchAll(/process\.stdout\.write\(([^;]*?)\);/g)].map((m) => (m[1] ?? "").trim());
  if (writes.length === 0) out.push('no process.stdout.write call found; fix: the scanner or this file changed shape, so update stripComments or the write pattern in print-lines.test.ts');
  for (const arg of writes) {
    const m = ALLOWED_WRITE_ARG.exec(arg);
    if (m === null) {
      out.push(`stdout write is not a renderer call or a PrinterResult field: ${arg}; ${GUARD_UNLOCK} (if it already is one under a new argument name, widen ALLOWED_WRITE_ARG)`);
    } else if (m[1] !== undefined && !imported.has(m[1])) {
      out.push(`${m[1]} is not imported from ./printer.ts (a local or foreign renderer is untested and unsanitized); ${GUARD_UNLOCK}, or import it from ./printer.ts`);
    }
  }
  const anyWrite = [...code.matchAll(/\.write\(/g)].length;
  if (anyWrite !== writes.length) out.push(`${anyWrite - writes.length} output call(s) other than process.stdout.write; fix: write through process.stdout.write with a printer.ts renderer, or add the output to printer.ts's PrinterResult`);
  if (/\bconsole\.|process\.stderr/.test(code)) out.push("console or stderr output; fix: return the text in a PrinterResult field from printer.ts and write it with process.stdout.write");
  if (/`/.test(code)) out.push("a backtick in code (a template literal, which builds text in this file); fix: move the text into a printer.ts renderer, or put the backtick inside a // comment");
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
const PRINTER_IMPORT = `import { printEffectivePolicy, renderInertMandatoryNote, renderPinLine } from "./printer.ts";
`;
const CLEAN_SNIPPET = `${PRINTER_IMPORT}
  process.stdout.write(result.stdout + "\\n");
  if (result.pin) {
    process.stdout.write(renderPinLine(result.pin) + "\\n");
  }
  for (const d of result.inertMandatoryDeclarations) {
    process.stdout.write(renderInertMandatoryNote(d) + "\\n");
  }`;
// Issue #317 (red-team round 2, mutant M-E): a third line written through a renderer DEFINED in the CLI
// module. The identifier looks like a renderer, but it is not one of printer.ts's exports, so nothing
// tests it and nothing sanitizes what it concatenates.
const MUTANT_LOCAL_RENDERER = `${CLEAN_SNIPPET}
  function renderLocalPin(pin: { channel: string }): string {
    return "pin: channel=" + pin.channel;
  }
  if (result.pin) {
    process.stdout.write(renderLocalPin(result.pin) + "\\n");
  }`;
// The same shape with the helper imported from somewhere other than printer.ts.
const MUTANT_RENDERER_FROM_ELSEWHERE = `${CLEAN_SNIPPET}
  import { renderPinLine as renderElsewhere } from "./other.ts";
  process.stdout.write(renderElsewhere(result.pin) + "\\n");`;

test("the print-cli guard bites: it flags concatenation, wrapper-plus-raw and a template literal, and accepts renderer calls", () => {
  assert.deepEqual(printCliViolations(CLEAN_SNIPPET), []);
  assert.notDeepEqual(printCliViolations(MUTANT_NOTE_BY_CONCATENATION), []);
  assert.notDeepEqual(printCliViolations(MUTANT_PIN_WRAPPER_PLUS_RAW), []);
  assert.notDeepEqual(printCliViolations(MUTANT_PIN_TEMPLATE), []);
  assert.notDeepEqual(printCliViolations(`${CLEAN_SNIPPET}\n  console.log(result.pin.channel);`), []);
  assert.notDeepEqual(printCliViolations(`${CLEAN_SNIPPET}\n  process.stderr.write(result.pin.channel);`), []);
});

test("a renderer defined inside the CLI module is rejected by the write guard", () => {
  const local = printCliViolations(MUTANT_LOCAL_RENDERER);
  assert.ok(local.some((v) => v.includes("renderLocalPin")), `expected the local renderer to be named; got ${JSON.stringify(local)}`);
  assert.notDeepEqual(printCliViolations(MUTANT_RENDERER_FROM_ELSEWHERE), []);
  // With no import from printer.ts at all, even the two real renderer names are not accepted.
  assert.notDeepEqual(printCliViolations(CLEAN_SNIPPET.replace(PRINTER_IMPORT, "")), []);
});

test("a comment, trailing or block, containing a backtick does not trip the write guard", () => {
  const withTrailing = CLEAN_SNIPPET.replace('process.stdout.write(result.stdout + "\\n");', 'process.stdout.write(result.stdout + "\\n"); // routed through `printEffectivePolicy`');
  assert.notEqual(withTrailing, CLEAN_SNIPPET, "self-test setup: the trailing comment was not inserted");
  assert.deepEqual(printCliViolations(withTrailing), []);
  assert.deepEqual(printCliViolations(`${CLEAN_SNIPPET}\n  /* a block comment naming \`renderPinLine\` */`), []);
  assert.deepEqual(printCliViolations(`${CLEAN_SNIPPET}\n  const link = "http://x"; // \`ok\``), []);
});

test("a real template literal still fails the write guard, including after a string that contains two slashes", () => {
  assert.notDeepEqual(printCliViolations(MUTANT_PIN_TEMPLATE), []);
  assert.notDeepEqual(printCliViolations(`${CLEAN_SNIPPET}\n  const link = "http://x"; const t = \`\${result.pin}\`;`), []);
  assert.notDeepEqual(printCliViolations(`${CLEAN_SNIPPET}\n  const t = \`x\`; // and a trailing comment`), []);
});

test("every failure message of the write guard names its unlock", () => {
  const all = [
    ...printCliViolations(MUTANT_NOTE_BY_CONCATENATION),
    ...printCliViolations(MUTANT_LOCAL_RENDERER),
    ...printCliViolations(MUTANT_PIN_TEMPLATE),
    ...printCliViolations(`${CLEAN_SNIPPET}\n  console.log(result.pin.channel);`),
    ...printCliViolations(`${CLEAN_SNIPPET}\n  process.stderr.write(result.pin.channel);`),
    ...printCliViolations("const x = 1;"),
  ];
  assert.ok(all.length >= 6, "self-test setup: expected at least one message per shape");
  for (const message of all) assert.match(message, /\bfix:/, `no unlock named in: ${message}`);
});

test("print-cli.ts writes only printer.ts renderer output or named PrinterResult fields, and uses both renderers", () => {
  const source = readFileSync(path.join(THIS_DIR, "print-cli.ts"), "utf8");
  assert.deepEqual(printCliViolations(source), [], "print-cli.ts builds a line of its own");
  assert.match(source, /renderPinLine\(result\.pin\)/, "print-cli.ts must render the pin line through printer.ts");
  assert.match(source, /renderInertMandatoryNote\(d\)/, "print-cli.ts must render the NOTE line through printer.ts");
});
