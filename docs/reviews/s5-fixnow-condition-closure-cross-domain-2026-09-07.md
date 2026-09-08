# Cross-domain re-confirm (terminal): S5 fix-now -- "record resolved fixture path" council condition closure

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-07
**Scope:** scope=s5-fixnow / tier=CRITICAL (Milestone #23). Narrow, proportionate re-confirm of a single additive diagnostic fix: story-implementer closed an unfulfilled council condition ("record the resolved fixture path in halt-state, so a non-default load is never silent") that the Manager found missing during the mandatory pre-merge full-read of docs/reviews/s5-fixnow-council-impact-analyst-2026-09-07.md and docs/reviews/s5-central-classification-architecture-council-2026-09-07.md. Not a fresh whole-mechanism attack pass -- this role's own prior report (docs/reviews/s5-central-classification-cross-domain-round3-2026-09-07.md) already covered the ADR catalog, N2/N3/#96-escalation, and the process-hygiene gaps (#103/#104) for everything up to that point.
**ADR cache:** node docs/adr-cache.mjs --ensure gives ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT] -- same fingerprint as rounds 1-3, whole catalog read unfiltered per this role's standing mandate (PRINCIPLES rule 9), not a domain slice.
**Who else is covering this ground:** app-security-reviewer is dispatched this same round against the identical diff (per the task brief). Both domain-reviewer and council-seat lanes (red-team, app-security, architecture-reviewer, impact-analyst, design-challenger) already ran three full rounds against this mechanism -- that ceremony is not re-run here. This report picks up exactly where my own prior round-3 pass stopped (the newly-discovered condition gap), not a repeat of what it already covered.

---

## 1. Files actually touched by this pass

git diff confirms exactly: CHANGELOG.md, hooks/sessionstart-tool-enum.mjs (new resolveFixtureLocation(), writeHaltReason's fixtureLocation parameter, main()'s pre-stdin resolution). src/policy/tools/central-classification.ts and hooks/sessionstart-tool-enum-fixnow.test.ts are new/untracked files (no prior committed baseline to diff against) -- read in full directly. hooks/test-support/fixture-tree.ts's writeCentralClassificationFixture is unchanged carry-over from round 2/3 (confirmed via git diff, zero lines for that function this pass).

## 2. Did the shipped fix genuinely satisfy both council conditions as written?

Re-read both council reports' exact condition text:

- impact-analyst (s5-fixnow-council-impact-analyst-2026-09-07.md), SAFE-TO-PATCH verdict: "conditional on N3 landing as a structured field (not a string-match hack) and N1's fix including the 'record the resolved path' half red-team named as a prerequisite for N2 to matter."
- architecture-reviewer council seat (s5-central-classification-architecture-council-2026-09-07.md), condition 1: "Remove the ambient-env override ... and replace the test-injection seam with true dependency injection ... -- closes Issue #99 at the architectural root." Body text (section 1, Operability axis): "which fixture path a given run actually resolved and loaded is recorded nowhere (halt-state file, stderr, or otherwise) -- this is the same gap red-team's N1 proof-test already names as its fix."
- design-challenger stop-brief (s5-fixture-mechanism-design-challenger-stopbrief-2026-09-07.md), line 121: "Close N1 (gate the env override ...; record the resolved fixture path in halt-state)."

All three documents use the identical phrase, independently. The N3-structured-field half was already closed in round 3 (SUR-03-central-fixture-expired, a distinct reason key, not a string-match -- re-verified this pass, see section 4). The "record the resolved path" half was the part left unimplemented through round 3 and closed by this diff.

**Code trace, hooks/sessionstart-tool-enum.mjs:**
- resolveFixtureLocation() (new) computes {fixtureSource: "project-relative"|"fallback-default", fixturePath} once, before stdin is even read in main(), so it survives an enumeration exception too -- matches the architecture council's own "never silent... on the enumeration-FAILED path too" framing exactly.
- writeHaltReason(sessionId, reasonKey, set, detail, fixtureLocation) stamps payload.fixtureSource/payload.fixturePath at the halt-state file's top level, additively, alongside reasons, on every actual write (both the reconcileReason path and the catch-block's own direct call).
- computeSessionTools(fixtureLocation) no longer re-derives which path to load -- it takes the resolved value from main(), so the writer and the loader agree on the exact same decision (no drift between "what was recorded" and "what was actually read").

This matches what was ratified, with no deviation that would need re-litigating. The implementation is, if anything, more thorough than the literal ask (it stamps the resolved path on every halt-state write, not only ones caused by a non-default load) -- a strictly more transparent choice, and one that does not conflict with AC-4 (see section 3).

## 3. AC-4 (no-file-for-a-vanilla-session) unregressed -- verified, not assumed

writeHaltReason is the only call site that ever attaches fixtureLocation to a payload, and it is only ever invoked when there is already a genuine reason to write (via reconcileReason's active/wasReasonActive branches, or the top-level catch). No new call site fires solely to record the fixture location. Confirmed against the three new tests in hooks/sessionstart-tool-enum-fixnow.test.ts:
- S5-fixnow-fixture-source: ... fixtureSource="project-relative" ... -- halt caused by a genuine unclassified tool, path recorded correctly.
- S5-fixnow-fixture-source: ... fixtureSource="fallback-default" ... -- same, for the no-project-fixture case.
- S5-fixnow-fixture-source: AC-4's vanilla no-file contract is unregressed ... -- a fully-classified session still writes no file at all, confirmed by assert.equal(readHaltState(...), undefined).

## 4. inspectHaltState tolerates the new top-level fields -- verified, not assumed

hooks/userpromptsubmit-halt-relay.mjs lines 158-174's inspectHaltState reads only haltState.reasons; it never inspects or rejects on unknown top-level keys. Code-traced directly. This is also exercised indirectly by every existing test that runs the relay after a SessionStart write that now always carries fixtureSource/fixturePath (e.g. "AC5: ... reconcile-tool" -- active then clean case; "S5-R2-Issue96-escalation" and "S5-R2-N3" -- active case) -- both a clean (relay exit 0) and an active-reason (relay exit 2) case are genuinely covered, matching the CHANGELOG's own claim precisely; not overclaimed.

The SUR-03-central-fixture-expired reason key (round 3) is confirmed still a distinct, structured key -- hooks/userpromptsubmit-halt-relay.mjs lines 113-114's UNLOCK_HINTS keys off "SUR-03-central-fixture-expired" directly, not a string-match against detail text. impact-analyst's "single change most likely to be regretted" (a string-match hack) did not happen.

## 5. Whole-ADR-catalog re-check (35 ADRs, fp 83b2e3e, unchanged) -- zero new collisions

- ADR-0021 (kernel purity, POL-11): unaffected -- git diff --stat confirms zero touch to src/policy/kernel/** this pass, matching CHANGELOG's own "zero diff" claim.
- SE ADR-0002/0003 (layering, DI): resolveFixtureLocation() is pure (existsSync/join, no throw by construction) and separated from the impure write; central-classification.ts's pure/impure split (parseCentralClassificationFixture vs loadCentralClassificationFixture) is unchanged this pass. Consistent with the pattern the architecture council already blessed.
- No other ADR in the 35-entry catalog governs config-loading trust boundaries or halt-state schema shape -- confirmed independently, matching the architecture-council's and my own round-2/round-3's prior full-catalog reads (no new file type, no new dependency, no new IaC/data/observability surface introduced).

Verdict: zero new ADR collisions.

## 6. CHANGELOG.md accuracy -- checked line-by-line against the code

The new "Post-round-3 gap closed" paragraph (CHANGELOG.md, appended after the round-2/3 section) was checked claim-by-claim against the diff and the code:
- "resolveFixtureLocation() resolves, once per run (before stdin is even read...)" -- confirmed, main()'s ordering.
- "writeHaltReason stamps fixtureSource/fixturePath at the halt-state file's top level, additively... whenever a halt-state file is already being written for some other, genuine reason" -- confirmed.
- "Scoped explicitly by AC-4 (unmodified)..." -- confirmed by the dedicated test (section 3).
- "Verified directly (not assumed) that ... inspectHaltState tolerates the new top-level fields additively at both the code-trace level and by running the relay against a live halt-state file carrying them (both a clean and an active-reason case)" -- confirmed true, not overclaimed (section 4).
- New test list matches what is actually in hooks/sessionstart-tool-enum-fixnow.test.ts.

No inflation, no stale claim, no miscounted total found in this new paragraph.

One non-blocking observation: no docs/decisions.md row records this specific closure event (the Manager's own pre-merge catch that a ratified condition had gone unimplemented, and its subsequent fix) -- only the CHANGELOG documents it. This is not the same gap as my own prior round-3 finding (Issues #103/#104, both closed -- those were "no decisions.md row / no CHANGELOG entry existed at all" for the round-2/3 work). Here a CHANGELOG entry exists and is accurate; docs/decisions.md is this project's record of rulings, and this closure implements an already-ratified condition rather than making a new one -- CLAUDE.md's Definition of Done requires a CHANGELOG entry + current docs/STATE.md, not a decisions.md row for every mechanical fix. Flagged only for symmetry with this project's own pattern of giving council-condition closures their own append-only row; it does not rise to a finding and is not filed as an Issue.

## 7. Independent npm test re-run -- real count

    $ npm test
    ...
    tests 550
    suites 0
    pass 550
    fail 0
    cancelled 0
    skipped 0
    todo 0
    duration_ms 14800.2091

550/550 pass, 0 fail, 0 skipped -- matches the build receipt's claimed 550/0/0 exactly. (547 at round 3's own re-confirm + 3 new S5-fixnow-fixture-source tests this pass = 550, consistent.)

Also independently re-ran, all green:

    $ npm run typecheck   -> clean, no output
    $ npm run lint        -> clean, no output
    $ npm run qa:gate-command-path    -> PASS (2 command-type hook entries, all resolve)
    $ npm run qa:gate-matcher-drift   -> PASS (19 referenced tool names, all in vendored snapshot)
    $ npm run qa:gate-manifest        -> PASS (exactly 1 gate manifest found)
    $ npm run qa:gate-latency-budget  -> PASS (p99 186.70ms under 2000ms budget)

## 8. Coverage gaps

None new. This pass touches no new file type, no new dependency, no new sensitive-area surface beyond what rounds 1-3's full ceremony (red-team, app-security-reviewer, architecture-reviewer council seat, impact-analyst council seat, design-challenger stop-brief, and this role's own three prior passes) already covered. docs/STATE.md's staleness (unchanged since before round 1) is pre-existing and already flagged non-blocking in my own round-2/round-3 reports -- not re-counted as a new gap here.

## 9. Verdict

APPROVE.

Both council conditions this pass targeted are genuinely closed, matching what was ratified with no deviation: the "record the resolved fixture path" half of impact-analyst's SAFE-TO-PATCH condition and architecture-council's condition 1 (previously the one substantive gap left open after round 3's own re-confirm mistakenly treated the arc as fully closed). Zero new ADR collisions across the full 35-entry catalog. npm test independently re-run at 550/550/0/0, matching the build receipt exactly; typecheck/lint/all four QA gates independently re-run, all green. CHANGELOG entry checked claim-by-claim against the code -- accurate, no overclaim.

S5's fix-now sub-effort is now fully closed with no outstanding council conditions. Tally, cross-checked against every document read this pass and across rounds 1-3:
- Round 1 (KNOWN_CONNECTORS/centralLayer fixture, Issues #90/#92/#98) -- CLOSED.
- Round 2 to 3 council Path A, all 4 sub-fixes (env-var removal/#99, expiresOn pin/#100, expiry unlock hint/#101, #96-escalation guard) -- CLOSED, independently re-verified by red-team/app-security/cross-domain round 3.
- Architecture-council's 3 conditions (env-var removal+DI, expiresOn pin+relay-nameable cause, backlog S6-intake line) -- all 3 CLOSED (backlog line confirmed present this pass).
- impact-analyst's SAFE-TO-PATCH conditions (N3 structured field, N1 record-resolved-path) -- both CLOSED, the second one by this pass.
- Process-hygiene gaps this role found at round 3 (Issues #103, #104: missing decisions.md/CHANGELOG rows, missing backlog line) -- both CLOSED (gh issue list confirms both CLOSED).

This is the terminal gate for this arc. The Manager can proceed to declare SHIPPABLE (Stage 4/verify's own build/test/lint/gate checks are all independently confirmed green above; Stage 5/audit and the human-only merge action remain outside any reviewer's authority).

Single next action: none required to close this condition -- proceed to Stage 4/verify then Stage 5/audit then human merge-handoff. (Carried-forward, non-blocking, already-tracked items: red-team's CLAUDE_PROJECT_DIR precedence drill before PreToolUse activation, and docs/STATE.md's staleness -- both already recorded, neither blocks this gate.)

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [CLEAN][code-traced] hooks/sessionstart-tool-enum.mjs's resolveFixtureLocation()+writeHaltReason stamping genuinely implements both council reports' "record the resolved fixture path in halt-state" condition, verbatim-matched against all three source documents (impact-analyst, architecture-council, design-challenger stop-brief) -- no deviation.
2. [CLEAN][code-traced] AC-4 (no-file-for-a-vanilla-session) unregressed by the new fixtureLocation stamping -- confirmed by code trace (only writeHaltReason attaches it, only called on a genuine write) and by a dedicated new test.
3. [CLEAN][code-traced] hooks/userpromptsubmit-halt-relay.mjs lines 158-174's inspectHaltState tolerates the new top-level fixtureSource/fixturePath fields additively (reads only .reasons) -- confirmed by code trace and by existing tests exercising the relay against halt-state files carrying the new fields in both a clean and an active-reason case.
4. [CLEAN][code-traced] Whole-35-ADR-catalog re-check (fp 83b2e3e unchanged) against all touched files -- zero new collisions; kernel boundary (ADR-0021) untouched, DI split (SE ADR-0002/0003) intact.
5. [CLEAN][demonstrated] npm test independently re-run: 550/550 pass, 0 fail, 0 skipped -- matches build receipt's claimed 550/0/0 exactly.
6. [CLEAN][demonstrated] npm run typecheck / npm run lint / all four qa:gate-* scripts independently re-run -- all clean/PASS, matching CHANGELOG's claim.
7. [CLEAN][code-traced] CHANGELOG.md's "Post-round-3 gap closed" entry checked claim-by-claim against the code -- accurate, no overclaim, no stale reference.
8. [SUSPICION][LOW][derived] No docs/decisions.md row records this specific closure event (only CHANGELOG.md does) -- not the same gap as the already-closed Issues #103/#104 (which were "no record at all"); a CHANGELOG entry already exists and is accurate, and DoD does not require a decisions.md row for implementing an already-ratified condition. Flagged only for symmetry with this project's own pattern; non-blocking, no Issue filed.
counts (a CHECKSUM -- MUST equal the lines listed above): issues=0 suspicions=1 clean=7
evidence (a CHECKSUM over the tags above): demonstrated=2 code-traced=6 derived=1
checks=npm test: 550 pass/0 fail/0 skipped (real run, this session); npm run typecheck: clean; npm run lint: clean; qa:gate-command-path/qa:gate-matcher-drift/qa:gate-manifest/qa:gate-latency-budget: all PASS (real runs, this session); node docs/adr-cache.mjs --ensure: CACHE=HIT (fp 83b2e3e, 35 ADRs)
adr=HIT(35, whole catalog)
report=docs/reviews/s5-fixnow-condition-closure-cross-domain-2026-09-07.md
