import { test } from "node:test";
import assert from "node:assert/strict";
import { realRunner } from "../lib/exec.ts";
import type { Runner } from "../lib/exec.ts";
import type { ReferenceResolverDeps } from "./reference-resolver.ts";
import {
  computeContinuationMarkedCount,
  computeContinuationResidual,
  parseContinuationResidualField,
} from "./continuation-residual-probe.ts";

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

// Human-ruled round-5 fix-now (docs/decisions.md's round-5-hard-stop ruling row; red-team's round-5
// report, finding 2): the probe used to accept a positional `ref` argument that only ever changed
// the FILE LIST (via `resolveChangedFiles`), never the CONTENT (always read from the working tree
// via `readFile`) — a demonstrated ref/content-mismatch bug (`--field=continuation-marked a26e55a`
// reported 273 against a26e55a's true content of 271). No real caller ever passed a non-default
// ref (confirmed by grep across production code, CI, package.json scripts and this test file
// itself); the parameter is deleted, not fixed — this pins that a stray positional argument is now
// simply ignored (working-tree-only, same result with or without it), rather than silently
// activating the old mismatch again.
test("QA-14 continuation-residual-probe (real subprocess, regression): a stray positional argument no longer changes the result — working-tree-only, the ref/content-mismatch bug is deleted not merely dormant", async () => {
  const withoutArg = await realRunner("node", ["src/qa/continuation-residual-probe.ts", "--field=continuation-marked"]);
  const withStrayArg = await realRunner("node", ["src/qa/continuation-residual-probe.ts", "--field=continuation-marked", "a26e55a"]);
  assert.equal(withoutArg.code, 0);
  assert.equal(withStrayArg.code, 0);
  assert.equal(withStrayArg.stdout, withoutArg.stdout, "a positional argument must have zero effect — the probe reads only the working tree");
});
