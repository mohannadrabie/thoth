// PT-15 / architect PC-13: a pure, typed, CLOSED mapping from the gate's result to what the hook
// writes. Under Q-B a kernel `allow` emits NOTHING (S-2: a hook `allow` would skip the user's
// permission prompt), so on this runtime SILENCE MEANS ALLOW. The polarity risk is therefore that
// any result the adapter does not recognise would be a silent allow. This function removes it:
//   - exit 0, empty stdout, empty stderr ONLY for a verdict whose outcome is exactly "allow";
//   - the deny JSON for a verdict whose outcome is exactly "deny" and for a refusal, each with a
//     non-empty string reason;
//   - EVERY other shape (outcome ask, undefined, null, an unknown kind, a missing or empty reason,
//     a non-object) is exit 2 with a stderr message and no stdout, which blocks the call regardless
//     of stdout (the documented PreToolUse contract) and is never silent.
import type { GateResult } from "./decide-tool-call.ts";

export interface HookOutput {
  exitCode: 0 | 2;
  stdout: string;
  stderr: string;
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

function denyJson(reason: string): HookOutput {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
    stderr: "",
  };
}

function failClosed(why: string): HookOutput {
  return { exitCode: 2, stdout: "", stderr: `pretooluse-kernel-gate.mjs: unrecognised gate result, fail-closed (exit 2): ${why}\n` };
}

export function renderHookOutput(result: GateResult): HookOutput {
  const r: unknown = result;
  if (typeof r !== "object" || r === null) return failClosed("the gate result is not an object");
  const obj = r as Record<string, unknown>;
  if (obj.kind === "verdict") {
    const verdict = obj.verdict;
    if (typeof verdict !== "object" || verdict === null) return failClosed("verdict result without a verdict object");
    const v = verdict as Record<string, unknown>;
    if (v.outcome === "allow") return { exitCode: 0, stdout: "", stderr: "" };
    if (v.outcome === "deny") {
      return isNonEmptyString(v.reason) ? denyJson(v.reason) : failClosed("deny verdict without a reason");
    }
    return failClosed(`verdict outcome is not exactly allow or deny (got ${JSON.stringify(v.outcome) ?? "undefined"})`);
  }
  if (obj.kind === "refusal") {
    return isNonEmptyString(obj.reason) ? denyJson(obj.reason) : failClosed("refusal without a reason");
  }
  return failClosed(`unknown result kind ${JSON.stringify(obj.kind) ?? "undefined"}`);
}
