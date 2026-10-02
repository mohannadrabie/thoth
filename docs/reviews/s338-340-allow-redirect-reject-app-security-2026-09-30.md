# App-security review: s338-340-allow-redirect-reject (Horus, CRITICAL, 2026-09-30)

[app-security-reviewer] Diff 52dc49e^..4d39cef. ADR: `📊 ADR cache HIT: reused 37 ADR(s) ... [CACHE=HIT]`; no security ADR standard violated by the diff.

## Verdict: APPROVE (0 open findings, 0 failing tests)

## Evidence
- `node --test src/policy/config/rule-reachability.test.ts loader-reachability.test.ts loader.test.ts` (own worktree at 4d39cef): tests 62, pass 62, fail 0, skipped 0. Includes R2-22 (every layer), R2-23 (still-loads set), R2-24 (soundness vs real shell normalizer + real kernel), R2-25.
- Kernel matcher, src/policy/kernel/kernel.ts:128-137 (code-traced): verbs match by exact array inclusion (absent/empty = any); targets match `pattern.endsWith("/") ? t.startsWith(pattern) : t === pattern`. No glob, no case folding, no normalization.
- Own probe of the real shell normalizer (raw output): `> mcp/a`, `>> mcp/a`, `> MCP/a`, `> ./mcp/a`, `> mcp//a`, `> mcp/../mcp/a`, `> "mcp/$V"` each emit verbs [write] and the target VERBATIM. `tee mcp/a` and `cp f mcp/a` emit no target (unresolved, fail closed).

## Focus answers
1. Closes the widening, all shapes (#338: unpresentable server, presentable server without marker, bare prefix; #340: catalog verb). Because matching is exact-or-"/"-prefix, any pattern that can equal or prefix a record target beginning `mcp/` must itself begin `mcp/` (a "/"-ending prefix of `mcp/x` starts with `mcp/`). V4's `startsWith("mcp/")` therefore covers the whole reachable pattern set for those records; verb condition (absent/empty/any catalog verb) matches the kernel's verb rule exactly. Sound.
2. Canonicalization: no gap between loader and kernel. Both are byte-exact. Case (`MCP/`), unicode lookalikes, `./mcp/`, `mcp//`, `..` segments and glob metachars never match a class or `mcp/` record differently in the kernel than in V4; `./mcp/...` and `MCP/...` records can only be matched by filesystem-path-shaped allows, which row 83(a) keeps loading by ruling (same as any file path allow). Glob characters are inert in the kernel (`mcp/*` is a literal, still starts with `mcp/`, still rejected).
3. Fail-closed: parseLayerText returns `{error:"schema-invalid", message}` with no ruleSet (loader.ts:155-161); no partial policy is produced. Central whole-load failure is the ruled S7-B behavior; R2-22 asserts it on all three layers.
4. Messages: rule id and target are author text, JSON-quoted and capped at 80 chars (quote(), control chars escaped). No runtime data, no secrets.
5. Unlock accurate per layer: central names the out-of-session owner (a session cannot repair it); shipped-defaults/project name the file. Fix text (marker verb only, or a filesystem path) is correct and is what R2-23 shows still loads.
6. Deny rules untouched: `allowCanMatchShellRecord` returns false for non-allow; R2-23 covers deny matrix.
7. Migration: 0 committed rules in both layers (R2-10 in the passing run). Central out-of-repo rules are unmeasurable; documented in header and CHANGELOG as a migration note.

## Observations (no finding)
- Pre-existing, out of scope: targets are not path-canonicalized by the shell normalizer or kernel (`mcp/../x`), so a path-based deny can be sidestepped by an equivalent spelling. It is not introduced by this diff and V4 only rejects allows, the safe direction.
- Allow rules with no `targets` (or `targets: []`) plus no verbs still load (row 83(a)); a deliberate ruling, not a V4 gap.

## Findings
1. [CLEAN][code-traced] V4 prefix test is complete against the kernel's exact/"/"-prefix matcher (kernel.ts:134-137); no canonicalization gap.
2. [CLEAN][demonstrated] R2-24 + own normalizer probe: real redirect records carry verb write and verbatim target; 62/62 pass.
3. [CLEAN][code-traced] Fail-closed error path returns no partial ruleSet; message content bounded and escaped; Unlock layer-accurate; deny unaffected.

Blockers: none. Hardening: none. Next action: proceed to cross-domain-reviewer / verify.

Editorial: none.

RECEIPT: verdict=APPROVE
findings:
1. [CLEAN][code-traced] rule-reachability.ts V4 startsWith("mcp/") covers every pattern the exact/"/"-prefix kernel matcher (kernel.ts:134-137) can match to an mcp/ record; no canonicalization gap
2. [CLEAN][demonstrated] R2-24 soundness + own normalizer probe (verbatim targets, verb write); 62 pass / 0 fail
3. [CLEAN][code-traced] loader.ts:155-161 fail-closed, no partial policy; messages quoted/capped; Unlock per-layer accurate; deny rules unaffected; 0 committed rules
counts: issues=0 suspicions=0 clean=3
evidence: demonstrated=1 code-traced=2 derived=0
checks="62/0/0"
adr=HIT(37)
report=docs/reviews/s338-340-allow-redirect-reject-app-security-2026-09-30.md
