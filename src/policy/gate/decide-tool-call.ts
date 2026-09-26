// The gate module (S7 plan section 4; SE ADR-0002/0003): validate a PreToolUse payload, route its
// tool_name, normalize it through the registry, decide it with the ONE kernel, and return a CLOSED
// result. Pure: the loader and the catalog arrive as PORTS the hook adapts from the real
// implementations, so this directory imports nothing from src/policy/config/ and no node:* module
// (G15), and every fail-closed path is testable in memory.
//
// There is no second decision path here. The kernel (kernel.ts decide) is the only thing that
// returns an allow or a deny for a normalized action. The three PRE-KERNEL REFUSALS below carry no
// policy logic; each is an enumerated SUR-10 row and is flagged as the F7 reading for an architect
// ruling (plan section 17 item 2; precedent: the shipped hook's own tool_name refusal):
//   - malformed-input     : the payload, tool_name, or the Bash command is not the expected type
//   - unroutable-tool     : a tool_name outside the routing table (today's behaviour, plan R-B)
//   - policy-load-failure : the loader could not produce a policy (deny, layer and kind only, never
//                           the raw message: Issue #124 / #294)
// A kernel verdict is `allow` or `deny` only (Q5). The catalog port is called only for a route that
// says it needs it.
import { decide } from "../kernel/kernel.ts";
import type { ActionRecord } from "../kernel/action-record.ts";
import type { RuleSet } from "../kernel/rule-types.ts";
import type { VerdictOutcome } from "../kernel/verdict.ts";
import { normalize } from "../normalizer/registry.ts";
import type { MergedToolClassificationSet } from "../tools/classification.ts";
import { routeToolName } from "./tool-routing.ts";

export interface LoadedGatePolicy {
  ok: true;
  ruleSet: RuleSet;
  defaultOutcome: VerdictOutcome;
}
/** Layer and kind only: the port deliberately carries no raw loader message. */
export interface GatePolicyFailure {
  ok: false;
  failedLayer: string;
  reasonKind: string;
}
export type GatePolicyResult = LoadedGatePolicy | GatePolicyFailure;

export interface GatePorts {
  loadPolicy(): GatePolicyResult;
  loadCatalog(): MergedToolClassificationSet;
}

export type RefusalCategory = "malformed-input" | "unroutable-tool" | "policy-load-failure";

export interface GateVerdict {
  outcome: VerdictOutcome;
  reason: string;
  ruleId?: string;
}

export type GateResult =
  | { kind: "verdict"; verdict: GateVerdict; record: ActionRecord }
  | { kind: "refusal"; category: RefusalCategory; reason: string };

/** The untrusted tool_name is reflected into a model-visible deny reason, so it is bounded (red-team
 * attack 2: a 400 KB name produced a 400 KB deny). The cap is VISIBLE in the reason. */
const REASON_NAME_CAP = 512;
function bounded(text: string): string {
  return text.length <= REASON_NAME_CAP ? text : `${text.slice(0, REASON_NAME_CAP)}[truncated, ${text.length} characters in all]`;
}

function refuse(category: RefusalCategory, reason: string): GateResult {
  return { kind: "refusal", category, reason };
}

export function decideToolCall(input: unknown, ports: GatePorts): GateResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return refuse("malformed-input", "hook payload is not a JSON object; fail-closed");
  }
  const payload = input as Record<string, unknown>;
  const toolName = payload.tool_name;
  if (typeof toolName !== "string" || toolName.length === 0) {
    return refuse("malformed-input", `tool_name is missing or not a non-empty string (got ${bounded(JSON.stringify(toolName) ?? "undefined")}); fail-closed`);
  }
  const route = routeToolName(toolName);
  if (route === undefined) {
    return refuse("unroutable-tool", `the gate evaluates only Bash and mcp__ tool names; got tool_name=${bounded(JSON.stringify(toolName))}; fail-closed`);
  }
  const identity = typeof payload.session_id === "string" ? payload.session_id : "unknown";
  const catalog = route.needsCatalog ? ports.loadCatalog() : undefined;
  const built = route.buildRaw({ toolName, toolInput: payload.tool_input, identity, catalog });
  if (!built.ok) return refuse("malformed-input", built.reason);

  const policy = ports.loadPolicy();
  if (!policy.ok) {
    return refuse("policy-load-failure", `policy load failed: layer ${policy.failedLayer}, kind ${policy.reasonKind}; fail-closed`);
  }
  const record = normalize(route.toolType, built.raw);
  const verdict = decide({ rules: policy.ruleSet, defaultOutcome: policy.defaultOutcome }, record);
  return { kind: "verdict", verdict, record };
}
