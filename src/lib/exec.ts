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
  opts?: { cwd?: string; timeoutMs?: number; encoding?: BufferEncoding },
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
 */
export const realRunner: Runner = async (cmd, args, opts = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      encoding: opts.encoding ?? "latin1",
      env: cleanSubprocessEnv(),
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
