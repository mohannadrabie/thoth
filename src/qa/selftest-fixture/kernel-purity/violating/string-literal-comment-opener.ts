// Self-test fixture (Issue #362/#363, red-team round 2 finding R1, drill N2): a STRING literal
// holding a `/*`-shaped substring (a path glob, the same documentation-of-the-boundary reflex that
// caused the original F1/F2 comment-based bug one token kind earlier) must not blind the import
// scan. Placed AFTER a real import, followed by a real forbidden `node:fs` import and a live
// `readFileSync` call — the exact shape red-team's drill planted directly in `kernel.ts` and
// measured as a silent bypass (qa:kernel-purity PASS rc=0, full suite green, byte-identical to a
// clean baseline) before the `stripComments` lexer rewrite. The lexer-derived `stripComments` sees
// the whole string literal as one token (its `/*`-shaped content never opens a comment), so the
// `node:fs` import below is not blinded. See kernel-purity-check.test.ts.
const KERNEL_GLOB = "src/policy/kernel/**";

import { readFileSync } from "node:fs";

export function auditTrail(p: string): string {
  return readFileSync(p, "utf8") + KERNEL_GLOB;
}
