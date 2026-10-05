# Story K: proposed PreToolUse entry (J1) and what J changed in the K plan

Date: 2026-10-05 (revised after the J9 ruling and the J review). Author: story-implementer (Ptah). Proposal text only: nothing here is written to `.claude/settings.json`. K needs the human's separate approval and THOTH-ADR-0003 acceptance. Evidence: `docs/qa/s308-live-spikes-J/`. Machine-readable copy: `docs/plans/s308-K-proposed-entry-2026-10-05.json` (checked by `src/qa/k-matcher-covers-arbitrary-exec.test.ts`).

## Entry (K5's pinned form is the shell form)

- Matcher `Bash|PowerShell|mcp__.*`, timeout 60, shell-form launcher. The exec form is not adopted (J9 ruling).
- J3: with matcher `Bash` only, the model fell back to the PowerShell tool after a Bash denial and `Get-ChildItem` ran with no gate call. With `PowerShell` in the matcher the gate refuses it ("the gate evaluates only Bash and mcp__ tool names").
- Routing PowerShell makes it unusable: the gate refuses every tool name other than Bash and `mcp__*`. Git Bash is already a launcher precondition.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell|mcp__.*",
        "hooks": [
          { "type": "command", "command": "sh \"${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh\" \"${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs\"", "timeout": 60 }
        ]
      }
    ]
  }
}
```

## Pending human decision at K: the other arbitrary-exec built-ins (#424)

- The set is read from `src/qa/arbitrary-exec-classification.test.ts` (its AP12_NAMED and ADDED_BUILTINS arrays) by the test `K-matcher-covers-arbitrary-exec`; a tool that is neither matched nor listed here fails the test.
- Each tool below has the same fall-back exposure as PowerShell had in J3. Routing a tool makes it unusable (the gate refuses it). What fires the hook for each, and the exact breakage, is unmeasured.

| Tool | What routing it would break |
|---|---|
| Skill | Every Skill invocation (project and plugin skills) |
| Workflow | Every workflow run |
| CronCreate | Scheduling a cron job from a session |
| RemoteTrigger | Remote trigger calls |
| Monitor | Streaming a background command's output |
| Task | All subagent delegation, including the reviewer agents this loop uses |
| ScheduleWakeup | A session scheduling its own later prompt |
| SlashCommand | Slash commands run through the model |

## K plan changes from J

- K5 (pinned entry string): stays `sh "<launcher>" "<gate>"`. Its mutant set gains "PowerShell missing from the matcher" (alongside a bare `node <gate>`, a trailing `|| true`, a trailing `; exit 0`, `echo <launcher> <gate>`, and `bash` in place of `sh`).
- `qa:gate-matcher-drift` accepts the exact tokens `mcp__.*` and `PowerShell` (#423, done on this branch). A mistyped bare name still fails.
- Env-block levers (`CLAUDE_CODE_SHELL_PREFIX`, `SHELLOPTS=noexec`, `BASH_ENV`, `MSYS=noglob`) need a settings write; the #398 ruling closes them by settings protection (F's list plus K's `Edit(...)` deny), not by the launcher. `MSYS=noglob` is the one measured shell-form fail-open (see the J README).
- #406 stays open until K: the plain-node SessionStart and UserPromptSubmit hooks stay exposed and are closed only by settings protection.
- Pre-E0 baseline: with the gate wired, ordinary Bash reads (`ls`, `cat`, `git status`) are denied by POL-05; only kubectl-shaped calls and classified MCP tools run (J3).
