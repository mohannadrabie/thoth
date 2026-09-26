// G9: SUR-10 by script (S7 plan section 7). Runs the real hook under injected faults and requires
// the observed BLOCKS/PROCEEDS outcome of every probed fault to equal its recorded decision, in
// both directions. story-implementer's own test, written failing first.
//
// S7-A (docs/plans/s7a-gate-hook-robustness-phase1-2026-09-26.md sections 6 and 8): two module-load paths
// and the discarded-stdout-write path became BLOCKS, and the input-size path is now probed and BLOCKS. The
// expected-PROCEEDS list below therefore LOST entries: a strengthening, not a weakening.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { RECORDED_DECISIONS, classifyOutcome, runProbe } from "./gate-fail-open-probe.ts";
import * as probeModule from "./gate-fail-open-probe.ts";

const runAsyncProbe = (repoRoot: string) => probeModule.runAsyncProbe(repoRoot);

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function row(id: string): (typeof RECORDED_DECISIONS)[number] {
  const found = RECORDED_DECISIONS.find((r) => r.id === id);
  assert.ok(found !== undefined, `the recorded decision ${id} must exist`);
  return found;
}

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

test("G9: SUR-10 by script: every probed fault's observed outcome equals its recorded decision; every PROCEEDS carries an AP; every recorded probed row was probed and every probed fault is recorded", async () => {
  const observed = [...runProbe(REPO_ROOT), ...(await runAsyncProbe(REPO_ROOT))];
  const recorded = new Map(RECORDED_DECISIONS.map((r) => [r.id, r]));
  const probedIds = new Set(observed.map((o) => o.id));

  for (const o of observed) {
    const r = recorded.get(o.id);
    assert.ok(r !== undefined, `probed fault ${o.id} has no recorded decision`);
    assert.equal(r.probed, true, `${o.id} is recorded as not probed but was probed`);
    assert.equal(o.outcome, r.expect, `${o.id}: observed ${o.outcome}, recorded ${r.expect}; ${o.detail}`);
  }
  for (const r of RECORDED_DECISIONS) {
    if (r.probed && (r.platform === undefined || r.platform === process.platform)) assert.ok(probedIds.has(r.id), `recorded row ${r.id} was never probed`);
    if (r.expect === "PROCEEDS") assert.ok(r.ap !== undefined && r.ap.startsWith("AP-"), `${r.id}: a PROCEEDS path must name the AP that closes it`);
    if (r.expect === "BLOCKS") assert.equal(r.ap, undefined, `${r.id}: a BLOCKS path closes no activation precondition, so it carries no AP`);
  }
  const proceeds = observed.filter((o) => o.outcome === "PROCEEDS").map((o) => o.id).sort();
  const expectedProceeds = ["interpreter-not-on-path", "node-options-bad-flag", ...(process.platform === "win32" ? ["systemroot-nonexistent"] : [])].sort();
  assert.deepEqual(proceeds, expectedProceeds, "only the three launcher-level faults (AP-13, narrowed) remain probed fail-open paths");
});

test("A4 module-load-rows-block: node-without-ts-type-stripping and import-target-missing are probed, expect BLOCKS and name no AP", () => {
  for (const id of ["node-without-ts-type-stripping", "import-target-missing"]) {
    const r = row(id);
    assert.equal(r.expect, "BLOCKS", `${id} must be recorded as BLOCKS`);
    assert.equal(r.probed, true, `${id} must be probed`);
    assert.equal(r.ap, undefined, `${id} closes no activation precondition any more`);
  }
});

test("A5 residual-launch-faults-stay-proceeds-and-say-so: the three launcher-level rows stay probed PROCEEDS under AP-13 and their notes say residual and name the launcher as the owner", () => {
  for (const id of ["interpreter-not-on-path", "node-options-bad-flag", "systemroot-nonexistent"]) {
    const r = row(id);
    assert.equal(r.expect, "PROCEEDS", `${id} stays PROCEEDS`);
    assert.equal(r.probed, true, `${id} stays probed`);
    assert.equal(r.ap, "AP-13", `${id} stays under AP-13 (narrowed)`);
    assert.match(r.note, /residual/i, `${id}: the note must use the word residual`);
    assert.match(r.note, /launcher/i, `${id}: the note must name the launcher as the owner`);
  }
});

test("A9 stdout-closed-row-is-probed-and-blocks: stdout-closed-before-write is probed, expects BLOCKS, names no AP, and its note keeps the in-process-only and unproven-in-a-real-session wording", () => {
  const r = row("stdout-closed-before-write");
  assert.equal(r.expect, "BLOCKS");
  assert.equal(r.probed, true);
  assert.equal(r.ap, undefined);
  assert.match(r.note, /in-process/i, "the note states what was asserted");
  assert.match(r.note, /unproven/i, "real-session reach stays unproven (LOW)");
});

test("A8 stdout-write-failure-exits-2 (destroyed pipe): with the child's stdout pipe destroyed before the child runs, the hook exits 2 with a fixed stderr message (probe row stdout-closed-before-write)", async () => {
  const r = row("stdout-closed-before-write");
  const results = await runAsyncProbe(REPO_ROOT);
  if (r.platform !== undefined && r.platform !== process.platform) {
    assert.equal(results.length, 0, `the destroyed-pipe fault is only reproduced on ${r.platform}; the probe must skip it elsewhere`);
    return;
  }
  const found = results.find((o) => o.id === "stdout-closed-before-write");
  assert.ok(found !== undefined, "the async probe must report the row");
  assert.equal(found.outcome, "BLOCKS", found.detail);
  assert.match(found.detail, /^exit=2 /, `exit 2 expected; ${found.detail}`);
  assert.match(found.detail, /fail-closed/, `a fixed stderr message expected; ${found.detail}`);
});

test("A17 input-size-timeout-is-probed-and-blocks: the padded 128 KB redirect-dense command is probed, expects BLOCKS, names no AP (Issue #304 closed by the linear scan)", () => {
  const r = row("input-size-timeout");
  assert.equal(r.expect, "BLOCKS");
  assert.equal(r.probed, true);
  assert.equal(r.ap, undefined, "AP-14 is closed");
  const observed = runProbe(REPO_ROOT).find((o) => o.id === "input-size-timeout");
  assert.ok(observed !== undefined, "runProbe must probe the input-size row");
  assert.equal(observed.outcome, "BLOCKS", observed.detail);
  assert.match(observed.detail, /^exit=0 /, `a decided deny is exit 0 plus a deny JSON, not a timeout; ${observed.detail}`);
});

test("A11 no-stale-not-fixed-claims: neither the hook header nor the probe header carries the retired not-fixed sentences", () => {
  for (const file of [join("hooks", "pretooluse-kernel-gate.mjs"), join("src", "qa", "gate-fail-open-probe.ts")]) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    assert.ok(!source.includes("NOT fixed in this story"), `${file} still says "NOT fixed in this story"`);
    assert.ok(!source.includes("belongs to that issue's own story"), `${file} still defers the input-size probe to another story`);
  }
});
