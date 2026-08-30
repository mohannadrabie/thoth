# Architecture Review — ADR-0021 "Thoth-native architecture"

- Reviewer: architecture-reviewer (Imhotep)
- Date: 2026-08-30
- Subject: adr/software-engineering/0021-thoth-native-architecture.md, status Proposed, adr submodule commit 3b0bff5 ("Propose ADR-0021: thoth-native architecture (supersedes ADR-0017)")
- Dispatch context: /maat:ship S1, Stage 2 (Build), Phase 2A checkpoint 1 -- design review of a proposed ADR before any mechanism code is written. No src/, scripts/, .github/ exist in this repo yet.
- Calibration: PRINCIPLES.md rule 17 -- the deliverable at this stage is "at most a one-page shape note covering topology, blast radius, and evolution path," not an implementation spec. This review grades the shape, not implementation completeness.

## ADR cache

```
ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- approx 17300 tokens saved this pass (fp 6c22c70) [CACHE=HIT]
```

Per dispatch instructions, on CACHE=HIT the domain rules are read from adrCatalog.adrs in docs/.maat-state.json, filtered to architecture/design/coupling/cost/evolution/standards. Because this review job is specifically to judge whether a new ADR is a sound shape and whether it cleanly supersedes an existing one, I additionally read both ADR files in full (0021, 0017), the surrounding SE ADRs it cites (0001, 0002), the neighboring port-fidelity ADRs (0016, 0018, 0019, 0020) to check for uncovered contradictions, REQUIREMENTS.md sections 0, 1.1, 1.4, 2, 3, 5, 6, 7, and docs/decisions.md active rows -- a fuller read than the cache-only fast path, appropriate given the subject is itself an ADR proposal, not a code diff.

## Verdict table

| Axis | Verdict |
|---|---|
| 1. Fit (REQUIREMENTS fidelity) | CONFORMS, with one internal-consistency defect (finding 1) |
| 2. Internal coherence (six shapes) | CONFORMS, with one gap left implicit (finding 3) |
| 3. Compliance per ADR | CONFORMS to SE ADR-0001, SE ADR-0002; correctly inert against SE ADR-0016/0018/0019/0020 (no porting occurs under this ADR, so their port-triggered rules do not fire); no conflict found against any devops-domain ADR (none apply -- this is a pure application-architecture decision) |
| 4. Supersession (rule 9) | CONFORMS to the propose-then-accept convention this repo already uses (mirrors ADR-0020's accept-and-supersede-ADR-0018 pattern), but leaves a live interim-ambiguity gap in the compressed catalog (finding 2) |
| 5. Blast radius / evolution path | CONFORMS -- six shapes give S2+ one fixed contract; environment/assurance deferral to S11a/b/c is clean (declarative data, not kernel logic) |

## Findings

[CLEAN][code-traced] -- Policy kernel purity (shape 1) matches POL-11 verbatim ("no filesystem, network or process access, unit-testable without a harness. World facts are passed in", REQUIREMENTS.md:420) and correctly mirrors SE ADR-0002's existing domain-layer purity rule ("Pure -- no framework, no I/O, no SDK imports", adr/software-engineering/0002-multi-layer-architecture.md:41). ADR-0021 section 1 (lines 64-70) states this precisely, including the load-bearing point that purity -- not a differential harness -- is what makes section 0.4 property 3 structural.

[CLEAN][code-traced] -- Canonical Action record field list (shape 2) matches REQUIREMENTS.md:428 exactly: source (parsed/structured/opaque), verbs, targets, environment, identity, deferred, unresolved, same order, same shapes. deferred's citation to SUR-09 and unresolved/source:opaque's citation to POL-05 are both accurate.

[ISSUE][MED][code-traced] -- The ADR's own "Rules for agents" section overconstrains the Action-record field list beyond what REQUIREMENTS.md states, and contradicts its own Decision section's more careful wording. REQUIREMENTS.md:428 reads "Minimum fields:" -- a floor, not a ceiling. ADR-0021's Decision section (line 86) correctly reflects this: "no story may substitute a tool-specific shape for it or add a field the kernel branches on outside these seven" (a restriction on kernel-branching fields, not on the record's field count). But the binding "Rules for agents" MUST line (adr/software-engineering/0021-thoth-native-architecture.md:133) drops that qualifier: "MUST normalize every governed tool call into one canonical Action record with exactly the fields source, verbs, targets, environment, identity, deferred, unresolved" -- an unqualified ceiling. This is the text that gets compiled verbatim into docs/.maat-state.json's adrCatalog.adrs and is what every downstream story's cache-HIT read actually enforces. As written, a strict reading blocks a legitimate future need (e.g. attaching audit-trail metadata the record itself is a natural home for, per EVD-11's "structured metadata... scope, verdict, blocker count") without a fresh ADR amendment merely to add a non-decision-bearing field. Fix: reword the MUST line to match the Decision section's actual rule -- "MUST normalize every governed tool call into a canonical Action record carrying at minimum the seven section-3.1 fields; MUST NOT add a field outside these seven that the kernel branches on."
Exposure: ~100% of S2's Action-record/kernel schema design work reads this MUST line as the operative constraint (basis: code-traced -- it is the literal text every downstream cache-HIT read receives).

[CLEAN][code-traced] -- Normalizer/extractor registry (shape 3) matches POL-12 ("Adapters shall be registered by declaration, not by editing a dispatch chain", REQUIREMENTS.md:421) and section 3.2's layer boundary ("The kernel never learns about a tool. Normalizers never make a decision", REQUIREMENTS.md:432) precisely, including the SUR-02 terminal-fall-through-is-deny framing for unrecognized tools.

[CLEAN][code-traced] -- Gate surfaces and the UserPromptSubmit halt point (shape 4) match CTN-01/CTN-04 verbatim, including the gap-G5 reasoning ("A SessionStart hook cannot deliver this... The halt is therefore owned by UserPromptSubmit", REQUIREMENTS.md:334,337) and correctly ties structural single-engine parity to shape 1's purity rather than re-asserting a differential-harness claim that no longer has a second engine to diff against.

[CLEAN][code-traced] -- Evidence trail (shape 5) is correctly scoped as "shape only, full detail is later stories' job" and its two parts are accurately grounded: the audit-log properties (hash-chained from genesis, append-only, no truncation, timing-safe verification, atomic write, outside session write reach) trace to REQUIREMENTS.md:148 (the AGT lib/audit.mjs artifact description, now inapplicable as a dependency per the 2026-08-29 scope-out) and INT-05/REL-02 (REQUIREMENTS.md:469,590, still binding, section 5/10, not section 1). The ADR's own text (line 112) correctly separates the AGT-specific defects (now moot, nothing being borrowed) from the underlying requirement (still governs whatever is built natively) -- a careful, non-hand-wavy thread through a scoped-out section without smuggling in an invented requirement. The unlock economy bullet matches EVD-01/EVD-03/EVD-08/EVD-17 precisely.

[SUSPICION][LOW][derived] -- Shape 1's kernel MUST rules (adr/software-engineering/0021-thoth-native-architecture.md:130-133) explicitly state the denial rule for source:opaque/non-empty unresolved, but state no rule for how the kernel must treat deferred -- despite SUR-09 being P0 ("Deferred and indirect execution shall be evaluated as execution", REQUIREMENTS.md:450). The field's existence and purpose are correctly named in shape 2's table; what the kernel does with it is left unstated. Per rule 17 this is legitimately downstream algorithmic detail for a one-page shape note, so this caps at LOW and does not block -- but it is a real gap the architect's queue should carry into S2, since SUR-09 is a P0 requirement this ADR's own Rules-for-agents list otherwise does not cite at all.

[CLEAN][code-traced] -- Environment/assurance model (shape 6) matches section 2.1/2.2 exactly (stances allowed/read-only/forbidden; assurance proven/guarded/asserted/none; profiles standard(floor guarded, unknown=warn)/regulated(floor proven, unknown=deny)) and correctly frames it as declarative data consumed by the kernel as a world fact rather than kernel logic -- the stated evolution path (S11a/b/c growing selectors without touching kernel code) is checkable and consistent with shape 1's purity claim.

[SUSPICION][MED][code-traced] -- The supersession itself follows this repo's own established two-step convention (propose now, flip ADR-0017's status to superseded at acceptance -- mirrored exactly by the c45f646 commit that accepted ADR-0020 and simultaneously superseded ADR-0018), so the mechanism is not novel or improper. But the interim state is genuinely ambiguous to a catalog-only reader, which matters because that is this project's own designated cheap read path. Verified directly: docs/.maat-state.json's adrCatalog.adrs entry for ADR-0017 still reports "status": "accepted" and lists its five Rules for agents verbatim (including "AGT is reached only through five named interfaces: policy evaluation, audit sink, credential vault, facet extraction, integrity manifest") with no supersedes/supersededBy field at all -- confirmed by grep -n "supersed" docs/adr-cache.mjs, which returns zero matches; the cache script has no concept of propagating a supersedes relationship into the compressed catalog it emits. An agent (a future domain reviewer on S2+, dispatched with this same "on CACHE=HIT, read adrCatalog.adrs filtered by domain" instruction this review itself received) that trusts the catalog alone -- the intended token-efficient path -- receives ADR-0017's AGT-wrap rules as unqualified, currently-binding truth, with no signal a supersession is pending. docs/decisions.md's 2026-08-29/08-30 rows do disclose the AGT-pivot out of band, and PRINCIPLES rule 14 hydrates decisions.md before ADRs each session, so an agent doing a full session hydration is not misled -- the gap is specific to a narrower catalog-only read. This is not a defect in ADR-0021's own text (it correctly cites docs/decisions.md in its References and states supersession "takes effect at ADR-0021's own eventual acceptance"), so it is filed as NOT-COVERED against the process/tooling rather than VIOLATES against the ADR itself. Fix, either is sufficient: (a) add a short forward-pointer to ADR-0017 itself -- a status annotation, not a Decision edit, consistent with rule 9's "mark the old one superseded" allowance applied one step earlier as "mark the old one pending-supersession" -- or (b) extend docs/adr-cache.mjs to surface each ADR's supersedes/supersededBy metadata in its catalog output.
Exposure: ~100% of ADR-cache-HIT reads of the ADR-0017 catalog entry during the proposal window (bounded in time -- closes the moment ADR-0021 is accepted and 0017 flips to superseded), basis: code-traced (direct JSON query and grep, both quoted below in the evidence log).

[CLEAN][code-traced] -- The supersession's target selection is well-reasoned: only ADR-0017 is formally superseded, because it is the only one of the five port/wrap-era ADRs (0016-0020) whose actual decision content is being replaced by new content (a native architecture covering the same six concerns ADR-0017's wrap covered). ADR-0016, 0018, 0019, 0020 describe generic porting-fidelity and self-protection patterns that are not replaced by anything new -- they are just currently inapplicable because no porting is happening under this ADR -- and are correctly left alone, covered by the already-ratified, separate docs/decisions.md (2026-08-29) "scoped out" row rather than force-superseded with no replacement content. Confirmed against each file's own frontmatter status field and the ADR directory listing.

[SUSPICION][LOW][derived] -- REQUIREMENTS.md section 1.4 ("What to configure on the runtime") sits textually inside section 1, the section docs/decisions.md (2026-08-29) scopes out as "not treated as binding" -- yet ADR-0021 cites section 1.4 in its References and folds its content (hook primitives, the halt point) into the still-binding gate-surface shape. Section 1.4's own content is Claude-Code-native and AGT-independent ("These are Claude Code primitives, not AGT. Set them; do not build them.", REQUIREMENTS.md:209), so this is a defensible reading, not a clear citation error -- but the decisions.md row's blanket "section 1's reuse ledger... is not treated as binding" phrasing does not explicitly carve out section 1.4, leaving room for a stricter future reader to contest it. Recommend a one-line addendum (to docs/decisions.md or a footnote in ADR-0021) stating section 1.4 survives the section-1 scope-out because its content does not depend on the AGT/predecessor tie-break rule. Caps at LOW/derived -- does not block, feeds the architect's queue.

[CLEAN][code-traced] -- ADR-0021 self-discloses, rather than hides, that REQUIREMENTS.md's own POL-03 acceptance text still literally names an AGT artifact (SurfaceParityChecker) now stale under this ADR, and states plainly that correcting section 1/3 acceptance text is a later story's job, not this ADR's (Consequences/Negative, adr/software-engineering/0021-thoth-native-architecture.md:156). This is the rule-13 "never skip a gate silently" behavior working as intended.

## NOT-COVERED / AMBIGUOUS -- architect's work queue

1. Kernel's consumption rule for the Action record's deferred field against SUR-09 (P0) -- not stated in shape 1 or the Rules-for-agents list. Feeds S2.
2. Interim catalog representation of a pending supersession (ADR-0017 shows as unqualified accepted with no forward pointer during ADR-0021's proposal window) -- a process/tooling gap, not an ADR-0021 defect. Feeds a docs/adr-cache.mjs enhancement or a lightweight ADR-0017 status annotation.
3. Whether REQUIREMENTS.md section 1.4 specifically survives the section-1 scope-out (defensible as read, but not explicitly carved out in docs/decisions.md's scope-out row). Feeds a one-line decisions.md addendum.

## Editorial

None beyond what is already captured as findings above -- the document's citations were checked against REQUIREMENTS.md line-by-line and matched cleanly except where noted (finding 1).

## Overall verdict: APPROVE-WITH-CONDITIONS

The six shapes are soundly grounded in REQUIREMENTS.md, internally consistent with each other (kernel purity, declarative environment data as a world fact, registry-based normalizer extension, single-engine gate parity), and give S2 onward a fixed, evolvable contract per PRINCIPLES.md rule 17's calibration for this stage. The supersession of ADR-0017 follows this repo's own established propose-then-accept convention and correctly limits itself to the one ADR whose content is actually being replaced.

Conditions (pre-acceptance, both cheap, both text-only, no redesign):
1. Reword the Action-record "Rules for agents" MUST line (0021...md:133) to match the Decision section's own, more careful "no kernel-branching field outside these seven" framing, rather than an unqualified "exactly the fields."
2. Close the interim catalog-ambiguity gap for ADR-0017 -- either a forward-pointer annotation on ADR-0017 or a supersedes/supersededBy field surfaced by docs/adr-cache.mjs -- before this ADR is accepted, so a catalog-only read during any future proposal window does not repeat this gap.

Neither condition blocks S1's Phase 2 build from proceeding on the shape as designed; both should land before a human accepts ADR-0021, and are cheap enough to fold into the same acceptance commit.

## Evidence log (commands run)

Command: node docs/adr-cache.mjs --ensure
Output: ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- approx 17300 tokens saved this pass (fp 6c22c70) [CACHE=HIT]

Command: grep -n "supersed" docs/adr-cache.mjs
Output: (no output -- zero matches)

Command: node -e (print docs/.maat-state.json adrCatalog entry for ADR-0017)
Output:
  id: ADR-0017, status: accepted
  path: adr/software-engineering/0017-wrap-architecture-thoth-owns-the-verdict.md
  applicableTo: [architecture, integration, security]
  rules include: "The decision interface, the canonical Action record, the environment/assurance model, and fail-closed-on-ambiguity are implemented natively in thoth and never delegated to AGT." and "AGT is reached only through five named interfaces: policy evaluation, audit sink, credential vault, facet extraction, integrity manifest."
  (no supersededBy field present)

Command: cd adr && git log --oneline -5
Output:
  3b0bff5 Propose ADR-0021: thoth-native architecture (supersedes ADR-0017)
  c45f646 Accept ADR-0020: correct M1.5's compensating control and guard.mjs fidelity method; supersede ADR-0018
  5ce3c40 Accept ADR-0019 + ADR-0018: reference-port fidelity/self-protection (generic + thoth instance)
  2d43c45 Accept ADR-0017: wrap architecture -- thoth owns the verdict
  26353b1 Accept ADR-0016: governance-plugin tree porting and self-protection

Command: gh label list --limit 50
Output: confirmed bug, severity:high, severity:med, chore labels exist in mohannadrabie/thoth

Command: gh issue list --search "ADR-0021"
Output: zero results, no duplicate

No code exists yet in this repo (src/, scripts/, .github/ all absent) -- this is a document-only review. checks=n/a is correct per PRINCIPLES.md rule 19; no finding above is marked as forcing a unilateral block, consistent with that.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][code-traced] Action-record "exactly the fields" MUST (0021:133) overconstrains REQUIREMENTS.md:428's "Minimum fields" and contradicts the ADR's own Decision-section wording (0021:86) -- fix before acceptance.
2. [SUSPICION][MED][code-traced] ADR-0017 catalog entry shows unqualified accepted with its five AGT-wrap rules and no supersedes/supersededBy pointer; adr-cache.mjs has zero supersession-propagation logic (grep confirmed) -- a catalog-only reader during the proposal window cannot tell ADR-0021 is pending.
3. [CLEAN][code-traced] Kernel purity (shape 1) matches POL-11 and SE ADR-0002's domain-purity precedent exactly.
4. [CLEAN][code-traced] Canonical Action record field list (shape 2) matches REQUIREMENTS.md:428 exactly, same 7 fields, same order, same shapes.
5. [CLEAN][code-traced] Normalizer/extractor registry (shape 3) matches POL-12 and section 3.2's layer boundary exactly.
6. [CLEAN][code-traced] Gate surfaces / UserPromptSubmit halt point (shape 4) matches CTN-01/CTN-04/gap-G5 verbatim.
7. [CLEAN][code-traced] Evidence trail (shape 5) correctly threads still-binding INT-05/REL-02 through a now-scoped-out section-1.1 citation without inventing anything; unlock economy matches EVD-01/03/08/17.
8. [SUSPICION][LOW][derived] Action record's deferred field has no stated kernel-consumption rule against SUR-09 (P0) -- legitimately deferred detail per rule 17, feeds S2.
9. [CLEAN][code-traced] Environment/assurance model (shape 6) matches section 2.1/2.2 exactly; deferral to S11a/b/c is clean (declarative data, not kernel logic).
10. [CLEAN][code-traced] Supersession targets only ADR-0017 (content actually replaced), correctly leaves ADR-0016/0018/0019/0020 to the separate already-ratified scope-out decision -- reasoned, not arbitrary.
11. [SUSPICION][LOW][derived] REQUIREMENTS.md section 1.4 citation sits inside the scoped-out section 1 by section number though its content is AGT-independent -- defensible but not explicitly carved out in decisions.md.
12. [CLEAN][code-traced] ADR-0021 self-discloses POL-03's stale SurfaceParityChecker acceptance-text reference rather than hiding it.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=4 clean=7
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=0 code-traced=10 derived=2
checks=n/a (document-only review; no mechanism code exists yet in this repo)
adr=HIT(35)
report=docs/reviews/adr0021-thoth-native-architecture-2026-08-30.md
