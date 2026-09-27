// S7-A fix-now round 1 (Issues #321 and #324 follow-up, app-security LOW 2): DETERMINISTIC scaling proofs for the
// scanner's own entry points. story-implementer's own tests, written failing first. No wall clock: every entry
// point takes an optional work meter that counts the characters it visited, and a linear scan visits each
// character a fixed number of times.
//
// This file lives beside the scanner (not in src/qa) on purpose: the shell-detector mutation instrument
// (src/qa/shell-detector-mutants.ts) runs the tests of src/policy/** against a shadow copy, so a mutant that
// re-introduces a quadratic walk can only die here. Its shapes are therefore built inline: this file imports
// nothing outside src/policy.
//
//   K = 4    the bound on visited characters per input character. The linear scans measure about 2 per input
//            character (one quote walk plus one further pass); the quadratic ones measure hundreds to thousands.
//   RATIO    1.125 x the size ratio between consecutive sizes: linear scaling is exactly the size ratio, quadratic is
//            its square.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRedirectTargets, findLiveRedirectOperatorPositions, findLiveTrailingSensitiveSeparator, type ScanWorkMeter } from "./shell-scanner.ts";

const K = 4;
const RATIO = 1.125;
const SIZES_KB = [4, 16, 64, 128] as const;

/** A command of at least `minLength` characters: `head`, then `unit` repeated, then `tail`. Deterministic. */
function build(head: string, unit: string, tail: string, minLength: number): string {
  const repeats = Math.max(1, Math.ceil((minLength - head.length - tail.length) / unit.length));
  return head + unit.repeat(repeats) + tail;
}

/** Runs one metered call per size, ascending and asserted one at a time, so a scan that is NOT linear fails at the
 * smallest size and is never asked to chew through the largest. */
function assertLinear(what: string, make: (minLength: number) => string, scan: (text: string, meter: ScanWorkMeter) => unknown): void {
  let previous: { kb: number; work: number } | undefined;
  for (const kb of SIZES_KB) {
    const text = make(kb * 1024);
    const meter: ScanWorkMeter = { chars: 0 };
    scan(text, meter);
    assert.ok(meter.chars >= text.length, `${what} at ${kb} KB reported work ${meter.chars} for ${text.length} characters: the meter must count every visited character`);
    assert.ok(meter.chars <= K * text.length, `${what} at ${kb} KB visited ${meter.chars} characters for a ${text.length}-character text: more than ${K}x, so not linear`);
    if (previous !== undefined) {
      const sizeRatio = kb / previous.kb;
      const workRatio = meter.chars / previous.work;
      assert.ok(workRatio <= sizeRatio * RATIO, `${what}: work(${kb} KB) / work(${previous.kb} KB) = ${workRatio.toFixed(2)}, above ${(sizeRatio * RATIO).toFixed(2)}: superlinear`);
    }
    previous = { kb, work: meter.chars };
  }
}

const TRAILING_UNITS = { newline: "\n", crlf: "\r\n", mixed: " \n\t\r\n \n" } as const;

for (const [shape, unit] of Object.entries(TRAILING_UNITS)) {
  test(`separator-scan-work-is-linear-on-trailing-whitespace: shape=${shape} (a benign command, then a whitespace run to the end): work stays within ${K}x the length at 4, 16, 64 and 128 KB`, () => {
    assertLinear(`findLiveTrailingSensitiveSeparator(${shape})`, (n) => build("echo hello", unit, "", n), (text, meter) => findLiveTrailingSensitiveSeparator(text, meter));
  });
  test(`separator-scan-work-is-linear-on-trailing-whitespace: shape=${shape} with a live '&' before the run and content after it stays linear`, () => {
    assertLinear(`findLiveTrailingSensitiveSeparator(${shape}, content after)`, (n) => build("echo hello &", unit, "x", n), (text, meter) => findLiveTrailingSensitiveSeparator(text, meter));
  });
}

test("separator-scan-work-is-linear-on-trailing-whitespace: the meter is optional and the answer does not depend on it", () => {
  for (const text of ["echo a\n\n\n", "echo a &\n\n x", "echo a\r\n\r\nb", "", "\n", "&", "a & b"]) {
    const meter: ScanWorkMeter = { chars: 0 };
    assert.equal(findLiveTrailingSensitiveSeparator(text), findLiveTrailingSensitiveSeparator(text, meter), JSON.stringify(text));
  }
});

// The redirect shapes: glued and word-form are the two the per-match re-tokenization made quadratic.
const REDIRECT_SHAPES = {
  glued: { head: "echo ", unit: ">a" },
  "word-form": { head: "echo", unit: " >&w" },
  "fd-dup": { head: "echo", unit: " 2>&1" },
} as const;

for (const [shape, { head, unit }] of Object.entries(REDIRECT_SHAPES)) {
  test(`redirect-scan-work-meter-sees-every-tokenizer-call: shape=${shape}: extractRedirectTargets and findLiveRedirectOperatorPositions stay within ${K}x the length, so a per-match tokenize of the remainder cannot hide from the meter`, () => {
    assertLinear(`extractRedirectTargets(${shape})`, (n) => build(head, unit, "", n), (text, meter) => extractRedirectTargets(text, meter));
    assertLinear(`findLiveRedirectOperatorPositions(${shape})`, (n) => build(head, unit, "", n), (text, meter) => findLiveRedirectOperatorPositions(text, meter));
  });
}
