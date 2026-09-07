import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkManifestCount, findHooksManifests } from "./gate-manifest-check.ts";

function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "thoth-gate-manifest-test-"));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

test("checkManifestCount: exactly one manifest passes", () => {
  const result = checkManifestCount(["settings.json"]);
  assert.equal(result.ok, true);
});

test("checkManifestCount: zero manifests fails (no gate manifest at all)", () => {
  const result = checkManifestCount([]);
  assert.equal(result.ok, false);
  assert.match(result.summary, /0 files/);
});

test("checkManifestCount: two or more manifests fails and lists every one, not just the count", () => {
  const result = checkManifestCount(["a/settings.json", "b/settings.json"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.details, ["a/settings.json", "b/settings.json"]);
});

test("findHooksManifests: finds a single JSON file defining a top-level hooks key", async () => {
  await withTempDir(async (root) => {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [] } }));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }));
    const manifests = await findHooksManifests(root);
    assert.deepEqual(manifests, [".claude/settings.json"]);
  });
});

test("findHooksManifests: two files defining a top-level hooks key are BOTH found (SUR-13's real failure shape)", async () => {
  await withTempDir(async (root) => {
    writeFileSync(join(root, "a.json"), JSON.stringify({ hooks: {} }));
    writeFileSync(join(root, "b.json"), JSON.stringify({ hooks: {} }));
    const manifests = await findHooksManifests(root);
    assert.deepEqual(manifests, ["a.json", "b.json"]);
  });
});

test("findHooksManifests: a malformed (non-JSON) file is silently skipped, not a crash", async () => {
  await withTempDir(async (root) => {
    writeFileSync(join(root, "broken.json"), "{ not valid json [[[");
    const manifests = await findHooksManifests(root);
    assert.deepEqual(manifests, []);
  });
});

test("findHooksManifests: a JSON file with no hooks key is not counted", async () => {
  await withTempDir(async (root) => {
    writeFileSync(join(root, "unrelated.json"), JSON.stringify({ name: "x" }));
    const manifests = await findHooksManifests(root);
    assert.deepEqual(manifests, []);
  });
});

test("findHooksManifests: this repo's real .claude/settings.json is found as the (only) real manifest", async () => {
  const manifests = await findHooksManifests(process.cwd());
  assert.deepEqual(manifests, [".claude/settings.json"]);
});
