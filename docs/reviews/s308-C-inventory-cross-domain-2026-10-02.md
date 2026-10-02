# Story C (#308) inventory re-vendor: cross-domain review (Ra)

Date: 2026-10-02. Reviewed commit: 92a891d (range 4459b0c^..92a891d). Tier STANDARD (ratified, not re-litigated).
Lane running alongside: app-security-reviewer (class rows, capture scrubbing, AP-12/N4 strengthenings). Not re-covered here.
ADR cache line: ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT] (whole catalog read, unfiltered)

## Cross-domain ADR verdict
| ADR | Verdict |
|---|---|
| THOTH-ADR-0001 rule 4 (no hardcoded entry in hooks/ src/) | OK. A grep for claude.ai Gmail or Canva over src and hooks finds one hit, a scrubber test input (vendor-tool-inventory.test.ts:77), not an allowlist entry |
| THOTH-ADR-0001 rule 2 (no pin test required or substituted) | Borderline, see S3 (LOW suspicion) |
| THOTH-ADR-0001 rule 1 (covers only the two lists) | OK; the 8 entries sit in centralLayer.tools, in scope |
| SE ADR-0005 (no weakening of tests) | OK. AP-12 and N4 rewrites are recorded acts with decisions rows |
| Infra/API/data/migration ADRs (devops 12, SE remainder) | Not applicable: no infra, API, schema, migration in the diff |

No ADR-violation BLOCKER.

## Seam findings
**S1 [ISSUE][MED][demonstrated] Connector labels in centralLayer.tools are not inert at SessionStart: they suppress the SUR-03 halt for a local MCP server of that name.**
- Domains in tension: classification fixture (AP-3 labels, called inert) vs SessionStart SUR-03 (hooks/sessionstart-tool-enum.mjs:526-533 puts enabled .mcp.json server names into sessionTools, checked against merged.tools by exact name).
- Evidence (detached worktree, evaluateToolInventory(merged, ["claude.ai Gmail"])):
  - at the 92a891d fixture: classified includes name "claude.ai Gmail", class remote-mutating
  - at the pre-story fixture: unclassified includes "claude.ai Gmail", haltRequired true
- Effect: a project .mcp.json server keyed "claude.ai Gmail" (and 7 other names; opt-in enable required) no longer halts the session. The fixture note 3 says classifying a tool removes it from the SUR-03 unclassified/halt set. The plan (section 5, Q1) and the human ruling called the labels inert for the gate; the SUR-03 path was not examined. The app-security statement that labels cannot match runtime names holds for the gate, not for the SessionStart name list.
- Exposure: 8 newly suppressible names (counted in code: 8 of the 14 centralLayer.tools entries); sessions affected = those with an enabled project server of that name, unmeasured. Same class as the existing playwright and terraform entries: no new mechanism, a wider set.
- Minimal fix: (a) drop the 8 labels from centralLayer.tools until #381 (knownConnectors already covers the connector halt), or (b) keep them and record in the decisions row and fixture note that they also suppress SUR-03 for same-named local servers, with human re-acceptance. Needs the human, because AP-3 form (a) was ruled on the inert premise.
- Failing test to write: SessionStart over a tree whose enabled .mcp.json declares "claude.ai Gmail" must still set SUR-03-unclassified-tool.

**S2 [ISSUE][MED][demonstrated] C5(iii) is vacuous, and C5 (i)/(ii) agree by construction, so the AP-8 claim that SessionStart and the gate agree on one inventory is not proven.**
- shared-inventory-agreement.test.ts:44-55: with Monitor deleted from CLASSIFICATION at 92a891d, C5(iii) still PASSES while (i), (ii) and the mutant test fail only because assembleCatalog throws. The hook catches the throw and exits 0; the test reads only the SUR-03-unclassified-tool reason, which is not the key a catalog failure sets.
- (i)/(ii) call the same assembleCatalog twice over one file: they catch a location split, not a divergence in what each hook builds. The gate hook is never run.
- Exposure: test quality only; the live gate does not evaluate built-ins, and builtin-tool-inventory.test.ts catches the unclassified case independently. 1 of 1 runs of C5(iii) is non-discriminating (measured by the mutation).
- Minimal fix: in (iii) assert the hook wrote no catalog-failure reason (or assert the positive halt-state content); state in the header that (i)/(ii) check location agreement only.
- Failing test: delete one CLASSIFICATION entry; (iii) must go red.

**S3 [SUSPICION][LOW][code-traced] connector-labels.test.ts and N4 now make knownConnectors edits require a paired centralLayer.tools edit.** THOTH-ADR-0001 rule 2: the merged presence of an entry is its approval; no pin test is required or may substitute. Names are derived at run time (not hardcoded), but adding a connector now fails CI until a label is added. The human ruled the labels, not the test. Disappears if S1 option (a) is taken; otherwise record it in the decisions row.

**S4 [ISSUE][LOW][code-traced] Re-vendor provenance decays on the second run.** vendor-tool-inventory.ts mergeInventory: carriedForward = previous.tools minus measured. After this story previous.tools holds measured names too, so a later run on another platform, mode or account that lacks a measured name relabels it carriedForward/derived and overwrites platform and capturedAt; names are never removed, so the reverse check can never flag a retired tool. Fail direction is closed: a newly listed name with no class makes buildBuiltinToolClassificationLayer throw (SessionStart halts, gate exits 2), which is what ArtifactComments and ArtifactData would do if listed later. Fix: carry prior measuredTools and prior carriedForward under their own provenance, or document union-only.

## Seams checked, sound [CLEAN]
- SessionStart builtin universe and the gate catalog both come from assembleCatalog (SessionStart line 522; gate line 194).
- Downstream: qa:gate-matcher-drift PASS (42 names), qa:gate-manifest PASS, qa:completeness-claims PASS (2 files). The gate evaluates only Bash and mcp__ names, so no built-in class changes a decision today. Stories E and F inherit judgment classes; Monitor runs commands but is outside AP-12 (app-security LOW, not repeated).
- 33 vs 35: decisions row and CHANGELOG correct the plan; the committed inventory is 42 tools = 33 measured + 9 carried (counted by node).
- The 9 carried-forward names stay in tools and in CLASSIFICATION, so the reverse test is coherent.

## Coverage gaps
- package.json script entry and the fixture note text: no lane owns them; low risk, fine.
- Capture scrubbing: app-security lane.

## Editorial
- CHANGELOG and decisions cite the vendor script run with --from the committed capture and --dry-run as the source of "23 new, 10 in both". At 92a891d it prints NEW (0) and PRESENT IN BOTH (33) because the committed inventory already contains them. Name the base commit or drop "printed by the script".

## Verdict: APPROVE-WITH-CONDITIONS
Conditions: S1 (human decision on the labels, then fix or disclose); S2 (one-line test fix). S3 and S4 optional.
Single next action: put S1 to the human (drop the 8 labels until #381, or accept SUR-03 suppression on record).

Checks run (detached worktree at 92a891d, removed): node --test over 6 touched test files, 57 pass / 0 fail / 0 skipped; two mutations applied and reverted (Monitor entry removed; stray tool added to the inventory).

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] docs/qa/s5-central-classification.json (8 connector labels) + hooks/sessionstart-tool-enum.mjs:526 - labels classify a same-named local MCP server and suppress its SUR-03 halt (not inert); drop labels until #381 or human re-accepts on record
2. [ISSUE][MED][demonstrated] src/policy/tools/shared-inventory-agreement.test.ts:44 - C5(iii) passes with a built-in unclassified (hook catches throw, exit 0, wrong reason key); (i)/(ii) agree by construction; assert no catalog-failure reason
3. [ISSUE][LOW][code-traced] src/qa/vendor-tool-inventory.ts mergeInventory - second re-vendor relabels measured names as carried-forward/derived, never removes names
4. [SUSPICION][LOW][code-traced] src/policy/tools/connector-labels.test.ts - paired-edit requirement on knownConnectors vs THOTH-ADR-0001 rule 2
5. [CLEAN][code-traced] gate and SessionStart share assembleCatalog; gate-matcher-drift, gate-manifest, completeness PASS; 33/9/42 counts verified
counts: issues=3 suspicions=1 clean=1
evidence: demonstrated=2 code-traced=3 derived=0
checks=57 pass / 0 fail / 0 skip (6 touched test files); 2 mutations applied and reverted; qa:gate-matcher-drift, qa:gate-manifest, qa:completeness-claims PASS
adr=HIT(37, whole catalog)
report=docs/reviews/s308-C-inventory-cross-domain-2026-10-02.md
reviewed-commit=92a891d
