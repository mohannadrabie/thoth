// Shared target-string convention for cluster-style structured resources, used by BOTH
// src/policy/normalizer/shell.ts and src/policy/normalizer/structured-cluster.ts so a structured
// call and its shell equivalent normalize to the byte-identical target string (POL-04's cross-tool
// equivalence bar: "A structured cluster-mutation call and its shell equivalent yield the same
// verdict").
//
// Not itself a per-tool-type normalizer — POL-12's "zero diff to kernel.ts or any prior normalizer
// file" bar names the kernel and normalizer files specifically (shell.ts, structured-cluster.ts,
// any future one). Extending this file's format to support a new resource shape, when a future
// normalizer needs one, is a data/format extension it depends on, same category as
// action-catalog.ts — not a dispatch-chain edit.
//
// app-security-reviewer, S3 review, Finding #2 (Issue #66): a typed field value containing this
// format's own "/" delimiter used to silently produce a target string with an extra, ambiguous
// path segment — indistinguishable in shape from a genuinely deeper resource, and capable of
// bypassing an exact-match deny rule keyed on the canonical (undelimited) resource name while the
// record reported itself fully resolved. `buildClusterTarget` now validates every part for the
// delimiter and returns `undefined` when contaminated; BOTH call sites (shell.ts,
// structured-cluster.ts) MUST treat `undefined` as an unresolved facet, never as "no target".
export interface ClusterTargetParts {
  environment: string;
  cluster: string;
  resourceType: string;
  resourceName: string;
}

/** Returns `undefined` when any part contains the delimiter character ("/") itself — the joined
 * string would then be ambiguously re-splittable and MUST NOT be treated as a clean, resolved
 * target. Callers push to `ActionRecord.unresolved` in that case (see shell.ts / structured-
 * cluster.ts), never silently fall back to an empty targets array. */
export function buildClusterTarget(parts: ClusterTargetParts): string | undefined {
  const values = [parts.environment, parts.cluster, parts.resourceType, parts.resourceName];
  if (values.some((v) => v.includes("/"))) return undefined;
  return `${parts.environment}/cluster/${parts.cluster}/${parts.resourceType}/${parts.resourceName}`;
}
