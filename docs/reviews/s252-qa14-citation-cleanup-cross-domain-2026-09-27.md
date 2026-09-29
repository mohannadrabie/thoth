# Cross-Domain Review — Issue #252 citation-cleanup (PR #346)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-27
**Scope:** docs/.maat-state.json scope s252-qa14-citation-cleanup, tier STANDARD
**Branch/PR:** docs/issue-252-qa14-citations to master, PR #346 (checked out at C:/playground/thoth-pr346, tip 7afe304)
**ADR cache:** ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT] -- whole catalog read, not a domain slice, per standing role.

## Who else ran, and what ground they covered

Per docs/.maat-state.json note_2026-09-27e: reviewer pick for this STANDARD-tier, docs-only story is code-reviewer plus mandatory cross-domain-reviewer. code-reviewer's lane is correctness of the prose itself (does each reworded sentence state a true fact) and internal consistency of the CHANGELOG/STATE.md housekeeping. This review starts where that lane stops: the whole ADR catalog, the seams between REQUIREMENTS.md's prose and the governance/tooling that reads it, and the process discipline around the one item this story correctly declined to fix.

## Cross-domain ADR verdict -- whole catalog (37 ADRs)

Checked every ADR in adr/devops, adr/software-engineering, docs/adr -- not filtered to any lane's applicableTo.

- **No ADR cites the four stale-citation surfaces this PR reworks.** grep -rln across all three ADR roots for report-subject-gate, 2026-08-24-thoth-reuse-ledger.md, 2026-08-25-agt-docs-recheck.md, SECURITY.md, ADR‑0029/ADR 0029 returns nothing. No ADR's own claim depends on REQUIREMENTS.md's old wording for any of these four items -- reword can't contradict or invalidate an ADR here. [CLEAN], code-traced.
- **The "REQUIREMENTS.md is itself a Write-Gate-protected path under CLAUDE.md (14-day architecture review)" language in ADR-0016/0018/0020 is prose narrative about substantive amendments (new P0 requirements), not a "Rules for agents" MUST** -- confirmed by reading each ADR's own Rules-for-agents section, which parametrizes ADR-0019's generic MUST/MUST-NOT list around file-porting and .governance.json protected paths, never a blanket "any REQUIREMENTS.md edit needs architecture review" rule. .governance.json itself does not exist in this repository -- the referenced mechanism is predecessor-era prose carried into these ADRs' narrative sections, not a live gate here. A citation-form-only reword (no requirement, acceptance criterion, or decision added/removed -- confirmed by git diff --stat: 37 insertions, 37 deletions in REQUIREMENTS.md, no net line-count change) does not trigger this gate even if it were live. Already correctly ratified via docs/decisions.md's 2026-09-27 row (reviewer pick omits architecture-reviewer deliberately). [CLEAN], code-traced.
- **ADR line-number citations into REQUIREMENTS.md are unaffected.** ADR-0020 cites docs/REQUIREMENTS.md line 167 for the report-gate.mjs Port-verdict row; that citation was already stale before this PR (line 167 on origin/master is the "1.2 What to take from the predecessor" heading, not the report-gate.mjs row -- pre-existing drift, unrelated to this change). This PR does not touch line counts (in-place word substitution only), so no NEW line-citation drift is introduced anywhere in the ADR catalog by this change. Pre-existing drift, out of this PR's scope, not a new collision. [CLEAN], code-traced (noted for the record, not actionable here).

## Seam findings

### 1. Human-perception ambiguity from de-backticking (task item 2) -- checked, no new risk found

Read each touched passage line-by-line in the full diff. In every case the surrounding structure (table "Source file" column headers, explicit "predecessor project"/"AGT" framing already in the sentence, or explicit past-tense disclosure -- "was intended... but it was never functional on master and was removed") carries the same meaning a human skimmer would take from the old backtick-fenced version. De-backticking a path that names a file in a different repository (the predecessor fullstack/scripts/* tree) arguably reduces a human's visual cue that it's a path at all, but the table's own column semantics ("Source file") and header prose ("What to take from the predecessor") already establish that context without the backticks. No case found where removing the fencing could make a reader believe an artifact exists that doesn't, or vice versa -- if anything, the reworded prose is more explicit about non-existence ("never committed to this repository," stated plainly, twice per spike note) than the old backtick-fenced citation was. [CLEAN], code-traced.

### 2. QA-14 self-application -- independently re-run, not trusted from the PR's own claim

The PR's own worktree (C:/playground/thoth-pr346) had the adr submodule UNINITIALIZED (git submodule status showed the "-" prefix). Running the full-tree resolver in that state produced 3 phantom [unresolved-authority] ADR-0015/0017/0021 ... [file: REQUIREMENTS.md] failures that have nothing to do with this PR -- they're artifacts of a missing submodule checkout, not real citation defects. This is a reviewer-environment footgun (over-reports failures, doesn't hide real ones -- fails safe, not silent) worth naming so no future reviewer mistakes it for a live regression; not a defect in the shipped PR.

After git submodule update --init (37 ADRs now present, matching the ADR cache's own count):

    node src/qa/reference-resolver.ts 0000000000000000000000000000000000000000 HEAD
    -> [QA-14 reference-resolver] FAIL: 161 of 7879 citation(s) failed to resolve; 1151 more unclassified (non-blocking).
    grep -c "[file: REQUIREMENTS.md]" <output>
    -> 0

Independently confirms the PR's own claim of 0 remaining [file: REQUIREMENTS.md] unresolved-authority failures, full-tree. (161 vs. the PR's own reported 159 -- a 2-item drift, entirely in pre-existing, unrelated files (docs/decisions.md, several docs/reviews/*, src/qa/*); none newly introduced by this diff, none touch REQUIREMENTS.md. Editorial note only -- likely time-based drift in a live-lookup-dependent citation shape, not a defect in this PR's own completeness claim about REQUIREMENTS.md.)

Diff-mode re-run, exact match to the PR's own reported output:

    node src/qa/reference-resolver.ts origin/master HEAD
    -> [QA-14 reference-resolver] PASS: 446 citation(s): 330 resolved, 116 unclassified (non-blocking, no explicit citation marker) -- 0 failed.

Residual literal-occurrence greps (independent corroboration, not trusting the resolver alone), all against the PR branch's REQUIREMENTS.md:
- "2026-08-25-agt-docs-recheck.md" -> 3 hits, all reworded to "a 2026-08-25 spike note, docs/spikes/..., never committed to this repository" (no backtick fencing, no bare resolvable-citation shape)
- "2026-08-24-thoth-reuse-ledger.md" -> 1 hit, same treatment
- backtick-fenced SECURITY.md -> 0 hits
- backtick-fenced hooks/report-subject-gate.mjs -> 0 hits
- "ADR‑0029" (hyphenated) -> 0 hits (now "ADR 0029", space not hyphen, at both occurrences)

All CLEAN, demonstrated.

### 3. Scope-boundary integrity (task item 4) -- confirmed

    git diff origin/master...HEAD --stat
    -> CHANGELOG.md    |  6 +++++
    -> REQUIREMENTS.md | 74 ++++++++++++++++++++++++++++-----------------------------
    -> docs/STATE.md   | 16 +++++++++++--

Only the three expected files. Comparing line 570 of REQUIREMENTS.md between origin/master and this branch -- identical; QA-14's own acceptance-criteria line is untouched. [CLEAN], demonstrated.

### 4. The deferred backlog item -- NOT recorded anywhere (real process gap)

Confirmed, per the PR description's own "Gap found and closed" section and Phase 1 report, that the broken markdown link target on REQUIREMENTS.md line 3 (the second link's actual target ../CLAUDE.md resolving one level above the repo root, since REQUIREMENTS.md lives at repo root, not under docs/) was correctly left untouched in this diff -- line 3 still reads "...see CLAUDE.md(../CLAUDE.md)", unchanged, confirmed via direct read. Correct: it's out of this story's ratified scope (citation-form rewording only), and CLAUDE.md's own no-gold-plating rule says a finding outside the approved change becomes a backlog/Issue entry, never a diff edit -- so leaving it out of the diff is exactly right.

**But it was never recorded anywhere.** Checked every place CLAUDE.md's own discipline says it should land:
- docs/backlog.md tail: no mention (grep -n "252 or line 3 or ../CLAUDE" docs/backlog.md -- 0 hits).
- This PR's own CHANGELOG.md/docs/STATE.md additions: no mention (read in full).
- GitHub Issue #252 (the parent issue) comments: no mention (gh issue view 252 --json comments -- 0 hits for "claude.md"/"line 3"/"broken link").
- A dedicated new Issue: none found (gh issue list --search "CLAUDE.md link" / "REQUIREMENTS.md line 3" -- 0 hits).

This is a real, demonstrated gap against CLAUDE.md's own hard rule ("No gold-plating: not in the approved change -> a new GitHub Issue... or docs/backlog.md. Either way, never the diff.") -- the "never the diff" half was honored, the "goes somewhere" half was not. A single-lane reviewer checking prose correctness wouldn't necessarily notice an absence across four different possible landing spots; this is exactly the kind of seam the cross-domain pass exists to catch.

**[ISSUE][MED]** -- docs/backlog.md / GitHub Issues, no entry exists for the REQUIREMENTS.md line-3 ../CLAUDE.md broken-link-target finding the Phase 1 report itself flagged as out-of-scope. **code-traced** (exhaustive search across all four plausible landing artifacts, all negative). **Exposure:** ~100% of future readers of this specific finding (it is fully dropped, not degraded) -- but the underlying defect itself is a single stale markdown link in a governance document with no functional/security blast radius; **basis: measured** (searched every named landing spot). **Minimal fix:** file the GitHub Issue now (done by this report, see receipt) -- one line, chore + severity:med, no milestone (parent Issue #252 itself carries none, so this follows the same "genuinely unclear home" default).

## Coverage gaps

None. The diff touches exactly three files (CHANGELOG.md, REQUIREMENTS.md, docs/STATE.md), all prose/housekeeping -- squarely inside code-reviewer's correctness lane plus this cross-domain pass's ADR/process lane. No infra, no application code, no schema, no API surface in this diff; nothing is silently uncovered.

## Redundancy check

No finding above duplicates anything code-reviewer would have surfaced from inside its own lane (prose-fact correctness) -- the ADR-catalog collision check, the Write-Gate-narrative reading, and the backlog/Issue absence are all seams only a whole-catalog, cross-lane pass reaches.

## Verdict

**APPROVE-WITH-CONDITIONS.** No HIGH, no ADR collision, no scope-boundary violation. One MED (process gap, not a defect in the shipped diff): file the missing backlog/Issue record for the line-3 link finding before this story's own arc (Issue #252, citation-cleanup half) is considered fully closed out -- the GitHub Issue is filed as part of this report (see receipt), so the condition is satisfied by the time this report lands.

## Single next action

Merge is otherwise clear on cross-domain grounds; human confirms the newly-filed Issue for the REQUIREMENTS.md line-3 link is linked/triaged, then proceeds with the normal STANDARD-tier merge-handoff.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][code-traced] docs/backlog.md (and every other plausible landing spot) -- REQUIREMENTS.md line 3's ../CLAUDE.md broken-link-target finding, correctly left out of the diff, was never recorded anywhere; filed as GitHub Issue #347.
2. [CLEAN][code-traced] Whole 37-ADR catalog grepped for the four reworded citation surfaces (report-subject-gate.mjs, both spike notes, SECURITY.md, ADR‑0029) -- no ADR cites any of them; no collision.
3. [CLEAN][code-traced] ADR-0016/0018/0020's "REQUIREMENTS.md Write-Gate, 14-day architecture review" language is narrative about substantive amendments, not a Rules-for-agents MUST; no .governance.json exists to enforce it mechanically; a citation-form-only reword (no lines added/removed) doesn't trigger it -- already correctly reflected in the 2026-09-27 decisions.md ratification (no architecture-reviewer dispatched).
4. [CLEAN][code-traced] Pre-existing ADR-0020 line-167 citation into REQUIREMENTS.md was already stale before this PR (unrelated drift); this PR adds no new line-citation drift anywhere in the ADR catalog (no lines added/removed).
5. [CLEAN][code-traced] De-backticking of predecessor-repo paths and the report-subject-gate.mjs/spike-note/SECURITY.md rewords reviewed line-by-line -- surrounding table/prose context preserves meaning for a human reader; no new false-existence or false-absence impression created.
6. [CLEAN][demonstrated] Full-tree "node src/qa/reference-resolver.ts 0000...0000 HEAD" independently re-run (after fixing an uninitialized adr submodule in the PR worktree, itself a reviewer-environment footgun, not a PR defect) -- 0 of 7879 [file: REQUIREMENTS.md] failures, confirming the PR's own claim rather than trusting it.
7. [CLEAN][demonstrated] Diff-mode "node src/qa/reference-resolver.ts origin/master HEAD" independently re-run -- output byte-identical to the PR's own reported line (446 citations, 330 resolved, 116 unclassified, 0 failed).
8. [CLEAN][demonstrated] "git diff origin/master...HEAD --stat" -- only CHANGELOG.md, REQUIREMENTS.md, docs/STATE.md touched; REQUIREMENTS.md line 570 (QA-14's own acceptance criteria) byte-identical, confirmed via direct diff.
9. [CLEAN][derived] No coverage gap -- all three touched files are prose/housekeeping, fully inside code-reviewer's + this pass's combined lane.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=8
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=3 code-traced=5 derived=1
checks=node src/qa/reference-resolver.ts (full-tree: 161/7879 failed, 0 of them REQUIREMENTS.md; diff-mode: 446 citations, 0 failed, byte-identical to PR claim); git diff --stat (3 files only); direct line-570 diff (identical)
adr=HIT(37, whole catalog)
report=docs/reviews/s252-qa14-citation-cleanup-cross-domain-2026-09-27.md
