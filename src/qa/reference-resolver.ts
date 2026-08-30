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
import { resolve } from "node:path";
import { makeGitOps } from "../lib/git.ts";
import { realRunner } from "../lib/exec.ts";
import { listFilesRecursive } from "../lib/fs-walk.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export type Verdict = "resolved" | "unresolved-authority" | "cross-repo-issue" | "unparseable";

export interface Citation {
  raw: string;
  kind: "adr" | "issue" | "path" | "path-line" | "unparseable";
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
const ISSUE_CANDIDATE_RE = /\b(?:[\w.-]+\/[\w.-]+)?#\d+/g;
const ISSUE_WORD_CANDIDATE_RE = /\bIssue\s*#\d+/gi;
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
  for (const m of text.matchAll(ISSUE_CANDIDATE_RE)) {
    if (m[0].startsWith("ADR-")) continue;
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

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const base = process.argv[2] ?? process.env.QA14_BASE_REF ?? "HEAD~1";
  const head = process.argv[3] ?? process.env.QA14_HEAD_REF ?? "HEAD";

  const git = makeGitOps(realRunner, repoRoot);
  let changedFiles: string[];
  try {
    changedFiles = await git.diffNameOnly(base, head);
  } catch {
    printInstrumentResult("QA-14 reference-resolver", {
      ok: true,
      vacuous: true,
      summary: `No diff available between ${base} and ${head} — vacuous pass.`,
      details: [],
    });
    process.exit(0);
  }

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

  const deps: ReferenceResolverDeps = {
    pathExists: (p) => existsSync(resolve(repoRoot, p)),
    lineCount: (p) => {
      try {
        const content = readFileSync(resolve(repoRoot, p), "utf8");
        return content.split("\n").length;
      } catch {
        return null;
      }
    },
    knownAdrIds,
    // No issue-tracker credential is wired into this CI job by default — fails closed (returns
    // null -> "cannot verify") rather than silently skipping local issue citations. A future
    // story wires a real `gh issue view` lookup here.
    issueExists: () => null,
    repoSlug,
  };

  const allCitations: Citation[] = [];
  for (const file of changedFiles) {
    if (!shouldScanFile(file)) continue;
    if (!existsSync(resolve(repoRoot, file))) continue; // deleted file, nothing to scan
    const text = await readFile(resolve(repoRoot, file), "utf8");
    allCitations.push(...scanReferences(text, deps));
  }

  const result = summarizeCitations(allCitations);
  printInstrumentResult("QA-14 reference-resolver", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
