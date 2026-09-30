// Post-merge fix-now round (2026-09-29): Issues #367 (+ red-team N2/N4/N5, app-security finding 1,
// cross-domain F1) and #368 (red-team N3). See hook-typecheck-coverage-check.ts's header for the
// design; the pre-existing tests for this instrument stay in hook-typecheck-coverage-check.test.ts,
// unedited. Written FIRST, failing, against the round-4 code; each block names the finding it closes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import { checkHookTypecheckCoverage, listProductionHooks, PINNED_BASELINES, regenerateBaseline } from "./hook-typecheck-coverage-check.ts";

const repoRoot = process.cwd();
let tmpCounter = 0;

/** A self-contained fixture project under repoRoot (a sibling of hooks/ and src/, the same placement
 * the AC-13 tests use, so `extends ../tsconfig.json` and rootDir "." both resolve), removed in a
 * `finally`. `sources` maps file name to content; every .mjs/.js key is a project include. */
function withTmpProject<T>(label: string, sources: Record<string, string>, fn: (ctx: { dir: string; rel: (file: string) => string; configPath: string }) => T): T {
  const dirName = `.qa-tmp-${label}-${process.pid}-${Date.now()}-${tmpCounter++}`;
  const dir = join(repoRoot, dirName);
  const configPath = join(dir, "tsconfig.json");
  try {
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(sources)) writeFileSync(join(dir, name), content, "utf8");
    const include = Object.keys(sources).filter((n) => n.endsWith(".mjs") || n.endsWith(".js"));
    writeFileSync(configPath, JSON.stringify({ extends: "../tsconfig.json", compilerOptions: { allowJs: true, checkJs: true, noEmit: true }, include }, null, 2), "utf8");
    return fn({ dir, rel: (file) => `${dirName}/${file}`, configPath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- #367 / red-team N2 + N4: the suppression CLASS, checked by the instrument itself ---------

const ARITY_FIXTURE_HEAD = ["/**", " * @param {number} a", " * @param {number} b", " */", "function add(a, b) {", "  return a + b;", "}", ""].join("\n");

const SUPPRESSION_CASES: ReadonlyArray<readonly [name: string, source: string]> = [
  ["described @ts-expect-error", `${ARITY_FIXTURE_HEAD}// @ts-expect-error legacy shim, tracked elsewhere\nadd(1);\n`],
  ["bare @ts-ignore", `${ARITY_FIXTURE_HEAD}// @ts-ignore\nadd(1);\n`],
  ["block-comment @ts-ignore", `${ARITY_FIXTURE_HEAD}/* @ts-ignore */\nadd(1);\n`],
  ["file-level @ts-nocheck", `// @ts-nocheck\n${ARITY_FIXTURE_HEAD}add(1);\n`],
  ["eslint-disable-next-line of ban-ts-comment plus @ts-ignore", `${ARITY_FIXTURE_HEAD}// eslint-disable-next-line @typescript-eslint/ban-ts-comment\n// @ts-ignore\nadd(1);\n`],
  ["JSDoc any-cast of the callee", `${ARITY_FIXTURE_HEAD}/** @type {any} */ (add)(1);\n`],
  ["JSDoc star-cast of the callee", `${ARITY_FIXTURE_HEAD}/** @type {*} */ (add)(1);\n`],
];

test("suppression control: the arity fixture WITHOUT any suppression really fails the instrument (so each case below hides a real diagnostic, not a no-op)", () => {
  withTmpProject("supp-control", { "hook.mjs": `${ARITY_FIXTURE_HEAD}add(1);\n` }, ({ rel, configPath }) => {
    const result = checkHookTypecheckCoverage(repoRoot, [rel("hook.mjs")], {}, configPath);
    assert.equal(result.ok, false);
    assert.match(result.details.join("\n"), /1 diagnostic\(s\) found, expected 0/);
  });
});

for (const [name, source] of SUPPRESSION_CASES) {
  test(`#367/N2/N4: a type-suppression of the class "${name}" over a real dropped-argument bug FAILS the coverage instrument itself, independent of eslint config`, () => {
    withTmpProject("supp", { "hook.mjs": source }, ({ rel, configPath }) => {
      const result = checkHookTypecheckCoverage(repoRoot, [rel("hook.mjs")], {}, configPath);
      assert.equal(result.ok, false, "the diagnostic is hidden by the suppression, so only a suppression scan can fail this hook");
      assert.match(result.details.join("\n"), /suppression/i, "the failure must name the suppression class and the unlock");
    });
  });
}

test("#367/N2/N4: the REAL hooks carry no suppression of any class today (the instrument passes on the real tree)", () => {
  const result = checkHookTypecheckCoverage(repoRoot);
  assert.equal(result.ok, true, result.details.join("\n"));
});

// --- #367 / red-team N4 + app-security finding 1: the lint layer must ban what it says it bans ---

const ESLINT_HOOK_CASES: ReadonlyArray<readonly [name: string, code: string]> = [
  ["described @ts-expect-error", "// @ts-expect-error legacy shim, tracked elsewhere\nconst a = 1 + {};\n"],
  ["bare @ts-ignore", "// @ts-ignore\nconst a = 1 + {};\n"],
  ["@ts-nocheck", "// @ts-nocheck\nconst a = 1;\n"],
  ["eslint-disable-next-line ban-ts-comment plus @ts-ignore", "// eslint-disable-next-line @typescript-eslint/ban-ts-comment\n// @ts-ignore\nconst a = 1 + {};\n"],
];

for (const ext of ["mjs", "js"]) {
  for (const [name, code] of ESLINT_HOOK_CASES) {
    test(`#367/N4/N5: eslint bans "${name}" in a hooks/*.${ext} file outright (explicit rule options, inline config cannot switch the rule off, .js hooks covered)`, async () => {
      const eslint = new ESLint({ cwd: repoRoot });
      const [result] = await eslint.lintText(code, { filePath: join(repoRoot, "hooks", `synthetic-lint-probe.${ext}`) });
      assert.ok(result, "eslint returned no result");
      // The message text is checked too: an UNREGISTERED rule (a .js file outside the hooks block)
      // reports "Definition for rule ... not found" under the same ruleId, which is not a ban.
      const banned = result.messages.filter((m) => m.ruleId === "@typescript-eslint/ban-ts-comment" && m.severity === 2 && m.message.includes("@ts-"));
      assert.ok(banned.length > 0, `expected an error from @typescript-eslint/ban-ts-comment; got: ${JSON.stringify(result.messages.map((m) => [m.ruleId, m.severity]))}`);
    });
  }
}

// --- red-team N5: a .js hook is a production hook too -------------------------------------------

test("N5: listProductionHooks enumerates every executable hook under hooks/, .mjs and .js alike — a new .js hook is covered, linted and suppression-scanned the day it lands (tests, test-support and other extensions excluded)", () => {
  const root = mkdtempSync(join(tmpdir(), "thoth-hooks-list-"));
  try {
    mkdirSync(join(root, "hooks", "test-support"), { recursive: true });
    for (const f of ["a.mjs", "b.js", "c.test.ts", "d.json", join("test-support", "e.ts")]) writeFileSync(join(root, "hooks", f), "// fixture\n", "utf8");
    assert.deepEqual(listProductionHooks(root), ["hooks/a.mjs", "hooks/b.js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- red-team N3 (#368): position-independent identity ----------------------------------------

// Issue #361 (2026-09-30): the real hooks are now fully clean, so their pinned baseline is empty and
// can no longer serve as the fixture for "identity is position-independent". A self-contained
// fixture with two known implicit-any diagnostics stands in, pinned by their exact identities.
const COSMETIC_HEAD = ["/** @param {number} n */", "function ok(n) { return n; }", ""].join("\n");
const COSMETIC_F_LINE = "function f(a) { return a; }";
const COSMETIC_G_LINE = "function g(b) { return b; }";
const COSMETIC_SOURCE = `${COSMETIC_HEAD}${COSMETIC_F_LINE}\n${COSMETIC_G_LINE}\n`;
const COSMETIC_PINNED = [`7006|${COSMETIC_F_LINE}`, `7006|${COSMETIC_G_LINE}`];

const COSMETIC_EDITS: ReadonlyArray<readonly [name: string, edit: (real: string) => string]> = [
  ["a blank line after line 1", (real) => real.replace("\n", "\n\n")],
  ["five blank lines before the first pinned function declaration line", (real) => real.replace(COSMETIC_F_LINE, `\n\n\n\n\n${COSMETIC_F_LINE}`)],
];

test("N3 control: the cosmetic fixture UNEDITED stays within its pinned identities (so a failure below can only come from the edit)", () => {
  withTmpProject("cosmetic-control", { "hook.mjs": COSMETIC_SOURCE }, ({ rel, configPath }) => {
    const tmpRel = rel("hook.mjs");
    const result = checkHookTypecheckCoverage(repoRoot, [tmpRel], { [tmpRel]: COSMETIC_PINNED }, configPath);
    assert.equal(result.ok, true, result.details.join("\n"));
    assert.match(result.details.join("\n"), /2 diagnostic\(s\) \(pinned/);
  });
});

for (const [name, edit] of COSMETIC_EDITS) {
  test(`N3: a purely cosmetic edit that shifts line numbers (${name}) does not report a NEW regression — diagnostic identity is position-independent`, () => {
    const mutated = edit(COSMETIC_SOURCE);
    assert.notEqual(mutated, COSMETIC_SOURCE, "precondition: the cosmetic edit must actually change the file");
    withTmpProject("cosmetic", { "hook.mjs": mutated }, ({ rel, configPath }) => {
      const tmpRel = rel("hook.mjs");
      const result = checkHookTypecheckCoverage(repoRoot, [tmpRel], { [tmpRel]: COSMETIC_PINNED }, configPath);
      assert.equal(result.ok, true, result.details.join("\n"));
    });
  });
}

test("N3: the pinned baseline is a committed, generated JSON snapshot; after Issue #361 both formerly-excepted hooks are pinned at zero (never a hand-typed list)", () => {
  const snapshotPath = join(repoRoot, "src", "qa", "hook-typecheck-baseline.json");
  assert.ok(existsSync(snapshotPath), "src/qa/hook-typecheck-baseline.json must exist (generated by `node src/qa/hook-typecheck-coverage-check.ts --regenerate-baseline`)");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as { pinned: Record<string, Array<{ count: number }>> };
  const total = (hook: string): number => (snapshot.pinned[hook] ?? []).reduce((n, e) => n + e.count, 0);
  assert.equal(total("hooks/sessionstart-tool-enum.mjs"), 0);
  assert.equal(total("hooks/userpromptsubmit-halt-relay.mjs"), 0);
  assert.deepEqual(Object.keys(snapshot.pinned).sort(), ["hooks/sessionstart-tool-enum.mjs", "hooks/userpromptsubmit-halt-relay.mjs"]);
  assert.equal(PINNED_BASELINES["hooks/sessionstart-tool-enum.mjs"]?.length, 0);
  assert.equal(PINNED_BASELINES["hooks/userpromptsubmit-halt-relay.mjs"]?.length, 0);
});

// --- red-team N3 (#368): the regenerate flag ratchets DOWN only ---------------------------------

const REGEN_HEAD = ["/** @param {number} n */", "function ok(n) { return n; }", ""].join("\n");
const F_LINE = "function f(a) { return a; }";
const G_LINE = "function g(b) { return b; }";
const REGEN_TWO = `${REGEN_HEAD}${F_LINE}\n${G_LINE}\n`;

function snapshotFor(hookRel: string, entries: Array<[excerpt: string, count: number]>): string {
  return JSON.stringify({ version: 1, pinned: { [hookRel]: entries.map(([excerpt, count]) => ({ code: 7006, excerpt, count })) } }, null, 2) + "\n";
}

function regenScenario(label: string, hookSource: string, run: (ctx: { hookRel: string; snapshotPath: string; configPath: string; readSnapshot: () => string }) => void): void {
  withTmpProject(label, { "hook.mjs": hookSource }, ({ dir, rel, configPath }) => {
    const snapshotPath = join(dir, "baseline.json");
    run({ hookRel: rel("hook.mjs"), snapshotPath, configPath, readSnapshot: () => readFileSync(snapshotPath, "utf8") });
  });
}

test("N3 regenerate: an unchanged hook regenerates cleanly with nothing added or removed", () => {
  regenScenario("regen-same", REGEN_TWO, ({ hookRel, snapshotPath, configPath }) => {
    writeFileSync(snapshotPath, snapshotFor(hookRel, [[F_LINE, 1], [G_LINE, 1]]), "utf8");
    const r = regenerateBaseline({ repoRoot, snapshotPath, configPathOverride: configPath, hooks: [hookRel] });
    assert.equal(r.ok, true, r.refusal);
    assert.deepEqual([r.added, r.removed], [[], []]);
  });
});

test("N3 regenerate: paying down debt (an identity disappears) is ALLOWED, the removal is printed, and the snapshot shrinks", () => {
  regenScenario("regen-down", `${REGEN_HEAD}${F_LINE}\n/** @param {number} b */\n${G_LINE}\n`, ({ hookRel, snapshotPath, configPath, readSnapshot }) => {
    writeFileSync(snapshotPath, snapshotFor(hookRel, [[F_LINE, 1], [G_LINE, 1]]), "utf8");
    const r = regenerateBaseline({ repoRoot, snapshotPath, configPathOverride: configPath, hooks: [hookRel] });
    assert.equal(r.ok, true, r.refusal);
    assert.equal(r.added.length, 0);
    assert.equal(r.removed.length, 1);
    assert.match(r.removed.join("\n"), /7006/);
    assert.match(r.removed.join("\n"), /function g\(b\)/);
    const after = JSON.parse(readSnapshot()) as { pinned: Record<string, Array<{ excerpt: string }>> };
    assert.deepEqual(after.pinned[hookRel]?.map((e) => e.excerpt), [F_LINE]);
  });
});

test("N3 regenerate: ANY new identity is REFUSED (even when the total does not rise), the added identity is printed, and the snapshot file is left byte-identical", () => {
  // g is paid down (-1) while h is a brand-new diagnostic (+1): the total is unchanged, so a
  // total-count refusal rule would let it through and launder h into the baseline.
  regenScenario("regen-new", `${REGEN_HEAD}${F_LINE}\n/** @param {number} b */\n${G_LINE}\nfunction h(c) { return c; }\n`, ({ hookRel, snapshotPath, configPath, readSnapshot }) => {
    const before = snapshotFor(hookRel, [[F_LINE, 1], [G_LINE, 1]]);
    writeFileSync(snapshotPath, before, "utf8");
    const r = regenerateBaseline({ repoRoot, snapshotPath, configPathOverride: configPath, hooks: [hookRel] });
    assert.equal(r.ok, false);
    assert.match(r.added.join("\n"), /function h\(c\)/);
    assert.match(r.refusal ?? "", /hand|edit|review/i, "the refusal must name its unlock (a visible, reviewed hand edit of the snapshot)");
    assert.equal(readSnapshot(), before, "a refused regenerate must not touch the snapshot");
  });
});

test("N3 regenerate: a second occurrence of an ALREADY-pinned identity (a copy-pasted diagnostic line) is REFUSED", () => {
  regenScenario("regen-dup", `${REGEN_TWO}${F_LINE}\n`, ({ hookRel, snapshotPath, configPath }) => {
    writeFileSync(snapshotPath, snapshotFor(hookRel, [[F_LINE, 1], [G_LINE, 1]]), "utf8");
    const r = regenerateBaseline({ repoRoot, snapshotPath, configPathOverride: configPath, hooks: [hookRel] });
    assert.equal(r.ok, false);
    assert.match(r.added.join("\n"), /function f\(a\)/);
  });
});

test("N3 regenerate: with NO committed snapshot at all, an explicit hook list bootstraps one from the measured diagnostics; without a hook list it refuses", () => {
  regenScenario("regen-boot", REGEN_TWO, ({ hookRel, snapshotPath, configPath, readSnapshot }) => {
    const refused = regenerateBaseline({ repoRoot, snapshotPath, configPathOverride: configPath });
    assert.equal(refused.ok, false);
    assert.equal(existsSync(snapshotPath), false);
    const r = regenerateBaseline({ repoRoot, snapshotPath, configPathOverride: configPath, hooks: [hookRel] });
    assert.equal(r.ok, true, r.refusal);
    const written = JSON.parse(readSnapshot()) as { pinned: Record<string, Array<{ code: number; excerpt: string; count: number }>> };
    assert.deepEqual(written.pinned[hookRel]?.map((e) => [e.code, e.excerpt, e.count]), [[7006, F_LINE, 1], [7006, G_LINE, 1]]);
  });
});
