// Path B: package.json's `prepare` script's sole job -- install this repo's git hooks by pointing
// `core.hooksPath` at `.githooks`. A real, testable module (SE ADR-0003: inject I/O deps) rather
// than an inline npm script string, so both defects below have a real regression test.
//
// GitHub Issue #191 (red-team, [MED], demonstrated): an unguarded
// `"prepare": "git config core.hooksPath .githooks"` fails `npm ci`/`npm install` HARD (exit 128,
// "fatal: not in a git directory") in any install context without a `.git` directory -- a future
// Docker `COPY package*.json . && npm ci` layer, a tarball install, a vendored-source build. Now
// guarded: no `.git` directory means nothing to install and nothing to fail -- installing this
// repo's own git hooks is meaningless outside a real git checkout of this repo.
//
// GitHub Issue #187 finding 8 (red-team, [LOW], demonstrated): setting `core.hooksPath` silently
// overwrites and disables whatever was there before (a different hook manager, e.g. husky, or a
// manually installed hook per devops ADR-0008's Gitleaks rule) -- with zero warning. Now detected
// and disclosed (not blocked -- this repo's own hook still needs to install) via one warning line
// naming the prior value and how to restore it.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Runner } from "./exec.ts";

export interface InstallResult {
  /** False only when there is no `.git` directory to install into -- not an error. */
  installed: boolean;
  /** Set when a pre-existing, different `core.hooksPath` was overwritten. */
  clobberedHooksPath: string | null;
}

export async function installGitHooks(runner: Runner, repoRoot: string): Promise<InstallResult> {
  if (!existsSync(join(repoRoot, ".git"))) {
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
      console.log("[prepare] no .git directory found -- skipping git hook install (not a git checkout).");
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
