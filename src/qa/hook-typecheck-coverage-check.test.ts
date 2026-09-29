// Issue #361 fix-now round (red-team round 2 finding R5). See hook-typecheck-coverage-check.ts's
// own header for the full design rationale (generated enumeration, pinned-baseline ratchet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkHookTypecheckCoverage, listProductionHooks, PINNED_BASELINES } from "./hook-typecheck-coverage-check.ts";

const repoRoot = process.cwd();

// --- listProductionHooks (AC-10: generated, not hand-derived) -------------------------------

test("listProductionHooks: enumerates exactly the 3 real production hooks from disk, generated via readdirSync, never hand-typed", () => {
  const hooks = listProductionHooks(repoRoot);
  assert.deepEqual(hooks, ["hooks/pretooluse-kernel-gate.mjs", "hooks/sessionstart-tool-enum.mjs", "hooks/userpromptsubmit-halt-relay.mjs"]);
});

test("listProductionHooks: excludes hooks/*.test.ts and hooks/test-support/** — a different, non-production concern", () => {
  const hooks = listProductionHooks(repoRoot);
  assert.ok(hooks.every((h) => h.endsWith(".mjs")), "every entry must be a production .mjs hook");
  assert.ok(!hooks.some((h) => h.includes("test-support")), "test-support/ files must not appear");
});

// --- checkHookTypecheckCoverage against the REAL project (AC-10/AC-11) ----------------------

test("checkHookTypecheckCoverage: all 3 real hooks resolve inside tsconfig.hooks-coverage.json's file list (AC-10), and the 2 excepted hooks stay within their pinned Issue #361 baseline (AC-11)", () => {
  const result = checkHookTypecheckCoverage(repoRoot);
  assert.equal(result.ok, true, result.details.join("\n"));
  const details = result.details.join("\n");
  assert.match(details, /hooks\/pretooluse-kernel-gate\.mjs: 0 diagnostic\(s\), fully covered/);
  assert.match(details, /hooks\/sessionstart-tool-enum\.mjs: \d+ diagnostic\(s\) \(pinned Issue #361 baseline: 30/);
  assert.match(details, /hooks\/userpromptsubmit-halt-relay\.mjs: \d+ diagnostic\(s\) \(pinned Issue #361 baseline: 22/);
});

test("checkHookTypecheckCoverage: a hook missing from the exception list must be fully clean (0 diagnostics) — pretooluse-kernel-gate.mjs, the one hook the real build gate already covers", () => {
  const result = checkHookTypecheckCoverage(repoRoot, ["hooks/pretooluse-kernel-gate.mjs"]);
  assert.equal(result.ok, true, result.details.join("\n"));
});

test("checkHookTypecheckCoverage: a hook not on the exception list and NOT fully clean fails, naming the diagnostic count", () => {
  // Neither excepted hook is expected to be zero-diagnostic today (30 and 22, measured); asserting
  // that WITHOUT the exception-list entry for one of them turns the pass into a fail proves the
  // "must be fully clean" branch is live, not dead code.
  const result = checkHookTypecheckCoverage(repoRoot, ["hooks/sessionstart-tool-enum.mjs"], {});
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /hooks\/sessionstart-tool-enum\.mjs: \d+ diagnostic\(s\) found, expected 0/);
});

test("checkHookTypecheckCoverage: a hook absent from the tsconfig project's file list at all fails, naming the gap", () => {
  const result = checkHookTypecheckCoverage(repoRoot, ["hooks/does-not-exist.mjs"]);
  assert.equal(result.ok, false);
  assert.match(result.details.join("\n"), /hooks\/does-not-exist\.mjs: does not resolve inside/);
});

// --- AC-13 regression pin: a dropped required argument in an EXCEPTED hook still fails ------

// Issue #361 fix-now round (red-team round 2 finding R5, AC-13): dropping a required argument in
// hooks/sessionstart-tool-enum.mjs (evaluateToolInventory(merged, sessionTools) ->
// evaluateToolInventory(merged)) gives `npm run build` rc=0 today (the file is outside
// tsconfig.hooks.json's include, so it is never typechecked by the real build gate at all) — this
// pin proves the NEW instrument catches it anyway, even though the file is on the pinned-baseline
// exception list (not held to zero). The mutation is derived by a literal string-replace against
// the REAL file's CURRENT content (never a hand-copied snapshot), so this pin cannot silently go
// stale if the real file's surrounding code changes; a precondition assertion fails loudly first if
// the exact call-site text this drill targets ever stops existing.
test("AC-13: dropping evaluateToolInventory's second argument in hooks/sessionstart-tool-enum.mjs is caught by the new instrument, exceeding its pinned Issue #361 baseline, even though npm run build (real build gate) does not cover this file at all", () => {
  const real = readFileSync(join(repoRoot, "hooks", "sessionstart-tool-enum.mjs"), "utf8");
  const target = "evaluateToolInventory(merged, sessionTools)";
  assert.ok(real.includes(target), `precondition: the exact call-site text "${target}" must exist in the real file for this drill to be meaningful`);
  const mutated = real.replace(target, "evaluateToolInventory(merged)");

  // Placed as a SIBLING of hooks/ and src/ (both directly under repoRoot) so the mutated file's own
  // `../src/...` relative imports resolve to the REAL src/ tree, exactly as they do from hooks/
  // itself — giving faithful, not approximated, diagnostics.
  const tmpDir = join(repoRoot, `.qa-tmp-ac13-${process.pid}-${Date.now()}`);
  const tmpHookRel = "sessionstart-tool-enum.mjs";
  const tmpConfigPath = join(tmpDir, "tsconfig.json");
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, tmpHookRel), mutated, "utf8");
    writeFileSync(
      tmpConfigPath,
      JSON.stringify(
        {
          extends: "../tsconfig.json",
          compilerOptions: { allowJs: true, checkJs: true, noEmit: true },
          include: [tmpHookRel],
        },
        null,
        2,
      ),
      "utf8",
    );

    const tmpRel = `${tmpDir.slice(repoRoot.length + 1).split("\\").join("/")}/${tmpHookRel}`;
    const before = checkHookTypecheckCoverage(repoRoot, ["hooks/sessionstart-tool-enum.mjs"], PINNED_BASELINES);
    assert.equal(before.ok, true, "sanity: the REAL, unmutated file must stay within its pinned baseline");

    const realBaseline = PINNED_BASELINES["hooks/sessionstart-tool-enum.mjs"];
    assert.ok(realBaseline !== undefined, "precondition: the real hook must have a pinned baseline to compare against");
    const after = checkHookTypecheckCoverage(repoRoot, [tmpRel], { [tmpRel]: realBaseline }, tmpConfigPath);
    assert.equal(after.ok, false, "the mutated file must exceed the pinned baseline (a NEW TS2554 arity diagnostic), even though it is a currently-excepted hook");
    assert.match(after.details.join("\n"), /exceeds its pinned Issue #361 baseline/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
