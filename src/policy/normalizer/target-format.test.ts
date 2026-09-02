import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClusterTarget } from "./target-format.ts";

const CLEAN_PARTS = { environment: "prod", cluster: "prod-cluster", resourceType: "secrets", resourceName: "root-password" };

test("buildClusterTarget: clean parts join into the documented format", () => {
  assert.equal(buildClusterTarget(CLEAN_PARTS), "prod/cluster/prod-cluster/secrets/root-password");
});

// --- app-security-reviewer, S3 review, Finding #2 (Issue #66) regression --------------------
//
// Fixed: zero delimiter validation on any of the four typed field values — a value itself
// containing "/" used to silently produce a target string with an extra, ambiguous path segment.
// buildClusterTarget now returns undefined for ANY contaminated field, not just resourceName.

test("buildClusterTarget (Issue #66 regression): resourceName containing '/' -> undefined, not a silently-longer string", () => {
  assert.equal(buildClusterTarget({ ...CLEAN_PARTS, resourceName: "root-password/x" }), undefined);
});

test("buildClusterTarget (Issue #66 regression, every field): each of environment/cluster/resourceType/resourceName independently triggers rejection when it contains '/'", () => {
  assert.equal(buildClusterTarget({ ...CLEAN_PARTS, environment: "prod/staging" }), undefined);
  assert.equal(buildClusterTarget({ ...CLEAN_PARTS, cluster: "prod-cluster/extra" }), undefined);
  assert.equal(buildClusterTarget({ ...CLEAN_PARTS, resourceType: "secrets/extra" }), undefined);
  assert.equal(buildClusterTarget({ ...CLEAN_PARTS, resourceName: "root-password/extra" }), undefined);
});

test("buildClusterTarget: a resourceName that merely CONTAINS a valid-looking segment but has no '/' is unaffected", () => {
  assert.equal(
    buildClusterTarget({ ...CLEAN_PARTS, resourceName: "root-password-extra" }),
    "prod/cluster/prod-cluster/secrets/root-password-extra",
  );
});
