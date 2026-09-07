// SUR-13 precondition / Issue #87's own fix precondition (docs/decisions.md, 2026-09-06 "S5 plan
// revision (v2) ratified on item 2(b)" row; design-challenger's S5 round-1 report, HIGH #2): a
// structural, build-time check that `.claude/settings.json`'s `hooks` object never names a
// `type: "command"` script that does not actually exist on disk. Had this check existed before S1,
// it would have caught `hooks/report-subject-gate.mjs`'s own defect (wired into `hooks.PreToolUse`
// since `master`'s orphan Initial commit, referencing a file that has never existed on this branch)
// the moment it was introduced, instead of four full CRITICAL-tier review cycles later.
//
// Per S5 Phase 1 plan v3 (docs/plans/S5-phase1-2026-09-06.md) §5, build-order step 1: this file is
// written and run FIRST, against the CURRENTLY-COMMITTED `.claude/settings.json` — confirmed RED
// today (the broken `report-subject-gate.mjs` entry) before any other S5 file is touched. That
// red run is the concrete proof this check is non-vacuous, not merely a structurally-plausible
// idea.
//
// `type: "prompt"` / `type: "agent"` hook entries are skipped, not flagged — they don't reference a
// script path on disk at all, so "does the path exist" doesn't apply to them.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export interface CommandPathReference {
  event: string;
  groupIndex: number;
  hookIndex: number;
  command: string;
  /** The script path extracted from `command`, before `${CLAUDE_PROJECT_DIR}` substitution — or
   * `null` when no `.mjs`-shaped path token could be found in the command string at all. */
  extractedPath: string | null;
}

interface HookEntryShape {
  type?: unknown;
  command?: unknown;
}

interface HookGroupShape {
  matcher?: unknown;
  hooks?: unknown;
}

/**
 * Extracts a `.mjs`-shaped script path from a `command` string — this repo's own shipped hook
 * commands are all `node "<path>.mjs"` or `node "<path>.mjs" <args>` (double-quoted) or, unquoted,
 * a single bare `<path>.mjs` token. This is deliberately narrow: it handles THIS repo's own
 * command shape, not a general shell-command parser (that job belongs to
 * src/policy/normalizer/shell.ts, a different layer with a different purpose).
 */
export function extractScriptPath(command: string): string | null {
  const quoted = /"([^"]+\.mjs)"/.exec(command);
  if (quoted?.[1]) return quoted[1];
  const bare = /(\S+\.mjs)/.exec(command);
  return bare?.[1] ?? null;
}

/** Substitutes every `${CLAUDE_PROJECT_DIR}` occurrence with `projectDir` — the one runtime
 * variable this repo's own hook commands use (see `.claude/settings.json`'s existing entry). */
export function substituteProjectDir(pathStr: string, projectDir: string): string {
  return pathStr.split("${CLAUDE_PROJECT_DIR}").join(projectDir);
}

/** Walks every `hooks.<event>[].hooks[]` entry in an already-parsed `.claude/settings.json` object,
 * returning one reference per `type: "command"` entry found. Entries of any other `type` (e.g.
 * `"prompt"`, `"agent"`) are skipped — not returned, not flagged — since they carry no script path
 * for this check to resolve. Tolerant of a missing/malformed `hooks` key: returns an empty array
 * rather than throwing, since "no hooks configured at all" is a legitimate state for a settings
 * file this check might one day be pointed at, not a parse error.
 */
export function extractCommandPathReferences(settings: unknown): CommandPathReference[] {
  const refs: CommandPathReference[] = [];
  if (typeof settings !== "object" || settings === null) return refs;
  const hooks = (settings as Record<string, unknown>).hooks;
  if (typeof hooks !== "object" || hooks === null) return refs;

  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((rawGroup: unknown, groupIndex: number) => {
      const group = rawGroup as HookGroupShape;
      const entries = Array.isArray(group?.hooks) ? (group.hooks as HookEntryShape[]) : [];
      entries.forEach((entry, hookIndex) => {
        if (entry?.type !== "command") return; // "prompt"/"agent" — no script path to check
        const command = typeof entry.command === "string" ? entry.command : "";
        refs.push({ event, groupIndex, hookIndex, command, extractedPath: extractScriptPath(command) });
      });
    });
  }
  return refs;
}

/**
 * Checks every command-type reference's resolved path against `exists` (injected so this is
 * testable against a fixture filesystem, not just the real disk — same DI convention as
 * src/lib/exec.ts's `Runner`).
 */
export function checkCommandPaths(
  settings: unknown,
  projectDir: string,
  exists: (p: string) => boolean,
): InstrumentResult {
  const refs = extractCommandPathReferences(settings);

  if (refs.length === 0) {
    return {
      ok: true,
      vacuous: true,
      summary: "0 command-type hook entries found in the parsed settings — vacuous pass.",
      details: [],
    };
  }

  const dangling: string[] = [];
  for (const ref of refs) {
    const label = `hooks.${ref.event}[${ref.groupIndex}].hooks[${ref.hookIndex}]`;
    if (!ref.extractedPath) {
      dangling.push(`${label}: could not extract a ".mjs" script path from command "${ref.command}"`);
      continue;
    }
    const resolved = resolve(substituteProjectDir(ref.extractedPath, projectDir));
    if (!exists(resolved)) {
      dangling.push(`${label}: "${resolved}" does not exist on disk (command: "${ref.command}")`);
    }
  }

  if (dangling.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${dangling.length} of ${refs.length} command-type hook entr${refs.length === 1 ? "y" : "ies"} reference a script that does not exist on disk.`,
      details: dangling,
    };
  }

  return {
    ok: true,
    vacuous: false,
    summary: `${refs.length} command-type hook entr${refs.length === 1 ? "y" : "ies"} checked, every referenced script resolves to a real file on disk.`,
    details: [],
  };
}

async function main(): Promise<void> {
  const settingsPath = process.argv[2] ?? ".claude/settings.json";
  const projectDir = process.argv[3] ?? process.cwd();

  const raw = await readFile(settingsPath, "utf8");
  const settings: unknown = JSON.parse(raw);

  const result = checkCommandPaths(settings, projectDir, existsSync);
  printInstrumentResult("SUR-13/Issue-87 gate-command-path-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
