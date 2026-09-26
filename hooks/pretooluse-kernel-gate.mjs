#!/usr/bin/env node
// PreToolUse hook (ADR-0021 shape 4, "gate surfaces"): the in-session enforcement point that calls
// S2's pure kernel (`decide()`) through S3's normalizer registry, S4's shell-command detector and
// S7's tool-class normalizer. It is a THIN ADAPTER: it reads stdin, builds the real ports for the
// gate module (src/policy/gate/decide-tool-call.ts), and writes what renderHookOutput returns.
//
// ACTIVATION STATUS (docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md): this script is
// built and tested but NOT WIRED. `.claude/settings.json` has no `hooks.PreToolUse` entry for it, so
// nothing is enforced live from this policy today. Activation is a separate, human-owned step with
// its own preconditions (plan section 14, AP-1 to AP-14), among them baseline allow content
// (nothing denies by class from shipped data until then), a refreshed tool inventory, and the two
// unfixed launch and size fail-open blockers below.
//
// SCOPE (plan R-B): the gate evaluates ONLY `tool_name == "Bash"` (S4 shell normalizer) and names of
// the form `mcp__<server>__<tool>` (the tool-class normalizer, class carried on a marker verb, see
// src/policy/normalizer/tool-class-format.ts). Every OTHER tool_name keeps the fail-closed refusal
// this hook always had (locked test AC-19): no built-in tool is routed through classification.
//
// POLICY SOURCE (R3, Issue #288 precondition): rules and the `defaultOutcome` posture come from the
// loader (src/policy/config/loader.ts, three layers: shipped defaults, central, project), read on
// EVERY call (no cache, plan S-4: about 40 ms measured against a 2000 ms budget; a cache is
// session-writable state on a policy path). The shipped-defaults and project policy paths are
// module-relative and the classification fixture is read module-relative too
// (src/policy/tools/classification-catalog.ts): no environment variable and no working directory
// decides which policy source this fail-closed gate trusts (Issue #99 principle). A load failure
// denies (layer and kind only, never the raw message).
//
// OUTPUT (Q-B): a kernel ALLOW emits NOTHING. S-2 measured that `permissionDecision: "allow"` skips
// the user's permission prompt, so an emitted allow would make this gate an auto-approver. Only a
// deny is emitted (exit 0 plus a deny JSON). renderHookOutput is a typed, closed function: silence
// only for an exact allow verdict; any other result shape exits 2 with stderr, never silent (PT-15).
//
// SUR-10 fail-open paths (REQUIREMENTS.md; enumerated by src/qa/gate-fail-open-probe.ts, recorded in
// plan section 9):
//   - missing configuration / unknown tool: a policy or fixture that cannot load denies; an
//     unclassified, ambiguous or unparseable MCP name is opaque and POL-05 denies it.
//   - internal exception: the body below runs inside main().catch: exit 2 with stderr.
//     CORRECTION of an earlier claim that the WHOLE body ran in one try/catch: the static imports
//     below run BEFORE that catch. A process that dies there (Node without TypeScript type
//     stripping, a missing or renamed import target, an interpreter that is not on PATH) exits 1,
//     which Claude Code treats as NON-BLOCKING: the call PROCEEDS (measured, design-challenger
//     round 1, Claude Code 2.1.267). NOT fixed in this story; bound as activation blocker AP-13
//     (Issue #303).
//   - input size: a padded, redirect-dense command makes S4's redirect scan quadratic and can outrun
//     the hook timeout, which proceeds. NOT fixed in this story (shell-scanner.ts untouched); bound
//     as AP-14 (Issue #304).
//   - hook timeout / non-blocking hook surface: runtime properties, disclosed, not preventable here.
//
// TIMEOUT DISCLOSURE (SUR-12 / OPS-03 split-budget model): the declared entry timeout (60, set at
// activation) is a fixed value chosen from precedent and Claude Code's documented ceiling, NOT
// derived from any latency measurement. The measured, CI-regression-tested budget lives in
// src/qa/gate-latency-budget-check.ts (p99 2000 ms); its overrun is a CI-10 incident, never a change
// to the enforcement ceiling.
//
// EVIDENCE-TRAIL DISCLOSURE (R13): this script's verdicts have NO durable evidence trail. The audit
// trail (hash-chained, append-only) is S8's job (INT-05); this hook writes no file.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideToolCall } from "../src/policy/gate/decide-tool-call.ts";
import { renderHookOutput } from "../src/policy/gate/render-hook-output.ts";
import { loadEffectivePolicy } from "../src/policy/config/loader.ts";
import { defaultCentralPolicySource } from "../src/policy/config/central-source.ts";
import { assembleCatalog, moduleRelativeFixtureLocation } from "../src/policy/tools/classification-catalog.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIPPED_DEFAULTS_PATH = join(HERE, "..", "src", "policy", "config", "shipped-defaults.json");
const PROJECT_POLICY_PATH = join(HERE, "..", ".thoth", "policy.json");

function readStdin() {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolvePromise(data));
    process.stdin.on("error", (err) => rejectPromise(err));
  });
}

/** The gate's ports: the real loader (adapted to the gate's own layer-and-kind result) and the
 * module-relative catalog. */
const PORTS = {
  loadPolicy() {
    const loaded = loadEffectivePolicy({
      shippedDefaultsPath: SHIPPED_DEFAULTS_PATH,
      projectPolicyPath: PROJECT_POLICY_PATH,
      centralSource: defaultCentralPolicySource,
    });
    if (!loaded.ok) return { ok: false, failedLayer: loaded.failedLayer, reasonKind: loaded.reasonKind };
    return {
      ok: true,
      ruleSet: { version: loaded.merged.version, rules: loaded.merged.rules },
      defaultOutcome: loaded.defaultOutcome.outcome,
    };
  },
  loadCatalog() {
    return assembleCatalog(moduleRelativeFixtureLocation()).merged;
  },
};

async function main() {
  const raw = await readStdin();

  if (raw.trim() === "") {
    throw new Error("empty stdin: no hook payload received at all");
  }

  const input = JSON.parse(raw);
  const output = renderHookOutput(decideToolCall(input, PORTS));
  if (output.stderr !== "") process.stderr.write(output.stderr);
  if (output.stdout !== "") process.stdout.write(output.stdout);
  process.exit(output.exitCode);
}

main().catch((err) => {
  process.stderr.write(`pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2): ${err?.stack ?? err}\n`);
  process.exit(2);
});
