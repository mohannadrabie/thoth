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
// Which text of a changed file is checked (the whole file, or only the text a diff adds for an
// append-only historical record; the generated adrCatalog mirror excluded) is defined in
// src/qa/reference-scope.ts. A citation a diff adds is always checked.
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
import { buildScanTexts } from "./reference-scope.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

// "unclassified" (QA-14 marker redesign, 2026-09-11, see docs/decisions.md 2026-09-11 row 61 and
// docs/plans/qa14-marker-redesign-phase1-2026-09-11.md): a bare `#N` with no explicit citation
// marker in front of it on the same line/list. Deliberately NON-BLOCKING (see summarizeCitations
// below) — it is neither asserted resolved nor asserted failed, because doing either from a bare
// number with no marker is exactly the directional guess this redesign exists to stop.
export type Verdict = "resolved" | "unresolved-authority" | "cross-repo-issue" | "unparseable" | "unclassified";

export interface Citation {
  raw: string;
  // "issue-candidate": a bare #N recorded but never asserted as a real citation (no explicit
  // marker found) — always paired with verdict "unclassified". Distinct from kind:"issue" (which
  // always means a marker, or an owner/repo/Milestone shape, put this through real classification
  // against issueExists/verifyLocalIssue), so every existing test/consumer that filters
  // `kind === "issue"` keeps its original meaning unchanged.
  kind: "adr" | "issue" | "milestone" | "path" | "path-line" | "unparseable" | "issue-candidate";
  verdict: Verdict;
  reason: string;
  // Council fix-now round 4 (2026-09-11, docs/decisions.md's "Path-Forward Brief" row, design-
  // challenger's root-cause finding O2): `kind: "issue"` alone collapses a directly-marked bare
  // hash-number citation and a continuation-marked one (a later list member that inherited status
  // from an earlier marked member, rather than sitting right after a marker word itself) into the
  // same value — the distinction `classifyBareHashMatch` already computes internally was being
  // discarded before it reached any caller, which is why every prior round's measurement of this
  // known residual (see the STRUCTURAL NOTE comment below, near `TIGHT_DASH_CONTINUATION_RE`) had
  // to hand-build a throwaway instrumented fork instead of reading it off a real `Citation`. Set
  // only for a LOCAL bare-hash-shaped issue citation (the bare and word-form
  // "Issue" shapes) — `undefined` for every other kind (cross-repo, milestone, path, adr,
  // unparseable, issue-candidate), where the distinction doesn't apply. Real digit examples
  // deliberately avoided here — see this file's own header dogfood note.
  markedVia?: "direct" | "continuation";
  // Repo-relative path of the file the citation was found in. Set only by `resolveIssueCitations`
  // (which knows which file each text came from); `scanReferences` works on one anonymous text and
  // never sets it. `summarizeCitations` prints it on each failure line so a failing run names the
  // file to fix instead of leaving the reader to search the tree.
  file?: string;
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
  /**
   * Every repo-relative path whose basename (final path segment) exactly matches `basename`.
   * GitHub issue 137, R1: used ONLY as a fallback inside `classifyPath`'s `path:line` branch, and
   * only when the cited path segment contains no `/` and fails `pathExists` as literally cited
   * (this repo's own review/plan prose often cites a bare filename rather than its fully-qualified
   * repo-relative path). Never consulted for the bare-path/no-line-number branch, and never
   * consulted when the cited segment already contains a `/`. Real path:line examples deliberately
   * avoided here — see this file's own header dogfood note.
   */
  findByBasename: (basename: string) => string[];
}

// Candidate-citation detector: broad enough to catch "looks like a citation" text so nothing
// silently skips past unclassified (QA-16's own rule, applied to this checker itself).
// Candidates stop at the first non-identifier character (space, period, comma, closing paren...)
// so trailing prose punctuation never becomes part of the citation itself; a genuinely malformed
// shape (wrong digit count, non-numeric suffix) still reaches classify*() and is reported
// unparseable there — this boundary only keeps sentence punctuation out of the raw match.
//
// Digit-boundary tightening (GitHub issue 137, R2): the lookahead `(?=[A-Za-z0-9]*\d)` requires at
// least one digit ANYWHERE in the suffix before the candidate is recorded at all. Ordinary prose
// that happens to say "ADR-amendment", "ADR-cache", or a literal "ADR-NNNN" placeholder (zero
// digits) is never a candidate in the first place — no false unparseable report for text that was
// never trying to cite a real ADR id. A suffix carrying any digit at all is still a candidate
// exactly as before, and still reaches `classifyAdr` below for its own exact-4-digit-length
// validation, byte-identical to before this round. Real digit-suffix examples deliberately avoided
// here — see this file's own header dogfood note.
const ADR_CANDIDATE_RE = /\bADR-(?=[A-Za-z0-9]*\d)[A-Za-z0-9]+/g;
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
// citation shape above (each is followed by whitespace or punctuation, never a word character).
//
// Round-3 fix (GitHub issue 144): a fully-numeric hex color (all-digit, no hex letters, e.g.
// `background:#000`) is NOT rejected by the guard above, and one real instance exists in this tree
// today at `docs/dashboard.mjs:646` — measured via `git ls-files` plus this regex, not asserted (an
// earlier version of this comment claimed "none exist... checked", which was false; that claim is
// removed rather than repeated). Every real occurrence of this shape in this repo's tracked files is
// a CSS color literal written as `property:#digits` — a colon with NO intervening whitespace
// directly before the `#`, a shape this project's own citation prose never uses (measured via
// `grep -rn ':#[0-9]+'` across tracked files: every hit is a CSS declaration). A leading `(?<!:)`
// rejects exactly that shape without touching any real citation form (which is always preceded by
// whitespace, `(`, start-of-line, or a word character, never a bare `:`). A parallel `(?<!&)` rejects
// an HTML numeric character entity (`&#39;`, `docs/dashboard.mjs:33`) the same way — `&#N;` is never
// a real issue/milestone citation shape in this repo's prose.
const ISSUE_CANDIDATE_RE = /\b[\w.-]+\/[\w.-]+#\d+(?!\w)|(?<![:&])#\d+(?!\w)/g;
const ISSUE_WORD_CANDIDATE_RE = /\bIssue\s*#\d+/gi;
// A GitHub Milestone number lives in a namespace entirely separate from Issue numbers (a repo's
// milestones and issues are independently numbered) — conflating a Milestone reference with an
// Issue citation of the same number would silently verify the WRONG entity (an issue that happens
// to share the number, or a false failure when no issue shares it). Recognized as its own
// citation kind so the fixed boundary
// above (which would otherwise feed it straight into `classifyIssue`) can't do that; not verified
// against a live milestone list in this pass (no such lookup exists in this repo yet) but no
// longer silently invisible either — the QA-16 doctrine this file's own header names.
//
// Round-3 fix (GitHub issue 143, finding NEW-4): `\s` includes a newline, so this previously matched
// "milestone" at the end of one line joined to a real, unrelated "#N" issue citation starting the
// next line, silently mis-kinding a genuine Issue citation as an unverified Milestone and
// auto-resolving it. `[ \t]*` (same-line whitespace only) keeps the real "Milestone #N" same-line
// shape working while refusing to span a line break.
const MILESTONE_CANDIDATE_RE = /\bMilestone[ \t]*#\d+/gi;
// Marker-based redesign (2026-09-11, closes GitHub issues 143, 144 and 145, and issue 137's own
// finding (c) — deliberately written without a "#" here; see this file's own header dogfood note):
// replaces the round-3 ordinal-word DENYLIST above (deleted — `NON_ISSUE_ORDINAL_WORD_RE` and its
// exclusion branch no longer exist). Round-3's own red-team re-confirm (`docs/reviews/qa1415fix-red-team-round3-2026-09-10.md`)
// demonstrated the denylist could never be complete (>= 12 residual unlisted-ordinal-word shapes
// measured full-tree) and that chasing it word-by-word is an unbounded tail. The replacement flips
// the signal requirement from NEGATIVE ("is this word on my exclusion list?") to POSITIVE ("does an
// explicit citation marker precede this bare #N?") — a bare `#N` with no marker is never silently
// asserted resolved OR silently excluded; it is reported, loudly, as `unclassified` (see
// `classifyBareHashMatch` and `summarizeCitations` below). No word is ever enumerated as
// "excluded" — there is nothing left to maintain for this bug class.
//
// Marker vocabulary (grounded in this repo's own real corpus, not invented — see
// docs/plans/qa14-marker-redesign-phase1-2026-09-11.md §4/§5.2): `Issue(s)`, `Closes`, `Closed`,
// `Fixes`, `Fixed`, `Resolves` (word-adjacent, same line, optional whitespace before `#`), and the
// glued shorthand `GH#N`/`GH-#N`. `owner/repo#N` and `Milestone #N` are their own kinds, unaffected.
//
// Word-adjacent markers, case-insensitive, same-line, optional whitespace before "#":
//   Issue(s), Closes, Closed, Fixes, Fixed, Resolves
const CITATION_MARKER_WORD_RE = /\b(?:issues?|closes|closed|fixes|fixed|resolves)[ \t]*$/i;
// Glued marker (no whitespace), case-insensitive: "GH#N", "GH-#N" (this comment deliberately
// avoids a real digit here — this checker, run against its own source, would otherwise try to
// verify it as a real issue citation; see the dogfood note in this file's own header).
const GH_MARKER_RE = /\bGH-?$/i;
// List continuation: once a #N carries a real marker, a later #N in the SAME list inherits it
// when only punctuation/connector separates them — comma, slash, "and", "&", or whitespace
// (shapes this repo's own review reports use, e.g. "Issues #N, #N" or "#N and #N"). No word may
// intervene (a genuinely new sentence breaks continuation, same as the old ordinal-list guard).
// Real digit examples deliberately avoided here — see this file's own header dogfood note.
const LIST_CONTINUATION_RE = /^(?:[ \t,/&]|and)*$/i;
// Round-1-fix-now round (GitHub issue 154, red-team's own dash-with-surrounding-spaces repro,
// where a marked citation is directly followed by " - " then an unrelated ordinal-shaped number):
// the hyphen/en-dash/em-dash range separator is handled SEPARATELY from the class above, and
// deliberately TIGHT (no surrounding whitespace) — grepping this repo's own real corpus
// (docs/decisions.md, docs/STATE.md, docs/REVIEW_LOG.md, docs/reviews/*.md, CHANGELOG.md) for
// every real dash-joined citation-range pair found every single one written with NO space around
// the dash (a tight "Issue-range-Issue" shape, e.g. this file's own header dogfood note style),
// never a space-padded dash — a space-padded dash is, in this repo's real usage, an ordinary
// sentence dash separating two unrelated clauses far more often than a genuine range. Restricting
// the dash form to its actually-observed tight shape closes that leak on real input without
// reintroducing a word denylist (which is exactly the failure mode this whole redesign exists to
// eliminate — see the header comment above CITATION_MARKER_WORD_RE). Real digit/dash examples
// deliberately avoided here — see this file's own header dogfood note.
const TIGHT_DASH_CONTINUATION_RE = /^[–—-]$/;
// Honest, disclosed residual (GitHub issue 154, kept open, not silently claimed fixed): a
// COMMA/whitespace-joined continuation (the class above) cannot be narrowed the same way — this
// repo's own real comma-joined citation lists genuinely do carry surrounding whitespace (a marked
// citation, comma, space, next number), so a comma-adjacent hex-shaped or ordinal-shaped token
// immediately after a real marker still inherits marked status today.
//
// STRUCTURAL NOTE (round-3 fix-now, 2026-09-11, `docs/decisions.md`'s round-3 row): rounds 1 and 2
// each froze an exact "N of M" occurrence count into this comment, and each was already stale by
// the commit that shipped it — the corpus this residual is measured against is this repo's whole
// tracked tree, which changes on nearly every commit (including the review report that measured
// the prior figure). An exact count is therefore not a fact that stays true here; it is described
// qualitatively instead, and these qualities ARE stable:
//   - real and non-zero — not eliminated by this round's design;
//   - small relative to the continuation-marked population (single-digit percent, every
//     measurement to date, none of which are repeated here — see below);
//   - fails LOUD, never silent — every instance surfaces as a blocking `unresolved-authority` in
//     the real gate run, never a false-verify;
//   - the CURRENT count is whatever `node src/qa/continuation-residual-probe.ts --field=continuation-marked`
//     (denominator, pure/fast) and `--field=continuation-residual` (numerator, real `gh`-backed
//     leak count) report right now — run them for the live numbers. (Council fix-now round 4,
//     2026-09-11: the plain gate command previously pointed at here — `node
//     src/qa/reference-resolver.ts <base> <head>` — does not isolate this residual's own count at
//     all; it folds every failure reason, path/ADR/cross-repo/this-residual alike, into one
//     undifferentiated total, per architecture-reviewer's own independent reproduction. The two
//     `continuation-residual-probe.ts` commands above are the real, committed, isolated
//     replacement.) A number written here, or in any other permanently-rescanned file, is not
//     trustworthy the moment the corpus moves; only a dated `docs/reviews/` report (point-in-time
//     by this project's own convention, and so allowed to go stale) may state one.
// Closing it fully still requires either a word list (reintroducing the exact denylist failure
// mode R3-R6 eliminated) or dropping comma continuation entirely (silently un-verifying every
// genuine comma-joined citation list — the far larger and silent harm) — so it stays open,
// disclosed, pinned by a regression test, not fixed in code. Any "never"/"0 occurrences"/"N of M"
// claim about this residual's SIZE must not be typed into a permanently-rescanned file — this
// project has now had to correct a frozen count of this exact residual on this file four rounds
// running, including once where the "corrected" figure was itself already stale at the commit that
// shipped it. Real digit examples deliberately avoided here — see this file's own header dogfood
// note.
function isListContinuationGap(between: string): boolean {
  return LIST_CONTINUATION_RE.test(between) || TIGHT_DASH_CONTINUATION_RE.test(between);
}
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
    const [, citedPath, lineStr] = pl;
    if (!citedPath) return null;
    let path = citedPath;
    if (!deps.pathExists(path)) {
      // Basename-index fallback (GitHub issue 137, R1) — ONLY here, ONLY for a cited segment with no `/`
      // (a real repo-relative path attempt that already contains a `/` gets no such fallback: if
      // that specific path doesn't exist, it doesn't exist, no guessing). `deps.findByBasename` is
      // the only new call on this path — no direct `existsSync`/`readFileSync` is added here; the
      // matched path (if any) still goes through `deps.lineCount` below, same as `path` always did.
      if (citedPath.includes("/")) {
        return { raw, kind: "path-line", verdict: "unresolved-authority", reason: `${citedPath} does not exist` };
      }
      const matches = deps.findByBasename(citedPath);
      if (matches.length === 0) {
        return { raw, kind: "path-line", verdict: "unresolved-authority", reason: `${citedPath} does not exist` };
      }
      if (matches.length > 1) {
        return {
          raw,
          kind: "path-line",
          verdict: "unresolved-authority",
          reason: `${citedPath} matches ${matches.length} files by basename in this repository — ambiguous, fails closed rather than guessing which one`,
        };
      }
      path = matches[0]!;
    }
    const total = deps.lineCount(path);
    const line = Number(lineStr);
    if (total !== null && line > total) {
      return { raw, kind: "path-line", verdict: "unresolved-authority", reason: `${path} has ${total} lines, cited line ${line} is out of range` };
    }
    return {
      raw,
      kind: "path-line",
      verdict: "resolved",
      reason: path === citedPath ? "path and line both resolve" : `resolved via basename match: ${citedPath} -> ${path}`,
    };
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

interface MarkedListGuardState {
  /** End index (in `text`) of the most recently MARKED citation's match, or -1. */
  lastMarkedListEnd: number;
}

type BareHashClassification = "already-recorded" | "marked-direct" | "marked-continuation" | "unmarked";

/**
 * Classifies a BARE (non-cross-repo) `#N` candidate match into exactly one of three buckets.
 * Same-line only (does not cross a `\n`). In order:
 *
 * (a) "already-recorded" — immediately preceded by "Issue"/"Milestone": already recorded by that
 *     word-form pass above, this bare match is the same citation seen a second time (round-2
 *     guard, GitHub issue 139) — skip it entirely, don't re-record, don't mark unclassified.
 *     Round-1-fix-now round (GitHub issue 153): this branch itself IS a marker (the word
 *     "Issue"/"Milestone" precedes it, same as any other marker word) so it must seed
 *     `state.lastMarkedListEnd` too — previously it returned without doing so, which meant a
 *     singular "Issue #A, #B" never opened list continuation for `#B` while the plural
 *     "Issues #A, #B" (which takes branch (b) below, via `CITATION_MARKER_WORD_RE`'s `issues?`
 *     alternation) did. Both forms now seed continuation identically.
 * (b) "marked-direct" — immediately preceded by an explicit citation marker word
 *     (`CITATION_MARKER_WORD_RE`: Issue(s)/Closes/Closed/Fixes/Fixed/Resolves) or the glued
 *     `GH`/`GH-` shorthand (`GH_MARKER_RE`) — a real citation, goes through `classifyIssue` as
 *     before. Surfaced on the resulting `Citation` as `markedVia: "direct"`.
 * (c) "marked-continuation" — via LIST CONTINUATION of (a) or (b) — "Closes #N, #N, #N" (or the
 *     slash-joined "#N/#N" shorthand, or a TIGHT hyphen/en-dash/em-dash range "#N-#N", this repo's
 *     own review reports also use) only has the marker word in front of the FIRST number; every
 *     later number in the same list is separated from the marked item before it only by
 *     punctuation (comma, slash, "and", `&`, a tight dash-range separator, or whitespace), never
 *     by a new word, so it inherits the same marked status. See `isListContinuationGap` for the
 *     tight-dash rationale (GitHub issue 154). Surfaced on the resulting `Citation` as
 *     `markedVia: "continuation"` (council fix-now round 4, 2026-09-11 — this distinction used to
 *     be computed here and immediately discarded; see `Citation.markedVia`'s own doc comment).
 * (d) "unmarked" — none of the above: no explicit marker anywhere in reach. Reported as a loud,
 *     non-blocking `unclassified` citation by the caller — never silently resolved, never silently
 *     dropped (2026-09-11 marker redesign; see the header comment above `CITATION_MARKER_WORD_RE`).
 *
 * Mutates `state.lastMarkedListEnd` so a later match can detect list continuation (c).
 */
function classifyBareHashMatch(text: string, idx: number, matchLength: number, state: MarkedListGuardState): BareHashClassification {
  const lineStart = text.lastIndexOf("\n", idx - 1) + 1;
  const sameLineBefore = text.slice(lineStart, idx);

  if (/\b(?:issue|milestone)[ \t]*$/i.test(sameLineBefore)) {
    state.lastMarkedListEnd = idx + matchLength;
    return "already-recorded";
  }
  if (CITATION_MARKER_WORD_RE.test(sameLineBefore) || GH_MARKER_RE.test(sameLineBefore)) {
    state.lastMarkedListEnd = idx + matchLength;
    return "marked-direct";
  }
  const between = state.lastMarkedListEnd >= 0 ? text.slice(state.lastMarkedListEnd, idx) : null;
  if (between !== null && isListContinuationGap(between)) {
    state.lastMarkedListEnd = idx + matchLength;
    return "marked-continuation";
  }
  state.lastMarkedListEnd = -1;
  return "unmarked";
}

/** Scans `text` for every citation-shaped candidate and classifies each. Pure — no I/O. */
export function scanReferences(text: string, deps: ReferenceResolverDeps): Citation[] {
  const citations: Citation[] = [];
  // Round-1-fix-now round (GitHub issue 152, HIGH): dedup keyed on the raw string alone used to
  // let an UNMARKED bare #N occurrence take the slot first and permanently shadow a later real
  // marked "Closes/Fixes #N" citation of the identical raw string — the marked occurrence's real
  // classification (against issueExists/gh) was silently never reached at all. Fixed by keeping
  // the index of each raw string's recorded Citation (not just a presence Set) so a later MARKED
  // occurrence can find and UPGRADE an already-recorded, still-unmarked "issue-candidate" entry in
  // place — a marked classification always wins over an unmarked one for the same raw string,
  // regardless of which occurrence the scan reaches first. The reverse never happens: an unmarked
  // occurrence never downgrades an already-recorded real classification.
  const seen = new Map<string, number>();
  const markedListState: MarkedListGuardState = { lastMarkedListEnd: -1 };

  function record(raw: string, classify: () => Citation): void {
    if (seen.has(raw)) return;
    seen.set(raw, citations.length);
    citations.push(classify());
  }

  /**
   * Like `record`, but for the bare (non-cross-repo) `#N` population only: when `raw` was already
   * recorded as an unmarked `"issue-candidate"` and THIS occurrence is marked, replace the
   * existing entry with the real classification instead of silently keeping the shadow.
   */
  function recordBareHash(raw: string, classify: () => Citation, isMarked: boolean): void {
    const existingIndex = seen.get(raw);
    if (existingIndex === undefined) {
      seen.set(raw, citations.length);
      citations.push(classify());
      return;
    }
    if (isMarked) {
      const existing = citations[existingIndex];
      if (existing && existing.kind === "issue-candidate") {
        citations[existingIndex] = classify();
      }
    }
  }

  for (const m of text.matchAll(ADR_CANDIDATE_RE)) {
    record(m[0], () => classifyAdr(m[0], deps));
  }
  for (const m of text.matchAll(ISSUE_WORD_CANDIDATE_RE)) {
    const normalized = m[0].replace(/\s+/g, "");
    // Word-form "Issue #N" is itself an explicit, same-occurrence marker — always direct, never a
    // continuation inheritance (this loop has no list-continuation state of its own).
    record(normalized, () => ({ ...classifyIssue(normalized, deps), markedVia: "direct" as const }));
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
    const raw = m[0];
    // Round-3 fix (GitHub issue 143, finding NEW-3): the cross-repo `owner/repo#N` shape must
    // NEVER go through `classifyBareHashMatch` — that function's premise only holds for the BARE
    // `#N` alternative. `ISSUE_WORD_CANDIDATE_RE` (`/\bIssue\s*#\d+/gi`) cannot match across an
    // intervening `owner/repo` slug, so "Issue owner/repo#N" would otherwise be silently dropped
    // entirely: never recorded by the word-form pass (nothing there to match it) AND skipped here
    // (wrongly assumed already recorded). Detected structurally (the match itself contains `/`),
    // not by re-deriving the cross-repo regex.
    if (raw.includes("/")) {
      record(raw, () => classifyIssue(raw, deps));
      continue;
    }
    const classification = classifyBareHashMatch(text, idx, raw.length, markedListState);
    if (classification === "already-recorded") continue;
    if (classification === "marked-direct" || classification === "marked-continuation") {
      // markedVia (council fix-now round 4, 2026-09-11): surfaces `classifyBareHashMatch`'s own
      // direct-vs-continuation distinction on the emitted Citation instead of discarding it — see
      // `Citation.markedVia`'s doc comment for why.
      const markedVia: "direct" | "continuation" = classification === "marked-direct" ? "direct" : "continuation";
      recordBareHash(raw, () => ({ ...classifyIssue(raw, deps), markedVia }), true);
      continue;
    }
    // "unmarked" (2026-09-11 marker redesign): no explicit citation marker precedes this bare #N
    // on the same line/list — reported as a loud, non-blocking `unclassified` candidate, never
    // silently resolved and never silently dropped (R3/R4/R5/R6, docs/decisions.md 2026-09-11 row
    // 61). `verifyLocalIssue`/`issueExists`/`gh` are never invoked for an unmarked candidate.
    recordBareHash(
      raw,
      () => ({
        raw,
        kind: "issue-candidate",
        verdict: "unclassified",
        reason:
          "no explicit citation marker (Issue(s)/Closes/Fixes/Resolves/Closed/Fixed/GH/owner-repo) precedes this bare #N on the same line — not verified as a real issue citation, not silently treated as ordinary prose either",
      }),
      false,
    );
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

  // 2026-09-11 marker redesign (docs/decisions.md row 61 point (1)): "unclassified" is a
  // deliberately NON-BLOCKING verdict — it never flips `ok` to `false` by itself, but it is always
  // printed in `details` and always counted in `summary`, on both PASS and FAIL runs, so it is
  // never buried the way a silently-skipped or silently-resolved bare `#N` would be.
  const bad = citations.filter((c) => c.verdict !== "resolved" && c.verdict !== "unclassified");
  const unclassified = citations.filter((c) => c.verdict === "unclassified");
  const where = (c: Citation): string => (c.file === undefined ? "" : ` [file: ${c.file}]`);
  const details = [
    ...bad.map((c) => `[${c.verdict}] ${c.raw} — ${c.reason}${where(c)}`),
    ...unclassified.map((c) => `[unclassified] ${c.raw} — ${c.reason}${where(c)}`),
  ];

  if (bad.length > 0) {
    const summary =
      unclassified.length > 0
        ? `${bad.length} of ${citations.length} citation(s) failed to resolve; ${unclassified.length} more unclassified (non-blocking).`
        : `${bad.length} of ${citations.length} citation(s) failed to resolve.`;
    return { ok: false, vacuous: false, summary, details };
  }

  const resolvedCount = citations.length - unclassified.length;
  const summary =
    unclassified.length > 0
      ? `${citations.length} citation(s): ${resolvedCount} resolved, ${unclassified.length} unclassified (non-blocking, no explicit citation marker) — 0 failed.`
      : `${citations.length} citation(s), all resolved.`;
  return { ok: true, vacuous: false, summary, details };
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
//
// Round-3 fix (GitHub issue 143, finding NEW-5): the override was previously read as `Number(env ?? 300)` with
// no validation. A malformed `QA14_MAX_ISSUES` (a typo, non-numeric text) produced `NaN`, and
// `size > NaN` is always `false` — the cap this comment describes would have silently never
// fired, the exact silent-degradation failure mode it exists to prevent. An empty-string override
// (how GitHub Actions renders an unset `vars.X`/`secrets.X` interpolation) produced `0`, failing
// the cap shut on every run instead. `parseMaxDistinctIssues` accepts the override only when it
// parses to a finite positive integer, and falls back to `fallback` with a loud console warning
// otherwise — exported so this parsing behavior is unit-tested directly, without needing to
// mutate `process.env` and re-import this module.
export function parseMaxDistinctIssues(rawEnvValue: string | undefined, fallback = 300): number {
  if (rawEnvValue === undefined) return fallback;
  const n = Number(rawEnvValue);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    console.warn(
      `[QA-14 reference-resolver] WARNING: QA14_MAX_ISSUES="${rawEnvValue}" is not a positive ` +
        `integer — falling back to the default cap of ${fallback}. (A malformed value must never ` +
        `silently disable or silently over-tighten this rate-limit cap.)`,
    );
    return fallback;
  }
  return n;
}
export const DEFAULT_MAX_DISTINCT_ISSUES = parseMaxDistinctIssues(process.env.QA14_MAX_ISSUES);

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
  for (const [file, text] of fileTexts) {
    citations.push(...scanReferences(text, realDeps).map((c) => ({ ...c, file })));
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

  // Basename index (GitHub issue 137, R1): one single repo-tree walk, reused across every query —
  // never re-walked per citation. Same `node_modules`/`.git` exclusion `listFilesRecursive` already
  // applies for the ADR catalog above.
  const allRepoFiles = await listFilesRecursive(repoRoot, () => true);
  const basenameIndex = new Map<string, string[]>();
  for (const f of allRepoFiles) {
    const base = f.split("/").pop() ?? f;
    const existing = basenameIndex.get(base);
    if (existing) {
      existing.push(f);
    } else {
      basenameIndex.set(base, [f]);
    }
  }

  const baseDeps: Omit<ReferenceResolverDeps, "issueExists"> = {
    pathExists: (p) => {
      const resolved = resolveWithinRepo(repoRoot, p);
      return resolved !== null && existsSync(resolved);
    },
    findByBasename: (basename) => basenameIndex.get(basename) ?? [],
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
  // Which TEXT of each changed file is scanned (whole file, or only what the diff adds for an
  // append-only record) is decided in reference-scope.ts; see its header for the rules.
  const fileTexts = await buildScanTexts(changedFiles, resolved.fullTreeFallback, {
    diffText: () => git.diffText(base, head),
    readFile: async (file) => {
      const abs = resolve(repoRoot, file);
      return existsSync(abs) ? readFile(abs, "utf8") : null; // deleted file, nothing to scan
    },
    shouldScan: shouldScanFile,
  });

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
