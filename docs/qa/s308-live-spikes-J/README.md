# Story J evidence: gate wired in a scratch project (2026-10-05)

- Scope: #308 story J (J1 to J9). Nothing here wires the real `.claude/settings.json` or any user settings.
- Method: story B harness (`../s308-live-spikes/harness/`), copied and extended in `harness/`. Each run is `claude -p` (Claude Code 2.1.267, model alias haiku, Windows 11, Git Bash) in a scratch project outside this repo, with its own `.claude/settings.json` wiring the gate at this repo's absolute paths.
- Rules at HEAD 4ad9f87 (E and F shipped locally, held behind THOTH-ADR-0003).
- Spend: USD 0.9857 over 39 live calls; hard cap USD 1.50 (`ledger.txt`). Paths, ids, host and user names are scrubbed by `docs/qa/s308-live-spikes-J/harness/scrub-j.mjs`; a run that printed a full environment is omitted from J8.txt.
- Hook attribution was by content (the hook's stderr text, its exit code, and the logger's own log file), not by the order of events in the stream: both hooks of a pair can finish in either order, and two identical empty responses cannot be told apart.

## Outcomes by item

| Item | File | Outcome |
|---|---|---|
| J1 | `docs/plans/s308-K-proposed-entry-2026-10-05.md` | Entry text recorded, two forms. Not in settings. |
| J2 | `J2.txt` | `gate-command-path` pass (shell form), fail (exec form: cannot read `args`). `gate-manifest` pass. `gate-latency-budget` pass (p99 406 ms). `gate-matcher-drift` FAIL on `mcp__.*` in both forms. |
| J3 | `J3.txt` | kubectl-shaped Bash allowed and ran. `ls` denied (POL-05, binary not recognized). `echo x > .thoth/policy.json` denied (POL-05, F8). Classified MCP server allowed. Unlisted MCP server denied (POL-05, opaque). Pre-E0 baseline recorded. |
| J3 extra | `J3.txt` | After a Bash denial the model used the PowerShell tool and it ran un-gated. With `PowerShell` in the matcher the gate refuses it. |
| J4 | commit message | Full regression, see the receipt. |
| J5 | `J5.txt` | `Edit(/docs/qa/s5-central-classification.json)` blocked Edit and Write on the scratch copy, in default mode and under `bypassPermissions`. File hash unchanged in all five deny runs; the control edit changed it. A rule written in the wrong case (`Edit(/Docs/QA/S5-...JSON)`) also blocked: the match is case-insensitive on Windows. Read stays allowed. |
| J6, J6a | `J9.txt` (footer) | Local, 40 runs per cell: allow path p99 179 ms direct, 250 ms launcher, 300 ms `env -i` launcher. Deny path p99 183, 220, 385 ms. All far below the 2000 ms ceiling. In-runtime hook wall time (stream arrival) 109 to 448 ms. |
| J8 | `J8.txt` | Table below. |
| J9 | `J9.txt` | Exec form works for allow and deny; not adopted (Manager ruling). |

## J8: settings `env` block keys

Gate = the shell-form launcher entry. "Gate env" = the key reached a plain `node` hook process (the logger, which has the same env block); it was NOT measured in the gate's own node process, which the launcher starts under `env -i`. "Shell" = the key reached the runtime's command shell (control run, no gate).

| Key | Gate env | Shell | Gate result with the key set |
|---|---|---|---|
| `CLAUDE_CODE_SHELL_PREFIX=true` | hooks wrapped too (the logger left no log) | command not run | Everything stopped: neither hook ran (exit 0) and the Bash command produced no output. Not a gate-only skip; for a Bash call the effect is a blocked call. |
| `SHELLOPTS=noexec` | hooks wrapped too (the logger left no log) | command not run | Everything stopped, same as above. A non-shell tool (`mcp__`, PowerShell) under this key was NOT run, so whether the gate is skipped while that tool still runs is unmeasured. |
| `BASH_FUNC_echo%%` | yes | yes (`echo` hijacked) | Gate ran, allowed as normal. |
| `BASH_ENV=<script>` | yes (script ran in the hook shell) | yes | Gate ran and allowed. With a script that runs `exit 0` (`j8x-bashenvexit`) neither the hook nor the Bash command produced output (everything stopped, as for the two rows above). |
| `MSYS=noglob` | yes | yes (breaks the runtime's own quoting) | Hook command failed with exit 127 and the Bash call RAN. This is the one measured fail-open of the shell-form entry. |
| `CLAUDE_CODE_GIT_BASH_PATH=<missing>` | yes | value visible, runtime still used its own bash | No effect on the gate. |
| `NODE_OPTIONS=--spike-unknown-flag` | reaches `sh`, not the gate (the launcher runs `node` under `env -i`) | yes | Gate ran and allowed. A plain `node` hook (the logger) exited 9. #406 is closed for the launcher form. |
| `GIT_EXTERNAL_DIFF=<script>` | yes | yes | No effect on the gate. Reach only; no `git diff` was run. |
| `RIPGREP_CONFIG_PATH=<file>` | yes | yes | No effect on the gate. Reach only. |

- Every row that stops or fails open needs a settings write. That keeps the #398 ruling: closed by settings protection (F and K), not by the launcher. The J9 ruling adopts the shell form on that basis.
- #406 (`NODE_OPTIONS`): not reproducible with the launcher wired.
- #409 (`GIT_EXTERNAL_DIFF`, `RIPGREP_CONFIG_PATH`): both reach the gate's env and the command shell. Neither stops the gate. Whether they run attacker code depends on a later `git diff` or `rg` call, which the gate denies today as unresolved.

## J9: exec form (`command` plus `args`, no runtime shell)

| Variant | Result |
|---|---|
| `sh` with args, allow and deny input | Same outcomes as the shell form. Hook time 119 and 240 ms (shell form 109 and 252 ms). |
| `sh` with args + `CLAUDE_CODE_SHELL_PREFIX=true` | Gate ran and denied. Shell form: everything stopped. |
| `sh` with args + `MSYS=noglob` | Gate ran and denied. Shell form failed open. |
| `sh` with args + `BASH_ENV` (`exit 0`) | Gate ran and denied. Shell form: everything stopped. |
| `sh` with args + `SHELLOPTS=noexec` | Gate did not run; the Bash command produced no output (everything stopped). |
| `env -i PATH=... sh launcher gate` + `SHELLOPTS=noexec` | Gate ran and denied. |

- Ruling (Manager, 2026-10-05): the exec form is not adopted; K uses the shell form `sh "<launcher>" "<gate>"`. This section is measurement only.
- Cost: the `PATH` argument is machine-specific; `qa:gate-command-path` and K5's pinned string must learn the new form; `${CLAUDE_PROJECT_DIR}` inside `args` was not measured.

## Not covered

- User-scope settings were not run (it would edit the real `~/.claude`). The reach of a user-scope `env` block is unproven and treated as reachable.
- The exec form with `env -i` was run only against `SHELLOPTS=noexec`.
- `Edit()` case sensitivity was measured on Windows only, with the Edit tool and the Write tool on one path.
- The model sometimes retried or switched tools; each file shows every tool call the model made.
