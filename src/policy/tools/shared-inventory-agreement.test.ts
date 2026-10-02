// Story C of #308 (C5): SessionStart and the gate assemble the same catalog from the same inventory.
//   (i)  assembleCatalog over SessionStart's location (project-relative, resolved against the real repo root)
//        deep-equals assembleCatalog over the gate's location (module-relative), for the real files.
//   (ii) every non-mcp__ name in the vendored inventory is classified in both catalogs, with equal classes.
//   (iii) the real SessionStart hook, spawned in an isolated tree (so no halt-state is written into the repo),
//        reports no unclassified built-in when run over the real inventory.
// Seeded mutants: a project-relative fixture with one changed class makes (i) fail; a temp copy of the tree with one
// built-in (Monitor) deleted from CLASSIFICATION makes (iii) fail.
//
// WHAT EACH CHECKS (Issue #386): (i) and (ii) call the same assembleCatalog twice over one fixture file, so they check
// LOCATION agreement only (project-relative vs module-relative resolve to the same content); they cannot see a
// divergence in what each hook builds. (iii) is the only check that runs a hook over the real inventory: when a
// built-in is unclassified, assembleCatalog throws ClassificationCatalogError, the hook catches it and exits 0, and
// the failure surfaces as the SUR-03-enumeration-failed halt reason, so (iii) asserts that reason (and the
// unclassified-tool reason) is NOT set. The gate hook is not run here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleCatalog, moduleRelativeFixtureLocation, resolveFixtureLocation } from "./classification-catalog.ts";
import { loadBuiltinToolInventory } from "./builtin-tool-inventory.ts";
import { fakeSessionId, sessionStartStdin } from "../../../hooks/test-support/spawn-hook.ts";
import { fixtureEnv, makeFixtureTree, readHaltState } from "../../../hooks/test-support/fixture-tree.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("C5(i): SessionStart's and the gate's catalogs are deep-equal over the real repo", () => {
  assert.equal(resolveFixtureLocation(REPO_ROOT).fixtureSource, "project-relative");
  const sessionStart = assembleCatalog(resolveFixtureLocation(REPO_ROOT));
  const gate = assembleCatalog(moduleRelativeFixtureLocation());
  assert.deepEqual(sessionStart.merged, gate.merged);
  assert.deepEqual(sessionStart.builtinLayer, gate.builtinLayer);
});

test("C5(ii): every built-in in the inventory is classified in both catalogs with equal classes", () => {
  const builtins = loadBuiltinToolInventory().tools.filter((n) => !n.startsWith("mcp__"));
  assert.ok(builtins.length > 0);
  const a = assembleCatalog(resolveFixtureLocation(REPO_ROOT)).merged;
  const b = assembleCatalog(moduleRelativeFixtureLocation()).merged;
  for (const name of builtins) {
    const ca = a.tools.find((t) => t.name === name)?.class;
    const cb = b.tools.find((t) => t.name === name)?.class;
    assert.ok(ca !== undefined, `${name} unclassified in the SessionStart catalog`);
    assert.equal(ca, cb, name);
  }
});

interface Reasons {
  reasons?: Record<string, { set?: boolean; detail?: string }>;
}

/** Runs the real SessionStart hook found under `root` (a repo checkout or a temp copy) in an isolated project/home
 * tree and returns the halt reasons it wrote. */
function runSessionStartUnder(root: string, label: string): { code: number | null; stderr: string; set: string[]; detail: string } {
  const tree = makeFixtureTree(label);
  try {
    const sessionId = fakeSessionId(label);
    const r = spawnSync(process.execPath, [path.join(root, "hooks", "sessionstart-tool-enum.mjs")], {
      input: JSON.stringify(sessionStartStdin({ sessionId })),
      encoding: "utf8",
      env: { ...process.env, ...fixtureEnv(tree) },
      timeout: 30_000,
      windowsHide: true,
    });
    const state = readHaltState(tree, sessionId) as Reasons | undefined;
    const reasons = state?.reasons ?? {};
    const set = Object.keys(reasons).filter((k) => reasons[k]?.set === true);
    return { code: r.status, stderr: r.stderr, set, detail: set.map((k) => `${k}: ${reasons[k]?.detail ?? ""}`).join(" | ") };
  } finally {
    tree.cleanup();
  }
}

const CATALOG_FAILURE_REASONS = ["SUR-03-enumeration-failed", "SUR-03-unclassified-tool"];

test("C5(iii): the real SessionStart hook over the real inventory sets no catalog-failure or unclassified halt reason", () => {
  const run = runSessionStartUnder(REPO_ROOT, "s308-c-agreement");
  assert.equal(run.code, 0, run.stderr);
  for (const key of CATALOG_FAILURE_REASONS) assert.ok(!run.set.includes(key), `${key} is set: ${run.detail}`);
});

test("C5(iii) seeded mutant: a temp copy of the tree with Monitor deleted from CLASSIFICATION sets the catalog-failure reason", () => {
  const copy = mkdtempSync(path.join(tmpdir(), "thoth-s308-c-mutant-"));
  try {
    for (const dir of ["src", "hooks", "docs/qa"]) {
      cpSync(path.join(REPO_ROOT, dir), path.join(copy, dir), { recursive: true });
    }
    cpSync(path.join(REPO_ROOT, "package.json"), path.join(copy, "package.json"));
    const clean = runSessionStartUnder(copy, "s308-c-copy-clean");
    assert.deepEqual(CATALOG_FAILURE_REASONS.filter((k) => clean.set.includes(k)), [], `the unmutated copy must be clean: ${clean.detail}`);
    const target = path.join(copy, "src", "policy", "tools", "builtin-tool-inventory.ts");
    const before = readFileSync(target, "utf8");
    const after = before.split("\n").filter((l) => !/^\s*Monitor:/.test(l)).join("\n");
    assert.notEqual(after, before, "the Monitor entry was found and removed");
    writeFileSync(target, after);
    const mutant = runSessionStartUnder(copy, "s308-c-copy-mutant");
    assert.ok(CATALOG_FAILURE_REASONS.some((k) => mutant.set.includes(k)), `expected a catalog-failure reason; set: ${mutant.set.join(",")}`);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("C5 seeded mutant: a project-relative fixture with one changed class makes the two catalogs differ", () => {
  const tree = makeFixtureTree("s308-c-mutant");
  try {
    const real = JSON.parse(readFileSync(path.join(REPO_ROOT, "docs", "qa", "s5-central-classification.json"), "utf8")) as {
      centralLayer: { tools: Array<{ name: string; class: string }> };
    };
    const first = real.centralLayer.tools[0];
    assert.ok(first !== undefined);
    first.class = first.class === "remote-mutating" ? "workspace-mutating" : "remote-mutating";
    const dir = path.join(tree.projectDir, "docs", "qa");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "s5-central-classification.json"), JSON.stringify(real));
    const mutant = assembleCatalog(resolveFixtureLocation(tree.projectDir));
    const gate = assembleCatalog(moduleRelativeFixtureLocation());
    assert.notDeepEqual(mutant.merged, gate.merged);
  } finally {
    tree.cleanup();
  }
});
