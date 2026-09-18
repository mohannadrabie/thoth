// Self-test fixture (kernel-purity-check.ts AST layer, VIOLATING — Issue #63 AST hardening):
// aliases globalThis/global to a local variable, then reaches a forbidden global THROUGH the
// alias via property/element access — the class of obfuscation the AST layer's alias tracking
// exists to catch, distinct from a bare literal `globalThis.foo` the regex layer already sees
// directly. See kernel-purity-check.test.ts (scanForbiddenGlobalsAst tests).
export function aliasedGlobalThisElementAccess(): unknown {
  const g = globalThis;
  return (g as unknown as Record<string, unknown>)["eval"];
}

export function aliasedBareGlobalPropertyAccess(): unknown {
  const gg = global;
  return gg.process;
}
