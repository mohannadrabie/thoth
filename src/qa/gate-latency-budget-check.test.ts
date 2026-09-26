import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLatencyBudget, computePercentiles, measureLatency, OPS03_CEILING_MS, REAL_SHELL_FORM_TIMER } from "./gate-latency-budget-check.ts";

test("computePercentiles: an empty timings array is a well-formed zero result, not a crash", () => {
  const p = computePercentiles([]);
  assert.equal(p.iterations, 0);
  assert.equal(p.p99, 0);
});

test("computePercentiles: p99 of a small sorted-friendly set is the highest value present", () => {
  const p = computePercentiles([10, 20, 30, 40, 100]);
  assert.equal(p.min, 10);
  assert.equal(p.max, 100);
  assert.equal(p.iterations, 5);
});

test("computePercentiles: order of input does not matter — it sorts internally", () => {
  const a = computePercentiles([100, 10, 50]);
  const b = computePercentiles([10, 50, 100]);
  assert.deepEqual(a, b);
});

test("measureLatency: calls the injected timer once per (corpus entry x iteration), not shared across entries", () => {
  let calls = 0;
  const timer = () => {
    calls++;
    return 5;
  };
  const result = measureLatency("fake-script.mjs", ["cmd-a", "cmd-b", "cmd-c"], 4, timer);
  assert.equal(calls, 12);
  assert.equal(result.iterations, 12);
  assert.equal(result.p99, 5);
});

test("checkLatencyBudget: a measurement well under the ceiling passes non-vacuously", () => {
  const measurement = computePercentiles([10, 20, 30]);
  const result = checkLatencyBudget(measurement, 2000);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, false);
});

test("checkLatencyBudget: 0 iterations is a VACUOUS pass, not a hidden green", () => {
  const measurement = computePercentiles([]);
  const result = checkLatencyBudget(measurement, 2000);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("checkLatencyBudget: a p99 over the ceiling FAILS loudly and names it a CI-10 incident, never silently adjusting the ceiling", () => {
  const measurement = computePercentiles([50, 3000, 3000]);
  const result = checkLatencyBudget(measurement, 2000);
  assert.equal(result.ok, false);
  assert.match(result.summary, /CI-10 INCIDENT/);
  assert.match(result.summary, /never a change to the SEPARATE, fixed 60s enforcement timeout/);
});

test("checkLatencyBudget's own detail line never claims to derive the ceiling from the measurement, or vice versa (split-budget model, stated explicitly)", () => {
  const measurement = computePercentiles([10]);
  const result = checkLatencyBudget(measurement, OPS03_CEILING_MS);
  assert.ok(result.details[0]?.includes(`ceiling=${OPS03_CEILING_MS}ms`));
});

// --- Real-subprocess self-test: proves REAL_SHELL_FORM_TIMER actually measures the REAL shipped
// script through the REAL shipped shell-form invocation shape, end-to-end, not a mock standing in
// for the whole methodology. Small iteration count (this is a correctness proof, not the full
// spike — the full spike's own numbers are recorded in this file's header comment and
// docs/spikes/T11-ops03-latency-budget-2026-09-06.md).
test("REAL_SHELL_FORM_TIMER + measureLatency: measures the REAL hooks/pretooluse-kernel-gate.mjs via the REAL shell-form invocation, and its own p99 clears the declared OPS-03 ceiling on this machine", async () => {
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const scriptPath = path.join(repoRoot, "hooks", "pretooluse-kernel-gate.mjs");

  const measurement = measureLatency(scriptPath, ["kubectl get pod/x --context=prod-cluster"], 5, REAL_SHELL_FORM_TIMER);
  assert.equal(measurement.iterations, 5);
  const result = checkLatencyBudget(measurement, OPS03_CEILING_MS);
  assert.equal(result.ok, true, JSON.stringify(result));
});

// --- S7 L4 (story-implementer, written failing first): the instrument asserts the child's OUTCOME.
// Before this, REAL_SHELL_FORM_TIMER discarded the child's exit status and stdout, so a crashed or
// truncated hook run also "passed" the budget (design-challenger round 1, attack 8, PT-11).
import { assertHookOutcome } from "./gate-latency-budget-check.ts";

test("L4: assertHookOutcome accepts exit 0 with empty stdout (a kernel allow), exit 0 with a parseable deny JSON, and exit 2", () => {
  assertHookOutcome(0, "");
  assertHookOutcome(0, JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "r" } }));
  assertHookOutcome(2, "");
});

test("L4: assertHookOutcome throws on exit 1, a null status (timeout or spawn failure), and exit 0 with unparseable stdout", () => {
  assert.throws(() => assertHookOutcome(1, ""), /exit/i);
  assert.throws(() => assertHookOutcome(null, ""), /timeout|status/i);
  assert.throws(() => assertHookOutcome(0, "not json at all"), /stdout|parse/i);
  assert.throws(() => assertHookOutcome(127, ""), /exit/i);
});

test("L4: measureLatency fails (propagates the throw) when the timer reports a bad hook outcome", () => {
  const badTimer = (): number => {
    assertHookOutcome(1, "");
    return 1;
  };
  assert.throws(() => measureLatency("x", ["c"], 1, badTimer), /exit/i);
});

// --- S7 L4b (fix-now, cross-domain finding 6): a non-empty stdout must be a parseable DENY JSON. The
// first L4 accepted exit 0 with an allow JSON, {}, null and 123, so a hook that violated Q-B by
// emitting an allow (or printed junk that happens to parse) still passed the latency instrument.
test("L4b: assertHookOutcome rejects exit 0 with an allow JSON, an empty object, null, a number, an array and a deny JSON missing its decision fields", () => {
  const allowJson = JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } });
  for (const stdout of [allowJson, "{}", "null", "123", "[]", '"deny"', JSON.stringify({ hookSpecificOutput: {} }), JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask" } })]) {
    assert.throws(() => assertHookOutcome(0, stdout), /deny|stdout|parse/i, `stdout ${stdout} must be rejected`);
  }
  // controls: the accepted shapes still pass
  assertHookOutcome(0, "");
  assertHookOutcome(2, "");
  assertHookOutcome(0, JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "r" } }));
});

// --- S7-A (Issue #304, story-implementer, written failing first): a padded, redirect-dense command must
// clear the same 2000 ms ceiling THROUGH THE REAL HOOK as a small one. The old redirect scan re-tokenized
// the whole remainder once per match: quadratic, 5.9 s in-process at 16 KB for the glued shape and 30 s spawn
// timeouts from 64 KB up (plan section 3). Real spawns, cold process, per size and per shape (A15); the
// corpus carries a 128 KB entry (A16).
import * as latencyModule from "./gate-latency-budget-check.ts";
import { REDIRECT_SHAPE_NAMES, buildRedirectShape } from "./redirect-shapes.ts";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "hooks", "pretooluse-kernel-gate.mjs");
const bashStdin = (command: string): string =>
  JSON.stringify({ session_id: "s7a-latency-test", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

for (const sizeKb of [16, 64, 128]) {
  for (const shape of REDIRECT_SHAPE_NAMES) {
    test(`A15 real-hook-redirect-dense-under-2000ms: shape=${shape} size=${sizeKb} KB finishes under the OPS-03 ceiling with a valid gate outcome`, () => {
      const command = buildRedirectShape(shape, sizeKb * 1024);
      assert.ok(command.length >= sizeKb * 1024, "the builder must reach the requested size");
      // REAL_SHELL_FORM_TIMER throws on a null status (timeout), exit 1, or unparseable stdout (assertHookOutcome).
      const elapsedMs = REAL_SHELL_FORM_TIMER(HOOK_PATH, bashStdin(command));
      assert.ok(elapsedMs < OPS03_CEILING_MS, `${shape} at ${sizeKb} KB took ${elapsedMs.toFixed(0)} ms; the ceiling is ${OPS03_CEILING_MS} ms`);
    });
  }
}

// --- S7-A fix-now round 1 (Issue #321, written failing first): the same ceiling for a benign command that ends in a
// long whitespace run. The separator scan was quadratic in a newline-dense run: 16 KB took 2294 ms through the real
// hook and 64 KB never returned inside the 30 s spawn timeout (red-team attack 1). Real spawns, cold process. The
// 2000 ms ceiling assertions stay; under full-suite load the measured margin is about 3x, not 7x, so these wall-clock
// cases are the SECOND guard: the deterministic work meter (src/policy/normalizer/shell-scanner-work.test.ts) is the
// primary proof of linearity.
import { TRAILING_WHITESPACE_SHAPE_NAMES, buildTrailingWhitespaceShape } from "./trailing-whitespace-shapes.ts";

for (const sizeKb of [16, 64, 128]) {
  for (const shape of TRAILING_WHITESPACE_SHAPE_NAMES) {
    test(`A15b real-hook-trailing-whitespace-under-2000ms: shape=${shape} size=${sizeKb} KB finishes under the OPS-03 ceiling with a valid gate outcome`, () => {
      const command = buildTrailingWhitespaceShape(shape, sizeKb * 1024);
      assert.ok(command.length >= sizeKb * 1024, "the builder must reach the requested size");
      const elapsedMs = REAL_SHELL_FORM_TIMER(HOOK_PATH, bashStdin(command));
      assert.ok(elapsedMs < OPS03_CEILING_MS, `${shape} at ${sizeKb} KB took ${elapsedMs.toFixed(0)} ms; the ceiling is ${OPS03_CEILING_MS} ms`);
    });
  }
}

test("A16b latency-corpus-has-trailing-whitespace-entries: the exported corpus holds a 128 KB entry of every trailing-whitespace shape", () => {
  const corpus = (latencyModule as { CORPUS?: readonly string[] }).CORPUS;
  assert.ok(corpus !== undefined, "the corpus must be exported");
  for (const shape of TRAILING_WHITESPACE_SHAPE_NAMES) {
    assert.ok(corpus.includes(buildTrailingWhitespaceShape(shape, 128 * 1024)), `no 128 KB ${shape} entry in the corpus`);
  }
});

test("A16 latency-corpus-has-a-128KB-entry: the exported corpus holds a command of 131072 characters or more", () => {
  const corpus = (latencyModule as { CORPUS?: readonly string[] }).CORPUS;
  assert.ok(corpus !== undefined, "the corpus must be exported");
  assert.ok(corpus.some((c) => c.length >= 128 * 1024), `no corpus entry is 128 KB or larger; longest is ${Math.max(...corpus.map((c) => c.length))}`);
  assert.ok(corpus.some((c) => c.length < 1024), "the small realistic entries stay in the corpus");
});

test("A16 latency-corpus-every-entry-passes-the-outcome-assertion: one real cold run of every corpus entry is a valid gate outcome and the corpus p99 clears the ceiling", () => {
  const corpus = (latencyModule as { CORPUS?: readonly string[] }).CORPUS;
  assert.ok(corpus !== undefined, "the corpus must be exported");
  const measurement = measureLatency(HOOK_PATH, corpus, 1, REAL_SHELL_FORM_TIMER);
  assert.equal(measurement.iterations, corpus.length);
  const result = checkLatencyBudget(measurement, OPS03_CEILING_MS);
  assert.equal(result.ok, true, JSON.stringify(result));
});
