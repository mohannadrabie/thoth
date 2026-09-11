# qa14-marker-redesign — Cross-Domain Review, ROUND 2 re-confirm (Ra)

**Date:** 2026-09-11
**Scope:** fix/qa14-marker-redesign @ 95e3a21 (round-1 fix-now build, committed), vs. round-1 baseline 64a18ed, vs. master c598312
**Tier:** CRITICAL (docs/.maat-state.json, scope qa14-marker-redesign, reviewRoundsSinceClean/reviewRoundsTotal both now 1)
**Reviewer:** cross-domain-reviewer (Ra)
**My own round-1 report:** docs/reviews/qa14-marker-redesign-cross-domain-2026-09-11.md (APPROVE-WITH-CONDITIONS: #150, #151, one MED test-flake suspicion)

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp 83b2e3e, CACHE=HIT

## Who else ran this round

red-team (docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md, verdict go) and code-reviewer
(docs/reviews/qa14-marker-redesign-code-round2-2026-09-11.md, verdict SHIP) both already completed their
round-2 passes and posted issue comments/closures before I started mine. Both are exceptionally thorough --
their own independent instrumentation (shared real-gh caches, three pinned classifier snapshots, targeted
mutations, byte-level md5 scope checks) covers the code-correctness ground in more depth than my own lane
would add on top of it. Per PRINCIPLES rule 9's redundancy discipline, I do not relitigate what they already
demonstrated -- I independently re-derive the numbers that matter (as a second, blind measurement) and focus
on what neither lane owns: the whole ADR catalog, and the seams between prose, instrument, and consumer.

## Task 1 -- Re-verify Issue #150 (marker-corpus-probe.ts)

Registration confirmed real. src/qa/completeness-claim-checker.ts line 51:

  "qa14-marker-corpus-probe": { cmd: "node", args: ["src/qa/marker-corpus-probe.ts"] },

Ran it myself, repeatedly, isolated from any other tool call:

  node src/qa/marker-corpus-probe.ts HEAD
  [QA-14 marker-corpus-probe] PASS: marked=422 unmarked=427 total=849 (217 files scanned)

7 separate invocations (5 CLI + 2 direct calls to the exported computeMarkerCorpusStats) all agree at
422/427/849. This does NOT match the shipped, committed claim in CHANGELOG.md/docs/STATE.md/
docs/decisions.md: marked=380 unmarked=416 total=796 (approx 52 percent). I independently hit the exact
same number red-team's own round-2 re-confirm found (docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md,
finding 2) -- two independent reviewers, two different methodologies, same number. This corroborates, it
is not a new finding -- already filed and open as #150, correctly not closed by red-team, and I have added
my own confirming comment on the issue rather than duplicate-filing.

Root cause, independently confirmed via an exclusion experiment (not in red-team's report): scanning the
full tree excluding just docs/decisions.md, docs/STATE.md, and CHANGELOG.md gives total=648, vs. 849
including them -- those 3 self-referential files alone carry 201 of the tree's 849 bare-#N citations. The
claimed 796 sits between these two boundaries, consistent with the number having been captured mid-write,
before the round's own closing prose (which discusses issue numbers #149-#154, #137, #143-145 repeatedly)
was finalized into the same commit. This is the same self-referential-corpus effect docs/STATE.md point 7
already discloses for the full-tree reference-resolver figures -- real, structural, not a fabrication -- but
it was not yet disclosed for this specific marker-corpus-probe figure (point 5 has no such caveat). Not
filing a new issue -- this is the same root cause as the already-open #150, not a distinct defect; noted
here for the eventual close-out fix (a QA-15 completeness marker, per red-team's own recommended single next
action) to also cover point 5's figure, not just the full-tree one.

Determinism note (new observation, not in either other report): the very first invocation this session gave
a different split, same total: marked=403 unmarked=446 total=849. 7 subsequent invocations (CLI and
direct-call both) were all stable at 422/427/849. scanReferences's dedup and list-continuation state (seen,
markedListState) is function-scoped per call (reference-resolver.ts lines 342-343), so this cannot be
cross-file state leakage; classification is a pure function of each file's text. I could not force this to
recur and cannot identify a code-level mechanism for it -- flagging it as a LOW, unreproduced suspicion
(derived, demonstrated once, does not gate) that the very first cold invocation of these scan scripts in a
session showed a one-off, non-recurring instability, mirroring (in a different mechanism) round 1's own
once-only npm test flake and this round's own once-only full-tree total swing (3424 on the first run, stable
3427 thereafter -- see Task 7). Recommend whoever verifies next also take their FIRST measurement as
provisional and re-run once before trusting it, until this pattern either recurs (worth root-causing) or
never does again (safe to dismiss as environment noise).

## Task 2 -- Re-verify Issue #151 (docs/STATE.md)

Read docs/STATE.md lines 1-42 in full. The 8-item round-1 fix-now summary (dedup fix, dash tests, seeding
fix, tight-dash guard, probe commit, this resume point, full-tree re-measurement, flake non-repro) is a
real, specific, seeded-from-actual-state entry -- not a generic template -- consistent with CLAUDE.md's
"seed in-flight threads at their real current state" convention. One stale claim, already found and
correctly NOT reopened by red-team: line 4/line 6/line 21 describe the round as "not yet committed" and
name committing as the still-pending "single next action" -- true when the prose was written, false at the
commit (95e3a21) that actually ships it. Cosmetic (the substantive content -- the 8-item list, verification
counts -- is accurate); does not mislead about what is actually done, only about the commit mechanics.
Already closed by red-team with this exact caveat recorded; I added my own independently-arrived-at
confirming comment on #151 (same finding, reached separately) rather than reopening. Editorial, not a new
finding.

## Task 3 -- Re-verify the flaky-test suspicion

Ran npm test 10x myself (unmodified working tree, isolated from other tool calls): 722/722 pass, 0 fail,
0 skipped, all 10 runs. No reproduction of round 1's one-off reference-resolver.test.ts:646 failure. The
build's own framing ("not reproduced... reported honestly as unreproduced, no code change made on the
strength of a single non-reproducing anomaly") matches what I independently observe -- it did not overclaim
"fixed" for something it never saw fail, and it did not silently drop the finding either (still named, still
open as a suspicion, in docs/STATE.md point 8). code-reviewer's own round-2 pass adds a further 6 clean runs
on top (16 clean runs total across both build and code-reviewer). Honest framing confirmed.

## Task 4 -- Whole-ADR-catalog pass, independently re-verifying ADR-0008 NOT-APPLICABLE

Read adr/devops/0008-cicd-gates-and-policy-as-code.md in full (not the cached JSON summary). Its entire
scope, stated in its own Decision section, is two named gate families: IaC gates (format/lint on CDK
TypeScript, cdk synth, cdk-nag, tag validation, cdk diff, cost check) and application/supply-chain security
gates, explicitly enumerated by its own table -- Gitleaks, Semgrep, Trivy (dependency/IaC and
container-image), Cosign, SBOM, OWASP ZAP. The Ownership table (lines 110-119) names exactly two owning
teams (Security/AppSec, Platform/DevOps) against exactly these named tools/configs. The "ratchet, do not
lower gate thresholds... never loosen without a superseding ADR" rule (lines 121-122, restated in Rules for
agents line 135) is stated in the direct context of, and only makes sense applied to, these named tools'
thresholds and rule packs -- none of which QA-14/reference-resolver.ts is. This project's home-grown QA
instruments (QA-01..QA-17) are not named anywhere in ADR-0008, and this round's diff touches none of
ADR-0008's actual gate surfaces (.github/workflows/ci.yml is untouched this round -- confirmed via
git diff 64a18ed..95e3a21 --stat, not in the 13-file change list).

Verdict: NOT-APPLICABLE, independently reconfirmed from the ADR's own text -- not deferred to the Manager's
ruling or to round 1's own re-confirmation. Same conclusion as docs/decisions.md's triage-ruling row.

Also re-checked the full 35-ADR catalog against this round's diff (13 files: CHANGELOG.md, .maat-state.json,
REVIEW_LOG.md, STATE.md, decisions.md, 3 new review report files, completeness-claim-checker.ts (+1 line),
marker-corpus-probe.ts/.test.ts (new), reference-resolver.ts/.test.ts). No IaC, no secrets, no IAM, no
kernel/guard/evidence-trail surface, no CI config -- same conclusion as round 1 for every other ADR: none
apply. No collision.

## Task 5 -- Cross-domain seams on this round's new code

marker-corpus-probe.ts as a new consumer of reference-resolver.ts's exports. It imports scanReferences and
shouldScanFile directly (a NEW consumer relationship round 1's report could not check, since this file did
not exist yet). Read reference-resolver.ts lines 331-343: the dedup (seen: Map) and list-continuation guard
(markedListState) are both declared inside scanReferences, fresh per call -- no module-level or cross-file
shared state. marker-corpus-probe.ts's own loop calls scanReferences once per file (main(), sequential
await readFile plus call), same pattern as reference-resolver.ts's own two-pass wiring. The dedup-shadowing
fix (#152) is correctly scoped and correctly inherited by the probe -- it can only ever upgrade a
same-file, same-raw-string duplicate, never leak across files, so the probe's per-file independent counting
is unaffected by ordering. No seam defect.

Other consumers of the touched exports: re-ran round 1's own tree-wide import search (grep for every export
of reference-resolver.ts beyond its own main()/test file) -- unchanged from round 1: only
completeness-claim-checker.ts's KNOWN_INSTRUMENTS entry (subprocess-invoked, dormant, no
[[completeness: cmd="qa-reference-resolver" ...]] marker exists anywhere in tracked docs) and now
marker-corpus-probe.ts (checked above). No live, ordering-sensitive consumer outside the file itself.

## Task 6 -- Issue Discipline check

Issue #149: CLOSED -- code-reviewer, independently mutation-verified, clean.
Issue #150: OPEN -- red-team plus my own independent repro agree: published triple does not reproduce;
correctly not closed.
Issue #151: CLOSED -- red-team plus my own independent confirmation, clean (1 cosmetic staleness noted, not
reopened).
Issue #152: CLOSED -- red-team, independently mutation-verified plus full-tree re-measured (0/422
shadowed), clean.
Issue #153: CLOSED -- red-team, independently mutation-verified plus 118 citations individually adjudicated,
clean.
Issue #154: OPEN -- red-team found the "never" replacement claim itself still false at ship commit,
correctly not closed.

No duplicate issue risk found: I checked gh issue list --search before filing anything and found every
finding I could independently reproduce already tracked under its existing number, with comments from
red-team (and now me) rather than fresh issues. I filed zero new issues this round -- every seam I checked
either came back clean or was already correctly tracked by red-team/code-reviewer.

## Task 7 -- Baseline gates + independent control-figure reproduction

npm run typecheck -> clean (tsc --noEmit, exit 0)
npm run lint -> clean (eslint ., exit 0)
npm test x10 -> 722/722 pass, 0 fail, 0 skipped, every run (see Task 3)

Full-tree, NEW classifier (node src/qa/reference-resolver.ts 0000...0 HEAD): first run "276 of 3424"
failed; 4 subsequent repeats all stable at "276 of 3427" (427 unclassified). Claimed: 275/3339. Blocking
count off by 1, total off by +88 (2.6 percent).

Full-tree, OLD classifier (swapped in git show c598312:src/qa/reference-resolver.ts temporarily, restored
immediately after, git diff confirmed clean before continuing): "304 of 3358" failed. Claimed OLD:
295/3270. Same +88 total delta as the NEW-classifier comparison above -- this consistency (identical
magnitude on both OLD and NEW runs, taken minutes apart, on a byte-identical clean working tree) rules out
classifier-behavior drift as the cause and confirms it is pure corpus growth: decisions.md/STATE.md/
CHANGELOG.md kept growing with more #N mentions between when the 3339/3270 figures were captured mid-build
and when the commit was sealed -- the same disclosed self-referential effect docs/STATE.md point 7 already
names, now precisely bounded at +88 citations tree-wide, and further compounded for MY measurement
specifically by red-team's and code-reviewer's own round-2 report files (both already present in my working
tree, themselves citing more #Ns) landing between the build's commit and my own re-run.

The invariant that actually matters -- "zero new distinct blocking-failure reasons" -- reproduces exactly,
checked more rigorously than a raw count: categorizing the OLD run's 304 failures gives 12 cross-repo-issue
plus 45 unparseable plus 247 unresolved-authority; the NEW run's 276 gives 12 cross-repo-issue plus 45
unparseable plus 219 unresolved-authority (plus 427 unclassified, non-blocking). cross-repo-issue and
unparseable are byte-identical counts (untouched by this redesign, as expected -- different code path);
only unresolved-authority dropped (247 to 219). A full line-level set-diff of both runs' distinct
blocking-detail lines (sort -u, comm -13) gives 0 lines in NEW's blocking set that are not already in OLD's
-- "after" is a genuine strict subset of "before", independently reproduced at the individual-citation-line
level, not just the category level.

Diff-scope (node src/qa/reference-resolver.ts c598312 64a18ed -- the documented file-list bound, current
classifier plus content): "24 of 552" failed. Claimed: 25/552. Total matches exactly; blocking off by 1 --
plausibly the same 1-citation self-referential drift already named in docs/STATE.md point 7 ("the
occurrence-count increase... is #000 inside docs/decisions.md's own row 63... quotes red-team's repro
verbatim"), now one row later after round 1's further edits. Close enough to call reproduced.

Conclusion: every raw total count drifts by a small, well-explained, self-referential margin (this is now
the THIRD story in this project's history -- see qa1415fix's own round-2 cross-domain report -- where this
exact corpus-measures-its-own-documentation effect recurs); the substantive invariant (no new blocking
failure class, no regression) reproduces exactly and rigorously. Same conclusion red-team's own round-2
report reaches independently.

## Coverage gaps named

None new this round. Round 1's naming of "close-out prose is nobody's lane by default" stands as the
standing rationale for why this pass exists; this round that lane is well-covered -- by me (docs/STATE.md,
CHANGELOG.md, decisions.md, the marker-corpus-probe figure) and, unusually thoroughly, by red-team's own
round-2 pass, which also attacked the close-out prose claims directly (findings 1, 2, 5). No file type or
concern in this round's 13-file diff goes unowned by some reviewer's lane.

## Verdict

APPROVE-WITH-CONDITIONS, consistent with red-team's own "go" and code-reviewer's own "SHIP" -- no ADR
collision, no new seam defect, no code-correctness regression found by any of the three lanes this round.
Conditions (both already open, already correctly tracked, not new):

1. #150 -- marker-corpus-probe's published figure does not reproduce at ship commit; fix via a QA-15
   completeness marker referencing the real instrument (red-team's own recommended single next action),
   covering both the point-5 marker-corpus figure and the point-7 full-tree figures.
2. #154 -- the "never" replacement claims (R4/R5, comma/whitespace sub-case) are still false at ship
   commit; either close the residual or correct the claim's wording to the measured, honest figure.

Neither condition is a gate-correctness regression -- both are documentation/instrument-trust debt on prose
describing an already-correctly-behaving classifier (the classifier itself, independently re-verified
line-by-line above, produces zero new blocking failures and the dedup/seeding fixes are correct and
properly scoped). Ship is not blocked on either; both should close before this branch is considered fully
done.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by blast radius):
1. [ISSUE][MED][demonstrated] Issue #150 (already open, not new): independently reproduced red-team's finding -- published marker-corpus-probe triple (380/416/796) does not reproduce at ship commit 95e3a21 (real: 422/427/849, 7 stable repeats); root cause additionally traced via an exclusion experiment (decisions.md/STATE.md/CHANGELOG.md alone carry 201 of 849 total citations) -- self-referential corpus growth, not a fabrication. Commented on #150, not closing, not re-filing.
2. [ISSUE][MED][demonstrated] Issue #154 (already open, not new): independently re-confirmed red-team's finding that the shipped "never" replacement claims are still false at 95e3a21 -- not re-filing, red-team's own tracking stands.
3. [SUSPICION][LOW][demonstrated] First cold invocation of both marker-corpus-probe.ts (403/446/849 once, then 7x stable at 422/427/849) and the full-tree reference-resolver.ts run (3424 once, then 4x stable at 3427) each showed a one-off value on the session's first call that did not recur -- plausible environment/cold-cache artifact, no code-level mechanism identified (dedup/list-continuation state is function-scoped, confirmed by reading the source), not reproduced enough to root-cause. Recommend treating any single cold measurement as provisional.
4. [CLEAN][code-traced] ADR-0008 NOT-APPLICABLE independently re-confirmed by reading the ADR's own Decision/Ownership text directly (not the cached summary, not deferred to the Manager's ruling) -- its ratchet rule and Ownership table scope to the named IaC/supply-chain tool stack only; this round's diff does not touch .github/workflows/ci.yml or any other ADR-0008 surface.
5. [CLEAN][code-traced] Whole 35-ADR catalog re-checked against this round's 13-file diff -- no collision, nothing IaC/secrets/IAM/kernel/guard/evidence-trail-relevant touched.
6. [CLEAN][code-traced] marker-corpus-probe.ts (new consumer of scanReferences/shouldScanFile) correctly inherits the #152 dedup fix -- dedup/list-continuation state confirmed function-scoped (no cross-file leakage) by reading reference-resolver.ts lines 331-343; no seam defect from the dedup-shadowing fix reaching outside reference-resolver.ts itself.
7. [CLEAN][demonstrated] Flaky-test suspicion (round 1): independently re-ran npm test 10x, 722/722 pass every time, no reproduction -- build's "unreproduced, not claimed fixed" framing confirmed honest.
8. [CLEAN][demonstrated] "Zero new distinct blocking-failure reasons" invariant independently re-verified more rigorously than a raw-count diff: OLD/NEW full-tree runs categorized (cross-repo-issue/unparseable both byte-identical counts; only unresolved-authority dropped) and line-level set-diffed (comm -13 empty -- 0 NEW blocking lines not already in OLD).
9. [CLEAN][code-traced] Issue Discipline: #149/#151/#152/#153 correctly closed by red-team/code-reviewer with substantive verification comments; #150/#154 correctly left open; no duplicate issue filed by anyone this round, including me (0 new issues filed).
counts (checksum): issues=2 suspicions=1 clean=6
evidence (checksum): demonstrated=6 code-traced=3 derived=0
checks=npm test 722/722 pass 0 fail 0 skip (10 runs); npm run typecheck clean; npm run lint clean; node src/qa/marker-corpus-probe.ts HEAD -> 422/427/849 (7 repeats, 1 differed on first cold run); node src/qa/reference-resolver.ts 0000...0 HEAD (NEW) -> 276/3427 (stable after 1st run); OLD classifier (c598312, swapped in/out, working tree confirmed clean after restore) -> 304/3358; node src/qa/reference-resolver.ts c598312 64a18ed -> 24/552; line-level set-diff of OLD/NEW blocking details -> 0 new lines
adr=HIT(35, whole catalog)
report=docs/reviews/qa14-marker-redesign-cross-domain-round2-2026-09-11.md
