// Runner: node run.mjs <id> --profile <p> --prompt "<text>" [--mcp <case>] [--tools "<allowed>"]
// Caps: refuses at 40 calls or USD 3.00 (ledger.jsonl), 0.25 USD per call, 120 s kill.
import { spawn } from "node:child_process";
import { copyFileSync, readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [id, ...rest] = process.argv.slice(2);
const o = {};
for (let i = 0; i < rest.length; i += 2) o[rest[i].replace(/^--/, "")] = rest[i + 1];
const LEDGER = join(ROOT, "ledger.jsonl");
const rows = existsSync(LEDGER)
  ? readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];
const spent = rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
if (rows.length >= 40 || spent >= 3.0) {
  console.error(`REFUSED: ${rows.length} calls, USD ${spent.toFixed(3)}`);
  process.exit(3);
}
mkdirSync(join(ROOT, ".claude"), { recursive: true });
copyFileSync(join(ROOT, "profiles", `${o.profile}.json`), join(ROOT, ".claude", "settings.json"));
const args = [
  "-p", o.prompt, "--model", process.env.SPIKE_MODEL ?? "haiku", "--output-format", "stream-json", "--verbose",
  "--include-hook-events", "--setting-sources", "project", "--disable-slash-commands", "--no-session-persistence",
  "--allowedTools", o.tools ?? "Bash", "--max-budget-usd", "0.25",
];
args.push("--strict-mcp-config", "--mcp-config", join(ROOT, "mcp", `${o.mcp ?? "none"}.json`));
const t0 = Date.now();
const c = spawn("claude", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
let err = "";
let pend = "";
const times = [];
c.stdout.on("data", (d) => {
  out += d;
  pend += d;
  const parts = pend.split("\n");
  pend = parts.pop();
  for (const l of parts) times.push({ t: Date.now(), n: l.length, head: l.slice(0, 120) });
});
c.stderr.on("data", (d) => (err += d));
const kill = setTimeout(() => c.kill(), 120000);
c.on("close", (code) => {
  clearTimeout(kill);
  mkdirSync(join(ROOT, "raw"), { recursive: true });
  writeFileSync(join(ROOT, "raw", `${id}.stream.jsonl`), out);
  writeFileSync(join(ROOT, "raw", `${id}.err`), err);
  writeFileSync(join(ROOT, "raw", `${id}.times.json`), JSON.stringify({ t0, times }));
  let cost = 0;
  for (const l of out.split("\n")) {
    try {
      const j = JSON.parse(l);
      if (j.type === "result") cost = j.total_cost_usd ?? 0;
    } catch {}
  }
  const meta = {
    id, profile: o.profile, args: args.filter((a) => a !== o.prompt), prompt: o.prompt,
    exit: code, wall_ms: Date.now() - t0, cost_usd: cost,
  };
  writeFileSync(join(ROOT, "raw", `${id}.meta.json`), JSON.stringify(meta, null, 1));
  appendFileSync(LEDGER, JSON.stringify(meta) + "\n");
  console.log(JSON.stringify({ id, exit: code, wall_ms: meta.wall_ms, cost_usd: cost }));
});
