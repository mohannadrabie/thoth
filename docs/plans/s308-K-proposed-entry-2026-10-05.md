# Story K: proposed PreToolUse entry (J1) and what J changed in the K plan

Date: 2026-10-05 (revised after the J9 ruling and the J review). Author: story-implementer (Ptah). Proposal text only: nothing here is written to `.claude/settings.json`. K needs the human's separate approval and THOTH-ADR-0003 acceptance. Evidence: `docs/qa/s308-live-spikes-J/`. Machine-readable copy: `docs/plans/s308-K-proposed-entry-2026-10-05.json` (checked by `src/qa/k-matcher-covers-arbitrary-exec.test.ts`).

## Entry (K5's pinned form is the shell form)

- Matcher `Bash|Monitor|PowerShell|RemoteTrigger|mcp__.*`, timeout 60, shell-form launcher. The exec form is not adopted (J9 ruling).
- J3: with matcher `Bash` only, the model fell back to the PowerShell tool after a Bash denial and `Get-ChildItem` ran with no gate call. With `PowerShell` in the matcher the gate refuses it ("the gate evaluates only Bash and mcp__ tool names").
- Revised 2026-10-05 (#429, Manager ruling 3): Monitor (runs a raw shell command) and RemoteTrigger (runs cloud routines) are also routed, so the gate refuses them. The matcher is DERIVED from `docs/qa/tool-exec-judgment.json` (its exec-routed tools) and pinned by `src/qa/tool-exec-judgment.test.ts`.
- Routing PowerShell makes it unusable: the gate refuses every tool name other than Bash and `mcp__*`. Git Bash is already a launcher precondition.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Monitor|PowerShell|RemoteTrigger|mcp__.*",
        "hooks": [
          { "type": "command", "command": "sh \"${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh\" \"${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs\"", "timeout": 60 }
        ]
      }
    ]
  }
}
```

## Pending human decision at K: the residual exec-judged built-ins (#424, #429)

- Source: every vendored tool is judged in `docs/qa/tool-exec-judgment.json` (exec-routed, exec-residual, not-exec); the test `K-every-vendored-tool-judged-exec` fails when a vendored tool has no judgment. The residual list below equals the exec-residual judgments (test `K-pending-equals-residual-judgments`).
- A residual tool is NOT routed: its effects happen only through other tool calls, so it is conditional on those calls being gated or on its content being unauthorable. The condition is in the JSON (`residualCondition`).
- Routing a tool instead would make it unusable (the gate refuses it). What fires the hook for each, and the exact breakage, is unmeasured except where noted.
- `Task` and `Agent` are one tool: the init list says `Task`, the tool call and the PreToolUse payload say `Agent` (live probe P1). Both names are judged; a test fails if only one is present.
- K release gate: re-run the live subagent probe (`docs/qa/s7-live-probes/README.md`, P1: PreToolUse fires for Bash inside a subagent and the deny holds, background and foreground) against the K wiring before K ships; if the gate does not fire, Task, Agent, SendMessage and Workflow flip to exec-routed. Not a CI dependency.
- K release gate: a live spike that the generated `Edit(...)` denies cover NotebookEdit and MultiEdit (judged not-exec now; unmeasured).
- Nested skill directories (Issue #449, residual): `.claude/skills/`, `.claude/commands/` and `.claude/agents/` below a subdirectory or under `.claude/worktrees/` are not protected (kernel targets are exact or a trailing-slash prefix, no globs). Before K activation, review the output of `findNestedSkillDirs` in `src/qa/tool-exec-judgment.ts` (read-only). Not a CI dependency.
- Skill and SlashCommand condition (`authorable-content-protected`): `.claude/commands/`, `.claude/skills/`, `.claude/agents/`, `~/.claude/commands/`, `~/.claude/skills/`, `~/.claude/agents/` and `~/.claude/plugins/` are write-protected (named paths, #429). Limit: installed plugin or marketplace content is not made trusted, and a directory named through `--plugin-dir` or a setting outside those roots is not covered. If this is not accepted, flip both to exec-routed in the JSON (both become unusable).

| Tool | Condition | What routing it would break |
|---|---|---|
| Skill | authorable-content-protected | Every Skill invocation (project and plugin skills) |
| SlashCommand | authorable-content-protected | Slash commands run through the model |
| Workflow | inner-calls-gated | Every workflow run |
| CronCreate | none | Scheduling a cron job from a session |
| ScheduleWakeup | none | A session scheduling its own later prompt |
| Task | inner-calls-gated | All subagent delegation (init-list name), including the reviewer agents this loop uses |
| Agent | inner-calls-gated | The same delegation under its call-time name |
| SendMessage | inner-calls-gated | Resuming a subagent or messaging a teammate |

## K plan changes from J

- K5 (pinned entry string): stays `sh "<launcher>" "<gate>"`. Its mutant set gains "PowerShell missing from the matcher" (alongside a bare `node <gate>`, a trailing `|| true`, a trailing `; exit 0`, `echo <launcher> <gate>`, and `bash` in place of `sh`).
- `qa:gate-matcher-drift` accepts the exact tokens `mcp__.*` and `PowerShell` (#423, done on this branch). A mistyped bare name still fails.
- Env-block levers (`CLAUDE_CODE_SHELL_PREFIX`, `SHELLOPTS=noexec`, `BASH_ENV`, `MSYS=noglob`) need a settings write; the #398 ruling closes them by settings protection (F's list plus K's `Edit(...)` deny), not by the launcher. `MSYS=noglob` is the one measured shell-form fail-open (see the J README).
- #406 stays open until K: the plain-node SessionStart and UserPromptSubmit hooks stay exposed and are closed only by settings protection.
- Pre-E0 baseline: with the gate wired, ordinary Bash reads (`ls`, `cat`, `git status`) are denied by POL-05; only kubectl-shaped calls and classified MCP tools run (J3).
