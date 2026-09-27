// S7-A (Issues #304, #321, #324): differential-equivalence instrument for the shell scanner rewrite.
//
// src/policy/normalizer/shell-scanner.ts was changed in two places whose outputs feed deny-rule decisions
// (a changed output is a silent deny-to-allow bypass): the redirect scan went from a per-match re-tokenization
// (quadratic) to one shared token index (linear), and the trailing-separator scan stopped re-walking a
// trailing whitespace run once per newline (quadratic, Issue #321). This instrument runs the CURRENT module
// against a FROZEN COPY OF THE WHOLE OLD MODULE (src/qa/frozen-shell-scanner-s7a-base.ts, taken from the S7-A
// base commit) over stated corpora and reports, per corpus class, how many cases ran, how many functions were
// compared per case and how many outputs differed. Every count is produced by running this file; none is typed
// anywhere.
//
// THE ORACLE IS SELF-CONTAINED (Issue #324): the frozen copy imports nothing, and this file imports from the
// module under test only the module itself (compared, never used to build the oracle). An earlier version built
// its oracle from the current module's own `quoteStates`, `escapedChars` and `tokenize`, so a regression in the
// rewritten tokenizer core moved oracle and subject together; that cannot happen here.
//
// EVERY EXPORTED FUNCTION IS COMPARED, and the set is enumerated from the two modules at run time: the
// instrument fails if either module exports a function that has no adapter here, or if an adapter names a
// function neither module exports. A function added to the scanner later therefore fails this instrument until
// it is covered.
//
// THE CLAIM THIS SUPPORTS: identical outputs on these corpora. It is not a proof over all strings.
//
// Corpus classes. C1 to C5 compare only the two redirect scans (the rewritten code paths) at large sizes; W1 to
// W6 compare EVERY exported function on smaller corpora (the wall-clock budget of `npm test` caps the sizes):
//   C1 exhaustive   every string of length 0 to EXHAUSTIVE_MAX_LENGTH over the alphabet
//                   > & backslash single-quote double-quote space a 1
//   C2 random       seeded, 1 to 80 characters over a wider character alphabet
//   C3 fixtures     every shell command string exported by src/policy/fixtures/normalizer-calls.ts,
//                   enumerated at run time
//   C4 shapes       each redirect-dense shape of src/qa/redirect-shapes.ts at sizes up to 4 KB (where the
//                   old scan still completes)
//   C5 pieces       seeded, 1 to 30 multi-character pieces (2>&1, >&, &>, >>, quoted spans, escapes, words)
//   W1 exhaustive   every string of length 0 to WHOLE_EXHAUSTIVE_MAX_LENGTH over a symbol set that includes
//                   newline, semicolon, dollar and parenthesis (chain, separator and substitution shapes)
//   W2 random       seeded, 1 to 60 characters over a wide alphabet (tab, CR, NBSP, non-ASCII, backtick, ...)
//   W3 pieces       seeded, 1 to 24 multi-character pieces (chain operators, substitution markers, heredocs, quotes)
//   W4 fixtures     the fixture commands again, through every function
//   W5 shapes       the redirect shapes again, through every function
//   W6 trailing     whitespace runs (space, tab, newline, CRLF, mixed) after a command, with and without a
//                   sensitive separator (`&`, newline, `;`) before or after them: the Issue #321 shapes
import { fileURLToPath } from "node:url";
import * as current from "../policy/normalizer/shell-scanner.ts";
import * as frozen from "./frozen-shell-scanner-s7a-base.ts";
import * as normalizerCalls from "../policy/fixtures/normalizer-calls.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";
import { REDIRECT_SHAPE_NAMES, buildRedirectShape } from "./redirect-shapes.ts";

// ---------------------------------------------------------------------------------------------------
// The functions under comparison.

/** What both modules offer. The current module's optional meter parameters are never passed here. */
type ScannerSurface = typeof frozen;
type Adapter = (module: ScannerSurface, text: string) => unknown;

/** One adapter per exported function of the scanner. Keyed by export name; the run-time enumeration below
 * checks this table against the real exports in both directions. */
export const SCAN_ADAPTERS: Readonly<Record<string, Adapter>> = {
  quoteStates: (m, t) => m.quoteStates(t),
  escapedChars: (m, t) => m.escapedChars(t),
  hasUnterminatedQuote: (m, t) => m.hasUnterminatedQuote(t),
  findLiveChainOperator: (m, t) => m.findLiveChainOperator(t),
  hasLiveChainOperator: (m, t) => m.hasLiveChainOperator(t),
  findLiveSubstitution: (m, t) => m.findLiveSubstitution(t),
  hasLiveSubstitution: (m, t) => m.hasLiveSubstitution(t),
  findLiveTrailingSensitiveSeparator: (m, t) => m.findLiveTrailingSensitiveSeparator(t),
  stripHeredocBodies: (m, t) => m.stripHeredocBodies(t),
  extractRedirectTargets: (m, t) => m.extractRedirectTargets(t),
  findLiveRedirectOperatorPositions: (m, t) => m.findLiveRedirectOperatorPositions(t),
  tokenizeWithOffsets: (m, t) => m.tokenizeWithOffsets(t),
  tokenize: (m, t) => m.tokenize(t),
  normalizeToolToken: (m, t) => m.normalizeToolToken(t),
};

/** The two scans the linear-scan rewrite touched first; C1 to C5 compare these at large corpus sizes. */
export const REDIRECT_FUNCTIONS: readonly string[] = ["extractRedirectTargets", "findLiveRedirectOperatorPositions"];

export function exportedFunctionNames(module: object): string[] {
  return Object.entries(module)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name)
    .sort();
}

export interface FunctionCoverage {
  /** Exported by the frozen (old) module. */
  frozenExports: string[];
  /** Exported by the current module. */
  currentExports: string[];
  /** Exported by either module but with no adapter here: not compared, so the instrument must fail. */
  uncovered: string[];
  /** An adapter for a name neither module exports: a stale table entry, so the instrument must fail. */
  stale: string[];
  /** Exported by only one of the two modules. */
  surfaceDrift: string[];
}

export function functionCoverage(): FunctionCoverage {
  const frozenExports = exportedFunctionNames(frozen);
  const currentExports = exportedFunctionNames(current);
  const adapters = Object.keys(SCAN_ADAPTERS).sort();
  const union = [...new Set([...frozenExports, ...currentExports])];
  return {
    frozenExports,
    currentExports,
    uncovered: union.filter((n) => !adapters.includes(n)).sort(),
    stale: adapters.filter((n) => !union.includes(n)),
    surfaceDrift: union.filter((n) => frozenExports.includes(n) !== currentExports.includes(n)).sort(),
  };
}

/** The candidate under test: by default the current module. Injectable so the instrument's own test can prove
 * it detects a difference (a deliberately wrong candidate). */
export type Candidate = Readonly<Record<string, (text: string) => unknown>>;

export const CURRENT_CANDIDATE: Candidate = Object.fromEntries(
  Object.entries(SCAN_ADAPTERS).map(([name, adapter]) => [name, (text: string) => adapter(current, text)]),
);

/** A stable string for deep equality of any scanner output (arrays, objects, primitives, undefined). */
function canonical(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

// ---------------------------------------------------------------------------------------------------
// Corpus generators. All deterministic.

/** mulberry32: a small seeded PRNG, so the random classes are reproducible run to run. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EXHAUSTIVE_ALPHABET = [">", "&", "\\", "'", '"', " ", "a", "1"] as const;
export const EXHAUSTIVE_MAX_LENGTH = 7;
/** Wider alphabet for C2; `>` and `&` and space appear more than once so redirects are common. */
const RANDOM_ALPHABET = [">", ">", ">", "&", "&", "\\", "'", '"', " ", " ", "a", "a", "1", "2", "\n", "\t", "|", ";", "<", "(", ")", "$", "`", "-"] as const;
const PIECES = ["2>&1", ">&", "&>", ">>", ">", "&", " ", " ", "a", "word", "1", "-", "\\>", "\\&", "\\ ", '"a b"', "'x y'", '"', "'", "\\", "2>", ">&2", ">& ", ">&-"] as const;
export const RANDOM_CASES = 200_000;
export const PIECE_CASES = 100_000;
export const SHAPE_SIZES = [64, 256, 1024, 4096] as const;
const SEED = 0x7a11;

export const WHOLE_EXHAUSTIVE_ALPHABET = [">", "&", "\\", "'", '"', " ", "\n", ";", "$", "(", "a"] as const;
export const WHOLE_EXHAUSTIVE_MAX_LENGTH = 5;
const WHOLE_RANDOM_ALPHABET = [">", "&", "&", "\\", "'", '"', " ", " ", "\n", "\n", "\t", "\r", "\u00a0", "\u2028", "é", "😀", "a", "b", "1", "-", "|", "|", ";", ";", "<", "(", ")", "$", "`", "{", "}", "\0"] as const;
const WHOLE_PIECES = ["&&", "||", ";", "|", "&", "\n", "\r\n", " ", "\t", "$(", "`", "<(", ">(", ")", "<<EOF", "<<-EOF", "<<<", "EOF", "\n", ">", ">>", "2>&1", ">&", "&>", "a", "word", "'", '"', '"a b"', "'x y'", "\\", "\\>", "\\&", "\\\n"] as const;
export const WHOLE_RANDOM_CASES = 60_000;
export const WHOLE_PIECE_CASES = 40_000;

function* exhaustiveOver(alphabet: readonly string[], maxLength: number): Generator<string> {
  const base = alphabet.length;
  for (let length = 0; length <= maxLength; length++) {
    const digits = new Array<number>(length).fill(0);
    for (;;) {
      yield digits.map((d) => alphabet[d]).join("");
      let pos = length - 1;
      while (pos >= 0 && digits[pos] === base - 1) {
        digits[pos] = 0;
        pos -= 1;
      }
      if (pos < 0) break;
      digits[pos] = (digits[pos] ?? 0) + 1;
    }
  }
}

function* randomOver(alphabet: readonly string[], seed: number, count: number, maxLength: number): Generator<string> {
  const rand = seededRandom(seed);
  for (let i = 0; i < count; i++) {
    const length = 1 + Math.floor(rand() * maxLength);
    let s = "";
    for (let k = 0; k < length; k++) s += alphabet[Math.floor(rand() * alphabet.length)];
    yield s;
  }
}

function* piecesOver(pieces: readonly string[], seed: number, count: number, maxPieces: number): Generator<string> {
  const rand = seededRandom(seed);
  for (let i = 0; i < count; i++) {
    const n = 1 + Math.floor(rand() * maxPieces);
    let s = "";
    for (let k = 0; k < n; k++) s += pieces[Math.floor(rand() * pieces.length)];
    yield s;
  }
}

/** Every shell command string exported by the normalizer fixtures, found by looking at the module's
 * exports at run time (an export whose value is an object with a string `command`). */
export function fixtureCommands(): string[] {
  const commands: string[] = [];
  for (const value of Object.values(normalizerCalls)) {
    if (typeof value === "object" && value !== null && typeof (value as { command?: unknown }).command === "string") {
      commands.push((value as { command: string }).command);
    }
  }
  return commands;
}

function* shapeStrings(): Generator<string> {
  for (const shape of REDIRECT_SHAPE_NAMES) for (const size of SHAPE_SIZES) yield buildRedirectShape(shape, size);
}

export const TRAILING_WHITESPACE_UNITS = [" ", "\t", "\n", "\r\n", " \n\t", "\n\n \n"] as const;
export const TRAILING_PREFIXES = ["", "echo hello", "echo hello &", "echo hello\n", "echo hello 2>&1", "echo 'a b'"] as const;
export const TRAILING_SUFFIXES = ["", "x", "&", "\n;", "a\n"] as const;
export const TRAILING_RUN_LENGTHS = [1, 2, 3, 7, 64, 256, 1024] as const;

/** Issue #321 shapes: prefix, then a whitespace run of one of several kinds and lengths, then a suffix that is
 * empty (the run reaches the end), live content, a separator, or content ending in a newline. */
function* trailingWhitespaceStrings(): Generator<string> {
  for (const unit of TRAILING_WHITESPACE_UNITS) {
    for (const prefix of TRAILING_PREFIXES) {
      for (const suffix of TRAILING_SUFFIXES) {
        for (const runs of TRAILING_RUN_LENGTHS) yield prefix + unit.repeat(runs) + suffix;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------

export interface ClassResult {
  name: string;
  cases: number;
  /** How many functions each case was run through. */
  functions: number;
  /** Cases with at least one differing function output. */
  mismatches: number;
  /** The first few mismatches, as printable text (empty when there are none). */
  examples: string[];
}

export interface DifferentialReport {
  classes: ClassResult[];
  totalCases: number;
  totalComparisons: number;
  totalMismatches: number;
  coverage: FunctionCoverage;
}

function shown(input: string): string {
  return input.length > 200 ? `${JSON.stringify(input.slice(0, 200))}... (${input.length} characters)` : JSON.stringify(input);
}

/** Compares the candidate with the frozen old module over the given inputs (one corpus class), running every
 * function named in `functionNames` on every input. */
export function compareOnInputs(name: string, inputs: Iterable<string>, functionNames: readonly string[] = Object.keys(SCAN_ADAPTERS), candidate: Candidate = CURRENT_CANDIDATE): ClassResult {
  const pairs = functionNames.map((fn) => {
    const adapter = SCAN_ADAPTERS[fn];
    const candidateFn = candidate[fn];
    if (adapter === undefined || candidateFn === undefined) throw new Error(`redirect-scan-differential: no adapter or candidate for function ${fn}`);
    return { fn, oldFn: (text: string): unknown => adapter(frozen, text), newFn: candidateFn };
  });
  let cases = 0;
  let mismatches = 0;
  const examples: string[] = [];
  for (const input of inputs) {
    cases += 1;
    let differs = false;
    for (const { fn, oldFn, newFn } of pairs) {
      const oldOut = canonical(oldFn(input));
      const newOut = canonical(newFn(input));
      if (oldOut === newOut) continue;
      if (!differs && examples.length < 3) examples.push(`${fn}(${shown(input)}): old ${oldOut.slice(0, 160)}; new ${newOut.slice(0, 160)}`);
      differs = true;
    }
    if (differs) mismatches += 1;
  }
  return { name, cases, functions: pairs.length, mismatches, examples };
}

/** Runs every corpus class and returns the per-class counts. */
export function runDifferential(candidate: Candidate = CURRENT_CANDIDATE): DifferentialReport {
  const all = Object.keys(SCAN_ADAPTERS);
  const fixtures = fixtureCommands();
  const classes = [
    compareOnInputs(`C1 exhaustive (every string of length 0 to ${EXHAUSTIVE_MAX_LENGTH} over ${EXHAUSTIVE_ALPHABET.length} symbols; redirect scans)`, exhaustiveOver(EXHAUSTIVE_ALPHABET, EXHAUSTIVE_MAX_LENGTH), REDIRECT_FUNCTIONS, candidate),
    compareOnInputs(`C2 seeded random (1 to 80 characters over a ${RANDOM_ALPHABET.length}-entry alphabet; redirect scans)`, randomOver(RANDOM_ALPHABET, SEED, RANDOM_CASES, 80), REDIRECT_FUNCTIONS, candidate),
    compareOnInputs("C3 fixture commands (enumerated from the normalizer fixture module at run time; redirect scans)", fixtures, REDIRECT_FUNCTIONS, candidate),
    compareOnInputs(`C4 shape sweeps (${REDIRECT_SHAPE_NAMES.length} shapes at ${SHAPE_SIZES.join(", ")} characters; redirect scans)`, shapeStrings(), REDIRECT_FUNCTIONS, candidate),
    compareOnInputs("C5 seeded pieces (1 to 30 multi-character redirect and quoting pieces; redirect scans)", piecesOver(PIECES, SEED ^ 0x5bd1e995, PIECE_CASES, 30), REDIRECT_FUNCTIONS, candidate),
    compareOnInputs(`W1 exhaustive (every string of length 0 to ${WHOLE_EXHAUSTIVE_MAX_LENGTH} over ${WHOLE_EXHAUSTIVE_ALPHABET.length} symbols)`, exhaustiveOver(WHOLE_EXHAUSTIVE_ALPHABET, WHOLE_EXHAUSTIVE_MAX_LENGTH), all, candidate),
    compareOnInputs(`W2 seeded random (1 to 60 characters over a ${WHOLE_RANDOM_ALPHABET.length}-entry alphabet incl. tab, CR, NBSP, U+2028, non-ASCII, NUL)`, randomOver(WHOLE_RANDOM_ALPHABET, SEED ^ 0x1b873593, WHOLE_RANDOM_CASES, 60), all, candidate),
    compareOnInputs(`W3 seeded pieces (1 to 24 of ${WHOLE_PIECES.length} chain, substitution, heredoc, quote and redirect pieces)`, piecesOver(WHOLE_PIECES, SEED ^ 0xcc9e2d51, WHOLE_PIECE_CASES, 24), all, candidate),
    compareOnInputs("W4 fixture commands (every function)", fixtures, all, candidate),
    compareOnInputs(`W5 shape sweeps (${REDIRECT_SHAPE_NAMES.length} shapes at ${SHAPE_SIZES.join(", ")} characters; every function)`, shapeStrings(), all, candidate),
    compareOnInputs(`W6 trailing whitespace (${TRAILING_WHITESPACE_UNITS.length} run kinds x ${TRAILING_PREFIXES.length} prefixes x ${TRAILING_SUFFIXES.length} suffixes x ${TRAILING_RUN_LENGTHS.length} run lengths, up to ${Math.max(...TRAILING_RUN_LENGTHS)} repeats; every function)`, trailingWhitespaceStrings(), all, candidate),
  ];
  return {
    classes,
    totalCases: classes.reduce((n, c) => n + c.cases, 0),
    totalComparisons: classes.reduce((n, c) => n + c.cases * c.functions, 0),
    totalMismatches: classes.reduce((n, c) => n + c.mismatches, 0),
    coverage: functionCoverage(),
  };
}

export function summarize(report: DifferentialReport): InstrumentResult {
  const details = report.classes.map((c) => `${c.name}: ${c.cases} cases x ${c.functions} function(s), ${c.mismatches} mismatches`);
  for (const c of report.classes) for (const e of c.examples) details.push(`MISMATCH in ${c.name}: ${e}`);
  const { coverage } = report;
  details.push(`functions compared (enumerated from the module exports at run time): ${coverage.currentExports.join(", ")}`);
  const scope = "identical outputs on these corpora (not a proof over all strings)";
  const coverageProblems = [
    ...coverage.uncovered.map((n) => `exported function ${n} has no adapter, so it is NOT compared`),
    ...coverage.stale.map((n) => `adapter ${n} names a function neither module exports`),
    ...coverage.surfaceDrift.map((n) => `function ${n} is exported by only one of the old and current modules`),
  ];
  for (const problem of coverageProblems) details.push(`COVERAGE: ${problem}`);
  if (report.totalMismatches !== 0 || coverageProblems.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `scanner differential: ${report.totalMismatches} of ${report.totalCases} cases differ from the frozen old module; ${coverageProblems.length} coverage problem(s).`,
      details,
    };
  }
  return {
    ok: true,
    vacuous: report.totalCases === 0,
    summary: `scanner differential: ${report.totalCases} cases, ${report.totalComparisons} function comparisons over ${coverage.currentExports.length} exported functions, 0 mismatches: ${scope}.`,
    details,
  };
}

function main(): void {
  const result = summarize(runDifferential());
  printInstrumentResult("S7-A redirect-scan-differential", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
