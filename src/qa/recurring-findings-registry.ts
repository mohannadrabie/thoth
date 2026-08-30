// QA-13 (lighter, human-ratified form — docs/decisions.md 2026-08-30): validates the structural
// contract of docs/qa/recurring-findings-registry.md. This is NOT an automated recurrence
// classifier (that's docs/backlog.md, deferred until real review history exists to learn from) —
// it only keeps the registry itself well-formed, so the documented promote-on-third-story
// convention has something trustworthy to act on.
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export interface RegistryRow {
  class: string;
  firstSeen: string;
  secondSeen: string;
  status: string;
  lineNumber: number;
}

export interface ParsedRegistry {
  rows: RegistryRow[];
  parseErrors: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const PLACEHOLDER_STATUSES = new Set(["", "-", "—", "tbd", "todo"]);

function isValidDateCitation(cell: string): boolean {
  if (!DATE_RE.test(cell.trim())) return false;
  const rest = cell.trim().slice(10).trim();
  return rest.length > 0; // date plus a citation, not a bare date
}

/** Parses the registry's one data table (header: Class | First seen | Second seen | Status). */
export function parseRegistry(markdown: string): ParsedRegistry {
  const lines = markdown.split("\n");
  const rows: RegistryRow[] = [];
  const parseErrors: string[] = [];

  const headerIdx = lines.findIndex((l) =>
    /^\|\s*Class\s*\|\s*First seen\s*\|\s*Second seen\s*\|\s*Status\s*\|/i.test(l),
  );
  if (headerIdx === -1) {
    parseErrors.push("No registry table found (expected header: | Class | First seen | Second seen | Status |)");
    return { rows, parseErrors };
  }

  // headerIdx + 1 is the `|---|---|---|---|` separator; data starts after that.
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim().startsWith("|")) break; // table ended
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) {
      parseErrors.push(`Line ${i + 1}: malformed row, expected 4 columns, found ${cells.length}`);
      continue;
    }
    const [cls, firstSeen, secondSeen, status] = cells as [string, string, string, string];
    rows.push({ class: cls, firstSeen, secondSeen, status, lineNumber: i + 1 });
  }

  return { rows, parseErrors };
}

export function validateRegistry(parsed: ParsedRegistry): InstrumentResult {
  const errors: string[] = [...parsed.parseErrors];

  for (const row of parsed.rows) {
    if (row.class.length === 0) {
      errors.push(`Line ${row.lineNumber}: empty Class`);
    }
    if (!isValidDateCitation(row.firstSeen)) {
      errors.push(`Line ${row.lineNumber}: "First seen" must be YYYY-MM-DD + a citation, got "${row.firstSeen}"`);
    }
    if (!isValidDateCitation(row.secondSeen)) {
      errors.push(`Line ${row.lineNumber}: "Second seen" must be YYYY-MM-DD + a citation, got "${row.secondSeen}"`);
    }
    if (PLACEHOLDER_STATUSES.has(row.status.toLowerCase())) {
      errors.push(
        `Line ${row.lineNumber}: "Status" must be "pending lint" or the enforcing check's name, got "${row.status}"`,
      );
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${errors.length} structural error(s) in the recurring-findings registry.`,
      details: errors,
    };
  }

  if (parsed.rows.length === 0) {
    return {
      ok: true,
      vacuous: true,
      summary: "0 recurring finding classes logged yet — vacuous pass (fresh repo, no review history to recur from).",
      details: [],
    };
  }

  return {
    ok: true,
    vacuous: false,
    summary: `${parsed.rows.length} recurring finding class(es) logged, all structurally valid.`,
    details: [],
  };
}

async function main(): Promise<void> {
  const path = process.argv[2] ?? "docs/qa/recurring-findings-registry.md";
  const markdown = await readFile(path, "utf8");
  const result = validateRegistry(parseRegistry(markdown));
  printInstrumentResult("QA-13 recurring-findings-registry", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
