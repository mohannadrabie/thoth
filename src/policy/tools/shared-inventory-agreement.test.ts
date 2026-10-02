// Story C of #308 (C5): SessionStart and the gate assemble the same catalog from the same inventory.
//   (i)  assembleCatalog over SessionStart's location (project-relative, resolved against the real repo root)
//        deep-equals assembleCatalog over the gate's location (module-relative), for the real files.
//   (ii) every non-mcp__ name in the vendored inventory is classified in both catalogs, with equal classes.
//   (iii) the real SessionStart hook, spawned in an isolated tree (so no halt-state is written into the repo),
//        reports no unclassified built-in when run over the real inventory.
// Seeded mutant: a project-relative fixture with one changed class makes (i) fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleCatalog, moduleRelativeFixtureLocation, resolveFixtureLocation } from "./classification-catalog.ts";
import { loadBuiltinToolInventory } from "./builtin-tool-inventory.ts";
import { fakeSessionId, runHook, sessionStartStdin } from "../../../hooks/test-support/spawn-hook.ts";
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

test("C5(iii): the real SessionStart hook over the real inventory reports no unclassified built-in", () => {
  const tree = makeFixtureTree("s308-c-agreement");
  try {
    const sessionId = fakeSessionId("s308-c");
    const result = runHook("hooks/sessionstart-tool-enum.mjs", sessionStartStdin({ sessionId }), fixtureEnv(tree));
    assert.equal(result.code, 0, result.stderr);
    const state = readHaltState(tree, sessionId) as { reasons?: Record<string, { set?: boolean; detail?: string }> } | undefined;
    const unclassified = state?.reasons?.["SUR-03-unclassified-tool"];
    assert.ok(unclassified?.set !== true, `unclassified built-in(s): ${unclassified?.detail ?? ""}`);
  } finally {
    tree.cleanup();
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
