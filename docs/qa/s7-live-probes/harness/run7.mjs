// Runner (s7 probes, adapted from story J's run.mjs):
//   node run7.mjs <id> --profile <p> --prompt "<text>" [--tools "<allowed>"] [--permission-mode <m>] [--budget 0.12]
//                [--home 1] [--cfg 1] [--hash <file>] [--restore <orig>]
// Cap: refuses when spent + this run's --budget would exceed USD 1.00 (hard cap), or at 40 calls; 180 s kill.
// --home 1: HOME and USERPROFILE point at ../home (a scratch home holding a dummy settings file). Nothing else is redirected.
// --hash <file>: sha256 (first 16 hex) of <file> before and after the run, appended to hashes.txt.
// --restore <orig>: copy <orig> over the --hash file before the run (fresh baseline each run).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAP = 1.0;
const [id, ...rest] = process.argv.slice(2);
const o = {};
for (let i = 0; i < rest.length; i += 2) o[rest[i].replace(/^--/, "")] = rest[i + 1];
const budget = Number(o.budget ?? "0.12");
const LEDGER = join(ROOT, "ledger.jsonl");
if (!existsSync(LEDGER) && process.env.SPIKE_NEW_LEDGER !== "1") {
  console.error(`REFUSED: no ledger at ${LEDGER}; set SPIKE_NEW_LEDGER=1 to start a new one`);
  process.exit(3);
}
const rows = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const spent = rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0);
console.error(`ledger before run: ${rows.length} calls, USD ${spent.toFixed(4)}; this run budget ${budget}; cap ${CAP}`);
if (rows.length >= 40 || spent + budget > CAP) {
  console.error(`REFUSED: ${rows.length} calls, USD ${spent.toFixed(4)} + ${budget} > ${CAP}`);
  process.exit(3);
}
const sha = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16) : "MISSING");
const hashFile = o.hash ? resolve(ROOT, o.hash) : undefined;
if (o.restore && hashFile) copyFileSync(resolve(ROOT, o.restore), hashFile);
const before = hashFile ? sha(hashFile) : undefined;
mkdirSync(join(ROOT, ".claude"), { recursive: true });
rmSync(join(ROOT, ".claude", "settings.local.json"), { force: true });
copyFileSync(join(ROOT, "profiles", `${o.profile}.json`), join(ROOT, ".claude", "settings.json"));
const args = [
  "-p", o.prompt, "--model", "haiku", "--output-format", "stream-json", "--verbose",
  "--include-hook-events", "--setting-sources", "project", "--disable-slash-commands", "--no-session-persistence",
  "--allowedTools", o.tools ?? "Bash", "--max-budget-usd", String(budget),
  "--strict-mcp-config", "--mcp-config", join(ROOT, "mcp", "none.json"),
];
if (o["permission-mode"]) args.push("--permission-mode", o["permission-mode"]);
const env = { ...process.env };
if (o.home === "1") {
  const home = resolve(ROOT, "..", "home");
  env.HOME = home;
  env.USERPROFILE = home;
}
// --cfg 1: CLAUDE_CONFIG_DIR points at ../home/.claude (scratch; holds only the dummy settings file, no credentials).
if (o.cfg === "1") env.CLAUDE_CONFIG_DIR = resolve(ROOT, "..", "home", ".claude");
const t0 = Date.now();
const c = spawn("claude", args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
let err = "";
c.stdout.on("data", (d) => (out += d));
c.stderr.on("data", (d) => (err += d));
const kill = setTimeout(() => c.kill(), 180000);
c.on("close", (code) => {
  clearTimeout(kill);
  mkdirSync(join(ROOT, "raw"), { recursive: true });
  writeFileSync(join(ROOT, "raw", `${id}.stream.jsonl`), out);
  writeFileSync(join(ROOT, "raw", `${id}.err`), err);
  let cost = 0;
  for (const l of out.split("\n")) {
    try {
      const j = JSON.parse(l);
      if (j.type === "result") cost = j.total_cost_usd ?? 0;
    } catch {}
  }
  const meta = {
    id, profile: o.profile, home_redirected: o.home === "1", config_dir_redirected: o.cfg === "1", args: args.filter((a) => a !== o.prompt), prompt: o.prompt,
    exit: code, wall_ms: Date.now() - t0, cost_usd: cost,
  };
  writeFileSync(join(ROOT, "raw", `${id}.meta.json`), JSON.stringify(meta, null, 1));
  appendFileSync(LEDGER, JSON.stringify(meta) + "\n");
  if (hashFile) {
    const after = sha(hashFile);
    appendFileSync(join(ROOT, "hashes.txt"), `${id} file=${o.hash} before=${before} after=${after} changed=${before === after ? "no" : "YES"}\n`);
  }
  console.log(JSON.stringify({ id, exit: code, wall_ms: meta.wall_ms, cost_usd: cost, spent_after: +(spent + cost).toFixed(4) }));
});
