# #409 (S7) git/rg exec-lever seal: app-security re-confirm, round 2 (Horus), 2026-10-05

[app-security-reviewer] CRITICAL tier. Delta `git -C C:/playground/thoth-wt409 diff 476545a cf4fce1`. ADR cache HIT (38); no security ADR violated. Round 1: docs/reviews/s409-app-security-2026-10-05.md.
Ran (wt409, read-only): `node --test src/qa/git-rg-lever-seal.test.ts` -> 135 pass / 0 fail / 0 skipped. `node src/qa/protected-path-list.ts` -> PASS, 59 paths, committed rules match generator. Probes ran in my own detached worktree at cf4fce1 (junctioned node_modules), removed after.

## Verdict: APPROVE-WITH-CONDITIONS (1 new MED, fix-now cheap; #440 and #441 confirmed fixed)

## Round-1 items

1. [CLEAN][demonstrated] #440 fixed. Shipped rules carry `protect-git-modules` (`.git/modules`, `.git/modules/`), config.worktree and worktrees; test S409-submodule-gitdir-protected-style `denyFor(shipped(), ".git/modules/adr/{config,hooks/post-checkout,info/attributes}")` = deny (test line 620). Preflight `scanGitDir` recurses `modules/*` (nested, depth-capped) and worktrees/*/config.worktree: planted `[core] fsmonitor` in `.git/modules/adr/config` reported as `core.fsmonitor` (session-writable, counted, exit 1).
2. [CLEAN][demonstrated] #441 fixed. Probe config with the six keys (core.alternateRefsCommand, tar.x.command, submodule.s.update=!cmd, browser.b.cmd, web.browser, gpg.ssh.defaultKeyCommand) plus credential.helper: all 7 reported; ordinary keys (user.name, core.autocrlf, core.bare, remote.url, branch.remote, push.default, color.ui) produced no finding. Default-deny suffix regex `(cmd|command|program|helper|editor|pager|askpass|browser)$` is a deliberate over-match, acceptable for a preflight.
3. [CLEAN][demonstrated] No secret values printed. Probe planted sentinel `SECRET*` in every value (git config, kubeconfig exec command/args/token, credential.helper, settings env, process env); JSON of all findings contained none (`LEAK? false`). Details are fixed text ("value not shown").
4. [CLEAN][demonstrated] UNC / non-regular skip works: `KUBECONFIG=\evil\share`, `RIPGREP_CONFIG_PATH=//evil/share/rg` produced no read, no unreadable finding (only the env-key AMBIENT lines); test S409-preflight-skips-unc-and-non-regular-paths green. `.githooks/` files are listed as NOTE by name (content not inspected, disclosed).
5. [CLEAN][code-traced] Manager rulings consistent: `worktreeExtraPaths` is not in the committed rules (drift check PASS) and emits `../thoth/.git/{config,config.worktree,hooks/,info/attributes,modules/,worktrees/}` for a linked worktree (#442 stays a K blocker); exit split `exitCodeFor` = 1 only for counted session-writable, ambient/NOTE 0.

## New finding

6. [ISSUE][MED][code-traced+demonstrated] Scope classifier labels the Windows managed-settings file AMBIENT, but it sits under the directory the Manager's own ruling measured session-writable. `git-rg-lever-preflight.ts:319-320` `defaultManagedSettings` = `%ProgramData%\ClaudeCode\managed-settings.json`, scanned in the `ambient` group (line ~367). `C:\ProgramData\ClaudeCode` does not exist on this machine and a standard-user session can create directories under `C:\ProgramData` (I created and removed `C:\ProgramData\zzprobe_hr`; same fact the ruling used for `%PROGRAMDATA%\Git`). Probe: `managed-settings.json` with `env.GIT_SSH_COMMAND` under `<ProgramData>\ClaudeCode` -> `ambient | GIT_SSH_COMMAND | settings (managed)`, `exit 0`. Attack: a session pre-creates that file, preflight prints AMBIENT and exits 0, so the git re-add precondition passes. Caveat: whether the current Claude Code release still honors the ProgramData location (newer builds may prefer Program Files) is unverified; that bounds impact, not the misclassification. The classifier cannot be steered otherwise: groups are fixed by call site, not by path or file content, and the `seen` set dedupes only toward the earlier session-writable group, so no session-writable source is demoted by an include from an ambient file.
   Exposure: 1 preflight run per activation, Windows only, basis counted in code.
   Minimal fix: on win32 classify `managed` as session-writable when it resolves under `%ProgramData%` (or when its dir is absent/creatable); keep POSIX `/etc` and `/Library` ambient. Failing test: `S409-windows-managed-settings-under-programdata-is-session-writable`.

## Blockers vs hardening
Blocker: none. Condition (fix-now, small): item 6.

## Single next action
Reclassify the Windows ProgramData managed-settings scan as session-writable and add the named test; #440/#441 can be closed after that round.

## Editorial
None.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] git-rg-lever-preflight.ts:319-320,367 Windows managed settings under %ProgramData%\ClaudeCode (creatable by Users) scanned as AMBIENT, exit 0; classify session-writable on win32
2. [CLEAN][demonstrated] #440 fixed: .git/modules, config.worktree, worktrees denied by shipped rules; preflight finds planted submodule core.fsmonitor
3. [CLEAN][demonstrated] #441 fixed: all six keys detected, ordinary keys (7 probed) not
4. [CLEAN][demonstrated] no secret values in FINDING/AMBIENT/NOTE output (sentinel probe)
5. [CLEAN][demonstrated] UNC and non-regular paths skipped; .githooks listed as NOTE
6. [CLEAN][code-traced] worktreeExtraPaths not committed (drift PASS), exit split correct
counts: issues=1 suspicions=0 clean=5
evidence: demonstrated=5 code-traced=1 derived=0
checks="135/0/0"
adr=HIT(38)
report=docs/reviews/s409-app-security-round2-2026-10-05.md
