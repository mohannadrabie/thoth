# #308 story D (AP-13 launcher): pre-build design challenge, round 1

[design-challenger] Design Challenger (Apep). Target: `docs/plans/s308-D-launcher-plan-2026-10-02.md` (POSIX `sh` shim `hooks/launch-gate.sh`, run as `sh "<shim>" "<gate>"`). Tier CRITICAL. Round 1 on this artifact. Branch `s308/activation-2` at `1d0576b`.

📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog — ≈18800 tokens saved this pass (fp 702b16a) [CACHE=HIT]

Manager rulings taken as given (not attacked): Git Bash is a hard Windows precondition, checked by the pre-flight. A bad SYSTEMROOT blocks (no repair). Hangs go to story J (runtime timeout 60). Paid live run S9 is deferred to J. No test-writer.

## Method and evidence base

- The shim does not exist yet. I rebuilt it in a scratch folder from plan section 4, steps 1 to 6: file check; SYSTEMROOT guard; `env -i PATH SYSTEMROOT windir CLAUDE_PROJECT_DIR node "$1"`; a `case` that passes 0 and 2 and maps everything else to 2 with one `echo` to stderr. Scratch files were removed after the run.
- Two harnesses:
  - `inner.mjs` spawns `C:/Program Files/Git/usr/bin/sh.exe <shim> <stub>` directly. This is the shim alone, as an exec-form runtime would start it.
  - `outer.mjs` spawns `C:/Program Files/Git/bin/bash.exe -c 'sh "<shim>" "<stub>"'`. This simulates the runtime's shell-form hook spawn, with the inherited env plus extra keys standing in for a settings `env` block.
- Stubs are one-line `.mjs` files: `process.exit(N)`, self-kill, abort, throw, stdin echo.
- Host: Windows 11, Git Bash `GNU bash 5.3.9(1)-release (x86_64-pc-cygwin)`, Node v24.15.0, Claude Code runtime binary 2.1.285 (VS Code extension; B4 measured 2.1.267).
- Runtime behavior was read from strings in `C:\Users\mohan\.vscode\extensions\anthropic.claude-code-2.1.285-win32-x64\resources\native-binary\claude.exe` with `grep -a`. I label this code-traced on the runtime; none of it was demonstrated live.
- What none of this proves: whether a settings `env` block forwards the special keys below to the hook spawn. B4 proved that an arbitrary key (`SPIKE_ENV_PROBE`) and `NODE_OPTIONS` reach a node hook through the runtime's shell. It did not test `SHELLOPTS`, `BASH_FUNC_*%%`, `MSYS` or `CLAUDE_CODE_*`.
- Live exposure today is 0%. `.claude/settings.json` has no hooks wired; story J wires them. So no finding can have `reach=user` with an entry point, and none is HIGH.

## Attacks, ranked by blast radius (exposure x irreversibility x silence)

### 1. Shell-level env values fail the gate open, through the shim and before its first line. BREAKS

- **Attack.** The design assumes the env attack class is "node start-up flags", so scrubbing node's env closes it. Two shells run before node, and both read the environment: the runtime's outer `bash -c` and the shim's own `sh` (which is bash in POSIX mode).
- **Scenario.** The writer the design defends against (B4b: a project settings `env` block) sets one key. The hook runs. The shim, or the shell that launches it, exits 0 or 1, and the runtime runs the tool call. In most cases the runtime prints no hook error.
- **Evidence (demonstrated).** Stub child exits 1 in every row, so a correct launcher must return 2.

  Shim alone (`node inner.mjs`):
  ```text
  baseline               status=2 stderr="launcher: child exit 1 mapped to 2\n"
  BASH_ENV_exit0         status=2
  ENV_exit0              status=2
  SHELLOPTS_noexec       status=0 stderr=""
  SHELLOPTS_errexit      status=1 stderr=""
  SHELLOPTS_nounset      status=1 stderr="...launch-gate.sh: line 6: windir: unbound variab"
  BASH_FUNC_env          status=0 stderr=""
  BASH_FUNC_echo         status=0 stderr=""
  BASH_FUNC_exit         status=2
  BASH_FUNC_[            status=2
  MSYS_noglob            status=2
  MSYS_winsym            status=2
  MSYS2_ARG_CONV_EXCL    status=2
  PATH_fakenode          status=0 stderr=""
  ```

  Runtime-shaped outer `bash.exe -c` (`node outer.mjs`):
  ```text
  baseline               status=2
  NODE_OPTIONS_bad       status=2        <- the class the design targets: closed
  BASH_ENV_exit0         status=0 stderr=""
  BASH_ENV_missing       status=2
  ENV_exit0              status=2
  SHELLOPTS_noexec       status=0 stderr=""
  SHELLOPTS_errexit      status=1 stderr=""
  BASHOPTS_bogus         status=2
  BASH_FUNC_sh           status=0 stderr=""
  BASH_FUNC_env          status=0 stderr=""
  BASH_FUNC_node         status=2
  PATH_fakesh            status=2        <- Git\bin\bash.exe puts /usr/bin first; sh hijack defeated
  MSYS=noglob            status=127 stderr="sh: <shim> <gate>..."   (the command line is not split)
  MSYS=winsymlinks / enable_pcon, CYGWIN, POSIXLY_CORRECT, IFS=/, PS4+xtrace, SYSTEMROOT bad: status=2
  ```

  `SHELLOPTS=noexec`, `SHELLOPTS=errexit`, `BASH_FUNC_env%%`, `BASH_FUNC_echo%%`, `BASH_FUNC_sh%%` and `MSYS=noglob` each need one env key and no file write. `BASH_FUNC_echo%%` takes over the `echo` in the mapping branch, so the shim exits 0 before it reaches `exit 2`. `BASH_ENV` and the PATH `node` hijack also need a planted file. The plan discloses the PATH `node` hijack as routed to story F; the rest are undisclosed.
- **Exposure:** about 0% of live runs today (unwired, counted in code: `.claude/settings.json` hooks object). Once J wires the hook: 8 of the 22 shell-level key/value pairs I tried fail open (7 need only the env key, `BASH_ENV` also needs a file), while the 1 targeted `NODE_OPTIONS` case blocks (basis: measured locally). The share of real sessions that carry such a key is unbounded until the runtime-forwarding verification U1 runs.
- **Current defense:** none in the design. Plan section 4 says "using shell builtins only until `env` runs", but `env` and `echo` are not builtins that override functions, and the shell imports `SHELLOPTS` before line 1. The outer shell is outside anything the shim file can control.
- **Tags:** severity MED / evidence demonstrated / reach operator (the env block is written by whoever can write settings files, the same writer as B4b; no user entry point until J) / likelihood plausible (it is the design's own threat model) / undo reversible but silent, so it keeps severity. **Boundary-crossing:** the security gate is bypassed, so this routes to a proof-test, never to the residual register.
- **Verdict: BREAKS** the design's stated goal (section 2: "an attacker-controlled environment cannot make fail before our code runs"). It also makes the D3 flip of `node-options-bad-flag` to BLOCKS an overclaim: the env-block class stays open through sibling keys. Issue #398.
- **Proof-test (write first, red today):** `D2-env-shell-levers-block`. For each key in {`SHELLOPTS=noexec`, `SHELLOPTS=errexit`, `SHELLOPTS=nounset`, `BASHOPTS=<bogus>`, `BASH_ENV=<file containing exit 0>`, `ENV=<same>`, `BASH_FUNC_env%%`, `BASH_FUNC_echo%%`, `BASH_FUNC_node%%`, `BASH_FUNC_sh%%`, `BASH_FUNC_exit%%`, `MSYS=noglob`, `POSIXLY_CORRECT=1`}, spawn the launcher exactly as J will wire it, including the runtime's outer shell if the shell form is kept (`C:/Program Files/Git/bin/bash.exe -c '<J command string>'` on win32, `/bin/sh -c` on POSIX). Use a stub child that exits 1. Assert `status === 2` for every key. Red against the plan as written: noexec 0, errexit 1, `BASH_FUNC_env`/`echo`/`sh` 0, `BASH_ENV` 0, `MSYS=noglob` 127.
- **Routing:** **architecture-reviewer (rule 15).** Closing the outer-shell half needs a choice of launch topology, not a line in the shim. The 2.1.285 runtime has an exec-form hook field `args` ("`command` is resolved as an executable and spawned directly with these arguments, no shell"). The plan does not mention it, and nobody has measured it. I name it as a fact for the architect, not as a recommendation.

### 2. Runtime-level env keys wrap or redirect the hook shell. UNPROVEN-pending-verification

- **Attack.** The runtime reads its own env to decide how to run a hook command. If a settings `env` block feeds the runtime's own process env, these keys act before the shim exists as a process.
- **Evidence (code-traced, runtime binary 2.1.285; strings found with `grep -a`):**
  - `function m1(){return Ta()?"bash":"powershell"}` and `function Ta(){if(M()!=="windows")return!0;return IK()!==null}`. The default hook shell is bash when Git Bash is found, else PowerShell. cmd.exe is never used.
  - The Git Bash path comes from `a.CLAUDE_CODE_GIT_BASH_PATH`, which is accepted if its basename is `bash.exe`/`sh.exe`/`bash`/`sh` and the file exists. Otherwise it falls back to `C:\Program Files\Git\bin\bash.exe`, and so on.
  - `" would run wrapped in your CLAUDE_CODE_SHELL_PREFIX"` appears in the hook-forwarding text, and a non-`args` hook command has the `shell_prefix` reason. Hook commands in the shell form are wrapped by `CLAUDE_CODE_SHELL_PREFIX`.
  - The schema for `shell` says "'bash' uses your $SHELL (bash/zsh/sh)".
- **Scenario if forwarded:** `CLAUDE_CODE_SHELL_PREFIX=true` (or any wrapper that exits 0) turns the hook into `true sh "<shim>" "<gate>"`, which exits 0. `CLAUDE_CODE_GIT_BASH_PATH=<planted bash.exe>` swaps the outer shell.
- **Exposure:** unbounded until U1 runs; 0% live today.
- **Tags:** MED / code-traced / operator / plausible / reversible but silent. Boundary-crossing.
- **Verdict: UNPROVEN-pending-verification.** Settle with U1 (below).
- **Proof-test:** `J-env-block-runtime-keys-block`. This is a live harness row (story B harness), run at J. With a project settings `env` block of `{"CLAUDE_CODE_SHELL_PREFIX": "true"}`, then separately `{"SHELLOPTS": "noexec"}` and `{"BASH_FUNC_echo%%": "() { exit 0; }"}`, and the launcher wired in front of a stub that exits 1: assert `hook_response.exit_code === 2` and `tool_result.is_error === true` for each.

### 3. An empty or truncated shim exits 0 silently. BREAKS

- **Attack.** The design assumes the launcher file is intact. It flips `hook-script-unparseable` to BLOCKS for the gate, but adds a new script in the path whose own corruption is not mapped.
- **Evidence (demonstrated).** Line-prefix sweep of the 12-line reconstruction, stub child exits 1:
  ```text
  lines=0..5/12 rc=0     (6 cases, no stderr)
  lines=6/12   rc=1
  lines=7/12   rc=0
  lines=8..11  rc=2      (bash "syntax error: unexpected end of file", which happens to be exit 2)
  lines=12/12  rc=2
  empty-shim rc=0   truncated-shim(100 bytes) rc=0   missing-shim rc=127
  ```
  8 of 13 line-boundary truncations exit non-2. 7 of those exit 0 with nothing on stderr, which is quieter than today's unparseable gate (node exit 1 with a visible SyntaxError).
- **Exposure:** 0% live today. After J, it applies to any run where the shim is empty, truncated or missing. Basis: counted on the reconstruction (8 of 13 truncation points). How often a shim is corrupted is unknown.
- **Current defense:** D4 (`qa:gate-command-path`) catches a missing shim in CI only, not at runtime and not a truncated file. Story F deny rules cover tampering by the session, not a bad merge or edit. D5 discloses tampered in-graph modules (X-8) but does not name the launcher itself.
- **Tags:** MED / demonstrated / operator / operator-error (bad merge or edit, or a write that F's deny list misses) / reversible (`git checkout`) but silent, so it keeps severity. Boundary-crossing.
- **Verdict: BREAKS** the restatement's "make every launch failure after that exit 2". Issue #399.
- **Proof-tests:**
  - `D2-shim-truncation-sweep`: for every line prefix 0..n of `hooks/launch-gate.sh` and the empty file, run it with a stub child that exits 1, and assert either `status === 2` or that a named repo check (to be chosen by the architect) fails on that file content. Red today for prefixes 0 to 7.
  - `D5-header-names-launcher`: the D5 disclosure grep also requires a sentence that an empty or truncated launcher exits 0.
- **Routing:** the shape of any self-integrity mechanism goes to **architecture-reviewer**.

### 4. The SYSTEMROOT guard checks that a directory exists, not which directory it is. UNPROVEN (duplicate of #397)

- **Evidence.**
  - Code-traced: `src/policy/config/central-source.ts:108` builds `${systemRoot}\System32\reg.exe` from `env.SystemRoot || env.windir`, and the shim passes `SYSTEMROOT` and `windir` through by design.
  - Code-traced: the plan's guard, section 4 step 2, is `[ -d "$SYSTEMROOT/System32" ]`.
  - Demonstrated: an empty decoy `decoy/System32` passes the guard, then node aborts at start-up (`Assertion failed: ncrypto::CSPRNG`, exit 134, mapped to 2). The empty decoy therefore fails closed.
  - A decoy holding the DLLs node needs at start-up plus a planted `reg.exe` is unmeasured.
- **Tags:** MED / code-traced / operator / plausible / silent. Boundary-crossing.
- **Verdict: UNPROVEN.** Already filed as #397 (cross-domain, story B). I commented the decoy measurement there and did not file a duplicate.
- **Proof-test:** `D2-systemroot-decoy`. With `SYSTEMROOT` set to a temp directory containing `System32/` plus copies of the DLLs node needs at start-up and a stub `reg.exe` that writes a marker file, run the shim with the real gate. Assert that the marker file was not written, or that the status is 2.
- **Routing:** gate/central-source shape, #397's owner (story F or J). Not D-blocking.

### 5. Exit-status truncation (256 becomes 0). SURVIVES (disclosed)

- Demonstrated: child 256 gives shim 0, 512 gives 0, 65536 gives 0, 258 gives 2.
- Code-traced: the gate exits only through `process.exit(2)` (`hooks/pretooluse-kernel-gate.mjs:129`) and `process.exit(output.exitCode)` (`:209`), where `exitCode: 0 | 2` (`src/policy/gate/render-hook-output.ts:40`).
- With the env scrubbed, the payload has no path to choose the exit code. The crashes observed here map to 1 and 134.
- Plan test `D2-disclosed-limit-256` already records the limit. No attacker trigger found.

### 6. PATH hijack of `sh` through the runtime's shell. SURVIVES

- Demonstrated: `PATH_fakesh status=2`. `C:\Program Files\Git\bin\bash.exe` prepends `/usr/bin`, so a planted `sh` earlier on the Windows PATH is not reached.
- PATH hijack of `node` does fail open (`PATH_fakenode status=0`). The plan already discloses it and routes it to story F.

### 7. Signal-killed or crashing child. SURVIVES

- Demonstrated: self-SIGKILL gives child 1, then 2. Self-SIGTERM gives 1, then 2. `process.abort()` gives 134, then 2. An uncaught throw gives 1, then 2.

### 8. Stdin passthrough edge cases. SURVIVES

- Demonstrated: byte-identical echo through the shim for a 5,242,880-byte payload, CRLF text, all 256 byte values, UTF-8 with astral characters, and empty input. All exit 0.

### 9. Shim with CRLF line endings. SURVIVES (on this Git Bash)

- Demonstrated: a CRLF copy maps child 0, 1, 2 to 0, 2, 2 under Git Bash 5.3.9. Git's bash tolerates CR here.
- `.gitattributes:10` (`* text=auto eol=lf`) keeps the committed file LF.
- On Linux a CRLF shim would fail, so the plan's `D2-lf-only` byte test is the right guard there. Behavior tests on Windows would not catch a CRLF shim.

### 10. The shim's own parse failure. SURVIVES (incidentally)

- Demonstrated: an unterminated `if` or `case` gives exit 2 (bash returns 2 for a syntax error). This blocks by accident, not by design.
- Truncation that still parses is attack 3.

### 11. `env -i` on Git Bash, and the real gate on a minimal env. SURVIVES

- `/usr/bin/env.exe` exists.
- Demonstrated: for four payloads (Bash `echo`, Bash `kubectl`, Read, an unclassified MCP tool), the real gate run directly and run through the shim gave the same exit status (0) and byte-identical stdout and stderr.
- TEMP, USERPROFILE and APPDATA are absent and nothing in this run needed them. The plan's S6 still owns the full payload set.

### 12. Latency. SURVIVES

- Measured, 20 runs each, payload that gets denied:

  | Path | Median | Max |
  |---|---|---|
  | Direct | 162 ms | 209 ms |
  | Shim | 194 ms | 238 ms |
  | Outer bash + shim | 242 ms | 272 ms |
  | Outer bash + node (today's form) | 212 ms | 255 ms |

- The shim adds about 30 ms at the median. The ceiling is `OPS03_CEILING_MS = 2000` (`src/qa/gate-latency-budget-check.ts:62`).

### 13. Which shell runs the hook command on Windows. SURVIVES (for the "cmd.exe or PowerShell?" question)

- Code-traced from the runtime binary: hooks default to bash when Git Bash is detected (`m1`, `Ta`), otherwise PowerShell. cmd.exe is not used.
- With Git Bash as a ruled precondition, the PowerShell branch is frozen by the Manager ruling.
- What is still open is not which shell runs, but which env that shell inherits (attacks 1 and 2).

## Frozen set (round 1; re-open only with new evidence)

- Attack 5: exit truncation is disclosed; the gate exits only 0 or 2 (code-traced).
- Attack 6: `sh` PATH hijack is defeated by the Git `bin` wrapper (demonstrated).
- Attack 7: signals, abort and throw map to 2 (demonstrated).
- Attack 8: stdin passthrough is byte-identical, including 5 MB (demonstrated).
- Attack 9: CRLF tolerated by Git Bash 5.3.9; `.gitattributes` LF (demonstrated).
- Attack 10: a syntax error exits 2 (demonstrated).
- Attack 11: `env -i` exists; the real gate is identical on the minimal env for 4 payloads (demonstrated).
- Attack 12: latency +30 ms median against a 2000 ms ceiling (measured).
- Attack 13: the runtime default shell on Windows is Git Bash's bash, never cmd.exe (code-traced).
- `NODE_OPTIONS=--bogus` through the shim, outer shell included, gives 2 (demonstrated). The targeted class closes.

## Residual-risk register

- None. Every surviving MED crosses a security boundary, so each one routes to a named proof-test, not to this register.

## Unrun verifications

| # | What | Command or shape | Owner |
|---|---|---|---|
| U1 | Does a settings `env` block forward `SHELLOPTS`, `BASH_FUNC_echo%%`, `MSYS`, `BASH_ENV`, `CLAUDE_CODE_SHELL_PREFIX` and `CLAUDE_CODE_GIT_BASH_PATH` to the hook spawn or to the runtime's own env? | Story B harness: one profile per key, `env` block = `{<key>: <value>}`, hook = launcher + stub that exits 1, `--setting-sources project`. Read `hook_response.exit_code` and `tool_result.is_error`. One haiku call per key. | J (paid; deferred by Manager ruling). A no-cost variant would run a SessionStart hook under a deliberately invalid API key. Manager decides whether that counts as "no paid session". |
| U2 | S9: which shell the runtime used for the command string | Plan section 8, S9 | J |
| U3 | Plan spikes S1 to S8 before any launcher code | Plan section 8. This report already answers S5 in part (truncation table), S6 for 4 payloads, and S8 (latency). | Builder (story-implementer) |
| U4 | A populated SYSTEMROOT decoy | `D2-systemroot-decoy` above | #397 owner |
| U5 | The exec-form `args` hook in the runtime binary: does it remove the outer shell's env exposure, and how does it resolve `command` (PATH or absolute)? | Local read of the runtime schema, then the U1 harness with `args` | architecture-reviewer, then J |

## Editorial (uncounted, verdict-neutral)

- Plan section 2 restatement: "the first process the runtime starts for the gate hook" is the runtime's outer shell (and any `CLAUDE_CODE_SHELL_PREFIX` wrapper), not `sh`. The sentence overstates what the shim controls.
- Plan section 4, "using shell builtins only until `env` runs": `env` is not a builtin, and both `env` and `echo` resolve through imported functions.
- Plan header ADR-cache fingerprint `d37bef7` is stale; the current fingerprint is `702b16a`.
- Plan section 4, Option A point 3 ("runnable on Linux/macOS CI"): CR tolerance differs between Git Bash and Linux. Behavior tests on Windows will not catch a CRLF shim; only `D2-lf-only` does.

## Scariest unproven assumption

That the env a settings `env` block can set stops at the shim's child. The runtime's own `bash -c` and the `sh` that reads the shim both inherit the env. If the runtime forwards a key like `SHELLOPTS`, `BASH_FUNC_echo%%` or `CLAUDE_CODE_SHELL_PREFIX`, the env can break the launch before any line of the shim decides anything. Nobody has measured whether it does, and nobody has measured whether the exec-form `args` field would remove that exposure.

## Verdict

**go.**

- No calibrated HIGH: nothing is wired, so there is no user entry point, and the shim is not built yet.
- 2 MED BREAKS (#398, #399) and 2 MED UNPROVEN (one is #397), all boundary-crossing. Each routes to a named day-1 failing proof-test: `D2-env-shell-levers-block`, `J-env-block-runtime-keys-block`, `D2-shim-truncation-sweep` with `D5-header-names-launcher`, and `D2-systemroot-decoy`.
- The design as written cannot turn `D2-env-shell-levers-block` green, because its outer-shell half is outside the shim file. The launch-topology question goes to architecture-reviewer before Phase 2 code.
- The D3 flip of `node-options-bad-flag` to BLOCKS must not be recorded as closing the env-block class until that test is green.

```text
RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated/operator/plausible/reversible-silent][0% live; 8 of 22 shell-level env values tried fail open, measured] One settings-env key (SHELLOPTS=noexec gives 0, errexit gives 1, BASH_FUNC_env/echo/sh%% give 0, MSYS=noglob gives 127, BASH_ENV file gives 0) fails the gate open through the shim or its outer bash; the design has no defense and its D3 NODE_OPTIONS flip overclaims (#398)
2. [SUSPICION][MED][code-traced/operator/plausible/reversible-silent][unbounded until U1] The runtime wraps shell-form hooks in CLAUDE_CODE_SHELL_PREFIX and picks bash from CLAUDE_CODE_GIT_BASH_PATH; if a settings env block reaches the runtime's own env, this fails open before the shim runs
3. [ISSUE][MED][demonstrated/operator/operator-error/reversible-silent][8 of 13 truncation points, counted] An empty or truncated launch-gate.sh exits 0 with no stderr (missing gives 127); D4 catches only a missing shim, and only in CI (#399)
4. [SUSPICION][MED][code-traced/operator/plausible/silent][unmeasured] The SYSTEMROOT guard checks existence, not identity; central-source.ts:108 runs <SystemRoot>\System32\reg.exe; an empty decoy fails closed (node 134), a populated decoy is unmeasured (#397, commented)
5. [CLEAN] Exit 256 or 512 truncates to 0: disclosed; the gate exits only 0 or 2 (code-traced), so no attacker trigger
6. [CLEAN] PATH hijack of sh is defeated by Git\bin\bash.exe putting /usr/bin first (demonstrated; the node PATH hijack is disclosed and routed to F)
7. [CLEAN] Self-SIGKILL, SIGTERM, abort and throw children all map to 2 (demonstrated)
8. [CLEAN] Stdin passthrough is byte-identical for 5 MB, CRLF, all 256 byte values, UTF-8 and empty input (demonstrated)
9. [CLEAN] A CRLF shim still maps correctly under Git Bash 5.3.9; .gitattributes forces LF; D2-lf-only covers Linux (demonstrated)
10. [CLEAN] A shim syntax error exits 2 (demonstrated; blocks by accident, not by design)
11. [CLEAN] env -i exists; the real gate gives identical exit, stdout and stderr on the minimal env for 4 payloads (demonstrated)
12. [CLEAN] Latency +30 ms median (194 vs 162 ms; max 238) against a 2000 ms ceiling (measured)
13. [CLEAN] On Windows the runtime runs hook commands with Git Bash's bash when present, else PowerShell, never cmd.exe; the PowerShell branch is frozen by ruling (code-traced)
counts: issues=2 suspicions=2 clean=9
evidence: demonstrated=9 code-traced=4 derived=0
round=1 roundsSinceLastGo=0 frozen=10 residuals=0 unrun=5 editorial=4
checks=local experiments: shim-alone matrix 14 rows (6 non-2), outer-shell matrix 19 rows (6 non-2), truncation sweep 13 rows (8 non-2), exit table 11 rows (3 truncated to 0), signals 4/4 mapped, stdin 5/5 identical, real gate 4/4 identical, latency 4x20 runs; no repo tests run
adr=HIT(38)
report=docs/reviews/s308-D-launcher-design-challenge-2026-10-02.md
```
