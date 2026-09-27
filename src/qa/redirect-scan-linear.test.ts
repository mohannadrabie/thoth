// S7-A (Issue #304), A14 redirect-scan-work-is-linear. story-implementer's own test, written failing first.
//
// DETERMINISTIC: no wall clock, so no flake under parallel CI load (Manager ruling 3). The redirect scan
// takes an optional work meter that counts the characters the quote walk and the tokenizer core visited.
// A linear scan visits each character a fixed number of times; the old scan re-tokenized the whole
// remainder once per match and visited about (matches x length) characters.
//
// Measured by spike S1 before the change was shaped (plan section 7, step 1): the new scan visits exactly
// 2.00 characters per input character, for every shape at 4, 16, 64 and 128 KB (one quote walk plus one
// tokenizer pass). The old scan, metered the same way, visited 26.8 million characters for the fd-dup
// shape at 16 KB (a 16388-character command): about 1600 per input character.
//   K = 4    twice the measured 2.00, the bound on work per input character
//   RATIO    4.5: linear scaling is 4.0 for a 4x larger input; quadratic would be 16
//
// The meter must actually be exercised: "work >= length" (every character is visited at least once)
// guards against a scan that ignores the meter and reports zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRedirectTargets, findLiveRedirectOperatorPositions, type ScanWorkMeter } from "../policy/normalizer/shell-scanner.ts";
import { REDIRECT_SHAPE_NAMES, buildRedirectShape } from "./redirect-shapes.ts";

const K = 4;
const RATIO = 4.5;
const SIZES_KB = [16, 64, 128] as const;

interface Sample {
  length: number;
  extractWork: number;
  positionsWork: number;
}

function sample(command: string): Sample {
  const extractMeter: ScanWorkMeter = { chars: 0 };
  extractRedirectTargets(command, extractMeter);
  const positionsMeter: ScanWorkMeter = { chars: 0 };
  findLiveRedirectOperatorPositions(command, positionsMeter);
  return { length: command.length, extractWork: extractMeter.chars, positionsWork: positionsMeter.chars };
}

for (const shape of REDIRECT_SHAPE_NAMES) {
  test(`A14 redirect-scan-work-is-linear: shape=${shape}: work stays within ${K}x the length at 16, 64 and 128 KB and scales at most ${RATIO}x per 4x input`, () => {
    // Ascending sizes, asserted one at a time: a scan that is NOT linear fails at 16 KB (or never counts) and is
    // never asked to chew through 128 KB.
    const samples: Sample[] = [];
    for (const kb of SIZES_KB) {
      const s = sample(buildRedirectShape(shape, kb * 1024));
      for (const [what, work] of [["extractRedirectTargets", s.extractWork], ["findLiveRedirectOperatorPositions", s.positionsWork]] as const) {
        assert.ok(work >= s.length, `${what} at ${kb} KB reported work ${work} for ${s.length} characters: the meter must count every visited character`);
        assert.ok(work <= K * s.length, `${what} at ${kb} KB visited ${work} characters for a ${s.length}-character command: more than ${K}x, so not linear`);
      }
      samples.push(s);
    }
    const [s16, s64, s128] = samples;
    assert.ok(s16 !== undefined && s64 !== undefined && s128 !== undefined);
    for (const [what, w16, w64, w128] of [
      ["extractRedirectTargets", s16.extractWork, s64.extractWork, s128.extractWork],
      ["findLiveRedirectOperatorPositions", s16.positionsWork, s64.positionsWork, s128.positionsWork],
    ] as const) {
      assert.ok(w64 / w16 <= RATIO, `${what}: work(64 KB) / work(16 KB) = ${(w64 / w16).toFixed(2)}, above ${RATIO}: superlinear`);
      assert.ok(w128 / w64 <= RATIO / 2, `${what}: work(128 KB) / work(64 KB) = ${(w128 / w64).toFixed(2)}, above ${RATIO / 2}: superlinear`);
    }
  });
}

test("A14 the meter is optional: a call without a meter argument returns the same results as one with a meter", () => {
  const command = buildRedirectShape("word-form", 2048);
  const meter: ScanWorkMeter = { chars: 0 };
  assert.deepEqual(extractRedirectTargets(command), extractRedirectTargets(command, meter));
  assert.deepEqual(findLiveRedirectOperatorPositions(command), findLiveRedirectOperatorPositions(command, meter));
});
