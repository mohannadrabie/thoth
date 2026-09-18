// Self-test fixture (AST layer, CLEAN — false-positive guard): destructuring off a global that is
// NOT in the tracked forbidden-roots set (Math) must not be flagged — only a destructure whose
// source expression resolves to one of the nine tracked forbidden roots is a violation. See
// kernel-purity-check.test.ts.
export function roundToInt(n: number): number {
  const { round } = Math;
  return round(n);
}
