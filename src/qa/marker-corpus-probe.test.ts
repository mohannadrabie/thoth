import { test } from "node:test";
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertKnownArgs, computeMarkerCorpusStats, parseMarkerCorpusField } from "./marker-corpus-probe.ts";
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
// total stayed 989; the same 3 citations in a TRACKED file raised it to 992). This proves the fix
// with a REAL untracked file in this actual repo — confirmed untracked via `git status
// --porcelain`, cleaned up in `finally` even if an assertion fails so no source file is left behind.
test("QA-14 marker-corpus-probe (real subprocess, regression): a genuinely untracked, uncommitted, scannable file IS now counted — list and content agree on the same tree state", async () => {
  const scratchRel = "docs/zz-marker-corpus-probe-untracked-regression.md";
  const scratchAbs = resolve(process.cwd(), scratchRel);

  const before = await realRunner("node", ["src/qa/marker-corpus-probe.ts", "--field=total"]);
  assert.equal(before.code, 0, `probe must exit 0; stderr: ${before.stderr}`);
  const beforeTotal = Number(/total=(\d+)/.exec(before.stdout)?.[1]);
  assert.ok(Number.isInteger(beforeTotal), `expected a total=<N> baseline, got: ${before.stdout}`);

  await writeFile(scratchAbs, "Fixes #900001 today. See (#900002) for context.\n", "utf8");
  try {
    const statusRun = await realRunner("git", ["status", "--porcelain", "--", scratchRel]);
    assert.match(statusRun.stdout, /^\?\?/, `expected the scratch file to be untracked; git status: ${statusRun.stdout}`);

    const after = await realRunner("node", ["src/qa/marker-corpus-probe.ts", "--field=total"]);
    assert.equal(after.code, 0, `probe must exit 0; stderr: ${after.stderr}`);
    const afterTotal = Number(/total=(\d+)/.exec(after.stdout)?.[1]);
    assert.equal(
      afterTotal,
      beforeTotal + 2,
      "an untracked file with 1 marked + 1 unmarked bare #N citation must raise the total by exactly 2 — " +
        "if it doesn't, the file list and content have drifted back to two different tree states",
    );
  } finally {
    await unlink(scratchAbs).catch(() => {});
  }
});
