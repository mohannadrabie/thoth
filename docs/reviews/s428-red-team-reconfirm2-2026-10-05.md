# Red Team (Sutekh): #428 / #445 re-confirm, round 2 (the R1 to R3 fix at b70e6ab)

Agent: red-team (Sutekh). Date: 2026-10-05. Tier: CRITICAL (policy enforcement / guard). Narrow re-confirm of my round-1 re-confirm (docs/reviews/s428-red-team-reconfirm-2026-10-05.md: R1 searchable-unlistable regression, R2 `..` after symlink, R3 error-code pin, R4 macOS ACL).
Delta: `git -C C:/playground/thoth-wt428 diff 8eb0b91 b70e6ab` (5a550e8 RED TRUST-19b/19c/20, b70e6ab fix). The worktree was used read-only. Mutants ran in my own detached worktree under the session scratchpad, with a junction to node_modules. The worktree was removed afterwards, and `git worktree list` confirms it is gone.
ADR cache: HIT (38 ADRs, fp 63531e7). Attack-surface ADRs: the policy-enforcement/guard stance and SUR-02 fall-through-is-deny.

Verdict: **go**.
- R1 is fixed (demonstrated on real Linux). Every searchable-but-unlistable shape now gets a `shadow` deny: 0711, 0311, 2711, 0701, 0710 with group membership, and a POSIX ACL `u:node:x`. The unsearchable shapes (0700, and 0710 without membership) still allow, and bash then runs the trusted copy.
- R2 is fixed for PATH entries. R3 is fixed: the old M1 mutant is now killed by TRUST-19c.
- Three new LOW findings, all demonstrated, all outside this delta. Each is a case where the gate's string model of a PATH lookup differs from the shell's:
  - N1: a case-insensitive file system.
  - N2: a literal `~` PATH entry, which bash tilde-expands.
  - N3: a `..` inside `$HOME`, which feeds the login-profile directories.
- None gates. The PreToolUse gate is not registered (0% of live calls, counted in code), and post-K exposure has basis `assumption`. They belong with #308 K, not #445.

## Checks run (raw)

| Check | Command | Result |
|---|---|---|
| Trust tests at b70e6ab (own worktree, Windows 11) | `node --test src/policy/gate/bare-binary-trust.test.ts hooks/pretooluse-kernel-gate-path-trust.test.ts` | tests 44, pass 43, fail 0, skipped 1 (TRUST-7b, no symlink-create right) |
| Real-port Linux probe, b70e6ab | `docker run --rm -v C:/playground/thoth-wt428:/src:ro -v <scratch>/sutekh-r2:/probe:ro node:24-alpine sh /probe/run.sh`, real `createRealTrustPorts`, as uid 1000 (`node`, member of `kgrp`), then `bash -c kubectl` (bash 5.3.9) | output below |
| Case-insensitive FS probe | same, plus `--privileged`, a vfat loop mount at `/mnt/ci` (uid 1000) | output below |
| Mutants (own worktree at b70e6ab) | 13 single-edit mutants, same two test files | 11 killed. 2 survived: M5 (equivalent as written, re-run as M5' and killed) and M11 (over-deny direction only) |
| Gate wiring (exposure basis) | `node -e` over `.claude/settings.json` `hooks` keys on master, origin/master, s7/knockout and wt428 HEAD | `SessionStart,UserPromptSubmit` on all four. No `PreToolUse`, so 0% of live calls. |

Probe output (b70e6ab). Trusted `/usr/local/bin/kubectl` prints TRUSTED-usr-local-bin. B=`/usr/local/bin:/usr/bin:/bin`.
```text
uid=1000(node) gid=1000(node) groups=101(kgrp),1000(node),1000(node)
== S1 root 0711 + kubectl            gate={"ok":false,"kind":"shadow",...}   SHADOW-RAN-from-/opt/s711
== S1n root 0711 no kubectl          gate={"ok":true}                        TRUSTED-usr-local-bin
== S2 root 0311 + kubectl            gate={"ok":false,"kind":"shadow",...}   SHADOW-RAN-from-/opt/s311
== S3 root 2711 + kubectl            gate={"ok":false,"kind":"shadow",...}   SHADOW-RAN-from-/opt/s2711
== S3b root 0701 + kubectl           gate={"ok":false,"kind":"shadow",...}   SHADOW-RAN-from-/opt/s701
== S4 root 0700 + kubectl            gate={"ok":true}                        TRUSTED-usr-local-bin
== S6a root:kgrp 0710, node in kgrp  gate={"ok":false,"kind":"shadow",...}   SHADOW-RAN-from-/opt/g710
== S6b root:root 0710, not in group  gate={"ok":true}                        TRUSTED-usr-local-bin
== S8 0711, kubectl is a directory   gate={"ok":false,"kind":"shadow",...}   TRUSTED-usr-local-bin
== S9 0700 + ACL u:node:x            gate={"ok":false,"kind":"shadow",...}   SHADOW-RAN-from-acl-x
== S5 plant: overwrite session-writable /opt/s5/kubectl (no exec)   write-rc=0
== S5 after plant                    gate={"ok":false,"kind":"shadow",...}   PLANTED-PAYLOAD-RAN
== D1 /tmp/w/l/../b                  gate={"ok":false,"kind":"unreadable-dir","reason":"PATH entry /tmp/w/l/../b contains a \"..\" segment, ..."}   SHADOW-VIA-DOTDOT
== D2 /tmp/w/l/../b/                 gate={"ok":false,"kind":"unreadable-dir",...}   SHADOW-VIA-DOTDOT
== D3 /tmp/w/l//..//b                gate={"ok":false,"kind":"unreadable-dir",...}   SHADOW-VIA-DOTDOT
== TL1 literal ~/tb entry            gate={"ok":true}                        SHADOW-VIA-TILDE
== TL2 literal ~node/tb entry        gate={"ok":true}                        SHADOW-VIA-TILDE
== TL3 literal ~+/bin entry (PWD)    gate={"ok":true}                        SHADOW-VIA-TILDE-PLUS
== TL4 busybox sh with ~/tb          TRUSTED-usr-local-bin
== H1 HOME=/tmp/w/l/.. (l -> /tmp/w/real/sub), gate PATH=B
gate={"ok":true}
shell PATH head=/tmp/w/l/../bin
SHADOW-VIA-HOME-DOTDOT
```
The shell line after each gate line shows what bash WOULD run. A deny means the call never reaches bash.

Case-insensitive FS probe (vfat loop mount, session-owned, kernel 6.18.33.2-microsoft-standard-WSL2):
```text
listing: Kubectl
== C1 case-insensitive dir, planted Kubectl, session-owned
gate={"ok":true}
PLANTED-CASE-VARIANT-RAN
== C2 control: planted exact kubectl
listing: kubectl
gate={"ok":false,"kind":"shadow",...}
```

Mutants (b70e6ab):
```text
M1-present-ignored                 pass 42 fail 1 skip 1 killed
M2-probe-EACCES-not-skip           pass 42 fail 1 skip 1 killed
M3-probe-EPERM-not-skip            pass 42 fail 1 skip 1 killed
M4-probe-any-error-skips           pass 42 fail 1 skip 1 killed
M5-probe-first-name-only           pass 43 fail 0 skip 1 SURVIVED   (equivalent: the inserted break was unreachable after try-return/catch-continue)
M5p-probe-stops-after-first-absent pass 42 fail 1 skip 1 killed     (continue -> return undefined; TRUST-19b "every wanted name")
M6-probe-dropped                   pass 42 fail 1 skip 1 killed
M7-dotdot-check-dropped            pass 42 fail 1 skip 1 killed
M8-dotdot-substring                pass 42 fail 1 skip 1 killed
M9-dotdot-win-backslash-only       pass 42 fail 1 skip 1 killed
M10-readdir-skip-widened (= round-1 M1)  pass 42 fail 1 skip 1 killed
M11-probe-ENOTDIR-not-skip         pass 43 fail 0 skip 1 SURVIVED   (ENOTDIR on lstat(dir/name) needs dir to be a non-directory; readdir already returned EACCES, not ENOTDIR. The mutant only over-denies.)
M12-present-denies-unreadable      pass 42 fail 1 skip 1 killed
```

## Findings (ranked by exposure x irreversibility x silence)

All three new findings share one root cause:
- The gate models the shell's name lookup with strings: `readdir` plus an exact compare, lexical path folding, and no tilde expansion.
- The shell uses the file system's own lookup, after its own expansions.
- Each finding is a demonstrated point where the two diverge in the allow direction.
- The #445 probe branch already uses the right primitive: `lstat(dir/name)`, which is the file system's own lookup. Using it for every untrusted directory, not only unlistable ones, closes N1.

### N1 (LOW, demonstrated, outside the delta: #428 core): on a case-insensitive file system, a case variant of the name in a session-writable directory is not matched, and the shell runs it
- Assumption broken: "POSIX matching is exact" (`matchesName`, bare-binary-trust.ts:157, `if (!isWin(platform)) return entry === name;`).
  - That holds only on a case-sensitive file system.
  - macOS APFS is case-insensitive by default. vfat, exFAT, ext4/tmpfs with `casefold`, and CIFS mounts are too.
- Scenario:
  - The session writes `Kubectl` with the Write tool, which needs no exec, into a session-writable PATH directory such as `~/.local/bin`, `/opt/homebrew/bin` or a dev mount.
  - Phase 1 lists `Kubectl` and does not match `kubectl`.
  - Phase 2 finds the trusted `/usr/local/bin/kubectl`, so the gate allows.
  - bash looks up `kubectl` in that directory, and the file system resolves it to `Kubectl`. Probe C1: `gate={"ok":true}`, then `PLANTED-CASE-VARIANT-RAN`.
  - Control C2: the exact name is denied.
- Current defense: none on POSIX. Windows is covered, because its `matchesName` folds case.
- Exposure: ~0% of live calls today. Basis: counted in code (no `PreToolUse` registered on master, s7/knockout or the fix branch). Post-K: every macOS user with a session-writable PATH directory. Basis: assumption, so the finding caps at LOW. Irreversible (arbitrary exec under an allow record) and silent.
- Remedy (Manager decision; outside #445 scope):
  - On POSIX, add `lstat(join(dir, name))` for every wanted name in every untrusted listable directory, as the #445 branch already does for unlistable ones.
  - The file system then answers with its own folding rules.
  - A case-insensitive compare would over-deny on case-sensitive file systems and still miss Unicode case-folding rules that the file system applies but JavaScript `toLowerCase` does not.
- Named proof-test: `src/policy/gate/bare-binary-trust.test.ts::TRUST-21-case-folding-fs-variant-is-shadow`.
  - Fake world: a session-owned `/home/u/.local/bin` whose `readdir` returns `["Kubectl"]` and whose `lstat("/home/u/.local/bin/kubectl")` succeeds.
  - Assert a `shadow` deny.
  - Mirror it in a container test on a vfat or casefold mount if one is admitted.

### N2 (LOW, demonstrated, outside the delta: #428 core): a literal `~` PATH entry is joined to cwd by the gate but tilde-expanded by bash at lookup
- Assumption broken: "an entry not starting with `/` is relative to cwd" (bare-binary-trust.ts:307-308).
  - Bash (not POSIX mode) tilde-expands a PATH element that starts with `~` at command lookup time: `~`, `~user` and `~+`.
  - A PATH like `export PATH="~/.cargo/bin:$PATH"` carries a literal `~`, because the tilde was quoted. This is a known misconfiguration that still works in bash, so users rarely notice it.
- Scenario:
  - The gate's PATH holds `~/tb`. The gate lists `<cwd>/~/tb`, gets ENOENT and skips it.
  - Bash searches `$HOME/tb`, where the session wrote `kubectl` with the Write tool.
  - Probe: TL1 (`~/tb`), TL2 (`~node/tb`) and TL3 (`~+/bin`, which is `$PWD/bin`) all give `gate={"ok":true}` while the planted copy runs.
  - busybox sh does not expand the tilde (TL4). The gap is bash-specific, and the Bash tool runs bash on Linux.
- Answer to the brief: `..` cannot be smuggled through `~`. `~/x/../y` still carries a literal `..` segment and denies. The tilde itself is the smuggle: it relocates the whole entry.
- Exposure: 0% today (counted in code). Post-K basis: assumption, so LOW.
- Remedy: on POSIX, deny any PATH entry that starts with `~`, in the same spirit as the `..` rule.
- Named proof-test: `src/policy/gate/bare-binary-trust.test.ts::TRUST-20b-tilde-path-entry-denies` over `~/x`, `~u/x`, `~+/x` and `~-/x`.

### N3 (LOW, demonstrated, a gap in the R2 fix): a `..` in `$HOME` reaches the login-profile directories, which skip the new `..` check
- Code: the `..` test runs on PATH entries only (bare-binary-trust.ts:303).
  - The login-profile additions `joinPath(home, "bin")` and `joinPath(home, ".local/bin")` (lines 314-318) go through `add()`, whose `normalizePath` folds `..` lexically.
  - `os.homedir()` returns `$HOME` verbatim.
- Scenario:
  - `HOME=/tmp/w/l/..`, where `l -> /tmp/w/real/sub`.
  - The gate scans `/tmp/w/bin` (absent, so skipped) and allows.
  - A login profile prepends `$HOME/bin` (`/tmp/w/l/../bin`), which the kernel resolves to `/tmp/w/real/bin`. The planted copy runs (H1).
- Exposure: needs a `..` in HOME. That is exotic. Basis: assumption, so LOW.
- Remedy: apply the same `..` segment test to `home` before the login-profile `add()`.
- Named proof-test: `src/policy/gate/bare-binary-trust.test.ts::TRUST-20c-dotdot-in-home-denies`.

### R4 (UNPROVEN-pending-verification, LOW, code-traced, carried forward unchanged): macOS/NFSv4 extended ACLs are invisible to the uid/mode chain
- Unchanged by b70e6ab.
- On Linux the new probe also covers ACL search grants: S9 (`u:node:x` on root 0700) shows the mask in the group bits, so the chain passes, the probe finds the name and the call is denied.
- On macOS, a `chmod +a "user:X allow add_file,search"` grant keeps mode 0700. The probe then sees the name, because search is granted, and denies. So the probe narrows R4.
- What remains open is `add_file` without `search` on macOS: the session could create a file it cannot itself look up, and neither can bash. That is likely benign. It still needs a Mac to settle.
- Settle: the round-1 macOS command (sudo `chmod +a`, then probe), run by anyone with a Mac.

### SURVIVES
- **R1 fixed (demonstrated).**
  - Shadow deny for: S1 (0711), S2 (0311), S3 (2711), S3b (0701), and S5 (a session-writable file planted in root 0711).
  - S1n (0711, name absent) allows, and bash runs the trusted copy.
  - S4 (0700) allows, and bash runs the trusted copy.
  - Before b70e6ab, S1-S3 and S5 were wrong allows.
- **lstat EACCES means the shell cannot reach the name (demonstrated).**
  - S6a: root:kgrp 0710 with `node` in `kgrp`. lstat succeeds, so the gate denies, and bash would have run the shadow.
  - S6b: root:root 0710, `node` not in the group. lstat gets EACCES, so the gate allows, and bash runs the trusted copy.
  - S9: the POSIX ACL search-only grant denies.
  - The parity rests on the gate and the Bash tool shell sharing credentials (uid, gid, supplementary groups, capabilities). Both are children of the same Claude Code process.
  - A command that changes groups (`sg`, `newgrp`) is a different bare binary and wrapper question, outside this check.
- **R2 fixed for PATH entries (demonstrated).**
  - D1, D2 (trailing slash) and D3 (`//..//`) all deny.
  - Encoding cannot smuggle `..` on POSIX. The kernel only honours the literal `..` component. Node decodes invalid UTF-8 in the environment to U+FFFD, never to `.`.
  - On Windows, the gate's lexical folding equals the Win32 pre-file-system normalization, and the gate's `readdir`/`realpath` go through the same Win32 API. So the new Windows `..` deny is a harmless over-deny.
  - The one gap is N3.
- **R3 fixed (demonstrated).** M10 (round-1 M1, widening the readdir skip to every code but EIO) is now killed by TRUST-19c. The probe's error contract is pinned: M2, M3 and M4 are killed. M11 survives in the over-deny direction only.
- **Name variants in the probe branch (code-traced).**
  - POSIX bash resolves the exact bare name. `lstat(dir/name)` takes the same file-system lookup as `execve`, so whatever case-folding the file system applies, it applies to both. That makes the probe branch immune to N1.
  - Windows never takes the skip: `!isWin(platform)` at bare-binary-trust.ts:375, and TRUST-19 loops EACCES and EPERM on win32 and denies. PATHEXT variants therefore never depend on a probe; they stay on the readdir plus `name.ext` match.
  - TRUST-19b's two-name case is load-bearing: M5p is killed.
- **TRUST-6d `../x` removal loses no coverage (demonstrated).**
  - `../x` moved into TRUST-20 with a stronger assertion: deny whether or not the name is present.
  - Relative-entry joining against cwd is still covered by `.`, `./bin` and `bin`.
  - M7 (drop the `..` check) is killed.
  - `..bin` and `a..b` are pinned as non-`..` names (M8 killed).

## Scariest unproven assumption, go/no-go, next action
- **Scariest assumption (now partly demonstrated false):** that a string model of PATH lookup (`readdir` plus an exact compare, lexical folding, no tilde expansion) equals the shell's lookup. N1 breaks it on macOS's default file system with a Write-tool-only plant, and the gate gives no signal.
- **Go/no-go: go.**
  - #445's delta is correct and well pinned: R1, R2 and R3 are fixed, and 11 of 13 mutants are killed, with the 2 survivors explained.
  - N1-N3 are LOW under the exposure-basis cap, because the gate is unregistered. They are pre-existing #428 core gaps, not regressions.
- **Single next action:** the Manager rules where N1-N3 land. I recommend a follow-up Issue that blocks #308 K, with three items:
  - POSIX `lstat(dir/name)` in every untrusted directory (N1).
  - Deny a `~`-prefixed entry (N2).
  - Run the `..` test on `$HOME` (N3).
  - Each item is RED-first via TRUST-21, TRUST-20b and TRUST-20c.

  #445 itself can close on b70e6ab.

## Editorial (uncounted, verdict-neutral)
- #308 shows `CLOSED / COMPLETED` at 2026-10-05T14:34:42Z, closed by commit 2a24f1e ("fix: #308 story E review conditions ..."). GitHub reads `fix: #N` (keyword plus colon) as a closing reference. K is not wired (no `PreToolUse` on master), and the Manager reopened #308 on 2026-10-04 for exactly this.
  - Re-open #308.
  - Avoid `fix: #N` subjects for umbrella issues, or follow them with a non-keyword form.
  - b70e6ab's `fix: #445 ... (Fixes #445)` is intentional.
- S8: a directory named `kubectl` in a root 0711 directory is denied as `shadow`, though bash skips directories. This over-deny is harmless and arguably correct (the gate cannot tell a directory from a file without another stat).
- The round-1 editorial note that `posixChainTrusted` could loop forever on a relative realpath still stands. It is unreachable with the real port.

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][LOW][demonstrated] N1 case-insensitive FS (macOS APFS default, vfat, casefold): POSIX matchesName exact-compares readdir, so a planted `Kubectl` in a session-writable dir -> gate allow, bash runs it (C1); pre-existing #428 core, outside delta; remedy lstat(dir/name) in every untrusted dir. TRUST-21.
2. [ISSUE][LOW][demonstrated] N2 literal `~`/`~user`/`~+` PATH entry: gate joins to cwd, bash tilde-expands at lookup -> planted $HOME copy runs (TL1-3); busybox sh does not (TL4); pre-existing #428 core; remedy deny `~`-prefixed entries. TRUST-20b.
3. [ISSUE][LOW][demonstrated] N3 `..` in $HOME skips the new `..` check (only PATH entries checked, bare-binary-trust.ts:303 vs 314-318) -> login-profile $HOME/bin folded lexically -> wrong allow (H1); gap in the R2 fix, exotic trigger. TRUST-20c.
4. [SUSPICION][LOW][code-traced] R4 carried: macOS/NFSv4 ACL invisible to uid/mode; new probe narrows it (a search grant makes the name visible and denies, S9 on Linux); add_file-without-search remains UNPROVEN-pending a Mac.
5. [CLEAN][demonstrated] R1 fixed: 0711/0311/2711/0701 + planted session-writable file -> shadow deny; 0711 absent and 0700 -> allow, bash runs trusted.
6. [CLEAN][demonstrated] lstat EACCES == shell unreachable: 0710 group member denies (shadow reachable), non-member allows (trusted runs), ACL u:node:x denies; parity rests on shared credentials.
7. [CLEAN][demonstrated] R2 fixed for PATH entries: /l/../b, trailing slash, //..// deny; no encoded `..` on POSIX; Windows lexical == Win32 so its deny is over-deny only.
8. [CLEAN][demonstrated] R3 fixed: round-1 M1 (=M10) killed by TRUST-19c; probe error contract pinned (M2-M4 killed); 11/13 mutants killed, M5 equivalent (M5p killed), M11 over-deny only.
9. [CLEAN][code-traced] name variants in the probe branch: POSIX lstat uses the same FS lookup as execve (folding included); Windows never skips (line 375 !isWin; TRUST-19 win loop), so PATHEXT stays on readdir + name.ext.
10. [CLEAN][demonstrated] TRUST-6d `../x` removal loses no coverage: moved to TRUST-20 with a stronger assertion; relative join still covered; M7/M8 killed.
counts: issues=3 suspicions=1 clean=6
evidence: demonstrated=8 code-traced=2 derived=0
checks=trust tests 44: 43 pass / 0 fail / 1 skip; mutants 13: 11 killed / 2 survived (M5 equivalent, M11 over-deny); Linux real-port probes (node:24-alpine, uid 1000, bash 5.3.9): 20 scenarios + vfat case probe 2, all as reported; hook registration: no PreToolUse on 4 refs
adr=HIT(38)
report=docs/reviews/s428-red-team-reconfirm2-2026-10-05.md
