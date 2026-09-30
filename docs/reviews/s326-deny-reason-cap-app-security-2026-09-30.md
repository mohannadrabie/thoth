[app-security-reviewer]
Horus — App Security Review, story #326 (s326-deny-reason-cap), CRITICAL tier, 616a140^..569ac7f
ADR: 📊 ADR cache HIT: reused 37 ADR(s) [CACHE=HIT]. No security ADR standard violated by the diff.

## Verdict: APPROVE

## Findings (all clean; nothing blocking)
1. [CLEAN][code-traced+demonstrated] Sanitize runs AFTER the cap on every path. Cap is in kernel pol05Rule (kernel.ts:76-86,116-119); the only exit for the reason is renderHookOutput -> sanitizedDenyJson (render-hook-output.ts:65-66,80,85), which sanitizes the fully assembled string. sanitizeForTerminal is a per-code-point strip of \p{Cc}\p{Zl}\p{Zp} (sanitize.ts), so a cut mid-ESC sequence loses its ESC/controls anyway; leftover printable "[31" is inert text. A mid-surrogate slice leaves a lone surrogate, which JSON.stringify emits as an escape, not raw bytes; no terminal effect.
2. [CLEAN][code-traced] Marker is not attacker-shaped: static text plus text.length (a number). No untrusted bytes beyond the 512-char prefix.
3. [CLEAN][code-traced] No verdict change: only the reason string differs; outcome/ruleId untouched; ActionRecord.unresolved unmutated, so audit record keeps full text.
4. [CLEAN][demonstrated] Kernel purity preserved: `node src/qa/kernel-purity-check.ts` -> PASS, 4 production files, zero import violations. #312 guards unmodified (no diff to sanitize.test.ts, config/, gate/, hook .mjs) and green.
5. [CLEAN][demonstrated] `node --test` sanitize.test.ts, kernel.test.ts, hooks/pretooluse-kernel-gate-reason-cap.test.ts, src/policy/gate/*.test.ts: 177 pass / 0 fail / 0 skipped.

## Hardening (non-blocking, not filed)
- Entry COUNT is not capped (only per-entry length); normalizer emits a small fixed number of entries per command (shell.ts:146-371), so output is bounded in practice. Cross-domain already noted the duplicated 512 constant has no equality pin.

## Blockers: none. Open findings 0 = failing tests 0.
Next action: merge-handoff.

RECEIPT: verdict=APPROVE
findings:
1. [CLEAN][code-traced] kernel.ts:76-86,116 + render-hook-output.ts:65-80 — sanitize runs after cap on all paths; per-char strip can't be defeated by truncation or surrogate cut
2. [CLEAN][code-traced] kernel.ts:83 — marker is static text plus a numeric length; not attacker-shaped
3. [CLEAN][code-traced] kernel.ts:116-119 — verdict/ruleId unchanged; ActionRecord (audit) keeps full text
4. [CLEAN][demonstrated] kernel-purity-check PASS; #312 guards untouched and green
5. [CLEAN][demonstrated] 177 pass/0 fail/0 skipped across sanitize, kernel, reason-cap, gate tests
counts: issues=0 suspicions=0 clean=5
evidence: demonstrated=2 code-traced=3 derived=0
checks="177/0/0"
adr=HIT(37)
report=docs/reviews/s326-deny-reason-cap-app-security-2026-09-30.md
