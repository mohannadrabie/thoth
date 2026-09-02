import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStructuredClusterCall } from "./structured-cluster.ts";
import {
  CANONICAL_SECRETS_TARGET,
  structuredClusterDelimiterInjectionCall,
  structuredClusterDeleteCall,
  structuredClusterUnrecognizedVerbCall,
} from "../fixtures/normalizer-calls.ts";

test("normalizeStructuredClusterCall: a well-formed call produces a clean, resolved ActionRecord", () => {
  const record = normalizeStructuredClusterCall(structuredClusterDeleteCall);
  assert.equal(record.source, "structured");
  assert.deepEqual(record.verbs, ["delete"]);
  assert.deepEqual(record.targets, ["prod/cluster/prod-cluster/pod/payment-worker"]);
  assert.equal(record.environment, "prod");
  assert.equal(record.identity, "agent:story-implementer");
  assert.equal(record.deferred, false);
  assert.deepEqual(record.unresolved, []);
});

test("normalizeStructuredClusterCall: a verb outside the action catalog produces unresolved, verbs stays empty (never a silently-passed verb string)", () => {
  const record = normalizeStructuredClusterCall(structuredClusterUnrecognizedVerbCall);
  assert.deepEqual(record.verbs, []);
  assert.ok(record.unresolved.length > 0);
  assert.match(record.unresolved[0] ?? "", /patch/);
  // target extraction is independent of verb resolution — still populated
  assert.deepEqual(record.targets, ["prod/cluster/prod-cluster/pod/payment-worker"]);
});

test("normalizeStructuredClusterCall: deferred passes through unchanged (SUR-09 — the kernel, not the normalizer, treats it as execution)", () => {
  const record = normalizeStructuredClusterCall({ ...structuredClusterDeleteCall, deferred: true });
  assert.equal(record.deferred, true);
});

test("normalizeStructuredClusterCall + normalizeShellCall parity: same target string and verbs from independently-parsed raw call shapes", () => {
  const structured = normalizeStructuredClusterCall(structuredClusterDeleteCall);
  assert.deepEqual(structured.targets, ["prod/cluster/prod-cluster/pod/payment-worker"]);
  assert.deepEqual(structured.verbs, ["delete"]);
});

// --- app-security-reviewer, S3 review, Finding #2 (Issue #66) regression --------------------
//
// Fixed: buildClusterTarget performed zero delimiter validation, so a resourceName padded with an
// embedded "/" ("root-password/x") silently produced a fully-resolved record whose target string
// no longer exact-matched the canonical "prod/cluster/prod-cluster/secrets/root-password" a policy
// author would write an exact-match deny rule against — the exact PoC the reviewer ran directly
// against the shipped module.

test("normalizeStructuredClusterCall (Issue #66 regression): a resourceName padded with an embedded '/' is reported unresolved, never silently joined into a longer target", () => {
  const record = normalizeStructuredClusterCall(structuredClusterDelimiterInjectionCall);
  assert.equal(record.targets.length, 0, "a delimiter-contaminated field must produce NO target, not a spoofed one");
  assert.ok(
    record.unresolved.some((u) => u.includes("/")),
    "the delimiter-contamination facet must be reported unresolved",
  );
  // pinned: the pre-fix behavior produced a target string that does NOT exact-match the canonical
  // one but LOOKS like a deeper resource — must never appear at all, resolved or not.
  assert.ok(!record.targets.includes(CANONICAL_SECRETS_TARGET + "/x"));
});

test("normalizeStructuredClusterCall (Issue #66 regression, differential): the canonical (non-injected) resourceName still resolves cleanly to the exact target an exact-match deny rule would be written against", () => {
  const clean = normalizeStructuredClusterCall({
    ...structuredClusterDelimiterInjectionCall,
    resourceName: "root-password",
  });
  assert.deepEqual(clean.targets, [CANONICAL_SECRETS_TARGET]);
  assert.deepEqual(clean.unresolved, []);
});
