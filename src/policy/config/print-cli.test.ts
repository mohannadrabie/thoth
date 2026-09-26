// Black-box smoke test for `npm run policy:print`'s entry point (`src/policy/config/print-cli.ts`),
// S7 kernel-gate classification, plan check P6 (docs/plans/s7-kernel-gate-classification-phase1-
// 2026-09-26.md section 7, requirement R4 / Issue #288 precondition 1: "surface the resolved posture
// and its source on the operator print surface: a PrinterResult field plus a print-cli.ts line, NOT
// printer stdout"). Written FIRST by test-writer, before the line exists.
//
// WHY THIS FILE SPAWNS THE CLI (a deliberate, disclosed departure from printer.test.ts's header,
// INTERPRETATION CHOICE 3, which declines to spawn it): that choice was about the central-policy
// SOURCE, which the CLI hard-wires to the real Windows registry reader and which tests must not
// need a seam for (Issue #99). This test adds no seam and injects nothing: it runs the CLI exactly
// as an operator does and asserts only what is stable on ANY host (English or not, central policy
// deployed or not): exactly one posture line, in the documented grammar, and exit 0 or 1. It is
// host-dependent by construction (the real reader runs), which the plan records (residual R-6:
// "STILL host-dependent: ... P6"). On a host with a central policy deployed the resolved posture may
// differ from a developer's expectation, so the test never asserts WHICH source or outcome.
//
// It additionally asserts the CLI line equals `PrinterResult.postureLine` computed in-process from
// the SAME real inputs (shipped-defaults path, project policy path, real reader), so the CLI cannot
// print a different line than the tested printer field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printEffectivePolicy } from "./printer.ts";
import { defaultCentralPolicySource } from "./central-source.ts";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "..", "..", "..");

test("AC-P6: print-cli smoke: the CLI prints exactly one posture line (allow or deny with a source, or unresolved) and exits 0 or 1; the line equals PrinterResult.postureLine for the same real inputs", () => {
  const spawned = spawnSync(process.execPath, [path.join("src", "policy", "config", "print-cli.ts")], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  const stdout = spawned.stdout ?? "";
  const stderr = spawned.stderr ?? "";
  assert.ok(spawned.status === 0 || spawned.status === 1, `expected exit 0 (resolved) or 1 (policy load rejected); got status=${String(spawned.status)} signal=${String(spawned.signal)} error=${String(spawned.error)} stderr=${stderr.slice(0, 400)}`);

  const postureLines = stdout.split(/\r?\n/).filter((line) => line.startsWith("posture:"));
  assert.equal(postureLines.length, 1, `expected exactly ONE line starting with "posture:" on stdout; got ${postureLines.length}. stdout was:\n${stdout}`);
  const line = postureLines[0] ?? "";
  assert.match(line, /^posture: (allow|deny) \(source: |^posture: unresolved/, `the posture line must be "posture: (allow|deny) (source: ..." or "posture: unresolved ..."; got ${JSON.stringify(line)}`);

  const printed = printEffectivePolicy({
    shippedDefaultsPath: path.join(REPO_ROOT, "src", "policy", "config", "shipped-defaults.json"),
    projectPolicyPath: path.join(REPO_ROOT, ".thoth", "policy.json"),
    centralSource: defaultCentralPolicySource,
  }) as { postureLine?: string };
  assert.equal(line, printed.postureLine, "the CLI line must be the printer's own postureLine, not a second rendering");
});
