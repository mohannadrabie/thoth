# #308 story A - architecture review (Imhotep), 2026-10-02
Scope: `git diff 35f49e9..07e88f3`, THOTH-ADR-0003 (proposed) amending THOTH-ADR-0001 in part. CRITICAL tier. Docs only.
📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog [CACHE=HIT]

## Verdict table
| Axis | Verdict |
|---|---|
| Fit | OK. New ADR is the right instrument; scope is one file, one use |
| Blast radius / coupling | OK with notes. Catalog serves `proposed` as binding (#220), so ADR-0003's rules bind agents now; ADR-0001 pointer would dangle if declined |
| SE ADR-0001 lifecycle | CONFORMS (letter). Decision/Rules/frontmatter of 0001 untouched; only the Status bullet gains a sentence. Self-acceptance avoided |
| "Amends in part" status | NOT-COVERED. SE ADR-0001 defines only `Superseded by ADR-NNNN`; partial amendment has no vocabulary |
| ADR-0021 INT-07 precedence | NOT-COVERED in ADR-0003. Only relationship to 0001 stated; 0001 carries the "more specific governs" line, 0003 does not restate it |
| A2 (no-hardcode narrowed, not dropped) | CONFORMS in substance; wording "narrowed" is inaccurate (see F4) |
| Pending human confirmation marking | CONFORMS. Marked in Status, Decision, constraint, Rules, decisions row, CHANGELOG |
| Template conformance | CONFORMS (frontmatter, Context/Decision/Rules/Consequences/Alternatives/Compliance/References; plus residual-risk block as in 0001) |
| End trigger | CONFORMS. Tied to #224 (verified OPEN) and supersede-together |
| Catalog parse | CONFORMS. `node docs/adr-cache.mjs --ensure` -> HIT, `docs/adr:3` (0001, 0002, 0003 counted) |
| A3 submodule | CONFIRMED N/A. `git status --short adr` empty; both ADRs are project tier under docs/adr/; no org rule edited (Alternative 2) |

## Findings (ranked)
1. [MED][code-traced] Contradictory rules served side by side. ADR-0001 rule 2 (thoth-0001:53) says an entry-only PR "MUST NOT be held for a fresh dated review report". ADR-0003 rule 2 (thoth-0003:13, :60) says such a PR "MUST ... attach" one when the label allows/lowers. The catalog serves both rule sets as constraints; precedence lives only in prose (thoth-0003:27 "Where this ADR names a rule, it governs that rule"), and 0003 never names "ADR-0001 rule 2". Same shape for rule 4 (0001:55 "for this allowlist"). Fix: in 0003's constraint/Rules, name the exact ADR-0001 sentence being displaced ("replaces ADR-0001 rule 2, second sentence"). Exposure: ~every future reviewer/implementer reading the catalog on a fixture PR, basis: counted in code (both ADRs in docs/adr, both served).
2. [MED][code-traced] Pointer is incomplete. thoth-0001:24 says "rules 1, 4 and 5 are narrowed or scoped"; ADR-0003 also displaces rule 2 (the 2026-09-19 exemption, the heaviest change) and the "Inert classification" residual row (thoth-0003:55; 0001:71). A reader following only 0001's pointer misses the very item awaiting human confirmation. Fix: pointer says "rules 1, 2, 4, 5 and the Inert-classification residual".
3. [LOW][derived] Rule-4 checkability regressed. 0001 verifies rules 4/5 by a single-source query over non-test hits (0001:60); 0003 puts tests in scope (thoth-0003:99) but keeps review-only checking. Spot grep I ran: distinctive entry names (aws-mcp-server, aws-knowledge-mcp-server, aws-api-mcp-server, playwright) appear in 0 files under hooks/ src/ - current state is clean, but `github`/`terraform` are common words, so a mechanical check needs a fixture-derived instrument. Recommend a follow-up Issue for a script, not a blocker (CLAUDE.md completeness rule is about claims, none made here).
4. [LOW][code-traced] "Narrowed, not dropped" mislabels rule 4: 0003 removes "for this allowlist" and adds tests, which widens its reach (stricter), with two carve-outs. A2's intent (rule retained) holds. Editorial rewording suggested.
5. [LOW][code-traced] Interim state: CLAUDE.md "Policy delivery" exception still states the 2026-09-19 exemption unmodified; ADR ranks above it (rule 9) and decisions row defers the CLAUDE.md edit until acceptance. Acceptable; ensure it lands in the acceptance PR.
6. [LOW][derived] Proposed-state coupling: ADR-0001 (accepted) now points at an unaccepted ADR. If the human declines, the pointer must be reverted. Add a one-line note in the plan/decisions row (decisions row names acceptance gating but not decline handling).

## NOT-COVERED / AMBIGUOUS (architect queue)
- NOT-COVERED: SE ADR-0001 has no status for partial amendment ("Amended in part by"). Used project convention is reasonable; propose an org amendment or accept the convention.
- NOT-COVERED: ADR-0003 silent on ADR-0021 INT-07. Widening makes class labels gate inputs; local tools/connectors dropped (#381), so no unverified third-party claim feeds the gate - state that in one sentence.
- AMBIGUOUS: "otherwise lowers a gate outcome" (thoth-0003:13) is judged by the reviewer (admitted in residual table); architect may want a closed list of classes the gate allows.

## Editorial
- Finding 4 wording. Plan/CHANGELOG say "narrowed" for rule 4.

## Verdict: APPROVE-WITH-CONDITIONS
Conditions (fix-now, docs-only): F1 and F2. F3-F6 deferred/LOW. Next action: patch the pointer and add the displaced-rule naming, then the human decides acceptance (E, F, J stay gated on it).

Open findings: 2 MED. Failing tests: 0 - no executable form (docs-only ADR; the checkable form of F1/F2 is the rule-text grep `grep -n "ADR-0001 rule 2" docs/adr/thoth-0003*` and `grep -n "rules 1, 2, 4" docs/adr/thoth-0001*`, both currently empty).

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][code-traced] ADR-0001 rule 2 and ADR-0003 rule 2 both served by catalog and contradict; precedence only in prose, displaced sentence not named
2. [ISSUE][MED][code-traced] ADR-0001 pointer lists rules 1,4,5 but omits rule 2 and Inert residual row that 0003 also displaces
3. [SUSPICION][LOW][derived] rule 4 now covers tests but verification query is non-test only; no instrument (current spot grep clean)
4. [SUSPICION][LOW][code-traced] "narrowed" mislabels rule 4, which is widened to tests
5. [SUSPICION][LOW][code-traced] CLAUDE.md Policy-delivery exemption stale until acceptance (deferred by decisions row)
6. [SUSPICION][LOW][derived] accepted ADR-0001 points to unaccepted ADR; decline path not stated
7. [SUSPICION][LOW][derived] "amends in part" has no status vocabulary in SE ADR-0001 (NOT-COVERED); INT-07 relationship unstated in 0003
8. [CLEAN][code-traced] SE ADR-0001 lifecycle, human-pending narrowing marking, template, #224 end trigger, catalog parse, A3 N/A
counts: issues=2 suspicions=5 clean=1
evidence: demonstrated=0 code-traced=5 derived=3
checks=adr-cache --ensure HIT (38 ADRs, docs/adr:3); spot grep of 4 entry names under hooks/ src/ = 0 hits; gh issue #224 OPEN
adr=HIT(38)
report=docs/reviews/s308-A-adr-architecture-2026-10-02.md
