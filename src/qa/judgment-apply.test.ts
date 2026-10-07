// #463 / #467 (S7, k-blocker, story a1): the judgment applier. Judgment files change only through it, from a committed approved-delta
// file in docs/qa/judgment-deltas/; re-running it changes nothing; a re-judgment is a `replace` that names the previous value.
// Written FAILING FIRST (round 1), extended failing first for #477 #478 #479 (round 2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDelta, applyFiles, DELTA_DIR, gitTrackedAndClean, missingFromDelta, type Delta, type JudgmentFiles } from "./judgment-apply.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** The real files with what this test file adds taken back out, so the tests do not depend on which judgments the repo already holds. */
const real = (): JudgmentFiles => {
  const writeDeny = JSON.parse(readFileSync(`${ROOT}docs/qa/claude-code-write-deny-judgment.json`, "utf8")) as JudgmentFiles["writeDeny"];
  delete writeDeny["anywhere"];
  writeDeny.user = writeDeny.user.filter((e) => e.name !== "localSettings");
  const toolExec = JSON.parse(readFileSync(`${ROOT}docs/qa/tool-exec-judgment.json`, "utf8")) as JudgmentFiles["toolExec"];
  toolExec.judgments = toolExec.judgments.filter((e) => e.tool !== "BrandNewTool");
  return { writeDeny, toolExec };
};
const delta = (): Delta => ({
  writeDeny: {
    claudeCodeVersion: "9.9.9",
    add: {
      user: [{ name: "localSettings", judgment: "residual", reason: "a setting-source name, not a path" }],
      anywhere: [
        { name: "ide", judgment: "protected", userPath: "~/.claude/ide/", projectPath: ".claude/ide/", reason: "IDE connection records" },
        { name: "worktrees", judgment: "residual", reason: "vendor docs exclude it" },
      ],
    },
  },
  toolExec: { version: "2099-01-01", add: [{ tool: "BrandNewTool", judgment: "not-exec", reason: "test" }] },
});
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const anywhereNames = (f: JudgmentFiles): string[] => (f.writeDeny["anywhere"] as { name: string }[]).map((e) => e.name);

test("JA-applier/adds-entries-and-bumps-versions: entries land in their sections, versions move, nothing else changes", () => {
  const before = real();
  const after = applyDelta(clone(before), delta());
  assert.equal(after.writeDeny.claudeCodeVersion, "9.9.9");
  assert.equal(after.toolExec.version, "2099-01-01");
  assert.ok(after.writeDeny.user.some((e) => e.name === "localSettings"));
  assert.deepEqual(anywhereNames(after), ["ide", "worktrees"]);
  assert.ok(after.toolExec.judgments.some((e) => e.tool === "BrandNewTool"));
  assert.deepEqual(after.writeDeny.project, before.writeDeny.project, "untouched sections are unchanged");
  assert.equal(after.toolExec.judgments.length, before.toolExec.judgments.length + 1);
});

test("JA-applier/idempotent: applying the same delta twice gives a byte-identical result", () => {
  const once = applyDelta(clone(real()), delta());
  const twice = applyDelta(clone(once), delta());
  assert.equal(JSON.stringify(twice), JSON.stringify(once));
  assert.deepEqual(missingFromDelta(twice, delta()), []);
});

test("JA-applier/refuses-conflicting-overwrite: an existing entry with a different value is refused by add, never replaced", () => {
  const once = applyDelta(clone(real()), delta());
  const d = delta();
  d.writeDeny!.add!.user![0]!.judgment = "protected";
  d.writeDeny!.add!.user![0]!.path = "~/.claude/localSettings";
  assert.throws(() => applyDelta(clone(once), d), /conflict/);
  const t = delta();
  t.toolExec!.add![0]!.judgment = "exec-routed";
  assert.throws(() => applyDelta(clone(once), t), /conflict/);
});

test("JA-applier/refuses-bad-input: unknown judgment value, protected without its path(s), unknown section, empty reason, duplicate within the delta", () => {
  const bad = (mut: (d: Delta) => void): void => {
    const d = delta();
    mut(d);
    assert.throws(() => applyDelta(clone(real()), d));
  };
  bad((d) => { (d.writeDeny!.add!.user![0]! as { judgment: string }).judgment = "maybe"; });
  bad((d) => { delete d.writeDeny!.add!.anywhere![0]!.projectPath; });
  bad((d) => { delete d.writeDeny!.add!.anywhere![0]!.userPath; });
  bad((d) => { d.writeDeny!.add!.user!.push({ name: "x", judgment: "protected", reason: "no path" }); });
  bad((d) => { (d.writeDeny!.add as Record<string, unknown>)["nonsense"] = []; });
  bad((d) => { (d.writeDeny!.add as Record<string, unknown>)["userOutsideWindow"] = []; });
  bad((d) => { d.writeDeny!.add!.user![0]!.reason = " "; });
  bad((d) => { d.writeDeny!.add!.anywhere!.push({ name: "ide", judgment: "residual", reason: "dup" }); });
  bad((d) => { (d.toolExec!.add![0]! as { judgment: string }).judgment = "maybe"; });
});

test("JA-applier/mutant-dropped-entry: removing one applied entry is reported by missingFromDelta, exactly that one", () => {
  const after = applyDelta(clone(real()), delta());
  const mutant = clone(after);
  mutant.writeDeny["anywhere"] = (mutant.writeDeny["anywhere"] as { name: string }[]).filter((e) => e.name !== "worktrees");
  assert.deepEqual(missingFromDelta(mutant, delta()), ["writeDeny:anywhere:worktrees"]);
  const m2 = clone(after);
  m2.toolExec.judgments = m2.toolExec.judgments.filter((e) => e.tool !== "BrandNewTool");
  assert.deepEqual(missingFromDelta(m2, delta()), ["toolExec:BrandNewTool"]);
});

test("JA-applier/replace-op: a re-judgment names the previous value; a stale previous, a missing entry or a renamed entry is refused; a re-run is a no-op", () => {
  const once = applyDelta(clone(real()), delta());
  const prevWorktrees = { name: "worktrees", judgment: "residual", reason: "vendor docs exclude it" } as const;
  const next = { name: "worktrees", judgment: "protected", userPath: "~/.claude/worktrees/", projectPath: ".claude/worktrees/", reason: "re-judged" } as const;
  const d: Delta = { writeDeny: { replace: { anywhere: [{ previous: { ...prevWorktrees }, entry: { ...next } }] } } };
  const replaced = applyDelta(clone(once), d);
  assert.deepEqual((replaced.writeDeny["anywhere"] as unknown[]).slice(-1)[0], next);
  assert.equal(anywhereNames(replaced).length, anywhereNames(once).length, "replaced in place, not added");
  assert.equal(JSON.stringify(applyDelta(clone(replaced), d)), JSON.stringify(replaced), "re-run is a no-op");
  assert.deepEqual(missingFromDelta(replaced, d), []);
  const stale: Delta = { writeDeny: { replace: { anywhere: [{ previous: { ...prevWorktrees, reason: "not what is there" }, entry: { ...next } }] } } };
  assert.throws(() => applyDelta(clone(once), stale), /previous/);
  assert.throws(() => applyDelta(clone(real()), d), /nothing to replace/);
  const renamed: Delta = { writeDeny: { replace: { anywhere: [{ previous: { ...prevWorktrees }, entry: { ...next, name: "other" } }] } } };
  assert.throws(() => applyDelta(clone(once), renamed), /name/);
  const tool: Delta = { toolExec: { replace: [{ previous: { tool: "BrandNewTool", judgment: "not-exec", reason: "test" }, entry: { tool: "BrandNewTool", judgment: "exec-routed", reason: "re-judged" } }] } };
  assert.equal(applyDelta(clone(once), tool).toolExec.judgments.find((e) => e.tool === "BrandNewTool")!.judgment, "exec-routed");
  assert.throws(() => applyDelta(clone(once), { toolExec: { replace: [{ previous: { tool: "BrandNewTool", judgment: "exec-routed", reason: "wrong" }, entry: { tool: "BrandNewTool", judgment: "not-exec", reason: "x" } }] } }), /previous/);
});

test("JA-applier/version-field-validated: claudeCodeVersion must be x.y.z and the tool judgment version a date", () => {
  for (const v of ["", "2.1", "v2.1.289", "2.1.289-beta", "latest"]) {
    const d = delta();
    d.writeDeny!.claudeCodeVersion = v;
    assert.throws(() => applyDelta(clone(real()), d), /claudeCodeVersion/, v);
  }
  for (const v of ["", "yesterday", "2026-1-5", "2026-10-06T00:00"]) {
    const d = delta();
    d.toolExec!.version = v;
    assert.throws(() => applyDelta(clone(real()), d), /version/, v);
  }
  assert.doesNotThrow(() => applyDelta(clone(real()), delta()));
});

const okGit = (): undefined => undefined;
function sandbox(): { dir: string; paths: { writeDeny: string; toolExec: string }; deltaPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "ja-"));
  const paths = { writeDeny: join(dir, "wd.json"), toolExec: join(dir, "te.json") };
  const r = real();
  writeFileSync(paths.writeDeny, `${JSON.stringify(r.writeDeny, null, 2)}\n`);
  writeFileSync(paths.toolExec, `${JSON.stringify(r.toolExec, null, 2)}\n`);
  const deltaDir = join(dir, "deltas");
  mkdirSync(deltaDir);
  const deltaPath = join(deltaDir, "d1.json");
  writeFileSync(deltaPath, JSON.stringify(delta()));
  return { dir, paths, deltaPath };
}

test("JA-applier/files: applyFiles writes the same serialization the repo files use; a second run reports no change and leaves bytes alone", () => {
  const { dir, paths, deltaPath } = sandbox();
  const opts = { deltaDir: join(dir, "deltas"), gitCheck: okGit };
  const emptyPath = join(dir, "deltas", "empty.json");
  writeFileSync(emptyPath, "{}");
  assert.equal(applyFiles(emptyPath, paths, opts).changed, false, "the repo files round-trip through the serializer unchanged");
  const first = applyFiles(deltaPath, paths, opts);
  assert.equal(first.changed, true);
  const bytes = [readFileSync(paths.writeDeny, "utf8"), readFileSync(paths.toolExec, "utf8")];
  assert.ok(bytes.every((b) => b.endsWith("}\n")));
  const second = applyFiles(deltaPath, paths, opts);
  assert.equal(second.changed, false);
  assert.deepEqual([readFileSync(paths.writeDeny, "utf8"), readFileSync(paths.toolExec, "utf8")], bytes);
});

test("JA-applier/delta-dir-only: a delta outside docs/qa/judgment-deltas/ is refused, and the files are untouched", () => {
  const { dir, paths } = sandbox();
  const stray = join(dir, "stray.json");
  writeFileSync(stray, JSON.stringify(delta()));
  const before = readFileSync(paths.writeDeny, "utf8");
  assert.throws(() => applyFiles(stray, paths, { gitCheck: okGit }), /judgment-deltas/);
  assert.equal(readFileSync(paths.writeDeny, "utf8"), before);
  assert.ok(DELTA_DIR.endsWith("judgment-deltas"));
  assert.throws(() => applyFiles(join(dir, "deltas", "..", "stray.json"), paths, { deltaDir: join(dir, "deltas"), gitCheck: okGit }), /judgment-deltas/);
});

test("JA-applier/tracked-and-unmodified: a delta must be tracked in git and match HEAD; untracked and modified are refused", () => {
  const repo = mkdtempSync(join(tmpdir(), "ja-git-"));
  const git = (...args: string[]): string => execFileSync("git", ["-c", "user.email=tester", "-c", "user.name=t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", timeout: 30000 });
  git("init", "-q");
  const file = join(repo, "d1.json");
  writeFileSync(file, JSON.stringify(delta()));
  assert.match(gitTrackedAndClean(file) ?? "", /not tracked/);
  git("add", "d1.json");
  git("commit", "-q", "--no-verify", "-m", "delta");
  assert.equal(gitTrackedAndClean(file), undefined);
  writeFileSync(file, JSON.stringify({ ...delta(), extra: 1 }));
  assert.match(gitTrackedAndClean(file) ?? "", /modified/);
  git("add", "d1.json");
  assert.match(gitTrackedAndClean(file) ?? "", /modified/, "staged but not committed is still not the committed record");
  const { dir, paths, deltaPath } = sandbox();
  assert.throws(() => applyFiles(deltaPath, paths, { deltaDir: join(dir, "deltas"), gitCheck: () => "d1.json is not tracked in git" }), /not tracked/);
});

test("JA-applier/version-guard-typeof-and-calendar: a non-string version is refused with the same error, and a tool version must be a real calendar date", () => {
  for (const v of [2.1, null, ["2.1.289"], { v: "2.1.289" }, true]) {
    const d = delta();
    (d.writeDeny as { claudeCodeVersion?: unknown }).claudeCodeVersion = v;
    assert.throws(() => applyDelta(clone(real()), d), /claudeCodeVersion/, JSON.stringify(v));
    const t = delta();
    (t.toolExec as { version?: unknown }).version = v;
    assert.throws(() => applyDelta(clone(real()), t), /version/, JSON.stringify(v));
  }
  for (const v of ["2026-13-01", "2026-02-30", "2026-00-10", "2026-10-32", "0000-01-01"]) {
    const t = delta();
    t.toolExec!.version = v;
    assert.throws(() => applyDelta(clone(real()), t), /version/, v);
  }
  const ok = delta();
  ok.toolExec!.version = "2024-02-29";
  assert.doesNotThrow(() => applyDelta(clone(real()), ok));
});

test("JA-applier/applies-committed-blob-not-worktree: bytes hidden from git by assume-unchanged are not applied; the committed blob is", () => {
  const repo = mkdtempSync(join(tmpdir(), "ja-blob-"));
  const git = (...args: string[]): string => execFileSync("git", ["-c", "user.email=tester", "-c", "user.name=t", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8", timeout: 30000 });
  git("init", "-q");
  const deltaDir = join(repo, "deltas");
  mkdirSync(deltaDir);
  const file = join(deltaDir, "d1.json");
  writeFileSync(file, JSON.stringify({ toolExec: { version: "2030-01-01" } }));
  git("add", "deltas/d1.json");
  git("commit", "-q", "--no-verify", "-m", "delta");
  writeFileSync(file, JSON.stringify({ toolExec: { version: "2099-12-31" } }));
  git("update-index", "--assume-unchanged", "deltas/d1.json");
  const { paths } = sandbox();
  try {
    applyFiles(file, paths, { deltaDir });
  } catch {
    // a refusal is acceptable too
  }
  const version = (JSON.parse(readFileSync(paths.toolExec, "utf8")) as { version: string }).version;
  assert.notEqual(version, "2099-12-31", "the uncommitted work-tree bytes were not applied");
  assert.ok(version === "2030-01-01" || version === real().toolExec.version, `version is the committed value or unchanged, got ${version}`);
});
