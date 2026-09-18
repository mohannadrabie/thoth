// Self-test fixture (AST layer, CLEAN — false-positive guard, Issue #210 fix-now + re-confirm
// fix-now): a single-level `.constructor` access or call — dot OR bracket notation — must NOT be
// flagged; only the double `.constructor.constructor(...)` prototype-pivot chain
// (kernel-purity-check.ts header, point (d)) is the violation. See kernel-purity-check.test.ts.
export function describeCtorName(x: object): string | undefined {
  return x.constructor.name;
}

export function callSingleConstructor(x: { constructor: () => unknown }): unknown {
  return x.constructor();
}

export function describeCtorNameBracket(x: object): string | undefined {
  return x["constructor"].name;
}

export function callSingleConstructorBracket(x: { constructor: () => unknown }): unknown {
  return x["constructor"]();
}
