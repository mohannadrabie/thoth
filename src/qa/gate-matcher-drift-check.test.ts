import { test } from "node:test";
import assert from "node:assert/strict";
import { ONE_DIRECTIONAL_DISCLOSURE, checkMatcherDrift, computeMatcherDrift, extractMatcherToolNames } from "./gate-matcher-drift-check.ts";

test("extractMatcherToolNames: a pipe-separated matcher string yields one name per segment", () => {
  const settings = { hooks: { PreToolUse: [{ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [] }] } };
  assert.deepEqual(extractMatcherToolNames(settings), ["Edit", "Write", "MultiEdit", "NotebookEdit"]);
});

test("extractMatcherToolNames: a single-tool matcher string yields exactly one name", () => {
  const settings = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] } };
  assert.deepEqual(extractMatcherToolNames(settings), ["Bash"]);
});

test("extractMatcherToolNames: no hooks key, or malformed input, returns an empty array without throwing", () => {
  assert.deepEqual(extractMatcherToolNames({}), []);
  assert.deepEqual(extractMatcherToolNames(null), []);
  assert.deepEqual(extractMatcherToolNames("not an object"), []);
});

test("extractMatcherToolNames: a hook group with no matcher key at all is skipped, not a throw", () => {
  const settings = { hooks: { SessionStart: [{ hooks: [] }] } };
  assert.deepEqual(extractMatcherToolNames(settings), []);
});

test("computeMatcherDrift: every referenced name present in the vendored set produces zero drift", () => {
  assert.deepEqual(computeMatcherDrift(["Bash", "Read"], new Set(["Bash", "Read", "Edit"])), []);
});

test("computeMatcherDrift: a referenced name absent from the vendored set is reported", () => {
  const drift = computeMatcherDrift(["Bash", "TotallyMadeUpTool"], new Set(["Bash"]));
  assert.equal(drift.length, 1);
  assert.match(drift[0] ?? "", /TotallyMadeUpTool/);
});

test("computeMatcherDrift: a duplicate referenced name is reported only once", () => {
  const drift = computeMatcherDrift(["Ghost", "Ghost", "Ghost"], new Set([]));
  assert.equal(drift.length, 1);
});

test("checkMatcherDrift: the one-directional disclosure text is ALWAYS present, on a passing run too", () => {
  const result = checkMatcherDrift(["Bash"], ["Bash"], new Set(["Bash"]));
  assert.equal(result.ok, true);
  assert.ok(result.details.includes(ONE_DIRECTIONAL_DISCLOSURE));
});

test("checkMatcherDrift: the one-directional disclosure text is ALSO present on a failing run", () => {
  const result = checkMatcherDrift(["Ghost"], [], new Set(["Bash"]));
  assert.equal(result.ok, false);
  assert.ok(result.details.includes(ONE_DIRECTIONAL_DISCLOSURE));
});

test("checkMatcherDrift: this repo's OWN real classification catalog + real .claude/settings.json matchers produce zero drift against the real vendored snapshot", async () => {
  const { loadBuiltinToolClassificationLayer, loadBuiltinToolInventory } = await import("../policy/tools/builtin-tool-inventory.ts");
  const { readFile } = await import("node:fs/promises");
  const settings: unknown = JSON.parse(await readFile(".claude/settings.json", "utf8"));
  const inventory = loadBuiltinToolInventory();
  const classificationNames = loadBuiltinToolClassificationLayer().tools.map((t) => t.name);
  const matcherNames = extractMatcherToolNames(settings);
  const result = checkMatcherDrift(classificationNames, matcherNames, new Set(inventory.tools));
  assert.equal(result.ok, true, JSON.stringify(result.details));
});
