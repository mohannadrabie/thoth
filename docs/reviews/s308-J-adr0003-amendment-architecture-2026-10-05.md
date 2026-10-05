# #308 story J - THOTH-ADR-0003 write-path amendment, architecture review (Imhotep), 2026-10-05
Delta: `git show ded8782 -- docs/adr/` read against the full ADR at ac9cfd7, K proposal md+json, J README, decisions row "story J: J9 ruling", Issues #424/#426. Read-only; tier CRITICAL (policy delivery).
📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog - ≈18800 tokens saved this pass (fp 856f4b1) [CACHE=HIT]

## Verdict table
| Axis | Verdict | Evidence |
|---|---|---|
| Fit / minimality | CONFORMS | +7/-4 lines: one constraint sentence, two Decision bullets, one Rules clause, one history line. Each restates the same two facts (PowerShell routed; eight tools human-decided), matching the ADR’s existing constraint / Decision / Rules triplication. |
| Coherence with ADR-0003 / ADR-0001 | CONFORMS | Precedence constraint, rule-5 scoping, Inert-row supersession, Hold constraint and Status bullet untouched. `status: proposed` at line 4; `git status docs/adr` clean; no acceptance language added. The ADR has no numbered rules, so nothing renumbered. The amendment-history line names date, Issues, evidence and edit-in-place-while-proposed. |
| Catalog-served hold | CONFORMS | Hold constraint unchanged; the new text adds no new ship gate. |
| Over-claim (PowerShell, mcp__, Bash) | CONFORMS | PowerShell claim matches J3 (demonstrated un-gated). Stated as matcher plus gate refusal, not as measured fixture protection. |
| Over-claim (closing sentence) | VIOLATES (internal) | F1 |
| Rule vs K-time human decision | AMBIGUOUS | F3 |
| Evolution path | NOT-COVERED | F2 |

## Findings (ranked)
1. **F1 [MED][code-traced] "every session write path" is still not true as enumerated; the ADR now names the gap in one place and denies it in another.**
   - Line 90 and line 17: "MUST protect ... on every session write path". Line 78 (unchanged): "Both together close the session write paths this ADR knows of". After the amendment the ADR itself names eight tools (line 77) that neither mechanism covers, so "knows of" is false by the ADR’s own text.
   - Residual table row 1 (line 99) still says the two protections "are the only controls"; no row discloses the eight un-routed tools. The K JSON says what fires the hook for them is "unmeasured (red-team J #4)", so whether they can write the fixture is unproven, not disproven.
   - Exposure: ~100% of readers deciding acceptance (counted: 1 closing sentence, 1 residual row); basis: counted in code. Harm is false assurance, not a runtime failure.
   - Fix: reword line 78 to "closes Bash, mcp__, PowerShell and the file-editing tools; the eight tools of line 77 stay open until the K decision"; add a residual row "Un-routed arbitrary-exec built-ins (unmeasured whether they can write the fixture)". Failing test: `adr0003-write-path-claim-matches-pending-list` (while pendingHumanDecision is non-empty, the ADR may not contain the "close the session write paths" sentence without the pending carve-out). Overlaps open Issue #424; commented there rather than filing a duplicate.
2. **F2 [MED][derived] No ADR consequence stated for either K outcome.** If the human routes a tool (for example Task), the ADR text and K JSON change together and the gate then refuses subagents. If the human declines, the line 90 MUST becomes unmeetable unless the ADR records the accepted residual and its owner. Add one sentence: each declined tool becomes a residual row owned by mohannadrabie; each routed tool leaves line 77 in the same change. Capped MED (derived); resolves to the F1 test or a residual-register line.
3. **F3 [LOW][derived] One clause reads as a rule but is a K-time decision.** Rules: "MUST route the PowerShell tool through K’s matcher". K is held and the matcher is a settings entry the human approves; the J9 ruling was the Manager’s under pre-approval. Human acceptance of the ADR ratifies it, so defensible, but an implementer could read it as authority to edit `.claude/settings.json`. Suggest "K’s proposed matcher MUST include PowerShell" (already tested by `k-matcher-covers-arbitrary-exec`). The eight-tool sentence is correctly phrased as a human decision. Consequences/Negative also omits that routing makes PowerShell unusable (this machine’s primary shell); the constraint text discloses it, Consequences do not.
4. **F4 [LOW][code-traced] Hand-typed list duplicated.** The eight names sit in ADR line 77, the J9 decisions row and the K JSON. `k-matcher-covers-arbitrary-exec` ties JSON to the AP-12 instrument, but nothing ties ADR text to JSON (CLAUDE.md completeness rule). Prefer pointing at the proposal’s pendingHumanDecision list, or add a drift test. Pre-existing, not introduced here: "Edit rules apply to all built-in file tools" is cited from docs; J5 measured Edit and Write only (J README line 61), while MultiEdit and NotebookEdit (both in tool-inventory.json) are unmeasured.
5. **F5 [CLEAN][code-traced]** Status stays `proposed`; no self-acceptance; history line follows the edit-in-place convention; ADR-0001 untouched; PowerShell claim matches J3.

## NOT-COVERED / AMBIGUOUS (architect queue)
- NOT-COVERED: ADR consequence of the human routing or declining each pending tool (F2).
- NOT-COVERED: residual row for un-routed built-ins (F1).
- AMBIGUOUS: PowerShell routing as an ADR rule versus a K-proposal property (F3).

## Verdict: APPROVE-WITH-CONDITIONS
Minimal, coherent, status intact. Fix-now (docs only, before the human is asked to accept): F1 reword and residual row. F2 to F4 can ride with K. Open findings 4; failing tests 1 named (F1); F2 to F4 have no executable form yet (derived or editorial; F4 drift test optional).
Next action: Ptah edits line 78 and the residual table (plus F2 sentence); then the human decides acceptance.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][code-traced] ADR-0003 line 78 "close the session write paths this ADR knows of" and the line 90 MUST contradict line 77’s eight uncovered tools; residual table has no row (commented on #424)
2. [SUSPICION][MED][derived] no ADR consequence stated if the human routes or declines each pending tool (line 90 MUST unmeetable on decline)
3. [SUSPICION][LOW][derived] "MUST route PowerShell through K’s matcher" reads as agent authority over a human-approved settings entry; Consequences omit PowerShell becoming unusable
4. [SUSPICION][LOW][code-traced] eight-tool list hand-typed in ADR with no ADR-to-JSON drift test; MultiEdit/NotebookEdit Edit-deny coverage unmeasured (J5 = Edit, Write)
5. [CLEAN][code-traced] status proposed, no self-acceptance, precedence/hold/history line coherent, PowerShell claim matches J3
counts: issues=1 suspicions=3 clean=1
evidence: demonstrated=0 code-traced=3 derived=2
checks=adr-cache --ensure HIT (38, docs/adr:3); git show ded8782 -- docs/adr read; grep line refs verified; git status docs/adr clean; no tests executed
adr=HIT(38)
report=docs/reviews/s308-J-adr0003-amendment-architecture-2026-10-05.md
HEAD: ac9cfd7
