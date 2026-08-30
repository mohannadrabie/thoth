import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDiffFixtures } from "./diff-fixture-check.ts";

test("QA-02: no policy files changed -> vacuous pass", () => {
  const result = checkDiffFixtures(["src/foo.ts", "README.md"], "policy", [], []);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("QA-02: rule changed, matching fixture also changed -> pass", () => {
  const result = checkDiffFixtures(
    ["policy/a.rule.json", "policy/a.pos.fixture.json"],
    "policy",
    [{ id: "POL-A", file: "a.rule.json" }],
    [{ ruleId: "POL-A", kind: "positive", file: "a.pos.fixture.json" }],
  );
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, false);
});

test("QA-02: rule changed, no fixture change in the same diff -> FAIL (AC7 self-test)", () => {
  const result = checkDiffFixtures(
    ["policy/a.rule.json"],
    "policy",
    [{ id: "POL-A", file: "a.rule.json" }],
    [{ ruleId: "POL-A", kind: "positive", file: "a.pos.fixture.json" }], // exists, but untouched in this diff
  );
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /POL-A/);
  assert.match(result.details[0] ?? "", /no fixture change/);
});

test("QA-02: rule file deleted in diff -> no fixture requirement, vacuous", () => {
  const result = checkDiffFixtures(["policy/removed.rule.json"], "policy", [], []);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
  assert.match(result.summary, /deletions/);
});

test("QA-02: two rules changed, only one has a fixture change -> FAIL naming only the offender", () => {
  const result = checkDiffFixtures(
    ["policy/a.rule.json", "policy/b.rule.json", "policy/a.pos.fixture.json"],
    "policy",
    [
      { id: "POL-A", file: "a.rule.json" },
      { id: "POL-B", file: "b.rule.json" },
    ],
    [
      { ruleId: "POL-A", kind: "positive", file: "a.pos.fixture.json" },
      { ruleId: "POL-B", kind: "positive", file: "b.pos.fixture.json" },
    ],
  );
  assert.equal(result.ok, false);
  assert.equal(result.details.length, 1);
  assert.match(result.details[0] ?? "", /POL-B/);
});
