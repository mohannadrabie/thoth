// #308 story K stage 0: the generated settings-merge script. It computes the settings text story K would write; it wires nothing.
// The checked-in fixture docs/qa/k-proposed-merged-settings.fixture.txt is PRODUCED BY THE CLI, never hand-edited. Regenerate with:
//   node src/qa/k-settings-merge.ts --out=docs/qa/k-proposed-merged-settings.fixture.txt
// (the test "dry-run output equals checked-in proposed-settings fixture" fails when the fixture is out of sync with the CLI output).
// The fixture has a .txt extension on purpose: the one-gate-manifest check (SUR-13) counts every .json file with a top-level hooks key.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { editDenyEntries, NESTED_EDIT_GLOBS, protectedPaths } from "./protected-path-list.ts";
import { dryRunMergedText, generatedEditDenies, mergeSettings, type GateProposal } from "./k-settings-merge.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(REPO, "src/qa/k-settings-merge.ts");
const FIXTURE = join(REPO, "docs/qa/k-proposed-merged-settings.fixture.txt");
const PROPOSAL: GateProposal = {
  proposedMatcher: "Bash|Monitor|PowerShell|RemoteTrigger|mcp__.*",
  proposedCommand: 'sh "${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh" "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs"',
  timeout: 60,
};
const BASE = {
  "//": ["a comment array", "kept verbatim"],
  permissions: { defaultMode: "default", deny: ["Bash(npm publish)", "Bash(git push -f *)"] },
  enableAllProjectMcpServers: false,
  hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node x", timeout: 10 }] }] },
};
const EDITS = ["Edit(/b)", "Edit(/a)", "Edit(/a)"];

const cli = (args: string[]): { code: number | null; out: string; err: string } => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd: REPO, timeout: 120000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test("k-merge: existing keys preserved byte-semantically", () => {
  const before = structuredClone(BASE);
  const merged = mergeSettings(BASE, PROPOSAL, EDITS) as typeof BASE;
  assert.deepEqual(BASE, before, "input is not mutated");
  assert.deepEqual(merged["//"], BASE["//"]);
  assert.equal(merged.enableAllProjectMcpServers, false);
  assert.equal(merged.permissions.defaultMode, "default");
  assert.deepEqual(merged.hooks.SessionStart, BASE.hooks.SessionStart);
  assert.deepEqual(Object.keys(merged), Object.keys(BASE), "key order kept");
});

test("k-merge: appends the proposal entry", () => {
  const merged = mergeSettings(BASE, PROPOSAL, EDITS) as { hooks: { PreToolUse: unknown[] } };
  assert.deepEqual(merged.hooks.PreToolUse, [{ matcher: PROPOSAL.proposedMatcher, hooks: [{ type: "command", command: PROPOSAL.proposedCommand, timeout: 60 }] }]);
});

test("k-merge: second merge is a no-op", () => {
  const once = mergeSettings(BASE, PROPOSAL, EDITS);
  assert.deepEqual(mergeSettings(once, PROPOSAL, EDITS), once);
});

test("k-merge: refuses a conflicting existing gate entry (never silently duplicates)", () => {
  const conflicting = structuredClone(BASE) as Record<string, unknown>;
  (conflicting.hooks as Record<string, unknown>).PreToolUse = [{ matcher: "Bash", hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs"', timeout: 60 }] }];
  assert.throws(() => mergeSettings(conflicting, PROPOSAL, EDITS), /conflicting/);
});

test("k-merge: deny = existing Bash + generated Edit, sorted, deduped", () => {
  const merged = mergeSettings(BASE, PROPOSAL, EDITS) as { permissions: { deny: string[] } };
  assert.deepEqual(merged.permissions.deny, ["Bash(git push -f *)", "Bash(npm publish)", "Edit(/a)", "Edit(/b)"]);
  const real = generatedEditDenies(REPO);
  const expected = [...new Set([...protectedPaths(REPO).all.flatMap(editDenyEntries), ...NESTED_EDIT_GLOBS])].sort();
  assert.deepEqual(real, expected, "the Edit set is generated from protectedPaths, editDenyEntries and NESTED_EDIT_GLOBS");
  assert.ok(real.length > 100);
});

test("k-merge CLI: dry-run default writes nothing; --write writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "k0-merge-"));
  try {
    const f = join(dir, "settings.json");
    const original = `${JSON.stringify(BASE, null, 2)}\n`;
    writeFileSync(f, original);
    const dry = cli([`--settings=${f}`]);
    assert.equal(dry.code, 0, dry.err);
    assert.equal(readFileSync(f, "utf8"), original, "dry run did not touch the file");
    assert.equal((JSON.parse(dry.out) as { hooks: { PreToolUse: unknown[] } }).hooks.PreToolUse.length, 1);
    const w = cli([`--settings=${f}`, "--write"]);
    assert.equal(w.code, 0, w.err);
    assert.equal(readFileSync(f, "utf8"), dry.out, "--write writes exactly what the dry run printed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("k-merge: dry-run output equals checked-in proposed-settings fixture", () => {
  const norm = (s: string): string => s.replaceAll("\r\n", "\n");
  const want = norm(readFileSync(FIXTURE, "utf8"));
  assert.equal(norm(dryRunMergedText(REPO)), want, "fixture out of sync: regenerate with node src/qa/k-settings-merge.ts --out=docs/qa/k-proposed-merged-settings.fixture.txt (never hand-edit)");
  assert.equal(norm(cli([]).out), want, "the CLI default dry run matches the fixture");
});

test("k-merge: fails closed on bad input", () => {
  const dir = mkdtempSync(join(tmpdir(), "k0-merge-"));
  try {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    const arr = join(dir, "arr.json");
    writeFileSync(arr, "[]");
    const noMatcher = join(dir, "proposal.json");
    writeFileSync(noMatcher, JSON.stringify({ proposedCommand: PROPOSAL.proposedCommand, timeout: 60 }));
    const noCommand = join(dir, "proposal2.json");
    writeFileSync(noCommand, JSON.stringify({ proposedMatcher: "Bash", timeout: 60 }));
    for (const args of [[`--settings=${bad}`], [`--settings=${arr}`], [`--settings=${join(dir, "missing.json")}`], [`--proposal=${noMatcher}`], [`--proposal=${noCommand}`], ["--bogus"]]) {
      const r = cli(args);
      assert.notEqual(r.code, 0, args.join(" "));
      assert.equal(r.out, "", `nothing on stdout: ${args.join(" ")}`);
      assert.ok(r.err.length > 0);
    }
    assert.throws(() => mergeSettings(BASE, { ...PROPOSAL, proposedMatcher: "" }, EDITS));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("k-merge: an env block or disableAllHooks in the input is reported on stderr", () => {
  const dir = mkdtempSync(join(tmpdir(), "k0-merge-"));
  try {
    const f = join(dir, "settings.json");
    writeFileSync(f, JSON.stringify({ ...BASE, disableAllHooks: true, env: { NODE_OPTIONS: "--bogus" } }));
    const r = cli([`--settings=${f}`]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /disableAllHooks/);
    assert.match(r.err, /env block/);
    assert.ok(!r.out.includes("warning"), "stdout stays the settings text only");
    const clean = join(dir, "clean.json");
    writeFileSync(clean, JSON.stringify(BASE));
    assert.equal(cli([`--settings=${clean}`]).err, "", "no warning for a clean input");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
