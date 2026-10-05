[architecture-reviewer]
Architecture Reviewer (Imhotep) -- reviewing for design coherence
ADR cache HIT: reused 38 ADR(s) [CACHE=HIT]

# #308 story E (AP-1 baseline rules) -- architecture review, 2026-10-04
Scope: 217b4c4..e9c1638 only (read via git show). CRITICAL tier. E is HELD behind THOTH-ADR-0003 (not a finding). Ran nothing (working tree is mid-build of F): checks=n/a, so no blocking HIGH is possible.

## Verdict table
| Axis | Verdict |
|---|---|
| Fit | One class allow rule under default-allow is a no-op today (kernel.ts:194-205: allow match and default both give allow); it is shape-pinning, disclosed in plan and CHANGELOG. Acceptable, small. |
| Blast radius / coupling | Good: marker-only, no target; guard data only, not wired (K). Shared fate with CLASS_MARKER_VERBS and the tool-class normalizer, tested by PT-1. |
| Compliance | ADR-0003 rule 4 CONFORMS (stand-in name `standin-docs`; E6 instrument reads names from the fixture at run time via moduleRelativeFixtureLocation). ADR-0001 CONFORMS. SE ADR-0021 / 0005: CONFORMS (no locked-test edit). |
| Cost | Bounded: one JSON rule; triage scan is O(files in hooks/ + src/), runs in `npm test`. |
| Operability | E6 failure modes are loud (untriaged, stale, violation all exit 1); also in the test suite so CI-gated. |

## Findings
1. [MED][code-traced] E6 verdicts are per file, so a NEW hardcoded fixture name in an already-triaged file passes silently. buildReport (src/qa/fixture-name-triage.ts, `untriaged: files.filter(f => !(f in triage))`) checks file membership only; the six triaged files (e.g. src/policy/verification/allowlist.test.ts, mcp-enumeration.test.ts) can gain a real ADR-0003 rule-4 violation and stay green. The instrument proves "no unreviewed file", not "no unreviewed literal", while the CHANGELOG/test title read as the stronger claim. Exposure: ~6 of 6 triaged files (100% of triaged files) are blind to additions, basis: counted in code. Fix shape: key the verdict by file plus the sorted set of (literal, name) pairs, or record the expected hit count per file, so a changed hit set is STALE/UNTRIAGED. Failing test: "buildReport: a second, different hit in an already-triaged file is untriaged".
2. [LOW][code-traced] The allow rule is decision-inert under the shipped posture; every PT test forces posture `deny`, a posture nothing ships. Value is only pinning. Not gold-plating (one rule, plan states it plainly), but the PR text must keep saying "changes no outcome" so no reader treats E as read protection. Evolution: it becomes load-bearing only with a deny posture; that flip should carry its own test that the shipped posture is still allow (E3 does pin this).
3. [LOW][derived] E-shape pins the rule list by exact deepEqual of ids, which is the right tripwire for E0 (it must edit the test deliberately when `baseline-allow-read-verbs` returns). Note for E0: PT-2 and PT2-mutant are the acceptance gate for that return; keep them.
4. [LOW][code-traced] E6 disclosed limits (single-line quoted literals; names inside longer or non-quoted forms; JSON/other extensions not scanned) are accurately documented; src/qa placement matches existing instruments (qa:fixture-* siblings). CLEAN placement, residual limit noted.

## NOT-COVERED / AMBIGUOUS (architect work queue)
- NOT-COVERED: baseline authorization for `workspace-mutating` and `remote-mutating` classes if the posture ever becomes default-deny (PT-1 only asserts they are "not explicitly authorized"). Needs an ADR/decision before any posture flip.
- NOT-COVERED: who owns flipping `defaultOutcome` from bootstrap allow to deny, and the migration order versus E0 (read verbs) so Bash reads do not all deny.

## Verdict: APPROVE-WITH-CONDITIONS
Design shape is right and minimal; HELD status stands. Condition: finding 1 gets its failing test before the held PR is released.
Next action: add the per-hit triage test and make TRIAGE verdicts hit-set-aware.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][code-traced] E6 triage verdict is per file; new hardcoded name in an already-triaged file passes (fixture-name-triage.ts buildReport)
2. [SUSPICION][LOW][code-traced] baseline allow rule decision-inert under default-allow; tests only under forced deny posture (kernel.ts:194-205)
3. [SUSPICION][LOW][derived] E0 must keep PT-2/PT2-mutant as acceptance when read verbs return; E-shape deepEqual is the intended tripwire
4. [SUSPICION][LOW][derived] NOT-COVERED: class authorization for mutating classes and posture-flip ownership under future default-deny
5. [CLEAN][code-traced] ADR-0003 rule 4 honored (stand-in names, run-time fixture names via funnel)
6. [CLEAN][code-traced] E6 placement in src/qa, CI-gated through npm test, disclosed scan limits
counts: issues=1 suspicions=3 clean=2
evidence: demonstrated=0 code-traced=4 derived=2
checks=n/a (read-only review of commits; nothing executed)
adr=HIT(38)
report=docs/reviews/s308-E-baseline-architecture-2026-10-04.md
HEAD: e9c1638
