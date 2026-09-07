// OPS-03 (REQUIREMENTS.md:585, P0): "Each gate shall have a stated latency budget and meet it on
// the largest realistic input... Measured, regression-tested." Read together with SUR-12
// (REQUIREMENTS.md:468) per the "far below" relationship both requirements' own text specifies,
// NOT one derived figure — the council's split-budget model (docs/decisions.md, 2026-09-06 "council
// convened on S5" row; `/maat:council` GO on Path B) is the direct, structural fix for the T11
// methodology defect (Issue #86): a single measured number cannot serve both SUR-12's safety-
// ceiling role (`.claude/settings.json`'s fixed, disclosed `"timeout": 60`, see
// hooks/pretooluse-kernel-gate.mjs's own header comment) and OPS-03's fast-feedback role (THIS
// file). The two are never derived from each other anywhere in this codebase.
//
// This instrument's ONLY job: catch drift in the gate's real-world performance. An overrun here is
// a CI-10 incident (REQUIREMENTS.md:468's own text: "a timeout occurrence is an incident under
// CI-10, not a routine event" — read correctly, "timeout" in that sentence means THIS budget
// crossing, not the enforcement ceiling firing) — a red build, a human investigates. It never
// bounds security exposure and is never wired to change the enforcement `"timeout": 60` value.
//
// METHODOLOGY (unchanged from v2's own spike, per S5 plan v3 section 5.B):
//   1. Corpus: a representative slice of S4's own shell fixture/mutation corpus
//      (src/policy/fixtures/normalizer-calls.ts) covering worst-case shapes actually built —
//      depth-cap-5 wrapper nesting, multi-target/multi-redirect commands, chain/substitution
//      denials, and a clean allow — plus explicit long/complex constructions.
//   2. Real measurement: `spawnSync` of the REAL, shipped `node hooks/pretooluse-kernel-gate.mjs`
//      invocation, through the ACTUAL shipped entry shape (`shell: true` — a bare command string
//      through a real shell layer, exactly as `.claude/settings.json`'s own `command`-type hook
//      entries are invoked), each call a fresh cold process, timed via `process.hrtime.bigint()`
//      wrapped around each individual call. Never in-process function timing (that would silently
//      reintroduce the exact one-number-collapse the council ruled structural).
//
// SPIKE RESULT (this session, `docs/spikes/T11-ops03-latency-budget-2026-09-06.md` has the full
// raw run): measured on this repo's own Windows dev machine (this session's only available target
// machine — CI itself runs on `ubuntu-latest`, see .github/workflows/ci.yml; disclosed, not
// glossed over), shell-form (`spawnSync(..., { shell: true })`, i.e. cmd.exe on this platform),
// N=50 across 5 representative corpus commands (10 iterations each): min=109.76ms, p50=117.56ms,
// p95=133.08ms, p99=133.59ms, max=133.74ms.
//
// DECLARED OPS-03 CEILING: 2000ms (2 seconds) — the top of architecture-reviewer's council-seat
// guidance band ("on the order of 1-2 seconds"), chosen deliberately generous (≈15x the measured
// p99) specifically to absorb reasonable cross-machine/cross-platform variance (this spike's own
// Windows dev-machine measurement vs. CI's Linux runner, which this session has no way to measure
// directly) WITHOUT weakening the check's real job: catching an order-of-magnitude regression
// (e.g. a future normalizer change that makes a single call take seconds) still fails loudly long
// before it would ever approach the SEPARATE, unrelated 60s enforcement ceiling. Recorded once
// here and in docs/decisions.md's S5 build-time row, per this file's own convention — never
// re-derived from, or checked against, criterion 8's fixed 60s value.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";
import {
  shellAtHeredocMultiCommandCall,
  shellDepthCapExactCall,
  shellEquivalentDeleteCall,
  shellMultiTargetTwoRedirectsCall,
} from "../policy/fixtures/normalizer-calls.ts";

export const OPS03_CEILING_MS = 2000;

export interface LatencyPercentiles {
  iterations: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

/** Injectable single-call timer — returns elapsed milliseconds for one cold-process invocation.
 * Separated from `measureLatency` below so this is unit-testable against a fake, fast timer
 * without actually spawning 50+ real subprocesses in every `npm test` run (that real spawning
 * happens only in `main()`, and in this file's own "real spike" self-test, both against the real
 * shipped script). */
export type CallTimer = (scriptPath: string, stdinPayload: string) => number;

export const REAL_SHELL_FORM_TIMER: CallTimer = (scriptPath, stdinPayload) => {
  const command = `node "${scriptPath}"`;
  const start = process.hrtime.bigint();
  spawnSync(command, {
    input: stdinPayload,
    encoding: "utf8",
    shell: true,
    windowsHide: true,
    timeout: 30_000,
  });
  const end = process.hrtime.bigint();
  return Number(end - start) / 1e6;
};

/** Pure percentile computation over a raw timings array — no I/O, independently testable. */
export function computePercentiles(timingsMs: readonly number[]): LatencyPercentiles {
  if (timingsMs.length === 0) {
    return { iterations: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...timingsMs].sort((a, b) => a - b);
  const pct = (p: number): number => {
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx] ?? 0;
  };
  return {
    iterations: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
  };
}

function buildStdin(command: string): string {
  return JSON.stringify({
    session_id: "gate-latency-budget-check",
    transcript_path: "gate-latency-budget-check-transcript",
    cwd: process.cwd(),
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "gate-latency-budget-check-tool-use",
  });
}

/** The corpus: a representative slice of S4's own shell fixture/mutation corpus, covering the
 * worst-case shapes this component actually builds (depth-cap-5 nesting, multi-redirect,
 * multi-command heredoc, plus one clean allow-path baseline) — not the FULL ~50-fixture set (that
 * would multiply real subprocess spawns for marginal signal; every shape-class this corpus is
 * meant to catch drift in is represented at least once). */
const CORPUS: readonly string[] = [
  shellEquivalentDeleteCall.command, // clean allow-shaped baseline
  shellDepthCapExactCall.command, // depth-cap-5 wrapper nesting (worst-case recursion)
  shellMultiTargetTwoRedirectsCall.command, // multi-redirect assembly
  shellAtHeredocMultiCommandCall.command, // long, multi-line heredoc-wrapped construction
];

/** Real measurement: `iterationsPerCommand` fresh cold-process invocations per corpus entry, via
 * the injected `timer` (production callers pass `REAL_SHELL_FORM_TIMER`). */
export function measureLatency(
  scriptPath: string,
  corpus: readonly string[],
  iterationsPerCommand: number,
  timer: CallTimer,
): LatencyPercentiles {
  const timings: number[] = [];
  for (const command of corpus) {
    const stdin = buildStdin(command);
    for (let i = 0; i < iterationsPerCommand; i++) {
      timings.push(timer(scriptPath, stdin));
    }
  }
  return computePercentiles(timings);
}

export function checkLatencyBudget(measurement: LatencyPercentiles, ceilingMs: number): InstrumentResult {
  if (measurement.iterations === 0) {
    return { ok: true, vacuous: true, summary: "0 measurements taken — vacuous pass.", details: [] };
  }
  const detail = `iterations=${measurement.iterations} min=${measurement.min.toFixed(2)}ms p50=${measurement.p50.toFixed(2)}ms p95=${measurement.p95.toFixed(2)}ms p99=${measurement.p99.toFixed(2)}ms max=${measurement.max.toFixed(2)}ms ceiling=${ceilingMs}ms`;

  if (measurement.p99 > ceilingMs) {
    return {
      ok: false,
      vacuous: false,
      summary: `OPS-03 CI-10 INCIDENT: measured p99 (${measurement.p99.toFixed(2)}ms) exceeds the declared latency budget (${ceilingMs}ms). This is never a change to the SEPARATE, fixed 60s enforcement timeout — investigate the regression.`,
      details: [detail],
    };
  }
  return {
    ok: true,
    vacuous: false,
    summary: `OPS-03: measured p99 (${measurement.p99.toFixed(2)}ms) stays under the declared ${ceilingMs}ms latency budget.`,
    details: [detail],
  };
}

function main(): void {
  const repoRoot = process.argv[2] ?? process.cwd();
  const scriptPath = join(repoRoot, "hooks", "pretooluse-kernel-gate.mjs");
  const iterationsPerCommand = 10;

  const measurement = measureLatency(scriptPath, CORPUS, iterationsPerCommand, REAL_SHELL_FORM_TIMER);
  const result = checkLatencyBudget(measurement, OPS03_CEILING_MS);
  printInstrumentResult("OPS-03 gate-latency-budget-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
