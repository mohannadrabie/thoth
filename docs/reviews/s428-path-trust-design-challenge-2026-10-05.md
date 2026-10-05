# Design challenge — Issue #428: a bare allowed binary must not resolve to a planted file

Agent: design-challenger (Apep). Date: 2026-10-05. Artifact: `docs/plans/s428-path-planted-binary-plan-2026-10-05.md` (S7, CRITICAL, blocks #308 K). Round 1.

Verdict: **go** (design gate). The gate is UNWIRED today (plan §8: exposure 0% until K), so no finding has a live user entry point and no calibrated HIGH is possible. Findings route to named failing-first proof-tests the builder writes before the code. Boundary-crossing findings (they move a security-gate ALLOW) route to proof-tests, never the residual register.

Method: code-traced against the shipped normalizer/gate; measured on this Windows 11 + Git Bash machine (non-elevated) by simulating the hook-launched gate PATH vs a login-shell PATH, and by observing which planted-filename variants MSYS `bash` resolves for a bare command name. Read-only; scratch files under the session scratchpad, removed. No tracked file edited, no branch switch.

## Evidence captured (raw)

1. **Gate PATH vs shell PATH diverge (spike S1, the plan's own open question — answered: they differ).**
   - Hook-like invocation (`Git\bin\bash.exe -c 'sh launch-gate.sh <node probe>'`), env = runtime Windows PATH + SYSTEMROOT/windir only: the gate process sees **21** PATH entries — MSYS prepends `C:\Program Files\Git\mingw64\bin`, `...\usr\bin`, then `C:\Users\<user>\bin`, then the registry PATH (HKLM+HKCU expanded). `C:\Users\<user>\bin` IS present (index 2) even though absent from the registry PATH and not present on disk.
   - Login shell (`bash -l -c 'node probe'`, sources `/etc/profile` + `/etc/profile.d/env.sh`): **29** entries. `/etc/profile.d/env.sh` runs `export PATH="$HOME/bin:$PATH"`; the login shell additionally lists `C:\Program Files\Git\usr\local\bin` (`/usr/local/bin`), `...\usr\bin\vendor_perl`, `...\usr\bin\core_perl` that the non-login hook invocation did not all list.
   - Net: gate PATH and shell PATH are not identical. On this machine the divergent entries are either trusted (Git subtrees under Program Files) or already seen by the gate (`C:\Users\<user>\bin`), so it is safe here; the design cannot prove that generally.
2. **Which planted-file variants MSYS `bash` resolves for a BARE lowercase name** (probe name on PATH from an untrusted dir):
   - extensionless (with or without shebang): resolves and runs.
   - `name.exe`: resolves and runs. Uppercase `NAME.EXE` also resolves via the bare lowercase name (case-insensitive filesystem).
   - `name.lnk` (Windows shortcut, MSYS `lnk`-style symlink): **resolves and runs.**
   - `name.cmd`, `name.bat`, `name.com`, `name.ps1`: **not found** — MSYS `bash` ignores PATHEXT and does not run these for a bare name.
3. **Routing table** (`src/policy/gate/tool-routing.ts:42-56`): exactly two rows — `Bash` (exact) to `shell` normalizer; `mcp__*` (prefix) to `tool-class`. Any other `tool_name` to `unroutable-tool` deny (`decide-tool-call.ts:78-80`). **PowerShell is not routed today → denied (fail-closed).**
4. **`normalizeToolToken`** (`src/policy/normalizer/shell-scanner.ts:588`) strips a path prefix only on `/`, not `\`, and lowercases. A bare lowercase `kubectl` passes; `KUBECTL` lowercases to `kubectl` but the F9b raw-token-equality check (`shell.ts:493`) and F9 exact-set check (`shell.ts:364`, `RESOLVABLE_BINARIES` is lowercase-only) both reject it → deny. Uppercase/path-qualified command tokens are over-denied (fail-closed).

## Findings, ranked by blast radius (exposure × irreversibility × silence)

### A1 — the scan name-set omits `.lnk`; a planted `kubectl.lnk` in an untrusted PATH dir is a wrong-ALLOW
- Scenario: a session writes `C:\Users\<user>\bin\kubectl.lnk` (Write tool, not gate-routed) targeting an arbitrary binary, then issues bare `kubectl get pods/x --context=c`. The plan's design §5 step 3 scans each untrusted dir for `kubectl`, `kubectl.exe`, `.cmd/.bat/.com/.ps1`, extensionless — **no `.lnk`** — finds no shadow, allows. The shell resolves bare `kubectl` to the `.lnk` and runs the planted target under an allowed record. This is the Issue's exact plant-then-call scenario.
- Evidence: demonstrated — bash resolved and ran a bare name from a `.lnk` in an untrusted dir (Evidence 2). The `.cmd/.bat/.com/.ps1` in the plan's list are NOT bash-resolvable (harmless over-block); the one variant bash DOES resolve and the plan omits is `.lnk`.
- Compounding: criterion 7 (judge a hit by realpath) does not rescue this — a `.lnk` is a plain file to `lstat`/`realpath`, not a reparse point, so realpath does not follow it; the file must be treated as a shadow by presence of the `.lnk` name, not by resolving it.
- Exposure: unbounded of future allowed Bash calls once K wires the gate; basis: counted in code (the step-3 variant list is closed and omits `.lnk`). Zero today (gate unwired).
- Current defense: none for `.lnk`; the closed variant list is the whole defense and it is incomplete.
- Tags: severity MED / evidence demonstrated / reach instrument (gate unwired; becomes user at K) / likelihood routine / undo irreversible.
- Verdict: **BREAKS** (design). Boundary-crossing → proof-test.
- Proof-test (write RED first): `src/policy/normalizer/bare-binary-trust.test.ts::TRUST-2c-lnk-shadow-in-untrusted-dir-denies` — fake fs: untrusted dir holds `kubectl.lnk`, trusted dir holds `kubectl`; `checkBareBinaries(["kubectl"])` returns `{ok:false}` naming the dir and the `.lnk`. Plus hook integration `hooks/pretooluse-kernel-gate-path-trust.test.ts::TRUST-13b-real-lnk-plant-end-to-end` — real temp dir prepended to the hook PATH holds `kubectl.lnk`; hook subprocess denies; removing it allows. Derive the scan name-set from the interpreter's real resolution behaviour (bash: extensionless, `.exe`, `.lnk`), not a hand-typed list (CLAUDE.md completeness rule).

### A2 — the order-independent scan is sound only over the gate's PATH; the shell searches dirs the gate's PATH may not contain
- Scenario: the shell resolves against its own (login) PATH. If the shell searches an untrusted directory the gate's PATH does not list, the gate never scans it, so a plant there is a wrong-ALLOW. The shadow scan is order-independent (good) but its universe is the gate's PATH entries only.
- Evidence: demonstrated divergence (Evidence 1): the login shell has `/usr/local/bin`, `vendor_perl`, `core_perl`, and an `/etc/profile.d/env.sh` `$HOME/bin` prepend; the hook entry set is not identical. The *unsafe* case (a divergent entry that is untrusted) is derived — on this machine all divergent entries are trusted or already-seen, so it is safe here.
- Exposure: unbounded in principle, 0% on this machine; basis: measured divergence + derived unsafe case.
- Current defense: plan residual (b) acknowledges it and defers closure to #409; §5 bullet 2 notes the gate sees the runtime Windows-form PATH.
- Tags: severity MED / evidence demonstrated (divergence) + derived (unsafe case) / reach instrument / likelihood plausible / undo irreversible.
- Verdict: **UNPROVEN**. Boundary-crossing → proof-test (upgraded from the plan's residual-register placement to a mandatory proof-test).
- Proof-test: `hooks/pretooluse-kernel-gate-path-trust.test.ts::TRUST-15-gate-path-covers-shell-untrusted-dirs` — live spike capturing the gate's `process.env.PATH` and the shell's `echo $PATH` in one session, normalizing both to Windows form, asserting every untrusted entry the shell searches is in the gate's scanned set (red until S1 is resolved; if it cannot hold, widen the deny set or land #409 first).

### A3 — PowerShell is a forward seam: denied today, but K intends to route it and the trust check keys off the Bash normalizer
- Scenario: today PowerShell to `unroutable-tool` deny (Evidence 3), so no PATH-trust coverage needed. K's proposed matcher is `Bash|PowerShell|mcp__.*` (STATE.md J row). PowerShell honours PATHEXT (`.cmd/.bat/.ps1/.com` resolve for a bare name — unlike bash), so if a later story routes PowerShell to a shell-like normalizer, `invokedBareBinaries` (Bash-specific) and the `.lnk`-vs-PATHEXT variant set would not match PowerShell's resolution semantics.
- Evidence: code-traced (routing table is two rows; PowerShell absent).
- Exposure: 0% today; basis: counted in code.
- Current defense: fail-closed deny of PowerShell today; the plan is silent on PowerShell.
- Tags: severity MED / evidence code-traced (today) + derived (forward) / reach instrument / likelihood plausible / undo irreversible.
- Verdict: **UNPROVEN** (forward). Boundary-crossing → proof-test.
- Proof-test: `src/policy/gate/tool-routing.test.ts::TRUST-16-powershell-unroutable-until-covered` — assert `routeToolName("PowerShell") === undefined` (deny), with a comment binding any future PowerShell routing to a story that re-derives the variant set for PowerShell's PATHEXT resolution. PASS today; a regression pin so K cannot silently route PowerShell past this check.

### A4 — leading `PATH=`/`env VAR=` assignment prefix — SURVIVES
- Code-traced: the `env` wrapper entry (`wrapper-catalog.ts:100`) shape-mismatches on a token containing `=` → unresolved → deny. A bare `PATH=x` as `tokens[0]` lowercases to `path=x`, not in `RESOLVABLE_BINARIES`, not a wrapper name → `BINARY_NOT_RECOGNIZED` → deny. Keep the plan's `TRUST-14-leading-PATH-assignment-not-resolved` pin.
- Tags: severity LOW / evidence code-traced / reach instrument / likelihood plausible / undo reversible.

### A5 — missing-but-creatable `C:\Users\<user>\bin` + order-independent scan — SURVIVES
- Code-traced + measured: the directory is absent today, so "nothing to find" → allow; it IS in the gate's PATH (Evidence 1 index 2), so a future plant lands in a directory the gate already scans → deny. The order-independent design handles the "entry 0 AND entry 7, creatable" case the plan flagged in §4.
- Tags: severity LOW / evidence code-traced / reach instrument / likelihood routine / undo n/a.

### A6 — per-call scan cost unmeasured — SURVIVES (with unrun verification)
- Derived LOW. Only untrusted user dirs are `readdir`'d (small, ~7 here); trusted system dirs are stat-probed for the one name per §5 step 4, not enumerated, so cost is bounded. Not measured; the plan's spikes include no timing spike against the J6 allow-path budget.
- Exposure: assumption → caps LOW.

### A7 — trusted set is an allowlist, not an ACL check (Windows); elevated session writes Program Files — SURVIVES (acknowledged residual)
- Derived LOW, the plan's residual (c), stated honestly. The Windows trusted set trusts Program Files/System32 by path, not by verifying the ACL; an elevated session can write there. Out of scope for a non-elevated threat model.

## Frozen set (proven safe this round)
- A4 (`PATH=`/`env VAR=` prefix fail-closed) — code-traced.
- A5 (missing-but-creatable dir + order-independent scan) — code-traced + measured.
- Uppercase / path-qualified command tokens over-denied via F9/F9b exact-lowercase set — code-traced.
- PowerShell denied today via the two-row routing table — code-traced.

## Residual-risk register (accepted, monitored)
- A6: scan cost per allowed Bash call — trigger: allow-path latency regresses past the J6 budget once K wires the gate. Monitored by the timing assertion below.
- A7: elevated session / allowlist-not-ACL — trigger: a session runs elevated. Documented; no code closes it.

## Unrun verifications (command + owner)
- S1 (A2): capture gate `process.env.PATH` and shell `echo $PATH` in one live hook invocation; assert gate scan-set ⊇ shell untrusted entries. Owner: story-implementer, before design is final. Encoded as TRUST-15.
- Timing (A6): re-run `npm run qa:gate-command-path` / the J6 allow-path timing with the trust check wired; assert within budget. Owner: builder at K-wiring.
- S3: confirm on Linux CI that `/usr/local/bin` passes the owner/mode check on the runner image (not reproducible on this Windows machine). Owner: CI Linux job.

## Editorial (uncounted, verdict-neutral)
- §5 step 3 and criterion 2b list `.cmd .bat .com .ps1` as bash-relevant shadow extensions; measured, bash does not resolve these for a bare name (harmless over-block). The load-bearing omission is `.lnk` (A1). Recommend the builder derive the scan name-set from the interpreter, documenting bash = {extensionless, `.exe`, `.lnk`} and reserving PATHEXT extensions for a PowerShell story (A3).

## Scariest unproven assumption
The gate validates trust against the PATH *it* sees, but the shell resolves the command against the PATH *it* sees, and nothing in the design guarantees the shell's untrusted search set is a subset of what the gate scans (A2). On this machine they happen to align safely; the design offers no proof they always will, and the one measured divergence (`/etc/profile.d/env.sh`, MSYS `/usr/local/bin`) is real. Settle it with the TRUST-15 live spike before K wires the gate.
