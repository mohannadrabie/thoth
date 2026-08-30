import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCompleteness, findBareClaims, findMarkerClaims, verifyMarkerClaim } from "./completeness-claim-checker.ts";
import type { Runner } from "../lib/exec.ts";

function fakeRunner(stdout: string): Runner {
  return () => Promise.resolve({ stdout, stderr: "", code: 0 });
}

test("QA-15: no claims -> vacuous pass", async () => {
  const result = await checkCompleteness("plain prose, no numbers claimed as complete", fakeRunner(""));
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("QA-15: parses a marker claim's cmd and expect", () => {
  const claims = findMarkerClaims('All good: [[completeness: cmd="node count.mjs" expect=35]]');
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.cmd, "node count.mjs");
  assert.equal(claims[0]?.expect, 35);
});

test("QA-15: instrument re-run matches claim -> pass", async () => {
  const result = await verifyMarkerClaim(
    { raw: "x", cmd: "count", expect: 35 },
    fakeRunner("counted 35 items"),
  );
  assert.equal(result.ok, true);
});

test("QA-15: instrument re-run produces a DIFFERENT number -> FAIL naming both (the exact defect this closes)", async () => {
  const text = 'All 35 ADRs reviewed. [[completeness: cmd="node docs/adr-cache.mjs --count" expect=35]]';
  const result = await checkCompleteness(text, fakeRunner("the instrument reports: 44 of 37"));
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /says 35/);
  assert.match(result.details.join("\n"), /reports 37/); // last integer in fake stdout
});

test("QA-15: instrument produces no parseable number -> FAIL", async () => {
  const text = '[[completeness: cmd="node whatever.mjs" expect=5]]';
  const result = await checkCompleteness(text, fakeRunner("no numbers here"));
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /no parseable number/);
});

test("QA-15: a bare numeric completeness claim with no marker -> FAIL (no machine-readable instrument reference)", () => {
  const claims = findBareClaims("All 46 checks passed this run.");
  assert.equal(claims.length, 1);
});

test("QA-15: bare claim end-to-end FAILS the gate", async () => {
  const result = await checkCompleteness("Every 12 fixtures ran clean.", fakeRunner(""));
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /NO INSTRUMENT REFERENCE/);
});

test("QA-15: a claim WITH a marker on the same line is not double-flagged as bare", async () => {
  const text = 'All 35 ADRs reviewed. [[completeness: cmd="count" expect=35]]';
  const result = await checkCompleteness(text, fakeRunner("35"));
  assert.equal(result.ok, true, result.details.join("\n"));
});

test("QA-15: N-of-M phrasing ('46 of 39') is caught as a bare claim", () => {
  const claims = findBareClaims("Header said 46 of 39 fixtures.");
  assert.equal(claims.length, 1);
});
