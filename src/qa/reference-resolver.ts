// QA-14: "Every reference in a changed file shall resolve to something that exists in this
// repository." Acceptance: document paths, an Issue number, an ADR id (4-digit, hyphenated),
// docs/reviews/ report filenames and a path-plus-line-number citation. Two non-optional shapes: a
// citation to a nonexistent authority, and an issue number belonging to a different repository.
// "The checker parses this project's own house citation style... a checker that silently skips
// what it cannot parse is a failing checker, not a passing one (QA-16)."
//
// Dogfood note: this file's own doc comments below deliberately avoid writing a real-looking
// `ADR-####` or `path:line` shape in backticks — this checker, run against its own source, would
// (correctly) flag such a comment as an unresolved/unparseable citation. That is not a bug in the
// checker; it is QA-14 catching exactly the class of thing it exists to catch, even in its own
// source. Fixed here by rewording rather than adding a self-exemption.
//
// Every dependency the resolver needs (filesystem existence, ADR ids, Issue lookup, repo slug) is
// injected — this module's own scanning/classification logic is pure and unit-tested without I/O.
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { makeGitOps, resolveChangedFiles } from "../lib/git.ts";
import type { Runner } from "../lib/exec.ts";
import { realRunner } from "../lib/exec.ts";
import { listFilesRecursive } from "../lib/fs-walk.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export type Verdict = "resolved" | "unresolved-authority" | "cross-repo-issue" | "unparseable";

export interface Citation {
  raw: string;
  kind: "adr" | "issue" | "milestone" | "path" | "path-line" | "unparseable";
  verdict: Verdict;
  reason: string;
}

export interface ReferenceResolverDeps {
  /** Repo-relative path existence check. */
  pathExists: (repoRelativePath: string) => boolean;
  /** Total line count of a repo-relative file, for path:line bounds checking. */
  lineCount: (repoRelativePath: string) => number | null;
  /** Every known ADR id, e.g. "ADR-0021". */
  knownAdrIds: Set<string>;
  /** Resolves whether a bare local issue number exists. null = "could not verify" (fail-closed). */
  issueExists: (n: number) => boolean | null;
  /** This repository's own `owner/repo` slug, or null if unknown. */
  repoSlug: string | null;
}

// Candidate-citation detector: broad enough to catch "looks like a citation" text so nothing
// silently skips past unclassified (QA-16's own rule, applied to this checker itself).
// Candidates stop at the first non-identifier character (space, period, comma, closing paren...)
// so trailing prose punctuation never becomes part of the citation itself; a genuinely malformed
// shape (wrong digit count, non-numeric suffix) still reaches classify*() and is reported
// unparseable there — this boundary only keeps sentence punctuation out of the raw match.
const ADR_CANDIDATE_RE = /\bADR-[A-Za-z0-9]+/g;
// Boundary-bug fix (this round's own tracked defect): the previous `/\b(?:[\w.-]+\/[\w.-]+)?#\d+/g` put its `\b` in front of an
// OPTIONAL group. When the group didn't participate (the common case — a bare, non-cross-repo
// citation), `\b` could only match immediately before `#` when the PRECEDING character was a
// word character. `#` itself is non-word, so that boundary never exists after whitespace, `(`,
// `:`, `[`, or at start-of-line/string — exactly the shapes this project actually uses (measured
// via `grep` across `docs/`/`CHANGELOG.md`: "Closes #N", "(#N)", "Milestone #N", a line-start
// "#N"). Only "owner/repo#N" and an accidental word-glued "x#N" (the leading word silently
// dropped from the match) ever worked.
//
// Fixed as two explicit alternatives instead of one optional group, each anchored on its OWN
// correct side:
//  - `\b[\w.-]+\/[\w.-]+#\d+(?!\w)` — the owner/repo#N shape, unchanged in spirit from before
//    (still requires a real `/` and a leading word boundary so it can't start mid-token).
//  - `#\d+(?!\w)` — a bare `#N` with NO leading-context restriction at all, so it matches
//    regardless of what precedes it (start of line, whitespace, `(`, `:`, a preceding word char
//    — all of these are real citation forms in this repo's own history, confirmed by grep).
// Both alternatives share a trailing `(?!\w)` — the number must not be immediately followed by
// another word character. This is the false-positive guard: it is what keeps a mixed-alphanumeric
// CSS hex color literal (this repo's `docs/dashboard.mjs` inline `<style>` block has several) from
// being torn into a bogus short digit-prefix match — the digit run stops at the first hex letter,
// and `(?!\w)` then rejects that shorter, letter-followed prefix — while still matching every real
// citation shape above (each is followed by whitespace or punctuation, never a word character). A
// fully-numeric hex color (all-digit, no hex letters) would remain genuinely ambiguous with a real
// issue number; none exist in this tree today (checked), so this is a documented, not a live, gap.
const ISSUE_CANDIDATE_RE = /\b[\w.-]+\/[\w.-]+#\d+(?!\w)|#\d+(?!\w)/g;
const ISSUE_WORD_CANDIDATE_RE = /\bIssue\s*#\d+/gi;
// A GitHub Milestone number lives in a namespace entirely separate from Issue numbers (a repo's
// milestones and issues are independently numbered) — conflating a Milestone reference with an
// Issue citation of the same number would silently verify the WRONG entity (an issue that happens
// to share the number, or a false failure when no issue shares it). Recognized as its own
// citation kind so the fixed boundary
// above (which would otherwise feed it straight into `classifyIssue`) can't do that; not verified
// against a live milestone list in this pass (no such lookup exists in this repo yet) but no
// longer silently invisible either — the QA-16 doctrine this file's own header names.
const MILESTONE_CANDIDATE_RE = /\bMilestone\s*#\d+/gi;
const BACKTICK_PATH_RE = /`([^`\n]+)`/g;

function classifyAdr(raw: string, deps: ReferenceResolverDeps): Citation {
  const m = /^ADR-(\d+)$/.exec(raw);
  if (!m || (m[1]?.length ?? 0) !== 4) {
    return { raw, kind: "unparseable", verdict: "unparseable", reason: "ADR id must be exactly ADR-#### (4 digits)" };
  }
  if (deps.knownAdrIds.has(raw)) {
    return { raw, kind: "adr", verdict: "resolved", reason: "found in ADR catalog" };
  }
  return { raw, kind: "adr", verdict: "unresolved-authority", reason: "no ADR with this id exists in the tree" };
}

function classifyMilestone(raw: string): Citation {
  return {
    raw,
    kind: "milestone",
    verdict: "resolved",
    reason: "GitHub Milestone reference (separate numbering namespace from Issues) — recognized, not verified against a live milestone list in this pass",
  };
}

function classifyIssue(raw: string, deps: ReferenceResolverDeps): Citation {
  // owner/repo#N (cross-repo shape) vs bare #N / "Issue #N" (local shape)
  const cross = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(raw);
  if (cross) {
    const slug = cross[1];
    if (deps.repoSlug && slug !== deps.repoSlug) {
      return { raw, kind: "issue", verdict: "cross-repo-issue", reason: `cites ${slug}, not this repository (${deps.repoSlug})` };
    }
    // Same-repo explicit slug — verify like a local issue.
    const n = Number(cross[2]);
    return verifyLocalIssue(raw, n, deps);
  }

  const bare = /^#(\d+)$/.exec(raw) ?? /^Issue\s*#(\d+)$/i.exec(raw);
  if (bare) {
    const n = Number(bare[1]);
    return verifyLocalIssue(raw, n, deps);
  }

  return { raw, kind: "unparseable", verdict: "unparseable", reason: "unrecognized issue citation shape" };
}

function verifyLocalIssue(raw: string, n: number, deps: ReferenceResolverDeps): Citation {
  const exists = deps.issueExists(n);
  if (exists === null) {
    return { raw, kind: "issue", verdict: "unresolved-authority", reason: "cannot verify (no issue-tracker access) — fails closed, not silently skipped" };
  }
  if (!exists) {
    return { raw, kind: "issue", verdict: "unresolved-authority", reason: `Issue #${n} does not exist in this repository` };
  }
  return { raw, kind: "issue", verdict: "resolved", reason: "issue confirmed to exist" };
}

/**
 * Resolves `relPath` against `repoRoot` and returns the resolved absolute path ONLY if it stays
 * within `repoRoot` — a backtick-quoted citation is PR-authored, untrusted text, and a crafted
 * `../../`-style citation must never be handed to `existsSync`/`readFileSync` to probe file
 * existence or line counts outside the repository (app-security review, SUSPICION finding on
 * `pathExists`/`lineCount`'s wiring below). Returns null when the resolved path escapes.
 */
export function resolveWithinRepo(repoRoot: string, relPath: string): string | null {
  const resolvedRoot = resolve(repoRoot);
  const resolved = resolve(resolvedRoot, relPath);
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

function classifyPath(raw: string, deps: ReferenceResolverDeps): Citation | null {
  // A path followed by a colon and a line number, e.g. a file path with :42 appended.
  const pl = /^([^\s:`]+\.\w+):(\d+)$/.exec(raw);
  if (pl) {
    const [, path, lineStr] = pl;
    if (!path) return null;
    if (!deps.pathExists(path)) {
      return { raw, kind: "path-line", verdict: "unresolved-authority", reason: `${path} does not exist` };
    }
    const total = deps.lineCount(path);
    const line = Number(lineStr);
    if (total !== null && line > total) {
      return { raw, kind: "path-line", verdict: "unresolved-authority", reason: `${path} has ${total} lines, cited line ${line} is out of range` };
    }
    return { raw, kind: "path-line", verdict: "resolved", reason: "path and line both resolve" };
  }

  // A bare repo-relative path with at least one slash or a known top-level doc filename shape.
  const looksLikePath = /^[\w.-]+(\/[\w.-]+)+\.\w+$/.test(raw) || /^[A-Z][\w-]*\.md$/.test(raw);
  if (looksLikePath) {
    if (deps.pathExists(raw)) {
      return { raw, kind: "path", verdict: "resolved", reason: "path exists" };
    }
    return { raw, kind: "path", verdict: "unresolved-authority", reason: "path does not exist in this repository" };
  }

  return null;
}

/** Scans `text` for every citation-shaped candidate and classifies each. Pure — no I/O. */
export function scanReferences(text: string, deps: ReferenceResolverDeps): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  function record(raw: string, classify: () => Citation): void {
    const key = raw;
    if (seen.has(key)) return;
    seen.add(key);
    citations.push(classify());
  }

  for (const m of text.matchAll(ADR_CANDIDATE_RE)) {
    record(m[0], () => classifyAdr(m[0], deps));
  }
  for (const m of text.matchAll(ISSUE_WORD_CANDIDATE_RE)) {
    const normalized = m[0].replace(/\s+/g, "");
    record(normalized, () => classifyIssue(normalized, deps));
  }
  // Milestone candidates are scanned BEFORE the general issue-shaped candidates below, and the
  // bare-issue loop skips anything immediately preceded by "Milestone"/"Issue" text (its own
  // word-form pass already recorded it) — see the `precedingWord` guard — so a "Milestone #N"
  // occurrence is never double-recorded as both a milestone AND a bare issue citation.
  for (const m of text.matchAll(MILESTONE_CANDIDATE_RE)) {
    const normalized = m[0].replace(/\s+/g, " ").trim();
    record(normalized, () => classifyMilestone(normalized));
  }
  for (const m of text.matchAll(ISSUE_CANDIDATE_RE)) {
    if (m[0].startsWith("ADR-")) continue;
    const idx = m.index ?? 0;
    const precedingWord = /\b(?:issue|milestone)\s*$/i.test(text.slice(0, idx));
    if (precedingWord) continue; // already captured by its own word-form pass above
    record(m[0], () => classifyIssue(m[0], deps));
  }
  for (const m of text.matchAll(BACKTICK_PATH_RE)) {
    const inner = (m[1] ?? "").trim();
    if (inner.length === 0) continue;
    const classified = classifyPath(inner, deps);
    if (classified) record(inner, () => classified);
  }

  return citations;
}

/**
 * `*.test.ts` files are exempt from QA-14's scan: they test this checker's own classification
 * logic using deliberately-fabricated example citations (a fake ADR id, a fake cross-repo Issue,
 * ...) — those are the checker's own fixtures, not a claim it verifies, the same distinction
 * QA-01's unit-test fixtures get versus real policy fixtures (src/qa/policy-fixtures.ts).
 */
export function shouldScanFile(repoRelativePath: string): boolean {
  return !repoRelativePath.endsWith(".test.ts");
}

export function summarizeCitations(citations: Citation[]): InstrumentResult {
  if (citations.length === 0) {
    return {
      ok: true,
      vacuous: true,
      summary: "0 citations found in the scanned text — vacuous pass.",
      details: [],
    };
  }

  const bad = citations.filter((c) => c.verdict !== "resolved");
  if (bad.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${bad.length} of ${citations.length} citation(s) failed to resolve.`,
      details: bad.map((c) => `[${c.verdict}] ${c.raw} — ${c.reason}`),
    };
  }

  return {
    ok: true,
    vacuous: false,
    summary: `${citations.length} citation(s), all resolved.`,
    details: [],
  };
}

/**
 * Real credential-backed issue-existence check, via the injected `Runner` (never invoked directly
 * by `scanReferences`/`classifyIssue`/`verifyLocalIssue`, which stay synchronous and pure — this
 * lives one layer up, at `main()`'s async I/O boundary, matching `completeness-claim-checker.ts`'s
 * `verifyMarkerClaim(claim, runner)` shape).
 *
 * Returns:
 * - `null` immediately when `repoSlug` is null (no known repo to query — fails closed, same as
 *   today's unconditional `null` stub, never silently treated as "doesn't exist").
 * - `true` when `gh issue view <n> --repo <slug> --json state` exits 0 and prints parseable JSON
 *   with a `state` field (an Issue or PR — GitHub's own API does not distinguish the two here).
 * - `false` when `gh` reports the number does not resolve to an issue or PR (its own documented
 *   "Could not resolve to an issue or pull request" message, or any 404-shaped stderr) — a real,
 *   positively-confirmed absence, not a failure to check.
 * - `null` for anything else (auth failure, network failure, timeout, rate limit, unparseable
 *   stdout) — fails closed exactly like the "cannot verify" path already covered by
 *   `verifyLocalIssue`'s existing null-handling; this function never turns an inconclusive call
 *   into a false negative.
 */
export async function checkIssueViaGh(n: number, repoSlug: string | null, runner: Runner): Promise<boolean | null> {
  if (repoSlug === null) return null;

  const res = await runner("gh", ["issue", "view", String(n), "--repo", repoSlug, "--json", "state"], {
    timeoutMs: 30_000,
  });

  if (res.code === 0) {
    try {
      const parsed: unknown = JSON.parse(res.stdout);
      if (parsed !== null && typeof parsed === "object" && "state" in parsed) return true;
      return null; // exit 0 but not the shape we expect — inconclusive, fail closed
    } catch {
      return null; // exit 0 but unparseable stdout — inconclusive, fail closed
    }
  }

  // gh's own documented not-found message (GraphQL "Could not resolve to an issue or pull
  // request ... (repository.issue)"), or an HTTP 404-shaped stderr — both are a real, confirmed
  // absence. Measured directly against a real `gh issue view` call on a nonexistent number
  // (this repo, this session): exit 1, stderr = `GraphQL: Could not resolve to an issue or pull
  // request with the number of <n>. (repository.issue)`.
  if (/could not resolve to an issue or pull request/i.test(res.stderr) || /\b404\b/.test(res.stderr)) {
    return false;
  }

  // Any other non-zero exit (auth failure, network failure, timeout, rate limit, unrecognized
  // repo, etc.) is inconclusive — fails closed, never silently treated as "doesn't exist" or
  // "exists".
  return null;
}

// Rate-limit/batching fix (this round's own tracked defect): a per-run cap on distinct issue
// numbers this run will look up via `gh issue view` (one call each — dedup is exact, see
// `resolveIssueCitations` below). GITHUB_TOKEN's documented per-repo REST budget is ~1,000/hr;
// measured directly against this repo before this round's own boundary-bug fix: 71 distinct
// numbers on this diff's own changed-file scope, 101 full-tree. 300 leaves a wide margin above
// both measured figures (including the increase the boundary fix itself causes, since more real
// citations are now classified at all) while still catching a future diff that would genuinely
// risk exhausting the budget — e.g. several concurrent CI runs sharing the same token — with a
// loud, actionable failure instead of letting rate-limiting silently degrade every further lookup
// into the same "cannot verify" `null` this story exists to eliminate. Overridable via
// `QA14_MAX_ISSUES` for a repo with a different real citation volume.
export const DEFAULT_MAX_DISTINCT_ISSUES = Number(process.env.QA14_MAX_ISSUES ?? 300);

export interface IssueResolution {
  /** Every citation the scanned text set contains, of every kind — not issue citations alone. */
  citations: Citation[];
  /** How many distinct issue numbers pass 1 found across every scanned file. */
  distinctIssueNumbers: number;
  /** `true` when `distinctIssueNumbers` exceeded `maxDistinctIssues` — pass 2 did NOT run. */
  capExceeded: boolean;
}

/**
 * The real two-pass wiring (collect -> gh-resolve -> real re-scan), extracted out of `main()` so
 * it has its own exported, `Runner`-injected test seam (this round's own wiring-coverage fix).
 * Before this, only
 * `checkIssueViaGh` itself was unit-tested in isolation; a mutation that broke the WIRING around
 * it (e.g. `issueExists: () => true`, a total fail-open) was invisible to the suite because
 * nothing exercised this function end-to-end with a fake `Runner`.
 */
export async function resolveIssueCitations(
  fileTexts: Map<string, string>,
  baseDeps: Omit<ReferenceResolverDeps, "issueExists">,
  repoSlug: string | null,
  runner: Runner,
  maxDistinctIssues: number = DEFAULT_MAX_DISTINCT_ISSUES,
): Promise<IssueResolution> {
  // Pass 1 (collector): `scanReferences`/`classifyIssue`/`verifyLocalIssue` stay synchronous and
  // pure (never made async) — so real credential-backed lookup happens here, one layer up, by
  // running the scan once with an `issueExists` that only RECORDS every queried issue number
  // (returning `null` so this pass's own citation verdicts are discarded, never reported).
  const queriedIssueNumbers = new Set<number>();
  const collectorDeps: ReferenceResolverDeps = {
    ...baseDeps,
    issueExists: (n) => {
      queriedIssueNumbers.add(n);
      return null;
    },
  };
  for (const text of fileTexts.values()) {
    scanReferences(text, collectorDeps);
  }

  if (queriedIssueNumbers.size > maxDistinctIssues) {
    return { citations: [], distinctIssueNumbers: queriedIssueNumbers.size, capExceeded: true };
  }

  // Real lookup: one `gh issue view` call per DISTINCT issue number found above, via the injected
  // Runner (never a bare `child_process` call here — stays swappable/fake-able in tests). The
  // `issueCache` Map below IS the dedup mechanism: a number cited many times in the scanned text
  // still costs exactly one `gh` call and one cache entry.
  const issueCache = new Map<number, boolean | null>();
  for (const n of queriedIssueNumbers) {
    issueCache.set(n, await checkIssueViaGh(n, repoSlug, runner));
  }

  // Pass 2 (real): re-run the scan for real, resolving every issue citation against the cache
  // built above — `?? null` preserves fail-closed semantics for a number this pass somehow didn't
  // query in pass 1 (should not happen; the same `scanReferences` logic runs both passes over the
  // same text).
  const realDeps: ReferenceResolverDeps = {
    ...baseDeps,
    issueExists: (n) => issueCache.get(n) ?? null,
  };
  const citations: Citation[] = [];
  for (const text of fileTexts.values()) {
    citations.push(...scanReferences(text, realDeps));
  }

  return { citations, distinctIssueNumbers: queriedIssueNumbers.size, capExceeded: false };
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const base = process.argv[2] ?? process.env.QA14_BASE_REF ?? "HEAD~1";
  const head = process.argv[3] ?? process.env.QA14_HEAD_REF ?? "HEAD";

  const git = makeGitOps(realRunner, repoRoot);
  const resolved = await resolveChangedFiles(git, base, head);
  if (resolved === null) {
    printInstrumentResult("QA-14 reference-resolver", {
      ok: true,
      vacuous: true,
      summary: `No diff available between ${base} and ${head} — vacuous pass.`,
      details: [],
    });
    process.exit(0);
  }
  if (resolved.fullTreeFallback) {
    console.log(
      `[QA-14 reference-resolver] NOTE: base "${base}" / head "${head}" included the zero-SHA sentinel ` +
        `(GitHub's github.event.before on a branch's first push or a history-discontinuous push) — ` +
        `falling back to a full-tree scan instead of a diff, not silently passing.`,
    );
  }
  const changedFiles = resolved.changedFiles;

  const repoSlug = await git.originSlug();

  // ADR catalog: read directly from adr/**/*.md filenames (NNNN-*.md), independent of
  // docs/.maat-state.json's own freshness — this checker never trusts a possibly-stale cache for
  // its own pass/fail.
  const adrFiles = [
    ...(await listFilesRecursive("adr/devops", (p) => /^\d{4}-.*\.md$/.test(p.split("/").pop() ?? ""))),
    ...(await listFilesRecursive("adr/software-engineering", (p) => /^\d{4}-.*\.md$/.test(p.split("/").pop() ?? ""))),
  ];
  const knownAdrIds = new Set(
    adrFiles.map((f) => `ADR-${(f.split("/").pop() ?? "").slice(0, 4)}`),
  );

  const baseDeps: Omit<ReferenceResolverDeps, "issueExists"> = {
    pathExists: (p) => {
      const resolved = resolveWithinRepo(repoRoot, p);
      return resolved !== null && existsSync(resolved);
    },
    lineCount: (p) => {
      const resolved = resolveWithinRepo(repoRoot, p);
      if (resolved === null) return null;
      try {
        const content = readFileSync(resolved, "utf8");
        return content.split("\n").length;
      } catch {
        return null;
      }
    },
    knownAdrIds,
    repoSlug,
  };

  // Read every scanned file's text once, up front — reused across both passes below so the
  // second (real) pass never re-reads a file whose content could theoretically change between
  // passes (a stronger guarantee than strictly required today, but free and correct).
  const fileTexts = new Map<string, string>();
  for (const file of changedFiles) {
    if (!shouldScanFile(file)) continue;
    if (!existsSync(resolve(repoRoot, file))) continue; // deleted file, nothing to scan
    fileTexts.set(file, await readFile(resolve(repoRoot, file), "utf8"));
  }

  const issueResolution = await resolveIssueCitations(fileTexts, baseDeps, repoSlug, realRunner);
  if (issueResolution.capExceeded) {
    printInstrumentResult("QA-14 reference-resolver", {
      ok: false,
      vacuous: false,
      summary: `${issueResolution.distinctIssueNumbers} distinct issue citation(s) this run, cap is ${DEFAULT_MAX_DISTINCT_ISSUES} \`gh issue view\` calls — increase QA14_MAX_ISSUES or reduce/batch citations. Failing loud rather than silently rate-limiting GITHUB_TOKEN's ~1,000/hr/repo budget into "cannot verify" nulls.`,
      details: [],
    });
    process.exit(1);
  }

  const result = summarizeCitations(issueResolution.citations);
  printInstrumentResult("QA-14 reference-resolver", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
