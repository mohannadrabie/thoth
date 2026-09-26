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
// (nothing denies by class from shipped data until then), a refreshed tool inventory, and the
// launcher-level residuals below (AP-13, narrowed by docs/plans/s7a-gate-hook-robustness-phase1-
// 2026-09-26.md).
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
// plan section 9). Claude Code treats exit 2 as a block and exit 1, a signal or a timeout as
// NON-BLOCKING (measured on 2.1.267), so every failure this script can catch must end in exit 2:
//   - missing configuration / unknown tool: a policy or fixture that cannot load denies; an
//     unclassified, ambiguous or unparseable MCP name is opaque and POL-05 denies it.
//   - internal exception AND module-load failure (Issue #303): the whole body, including the load of
//     every project module, runs inside ONE try/catch below. Only `node:` built-ins are static
//     imports, so a Node that cannot strip TypeScript types, or a missing or renamed project file,
//     is caught and exits 2 (before this change those static imports ran before any catch and
//     exited 1). The stderr message is fixed text, an unlock clause, and the error TYPE only
//     (letters only, else `Error`): no path, no stack and no raw message reach the model.
//   - stdout write failure: the decision is written with a completion callback and the stream has
//     an error listener; a write that fails, or a stream that errors, exits 2 (before this change a
//     deny written to a closed pipe was dropped and the process exited 0 with empty stdout, which on
//     this runtime means ALLOW: red-team attack 3, demonstrated with a destroyed stream on Windows,
//     unproven in a real session).
//   - input size (Issue #304): S4's redirect scan is linear (one token index per call), so a padded
//     redirect-dense command finishes in milliseconds instead of outrunning the hook timeout.
//   - RESIDUAL, owned by the launcher (the future settings entry's command form, Issue #308, AP-13
//     narrowed): faults that kill the process BEFORE any of this script runs cannot be fixed inside
//     it. Measured: an interpreter that is not on PATH (exit 127 or 1), `NODE_OPTIONS` with an
//     unknown flag (exit 9), `SYSTEMROOT` pointing at a nonexistent directory on Windows (exit 134).
//     The probe in src/qa/gate-fail-open-probe.ts injects each and records PROCEEDS.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIPPED_DEFAULTS_PATH = join(HERE, "..", "src", "policy", "config", "shipped-defaults.json");
const PROJECT_POLICY_PATH = join(HERE, "..", ".thoth", "policy.json");

// PRINCIPLES rule 2: a block names its unlock. Fixed text: it must carry no path, no stack frame and no
// parser text (the stderr redaction test rejects them), because stderr is a model-visible channel.
const UNLOCK = "Unlock: retry the call; if it fails again a human must repair the gate hook (it needs Node 22.18 or newer and an intact checkout).";

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

/** Fail closed: ONE fixed line (what happened, the unlock, the error TYPE only) on stderr, then exit 2, the
 * one code the PreToolUse contract guarantees blocks the call. The error type is accepted only when it is
 * letters only (S7 fix-now, app-security finding 4: err.stack carried absolute file paths and parser text
 * into a model-visible channel); anything else prints as the bare type `Error`. The exit runs in a finally
 * so that even a broken stderr cannot turn this into a non-blocking exit 1. */
function failClosed(what, err) {
  const name = typeof err?.name === "string" && /^[A-Za-z]{1,40}$/.test(err.name) ? err.name : "Error";
  try {
    process.stderr.write(`pretooluse-kernel-gate.mjs: ${what}, fail-closed (exit 2). ${UNLOCK} Error type: ${name}\n`);
  } finally {
    process.exit(2);
  }
}

const STDOUT_FAILED = "decision could not be written to stdout";

/** Writes the decision and resolves only when the stream reports it flushed. A failed write (the callback
 * receives an error) fails closed here, so a decided deny that never reached the reader is never an exit 0. */
function writeStdout(text) {
  return new Promise((resolvePromise) => {
    process.stdout.write(text, (err) => (err ? failClosed(STDOUT_FAILED, err) : resolvePromise(undefined)));
  });
}

// main(): load the project modules and read the payload (concurrently, so start-up cost is one load),
// decide, render, write, exit. EVERYTHING that can throw runs inside the try: a module that cannot load, an
// empty or unparseable payload, a port that throws. The catch is the only exit path for a failure.
async function main() {
  try {
    // A stdout error event (for example EPIPE on a pipe the reader closed) has no other listener: without
    // this it would be an uncaught exception, exit 1, non-blocking.
    process.stdout.on("error", (err) => failClosed(STDOUT_FAILED, err));

    // The project modules are loaded with import() so a load failure lands in the catch below. The gate
    // module's surface this hook uses, written in static-import spelling because the locked test AC-H13
    // (hooks/pretooluse-kernel-gate-classification.test.ts) reads this spelling to discover the export it
    // wraps:
    //   import { decideToolCall } from "../src/policy/gate/decide-tool-call.ts"
    const [raw, gate, render, loader, central, catalog] = await Promise.all([
      readStdin(),
      import("../src/policy/gate/decide-tool-call.ts"),
      import("../src/policy/gate/render-hook-output.ts"),
      import("../src/policy/config/loader.ts"),
      import("../src/policy/config/central-source.ts"),
      import("../src/policy/tools/classification-catalog.ts"),
    ]);

    if (raw.trim() === "") {
      throw new Error("empty stdin: no hook payload received at all");
    }
    const input = JSON.parse(raw);

    // The gate's ports (src/policy/gate/decide-tool-call.ts owns their types, so the gate imports nothing
    // from src/policy/config/): the real loader, adapted here to the gate's own layer-and-kind result
    // (never the raw loader message), and the module-relative catalog. The gate returns a CLOSED result: a
    // kernel verdict (allow or deny) or a refusal (malformed input, an unroutable tool_name, a policy load
    // failure), and renderHookOutput maps it to what this script writes. A port that throws (for example a
    // malformed fixture) propagates to the catch below: exit 2.
    const ports = {
      loadPolicy() {
        const loaded = loader.loadEffectivePolicy({
          shippedDefaultsPath: SHIPPED_DEFAULTS_PATH,
          projectPolicyPath: PROJECT_POLICY_PATH,
          centralSource: central.defaultCentralPolicySource,
        });
        if (!loaded.ok) return { ok: false, failedLayer: loaded.failedLayer, reasonKind: loaded.reasonKind };
        return {
          ok: true,
          ruleSet: { version: loaded.merged.version, rules: loaded.merged.rules },
          defaultOutcome: loaded.defaultOutcome.outcome,
        };
      },
      loadCatalog() {
        return catalog.assembleCatalog(catalog.moduleRelativeFixtureLocation()).merged;
      },
    };

    const output = render.renderHookOutput(gate.decideToolCall(input, ports));
    if (output.stderr !== "") process.stderr.write(output.stderr);
    if (output.stdout !== "") await writeStdout(output.stdout);
    process.exit(output.exitCode);
  } catch (err) {
    failClosed("internal exception", err);
  }
}

main().catch((err) => failClosed("internal exception", err));
