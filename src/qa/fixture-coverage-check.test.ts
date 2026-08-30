import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCoverage } from "./fixture-coverage-check.ts";
import { discoverFixtures, discoverRules } from "./policy-fixtures.ts";

test("QA-01: 0 rules -> vacuous pass, disclosed", () => {
  const result = checkCoverage([], []);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
  assert.match(result.summary, /0 policy rules/);
});

test("QA-01: rule with both positive and negative fixtures -> real pass", () => {
  const result = checkCoverage(
    [{ id: "POL-TEST-1", file: "a.rule.json" }],
    [
      { ruleId: "POL-TEST-1", kind: "positive", file: "a.pos.fixture.json" },
      { ruleId: "POL-TEST-1", kind: "negative", file: "a.neg.fixture.json" },
    ],
  );
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, false);
});

test("QA-01: rule missing a negative fixture -> FAIL, real gate (AC6 self-test)", () => {
  const result = checkCoverage(
    [{ id: "POL-TEST-1", file: "a.rule.json" }],
    [{ ruleId: "POL-TEST-1", kind: "positive", file: "a.pos.fixture.json" }],
  );
  assert.equal(result.ok, false);
  assert.equal(result.vacuous, false);
  assert.match(result.details[0] ?? "", /missing negative fixture/);
});

test("QA-01: rule with zero fixtures at all -> FAIL naming both missing kinds", () => {
  const result = checkCoverage([{ id: "POL-TEST-2", file: "b.rule.json" }], []);
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /missing positive and negative fixture/);
});

test("QA-01: end-to-end against a real fixture tree missing coverage (AC6, on disk)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qa01-"));
  try {
    await mkdir(join(dir, "policy"), { recursive: true });
    await writeFile(
      join(dir, "policy", "deny-rm-rf.rule.json"),
      JSON.stringify({ id: "POL-DENY-RM-RF", description: "test rule" }),
    );
    await writeFile(
      join(dir, "policy", "deny-rm-rf.positive.fixture.json"),
      JSON.stringify({ ruleId: "POL-DENY-RM-RF", kind: "positive" }),
    );
    // deliberately no negative fixture

    const rules = await discoverRules(join(dir, "policy"));
    const fixtures = await discoverFixtures(join(dir, "policy"));
    const result = checkCoverage(rules, fixtures);

    assert.equal(result.ok, false, "coverage check must fail the build on real missing coverage");
    assert.match(result.details.join("\n"), /POL-DENY-RM-RF/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
