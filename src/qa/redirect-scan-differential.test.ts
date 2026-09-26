// S7-A (Issue #304), A12 redirect-scan-differential-equivalence. story-implementer's own test.
//
// Runs the differential instrument once and asserts (a) zero mismatches against the frozen old scan,
// (b) the minimum corpus size per class, so the corpus cannot silently shrink, and (c) that the instrument
// DETECTS a difference when handed a deliberately wrong candidate (an instrument that cannot fail proves
// nothing). The counts printed by the instrument come from the run; the floors asserted here are independent
// arithmetic, not copies of the run's output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXHAUSTIVE_MAX_LENGTH, PIECE_CASES, RANDOM_CASES, SHAPE_SIZES, compareOnInputs, fixtureCommands, runDifferential, summarize } from "./redirect-scan-differential.ts";
import { extractRedirectTargets, findLiveRedirectOperatorPositions } from "../policy/normalizer/shell-scanner.ts";
import { REDIRECT_SHAPE_NAMES } from "./redirect-shapes.ts";

const report = runDifferential();

function classNamed(prefix: string): (typeof report.classes)[number] {
  const found = report.classes.find((c) => c.name.startsWith(prefix));
  assert.ok(found !== undefined, `the report has no class ${prefix}`);
  return found;
}

test("A12 redirect-scan-differential-equivalence: the linear scan matches the frozen old scan on every corpus class (zero mismatches)", () => {
  const result = summarize(report);
  assert.equal(report.totalMismatches, 0, `${result.summary}\n${result.details.join("\n")}`);
  assert.equal(result.ok, true);
  console.log(`# ${result.summary}`);
  for (const line of result.details) console.log(`#   ${line}`);
});

test("A12 the corpus floors hold: exhaustive count equals the closed-form count, random and piece counts meet their minimums, fixtures were enumerated, every shape ran at every size", () => {
  const alphabetSize = 8;
  let expectedExhaustive = 0;
  for (let k = 0; k <= EXHAUSTIVE_MAX_LENGTH; k++) expectedExhaustive += alphabetSize ** k;
  assert.equal(classNamed("C1").cases, expectedExhaustive, "C1 must cover every string up to the maximum length");
  assert.ok(classNamed("C2").cases >= 200_000 && classNamed("C2").cases === RANDOM_CASES, "C2 must run at least 200000 cases");
  assert.ok(PIECE_CASES >= 100_000 && classNamed("C5").cases === PIECE_CASES);
  const fixtures = fixtureCommands();
  assert.ok(fixtures.length >= 20, `the fixture enumeration found only ${fixtures.length} commands: the enumerator is blind`);
  assert.equal(classNamed("C3").cases, fixtures.length, "C3 must run every enumerated fixture command");
  assert.equal(classNamed("C4").cases, REDIRECT_SHAPE_NAMES.length * SHAPE_SIZES.length);
  assert.ok(Math.max(...SHAPE_SIZES) >= 4096, "the shape sweep reaches 4 KB");
});

test("A12 the instrument is not vacuous: candidates that differ from the old scan are reported as mismatches", () => {
  const inputs = [...fixtureCommands(), ">a>b", "cmd >&w", "x 2>&1 >y"];
  const dropsLastTarget = compareOnInputs("drops-last-target", inputs, {
    extract: (text) => extractRedirectTargets(text).slice(0, -1),
    positions: (text) => findLiveRedirectOperatorPositions(text),
  });
  assert.ok(dropsLastTarget.mismatches > 0, "a scan that drops its last target must be caught");
  const shiftsPositions = compareOnInputs("shifts-positions", inputs, {
    extract: (text) => extractRedirectTargets(text),
    positions: (text) => findLiveRedirectOperatorPositions(text).map((p) => p + 1),
  });
  assert.ok(shiftsPositions.mismatches > 0, "a scan that shifts every position must be caught");
  const extraCharacter = compareOnInputs("extra-character", inputs, {
    extract: (text) => extractRedirectTargets(text).map((t) => `>${t}`),
    positions: (text) => findLiveRedirectOperatorPositions(text),
  });
  assert.ok(extraCharacter.mismatches > 0, "a scan whose targets carry an extra character must be caught");
  const identical = compareOnInputs("identical", inputs);
  assert.equal(identical.mismatches, 0, "the real scan matches on the same inputs");
});
