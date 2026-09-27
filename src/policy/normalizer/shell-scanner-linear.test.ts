// S7-A (Issue #304), A13 glued-and-word-form-redirect-targets-keep-old-values. story-implementer's own test.
//
// The redirect scan was rewritten from a per-match re-tokenization (quadratic) to one shared token index
// (linear). The rewrite must return EXACTLY what the old scan returned. Every expectation below was
// produced by running the OLD implementation (the base commit's shell-scanner.ts) and pasting its actual
// output through a generator; none is hand-derived. The test passes on the old code and on the new code:
// it is the pin that guards the new offset mapping, and it is run by the shell-detector mutation
// instrument (src/qa/shell-detector-mutants.ts), where the offset and boundary mutants must die on it.
// The wider proof (exhaustive short strings, seeded random, every fixture command, shape sweeps) is the
// differential instrument, src/qa/redirect-scan-differential.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRedirectTargets, findLiveRedirectOperatorPositions } from "./shell-scanner.ts";

interface Pin {
  label: string;
  command: string;
  targets: string[];
  positions: number[];
}

const PINS: readonly Pin[] = [
  { label: "glued targets, each is the rest of the token", command: "echo >a>b", targets: ["a>b","b"], positions: [5,7] },
  { label: "glued append", command: "echo >a>>b", targets: ["a>>b","b"], positions: [5,7] },
  { label: "word form, glued word", command: "cmd >&w", targets: ["w"], positions: [4] },
  { label: "fd-dup with a spaced digit is not a target", command: "cmd >& 1", targets: [], positions: [] },
  { label: "fd-dup then a real redirect", command: "cmd 2>&1 >x", targets: ["x"], positions: [9] },
  { label: "word form followed by a glued redirect", command: "cmd >&w>z", targets: ["w>z","z"], positions: [4,7] },
  { label: "redirects glued inside a token", command: "echo a>b c>d", targets: ["b","d"], positions: [6,10] },
  { label: "single-quoted target glued to a redirect", command: "echo >'q r'>s", targets: ["q r>s","s"], positions: [5,11] },
  { label: "double-quoted target glued to a redirect", command: "echo >\"q r\">s", targets: ["q r>s","s"], positions: [5,11] },
  { label: "escaped space inside a target", command: "echo >\\a\\ b>c", targets: ["a b>c","c"], positions: [5,11] },
  { label: "escaped operator then a live one", command: "echo \\>a>b", targets: ["b"], positions: [8] },
  { label: "word form with a quoted word", command: "cmd >& 'x y'", targets: ["x y"], positions: [4] },
  { label: "fd-dup with a quoted digit", command: "cmd >&\"2\"", targets: [], positions: [] },
  { label: "fd-dup with dash", command: "cmd >&-", targets: [], positions: [] },
  { label: "word form with a digit-leading word", command: "cmd >&2026-09-06.log", targets: ["2026-09-06.log"], positions: [4] },
  { label: "both-streams glued", command: "cmd &>out>>more", targets: ["out>>more","more"], positions: [4,9] },
  { label: "fd-dup, then word form append-like", command: "cmd 1>&2 >>&w tail", targets: ["w"], positions: [9] },
  { label: "quoted operator is not a redirect", command: "echo a'>b'>c", targets: ["c"], positions: [10] },
  { label: "operator at the end has no target", command: "echo >", targets: [], positions: [5] },
  { label: "word form at the end has no target", command: "echo >&", targets: [], positions: [5] },
  { label: "word form followed only by a space", command: "cmd >& ", targets: [], positions: [4] },
  { label: "three glued appends", command: "echo x >>y>>z>w", targets: ["y>>z>w","z>w","w"], positions: [7,10,13] },
  { label: "quoted target glued to more text", command: "cmd > \"a b\"c>d e", targets: ["a bc>d","d"], positions: [4,12] },
  { label: "escaped ampersand before an operator", command: "cmd \\&> /tmp/out", targets: ["/tmp/out"], positions: [6] },
  { label: "operator inside double quotes and after", command: "echo \">\" > out", targets: ["out"], positions: [9] },
  { label: "target with an escaped quote", command: "echo >a\\\"b>c", targets: ["a\"b>c","c"], positions: [5,10] },
];

for (const pin of PINS) {
  test(`A13 redirect scan keeps the old values: ${pin.label}: ${JSON.stringify(pin.command)}`, () => {
    assert.deepEqual(extractRedirectTargets(pin.command), pin.targets, "extractRedirectTargets");
    assert.deepEqual(findLiveRedirectOperatorPositions(pin.command), pin.positions, "findLiveRedirectOperatorPositions");
  });
}

test("A13 the pin table itself is non-trivial: it holds glued, word-form, fd-dup, quoted and escaped commands with at least one non-empty target list", () => {
  assert.ok(PINS.length >= 20, `only ${PINS.length} pins`);
  assert.ok(PINS.some((p) => p.targets.length >= 2), "a multi-target pin exists");
  assert.ok(PINS.some((p) => p.targets.length === 0 && p.command.includes(">&")), "an fd-dup pin with no target exists");
});
