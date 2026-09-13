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
  // Round-2 fix-now (GitHub issue 150): the default entry above prints a human-readable sentence
  // whose LAST integer is `filesScanned`, not the published marked/unmarked/total figure — so no
  // marker could ever verify that figure through it. These three re-invoke the same probe with
  // `--field=...`, each printing ONLY the one number it names, so a real
  // `[[completeness: cmd="qa14-marker-corpus-probe-<field>" expect=N]]` marker checks it exactly.
  "qa14-marker-corpus-probe-marked": { cmd: "node", args: ["src/qa/marker-corpus-probe.ts", "--field=marked"] },
  "qa14-marker-corpus-probe-unmarked": { cmd: "node", args: ["src/qa/marker-corpus-probe.ts", "--field=unmarked"] },
  "qa14-marker-corpus-probe-total": { cmd: "node", args: ["src/qa/marker-corpus-probe.ts", "--field=total"] },
  // Council fix-now round 4 (2026-09-11, Issue #154, Path A): real, callable, ON-DEMAND-only
  // instrument for the list-continuation residual — see
  // src/qa/continuation-residual-probe.ts's own header for the denominator/numerator split.
  // Deliberately never referenced by a `[[completeness: cmd="..." expect=N]]` marker in any
  // permanently-scanned prose (same whole-tracked-tree-corpus reasoning as the three entries
  // above and DEFAULT_FILES's own docs/decisions.md exclusion below) — registered so a human can
  // run it on demand, callable-but-non-blocking by design, not so a future round can wire a
  // blocking marker to it without re-deriving why that would be wrong a 5th time.
  "qa14-continuation-residual-probe-marked": { cmd: "node", args: ["src/qa/continuation-residual-probe.ts", "--field=continuation-marked"] },
  "qa14-continuation-residual-probe-residual": { cmd: "node", args: ["src/qa/continuation-residual-probe.ts", "--field=continuation-residual"] },
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
//
// GitHub Issue #159 (architecture-reviewer, 2026-09-11, docs/decisions.md's "Path-Forward Brief"
// row for qa14-marker-redesign's Issue #154 class): the "N of M" phrasing above never matched this
// project's own real "N/M" slash shorthand — the exact reason a stale, non-struck "10/400 real
// occurrences, 5 distinct blocking gate failures" claim (CHANGELOG.md) passed QA-15 clean at HEAD
// despite being live-stale, four rounds running. A BLANKET `\d+\/\d+` addition was measured and
// rejected (impact-analyst's council report, `docs/reviews/qa14-marker-redesign-impact-analyst-2026-09-11.md`):
// 112 existing `N/M`-shaped numbers already live in this project's own two scanned files, the
// overwhelming majority legitimate test/coverage-count reporting ("708/708 pass", "17/17",
// "43/45 pass"). The two patterns below are narrower, grounded in what the real defect shapes
// actually were (measured via `grep`, not guessed) — an `N/M` slash pair immediately followed by
// "occurrences", or by "distinct ... failures/leaks" — neither of which appears near any of the
// 112 legitimate hits (re-confirmed by re-running that same grep against this file's own two
// scanned files after adding these patterns, zero new false positives). Narrower than a blanket
// regex is a deliberate trade — CLAUDE.md's own hard rule prefers a real, callable mechanical
// guard over hand-editing prose, but a guard that rubber-stamp-fails legitimate test-count
// reporting is worse than the gap it closes (PRINCIPLES rule 16's "ceremony without a
// corresponding safety gain").
const BARE_CLAIM_PHRASES = [
  /\ball\s+\d+\b/i,
  /\bevery\s+\d+\b/i,
  /\b\d+\s+of\s+\d+\b/i,
  /\bfull set of\s+\d+\b/i,
  /\bexhaustive\b.{0,40}\b\d+\b/i,
  // "10/400 real occurrences", "10/400 occurrences" — a slash-shaped fraction directly describing
  // a count of occurrences, never how this project phrases an equal/near-equal test-pass count.
  /\b\d+\/\d+\b\s+(?:real\s+)?occurrences?\b/i,
  // "10/400, 5 distinct blocking gate failures", "10/400 distinct ... leaks" — a slash-shaped
  // fraction near a "distinct ... failure/leak" phrase, this project's own real wording for a
  // residual/blocking-count claim (see CHANGELOG.md's qa14-marker-redesign entries). Bounded
  // wildcards (not nested repeated groups) keep this simple to read and simple to prove terminates.
  /\b\d+\/\d+\b.{0,20}\bdistinct\b.{0,30}\b(?:failures?|leaks?)\b/i,
  // Human-ruled round-5 fix-now (docs/decisions.md's round-5-hard-stop ruling row; grounded in
  // `docs/reviews/qa14-marker-redesign-red-team-round5-2026-09-11.md` finding 3, which measured 4 of
  // 4 plausible NEXT phrasings missed by the two patterns above — including the two
  // `continuation-marked=273 continuation-residual=3` figures live in CHANGELOG.md/docs/STATE.md at
  // that same round's own HEAD). Anchored to THIS project's actual instrument-output naming
  // convention — `continuation-marked=<N>` / `continuation-residual=<N>`, the exact two field names
  // `src/qa/continuation-residual-probe.ts --field=...` prints — rather than a blanket
  // `identifier=\d+` shape: a generic version was measured against the real corpus and rejected for
  // the same reason impact-analyst's council report rejected a blanket `\d+\/\d+` for Issue #159 —
  // this repo's own two scanned files already carry many unrelated, legitimate `identifier=N` pairs
  // (`marked=380`, `unmarked=416`, `total=796`, `blocking=295`, `p99=186`, `exitCode=1`,
  // `demonstrated=6`, `code-traced=5`, and every `[[completeness: cmd="..." expect=N]]` marker's own
  // `expect=N`) that a blanket pattern would false-positive on. This pattern would have caught round
  // 5's own live recurrence automatically; it does not claim to close the identifier=N class in
  // general, only this story's own recurring shape (same narrow-but-evidence-grounded trade as the
  // two patterns above it).
  /\bcontinuation-(?:marked|residual)=\d+\b/i,
  // GitHub Issue #167 (red-team, qa14-issue137-precision-fastfollow round-2 fix-now, 2026-09-13):
  // every pattern above requires a digit adjacent to the quantifier, so a WORD-FORM exhaustive
  // enumeration claim — "Every remaining one is X (A, B, C)" — is structurally invisible and
  // passes clean even when false. This is not hypothetical: it is exactly how Issue #166's bad
  // claim ("Every remaining one is a real digit-bearing, wrong-length ADR id (`ADR-tooshort`,
  // `ADR-mixedsuffix`, `ADR-noentry`)" — a real digit-bearing example was missing, making the
  // claim false) shipped QA-15-clean in this same story's own first draft. (Issue #168, code-
  // reviewer, round-2 re-confirm: this comment's own first draft quoted the same real
  // digit-bearing strings Issue #166 itself used, verbatim — reintroducing the exact defect
  // being documented; reworded here to the same non-digit placeholder shapes this story
  // already uses elsewhere, e.g. `reference-resolver.ts`'s own header comment.)
  //
  // Narrow, not blanket: requires an exhaustive/completeness word ("every"/"all"/"each") followed
  // by "remaining", then an "is"/"are" verb within a bounded window, then a comma-separated
  // enumeration in parentheses within a further bounded window — the exact structural shape of
  // the demonstrated defect, not every sentence that happens to say "every remaining X". A blanket
  // `/\b(?:every|all|each)\s+remaining\b/i` (red-team's own first-cut suggestion) was measured
  // against this project's real corpus and REJECTED: it false-positives on this file's own
  // legitimate qa1415fix CHANGELOG.md entry ("Every remaining blocking failure read individually:
  // none is caused by this change — ... (R1, out of scope, ...), plus a genuine cross-repo issue
  // (correct, by design), ..."), which names "every remaining X" but is a real, demonstrated,
  // non-enumerated finding, not a hand-typed completeness assertion. Requiring both the verb
  // (is/are) AND a comma-bearing parenthetical enumeration right after it is what tells the two
  // shapes apart (verified: the CHANGELOG.md line above does not match; see the false-positive
  // guard test in completeness-claim-checker.test.ts). Bounded wildcards (`.{0,N}`), not nested
  // repeated word-groups, keep this linear and simple to prove terminates (same discipline as the
  // `distinct failures/leaks` pattern above).
  /\b(?:every|all|each)\s+remaining\b.{0,60}\b(?:is|are)\b.{0,80}\([^()]*,[^()]*\)/i,
];

// Issue #159 (continued): a claim struck through with markdown `~~...~~` is, by this project's own
// documented convention (docs/decisions.md's header: "Supersede in place ... strike through and
// append, never delete or silently edit"), a SUPERSEDED claim, not a live one — the same semantic
// QA-15's own [[completeness: ...]] marker distinguishes for a machine-checked claim. Without this,
// a corrected bare claim (kept, struck through, per that convention — exactly what this round's own
// #154/#159 fix-now round does to the four locations it corrects) would immediately re-trip the
// heuristic that names it, purely because the OLD text is still physically present in the file.
// Stripped before matching, not before reporting — `claim.raw` below still shows the real line.
function stripStrikethrough(line: string): string {
  return line.replace(/~~.*?~~/g, "");
}

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
    const liveLine = stripStrikethrough(line); // Issue #159: a struck claim is superseded, not live
    for (const re of BARE_CLAIM_PHRASES) {
      if (re.test(liveLine)) {
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
