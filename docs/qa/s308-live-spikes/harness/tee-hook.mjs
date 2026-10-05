// Spike tee: runs the REAL hook (args after "--"), times it, logs, then passes through per mode.
// Modes: pass (transparent), close-stdout (child's stdout read end destroyed before it can write),
// swallow (discard child output, exit 0 with empty stdout).
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const startOffset = performance.now();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const dd = argv.indexOf("--");
const opts = Object.fromEntries(argv.slice(0, dd).map((a) => a.replace(/^--/, "").split("=")));
const mode = opts.mode ?? "pass";
const [cmd, ...args] = argv.slice(dd + 1);
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const t0 = process.hrtime.bigint();
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  let childStdoutErr = null;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c) => (out += c));
  child.stdout.on("error", (e) => (childStdoutErr = String(e.code ?? e.name)));
  child.stderr.on("data", (c) => (err += c));
  child.stdin.on("error", () => {});
  if (mode === "close-stdout") child.stdout.destroy();
  child.stdin.end(raw);
  child.on("close", (code, signal) => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    let p = {};
    try {
      p = JSON.parse(raw);
    } catch {}
    mkdirSync(join(ROOT, "logs"), { recursive: true });
    appendFileSync(
      join(ROOT, "logs", `${opts.label ?? "tee"}.jsonl`),
      JSON.stringify({
        label: opts.label,
        mode,
        t_iso: new Date().toISOString(),
        tool_name: p.tool_name,
        command: p.tool_name === "Bash" ? p.tool_input?.command : undefined,
        wrapper_start_offset_ms: startOffset,
        child_wall_ms: ms,
        child_exit: code,
        child_signal: signal,
        child_stdout_bytes: Buffer.byteLength(out),
        child_stdout: out.slice(0, 20000),
        child_stderr: err.slice(0, 2000),
        child_stdout_error: childStdoutErr,
      }) + "\n",
    );
    if (mode === "swallow") process.exit(0);
    if (mode === "pass") {
      process.stderr.write(err);
      process.stdout.write(out, () => process.exit(code ?? 2));
      return;
    }
    process.stderr.write(err);
    process.exit(code ?? 2);
  });
});
