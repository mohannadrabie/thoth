// GitHub Issue #154 / council Path A (docs/decisions.md, 2026-09-11 "Path-Forward Brief —
// qa14-marker-redesign Issue #154 numeric-claim-drift class" row; design-challenger's O2 finding,
// architecture-reviewer's Path-A design sketch, impact-analyst's Candidate-A pricing — all three
// council seats converged independently on this file's shape).
//
// This is the real, committed, re-runnable instrument for the comma/whitespace list-continuation
// residual, replacing every hand-built, uncommitted, byte-diffed fork of reference-resolver.ts
// that rounds 2/3/4 each rebuilt from scratch just to measure this number (design-challenger's O2
// finding — 3 of 3 measurement attempts to date rebuilt bespoke instrumentation, none reusable by
// the next round).
//
// Two numbers, computed by two DIFFERENT mechanisms, deliberately not blended into one:
//
//  - `continuation-marked` (the denominator): how many bare-hash citations across the scanned
//    tree were marked via LIST CONTINUATION rather than an explicit same-line marker
//    (`Citation.markedVia === "continuation"`, added this round — see reference-resolver.ts's
//    `Citation.markedVia` doc comment). Pure, sync, no `gh` call — mirrors marker-corpus-probe.ts's
//    Issue #150 pattern exactly (a stub `issueExists` that never resolves real existence, since
//    only the CLASSIFICATION mechanism matters here, not the real-existence verdict).
//
//  - `continuation-residual` (the numerator): of that continuation-marked population, how many
//    fail REAL existence — a genuine blocking leak, not just a classification artifact. This
//    cannot reuse the denominator's stub; it needs a real `gh`-backed check. Deliberately REUSES
//    reference-resolver.ts's own `resolveIssueCitations` (its existing `QA14_MAX_ISSUES`
//    rate-limit cap and `gh` call dedup) rather than a second, bespoke `gh`-calling path — both
//    design-challenger and impact-analyst independently flagged a duplicate `gh` path as the wrong
//    move (it would bypass the existing cap, the exact anti-pattern the original round-2 fix-now
//    closed for the main gate).
//
// DISCLOSED SCOPE-BOUNDARY NOTE (impact-analyst, council report, Candidate-A pricing — logged here
// per both council seats' explicit request, not silently crossed): the original Phase 1 plan
// (docs/plans/qa14-marker-redesign-phase1-2026-09-11.md) declared `resolveIssueCitations`'s
// two-pass wiring "structurally untouched" as a hard scope boundary for that story. This file does
// NOT modify that function — its signature, its cap, its dedup cache, and its call sites in
// reference-resolver.ts's own `main()` are all byte-identical after this change — it is a new,
// read-only CONSUMER of its already-exported, already-capped, already-tested behavior. But
// importing and invoking it from a second instrument is still a widening of who depends on that
// surface, which is exactly the disclosure both council seats asked for rather than a silent
// scope-cross.
//
// Deliberately NOT wired to a `[[completeness: cmd="..." expect=N]]` blocking marker (Issue #150's
// own round-3 lesson, re-applied here before it could recur a 5th time on this same story's own
// numeric-claim-drift class): this metric's corpus is the whole tracked tree, which moves on
// nearly every commit — see completeness-claim-checker.ts's own DEFAULT_FILES/header reasoning for
// why a moving corpus cannot back an exact blocking `expect=N` assertion. Registered in
// `KNOWN_INSTRUMENTS` as a real, callable, ON-DEMAND instrument only — prose may point at the
// command, never freeze its output as a frozen count (see reference-resolver.ts's STRUCTURAL NOTE
// comment, which this instrument exists to back with a live command instead of a hand-typed one).
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeGitOps } from "../lib/git.ts";
import type { Runner } from "../lib/exec.ts";
import { realRunner } from "../lib/exec.ts";
import { listFilesRecursive } from "../lib/fs-walk.ts";
import type { Citation, ReferenceResolverDeps } from "./reference-resolver.ts";
import { resolveIssueCitations, resolveWithinRepo, scanReferences, shouldScanFile } from "./reference-resolver.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { printInstrumentResult } from "../lib/instrument.ts";
import { warnIfUntrackedScannable } from "./untracked-scan-warning.ts";

// Same stub shape as marker-corpus-probe.ts's own `stubDeps` — no real `gh` call, no network, no
// credential; only the CLASSIFICATION mechanism (markedVia) is read by
// `computeContinuationMarkedCount` below, never the (always-null) existence verdict.
const stubDeps: ReferenceResolverDeps = {
  pathExists: () => true,
  lineCount: () => null,
  knownAdrIds: new Set(),
  issueExists: () => null,
  repoSlug: null,
  // Issue #137, R1: this probe only reads `markedVia` off bare-hash issue citations — a path
  // citation's own basename-fallback resolution is never consulted by anything this file measures.
  findByBasename: () => [],
};

export type ContinuationResidualField = "continuation-marked" | "continuation-residual";

/** Pure — parses `--field=continuation-marked|continuation-residual` out of a CLI argv slice.
 * Throws on an unknown field value (fails loud); returns `null` when no `--field` flag is present
 * (the default, denominator-only summary mode — see `main()`). */
export function parseContinuationResidualField(args: string[]): ContinuationResidualField | null {
  const flag = args.find((a) => a.startsWith("--field="));
  if (!flag) return null;
  const value = flag.slice("--field=".length);
  if (value === "continuation-marked" || value === "continuation-residual") return value;
  throw new Error(`--field must be one of continuation-marked|continuation-residual, got "${value}"`);
}

/**
 * GitHub Issue #179: a stray positional argument (a leftover ref, `not-a-ref-at-all`, `HEAD~5`, ...)
 * or an unknown flag (`--bogus-flag`) used to be silently ignored — the probe printed a working-tree
 * count and exited 0. Any token that is not itself a `--field=...` flag is now a hard error, and
 * `main()` calls this before it collects any file. Pure — throws, never exits or logs itself.
 * Mirrors `assertKnownArgs` in marker-corpus-probe.ts (deliberately not shared, so the reviewed
 * argv code of that probe stays byte-identical).
 */
export function assertKnownArgs(args: string[]): void {
  const unknown = args.filter((a) => !a.startsWith("--field="));
  if (unknown.length > 0) {
    throw new Error(
      `unrecognized argument(s): ${unknown.map((a) => JSON.stringify(a)).join(", ")} — this probe only accepts ` +
        `--field=continuation-marked|continuation-residual (no positional ref and no other flag)`,
    );
  }
}

export interface ContinuationMarkedStats {
  continuationMarked: number;
  filesScanned: number;
}

/**
 * Pure — counts bare-hash citations whose `markedVia` is `"continuation"` (list-continuation
 * inheritance, never an explicit same-line marker) across the given file texts, using the real
 * shipped `scanReferences` classifier — never a second, independently-maintained copy of the
 * marker/list-continuation regex logic.
 */
export function computeContinuationMarkedCount(fileTexts: Map<string, string>): ContinuationMarkedStats {
  let continuationMarked = 0;
  for (const text of fileTexts.values()) {
    const citations: Citation[] = scanReferences(text, stubDeps);
    for (const c of citations) {
      if (c.markedVia === "continuation") continuationMarked++;
    }
  }
  return { continuationMarked, filesScanned: fileTexts.size };
}

export interface ContinuationResidualResult {
  /** Of the continuation-marked population, how many fail real existence (the genuine leak). */
  continuationResidual: number;
  /** How many continuation-marked citations were found at all (recomputed from the real pass, not
   * reused from `computeContinuationMarkedCount` — the real pass is the ground truth). */
  continuationMarked: number;
  /** `true` when the real pass's own `QA14_MAX_ISSUES` cap was exceeded — neither number above ran. */
  capExceeded: boolean;
  distinctIssueNumbers: number;
}

/**
 * Real, `gh`-backed numerator — REUSES `resolveIssueCitations` (never a second, bespoke `gh`-
 * calling path) so the existing `QA14_MAX_ISSUES` rate-limit cap and `issueCache` dedup apply
 * unchanged. `runner`/`maxDistinctIssues` are injected for the same reason
 * `resolveIssueCitations` itself injects them — a fake `Runner` exercises this end-to-end in tests
 * with zero real network calls.
 */
export async function computeContinuationResidual(
  fileTexts: Map<string, string>,
  baseDeps: Omit<ReferenceResolverDeps, "issueExists">,
  repoSlug: string | null,
  runner: Runner,
  maxDistinctIssues?: number,
): Promise<ContinuationResidualResult> {
  const { citations, distinctIssueNumbers, capExceeded } = await resolveIssueCitations(
    fileTexts,
    baseDeps,
    repoSlug,
    runner,
    maxDistinctIssues,
  );
  if (capExceeded) {
    return { continuationMarked: 0, continuationResidual: 0, capExceeded: true, distinctIssueNumbers };
  }
  let continuationMarked = 0;
  let continuationResidual = 0;
  for (const c of citations) {
    if (c.markedVia !== "continuation") continue;
    continuationMarked++;
    if (c.verdict === "unresolved-authority") continuationResidual++;
  }
  return { continuationMarked, continuationResidual, capExceeded: false, distinctIssueNumbers };
}

/**
 * Reads each listed (repo-relative or absolute) file's text, skipping (not erroring on) a path that no longer exists by the
 * time it's read — ENOENT — while letting any OTHER read failure propagate loud rather than be
 * silently absorbed into a wrong count.
 *
 * GitHub Issue #177 fix-now: the #170 ENOENT-narrowing below (this file's own twin defect) was
 * pinned by zero tests — a full-suite mutation reverting it to a blanket `catch { continue; }`
 * left the suite byte-identical (red-team round-2 report, attack 2, which covered both files).
 * `readFileImpl` is the dependency-injection seam that makes the narrowing provable: a test can
 * force a non-ENOENT error deterministically and assert it propagates instead of being swallowed.
 * Defaults to the real `fs/promises` `readFile` for every real caller. Mirrors
 * marker-corpus-probe.ts's own `readFileTexts` (same fix, same shape, same twin-file discipline
 * this story has followed throughout).
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
      // GitHub Issue #170 fix-now (cross-domain review of the sibling instrument,
      // marker-corpus-probe.ts, demonstrated ~17% flake under real `npm test` concurrency; named
      // there as an identical latent defect in THIS file's own `collectFullTreeFileTexts`, same
      // catch shape, same already-merged two-subprocess test): this used to be a blanket
      // `catch { continue; }`, silently treating ANY read failure — including a transient I/O
      // error under load — as "file gone", which could silently undercount. ENOENT is the one
      // genuinely legitimate skip (the path was listed but no longer exists); anything else is a
      // real failure and must propagate loud, not get silently absorbed into a wrong count.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return fileTexts;
}

/**
 * GitHub Issue #175 fix: the file LIST comes from `git.lsFilesWorkingTree()` — tracked plus
 * untracked-but-not-ignored paths in the CURRENT working tree (submodule gitlinks and untracked
 * nested repositories excluded, see `src/lib/git.ts`) — the same tree state the CONTENT is read
 * from below, and the same source marker-corpus-probe.ts uses. It used to be a `git ls-tree HEAD`
 * read (via `resolveChangedFiles` and the zero-SHA sentinel), so a new, untracked, uncommitted,
 * scannable file was invisible to the count while its content sat in the working tree.
 *
 * Human-ruled round-5 fix-now (docs/decisions.md's round-5-hard-stop ruling row; red-team's round-5
 * report, finding 2): content is ALWAYS read from the working tree, never from a ref, so this
 * function takes no ref (`--field=continuation-marked a26e55a` once reported a file list from that
 * ref against HEAD's working-tree content, a tree state that never existed).
 *
 * Exported so a test can call it in-process against an isolated `mkdtemp` git repo. Paths returned
 * by `lsFilesWorkingTree()` are repo-relative; they are resolved against `repoRoot` before reading
 * (mirrors marker-corpus-probe.ts's own Issue #176 fix-now) so a caller passing a `repoRoot` other
 * than `process.cwd()` (e.g. a test fixture) reads the right file.
 *
 * Because untracked files are now counted, `main()` also warns on stderr when any are in the scan
 * (untracked-scan-warning.ts, Issue #182); the count and stdout are unchanged by that warning.
 */
export async function collectFullTreeFileTexts(repoRoot: string): Promise<Map<string, string>> {
  const git = makeGitOps(realRunner, repoRoot);
  const workingTreeFiles = await git.lsFilesWorkingTree();
  return readFileTexts(workingTreeFiles.map((f) => resolve(repoRoot, f)));
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const argv = process.argv.slice(2);
  assertKnownArgs(argv);
  const field = parseContinuationResidualField(argv);

  const fileTexts = await collectFullTreeFileTexts(repoRoot);
  // Issue #182: disclose untracked files inside the count on stderr; the number and stdout are unchanged.
  await warnIfUntrackedScannable(realRunner, repoRoot, (message) => console.error(message));

  if (field === null || field === "continuation-marked") {
    const denom = computeContinuationMarkedCount(fileTexts);
    const result: InstrumentResult = field
      ? { ok: true, vacuous: fileTexts.size === 0, summary: `continuation-marked=${denom.continuationMarked}`, details: [] }
      : {
          ok: true,
          vacuous: fileTexts.size === 0,
          summary:
            `continuation-marked=${denom.continuationMarked} (${denom.filesScanned} files scanned) — pure/sync, ` +
            `no gh calls, no credential. Run with --field=continuation-residual for the real, gh-backed leak ` +
            `count (slower, capped by QA14_MAX_ISSUES, requires gh credentials).`,
          details: [],
        };
    printInstrumentResult("QA-14 continuation-residual-probe", result);
    process.exit(0);
  }

  // field === "continuation-residual": the real, gh-backed numerator.
  const git = makeGitOps(realRunner, repoRoot);
  const repoSlug = await git.originSlug();
  const adrFiles = [
    ...(await listFilesRecursive("adr/devops", (p) => /^\d{4}-.*\.md$/.test(p.split("/").pop() ?? ""))),
    ...(await listFilesRecursive("adr/software-engineering", (p) => /^\d{4}-.*\.md$/.test(p.split("/").pop() ?? ""))),
  ];
  const knownAdrIds = new Set(adrFiles.map((f) => `ADR-${(f.split("/").pop() ?? "").slice(0, 4)}`));
  const baseDeps: Omit<ReferenceResolverDeps, "issueExists"> = {
    pathExists: (p) => {
      const resolved = resolveWithinRepo(repoRoot, p);
      return resolved !== null && existsSync(resolved);
    },
    lineCount: (p) => {
      const resolved = resolveWithinRepo(repoRoot, p);
      if (resolved === null) return null;
      try {
        return readFileSync(resolved, "utf8").split("\n").length;
      } catch {
        return null;
      }
    },
    knownAdrIds,
    repoSlug,
    // Issue #137, R1: this probe's own metric (the continuation-marked/-residual counts) is
    // computed purely off bare-hash issue citations — path citations are scanned incidentally by
    // `scanReferences` but never read by `computeContinuationResidual`, so no real basename index
    // is needed here.
    findByBasename: () => [],
  };

  const result = await computeContinuationResidual(fileTexts, baseDeps, repoSlug, realRunner);
  if (result.capExceeded) {
    printInstrumentResult("QA-14 continuation-residual-probe", {
      ok: false,
      vacuous: false,
      summary:
        `${result.distinctIssueNumbers} distinct issue citation(s) this run exceeded the cap — increase ` +
        `QA14_MAX_ISSUES or reduce/batch citations. Failing loud rather than silently rate-limiting into ` +
        `"cannot verify" nulls (same cap resolveIssueCitations itself already enforces).`,
      details: [],
    });
    process.exit(1);
  }
  printInstrumentResult("QA-14 continuation-residual-probe", {
    ok: true,
    vacuous: fileTexts.size === 0,
    summary: `continuation-residual=${result.continuationResidual}`,
    details: [`continuation-marked=${result.continuationMarked}`, `distinct issue numbers queried=${result.distinctIssueNumbers}`],
  });
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
