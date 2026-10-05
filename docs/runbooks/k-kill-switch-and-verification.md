# Runbook: story K gate wiring, kill switch and verification

Scope: #308 story K (wiring the policy gate into this repo's committed `.claude/settings.json`). Stage 0 built the tooling only; nothing is wired yet. Plan: `docs/plans/s308-K-wiring-plan-2026-10-05.md`. Every command below is for the human's own terminal, not a Claude session in a wired checkout.

This runbook states only measured facts and instructions. Two settings-based escape hatches are not measured yet; they appear only under "Unmeasured until P-K5" at the end.

## 1. What the wired gate does

Every Bash, Monitor, PowerShell, RemoteTrigger and `mcp__` call goes through the gate; anything it cannot resolve is denied. Edit and Write of the protected paths are denied by generated Edit rules, including the settings file, so a session cannot unwire itself. A wired session therefore cannot run this repo's own development loop. Keep one unwired checkout for building and reviewing.

## 2. Check readiness (read-only)

```
npm run qa:k-readiness
```

It prints one row per precondition (PASS, FAIL or MISSING) and exits 1 unless every row passes. It is red by design until K is wired. Open blockers come from the `k-blocker` Issue label; if the label is missing or `gh` is unavailable the row fails.

Disclosed residual: the blocker row accepts an empty list only when two independent `gh` queries agree. If GitHub's list endpoints show list lag on both at once (for example right after you edit labels), a stale empty answer could pass. Re-run readiness after any label edit, and again just before wiring.

## 3. Build the settings text, never by hand

```
node src/qa/k-settings-merge.ts                 # dry run: prints the merged settings, writes nothing
node src/qa/k-settings-merge.ts --write         # human only: writes .claude/settings.json
npm run qa:k3 -- .claude/settings.json          # every protected path has its Edit deny entry
npm run qa:k5 -- .claude/settings.json          # the PreToolUse entry equals the pinned launcher command
```

Both checks take a settings-file path (default `.claude/settings.json`).

## 4. Per-worktree emission step (linked worktrees, human-run)

A linked worktree's git config lives in the common dir outside the project root, so it is not in the committed rules. For each linked worktree, run from that worktree, in your own terminal:

```
node src/qa/protected-path-list.ts --print-worktree-targets --form=relative
node src/qa/protected-path-list.ts --print-worktree-targets --form=absolute
```

`--form` is required (without it the command exits nonzero and prints nothing). A main checkout prints nothing and says so on stderr. Which form Claude Code honors for a path outside the project root is settled by stage 1 probe P-K4; until then, paste the chosen form's lines into that worktree's `.claude/settings.local.json` `permissions.deny` array yourself. That file is gitignored and protected, so a session must not write it.

## 5. Kill switch (rollback)

Run in your own terminal. None of it needs the gate.

1. Not yet committed: `git -C <checkout> checkout -- .claude/settings.json` restores the unwired file.
2. Committed: `git revert <K commit>` on the K branch and push (never force-push). Or edit `.claude/settings.json` and delete the `hooks.PreToolUse` entry and the generated Edit lines.
3. Then start a NEW session in that checkout. Rule of thumb for this repo: start a NEW session after any settings change.
4. Verify unwired: in the fresh session, `ls` is allowed. The gate qa checks pass on a wired file too, so they do not prove the unwired state.

Rollback restores the pre-K state. It does not touch the existing SessionStart and UserPromptSubmit hooks.

## 6. Unmeasured until P-K5

Not measured for this gate, so not relied on anywhere above. Stage 1 probe P-K5 measures them, and this section is rewritten with the results.

- Whether setting `disableAllHooks` turns the gate off for a session.
- Whether starting a session with `--setting-sources user,local` leaves the project-layer gate unloaded.
- Whether an already-running wired session keeps its old hooks after the file is edited from outside.
