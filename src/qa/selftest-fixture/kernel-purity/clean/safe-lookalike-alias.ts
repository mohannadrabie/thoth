// Self-test fixture (AST layer, CLEAN — false-positive guard): a local variable named similarly
// to a forbidden root, and a variable aliased to a non-forbidden value, must NOT be treated as an
// alias of any forbidden global. Only an alias whose initializer itself resolves (directly or
// transitively) to one of the tracked forbidden roots is flagged. See kernel-purity-check.test.ts.
const globalConfig = { featureFlag: true };

export function readLookalike(): boolean {
  return globalConfig.featureFlag;
}

export function aliasOfSafeValue(): number {
  const notAGlobal = { count: 1 };
  const alias = notAGlobal;
  return alias.count;
}

function fetchStub(): string {
  return "stub";
}

export function aliasOfLocalFetchLookalike(): string {
  const f = fetchStub;
  return f();
}
