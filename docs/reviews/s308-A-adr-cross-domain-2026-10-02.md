# #308 story A - cross-domain review (Ra), 2026-10-02
Scope: git diff 35f49e9..07e88f3 (THOTH-ADR-0003 proposed; pointer on ADR-0001; decisions row; CHANGELOG; plan). Tier CRITICAL. Docs only. HEAD: 07e88f3.

ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog [CACHE=HIT]

## Lanes and ground covered
- Lane reviewer: architecture-reviewer (docs/reviews/s308-A-adr-architecture-2026-10-02.md): lifecycle, rule-2 contradiction, incomplete pointer, wording, CLAUDE.md interim, decline path. Not re-listed here (Issues #390, #391 already exist).
- Whole catalog read (38 ADRs). This pass checked the CODE against ADR-0003 and the downstream stories.

## Cross-domain ADR verdict
| ADR | Verdict |
|---|---|
| SE ADR-0005 (locked tests) / ADR-0010 (test deletion) | CLEAN. Diff adds/deletes no test. ADR-0003 rule 4 adds a test-code rule; it deletes nothing |
| SE ADR-0021 INT-07 | GAP, see S2. ADR-0003 widens an INT-07 exception to an allow-granting path and never states the reasoning |
| SE ADR-0021 POL-05 / POL-12 | CLEAN. Unclassified server stays opaque and denied (tool-class.ts:60-63); no kernel or registry edit |
| SE ADR-0016/17/18/20 (self-protection) | CLEAN. The protect-the-gate rule is consistent; mechanism is story F (see S4) |
| THOTH-ADR-0002 | CLEAN. Different file, no overlap |
| devops ADRs 0001-0010 | N/A (no infra) |
| THOTH-ADR-0001 | Amended by 0003; contradiction and pointer findings already filed (#390, #391) |
| CLAUDE.md Policy delivery exception | Stale until acceptance; ADR outranks it (rule 9); deferral recorded in decisions row. Not new |
| REQUIREMENTS 0.4 property 2 | Disclosed in 0003 residual table. CLEAN |
| Human rulings 2026-10-02 | Consistent. Fixture centralLayer.tools has 6 entries, all local servers, 0 connector labels; knownConnectors not read by the gate (pretooluse-kernel-gate.mjs has no reference) |

## Accuracy of decisions row and CHANGELOG
- Both match the ADR text (status proposed, recommendation pending human, E/F/J gated, no CLAUDE.md edit). No code or test changed: confirmed by git diff --stat (5 docs files). Inherited gap: both repeat "rules 1, 4 and 5" (see #391).

## Seam findings
**S1 [MED][demonstrated] ADR-0003 rule 4 is already violated by existing test code; the ADR has no conformance triage.** The catalog serves a proposed ADR as binding (#220). Query (every quoted literal of the 14 fixture names under hooks/ and src/, tests included), raw output:

    src/policy/fixtures/allowlist-settings.ts github          (carved out)
    src/policy/tools/mcp-enumeration.test.ts github           (lines 62, 96: synthetic .mcp.json input)
    src/policy/verification/allowlist.test.ts github          (SUR-04 allowlist, line 48)
    src/qa/vendor-tool-inventory.test.ts claude.ai Gmail      (line 84, a real knownConnectors entry)
    src/secret-scan/history-scan.test.ts github, patterns.test.ts github   (the word, unrelated)
    6 files, 14 names

Carve-outs are a closed list (own temporary fixture; allowlist-settings.ts). vendor-tool-inventory.test.ts:84 and mcp-enumeration.test.ts:62,96 fall outside it. PRINCIPLES rule 9 requires a conformance triage on adoption; the ADR has none, and the architect spot grep covered only 4 distinctive names. Fix: add a triage sentence to the ADR (realign the 2 sites to derive from the fixture, or widen the second carve-out to "a name in a synthetic input the test never asserts against the fixture"). Exposure: 3 sites of 6 hits, basis: counted in code.

**S2 [MED][code-traced] INT-07 / name-trust reasoning missing for an allow-granting path.** The architect asked for one sentence that no unverified third-party claim feeds the gate. That would not be accurate: tool-class.ts:60-73 classifies by server-name match only (buildServerIndex(...).byName.get(parsed.server)); the name is whatever the project .mcp.json declares (Issue #385 showed a project server named like an entry). A server named terraform or github gets remote-mutating / structured, and with AP-1 default allow nothing stops it. The INT-07 exception in ADR-0001 was justified for suppressing a halt; ADR-0003 extends it to a path that grants allow, and its residual table says only "unchanged" for in-repo source and omits display-name spoofability (ADR-0001 residual row 1). Fix: add one residual row to 0003 ("a project MCP server named like an entry is classified and allowed by the gate; deny rules in stories E/F are the only control") and one sentence of INT-07 reasoning. Exposure: ~100% of MCP calls to the 6 listed names once wired, basis: counted in code (6 entries; default allow per plan 5c).

**S3 [MED][code-traced] The two-tier review trigger is vacuous under the ruled AP-1 posture.** ADR-0003 rule 2 requires a fresh report only for an entry that "places a tool in a class the gate allows or otherwise lowers a gate outcome". With defaultOutcome allow and no rules (plan 5c), all three classes resolve allow; any entry converts opaque-deny (tool-class.ts:63) to allow. So the light path is empty today and the label remote-mutating reads as restrictive but is not. Fix: state the trigger by effect ("any entry added, or class changed, until a rule makes classes differ in outcome"). Overlaps the architect AMBIGUOUS line only in part; they did not trace the outcome. Exposure: every fixture-entry PR (6 of 6 current entries), basis: counted in code.

**S4 [SUSPICION][MED][derived] Story F mechanism cannot yet satisfy the ADR-0003 protect-the-fixture rule.** Plan F2 derives the protected list "from the hook import graph, not typed". The fixture is read by readFileSync (central-classification.ts:114) via DEFAULT_FIXTURE_PATH (line 63), not imported, so an import-graph AST scan cannot produce it; F1 names it but the F3 seeded mutant would not catch its omission. Not a defect of 0003 (it does not make F impossible). Settle at story F: a test that removes the fixture deny rule must fail. UNPROVEN-pending-verification (story F not built).

**Downstream E/F/J/K:** none made impossible. E3, F1, J1-J4, K1-K2 unaffected by 0003 beyond the acceptance gate it states. Interim risk: a fixture-entry PR before acceptance gets contradictory instructions (#390).

## Coverage gaps
- Test-code conformance with the new rule 4: unclaimed by any lane (S1).
- Existing six fixture entries: the heavier review applies to future entries only; the allow effect of the current six arrives at story J wiring. The J review set should state it. Not a finding.
- Plan file and decisions row: prose, low risk.

## Editorial
- "narrowed" for rule 4 (architect F4, not repeated).

## Verdict: APPROVE-WITH-CONDITIONS
S1-S3 are docs-only ADR edits before the human accepts; none changes shipped behavior. No executable form for S1-S3 (text edits); checkable forms: grep the ADR for a triage sentence, a spoofing residual row, an effect-based trigger. S4 maps to a named story-F test.

Single next action: patch THOTH-ADR-0003 (triage sentence, INT-07/spoofing residual row, effect-based trigger) together with the #390/#391 fixes, then put it to the human for acceptance.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] thoth-0003 rule 4 vs vendor-tool-inventory.test.ts:84, mcp-enumeration.test.ts:62,96 hardcode entry names; no conformance triage; add triage sentence or widen carve-out
2. [ISSUE][MED][code-traced] tool-class.ts:60-73 allow rests on a project-chosen server name; 0003 omits INT-07 reasoning and spoofing residual for an allow-granting path; add residual row
3. [ISSUE][MED][code-traced] 0003 rule 2 trigger "class the gate allows" is vacuous under AP-1 allow (plan 5c, tool-class.ts:63); state trigger by effect
4. [SUSPICION][MED][derived] plan F2 import-graph derivation cannot yield the fixture (readFileSync, central-classification.ts:114); add fixture-deny mutant test at story F
5. [CLEAN][code-traced] no collision with SE ADR-0005/0010/0021 POL-05/POL-12/0016-0020, THOTH-ADR-0002, devops ADRs; gate does not read knownConnectors; fixture has no connector label; decisions row and CHANGELOG accurate
counts: issues=3 suspicions=1 clean=1
evidence: demonstrated=1 code-traced=3 derived=1
checks=node scratch query over hooks/ src/ (14 names, 6 files hit, 3 sites outside carve-outs); adr-cache --ensure HIT (38); git diff --stat 5 files; no test suite run (docs-only diff)
adr=HIT(38, whole catalog)
report=docs/reviews/s308-A-adr-cross-domain-2026-10-02.md
