# #308 stories E, F, J - cross-domain FINAL review (Ra)

[cross-domain-reviewer] Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes
Delta 4ad9f87..ac9cfd7 (695d3f1 F round-2 conditions; ded8782 J conditions + THOTH-ADR-0003 amendment + K proposal rewrite; ac9cfd7 F round-3 probe table as tests). CRITICAL, HELD behind THOTH-ADR-0003 (proposed; not a finding).
ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 856f4b1) [CACHE=HIT]. Whole catalog, unfiltered.
Method: read via git show; executed only in a git archive ac9cfd7 scratch tree (node_modules junctioned), removed at the end.

## Lanes and ground covered
- F: red-team round 3 INCOMPLETE (twice, no verdict); app-security round 2 APPROVE-WITH-CONDITIONS; Manager probe table (substitute, not a verdict).
- J: red-team (no-go, #426); architecture on the ADR-0003 amendment (APPROVE-WITH-CONDITIONS: F1 MED ADR line 78 over-claims vs eight uncovered tools, F2-F4). Lane findings, not re-listed. F1 docs fix is still unapplied at ac9cfd7.
- Mine: the seams, whole catalog.

## Checks run (scratch tree at ac9cfd7)
- node --test on the 6 touched suites (f-round3-probes, k-matcher-covers-arbitrary-exec, gate-matcher-drift-check, shell-wrapper-and-flag-closed-set, activation-preconditions, fixture-notes): tests 72, pass 72, fail 0, skipped 0, cancelled 0.
- qa:protected-path-list PASS (47 paths); qa:gate-matcher-drift PASS (42 names); qa:gate-manifest PASS; qa:gate-command-path PASS; qa:gate-launcher-pin PASS.
- Independent normalizer probes (first attempt vacuous, normalizer not registered, discarded): 48 wrapper/env/quote/redirect/metachar variants around kubectl get pods/x --context=c, plus 23 on dot/source/at/crontab/heredoc/stdin forms. No path-qualified, env-assignment, env -i/-u/-C, PATH=, command-substitution, pipe, semicolon, and-and or heredoc variant resolved. The only allows were bare-wrapper plus bare-kubectl and shell-dequoted spellings of kubectl, which run kubectl anyway.

## Condition confirmations
| Issue | Verdict | Evidence |
|---|---|---|
| #421 .mcp.json and ~/.claude.json protected | resolved in code | shipped-defaults.json targets include both; K proposal gains both Edit entries; test passes; generator finds them without naming them |
| #422 gate header names unmet Bash allow | resolved | header text in hooks/pretooluse-kernel-gate.mjs; header-names-withheld-bash-allow passes |
| #423 (narrowed) matcher-drift accepts mcp__.* | resolved | PATTERN_MATCHER_TOKENS exact set; test rejects PowerShel, mcp__., mcp__*, mcp__.*x, mcp__github, MCP__.*, .* |
| #426 PowerShell outside matcher | resolved | matcher Bash, PowerShell, mcp__.*; K-matcher-covers-arbitrary-exec 3/3 incl. PowerShell-dropped mutant; plan J1 and K5 updated |
| #427 J8 README rows | resolved | rows say everything stopped; MSYS=noglob is the one measured fail-open; the unmeasured case is stated |

All five read OPEN on GitHub because Closes #N fires on merge (human-only); not a defect. #424 correctly stays open (human decision at K).

## ADR verdict (whole catalog vs the diff, outside F/J lanes)
- THOTH-ADR-0003 (proposed, served as rules): the new MUST (route PowerShell via the K matcher) is met by the K proposal and pinned by a test. Stays proposed, no self-acceptance, amendment-history line present. No collision with CLAUDE.md Sensitive areas.
- SE ADR-0005 recorded acts: decisions rows 118 and 120 exist; F9b and F10 add tests only, no assertion weakened.
- Kernel-purity and normalizer-registry purity ADRs: no new kernel import. Devops ADRs: no changed file in their lane. No collisions.

## Seam hunt
1. F10 vs documented grammar: no test, fixture, doc or REQUIREMENTS row expects -n, --namespace or -o to resolve (grep: only the two negative corpora). The change is recorded (decisions round-2 row, CHANGELOG F10, tests); the old behaviour silently dropped -n=ns from the record, so denying is the right direction. Consequence for K: with the gate wired, the only kubectl form that resolves is get RES --context=C; every namespaced or formatted call is denied by POL-05 until a namespace-aware grammar exists. No Issue tracks that (E0 #408 is nearest). CLEAN.
2. F9b vs arbitrary-exec classification: the wrapper table (11 names; the test derives 10, dropping the dot) is a parse-time table; AP-12 classifies tool names. No interaction. source, dot, at, crontab, xargs never resolve cleanly. CLEAN.
3. ADR-0003 amendment vs K proposal: eight names agree across ADR, JSON, md and the AP-12 instrument. #424 open vs the K list: coherent.
4. Narrative: decisions row 123, CHANGELOG, plan and K md/json agree (shell form, Bash|PowerShell|mcp__.*, eight pending). The older CHANGELOG story J entry still says two forms; see Editorial.

## Findings
1. [SUSPICION][MED][derived] Bare-name PATH resolution: F9/F9b prove the first token is the bare lowercase kubectl, sh or env, but the OS resolves it through PATH. The F9 comment claim of no planted kubectl holds only for relative paths. Write and Edit tools are not routed by the gate and the K Edit deny covers listed paths only, so a session able to write into a PATH directory ahead of the real binary could plant kubectl, which the gate allows. Not demonstrated. UNPROVEN-pending-verification. Settle: in the K target session list PATH entries, test -w each, and run command -v -a kubectl sh env; if a writable dir precedes the real binary, protect it or pin PATH for the gated session. Owner: Manager before K. Exposure: unknown, basis: assumption, so capped.
2. [SUSPICION][LOW][derived] The -c=V alias: kubectl get pods/x --context=prod -c=dev records target e/cluster/dev/pods/x (demonstrated on the record, last value wins) while kubectl has no -c on get or delete (from documented flags, not run) and would reject it. No known exploit. Minimal fix: drop the c alias so -c= falls into the closed-set denial.
3. [SUSPICION][LOW][derived] K-matcher-covers-arbitrary-exec completeness rests on the AP-12 instrument 10 hand-listed names while the inventory has 42 tools (e.g. Artifact, DesignSync, EnterWorktree, TaskStop, KillShell, SendMessage); it also assumes an anchored matcher regex, unmeasured in J.
4. [CLEAN][demonstrated] #421, #422, #423, #426, #427 resolved; 72/0/0.
5. [CLEAN][demonstrated] The F10 denial of -n, --namespace, -o is recorded and contradicts no test, fixture, doc or REQUIREMENTS row.
6. [CLEAN][demonstrated] The Manager probe table is an honest substitute for the normalizer legs, with limits: 34 named hook-level tests plus a shape test (29/5/34), all green; my independent probes found no bypass. Not seen by it: (a) authored by the Manager who verified the fix, so not independent adversarial thinking; (b) runs with empty shipped rules, so normalizer plus POL-05 only; (c) environment levers (ambient KUBECONFIG or kube exec plugins, BASH_ENV, PATH, finding 1) are out of reach, ruled to #398 and #409; (d) F has no red-team go after the round 2 no-go. (d) is disclosed in the decisions row.
7. [CLEAN][code-traced] ADR-0003 amendment, K proposal and #424 consistent; no self-acceptance.

## Coverage gaps
- The probe test file runs in a copied-tree sandbox with empty rules; test files are not gate inputs. Intentional, low risk.
- Architecture F1 (ADR line 78) is open until edited; named above.
- The real .claude/settings.json matcher is not tested against the proposal until the K5 check exists; today the test reads the proposal JSON only.

## Editorial
- CHANGELOG story J entry (two forms; exec form with env -i held; gate-command-path cannot read exec form) is superseded by the J9 ruling; add a superseded-by clause.
- CHANGELOG F9b says 10 derived names; the table has 11 (the test drops the dot).

## Verdict: APPROVE-WITH-CONDITIONS
Conditions (no failing test today): finding 1 measured before K; architecture F1 applied before the human is asked to accept ADR-0003. Open findings 3 (suspicions); failing tests 0 (derived, no executable form yet).
Next action: Manager runs the PATH-writability check (finding 1) in the K target environment, then hands E, F, J to the human with the ADR-0003 acceptance question.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [SUSPICION][MED][derived] shell.ts F9/F9b bare first-token check does not pin which binary PATH resolves; un-gated Write/Edit can plant it in a writable PATH dir; measure PATH writability before K (UNPROVEN-pending-verification)
2. [SUSPICION][LOW][derived] shell.ts/flag-catalog.ts -c= alias: --context=prod -c=dev records cluster dev, kubectl has no -c on get/delete; drop the alias or accept
3. [SUSPICION][LOW][derived] k-matcher-covers-arbitrary-exec.test.ts completeness rests on AP-12 10 hand names of 42 inventory tools; anchored-regex assumption unmeasured
4. [CLEAN][demonstrated] #421/#422/#423/#426/#427 resolved, 72/0/0 plus 5 qa checks pass
5. [CLEAN][demonstrated] F10 -n/--namespace/-o denial is recorded and contradicts no test, fixture, doc or REQUIREMENTS row
6. [CLEAN][demonstrated] Manager probe table honest for normalizer legs (34 hook tests green, independent probes no bypass); not independent, empty-rules, env levers and no red-team go remain disclosed
7. [CLEAN][code-traced] ADR-0003 amendment vs K proposal vs #424 vs decisions/plan coherent; no self-acceptance
counts: issues=0 suspicions=3 clean=4
evidence: demonstrated=3 code-traced=1 derived=3
checks=node --test 6 suites 72 pass/0 fail/0 skipped; qa:protected-path-list, gate-matcher-drift, gate-manifest, gate-command-path, gate-launcher-pin all PASS; ~71 ad-hoc normalizer probes, 0 bypass
adr=HIT(38, whole catalog)
report=docs/reviews/s308-EFJ-cross-domain-final-2026-10-05.md
HEAD: ac9cfd7
