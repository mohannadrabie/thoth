// The redirect-dense command shapes the linear-scan work (Issue #304) is measured and proven against.
// One definition, three consumers: the deterministic work-scaling test, the differential-equivalence
// instrument (src/qa/redirect-scan-differential.ts) and the latency instrument
// (src/qa/gate-latency-budget-check.ts). The names are the shapes measured quadratic before the fix
// (docs/plans/s7a-gate-hook-robustness-phase1-2026-09-26.md section 3, spike table).
//
//   fd-dup          `2>&1` repeated (a duplicated descriptor, no file target)
//   spaced          `> a` repeated (an operator, a space, a target)
//   glued           `>a` repeated with NO whitespace: every target is the rest of one long token
//   ampersand-glued `&>x` repeated (both-streams form)
//   word-form       `>&w` repeated (a file target through the `>&WORD` form)
//   append          `>> a` repeated
export const REDIRECT_SHAPE_NAMES = ["fd-dup", "spaced", "glued", "ampersand-glued", "word-form", "append"] as const;
export type RedirectShapeName = (typeof REDIRECT_SHAPE_NAMES)[number];

const SHAPES: Record<RedirectShapeName, { head: string; unit: string }> = {
  "fd-dup": { head: "echo", unit: " 2>&1" },
  spaced: { head: "echo", unit: " > a" },
  glued: { head: "echo ", unit: ">a" },
  "ampersand-glued": { head: "echo", unit: " &>x" },
  "word-form": { head: "echo", unit: " >&w" },
  append: { head: "echo", unit: " >> a" },
};

/** A command of AT LEAST `minLength` characters: `echo`, then the shape's unit repeated. Deterministic. */
export function buildRedirectShape(shape: RedirectShapeName, minLength: number): string {
  const { head, unit } = SHAPES[shape];
  const repeats = Math.max(1, Math.ceil((minLength - head.length) / unit.length));
  return head + unit.repeat(repeats);
}
