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
// "The real index" is deliberately loose phrasing (red-team finding 7, `git commit -a`/
// `git commit -- <path>`): git points a running hook at a TEMPORARY index for those two commit
// forms (a git-internal index.lock file under .git, for `-a`, or a `next-index-N` file for a
// pathspec commit) and exports its
// path via `GIT_INDEX_FILE` in the hook's own environment — every `run()` call below that does NOT
// pass its own `GIT_INDEX_FILE` override (i.e. every plain read: `rev-parse HEAD`, `diff --cached`,
// `ls-files -s`) inherits that FROM THE PARENT PROCESS'S ENVIRONMENT, via `src/lib/exec.ts`'s
// `cleanSubprocessEnv()` copying the whole of `process.env`. This is LOAD-BEARING, not incidental:
// it is the entire reason `git commit -a`/`-- <path>` read the correct (temporary, not-yet-real)
// staged state instead of the stale real `.git/index`. A future hardening of `cleanSubprocessEnv()`
// that strips `GIT_*` keys would silently revert this to a false negative on the single most common
// commit form. Pinned by `pre-commit-scan.test.ts`'s `git commit -am` regression test.
//
// Known, disclosed non-goals (out of this story's scope, not silently mishandled):
//   - An empty repo with no HEAD yet fails loud with a clear message (matches this module's own
//     `-p HEAD` parent requirement) rather than being specially handled.
//   - A path staged with an unresolved merge conflict (`git ls-files -s` reporting multiple
//     stages for the same path) is not specially handled — this instrument runs against an
//     ordinary staged-and-about-to-commit tree, not a mid-conflict index.
//   - `git commit --no-verify` (or any GUI/IDE client that skips hooks, or a commit made before
//     `npm install`/`npm ci` has ever run) bypasses this check entirely — no local git hook can
//     prevent that; git itself never runs it. This is a defense-in-depth, pre-commit-only backstop,
//     not an unbypassable control. `.github/workflows/ci.yml`'s OSS-01 full-history scan (unaffected
//     by any local bypass, and the only check a server-side merge ever runs) is the real backstop.
//   - Every real run adds new loose objects (blob/tree/commit) to `.git/objects`. These are never
//     referenced by any ref, so they are ordinary unreachable objects — harmless, reclaimed by a
//     normal `git gc` like any other dangling object. For a PASSING run this is no more than a real
//     `git commit` would itself have written to the same object database anyway; for a BLOCKED run,
//     the tree/commit objects (never the blobs, already written by `git add`) are extra objects a
//     real `git commit` would never have created — still harmless, still GC'd normally, just not
//     literally zero marginal objects in that one case.
//   - Cleanup (temp index file deletion, below) is a `finally` block: it runs on every normal
//     return and every thrown error, but NOT on a process kill signal (Ctrl-C mid-run). A SIGINT
//     during a commit can leave an orphaned `thoth-precommit-index-*` directory in the OS temp dir
//     — contents are an index file (staged paths + blob SHAs), never secret bytes. Not handled here;
//     an ordinary temp-directory cleanup sweep (or the OS's own tmp-reaper) clears it eventually.
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

/**
 * Reads mode+blob-sha for EVERY path in the REAL index (never the working tree, never the temp
 * simulated index), in ONE call — never per-path.
 *
 * GitHub Issue #188 (red-team, [HIGH], demonstrated): a per-path `git ls-files -s -- <path>` call
 * has `<path>` interpreted as a git PATHSPEC, not a literal string — `--` disables *option*
 * parsing, not *pathspec magic*. A staged filename containing `[`, `]`, `*`, or `?` (e.g. a
 * Next.js-style `app/[id].js`) can match a lexicographically-earlier sibling; taking the first
 * returned record then silently resolves to the WRONG blob. Red-team demonstrated this end-to-end
 * through the real installed hook: staging `k[0-9].js` (a secret) alongside `k5.js` (clean) made
 * the scanner read `k5.js`'s blob for `k[0-9].js`, report PASS, and let `git commit` land the
 * secret in real history. A single unfiltered `git ls-files -s -z` lists every real index entry
 * with no pathspec involved at all; each staged path is then looked up by an EXACT map key, never
 * re-interpreted — this removes the glob-interpretation class entirely, and drops this function's
 * own subprocess count from O(staged paths) to 1.
 */
async function resolveAllStagedBlobs(
  runner: Runner,
  repoRoot: string,
): Promise<Map<string, { mode: string; sha: string }>> {
  const raw = await run(runner, repoRoot, ["ls-files", "-s", "-z"]);
  const map = new Map<string, { mode: string; sha: string }>();
  for (const record of raw.split("\0")) {
    if (!record) continue;
    const tabIdx = record.indexOf("\t");
    if (tabIdx === -1) continue;
    const meta = record.slice(0, tabIdx).trim().split(/\s+/);
    const mode = meta[0];
    const sha = meta[1];
    const path = record.slice(tabIdx + 1);
    if (!mode || !sha) continue;
    map.set(path, { mode, sha });
  }
  return map;
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

    // Two-pass application (GitHub Issue #189, red-team [MED], demonstrated): `git diff --cached
    // --name-status` sorts by path, so a directory-to-file collapse (e.g. a hypothetical
    // foo/index.ts becoming a single foo.ts) reports the new file's "A" status BEFORE the old
    // directory member's "D" status. Applying entries in that reported order tries to add the file
    // while the directory still exists in the temp index,
    // and `update-index` fatals ("appears as both a file and as a directory") on a tree a real
    // `git commit` accepts without complaint. Removing every deletion first, then adding/updating,
    // means the temp index never transiently holds both shapes for the same path segment at once.
    const deletions = entries.filter((e) => e.status === "D");
    const additions = entries.filter((e) => e.status !== "D");

    for (const entry of deletions) {
      await run(runner, repoRoot, ["update-index", "--force-remove", "--", entry.path], {
        GIT_INDEX_FILE: indexFile,
      });
    }

    if (additions.length > 0) {
      const blobs = await resolveAllStagedBlobs(runner, repoRoot);
      for (const entry of additions) {
        const blob = blobs.get(entry.path);
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
