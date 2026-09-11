// QA-15: "A numeric completeness claim shall carry a machine-readable reference to the
// instrument that produced it, and the pipeline shall re-run that instrument and fail on a
// mismatch." Applies to prose, code comments, review reports and posture output alike.
//
// Machine-readable marker (the authoritative mechanism this check enforces):
//   [[completeness: cmd="<known instrument name>" expect=<N>]]
// `cmd=` is a SYMBOLIC NAME, resolved only against the fixed, code-owned `KNOWN_INSTRUMENTS`
// allowlist below — never executed as raw text. This is a deliberate security boundary: this
// marker is parsed out of `docs/STATE.md`/`docs/decisions.md`/`CHANGELOG.md` prose, which a PR
// author (including a fork/untrusted contributor) can edit, and this checker is wired
// unconditionally into `.github/workflows/ci.yml`'s QA-15 step on every push/PR. Executing
// attacker-controlled `cmd=` text directly (the original, now-fixed shape of this checker) was a
// demonstrated arbitrary-command-execution gadget — see
// `docs/reviews/s1-protect-baseline-app-security-2026-08-30.md`, finding 1. A `cmd=` name not on
// the allowlist fails closed (reported, never run) rather than being silently skipped or executed.
// The checker re-runs the allowlisted instrument (via an injected runner), parses the LAST
// integer in its stdout, and fails if it doesn't equal `expect`. A bare numeric-completeness-
// shaped claim with no marker nearby also fails ("no machine-readable instrument reference
// exists") — detected by a small, explicitly-labeled-as-heuristic phrase list (documented below),
// not claimed to be exhaustive of every possible phrasing.
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

export interface KnownInstrument {
  cmd: string;
  args: string[];
}

// Fixed, code-owned allowlist of instrument invocations a `[[completeness: cmd="..." ...]]`
// marker may reference, by symbolic name only. Adding a new name here is a reviewed code change,
// not something prose in docs/STATE.md/decisions.md/CHANGELOG.md can ever add for itself — that
// asymmetry (prose picks a name; code owns what the name runs) is the whole fix. Every entry maps
// to one of this repo's own real QA/instrument scripts or their package.json aliases, never a
// shell string built from marker text.
export const KNOWN_INSTRUMENTS: Readonly<Record<string, KnownInstrument>> = Object.freeze({
  "qa-fixture-coverage": { cmd: "node", args: ["src/qa/fixture-coverage-check.ts"] },
  "qa-diff-fixture": { cmd: "node", args: ["src/qa/diff-fixture-check.ts"] },
  "qa-fixture-isolation": { cmd: "node", args: ["src/qa/fixture-isolation-check.ts"] },
  "qa-recurring-findings": { cmd: "node", args: ["src/qa/recurring-findings-registry.ts"] },
  "qa-reference-resolver": { cmd: "node", args: ["src/qa/reference-resolver.ts"] },
  "qa14-marker-corpus-probe": { cmd: "node", args: ["src/qa/marker-corpus-probe.ts"] },
  "adr-cache-ensure": { cmd: "node", args: ["docs/adr-cache.mjs", "--ensure"] },
  "oss-history-scan": { cmd: "node", args: ["src/secret-scan/history-scan.ts"] },
  "qa-mutation-shell": { cmd: "node", args: ["src/qa/shell-detector-mutants.ts"] },
});

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
  const instrument = KNOWN_INSTRUMENTS[claim.cmd];
  if (!instrument) {
    return {
      ok: false,
      vacuous: false,
      summary: `instrument name "${claim.cmd}" is not on the fixed completeness-instrument allowlist — never executed`,
      details: [claim.raw, `known names: ${Object.keys(KNOWN_INSTRUMENTS).join(", ")}`],
    };
  }
  const res = await runner(instrument.cmd, instrument.args, { timeoutMs: 60_000 });
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
// hand-typed numeric completeness claim (state, changelog). A per-changed-file wiring (like
// QA-02/QA-14's git-diff mode) is a reasonable future extension, not required for this gate to be
// real today: every file here is checked for real, every run.
//
// `docs/decisions.md` deliberately excluded (Issue #120, human-ratified 2026-09-10): it is an
// append-only historical log (its own header: "Supersede in place ... keep the history, never
// delete it" — a later ruling strikes through and appends, it never edits an old row's numbers in
// place). Its rows narrate counts that *already happened* at decision time (e.g. "44 blocking
// matches", "664/664 pass") — a completed historical fact, not a live, re-checkable claim about
// this repo's CURRENT state the way STATE.md's "Resume point" and CHANGELOG.md's "Fixed" entries
// are. Retrofitting `[[completeness: ...]]` markers onto its existing rows would require editing
// rows this project's own convention says are permanently closed once written, and is structurally
// impossible for many of them regardless: several cite a number from a point-in-time measurement
// (a review's own re-run, a since-rotated/reworded diff) that no instrument in this repo can
// re-produce today. QA-15's marker/heuristic mechanism itself is unchanged; only this file's
// membership in the default-scanned set narrows.
// Exported (Issue #142 fix) so a regression test can pin its exact membership — a hand-typed
// prose claim about what this array contains is exactly the kind of unverified completeness
// assertion this same instrument exists to catch; the array itself needs the same discipline.
export const DEFAULT_FILES = ["docs/STATE.md", "CHANGELOG.md"];

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
