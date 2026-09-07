// Shared black-box test helper (test-writer scope, not application source) for invoking a
// Claude Code hook script exactly the way S5's own review record confirms Claude Code invokes a
// "command"-type hook entry today: JSON payload on stdin, stdout/stderr/exit code read back.
//
// Deliberately EXEC form (spawnSync("node", [scriptPath]) — no shell layer), NOT the shell-form
// invocation `.claude/settings.json`'s bare-command-string entries actually go through in a real
// session. That distinction is S5's own OPS-03 latency-budget concern (docs/plans/S5-phase1-
// 2026-09-06.md §5.B, `src/qa/gate-latency-budget-check.ts` — story-implementer's instrument, not
// test-writer's scope). This helper only has to prove each script's own stdin -> stdout/exit-code
// CONTRACT, which is invocation-shape-independent: the script itself cannot tell whether a shell
// spawned it or not, only what arrived on its stdin/argv/env.
//
// Hook input/output schema fields below (session_id, transcript_path, cwd, permission_mode,
// hook_event_name, tool_name, tool_input, tool_use_id; hookSpecificOutput.permissionDecision;
// exit-code contract: PreToolUse exit 2 blocks regardless of JSON, UserPromptSubmit exit 2 blocks
// and erases the prompt, SessionStart exit 2 prevents the session from starting) are taken
// verbatim from Claude Code's own documented hooks reference (code.claude.com/docs/en/hooks),
// confirmed this session — not assumed from memory.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(THIS_DIR, "..", "..");
export const HOOKS_DIR = path.resolve(THIS_DIR, "..");

export interface HookInvocation {
  /** Raw stdout text. */
  stdout: string;
  /** Raw stderr text. */
  stderr: string;
  /** Process exit code, or null if the process was killed by a signal/timeout. */
  code: number | null;
  /** stdout parsed as JSON, or undefined when stdout is empty/not valid JSON (e.g. a Node crash
   * stack trace on stderr with empty stdout — a legitimate hook state per the PreToolUse "Other
   * codes: Non-blocking" contract, not itself a test-harness bug). */
  json: unknown;
}

/**
 * Spawns `node <repoRoot>/<scriptRelativePath>` as a real child process, writes `stdinPayload`
 * (JSON-stringified unless already a string) to its stdin, and returns the captured result.
 * `envOverrides` are merged over a COPY of the current process env (never mutates the real env).
 */
export function runHook(
  scriptRelativePath: string,
  stdinPayload: unknown,
  envOverrides: NodeJS.ProcessEnv = {},
): HookInvocation {
  const scriptPath = path.join(REPO_ROOT, scriptRelativePath);
  const input = typeof stdinPayload === "string" ? stdinPayload : JSON.stringify(stdinPayload);

  const result = spawnSync(process.execPath, [scriptPath], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...envOverrides },
    timeout: 15_000,
    windowsHide: true,
  });

  let json: unknown;
  try {
    json = JSON.parse(result.stdout ?? "");
  } catch {
    json = undefined;
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status,
    json,
  };
}

/** A fresh, collision-resistant fake session id for one test's own halt-state file. */
export function fakeSessionId(label: string): string {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The common stdin envelope every Claude Code hook event shares (session_id, transcript_path,
 * cwd, permission_mode, hook_event_name), per the confirmed schema — event-specific fields are
 * layered on by each event's own builder below.
 */
function commonFields(sessionId: string, hookEventName: string) {
  return {
    session_id: sessionId,
    transcript_path: path.join(REPO_ROOT, ".thoth", "test-fixtures", `${sessionId}-transcript.json`),
    cwd: REPO_ROOT,
    permission_mode: "default",
    hook_event_name: hookEventName,
  };
}

export function preToolUseStdin(opts: {
  sessionId: string;
  toolName?: string;
  toolInput?: unknown;
}): unknown {
  return {
    ...commonFields(opts.sessionId, "PreToolUse"),
    tool_name: opts.toolName ?? "Bash",
    tool_input: opts.toolInput ?? { command: "true" },
    tool_use_id: `${opts.sessionId}-tool-use`,
  };
}

export function sessionStartStdin(opts: { sessionId: string; source?: string }): unknown {
  return {
    ...commonFields(opts.sessionId, "SessionStart"),
    source: opts.source ?? "startup",
  };
}

export function userPromptSubmitStdin(opts: { sessionId: string; prompt?: string }): unknown {
  return {
    ...commonFields(opts.sessionId, "UserPromptSubmit"),
    prompt_id: `${opts.sessionId}-prompt`,
    prompt: opts.prompt ?? "hello",
  };
}
