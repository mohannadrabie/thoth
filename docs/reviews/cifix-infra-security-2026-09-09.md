# cifix -- Infra Security Review (Wadjet)

**Date:** 2026-09-09
**Reviewer:** infra-security-reviewer (Wadjet)
**Scope:** cifix -- CRITICAL tier, infra-only. This session's diff to .github/workflows/ci.yml (+ docs/backlog.md, CHANGELOG.md). Named sensitive-area reviewer per CLAUDE.md ("Secret scanning / CI gates -- .github/workflows/ci.yml").
**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e)

## Context read

- docs/decisions.md 2026-09-09 rows: human ruled Option (a) -- provision ADR_REPO_PAT (fine-grained PAT, Contents:Read-only, mohannadrabie/adr-repo-only, 90-day expiry) as a repo secret, used only via git config --global url.insteadOf; thoth's own checkout keeps default GITHUB_TOKEN unwidened.
- Applicable ADRs (security/IAM/secrets domain): devops ADR-0008 (CI/CD gates and policy-as-code) and ADR-0009 (least-privilege IAM and secrets in IaC). Both are written in AWS CDK/IAM terms (Secrets Manager, IAM access keys, assumed-role trust) with no literal GitHub-Actions-secrets analog. No rule from either ADR is violated by this diff -- their literal text doesn't reach a GitHub PAT/repo-secret scenario. Their spirit (secrets vaulted and referenced, never inlined; least-privilege scope; a rotation story) is satisfied: the PAT lives in GitHub's encrypted secrets store, is scoped to one permission on one private repo, and has a disclosed 90-day expiry + manual rotation note in docs/backlog.md. Naming a stronger alternative (short-lived GitHub App installation token, analogous to ADR-0009's "prefer roles/assumed-role over static keys") as a non-blocking hardening idea, not a violation, since ADR-0009's literal scope is AWS IAM only.
- GitHub Issue #27's own comment history: two PRIOR attempts at this same problem (August, a different story) used an SSH deploy key wired via actions/checkout's ssh-key: input, and both failed on live CI -- traced by a prior security-reviewer to actions/checkout@v7.0.1's url-helper.ts/git-source-provider.ts, where ssh-key scopes to the primary checkout remote, not just the submodule. That attempt was fully reverted (deploy key + secret deleted) in favor of skipping the submodule fetch in CI entirely. This diff's mechanism (manual git config --global url.insteadOf HTTPS rewrite, never touching actions/checkout's ssh-key input) is materially different and does not repeat that specific failure mode -- confirmed by tracing the actual rewrite logic below.

## Diff traced

.github/workflows/ci.yml: Checkout step's submodules: recursive removed (kept fetch-depth: 0); two new steps added -- "Configure credential for private adr submodule" (git config --global url."https://x-access-token:${{ secrets.ADR_REPO_PAT }}@github.com/mohannadrabie/adr".insteadOf "https://github.com/mohannadrabie/adr") and "Init adr submodule" (git submodule update --init --recursive + git submodule status), both running before "Set up Node.js"/npm ci. Top-level permissions: contents: read and the pinned actions/checkout/actions/setup-node SHAs are unchanged.

## Findings (ranked by exploitability x impact)

### 1. [ISSUE][MED][code-traced] -- ADR_REPO_PAT persists in ~/.gitconfig cleartext through the rest of the job, including npm ci

**Evidence:** ci.yml's "Configure credential" step runs git config --global url."https://x-access-token:${{ secrets.ADR_REPO_PAT }}@github.com/mohannadrabie/adr".insteadOf ... (writes the PAT, embedded in a URL, into $HOME/.gitconfig) and this step runs before "Set up Node.js" -> "Install dependencies" (npm ci) -> every subsequent step in the same job. git config --global is not scoped to the step or unset afterward, so the credential sits on disk, in cleartext, for the remainder of the job -- reachable by any process that job runs, including npm lifecycle scripts. Measured: package-lock.json currently lists 111 package entries, 0 of which carry hasInstallScript: true (checked via a script reading the lockfile's own metadata) -- so live exploitability today is 0%. But nothing in this design prevents it from re-arming silently the moment any current or future dependency (direct or transitive) adds a postinstall/preinstall script -- there is no --ignore-scripts, no config-clear step, and no CI check that would catch the reintroduction.

**Attack sketch:** a compromised or malicious transitive npm dependency's postinstall script reads $HOME/.gitconfig during npm ci and exfiltrates the embedded PAT to an external host. Unlike actions/checkout's own persist-credentials behavior (which does something structurally similar for the default GITHUB_TOKEN, industry-standard and low-marginal-risk because that token only grants what an in-job script already has by just reading the checkout), this credential is a different, cross-repo secret -- leaking it grants access to mohannadrabie/adr, a private repo an in-job malicious script otherwise has zero path to.

### 2. [ISSUE][LOW][derived] -- insteadOf prefix is a substring match, not an exact-URL match

**Evidence:** the configured insteadOf value is "https://github.com/mohannadrabie/adr" (no trailing .git), while .gitmodules's real URL is https://github.com/mohannadrabie/adr.git (confirmed by reading .gitmodules). Git's insteadOf does a literal prefix-substring match, so this correctly rewrites the real submodule URL (the ".git" suffix is preserved after the substituted prefix) -- traced and confirmed functionally correct. But the same prefix would also match any other URL sharing those exact characters (e.g. a hypothetical mohannadrabie/adr2 or mohannadrabie/adrenaline repo), attaching the PAT to fetches of that URL too, not just the intended one. No such sibling repo is known to exist and no other step in this job fetches from github.com/mohannadrabie/*, so real exploitability is ~0%, reasoned rather than run.

**Minimal fix (hardening, non-blocking):** match .gitmodules's literal URL exactly -- url."https://x-access-token:...@github.com/mohannadrabie/adr.git".insteadOf "https://github.com/mohannadrabie/adr.git" -- to remove the prefix-collision class structurally. LOW severity per policy (derived, no per-project rule requires filing a LOW issue).

## Clean / verified-sound (worth naming)

- **[CLEAN][code-traced]** Workflow triggers: on: push (branches: master), pull_request (branches: master), schedule only -- no pull_request_target, no workflow_dispatch. Both mohannadrabie/thoth and mohannadrabie/adr confirmed PRIVATE via gh repo view --json visibility. No untrusted-fork path can reach secrets.ADR_REPO_PAT.
- **[CLEAN][code-traced]** Top-level permissions: contents: read unchanged by this diff; the Checkout step's own default GITHUB_TOKEN is never widened -- the new credential is fully separate (confirmed: the step's with: block only drops submodules: recursive, no permissions/token changes).
- **[CLEAN][code-traced]** secrets.ADR_REPO_PAT is used via GitHub's standard direct-embed pattern inside a run: shell string -- the safe pattern for secrets (distinct from the unsafe pattern of interpolating untrusted github.event.* context into a shell string). GitHub's automatic log-masking covers the literal secret value wherever it recurs in this job's log output.
- **[CLEAN][code-traced/demonstrated]** The insteadOf rewrite correctly resolves against .gitmodules's real URL via git's documented prefix-substitution semantics (traced manually against the literal strings) -- this avoids the exact SSH/HTTPS mismatch defect that broke both prior deploy-key attempts recorded in Issue #27's history.
- **[CLEAN][code-traced]** Credential scope as specified in docs/decisions.md + docs/backlog.md (fine-grained PAT, Contents:Read-only, single-repo mohannadrabie/adr only, 90-day expiry) matches least-privilege intent; a rotation story is disclosed -- docs/backlog.md's new entry names the exact manual rotation command (gh secret set ADR_REPO_PAT --repo mohannadrabie/thoth) and the trigger (before the 90-day expiry, or CI silently breaks again).
- **[CLEAN][demonstrated]** ci.yml parses as valid YAML: ran js-yaml load against the file, got top-level keys: [ 'name', 'on', 'permissions', 'jobs' ], jobs: [ 'ci', 'runtime-settings-drift' ] -- confirms CHANGELOG's claim independently rather than trusting it.
- **[CLEAN][derived]** Deploy-key-vs-PAT tradeoff (asked for explicitly in this review's brief): this repo's own Issue #27 history shows a deploy key wired via actions/checkout's ssh-key: input already failed twice here for a documented, traced reason (that input isn't submodule-scoped). This diff's HTTPS-PAT-via-git-config mechanism sidesteps that specific defect by construction (it never touches ssh-key:). Worth a one-line pointer from this story's CHANGELOG/decision entry to Issue #27's comment thread so a future reader doesn't have to rediscover why a deploy key wasn't the chosen path -- a documentation-completeness note, not a defect (not filed as an issue; non-blocking).

## Editorial

None found -- CHANGELOG's verification-status claims (npm test counts, YAML validity) were spot-checked and matched what I independently ran.

## Verdict

**APPROVE-WITH-CONDITIONS.**

CI has been fully dead since 2026-09-01 (10/10 runs), meaning lint/typecheck/tests and every QA/OSS instrument -- including the OSS-01 secret scan itself -- have run zero times in real CI for over a week. This diff correctly restores that, following an explicit human ruling on the security posture, and does not repeat this repo's own previously-documented deploy-key failure mode. Leaving CI dead longer to pre-emptively fix a currently-dormant (0%-measured), trivially-fixable MED finding would be a worse net security outcome than shipping this restore now.

**Condition:** land finding 1's minimal fix (the git-config-clear step) in this same change or as an immediate fast-follow before ADR_REPO_PAT's first live use in a merged run -- it is a one-line addition with no functional downside. Finding 2 is a non-blocking hardening note (backlog-eligible).

## Next action

story-implementer adds the credential-clearing step (finding 1) to ci.yml immediately after "Init adr submodule", then the human provisions ADR_REPO_PAT per the already-ruled spec (fine-grained, Contents:Read-only, mohannadrabie/adr only, 90-day expiry) and confirms one live green ci job run.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by exploitability x impact):
1. [ISSUE][MED][code-traced] ci.yml new "Configure credential" step writes ADR_REPO_PAT into ~/.gitconfig before npm ci runs, exposed to any in-job process (0/111 lockfile packages currently carry an install script -- measured, dormant today); fix: add a git-config-unset step right after "Init adr submodule", before Node setup. Filed: Issue #125.
2. [ISSUE][LOW][derived] insteadOf prefix "https://github.com/mohannadrabie/adr" (no trailing .git) is a substring match that would also catch a hypothetical sibling-named repo; fix: match .gitmodules's literal .git-suffixed URL exactly. Not filed (LOW, per project convention).
3. [CLEAN][code-traced] Triggers are push/pull_request(branches:master)/schedule only, no pull_request_target/workflow_dispatch; both thoth and adr repos confirmed PRIVATE via gh repo view -- no fork path to the secret.
4. [CLEAN][code-traced] Top-level permissions: contents: read unchanged; default GITHUB_TOKEN never widened by this diff.
5. [CLEAN][code-traced] secrets.ADR_REPO_PAT used via the standard safe direct-embed pattern in a run: string, not the unsafe untrusted-context-interpolation pattern; GitHub log-masking covers it.
6. [CLEAN][code-traced/demonstrated] insteadOf rewrite correctly resolves .gitmodules's real https://github.com/mohannadrabie/adr.git URL via prefix substitution, traced by hand; avoids the exact SSH/HTTPS mismatch that broke two prior deploy-key attempts (Issue #27 history).
7. [CLEAN][code-traced] Credential scope (fine-grained PAT, Contents:Read-only, single-repo, 90-day expiry) matches least-privilege intent per docs/decisions.md; rotation story disclosed with exact command in docs/backlog.md.
8. [CLEAN][demonstrated] ci.yml parses as valid YAML (ran js-yaml load myself, matches CHANGELOG's claim) -- top-level keys/jobs as expected.
9. [CLEAN][derived] Deploy-key alternative correctly avoided repeating this repo's own two prior documented ssh-key/actions-checkout failures (Issue #27 history); worth a doc cross-link, non-blocking.
counts: issues=2 suspicions=0 clean=7
evidence: demonstrated=2 code-traced=6 derived=3 (note: items 6 and 9 carry mixed tags -- code-traced is each one's primary/gating tag, derived reflects the Issue #27 historical-context portion; item 2 is fully derived)
checks="2/0/0|n/a (2 demonstrated checks run: js-yaml parse of ci.yml, package-lock.json install-script census; no application test suite run -- out of this review's infra-config scope)"
adr=HIT(35)
report=docs/reviews/cifix-infra-security-2026-09-09.md
