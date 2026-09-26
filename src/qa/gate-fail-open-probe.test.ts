// G9: SUR-10 by script (S7 plan section 7). Runs the real hook under injected faults and requires
// the observed BLOCKS/PROCEEDS outcome of every probed fault to equal its recorded decision, in
// both directions. story-implementer's own test, written failing first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { RECORDED_DECISIONS, classifyOutcome, runProbe } from "./gate-fail-open-probe.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

test("G9: classifyOutcome follows the PreToolUse contract: exit 2 blocks, exit 0 plus a deny JSON blocks, everything else proceeds", () => {
  const deny = JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "r" } });
  assert.equal(classifyOutcome(2, ""), "BLOCKS");
  assert.equal(classifyOutcome(0, deny), "BLOCKS");
  assert.equal(classifyOutcome(0, ""), "PROCEEDS");
  assert.equal(classifyOutcome(1, ""), "PROCEEDS");
  assert.equal(classifyOutcome(127, ""), "PROCEEDS");
  assert.equal(classifyOutcome(null, ""), "PROCEEDS");
  assert.equal(classifyOutcome(0, "not json"), "PROCEEDS");
  assert.equal(classifyOutcome(1, deny), "PROCEEDS", "a deny JSON on a non-zero non-2 exit is not a block");
});

test("G9: SUR-10 by script: every probed fault's observed outcome equals its recorded decision; every PROCEEDS carries an AP; every recorded probed row was probed and every probed fault is recorded", () => {
  const observed = runProbe(REPO_ROOT);
  const recorded = new Map(RECORDED_DECISIONS.map((r) => [r.id, r]));
  const probedIds = new Set(observed.map((o) => o.id));

  for (const o of observed) {
    const row = recorded.get(o.id);
    assert.ok(row !== undefined, `probed fault ${o.id} has no recorded decision`);
    assert.equal(row.probed, true, `${o.id} is recorded as not probed but was probed`);
    assert.equal(o.outcome, row.expect, `${o.id}: observed ${o.outcome}, recorded ${row.expect}; ${o.detail}`);
  }
  for (const row of RECORDED_DECISIONS) {
    if (row.probed && (row.platform === undefined || row.platform === process.platform)) assert.ok(probedIds.has(row.id), `recorded row ${row.id} was never probed`);
    if (row.expect === "PROCEEDS") assert.ok(row.ap !== undefined && row.ap.startsWith("AP-"), `${row.id}: a PROCEEDS path must name the AP that closes it`);
  }
  const proceeds = observed.filter((o) => o.outcome === "PROCEEDS").map((o) => o.id).sort();
  const expectedProceeds = ["import-target-missing", "interpreter-not-on-path", "node-options-bad-flag", "node-without-ts-type-stripping", ...(process.platform === "win32" ? ["systemroot-nonexistent"] : [])].sort();
  assert.deepEqual(proceeds, expectedProceeds, "the launch-failure family (AP-13, including the two environment-induced faults) are the ONLY probed fail-open paths");
});

test("G9: the discarded-stdout-write path is recorded (not probed here) as a PROCEEDS row that names AP-13 (red-team attack 3, plan section 9)", () => {
  const row = RECORDED_DECISIONS.find((r) => r.id === "stdout-closed-before-write");
  assert.ok(row !== undefined, "the row exists");
  assert.equal(row.expect, "PROCEEDS");
  assert.equal(row.probed, false);
  assert.equal(row.ap, "AP-13");
});
