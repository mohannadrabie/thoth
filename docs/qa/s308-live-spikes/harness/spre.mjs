// S-pre (offline, no live calls): feed synthetic payloads to the REAL hook, report verdict and reason length.
import { spawnSync, execFileSync } from "node:child_process";
// Repo root: THOTH_REPO if set, else the git top-level of the current directory (run from inside the repo).
function repoRoot() {
  if (process.env.THOTH_REPO) return process.env.THOTH_REPO.replaceAll("\\", "/");
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("set THOTH_REPO to the repository root (the current directory is not inside it)");
  }
}
const REPO = repoRoot();
const HOOK = `${REPO}/hooks/pretooluse-kernel-gate.mjs`;
function run(payload) {
  const t = process.hrtime.bigint();
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  let reason;
  try {
    reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
  } catch {}
  return { exit: r.status, stdoutBytes: r.stdout.length, reasonLen: reason?.length, reason, stderr: r.stderr.slice(0, 200), ms };
}
const bash = (command) => ({ hook_event_name: "PreToolUse", session_id: "spre", tool_name: "Bash", tool_input: { command } });
const mcp = (tool_name) => ({ hook_event_name: "PreToolUse", session_id: "spre", tool_name, tool_input: {} });
const cands = {
  echo: bash("echo spike"),
  touchDyn: bash('touch "$(echo aaaa)"'),
  touchVar: bash("touch $SPIKEVAR"),
  rmVar: bash("rm -f $SPIKEVAR"),
  touchBt: bash("touch `echo a`"),
  mcpPlain: mcp("mcp__plain-srv__plain_tool"),
  mcpOdd: mcp("mcp__odd_srv__do_it"),
};
for (const [k, p] of Object.entries(cands)) {
  const r = run(p);
  console.log(k, JSON.stringify({ exit: r.exit, reasonLen: r.reasonLen, ms: Math.round(r.ms), reason: r.reason?.slice(0, 160), stderr: r.stderr }));
}
