// Self-test fixture (AST layer, VIOLATING): a computed (bracket) property access on a forbidden
// global root, where the key is assembled via string concatenation. The constant-folding helper
// resolves "ev" + "al" back to the literal "eval" for the violation detail, but the access is
// flagged purely because the base expression resolves to a forbidden root — independent of
// whether the key folds to a literal at all. See kernel-purity-check.test.ts.
export function computedBracketEvalAccess(): unknown {
  return (globalThis as unknown as Record<string, unknown>)["ev" + "al"];
}
