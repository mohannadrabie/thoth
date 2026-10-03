# #308 story A - architecture re-confirm (Imhotep), 2026-10-02
Delta: `git diff 07e88f3..af9285f` (ADR-0003, ADR-0001 pointer, decisions row, CHANGELOG, plan). Read-only.
📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog [CACHE=HIT] (fp 702b16a)

## Round-1 items
| Item | Result |
|---|---|
| #390 precedence | FIXED. New catalog-served security constraint "Precedence" (thoth-0003 constraints) plus a Rules bullet name the displaced ADR-0001 rule-2 sentence, the Inert residual row, rule-5 scoping and rule-4 extension. Contradiction now resolvable from served text alone |
| #391 pointer | FIXED. thoth-0001 Status sentence lists rule 1 widened, rule 2 sentence replaced, rule 5 scoped, rule 4 extended, Inert row superseded |
| F3 (rule-4 checkability) | ADDRESSED. Conformance triage table of 6 sites, each non-violation; G18/G19 exist in gate-structure.test.ts (verified) |
| F4 wording "narrowed" | FIXED. Rule 4 now "keeps ADR-0001's text ... adds one clarification" |
| F6 decline path | FIXED (pointer reverted if declined, in both Status lines) |
| F7 status vocabulary | FIXED. "Status vocabulary" bullet states project convention, offers org amendment |
| INT-07 (Manager ruling) | WORDING OK. "gate classifies by server name, a string .mcp.json chooses ... not verified identity" is accurate; extension of ADR-0001's exception is bounded by rule 3 and reviewed-PR control; residual row "Name spoofability (INT-07)" added with the right effect (default allow, only E/F deny rules stop it). Better than my one-sentence suggestion, which would have been false |
| Posture claim | Verified: `rules: []` in src/policy/config/shipped-defaults.json:3 and .thoth/policy.json:3; BOOTSTRAP_DEFAULT_OUTCOME exists |
| Catalog parse | HIT, docs/adr:3 |

## New observations from the rework (none blocking)
1. [LOW][code-traced] The Precedence constraint quotes the displaced sentence as beginning "...MUST NOT be held for a fresh dated review report". That is the Rules-bullet wording; ADR-0001's matching constraint 2 reads "does not need a fresh dated report". The parenthetical "(and the matching sentence of its security constraint 2) that begins ..." is therefore imprecise. The target is still unambiguous. Editorial.
2. [LOW][derived] Triage's "reviewers' scans found 6 files" is a hand-stated completeness claim; the query is described, not scripted (CLAUDE.md completeness rule, proportionality: small flat set, so tolerable). Story E should ship the fixture-derived script.
3. [LOW][derived] Rule 4 now hinges on "asserts fixture behavior" vs "unrelated use", a reviewer judgment. Acceptable and honest; architect may want it closed after E's script exists.
4. [LOW][derived] Fit: ADR-0003 now also decides a settings.json `Edit(...)` deny and a story K hold. Justified by findings #395 and the gate's routing (Bash and mcp__ only), but it is the ADR's largest scope growth; story K must exist as a tracked item.
5. Residual still honest: the "reviewed-PR trigger rests on a Manager recommendation" row and the CLAUDE.md interim are disclosed.

## Verdict: APPROVE
Open findings: 0 blocking; #390 and #391 resolved by this delta. Failing tests: 0 (docs only). Next action: human decides acceptance of THOTH-ADR-0003 (and the 2026-09-19 narrowing); E, F, J, K stay held.

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][LOW][code-traced] Precedence constraint quotes the Rules-bullet wording as the start of ADR-0001 constraint 2's sentence, which reads differently (editorial)
2. [SUSPICION][LOW][derived] triage "6 files" is hand-stated; ship a fixture-derived script with story E
3. [SUSPICION][LOW][derived] rule 4 "asserts fixture behavior" is reviewer judgment
4. [SUSPICION][LOW][derived] ADR-0003 scope grew to cover story K and an Edit deny; K needs a tracked item
5. [CLEAN][code-traced] #390, #391, pointer, decline path, status vocabulary, INT-07 sentence and spoofing residual row, G18/G19 and rules:[] claims verified, catalog parse
counts: issues=0 suspicions=4 clean=1
evidence: demonstrated=0 code-traced=2 derived=3
checks=adr-cache --ensure HIT (38 ADRs, docs/adr:3); grep G18/G19 in gate-structure.test.ts present; rules:[] confirmed in both policy files
adr=HIT(38)
report=docs/reviews/s308-A-adr-architecture-round2-2026-10-02.md
