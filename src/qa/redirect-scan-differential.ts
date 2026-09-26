// S7-A (Issue #304): differential-equivalence instrument for the linear redirect scan.
//
// The redirect scan in src/policy/normalizer/shell-scanner.ts was rewritten from a per-match
// re-tokenization (quadratic) to one shared token index (linear). Its two outputs feed deny-rule
// write-target detection, so a changed output is a silent deny-to-allow bypass. This instrument runs the
// CURRENT `extractRedirectTargets` and `findLiveRedirectOperatorPositions` against a FROZEN COPY of the
// OLD implementation over a stated corpus and reports, per corpus class, how many cases ran and how many
// outputs differed. Every count is produced by running this file; none is typed anywhere.
//
// THE CLAIM THIS SUPPORTS: identical outputs on this corpus. It is not a proof over all strings.
//
// Corpus classes:
//   C1 exhaustive   every string of length 0 to EXHAUSTIVE_MAX_LENGTH over the alphabet
//                   > & backslash single-quote double-quote space a 1
//   C2 random       seeded, 1 to 80 characters over a wider character alphabet
//   C3 fixtures     every shell command string exported by src/policy/fixtures/normalizer-calls.ts,
//                   enumerated at run time
//   C4 shapes       each redirect-dense shape of src/qa/redirect-shapes.ts at sizes up to 4 KB (where the
//                   old scan still completes)
//   C5 pieces       seeded, 1 to 30 multi-character pieces (2>&1, >&, &>, >>, quoted spans, escapes, words)
//
// The frozen copy below was taken from the S7-A base commit. It is a TEST ORACLE and is never changed: it
// is built only from the scanner's exported `quoteStates`, `escapedChars` and `tokenize`, which the rewrite
// left untouched.
import { fileURLToPath } from "node:url";
import { escapedChars, extractRedirectTargets, findLiveRedirectOperatorPositions, quoteStates, tokenize } from "../policy/normalizer/shell-scanner.ts";
import * as normalizerCalls from "../policy/fixtures/normalizer-calls.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";
import { REDIRECT_SHAPE_NAMES, buildRedirectShape } from "./redirect-shapes.ts";

// ---------------------------------------------------------------------------------------------------
// FROZEN ORACLE: the old scan, verbatim in behavior (test oracle, frozen at the S7-A base commit, never
// changed). Do not "improve" it: its only job is to be the old answer.

interface OldMatch {
  idx: number;
  length: number;
  tokenStart: number;
}

function oldFindLiveRedirectMatches(liveText: string): OldMatch[] {
  const states = quoteStates(liveText);
  const escaped = escapedChars(liveText);
  const re = />{1,2}/g;
  const matches: OldMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(liveText)) !== null) {
    const idx = m.index;
    if (states[idx] !== "none") continue;
    if (escaped[idx]) {
      re.lastIndex = idx + 1;
      continue;
    }
    const length = m[0].length;
    const precededByLiveAmpersand = idx > 0 && liveText[idx - 1] === "&" && states[idx - 1] === "none" && !escaped[idx - 1];
    if (liveText[idx + length] === "&") {
      const [fdWord] = tokenize(liveText.slice(idx + length + 1));
      const isFdDup = fdWord !== undefined && (fdWord.startsWith("-") || /^\d+$/.test(fdWord));
      if (isFdDup) continue;
      matches.push({ idx, length: length + 1, tokenStart: precededByLiveAmpersand ? idx - 1 : idx });
      continue;
    }
    matches.push({ idx, length, tokenStart: precededByLiveAmpersand ? idx - 1 : idx });
  }
  return matches;
}

function oldExtractRedirectTargets(liveText: string): string[] {
  const targets: string[] = [];
  for (const { idx, length } of oldFindLiveRedirectMatches(liveText)) {
    const rest = liveText.slice(idx + length);
    const [target] = tokenize(rest);
    if (target) targets.push(target);
  }
  return targets;
}

function oldFindLiveRedirectOperatorPositions(liveText: string): number[] {
  return oldFindLiveRedirectMatches(liveText).map((m) => m.tokenStart);
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

function* exhaustive(): Generator<string> {
  const base = EXHAUSTIVE_ALPHABET.length;
  for (let length = 0; length <= EXHAUSTIVE_MAX_LENGTH; length++) {
    const digits = new Array<number>(length).fill(0);
    for (;;) {
      yield digits.map((d) => EXHAUSTIVE_ALPHABET[d]).join("");
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

function* randomStrings(): Generator<string> {
  const rand = seededRandom(SEED);
  for (let i = 0; i < RANDOM_CASES; i++) {
    const length = 1 + Math.floor(rand() * 80);
    let s = "";
    for (let k = 0; k < length; k++) s += RANDOM_ALPHABET[Math.floor(rand() * RANDOM_ALPHABET.length)];
    yield s;
  }
}

function* pieceStrings(): Generator<string> {
  const rand = seededRandom(SEED ^ 0x5bd1e995);
  for (let i = 0; i < PIECE_CASES; i++) {
    const count = 1 + Math.floor(rand() * 30);
    let s = "";
    for (let k = 0; k < count; k++) s += PIECES[Math.floor(rand() * PIECES.length)];
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

// ---------------------------------------------------------------------------------------------------

export interface ClassResult {
  name: string;
  cases: number;
  mismatches: number;
  /** The first few mismatches, as printable text (empty when there are none). */
  examples: string[];
}

export interface DifferentialReport {
  classes: ClassResult[];
  totalCases: number;
  totalMismatches: number;
}

function sameList(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The two functions under comparison. Injectable so the instrument's own test can prove it detects a difference. */
export interface ScanCandidate {
  extract(text: string): string[];
  positions(text: string): number[];
}

const CURRENT_SCAN: ScanCandidate = {
  extract: (text) => extractRedirectTargets(text),
  positions: (text) => findLiveRedirectOperatorPositions(text),
};

/** Compares the candidate with the frozen old scan over the given inputs (one corpus class). */
export function compareOnInputs(name: string, inputs: Iterable<string>, candidate: ScanCandidate = CURRENT_SCAN): ClassResult {
  let cases = 0;
  let mismatches = 0;
  const examples: string[] = [];
  for (const input of inputs) {
    cases += 1;
    const oldTargets = oldExtractRedirectTargets(input);
    const newTargets = candidate.extract(input);
    const oldPositions = oldFindLiveRedirectOperatorPositions(input);
    const newPositions = candidate.positions(input);
    if (sameList(oldTargets, newTargets) && sameList(oldPositions, newPositions)) continue;
    mismatches += 1;
    if (examples.length < 3) {
      const shown = input.length > 200 ? `${JSON.stringify(input.slice(0, 200))}... (${input.length} characters)` : JSON.stringify(input);
      examples.push(`${shown}: old targets ${JSON.stringify(oldTargets).slice(0, 200)} positions ${JSON.stringify(oldPositions).slice(0, 100)}; new targets ${JSON.stringify(newTargets).slice(0, 200)} positions ${JSON.stringify(newPositions).slice(0, 100)}`);
    }
  }
  return { name, cases, mismatches, examples };
}

/** Runs every corpus class and returns the per-class counts. */
export function runDifferential(candidate: ScanCandidate = CURRENT_SCAN): DifferentialReport {
  const classes = [
    compareOnInputs(`C1 exhaustive (every string of length 0 to ${EXHAUSTIVE_MAX_LENGTH} over ${EXHAUSTIVE_ALPHABET.length} symbols)`, exhaustive(), candidate),
    compareOnInputs("C2 seeded random (1 to 80 characters over a 24-entry alphabet)", randomStrings(), candidate),
    compareOnInputs("C3 fixture commands (enumerated from the normalizer fixture module at run time)", fixtureCommands(), candidate),
    compareOnInputs(`C4 shape sweeps (${REDIRECT_SHAPE_NAMES.length} shapes at ${SHAPE_SIZES.join(", ")} characters)`, shapeStrings(), candidate),
    compareOnInputs("C5 seeded pieces (1 to 30 multi-character redirect and quoting pieces)", pieceStrings(), candidate),
  ];
  return {
    classes,
    totalCases: classes.reduce((n, c) => n + c.cases, 0),
    totalMismatches: classes.reduce((n, c) => n + c.mismatches, 0),
  };
}

export function summarize(report: DifferentialReport): InstrumentResult {
  const details = report.classes.map((c) => `${c.name}: ${c.cases} cases, ${c.mismatches} mismatches`);
  for (const c of report.classes) for (const e of c.examples) details.push(`MISMATCH in ${c.name}: ${e}`);
  const scope = "identical outputs on this corpus (not a proof over all strings)";
  return report.totalMismatches === 0
    ? { ok: true, vacuous: report.totalCases === 0, summary: `redirect scan differential: ${report.totalCases} cases, 0 mismatches: ${scope}.`, details }
    : { ok: false, vacuous: false, summary: `redirect scan differential: ${report.totalMismatches} of ${report.totalCases} cases differ from the frozen old scan.`, details };
}

function main(): void {
  const result = summarize(runDifferential());
  printInstrumentResult("S7-A redirect-scan-differential", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
