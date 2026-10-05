// Builds scrubbed evidence files (P1.txt, P2.txt, P3.txt, ledger.txt) from raw/, logs/ and hashes.txt into argv[2].
// Adapted from story J's scrub-j.mjs: same scrub rules, plus agent ids, plus subagent (parent_tool_use_id) markers.
// Usage: THOTH_REPO=<repo> node scrub-s7.mjs <outDir>. Evidence is regenerated from raw/, never hand-edited.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname, userInfo } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const SEP = String.raw`(?:\\+|/)`;
const maps = {};
const stable = (prefix, v) => {
  const m = (maps[prefix] ??= new Map());
  if (!m.has(v)) m.set(v, `<${prefix}-${m.size + 1}>`);
  return m.get(v);
};
function scrub(text) {
  let t = text;
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const user = esc(userInfo().username);
  const tail = `${SEP}AppData${SEP}Local${SEP}Temp${SEP}claude${SEP}[^"\\s]*?${SEP}scratchpad${SEP}[^"\\s\\\\/]+`;
  t = t.replace(new RegExp(`~${tail}`, "gi"), "~/<SPIKES-REL>");
  t = t.replace(new RegExp(`C:${SEP}Users${SEP}${user}${tail}`, "gi"), "<SPIKES>");
  t = t.replace(new RegExp(`${SEP}c${SEP}Users${SEP}${user}${tail}`, "gi"), "<SPIKES>");
  const repoParts = (process.env.THOTH_REPO ?? "").replaceAll("\\", "/").split("/").filter(Boolean).map(esc);
  if (repoParts.length > 0) {
    t = t.replace(new RegExp(`(?:[A-Za-z]:|${SEP}[a-z])${SEP}${repoParts.slice(1).join(SEP)}`, "gi"), "<REPO>");
  }
  t = t.replace(new RegExp(`C:${SEP}Users${SEP}${user}`, "gi"), "<HOME>");
  t = t.replace(new RegExp(`${SEP}c${SEP}Users${SEP}${user}`, "gi"), "<HOME>");
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<EMAIL>");
  t = t.replace(new RegExp(`\\b${user}\\b`, "gi"), "<USER>");
  const host = hostname();
  if (host) t = t.split(host).join("<HOSTNAME>");
  t = t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => stable("UUID", m));
  t = t.replace(/\b(toolu|msg|req)_[A-Za-z0-9]{10,}/g, (m) => stable(m.split("_")[0].toUpperCase(), m));
  t = t.replace(/\ba[0-9a-f]{16}\b/g, (m) => stable("AGENT", m));
  return t;
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const jl = (p) => read(p).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}...[clipped, ${s.length} chars]` : s);

function renderRun(id) {
  const meta = JSON.parse(read(join(ROOT, "raw", `${id}.meta.json`)));
  const lines = [
    `### run ${id}`,
    `profile=${meta.profile} home_redirected=${meta.home_redirected} config_dir_redirected=${meta.config_dir_redirected ?? false} exit=${meta.exit} wall_ms=${meta.wall_ms} cost_usd=${meta.cost_usd}`,
    `prompt: ${clip(meta.prompt, 900)}`,
    `claude args: ${JSON.stringify(meta.args)}`,
  ];
  for (const j of read(join(ROOT, "raw", `${id}.stream.jsonl`)).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))) {
    const sub = j.parent_tool_use_id ? ` [inside subagent started by ${j.parent_tool_use_id}]` : "";
    if (j.type === "system" && j.subtype === "init") {
      lines.push(`init: claude_code_version=${j.claude_code_version} model=${j.model} permissionMode=${j.permissionMode}`);
      lines.push(`init built-in tools: ${(j.tools ?? []).filter((x) => !x.startsWith("mcp__")).join(",")}`);
    } else if (j.type === "system" && (j.subtype === "hook_started" || j.subtype === "hook_response")) {
      lines.push(`${j.subtype} ${JSON.stringify({ hook_name: j.hook_name, exit_code: j.exit_code, outcome: j.outcome, stdout: j.stdout, stderr: j.stderr })}`);
    } else if (j.type === "system" && /^task_(started|notification)$/.test(j.subtype)) {
      lines.push(`system ${j.subtype}`);
    } else if (j.type === "assistant") {
      for (const c of j.message.content) {
        if (c.type === "tool_use") lines.push(`tool_use ${JSON.stringify({ id: c.id, name: c.name, input: c.input })}${sub}`);
        if (c.type === "text") lines.push(`assistant_text ${JSON.stringify(clip(c.text, 1200))}${sub}`);
      }
    } else if (j.type === "user") {
      for (const c of j.message.content ?? []) {
        if (c.type !== "tool_result") continue;
        const t = typeof c.content === "string" ? c.content : JSON.stringify(c.content);
        lines.push(`tool_result ${JSON.stringify({ tool_use_id: c.tool_use_id, is_error: c.is_error, length: t.length, content: t.length > 1500 ? `[omitted: ${t.length} chars, file body]` : t })}${sub}`);
      }
    } else if (j.type === "result") {
      lines.push(`result ${JSON.stringify({ subtype: j.subtype, num_turns: j.num_turns, total_cost_usd: j.total_cost_usd, is_error: j.is_error, result: clip(String(j.result ?? ""), 1200) })}`);
    }
  }
  const err = read(join(ROOT, "raw", `${id}.err`)).trim();
  if (err) lines.push(`stderr: ${clip(err, 600)}`);
  return lines.join("\n");
}
const renderLog = (name) => `### logger file logs/${name}.jsonl (one line per hook call the logger saw)\n${read(join(ROOT, "logs", `${name}.jsonl`)).trim() || "(no file: the logger never ran or never wrote)"}`;
const profile = (name) => `### profile ${name}.json\n${read(join(ROOT, "profiles", `${name}.json`)).trim()}`;
const hashes = (prefix) => `### before/after sha256 (first 16 hex) of the target file\n${read(join(ROOT, "hashes.txt")).trim().split("\n").filter((l) => l.startsWith(prefix)).join("\n")}`;
const header = (title, note) => `${title}\nDate: 2026-10-05. Claude Code 2.1.267, Node ${process.version}, model alias haiku, Windows 11, Git Bash. Gate hosted from a detached worktree of origin/master (6f78aee).\nPaths are replaced by placeholders: <REPO> (this repository), <SPIKES> (the scratch folder; <SPIKES>/gate-wt is the gate worktree, <SPIKES>/proj the scratch project, <SPIKES>/home the scratch home, <SPIKES>/p2b-home the P2b dummy folder; ~/<SPIKES-REL> is <SPIKES> written relative to the real home), <HOME>. Ids are replaced by stable placeholders.\n${note}\n`;

const spec = {
  P1: {
    title: "P1: does PreToolUse fire for Bash inside a subagent, and does the gate's deny hold there?",
    note: "Profile: the K matcher Bash|PowerShell|mcp__.* with the shell-form gate plus the logger; a logger-only entry on Task|Agent (the gate refuses non-Bash, non-mcp names, so gating Task would stop the subagent). Attribution by content: a Bash call inside the subagent carries parent_tool_use_id in the stream, and its hook payload carries agent_id and agent_type (logger file). ls is denied by POL-05 at origin/master; kubectl get pods/x --context=c is allowed (as in J3) and ran (kubectl is installed; it failed on the missing context). p1-main-ctl is the control: the main agent runs the same commands directly.",
    runs: ["p1-main-ctl", "p1-sub-r1", "p1-sub-r2", "p1-sub-r3"],
    logs: ["p1-main-ctl", "p1-sub-r1", "p1-sub-r2", "p1-sub-r3"],
    profiles: ["p1-sub-r1"],
  },
  P2: {
    title: "P2: permissions.deny Edit(~/.claude/settings.json) against a dummy user settings file in a scratch home",
    note: "HOME and USERPROFILE pointed at <SPIKES>/home holding a freshly written dummy settings file (never a copy of a real one). Result: the runtime reports 'Not logged in' with the home redirected, at zero cost, before any tool call. Second attempt: CLAUDE_CONFIG_DIR at the scratch config dir (home also scratch): same. No credential file was copied anywhere, so P2 stopped here; the deny runs were not made.",
    runs: ["p2-control-edit", "p2-cfgdir-control-edit"],
    logs: [],
    profiles: ["p2control", "p2deny"],
    foot: "p2-",
  },
  P2b: {
    title: "P2b: a home-relative deny rule Edit(~/...) against a dummy .claude/settings.json under the real home (inside the scratch folder)",
    note: "Substitute for P2 (P2 could not authenticate with a redirected home). The real HOME is kept, so auth works. The target is a freshly written dummy file at <SPIKES>/p2b-home/.claude/settings.json, which lies under the real home. This measures ~ expansion for a home-relative Edit() rule on Windows; it does NOT probe the real ~/.claude/settings.json path. Restored from .orig before each run. Attribution by tool-result text: a deny rule gives 'File is in a directory that is denied by your permission settings'; default mode without a rule gives 'Claude requested permissions to write ... but you haven't granted it' (the file is outside the project). p2b-control-edit (Read not allowed) stopped at the Read. p2b-win-edit-bypass uses the same path in Windows backslash absolute form instead of ~.",
    runs: ["p2b-control-edit", "p2b-control-edit-2", "p2b-control-edit-bypass", "p2b-deny-edit", "p2b-deny-write", "p2b-deny-edit-bypass", "p2b-win-edit-bypass"],
    logs: [],
    profiles: ["p2bcontrol", "p2bdeny", "p2bwin"],
    foot: "p2b-",
  },
  P3: {
    title: "P3: J5 negative control: a deny rule for an UNRELATED file in the same directory leaves the fixture copy editable; J5's wrong-case rule again",
    note: "Scratch copy of docs/qa/s5-central-classification.json (from origin/master), restored from .orig before each run. The real fixture is not edited.",
    runs: ["p3-unrelated-edit", "p3-unrelated-write", "p3-case-edit"],
    logs: [],
    profiles: ["p3unrelated", "p3case"],
    foot: "p3-",
  },
};
for (const [k, s] of Object.entries(spec)) {
  const parts = [header(s.title, s.note), ...s.profiles.map(profile), ...s.runs.map(renderRun), ...s.logs.map(renderLog)];
  if (k === "P2") parts.push(`### dummy settings file written to <SPIKES>/home/.claude/settings.json\n${read(join(ROOT, "..", "home", ".claude", "settings.json.orig")).trim()}`);
  if (k === "P2b") parts.push(`### dummy settings file written to <SPIKES>/p2b-home/.claude/settings.json
${read(join(ROOT, "..", "p2b-home", ".claude", "settings.json.orig")).trim()}`);
  if (s.foot) parts.push(hashes(s.foot));
  writeFileSync(join(OUT, `${k}.txt`), scrub(parts.join("\n\n")) + "\n");
}
const ledger = jl(join(ROOT, "ledger.jsonl"));
writeFileSync(
  join(OUT, "ledger.txt"),
  scrub(`live calls: ${ledger.length}\ntotal cost USD: ${ledger.reduce((a, r) => a + r.cost_usd, 0).toFixed(4)}\nhard cap USD 1.00\n` + ledger.map((r) => `${r.id}\t${r.profile}\texit=${r.exit}\twall_ms=${r.wall_ms}\tcost_usd=${r.cost_usd}`).join("\n")) + "\n",
);
console.log("wrote", Object.keys(spec).length, "evidence files + ledger.txt to", OUT);
