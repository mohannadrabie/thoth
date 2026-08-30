#!/usr/bin/env node
// maat session brief — the one line a session should not have to spend tool calls rediscovering.
// Copied into a project as docs/session-brief.mjs by /maat:init, and invoked by the plugin's single
// SessionStart hook.
//
// WHY THIS EXISTS.
// The SessionStart hook already ran on every session to warm the ADR cache, and then stopped. But
// the facts a resuming session asks for first are all on disk and all cheap: what scope and tier is
// in flight, whether a human ruling is outstanding, whether any persisted review predates the commit
// now checked out, whether decisions are sitting past their review-back date. An agent that has to
// go find those spends four or five tool calls and a few thousand tokens of file content to learn
// what fits on one line. This prints the line. The ADR-cache warm-up it replaces still happens here,
// first, exactly as before.
//
// This is CONTEXT, NOT A GATE. It reads, it prints, it never writes and never blocks. Every failure
// path exits 0 silently — a hook that can break a session start is worse than no hook, and this
// plugin carries the loop, not an enforcement layer (see the repo's CLAUDE.md "Scope").
//
// IT IS DELIBERATELY ONE LINE. The value here is a resume point cheap enough to print unconditionally;
// the moment it grows into a report it costs more context than the lookups it saves. Anything that
// wants detail runs dashboard.mjs or receipt-check.mjs on purpose.
//
// Usage:
//   node docs/session-brief.mjs            -> warm the ADR cache, then print the brief
//   node docs/session-brief.mjs --no-adr   -> brief only (for a manual re-check mid-session)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const STATE = "docs/.maat-state.json";
const REVIEWS = "docs/reviews";

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const quiet = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

// 1 · Warm the ADR cache — the job this hook has always had. Its own output ("📊 ADR cache …") is
// what the agents are told to surface, so it is passed straight through.
if (!process.argv.includes("--no-adr") && existsSync("docs/adr-cache.mjs")) {
  quiet(() => execFileSync(process.execPath, ["docs/adr-cache.mjs", "--ensure"],
    { stdio: "inherit", timeout: 10000 }), null);
}

// 2 · Build the brief. Every part is optional; a part that cannot be determined is left out rather
// than guessed, because a wrong resume point is worse than a short one.
const parts = [];
const warn = [];

const st = quiet(() => JSON.parse(read(STATE) || "{}"), {}) || {};
if (st.scope) parts.push(`scope=${String(st.scope).slice(0, 48)}`);
if (st.tier) parts.push(`tier=${st.tier}`);
if (st.reviewRoundsSinceClean > 0) parts.push(`rounds=${st.reviewRoundsSinceClean}`);
if (st.humanRulingRequired === true || st.humanRulingRequired === "true") {
  warn.push("a human ruling is outstanding — do not resume a graded verdict past it");
}

// Reports that reviewed an older tree. A report carries `HEAD: <sha>` per PRINCIPLES rule 10, so
// this is a string compare, not a judgement about whether the review is still valid.
// stderr is ignored deliberately: outside a git repo git prints "fatal: not a git repository", and a
// SessionStart hook that spits an error into every session in a non-git project is worse than useless.
const head = quiet(() => execFileSync("git", ["rev-parse", "HEAD"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), null);
if (head && existsSync(REVIEWS)) {
  let fresh = 0, stale = 0;
  for (const f of quiet(() => readdirSync(REVIEWS).filter(x => x.endsWith(".md")), [])) {
    const t = read(`${REVIEWS}/${f}`);
    const m = t && t.match(/^HEAD:\s*([0-9a-f]{7,40})/im);
    if (!m) continue;
    if (head.startsWith(m[1])) fresh++; else stale++;
  }
  if (fresh || stale) parts.push(`reviews ${fresh} at HEAD${stale ? `, ${stale} stale` : ""}`);
}

// Decisions past their review-back date. decisions-archive.mjs without --apply is already a dry run
// and owns the eligibility rules, so this asks it rather than reimplementing them and drifting.
if (existsSync("docs/decisions-archive.mjs")) {
  const out = quiet(() => execFileSync(process.execPath, ["docs/decisions-archive.mjs"],
    { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] }), "");
  const m = out && out.match(/(\d+)\s+row\(s\) would archive/);
  if (m && +m[1] > 0) parts.push(`${m[1]} decision(s) due to archive`);
}

if (parts.length || warn.length) {
  process.stdout.write(`📋 maat: ${parts.join(" · ") || "no run in flight"}\n`);
  for (const w of warn) process.stdout.write(`⚠️  maat: ${w}\n`);
}
process.exit(0);
