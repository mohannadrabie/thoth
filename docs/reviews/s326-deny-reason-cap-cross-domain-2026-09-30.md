# s326 deny-reason cap - cross-domain review (Ra), 2026-09-30

[cross-domain-reviewer] Diff 616a140^..569ac7f (CRITICAL; guard/policy-engine sensitive area).
📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog [CACHE=HIT]. Whole catalog read, unfiltered.

## Lanes
Ran alongside: domain reviewer(s) per CRITICAL tier (not re-covered). Changed files: kernel.ts (+14/-1), kernel.test.ts, new hooks/pretooluse-kernel-gate-reason-cap.test.ts, CHANGELOG.md.

## Cross-domain ADR verdict
No collision found in the diff for any ADR outside the reviewers' lanes. The kernel stays import-free (the cap is duplicated, not imported, consistent with the kernel-purity ADR/G15); no infra, IAM, network, schema, or API-contract file touched. Code read, no ADR-violation.

## Seams checked
1. CI glob: `npm test` = `node --test` (package.json:16), CI runs it (ci.yml:203); the new file sits beside 6 sibling hooks/*.test.ts of identical naming. Picked up. [CLEAN][code-traced]
2. #308 precondition list: already cites #326 (comment, "Activation preconditions added or confirmed"). No new comment needed; optionally a note that #326 is now fixed pending merge. [CLEAN][code-traced]
3. Audit/evidence trail: the change is display-only and ActionRecord.unresolved is untouched (kernel.test AC-326-5 asserts it). But no shipped path in this tree persists the verdict reason or unresolved text (grep of hooks/pretooluse-kernel-gate.mjs, src/policy/gate: no audit write; hooks/audit-log.mjs is absent at this commit), so CHANGELOG's "audit trail keeps the full text" is a forward-looking statement, not something an instrument shows. LOW, no fix in this diff; the audit-log story must retain the ActionRecord, not the reason string. [SUSPICION][LOW][code-traced]
4. Duplicated cap value: 512 exists as REASON_NAME_CAP (decide-tool-call.ts:57), UNRESOLVED_FRAGMENT_CAP (kernel.ts:81) and a literal REFLECT_CAP in kernel.test.ts. Nothing pins gate == kernel; kernel.ts only carries a comment saying they match. Drift is benign for safety (both are display caps; the 4096-byte stdout pin in the hook test would catch a kernel cap raised past roughly 1.7 KB/entry), so LOW. Minimal fix: one test in src/qa or gate tests that reads both constants' source text and asserts equality (the kernel purity check already scrapes sources). [SUSPICION][LOW][code-traced]
5. QA-15 CHANGELOG numbers vs measured: I did not re-run the hook (worktree has no node_modules; running requires install). The figures (748/749/703/1148 bytes, "5 of the new tests red before fix", "three unit tests") are hand-recorded. Count of unit tests (3) and hook tests (6) matches the diff; the byte figures are UNPROVEN-pending-verification. Settle with: `node --test hooks/pretooluse-kernel-gate-reason-cap.test.ts` after `npm ci`, and compare the printed sizes; any Manager/verify pass can run it. Not a blocker. [SUSPICION][LOW][derived]
6. Marker wording seam: identical marker format `[truncated, N characters in all]` in gate and kernel, and the sanitizer in render-hook-output runs after the cap (AC-326-8 covers it). [CLEAN][code-traced]
7. Slice cut can split a UTF-16 surrogate pair at index 512, leaving a lone surrogate that JSON.stringify emits as an escape; still valid, non-blank, bounded. Same behavior already shipped for REASON_NAME_CAP. [CLEAN][code-traced]

## Coverage gaps
- The "runtime's own stdout limit unmeasured" is stated openly in CHANGELOG and remains on #308's preconditions; intentional.
- No gap on the four changed files.

## Verdict: APPROVE
Next action: on verify, run the reason-cap test file once to settle item 5's byte figures; optionally add the 512 equality pin (item 4) as a backlog chore.

Editorial: none.

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][LOW][code-traced] kernel.ts:81 vs decide-tool-call.ts:57 - 512 cap duplicated, no instrument pins equal; add a source-scrape equality test (backlog)
2. [SUSPICION][LOW][code-traced] CHANGELOG #326 "audit trail keeps full text" - no shipped audit writer in tree to verify it; forward-looking
3. [SUSPICION][LOW][derived] CHANGELOG #326 byte figures (748/749/703/1148) not re-run by me; settle via `npm ci && node --test hooks/pretooluse-kernel-gate-reason-cap.test.ts`
4. [CLEAN][code-traced] new hook test file matched by `node --test` / ci.yml:203
5. [CLEAN][code-traced] #308 already cites #326; no comment needed
6. [CLEAN][code-traced] marker + sanitizer ordering, surrogate slice, kernel isolation preserved
counts: issues=0 suspicions=3 clean=3
evidence: demonstrated=0 code-traced=5 derived=1
checks=n/a (nothing executed; worktree had no node_modules)
adr=HIT(37, whole catalog)
report=docs/reviews/s326-deny-reason-cap-cross-domain-2026-09-30.md
