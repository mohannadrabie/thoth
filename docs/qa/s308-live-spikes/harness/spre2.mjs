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
const run = (command) => { const r = spawnSync("node", [HOOK], { input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Bash", tool_input: { command } }), encoding: "utf8" }); let reason; try { reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason; } catch {} return { exit: r.status, len: reason?.length, reason }; };
for (const c of ["pwd","ls","date","cat spike.txt","git status","ls -la","node -v","whoami","true"]) { const r = run(c); console.log(JSON.stringify(c), r.exit, r.len ?? "ALLOW-silent", r.reason?.slice(0,100) ?? ""); }
const X = (n) => "a".repeat(n);
for (const n of [300, 480, 512, 600, 1300]) { const r = run(`touch $${X(n)}`); console.log("touch var", n, r.exit, r.len); }
for (const k of [1,2,4,8,20]) { const cmd = Array.from({length:k},(_,i)=>`touch $${"b".repeat(480)}${i}`).join(" ; "); const r = run(cmd); console.log("multi", k, r.exit, r.len); }
