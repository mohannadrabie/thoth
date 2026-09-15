// Path B: package.json's `prepare` script's sole job -- install this repo's git hooks by pointing
// `core.hooksPath` at `.githooks`. A real, testable module (SE ADR-0003: inject I/O deps) rather
// than an inline npm script string, so both defects below have a real regression test.
//
// GitHub Issue #191 (red-team, [MED], demonstrated): an unguarded
// `"prepare": "git config core.hooksPath .githooks"` fails `npm ci`/`npm install` HARD (exit 128,
// "fatal: not in a git directory") wherever this ISN'T a real git checkout. Guarded: no git
// checkout means nothing to install and nothing to fail -- installing this repo's own git hooks is
// meaningless outside one.
//
// What this guard covers (real full-source checkout, no `.git`: a tarball install, a
// vendored-source build) vs. what it CANNOT cover (a Docker `COPY package*.json . && npm ci`
// layer-caching step, before the rest of the source tree — including this very file — is copied
// in): GitHub Issue #193-sibling correction, red-team round-2. That specific shape fails with
// node's own `MODULE_NOT_FOUND` before this module's own code ever runs at all — no guard written
// INSIDE this file can run before this file itself exists on disk. Making that shape safe would
// require an inline, dependency-free `prepare` command in `package.json` itself (reintroducing the
// untestable-one-liner shape GitHub Issue #191's own fix deliberately moved away from, per SE
// ADR-0003). This repo has no Dockerfile today (0 of 2 current `npm ci` call sites, counted in
// code) — disclosed here rather than silently left implied-covered by the sentence above.
//
// GitHub Issue #187 finding 8 (red-team, [LOW], demonstrated): setting `core.hooksPath` silently
// overwrites and disables whatever was there before (a different hook manager, e.g. husky, or a
// manually installed hook per devops ADR-0008's Gitleaks rule) -- with zero warning. Now detected
// and disclosed (not blocked -- this repo's own hook still needs to install) via one warning line
// naming the prior value and how to restore it.
import { fileURLToPath } from "node:url";
import type { Runner } from "./exec.ts";

export interface InstallResult {
  /** False only when `git rev-parse --git-dir` fails (not a git checkout) -- not an error. */
  installed: boolean;
  /** Set when a pre-existing, different `core.hooksPath` was overwritten. */
  clobberedHooksPath: string | null;
}

export async function installGitHooks(runner: Runner, repoRoot: string): Promise<InstallResult> {
  // GitHub Issue #193-sibling (red-team round-2, [LOW], demonstrated): `existsSync(".git")` reads
  // false — and silently skips installing the security hook, exit 0 — from any subdirectory of a
  // real git checkout (a monorepo package, a nested workspace, `npm ci` run from a subdirectory),
  // even though it genuinely IS a git checkout. `git rev-parse --git-dir` is the correct probe: it
  // walks up from cwd the same way every other git command does, and also correctly covers a
  // worktree or a submodule (where `.git` is a file, not a directory, pointing elsewhere).
  const gitDirRes = await runner("git", ["rev-parse", "--git-dir"], { cwd: repoRoot, encoding: "utf8" });
  if (gitDirRes.code !== 0) {
    return { installed: false, clobberedHooksPath: null };
  }

  const existingRes = await runner("git", ["config", "--get", "core.hooksPath"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const existing = existingRes.code === 0 ? existingRes.stdout.trim() : "";
  const clobberedHooksPath = existing && existing !== ".githooks" ? existing : null;

  const setRes = await runner("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (setRes.code !== 0) {
    throw new Error(`git config core.hooksPath failed (exit ${setRes.code}): ${setRes.stderr}`);
  }

  return { installed: true, clobberedHooksPath };
}

async function main(): Promise<void> {
  const { realRunner } = await import("./exec.ts");
  try {
    const result = await installGitHooks(realRunner, process.cwd());
    if (!result.installed) {
      console.log("[prepare] not a git checkout (git rev-parse --git-dir failed) -- skipping git hook install.");
      return;
    }
    if (result.clobberedHooksPath) {
      console.warn(
        `[prepare] WARNING: core.hooksPath was already set to "${result.clobberedHooksPath}" -- ` +
          `overwriting it with ".githooks". If that was a different hook manager (husky, a manually ` +
          `installed hook, ...), it is now inactive. Restore it with: ` +
          `git config core.hooksPath "${result.clobberedHooksPath}"`,
      );
    }
    console.log("[prepare] git hooks installed (core.hooksPath = .githooks).");
  } catch (err) {
    // Fails LOUD (non-zero), unlike the "no .git" case above, which is a legitimate no-op --
    // this branch means .git exists but `git config` itself failed for a real reason.
    console.error(`[prepare] git hook install failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
