# Cross-Domain Review - Round 2 Re-Confirm - qa1415fix (branch fix/qa1415-issue-existence-and-decisions-scope)

Reviewer: cross-domain-reviewer (Ra)
Date: 2026-09-10
Commit under review: bc2b984 (parent d05ca33, my own round-1 APPROVE-WITH-CONDITIONS commit)
Tier: CRITICAL (unchanged)
Reviewers seated this scope: red-team (no-go on round 1, re-confirming round 2 in parallel with me) + infra-security-reviewer (APPROVE round 1) + cross-domain-reviewer (me)

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog - whole catalog read, both domains, unfiltered (PRINCIPLES.md rule 9).

## Ground covered by other lanes (not re-covered here)

- red-team: adversarial re-verification of all 4 fixed findings (#139 regex boundary, #140 wiring test, #141 rate-limit cap, #142 DEFAULT_FILES ratchet) - mutation re-application, its own re-measurement of the regex fix. Its round-2 report was not yet on disk at the time of this review (running in parallel per task brief); I did not wait on it, and did not duplicate its specific attack surface (regex correctness, mutation survival) - I re-ran the same real commands myself as independent corroboration only, not as a re-attack.
- infra-security-reviewer: round-1 APPROVE on the gh-backed lookup / CI permissions widening; nothing in round 2 touches .github/workflows/ci.yml or credentials, confirmed by git diff --stat d05ca33 bc2b984 (ci.yml absent from the changed-file list) - so there is nothing new in its lane to re-check.

My job here is task 1-5 as given: Issue #138 resolution + decisions.md honesty, CHANGELOG/decisions.md/Issue honesty check, whole-catalog ADR re-scan on the new code shapes, test-coverage adequacy on the new code paths, and Issue Discipline confirmation on all 5 closures.

## 1. Issue #138 - genuinely resolved?

Confirmed via git diff d05ca33 bc2b984 -- docs/decisions.md: the 2026-09-10 "build complete" row's closing clause was changed from the false claim that both reference-resolver.ts and completeness-claim-checker.ts exit 0 at HEAD, to the accurate statement that only completeness-claim-checker.ts exits 0, plus an inline Correction (round 2, Issue #138) clause explaining exactly what the row originally, falsely, claimed and why. Re-verified directly: npm run qa:completeness-claims exits 0; npm run qa:reference-resolver -- HEAD~1 HEAD exits 1, 27 failing (Issue #137's own pre-existing gap, unchanged). The row now matches reality.

Was correcting in place (vs. appending a new row) the right call? Yes, for this specific case, though it deviates from the letter of docs/decisions.md's own stated convention. That convention ("Supersede in place... strike the old row through and append SUPERSEDED by...") is written for a later decision reversing an earlier one - a real judgment call getting overturned by new information, where preserving the original judgment's visibility matters for audit. This is a different shape: a same-session, unmerged, never-activated status/verification row that simply mis-stated a fact about its own commit before anyone downstream read or acted on it. Three things make in-place correction the better call here, not a violation of the "keep history, never delete it" spirit:
1. Nothing external (a merge, a later decision, a human ruling) was ever built on the false claim - the row was never "activated" in the sense that matters (PRINCIPLES rule 14 hydration, decisions-archive rollover).
2. The correction is not silent - it explicitly names what the row originally, falsely, said and why, so a reader of the diff (or git blame/git log -p) still sees the error and the fix, just without literal strikethrough markup. That satisfies "never delete it" in substance.
3. My own round-1 report's suggested fix language ("correct the row's wording pre-merge") is exactly what was done - a strikethrough+new-row treatment for a same-session pre-merge fact-error would have added a second near-duplicate row describing the identical build-complete event, more confusing, not less.

This does NOT set a precedent for editing an activated (merged, review-back-date-passed) row - that case should follow the file's literal strikethrough convention. Worth a one-line clarifying addendum to docs/decisions.md's own Conventions section distinguishing "in-flight, unmerged row, same session" from "activated row" - a backlog-worthy documentation gap, not a blocker.

## 2. CHANGELOG.md / decisions.md / Issue honesty check

Re-ran every load-bearing claim myself:

- npm test -> 684/684 pass, 0 fail, 0 skipped. Matches CHANGELOG's claim exactly.
- npm run qa:completeness-claims -> exit 0, "2 file(s) checked, all completeness claims verified." Matches.
- npm run qa:reference-resolver -- HEAD~1 HEAD -> exit 1, 27 of 572 citations fail. CHANGELOG claims "27 failing... unchanged" on diff scope - the failing count matches exactly; the denominator differs from round 1's own 481 (expected and correctly attributed to the boundary fix now classifying far more citations at all).
- npm run qa:reference-resolver -- (all-zeroes sha) HEAD (full-tree) -> exit 1, 253 of 3050 citations fail. CHANGELOG's round-2 entry claims 248/2967. This is a real, measured discrepancy (5 more failures, 83 more citations examined than claimed). Root cause, confirmed by inspection: the full-tree scan now also examines the three review-report files (docs/reviews/qa1415fix-cross-domain/red-team/infra-security-2026-09-10.md) that were committed into the same bc2b984 commit as the code fix - those reports are themselves full of quoted citation-shaped strings (issue numbers, ADR ids, file:line references), and the full-tree count in the CHANGELOG entry was evidently measured before all three reports were in the tree being scanned. This is not an overclaim in the sense of hiding a defect - the load-bearing, CI-gating number (diff-scope 27 failing) is exactly right - but it is a stale full-tree figure, the same "measured-then-the-tree-moved-under-it" shape this project's own cifix round-3 report already named and treated as Editorial. Verdict: Editorial, not blocking - logged here per the Evidence Policy's own example of this exact defect class; no re-review required, a plain follow-up edit if anyone touches that CHANGELOG paragraph again.
- No claim of "CI fixed" or "fully resolved" appears anywhere in round 2's CHANGELOG/decisions.md text - Issue #137's own gap is named, by number, as unchanged and untouched in both the CHANGELOG entry and the REVIEW_LOG row. No overclaim found on this axis.
- docs/REVIEW_LOG.md: round 2's three new rows are pure appends (git diff shows only + lines at the file's tail) - the append-only convention is respected.
- docs/.maat-state.json: reviewRoundsSinceClean/reviewRoundsTotal incremented 0 to 1, consistent with round 1 not being clean (red-team no-go).

## 3. Whole-catalog ADR re-scan on round-2's new code shapes

New shapes: classifyMilestone + MILESTONE_CANDIDATE_RE (new citation kind), resolveIssueCitations (extracted, exported, Runner-injected), DEFAULT_MAX_DISTINCT_ISSUES/cap logic. Read against the full 35-ADR catalog, both domains (no devops ADR applies - nothing here touches IaC/CDK/pipeline/cost/tagging, unchanged from round 1).

- SE ADR-0003 (SOLID): resolveIssueCitations(fileTexts, baseDeps, repoSlug, runner, maxDistinctIssues) injects its only I/O-performing dependency (runner) via parameter, never instantiates it internally - compliant, in fact a direct fix of what could have been a violation.
- SE ADR-0002/0003 (layering): all new code stays inside src/qa/reference-resolver.ts, a single-purpose CLI/QA-instrument file with no framework/ORM/HTTP boundary to cross - same clean verdict as round 1, unchanged.
- SE ADR-0005 (testing strategy - "happy path, error paths, and boundaries"): mostly well covered (see section 4) but the cap's own boundary - a malformed QA14_MAX_ISSUES value - has zero test coverage and no code-level guard. See section 4 for the demonstrated gap. This is the one place I would flag as a genuine, if narrow, ADR-0005 shortfall introduced this round - not a "collision" against a domain a seated reviewer owns (no code-reviewer/architecture-reviewer is seated at this tier, so testing-boundary completeness for this file falls to me by elimination, same coverage-gap shape I named in round 1), and it caps at LOW per the Evidence Policy (near-zero current exposure - see section 4).
- CLAUDE.md hard rule (no hand-derived completeness claims): classifyMilestone always returns verdict "resolved" with an honest reason string ("recognized... not verified against a live milestone list in this pass") - this is a disclosed, scoped limitation, not a silent completeness claim. No violation; matches this project's own established disclosure pattern for Issue #137.
- No collision found in any ADR outside red-team's/infra-security-reviewer's lanes that this round's diff newly triggers.

## 4. Test-coverage adequacy on the new code paths

The 14 new tests are well-targeted: milestone recognition + non-double-count with the word-form issue pass, the hex-color non-regression, resolveIssueCitations' real end-to-end wiring (positive + negative control), the cap's loud-fail-zero-gh-calls path, and the cache-dedup-to-one-call path. I re-ran npm test myself: 684/684, 0 fail, 0 skipped - confirmed, not taken on the claim.

One real, demonstrated gap in the cap logic, distinct from anything red-team's report (regex/mutation/wiring-focused) would surface: DEFAULT_MAX_DISTINCT_ISSUES = Number(process.env.QA14_MAX_ISSUES ?? 300) (src/qa/reference-resolver.ts:334) has no Number.isFinite guard. A malformed value (e.g. QA14_MAX_ISSUES=not-a-number, a plausible operator typo) makes the constant NaN; every subsequent comparison queriedIssueNumbers.size > maxDistinctIssues is false for any NaN operand, so the cap never trips, silently reverting to fully-uncapped gh calls with no warning - precisely the failure mode Issue #141's own fix exists to prevent, now reachable through its own new configuration surface.

Demonstrated directly (a scratch script importing the real module with QA14_MAX_ISSUES set to a non-numeric string, then calling the real exported resolveIssueCitations with 3 distinct issue numbers and a fake Runner counting its own calls): result was DEFAULT_MAX_DISTINCT_ISSUES = NaN, capExceeded = false, gh calls made = 3, distinct = 3 - the cap silently did not fire even though 3 is greater than any sane small cap value, because "3 > NaN" evaluates to false in JavaScript.

Exposure: 0% measured today - grep -n "QA14_MAX_ISSUES" .github/workflows/ci.yml returns no match; nothing in this repo's CI currently sets this variable. Basis: assumption (requires a future operator misconfiguration that has not happened). Per the Evidence Policy, an assumption-basis exposure caps this at LOW despite the defect itself being demonstrated, not merely derived. Trivial fix if anyone wants it now: guard with Number.isFinite(raw) && raw > 0, falling back to 300 otherwise, plus one regression test. Not blocking; not filed as a GitHub Issue (LOW severity, below this project's own HIGH/MED filing trigger) - named here for the record and worth a docs/backlog.md line if this file is touched again.

## 5. Issue Discipline - all 5 closures

Checked via gh issue view directly, not taken on the CHANGELOG's word:

| # | State | stateReason | Comment before close | Comment prefix |
|---|---|---|---|---|
| 138 | CLOSED | COMPLETED | Yes (1s before close) | [story-implementer] |
| 139 | CLOSED | COMPLETED | Yes (1s before close) | [story-implementer] |
| 140 | CLOSED | COMPLETED | Yes (1s before close) | [story-implementer] |
| 141 | CLOSED | COMPLETED | Yes (1s before close) | [story-implementer] |
| 142 | CLOSED | COMPLETED | Yes (1s before close) | [story-implementer] |

All 5 followed the discipline correctly: comment naming the fix commit, then close with state_reason completed (not the bare default), correct identity prefix. No silent closures. Labels correct (bug + severity:high/severity:med + qa, #141/#142 also carry ci).

One inconsistency, self-attributable to my own round-1 filing, not a round-2 defect: Issue #138 (filed by me, round 1) has milestone unset, while #139-#142 (filed by red-team, round 1) all carry milestone 24 ("S6 - Policy centralization") - the same milestone the parent Issue #120 carries. Per this project's Issue Discipline, milestone should be set "whenever the finding is against code touched within the CURRENT ratified scope... that home is unambiguous." #138 was exactly as unambiguous as #139-142 (same scope, same diff) and I omitted it at filing time. Editorial / self-disclosed, non-blocking - the same postmortem-worthy class this project already named once (2026-09-07, Issues #90-#98). Not re-opening or editing the Issue body (immutable-after-creation); noting it here for the record only.

## Coverage gaps named

- Testing-boundary completeness for src/qa/reference-resolver.ts's new cap-configuration surface (the NaN gap, section 4) falls to no seated lane by default (no code-reviewer/architecture-reviewer this tier) - caught here, LOW, not filed.
- docs/decisions.md's own Conventions section does not currently distinguish "in-flight/unmerged, same-session row" from "activated row" for correction purposes (section 1) - a documentation gap worth a one-line addendum, not a blocker.
- Both gaps are named, not filed as new GitHub Issues (both LOW, below this project's HIGH/MED filing trigger).

## Verdict

APPROVE.

Issue #138 is genuinely resolved and the in-place correction was the right call for a same-session, unmerged row. All 4 red-team findings (#139-#142) are code-traced and independently re-confirmed by my own re-run of the same real commands (684/684 tests, qa:completeness-claims exit 0, qa:reference-resolver diff-scope unchanged at 27 failing). No ADR collision introduced by round 2's new code shapes. One new LOW finding (the QA14_MAX_ISSUES NaN gap) is demonstrated but has zero measured current exposure and does not gate. One Editorial full-tree-count staleness in CHANGELOG.md, non-blocking. No dishonesty or overclaiming found in CHANGELOG.md/decisions.md/Issue closures.

## Next action

None gating. Optional, non-blocking follow-ups for a future touch of this file: (a) guard DEFAULT_MAX_DISTINCT_ISSUES against NaN/non-positive input, (b) refresh the full-tree citation-count figures in CHANGELOG.md's round-2 entry to the current real numbers (253/3050) if that paragraph is ever edited again, (c) add the "in-flight vs. activated row" distinction to docs/decisions.md's Conventions section.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius, status [ISSUE]/[SUSPICION]/[CLEAN], severity on ISSUE/SUSPICION, evidence tag):
1. [ISSUE][LOW][demonstrated] src/qa/reference-resolver.ts:334 DEFAULT_MAX_DISTINCT_ISSUES = Number(process.env.QA14_MAX_ISSUES ?? 300) has no Number.isFinite guard - a malformed env value yields NaN, silently disabling Issue #141's own loud-fail cap (demonstrated: 3 gh calls made, capExceeded=false, with QA14_MAX_ISSUES set to a non-numeric string); exposure 0% measured (grep confirms CI sets nothing today), basis assumption; fix: Number.isFinite guard + one regression test. Not filed (below HIGH/MED trigger).
2. [ISSUE][LOW][code-traced] CHANGELOG.md's round-2 entry claims full-tree "248/2967" citations failing; a fresh real re-run at HEAD measures 253/3050 - stale because the 3 review-report files landed in the same commit as the code fix and are themselves citation-rich. Load-bearing diff-scope number (27/572) is exact and unaffected. Editorial, non-blocking.
3. [ISSUE][LOW][code-traced] Issue #138 (filed by me, round 1) has milestone unset while sibling Issues #139-#142 (same scope) all carry milestone 24 - my own round-1 filing inconsistency, self-disclosed, not re-opened (Issue bodies are immutable).
4. [CLEAN][demonstrated] Issue #138 genuinely resolved: docs/decisions.md's 2026-09-10 row no longer claims reference-resolver.ts exits 0; re-verified live (qa:completeness-claims exit 0, qa:reference-resolver exit 1/27 failing, matches disclosure).
5. [CLEAN][derived] In-place correction of the decisions.md row (vs. strikethrough+new-row) was the right call for a same-session, unmerged, never-activated row - correction text explicitly names what was false, satisfying "never delete history" in substance; does not set precedent for editing an activated row.
6. [CLEAN][demonstrated] All 4 red-team round-1 findings (#139 regex boundary, #140 wiring test, #141 rate-limit cap, #142 DEFAULT_FILES ratchet) independently re-confirmed via my own re-run: npm test 684/684/0/0; qa:completeness-claims exit 0; qa:reference-resolver diff-scope exit 1, 27/572 (count unchanged from round 1's 27, denominator change explained and correct).
7. [CLEAN][code-traced] Whole 35-ADR catalog re-scanned against round-2's new code shapes (milestone kind, resolveIssueCitations extraction, cap logic) - no collision in any non-seated-lane ADR (SE-0002/0003/0005 checked in detail; devops ADRs N/A, no infra touched).
8. [CLEAN][demonstrated] All 5 Issues (#138-#142) closed per Issue Discipline: comment (correct [story-implementer] prefix) immediately before close, state_reason=COMPLETED, correct labels, no silent closures.
9. [CLEAN][code-traced] No "CI fixed"/"fully resolved" overclaim anywhere in round-2 CHANGELOG.md/decisions.md/REVIEW_LOG.md; Issue #137's gap named by number, consistently, as unchanged in every artifact.
10. [CLEAN][code-traced] docs/REVIEW_LOG.md's round-2 rows are pure appends (git diff shows only trailing + lines) - append-only convention respected.
counts (a CHECKSUM, MUST equal the lines listed above, never truncated): issues=3 suspicions=0 clean=7
evidence (a CHECKSUM over the tags above, MUST equal them, and MUST total the counts line): demonstrated=5 code-traced=4 derived=1
checks=npm test 684/684 pass 0 fail 0 skipped; npm run qa:completeness-claims exit=0; npm run qa:reference-resolver -- HEAD~1 HEAD exit=1 (27/572 failing, count unchanged from round 1); npm run qa:reference-resolver -- (zero-sha) HEAD exit=1 (253/3050 failing, real re-measurement vs CHANGELOG's stale 248/2967); scratch script demonstrating a non-numeric QA14_MAX_ISSUES disables the cap (capExceeded=false, 3 gh calls made)
adr=HIT(35, whole catalog)
report=docs/reviews/qa1415fix-cross-domain-round2-2026-09-10.md
