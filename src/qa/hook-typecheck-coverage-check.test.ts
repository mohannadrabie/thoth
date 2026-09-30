// Issue #361 fix-now round (red-team round 2 finding R5). See hook-typecheck-coverage-check.ts's
// own header for the full design rationale (generated enumeration, pinned-baseline ratchet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkHookTypecheckCoverage, JSDOC_ANY_ALLOWLIST, listProductionHooks, PINNED_BASELINES } from "./hook-typecheck-coverage-check.ts";

const repoRoot = process.cwd();

// Issue #367 (app-security HIGH, demonstrated): a `// @ts-ignore`/`@ts-expect-error` directly above
// a real new bug removes that bug's diagnostic from `ts.getPreEmitDiagnostics`'s output ENTIRELY —
// no diagnostic-counting or -identity scheme (this file's own PINNED_BASELINES fix included) can
// detect a bug whose own diagnostic never exists. Closed instead at the source: `eslint.config.mjs`
// bans both pragmas (and `@ts-nocheck`) under `hooks/**/*.mjs` via `@typescript-eslint/ban-ts-comment`
// — this test is the direct, always-current proof that the real tree has none today, backing up
// (not replacing) the ESLint rule itself, which is what actually gates a future reintroduction in CI.
test("Issue #367: no hooks/*.mjs file contains @ts-ignore, @ts-expect-error, or @ts-nocheck — the suppression vector the pinned-baseline ratchet alone cannot detect", () => {
  for (const hook of listProductionHooks(repoRoot)) {
    const source = readFileSync(join(repoRoot, hook), "utf8");
    assert.ok(!/@ts-(?:ignore|expect-error|nocheck)\b/.test(source), `${hook}: must not contain a TypeScript suppression pragma (banned by eslint.config.mjs under hooks/**/*.mjs)`);
  }
});

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

test("checkHookTypecheckCoverage: all 3 real hooks resolve inside tsconfig.hooks-coverage.json's file list (AC-10), and the 2 formerly-excepted hooks are now fully clean against an empty pinned baseline (AC-11, Issue #361 closed)", () => {
  const result = checkHookTypecheckCoverage(repoRoot);
  assert.equal(result.ok, true, result.details.join("\n"));
  const details = result.details.join("\n");
  assert.match(details, /hooks\/pretooluse-kernel-gate\.mjs: 0 diagnostic\(s\), fully covered/);
  assert.match(details, /hooks\/sessionstart-tool-enum\.mjs: 0 diagnostic\(s\), fully covered/);
  assert.match(details, /hooks\/userpromptsubmit-halt-relay\.mjs: 0 diagnostic\(s\), fully covered/);
});

test("checkHookTypecheckCoverage: a hook with no pinned baseline must be fully clean (0 diagnostics) — pretooluse-kernel-gate.mjs, the one hook the real build gate already covers", () => {
  const result = checkHookTypecheckCoverage(repoRoot, ["hooks/pretooluse-kernel-gate.mjs"]);
  assert.equal(result.ok, true, result.details.join("\n"));
});

test("checkHookTypecheckCoverage: a hook with no pinned baseline and NOT fully clean fails, naming the diagnostic count", () => {
  // The real hooks are all clean now (Issue #361), so a self-contained fixture with one implicit-any
  // diagnostic proves the "must be fully clean" branch is live, not dead code.
  const tmpDir = join(repoRoot, `.qa-tmp-notclean-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "hook.mjs"), "function f(a) { return a; }\n", "utf8");
    const configPath = join(tmpDir, "tsconfig.json");
    writeFileSync(configPath, JSON.stringify({ extends: "../tsconfig.json", compilerOptions: { allowJs: true, checkJs: true, noEmit: true }, include: ["hook.mjs"] }, null, 2), "utf8");
    const tmpRel = `${tmpDir.slice(repoRoot.length + 1).split("\\").join("/")}/hook.mjs`;
    const result = checkHookTypecheckCoverage(repoRoot, [tmpRel], {}, configPath);
    assert.equal(result.ok, false);
    assert.match(result.details.join("\n"), /1 diagnostic\(s\) found, expected 0/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
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
test("AC-13: dropping evaluateToolInventory's second argument in hooks/sessionstart-tool-enum.mjs is caught by the new instrument, a NEW diagnostic against its (empty) pinned baseline; tsconfig.hooks.json, the real build gate, also covers this file", () => {
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
    const after = checkHookTypecheckCoverage(repoRoot, [tmpRel], { [tmpRel]: realBaseline }, tmpConfigPath, JSDOC_ANY_ALLOWLIST.map((e) => (e.hook === "hooks/sessionstart-tool-enum.mjs" ? { ...e, hook: tmpRel } : e)));
    assert.equal(after.ok, false, "the mutated file must exceed the pinned baseline (a NEW TS2554 arity diagnostic), as it does for any hook");
    assert.match(after.details.join("\n"), /exceed the pinned baseline/);
    assert.match(after.details.join("\n"), /2554:\d+ \(new, x1\)/, "the new diagnostic's own identity must be named, not just a count delta");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Red-team round-3 finding R4, drill C2 (demonstrated): a raw COUNT comparison is gameable by
// OFFSET — pay down one pre-existing diagnostic while introducing one real new bug elsewhere, and
// the total count stays exactly at baseline. Issue #361 (2026-09-30) emptied the real baseline, so
// the drill now runs against a self-contained fixture that carries two known implicit-any debts
// pinned by identity; the mutation is a literal string-replace against that fixture (never a
// hand-copied snapshot), guarded by precondition assertions.
test("R4 regression (drill C2): paying down one pre-existing diagnostic while introducing one real new bug elsewhere must still fail — a raw count comparison would see no change at all", () => {
  const fixture = ["function paid(id) { return id; }", "function other(x) { return x; }", "/** @param {number} n */", "function need(n) { return n; }", ""].join("\n");
  const paydownTarget = "function paid(id) { return id; }";
  assert.ok(fixture.includes(paydownTarget), `precondition: the paydown target "${paydownTarget}" must exist in the fixture`);
  const pinned = ["7006|function paid(id) { return id; }", "7006|function other(x) { return x; }"];
  const mutated = fixture
    .replace(paydownTarget, "function paid(/** @type {string} */ id) { return id; }") // -1 diagnostic: kills one TS7006
    .concat("need();\n"); // +1 diagnostic: drops a required argument (TS2554)

  const tmpDir = join(repoRoot, `.qa-tmp-c2-${process.pid}-${Date.now()}`);
  const tmpHookRel = "hook.mjs";
  const tmpConfigPath = join(tmpDir, "tsconfig.json");
  const cfg = JSON.stringify({ extends: "../tsconfig.json", compilerOptions: { allowJs: true, checkJs: true, noEmit: true }, include: [tmpHookRel] }, null, 2);
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpConfigPath, cfg, "utf8");
    const tmpRel = `${tmpDir.slice(repoRoot.length + 1).split("\\").join("/")}/${tmpHookRel}`;

    writeFileSync(join(tmpDir, tmpHookRel), fixture, "utf8");
    const control = checkHookTypecheckCoverage(repoRoot, [tmpRel], { [tmpRel]: pinned }, tmpConfigPath);
    assert.equal(control.ok, true, `sanity: the unmutated fixture must sit exactly on its pinned baseline: ${control.details.join("\n")}`);

    writeFileSync(join(tmpDir, tmpHookRel), mutated, "utf8");
    const after = checkHookTypecheckCoverage(repoRoot, [tmpRel], { [tmpRel]: pinned }, tmpConfigPath);
    assert.equal(after.ok, false, "an offsetting paydown-plus-new-bug edit must still fail, even though the total diagnostic count is unchanged");
    const afterDetails = after.details.join("\n");
    assert.match(afterDetails, /2 diagnostic\(s\) found/, "the total count must be UNCHANGED from the pinned baseline (2) — proving this is a genuine offset, not merely a net increase a raw count would also catch");
    assert.match(afterDetails, /2554:\d+ \(new, x1\)/, "the new diagnostic's own identity must be named even though one other identity vanished in the same run");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
