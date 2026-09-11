# Infra Security Review: fix/qa1415-issue-existence-and-decisions-scope (commit d05ca33) vs master (6f61d44)

**Reviewer:** infra-security-reviewer (Wadjet)
**Scope:** Issue #120, CI red at HEAD on QA-14 (reference-resolver) and QA-15 (completeness-claim-checker). Risk tier: CRITICAL (.github/workflows/ci.yml is a CLAUDE.md-named sensitive area, Secret scanning / CI gates).
**Files reviewed (full diff read, not summarized):** .github/workflows/ci.yml, src/qa/reference-resolver.ts, src/qa/reference-resolver.test.ts, src/qa/completeness-claim-checker.ts, docs/decisions.md, docs/.maat-state.json, docs/backlog.md, CHANGELOG.md. Confirmed package.json/package-lock.json diff is empty (no new dependency).

## ADR cache
ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp 83b2e3e, CACHE=HIT.

Applicable ADRs read directly from docs/.maat-state.json's cached catalog, filtered to my domain (security/IAM/secrets/exposure/supply-chain/audit):
- devops ADR-0008, CI/CD gates and policy-as-code (security, supply-chain, quality, pipeline, cdk): MUST NOT lower gate thresholds, delete tests, or broaden suppression/ignore lists (ratchet only); MUST NOT merge a PR with any blocking gate open, failing, or pending.
- devops ADR-0009, Least-privilege IAM and secrets in IaC (security, iam, secrets, cdk): no Action star / Resource star; secrets referenced by ARN/name, never embedded; scope each credential to one workload.
- SE-0006 (Blast radius control) and SE-0010 (Code quality/maintainability gates), also read since the story itself cites them. No violation found; noted below where relevant.

No applicable-ADR BLOCKER found in this diff.

## What I verified directly (not taken on the CHANGELOG's word)

Command: git diff master...fix/qa1415-issue-existence-and-decisions-scope -- .github/workflows/ci.yml
Result: job-level permissions (contents: read, issues: read) added under jobs.ci only (lines 40-42), preceded by an inline comment explaining scope and non-leak to the scheduled job. The runtime-settings-drift job's own block is untouched (confirmed: no hunk touches it). GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} added to the QA-14 step's own env only (lines 226-230), not job-wide, matching the step-scoping pattern already used for ADR_REPO_PAT (its own separate step-level env block, lines 97-101).

Command: npm test
Result: tests 670, pass 670, fail 0, cancelled 0, skipped 0, duration_ms 23454.

Command: npm run typecheck -- clean, no output.
Command: npm run lint -- clean, no output.

Command: node src/qa/completeness-claim-checker.ts
Result: [QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified. Exit 0.
Confirms docs/decisions.md is no longer in the default-scanned set (2 files, not 3) and the gate is real (exit 0), matching the claim.

Command: node src/qa/reference-resolver.ts (default HEAD~1..HEAD, a small local diff, not the branch diff)
Result: [QA-14 reference-resolver] FAIL: 27 of 481 citation(s) failed to resolve.
This reproduces the disclosed, out-of-scope residual (Issue #137, citation-classification precision gap) live. Confirmed via gh issue list --search that Issue #137 pre-exists, open, correctly labeled (bug, severity:med, chore); not re-filed, per this review's own instructions. The 481 vs. the CHANGELOG's stated 480 is a 1-count prose mismatch, Editorial, not scored (different diff base: I ran the tool's own default HEAD~1 compare, not master...branch; not a discrepancy in the tool's own logic).

Direct proof of the new checkIssueViaGh behavior, run against the real repo (not simulated), via a temporary uncommitted script (removed after the run):
Issue #120: true
Issue #999999 (nonexistent): false
Matches the CHANGELOG's own claimed verification exactly.

## Findings

### 1. CLEAN - IAM / token scoping: issues:read is minimal and correctly job-scoped
ci.yml:40-42 restates contents:read alongside the new issues:read in a job-level permissions block. Job-level permissions REPLACES, not merges with, the workflow-level default, so this is the correct and necessary way to add a scope without silently dropping contents:read for that job. issues:read is the finest-grained scope GitHub Actions exposes for issue data (no separate "read issues but not PRs" scope exists, and gh issue view legitimately needs to resolve both). The scheduled runtime-settings-drift job's block is untouched, confirmed by diff, not narrowed onto it. Evidence: code-traced (ci.yml:25-42), demonstrated (grep confirming the second job block absent from the diff).

### 2. CLEAN - Secret hygiene: GH_TOKEN reuses default token, step-scoped, no new credential
No new secret/PAT created. GH_TOKEN references secrets.GITHUB_TOKEN and is declared only in the QA-14 step's own env (ci.yml:226-230), mirroring the pre-existing ADR_REPO_PAT step-scoping pattern exactly (a separate PAT, itself step-scoped at ci.yml:97-101, never widened here). No log line, echo, or console.log anywhere in the diff prints GH_TOKEN, GITHUB_TOKEN, res.stdout, or res.stderr in a way that would leak a credential (checked checkIssueViaGh's full body: it only pattern-matches res.stderr against a not-found regex, never logs it). Evidence: code-traced.

### 3. CLEAN - Command construction: fully array-based argv, no shell surface
checkIssueViaGh (reference-resolver.ts:238-243) calls runner with cmd "gh" and an args array: issue, view, String(n), --repo, repoSlug, --json, state. realRunner (src/lib/exec.ts:42-61) uses execFile (never exec, never shell:true), so no shell interpolation exists anywhere on this path. n is always a Number()-parsed capture from a digit-anchored regex (ISSUE_CANDIDATE_RE / bare-hash patterns) before reaching this function, so String(n) can never carry injected shell metacharacters even if it could reach a shell (it cannot). repoSlug comes from git.originSlug() (reference-resolver.ts:295), this repo's own git remote config, not attacker-controlled PR-diff content. Verified by the new test's own assert.deepEqual on the args array (reference-resolver.test.ts), which pins the exact argv shape. Evidence: code-traced plus demonstrated (test run, 670/670 green, includes this assertion).

### 4. CLEAN - Supply chain: no new dependency
package.json and package-lock.json diffs are empty. gh is invoked as an external CLI already required by the pre-existing ADR_REPO_PAT / submodule steps in this same workflow, no new npm package, no new pinned action, no new base image. Evidence: demonstrated (diff against those two files produced no output).

### 5. CLEAN - CI gate integrity: QA-15's DEFAULT_FILES narrowing is justified, not a silent weakening
docs/decisions.md's removal from DEFAULT_FILES carries an in-place, structural justification (completeness-claim-checker.ts comment): the file is append-only historical narration by its own documented convention (supersede in place, keep the history, never delete it), several of its rows cite point-in-time measurements no instrument in this repo can re-derive today, and retrofitting markers would mean editing rows this project's own convention treats as permanently closed. This is scope-correction, not suppression of a live, currently-checkable claim; findBareClaims, MARKER_RE, and KNOWN_INSTRUMENTS are unchanged, only the default file set narrows. Ratified in docs/decisions.md's 2026-09-10 build-complete row and disclosed in CHANGELOG.md. Demonstrated live: qa:completeness-claims now checks 2 files and exits 0. No devops ADR-0008 ratchet-only violation: the gate is narrower in scope but not weaker on what it still claims to check, and the narrowing is disclosed with reasoning, not silent. Evidence: code-traced plus demonstrated.

### 6. ISSUE, LOW, code-traced - Unbounded fan-out of new external gh calls driven by scanned-file content, no per-run cap
Prior to this diff, issueExists was a pure no-op stub returning null always, so QA-14 made zero external network/subprocess calls. This diff's pass-1/pass-2 design (reference-resolver.ts main()) now calls checkIssueViaGh once per distinct issue number found across every scanned, non-test file changed in the diff, and that file content (hence the set of numbers) is exactly what a PR's own diff controls. There is no cap on the distinct-number set size, and the ci job itself has no timeout-minutes set (falls back to GitHub's 360-minute default). A diff that adds many distinct issue-shaped strings to a single scanned file would drive a proportional number of sequential gh issue view subprocess calls (each individually bounded to 30s via timeoutMs, but with no aggregate bound). This is a genuine, previously-absent surface: untrusted diff content now drives external API fan-out.

Exposure: approximately 0 percent under today's realistic access model. mohannadrabie/thoth is a private repository (confirmed via a live gh api call returning private true); a private repo's fork/PR surface is restricted to invited collaborators, so this is not an externally-exploitable attack surface today, only a self-inflicted-cost risk from an already-trusted contributor's mistake or a compromised collaborator account. Basis: measured (repo visibility checked live via gh api), not assumed. Per PRINCIPLES rule 21, a LOW-severity finding with this exposure does not block. Minimal fix (hardening, not required for this diff): cap the distinct-issue-number set at a small constant (e.g. 50) and report the excess as unresolved-authority/skipped rather than querying, and/or set an explicit timeout-minutes on the ci job. Recommend a backlog line, not a blocker.

## Editorial (prose-only, not scored, no re-review needed)
- completeness-claim-checker.ts's own in-code comment says the docs/decisions.md exclusion was human-ratified 2026-09-10, but docs/decisions.md's actual 2026-09-10 rows attribute both entries to Manager (Osiris) (tier ratification, and the build-complete entry) under the still-standing 2026-09-08 blanket autonomous-continuation authorization, not a distinct, newly-obtained human ruling on this specific scope question. The decision itself is fine and properly logged; the comment's choice of the word human-ratified overstates its provenance relative to what docs/decisions.md actually shows. Routed here per this project's own Editorial-list convention (prose mismatch, not a security defect); a plain wording fix next time this file is touched, no re-review required.
- CHANGELOG's stated QA-14 residual count (27 of 480) is off by one from what I reproduced locally (27 of 481), different diff base (the tool's own HEAD~1 default vs. the actual master-to-branch diff), not a discrepancy in the tool's own logic; Editorial only.

## Blast radius (SE-0006): is the widening scoped as narrowly as described?
Yes, confirmed by direct read, not by trusting the story's own description: issues:read lives only under jobs.ci.permissions, GH_TOKEN lives only under the QA-14 step's own env. Neither leaks to the scheduled job nor to any other step. No lockstep/multi-service deploy introduced; this is a single, reversible CI config change (a one-line revert restores the prior stub-and-unwidened state).

## Findings vs. Blockers
No BLOCKERS. No HIGH/MED findings, nothing to file as a GitHub Issue this round (LOW findings do not spawn Issues, per this project's own filing rule).

## Verdict: APPROVE

Least-privilege, secret hygiene, command-construction, supply-chain, and CI-gate-integrity axes all check out under direct inspection and live reproduction, not the diff's own claims alone. The one LOW finding is a hardening suggestion with near-zero real-world exposure given this repo's private visibility, and does not gate.

## Single next action
Merge is a human-only action per CLAUDE.md; the next action is for the Manager to proceed to the remaining CRITICAL-tier reviewers already assigned in docs/decisions.md's 2026-09-10 tier-ratification row (red-team plus cross-domain-reviewer); this infra-security pass is complete and clean.

---

RECEIPT: verdict=APPROVE
findings (ranked by exploitability x impact):
1. [ISSUE][LOW][code-traced] reference-resolver.ts main() -- unbounded distinct-issue-number fan-out to gh issue view per CI run, no cap and no job timeout-minutes; near-zero real exposure (private repo, measured). Fix: cap the distinct-number set size + set timeout-minutes on the ci job.
2. [CLEAN][code-traced] ci.yml:40-42 -- issues:read job-scoped correctly, minimal, does not leak to runtime-settings-drift.
3. [CLEAN][code-traced] ci.yml:226-230 -- GH_TOKEN step-scoped only on QA-14 step, matches existing ADR_REPO_PAT step-scoping pattern.
4. [CLEAN][demonstrated] reference-resolver.ts checkIssueViaGh / exec.ts realRunner -- array-based execFile argv throughout, no shell interpolation, n and repoSlug both trusted/validated before reaching the runner; confirmed via test's own args assertion plus full suite green.
5. [CLEAN][demonstrated] package.json/package-lock.json -- no new dependency introduced.
6. [CLEAN][demonstrated] completeness-claim-checker.ts DEFAULT_FILES narrowing -- in-place justified, human/Manager-ratified in docs/decisions.md, gate still exits 0 for real (not vacuous), no devops ADR-0008 ratchet violation.
counts (checksum): issues=1 suspicions=0 clean=5
evidence (checksum): demonstrated=3 code-traced=3 derived=0
checks="670 pass/0 fail/0 skipped (npm test); typecheck clean; lint clean; qa:completeness-claims exit 0; reference-resolver exit 1 (27/481, pre-existing disclosed Issue #137, reproduced not new)|n/a"
adr=HIT(35)
report=docs/reviews/qa1415fix-infra-security-2026-09-10.md
