// Black-box acceptance tests for `hooks/pretooluse-kernel-gate.mjs` — written FIRST, before that
// file exists (test-writer, per CLAUDE.md's test-first workflow: story-implementer writes zero
// application code until these are RED-CONFIRMED). The script does not exist yet; every test below
// is expected to fail with a "module not found" / ENOENT-shaped error right now — that IS the RED
// confirmation, not a test bug.
//
// Source of truth for the tests below:
//   - docs/plans/S5-phase1-2026-09-06.md (v3) acceptance criteria 1, 2, 6, 19 (see each test's own
//     "AC-n" tag — grep-countable, do not rename without updating the plan cross-reference).
//   - REQUIREMENTS.md SUR-10's own enumerated fail-open list ("missing configuration, unknown
//     tool, internal exception, malformed input, unrecognised syntax, depth cap, lock timeout, hook
//     timeout, and non-blocking hook surface") — this file exercises the two of those nine paths
//     that are genuinely observable from OUTSIDE the script via stdin/stdout/exit-code alone
//     (internal exception, malformed input); the other seven are either already covered by S2-S4's
//     existing kernel/normalizer test suites (missing configuration, unknown tool, unrecognised
//     syntax, depth cap, lock timeout) or are Claude Code runtime properties disclosed, not
//     mechanically tested (hook timeout, non-blocking hook surface — see plan §4's own text).
//   - Claude Code's documented PreToolUse hook contract (code.claude.com/docs/en/hooks, confirmed
//     this session, not assumed from memory):
//       stdin:  { session_id, transcript_path, cwd, permission_mode, hook_event_name: "PreToolUse",
//                 tool_name, tool_input, tool_use_id }
//       stdout (exit 0): { hookSpecificOutput: { hookEventName: "PreToolUse",
//                          permissionDecision: "allow"|"deny"|"ask", permissionDecisionReason? } }
//       exit 2: blocking error — blocks the tool call regardless of any JSON on stdout.
//       any other non-zero code: non-blocking (the call proceeds) unless valid JSON with a
//       permissionDecision was produced — SUR-10's "hook timeout"/"non-blocking hook surface"
//       fail-opens live exactly here, disclosed not mechanically testable black-box.
//
// AMBIGUITY FLAGGED (see this pass's persisted report / receipt): AC-2's "matches no deny rule
// proceeds" case depends on `src/policy/config/bootstrap-ruleset.ts`'s defaultOutcome, which is an
// EXPLICITLY UNDETERMINED disclosed placeholder per the plan's own criterion 13 ("story-implementer's
// call, pending S6/S11a") — not yet built, and no prior reviewer round pinned its value. The test
// below uses a cleanly-resolved, NON-mutating action (a "get", not a "delete") specifically because
// POL-05 cannot fire on it BY CONSTRUCTION (kernel.ts's isMutating() gates POL-05 on mutating verbs
// or unresolved fields only) — but the ASSERTION that a non-mutating, cleanly-resolved action is not
// denied still assumes the bootstrap ruleset's defaultOutcome is "allow", not "deny". If
// story-implementer's actual bootstrap ruleset instead applies a global default-deny (plausible
// given the milestone's own name, "Deny-by-default"), this specific test will need a build-time
// conversation, not a silent edit — flagged explicitly rather than guessed at.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook, preToolUseStdin, fakeSessionId } from "./test-support/spawn-hook.ts";

const SCRIPT = "hooks/pretooluse-kernel-gate.mjs";

function permissionDecision(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const hso = (json as Record<string, unknown>).hookSpecificOutput;
  if (typeof hso !== "object" || hso === null) return undefined;
  const decision = (hso as Record<string, unknown>).permissionDecision;
  return typeof decision === "string" ? decision : undefined;
}

/** True iff Claude Code's own contract means this invocation BLOCKS the tool call — either an
 * explicit JSON `permissionDecision: "deny"` on exit 0, or exit code 2 (blocking regardless of any
 * JSON body), per the confirmed PreToolUse contract quoted in this file's header. */
function wasDenied(result: { code: number | null; json: unknown }): boolean {
  if (result.code === 2) return true;
  if (result.code === 0 && permissionDecision(result.json) === "deny") return true;
  return false;
}

// --- AC-1: a live Bash call whose normalized record trips POL-05 is denied ------------------

test("AC-1: a Bash command with a live chain operator (';') normalizes with a non-empty `unresolved` field, unconditionally tripping POL-05 -> denied", () => {
  const sessionId = fakeSessionId("ac1-chain-operator");
  const stdin = preToolUseStdin({
    sessionId,
    toolInput: { command: "echo hi; rm -rf /tmp/whatever-this-never-runs" },
  });
  const result = runHook(SCRIPT, stdin);

  assert.equal(wasDenied(result), true, `expected a deny (exit 2, or exit 0 + permissionDecision "deny"); got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
  if (result.code === 0) {
    assert.equal(permissionDecision(result.json), "deny");
  }
});

test("AC-1: a Bash command with a live command-substitution ('$(...)') also normalizes with a non-empty `unresolved` field -> denied (a second, independent POL-05 trigger, not just the chain-operator path)", () => {
  const sessionId = fakeSessionId("ac1-substitution");
  const stdin = preToolUseStdin({
    sessionId,
    toolInput: { command: "kubectl delete pod/$(whoami) --context=prod" },
  });
  const result = runHook(SCRIPT, stdin);

  assert.equal(wasDenied(result), true, `expected a deny; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
});

// --- AC-2: a live Bash call that normalizes cleanly and matches no deny rule proceeds -------

test("AC-2 (ambiguity flagged in this file's header comment — depends on bootstrap-ruleset.ts's undetermined defaultOutcome): a cleanly-resolved, NON-mutating command ('kubectl get', not 'delete') -- POL-05 cannot fire on it by construction -- is not denied", () => {
  const sessionId = fakeSessionId("ac2-clean-get");
  const stdin = preToolUseStdin({
    sessionId,
    toolInput: { command: "kubectl get pod/payment-worker --context=prod-cluster" },
  });
  const result = runHook(SCRIPT, stdin);

  // NOTE: asserting `code === 0` (not merely `code !== 2`) and that `permissionDecision` is
  // actually PRESENT (not merely "not the string deny") is deliberate, not incidental strictness:
  // a script that doesn't exist at all also satisfies "code !== 2" and "permissionDecision !==
  // deny" (spawnSync fails with code 1 and empty/undefined stdout) -- a false-positive PASS that
  // would hide a missing implementation instead of proving one. This positively confirms the
  // script ran to a clean, successful, non-denying exit, per the documented contract's normal
  // (non-fail-open) path.
  assert.equal(result.code, 0, `expected a clean exit 0 for a fully-resolved, non-mutating command; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
  const decision = permissionDecision(result.json);
  assert.notEqual(decision, undefined, `expected a real hookSpecificOutput.permissionDecision on stdout, not silence; got stdout=${result.stdout}`);
  assert.notEqual(decision, "deny", `expected non-deny for a clean, non-mutating command; got stdout=${result.stdout}`);
});

// --- AC-6 (SUR-10): "malformed input" and "internal exception" fail-open paths are explicit,
// tested, fail-CLOSED behavior -- never a crash, never a bare non-blocking exit --------------

test("AC-6 (SUR-10, malformed input): `tool_input.command` missing entirely -> denies, fail-closed, not a crash", () => {
  const sessionId = fakeSessionId("ac6-missing-command");
  const stdin = preToolUseStdin({ sessionId, toolInput: {} });
  const result = runHook(SCRIPT, stdin);

  assert.equal(wasDenied(result), true, `missing tool_input.command must fail closed (deny), not crash or silently proceed; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
});

test("AC-6 (SUR-10, malformed input): `tool_input.command` is the wrong type (a number, not a string) -> denies, fail-closed, not a crash", () => {
  const sessionId = fakeSessionId("ac6-wrong-type-command");
  const stdin = preToolUseStdin({ sessionId, toolInput: { command: 12345 } });
  const result = runHook(SCRIPT, stdin);

  assert.equal(wasDenied(result), true, `non-string tool_input.command must fail closed (deny), not crash or silently proceed; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
});

test("AC-6 (SUR-10, internal exception): garbage (non-JSON) stdin -> exit 2 + non-empty stderr, never a bare non-blocking exit code", () => {
  const result = runHook(SCRIPT, "{ this is not valid JSON at all °§¶", {});

  assert.equal(result.code, 2, `an internal exception (unparseable stdin) must exit 2 (the only code the PreToolUse contract guarantees blocks regardless of JSON output) -- a bare non-blocking exit here would silently let the tool call proceed; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
  assert.notEqual(result.stderr.trim(), "", "an internal exception must be disclosed on stderr, not swallowed silently");
});

test("AC-6 (SUR-10, internal exception): empty stdin -> exit 2 + non-empty stderr, never a bare non-blocking exit code", () => {
  const result = runHook(SCRIPT, "", {});

  assert.equal(result.code, 2, `empty stdin (no hook_event_name/tool_name at all) must exit 2, fail-closed; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
  assert.notEqual(result.stderr.trim(), "", "an internal exception must be disclosed on stderr, not swallowed silently");
});

// --- AC-19: stdin's tool_name is checked; any value other than "Bash" denies, never crashes,
// never silently normalizes as shell ----------------------------------------------------------

test("AC-19: tool_name \"Edit\" reaching this script denies -- fail-closed tool_name check, never a normalize-as-shell attempt", () => {
  const sessionId = fakeSessionId("ac19-edit");
  const stdin = preToolUseStdin({
    sessionId,
    toolName: "Edit",
    toolInput: { file_path: "/tmp/whatever.txt", old_string: "a", new_string: "b" },
  });
  const result = runHook(SCRIPT, stdin);

  assert.equal(wasDenied(result), true, `a non-Bash tool_name must deny, never crash and never silently proceed; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
});

test("AC-19: tool_name missing entirely reaching this script denies -- same fail-closed check covers an absent field, not only a wrong-but-present one", () => {
  const sessionId = fakeSessionId("ac19-missing-toolname");
  const stdin = preToolUseStdin({ sessionId, toolInput: { command: "true" } }) as Record<string, unknown>;
  delete stdin.tool_name;
  const result = runHook(SCRIPT, stdin);

  assert.equal(wasDenied(result), true, `a missing tool_name must deny, fail-closed, same as any non-"Bash" value; got code=${result.code} stdout=${result.stdout} stderr=${result.stderr}`);
});

test("AC-19: tool_name \"Bash\" (the one permitted value) reaches real kernel evaluation -- proves the tool_name check discriminates rather than denying unconditionally (contrast with the two tests above, both non-\"Bash\")", () => {
  const sessionId = fakeSessionId("ac19-bash-passes-name-check");
  // A live chain operator (same fixture as AC-1's first test) -- guarantees a real, deterministic
  // kernel-level deny via POL-05 regardless of bootstrap-ruleset.ts's undetermined defaultOutcome
  // (see this file's header comment), so this test does not depend on that same open question.
  const stdin = preToolUseStdin({
    sessionId,
    toolInput: { command: "echo hi; rm -rf /tmp/whatever-this-never-runs" },
  });
  const result = runHook(SCRIPT, stdin);

  assert.equal(wasDenied(result), true, "a \"Bash\" tool_name carrying a POL-05-tripping command must still be denied -- proves the tool_name gate let it through to real kernel evaluation rather than short-circuiting on tool_name alone");
});
