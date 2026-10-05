# Cross-domain review: #308 story E0 (#408), 2026-10-05

[cross-domain-reviewer] Ra. CRITICAL tier. Diff 6f78aee..77a5b82. Gate unwired (K held): exposure to a live session is 0 until K.

## Lanes and ADR catalog
Lanes in parallel: red-team, app-security-reviewer (its report already names #435 read-deny and #436 UNC; not repeated). ADR step: `📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] ... [CACHE=HIT]`, whole catalog. Verdicts (rule level): THOTH-ADR-0001/0002 no collision (the only fixture/allowlist change is none; shipped-defaults.json change is generator output). THOTH-ADR-0003 (central classification fixture as gate input) not touched: E0 adds no fixture entry. SE-0021/0017/0016/0018-0020 (guard self-protection, fidelity): the new file joins the hook import graph and gets its generated protect rule; confirmed below. DevOps ADRs 0001-0010 and SE 0002-0015: not applicable (no infra, data, tagging, cost). No collision.

## Seams checked
- E0 vs F (protected list): CLEAN. `node src/qa/protected-path-list.ts` -> `PASS, 48 protected paths, committed rules and proposal match the generator`; the added rule covers readonly-catalog.ts. `node src/qa/gate-manifest-check.ts` PASS.
- Completeness claims: CLEAN. `node src/qa/shell-detector-mutants.ts` -> `PASS: 68 of 68 mutant(s) KILLED`, equal to the `expect=68` markers (no stale `expect=60` left in CHANGELOG/docs). Fixture snapshot test derives its set; READONLY_COMMAND_NAMES derived from the table. `node --test` on the two new normalizer tests: tests 258, pass 258, fail 0, skipped 0. (The QA-15 claim checker itself hit my 100 s timeout twice; not run to completion, UNPROVEN, Manager's verify run settles it: `npm run qa:completeness-claims`.)
- E0 vs #409 (git/rg): CLEAN. Neither is in the table; B-11 corpus pins env-prefixed git/rg as deny; plan s409 states the pins must stay green.
- E0 vs K plan: CLEAN. K's baseline note matches; #435/#436 must be listed as K blockers (STATE.md's K-blocker line still names only #408/#409/#424/#428/#429; editorial).
- CHANGELOG accuracy: CLEAN (8 mutants, 60->68, regenerated files, scope all match code).

## Findings
1. [ISSUE][MED][demonstrated] Recursive reads defeat any path-scoped read-deny. `readonly-catalog.ts` (grep `-r/-R` with no path, `ls -R`) yields one target `.` (or the named directory). With a read/list deny on `.env` and `.thoth/halt-state/`, run through the real normalizer + kernel in a detached worktree: `cat .env` deny; `grep -r KEY .` -> targets ["."] allow; `grep -rn KEY` allow; `ls -R` allow; `grep -r K .thoth` allow; `cat .thoth/halt-state/a` deny. So #435 as scoped (a deny list of secret paths) cannot work for recursive forms; headline `grep -rn foo src` is also the shape. Domains in tension: normalizer target model (E0) vs policy read-deny (#435/F). App-security's #435 comment names `grep -r /` but not the cause (one target per recursive command). Minimal fix: before K, design the recursive-target rule inside #435 (e.g. a read of directory D matches any deny whose target is under D), or leave recursion unresolved when a read-deny exists. Filed #437. Exposure: ~100% of recursive greps/ls -R once wired AND a secret read-deny ships, basis counted in code (gate unwired and no read-deny shipped today, so current exposure 0). Severity held at MED: latent, not live. Failing test: `RO-recursive-read-matches-descendant-deny` (to be written in #435).
2. [SUSPICION][MED][derived] #428 plan claims E0's set is "covered automatically" via "exported sets", but E0's six names are exported from readonly-catalog.ts (`READONLY_COMMAND_NAMES`), while shell.ts `RESOLVABLE_BINARIES` stays `["kubectl"]` (shell.ts:90). The #428 trust test must import both, or E0's six binaries are unscanned. Commented on #428 (no new Issue; plan not yet built).
3. [CLEAN] Windows device names (`cat CON`, `cat NUL`) resolve to a read of `con`/`nul` (no deny rule concerned; app-security lane owns path forms). No further finding.

## Coverage gaps
`src/qa/shell-detector-mutants.ts` and fixture JSON (`shell-fixture-records-pre-e0.json`, 645 lines) have no domain lane; both are test instruments with passing proofs above, low risk. Worktree cleanup: my detached worktree at scratchpad `wt` could not be deleted (busy handle, `git worktree prune` done); harmless, Manager may remove it.

## Verdict: APPROVE-WITH-CONDITIONS
Condition: #437 designed with #435 before K (not an E0 merge blocker, gate unwired). Single next action: fold recursive-target handling into #435's design and list #435/#436/#437 as K blockers.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] readonly-catalog.ts grep -r/ls -R emit one target "." so #435's path-scoped read-deny returns allow for recursive reads; design recursive rule in #435 (#437)
2. [SUSPICION][MED][derived] #428 plan assumes E0's six names are in shell.ts exports; they are in readonly-catalog.ts READONLY_COMMAND_NAMES (commented on #428)
3. [CLEAN][demonstrated] E0 vs F: protected-path-list PASS 48, generated rule present; gate-manifest PASS
4. [CLEAN][demonstrated] mutants 68/68 killed equals expect=68 markers; normalizer tests 258/0/0
5. [CLEAN][code-traced] E0 vs #409, K plan, THOTH-ADR-0003, CHANGELOG accuracy: sound
counts: issues=1 suspicions=1 clean=3
evidence: demonstrated=3 code-traced=1 derived=1
checks=protected-path-list PASS; gate-manifest PASS; qa-mutation-shell 68/68; node --test 258 pass/0 fail/0 skip; completeness-claim-checker timed out (UNPROVEN, run `npm run qa:completeness-claims`)
adr=HIT(38, whole catalog)
report=docs/reviews/s308-E0-cross-domain-2026-10-05.md
