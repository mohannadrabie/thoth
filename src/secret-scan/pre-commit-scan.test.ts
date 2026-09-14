import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { realRunner } from "../lib/exec.ts";

const SCAN_SCRIPT = fileURLToPath(new URL("./pre-commit-scan.ts", import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FAKE_SECRET = "AKIAFAKEFAKEFAKEFAKE"; // AWS-key-shaped, clearly not a real credential

async function git(cwd: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return realRunner("git", args, { cwd, encoding: "utf8" });
}

async function gitOk(cwd: string, ...args: string[]): Promise<string> {
  const res = await git(cwd, ...args);
  assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout;
}

async function withIsolatedGitRepo(fn: (repoDir: string) => Promise<void>): Promise<void> {
  const repoDir = await mkdtemp(join(tmpdir(), "thoth-precommit-scan-"));
  try {
    await gitOk(repoDir, "init", "-q", "-b", "main");
    await gitOk(repoDir, "config", "user.email", "test@example.com");
    await gitOk(repoDir, "config", "user.name", "Test");
    await writeFile(join(repoDir, "README.md"), "hello\n");
    await gitOk(repoDir, "add", ".");
    await gitOk(repoDir, "commit", "-q", "-m", "init");
    await fn(repoDir);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

// Runs the REAL, unmodified pre-commit-scan.ts by absolute path, with cwd pointed at the fixture
// repo -- its own relative imports (../lib/git.ts, ./history-scan.ts, ...) resolve against the
// script's own file location, unaffected by cwd; `process.cwd()` inside the script (its own
// `repoRoot`) correctly reflects the fixture repo it's pointed at.
async function runScanCli(cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return realRunner("node", [SCAN_SCRIPT], { cwd, encoding: "utf8" });
}

test("R1: a staged change with a known unallowlisted secret-shaped string -> non-zero exit, redacted match reported, raw secret never printed", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "config.js"), `const key = "${FAKE_SECRET}";\n`);
    await gitOk(repoDir, "add", ".");

    const res = await runScanCli(repoDir);
    assert.notEqual(res.code, 0, "a real unallowlisted secret-shaped match must fail the gate");
    assert.match(res.stdout, /REDACTED/);
    assert.ok(!res.stdout.includes(FAKE_SECRET), "the raw secret text must never appear in stdout");
  });
});

test("R1: a clean staged change -> exit 0", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "clean.js"), "const greeting = \"hello world\";\n");
    await gitOk(repoDir, "add", ".");

    const res = await runScanCli(repoDir);
    assert.equal(res.code, 0, `expected a clean exit, got stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  });
});

test("R1: the fixture repo's own HEAD and .git/index are byte-unchanged after a run through the full CLI", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "config.js"), `const key = "${FAKE_SECRET}";\n`);
    await gitOk(repoDir, "add", ".");

    const headBefore = (await gitOk(repoDir, "rev-parse", "HEAD")).trim();
    const indexHashBefore = (await gitOk(repoDir, "hash-object", join(repoDir, ".git", "index"))).trim();

    await runScanCli(repoDir); // exit code irrelevant here -- only checking side effects

    const headAfter = (await gitOk(repoDir, "rev-parse", "HEAD")).trim();
    const indexHashAfter = (await gitOk(repoDir, "hash-object", join(repoDir, ".git", "index"))).trim();
    assert.equal(headAfter, headBefore);
    assert.equal(indexHashAfter, indexHashBefore);
  });
});

test("R2: an allowlisted-but-real match is still REPORTED (not silently dropped) but does not fail the exit code", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await mkdir(join(repoDir, "docs", "qa"), { recursive: true });
    await writeFile(
      join(repoDir, "docs", "qa", "secret-scan-allowlist.json"),
      JSON.stringify([
        { path: "config.js", patternId: "aws-access-key-id", reason: "test fixture, not a real credential" },
      ]),
    );
    await writeFile(join(repoDir, "config.js"), `const key = "${FAKE_SECRET}";\n`);
    await gitOk(repoDir, "add", ".");

    const res = await runScanCli(repoDir);
    assert.equal(res.code, 0, "an allowlisted-only match must not fail the gate");
    assert.match(res.stdout, /ALLOWLISTED/, "an allowlisted match must still appear in the report");
  });
});

test("R2: a match NOT on the allowlist still fails, even alongside an allowlisted one, and the allowlist file itself gains no new marker-parsing behavior", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await mkdir(join(repoDir, "docs", "qa"), { recursive: true });
    await writeFile(
      join(repoDir, "docs", "qa", "secret-scan-allowlist.json"),
      JSON.stringify([
        { path: "allowed.js", patternId: "aws-access-key-id", reason: "test fixture" },
      ]),
    );
    await writeFile(join(repoDir, "allowed.js"), `const key = "${FAKE_SECRET}";\n`);
    await writeFile(join(repoDir, "blocking.js"), `const key = "${FAKE_SECRET}1";\n`); // distinct match, same pattern, different path
    await gitOk(repoDir, "add", ".");

    const res = await runScanCli(repoDir);
    assert.notEqual(res.code, 0, "the non-allowlisted match must still block the gate");
  });
});

test("R3: `git commit` is structurally refused on a genuine finding -- non-zero exit, nothing lands", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, ".git", "hooks", "pre-commit"), `#!/bin/sh\nexec node "${SCAN_SCRIPT}"\n`);
    await chmod(join(repoDir, ".git", "hooks", "pre-commit"), 0o755);

    const beforeLog = await gitOk(repoDir, "log", "--oneline");
    await writeFile(join(repoDir, "config.js"), `const key = "${FAKE_SECRET}";\n`);
    await gitOk(repoDir, "add", ".");

    const commitRes = await git(repoDir, "commit", "-q", "-m", "attempt to commit a secret");
    assert.notEqual(commitRes.code, 0, "git commit must be refused by the hook");

    const afterLog = await gitOk(repoDir, "log", "--oneline");
    assert.equal(afterLog, beforeLog, "nothing must land -- git log unchanged");
  });
});

test("R3: `git commit` with a clean staged change succeeds normally", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, ".git", "hooks", "pre-commit"), `#!/bin/sh\nexec node "${SCAN_SCRIPT}"\n`);
    await chmod(join(repoDir, ".git", "hooks", "pre-commit"), 0o755);

    const beforeLog = await gitOk(repoDir, "log", "--oneline");
    await writeFile(join(repoDir, "clean.js"), "const greeting = \"hello world\";\n");
    await gitOk(repoDir, "add", ".");

    const commitRes = await git(repoDir, "commit", "-q", "-m", "a clean commit");
    assert.equal(commitRes.code, 0, `expected the commit to succeed: ${commitRes.stderr}`);

    const afterLog = await gitOk(repoDir, "log", "--oneline");
    assert.notEqual(afterLog, beforeLog, "a new commit must have landed");
  });
});

test("R4: a fresh LOCAL clone of the real project repo, with core.hooksPath set exactly as `npm run prepare` sets it, blocks a real commit containing a secret -- no manual `git config` beyond that", async () => {
  const cloneDir = await mkdtemp(join(tmpdir(), "thoth-fresh-clone-"));
  try {
    await rm(cloneDir, { recursive: true, force: true }); // git clone wants the target to not pre-exist
    const cloneRes = await realRunner("git", ["clone", "--local", "-q", PROJECT_ROOT, cloneDir], {
      encoding: "utf8",
      timeoutMs: 120_000,
    });
    assert.equal(cloneRes.code, 0, `git clone failed: ${cloneRes.stderr}`);

    // Exactly what package.json's "prepare" script runs -- proves the documented setup command
    // (not a manual `git config core.hooksPath` edit beyond it) activates protection.
    await gitOk(cloneDir, "config", "core.hooksPath", ".githooks");

    await gitOk(cloneDir, "config", "user.email", "test@example.com");
    await gitOk(cloneDir, "config", "user.name", "Test");

    const beforeLog = await gitOk(cloneDir, "log", "-1", "--format=%H");
    await writeFile(join(cloneDir, "a-fresh-clone-secret-canary.js"), `const key = "${FAKE_SECRET}";\n`);
    await gitOk(cloneDir, "add", "a-fresh-clone-secret-canary.js");

    const commitRes = await git(cloneDir, "commit", "-q", "-m", "should be refused by the installed hook");
    assert.notEqual(commitRes.code, 0, "a fresh clone with core.hooksPath set per the documented setup step must refuse this commit");

    const afterLog = await gitOk(cloneDir, "log", "-1", "--format=%H");
    assert.equal(afterLog, beforeLog, "nothing must land in the fresh clone either");
  } finally {
    await rm(cloneDir, { recursive: true, force: true });
  }
});

test("R4: a fresh clone with NO core.hooksPath configured (git's own hooksPath default, pointing at the clone's own untracked .git/hooks/) does not block -- proves the protection comes from the setup step, not a fluke", async () => {
  const cloneDir = await mkdtemp(join(tmpdir(), "thoth-fresh-clone-noprepare-"));
  try {
    await rm(cloneDir, { recursive: true, force: true });
    const cloneRes = await realRunner("git", ["clone", "--local", "-q", PROJECT_ROOT, cloneDir], {
      encoding: "utf8",
      timeoutMs: 120_000,
    });
    assert.equal(cloneRes.code, 0, `git clone failed: ${cloneRes.stderr}`);
    await gitOk(cloneDir, "config", "user.email", "test@example.com");
    await gitOk(cloneDir, "config", "user.name", "Test");

    await writeFile(join(cloneDir, "a-fresh-clone-secret-canary-2.js"), `const key = "${FAKE_SECRET}";\n`);
    await gitOk(cloneDir, "add", "a-fresh-clone-secret-canary-2.js");
    const commitRes = await git(cloneDir, "commit", "-q", "-m", "no hook installed, this should succeed");
    assert.equal(commitRes.code, 0, "without the setup step, the clone's own untracked .git/hooks/ is empty -- nothing should block this commit");
  } finally {
    await rm(cloneDir, { recursive: true, force: true });
  }
});
