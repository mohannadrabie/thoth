# #409 (S7) git/rg exec-lever seal: app-security review (Horus), 2026-10-05

[app-security-reviewer] CRITICAL tier. Diff: `git -C C:/playground/thoth-wt409 diff d5d974c s7/knockout-409`. ADR cache HIT (38); no security ADR violated by the diff.
Ran: `node --test src/qa/git-rg-lever-seal.test.ts` -> 125 pass / 0 fail / 0 skipped. Ran the preflight against this machine (7 findings, only key names printed). Probes in my own scratchpad, no edit to the worktree.

## Verdict: REWORK (small, fix-now: one protected-path addition, one parser list)

## Findings (ranked)

1. [ISSUE][HIGH][demonstrated] Submodule git dir is outside the seal and the preflight. `adr` is a submodule here (`.gitmodules`), so `adr/.git` points to `.git/modules/adr/`, and git run in `adr/` reads `.git/modules/adr/config`, `hooks/`, `info/attributes`. None is in `protected-path-list.ts:232-242` (exact or directory-prefix: `.git/config`, `.git/hooks/`, `.git/info/attributes` only), and `gitDirs()` in `git-rg-lever-preflight.ts` never visits modules. Same for .git/config.worktree and `.git/worktrees/*` (git-dir-local config that executes when `extensions.worktreeConfig` is on).
   Attack: a session writes `.git/modules/adr/config` (`core.fsmonitor=<cmd>`), then any git call in `adr/` runs it. Probe (scratch repo with a submodule, same layout): appended `[core] fsmonitor="echo PWNED > ../../../pwned.txt; true"` to `.git/modules/adr/config`, ran `git status` in the submodule; `pwned.txt` appeared containing `PWNED` (timestamp seconds old).
   Exposure: ~100% of git invocations inside `adr/` once git is re-added to the resolved set, basis counted in code (1 submodule in `.gitmodules`); dormant while git is off the set (gate unwired until K), irreversible (code exec), silent.
   Minimal fix: add `.git/modules/` (directory prefix covers config, hooks, info), .git/config.worktree, `.git/worktrees/` to `namedPaths`; make `runPreflight` scan `<gitdir>/modules/*/{config,hooks,info/attributes}`. Failing tests: `S409-submodule-gitdir-protected`, `S409-preflight-detects-planted-submodule-config`.

2. [ISSUE][MED][demonstrated] Preflight `executingKey` has false negatives, so a planted lever yields a clean PASS. Probed `parseGitConfig`; all returned `executing:false`: `core.alternateRefsCommand`, `tar.<fmt>.command`, `submodule.<n>.update = !cmd`, `browser.<t>.cmd`, `web.browser`, `gpg.ssh.defaultKeyCommand`. Correctly caught: continuation lines, BOM, mixed case, `[a.b]` header form, trailing-comment header, quoted values, alias `!`. `S409-precondition-preflight-clean` gates the git re-add, so a miss matters. The write seal is unaffected (config is protected); this is the pre-existing-config half (R3).
   Exposure: 1 preflight run per activation; 6 exec keys missed, basis counted by probe.
   Minimal fix: add those keys; better, default-deny any `*.cmd`, `*command`, `*.program`, `*.helper` key. Failing test: `S409-preflight-detects-less-common-exec-keys`.

3. [ISSUE][LOW][code-traced] `.githooks` acknowledgement is key+value only; the contents of `.githooks/` (the secret-scan pre-commit hook, a CLAUDE.md sensitive area) are never listed or checked, and `scanHooks` looks only at `.git/hooks`, which `core.hooksPath` bypasses. Pre-existing planted content there is the R3 gap, silently. Fix: emit a NOTE line per file in `.githooks/` (names only). No failing test planned (disclosure).

4. [ISSUE][LOW][code-traced] Preflight reads paths steered by data it checks: `RIPGREP_CONFIG_PATH`, `KUBECONFIG`, config `include.path`. A UNC path triggers an SMB auth attempt via `existsSync`/`readFileSync`; a FIFO would hang. Still read-only; the human runs it by hand. Fix: skip `\`-prefixed and non-regular files. No test planned.

## Verified sound

5. [CLEAN][demonstrated] No secret leakage: run output prints key names and fixed detail text (`value not shown`); settings env VALUES, kubeconfig contents and `credential.helper` values are matched by regex and never echoed; `unreadable` echoes the fs error (path), 120 chars; the only echo of file text is the `.gitattributes` line (repo content, max 100 chars).
6. [CLEAN][demonstrated] Read-only: only `existsSync/lstatSync/readdirSync/readFileSync/statSync` imported; AST test, byte-identical fixture test and mutant test pass; nothing spawned, so it cannot be steered into exec.
7. [CLEAN][code-traced] Generated deny rules: targets pass `canonicalizePathTarget` (lowercase, backslash to slash, trailing dot/space, `..`), so `.GIT\Config` and `.git/./config` forms match; dir forms listed with and without `/`; parent move/delete/rename rules for `.git`, `.git/info`, `.githooks`, `~/.config/git`. Absolute and drive forms stay with POL-05 (disclosed in `path-canonical.ts`). Settings env scanner fails closed on bad JSON, case-insensitive default-deny prefixes.
8. [CLEAN][demonstrated] `.githooks` acknowledgement matches `core.hookspath` plus exact `.githooks` in the repo's own config only; includes from it, user/system config, `config.worktree` and other values are findings (`S409-known-project-config-matches-key-and-value` green). `.githooks/` is protected including move/rename/delete of the directory.

## Blockers vs hardening
Blocker: 1. Hardening: 2 (cheap, same pass), 3, 4.

## Single next action
Add `.git/modules/`, .git/config.worktree, `.git/worktrees/` to the protected list, scan them in the preflight, extend `executingKey`; regenerate shipped-defaults.json and the K proposal; rerun.

## Editorial
None.

RECEIPT: verdict=REWORK
findings:
1. [ISSUE][HIGH][demonstrated] protected-path-list.ts:232-242 / preflight gitDirs: submodule git dir .git/modules/adr/{config,hooks,info/attributes} (and config.worktree, worktrees/) unprotected and unscanned; planted core.fsmonitor ran on git status in the submodule; protect .git/modules/ etc.
2. [ISSUE][MED][demonstrated] git-rg-lever-preflight.ts executingKey: alternateRefsCommand, tar.*.command, submodule.*.update=!, browser/web, gpg.ssh.defaultKeyCommand not detected (false PASS); add keys or default-deny *cmd/*command/*program/*helper
3. [ISSUE][LOW][code-traced] .githooks ack never lists or checks .githooks contents (secret-scan hook); emit NOTE per file
4. [ISSUE][LOW][code-traced] preflight reads env/config-steered paths (UNC SMB auth, FIFO hang); skip UNC and non-regular files
5. [CLEAN][demonstrated] no env values, kubeconfig tokens or credential.helper values printed
6. [CLEAN][demonstrated] preflight read-only, AST + byte-identical tests pass, nothing spawned
7. [CLEAN][code-traced] generated deny rules canonical (case/separator/dot forms, dir and parent-move rules)
8. [CLEAN][demonstrated] .githooks ack exact key+value, repo config only; .githooks/ protected
counts: issues=4 suspicions=0 clean=4
evidence: demonstrated=5 code-traced=3 derived=0
checks="125/0/0"
adr=HIT(38)
report=docs/reviews/s409-app-security-2026-10-05.md
