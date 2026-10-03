# #308 story B (live spikes) - code review, evidence integrity (2026-10-02)

[code-reviewer]
Code Reviewer (Anubis) - reviewing for correctness and user-facing trust. Scope s308-B, STANDARD, commits de4c08e + 27ffe48, branch s308/activation-2. Read-only.

📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog - ≈18800 tokens saved this pass (fp d37bef7) [CACHE=HIT]
ADRs: no ADR standard applies to evidence-only docs and plain .mjs under docs/qa (SE ADR-0010 covers the three production hooks only). No blockers.

## Verdict: SHIP (one MED and three LOW follow-ups, none gating)

## Scorecard
| Claim | Raw output supports it? | Evidence |
|---|---|---|
| B1 hook 170-300 ms | YES for the range; the budget comparison is not in the repo | B1.txt tee child_wall_ms 218/211/171; stream hook_started to hook_response 302/200/219 (runs 4-6) |
| B2 closed stdout -> exit 2 -> blocked | YES | B2.txt: close run exit_code 2, tool_result is_error, no execution; control exit 0 and ran spike-b2-ran; baseline denied by POL-05 |
| B3 sanitization table | YES for cases tried; generalisation is an overclaim | hook-received mcp__odd_srv__, mcp__caf___, mcp__a__b__, mcp__tool-cases__do_it, 65-char tool (counted: 65 configured, 82-char full name received) |
| B4 env reaches hooks | YES | b4 logger shows SPIKE_ENV_PROBE=from-settings-env |
| B4b NODE_OPTIONS fail-open | YES (below) | B4.txt run b4b |
| B5 441/512/668 untouched | YES | I parsed B5.txt: hook reason length equals tool_result length in all three (441/441, 512/512, 668/668) |
| B6 matcher mcp__.* | YES (n=1) | B6.txt: one logger entry (MCP); Bash tool_result is_error false, no Bash hook event |
| B7 settings.json untouched | YES | git diff --stat origin/master HEAD -- .claude hooks src is empty |

## B4b: does the evidence support the fail-open? Yes, demonstrated.
B4.txt run b4b: both PreToolUse hooks report exit_code 9, outcome error, stderr "--spike-unknown-flag is not allowed in NODE_OPTIONS"; tool_result is_error false, content spike-b4b, so the command executed. The same Bash call shape is denied by POL-05 in run b4 and in every B1/B2 baseline run, so the allow in b4b is caused by the gate not running, not by policy. Caveats for the human: one run; Windows, Claude Code 2.1.267; the env block comes from project settings (needs write access to .claude/settings.json or equivalent). Handed to the human; no Issue filed per instruction.

## Findings (ranked)
1. [MED][code-traced] Criterion-required comparisons live only in chat. B1 requires the qa:gate-latency-budget line from the same session in B1.txt; grep -rn 386 docs/qa/s308-live-spikes returns nothing, so the builder's p99 386 ms is uncommitted. Re-running npm run qa:gate-latency-budget gave p99 448.88 ms (p50 257.80, p95 391.37, ceiling 2000 ms), so the figure varies and the comparison needs its pasted line. Likewise B3's N13 and tool-class-format.ts:95-97 re-read and the disposition summary were left in the build report (Build deviation 5). User action -> wrong result: a later story (D/J) cites "p99 386" or "N13 holds" and finds no committed source. Exposure: 2 of 7 criteria (B1, B3) incomplete in the repo, basis: counted in code. Minimal fix: paste the budget line (dated) and a 3-line B3 N13 disposition into B1.txt/B3.txt or a committed summary.txt. Executable form: none beyond grep -q gate-latency-budget docs/qa/s308-live-spikes/B1.txt.
2. [LOW][derived] B3 generalisation. The plan limited the claim to cases tried. Hook-observed: dot, e-acute (one underscore per code point), a__b, tool-name dot, 65-char tool. Space, colon, plus, slash in server names were seen only in the init tool list, not in a hook payload. "Every char outside [A-Za-z0-9_-] becomes _" should read "for the nine server and five tool names configured". B1 "n=6" also mixes two timing methods (runs 1-3 have no stream timing).
3. [LOW][code-traced] Harness rerun safety. No --dangerously-skip-permissions, no destructive command, 120 s kill, --max-budget-usd 0.25 per call, 40-call/USD 3 cap in run.mjs:12-17. Gaps: the cap reads ledger.jsonl, which is not committed (only ledger.txt), so a fresh scratch folder resets it; gen-profiles.mjs:6,8 and spre*.mjs hard-code C:/playground/thoth, so rerun is machine-specific; --allowedTools Bash plus a gate that fails open (B4b) would let the B5 touch prompt run (harmless). Minimal fix: derive the repo root from the file location.
4. [LOW][code-traced] N13 citation. Test is at src/policy/normalizer/tool-class.test.ts:289 (comment 287); docs/plans/s308-B-live-spikes-plan-2026-10-02.md:25,92 and docs/plans/s308-activation-phase0-2026-10-02.md:25,71,92 still say :270. QA-14 does not check line numbers. node src/qa/reference-resolver.ts origin/master HEAD: PASS, 134 citations, 127 resolved, 7 unclassified (bare #308/#381), 0 failed. Editorial.

Scrub: clean. Negative grep over docs/qa/s308-live-spikes and the B plan for hostname, username, surname, gmail, UUID shape, toolu_, /Users/, AppData in outputs: no hits (only scrub.mjs's own regex text). C:\Program Files\nodejs appears twice (public path). Ids are placeholders. node src/secret-scan/pre-commit-scan.ts: PASS, 0 blocking. Caveat: scrub.mjs masks the email only when SPIKE_SCRUB_EMAIL is set; the output has none.

## Missing checks (named)
- A check that B1.txt carries the budget line (finding 1).
- Hook-observed rows for space/colon/plus/slash server names.

## Editorial
- N13 cited :270 in the plans (finding 4). Build deviation 5 honestly says the summary is not in the repo.

## Praised decision
B2 labels its own limit ("the runtime never closed the pipe itself"): the close is harness-induced, with a swallow control and a baseline, so exit-2-blocks is a true observation of runtime handling. B5 keeps hook reason and tool_result as separate fields, so "untruncated" is checkable; I checked it (441/441, 512/512, 668/668).

## Next action
Paste the budget line and the B3 N13 disposition into the B1/B3 evidence files (finding 1), then hand B4b to the human.

Checks run: reference-resolver PASS (134, 0 failed); gate-latency-budget PASS (p99 448.88 vs 2000 ms); pre-commit-scan PASS; negative greps empty; B5 length parse 3/3 equal. Open findings 1 MED + 3 LOW; failing tests 0 (documentation gaps, no executable form beyond the grep above).

RECEIPT: verdict=SHIP
findings:
1. [ISSUE][MED][code-traced] B1.txt/B3.txt: criterion-required qa:gate-latency-budget line (builder p99 386 not in repo; rerun gives 448.88) and N13 re-read live only in chat; paste both into the evidence files
2. [SUSPICION][LOW][derived] B3.txt: "every char -> _" generalises beyond the 9 server/5 tool names tried (space/colon/plus/slash seen at init only); B1 n=6 mixes two methods
3. [ISSUE][LOW][code-traced] harness/gen-profiles.mjs:6,8 + run.mjs:12-17: hard-coded repo path; cap ledger.jsonl not committed so cap resets on a fresh folder
4. [ISSUE][LOW][code-traced] docs/plans/s308-B-live-spikes-plan-2026-10-02.md:25,92 (+phase0 plan 25,71,92): N13 cited :270, actual tool-class.test.ts:289
5. [CLEAN][demonstrated] B4.txt b4b: exit 9, outcome error, Bash call executed where b4 shows POL-05 deny; evidence supports the NODE_OPTIONS fail-open (one run, Windows, CC 2.1.267)
6. [CLEAN][demonstrated] B5.txt: hook reason length equals tool_result length at 441/512/668 (parsed); B2/B6/B7 and scrub (no hostname/user/email/ids) verified
counts: issues=3 suspicions=1 clean=2
evidence: demonstrated=2 code-traced=3 derived=1
checks="5/0/0"
adr=HIT(38)
report=docs/reviews/s308-B-live-spikes-code-review-2026-10-02.md
