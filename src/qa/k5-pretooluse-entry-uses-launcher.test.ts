// #308 story K stage 0, check K5 (K-pretooluse-entry-uses-launcher): the hooks.PreToolUse gate entry in a settings file equals the
// proposal's launcher command byte for byte and carries the proposal's matcher. Default CI runs it on the merge script's dry-run
// output and on the 8 seeded mutants; the real settings file is checked only by `npm run qa:k-readiness`.
// The matcher is compared to the proposal JSON's proposedMatcher AND run through the matcher-drift check's extractor (this closes #401 at K).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { dryRunMergedText, parseProposal, DEFAULT_PROPOSAL } from "./k-settings-merge.ts";
import { checkK5, K5_MUTANTS } from "./k5-pretooluse-entry-uses-launcher.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const proposal = parseProposal(readFileSync(join(REPO, DEFAULT_PROPOSAL), "utf8"));
const merged = dryRunMergedText(REPO);

test("K5: passes on dry-run output", () => {
  const r = checkK5(merged, proposal);
  assert.equal(r.ok, true, r.details.join("\n"));
  assert.equal(r.vacuous, false);
});

const EXPECTED = [
  "bare node gate",
  "trailing || true",
  "trailing ; exit 0",
  "echo launcher gate",
  "bash for sh",
  "PowerShell missing from matcher",
  "Monitor missing from matcher",
  "RemoteTrigger missing from matcher",
  "handler async true",
  "handler if never matches",
  "handler args empty",
  "handler shell powershell",
  "handler asyncRewake true",
  "handler once true",
  "handler statusMessage added",
  "handler unknown key",
  "top-level disableAllHooks true",
  "second PreToolUse group",
];
const NEUTERING = EXPECTED.slice(8);
for (const name of EXPECTED) {
  test(`K5 mutant: ${name}`, () => {
    const m = K5_MUTANTS.find((x) => x.name === name);
    assert.ok(m, `mutant ${name} exists`);
    const mutated = m.apply(merged);
    assert.notEqual(mutated, merged, "the mutant changed the text");
    assert.equal(checkK5(mutated, proposal).ok, false);
  });
}

test("K5: mutant list length asserted by instrument", () => {
  assert.equal(K5_MUTANTS.length, EXPECTED.length, "the mutant array and this test's list agree");
  assert.equal(new Set(K5_MUTANTS.map((m) => m.name)).size, K5_MUTANTS.length, "no duplicate mutant names");
  assert.deepEqual([...K5_MUTANTS.map((m) => m.name)].sort(), [...EXPECTED].sort());
});

test("K5: absent or duplicate entry fails", () => {
  const parsed = JSON.parse(merged) as { hooks: { PreToolUse: unknown[] } };
  const entry = parsed.hooks.PreToolUse[0];
  const absent = structuredClone(parsed);
  absent.hooks.PreToolUse = [];
  assert.equal(checkK5(JSON.stringify(absent), proposal).ok, false);
  const noHooks = { permissions: {} };
  assert.equal(checkK5(JSON.stringify(noHooks), proposal).ok, false);
  const dup = structuredClone(parsed);
  dup.hooks.PreToolUse = [entry, entry];
  assert.equal(checkK5(JSON.stringify(dup), proposal).ok, false);
  for (const text of ["{ not json", "", "[]", "null"]) assert.equal(checkK5(text, proposal).ok, false, text);
});

test("K5: a matcher token the vendored tool inventory lacks is reported by the drift extractor", () => {
  const parsed = JSON.parse(merged) as { hooks: { PreToolUse: { matcher: string }[] } };
  parsed.hooks.PreToolUse[0]!.matcher = `${proposal.proposedMatcher}|NoSuchTool`;
  const r = checkK5(JSON.stringify(parsed), { ...proposal, proposedMatcher: parsed.hooks.PreToolUse[0]!.matcher });
  assert.equal(r.ok, false);
  assert.match(r.details.join("\n"), /NoSuchTool/);
});

test("K5: CLI takes a path argument and exits 1 on a mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "k0-k5-"));
  try {
    const good = join(dir, "good.json");
    writeFileSync(good, merged);
    const m = K5_MUTANTS[0]!.apply(merged);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, m);
    const run = (args: string[]): number | null => spawnSync(process.execPath, [join(REPO, "src/qa/k5-pretooluse-entry-uses-launcher.ts"), ...args], { cwd: REPO, encoding: "utf8", timeout: 120000 }).status;
    assert.equal(run([good]), 0);
    assert.equal(run([bad]), 1);
    assert.equal(run([join(dir, "missing.json")]), 1);
    // The default path (the real settings file) is NOT run here: red by design until K is wired (see qa:k-readiness).
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("K5 mutant set: neutering handler keys and disableAllHooks fail", () => {
  assert.equal(NEUTERING.length, 10);
  for (const name of NEUTERING) {
    const m = K5_MUTANTS.find((x) => x.name === name);
    assert.ok(m, `mutant ${name} exists`);
    const mutated = m.apply(merged);
    assert.notEqual(mutated, merged, name);
    assert.equal(checkK5(mutated, proposal).ok, false, name);
  }
});

test("K5: top-level disableAllHooks false or absent passes, anything else fails", () => {
  const parsed = JSON.parse(merged) as Record<string, unknown>;
  assert.equal(checkK5(JSON.stringify({ ...parsed, disableAllHooks: false }), proposal).ok, true);
  for (const v of [true, "true", 1, null]) assert.equal(checkK5(JSON.stringify({ ...parsed, disableAllHooks: v }), proposal).ok, false, String(v));
});

test("K5: any PreToolUse group other than the gate entry fails", () => {
  const parsed = JSON.parse(merged) as { hooks: { PreToolUse: unknown[] } };
  const other = { matcher: "*", hooks: [{ type: "command", command: "node other.mjs", timeout: 5 }] };
  for (const groups of [[...parsed.hooks.PreToolUse, other], [other, ...parsed.hooks.PreToolUse]]) {
    const t = structuredClone(parsed);
    t.hooks.PreToolUse = groups;
    assert.equal(checkK5(JSON.stringify(t), proposal).ok, false);
  }
});
