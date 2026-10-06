// #308 story K stage 0, check K3 (K3-edit-deny-covers-fixture): every generated protected path (protectedPaths().all) has
// its Edit(...) entries in the target settings file's permissions.deny. Takes a settings-file path argument (default
// .claude/settings.json). An empty or unparseable target fails: no vacuous pass. Default CI runs it on the merge script's dry-run
// output and the mutants below; the real file is checked only by qa:k-readiness.
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";
import { editDenyEntries, missingEditDenies, protectedPaths } from "./protected-path-list.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function checkK3(settingsText: string, paths: readonly string[]): InstrumentResult {
  const fail = (summary: string, details: string[] = []): InstrumentResult => ({ ok: false, vacuous: false, summary, details });
  if (paths.length === 0) return fail("no protected paths to check: refusing a vacuous pass");
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsText);
  } catch {
    return fail("settings text is not valid JSON");
  }
  const deny = typeof parsed === "object" && parsed !== null ? (parsed as { permissions?: { deny?: unknown } }).permissions?.deny : undefined;
  if (!Array.isArray(deny) || deny.length === 0) return fail("settings has no permissions.deny entries");
  const missing = missingEditDenies(settingsText, paths);
  if (missing.length > 0) return fail(`${String(missing.length)} protected path(s) lack their Edit(...) deny entry`, missing.map((m) => `missing: ${m}`));
  return { ok: true, vacuous: false, summary: `all ${String(paths.length)} protected paths have their Edit(...) deny entries`, details: [] };
}

/** Seeded mutants of a passing settings text. Each must make checkK3 fail. The count is read from this array. */
export interface K3Mutant {
  name: string;
  apply: (settingsText: string, root: string) => string;
}

const dropEntries = (settingsText: string, drop: (entry: string) => boolean): string => {
  const parsed = JSON.parse(settingsText) as { permissions: { deny: string[] } };
  parsed.permissions.deny = parsed.permissions.deny.filter((d) => !drop(d));
  return JSON.stringify(parsed);
};

export const K3_MUTANTS: readonly K3Mutant[] = [
  {
    name: "drop fixture line",
    // The classification fixture is the first named path (protectedPaths().named[0], read by path, not imported).
    apply: (text, root) => {
      const fixtureEntries = new Set(editDenyEntries(protectedPaths(root).named[0]!));
      return dropEntries(text, (d) => fixtureEntries.has(d));
    },
  },
  { name: "drop ~/ line", apply: (text) => dropEntries(text, (d) => d.startsWith("Edit(~/")) },
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2] ?? ".claude/settings.json";
  let result: InstrumentResult;
  try {
    result = checkK3(readFileSync(isAbsolute(arg) ? arg : resolve(process.cwd(), arg), "utf8"), protectedPaths(REPO_ROOT).all);
  } catch (e) {
    result = { ok: false, vacuous: false, summary: `cannot check ${arg}: ${(e as Error).message}`, details: [] };
  }
  printInstrumentResult("K3 edit-deny-covers-fixture", result);
  process.exit(exitCodeFor(result));
}
