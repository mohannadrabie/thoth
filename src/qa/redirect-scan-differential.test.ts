// S7-A (Issues #304, #321, #324), A12 scanner-differential-equivalence. story-implementer's own test.
//
// Runs the differential instrument once and asserts (a) zero mismatches against the frozen old module, (b) the
// minimum corpus size per class, so the corpus cannot silently shrink, (c) that the instrument DETECTS a
// difference when handed a deliberately wrong candidate (an instrument that cannot fail proves nothing), and
// (d) that the oracle is self-contained: it imports nothing, is byte-pinned, and a regression inside the
// tokenizer core of the CURRENT module is reported (the Issue #324 gap). The counts printed by the instrument
// come from the run; the floors asserted here are independent arithmetic, not copies of the run's output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CURRENT_CANDIDATE,
  EXHAUSTIVE_MAX_LENGTH,
  PIECE_CASES,
  RANDOM_CASES,
  REDIRECT_FUNCTIONS,
  SCAN_ADAPTERS,
  SHAPE_SIZES,
  TRAILING_PREFIXES,
  TRAILING_RUN_LENGTHS,
  TRAILING_SUFFIXES,
  TRAILING_WHITESPACE_UNITS,
  WHOLE_EXHAUSTIVE_ALPHABET,
  WHOLE_EXHAUSTIVE_MAX_LENGTH,
  WHOLE_PIECE_CASES,
  WHOLE_RANDOM_CASES,
  compareOnInputs,
  exportedFunctionNames,
  fixtureCommands,
  functionCoverage,
  runDifferential,
  summarize,
} from "./redirect-scan-differential.ts";
import * as frozenScanner from "./frozen-shell-scanner-s7a-base.ts";
import { extractImportSpecifiers, stripComments } from "./kernel-purity-check.ts";
import { REDIRECT_SHAPE_NAMES } from "./redirect-shapes.ts";

const report = runDifferential();

function classNamed(prefix: string): (typeof report.classes)[number] {
  const found = report.classes.find((c) => c.name.startsWith(prefix));
  assert.ok(found !== undefined, `the report has no class ${prefix}`);
  return found;
}

test("A12 scanner-differential-equivalence: the current scanner matches the frozen old module on every corpus class, for every exported function (zero mismatches)", () => {
  const result = summarize(report);
  assert.equal(report.totalMismatches, 0, `${result.summary}\n${result.details.join("\n")}`);
  assert.equal(result.ok, true, `${result.summary}\n${result.details.join("\n")}`);
  console.log(`# ${result.summary}`);
  for (const line of result.details) console.log(`#   ${line}`);
});

test("A12 the corpus floors hold: closed-form exhaustive counts, random and piece minimums, fixtures enumerated, every shape at every size, every trailing-whitespace combination", () => {
  const closedForm = (alphabetSize: number, maxLength: number): number => {
    let n = 0;
    for (let k = 0; k <= maxLength; k++) n += alphabetSize ** k;
    return n;
  };
  assert.equal(classNamed("C1").cases, closedForm(8, EXHAUSTIVE_MAX_LENGTH), "C1 must cover every string up to the maximum length");
  assert.ok(classNamed("C2").cases >= 200_000 && classNamed("C2").cases === RANDOM_CASES, "C2 must run at least 200000 cases");
  assert.ok(PIECE_CASES >= 100_000 && classNamed("C5").cases === PIECE_CASES);
  const fixtures = fixtureCommands();
  assert.ok(fixtures.length >= 20, `the fixture enumeration found only ${fixtures.length} commands: the enumerator is blind`);
  assert.equal(classNamed("C3").cases, fixtures.length, "C3 must run every enumerated fixture command");
  assert.equal(classNamed("C4").cases, REDIRECT_SHAPE_NAMES.length * SHAPE_SIZES.length);
  assert.ok(Math.max(...SHAPE_SIZES) >= 4096, "the shape sweep reaches 4 KB");
  assert.equal(classNamed("W1").cases, closedForm(WHOLE_EXHAUSTIVE_ALPHABET.length, WHOLE_EXHAUSTIVE_MAX_LENGTH), "W1 must cover every string up to its maximum length");
  assert.ok(WHOLE_EXHAUSTIVE_ALPHABET.includes("\n") && WHOLE_EXHAUSTIVE_ALPHABET.includes(";") && WHOLE_EXHAUSTIVE_ALPHABET.includes("$"), "W1 reaches separator, chain and substitution shapes");
  assert.ok(WHOLE_RANDOM_CASES >= 60_000 && classNamed("W2").cases === WHOLE_RANDOM_CASES);
  assert.ok(WHOLE_PIECE_CASES >= 40_000 && classNamed("W3").cases === WHOLE_PIECE_CASES);
  assert.equal(classNamed("W4").cases, fixtures.length);
  assert.equal(classNamed("W5").cases, REDIRECT_SHAPE_NAMES.length * SHAPE_SIZES.length);
  const trailingCombinations = TRAILING_WHITESPACE_UNITS.length * TRAILING_PREFIXES.length * TRAILING_SUFFIXES.length * TRAILING_RUN_LENGTHS.length;
  assert.equal(classNamed("W6").cases, trailingCombinations, "W6 must run every trailing-whitespace combination");
  for (const unit of ["\n", "\r\n", "\t", " ", " \n\t"]) assert.ok(TRAILING_WHITESPACE_UNITS.includes(unit as never), `W6 covers the run kind ${JSON.stringify(unit)}`);
  assert.ok(TRAILING_SUFFIXES.some((s) => s.includes("&")) && TRAILING_PREFIXES.some((p) => p.includes("&")), "W6 has a sensitive separator after and before the run");
  assert.ok(Math.max(...TRAILING_RUN_LENGTHS) >= 1024, "W6 reaches long runs (the old scan is quadratic in them, so keep the corpus small but real)");
  for (const c of report.classes) assert.equal(c.functions, c.name.startsWith("C") ? REDIRECT_FUNCTIONS.length : Object.keys(SCAN_ADAPTERS).length, `${c.name}: functions per case`);
});

test("A12 every exported scanner function is compared: the adapter table equals the export enumeration of both modules, in both directions", () => {
  const coverage = functionCoverage();
  assert.deepEqual(coverage.uncovered, [], "an exported function without an adapter is not compared");
  assert.deepEqual(coverage.stale, [], "an adapter for a function nobody exports is a stale table entry");
  assert.deepEqual(coverage.surfaceDrift, [], "old and current modules must export the same functions");
  assert.deepEqual(Object.keys(SCAN_ADAPTERS).sort(), exportedFunctionNames(frozenScanner), "the adapter table lists exactly the frozen module's exported functions");
  assert.ok(coverage.currentExports.length >= 14, `the enumeration found only ${coverage.currentExports.length} functions: the enumerator is blind`);
  assert.deepEqual(Object.keys(CURRENT_CANDIDATE).sort(), coverage.currentExports, "the default candidate wires every exported function");
});

test("A12 a scanner function with no adapter fails the instrument (the enumeration is a gate, not a note)", () => {
  const synthetic = { ...report, coverage: { ...report.coverage, uncovered: ["someNewScanFunction"] } };
  const result = summarize(synthetic);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /COVERAGE: exported function someNewScanFunction has no adapter/);
});

test("A12 the instrument is not vacuous: candidates that differ from the old module are reported as mismatches", () => {
  const inputs = [...fixtureCommands(), ">a>b", "cmd >&w", "x 2>&1 >y", "echo a &\n b", "echo a\n\n\n", "a;b"];
  const wrong = (overrides: Record<string, (text: string) => unknown>) => ({ ...CURRENT_CANDIDATE, ...overrides });
  const all = Object.keys(SCAN_ADAPTERS);
  const cases: [string, Record<string, (text: string) => unknown>][] = [
    ["drops-last-target", { extractRedirectTargets: (t) => (CURRENT_CANDIDATE.extractRedirectTargets?.(t) as string[]).slice(0, -1) }],
    ["shifts-positions", { findLiveRedirectOperatorPositions: (t) => (CURRENT_CANDIDATE.findLiveRedirectOperatorPositions?.(t) as number[]).map((p) => p + 1) }],
    ["separator-never-found", { findLiveTrailingSensitiveSeparator: () => undefined }],
    ["tokenize-drops-last-token", { tokenize: (t) => (CURRENT_CANDIDATE.tokenize?.(t) as string[]).slice(0, -1) }],
    ["quote-states-flipped", { hasUnterminatedQuote: (t) => !(CURRENT_CANDIDATE.hasUnterminatedQuote?.(t) as boolean) }],
  ];
  for (const [label, overrides] of cases) {
    const result = compareOnInputs(label, inputs, all, wrong(overrides));
    assert.ok(result.mismatches > 0, `${label}: a wrong candidate must be caught`);
  }
  assert.equal(compareOnInputs("identical", inputs, all).mismatches, 0, "the real module matches on the same inputs");
});

// --- Issue #324: the oracle is independent of the module under test ---------------------------------

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FROZEN_PATH = join(HERE, "frozen-shell-scanner-s7a-base.ts");
const DIFFERENTIAL_PATH = join(HERE, "redirect-scan-differential.ts");
const CURRENT_SCANNER_PATH = join(HERE, "..", "policy", "normalizer", "shell-scanner.ts");

/** Byte hash of the frozen oracle with line endings normalized (a Windows checkout may convert them). */
const FROZEN_SHA256 = "3d406c8afa783f3c7eced75ae8346b04849c34215d1a4e47cb2c4290452ca37e";

test("frozen-oracle-is-unchanged: the frozen old module still hashes to the value pinned when it was taken from the S7-A base commit", () => {
  const bytes = readFileSync(FROZEN_PATH, "utf8").replaceAll("\r\n", "\n");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), FROZEN_SHA256, "the oracle must never change; if it did, restore it from the base commit rather than update the hash");
});

test("frozen-oracle-is-self-contained: the frozen module imports nothing, and the instrument takes nothing from the current scanner except the whole module it compares", () => {
  const frozenSource = readFileSync(FROZEN_PATH, "utf8");
  assert.deepEqual(extractImportSpecifiers(frozenSource), [], "the frozen oracle must have no import at all");
  assert.ok(!/\bimport\s*\(/.test(stripComments(frozenSource)), "the frozen oracle must have no dynamic import");

  const source = readFileSync(DIFFERENTIAL_PATH, "utf8");
  const specifiers = new Set(extractImportSpecifiers(source));
  assert.deepEqual(
    [...specifiers].sort(),
    ["../lib/instrument.ts", "../policy/fixtures/normalizer-calls.ts", "../policy/normalizer/shell-scanner.ts", "./frozen-shell-scanner-s7a-base.ts", "./redirect-shapes.ts", "node:url"].sort(),
    "the instrument's imports are exactly the compared module, the frozen module and non-scanner helpers",
  );
  const stripped = stripComments(source);
  // The current scanner is imported as one namespace (compared as a whole). No named import of a scanner helper may
  // appear: that is how the earlier oracle borrowed quoteStates, escapedChars and tokenize from the module under test.
  assert.match(stripped, /import \* as current from "\.\.\/policy\/normalizer\/shell-scanner\.ts";/);
  assert.ok(!/import\s*\{[^}]*\}\s*from\s*"\.\.\/policy\/normalizer\/shell-scanner\.ts"/.test(stripped), "no named import from the scanner under test");
  // The old side of every comparison is built from the frozen module only.
  assert.ok(stripped.includes("adapter(frozen, text)"), "the old side of a comparison is the frozen module");
});

test("frozen-oracle-is-self-contained: a regression inside the CURRENT tokenizer core is reported as mismatches (it cannot move the oracle)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s7a-mutated-scanner-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    const original = readFileSync(CURRENT_SCANNER_PATH, "utf8").replaceAll("\r\n", "\n");
    // Two mutations inside the shared tokenizer core (scanTokens): the escape branch and the value accumulation.
    const mutations: [string, string, string][] = [
      ["escape branch drops the escaped character", '      current += liveText[i + 1] ?? "";\n', '      current += "";\n'],
      ["token boundary keeps the whitespace", "    if (states[i] === \"none\" && /\\s/.test(ch)) {\n      if (inToken) {", "    if (states[i] === \"none\" && /\\s/.test(ch) && false) {\n      if (inToken) {"],
    ];
    const inputs = [...fixtureCommands(), "echo >a>b", "cmd >&w", "echo a\\ b c", "echo 'q r'>s", "a b c"];
    for (const [label, anchor, replacement] of mutations) {
      assert.ok(original.includes(anchor), `mutation "${label}" anchor not found in the current scanner: update this test`);
      const file = join(dir, "mutated-scanner.ts");
      writeFileSync(file, original.replace(anchor, replacement), "utf8");
      const mutated = (await import(`${pathToFileURL(file).href}?m=${encodeURIComponent(label)}`)) as typeof frozenScanner;
      const candidate = Object.fromEntries(Object.entries(SCAN_ADAPTERS).map(([name, adapter]) => [name, (text: string) => adapter(mutated, text)]));
      const result = compareOnInputs(label, inputs, Object.keys(SCAN_ADAPTERS), candidate);
      assert.ok(result.mismatches > 0, `a regression inside scanTokens ("${label}") must make the instrument report mismatches`);
    }
    const untouched = (await import(`${pathToFileURL(CURRENT_SCANNER_PATH).href}?m=control`)) as typeof frozenScanner;
    const control = Object.fromEntries(Object.entries(SCAN_ADAPTERS).map(([name, adapter]) => [name, (text: string) => adapter(untouched, text)]));
    assert.equal(compareOnInputs("control", inputs, Object.keys(SCAN_ADAPTERS), control).mismatches, 0, "the unmutated module reports none");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
