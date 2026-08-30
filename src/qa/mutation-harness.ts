// QA-06: "The regression suite shall itself be tested by mutation: each named regression class
// shall be proven to fail the suite when reintroduced." Acceptance: "A passing suite that cannot
// detect its own regression class is not evidence."
//
// This is the generic engine only (the S1 scaffold) — no production detector/kernel exists yet
// (that's S2+), so there are no real mutant classes to register today. That "0 real mutant
// classes" state is disclosed loudly below, not silently passed. The engine itself is proven
// against a live self-test mutant target (mutation-harness.selftest-target.ts) in the test file
// alongside this one — a real subprocess, a real kill, per AC11.
import { fileURLToPath } from "node:url";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../lib/exec.ts";
import { realRunner } from "../lib/exec.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { printInstrumentResult } from "../lib/instrument.ts";

export interface Mutant {
  id: string;
  description: string;
  /** Path to the file to mutate, relative to the project root that gets shadow-copied. */
  targetFile: string;
  /** Returns the mutated source given the original source. Must actually change it. */
  apply: (originalSource: string) => string;
}

export interface MutationHarnessConfig {
  /** Root directory containing every file the test command needs (target + its test + support files). */
  projectRoot: string;
  /** Command run inside the shadow copy; a non-zero exit means "the suite failed" (mutant killed). */
  testCommand: { cmd: string; args: string[] };
  mutants: Mutant[];
  runner?: Runner;
  /** Where to build shadow copies. Defaults to a fresh os.tmpdir() dir per mutant. */
  shadowParentDir?: string;
}

export type MutantVerdict = "KILLED" | "SURVIVED" | "MUTATION-NOOP";

export interface MutantResult {
  id: string;
  description: string;
  verdict: MutantVerdict;
}

export interface MutationRunResult {
  results: MutantResult[];
  killedCount: number;
  survivedCount: number;
  noopCount: number;
}

async function runOneMutant(
  projectRoot: string,
  mutant: Mutant,
  testCommand: MutationHarnessConfig["testCommand"],
  runner: Runner,
  shadowParentDir: string,
): Promise<MutantResult> {
  const shadowDir = await mkdtemp(join(shadowParentDir, `mutant-${mutant.id}-`));
  try {
    await cp(projectRoot, shadowDir, { recursive: true });

    const targetPath = join(shadowDir, mutant.targetFile);
    const original = await readFile(targetPath, "utf8");
    const mutated = mutant.apply(original);

    if (mutated === original) {
      return { id: mutant.id, description: mutant.description, verdict: "MUTATION-NOOP" };
    }

    await writeFile(targetPath, mutated, "utf8");

    const res = await runner(testCommand.cmd, testCommand.args, { cwd: shadowDir, timeoutMs: 30_000 });
    // Suite failing (non-zero exit) on the mutated code == the mutant was caught == KILLED.
    const verdict: MutantVerdict = res.code !== 0 ? "KILLED" : "SURVIVED";
    return { id: mutant.id, description: mutant.description, verdict };
  } finally {
    await rm(shadowDir, { recursive: true, force: true });
  }
}

export async function runMutationHarness(config: MutationHarnessConfig): Promise<MutationRunResult> {
  const runner = config.runner ?? realRunner;
  const shadowParentDir = config.shadowParentDir ?? tmpdir();

  const results: MutantResult[] = [];
  for (const mutant of config.mutants) {
    results.push(await runOneMutant(config.projectRoot, mutant, config.testCommand, runner, shadowParentDir));
  }

  return {
    results,
    killedCount: results.filter((r) => r.verdict === "KILLED").length,
    survivedCount: results.filter((r) => r.verdict === "SURVIVED").length,
    noopCount: results.filter((r) => r.verdict === "MUTATION-NOOP").length,
  };
}

export function summarizeMutationRun(run: MutationRunResult, registeredRealMutantClasses: number): InstrumentResult {
  if (registeredRealMutantClasses === 0) {
    return {
      ok: true,
      vacuous: true,
      summary:
        "0 real mutant classes registered yet (no production detector/kernel exists to mutate — S2+ builds that). " +
        "The engine itself is proven against a self-test mutant; see mutation-harness.test.ts.",
      details: [],
    };
  }

  const survived = run.results.filter((r) => r.verdict === "SURVIVED");
  const noop = run.results.filter((r) => r.verdict === "MUTATION-NOOP");
  if (survived.length > 0 || noop.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${survived.length} mutant(s) SURVIVED and ${noop.length} were a MUTATION-NOOP out of ${run.results.length}.`,
      details: [
        ...survived.map((r) => `SURVIVED: ${r.id} — ${r.description}`),
        ...noop.map((r) => `MUTATION-NOOP: ${r.id} — ${r.description} (apply() did not change the source)`),
      ],
    };
  }

  return {
    ok: true,
    vacuous: false,
    summary: `${run.killedCount} of ${run.results.length} mutant(s) KILLED.`,
    details: [],
  };
}

function main(): void {
  // Standing invocation point for S2+'s real mutant classes once a detector exists. Today: 0.
  const result = summarizeMutationRun({ results: [], killedCount: 0, survivedCount: 0, noopCount: 0 }, 0);
  printInstrumentResult("QA-06 mutation-harness", result);
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
