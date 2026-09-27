// The trailing-whitespace command shapes the separator-scan work (Issue #321) is measured against through the real
// hook: a benign command followed by a long whitespace run that reaches the end of the text. One definition, two
// consumers: the latency corpus (src/qa/gate-latency-budget-check.ts) and the real-hook wall-clock tests
// (src/qa/gate-latency-budget-check.test.ts). The separator scan was quadratic in a run of these containing many
// newline characters: 16 KB took 2294 ms through the real hook and 64 KB never returned inside 30 s (red-team
// attack 1, docs/reviews/s7a-gate-hook-robustness-red-team-2026-09-26.md).
//
//   newline-dense   `\n` repeated
//   crlf            `\r\n` repeated (a command authored on Windows)
//   mixed           spaces, tabs, carriage returns and newlines interleaved
export const TRAILING_WHITESPACE_SHAPE_NAMES = ["newline-dense", "crlf", "mixed"] as const;
export type TrailingWhitespaceShapeName = (typeof TRAILING_WHITESPACE_SHAPE_NAMES)[number];

const HEAD = "echo hello";
const UNITS: Record<TrailingWhitespaceShapeName, string> = {
  "newline-dense": "\n",
  crlf: "\r\n",
  mixed: " \n\t\r\n \n",
};

/** A command of AT LEAST `minLength` characters: `echo hello`, then the shape's whitespace unit repeated. Deterministic. */
export function buildTrailingWhitespaceShape(shape: TrailingWhitespaceShapeName, minLength: number): string {
  const unit = UNITS[shape];
  const repeats = Math.max(1, Math.ceil((minLength - HEAD.length) / unit.length));
  return HEAD + unit.repeat(repeats);
}
