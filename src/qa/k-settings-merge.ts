// #308 story K stage 0: the settings-merge generator. It computes the text of .claude/settings.json with the K gate entry
// (hooks.PreToolUse) and the generated Edit denies merged in. It is a dry run by default and never touches
// .claude/settings.json unless a human passes --write (story K's wiring step, human-approved, CRITICAL).
//
//   node src/qa/k-settings-merge.ts                      dry run: prints the merged settings text, writes nothing
//   node src/qa/k-settings-merge.ts --out=<path>         dry run, text written to <path> (how the checked-in fixture is produced)
//   node src/qa/k-settings-merge.ts --write              writes the merged text to the settings file
//   --settings=<path> (default .claude/settings.json)  --proposal=<path> (default the K proposal entry JSON)
//
// The entry (matcher, command, timeout) comes from the proposal JSON; the Edit entries come from protectedPaths(),
// editDenyEntries() and NESTED_EDIT_GLOBS, never typed here. Existing keys are preserved; merging twice equals merging once.
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { editDenyEntries, NESTED_EDIT_GLOBS, protectedPaths } from "./protected-path-list.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DEFAULT_SETTINGS = ".claude/settings.json";
export const DEFAULT_PROPOSAL = "docs/plans/s308-K-proposed-entry-2026-10-05.json";
export const GATE_SCRIPT = "pretooluse-kernel-gate.mjs";

export interface GateProposal {
  proposedMatcher: string;
  proposedCommand: string;
  timeout: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseProposal(text: string): GateProposal {
  let p: unknown;
  try {
    p = JSON.parse(text);
  } catch {
    throw new Error("proposal is not valid JSON");
  }
  if (!isObj(p)) throw new Error("proposal is not a JSON object");
  const { proposedMatcher, proposedCommand, timeout } = p;
  if (typeof proposedMatcher !== "string" || proposedMatcher === "") throw new Error("proposal has no proposedMatcher");
  if (typeof proposedCommand !== "string" || proposedCommand === "") throw new Error("proposal has no proposedCommand");
  if (typeof timeout !== "number" || !(timeout > 0)) throw new Error("proposal has no positive timeout");
  return { proposedMatcher, proposedCommand, timeout };
}

/** Every Edit(...) deny entry the protected-path list needs plus the nested globs, sorted and de-duplicated. */
export function generatedEditDenies(root: string): string[] {
  return [...new Set([...protectedPaths(root).all.flatMap(editDenyEntries), ...NESTED_EDIT_GLOBS])].sort();
}

/** Pure merge. Does not mutate `settings`. Throws on an unusable shape or on a conflicting gate entry already present. */
export function mergeSettings(settings: unknown, proposal: GateProposal, editDenies: readonly string[]): Obj {
  if (!isObj(settings)) throw new Error("settings is not a JSON object");
  if (proposal.proposedMatcher === "" || proposal.proposedCommand === "") throw new Error("proposal has an empty matcher or command");
  const out = structuredClone(settings);
  if (out.hooks !== undefined && !isObj(out.hooks)) throw new Error("settings.hooks is not an object");
  const hooks: Obj = isObj(out.hooks) ? out.hooks : {};
  const pre = hooks.PreToolUse;
  if (pre !== undefined && !Array.isArray(pre)) throw new Error("settings.hooks.PreToolUse is not an array");
  const entries: unknown[] = Array.isArray(pre) ? pre : [];
  const entry = { matcher: proposal.proposedMatcher, hooks: [{ type: "command", command: proposal.proposedCommand, timeout: proposal.timeout }] };
  const mentionsGate = (e: unknown): boolean => JSON.stringify(e).includes(GATE_SCRIPT);
  const gateEntries = entries.filter(mentionsGate);
  if (gateEntries.length > 1 || (gateEntries.length === 1 && JSON.stringify(gateEntries[0]) !== JSON.stringify(entry))) {
    throw new Error(`conflicting existing PreToolUse entry for ${GATE_SCRIPT}: reconcile by hand, this script never rewrites or duplicates it`);
  }
  hooks.PreToolUse = gateEntries.length === 1 ? entries : [...entries, entry];
  out.hooks = hooks;

  if (out.permissions !== undefined && !isObj(out.permissions)) throw new Error("settings.permissions is not an object");
  const permissions: Obj = isObj(out.permissions) ? out.permissions : {};
  if (permissions.deny !== undefined && !Array.isArray(permissions.deny)) throw new Error("settings.permissions.deny is not an array");
  const existing = (Array.isArray(permissions.deny) ? permissions.deny : []) as unknown[];
  if (!existing.every((d) => typeof d === "string")) throw new Error("settings.permissions.deny has a non-string entry");
  permissions.deny = [...new Set([...existing, ...editDenies])].sort();
  out.permissions = permissions;
  return out;
}

export const renderMerged = (merged: Obj): string => `${JSON.stringify(merged, null, 2)}\n`;

/** The dry-run text for the repo's real settings file and proposal (what the CLI prints by default). */
export function dryRunMergedText(root: string, settingsRel = DEFAULT_SETTINGS, proposalRel = DEFAULT_PROPOSAL): string {
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(root, p));
  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(abs(settingsRel), "utf8"));
  } catch (e) {
    throw new Error(`cannot read settings ${settingsRel}: ${(e as Error).message}`);
  }
  return renderMerged(mergeSettings(settings, parseProposal(readFileSync(abs(proposalRel), "utf8")), generatedEditDenies(root)));
}

export function main(argv: readonly string[]): number {
  const known = /^--(settings|proposal|out)=.+$|^--write$/;
  const bad = argv.filter((a) => !known.test(a));
  if (bad.length > 0) {
    console.error(`k-settings-merge: unknown argument(s): ${bad.join(" ")}`);
    return 1;
  }
  const opt = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const settings = opt("settings") ?? DEFAULT_SETTINGS;
  const out = opt("out");
  const write = argv.includes("--write");
  if (write && out !== undefined) {
    console.error("k-settings-merge: --write and --out are exclusive");
    return 1;
  }
  let text: string;
  try {
    text = dryRunMergedText(REPO_ROOT, settings, opt("proposal") ?? DEFAULT_PROPOSAL);
  } catch (e) {
    console.error(`k-settings-merge: ${(e as Error).message}`);
    return 1;
  }
  if (write) {
    writeFileSync(isAbsolute(settings) ? settings : resolve(REPO_ROOT, settings), text, "utf8");
    console.error(`k-settings-merge: wrote ${settings}`);
  } else if (out !== undefined) {
    writeFileSync(isAbsolute(out) ? out : resolve(REPO_ROOT, out), text, "utf8");
    console.error(`k-settings-merge: dry run written to ${out}`);
  } else process.stdout.write(text);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
