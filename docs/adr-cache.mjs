#!/usr/bin/env node
// maat core — ADR cache: status, canonical fingerprint, and catalog build. Pure node —
// git is shelled out ONLY for autoSync (below), never for the cache itself, so status/build/
// fingerprint still run anywhere the hooks run. Copied into a project as docs/adr-cache.mjs.
//
// Modes:
//   node docs/adr-cache.mjs                -> status line + a machine tag CACHE=HIT|MISS|NONE (read-only, no sync)
//   node docs/adr-cache.mjs --ensure       -> [autoSync] pull ADRs, then build the catalog IF stale/absent, then status.
//                                             Idempotent and safe to call from ANY command or agent —
//                                             it checks first and only writes when a rebuild is needed.
//   node docs/adr-cache.mjs --build        -> [autoSync] pull ADRs, then (re)build the catalog now (force).
//   node docs/adr-cache.mjs --fingerprint  -> print ONLY the current ADR fingerprint (read-only, no sync).
//
// autoSync (opt-in via maat.json -> adr.autoSync, DEFAULT OFF): when true, --ensure/--build first
// fast-FORWARD (git merge --ff-only) each git submodule that holds an adr.dir to its upstream tip
// (adr.upstreamBranch, default "main") BEFORE fingerprinting — so newly-published ADRs are picked up on
// the next review WITHOUT updating the plugin. The ADR repo is the source of truth; the consumer only
// reads it. Fails soft: git absent, dir not a submodule, fetch failure, OR a branch diverged from
// upstream (unpushed local commits — --ff-only refuses) all report a note and proceed with the on-disk
// ADRs, never rewriting history. SKIPPED when $CI is set (reproducible headless/CI runs use the pinned
// SHA). autoSync advances the working tree; committing the advanced submodule pointer stays a human step.
// Default OFF because an auto-advance dirties the superproject tree, which collides with the clean-tree DoD.
//
// The catalog (docs/.maat-state.json -> adrCatalog) is a COMPRESSED, lossless index of the ADRs:
// per ADR it keeps { id, title, status, path, applicableTo, rules } — the domain tags and the exact
// enforceable MUST/SHOULD rules, NOT the prose (Context/Consequences/Alternatives). The full text stays
// in the file; `path` points back to it. This keeps tokens bounded while carrying the rules verbatim.
// Parses BOTH the plugin's YAML frontmatter (applicableTo/constraints) AND MADR markdown
// (`- **Tags:**` + a `## Rules for agents` bullet list). Rules are kept verbatim — never summarised —
// so nothing the model must obey is lossily compressed.
//
// The ADR fingerprint is a sha1 over every ADR .md (path + bytes), sorted by path — self-consistent
// (the same script writes and checks it), so any add/edit/remove invalidates the cache. adr.dir in
// maat.json scopes which folder(s) are scanned (an array reads several).
//
// Every status/build line also prints PER-ROOT coverage, e.g. `[docs/adr/app:12,
// docs/adr/infra:12]`, so a fullstack project spanning two domain folders can see at a glance that
// BOTH are populated — a silently-empty second root shows as `…:0` instead of hiding in one total.
//
// The token figure is an ESTIMATE (~500 tokens per reused ADR body avoided, minus ~200 to read the catalog).
import { readFileSync, writeFileSync, renameSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";

const STATE = join("docs", ".maat-state.json");
const EST_PER_ADR = 500, CATALOG_COST = 200;

function adrRoots() {
  try {
    const d = (JSON.parse(readFileSync("maat.json", "utf8")).adr || {}).dir;
    if (Array.isArray(d) && d.length) return { dirs: d.filter(Boolean), files: [] };
    if (typeof d === "string" && d.trim()) return { dirs: [d.trim()], files: [] };
  } catch {}
  return { dirs: ["adr", "docs/adr"], files: [] };
}

function walkMd(dir, acc) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc);
    else if (e.isFile() && e.name.endsWith(".md")) acc.push(p);
  }
}

function adrFiles() {
  const { dirs, files: extra } = adrRoots();
  const files = [];
  for (const d of dirs) walkMd(d, files);
  for (const f of extra) { try { if (statSync(f).isFile()) files.push(f); } catch {} }
  files.sort();
  return files;
}

// Per-root coverage — how many ADR .md each configured root contributes. Makes a silently-empty
// root (e.g. a fullstack project whose second domain folder is unpopulated) visible instead of
// hiding inside one merged count. Returns [{ dir, n }] in config order.
function coverage() {
  const { dirs } = adrRoots();
  return dirs.map(d => { const acc = []; walkMd(d, acc); return { dir: d, n: acc.length }; });
}
const covStr = roots => (roots && roots.length ? " [" + roots.map(r => `${r.dir}:${r.n}`).join(", ") + "]" : "");

// --- autoSync: fast-FORWARD the ADR submodule(s) to upstream before fingerprinting (opt-in) -------
// git is used ONLY here. Everything degrades soft — a missing git, a non-submodule dir, a fetch
// failure, OR a branch that has diverged from upstream (unpushed local commits) reports a note and
// falls back to the on-disk ADRs, never throwing out of the cache path and never rewriting history.
//
// SAFETY (why fast-forward, not `checkout -B`): the old hard-follow force-moved the branch ref to
// origin, silently orphaning any unpushed local ADR commits. `git merge --ff-only` advances only when
// upstream is a strict descendant — a diverged/unpushed branch makes it FAIL (caught → on-disk
// fallback), so local work is never lost. And the whole sync is SKIPPED when $CI is set, so headless
// / CI runs review against the submodule's pinned SHA (reproducible) instead of drifting to origin tip.
function maatAdr() { try { return (JSON.parse(readFileSync("maat.json", "utf8")).adr) || {}; } catch { return {}; } }
function git(args, cwd) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function submodulePaths() {
  try { return [...readFileSync(".gitmodules", "utf8").matchAll(/^\s*path\s*=\s*(.+)$/gm)].map(m => m[1].trim()); }
  catch { return []; }
}
// which submodule(s) contain a configured adr.dir (so we sync those, not every submodule in the repo)
function adrSubmodules() {
  const subs = submodulePaths(), hit = new Set();
  for (const d of adrRoots().dirs) { const n = d.replace(/\\/g, "/"); for (const s of subs) if (n === s || n.startsWith(s + "/")) hit.add(s); }
  return [...hit];
}
function syncAdrs() {
  if (process.env.CI) return "autoSync skipped ($CI set) — reviewing the pinned submodule SHA for reproducibility";
  const subs = adrSubmodules();
  if (!subs.length) return "autoSync on, but no adr.dir is inside a git submodule — nothing to pull";
  const br = maatAdr().upstreamBranch || "main", moved = [];
  for (const s of subs) {
    try {
      const before = git(["rev-parse", "--short", "HEAD"], s);
      git(["fetch", "--quiet", "origin", br], s);
      // fast-forward ONLY — never rewrites the branch ref, so unpushed local commits are never
      // orphaned; a diverged branch makes --ff-only fail → caught below → on-disk ADRs.
      git(["merge", "--ff-only", "--quiet", "origin/" + br], s);
      const after = git(["rev-parse", "--short", "HEAD"], s);
      if (before !== after) moved.push(`${s} ${before}→${after}`);
    } catch { moved.push(`${s} ⚠ not fast-forwardable (diverged/unpushed or git error) — using on-disk ADRs`); }
  }
  return moved.length ? "fast-forwarded " + moved.join(", ") : "already current with upstream";
}

function fingerprint(files) {
  if (!files.length) return "no-adr";
  const h = createHash("sha1");
  for (const f of files) { h.update(f + "\0"); try { h.update(readFileSync(f)); } catch {} h.update("\0"); }
  return h.digest("hex");
}

// Parse ONE ADR into a compact catalog entry. Handles YAML frontmatter and MADR markdown. Best-effort:
// unknown fields are left empty and the reviewer can still open `path`. Rules are kept verbatim.
function parseAdr(path) {
  let text = ""; try { text = readFileSync(path, "utf8"); } catch { return null; }
  const lines = text.split(/\r?\n/);
  const e = { id: "", title: "", status: "", path, applicableTo: [], rules: [] };
  const fnId = basename(path).match(/^(\d{3,4})/); if (fnId) e.id = "ADR-" + fnId[1];

  // --- YAML frontmatter (if present) ---
  let fmEnd = -1;
  if (lines[0] === "---") fmEnd = lines.indexOf("---", 1);
  if (fmEnd > 0) {
    const fm = lines.slice(1, fmEnd);
    for (let i = 0; i < fm.length; i++) {
      const m = fm[i].match(/^([A-Za-z]\w*):\s*(.*)$/);
      if (!m) continue;
      const key = m[1], val = m[2].trim();
      if (key === "id" && val) e.id = val;
      else if (key === "title" && val) e.title = val;
      else if (key === "status" && val) e.status = val.split(/[ |]/)[0];
      else if (key === "applicableTo") {
        if (val.startsWith("[")) e.applicableTo = val.replace(/[[\]]/g, "").split(",").map(s => s.trim()).filter(Boolean);
        else for (let j = i + 1; j < fm.length && /^\s*-\s+/.test(fm[j]); j++) e.applicableTo.push(fm[j].replace(/^\s*-\s+/, "").replace(/#.*$/, "").trim());
      } else if (key === "constraints") {
        for (let j = i + 1; j < fm.length; j++) {
          if (/^[A-Za-z]\w*:/.test(fm[j])) break;          // next top-level key
          const q = fm[j].match(/"([^"]+)"/);
          if (q) e.rules.push(q[1]);
          else { const b = fm[j].match(/^\s*-\s+(.+)$/); if (b) e.rules.push(b[1].replace(/^["']|["']$/g, "")); }
        }
      }
    }
  }

  // --- MADR / markdown fallbacks (fill whatever frontmatter didn't provide) ---
  const body = fmEnd > 0 ? lines.slice(fmEnd + 1) : lines;
  if (!e.title) { const h = body.find(l => /^#\s+/.test(l)); if (h) e.title = h.replace(/^#\s+/, "").replace(/^ADR[-\s]?\d+:\s*/i, "").trim(); }
  if (!e.status) { const s = text.match(/(?:^|\n)[-*]?\s*\*{0,2}Status:?\*{0,2}:?\s*([A-Za-z]+)/); if (s) e.status = s[1]; }
  if (!e.applicableTo.length) { const t = text.match(/[-*]\s*\*\*Tags:\*\*\s*(.+)/i); if (t) e.applicableTo = t[1].split(",").map(s => s.trim()).filter(Boolean); }
  if (!e.rules.length) {
    const idx = body.findIndex(l => /^#{1,6}\s*Rules for agents/i.test(l));
    if (idx >= 0) for (let j = idx + 1; j < body.length; j++) {
      if (/^#{1,6}\s/.test(body[j])) break;                 // next heading ends the section
      const b = body[j].match(/^\s*[-*]\s+(.+)$/); if (b) e.rules.push(b[1].trim());
    }
  }
  if (!e.title) e.title = e.id || basename(path);
  if (!e.status) e.status = "unknown";
  return e;
}

function buildCatalog(files, version) {
  const adrs = files.map(parseAdr).filter(Boolean);
  let state = {};
  try { state = JSON.parse(readFileSync(STATE, "utf8")); } catch {}
  state.adrCatalog = { version, location: adrRoots().dirs.join(", "), roots: coverage(), adrs };  // preserve every other field
  const tmp = STATE + "." + process.pid + ".tmp";                              // atomic write — safe under parallel agents
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, STATE);
  return adrs.length;
}

function readCatalog() {
  try { const c = (JSON.parse(readFileSync(STATE, "utf8")).adrCatalog) || {}; return { version: c.version || "none", n: Array.isArray(c.adrs) ? c.adrs.length : 0, roots: Array.isArray(c.roots) ? c.roots : null }; }
  catch { return { version: "none", n: 0, roots: null }; }
}

const hit = (n, fp, roots) => `📊 ADR cache HIT: reused ${n} ADR(s)${covStr(roots)} from catalog — ≈${Math.max(0, n * EST_PER_ADR - CATALOG_COST)} tokens saved this pass (fp ${fp.slice(0, 7)}) [CACHE=HIT]`;

const mode = process.argv[2];

// --fingerprint: pure read, never syncs.
if (mode === "--fingerprint") { process.stdout.write(fingerprint(adrFiles()) + "\n"); process.exit(0); }

// autoSync runs ONLY on the write-capable modes, and BEFORE we read ADRs from disk, so a pull is
// reflected in this same pass. Read-only status never touches the network or the working tree.
if ((mode === "--ensure" || mode === "--build") && maatAdr().autoSync) {
  process.stdout.write("↻ ADR autoSync: " + syncAdrs() + "\n");
}

const files = adrFiles();
const cur = fingerprint(files);

if (mode === "--build") {
  if (cur === "no-adr") { process.stdout.write("📊 ADR cache: no ADRs configured — nothing to build [CACHE=NONE]\n"); process.exit(0); }
  const n = buildCatalog(files, cur);
  process.stdout.write(`📊 ADR cache BUILT: cataloged ${n} ADR(s)${covStr(coverage())} with their rules (fp ${cur.slice(0, 7)}) [CACHE=HIT]\n`); process.exit(0);
}

if (mode === "--ensure") {
  if (cur === "no-adr") { process.stdout.write("📊 ADR cache: no ADRs configured — nothing to cache [CACHE=NONE]\n"); process.exit(0); }
  const st = readCatalog();
  if (st.version === cur && st.n > 0) { process.stdout.write(hit(st.n, cur, st.roots) + "\n"); process.exit(0); }  // already fresh — no write
  const n = buildCatalog(files, cur);
  process.stdout.write(`📊 ADR cache BUILT: cataloged ${n} ADR(s)${covStr(coverage())}, catalog now current (fp ${cur.slice(0, 7)}) [CACHE=HIT]\n`); process.exit(0);
}

// default: read-only status
const st = readCatalog();
let line;
if (cur === "no-adr") line = "📊 ADR cache: no ADRs configured — nothing to cache [CACHE=NONE]";
else if (cur === st.version && st.n > 0) line = hit(st.n, cur, st.roots);
else { const sc = st.version === "none" ? "none" : st.version.slice(0, 7); line = `📊 ADR cache MISS: catalog absent/stale (cached ${sc} vs current ${cur.slice(0, 7)}) — run \`node docs/adr-cache.mjs --ensure\` to build [CACHE=MISS]`; }
process.stdout.write(line + "\n");
