# Cross-Domain Re-Confirm (round 2) -- s1-closeout-164-154 (Issues #164 + #154)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-13
**Branch:** fix/s1-closeout-164-154 @ 713dbdd, base master @ ad196c5
**Diff scope (as instructed):** git diff b9fed71 713dbdd (round-1 build -> round-2 fix-now)
**Tier:** CRITICAL (unchanged, ratified docs/run-log.jsonl 2026-09-13T23:08:44)
**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23], fingerprint 83b2e3e -- unchanged from round 1. Read the WHOLE catalog again, not a lane slice.

## Who else is reviewing, and what ground they cover

Per docs/.maat-state.json: red-team + code-reviewer + cross-domain-reviewer, CRITICAL tier -- unchanged from round 1. Only this role own round-2 re-confirm report exists in docs/reviews/ as of this pass (code-reviewer and red-team round-1 reports are present; no round-2 counterpart from either yet). This report covers only this role own round-1 REWORK verdict re-confirm, per the dispatch instructions -- not a redo of code-reviewer or red-team lanes.

## Round-1 findings, re-confirmed against round-2 code

### Finding 1 [HIGH] (round-1) -- flaky two-subprocess byte-identity test -- CONFIRMED FIXED

Root-cause fix, code-traced: src/qa/marker-corpus-probe.ts:132-141 and src/qa/continuation-residual-probe.ts:176-192 both narrowed the blanket catch { continue; } to check err.code === "ENOENT" then continue, else throw err -- exactly the fix this role round-1 report recommended (option b), applied to both twins, not just the one that happened to flake.

Test fix, code-traced: marker-corpus-probe.test.ts regression test no longer spawns two live subprocesses and compares stdout; assertKnownArgs() now runs before any file-walk, so the regression test asserts a set of bad-argv shapes all fail loud in a single spawn each, plus a companion pure unit test with no I/O. continuation-residual-probe.test.ts matching test was reduced the same way (one spawn, asserting output shape, not byte-identity against a second live walk).

Demonstrated, this session, not taken on the build receipt own claim: independently re-ran the full suite 10 times beyond what the round-2 build itself already claimed (5x at Node default concurrency, 5x at --test-concurrency=64 -- higher than the build own --test-concurrency=32, a deliberately harder attempt to reproduce the original flake pattern):

```
run 1 (default):  fail 0, duration_ms 49114
run 2 (default):  fail 0, duration_ms 52824
run 3 (default):  fail 0, duration_ms 62668
run 4 (default):  fail 0, duration_ms 76525
run 5 (default):  fail 0, duration_ms 95272
run 1 (--test-concurrency=64): fail 0, duration_ms 92585
run 2 (--test-concurrency=64): fail 0, duration_ms 78358
run 3 (--test-concurrency=64): fail 0, duration_ms 51701
run 4 (--test-concurrency=64): fail 0, duration_ms 63189
run 5 (--test-concurrency=64): fail 0, duration_ms 70680
```

10/10 clean, 0 fail across all 10 (on top of the build own claimed 9). Combined with the mechanism-level fix (the test no longer performs two racing live tree-walks against a mutable working tree, so there is nothing left for a transient I/O hiccup to desynchronize), this is a structural fix, not a lucky run -- the flake own precondition (comparing two independently-timed full-tree reads) has been removed, not merely made rarer. Verdict: CONFIRMED FIXED.

### Finding 2 [MED] (round-1) -- stale Milestone #19 "SHIPPED" description with no QA-14-residual disclosure -- CONFIRMED FIXED

Demonstrated, live gh api read, not taken from any prior claim:

```
$ gh api repos/mohannadrabie/thoth/milestones/19 --jq "{title,state,open_issues,closed_issues,description}"
closed_issues=5, open_issues=4, state=open, title="S1 -- Protect the baseline"
description="CI-01, QA-01/02/05/06(scaffold), QA-13-16, OSS-01, native-architecture ADR
(ADR-0021). SHIPPED -- commits 2992bfb/366c54d/d3a833f. DISCLOSED RESIDUAL (added 2026-09-13,
Issue #171): QA-14 (100%-citation-resolution) is a human-accepted, non-blocking residual, NOT a
completion criterion for this milestone -- comma/list-continuation classification gaps (Issue
#154) and related unresolved-authority/unclassified citations. QA-14 still exits 1 on this
repo; run node src/qa/reference-resolver.ts <base> HEAD for the live, current count rather
than trusting a frozen figure here."
```

This is honest by this role own standard: it names the residual, names the owning Issue (#154), states QA-14 still fails, and points at a live command instead of a frozen count that would itself go stale (the same discipline this project already applies elsewhere for a moving-corpus metric). Milestone correctly left OPEN (4 open issues: #154, #164, #175, #174 -- see Issue Discipline section below). Verdict: CONFIRMED FIXED.

## Seam re-check on the round-2 diff itself

### New GitOps.lsFilesWorkingTree() (src/lib/git.ts:18-27,140-162) -- no new ADR collision

Code-traced against the whole 35-ADR catalog, not a lane slice: this is a pure git-plumbing wrapper (git ls-files --cached -s + --others --exclude-standard, mode-filtered to exclude 160000 submodule gitlinks), added to the same src/lib/git.ts module ADR-0021 kernel-purity boundary already does not govern (round-1 clean verdict on ADR-0021 covered this file existing exports; the new method is the same shape -- no filesystem write, no network, no gate/audit-log/Action-record surface touched). It is not one of CLAUDE.md named sensitive areas (hooks/*, scripts/guard/*, src/policy/guard/*, hooks/audit-log.mjs, secret-scan, .thoth/halt-state/). No collision.

### assertKnownArgs() fail-loud addition -- no new ADR collision

A pure function, thrown-not-caught, unit-tested with no I/O (marker-corpus-probe.test.ts new deterministic test). Same domain, same file, same clean verdict as round 1 ADR-0004/0010 read. No collision.

### The #172 vs. #175 asymmetry -- is the deferral disclosed honestly, or silently inconsistent?

This is the one seam worth naming explicitly, because it is exactly the kind of thing that looks like an inconsistency from the outside (marker-corpus-probe.ts now reads its file list from the live working tree; continuation-residual-probe.ts, its structural twin, still reads it from resolveChangedFiles(git, <zero-sha>, "HEAD") -- an ls-tree-at-HEAD read). Checked whether this asymmetry is silently shipped or honestly named, in three independent places:

- src/qa/marker-corpus-probe.ts own new doc comment (lines ~55-62) states directly it is a deliberate, new divergence from continuation-residual-probe.ts own collectFullTreeFileTexts, and that the twin file carries the identical mismatch, flagged as its own follow-up.
- docs/STATE.md round-2 resume point (line 26) names it the same way, in prose a human reads before the code.
- GitHub Issue #175 itself, filed and open, milestone S1, body reads (verified by direct gh issue view): this is the identical defect Issue #172 just fixed on marker-corpus-probe.ts, named as a live, separate defect rather than silently fixed alongside it, per this project own gold-plating discipline.

All three tell the same story with the same words (live, separate defect, not fixed, not hidden) -- this is the correct call under CLAUDE.md own gold-plating rule (a defect discovered outside the approved scope becomes a new Issue, not a scope-creeping in-diff fix) and it is disclosed consistently, not a silent gap. Verdict: CLEAN, correctly scoped and correctly disclosed.

## Issue Discipline re-check (this round own closures)

Verified live via gh api / gh issue view, not taken from the commit message own claim:

- #170, #172, #173, #171: all state CLOSED, state_reason COMPLETED, all under Milestone "S1 -- Protect the baseline", each closed via commit 713dbdd own "Closes #170, closes #172, closes #173, closes #171" trailer -- closure tied to a real artifact, not a bare status flip. Each carries a [story-implementer]-prefixed closing comment with real, specific evidence, not a generic "done."
- #164, #154: both still state OPEN, state_reason reopened -- correctly left open per this round own instruction (re-close only after re-review confirms clean). Matches docs/STATE.md explicit "do not re-close" line.
- #175: filed, open, correctly labeled (bug, severity:med, qa), correctly milestoned (S1), body names the exact defect class and points at the precedent fix -- no gold-plating, no silent fix-alongside.
- No duplicate Issue found for any of these.

All CLEAN.

## Verification performed directly (this review, not taken from any prior claim)

- npm test (full suite): 5 consecutive runs at default concurrency, 0 fail each; 5 consecutive runs at --test-concurrency=64, 0 fail each -- 10/10 clean, specifically targeting the original flake own precondition (real subprocess concurrency), at a higher concurrency than the round-2 build own claimed re-verification.
- node src/qa/marker-corpus-probe.ts --field=total -- exit 0, sane output, sanity-checked directly (not just via the test suite).
- gh api repos/mohannadrabie/thoth/milestones/19 -- confirmed current description matches the claimed fix verbatim, and states the QA-14 residual honestly.
- gh api / gh issue view on #170, #171, #172, #173, #175, #164, #154 -- confirmed state, state_reason, milestone, and comment provenance for each.
- Direct code read of src/lib/git.ts new lsFilesWorkingTree(), src/qa/marker-corpus-probe.ts new assertKnownArgs(), and both files narrowed readFile catch -- confirmed against the whole 35-ADR catalog, no collision.
- git diff b9fed71 713dbdd --stat -- confirmed the full file list touched this round, nothing outside src/qa/, src/lib/git.ts(+test), and docs/review artifacts.

## Verdict

APPROVE. Both round-1 findings are confirmed fixed by direct re-verification (not taken on the build receipt word): Finding 1 via 10 additional full-suite runs specifically targeting the original flake concurrency precondition (0/10 fail, at higher concurrency than the build own claim), Finding 2 via a live gh api read of the corrected, honest milestone description. The round-2 diff own new surface (GitOps.lsFilesWorkingTree(), assertKnownArgs()) introduces no new ADR collision. The one seam worth naming -- marker-corpus-probe.ts and continuation-residual-probe.ts now diverging on file-list tree-state -- is disclosed consistently in three independent places (code comment, STATE.md, Issue #175 own body), not silently inconsistent; correctly deferred as its own Issue rather than gold-plated into this diff. Issue Discipline is clean on this round own closures.

## Coverage gaps named

None new this round. This pass was scoped (per dispatch) to re-confirming round-1 own two findings plus a targeted look at the round-2 diff new surface -- it does not re-litigate code-reviewer or red-team lanes, and neither has re-confirmed round 2 yet as of this pass (worth the Manager tracking, not a defect in this diff).

## Single next action

None blocking from this lane. Once code-reviewer and red-team each re-confirm round 2 clean, proceed to Stage 4 (/maat:verify) -> Stage 5 (audit) -> re-close Issues #164/#154 -> PR.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [CLEAN][demonstrated] Round-1 Finding 1 (flaky two-subprocess test) -- CONFIRMED FIXED: readFile catch narrowed to ENOENT-only in both marker-corpus-probe.ts:132-141 and continuation-residual-probe.ts:176-192, flaky test replaced with single-spawn assertions in both; 10/10 additional full-suite runs this session (5 default + 5 at --test-concurrency=64) 0 fail, targeting the original flake own concurrency precondition.
2. [CLEAN][demonstrated] Round-1 Finding 2 (stale "SHIPPED" milestone description) -- CONFIRMED FIXED: live gh api read of Milestone #19 shows the corrected description disclosing the QA-14 residual, Issue #154, and pointing at a live command instead of a frozen count.
3. [CLEAN][code-traced] New GitOps.lsFilesWorkingTree() (src/lib/git.ts:18-27,140-162) and assertKnownArgs() (marker-corpus-probe.ts) -- no collision against the whole 35-ADR catalog; not a named sensitive area.
4. [CLEAN][code-traced] #172-fixed/#175-deferred asymmetry between marker-corpus-probe.ts and continuation-residual-probe.ts -- disclosed consistently in the code comment, docs/STATE.md, and Issue #175 own body; correctly scoped as a new Issue rather than gold-plated into this diff.
5. [CLEAN][code-traced] Issue Discipline on this round own closures -- #170/#172/#173/#171 closed COMPLETED via commit trailer with role-prefixed comments; #164/#154 correctly left open; #175 correctly filed, milestoned, no duplicate.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=0 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=3 derived=0
checks=npm-test:10/10-full-suite-runs-0-fail(5x-default-concurrency, 5x--test-concurrency=64) marker-corpus-probe-sanity:exit0 gh-api-milestone19:confirmed-honest-description gh-issue-checks:170/171/172/173/175/164/154-all-confirmed-correct-state
adr=HIT(35, whole catalog)
report=docs/reviews/s1-closeout-164-154-cross-domain-round2-2026-09-13.md
