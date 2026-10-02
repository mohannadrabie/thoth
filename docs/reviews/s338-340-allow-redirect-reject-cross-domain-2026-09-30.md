# Cross-domain review — s338-340-allow-redirect-reject (Ra, CRITICAL) — 2026-09-30

📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog [CACHE=HIT]. Whole catalog read, unfiltered.

Diff: 52dc49e^..4d39cef (CHANGELOG, rule-reachability.ts + test, tool-class-format.ts). Reviewed in a private detached worktree (removed).

## Lanes that ran
app-security-reviewer (Horus): APPROVE, 3 clean (V4 completeness vs kernel matcher, fail-closed load, layer-aware unlock). Not re-covered here.

## Cross-domain ADR verdicts
- THOTH-ADR-0001 (central-classification exception): N/A. It concerns docs/qa/s5-central-classification.json entries; V4 touches the rule loader/reachability only. The rejection is in the "loader" half that still draws fresh review, and that review exists. No collision.
- THOTH-ADR-0002, ADR-0016/0019/0020/0021 (architecture/integration/security, self-protection, kernel/Action record): V4 sits in config/, reads kernel vocabulary (KNOWN_VERBS, MCP_TARGET_PREFIX) and does not alter the kernel or the schema (`schema.ts` untouched). No collision.
- SE ADR-0005 (testing) / ADR-0010 (quality gates): REPLACED locked tests. Checked assertion-by-assertion in the diff: R2-12, 10 allow cells flipped false->true (deny column unchanged, marker/stray-only rows unchanged); R2-17 part 3 flipped expectLoads->expectRejects, plus a stricter one-error/field-path assertion, and the marker-alone rejection became a stronger expectRejects; R2-6 whole-record allow loop kept, split into V4-rejects vs loads, with a new non-vacuity assert (`allowRejectedByV4 > 0`). No assertion removed; each replacement carries a REPLACEMENT header citing the 2026-09-30 decisions rows. Compliant. Ran: `node --test src/policy/config/rule-reachability.test.ts` -> tests 23, pass 23, fail 0, skipped 0.
- Remaining ADRs (iac/cdk/data/cost/tagging etc.): no changed files in their lanes.

## Seams checked
1. Policy delivery / loader: a newly rejected central rule fails the whole load (fail closed, ruled; CHANGELOG discloses it and the central source is out of repo so exposure is unmeasurable). Committed layers hold 0 rules. Sound and disclosed.
2. Printer/CLI: V4 errors ride the existing `schema-invalid` path (same as V1-V3), so print-cli shows them unchanged, with the Unlock clause. #288's printer items are separate and stay blocked on #308. No new printer surface.
3. Docs: grep of docs/ found no rule-author doc still prescribing a now-rejected shape; the only residual prose is STATE.md history lines and the #308 plan (below).
4. CHANGELOG counts: 648/805/1836 are in an older, unrelated entry (reference-resolver measured figures), not this entry. The new entry carries no hand-typed counts; QA-15 has nothing to trip on. Real verification counts belong to the Manager's verify stage.

## Findings
1. [LOW][derived] Stale downstream tracking: docs/plans/s308-activation-phase1-2026-09-30.md X-19/S2 say #338/#340 are "NOT yet built", and Issue #308's preconditions (comments naming #338, #340) still read as open. Fix: after the human closes #338/#340, post a `[Manager]` comment on #308 that the two preconditions are built (V4, 4d39cef), and refresh the plan row. Editorial/bookkeeping, not gating; not filed.

## Coverage gaps
None material. Test file and CHANGELOG are covered by the code lane and the ADR lane above; no new file types.

## Editorial
- STATE.md lines still list #338/#340 as "held"; update at handoff.

Verdict: APPROVE. Single next action: comment on #308 (and refresh its plan row) at handoff.

RECEIPT: verdict=APPROVE
findings:
1. [LOW][derived] #308 plan X-19/S2 and #308 preconditions still show #338/#340 unbuilt; post a comment on #308 at handoff (bookkeeping, not filed)
2. [CLEAN][demonstrated] SE ADR-0005/0010 test replacements: assertions flipped, none removed, non-vacuity assert added; rule-reachability.test.ts 23/23
3. [CLEAN][code-traced] THOTH-ADR-0001 / policy-delivery: no collision; central fail-whole-load disclosed in CHANGELOG
4. [CLEAN][code-traced] printer/CLI: V4 uses the existing schema-invalid path; no new surface
5. [CLEAN][code-traced] CHANGELOG counts (648/805/1836) are from an older entry; the new entry has none
counts: issues=0 suspicions=1 clean=4
evidence: demonstrated=1 code-traced=3 derived=1
checks=23/0/0 (node --test rule-reachability.test.ts: pass/fail/skipped)
adr=HIT(37, whole catalog)
report=docs/reviews/s338-340-allow-redirect-reject-cross-domain-2026-09-30.md
