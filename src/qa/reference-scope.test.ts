import { test } from "node:test";
import assert from "node:assert/strict";
import type { Citation, ReferenceResolverDeps } from "./reference-resolver.ts";
import { resolveIssueCitations, scanReferences, summarizeCitations } from "./reference-resolver.ts";
import type { Runner } from "../lib/exec.ts";

// Story s1-229-qa14-red (GitHub Issue #229). This file pins two things:
//   1. (this section) each QA-14 failure line names the file the citation came from, so a failing
//      run says where to look instead of leaving the reader to grep the tree;
//   2. (later sections) which text QA-14 examines per file: append-only records are checked on the
//      text a diff adds, the generated adrCatalog mirror is not checked, everything else is whole.

function baseDeps(overrides: Partial<ReferenceResolverDeps> = {}): Omit<ReferenceResolverDeps, "issueExists"> {
  return {
    pathExists: () => false,
    lineCount: () => 100,
    knownAdrIds: new Set(["ADR-0021"]),
    repoSlug: "mohannadrabie/thoth",
    findByBasename: () => [],
    ...overrides,
  };
}

function withFile(c: Omit<Citation, "file">, file: string): Citation {
  return { ...c, file };
}

// --- AC4a: each failure line names its file ---

test("AC4a: a failing citation that carries a file is reported with that file on its line", () => {
  const result = summarizeCitations([
    withFile({ raw: "docs/nope.md", kind: "path", verdict: "unresolved-authority", reason: "path does not exist in this repository" }, "docs/a.md"),
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.details.length, 1);
  assert.match(result.details[0] ?? "", /^\[unresolved-authority\] docs\/nope\.md — path does not exist in this repository \[file: docs\/a\.md\]$/);
});

test("AC4a: an unclassified citation that carries a file is reported with that file on its line", () => {
  const result = summarizeCitations([
    withFile({ raw: "#7", kind: "issue-candidate", verdict: "unclassified", reason: "no explicit citation marker" }, "CHANGELOG.md"),
  ]);
  assert.equal(result.ok, true);
  assert.match(result.details[0] ?? "", /^\[unclassified\] #7 — no explicit citation marker \[file: CHANGELOG\.md\]$/);
});

test("AC4a: a citation with no file keeps the exact line shape it had before (existing consumers unchanged)", () => {
  const result = summarizeCitations([
    { raw: "docs/nope.md", kind: "path", verdict: "unresolved-authority", reason: "path does not exist in this repository" },
  ]);
  assert.equal(result.details[0], "[unresolved-authority] docs/nope.md — path does not exist in this repository");
});

// --- AC4b: resolveIssueCitations tags every citation with its file; scanReferences does not ---

test("AC4b: resolveIssueCitations tags every citation with the file it came from, across two files and every kind", async () => {
  const fileTexts = new Map([
    ["docs/one.md", "See `docs/gone-one.md` and ADR-0021."],
    ["docs/two.md", "See `docs/gone-two.md` and Closes #5."],
  ]);
  const runner: Runner = () => Promise.resolve({ stdout: '{"state":"OPEN"}', stderr: "", code: 0 });
  const { citations } = await resolveIssueCitations(fileTexts, baseDeps(), "mohannadrabie/thoth", runner);
  assert.ok(citations.length >= 4, `expected at least four citations, got ${citations.length}`);
  const byRaw = new Map(citations.map((c) => [c.raw, c.file]));
  assert.equal(byRaw.get("docs/gone-one.md"), "docs/one.md");
  assert.equal(byRaw.get("ADR-0021"), "docs/one.md");
  assert.equal(byRaw.get("docs/gone-two.md"), "docs/two.md");
  assert.equal(byRaw.get("#5"), "docs/two.md");
  for (const c of citations) {
    assert.equal(typeof c.file, "string", `citation ${c.raw} carries no file`);
  }
});

test("AC4b: the same raw citation in two files is reported once per file, each with its own file", async () => {
  const fileTexts = new Map([
    ["docs/one.md", "See `docs/gone.md`."],
    ["docs/two.md", "See `docs/gone.md`."],
  ]);
  const runner: Runner = () => Promise.resolve({ stdout: "", stderr: "", code: 1 });
  const { citations } = await resolveIssueCitations(fileTexts, baseDeps(), "mohannadrabie/thoth", runner);
  const files = citations.map((c) => c.file).sort();
  assert.deepEqual(files, ["docs/one.md", "docs/two.md"]);
});

test("AC4b: scanReferences output carries no file field (it stays pure and per-text)", () => {
  const citations = scanReferences("See `docs/gone.md` and ADR-0021.", { ...baseDeps(), issueExists: () => true });
  assert.ok(citations.length >= 2);
  for (const c of citations) {
    assert.equal("file" in c, false, `scanReferences must not set file on ${c.raw}`);
  }
});

test("AC4b end to end: a failing file's name reaches the printed detail line via resolveIssueCitations and summarizeCitations", async () => {
  const fileTexts = new Map([
    ["docs/clean.md", "Nothing to cite here."],
    ["docs/dirty.md", "See `docs/gone.md`."],
  ]);
  const runner: Runner = () => Promise.resolve({ stdout: "", stderr: "", code: 1 });
  const { citations } = await resolveIssueCitations(fileTexts, baseDeps(), "mohannadrabie/thoth", runner);
  const result = summarizeCitations(citations);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /docs\/gone\.md .*\[file: docs\/dirty\.md\]/);
});
