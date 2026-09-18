// Self-test fixture (AST layer, CLEAN — false-positive guard): ordinary bracket/element access on
// a plain array or object literal — not any forbidden root or an alias of one — must not be
// flagged. See kernel-purity-check.test.ts.
export function readFirstAndKey(): unknown[] {
  const arr = [1, 2, 3];
  const obj: Record<string, number> = { a: 1 };
  return [arr[0], obj["a"]];
}
