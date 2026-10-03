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
import { RECORDED_DECISIONS, classifyOutcome, controlDecided, outcomeAccepted, runProbe } from "./gate-fail-open-probe.ts";
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
    assert.ok(outcomeAccepted(r, o.outcome), `${o.id}: observed ${o.outcome}, recorded ${r.expect} (also accepts ${JSON.stringify(r.alsoAccepts ?? [])}); ${o.detail}`);
  }
  for (const r of RECORDED_DECISIONS) {
    if (r.probed && (r.platform === undefined || r.platform === process.platform)) assert.ok(probedIds.has(r.id), `recorded row ${r.id} was never probed`);
    if (r.expect === "PROCEEDS") assert.ok(r.ap !== undefined && r.ap.startsWith("AP-"), `${r.id}: a PROCEEDS path must name the AP that closes it`);
    if (r.expect === "BLOCKS") assert.equal(r.ap, undefined, `${r.id}: a BLOCKS path closes no activation precondition, so it carries no AP`);
  }
  const proceeds = observed.filter((o) => o.outcome === "PROCEEDS").map((o) => o.id).sort();
  assert.deepEqual(proceeds, [], "no probed fault remains fail-open: the five launcher-owned rows (interpreter off PATH, ambient bad NODE_OPTIONS, SYSTEMROOT nonexistent, memory exhaustion, unparseable script) BLOCK through hooks/launch-gate.sh (#308 story D, AP-13; recorded act under SE ADR-0005)");
});

test("A4 module-load-rows-block: node-without-ts-type-stripping and import-target-missing are probed, expect BLOCKS and name no AP", () => {
  for (const id of ["node-without-ts-type-stripping", "import-target-missing"]) {
    const r = row(id);
    assert.equal(r.expect, "BLOCKS", `${id} must be recorded as BLOCKS`);
    assert.equal(r.probed, true, `${id} must be probed`);
    assert.equal(r.ap, undefined, `${id} closes no activation precondition any more`);
  }
});

const LAUNCHER_ROWS = ["interpreter-not-on-path", "node-options-bad-flag", "systemroot-nonexistent", "memory-exhaustion", "hook-script-unparseable"];

test("D3-rows-block-through-launcher: the five launcher-owned rows are recorded BLOCKS, probed, name no AP and name the launcher; observed BLOCKS through hooks/launch-gate.sh while the same fault run directly (no launcher) is not a block, so the BLOCKS is the launcher's", async () => {
  const observed = [...runProbe(REPO_ROOT), ...(await runAsyncProbe(REPO_ROOT))];
  for (const id of LAUNCHER_ROWS) {
    if (id === "systemroot-nonexistent" && process.platform !== "win32") continue;
    const r = row(id);
    assert.equal(r.expect, "BLOCKS", `${id} is recorded BLOCKS (recorded act, SE ADR-0005, #308 story D)`);
    assert.equal(r.probed, true, `${id} stays probed`);
    assert.equal(r.ap, undefined, `${id} closes no activation precondition any more (AP-13 is closed by the launcher)`);
    assert.equal(r.alsoAccepts, undefined, `${id} accepts one outcome`);
    assert.match(r.note, /launcher/i, `${id}: the note names the launcher`);
    assert.match(r.note, /launch-gate\.sh/, `${id}: the note names the shim`);
    const o = observed.find((x) => x.id === id);
    assert.ok(o !== undefined, `${id} was probed`);
    assert.equal(o.outcome, "BLOCKS", o.detail);
    assert.match(o.detail, /^exit=(2|0) /, o.detail);
    // D3b control: the same fault with no launcher. Only the Windows systemroot row may differ by Node version (Node 22.18 decides).
    if (id === "systemroot-nonexistent") assert.match(o.detail, /direct=(PROCEEDS|BLOCKS)/, o.detail);
    else assert.match(o.detail, /direct=PROCEEDS/, `${id}: the control (same fault, no launcher) must still not block: ${o.detail}`);
  }
});

test("D3-ambient-wording: the NODE_OPTIONS row says ambient env (inherited from the parent environment) and does not claim a settings env block is closed (#398 ruling)", () => {
  const r = row("node-options-bad-flag");
  assert.match(r.note, /ambient/i);
  assert.match(r.note, /settings protection|stories F and K/i, "a settings env block is routed to settings protection, not the launcher");
  assert.doesNotMatch(r.note, /settings env block (closes|is closed|blocks)/i);
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

test("memory-exhaustion-blocks-through-launcher: an allocation failure (exit 134) in the hook run through the launcher is exit 2; the evidence is a wrapper variant (the heap cap is an argv flag of a wrapper, since the launcher scrubs env) plus the stub exit-134 test D2-exit-map, not direct env injection; the control run with the same cap decides normally", () => {
  const r = row("memory-exhaustion");
  assert.equal(r.expect, "BLOCKS");
  assert.equal(r.probed, true);
  assert.equal(r.ap, undefined);
  assert.match(r.note, /launcher/i);
  assert.match(r.note, /#308/, "the row is routed to Issue #308");
  assert.match(r.note, /134/, "the row records the observed exit code");
  assert.match(r.note, /wrapper/i, "the row says the evidence is the wrapper variant, not direct env injection");
  const observed = runProbe(REPO_ROOT).find((o) => o.id === "memory-exhaustion");
  assert.ok(observed !== undefined, "runProbe must probe the memory-exhaustion row");
  assert.equal(observed.outcome, "BLOCKS", observed.detail);
  assert.match(observed.detail, /^exit=2 /, observed.detail);
  assert.match(observed.detail, /control=ok/, `the control run (same heap cap, small command, through the launcher) must decide normally, else the abort is not input-driven: ${observed.detail}`);
  assert.match(observed.detail, /direct=PROCEEDS \((exit=134|exit=null signal=SIGABRT)\)/, `without the launcher the same fault is exit 134 (Windows) or a SIGABRT signal with no status (Linux): ${observed.detail}`);
});

test("memory-exhaustion-control-decides-normally: the control run (same heap cap, small denied payload, through the launcher) must exit 0 with a deny JSON, so an abort mapped to exit 2 cannot pass for a decision (a 1 MB heap cap mutant fails here)", () => {
  const deny = JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "r" } });
  assert.equal(controlDecided(0, deny), true);
  assert.equal(controlDecided(2, ""), false, "exit 2 is an abort mapped by the launcher, not a decision");
  assert.equal(controlDecided(2, deny), false);
  assert.equal(controlDecided(134, ""), false);
  assert.equal(controlDecided(null, ""), false);
  assert.equal(controlDecided(0, ""), false);
  const observed = runProbe(REPO_ROOT).find((o) => o.id === "memory-exhaustion");
  assert.ok(observed !== undefined);
  assert.match(observed.detail, /control=ok \(small denied payload, same heap cap, through the launcher: exit=0\)/, observed.detail);
});

test("hook-script-unparseable-blocks-through-launcher: a hook script that does not parse exits 1 directly (non-blocking) and exit 2 through the launcher", () => {
  const r = row("hook-script-unparseable");
  assert.equal(r.expect, "BLOCKS");
  assert.equal(r.probed, true);
  assert.equal(r.ap, undefined);
  assert.match(r.note, /launcher/i);
  const observed = runProbe(REPO_ROOT).find((o) => o.id === "hook-script-unparseable");
  assert.ok(observed !== undefined, "runProbe must probe the unparseable-script row");
  assert.equal(observed.outcome, "BLOCKS", observed.detail);
  assert.match(observed.detail, /^exit=2 /, observed.detail);
  assert.match(observed.detail, /direct=PROCEEDS \(exit=1\)/, `Node exits 1 on a syntax error without the launcher: ${observed.detail}`);
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

test("A20 systemroot-row-blocks-on-every-node-version: the win32 systemroot row is BLOCKS through the launcher on any Node version (Node 24 aborts directly with exit 134, Node 22.18 decides), so it no longer accepts either outcome (#320 closed by the launcher)", () => {
  const r = row("systemroot-nonexistent");
  assert.equal(r.expect, "BLOCKS");
  assert.equal(r.alsoAccepts, undefined, "the launcher makes the outcome the same on every Node version");
  assert.equal(r.probed, true, "no skip: the row is still probed");
  assert.equal(r.ap, undefined);
  assert.match(r.note, /22\.18/);
  assert.match(r.note, /launcher/i);
  for (const other of RECORDED_DECISIONS) assert.equal(other.alsoAccepts, undefined, `${other.id}: no row is version-dependent any more`);
});

test("A21 outcome-accepted-predicate: accepts expect and alsoAccepts, and rejects anything else", () => {
  const accepted = outcomeAccepted;
  const both = { expect: "PROCEEDS", alsoAccepts: ["BLOCKS"] } as const;
  assert.equal(accepted(both, "PROCEEDS"), true);
  assert.equal(accepted(both, "BLOCKS"), true);
  assert.equal(accepted(both, "MAYBE" as "BLOCKS"), false, "a third outcome still fails");
  assert.equal(accepted({ expect: "PROCEEDS" }, "PROCEEDS"), true);
  assert.equal(accepted({ expect: "PROCEEDS" }, "BLOCKS"), false, "a row with no alsoAccepts stays exact-match");
  assert.equal(accepted({ expect: "BLOCKS" }, "PROCEEDS"), false);
});
