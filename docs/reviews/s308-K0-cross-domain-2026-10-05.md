# Cross-domain review, round 1: #308 story K stage 0 (scope s308-K0), HEAD 79f0b44

[cross-domain-reviewer]
Cross-Domain Reviewer (Ra), scanning the seams between reviewer lanes. Date 2026-10-05. Tier CRITICAL. Parallel lanes: red-team, app-security-reviewer.
Disclosed by the Manager and NOT re-raised: failing-first only demonstrated for steps 2-3; FIX_BRANCHES hand constant; R4 EBUSY local failure; #455 open k-blocker; #435/#437 ship disclosed. Also not re-raised: #456 (certifiers and proposal JSON not protected paths), already filed.

ADR cache: `📊 ADR cache BUILT: cataloged 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3], catalog now current (fp da6ef03) [CACHE=HIT]` (whole catalog read, unfiltered).

## 1. Lanes and ground covered
red-team (attack surface of the new tooling) and app-security-reviewer (authz and injection of the read-only runner and merge script). Their lanes do not cover: ADR-wide collisions, agreement between the generated settings text and every other instrument that reads `.claude/settings.json`, readiness row set vs plan section 2, decisions-row conventions, CI shape, runbook vs CLAUDE.md, stage 1 plan completeness, the #452 contract. That is this pass.

## 2. Cross-domain ADR verdict (whole catalog)
- THOTH-ADR-0003 (accepted): K must not ship without the human's separate approval recorded in docs/decisions.md. Stage 0 wires nothing (`.claude/settings.json` unchanged); readiness requires the K1 row. COMPLIANT. Rules 6/7 (fixture on the Edit deny, a mutant that removes it fails): K3 mutants present, 50/50 K tests pass. COMPLIANT.
- THOTH-ADR-0001 (fixture as gate input): no fixture entry hardcoded in new code. COMPLIANT.
- SE ADR-0021 (kernel purity, INT-07): new files are src/qa only; nothing under the kernel boundary. COMPLIANT.
- SE ADR-0005 (testing, recorded acts): K tests ship with the feature; the bare `--print-worktree-targets` behavior change is in CHANGELOG and had no caller outside docs. COMPLIANT.
- SE ADR-0010 (quality gates): typecheck rc 0, eslint on changed files rc 0. COMPLIANT.
- SE ADR-0004 (idempotency): merge twice equals once, tested. COMPLIANT.
- ADR-0016/0019/0020 (port self-protection): no ported files touched. NOT APPLICABLE.
- devops ADR-0001..0010, SE ADR-0002/0003/0006-0009/0011-0015, THOTH-ADR-0002: no IaC, data, cloud or secret-scan surface changed. NOT APPLICABLE.
No ADR collision.

## 3. Findings

### F1 [ISSUE][MED][demonstrated] The k-blocker row cannot pass before K wires: two blockers close only with K
Domains in tension: readiness instrument (`src/qa/k-readiness.ts` blockerRow, requires 0 open k-blocker) vs the K plan and STATE ("#406, #397 close with K (settings protection)": plan 2.1 rows for #406 and #397; docs/STATE.md open-S7 table). Demonstrated: `node src/qa/k-readiness.ts` printed `FAIL k-blocker-issues: 7 open k-blocker issue(s)`; `gh issue list --label k-blocker --state open` lists #397, #406, #438, #442, #444, #452, #455. #397 and #406 are K's own outputs, not its preconditions, so the row stays red until a human relabels them, and the runbook (section 2) says nothing about it. The gate is then reached by overriding the instrument, which a readiness gate should not teach.
Exposure: ~100% of pre-wiring readiness runs, basis: counted in code (2 of 7 labelled issues are structurally unclosable before K).
Minimal fix: remove the label from #397 and #406 (K verifies them live via P-K3), or state in the runbook that they are expected-open. Failing test: `k-readiness: no k-blocker issue is one that only K itself closes` (integration, in `k-readiness.real-run.ts`; no CI form since it needs gh). Issue #457.

### F2 [ISSUE][MED][code-traced] K1 and K4 read only docs/decisions.md; the archive sweep removes ratified rows
`src/qa/k-readiness.ts` k1Row/k4Row read `docs/decisions.md` only. The file header: a row with Human=Y whose review-back date has passed moves verbatim to `docs/decisions-archive.md` at handoff (`docs/decisions-archive.mjs`; CHANGELOG sweep precedent). The K4 row (THOTH-ADR-0003 accepted, Y) has review-back 2026-10-12; after the next sweep K4 reports `no row recording THOTH-ADR-0003 acceptance` and FAILs falsely. Same fate for the K1 row if K waits past its review-back date. Today the archive holds 0 such rows (grep count 0), so the failure is future-dated, not live.
Exposure: ~100% of readiness runs after the first handoff sweep following 2026-10-12, basis: counted in code.
Minimal fix: k1Row/k4Row search `docs/decisions.md` then `docs/decisions-archive.md`. Failing test: `k-readiness: K4 row found when only in decisions-archive.md`. Issue #459.

### F3 [ISSUE][LOW][demonstrated] K1 accepts only the bare cell Y; the house style is Y followed by a parenthetical
Ran `k1Row` over a K1 row: cell `Y` PASS; `Y (human, 2026-10-06: "approved")` FAIL; `y` FAIL; `**Y**` FAIL. The last decisions rows use the parenthetical style; k4Row accepts a `Y` prefix while k1Row is exact (test line 148 pins `Y (pre-approved)` as FAIL, which is the intent, yet K4 accepts the same prefix). Fail-closed, but the runbook never states the required cell form. Minimal fix: one runbook line stating the exact cell. Failing test: `k-runbook: names the exact K1 Human-ratified cell form`. Not filed (LOW).

### F4 [ISSUE][LOW][code-traced] Stage 1 plan gaps against the K plan's UNPROVEN and not-measured lists
Compared K plan lines 104-107 and section 1.1 "Not measured" with the stage 1 probe table. Covered: alias probe (line 106), latency allow-path (readiness row), #455 (table row, R2, label). NOT covered: (a) macOS extended-ACL probe (line 105), absent from the probe table, residuals R1-R3, readiness and labels; (b) nested subagents and other agent types (plan 1.1): P-K2 tests one subagent type, and the Task/SendMessage/Workflow residual ruling is conditional on exactly this; (c) no stage 1 outcome (case spike, alias probe) has a readiness row or label, so those K-precondition items rest on a human reading the stage report. Minimal fix: add (a) as residual R4 (needs a Mac, disclosed) and (b) as a P-K2 variant or a disclosed residual. Failing test: `k-stage1-plan: every UNPROVEN row of the K plan is probed or listed as a residual` (extract the UNPROVEN rows, assert each appears in the stage 1 plan). Not filed (LOW).

### F5 [ISSUE][LOW][demonstrated] Fixture-equality test goes red at the K wiring commit if the plan's comment-block edit is made
`k-merge: dry-run output equals checked-in proposed-settings fixture` compares the dry run of the CURRENT `.claude/settings.json` to the fixture. Demonstrated in my worktree (restored afterwards): after `k-settings-merge --write`, 8/8 pass; after the plan 1.4 edit to the `//` comment block, 7 pass and 1 fails (that test). Neither plan nor runbook lists regenerating the fixture with `--out`, or retiring `k-readiness.real-run.ts`, as steps of the K commit (the latter is only a header comment). Exposure: 100% of the K wiring commit's CI if the comment edit is made, basis: demonstrated. Minimal fix: add both steps to the runbook section 3. Failing test: `k-runbook: K wiring steps include fixture regeneration and retiring the real-run file`. Not filed (LOW).

### Seams checked clean
- C1 [CLEAN][demonstrated] Generated settings text vs every other reader. I applied `node src/qa/k-settings-merge.ts --write` in my worktree and ran: qa:gate-command-path (3 command entries PASS), gate-launcher-pin PASS, gate-matcher-drift (43 names PASS), gate-manifest (exactly 1 manifest, `.claude/settings.json`; the .txt fixture is correctly invisible), gate-latency-budget PASS (p99 401 ms), qa:k3 PASS (111 paths), qa:k5 PASS, QA-17 runtime-settings-drift PASS, qa:protected-path-list PASS. File restored with `git checkout`.
- C2 [CLEAN][demonstrated] Readiness rows vs plan section 2, by script (extracted every issue number and qa script name from section 2, diffed against the label set and SCRIPT_ROWS): labelled issues named in section 2: 397, 406, 438, 442, 444, 452 (+455, added later); the rest are merged-branch items covered by the ancestry row or ruled non-blockers (#435/#437). Every instrument in 2.4 has a row. Gaps are in F4 only. Real run: 8 PASS, 5 FAIL, 3 MISSING of 16 rows, exit 1, as designed.
- C3 [CLEAN][code-traced] #452 contract: `qa:cc-extraction-covers-judged` is a plain node script matching the SCRIPT_ROWS regex and row id; exit 0 is the only PASS, 1 and 3 map to FAIL. Readiness does not export THOTH_REQUIRE_CLAUDE=1; harmless, since the plan's SKIPPED exit is 3, which fails closed.
- C4 [CLEAN][code-traced] CI shape: `k-readiness.real-run.ts` is not matched by node's default test globs, so `npm test` never calls gh; no ci.yml step added; K3/K5 default runs use dry-run output plus mutants; the file is typechecked (rc 0).
- C5 [CLEAN][code-traced] Runbook vs CLAUDE.md human-only and plan section 3: all commands are for the human's terminal; revert-and-push on the K branch, never force-push; no merge or default-branch push instructed; unmeasured hatches match plan step 2.
- C6 [CLEAN][code-traced] Pipes inside a decision cell (for example the matcher) do not break the K1 parse: the human cell is read from the end.

## 4. Coverage gaps
- Stage 1 outcomes have no mechanical gate (F4c).
- `k-readiness.real-run.ts` is executed by no CI, by design; reviewed here instead.
- `qa:completeness-claims` printed one failure (CHANGELOG `qa-mutation-shell`, no parseable number) during my run under a 200 s timeout; that claim is not in this diff (present on master). UNPROVEN either way. Settle with `npm run qa:completeness-claims` on a quiet machine, no timeout; any maintainer.

## 5. Editorial (verdict-neutral)
- docs/STATE.md lists #435/#437 as K blocker (plan question 3); the later human ruling says they do not block K.
- docs/STATE.md (#442 row) and plan 1.3 still show the bare `--print-worktree-targets` (now requires `--form`).
- docs/STATE.md "Single next action" predates the stage 0 build.

## 6. Verdict: APPROVE-WITH-CONDITIONS
Fix-now: F1 (relabel or runbook note), F2 (read the archive too). F3-F5 are one-line runbook or plan edits. Nothing blocks stage 1 probes (they touch no repo settings).
Single next action: relabel #397/#406 and make k1Row/k4Row read the archive (Issues #457, #459), then proceed to stage 1.

## Evidence (raw)
- node --test over the K test files and protected-path-list.test.ts: tests 50, pass 50, fail 0, skipped 0.
- typecheck rc 0; eslint on the changed qa files rc 0.
- `node src/qa/k-readiness.ts`: k-readiness: 8 PASS, 5 FAIL, 3 MISSING of 16 rows; NOT READY (exit 1).
- Wired-state replay (restored): nine gates PASS as in C1; k-merge test 8/8, then 7/8 after a comment-block edit.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by blast radius):
1. [ISSUE][MED][demonstrated] src/qa/k-readiness.ts blockerRow: #397/#406 carry k-blocker but close only with K, so readiness cannot pass pre-wiring; relabel or document (Issue #457). Exposure: ~100% of pre-wiring readiness runs, basis: counted in code.
2. [ISSUE][MED][code-traced] src/qa/k-readiness.ts k1Row/k4Row read docs/decisions.md only; archive sweep after 2026-10-12 makes K4/K1 FAIL spuriously; read the archive too (Issue #459).
3. [ISSUE][LOW][demonstrated] k1Row accepts exact Y only vs house style Y plus parenthetical, undocumented in the runbook.
4. [ISSUE][LOW][code-traced] stage 1 probe plan omits the macOS ACL probe (K plan line 105) and nested/other-agent-type subagents; stage 1 outcomes have no readiness row.
5. [ISSUE][LOW][demonstrated] k-merge fixture-equality test goes red once the plan 1.4 comment edit is made at K; runbook lacks regenerate-fixture and retire-real-run steps.
6. [CLEAN][demonstrated] generated settings text agrees with gate-command-path, launcher-pin, matcher-drift, manifest, latency-budget, K3, K5, QA-17, protected-path-list.
7. [CLEAN][demonstrated] readiness row set vs plan section 2 compared by script; only F4 gaps.
8. [CLEAN][code-traced] whole-catalog ADR sweep: no collision (THOTH-ADR-0003 K hold respected).
9. [CLEAN][code-traced] #452 name and exit-code contract matches (exit 0 only green, fails closed).
10. [CLEAN][code-traced] CI shape: real-run file excluded from npm test, no red step added.
11. [CLEAN][code-traced] runbook rollback agrees with CLAUDE.md human-only rules and plan section 3.
counts (a CHECKSUM): issues=5 suspicions=0 clean=6
evidence (a CHECKSUM): demonstrated=5 code-traced=6 derived=0
checks=node --test K files 50 pass/0 fail/0 skip; typecheck rc0; eslint rc0; k-readiness real run 8 PASS/5 FAIL/3 MISSING (exit 1); 9 gates PASS on merged settings text; k-merge fixture test 8/8 then 7/8 after comment edit
adr=HIT(38, whole catalog)
report=docs/reviews/s308-K0-cross-domain-2026-10-05.md
HEAD: 79f0b44
