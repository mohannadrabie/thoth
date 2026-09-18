// Self-test fixture (AST layer, VIOLATING — Issue #210 fix-now, 2026-09-17): the classic
// `.constructor.constructor` prototype-pivot sandbox escape — reaches Function-constructor-
// equivalent power (e.g. `globalThis`, via `Function("return this")()`) without ever writing
// "Function", "eval", "globalThis", or any of the 9 tracked root identifiers anywhere in the file,
// including inside a string. The check is purely syntactic (kernel-purity-check.ts's header
// comment, point (d)) — it matches the adjacent `.constructor.constructor(...)` token shape
// regardless of the real runtime type of the base expression, so this fixture types the pivot
// target explicitly (rather than reaching through the real, loosely-typed
// `Object.prototype.constructor`) purely to keep this file type-check/lint clean under this
// repo's strict `@typescript-eslint/no-unsafe-call`; the AST shape exercised is byte-identical
// either way. See kernel-purity-check.test.ts.
interface DoubleConstructorPivot {
  constructor: { constructor: (source: string) => () => unknown };
}

export function pivotViaObjectLiteral(): unknown {
  const pivot = {} as unknown as DoubleConstructorPivot;
  return pivot.constructor.constructor("return this")();
}

export function pivotViaAliasedEmptyObject(): unknown {
  const obj = {};
  const pivot = obj as unknown as DoubleConstructorPivot;
  return pivot.constructor.constructor("return this")();
}

// Re-confirm fix-now (Issue #210, app-security-reviewer, 2026-09-17): the identical escape
// written with bracket notation instead of dot notation, and a mixed dot/bracket chain — both
// require no variable-splitting or aliasing at all, and were an undisclosed full bypass of the
// original dot-only check.
export function pivotViaBracketNotation(): unknown {
  const pivot = {} as unknown as DoubleConstructorPivot;
  return pivot["constructor"]["constructor"]("return this")();
}

export function pivotViaMixedNotation(): unknown {
  const pivot = {} as unknown as DoubleConstructorPivot;
  return pivot.constructor["constructor"]("return this")();
}
