# #409 (S7) git/rg exec-lever seal: cross-domain review (Ra)

Date 2026-10-05. Tier CRITICAL. Diff `d5d974c..s7/knockout-409` (worktree C:/playground/thoth-wt409, head 476545a). Parallel lanes: red-team, app-security-reviewer (its report: docs/reviews/s409-app-security-2026-10-05.md, Issues #440, #441). ADR cache: ADR cache HIT, reused 38 ADRs [adr/devops:12, adr/software-engineering:23, docs/adr:3] [CACHE=HIT]; whole catalog read, unfiltered.

## Lanes and ground covered
- app-security: deny-rule forms, preflight read-only, secret leakage, submodule git dir (#440), missed exec keys (#441). Not re-listed here.
- red-team: adversarial bypass of the seal. Not re-listed.
- Mine: the seams (protected list x worktree workflow, protected list x the repo own hook tooling, preflight x dev machine, #428 merge, ADR-0003, docs).

## Cross-domain ADR verdict (whole catalog)
- THOTH-ADR-0003 (accepted): the diff regenerates shipped-defaults.json and the K proposal through the generator; the fixture path stays on the list (qa:protected-path-list PASS, 56 paths; fixture rule and mutant untouched). No collision. The diff edits generator code, not a fixture entry, so it needs a fresh dated report; the lane reports plus this one satisfy that.
- THOTH-ADR-0001/0002: not touched. The other 35 ADRs (devops IaC, SE app): no changed file in their scope (no IaC, schema, API, network). No ADR UNCLEAR, no collision.

## Seam findings

### 1. [MED][demonstrated] The .git/... protection is project-root-relative, so it does not exist in a linked worktree (the workflow this repo mandates)
Domains in tension: protected-path list (policy) x branch-discipline/worktree workflow (this session runs in C:/playground/thoth-wt409, whose .git is a FILE: gitdir: C:/playground/thoth/.git/worktrees/thoth-wt409). git reads config and hooks from the COMMON dir (C:/playground/thoth/.git, outside the worktree root) plus config.worktree.
Evidence (my detached worktree, shipped-defaults at 476545a, record {source:shell, verbs:[write], targets:[canonicalizePathTarget(p)], unresolved:[]} through decide):
```
.git/config                           deny  protect-git-config
~/.gitconfig                          deny  protect-home-gitconfig
.git/config.worktree                  allow
.git/worktrees/x/config.worktree      allow
../thoth/.git/config                  allow
C:/playground/thoth/.git/config       allow   (common-dir config of every linked worktree)
C:/playground/thoth-wt409/.git/config allow
.git/info/exclude, .git/info/sparse-checkout  allow
```
From a linked-worktree session the files git actually reads (common/config, common/hooks/, common/info/attributes, config.worktree) are unprotected for any write form that resolves, and the K Edit(/.git/config) entries (project-rooted) match nothing. The preflight reads the common dir (src/qa/git-rg-lever-preflight.ts:222-230,288-289), so the READ side is worktree-aware and the WRITE side is not. The CHANGELOG claim "levers sealed up to the session write boundary" and the comment in protected-path-list.ts ("config is sealed") are false for this layout. Extends #440 (submodule dir) to the worktree common dir and config.worktree.
Exposure: ~100% of sessions run from a linked worktree (3 of 4 entries in git worktree list are S7 story worktrees), basis: counted. Inert today (K held, git/rg unresolved, a writer must also resolve), hence MED; but #409 is the seal meant to make the later re-add safe.
Minimal fix: derive extra protected targets from the real git dir (resolve the .git file, commondir) at generation/preflight time, add config.worktree, .git/worktrees/, .git/modules/ (with #440), or have the re-add story declare linked worktrees unsupported. Failing test: S409-linked-worktree-common-dir-config-protected.

### 2. [MED][demonstrated] The preflight cannot be green on a standard Git-for-Windows dev machine and has no acknowledgement path for ambient state, so "run the preflight green" (K activation, story G, git/rg re-add) is unsatisfiable or will be waved
Evidence: node src/qa/git-rg-lever-preflight.ts on this machine (rc=1):
```
NOTE    core.hookspath | C:\playground\thoth\.git\config | known project config
FINDING diff.astextplain.textconv | C:\Program Files\Git\etc\gitconfig
FINDING filter.lfs.clean / .smudge / .process | same file
FINDING credential.helper | same file
FINDING GIT_EDITOR | process env     (GIT_EDITOR=true is set in this very session; the harness sets it)
FINDING kubeconfig exec | C:\Users\<user>\.kube\config
7 finding(s)
```
Five are Git-for-Windows installer defaults (LFS, Git Credential Manager), one is set by the Claude Code harness in every session, one is any EKS/GKE kubeconfig. KNOWN_PROJECT_CONFIG acknowledges only repo-scope core.hooksPath=.githooks; S409-precondition-preflight-clean tests repo/project/local scope only, so the test is green while the command is red. Nothing in CI or package.json runs the preflight: the precondition is prose. Outcome: K/G blocked indefinitely, or a perpetually red check that people learn to ignore, with a real planted core.fsmonitor one more line in a 7-line red list.
Exposure: ~100% of runs on this and any Git-for-Windows machine (7 of 7 findings environmental, 0 repo-planted), basis: measured.
Minimal fix: split exit status by session-writable scope vs ambient (system, process, kube), or a human-ratified exact key+value acknowledgement list for system scope; ignore the harness own GIT_EDITOR. Manager/human decision needed before story G consumes the precondition. Failing test: S409-preflight-ambient-ack-or-split-exit (exit 0 on a fixture with only the Git-for-Windows default system config, exit 1 on a planted repo core.fsmonitor).

### Checked, sound
3. [CLEAN][code-traced] .githooks/ and .git/hooks/ vs src/lib/git-hooks-install.ts, npm run prepare, CI: the install writes .git/config through a git config child of npm, run by the human or CI outside the PreToolUse gate; the gate judges only the visible command targets and npm/git are unresolved (POL-05) anyway. No break. Only new session-visible cost: editing .githooks/pre-commit (the secret-scan hook, a named sensitive area) needs a human edit once K is wired; consistent with CLAUDE.md, acceptable. The .githooks addition was ratified.
4. [CLEAN][code-traced] Manager-loop git ops (git branch, fetch, worktree add, submodule update write .git/config, .git/worktrees/*, .git/modules/*): under K every git call is already denied by POL-05, so #409 adds no new denial. Forward constraint for the re-add story: once git resolves, those verbs really write those files and the path rules fire only if the normalizer models their targets; decide per verb.
5. [CLEAN][demonstrated] #428 merge seam: git merge --no-commit s7/knockout-428 into 409 in my scratch worktree auto-merged shipped-defaults.json and the K proposal, no conflict; qa:protected-path-list on the merged tree: PASS, 58 protected paths, committed rules and proposal match the generator; seal test + src/policy/config/*.test.ts + bare-binary-trust.test.ts merged: tests 595 pass 595 fail 0 skipped 0. Whichever merges second should re-run the generator check (generator-owned file).
6. [CLEAN][demonstrated] 409 alone: seal test tests 125 pass 125 fail 0 skipped 0; qa:git-env-snapshot PASS (153 tokens); qa:protected-path-list PASS.
7. [CLEAN][code-traced] K proposal regeneration: 8 new Edit(...) entries match generator output (drift check); they inherit finding 1 (project-rooted).

## Coverage gaps
- No lane claims whether the protected path exists in this repo real layout (worktree, submodule) beyond the #440 submodule half: finding 1.
- CHANGELOG/docs accuracy: the "config is sealed" wording overstates (finding 1). No STATE.md or decisions row in the diff (Manager handoff, not a gap).
- The git-env snapshot is generated from the installed git docs (version-bound) and is not run in CI; low risk, fine.

## Editorial
- CHANGELOG and the protected-path-list.ts comment: say project-root .git/config only until finding 1 is fixed.

## Verdict
APPROVE-WITH-CONDITIONS. Both findings are inert while K is held and git/rg stay unresolved; they bound what #409 may claim at closure and must be fixed or carried as residuals before git/rg re-add or story G.
Single next action: Manager rules on finding 2 (ambient acknowledgement vs split exit code) and folds finding 1 into the #440 fix.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] protected-path-list.ts:229-242 + preflight: .git/config/hooks/info protections are root-relative; in a linked worktree the common-dir config and config.worktree write as allow (probe); fix: derive git/common dir targets, add config.worktree/worktrees/modules; test S409-linked-worktree-common-dir-config-protected
2. [ISSUE][MED][demonstrated] git-rg-lever-preflight.ts: rc=1 with 7 environmental findings (Git for Windows system config, harness GIT_EDITOR, ~/.kube/config), no ack path outside repo scope, so the green-preflight precondition is unsatisfiable or waved; fix: split exit by session-writable vs ambient or ratified ack list; test S409-preflight-ambient-ack-or-split-exit
3. [CLEAN][code-traced] .githooks/.git/hooks vs git-hooks-install/prepare/CI: writes happen outside the gate, no break
4. [CLEAN][code-traced] Manager-loop git ops already denied by POL-05 under K; forward constraint for re-add story noted
5. [CLEAN][demonstrated] #428 merge: auto-merge clean, generator PASS 58 paths, 595/0/0
6. [CLEAN][demonstrated] 409 alone: 125/0/0, snapshot and protected-path generators PASS
7. [CLEAN][code-traced] K proposal regeneration matches generator (inherits finding 1)
counts: issues=2 suspicions=0 clean=5
evidence: demonstrated=4 code-traced=3 derived=0
checks=seal test 125 pass/0 fail/0 skip; merged 595 pass/0 fail/0 skip; qa:protected-path-list PASS x2; qa:git-env-snapshot PASS; preflight rc=1 (7 findings)
adr=HIT(38, whole catalog)
report=docs/reviews/s409-cross-domain-2026-10-05.md
