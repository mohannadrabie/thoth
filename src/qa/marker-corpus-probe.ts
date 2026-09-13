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
import { makeGitOps, resolveChangedFiles } from "../lib/git.ts";
import { realRunner } from "../lib/exec.ts";
import type { Citation, ReferenceResolverDeps } from "./reference-resolver.ts";
import { scanReferences, shouldScanFile } from "./reference-resolver.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { printInstrumentResult } from "../lib/instrument.ts";

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

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const argv = process.argv.slice(2);
  const field = parseMarkerCorpusField(argv);
  const ref = argv.find((a) => !a.startsWith("--")) ?? "HEAD";

  const git = makeGitOps(realRunner, repoRoot);
  // Reuses QA-14's own full-tree enumeration path (the zero-SHA-sentinel fallback in
  // resolveChangedFiles, driven here directly rather than via a real diff) so this probe scans
  // EXACTLY the file set QA-14 itself would scan in a full-tree run — one enumeration mechanism,
  // not a second copy of it.
  const resolved = await resolveChangedFiles(git, "0000000000000000000000000000000000000000", ref);
  const trackedFiles = resolved?.changedFiles ?? [];

  const fileTexts = new Map<string, string>();
  for (const file of trackedFiles) {
    if (!shouldScanFile(file)) continue;
    try {
      fileTexts.set(file, await readFile(file, "utf8"));
    } catch {
      continue; // binary/unreadable/deleted-since-ref — skip, not an error
    }
  }

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
