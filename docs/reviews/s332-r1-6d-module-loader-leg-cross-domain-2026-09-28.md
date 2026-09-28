# Cross-domain review -- s332-r1-6d-module-loader-leg (PR #354, Issue #332)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-28
**Scope:** PR #354, branch feat/s332-r1-6d-module-loader-leg (tip on origin) vs master (c2750a2)
**Tier:** STANDARD (Manager-ratified; run-log tier-ratified event s332-r1-6d-module-loader-leg)
**Paired reviewer:** app-security-reviewer (authz/injection/deps lane) -- no report found in docs/reviews/ at the time of the round-1 pass; round-1 did not assume its findings.

## Setup notes (round 1)

- The adr/ submodule was NOT initialized in this worktree at session start. Initialized it before running the ADR cache, per this role's own standing instruction.
- ADR cache ensure: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13), CACHE=HIT. Read the whole 37-ADR catalog, per PRINCIPLES.md rule 9.

## What changed (round 1, f6b48ff)

Test-only, plus one comment touch-up in classification-catalog.ts's header and process docs (CHANGELOG/STATE/decisions/run-log). No production behavior change.

## Cross-domain ADR verdict (whole catalog, 37 ADRs) -- round 1

No collision found. SE ADR-0005 (Testing strategy): compliant, no test weakened. SE ADR-0010 (quality gates): compliant. SE ADR-0021 (architecture): not implicated. THOTH-ADR-0001 (fixture exception): not implicated, scoped file untouched. Devops ADR-0008 (CI/CD gates): no blocking gate open. Remaining 30 ADRs: no applicable file in diff.

## Seam findings (round 1)

### 1. [ISSUE][MED] Issue #332 auto-closes at merge while 2 of its 4 demonstrated bypass shapes stay untracked by any Issue

Evidence (demonstrated): the build commit's trailer on this branch contained a bare "Closes #332". Round-2 red-team demonstrated four bypass shapes; this PR's leg E closes exactly shapes 1/2. Shapes 3/4 stay open, disclosed only in a code comment and a decisions.md row, no Issue.

Exposure: 0% of production code today (measured -- real-tree scan clean both before/after; gate itself unwired). Risk is to future traceability once #332 closes with no open Issue pointing at shapes 3/4.

Minimal fix: drop Closes #332 trailer, comment on #332 narrowing remaining scope to shapes 3/4, leave it open. Filed as Issue #355.

### 2. [CLEAN] R1-6c (one-catalog-source) confirmed untouched and correctly deferred to Issue #308.

### 3. [CLEAN] Disclosed-residual wording (shapes 3/4) traced against the actual regex logic (FILE_READ_PRIMITIVE, pathLiteral, MODULE_LOADING_HELPER) -- accurate.

## Verification (round 1)

typecheck/lint clean; npm test 1496/1496 pass 0 fail 0 skipped; kernel-purity/normalizer-registry-purity PASS; QA-14 diff mode PASS 454 citations/335 resolved/119 unclassified/0 failed; QA-14 full-tree FAIL 159/7889 (pre-existing, non-gating); QA-15 PASS 2 files; OSS-01 secret scan PASS 0 blocking; mutation proof independently reproduced.

## Editorial (round 1, uncounted, verdict-neutral)

1. CHANGELOG.md/docs/STATE.md claimed QA-14 diff mode "VACUOUS-PASS (0 citations)" -- did not match the real re-run (PASS, 454 citations, 0 failed) or the PR body's own correct number. Stale/copy-pasted line; reword before merge, no re-review needed.
2. Minor secret-scan allowlist count drift (2853 vs 2866) -- non-blocking, not investigated further.

## Verdict (round 1)

APPROVE-WITH-CONDITIONS -- condition: resolve Issue #355 (drop Closes #332 trailer, comment on #332, keep it open) before/at merge.

---

RECEIPT (round 1): verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] PR #354's commit "Closes #332" auto-closes Issue #332 at merge while shapes 3/4 stay untracked -- fix: drop trailer, comment on #332, keep open. Filed as Issue #355.
2. [CLEAN][code-traced] R1-6c confirmed untouched, correctly deferred.
3. [CLEAN][code-traced] Disclosed-residual wording (shapes 3/4) traced against regex logic -- accurate.
4. [CLEAN][code-traced] Whole 37-ADR catalog walked outside app-security's lane -- none implicated.
counts: issues=1 suspicions=0 clean=3
evidence: demonstrated=1 code-traced=3 derived=0
checks=typecheck clean; lint clean; npm test 1496/1496/0/0; kernel-purity PASS; normalizer-registry-purity PASS; QA-14 diff-mode PASS 0 failed (454/335/119); QA-14 full-tree FAIL 159/7889 (pre-existing); QA-15 PASS; OSS-01 PASS; mutation proof reproduced
adr=HIT(37, whole catalog)
report=docs/reviews/s332-r1-6d-module-loader-leg-cross-domain-2026-09-28.md

## ADDENDUM -- 2026-09-28, round 2: lightweight re-confirm of the fix-now delta (f6b48ff..fe0d18d)

Trigger: story-implementer fix-now round 1 (commit fe0d18d) addresses both app-security-reviewer and this review round-1 conditions. Task: confirm the delta closes finding 1 above without introducing anything new -- not a fresh full review.

Setup: own worktree had the adr submodule uninitialized again at session start (same gotcha as round 1, now tracked as Issue #356, filed same day by another party for the general QA-14/gate-manifest-check submodule-pollution class; confirmed as an existing duplicate before treating it as new -- not filed again here). Initialized before any QA-14 run. ADR cache ensure: fp 2095e13, CACHE=HIT -- identical fingerprint to round 1, confirming the 37-ADR catalog is byte-unchanged since the round-1 walk; no new ADR to check against this round comment-only addition.

What changed since round 1, verified directly (not taken on the task brief word alone):

1. Closes #332 dropped from the commit message. Read fe0d18d commit body directly -- no Closes #332 line (commit f6b48ff, the branch first commit, still literally carries it in its own message body -- the Manager accepted, disclosed residual under this project regular-merge-commit workflow; not re-litigated here per the task brief).
2. PR-level auto-close trigger confirmed clear. gh pr view 354 --json closingIssuesReferences returned an empty array. gh pr view 354 --json body shows the PR body states verbatim: "This PR narrows Issue #332 scope. It does not close it -- Issue #332 stays OPEN." and names Issue #355 for the remaining shapes.
3. CHANGELOG.md / docs/STATE.md / docs/decisions.md wording, diffed directly between f6b48ff and fe0d18d: all three reworded "closed" to "narrows"/"narrowed", all three state Issue #332 stays OPEN, all three cross-reference Issue #355 for shapes 3/4. docs/decisions.md addition is a genuinely NEW row -- a count of the scope string in the row returns 0 matches in the f6b48ff copy of the file, 1 in the fe0d18d copy -- append-only discipline preserved, not an edit to an existing row.
4. Issue states, queried directly: Issue #332 is OPEN. Issue #355 is OPEN, title matches the finding.
5. QA-14 diff mode, re-run directly, not copied from the build report. First attempt (submodule uninitialized) gave a false FAIL: 10 of 464 unresolved (all unresolved-authority -- ADR ids the resolver could not find because adr/ was empty). After initializing the submodule: the reference-resolver in diff mode against origin/master..HEAD returned PASS: 464 citation(s), 343 resolved, 121 unclassified (non-blocking), 0 failed, exit code 0. This matches CHANGELOG.md corrected claim exactly. The corrected numbers are real, independently reproduced, not copied from the build report.
6. Third disclosed-residual addition (app-security-reviewer own round-1 finding: bracket/computed-property access on node:module, and a destructured dynamic import() rename) diffed directly against the test file. The change is entirely inside comment blocks (the header doc-comment listing legs A-E, the RESIDUAL note, and MODULE_LOADING_HELPER own explanatory comment). The MODULE_LOADING_HELPER regex line itself appears as unchanged context, not a modified line. Comment-only, confirmed, matches the commit message own "No regex change, no new leg" claim.
7. ADR collision check for the shapes-5/6 addition. Since the whole catalog is byte-identical to round 1 (same fingerprint) and the addition is comment-only, none of the five ADRs found potentially relevant in round 1 (SE ADR-0005, SE ADR-0010, SE ADR-0021, THOTH-ADR-0001, Devops ADR-0008) change verdict. No new collision.
8. Issue Discipline check on app-security-reviewer own round-1 MED finding (shapes 5/6). Verified this does NOT leave a filing gap: app-security-reviewer own report explicitly reasons that it posted the demonstrated finding as a comment on #332 rather than filing a duplicate, since #332 is the exact matching open issue for this defect class -- and an app-security-reviewer-prefixed comment recording the finding is present on Issue #332 (dated 2026-09-28T14:07:58Z, confirmed by reading the issue comment thread directly). This is a defensible application of the project dedup rule, since #332 own title is literally about the single-funnel instrument being name-based -- the umbrella defect class shapes 5/6 belong to. Not a gap.
9. Diff-scope check. A file-level diff between f6b48ff and fe0d18d shows exactly 5 files: CHANGELOG.md, docs/STATE.md, docs/decisions.md, docs/run-log.jsonl (a one-line append, a tier-ratified run-log event, unrelated in content to the fix-now itself but consistent with append-only convention), and classification-builtin-override.test.ts. No other file touched. Matches the task brief exactly; nothing undisclosed.

Not re-run this round (lightweight re-confirm, not a full round): the full npm test suite, QA-14 full-tree, and the mutation-proof replant -- round 1 already verified these against the same test logic, and this round delta is docs/comment-only. The checks line below reflects only what was actually re-run this round.

Round 1 finding 1 is RESOLVED. All three of its prescribed minimal-fix elements (drop Closes #332, comment on #332 narrowing scope, keep #332 open) are done and independently verified, not just claimed. Round 1 Editorial item (QA-14 wording) is also RESOLVED -- CHANGELOG.md/STATE.md now carry the real, re-measured numbers, confirmed by an independent re-run.

No new finding. The one net-new piece of this delta beyond wording (app-security shapes-5/6 comment addition) is comment-only, does not touch the regex, does not collide with any ADR, and its own Issue Discipline handling is sound.

## Verdict (round 2 -- supersedes round 1)

APPROVE

Round 1 sole condition is met and independently verified. No new seam, no new ADR collision, no coverage gap left uncovered. Clean to merge on this reviewer lane.

## Findings to failing tests mapping (round 2)

Open findings: 0. Round 1 finding 1 (the only open item) is resolved, not deferred -- verified via direct query, not a test, per the same Evidence Policy carve-out as round 1 (a process/tracking fix has no executable test form; its settling artifact is the Issue state itself, which was queried directly).

---

RECEIPT (round 2 -- supersedes round 1 receipt as the current verdict): verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [CLEAN][demonstrated] Round-1 finding 1 (Issue #332 premature auto-close) RESOLVED: PR closingIssuesReferences is empty; PR body states #332 stays open and names Issue #355; commit fe0d18d own message drops Closes #332; Issue #332 and #355 both confirmed OPEN by direct query.
2. [CLEAN][demonstrated] QA-14 diff-mode corrected numbers independently re-run, not copied from the build report: PASS, 464 citations, 343 resolved, 121 unclassified, 0 failed, exit 0 -- matches CHANGELOG.md corrected claim exactly. First attempt without submodule init gave a false FAIL (10/464 unresolved-authority) -- resolved by initializing the ADR submodule, a known worktree gotcha already tracked as Issue #356, not a defect in this PR.
3. [CLEAN][code-traced] CHANGELOG.md/docs/STATE.md/docs/decisions.md wording diffed directly: "closed" reworded to "narrows"/"narrowed" in all three, Issue #332 stated OPEN in all three, Issue #355 cross-referenced; decisions.md addition confirmed a genuinely new append-only row, not an edit to an existing one.
4. [CLEAN][code-traced] Third disclosed-residual addition (app-security shapes 5/6) diffed directly -- comment-only, MODULE_LOADING_HELPER regex line unchanged; no new leg, no new assertion.
5. [CLEAN][code-traced] ADR catalog fingerprint identical to round 1 (same 37 ADRs) -- no new ADR to re-check; the five potentially-relevant ADRs from round 1 re-confirmed not implicated by a comment-only addition.
6. [CLEAN][code-traced] app-security-reviewer own round-1 MED finding (shapes 5/6) has no Issue-filing gap: reasoned dedup against Issue #332 itself, an app-security-reviewer-prefixed comment posted on #332 confirms it.
7. [CLEAN][code-traced] Diff scope confirmed exactly 5 files changed -- matches the task brief, nothing undisclosed.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=0 suspicions=0 clean=7
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=5 derived=0
checks=QA-14 diff-mode (origin/master..HEAD, submodule-initialized) PASS 464 citations/343 resolved/121 unclassified/0 failed, exit 0; gh pr view/issue view queries (closingIssuesReferences=[], #332=OPEN, #355=OPEN) all live-queried; commit message and file diffs directly inspected. Full npm test/QA-14 full-tree/mutation-replant NOT re-run this round (lightweight re-confirm on a docs+comment-only delta; round 1 already covered the underlying test logic, unchanged here).
adr=HIT(37, whole catalog, fp 2095e13 -- identical to round 1)
report=docs/reviews/s332-r1-6d-module-loader-leg-cross-domain-2026-09-28.md
