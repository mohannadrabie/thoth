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
// simulated commit sha, not its ancestry) — proportional to tree size, not full history length, so
// this stays fast enough to run on every real `git commit`. Full-history scanning is still OSS-01's
// job in CI (`.github/workflows/ci.yml`'s "OSS-01 full-history secret scan" step); this instrument
// is a local, pre-commit-only backstop, not a replacement for it.
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

  printInstrumentResult("Path B pre-commit-scan", result);
  return exitCodeFor(result);
}

async function main(): Promise<void> {
  const code = await runPreCommitScan(process.cwd());
  process.exit(code);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
