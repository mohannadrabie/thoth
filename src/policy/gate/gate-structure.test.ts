// Structural tests for the gate directory and this story's new test files (S7 plan section 7:
// G11, G11b, G15, G18, G19). Source scans, story-implementer's own, written failing first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractImportSpecifiers, stripComments, stripCommentsAstOracle } from "../../qa/kernel-purity-check.ts";
import { ROUTES } from "./tool-routing.ts";

const GATE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(GATE_DIR, "..", "..", "..");

function gateSources(): { file: string; source: string }[] {
  return readdirSync(GATE_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((file) => ({ file, source: readFileSync(join(GATE_DIR, file), "utf8") }));
}

test("G11: routing purity: the gate directory has no switch and no string literal Bash or mcp__ outside tool-routing.ts, and the routing table has exactly the 2 rows the plan lists, each with a raw-call builder and a needsCatalog flag", () => {
  const sources = gateSources();
  assert.ok(sources.some((s) => s.file === "tool-routing.ts") && sources.some((s) => s.file === "decide-tool-call.ts"), "the gate files exist");
  for (const { file, source } of sources) {
    const code = stripComments(source);
    assert.ok(!/\bswitch\s*\(/.test(code), `${file}: no switch statement`);
    if (file !== "tool-routing.ts") {
      assert.ok(!/["'`]Bash["'`]/.test(code), `${file}: the literal "Bash" belongs in tool-routing.ts only`);
      assert.ok(!/["'`]mcp__["'`]/.test(code), `${file}: the literal "mcp__" belongs in tool-routing.ts only`);
    }
  }
  assert.equal(ROUTES.length, 2);
  assert.deepEqual(ROUTES.map((r) => `${r.match.kind}:${r.match.value}->${r.toolType}`).sort(), ["exact:Bash->shell", "prefix:mcp__->tool-class"]);
  for (const row of ROUTES) {
    assert.equal(typeof row.buildRaw, "function");
    assert.equal(typeof row.needsCatalog, "boolean");
  }
});

test("G11b: no per-toolType conditional (PC-12): the gate directory has no string literal shell or tool-class outside tool-routing.ts", () => {
  for (const { file, source } of gateSources()) {
    if (file === "tool-routing.ts") continue;
    const code = stripComments(source);
    assert.ok(!/["'`]shell["'`]/.test(code), `${file}: the toolType literal "shell" belongs in tool-routing.ts only`);
    assert.ok(!/["'`]tool-class["'`]/.test(code), `${file}: the toolType literal "tool-class" belongs in tool-routing.ts only`);
  }
});

test("G15: the gate directory has no node:* import and no import from src/policy/config/ (ports are gate-owned)", () => {
  for (const { file, source } of gateSources()) {
    for (const spec of extractImportSpecifiers(source)) {
      assert.ok(!spec.startsWith("node:"), `${file}: node import ${spec}`);
      assert.ok(!/(^|\/)config\//.test(spec), `${file}: import from config/ ${spec}`);
    }
  }
});

const WRITE_APIS = /\b(writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|mkdir|rmSync|rm|unlinkSync|unlink|renameSync|rename|createWriteStream|copyFileSync|copyFile|truncateSync|truncate)\s*\(/;

test("G18: no write path: neither the hook nor any gate file calls a filesystem-write API (R13: no durable evidence trail)", () => {
  const targets = [...gateSources().map((s) => ({ name: `src/policy/gate/${s.file}`, source: s.source })), { name: "hooks/pretooluse-kernel-gate.mjs", source: readFileSync(join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs"), "utf8") }];
  for (const { name, source } of targets) {
    assert.ok(!WRITE_APIS.test(stripComments(source)), `${name}: a filesystem-write API call`);
  }
});

// The test files this story adds (test-writer's and this file's siblings). G19 reads the forbidden
// names from the committed fixture at run time; this file never types one.
const STORY_TEST_FILES = [
  "hooks/pretooluse-kernel-gate-classification.test.ts",
  "hooks/test-support/gate-sandbox.ts",
  "src/policy/config/print-cli.test.ts",
  "src/policy/normalizer/tool-class.test.ts",
  "src/policy/normalizer/tool-class-golden.test.ts",
  "src/policy/gate/decide-tool-call.test.ts",
  "src/policy/gate/render-hook-output.test.ts",
  "src/policy/gate/gate-structure.test.ts",
  "src/policy/tools/classification-catalog.test.ts",
  "src/qa/gate-fail-open-probe.test.ts",
  "hooks/pretooluse-kernel-gate-stderr.test.ts",
  // S7-B (plan S-2): the test files this story adds, so none types a committed fixture entry name.
  "hooks/pretooluse-kernel-gate-builtin-override.test.ts",
  "hooks/sessionstart-tool-enum-builtin-override.test.ts",
  "src/policy/tools/classification-builtin-override.test.ts",
  "src/policy/config/rule-reachability.test.ts",
  "src/policy/config/loader-reachability.test.ts",
];

// Issue #359/#312 fix-now (red-team F1, named proof-test), re-oracled Issue #362/#363 (red-team
// round 2, findings R1/R4): a `//` comment that happens to contain a `/*`-shaped substring must
// not silently widen the hole stripComments leaves — this fails loud if it ever does, instead of
// every G11/G11b/G15/G18 scan above staying silently blind to real code a header comment
// accidentally hid.
//
// ORIGINAL ORACLE, why it was replaced: `lineFirstThenBlock` stripped `//` line comments FIRST,
// then `/* */` blocks — an independent re-implementation of the naive two-pass order, chosen so a
// regression showed up as a disagreement between two differently-reasoned strippers. But that
// oracle had its OWN bug, orthogonal to the one it was built to catch: stripping `//` first eats a
// SINGLE-LINE block comment's own `*/` terminator whenever the block's text contains `//` (e.g. a
// URL, `/* see https://example.com */`) — the line-strip regex is greedy-to-end-of-line and has no
// notion of "this `//` is inside an unclosed `/*`". `stripComments` and `lineFirstThenBlock` then
// disagreed BY CONSTRUCTION on entirely correct code, a false positive that blocked a benign
// documentation edit with a message asserting the wrong direction of data loss (red-team round 2,
// finding R4).
//
// FIX: oracle against `stripCommentsAstOracle` (kernel-purity-check.ts) instead — a full TypeScript
// parse plus comment-range extraction, a genuinely different code path from stripComments' own
// scanner-token-loop, but one with no "which comment kind wins" ordering to get wrong, so it has no
// disagreement to false-positive on for this shape.
test("G21: every gate source is fully visible to the structural scanner (stripComments agrees with the TypeScript-AST-derived oracle)", () => {
  for (const { file, source } of gateSources()) {
    assert.equal(
      stripComments(source),
      stripCommentsAstOracle(source),
      `${file}: stripComments disagrees with the AST-derived oracle — real code or a real comment is being handled differently by the two`,
    );
  }
});

test("G19: no literal fixture entry name in this story's new test files (PC-11): the forbidden names are derived from the committed fixture at run time", () => {
  const fixture = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "qa", "s5-central-classification.json"), "utf8")) as { centralLayer: { tools: { name: string }[] }; knownConnectors: string[] };
  const forbidden = [...fixture.centralLayer.tools.map((t) => t.name), ...fixture.knownConnectors];
  assert.ok(forbidden.length >= 6, "the fixture yields names to scan for");
  for (const rel of STORY_TEST_FILES) {
    const text = readFileSync(join(REPO_ROOT, rel), "utf8");
    for (const name of forbidden) {
      assert.ok(!text.toLowerCase().includes(name.toLowerCase()), `${rel} contains the committed fixture name ${JSON.stringify(name)}`);
    }
  }
});
