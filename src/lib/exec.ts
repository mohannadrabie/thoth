// Thin, injectable wrapper around child_process — kept separate from the pure logic modules that
// consume it (SE ADR-0003: inject I/O-performing dependencies; SE ADR-0002: don't scatter I/O).
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type Runner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number; encoding?: BufferEncoding; env?: Record<string, string> },
) => Promise<ExecResult>;

// Node's own test runner sets NODE_TEST_CONTEXT / NODE_TEST_WORKER_ID on itself. Measured
// directly (not assumed, PRINCIPLES.md rule 18): a `node --test some-file.ts` subprocess spawned
// while THIS process is itself running under `node --test` silently inherits those vars, decides
// it is a worker being driven by IPC rather than a standalone run, and exits 0 with empty stdout
// regardless of whether its own tests passed. QA-06's mutation harness spawns exactly this
// (rerunning a test suite as a subprocess) and is always itself invoked from `node --test` in
// CI, so this is load-bearing, not defensive: without stripping these, every mutant would score
// SURVIVED, silently.
const NODE_TEST_RUNNER_ENV_KEYS = ["NODE_TEST_CONTEXT", "NODE_TEST_WORKER_ID"];

// LOAD-BEARING (red-team finding 7, path-b-precommit-secret-scan, 2026-09-14): this copies the
// WHOLE of `process.env`, including `GIT_*` keys. That is the entire reason `git commit -a` /
// `git commit -- <path>` are scanned correctly by `src/secret-scan/simulated-commit.ts`: git hands
// a running hook a `GIT_INDEX_FILE` pointing at a TEMPORARY index for those two commit forms
// (a git-internal index.lock file under .git, for `-a`, or a `next-index-N` file for a pathspec
// commit), and every plain read
// in `simulated-commit.ts` that does NOT pass its own `GIT_INDEX_FILE` override inherits that value
// from here, reading the correct not-yet-real staged state instead of the stale real `.git/index`.
// A future hardening of this function to strip `GIT_*` keys would silently revert
// `git commit -am` to a false negative on the single most common commit form — see
// `pre-commit-scan.test.ts`'s dedicated `git commit -am` regression test before making that change.
function cleanSubprocessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of NODE_TEST_RUNNER_ENV_KEYS) delete env[key];
  return env;
}

/**
 * Real subprocess runner. Never throws on non-zero exit — callers decide what a failing exit
 * means. `encoding: "latin1"` (the default here) is a deliberate choice: it round-trips every
 * byte value 1:1 through a JS string, which `utf8` does not for arbitrary binary blob content
 * (e.g. `git cat-file -p` on a non-text blob). Callers that need real UTF-8 text pass `"utf8"`.
 *
 * `opts.env`, when given, is merged OVER the cleaned copy of the real `process.env` (never
 * replaces it) — a per-call override, scoped to this one invocation only, never a mutation of
 * the parent process's own `process.env` (Path B / `src/secret-scan/simulated-commit.ts`: needs
 * `GIT_INDEX_FILE` pinned to a specific temp file for a handful of calls without ever risking
 * that value leaking into an unrelated concurrent call).
 */
export const realRunner: Runner = async (cmd, args, opts = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      encoding: opts.encoding ?? "latin1",
      env: opts.env ? { ...cleanSubprocessEnv(), ...opts.env } : cleanSubprocessEnv(),
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(err),
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
};
