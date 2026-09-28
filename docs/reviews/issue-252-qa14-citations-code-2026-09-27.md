# Code Review — PR #346 `docs/issue-252-qa14-citations`

**Reviewer:** code-reviewer (Anubis)
**Date:** 2026-09-27
**Scope:** PR #346, branch `docs/issue-252-qa14-citations` vs `master` (base `d7c226e`, head `7afe304`). STANDARD tier, docs-only, citation-cleanup half of Issue #252. QA-14 wording amendment (line 570) explicitly out of scope.

## ADR compliance

`node docs/adr-cache.mjs --ensure` returned ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog.

This diff touches only CHANGELOG.md, REQUIREMENTS.md, docs/STATE.md -- pure prose rewording, no code, no schema, no error-handling path, no maintainability-relevant structure. No ADR in the code/testing/error-handling/maintainability domains governs documentation-citation wording. No applicable ADRs found.

## Ground truth read

- docs/decisions.md, 2026-09-27 row ("Issue #252 intake ruling") -- the ratified scope and fix-shape for all 5 questions (fix strategy, QA-14 wording out of scope, hooks/report-subject-gate.mjs reword source, the two spike citations, SECURITY.md).
- docs/decisions-archive.md, 2026-09-06 row -- the archived ruling that hooks/report-subject-gate.mjs was never functional on master and was removed, replaced by a disclosure naming S8/Milestone #26/INT-05 as the real audit-trail owner.

## Verification performed (raw, self-run)

Set up two worktrees (thoth-pr346 at PR head 7afe304, thoth-master at base d7c226e), initialized the adr/ submodule in each (missing by default under git worktree add, confirmed to be my own environment gap, not a PR defect -- the first uninitialized run falsely reported 10 ADR-id failures in diff mode that vanished once the submodule was initialized).

Diff mode (node src/qa/reference-resolver.ts origin/master HEAD, PR head):
```
[QA-14 reference-resolver] PASS: 446 citation(s): 330 resolved, 116 unclassified (non-blocking, no explicit citation marker) -- 0 failed.
```
Exit 0. Matches the PR's own claimed result exactly.

Full-tree, PR head (node src/qa/reference-resolver.ts 0000...0 HEAD):
```
[QA-14 reference-resolver] FAIL: 161 of 7879 citation(s) failed to resolve; 1151 more unclassified (non-blocking).
```
grep -c on the failure list for [file: REQUIREMENTS.md] -> 0.

Full-tree, master baseline (same command, thoth-master worktree at d7c226e):
```
[QA-14 reference-resolver] FAIL: 189 of 7896 citation(s) failed to resolve; 1148 more unclassified (non-blocking).
```
grep -c for [file: REQUIREMENTS.md] -> 28.

So: 28 REQUIREMENTS.md failures on master became 0 on the PR branch, and the repo-wide failure count drops by exactly 28 (189 to 161, with only unrelated per-file counts making up the small +2 offset from the PR's self-reported 187/159 -- see Editorial). No new failures were introduced anywhere else in the tree by this change; the fix is scoped exactly to what it claims.

Self-inflicted-regression check (item 4): grepped the PR-head full-tree failure list for [file: CHANGELOG.md] / [file: docs/STATE.md] hits. Five hits attributed to CHANGELOG.md (issue-id 0, .claude/settings.local.json, docs/reviews/_probe.md, hooks/report-subject-gate.mjs, clean/safe-single-constructor-access.ts) -- all traced with git show d7c226e:CHANGELOG.md to pre-existing S5-era lines 801/806, untouched by this PR (confirmed identical text on master before this PR). The PR's own new CHANGELOG.md/docs/STATE.md prose (this PR's added lines) writes every risky string (hooks/report-subject-gate.mjs, SECURITY.md, the two spike paths, ADR-####) with no backtick fencing -- confirmed by reading the added lines directly and by the resolver's own detection rule (BACKTICK_PATH_RE, src/qa/reference-resolver.ts:244 -- only backtick-fenced paths are checked as path citations). No self-inflicted regression in the final commit.

Spike notes never committed (item confirming no invention):
```
git log --all --full-history -- docs/spikes/2026-08-24-thoth-reuse-ledger.md   -> empty
git log --all --full-history -- docs/spikes/2026-08-25-agt-docs-recheck.md    -> empty
```

Path corrections real: ls REQUIREMENTS.md -> exists (repo root). ls docs/README.md -> does not exist. ls README.md -> exists (repo root). ls SECURITY.md (both worktree and PR ref) -> does not exist. Confirms the docs/README.md to README.md and docs/REQUIREMENTS.md to REQUIREMENTS.md reworks are genuine path corrections, and confirms neither SECURITY.md nor the hook file is created by this change.

Line 570 untouched: git diff d7c226e...pr-346 -- REQUIREMENTS.md hunk "@@ -570,7 +570,7 @@" shows the QA-14 acceptance-criteria row as unchanged context (no leading +/-); only the QA-17 row inside that same hunk changes (the spike-note citation). Byte-identical, confirmed.

## Substance cross-checks

- hooks/report-subject-gate.mjs reword (REQUIREMENTS.md, amendment 2026-08-29 paragraph): new text states the entry was never functional on master and was removed (Issue #87; docs/decisions-archive.md's 2026-09-06 row); EVD-17 and INT-07 stay open, with the durable audit-trail mechanism owned by S8 (Milestone #26, INT-05). This matches the archived decision's substance (never functional, removed, replaced by a disclosure naming S8/Milestone #26/INT-05) with nothing invented or dropped.
- Spike-note citations, 4 occurrences across 2 files -- each reworded to disclose "never committed to this repository" without inventing recovery, and each preserves its original sub-reference (the ADR-0015 section-4 pointer at the overlap-adjudication table row survives the reword verbatim).
- SECURITY.md, 5 occurrences -- tense fixed ("published in" to "to be published in") plus de-backticking; file confirmed not created.
- lib/audit.mjs (3 occurrences), ADR‑0029 to ADR 0029 (2 occurrences), the fullstack/scripts/*, scripts/policy/*, scripts/secret-scan/*, scripts/repo-split/* table rows and team-gate.mjs -- read the full diff hunk by hunk: every change is a backtick strip or a hyphen-to-space edit on an id, zero prose/semantic changes elsewhere in the same lines.
- Scope: gh pr view 346 --json files shows exactly 3 files changed (CHANGELOG.md +6/-0, REQUIREMENTS.md +37/-37, docs/STATE.md +14/-2) -- no ADR file touched, no other file touched, matching the "in place, no net lines added or removed" claim for REQUIREMENTS.md exactly.
- DoD: CHANGELOG entry present and correctly scoped ("Progresses #252... Does not close it"); docs/STATE.md resume point updated with a correct "Single next action"; Issue #252 confirmed still OPEN on GitHub (gh issue view 252 -> state: OPEN); no commit message says "Closes #252".

## Editorial (non-gating)

The PR's own decisions.md/CHANGELOG prose reports full-tree counts of "187 of 7896" (before) and "159 of 7879" (after); my independently-run instrument reports 189/7896 and 161/7879 -- a consistent +2 offset on both sides, on pre-existing unrelated debt (issue-id 0/issue-id 9999-style fixture citations), not on REQUIREMENTS.md (which matches exactly: 28 to 0 in both). Cosmetic drift, not a defect in this PR -- likely a small amount of debt landed in master between when the build report's numbers were captured and now. No action needed beyond noting it; the REQUIREMENTS.md-specific claim, which is what this story is actually about, reproduces exactly.

## Findings

All axes checked: correctness vs ratified scope, idempotency (not applicable -- single doc edit, no re-run risk), inputs/edge cases (not applicable -- no code), error handling (not applicable), verification quality (instrument re-run myself, above), maintainability (pure prose, no dead code or TODOs introduced). No user-facing functional bug is possible in this diff -- it touches no code path, only requirement documentation prose that an instrument, not a user, consumes.

No HIGH or MED findings. No GitHub Issue filed (nothing at ISSUE severity HIGH or MED to file).

## Verdict: SHIP

## Praised decision

Setting up parallel worktrees to empirically diff the resolver's failure count (28 to 0 on REQUIREMENTS.md, no repo-wide side effect) rather than trusting the PR's self-reported numbers was the right instinct on the implementer's part too -- the build report's own "Gap found and closed" section shows exactly this kind of self-verification (catching its own missed lines 99/205, and its own self-inflicted CHANGELOG/STATE citation-shape regression) rather than declaring done on the first green run.

## Single next action

Merge PR #346 (human action per CLAUDE.md's human-only-merge rule). Issue #252 stays open for the QA-14 wording-amendment half (line 570), tracked separately.


## Addendum -- cross-domain-reviewer's line-3 finding cross-checked

cross-domain-reviewer's own pass on this same PR (docs/reviews/s252-qa14-citation-cleanup-cross-domain-2026-09-27.md, logged in docs/REVIEW_LOG.md) found that REQUIREMENTS.md line 3's other markdown link -- "[CLAUDE.md](../CLAUDE.md)" -- is broken: CLAUDE.md lives at repo root, same as REQUIREMENTS.md, so the correct relative target is "CLAUDE.md", not "../CLAUDE.md". I confirmed this independently (ls CLAUDE.md succeeds at repo root; the PR's own diff touches only the adjacent docs/README.md-to-README.md text on that same line, not this link). Pre-existing on master, correctly left untouched by this PR (not in the ratified Issue #252 scope, no gold-plating), and already filed as Issue #347 (severity:med) by cross-domain-reviewer for the process gap (the Phase 1 report's own out-of-scope finding was never recorded to backlog.md or an Issue at PR time). Not duplicating that filing here. Does not change this PR's SHIP verdict: the broken link is not part of this diff and QA-14's resolver does not check markdown-link targets (only backtick-fenced bare-path and ADR/Issue citations), so it is orthogonal to what this story fixes.

---

RECEIPT: verdict=SHIP
findings (ALL of them, one terse line each, ranked by severity):
1. [CLEAN][demonstrated] REQUIREMENTS.md line 570 (QA-14 acceptance criteria) byte-identical to master -- diff hunk shows it as unchanged context, not +/-.
2. [CLEAN][code-traced] hooks/report-subject-gate.mjs reword (REQUIREMENTS.md ~L19) matches docs/decisions-archive.md 2026-09-06 row substance exactly -- nothing invented, nothing dropped.
3. [CLEAN][demonstrated] Both spike notes (2026-08-24-thoth-reuse-ledger.md, 2026-08-25-agt-docs-recheck.md) confirmed never committed via git log --all --full-history; all 4 reworded citations disclose never-committed status without inventing recovery and preserve sub-references (the section-4 pointer).
4. [CLEAN][demonstrated] SECURITY.md and docs/README.md confirmed non-existent, README.md and REQUIREMENTS.md confirmed at repo root -- the path-correction and tense-fix rewords are genuine, file not created.
5. [CLEAN][code-traced] lib/audit.mjs, ADR‑0029 to ADR 0029, fullstack/scripts/*, scripts/policy/*, scripts/secret-scan/*, scripts/repo-split/*, team-gate.mjs -- every occurrence is a pure backtick-strip or hyphen-to-space edit, zero other text change.
6. [CLEAN][demonstrated] QA-14 reference-resolver re-run by me: full-tree 28 to 0 REQUIREMENTS.md failures (master vs PR head), repo-wide failure count drops by exactly 28 with no new failures elsewhere; diff mode against origin/master PASS, 0 failed, exit 0.
7. [CLEAN][demonstrated] Self-inflicted-regression check: the 5 CHANGELOG.md-attributed failures in the PR-head full-tree scan all trace to pre-existing untouched S5-era lines (801/806); the PR's own new CHANGELOG.md/docs/STATE.md prose has zero backtick-fenced risky citation shapes.
8. [CLEAN][code-traced] Scope discipline: exactly 3 files changed (CHANGELOG.md, REQUIREMENTS.md, docs/STATE.md), no ADR touched, CHANGELOG/STATE.md correctly scoped as progresses/partial not closing #252, Issue #252 confirmed still OPEN via gh issue view.
9. [CLEAN][code-traced] REQUIREMENTS.md line 3's broken "../CLAUDE.md" link (pre-existing, untouched by this PR, correctly out of scope) is already filed as Issue #347 by cross-domain-reviewer -- cross-checked, not a defect in this diff, no duplicate filing.
counts: issues=0 suspicions=0 clean=9
evidence: demonstrated=5 code-traced=4 derived=0
checks="reference-resolver diff-mode PASS 330 resolved/116 unclassified/0 failed (exit 0); reference-resolver full-tree PR-head FAIL 161/7879 (0 REQUIREMENTS.md failures)/0/0 skipped; reference-resolver full-tree master-baseline FAIL 189/7896 (28 REQUIREMENTS.md failures)"
adr=HIT(37)
report=docs/reviews/issue-252-qa14-citations-code-2026-09-27.md
