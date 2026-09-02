// Self-test fixture (kernel-purity-check.ts, VIOLATING case — Issue #63 fix-now regression): a
// production file whose only violation is a forbidden global reached through trivial
// string-concatenation obfuscation. `Reflect.get(globalThis, "proc" + "ess")` never contains the
// literal token "process" anywhere in its source, so the original `\bprocess\b`-only regex missed
// it entirely (demonstrated by app-security-reviewer, S2 review 2026-09-01, Issue #63). Proves the
// widened `globalThis`/`Reflect` bare-identifier patterns catch this obfuscation class directly —
// the reassembled string never has to be matched, because the identifiers reaching for it can't
// be hidden the same way. See kernel-purity-check.test.ts.
export function obfuscatedProcessAccess(): unknown {
  return Reflect.get(globalThis, "proc" + "ess");
}

// Issue #63 addendum (S2 re-confirm, app-security-reviewer): Node's bare `global` identifier
// (distinct from the standard `globalThis`) reaches the exact same object but was previously
// absent from FORBIDDEN_GLOBAL_PATTERNS, so `global["proc" + "ess"]` bypassed the check with zero
// detections. Proves the added `\bglobal\b` pattern now catches this variant too. See
// kernel-purity-check.test.ts.
export function obfuscatedProcessAccessViaBareGlobal(): unknown {
  return (global as unknown as Record<string, unknown>)["proc" + "ess"];
}
