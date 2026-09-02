// Self-test fixture (kernel-purity-check.ts, CLEAN case): mimics a real kernel file — only a
// same-directory relative import, no bare/non-relative imports, no forbidden globals. Proves
// kernel-purity-check.ts does NOT flag legitimate pure code (see kernel-purity-check.test.ts).
import { double } from "./helper.ts";

export function triple(n: number): number {
  return double(n) + n;
}
