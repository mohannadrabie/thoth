# #308 story J red-team round 2: re-confirm of the J conditions and the K proposal (Sutekh)

- Date: 2026-10-05. Tier: CRITICAL. Delta: 695d3f1..ac9cfd7 (ded8782 for J conditions #423/#426/#427, the K proposal rewrite and the THOTH-ADR-0003 amendment; ac9cfd7 for story F's round-3 probe table as hook-level tests). HEAD: ac9cfd7.
- Method: the main tree was read through `git show` only. Tests and mutants ran in a detached worktree at ac9cfd7 (scratchpad rt-J2), which has since been removed. No live `claude -p` spend.
- ADR: `📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog — ≈18800 tokens saved this pass (fp 856f4b1) [CACHE=HIT]`. THOTH-ADR-0003 is still proposed, so J and K stay held. That is not a finding.
- Exposure framing: the gate is unwired, so every exposure below is 0% of sessions today. Each figure states what changes once K wires the entry.
- Known and not re-filed: #424 (open; the architecture reviewer has a condition on the ADR closing sentence). The round-1 suspicion 3 (env -i key matrix) is moot: the J9 ruling did not adopt the exec form.

## Findings, ranked by exposure x irreversibility x silence

### 1. [ISSUE][MED][demonstrated] K-matcher-covers-arbitrary-exec inherits a hand-curated tool set; its inventory cross-check adds no detection power
- Scenario: a Claude Code upgrade adds a new tool that runs commands (call it ShellExec). Re-vendoring forces a CLASSIFICATION row, because builtin-tool-inventory.ts throws on an unclassified name. Nothing asks the human whether the new tool is arbitrary-exec. The tool is left out of AP12_NAMED and ADDED_BUILTINS, so K's matcher never routes it and no test fails. A session that hits a Bash deny then falls back to it, exactly as J3 showed for PowerShell.
- Code: the test filters `measured = tools.filter((t) => inventory.includes(t))` (src/qa/k-matcher-covers-arbitrary-exec.test.ts). That makes the inventory check a subset of the instrument set, so the first `uncovered(...)` assertion is implied by the second. Inventory tools that are not in ARBITRARY_EXEC are never examined. The header says "Nothing is hand-derived", but ARBITRARY_EXEC is a judgement list. src/qa/arbitrary-exec-classification.test.ts says itself that "The set is NOT a proof that no other tool can execute arbitrary code".
- Demonstrated (mutant M4): add `ShellExec` to tool-inventory.json `tools` and `measuredTools`, and `ShellExec: "workspace-mutating"` to CLASSIFICATION. Results: k-matcher test `pass 3 fail 0`; arbitrary-exec-classification plus gate-matcher-drift `pass 29 fail 0`. The tool slips past all three.
- Exposure: 0% today. After K, any runtime upgrade that adds an exec-capable tool. Basis: counted in code. Seven of the ten ARBITRARY_EXEC names (PowerShell, Skill, Workflow, CronCreate, ScheduleWakeup, Monitor, RemoteTrigger) arrived as new rows in one re-vendor (the "Added by #308 story C" block of CLASSIFICATION). Silent: yes. Reversible: yes, once noticed.
- Defense, honestly assessed: re-vendoring is a human-run, reviewed action. That reviewer could add the name. Nothing prompts them to.
- Failing test required: `K-every-vendored-tool-judged-exec`. Every name in tool-inventory.json `tools` must sit in ARBITRARY_EXEC or in an explicit NOT_ARBITRARY_EXEC list with a one-line reason. Seeded mutant: M4 above must fail. Filed as Issue #429.

### 2. [ISSUE][MED][code-traced] SendMessage, a delegation tool in the same class as Task, is missing from ARBITRARY_EXEC and from the K decision table the human reads
- Code: `SendMessage` is in tool-inventory.json `measuredTools` for 2.1.267. CLASSIFICATION (src/policy/tools/builtin-tool-inventory.ts) says "ambiguous recipient (agent or external)". It is absent from AP12_NAMED and ADDED_BUILTINS, and therefore from `pendingHumanDecision`.
- Vendor semantics: Claude Code uses SendMessage to message subagents and agent-team teammates. Since v2.1.77 it is also the documented way to resume a subagent, which replaced the Agent resume parameter (anthropics/claude-code issue 35240). That is the same delegation route as Task.
- Scenario: at K the human routes Task to close the subagent route. A later SendMessage resumes an already-spawned agent. The tool calls of that agent fall under the same unmeasured question as Task subagents (round-1 suspicion 4). The decision table has no row for SendMessage.
- Exposure: 0% today. After K, sessions where SendMessage is exposed (it is measured on this install). Whether a resumed agent goes through the gate for Bash is unmeasured. Basis: counted in code for exposure, derived for impact.
- Failing test required: `AP12-sendmessage-is-arbitrary-exec` (SendMessage added to ADDED_BUILTINS). K-matcher-covers-arbitrary-exec then fails until SendMessage is routed or listed pending with its consequence. Filed as a comment on #424 (same class: a list omission), not as a new Issue.

### 3. [SUSPICION][MED][derived] Carried from round 1, suspicion 4: what fires the hook for each pending tool is unmeasured
- No change in this delta. The K JSON note and the markdown now disclose it. Disclosed is not measured.
- Settles it: `J-subagent-bash-fires-gate` (plus J-monitor-fires-gate). Owner: story-implementer, about 4 live calls, before the human decides on the pending table.

### 4. [SUSPICION][LOW][code-traced] Carried from round 1, suspicion 5: the J5 case-insensitivity claim has no negative control
- No change in this delta. Test: `J5-unrelated-deny-leaves-fixture-editable`.

### 5. [CLEAN][demonstrated] #426: K-matcher-covers-arbitrary-exec reads its set by AST and kills the round-1 mutants
- Run at ac9cfd7: the k-matcher, gate-matcher-drift and arbitrary-exec-classification files gave `tests 32 pass 32 fail 0 skipped 0`. Log line: "K-matcher: 10 instrument tools, 10 in the measured inventory; matcher Bash|PowerShell|mcp__.*".
- Mutants, applied to the proposal JSON:

| Mutant | pass | fail |
|---|---|---|
| M1 PowerShell dropped (matcher `Bash` or `mcp__.*`) | 0 | 3 |
| M2 empty pending list | 1 | 2 |
| M3 stale pending entry (PowerShell matched and pending) | 1 | 2 |
| M3b non-exec pending entry (Read) | 2 | 1 |

- The AST reader takes only string literals. A non-literal rewrite of either array (for example `as const`) drops names, but the `tools.length >= 10` guard catches the realistic forms.
- The gap is coverage of the inventory, which is finding 1. The round-1 PowerShell leg itself is closed.

### 6. [CLEAN][demonstrated] #423: gate-matcher-drift accepts the exact token mcp__.* and nothing looser
- Seven near-miss tokens (`PowerShel`, `mcp__.`, `mcp__*`, `mcp__.*x`, `mcp__github`, `MCP__.*`, `.*`) each still drift.
- Mutant: loosening the skip to `name.startsWith("mcp__")` gives `pass 10 fail 1`. The token acceptance can only remove false positives. It cannot hide a missing tool.

### 7. [CLEAN][code-traced] #427: the README J8 and J9 corrections match the raw lines
- j8-shellprefix (J8.txt:397-412) and j8-shelloptsnoexec (414-429): both hook responses exit 0 and are empty, "(Bash completed with no output)", and the logger left no log (750-754). That matches "Everything stopped".
- j8-bashenv (448-463): BASHENV-RAN, the kubectl error is printed and the logger log is present, which matches "Gate ran and allowed".
- j8x-bashenvexit (733-748, log at 777): everything stopped, which matches.
- j8-msys (465-480): exit 127, and the kubectl call ran, which matches "the one measured fail-open".
- J9 args rows: j9args-shellprefix and j9args-bashenvexit show a deny JSON, and j9args-shelloptsnoexec shows empty responses with no output. All match.
- The non-shell-tool-under-SHELLOPTS leg is now stated as unmeasured. With PowerShell routed through the sh launcher, a SHELLOPTS=noexec settings env would skip the gate while PowerShell runs. That still needs a settings write, closed by settings protection under the #398 and J9 rulings, and the README says so. Accepted as a ruled residual.

### 8. [CLEAN][code-traced] K proposal: the shell form is consistent with K5 and #401, and the pending table states the real consequence
- `proposedCommand` byte-equals `LAUNCHER_COMMAND` (src/qa/gate-command-path-check.test.ts:96). The test pins it by regex.
- K5 keeps the `sh` form and gains the "PowerShell missing from the matcher" mutant. The #401 mutants (bare node, trailing or-true, trailing exit 0, echo, bash) are unchanged.
- Each pending row states "refused". That is the real consequence: the gate refuses every non-Bash, non-mcp__ name, as J3 j3ps recorded ("the gate evaluates only Bash and mcp__ tool names").
- Matcher semantics: the combined string contains `.`, so the runtime evaluates it as an unanchored JavaScript regex (code.claude.com/docs/en/hooks, "Matcher patterns"). That is a superset of the test's anchored model, so the test can over-report but never under-report routing.
- Live J3 ran "Bash|PowerShell" and "mcp__.*" as separate entries, never the combined string. The regex alternation is their union.
- Over-routing hits any name containing Bash, PowerShell or mcp__. Of the measured tools, that is only Bash itself. BashOutput is carried forward, and routing it fails closed.

### 9. [CLEAN][demonstrated] ac9cfd7: the probe tests run the real hook and bite
- The tests use `createGateSandbox` (hooks/test-support/gate-sandbox.ts), which spawnSyncs node on the copied hooks/pretooluse-kernel-gate.mjs with the registry source pinned to absent. Classification is strict: deny means exit 0 plus deny JSON with a reason; allow means exit 0 with empty stdout and stderr.
- The 34 table rows are byte-identical to the Manager's report (`diff` printed IDENTICAL; 34 lines each).
- Run: `pass 36 fail 0 skipped 0`. Spot-checked rows: 01 deny (nested sh -c around ./k), 19 allow (env kubectl), 30 deny (KUBECONFIG=./x kubectl), 31 allow (@args.txt).
- Mutant: flipping row 30 to allow and row 31 to deny gives `pass 34 fail 2`, with messages "expected a silent allow ... permissionDecision deny" and "expected a kernel deny; code=0 stdout empty".

## Editorial (verdict-neutral)
- The title of the k-matcher mutants test says "a stale pending entry is detected", but it seeds no stale entry. Detection lives in the loop of test 1 (M3 demonstrated it works).
- The log line says "10 in the measured inventory", but the code reads `tools`, which includes carriedForward. SlashCommand is carried forward (derived), not in `measuredTools`.
- The md.includes(proposedMatcher) agreement check passes whenever the string appears anywhere in the markdown. It does not compare the command string.
- `extractMatcherToolNames` splits only on the pipe. The runtime also accepts comma lists ("Edit, Write"), so a comma-form matcher at K would read as drift. That is a false positive, and the qa check fails closed.
- The probe file never disposes its sandbox temp directory, so each run leaves a tmp dir behind.

## Verdict
**go**. There are no HIGH findings. Both round-1 conditions are closed: #426 (PowerShell routed, with an instrument and mutants) and #427 (the README matches the raw output). Two MEDs remain against the completeness of the K decision surface. Neither blocks J: J changes nothing that is wired. Both must be settled before the human rules on the K pending table.

**Scariest unproven assumption:** that the ten-name ARBITRARY_EXEC list is the complete set of tools that can run code. It is a judgement list. It already misses SendMessage, and nothing forces a judgement when a re-vendor adds a tool.

**Single next action:** add `K-every-vendored-tool-judged-exec`, which requires every vendored name to be judged exec or non-exec with a reason. Resolve SendMessage through it before the K pending table goes to the human.

Open findings 4, failing tests 4: K-every-vendored-tool-judged-exec, AP12-sendmessage-is-arbitrary-exec, J-subagent-bash-fires-gate, J5-unrelated-deny-leaves-fixture-editable.

Sources: [Claude Code hooks, Matcher patterns](https://code.claude.com/docs/en/hooks); [anthropics/claude-code issue 35240](https://github.com/anthropics/claude-code/issues/35240).

RECEIPT: verdict=go
attacks:
1. [ISSUE][MED][demonstrated] K-matcher test inherits the hand-curated ARBITRARY_EXEC set; its inventory cross-check is a subset filter; mutant M4 (new vendored and classified ShellExec) stays green 3/0 (AP-12 plus drift 29/0). Exposure 0% today; after K, any runtime upgrade adding an exec tool (7 of 10 arrived in one re-vendor, counted in code). Issue #429
2. [ISSUE][MED][code-traced] SendMessage (measured; resumes subagents and messages teammates, same class as Task) is absent from ARBITRARY_EXEC and from the K pendingHumanDecision table; commented on #424
3. [SUSPICION][MED][derived] carried from round 1 suspicion 4: what fires the hook for pending tools and subagents is unmeasured (now disclosed in the K note)
4. [SUSPICION][LOW][code-traced] carried from round 1 suspicion 5: J5 case-insensitivity has no negative control
5. [CLEAN][demonstrated] #426 closed: AST-derived set; mutants PowerShell-dropped 0/3, empty pending 1/2, stale pending 1/2, non-exec pending 2/1
6. [CLEAN][demonstrated] #423 closed: exact token mcp__.* only; 7 near-misses drift; loosened startsWith mutant 10/1
7. [CLEAN][code-traced] #427 closed: README J8 and J9 rows match J8.txt:397-480, 733-779 and the J9 args runs; SHELLOPTS plus PowerShell leg stated unmeasured, ruled residual
8. [CLEAN][code-traced] K proposal shell form byte-equals LAUNCHER_COMMAND (gate-command-path-check.test.ts:96); K5 gains the PowerShell mutant; refused consequence real; unanchored regex runtime semantics are a superset of the test model
9. [CLEAN][demonstrated] ac9cfd7 probes run the real copied hook; 34 rows identical to the report; 36/0/0; row-flip mutant 34/2
counts: issues=2 suspicions=2 clean=5
evidence: demonstrated=4 code-traced=4 derived=1
checks=3 files 32 pass/0 fail/0 skip; probes 36/0/0; K mutants M1 0/3, M2 1/2, M3 1/2, M3b 2/1, M4 3/0 (slip); AP-12+drift under M4 29/0; drift loosened 10/1; probe flip 34/2
adr=HIT(38)
report=docs/reviews/s308-J-entry-red-team-round2-2026-10-05.md
HEAD: ac9cfd7
