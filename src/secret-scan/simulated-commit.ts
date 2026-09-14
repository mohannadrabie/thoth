// Path B (docs/backlog.md's cifix-council item; docs/decisions.md 2026-09-09/2026-09-14): builds
// the git commit that WOULD be created if `git commit` ran right now — staged changes applied on
// top of HEAD — as a real, dangling git commit object, entirely via git plumbing, WITHOUT ever
// touching the real `.git/index` or `HEAD`. `pre-commit-scan.ts` then scans that commit's own tree
// with OSS-01's existing, unmodified `scanHistory` machinery (`history-scan.ts`) — closing the
// "green in the working tree, red in the commit" gap this file family has already hit twice
// (GitHub Issues #131, #180).
//
// Content is sourced from the REAL INDEX's own staged blob (`git ls-files -s`), never re-read
// from the working tree (e.g. via `git add`). Human-ruled 2026-09-14 (docs/decisions.md): a file
// that is `git add`-ed and then further edited in the working tree BEFORE `git commit` runs would
// otherwise be scanned using the wrong (post-edit) content — `git commit` always commits the
// STAGED blob, never whatever happens to be on disk at commit time. Closing this divergence is
// the whole point of sourcing every path from the real index's own blob SHA instead of re-reading
// the working tree.
//
// Known, disclosed non-goals (out of this story's scope, not silently mishandled):
//   - An empty repo with no HEAD yet fails loud with a clear message (matches this module's own
//     `-p HEAD` parent requirement) rather than being specially handled.
//   - A path staged with an unresolved merge conflict (`git ls-files -s` reporting multiple
//     stages for the same path) is not specially handled — this instrument runs against an
//     ordinary staged-and-about-to-commit tree, not a mid-conflict index.
//   - Every real run adds new loose objects (blob/tree/commit) to `.git/objects`. These are never
//     referenced by any ref, so they are ordinary unreachable objects — harmless, reclaimed by a
//     normal `git gc` like any other dangling object — not a leak of secret content beyond what a
//     real `git commit` would itself have written to the exact same object database anyway.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../lib/exec.ts";

interface StagedEntry {
  path: string;
  /** First letter of `git diff --cached --name-status`'s status field: A/M/T/D (R/C are expanded
   * into a synthetic D (old path) + A (new path) pair by `parseNameStatusZ`, below). */
  status: string;
}

async function run(
  runner: Runner,
  repoRoot: string,
  args: string[],
  env?: Record<string, string>,
): Promise<string> {
  const res = await runner("git", args, { cwd: repoRoot, encoding: "utf8", ...(env ? { env } : {}) });
  if (res.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${res.code}): ${res.stderr}`);
  }
  return res.stdout;
}

/**
 * Parses `git diff --cached --name-status -z HEAD` output (NUL-separated, so a path containing a
 * newline can never truncate/split a record — same discipline as `GitOps.lsFilesWorkingTree`).
 * A rename/copy record carries an extra path field (`R100\0<old>\0<new>\0` /
 * `C100\0<old>\0<new>\0`); every other status carries exactly one path.
 *
 * A rename's OLD path is expanded to a synthetic "D" (it no longer exists post-commit); a copy's
 * old path is left alone (still present, already correct via the `read-tree HEAD` baseline). Both
 * kinds' NEW path is expanded to a synthetic "A" (resolved from the real index like any other
 * add/modify).
 */
export function parseNameStatusZ(raw: string): StagedEntry[] {
  const parts = raw.split("\0").filter((p) => p.length > 0);
  const entries: StagedEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const statusField = parts[i];
    if (statusField === undefined) break;
    const statusChar = statusField[0];
    if (statusChar === "R" || statusChar === "C") {
      const oldPath = parts[i + 1];
      const newPath = parts[i + 2];
      if (oldPath === undefined || newPath === undefined) {
        throw new Error(`simulated-commit: malformed rename/copy record in name-status output: ${statusField}`);
      }
      if (statusChar === "R") entries.push({ path: oldPath, status: "D" });
      entries.push({ path: newPath, status: "A" });
      i += 3;
    } else {
      const path = parts[i + 1];
      if (path === undefined) {
        throw new Error(`simulated-commit: malformed name-status record: ${statusField}`);
      }
      entries.push({ path, status: statusChar ?? "" });
      i += 2;
    }
  }
  return entries;
}

/** Reads one path's mode+blob-sha from the REAL index (never the working tree, never the temp
 * simulated index) via `git ls-files -s`. Returns null if the path has no entry (should not
 * happen for a path `git diff --cached` just reported as staged; callers fail loud instead of
 * guessing when this happens anyway). */
async function resolveStagedBlob(
  runner: Runner,
  repoRoot: string,
  path: string,
): Promise<{ mode: string; sha: string } | null> {
  const raw = await run(runner, repoRoot, ["ls-files", "-s", "-z", "--", path]);
  const record = raw.split("\0").find((r) => r.length > 0);
  if (record === undefined) return null;
  const tabIdx = record.indexOf("\t");
  if (tabIdx === -1) return null;
  const meta = record.slice(0, tabIdx).trim().split(/\s+/);
  const mode = meta[0];
  const sha = meta[1];
  if (!mode || !sha) return null;
  return { mode, sha };
}

/**
 * Builds the simulated to-be-committed tree and wraps it in a real (but unreachable, never
 * ref-pointed) commit object with the real `HEAD` as its sole parent. Returns the new commit's
 * SHA. The real `.git/index` and `HEAD` are never opened for writing at any point — every
 * index-mutating call below is scoped to a private temp index file via `GIT_INDEX_FILE`, deleted
 * before this function returns.
 */
export async function buildSimulatedCommit(runner: Runner, repoRoot: string): Promise<string> {
  let head: string;
  try {
    head = (await run(runner, repoRoot, ["rev-parse", "--verify", "HEAD"])).trim();
  } catch (err) {
    throw new Error(
      `simulated-commit: could not resolve HEAD (${(err as Error).message}). This repo has no commits ` +
        `yet — the pre-commit secret scan requires an existing HEAD to build a simulated commit against.`,
    );
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "thoth-precommit-index-"));
  const indexFile = join(tmpDir, "index");
  try {
    await run(runner, repoRoot, ["read-tree", head], { GIT_INDEX_FILE: indexFile });

    const nameStatusRaw = await run(runner, repoRoot, ["diff", "--cached", "--name-status", "-z", "HEAD"]);
    const entries = parseNameStatusZ(nameStatusRaw);

    for (const entry of entries) {
      if (entry.status === "D") {
        await run(runner, repoRoot, ["update-index", "--force-remove", "--", entry.path], {
          GIT_INDEX_FILE: indexFile,
        });
        continue;
      }
      const blob = await resolveStagedBlob(runner, repoRoot, entry.path);
      if (!blob) {
        throw new Error(
          `simulated-commit: ${entry.path} is reported staged (status ${entry.status}) but has no entry ` +
            `in the real index — refusing to guess its content.`,
        );
      }
      await run(
        runner,
        repoRoot,
        ["update-index", "--add", "--cacheinfo", blob.mode, blob.sha, entry.path],
        { GIT_INDEX_FILE: indexFile },
      );
    }

    const tree = (await run(runner, repoRoot, ["write-tree"], { GIT_INDEX_FILE: indexFile })).trim();
    const commit = (
      await run(runner, repoRoot, [
        "commit-tree",
        tree,
        "-p",
        head,
        "-m",
        "thoth pre-commit-scan: simulated commit (never a real ref, not pushed, not kept)",
      ])
    ).trim();
    return commit;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
