import { test } from "node:test";
import assert from "node:assert/strict";
import type { Runner } from "./exec.ts";
import { isZeroSha, makeGitOps, resolveChangedFiles } from "./git.ts";

function fakeRunner(stdout: string): Runner {
  return () => Promise.resolve({ stdout, stderr: "", code: 0 });
}

test("lsTree: keeps blob entries", async () => {
  const runner = fakeRunner("100644 blob abc123\tsrc/foo.ts\n");
  const git = makeGitOps(runner, ".");
  const tree = await git.lsTree("HEAD");
  assert.equal(tree.get("src/foo.ts"), "abc123");
});

test("lsTree: skips submodule gitlink entries (regression — real repo has an `adr` submodule; " +
  "a submodule's commit sha is not fetchable via this repo's own `git cat-file` and must not be " +
  "treated as a scannable blob)", async () => {
  const runner = fakeRunner(
    "100644 blob abc123\tREADME.md\n160000 commit def456\tadr\n",
  );
  const git = makeGitOps(runner, ".");
  const tree = await git.lsTree("HEAD");
  assert.equal(tree.size, 1);
  assert.equal(tree.get("README.md"), "abc123");
  assert.equal(tree.has("adr"), false);
});

test("isZeroSha: recognizes the GitHub Actions all-zero sentinel, rejects a real-looking SHA", () => {
  assert.equal(isZeroSha("0000000000000000000000000000000000000000"), true);
  assert.equal(isZeroSha("0"), true);
  assert.equal(isZeroSha("2992bfb1234567890abcdef1234567890abcdef"), false);
  assert.equal(isZeroSha("HEAD~1"), false);
});

test("resolveChangedFiles (regression, Issue #18 recurrence): zero-SHA base falls back to a full-tree scan via lsTree, WITHOUT ever attempting `git diff`", async () => {
  const runner: Runner = (cmd, args) => {
    if (args[0] === "diff") {
      throw new Error("git diff must never be attempted when base/head is the zero-SHA sentinel");
    }
    if (args[0] === "ls-tree") {
      return Promise.resolve({
        stdout: "100644 blob aaa\tsrc/foo.ts\n100644 blob bbb\tpolicy/a.rule.json\n",
        stderr: "",
        code: 0,
      });
    }
    return Promise.resolve({ stdout: "", stderr: "", code: 0 });
  };
  const git = makeGitOps(runner, ".");
  const result = await resolveChangedFiles(git, "0000000000000000000000000000000000000000", "HEAD");
  assert.notEqual(result, null);
  assert.equal(result?.fullTreeFallback, true);
  assert.deepEqual(result?.changedFiles.sort(), ["policy/a.rule.json", "src/foo.ts"]);
});

test("resolveChangedFiles: a normal, resolvable ref pair uses the real diff, not the full-tree fallback", async () => {
  const runner = fakeRunner("src/changed.ts\n");
  const git = makeGitOps(runner, ".");
  const result = await resolveChangedFiles(git, "HEAD~1", "HEAD");
  assert.deepEqual(result, { changedFiles: ["src/changed.ts"], fullTreeFallback: false });
});

test("resolveChangedFiles: a genuinely bad non-zero ref still returns null (unchanged prior behavior for callers to handle)", async () => {
  const runner: Runner = () => Promise.resolve({ stdout: "", stderr: "fatal: bad revision", code: 128 });
  const git = makeGitOps(runner, ".");
  const result = await resolveChangedFiles(git, "not-a-real-ref", "HEAD");
  assert.equal(result, null);
});
