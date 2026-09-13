import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMarkerCorpusStats, parseMarkerCorpusField } from "./marker-corpus-probe.ts";
import { realRunner } from "../lib/exec.ts";

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

// GitHub Issue #164 fix (mirrors continuation-residual-probe.test.ts's own Issue #161 regression
// test): this probe used to accept an optional positional `ref` argument that only ever changed
// the FILE LIST (via `resolveChangedFiles`), never the CONTENT (always read from the working tree
// via `readFile`) — a demonstrated ref/content-mismatch bug. No real caller ever passed a
// non-default ref (confirmed by grep across production code, CI, package.json scripts,
// completeness-claim-checker.ts's KNOWN_INSTRUMENTS, and this test file itself); the parameter is
// deleted, not fixed — this pins that a stray positional argument is now simply ignored
// (working-tree-only, same result with or without it), rather than silently activating the old
// mismatch again.
test("QA-14 marker-corpus-probe (real subprocess, regression): a stray positional argument no longer changes the result — working-tree-only, the ref/content-mismatch bug is deleted not merely dormant", async () => {
  const withoutArg = await realRunner("node", ["src/qa/marker-corpus-probe.ts", "--field=total"]);
  const withStrayArg = await realRunner("node", ["src/qa/marker-corpus-probe.ts", "--field=total", "a26e55a"]);
  assert.equal(withoutArg.code, 0, `probe must exit 0; stderr: ${withoutArg.stderr}`);
  assert.equal(withStrayArg.code, 0, `probe must exit 0; stderr: ${withStrayArg.stderr}`);
  assert.equal(withStrayArg.stdout, withoutArg.stdout, "a positional argument must have zero effect — the probe reads only the working tree");
});
