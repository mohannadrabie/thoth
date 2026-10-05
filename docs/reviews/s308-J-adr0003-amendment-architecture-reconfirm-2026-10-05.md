# THOTH-ADR-0003 write-path amendment: architecture re-confirm (Imhotep), HEAD 7f77262, 2026-10-05

[architecture-reviewer] ADR cache HIT: reused 38 ADR(s) (fp d5c3bca) [CACHE=HIT]

| Axis | Verdict |
|---|---|
| F1 over-claim / residual row | RESOLVED (code-traced + test): "close the session write paths" and "are the only controls" gone; closing bullet now lists Bash, mcp__, PowerShell (once K matcher includes it), file tools, and says the pending built-ins stay uncovered; new residual row "Un-routed arbitrary-execution built-ins" with owner mohannadrabie |
| F2 K-outcome consequence | RESOLVED: declined tool becomes an owned residual row; routed tool leaves the list and the ADR in the same change |
| F3 MUST vs K decision / PowerShell consequence | RESOLVED: "K's proposed matcher MUST include PowerShell (the human approves the entry at K)"; Consequences/Negative now states PowerShell becomes unusable in gated sessions |
| F4 hand-typed list | RESOLVED: ADR points at pendingHumanDecision in the K proposal JSON; test adr0003-no-retyped-tool-list enforces no retyped tool name |
| Status | still `proposed` (frontmatter line 4, test asserts it); amendment history notes in-place edit |
| New over-claim | none material (see note) |

Test: `node --test src/qa/adr0003-write-path-claim.test.ts` -> tests 2, pass 2, fail 0, skipped 0.

Note (LOW, derived, editorial): the phrase "protected on every session write path" remains at ADR lines 17, 72, 90 as a pre-wiring requirement (a MUST, not a claim of achievement); it is now consistent with the residual row, since a declined tool is an accepted, owned residual. No action needed; optionally add "known" as the line 90 constraint already says "this ADR knows of" elsewhere.

Editorial: none blocking.

Verdict: APPROVE. Next action: human decides acceptance of THOTH-ADR-0003 at the PR.

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][LOW][derived] "protected on every session write path" wording at lines 17/72/90 is a requirement, consistent with the new residual row; optional wording nit
2. [CLEAN][code-traced] F1 resolved: over-claims removed, residual row added, test green
3. [CLEAN][code-traced] F2 resolved: declined/routed consequence stated
4. [CLEAN][code-traced] F3 resolved: matcher MUST reworded, PowerShell consequence added
5. [CLEAN][demonstrated] F4 resolved: single source pointer, drift test 2/2 pass; status still proposed
counts: issues=0 suspicions=1 clean=4
evidence: demonstrated=1 code-traced=3 derived=1
checks=node --test adr0003-write-path-claim.test.ts: 2 pass / 0 fail / 0 skipped
adr=HIT(38)
report=docs/reviews/s308-J-adr0003-amendment-architecture-reconfirm-2026-10-05.md
HEAD: 7f77262
