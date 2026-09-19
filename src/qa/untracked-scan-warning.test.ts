import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExecResult, Runner } from "../lib/exec.ts";
import { UNTRACKED_WARNING_PATH_CAP, untrackedScanWarning, warnIfUntrackedScannable } from "./untracked-scan-warning.ts";

// Shared stderr warning for the two QA-14 probes (marker-corpus-probe.ts and
// continuation-residual-probe.ts), GitHub Issue #182: a probe's list comes from
// `git ls-files --cached --others --exclude-standard`, so an untracked-but-not-ignored scratch file
// changes the published number. The number is not changed; this module only tells the operator.
// Every test here runs against a fake `Runner` (no real git, no filesystem).

interface Call {
  cmd: string;
  args: string[];
  opts: Parameters<Runner>[2];
}

function fakeRunner(result: Partial<ExecResult>): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return Promise.resolve({ stdout: "", stderr: "", code: 0, ...result });
  };
  return { runner, calls };
}

/** git's `-z` output: every entry NUL-terminated. */
function nul(...entries: string[]): string {
  return entries.map((e) => `${e}\0`).join("");
}

test("untracked-scan-warning (TW-1): reads the untracked set with exactly `git ls-files -z --others --exclude-standard` in the repo root", async () => {
  const { runner, calls } = fakeRunner({ stdout: nul("a.md") });
  const warning = await untrackedScanWarning(runner, "/some/repo");
  assert.equal(calls.length, 1, "exactly one git call");
  assert.equal(calls[0]?.cmd, "git");
  assert.deepEqual(calls[0]?.args, ["ls-files", "-z", "--others", "--exclude-standard"]);
  assert.equal(calls[0]?.opts?.cwd, "/some/repo");
  assert.notEqual(warning, null);
  assert.match(warning ?? "", /a\.md/);
});

test("untracked-scan-warning (TW-2): a trailing-slash entry (an untracked nested git repository) is not a scannable file and is dropped", async () => {
  const { runner } = fakeRunner({ stdout: nul("a.md", "zz-nested/") });
  const warning = await untrackedScanWarning(runner, "/r");
  assert.match(warning ?? "", /\b1 untracked\b/, `count must be 1, got: ${warning}`);
  assert.doesNotMatch(warning ?? "", /zz-nested/);
});

test("untracked-scan-warning (TW-3): a *.test.ts file is exempt from the scan (shouldScanFile) and is dropped", async () => {
  const { runner } = fakeRunner({ stdout: nul("a.md", "scratch.test.ts") });
  const warning = await untrackedScanWarning(runner, "/r");
  assert.match(warning ?? "", /\b1 untracked\b/, `count must be 1, got: ${warning}`);
  assert.doesNotMatch(warning ?? "", /scratch\.test\.ts/);
});

test("untracked-scan-warning (TW-4): a non-zero git exit throws (never swallowed into 'no warning')", async () => {
  const { runner } = fakeRunner({ code: 128, stderr: "fatal: not a git repository" });
  await assert.rejects(() => untrackedScanWarning(runner, "/r"), /not a git repository/);
});

test("untracked-scan-warning (TW-5): null when there is nothing to warn about (empty output, or only entries the scan skips)", async () => {
  assert.equal(await untrackedScanWarning(fakeRunner({ stdout: "" }).runner, "/r"), null);
  assert.equal(await untrackedScanWarning(fakeRunner({ stdout: nul("zz-nested/", "only.test.ts") }).runner, "/r"), null);
});

test("untracked-scan-warning (TW-6): the header names the count and every path is listed, with the reproducibility hint and the 'count unchanged' note", async () => {
  const { runner } = fakeRunner({ stdout: nul("a.md", "docs/b.md", "c.txt") });
  const warning = await untrackedScanWarning(runner, "/r");
  assert.ok(warning !== null);
  assert.match(warning, /WARNING/);
  assert.match(warning, /\b3 untracked\b/);
  for (const p of ["a.md", "docs/b.md", "c.txt"]) assert.ok(warning.includes(p), `must list ${p}; got: ${warning}`);
  assert.match(warning, /Commit, delete, or \.gitignore/);
  assert.match(warning, /count itself is unchanged/);
  assert.doesNotMatch(warning, /and \d+ more/, "no 'and N more' line when everything is listed");
});

test("untracked-scan-warning (TW-7): at most UNTRACKED_WARNING_PATH_CAP paths are listed, in order, then 'and N more' with the true remainder", async () => {
  assert.equal(UNTRACKED_WARNING_PATH_CAP, 10);
  const paths = Array.from({ length: 12 }, (_, i) => `f${String(i + 1).padStart(2, "0")}.md`);
  const warning = (await untrackedScanWarning(fakeRunner({ stdout: nul(...paths) }).runner, "/r")) ?? "";
  assert.match(warning, /\b12 untracked\b/, "the header count is the true total, not the listed count");
  for (const p of paths.slice(0, 10)) assert.ok(warning.includes(p), `must list ${p}`);
  for (const p of paths.slice(10)) assert.ok(!warning.includes(p), `must NOT list ${p} (over the cap)`);
  assert.match(warning, /and 2 more/);

  const exactlyCap = (await untrackedScanWarning(fakeRunner({ stdout: nul(...paths.slice(0, 10)) }).runner, "/r")) ?? "";
  assert.doesNotMatch(exactlyCap, /and \d+ more/, "exactly at the cap: nothing is omitted");
  const oneOver = (await untrackedScanWarning(fakeRunner({ stdout: nul(...paths.slice(0, 11)) }).runner, "/r")) ?? "";
  assert.match(oneOver, /and 1 more/);
});

test("untracked-scan-warning (TW-8): warnIfUntrackedScannable writes the whole warning once through the injected sink, and writes nothing when there is none", async () => {
  const written: string[] = [];
  await warnIfUntrackedScannable(fakeRunner({ stdout: nul("a.md", "b.md") }).runner, "/r", (m) => written.push(m));
  assert.equal(written.length, 1, "exactly one write");
  assert.match(written[0] ?? "", /\b2 untracked\b/);
  assert.match(written[0] ?? "", /a\.md/);

  const none: string[] = [];
  await warnIfUntrackedScannable(fakeRunner({ stdout: "" }).runner, "/r", (m) => none.push(m));
  assert.deepEqual(none, []);
});
