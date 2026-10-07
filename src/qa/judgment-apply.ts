// #463 / #467 (S7, k-blocker): the judgment applier. The two judgment files (docs/qa/claude-code-write-deny-judgment.json and
// docs/qa/tool-exec-judgment.json) change ONLY through this script, from a committed approved-delta file (the human-approved record).
// Rules: an entry that already exists with the same value is a no-op (re-running changes nothing); one that exists with a different value
// is refused as a conflict, never replaced; an unknown judgment value, a protected entry without a path, an empty reason, an unknown
// section or a duplicate inside the delta is refused. The version fields move only when the delta names them.
//
// Usage:  node src/qa/judgment-apply.ts <delta.json> [--dry-run]
// Delta:  { "writeDeny": { "claudeCodeVersion": "...", "add": { "<section>": [ {name, judgment, reason, path?} ] } },
//           "toolExec":  { "version": "...", "add": [ {tool, judgment, reason, residualCondition?, aliasOf?, evidence?} ] } }
import { readFileSync, writeFileSync } from "node:fs";
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
export interface Delta {
  writeDeny?: { claudeCodeVersion?: string; add?: Partial<Record<Section, WriteDenyEntry[]>> };
  toolExec?: { version?: string; add?: ToolEntry[] };
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

/** Pure: returns the files with the delta applied (mutates and returns its argument; callers pass a copy). */
export function applyDelta(files: JudgmentFiles, delta: Delta): JudgmentFiles {
  const wd = delta.writeDeny;
  if (wd !== undefined) {
    if (wd.claudeCodeVersion !== undefined) files.writeDeny.claudeCodeVersion = wd.claudeCodeVersion;
    for (const [section, entries] of Object.entries(wd.add ?? {})) {
      if (!(WRITE_DENY_SECTIONS as readonly string[]).includes(section)) throw new Error(`writeDeny: unknown section ${JSON.stringify(section)}`);
      const names = new Set<string>();
      for (const e of entries) {
        checkWriteDenyEntry(section, e);
        if (names.has(e.name)) throw new Error(`writeDeny:${section}:${e.name}: duplicate inside the delta`);
        names.add(e.name);
      }
      const list = ((files.writeDeny[section] as WriteDenyEntry[] | undefined) ?? []);
      for (const e of entries) {
        const existing = list.find((x) => x.name === e.name);
        if (existing === undefined) list.push(e);
        else if (!same(existing, e)) throw new Error(`writeDeny:${section}:${e.name}: conflict, the entry exists with a different value`);
      }
      files.writeDeny[section] = list;
    }
  }
  const te = delta.toolExec;
  if (te !== undefined) {
    if (te.version !== undefined) files.toolExec.version = te.version;
    const seen = new Set<string>();
    for (const e of te.add ?? []) {
      checkToolEntry(e);
      if (seen.has(e.tool)) throw new Error(`toolExec:${e.tool}: duplicate inside the delta`);
      seen.add(e.tool);
      const existing = files.toolExec.judgments.find((x) => x.tool === e.tool);
      if (existing === undefined) files.toolExec.judgments.push(e);
      else if (!same(existing, e)) throw new Error(`toolExec:${e.tool}: conflict, the entry exists with a different value`);
    }
  }
  return files;
}

/** One line per delta entry that is not present (with the same value) in the files; empty when the delta is fully applied. */
export function missingFromDelta(files: JudgmentFiles, delta: Delta): string[] {
  const out: string[] = [];
  for (const [section, entries] of Object.entries(delta.writeDeny?.add ?? {})) {
    const list = (files.writeDeny[section] as WriteDenyEntry[] | undefined) ?? [];
    for (const e of entries) if (!list.some((x) => same(x, e))) out.push(`writeDeny:${section}:${e.name}`);
  }
  for (const e of delta.toolExec?.add ?? []) if (!files.toolExec.judgments.some((x) => same(x, e))) out.push(`toolExec:${e.tool}`);
  return out;
}

export interface Paths {
  writeDeny: string;
  toolExec: string;
}
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DEFAULT_PATHS: Paths = { writeDeny: `${ROOT}docs/qa/claude-code-write-deny-judgment.json`, toolExec: `${ROOT}docs/qa/tool-exec-judgment.json` };
const serialize = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;

/** Reads the delta and both files, applies, writes only the files whose bytes change (unless dryRun). `changed` is true when any file differs. */
export function applyFiles(deltaPath: string, paths: Paths = DEFAULT_PATHS, opts: { dryRun?: boolean } = {}): { changed: boolean; missing: string[] } {
  const delta = JSON.parse(readFileSync(deltaPath, "utf8")) as Delta;
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
