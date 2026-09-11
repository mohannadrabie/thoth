import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMarkerCorpusStats } from "./marker-corpus-probe.ts";

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
