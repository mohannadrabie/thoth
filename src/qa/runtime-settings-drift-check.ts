// QA-17: "The vendored inventory of Claude Code's documented runtime-configurable settings keys
// (docs/qa/runtime-settings-inventory.json) shall be re-diffed on a schedule against
// REQUIREMENTS.md §1.4's live table, and drift — a key the vendored snapshot no longer sees
// documented there, or a key §1.4 now documents that the vendored snapshot doesn't know about —
// shall fail the check, not silently pass."
//
// This instrument is deliberately OFFLINE: it never fetches the real
// https://code.claude.com/docs/en/admin-setup page. It has no `fetch`/`http(s)` import anywhere in
// this file (proven by this file's own self-test, see the .test.ts alongside it) — the vendored
// JSON fixture is a human-captured snapshot of what that page said last time someone read it, and
// this instrument's only real job is to catch THIS repository's own §1.4 table drifting out of
// sync with that snapshot. It is a proxy for "did the runtime's documented settings surface move
// and nobody updated REQUIREMENTS.md", not a live scrape — re-vendoring the fixture from the real
// page is a human action, done on a cadence, never something this script performs for itself.
//
// Two rows of §1.4's table never carry a literal settings key in their "Setting keys" column, by
// the table's own design (REQUIREMENTS.md §1.4, rebuilt 2026-09-01) — not a gap this instrument
// should report as drift:
//   - the hooks row (REQUIREMENTS.md:227): the cell is empty; the primitives named there are hook
//     *events* (`PreToolUse`, `UserPromptSubmit`, ...), not `settings.json` keys.
//   - the managed-policy-delivery row (REQUIREMENTS.md:225): the cell names delivery
//     channels/paths (a macOS plist bundle id, a Windows registry path, a file name), never a
//     literal settings key.
// Both are excluded from key-extraction by construction — a fixed, code-owned list below — never
// by a runtime flag an invocation could pass to soften the check (QA-16's own standard applied
// here: an exception must be a reviewed code change, not a knob).
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export interface VendoredInventory {
  sourceUrl: string;
  capturedAt: string;
  settingsKeys: string[];
}

// §1.4's own heading, and the next heading that bounds the section — parsing is heading-bounded,
// never a hardcoded line-number slice, so a future edit that shifts §1.4 up or down the document
// (without changing its content) doesn't silently break this check.
const SECTION_HEADING_RE = /^###\s+1\.4\b/;
const NEXT_HEADING_RE = /^#{2,3}\s+/;

// A "looks like a real settings key" shape: dotted, camelCase/alphanumeric segments only. This
// excludes non-key backtick spans that share the table's markup (a file name like
// `managed-mcp.json`, a registry path, a plist bundle id) without needing a per-string
// allowlist — anything hyphenated, slashed, or extension-bearing simply isn't key-shaped.
const SETTING_KEY_SHAPE_RE = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/;

// Fixed, code-owned exception list (QA-15's `KNOWN_INSTRUMENTS` pattern) — the two §1.4 rows whose
// "Setting keys" column is never a source of literal keys. Matched against the table's own
// "Primitive" column text, exactly as REQUIREMENTS.md §1.4 writes it. Growing this list is a
// reviewed code change; nothing in this file lets a caller extend it at runtime.
export const EXCEPTED_PRIMITIVE_ROWS: ReadonlySet<string> = new Set<string>([
  "`PreToolUse`, `UserPromptSubmit`, `SessionStart`, `SubagentStop` hooks",
  "Managed policy delivery",
]);

function extractSection14Lines(requirementsMdText: string): string[] {
  const lines = requirementsMdText.split("\n");
  const start = lines.findIndex((l) => SECTION_HEADING_RE.test(l));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => NEXT_HEADING_RE.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

function parseTableRows(sectionLines: string[]): string[][] {
  const rows: string[][] = [];
  for (const rawLine of sectionLines) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-{2,}/.test(line)) continue; // markdown header-separator row, e.g. |---|---|
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    if (cells[0] === "Primitive") continue; // header row itself
    rows.push(cells);
  }
  return rows;
}

/**
 * Parses REQUIREMENTS.md's §1.4 table ("What to configure on the runtime") into the set of
 * documented setting keys, applying the two named row-level exceptions above by construction.
 * Pure — no I/O, heading-bounded, exact-string-match only (no substring matching: a key is either
 * exactly one of the backtick-quoted, key-shaped spans in a non-excepted row's "Setting keys"
 * column, or it isn't counted at all).
 */
export function parseDocumentedKeys(requirementsMdText: string): Set<string> {
  const rows = parseTableRows(extractSection14Lines(requirementsMdText));
  const keys = new Set<string>();
  for (const row of rows) {
    const primitive = row[0] ?? "";
    if (EXCEPTED_PRIMITIVE_ROWS.has(primitive)) continue;
    const settingKeysCell = row[1] ?? "";
    for (const m of settingKeysCell.matchAll(/`([^`]+)`/g)) {
      const span = m[1] ?? "";
      if (SETTING_KEY_SHAPE_RE.test(span)) keys.add(span);
    }
  }
  return keys;
}

/**
 * Exact-string-match, case-sensitive diff between the vendored snapshot and what §1.4 documents
 * right now. `exceptions` is a generic escape hatch (kept separate from the two structural,
 * row-level exceptions baked into `parseDocumentedKeys` above, which a caller cannot widen) for a
 * key explicitly and individually exempted by name; `main()` below passes an empty set — nothing
 * is exempted this way today. Returns one drift line per unaccounted key; an empty array means no
 * drift.
 */
export function computeDrift(
  vendoredKeys: ReadonlySet<string>,
  documentedKeys: ReadonlySet<string>,
  exceptions: ReadonlySet<string>,
): string[] {
  const drift: string[] = [];
  for (const key of vendoredKeys) {
    if (exceptions.has(key)) continue;
    if (!documentedKeys.has(key)) {
      drift.push(`REMOVED: "${key}" is in the vendored inventory but §1.4 no longer documents it`);
    }
  }
  for (const key of documentedKeys) {
    if (exceptions.has(key)) continue;
    if (!vendoredKeys.has(key)) {
      drift.push(`ADDED: "${key}" is documented in §1.4 but is not in the vendored inventory`);
    }
  }
  return drift;
}

async function main(): Promise<void> {
  const inventoryPath = process.argv[2] ?? "docs/qa/runtime-settings-inventory.json";
  const requirementsPath = process.argv[3] ?? "REQUIREMENTS.md";

  const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as VendoredInventory;
  const requirementsMdText = await readFile(requirementsPath, "utf8");

  const vendoredKeys = new Set(inventory.settingsKeys);
  const documentedKeys = parseDocumentedKeys(requirementsMdText);
  const drift = computeDrift(vendoredKeys, documentedKeys, new Set());

  const result: InstrumentResult = drift.length > 0
    ? {
        ok: false,
        vacuous: false,
        summary: `${drift.length} runtime-settings key(s) drifted between the vendored inventory (captured ${inventory.capturedAt}) and REQUIREMENTS.md §1.4.`,
        details: drift,
      }
    : {
        ok: true,
        vacuous: false,
        summary: `${vendoredKeys.size} vendored runtime-settings key(s) all still match REQUIREMENTS.md §1.4 (vendored ${inventory.capturedAt}).`,
        details: [],
      };

  printInstrumentResult("QA-17 runtime-settings-drift-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
