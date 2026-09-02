import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNormalizerRegistryPurity, scanRegistrySource } from "./normalizer-registry-purity-check.ts";

const repoRoot = process.cwd();

// --- scanRegistrySource -----------------------------------------------------

test("scanRegistrySource: a clean registry (no sibling import, no switch) produces zero violations", () => {
  const source = [
    'import type { ActionRecord } from "../kernel/action-record.ts";',
    "const registry = new Map();",
    "export function registerNormalizer(entry) { registry.set(entry.toolType, entry); }",
  ].join("\n");
  assert.deepEqual(scanRegistrySource(source, "src/policy/normalizer/registry.ts"), []);
});

test("scanRegistrySource: an import of a sibling file in the same directory is a sibling-normalizer-import violation", () => {
  const source = 'import { normalizeShellCall } from "./shell.ts";\nexport const x = 1;';
  const violations = scanRegistrySource(source, "src/policy/normalizer/registry.ts");
  assert.ok(violations.some((v) => v.kind === "sibling-normalizer-import"));
});

test("scanRegistrySource: an import that resolves OUTSIDE the registry's own directory is NOT a sibling-normalizer-import violation", () => {
  const source = 'import type { ActionRecord } from "../kernel/action-record.ts";\nexport const x = 1;';
  const violations = scanRegistrySource(source, "src/policy/normalizer/registry.ts");
  assert.deepEqual(
    violations.filter((v) => v.kind === "sibling-normalizer-import"),
    [],
  );
});

test("scanRegistrySource: a switch statement is a dispatch-chain-switch violation", () => {
  const source = 'export function f(t) { switch (t) { case "shell": return 1; default: return 0; } }';
  const violations = scanRegistrySource(source, "src/policy/normalizer/registry.ts");
  assert.ok(violations.some((v) => v.kind === "dispatch-chain-switch"));
});

test("scanRegistrySource: the word 'switch' inside a comment is NOT flagged", () => {
  const source = "// do not switch on tool type here\nexport const x = 1;";
  assert.deepEqual(scanRegistrySource(source, "src/policy/normalizer/registry.ts"), []);
});

// --- checkNormalizerRegistryPurity (integration, real fixture files on disk) -----------

test("checkNormalizerRegistryPurity: the CLEAN self-test fixture passes", async () => {
  const result = await checkNormalizerRegistryPurity(
    repoRoot,
    "src/qa/selftest-fixture/normalizer-registry-purity/clean/registry.ts",
  );
  assert.equal(result.ok, true, result.details.join("\n"));
  assert.equal(result.vacuous, false);
});

test("checkNormalizerRegistryPurity: the VIOLATING self-test fixture fails, naming both violation classes", async () => {
  const result = await checkNormalizerRegistryPurity(
    repoRoot,
    "src/qa/selftest-fixture/normalizer-registry-purity/violating/registry.ts",
  );
  assert.equal(result.ok, false);
  const details = result.details.join("\n");
  assert.match(details, /sibling-normalizer-import/);
  assert.match(details, /dispatch-chain-switch/);
});

test("checkNormalizerRegistryPurity: a nonexistent path -> vacuous pass, disclosed loudly", async () => {
  const result = await checkNormalizerRegistryPurity(repoRoot, "src/qa/selftest-fixture/does-not-exist/registry.ts");
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("checkNormalizerRegistryPurity: the REAL src/policy/normalizer/registry.ts is itself pure (proof, not just self-test fixtures)", async () => {
  const result = await checkNormalizerRegistryPurity(repoRoot);
  assert.equal(result.ok, true, result.details.join("\n"));
  assert.equal(result.vacuous, false, "the real registry.ts must exist by S3, not be empty");
});
