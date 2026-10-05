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
      for (const c of j.message.content ?? []) if (c.type === "tool_result") lines.push(`tool_result ${JSON.stringify({ is_error: c.is_error, length: String(typeof c.content === "string" ? c.content : JSON.stringify(c.content)).length, content: c.content })}`);
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
const header = (title, note) => `${title}\nDate: 2026-10-02. Claude Code 2.1.267, Node ${process.version}, model alias haiku, Windows 11.\nPaths are replaced by placeholders: <REPO> (this repository), <SPIKES> (the scratch folder), <HOME>. Ids are replaced by stable placeholders.\n${note}\n`;

const spec = {
  B1: { title: "B1 (AP-5): wall clock of the real hook at timeout 60", note: "Every Bash call is denied by POL-05 today, so this times the DENY path, not the silent-allow path.", runs: ["s0-smoke", "b1-direct-1", "b1-direct-2", "b1-direct-3", "b1r-direct-4", "b1r-direct-5", "b1r-direct-6", "b1-tee-1", "b1-tee-2", "b1-tee-3"], logs: ["smoke", "b1-direct", "b1-tee"], profiles: ["smoke", "b1-direct", "b1-tee"] },
  B2: { title: "B2 (X-2): stdout closed before write, in a real session", note: "close = a launcher destroys the child's stdout read end before the hook writes. The runtime never closed the pipe itself.", runs: ["b2-baseline", "b2-close", "b2-control"], logs: ["b2-baseline", "b2-close", "b2-control"], profiles: ["b2-baseline", "b2-close", "b2-control"] },
  B3: { title: "B3 (X-3): which characters the runtime sanitizes in MCP names", note: "One combined session lists every case; five calls show the tool_name the hook received.", runs: ["b3-init", "b3-dot", "b3-unicode", "b3-dunder", "b3-tooldot", "b3-toollong"], logs: ["b3"], profiles: ["b3"], mcp: "combined" },
  B4: { title: "B4 (X-8): does a settings env block reach hooks", note: "b4-local: the same profile as b4, loaded as .claude/settings.local.json with --setting-sources local (the log file b4.jsonl has a second line from this run). User scope was NOT run (it would edit the real user settings file): UNPROVEN, treated as reachable. b4: ordinary variable. b4b: NODE_OPTIONS set to an unknown flag (the logger is a node process too, so it also died: no b4b log file).", runs: ["b4", "b4b", "b4-local"], logs: ["b4", "b4b"], profiles: ["b4", "b4b"] },
  B5: { title: "B5 (X-9): deny reason near the 512-character cap", note: "Rung runs b5-300/b5-374 were refused by the model and rerun as b5r-*; the model retyped 300 as 303 characters (logged command below).", runs: ["b5-300", "b5r-300", "b5-374", "b5r-374", "b5-600"], logs: ["b5"], profiles: ["b5"] },
  B6: { title: "B6 (U-5): matcher mcp__.* matches an MCP call", note: "Matcher mcp__.* only. One Bash call (expected: hook does not fire) and one MCP call (expected: fires).", runs: ["b6"], logs: ["b6"], profiles: ["b6"] },
};
const FOOT = {
  B1: () => `### method notes and the CI budget line
Three timing methods, not interchangeable: (1) "stream arrival": the runner timestamps each stream line as it arrives; hook_started to the last hook_response is the slower of the two parallel hooks (the real gate and a logger), runs b1r-direct-4/5/6 only; line-arrival granularity; stream events carry no timestamps of their own. (2) "tee child wall clock": the tee wrapper times the real hook child from spawn to exit with hrtime, runs b1-tee-1..3, and excludes the wrapper's own start (wrapper_start_offset_ms, 25 to 32 ms). (3) The CI budget instrument, run the same session on 2026-10-03T00:13:45Z, raw lines below. The CI p99 varies run to run (this build session saw 386.00 ms earlier; the reviewer saw 448.88 ms; this run 476.72 ms), so p99 is a band, not a point.
${read(join(ROOT, "qa-latency.txt")).trim()}
All Bash calls were denied by POL-05, so every timing is the deny path.`,
  B3: () => `### claims limited to the cases tried; N13 re-read
Observed at init only (the runtime's tool list, no call made): server names with a space, a colon, a plus and a slash; tool names with a space, a colon, a slash and a non-ASCII letter. Observed in a hook payload (tool_name received, with a call): the dot server (odd_srv), the non-ASCII server (caf___), the double-underscore server (a__b), the dot tool (do_it) and the 65-character tool.
N13 re-read (src/policy/normalizer/tool-class.test.ts:289): N13 asserts that the normalizer admits only [A-Za-z0-9_-] in the TOOL segment. Every tool name delivered by the runtime in this session (init list or hook payload) consists of [A-Za-z0-9_-] only, so for the cases tried the premise N13 rests on holds and no change to N13 follows from these runs. Characters not tried (for example NUL, line feed, zero-width, astral-plane characters) remain unmeasured.`,
};
for (const [k, s] of Object.entries(spec)) {
  const parts = [header(s.title, s.note), ...s.profiles.map(profile)];
  if (s.mcp) parts.push(`### mcp config ${s.mcp}.json (paths scrubbed)\n${read(join(ROOT, "mcp", `${s.mcp}.json`)).trim()}`);
  parts.push(...s.runs.map(renderRun), ...s.logs.map(renderLog));
  if (FOOT[k]) parts.push(FOOT[k]());
  writeFileSync(join(OUT, `${k}.txt`), scrub(parts.join("\n\n")) + "\n");
}
const ledger = jl(join(ROOT, "ledger.jsonl"));
writeFileSync(join(OUT, "ledger.txt"), scrub(`live calls: ${ledger.length}\ntotal cost USD: ${ledger.reduce((a, r) => a + r.cost_usd, 0).toFixed(4)}\n` + ledger.map((r) => `${r.id}\t${r.profile}\texit=${r.exit}\twall_ms=${r.wall_ms}\tcost_usd=${r.cost_usd}`).join("\n")) + "\n");
console.log("wrote", Object.keys(spec).length, "evidence files + ledger.txt to", OUT);
