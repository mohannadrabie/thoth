// #308 story K stage 0, check K5 (K-pretooluse-entry-uses-launcher): exactly one hooks.PreToolUse entry names the gate script, its
// command equals the proposal's launcher command byte for byte, its matcher equals the proposal's matcher, and every matcher token
// is accepted by the matcher-drift check's own extractor and vendored-tool comparison (Issue #401 closes here). Takes a settings-file
// path argument (default .claude/settings.json). Default CI runs it on the merge dry-run output and the seeded mutants; the real file
// is checked only by qa:k-readiness.
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";
import { loadBuiltinToolInventory } from "../policy/tools/builtin-tool-inventory.ts";
import { computeMatcherDrift, extractMatcherToolNames } from "./gate-matcher-drift-check.ts";
import { DEFAULT_PROPOSAL, GATE_SCRIPT, buildGateEntry, parseProposal, type GateProposal } from "./k-settings-merge.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

interface HookEntry {
  matcher?: unknown;
  hooks?: { type?: unknown; command?: unknown; timeout?: unknown }[];
}

export function checkK5(settingsText: string, proposal: GateProposal, vendored?: ReadonlySet<string>): InstrumentResult {
  const fail = (summary: string, details: string[] = []): InstrumentResult => ({ ok: false, vacuous: false, summary, details });
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsText);
  } catch {
    return fail("settings text is not valid JSON");
  }
  const top = typeof parsed === "object" && parsed !== null ? (parsed as { disableAllHooks?: unknown; hooks?: { PreToolUse?: unknown } }) : undefined;
  if (top === undefined) return fail("settings is not a JSON object");
  // The vendor's own switch for turning every hook off: anything but an absent key or an explicit false disables or confuses the gate.
  if ("disableAllHooks" in top && top.disableAllHooks !== false) return fail(`disableAllHooks is ${JSON.stringify(top.disableAllHooks)}: the gate would not run`);
  const pre = top.hooks?.PreToolUse;
  if (!Array.isArray(pre)) return fail("settings has no hooks.PreToolUse array");
  const gateEntries = (pre as HookEntry[]).filter((e) => JSON.stringify(e).includes(GATE_SCRIPT));
  if (gateEntries.length === 0) return fail(`no hooks.PreToolUse entry names ${GATE_SCRIPT}`);
  if (gateEntries.length > 1) return fail(`${String(gateEntries.length)} hooks.PreToolUse entries name ${GATE_SCRIPT}; exactly one is required`);
  // Fail closed on every other group: parallel hooks all run, and one that is not the gate is unreviewed (red-team #4).
  if (pre.length !== 1) return fail(`${String(pre.length)} hooks.PreToolUse groups; exactly the gate entry is required`, [`${String(pre.length - 1)} group(s) other than the gate entry`]);
  const entry = gateEntries[0]!;
  const details: string[] = [];
  // Deep equality with the merge's own entry covers every handler key (async, if, args, shell, asyncRewake, once, statusMessage, unknown keys).
  if (!isDeepStrictEqual(entry, buildGateEntry(proposal))) {
    details.push(`the gate entry is not exactly the merge's entry: have ${JSON.stringify(entry)}, want ${JSON.stringify(buildGateEntry(proposal))}`);
  }
  // The matcher-drift extractor over the same file: every token must be a vendored tool name or the one pattern token.
  const tokens = extractMatcherToolNames({ hooks: { PreToolUse: [entry] } });
  const vendoredNames = vendored ?? new Set(loadBuiltinToolInventory().tools);
  details.push(...computeMatcherDrift(tokens, vendoredNames));
  if (details.length > 0) return fail("the PreToolUse gate entry does not match the proposal", details);
  return { ok: true, vacuous: false, summary: "the PreToolUse gate entry is exactly the merge's entry (every handler key), is the only PreToolUse group, and disableAllHooks is not set", details: [] };
}

export interface K5Mutant {
  name: string;
  apply: (settingsText: string) => string;
}

function mutateEntry(text: string, f: (entry: { matcher: string; hooks: { command: string }[] }) => void): string {
  const parsed = JSON.parse(text) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } };
  const entry = parsed.hooks.PreToolUse.find((e) => JSON.stringify(e).includes(GATE_SCRIPT));
  if (entry === undefined) throw new Error("no gate entry to mutate");
  f(entry);
  return JSON.stringify(parsed);
}
function mutateHandler(text: string, extra: Record<string, unknown>): string {
  const parsed = JSON.parse(text) as { hooks: { PreToolUse: { hooks: Record<string, unknown>[] }[] } };
  const entry = parsed.hooks.PreToolUse.find((e) => JSON.stringify(e).includes(GATE_SCRIPT));
  if (entry === undefined) throw new Error("no gate entry to mutate");
  Object.assign(entry.hooks[0]!, extra);
  return JSON.stringify(parsed);
}
const dropToken = (token: string) => (text: string): string => mutateEntry(text, (e) => void (e.matcher = e.matcher.split("|").filter((t) => t !== token).join("|")));
const setCommand = (f: (c: string) => string) => (text: string): string => mutateEntry(text, (e) => void (e.hooks[0]!.command = f(e.hooks[0]!.command)));

/** The seeded mutants (8 command and matcher mutants, Monitor and RemoteTrigger counted separately, plus the neutering set). Each must make checkK5 fail; the count is read from this array. */
export const K5_MUTANTS: readonly K5Mutant[] = [
  { name: "bare node gate", apply: setCommand((c) => c.replace(/^sh "[^"]*launch-gate\.sh" /, "node ")) },
  { name: "trailing || true", apply: setCommand((c) => `${c} || true`) },
  { name: "trailing ; exit 0", apply: setCommand((c) => `${c}; exit 0`) },
  { name: "echo launcher gate", apply: setCommand((c) => c.replace(/^sh /, "echo ")) },
  { name: "bash for sh", apply: setCommand((c) => c.replace(/^sh /, "bash ")) },
  { name: "PowerShell missing from matcher", apply: dropToken("PowerShell") },
  { name: "Monitor missing from matcher", apply: dropToken("Monitor") },
  { name: "RemoteTrigger missing from matcher", apply: dropToken("RemoteTrigger") },
  ...(
    [
      ["handler async true", { async: true }],
      ["handler if never matches", { if: "Bash(__never__)" }],
      ["handler args empty", { args: [] }],
      ["handler shell powershell", { shell: "powershell" }],
      ["handler asyncRewake true", { asyncRewake: true }],
      ["handler once true", { once: true }],
      ["handler statusMessage added", { statusMessage: "x" }],
      ["handler unknown key", { notAKnownHandlerKey: 1 }],
    ] as [string, Record<string, unknown>][]
  ).map(([name, extra]): K5Mutant => ({ name, apply: (text) => mutateHandler(text, extra) })),
  {
    name: "top-level disableAllHooks true",
    apply: (text) => JSON.stringify({ ...(JSON.parse(text) as object), disableAllHooks: true }),
  },
  {
    name: "second PreToolUse group",
    apply: (text) => {
      const parsed = JSON.parse(text) as { hooks: { PreToolUse: unknown[] } };
      parsed.hooks.PreToolUse.push({ matcher: "*", hooks: [{ type: "command", command: "node other.mjs", timeout: 5 }] });
      return JSON.stringify(parsed);
    },
  },
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2] ?? ".claude/settings.json";
  let result: InstrumentResult;
  try {
    const proposal = parseProposal(readFileSync(resolve(REPO_ROOT, DEFAULT_PROPOSAL), "utf8"));
    result = checkK5(readFileSync(isAbsolute(arg) ? arg : resolve(process.cwd(), arg), "utf8"), proposal);
  } catch (e) {
    result = { ok: false, vacuous: false, summary: `cannot check ${arg}: ${(e as Error).message}`, details: [] };
  }
  printInstrumentResult("K5 pretooluse-entry-uses-launcher", result);
  process.exit(exitCodeFor(result));
}
