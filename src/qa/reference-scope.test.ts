import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Citation, ReferenceResolverDeps } from "./reference-resolver.ts";
import { resolveIssueCitations, scanReferences, shouldScanFile, summarizeCitations } from "./reference-resolver.ts";
import {
  APPEND_ONLY_DIR_PREFIXES,
  APPEND_ONLY_FILES,
  GENERATED_MIRROR_FILE,
  buildScanTexts,
  isAppendOnlyRecord,
  parseUnifiedDiff,
  stripAdrCatalog,
} from "./reference-scope.ts";
import type { Runner } from "../lib/exec.ts";
import { realRunner } from "../lib/exec.ts";
import { makeGitOps, resolveChangedFiles } from "../lib/git.ts";

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

// =====================================================================================================
// Scoping cases. Real-git fixtures live in a throwaway `mkdtemp` repository (never this checkout).
// Subprocess tests run the shipped entry point and assert its exit code; the origin remote is set so
// a cross-repo issue shape classifies without any `gh` call. Every example reference below is a
// deliberately fabricated fixture value (this file is exempt from QA-14 as a test file).
// =====================================================================================================

const RESOLVER_PATH = fileURLToPath(new URL("./reference-resolver.ts", import.meta.url));
const SWEEP_PATH = fileURLToPath(new URL("../../docs/decisions-archive.mjs", import.meta.url));
const ZERO_SHA = "0".repeat(40);

interface Fixture {
  dir: string;
  write(rel: string, content: string): Promise<void>;
  read(rel: string): Promise<string>;
  remove(rel: string): Promise<void>;
  git(...args: string[]): Promise<string>;
  commit(message: string): Promise<string>;
  qa14(base: string, head: string): Promise<{ code: number; out: string }>;
  /** What `main()` would scan for base...head: the same resolve-then-build wiring, in process. */
  scanTexts(base: string, head: string): Promise<Map<string, string>>;
}

async function withRepo(fn: (fx: Fixture) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "qa14-scope-"));
  try {
    const git = async (...args: string[]): Promise<string> => {
      const res = await realRunner("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
      return res.stdout;
    };
    await git("init", "-q", "-b", "main");
    await git("config", "user.name", "fixture");
    await git("config", "user.email", "fixture");
    await git("config", "commit.gpgsign", "false");
    await git("config", "core.autocrlf", "false");
    await git("remote", "add", "origin", "https://github.com/owner/repo.git");
    const fx: Fixture = {
      dir,
      async write(rel, content) {
        await mkdir(dirname(join(dir, rel)), { recursive: true });
        await writeFile(join(dir, rel), content);
      },
      read: (rel) => readFile(join(dir, rel), "utf8"),
      async remove(rel) {
        await rm(join(dir, rel), { force: true });
      },
      git,
      async commit(message) {
        await git("add", "-A");
        await git("commit", "-q", "--allow-empty", "-m", message);
        return (await git("rev-parse", "HEAD")).trim();
      },
      async qa14(base, head) {
        const res = await realRunner("node", [RESOLVER_PATH, base, head], { cwd: dir, encoding: "utf8" });
        return { code: res.code, out: `${res.stdout}\n${res.stderr}` };
      },
      async scanTexts(base, head) {
        const ops = makeGitOps(realRunner, dir);
        const resolved = await resolveChangedFiles(ops, base, head);
        assert.ok(resolved, "diff must resolve in the fixture");
        return buildScanTexts(resolved.changedFiles, resolved.fullTreeFallback, {
          diffText: () => ops.diffText(base, head),
          readFile: async (rel) => {
            const res = await realRunner("git", ["show", `${head}:${rel}`], { cwd: dir, encoding: "utf8" });
            return res.code === 0 ? res.stdout : null;
          },
          shouldScan: shouldScanFile,
        });
      },
    };
    await fn(fx);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const DECISIONS_HEAD =
  "# Decision Log\n\n| Date | Decision | By | Dissent recorded | Human ratified | Review-back date |\n|---|---|---|---|---|---|\n";
const decisionsRow = (text: string, ratified = "Y", review = "2026-02-01"): string =>
  `| 2026-01-01 | ${text} | Manager | none | ${ratified} | ${review} |\n`;

/** A base commit whose append-only records already hold one example reference of each failing kind. */
async function seedExamples(fx: Fixture): Promise<string> {
  await fx.write("CHANGELOG.md", "# Changelog\n\n- Old entry cites `docs/gone-changelog.md`.\n");
  await fx.write("docs/decisions.md", DECISIONS_HEAD + decisionsRow("Old row cites ADR-12 as an example."));
  await fx.write("docs/REVIEW_LOG.md", "# Review log\n\n- Old row cites someone-else/other-repo#5 as an example.\n");
  await fx.write("docs/STATE.md", "# State\n\nClean.\n");
  return fx.commit("base with examples");
}

/** A base commit with clean append-only records and a clean STATE. */
async function seedClean(fx: Fixture): Promise<string> {
  await fx.write("CHANGELOG.md", "# Changelog\n\n- Old entry, plain prose.\n");
  await fx.write("docs/decisions.md", DECISIONS_HEAD + decisionsRow("Old row, plain prose."));
  await fx.write("docs/REVIEW_LOG.md", "# Review log\n\n- Old row, plain prose.\n");
  await fx.write("docs/STATE.md", "# State\n\nClean.\n");
  return fx.commit("clean base");
}

async function append(fx: Fixture, rel: string, text: string): Promise<void> {
  await fx.write(rel, (await fx.read(rel)) + text);
}

// --- AC1 (R1): the standing examples in append-only records no longer redden a routine diff ---

test("R1 a diff that only appends prose to CHANGELOG, STATE, decisions and REVIEW_LOG exits 0 while the append-only records already hold example references of every failing kind", async () => {
  await withRepo(async (fx) => {
    const base = await seedExamples(fx);
    await append(fx, "CHANGELOG.md", "- New entry, plain prose.\n");
    await append(fx, "docs/decisions.md", decisionsRow("New row, plain prose."));
    await append(fx, "docs/REVIEW_LOG.md", "- New row, plain prose.\n");
    await append(fx, "docs/STATE.md", "More clean prose.\n");
    const head = await fx.commit("append prose");

    const diff = await fx.qa14(base, head);
    assert.equal(diff.code, 0, `diff mode must exit 0; output:\n${diff.out}`);
    assert.doesNotMatch(diff.out, /gone-changelog|ADR-12|other-repo#5/);

    // Control: the same head, scanned whole (zero-SHA base -> full-tree fallback), holds all three kinds.
    const full = await fx.qa14(ZERO_SHA, head);
    assert.equal(full.code, 1, `full-tree control must exit 1; output:\n${full.out}`);
    assert.match(full.out, /gone-changelog/);
    assert.match(full.out, /ADR-12/);
    assert.match(full.out, /other-repo#5/);
  });
});

// --- AC2 (R2): nothing a diff adds escapes the gate ---

test("R2 a new nonexistent path on an appended decisions row exits 1", async () => {
  await withRepo(async (fx) => {
    const base = await seedClean(fx);
    await append(fx, "docs/decisions.md", decisionsRow("New row cites `docs/gone-new-path.md`."));
    const head = await fx.commit("bad path");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-new-path\.md .*\[file: docs\/decisions\.md\]/);
  });
});

test("R2 a new malformed ADR id on an appended CHANGELOG line exits 1", async () => {
  await withRepo(async (fx) => {
    const base = await seedClean(fx);
    await append(fx, "CHANGELOG.md", "- New entry cites ADR-12.\n");
    const head = await fx.commit("bad adr");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /\[unparseable\] ADR-12 .*\[file: CHANGELOG\.md\]/);
  });
});

test("R2 a new cross-repo issue reference on an appended REVIEW_LOG row exits 1", async () => {
  await withRepo(async (fx) => {
    const base = await seedClean(fx);
    await append(fx, "docs/REVIEW_LOG.md", "- New row cites someone-else/other-repo#9.\n");
    const head = await fx.commit("bad cross repo");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /\[cross-repo-issue\] someone-else\/other-repo#9 .*\[file: docs\/REVIEW_LOG\.md\]/);
  });
});

test("R2 a new nonexistent issue number on an appended decisions row fails, and an existing one passes (fake runner)", async () => {
  await withRepo(async (fx) => {
    const base = await seedClean(fx);
    await append(fx, "docs/decisions.md", decisionsRow("Missing: Closes #999999."));
    await append(fx, "CHANGELOG.md", "- Present: Closes #120.\n");
    const head = await fx.commit("issues");
    const texts = await fx.scanTexts(base, head);
    const runner: Runner = (_cmd, args) =>
      Promise.resolve(
        args.includes("120")
          ? { stdout: '{"state":"OPEN"}', stderr: "", code: 0 }
          : { stdout: "", stderr: "GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)", code: 1 },
      );
    const { citations } = await resolveIssueCitations(texts, baseDeps({ pathExists: () => true }), "owner/repo", runner);
    const bad = citations.filter((c) => c.verdict === "unresolved-authority");
    assert.deepEqual(
      bad.map((c) => [c.raw, c.file]),
      [["#999999", "docs/decisions.md"]],
    );
    assert.ok(citations.some((c) => c.raw === "#120" && c.verdict === "resolved" && c.file === "CHANGELOG.md"));
  });
});

test("same token, new line, same file: a token that fails on an old line and is cited again on a new line of the same file still exits 1", async () => {
  await withRepo(async (fx) => {
    const base = await seedExamples(fx); // CHANGELOG already holds an old line citing docs/gone-changelog.md
    await append(fx, "CHANGELOG.md", "- A clean new entry.\n");
    const clean = await fx.commit("clean append");
    const ok = await fx.qa14(base, clean);
    assert.equal(ok.code, 0, `appending a clean line must pass; output:\n${ok.out}`);

    await append(fx, "CHANGELOG.md", "- A new entry that cites `docs/gone-changelog.md` again.\n");
    const head = await fx.commit("same token again");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-changelog\.md .*\[file: CHANGELOG\.md\]/);
  });
});

test("R2 a new docs/reviews file with a bad citation exits 1 (every line is added)", async () => {
  await withRepo(async (fx) => {
    const base = await seedClean(fx);
    await fx.write("docs/reviews/new-report.md", "# Report\n\nCites `docs/gone-in-report.md`.\n");
    const head = await fx.commit("new report");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-in-report\.md .*\[file: docs\/reviews\/new-report\.md\]/);

    await fx.write("docs/reviews/new-report.md", "# Report\n\nPlain prose only.\n");
    const clean = await fx.commit("clean report");
    const ok = await fx.qa14(base, clean);
    assert.equal(ok.code, 0, ok.out);
  });
});

test("R2 an addendum appended to an existing report is checked; the report's old example references are not", async () => {
  await withRepo(async (fx) => {
    await fx.write("docs/reviews/old-report.md", "# Old report\n\nOld example `docs/gone-old-example.md`.\n");
    const base = await fx.commit("report with an old example");
    await append(fx, "docs/reviews/old-report.md", "\nAddendum cites `docs/gone-addendum.md`.\n");
    const head = await fx.commit("addendum");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-addendum\.md/);
    assert.doesNotMatch(res.out, /gone-old-example/);
  });
});

test("whole-file kept: an edit to STATE.md that adds a bad citation exits 1, and a bad token on an untouched STATE.md line also exits 1", async () => {
  await withRepo(async (fx) => {
    // (a) a bad citation the diff adds
    const clean = await seedClean(fx);
    await append(fx, "docs/STATE.md", "Adds `docs/gone-state-new.md`.\n");
    const headAdd = await fx.commit("state adds bad");
    const added = await fx.qa14(clean, headAdd);
    assert.equal(added.code, 1, added.out);
    assert.match(added.out, /docs\/gone-state-new\.md .*\[file: docs\/STATE\.md\]/);

    // (b) a standing bad token on a line the diff does not touch: STATE.md is read whole
    await fx.write("docs/STATE.md", "# State\n\nStanding example `docs/gone-state-standing.md`.\n");
    const standing = await fx.commit("state standing example");
    await append(fx, "docs/STATE.md", "A clean appended line.\n");
    const headClean = await fx.commit("state clean append");
    const untouched = await fx.qa14(standing, headClean);
    assert.equal(untouched.code, 1, untouched.out);
    assert.match(untouched.out, /docs\/gone-state-standing\.md .*\[file: docs\/STATE\.md\]/);
  });
});

// --- AC2i: the generated adrCatalog mirror ---

test(".maat-state.json: a bad citation in an authored field exits 1; the same text inside adrCatalog, top level or nested in priorScope, does not; unparseable JSON is scanned whole", () => {
  const bad = "`docs/gone-mirror.md`";
  const state = (o: unknown): string => JSON.stringify(o, null, 2);

  // authored field stays scanned
  assert.match(stripAdrCatalog(state({ note: `authored ${bad}`, adrCatalog: { adrs: [] } })), /gone-mirror/);
  // top-level catalog dropped
  assert.doesNotMatch(stripAdrCatalog(state({ scope: "x", adrCatalog: { adrs: [{ rule: `cite ${bad}` }] } })), /gone-mirror/);
  // nested priorScope catalogs dropped, at depth one and depth two
  const nested = state({
    scope: "x",
    priorScope: { scope: "y", adrCatalog: { adrs: [{ rule: `cite ${bad}` }] }, priorScope: { adrCatalog: { adrs: [{ rule: `cite ${bad}` }] } } },
  });
  assert.doesNotMatch(stripAdrCatalog(nested), /gone-mirror/);
  // the rest of the file around a dropped catalog is still there
  assert.match(stripAdrCatalog(state({ scope: "kept-scope", adrCatalog: { adrs: [] } })), /kept-scope/);
  // authored text beside the catalog in the same nested snapshot is still scanned
  assert.match(stripAdrCatalog(state({ priorScope: { note: `authored ${bad}`, adrCatalog: { adrs: [] } } })), /gone-mirror/);
  // a key named adrCatalog somewhere other than the root chain is authored text
  assert.match(stripAdrCatalog(state({ councilVerdict: { adrCatalog: { rule: `cite ${bad}` } } })), /gone-mirror/);
  // a non-object value under the key is authored text, not the mirror
  assert.match(stripAdrCatalog(state({ adrCatalog: `cite ${bad}` })), /gone-mirror/);
  // a duplicate key cannot hide earlier authored text (a parse-and-reserialize would drop it)
  const dup = `{"note": "authored ${bad}", "note": "clean", "adrCatalog": {"adrs": []}}`;
  assert.match(stripAdrCatalog(dup), /gone-mirror/);
  // a key spelled with an escape is not the mirror key, so it stays scanned
  const escaped = `{"adr\\u0043atalog": {"rule": "cite ${bad}"}}`;
  assert.match(stripAdrCatalog(escaped), /gone-mirror/);
  // unparseable JSON (or anything that is not one root object) is scanned whole
  assert.equal(stripAdrCatalog(`{"adrCatalog": {"rule": "cite ${bad}"`), `{"adrCatalog": {"rule": "cite ${bad}"`);
  assert.equal(stripAdrCatalog(`[1, 2] trailing`), `[1, 2] trailing`);
  assert.equal(stripAdrCatalog(""), "");
});

test(".maat-state.json end to end: the mirror is excluded in diff mode and in full-tree mode; an authored field is not", async () => {
  await withRepo(async (fx) => {
    const bad = "`docs/gone-mirror.md`";
    await fx.write("docs/STATE.md", "# State\n");
    await fx.write(GENERATED_MIRROR_FILE, JSON.stringify({ scope: "a", adrCatalog: { adrs: [] } }, null, 2));
    const base = await fx.commit("base");

    await fx.write(GENERATED_MIRROR_FILE, JSON.stringify({ scope: "b", adrCatalog: { adrs: [{ rule: `cite ${bad}` }] } }, null, 2));
    const mirrorOnly = await fx.commit("mirror regenerated");
    assert.equal((await fx.qa14(base, mirrorOnly)).code, 0);
    assert.equal((await fx.qa14(ZERO_SHA, mirrorOnly)).code, 0, "the mirror is excluded in a full-tree run too");

    await fx.write(GENERATED_MIRROR_FILE, JSON.stringify({ scope: "c", note: `authored ${bad}`, adrCatalog: { adrs: [] } }, null, 2));
    const authored = await fx.commit("authored field");
    const res = await fx.qa14(base, authored);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-mirror\.md .*\[file: docs\/\.maat-state\.json\]/);
  });
});

// --- AC3 (fail closed) ---

const QUOTED_PATH = "docs/café.md";

const quotedPathDiff = [
  "diff --git a/CHANGELOG.md b/CHANGELOG.md",
  "index 1111111..2222222 100644",
  "--- a/CHANGELOG.md",
  "+++ b/CHANGELOG.md",
  "@@ -1 +1,2 @@",
  " # Changelog",
  "+- Added to a file the parser can name.",
  'diff --git "a/docs/caf\\303\\251.md" "b/docs/caf\\303\\251.md"',
  "index 3333333..4444444 100644",
  '--- "a/docs/caf\\303\\251.md"',
  '+++ "b/docs/caf\\303\\251.md"',
  "@@ -1 +1,2 @@",
  " x",
  "+- Added to a file whose path git quoted.",
  "",
].join("\n");

function fakeDeps(files: Record<string, string>, diff: () => Promise<string>): Parameters<typeof buildScanTexts>[2] {
  return {
    diffText: diff,
    readFile: (rel) => Promise.resolve(files[rel] ?? null),
    shouldScan: shouldScanFile,
  };
}

test("a scoped file the diff parser cannot attribute (C-quoted path) is scanned whole", async () => {
  const files = {
    "CHANGELOG.md": "# Changelog\n- Old line that must not be scanned.\n- Added to a file the parser can name.\n",
    "docs/decisions.md": "# Decisions\n- Whole file A.\n",
    [`docs/reviews/${QUOTED_PATH.slice(5)}`]: "# Report\n- Whole file B.\n",
  };
  const quotedReview = `docs/reviews/${QUOTED_PATH.slice(5)}`;
  const texts = await buildScanTexts(
    ["CHANGELOG.md", "docs/decisions.md", quotedReview],
    false,
    fakeDeps(files, () => Promise.resolve(quotedPathDiff)),
  );
  // the attributable file is reduced to its added text, and the quoted file's hunk did not leak into it
  assert.equal(texts.get("CHANGELOG.md")?.includes("Old line"), false);
  assert.equal(texts.get("CHANGELOG.md")?.includes("Added to a file the parser can name."), true);
  assert.equal(texts.get("CHANGELOG.md")?.includes("path git quoted"), false);
  // an append-only file that is absent from the parsed diff is read whole
  assert.equal(texts.get("docs/decisions.md"), files["docs/decisions.md"]);
  assert.equal(texts.get(quotedReview), files[quotedReview]);
});

test("a pure rename into an append-only path (no hunks in the diff) is scanned whole, and exits 1 on an old example", async () => {
  await withRepo(async (fx) => {
    await fx.write("docs/scratch.md", "# Scratch\n\nOld example `docs/gone-renamed.md`.\n");
    const base = await fx.commit("scratch");
    await mkdir(join(fx.dir, "docs/reviews"), { recursive: true });
    await fx.git("mv", "docs/scratch.md", "docs/reviews/renamed-report.md");
    const head = await fx.commit("rename");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-renamed\.md .*\[file: docs\/reviews\/renamed-report\.md\]/);
  });
});

test("diffText failing falls back to whole-file scanning, never to a vacuous pass", async () => {
  const files = { "CHANGELOG.md": "# Changelog\n- Old line.\n- New line.\n", "docs/REVIEW_LOG.md": "# Log\n- Row.\n" };
  const texts = await buildScanTexts(
    ["CHANGELOG.md", "docs/REVIEW_LOG.md"],
    false,
    fakeDeps(files, () => Promise.reject(new Error("git diff failed"))),
  );
  assert.equal(texts.get("CHANGELOG.md"), files["CHANGELOG.md"]);
  assert.equal(texts.get("docs/REVIEW_LOG.md"), files["docs/REVIEW_LOG.md"]);
});

test("an empty diff for a changed append-only file is scanned whole (no attributable header, no vacuous pass)", async () => {
  const files = { "CHANGELOG.md": "# Changelog\n- Old line.\n" };
  const texts = await buildScanTexts(["CHANGELOG.md"], false, fakeDeps(files, () => Promise.resolve("")));
  assert.equal(texts.get("CHANGELOG.md"), files["CHANGELOG.md"]);
});

test("full-tree fallback (zero SHA) scans append-only records whole", async () => {
  const files = { "CHANGELOG.md": "# Changelog\n- Old line.\n", "docs/decisions.md": "# D\n- Old row.\n", "docs/reviews/r.md": "# R\n- Old.\n" };
  let diffCalls = 0;
  const texts = await buildScanTexts(
    Object.keys(files),
    true,
    fakeDeps(files, () => {
      diffCalls += 1;
      return Promise.resolve("");
    }),
  );
  for (const [rel, content] of Object.entries(files)) assert.equal(texts.get(rel), content);
  assert.equal(diffCalls, 0, "a full-tree run never asks for a diff");
});

test("a deleted file (nothing on disk) and a test file are not scanned", async () => {
  const files = { "CHANGELOG.md": "# Changelog\n", "src/x.test.ts": "// fixture\n" };
  const texts = await buildScanTexts(["CHANGELOG.md", "src/x.test.ts", "docs/gone.md"], true, fakeDeps(files, () => Promise.resolve("")));
  assert.deepEqual([...texts.keys()], ["CHANGELOG.md"]);
});

test("a line moved verbatim by the real archive-sweep script from decisions.md to decisions-archive.md exits 0", async () => {
  await withRepo(async (fx) => {
    const movedRow = decisionsRow("Resolved row that quotes the old example `docs/gone-swept.md`.");
    await fx.write("docs/decisions.md", DECISIONS_HEAD + movedRow + decisionsRow("Pending row.", "pending", "2999-01-01"));
    const base = await fx.commit("decisions with a resolved row");

    const sweep = await realRunner("node", [SWEEP_PATH, "--apply"], { cwd: fx.dir, encoding: "utf8" });
    assert.equal(sweep.code, 0, `sweep failed: ${sweep.stderr}`);
    assert.match(sweep.stdout, /archived 1 row/);
    const head = await fx.commit("sweep");

    const texts = await fx.scanTexts(base, head);
    assert.equal(texts.get("docs/decisions-archive.md")?.includes("gone-swept"), false, "the swept row is a move, not added text");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 0, res.out);
  });
});

test("a moved line with one edit that adds a bad citation exits 1", async () => {
  await withRepo(async (fx) => {
    await fx.write("docs/decisions.md", DECISIONS_HEAD + decisionsRow("Resolved row, plain prose."));
    const base = await fx.commit("decisions with a resolved row");

    const sweep = await realRunner("node", [SWEEP_PATH, "--apply"], { cwd: fx.dir, encoding: "utf8" });
    assert.equal(sweep.code, 0, `sweep failed: ${sweep.stderr}`);
    // the moved row is then edited once, adding a citation to a path that does not exist
    const archived = await fx.read("docs/decisions-archive.md");
    assert.match(archived, /Resolved row, plain prose\./);
    await fx.write("docs/decisions-archive.md", archived.replace("Resolved row, plain prose.", "Resolved row, plain prose. Now cites `docs/gone-edit.md`."));
    const head = await fx.commit("sweep, then edit the moved row");

    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-edit\.md .*\[file: docs\/decisions-archive\.md\]/);
  });
});

// --- Multiset semantics of the moved-line rule ---

test("moved-line rule is a multiset: each removed line licenses at most one added identical line", async () => {
  const badLine = "- Note cites `docs/gone-multiset.md`.";
  const scenario = async (added: number, removed: number): Promise<{ code: number; out: string; changelogCopies: number }> => {
    let result = { code: -1, out: "", changelogCopies: -1 };
    await withRepo(async (fx) => {
      const withBad = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `${badLine}\n- ${tag} ${i}.\n`).join("");
      const fillers = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `- ${tag} ${i}.\n`).join("");
      await fx.write("docs/decisions.md", `# Decisions\n${withBad(removed, "Filler")}`);
      await fx.write("CHANGELOG.md", "# Changelog\n");
      const base = await fx.commit("base");
      await fx.write("docs/decisions.md", `# Decisions\n${fillers(removed, "Filler")}`);
      await fx.write("CHANGELOG.md", `# Changelog\n${withBad(added, "Other")}`);
      const head = await fx.commit("head");
      const run = await fx.qa14(base, head);
      const texts = await fx.scanTexts(base, head);
      result = { ...run, changelogCopies: (texts.get("CHANGELOG.md") ?? "").split(badLine).length - 1 };
    });
    return result;
  };

  const threeAddedOneRemoved = await scenario(3, 1);
  assert.equal(threeAddedOneRemoved.code, 1, `three added, one removed: two copies are unlicensed; output:\n${threeAddedOneRemoved.out}`);
  assert.equal(threeAddedOneRemoved.changelogCopies, 2, "exactly the unlicensed copies (added minus removed) remain in the scanned text");

  const oneAddedOneRemoved = await scenario(1, 1);
  assert.equal(oneAddedOneRemoved.code, 0, `one added, one removed is a move; output:\n${oneAddedOneRemoved.out}`);
  assert.equal(oneAddedOneRemoved.changelogCopies, 0);

  const twoAddedTwoRemoved = await scenario(2, 2);
  assert.equal(twoAddedTwoRemoved.code, 0, `two added, two removed are two moves; output:\n${twoAddedTwoRemoved.out}`);
  assert.equal(twoAddedTwoRemoved.changelogCopies, 0);
});

// --- Laundering: a removal licenses a move only if it came from a file this run scans ---

test("laundering: a line removed from a *.test.ts file (never scanned) and added to CHANGELOG is still checked", async () => {
  await withRepo(async (fx) => {
    const line = "// see `docs/gone-laundry-test.md`";
    await fx.write("src/notes.test.ts", `// header\n${line}\n`);
    await fx.write("CHANGELOG.md", "# Changelog\n");
    const base = await fx.commit("base");
    await fx.write("src/notes.test.ts", "// header\n");
    await fx.write("CHANGELOG.md", `# Changelog\n${line}\n`);
    const head = await fx.commit("launder through a test file");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-laundry-test\.md .*\[file: CHANGELOG\.md\]/);
  });
});

test("laundering: a line removed from the adrCatalog mirror (never scanned) and added to CHANGELOG is still checked", async () => {
  await withRepo(async (fx) => {
    const withRule = JSON.stringify({ scope: "a", adrCatalog: { adrs: [{ rule: "cite `docs/gone-laundry-mirror.md` here" }] } }, null, 2);
    const withoutRule = JSON.stringify({ scope: "a", adrCatalog: { adrs: [] } }, null, 2);
    await fx.write(GENERATED_MIRROR_FILE, withRule);
    await fx.write("CHANGELOG.md", "# Changelog\n");
    const base = await fx.commit("base");
    const removedLine = withRule.split("\n").find((l) => l.includes("gone-laundry-mirror"));
    assert.ok(removedLine);
    await fx.write(GENERATED_MIRROR_FILE, withoutRule);
    await fx.write("CHANGELOG.md", `# Changelog\n${removedLine}\n`);
    const head = await fx.commit("launder through the mirror");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-laundry-mirror\.md .*\[file: CHANGELOG\.md\]/);
  });
});

test("laundering: a line removed from a file that the diff deletes (nothing on disk to scan) and added to CHANGELOG is still checked", async () => {
  await withRepo(async (fx) => {
    const line = "- Note cites `docs/gone-laundry-deleted.md`.";
    await fx.write("docs/old-notes.md", `# Notes\n${line}\n`);
    await fx.write("CHANGELOG.md", "# Changelog\n");
    const base = await fx.commit("base");
    await fx.remove("docs/old-notes.md");
    await fx.write("CHANGELOG.md", `# Changelog\n${line}\n`);
    const head = await fx.commit("launder through a deleted file");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-laundry-deleted\.md .*\[file: CHANGELOG\.md\]/);
  });
});

test("laundering: a line removed from the OLD path of a renamed file does not license an added copy", async () => {
  await withRepo(async (fx) => {
    const line = "- Note cites `docs/gone-laundry-rename.md`.";
    const body = Array.from({ length: 30 }, (_, i) => `- Stable line number ${i} in a file long enough for rename detection.`).join("\n");
    await fx.write("docs/old-name.md", `# Notes\n${body}\n${line}\n`);
    await fx.write("CHANGELOG.md", "# Changelog\n");
    const base = await fx.commit("base");
    await fx.git("mv", "docs/old-name.md", "docs/new-name.md");
    await fx.write("docs/new-name.md", `# Notes\n${body}\n`);
    await fx.write("CHANGELOG.md", `# Changelog\n${line}\n`);
    const head = await fx.commit("rename, drop a line, add it elsewhere");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /docs\/gone-laundry-rename\.md .*\[file: CHANGELOG\.md\]/);
  });
});

test("laundering control: a line removed from a scanned living file and added to an append-only record is a move (exit 0)", async () => {
  await withRepo(async (fx) => {
    const line = "- Note cites `docs/gone-move-control.md`.";
    await fx.write("docs/STATE.md", `# State\n${line}\n`);
    await fx.write("CHANGELOG.md", "# Changelog\n");
    const base = await fx.commit("base");
    await fx.write("docs/STATE.md", "# State\n");
    await fx.write("CHANGELOG.md", `# Changelog\n${line}\n`);
    const head = await fx.commit("move a line out of STATE");
    const res = await fx.qa14(base, head);
    assert.equal(res.code, 0, res.out);
  });
});

test("laundering: a removal in a file whose path git quoted (unattributable) does not license an added copy", async () => {
  const line = "Cites `docs/gone-quoted-source.md`.";
  const diff = [
    'diff --git "a/docs/caf\\303\\251.md" "b/docs/caf\\303\\251.md"',
    "index 3333333..4444444 100644",
    '--- "a/docs/caf\\303\\251.md"',
    '+++ "b/docs/caf\\303\\251.md"',
    "@@ -1,2 +1,1 @@",
    " x",
    `-${line}`,
    "diff --git a/CHANGELOG.md b/CHANGELOG.md",
    "index 1111111..2222222 100644",
    "--- a/CHANGELOG.md",
    "+++ b/CHANGELOG.md",
    "@@ -1 +1,2 @@",
    " # Changelog",
    `+${line}`,
    "",
  ].join("\n");
  const files = { "CHANGELOG.md": `# Changelog\n${line}\n`, [QUOTED_PATH]: "x\n" };
  const texts = await buildScanTexts(["CHANGELOG.md", QUOTED_PATH], false, fakeDeps(files, () => Promise.resolve(diff)));
  assert.equal(texts.get("CHANGELOG.md")?.includes("gone-quoted-source"), true);
});

// --- CRLF, header spoofing, run separation ---

test("CRLF files: added and removed lines compare equal after CR stripping", async () => {
  const diff = [
    "diff --git a/docs/decisions.md b/docs/decisions.md",
    "index 1111111..2222222 100644",
    "--- a/docs/decisions.md",
    "+++ b/docs/decisions.md",
    "@@ -1,2 +1,1 @@",
    " # Decisions\r",
    "-Moved row cites `docs/gone-crlf.md`.\r",
    "diff --git a/CHANGELOG.md b/CHANGELOG.md",
    "index 3333333..4444444 100644",
    "--- a/CHANGELOG.md",
    "+++ b/CHANGELOG.md",
    "@@ -1 +1,3 @@",
    " # Changelog",
    "+Moved row cites `docs/gone-crlf.md`.",
    "+A genuinely new line.\r",
    "",
  ].join("\n");
  const files = { "docs/decisions.md": "# Decisions\r\n", "CHANGELOG.md": "# Changelog\nMoved row cites `docs/gone-crlf.md`.\nA genuinely new line.\r\n" };
  const texts = await buildScanTexts(["docs/decisions.md", "CHANGELOG.md"], false, fakeDeps(files, () => Promise.resolve(diff)));
  const changelog = texts.get("CHANGELOG.md") ?? "";
  assert.equal(changelog.includes("gone-crlf"), false, "the LF copy equals the CRLF removal once CR is stripped");
  assert.equal(changelog.includes("A genuinely new line."), true);
  assert.equal(changelog.includes("\r"), false, "scanned text carries no CR");
});

test("parseUnifiedDiff: an added or removed content line that looks like a file header is content, not a new file", () => {
  // removed text "-- a/docs/decisions.md" renders as "--- a/docs/decisions.md";
  // added text "++ b/docs/decisions.md" renders as "+++ b/docs/decisions.md"
  const diff = [
    "diff --git a/CHANGELOG.md b/CHANGELOG.md",
    "index 1111111..2222222 100644",
    "--- a/CHANGELOG.md",
    "+++ b/CHANGELOG.md",
    "@@ -1,2 +1,3 @@",
    " # Changelog",
    "--- a/docs/decisions.md",
    "+++ b/docs/decisions.md",
    "+- A real added line.",
    "",
  ].join("\n");
  const parsed = parseUnifiedDiff(diff);
  assert.deepEqual([...parsed.added.keys()], ["CHANGELOG.md"]);
  assert.deepEqual(parsed.added.get("CHANGELOG.md")?.map((l) => l.text), ["++ b/docs/decisions.md", "- A real added line."]);
  assert.deepEqual([...parsed.removed.keys()], ["CHANGELOG.md"]);
  assert.deepEqual(parsed.removed.get("CHANGELOG.md"), ["-- a/docs/decisions.md"]);
});

test("parseUnifiedDiff on real git output: new file, deleted file, rename with an edit, binary, mode-only, no trailing newline", async () => {
  await withRepo(async (fx) => {
    const body = Array.from({ length: 30 }, (_, i) => `- Stable line number ${i} in a file long enough for rename detection.`).join("\n");
    await fx.write("docs/renamed-from.md", `${body}\n- last\n`);
    await fx.write("docs/deleted.md", "gone soon\n");
    await fx.write("docs/mode.sh", "echo hi\n");
    await fx.write("docs/image.bin", "a\u0000b");
    await fx.write("docs/no-newline.md", "first");
    const base = await fx.commit("base");
    await fx.git("mv", "docs/renamed-from.md", "docs/renamed-to.md");
    await fx.write("docs/renamed-to.md", `${body}\n- last, edited\n`);
    await fx.remove("docs/deleted.md");
    await fx.write("docs/added.md", "brand new\n");
    await fx.git("update-index", "--chmod=+x", "docs/mode.sh");
    await fx.write("docs/image.bin", "a\u0000c");
    await fx.write("docs/no-newline.md", "first\nsecond");
    const head = await fx.commit("head");

    const parsed = parseUnifiedDiff(await makeGitOps(realRunner, fx.dir).diffText(base, head));
    assert.deepEqual(parsed.added.get("docs/added.md")?.map((l) => l.text), ["brand new"]);
    assert.equal(parsed.removed.has("docs/added.md"), false);
    assert.deepEqual(parsed.removed.get("docs/deleted.md"), ["gone soon"]);
    assert.equal(parsed.added.has("docs/deleted.md"), false);
    assert.deepEqual(parsed.added.get("docs/renamed-to.md")?.map((l) => l.text), ["- last, edited"]);
    assert.deepEqual(parsed.removed.get("docs/renamed-from.md"), ["- last"]);
    assert.equal(parsed.added.has("docs/image.bin"), false, "a binary diff has no attributable text, so it is scanned whole");
    assert.equal(parsed.added.has("docs/mode.sh"), false, "a mode-only change has no hunk, so it is scanned whole");
    assert.deepEqual(parsed.added.get("docs/no-newline.md")?.map((l) => l.text), ["first", "second"]);
    assert.deepEqual(parsed.removed.get("docs/no-newline.md"), ["first"]);
  });
});

test("added text from separate runs is never joined into a false adjacency", async () => {
  // "issue" at the end of one added run and a bare number at the start of a later run are not
  // neighbours in the file; the scanned text must not make them one word-form citation.
  const diff = [
    "diff --git a/CHANGELOG.md b/CHANGELOG.md",
    "index 1111111..2222222 100644",
    "--- a/CHANGELOG.md",
    "+++ b/CHANGELOG.md",
    "@@ -1,2 +1,3 @@",
    " # Changelog",
    "+- Fixed the issue",
    " - stable",
    "@@ -10,2 +11,3 @@",
    " - stable two",
    "+#5 opens this added line",
    " - tail",
    "",
  ].join("\n");
  const files = { "CHANGELOG.md": "unused\n" };
  const texts = await buildScanTexts(["CHANGELOG.md"], false, fakeDeps(files, () => Promise.resolve(diff)));
  const cites = scanReferences(texts.get("CHANGELOG.md") ?? "", { ...baseDeps(), issueExists: () => null });
  assert.equal(cites.some((c) => /^issue#5$/i.test(c.raw)), false);
});

test("scope constants: the append-only set and the mirror are the ones the requirement text names", () => {
  assert.deepEqual([...APPEND_ONLY_FILES].sort(), ["CHANGELOG.md", "docs/REVIEW_LOG.md", "docs/decisions-archive.md", "docs/decisions.md"]);
  assert.deepEqual([...APPEND_ONLY_DIR_PREFIXES], ["docs/reviews/"]);
  assert.equal(GENERATED_MIRROR_FILE, "docs/.maat-state.json");
  assert.equal(isAppendOnlyRecord("docs/reviews/anything.md"), true);
  assert.equal(isAppendOnlyRecord("docs/decisions.md"), true);
  assert.equal(isAppendOnlyRecord("docs/STATE.md"), false);
  assert.equal(isAppendOnlyRecord("docs/backlog.md"), false);
  assert.equal(isAppendOnlyRecord("docs/reviews"), false);
  assert.equal(isAppendOnlyRecord("docs/reviewsx/a.md"), false);
  assert.equal(isAppendOnlyRecord("Changelog.md"), false, "membership is case-sensitive: an unlisted spelling is scanned whole");
});
