import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeShellCall } from "./shell.ts";
import {
  shellEquivalentDeleteCall,
  shellMalformedCall,
  shellOverLongResourceTokenCall,
  shellUnrecognizedVerbCall,
} from "../fixtures/normalizer-calls.ts";

test("normalizeShellCall: a well-formed command produces a clean, resolved ActionRecord", () => {
  const record = normalizeShellCall(shellEquivalentDeleteCall);
  assert.equal(record.source, "parsed");
  assert.deepEqual(record.verbs, ["delete"]);
  assert.deepEqual(record.targets, ["prod/cluster/prod-cluster/pod/payment-worker"]);
  assert.equal(record.environment, "prod");
  assert.equal(record.identity, "agent:story-implementer");
  assert.equal(record.deferred, false);
  assert.deepEqual(record.unresolved, []);
});

test("normalizeShellCall: a verb outside the action catalog produces unresolved, verbs stays empty (never a silently-passed verb string)", () => {
  const record = normalizeShellCall(shellUnrecognizedVerbCall);
  assert.deepEqual(record.verbs, []);
  assert.ok(record.unresolved.length > 0);
  assert.match(record.unresolved[0] ?? "", /patch/);
  // the resource/cluster facets were still parseable — only the verb is reported unresolved
  assert.deepEqual(record.targets, ["prod/cluster/prod-cluster/pod/payment-worker"]);
});

test("normalizeShellCall: a malformed command reports EVERY unresolvable facet, targets stay empty", () => {
  const record = normalizeShellCall(shellMalformedCall);
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.some((u) => u.includes("resource")));
  assert.ok(record.unresolved.some((u) => u.includes("--context")));
});

test("normalizeShellCall: deferred passes through unchanged (SUR-09 — the kernel, not the normalizer, treats it as execution)", () => {
  const record = normalizeShellCall({ ...shellEquivalentDeleteCall, deferred: true });
  assert.equal(record.deferred, true);
});

// --- app-security-reviewer, S3 review, Finding #1 (Issue #65) regression --------------------
//
// Fixed: `const [rt, rn] = token.split("/")` silently discarded any segment beyond the first two.
// A resource token with a THIRD, smuggled segment ("secrets/db-password/extra-smuggled-segment")
// used to resolve cleanly to resourceName: "db-password", unresolved: [] — the exact PoC the
// reviewer ran directly against the shipped module. The fix requires the split to produce EXACTLY
// 2 non-empty parts; anything else is now reported via `unresolved`, identically to the
// no-resource-token case, never partially accepted.

test("normalizeShellCall (Issue #65 regression): a resource token with a THIRD, smuggled segment is reported unresolved, never silently truncated to the first two", () => {
  const record = normalizeShellCall(shellOverLongResourceTokenCall);
  assert.equal(record.targets.length, 0, "an over-long resource token must produce NO target, not a truncated one");
  assert.ok(record.unresolved.some((u) => u.includes("resource")), "the resource facet itself must be reported unresolved");
  // pinned: the pre-fix behavior silently resolved to "db-password" — must never appear anywhere
  assert.ok(
    !record.targets.some((t) => t.includes("db-password")),
    "the smuggled-segment token must never resolve to a target at all, silently or otherwise",
  );
});

test("normalizeShellCall (Issue #65 regression, boundary): a resource token with only ONE segment (no '/') is still reported unresolved, unchanged behavior", () => {
  const record = normalizeShellCall({ ...shellEquivalentDeleteCall, command: "kubectl delete pod --context=prod-cluster" });
  assert.deepEqual(record.targets, []);
  assert.ok(record.unresolved.some((u) => u.includes("resource")));
});
