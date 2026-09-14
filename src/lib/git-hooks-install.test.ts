import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { realRunner } from "./exec.ts";
import { installGitHooks } from "./git-hooks-install.ts";

const INSTALL_SCRIPT = fileURLToPath(new URL("./git-hooks-install.ts", import.meta.url));

async function git(cwd: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return realRunner("git", args, { cwd, encoding: "utf8" });
}

async function gitOk(cwd: string, ...args: string[]): Promise<string> {
  const res = await git(cwd, ...args);
  assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout;
}

test("installGitHooks: no .git directory -> installed=false, no error, nothing to clobber", async () => {
  const dir = await mkdtemp(join(tmpdir(), "thoth-hooks-install-nogit-"));
  try {
    const result = await installGitHooks(realRunner, dir);
    assert.equal(result.installed, false);
    assert.equal(result.clobberedHooksPath, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installGitHooks: a real repo with no pre-existing core.hooksPath installs cleanly, no clobber warning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "thoth-hooks-install-clean-"));
  try {
    await gitOk(dir, "init", "-q", "-b", "main");
    const result = await installGitHooks(realRunner, dir);
    assert.equal(result.installed, true);
    assert.equal(result.clobberedHooksPath, null);
    const hooksPath = (await gitOk(dir, "config", "core.hooksPath")).trim();
    assert.equal(hooksPath, ".githooks");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installGitHooks (GitHub Issue #187 finding 8, red-team [LOW], regression): a pre-existing, DIFFERENT " +
  "core.hooksPath is overwritten but the prior value is reported so a caller can warn/restore it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "thoth-hooks-install-clobber-"));
  try {
    await gitOk(dir, "init", "-q", "-b", "main");
    await gitOk(dir, "config", "core.hooksPath", ".pre-existing-husky");

    const result = await installGitHooks(realRunner, dir);
    assert.equal(result.installed, true);
    assert.equal(result.clobberedHooksPath, ".pre-existing-husky", "the prior value must be reported, not silently dropped");

    const hooksPath = (await gitOk(dir, "config", "core.hooksPath")).trim();
    assert.equal(hooksPath, ".githooks", "this repo's own hook still needs to install");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installGitHooks: core.hooksPath already set to .githooks is NOT reported as a clobber", async () => {
  const dir = await mkdtemp(join(tmpdir(), "thoth-hooks-install-idempotent-"));
  try {
    await gitOk(dir, "init", "-q", "-b", "main");
    await gitOk(dir, "config", "core.hooksPath", ".githooks");

    const result = await installGitHooks(realRunner, dir);
    assert.equal(result.installed, true);
    assert.equal(result.clobberedHooksPath, null, "re-running the same install is not a clobber");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("GitHub Issue #191 (red-team [MED], regression): running the prepare script outside a git repo exits 0, never hard-fails an install", async () => {
  const dir = await mkdtemp(join(tmpdir(), "thoth-hooks-install-cli-nogit-"));
  try {
    const res = await realRunner("node", [INSTALL_SCRIPT], { cwd: dir, encoding: "utf8" });
    assert.equal(res.code, 0, `expected exit 0 outside a git repo, got ${res.code}: ${res.stderr}`);
    assert.match(res.stdout, /skipping git hook install/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("running the prepare script inside a real git repo installs the hook via the CLI entrypoint too", async () => {
  const dir = await mkdtemp(join(tmpdir(), "thoth-hooks-install-cli-git-"));
  try {
    await gitOk(dir, "init", "-q", "-b", "main");
    const res = await realRunner("node", [INSTALL_SCRIPT], { cwd: dir, encoding: "utf8" });
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}: ${res.stderr}`);
    const hooksPath = (await gitOk(dir, "config", "core.hooksPath")).trim();
    assert.equal(hooksPath, ".githooks");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
