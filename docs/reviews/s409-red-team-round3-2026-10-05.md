# Red Team (Sutekh) -- #409 git/rg exec-lever seal, round 3 re-confirm (CRITICAL, S7)

- Date: 2026-10-05
- Scope: fix round 2 on s7/knockout-409, delta cf4fce1..8de1f22 (9e04fbc RED, 8de1f22 fix), worktree C:/playground/thoth-wt409 (read-only)
- Round 2: docs/reviews/s409-red-team-round2-2026-10-05.md (no-go: HIGH main-checkout commondir, MED pointer file, LOWs, #447 suspicion)
- ADR cache: HIT (38)
- Verdict: go (round-2 blockers fixed; one new MED detection-gap filed, does not gate)

## Checks run

| Check | Result |
|---|---|
| node --test src/qa/git-rg-lever-seal.test.ts | tests 144, pass 144, fail 0, skipped 0 (13.0 s) |
| node src/qa/protected-path-list.ts (check mode) | PASS, 54 protected paths, rules and proposal match the generator, exit 0 |
| node src/qa/protected-path-list.ts --print-worktree-targets | ../thoth/.git/ and .git |
| Preflight fixture probe (protocol.ext.allow + .gitmodules ext url) | findings=[], exit 0 (DEMONSTRATED gap) |
| Claude Code permissions/permission-modes vendor docs | protected paths, Windows normalization, Edit-on-Write, symlinks |

Guard probe (runtime = raw normalize; res = unresolved forced empty, isolates the deny-rule match):
- echo/cat/ls/grep redirect to .git/commondir: runtime deny (POL-05); deny-rule protect-git.
- .git/objects/info/alternates, .git/packed-refs, .git/hooks/post-checkout, .git/info/exclude: deny, rule protect-git.
- echo redirect to .git (pointer file): deny, rule protect-git; .git is in targets [".git", ".git/"].
- tee/cp/mv forms to .git: non-resolvable binary, POL-05 deny (unresolved), no clean target emitted.
- Case .GIT/CommonDir, trailing-dot .git./commondir, ./.git//commondir, a/../.git/commondir, quoted and split-quote .git forms: all deny protect-git (canonicalizer folds them to .git/commondir).
- 8.3 GIT~1/commondir, absolute C:/.../.git/commondir, /c/..., ../thoth/.git/commondir: runtime deny by POL-05 (binary or path unresolved); the deny RULE does not match (canonicalizer does not fold 8.3 / absolute / drive forms -- disclosed #416).

Scratch probes ran in the session scratchpad and were removed. thoth-wt409 working tree unchanged. thoth-wt428/wt429 not touched.

## Round-2 findings, re-confirmed

1. HIGH main-checkout .git/commondir -- FIXED (demonstrated). The whole git dir is one directory entry .git/ (rule protect-git, verbs write/create/modify/delete/move/rename) plus exact .git. A new file such as commondir under .git/ is denied in every resolvable write form. gitDirs now reads a commondir in a MAIN checkout and FLAGS it, then scans the redirected dir (S409-preflight-flags-main-checkout-commondir PASS). Exposure now 0%.
2. MED linked-worktree .git pointer file -- FIXED (demonstrated). .git write denied by protect-git; worktreeExtraPaths emits .git and the whole common dir ../<main>/.git/ (S409-worktree-targets-include-git-pointer PASS).
3. LOW path/tunnel keys -- FIXED (demonstrated). difftool/mergetool/man .path, imap.tunnel, absolute sendemail.smtpServer detected; a hostname smtpServer is not (S409-preflight-detects-path-and-tunnel-keys PASS).
4. LOW slash-named submodule -- FIXED (demonstrated). moduleGitDirs descends a namespace dir (no HEAD/config/hooks); .git/modules/a/b is scanned (S409-preflight-scans-slash-named-submodule PASS).
5. LOW mixed-separator UNC -- FIXED (demonstrated). isUncPath covers every two-separator mix (S409-preflight-skips-mixed-separator-unc PASS).
6. SUSPICION managed-settings path (#447) -- ADDRESSED (demonstrated). Current default is Program Files (ambient); the legacy ProgramData managed-settings.json is scanned session-writable and counted (S409-windows-managed-settings-under-programdata-is-session-writable PASS). Comment posted on #447 (not closed).

## New findings, ranked by exposure x irreversibility x silence

### 1. BREAKS -- [MED][demonstrated] Preflight (the re-add gate) does not detect protocol.ext.allow or a transport-helper URL in .gitmodules
- Mechanism: an ext-style URL in .gitmodules runs a command through git's ext transport when protocol.ext.allow=always is set; git executes it on a routine submodule/recursive operation (CI runs git submodule update --init adr). Arbitrary-command lever.
- Demonstrated: a fixture repo with [protocol "ext"] allow = always in .git/config AND .gitmodules url = ext::... yields runPreflight() -> findings=[], exit 0. The gate the deliverable relies on passes green.
- Current defense (honestly assessed): executingKey keys on program-naming suffixes/sections; protocol.ext.allow names no program, so it is missed. .gitmodules is never opened by the preflight (only .git/config, hooks, attributes, submodule git dirs). .gitmodules is NOT on the project protected list or the K proposal; it relies on Claude Code's vendor built-in protected-files list (mode-dependent). .git/config IS write-sealed now, so protocol.ext.allow can only arrive as pre-existing config -- the class residual R3 claims this command detects.
- Why not HIGH: multi-condition (non-default allow=always + poisoned .gitmodules), git is unresolved in-session so a session cannot trigger it, trigger is an external git invocation. Detection-only; not a live write bypass today.
- Exposure: ~0% of runs today (git unresolved; gate unwired). Live exposure is the re-add gate's completeness and residual R3's detects-it claim. basis: counted in code.
- Proof-test before the git/rg re-add merge: S409-preflight-detects-protocol-ext-allow-and-gitmodules-transport -- a fixture with protocol.ext.allow and a .gitmodules transport-helper URL yields a counted finding and exit 1.
- Issue: new, filed (MED, S7). Distinct lever class from #441 (program-naming keys).

### 2. UNPROVEN -- [LOW][code-traced] 8.3 short name under-matches the kernel .git/ rule (disclosed #416, elevated blast radius)
- canonicalizePathTarget does not fold NTFS 8.3 short names (header disclosure). GIT~1/commondir does not match protect-git. On this volume 8.3 generation is on.
- No live shell bypass: every shell redirect write form to an 8.3 target is unresolved -> POL-05 denies (demonstrated). The only resolvable binaries are read-only and a redirect decorates them into an unresolved record.
- New in round 2 only in blast radius: collapsing to .git/ means the single disclosed 8.3 residual now nominally spans the whole git dir (incl. the commondir redirect). Still under-match, not bypass; fail-closed direction.
- Route: existing #416 disclosure; note the elevated radius for the K wiring story.

### 3. UNPROVEN -- [LOW][code-traced] A nested repo .git in a subdirectory is neither kernel-sealed nor preflight-scanned
- Kernel protect-git target .git/ matches by exact/prefix (rule-types.ts), so subdir/.git/config (not prefixed by .git/) is not matched. The K proposal Edit(/.git/**) anchors at the project root. The preflight scans only the root repo git dir.
- Gated today: git is unresolved (nested config executes only if git runs in that subdir); Claude Code vendor built-in .git protected path is a mode-dependent write-side backstop.
- Same future-gate class as finding 1 -- route to the git/rg re-add threat model, not this seal.

### 4. UNPROVEN -- [LOW][derived] K proposal Edit(/.git/**) is lowercase; Windows normalization in Claude Code may preserve case
- Vendor doc example normalizes C:\Users\alice -> /c/Users/alice (case preserved). gitignore matching on Windows is typically case-insensitive (core.ignorecase), but not proven for Claude Code's Edit-rule matcher.
- If case-sensitive, Edit(/.git/**) could under-match a .GIT or 8.3 Edit-tool request. Backstops: kernel protect-git lowercases and catches .GIT on the shell path; Claude Code built-in .git protected path.
- Cannot run the vendor matcher here. Settle in the K wiring story: a live Edit-tool probe of .GIT/x and GIT~1/x against the shipped proposal. Owner: K implementer.

## Attacks that SURVIVE
- .git/ collapse does not over-block (code-traced). protect-git verbs exclude read; no legitimate session write targets .git (git unresolved, hooks install to .githooks, halt-state to .thoth).
- objects/info/alternates write-sealed (demonstrated), and not an RCE vector -- alternates redirects the object store, it does not run code.
- Edit proposal carries .git/ and .git (demonstrated). editDenyEntries emits both Edit(/.git/**) and Edit(/.git); missingEditDenies and the drift check (54) pass.
- Non-resolvable write forms denied (demonstrated). echo/tee/cp/mv to any .git target -> POL-05; readonly-binary + redirect -> unresolved (F8).
- Case / separator / trailing-dot / dotdot / quote-split forms denied (demonstrated). The canonicalizer folds them to .git/commondir and protect-git matches.
- Managed-settings legacy ProgramData scanned session-writable; current path ambient (demonstrated).
- 144/144 seal tests pass; generator drift PASS (demonstrated).

## Scariest unproven assumption + go/no-go
- Scariest: that the preflight is a complete re-add gate. It is not -- it does not see protocol.ext.allow or a .gitmodules transport-helper URL (finding 1, demonstrated). That gap is in a FUTURE gate (git/rg re-add), not in the seal this story ships; the seal (write protection of the whole git dir and the pointer file) holds under every form tested.
- Verdict: go. The round-2 no-go causes are fixed and demonstrated. The new finding is a MED detection-gap, git-unresolved-gated and detection-only, filed against the re-add story.
- Single next action: file the MED and add S409-preflight-detects-protocol-ext-allow-and-gitmodules-transport to the git/rg re-add required-green set.

## Issue actions
- #447: comment posted, confirmed addressed (not closed -- owner decides).
- New MED Issue filed (S7): preflight misses protocol.ext.allow + .gitmodules transport URL.
- Findings 2-4: residuals/UNPROVEN, routed to #416 and the K wiring story; no new Issue (LOW).

## Editorial
- git-rg-lever-preflight.ts executingKey remains a suffix/section denylist, not the default-deny its surrounding comment implies (carried from round 2; the round-2 delta added keys but kept the denylist shape).

RECEIPT: verdict=go
attacks (ranked by blast radius; [ISSUE]=BREAKS / [SUSPICION]=UNPROVEN / [CLEAN]=SURVIVES):
1. [ISSUE][MED][demonstrated] preflight (re-add gate) misses protocol.ext.allow + .gitmodules ext transport URL -> RCE lever passes green (findings=[], exit 0); git-unresolved-gated, detection-only -- BREAKS (new Issue, S7)
2. [SUSPICION][LOW][code-traced] 8.3 short name GIT~1/ under-matches kernel .git/ rule; POL-05 denies shell forms at runtime (no live bypass); blast radius now whole git dir -- disclosed #416
3. [SUSPICION][LOW][code-traced] nested-repo subdir/.git neither kernel-sealed (prefix anchored at root) nor preflight-scanned; git-unresolved + vendor built-in gate it
4. [SUSPICION][LOW][derived] K proposal Edit(/.git/**) lowercase vs Windows case-preserving normalization; vendor Edit matcher case-sensitivity unproven; kernel+built-in backstops
5. [CLEAN][demonstrated] R2 HIGH fixed: .git/commondir create denied (protect-git); preflight flags main-checkout commondir
6. [CLEAN][demonstrated] R2 MED fixed: .git pointer file write denied; worktreeExtraPaths emits .git + common dir
7. [CLEAN][demonstrated] R2 LOW fixed: difftool/mergetool/man .path, imap.tunnel, absolute smtpServer detected
8. [CLEAN][demonstrated] R2 LOW fixed: slash-named submodule git dir scanned
9. [CLEAN][demonstrated] R2 LOW fixed: mixed-separator UNC caught by isUncPath
10. [CLEAN][demonstrated] #447 addressed: current managed path ambient, legacy ProgramData scanned session-writable
11. [CLEAN][code-traced] .git/ collapse does not over-block (read verb absent; no legit session write to .git)
12. [CLEAN][demonstrated] objects/info/alternates write-sealed; not an RCE vector
13. [CLEAN][demonstrated] Edit proposal carries .git/ and .git entries; drift check PASS (54)
14. [CLEAN][demonstrated] echo/tee/cp/mv and case/sep/dot/quote write forms denied (POL-05 + protect-git)
15. [CLEAN][demonstrated] 144/144 seal tests pass
counts (CHECKSUM): issues=1 suspicions=3 clean=11
evidence (CHECKSUM): demonstrated=11 code-traced=3 derived=1
checks=144 pass / 0 fail / 0 skip (git-rg-lever-seal.test.ts); protected-path-list PASS exit 0 (54); preflight ext/protocol gap findings=[] exit 0 (demonstrated)
adr=HIT(38)
report=docs/reviews/s409-red-team-round3-2026-10-05.md
