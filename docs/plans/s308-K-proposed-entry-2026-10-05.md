# Story K: proposed PreToolUse entry (J1) and what J changed in the K plan

Date: 2026-10-05. Author: story-implementer (Ptah). Proposal text only: nothing here is written to `.claude/settings.json`. K needs the human's separate approval and THOTH-ADR-0003 acceptance. Evidence: `docs/qa/s308-live-spikes-J/`.

## Entry as planned (Phase 0 J1)

- Matcher `Bash` and `mcp__.*`, timeout 60, shell-form launcher.
- Result in J2: `qa:gate-command-path` pass, `qa:gate-manifest` pass, `qa:gate-latency-budget` pass, `qa:gate-matcher-drift` FAIL (it reads `mcp__.*` as a tool name).

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|mcp__.*",
        "hooks": [
          { "type": "command", "command": "sh \"${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh\" \"${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs\"", "timeout": 60 }
        ]
      }
    ]
  }
}
```

## Recommended entry (changes from J)

- Add `PowerShell` to the matcher. J3: with matcher `Bash`, the model fell back to the PowerShell tool after a Bash denial and `Get-ChildItem` ran with no gate call. With `PowerShell` in the matcher the gate refuses it ("the gate evaluates only Bash and mcp__ tool names").
- Use the exec form with `env -i`. J8/J9: a settings `env` block defeats the shell form (`CLAUDE_CODE_SHELL_PREFIX`, `SHELLOPTS=noexec`, `BASH_ENV`, `MSYS=noglob` each stop the gate from running or failing closed). The bare exec form (`command: sh`, `args: [launcher, gate]`) held against CLAUDE_CODE_SHELL_PREFIX, MSYS=noglob and BASH_ENV but not `SHELLOPTS=noexec` (the `sh` interpreter honors it). The `env -i` exec form below held against `SHELLOPTS=noexec`; it was not run against the other keys (unmeasured; `env -i` clears the environment before `sh` starts).

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell|mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "env",
            "args": ["-i", "PATH=/usr/bin:/bin:/c/PROGRA~1/nodejs", "sh", "${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh", "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs"],
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

- Open in the exec form: the `PATH` value is machine-specific (the Node directory in MSYS short form); `${CLAUDE_PROJECT_DIR}` expansion inside `args` was not measured (J used absolute paths in the scratch project); the runtime resolves `env` and `sh` through its own PATH.

## K plan changes

- K5 (pinned entry string): the pinned form changes from `sh "<launcher>" "<gate>"` to the chosen form; the five mutants stay and gain: a missing `PowerShell` in the matcher, a missing `env -i`, a bare `sh` command (loses SHELLOPTS protection).
- New K check: `qa:gate-matcher-drift` must treat a matcher token starting with `mcp__` as a prefix pattern, not a tool name (currently FAIL on any `mcp__.*` matcher).
- New K check: `qa:gate-command-path` must read the exec form (`command` plus `args`); it fails today with "could not extract a .mjs or .sh script path from command env".
- Settings protection stays the primary closure for env-block levers (Issue #398 ruling, #406, #409); the exec form narrows, it does not replace F and K's `Edit(...)` deny.
- Other built-ins that execute or schedule (Skill, Workflow, CronCreate, RemoteTrigger, per `src/qa/arbitrary-exec-classification.test.ts`) are not in the matcher either; same fall-back exposure as PowerShell. Whether to route them (the gate refuses them) is the Manager's ruling.
- Pre-E0 baseline: with the gate wired, ordinary Bash reads (`ls`, `cat`, `git status`) are denied by POL-05; only kubectl-shaped calls and classified MCP tools run (J3).
