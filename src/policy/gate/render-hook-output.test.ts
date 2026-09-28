// G20: renderHookOutput is closed and fail-closed (PT-15, PC-13 polarity). Under Q-B a kernel allow
// emits NOTHING, so silence means allow: the renderer must be silent ONLY for an exact allow
// verdict. story-implementer's own tests, written failing first.
//
// Issue #312: renderHookOutput now takes a required `sanitize` port (an injected function, not an
// import — see the module's own header for why). These tests pass the real `sanitizeForTerminal`
// wherever a reason is carried, so the AC-1/2/3/4/5 sanitization checks below exercise the actual
// production sanitizer, not a stand-in; a plain identity function is used only for the pre-existing
// odd-shape cases that never reach a reason at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHookOutput } from "./render-hook-output.ts";
import { sanitizeForTerminal } from "../config/sanitize.ts";

const record = { source: "parsed", verbs: [], targets: [], environment: "unknown", identity: "t", deferred: false, unresolved: [] };
function verdict(outcome: unknown, reason: unknown = "because"): unknown {
  return { kind: "verdict", verdict: { outcome, reason }, record };
}
function parsedDeny(stdout: string): { permissionDecision?: unknown; permissionDecisionReason?: unknown; hookEventName?: unknown } {
  const json = JSON.parse(stdout) as { hookSpecificOutput: Record<string, unknown> };
  return json.hookSpecificOutput;
}

// Own fixture (each test file in this repo owns its own hostile-text constants rather than
// importing another file's .test.ts — same convention echo-sanitize.test.ts and sanitize.test.ts
// each follow independently). Same oracle shape as echo-sanitize.test.ts's HOSTILE/HOSTILE_VISIBLE.
const FORGED = "REJECTED-LOOKALIKE";
const HOSTILE = `\u001b[31m\n${FORGED}: forged line\u2028second\u0085third\rfourth\u0000\u007f\u009b[2J`;
const HOSTILE_VISIBLE = `[31m${FORGED}: forged linesecondthirdfourth[2J`;
/** Strips to nothing: only control characters, no visible text left. */
const ALL_CONTROL = "\u0000\u0007\u001b\u009b";

test("G20: renderHookOutput: an exact allow verdict is silent (exit 0, empty stdout, empty stderr)", () => {
  const out = renderHookOutput(verdict("allow") as never, sanitizeForTerminal);
  assert.deepEqual(out, { exitCode: 0, stdout: "", stderr: "" });
});

// AC-3: allow discards the reason before any sanitize call — a throwing sanitizer must never fire.
test("AC-3: renderHookOutput: an allow verdict never invokes sanitize (the reason is discarded, not sanitized)", () => {
  let calls = 0;
  const spy = (text: string): string => {
    calls += 1;
    return text;
  };
  const out = renderHookOutput(verdict("allow", HOSTILE) as never, spy);
  assert.deepEqual(out, { exitCode: 0, stdout: "", stderr: "" });
  assert.equal(calls, 0, "sanitize must not be called on the allow path");
});

test("G20: renderHookOutput: a deny verdict and a refusal with a reason render the deny JSON (exit 0, one object, non-empty reason, empty stderr)", () => {
  for (const result of [verdict("deny", "kernel says no"), { kind: "refusal", category: "malformed-input", reason: "bad input" }]) {
    const out = renderHookOutput(result as never, sanitizeForTerminal);
    assert.equal(out.exitCode, 0);
    assert.equal(out.stderr, "");
    const hso = parsedDeny(out.stdout);
    assert.equal(hso.hookEventName, "PreToolUse");
    assert.equal(hso.permissionDecision, "deny");
    assert.equal(typeof hso.permissionDecisionReason, "string");
    assert.ok((hso.permissionDecisionReason as string).length > 0);
  }
  assert.equal(parsedDeny(renderHookOutput(verdict("deny", "kernel says no") as never, sanitizeForTerminal).stdout).permissionDecisionReason, "kernel says no");
});

// AC-5: a clean reason is byte-identical before and after sanitizing.
test("AC-5: renderHookOutput: a clean reason (no control characters) passes through byte-identical", () => {
  const clean = "denied by rule kubectl-delete-guard: mutating verb on a protected target";
  const out = renderHookOutput(verdict("deny", clean) as never, sanitizeForTerminal);
  assert.equal(parsedDeny(out.stdout).permissionDecisionReason, clean);
});

// AC-1: a hostile kernel verdict-deny reason (rationale or id, per kernel.ts) is stripped, not escaped.
test("AC-1: renderHookOutput: a hostile deny-verdict reason is terminal-sanitized before it reaches permissionDecisionReason", () => {
  const out = renderHookOutput(verdict("deny", HOSTILE) as never, sanitizeForTerminal);
  assert.equal(out.exitCode, 0);
  assert.equal(parsedDeny(out.stdout).permissionDecisionReason, HOSTILE_VISIBLE);
  assert.ok(!(parsedDeny(out.stdout).permissionDecisionReason as string).includes("\u001b"), "no raw ESC must survive");
});

// AC-2: a hostile refusal reason (fixed template text plus the bounded, untrusted tool_name
// reflection) is sanitized through the same denyJson call site.
test("AC-2: renderHookOutput: a hostile refusal reason is terminal-sanitized before it reaches permissionDecisionReason", () => {
  const out = renderHookOutput({ kind: "refusal", category: "malformed-input", reason: HOSTILE } as never, sanitizeForTerminal);
  assert.equal(out.exitCode, 0);
  assert.equal(parsedDeny(out.stdout).permissionDecisionReason, HOSTILE_VISIBLE);
});

// AC-4: a reason that is non-empty pre-sanitize but strips to "" is fail-closed (exit 2), never a
// deny JSON with a blank permissionDecisionReason (Verdict.reason's "never blank" invariant).
test("AC-4: renderHookOutput: a reason that sanitizes to empty is fail-closed (exit 2), not a blank deny reason", () => {
  for (const result of [verdict("deny", ALL_CONTROL), { kind: "refusal", category: "malformed-input", reason: ALL_CONTROL }]) {
    const out = renderHookOutput(result as never, sanitizeForTerminal);
    assert.equal(out.exitCode, 2, `shape ${JSON.stringify(result)} must exit 2 when sanitize collapses the reason to empty`);
    assert.equal(out.stdout, "");
    assert.ok(out.stderr.trim().length > 0);
  }
});

test("G20: renderHookOutput: every odd shape is exit 2 with stderr and no stdout, never silent: outcome ask, undefined, null, unknown kind, refusal without a reason, verdict with an empty reason on deny, non-object", () => {
  const odd: unknown[] = [
    verdict("ask"),
    verdict("ALLOW"),
    verdict(undefined),
    verdict("deny", ""),
    { kind: "verdict", verdict: { outcome: "deny" }, record },
    undefined,
    null,
    5,
    "allow",
    [],
    {},
    { kind: "h-no-such-kind" },
    { kind: "verdict" },
    { kind: "verdict", verdict: null },
    { kind: "refusal", category: "malformed-input" },
    { kind: "refusal", category: "malformed-input", reason: "" },
    { kind: "refusal", category: "malformed-input", reason: 5 },
  ];
  for (const shape of odd) {
    const out = renderHookOutput(shape as never, sanitizeForTerminal);
    assert.equal(out.exitCode, 2, `shape ${JSON.stringify(shape)} must exit 2`);
    assert.equal(out.stdout, "", `shape ${JSON.stringify(shape)}: no stdout`);
    assert.ok(out.stderr.trim().length > 0, `shape ${JSON.stringify(shape)}: a stderr message`);
  }
});
