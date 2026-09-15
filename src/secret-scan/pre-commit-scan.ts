// Path B: a standing, blocking git pre-commit secret-scan check on the simulated to-be-committed
// tree (docs/backlog.md's cifix-council item; docs/decisions.md 2026-09-09/2026-09-14). Closes
// the "green in the working tree, red in the commit" gap OSS-01's own full-history scan
// (`history-scan.ts`, wired into CI) cannot catch pre-commit by construction — a working-tree-only
// dev loop never runs it until CI does, one commit too late (GitHub Issues #131, #180).
//
// Reuses OSS-01's existing scan machinery completely unmodified: `scanHistory`, `SECRET_PATTERNS`
// (via `scanHistory`'s own default), `loadAllowlist`, `summarizeMatches` — all imported from
// `history-scan.ts`, none reimplemented here. `docs/qa/secret-scan-allowlist.json` stays the sole
// exemption mechanism; this instrument adds zero new exemption-grant surface (no in-file marker,
// no second grant path).
//
// Scope is the SIMULATED COMMIT'S OWN TREE only (`revList` overridden to return exactly the one
// simulated commit sha, not its ancestry) — proportional to tree size, not full history length.
// GitHub Issue #194 (red-team round-2, [MED]): this was previously asserted as "fast enough to run
// on every real git commit" with no measurement (PRINCIPLES rule 18). Measured, not assumed: on
// this repo's own tree (312 tracked files, 2026-09-14), a real end-to-end run took ~23-25s across 5
// consecutive measurements this session (red-team's own independent measurement the same day, on
// 310 files, was ~12.5-13.0s — both real, machine/session-dependent numbers for the same O(tree
// size) architecture, not a discrepancy either figure should be trusted to resolve). The cost is
// `history-scan.ts`'s own serial `git cat-file` spawn per tracked blob (root-caused by red-team,
// `history-scan.ts:80-81`) — NOT reimplemented or optimized here; that is a separate, larger change
// to shared OSS-01 machinery, out of this fix-now round's scope. What IS fixed here: the default
// stdout on a PASSING run no longer lists every `ALLOWLISTED` match (263 of 264 lines on this
// repo's own clean commits, measured) — full detail still prints on a FAIL, where it is the
// information a developer actually needs. Full-history scanning is still OSS-01's job in CI
// (`.github/workflows/ci.yml`'s "OSS-01 full-history secret scan" step); this instrument is a
// local, pre-commit-only backstop, not a replacement for it, and at repo sizes materially larger
// than this project's own, this local check's own latency is a real, disclosed limitation.
//
// Installed as a real, blocking git hook via `.githooks/pre-commit` + `package.json`'s `prepare`
// script (`git config core.hooksPath .githooks`) — see that file/script for the install mechanism.
import { fileURLToPath } from "node:url";
import type { GitOps } from "../lib/git.ts";
import { makeGitOps } from "../lib/git.ts";
import { realRunner } from "../lib/exec.ts";
import { loadAllowlist, scanHistory, summarizeMatches } from "./history-scan.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";
import { buildSimulatedCommit } from "./simulated-commit.ts";

const ALLOWLIST_PATH = "docs/qa/secret-scan-allowlist.json";

export async function runPreCommitScan(repoRoot: string): Promise<number> {
  const commitSha = await buildSimulatedCommit(realRunner, repoRoot);

  const git: GitOps = makeGitOps(realRunner, repoRoot);
  // Scope scanHistory's own commit walk to exactly this one simulated commit — not its ancestry —
  // by overriding `revList` alone; `lsTree`/`catFileBlob` read real git-object-database objects by
  // sha and need no special scoping (the simulated tree/commit objects are real objects, readable
  // like any other, the moment `buildSimulatedCommit` writes them).
  const simulatedGit: GitOps = { ...git, revList: () => Promise.resolve([commitSha]) };

  const [matches, allowlist] = await Promise.all([
    scanHistory(simulatedGit, {}),
    loadAllowlist(ALLOWLIST_PATH),
  ]);
  const result = summarizeMatches(matches, allowlist);

  // GitHub Issue #194 (red-team round-2, [MED]): a full listing of every ALLOWLISTED match scrolls
  // past the developer on EVERY commit, clean or not (263 of 264 lines on this repo's own clean
  // commits) — a real "bypass-by-attrition" risk. `summarizeMatches`'s own result is unchanged (R2:
  // zero new exemption surface, nothing here changes what passes/fails) — only what THIS CLI prints
  // to stdout on a clean (PASS) run. A FAIL still prints every detail line: that is exactly the
  // information a developer needs to unblock, and is never suppressed.
  printInstrumentResult("Path B pre-commit-scan", result.ok ? { ...result, details: [] } : result);
  return exitCodeFor(result);
}

/**
 * GitHub Issue #190 (red-team, [MED], demonstrated): with no try/catch, every internal failure
 * path (an empty repo with no HEAD, a git plumbing error, ...) dumped a raw Node stack trace to
 * the committer instead of a clear, named message — the exit code was already correct (fails
 * closed, non-zero), this is presentation only, but PRINCIPLES rule 2 ("every block names its
 * unlock") still applies to a standing, blocking gate. The commit stays refused either way; this
 * only changes what the developer sees when it is.
 *
 * Round-2 residual (red-team, [LOW]): the message named the cause but not the unlock, leaving a
 * brand-new repo's first-ever commit (the one case where "no HEAD yet" is expected, not a real
 * failure) with no way forward. Now names both.
 */
async function main(): Promise<void> {
  try {
    const code = await runPreCommitScan(process.cwd());
    process.exit(code);
  } catch (err) {
    console.error(
      `[Path B pre-commit-scan] BLOCKED: an internal error prevented the scan from completing, ` +
        `so the commit is refused rather than silently allowed. ${(err as Error).message}\n` +
        `[Path B pre-commit-scan] Unlock: if this repo genuinely has no commits yet, this check ` +
        `cannot run against a HEAD that doesn't exist -- make the first commit once with ` +
        `\`git commit --no-verify\`, then this hook runs normally on every commit after it. ` +
        `Otherwise, this is an unexpected internal error -- please report it.`,
    );
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
