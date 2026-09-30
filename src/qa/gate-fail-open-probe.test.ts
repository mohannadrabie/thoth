// G9: SUR-10 by script (S7 plan section 7). Runs the real hook under injected faults and requires
// the observed BLOCKS/PROCEEDS outcome of every probed fault to equal its recorded decision, in
// both directions. story-implementer's own test, written failing first.
//
// S7-A (docs/plans/s7a-gate-hook-robustness-phase1-2026-09-26.md sections 6 and 8): two module-load paths
// and the discarded-stdout-write path became BLOCKS, and the input-size path is now probed and BLOCKS. The
// expected-PROCEEDS list below therefore LOST entries: a strengthening, not a weakening.
//
// S7-A fix-now round 1 (red-team attacks 1 to 3, cross-domain finding 2): the input-size class is recorded PER SHAPE
// (a redirect-dense command and a trailing-whitespace command are different code paths), and two faults the first
// enumeration missed are recorded as launcher-owned residuals: an allocation failure inside the hook (exit 134) and a
// hook script that does not parse (exit 1). The expected-PROCEEDS list grew by exactly those two rows.
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
  const expectedProceeds = ["interpreter-not-on-path", "node-options-bad-flag", "memory-exhaustion", "hook-script-unparseable", ...(process.platform === "win32" ? ["systemroot-nonexistent"] : [])].sort();
  assert.deepEqual(proceeds, expectedProceeds, "only the launcher-owned faults (AP-13: three that kill the process before the hook runs, the hook script that does not parse, and memory exhaustion) remain probed fail-open paths");
});

test("A4 module-load-rows-block: node-without-ts-type-stripping and import-target-missing are probed, expect BLOCKS and name no AP", () => {
  for (const id of ["node-without-ts-type-stripping", "import-target-missing"]) {
    const r = row(id);
    assert.equal(r.expect, "BLOCKS", `${id} must be recorded as BLOCKS`);
    assert.equal(r.probed, true, `${id} must be probed`);
    assert.equal(r.ap, undefined, `${id} closes no activation precondition any more`);
  }
});

test("A5 residual-launch-faults-stay-proceeds-and-say-so: the launcher-owned rows stay probed PROCEEDS under AP-13 and their notes say residual and name the launcher as the owner", () => {
  for (const id of ["interpreter-not-on-path", "node-options-bad-flag", "systemroot-nonexistent", "memory-exhaustion", "hook-script-unparseable"]) {
    if (id === "systemroot-nonexistent" && process.platform !== "win32") continue;
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

test("input-size-fail-open-is-recorded-per-shape: the input-size class is split per code path: a redirect-dense row and a trailing-whitespace row, each probed and recorded BLOCKS, each observed BLOCKS through a decided deny (red-team attack 2)", () => {
  const redirect = row("input-size-timeout");
  const trailing = row("input-size-timeout-trailing-whitespace");
  for (const r of [redirect, trailing]) {
    assert.equal(r.expect, "BLOCKS");
    assert.equal(r.probed, true);
    assert.equal(r.ap, undefined, `${r.id} closes no activation precondition`);
    assert.match(r.note, /shape|redirect|whitespace/i, `${r.id}: the note names the shape it covers`);
  }
  assert.match(redirect.note, /redirect/i);
  assert.match(trailing.note, /whitespace/i);
  assert.match(trailing.note, /newline/i, "the trailing-whitespace row names the newline-dense shape that outran the timeout");
  assert.match(trailing.note, /#321/, "the row names the Issue it closes");
  const observed = runProbe(REPO_ROOT).find((o) => o.id === "input-size-timeout-trailing-whitespace");
  assert.ok(observed !== undefined, "runProbe must probe the trailing-whitespace row");
  assert.equal(observed.outcome, "BLOCKS", observed.detail);
  for (const shape of ["newline-dense", "crlf", "mixed"]) assert.match(observed.detail, new RegExp(`${shape}: exit=(0|2)`), `the probe covers the ${shape} shape: ${observed.detail}`);
});

test("memory-exhaustion-is-a-recorded-fail-open: an allocation failure inside the hook (exit 134) is a recorded, probed PROCEEDS row owned by the launcher (AP-13, Issue #308) whose control run with the same heap cap decides normally", () => {
  const r = row("memory-exhaustion");
  assert.equal(r.expect, "PROCEEDS");
  assert.equal(r.probed, true);
  assert.equal(r.ap, "AP-13");
  assert.match(r.note, /launcher/i);
  assert.match(r.note, /#308/, "the row is routed to Issue #308");
  assert.match(r.note, /134/, "the row records the observed exit code");
  assert.match(r.note, /residual/i);
  const observed = runProbe(REPO_ROOT).find((o) => o.id === "memory-exhaustion");
  assert.ok(observed !== undefined, "runProbe must probe the memory-exhaustion row");
  assert.equal(observed.outcome, "PROCEEDS", observed.detail);
  assert.match(observed.detail, /control=ok/, `the control run (same heap cap, small command) must decide normally, else the abort is not input-driven: ${observed.detail}`);
});

test("hook-script-unparseable-is-a-recorded-fail-open: a hook script that does not parse exits 1 before any hook code runs: recorded PROCEEDS under AP-13, launcher-owned (cross-domain finding 2)", () => {
  const r = row("hook-script-unparseable");
  assert.equal(r.expect, "PROCEEDS");
  assert.equal(r.probed, true);
  assert.equal(r.ap, "AP-13");
  assert.match(r.note, /launcher/i);
  assert.match(r.note, /residual/i);
  const observed = runProbe(REPO_ROOT).find((o) => o.id === "hook-script-unparseable");
  assert.ok(observed !== undefined, "runProbe must probe the unparseable-script row");
  assert.equal(observed.outcome, "PROCEEDS", observed.detail);
  assert.match(observed.detail, /^exit=1 /, `Node exits 1 on a syntax error; ${observed.detail}`);
});

test("no-launcher-level-only-overclaim: the hook header and the probe header do not say the residual set is launcher-level only, and both name the memory-exhaustion and unparseable-script residuals (red-team attack 2, cross-domain finding 2)", () => {
  for (const file of [join("hooks", "pretooluse-kernel-gate.mjs"), join("src", "qa", "gate-fail-open-probe.ts")]) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    assert.ok(!/launcher-level only/i.test(source), `${file} still says the residual set is launcher-level only`);
    assert.match(source, /memory exhaustion|allocation failure/i, `${file} must name the memory-exhaustion residual`);
    assert.match(source, /unparseable|does not parse|syntax error/i, `${file} must name the unparseable-script residual`);
    assert.match(source, /trailing.whitespace|trailing newline|blank lines/i, `${file} must name the trailing-whitespace input-size shape`);
  }
});

test("A11 no-stale-not-fixed-claims: neither the hook header nor the probe header carries the retired not-fixed sentences", () => {
  for (const file of [join("hooks", "pretooluse-kernel-gate.mjs"), join("src", "qa", "gate-fail-open-probe.ts")]) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    assert.ok(!source.includes("NOT fixed in this story"), `${file} still says "NOT fixed in this story"`);
    assert.ok(!source.includes("belongs to that issue's own story"), `${file} still defers the input-size probe to another story`);
  }
});

test("A20 systemroot-row-accepts-either-launch-outcome: the win32 systemroot row keeps expect PROCEEDS (AP-13, probed) and also accepts BLOCKS, and its note says why (#320)", () => {
  const r = row("systemroot-nonexistent");
  assert.equal(r.expect, "PROCEEDS");
  assert.deepEqual(r.alsoAccepts, ["BLOCKS"]);
  assert.equal(r.probed, true, "no skip: the row is still probed");
  assert.equal(r.ap, "AP-13");
  assert.match(r.note, /BLOCKS/);
  assert.match(r.note, /22\.18/);
  assert.match(r.note, /residual/i);
  assert.match(r.note, /launcher/i);
  for (const other of RECORDED_DECISIONS) if (other.id !== "systemroot-nonexistent") assert.equal(other.alsoAccepts, undefined, `${other.id}: only the systemroot row is version-dependent`);
});

test("A21 outcome-accepted-predicate: accepts expect and alsoAccepts, and rejects anything else", () => {
  const accepted = probeModule.outcomeAccepted as (r: { expect: "BLOCKS" | "PROCEEDS"; alsoAccepts?: readonly ("BLOCKS" | "PROCEEDS")[] }, o: "BLOCKS" | "PROCEEDS") => boolean;
  const both = { expect: "PROCEEDS", alsoAccepts: ["BLOCKS"] } as const;
  assert.equal(accepted(both, "PROCEEDS"), true);
  assert.equal(accepted(both, "BLOCKS"), true);
  assert.equal(accepted(both, "MAYBE" as "BLOCKS"), false, "a third outcome still fails");
  assert.equal(accepted({ expect: "PROCEEDS" }, "PROCEEDS"), true);
  assert.equal(accepted({ expect: "PROCEEDS" }, "BLOCKS"), false, "a row with no alsoAccepts stays exact-match");
  assert.equal(accepted({ expect: "BLOCKS" }, "PROCEEDS"), false);
});
