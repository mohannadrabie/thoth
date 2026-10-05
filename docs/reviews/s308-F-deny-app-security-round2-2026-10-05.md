# #308 story F - application security review, ROUND 2 (re-confirm)

[app-security-reviewer]
App Security Reviewer (Horus). CRITICAL tier. Delta 9e238c5..4ad9f87 (HEAD 4ad9f87). HELD behind THOTH-ADR-0003 (not a finding).
📊 ADR cache HIT: reused 38 ADR(s) [CACHE=HIT]. No applicable security ADR standard violated by the delta.

Method: own detached worktree at 4ad9f87 with a node_modules junction (removed at the end; main node_modules verified intact). Probed the committed shipped-defaults.json through kernel decide with resolvable records (as in round 1) and the real normalizeShellCall. Ran `node src/qa/protected-path-list.ts` (PASS, 45 paths) and `node --test` on activation-preconditions, path-canonical, shell-binary-closed-set, shell, baseline-rules, fixture-notes, fixture-name-triage: 93 pass / 0 fail / 0 skipped.

## Verdict: APPROVE-WITH-CONDITIONS

Round 1 findings #415, #416, #417 are resolved as stated. One new MED (the #417 instrument misses .mcp.json and ~/.claude.json) and two LOWs. Exposure today 0% of requests (F8 makes every redirect write unresolved, POL-05 denies first); no blocker.

## Round 1 findings re-confirmed

| # | Result | Evidence (demonstrated) |
|---|---|---|
| 415 parent dirs | RESOLVED | move/delete/rename -> deny on hooks, hooks/, src, src/policy, src/policy/config, src/policy/kernel, src/qa, docs, docs/qa, .thoth, .claude and backslash forms; 15 parent dirs generated. Not over-broad: write on src/policy/config/new-file.ts, src/policy/kernel/newfile.ts, src/qa/other.ts, docs/qa/other.json, hooks/other.mjs -> allow; protected files and .thoth/halt-state/* write -> deny. |
| 416 aliases | RESOLVED | loader.ts. , trailing space, "loader.ts. . " and loader.ts... canonicalize to the protected path and deny. ':' segments (a.ts::$data, c:a, a/b:c/d) set pathFormIssue (unresolved). Host check (cmd.exe): `type loader.ts.` opens the file (the fold is needed); interior segments with trailing dot or space (and ".. ", ". ") do NOT alias on this host, so the per-segment fold is a harmless over-fold. A dots-only segment is left alone and does not resolve on this host. |
| 417 read-by-path | RESOLVED for the reported file; GAP for two others (finding 1) | docs/qa/tool-inventory.json is on the list and denied. The stated limit (caller-supplied parameter path) is honest, but it is not the only blind spot. |

## New findings

1. MED, demonstrated + code-traced. readByPathCandidates (src/qa/protected-path-list.ts, join/resolve branch) recognizes a first argument that is a string literal, a *dir identifier, or dirname(...). hooks/sessionstart-tool-enum.mjs:463,470 read join(projectDir(), ".mcp.json") and join(homeDir(), ".claude.json") (first argument is a call to projectDir()/homeDir()), so neither is found. Probe of protectedPaths(root).all: neither .mcp.json nor ~/.claude.json is on the list (45 paths). These are the MCP-declaration inputs CLAUDE.md names under "Halt-state directory" as secrets-adjacent. Attack sketch: once a producer resolves a write, a session edits .mcp.json and no deny rule fires. Effect is bounded (project servers count only when enabled in the protected settings file; a malformed file halts via SUR-03), hence MED. Exposure: ~0% of requests today (POL-05 denies first), basis: counted in code (2 of the 7 distinct read-by-path files in the hook closure are unlisted). Fix: add both to namedPaths and widen the first-argument match to any projectDir()/homeDir() call. Test: F2c-sessionstart-mcp-inputs-protected. A complete instrument would list every readFileSync/existsSync call site in the closure against the list; the current one is a heuristic.
2. LOW, code-traced. wiredHookScripts reads only project settings.json and settings.local.json; hooks wired in ~/.claude/settings.json or managed settings are not enumerated. A wired non-JS script is listed but not walked. A command naming a project script plus an absolute one lists only the project one. Fix: disclose in the header (the fail-closed throw covers only "no project script at all").
3. LOW suspicion, derived. The CLAUDE_PROJECT_DIR capture with ".." segments can leave the repo and is then resolved as repo-relative. Developer-time tool reading an already-protected repo file; the command string is never executed. One-line note only.

## Checked and sound

- F9 (#420): binary token must be exactly kubectl. Probe of 20 shapes: node, python, ./kubectl, KUBECTL, kubectl.exe; env/nohup/time/timeout/exec/nice/command/builtin/sudo wrapping node; bash -c with env python; &&, |, $(...), braces, parens joins; tab separation -> all unresolved (deny). A backslash-escaped kubectl and a quoted kubectl resolve, correctly: the shell runs the same binary. Authz is fail-closed; a PATH-planted kubectl is the launcher/PATH residual, already disclosed.
- Settings walk (#419): JSON.parse of a repo file plus a regex over command strings; the command is never executed, passed to a shell, or used as a regex source; capture class is linear (no ReDoS); a malformed shape throws (fail closed). No injection or trust problem. Both wired hooks and their closure (mcp-enumeration.ts, halt-state paths) are now on the list.
- #418 require/createRequire walk: static read only (mutant is the red-team lane); the factory name is spelled plainly and the R1-6b/R1-6d scan passes unchanged (tests green, no exemption added).
- CHANGELOG discloses that the Edit(...) deny covers built-in file tools only and that Bash writes depend on the gate rules and POL-05 (round 1 finding 4 resolved).
- Round 1 LOWs 5 (glob targets) and 6 (PROTECTED_VERBS pin) were deferred by the Manager; still POL-05-covered today.

## Blockers vs hardening
Blockers: none. Hardening: finding 1 (before E0), 2, 3.

## Next action
Add .mcp.json and ~/.claude.json to the protected list (finding 1) before E0 makes a write resolvable.

## Editorial
None.

Findings = failing tests: 1 open [ISSUE][MED] with named test F2c-sessionstart-mcp-inputs-protected; finding 2 (LOW) and 3 are disclosure-text items with no executable form.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] src/qa/protected-path-list.ts (readByPathCandidates join branch) - .mcp.json and ~/.claude.json read by sessionstart-tool-enum.mjs:463,470 via join(projectDir()/homeDir(), lit) are missed; not on the 45-path list; add named paths and widen the first-arg match
2. [ISSUE][LOW][code-traced] src/qa/protected-path-list.ts wiredHookScripts - user/managed-settings hooks not enumerated; wired non-JS scripts not walked; disclose
3. [SUSPICION][LOW][derived] src/qa/protected-path-list.ts wiredHookScripts - CLAUDE_PROJECT_DIR capture with .. can leave the repo; developer-time only, note it
4. [CLEAN][demonstrated] #415 resolved: parent-dir move/delete/rename deny; file writes beside protected files still allow
5. [CLEAN][demonstrated] #416 resolved: trailing dot/space fold and ':' unresolved; interior-segment aliases do not exist on host (harmless over-fold)
6. [CLEAN][demonstrated] #417 resolved for tool-inventory.json (see finding 1 for the remaining gap)
7. [CLEAN][demonstrated] F9 (#420) fail-closed over 20 binary/wrapper/join shapes
8. [CLEAN][code-traced] settings parse is JSON.parse plus linear regex, command never executed; fails closed on malformed shape
9. [CLEAN][code-traced] CHANGELOG discloses Edit() covers built-in tools only, not Bash
counts: issues=2 suspicions=1 clean=6
evidence: demonstrated=5 code-traced=3 derived=1
checks="93/0/0"
adr=HIT(38)
report=docs/reviews/s308-F-deny-app-security-round2-2026-10-05.md
HEAD: 4ad9f87
