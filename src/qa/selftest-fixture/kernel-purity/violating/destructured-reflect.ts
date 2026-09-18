// Self-test fixture (AST layer, VIOLATING): destructuring binds a local name directly off a
// forbidden global — the destructure itself is the violation (Reflect's `get` reaches the same
// capability as writing out `Reflect.get` in full), independent of how the bound name is later
// used. See kernel-purity-check.test.ts.
export function destructuredReflectGet(): unknown {
  const { get } = Reflect;
  return get;
}
