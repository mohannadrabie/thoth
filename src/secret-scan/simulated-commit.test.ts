import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, unlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realRunner } from "../lib/exec.ts";
import { makeGitOps } from "../lib/git.ts";
import { buildSimulatedCommit, parseNameStatusZ } from "./simulated-commit.ts";

async function withIsolatedGitRepo(fn: (repoDir: string) => Promise<void>): Promise<void> {
  const repoDir = await mkdtemp(join(tmpdir(), "thoth-simcommit-"));
  try {
    async function run(...args: string[]): Promise<string> {
      const res = await realRunner("git", args, { cwd: repoDir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
      return res.stdout;
    }
    await run("init", "-q", "-b", "main");
    await run("config", "user.email", "test@example.com");
    await run("config", "user.name", "Test");
    await writeFile(join(repoDir, "README.md"), "hello\n");
    await run("add", ".");
    await run("commit", "-q", "-m", "init");
    await fn(repoDir);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

async function git(repoDir: string, ...args: string[]): Promise<string> {
  const res = await realRunner("git", args, { cwd: repoDir, encoding: "utf8" });
  assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout;
}

test("parseNameStatusZ: plain add/modify/delete records, one path each", () => {
  const raw = "A\0new.ts\0M\0existing.ts\0D\0gone.ts\0";
  const entries = parseNameStatusZ(raw);
  assert.deepEqual(entries, [
    { path: "new.ts", status: "A" },
    { path: "existing.ts", status: "M" },
    { path: "gone.ts", status: "D" },
  ]);
});

test("parseNameStatusZ: a rename expands to a synthetic D (old path) + A (new path)", () => {
  const raw = "R100\0old.ts\0new.ts\0";
  const entries = parseNameStatusZ(raw);
  assert.deepEqual(entries, [
    { path: "old.ts", status: "D" },
    { path: "new.ts", status: "A" },
  ]);
});

test("parseNameStatusZ: a copy expands to only a synthetic A (new path) -- old path is untouched", () => {
  const raw = "C87\0source.ts\0copy.ts\0";
  const entries = parseNameStatusZ(raw);
  assert.deepEqual(entries, [{ path: "copy.ts", status: "A" }]);
});

test("buildSimulatedCommit: a staged new file's content appears in the resulting tree", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "config.js"), 'const key = "AKIAFAKEFAKEFAKEFAKE";\n');
    await git(repoDir, "add", ".");

    const commitSha = await buildSimulatedCommit(realRunner, repoDir);
    const gitOps = makeGitOps(realRunner, repoDir);
    const tree = await gitOps.lsTree(commitSha);
    assert.ok(tree.has("config.js"), "the staged new file must be in the simulated tree");
    const blob = await gitOps.catFileBlob(tree.get("config.js")!);
    assert.match(blob.toString("utf8"), /AKIAFAKEFAKEFAKEFAKE/);
  });
});

test("buildSimulatedCommit: a staged deletion removes the path from the resulting tree", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "doomed.txt"), "bye\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-q", "-m", "add doomed.txt");
    await unlink(join(repoDir, "doomed.txt"));
    await git(repoDir, "add", ".");

    const commitSha = await buildSimulatedCommit(realRunner, repoDir);
    const gitOps = makeGitOps(realRunner, repoDir);
    const tree = await gitOps.lsTree(commitSha);
    assert.ok(!tree.has("doomed.txt"), "a staged deletion must not appear in the simulated tree");
  });
});

test("buildSimulatedCommit: a staged rename moves content -- old path gone, new path present, same bytes", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "old-name.txt"), "some real content, long enough to be detected as a rename\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-q", "-m", "add old-name.txt");
    await git(repoDir, "mv", "old-name.txt", "new-name.txt");

    const commitSha = await buildSimulatedCommit(realRunner, repoDir);
    const gitOps = makeGitOps(realRunner, repoDir);
    const tree = await gitOps.lsTree(commitSha);
    assert.ok(!tree.has("old-name.txt"), "the rename's old path must be gone");
    assert.ok(tree.has("new-name.txt"), "the rename's new path must be present");
    const blob = await gitOps.catFileBlob(tree.get("new-name.txt")!);
    assert.match(blob.toString("utf8"), /some real content/);
  });
});

test("buildSimulatedCommit: real repo's HEAD and .git/index are byte-unchanged before and after a run", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "new.txt"), "content\n");
    await git(repoDir, "add", ".");

    const headBefore = (await git(repoDir, "rev-parse", "HEAD")).trim();
    const indexHashBefore = (await git(repoDir, "hash-object", join(repoDir, ".git", "index"))).trim();

    await buildSimulatedCommit(realRunner, repoDir);

    const headAfter = (await git(repoDir, "rev-parse", "HEAD")).trim();
    const indexHashAfter = (await git(repoDir, "hash-object", join(repoDir, ".git", "index"))).trim();

    assert.equal(headAfter, headBefore, "HEAD must never move");
    assert.equal(indexHashAfter, indexHashBefore, "the real .git/index must be byte-unchanged");
  });
});

test("buildSimulatedCommit: the real .git/index is byte-unchanged even for a repo with staged renames/deletes/adds together", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "keep.txt"), "keep\n");
    await writeFile(join(repoDir, "to-rename.txt"), "rename me, long enough content to be detected as a rename by git's similarity heuristic\n");
    await writeFile(join(repoDir, "to-delete.txt"), "delete me\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-q", "-m", "base");

    await writeFile(join(repoDir, "new.txt"), "brand new\n");
    await git(repoDir, "mv", "to-rename.txt", "renamed.txt");
    await unlink(join(repoDir, "to-delete.txt"));
    await git(repoDir, "add", ".");

    const indexHashBefore = (await git(repoDir, "hash-object", join(repoDir, ".git", "index"))).trim();
    const commitSha = await buildSimulatedCommit(realRunner, repoDir);
    const indexHashAfter = (await git(repoDir, "hash-object", join(repoDir, ".git", "index"))).trim();
    assert.equal(indexHashAfter, indexHashBefore, "the real .git/index must be byte-unchanged");

    const gitOps = makeGitOps(realRunner, repoDir);
    const tree = await gitOps.lsTree(commitSha);
    assert.ok(tree.has("keep.txt"));
    assert.ok(tree.has("new.txt"));
    assert.ok(tree.has("renamed.txt"));
    assert.ok(!tree.has("to-rename.txt"));
    assert.ok(!tree.has("to-delete.txt"));
  });
});

test("buildSimulatedCommit: no commits yet (no HEAD) fails loud with a clear message, not a cryptic git error", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "thoth-simcommit-empty-"));
  try {
    await realRunner("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
    await assert.rejects(
      () => buildSimulatedCommit(realRunner, repoDir),
      /no commits yet/,
    );
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("buildSimulatedCommit (partial-stage divergence, the ruled fix): a file staged CLEAN, then further " +
  "edited in the working tree WITHOUT re-staging to add a secret, is scanned using the STAGED (clean) " +
  "content -- never the working tree's newer, unstaged content", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "config.js"), "const key = \"not-a-secret\";\n");
    await git(repoDir, "add", ".");
    // Unstaged edit on top of the staged (clean) blob -- `git commit` right now would commit the
    // clean staged content, NOT this.
    await writeFile(join(repoDir, "config.js"), 'const key = "AKIAFAKEFAKEFAKEFAKE";\n');

    const commitSha = await buildSimulatedCommit(realRunner, repoDir);
    const gitOps = makeGitOps(realRunner, repoDir);
    const tree = await gitOps.lsTree(commitSha);
    const blob = await gitOps.catFileBlob(tree.get("config.js")!);
    assert.match(blob.toString("utf8"), /not-a-secret/, "must reflect the STAGED content");
    assert.doesNotMatch(
      blob.toString("utf8"),
      /AKIAFAKEFAKEFAKEFAKE/,
      "must NOT pick up the unstaged working-tree edit -- that content was never staged and git commit would never commit it",
    );
  });
});

test("buildSimulatedCommit (partial-stage divergence, the ruled fix, opposite direction): a file staged WITH " +
  "a secret, then further edited in the working tree WITHOUT re-staging to remove it, is still scanned " +
  "using the STAGED (secret-bearing) content -- the working-tree edit does not silently launder it", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "config.js"), 'const key = "AKIAFAKEFAKEFAKEFAKE";\n');
    await git(repoDir, "add", ".");
    // Unstaged edit removing the secret -- `git commit` right now would STILL commit the staged,
    // secret-bearing content. A scanner that read the working tree here would produce a false
    // negative on a real `git commit`.
    await writeFile(join(repoDir, "config.js"), "const key = \"not-a-secret\";\n");

    const commitSha = await buildSimulatedCommit(realRunner, repoDir);
    const gitOps = makeGitOps(realRunner, repoDir);
    const tree = await gitOps.lsTree(commitSha);
    const blob = await gitOps.catFileBlob(tree.get("config.js")!);
    assert.match(
      blob.toString("utf8"),
      /AKIAFAKEFAKEFAKEFAKE/,
      "must reflect the STAGED (secret-bearing) content, not the working tree's newer edit that quietly removed it",
    );
  });
});

test("buildSimulatedCommit: an untracked, unstaged file in the working tree is NOT swept into the simulated tree", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "config.js"), "const key = \"not-a-secret\";\n");
    await git(repoDir, "add", ".");
    await writeFile(join(repoDir, "unrelated-untracked.js"), 'const key = "AKIAFAKEFAKEFAKEFAKE";\n');

    const commitSha = await buildSimulatedCommit(realRunner, repoDir);
    const gitOps = makeGitOps(realRunner, repoDir);
    const tree = await gitOps.lsTree(commitSha);
    assert.ok(!tree.has("unrelated-untracked.js"), "an unstaged, untracked file must not appear in the simulated commit");
  });
});

test("buildSimulatedCommit: a clean staged change with no secret produces a tree scannable as clean (sanity, no crash on an empty diff too)", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    // No staged changes at all beyond the fixture's own init commit.
    const commitSha = await buildSimulatedCommit(realRunner, repoDir);
    const gitOps = makeGitOps(realRunner, repoDir);
    const tree = await gitOps.lsTree(commitSha);
    assert.ok(tree.has("README.md"));
  });
});

test("buildSimulatedCommit: nested directories are staged correctly (mode/path preserved through --cacheinfo)", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await mkdir(join(repoDir, "nested", "dir"), { recursive: true });
    await writeFile(join(repoDir, "nested", "dir", "deep.ts"), "export const x = 1;\n");
    await git(repoDir, "add", ".");

    const commitSha = await buildSimulatedCommit(realRunner, repoDir);
    const gitOps = makeGitOps(realRunner, repoDir);
    const tree = await gitOps.lsTree(commitSha);
    assert.ok(tree.has("nested/dir/deep.ts"));
  });
});
