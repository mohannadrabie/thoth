import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeGitOps } from "../lib/git.ts";
import { realRunner } from "../lib/exec.ts";
import { partitionAllowlisted, scanHistory, summarizeMatches } from "./history-scan.ts";
import { redact } from "./patterns.ts";
import { readFile } from "node:fs/promises";

test("patterns: redact() never returns the full matched secret", () => {
  const fake = "AKIAABCDEFGHIJKLMNOP";
  const r = redact(fake);
  assert.ok(!r.includes(fake));
  assert.match(r, /REDACTED/);
});

test("history-scan: 0 matches -> real (non-vacuous) pass", () => {
  const result = summarizeMatches([]);
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, false);
});

test("history-scan: matches present -> FAIL, details carry only redacted values", () => {
  const result = summarizeMatches([
    { commit: "abc123", path: "config.ts", patternId: "aws-access-key-id", description: "AWS key", redacted: "AKIA…[REDACTED 20 chars]" },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.details[0] ?? "", /REDACTED/);
  assert.ok(!result.details.join("").includes("AKIAABCDEFGHIJKLMNOP"), "raw secret must never appear in output");
});

test("OSS-01 allowlist: partitionAllowlisted splits matches by exact path+patternId", () => {
  const matches = [
    { commit: "a", path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", description: "x", redacted: "r" },
    { commit: "b", path: "src/config.ts", patternId: "aws-access-key-id", description: "x", redacted: "r" },
  ];
  const { blocking, allowlisted } = partitionAllowlisted(matches, [
    { path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", reason: "test fixture" },
  ]);
  assert.equal(allowlisted.length, 1);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0]?.path, "src/config.ts");
});

test("OSS-01 allowlist: an allowlisted match does not fail the gate, but IS still reported (never silently dropped)", () => {
  const matches = [
    { commit: "a", path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", description: "x", redacted: "AKIA…[REDACTED]" },
  ];
  const result = summarizeMatches(matches, [
    { path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", reason: "test fixture" },
  ]);
  assert.equal(result.ok, true, "allowlisted-only matches must not fail the gate");
  assert.match(result.details.join("\n"), /ALLOWLISTED/, "an allowlisted match must still appear in the report");
});

test("OSS-01 allowlist: a match NOT on the allowlist still fails the gate even if other matches ARE allowlisted", () => {
  const matches = [
    { commit: "a", path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", description: "x", redacted: "r1" },
    { commit: "b", path: "src/config.ts", patternId: "aws-access-key-id", description: "x", redacted: "r2" },
  ];
  const result = summarizeMatches(matches, [
    { path: "src/secret-scan/patterns.test.ts", patternId: "aws-access-key-id", reason: "test fixture" },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.summary, /1 secret-shaped match/);
});

test("OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass", async () => {
  const git = makeGitOps(realRunner, process.cwd());
  const matches = await scanHistory(git);
  const allowlistJson: unknown = JSON.parse(await readFile("docs/qa/secret-scan-allowlist.json", "utf8"));
  const allowlist = allowlistJson as { path: string; patternId: string; reason: string }[];
  const result = summarizeMatches(matches, allowlist);
  assert.equal(result.ok, true, `expected a clean pass, got: ${result.summary}\n${result.details.join("\n")}`);
});

test("OSS-01: catches a fake secret planted in a NON-HEAD commit, and redacts it before logging", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "oss01-history-"));
  try {
    const git = makeGitOps(realRunner, repoDir);
    async function run(...args: string[]): Promise<void> {
      const res = await realRunner("git", args, { cwd: repoDir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
    }

    await run("init", "-q", "-b", "main");
    await run("config", "user.email", "test@example.com");
    await run("config", "user.name", "Test");

    // Commit 1: innocuous.
    await writeFile(join(repoDir, "README.md"), "hello\n");
    await run("add", ".");
    await run("commit", "-q", "-m", "init");

    // Commit 2: a fake secret lands in history.
    const fakeSecret = "AKIAFAKEFAKEFAKEFAKE"; // AWS-key-shaped, 20 chars, clearly not a real credential
    await writeFile(join(repoDir, "config.js"), `const key = "${fakeSecret}";\n`);
    await run("add", ".");
    await run("commit", "-q", "-m", "oops, added a key");

    // Commit 3: removed again — the fake secret is now ABSENT from the working tree / HEAD,
    // present only in a non-HEAD ancestor commit. A working-tree-only scan would miss it.
    await unlink(join(repoDir, "config.js"));
    await run("add", ".");
    await run("commit", "-q", "-m", "remove the key");

    const matches = await scanHistory(git);

    const found = matches.filter((m) => m.patternId === "aws-access-key-id");
    assert.equal(found.length, 1, "must find the fake secret even though it is absent from HEAD");
    assert.equal(found[0]?.path, "config.js");

    // Redaction proof: the raw fake secret must never appear anywhere in the match object.
    const serialized = JSON.stringify(matches);
    assert.ok(!serialized.includes(fakeSecret), "raw secret text must be redacted before it is ever logged/serialized");
    assert.match(found[0]?.redacted ?? "", /REDACTED/);

    const result = summarizeMatches(matches);
    assert.equal(result.ok, false, "the history scan must fail the build on a real finding");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("OSS-01: a working-tree-only view would miss the planted secret (proves 'full history' is the load-bearing part)", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "oss01-worktree-"));
  try {
    async function run(...args: string[]): Promise<void> {
      const res = await realRunner("git", args, { cwd: repoDir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
    }
    await run("init", "-q", "-b", "main");
    await run("config", "user.email", "test@example.com");
    await run("config", "user.name", "Test");
    await writeFile(join(repoDir, "README.md"), "hello\n");
    await run("add", ".");
    await run("commit", "-q", "-m", "init");

    const fakeSecret = "AKIAFAKEFAKEFAKEFAKE";
    await writeFile(join(repoDir, "config.js"), `const key = "${fakeSecret}";\n`);
    await run("add", ".");
    await run("commit", "-q", "-m", "oops");
    await unlink(join(repoDir, "config.js"));
    await run("add", ".");
    await run("commit", "-q", "-m", "remove");

    // A naive "scan the files currently on disk" check — the thing OSS-01 says is insufficient.
    const { readdirSync } = await import("node:fs");
    const filesOnDisk = readdirSync(repoDir);
    assert.ok(!filesOnDisk.includes("config.js"), "the secret file is genuinely gone from the working tree");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});
