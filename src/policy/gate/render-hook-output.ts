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
//
// TERMINAL SANITIZATION (Issue #312, second site after #294): a kernel verdict's `reason` is built
// in src/policy/kernel/kernel.ts::decide() from a rule's `rationale` or `id` — both policy-authored,
// schema-validated but not terminal-sanitized at that layer. This is the render boundary for the
// PreToolUse hook's stdout (the same role printer.ts/print-cli.ts play for `policy:print`, #294), so
// EVERY reason that reaches denyJson() — a verdict-deny reason AND a pre-kernel refusal reason (the
// latter is mostly fixed template text, except the bounded reflection of the untrusted tool_name) —
// is passed through `sanitize` here, one call site for both.
//
// `sanitize` is a REQUIRED parameter (no default), an injected port following the same pattern
// GatePorts already uses in decide-tool-call.ts to keep this pure and importless: src/policy/gate/**
// may import neither node:* nor anything under config/ (G15, gate-structure.test.ts), and
// src/policy/kernel/** may not import anything outside its own directory (kernel-purity-check.ts) —
// so the canonical src/policy/config/sanitize.ts implementation cannot be imported from either
// layer. The hook (hooks/pretooluse-kernel-gate.mjs, already importing directly from config/ with no
// new plumbing) supplies the real `sanitizeForTerminal` at the one call site. No default parameter
// on purpose: a silent identity fallback would let a future caller forget the real sanitizer and
// silently reopen the hole (fail-loud, matching this repo's kernel-purity-check convention).
//
// EMPTY-AFTER-SANITIZE is fail-closed, not silently emitted: Verdict.reason is documented "always
// populated, never blank" (verdict.ts). A reason that is non-empty pre-sanitize but strips to ""
// (e.g. a rationale of only control characters) is treated exactly like the pre-existing "empty
// reason" case: exit 2, not a deny JSON with a blank permissionDecisionReason. Both shapes block the
// call either way, so this is a signal-shape choice, not a fail-open risk.
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

/** Sanitizes `reason` and renders the deny JSON, or fails closed (exit 2) if sanitizing collapsed a
 * non-empty reason to an empty string — never emit a blank `permissionDecisionReason`. */
function sanitizedDenyJson(reason: string, sanitize: (text: string) => string): HookOutput {
  const cleaned = sanitize(reason);
  return isNonEmptyString(cleaned) ? denyJson(cleaned) : failClosed("reason was non-empty but became empty after terminal sanitization");
}

export function renderHookOutput(result: GateResult, sanitize: (text: string) => string): HookOutput {
  const r: unknown = result;
  if (typeof r !== "object" || r === null) return failClosed("the gate result is not an object");
  const obj = r as Record<string, unknown>;
  if (obj.kind === "verdict") {
    const verdict = obj.verdict;
    if (typeof verdict !== "object" || verdict === null) return failClosed("verdict result without a verdict object");
    const v = verdict as Record<string, unknown>;
    if (v.outcome === "allow") return { exitCode: 0, stdout: "", stderr: "" };
    if (v.outcome === "deny") {
      return isNonEmptyString(v.reason) ? sanitizedDenyJson(v.reason, sanitize) : failClosed("deny verdict without a reason");
    }
    return failClosed(`verdict outcome is not exactly allow or deny (got ${JSON.stringify(v.outcome) ?? "undefined"})`);
  }
  if (obj.kind === "refusal") {
    return isNonEmptyString(obj.reason) ? sanitizedDenyJson(obj.reason, sanitize) : failClosed("refusal without a reason");
  }
  return failClosed(`unknown result kind ${JSON.stringify(obj.kind) ?? "undefined"}`);
}
