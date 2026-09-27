// S7-A fix-now round 1 (Issue #321 sweep): an instrument that MEASURES every exported function of the shell
// scanner and the shell normalizer against large inputs of every operator and whitespace shape enumerated from
// the scanner source, and fails when any of them is not comfortably linear. It exists because the plan called the
// separator scan linear from a code read, and it was not (a benign 64 KB command ending in blank lines never
// returned through the real hook): a "no other quadratic scan" claim needs a running instrument, not a reading.
//
// WHAT IT MEASURES: in-process wall time of one call per (function, shape, size), at 16, 64 and 128 KB, ascending;
// a call that exceeds BOUND_MS fails that (function, shape) and the larger sizes are skipped. The bound is
// absolute, not a ratio: linear scans finish in single-digit milliseconds at 128 KB, the quadratic ones in this
// file's history took seconds at 16 KB (2098 ms for the separator scan, 7062 ms for the old redirect scan) and
// minutes at 128 KB, so a bound of 1000 ms has two orders of magnitude of headroom against machine load and still
// catches every superlinear shape that matters at these sizes. The deterministic work meter
// (src/policy/normalizer/shell-scanner-work.test.ts) is the primary proof of linearity for the three metered
// scans; this sweep is the breadth check across every function.
//
// WHAT IS ENUMERATED, AND HOW: the function list comes from the two modules' exports at run time and must equal
// the adapter table in both directions (a function added later fails the sweep until it has an adapter). The
// operator tokens come from the scanner source: the CHAIN_OPERATORS and SUBSTITUTION_MARKERS tables are parsed out
// of shell-scanner.ts, so a new operator is swept automatically, plus the redirect, heredoc, quote and escape
// forms the scanner's regular expressions name. Whitespace kinds are the characters the scanner's `\s` tests see.
//
// THE CLAIM THIS SUPPORTS: no listed function exceeded the bound on the listed shapes at the listed sizes. It is
// not a proof over all inputs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as scanner from "../policy/normalizer/shell-scanner.ts";
import * as shell from "../policy/normalizer/shell.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";
import { exportedFunctionNames } from "./redirect-scan-differential.ts";

export const SWEEP_SIZES = [16 * 1024, 64 * 1024, 128 * 1024] as const;
export const BOUND_MS = 1000;

export type SweepAdapter = (text: string) => unknown;

/** One adapter per exported function of the two modules; keyed `<module>.<export>`. */
export const SWEEP_ADAPTERS: Readonly<Record<string, SweepAdapter>> = {
  "shell-scanner.quoteStates": (t) => scanner.quoteStates(t),
  "shell-scanner.escapedChars": (t) => scanner.escapedChars(t),
  "shell-scanner.hasUnterminatedQuote": (t) => scanner.hasUnterminatedQuote(t),
  "shell-scanner.findLiveChainOperator": (t) => scanner.findLiveChainOperator(t),
  "shell-scanner.hasLiveChainOperator": (t) => scanner.hasLiveChainOperator(t),
  "shell-scanner.findLiveSubstitution": (t) => scanner.findLiveSubstitution(t),
  "shell-scanner.hasLiveSubstitution": (t) => scanner.hasLiveSubstitution(t),
  "shell-scanner.findLiveTrailingSensitiveSeparator": (t) => scanner.findLiveTrailingSensitiveSeparator(t),
  "shell-scanner.stripHeredocBodies": (t) => scanner.stripHeredocBodies(t),
  "shell-scanner.extractRedirectTargets": (t) => scanner.extractRedirectTargets(t),
  "shell-scanner.findLiveRedirectOperatorPositions": (t) => scanner.findLiveRedirectOperatorPositions(t),
  "shell-scanner.tokenizeWithOffsets": (t) => scanner.tokenizeWithOffsets(t),
  "shell-scanner.tokenize": (t) => scanner.tokenize(t),
  "shell-scanner.normalizeToolToken": (t) => scanner.normalizeToolToken(t),
  "shell.normalizeShellCall": (t) => shell.normalizeShellCall({ command: t, environment: "sweep-env", identity: "sweep-id" }),
};

export interface SweepCoverage {
  exported: string[];
  uncovered: string[];
  stale: string[];
}

export function sweepCoverage(): SweepCoverage {
  const exported = [...exportedFunctionNames(scanner).map((n) => `shell-scanner.${n}`), ...exportedFunctionNames(shell).map((n) => `shell.${n}`)].sort();
  const adapters = Object.keys(SWEEP_ADAPTERS);
  return { exported, uncovered: exported.filter((n) => !adapters.includes(n)), stale: adapters.filter((n) => !exported.includes(n)).sort() };
}

// ---------------------------------------------------------------------------------------------------
// Shapes.

const SCANNER_SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "policy", "normalizer", "shell-scanner.ts");

/** The string literals of `const <NAME> = [ ... ] as const;` in the scanner source (the operator tables). */
export function tableFromScannerSource(name: string, source: string = readFileSync(SCANNER_SOURCE_PATH, "utf8")): string[] {
  const match = new RegExp(String.raw`const ${name}\s*=\s*\[([^\]]*)\]\s*as const`).exec(source);
  if (match === null) throw new Error(`gate-path-scaling-sweep: the table ${name} was not found in shell-scanner.ts: the sweep's enumeration is blind`);
  return [...(match[1] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1] ?? ""}"`) as string);
}

/** Forms the scanner's regular expressions and quote walk name, beyond its two operator tables. */
const EXTRA_TOKENS = [">", ">>", ">&", "&>", "2>&1", "<<EOF", "<<-EOF", "<<<", "&", "\n", "'", '"', "\\", "$", "\\>", "\\&"] as const;
/** The characters the scanner's whitespace test (`\s`) treats as whitespace, in the runs that matter. */
export const WHITESPACE_KINDS = [" ", "\t", "\n", "\r\n", " \n\t", "\n\n \n", "\u00a0", "\u2028"] as const;
const SEPARATOR_WHITESPACE = ["\n", "\r\n", " \n\t"] as const;

export function operatorTokens(): string[] {
  const source = readFileSync(SCANNER_SOURCE_PATH, "utf8");
  return [...new Set([...tableFromScannerSource("CHAIN_OPERATORS", source), ...tableFromScannerSource("SUBSTITUTION_MARKERS", source), ...EXTRA_TOKENS])];
}

export interface Shape {
  name: string;
  build(minLength: number): string;
}

function repeated(head: string, unit: string, minLength: number): string {
  return head + unit.repeat(Math.max(1, Math.ceil((minLength - head.length) / unit.length)));
}

const show = (s: string): string => JSON.stringify(s);

export function buildShapes(tokens: readonly string[] = operatorTokens()): Shape[] {
  const shapes: Shape[] = [];
  for (const w of WHITESPACE_KINDS) {
    shapes.push({ name: `whitespace-only ${show(w)}`, build: (n) => repeated("", w, n) });
    shapes.push({ name: `command then trailing whitespace ${show(w)}`, build: (n) => repeated("echo hello", w, n) });
  }
  for (const t of tokens) {
    shapes.push({ name: `token run ${show(t)}`, build: (n) => repeated("", t, n) });
    shapes.push({ name: `command then spaced token run ${show(t)}`, build: (n) => repeated("echo hello", ` ${t}`, n) });
    shapes.push({ name: `token then newline run ${show(t)}`, build: (n) => repeated("echo hello ", `${t}\n`, n) });
    for (const w of SEPARATOR_WHITESPACE) {
      shapes.push({ name: `command, token ${show(t)}, then trailing whitespace ${show(w)}`, build: (n) => repeated(`echo hello ${t}`, w, n) });
    }
  }
  return shapes;
}

// ---------------------------------------------------------------------------------------------------

export interface SweepFailure {
  fn: string;
  shape: string;
  size: number;
  ms: number;
}

export interface FunctionSweep {
  fn: string;
  calls: number;
  maxMs: number;
  worstShape: string;
}

export interface SweepReport {
  functions: FunctionSweep[];
  failures: SweepFailure[];
  shapes: number;
  sizes: readonly number[];
  boundMs: number;
  coverage: SweepCoverage;
  calls: number;
}

export function runSweep(adapters: Readonly<Record<string, SweepAdapter>> = SWEEP_ADAPTERS, boundMs: number = BOUND_MS, sizes: readonly number[] = SWEEP_SIZES, shapes: readonly Shape[] = buildShapes()): SweepReport {
  const failures: SweepFailure[] = [];
  const sweeps = new Map<string, FunctionSweep>(Object.keys(adapters).map((fn) => [fn, { fn, calls: 0, maxMs: 0, worstShape: "" }]));
  let calls = 0;
  for (const shape of shapes) {
    const failed = new Set<string>(); // functions already over the bound on this shape: their larger sizes are skipped
    for (const size of sizes) {
      const text = shape.build(size); // built once per (shape, size), shared by every function
      for (const [fn, adapter] of Object.entries(adapters)) {
        const sweep = sweeps.get(fn);
        if (sweep === undefined || failed.has(fn)) continue;
        const start = performance.now();
        adapter(text);
        const ms = performance.now() - start;
        sweep.calls += 1;
        calls += 1;
        if (ms > sweep.maxMs) {
          sweep.maxMs = ms;
          sweep.worstShape = `${shape.name} at ${text.length} characters`;
        }
        if (ms > boundMs) {
          failures.push({ fn, shape: shape.name, size: text.length, ms });
          failed.add(fn);
        }
      }
    }
  }
  return { functions: [...sweeps.values()], failures, shapes: shapes.length, sizes, boundMs, coverage: sweepCoverage(), calls };
}

export function summarizeSweep(report: SweepReport): InstrumentResult {
  const details = report.functions.map((f) => `${f.fn}: ${f.calls} call(s), slowest ${f.maxMs.toFixed(1)} ms (${f.worstShape})`);
  for (const f of report.failures) details.push(`OVER BOUND: ${f.fn} on ${f.shape} at ${f.size} characters took ${f.ms.toFixed(0)} ms (bound ${report.boundMs} ms)`);
  for (const n of report.coverage.uncovered) details.push(`COVERAGE: exported function ${n} has no sweep adapter, so it was NOT measured`);
  for (const n of report.coverage.stale) details.push(`COVERAGE: sweep adapter ${n} names a function nobody exports`);
  const problems = report.failures.length + report.coverage.uncovered.length + report.coverage.stale.length;
  const sizesKb = report.sizes.map((s) => `${s / 1024}`).join(", ");
  if (problems > 0) {
    return { ok: false, vacuous: false, summary: `gate-path scaling sweep: ${report.failures.length} call(s) over the ${report.boundMs} ms bound, ${report.coverage.uncovered.length + report.coverage.stale.length} coverage problem(s).`, details };
  }
  return {
    ok: true,
    vacuous: report.calls === 0,
    summary: `gate-path scaling sweep: ${report.functions.length} exported functions x ${report.shapes} shapes x ${report.sizes.length} sizes (${sizesKb} KB), ${report.calls} calls, none over the ${report.boundMs} ms bound.`,
    details,
  };
}

function main(): void {
  const result = summarizeSweep(runSweep());
  printInstrumentResult("S7-A gate-path-scaling-sweep", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
