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

// GitHub Issue #172: lsFilesWorkingTree must combine tracked (--cached) and untracked-but-not-
// ignored (--others --exclude-standard) paths — the real working-tree file set, not a ref-pinned
// `lsTree("HEAD")` snapshot. Two separate git calls (see git.ts's own comment for why); this pins
// both being invoked and their output combined, NUL-separated parsing included.
test("lsFilesWorkingTree: combines --cached (mode-filtered) and --others output into one file list", async () => {
  const calls: string[][] = [];
  const runner: Runner = (cmd, args) => {
    assert.equal(cmd, "git");
    calls.push(args);
    if (args.includes("--cached")) {
      return Promise.resolve({
        stdout: "100644 aaa 0\tsrc/foo.ts\0",
        stderr: "",
        code: 0,
      });
    }
    return Promise.resolve({ stdout: "docs/new-untracked.md\0", stderr: "", code: 0 });
  };
  const git = makeGitOps(runner, ".");
  const files = await git.lsFilesWorkingTree();
  assert.deepEqual(files, ["src/foo.ts", "docs/new-untracked.md"]);
  assert.deepEqual(calls, [
    ["ls-files", "-z", "-s", "--cached"],
    ["ls-files", "-z", "--others", "--exclude-standard"],
  ]);
});

test("lsFilesWorkingTree (regression): a submodule gitlink (mode 160000, e.g. this repo's own `adr/`) is excluded, not treated as a scannable file", async () => {
  const runner: Runner = (cmd, args) => {
    if (args.includes("--cached")) {
      // NOTE: `\x00`, not `\0` — `\0` immediately followed by a digit (this fixture's mode
      // `160000` starts with `1`) is a legacy octal escape, not a NUL separator; using `\0` here
      // silently merged both entries into one garbled string in an earlier draft of this test.
      return Promise.resolve({
        stdout: "100644 aaa 0\tREADME.md\x00160000 bbb 0\tadr\x00",
        stderr: "",
        code: 0,
      });
    }
    return Promise.resolve({ stdout: "", stderr: "", code: 0 });
  };
  const git = makeGitOps(runner, ".");
  const files = await git.lsFilesWorkingTree();
  assert.deepEqual(files, ["README.md"], "the 160000 submodule gitlink entry must not appear in the file list");
});

test("lsFilesWorkingTree (regression, Issue #178): an --others entry ending in '/' (an untracked nested git repo, which `git ls-files` reports as a directory rather than recursing into it) is excluded from the returned list", async () => {
  const runner: Runner = (cmd, args) => {
    if (args.includes("--cached")) {
      return Promise.resolve({ stdout: "100644 aaa 0\tREADME.md\0", stderr: "", code: 0 });
    }
    // Real `git ls-files -z --others --exclude-standard` output for a checkout containing an
    // untracked nested git repo directory `zz-nested/`: the directory itself, trailing slash,
    // never its contents (git cannot recurse into a separate repo's index).
    return Promise.resolve({ stdout: "docs/new-untracked.md\0zz-nested/\0", stderr: "", code: 0 });
  };
  const git = makeGitOps(runner, ".");
  const files = await git.lsFilesWorkingTree();
  assert.deepEqual(
    files,
    ["README.md", "docs/new-untracked.md"],
    "the nested-repo directory entry ('zz-nested/') must not appear in the file list",
  );
});

test("lsFilesWorkingTree: an empty working tree yields an empty list, not [\"\"]", async () => {
  const runner: Runner = () => Promise.resolve({ stdout: "", stderr: "", code: 0 });
  const git = makeGitOps(runner, ".");
  const files = await git.lsFilesWorkingTree();
  assert.deepEqual(files, []);
});
