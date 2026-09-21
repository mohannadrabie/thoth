import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { realRunner } from "../lib/exec.ts";

const SCAN_SCRIPT = fileURLToPath(new URL("./pre-commit-scan.ts", import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FAKE_SECRET = "AKIAFAKEFAKEFAKEFAKE"; // AWS-key-shaped, clearly not a real credential

// Temp-dir cleanup for every fixture in this file (GitHub Issue #227). A git process can still be
// writing under the fixture's .git/ after the test's own `git commit` returned (git spawns a detached
// `git maintenance run --auto` after a successful commit), so a single recursive delete can lose the race
// with ENOTEMPTY. Retry a busy tree; there is deliberately no catch, so a failure that outlasts the
// retries still throws and still fails the test.
function removeTree(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

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
    await removeTree(repoDir);
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

test("GitHub Issue #194 (red-team round-2, [MED], regression): a PASSING run's stdout does not list " +
  "ALLOWLISTED matches (noise-suppression, the bypass-by-attrition fix) -- but a FAILING run still " +
  "lists every detail line, since that is exactly the information a developer needs to unblock", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await mkdir(join(repoDir, "docs", "qa"), { recursive: true });
    await writeFile(
      join(repoDir, "docs", "qa", "secret-scan-allowlist.json"),
      JSON.stringify([
        { path: "allowed.js", patternId: "aws-access-key-id", valueSha256: [sha256Of(FAKE_SECRET)], reason: "test fixture, not a real credential" },
      ]),
    );
    await writeFile(join(repoDir, "allowed.js"), `const key = "${FAKE_SECRET}";\n`);
    await gitOk(repoDir, "add", ".");

    const passRes = await runScanCli(repoDir);
    assert.equal(passRes.code, 0, "an allowlisted-only match must still pass overall");
    assert.ok(
      !passRes.stdout.includes("ALLOWLISTED"),
      `a PASSING run's stdout must not list ALLOWLISTED details:\n${passRes.stdout}`,
    );

    // Now add a second, non-allowlisted secret alongside it -- the run must FAIL, and now list
    // every detail line, including the allowlisted one (summarizeMatches's own reused behavior,
    // untouched -- only the PASS-case CLI presentation changed).
    await writeFile(join(repoDir, "blocking.js"), `const key = "${FAKE_SECRET}1";\n`);
    await gitOk(repoDir, "add", "blocking.js");

    const failRes = await runScanCli(repoDir);
    assert.notEqual(failRes.code, 0, "the non-allowlisted match must fail the gate");
    assert.match(failRes.stdout, /ALLOWLISTED/, "a FAILING run must still list every detail line, allowlisted or not");
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

test("R2: an allowlisted-but-real match does not fail the exit code -- the underlying result still " +
  "REPORTS it, not silently dropped (asserted at the summarizeMatches unit level in " +
  "history-scan.test.ts and at the CLI level, for a FAIL run, in the GitHub Issue #194 regression " +
  "test above -- a PASSING run's own stdout intentionally suppresses ALLOWLISTED lines as of #194, " +
  "so it is not re-asserted here)", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await mkdir(join(repoDir, "docs", "qa"), { recursive: true });
    await writeFile(
      join(repoDir, "docs", "qa", "secret-scan-allowlist.json"),
      JSON.stringify([
        { path: "config.js", patternId: "aws-access-key-id", valueSha256: [sha256Of(FAKE_SECRET)], reason: "test fixture, not a real credential" },
      ]),
    );
    await writeFile(join(repoDir, "config.js"), `const key = "${FAKE_SECRET}";\n`);
    await gitOk(repoDir, "add", ".");

    const res = await runScanCli(repoDir);
    assert.equal(res.code, 0, "an allowlisted-only match must not fail the gate");
  });
});

test("R2: a match NOT on the allowlist still fails, even alongside an allowlisted one, and the allowlist file itself gains no new marker-parsing behavior", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await mkdir(join(repoDir, "docs", "qa"), { recursive: true });
    await writeFile(
      join(repoDir, "docs", "qa", "secret-scan-allowlist.json"),
      JSON.stringify([
        { path: "allowed.js", patternId: "aws-access-key-id", valueSha256: [sha256Of(FAKE_SECRET)], reason: "test fixture" },
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
    await removeTree(cloneDir); // git clone wants the target to not pre-exist
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
    await removeTree(cloneDir);
  }
});

test("R4: a fresh clone with NO core.hooksPath configured (git's own hooksPath default, pointing at the clone's own untracked .git/hooks/) does not block -- proves the protection comes from the setup step, not a fluke", async () => {
  const cloneDir = await mkdtemp(join(tmpdir(), "thoth-fresh-clone-noprepare-"));
  try {
    await removeTree(cloneDir);
    // This test makes a SUCCESSFUL commit in the clone. Turn off git's post-commit automatic maintenance
    // there (both keys persist in the clone's own config) so no detached git process outlives the test.
    const cloneRes = await realRunner("git", ["clone", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "--local", "-q", PROJECT_ROOT, cloneDir], {
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
    await removeTree(cloneDir);
  }
});

test("R187 (GitHub Issue #187, red-team [HIGH], regression): .githooks/pre-commit is committed with the " +
  "executable bit set -- git silently ignores a non-executable hook on every POSIX clone (githooks(5)), and " +
  "this project's own test suite runs on a platform where the exec bit is not meaningful, so this can only " +
  "be caught by asserting the TRACKED mode directly, not by exercising the hook", async () => {
  const res = await gitOk(PROJECT_ROOT, "ls-files", "-s", ".githooks/pre-commit");
  assert.match(
    res,
    /^100755\s/,
    `expected the committed mode to be 100755 (executable), got: ${res.trim()}. Fix: ` +
      `git update-index --chmod=+x .githooks/pre-commit`,
  );
});

test("R190 (GitHub Issue #190, red-team [MED], regression): an internal error (no HEAD yet) prints a named " +
  "BLOCKED message AND names the unlock (round-2 residual, red-team [LOW]) -- not a raw Node stack " +
  "trace, and not just the cause with no way forward -- the exit code stays non-zero either way", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "thoth-precommit-scan-nohead-"));
  try {
    await gitOk(repoDir, "init", "-q", "-b", "main"); // no commits at all -- no HEAD
    const res = await runScanCli(repoDir);
    assert.notEqual(res.code, 0, "an internal error must still fail closed");
    assert.match(res.stderr, /\[Path B pre-commit-scan\] BLOCKED:/, "must print a single named, clear line");
    assert.match(res.stderr, /Unlock:/, "must name a way forward, not only the cause (PRINCIPLES rule 2)");
    assert.match(res.stderr, /--no-verify/, "the unlock for a brand-new repo's first commit must be actionable");
    assert.ok(
      !res.stderr.includes("at async") && !res.stderr.includes("node:internal"),
      "must not dump a raw Node stack trace to the developer",
    );
  } finally {
    await removeTree(repoDir);
  }
});

test("R7 (red-team [SUSPICION->settled], regression): `git commit -am` with a secret in a tracked, unstaged " +
  "file is refused -- correctness here rests on GIT_INDEX_FILE inheritance from the hook's own environment " +
  "(see simulated-commit.ts's header comment), now pinned by a real end-to-end hook test rather than left " +
  "undocumented and untested", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, ".git", "hooks", "pre-commit"), `#!/bin/sh\nexec node "${SCAN_SCRIPT}"\n`);
    await chmod(join(repoDir, ".git", "hooks", "pre-commit"), 0o755);

    // A tracked, clean file, committed first -- then dirtied with a secret WITHOUT `git add`.
    await writeFile(join(repoDir, "tracked.js"), "const clean = \"nothing here\";\n");
    await gitOk(repoDir, "add", "tracked.js");
    await gitOk(repoDir, "commit", "-q", "-m", "tracked.js, clean");
    await writeFile(join(repoDir, "tracked.js"), `const key = "${FAKE_SECRET}";\n`);

    const beforeLog = await gitOk(repoDir, "log", "-1", "--format=%H");
    const commitRes = await git(repoDir, "commit", "-am", "auto-stage a secret via -a");
    assert.notEqual(commitRes.code, 0, "git commit -am must auto-stage tracked.js's new content and refuse it");
    const afterLog = await gitOk(repoDir, "log", "-1", "--format=%H");
    assert.equal(afterLog, beforeLog, "nothing must land");
  });
});

// ================================================================================================
// Issues 136 and 203 (story S-B2): the pre-commit CLI honors only value-scoped entries. Novel values
// are built at runtime so this file's text carries no new secret-shaped literal beyond FAKE_SECRET.
// ================================================================================================

function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const NOVEL_SECRET = "AKIA" + "N".repeat(16); // AWS-key-shaped, built at runtime, never granted anywhere
const ALLOWLIST_FILE = "docs/qa/secret-scan-allowlist.json";

async function writeAllowlist(repoDir: string, entries: unknown[]): Promise<void> {
  await mkdir(join(repoDir, "docs", "qa"), { recursive: true });
  await writeFile(join(repoDir, ...ALLOWLIST_FILE.split("/")), JSON.stringify(entries));
}

const GRANT_FAKE = {
  path: "allowed.js",
  patternId: "aws-access-key-id",
  valueSha256: [sha256Of(FAKE_SECRET)],
  reason: "synthetic fixture, not a real credential",
};

test("oss01-allowlisted-file-still-blocks-a-novel-secret (pre-commit CLI: granted plus novel in one file)", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeAllowlist(repoDir, [GRANT_FAKE]);
    await writeFile(join(repoDir, "allowed.js"), `const a = "${FAKE_SECRET}";\nconst b = "${NOVEL_SECRET}";\n`);
    await gitOk(repoDir, "add", ".");
    const res = await runScanCli(repoDir);
    assert.notEqual(res.code, 0, `a novel secret in a granted file must refuse the commit:\n${res.stdout}`);
    assert.match(res.stdout, /UNLOCK/, "the refusal names its unlock");
    assert.ok(!res.stdout.includes(NOVEL_SECRET), "the raw novel value is never printed");
  });
});

test("oss01-allowlisted-file-still-blocks-a-novel-secret (pre-commit CLI: novel alone in the granted file)", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeAllowlist(repoDir, [GRANT_FAKE]);
    await writeFile(join(repoDir, "allowed.js"), `const b = "${NOVEL_SECRET}";\n`);
    await gitOk(repoDir, "add", ".");
    const res = await runScanCli(repoDir);
    assert.notEqual(res.code, 0, "the file is granted for a different value; the novel one must block");
  });
});

test("oss01-allowlisted-file-still-blocks-a-novel-secret (pre-commit CLI: control, granted literal alone exits 0)", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeAllowlist(repoDir, [GRANT_FAKE]);
    await writeFile(join(repoDir, "allowed.js"), `const a = "${FAKE_SECRET}";\n`);
    await gitOk(repoDir, "add", ".");
    const res = await runScanCli(repoDir);
    assert.equal(res.code, 0, `positive control: the granted literal alone must pass:\n${res.stdout}\n${res.stderr}`);
  });
});

test("sb2-partial-migration-does-not-leave-legacy-shape-entries-honored (pre-commit CLI)", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    const valid = (path: string) => ({ ...GRANT_FAKE, path });
    await writeAllowlist(repoDir, [
      valid("a.js"),
      { path: "b.js", patternId: "aws-access-key-id", reason: "legacy shape: path and pattern only" },
      valid("c.js"),
    ]);
    // Distinct bytes per file: the scanner dedupes byte-identical blobs, evaluating only the first path.
    for (const f of ["a.js", "b.js", "c.js"]) await writeFile(join(repoDir, f), `const k = "${FAKE_SECRET}"; // ${f}\n`);
    await gitOk(repoDir, "add", ".");
    const res = await runScanCli(repoDir);
    assert.notEqual(res.code, 0, "the legacy-shaped entry must not exempt b.js");
    assert.match(res.stdout, /REJECTED-ENTRY index=1 path=b\.js pattern=aws-access-key-id/, "the rejected entry is named in the refusal");
  });
});

test("sb2-partial-migration-control-all-valid-entries-are-honored (pre-commit CLI)", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    const valid = (path: string) => ({ ...GRANT_FAKE, path });
    await writeAllowlist(repoDir, [valid("a.js"), valid("c.js")]);
    for (const f of ["a.js", "c.js"]) await writeFile(join(repoDir, f), `const k = "${FAKE_SECRET}"; // ${f}\n`);
    await gitOk(repoDir, "add", ".");
    const res = await runScanCli(repoDir);
    assert.equal(res.code, 0, `control: value-scoped entries for the granted literal must pass:\n${res.stdout}`);
  });
});

test("oss01-attack-e-legacy-shaped-report-grant-blocks-at-the-gate (pre-commit CLI)", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    const report = ["docs", "reviews", "zz-attack-e-report.md"].join("/");
    await writeAllowlist(repoDir, [{ path: report, patternId: "aws-access-key-id", reason: "attacker-supplied whole-file grant" }]);
    await mkdir(join(repoDir, "docs", "reviews"), { recursive: true });
    await writeFile(join(repoDir, ...report.split("/")), `a live literal: ${NOVEL_SECRET}\n`);
    await gitOk(repoDir, "add", ".");
    const res = await runScanCli(repoDir);
    assert.notEqual(res.code, 0, "a new report with a live literal and a legacy-shaped whole-file grant must refuse the commit");
  });
});
