// #308 story K stage 0, check K3 (K3-edit-deny-covers-fixture): every generated protected path has its Edit(...) deny entry in
// a settings file. The default suite runs it on the merge script's dry-run output and on mutants of it; the REAL settings file
// is checked only by `npm run qa:k-readiness` (red by design until K is wired), never here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { dryRunMergedText } from "./k-settings-merge.ts";
import { checkK3, K3_MUTANTS } from "./k3-edit-deny-covers-fixture.ts";
import { editDenyEntries, protectedPaths } from "./protected-path-list.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const merged = dryRunMergedText(REPO);
const paths = protectedPaths(REPO).all;

test("K3: passes on merge dry-run output", () => {
  const r = checkK3(merged, paths);
  assert.equal(r.ok, true, r.details.join("\n"));
  assert.equal(r.vacuous, false);
});

test("K3 mutant: drop fixture line", () => {
  const m = K3_MUTANTS.find((x) => x.name === "drop fixture line");
  assert.ok(m);
  const mutated = m.apply(merged, REPO);
  assert.notEqual(mutated, merged, "the mutant changed the text");
  assert.equal(checkK3(mutated, paths).ok, false);
});

test("K3 mutant: drop ~/ line", () => {
  const m = K3_MUTANTS.find((x) => x.name === "drop ~/ line");
  assert.ok(m);
  const mutated = m.apply(merged, REPO);
  assert.notEqual(mutated, merged, "the mutant changed the text");
  assert.equal(checkK3(mutated, paths).ok, false);
});

test("K3: every protected path's entries are individually required (instrument-driven over all paths)", () => {
  const parsed = JSON.parse(merged) as { permissions: { deny: string[] } };
  for (const p of paths) {
    for (const e of editDenyEntries(p)) {
      const without = { permissions: { deny: parsed.permissions.deny.filter((d) => d !== e) } };
      assert.equal(checkK3(JSON.stringify(without), paths).ok, false, `dropping ${e} must fail`);
    }
  }
});

test("K3: empty or malformed target fails", () => {
  for (const text of ["{}", '{"permissions":{}}', '{"permissions":{"deny":[]}}', '{"permissions":{"deny":"x"}}', "{ not json", "", "[]", "null"]) {
    const r = checkK3(text, paths);
    assert.equal(r.ok, false, text);
    assert.equal(r.vacuous, false);
  }
  assert.equal(checkK3(merged, []).ok, false, "an empty path list is not a pass");
});

test("K3: CLI takes a path argument, defaults to .claude/settings.json, exits 1 on any miss", () => {
  const dir = mkdtempSync(join(tmpdir(), "k0-k3-"));
  try {
    const good = join(dir, "good.json");
    writeFileSync(good, merged);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, '{"permissions":{"deny":["Bash(npm publish)"]}}');
    const run = (args: string[]): number | null => spawnSync(process.execPath, [join(REPO, "src/qa/k3-edit-deny-covers-fixture.ts"), ...args], { cwd: REPO, encoding: "utf8", timeout: 120000 }).status;
    assert.equal(run([good]), 0);
    assert.equal(run([bad]), 1);
    assert.equal(run([join(dir, "missing.json")]), 1);
    // The default path (the real settings file) is NOT run here: it is red by design until K is wired (see qa:k-readiness).
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
