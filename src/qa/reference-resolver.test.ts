import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReferenceResolverDeps } from "./reference-resolver.ts";
import { scanReferences, shouldScanFile, summarizeCitations } from "./reference-resolver.ts";

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
