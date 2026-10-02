// Issue #374 / #361 round 3 (red-team round-2 LOW 3): the degraded-arm guard in
// computeSessionTools -- `if (fixtureLocation.fixtureSource === "unknown") throw ...` -- had no test.
// Turning the throw into a clean `return` survived every existing test. This drives the REAL hook
// process down the degraded path (resolveFixtureLocation throws -> main() falls back to
// `{ fixtureSource: "unknown" }`) and pins the fail-closed outcome AND the guard's own message: a
// clean return, or a different failure, cannot produce that exact detail.
//
// resolveFixtureLocation is forced to throw by a NODE_OPTIONS --import preload that makes
// fs.existsSync throw for the fixture path only (no production code is touched; the preload is
// written to a temp dir).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runHook, sessionStartStdin, fakeSessionId } from "./test-support/spawn-hook.ts";
import { makeFixtureTree, readHaltState, fixtureEnv } from "./test-support/fixture-tree.ts";

const PRELOAD = [
  'import fs from "node:fs";',
  'import { syncBuiltinESMExports } from "node:module";',
  "const real = fs.existsSync;",
  "fs.existsSync = (p) => {",
  '  if (String(p).endsWith("s5-central-classification.json")) throw new Error("forced: fixture location cannot be resolved");',
  "  return real(p);",
  "};",
  "syncBuiltinESMExports();",
  "",
].join("\n");

test("#374 r3: when the fixture location cannot be resolved, computeSessionTools' guard throws and the hook fails CLOSED (ENUMERATION_FAILED set:true, guard message in the detail, exit 0)", () => {
  const tree = makeFixtureTree("degraded-guard");
  const preloadDir = mkdtempSync(join(tmpdir(), "thoth-degraded-preload-"));
  try {
    const preload = join(preloadDir, "preload.mjs");
    writeFileSync(preload, PRELOAD, "utf8");
    const sessionId = fakeSessionId("degraded-guard");
    const env = { ...fixtureEnv(tree), NODE_OPTIONS: `--import ${pathToFileURL(preload).href}` };
    const result = runHook("hooks/sessionstart-tool-enum.mjs", sessionStartStdin({ sessionId }), env);
    assert.equal(result.code, 0, `SessionStart never exits non-zero; stderr=${result.stderr}`);
    assert.match(result.stderr, /failed to resolve fixture location/, "the degraded arm was actually reached");
    const state = readHaltState(tree, sessionId) as { reasons?: Record<string, { set?: unknown; detail?: unknown }> } | undefined;
    const reason = state?.reasons?.["SUR-03-enumeration-failed"];
    assert.equal(reason?.set, true, `expected a fail-closed halt; got ${JSON.stringify(state)} stderr=${result.stderr}`);
    assert.match(String(reason?.detail), /the classification fixture location could not be resolved/, "the halt must come from the guard's own throw, not from a downstream failure");
  } finally {
    rmSync(preloadDir, { recursive: true, force: true });
    tree.cleanup();
  }
});
