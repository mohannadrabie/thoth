# Red Team (Sutekh) — ROUND 5 — s312-fixnow-360-363 (Issues #360, #367, #368)

- Date: 2026-09-29. Round 5. Tier CRITICAL. Delta: git diff 12a4454..e63cd4b (6 commits).
- ADR cache: HIT, 37 ADRs. Worktree ../thoth-rt5, removed at close.
- Live exposure: PreToolUse gate hook unwired (#308) so 0% live. CI guards live.
- Verdict: GO. No HIGH. Every round-4/app-sec finding CLOSED. 1 MED + 2 LOW remain, all DISCLOSED residuals; none a new root cause; none forces no-go.

## Baseline (worktree)
build rc=0; lint (eslint .) rc=0; qa:hook-typecheck-coverage PASS rc=0 (pretooluse 0 / sessionstart 30==30 / halt-relay 22==22); node --test 4 touched files 78/78 pass 0 fail 0 skip.

## Round-4 / app-security findings — all CONFIRMED CLOSED
- N1 + app-sec finding 2 (function-param/object-binding/let-reassign/catch/for-of/var/spread/module-object/bracket-decoy shadow family): re-architected to deny-by-default on SHAPE backed by ts.Program + checker.getSymbolAtLocation. sanitizeMod and render each must appear exactly twice; second arg literally sanitizeMod.sanitizeForTerminal; one renderHookOutput name; symbol must resolve to a const array-destructure element of await Promise.all([...]) at the matching index with the exact import specifier, no spread/hole, Promise unshadowed. Verified: a real param-shadow mutant on the hook is REJECTED (sanitizeMod must appear exactly twice ... found 4). AC-7d(14 shapes) + AC-7e + AC-3 (no process.env) green. #360 root cause fixed.
- N2 + app-sec finding 1: ban-ts-comment now explicit options (all four banned); noInlineConfig on the hooks block; coverage instrument independently scans for @ts-*, eslint-disable, @type any/star. Verified: inline eslint-disable neutralized (eslint warns has no effect ... noInlineConfig) AND scan reports type-suppression found (@ts-ignore, eslint-disable).
- N3 (#368 identity churn): identity now code|whitespace-normalized-line-text; baseline generated JSON; --regenerate-baseline refuses any new identity (ratchet down only). Verified: one blank line into sessionstart-tool-enum.mjs now rc=0 (round 4: 16 false NEW regression).
- N4: closed by explicit options. N5 (.js escape): listProductionHooks filters .mjs or .js; eslint glob covers both. Confirmed in code.

## New findings against the round-5 mechanisms

### F1 — [ISSUE][MED][demonstrated] @param any is a type-suppression the scan does not see (same #367 class; @type any closed, @param any open)
Exposure: ~100% of type-only defects hidden behind a @param any widening in the 3 hooks; 0 such casts hide a real bug today (the hook uses @param any err legitimately at line 109). basis: measured. Live 0% (#308).
scanHookSuppressions (hook-typecheck-coverage-check.ts:158) matches @type any/star but not @param any. Planted in hooks/pretooluse-kernel-gate.mjs (the hook held to ZERO diagnostics): a helper with @param any sink that calls the two-arg failClosed with one arg. All gates green: coverage rc=0 (0 diagnostics, fully covered), eslint . rc=0, build rc=0, scan findings empty. Same family as #367/round-4 N2 via a spelling with NO detecting layer. DISCLOSED in CHANGELOG. Not a new root cause; narrower than the original; realistic trigger is a future reviewed hook edit copying the file own @param any idiom with a type bug riding along. Per rule 21 (narrow blast radius, 0% live, disclosed) does NOT gate ship — tracked as a residual on #367.
Named proof-test: hook-typecheck-coverage-check.test.ts :: scanHookSuppressions flags @param any as a type-widening suppression.

### F2 — [ISSUE][LOW][demonstrated] a nested hooks subdir .mjs escapes coverage enumeration (linted, but untypechecked/unpinned)
Exposure: 0 nested hooks today (hooks/ flat). basis: measured. listProductionHooks is non-recursive readdirSync(hooks). Planted hooks/sub/evil.mjs with a plain arity bug: coverage still reports 3 production hooks (4th invisible); eslint . DOES lint it (recursive glob). A nested hook without a pragma escapes the type/baseline check. DISCLOSED in CHANGELOG. LOW.
Named proof-test: listProductionHooks enumerates hooks recursively.

### F3 — [SUSPICION][LOW][code-traced] identity-collision laundering under the position-independent pin
Basis: assumption — not demonstrated. Pin compares currentCount <= pinnedCount per code|normalized-line-text. In principle paying down all real occurrences of a pinned identity K (5 to 0) and adding one NEW bug whose line normalizes identically with the same code passes (1 <= 5). Constructing a genuinely different bug with byte-identical normalized text + code is contrived; not demonstrated. Residual, not a blocker.

## Per-Issue closeability
- #360 CLOSEABLE. Hand-rolled-resolver-fails-open root cause (3 rounds) architecturally fixed: deny-by-default shape + compiler symbol table + AC-3 no-process.env closing the open set AC-9 finite matrix cannot. Every shape rejected; verified end-to-end on the real hook.
- #367 CLOSEABLE with a tracked residual. Named defect and its round-4 extensions all closed at two independent layers. Remaining @param any (F1) is a disclosed residual — comment on #367; do not hold open indefinitely on ever-narrower spellings (rule 16).
- #368 CLOSEABLE. Position-independent identity + generated ratchet-down baseline fixes the 89.4% false-fail and the re-baseline laundering.

## Editorial
CHANGELOG Not-fixed-recorded list is accurate and matches what I found. Honest disclosure; credited.

## Scariest unproven assumption
That @param any (F1) is the LAST unscanned suppression spelling — the scan is a spelling blocklist, not a semantic did-the-compiler-lose-a-diagnostic check. Mitigated by 0% live exposure and the sensitive-area review gate on any hook edit. Go / no-go: GO. Next action: comment F1 onto #367; close #360/#367/#368 as the human sees fit.

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [CLEAN][demonstrated] N1/app-sec-2 sanitize shadow+alias+spread family — deny-by-default shape guard + symbol table + AC-3 rejects a real param-shadow (found 4); AC-7d(14)+AC-7e green — SURVIVES, #360 root cause fixed
2. [CLEAN][demonstrated] N2/app-sec-1 pragma+eslint-disable+@type-any suppression — explicit ban-ts-comment options + noInlineConfig + independent scan — SURVIVES
3. [CLEAN][demonstrated] N3/#368 identity churn — position-independent identity; blank-line drill now rc=0 — SURVIVES
4. [CLEAN][code-traced] N4 ban-ts-comment defaults / N5 .js escape — explicit options + .mjs/.js glob and enumeration — SURVIVES
5. [ISSUE][MED][demonstrated] F1 @param any suppression escapes the scan on the zero-diagnostic hook (all 4 gates green over a dropped-arg bug) — disclosed residual, same #367 class, 0% live, does not gate
6. [ISSUE][LOW][demonstrated] F2 nested hooks subdir .mjs escapes coverage enumeration (linted only) — disclosed, no nested hook today
7. [SUSPICION][LOW][code-traced] F3 identity-collision laundering under the pin — contrived, not demonstrated
counts: issues=2 suspicions=1 clean=4
evidence: demonstrated=6 code-traced=1 derived=0
checks=build rc=0; lint rc=0; qa:hook-typecheck-coverage PASS; node --test 78/78 pass 0 fail 0 skip (baseline) + 8 mutation drills planted/reverted in worktree
adr=HIT(37)
report=docs/reviews/s312-fixnow-360-363-red-team-round5-2026-09-29.md
