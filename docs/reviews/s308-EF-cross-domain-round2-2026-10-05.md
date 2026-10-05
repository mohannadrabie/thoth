# s308 stories E and F - cross-domain review ROUND 2 (Ra)

[cross-domain-reviewer] Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes
Delta 9e238c5..4ad9f87 (2a24f1e E conditions #412-#414; 6dba729 F conditions #415-#420; 4ad9f87). CRITICAL, HELD behind THOTH-ADR-0003 (proposed; not a finding). Read at the commit via git archive into a scratch tree (removed at the end).
ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 702b16a) [CACHE=HIT]. Whole catalog, unfiltered.

## Lanes
- app-security round 2 (s308-F-deny-app-security-round2): #415/#416/#417 and F9 shapes, plus its own new MED (.mcp.json and ~/.claude.json not in the read-by-path scan). Not re-listed.
- Ground here: round-1 findings #413 and #419, the fixes seams with ADR-0001/0003, K, the runbook, E0, CHANGELOG/STATE/plan.

## Round 1 confirmations
| Round 1 item | Result |
|---|---|
| E finding 1 (#413) stale "no shipped rule matches a class" | Resolved in the two sentences named; test passes. But the header reword opened finding 1 below. |
| F finding 1 (#419) wired hooks and mcp-enumeration.ts unprotected | Resolved: protectedPaths now 45 paths; the SessionStart hook, UserPromptSubmit hook, mcp-enumeration.ts and tool-inventory.json are on the list, with Edit entries in the K proposal. qa:protected-path-list PASS. |
| F finding 2 (Q2 narrowing) | Recorded in decisions row 2026-10-05 item (3); #408 gains a criterion. Resolved. |
| F finding 3 (qa script not in ci.yml) | Deferred LOW by the Manager row. Unchanged. |

## ADR verdict (whole catalog, 38)
- THOTH-ADR-0001/0003: the #413 edit changes notes only. central-classification.ts:72 says notes are ignored by the loader, so no entry, label or gate outcome changes. It is not an entry change, so the CLAUDE.md entry exemption does not cover it; the fresh dated report requirement is met by this report plus the round-1 report that requested the edit. No collision.
- THOTH-ADR-0003 rule 4 (no hardcoded names): the new fixture-notes test derives "matches none" from the fixture; fixture-name-triage PASS. Hold rule honoured.
- SE ADR-0005 (recorded acts): PT-2/PT2-mutant, SUR-07 and path-canonical expectation changes are listed in the CHANGELOG and decisions row 2026-10-05; 60 of 60 shell mutants killed.
- SE ADR-0021 (tool-agnostic record fields): F9 narrows what the normalizer resolves, not the record schema. No collision.
- SE ADR-0002/0010, ADR-0016/0019/0020: OK (kernel-purity, registry-purity, hook-typecheck-coverage PASS, both hooks 0 diagnostics).
- devops ADR-0001..0010 and remaining SE ADRs: not applicable. No ADR collision.

## Seam findings

### 1. [ISSUE][MED][code-traced] #413 reword dropped the Bash baseline-allow precondition (Issue #422)
- hooks/pretooluse-kernel-gate.mjs:11-14 now lists the unmet preconditions as a refreshed tool inventory, the deny rules (story F) and the launcher-level residuals, and says "Baseline allow content has shipped". The only shipped allow is baseline-allow-class-read-only (shipped-defaults.json:5, the sole baseline id); the Bash verb allow is withheld until E0 (#408), and decisions row 2026-10-04 says E0 blocks K.
- .claude/settings.json:73,76,120 still says baseline allow content (AP-1) is not built and that wiring now would deny ordinary Bash. The two files now contradict each other; the header is the one operators read before wiring.
- Domains in tension: hook documentation (E, #413 fix) vs activation preconditions (E0/K). The test fixture-notes-do-not-claim-no-shipped-class-rule only forbids the old phrase, so it cannot catch the omission.
- Exposure: ~100% of readers of the header (1 file), basis: counted in code. No enforcement effect; K is human-gated.
- Minimal fix: add one clause to the header: Bash baseline allow (read-only commands) is still unmet: E0 / Issue #408. Name it in the K checklist.
- Failing test: gate-header-lists-bash-baseline-allow-as-unmet (header must name #408 or E0 while shipped-defaults.json holds no verb-only allow rule).

### 2. [ISSUE][LOW][demonstrated] #419 walk reads .claude/settings.local.json, a gitignored per-machine file
- .gitignore:15 ignores it; wiredHookScripts (protected-path-list.ts) reads it and throws on any command that names no CLAUDE_PROJECT_DIR script.
- Demonstrated in the scratch tree: a local file with one powershell -File C:/Users/me/notify.ps1 hook makes node src/qa/protected-path-list.ts throw and node --test src/policy/config/activation-preconditions.test.ts fail (tests 1, pass 0, fail 1, skipped 0). Removing the file returns PASS (45 paths).
- Effect: npm test goes red on a machine with a personal local hook; a local hook naming a project script changes the generated list on that machine only, so --write there produces rules that differ from CI.
- Exposure: unknown share of developer machines, basis: assumption, so LOW. Fail-closed direction, not a bypass.
- Fix: read the local file only to ADD paths and skip (not throw) commands that name no project script there, or use only the committed settings.json for the committed list. Not filed (LOW).

### 3. [ISSUE][LOW][code-traced] stale or misplaced prose (editorial)
- src/policy/normalizer/shell.ts: the F8 doc comment now sits directly above the F9 block, so it documents nothing.
- docs/STATE.md header still reads 2026-10-04 (PR #400 merged) and has no E/F entry; the Definition of Done needs it at handoff.

## Seams checked, sound
- K proposal vs #419 walk: with the K form (sh, then the launcher and the gate, each as a double-quoted CLAUDE_PROJECT_DIR path) added as a PreToolUse entry (demonstrated), wiredHookScripts returns the launcher, the gate and the two existing hooks (4 scripts), all already on the list, so committed rules and proposal do not drift when K lands. The unquoted form parses. A form with a quote between the variable and the slash throws, fail closed and loud; J9/K5 pin the braced form, so no conflict.
- F9 vs runbook, story B, EFJ and E0 plans: nothing documented relies on a non-kubectl binary resolving. The runbook has no gated command with a resolvable non-kubectl shape (policy:print was already unresolved, #408). The E0 plan uses its own table and rejects path-stripping, consistent with the F9 raw first-token test. Plan line E1 "verb resolution is tool-blind" is superseded by F9 (plan is immutable; the decisions row records it). Probe over 12 shapes against the normalizer: node with env/timeout/command/time/sudo/bash -c wrappers, kubectl.exe, quoted node all unresolved; kubectl, env kubectl and quoted kubectl resolve (the same binary).
- #415 parent-dir rules vs the runbook: its repairs are human, out of session, and its in-session must-not list is unaffected; parent rules deny only move/delete/rename of the directory itself (file writes inside stay free), repo root excluded (disclosed).
- Append-only CHANGELOG: the earlier F entry text on the import graph plus named list is superseded by the newer entry above it (#419); history is not rewritten. The path count 45 is printed by the instrument, not typed in prose.

## Coverage gaps named
- .claude/settings.json comment block (lines 64-124) is documentation inside a sensitive, protected file; no lane owns its prose. It is accurate about Bash today; the gate header (finding 1) is the one that disagrees.
- Everything else as round 1 (ci.yml, gitleaks: detective, human-reviewed at merge; .git/*: with E0).

## Verdict: APPROVE-WITH-CONDITIONS
Condition (fix-now, one sentence): finding 1. Single next action: add the Bash-baseline-unmet clause to the gate header and a test pinning it.

## Evidence run (scratch tree of 4ad9f87)
- node --test activation-preconditions, baseline-rules, path-canonical, shell, shell-binary-closed-set, fixture-notes, fixture-name-triage: tests 93, pass 93, fail 0, skipped 0.
- With a local settings file holding a non-project hook: activation-preconditions tests 1, pass 0, fail 1, skipped 0.
- QA set PASS: kernel-purity, normalizer-registry-purity, gate-command-path, gate-manifest, shell-detector-mutants (60 of 60), gate-path-scaling-sweep, hook-typecheck-coverage, gate-launcher-pin-check, protected-path-list (45 paths).
- Full node --test in a git-less archive: tests 1906, pass 1898, fail 8, skipped 0. The 8 are OSS-01, QA-14 x3, QA-15, R187, R4 x2, all needing .git; none touch the diff. Not run in the real tree.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][code-traced] hooks/pretooluse-kernel-gate.mjs:11-14 vs .claude/settings.json:73 - #413 reword drops the Bash baseline allow (E0 #408) from unmet preconditions; add one clause + pinning test (Issue #422)
2. [ISSUE][LOW][demonstrated] src/qa/protected-path-list.ts wiredHookScripts - gitignored settings.local.json read; a personal non-project hook throws and fails activation-preconditions (1 fail); skip-not-throw for the local file
3. [ISSUE][LOW][code-traced] shell.ts F8 doc comment orphaned above F9 block; STATE.md has no E/F entry (editorial)
4. [CLEAN][demonstrated] #413 and #419 resolved; 45 paths, SessionStart/UserPromptSubmit hooks, mcp-enumeration.ts, tool-inventory.json on list and in K proposal
5. [CLEAN][code-traced] #413 notes edit vs THOTH-ADR-0001/0003: notes ignored by loader, not an entry change; fresh dated report satisfied by this report
6. [CLEAN][demonstrated] K-form PreToolUse entry parses under the #419 walk; no list or proposal drift when K lands
7. [CLEAN][demonstrated] F9 vs runbook, story B, EFJ/E0 plans: nothing relies on a non-kubectl binary; 12-shape probe fails closed
8. [CLEAN][code-traced] #415 parent-dir rules vs runbook: repairs are human/out-of-session, no conflict
9. [CLEAN][demonstrated] whole-catalog ADR pass, no collision; QA set PASS
counts: issues=3 suspicions=0 clean=6
evidence: demonstrated=5 code-traced=4 derived=0
checks=93 pass/0 fail/0 skip (targeted E/F tests); 9 qa checks PASS; 1 fail in injected local-settings run; full suite in git-less archive 1898 pass/8 fail/0 skip (all need .git, none in diff)
adr=HIT(38, whole catalog)
report=docs/reviews/s308-EF-cross-domain-round2-2026-10-05.md
HEAD: 4ad9f87
