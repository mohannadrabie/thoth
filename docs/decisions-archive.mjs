#!/usr/bin/env node
// Atomic, byte-exact archival sweep for the Decision Log (docs/decisions.md -> docs/decisions-archive.md).
//
// WHY A SCRIPT, not an LLM prose-edit: the decision log is an audit trail. An LLM re-emitting a markdown
// table drifts (whitespace, escaped pipes, reflowed cells, "helpful" typo fixes), can lose OR duplicate a
// row if interrupted between two file edits, and does error-prone date math. This script instead:
//   - moves ROW TEXT VERBATIM — it never re-renders a cell, so archived rows are byte-identical;
//   - preserves the file's original line endings (CRLF or LF) so the sweep doesn't churn the diff;
//   - is ATOMIC (temp file + rename per file; the archive is written and renamed BEFORE the source is
//     rewritten, so a crash between the two yields a DUPLICATE, never a LOSS);
//   - is IDEMPOTENT (a row already present verbatim in the archive is not appended again — so a re-run
//     after a mid-sweep crash reconciles cleanly rather than double-appending);
//   - takes a LOCK (atomic mkdir) so two concurrent session-handoffs can't both sweep the same file, and
//     RECOVERS A STALE LOCK by age (a sweep takes milliseconds; a lock older than STALE_MS is a leftover
//     from an interrupted run — Ctrl-C/SIGKILL skip the finally — and is reclaimed, not honored forever);
//   - reads the source INSIDE the lock, so a row appended by another writer between read and rewrite
//     can't be clobbered;
//   - is CONSERVATIVE on supersession: a struck-through / "SUPERSEDED" row is NEVER auto-moved, so the
//     archive can never end up holding a "superseded by X" pointer into a row still in the active log
//     (the chain-of-3 corruption). Move a fully-resolved supersession chain by hand, as one block, if ever.
//
// Modes:
//   node docs/decisions-archive.mjs            -> DRY RUN: report which rows WOULD archive. No writes.
//   node docs/decisions-archive.mjs --apply     -> perform the atomic move.
//
// A row archives IFF: "Human ratified" starts with Y or N (a RESOLVED decision — never "pending"), AND
// its "Review-back date" parses as YYYY-MM-DD and is strictly before today, AND the row is not
// struck-through / superseded. A row with an unparseable review-back date is left in place (conservative).
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const DECISIONS = join("docs", "decisions.md");
const ARCHIVE = join("docs", "decisions-archive.md");
const LOCK = join("docs", ".decisions-archive.lock");
const STALE_MS = 60_000; // a sweep is near-instant; a lock older than this is an abandoned leftover
const apply = process.argv.includes("--apply");

function today() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// split a markdown table row into trimmed cell strings (drop the empty leading/trailing from `| … |`)
function cellsOf(line) {
  let c = line.split("|");
  if (c.length && c[0].trim() === "") c = c.slice(1);
  if (c.length && c[c.length - 1].trim() === "") c = c.slice(0, -1);
  return c.map(s => s.trim());
}
const isTableRow = l => /^\s*\|/.test(l);
const isSeparator = l => isTableRow(l) && /^[\s|:-]+$/.test(l) && l.includes("-");
const stripMd = s => s.replaceAll("~~", "").replaceAll("**", "").trim();

// classify a decisions.md text into the rows eligible to archive (as of today).
function classify(text) {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1, ratifiedIdx = -1, reviewIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!isTableRow(lines[i]) || isSeparator(lines[i])) continue;
    const cells = cellsOf(lines[i]).map(c => c.toLowerCase());
    const r = cells.findIndex(c => c.includes("ratif"));
    const v = cells.findIndex(c => c.includes("review-back") || c.includes("review back"));
    if (r >= 0 && v >= 0) { headerIdx = i; ratifiedIdx = r; reviewIdx = v; break; }
  }
  if (headerIdx < 0) return { lines, headerIdx, candidates: [] };
  const td = today(), candidates = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!isTableRow(l)) { if (l.trim() === "") continue; else break; }
    if (isSeparator(l)) continue;
    const cells = cellsOf(l);
    if (cells.length <= Math.max(ratifiedIdx, reviewIdx)) continue;
    const struck = l.includes("~~") || /supersed/i.test(l);
    const ratified = stripMd(cells[ratifiedIdx] || "");
    const resolved = /^(Y|N)\b/i.test(ratified) && !/pending/i.test(ratified);
    const dm = (cells[reviewIdx] || "").match(/(\d{4}-\d{2}-\d{2})/);
    const past = dm && dm[1] < td;
    if (resolved && past && !struck) candidates.push({ idx: i, line: l });
  }
  return { lines, headerIdx, candidates };
}

// acquire the lock; reclaim it if it's a stale leftover (older than STALE_MS). Returns true on success.
function acquireLock() {
  try { mkdirSync(LOCK); return true; }
  catch {
    try {
      const age = Date.now() - statSync(LOCK).mtimeMs;
      if (age > STALE_MS) { rmdirSync(LOCK); mkdirSync(LOCK); return true; } // reclaim abandoned lock
    } catch {}
    return false;
  }
}

function main() {
  let text;
  try { text = readFileSync(DECISIONS, "utf8"); }
  catch { process.stdout.write(`📒 decisions sweep: ${DECISIONS} not found — nothing to do.\n`); return; }

  if (!apply) {
    const { headerIdx, candidates } = classify(text);
    if (headerIdx < 0) { process.stdout.write("📒 decisions sweep: no decisions table found — nothing to do.\n"); return; }
    if (!candidates.length) { process.stdout.write(`📒 decisions sweep (DRY RUN, as of ${today()}): 0 rows eligible. Active log unchanged.\n`); return; }
    process.stdout.write(`📒 decisions sweep (DRY RUN, as of ${today()}): ${candidates.length} row(s) would archive:\n`);
    for (const c of candidates) process.stdout.write(`   • ${c.line.slice(0, 100)}${c.line.length > 100 ? "…" : ""}\n`);
    process.stdout.write("   run with --apply to move them atomically.\n");
    return;
  }

  // --apply: lock FIRST, then read the source inside the lock so a concurrent append can't be clobbered.
  if (!acquireLock()) { process.stdout.write("📒 decisions sweep: another sweep is running (fresh lock held) — skipped. Re-run at next handoff.\n"); return; }
  try {
    text = readFileSync(DECISIONS, "utf8");                 // re-read under the lock
    const eol = text.includes("\r\n") ? "\r\n" : "\n";      // preserve the file's line endings
    const { headerIdx, lines, candidates } = classify(text);
    if (headerIdx < 0 || !candidates.length) {
      process.stdout.write(`📒 decisions sweep: 0 rows eligible to archive (as of ${today()}). Active log unchanged.\n`);
      return;
    }
    // ARCHIVE first (write + rename) so an interruption before the source rewrite duplicates, never loses.
    let archiveText = existsSync(ARCHIVE) ? readFileSync(ARCHIVE, "utf8")
      : "# Decision Log (archive)" + eol + eol + "| Date | Decision (+ evidence) | By | Dissent recorded | Human ratified | Review-back date |" + eol + "|---|---|---|---|---|---|" + eol;
    const aeol = archiveText.includes("\r\n") ? "\r\n" : "\n";
    const archiveLines = new Set(archiveText.split(/\r?\n/));
    const toAppend = candidates.filter(c => !archiveLines.has(c.line)).map(c => c.line); // dedup = idempotent
    if (toAppend.length) {
      if (!archiveText.endsWith("\n")) archiveText += aeol;
      archiveText += toAppend.join(aeol) + aeol;
      const atmp = ARCHIVE + "." + process.pid + ".tmp";
      writeFileSync(atmp, archiveText);
      renameSync(atmp, ARCHIVE);
    }
    // then rewrite the source with exactly those data-row lines removed (byte-exact for every other line)
    const drop = new Set(candidates.map(c => c.idx));
    const kept = lines.filter((_, i) => !drop.has(i));
    const dtmp = DECISIONS + "." + process.pid + ".tmp";
    writeFileSync(dtmp, kept.join(eol));
    renameSync(dtmp, DECISIONS);

    process.stdout.write(`📒 decisions sweep: archived ${candidates.length} row(s) → ${ARCHIVE} (${toAppend.length} new, ${candidates.length - toAppend.length} already present). Active log bounded.\n`);
  } finally {
    try { rmdirSync(LOCK); } catch {}
  }
}

main();
