import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve as pathResolve } from "node:path";
import type { Citation, ReferenceResolverDeps } from "./reference-resolver.ts";
import {
  checkIssueViaGh,
  parseMaxDistinctIssues,
  resolveIssueCitations,
  resolveWithinRepo,
  scanReferences,
  shouldScanFile,
  summarizeCitations,
} from "./reference-resolver.ts";
import type { Runner } from "../lib/exec.ts";
import { makeGitOps, resolveChangedFiles } from "../lib/git.ts";

function deps(overrides: Partial<ReferenceResolverDeps> = {}): ReferenceResolverDeps {
  return {
    pathExists: () => true,
    lineCount: () => 100,
    knownAdrIds: new Set(["ADR-0021"]),
    issueExists: () => true,
    repoSlug: "mohannadrabie/thoth",
    ...overrides,
  };
}

test("QA-14: no citations -> vacuous pass", () => {
  const result = summarizeCitations(scanReferences("plain prose, nothing to cite", deps()));
  assert.equal(result.ok, true);
  assert.equal(result.vacuous, true);
});

test("QA-14: a valid, known ADR id resolves", () => {
  const citations = scanReferences("See ADR-0021 for the shape.", deps());
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.verdict, "resolved");
});

test("QA-14: a citation to a nonexistent ADR authority FAILS (non-optional shape)", () => {
  const citations = scanReferences("See ADR-9999 for the shape.", deps());
  assert.equal(citations[0]?.verdict, "unresolved-authority");
  const result = summarizeCitations(citations);
  assert.equal(result.ok, false);
});

test("QA-14: a malformed ADR id (wrong digit count) is UNPARSEABLE, not silently skipped", () => {
  const citations = scanReferences("See ADR-12 for the shape.", deps());
  assert.equal(citations[0]?.verdict, "unparseable");
  const result = summarizeCitations(citations);
  assert.equal(result.ok, false, "unparseable must fail closed, never silently pass");
});

test("QA-14: a cross-repo Issue number FAILS (non-optional shape)", () => {
  const citations = scanReferences("Fixed in other-org/other-repo#42.", deps());
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.verdict, "cross-repo-issue");
  const result = summarizeCitations(citations);
  assert.equal(result.ok, false);
});

test("QA-14: same-repo explicit slug Issue citation resolves normally", () => {
  const citations = scanReferences("See mohannadrabie/thoth#7.", deps({ issueExists: () => true }));
  assert.equal(citations[0]?.verdict, "resolved");
});

test("QA-14: a local 'Issue #N' citation resolves when the injected resolver confirms it exists", () => {
  const citations = scanReferences("Fixed Issue #7 in this repo.", deps({ issueExists: (n) => n === 7 }));
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.verdict, "resolved");
});

test("QA-14: a local Issue citation the resolver cannot verify FAILS CLOSED, not silently passed", () => {
  const citations = scanReferences("Fixed Issue #7 in this repo.", deps({ issueExists: () => null }));
  assert.equal(citations[0]?.verdict, "unresolved-authority");
  assert.match(citations[0]?.reason ?? "", /cannot verify/);
});

test("QA-14: a local Issue number that does not exist FAILS", () => {
  const citations = scanReferences("Fixed Issue #999 in this repo.", deps({ issueExists: () => false }));
  assert.equal(citations[0]?.verdict, "unresolved-authority");
});

test("QA-14: a backtick-quoted path that exists resolves", () => {
  const citations = scanReferences("See `docs/reviews/report.md` for details.", deps({ pathExists: () => true }));
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.verdict, "resolved");
  assert.equal(citations[0]?.kind, "path");
});

test("QA-14: a backtick-quoted path that does not exist FAILS", () => {
  const citations = scanReferences("See `docs/reviews/missing.md` for details.", deps({ pathExists: () => false }));
  assert.equal(citations[0]?.verdict, "unresolved-authority");
});

test("QA-14: a path:line citation within bounds resolves", () => {
  const citations = scanReferences("See `src/foo.ts:42` for the bug.", deps({ pathExists: () => true, lineCount: () => 100 }));
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.kind, "path-line");
  assert.equal(citations[0]?.verdict, "resolved");
});

test("QA-14: a path:line citation past the file's own line count FAILS", () => {
  const citations = scanReferences("See `src/foo.ts:9999` for the bug.", deps({ pathExists: () => true, lineCount: () => 50 }));
  assert.equal(citations[0]?.verdict, "unresolved-authority");
  assert.match(citations[0]?.reason ?? "", /out of range/);
});

test("QA-14: duplicate citations in the same text are deduped, not double-reported", () => {
  const citations = scanReferences("ADR-0021 ... later again ADR-0021.", deps());
  assert.equal(citations.length, 1);
});

test("QA-14: *.test.ts files are exempt from scanning — they hold the checker's own fake-citation fixtures", () => {
  assert.equal(shouldScanFile("src/qa/reference-resolver.test.ts"), false);
  assert.equal(shouldScanFile("src/qa/reference-resolver.ts"), true);
  assert.equal(shouldScanFile("docs/STATE.md"), true);
});

test("QA-14 (dogfood): this checker's own source, run against itself, resolves clean (no self-inflicted false positive)", async () => {
  const { readFile } = await import("node:fs/promises");
  const { listFilesRecursive } = await import("../lib/fs-walk.ts");
  const { existsSync, readFileSync } = await import("node:fs");
  const adrFiles = [
    ...(await listFilesRecursive("adr/devops", (p) => /^\d{4}-.*\.md$/.test(p.split("/").pop() ?? ""))),
    ...(await listFilesRecursive("adr/software-engineering", (p) => /^\d{4}-.*\.md$/.test(p.split("/").pop() ?? ""))),
  ];
  const knownAdrIds = new Set(adrFiles.map((f) => `ADR-${(f.split("/").pop() ?? "").slice(0, 4)}`));
  const realDeps: ReferenceResolverDeps = {
    pathExists: (p) => existsSync(p),
    lineCount: (p) => {
      try {
        return readFileSync(p, "utf8").split("\n").length;
      } catch {
        return null;
      }
    },
    knownAdrIds,
    issueExists: () => null,
    repoSlug: "mohannadrabie/thoth",
  };
  const text = await readFile("src/qa/reference-resolver.ts", "utf8");
  const citations = scanReferences(text, realDeps);
  const bad = citations.filter((c) => c.verdict !== "resolved");
  assert.deepEqual(bad, [], `expected no unresolved citations in this file's own source, found: ${JSON.stringify(bad)}`);
});

test("QA-14: mixed valid and invalid citations -> FAIL names only the bad ones", () => {
  const citations = scanReferences("ADR-0021 is fine but ADR-9999 is not, and other/repo#1 is cross-repo.", deps());
  const result = summarizeCitations(citations);
  assert.equal(result.ok, false);
  assert.equal(result.details.length, 2);
});

test("QA-14 (regression, Issue #18 recurrence): a zero-SHA base ref falls back to a full-tree scan, never a silent vacuous pass", async () => {
  const runner: Runner = (cmd, args) => {
    if (args[0] === "diff") {
      throw new Error("git diff must never be attempted when base/head is the zero-SHA sentinel");
    }
    if (args[0] === "ls-tree") {
      return Promise.resolve({ stdout: "100644 blob aaa\tdocs/STATE.md\n", stderr: "", code: 0 });
    }
    return Promise.resolve({ stdout: "", stderr: "", code: 0 });
  };
  const git = makeGitOps(runner, ".");
  const resolved = await resolveChangedFiles(git, "0".repeat(40), "HEAD");
  assert.notEqual(resolved, null);
  assert.equal(resolved?.fullTreeFallback, true);
  assert.deepEqual(resolved?.changedFiles, ["docs/STATE.md"]);
});

test("QA-14 (regression, app-security SUSPICION): a `../../`-style citation path resolves to null (rejected), never probed outside repoRoot", () => {
  const repoRoot = pathResolve("/repo-root-fixture");
  assert.equal(resolveWithinRepo(repoRoot, "../../etc/passwd"), null);
  assert.equal(resolveWithinRepo(repoRoot, "../../../secrets/config.json"), null);
  // A well-behaved, contained citation still resolves normally — the fix must not over-reject.
  assert.equal(resolveWithinRepo(repoRoot, "docs/STATE.md"), pathResolve(repoRoot, "docs/STATE.md"));
  assert.equal(resolveWithinRepo(repoRoot, "."), repoRoot);
});

// QA-14 Issue #120 fix: real credential-backed issue-existence lookup via `checkIssueViaGh`. Every
// case below uses a fake `Runner` — no real `gh`/network call in this suite (matching
// completeness-claim-checker.test.ts's own `verifyMarkerClaim(claim, runner)` fake-Runner style).

test("QA-14 (Issue #120): checkIssueViaGh returns null immediately when repoSlug is null, never calling the runner", async () => {
  const runner: Runner = () => {
    throw new Error("must not be called when repoSlug is null");
  };
  const result = await checkIssueViaGh(7, null, runner);
  assert.equal(result, null);
});

test("QA-14 (Issue #120): checkIssueViaGh returns true when gh exits 0 with parseable {state} JSON (issue exists)", async () => {
  const runner: Runner = (cmd, args) => {
    assert.equal(cmd, "gh");
    assert.deepEqual(args, ["issue", "view", "120", "--repo", "mohannadrabie/thoth", "--json", "state"]);
    return Promise.resolve({ stdout: '{"state":"OPEN"}', stderr: "", code: 0 });
  };
  const result = await checkIssueViaGh(120, "mohannadrabie/thoth", runner);
  assert.equal(result, true);
});

test("QA-14 (Issue #120): checkIssueViaGh returns false on gh's documented not-found message (issue does not exist)", async () => {
  const runner: Runner = () =>
    Promise.resolve({
      stdout: "",
      stderr: "GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)",
      code: 1,
    });
  const result = await checkIssueViaGh(999999, "mohannadrabie/thoth", runner);
  assert.equal(result, false);
});

test("QA-14 (Issue #120): checkIssueViaGh returns null on an auth failure (fails closed, not a false negative)", async () => {
  const runner: Runner = () =>
    Promise.resolve({ stdout: "", stderr: "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.", code: 1 });
  const result = await checkIssueViaGh(120, "mohannadrabie/thoth", runner);
  assert.equal(result, null);
});

test("QA-14 (Issue #120): checkIssueViaGh returns null on a network failure / timeout (fails closed)", async () => {
  // `realRunner` (src/lib/exec.ts) never throws — a subprocess timeout or network failure surfaces
  // as a non-zero exit with no matching not-found stderr shape, so that's the realistic fake here.
  const timeoutRunner: Runner = () => Promise.resolve({ stdout: "", stderr: "", code: 124 });
  const result = await checkIssueViaGh(120, "mohannadrabie/thoth", timeoutRunner);
  assert.equal(result, null);
});

test("QA-14 (Issue #120): checkIssueViaGh returns null when gh exits 0 but stdout is unparseable (inconclusive, fails closed)", async () => {
  const runner: Runner = () => Promise.resolve({ stdout: "not json", stderr: "", code: 0 });
  const result = await checkIssueViaGh(120, "mohannadrabie/thoth", runner);
  assert.equal(result, null);
});

// --- Issue #139 (round 2, red-team no-go): ISSUE_CANDIDATE_RE's leading `\b` sat in front of an
// OPTIONAL group, so it could only match immediately before `#` when the PRECEDING character was
// a word character — every real citation form this repo actually uses ("Closes #N", "(#N)", a
// line-start "#N", "Milestone #N") was silently never classified at all. These pin the fix.

test("QA-14 (Issue #139): a 'Closes #N' citation reaches classification, not silently skipped", () => {
  const citations = scanReferences("Closes #120 in this changelog entry.", deps({ issueExists: () => true }));
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.raw, "#120");
  assert.equal(citations[0]?.verdict, "resolved");
});

// AMENDED 2026-09-11 (QA-14 marker redesign, docs/plans/qa14-marker-redesign-phase1-2026-09-11.md
// §5.1): this is a DELIBERATE, ruled behavior change, not silent test-doctoring. §5.1 measured that
// ~73% of this repo's own bare-#N occurrences carry no explicit marker, and that a bare, unmarked
// `#N` — parenthesized or not — is structurally indistinguishable from an ordinal false positive
// ("Two findings (#1, #2)" vs. "findings (#118, #119)" are byte-identical in shape). Asserting
// "resolved" for an unmarked bare citation was never actually safe; this now asserts the honest,
// non-blocking "unclassified" instead of guessing in either direction. Originally asserted
// `verdict: "resolved"` (Issue #139, round 2).
test("QA-14 (Issue #139, AMENDED 2026-09-11 marker redesign): a parenthetical '(#N)' citation with NO explicit marker is unclassified, not silently resolved", () => {
  const citations = scanReferences("A parenthetical reference (#120) mid-sentence.", deps({ issueExists: () => true }));
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.raw, "#120");
  assert.equal(citations[0]?.verdict, "unclassified");
  assert.equal(citations[0]?.kind, "issue-candidate");
});

// AMENDED 2026-09-11 (QA-14 marker redesign) — same rationale as the parenthetical case above: a
// bare line-start `#N` carries no explicit marker either, so it is now `unclassified`, not
// silently `resolved`. Originally asserted `verdict: "resolved"` (Issue #139, round 2).
test("QA-14 (Issue #139, AMENDED 2026-09-11 marker redesign): a line-start '#N' citation with NO explicit marker is unclassified, not silently resolved", () => {
  const citations = scanReferences("#120 is the first thing on this line.", deps({ issueExists: () => true }));
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.raw, "#120");
  assert.equal(citations[0]?.verdict, "unclassified");
  assert.equal(citations[0]?.kind, "issue-candidate");
});

test("QA-14 (Issue #139): the owner/repo#N cross-repo shape still resolves correctly (already worked, must not regress)", () => {
  const citations = scanReferences("Fixed in owner/repo#120 upstream.", deps({ repoSlug: "mohannadrabie/thoth" }));
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.raw, "owner/repo#120");
  assert.equal(citations[0]?.verdict, "cross-repo-issue");
});

test("QA-14 (Issue #139): a word-glued bare citation ('GH#57'-style shorthand this repo's own reviewers have used) still resolves via its trailing #N, not lost by the fix", () => {
  const citations = scanReferences("GH#57 shorthand.", deps({ issueExists: (n) => n === 57 }));
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.raw, "#57");
  assert.equal(citations[0]?.verdict, "resolved");
});

test("QA-14 (Issue #139): a 'Milestone #N' citation is recognized as its own kind — captured, not silently dropped, and NOT misclassified as an Issue citation of the same number (a different GitHub namespace)", () => {
  const citations = scanReferences(
    "See Milestone #23 for the plan.",
    deps({
      issueExists: () => {
        throw new Error("must not query issueExists for a milestone number — different namespace");
      },
    }),
  );
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.kind, "milestone");
  assert.equal(citations[0]?.verdict, "resolved");
});

test("QA-14 (Issue #139, no new false positive): a mixed-alphanumeric CSS hex color literal is never torn into a bogus digit-prefix citation", () => {
  const citations = scanReferences("--bg:#0f1115; --panel:#171a21; --accent:#5b8cff;", deps());
  assert.equal(citations.length, 0);
});

// --- Issue #140 (round 2): the two-pass wiring in `main()` had zero test coverage of its own —
// only `checkIssueViaGh` was unit-tested in isolation. These exercise the real, exported
// `resolveIssueCitations` wiring end-to-end with a fake `Runner`.

function wiringBaseDeps(): Omit<ReferenceResolverDeps, "issueExists"> {
  return {
    pathExists: () => true,
    lineCount: () => 100,
    knownAdrIds: new Set(),
    repoSlug: "mohannadrabie/thoth",
  };
}

test("QA-14 (Issue #140): resolveIssueCitations' real end-to-end wiring rejects a fabricated issue citation, not just checkIssueViaGh in isolation", async () => {
  const fileTexts = new Map([["docs/example.md", "Closes #999999 in this repo."]]);
  const runner: Runner = () =>
    Promise.resolve({
      stdout: "",
      stderr: "GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)",
      code: 1,
    });
  const { citations, capExceeded } = await resolveIssueCitations(fileTexts, wiringBaseDeps(), "mohannadrabie/thoth", runner);
  assert.equal(capExceeded, false);
  const result = summarizeCitations(citations);
  assert.equal(result.ok, false, "a fabricated issue citation must fail the real end-to-end wiring, not just checkIssueViaGh in isolation");
  assert.match(result.details.join(" "), /does not exist/);
});

test("QA-14 (Issue #140): resolveIssueCitations' real end-to-end wiring PASSES a genuinely-existing issue citation (the positive control for the test above)", async () => {
  const fileTexts = new Map([["docs/example.md", "Closes #120 in this repo."]]);
  const runner: Runner = () => Promise.resolve({ stdout: '{"state":"OPEN"}', stderr: "", code: 0 });
  const { citations } = await resolveIssueCitations(fileTexts, wiringBaseDeps(), "mohannadrabie/thoth", runner);
  const result = summarizeCitations(citations);
  assert.equal(result.ok, true);
});

// --- Issue #141 (round 2): unbatched, uncached, uncapped `gh` calls risk exhausting GITHUB_TOKEN's
// ~1,000/hr/repo budget, degrading straight back into the "cannot verify" nulls this story exists
// to eliminate. These confirm the cap fails loud, and that the existing in-memory cache really
// dedupes (not just claimed) rather than issuing one call per citation OCCURRENCE.

test("QA-14 (Issue #141): resolveIssueCitations enforces the maxDistinctIssues cap loudly, spending ZERO gh calls once exceeded", async () => {
  const fileTexts = new Map([["docs/example.md", "Closes #1, #2, and #3 all in one file."]]);
  let calls = 0;
  const runner: Runner = () => {
    calls++;
    return Promise.resolve({ stdout: '{"state":"OPEN"}', stderr: "", code: 0 });
  };
  const result = await resolveIssueCitations(fileTexts, wiringBaseDeps(), "mohannadrabie/thoth", runner, 2);
  assert.equal(result.capExceeded, true);
  assert.equal(result.distinctIssueNumbers, 3);
  assert.equal(calls, 0, "no gh call should run once the cap is exceeded — fail loud before spending any of the rate-limit budget");
  assert.equal(result.citations.length, 0);
});

// AMENDED 2026-09-11 (QA-14 marker redesign, docs/plans/qa14-marker-redesign-phase1-2026-09-11.md
// §5.1): docs/b.md's text was originally a bare, unmarked "#7" ("And once more, #7, in a second
// file."), relying on the pre-redesign assumption that any bare #N resolves. Under this redesign
// that shape is `unclassified` (see the two AMENDED Issue #139 tests above), which is correct but
// no longer exercises this test's actual purpose (Issue #141: the in-memory `gh` cache dedupes a
// number cited across multiple FILES). Reworded to carry an explicit marker so the dedup path this
// test targets is still genuinely exercised end-to-end. Same already-ruled principle as the two
// named amendments above, applied here to a third occurrence found during this round's own build
// verification — not a new design decision.
test("QA-14 (Issue #141): the same issue number cited multiple times, across multiple files, triggers exactly ONE gh call — the in-memory cache dedup is real, not just claimed", async () => {
  const fileTexts = new Map([
    ["docs/a.md", "Closes #7. Also see #7 again in the same file."],
    ["docs/b.md", "Fixes #7 in a second file."],
  ]);
  let calls = 0;
  const runner: Runner = (_cmd, args) => {
    calls++;
    assert.deepEqual(args, ["issue", "view", "7", "--repo", "mohannadrabie/thoth", "--json", "state"]);
    return Promise.resolve({ stdout: '{"state":"OPEN"}', stderr: "", code: 0 });
  };
  const { citations } = await resolveIssueCitations(fileTexts, wiringBaseDeps(), "mohannadrabie/thoth", runner);
  assert.equal(calls, 1, "the in-memory issueCache must dedupe repeated citations to the same number");
  const bad = citations.filter((c) => c.verdict !== "resolved");
  assert.deepEqual(bad, []);
});

// --- Round 3 (red-team round-2 re-confirm, `docs/reviews/qa1415fix-red-team-round2-2026-09-10.md`):
// two new MED findings (Issues #143, #144) and four LOW items, all introduced by round 2's own
// regex fix. Fixed in this round; pinned here.

// NEW-1 / Issue #143 (MED): non-citation hash-N ordinals must not be classified as issue citations.
test("QA-14 (Issue #143, NEW-1): an ordinal shorthand ('Finding #2', 'Build task #1', 'suspicion #4') is NOT classified as an issue citation", () => {
  const cases = [
    "design-challenger Finding #2 was addressed.",
    "Scheduled as build task #1 for this round.",
    "the architecture's suspicion #4 was confirmed.",
    "round-1 attack #5 was re-applied.",
    "M3 mutation #2 was caught.",
  ];
  for (const text of cases) {
    const citations = scanReferences(text, deps({ issueExists: () => true }));
    const issueCitations = citations.filter((c) => c.kind === "issue");
    assert.equal(issueCitations.length, 0, `expected no issue citation in: ${JSON.stringify(text)}, got: ${JSON.stringify(issueCitations)}`);
  }
});

test("QA-14 (Issue #143, NEW-1): an HTML numeric character entity ('&#39;') is NOT classified as an issue citation", () => {
  const citations = scanReferences("the escape map renders an apostrophe as &#39;.", deps({ issueExists: () => true }));
  const issueCitations = citations.filter((c) => c.kind === "issue");
  assert.equal(issueCitations.length, 0);
});

test("QA-14 (Issue #143, NEW-1 non-regression): a real 'Closes #N' citation immediately after an ordinal-shaped sentence still resolves", () => {
  const citations = scanReferences("Finding #2 is fixed. Closes #120.", deps({ issueExists: (n) => n === 120 }));
  const issueCitations = citations.filter((c) => c.kind === "issue");
  assert.equal(issueCitations.length, 1);
  assert.equal(issueCitations[0]?.raw, "#120");
  assert.equal(issueCitations[0]?.verdict, "resolved");
});

// Residual gap found during this round's own re-measurement (not part of the originally-filed
// NEW-1 text): a comma/"and"-separated LIST of ordinals only has the word in front of the FIRST
// number — later list members must inherit the same exclusion, not resolve as real citations.
test("QA-14 (Issue #143, NEW-1 list-continuation): 'Findings #3, #4, #6' excludes ALL three numbers, not just the one directly after the word", () => {
  const citations = scanReferences("design-challenger's Findings #3, #4, #6 are residual.", deps({ issueExists: () => true }));
  const issueCitations = citations.filter((c) => c.kind === "issue");
  assert.equal(issueCitations.length, 0, `expected none of the list to classify as an issue, got: ${JSON.stringify(issueCitations)}`);
});

test("QA-14 (Issue #143, NEW-1 list-continuation, 'and'-joined): 'attack #4 and #5' excludes both numbers", () => {
  const citations = scanReferences("round-1 attack #4 and #5 both apply here.", deps({ issueExists: () => true }));
  const issueCitations = citations.filter((c) => c.kind === "issue");
  assert.equal(issueCitations.length, 0);
});

test("QA-14 (Issue #143, NEW-1 list-continuation non-regression): a real citation list is unaffected — 'Closes #7, #8' still resolves both", () => {
  const citations = scanReferences("Closes #7, #8 in one sweep.", deps({ issueExists: () => true }));
  const issueCitations = citations.filter((c) => c.kind === "issue");
  assert.equal(issueCitations.length, 2);
  assert.deepEqual(
    issueCitations.map((c) => c.raw).sort(),
    ["#7", "#8"],
  );
});

// NEW-2 / Issue #144 (MED): an all-digit CSS hex colour literal must not be classified as an issue.
test("QA-14 (Issue #144, NEW-2): an all-digit CSS hex colour literal ('#000', '#333') in a style declaration is NOT classified as an issue citation", () => {
  const citations = scanReferences(".bar-track{background:#000; border-radius:4px;} .x{color:#333;}", deps());
  const issueCitations = citations.filter((c) => c.kind === "issue");
  assert.equal(issueCitations.length, 0);
});

test("QA-14 (Issue #144, non-regression): the mixed-alphanumeric hex guard from round 2 still holds alongside the new all-digit guard", () => {
  const citations = scanReferences("--bg:#0f1115; --panel:#171a21; --accent:#5b8cff;", deps());
  assert.equal(citations.length, 0);
});

// NEW-3 (LOW): the `precedingWord` guard must not silently drop a word-prefixed cross-repo citation.
test("QA-14 (NEW-3): 'Issue owner/repo#N' (word-prefixed cross-repo) still classifies, not silently dropped by the same-word guard", () => {
  const citations = scanReferences("Issue anthropics/claude-code#18846 tracks this upstream.", deps({ repoSlug: "mohannadrabie/thoth" }));
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.raw, "anthropics/claude-code#18846");
  assert.equal(citations[0]?.verdict, "cross-repo-issue");
});

// NEW-4 (LOW): MILESTONE_CANDIDATE_RE and the guard must not span a line boundary.
// AMENDED 2026-09-11 (QA-14 marker redesign, docs/plans/qa14-marker-redesign-phase1-2026-09-11.md
// §5.1): this test's second line ("#120 is the issue that closes it.") is a bare, unmarked
// line-start #N — the same now-intentionally-changed shape as the two AMENDED Issue #139 tests
// above. The regression this test actually guards (a same-line-ending "milestone" must not absorb
// the NEXT line's #N as "already recorded", silently mis-kinding or dropping it) is unaffected and
// still asserted below via `milestoneCitations.length === 0` plus the presence check: #120 is
// neither silently absorbed into a milestone nor silently dropped — it is reported, loud and
// non-blocking, as `unclassified`. Originally asserted `kind: "issue"` / `verdict: "resolved"`.
test("QA-14 (NEW-4): a line ending in the word 'milestone' followed by a line starting with a bare #N is neither mis-kinded as a milestone nor silently dropped — it is unclassified (no marker on its own line)", () => {
  const citations = scanReferences(
    "Tied to this milestone\n#120 is the issue that closes it.",
    deps({
      issueExists: () => {
        throw new Error("must not query issueExists for a marker-less line-start #N");
      },
    }),
  );
  const milestoneCitations = citations.filter((c) => c.kind === "milestone");
  assert.equal(milestoneCitations.length, 0, "must not span the newline into a bogus milestone match");
  const candidateCitations = citations.filter((c) => c.raw === "#120");
  assert.equal(candidateCitations.length, 1, "must not be silently dropped either");
  assert.equal(candidateCitations[0]?.kind, "issue-candidate");
  assert.equal(candidateCitations[0]?.verdict, "unclassified");
});

test("QA-14 (NEW-4, non-regression): a same-line 'Milestone #N' citation still classifies as milestone, unaffected by the line-boundary fix", () => {
  const citations = scanReferences("See Milestone #23 for the plan.", deps({ issueExists: () => { throw new Error("must not query issueExists for a milestone"); } }));
  assert.equal(citations.length, 1);
  assert.equal(citations[0]?.kind, "milestone");
});

// NEW-5 (LOW): DEFAULT_MAX_DISTINCT_ISSUES' env override must validate, not silently fail open/shut.
test("QA-14 (NEW-5): parseMaxDistinctIssues falls back to the default on a malformed (non-numeric) override, never NaN", () => {
  const result = parseMaxDistinctIssues("not-a-number", 300);
  assert.equal(result, 300);
  assert.ok(Number.isFinite(result));
});

test("QA-14 (NEW-5): parseMaxDistinctIssues falls back to the default on an empty-string override, never silently zero", () => {
  const result = parseMaxDistinctIssues("", 300);
  assert.equal(result, 300);
});

test("QA-14 (NEW-5): parseMaxDistinctIssues rejects a non-positive or non-integer override", () => {
  assert.equal(parseMaxDistinctIssues("0", 300), 300);
  assert.equal(parseMaxDistinctIssues("-5", 300), 300);
  assert.equal(parseMaxDistinctIssues("12.5", 300), 300);
});

test("QA-14 (NEW-5): parseMaxDistinctIssues accepts a well-formed positive integer override", () => {
  assert.equal(parseMaxDistinctIssues("50", 300), 50);
});

test("QA-14 (NEW-5): parseMaxDistinctIssues returns the fallback when no override is set at all", () => {
  assert.equal(parseMaxDistinctIssues(undefined, 300), 300);
});

// ============================================================================================
// Marker redesign, 2026-09-11 (docs/plans/qa14-marker-redesign-phase1-2026-09-11.md). Closes
// GitHub issues 143, 144 and 145 (this time via a structural fix, not a bigger denylist) plus
// issue 137's finding (c). Deletes the ordinal-word denylist entirely and replaces it with a
// positive citation-marker requirement; anything without a marker is a new, non-blocking
// "unclassified" verdict — reported, never silently resolved, never silently dropped.
// ============================================================================================

// AC1 / R3: a bare "reponame#N" citation with no "owner/" prefix classifies unclassified, never
// cross-repo-issue (asserting cross-repo for an owner-less shape is itself a directional guess),
// and never reaches issueExists/verifyLocalIssue as a local number either.
test("QA-14 (R3, marker redesign): a bare 'reponame#N' citation (real in-tree shape, docs/reviews/userpromptsubmit-halt-relay-debug-2026-09-07.md:91 — 'claude-mem#2604') classifies unclassified, never cross-repo-issue, and never queries issueExists", () => {
  const citations = scanReferences(
    "Tracked upstream as claude-mem#2604 for now.",
    deps({
      issueExists: () => {
        throw new Error("must not query issueExists for an owner-less reponame#N shape");
      },
    }),
  );
  const relevant = citations.filter((c) => c.raw.includes("2604"));
  assert.equal(relevant.length, 1, `expected exactly one #2604-related citation, got: ${JSON.stringify(citations)}`);
  assert.equal(relevant[0]?.raw, "#2604", "the match should be the bare #2604 — 'claude-mem' is not attached to the regex match, same as before this redesign");
  assert.equal(relevant[0]?.verdict, "unclassified");
  assert.notEqual(relevant[0]?.verdict, "cross-repo-issue");
  assert.equal(relevant[0]?.kind, "issue-candidate");
});

// AC2 / R4: every ordinal/count-word-adjacent bare #N shape — the original 9-word denylist's own
// words, red-team round-3's >=12 named residual shapes, AND one NOVEL never-before-named ordinal
// word — classifies unclassified, never resolved. Achieved structurally (no word is ever
// enumerated as "excluded" anywhere in the implementation), proven here by including a shape that
// was never on any list.
test("QA-14 (R4, marker redesign): every ordinal/count-word-adjacent bare #N shape classifies unclassified, never resolved — the original denylist words, red-team's named residual shapes, and one NOVEL unlisted ordinal word", () => {
  const cases: Array<[string, string]> = [
    ["original denylist word (finding)", "design-challenger Finding #2 was addressed."],
    ["original denylist word (task)", "Scheduled as build task #1 for this round."],
    ["residual shape: items", "residuals=3 (items #3, #4, #6 above)."],
    ["residual shape: rule", "ADR-0021 entry, rule #2, verbatim."],
    ["residual shape: criterion", "criterion #6 was met."],
    ["residual shape: Next", "see Next #2 in STATE.md."],
    ["residual shape: recommendation", "recommendation #4 stands."],
    ["residual shape: residual", "residual #3 remains open."],
    ["residual shape: Coverage gap", "This CORRECTS Coverage gap #1 above."],
    ["residual shape: HIGH #N", "round 1's HIGH #1 recurred."],
    ["residual shape: LOW #N", "round 1's LOW #2 recurred."],
    ["residual shape: open-paren ordinal", "Two findings (#1, #2) are BREAKS."],
    ["residual shape: backtick ordinal", "every `#1`/`#2` match."],
    ["residual shape: angle-marker", "Build task >>#1<< (count)."],
    ["NOVEL unlisted ordinal word (never named by any prior round)", "the analysis reports sample #4 as normal."],
  ];
  for (const [label, text] of cases) {
    const citations = scanReferences(text, deps({ issueExists: () => true }));
    const issueCitations = citations.filter((c) => c.kind === "issue");
    assert.equal(issueCitations.length, 0, `[${label}] expected no issue-kind citation in: ${JSON.stringify(text)}, got: ${JSON.stringify(issueCitations)}`);
    const unclassified = citations.filter((c) => c.verdict === "unclassified");
    assert.ok(unclassified.length > 0, `[${label}] expected at least one unclassified citation in: ${JSON.stringify(text)}, got: ${JSON.stringify(citations)}`);
  }
});

// AC3 / R5: an all-digit hex literal quoted in prose or backticks (not just the already-fixed
// property:#000 CSS-declaration shape) classifies unclassified, never unresolved-authority.
test("QA-14 (R5, marker redesign): an all-digit hex literal quoted in prose or backticks classifies unclassified, never unresolved-authority (red-team's own C4/C5 repro)", () => {
  const proseCitations = scanReferences("the palette uses (#000, #333) tokens", deps());
  const proseRelevant = proseCitations.filter((c) => c.raw === "#000" || c.raw === "#333");
  assert.equal(proseRelevant.length, 2, `expected both #000 and #333 in: ${JSON.stringify(proseCitations)}`);
  for (const c of proseRelevant) {
    assert.equal(c.verdict, "unclassified");
    assert.notEqual(c.verdict, "unresolved-authority");
  }

  const backtickCitations = scanReferences("colours `#000` and `#333`", deps());
  const backtickRelevant = backtickCitations.filter((c) => c.raw === "#000" || c.raw === "#333");
  assert.equal(backtickRelevant.length, 2, `expected both #000 and #333 in: ${JSON.stringify(backtickCitations)}`);
  for (const c of backtickRelevant) {
    assert.equal(c.verdict, "unclassified");
    assert.notEqual(c.verdict, "unresolved-authority");
  }
});

// AC4 / R6: a real issue citation immediately following an excluded/ordinal-adjacent term in the
// same comma/slash/"and"/dash-range list is never silently dropped — it appears as unclassified
// (loud, counted), never a zero-citation silent omission, and never falsely resolved either (this
// mechanism cannot tell "findings #118/#119" apart from an ordinal list of the same shape — see
// plan §5.1's honest counterweight — so BOTH members are unclassified, not one silently vanished).
test("QA-14 (R6, marker redesign): a real issue citation following an excluded/ordinal-adjacent term in the same list is never silently dropped — 'findings #118/#119' (both real GitHub Issues) both appear as unclassified", () => {
  const citations = scanReferences("findings #118/#119", deps({ issueExists: () => true }));
  const relevant = citations.filter((c) => c.raw === "#118" || c.raw === "#119");
  assert.equal(relevant.length, 2, `expected both #118 and #119 present (never dropped), got: ${JSON.stringify(citations)}`);
  for (const c of relevant) {
    assert.equal(c.verdict, "unclassified");
    assert.notEqual(c.verdict, "resolved");
  }
});

test("QA-14 (R6, marker redesign): 'Finding #3, #143 filed' — the real issue #143 in the tail of an ordinal-led list is never silently absent", () => {
  const citations = scanReferences("Finding #3, #143 filed on GitHub.", deps({ issueExists: () => true }));
  const relevant = citations.filter((c) => c.raw === "#3" || c.raw === "#143");
  assert.equal(relevant.length, 2, `expected both #3 and #143 present (never dropped), got: ${JSON.stringify(citations)}`);
  for (const c of relevant) {
    assert.equal(c.verdict, "unclassified");
  }
});

// AC5 / non-blocking bucket: summarizeCitations never flips ok to false for unclassified alone;
// both counts are named in summary; unclassified lines always appear in details, on both PASS and
// FAIL runs (docs/decisions.md 2026-09-11 row 61 point (1)).
test("QA-14 (marker redesign §5.3): summarizeCitations — unclassified never flips ok to false, and both counts are named in summary/details", () => {
  const citations: Citation[] = [
    { raw: "#1", kind: "issue", verdict: "resolved", reason: "issue confirmed to exist" },
    { raw: "#2", kind: "issue-candidate", verdict: "unclassified", reason: "no explicit citation marker" },
    { raw: "#3", kind: "issue-candidate", verdict: "unclassified", reason: "no explicit citation marker" },
  ];
  const result = summarizeCitations(citations);
  assert.equal(result.ok, true, "unclassified alone must never fail the run");
  assert.match(result.summary, /1 resolved/);
  assert.match(result.summary, /2 unclassified/);
  assert.equal(result.details.length, 2, "unclassified citations must appear in details even on a PASS run");
  assert.ok(result.details.every((d) => d.startsWith("[unclassified]")));
});

test("QA-14 (marker redesign §5.3): summarizeCitations — a genuinely bad citation still fails the run, and the failing count excludes unclassified members", () => {
  const citations: Citation[] = [
    { raw: "#1", kind: "issue", verdict: "unresolved-authority", reason: "Issue #1 does not exist in this repository" },
    { raw: "#2", kind: "issue-candidate", verdict: "unclassified", reason: "no explicit citation marker" },
  ];
  const result = summarizeCitations(citations);
  assert.equal(result.ok, false);
  assert.match(result.summary, /^1 of 2 citation\(s\) failed to resolve/, "the failing count must be 1 (excluding the unclassified member), not 2");
  assert.match(result.summary, /1 more unclassified/);
  assert.equal(result.details.length, 2, "details must contain both the bad citation and the unclassified one, on a FAIL run too");
  assert.ok(result.details[0]?.startsWith("[unresolved-authority]"));
  assert.ok(result.details[1]?.startsWith("[unclassified]"));
});

// AC6 / non-regression: every currently-correct marker-based case keeps resolving exactly as
// today (covered by the untouched existing tests above, all still green). New case found during
// this round's own probing, not previously tested: the PLURAL "Issues #N, #N, #N" marker form.
test("QA-14 (marker redesign, non-regression — new case found during probing): plural 'Issues #N, #N, #N' marker resolves every member of the list, not just the first", () => {
  const citations = scanReferences("Issues #138, #139, #140 all close together.", deps({ issueExists: (n) => [138, 139, 140].includes(n) }));
  const issueCitations = citations.filter((c) => c.kind === "issue");
  assert.equal(issueCitations.length, 3, `expected all 3 to resolve as real issue citations, got: ${JSON.stringify(issueCitations)}`);
  assert.deepEqual(
    issueCitations.map((c) => c.raw).sort(),
    ["#138", "#139", "#140"],
  );
  assert.ok(issueCitations.every((c) => c.verdict === "resolved"));
});

// ============================================================================================
// Round-1 fix-now (2026-09-11), against Stage-3 round-1 review findings on the marker redesign
// above (docs/reviews/qa14-marker-redesign-{red-team,code,cross-domain}-2026-09-11.md; triage
// ruling docs/decisions.md 2026-09-11 row 63). Issues #149, #152, #153, #154.
// ============================================================================================

// Issue #152 (HIGH): scanReferences' dedup used to be keyed on the raw citation string alone —
// an unmarked bare #N occurrence could take that key first and permanently shadow a later real
// MARKED "Closes/Fixes #N" citation of the identical raw string, so the marked occurrence's real
// classification (against issueExists) was never reached at all. A marked classification must
// always win over an unmarked one for the same raw string, regardless of scan order.
test("QA-14 (Issue #152, HIGH): an unmarked bare #N earlier in a file must NOT prevent a later 'Closes #N' from being verified — the run still FAILS for a nonexistent issue", () => {
  const citations = scanReferences(
    "The table's row #9999 was cosmetic.\n\nCloses #9999.",
    deps({ issueExists: () => false }),
  );
  const relevant = citations.filter((c) => c.raw === "#9999");
  assert.equal(relevant.length, 1, `expected exactly one #9999 citation (upgraded in place, not a second entry), got: ${JSON.stringify(citations)}`);
  assert.equal(relevant[0]?.kind, "issue", "the marked occurrence must win — never left as issue-candidate");
  assert.equal(relevant[0]?.verdict, "unresolved-authority");
  const result = summarizeCitations(citations);
  assert.equal(result.ok, false, "a nonexistent issue cited via a real marker must still fail the run, even when an earlier unmarked bare #N of the same number was scanned first");
});

test("QA-14 (Issue #152, HIGH, symmetric case): the same shape resolves cleanly when the marked issue genuinely exists", () => {
  const citations = scanReferences(
    "The table's row #120 was cosmetic.\n\nCloses #120.",
    deps({ issueExists: (n) => n === 120 }),
  );
  const relevant = citations.filter((c) => c.raw === "#120");
  assert.equal(relevant.length, 1);
  assert.equal(relevant[0]?.kind, "issue");
  assert.equal(relevant[0]?.verdict, "resolved");
});

test("QA-14 (Issue #152, HIGH, order-independent): a marked occurrence FIRST already worked (regression guard) — an unmarked repeat afterward must not downgrade it", () => {
  const citations = scanReferences(
    "Closes #9999.\n\nThe table's row #9999 was cosmetic.",
    deps({ issueExists: () => false }),
  );
  const relevant = citations.filter((c) => c.raw === "#9999");
  assert.equal(relevant.length, 1);
  assert.equal(relevant[0]?.kind, "issue");
  assert.equal(relevant[0]?.verdict, "unresolved-authority");
});

// Issue #149 (HIGH, code-reviewer): LIST_CONTINUATION_RE's dash/en-dash/em-dash class had zero
// test coverage — mutation-demonstrated (removing the dash class from the regex left 708/708
// green). These pin the tight-dash continuation shape this repo's own corpus actually uses.
// Manually mutation-verified per code-reviewer's own method: with TIGHT_DASH_CONTINUATION_RE's
// body changed to never match (e.g. `/^$a/`), both assertions below fail (#113/#12 fall back to
// unclassified instead of resolved) — restoring the regex makes them pass again.
test("QA-14 (Issue #149, dash list-continuation): a tight hyphen-joined marked range resolves both members", () => {
  const citations = scanReferences("Closes #105-#113 in this batch.", deps({ issueExists: (n) => n === 105 || n === 113 }));
  const relevant = citations.filter((c) => c.raw === "#105" || c.raw === "#113");
  assert.equal(relevant.length, 2, `expected both ends of the range present, got: ${JSON.stringify(citations)}`);
  assert.ok(relevant.every((c) => c.kind === "issue" && c.verdict === "resolved"), `expected both resolved, got: ${JSON.stringify(relevant)}`);
});

test("QA-14 (Issue #149, dash list-continuation): a tight en-dash/em-dash joined marked range resolves both members", () => {
  const enDash = scanReferences("Fixed #105–#113 upstream.", deps({ issueExists: (n) => n === 105 || n === 113 }));
  const enRelevant = enDash.filter((c) => c.raw === "#105" || c.raw === "#113");
  assert.equal(enRelevant.length, 2);
  assert.ok(enRelevant.every((c) => c.kind === "issue" && c.verdict === "resolved"), `en-dash case: ${JSON.stringify(enRelevant)}`);

  const emDash = scanReferences("Resolves #10—#12 today.", deps({ issueExists: (n) => n === 10 || n === 12 }));
  const emRelevant = emDash.filter((c) => c.raw === "#10" || c.raw === "#12");
  assert.equal(emRelevant.length, 2);
  assert.ok(emRelevant.every((c) => c.kind === "issue" && c.verdict === "resolved"), `em-dash case: ${JSON.stringify(emRelevant)}`);
});

// Issue #153 (MED): the "already-recorded" branch (bare #N immediately preceded by "Issue"/
// "Milestone", already recorded by the dedicated word-form pass) didn't seed
// state.lastMarkedListEnd, so a singular "Issue #A, #B" list failed to open continuation for #B
// while the plural "Issues #A, #B" (which takes the CITATION_MARKER_WORD_RE branch instead)
// worked. Both forms must now behave identically.
test("QA-14 (Issue #153): a singular 'Issue #A, #B' list verifies BOTH members, identically to the plural 'Issues #A, #B' form", () => {
  const citations = scanReferences("Issue #7, #9999 both closed.", deps({ issueExists: (n) => n === 7 }));
  const issueCitations = citations.filter((c) => c.kind === "issue");
  assert.equal(issueCitations.length, 2, `expected both #7 and #9999 to reach real classification, got: ${JSON.stringify(citations)}`);
  const nine999 = issueCitations.find((c) => c.raw === "#9999");
  assert.equal(nine999?.verdict, "unresolved-authority", "the nonexistent #9999 must still be verified, not silently unclassified");
  const result = summarizeCitations(citations);
  assert.equal(result.ok, false, "'Issue #7, #9999' must fail the run for the nonexistent #9999, same as the plural form already does");
});

test("QA-14 (Issue #153, non-regression): a singular 'Issue #N' with no list stays unaffected", () => {
  const citations = scanReferences("See Issue #120 for details.", deps({ issueExists: (n) => n === 120 }));
  const issueCitations = citations.filter((c) => c.kind === "issue");
  assert.equal(issueCitations.length, 1);
  assert.equal(issueCitations[0]?.verdict, "resolved");
});

// Issue #154 (MED): R4/R5's shipped "never resolves as issue" / "never unresolved-authority"
// claims were falsified by the list-continuation path leaking marked status across an
// intervening ordinal/hex word, when only pure connector punctuation (no actual word) separated
// them from the prior marked item. The dash case is now closed by the tight-dash guard above
// (Issue #149's TIGHT_DASH_CONTINUATION_RE): a SPACE-PADDED dash no longer continues a list.
test("QA-14 (Issue #154, dash leak CLOSED): a space-padded dash after a marked citation does NOT carry marked status onto the next number — 'Closes #7 - #3 of the findings' leaves #3 unclassified", () => {
  const citations = scanReferences("Closes #7 - #3 of the findings remain open.", deps({ issueExists: () => true }));
  const seven = citations.find((c) => c.raw === "#7");
  const three = citations.find((c) => c.raw === "#3");
  assert.equal(seven?.kind, "issue");
  assert.equal(seven?.verdict, "resolved");
  assert.equal(three?.kind, "issue-candidate", `expected #3 to stay unclassified (no marker reaches it), got: ${JSON.stringify(three)}`);
  assert.equal(three?.verdict, "unclassified");
});

// Honest, disclosed residual (NOT closed — see reference-resolver.ts's STRUCTURAL NOTE comment
// above TIGHT_DASH_CONTINUATION_RE for the full reasoning, and for why no exact count is frozen
// here after two rounds of freezing one that went stale before it shipped): a comma/whitespace-
// joined continuation still carries marked status onto a hex-shaped or ordinal-shaped token
// immediately after it, because this repo's own real comma-joined citation lists genuinely need
// surrounding whitespace to stay matched. Real, small relative to the continuation-marked
// population, and fails loud (a blocking `unresolved-authority`, never a silent false resolve) —
// run `node src/qa/reference-resolver.ts <base> <head>` for the live count. Pinned here so a
// future change to this behavior is a deliberate, reviewed decision, not a silent drift either
// direction.
test("QA-14 (Issue #154, disclosed residual, NOT fixed this round): a comma-joined token right after a marked citation still inherits marked status, even when it is hex/ordinal-shaped", () => {
  const citations = scanReferences("Closes #7, #000 is the palette token.", deps({ issueExists: (n) => n === 7 }));
  const relevant = citations.find((c) => c.raw === "#000");
  assert.equal(relevant?.kind, "issue", "documents the known residual: #000 is marked via comma continuation, not left as unclassified");
  assert.equal(relevant?.verdict, "unresolved-authority");
});
