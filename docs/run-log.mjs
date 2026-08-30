#!/usr/bin/env node
// maat run log — an append-only record of the JUDGEMENTS the loop makes, so an audit has something
// mechanical to read instead of re-deriving them from prose. Copied into a project as
// docs/run-log.mjs; the log itself is docs/run-log.jsonl.
//
// WHY THIS EXISTS, AND WHAT IT IS NOT.
// Almost everything an audit wants is already recorded: every reviewer persists a dated report to
// docs/reviews/ whose RECEIPT block carries its verdict, its complete finding list with severities,
// an evidence-tier breakdown and the raw pass/fail/skip of what it ran. dashboard.mjs parses those
// directly, so none of it needs logging here. What is NOT recorded anywhere mechanical is the
// Manager's own judgement: which receipts did not hold up and had to be reopened, which HIGH got
// triaged down and on what exposure, which tier was ratified against what was proposed, how a
// deadlock or a council actually resolved. Those live only in prose today. This file is exactly
// that gap and nothing more.
//
// This is TELEMETRY, NOT A GATE. Nothing reads this log to block, refuse or unlock anything, and
// nothing ever should — that belongs to a separate governance project, not to this plugin (see the
// repo's own CLAUDE.md "Scope"). It fails soft in every direction: an unwritable log, a full disk
// or a malformed argument prints a note and exits 0, because a telemetry failure must never take
// down a real run.
//
// Format is JSON Lines: one self-contained JSON object per line, appended with a single write and
// never rewritten. That is deliberate — parallel agents append concurrently, and an append-only
// single-line write has no read-modify-write race the way a JSON array or a markdown table would.
// It also matches PRINCIPLES rule 11: records are immutable, corrections are appended.
//
// It is a POINTER, not a second copy of the evidence. Log ids, paths, enums and numbers. Never log
// a finding's prose — link its report instead, the same rule the Issue schema already follows.
//
// Usage (agents call this via Bash):
//   node docs/run-log.mjs <event> key=value [key=value ...]
//   node docs/run-log.mjs --summary [--since YYYY-MM-DD]   -> aggregate counts, for a human or the dashboard
//   node docs/run-log.mjs --json    [--since YYYY-MM-DD]   -> the same aggregate as JSON
import { appendFileSync, readFileSync, existsSync } from "node:fs";

const LOG = "docs/run-log.jsonl";

// A closed set on purpose: the dashboard and the monthly audit both rely on these names, so a typo
// should be rejected loudly here rather than silently producing a category nobody aggregates.
const EVENTS = {
  "tier-ratified":    ["scope", "proposed", "ratified", "changed", "reason"],
  "receipt-reopened": ["scope", "agent", "trigger", "report"],
  "severity-triaged": ["scope", "agent", "from", "to", "exposure", "basis", "category"],
  "deadlock-ruled":   ["scope", "agents", "decision", "row"],
  "council":          ["scope", "trigger", "verdict", "rounds"],
  "stage":            ["scope", "stage", "outcome"],
};

const soft = (msg) => { process.stdout.write(`run-log: ${msg}\n`); process.exit(0); };

// ---------- read side ----------
function readLog() {
  if (!existsSync(LOG)) return [];
  let text = "";
  try { text = readFileSync(LOG, "utf8"); } catch { return []; }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    // One bad line never invalidates the rest — that is half the point of JSON Lines.
    try { const o = JSON.parse(t); if (o && typeof o === "object") out.push(o); } catch {}
  }
  return out;
}

function summarize(since) {
  const rows = readLog().filter(r => !since || String(r.at || "") >= since);
  const byEvent = new Map();
  const reopensByAgent = new Map();
  const triagedByAgent = new Map();
  const tiers = { ratified: 0, changed: 0 };
  const council = { GO: 0, "NO-GO": 0 };

  // Report filenames carry the agent's name minus its `-reviewer` suffix ("app-security") while
  // this log records the agent's name ("app-security-reviewer"). dashboard.mjs joins the two, so
  // normalize here as well and the two tools cannot disagree about who a statistic belongs to.
  const SLUG_TO_AGENT = { code: "code-reviewer", architecture: "architecture-reviewer", "infra-security": "infra-security-reviewer", "app-security": "app-security-reviewer", api: "api-reviewer", data: "data-reviewer", network: "network-reviewer", performance: "performance-reviewer", usability: "usability-reviewer", "cross-domain": "cross-domain-reviewer", "impact-analyst-exposure": "impact-analyst", debug: "debugger" };
  const agentOf = s => SLUG_TO_AGENT[s] || s;

  for (const r of rows) {
    byEvent.set(r.event, (byEvent.get(r.event) || 0) + 1);
    if (r.event === "receipt-reopened" && r.agent) { const a = agentOf(r.agent); reopensByAgent.set(a, (reopensByAgent.get(a) || 0) + 1); }
    if (r.event === "severity-triaged" && r.agent) { const a = agentOf(r.agent); triagedByAgent.set(a, (triagedByAgent.get(a) || 0) + 1); }
    if (r.event === "tier-ratified") { tiers.ratified++; if (String(r.changed) === "true") tiers.changed++; }
    if (r.event === "council" && r.verdict) council[r.verdict] = (council[r.verdict] || 0) + 1;
  }
  return {
    entries: rows.length,
    since: since || null,
    byEvent: Object.fromEntries(byEvent),
    reopensByAgent: Object.fromEntries(reopensByAgent),
    triagedByAgent: Object.fromEntries(triagedByAgent),
    tiers,
    council,
  };
}

// ---------- CLI ----------
const argv = process.argv.slice(2);
const sinceIdx = argv.indexOf("--since");
const since = sinceIdx > -1 ? argv[sinceIdx + 1] : null;

if (argv[0] === "--json") {
  process.stdout.write(JSON.stringify(summarize(since), null, 2) + "\n");
  process.exit(0);
}

if (argv[0] === "--summary") {
  const s = summarize(since);
  if (!s.entries) soft(`no entries in ${LOG}${since ? ` since ${since}` : ""}.`);
  const line = (k, v) => process.stdout.write(`  ${k.padEnd(22)} ${v}\n`);
  process.stdout.write(`run-log: ${s.entries} entr${s.entries === 1 ? "y" : "ies"}${since ? ` since ${since}` : ""}\n`);
  for (const [k, v] of Object.entries(s.byEvent)) line(k, v);
  if (s.tiers.ratified) line("tiers ratified", `${s.tiers.ratified} (${s.tiers.changed} changed from proposed)`);
  for (const [a, n] of Object.entries(s.reopensByAgent)) line(`reopened: ${a}`, n);
  for (const [a, n] of Object.entries(s.triagedByAgent)) line(`triaged down: ${a}`, n);
  process.exit(0);
}

const event = argv[0];
if (!event || event.startsWith("--")) {
  soft(`usage: node ${LOG.replace(".jsonl", ".mjs")} <${Object.keys(EVENTS).join("|")}> key=value ...  |  --summary  |  --json`);
}
if (!EVENTS[event]) {
  soft(`unknown event "${event}". Known: ${Object.keys(EVENTS).join(", ")}. Nothing written.`);
}

const rec = { at: new Date().toISOString(), event };
for (const arg of argv.slice(1)) {
  const eq = arg.indexOf("=");
  if (eq < 1) continue;                       // ignore a stray token rather than failing the run
  const k = arg.slice(0, eq);
  const v = arg.slice(eq + 1);
  // A cap, not a validator: this is a pointer record, so anything long enough to be prose is a
  // sign the caller is pasting a finding in here instead of linking its report.
  rec[k] = v.length > 300 ? v.slice(0, 300) + "…" : v;
}

const missing = EVENTS[event].filter(k => !(k in rec));
if (missing.length) {
  // Recorded anyway: a partial line is more useful to an audit than a dropped one, and the note
  // tells the caller what to add next time.
  rec._incomplete = missing.join(",");
}

try {
  appendFileSync(LOG, JSON.stringify(rec) + "\n");
  process.stdout.write(`run-log: ${event}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}\n`);
} catch (e) {
  soft(`could not write ${LOG} (${e.code || e.message}) — continuing, this never blocks a run.`);
}
