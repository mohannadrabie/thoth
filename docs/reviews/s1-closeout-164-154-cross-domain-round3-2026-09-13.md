# Cross-Domain Re-Confirm (round 3) -- s1-closeout-164-154 (Issues #164 + #154)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-13
**Branch:** fix/s1-closeout-164-154 @ c2408ba, base master @ ad196c5
**Diff scope:** git diff 713dbdd c2408ba (round-2 fix-now -> round-3 fix-now)
**Tier:** CRITICAL (unchanged). This is the round immediately before PRINCIPLES rule 16(c)'s mandatory-council trip-wire (2 consecutive REWORK-class rounds already recorded in docs/.maat-state.json).
**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- fp 83b2e3e [CACHE=HIT]. Unchanged from rounds 1/2. Read the WHOLE catalog, not a lane slice, per this role standing method.

## Who else is reviewing, and what ground they cover

Per docs/.maat-state.json (tier CRITICAL, scope s1-closeout-164-154): red-team + code-reviewer + cross-domain-reviewer, same as rounds 1-2. Both other lanes are dispatched separately this round; as of this pass, docs/reviews/ has no round-3 report from either. This report is this lane own first look at the round-3 diff, plus the standing whole-catalog ADR pass.

## What round 3 actually changed

src/lib/git.ts, src/lib/git.test.ts, src/qa/marker-corpus-probe.ts, src/qa/marker-corpus-probe.test.ts, src/qa/continuation-residual-probe.ts, src/qa/continuation-residual-probe.test.ts, plus CHANGELOG.md, docs/STATE.md, docs/decisions.md, docs/REVIEW_LOG.md, docs/.maat-state.json, and round-2 own 3 review reports.

## Cross-domain finding: round 3 broke the OSS-01 secret-scan dogfood gate

Demonstrated, this session, twice (full suite, then the isolated file alone):

    $ npm test 2>&1 | tail -6
    tests 785
    pass 784
    fail 1

    $ node --test src/secret-scan/history-scan.test.ts
    fail: OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass (61530ms)
      AssertionError: expected a clean pass, got: 1 secret-shaped match(es) found in history
      (356 allowlisted, not counted). Values redacted below.
      c2408bae3c06 src/qa/marker-corpus-probe.test.ts [email-address] an email address (possible personal data): test...[REDACTED 16 chars]
      ALLOWLISTED c2408bae3c06 CHANGELOG.md [internal-hostname] ...
      [... 356 more ALLOWLISTED lines ...]

Root cause, code-traced: round 3 own Issue #176 fix added a new withIsolatedGitRepo() helper to src/qa/marker-corpus-probe.test.ts (new in this round; confirmed absent at 713dbdd via git show 713dbdd:src/qa/marker-corpus-probe.test.ts | grep test@example -> no match). Line 29: await run("config", "user.email", "test@example.com") -- the identical literal test@example.com that src/secret-scan/history-scan.test.ts already needed its own allowlist entry for (docs/qa/secret-scan-allowlist.json, path src/secret-scan/history-scan.test.ts, patternId email-address). OSS-01 dogfood test (history-scan.test.ts:111) scans this repo full git history file CONTENT for secret-shaped strings, including source-code literals inside test files -- exactly the reason the pre-existing entry exists for the sibling file. The allowlist matches by exact (path, patternId) pair (confirmed via docs/qa/secret-scan-allowlist.json -- no entry for src/qa/marker-corpus-probe.test.ts of any patternId). The new file introduces the same literal at a different path, so it is a genuinely new, unallowlisted match -- not a flake, and not an artifact of the isolated mkdtemp fixture (the fixture own throwaway repo is rm-ed in a finally and never enters this repo real git history; the match is against the actual committed .test.ts source, which legitimately contains the string as code).

Why this matters: this round own commit message, CHANGELOG.md, and docs/STATE.md all claim 785/785 pass, 0 fail, 0 skipped for round 3 verification. That claim is false as of this diff -- the real, current number is 784/785, with the 1 failure being a genuine, deterministic, 100%-reproducible OSS-01 gate break, not a transient flake (reproduced twice independently, full suite and isolated file, same match both times). This is precisely the pattern this round own dispatch instructions asked to rule out: does this diff introduce a new problem the size of what rounds 1 and 2 each introduced -- yes. Round 1 introduced a flaky test (#170) while fixing #164; round 2 introduced a worse flaky test (#176) while fixing round 1 findings; round 3, fixing round 2 findings, introduces a deterministic CI-gate break while adding the mkdtemp isolation round 2 was asked for.

ADR angle (this role own lens, not a lane the other two reviewers are dispatched to cover this round): devops ADR-0008 (CI/CD gates and policy-as-code, applicableTo cdk/pipeline/quality/security/supply-chain) Rules for agents include: MUST NOT merge a PR with any blocking gate open, failing, or pending. OSS-01 dogfood test is exactly this kind of blocking gate (it asserts result.ok is true, a hard failure, not a warning). Neither red-team nor code-reviewer is a devops/pipeline-lane reviewer on this CRITICAL-tier dispatch (both are app-side this round); this is the seam this role exists to catch -- a QA-tooling test-fixture change (owned by the code/red-team lane) collided with the secret-scan allowlist (a different, cross-cutting mechanism) and nobody lane was watching that specific intersection.

Exposure: 100 percent of npm test / CI runs on this branch from this commit forward, measured directly (2 of 2 repro attempts, deterministic content match, not concurrency-dependent). Basis: measured.

Minimal fix: add one entry to docs/qa/secret-scan-allowlist.json, mirroring the existing src/secret-scan/history-scan.test.ts entry exactly in shape (path src/qa/marker-corpus-probe.test.ts, patternId email-address, reason: a fixed reserved-test-domain address used only to configure a throwaway temp git repository committer identity for the duration of one test, withIsolatedGitRepo; not a real person address). No code behavior changes needed; the fixture use of test@example.com is itself fine (same reserved-domain convention this project already uses twice), it is only the allowlist that is one entry short of covering it.

Severity: HIGH. Blocks the Definition of Done (tests green in CI with real counts) and collides with devops ADR-0008 explicit MUST-NOT-merge-with-a-failing-gate rule. Backed by demonstrated evidence (ran it, quoted raw output) -- this forces a non-clean verdict per the Evidence Policy.

## Seam-hunting: the widened export surface (readFileTexts, collectFullTreeFileTexts)

Checked against the whole 35-ADR catalog, not a lane slice. Both functions moved from module-private to export in marker-corpus-probe.ts and continuation-residual-probe.ts solely to let their own .test.ts call them in-process (Issue #176 fix). Neither file is under any named sensitive area (hooks, scripts/guard, src/policy/guard, hooks/audit-log.mjs, the secret-scan mechanism itself, .thoth/halt-state), neither is part of the kernel purity boundary ADR-0021 governs (that boundary is src/kernel|gates|policy-rooted; these are src/qa QA instruments), and SE ADR-0002 layer rule does not apply (no presentation/infrastructure/domain layering exists for a standalone CLI probe script). SE ADR-0003 (SOLID) has no rule against a function being exported for testability; ADR-0001 propose-a-new-ADR-for-a-significant-decision bar is not met here -- this is a routine testability seam, not an architectural decision. No ADR collision.

Worth naming, not gating: readFileTexts is now duplicated verbatim (same signature, same body, same doc comment) in both probe files rather than hoisted to a shared module. This is a DRY smell, not a defect -- SE ADR-0003 SHOULD-NOT-over-abstract / YAGNI clause cuts the other way here (a shared 15-line helper for exactly 2 call sites is a judgment call, not a violation), and CLAUDE.md own gold-plating rule argues against expanding this round diff to hoist it. Derived, capped at LOW, not a blocking finding -- a plausible follow-up, not a defect.

## Issue Discipline re-check (this round own closures)

Verified live via gh issue view / gh api, not taken from any prior claim:
- #170, #171, #172, #173, #176, #177, #178: all CLOSED, stateReason COMPLETED, all Milestone S1, closedAt timestamps 2026-09-14T01:51:55Z through 01:52:50Z -- all AFTER commit c2408ba own authored timestamp (2026-09-13T21:51:17-04:00, i.e. 2026-09-14T01:51:17Z), so commit-before-close ordering is correct this round (the recurring #174-class process defect from rounds 1 and 2 did NOT recur).
- #179: OPEN, correctly left open, body plus comment accurately disclose it as a deliberate deferral (checked gh issue view 179 with body and comments directly) -- names the specific gap, the risk-budget rationale, and what a future fix must look like.
- No duplicate Issues found for any of #170/#171/#172/#173/#176/#177/#178/#179 (gh issue list search on each finding distinguishing text).
- GitHub Milestone #19 (S1 -- Protect the baseline): still open, 8 closed / 5 open issues (#154, #164, #174, #175, #179) -- description unchanged from round 2 correction, still honestly discloses the QA-14 residual, still accurate (round 3 did not touch anything the description own claims depend on).

All CLEAN except the new Issue this report itself files (#180, below).

## Coverage gaps named

None new. Documentation-only edits in this round (CHANGELOG.md, docs/STATE.md, docs/decisions.md, docs/REVIEW_LOG.md) are prose describing already-covered code changes, not a separate uncovered surface -- consistent with round 1/2 own treatment.

## Verdict

REWORK. One HIGH, demonstrated, reproducible finding: round 3 own Issue #176 fix introduced a new, unallowlisted secret-scan match (src/qa/marker-corpus-probe.test.ts test@example.com literal) that deterministically fails the OSS-01 dogfood gate -- 784/785, not the 785/785 this round own commit message/CHANGELOG/STATE.md claim. This is exactly the new-problem-the-size-of-rounds-1-and-2 pattern this round dispatch asked to rule out, and the answer is yes. Minimal fix is a single allowlist entry (shown above), mirroring an exact existing precedent in this same file -- not a design change, not a re-litigation of #176 own real fix (which is otherwise sound: mkdtemp isolation, in-process assertion, repoRoot resolution bug fixed correctly, mutation-proving tests for #177 verified by direct revert-and-confirm-red, #178 EISDIR fix correct at the source). Everything else checked this round -- the widened export surface, Issue Discipline, Milestone #19 -- is clean.

Filed as GitHub Issue #180 (bug, severity:high, qa, Milestone S1) this same turn, duplicate-checked first (none found).

## Single next action

Add the one allowlist entry above to docs/qa/secret-scan-allowlist.json, re-run npm test to confirm 785/785 for real, then re-dispatch this lane (and red-team/code-reviewer, who have not yet produced round-3 reports as of this pass) for a final re-confirm before Stage 4/5.

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] src/qa/marker-corpus-probe.test.ts:29 (new test@example.com literal, Issue #176 own mkdtemp fixture) has no matching entry in docs/qa/secret-scan-allowlist.json -- deterministically fails OSS-01 dogfood gate (784/785, not the 785/785 claimed in this round commit/CHANGELOG/STATE.md), colliding with devops ADR-0008 MUST-NOT-merge-with-a-failing-gate rule; minimal fix is one allowlist entry mirroring the existing src/secret-scan/history-scan.test.ts precedent. Filed as Issue #180.
2. [CLEAN][code-traced] Widened export surface (readFileTexts, collectFullTreeFileTexts in both probe files) -- no ADR collision against the whole 35-ADR catalog; neither file is kernel-purity-governed (ADR-0021) or a named sensitive area.
3. [SUSPICION][LOW][derived] readFileTexts is now duplicated verbatim across the two probe files rather than hoisted to a shared module -- a DRY smell, not a defect; not gating, plausible backlog item only.
4. [CLEAN][demonstrated] Issue Discipline on this round own closures -- #170/#171/#172/#173/#176/#177/#178 all closed COMPLETED strictly AFTER commit c2408ba own timestamp (no #174-class recurrence this round); #179 correctly left open with accurate disclosure; no duplicate Issues found.
5. [CLEAN][demonstrated] GitHub Milestone #19 interaction -- still open, 8 closed/5 open, description unchanged and still accurate; round 3 introduced nothing that stales it.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=1 clean=3
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=3 code-traced=1 derived=1
checks=npm-test:784/785-pass-1-fail(reproduced-2x:full-suite-plus-isolated-history-scan.test.ts-run) typecheck:clean lint:clean gh-issue-checks:170/171/172/173/176/177/178/179/180-all-confirmed-correct-state milestone19:open-8closed-5open-description-unchanged
adr=HIT(35, whole catalog)
report=docs/reviews/s1-closeout-164-154-cross-domain-round3-2026-09-13.md
