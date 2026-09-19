import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { realRunner } from "../lib/exec.ts";
import type { Runner } from "../lib/exec.ts";
import type { ReferenceResolverDeps } from "./reference-resolver.ts";
import {
  assertKnownArgs,
  collectFullTreeFileTexts,
  computeContinuationMarkedCount,
  computeContinuationResidual,
  parseContinuationResidualField,
  readFileTexts,
} from "./continuation-residual-probe.ts";

const PROBE_PATH = fileURLToPath(new URL("./continuation-residual-probe.ts", import.meta.url));

/** Isolated fixture repo (a throwaway `mkdtemp` directory, never this repo's own working tree — the
 * same shape marker-corpus-probe.test.ts uses). One committed file, `tracked.md`, whose continuation
 * list `Closes #1, #2.` contributes exactly 1 to `continuation-marked` (#2). Commits use `-c`
 * identity overrides so no address-shaped string is written anywhere. */
async function withIsolatedGitRepo(fn: (repoDir: string) => Promise<void>): Promise<void> {
  const repoDir = await mkdtemp(join(tmpdir(), "qa14-continuation-probe-"));
  try {
    async function run(...args: string[]): Promise<void> {
      const res = await realRunner("git", args, { cwd: repoDir, encoding: "utf8" });
      assert.equal(res.code, 0, `git ${args.join(" ")} failed: ${res.stderr}`);
    }
    await run("init", "-q", "-b", "main");
    await writeFile(join(repoDir, "tracked.md"), "Closes #1, #2.\n");
    await run("add", ".");
    await run("-c", "user.name=fixture", "-c", "user.email=fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
    await fn(repoDir);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

/** A plain directory that is NOT a git repository — any git call made from it fails with "not a git
 * repository", which is how the gate-before-collection ordering is observed. */
async function withNonGitDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "qa14-continuation-probe-nogit-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runProbe(cwd: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return realRunner("node", [PROBE_PATH, ...args], { cwd, encoding: "utf8", env });
}

// GitHub Issue #154 / council Path A (docs/decisions.md, 2026-09-11 "Path-Forward Brief" row):
// these pin the denominator (pure, sync) and numerator (real-`gh`-reusing, capped) halves of the
// residual instrument independently, the same way marker-corpus-probe.test.ts pins Issue #150's
// probe.

test("QA-14 continuation-residual-probe: a directly-marked bare #N does NOT count toward the denominator", () => {
  const stats = computeContinuationMarkedCount(new Map([["a.md", "Closes #7 today."]]));
  assert.equal(stats.continuationMarked, 0);
});

test("QA-14 continuation-residual-probe: a list-continuation-marked bare #N counts toward the denominator", () => {
  const stats = computeContinuationMarkedCount(new Map([["a.md", "Closes #7, #8 today."]]));
  assert.equal(stats.continuationMarked, 1, "only #8 (the continuation member) counts — #7 is direct");
});

test("QA-14 continuation-residual-probe: an unmarked bare #N does NOT count toward the denominator", () => {
  const stats = computeContinuationMarkedCount(new Map([["a.md", "See (#7) for context."]]));
  assert.equal(stats.continuationMarked, 0);
});

test("QA-14 continuation-residual-probe: sums across files, matching the shipped classifier's own per-file dedup", () => {
  const stats = computeContinuationMarkedCount(
    new Map([
      ["a.md", "Closes #7, #8, #9 today."],
      ["b.md", "Fixes #1, #2 in a second file."],
    ]),
  );
  assert.equal(stats.continuationMarked, 3, "a.md: #8,#9 (2) + b.md: #2 (1) = 3");
  assert.equal(stats.filesScanned, 2);
});

test("QA-14 continuation-residual-probe: an empty file set is vacuous, not an error", () => {
  const stats = computeContinuationMarkedCount(new Map());
  assert.equal(stats.continuationMarked, 0);
  assert.equal(stats.filesScanned, 0);
});

function wiringBaseDeps(): Omit<ReferenceResolverDeps, "issueExists"> {
  return {
    pathExists: () => true,
    lineCount: () => 100,
    knownAdrIds: new Set(),
    repoSlug: "mohannadrabie/thoth",
    findByBasename: () => [],
  };
}

// --- Numerator: REUSES resolveIssueCitations (never a second, bespoke `gh`-calling path) — these
// exercise it end-to-end with a fake Runner, same style as reference-resolver.test.ts's own Issue
// #140/#141 wiring tests.

test("QA-14 continuation-residual-probe (numerator): a continuation-marked citation that FAILS real existence counts as a residual leak", async () => {
  const fileTexts = new Map([["docs/example.md", "Closes #7, #999999 in this repo."]]);
  const runner: Runner = (_cmd, args) => {
    if (args[2] === "7") return Promise.resolve({ stdout: '{"state":"OPEN"}', stderr: "", code: 0 });
    return Promise.resolve({
      stdout: "",
      stderr: "GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)",
      code: 1,
    });
  };
  const result = await computeContinuationResidual(fileTexts, wiringBaseDeps(), "mohannadrabie/thoth", runner);
  assert.equal(result.capExceeded, false);
  assert.equal(result.continuationMarked, 1, "only #999999 (the continuation member) is in the denominator here");
  assert.equal(result.continuationResidual, 1, "it fails real existence — the genuine leak this instrument exists to count");
});

test("QA-14 continuation-residual-probe (numerator, positive control): a continuation-marked citation that DOES exist counts toward the denominator but NOT the residual", async () => {
  const fileTexts = new Map([["docs/example.md", "Closes #7, #120 in this repo."]]);
  const runner: Runner = () => Promise.resolve({ stdout: '{"state":"OPEN"}', stderr: "", code: 0 });
  const result = await computeContinuationResidual(fileTexts, wiringBaseDeps(), "mohannadrabie/thoth", runner);
  assert.equal(result.continuationMarked, 1);
  assert.equal(result.continuationResidual, 0, "a continuation-marked citation that genuinely exists is not a leak");
});

test("QA-14 continuation-residual-probe (numerator): a DIRECTLY-marked citation never counts toward either number, regardless of its own existence verdict", async () => {
  const fileTexts = new Map([["docs/example.md", "Closes #999999 in this repo."]]);
  const runner: Runner = () =>
    Promise.resolve({
      stdout: "",
      stderr: "GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)",
      code: 1,
    });
  const result = await computeContinuationResidual(fileTexts, wiringBaseDeps(), "mohannadrabie/thoth", runner);
  assert.equal(result.continuationMarked, 0);
  assert.equal(result.continuationResidual, 0, "a direct-marked failure is a real QA-14 gate failure, but not THIS residual's numerator");
});

test("QA-14 continuation-residual-probe (numerator): REUSES resolveIssueCitations's own QA14_MAX_ISSUES cap — zero gh calls once exceeded", async () => {
  const fileTexts = new Map([["docs/example.md", "Closes #1, #2, #3 all in one file."]]);
  let calls = 0;
  const runner: Runner = () => {
    calls++;
    return Promise.resolve({ stdout: '{"state":"OPEN"}', stderr: "", code: 0 });
  };
  const result = await computeContinuationResidual(fileTexts, wiringBaseDeps(), "mohannadrabie/thoth", runner, 2);
  assert.equal(result.capExceeded, true);
  assert.equal(calls, 0, "the cap must fire before spending any of the rate-limit budget — same guarantee resolveIssueCitations itself gives");
  assert.equal(result.continuationResidual, 0);
});

// GitHub Issue #177 fix-now (red-team round-2 attack 2, demonstrated — covers BOTH this file and
// its twin marker-corpus-probe.ts, same catch shape): the #170 ENOENT-narrowing catch was pinned
// by zero tests in either file — a full-suite mutation reverting both to a blanket
// `catch { continue; }` left the suite byte-identical. These exercise this file's own
// `readFileTexts` directly via its injectable-reader seam. Verified by temporarily reverting the
// narrowing back to a blanket catch and confirming the first test below goes red, then restoring.
test("QA-14 continuation-residual-probe (Issue #177, mutation-proving): a non-ENOENT read failure propagates instead of being silently swallowed", async () => {
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
    return Promise.resolve("Closes #7, #8 today.\n");
  };
  await assert.rejects(
    () => readFileTexts(["ok.md", "gone.md", "broken.md"], fakeReadFile),
    /EACCES/,
    "a non-ENOENT read failure must propagate loud, not be silently absorbed into the file list — " +
      "if this resolves instead of rejecting, the ENOENT-only narrowing has regressed to a blanket catch",
  );
  assert.deepEqual(seen, ["ok.md", "gone.md", "broken.md"], "must not short-circuit before reaching the non-ENOENT failure");
});

test("QA-14 continuation-residual-probe (Issue #177): an ENOENT read failure is still silently skipped — the one legitimate 'listed but now gone' case", async () => {
  const fakeReadFile = (path: string): Promise<string> => {
    if (path === "gone.md") {
      const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      return Promise.reject(err);
    }
    return Promise.resolve("Closes #7, #8 today.\n");
  };
  const texts = await readFileTexts(["ok.md", "gone.md"], fakeReadFile);
  assert.deepEqual([...texts.keys()], ["ok.md"], "ENOENT must still be a silent skip, not a propagated failure");
});

// --- CLI field parsing

test("QA-14 continuation-residual-probe: parseContinuationResidualField returns null when no --field flag is given", () => {
  assert.equal(parseContinuationResidualField([]), null);
  assert.equal(parseContinuationResidualField(["HEAD"]), null);
});

test("QA-14 continuation-residual-probe: parseContinuationResidualField accepts continuation-marked|continuation-residual, in any argv position", () => {
  assert.equal(parseContinuationResidualField(["--field=continuation-marked"]), "continuation-marked");
  assert.equal(parseContinuationResidualField(["HEAD", "--field=continuation-residual"]), "continuation-residual");
});

test("QA-14 continuation-residual-probe: parseContinuationResidualField throws (fails loud) on an unrecognized field value", () => {
  assert.throws(
    () => parseContinuationResidualField(["--field=bogus"]),
    /--field must be one of continuation-marked\|continuation-residual/,
  );
});

// --- Real subprocess, denominator only (pure/fast, no network — same shape-pinning discipline as
// Issue #156's marker-corpus-probe.ts test, mutation-catching for a silently-broken --field flag).

test("QA-14 continuation-residual-probe (real subprocess): --field=continuation-marked emits ONLY that field", async () => {
  const fieldRun = await realRunner("node", ["src/qa/continuation-residual-probe.ts", "--field=continuation-marked"]);
  assert.equal(fieldRun.code, 0, `probe must exit 0; stderr: ${fieldRun.stderr}`);
  assert.match(fieldRun.stdout, /continuation-marked=\d+/);
  assert.doesNotMatch(fieldRun.stdout, /pure\/sync/, "field mode must not contain the default mode's own explanatory prose");
});

// GitHub Issue #179: a stray positional argument or an unknown flag used to be silently ignored
// (a count on stdout, exit 0). It is now a hard error before any file collection runs, mirroring the
// twin probe's `assertKnownArgs`. This replaces the earlier test that pinned the silent-accept
// behavior as a known gap.
//
// T179-1: the pure gate throws on each bad shape and names the offending token.
test("QA-14 continuation-residual-probe (Issue #179): assertKnownArgs throws on a stray positional, a ref, an unknown flag, or a SHA beside a valid --field, and quotes the token", () => {
  const cases: Array<{ args: string[]; offender: string }> = [
    { args: ["not-a-ref-at-all"], offender: "not-a-ref-at-all" },
    { args: ["HEAD~5"], offender: "HEAD~5" },
    { args: ["--bogus-flag"], offender: "--bogus-flag" },
    { args: ["--field=continuation-marked", "a26e55a"], offender: "a26e55a" },
  ];
  for (const { args, offender } of cases) {
    assert.throws(
      () => assertKnownArgs(args),
      (err: unknown) =>
        err instanceof Error && /unrecognized argument/.test(err.message) && err.message.includes(JSON.stringify(offender)),
      `argv ${JSON.stringify(args)} must throw an error that says "unrecognized argument" and quotes ${JSON.stringify(offender)}`,
    );
  }
});

// T179-2: the gate is silent on every valid shape.
test("QA-14 continuation-residual-probe (Issue #179): assertKnownArgs is silent for no arguments and for each valid --field value", () => {
  assert.doesNotThrow(() => assertKnownArgs([]));
  assert.doesNotThrow(() => assertKnownArgs(["--field=continuation-marked"]));
  assert.doesNotThrow(() => assertKnownArgs(["--field=continuation-residual"]));
});

// T179-3: real subprocess, run from a directory that is NOT a git repository. If the gate runs first
// the failure names the token; if collection ran first the failure would be git's own "not a git
// repository" and the token would never appear (that is the ordering half of the assertion).
test("QA-14 continuation-residual-probe (Issue #179, real subprocess): every bad argv exits non-zero, names the token on stderr, prints no count, and fails BEFORE any git call", async () => {
  await withNonGitDir(async (dir) => {
    const cases: Array<{ args: string[]; offender: string }> = [
      { args: ["not-a-ref-at-all"], offender: "not-a-ref-at-all" },
      { args: ["HEAD~5"], offender: "HEAD~5" },
      { args: ["--field=continuation-marked", "a26e55a"], offender: "a26e55a" },
      { args: ["--bogus-flag"], offender: "--bogus-flag" },
    ];
    for (const { args, offender } of cases) {
      // GIT_CEILING_DIRECTORIES stops git walking up out of `dir`: if the OS temp dir sits inside a git
      // worktree, `dir` would otherwise resolve to that worktree and the ordering half would be vacuous.
      const result = await runProbe(dir, args, { GIT_CEILING_DIRECTORIES: dirname(dir) });
      const label = `argv ${JSON.stringify(args)}`;
      assert.notEqual(result.code, 0, `${label}: expected a non-zero exit; stdout: ${result.stdout}`);
      assert.match(result.stderr, /unrecognized argument/, `${label}: stderr: ${result.stderr}`);
      assert.ok(result.stderr.includes(JSON.stringify(offender)), `${label}: stderr must quote the token; stderr: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /not a git repository/, `${label}: the gate must run before any git call; stderr: ${result.stderr}`);
      assert.equal(result.stdout, "", `${label}: no count may reach stdout`);
    }
  });
});

// T179-4: the valid invocations are unchanged (the two KNOWN_INSTRUMENTS entries depend on them).
test("QA-14 continuation-residual-probe (Issue #179, real subprocess): valid invocations still exit 0 and print their number", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    const bare = await runProbe(repoDir, []);
    assert.equal(bare.code, 0, `no-args run must exit 0; stderr: ${bare.stderr}`);
    assert.match(bare.stdout, /continuation-marked=1 /, `stdout: ${bare.stdout}`);

    const marked = await runProbe(repoDir, ["--field=continuation-marked"]);
    assert.equal(marked.code, 0, `stderr: ${marked.stderr}`);
    assert.match(marked.stdout, /continuation-marked=1\s*$/, `stdout must END in the single field integer; stdout: ${marked.stdout}`);

    // The fixture has no origin remote, so the gh-backed pass makes no gh call (null repo slug).
    const residual = await runProbe(repoDir, ["--field=continuation-residual"]);
    assert.equal(residual.code, 0, `stderr: ${residual.stderr}`);
    assert.match(residual.stdout, /continuation-residual=\d+/, `stdout: ${residual.stdout}`);
  });
});

// GitHub Issue #175: the file LIST used to come from `git ls-tree HEAD` (tracked blobs at HEAD)
// while CONTENT was read from the working tree, so a new, untracked, uncommitted, scannable file was
// invisible to the count. The list now comes from `git.lsFilesWorkingTree()` — the same tree state
// the content is read from, and the same source the twin probe uses. Both tests call
// `collectFullTreeFileTexts` in-process against an isolated `mkdtemp` repo (no live-tree subprocess).
//
// T175-1: an untracked file with a three-citation list raises the count by exactly its two
// continuation members (#11 and #12; #10 is the direct one).
test("QA-14 continuation-residual-probe (Issue #175, isolated): an untracked, uncommitted, scannable file IS counted — list and content agree on the same tree state", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    const before = computeContinuationMarkedCount(await collectFullTreeFileTexts(repoDir));
    assert.equal(before.continuationMarked, 1, `baseline is the committed tracked.md's one continuation member; got: ${JSON.stringify(before)}`);

    await writeFile(join(repoDir, "untracked.md"), "Closes #10, #11, #12.\n", "utf8");
    const statusRun = await realRunner("git", ["status", "--porcelain", "--", "untracked.md"], { cwd: repoDir, encoding: "utf8" });
    assert.match(statusRun.stdout, /^\?\?/, `the new file must be untracked; git status: ${statusRun.stdout}`);

    const after = computeContinuationMarkedCount(await collectFullTreeFileTexts(repoDir));
    assert.equal(
      after.continuationMarked,
      before.continuationMarked + 2,
      "an untracked file with 1 direct + 2 continuation citations must raise the count by exactly 2",
    );
    assert.equal(after.filesScanned, before.filesScanned + 1);
  });
});

// T175-2: an untracked NESTED git repository is reported by git as a trailing-slash directory entry;
// it must not crash the read (EISDIR) and none of its files may reach the scan.
test("QA-14 continuation-residual-probe (Issue #175, isolated): an untracked nested git repository neither crashes the probe nor leaks its files into the scan", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    const nestedDir = join(repoDir, "zz-nested");
    await mkdir(nestedDir);
    const init = await realRunner("git", ["init", "-q", "-b", "main"], { cwd: nestedDir, encoding: "utf8" });
    assert.equal(init.code, 0, `nested git init failed: ${init.stderr}`);
    await writeFile(join(nestedDir, "note.md"), "Closes #900041, #900042 inside a nested repo — must not be scanned.\n");
    await writeFile(join(repoDir, "untracked.md"), "Closes #10, #11, #12.\n", "utf8");

    const texts = await collectFullTreeFileTexts(repoDir);
    assert.ok(![...texts.keys()].some((f) => f.includes("zz-nested")), `the nested repo must not be scanned; keys: ${[...texts.keys()].join(", ")}`);
    const stats = computeContinuationMarkedCount(texts);
    assert.equal(stats.continuationMarked, 3, "tracked.md (1) + untracked.md (2); the nested repo's own citations must not leak in");
  });
});

// GitHub Issue #182 (applied to this probe now that #175 makes it count untracked files): the
// shared warning (untracked-scan-warning.ts) goes to STDERR only. The counted number, the exit code,
// and stdout (which must still END in the single field integer) are unchanged.
//
// TWR-3: subprocess in a fixture repo holding one untracked scannable file.
test("QA-14 continuation-residual-probe (Issue #182, real subprocess): an untracked scannable file draws a stderr warning; stdout, the count and the exit code are unchanged", async () => {
  await withIsolatedGitRepo(async (repoDir) => {
    await writeFile(join(repoDir, "untracked.md"), "Closes #10, #11, #12.\n", "utf8");
    const run = await runProbe(repoDir, ["--field=continuation-marked"]);
    assert.equal(run.code, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, /continuation-marked=3\s*$/, `1 tracked + 2 untracked; stdout must END in the field integer; stdout: ${run.stdout}`);
    assert.doesNotMatch(run.stdout, /untracked|WARNING/i, `the warning must never reach stdout; stdout: ${run.stdout}`);
    assert.match(run.stderr, /WARNING: 1 untracked file/, `stderr: ${run.stderr}`);
    assert.ok(run.stderr.includes("untracked.md"), `stderr must name the path; stderr: ${run.stderr}`);
  });
});

// GitHub Issue #226: a duplicated `--field=` used to resolve first-wins (`Array.find`) and exit 0, so
// `--field=continuation-marked --field=continuation-residual` silently answered the first. It now
// fails loud inside `parseContinuationResidualField` (the resolver), before value validation and
// before any file collection or `gh` call. An identical repeat is rejected too. Assertions check the
// quoted tokens, never invented prose.
//
// T226-C1: two or more distinct --field= tokens throw, in either order, and the error names every token.
test("QA-14 continuation-residual-probe (Issue #226): parseContinuationResidualField throws on two or more --field= flags, in either order, and quotes every token", () => {
  const cases: string[][] = [
    ["--field=continuation-marked", "--field=continuation-residual"],
    ["--field=continuation-residual", "--field=continuation-marked"],
    ["--field=bogus", "--field=continuation-marked"],
    ["HEAD", "--field=continuation-marked", "--field=continuation-residual"],
  ];
  for (const args of cases) {
    assert.throws(
      () => parseContinuationResidualField(args),
      (err: unknown) =>
        err instanceof Error &&
        args.filter((a) => a.startsWith("--field=")).every((token) => err.message.includes(JSON.stringify(token))),
      `argv ${JSON.stringify(args)} must throw an error that quotes every --field= token`,
    );
  }
});

// T226-C2: an identical repeat is rejected too (no "same value is harmless" carve-out).
test("QA-14 continuation-residual-probe (Issue #226): parseContinuationResidualField throws on an identical repeated --field= flag and names the token", () => {
  assert.throws(
    () => parseContinuationResidualField(["--field=continuation-marked", "--field=continuation-marked"]),
    (err: unknown) => err instanceof Error && err.message.includes(JSON.stringify("--field=continuation-marked")),
  );
});

// T226-C3: real subprocess, run from a directory that is NOT a git repository. If the duplicate is
// rejected first the stderr names the tokens; if collection ran first the failure would be git's own
// "not a git repository" and the tokens would never appear (the ordering half of the assertion).
test("QA-14 continuation-residual-probe (Issue #226, real subprocess): a duplicated --field= exits non-zero, names both tokens on stderr, prints no count, and fails BEFORE any git call", async () => {
  await withNonGitDir(async (dir) => {
    const cases: string[][] = [
      ["--field=continuation-marked", "--field=continuation-residual"],
      ["--field=continuation-residual", "--field=continuation-marked"],
      ["--field=continuation-marked", "--field=continuation-marked"],
    ];
    for (const args of cases) {
      // GIT_CEILING_DIRECTORIES stops git walking up out of `dir`: if the OS temp dir sits inside a git
      // worktree, `dir` would otherwise resolve to that worktree and the ordering half would be vacuous.
      const result = await runProbe(dir, args, { GIT_CEILING_DIRECTORIES: dirname(dir) });
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
