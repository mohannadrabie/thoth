// Fixture raw calls for src/policy/normalizer/{shell,structured-cluster}.ts's tests, and the
// POL-04/SUR-01 parity proof in src/policy/normalizer/registry.test.ts. Deliberately reuses the
// SAME rule fixture data S2 already shipped and reviewed (src/policy/fixtures/rules.ts's
// shippedDefaultsLayer/centralLayer/projectLayer, CONFLICTING_RULE_ID) by constructing a target
// string that matches that rule's "prod/" prefix pattern — proves real registry -> kernel
// integration against already-reviewed fixture data, not a fresh rule invented just for this
// story.
import type { ShellCall } from "../normalizer/shell.ts";
import type { StructuredClusterCall } from "../normalizer/structured-cluster.ts";

const IDENTITY = "agent:story-implementer";
const ENVIRONMENT = "prod";
const CLUSTER = "prod-cluster";

/** POL-04 parity pair: same verb (delete), same resource, same cluster/environment — the target
 * string is byte-identical across both raw call shapes, by construction of buildClusterTarget,
 * and (because it's prefixed "prod/") matches rules.ts's CONFLICTING_RULE_ID rule. */
export const structuredClusterDeleteCall: StructuredClusterCall = {
  verb: "delete",
  resourceType: "pod",
  resourceName: "payment-worker",
  cluster: CLUSTER,
  environment: ENVIRONMENT,
  identity: IDENTITY,
};

export const shellEquivalentDeleteCall: ShellCall = {
  command: `kubectl delete pod/payment-worker --context=${CLUSTER}`,
  environment: ENVIRONMENT,
  identity: IDENTITY,
};

/** Criterion 6 (ADR-0021 §3.2 / SUR-02): a verb outside the action catalog ("patch" is not in
 * KNOWN_VERBS). Neither normalizer may silently pass an unrecognized verb through as if it were
 * classified — both must report it via `unresolved` instead. */
export const structuredClusterUnrecognizedVerbCall: StructuredClusterCall = {
  ...structuredClusterDeleteCall,
  verb: "patch",
};

export const shellUnrecognizedVerbCall: ShellCall = {
  command: `kubectl patch pod/payment-worker --context=${CLUSTER}`,
  environment: ENVIRONMENT,
  identity: IDENTITY,
};

/** Malformed shell command — no recognizable resource token and no --context flag — proving the
 * shell normalizer reports EVERY unresolvable facet, not just the verb. */
export const shellMalformedCall: ShellCall = {
  command: "kubectl delete",
  environment: ENVIRONMENT,
  identity: IDENTITY,
};

/** app-security-reviewer, S3 review, Finding #1 (Issue #65) exact repro: a resource token with a
 * THIRD, smuggled "/"-segment beyond the documented 2-segment shape. Before the fix, `const [rt,
 * rn] = token.split("/")` silently discarded "extra-smuggled-segment" and resolved cleanly to
 * resourceName: "db-password" with `unresolved: []` — this fixture pins that it now reports
 * unresolved instead. */
export const shellOverLongResourceTokenCall: ShellCall = {
  command: "kubectl delete secrets/db-password/extra-smuggled-segment --context=prod",
  environment: ENVIRONMENT,
  identity: IDENTITY,
};

/** app-security-reviewer, S3 review, Finding #2 (Issue #66) exact repro: a structured call whose
 * `resourceName` is itself padded with an embedded "/" — before the fix, this silently produced a
 * fully-resolved record whose target no longer exact-matched the canonical
 * "prod/cluster/prod-cluster/secrets/root-password" a policy author would write an exact-match
 * deny rule against. */
export const structuredClusterDelimiterInjectionCall: StructuredClusterCall = {
  verb: "delete",
  resourceType: "secrets",
  resourceName: "root-password/x",
  cluster: CLUSTER,
  environment: ENVIRONMENT,
  identity: IDENTITY,
};

/** The intended, canonical target the injection above must NOT be indistinguishable from. */
export const CANONICAL_SECRETS_TARGET = `${ENVIRONMENT}/cluster/${CLUSTER}/secrets/root-password`;
