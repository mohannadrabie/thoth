# Red Team (Sutekh) — #428 F3 re-confirm (Issue #445): skip an unlistable POSIX PATH dir only root can write

Agent: red-team (Sutekh). Date: 2026-10-05. Tier: CRITICAL (policy enforcement / guard). Narrow re-confirm of round-1 finding F3 (docs/reviews/s428-red-team-2026-10-05.md).
Delta: `git -C C:/playground/thoth-wt428 diff 7de62c3 8eb0b91` (2830784 RED TRUST-19, 8eb0b91 fix). Worktree used read-only. Mutants ran in my own detached worktree (removed after).
ADR cache: HIT (38 ADRs, fp 63531e7). Attack-surface ADRs read via the catalog: policy-enforcement/guard stance, SUR-02 fall-through-is-deny.

Verdict: **go**. F3 over-deny is fixed: a root-owned 0700 unlistable PATH dir now allows, and the shell runs the trusted binary (demonstrated on real Linux).

The fix opens one regression, demonstrated:
- The skip treats "only root can write" as "nothing the shell can find".
- That holds only when the shell also cannot search the dir.
- A root-owned dir with mode 0711, 0311 or 2711 is unlistable but searchable.
- The gate allows the call while the shell runs the copy in that dir. Baseline 7de62c3 denied the same case.

It stays LOW under the evidence policy: the gate is unwired (#308 K held, 0% of live calls), and post-K exposure has basis `assumption`. The fix is small and on-branch (lstat each wanted name). Land it before #445 closes.

## Checks run (raw)

| Check | Command | Result |
|---|---|---|
| Trust tests in the fix worktree (Windows 11) | `node --test src/policy/gate/bare-binary-trust.test.ts hooks/pretooluse-kernel-gate-path-trust.test.ts` | tests 41, pass 40, fail 0, skipped 1 (TRUST-7b, no symlink-create right) |
| Real-port Linux probe, 8eb0b91 | `docker run --rm -v C:/playground/thoth-wt428:/src:ro -v <scratch>/probe:/probe:ro node:24-alpine sh /probe/run.sh`, real `createRealTrustPorts` as uid 1000 (`node`), `bash -c kubectl` | see the probe output below |
| Same probe, baseline 7de62c3 | same, with `/src` = the 7de62c3 copies of `bare-binary-trust.ts` and `path-trust-check.ts` | /opt/s711 -> deny unreadable-dir. /opt/s700 -> deny unreadable-dir. |
| Mutants (own worktree at 8eb0b91) | 7 single-line mutants, same two test files | 5 killed, 2 survived (M1, M6) |

Probe output (8eb0b91, uid=1000, PATH=`<dir>:/usr/local/bin:/usr/bin:/bin`, trusted `/usr/local/bin/kubectl` prints TRUSTED-usr-local-bin):
```text
== S1 root 0711 search-no-read, root-installed kubectl
gate={"ok":true}
SHADOW-RAN-from-/opt/s711
== S2 root 0311 write-search for owner only
gate={"ok":true}
SHADOW-RAN-from-/opt/s311
== S3 root 2711 setgid
gate={"ok":true}
SHADOW-RAN-from-/opt/s2711
== S4 root 0700 control (unsearchable)
gate={"ok":true}
TRUSTED-usr-local-bin
== S6 root 1733 sticky drop-box
gate={"ok":false,"kind":"unreadable-dir",...}
== S7 root 0700 + ACL u:node:wx
gate={"ok":false,"kind":"unreadable-dir",...}
== S5 plant: session overwrites session-writable (0777) file in root 0711 dir (open O_TRUNC, Write-tool equivalent, no exec)
write-rc=0
== S5 after plant
gate={"ok":true}
PLANTED-PAYLOAD-RAN
== S7 plant into ACL dir
write-rc=0
```
Remedy feasibility (same container, uid 1000): `lstat /opt/s711/kubectl` -> EXISTS. `lstat /opt/s711/nope` -> ENOENT. `lstat /opt/s700/kubectl` -> EACCES.

Mutants:
```text
M1-widen-codes (EACCES|EPERM -> anything but EIO):   pass 40 fail 0 skip 1   SURVIVED
M2-world-write-ignored (0o022 -> 0o020):              pass 39 fail 1 skip 1   killed
M3-skip-on-windows-too (drop !isWin):                 pass 13 fail 1 skip 1   killed
M4-always-skip (onlyRootCanWrite -> true):            pass 38 fail 2 skip 1   killed
M5-leaf-only (no ancestor walk):                      pass 38 fail 2 skip 1   killed
M6-no-realpath (chain on d.dir, not realpath):        pass 40 fail 0 skip 1   SURVIVED
M7-uid-ignored:                                       pass 37 fail 3 skip 1   killed
```

## Findings (ranked by exposure x irreversibility x silence)

### R1 (LOW, demonstrated): a searchable but unlistable root-owned dir is skipped, and the shell still resolves names in it (regression vs 7de62c3)
- Assumption broken: "a dir only root can write cannot be planted into by the session, so there is nothing to find" (comment at bare-binary-trust.ts:352-353). Plantability is not resolvability. Bash execs `dir/name` when the dir has the search (x) bit for the session, with no read bit needed.
- Scenario 1, wrong attribution: a root-owned 0711 dir sits ahead of `/usr/local/bin` on PATH and holds a root-installed `kubectl`.
  - The gate returns `{ok:true}` because phase 2 finds `/usr/local/bin/kubectl`.
  - The shell runs `/opt/s711/kubectl` instead (S1).
  - The same happens at 0311 (S2) and 2711 (S3). setgid adds nothing: the x bit is the cause.
- Scenario 2, plant: the same dir holds a session-writable file (mode 0777, or owned by the session after an installer chown).
  - The session overwrites its contents with no exec. An open with O_TRUNC keeps the mode bits.
  - The gate allows, and the planted payload runs (S5, `PLANTED-PAYLOAD-RAN`).
- Current defense: none on this path. Baseline 7de62c3 denied both shapes (`unreadable-dir`).
- The fix matches the Manager ruling exactly. The gap is in the ruling: "root-owned with no group/world write" proves nobody else can create an entry. It does not prove the shell finds nothing.
- Exposure: ~0% of live calls today (gate unwired, #308 K held, counted in code per round 1). Post-K: hosts with a root-owned, search-but-not-read PATH dir that holds a wanted name. Basis: assumption, so severity caps at LOW. Irreversible (arbitrary exec under an allow record) and silent (the allow names no dir).
- Measure it: on ubuntu-latest CI and on a developer Linux/macOS host, list each PATH dir with its octal mode and owner. Linux: `stat -c "%a %U %n"` on each PATH dir. macOS: `stat -f "%Lp %Su %N"`. Count the dirs that are unlistable and searchable.
- Proposed remedy (a Manager decision):
  - In the EACCES/EPERM branch, keep `onlyRootCanWrite`.
  - Then `lstat(join(dir, name))` for each wanted name:
    - ENOENT -> nothing there.
    - EACCES -> the shell cannot reach it either, so skip.
    - The entry exists -> `shadow` deny.
    - Any other error -> deny.
  - Feasibility is demonstrated above. POSIX bash resolves exact names only, so one lstat per name is complete.
- Named proof-test: `src/policy/gate/bare-binary-trust.test.ts::TRUST-19b-searchable-unlistable-root-dir-probes-names`.
  - Fake world: an unlistable root-owned `/opt/s711` (0o40711) where an lstat of `/opt/s711/kubectl` succeeds.
  - Assert a `shadow` deny.
  - Assert the same dir with the lstat -> ENOENT is `{ok:true}`.
  - Assert the 0700 shape (lstat -> EACCES) is `{ok:true}`.

### R2 (LOW, demonstrated, outside the #445 delta, pre-existing #428 core): a PATH entry with `..` after a symlink is folded lexically, so the gate scans a different dir from the one the shell searches
- Scenario: PATH entry `/tmp/w/l/../b`, where `/tmp/w/l` -> `/tmp/w/real/sub`.
  - `resolveEntries` stores `normalizePath(dir)` and lists `/tmp/w/b`, which does not exist (ENOENT, skip).
  - The kernel resolves the entry to `/tmp/w/real/b`, where the session-owned `kubectl` sits.
  - Probe: `gate={"ok":true}`, then `SHADOW-VIA-DOTDOT`.
- Code: bare-binary-trust.ts:278 (`dirs.push({ dir: normalizePath(platform, dir), ... })`) and the normalizePath doc comment at line 99 (folds `.` and `..`).
- Exposure: post-K only. It needs a PATH entry containing `..` behind a symlink. Basis: assumption -> LOW. The session cannot edit the gate PATH or create symlinks without exec.
- Named proof-test: `src/policy/gate/bare-binary-trust.test.ts::TRUST-20-dotdot-entry-after-symlink`. Assert deny, or realpath the raw entry before listing.

### R3 (LOW, demonstrated): the "access errors only" half of the ruling is pinned only for EIO
- M1 survives: widening the skip to every code but EIO stays green.
- TRUST-6e moved to a session-owned dir. TRUST-19 checks only EIO on a root-owned dir, so EMFILE, ELOOP and EINVAL on a root-owned dir are not pinned.
- No security effect: `onlyRootCanWrite` is the guard, and the R1 remedy covers resolvability. The gap is in the contract and test strength.
- Named proof-test: extend TRUST-19 into `TRUST-19c-non-access-codes-deny-on-root-owned`, looping EIO, EMFILE, ELOOP and ENAMETOOLONG over the root-0700 world.

### R4 (UNPROVEN-pending-verification, LOW, code-traced): extended ACLs that `st_mode` does not show (macOS, NFSv4, ZFS NFSv4-ACL, CIFS `noperm`)
- The chain reads only `uid` and `mode` (bare-binary-trust.ts:214-215; the `lstat` port in path-trust-check.ts returns `{uid, mode}` only).
- Linux POSIX ACLs are covered: the ACL mask shows in the group bits, so a `u:node:wx` grant on a root 0700 dir denies. The session really could plant there (S7, `write-rc=0`), so that deny is load-bearing.
- A macOS `chmod +a "user:X allow add_file,search"` on a root 0700 dir leaves the mode at 0700. The session could then add files to a dir the gate skips.
- This also applies to the trusted roots before the fix. The #445 skip adds untrusted root-owned dirs to that surface.
- Settle (anyone with a Mac):
  - Run `sudo mkdir /opt/acl && sudo chmod 700 /opt/acl && sudo chmod +a "user:$USER allow add_file,search" /opt/acl`.
  - Run the probe with `PATH=/opt/acl:/usr/local/bin:/usr/bin:/bin`.
  - Expect a deny. An allow confirms the finding.

### SURVIVES
- **F3 itself (demonstrated).** S4: a root-owned 0700 unlistable dir -> `{ok:true}`, and the shell runs the trusted binary. Baseline 7de62c3 denied it. The over-deny is gone.
- **Sticky or world-writable dirs (demonstrated).** S6: a root 1733 drop-box -> deny, because `mode & 0o022` catches the world-write bit whatever the sticky bit says. M2 (`0o020`) is killed.
- **Linux POSIX ACLs (demonstrated).** S7 above.
- **No new error path skips (demonstrated, plus code-traced).**
  - An `lstat` or `realpath` throw inside `onlyRootCanWrite` is caught -> false -> deny.
  - A non-string `code` becomes `UNKNOWN` -> deny.
  - Windows is unchanged: M3 is killed. TRUST-19 loops EACCES and EPERM on win32 and denies.
  - M4, M5 and M7 are killed: the ancestor walk, uid and mode are each load-bearing.
- **realpath, bind mounts, races (code-traced).**
  - The chain runs on `realpath(dir)`, so a session-owned symlink entry is judged by its target.
  - M6 survives because dropping realpath only over-denies: `lstat` of a symlink reports 0777 -> deny. That is the safe direction.
  - A bind mount reports the source inode uid and mode and cannot fake root ownership. Idmapped or FUSE mounts need privilege or an exec that the gate withholds.
  - A non-root session cannot change a root-owned, non-writable chain between the `lstat` and the shell exec.
  - Re-pointing a symlinked entry is the existing #439 TOCTOU residual and adds no new window.
  - A uid-0 session defeats the chain, as it already defeats the trusted roots: the existing residual (c).
- **TRUST-6e change (demonstrated).**
  - The change is required: the fake world default `lstat` is root 0o40755 (hooks/test-support/trust-world.ts:76), so the old fixture would now skip EACCES/EPERM.
  - It is more realistic: `/home/u/bin` is session-owned.
  - The root-owned non-access case moved to TRUST-19 (EIO).
  - It is not weakened as a security test. The only gap it leaves is R3.

## Scariest unproven assumption, go/no-go, next action
- **Scariest unproven assumption:** that `st_mode` plus `uid` describes who can add a file (R4). On macOS and NFSv4 an ACL grant is invisible to it. The #445 skip widens the set of dirs that rely on that assumption from the trusted roots to any unlistable root-owned dir.
- **Go/no-go: go.**
  - No finding gates: all are LOW under the exposure-basis cap, and the gate is unwired.
  - R1 is a demonstrated wrong-allow regression in this very fix. #445 should not close on 8eb0b91 alone.
- **Single next action:** on s7/knockout-428, add TRUST-19b-searchable-unlistable-root-dir-probes-names (RED), then the lstat(dir/name) probe in the EACCES/EPERM branch. Run the PATH-mode measurement above on ubuntu-latest.

## Editorial (uncounted, verdict-neutral)
- Self-audit: round-1 F1 and F3 were labeled MED with exposure basis `assumption`. The evidence policy caps that at LOW. Their Issues (#445 for F3) stand as filed, but the severity label overstated the policy cap.
- The gate-sandbox pin comment (gate-sandbox.ts:174-176) says the runner `/opt/pipx_bin` is "root-owned mode 700". If its real mode on the runner is 0711 or 0755, the real-world trigger for the skip changes. The measurement under R1 settles it.
- `posixChainTrusted` loops forever if realpath ever returns a relative path (dirnameOf gives "." and then "." again). The real realpathSync.native always returns an absolute path, so only a malformed fake port can hit this. A one-line guard that returns false for a non-absolute path hardens it.

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][LOW][demonstrated] R1 root-owned unlistable but SEARCHABLE dir (0711/0311/2711) is skipped; bash still resolves names there -> gate allow while shadow runs (S1-S3), session-writable file inside -> planted payload runs (S5); regression vs 7de62c3 (denied). Remedy lstat(dir/name). TRUST-19b.
2. [ISSUE][LOW][demonstrated] R2 PATH entry with .. after a symlink folded lexically -> gate lists a different dir than the shell searches -> wrong allow (pre-existing #428 core, outside delta). TRUST-20.
3. [SUSPICION][LOW][code-traced] R4 macOS/NFSv4/CIFS extended ACLs invisible to uid/mode chain -> add_file grant on a root 0700 dir undetected; Linux POSIX ACL proven caught. UNPROVEN-pending macOS probe.
4. [ISSUE][LOW][demonstrated] R3 access-errors-only pinned for EIO only; mutant M1 (skip any code but EIO) survives; security-neutral. TRUST-19c.
5. [CLEAN][demonstrated] F3 resolved: root 0700 unlistable dir now allows and shell runs the trusted binary (S4); baseline denied.
6. [CLEAN][demonstrated] sticky/world-writable 1733 drop-box denies (S6); M2 killed.
7. [CLEAN][demonstrated] Linux POSIX ACL u:node:wx on root 0700 -> mask in group bits -> deny (S7); plant was possible, so the deny is load-bearing.
8. [CLEAN][demonstrated] no new skip-on-error path: lstat/realpath throw -> deny, Windows unchanged (M3 killed), chain walk/uid/mode load-bearing (M4/M5/M7 killed).
9. [CLEAN][code-traced] realpath/bind-mount/lstat-to-exec race: chain on realpath (M6 survives only in over-deny direction), bind mounts cannot fake uid, root-owned chain immutable to non-root; symlink re-point is #439 residual; uid-0 session is residual (c).
10. [CLEAN][demonstrated] TRUST-6e uid 1001 change required (fake default is root 0755) and more realistic; not weakened beyond R3.
counts: issues=3 suspicions=1 clean=6
evidence: demonstrated=8 code-traced=2 derived=0
checks=trust tests 41: 40 pass / 0 fail / 1 skip; mutants 7: 5 killed / 2 survived (M1, M6); Linux real-port probes (node:24-alpine, uid 1000): 8eb0b91 8 scenarios, baseline 7de62c3 2 scenarios, dotdot 1, lstat-remedy 3 - all as reported
adr=HIT(38)
report=docs/reviews/s428-red-team-reconfirm-2026-10-05.md
