// POL-04: the structured-protocol side of the parity requirement — an already-typed cluster call,
// no string parsing needed (SUR-01: "Cloud and cluster tools delivered over a structured protocol
// are evaluated. Fixture proves it").
import type { ActionRecord } from "../kernel/action-record.ts";
import { resolveVerb } from "./action-catalog.ts";
import { buildClusterTarget } from "./target-format.ts";
import { registerNormalizer } from "./registry.ts";

export interface StructuredClusterCall {
  verb: string;
  resourceType: string;
  resourceName: string;
  cluster: string;
  environment: string;
  identity: string;
  deferred?: boolean;
}

export function normalizeStructuredClusterCall(raw: StructuredClusterCall): ActionRecord {
  const unresolved: string[] = [];
  const resolvedVerb = resolveVerb(raw.verb);
  if (!resolvedVerb) unresolved.push(`verb "${raw.verb}"`);

  // app-security-reviewer, S3 review, Finding #2 (Issue #66): a typed field (resourceName here,
  // or any of the other three) containing the target format's own "/" delimiter used to silently
  // produce a longer, ambiguous target string with no signal that anything was wrong — the record
  // reported itself fully resolved even though the target no longer exact-matched what a policy
  // author would have written a deny rule against. buildClusterTarget now returns undefined for a
  // contaminated field; that MUST be reported via `unresolved`, not silently swallowed.
  const target = buildClusterTarget({
    environment: raw.environment,
    cluster: raw.cluster,
    resourceType: raw.resourceType,
    resourceName: raw.resourceName,
  });
  const targets: string[] = [];
  if (target) {
    targets.push(target);
  } else {
    unresolved.push('target field(s) contain the delimiter character "/"');
  }

  return {
    source: "structured",
    verbs: resolvedVerb ? [resolvedVerb] : [],
    targets,
    environment: raw.environment,
    identity: raw.identity,
    deferred: raw.deferred ?? false,
    unresolved,
  };
}

registerNormalizer({
  toolType: "cluster",
  normalize: (raw) => normalizeStructuredClusterCall(raw as StructuredClusterCall),
});
