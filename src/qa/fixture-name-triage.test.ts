// #308 story E6: tests for the fixture-name triage instrument (written failing first against a missing module).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildReport, fingerprintOf, fixtureNames, scanRepo, scanText, TRIAGE, type Triage } from "./fixture-name-triage.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE_TEXT = readFileSync(`${REPO_ROOT}docs/qa/s5-central-classification.json`, "utf8");

test("names come from the fixture at run time: every centralLayer tool and knownConnectors entry, no typed list", () => {
  const f = JSON.parse(FIXTURE_TEXT) as { centralLayer: { tools: { name: string }[] }; knownConnectors: string[] };
  const expected = new Set([...f.centralLayer.tools.map((t) => t.name), ...f.knownConnectors]);
  assert.deepEqual(new Set(fixtureNames(FIXTURE_TEXT)), expected);
  assert.ok(expected.size > 0);
});

test("scanText: finds a whole-literal name and the mcp__ and mcp/ spellings; ignores prose and substrings (synthetic names)", () => {
  const names = ["standin-a", "Stand In B"];
  const text = [
    `const a = "standin-a";`,
    "const b = 'mcp__standin-a__tool';",
    "const c = `mcp/standin-a/x`;",
    `const d = "stand in b";`,
    `const e = "fixture-standin-a-thing";`,
    `const f = "a sentence about standin-a here";`,
  ].join("\n");
  assert.deepEqual(scanText("x.ts", text, names).map((h) => h.line), [1, 2, 3, 4]);
});

test("buildReport: an untriaged hit file, a stale verdict and a violation verdict each fail the run", () => {
  const hit = { file: "a.ts", line: 1, literal: "n", name: "n", fingerprint: fingerprintOf("a.ts", "n") };
  const ok: Record<string, Triage> = { "a.ts": { verdict: "not-violation", reason: "r", fingerprints: [hit.fingerprint] } };
  assert.deepEqual(buildReport([hit], ["n"], ok), { names: ["n"], hits: [hit], files: ["a.ts"], untriaged: [], stale: [], violations: [] });
  assert.deepEqual(buildReport([hit], ["n"], {}).untriaged, ["a.ts:1"]);
  assert.deepEqual(buildReport([], ["n"], ok).stale, ["a.ts"]);
  assert.deepEqual(buildReport([hit], ["n"], { "a.ts": { ...ok["a.ts"]!, verdict: "violation" } }).violations, ["a.ts"]);
});

test("a second, different hit in an already-triaged file is untriaged (Issue #412: the verdict is per hit, not per file)", () => {
  const first = { file: "a.ts", line: 1, literal: "n", name: "n", fingerprint: fingerprintOf("a.ts", "n") };
  const second = { file: "a.ts", line: 9, literal: "m", name: "m", fingerprint: fingerprintOf("a.ts", "m") };
  const triage: Record<string, Triage> = { "a.ts": { verdict: "not-violation", reason: "r", fingerprints: [first.fingerprint] } };
  assert.deepEqual(buildReport([first, second], ["n", "m"], triage).untriaged, ["a.ts:9"]);
  assert.deepEqual(buildReport([first], ["n", "m"], triage).untriaged, []);
  assert.deepEqual(buildReport([second], ["n", "m"], triage).stale, ["a.ts"], "a triaged hit that no longer exists is stale");
});

test("scanText finds an unquoted object key that is a name (Issue #412, red-team LOW 4), and not a longer identifier or a hyphenated key", () => {
  const names = ["standin", "stand-in-b"];
  const text = ["const a = { standin: 1 };", "const b = { standinx: 1, other: 2 };", "const c = { 'x': { standin : 2 } };", "const d = { prestandin: 1 };"].join(String.fromCharCode(10));
  assert.deepEqual(scanText("x.ts", text, names).map((h) => h.line), [1, 3]);
});

test("the real repo: every hit file under hooks/ and src/ carries a verdict, none is stale, none is a violation", () => {
  const names = fixtureNames(FIXTURE_TEXT);
  const r = buildReport(scanRepo(REPO_ROOT, names), names, TRIAGE);
  console.log(`E6: ${String(r.hits.length)} hit(s) in ${String(r.files.length)} file(s): ${r.files.join(", ")}`);
  assert.deepEqual(r.untriaged, []);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.violations, []);
});
