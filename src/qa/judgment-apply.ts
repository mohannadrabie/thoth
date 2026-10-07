// #463 / #467 (S7, k-blocker): the judgment applier. The two judgment files (docs/qa/claude-code-write-deny-judgment.json and
// docs/qa/tool-exec-judgment.json) change ONLY through this script, from a committed approved-delta file (the human-approved record).
// Rules: an entry that already exists with the same value is a no-op (re-running changes nothing); one that exists with a different value
// is refused by `add` as a conflict. A re-judgment is a `replace`, which must name the entry's current value as `previous` (#479), so a
// judgment never needs a hand edit. An unknown judgment value, a protected entry without its path(s), an empty reason, an unknown section,
// a duplicate inside the delta, a claudeCodeVersion that is not x.y.z or a tool version that is not a date is refused. The version fields
// move only when the delta names them. The delta must live in docs/qa/judgment-deltas/ and be tracked in git and unmodified (#479): the
// committed delta is the human-approved record.
//
// Usage:  node src/qa/judgment-apply.ts <delta.json> [--dry-run]
// Delta:  { "writeDeny": { "claudeCodeVersion": "...", "add": { "<section>": [ {name, judgment, reason, path?} ] },
//                          "replace": { "<section>": [ {previous: <entry>, entry: <entry>} ] } },
//           "toolExec":  { "version": "YYYY-MM-DD", "add": [ {tool, judgment, reason, ...} ], "replace": [ {previous, entry} ] } }
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `anywhere` (#477/#478): census names judged ONCE for both levels (~/.claude/<name> and <project>/.claude/<name>); a protected one names BOTH paths. */
export const WRITE_DENY_SECTIONS = ["user", "project", "projectRoot", "anywhere"] as const;
type Section = (typeof WRITE_DENY_SECTIONS)[number];
const WRITE_DENY_JUDGMENTS: readonly string[] = ["protected", "residual"];
const TOOL_JUDGMENTS: readonly string[] = ["exec-routed", "exec-residual", "not-exec"];

export interface WriteDenyEntry {
  name: string;
  judgment: "protected" | "residual";
  reason: string;
  path?: string;
  /** anywhere section, protected only: the two named protected paths the one judgment covers. */
  userPath?: string;
  projectPath?: string;
}
export interface ToolEntry {
  tool: string;
  judgment: "exec-routed" | "exec-residual" | "not-exec";
  reason: string;
  residualCondition?: string;
  aliasOf?: string;
  evidence?: string;
}
export interface JudgmentFiles {
  writeDeny: { claudeCodeVersion: string; user: WriteDenyEntry[]; project: WriteDenyEntry[]; [section: string]: unknown };
  toolExec: { version: string; judgments: ToolEntry[]; [key: string]: unknown };
}
export interface Replace<T> {
  /** The entry's CURRENT value; the replace is refused when the file holds anything else. */
  previous: T;
  entry: T;
}
export interface Delta {
  writeDeny?: { claudeCodeVersion?: string; add?: Partial<Record<Section, WriteDenyEntry[]>>; replace?: Partial<Record<Section, Replace<WriteDenyEntry>[]>> };
  toolExec?: { version?: string; add?: ToolEntry[]; replace?: Replace<ToolEntry>[] };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function checkWriteDenyEntry(section: string, e: WriteDenyEntry): void {
  const label = `writeDeny:${section}:${String(e?.name)}`;
  if (typeof e?.name !== "string" || e.name.trim() === "") throw new Error(`${label}: entry needs a name`);
  if (!WRITE_DENY_JUDGMENTS.includes(e.judgment)) throw new Error(`${label}: unknown judgment ${JSON.stringify(e.judgment)}`);
  if (typeof e.reason !== "string" || e.reason.trim() === "") throw new Error(`${label}: empty reason`);
  const named = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";
  if (section === "anywhere") {
    if (e.judgment === "protected" && !(named(e.userPath) && named(e.projectPath))) throw new Error(`${label}: a protected anywhere entry names both its userPath and its projectPath`);
    if (e.path !== undefined) throw new Error(`${label}: an anywhere entry uses userPath and projectPath, not path`);
  } else if (e.judgment === "protected" && !named(e.path)) throw new Error(`${label}: a protected entry names its path`);
}
function checkToolEntry(e: ToolEntry): void {
  const label = `toolExec:${String(e?.tool)}`;
  if (typeof e?.tool !== "string" || e.tool.trim() === "") throw new Error(`${label}: entry needs a tool name`);
  if (!TOOL_JUDGMENTS.includes(e.judgment)) throw new Error(`${label}: unknown judgment ${JSON.stringify(e.judgment)}`);
  if (typeof e.reason !== "string" || e.reason.trim() === "") throw new Error(`${label}: empty reason`);
}
/** YYYY-MM-DD that is a real calendar date (no month 13, no 30 February). */
function isCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m === null) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
function checkSection(section: string): void {
  if (!(WRITE_DENY_SECTIONS as readonly string[]).includes(section)) throw new Error(`writeDeny: unknown section ${JSON.stringify(section)}`);
}

/** Pure: returns the files with the delta applied (mutates and returns its argument; callers pass a copy). */
export function applyDelta(files: JudgmentFiles, delta: Delta): JudgmentFiles {
  const wd = delta.writeDeny;
  if (wd !== undefined) {
    if (wd.claudeCodeVersion !== undefined) {
      if (typeof wd.claudeCodeVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(wd.claudeCodeVersion)) throw new Error(`writeDeny: claudeCodeVersion must be x.y.z, got ${JSON.stringify(wd.claudeCodeVersion)}`);
      files.writeDeny.claudeCodeVersion = wd.claudeCodeVersion;
    }
    for (const [section, entries] of Object.entries(wd.add ?? {})) {
      checkSection(section);
      const names = new Set<string>();
      for (const e of entries) {
        checkWriteDenyEntry(section, e);
        if (names.has(e.name)) throw new Error(`writeDeny:${section}:${e.name}: duplicate inside the delta`);
        names.add(e.name);
      }
      const list = (files.writeDeny[section] as WriteDenyEntry[] | undefined) ?? [];
      for (const e of entries) {
        const existing = list.find((x) => x.name === e.name);
        if (existing === undefined) list.push(e);
        else if (!same(existing, e)) throw new Error(`writeDeny:${section}:${e.name}: conflict, the entry exists with a different value (use replace with its previous value)`);
      }
      files.writeDeny[section] = list;
    }
    for (const [section, reps] of Object.entries(wd.replace ?? {})) {
      checkSection(section);
      const list = (files.writeDeny[section] as WriteDenyEntry[] | undefined) ?? [];
      for (const r of reps) {
        checkWriteDenyEntry(section, r.entry);
        if (r.previous?.name !== r.entry.name) throw new Error(`writeDeny:${section}:${r.entry.name}: replace changes the name (previous ${String(r.previous?.name)})`);
        const at = list.findIndex((x) => x.name === r.entry.name);
        if (at < 0) throw new Error(`writeDeny:${section}:${r.entry.name}: nothing to replace, no existing entry`);
        if (same(list[at], r.entry)) continue; // already applied
        if (!same(list[at], r.previous)) throw new Error(`writeDeny:${section}:${r.entry.name}: previous does not match the current value`);
        list[at] = r.entry;
      }
      files.writeDeny[section] = list;
    }
  }
  const te = delta.toolExec;
  if (te !== undefined) {
    if (te.version !== undefined) {
      if (typeof te.version !== "string" || !isCalendarDate(te.version)) throw new Error(`toolExec: version must be a date YYYY-MM-DD, got ${JSON.stringify(te.version)}`);
      files.toolExec.version = te.version;
    }
    const seen = new Set<string>();
    for (const e of te.add ?? []) {
      checkToolEntry(e);
      if (seen.has(e.tool)) throw new Error(`toolExec:${e.tool}: duplicate inside the delta`);
      seen.add(e.tool);
      const existing = files.toolExec.judgments.find((x) => x.tool === e.tool);
      if (existing === undefined) files.toolExec.judgments.push(e);
      else if (!same(existing, e)) throw new Error(`toolExec:${e.tool}: conflict, the entry exists with a different value (use replace with its previous value)`);
    }
    for (const r of te.replace ?? []) {
      checkToolEntry(r.entry);
      if (r.previous?.tool !== r.entry.tool) throw new Error(`toolExec:${r.entry.tool}: replace changes the tool name (previous ${String(r.previous?.tool)})`);
      const at = files.toolExec.judgments.findIndex((x) => x.tool === r.entry.tool);
      if (at < 0) throw new Error(`toolExec:${r.entry.tool}: nothing to replace, no existing entry`);
      if (same(files.toolExec.judgments[at], r.entry)) continue;
      if (!same(files.toolExec.judgments[at], r.previous)) throw new Error(`toolExec:${r.entry.tool}: previous does not match the current value`);
      files.toolExec.judgments[at] = r.entry;
    }
  }
  return files;
}

/** One line per delta entry that is not present (with the same value) in the files; empty when the delta is fully applied. */
export function missingFromDelta(files: JudgmentFiles, delta: Delta): string[] {
  const out: string[] = [];
  const sections = new Map<string, WriteDenyEntry[]>();
  for (const [section, entries] of Object.entries(delta.writeDeny?.add ?? {})) sections.set(section, [...(sections.get(section) ?? []), ...entries]);
  for (const [section, reps] of Object.entries(delta.writeDeny?.replace ?? {})) sections.set(section, [...(sections.get(section) ?? []), ...reps.map((r) => r.entry)]);
  for (const [section, entries] of sections) {
    const list = (files.writeDeny[section] as WriteDenyEntry[] | undefined) ?? [];
    for (const e of entries) if (!list.some((x) => same(x, e))) out.push(`writeDeny:${section}:${e.name}`);
  }
  for (const e of [...(delta.toolExec?.add ?? []), ...(delta.toolExec?.replace ?? []).map((r) => r.entry)]) if (!files.toolExec.judgments.some((x) => same(x, e))) out.push(`toolExec:${e.tool}`);
  return out;
}

export interface Paths {
  writeDeny: string;
  toolExec: string;
}
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DEFAULT_PATHS: Paths = { writeDeny: `${ROOT}docs/qa/claude-code-write-deny-judgment.json`, toolExec: `${ROOT}docs/qa/tool-exec-judgment.json` };
/** The one directory a delta may come from. */
export const DELTA_DIR = `${ROOT}docs/qa/judgment-deltas`;
const serialize = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;

/** #479: undefined when the file is tracked in git and equal to HEAD; otherwise the reason it is refused. The committed delta is the approved record. */
export function gitTrackedAndClean(path: string): string | undefined {
  const cwd = dirname(path);
  const git = (...args: string[]): number | null => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30000 }).status;
  if (git("ls-files", "--error-unmatch", "--", basename(path)) !== 0) return `${path} is not tracked in git`;
  if (git("diff", "--quiet", "HEAD", "--", basename(path)) !== 0) return `${path} is modified relative to HEAD (a delta must be the committed file)`;
  return undefined;
}

/** The file's bytes as committed at HEAD. Throws when git cannot produce them. */
export function committedBlob(path: string): string {
  const r = spawnSync("git", ["show", `HEAD:./${basename(path)}`], { cwd: dirname(path), encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${path}: cannot read the committed blob (git show HEAD:./${basename(path)} exited ${String(r.status)})`);
  return r.stdout;
}

export interface ApplyOptions {
  dryRun?: boolean;
  /** Where a delta may live (tests inject a temp dir). */
  deltaDir?: string;
  /** Returns the reason a delta is refused, or undefined (tests inject a stub; the default is gitTrackedAndClean). */
  gitCheck?: (path: string) => string | undefined;
}

/** Reads the delta and both files, applies, writes only the files whose bytes change (unless dryRun). `changed` is true when any file differs. Refuses a delta outside docs/qa/judgment-deltas/ or one not committed and unmodified. */
export function applyFiles(deltaPath: string, paths: Paths = DEFAULT_PATHS, opts: ApplyOptions = {}): { changed: boolean; missing: string[] } {
  const dir = resolve(opts.deltaDir ?? DELTA_DIR);
  const rel = relative(dir, resolve(deltaPath));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`delta ${deltaPath} is outside docs/qa/judgment-deltas/ (a delta is accepted only from there)`);
  const refused = (opts.gitCheck ?? gitTrackedAndClean)(resolve(deltaPath));
  if (refused !== undefined) throw new Error(refused);
  // the COMMITTED bytes are what gets applied (git show HEAD:./file), never the work tree: assume-unchanged, skip-worktree and a symlink cannot smuggle in uncommitted content.
  // When a test stubs gitCheck it also reads the file directly (no repository there).
  const text = opts.gitCheck !== undefined ? readFileSync(deltaPath, "utf8") : committedBlob(resolve(deltaPath));
  const delta = JSON.parse(text) as Delta;
  const before = { writeDeny: readFileSync(paths.writeDeny, "utf8"), toolExec: readFileSync(paths.toolExec, "utf8") };
  const files: JudgmentFiles = { writeDeny: JSON.parse(before.writeDeny) as JudgmentFiles["writeDeny"], toolExec: JSON.parse(before.toolExec) as JudgmentFiles["toolExec"] };
  applyDelta(files, delta);
  const after = { writeDeny: serialize(files.writeDeny), toolExec: serialize(files.toolExec) };
  let changed = false;
  for (const k of ["writeDeny", "toolExec"] as const) {
    if (after[k] === before[k]) continue;
    changed = true;
    if (opts.dryRun !== true) writeFileSync(paths[k], after[k]);
  }
  return { changed, missing: missingFromDelta(files, delta) };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const deltaPath = argv.find((a) => !a.startsWith("--"));
  if (deltaPath === undefined) {
    console.error("usage: node src/qa/judgment-apply.ts <delta.json> [--dry-run]");
    process.exitCode = 2;
  } else {
    try {
      const r = applyFiles(deltaPath, DEFAULT_PATHS, { dryRun: argv.includes("--dry-run") });
      console.log(`judgment-apply: ${r.changed ? (argv.includes("--dry-run") ? "WOULD CHANGE" : "CHANGED") : "NO CHANGE"} ${r.missing.length === 0 ? "(every delta entry present)" : `missing: ${r.missing.join(", ")}`}`);
      process.exitCode = r.missing.length === 0 ? 0 : 1;
    } catch (e) {
      console.error(`judgment-apply: REFUSED ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
}
