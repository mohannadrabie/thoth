#!/usr/bin/env node
// PreToolUse hook (ADR-0021 shape 4, "gate surfaces"): the live, in-session enforcement point that
// calls S2's pure kernel (`decide()`) through S3's normalizer registry and S4's shell-command
// detector — the first time any of that shipped mechanism is actually wired to a real Claude Code
// session (0% -> real exposure, S5 Phase 1 plan v3, docs/plans/S5-phase1-2026-09-06.md).
//
// Matcher scope: `Bash` ONLY (`.claude/settings.json`'s own `PreToolUse` entry for this script) —
// criterion 12, DERIVED/load-bearing, already ratified (docs/decisions.md, 2026-09-06 S5-plan-
// ratified row, finding 2): routing Claude Code's other mutating built-ins (Edit/Write/MultiEdit/
// NotebookEdit) through today's registry would deny every one of them unconditionally (no
// filesystem normalizer exists yet — docs/backlog.md). This script ALSO checks stdin's own
// `tool_name` itself (criterion 19) and denies on anything other than "Bash", fail-closed, never
// crashing and never silently normalizing non-Bash input as a shell call — a second, independent
// check from the matcher string in .claude/settings.json, not a replacement for it.
//
// SUR-10's nine named fail-open paths, as they apply to THIS script specifically (see this file's
// own tests, hooks/pretooluse-kernel-gate.test.ts, for which of these are black-box observable):
//   - missing configuration / unknown tool: SUR-02's terminal-fall-through-is-deny guarantee,
//     already proven at the registry level (S3, src/policy/normalizer/registry.test.ts) — this
//     script inherits it unchanged by calling `normalize()` directly.
//   - internal exception / malformed input: the ENTIRE body below runs inside one try/catch. Any
//     exception (unparseable stdin, an unexpected shape) exits 2 with a non-empty stderr message —
//     the one exit code Claude Code's own documented PreToolUse contract guarantees BLOCKS the
//     tool call regardless of any JSON on stdout. A bare non-blocking exit here would silently let
//     the call proceed.
//   - hook timeout / non-blocking hook surface: NOT mechanically preventable by this script's own
//     code — these are Claude Code runtime properties, disclosed (criterion 18's own "SUR-10 gap
//     G6 unchanged" and this same story's split-budget model, see below), not tested here.
//
// TIMEOUT DISCLOSURE (SUR-12 / OPS-03 split-budget model, S5 plan v3 section 5): this script's
// entry in `.claude/settings.json` declares `"timeout": 60` — a FIXED, disclosed value chosen
// directly from (a) this repo's own shipped precedent (the former `report-subject-gate.mjs` entry,
// `"timeout": 10` against a disclosed few-millisecond real cost) and (b) Claude Code's own
// documented 600-second default ceiling for command-type hooks — NOT derived from any measured
// invocation-latency figure. The SEPARATE, measured, CI-regression-tested performance budget for
// this same script's real-world latency lives entirely in src/qa/gate-latency-budget-check.ts;
// its overrun is a CI-10 incident (a red build), never a change to this 60s enforcement ceiling,
// and this ceiling is never derived from or checked against that measurement. See
// docs/decisions.md's S5 build-time row for the full one-line justification of the "60" value.
//
// EVIDENCE-TRAIL DISCLOSURE (criterion 23): this script's own deny/allow verdicts have NO durable
// evidence trail yet. The former `.claude/settings.json` PreToolUse entry (`report-subject-
// gate.mjs`) claimed a hash-chained audit log that never actually existed on this branch (Issue
// #87) — this script makes no equivalent claim. The real audit-trail mechanism (hash-chained,
// append-only, atomic-write, per INT-05/REL-02) is S8's job (Milestone #26, INT-05) — removing the
// fictional claim is not building the real thing.
import { normalize } from "../src/policy/normalizer/registry.ts";
import "../src/policy/normalizer/shell.ts";
import { decide } from "../src/policy/kernel/kernel.ts";
import { BOOTSTRAP_DEFAULT_OUTCOME, loadBootstrapRuleSet } from "../src/policy/config/bootstrap-ruleset.ts";

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

function emitDecision(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function denyFailClosed(reason) {
  emitDecision("deny", reason);
}

async function main() {
  const raw = await readStdin();

  if (raw.trim() === "") {
    throw new Error("empty stdin: no hook payload received at all");
  }

  const input = JSON.parse(raw);

  // Criterion 19: fail-closed tool_name check, independent of .claude/settings.json's own matcher
  // string. Any value other than "Bash" denies — never crashes, never silently normalizes as shell.
  if (input.tool_name !== "Bash") {
    denyFailClosed(
      `pretooluse-kernel-gate.mjs only evaluates "Bash" calls; got tool_name=${JSON.stringify(input.tool_name)}`,
    );
    return;
  }

  const toolInput = input.tool_input;
  const command = toolInput && typeof toolInput === "object" ? toolInput.command : undefined;
  if (typeof command !== "string") {
    denyFailClosed("tool_input.command is missing or not a string — fail-closed, cannot evaluate");
    return;
  }

  const identity = typeof input.session_id === "string" ? input.session_id : "unknown";

  const action = normalize("shell", {
    command,
    // No real environment/identity model exists yet (S6/S11a) — criterion 13's own disclosed-
    // placeholder pattern, applied here identically to bootstrap-ruleset.ts's RuleSet.
    environment: "unknown",
    identity,
    deferred: false,
  });

  const worldFacts = {
    rules: loadBootstrapRuleSet(),
    defaultOutcome: BOOTSTRAP_DEFAULT_OUTCOME,
  };

  const verdict = decide(worldFacts, action);
  emitDecision(verdict.outcome, verdict.reason);
}

main().catch((err) => {
  process.stderr.write(`pretooluse-kernel-gate.mjs: internal exception, fail-closed (deny): ${err?.stack ?? err}\n`);
  process.exit(2);
});
