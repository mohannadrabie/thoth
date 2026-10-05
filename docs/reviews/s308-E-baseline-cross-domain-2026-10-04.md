# Cross-domain review: #308 story E (AP-1 baseline rule), 217b4c4..e9c1638

[cross-domain-reviewer] Ra. Date 2026-10-04. Tier CRITICAL. HELD behind THOTH-ADR-0003 (proposed; not a finding).
ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 702b16a) [CACHE=HIT]. Whole catalog, unfiltered.

Read at e9c1638 via git show and a git archive copy in the scratchpad. No state-changing git on the working tree.

## Lanes and ground covered
- architecture-reviewer (s308-E-baseline-architecture-2026-10-04.md): rule shape, inertness under default allow (LOW), E6 per-file verdict (MED, #412), E6 placement and CI-through-npm-test.
- red-team: running alongside. Not re-covered: withheld verb allow, mandatory inertness, #408, #409, #410, #411.

## Cross-domain ADR verdict (whole catalog vs the 7 changed files)
| ADR | Verdict |
|---|---|
| THOTH-ADR-0003 rule 4 (no hardcoded fixture names, test code included) | CONFORMS. Script and tests derive names at run time; the 6 hit files are the ADR carve-outs or unrelated strings. Hold rule honoured in CHANGELOG. |
| THOTH-ADR-0001 rule 4 (as amended) | CONFORMS |
| SE ADR-0021 (POL-05 / INT-07 / POL-12) | CONFORMS. Rule is marker-only, no target. |
| SE ADR-0005 (locked tests) | CONFORMS. Archive run: no pre-existing test flipped. |
| Infra/devops ADRs (12) | NOT-APPLICABLE (no IaC, network, IAM in the diff) |
| Remaining SE ADRs | NOT-APPLICABLE or no collision found |
No ADR collision.

## Raw checks (archive of e9c1638, no .git)
- node src/qa/fixture-name-triage.ts: 14 fixture names read at run time; 8 literal hit(s) in 6 file(s), all not-violation, exit 0.
- node --test baseline-rules.test.ts fixture-name-triage.test.ts: tests 11, pass 11, fail 0, skipped 0.
- npm test (full): tests 1882, pass 1873, fail 9, skipped 0. 8 failures need a real .git (archive has none, git exit 128: QA-14/QA-15 probes, OSS-01 dogfood, R4 x2, R187); 1 timing test (A16 latency corpus) passes alone (pass 1, fail 0). None touches E. Environmental, not findings.
- gate-manifest, gate-command-path, kernel-purity, QA-15, QA-13: PASS. QA-16: VACUOUS-PASS (pre-existing).

## Seams checked
1. Rule vs SessionStart halt / classification (#93, #288). git grep: shipped-defaults.json is read only by the gate hook (hooks/pretooluse-kernel-gate.mjs:82,189) and print-cli.ts. The SessionStart halt path does not load it. E changes nothing for the halt. CLEAN.
2. E6 script vs CI. No dedicated ci.yml step, but test "the real repo: every hit file ... carries a verdict" runs under the CI npm test step. Not a dead instrument. CLEAN.
3. Gate sandbox. hooks/test-support/gate-sandbox.ts:206 overwrites shipped-defaults with an empty rule set, so existing gate tests never see the new rule. CLEAN.
4. Doc claims vs code. CHANGELOG, plan and commit message match the code (7 named tests exist; one rule; version string; verb allow withheld). One stale claim, below.

## Findings
1. [MED][code-traced] Stale enforcement-state disclosure; the rule cannot fire on any committed tool.
   docs/qa/s5-central-classification.json:6 says "no shipped rule matches a class yet ... today a class drives no live enforcement decision"; hooks/pretooluse-kernel-gate.mjs:11 still lists "baseline allow content" as an unmet precondition. E ships a rule matching a class marker, so both are now false. All 6 committed centralLayer.tools[] entries are remote-mutating; none is read-only, so baseline-allow-class-read-only matches no committed tool (an unclassified read tool is POL-05-denied regardless). STATE.md:69 "#93 and #288 close with #308" should not lean on E as the class consumer. Domains in tension: policy delivery (shipped rule) vs classification fixture and hook docs (operator-facing).
   Exposure: ~100% of readers of the fixture notes (1 file, 1 header), basis: counted in code.
   Minimal fix: reword both sentences in the held PR (the fixture notes edit rides the same PR); state "the one shipped class rule matches no committed entry".
   Failing test: fixture-notes-do-not-claim-no-shipped-class-rule (notes text must not contain "no shipped rule matches a class" while shipped-defaults.json holds a tool-class: verb rule).
2. [LOW][code-traced] Coverage gap: CLAUDE.md Sensitive areas does not name src/policy/config/shipped-defaults.json. It is enforcement-relevant now (E) and F adds deny rules there; only the broad "Policy delivery / config surface" bullet reaches it. Fix: name it at ADR acceptance (the human owes a CLAUDE.md edit anyway). Not filed.
3. CLEAN: E6 gated via npm test (11/11), instrument exit 0.
4. CLEAN: SessionStart halt/classification path never loads shipped-defaults.
5. CLEAN: gate sandbox isolates existing gate tests from the new rule.
6. CLEAN: whole-catalog ADR pass, no collision, no locked test flipped.

Not re-filed (already named): E6 per-file verdict (#412), decision-inert allow rule (architecture LOW).

## Coverage gaps
- package.json script and CHANGELOG: low-risk, covered by CI behaviour above.
- .thoth/policy.json still the 0.0.0-s6-placeholder project layer: intentional, unchanged.

## Verdict: APPROVE-WITH-CONDITIONS
Condition (fix-now, in the held PR): correct the two stale sentences (finding 1). Single next action: human decides THOTH-ADR-0003; fold the rewording into the same PR.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][code-traced] docs/qa/s5-central-classification.json:6 + hooks/pretooluse-kernel-gate.mjs:11 say no shipped rule matches a class / baseline allow unmet; false after E, and 0 of 6 committed entries is read-only so the rule fires on nothing; reword
2. [SUSPICION][LOW][code-traced] CLAUDE.md sensitive areas does not name shipped-defaults.json; name it at ADR acceptance
3. [CLEAN][demonstrated] E6 gated via npm test (11/11), instrument exit 0
4. [CLEAN][code-traced] SessionStart halt/classification path never loads shipped-defaults (only gate hook, print-cli)
5. [CLEAN][code-traced] gate-sandbox.ts:206 empties shipped-defaults; existing gate tests unaffected
6. [CLEAN][demonstrated] whole-catalog ADR pass: no collision, no locked test flipped
counts: issues=1 suspicions=1 clean=4
evidence: demonstrated=2 code-traced=4 derived=0
checks=baseline-rules+triage tests 11 pass/0 fail/0 skip; full npm test on .git-less archive 1873 pass/9 fail/0 skip (8 need .git, 1 timing test passes alone); E6 script exit 0
adr=HIT(38, whole catalog)
report=docs/reviews/s308-E-baseline-cross-domain-2026-10-04.md
HEAD: e9c1638
