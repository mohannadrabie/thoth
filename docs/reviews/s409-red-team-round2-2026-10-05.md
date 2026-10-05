# Red Team (Sutekh) -- #409 git/rg exec-lever seal, round 2 re-confirm (CRITICAL, S7)

- Date: 2026-10-05
- Scope: fix round on s7/knockout-409, delta 476545a..cf4fce1 (33c48e0 RED, 0bd635a fix, 675a143, 590bdf9, cf4fce1), worktree C:/playground/thoth-wt409 (read-only)
- Round 1: docs/reviews/s409-red-team-2026-10-05.md (no-go on #440 HIGH, #441 MED)
- ADR cache: HIT (38)
- Verdict: **no-go**

## Checks run

| Check | Result |
|---|---|
| `node --test src/qa/git-rg-lever-seal.test.ts` | tests 135, pass 135, fail 0, skipped 0, cancelled 0 (9.9 s) |
| Round-1 proof-tests | S409-protected-list-covers-submodule-git-dir PASS; S409-preflight-detects-submodule-levers PASS; S409-preflight-detects-exec-config-keys PASS |
| `node src/qa/protected-path-list.ts` (check mode) | PASS, 59 protected paths, committed rules and proposal match the generator, exit 0 |
| Shipped guard probe (`decide` over shipped-defaults.json, same method as the REDIRECT_FORMS test helper) | `.git/config` redirect: deny (protect-git-config); `.git/commondir` redirect: allow; `.git` (overwrite) redirect: allow |
| `missingEditDenies(K proposal, [".git/config", ".git/commondir"])` | `[".git/commondir"]` |
| Scratch repo probe (git 2.54.0.windows.1, inert `user.name` value only) | a `commondir` file in a main checkout `.git` moves `git config` and `--git-common-dir` to the named directory (`--show-origin` reports the redirected `config`) |
| icacls on the Git for Windows system gitconfig (Program Files) | SYSTEM/Administrators F, Users RX (admin-only) |
| icacls on C:/ProgramData | Users (CI)(WD,AD,WEA,WA): may create subdirectories |
| `claude --version` | 2.1.267 |

Scratch probes ran in the session scratchpad and were removed. No plant carried an executable value. thoth-wt409 working tree unchanged.

## Findings, ranked by exposure x irreversibility x silence

### 1. BREAKS -- [HIGH][demonstrated] Main checkout `.git/commondir` is unsealed and redirects the git config/hooks lookup; preflight ignores it
- Exposure: ~100% of main checkouts (any `.git` directory accepts a new `commondir` file; no deny target or K Edit entry names it), basis: counted in code + guard probe. Production runtime today: 0% (gate unwired, K held, git unresolved under POL-05). The live exposure is the deliverable "sealed up to the write boundary" claim and the re-add gate, the same framing as round-1 #440.
- Mechanism: git resolves the common dir from `GIT_DIR/commondir` in any git dir, not only linked worktrees. Repo config, hooks and `info/attributes` are then read from the common dir.
- Current defense:
  - shipped-defaults.json protects `.git/config`, `.git/config.worktree`, `.git/hooks/`, `.git/info/attributes`, `.git/modules/`, `.git/worktrees/` (write/create/...). `.git` itself only has move/delete/rename (protect-parent-git, exact target), so creating a child file under `.git/` is not matched.
  - Preflight `gitDirs` (src/qa/git-rg-lever-preflight.ts:270) returns `commonDir = .git` for a directory `.git` without reading `commondir`, so it scans the original config and reports clean.
- Silence: total. The guard allows the write, and the preflight scans the wrong directory.
- Fix direction (implementer call): protect `.git/commondir` (or deny write/create on the whole `.git/` prefix, since sessions cannot run git anyway). Have `gitDirs` honor, or flag, a `commondir` file in a main checkout.
- Proof-tests before merge:
  - S409-hook-denies-write-to-main-commondir: redirect form to `.git/commondir` denied by a protect rule, with an Edit(...) entry in the K proposal.
  - S409-preflight-flags-main-checkout-commondir: fixture main checkout with `.git/commondir` yields a counted finding, or a scan of the redirected dir.
- Issue: filing was **blocked by the session permission classifier** (excess sensitive detail for a public issue on an unpatched gap). Left to the human/Manager to file or track privately. Not refiled by another route.

### 2. BREAKS -- [MED][demonstrated] Linked worktree: the `.git` pointer file is overwritable, and worktreeExtraPaths does not list it
- Exposure: linked-worktree checkouts only. Counted: 3 linked worktrees exist now (thoth-wt409, -wt428, -wt429; CLAUDE.md prescribes worktrees). Basis: counted.
- Guard probe: overwrite redirect to `.git` -> allow (protect-parent-git covers move/delete/rename only).
- `worktreeExtraPaths` (src/qa/protected-path-list.ts, new) emits common-dir and gitdir targets but not the project-root `.git` pointer file. Even after K emits those targets per checkout (Manager ruling on #442), the pointer redirect stays open.
- Same redirect class as finding 1. Within the open #442 domain (K blocker).
- Proof-test: S409-worktree-targets-include-git-pointer (worktreeExtraPaths includes `.git` with write verbs in a linked checkout).
- Issue: #442 (existing). Comment not posted, for the same reason as finding 1. Manager to relay.

### 3. BREAKS -- [LOW][code-traced] executingKey suffix rule still misses path- and tunnel-style keys (residual of #441)
- The five round-1 keys are fixed (test PASS).
- `EXEC_KEY_SUFFIX` (git-rg-lever-preflight.ts:93) is a broader denylist, not the default-deny the comment at :92 claims. Keys documented by git as naming a program, but neither ending in a listed suffix nor in the switch, still return false:
  - mergetool/difftool tool `.path` (:116-118 only check `cmd`)
  - imap.tunnel
  - sendemail.smtpServer (absolute path form)
  - man tool `.path`
  - remote url transport-helper forms
- Detection-only. These live in write-sealed config (pre-planted, R3), except via finding 1.
- Exposure basis: assumption, so capped at LOW. Recommendation: measure.
- Proof-test: S409-preflight-detects-path-and-tunnel-keys.

### 4. BREAKS -- [LOW][code-traced] Submodule git dirs whose name contains a slash are not scanned
- `scanGitDir` (:245) lists one level under `modules/` and recurses only into `child/modules`.
- A submodule named `a/b` (the default when added at a nested path) keeps its git dir at `.git/modules/a/b/`, which is never scanned.
- Write seal unaffected (the `.git/modules/` prefix rule covers it).
- Exposure: 0 of 1 submodules in this repo (adr). Basis: counted.
- Proof-test: S409-preflight-scans-slash-named-submodule.

### 5. BREAKS -- [LOW][code-traced] tryRead UNC guard misses mixed-separator forms
- The guard at :77 tests only two prefixes: double forward slash and double backslash. A string that starts with a forward slash followed by a backslash passes the guard, yet `path.win32.resolve` maps it to a UNC path (string-level check run).
- `scanRgConfig`/`scanKubeconfig` receive raw env values without `resolve` (:352, :354). `scanGitConfig` resolves first, so it is unaffected.
- Source: the launching process env.
- Proof-test: S409-preflight-skips-mixed-separator-unc.

### 6. UNPROVEN -- [LOW][code-traced] Managed-settings path is stale (refines #447)
- `defaultManagedSettings` (:320) reads the ProgramData `ClaudeCode/managed-settings.json`.
- Vendor docs (code.claude.com settings and admin-setup pages): that Windows fallback was removed in Claude Code v2.1.75. The current path is under Program Files (`ClaudeCode/managed-settings.json`). This machine runs 2.1.267.
- Consequences:
  - A session-created ProgramData file (#447) is likely inert on current versions.
  - The real managed-settings file is never read or printed.
- UNPROVEN: whether any supported install still reads the ProgramData path.
- Settle: Manager checks the minimum supported Claude Code version against the v2.1.75 changelog.
- Test: S409-managed-settings-default-path-current.

### 7. UNPROVEN -- [LOW][code-traced] Process env is labelled AMBIENT although R1 shell profiles are session-writable
- `group("ambient")` (:361) covers process env.
- A lever key that reaches the preflight env through a session-edited shell profile (R1, ownership gap #446) prints AMBIENT and exits 0. In round 1 it counted (exit 1).
- Printed, not silent. The Manager ruling on #443 owns the exit split.
- Settle: the #446 owner decides whether the preflight should read profile files.
- Test: S409-preflight-env-from-profile-counted (or a residual-register line).

## Attacks that SURVIVE
- **#440 fixed (demonstrated).** Submodule `.git/modules/adr` config and hooks are protected and detected. Proof-tests pass.
- **#441 five keys fixed (demonstrated).** Proof-test passes.
- **Protected list covers the main checkout (demonstrated).** `.git/modules/` and `.git/worktrees/` are in the committed shipped-defaults targets and K Edit entries. Generator drift check PASS (59).
- **System gitconfig AMBIENT is correct (demonstrated).** The Program Files system gitconfig is admin-only by ACL. ProgramData Git is correctly classed session-writable.
- **Listed exec keys are covered (code-traced).** sshCommand, credential url helper, filter process, diff textconv, merge driver, core.fsmonitor, sequence.editor, gpg.program, uploadpack.packObjectsHook, core.hooksPath and include/includeIf.path are all covered by suffix or explicit switch.
- **Non-regular file skip and read-only (demonstrated).** The `statSync().isFile()` check skips FIFOs and directories. S409-preflight-skips-unc-and-non-regular-paths and S409-preflight-is-read-only both pass.
- **Env-derived rg/kube files are conservatively scoped (code-traced).** They are scanned in the session-writable group, so they are counted.

## Scariest unproven assumption + go/no-go
- Scariest: that protecting the named git files seals the git config lookup. Git decides *where* to look from pointer files (`.git/commondir`, the linked-worktree `.git` file). Those pointers are writable, and the preflight trusts them blindly or not at all.
- Verdict: **no-go** (finding 1, HIGH, demonstrated).
- Single next action: add `.git/commondir` (or the whole `.git/` write prefix) to the protected list with a failing-first redirect-deny test, and make `gitDirs` honor or flag `commondir` in a main checkout.

## Issue actions
- #440: comment posted, confirmed fixed.
- #441: comment posted, five keys fixed; same-class residual (finding 3, LOW) noted by reference.
- Findings 1 and 2: not filed or commented. The session permission classifier blocked public disclosure detail. For the human/Manager.

## Editorial
- git-rg-lever-preflight.ts:92 says "Default-deny by key shape". The rule is a suffix denylist with a default of false (:130).
- The session-writable comment in runPreflight renders ProgramData Git, BUILTIN Users and the ProgramData Git config path with their backslashes stripped.

RECEIPT: verdict=no-go
attacks (ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] main-checkout .git/commondir unprotected (guard allow, no K Edit) and redirects git config/hooks; preflight gitDirs ignores it -- BREAKS (Issue filing blocked by permission classifier; for Manager)
2. [ISSUE][MED][demonstrated] linked-worktree .git pointer file overwrite allowed; worktreeExtraPaths omits it -- BREAKS (#442 domain)
3. [ISSUE][LOW][code-traced] executingKey suffix denylist misses tool .path, imap.tunnel, sendemail.smtpServer, man tool .path, remote url helper forms -- detection-only residual of #441
4. [ISSUE][LOW][code-traced] slash-named submodule git dirs (.git/modules/a/b) not scanned; 0 in this repo
5. [ISSUE][LOW][code-traced] tryRead UNC guard misses mixed-separator prefix on raw rg/kube env paths
6. [SUSPICION][LOW][code-traced] managed-settings default path is the removed ProgramData fallback; real Program Files path never read (refines #447)
7. [SUSPICION][LOW][code-traced] process env AMBIENT/exit 0 though R1 shell profiles are session-writable (ties #446, #443 ruling)
8. [CLEAN][demonstrated] #440 fixed: submodule git dir protected and detected, proof-tests pass
9. [CLEAN][demonstrated] #441 five keys fixed, proof-test passes
10. [CLEAN][demonstrated] committed list covers .git/modules/ and .git/worktrees/, drift check PASS 59
11. [CLEAN][demonstrated] system gitconfig admin-only by ACL, AMBIENT classification correct
12. [CLEAN][code-traced] suffix+switch cover sshCommand, credential helper, filter process, textconv, merge driver, fsmonitor, sequence.editor, gpg.program, packObjectsHook, hooksPath, includeIf
13. [CLEAN][demonstrated] non-regular file skip and preflight read-only tests pass
14. [CLEAN][code-traced] env-derived rg/kube files scanned in session-writable (counted) group
counts: issues=5 suspicions=2 clean=7
evidence: demonstrated=7 code-traced=7 derived=0
checks=135 pass / 0 fail / 0 skip (src/qa/git-rg-lever-seal.test.ts); protected-path-list PASS exit 0; guard probe 3/3 as reported
adr=HIT(38)
report=docs/reviews/s409-red-team-round2-2026-10-05.md
