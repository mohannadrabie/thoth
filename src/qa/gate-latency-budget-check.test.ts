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
