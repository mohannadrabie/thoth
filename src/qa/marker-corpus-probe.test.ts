import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertKnownArgs,
  collectFullTreeFileTexts,
  computeMarkerCorpusStats,
  parseMarkerCorpusField,
  readFileTexts,
} from "./marker-corpus-probe.ts";
import { realRunner } from "../lib/exec.ts";

const PROBE_PATH = fileURLToPath(new URL("./marker-corpus-probe.ts", import.meta.url));

/** Same isolated-fixture shape `src/secret-scan/history-scan.test.ts` already uses: a throwaway
 * `mkdtemp` directory, `git init`-ed, never this repo's own real working tree. GitHub Issue #176
 * fix-now: the untracked-file regression test below used to write a fixed path into THIS repo's
 * live checkout and spawn two live CLI subprocesses of the full probe to compare before/after —
 * the only test in this repo not sandboxed this way, demonstrated 6/6-failing under two concurrent
 * `node --test` processes on one checkout (red-team round-2 report, attack 1). */
async function withIsolatedGitRepo(fn: (repoDir: string) => Promise<void>): Promise<void> {
  const repoDir = await mkdtemp(join(tmpdir(), "qa14-marker-corpus-probe-"));
  try {
    async function run(...args: string[]): Promise<void> {
      const res = await realRunner("git", args, { cwd: repoDir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
    }
    await run("init", "-q", "-b", "main");
    await run("config", "user.email", "test@example.com");
    await run("config", "user.name", "Test");
    await writeFile(join(repoDir, "tracked.md"), "Closes #1 here.\n");
    await run("add", ".");
    await run("commit", "-q", "-m", "init");
    await fn(repoDir);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

// GitHub Issue #150: this instrument replaces an uncommitted scratchpad probe. These tests pin
// its own counting behavior directly (marked vs. unmarked vs. excluded populations), independent
// of whatever this repo's real corpus happens to contain today.

test("QA-14 marker-corpus-probe: an explicitly marked bare #N counts as marked", () => {
  const stats = computeMarkerCorpusStats(new Map([["a.md", "Closes #7 today."]]));
  assert.equal(stats.marked, 1);
  assert.equal(stats.unmarked, 0);
  assert.equal(stats.total, 1);
});

test("QA-14 marker-corpus-probe: a bare, unmarked #N counts as unmarked", () => {
  const stats = computeMarkerCorpusStats(new Map([["a.md", "See (#7) for context."]]));
  assert.equal(stats.marked, 0);
  assert.equal(stats.unmarked, 1);
  assert.equal(stats.total, 1);
});

test("QA-14 marker-corpus-probe: word-form 'Issue #N' / 'Milestone #N' and cross-repo 'owner/repo#N' are excluded from both buckets — same population the original design-rationale measurement covered", () => {
  const stats = computeMarkerCorpusStats(
    new Map([["a.md", "Issue #7 and Milestone #8 and other/repo#9 are not part of the bare-#N population."]]),
  );
  assert.equal(stats.total, 0, `expected neither bucket to count these excluded shapes, got: ${JSON.stringify(stats)}`);
});

test("QA-14 marker-corpus-probe: mixed file set sums across files and dedupes within a file, matching the shipped classifier's own behavior", () => {
  const stats = computeMarkerCorpusStats(
    new Map([
      ["a.md", "Closes #7. Also (#9) is unmarked. Closes #7 again (same file, deduped)."],
      ["b.md", "Fixes #7 in a second file — a distinct raw-per-file count, not a global dedup."],
    ]),
  );
  assert.equal(stats.marked, 2, `expected #7 marked once per file (a.md + b.md), got: ${JSON.stringify(stats)}`);
  assert.equal(stats.unmarked, 1);
  assert.equal(stats.total, 3);
  assert.equal(stats.filesScanned, 2);
});

test("QA-14 marker-corpus-probe: an empty file set is vacuous, not an error", () => {
  const stats = computeMarkerCorpusStats(new Map());
  assert.equal(stats.total, 0);
  assert.equal(stats.filesScanned, 0);
});

// GitHub Issue #150 round-2 fix-now: `--field` makes the probe's published figure machine-checkable
// via a `[[completeness: cmd="..." expect=N]]` marker (verifyMarkerClaim compares the LAST integer
// in stdout) — these tests pin the CLI parsing, independent of the live corpus.
test("QA-14 marker-corpus-probe: parseMarkerCorpusField returns null when no --field flag is given (default full-summary mode)", () => {
  assert.equal(parseMarkerCorpusField([]), null);
  assert.equal(parseMarkerCorpusField(["HEAD"]), null);
});

test("QA-14 marker-corpus-probe: parseMarkerCorpusField accepts marked|unmarked|total, in any argv position", () => {
  assert.equal(parseMarkerCorpusField(["--field=marked"]), "marked");
  assert.equal(parseMarkerCorpusField(["--field=unmarked"]), "unmarked");
  assert.equal(parseMarkerCorpusField(["HEAD", "--field=total"]), "total");
  assert.equal(parseMarkerCorpusField(["--field=total", "HEAD"]), "total");
});

test("QA-14 marker-corpus-probe: parseMarkerCorpusField throws (fails loud) on an unrecognized field value", () => {
  assert.throws(() => parseMarkerCorpusField(["--field=bogus"]), /--field must be one of marked\|unmarked\|total/);
});

// GitHub Issue #156 (red-team round-3, MED): the pre-existing end-to-end test in
// completeness-claim-checker.test.ts only proves `--field=total` mismatches a deliberately wrong
// `expect=0` — a comparison that is true whether stdout genuinely ends in the field's own number or
// (under a regression that silently drops `--field` handling, falling back to the round-1 default
// summary) in `filesScanned`. Neither value is ever 0 on this repo's real corpus, so that test
// cannot distinguish the fixed code from the mutation red-team demonstrated (M1: suppress the
// `--field` branch entirely) leaves the full suite green. This test distinguishes on OUTPUT SHAPE,
// not a numeric value, so it fails under M1 regardless of what the live corpus currently measures:
// `--field=total` mode must print ONLY `total=<N>` and must NEVER contain the default mode's own
// `marked=... unmarked=...`/`files scanned` text, which is exactly what M1's fallback would emit.
test("QA-14 marker-corpus-probe (Issue #156): --field=total emits ONLY that field, never the default multi-number summary — mutation-catching for the exact regression round 2 fixed and round 3 left untested", async () => {
  const fieldRun = await realRunner("node", ["src/qa/marker-corpus-probe.ts", "--field=total"]);
  assert.equal(fieldRun.code, 0, `probe must exit 0; stderr: ${fieldRun.stderr}`);
  assert.match(fieldRun.stdout, /total=\d+/, "field mode must print the field=<N> shape");
  assert.doesNotMatch(
    fieldRun.stdout,
    /marked=\d+ unmarked=\d+/,
    "field mode must NOT contain the default mode's marked=/unmarked= summary — if it does, --field " +
      "emission has silently fallen back to the round-1 default output (the exact regression this pins)",
  );
  assert.doesNotMatch(
    fieldRun.stdout,
    /files scanned/,
    "field mode must NOT contain the default mode's '(<N> files scanned)' clause either",
  );
});

// GitHub Issue #164 originally fixed the MACHINE-VISIBLE half of the ref/content-mismatch bug by
// deleting the `ref` parameter. GitHub Issue #173 (this story's own close-out) closes the
// HUMAN-FACING half: a stray positional argument or an unknown flag used to be silently swallowed
// (still printed a working-tree answer, exit 0, no warning) — contradicting this file's own
// documented fail-loud convention. It now fails loud, and — because `assertKnownArgs` is the very
// first thing `main()` calls — it fails BEFORE any file collection runs at all, so proving it needs
// only ONE subprocess spawn per case, never a second live tree-walk to race against.
//
// (This replaces the previous Issue #164 regression test, which asserted byte-identical stdout
// across TWO live subprocess spawns of this full-tree-scanning probe — demonstrated flaky under
// real `npm test` concurrency, GitHub Issue #170, ~17% of full-suite runs, root-caused to this
// file's own `collectFullTreeFileTexts` silently swallowing a transient read error as "file gone".
// See that function's own comment for the read-side fix; this test no longer needs two racing
// walks to prove anything, since a stray argument now never reaches the walk at all.)
test("QA-14 marker-corpus-probe (real subprocess, regression): a stray positional argument or an unknown flag now fails loud — never a silent working-tree answer", async () => {
  const badArgSets = [["not-a-ref-at-all"], ["HEAD~5"], ["--bogus-flag"], ["--field=total", "a26e55a"]];
  for (const badArgs of badArgSets) {
    const result = await realRunner("node", ["src/qa/marker-corpus-probe.ts", ...badArgs]);
    assert.notEqual(
      result.code,
      0,
      `expected a non-zero exit for argv ${JSON.stringify(badArgs)}, got 0; stdout: ${result.stdout}`,
    );
    assert.match(
      result.stderr,
      /unrecognized argument/,
      `expected a clear stderr message for argv ${JSON.stringify(badArgs)}; stderr: ${result.stderr}`,
    );
  }
});

// Deterministic companion to the subprocess test above — no I/O, no live-tree race — pinning
// `assertKnownArgs` itself (the CLI-entry gate `main()` calls before any file collection).
test("QA-14 marker-corpus-probe: assertKnownArgs throws on a stray positional or unknown flag, is silent on --field=... alone", () => {
  assert.throws(() => assertKnownArgs(["not-a-ref-at-all"]), /unrecognized argument/);
  assert.throws(() => assertKnownArgs(["HEAD~5"]), /unrecognized argument/);
  assert.throws(() => assertKnownArgs(["--bogus-flag"]), /unrecognized argument/);
  assert.throws(() => assertKnownArgs(["--field=total", "a26e55a"]), /unrecognized argument/);
  assert.doesNotThrow(() => assertKnownArgs([]));
  assert.doesNotThrow(() => assertKnownArgs(["--field=total"]));
});

// GitHub Issue #172 fix-now (red-team round-1 of the #164 close-out, attack 1 — narrowed, not
// closed): the file LIST used to come from `git ls-tree HEAD` while CONTENT came from the working
// tree, so a new, untracked, uncommitted, scannable file was silently invisible to the count
// (demonstrated in the review: baseline total=989, add an untracked file with 3 bare #N citations,
// total stayed 989; the same 3 citations in a TRACKED file raised it to 992).
//
// GitHub Issue #176 fix-now (this proof-test's own second bug — red-team round-2 attack 1,
// code-reviewer round-2 finding 1, both demonstrated): the original version of this test wrote a
// FIXED path into THIS repo's real, live working tree and spawned the full probe as two live CLI
// subprocesses to compare a before/after count — the exact two-live-subprocess shape Issue #170
// was filed and fixed for elsewhere in this same diff, reintroduced here with a stricter
// assertion. Demonstrated failing 6/6 under two concurrent `node --test` processes on one
// checkout, and ~29% even in serial full-suite runs. This version instead: (a) runs against an
// isolated `mkdtemp` git repo, never this repo's own checkout — mirrors how the other five
// mkdtemp-sandboxed test files in this repo already do it (`grep -rl mkdtemp --include=*.test.ts
// src/`); (b) asserts via a direct, in-process call to `collectFullTreeFileTexts` +
// `computeMarkerCorpusStats`, never a live CLI subprocess spawn of the probe at all — no process/IO
// contention, no shared-tree mutation, nothing for a second concurrent test run to race against.
test("QA-14 marker-corpus-probe (Issue #172 regression, isolated): a genuinely untracked, uncommitted, scannable file IS now counted — list and content agree on the same tree state", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    const before = computeMarkerCorpusStats(await collectFullTreeFileTexts(repoDir));
    assert.equal(before.total, 1, `expected the one committed tracked.md citation as baseline, got: ${JSON.stringify(before)}`);

    const untrackedAbs = join(repoDir, "untracked.md");
    await writeFile(untrackedAbs, "Fixes #900001 today. See (#900002) for context.\n", "utf8");
    const statusRun = await realRunner("git", ["status", "--porcelain", "--", "untracked.md"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    assert.match(statusRun.stdout, /^\?\?/, `expected the new file to be untracked; git status: ${statusRun.stdout}`);

    const after = computeMarkerCorpusStats(await collectFullTreeFileTexts(repoDir));
    assert.equal(
      after.total,
      before.total + 2,
      "an untracked file with 1 marked + 1 unmarked bare #N citation must raise the total by exactly 2 — " +
        "if it doesn't, the file list and content have drifted back to two different tree states",
    );
  });
});

// GitHub Issue #177 fix-now (red-team round-2 attack 2, demonstrated): the #170 ENOENT-narrowing
// catch was pinned by zero tests — a full-suite mutation reverting it to a blanket
// `catch { continue; }` left the suite byte-identical (779/778/1 on both sides). These two tests
// exercise `readFileTexts` directly via its injectable-reader seam — no real filesystem race
// needed to force a non-ENOENT error deterministically. Verified by temporarily reverting the
// narrowing back to a blanket catch and confirming the first test below goes red (it does: the
// EACCES case then resolves instead of rejecting), then restoring the fix.
test("QA-14 marker-corpus-probe (Issue #177, mutation-proving): a non-ENOENT read failure propagates instead of being silently swallowed", async () => {
  const seen: string[] = [];
  const fakeReadFile = (path: string): Promise<string> => {
    seen.push(path);
    if (path === "gone.md") {
      const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      return Promise.reject(err);
    }
    if (path === "broken.md") {
      const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      return Promise.reject(err);
    }
    return Promise.resolve("Closes #1 here.\n");
  };
  await assert.rejects(
    () => readFileTexts(["ok.md", "gone.md", "broken.md"], fakeReadFile),
    /EACCES/,
    "a non-ENOENT read failure must propagate loud, not be silently absorbed into the file list — " +
      "if this resolves instead of rejecting, the ENOENT-only narrowing has regressed to a blanket catch",
  );
  assert.deepEqual(seen, ["ok.md", "gone.md", "broken.md"], "must not short-circuit before reaching the non-ENOENT failure");
});

test("QA-14 marker-corpus-probe (Issue #177): an ENOENT read failure is still silently skipped — the one legitimate 'listed but now gone' case", async () => {
  const fakeReadFile = (path: string): Promise<string> => {
    if (path === "gone.md") {
      const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      return Promise.reject(err);
    }
    return Promise.resolve("Closes #1 here.\n");
  };
  const texts = await readFileTexts(["ok.md", "gone.md"], fakeReadFile);
  assert.deepEqual([...texts.keys()], ["ok.md"], "ENOENT must still be a silent skip, not a propagated failure");
});

// GitHub Issue #178 fix-now (red-team round-2 attack 3, demonstrated): `git ls-files --others`
// reports an untracked nested git repository as a directory entry (trailing slash), which used to
// pass `shouldScanFile` unfiltered and crash `readFile` with an unhandled EISDIR. The fix excludes
// trailing-slash entries at the source (`src/lib/git.ts`'s `lsFilesWorkingTree`); this proves the
// whole probe path — real git repo, real nested repo on disk, real `collectFullTreeFileTexts` call
// — no longer crashes.
test("QA-14 marker-corpus-probe (Issue #178, regression): a nested untracked git repository no longer crashes the probe", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    const nestedDir = join(repoDir, "zz-nested");
    async function runNested(...args: string[]): Promise<void> {
      const res = await realRunner("git", args, { cwd: nestedDir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
    }
    await mkdir(nestedDir);
    await runNested("init", "-q", "-b", "main");
    await writeFile(join(nestedDir, "note.md"), "See #900031 in a nested repo — must not be scanned.\n");

    const othersRun = await realRunner("git", ["ls-files", "-z", "--others", "--exclude-standard"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    assert.match(othersRun.stdout, /zz-nested\//, "sanity: git itself must report the nested repo as a directory entry");

    const texts = await collectFullTreeFileTexts(repoDir);
    assert.ok(![...texts.keys()].some((f) => f.startsWith("zz-nested")), "the nested repo's directory entry must not be scanned as a file");
    const stats = computeMarkerCorpusStats(texts);
    assert.equal(stats.total, 1, "only the one committed tracked.md citation — the nested repo's own #900031 must not leak in");
  });
});

// GitHub Issue #182: `collectFullTreeFileTexts` counts untracked-but-not-ignored files, so a stray
// scratch file changes the published number. The probe now says so on STDERR (the shared
// untracked-scan-warning.ts); the number, the exit code and stdout are unchanged, and stdout still
// ENDS in the single field integer that completeness-claim-checker.ts reads.
//
// TWR-1: subprocess in a fixture repo holding one untracked scannable file.
test("QA-14 marker-corpus-probe (Issue #182, real subprocess): an untracked scannable file draws a stderr warning; stdout, the count and the exit code are unchanged", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "untracked.md"), "Fixes #900001 today. See (#900002) for context.\n", "utf8");
    const run = await realRunner("node", [PROBE_PATH, "--field=total"], { cwd: repoDir, encoding: "utf8" });
    assert.equal(run.code, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, /total=3\s*$/, `1 tracked + 2 untracked; stdout must END in the field integer; stdout: ${run.stdout}`);
    assert.doesNotMatch(run.stdout, /untracked|WARNING/i, `the warning must never reach stdout; stdout: ${run.stdout}`);
    assert.match(run.stderr, /WARNING: 1 untracked file/, `stderr: ${run.stderr}`);
    assert.ok(run.stderr.includes("untracked.md"), `stderr must name the path; stderr: ${run.stderr}`);
  });
});

// TWR-2: a clean fixture repo (nothing untracked) produces no warning at all.
test("QA-14 marker-corpus-probe (Issue #182, real subprocess): no untracked scannable file means no warning", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    const run = await realRunner("node", [PROBE_PATH, "--field=total"], { cwd: repoDir, encoding: "utf8" });
    assert.equal(run.code, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, /total=1\s*$/, `stdout: ${run.stdout}`);
    assert.doesNotMatch(run.stderr, /WARNING|untracked/i, `stderr must carry no warning; stderr: ${run.stderr}`);
  });
});

// GitHub Issue #226: a duplicated `--field=` used to resolve first-wins (`Array.find`) and exit 0, so
// `--field=marked --field=total` silently answered `marked=N`. It now fails loud inside
// `parseMarkerCorpusField` (the resolver), before value validation and before any file collection.
// An identical repeat is rejected too (`--field=total --field=total`): one flag, once. Assertions check
// the quoted tokens, never invented prose.

/** A plain directory that is NOT a git repository — any git call made from it fails with "not a git
 * repository", which is how the reject-before-collection ordering is observed. */
async function withNonGitDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "qa14-marker-corpus-probe-nogit-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// T226-M1: two or more distinct --field= tokens throw, in either order, and the error names every token.
test("QA-14 marker-corpus-probe (Issue #226): parseMarkerCorpusField throws on two or more --field= flags, in either order, and quotes every token", () => {
  const cases: string[][] = [
    ["--field=marked", "--field=total"],
    ["--field=total", "--field=marked"],
    ["--field=marked", "--field=unmarked", "--field=total"],
    ["--field=bogus", "--field=total"],
    ["HEAD", "--field=marked", "--field=total"],
  ];
  for (const args of cases) {
    assert.throws(
      () => parseMarkerCorpusField(args),
      (err: unknown) =>
        err instanceof Error &&
        args.filter((a) => a.startsWith("--field=")).every((token) => err.message.includes(JSON.stringify(token))),
      `argv ${JSON.stringify(args)} must throw an error that quotes every --field= token`,
    );
  }
});

// T226-M2: an identical repeat is rejected too (no "same value is harmless" carve-out).
test("QA-14 marker-corpus-probe (Issue #226): parseMarkerCorpusField throws on an identical repeated --field= flag and names the token", () => {
  assert.throws(
    () => parseMarkerCorpusField(["--field=total", "--field=total"]),
    (err: unknown) => err instanceof Error && err.message.includes(JSON.stringify("--field=total")),
  );
});

// T226-M3: real subprocess, run from a directory that is NOT a git repository. If the duplicate is
// rejected first the stderr names the tokens; if collection ran first the failure would be git's own
// "not a git repository" and the tokens would never appear (the ordering half of the assertion).
test("QA-14 marker-corpus-probe (Issue #226, real subprocess): a duplicated --field= exits non-zero, names both tokens on stderr, prints no count, and fails BEFORE any git call", async () => {
  await withNonGitDir(async (dir) => {
    const cases: string[][] = [
      ["--field=marked", "--field=total"],
      ["--field=total", "--field=marked"],
      ["--field=total", "--field=total"],
    ];
    for (const args of cases) {
      // GIT_CEILING_DIRECTORIES stops git walking up out of `dir`: if the OS temp dir sits inside a git
      // worktree, `dir` would otherwise resolve to that worktree and the ordering half would be vacuous.
      const result = await realRunner("node", [PROBE_PATH, ...args], {
        cwd: dir,
        encoding: "utf8",
        env: { GIT_CEILING_DIRECTORIES: dirname(dir) },
      });
      const label = `argv ${JSON.stringify(args)}`;
      assert.notEqual(result.code, 0, `${label}: expected a non-zero exit; stdout: ${result.stdout}`);
      for (const token of args) {
        assert.ok(result.stderr.includes(JSON.stringify(token)), `${label}: stderr must quote ${token}; stderr: ${result.stderr}`);
      }
      assert.doesNotMatch(result.stderr, /not a git repository/, `${label}: the duplicate must be rejected before any git call; stderr: ${result.stderr}`);
      assert.equal(result.stdout, "", `${label}: no count may reach stdout`);
    }
  });
});
