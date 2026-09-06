# S5 Phase 1 Plan (v2) - Architecture Council Seat

**Scope:** docs/plans/S5-phase1-2026-09-06.md (v2). Milestone #23, "Deny-by-default + hook wiring," CRITICAL tier.
**Trigger:** PRINCIPLES rule 16(b) - 2 consecutive no-go pre-build design-challenger rounds with no intervening clean/conditional-clean verdict, independently also rule 16's second counter (same root-cause CLASS recurring across both graded rounds). /maat:council convened; this is the architecture-reviewer seat, ruling on whether the design's SHAPE should exist, not re-litigating individual findings (design-challenger's job, already done - two rounds, both no-go).
**Reviewer:** architecture-reviewer (Imhotep)
**Date:** 2026-09-06
**ADR cache:** CACHE=HIT - reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, approx 17300 tokens saved this pass (fp 83b2e3e).

## What was read

docs/plans/S5-phase1-2026-09-06.md (v2, full); docs/reviews/s5-deny-by-default-hook-wiring-design-challenger-2026-09-06.md (round 1) and round2 (round 2), full; docs/reviews/s5-deny-by-default-hook-wiring-design-challenger-stopbrief-2026-09-06.md (council Stop Brief, full - candidate Paths A/B/C already priced there); my own two prior reports on this plan (docs/reviews/s5-deny-by-default-hook-wiring-architecture-2026-09-06.md, round 1 APPROVE-WITH-CONDITIONS + round 2 APPROVE); adr/software-engineering/0021-thoth-native-architecture.md (full, re-confirmed the closed four-primitive list at line 210); REQUIREMENTS.md - SUR-10/12, OPS-02/03, gaps G5/G6, T11's own open-decision row, and the "Known limits of the runtime" table (full text quoted below); docs/decisions.md's full S5 thread (all rows, including the 2026-09-06 intake-ruling row that first committed to "a safety-margined multiple of the measured p99" as T11's resolution - this council ruling revises that reading); .claude/settings.json (full, current, code-traced - specifically the existing report-subject-gate.mjs entry's timeout: 10 against its own disclosed real cost). GitHub Issues #86, #88, #89 (bodies + comment threads). No S5 code exists yet (hooks/ confirmed absent from master's entire history by both design-challenger rounds) - this is a design-shape ruling on a plan, not a code review; nothing new was run by this seat (the machine measurements below are quoted from design-challenger's own reports, not re-run here).

---

## The question this seat answers

Two design-challenger rounds each measured "the right thing" for T11's timeout spike and each got it wrong at a deeper layer: round 1 measured in-process function calls (expected sub-5ms) against a real subprocess floor of 148-175ms; round 2 fixed that by measuring the real subprocess but via Node's exec form (spawnSync with an args array, no shell) against the real shell form Claude Code actually uses for every bare-command-string hook entry - measured +30% p99 on a Git-Bash-equipped machine, +6.7x p99 on a PowerShell-fallback machine. Is this bad luck that a third, more careful round would fix, or is the derivation method itself - tie the enforcement timeout value directly to one measured invocation-latency figure with a margin multiplier - structurally unable to converge?

**Ruling: the pattern is structural, not luck.** Both rounds' fixes did exactly what they were supposed to: they closed the specific gap the prior round demonstrated. Both also opened an adjacent gap at the same root cause, because the method being repaired asks a single measured number to do two incompatible jobs at once: (1) be the hard ceiling the enforcement mechanism trusts before it fails open (G6: a PreToolUse timeout is a bypass, not a delay - this needs a wide margin against every layer of invocation cost, including ones nobody has measured yet), and (2) be the tight figure that keeps the gate feeling fast (the "fast feedback" value proposition SUR-12/OPS-03 protect - this needs precision). No single number serves both goals; every round that tightens the number toward goal (2) narrows the safety margin goal (1) needs, and the tail of "invocation-cost layers nobody has measured yet" (a Windows Defender scan of a freshly-written .mjs file, node_modules resolution on a cold OS file cache, CI-runner contention, a slower machine class than the one used to spike, corporate-proxy process-creation hooking) is long, platform-dependent, and not enumerable by running a spike once on one reviewer's own machine. A third round fixing the shell-form gap does not retire this risk - it only advances to whichever layer is next, exactly as design-challenger's own Stop Brief names as "the single scariest unproven assumption": "that there is one stable number to measure at all."

---

## REQUIREMENTS.md already specifies the two-number shape this plan collapsed into one

This is not a new requirement invented for this ruling - it is the acceptance text for SUR-12 and OPS-03, already accepted, already binding, quoted verbatim:

SUR-12 (REQUIREMENTS.md:468): "Gate entries shall declare an explicit timeout, and timeout behaviour shall be a recorded decision. A slow path must not become a bypass. On this runtime a timed-out gate IS a bypass... The declared timeout is therefore an upper bound the OPS-03 budget must sit far below, and a timeout occurrence is an incident under CI-10, not a routine event."

OPS-03 (REQUIREMENTS.md:585): "Each gate shall have a stated latency budget and meet it on the largest realistic input... The per-action budget is bounded above by the hook timeout, because exceeding it is a bypass rather than a delay."

Read together, these describe two distinct quantities in a "far below" relationship, not one number derived with a margin multiplier: (a) SUR-12's declared timeout - the config-level ceiling, meant to almost never fire, whose only job is bounding worst-case hang time before Claude Code gives up; and (b) OPS-03's own measured latency budget - the tight, regression-tested figure that protects the fast-feedback UX, whose overrun is explicitly named as "an incident under CI-10, not a routine event." A budget overrun that is meant to surface as a CI incident is, by construction, a number that is supposed to be tight and supposed to occasionally fail loudly in CI when it drifts - that is a completely different design contract than a number that, if wrong, silently bypasses every live Bash call in production.

The plan's T11 section 5 step 5 collapses these into one: "Declared timeout = safety-margined multiple of the measured SUBPROCESS p99." This is the same collapse the 2026-09-06 intake-ruling row in docs/decisions.md (row 38) committed to ("derives the declared budget as a safety-margined multiple of the measured p99") - a Manager ruling made under autonomous-continuation authorization, reasonable on its face, but a misreading of SUR-12/OPS-03's own text held up against each other: it treats "the declared budget" and "the measured p99" as the same axis, when the requirement's own words put a "far below" relationship between two different axes. This council ruling revises that reading, on the requirement's own text, not on new invention.

This is also not a new pattern for this codebase to adopt. .claude/settings.json line 101 (code-traced) already sets "timeout": 10 (10 seconds) on the existing report-subject-gate.mjs entry, against a real, disclosed invocation cost of "approximately 50 small synchronous reads" (.claude/settings.json line 68, the file's own header) - order of a few milliseconds. That is a greater-than-1000x margin, chosen once, in this exact repo, and never re-derived tightly across four prior CRITICAL-tier review cycles. Nobody has had to spike-and-reconverge that number. It is the working precedent for the shape this ruling recommends, already shipped in the file S5 is about to extend.

---

## Ruling on the shape

**REDESIGN-REQUIRED** for the plan's current T11 shape: deriving the .claude/settings.json timeout value directly as a safety-margined multiple of one measured invocation-latency figure. Two consecutive rounds have shown this method cannot be trusted to converge by getting better at measuring - the thing wrong with it is not the precision of the measurement, it is that the measurement is being asked to do a job (be simultaneously safe and tight) no single number can do, against a tail of possible invocation-cost layers that is not fully enumerable in advance.

**APPROVE** for the candidate path that sidesteps needing a precisely-measured tight number - a refinement of the council Stop Brief's own Path B ("adopt Claude Code's documented default timeout... instead of a tightly-derived number"), made concrete as a split-budget model:

1. timeout: (the config field in .claude/settings.json, SUR-12's "declared timeout") is set to a generous, fixed, disclosed value - comfortably clear of every measured invocation-cost figure either design-challenger round produced (worst demonstrated: 1051.2ms p99, PowerShell-fallback shell form) by one to two more orders of magnitude, and comfortably below Claude Code's own documented 600s ceiling so a genuinely wedged process is still caught in bounded time. A concrete number (e.g. 30s or 60s) is story-implementer's call with a one-line justification, recorded once in docs/decisions.md - not re-derived under review pressure every round, and not chased for further precision once it clears the safety bar.
2. OPS-03's own latency budget stays a separate, tightly-measured, CI-regression-tested figure, fed by exactly the subprocess+shell-form spike the plan's section 5 already specifies (round 2's fix to that spike genuinely is the right measurement methodology for this number - nothing about it needs to be redone). Its failure mode is a CI-10 incident (a red check, a human looks) - never a live security bypass - satisfying SUR-12's own text verbatim ("a timeout occurrence is an incident under CI-10, not a routine event" reads correctly once "timeout" here means the OPS-03 budget crossing, not the enforcement ceiling firing).
3. The regression test (the plan's own C7) is worded to assert the measured p99 stays under an absolute internal ceiling (OPS-03's own budget, e.g. on the order of 1-2 seconds - a number story-implementer sets from the actual measured corpus), not merely "less than the generous config timeout" - the latter would be near-vacuous once the config value is generous, and would silently defeat the whole point of keeping OPS-03 tight.

This is licensed directly by SUR-12/OPS-03's own already-accepted text (quoted above, not invented for this ruling) and by working precedent already shipped in this exact repo (.claude/settings.json line 101). It resolves the "is there one stable number to measure" problem structurally rather than administratively: whichever invocation-cost layer a third round (or a future production incident) discovers next, the outcome is "OPS-03's regression test goes red, CI-10 fires, a human looks" - never "the declared timeout was silently wrong again, and every live Bash call bypassed the gate it exists to be." Both HIGH findings (round 1 attack #1, round 2 attack #1 / Issue #86) are structurally retired by this shape, not merely patched at the layer currently visible.

On the Stop Brief's Path A / Path C: re-measuring through the real invocation shape (Path A), or pinning an explicit args array to force exec form and avoid the shell layer entirely (Path C), are each reasonable, low-cost refinements to the OPS-03 measurement's own precision - and Path C in particular is worth adopting regardless of this ruling, since it removes a whole layer of platform-dependent variance from what OPS-03 has to track. Neither should be relied on as the sole justification for keeping the declared timeout tight, because doing so reintroduces the identical one-number-two-jobs problem this ruling diagnoses, merely with one fewer layer of present uncertainty - it does not establish there is no next layer.

---

## Issue #89 - is reading ~/.claude.json at all architecturally sound?

**Ruling: yes, the mechanism (read the file, extract server/tool identity) is sound and does not need a different mechanism entirely - but it is not yet compliant with an already-accepted P0 requirement, and the plan doesn't say so.**

Hooks are already documented, in this exact plan's own "ADR Review" section and in ADR-0021 itself, as the impure shell ("the hook script is the impure shell; it imports the kernel, the kernel never imports it," POL-11) - reading an arbitrary local file from a hook script crosses no kernel-purity or normalizer-registry boundary (kernel-purity-check.ts's scan boundary is untouched; nothing here imports into src/policy/kernel). The read itself is also not a new privilege: nothing in the shipped kernel (S2-S4) gates read-only filesystem access to a user's own home-directory config today, so a hook script reading ~/.claude.json reaches no further than the governed session's own ambient tool access already could via an ordinary Read/Bash-cat call. The risk this design genuinely introduces is not the read - it's a new output surface for what gets read.

That output surface is squarely covered by an already-accepted, P0 requirement the plan does not yet cite or satisfy:

OPS-02 (REQUIREMENTS.md:584): "Thoth shall never read, log or emit credential material. Posture output names identities and outcomes, never secrets. Fixture asserts no secret-shaped content in any artifact."

~/.claude.json, the exact file v2's criterion 15 proposes reading, is independently demonstrated (design-challenger round 2, this exact machine) to contain live-shaped plaintext secrets in mcpServers env blocks. The plan describes the read as extracting "MCP server declarations" without stating the extraction is scoped to names only, and names no fixture proving env/args/command values never propagate into the halt-state file, stderr, or any future log line - this is precisely the fixture OPS-02's own acceptance text already demands, not a new ask.

Two findings this seat adds, beyond what's already filed on Issue #89:

- The identical risk shape already existed for .mcp.json, in both v1 and v2 - a project-scoped stdio MCP server's config commonly carries the same env-secret shape. Issue #89 as filed names ~/.claude.json specifically (the file this session happened to inspect); the OPS-02 fixture should cover both new input files, or the same leak class survives through the one file nobody happened to grep this round.
- The resulting artifact - the gitignored .thoth/halt-state/<session_id>.json directory - is a new, persistent, session-visible surface (readable by the governed session's own ordinary file tools) derived in part from a secrets-bearing source. It is not currently named under CLAUDE.md's "Sensitive areas" list. Naming it there means a future change to sessionstart-tool-enum.mjs's extraction logic draws the same named-reviewer ceremony this project already gives comparable surfaces, rather than an ordinary, undifferentiated review.

Verdict on #89 specifically: APPROVE-WITH-CONDITIONS - reading ~/.claude.json (and .mcp.json) is architecturally fine; conditions are (1) the extraction contract is provably scoped to names/keys only, verified by the canary-secret fixture design-challenger already specified, explicitly satisfying and citing OPS-02 in the plan text (not left implicit); (2) that same fixture covers .mcp.json, not only ~/.claude.json; (3) .thoth/halt-state/ is added to CLAUDE.md's sensitive-areas list. None of this requires new topology or a different mechanism.

---

## Verdict table

| Axis | Verdict | Basis |
|---|---|---|
| 1. Fit (T11 shape) | REDESIGN-REQUIRED | Current derivation asks one measured number to serve two incompatible roles (safety ceiling + fast-feedback target); 2 rounds of demonstrated failure at successively deeper layers is the evidence, not opinion |
| 1. Fit (split-budget candidate) | APPROVE | Directly licensed by SUR-12/OPS-03's own already-accepted text (quoted) and by working precedent already shipped in this repo (.claude/settings.json line 101) |
| 2. Blast radius and coupling | Current shape's blast radius is the whole live-Bash-call surface, silently, on day one (approx 100% per both rounds' own measurement); split-budget candidate confines a wrong number's failure mode to a CI-10 incident, never a live silent bypass - strictly smaller blast radius for the same information | design-challenger rounds 1/2, this seat's re-reading of SUR-12/OPS-03 |
| 3. Compliance | SUR-12/OPS-03: current shape AMBIGUOUS-resolved-wrong (conflates the two named quantities); split-budget candidate CONFORMS, quoted verbatim above. OPS-02 (Issue #89): VIOLATES-if-shipped-as-described (no fixture scoping the new ~/.claude.json / .mcp.json read to names-only) - NOT-COVERED today, closable by a named fixture, not a new mechanism. ADR-0021 line 210 (closed four-primitive list): CONFORMS, independently re-confirmed by both this seat and design-challenger round 2 against the ADR's own text | REQUIREMENTS.md lines 468/585/584 (code-traced, quoted); ADR-0021 (code-traced) |
| 4. Cost shape | Current shape's cost is unbounded in the wrong direction - the tail of unmeasured invocation-cost layers is open-ended and platform-dependent, so the "cost" of getting the number wrong is a full-surface silent security bypass, not a resource or dollar cost. Split-budget candidate bounds the failure mode to a CI check, a fixed and known cost | derived from both rounds' own escalating-layer measurements |
| 5. Operability | Current shape: no operability signal at all when wrong (G6: no alert reaches the model or any evidence trail). Split-budget candidate: wrong-number failures degrade visibly (CI-10 red), matching this project's own "operability = failure degrades visibly but safely" standard | REQUIREMENTS.md's own G6/SUR-12/OPS-03 text |

## Findings, ranked by blast radius

1. [ISSUE][HIGH][code-traced] T11's derivation method (plan section 5 step 5, "declared timeout = safety-margined multiple of the measured SUBPROCESS p99") conflates SUR-12's declared-timeout axis and OPS-03's own-budget axis into one number, contradicting the "far below" relationship both requirements' own accepted text (REQUIREMENTS.md lines 468/585) specifies between them - the structural root cause of 2 consecutive round failures at different invocation layers (function -> subprocess-exec -> subprocess-shell). Exposure: approx 100% of live Bash calls once wired, basis: measured (both design-challenger rounds' own numbers, re-read against the requirement text here). Disposition: commented on already-open Issue #86 (this is the same underlying thread, not a new defect) rather than filing a duplicate.
2. [ISSUE][MED][code-traced] Reading ~/.claude.json (and, by the same shape, .mcp.json) is not yet shown to satisfy OPS-02 (REQUIREMENTS.md line 584, P0, "Thoth shall never read, log or emit credential material... Fixture asserts no secret-shaped content in any artifact") - the plan's criterion 15 doesn't cite OPS-02 or commit its already-proposed canary-secret fixture to both new input files. Disposition: commented on already-open Issue #89.
3. [SUSPICION][LOW][derived] .mcp.json carries the identical env-secret risk shape as ~/.claude.json but Issue #89 as filed names only the latter - the same fixture should cover both, or the class of leak this issue exists to close survives through the file nobody happened to inspect this round.
4. [SUSPICION][LOW][derived] The new .thoth/halt-state/ directory (a persistent artifact partly derived from secrets-bearing config, readable by the governed session's own ordinary tools) is not yet named under CLAUDE.md's "Sensitive areas" list.
5. [CLEAN][code-traced] Reading ~/.claude.json / .mcp.json at all, as a mechanism, crosses no ADR-0021 boundary - hooks are the documented impure shell (POL-11), and no shipped kernel/normalizer-registry rule gates read-only access to a user's own home-directory config today.
6. [CLEAN][derived] The split-budget candidate path (generous, fixed, disclosed timeout decoupled from a separately-measured, CI-regression-tested OPS-03 budget) is licensed directly by SUR-12/OPS-03's own already-accepted text and by working precedent already shipped in this repo (.claude/settings.json line 101, timeout: 10 against a disclosed real cost of "approximately 50 small synchronous reads") - not new invention, not an ADR conflict, requires no ADR amendment.

## NOT-COVERED / AMBIGUOUS list (architect's work queue)

1. The exact generous timeout figure (finding 1's candidate path) - story-implementer's call, one-line justification, recorded once in docs/decisions.md; this seat names the shape, not the number.
2. The exact OPS-03 internal alarm threshold that would trip a CI-10 incident (finding 1's candidate path, item 3) - same disposition, story-implementer's call from the actual measured corpus.
3. Whether Path C (explicit args array, exec form) is worth adopting as a complementary simplification to reduce OPS-03's own measurement variance - a cheap, non-blocking refinement story-implementer can take or leave; not required by this ruling.

## Editorial (non-blocking, no re-review needed)

- docs/.maat-state.json's roundsSinceLastGo: 0 is stale (both design-challenger round 2 and its own Stop Brief already flagged this) - Manager bookkeeping fix, not this seat's to make.

## Findings vs. failing tests

Pre-build council ruling - no S5 code exists yet. Finding 1 becomes: a named regression test (already sketched in the plan's own C7, revised per the candidate path above) asserting the measured OPS-03 p99 stays under its own internal ceiling, independent of and far below the generous config timeout. Finding 2 becomes: the canary-secret fixture design-challenger already named for Issue #89, extended to cover both ~/.claude.json and .mcp.json. Findings 3-4 are LOW/derived, non-gating, routed to the plan text and CLAUDE.md respectively, not to a test. Open findings: 4 (ISSUE times 2 + SUSPICION times 2). Failing tests: 2 (findings 1-2 map to named tests above; findings 3-4 are prose/doc additions with no executable form, same disposition my round-1 report on this plan already used for its own LOW findings).

## Verdict

REDESIGN-REQUIRED on the plan's current T11 shape (tie the declared enforcement timeout directly to one measured invocation-latency figure with a margin multiplier) - two consecutive demonstrated failures at different invocation layers is sufficient evidence that this method cannot be trusted to converge by further measurement alone.

APPROVE on the candidate path: the split-budget model - a generous, fixed, disclosed timeout in .claude/settings.json, decoupled from a separately-measured, CI-regression-tested OPS-03 latency budget whose overrun is a visible CI-10 incident, never a live security bypass. This is a refinement of the council Stop Brief's own Path B, directly licensed by SUR-12/OPS-03's already-accepted text and by working precedent already shipped in this exact repo.

APPROVE-WITH-CONDITIONS on Issue #89's question (reading ~/.claude.json at all) - the mechanism is sound; conditions are the OPS-02-citing, names-only-scoped canary fixture (extended to .mcp.json) and naming .thoth/halt-state/ under CLAUDE.md's sensitive areas.

## Single next action

story-implementer revises the S5 Phase 1 plan's T11 section (section 5) to the split-budget model above - a generous, fixed, disclosed timeout value plus a separate, tightly-measured OPS-03 regression check wired to CI-10 - records the two chosen numbers with one-line justifications each in docs/decisions.md, extends criterion 15's fixture to prove names-only extraction (citing OPS-02) across both ~/.claude.json and .mcp.json, and brings the revised plan back for one final design-challenger re-confirm (not a fresh round-1-style attack - a re-confirm against this specific ruling, the same shape as this plan's own round-2 re-confirm of the architecture-reviewer's 5 conditions).

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][code-traced] T11's derivation collapses SUR-12's declared-timeout axis and OPS-03's own-budget axis into one number, against the requirements' own "far below" text (REQUIREMENTS.md lines 468/585) - root cause of 2 consecutive round failures at deeper invocation layers; approx 100% exposure once wired (measured, both rounds). Commented on open Issue #86, not duplicated.
2. [ISSUE][MED][code-traced] Reading ~/.claude.json / .mcp.json for MCP enumeration is not yet shown to satisfy OPS-02 (REQUIREMENTS.md line 584, P0, "never read, log or emit credential material... fixture asserts no secret-shaped content") - plan criterion 15 doesn't cite OPS-02 or commit the fixture to both files. Commented on open Issue #89, not duplicated.
3. [SUSPICION][LOW][derived] .mcp.json carries the identical env-secret risk shape as ~/.claude.json; Issue #89 as filed names only the latter - same fixture should cover both.
4. [SUSPICION][LOW][derived] New .thoth/halt-state/ directory (partly secrets-adjacent-derived, session-readable) not yet named under CLAUDE.md's sensitive-areas list.
5. [CLEAN][code-traced] Reading ~/.claude.json / .mcp.json at all crosses no ADR-0021 kernel-purity/normalizer-registry boundary - hooks are the documented impure shell (POL-11); no shipped rule gates this read today.
6. [CLEAN][derived] The split-budget candidate path (generous fixed timeout decoupled from a tightly-measured, CI-regression-tested OPS-03 budget) is licensed directly by SUR-12/OPS-03's own accepted text and by working precedent already shipped in this repo (.claude/settings.json line 101, timeout: 10 against a disclosed approx-few-ms real cost).
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=2 suspicions=2 clean=2
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=0 code-traced=4 derived=2
checks=n/a (pre-build design-shape council ruling; no S5 code exists yet - hooks/ confirmed absent from master by both design-challenger rounds; this seat re-read REQUIREMENTS.md/ADR-0021/.claude/settings.json directly rather than re-running the machine measurements already in the design-challenger reports)
adr=HIT(35)
report=docs/reviews/s5-deny-by-default-hook-wiring-architecture-council-2026-09-06.md
