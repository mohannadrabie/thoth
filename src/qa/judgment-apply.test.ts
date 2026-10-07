// #463 / #467 (S7, k-blocker, story a1): the judgment applier. Judgment files change only through it, from a committed approved-delta
// file; re-running it changes nothing. Written FAILING FIRST.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDelta, applyFiles, missingFromDelta, type Delta, type JudgmentFiles } from "./judgment-apply.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const real = (): JudgmentFiles => ({
  writeDeny: JSON.parse(readFileSync(`${ROOT}docs/qa/claude-code-write-deny-judgment.json`, "utf8")) as JudgmentFiles["writeDeny"],
  toolExec: JSON.parse(readFileSync(`${ROOT}docs/qa/tool-exec-judgment.json`, "utf8")) as JudgmentFiles["toolExec"],
});
const delta = (): Delta => ({
  writeDeny: {
    claudeCodeVersion: "9.9.9",
    add: {
      user: [{ name: "localSettings", judgment: "residual", reason: "a setting-source name, not a path" }],
      projectOutsideWindow: [
        { name: "ide", judgment: "protected", path: ".claude/ide/", reason: "IDE connection records" },
        { name: "worktrees", judgment: "residual", reason: "vendor docs exclude it" },
      ],
    },
  },
  toolExec: { version: "2099-01-01", add: [{ tool: "BrandNewTool", judgment: "not-exec", reason: "test" }] },
});
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test("JA-applier/adds-entries-and-bumps-versions: entries land in their sections, versions move, nothing else changes", () => {
  const before = real();
  const after = applyDelta(clone(before), delta());
  assert.equal(after.writeDeny.claudeCodeVersion, "9.9.9");
  assert.equal(after.toolExec.version, "2099-01-01");
  assert.ok(after.writeDeny.user.some((e) => e.name === "localSettings"));
  assert.deepEqual((after.writeDeny["projectOutsideWindow"] as { name: string }[]).map((e) => e.name), ["ide", "worktrees"]);
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

test("JA-applier/refuses-conflicting-overwrite: an existing entry with a different value is refused, never replaced", () => {
  const once = applyDelta(clone(real()), delta());
  const d = delta();
  d.writeDeny!.add!.user![0]!.judgment = "protected";
  d.writeDeny!.add!.user![0]!.path = "~/.claude/localSettings";
  assert.throws(() => applyDelta(clone(once), d), /conflict/);
  const t = delta();
  t.toolExec!.add![0]!.judgment = "exec-routed";
  assert.throws(() => applyDelta(clone(once), t), /conflict/);
});

test("JA-applier/refuses-bad-input: unknown judgment value, protected without a path, unknown section, empty reason, duplicate within the delta", () => {
  const bad = (mut: (d: Delta) => void): void => {
    const d = delta();
    mut(d);
    assert.throws(() => applyDelta(clone(real()), d));
  };
  bad((d) => { (d.writeDeny!.add!.user![0]! as { judgment: string }).judgment = "maybe"; });
  bad((d) => { delete d.writeDeny!.add!.projectOutsideWindow![0]!.path; });
  bad((d) => { (d.writeDeny!.add as Record<string, unknown>)["nonsense"] = []; });
  bad((d) => { d.writeDeny!.add!.user![0]!.reason = " "; });
  bad((d) => { d.writeDeny!.add!.projectOutsideWindow!.push({ name: "ide", judgment: "residual", reason: "dup" }); });
  bad((d) => { (d.toolExec!.add![0]! as { judgment: string }).judgment = "maybe"; });
});

test("JA-applier/mutant-dropped-entry: removing one applied entry is reported by missingFromDelta, exactly that one", () => {
  const after = applyDelta(clone(real()), delta());
  const mutant = clone(after);
  mutant.writeDeny["projectOutsideWindow"] = (mutant.writeDeny["projectOutsideWindow"] as { name: string }[]).filter((e) => e.name !== "worktrees");
  assert.deepEqual(missingFromDelta(mutant, delta()), ["writeDeny:projectOutsideWindow:worktrees"]);
  const m2 = clone(after);
  m2.toolExec.judgments = m2.toolExec.judgments.filter((e) => e.tool !== "BrandNewTool");
  assert.deepEqual(missingFromDelta(m2, delta()), ["toolExec:BrandNewTool"]);
});

test("JA-applier/files: applyFiles writes the same serialization the repo files use; a second run reports no change and leaves bytes alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "ja-"));
  const paths = { writeDeny: join(dir, "wd.json"), toolExec: join(dir, "te.json") };
  const r = real();
  writeFileSync(paths.writeDeny, `${JSON.stringify(r.writeDeny, null, 2)}\n`);
  writeFileSync(paths.toolExec, `${JSON.stringify(r.toolExec, null, 2)}\n`);
  const deltaPath = join(dir, "delta.json");
  writeFileSync(deltaPath, JSON.stringify(delta()));
  const emptyPath = join(dir, "empty.json");
  writeFileSync(emptyPath, "{}");
  assert.equal(applyFiles(emptyPath, paths).changed, false, "the repo files round-trip through the serializer unchanged");
  const first = applyFiles(deltaPath, paths);
  assert.equal(first.changed, true);
  const bytes = [readFileSync(paths.writeDeny, "utf8"), readFileSync(paths.toolExec, "utf8")];
  assert.ok(bytes.every((b) => b.endsWith("}\n")));
  const second = applyFiles(deltaPath, paths);
  assert.equal(second.changed, false);
  assert.deepEqual([readFileSync(paths.writeDeny, "utf8"), readFileSync(paths.toolExec, "utf8")], bytes);
});
