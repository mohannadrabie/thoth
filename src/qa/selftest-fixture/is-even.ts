// The mutation-harness engine's OWN self-test target (QA-06, AC11) — a small pure function with
// a small regression suite, used only to prove the harness's apply-mutant -> rerun -> kill/survive
// mechanism actually works end to end via a real subprocess. Not production policy logic; S2+
// builds that, and its real mutant classes register against the real detector once it exists.
export function isEven(n: number): boolean {
  return n % 2 === 0;
}
