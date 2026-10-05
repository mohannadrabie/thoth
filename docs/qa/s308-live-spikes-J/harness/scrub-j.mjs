// Builds scrubbed evidence files from raw/ and logs/ into the output dir (argv[2]).
// Usage: node scrub.mjs <outDir>
// Scrubbing is done here, by script; evidence is regenerated from raw/, never hand-edited.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname, userInfo } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const SEP = String.raw`(?:\\+|/)`;
const uuidMap = new Map();
const idMap = new Map();
const stable = (map, prefix, v) => {
  if (!map.has(v)) map.set(v, `<${prefix}-${map.size + 1}>`);
  return map.get(v);
};
function scrub(text) {
  let t = text;
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const user = esc(userInfo().username);
  const tail = `${SEP}AppData${SEP}Local${SEP}Temp${SEP}claude${SEP}[^"\\s]*?${SEP}scratchpad${SEP}[^"\\s\\\\/]+`;
  t = t.replace(new RegExp(`C:${SEP}Users${SEP}${user}${tail}`, "gi"), "<SPIKES>");
  t = t.replace(new RegExp(`${SEP}c${SEP}Users${SEP}${user}${tail}`, "gi"), "<SPIKES>");
  // Repo root (THOTH_REPO, required): its path segments may be separated by / or backslashes in raw output.
  const repoParts = (process.env.THOTH_REPO ?? "").replaceAll("\\", "/").split("/").filter(Boolean).map(esc);
  if (repoParts.length > 0) {
    t = t.replace(new RegExp(`(?:[A-Za-z]:|${SEP}[a-z])${SEP}${repoParts.slice(1).join(SEP)}`, "gi"), "<REPO>");
  }
  t = t.replace(new RegExp(`C:${SEP}Users${SEP}${user}`, "gi"), "<HOME>");
  t = t.replace(new RegExp(`${SEP}c${SEP}Users${SEP}${user}`, "gi"), "<HOME>");
  const email = process.env.SPIKE_SCRUB_EMAIL;
  if (email) t = t.split(email).join("<EMAIL>");
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<EMAIL>");
  t = t.replace(new RegExp(`\\b${user}\\b`, "gi"), "<USER>");
  const host = hostname();
  if (host) t = t.split(host).join("<HOSTNAME>");
  t = t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => stable(uuidMap, "UUID", m));
  t = t.replace(/\b(toolu|msg|req)_[A-Za-z0-9]{10,}/g, (m) => stable(idMap, m.split("_")[0].toUpperCase(), m));
  return t;
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const jl = (p) => read(p).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}...[clipped, ${s.length} chars]` : s);

function renderRun(id) {
  const meta = JSON.parse(read(join(ROOT, "raw", `${id}.meta.json`)));
  const lines = [`### run ${id}`, `profile=${meta.profile} exit=${meta.exit} wall_ms=${meta.wall_ms} cost_usd=${meta.cost_usd}`, `prompt: ${clip(meta.prompt, 900)}`, `claude args: ${JSON.stringify(meta.args)}`];
  for (const j of read(join(ROOT, "raw", `${id}.stream.jsonl`)).trim().split("\n").map((l) => JSON.parse(l))) {
    if (j.type === "system" && j.subtype === "init") {
      const own = (j.tools ?? []).filter((x) => x.startsWith("mcp__") && !x.startsWith("mcp__claude_ai_"));
      lines.push(`init: claude_code_version=${j.claude_code_version} model=${j.model} permissionMode=${j.permissionMode} builtin+connector tool count=${(j.tools ?? []).length}`);
      lines.push(`init mcp tools (non-connector): ${JSON.stringify(own)}`);
      lines.push(`init mcp_servers (non-connector): ${JSON.stringify((j.mcp_servers ?? []).filter((s) => !s.name.startsWith("claude.ai")))}`);
    } else if (j.type === "system" && (j.subtype === "hook_started" || j.subtype === "hook_response")) {
      lines.push(`${j.subtype} ${JSON.stringify({ hook_name: j.hook_name, exit_code: j.exit_code, outcome: j.outcome, stdout: j.stdout, stderr: j.stderr })}`);
    } else if (j.type === "assistant") {
      for (const c of j.message.content) {
        if (c.type === "tool_use") lines.push(`tool_use ${JSON.stringify({ name: c.name, input: c.input })}`);
        if (c.type === "text") lines.push(`assistant_text ${JSON.stringify(clip(c.text, 400))}`);
      }
    } else if (j.type === "user") {
      for (const c of j.message.content ?? []) if (c.type === "tool_result") lines.push(`tool_result ${JSON.stringify({ is_error: c.is_error, length: String(typeof c.content === "string" ? c.content : JSON.stringify(c.content)).length, content: ((t) => (t.length > 1500 || /TELEMETRY|USERDOMAIN/.test(t) ? `[omitted: ${String(t.length)} chars, looks like a full environment dump]` : t))(typeof c.content === "string" ? c.content : JSON.stringify(c.content)) })}`);
    } else if (j.type === "result") {
      lines.push(`result ${JSON.stringify({ subtype: j.subtype, num_turns: j.num_turns, total_cost_usd: j.total_cost_usd, is_error: j.is_error })}`);
    }
  }
  const tp = join(ROOT, "raw", `${id}.times.json`);
  if (existsSync(tp)) {
    const { times } = JSON.parse(read(tp));
    const hs = times.filter((x) => /hook_started/.test(x.head)).map((x) => x.t - times[0].t);
    const hr = times.filter((x) => /hook_response/.test(x.head)).map((x) => x.t - times[0].t);
    lines.push(`stream arrival ms (from first line): hook_started=${JSON.stringify(hs)} hook_response=${JSON.stringify(hr)}`);
  }
  return lines.join("\n");
}
const renderLog = (name) => `### log ${name}.jsonl\n${read(join(ROOT, "logs", `${name}.jsonl`)).trim() || "(no file: the logger never ran or never wrote)"}`;
const profile = (name) => `### profile ${name}.json\n${read(join(ROOT, "profiles", `${name}.json`)).trim()}`;
const header = (title, note) => `${title}\nDate: 2026-10-05. Claude Code 2.1.267, Node ${process.version}, model alias haiku, Windows 11.\nPaths are replaced by placeholders: <REPO> (this repository), <SPIKES> (the scratch folder), <HOME>. Ids are replaced by stable placeholders.\n${note}\n`;


const keys = ["shellprefix", "shelloptsnoexec", "bashfunc", "bashenv", "msys", "gitbash", "nodeopts", "gitdiff", "rg"];
const spec = {
  J3: { title: "J3 (U-8): a Bash call and an MCP call through the real runtime, allow and deny, against the real rules at HEAD", note: "Gate wired in a scratch project through the launcher form. Pre-E0 baseline: ordinary Bash reads (ls) are denied by POL-05. j3-powershell wires PowerShell into the matcher.", runs: ["j3-bash-allow", "j3-bash-deny", "j3-bash-protected", "j3-mcp-allow", "j3-mcp-deny", "j3-powershell"], logs: ["j3"], profiles: ["j3", "j3ps"], mcp: "classified" },
  J5: { title: "J5: permissions.deny Edit(...) against Edit and Write on a scratch copy of the fixture, default and bypassPermissions; wrong-case rule", note: "The real fixture is not edited. Before/after hashes are in the footer.", runs: ["j5-control-edit", "j5-deny-edit", "j5-deny-edit-bypass", "j5-deny-write", "j5-deny-write-bypass", "j5-case-edit"], logs: [], profiles: ["j5control", "j5deny", "j5case"] },
  J8: { title: "J8: settings env-block keys: reach into the gate's hook env, reach into the runtime's command shell, and whether the call is blocked", note: "j8-<key>: gate wired (shell-form launcher) with the key set, command kubectl get pods/x --context=c (the gate allows it). j8c-<key>: no gate, a probe command that prints the key. Hook order in the stream: the first hook_started is the gate (config order), the second is the logger.", runs: [...keys.map((k) => `j8-${k}`), ...keys.map((k) => `j8c-${k}`), "j8x-bashenvexit"], logs: [...keys.map((k) => `j8-${k}`), "j8x-bashenvexit"], profiles: [...keys.map((k) => `j8-${k}`), "j8x-bashenvexit"] },
  J9: { title: "J9: exec-form hook args versus the shell form", note: "Exec form: command sh with args [launcher, gate] (no shell spawned by the runtime). Variants set a settings env key that defeated the shell form in J8.", runs: ["j9shell-allow", "j9args-allow", "j9args-deny", "j9args-shellprefix", "j9args-shelloptsnoexec", "j9args-msys", "j9args-bashenvexit", "j9args-envi-shelloptsnoexec"], logs: [], profiles: ["j9shell", "j9args", "j9args-envi-shelloptsnoexec"] },
};
const FOOT = {
  J5: () => `### before/after sha256 (first 16 hex) of the scratch fixture copy\n${read(join(ROOT, "j5-hashes.txt")).trim()}`,
  J9: () => `### in-runtime hook wall time (stream arrival, ms from hook_started to hook_response, per hook)\n${read(join(ROOT, "j9-times.txt")).trim()}\n\n### local timing, 40 runs per cell (J6 and J6a)\n${read(join(ROOT, "j6-timing.json")).trim()}`,
};
for (const [k, s] of Object.entries(spec)) {
  const parts = [header(s.title, s.note), ...s.profiles.map(profile)];
  if (s.mcp) parts.push(`### mcp config ${s.mcp}.json (paths scrubbed)\n${read(join(ROOT, "mcp", `${s.mcp}.json`)).trim()}`);
  parts.push(...s.runs.map(renderRun), ...s.logs.map(renderLog));
  if (FOOT[k]) parts.push(FOOT[k]());
  writeFileSync(join(OUT, `${k}.txt`), scrub(parts.join("\n\n")) + "\n");
}
const ledger = jl(join(ROOT, "ledger.jsonl"));
writeFileSync(join(OUT, "ledger.txt"), scrub(`live calls: ${ledger.length}\ntotal cost USD: ${ledger.reduce((a, r) => a + r.cost_usd, 0).toFixed(4)}\nhard cap USD 1.50\n` + ledger.map((r) => `${r.id}\t${r.profile}\texit=${r.exit}\twall_ms=${r.wall_ms}\tcost_usd=${r.cost_usd}`).join("\n")) + "\n");
console.log("wrote", Object.keys(spec).length, "evidence files + ledger.txt to", OUT);
