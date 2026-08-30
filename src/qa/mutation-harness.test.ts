import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Mutant } from "./mutation-harness.ts";
import { runMutationHarness, summarizeMutationRun } from "./mutation-harness.ts";
import type { Runner } from "../lib/exec.ts";

const here = dirname(fileURLToPath(import.meta.url));
const selftestFixtureRoot = join(here, "selftest-fixture");

test("QA-06: summarizeMutationRun — 0 registered real mutant classes -> vacuous pass, disclosed", () => {
  const result = summarizeMutationRun(
    { results: [], killedCount: 0, survivedCount: 0, noopCount: 0 },
    0,
  );
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
  assert.match(result.summary, /0 real mutant classes/);
});

test("QA-06: summarizeMutationRun — a SURVIVED mutant fails the gate (a passing suite that can't detect its own regression is not evidence)", () => {
  const result = summarizeMutationRun(
    {
      results: [{ id: "M1", description: "test", verdict: "SURVIVED" }],
      killedCount: 0,
      survivedCount: 1,
      noopCount: 0,
    },
    1,
  );
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /SURVIVED: M1/);
});

test("QA-06: summarizeMutationRun — a MUTATION-NOOP (apply() didn't change anything) also fails the gate", () => {
  const result = summarizeMutationRun(
    {
      results: [{ id: "M1", description: "no-op mutant", verdict: "MUTATION-NOOP" }],
      killedCount: 0,
      survivedCount: 0,
      noopCount: 1,
    },
    1,
  );
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /MUTATION-NOOP/);
});

test("QA-06: summarizeMutationRun — all KILLED -> real pass", () => {
  const result = summarizeMutationRun(
    {
      results: [{ id: "M1", description: "test", verdict: "KILLED" }],
      killedCount: 1,
      survivedCount: 0,
      noopCount: 0,
    },
    1,
  );
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, false);
});

test("QA-06: runMutationHarness scores SURVIVED when the suite doesn't notice the mutation (fake runner)", async () => {
  const alwaysPassRunner: Runner = () => Promise.resolve({ stdout: "", stderr: "", code: 0 });
  const mutant: Mutant = {
    id: "fake-1",
    description: "flip a constant, suite never notices",
    targetFile: "is-even.ts",
    apply: (src) => src.replace("n % 2 === 0", "true"),
  };
  const run = await runMutationHarness({
    projectRoot: selftestFixtureRoot,
    testCommand: { cmd: "node", args: [] },
    mutants: [mutant],
    runner: alwaysPassRunner,
  });
  assert.equal(run.results[0]?.verdict, "SURVIVED");
});

test("QA-06 (AC11): the engine run against a REAL self-test mutant, real subprocess, is KILLED", async () => {
  const mutant: Mutant = {
    id: "flip-even-odd",
    description: "isEven: n % 2 === 0 -> n % 2 !== 0 (flips even/odd classification)",
    targetFile: "is-even.ts",
    apply: (src) => src.replace("n % 2 === 0", "n % 2 !== 0"),
  };

  const run = await runMutationHarness({
    projectRoot: selftestFixtureRoot,
    testCommand: { cmd: "node", args: ["--test", "is-even.test.ts"] },
    mutants: [mutant],
  });

  assert.equal(run.results.length, 1);
  assert.equal(
    run.results[0]?.verdict,
    "KILLED",
    "the self-test suite must fail against this mutant — a suite that doesn't is not evidence (QA-06)",
  );
  assert.equal(run.killedCount, 1);
  assert.equal(run.survivedCount, 0);

  const summary = summarizeMutationRun(run, 1);
  assert.equal(summary.ok, true);
});
