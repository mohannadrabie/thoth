# Red team, round 3: #429 / #424 / #446 (CRITICAL, S7), 2026-10-05

- **Reviewer:** red-team (Sutekh).
- **Scope:** branch `s7/knockout-429`, `7d9b2e7..a329cde` (b0c9ac7 RED, a329cde fix). Worktree `C:/playground/thoth-wt429`, read-only.
- **ADR cache:** HIT (38).
- **Not attempted (per Manager):** live writes into the user Claude config directory; reads of any `settings.json`.

## Verdict: go

No HIGH remains. One new MED (the extractor passes on a partial extraction) and one MED suspicion (settings-named scripts outside protected roots) are tracked, not gating. The gate is unwired and K is held, so live exposure is 0% now.

## Checks run

| Check | Result |
| - | - |
| `node --test` claude-code-write-deny + tool-exec-judgment + activation-preconditions + arbitrary-exec-classification (wt429, a329cde) | 64 pass / 0 fail / 0 skip |
| CC-installed-extraction-fully-judged (local binary 2.1.267) | ran, not skipped: 31 user + 12 project entries, all judged |
| Mutant M1 (scratch worktree): extractor pre-anchor window `6000` to `0` | extraction drops to 27 user entries; claude-code-write-deny.test.ts 5 pass / 0 fail / 0 skip (mutant survives) |
| Kernel probe: 22 Bash write shapes into session-env and sibling paths, real `normalize` + `decide` | 22/22 deny (redirect shapes by `protect-home-claude-session-env`, including case, `./` and `..` variants; other shapes fail closed via POL-05) |
| Existence check (stat only) of `statusline-command.sh` and three siblings in the user Claude config dir | absent |
| Claude Code docs, permissions page | `/path` anchors at the primary working directory in project settings; Edit rules use gitignore syntax with `**` |

Scratch worktree removed after the mutant; `thoth-wt429` untouched.

## Findings (ranked by exposure x irreversibility x silence)

### 1. [ISSUE][MED][demonstrated] The extractor passes green on a partial extraction
- **Scenario:** Claude Code auto-updates. The minifier moves a list, or a new harness-loaded entry lands in a shape or offset the extractor does not read. Fewer entries are extracted. `unjudged()` checks only extracted-minus-judged, so a shorter list is still "fully judged". The new entry is never judged or protected, and nothing fails.
- **Evidence:** mutant M1 drops 4 entries (31 to 27); the suite stays 5/5 green.
- **Code:** `src/qa/claude-code-write-deny-extract.ts:79-87` (`unjudged` is one-directional); `src/qa/claude-code-write-deny.test.ts:19` (version only checked non-empty, never compared to the installed binary); `:66` (sanity check names only three entries).
- **Also:** the installed-binary test skips in CI (ubuntu, no binary). Re-running it on the K-activation Claude Code version is not a K release-gate item. CHANGELOG says "a layout change fails loudly", but only a lost anchor or end mark throws.
- **Defense now:** the anchor or end-mark throw catches a gross layout change only.
- **Exposure:** 0% of current entries (31/31 extracted, measured). For a future version that shifts the layout, 100% of runs of this check pass vacuously (measured by mutant). How often releases shift the layout is unmeasured.
- **Failing test required:** `CC-extraction-covers-judged`. Every judged entry must be extracted from the installed binary, and an installed version different from `claudeCodeVersion` must fail, demanding re-judgment. Add a K release-gate line: run the extractor on the activation version.

### 2. [SUSPICION][MED][code-traced] Scripts named by settings, outside protected roots, are not enumerated
- **Scenario:** a `statusLine` command, a user-level hook command, or an `apiKeyHelper` / `awsAuthRefresh` / `otelHeadersHelper` names a script file. The harness runs that script outside the gate. Settings files are protected, but the script they name is protected only if it sits under a protected directory.
- **Evidence:** the Claude Code status-line setup flow writes `statusline-command.sh` at the root of the user config dir and references it from settings (string present in the 2.1.267 bundle). That file is on no protected list.
- **Code:** `src/qa/protected-path-list.ts:109-131`. `wiredHookScan` reads hooks from project settings only. It reads no user-level settings and no `statusLine` or helper fields. The extracted list is the Claude Code sandbox list, not the set of things the harness executes. The K md does not disclose this limit.
- **Measured:** the default status-line script is absent on this machine. User-level settings were not read (classifier-blocked).
- **Status:** UNPROVEN-pending-verification. Settle it with a read-only enumeration, run by the human, of every command-bearing field (`statusLine.command`, `hooks.*[].hooks[].command`, `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `otelHeadersHelper`) in the user and project settings files. Each script path found must be on the protected list or listed as a residual.
- **Failing test required:** `F1-settings-named-scripts-judged`.

### 3. [SUSPICION][LOW][code-traced] Lowercased K Edit entries now cover a mixed-case file
- `Edit(~/.claude/claude.md)` stands for the real file `CLAUDE.md`. The case-matching spike item in the K md names only the PowerShell profile entries.
- The bundled `ignore` library defaults to case-insensitive matching, which suggests the entry matches. The options the permission matcher actually passes were not traced.
- **Fix:** extend the K spike line to every lowercased entry, on Linux as well as Windows.

### 4. [CLEAN][demonstrated] #451 is closed
- `~/.claude/session-env/` is a named path with the shipped rule `protect-home-claude-session-env` and both K Edit entries.
- F1-session-env-dir-protected passes.
- The 22-shape kernel probe denies every shape.

### 5. [CLEAN][code-traced] The extractor is read-only and every extracted entry is judged
- It only reads (`existsSync`, `readFileSync`) and never executes the binary.
- A missing anchor or end mark throws.
- 31 user entries, 12 project entries and `.mcp.json` all carry a judgment: 26 user entries protected, 5 residual with reasons.
- The `~/.claude/projects/` auto-memory cost is disclosed as a human decision for K.

### 6. [CLEAN][code-traced] The glob Edit entries are well-formed, pinned and recorded as a spike
- `Edit(/**/.claude/<dir>/**)` for seven directories.
- In project settings, the Claude Code docs anchor `/` at the primary working directory and accept `**` (gitignore syntax).
- Pinned by F1-nested-edit-globs-in-proposal and excluded from the F5 per-path mutant loop.
- Matching is a K release-gate live spike in the K md.

### 7. [CLEAN][demonstrated] The enumerator is case-insensitive and its link limit is disclosed
- F1-nested-skill-dirs-enumerator-case-and-links passes.
- The K md and the Skill judgment both disclose that symlinks and junctions are not followed.

### 8. [SUSPICION][LOW][derived] Alias-pair completeness beyond Task/Agent is unprobed (carried from round 1)

## Scariest unproven assumption
The set of things the harness executes outside the gate is assumed to equal the Claude Code sandbox write-deny list plus the project hooks. Scripts named by settings fields are outside both.

## Next action
Add `CC-extraction-covers-judged` (bidirectional check plus version pin). Have the human run the read-only settings command-field enumeration before K.

## Editorial
- CHANGELOG round-2 entry: "a layout change fails loudly" overstates the guarantee; only a lost anchor or end mark throws.
- `src/qa/protected-path-list.ts:446-449`: two consecutive doc comments. The `buildSettingsProposal` comment now sits above `NESTED_EDIT_GLOBS`.

RECEIPT: verdict=go
attacks:
1. [ISSUE][MED][demonstrated] extractor passes on partial extraction: mutant window 6000 to 0 drops 31 to 27 entries, suite stays green; unjudged() one-directional, version never compared, CI skips
2. [SUSPICION][MED][code-traced] settings-named scripts (statusLine, user hooks, apiKeyHelper-class helpers) run outside the gate and are not enumerated; default statusline script absent here; user settings unread
3. [SUSPICION][LOW][code-traced] lowercased Edit(~/.claude/claude.md) for CLAUDE.md; case spike names only PowerShell entries
4. [CLEAN][demonstrated] #451 closed: named path, shipped rule, K Edit entries, test green, 22/22 Bash shapes deny
5. [CLEAN][code-traced] extractor read-only, throws on lost anchor/end mark, all 31+12+.mcp.json entries judged
6. [CLEAN][code-traced] glob Edit entries well-formed per docs, pinned by test, matching recorded as K live spike
7. [CLEAN][demonstrated] enumerator case-insensitive; symlink/junction limit disclosed; test green
8. [SUSPICION][LOW][derived] alias-pair completeness beyond Task/Agent unprobed (carried)
counts: issues=1 suspicions=3 clean=4
evidence: demonstrated=3 code-traced=4 derived=1
checks=64 pass/0 fail/0 skip (4 #429 suites); mutant M1 survives (5/0/0); kernel probe 22/22 deny
adr=HIT(38)
report=docs/reviews/s429-red-team-round3-2026-10-05.md
