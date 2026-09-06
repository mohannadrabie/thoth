# S5 Phase 1 Plan - Architecture Review (pre-build)

**Scope:** docs/plans/S5-phase1-2026-09-06.md (Milestone #23, "Deny-by-default + hook wiring"). CRITICAL tier. Reviewed BEFORE any code exists, per PRINCIPLES rule 15, dispatched alongside design-challenger's pre-build pass.
**Reviewer:** architecture-reviewer (Imhotep)
**Date:** 2026-09-06
**ADR cache:** CACHE HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, approx 17300 tokens saved this pass (fp 83b2e3e)

## What was read

docs/plans/S5-phase1-2026-09-06.md (full), docs/STATE.md, docs/decisions.md (all rows, esp. the two 2026-09-06 S5 rows), adr/software-engineering/0021-thoth-native-architecture.md (full), adr/software-engineering/0003-solid-principles.md, adr/software-engineering/0006-blast-radius-control.md, plus code-traced against the actually-shipped S2/S3 artifacts: src/policy/kernel/kernel.ts, src/qa/kernel-purity-check.ts, src/policy/normalizer/registry.ts, src/policy/tools/classification.ts, src/policy/fixtures/tool-classification.ts, src/policy/rule/precedence.ts (grep), src/qa/runtime-settings-drift-check.ts, .claude/settings.json, package.json. No S5 code exists yet (hooks/ directory absent, confirmed) - this is a pure plan-vs-ADR-vs-shipped-code review; nothing was run.

## Verdict table

| Axis | Verdict | Basis |
|---|---|---|
| 1. Fit | CONFORMS | Scope bounded to Bash-only live wiring; explicit no-scope-creep list (section 4 of the plan); no gold-plating found |
| 2. Blast radius and coupling | APPROVE-WITH-CONDITIONS | No edit to any shipped S2/S3/S4 file (code-traced against the plan's own file lists vs. docs/STATE.md's shipped inventory); two named forward-compatibility gaps (findings 2, 3) could force rework of the sensitive hook file itself in S6/S11b if not closed now |
| 3. Compliance (ADR-0021) | Mostly CONFORMS, one AMBIGUOUS item (finding 1) | See per-finding detail below |
| 4. Cost shape | CONFORMS | 2 new CI-wired qa:* scripts, same shape/cost as existing qa:kernel-purity / qa:runtime-settings-drift; timeout is measured (T11 spike), not invented; no unbounded variable named |
| 5. Operability | CONFORMS, one disclosure gap (finding 5) | Additive/rollback-by-deletion; deployable in one file (.claude/settings.json); the new gate's own verdicts have no durable evidence trail yet (M4's job) - should be disclosed, not silently left implicit |

## Findings, ranked by blast radius

### 1. [SUSPICION][MED][derived] ADR-0021 section 3.2's tool_name to toolType mapping is asserted, not shown as fail-closed

The plan's "ADR Review" section states "the hook does the tool_name -> toolType mapping" (section 3.2) and names the live matcher scope as "Bash only" (decisions.md 2026-09-06 ratification row, point 2). But the plan's own build description for hooks/pretooluse-kernel-gate.mjs - "matcher Bash only; stdin -> ShellCall -> normalize -> decide" - never states that the hook itself checks the incoming tool_name and denies on anything unexpected. As written, the Bash-only boundary lives entirely in .claude/settings.json's matcher string; nothing in the hook's own described logic re-asserts it.

This matters because it is exactly the seam a future story (filesystem normalizer, S11b Task-tool wiring) will touch: if .claude/settings.json's matcher is later widened (e.g. to "Bash|Edit") without a corresponding update to the hook's internal dispatch, a call for a different tool would silently be normalized as a shell command rather than failing closed. SUR-02's own "terminal fall-through is deny" principle (already correctly implemented one layer down, in src/policy/normalizer/registry.ts:61-74, code-traced) should be mirrored one layer up, in the hook itself, not left to depend on .claude/settings.json and the hook always being edited in lockstep.

Recommendation (condition): add an explicit acceptance criterion - the hook reads tool_name from stdin JSON, and any value other than the one(s) it is built to handle produces a deny (not a crash, not a silent shell-normalize) - before Phase 2 build. Cheap: one conditional and one test case.
Exposure: 0% today (no live hook exists); this is a forward-compatibility gate, not a live gap. Basis: code-traced against the plan's own description plus the registry's existing fail-closed pattern.

### 2. [SUSPICION][MED][derived] Halt-state file schema/collision behavior is unspecified - the "reusable primitive" claim is asserted, not demonstrated

The plan claims hooks/userpromptsubmit-halt-relay.mjs is "built as a reusable halt-relay primitive... since S11b will plug a second halt reason into the same relay later." As described (sessionstart-tool-enum.mjs "writes a gitignored, session_id-correlated halt-state file"; the relay "reads halt-state for current session_id; exit 2... if set, else 0"), this is genuinely minimal - a session-keyed boolean/file-existence gate, not a speculative interface. That minimalism is exactly why the reuse claim is plausible (see finding 9, CLEAN). But the plan never states the file's actual shape, and one shape choice breaks the reuse claim outright: if the file holds a single flag (last-write-wins), a second writer (S11b's future halt reason) sharing the same file for the same session_id would either clobber a still-active SUR-03 halt, or have its own halt silently overwritten - a silent, session-halting mechanism quietly losing a halt is a serious failure mode precisely because it fails open, invisibly.

Recommendation (condition): before Phase 2 build, the plan should name the halt-state file's shape explicitly - at minimum, that it can hold more than one independently-set/independently-cleared reason (e.g., a small JSON object keyed by reason, or one file per reason under a shared directory) - so "S11b plugs in a second halt reason" is additive by construction, not an assumption resting on an unspecified format.
Exposure: 0% today (S11b doesn't exist yet); this is exactly the kind of premise PRINCIPLES rule 18 asks not to guess past. Basis: derived - plan text names the reuse intent but not the mechanism that would make it true.

### 3. [SUSPICION][MED][derived] bootstrap-ruleset.ts's call-site shape is unspecified - affects how much of the CRITICAL-tier hook S6 will need to touch

The plan describes src/policy/config/bootstrap-ruleset.ts as "a minimal RuleSet (defaultOutcome: deny)" with a disclosure header. If the hook imports this as a bare constant and passes it straight into decide({rules: bootstrapRuleSet, ...}, action) (mirroring kernel.ts's already-shipped WorldFacts.rules: RuleSet shape, code-traced at src/policy/kernel/kernel.ts:148-157), then S6's job - swapping in real policy-config loading - has two possible shapes: (a) bootstrap-ruleset.ts grows a loadRuleSet(): RuleSet function whose internals change but whose call site in the hook does not, or (b) the hook's own import/call site changes to reach a new loader module directly. Shape (a) confines S6's diff to a file outside the sensitive-area hook; shape (b) means S6 re-opens hooks/pretooluse-kernel-gate.mjs itself - a CRITICAL-tier, always-full-ceremony file - for what is otherwise a config-plumbing change.

Recommendation (condition): name shape (a) in the plan now - export a function, not a bare constant, from bootstrap-ruleset.ts, even though today it trivially returns the hardcoded object - so S6 lands as a lower-blast-radius change against an already-reviewed non-sensitive file.
Exposure: 0% today; affects S6's blast radius, not S5's. Basis: derived from the shipped decide() signature's existing shape.

### 4. [SUSPICION][LOW][derived] src/policy/kernel/subagent-non-escalation.test.ts placement questionable

The plan places SUR-14's fixture-only test (a delegated/child session's tool grant is never a superset of its parent's) inside src/policy/kernel/ - the same directory as kernel.ts's own decide()/isMutating()/matchRules() tests. checkKernelPurity explicitly excludes *.test.ts from its scan (code-traced, src/qa/kernel-purity-check.ts:175, with the exclusion rationale documented in that file's own header comment), so this does not trip the purity gate. But what SUR-14 actually fixtures - a parent-vs-child tool-grant comparison - is a session/hook-level property, not something decide() itself computes today (the kernel decides one ActionRecord at a time; it has no concept of "parent session" vs "child session"). Filing this test under kernel/ risks implying the kernel owns a check it does not yet perform, and could mislead a future reader of that directory about what decide()'s actual contract is.
Recommendation: consider a home under src/policy/tools/ (alongside classification.ts) or a new src/policy/session/ - not blocking, a naming/placement gut-check before the file is written.
Exposure: 0%, cosmetic/organizational. Basis: derived from directory-convention inspection.

### 5. [SUSPICION][MED][derived] The new live gate's own verdicts have no stated evidence-trail path - worth disclosing, not silently leaving implicit

hooks/report-subject-gate.mjs (the existing, already-shipped sensitive-area hook) writes every verdict into hooks/audit-log.mjs's hash-chained log (code-traced, .claude/settings.json's own header comment describes this). The S5 plan's new hooks/pretooluse-kernel-gate.mjs - the first hook in this codebase that can actually deny a real tool call - does not mention writing to that same trail, or any trail. Checked against REQUIREMENTS.md: EVD-01 through EVD-17 (the evidence/unlock trail) is explicitly M4's scope (REQUIREMENTS.md:671, confirmed via the milestone table), so building it now would be scope creep this project's own "no scope creep" hard rule would flag. This is therefore a legitimate, deferred gap, not a defect - but it is exactly the kind of gap this project's own convention (the bootstrap ruleset's section 0.4 disclosure, the existing hook's own residual-gap paragraph) discloses explicitly in the file header rather than leaving implicit. As written, the plan is silent on it.
Recommendation: the new hook's header comment should say plainly that its deny/allow verdicts are not yet durably recorded (M4's job), the same way the existing hook already discloses its own residual gaps - cheap, and keeps this project's "own it, don't oversell it" discipline (section 0.3) unbroken for the first hook that can produce a real, consequential deny with no record of having done so.
Exposure: 0% blocking (M4 legitimately owns this); a disclosure gap, not a mechanism gap. Basis: derived from the existing hook's own disclosed-header convention and REQUIREMENTS.md's milestone table.

### 6. [CLEAN][code-traced] Kernel purity (POL-11) held by the plan's file layout

None of the plan's new files (hooks/*.mjs, src/policy/config/bootstrap-ruleset.ts, src/policy/tools/builtin-tool-inventory.ts, the two new src/qa/* checks) sit inside src/policy/kernel/**, and the plan's own text states the hook imports the kernel, never the reverse. Verified against the actual scanner rules the plan will be graded against: src/qa/kernel-purity-check.ts:172-176 scans only production .ts under src/policy/kernel/ for out-of-directory or non-relative imports - none of the plan's new files touch that boundary.

### 7. [CLEAN][code-traced] Normalizer registry (POL-12) respected - the plan calls the registry, doesn't edit it

src/policy/normalizer/registry.ts:38-40's own header states registering a new normalizer "requires calling this function from a NEW file; it requires editing neither this file nor any prior normalizer's file." The plan's hook code calls normalize() (the existing dispatcher) and, for the tool-classification catalog, reuses the already-shipped two-tier mergeToolClassificationLayers extension point (src/policy/rule/precedence.ts, confirmed present via grep) rather than editing precedence.ts or classification.ts. builtin-tool-inventory.ts is a new, additional data source, not an edit to S3's shipped fixture (src/policy/fixtures/tool-classification.ts is absent from the plan's "Edited files" list) - consistent with the registry's declared extension contract.

### 8. [CLEAN][code-traced] Blast radius: no S2/S3/S4 shipped file is touched

Cross-checked the plan's "New files"/"Edited files" sections against docs/STATE.md's shipped-file inventory for S2 (kernel.ts, action-record.ts, rule-types.ts, verdict.ts, precedence.ts, schema.ts), S3 (registry.ts, action-catalog.ts, target-format.ts, shell.ts, structured-cluster.ts, classification.ts, allowlist.ts), and S4 (shell.ts, shell-scanner.ts, flag-catalog.ts, wrapper-catalog.ts). None appear in S5's edit list. The only edited file with any cross-story history is .claude/settings.json, and the plan explicitly preserves the existing report-subject-gate.mjs entry untouched, appending a new array entry rather than modifying the existing one.

### 9. [CLEAN][derived] Halt-relay generality is justified minimalism, not premature abstraction (SE ADR-0003)

SE ADR-0003 (SOLID) warns against "speculative interfaces with a single implementation and no test double... YAGNI applies." As described, userpromptsubmit-halt-relay.mjs builds no interface, no plugin registry, no configuration schema for future halt reasons - it is a single boolean/file-existence check keyed by session_id. That is close to the cheapest possible mechanism, not generality built ahead of need; its "reusability" is a byproduct of doing the minimal thing, not of speculative interface design. This verdict is contingent on finding 2 above (the file's shape needs to actually support more than one reason, or the claim doesn't hold) - but the approach itself does not read as gold-plating.

### 10. [SUSPICION][LOW][derived] ADR-0006 (blast-radius control) is only tangentially applicable

ADR-0006's rules are almost entirely infra/cloud-specific (feature flags, CDK stack separation, AZ isolation, network-call timeouts/circuit breakers) and do not map cleanly onto an in-process hook change. The one rule that does transfer - "MUST NOT widen a change's scope opportunistically" - is honored: the plan's section 4 names four explicit scope exclusions (filesystem normalizer, S6 config loading, S11a environment model, S11b Task-tool wiring). Flagged per this review's own instruction to include an ADR when domain applicability is arguable, even where it doesn't decide anything here.

## Editorial (non-blocking, no re-review needed)

- Plan text (New files, builtin-tool-inventory.ts) says this is "replacing the 3-entry fixture as the real shipped-defaults layer" - read literally this suggests editing src/policy/fixtures/tool-classification.ts (S3-shipped, already reviewed). The plan's own "Edited files" list does not include that fixture, so the intended meaning is almost certainly "a new, parallel production-data module, the test fixture stays untouched." Worth tightening the wording before Phase 2 so nobody reads this line as license to edit an already-reviewed S3 fixture.

## NOT-COVERED / AMBIGUOUS list (architect's work queue)

1. Hook-side fail-closed tool_name check (finding 1) - not decided anywhere; recommend as a new acceptance criterion before build.
2. Halt-state file schema (finding 2) - not decided; recommend naming the shape (multi-reason-capable) before build.
3. bootstrap-ruleset.ts export shape (finding 3) - not decided; recommend a function export, not a constant.
4. subagent-non-escalation.test.ts home directory (finding 4) - not decided; low stakes, implementer's call.
5. New hook's evidence-trail disclosure (finding 5) - not decided; recommend a header-comment disclosure, mirroring the existing hook's convention.

## Findings vs. failing tests

This is a pre-build plan review - no code exists yet (hooks/ directory confirmed absent). None of the 5 SUSPICION findings above have an executable form today; there is nothing to run that would demonstrate or refute them. Per this project's own established convention (S4's design-challenger pre-build pass, docs/decisions.md 2026-09-02 row), the correct disposition is: findings 1-3 and 5 become new, named acceptance criteria added to the plan before Phase 2 build (each maps to a concrete test test-writer/story-implementer can write and watch go red then green); finding 4 is a placement judgment call with no test attached. Open findings: 5. Failing tests: 0 (none executable pre-build) - the gap is explained above, not silently left as a mismatch.

## Verdict

APPROVE-WITH-CONDITIONS. No HIGH, no code-traced or demonstrated defect against any shipped module or against ADR-0021's binding rules. Every finding is a derived, forward-looking design recommendation, capped at MED per this project's evidence policy, and none blocks Phase 2 build starting - but findings 1-3 and 5 should be folded into the plan as explicit acceptance criteria before build, the same discipline design-challenger's S4 pre-build pass already established as this project's own convention for exactly this situation (BREAKS/UNPROVEN become criteria before code, not after).

## Single next action

story-implementer amends the S5 Phase 1 plan (or the Manager ratifies the amendment inline, same shape as the 2026-09-02 S4 design-challenger ruling) to add: (a) an explicit fail-closed tool_name check in pretooluse-kernel-gate.mjs's own acceptance criteria, (b) a named multi-reason-capable shape for the halt-state file, (c) a function (not constant) export from bootstrap-ruleset.ts, and (d) a disclosure sentence in the new hook's header about the deferred (M4) evidence trail - then proceed to Phase 2 build.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, ranked by blast radius):
1. [SUSPICION][MED][derived] ADR-0021 section 3.2 tool_name to toolType mapping asserted but not shown as a fail-closed mechanism in the hook itself - settings.json matcher alone is not a code-level guarantee
2. [SUSPICION][MED][derived] Halt-state file schema/collision behavior unspecified - "reusable halt-relay primitive" claim not yet demonstrable, a single-reason last-write-wins shape would silently break S11b's planned reuse
3. [SUSPICION][MED][derived] bootstrap-ruleset.ts call-site shape (constant vs. function) unspecified - affects whether S6's config-loading swap re-opens the CRITICAL-tier hook file itself
4. [SUSPICION][LOW][derived] subagent-non-escalation.test.ts proposed inside src/policy/kernel/ tests a session/hook-level property the kernel itself doesn't compute - placement gut-check, not a purity violation
5. [SUSPICION][MED][derived] New live-deny hook has no stated evidence-trail path (M4's job, legitimately deferred) but the plan doesn't disclose this the way the existing sensitive-area hook already discloses its own residual gaps
6. [CLEAN][code-traced] Kernel purity (POL-11) held - no new file imports into src/policy/kernel/**, verified against kernel-purity-check.ts's actual scan boundary
7. [CLEAN][code-traced] Normalizer registry (POL-12) respected - plan calls normalize()/mergeToolClassificationLayers, edits neither the registry nor precedence.ts
8. [CLEAN][code-traced] Blast radius: zero S2/S3/S4 shipped files appear in the plan's edit list; existing report-subject-gate.mjs hook entry left untouched
9. [CLEAN][derived] Halt-relay design is minimal-mechanism reuse, not premature abstraction - consistent with SE ADR-0003's YAGNI rule (contingent on finding 2)
10. [SUSPICION][LOW][derived] ADR-0006 (blast-radius control) only tangentially applicable (infra/cloud-specific); the one transferable rule (no opportunistic scope-widening) is honored by the plan's explicit exclusion list
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=0 suspicions=6 clean=4
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=0 code-traced=3 derived=7
checks=n/a (pre-build plan review; no code exists yet - hooks/ directory confirmed absent)
adr=HIT(35)
report=docs/reviews/s5-deny-by-default-hook-wiring-architecture-2026-09-06.md
