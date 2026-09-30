// Issue #374 / #361 round 3 (Manager ruling 2026-09-30 on the round-2 red-team re-confirm). Written
// FIRST, failing, against the round-2 regex scan; each block names the red-team finding it closes.
//  - MED: the widened QA-18 JSDoc-any scan was a spelling regex. Five spellings hid a planted TS2345.
//  - LOW 1: the allow-list was keyed by annotation TEXT, so a count-neutral move of an allowed `any`
//    to another function stayed green. It is now keyed by SITE (hook + function + tag target).
// The guard test (LOW 3) lives in hooks/sessionstart-tool-enum-degraded-guard.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkHookTypecheckCoverage, JSDOC_ANY_ALLOWLIST, scanHookSuppressions } from "./hook-typecheck-coverage-check.ts";

const repoRoot = process.cwd();
let counter = 0;

function withTmpProject<T>(source: string, fn: (ctx: { rel: string; configPath: string }) => T): T {
  const dirName = `.qa-tmp-r3-${process.pid}-${Date.now()}-${counter++}`;
  const dir = join(repoRoot, dirName);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "hook.mjs"), source, "utf8");
    const configPath = join(dir, "tsconfig.json");
    writeFileSync(configPath, JSON.stringify({ extends: "../tsconfig.json", compilerOptions: { allowJs: true, checkJs: true, noEmit: true }, include: ["hook.mjs"] }), "utf8");
    return fn({ rel: `${dirName}/hook.mjs`, configPath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Each case hides a planted type error (`f(123)` where f wants a string) behind an `any` the compiler
// cannot see: tsc passes, so only the scan can fail it. Every one passed the round-2 regex scan.
const EVASIONS: ReadonlyArray<readonly [name: string, head: string]> = [
  ["unknown-type {?}", "/** @param {?} x */\nfunction f(x) { return x; }\n"],
  ["name-before-type `@param x {any}`", "/**\n * @param x {any}\n */\nfunction f(x) { return x; }\n"],
  ["type on the next line", "/**\n * @param\n * {any} x\n */\nfunction f(x) { return x; }\n"],
  ["brace desync {\"}\" | any}", "/** @param {\"}\" | any} x */\nfunction f(x) { return x; }\n"],
  ["lib-derived any ReturnType<typeof JSON.parse>", "/** @param {ReturnType<typeof JSON.parse>} x */\nfunction f(x) { return x; }\n"],
  ["alias resolving to any via @typedef", "/** @typedef {ReturnType<typeof JSON.parse>} Loose */\n/** @param {Loose} x */\nfunction f(x) { return x; }\n"],
];

for (const [name, head] of EVASIONS) {
  test(`#374 r3: the checker-based scan flags the evasion "${name}" (spelling-independent)`, () => {
    assert.ok(scanHookSuppressions(head).length > 0, `expected a finding for: ${head}`);
  });
  test(`#374 r3: a planted bug hidden behind "${name}" FAILS the coverage instrument even though tsc is clean`, () => {
    withTmpProject(`${head}f(123);\n`, ({ rel, configPath }) => {
      const r = checkHookTypecheckCoverage(repoRoot, [rel], {}, configPath, []);
      assert.equal(r.ok, false, r.details.join("\n"));
    });
  });
}

test("#374 r3: honest annotations (unknown, unions of real types, prose mentioning any/Object) still scan clean", () => {
  const clean = "/**\n * Accepts any string; not an Object annotation. Uses {any} only in prose.\n * @param {unknown} x\n * @param {string | number} y\n * @param {Array<[string, string]>} z\n * @returns {Record<string, unknown>}\n */\nfunction f(x, y, z) { return {}; }\n";
  assert.deepEqual(scanHookSuppressions(clean), []);
});

test("#374 r3: `Object` (not any under strict) keeps its textual-level ban, now at the type-node level; the checker approach does not subsume it", () => {
  assert.ok(scanHookSuppressions("/** @param {Object} x */\nfunction f(x) { return x; }\n").length > 0);
  assert.ok(scanHookSuppressions("/** @type {Array<Object>} */\nconst a = [];\n").length > 0);
});

// --- LOW 1: the allow-list is keyed by SITE (hook + enclosing function + tag target) ---------------
const TWO_FUNCTIONS_ANY_IN_F = "/** @param {any} x */\nfunction f(x) { return x; }\n/** @param {string} x */\nfunction g(x) { return x; }\n";
const TWO_FUNCTIONS_ANY_IN_G = "/** @param {string} x */\nfunction f(x) { return x; }\n/** @param {any} x */\nfunction g(x) { return x; }\n";
const SITE_F = [{ hook: "hook.mjs", site: "f: @param x", count: 1, reason: "test" }];

test("#374 r3: an allow-list entry is a SITE — the allowed `any` at f() passes; the identical annotation text moved to g() (count-neutral swap) FAILS", () => {
  assert.deepEqual(scanHookSuppressions(TWO_FUNCTIONS_ANY_IN_F, "hook.mjs", SITE_F), []);
  const moved = scanHookSuppressions(TWO_FUNCTIONS_ANY_IN_G, "hook.mjs", SITE_F);
  assert.ok(moved.length > 0, "the same `@param {any} x` moved to another function must not be excused");
  assert.match(moved.join("\n"), /g: @param x/, "the finding names the site");
});

test("#374 r3: site counts are exact — a second any at an allowed site exceeds its pinned count", () => {
  const twoAtF = "/**\n * @param {any} x\n * @param {any} y\n */\nfunction f(x, y) { return [x, y]; }\n";
  const site = [{ hook: "hook.mjs", site: "f: @param x", count: 1, reason: "test" }];
  assert.ok(scanHookSuppressions(twoAtF, "hook.mjs", site).length > 0, "`y` is a different site and is not allowed");
  assert.ok(scanHookSuppressions("/** @param {[any, any]} x */\nfunction f(x) { return x; }\n", "hook.mjs", site).length > 0, "two any nodes at one site exceed count 1");
});

test("#374 r3: the reviewed allow-list is pinned to exactly these 8 sites (extending it is a visible edit of this test)", () => {
  const actual = JSDOC_ANY_ALLOWLIST.map((e) => `${e.hook} | ${e.site} | x${e.count}`).sort();
  assert.deepEqual(actual, [
    "hooks/pretooluse-kernel-gate.mjs | failClosed: @param err | x1",
    "hooks/sessionstart-tool-enum.mjs | isProjectMcpServerEnabled: @param projectSettings | x1",
    "hooks/sessionstart-tool-enum.mjs | reconcileReason: @param initialHaltState | x1",
    "hooks/sessionstart-tool-enum.mjs | wasReasonActive: @param initialHaltState | x1",
    "hooks/userpromptsubmit-halt-relay.mjs | composeDiagnosticLines: @param activeReasons | x1",
    "hooks/userpromptsubmit-halt-relay.mjs | composeTrustedSummary: @param activeReasons | x1",
    "hooks/userpromptsubmit-halt-relay.mjs | inspectHaltState: @param haltState | x1",
    "hooks/userpromptsubmit-halt-relay.mjs | inspectHaltState: @type activeReasons | x1",
  ]);
});
