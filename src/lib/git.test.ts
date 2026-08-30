import { test } from "node:test";
import assert from "node:assert/strict";
import type { Runner } from "./exec.ts";
import { makeGitOps } from "./git.ts";

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
