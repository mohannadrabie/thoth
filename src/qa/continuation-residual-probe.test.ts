import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { realRunner } from "../lib/exec.ts";
import type { Runner } from "../lib/exec.ts";
import type { ReferenceResolverDeps } from "./reference-resolver.ts";
import {
  assertKnownArgs,
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

async function runProbe(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return realRunner("node", [PROBE_PATH, ...args], { cwd, encoding: "utf8" });
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
      const result = await runProbe(dir, args);
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
