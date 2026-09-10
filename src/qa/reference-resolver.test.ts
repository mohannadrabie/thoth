import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve as pathResolve } from "node:path";
import type { ReferenceResolverDeps } from "./reference-resolver.ts";
import {
  checkIssueViaGh,
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
