// GitHub Issue #150 (MED, cross-domain-reviewer, 2026-09-11 Stage-3 round-1 review of the QA-14
// marker redesign): the plan's/CHANGELOG's load-bearing "~73%, marked=530/unmarked=1399/total=1929"
// figure (docs/plans/qa14-marker-redesign-phase1-2026-09-11.md §5.1) came from an uncommitted
// scratchpad probe — a hand-derived completeness claim (CLAUDE.md hard rule: "no hand-derived
// completeness claims... if no such instrument exists, building one is part of the task"). This
// file IS that instrument: a real, re-runnable, committed replacement.
//
// Measures, over every file this repo's own QA-14 gate would scan (shouldScanFile excludes
// `*.test.ts`, same exclusion QA-14 itself uses), how many bare (non-cross-repo, non-"Issue #N"/
// "Milestone #N"-word-form) `#N` citations classify as MARKED (an explicit citation marker
// precedes them, or they inherit one via list continuation — see reference-resolver.ts's
// `CITATION_MARKER_WORD_RE`/`GH_MARKER_RE`/list-continuation mechanism) vs. UNMARKED (no marker
// in reach — the new, non-blocking `unclassified` bucket). Deliberately reuses the SHIPPED
// `scanReferences` classifier directly — never a second, independently-maintained copy of the
// regex/marker logic — the same "measure via the shipped classifier itself" discipline this
// story's own red-team review used (docs/reviews/qa14-marker-redesign-red-team-2026-09-11.md).
//
// This is an honest, disclosed IMPROVEMENT on the original scratchpad's own methodology, not just
// a recommit of it: the original walked the tree once, at one point in time, with a
// separately-typed copy of the marker regexes (never committed, so nobody could re-run or audit
// it). This script measures the CURRENT repository state, every time it runs, against the actual
// shipped classification function — so the figure it prints can never silently drift out of sync
// with what the checker itself actually does.
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { makeGitOps } from "../lib/git.ts";
import { realRunner } from "../lib/exec.ts";
import type { Citation, ReferenceResolverDeps } from "./reference-resolver.ts";
import { scanReferences, shouldScanFile } from "./reference-resolver.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { printInstrumentResult } from "../lib/instrument.ts";
import { warnIfUntrackedScannable } from "./untracked-scan-warning.ts";

// GitHub Issue #164 fix (mirrors the already-shipped Issue #161 fix on this file's own twin
// instrument, continuation-residual-probe.ts — same root cause, same closure): this file used to
// accept an optional positional `ref` argument that only ever changed the FILE LIST (via
// `resolveChangedFiles`), never the CONTENT (always read from the working tree via `readFile`) —
// a demonstrated ref/content-mismatch bug (red-team round-5/round-6 reports on
// qa14-marker-redesign: `node src/qa/marker-corpus-probe.ts a26e55a` reported a count for a26e55a's
// file list against HEAD's working-tree content, a tree state that never existed). No real caller
// anywhere in this repo (production code, `.github/workflows/ci.yml`, `package.json` scripts,
// `completeness-claim-checker.ts`'s `KNOWN_INSTRUMENTS`, or this file's own test suite) ever passed
// a non-default ref — confirmed by grep. The parameter is deleted: `main()` no longer accepts a ref
// at all (Issue #173, below, makes passing one a fail-loud error rather than a silent no-op).
//
// GitHub Issue #172 fix-now (red-team round-1 of the #164 close-out, attack 1 — filed against the
// comment this replaces): deleting the `ref` parameter closed the MACHINE-VISIBLE half of the bug
// but not the whole thing — `main()` still resolved the file LIST via `resolveChangedFiles(...,
// "HEAD")` (a `git ls-tree HEAD` read) while CONTENT was always read from the working tree, so an
// untracked, uncommitted, scannable new file was silently invisible to the count (demonstrated:
// baseline total=989; add an untracked file with 3 bare `#N` citations, total stays 989; add the
// SAME 3 citations to a TRACKED file instead, total becomes 992). List and content are now BOTH
// drawn from the same tree state — the real, live working tree — via `git.lsFilesWorkingTree()`
// (`git ls-files --cached --others --exclude-standard`, src/lib/git.ts), not a ref-pinned
// `ls-tree` read. This is the accurate version of what the paragraph above used to (incorrectly)
// claim was already true.

// A MARKED bare `#N` reaches real classification (`classifyIssue` -> `verifyLocalIssue` ->
// `issueExists`), same as QA-14's own collector pass does — this probe only cares which bucket
// (`kind: "issue"` vs. `kind: "issue-candidate"`) a citation lands in, never the real/fake
// existence verdict, so `null` ("cannot verify") is deliberately returned unconditionally: no
// real `gh` call, no network, no credential, and the resulting `verdict` is never read by
// `computeMarkerCorpusStats` below.
const stubDeps: ReferenceResolverDeps = {
  pathExists: () => true,
  lineCount: () => null,
  knownAdrIds: new Set(),
  issueExists: () => null,
  repoSlug: null,
  // Issue #137, R1: this probe's own stats are computed purely off bare-hash issue citations — a
  // path citation's basename-fallback resolution is never read by anything this file measures.
  findByBasename: () => [],
};

// GitHub Issue #150 round-2 fix-now: registered in `completeness-claim-checker.ts`'s
// `KNOWN_INSTRUMENTS` since round 1, but with no `[[completeness: cmd=...]]` marker anywhere
// referencing it — the published marked/unmarked/total figure was real (a committed, re-runnable
// instrument) but structurally unverifiable through this project's only completeness-claim
// mechanism (`verifyMarkerClaim` compares `expect=N` against the LAST integer in stdout, which for
// the default human-readable summary is `filesScanned`, not any of the three published numbers).
// `--field=marked|unmarked|total` makes this instrument single-number-per-invocation, matching
// this project's own `[[completeness: cmd="<name>" expect=N]]` convention (one symbolic
// KNOWN_INSTRUMENTS name per checkable number, e.g. `qa-mutation-shell`'s `expect=53`) — each
// field prints ONLY that number, so it is unambiguously the last (and only) integer in stdout.
export type MarkerCorpusField = "marked" | "unmarked" | "total";

/** Pure — parses `--field=marked|unmarked|total` out of a CLI argv slice. Throws on an unknown
 * field value (fails loud, not silently ignored); returns `null` when no `--field` flag is
 * present (the default, full human-readable summary mode). */
export function parseMarkerCorpusField(args: string[]): MarkerCorpusField | null {
  const flag = args.find((a) => a.startsWith("--field="));
  if (!flag) return null;
  const value = flag.slice("--field=".length);
  if (value === "marked" || value === "unmarked" || value === "total") return value;
  throw new Error(`--field must be one of marked|unmarked|total, got "${value}"`);
}

/**
 * GitHub Issue #173 fix-now (red-team round-1 of the #164 close-out, attack 2): a stray positional
 * argument (a leftover `ref`, `not-a-ref-at-all`, `HEAD~5`, ...) or an unknown flag (`--bogus-flag`)
 * used to be silently swallowed — the probe still printed a working-tree answer, exit 0, no
 * warning — contradicting this file's own documented fail-loud convention
 * (`parseMarkerCorpusField` above already throws on a bad `--field` VALUE). This closes the same
 * gap for a bad argv SHAPE: any token that isn't itself a `--field=...` flag is now a hard error,
 * before anything else runs. Pure — throws, never exits/logs itself, so it stays trivially unit
 * testable.
 */
export function assertKnownArgs(args: string[]): void {
  const unknown = args.filter((a) => !a.startsWith("--field="));
  if (unknown.length > 0) {
    throw new Error(
      `unrecognized argument(s): ${unknown.map((a) => JSON.stringify(a)).join(", ")} — this probe only accepts ` +
        `--field=marked|unmarked|total (no positional ref — deleted, Issue #164 — and no other flag)`,
    );
  }
}

export interface MarkerCorpusStats {
  /** Bare #N matches that reached real classification (an explicit marker, or list-continuation). */
  marked: number;
  /** Bare #N matches with no marker in reach — the `unclassified` bucket. */
  unmarked: number;
  total: number;
  filesScanned: number;
}

/**
 * Pure — counts bare (non-cross-repo) `#N` citations by marked/unmarked status across the given
 * file texts, using the real shipped `scanReferences` classifier. `kind === "issue"` combined with
 * a bare `#N`-shaped raw string identifies a MARKED bare match (the cross-repo `owner/repo#N` and
 * word-form `Issue #N`/`Milestone #N` shapes are their own separate populations, deliberately
 * excluded here — the original scratchpad's own methodology measured the bare-`#N` population
 * only, per the plan's §5.1 text: "classify each bare (non-cross-repo) match").
 */
export function computeMarkerCorpusStats(fileTexts: Map<string, string>): MarkerCorpusStats {
  let marked = 0;
  let unmarked = 0;
  for (const text of fileTexts.values()) {
    const citations: Citation[] = scanReferences(text, stubDeps);
    for (const c of citations) {
      if (c.kind === "issue-candidate") {
        unmarked++;
      } else if (c.kind === "issue" && /^#\d+$/.test(c.raw)) {
        marked++;
      }
    }
  }
  return { marked, unmarked, total: marked + unmarked, filesScanned: fileTexts.size };
}

/**
 * Reads each listed (repo-relative or absolute) file's text, skipping (not erroring on) a path
 * that no longer exists by the time it's read — ENOENT, e.g. deleted between listing and reading —
 * while letting any OTHER read failure propagate loud rather than be silently absorbed into a
 * wrong count.
 *
 * GitHub Issue #177 fix-now: the #170 ENOENT-narrowing below was pinned by zero tests — a
 * full-suite mutation reverting it to a blanket `catch { continue; }` left the suite byte-
 * identical (red-team round-2 report, attack 2). `readFileImpl` is the dependency-injection seam
 * that makes the narrowing provable: a test can force a non-ENOENT error deterministically (no
 * real filesystem race, no timing dependency) and assert it propagates instead of being swallowed.
 * Defaults to the real `fs/promises` `readFile` for every real caller.
 */
export async function readFileTexts(
  files: string[],
  readFileImpl: (path: string, encoding: "utf8") => Promise<string> = readFile,
): Promise<Map<string, string>> {
  const fileTexts = new Map<string, string>();
  for (const file of files) {
    if (!shouldScanFile(file)) continue;
    try {
      fileTexts.set(file, await readFileImpl(file, "utf8"));
    } catch (err) {
      // GitHub Issue #170 fix-now (cross-domain review, demonstrated ~17% flake under real `npm
      // test` concurrency): this used to be a blanket `catch { continue; }`, silently treating ANY
      // read failure — including a transient I/O error under load — as "file gone", which could
      // silently undercount. ENOENT is the one genuinely legitimate skip (the path was listed but
      // no longer exists — e.g. deleted between listing and reading, or a git-index entry for a
      // file removed from disk); anything else is a real failure and must propagate loud, not get
      // silently absorbed into a wrong count (same "don't swallow into a silent pass" discipline as
      // src/lib/git.ts's own Issue #18 comment, `resolveChangedFiles` above it).
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return fileTexts;
}

/**
 * GitHub Issue #172 fix (see the header comment for the full repro/rationale): the file LIST now
 * comes from `git.lsFilesWorkingTree()` — tracked + untracked-but-not-ignored paths in the CURRENT
 * working tree — the same tree state CONTENT is read from below, never a `ls-tree`-at-a-ref
 * snapshot. This is a deliberate, new divergence from `continuation-residual-probe.ts`'s own
 * `collectFullTreeFileTexts` — checked directly, structurally identical to this function's own
 * pre-fix shape (its list still comes from `resolveChangedFiles(..., "HEAD")`, unchanged by this
 * fix). That file carries the identical list/content-tree-state mismatch this fix closes here; it
 * is a live, separate defect, flagged as its own follow-up rather than silently fixed alongside a
 * differently-scoped Issue — one enumeration mechanism per file, not a second copy of either's
 * marker/list-continuation regex logic.
 *
 * GitHub Issue #176 fix-now: exported (was module-private) so a test can call it directly,
 * in-process, against an isolated `mkdtemp` git repo fixture — never a live CLI subprocess spawned
 * against this repo's own real working tree (the shape red-team round-2 demonstrated failing 6/6
 * under two concurrent `node --test` processes on one checkout). `lsFilesWorkingTree()` returns
 * paths relative to `repoRoot`, not necessarily `process.cwd()` — every REAL caller (`main()`
 * below) happens to pass `process.cwd()` as `repoRoot`, so this was never previously observable,
 * but a test fixture (or any future caller) passing a different directory needs each path resolved
 * against `repoRoot` before reading, not left to resolve implicitly against the process's own cwd.
 */
export async function collectFullTreeFileTexts(repoRoot: string): Promise<Map<string, string>> {
  const git = makeGitOps(realRunner, repoRoot);
  const workingTreeFiles = await git.lsFilesWorkingTree();
  // GitHub Issue #182 (disclosed residual, not fixed — s1-closeout-164-154 council Path A,
  // 2026-09-13): `lsFilesWorkingTree()` includes untracked-but-not-ignored paths, so the published
  // total can include transient untracked scratch files in the working tree and drift
  // session-to-session (measured live: 1087 -> 1106 -> 1110 in one review session). Disclosed, not
  // fixed — see docs/decisions.md's corresponding row for the ruling.
  return readFileTexts(workingTreeFiles.map((f) => resolve(repoRoot, f)));
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const argv = process.argv.slice(2);
  assertKnownArgs(argv);
  const field = parseMarkerCorpusField(argv);

  const fileTexts = await collectFullTreeFileTexts(repoRoot);
  // Issue #182: disclose untracked files inside the count on stderr; the number and stdout are unchanged.
  await warnIfUntrackedScannable(realRunner, repoRoot, (message) => console.error(message));

  const stats = computeMarkerCorpusStats(fileTexts);
  const pct = stats.total > 0 ? Math.round((stats.unmarked / stats.total) * 100) : 0;
  // `--field` mode (Issue #150 round-2 fix-now): stdout is ONLY `<field>=<N>` — the single number
  // a `[[completeness: cmd="qa14-marker-corpus-probe-<field>" expect=N]]` marker checks, with
  // nothing else in the output stream that could be mistaken for it.
  const result: InstrumentResult = field
    ? { ok: true, vacuous: stats.total === 0, summary: `${field}=${stats[field]}`, details: [] }
    : {
        ok: true,
        vacuous: stats.total === 0,
        summary:
          stats.total === 0
            ? "0 bare #N citations found in the scanned tree — vacuous."
            // Round-3 fix-now (Issue #156-adjacent LOW, red-team round-3 finding 5): this counts
            // DISTINCT (file, raw-citation) pairs (scanReferences dedupes per file), not raw text
            // occurrences of a bare #N shape — the label previously said "occurrences", which is a
            // different, larger quantity (measured full-tree: raw occurrences run materially higher
            // than this distinct-pair total). "Distinct per-file citations" is also the more useful
            // metric for this instrument's actual purpose: it mirrors what the shipped QA-14
            // classifier itself treats as one citation event, not a text-search hit count.
            : `marked=${stats.marked} unmarked=${stats.unmarked} total=${stats.total} — approx ${pct}% of this repo's distinct per-file bare #N citations (${stats.filesScanned} files scanned) carry no explicit citation marker.`,
        details: [],
      };
  printInstrumentResult("QA-14 marker-corpus-probe", result);
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
