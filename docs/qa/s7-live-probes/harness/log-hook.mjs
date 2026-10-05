// Spike logger: records one JSON line per invocation; never decides (exit 0, no output).
// s7 change from story J: also records the payload's key names, agent_id, agent_type, permission_mode and session_id,
// so a call made inside a subagent can be attributed by content.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const t0 = Date.now();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const label = process.argv[2] ?? "log";
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let p = {};
  try {
    p = JSON.parse(raw);
  } catch {
    p = { parseError: true };
  }
  const rec = {
    label,
    t_iso: new Date(t0).toISOString(),
    event: p.hook_event_name,
    tool_name: p.tool_name,
    tool_use_id: p.tool_use_id,
    payload_keys: Object.keys(p).sort(),
    session_id: p.session_id,
    agent_id: p.agent_id,
    agent_type: p.agent_type,
    permission_mode: p.permission_mode,
    command: p.tool_name === "Bash" || p.tool_name === "PowerShell" ? p.tool_input?.command : undefined,
    subagent_type: p.tool_input?.subagent_type,
    task_prompt: typeof p.tool_input?.prompt === "string" ? p.tool_input.prompt.slice(0, 300) : undefined,
    stdin_bytes: Buffer.byteLength(raw),
  };
  mkdirSync(join(ROOT, "logs"), { recursive: true });
  appendFileSync(join(ROOT, "logs", `${label}.jsonl`), JSON.stringify(rec) + "\n");
  process.exit(0);
});
