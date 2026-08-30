// QA-16: "An instrument known to produce wrong results shall be treated as an incident, not a
// known issue, and shall fail the build until fixed or explicitly disabled with a recorded
// decision." A broken instrument is worse than no instrument — it converts a mechanical check
// back into a human one while still reporting green.
//
// Mechanism: docs/qa/broken-instruments.json registers a broken instrument by id. Every
// registered id MUST have a matching, well-formed disable row in docs/decisions.md, marked with
// the literal text `BROKEN-INSTRUMENT-DISABLE: <id>` in its Decision cell, a valid `YYYY-MM-DD`
// Date cell, and `Human ratified` = `Y`. Missing or malformed -> FAIL. This is deliberately
// stricter than "a decision exists somewhere" — a decision that doesn't parse is treated the same
// as no decision at all (QA-16's own rule, applied reflexively).
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export interface BrokenInstrument {
  id: string;
  instrument: string;
  brokenSince: string;
  reason: string;
}

export interface DecisionRow {
  date: string;
  decision: string;
  humanRatified: string;
  lineNumber: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseBrokenInstrumentsRegistry(json: string): BrokenInstrument[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("broken-instruments.json must be a JSON array");
  }
  return parsed.filter(
    (x): x is BrokenInstrument =>
      typeof x === "object" &&
      x !== null &&
      typeof (x as Record<string, unknown>).id === "string" &&
      typeof (x as Record<string, unknown>).brokenSince === "string",
  );
}

/** Parses docs/decisions.md's decision table into rows. Pure, no I/O. */
export function parseDecisionRows(markdown: string): DecisionRow[] {
  const lines = markdown.split("\n");
  const headerIdx = lines.findIndex((l) => /^\|\s*Date\s*\|\s*Decision/i.test(l));
  if (headerIdx === -1) return [];

  const rows: DecisionRow[] = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim().startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    const [date, decision, , , humanRatified] = cells as [string, string, string, string, string];
    rows.push({ date, decision, humanRatified, lineNumber: i + 1 });
  }
  return rows;
}

export interface DisableCheck {
  id: string;
  found: boolean;
  valid: boolean;
  reason: string;
}

export function checkDisableDecision(id: string, rows: DecisionRow[]): DisableCheck {
  const marker = `BROKEN-INSTRUMENT-DISABLE: ${id}`;
  const row = rows.find((r) => r.decision.includes(marker));
  if (!row) {
    return { id, found: false, valid: false, reason: `no docs/decisions.md row contains "${marker}"` };
  }
  if (!DATE_RE.test(row.date)) {
    return { id, found: true, valid: false, reason: `row at line ${row.lineNumber} has a malformed Date ("${row.date}")` };
  }
  if (row.humanRatified.toUpperCase() !== "Y") {
    return { id, found: true, valid: false, reason: `row at line ${row.lineNumber} is not human-ratified (Human ratified="${row.humanRatified}")` };
  }
  return { id, found: true, valid: true, reason: `disabled by dated, human-ratified decision at line ${row.lineNumber}` };
}

export function checkBrokenInstruments(
  registry: BrokenInstrument[],
  decisionRows: DecisionRow[],
): InstrumentResult {
  if (registry.length === 0) {
    return {
      ok: true,
      vacuous: true,
      summary: "0 known-broken instruments registered — vacuous pass.",
      details: [],
    };
  }

  const failures: string[] = [];
  for (const instrument of registry) {
    const check = checkDisableDecision(instrument.id, decisionRows);
    if (!check.valid) {
      failures.push(`${instrument.id} (${instrument.instrument}, broken since ${instrument.brokenSince}): ${check.reason}`);
    }
  }

  if (failures.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${failures.length} of ${registry.length} known-broken instrument(s) lack a valid disable decision — treated as an incident.`,
      details: failures,
    };
  }

  return {
    ok: true,
    vacuous: false,
    summary: `${registry.length} known-broken instrument(s), each with a valid, dated, human-ratified disable decision.`,
    details: [],
  };
}

async function main(): Promise<void> {
  const registryPath = process.argv[2] ?? "docs/qa/broken-instruments.json";
  const decisionsPath = process.argv[3] ?? "docs/decisions.md";

  const registry = parseBrokenInstrumentsRegistry(await readFile(registryPath, "utf8"));
  const decisionRows = parseDecisionRows(await readFile(decisionsPath, "utf8"));

  const result = checkBrokenInstruments(registry, decisionRows);
  printInstrumentResult("QA-16 broken-instrument-gate", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
