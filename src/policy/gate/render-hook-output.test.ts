// G20: renderHookOutput is closed and fail-closed (PT-15, PC-13 polarity). Under Q-B a kernel allow
// emits NOTHING, so silence means allow: the renderer must be silent ONLY for an exact allow
// verdict. story-implementer's own tests, written failing first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHookOutput } from "./render-hook-output.ts";

const record = { source: "parsed", verbs: [], targets: [], environment: "unknown", identity: "t", deferred: false, unresolved: [] };
function verdict(outcome: unknown, reason: unknown = "because"): unknown {
  return { kind: "verdict", verdict: { outcome, reason }, record };
}
function parsedDeny(stdout: string): { permissionDecision?: unknown; permissionDecisionReason?: unknown; hookEventName?: unknown } {
  const json = JSON.parse(stdout) as { hookSpecificOutput: Record<string, unknown> };
  return json.hookSpecificOutput;
}

test("G20: renderHookOutput: an exact allow verdict is silent (exit 0, empty stdout, empty stderr)", () => {
  const out = renderHookOutput(verdict("allow") as never);
  assert.deepEqual(out, { exitCode: 0, stdout: "", stderr: "" });
});

test("G20: renderHookOutput: a deny verdict and a refusal with a reason render the deny JSON (exit 0, one object, non-empty reason, empty stderr)", () => {
  for (const result of [verdict("deny", "kernel says no"), { kind: "refusal", category: "malformed-input", reason: "bad input" }]) {
    const out = renderHookOutput(result as never);
    assert.equal(out.exitCode, 0);
    assert.equal(out.stderr, "");
    const hso = parsedDeny(out.stdout);
    assert.equal(hso.hookEventName, "PreToolUse");
    assert.equal(hso.permissionDecision, "deny");
    assert.equal(typeof hso.permissionDecisionReason, "string");
    assert.ok((hso.permissionDecisionReason as string).length > 0);
  }
  assert.equal(parsedDeny(renderHookOutput(verdict("deny", "kernel says no") as never).stdout).permissionDecisionReason, "kernel says no");
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
    const out = renderHookOutput(shape as never);
    assert.equal(out.exitCode, 2, `shape ${JSON.stringify(shape)} must exit 2`);
    assert.equal(out.stdout, "", `shape ${JSON.stringify(shape)}: no stdout`);
    assert.ok(out.stderr.trim().length > 0, `shape ${JSON.stringify(shape)}: a stderr message`);
  }
});
