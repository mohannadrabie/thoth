import { spawnSync } from "node:child_process";
const HOOK = "C:/playground/thoth/hooks/pretooluse-kernel-gate.mjs";
const run = (command) => { const r = spawnSync("node", [HOOK], { input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s", tool_name: "Bash", tool_input: { command } }), encoding: "utf8" }); let reason; try { reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason; } catch {} return { exit: r.status, len: reason?.length, reason }; };
const L = (c, n) => c.repeat(n);
const tries = {
  twoArgs: `touch $${L("a",600)} $${L("b",600)}`,
  threeArgs: `touch $${L("a",600)} $${L("b",600)} $${L("c",600)}`,
  flags: `touch $${L("a",600)} --${L("f",600)} -${L("g",600)}`,
  many: "touch " + Array.from({length:10},(_,i)=>`$${L(String.fromCharCode(97+i),600)}`).join(" "),
  pipeline: Array.from({length:10},(_,i)=>`touch $${L(String.fromCharCode(97+i),600)}`).join(" | "),
  andand: Array.from({length:4},(_,i)=>`touch $${L(String.fromCharCode(97+i),600)}`).join(" && "),
  semi: Array.from({length:4},(_,i)=>`touch $${L(String.fromCharCode(97+i),600)}`).join("; "),
  newline: Array.from({length:4},(_,i)=>`touch $${L(String.fromCharCode(97+i),600)}`).join("\n"),
};
for (const [k, c] of Object.entries(tries)) { const r = run(c); console.log(k, r.exit, r.len, r.reason?.slice(0,60)); }
