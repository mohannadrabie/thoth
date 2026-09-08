# Cross-domain re-confirm (round 3, TERMINAL): S5 central-classification fixture mechanism, post-council fix-now

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-07 (round 3)
**Scope:** scope=s5-central-classification, tier=CRITICAL (docs/.maat-state.json). Re-confirm of the round-3 fix-now that responded to the rule-16(c) council (architecture-council + design-challenger stop-brief + impact-analyst, all persisted 2026-09-07). Files this round's diff touches: hooks/sessionstart-tool-enum.mjs, hooks/userpromptsubmit-halt-relay.mjs, hooks/test-support/fixture-tree.ts, hooks/sessionstart-tool-enum-fixnow.test.ts, src/policy/tools/central-classification.test.ts (plus src/policy/tools/central-classification.ts, docs/qa/s5-central-classification.json, carried unchanged from round 2).
**ADR cache:** node docs/adr-cache.mjs --ensure gives CACHE HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e) [CACHE=HIT] -- same fingerprint as rounds 1/2. Whole catalog re-read, unfiltered, against all five files this round's diff touches, per this role's standing mandate (PRINCIPLES rule 9) -- not the domain-reviewer slice.
**Who else ran (read in full before writing this; corrects an initial miss of mine -- I began this pass before locating these two, see the note at the end of section 2):**
- red-team, round 3 (docs/reviews/s5-fixnow-round3-red-team-2026-09-07.md) -- verdict **go**. Independently re-ran all four round-2 repros (N1/#99, N2/#100, N3/#101, the #96 escalation) by mutation, confirmed each load-bearing, not merely passing. Found and correctly calibrated a new item, R5 (below).
- app-security-reviewer, round 3 (docs/reviews/s5-halt-hooks-app-security-round3-2026-09-07.md) -- verdict **APPROVE**. Confirmed the #96 escalation closed (7/7 independent reruns), confirmed the env-var-removal fix introduces no NEW session-isolation concern, and itself found and same-turn-fixed a real tracking gap (Issue #97's Unicode residual had fallen out of all tracking despite a comment claiming otherwise).
- architecture-council (docs/reviews/s5-central-classification-architecture-council-2026-09-07.md) -- APPROVE-WITH-CONDITIONS, 3 conditions, ratified as the round's scope.

My own lane, per the standing division of labor: the whole ADR catalog (not the domain slice both reviewers above correctly limited themselves to), and the process/paper trail this round's real work left behind -- decisions.md, backlog.md, CHANGELOG.md consistency against what the council ordered and what red-team/app-security actually found.

---

## 1. Whole-ADR-catalog re-check against the five round-3 files

No new collision. central-classification.ts/docs/qa/s5-central-classification.json are unchanged since round 2 (confirmed via git diff, zero lines). The three genuinely changed files (hooks/sessionstart-tool-enum.mjs, hooks/userpromptsubmit-halt-relay.mjs, hooks/test-support/fixture-tree.ts, hooks/sessionstart-tool-enum-fixnow.test.ts) re-checked against all 35 entries:
- ADR-0002/0003 (layering/SOLID, DI): the pure parseCentralClassificationFixture / impure loadCentralClassificationFixture split is unchanged and still the correct shape.
- ADR-0021 (kernel purity, POL-11): unaffected -- none of this round's edits touch src/policy/kernel/.
- No other ADR in the 35-entry catalog governs config-loading trust boundaries (confirmed independently, matching both the architecture-council's and my own round-2's prior full-catalog reads).

Verdict: zero new ADR collisions.

## 2. Did the shipped fix match the council's ruling? -- mostly yes; the one gap is already found, correctly calibrated, and non-blocking

I independently re-ran the same class of test red-team and app-security both used: spawned the real, unmodified hooks/sessionstart-tool-enum.mjs with CLAUDE_PROJECT_DIR pointed at a fabricated tree carrying a forged docs/qa/s5-central-classification.json, and confirmed the forged fixture is honored (an attacker-named tool exempted, zero halt, zero git diff). This is the identical experiment to red-team round 3's own R5 (its "E3" attack) and reaches the identical result.

I raise this only to state plainly: this is NOT a new finding. Red-team round 3 already found, named, and correctly calibrated it as [SUSPICION][MED][demonstrated at hook level; basis: assumption at production reachability] -- "UNPROVEN-pending-verification... cannot gate... the only recommendation permitted is 'measure it'" (their own citation of this project's PRINCIPLES rules 18/21). App-security round 3 independently reasoned to CLEAN on the same question, on different grounds (CLAUDE_PROJECT_DIR is the SAME seam already governing every other input/output this hook touches, not a new trust boundary -- a lateral extension of an already-disclosed tension, not a fresh one). Both lanes explicitly distinguish what is actually demonstrated (the vulnerable code path, at the hook boundary, which I also just reproduced) from what remains an open, unmeasured question (whether Claude Code's own env-injection for CLAUDE_PROJECT_DIR can actually be overridden by anything a governed session controls -- neither red-team, app-security, nor I have a way to test this from a sandbox without a real Claude Code CLI session).

Per this role's own redundancy-check mandate ("a gap already named by a lane reviewer isn't a new finding, it's noise") and per the evidence policy ("basis: assumption caps the finding at LOW, and the only recommendation permitted is 'measure it'"), I am not re-raising this as a blocking finding. I initially drafted this round's report before locating either round-3 file and had reached the same experiment independently and provisionally called it a blocking REWORK -- on finding both persisted reports mid-review, I withdrew that framing (see "process note" at the end of this section) rather than let a redundant, over-calibrated restatement stand as if it were new.

What I can usefully add, since I hold the whole-catalog seat neither domain reviewer occupies: the council's own condition 1 text ("never via a signal that lives in the same process-environment namespace Claude Code's own env settings key writes into") is, read literally, not fully satisfied by CLAUDE_PROJECT_DIR-based resolution -- red-team's own R5 says exactly this ("CLAUDE_PROJECT_DIR lives in exactly that namespace"). Both red-team and app-security nonetheless converge on non-blocking, for reasons that are sound under this project's own calibration (reach=operator-class, likelihood gated on an unmeasured production fact, and app-security's point that this predates and does not enlarge an already-disclosed tension). I agree with that convergence. My own contribution is narrower: the single next action BOTH red-team (explicitly) and, implicitly, this round's own completion depends on -- "run R5's five-minute CLAUDE_PROJECT_DIR precedence drill... and record the result in docs/decisions.md as a pre-activation gate on Milestone #24" -- has not happened yet, and has nowhere to land even if it had (see section 4).

**Process note, disclosed rather than concealed (PRINCIPLES rule 13):** I dispatched this round's investigation before checking docs/REVIEW_LOG.md for round-3 reports already in flight from red-team/app-security-reviewer -- a real process miss on my part (this role's own task framing told me no round-3 reports existed yet, and I did not independently verify that claim against the log before spending significant effort re-deriving a finding both of them already had). I caught it myself, mid-report, by reading docs/REVIEW_LOG.md before persisting. I had provisionally filed a duplicate, over-calibrated GitHub Issue (#102) for this same finding before catching the duplication; it is closed as not-planned with a comment pointing at red-team's own prior R5 finding, same session.

## 3. Section 0.4 property 2 (task item 2) -- substantially resolved; one narrow, already-tracked, non-blocking residual

The literal named env var (THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH) is gone from the production path -- confirmed independently (grep, and my own spawn test with the var set and ignored). The broader property ("no credential the governed session holds reaches the policy source") is not fully closed in the strict, literal sense -- CLAUDE_PROJECT_DIR remains a theoretically-reaching credential, exactly as red-team's R5 says -- but whether that theoretical reach is real in production is unmeasured, not demonstrated, and both domain reviewers correctly decline to gate on it. My own independent check adds no new information here beyond confirming their shared premise is accurately described. This is not "resolved and closed," and it is not "silently claimed solved" either -- both reports are honest about exactly this gap, which is the right disclosure shape for an unmeasured fact per PRINCIPLES rule 18.

## 4. decisions.md / backlog.md / CHANGELOG.md consistency (task item 3) -- real gaps, not covered by either round-3 report

The one 2026-09-07 row that governs this arc (docs/decisions.md, "S5 Stage-3 CRITICAL review round 1...") is itself internally accurate against what shipped for round 1 -- re-checked line by line, no drift. But:
- No decisions.md row exists for the round-3 council at all. git diff HEAD -- docs/decisions.md shows exactly one row added this whole session (round 1's), nothing for the rule-16(c) council (architecture-council/design-challenger-stopbrief/impact-analyst) or its Path-A ruling that docs/.maat-state.json's own councilVerdict field describes. Every prior council in this project's history (S4's two councils, S5's own T11/timeout council) got its own decisions.md row with cited evidence; this is the first that didn't. Neither round-3 report flags this (both correctly stayed inside their own narrow domain remit).
- Nowhere for red-team's own named single next action to land: "run R5's five-minute CLAUDE_PROJECT_DIR precedence drill... and record the result in docs/decisions.md as a pre-activation gate on Milestone #24" has no decisions.md row to be recorded IN yet, since none exists for this arc.
- CHANGELOG.md's S5 section covers only round 1 (Issues #90-#98). Round 2/3's fixes (Issues #99/#100/#101, the #96 escalation guard) have no entry.
- docs/STATE.md is unchanged since before round 1's dispatch -- still says "Not yet reviewed," not reflecting any of rounds 1-3 or the council. (Already flagged non-blocking bookkeeping in my own round-2 report; still true, not re-counted as a new finding, but now three rounds stale rather than one.)

Filed as GitHub Issue #103 (bundling the decisions.md + CHANGELOG gaps and the nowhere-to-land drill-recording point -- same root cause: this round's real ratifications were never written into either of this project's own required record-keeping surfaces).

## 5. NOT-COVERED flag (task item 4) -- still accurately open, but the council's own condition to record it was never fulfilled

The architecture-council's NOT-COVERED question (can an in-repo, git-committed fixture ever satisfy section 0.4 property 2 at all, or is it structurally incapable regardless of hardening) is NOT claimed solved anywhere in the diff, the fixture, or any doc I could find -- checked central-classification.ts's header, the fixture's own notes, docs/backlog.md in full, and both round-3 reports. No overclaim anywhere. Good.

But the council's own APPROVE-WITH-CONDITIONS verdict named three conditions, and condition 3 ("Add one explicit line to docs/backlog.md/S6 intake naming the section-0.4-property-2 question... so S6 does not inherit this pattern by default") was NEVER fulfilled -- grep-confirmed absent from docs/backlog.md as shipped (searched for "0.4", "property 2", "structurally incapable", "calcification", "S6/Milestone #24 intake" -- zero matches). Neither round-3 report flags this either (again, correctly outside their own narrow domain remits). A council verdict of APPROVE-WITH-CONDITIONS whose condition silently did not land is exactly the kind of gate PRINCIPLES rule 13 asks to be disclosed, not silently skipped. Filed as GitHub Issue #104.

## 6. What round 2's mandated fixes actually got -- re-verified independently, cross-checked against both round-3 reports

- N2 (expiresOn exact-value pin, Issue #100): central-classification.test.ts's new S5-R2-N2 test asserts the literal value "2026-10-07" via assert.equal (not shape-only). Independently confirmed by me AND by red-team's own fresh 2026-10-07 -> 2099-01-01 mutation (fails by name). CLOSED.
- N3 (post-expiry unlock hint, Issue #101): a distinct SUR-03-central-fixture-expired reason key fires independently of the two allowlist keys; the relay names re-ratification/removal, not the generic (now-wrong) "reclassify the tool" hint -- the structured-cause-field shape impact-analyst recommended, not the string-match hack it flagged as likely to be regretted. Independently confirmed by me AND by red-team's own full follow-the-hint-through-re-ratification drill (relay genuinely exits 0 after following the new hint). CLOSED.
- Issue #96 escalation: reconcileReason() never writes set:false for the UNKNOWN_SESSION_ID fallback bucket. Independently confirmed by me, by red-team's mutation test (disabling the guard flips the outcome and fails the named test), and by app-security's from-scratch two-invocation repro (7/7 consistent). CLOSED, most thoroughly re-verified finding in this whole arc.
- Unicode sanitizeDetail gap (app-security round-2 finding 7): correctly left unfixed (never one of the council's four mandated sub-fixes). app-security's own round-3 pass found this had fallen out of ALL tracking (no open Issue, no backlog entry, despite a round-2 comment claiming it was filed separately) and fixed the tracking gap in the same turn (docs/backlog.md entry added, Issue #97 comment corrected). Independently re-confirmed by me: the backlog entry exists, is accurate, and matches the code's actual (unfixed) state.

## 7. npm test -- independent re-run, real count

    $ npm test
    ...
    tests 547
    suites 0
    pass 547
    fail 0
    cancelled 0
    skipped 0
    todo 0
    duration_ms 12616.0093

547 -- matches both red-team's (547, their own independent run) and app-security's (547) counts exactly. = round 2's 543 + 4 new named regression tests. No silent skip, no load error.

## 8. Coverage gaps

- The connector display-name spoofability drill (Issue #90's own core premise) remains the single largest unproven assumption in this whole mechanism, per design-challenger's stop-brief -- unchanged, not re-litigated by any of the three reports this round, still requires a human-run drill outside any sandbox.
- CLAUDE_PROJECT_DIR's production-reachability question (section 2/3 above) is now named by two independent reports plus this one, with a concrete 5-minute human drill specified (red-team's report) -- but with nowhere durable to record its outcome (section 4). This is the one genuinely actionable gap this round leaves open.

## 9. Verdict

**APPROVE-WITH-CONDITIONS.** This closes the stall from the cross-domain seat: the code itself is sound. Both domain reviewers independently re-verified round 2's four mandated fixes as genuinely load-bearing (not merely passing), by mutation and from-scratch repro rather than by reading the diff; my own independent spot-checks corroborate every one of their findings, including the one open item (CLAUDE_PROJECT_DIR reachability) that both already found, correctly calibrated as non-blocking, and gave a concrete next step for. I found no code-level defect this round that either domain reviewer missed. Zero new ADR collisions across the full 35-ADR catalog.

What I found that neither domain reviewer's narrower remit covered is process, not code: this round's real, substantive work (the rule-16(c) council and its resulting fix-now pass) left no trace in docs/decisions.md or CHANGELOG.md, and the architecture-council's own third condition (a backlog line flagging the section-0.4-property-2 question for S6 intake) was never fulfilled. These are conditions on calling this story DONE (CLAUDE.md's own Definition of Done requires a CHANGELOG entry and a current STATE.md for every change), not conditions on the code's correctness -- they do not require another adversarial review round, and they do not block Stage 4 (verify, which checks build/test/lint/gates, all of which are green). They should be closed as quick, mechanical housekeeping before Stage 5 (audit) / merge-handoff, alongside recording red-team's own named precedence-drill result once it is run.

**This round IS terminal for the rule-16(c) stall.** The Manager can proceed to Stage 4. Before Stage 5/merge-handoff: (1) add a decisions.md row for the round-3 council + its fix-now outcome, citing all three persisted round-3 reports; (2) add the CHANGELOG.md entry for Issues #99/#100/#101/#96-escalation; (3) add the one backlog.md line the architecture-council's condition 3 asked for; (4) run red-team's named CLAUDE_PROJECT_DIR precedence drill before PreToolUse activation (not before this commit) and record its result in the same new decisions.md row or a follow-up one.

**Single next action:** `story-implementer`/Manager adds the missing decisions.md row (round-3 council + outcome) and CHANGELOG entry, and the one backlog.md line for the architecture-council's condition 3 -- all three mechanical, non-adversarial edits -- then proceeds to Stage 4.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, ranked by blast radius):
1. [ISSUE][MED][code-traced] No docs/decisions.md row and no CHANGELOG.md entry exist for the round-3 council or its resulting fix-now work (Issues #99/#100/#101/#96-escalation), and red-team's own named next action (record the CLAUDE_PROJECT_DIR precedence-drill result in decisions.md as a pre-activation Milestone #24 gate) has nowhere to land as a result. First council in this project's history without its own decisions.md row. Filed as GitHub Issue #103 (amended same-turn with this addendum).
2. [ISSUE][MED][code-traced] Architecture-council's own APPROVE-WITH-CONDITIONS verdict named condition 3 (an explicit docs/backlog.md/S6-intake line on the section-0.4-property-2 NOT-COVERED question) -- grep-confirmed absent from docs/backlog.md as shipped. Filed as GitHub Issue #104.
3. [CLEAN][demonstrated] CLAUDE_PROJECT_DIR fixture-path reachability (the round's one open item): independently reproduced the same experiment red-team's round-3 R5 already ran and correctly calibrated as SUSPICION/MED/UNPROVEN-pending-verification (non-blocking, basis: assumption); app-security's round-3 independently rules it CLEAN on separate grounds (same pre-existing seam, not a new trust boundary). My own check corroborates both; not re-raised as a new or blocking finding -- an earlier duplicate Issue I filed before locating both round-3 reports (#102) is closed as not-planned, same session, with a comment pointing at red-team's prior finding.
4. [CLEAN][demonstrated] N2 (expiresOn exact-value pin, Issue #100) correctly fixed -- cross-checked against my own read and red-team's independent mutation.
5. [CLEAN][demonstrated] N3 (post-expiry unlock-hint cause, Issue #101) correctly fixed via a structured cause key -- cross-checked against red-team's own follow-the-hint drill.
6. [CLEAN][demonstrated] Issue #96 escalation correctly relocated to its pre-round-2 safe-stuck direction -- the most thoroughly re-verified finding this round (my own read, red-team's mutation test, app-security's 7/7 from-scratch repro all agree).
7. [CLEAN][code-traced] Unicode sanitizeDetail gap correctly left unfixed (never one of the council's four mandated sub-fixes); app-security's own round-3 pass found and same-turn-fixed a real tracking-honesty gap on this item (Issue #97 comment claimed a backlog filing that did not exist) -- independently re-confirmed the fix is now accurate.
8. [CLEAN][code-traced] Zero new ADR collisions across the full 35-ADR catalog against all five round-3 files; ADR-0021 kernel-purity boundary unaffected.
9. [CLEAN][demonstrated] npm test: 547/547 pass, 0 fail, 0 skipped, real run this session -- matches both red-team's and app-security's own independent counts exactly.
counts (checksum): issues=2 suspicions=0 clean=7
evidence (checksum): demonstrated=5 code-traced=4 derived=0
checks=npm test: 547 pass/0 fail/0 skipped (real run, this session, matching both red-team's and app-security's own round-3 counts); ad-hoc CLAUDE_PROJECT_DIR reachability check against the live, unmodified hooks/sessionstart-tool-enum.mjs (corroborates red-team's own R5, not a new result); node docs/adr-cache.mjs --ensure: CACHE=HIT (fp 83b2e3e, 35 ADRs, unchanged)
adr=HIT(35, whole catalog)
report=docs/reviews/s5-central-classification-cross-domain-round3-2026-09-07.md
