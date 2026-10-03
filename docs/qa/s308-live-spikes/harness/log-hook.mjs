// Spike logger: records one JSON line per invocation; never decides (exit 0, no output).
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
  const e = process.env;
  const rec = {
    label,
    t_epoch_ms: t0,
    t_iso: new Date(t0).toISOString(),
    event: p.hook_event_name,
    tool_name: p.tool_name,
    tool_use_id: p.tool_use_id,
    command: p.tool_name === "Bash" ? p.tool_input?.command : undefined,
    stdin_bytes: Buffer.byteLength(raw),
    node_version: process.version,
    cwd: process.cwd(),
    env_probe: {
      keyCount: Object.keys(e).length,
      has: {
        CLAUDE_PROJECT_DIR: "CLAUDE_PROJECT_DIR" in e,
        NODE_OPTIONS: "NODE_OPTIONS" in e,
        SYSTEMROOT: "SYSTEMROOT" in e,
        windir: "windir" in e,
      },
      values: {
        SPIKE_ENV_PROBE: e.SPIKE_ENV_PROBE,
        CLAUDE_PROJECT_DIR: e.CLAUDE_PROJECT_DIR,
        NODE_OPTIONS: e.NODE_OPTIONS,
      },
      namesCLAUDE_SPIKE: Object.keys(e)
        .filter((k) => /^(CLAUDE|SPIKE)/.test(k))
        .sort(),
    },
  };
  mkdirSync(join(ROOT, "logs"), { recursive: true });
  appendFileSync(join(ROOT, "logs", `${label}.jsonl`), JSON.stringify(rec) + "\n");
  process.exit(0);
});
