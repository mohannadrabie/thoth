# Phase 1 plan: Issue #428 (S7, severity:high, blocks #308 K), a bare allowed binary must not resolve to a planted file

Date: 2026-10-05. Author: story-implementer (Ptah). Branch `s7/knockout`. Phase 1 only: nothing built, nothing committed; this file is the only file written.
`📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 63531e7) [CACHE=HIT]`
Inputs: Issue #428 body (no comments), `docs/reviews/s308-EFJ-cross-domain-final-2026-10-05.md` suspicion 1 (cited by the Issue, not re-read), E0 plan `docs/plans/s308-E0-readonly-shell-plan-2026-10-05.md`, D launcher plan `docs/plans/s308-D-launcher-plan-2026-10-02.md`, `src/policy/normalizer/shell.ts` (`RESOLVABLE_BINARIES`, F9/F9b), `src/policy/gate/decide-tool-call.ts` (`decideToolCall(input, ports)`).

## 0. Restatement and readiness

Restated: after F9/F9b the gate resolves a command only when its leading binary (and any wrapper) is a bare lowercase name from a closed set (`kubectl` today; plus `ls cat head tail wc grep` after E0; wrappers `sh bash env ...` from `wrapper-catalog.ts`). A bare name does not pin WHICH file the shell runs: PATH decides, and a session can plant `kubectl`, `sh` or `env` in a user-writable PATH directory with the Write tool (not routed through the gate). The gate must therefore verify, for every bare name it lets resolve, that the name resolves to a system-installed file and cannot be shadowed by a session-writable directory, and deny otherwise.

Readiness: no material fact missing. Two facts are measured by a spike inside the story (section 8, S1) rather than assumed; they do not block the plan, they shape one parameter.

## 1. ADR review (mandatory gate)

Catalog read through the cache (38 ADRs). Verdicts at rule level, same family as E0's review; no ADR names PATH resolution.
- ADR-0021 section 3.2 / SUR-02 (terminal fall-through is deny; anything the gate cannot confidently resolve is reported via `unresolved`): APPLICABLE. Rule honored: a binary whose resolution cannot be established is a deny, never a guess.
- THOTH-ADR-0001 (central classification, 2026-09-19 exemption) and THOTH-ADR-0003: NOT-APPLICABLE (classification-file entries; this story adds none).
- Policy-enforcement / guard ADRs (kernel zero-diff stance from S2/S4): APPLICABLE as a constraint: `kernel.ts` stays zero-diff; the check lives in the gate adapter layer.
- Anything on secrets, IAM, Terraform (adr/devops): NOT-APPLICABLE.
- UNCLEAR: none.

## 2. Acceptance criteria (numbered, testable; derived ones marked)

"Allowed binary set" B = `RESOLVABLE_BINARIES` ∪ E0's six read binaries ∪ the wrapper binaries `wrapper-catalog.ts` can unwrap. "Invoked names" of a command = the bare names the normalizer actually consumed to resolve it (leading binary plus each unwrapped wrapper layer).

1. A Bash command that resolves (empty `unresolved`) and whose invoked name resolves, in the gate's PATH, to a file in a trusted system directory with no shadow in any untrusted PATH directory stays allowed exactly as today.
2. If an untrusted PATH directory holds a file named like an invoked name (extension variants on Windows, case-insensitive on Windows), the call is denied with a reason naming the name and the directory, even when a trusted copy also exists and even when the trusted directory is earlier in PATH. Derived (order-independent on purpose: the shell's real PATH order is not observable from the gate, see S1).
3. If the invoked name's first PATH hit is in an untrusted directory, or there is no hit in a trusted directory, the call is denied (fail closed).
4. Every name in B is covered, not a sample: a test iterates `RESOLVABLE_BINARIES`, the E0 set and the wrapper catalog's binaries from the exported sets and asserts criteria 2 and 3 for each. The "covers all of B" claim comes from this running test, not from prose (CLAUDE.md completeness rule).
5. A wrapper chain is checked at every layer: `sh -c 'kubectl get pods/x --context=c'` with a plant for only `kubectl` is denied; with a plant for only `sh` is denied.
6. Fail closed on anything unknowable: unreadable untrusted directory, PATH unset or empty, empty entry, `.` or relative entry (scanned against cwd and treated as untrusted), dangling or symlinked hit whose realpath leaves a trusted directory, `readdir` throwing: each is a deny with a distinct reason.
7. A hit that is a symlink or Windows reparse point is judged by its realpath, not its link location. Derived.
8. POSIX only: a trusted directory must be root-owned and not group/world-writable (and its ancestors up to `/`); otherwise it is demoted to untrusted. Windows relies on the allowlist (section 4). Derived.
9. The check runs only for a command that would otherwise be allowed; an already-denied call keeps its existing reason (no new reason shadows an existing deny). The gate's stdin/stdout contract is unchanged (deny JSON shape and exit codes as today).
10. The check adds no write, no spawn and no network: read-only `readdir`/`realpath`/`lstat`. Test asserts the injected port is the only I/O.
11. A fault inside the check (thrown error) denies; it never allows. Test with a port that throws.
12. The gate stays fail-closed under the D launcher's scrubbed env (`env -i PATH SYSTEMROOT windir CLAUDE_PROJECT_DIR`): the trusted-directory set is derivable from those variables alone (no `ProgramFiles` env needed). Derived from the D plan's allow-list.

## 3. Risk tier (proposed)

CRITICAL. Justification: it changes the session gate's allow decision (named sensitive area: policy enforcement / session gates; `hooks/pretooluse-kernel-gate.mjs` is touched) and closes an arbitrary-code-execution path under an allowed record, a security-relevant fix that blocks the #308 K wiring.
Reviewers: `red-team` + `app-security-reviewer` + `cross-domain-reviewer` (every tier above TRIVIAL; outside the cap). A fresh dated review report in `docs/reviews/` is required by the hard rule on sensitive areas.

## 4. Measurements (read-only, scratchpad; this Windows 11 + Git Bash machine, non-elevated, 2026-10-05)

Method: for each distinct directory on the Windows PATH, create then delete a zero-byte probe file (write test, the only reliable ACL answer), plus `which -a` for the nine names.
- WRITABLE by the session user (7): `C:\Users\<user>\.local\bin`, `C:\Users\<user>\AppData\Roaming\npm`, `C:\Users\<user>\AppData\Local\Microsoft\WindowsApps`, `C:\Users\<user>\AppData\Local\Programs\Microsoft VS Code\bin`, `C:\Users\<user>\go\bin`, and the two `WinGet\Packages\...` directories (gitleaks, uv).
- MISSING but creatable by the session (2 entries): `C:\Users\<user>\bin` (it is PATH entry 0 AND entry 7, so the session can `mkdir` it and plant ahead of everything) and `C:\Program Files\Git\usr\local\bin` (under Program Files, not creatable non-elevated). Only the first is a live exposure; it is the sharpest finding: a "writable existing directories" list would miss it.
- READ-ONLY (15): everything under `C:\Program Files\...` (Git cmd/mingw64/usr/bin, nodejs, Docker resources\bin, GitHub CLI, Go, AWSCLIV2), `C:\WINDOWS`, `C:\WINDOWS\system32`, Wbem, OpenSSH, WindowsPowerShell.
- Where each name resolves today: `sh env ls cat head tail wc grep` -> `C:\Program Files\Git\usr\bin` (read-only; the Git Bash MSYS prefix `/usr/bin`); `kubectl` -> `C:\Program Files\Docker\Docker\resources\bin` (read-only). So today all nine resolve to trusted files and no shadow exists: criteria 1 holds on this machine with no PATH edit.
- Caveat: read-only here because the session is not elevated. In an elevated session Program Files is writable; the allowlist is a statement about the intended trust root, not a proof of ACLs. Recorded as residual (c) in section 5.
- Linux (not measured on this machine; stated from convention, to be confirmed by the CI Linux job): `/usr/bin /bin /usr/sbin /sbin /usr/local/bin /usr/local/sbin` are root-owned, not user-writable on a normal install; `~/.local/bin`, `~/bin`, `~/go/bin`, `~/.cargo/bin`, `~/.npm-global/bin`, `$VIRTUAL_ENV/bin` are user-writable.
- macOS (not measured): `/usr/bin /bin /usr/sbin /sbin` are SIP-protected; `/usr/local/bin` is root-owned on Apple-silicon systems but frequently user-owned on Intel Homebrew installs; `/opt/homebrew/bin` is user-owned by design. So Homebrew `kubectl` is demoted to untrusted by the POSIX owner/mode check (criterion 8) and denied. Honest consequence, listed in Q3.

## 5. Design

**Chosen: gate-side trust check, order-independent shadow scan.** A new pure module `bare-binary-trust.ts` (injected `fs`/env port, so unit tests need no real planting) exports `checkBareBinaries(names, ports) -> {ok:true} | {ok:false, reason}`. For each invoked name:
1. Build the trusted-directory set from the gate's own env without extra variables: Windows: `%SYSTEMROOT%`, `%SYSTEMROOT%\System32` (+ `Wbem`, `WindowsPowerShell\v1.0`, `OpenSSH` subfolders) and `<systemdrive>\Program Files`, `<systemdrive>\Program Files (x86)` subtrees, where the drive comes from `SYSTEMROOT` (the D launcher keeps `SYSTEMROOT` and `windir`, not `ProgramFiles`). POSIX: the six root-owned system directories above, each also required to pass the owner/mode check.
2. Walk the gate's PATH. A directory is "trusted" only if inside that set (after realpath); every other entry, including missing, relative, empty and `.`, is untrusted.
3. In every untrusted entry, `readdir` and look for the name (Windows: case-insensitive, with `.exe .cmd .bat .com .ps1` and extensionless variants; POSIX: exact). Any match is a deny (criterion 2). Missing directory = nothing to find (this is why `C:\Users\<user>\bin` does not block today); an unreadable existing directory is a deny (criterion 6).
4. Require at least one hit in a trusted directory, and that its realpath stays trusted (criteria 3, 7).

Why this is the narrowest fail-closed design:
- It denies only when a shadow actually exists or the trusted copy is absent. It does not require the human to edit PATH, and it works on this machine unchanged (measured above), where the stricter "every directory before the hit must be trusted" rule would deny all nine binaries because `C:\Users\<user>\bin` is first and missing but creatable.
- It is order-independent, so it does not depend on knowing the shell's real PATH order. That order is not observable from the gate: Git Bash prepends `/mingw64/bin:/usr/local/bin:/usr/bin:/bin` to the Windows PATH (visible in this session's `$PATH`), and the gate process sees the runtime's Windows-form PATH.
- It lives in the adapter layer: a new port on `decideToolCall` (`src/policy/gate/decide-tool-call.ts`) wired in `hooks/pretooluse-kernel-gate.mjs`; `kernel.ts` and the normalizer's decisions stay unchanged (zero-diff for kernel).

Wiring: the normalizer already knows which names it consumed. E0 and this story both edit `src/policy/normalizer/*`, so to avoid a merge fight this story adds ONLY one additive pure export in `shell.ts`, `invokedBareBinaries(command): readonly string[] | undefined` (undefined = could not determine, which denies), and starts building after E0 merges (dependency named: E0 first, because B must include E0's six). If the export cannot be made faithful to the resolver without re-parsing, the fallback is to put the names on a non-kernel side channel returned by `normalizeShell` (decided in S2, section 8) rather than parsing twice.

Residual risk, stated plainly (kept in the file header and the review hand-off): (a) time-of-check to time-of-use: a file planted between the scan and the shell's exec within one call, or by a concurrent process, is not caught; the Write-tool plant followed by the bare call, which is the Issue's scenario, IS caught because the scan runs at the second call. (b) the gate sees only its own PATH: a PATH extended by a shell profile or by the call itself (`PATH=~/x:$PATH kubectl ...`; the `PATH=` assignment prefix is a config lever tracked with #409) is out of scope here and must be confirmed denied by #409's test; this story adds a test that a call carrying a leading `PATH=` assignment is not resolved (pin, failing first if it is). (c) a session running elevated can write Program Files.

## 6. Rejected alternatives

- **Resolve first hit and require trusted dir only (no shadow scan).** Rejected: the shell's PATH order can differ from the gate's (Git Bash prepend), and a later plant in an earlier user directory silently wins. Fails criterion 2.
- **Strict prefix rule (every directory before the first hit must be trusted).** Rejected as the default: denies all nine binaries on this machine today because of the missing `C:\Users\<user>\bin`, forcing every user to edit PATH before the gate is usable. More secure only against a plant created between check and exec, which the scan cannot catch either way. Kept as a possible later strict mode (Q2).
- **Protect the PATH directories through the F protected list.** Rejected: the F list governs writes the gate sees; the Write tool is not routed through the gate (the Issue says so), the directories are outside the project, and `mkdir` of a missing directory is not an existing-file protection. It would also require gating every user-profile directory, a much larger policy surface than this fix.
- **Rewrite/pin the command to the resolved absolute path (`updatedInput`).** Rejected for now: no gate code uses `updatedInput` today (grep found none), so it is a new hook-output contract; F9 deliberately makes absolute paths unresolved, so the rewritten command would need a second grammar; nested wrapper strings (`sh -c '...'`) need rewriting at every layer; and the runtime's handling of a rewritten command under a deny-first gate is unmeasured. Strongest long-term fix (it also closes TOCTOU), logged as a follow-up Issue candidate, not built here (no gold-plating).
- **Write-probe each PATH directory for writability instead of an allowlist.** Rejected: a probe is a write from inside the gate (violates criterion 10), is wrong under ACL/elevation, and cannot see a creatable missing directory.
- **Scrub or set PATH in the D launcher.** Rejected as the fix: the launcher controls only the gate's own process env, not the shell that runs the allowed command. It stays relevant as input: the allow-listed `PATH` the gate sees is the runtime's.
- **Shrink B to remove `sh/env`.** Rejected: wrappers are already F9b-bare-only and the wrapper layer is needed by existing resolved shapes; removing them changes behavior beyond this issue.

## 7. Files to touch (this story, after E0 merges)

New: `src/policy/normalizer/bare-binary-trust.ts`, `src/policy/normalizer/bare-binary-trust.test.ts`, `hooks/pretooluse-kernel-gate-path-trust.test.ts`.
Edit: `src/policy/normalizer/shell.ts` (one additive export), `src/policy/gate/decide-tool-call.ts` (new optional-by-design but wired-required port; absent port = deny, fail closed), `hooks/pretooluse-kernel-gate.mjs` (supply the real fs port), `docs/decisions.md` (record the order-independent choice and the three residuals), CHANGELOG, `docs/STATE.md`, review report under `docs/reviews/`. Not touched: `kernel.ts`, `wrapper-catalog.ts`, `.github/*`.

## 8. Plan of work and tests (each criterion to a named failing-first test; first commit is these tests, RED)

Spike first (rule 17), before the design is final:
- S1: in a live hook invocation, log `process.env.PATH` as the gate sees it and `echo $PATH` from a Bash call in the same session. Decides whether the gate's PATH equals the shell's modulo the MSYS prefix. If the shell has user directories the gate does not, criterion 2 weakens; record and raise it as residual (b).
- S2: confirm `normalizeShell` can report invoked names without a second parse (decides the `invokedBareBinaries` seam).
- S3: confirm on Linux CI that `/usr/local/bin` passes the owner/mode check on the runner image.

| Criterion | Failing-first test (file::name) |
|---|---|
| 1 | `bare-binary-trust.test.ts::TRUST-1-trusted-system-hit-no-shadow-allows` (fake fs: trusted dir holds the name, user dir empty) |
| 2 | `::TRUST-2-shadow-in-untrusted-dir-denies-even-if-trusted-copy-earlier`; `::TRUST-2b-windows-case-and-extension-variants` (`KUBECTL.EXE`, `kubectl.cmd`) |
| 3 | `::TRUST-3-first-hit-untrusted-denies`; `::TRUST-3b-no-trusted-hit-denies` |
| 4 | `::TRUST-4-every-binary-in-closed-sets-covered`: iterates the exported `RESOLVABLE_BINARIES`, E0's set and the wrapper catalog binaries, asserts 2 and 3 for each; also asserts the enumeration is non-empty and equals the union (instrument, not prose) |
| 5 | `hooks/...-path-trust.test.ts::TRUST-5-wrapper-layers-each-checked` (plant `kubectl` only; plant `sh` only; plant `env` only) |
| 6 | `::TRUST-6a-unreadable-dir`, `6b-path-unset`, `6c-empty-entry`, `6d-dot-and-relative-entry`, `6e-readdir-throws` |
| 7 | `::TRUST-7-symlink-hit-realpath-outside-trusted-denies` (skipped-with-reason on Windows only if symlink creation is not permitted; a skip is reported as skipped, never passed) |
| 8 | `::TRUST-8-posix-group-writable-system-dir-demoted` (fake lstat) |
| 9 | `hooks/...-path-trust.test.ts::TRUST-9-existing-deny-reason-kept` and `TRUST-9b-deny-json-shape-unchanged` |
| 10 | `::TRUST-10-only-read-ports-used` (port exposes readdir/realpath/lstat only; the test fails if anything else is called) |
| 11 | `::TRUST-11-port-throws-denies` |
| 12 | `::TRUST-12-trusted-set-derived-from-systemroot-only` (env contains only `PATH`, `SYSTEMROOT`, `windir`) |
| 4/5 integration | `hooks/...-path-trust.test.ts::TRUST-13-real-plant-end-to-end`: temp dir prepended to the hook's PATH holds a file named `kubectl`; the hook run as a subprocess denies; removing it allows (real fs, real hook, temp dir only) |
| residual (b) pin | `::TRUST-14-leading-PATH-assignment-not-resolved` (red if the normalizer resolves it today) |

Verification plan also runs: `npm test` real counts, `npm run qa:gate-command-path`, QA-14 in CI diff mode (`reference-resolver.ts origin/master HEAD`), lint/typecheck, and the existing S7 probe suite untouched.
Rollout: ships with K or before it; the gate is unwired today (exposure 0%), so rollout risk is nil until K. Rollback: revert the commit; removing the port is fail-closed only if the port stays required, so rollback is a revert of the whole change, not a flag.

## 9. Interaction with E0

E0 adds `ls cat head tail wc grep` as resolvable. This story must cover them without a second edit to E0's set: criterion 4's test reads the exported sets, so when E0 lands its set is covered automatically and the test fails if E0 adds a name this check cannot see. Sequencing: E0 merges first (it edits `shell.ts` and the normalizer now); #428 builds on top and adds one export to `shell.ts`. If E0 slips, #428 can still ship for `kubectl` and the wrapper binaries and its test begins covering E0's names the moment E0 lands. All six E0 names resolve today to `C:\Program Files\Git\usr\bin` (read-only), so no PATH edit is needed for them. K must list #428 as a landed prerequisite beside E, F, J.

## 10. Sensitive areas touched

Policy enforcement / session gates (`hooks/pretooluse-kernel-gate.mjs`, `src/policy/gate/decide-tool-call.ts`): yes, named reviewer ceremony required. Guard/policy engine: the normalizer export touches `src/policy/normalizer/*` (not `src/policy/guard/*`). Evidence trail, secret scanning/CI, policy delivery, halt-state: no.

## 11. Test-first dispatch check

New or changed UI flow or API surface? No. The hook's stdin/stdout contract and the deny JSON shape are unchanged (criterion 9 pins this); the only external effect is that some Bash calls the gate used to allow are now denied. Same ruling as E0: `test-writer` is not dispatched; Ptah writes the tests above RED first and records it. The Manager may overrule; if so Ptah will not edit its files.

## 12. Blocking questions (none block the build start; recommended answers given because the human is away)

1. Shadow scan (order-independent) versus strict prefix rule as the default. Recommend: shadow scan, strict mode deferred.
2. Trusted set is a hard-coded allowlist (Windows system root, Program Files; POSIX system directories with owner/mode check). Recommend: yes, no user-extensible list in this story; extension would be policy delivery (a sensitive area) and needs its own story.
3. Homebrew/user-installed `kubectl` (macOS `/opt/homebrew/bin`, Linux `~/.local/bin`) is denied. Recommend: accept, document in the deny reason ("install into a system directory or ask for a trusted-directory story"); project is Windows-first and the exposure outweighs the convenience. Note this machine is unaffected (Docker's `Program Files` copy).
4. Build after E0 merges (shared `src/policy/normalizer/*`). Recommend: yes; planning and the S1-S3 spikes can run now.
5. Log pinning/`updatedInput` as a follow-up Issue (not built). Recommend: yes, Backlog, `sur` label.

RECEIPT: verdict=PLAN-READY criteria="12 mapped/12 total" checks="0/0/0 (plan only, nothing run beyond read-only measurements)" adr=HIT(38) pr=n/a
