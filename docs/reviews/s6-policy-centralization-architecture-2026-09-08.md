# S6 Phase 1 Plan — Architecture Review (pre-build)

**Scope:** `docs/plans/S6-phase1-2026-09-08.md` (Milestone #24, "Policy centralization"). CRITICAL tier. Reviewed BEFORE any code exists, per PRINCIPLES rule 15 — first out-of-repo policy-channel reader and first source-position-tracking config parser in this codebase, dispatched alongside/before `design-challenger`'s first pre-build round, per the explicit S4/S5 lesson this plan itself cites.
**Reviewer:** architecture-reviewer (Imhotep)
**Date:** 2026-09-08
**ADR cache:** CACHE HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, approx 17300 tokens saved this pass (fp 83b2e3e)

## What was read

`docs/plans/S6-phase1-2026-09-08.md` (full); `docs/PRINCIPLES.md` (full); `docs/decisions.md`'s 2026-09-08 rows (S6 intake NEEDS-INFO ruling, S6 Phase 1 plan ratification) plus the referenced 2026-09-01/2026-08-30/2026-09-07 rows they cite (T10 reopened, POL-09 narrowed, S5's council NOT-COVERED flag on in-repo fixtures); `docs/.maat-state.json`'s `adrCatalog` (all 35 ADR summaries, filtered to my domain - architecture/security/code/data/quality/reliability); `REQUIREMENTS.md` sections 0.3/0.4 (lines 55-98), 1.4 (lines 214-232, including the exact HKLM\SOFTWARE\Policies\ClaudeCode line), POL-07/08/09/10/11 acceptance text (lines 431-435), section 1.3 rows 2-3 (lines 205-212, AGT layering tie-break). Code-traced against every already-shipped artifact this plan builds on or must compose with: `src/policy/rule/precedence.ts` (full), `src/policy/kernel/rule-types.ts` (full), `src/policy/rule/schema.ts` (full), `src/qa/kernel-purity-check.ts` (full, confirms KERNEL_ROOT = "src/policy/kernel"), `src/policy/config/bootstrap-ruleset.ts` (full), `src/policy/tools/mcp-enumeration.ts` and `src/policy/tools/central-classification.ts` (full - S5's DI/fixture-injection precedent), `.claude/settings.json` (confirmed PreToolUse still unwired, "activation deferred" state intact). Ran a grep across `src/`/`docs/` to confirm `mergeLayers`'s real call sites (only `precedence.test.ts`, `kernel.test.ts`, `normalizer/registry.test.ts` - no production caller today); confirmed via find/grep that no `src/policy/config/central-source.ts`, `loader.ts`, `pin.ts`, `printer.ts`, `position-parser.ts`, or `mergeLayersWithMandatoryLock` exists anywhere in the tree - this is a pure plan-vs-ADR-vs-shipped-code review, nothing was run.

## Verdict table

| Axis | Verdict | Basis |
|---|---|---|
| 1. Fit | CONFORMS | Scope matches the 2026-09-08 ratified intake exactly (mechanism only: real 3-tier loader, POL-07 lock, POL-09 pinning-half, POL-10 printer; content authoring explicitly deferred); walking-skeleton build task #1 correctly satisfies rule 17; rule 18 correctly n/a'd (no numeric design constraint) |
| 2. Blast radius & coupling | APPROVE-WITH-CONDITIONS | Zero live coupling today (hook rewiring explicitly ruled out, `.claude/settings.json` confirmed unchanged) - but 3 MED findings on what the next story (hook-wiring, second-platform channel) inherits if these gaps aren't named now |
| 3. Compliance | CONFORMS (all applicable ADRs), 3 NOT-COVERED items feeding the architect's queue | See per-ADR table and findings below |
| 4. Cost shape | CONFORMS, one forward-looking flag | Fail-closed-on-malformed-central is an intentional, disclosed, unbounded-blast-radius trade-off (correct for this system's ethos); the not-yet-live subprocess-read cost is unaddressed for the story that eventually wires this in |
| 5. Operability | CONFORMS | Pure addition, deployable/revertible in one commit, POL-10 printer gives real observability, fails loud (not silently) on malformed central input |

## ADR compliance table (my domain slice: architecture / security / code / data / quality / reliability)

| ADR | Verdict | Note |
|---|---|---|
| SE ADR-0021 (kernel purity, POL-11) | CONFORMS | `src/policy/config/**` confirmed outside `KERNEL_ROOT` (`src/qa/kernel-purity-check.ts:210`, code-traced) - same boundary `bootstrap-ruleset.ts`/`precedence.ts`/`schema.ts` already establish. `mandatory?: boolean` lands in `rule-types.ts` as pure data, no I/O - verified it can't trip the forbidden-import/forbidden-global scan (code-traced, `kernel-purity-check.ts:53-76`) |
| SE ADR-0021 (normalizer registration "by declaration" spirit) | NOT TRIGGERED | No new normalizer this story; correctly noted as such in the plan's own ADR Review |
| SE ADR-0021 (no third-party governance-decision dependency without a recorded decision) | CONFORMS | Not touched; nothing in this plan reaches for AGT or an equivalent |
| SE ADR-0002 (DI ports, no SDK leak across layers) | CONFORMS | `CentralPolicySource` interface + production `reg query` reader vs. test fixture reader is exactly this rule's shape, and matches this codebase's own established pattern (see finding 10 below) |
| SE ADR-0003 (inject I/O deps, no speculative interfaces) | CONFORMS | Injectable reader achieves ubuntu-latest CI testability (no HKLM there) without a speculative abstraction - one real implementation (Windows registry) plus one test double, not built ahead of need |
| SE ADR-0006 (blast radius control, no opportunistic scope-widening) | CONFORMS | Q2's ruling (hook NOT rewired) is the literal application of this rule; subprocess bounded-timeout + output-size cap correctly flagged for `app-security-reviewer` |
| SE ADR-0010 (new dependency justification) | CONFORMS (by not needing an exception) | Hand-rolled minimal position-tracking tokenizer avoids a new dependency; reasonable, bounded scope for a well-understood problem |
| Devops ADR-0002-0010 | NOT-APPLICABLE | No AWS IaC in this repo; correctly excluded by the plan's own ADR Review |
| SE ADR-0004/0011-0015 (idempotency, data/DB) | NOT-APPLICABLE | Read path, no external side effect, no database - correctly excluded |

## Findings, ranked by blast radius

### 1. [SUSPICION][MED][derived] mergeLayersWithMandatoryLock's composition with mergeLayersById is asserted, not specified - real drift risk once mergeLayers goes production-dead

The ratified decision (`docs/decisions.md`, 2026-09-08 plan-ratification row) says the general form is built "via the shared `mergeLayersById` core," and the plan itself (Section 8) says `mergeLayers` stays "untouched - same 'extend, don't rewrite' convention S3 already set." But S3's precedent (`mergeToolClassificationLayers`) is a different domain object (`ToolClassificationSet`, two-tier, override semantics) reusing the shared core for a capability `mergeLayers` never had. This case is materially different: `mergeLayersWithMandatoryLock` and `mergeLayers` will both operate on the same `RuleSet`/`Rule.id` domain, both nominally implementing POL-08's precedence rule, with only the mandatory-collision behavior differing. Confirmed via grep: mergeLayers has zero production callers today (`src/policy/rule/precedence.test.ts`, `src/policy/kernel/kernel.test.ts`, `src/policy/normalizer/registry.test.ts` are its only call sites) - it exists purely as a tested-but-unwired POL-08 reference implementation. Once `loader.ts` calls `mergeLayersWithMandatoryLock` as the real, live POL-08 merge, `mergeLayers` becomes permanently production-dead code kept alive only by its own tests and two unrelated test fixtures. Two functions satisfying the same requirement ID, one live and one dead, is exactly the "two divergent merge code paths drifting apart" risk this review was asked to judge - a future fix to POL-08's ordering/version-resolution semantics applied to one has no structural guarantee of reaching the other.

Recommendation: the build task should implement `mergeLayersWithMandatoryLock` as a literal call to `mergeLayersById` (or a shared validation-then-merge composition) plus a pre/post pass rejecting any id collision against a `mandatory: true` entry from an earlier layer - never a hand-rolled second iterate-layers-track-winner loop. If this composition is followed, the drift risk closes structurally; if a second loop is written instead, it reopens.
Exposure: 0% today (nothing live calls either function). Basis: code-traced grep confirming mergeLayers has no production caller, plus derived reasoning about which function becomes the real POL-08 path after this story ships.

### 2. [SUSPICION][MED][derived] Unsupported-platform behavior for CentralPolicySource's production reader is unspecified - "absent" and "not supported here" risk silent conflation

The plan's fail-closed distinction (Section 6) is precise for one axis: central-absent (fail-open, zero rules) vs. central-present-but-malformed (fail-closed, refuse to merge). It does not name a third state this design will encounter the moment a second platform exists: central genuinely deployed, on a channel this build's reader doesn't know how to read (e.g., a macOS admin populates the plist channel REQUIREMENTS.md 1.4 also names, before a macOS reader ships). If the production default silently treats "not win32" the same as "checked the registry, key not found," a session on an unsupported platform gets the exact same "central layer contributes zero rules" outcome as a genuinely ungoverned dev machine - with no signal that the two cases differ. This is the same class of gap architecture-reviewer's S5 council seat named for in-repo fixtures (`docs/decisions.md`'s 2026-09-07 row): a structural way for the "session cannot write it" guarantee to degrade without anyone noticing it happened.

Recommendation: the `CentralPolicySource` contract should distinguish "checked this platform's channel, confirmed absent" from "this build has no reader for the current platform" - even if S6 only ships the Windows reader, the interface/behavior should make the second case loud (a warning, a distinct halt-state-style signal) rather than silently degrading to the first.
Exposure: 0% today (single-platform story, this session's runtime is win32). Basis: derived from REQUIREMENTS.md's own multi-channel framing (section 1.4) and the plan's own file list, which names only a Windows reader with no stated behavior for any other process.platform.

### 3. [SUSPICION][MED][derived] The eventual hook-wiring story inherits an unaddressed subprocess-latency cost this project already paid to discover once

S5's own T11/council saga (`docs/decisions.md`, 2026-09-06 row) measured a real 148-175ms process-spawn floor for a subprocess call this codebase makes from a live hook - an order of magnitude above the sub-5ms figure that story's design initially assumed, forcing a split-budget redesign. S6's `loadEffectivePolicy()` shells out via `reg query` on every call by design (Section 6). This story correctly does not wire that into a live hook (Q2's ruling), so there is no live cost today. But the plan is silent on whether the eventual hook-wiring story should cache the central-source read (e.g., once per SessionStart, via the same `.thoth/halt-state/` file-cache pattern this codebase already shipped and that `hooks/sessionstart-tool-enum.mjs`/`central-classification.ts` already use for exactly this kind of "compute once, read cheaply per PreToolUse call" problem) or re-shell on every governed action. Leaving this unnamed risks the next story re-deriving the T11 lesson from a blank page instead of reusing a pattern this repo already has in hand.

Recommendation: name this explicitly as a NOT-COVERED item for the hook-rewiring story's own intake - point at the `.thoth/halt-state/` SessionStart-cache pattern as the natural reuse target before that story invents its own timeout/caching design from scratch.
Exposure: 0% today (not wired live). Basis: derived from S5's own measured precedent (`docs/decisions.md` 2026-09-06 row) plus this plan's own described reg-query-per-load shape.

### 4. [SUSPICION][LOW][derived] CentralPolicySource interface shape not specified in the plan text

The plan names the interface's existence (Sections 0/1/6/8) but never its method signature or return shape. For the evolution path this plan explicitly invites scrutiny on (a second platform's reader being additive, not a rewrite), the shape matters: a return type built around reg-query's specific invocation (e.g. a raw stdout string plus an implicit "ran the command" contract) couples callers to Windows-specific mechanics; a channel-agnostic shape (e.g. present flag plus raw text plus a channel descriptor) lets a macOS plist or admin-console-file reader plug in as a second implementation with zero interface change. This mirrors the same reasoning the plan itself already applies one layer up - choosing a thoth-owned sibling key instead of misusing the ClaudeCode key's reserved namespace is exactly this principle (don't couple to one channel's specifics) applied to the registry key; it should also govern the interface the loader depends on.
Recommendation: name the interface's return shape explicitly before Phase 2 build, channel-agnostic by construction.
Exposure: 0%, design-quality recommendation only. Basis: derived - the plan states the interface exists but not its shape.

### 5. [SUSPICION][LOW][derived] Admin-provisioning story for the new Thoth registry key is unscoped

The plan builds the reader; nothing in S6's scope or elsewhere names how an administrator actually provisions this new, thoth-owned key in practice (a GPO ADMX template, a documented manual reg-add runbook, an installer). This is legitimately out of a mechanism-only story's scope, but it is exactly the kind of gap that fell through between stories once already this session (S5's KNOWN_CONNECTORS residual, S6's own NOT-COVERED-in-repo-fixture flag) - naming it now costs one sentence and prevents it from being silently assumed solved.
Recommendation: add a line to docs/backlog.md naming admin provisioning tooling/runbook for the new central-policy registry key as an explicit open item, owner TBD (likely the fast-follow content-authoring story or a dedicated ops story).
Exposure: 0%, process-hygiene only. Basis: derived - absence of any mention in the plan or docs/backlog.md (checked).

### 6. [SUSPICION][LOW][derived] General-form mandatory-lock ships with only the central-to-project path tested - already human-ruled, flagging only for the backlog

The 2026-09-08 plan-ratification row explicitly rules this shape (build the general any-layer-locks-later-layers form, but S6's own tests exercise only the literal central-to-project case) - not open for re-litigation here. But Rule.mandatory is a field on the shared Rule type, reachable by any layer including shipped-defaults; the shipped-defaults-to-central and shipped-defaults-to-project lock paths are real, reachable, untested code once this ships. This is worth a named backlog line now (before the fast-follow content-authoring story starts setting mandatory true on shipped-defaults rules and silently relying on paths nothing has exercised) rather than discovered later as a gap.
Recommendation: docs/backlog.md line naming the untested lock paths, owner equals the content-authoring fast-follow story or a dedicated hardening pass.
Exposure: 0% today. Basis: derived from rule-types.ts's shared Rule shape (code-traced) plus the ratified decision's own scope statement.

### 7. [CLEAN][code-traced] Kernel purity boundary placement verified against the real scanner, not just convention

src/qa/kernel-purity-check.ts:210 (KERNEL_ROOT = "src/policy/kernel") is the actual, structural enforcement mechanism ADR-0021's Rules for agents require ("enforced by a lint rule or structural test, not by convention alone"). src/policy/config/** is confirmed outside this scanned root - the plan's placement of central-source.ts, position-parser.ts, loader.ts, pin.ts, printer.ts there is verified CONFORMS against the mechanism that actually gates it, not merely against the plan's own self-description.

### 8. [CLEAN][code-traced] mandatory optional boolean addition to rule-types.ts cannot trip the purity scanner

Verified against kernel-purity-check.ts's two real checks (import-resolution scan, forbidden-global regex scan, lines 53-165): a passive optional boolean field on an existing interface introduces neither a new import nor a forbidden global token. Consistent with the file's own documented role ("shared, pure vocabulary... zero runtime logic").

### 9. [CLEAN][code-traced] schema.ts's fixed RULE_KEYS allowlist correctly identified as needing an edit

src/policy/rule/schema.ts:12 (RULE_KEYS is the fixed tuple id, effect, verbs, targets, environments, rationale) is a closed allowlist - any key not in this list is reported as an "unknown key" error (lines 37-45). The plan's edited-files list correctly names schema.ts for the mandatory key; without this edit, POL-07's own mechanism would reject every mandatory-marked rule as malformed. Verified this is a real, necessary edit, not an omission.

### 10. [CLEAN][derived] DI and injectable-reader shape matches this codebase's own twice-established pattern

src/policy/tools/central-classification.ts (loadCentralClassificationFixture with a default fixture-path parameter, a pure parse function separated from the readFileSync wrapper) and src/policy/tools/mcp-enumeration.ts (pure extraction functions, all file I/O left to the calling hook) are the same shape this plan proposes for CentralPolicySource: an injectable reader, a pure-parse and impure-I/O split, a default production implementation plus a test-injected fixture. This is not a novel pattern for this codebase even though the channel is novel - the DI mechanics that make it testable on ubuntu-latest CI are proven, not speculative.

### 11. [CLEAN][derived] Channel choice - council-seat judgment

The thoth-owned sibling key (a Thoth-named registry key under the same Policies subtree, sibling to the ClaudeCode key), rather than writing into the ClaudeCode key's own reserved namespace, is the architecturally sound call. Verified against REQUIREMENTS.md line 225's exact text (the only line in this repo's requirements that names a concrete Windows registry path for ClaudeCode's own managed policy) - the plan does not invent a path; it reuses the one already-accepted primary source names, then correctly declines to write thoth's own RuleSet JSON into a key Claude Code's own client may validate against a known schema. Same protection primitive (same Policies subtree, same admin-write-only default ACL), no semantic collision risk, and the reasoning generalizes cleanly: a future macOS reader would by the same logic use a thoth-owned plist domain, never the ClaudeCode bundle identifier. The write-ACL claim is disclosed exactly as strongly as it was actually verified (vendor-doc-cited plus documented Windows defaults, not a personally-run write-denial test) - no overclaiming found. This is the correct shape of the "don't invent a channel" discipline the 2026-09-08 intake ruling asked for, applied one level deeper (don't invent a value inside an existing channel either).

### 12. [CLEAN][derived] Rules 17 and 18 correctly satisfied

Build task #1 (one real fixture rule at each of the three tiers, resolved end-to-end through the real position-tracking parser, printed with correct origin and line, before generalizing mandatory-lock/pin logic) is a genuine walking skeleton, not narrative - satisfies PRINCIPLES rule 17 for a CRITICAL/novel-shape story. Rule 18 (numbers measured before they shape anything) is correctly marked not-applicable: no timeout, capacity, or batch-size figure this design leans on (the subprocess-timeout figure, when it eventually matters for a live-wired hook, is finding 3's concern, not this story's).

### 13. [CLEAN][derived] No opportunistic scope-widening

Q2's ruling (hooks/pretooluse-kernel-gate.mjs not rewired) is the direct, correctly-applied instance of SE ADR-0006's "MUST NOT widen a change's scope opportunistically" - explicitly named as the reason in the plan's own Sections 4 and 6, not discovered as a gap by this review.

## Editorial (non-blocking, no re-review needed)

None found - the plan's prose is internally consistent with docs/decisions.md's corresponding rows on every point checked.

## NOT-COVERED / AMBIGUOUS list (architect's work queue)

1. mergeLayersWithMandatoryLock's composition with mergeLayersById (finding 1) - not decided; recommend as explicit build-task guidance before Phase 2.
2. Unsupported-platform CentralPolicySource behavior (finding 2) - not decided; recommend the interface distinguish "confirmed absent" from "unsupported platform" before Phase 2.
3. Hook-wiring story's subprocess-read caching (finding 3) - not decided; recommend a docs/backlog.md line pointing at the halt-state reuse target.
4. CentralPolicySource interface return shape (finding 4) - not decided; recommend a channel-agnostic shape named before Phase 2.
5. Admin-provisioning runbook/tooling for the new registry key (finding 5) - not decided; recommend a docs/backlog.md line.
6. General-form mandatory-lock's untested shipped-defaults-origin paths (finding 6) - already human-ruled scope; recommend a docs/backlog.md line only.

## Findings vs. failing tests

Pre-build plan review - no S6 code exists yet (confirmed: find src/policy/config shows only S5-shipped bootstrap-ruleset.ts and its test file; a grep for CentralPolicySource, mergeLayersWithMandatoryLock, central-source, and position-parser across src/ returns zero matches). None of the 6 SUSPICION findings above have an executable form today - there is nothing built to run that would demonstrate or refute them. Per this project's established convention for exactly this situation (S4's design-challenger pre-build pass; S5's own pre-build architecture-reviewer round, docs/reviews/s5-deny-by-default-hook-wiring-architecture-2026-09-06.md), the correct disposition is: findings 1-5 become explicit build-task guidance/acceptance criteria before Phase 2 build begins (each maps to a concrete test story-implementer can write and watch go red then green); finding 6 is a backlog line only, not a build-blocking criterion, since it names an already-ratified scope decision, not an open gap. Open findings: 6. Failing tests: 0 (none executable pre-build) - the gap is explained above, not silently left as a mismatch.

## Verdict

APPROVE-WITH-CONDITIONS. No HIGH, no code-traced or demonstrated defect against any shipped module or against any applicable ADR's binding rules. Every SUSPICION finding is a derived, forward-looking design recommendation, capped at MED per this project's evidence policy (checks=n/a, nothing built yet - no blocking HIGH is possible here per PRINCIPLES rule 17), and none blocks Phase 2 build starting. Findings 1-5 should be folded into the plan as explicit acceptance criteria before build (same discipline design-challenger's S4 pre-build pass and my own S5 pre-build pass already established as this project's convention for exactly this situation); finding 6 is a backlog line only. The channel choice itself (Section 3 of the plan) is architecturally sound and well-disclosed - my strongest scrutiny there (findings 2, 4, 5) is about the interface and provisioning story around the choice, not the choice itself.

## Single next action

story-implementer amends the S6 Phase 1 plan (or the Manager ratifies the amendment inline, same shape as the 2026-09-02 S4 precedent) to add: (a) mergeLayersWithMandatoryLock is explicitly specified as composing mergeLayersById plus a validation pass, not a second hand-rolled loop; (b) CentralPolicySource's behavior on a non-win32 platform is named (distinguishing "confirmed absent" from "unsupported here"); (c) the interface's return shape is named, channel-agnostic; (d) two docs/backlog.md lines added (hook-wiring subprocess-cache reuse target; admin-provisioning runbook) - then proceed to Phase 2 build alongside/after design-challenger's first pre-build round.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius - status [ISSUE]=VIOLATES / [SUSPICION]=NOT-COVERED or AMBIGUOUS / [CLEAN]=CONFORMS; prefix every [ISSUE]/[SUSPICION] with severity [HIGH|MED|LOW]; tagged with evidence [demonstrated|code-traced|derived]):
1. [SUSPICION][MED][derived] mergeLayersWithMandatoryLock's composition with the shared mergeLayersById core is asserted but unspecified - mergeLayers has zero production callers today (grep-confirmed), becomes permanently production-dead once this story's loader wires the mandatory-lock version live; unspecified composition risks two divergent POL-08 merge paths drifting apart
2. [SUSPICION][MED][derived] CentralPolicySource's behavior on a non-win32 platform is unspecified - risks silently conflating "channel confirmed absent" with "channel unsupported on this platform", weakening the session-cannot-write-it guarantee the moment a second platform exists with no signal it happened
3. [SUSPICION][MED][derived] Eventual hook-wiring story inherits an unaddressed subprocess-latency cost (S5's own measured 148-175ms reg-query-class T11 lesson) with no mention of reusing the already-shipped halt-state SessionStart-cache pattern
4. [SUSPICION][LOW][derived] CentralPolicySource interface return shape not named in plan text - recommend channel-agnostic shape so a second-platform reader is additive, not a rewrite
5. [SUSPICION][LOW][derived] Admin-provisioning runbook/tooling for the new central-policy registry key is unscoped anywhere - recommend a backlog line
6. [SUSPICION][LOW][derived] General-form mandatory-lock ships with only central-to-project tested (already human-ruled scope); shipped-defaults-origin lock paths are real, reachable, untested - recommend a backlog line only
7. [CLEAN][code-traced] Kernel purity boundary placement verified against kernel-purity-check.ts's real KERNEL_ROOT scan (src/policy/kernel only) - src/policy/config/** confirmed outside it
8. [CLEAN][code-traced] mandatory optional-boolean field addition to rule-types.ts is pure data, no I/O - verified it cannot trip the purity scanner's import/global checks
9. [CLEAN][code-traced] schema.ts's fixed RULE_KEYS allowlist correctly identified in the plan's edited-files list as needing the mandatory-key edit - verified this edit is real and necessary, not an omission
10. [CLEAN][derived] DI/injectable-reader shape matches this codebase's own twice-established pattern (central-classification.ts, mcp-enumeration.ts) - achieves ubuntu-latest CI testability per SE ADR-0003, not a novel/speculative mechanism
11. [CLEAN][derived] Channel choice (thoth-owned sibling registry key vs. misusing ClaudeCode's reserved namespace) is architecturally sound, honestly disclosed, generalizes cleanly to a future macOS thoth-owned plist domain
12. [CLEAN][derived] Walking-skeleton build task #1 and rule-18 n/a correctly satisfy PRINCIPLES rules 17/18
13. [CLEAN][derived] No opportunistic scope-widening - hook-rewiring explicitly ruled out (Q2), matches SE ADR-0006
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=0 suspicions=6 clean=7
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=0 code-traced=3 derived=10
checks=n/a (pre-build plan review; no S6 code exists yet - confirmed via find/grep across src/policy/config and src/ for CentralPolicySource/mergeLayersWithMandatoryLock/central-source/position-parser, zero matches)
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-architecture-2026-09-08.md
