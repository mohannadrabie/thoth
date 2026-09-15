# Cross-Domain Review (round 2) -- path-b-precommit-secret-scan -- 2026-09-14

Reviewer: cross-domain-reviewer (Ra)
Branch: feat/path-b-precommit-secret-scan, HEAD a9d68e4 (commits under re-verification: 1a63416, 1aabb2c, d6a0983, 9f0eb1c, 4ea1456, a9d68e4)
Tier: CRITICAL (unchanged, docs/.maat-state.json scope=path-b-precommit-secret-scan)
Trigger: targeted round-2 re-confirm of my own round-1 findings (#185, #186), a fresh cross-domain sweep of the round-1 fix-now commits, and independent reproduction of every quantitative claim in the fix-now receipt.

## ADR cache

node docs/adr-cache.mjs --ensure -> "ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- fp 83b2e3e [CACHE=HIT]". Whole catalog re-read unfiltered, unchanged fingerprint from round 1.

## Finding #186 (R2/R3/R7 undocumented) -- CONFIRMED FIXED

git show 4ea1456 touches CHANGELOG.md and docs/STATE.md. Read both directly, not the receipt text alone:

- CHANGELOG.md:19-27 -- eight individually-labeled bullets, R1 through R8, each naming its own evidence pointer.
- docs/STATE.md:16-24 -- the same eight bullets, same structure, cross-referenced to the same evidence.

R2 (zero new exemption-grant surface), R3 (real, blocking git commit refusal), R7 (sensitive-area review ceremony) are now each their own named bullet in both files, alongside R1/R4/R5/R6/R8. Grep for the R-bullet markers against both files returns 8 of 8. CLOSED -- GitHub Issue #186 closed completed this turn, comment posted with the exact line evidence.

## Finding #185 (state-transition gap) -- CONFIRMED FIXED, pre-round per the Manager own commit 1a63416

Read docs/.maat-state.json directly, the whole file, not just git diff --stat:

- Top-level scope: path-b-precommit-secret-scan. tier: CRITICAL. reviewRoundsSinceClean/reviewRoundsTotal: 1/1 -- correctly incremented from a fresh 0/0 baseline by round-1 own no-go verdict (commit 1aabb2c, message confirms round-1 no-go verdict), not left at s1-closeout-164-154 stale 3/3.
- humanRulingRequired false, councilHeld false, councilVerdict null, roundsSinceLastGo 0 -- a genuine fresh baseline, not carried-over elevated state.
- priorScope.scope is s1-closeout-164-154, and its own full nested priorScope chain (back through qa14-issue137-precision-fastfollow, qa14-marker-redesign, qa1415fix, cifix, s6) is present, content-identical to what round 1 read at the top level before the transition -- nothing lost, nothing summarized away.

CLOSED -- GitHub Issue #185 closed completed this turn, comment posted.

## Fresh cross-domain sweep of the round-1 fix-now commits (4ea1456, a9d68e4)

Read the actual diffs, not the receipt text alone. 4ea1456 touches: .githooks/pre-commit, CHANGELOG.md, docs/STATE.md, docs/qa/secret-scan-allowlist.json, package.json, src/lib/exec.ts (comment-only), src/lib/git-hooks-install.ts (new) plus its test, src/secret-scan/pre-commit-scan.ts plus test, src/secret-scan/simulated-commit.ts plus test. a9d68e4 touches only docs/qa/secret-scan-allowlist.json.

ADR collision check, whole catalog, not a lane slice: none of these files are IaC/CDK/tagging/cost/IAM/pipeline surface -- devops ADR-0008 Gitleaks rule stays NOT-APPLICABLE for the same tool-stack-scoping reason established in round 1 (re-confirmed, not re-litigated: ci.yml diff is still empty, no infra surface exists in this repo). No governance-plugin/reference-port ADR (0016-0021) is implicated -- none of the touched paths fall under src/(kernel|gates|policy), hooks/, or bin/. SE ADR-0003 (inject I/O deps) is honored by the new src/lib/git-hooks-install.ts taking Runner as a parameter, same as the existing modules. SE ADR-0010 (no suppressions without justification): grepped both new/changed .ts files for eslint-disable, ts-ignore and ts-expect-error markers -- zero matches.

Seam-hunt on the specific redesigned logic named in the dispatch (bulk git ls-files -s -z plus Map lookup; two-pass deletion/addition apply):

1. resolveAllStagedBlobs (simulated-commit.ts:134-152) builds an argv-safe, unfiltered bulk read (git ls-files -s -z, no pathspec argument at all) -- this removes the attacker-controlled-argv surface the old per-path call had, it does not add one. The one asymmetry traced closely -- update-index --add --cacheinfo MODE SHA PATH (line ~207-212) omits the -- separator that the deletion call (--force-remove -- PATH) uses -- is exactly the seam app-security-reviewer own round-1 re-verification already empirically settled (docs/reviews/path-b-precommit-secret-scan-app-security-2026-09-14.md:29-31,102-114): a real file was staged named "--upload-pack=touch pwned" against the shipped buildSimulatedCommit, confirming the dash-leading path resolves correctly with no flag injection, and separately proving inserting -- here would have been the actual bug (git own 3-arg --cacheinfo form consumes the next three tokens positionally; a -- would itself be consumed as the literal 3rd argument, pushing the real path out to be misparsed). That evidence is demonstrated, current-code, and directly on point -- re-raising it here would be noise, not a finding.
2. Traced the merge-conflict edge the bulk-Map redesign changes: git ls-files -s on a mid-conflict path emits multiple stage-numbered lines (stage 1/2/3) for the same path; the Map set() call is last-write-wins, silently picking stage 3 (theirs) where the old per-path call structurally returned only the first line. This is a real behavioral difference introduced by the redesign, but reachability is the question: git itself refuses commit before a hook own logic can matter. Live-reproduced: created a throwaway mkdtemp fixture, staged an unresolved merge conflict (status UU), then ran git -c core.hooksPath=nonexistent commit against it -- result: "fatal: Exiting because of an unresolved conflict." exit 128, at git own commit-preparation stage, before any hook-invoked scan could run. CLEAN -- the pre-commit hook (and this scanner) never sees a mid-conflict index in the first place; this stays exactly the disclosed non-goal simulated-commit.ts:33-35 already names, unaffected in practical severity by the redesign.
3. Traced the two-pass deletion-then-addition ordering for a shape neither red-team #189 test nor its own reverse-direction sibling test covers: a partial directory replacement (some files under a directory removed, one new file added at the directory own path, while an untouched sibling file remains tracked under the same directory prefix). Concluded this is structurally unreachable: git own index cannot simultaneously hold foo (a blob) and foo/sibling.ts (a blob under that prefix) -- git add foo itself refuses with a fatal collision error while foo/sibling.ts remains staged, so the real index (git diff --cached --name-status, the actual source of truth) can never present this input shape to buildSimulatedCommit in the first place. Not independently re-demonstrated here (git own well-documented index invariant, code-traced reasoning only) -- flagged as derived-tier reasoning, not a blocking claim.

No new ISSUE surfaced from this sweep.

## Quantitative claims -- reproduced independently

- npm run typecheck: ran directly, clean.
- npm run lint: ran directly, clean.
- npm test: ran directly, tests 822 / pass 822 / fail 0 / cancelled 0 / skipped 0 / todo 0. Exact match to the receipt.
- history-scan.ts: ran directly, PASS: Full history scanned, 0 blocking secret-shaped matches found (808 allowlisted). Exit 0. Receipt said 663 allowlisted; live count is 808 -- see Editorial, non-blocking.
- completeness-claim-checker.ts: ran directly, PASS: 2 file(s) checked, all completeness claims verified. Exact match.
- recurring-findings-registry.ts: ran directly, PASS: 2 recurring finding class(es) logged, all structurally valid. Exact match.
- reference-resolver.ts master..HEAD, 30 failed, claimed pre-existing baseline not a regression: ran directly on current HEAD, FAIL: 30 of 1222 citation(s) failed to resolve. Exact match on the 30. Independently checked the not-a-regression claim: the receipt own git-stash method does not actually apply here (a clean tree with no uncommitted changes has nothing to stash), so a throwaway git worktree was built at 86f053c (the pre-fix-now commit) and the same range re-run there: FAIL: 44 of 944 citation(s) failed. The count dropped 44 to 30 across round-1 fix-now commits, confirming no regression, and a net improvement.
- ci.yml diff still empty: ran directly, git diff master...HEAD --stat -- .github/workflows/ci.yml empty.
- ADR cache HIT fp 83b2e3e unchanged: ran directly, confirmed.
- R6 (patterns.test.ts untouched): ran directly, git diff master...HEAD -- src/secret-scan/patterns.test.ts empty.

One real discrepancy found: the receipt states history-scan.ts shows 663 allowlisted; the live run shows 808. Traced the cause: round-1 own fix-now commit added net-new allowlist entries (report-evidence literals) after the receipt own count was written, and a9d68e4 dogfood fix added one more. This is a stale-number-in-prose defect, not a functional gap -- the instrument own live behavior (PASS, 0 blocking) is what gates, and that matches. Routed to Editorial.

## The 2 self-caught dogfood fixes

1. Round-1 own new report-evidence literals (the AKIAFAKEFAKEFAKEFAKE fixture string quoted verbatim by red-team and app-security-reviewer own round-1 reports, plus the allowlist file own self-referential reason text quoting that same string): confirmed 5 new entries in docs/qa/secret-scan-allowlist.json (diff 86f053c..a9d68e4), each scoped to one exact path plus patternId pair with a reason citing the specific report/round. history-scan.ts PASS 0 blocking confirms nothing is left unallowlisted. Resolved, no new gap -- same narrow-scoping discipline this project allowlist file already uses everywhere else in it.
2. 2 QA-14 (path/issue-citation) false positives from illustrative example paths in new comments (.git/index.lock-shaped, src/foo.ts-shaped): read the current committed comments directly (simulated-commit.ts:19, :182-184) -- both now read as plain prose without a backtick-quoted, line-numbered citation shape that would trigger classifyPath. The master..HEAD reference-resolver re-run above (30 failed, down from 44) independently confirms no new blocking citation failures were introduced by this diff own comments. Resolved, no new gap.

## Coverage / clean seams checked (no new finding)

- CLEAN, demonstrated: .githooks/pre-commit tracked mode is 100755 (git ls-files -s), matching the #187 fix; git log -p confirms the mode-change diff (old mode 100644, new mode 100755) landed in the fix-now commit.
- CLEAN, code-traced: src/lib/exec.ts round-1 change is comment-only (documents the GIT_INDEX_FILE load-bearing behavior settled by red-team own suspicion #7) -- no logic change, confirmed via git diff.
- CLEAN, demonstrated: package.json prepare script now calls src/lib/git-hooks-install.ts (the #191 DI extraction) instead of an inline git config string; the new module no-ops (does not hard-fail) outside a .git directory, confirmed via its own dedicated test file and direct code read.
- CLEAN, demonstrated: working tree clean, no stray worktrees left behind, git status --short empty at end of this review.

## Coverage gaps named

None beyond the two now-closed findings from round 1. Everything else in this round diff (git-plumbing correctness under red-team own demonstrated attack shapes, argv-injection under app-security-reviewer own demonstrated probes) sits inside those lanes own re-verification, not re-covered here per the redundancy-check discipline.

## Verdict

APPROVE. Both round-1 cross-domain findings (#185, #186) are independently confirmed fixed against the actual committed artifacts, not the receipt prose. No new ADR collision. The fresh seam-hunt on the specifically-flagged redesigned logic (bulk blob resolution, two-pass apply) found no new blocking gap -- the one asymmetry worth tracing closely was already independently demonstrated CLEAN by app-security-reviewer own round-1 re-verification, and the two edge cases traced independently here (merge-conflict stage collapse, partial-directory-replacement collision) are both structurally unreachable via git own index invariants, confirmed live for the first and by code-traced reasoning for the second. Every quantitative claim in the fix-now receipt reproduced independently, with one stale-number-in-prose discrepancy (663 vs live 808 allowlisted entries) that does not affect any gating claim, routed to Editorial.

Single next action: none blocking -- this branch is ready for the Manager own Stage 4/5 verification and any still-pending red-team round-2 re-confirm of its own #187/#188 HIGHs (outside this report lane).

## Editorial (verdict-neutral, plain edits, no re-review)

- The fix-now receipt "663 allowlisted" figure for history-scan.ts is stale by the time it was written (live count is 808, after the round-1 fix-now commit own allowlist additions landed). No claim gates on the exact number; fix by re-running the instrument rather than hand-typing the count next time.

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius -- status ISSUE=confirmed collision/gap, SUSPICION=unconfirmed needs a second look, CLEAN=seam checked sound; evidence tag per PRINCIPLES rule 19):
1. [CLEAN][code-traced] docs/.maat-state.json scope-transition (round-1 finding #185) independently re-read whole: scope/tier/counters correct, priorScope chain intact -- Issue #185 closed completed this turn.
2. [CLEAN][code-traced] CHANGELOG.md:19-27 plus docs/STATE.md:16-24 (round-1 finding #186) independently re-read: all 8 R1-R8 bullets now individually named -- Issue #186 closed completed this turn.
3. [CLEAN][demonstrated] update-index --add --cacheinfo (no -- separator) dash-leading-path seam: already independently demonstrated CLEAN by app-security-reviewer own round-1 re-verification (real probe against a dash-leading staged filename) -- re-checked that evidence, not re-raised as a duplicate finding.
4. [CLEAN][demonstrated] Merge-conflict stage-collapse in the new bulk ls-files Map (last-write-wins across stage 1/2/3) is unreachable in practice: live-reproduced that git itself refuses commit on an unresolved conflict (fatal: Exiting because of an unresolved conflict, exit 128) before any hook-invoked scan could run.
5. [CLEAN][derived] Partial-directory-replacement collision (an untouched sibling file surviving under a directory a new file replaces) is structurally unreachable via git own index invariants (git itself refuses to co-hold a blob and a same-prefix subtree) -- reasoned from git documented behavior, not independently re-demonstrated.
6. [CLEAN][demonstrated] No new ADR collision from the round-1 fix-now files, whole catalog re-checked: devops ADR-0008 Gitleaks rule stays NOT-APPLICABLE (same tool-stack scoping as round 1, ci.yml diff still empty); no governance-plugin/reference-port ADR implicated; SE ADR-0003 DI honored by git-hooks-install.ts; zero eslint-disable/ts-ignore in new/changed files.
7. [CLEAN][demonstrated] All quantitative receipt claims reproduced independently: typecheck/lint clean, npm test 822/822/0fail/0skip exact match, history-scan PASS 0 blocking (live 808 allowlisted vs receipt stale 663 -- Editorial, non-blocking), completeness-claim-checker PASS(2), recurring-findings-registry PASS(2), reference-resolver master..HEAD 30 failed exact match and independently confirmed NOT a regression (44 failed at pre-fix-now commit 86f053c, dropped to 30), ci.yml diff empty, ADR cache HIT fp unchanged, R6 untouched.
8. [CLEAN][demonstrated] .githooks/pre-commit tracked mode 100755 confirmed via git ls-files -s (the #187 fix genuinely landed).
9. [CLEAN][demonstrated] Both self-caught dogfood fixes (allowlist self-reference entries; QA-14 illustrative-path rewording) resolved cleanly, no new gap -- confirmed via live history-scan PASS and reference-resolver improved, not regressed, count.
counts (checksum): issues=0 suspicions=0 clean=9
evidence (checksum): demonstrated=6 code-traced=2 derived=1
checks=typecheck:pass lint:pass test:822/822/0fail/0skip history-scan:PASS(0-blocking,808-allowlisted) completeness-claim-checker:PASS(2) recurring-findings-registry:PASS(2) reference-resolver:30-failed(exact-match,down-from-44-pre-fixnow) ci.yml-diff:empty patterns.test.ts-diff:empty ADR-cache:HIT(fp-83b2e3e-unchanged) git-status:clean
adr=HIT(35, whole catalog)
report=docs/reviews/path-b-precommit-secret-scan-cross-domain-round2-2026-09-14.md
