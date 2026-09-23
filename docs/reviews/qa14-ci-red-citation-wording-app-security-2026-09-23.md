# App Security Review -- fix/qa14-ci-red-citation-wording (PR 281)

Reviewer: app-security-reviewer (Horus)
Date: 2026-09-23

Scope: PR #281, fix/qa14-ci-red-citation-wording, base master
Actual PR diff verified: df092f9 (parent, PR #279 merge) to 162dcd3 (PR #281 head)
Tier: CRITICAL (sensitive area -- SUR-03 halt mechanism, hooks/sessionstart-tool-enum.mjs + hooks/userpromptsubmit-halt-relay.mjs)

## ADR compliance

node docs/adr-cache.mjs --ensure gave: ADR cache BUILT: cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2], catalog now current (fp 65bdecc) [CACHE=HIT].

The review worktree's adr submodule was uninitialized at session start (adr/devops and adr/software-engineering both empty; only docs/adr's 2 project-local ADRs were cataloged: THOTH-ADR-0001 central-classification fixture exception, THOTH-ADR-0002 secret-scan allowlist value-scoping). Neither ADR's rules govern this diff's content (a fixture allowlist and a secret-scan allowlist, respectively -- this PR touches neither). I initialized the submodule (read-only clone, non-destructive) to pull the full 37-ADR catalog for a complete pass; no ADR in either domain folder contains a rule specific to source-code comment wording or citation-resolver text. No applicable ADR rule is violated by this diff. (Aside, not a finding: a review worktree starting with the ADR submodule uninitialized silently narrows every reviewer's ADR catalog to 2 entries instead of 37 unless the reviewer notices and self-corrects, as happened here.)

## Process correction disclosed up front

This worktree's checked-out commit was one commit behind the actual PR head at session start (the PR #279 merge commit, not PR #281's own commit), despite the branch pointing at the PR head upstream. Two-commit diff comparisons are unaffected by working-tree checkout state and gave correct results throughout. However, my first pass of direct file reads/greps and the first test-suite / secret-scan runs executed against the wrong (pre-fix) commit content without my noticing. I caught this via a QA-14 resolver anomaly (a citation I expected fixed was still flagged) before finalizing, switched the worktree to the true PR head (non-destructive checkout -- the only local change at the time was a regenerated cache file, restored first), and re-ran every check against the correct commit. All results below are against verified true-PR-head content. The worktree was returned to its original checkout state afterward.

## Findings

### 1. Diff scope -- confirmed comment-only [CLEAN, code-traced]

The actual PR commit touches exactly 2 files, 3 insertions / 3 deletions total:

hooks/sessionstart-tool-enum.mjs      | 4 ++--
hooks/userpromptsubmit-halt-relay.mjs | 2 +-
2 files changed, 3 insertions(+), 3 deletions(-)

All three changed lines verified at path:line in the true PR head:
- hooks/sessionstart-tool-enum.mjs:12 -- reworded to name the same upstream repo and issue number without the hash-mark shape that QA-14's cross-repo-issue detector always treats as blocking.
- hooks/sessionstart-tool-enum.mjs:444 -- backticks around the .claude/settings.local.json path dropped.
- hooks/userpromptsubmit-halt-relay.mjs:70 -- "process.stdout/stderr.write" split into "process.stdout.write"/"process.stderr.write".

All three sit inside // line comments in file-header/inline documentation blocks -- none is inside a string literal, template literal, regex, or any construct evaluated or parsed at runtime by either hook. Read the surrounding 20-line context at each site directly; confirmed no other code near these lines changed shape.

The task's originally-specified comparison (against the pre-session-start master baseline) spans the entire s5-halt-mechanism-hardening story (PR #279) plus this PR, not just this PR's own change -- it includes hundreds of real logic lines (session-id fallback, unlock-token structural defense, control-char stripping) that are not part of this diff and were never claimed to be comment-only. The comment-only claim is scoped to this PR's own single commit, which is what I verified directly.

### 2. Hardening logic (session-id fallback, unlock-token forgery defense, control-char stripping) unmodified [CLEAN, code-traced]

Because this PR's own diff contains only the 3 comment-line replacements above and nothing else in either file, the session-id fallback logic, the position-based unlock-token forgery defense (Issue #277), and the control-character stripping (Issue #278) are provably byte-identical to what shipped in PR #279 -- not inferred, directly evidenced by the diff itself containing zero other changed lines in these two files.

### 3. Test suite -- 1090/1090, 0 fail, 0 skipped [CLEAN, demonstrated]

At the true PR head: tests 1090, pass 1090, fail 0, cancelled 0, skipped 0, todo 0. Matches the PR's own claim exactly. (My first test run, against the wrong pre-fix commit with the ADR submodule still uninitialized, showed 1089/1090 with one failure -- the reference-resolver's own dogfood test, failing because ADR-0021 was unresolvable with the submodule empty. This was a review-environment artifact, not a PR defect: re-running with the submodule initialized reproduced 1090/1090 clean even at the wrong commit, confirming the fail had nothing to do with this PR's 3-line change.)

### 4. Secret scan -- PASS, 0 blocking [CLEAN, demonstrated]

The history-scan tool at the true PR head reported: "PASS: Full history scanned, 0 blocking secret-shaped matches found (2273 allowlisted)."

### 5. QA-14 citation-resolver claim -- verified true, not just asserted [CLEAN, demonstrated]

Ran the reference-resolver against the master baseline, comparing the true PR head to the pre-fix commit:
- At the true PR head: "FAIL: 7 of 327 citation(s) failed to resolve; 56 more unclassified (non-blocking)." Remaining 7 are all in docs/REVIEW_LOG.md and docs/reviews/*.md (out of this PR's stated scope; 3 cross-repo-issue + 4 unresolved-authority), none in either hook file.
- At the pre-fix commit (for contrast): "FAIL: 10 of 330 citation(s) failed to resolve." The 3 extra unresolved citations were exactly the ones in hooks/sessionstart-tool-enum.mjs (the .claude/settings.local.json path, the issue-6574 citation) and hooks/userpromptsubmit-halt-relay.mjs (the process.stdout/stderr.write citation).

This directly confirms the PR's claim: exactly 3 of the 10 originally-flagged citations are resolved by this diff, and they are precisely the 3 the PR describes. The other 7 (in review-report markdown files, not in scope for this PR) remain, consistent with "a targeted fix for 3 of the 10."

### 6. Self-documentation accuracy after rewording [CLEAN, code-traced]

Checked whether any of the three rewordings degrade the file's own documentation value for a future security reviewer:
- The upstream reference was reworded to name the same repo and issue number without the hash-mark shape: semantically identical, still unambiguously identifies the same upstream repo and issue. No information lost.
- Dropped backticks around .claude/settings.local.json: purely a Markdown-in-comment formatting choice (the two adjacent backtick-wrapped terms on the same line were left untouched, so the styling is now locally inconsistent -- cosmetic only, not a semantic or security-relevant change). The literal path text is unchanged and still correct.
- "process.stdout/stderr.write" to "process.stdout.write"/"process.stderr.write": this one is an improvement, not just neutral -- the original condensed notation was technically imprecise (there is no such object as process.stdout/stderr); the reworded text names the two real method calls precisely, which better documents the actual constraint (fs.writeSync on raw fds replacing both calls) that a future reviewer auditing the FLUSH-BEFORE-EXIT fix needs to understand.

No rewording weakens the file's self-documentation of a security-relevant constraint.

## Summary

This PR does exactly what it claims: a 3-line, comment-only wording fix inside two CRITICAL-tier sensitive-area hook files, closing 3 of the 10 citations that have kept master's QA-14 CI gate red. No executable logic, string literal, or runtime-evaluated content changed. The session-id fallback, unlock-token forgery defense, and control-char stripping hardening from PR #279 are provably untouched. Tests are genuinely green at 1090/1090, the secret scan is genuinely clean, and the QA-14 citation-count improvement is independently reproduced, not just taken on the PR's word.

No blocking or hardening findings. APPROVE.

## Editorial (non-blocking, informational)

- The review-worktree provisioning for this task started with the ADR submodule uninitialized and, separately, the checkout one commit behind the actual PR head. Neither affected the eventual verdict (both were caught and corrected before this report was written), but a future review of this same worktree-provisioning mechanism might want to confirm worktrees are always seeded at the PR's actual head with submodules initialized, so a less careful pass doesn't silently review the wrong commit.

---
RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][code-traced] hooks/sessionstart-tool-enum.mjs:12,444; hooks/userpromptsubmit-halt-relay.mjs:70 -- all 3 changed lines are inside // comments, zero executable/runtime-parsed content touched, confirmed via direct diff of the true PR commit plus direct line-context reads
2. [CLEAN][code-traced] session-id fallback / unlock-token forgery defense (Issue #277) / control-char stripping (Issue #278) -- provably byte-identical pre/post this PR, since the PR's own diff contains zero other changed lines in either file
3. [CLEAN][demonstrated] full test suite at true PR head -- 1090/1090 pass, 0 fail, 0 skipped, matches PR claim exactly
4. [CLEAN][demonstrated] secret-scan history scan at true PR head -- PASS, 0 blocking secret-shaped matches (2273 allowlisted)
5. [CLEAN][demonstrated] QA-14 reference resolver vs master baseline at true PR head -- 7 of 327 unresolved (down from 10 of 330 pre-fix), the 3 newly-resolved are exactly the 3 this PR targets, independently reproduced not just asserted
6. [CLEAN][code-traced] self-documentation accuracy of the 3 reworded comments -- 2 neutral, 1 (process.stdout/stderr.write split) an actual precision improvement; no security-relevant meaning lost
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=0 suspicions=0 clean=6
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=3 code-traced=3 derived=0
checks="1090/0/0|n/a"
adr=HIT(2, expanded to 37 via non-destructive submodule init)
report=docs/reviews/qa14-ci-red-citation-wording-app-security-2026-09-23.md
