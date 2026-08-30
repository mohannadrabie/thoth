#!/usr/bin/env node
// Local agent/project insights dashboard — reads reviewer verdicts + round counts and renders ONE
// self-contained static HTML file. Never hosted, never phones home: no CDN, no web fonts, no
// analytics, no external URLs are written into the output. Run it, open the file, done.
//
// DATA SOURCE PRIORITY (deliberate, stated once here): docs/REVIEW_LOG.md is PRIMARY, not a
// fallback. It already carries 40+ real dated rows (Date/Scope/Agent/Verdict/Report) with a working
// Agent column, self-appended by every reviewer at the end of its own turn (CLAUDE.md). GitHub
// Issues/Milestones (queried live via `gh`) are layered in for what they usefully add on top —
// bug-issue counts by severity, open/closed ratio, tracking-issue status, milestone count — because
// right now there are zero Milestones and the Issue set doesn't carry round-count/verdict data at
// all. If a future project's Issue/Milestone data becomes the richer source, swap the priority in
// STORY_SOURCE comments below; don't assume this ordering is universal.
//
// Modes:
//   node docs/dashboard.mjs             -> generate docs/dashboard.html (default path)
//   node docs/dashboard.mjs --out FILE  -> generate to a custom path (still your job to gitignore it)
//
// Fails soft: if `gh` isn't installed/authenticated, or REVIEW_LOG.md is missing/malformed, the
// dashboard still renders with whatever data it has and says plainly what's missing — it never
// throws out of the render.
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REVIEW_LOG = "docs/REVIEW_LOG.md";
const REVIEWS_DIR = "docs/reviews";
const RUN_LOG = "docs/run-log.jsonl";
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx > -1 && process.argv[outIdx + 1] ? process.argv[outIdx + 1] : "docs/dashboard.html";

// ---------- helpers ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function cellsOf(line) {
  let c = line.split("|");
  if (c.length && c[0].trim() === "") c = c.slice(1);
  if (c.length && c[c.length - 1].trim() === "") c = c.slice(0, -1);
  return c.map(s => s.trim());
}
const isTableRow = l => /^\s*\|/.test(l);
const isSeparator = l => isTableRow(l) && /^[\s|:-]+$/.test(l) && l.includes("-");

// ---------- 1. REVIEW_LOG.md (primary source) ----------
function readReviewLog() {
  let text;
  try { text = readFileSync(REVIEW_LOG, "utf8"); }
  catch { return { rows: [], note: `${REVIEW_LOG} not found — no review data.` }; }

  const lines = text.split(/\r?\n/);
  let headerIdx = -1, dateI = -1, scopeI = -1, agentI = -1, verdictI = -1, reportI = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isTableRow(lines[i]) || isSeparator(lines[i])) continue;
    const cells = cellsOf(lines[i]).map(c => c.toLowerCase());
    dateI = cells.findIndex(c => c.includes("date"));
    scopeI = cells.findIndex(c => c.includes("scope"));
    agentI = cells.findIndex(c => c.includes("agent"));
    verdictI = cells.findIndex(c => c.includes("verdict"));
    reportI = cells.findIndex(c => c.includes("report"));
    if (dateI >= 0 && scopeI >= 0 && agentI >= 0 && verdictI >= 0) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return { rows: [], note: `${REVIEW_LOG} found but no parseable Date/Scope/Agent/Verdict table.` };

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!isTableRow(l)) continue;
    if (isSeparator(l)) continue;
    const cells = cellsOf(l);
    if (cells.length <= Math.max(dateI, scopeI, agentI, verdictI)) continue;
    rows.push({
      date: cells[dateI] || "",
      scope: cells[scopeI] || "",
      agent: cells[agentI] || "",
      verdict: cells[verdictI] || "",
      report: reportI >= 0 ? (cells[reportI] || "").replace(/`/g, "") : "",
    });
  }
  return { rows, note: null };
}

// ---------- 2. GitHub Issues + Milestones (secondary, layered in) ----------
function sh(args) {
  return execFileSync(args[0], args.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function readGitHub() {
  // `available` means "gh CLI is reachable and this is a GitHub repo" — NOT "every query below
  // succeeded". `milestonesOk` tracks that specific query's success so a failed milestone query
  // surfaces as "couldn't check", never as a false-confident zero (see the note on the call below
  // for why `-f` cannot be used on this particular endpoint).
  const out = { available: false, note: "", repo: "", issues: [], milestones: [], milestonesOk: false };
  try {
    out.repo = sh(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
  } catch {
    out.note = "gh CLI not available/authenticated or not run inside a GitHub repo — Issue/Milestone panel skipped.";
    return out;
  }
  out.available = true;
  try {
    const json = sh(["gh", "issue", "list", "--state", "all", "--limit", "500", "--json",
      "number,title,state,labels,milestone"]);
    out.issues = JSON.parse(json);
  } catch { out.note += " Issue query failed."; }
  try {
    // NOTE: `-f state=all` makes `gh api` default to POST for this endpoint (any `-f`/`-F` flag
    // flips the implicit method), which always 422s against a read-only GET-only route. Force
    // GET explicitly — this is a read, never a write.
    const json = sh(["gh", "api", "--method", "GET", `repos/${out.repo}/milestones`, "-f", "state=all"]);
    out.milestones = JSON.parse(json);
    out.milestonesOk = true;
  } catch { out.note += " Milestone query failed."; }
  return out;
}

// ---------- 3. Derive stats from REVIEW_LOG rows ----------
function deriveStats(rows) {
  const verdictMix = new Map();     // verdict string (case-folded) -> count
  const perAgent = new Map();       // agent -> count
  const perStory = new Map();       // story key -> { rows, fixRounds, scopes:Set }

  for (const r of rows) {
    const v = (r.verdict || "unknown").trim();
    const vKey = v.toUpperCase() || "UNKNOWN";
    verdictMix.set(vKey, (verdictMix.get(vKey) || 0) + 1);

    const a = (r.agent || "unknown").trim().toLowerCase() || "unknown";
    perAgent.set(a, (perAgent.get(a) || 0) + 1);

    const m = r.scope.match(/^(story\d+)/i);
    const storyKey = m ? m[1].toLowerCase() : "(non-story scope)";
    if (!perStory.has(storyKey)) perStory.set(storyKey, { rows: 0, fixRounds: 0, scopes: new Set() });
    const s = perStory.get(storyKey);
    s.rows += 1;
    s.scopes.add(r.scope);
    if (/fixes?-?reconfirm|fix-cycle|rework/i.test(r.scope)) s.fixRounds += 1;
  }

  return { verdictMix, perAgent, perStory };
}

function deriveGitHubStats(gh) {
  const bySeverity = new Map(); // severity:x -> count (from bug-labeled issues)
  let open = 0, closed = 0, bugCount = 0;
  const tracking = [];
  for (const iss of gh.issues || []) {
    if (iss.state === "OPEN") open++; else closed++;
    const labelNames = (iss.labels || []).map(l => l.name);
    if (labelNames.includes("bug")) {
      bugCount++;
      const sev = labelNames.find(n => n.startsWith("severity:")) || "severity:unlabeled";
      bySeverity.set(sev, (bySeverity.get(sev) || 0) + 1);
    }
    if (labelNames.includes("current-focus")) tracking.push({ number: iss.number, title: iss.title, state: iss.state });
  }
  return { bySeverity, open, closed, bugCount, tracking };
}



// Report filenames carry the agent's name minus its `-reviewer` suffix: `code-reviewer` writes
// `<scope>-code-<date>.md`, `app-security-reviewer` writes `<scope>-app-security-<date>.md`. The run
// log, by contrast, records the agent's real name because that is what the Manager knows it by.
// Without this map the two never join and every per-agent Manager statistic silently reads zero,
// which is worse than showing nothing. Agents with no `-reviewer` suffix (red-team,
// design-challenger, impact-analyst, test-writer) need no entry — their slug already IS their name,
// and an unknown slug passes through unchanged rather than being dropped.
const SLUG_TO_AGENT = {
  code: "code-reviewer", architecture: "architecture-reviewer",
  "infra-security": "infra-security-reviewer", "app-security": "app-security-reviewer",
  api: "api-reviewer", data: "data-reviewer", network: "network-reviewer",
  performance: "performance-reviewer", usability: "usability-reviewer",
  "cross-domain": "cross-domain-reviewer",
  "impact-analyst-exposure": "impact-analyst", debug: "debugger",
};
const agentOf = slug => SLUG_TO_AGENT[slug] || slug;

// Report filenames are `<scope>-<slug>-<YYYY-MM-DD>.md`, and BOTH halves can contain hyphens
// ("auth-rotation" reviewed by "infra-security"). A greedy `(.*)-([a-z-]+)-<date>` split therefore
// hands back the SHORTEST slug it can get away with — "security" for infra-security, "domain" for
// cross-domain — which silently falls out of the slug map and gets attributed to an agent that does
// not exist. So match the slug against the known set, longest first, and only fall back to the
// generic split for a slug this build has never heard of.
const KNOWN_SLUGS = [
  "impact-analyst-exposure", "design-challenger", "infra-security", "app-security",
  "cross-domain", "impact-analyst", "architecture", "performance", "test-writer",
  "red-team", "usability", "network", "debug", "verify", "code", "data", "api",
].sort((a, b) => b.length - a.length);

function parseReportName(file) {
  const m = file.match(/^(.*)-(\d{4}-\d{2}-\d{2})\.md$/);
  if (!m) return null;
  const [, stem, date] = m;
  for (const slug of KNOWN_SLUGS) {
    if (stem === slug) return { scope: "", slug, date };
    if (stem.endsWith(`-${slug}`)) return { scope: stem.slice(0, -(slug.length + 1)), slug, date };
  }
  const g = stem.match(/^(.*?)-([a-z]+(?:-[a-z]+)*)$/);
  return g ? { scope: g[1], slug: g[2], date } : { scope: stem, slug: "unknown", date };
}

// ---------- 2b. RECEIPT blocks in docs/reviews/*.md (quality, not just volume) ----------
// Thirteen agents already close every report with a structured RECEIPT carrying the verdict, the
// complete finding list with severities, a counts checksum, an evidence-tier breakdown and the raw
// pass/fail/skip of whatever ran. That is the quality signal, and it is already on disk — this
// parses it rather than asking anyone to log it a second time. A report with no receipt is counted
// as exactly that (`noReceipt`), because a missing receipt is itself a finding the audit wants.
function readReceipts() {
  let files = [];
  try { files = readdirSync(REVIEWS_DIR).filter(f => f.endsWith(".md")); }
  catch { return { reports: [], note: `${REVIEWS_DIR}/ not found — no receipt data.` }; }

  const reports = [];
  for (const f of files) {
    let text = "";
    try { text = readFileSync(`${REVIEWS_DIR}/${f}`, "utf8"); } catch { continue; }

    // Agent and date come from the filename convention <scope>-<agent>-<YYYY-MM-DD>.md, which every
    // agent is told to use. A file that does not match still counts toward totals, as "unknown".
    const nm = parseReportName(f);
    const rec = {
      file: f,
      scope: nm ? nm.scope : f.replace(/\.md$/, ""),
      agent: nm ? agentOf(nm.slug) : "unknown",
      date: nm ? nm.date : "",
      isMetaAudit: /^meta-audit-/.test(f),
      hasReceipt: false,
      verdict: "", issues: 0, suspicions: 0, clean: 0,
      high: 0, med: 0, low: 0,
      demonstrated: 0, codeTraced: 0, derived: 0,
      checks: "", ranNothing: false, adr: "",
    };

    const rm = text.match(/RECEIPT:\s*(?:mode=\S+\s+)?verdict=([^\s|]+)/i);
    if (rm) { rec.hasReceipt = true; rec.verdict = rm[1].replace(/[<>]/g, "").trim(); }

    const counts = text.match(/counts[^\n]*?issues=(\d+)\s+suspicions=(\d+)\s+clean=(\d+)/i);
    if (counts) { rec.issues = +counts[1]; rec.suspicions = +counts[2]; rec.clean = +counts[3]; }

    // Loose on what sits between "evidence" and "demonstrated=": the line carries a parenthetical
    // ("evidence (a CHECKSUM over the tags above): demonstrated=…"), and a strict `evidence:` anchor
    // silently matches nothing, zeroing every evidence-quality column without erroring.
    const ev = text.match(/evidence[^\n]*?demonstrated=(\d+)\s+code-traced=(\d+)\s+derived=(\d+)/i);
    if (ev) { rec.demonstrated = +ev[1]; rec.codeTraced = +ev[2]; rec.derived = +ev[3]; }

    // Severity tags are counted from the receipt's own finding lines, not the prose above them.
    const receiptBody = text.slice(text.search(/RECEIPT:/i));
    rec.high = (receiptBody.match(/\[HIGH\]/g) || []).length;
    rec.med = (receiptBody.match(/\[MED\]/g) || []).length;
    rec.low = (receiptBody.match(/\[LOW\]/g) || []).length;

    const ck = receiptBody.match(/checks=([^\n]*)/i);
    if (ck) {
      rec.checks = ck[1].trim().replace(/[`"]/g, "").slice(0, 40);
      rec.ranNothing = /^n\/a/i.test(rec.checks);
    }
    const adr = receiptBody.match(/adr=(HIT|MISS|NONE)/i);
    if (adr) rec.adr = adr[1].toUpperCase();

    // A template's own placeholder receipt would poison the numbers; skip anything still carrying
    // the angle-bracket placeholders the agent definitions use as examples.
    if (rec.verdict.startsWith("<") || /<n>/.test(receiptBody.slice(0, 400))) rec.hasReceipt = false;

    reports.push(rec);
  }
  return { reports, note: null };
}

// Per-agent VOLUME and QUALITY. Volume is how much it produced; quality is whether what it produced
// was anchored in something that ran. The two most useful columns are `derived%` (findings reasoned
// from a document rather than the system — those cannot gate, per rule 19) and `ran nothing`, both
// of which a high-volume agent can quietly drift into.
function deriveAgentQuality(reports, runLog) {
  const m = new Map();
  for (const r of reports) {
    if (r.isMetaAudit) continue;
    const k = r.agent;
    if (!m.has(k)) m.set(k, {
      agent: k, reports: 0, noReceipt: 0, findings: 0, high: 0, med: 0, low: 0, cleanRuns: 0,
      demonstrated: 0, codeTraced: 0, derived: 0, ranNothing: 0, adrHit: 0, reopened: 0, triagedDown: 0,
    });
    const a = m.get(k);
    a.reports++;
    if (!r.hasReceipt) { a.noReceipt++; continue; }
    a.findings += r.issues + r.suspicions;
    a.high += r.high; a.med += r.med; a.low += r.low;
    if (r.issues === 0 && r.suspicions === 0) a.cleanRuns++;
    a.demonstrated += r.demonstrated; a.codeTraced += r.codeTraced; a.derived += r.derived;
    if (r.ranNothing) a.ranNothing++;
    if (r.adr === "HIT") a.adrHit++;
  }
  // The Manager's own judgements, which no receipt can carry: how often this agent's receipt did
  // not hold up, and how often its HIGH was triaged down as over-called.
  for (const [agent, n] of Object.entries(runLog.reopensByAgent || {})) {
    if (m.has(agent)) m.get(agent).reopened = n;
  }
  for (const [agent, n] of Object.entries(runLog.triagedByAgent || {})) {
    if (m.has(agent)) m.get(agent).triagedDown = n;
  }
  return [...m.values()].sort((a, b) => b.reports - a.reports);
}

// ---------- 2c. run-log.jsonl (the Manager's judgements) ----------
function readRunLog() {
  const empty = { available: false, entries: 0, byEvent: {}, reopensByAgent: {}, triagedByAgent: {}, tiers: { ratified: 0, changed: 0 }, council: {}, recent: [] };
  if (!existsSync(RUN_LOG)) return { ...empty, note: `${RUN_LOG} not found — no Manager-decision data yet.` };
  let text = "";
  try { text = readFileSync(RUN_LOG, "utf8"); } catch { return { ...empty, note: `${RUN_LOG} unreadable.` }; }

  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try { const o = JSON.parse(s); if (o && typeof o === "object") rows.push(o); } catch {}
  }
  const out = { ...empty, available: true, note: null, entries: rows.length, recent: rows.slice(-15).reverse() };
  out.byEvent = {}; out.reopensByAgent = {}; out.triagedByAgent = {}; out.council = {};
  out.tiers = { ratified: 0, changed: 0 };
  for (const r of rows) {
    out.byEvent[r.event] = (out.byEvent[r.event] || 0) + 1;
    if (r.event === "receipt-reopened" && r.agent) { const a = agentOf(r.agent); out.reopensByAgent[a] = (out.reopensByAgent[a] || 0) + 1; }
    if (r.event === "severity-triaged" && r.agent) { const a = agentOf(r.agent); out.triagedByAgent[a] = (out.triagedByAgent[a] || 0) + 1; }
    if (r.event === "tier-ratified") { out.tiers.ratified++; if (String(r.changed) === "true") out.tiers.changed++; }
    if (r.event === "council" && r.verdict) out.council[r.verdict] = (out.council[r.verdict] || 0) + 1;
  }
  return out;
}

// ---------- 2d. feature progress ----------
// Rolls Issues up by Feature ID label. Which labels those ARE is a per-project taxonomy, so this
// infers them rather than hard-coding: any label that is not one of the schema's own reserved
// prefixes is treated as a feature. An issue carrying none lands in "(unlabelled)", which is
// itself worth seeing — untracked work is the thing a progress view is supposed to surface.
const RESERVED = /^(bug|feature|chore|story|severity:|verdict:|blocked-on-owner|current-focus|rule-16-stop|needs:|arch:|oversized|adr-amendment|needs-architect-review|documentation|duplicate|enhancement|good first issue|help wanted|invalid|question|wontfix)/i;
function deriveFeatureProgress(gh) {
  const feats = new Map();
  for (const iss of gh.issues || []) {
    const names = (iss.labels || []).map(l => l.name);
    let keys = names.filter(n => !RESERVED.test(n));
    if (!keys.length) keys = ["(unlabelled)"];
    for (const k of keys) {
      if (!feats.has(k)) feats.set(k, { feature: k, open: 0, closed: 0, bugs: 0, high: 0 });
      const f = feats.get(k);
      if (iss.state === "OPEN") f.open++; else f.closed++;
      if (names.includes("bug")) f.bugs++;
      if (names.includes("severity:high")) f.high++;
    }
  }
  return [...feats.values()]
    .map(f => ({ ...f, total: f.open + f.closed, pct: f.open + f.closed ? Math.round((f.closed / (f.open + f.closed)) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

// ---------- 2e. audit highlights ----------
// /maat:audit writes a credibility scorecard and one process finding to
// docs/reviews/meta-audit-<date>.md every month, and until now nothing read those files.
function deriveAuditHighlights(reports) {
  const metas = reports.filter(r => r.isMetaAudit).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (!metas.length) return { available: false, note: "No meta-audit report found. Run /maat:audit to produce one.", latest: null, scorecard: [], processFinding: "", all: [] };

  const latest = metas[0];
  let text = "";
  try { text = readFileSync(`${REVIEWS_DIR}/${latest.file}`, "utf8"); } catch {}

  // The scorecard's own vocabulary, per audit.md step 3.
  const scorecard = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/([a-z][a-z-]{2,})[^\n]*?\b(IMPROVING|STEADY|DEGRADING)\b/i);
    if (!m) continue;
    // A scorecard row is usually a markdown table row (agent | grade | behaviour to change). Show
    // only the behaviour: the agent and grade already have their own columns, and repeating them
    // makes the note unreadable.
    let note = line;
    if (/^\s*\|/.test(line)) {
      const cells = cellsOf(line).filter(Boolean);
      note = cells.length > 2 ? cells.slice(2).join(" · ") : cells[cells.length - 1] || "";
    }
    scorecard.push({ agent: m[1].toLowerCase(), grade: m[2].toUpperCase(), line: note.replace(/^[\s|*\-]+/, "").slice(0, 180) });
  }
  const pf = text.match(/process finding[^\n]*[:\n]([\s\S]{0,400})/i);
  return {
    available: true, note: null, latest,
    scorecard: scorecard.slice(0, 20),
    processFinding: pf ? pf[1].trim().split(/\n\s*\n/)[0].slice(0, 400) : "",
    all: metas.slice(0, 6),
  };
}

// ---------- 4. Render ----------
function bar(count, max) {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
  return `<div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>`;
}

function render({ generatedAt, reviewLogNote, rows, stats, gh, ghStats, quality, runLog, features, audit, receiptNote }) {
  const totalRows = rows.length;
  const maxVerdict = Math.max(1, ...[...stats.verdictMix.values()]);
  const maxAgent = Math.max(1, ...[...stats.perAgent.values()]);

  const verdictRows = [...stats.verdictMix.entries()].sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `<tr><td>${esc(v)}</td><td class="num">${n}</td><td>${bar(n, maxVerdict)}</td></tr>`).join("\n");

  const agentRows = [...stats.perAgent.entries()].sort((a, b) => b[1] - a[1])
    .map(([a, n]) => `<tr><td>${esc(a)}</td><td class="num">${n}</td><td>${bar(n, maxAgent)}</td></tr>`).join("\n");

  const storyRows = [...stats.perStory.entries()]
    .sort((a, b) => {
      const na = parseInt((a[0].match(/\d+/) || ["999999"])[0], 10);
      const nb = parseInt((b[0].match(/\d+/) || ["999999"])[0], 10);
      return na - nb;
    })
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.rows}</td><td class="num">${v.fixRounds}</td><td>${v.scopes.size}</td></tr>`)
    .join("\n");

  const recentRows = [...rows].slice(-25).reverse()
    .map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.scope)}</td><td>${esc(r.agent)}</td><td>${esc(r.verdict)}</td><td class="mono">${esc(r.report)}</td></tr>`)
    .join("\n");

  const ghSevRows = [...ghStats.bySeverity.entries()].sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `<tr><td>${esc(s)}</td><td class="num">${n}</td></tr>`).join("\n");

  const trackingRows = ghStats.tracking
    .map(t => `<tr><td>#${t.number}</td><td>${esc(t.title)}</td><td>${esc(t.state)}</td></tr>`).join("\n");

  const milestoneSection = gh.milestonesOk
    ? (gh.milestones.length
        ? gh.milestones.map(m => `<tr><td>${esc(m.title)}</td><td class="num">${m.open_issues}</td><td class="num">${m.closed_issues}</td><td>${esc(m.state)}</td></tr>`).join("\n")
        : `<tr><td colspan="4">No Milestones exist yet.</td></tr>`)
    : `<tr><td colspan="4">${gh.available ? "Milestone query failed — couldn't check, not confirmed zero." : "GitHub data unavailable this run."}</td></tr>`;
  const milestoneTileValue = gh.milestonesOk ? String(gh.milestones.length) : "?";

  const ghNote = gh.available
    ? `Source: <span class="mono">gh issue list</span> / <span class="mono">gh api repos/${esc(gh.repo)}/milestones</span>, queried locally at generation time. Nothing here was fetched by the page itself.`
    : esc(gh.note || "gh CLI unavailable.");


  // ----- feature progress -----
  const featureRows = features.length
    ? features.map(f => `<tr><td>${esc(f.feature)}</td><td class="num">${f.closed}</td><td class="num">${f.open}</td><td class="num">${f.bugs}</td><td class="num">${f.high}</td><td>${bar(f.closed, Math.max(1, f.total))}<span class="mono"> ${f.pct}%</span></td></tr>`).join("\n")
    : `<tr><td colspan="6">${gh.available ? "No Issues to roll up yet." : "GitHub data unavailable this run."}</td></tr>`;

  // ----- agent volume + quality -----
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;
  const qualityRows = quality.length
    ? quality.map(a => {
        const ev = a.demonstrated + a.codeTraced + a.derived;
        const derivedPct = pct(a.derived, ev);
        const cleanPct = pct(a.cleanRuns, a.reports);
        // Flags are advisory. Each names a pattern the monthly audit is told to look for, so the
        // dashboard surfaces the candidate and a human decides — it never grades anyone itself.
        const flags = [];
        if (a.noReceipt) flags.push(`<span class="flag bad">${a.noReceipt} no receipt</span>`);
        if (a.ranNothing) flags.push(`<span class="flag warn">${a.ranNothing} ran nothing</span>`);
        if (ev >= 5 && derivedPct >= 50) flags.push(`<span class="flag warn">${derivedPct}% derived</span>`);
        if (a.reopened) flags.push(`<span class="flag bad">${a.reopened} reopened</span>`);
        if (a.triagedDown) flags.push(`<span class="flag warn">${a.triagedDown} triaged down</span>`);
        if (a.reports >= 4 && a.cleanRuns === 0) flags.push(`<span class="flag warn">never clean</span>`);
        return `<tr>
          <td>${esc(a.agent)}</td>
          <td class="num">${a.reports}</td>
          <td class="num">${a.findings}</td>
          <td class="num">${a.high}/${a.med}/${a.low}</td>
          <td class="num">${cleanPct}%</td>
          <td class="num">${ev ? `${pct(a.demonstrated + a.codeTraced, ev)}%` : "—"}</td>
          <td class="num">${pct(a.adrHit, a.reports)}%</td>
          <td>${flags.join(" ") || `<span class="flag ok">clean</span>`}</td>
        </tr>`;
      }).join("\n")
    : `<tr><td colspan="8">No parseable RECEIPT blocks in docs/reviews/ yet.</td></tr>`;

  // ----- audit highlights -----
  const scorecardRows = audit.available && audit.scorecard.length
    ? audit.scorecard.map(s => `<tr><td>${esc(s.agent)}</td><td><span class="flag ${s.grade === "DEGRADING" ? "bad" : s.grade === "IMPROVING" ? "ok" : ""}">${esc(s.grade)}</span></td><td>${esc(s.line)}</td></tr>`).join("\n")
    : `<tr><td colspan="3">${esc(audit.note || "No credibility grades parsed from the latest meta-audit.")}</td></tr>`;

  const runLogRows = runLog.available && runLog.recent.length
    ? runLog.recent.map(r => {
        const detail = Object.entries(r).filter(([k]) => !["at", "event", "_incomplete"].includes(k))
          .map(([k, v]) => `${esc(k)}=${esc(String(v))}`).join(" · ");
        return `<tr><td class="mono">${esc((r.at || "").slice(0, 10))}</td><td>${esc(r.event || "")}</td><td class="mono">${detail}</td></tr>`;
      }).join("\n")
    : `<tr><td colspan="3">${esc(runLog.note || "No Manager decisions logged yet.")}</td></tr>`;

  const runLogTiles = runLog.available
    ? `<div class="tile"><div class="k">Tiers ratified</div><div class="v">${runLog.tiers.ratified}</div><div class="s">${runLog.tiers.changed} changed from proposed</div></div>
       <div class="tile"><div class="k">Receipts reopened</div><div class="v">${runLog.byEvent["receipt-reopened"] || 0}</div><div class="s">a receipt that did not hold up</div></div>
       <div class="tile"><div class="k">Findings triaged down</div><div class="v">${runLog.byEvent["severity-triaged"] || 0}</div><div class="s">HIGH judged narrow enough to ship with</div></div>
       <div class="tile"><div class="k">Councils</div><div class="v">${(runLog.council.GO || 0) + (runLog.council["NO-GO"] || 0)}</div><div class="s">${runLog.council.GO || 0} GO · ${runLog.council["NO-GO"] || 0} NO-GO</div></div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Agent / Project Insights Dashboard</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root{
    --bg:#0f1115; --panel:#171a21; --border:#2a2f3a; --text:#e6e9ef; --muted:#9aa3b2;
    --accent:#5b8cff; --ok:#3fbf7f; --warn:#e0b84a; --bad:#e0605a;
  }
  *{box-sizing:border-box;}
  .flag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;border:1px solid var(--border);color:var(--muted);white-space:nowrap;}
  .flag.ok{color:var(--ok);border-color:var(--ok);}
  .flag.warn{color:var(--warn);border-color:var(--warn);}
  .flag.bad{color:var(--bad);border-color:var(--bad);}
  .note{color:var(--muted);font-size:13px;max-width:80ch;line-height:1.55;}
  body{
    margin:0; padding:2rem; background:var(--bg); color:var(--text);
    font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif; font-size:14px; line-height:1.5;
  }
  h1{font-size:1.4rem; margin:0 0 .25rem;}
  h2{font-size:1.05rem; margin:2rem 0 .75rem; border-bottom:1px solid var(--border); padding-bottom:.4rem;}
  .meta{color:var(--muted); font-size:.85rem; margin-bottom:1.5rem;}
  .tiles{display:flex; flex-wrap:wrap; gap:1rem; margin-bottom:1rem;}
  .tile{
    background:var(--panel); border:1px solid var(--border); border-radius:8px;
    padding:1rem 1.25rem; min-width:150px; flex:1;
  }
  .tile .n{font-size:1.8rem; font-weight:700;}
  .tile .l{color:var(--muted); font-size:.8rem; text-transform:uppercase; letter-spacing:.03em;}
  table{width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--border); border-radius:8px; overflow:hidden;}
  th,td{padding:.5rem .75rem; text-align:left; border-bottom:1px solid var(--border); vertical-align:middle;}
  th{color:var(--muted); font-weight:600; font-size:.78rem; text-transform:uppercase; letter-spacing:.03em;}
  tr:last-child td{border-bottom:none;}
  td.num{text-align:right; font-variant-numeric:tabular-nums; width:4rem;}
  .mono{font-family:ui-monospace,Consolas,monospace; font-size:.82rem; color:var(--muted);}
  .bar-track{background:#000; border-radius:4px; height:10px; width:120px; overflow:hidden;}
  .bar-fill{background:var(--accent); height:100%;}
  .note{color:var(--muted); font-size:.82rem; margin:.5rem 0 1rem;}
  .badge{
    display:inline-block; padding:.15rem .5rem; border-radius:999px; font-size:.72rem;
    background:#22262f; border:1px solid var(--border); color:var(--muted); margin-left:.5rem;
  }
  footer{margin-top:3rem; color:var(--muted); font-size:.78rem; border-top:1px solid var(--border); padding-top:1rem;}
</style>
</head>
<body>
  <h1>Agent / Project Insights Dashboard <span class="badge">local-only</span></h1>
  <div class="meta">Generated ${esc(generatedAt)} by <span class="mono">docs/dashboard.mjs</span> — data embedded at generation time, nothing on this page calls out.</div>

  ${reviewLogNote ? `<div class="note">⚠ ${esc(reviewLogNote)}</div>` : ""}

  <div class="tiles">
    <div class="tile"><div class="n">${totalRows}</div><div class="l">Review-log rows</div></div>
    <div class="tile"><div class="n">${stats.verdictMix.size}</div><div class="l">Distinct verdicts</div></div>
    <div class="tile"><div class="n">${stats.perAgent.size}</div><div class="l">Agents represented</div></div>
    <div class="tile"><div class="n">${stats.perStory.size}</div><div class="l">Stories / scopes tracked</div></div>
    <div class="tile"><div class="n">${ghStats.bugCount}</div><div class="l">Bug issues (all severities)</div></div>
    <div class="tile"><div class="n">${milestoneTileValue}</div><div class="l">Milestones</div></div>
  </div>

  <h2>Verdict mix (from docs/REVIEW_LOG.md)</h2>
  <table><thead><tr><th>Verdict</th><th class="num">Count</th><th></th></tr></thead>
  <tbody>${verdictRows || `<tr><td colspan="3">No rows.</td></tr>`}</tbody></table>

  <h2>Feature progress <span class="badge">Issues rolled up by feature label</span></h2>
  <table><thead><tr><th>Feature</th><th class="num">Closed</th><th class="num">Open</th><th class="num">Bugs</th><th class="num">High</th><th>Done</th></tr></thead>
  <tbody>${featureRows}</tbody></table>

  <h2>Agent performance <span class="badge">volume + quality, parsed from RECEIPT blocks</span></h2>
  <p class="note">Volume is what an agent produced. Quality is whether it was anchored in something that ran: <span class="mono">executed%</span> is the share of its findings backed by <span class="mono">demonstrated</span> or <span class="mono">code-traced</span> evidence rather than reasoned from a document, and only those two can gate a change. Flags name a pattern worth a look, not a verdict — a clean run is a good outcome, and an agent that is <em>never</em> clean is as much a signal as one that always is.</p>
  <table><thead><tr><th>Agent</th><th class="num">Reports</th><th class="num">Findings</th><th class="num">H/M/L</th><th class="num">Clean runs</th><th class="num">Executed%</th><th class="num">ADR hit</th><th>Flags</th></tr></thead>
  <tbody>${qualityRows}</tbody></table>

  <h2>Audit highlights <span class="badge">from the latest meta-audit</span></h2>
  ${audit.available ? `<p class="note">Latest: <span class="mono">docs/reviews/${esc(audit.latest.file)}</span>${audit.processFinding ? `<br><strong>Process finding:</strong> ${esc(audit.processFinding)}` : ""}</p>` : ""}
  <table><thead><tr><th>Agent</th><th>Grade</th><th>Note</th></tr></thead>
  <tbody>${scorecardRows}</tbody></table>

  <h2>Manager decisions <span class="badge">docs/run-log.jsonl</span></h2>
  <p class="note">The judgements no receipt can carry: which receipts did not hold up, which findings were triaged down and on what exposure, which tier was ratified against what was proposed, how a deadlock or council resolved. Telemetry only — nothing reads this to block anything.</p>
  <div class="tiles">${runLogTiles}</div>
  <table><thead><tr><th>Date</th><th>Event</th><th>Detail</th></tr></thead>
  <tbody>${runLogRows}</tbody></table>

  <h2>Per-agent finding counts</h2>
  <table><thead><tr><th>Agent</th><th class="num">Rows</th><th></th></tr></thead>
  <tbody>${agentRows || `<tr><td colspan="3">No rows.</td></tr>`}</tbody></table>

  <h2>Round / fix-cycle counts per story</h2>
  <p class="note">"Fix rounds" = scopes matching <span class="mono">*-fixes-reconfirm</span> / <span class="mono">*rework*</span> naming — derived from the scope column text, not hand-counted.</p>
  <table><thead><tr><th>Story</th><th class="num">Review rows</th><th class="num">Fix rounds</th><th>Distinct scopes</th></tr></thead>
  <tbody>${storyRows || `<tr><td colspan="4">No rows.</td></tr>`}</tbody></table>

  <h2>Recent reviews (last 25)</h2>
  <table><thead><tr><th>Date</th><th>Scope</th><th>Agent</th><th>Verdict</th><th>Report</th></tr></thead>
  <tbody>${recentRows || `<tr><td colspan="5">No rows.</td></tr>`}</tbody></table>

  <h2>GitHub Issues &amp; Milestones <span class="badge">layered in, live-queried</span></h2>
  <p class="note">${ghNote}</p>
  <div class="tiles">
    <div class="tile"><div class="n">${ghStats.open}</div><div class="l">Open issues</div></div>
    <div class="tile"><div class="n">${ghStats.closed}</div><div class="l">Closed issues</div></div>
  </div>

  <table><thead><tr><th>Bug severity label</th><th class="num">Count</th></tr></thead>
  <tbody>${ghSevRows || `<tr><td colspan="2">No bug-labeled issues found.</td></tr>`}</tbody></table>

  <h2>Current-Focus tracking issues</h2>
  <table><thead><tr><th>#</th><th>Title</th><th>State</th></tr></thead>
  <tbody>${trackingRows || `<tr><td colspan="3">None found.</td></tr>`}</tbody></table>

  <h2>Milestones</h2>
  <table><thead><tr><th>Title</th><th class="num">Open issues</th><th class="num">Closed issues</th><th>State</th></tr></thead>
  <tbody>${milestoneSection}</tbody></table>

  <footer>
    Local-only, gitignored artifact. No GitHub Pages, no external host, no analytics, no CDN, no web fonts.
    Regenerate any time: <span class="mono">node docs/dashboard.mjs</span>.
  </footer>
</body>
</html>
`;
}

// ---------- main ----------
function main() {
  const { rows, note: reviewLogNote } = readReviewLog();
  const stats = deriveStats(rows);
  const gh = readGitHub();
  const ghStats = deriveGitHubStats(gh);
  const { reports, note: receiptNote } = readReceipts();
  const runLog = readRunLog();
  const quality = deriveAgentQuality(reports, runLog);
  const features = deriveFeatureProgress(gh);
  const audit = deriveAuditHighlights(reports);

  const html = render({
    generatedAt: new Date().toISOString(),
    reviewLogNote, receiptNote,
    rows, stats, gh, ghStats, quality, runLog, features, audit,
  });

  const tmp = OUT + "." + process.pid + ".tmp";
  writeFileSync(tmp, html);
  renameSync(tmp, OUT);

  process.stdout.write(`📈 dashboard: wrote ${OUT} — ${rows.length} review-log row(s), ${stats.perAgent.size} agent(s), ${ghStats.bugCount} bug issue(s), ${gh.milestones.length} milestone(s). Open the file directly (file://) — nothing is hosted.\n`);
  if (reviewLogNote) process.stdout.write(`   note: ${reviewLogNote}\n`);
  if (receiptNote) process.stdout.write(`   note: ${receiptNote}\n`);
  if (runLog.note) process.stdout.write(`   note: ${runLog.note}\n`);
  if (!audit.available) process.stdout.write(`   note: ${audit.note}\n`);
  if (!gh.available) process.stdout.write(`   note: ${gh.note}\n`);
}

main();
