# Cross-Domain Review -- path-b-precommit-secret-scan -- 2026-09-14

Reviewer: cross-domain-reviewer (Ra)
Branch: feat/path-b-precommit-secret-scan vs master, HEAD 86f053c
Tier: CRITICAL (ratified, docs/run-log.jsonl 2026-09-14T17:06:26; docs/decisions.md 2026-09-14 row)
Other reviewers this round (per docs/decisions.md 2026-09-14 row): red-team (adversarial) + app-security-reviewer (authz/injection/deps) -- neither had persisted a report at the time of this pass. My job starts where their lanes stop: cross-domain ADR collisions outside their slice, seams between "new local dev-tooling" and this project's existing QA/CI instrument family, and documentation/claim accuracy.

## ADR cache

node docs/adr-cache.mjs --ensure returned: "ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- fp 83b2e3e [CACHE=HIT]". Whole catalog read unfiltered (both adr/devops and adr/software-engineering), per my standing mandate -- not a domain slice.

## Cross-domain ADR verdict

- devops ADR-0008 (CI/CD gates and policy-as-code), rule 2 ("MUST install and run the Gitleaks pre-commit hook") is the one ADR rule textually on-point for this diff (it is literally about a git pre-commit secret-scan hook, and this diff ships the project's first-ever pre-commit hook). Checked the code, not prior findings: .githooks/pre-commit + package.json's prepare script install a CUSTOM scanner (src/secret-scan/pre-commit-scan.ts, reusing OSS-01's SECRET_PATTERNS), not literal Gitleaks. Re-confirmed NOT-APPLICABLE, same scoped reasoning cross-domain-reviewer itself already independently established three times over (qa14-marker-redesign rounds 1/2/3, see docs/reviews/qa14-marker-redesign-cross-domain-round3-2026-09-11.md line 67 and siblings): the ADR's own Decision/Ownership text scopes this rule to a named IaC/supply-chain tool stack (Gitleaks/Semgrep/Trivy/Cosign/SBOM/cdk-nag/ZAP) that .github/workflows/ci.yml runs none of (grepped directly, no matches). This repo has no CDK/Terraform/infra surface at all (checked directly -- no cdk.json, no *.tf, no infra/ directory). Re-litigating this as a fresh violation on this diff would be noise, not a finding -- the precedent is directly on point and I re-checked the code myself rather than trusting the old reports' word for it.
- No other devops or software-engineering ADR is implicated: no IaC, no data/schema, no IAM, no network surface in this diff. SE ADR-0003 (inject I/O deps, don't reach for global mutable state) is honored by exec.ts's new env override (additive, per-call, never mutates process.env -- confirmed by the two new regression tests).

## Human ruling vs shipped code (staged-content-source)

docs/decisions.md's 2026-09-14 row rules: resolve each staged path's blob from the REAL INDEX (git ls-files -s), never via a literal git add / working-tree re-read. Read the code directly, not the doc's word for it: src/secret-scan/simulated-commit.ts lines 96-111 (resolveStagedBlob) call "git ls-files -s -z -- <path>" against the real repo root (not the temp index), and buildSimulatedCommit (lines 120-176) populates the simulated tree's temp index via "update-index --cacheinfo <mode> <sha> <path>" sourced from that real-index read -- "git add" never appears anywhere in this file. Matches the ruling exactly. CLEAN.

## Seam findings

### 1. [ISSUE][MED][demonstrated] docs/.maat-state.json never transitioned to this story's scope -- stale round-counters risk miscalibrating rule 16

Every prior story in this log gets a dedicated "chore(state): ratify tier for <scope>" commit at Phase-1-approval time, transitioning docs/.maat-state.json's top-level scope/tier/round-counters to the new story and nesting the old one under priorScope (confirmed via "git log -S" on the scope string -- commit 82b3bdd "chore(state): ratify CRITICAL tier for s1-closeout-164-154", and the same pattern for every earlier scope going back through the file's history). No such commit exists on this branch ("git log master..HEAD" shows only c94e20f "chore(run-log): log tier-ratified" -- docs/run-log.jsonl only -- and "git diff master..HEAD -- docs/.maat-state.json" is empty). The file's top-level scope field still reads "s1-closeout-164-154", and reviewRoundsTotal: 3, councilHeld: true are that OLD story's own already-elevated history, not a fresh 0/false baseline for path-b-precommit-secret-scan. CLAUDE.md states the tier "is then persisted once to docs/.maat-state.json, and /maat:review and /maat:verify reuse it rather than re-deriving." If Stage-3/4 mechanically increments these top-level counters rather than first reconciling them, a REWORK-class verdict this round could misfire PRINCIPLES rule 16(c)'s 3-consecutive-council trigger immediately (the counter is already sitting at 3), or a genuine 3rd-consecutive-REWORK on THIS story could be under-counted against the wrong baseline. docs/STATE.md itself (the human-facing file) IS correctly updated with this story's own resume point -- only the machine-readable state transition was skipped.

Exposure: ~100% of this one story's own Stage-3/4 round-counting (the single artifact affected), basis: measured (direct git log/git diff against every prior transition's own commit pattern).

Minimal fix: one commit, same shape as 82b3bdd/764ca04/etc -- nest the current top-level block under priorScope, set top-level scope to "path-b-precommit-secret-scan", tier "CRITICAL", reviewRoundsSinceClean 0, reviewRoundsTotal 0, councilHeld false, councilVerdict null, humanRulingRequired false, before this round's review verdicts are recorded.

### 2. [ISSUE][MED][derived] 3 of the 8 ratified acceptance criteria (R2, R3, R7) are never named anywhere in the shipped documentation

docs/decisions.md's 2026-09-14 row cites "intake-refiner's READY verdict with requirements R1-R8," and CHANGELOG.md/docs/STATE.md structure their close-out prose around R-numbers -- but only R1, R4, R5, R6, R8 are ever explicitly named (checked directly via grep across this story's own sections of CHANGELOG.md, docs/STATE.md, docs/decisions.md, docs/backlog.md). R2, R3, R7 appear nowhere. No persisted Phase-1 plan exists for this story (docs/plans/ has nothing newer than qa14-marker-redesign-phase1-2026-09-11.md), and no GitHub issue enumerates the full R1-R8 list either (checked via gh issue list --search, nothing relevant). The actual work is almost certainly complete -- the 4 "R1-R4 built" bullets plausibly cover R2/R3 unlabeled, and "23 new tests" plausibly IS R7 unlabeled -- but there is no artifact anywhere in this repo against which a reader can confirm that, for 3 of 8 ratified criteria, on a CRITICAL-tier sensitive-area change. This is a traceability gap, not a demonstrated functional defect -- capped at MED per the evidence policy (derived, no code read proves anything missing).

Minimal fix: name R2/R3/R7 explicitly in a follow-up docs/decisions.md comment or CHANGELOG.md note (append-only, doesn't require editing the existing entry), or -- better going forward -- resume this project's own earlier practice of persisting Phase-1 plans for CRITICAL-tier stories, which is exactly the artifact this gap is missing.

## Coverage / clean seams checked (no new finding)

- [CLEAN][demonstrated] .github/workflows/ci.yml untouched (R5): "git diff master...HEAD --stat -- .github/workflows/ci.yml" returned empty. The 3 Issue #136 patterns.test.ts allowlist entries untouched (R6): confirmed via git diff on docs/qa/secret-scan-allowlist.json, no patterns.test.ts lines in the diff. "Zero new dependencies": package.json devDependencies diff unchanged.
- [CLEAN][demonstrated] All quantitative claims reproduced live, not taken on faith: npm run typecheck / npm run lint clean; npm test -> 810 pass, 0 fail, 0 skipped (exact match to the claimed 785 carried + 25 new -- independently verified the 25 breaks down to 14 (simulated-commit.test.ts) + 9 (pre-commit-scan.test.ts) + 2 (exec.test.ts) by direct count); node src/qa/recurring-findings-registry.ts -> PASS, 2 classes; node src/qa/completeness-claim-checker.ts -> PASS, 2 files; ADR cache HIT, fingerprint 83b2e3e unchanged.
- [CLEAN][demonstrated] Issue #181's actual registry row (docs/qa/recurring-findings-registry.md's "a fix round's own committed artifacts red a gate that only reads committed state" row) correctly promoted from "pending lint" to the shipped Path B mechanism description (confirmed via git show on the relevant commit). Issue #181 itself was already closed pre-story (commit 04fe9ac, 2026-09-14T03:02, confirmed via gh issue view 181) for adding the "pending lint" placeholder -- that closure's own promotion-owed language is satisfied by this story's row update; no reopen was needed (nothing "recurred," the promotion was simply completed).
- [CLEAN][demonstrated] No collision with .githooks/core.hooksPath: no pre-existing .git/hooks/* custom hook, no husky/commitlint config anywhere in package.json that this switch would silently disable (checked directly -- only .sample files present, no husky/commitlint references). "git config core.hooksPath .githooks" is repo-local (no --global), scoped correctly.
- [CLEAN][code-traced] Pre-commit vs CI OSS-01 relationship: well-documented and non-confusing in both files' own header comments (pre-commit-scan.ts lines 1-20, simulated-commit.ts lines 1-26) -- simulated-commit-tree-only (fast, every commit) vs full-history (CI backstop), same allowlist file, zero new exemption-grant surface. This is exactly the "confusing duplication" question my brief named; it isn't one.
- [CLEAN][code-traced] Naming/discoverability: oss:pre-commit-scan follows the existing oss:secret-scan prefix convention in package.json; no qa:* misnaming.
- [CLEAN][demonstrated] No PR exists yet for this branch (checked via gh pr list, empty result) -- "PR skeleton's own claims" is not yet applicable; nothing to check, not a gap.

## Coverage gaps named

None beyond the two findings above. Everything else in the diff (git-plumbing correctness, injection/exec-argv safety, allowlist-entry precision) sits squarely inside red-team's and app-security-reviewer's named lanes and is intentionally not re-covered here.

## Verdict

APPROVE-WITH-CONDITIONS. The shipped mechanism itself is sound and matches every claim I could independently check (human ruling honored exactly; R5/R6/R8 honored; zero new deps; ci.yml untouched; test/instrument counts exact). Both findings are process/traceability gaps, not defects in the secret-scan mechanism, and neither blocks merging the code -- but both should be closed before this story is called done: reconcile docs/.maat-state.json's scope transition (finding 1) before Stage-3/4 round-counting proceeds, and name R2/R3/R7 explicitly (finding 2) so the acceptance-criteria claim is actually verifiable.

Single next action: commit the standard docs/.maat-state.json scope-transition (finding 1) before this round's review verdicts are recorded, so PRINCIPLES rule 16's round-counter starts this story at a true 0 baseline.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][demonstrated] docs/.maat-state.json (top-level scope/tier/round-counters) never transitioned to path-b's own scope (missing the standard "chore(state): ratify tier" commit every prior story got) -- stale reviewRoundsTotal=3/councilHeld=true from s1-closeout risk miscalibrating rule 16's council trigger. Fix: standard scope-transition commit before Stage-3/4 round-counting proceeds.
2. [ISSUE][MED][derived] R2/R3/R7 of the ratified R1-R8 acceptance criteria are never named in CHANGELOG.md/docs/STATE.md/docs/decisions.md/docs/backlog.md, and no persisted plan/Issue enumerates them -- no artifact to verify 3 of 8 criteria against. Fix: name R2/R3/R7 explicitly in a follow-up note, or resume persisting Phase-1 plans for CRITICAL-tier stories.
3. [CLEAN][code-traced] devops ADR-0008's Gitleaks-pre-commit-hook rule re-confirmed NOT-APPLICABLE (ADR's own tool-stack scoping, ci.yml runs none of them, no infra surface exists in this repo) -- re-checked the code myself, matches 3 prior independent cross-domain-reviewer confirmations, not re-raised as noise.
4. [CLEAN][code-traced] Human ruling on staged-content-source (docs/decisions.md 2026-09-14) matches simulated-commit.ts lines 96-176 exactly -- real-index blob read via git ls-files -s, no git add anywhere in the file.
5. [CLEAN][demonstrated] R5 (ci.yml untouched) and R6 (patterns.test.ts allowlist entries untouched) both confirmed via real git diff, not the claim alone.
6. [CLEAN][demonstrated] All quantitative CHANGELOG/STATE.md claims reproduced live: typecheck/lint clean, npm test 810/810 (785+25, exact per-file test counts 14+9+2 match), recurring-findings-registry PASS (2 classes), completeness-claim-checker PASS (2 files), ADR cache HIT fp 83b2e3e unchanged.
7. [CLEAN][demonstrated] Issue #181's actual registry row correctly promoted from "pending lint" to the shipped mechanism; Issue #181's own pre-story closure was for the placeholder row, not this promotion -- no reopen needed.
8. [CLEAN][demonstrated] No collision with .githooks/core.hooksPath install -- no pre-existing custom .git/hooks/* or husky/commitlint config silently disabled; repo-local git config only.
9. [CLEAN][code-traced] Pre-commit vs CI OSS-01 relationship is well-documented, non-confusing, complementary -- the "confusing duplication" question named in my brief is not an issue.
10. [CLEAN][code-traced] oss:pre-commit-scan naming matches the existing oss:secret-scan convention.
11. [CLEAN][demonstrated] No PR exists yet for this branch -- PR-skeleton-claims check not yet applicable, not a gap.
counts (checksum): issues=2 suspicions=0 clean=9
evidence (checksum): demonstrated=6 code-traced=4 derived=1
checks=typecheck:pass lint:pass test:810/810/0skip recurring-findings-registry:PASS(2) completeness-claim-checker:PASS(2) ci.yml-diff:empty devDeps-diff:empty gh-pr-list:empty
adr=HIT(35, whole catalog)
report=docs/reviews/path-b-precommit-secret-scan-cross-domain-2026-09-14.md
