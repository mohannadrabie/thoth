# Architecture Review — ADR-0021 "Thoth-native architecture" (checkpoint 2 / re-review)

- Reviewer: architecture-reviewer (Imhotep)
- Date: 2026-08-30
- Subject: adr/software-engineering/0021-thoth-native-architecture.md, status Proposed, adr submodule commit 76879ff ("revise(ADR-0021): evaluate AGT per shape against verified 2026-08-30 facts") -- HEAD of the adr submodule at review time
- Dispatch context: /maat:ship S1, Stage 2 (Build), Phase 2A checkpoint 2 -- re-review of a revised ADR proposal after the human rejected revision 1 for never evaluating AGT as a reuse candidate. Supersedes nothing of checkpoint 1's report (docs/reviews/adr0021-thoth-native-architecture-2026-08-30.md, immutable per PRINCIPLES rule 11); this is a fresh, independent read of the current file, cross-checked against checkpoint 1's findings rather than assuming they still hold without verification.
- Calibration: PRINCIPLES rule 17 -- still a document-only, pre-mechanism-code review. No src/, scripts/, .github/ exist in this repo. checks=n/a is correct.

## ADR cache

```
ADR cache BUILT: cataloged 35 ADR(s) [adr/devops:12, adr/software-engineering:23], catalog now current (fp f337384) [CACHE=HIT]
```

Per dispatch instructions, on CACHE=HIT domain rules are read from adrCatalog.adrs filtered to architecture/design/coupling/cost/evolution/standards. Because this is a re-review of the ADR proposal itself (not code against it), I additionally read the full current text of ADR-0021, ADR-0017 (including its new forward-pointer note), the relevant REQUIREMENTS.md sections (0.4, 1.1, 1.3, 1.4, 3.1/3.2, POL/SUR/ENV/EVD/INT/REL requirement rows), docs/decisions.md's active rows (the 2026-08-29/08-30 AGT-pivot rows), docs/backlog.md, and directly queried the live docs/.maat-state.json catalog contents via node -e -- a fuller read than the cache-only fast path, same posture as checkpoint 1.

## Verdict table

| Axis | Verdict |
|---|---|
| 1. Fit (REQUIREMENTS fidelity, reuse-vs-build genuineness) | CONFORMS -- the per-shape AGT evaluation is real engagement, not a rephrased "we prefer native" (see findings below); one LOW clarity gap in shape 1's stated reasoning |
| 2. Blast radius and coupling | CONFORMS -- six shapes, zero runtime AGT dependency in any of them, single points of failure named (kernel purity, audit log), evolution path stated (shapes 3 and 6 explicitly spike-reopenable) |
| 3. Compliance per ADR | CONFORMS to SE ADR-0001, SE ADR-0002; NOT-COVERED/live gap: docs/adr-cache.mjs's missing supersession-propagation (tracked in backlog since checkpoint 1) -- but ADR-0021's own claim that this window is now closed is inaccurate (finding 1, the primary defect this pass) |
| 4. Open-verification-item discipline (PRINCIPLES rule 18) | CONFORMS -- all four named open items are verified, per shape, to NOT be load-bearing to that shape's own BUILD verdict (checked against each shape's own "Verdict" paragraph, quoted below) |
| 5. Checkpoint-1 condition resolution | Condition 1 (Action-record wording) -- CONFORMS, correctly fixed at the layer that propagates to the compressed catalog. Condition 2 (ADR-0017 interim ambiguity) -- VIOLATES its own closure claim: the fix exists in prose but does not reach the catalog (finding 1) |

## Findings

[ISSUE][MED][demonstrated] -- ADR-0021's claim that the ADR-0017 forward-pointer note "closes architecture-reviewer's revision-1 condition 2 for the interim proposal window" (adr/software-engineering/0021-thoth-native-architecture.md:199) is false for the exact reader path the condition was about. ADR-0017 now carries a body-prose bullet ("Pending supersession (forward-pointer, 2026-08-30...)") -- verified to exist, adr/software-engineering/0017-wrap-architecture-thoth-owns-the-verdict.md:24. But docs/adr-cache.mjs's parseAdr() only extracts {id, title, status, path, applicableTo, rules} from YAML frontmatter (falling back to body-prose scanning only when frontmatter is silent, which it is not here -- ADR-0017's frontmatter status: accepted at line 4 is untouched, byte-identical to before this revision). The forward-pointer bullet is body prose outside frontmatter and outside the "## Rules for agents"/constraints: blocks the parser reads -- it is structurally invisible to the cache. Direct query of the live catalog confirms this:

```
node -e "const j=require('./docs/.maat-state.json'); console.log(JSON.stringify(j.adrCatalog.adrs.find(a=>a.id==='ADR-0017'),null,2))"
=>
  id: ADR-0017, status: accepted
  rules: [five original AGT-wrap MUST rules, verbatim, no supersession field of any kind]
```

A catalog-only reader -- the exact "on CACHE=HIT, read adrCatalog.adrs filtered by domain" path this review's own dispatch instructions specify, and the path every future domain reviewer on S2+ will use -- still receives ADR-0017's five-interface AGT wrap as unqualified, currently-binding truth, with zero signal that ADR-0021 is pending. This is the identical live gap checkpoint-1 flagged (finding 2/condition 2, docs/reviews/adr0021-thoth-native-architecture-2026-08-30.md:46); what's changed is only that ADR-0021 now asserts the gap is closed when it demonstrably is not. Checkpoint-1 offered two independently-sufficient fixes: "(a) a status annotation on ADR-0017 itself, or (b) extend docs/adr-cache.mjs to surface supersedes/supersededBy." This revision implemented (a) in a form that doesn't survive compression, so in practice only (b) remains viable given the parser's current schema -- a new frontmatter key alone would not help either, since parseAdr() does not extract arbitrary frontmatter fields (only id/title/status/applicableTo/constraints). Contrast: condition 1's fix (Action-record wording) was made correctly, in frontmatter constraints:, and is confirmed present in the live catalog (see CLEAN finding below) -- showing the correct fix pattern was available and used elsewhere in this same revision, just not here.
Exposure: ~100% of ADR-cache-HIT reads of ADR-0017's catalog entry during the proposal window (bounded -- closes automatically the moment ADR-0021 is accepted and ADR-0017's frontmatter itself flips to superseded), basis: demonstrated (direct node -e query against the live docs/.maat-state.json, quoted above, plus a direct read of docs/adr-cache.mjs's parseAdr() at lines 136-183 confirming the extraction schema).
Fix: either strike the "closes... condition 2" sentence from ADR-0021's References section until genuinely fixed, or extend docs/adr-cache.mjs's parseAdr() to read and surface a pendingSupersessionBy/supersedes signal from frontmatter, then add that field to both ADR-0017's and ADR-0021's frontmatter. The docs/backlog.md tooling-gap entry (filed at checkpoint 1) already names this; no new backlog entry needed, but the false-closure claim in ADR-0021's own text is a fresh defect this pass, and a new GitHub Issue is filed for it since no existing Issue covers this specific claim.

[CLEAN][code-traced] -- Checkpoint-1 condition 1 (Action-record "exactly the fields" MUST-line overconstraint) is correctly fixed, at the layer that actually matters. Frontmatter constraints.architecture[1] (0021...md:15) now reads: "This is a floor: a story MAY carry additional non-kernel-branching fields (e.g. audit metadata); the kernel itself MUST NOT branch on a field outside these seven" -- matching the Decision section's own wording and REQUIREMENTS.md:428's "Minimum fields:" text exactly. Body "## Rules for agents" (line 207) matches. Confirmed this propagates into the compressed catalog correctly via direct query (docs/.maat-state.json's ADR-0021 entry, rule #2, verbatim match) -- no regression from checkpoint 1's fix. GitHub Issue #55 tracking this finding is already closed, consistent with this verification.

[CLEAN][code-traced] -- Checkpoint-1's LOW suspicion 8 (SUR-09 deferred-field kernel-consumption rule, previously unstated) is now closed: constraints.architecture[4] (0021...md:18) and "## Rules for agents" (line 206) both add "MUST evaluate the Action record's deferred field as execution, not as a lesser class of action (SUR-09) -- the kernel MUST NOT treat a deferred/scheduled/background action as exempt from the same verdict its immediate equivalent would receive." Matches SUR-09's P0 acceptance text (REQUIREMENTS.md:450) and correctly propagates into the catalog (rule #5, verbatim).

[CLEAN][code-traced] -- Checkpoint-1's LOW suspicion 11 (section 1.4 survival of the section-1 scope-out, not explicitly carved out) is now addressed inline: the gate-surfaces table (0021...md:142) states the reasoning explicitly, and References (line 259) repeats the point. Checked directly against REQUIREMENTS.md:207-217 ("These are Claude Code primitives, not AGT. Set them; do not build them.") -- accurate. Satisfies the "footnote in ADR-0021" option checkpoint-1 offered.

[CLEAN][code-traced] -- Shape 1 (policy kernel) reuse-vs-build reasoning is real, not performative, though it could be tighter (see LOW suspicion below). PolicyEngine is correctly identified as confirmed-present (matches the fact sheet's confirmed-export list) and the only plausible candidate. Two genuinely unconfirmed facts are named (I/O inside its own call path; unclassified-default handling) and the Verdict paragraph explicitly states the BUILD conclusion holds "independent of how those two open items resolve" -- checked against Open verification item 1's own text ("Would only matter if shape 1 is ever reopened"), consistent.

[CLEAN][code-traced] -- Shape 2 (canonical Action record) "no candidate identified" verdict is checked against the full 18-item confirmed-present export list (PolicyEngine, OPABackend, AuditLogger, McpSecurityScanner, RingEnforcer, GovernanceVerifier, PromptDefenseEvaluator, SLOTracker, CircuitBreaker, TraceCapture, AgentIdentity, TrustManager, AgentMeshClient, LifecycleManager, KillSwitch, ShadowDiscovery, GovernanceMetrics, GenericFrameworkAdapter) -- none name a cross-tool canonical record shape, a small flat list genuinely trivial to eyeball (proportionality clause, CLAUDE.md hard-rule on hand-derived completeness claims). POL-04's cross-tool equivalence bar is cited correctly.

[CLEAN][code-traced] -- Shape 3 (normalizer/extractor registry) correctly flags FacetRegistry as NOT on the confirmed-present list (verified against the fact sheet's own two lists -- it appears only in the "NOT confirmed present" table). BUILD verdict is explicitly stated as reopenable pending a spike, and "## Rules for agents"'s SHOULD line ("re-run any of the four open verification-item spikes... before reopening the corresponding shape's reuse question") makes this an enforceable instruction, not a dangling aside. Genuine open-item handling.

[CLEAN][code-traced] -- Shape 4 (gate surfaces) reasoning is structural, not maturity-based: routing hooks through agent-governance-claude-code would mean the hooks call AGT's own PolicyEngine, a second decision path, directly conflicting with POL-03's "exactly one decision engine" (REQUIREMENTS.md:412) -- stated to hold "even a fully mature, GA AGT" version. The plugin's real existence, its three hook types, and its own documented "preserve fail-closed behavior" design rationale are engaged with and corroborated, not dismissed -- genuine evaluation.

[CLEAN][code-traced] -- Shape 5a (audit log) evaluation names two real candidates (SDK AuditLogger, plugin's audit-log.json writer), correctly flags durability/truncation/write-reach as unconfirmed AND internally contradictory across sources (this session's fact sheet vs. REQUIREMENTS.md:148's historical description of the SDK's AuditLogger as "in-memory only" -- the ADR explicitly names this contradiction rather than picking a side). BUILD verdict is stated to hold "even setting the unconfirmed points aside," on cost/blast-radius grounds -- correctly decoupled from the open item per Open-verification-item 4's own text.

[CLEAN][code-traced] -- Shape 5b (unlock economy) "no candidate identified" is checked against the same 18-item export list; the domain mismatch (AGT governs agent actions, not human review-artifact-gated unlocks) is real, not asserted.

[CLEAN][code-traced] -- Shape 6 (environment/assurance model) correctly flags RingEnforcer's actual mechanism (executed probe vs. self-declared config comparison) as unconfirmed, and grounds the BUILD verdict in a structural mismatch (linear ring/tier model vs. named, selector-based, multi-domain environments with a four-level assurance dial and a separate stance) stated to hold "independent of what the rings measure underneath" -- correctly decoupled from Open verification item 3.

[SUSPICION][LOW][derived] -- Shape 1's stated reasoning foregrounds the POL-05 short-circuit's narrow cost/benefit case ("a handful of lines... cheap to build and test directly, and is the single property carrying section 0.2's core promise") as the argument for keeping the entire kernel -- the whole (worldFacts, ActionRecord) -> Verdict decision function, which under the now-superseded ADR-0017 included AGT's PolicyEngine handling layering/conflict-resolution for everything POL-05 didn't already deny (REQUIREMENTS.md:138, section 1.3 row 2) -- native. A more decisive, general argument is available but understated: POL-11's kernel-purity rule plus SE ADR-0002's existing no-vendor-SDK-import layer-boundary precedent (which ADR-0021's own Compliance Verification section commits to enforcing structurally -- "a structural/lint check on the kernel's own directory... asserting... no vendor-SDK import") forecloses importing AGT's PolicyEngine into the kernel's module boundary regardless of whether AGT's purity is ever confirmed -- a structural bar, not a risk-weighted preference. As written, the prose reads more like "we chose caution over an unconfirmed premise" than "the layer-boundary rule already forbids this regardless of the premise," for the broader-than-POL-05 scope of the shape. This doesn't change the verdict (BUILD is correct either way, and section 1.3's old "AGT wins the engine" verdict is itself already scoped out and non-binding per docs/decisions.md 2026-08-29) and reopens nothing -- it's a completeness/clarity gap in the ADR's own stated argument, not a soundness defect. Caps at LOW/derived per PRINCIPLES rule 19; feeds the architect's queue as a wording tightening.
Exposure: N/A (reasoning-clarity finding, not a behavioral gap) -- basis: derived (reasoned from the ADR's own text against REQUIREMENTS.md's requirement text and SE ADR-0002's precedent, nothing run).

[CLEAN][code-traced] -- Alternatives-considered section 4 explicitly and non-defensively documents the human's rejection of revision 1 and states why the earlier reasoning was unsound even though it reached the same six conclusions ("the fact that this revision reaches the same six BUILD verdicts doesn't make the earlier reasoning sound; it makes the earlier shortcut... unsound") -- matches PRINCIPLES rule 13 ("never skip a gate silently") and the blame-free finding culture (rules 4-5). A genuine self-correction on the record, not a rubber stamp dressed as one.

[CLEAN][code-traced] -- Checkpoint-1's remaining CLEAN findings (kernel purity vs. POL-11/SE-ADR-0002; canonical Action-record field list vs. REQUIREMENTS.md:428; normalizer registry vs. POL-12/section 3.2; gate-surface halt point vs. CTN-01/CTN-04/gap-G5; evidence-trail properties vs. INT-05/REL-02/EVD-01/03/08/17; environment/assurance model vs. section 2.1/2.2; supersession target correctly limited to ADR-0017 only; POL-03's stale SurfaceParityChecker acceptance-text self-disclosure) all still hold on direct re-read of the current file text against the same requirement citations -- carried forward, not re-derived from scratch (see checkpoint-1 report, docs/reviews/adr0021-thoth-native-architecture-2026-08-30.md, for the line-by-line trace). None of the underlying prose that grounded those findings changed in this revision except where noted above.

## NOT-COVERED / AMBIGUOUS -- architect's work queue

1. docs/adr-cache.mjs's missing supersedes/supersededBy/pending-supersession propagation (tooling gap, already on docs/backlog.md since checkpoint 1) -- this pass adds that ADR-0021's own text incorrectly claims this is already closed; needs either the tooling fix or a text correction before acceptance (finding 1).
2. Shape 1's stated reasoning could more decisively ground the whole-kernel BUILD call in the structural no-vendor-SDK-import rule (POL-11 + SE ADR-0002) rather than primarily the POL-05-narrow cost/benefit case -- a wording tightening, not a re-decision (LOW suspicion above).
3. (Carried from checkpoint 1, still open, not this ADR's job) Correcting REQUIREMENTS.md section 1/3's acceptance text that still literally names AGT artifacts (e.g. SurfaceParityChecker in POL-03's own acceptance note) -- explicitly deferred to a later story by ADR-0021 itself (Consequences/Negative).

## Editorial

None beyond what is already captured as findings above.

## Overall verdict: APPROVE-WITH-CONDITIONS

The per-shape reuse-vs-build reasoning is genuine engagement with the supplied AGT facts, not a rephrased "we prefer native" -- five of six shapes ground their BUILD verdict in a real, specific requirement-or-structural mismatch, decoupled correctly from each shape's own unconfirmed facts (satisfying PRINCIPLES rule 18); the sixth (shape 1) reaches a correct verdict through a reasoning path that could be sharper but is not unsound. Checkpoint-1's condition 1 (Action-record wording) is genuinely and correctly fixed. Checkpoint-1's condition 2 (ADR-0017 interim ambiguity) is not actually closed despite the ADR's own text claiming it is -- this is the one live defect blocking acceptance, and it is a small, well-understood fix.

Conditions (pre-acceptance):
1. Fix the ADR-0017 catalog-visibility gap for real -- extend docs/adr-cache.mjs to surface a supersession-pending signal from frontmatter (the only fix that survives compression given the current parser schema), and only then leave ADR-0021's "closes... condition 2" claim standing; until the tooling lands, strike or soften that sentence so the ADR's own text doesn't misstate its status.
2. (Optional, non-blocking) Tighten shape 1's stated reasoning to name the structural no-vendor-SDK-import rule (POL-11 + SE ADR-0002) as the primary driver for the whole-kernel BUILD call, not just the POL-05-narrow cost argument -- a wording change, no redesign.

Neither condition blocks S1's Phase 2 build from proceeding on the six-shape design; both should land before a human accepts ADR-0021, per the same reasoning checkpoint-1 applied to its own conditions.

## Evidence log (commands run)

Command: node docs/adr-cache.mjs --ensure
Output: ADR cache BUILT: cataloged 35 ADR(s) [adr/devops:12, adr/software-engineering:23], catalog now current (fp f337384) [CACHE=HIT]

Command: node -e query of docs/.maat-state.json's adrCatalog entry for ADR-0017
Output: id: ADR-0017, status: accepted, rules: [five original AGT-wrap MUST rules, verbatim, no supersession field]

Command: node -e query of docs/.maat-state.json's adrCatalog entry for ADR-0021
Output: id: ADR-0021, status: proposed, rules: [11 rules, verbatim, matches Decision-section wording]

Command: cd adr && git log --oneline -5 -- software-engineering/0021-thoth-native-architecture.md
Output:
  76879ff revise(ADR-0021): evaluate AGT per shape against verified 2026-08-30 facts
  0eb19be fix(ADR-0021): Action record MUST rule uses minimum-fields, not exact-field-count semantics
  3b0bff5 Propose ADR-0021: thoth-native architecture (supersedes ADR-0017)

Command: cd adr && git log --oneline -5 -- software-engineering/0017-wrap-architecture-thoth-owns-the-verdict.md
Output:
  76879ff revise(ADR-0021): evaluate AGT per shape against verified 2026-08-30 facts
  2d43c45 Accept ADR-0017: wrap architecture -- thoth owns the verdict

Command: gh issue list --search "catalog" --repo mohannadrabie/thoth --state all
Output: no match for this specific finding -- issues #9, #40, #45, #47, #52, #55 all cover other findings; #40 is the closest sibling precedent, on ADR-0020/0018's frontmatter, already fixed and closed there

Command: gh label list --repo mohannadrabie/thoth --limit 50
Output: confirmed bug, severity:high, severity:med, chore, infra/governance labels exist

No code exists yet in this repo (src/, scripts/, .github/ all absent) -- this is a document-only review. checks=n/a is correct per PRINCIPLES rule 19; the one blocking finding above is demonstrated (a live query against the actual repo state), so it may gate per the evidence policy.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius -- status [ISSUE]=VIOLATES / [SUSPICION]=NOT-COVERED or AMBIGUOUS / [CLEAN]=CONFORMS; severity and evidence tag on each):
1. [ISSUE][MED][demonstrated] ADR-0021:199 claims the ADR-0017 forward-pointer note closes checkpoint-1's condition 2, but the note is body prose outside frontmatter/constraints, invisible to adr-cache.mjs's parseAdr() (code-read confirmed) -- live docs/.maat-state.json query confirms ADR-0017's catalog entry still shows unqualified status: accepted with all five original AGT-wrap rules and no supersession signal.
2. [CLEAN][code-traced] Checkpoint-1 condition 1 (Action-record MUST-line) correctly fixed at the frontmatter-constraints layer, confirmed present in the live compressed catalog; Issue #55 already closed consistent with this.
3. [CLEAN][code-traced] SUR-09 deferred-field kernel-consumption rule (checkpoint-1 LOW suspicion 8) now stated in constraints and Rules-for-agents, matches SUR-09's P0 text.
4. [CLEAN][code-traced] Section 1.4 survival-of-scope-out footnote (checkpoint-1 LOW suspicion 11) now stated inline in the gate-surfaces table and References, matches REQUIREMENTS.md:207-217.
5. [CLEAN][code-traced] Shape 1 (policy kernel) AGT evaluation is genuine: PolicyEngine correctly ID'd as sole confirmed candidate, two real unconfirmed facts named, BUILD verdict explicitly stated independent of both.
6. [CLEAN][code-traced] Shape 2 (Action record) "no candidate" verdict checked against the full 18-item confirmed-export list, genuinely no match.
7. [CLEAN][code-traced] Shape 3 (normalizer registry) correctly flags FacetRegistry as unconfirmed-not-present, BUILD-with-open-spike is honest and enforceably reopenable.
8. [CLEAN][code-traced] Shape 4 (gate surfaces) reasoning is structural (POL-03 one-engine conflict), not maturity-based; plugin's real design is engaged with, not dismissed.
9. [CLEAN][code-traced] Shape 5a (audit log) names two real candidates, flags a genuine cross-source contradiction on durability, BUILD verdict explicitly holds independent of the unconfirmed point.
10. [CLEAN][code-traced] Shape 5b (unlock economy) "no candidate" checked against the full export list, real domain mismatch.
11. [CLEAN][code-traced] Shape 6 (environment model) RingEnforcer mechanism flagged unconfirmed; BUILD verdict grounded in a structural mismatch independent of the open item.
12. [SUSPICION][LOW][derived] Shape 1's stated reasoning underemphasizes the more decisive structural no-vendor-SDK-import argument (POL-11 + SE ADR-0002) in favor of a narrower POL-05 cost/benefit case -- verdict unaffected, wording-only gap.
13. [CLEAN][code-traced] Alternatives section 4 self-discloses revision 1's defect plainly rather than glossing over it.
14. [CLEAN][code-traced] Checkpoint-1's carried-forward CLEAN findings (kernel purity, Action-record fields, normalizer registry, gate-surface halt point, evidence-trail properties, environment model, supersession target, POL-03 stale-text self-disclosure) all still hold on re-read.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=1 clean=12
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=1 code-traced=12 derived=1
checks=n/a (document-only review; no mechanism code exists yet in this repo)
adr=HIT(35)
report=docs/reviews/adr0021-thoth-native-architecture-checkpoint2-2026-08-30.md
