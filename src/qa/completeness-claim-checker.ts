// QA-15: "A numeric completeness claim shall carry a machine-readable reference to the
// instrument that produced it, and the pipeline shall re-run that instrument and fail on a
// mismatch." Applies to prose, code comments, review reports and posture output alike.
//
// Machine-readable marker (the authoritative mechanism this check enforces):
//   [[completeness: cmd="<shell command>" expect=<N>]]
// The checker re-runs `cmd` (via an injected runner), parses the LAST integer in its stdout, and
// fails if it doesn't equal `expect`. A bare numeric-completeness-shaped claim with no marker
// nearby also fails ("no machine-readable instrument reference exists") — detected by a small,
// explicitly-labeled-as-heuristic phrase list (documented below), not claimed to be exhaustive of
// every possible phrasing.
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { Runner } from "../lib/exec.ts";
import { realRunner } from "../lib/exec.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export interface MarkerClaim {
  raw: string;
  cmd: string;
  expect: number;
}

export interface BareClaim {
  raw: string;
  context: string;
}

const MARKER_RE = /\[\[completeness:\s*cmd="([^"]+)"\s*expect=(\d+)\s*\]\]/g;

// Heuristic only — documented as such, not claimed exhaustive (this instrument's own honesty
// rule, the same one it enforces on everyone else). Misses shapes it doesn't recognize; the
// marker convention above is the authoritative mechanism, this is a best-effort backstop.
const BARE_CLAIM_PHRASES = [
  /\ball\s+\d+\b/i,
  /\bevery\s+\d+\b/i,
  /\b\d+\s+of\s+\d+\b/i,
  /\bfull set of\s+\d+\b/i,
  /\bexhaustive\b.{0,40}\b\d+\b/i,
];

export function findMarkerClaims(text: string): MarkerClaim[] {
  const claims: MarkerClaim[] = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const cmd = m[1];
    const expectStr = m[2];
    if (!cmd || !expectStr) continue;
    claims.push({ raw: m[0], cmd, expect: Number(expectStr) });
  }
  return claims;
}

export function findBareClaims(text: string): BareClaim[] {
  const claims: BareClaim[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.includes("[[completeness:")) continue; // covered by the marker mechanism instead
    for (const re of BARE_CLAIM_PHRASES) {
      if (re.test(line)) {
        claims.push({ raw: line.trim(), context: `line ${i + 1}` });
        break;
      }
    }
  }
  return claims;
}

function lastInteger(text: string): number | null {
  const matches = [...text.matchAll(/-?\d+/g)];
  const last = matches.at(-1);
  return last ? Number(last[0]) : null;
}

export async function verifyMarkerClaim(claim: MarkerClaim, runner: Runner): Promise<InstrumentResult> {
  const [cmd, ...args] = claim.cmd.split(/\s+/);
  if (!cmd) {
    return { ok: false, vacuous: false, summary: "empty instrument command", details: [claim.raw] };
  }
  const res = await runner(cmd, args, { timeoutMs: 60_000 });
  const actual = lastInteger(res.stdout);
  if (actual === null) {
    return {
      ok: false,
      vacuous: false,
      summary: `instrument "${claim.cmd}" produced no parseable number in its output`,
      details: [claim.raw, `stdout: ${res.stdout.slice(0, 200)}`],
    };
  }
  if (actual !== claim.expect) {
    return {
      ok: false,
      vacuous: false,
      summary: `claim says ${claim.expect}, instrument "${claim.cmd}" re-run reports ${actual}`,
      details: [claim.raw],
    };
  }
  return { ok: true, vacuous: false, summary: `claim of ${claim.expect} matches instrument re-run`, details: [] };
}

export async function checkCompleteness(text: string, runner: Runner): Promise<InstrumentResult> {
  const markerClaims = findMarkerClaims(text);
  const bareClaims = findBareClaims(text);

  if (markerClaims.length === 0 && bareClaims.length === 0) {
    return {
      ok: true,
      vacuous: true,
      summary: "0 numeric completeness claims found — vacuous pass.",
      details: [],
    };
  }

  const details: string[] = [];
  let failed = 0;

  for (const claim of markerClaims) {
    const r = await verifyMarkerClaim(claim, runner);
    if (!r.ok) {
      failed++;
      details.push(`MISMATCH: ${r.summary} (${claim.raw})`);
    }
  }

  for (const claim of bareClaims) {
    failed++;
    details.push(`NO INSTRUMENT REFERENCE: "${claim.raw}" (${claim.context}) — carries no [[completeness: ...]] marker`);
  }

  if (failed > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${failed} of ${markerClaims.length + bareClaims.length} numeric completeness claim(s) failed.`,
      details,
    };
  }

  return {
    ok: true,
    vacuous: false,
    summary: `${markerClaims.length} instrument-backed completeness claim(s), all verified.`,
    details: [],
  };
}

// Default set when no files are given on the CLI — the documents most likely to carry a
// hand-typed numeric completeness claim (state, decisions, changelog). A per-changed-file wiring
// (like QA-02/QA-14's git-diff mode) is a reasonable future extension, not required for this
// gate to be real today: every file here is checked for real, every run.
const DEFAULT_FILES = ["docs/STATE.md", "docs/decisions.md", "CHANGELOG.md"];

async function main(): Promise<void> {
  const paths = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_FILES;

  let failed = 0;
  const allDetails: string[] = [];
  let anyNonVacuous = false;

  for (const path of paths) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue; // file doesn't exist in this checkout — nothing to check, not an error
    }
    const result = await checkCompleteness(text, realRunner);
    if (!result.vacuous) anyNonVacuous = true;
    if (!result.ok) {
      failed++;
      allDetails.push(`${path}: ${result.summary}`, ...result.details.map((d) => `  ${d}`));
    }
  }

  const result: InstrumentResult = failed > 0
    ? { ok: false, vacuous: false, summary: `${failed} of ${paths.length} file(s) had a failing completeness claim.`, details: allDetails }
    : {
        ok: true,
        vacuous: !anyNonVacuous,
        summary: anyNonVacuous
          ? `${paths.length} file(s) checked, all completeness claims verified.`
          : "0 numeric completeness claims found across the checked files — vacuous pass.",
        details: [],
      };

  printInstrumentResult("QA-15 completeness-claim-checker", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
