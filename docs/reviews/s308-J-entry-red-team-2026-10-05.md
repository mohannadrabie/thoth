# #308 story J red-team: entry derivation and live rerun evidence (Sutekh)

- Date: 2026-10-05. Tier: CRITICAL. Diff: 4ad9f87..937dea3 (commits 34ddaba, 937dea3). HEAD: 937dea3.
- Scope: J1-J9 conclusions vs the committed raw output in docs/qa/s308-live-spikes-J/, and the K proposal docs/plans/s308-K-proposed-entry-2026-10-05.md. Read at the commit (git show); executed only in a detached worktree at 937dea3, since removed. No live claude -p calls made.
- ADR: cache HIT, 38 ADRs (adr/devops:12, adr/software-engineering:23, docs/adr:3). THOTH-ADR-0003 is PROPOSED, so J is HELD; that is not a finding.
- Known, not re-filed: #420, #421, #422 (F); #423 (exec form unreadable by qa checks, missing J9 decisions row), #424 (K list omits Monitor, Task, ScheduleWakeup, SlashCommand), #425 (hard-coded node PATH), all filed by cross-domain-reviewer the same day.

## Findings, ranked by exposure x irreversibility x silence

### 1. [ISSUE][HIGH][demonstrated] PowerShell runs outside the planned matcher (Issue #426)
- Scenario: with the Phase 0 J1 entry (matcher Bash plus mcp__.*), the gate denies a Bash call and the model switches to the PowerShell tool. The runtime never calls the gate for it.
- Raw evidence: J3.txt:125 is a PowerShell tool_use (Get-ChildItem), followed directly by its tool_result (1414 chars of directory listing) with no hook_started in between. The same fallback appears in J9.txt:184, 203, 239, 258 and 277, five more runs. With PowerShell added to the matcher (J3 profile j3ps), the gate refuses it: "the gate evaluates only Bash and mcp__ tool names; got tool_name=PowerShell; fail-closed".
- What ran: the calls that executed were reads. A PowerShell write in J3 (Set-Content -Path .thoth/policy.json) was stopped by the runtime’s own working-directory guard, not by the gate. The gate saw neither call.
- Current defense: only the K proposal prose ("Add PowerShell to the matcher") and a proposed K5 mutant. The binding artifacts, plan section 3 J1 and K5, still pin the old matcher. No decisions row adopts the new one. qa:gate-matcher-drift is one-directional by its own NOTE (J2.txt) and cannot catch a missing tool. The completeness of the matcher is hand-derived.
- Exposure: 0% of sessions today (gate unwired, J held). If K is wired from plan J1 as written: ~100% of Windows sessions on 2.1.267, basis: counted in code (PowerShell is in measuredTools, docs/qa/tool-inventory.json).
- Required before K: failing test K-matcher-covers-arbitrary-exec. It derives the required matcher tokens from ARBITRARY_EXEC in src/qa/arbitrary-exec-classification.test.ts, and requires every name to be either matched (and refused or evaluated by the gate) or listed in a reviewed exemption. Seeded mutant: drop PowerShell from the matcher.

### 2. [ISSUE][MED][code-traced] J8 "Bypass" rows also stopped the Bash command; the case that bypasses was never run (Issue #427)
- Claim (README J8 table): CLAUDE_CODE_SHELL_PREFIX=true, SHELLOPTS=noexec, and BASH_ENV with exit 0 each make the gate not run: "Bypass."
- Raw evidence: the Bash command did not run either. Rows j8-shellprefix (J8.txt:409) and j8-shelloptsnoexec (J8.txt:426) show "(Bash completed with no output)". In every row where the command did run, the same kubectl call prints "Error in configuration: context was not found". Row j8x-bashenvexit (J8.txt:745) shows ls returning no output, and the model then wrongly says the directory is empty. What the rows show is that both the hook and the command were stopped, which is a denial of service, not a demonstrated bypass. The README’s Shell column records "command not run", but the outcome column still says Bypass. MSYS=noglob is the only shell-form row where the hook failed and the command ran (run j8-msys: hook exit 127, kubectl ran); that is a genuine fail-open.
- Why it matters: SHELLOPTS=noexec is the only reason K adds env -i. That lever only bypasses for tools that do not run through bash: mcp__ calls, and PowerShell once it is in the matcher. Neither was run under any env key. The recommendation may be right, but its evidence is a different case.
- Not affected: the #398 ruling (closed by settings protection) holds either way.
- Required: failing/proof test J-nonshell-tool-under-shellopts-noexec. Run an unlisted MCP tool call (and a PowerShell call with PowerShell matched) with SHELLOPTS=noexec against (a) the bare exec form and (b) the env -i exec form. Expected: (a) runs ungated, (b) is denied. Also correct the README’s Bypass labels to match their own Shell column.

### 3. [SUSPICION][MED][derived] The env -i exec form is not shown closed against every J8 key; settings-env PATH is unmeasured
- Measured: only SHELLOPTS=noexec against the env -i form (J9 run j9args-envi-shelloptsnoexec, a deny input).
- Reasoned, not run: BASH_ENV, BASH_FUNC_*, NODE_OPTIONS, SHELLOPTS and MSYS are cleared by env -i before sh starts. MSYS=noglob still governs how the MSYS env.exe parses its own command line, which by analogy with j9args-msys (sh.exe parsed its args correctly) is probably fine. CLAUDE_CODE_SHELL_PREFIX did not affect the bare exec form (j9args-shellprefix), so it probably does not affect this one either.
- Not in the J8 key list at all: a settings env PATH. The K doc admits the runtime resolves env and sh through its own PATH. If the runtime looks up env through a PATH the settings block modified, a planted env replaces the whole hook. This is the same class as the other env-block levers (it needs a settings write, closed by F and K settings protection), but it is the one lever the K form does not narrow.
- What env -i breaks (code-traced, no defect found): the launcher forwards CLAUDE_PROJECT_DIR only if it is set (hooks/launch-gate.sh), so under env -i it is dropped. The gate reads its fixture module-relative (src/policy/tools/classification-catalog.ts, moduleRelativeFixtureLocation), and reg.exe falls back to the default Windows directory (src/policy/config/central-source.ts:107-110), so the gate’s behaviour is unchanged. The local J6 execenv cell still returns "exit=0 silent" on allow and "deny-json" on deny. The machine-specific PATH is #425.
- Settles it: J-envi-form-key-matrix, the J9 env -i row repeated for every J8 key plus PATH, on a deny input and an allow input. Who: story-implementer, about 10 live calls.

### 4. [SUSPICION][MED][derived] Routing the remaining exec tools: what it breaks and what fires the hook is unmeasured
- The gate refuses every tool name except Bash and mcp__*. Matching Task or Skill would therefore refuse all subagents and skills, which breaks this project’s own maat loop.
- Whether PreToolUse fires for Bash calls made inside a Task subagent was not measured. If it does, Task needs no routing; if not, Task is the widest bypass.
- RemoteTrigger and CronCreate/ScheduleWakeup run later, or off-machine for RemoteTrigger. Their later tool calls may or may not pass local hooks.
- The list gap itself is #424 and is not re-filed.
- Settles it: J-subagent-bash-fires-gate (a Task subagent asked to run ls, which the gate must deny) and J-monitor-fires-gate (a Monitor command with the K matcher). Who: story-implementer, about 4 live calls.

### 5. [SUSPICION][LOW][code-traced] J5 "case-insensitive" claim has no negative control
- J5.txt run j5-case-edit: a wrong-case rule blocked the edit. But no run has a deny rule for a different file while the fixture stays editable. The generic message "File is in a directory that is denied" fits a case-insensitive match and also fits an over-broad match.
- Security impact is nil in either direction, since an over-match still blocks. The finding is about whether the claim is supported.
- Proof test: J5-unrelated-deny-leaves-fixture-editable.
- Also not tested: NotebookEdit and MultiEdit.

### 6. [CLEAN][code-traced] #406 "not reproducible with the launcher" holds
- The exit-9 response in j8-nodeopts belongs to the logger: its stderr names node.exe rejecting the flag, and the logger’s log file is absent (J8.txt:768-769).
- If the gate’s node had failed, the launcher would have mapped the child’s exit to 2 (hooks/launch-gate.sh, case rc in 0|2), so the hook could not have exited 0. NODE_OPTIONS cannot stop the outer sh. The launcher’s env -i strips it.
- Caveat: the allow path is silent, so the evidence that the gate ran comes from the code, not the stream.

### 7. [CLEAN][demonstrated] J5 deny holds under bypassPermissions
- Both bypass runs show permissionMode=bypassPermissions at init, along with the deny tool_error. The fixture hash is unchanged in all five deny runs (bbade38ae1e3fe29), and the control run changed it (6d02c5c275e3766a).

### 8. [CLEAN][demonstrated] Evidence hygiene and ledger arithmetic
- gitleaks dir docs/qa/s308-live-spikes-J --no-banner: "scanned ~193538 bytes ... no leaks found". The K doc: "no leaks found". The repo has no .gitleaks.toml at 937dea3, so these were default rules.
- Leak-pattern grep (user paths, the user name, emails, sk-ant-, UUIDs) over 19 files plus the K doc: 0 hits. The logger records CLAUDE_* names only, never values, and CLAUDE_CODE_MESSAGING_TOKEN appears as a name only. Full-environment outputs are replaced by "[omitted ...]".
- Ledger: 39 rows summing to 0.9857, which equals the header ("live calls: 39", "total cost USD: 0.9857"). Checked with awk over the committed ledger.

## Editorial (verdict-neutral)
- README "Hook attribution: the first hook_started is the gate": the method gives no information, because both hook_started lines are identical. Responses arrive in completion order: in every deny run the deny JSON is the second hook_response (e.g. J3.txt run j3-bash-deny). Attribution was in fact made by content. Reword the sentence to say so.
- README J8 "Gate env" column: the values come from the logger, a sibling hook process, not from the gate’s node process, which runs under env -i.
- gen-j.mjs does not generate the profiles j3ps, j8x-bashenvexit, j9args-msys, j9args-bashenvexit or j9args-envi-shelloptsnoexec, so the committed harness cannot regenerate 5 of the 39 runs.
- The J3 ls deny reason cites "command flag --context", which ls does not carry. This belongs to F10 / #420, not J.

## Verdict
no-go for feeding K from the current J conclusions. The J evidence files themselves are accurate and clean. The scariest unproven assumption: that the gate’s matcher covers every tool that can run code, when J’s own raw output shows a tool (PowerShell) outside it running ungated, and no instrument checks the matcher against the ARBITRARY_EXEC set. Single next action: a decisions row adopting the matcher, plus the failing test K-matcher-covers-arbitrary-exec (#426), before K5 pins any entry string.

Open findings: 2 issues (#426, #427) plus 3 suspicions, each mapped to one named test: K-matcher-covers-arbitrary-exec, J-nonshell-tool-under-shellopts-noexec, J-envi-form-key-matrix, J-subagent-bash-fires-gate (with J-monitor-fires-gate), J5-unrelated-deny-leaves-fixture-editable.

RECEIPT: verdict=no-go
attacks:
1. [ISSUE][HIGH][demonstrated] PowerShell runs ungated outside the planned matcher (J3.txt:125, J9.txt x5); the fix exists only in K prose, plan J1/K5 still pin the old matcher, no instrument checks it. Exposure: 0% today; ~100% of Windows 2.1.267 sessions if K is wired per plan J1, basis: counted in code. Issue #426
2. [ISSUE][MED][code-traced] J8 "Bypass" rows (SHELL_PREFIX, SHELLOPTS=noexec, BASH_ENV exit 0) also stopped the Bash command (J8.txt:409/426/745); the real bypass case (mcp__/PowerShell under SHELLOPTS) was never run, yet it is the sole basis for env -i. Issue #427
3. [SUSPICION][MED][derived] env -i exec form measured only against SHELLOPTS; settings-env PATH (lookup of env/sh) never measured; CLAUDE_PROJECT_DIR drop is harmless (module-relative fixture)
4. [SUSPICION][MED][derived] Routing Task/Skill refuses all subagents and skills; whether PreToolUse fires inside subagents, Monitor, or scheduled/remote runs is unmeasured (list gap is #424)
5. [SUSPICION][LOW][code-traced] J5 case-insensitivity has no negative control (unrelated deny rule); NotebookEdit and MultiEdit untested
6. [CLEAN][code-traced] #406 not reproducible with the launcher: exit 9 is the logger’s; launcher maps a gate node failure to 2
7. [CLEAN][demonstrated] J5 Edit/Write deny holds under bypassPermissions; hashes unchanged x5, control changed
8. [CLEAN][demonstrated] gitleaks no leaks (193 KB plus K doc), leak grep 0 hits, env names only; ledger 39 rows = USD 0.9857
counts: issues=2 suspicions=3 clean=3
evidence: demonstrated=3 code-traced=3 derived=2
checks=gitleaks 2 pass/0 fail/0 skip (default rules; repo .gitleaks.toml absent); leak-grep 0 hits; ledger sum 1 pass; no npm test run (evidence-only diff)
adr=HIT(38)
report=docs/reviews/s308-J-entry-red-team-2026-10-05.md
HEAD: 937dea3
