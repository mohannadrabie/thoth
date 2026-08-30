import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseRegistry, validateRegistry } from "./recurring-findings-registry.ts";

const VALID_TABLE = `# Registry
| Class | First seen | Second seen | Status |
|---|---|---|---|
| fabricated citation | 2026-08-10 docs/reviews/a.md | 2026-08-20 docs/reviews/b.md | QA-14 reference-resolver |
`;

test("QA-13: 0 rows -> vacuous pass, disclosed", () => {
  const parsed = parseRegistry("# Registry\n| Class | First seen | Second seen | Status |\n|---|---|---|---|\n");
  const result = validateRegistry(parsed);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("QA-13: well-formed row -> real pass", () => {
  const result = validateRegistry(parseRegistry(VALID_TABLE));
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, false);
});

test("QA-13: missing table entirely -> FAIL", () => {
  const result = validateRegistry(parseRegistry("# Registry\nnothing here\n"));
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /No registry table found/);
});

test("QA-13: placeholder Status ('-') -> FAIL", () => {
  const bad = `| Class | First seen | Second seen | Status |
|---|---|---|---|
| some class | 2026-08-10 docs/reviews/a.md | 2026-08-20 docs/reviews/b.md | - |
`;
  const result = validateRegistry(parseRegistry(bad));
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /Status/);
});

test("QA-13: bare date with no citation in 'First seen' -> FAIL", () => {
  const bad = `| Class | First seen | Second seen | Status |
|---|---|---|---|
| some class | 2026-08-10 | 2026-08-20 docs/reviews/b.md | pending lint |
`;
  const result = validateRegistry(parseRegistry(bad));
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /First seen/);
});

test("QA-13: the real repo registry file parses and validates clean (non-vacuous: Issue #18's recurrence is logged, S1 2026-08-30)", async () => {
  const markdown = await readFile("docs/qa/recurring-findings-registry.md", "utf8");
  const result = validateRegistry(parseRegistry(markdown));
  assert.equal(result.ok, true, result.details.join("\n"));
  assert.equal(result.vacuous, false, "the registry now has one logged recurring finding class — no longer vacuous");
});
