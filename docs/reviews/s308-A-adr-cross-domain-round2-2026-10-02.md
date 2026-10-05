# #308 story A - cross-domain re-confirm, round 2 (Ra), 2026-10-02
Scope: git diff 07e88f3..af9285f, delta against my S1-S4 (Issues #392, #393, #394) and red-team #395. Read-only. HEAD: af9285f. Docs only.

## Verdicts on my findings
| Finding | Status | Evidence |
|---|---|---|
| S1 #392 triage | CLOSED | ADR line 56 restores "for this allowlist"; triage table (lines 58-66) covers all 6 files from my query. Spot-checked vendor-tool-inventory.test.ts:78-84: a synthetic init event fed to the scrubber, never asserted against the fixture, so no violation. mcp-enumeration.test.ts:62,96 asserts name extraction only. Code constraint now reads "as an entry of this allowlist" with the unrelated-use carve-out |
| S2 #393 INT-07 | CLOSED | ADR line 69 INT-07 sentence; residual row line 97 (name spoofability, "nothing but the deny rules of stories E and F stops it") |
| S3 #394 trigger | CLOSED | Constraint 3: every addition and every outcome-changing label change needs a fresh report; removals exempt; states every addition is allow-granting under rules [] plus fallback allow. Matches tool-class.ts:63 behaviour |
| S4 fixture in story F | CLOSED in ADR, OPEN in plan | ADR constraint names the fixture explicitly and requires a mutant test. See N1: the phase 0 plan was not updated |

## #395 fix against K, human rulings, CLAUDE.md
- Story K (held, explicit human approval, K1): the Edit(...) deny entry ships with K under human approval. Consistent. No agent edits settings or merges.
- CLAUDE.md human-only list (merge, apply, destructive): untouched. Sensitive-area list: a .claude/settings.json deny change is policy delivery and already needs a fresh dated report; K supplies it. CLAUDE.md Policy delivery exception sentence still exempts additions until the human edits it after acceptance; ADR outranks it (rule 9), disclosed in the decisions row.
- Human rulings 2026-10-02: "read freely, protect the gate" is strengthened, not contradicted (fixture is already named as deny-protected). Connector-label drop and AP-1 allow unchanged. No new collision with SE ADR-0005/0010/0021 or THOTH-ADR-0002.
- New text accuracy: decisions row and CHANGELOG match the ADR (pointer lists rules 1, 2, 4, 5 and Inert row; trigger; hold; Edit deny).

## New findings
**N1 [SUSPICION][MED][derived]** The ADR now requires things the downstream criteria do not carry. docs/plans/s308-activation-phase0-2026-10-02.md is unchanged: F1-F4 do not name the explicit-fixture rule or the mutant test (the A plan section 13 names F3-mutant-drop-fixture-deny, but story F builds from the phase 0 table), K1-K2 have no Edit(...) deny criterion, and J3 (live U-8) exercises Bash and MCP only. The ADR claim "Claude Code applies Edit rules to all built-in tools that edit files" and that the deny holds under permission_mode bypass (human ruling 3 allows bypass) is cited to nothing and measured nowhere (B spikes do not cover it; grep of docs/qa/s308-live-spikes found no permissions.deny test). Rule 18: unmeasured claim. UNPROVEN-pending-verification. Settle: add K criterion plus a scratch-session probe (claude -p with the proposed permissions.deny and bypass mode, attempt an Edit and a Write on a scratch copy of the fixture; expect refusal), run by story J or K implementer; and copy the F mutant and explicit-fixture lines into the phase 0 F table. Exposure: ~100% of file-tool writes to the fixture in a wired session if the deny is ineffective, basis: assumption, so capped at MED and no gate.

No new ADR collision from the rework.

## Verdict: APPROVE
S1-S4 resolved in the ADR; N1 is a plan-sync and measurement item, not a blocker for acceptance, and routes to stories F, J, K.

Single next action: human decides acceptance of THOTH-ADR-0003; before story K, add the Edit-deny probe criterion to the phase 0 plan.

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][MED][derived] phase 0 plan F/J/K not updated for ADR requirements (fixture-explicit mutant, Edit(...) deny criterion); Edit deny under bypass mode unmeasured; add K criterion plus scratch-session probe
2. [CLEAN][code-traced] S1 #392 triage and restored "for this allowlist" qualifier verified against 6 sites
3. [CLEAN][code-traced] S2 #393 INT-07 sentence and spoofability residual present
4. [CLEAN][code-traced] S3 #394 by-effect trigger matches tool-class.ts:63
5. [CLEAN][code-traced] #395 Edit deny requirement consistent with story K, human-only list, sensitive-area list, rulings; no new ADR collision
counts: issues=0 suspicions=1 clean=4
evidence: demonstrated=0 code-traced=4 derived=1
checks=git diff 07e88f3..af9285f read; spot read of vendor-tool-inventory.test.ts:78-84; grep of live-spikes for permissions.deny (0 hits); no tests run (docs-only delta)
adr=HIT(38, whole catalog)
report=docs/reviews/s308-A-adr-cross-domain-round2-2026-10-02.md
