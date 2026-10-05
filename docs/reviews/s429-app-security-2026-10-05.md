# S7 #429 + #424 + #446 app-security review (Horus) - 2026-10-05
[app-security-reviewer] Scope: worktree C:/playground/thoth-wt429, commits 69c0acb db3b19d d6adffc ea391d2 171fa4c. Lane: policy-delivery. ADR cache HIT (38); no applicable ADR security rule violated found.

## Ran
`node --test src/qa/tool-exec-judgment.test.ts src/qa/arbitrary-exec-classification.test.ts src/policy/config/activation-preconditions.test.ts` -> tests 52, pass 52, fail 0, skipped 0. Includes K-matcher-derived-from-judgments (+mutants), K-pending-equals-residual-judgments, K-md-matches-judgments, AP12-set-equals-exec-judgments, K-residual-condition-has-instrument. F1 prints 74 protected paths.
Probe (canonicalizePathTarget): `~/.BashRC`->`~/.bashrc`; `~/./.zshrc`->`~/.zshrc`; `~/.config/Fish/config.fish`->`~/.config/fish/config.fish`; `~/.claude/plugins/../settings.json`->`~/.claude/settings.json` (a dotdot cannot pop `~`, lands on a protected entry). Case and backslash folding are by design (path-canonical.ts); absolute/`$HOME`/`/c/Users` forms are the disclosed fail-closed-by-POL-05 class, unchanged.

## Answers to the lane questions
1. Generated deny/K Edit diff: correct. 7 new entries (#429) + 8 (#446) in protected-path-list.ts:243-270 appear in shipped-defaults.json and the K settings proposal (74 paths, pinned by F1 test). Directory entries emit `/**` globs, files exact. Matcher `Bash|Monitor|PowerShell|RemoteTrigger|mcp__.*` equals deriveMatcher(judgments) (test green); hand-written pending list equals the exec-residual set with conditions (test green).
2. `~/.claude/plugins/**` wholesale: affects only session-authored writes (Edit tool and gate-detected shell redirects). Plugin updates the human runs in a terminal, or via the harness's own /plugin machinery (not a Bash/Edit call), are not routed through these rules. Cost: a session cannot self-install or hot-patch a plugin, which is the intent. Acceptable.
3. Profile files / launcher: hooks/launch-gate.sh is a `sh` shim and does not source or write any profile; grep of hooks/ and src/ shows profile names only in protected-path-list.ts, git-rg-lever-preflight.ts (read of the PATH concern) and a test. The repo tracks only .claude/settings.json, so no tracked project skills/commands/agents are newly blocked. Nothing the gate or tests need is blocked.
4. Judgment file as a gate-widening lever: docs/qa/tool-exec-judgment.json is read only by tests and derivations (grep: no hook or shipped-defaults reader), so it widens nothing at runtime. It is NOT in the protected list; a session could edit it plus the paired proposal/AP-12 test coupling to shrink the derived matcher and still pass tests. The matcher is only live when the human installs K from the proposal, and the PR diff is the approval, so this is hardening only (finding 2).

## Findings (ranked)
1. [ISSUE][LOW][code-traced] protected-path-list.ts:260-269 - profile list misses sibling startup files that run in the same next-shell vector #446 closes: `~/.zlogin` (zsh login shell, runs after .zshrc), `~/.bash_aliases` (sourced by Debian/Ubuntu .bashrc; can shadow commands), and the Windows PowerShell profile (`~/Documents/PowerShell/` and `~/Documents/WindowsPowerShell/`), relevant because PowerShell is a routed tool on this Windows host. Exposure: not quantified, basis assumption -> capped LOW; settling measure: confirm which shells the human launches. Minimal fix: add the three entries (+ matching K proposal/shipped-defaults regeneration), or list them in the residual register.
2. [SUSPICION][LOW][derived] docs/qa/tool-exec-judgment.json (and the K proposal JSON/md) unprotected; consistent session edit could narrow the proposed matcher while tests stay green. Mitigation already present: K is human-installed from a reviewed PR. Optional: add the judgment file to namedPaths or note it in the residual register.
3. [CLEAN][code-traced] K proposal hand-written parts match derived values, pinned both directions with mutants.
4. [CLEAN][demonstrated] New canonicalized entries fold case/backslash/dotdot as intended (probe above).
5. [CLEAN][code-traced] `~/.claude/plugins/**` and project/user skills/commands/agents deny does not obstruct the launcher, tests, or tracked repo content.

## Blockers vs hardening
Blockers: none. Hardening: findings 1 and 2.
## Verdict: APPROVE-WITH-CONDITIONS
Condition (non-blocking, may be deferred): record finding 1's missing startup files as a residual-register line or add the entries; no Issue filed (LOW).
Next action: Manager ratifies; add finding 1 to the residual register.
Editorial: none.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][LOW][code-traced] protected-path-list.ts:260-269 - add ~/.zlogin, ~/.bash_aliases, PowerShell profile dirs, or register as residual
2. [SUSPICION][LOW][derived] tool-exec-judgment.json not protected; consistent edit could narrow proposed matcher (K is human-installed, hardening only)
3. [CLEAN][code-traced] K proposal hand-written parts pinned to derived matcher/residual list
4. [CLEAN][demonstrated] canonicalization of new ~ entries (case, backslash, dotdot) probed
5. [CLEAN][code-traced] plugins/skills/commands/profile protection does not block launcher or tests
counts: issues=1 suspicions=1 clean=3
evidence: demonstrated=1 code-traced=3 derived=1
checks="52/0/0"
adr=HIT(38)
report=docs/reviews/s429-app-security-2026-10-05.md
