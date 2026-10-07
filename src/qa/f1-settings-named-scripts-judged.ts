// #455 (S7, k-blocker): F1-settings-named-scripts-judged, a K precondition (docs/plans/s308-K-wiring-plan-2026-10-05.md, the F1 row).
// Scripts that a hook runs outside the PreToolUse gate must each be protected, reported as outside the repo, or judged by the human.
// This instrument covers the hooks wired in project settings and the hooks registered by enabled plugins (#455); the other settings
// fields (statusLine, apiKeyHelper, awsAuthRefresh, otelHeadersHelper) stay with the human's read-only listing.
//
// Fails on: an in-repo script a plugin hook runs that is not on the protected list; a plugin hook command naming no script that no
// judgment covers (docs/qa/f1-hook-judgments.json, keyed by plugin and the command's sha256); an enabled plugin with no install record;
// a snapshot that fails its internal check; a snapshot that differs from the live plugin data (local only). A script outside the repo
// is reported, not a failure. No live plugin data (CI) is reported as UNVERIFIED, never as a pass of the live comparison.
// Usage: node src/qa/f1-settings-named-scripts-judged.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JUDGMENTS_REL,
  buildPluginSnapshot,
  pluginHookScan,
  protectedPaths,
  readSnapshot,
  snapshotInternalProblems,
  snapshotLiveDrift,
  wiredHookScan,
  type LiveDrift,
  type PluginHookSnapshot,
} from "./protected-path-list.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface Judgment {
  plugin: string;
  commandSha256: string;
  verdict: string;
  note: string;
  date: string;
}

export interface F1Input {
  root: string;
  snapshot: PluginHookSnapshot;
  protectedAll: readonly string[];
  judgments: readonly Judgment[];
  live: LiveDrift;
  /** Scripts the project settings hooks wire (wiredHookScan); each must be protected. */
  settingsScripts?: readonly string[];
}

export interface F1Result {
  ok: boolean;
  failures: string[];
  notes: string[];
}

const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

export function checkF1(i: F1Input): F1Result {
  const failures: string[] = [];
  const notes: string[] = [];
  for (const p of snapshotInternalProblems(i.snapshot)) failures.push(`snapshot inconsistent: ${p}`);
  const scan = pluginHookScan(i.root, i.snapshot);
  const protectedSet = new Set(i.protectedAll);
  for (const s of scan.scripts) if (!protectedSet.has(s)) failures.push(`unprotected plugin-hook script (not on the protected list): ${s}`);
  for (const s of i.settingsScripts ?? []) if (!protectedSet.has(s)) failures.push(`unprotected settings-hook script (not on the protected list): ${s}`);
  for (const u of scan.unenumerableBy) {
    const h = sha256Hex(u.command);
    const ok = i.judgments.some((j) => j.plugin === u.plugin && j.commandSha256 === h && j.verdict === "judged-safe");
    if (!ok) failures.push(`${u.plugin}: hook command names no script and has no judgment (sha256 ${h}): ${u.command.slice(0, 80)}`);
  }
  for (const id of scan.unresolved) failures.push(`${id}: enabled but has no install record, its hooks cannot be read`);
  if (i.live.status === "drift") failures.push(`snapshot drift: ${i.live.detail}`);
  if (i.live.status === "unverified") notes.push(`live comparison UNVERIFIED: ${i.live.detail}`);
  for (const o of scan.outside) notes.push(`outside the repo, reported not protected: ${o}`);
  for (const o of scan.absent) notes.push(`named but absent from the repo, reported not protected: ${o}`);
  return { ok: failures.length === 0, failures, notes };
}

export function main(): number {
  const snapshot = readSnapshot(REPO_ROOT);
  const judgmentsPath = join(REPO_ROOT, JUDGMENTS_REL);
  const judgments = existsSync(judgmentsPath) ? ((JSON.parse(readFileSync(judgmentsPath, "utf8")) as { judgments?: Judgment[] }).judgments ?? []) : [];
  const r = checkF1({
    root: REPO_ROOT,
    snapshot,
    protectedAll: protectedPaths(REPO_ROOT, { snapshot }).all,
    judgments,
    live: snapshotLiveDrift(snapshot, buildPluginSnapshot({ home: homedir(), root: REPO_ROOT })),
    settingsScripts: wiredHookScan(REPO_ROOT).scripts,
  });
  const scripts = pluginHookScan(REPO_ROOT, snapshot).scripts;
  if (r.ok) console.log(`F1-settings-named-scripts-judged: PASS, ${String(scripts.length)} plugin-hook script(s) protected${r.notes.length > 0 ? `; ${String(r.notes.length)} note(s)` : ""}`);
  else console.log(`F1-settings-named-scripts-judged: FAIL, ${String(r.failures.length)} problem(s)`);
  for (const l of r.failures) console.log(`  FAIL ${l}`);
  for (const l of r.notes) console.log(`  note ${l}`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
