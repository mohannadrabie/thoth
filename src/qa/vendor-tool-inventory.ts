// Instrument: re-vendors docs/qa/tool-inventory.json from the runtime's own `system`/`init` event (Issue #308,
// story C, AP-2). Replaces the hand-captured, web-search-derived list: no tool name is typed by hand anywhere in
// this file or in what it writes.
//
// SOURCE: the init event of `claude -p --output-format stream-json --verbose --max-turns 1`, run from a throwaway
// directory OUTSIDE the repo (so no repo settings or hooks load). Its `tools` array is the runtime's own tool list;
// built-ins are every entry that does not start with `mcp__`. Evidence tier written: `measured` (this install, this
// account, this platform, this permission mode). The list depends on all four (PowerShell is Windows-only; a
// plan-mode run omits two tools), so the file records version, platform and mode next to the names.
//
// MERGE RULE (human ruling 2026-10-02, Q2): `tools` = measured names UNION the previously vendored names, sorted.
// `measuredTools` is exactly the event's built-ins; `carriedForward` is the previous-only remainder (still carrying
// the earlier `derived` evidence, kept so a session that does expose them still resolves to a classification).
//
// NOT part of CI: it spawns the live binary (same offline-in-CI convention as QA-17's runtime-settings inventory).
// CI instead checks the committed output against the committed, scrubbed capture (vendor-tool-inventory.test.ts).
//
// Usage:
//   node src/qa/vendor-tool-inventory.ts                       spawn claude, write the inventory, print the diff
//   node src/qa/vendor-tool-inventory.ts --from <file>         read a saved init event (raw jsonl or scrubbed json)
//   node src/qa/vendor-tool-inventory.ts --save-capture <file> also write the scrubbed capture of the event used
//   node src/qa/vendor-tool-inventory.ts --dry-run             print the diff, write nothing
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface InitEvent {
  type?: unknown;
  subtype?: unknown;
  tools?: unknown;
  claude_code_version?: unknown;
  permissionMode?: unknown;
  platform?: unknown;
  capturedAt?: unknown;
  [key: string]: unknown;
}

export interface VendoredInventory {
  sourceUrl: string;
  capturedAt: string;
  evidenceTier: "measured";
  evidenceNote: string;
  claude_code_version: string;
  platform: string;
  permissionMode: string;
  tools: string[];
  measuredTools: string[];
  carriedForward: string[];
  carriedForwardEvidenceTier: "derived";
}

export interface ScrubbedCapture {
  type: "system";
  subtype: "init";
  capturedAt: string;
  platform: string;
  claude_code_version: string;
  permissionMode: string;
  tools: string[];
}

const MCP_PREFIX = "mcp__";
/** A built-in name written into the committed inventory must be a plain identifier: a letter first, then letters and
 * digits, at most 64 characters. Anything else is refused rather than vendored (names flow into code comments, test
 * names and the generated diff). */
const BUILTIN_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

/** Finds the `system`/`init` event in stream-json lines, or a single JSON object (a scrubbed capture). */
export function extractInitEvent(text: string): InitEvent {
  const isInit = (x: unknown): x is InitEvent => typeof x === "object" && x !== null && (x as InitEvent).type === "system" && (x as InitEvent).subtype === "init";
  try {
    const whole: unknown = JSON.parse(text);
    if (isInit(whole)) return whole;
  } catch {
    // not a single JSON value: fall through to the line scan
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isInit(parsed)) return parsed;
    } catch {
      // a non-JSON line is not the init event
    }
  }
  throw new Error("no system/init event found in the input");
}

/** Built-in names: every non-`mcp__` entry of the event's tools array, de-duplicated and sorted. Throws on a
 * missing/ill-typed array or an empty result, so a broken capture can never produce an empty inventory. */
export function extractBuiltinNames(event: InitEvent): string[] {
  const tools = event.tools;
  if (!Array.isArray(tools) || !tools.every((t) => typeof t === "string")) throw new Error("init event: `tools` must be an array of strings");
  const names = [...new Set((tools).filter((t) => !t.startsWith(MCP_PREFIX)))].sort();
  const odd = names.filter((n) => !BUILTIN_IDENTIFIER.test(n));
  if (odd.length > 0) throw new Error(`init event: built-in name(s) that are not plain identifiers (${BUILTIN_IDENTIFIER.source}): ${odd.map((n) => JSON.stringify(n)).join(", ")}`);
  if (names.length === 0) throw new Error("init event: no built-in (non-mcp__) tool names found");
  return names;
}

function requireString(event: InitEvent, key: string): string {
  const v = event[key];
  if (typeof v !== "string" || v === "") throw new Error(`init event: \`${key}\` must be a non-empty string`);
  return v;
}

export interface MeasureOptions {
  event: InitEvent;
  capturedAt: string;
  platform: string;
}

export function mergeInventory(previous: { tools: readonly string[] }, opts: MeasureOptions): VendoredInventory {
  const measuredTools = extractBuiltinNames(opts.event);
  const measured = new Set(measuredTools);
  const carriedForward = [...new Set(previous.tools)].filter((t) => !measured.has(t)).sort();
  const version = requireString(opts.event, "claude_code_version");
  return {
    sourceUrl: "claude -p --output-format stream-json --verbose (system/init event, tools array)",
    capturedAt: opts.capturedAt,
    evidenceTier: "measured",
    evidenceNote:
      "Generated by src/qa/vendor-tool-inventory.ts from the runtime's own system/init event (evidence tier: measured -- this install, this account, this platform, this permission mode; the list varies with all four, e.g. PowerShell is Windows-only). " +
      "measuredTools is exactly the event's non-mcp__ tools. carriedForward are names vendored earlier (evidence tier derived: a web search of the tools-reference page, 2026-09-06) that this event did not list; they are kept so a session that does expose them still resolves to a classification. " +
      "The scrubbed capture the committed list was derived from is src/qa/fixtures/claude-init-" + version + ".json. Never fetched in CI: re-vendoring is a human-run, reviewed action.",
    claude_code_version: version,
    platform: opts.platform,
    permissionMode: requireString(opts.event, "permissionMode"),
    tools: [...new Set([...measuredTools, ...carriedForward])].sort(),
    measuredTools,
    carriedForward,
    carriedForwardEvidenceTier: "derived",
  };
}

/** The diff the reviewer reads: computed from the two lists, never typed. */
export function renderDiff(previousTools: readonly string[], merged: VendoredInventory): string {
  const prev = new Set(previousTools);
  const fresh = merged.measuredTools.filter((t) => !prev.has(t));
  const both = merged.measuredTools.filter((t) => prev.has(t));
  const line = (label: string, names: readonly string[]): string => `${label} (${String(names.length)}): ${names.join(", ")}`;
  return [
    `Claude Code ${merged.claude_code_version}, ${merged.platform}, permissionMode ${merged.permissionMode}`,
    line("NEW", fresh),
    line("CARRIED FORWARD, absent from the live list", merged.carriedForward),
    line("PRESENT IN BOTH", both),
  ].join("\n");
}

/** Keeps only what the instrument needs. Drops cwd, session and message ids, uuid, apiKeySource, mcp_servers,
 * memory/socket paths, slash commands, agents, skills, plugins, model and every mcp__ tool name. */
export function scrubInitEvent(event: InitEvent, opts: { capturedAt: string; platform: string }): ScrubbedCapture {
  return {
    type: "system",
    subtype: "init",
    capturedAt: opts.capturedAt,
    platform: opts.platform,
    claude_code_version: requireString(event, "claude_code_version"),
    permissionMode: requireString(event, "permissionMode"),
    tools: extractBuiltinNames(event),
  };
}

function captureFromClaude(): string {
  const dir = mkdtempSync(join(tmpdir(), "thoth-vendor-inventory-"));
  try {
    const r = spawnSync("claude", ["-p", "say ok", "--output-format", "stream-json", "--verbose", "--max-turns", "1"], {
      cwd: dir,
      encoding: "utf8",
      shell: process.platform === "win32",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) throw new Error(`claude exited ${String(r.status)}: ${r.stderr}`);
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv: string[]): void {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const here = dirname(fileURLToPath(import.meta.url));
  const inventoryPath = flag("--inventory") ?? join(here, "..", "..", "docs", "qa", "tool-inventory.json");
  const from = flag("--from");
  const event = extractInitEvent(from !== undefined ? readFileSync(from, "utf8") : captureFromClaude());
  const capturedAt = typeof event.capturedAt === "string" ? event.capturedAt : new Date().toISOString().slice(0, 10);
  const platform = typeof event.platform === "string" ? event.platform : process.platform;
  const previous = JSON.parse(readFileSync(inventoryPath, "utf8")) as { tools: string[] };
  const merged = mergeInventory(previous, { event, capturedAt, platform });
  process.stdout.write(`${renderDiff(previous.tools, merged)}\n`);
  const capturePath = flag("--save-capture");
  if (capturePath !== undefined) writeFileSync(capturePath, `${JSON.stringify(scrubInitEvent(event, { capturedAt, platform }), null, 2)}\n`);
  if (!argv.includes("--dry-run")) writeFileSync(inventoryPath, `${JSON.stringify(merged, null, 2)}\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
