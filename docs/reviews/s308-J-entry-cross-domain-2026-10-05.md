# s308 story J (entry derivation and live rerun, evidence only) - cross-domain review (Ra)

[cross-domain-reviewer]
Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes

Diff 4ad9f87..937dea3 (34ddaba J evidence, 937dea3 README citation). CRITICAL, HELD behind THOTH-ADR-0003 (proposed; not a finding). Read at the commit via git show / git archive into a scratch dir (removed at end). No live claude -p spend.
ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 702b16a) [CACHE=HIT]. Whole catalog, unfiltered.

## Lanes
- Running alongside: red-team (adversarial). No domain reviewer report existed at read time; ground not re-listed. Known and not re-filed: #408-#422.
- Diff is 17 files: 1 CHANGELOG entry, 1 proposal doc, 8 raw evidence files, 6 harness scripts, README. No runtime code, no settings file changed.

## ADR verdict (whole catalog)
| ADR | Verdict |
|---|---|
| THOTH-ADR-0003 (hold; fixture protected on "every session write path") | No collision by the diff. Text gap found: the enumerated write paths are incomplete against J3 and the repo exec-tool set (finding 2). Hold intact: nothing written to .claude/settings.json. |
| THOTH-ADR-0001 / 0002 | No collision (no fixture, halt-state or hook change). |
| SE ADR-0005 (locked tests) | No locked test touched. |
| SE ADR-0019/0020/0021, devops ADR-0008/0009 (security, supply chain, secrets) | No collision. Scrub check: grep of docs/qa/s308-live-spikes-J for user name, profile paths, tokens, USERNAME=/COMPUTERNAME=: no hits outside scrub-j.mjs itself. |
| Remaining ADRs (data, cost, iac, cdk, pipeline) | Not applicable to the changed files. |

## Findings

1. [ISSUE][MED][demonstrated] K prerequisites for the exec form are incomplete and live only in prose. Issue #423.
   - J2 recorded two failing checks. Re-run by me in a scratch copy with the proposed exec entry:
     - gate-command-path-check FAIL: could not extract a ".mjs" or ".sh" script path from command "env"
     - gate-matcher-drift-check FAIL: "mcp__.*" is ABSENT from the vendored built-in-tool snapshot
   - Not recorded by J: a third consumer, the F enumerator, also cannot read the exec form. With the exec entry written into the scratch .claude/settings.json, node src/qa/protected-path-list.ts throws at src/qa/protected-path-list.ts:95: "Error: wired hook command names no CLAUDE_PROJECT_DIR script, cannot enumerate it: env" (wiredHookScripts reads h.command only, never args). With the original settings it prints "PASS, 45 protected paths".
   - Tracking: gh issue search for matcher-drift / command-path / exec form returns nothing relevant. docs/plans/s308-activation-phase0-2026-10-02.md section 3 still has J1 "Matcher Bash + mcp__.*" and K5 pin on the sh "<launcher>" "<gate>" form; the K table was not edited. The J9 check requires "a decisions row naming the chosen form"; no row exists (README: "The Manager rules").
   - Caution on the SUR-05 change: the "treat mcp__ as a prefix pattern" fix loosens a REQUIREMENTS.md:461 dead-matcher check; keep it to the exact token mcp__.* so a mistyped bare name still fails.
   - Exposure: ~100% of K attempts with the exec form (3 of 3 readers fail), basis: measured. Fail-closed (blocks K, not a bypass).
   - Minimal fix: Issue #423 carries the three reader changes and the K-table edit; decisions row for J9 when the Manager rules. Failing test: an exec-form fixture that passes gate-command-path, gate-matcher-drift and protected-path-list.

2. [ISSUE][MED][demonstrated] The un-routed exec-tool list is hand-typed and short; ADR-0003 "every session write path" is false as enumerated. Issue #424.
   - src/qa/arbitrary-exec-classification.test.ts ARBITRARY_EXEC has 10 names, all present in docs/qa/tool-inventory.json. Script output against the recommended matcher Bash|PowerShell|mcp__.*:
     - ARBITRARY_EXEC in inventory: 10 PowerShell,Skill,Workflow,CronCreate,RemoteTrigger,Bash,SlashCommand,Task,Monitor,ScheduleWakeup
     - not in recommended matcher: Skill,Workflow,CronCreate,RemoteTrigger,SlashCommand,Task,Monitor,ScheduleWakeup
     - unmentioned in K proposal note: SlashCommand,Task,Monitor,ScheduleWakeup
   - docs/plans/s308-K-proposed-entry-2026-10-05.md ("Other built-ins that execute or schedule (Skill, Workflow, CronCreate, RemoteTrigger)") names 4 of the 8. Monitor (builtin-tool-inventory.ts:110: "streams a background command output, so it runs a command") and ScheduleWakeup have the same fall-back shape J3 showed for PowerShell. That the model reaches them un-gated is UNPROVEN (no probe). Settling command: one claude -p run per tool in the J harness (harness/run.mjs) with the recommended matcher, about USD 0.03 each; the human approves spend.
   - ADR-0003 (docs/adr/thoth-0003..., Rules for agents) says the fixture must be protected "on every session write path" and lists Bash, mcp__ and the built-in file tools. J3 makes PowerShell a fifth path; the recommended entry only refuses it, and the Edit deny does not apply to it. If the human accepts the ADR as written, acceptance rests on a false completeness claim (CLAUDE.md hard rule on hand-derived completeness).
   - Exposure: 8 of 9 non-Bash exec built-ins unrouted (89%), basis: counted in code (script above); per-tool reachability unproven.
   - Minimal fix: before acceptance, /maat:adr-amend ADR-0003 to name the matcher set and state the un-routed exec tools as a disclosed residual (or route them); generate the list in the K proposal from ARBITRARY_EXEC instead of typing it.

3. [ISSUE][MED][demonstrated] The recommended exec entry hard-codes a machine-specific node PATH; a wrong PATH denies every gated call and the only unlock is out of session. Issue #425.
   - Entry: args ["-i", "PATH=/usr/bin:/bin:/c/PROGRA~1/nodejs", "sh", ...] (K proposal; flagged as machine-specific only as an open item).
   - Run by me from the scratch archive, same stdin (kubectl get pods/x --context=c):
     - good PATH: rc=0
     - node elsewhere: "/usr/bin/env: node: No such file or directory", "launcher: child exit 127 mapped to 2", rc=2
   - Every Bash, PowerShell and mcp__ call is then blocked. This repo CI is runs-on: ubuntu-latest; macOS, nvm and non-default Windows installs also differ.
   - Unlock: .claude/settings.json is on the F Edit-deny list and the launcher message names no unlock (PRINCIPLES rule 2). K5 pins the string byte for byte, so it cannot vary per machine, while the shell form takes the ambient PATH (launch-gate.sh: env -i PATH=$PATH).
   - Exposure: every machine where node is not at that path; share of users unmeasured (basis for the share: assumption; CI counted). Fail-closed.
   - Minimal fix: do not pin a PATH in a shared file. Choose between the shell form plus settings protection (#398 ruling) and an exec form whose PATH the launcher resolves (unmeasured: env -i sh LAUNCHER GATE with no PATH). Decide before K5 fixes the string. Failing test: K5 check rejects, or the pinned string contains no PATH.

4. [SUSPICION][MED][derived] Edit(~/.claude/settings.json) was never probed live; the J8 conclusion relies on it.
   - J5 profiles (J5.txt) carry one entry, Edit(/docs/qa/s5-central-classification.json), plus its wrong-case twin. The user-scope settings file is the lever README J8 treats as reachable and F1a names; its deny form (the ~/ entry, 1 of 45) and ~ expansion on Windows have no probe. README "Not covered" lists user-scope env reach as unrun, not the deny form.
   - Settles it: a claude -p run in the J5 harness with HOME/USERPROFILE pointed at a scratch dir holding a copy of a settings file, profile Edit(~/.claude/settings.json), Edit and Write, default and bypassPermissions. About USD 0.10; the human approves spend. Not a blocker (derived).

5. [SUSPICION][LOW][code-traced] #406 closure path is partial. README and CHANGELOG say "#406 is closed for the launcher form"; #406 is still OPEN. The wired SessionStart and UserPromptSubmit hooks are plain node commands (.claude/settings.json lines 154, 166); J8 shows a plain node hook exits 9 under the same NODE_OPTIONS key. They stay fail-open to a settings env write, closed only by settings protection (F and K; #419 lists both). State that when closing #406, instead of "closed for the launcher".

6. [CLEAN][code-traced] PowerShell matcher vs the AP-12 classification and REQUIREMENTS: builtin-tool-inventory.ts:104 classes PowerShell workspace-mutating, the arbitrary-exec instrument keeps it non-read-only, and tool-routing.ts refuses any name other than Bash and mcp__ fail-closed. Routing it to the refusal does not brick a Windows session: the launcher already requires Git Bash (D precondition), so Bash stays the shell tool, and J3 shows the model just reports PowerShell unavailable. REQUIREMENTS.md has no PowerShell line. Cost to disclose to the human at K: PowerShell becomes unusable on Windows. The refusal text names no unlock (existing wording, not new).

7. [CLEAN][code-traced] env -i strips CLAUDE_PROJECT_DIR in the exec form; the PreToolUse gate does not read it (hooks/pretooluse-kernel-gate.mjs:202 uses moduleRelativeFixtureLocation(); policy path is join(HERE, ...)). SessionStart and UserPromptSubmit read it but are not wrapped. No behavior change. CLAUDE_PROJECT_DIR expansion inside args stays unmeasured (disclosed).

8. [CLEAN][code-traced] J8 vs the #397/#398 rulings and the F protected list: every bypass row needs a settings write, matching the #398 ruling (closed by settings protection). The F list carries project, local and user settings (protected-path-list.ts:196-197; qa:protected-path-list PASS, 45 paths, on the archive); the proposal JSON matches the generator. Other carriers (managed settings, --settings flag, plugin settings) are admin or launch-time, outside a session write reach; .mcp.json and ~/.claude.json are #421.

9. [CLEAN][demonstrated] Evidence arithmetic: ledger.txt has 39 cost_usd rows summing to 0.9857 (awk), matching README, CHANGELOG and the commit message; under the 1.50 cap.

## Coverage gaps
- Harness scripts under docs/qa/s308-live-spikes-J/harness/ (6 .mjs): no lane claims them. Low risk: scratch tooling, not wired into npm test; scrub confirmed by grep. Fine uncovered.
- Every J run used --setting-sources project and --allowedTools with one tool; user and managed scope and permission prompts were not exercised. User scope is disclosed in README "Not covered"; the flag choice is not.
- J4 (full regression): README says "see the receipt"; no regression counts are committed in this diff. PRINCIPLES rule 10 wants the artifact committed. Named, not a finding.

## Editorial (verdict-neutral)
- CHANGELOG "local p99 at most 385 ms" vs gate-latency-budget p99 406.16 ms in J2 (direct node, 100 iterations) and in-runtime 448 ms: say which measure.
- README outcomes table packs 3 to 5 results per cell with semicolons; split per the technical-writing rules.
- Plan section 3 J1 still reads "Matcher Bash + mcp__.*" while the recommended form differs.

## Verdict: APPROVE-WITH-CONDITIONS
J is evidence only, the hold is intact, and its measurements reproduce. The conditions are for K and the ADR acceptance, not for the evidence commit: findings 1-3 become K-table rows and Issues #423-#425; the ADR-0003 amendment (finding 2) lands before the human accepts it.

Single next action: the Manager rules J9 (shell form plus settings protection, or an exec form whose PATH the launcher resolves) in a decisions row, which unblocks findings 1 and 3 together; then amend the ADR-0003 write-path list (finding 2) before asking the human to accept.

Findings to failing tests: 3 [ISSUE] map to 3 named tests (exec-form fixture across the 3 readers; generated-vs-typed exec-tool list; pinned-PATH lockout). The suspicions have no executable form yet (live probes need spend approval).

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] src/qa/protected-path-list.ts:95 + gate-command-path + gate-matcher-drift: exec-form entry fails 3 readers, K prerequisites untracked, J9 decisions row missing (#423); fix readers + K table
2. [ISSUE][MED][demonstrated] K proposal exec-tool list omits Monitor/Task/ScheduleWakeup/SlashCommand (8 of 9 unrouted, script output); ADR-0003 "every session write path" incomplete; amend before acceptance (#424)
3. [ISSUE][MED][demonstrated] K proposed-entry args hard-code PATH=/usr/bin:/bin:/c/PROGRA~1/nodejs; wrong PATH => rc=2 on all gated calls, no unlock, K5 byte-pin (#425)
4. [SUSPICION][MED][derived] J5 probed only Edit(/docs/qa/...); Edit(~/.claude/settings.json) (user-scope env lever) never live-probed
5. [SUSPICION][LOW][code-traced] #406 "closed for launcher form" but still open; SessionStart/UserPromptSubmit plain-node hooks stay exposed, closed only by settings protection
6. [CLEAN][code-traced] PowerShell routing vs AP-12 classification and REQUIREMENTS: refusal does not brick Windows (Git Bash precondition)
7. [CLEAN][code-traced] env -i drops CLAUDE_PROJECT_DIR; PreToolUse gate does not read it
8. [CLEAN][code-traced] J8 vs #397/#398 and F protected list: project, local, user settings all listed; proposal matches generator (PASS 45)
9. [CLEAN][demonstrated] ledger 39 calls, USD 0.9857 reproduces
counts: issues=3 suspicions=2 clean=4
evidence: demonstrated=4 code-traced=4 derived=1
checks=ran in scratch archive of 937dea3: gate-command-path (exec form) FAIL as J2; gate-matcher-drift (exec form) FAIL as J2; protected-path-list original PASS 45 paths, with exec form THROWS; launcher with pinned PATH rc=0, PATH without node rc=2; ledger sum 0.9857/39; exec-tool set script 8 unrouted; 0 skipped. No npm test run (evidence-only diff)
adr=HIT(38, whole catalog)
report=docs/reviews/s308-J-entry-cross-domain-2026-10-05.md
HEAD: 937dea3
