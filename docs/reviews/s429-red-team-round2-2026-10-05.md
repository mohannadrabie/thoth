# Red team, round 2: #429 / #424 / #446 (CRITICAL, S7), 2026-10-05

- **Persisted by the Manager (Osiris) as backstop.** The red-team agent (Sutekh) finished its review, but a safety classifier stopped its turn while it was writing this file, so nothing reached disk. This file records the agent's RECEIPT as returned to the Manager. Detail is limited to what the receipt states.
- **Scope:** branch `s7/knockout-429`, commits 8351be5 (RED), 2ca5668 (fix, #448 #449 and LOWs), 7d9b2e7 (lint), plus a check that merge da96977 kept the #429 entries.
- **ADR cache:** HIT (38).
- **Blocked by the classifier and not retried:** one live write probe into the session's own Claude config directory, and one read of the project's `.claude/settings.json`.

## Verdict: no-go

## Findings (from the receipt)
1. [ISSUE][HIGH][code-traced] `~/.claude/session-env/` is unprotected: a sibling of #448. Traced in the shipped Claude Code code, not demonstrated live. Exposure: latent, 0% today (gate unwired, K held); basis: code-traced. Issue #451.
2. [ISSUE][MED][code-traced] The #449 residual is honest, but its justification overstates the limit. Claude Code's Edit permission rules accept `**` globs, so the Edit/Write path for nested `.claude/{skills,commands,agents}` can be denied in K's proposal even though kernel rules cannot express it. Tracked on #449.
3. [SUSPICION][MED][code-traced] Claude Code's own sandbox write-deny list names more `~/.claude` and `.claude` entries than the protected list covers. Which of them execute is unproven.
4. [ISSUE][LOW][code-traced] The nested-dir enumerator skips symlinks and junctions, and matches only lowercase `.claude`.
5. [SUSPICION][LOW][code-traced] The PowerShell profile Edit-deny entries are lowercased; correctness depends on case-insensitive matching. Fold into the K live spike.
6. [CLEAN][demonstrated] #448 closed for every Bash write shape tried (26/26 deny) and for the K Edit entries.
7. [CLEAN][code-traced] Snapshot creation happens in the harness process, outside the gate, and is unaffected.
8. [CLEAN][demonstrated] Merge da96977 keeps the #429 entries; generator drift check PASS (79 paths); tests green.
9. [CLEAN][code-traced] The enumerator is read-only and excludes `node_modules` and `.git`.
10. [CLEAN][demonstrated] The profile and instrument LOWs are closed by passing tests.
11. [SUSPICION][LOW][derived] Alias-pair completeness beyond Task/Agent is still unprobed (carried from round 1).

## Checks
- tool-exec-judgment + activation-preconditions: 37 pass / 0 fail / 0 skip.
- arbitrary-exec-classification + k-matcher-covers-arbitrary-exec: 22 pass / 0 fail / 0 skip.
- Generator drift check: PASS, 79 protected paths.
- Bash write shapes into the snapshot directory: 26/26 deny.

RECEIPT: verdict=no-go
attacks:
1. [ISSUE][HIGH][code-traced] ~/.claude/session-env/ is unprotected; sibling of #448 (filed #451)
2. [ISSUE][MED][code-traced] #449 residual justification overstates the limit: a glob Edit-deny rule could cover nested dirs
3. [SUSPICION][MED][code-traced] Claude Code's sandbox write-deny list names more ~/.claude and .claude entries than the protected list covers
4. [ISSUE][LOW][code-traced] enumerator skips symlinks/junctions and matches only lowercase .claude
5. [SUSPICION][LOW][code-traced] PowerShell Edit-deny entries lowercased; fold into the K live spike
6. [CLEAN][demonstrated] #448 closed for every Bash write shape tried (26/26) and the K Edit entries
7. [CLEAN][code-traced] snapshot creation outside the gate, unaffected
8. [CLEAN][demonstrated] merge keeps #429 entries; drift PASS; tests green
9. [CLEAN][code-traced] enumerator read-only, excludes node_modules and .git
10. [CLEAN][demonstrated] profile and instrument LOWs closed by passing tests
11. [SUSPICION][LOW][derived] alias-pair completeness unprobed (carried)
counts: issues=3 suspicions=3 clean=5
evidence: demonstrated=3 code-traced=7 derived=1
checks=59 pass/0 fail/0 skip; drift PASS; 26/26 write shapes deny
adr=HIT(38)
report=docs/reviews/s429-red-team-round2-2026-10-05.md (Manager-persisted backstop)
