# Cross-domain review: #429 + #424 + #446 (S7), CRITICAL, 2026-10-05

[cross-domain-reviewer] Ra. Branch s7/knockout-429 (worktree thoth-wt429), commits 69c0acb, db3b19d, d6adffc, ea391d2, 171fa4c. Parallel lanes: red-team, app-security-reviewer (named, not re-covered). ADR: `📊 ADR cache HIT: reused 38 ADR(s) ... [CACHE=HIT]`, whole catalog read, not sliced.

## Cross-domain ADR verdict
- THOTH-ADR-0003 (write-path rule + residual table): HOLDS. The "single source" is still the K proposal's pendingHumanDecision list; it now equals the exec-residual judgments (test K-pending-equals-residual-judgments, passes). Residual row "Un-routed arbitrary-execution built-ins" is stale-conservative, not an over-claim: Skill/SlashCommand are now content-protected and Monitor/RemoteTrigger routed-by-ruling, so the row under-states coverage (editorial; the ADR says the human decides at K, and ruling 3 is Manager-made and pending ratification, which the K md labels "Pending human decision"). Condition F1 (no over-claim) not regressed. NotebookEdit/MultiEdit write coverage stays unmeasured and is recorded as a K release gate.
- Remaining 37 ADRs: no collision in the changed files (data JSON, QA tooling, protected list, defaults).

## Seams
- #429 vs #428 (demonstrated): trial-merged s7/knockout-428 into a detached copy of the 429 head. Code merges clean; conflicts only in CHANGELOG.md and docs/decisions.md (append-only, keep both). On the merged tree, `routeToolName` returns UNROUTED for Monitor, RemoteTrigger, PowerShell, Agent, Skill and `ROUTES.length` is 2. So the derived matcher adding Monitor/RemoteTrigger does NOT interact with the ROUTES pin: they are refused ("unroutable-tool"), not routed to Bash. Suite on merged tree: 72 tests, 71 pass, 0 fail, 1 skip.
- Gap in that seam (LOW, code-traced): "exec-routed" means refused through the ABSENCE of a route. Only PowerShell has a pin (TRUST-16 on #428); G17 (decide-tool-call.test.ts:231) lists Write, Edit, Task, ToolSearch, Skill, PowerShell, not Monitor or RemoteTrigger. Nothing fails if someone later adds a Monitor route that runs it. Fix: a test that every exec-routed judgment other than Bash is `routeToolName(...) === undefined`. Exposure basis assumption, so LOW; no Issue.
- #429 vs #409: merged in cleanly; protected-path-list reports 74 paths at the 429 head (matches the K plan's 74), 76 with #428 merged. #447 (Windows ProgramData managed settings) is untouched by this diff and stays open; not new.
- K plan: uses the derived matcher (K5 pinned to it, with Monitor/RemoteTrigger mutants), the residual list, and records both release gates (subagent probe P1 re-run; NotebookEdit/MultiEdit spike). Question 7 covers P-K2 for PowerShell/mcp__ in subagents. Sound.
- Manager's loop: Edit denies on `.claude/agents|skills|commands` and `~/.claude/{agents,skills,commands,plugins}` stop a wired session editing them; deny rules govern tool calls, so the human's own terminal and the CLI's plugin updater are not blocked. The K plan (section 3 line 121) states a wired session cannot run the dev loop and "the way out is outside the session". Intended; plugin/agent updates are simply human-side after K (not named explicitly, editorial). Repo tracks only `.claude/settings.json`, so no tracked agents/skills are over-blocked.
- Completeness claims: protected-path count and matcher come from generators/tests (`node src/qa/protected-path-list.ts` run: PASS, 74); judgments coverage from K-every-vendored-tool-judged-exec. No hand-typed completeness found.

## Coverage gaps
- docs/qa/tool-exec-judgment.json reasons/judgments are hand-judged by design; the instrument checks coverage and consistency, not correctness of each judgment. Named residual, owned by K release gates and red-team.
- CHANGELOG/docs prose: no lane owns it beyond code-reviewer; spot-checked, accurate.

## Editorial
- K wiring plan line 96 says E0, #409, #428, #429 are each "built on the previous"; the 429 branch contains 409 but not 428 (merge-base check). Merge order text is fine, "built on" is not; expect doc-only conflicts when #428 merges.

## Verdict: APPROVE. Next action: add the Monitor/RemoteTrigger-unroutable test (one loop over routedTools) before K.

RECEIPT: verdict=APPROVE
findings:
1. [ISSUE][LOW][code-traced] src/qa/tool-exec-judgment.ts / decide-tool-call.test.ts:231 - exec-routed Monitor/RemoteTrigger are refused only by route absence; no test pins it; add loop test routedTools minus Bash/mcp__ => routeToolName undefined
2. [SUSPICION][LOW][derived] docs/plans/s308-K-wiring-plan-2026-10-05.md:96 - "built on the previous" is false for 428 vs 429; trial merge conflicts only in CHANGELOG.md and docs/decisions.md (editorial)
3. [CLEAN][demonstrated] #429 vs #428: Monitor/RemoteTrigger/PowerShell/Agent/Skill UNROUTED, ROUTES.length 2, merged-tree tests 71 pass 0 fail 1 skip
4. [CLEAN][code-traced] THOTH-ADR-0003 write-path rule and residual table: single-source list equals residual judgments; no over-claim (row under-states, editorial)
5. [CLEAN][demonstrated] protected-path count 74 generator-derived, matches K plan; K plan uses derived matcher and records both release gates
6. [CLEAN][code-traced] Manager-loop plugin/agent protection: tool-call denies only, human path outside session, stated in K plan
counts: issues=1 suspicions=1 clean=4
evidence: demonstrated=2 code-traced=3 derived=1
checks=node --test (5 files, merged 429+428 tree): tests 72, pass 71, fail 0, skipped 1; protected-path-list PASS 74
adr=HIT(38, whole catalog)
report=docs/reviews/s429-cross-domain-2026-10-05.md
