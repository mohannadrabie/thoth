# Cross-Domain Review (round 3) -- path-b-precommit-secret-scan -- 2026-09-14

Reviewer: cross-domain-reviewer (Ra)
Branch: feat/path-b-precommit-secret-scan, HEAD `ec11f5c` (working tree clean, verified)
Tier: CRITICAL (unchanged, docs/.maat-state.json scope=path-b-precommit-secret-scan)
Trigger: final targeted re-confirm covering everything since round-2 -- round-3's fix-now (#193/#194/3 LOWs) and round-4 (a Manager-executed git filter-branch history rewrite plus a 6th recurrence of this project's self-referential-allowlist class, caught and fixed live). Neither reviewed before this pass.

## Who else is reviewing this diff

Per the dispatch, this is a targeted re-confirm alongside red-team (its own report covers the attack-shape re-verification of #193/#194/3-LOWs and the rewrite's plumbing correctness -- not duplicated here). My ground per the standing role: the whole ADR catalog (not a lane slice), the seams between what has been reviewed and what has not, and independently reproducing every quantitative claim in the round-3/round-4 close-out prose rather than trusting it.

## ADR cache

node docs/adr-cache.mjs --ensure -> ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- fp 83b2e3e [CACHE=HIT]. Whole catalog re-read unfiltered, same fingerprint as round 1/2 -- no ADR added, removed, or amended since.

## Item 1 -- Was the history rewrite itself sound, and is the SHA-staleness disclosure adequate?

Sound as an engineering decision. git filter-branch --force --tree-filter master..HEAD is the correct, narrowest tool for this shape (rewrite 2 specific commits blob content on a never-pushed branch) -- no squash, no rebase-onto, no destructive rewrite of anything outside the 2 target commits own tree-filter scope. Backed up first via a tag (backup/path-b-before-history-rewrite) before running it -- the right sequencing (a reversible checkpoint exists before an irreversible-feeling operation).

Disclosure is adequate, and correctly shaped for this project own conventions. docs/decisions.md is append-only by this project own explicit rule (never edit a prior row) -- so the correct fix for every earlier row now citing a stale SHA is exactly what happened: a new row (the 2026-09-14 "human approved option 1" row) that states the staleness plainly ("every commit SHA cited in this file rows above this one, for this story, is now stale") and names the recovery pointer (the backup tag), rather than silently rewriting the old rows to fix their now-wrong SHAs. Editing the old rows would itself have been the exact convention violation this project works hard to avoid elsewhere. docs/STATE.md Last updated block carries the identical disclosure. This is the right amount of ceremony -- no case is named where a reader of an old row would be misled without warning, because the new row that supersedes them is exactly where a reader following the resume-point chain forward would land.

One thing worth naming, not blocking: the backup tag own lifecycle (kept until this ships) is stated as intent but has no explicit instruction anywhere for when or who deletes it, nor any note warning it must never be included in a git push (see the seam finding below).

## Item 2 -- Independent cross-check: is HEAD tree content actually unchanged?

Verified directly, not taken on the decisions.md/STATE.md prose. Commands run and their raw output:

  git log --oneline backup/path-b-before-history-rewrite | wc -l   -> 110
  git log --oneline HEAD | wc -l                                    -> 112 (2 more: round-4 own 2 commits)
  git diff d22eae8 fb2bf94   (backup tip vs its rewritten equivalent)  -> empty
  git diff backup/path-b-before-history-rewrite HEAD --stat
    docs/.maat-state.json              |  2 +-
    docs/STATE.md                      | 13 ++++++++++---
    docs/decisions.md                  |  1 +
    docs/qa/secret-scan-allowlist.json | 10 ++++++++++
    4 files changed, 22 insertions(+), 4 deletions(-)

git diff d22eae8 fb2bf94 (the backup tag own tip commit vs. the rewritten branch commit at the same logical point) is EMPTY -- the rewrite changed zero bytes of final tree content at that point in history. The second diff (backup tag vs. current HEAD) shows exactly the 4 files round-4 own 2 commits (923afcd, ec11f5c) touched -- nothing else.

Traced the actual scrub, blob by blob: diffing 4ea1456 to 9e4f34f against a9d68e4 to c70109b (the old-commit to new-commit pairs) shows the only change inside either pair is AKIAFAKEFAKEFAKEFAKE changed to AKIA-FAKEFAKEFAKEFAKE in two docs/qa/secret-scan-allowlist.json reason strings -- a single hyphen inserted to break the secret-shaped literal, nothing else in either commit changed. Commits 1a63416, 1aabb2c, d6a0983, 9f0eb1c (ancestors of the 2 rewritten commits) kept their ORIGINAL SHAs, confirming the rewrite blast radius was exactly the 2 targeted commits and their descendants, never touching unrelated history -- consistent with git own mechanics (a parent SHA is unaffected by a rewrite of its child).

Verdict on item 2: CONFIRMED. The claim that HEAD own tree content is byte-identical, only the 2 historical blobs changed, holds under independent, direct verification -- demonstrated, not derived.

## Item 3 -- Fresh ADR sweep, whole catalog, everything since round-2

Files touched since round-2 HEAD (c70109b) through current HEAD (ec11f5c): CHANGELOG.md, docs/.maat-state.json, docs/REVIEW_LOG.md, docs/STATE.md, docs/decisions.md, docs/qa/recurring-findings-registry.md, docs/qa/secret-scan-allowlist.json, 2 new review reports, src/lib/git-hooks-install.ts plus test, src/secret-scan/history-scan.test.ts, src/secret-scan/pre-commit-scan.ts plus test (git diff c70109b HEAD --stat, 14 files).

- No IaC/CDK/tagging/cost/IAM/pipeline surface touched -- devops ADR-0008 Gitleaks rule stays NOT-APPLICABLE for the same tool-stack-scoping reason established in round 1/2 (ci.yml diff vs master still empty, reconfirmed below).
- No src/(kernel|gates|policy)/, hooks/, or bin/ path touched -- governance-plugin/reference-port ADRs 16-21 not implicated.
- SE ADR-0009 (observability, must not log secrets in logs) -- checked directly, since this diff touches the two files that print scan output: pre-commit-scan.ts own PASS-run suppression change and history-scan.ts printing both route through m.redacted (history-scan.ts:53,120,136 -- redact(m[0]), never the raw match), confirmed via direct read. The pre-commit-scan.ts change (Issue #194 cheap UX fix: result.ok ? { ...result, details: [] } : result) reduces what is printed, does not add a new raw-secret-logging path. CLEAN.
- SE ADR-0003 (DI) -- git-hooks-install.ts change (Issue #193-sibling, existsSync(".git") replaced by runner("git", ["rev-parse", "--git-dir"], ...)) still takes Runner as an injected parameter, no new I/O instantiated inside business logic. CLEAN.
- SE ADR-0010 (no suppressions without justification) -- grepped every .ts/.test.ts file touched since round-2 for eslint-disable/ts-ignore/ts-expect-error: zero matches. CLEAN.
- SE ADR-0005 (testing strategy) -- every production-code change (git-hooks-install.ts, pre-commit-scan.ts) has a matching regression test in the same diff (git-hooks-install.test.ts, pre-commit-scan.test.ts, history-scan.test.ts); round-3 own receipt states these are mutation-verified. Not re-verified independently here -- that is red-team own re-confirm ground this round, not a duplicate finding.

No new ADR collision from round-3 fix-now or round-4 rewrite.

## Item 4 -- Reproduce every quantitative claim independently

git config core.hooksPath -> .githooks. Confirmed: the hook is genuinely wired in this session own working checkout (the root cause named in round-4 own disclosure -- core.hooksPath was never set earlier this session -- is genuinely fixed).

git diff master...HEAD --stat -- .github/workflows/ci.yml -> empty. R5 (CI untouched) holds.

node src/secret-scan/history-scan.ts -> PASS: Full history scanned, 0 blocking secret-shaped matches found (allowlisted count noted). Exit 0, PASS, 0 blocking -- confirmed.

node src/qa/recurring-findings-registry.ts -> PASS: 3 recurring finding class(es) logged, all structurally valid. Confirmed.

TWO CLAIMS DID NOT REPRODUCE -- both against HEAD ec11f5c, working tree clean, nothing local to this session:

npm test: tests 827, pass 826, fail 1, skipped 0. Failing test: src/qa/completeness-claim-checker.test.ts:235 -- "QA-15 (Issue #159, end-to-end, real corpus): CHANGELOG.md and docs/STATE.md -- the exact two files this round corrected -- contain ZERO bare claims after this round own edits". AssertionError: expected no bare claims in docs/STATE.md, found 2: line 4 (Last updated block, "but all 17 commits on the branch got new SHAs") and line 56 ("Backed up first, but all 17 commits on the branch got new SHAs").

node src/qa/completeness-claim-checker.ts: FAIL: 1 of 2 file(s) had a failing completeness claim. docs/STATE.md: 2 of 2 numeric completeness claim(s) failed, both NO INSTRUMENT REFERENCE at the same two lines above, carries no [[completeness: ...]] marker.

This is a genuine, demonstrated, currently-live defect, not a stale-prose discrepancy: round-4 close-out own new prose in docs/STATE.md (lines 4 and 56, "all 17 commits on the branch got new SHAs") trips BARE_CLAIM_PHRASES pattern /\ball\s+\d+\b/i (src/qa/completeness-claim-checker.ts:104) -- confirmed the pattern by direct read, confirmed the trigger by direct grep of the live text. Both docs/decisions.md row 87 and docs/STATE.md Last updated line contain the identical "all 17 commits" phrase (decisions.md is not in the checker DEFAULT_FILES, so it does not gate, but the same bare-claim shape is there too -- worth fixing at the source rather than treating the two files inconsistently).

This is the 7th recurrence of this project own most-repeated defect class (the same shape as Issues #131, #180, #183, #193, #194 own round -- a fix round own close-out prose reintroduces exactly the thing the mechanism it describes was built to catch), just against QA-15 bare-claim gate rather than the secret-scan gate this time. The round-4 close-out own claimed verification (npm test 827/827 pass, 0 fail, 0 skipped; both QA instruments PASS) in both docs/decisions.md and docs/STATE.md is FALSE at the committed HEAD -- either the check was run before the close-out row own final wording was written and never re-run after, or it was never run against the actually-committed content. Either way, per CLAUDE.md Definition of Done (tests green in CI with real counts, failing gates equals unfinished work), this branch is not actually ready for Stage 4/5/5.5 as docs/STATE.md own "Ready for Stage 4/5/5.5" line claims.

Minimal fix (same established, precedented shape this project has used 6 times already): reword the two "all 17 commits" occurrences in docs/STATE.md to avoid the bare-numeric-count shape (for example: "every commit on the branch got new SHAs" -- the count is not load-bearing information, unlike the sed command in the prior recurrence). No new mechanism needed. Filed as GitHub Issue #195 [HIGH].

## Item 4b -- CHANGELOG.md gap (found while reproducing claims)

CHANGELOG.md Path B "Added" section (lines 7-62) has "Fix-now round-1," "Stage-3 round-2 result," and "Fix-now round-3" entries -- but no round-4 entry at all. Grepped the whole file for filter-branch, history rewrite, backup/path-b, round-4/round 4 in the Path B context: zero matches. Round-4 (the git filter-branch history rewrite, the 6th self-referential-allowlist recurrence and its fix, and the core.hooksPath root-cause fix) is documented in docs/decisions.md and docs/STATE.md only. CLAUDE.md Definition of Done names CHANGELOG entry plus STATE.md updated as one paired requirement -- every prior round on this same story satisfied both; round-4 satisfies only one.

Minimal fix: add a short "Fix-now round-4" bullet to CHANGELOG.md existing Path B section, mirroring round-1/2/3 own shape (2-4 sentences: the rewrite, the 6th recurrence plus fix, the root-cause fix, real verification numbers -- once item 4 own fix makes those numbers honest). Filed as GitHub Issue #196 [MED].

## Item 5 -- Do the 2 new STATE.md/decisions.md allowlist entries follow this file own scoping convention?

Read the exact diff (git diff 923afcd^ 923afcd -- docs/qa/secret-scan-allowlist.json) and compared against every other existing entry scoped to these same 2 files:

  docs/STATE.md      | email-address      | s1-closeout-164-154 council Path A build (2026-09-13)...
  docs/STATE.md      | internal-hostname  | cifix post-merge live-debug entry (2026-09-09)...
  docs/decisions.md  | email-address      | GitHub Issue #183: this file own 2026-09-13 row...
  docs/STATE.md      | aws-access-key-id  | (NEW) path-b-precommit-secret-scan HARD STOP row...
  docs/decisions.md  | aws-access-key-id  | (NEW) path-b-precommit-secret-scan HARD STOP row...

Both new entries use the identical path/patternId/reason shape at FILE-LEVEL granularity (no line/value narrowing) -- exactly matching the pre-existing email-address/internal-hostname entries for these same 2 files. This is the established convention for these files specifically: docs/STATE.md and docs/decisions.md are permanently-rescanned narrative logs where a literal can legitimately recur in future prose describing the same incident, so file-level (not line-scoped) is the correct, already-precedented choice here -- this matches Issue #136 own disclosed, human-ruled limitation for patterns.test.ts (file-level is this mechanism only granularity, a known, accepted constraint, not a new gap). Each reason field names the specific story/round and the specific other file it mirrors, consistent with every other entry shape. CLEAN -- no scoping-convention violation.

## Seam-hunt -- a gap outside every named lane coverage

The backup tag itself is an unscrubbed copy of the pre-fix history, with no committed guard against it ever being pushed. backup/path-b-before-history-rewrite points at commits (old 4ea1456, old a9d68e4) whose blobs literally still contain AKIAFAKEFAKEFAKEFAKE (confirmed directly in item 2 diff above) -- the exact secret-shaped literal the entire round-3/round-4 arc exists to scrub out of shared history. docs/decisions.md and docs/STATE.md both say "kept until this ships" but name no explicit deletion step, no "never push this tag" warning, and no Stage-5.5 checklist line. This sits outside every lane dispatched this round: it is not a plumbing-correctness question (red-team own ground), not an app-security probe against the running mechanism (app-security-reviewer, not dispatched this round anyway), and not a code defect -- it is a git-hygiene/process residual that only a whole-picture pass would name. Actual exposure is low today: an ordinary git push origin BRANCH does not push tags by default (needs --tags/--follow-tags/an explicit refspec), and this branch has never been pushed. But the mitigation ("kept until this ships") has no stated trigger for when "ships" is and who acts on it.

Minimal fix: add one line to docs/STATE.md resume point (or the Stage-5.5 pre-merge checklist) naming the backup tag deletion as an explicit pre-push/pre-merge step, and note it must never be included in any git push --tags/--all in the meantime. LOW severity (real but currently unexercised, straightforward, one-line fix) -- not filed as its own Issue per this project own LOW-severity threshold; named here so it is not silently lost.

## Coverage gaps named

- Item 4/4b above are exactly what "reproduce every quantitative claim" exists to catch -- both genuinely uncovered until this pass (round-2 cross-domain report predates round-3/round-4 entirely; red-team own round-3 re-confirm is dispatched this same round but covers a different ground -- attack-shape re-verification of #193/#194/3-LOWs and rewrite plumbing, not close-out-prose/CHANGELOG completeness).
- Everything else in this round diff (git-plumbing correctness of the rewrite itself, the #193/#194/3-LOW fix shapes) sits inside red-team own re-confirm ground this round -- not re-covered here per the redundancy-check discipline; item 2 above is the one overlap point (tree-content verification), independently re-derived here via a different method (direct git diff against the backup tag) rather than restated from any other report.

## Verdict

REWORK. Not because the underlying engineering (the rewrite, items 1/2/3/5) has any defect -- all four are independently confirmed sound. REWORK because this branch own closing claims are demonstrably false against the actual committed HEAD right now: npm test is 826/827 (not 827/827), completeness-claim-checker.ts is FAIL (not PASS), and docs/STATE.md own "Ready for Stage 4/5/5.5" line is not currently true. Per the Evidence Policy, a HIGH backed by demonstrated evidence requires a non-clean verdict, and Definition of Done is explicit that a failing test is unfinished work regardless of how small or well-precedented the fix is. The fix itself is trivial and fully precedented (reword 2 bare-claim phrases in docs/STATE.md, no new mechanism) -- this should be a fast, single mechanical fix-now pass, not a new design round, mirroring exactly how this project has closed the same recurring class 6 times before.

Single next action: story-implementer fix-now: (1) reword docs/STATE.md 2 "all 17 commits" occurrences (lines 4, 56) to avoid BARE_CLAIM_PHRASES, re-run npm test and node src/qa/completeness-claim-checker.ts to confirm genuinely green; (2) add the missing round-4 CHANGELOG.md entry; (3) optionally, add the backup-tag pre-push deletion note. Then Stage 4 (verify)/5 (audit)/5.5 (pre-merge full-read gate) -- no fresh Stage-3 review round needed for this pass, same precedent this story has already used twice (round-4 own history-rewrite fix, and s1-closeout-164-154 own directly-Manager-caught corrections).

## Editorial (verdict-neutral, plain edits, no re-review)

- docs/decisions.md row 87 carries the identical "all 17 commits" bare-claim shape as docs/STATE.md (not gating, since decisions.md is not in the checker watched files, but worth the same reword for consistency when the STATE.md fix lands).

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius -- status [ISSUE]=confirmed collision/gap / [SUSPICION]=unconfirmed, needs a second look / [CLEAN]=seam checked, sound; evidence tag per PRINCIPLES rule 19):
1. [ISSUE][HIGH][demonstrated] docs/STATE.md:4,56 -- round-4 own "all 17 commits" bare-claim prose trips QA-15 BARE_CLAIM_PHRASES; live at HEAD ec11f5c: npm test 826/827 (1 fail), completeness-claim-checker.ts FAIL -- contradicts the round-4 close-out own claimed 827/827/PASS. Fix: reword both occurrences, same established non-numeric-claim shape. Issue #195.
2. [ISSUE][MED][code-traced] CHANGELOG.md Path B section has no round-4 entry (grep confirms zero matches for filter-branch/history rewrite/round-4 in the file) -- Definition of Done requires CHANGELOG + STATE.md paired; only STATE.md/decisions.md got one. Fix: add a "Fix-now round-4" bullet mirroring round-1/2/3 own shape. Issue #196.
3. [ISSUE][LOW][code-traced] backup/path-b-before-history-rewrite tag own commits still contain the raw AKIAFAKEFAKEFAKEFAKE literal (confirmed via diff), "kept until this ships" names no explicit deletion trigger or push-safety warning. Fix: one-line pre-push/pre-merge deletion note in STATE.md resume point or the Stage-5.5 checklist. Not filed as an Issue (LOW).
4. [CLEAN][demonstrated] History-rewrite tree-content claim independently re-verified: git diff between the backup tag tip and its rewritten equivalent is empty; the only bytes that changed anywhere in the 2 targeted commits are the single hyphen inserted into AKIAFAKEFAKEFAKEFAKE to become AKIA-FAKEFAKEFAKEFAKE.
5. [CLEAN][code-traced] SHA-staleness disclosure in docs/decisions.md/docs/STATE.md is adequate and correctly shaped for this project own append-only convention (new row, not an edit to old rows); no case found where a reader following the resume chain forward would be misled.
6. [CLEAN][demonstrated] No new ADR collision, whole catalog re-checked, across all 14 files touched since round-2: no IaC/governance-plugin surface touched; SE ADR-0009 (redacted logging only, m.redacted everywhere), ADR-0003 (DI preserved in git-hooks-install.ts), ADR-0010 (zero new suppressions), ADR-0005 (every prod change has a matching regression test) all hold.
7. [CLEAN][demonstrated] The 2 new docs/STATE.md/docs/decisions.md allowlist entries (aws-access-key-id) match this file own established file-level-granularity convention for these exact 2 files, byte-identical shape to the pre-existing email-address/internal-hostname entries.
8. [CLEAN][demonstrated] git config core.hooksPath = .githooks confirmed genuinely active in this session own working checkout (round-4 own disclosed root-cause fix holds).
9. [CLEAN][demonstrated] R5 (CI untouched) reconfirmed: git diff master...HEAD --stat -- .github/workflows/ci.yml empty. history-scan.ts and recurring-findings-registry.ts both reproduced PASS exactly as claimed.
counts (checksum): issues=3 suspicions=0 clean=6
evidence (checksum): demonstrated=7 code-traced=2 derived=0
checks=core.hooksPath:.githooks npm-test:826/827(1-fail) completeness-claim-checker:FAIL(1-of-2) history-scan:PASS(0-blocking) recurring-findings-registry:PASS(3) ci.yml-diff:empty git-diff-backup-vs-rewritten:empty git-status:clean ADR-cache:HIT(fp-83b2e3e-unchanged)
adr=HIT(35, whole catalog)
report=docs/reviews/path-b-precommit-secret-scan-cross-domain-round3-2026-09-14.md
