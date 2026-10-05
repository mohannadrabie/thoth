# Story K (#308): wiring plan for the live PreToolUse gate and the generated Edit denies

Date: 2026-10-05. Author: story-implementer (Ptah), Phase 1 only. Nothing here is written to .claude/settings.json or any settings file; no build, no commit of code. The human reserved wiring for explicit approval; this is what they approve or decline.

## 0. Gates before planning

- ADR catalog: `node docs/adr-cache.mjs --ensure` printed `ADR cache HIT: reused 38 ADR(s) ... [CACHE=HIT]`.
- Readiness: the inputs are enough to plan. Section 7 holds the questions that decide the build; none is a hidden requirement.
- ADR applicability:
  - THOTH-ADR-0003 (accepted 2026-10-05 by mohannadrabie, keeping the 2026-09-19 exemption): APPLICABLE. Its write-path list names every session write path; K is where the settings entry and the Edit denies close it. The un-routed arbitrary-exec built-ins stay the K decision (pendingHumanDecision in the proposal JSON).
  - THOTH-ADR-0001 (fixture as gate input, the 2026-09-19 exemption): APPLICABLE. The fixture's Edit deny is a K3 check item.
  - SE ADR-0005 (recorded acts): APPLICABLE. Any test or generated file K changes is a recorded act in docs/decisions.md.
  - No other catalog ADR (IaC, network, schema) touches this change. NOT-APPLICABLE: the devops domain; no infra is changed.
- Restated: wire the already-built, already-reviewed gate as the live PreToolUse hook, and make the session unable to edit the files that carry or protect it, using only generated text, after every precondition below is met and the human approves.

## 1. Exact K artifacts

Nothing is hand-typed where a generator exists. Counts below are from today's runs and are regenerated at K time (the proposed settings file has 48 Edit entries on this branch; the protected-path generator on the #429 worktree head reports 74, because #409, #429 and #446 add paths).

### 1.1 The settings PreToolUse entry (in the committed .claude/settings.json, next to the existing SessionStart and UserPromptSubmit entries, which stay unchanged)

Source: docs/plans/s308-K-proposed-entry-2026-10-05.json (proposedMatcher, proposedCommand, timeout). #429 makes that JSON derived from per-tool judgments; the matcher at K time is the derived string, expected `Bash|Monitor|PowerShell|RemoteTrigger|mcp__.*`. Shell form (J9 ruling), timeout 60:

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

P1 finding to record: the subagent tool reaches the hook as `Agent` (not `Task`). Task, Agent, SendMessage and Workflow are residuals under ruling 3, conditional on inner calls being gated; P1 measured that condition for Bash inside a general-purpose subagent (3 of 3 runs, background and foreground). Not measured: PowerShell or mcp__ from a subagent, nested subagents, other agent types, a bare `Task` matcher (not needed: Task is not routed).

### 1.2 The permissions.deny entries

- Generated, never typed: `node src/qa/protected-path-list.ts --write` regenerates the committed rules and docs/plans/s308-K-proposed-settings-2026-10-04.json; the same command without `--write` exits 1 on drift. K copies that file's `permissions.deny` array into the real settings file by script (item 1.4), then checks it.
- The existing Bash deny entries in .claude/settings.json (publish, force-push, namespace delete) stay. The new entries are the generated Edit(...) lines (project-relative `Edit(/...)`, plus the `~/` ones: `Edit(~/.claude.json)`, `Edit(~/.claude/settings.json)`, and the profile, skill, command, agent and plugin directories that #429 and #446 add).
- Live evidence for the rule form: J5 (project-relative rule blocks Edit and Write, also under bypassPermissions, unrelated-file negative control in P3), P2b (a `~/` rule and a Windows absolute-path rule block Edit and Write, Edit under bypass). Case-insensitive on Windows (P3).
- Open evidence: the literal `Edit(~/.claude/settings.json)` against the real user settings path was NOT probed (P2 not measurable); Write under bypass with the `~` rule, NotebookEdit and MultiEdit were not run. Stage 1 probes these (section 4).

### 1.3 Per-checkout linked-worktree targets (#442)

- Command: `node src/qa/protected-path-list.ts --print-worktree-targets`. On the #409 worktree it prints seven targets relative to that worktree: the common-dir .git/config, config.worktree, hooks/, info/attributes, modules/ and worktrees/, and the worktree's own config.worktree. (The flag exists on the #409 branch only; it is not on this branch until #409 merges.)
- These targets are machine-specific and differ per checkout, so they must NOT go in the committed .claude/settings.json. Emit them as Edit(...) lines into each linked worktree's .claude/settings.local.json (gitignored: it is on line 15 of .gitignore), by a human-run step, never by the session (that file is on the protected list).
- Unmeasured: whether an Edit rule with a `..` relative path or a `//` absolute path matches the common dir. Probe P-K4 in stage 1 decides which form the generator emits; until then the form is not fixed. If neither form works, #442 stays open and K ships with linked worktrees disclosed as unprotected for the common-dir config.

### 1.4 New files K writes (named, none exist yet)

- src/qa/k-settings-merge.ts: pure function plus CLI. Inputs: the current settings file text, the proposal JSON, the generated deny list. Output: the new settings text (existing keys untouched, hooks.PreToolUse appended, deny list = existing Bash entries plus generated Edit entries, sorted and de-duplicated). Dry run by default, `--write` for the human. Purpose: no hand-edited settings text.
- K3 check, `K3-edit-deny-covers-fixture`, over the REAL settings file: every generated protected path has an Edit entry; a seeded mutant that drops the fixture line (and one that drops a `~/` line) must fail.
- K5 check, `K-pretooluse-entry-uses-launcher`, over the REAL settings file: the entry command equals the pinned string byte for byte (including `sh`) and the matcher equals the derived one. Mutants (all must fail): bare `node <gate>`, trailing `|| true`, trailing `; exit 0`, `echo <launcher> <gate>`, `bash` for `sh`, PowerShell missing from the matcher, plus Monitor or RemoteTrigger missing (added by #429). This also closes #401.
- K2: after the edit, `qa:gate-command-path`, `qa:gate-launcher-pin`, `qa:gate-matcher-drift`, `qa:gate-manifest` and `qa:gate-latency-budget` green on the real file.
- A decisions row recording the human's approval (K1) and the CHANGELOG, docs/STATE.md entries. A runbook for kill-switch and verification in docs/runbooks (new file; no backticks until it exists).
- Edits to the "//" disclosure comment block at the top of .claude/settings.json are limited to stating that the gate is now wired and listing the disclosed residuals by reference (docs/plans/s308-K-proposed-entry-2026-10-05.md), no completeness claims typed by hand.

Test-first dispatch check: K changes no UI flow and no API surface (a config wiring and two qa checks). `test-writer` is NOT dispatched. K3 and K5 are written failing first by the implementer; the live verification in section 4 is the acceptance evidence.

## 2. Preconditions checklist

State as of 2026-10-05. "Generated" marks what a command produced; the rest is my reading of Issues and branches and should be checked by the K readiness script (item 2.4).

### 2.1 Open S7 Issues (query: `gh issue list --milestone "S7 - ..." --state open`, 22 open)

The milestone has no `k-blocker` label, so the K-blocker split below is my judgment from the Issue titles, STATE.md and decisions.md, not a generated fact. Recommend adding the label and making the readiness script query it (question 6).

| Issue | Sev | State today | Treatment at K | Owner |
|---|---|---|---|---|
| #406 NODE_OPTIONS env block fails open | high | Closes only with K (settings protection) | Closed by K itself; verify live (P-K3) | K |
| #408 E0 read-only shell | feature | Built, SHIPPABLE on s7/knockout, not merged | Must be on master before K (else K denies ls, cat, git status: J3) | human merges |
| #409 git/rg lever seal | med | In its worktree branch; round-1 fixes done (#440 and #441 fixed there); round-2 status not confirmed by me | Must merge before K; git and rg stay denied (POL-05) regardless | human merges |
| #440 submodule git dir unsealed | HIGH | Fixed on the #409 branch (0bd635a) | Closes with that merge | #409 |
| #441 preflight misses lever keys | med | Fixed on the #409 branch | Closes with that merge | #409 |
| #442 linked-worktree .git unprotected | med | Generator flag exists (#409 branch); K emission not built | K emits per checkout (item 1.3); needs probe P-K4 | K |
| #443 preflight exits 1 on a standard Git-for-Windows machine | med | Partly addressed on #409 (ambient exit split); referenced, not "Fixes" | Confirm with the preflight run at K (item 2.2) | #409 |
| #428 planted bare binary on PATH | HIGH | Built on its branch (shadow scan, fail closed); not merged | Must merge before K | human merges |
| #444 Windows trusts Program Files by PATH only | med | Open, not built | Activation-time writability probe of each trusted dir; human runs it at K (stage 0); or accepted as disclosed | K or #428 follow-up |
| #445 unlistable root-owned PATH dir denies | med | Fixed on the #428 branch (8eb0b91) | Closes with that merge | #428 |
| #446 shell profile files unprotected | med | Fixed on the #429 branch (ea391d2) | Closes with that merge | #429 |
| #424 exec built-ins routing | med | Built on the #429 branch (judgments, derived matcher, SendMessage) | Must merge before K; residuals stay a disclosed human decision | human merges |
| #429 every vendored tool judged | med | Built on the #429 branch | same | human merges |
| #435 read-deny for secrets and out-of-repo paths | feature | NOT built | Deferred K blocker per E0 verdict: with the gate wired, `cat .env` and `cat ~/.aws/credentials` are allowed reads. Needs a decision (question 3) | unowned |
| #437 recursive reads record one target | med | NOT built; "design inside #435" | Same as #435 | unowned |
| #438 kubeconfig exec block write side | med | Open; the preflight FINDING below is its read side | Human clears or accepts; see 2.2 | human |
| #436 UNC operand | med | Fixed (6d56e5a, E0) | Closes with E0 merge | E0 |
| #397 SystemRoot-derived reg.exe path | med | Ruled closed by settings protection | Closes at K | K |
| #410 multi-target read cap | med | Ruled: premise closed by ruling 2 | Close with a comment at E0 merge | Manager |
| #93, #107, #288 | med | S5/S6 follow-ups, not about wiring | Not K blockers (my judgment; confirm) | none |

Merge order proposal (human merges, in this order, each followed by a re-sync of the next): E0 (s7/knockout) first, then #409, #428, #429, each of which is built on the previous per the #429 merge commit 9b5b481. Then cut the K branch from the resulting master.

### 2.2 Preflight on this machine (generated; run from the #409 worktree, read-only, rc 0, today)

`node src/qa/git-rg-lever-preflight.ts` (npm script qa:git-rg-lever-preflight, on the #409 branch only):
- 1 FINDING (session-writable, must be cleared or accepted before activation): kubeconfig exec at C:\Users\<user>\.kube\config. Human action: remove or review the exec/auth-provider block, or accept it in writing in the K decisions row. K cannot protect it; it exists before activation (R3).
- 6 AMBIENT lines (printed, not counted; not session-writable): five system gitconfig lines at C:\Program Files\Git\etc\gitconfig (diff.astextplain.textconv, filter.lfs.clean, filter.lfs.smudge, filter.lfs.process, credential.helper) and GIT_EDITOR in the process environment. Disclosed in K's decisions row; no #443 acknowledgement path exists yet, so the "exit 1 on a standard machine" question is checked by re-running at K.
- 2 NOTE lines (known project hooksPath, .githooks pre-commit listed for review).
- Disclosed residuals the preflight prints: R1 shell profile files (now handled by #446), R2 managed settings and ambient environment not sealed, R3 pre-existing config outside the seal, R4 user-scope env reach not run live.
- Re-run at the K branch head on the machine where K is wired; a different machine or a scratch clone has its own findings.

### 2.3 Human ratifications and approvals pending

1. K itself: explicit approval recorded in docs/decisions.md with Human = Y (K1).
2. The Manager's rulings under pre-approval, rows dated 2026-10-04 and 2026-10-05, including the session rulings 1 to 3, and E0's decisions row (pending). The Manager recommended ratify; they stay pending until the human says so.
3. Disclosed for the human at K: story F has no red-team go after its round-2 no-go; F10 narrows kubectl grammar to `--context` only; residual built-ins (Task, Agent, SendMessage, Workflow, CronCreate, ScheduleWakeup, Skill, SlashCommand) are un-routed, conditional on inner calls gated or authorable content protected; the dev loop cannot run in a wired checkout (section 3).
4. The preflight finding (kubeconfig exec) cleared or accepted.
5. Spend approval for live verification (section 4.4).

### 2.4 Readiness instrument (proposed, built as part of K)

A read-only command `qa:k-readiness` that prints, in one run and exits 1 unless all pass: the open S7 Issues carrying the K-blocker label (gh), whether each fix branch is an ancestor of origin/master (git merge-base), the preflight result, protected-path-list drift, the four gate qa checks, the real settings file's matcher against the derived one, and the decisions row for K1. No checklist state is hand-typed; this section's table is a snapshot to be replaced by its output.

## 3. Kill switch and rollback

What the wired gate does, plainly: every Bash, Monitor, PowerShell, RemoteTrigger and mcp__ call goes through the gate; anything it cannot resolve is denied (POL-05). After E0 only read-shaped ls, cat, head, tail, wc, grep and kubectl-shaped calls resolve; git, rg, npm, node, the test runner and every build command are denied. So a wired session cannot run this repo's own development loop, including the agents that built the gate. Edit and Write of the protected paths are denied by the Edit rules, including the settings file, so the session cannot unwire itself. All of that is intended; the way out is outside the session.

The human's procedure (their own terminal, not a Claude session; none of these needs the gate):

1. Preferred, one command: `git -C C:\playground\thoth checkout -- .claude/settings.json` restores the committed unwired file if K's change is not committed. If K is committed to the branch, `git revert <K commit>` on the K branch (revert, do not force-push) and push; or locally, edit .claude/settings.json in an editor and delete the PreToolUse entry (the `hooks.PreToolUse` array) and the generated Edit lines.
2. Fastest, no edit to the committed file: start the next session with the project layer excluded or override locally. The settings key `disableAllHooks` exists in Claude Code and `--setting-sources user,local` exists as a flag; neither is measured for this gate (J used `--setting-sources project` only). Stage 1 measures both (P-K5); the runbook records only what it measures.
3. After the file is fixed, start a NEW Claude Code session in that checkout. Hooks are captured when a session starts, so an already-running wired session does not change when the file is edited from outside (documented behavior; not measured here, P-K5 measures it).
4. Verify unwired: the gate qa checks pass on a wired file too, so they do not show this. Use the runbook probe: `ls` is allowed in a fresh session.

Scope of the rollback: it restores the repo to its pre-K state. It does not undo the existing SessionStart and UserPromptSubmit hooks, which K does not touch.

Prevent self-lockout of the human's own tools: the human's commits and pushes run in their own terminal and are unaffected; only Claude sessions in a wired checkout are. A second checkout (or a scratch clone) with the unwired settings stays available as the development checkout (question 1).

## 4. Staged activation

### 4.1 Stage 0: human actions, no spend

1. Merge E0, #409, #428, #429 in that order (section 2.1); resolve or accept the kubeconfig finding; decide questions 1 to 4.
2. Cut the K branch from master. Build K3, K5, the merge script and the readiness command, failing first, plus the runbook.
3. Run the readiness command, the four gate qa checks (on the PROPOSED file via the merge script's dry run), the full suite with real counts, and the QA-14 diff-mode run.

### 4.2 Stage 1: scratch clone, wired, live (no change to this repo)

- A fresh clone of the K branch outside C:\playground\thoth (not the thoth-wt worktrees), with the merge script's output as its settings, the gate hosted from that clone, session started there with the harness from docs/qa/s7-live-probes/harness.
- Probes (each a named `claude -p` run with a ledger; model alias haiku as before):
  - P-K1 allow and deny: `ls` and `cat` of a repo file allowed (E0), `git status` denied, `kubectl get pods/x --context=c` allowed, a planted bare `kubectl` on a user PATH dir denied (#428), an mcp__ call allowed and denied.
  - P-K2 subagent: Bash, PowerShell and an mcp__ call inside a subagent (closes the P1 gaps), Monitor and RemoteTrigger refused.
  - P-K3 #406: a settings env block setting NODE_OPTIONS to an unknown flag is not writable by the session (Edit and Write refused), so the fail-open cannot be reached from the session.
  - P-K4 Edit-deny forms: the literal `Edit(~/.claude/settings.json)` on the real user path with a read-only before and after hash (no content read); Write under bypassPermissions; NotebookEdit and MultiEdit; the linked-worktree target forms (`..` relative and `//` absolute) against a real linked worktree of the scratch clone.
  - P-K5 kill switch: remove the entry from outside; confirm a running session keeps the old hooks, and a new session is unwired; measure `disableAllHooks` and `--setting-sources user,local`.
  - P-K6 operability: record exactly which everyday commands the wired session can still run (the table the human sees), and time the allow path (J6 budget).
- Pass criteria: all P-K1 to P-K5 outcomes as stated, each with a deny reason attributed by content (the gate's text), hashes unchanged on every protected-path run.
- Spend: J averaged about USD 0.024 per call (39 calls, USD 0.99); this session's probes 0.037 per call. About 30 to 35 live calls: estimate USD 0.80 to 1.30. Propose a hard cap of USD 1.50, checked by the runner before each run, ledger file kept.

### 4.3 Stage 2: this repo

- Only after stage 1 passes and its report is reviewed. The K branch's settings change goes to master as a PR the human merges. Then, in a fresh session, run a short verification (about 8 calls, about USD 0.30): the allow, the deny, the Edit refusal of .claude/settings.json, and the kill-switch dry run (revert in a scratch copy, not in the live file).
- Linked worktrees: for each existing worktree (thoth-wt409, -wt428, -wt429 and any new one), the human runs the item 1.3 step to write its settings.local.json; or the worktree is retired first. A worktree without it has the common-dir config unprotected (#442 disclosed).
- Total live spend for stages 1 and 2: cap USD 2.00, expected about 1.6.

### 4.4 Rollback points

Stage 1 changes nothing here; rollback is deleting the clone. Stage 2 rollback is section 3.

## 5. Tier and reviewers

- Tier proposed: CRITICAL. Justification: it makes the policy gate live for every session and changes the settings and deny rules that protect the gate itself (named sensitive areas: policy enforcement, policy delivery, secret and CI gates by reach), prod-facing in the sense that a mistake locks the session or leaves the gate bypassable. Manager ratifies.
- Reviewers: red-team (adversarial: attempts to unwire from inside the session, bypass mode, planted-before-activation config, each residual built-in), app-security-reviewer (authz of the deny rules and the matcher derivation), cross-domain-reviewer (standing; whole ADR catalog, seams between the four in-flight stories and K). Optional fourth, architecture-reviewer, only if question 2 is answered with a design change. Fresh dated reports in docs/reviews are required (sensitive area hard rule); verification by `/maat:verify` after the live stage.
- No `test-writer` (section 1.4).

## 6. Verification plan, every criterion mapped to a named check

| # | Acceptance criterion (derived ones marked D) | Check |
|---|---|---|
| K1 | Human approval recorded, Human = Y | decisions row, read by qa:k-readiness |
| K2 | The four gate qa checks (plus latency budget) green on the real file | the npm scripts named in item 1.4, run after the write |
| K3 | Every protected path has an Edit entry in the real file; a dropped line fails | K3-edit-deny-covers-fixture and mutants |
| K4 | ADR gate: acceptance recorded | decisions row 2026-10-05 (exists); readiness check |
| K5 | The entry equals the pinned form; matcher equals the derived one | K-pretooluse-entry-uses-launcher, 7 mutants |
| D6 | Settings text is generated, not hand-edited | merge script dry run equals the real file (test) |
| D7 | Per-checkout targets emitted and probed | P-K4, runbook step |
| D8 | Kill switch works as documented | P-K5 |
| D9 | Every precondition in section 2 is met | qa:k-readiness exit 0 |
| D10 | Wired gate allows and denies as designed through the real runtime | P-K1, P-K2, P-K3, P-K6 |

Failures found live become failing tests first, then fixes (findings arrive as failing tests).

## 7. Blocking questions, ranked by build impact, with recommended answers

1. **Committed settings or local settings, and where does development continue?** Wiring the committed .claude/settings.json turns the gate on for every checkout and every agent worktree, and a wired session cannot run git, npm or node (section 3). Recommend: commit the wiring (the K5 and K3 checks read the real committed file), keep one unwired scratch or "dev" clone for building and reviewing, and run governed sessions only from wired checkouts. The alternative, wiring only settings.local.json, is untracked, unreviewed and unreadable by CI.
2. **Is it acceptable that E0 only is merged, and git, rg, npm, node stay denied?** Recommend yes: the #409 seal exists so they can be re-added later; K must not wait for a re-add story.
3. **#435 and #437 (read-deny for secrets and out-of-repo paths; recursive reads): block K, or ship K with them disclosed?** With the gate wired and E0 merged, `cat .env` and `cat ~/.aws/credentials` are allowed, which is more than today's un-gated state only in the sense of being labelled allowed; they are not more reachable (the Bash tool has no other restriction today). Recommend: do NOT block K on them, because K adds protection without removing any; disclose, and ship them as the next story. If the human wants secrets unreadable at K, the story must build before K and design #437 inside it.
4. **The kubeconfig exec finding (#438) and the six AMBIENT lines:** recommend the human reviews ~/.kube/config now (a program that runs when kubectl authenticates) and accepts the ambient lines in the K decisions row, since they are not session-writable.
5. **#444 (Program Files writability on Windows):** recommend ship K with a one-time human-run probe at activation (stage 0) and the residual disclosed, rather than building a probe into the gate.
6. **Add a `k-blocker` Issue label** so the readiness command queries a fact and not my reading of titles. Recommend yes; the human or the Manager creates it (not done here).
7. **Residual built-ins (Task, Agent, SendMessage, Workflow, CronCreate, ScheduleWakeup, Skill, SlashCommand):** recommend accept as ruled (ruling 3), with the P-K2 results recorded; if P-K2 shows the gate does not fire for PowerShell or mcp__ inside a subagent, K is blocked and the question returns to the human.
8. **Merge order and who merges:** E0, #409, #428, #429, human merges (CLAUDE.md human-only). Recommend that order; confirm.
9. **Spend:** cap USD 2.00 for both stages (expected about 1.6). Recommend approve.

## 8. Single next action

The human answers questions 1 to 9 (at least 1, 3, 8 and 9 and the merge of E0 first), after which Ptah builds K3, K5, the merge script, the readiness command and the runbook on a K branch cut from master, failing first, and stops before any wiring for the human's approval of the stage 1 result.
