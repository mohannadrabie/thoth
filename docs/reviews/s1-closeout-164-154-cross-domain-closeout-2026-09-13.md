# Cross-Domain Review — s1-closeout-164-154 close-out (commit 04fe9ac + Manager follow-up 92e0b11) — 2026-09-13

Reviewer: cross-domain-reviewer (Ra). Ceremony: lighter, per council ruling (architecture-reviewer's condition 3: cross-domain-reviewer stays seated). No accompanying domain reviewer dispatched this pass; this is the sole verification round before merge/close.

## Lanes covered elsewhere
No code-reviewer/red-team dispatch this round (council's lighter ceremony, Path A). Prior rounds' code-reviewer/red-team/cross-domain-reviewer lanes already covered #164/#154/#170-#179 across 3 CRITICAL rounds (docs/reviews/s1-closeout-164-154-code-round1/2/3, red-team-round1/2/3, cross-domain-round1/2/3, all 2026-09-13). This report covers the council's Path A build task list (commit 04fe9ac) plus the Manager's own separate docs/decisions.md commit (92e0b11), per the assigned task's explicit instruction to check "this actual committed tree" -- current HEAD, not the frozen 04fe9ac snapshot.

## Cross-domain ADR verdict (whole catalog, 35 ADRs, fingerprint 83b2e3e)
- devops ADR-0008 (CI/CD gates and policy-as-code), rule "MUST NOT merge a PR with any blocking gate open, failing, or pending" -- VIOLATED at current HEAD. See Finding 1. This ADR sits outside code-reviewer's usual quality/architecture lane and squarely in cross-domain territory (CI gate state vs a docs commit).
- SE ADR-0010 "failing gates = unfinished work" -- same collision, corroborating.
- SE ADR-0021 (kernel purity), devops ADR-0002 through 0007/0009/0010 (IaC/CDK), SE ADR-0011 through 0015 (data) -- N/A, no infra/kernel/data-layer surface touched.
- No other collision found across the remaining ADRs.

## Findings

### Finding 1 -- HIGH, demonstrated. The close-out's own follow-up commit re-breaks the exact gate it just fixed
docs/decisions.md's new row in commit 92e0b11 ("Council Path A build complete... Manager-verified independently") quotes the identical test-at-example-dot-com literal that Issue #180 was filed and fixed for, in backticks, describing the very set of allowlist entries just added. docs/qa/secret-scan-allowlist.json has NO entry for path docs/decisions.md. Demonstrated two ways against current HEAD (92e0b11):

Command 1: node src/secret-scan/history-scan.ts
Result: FAIL, 1 secret-shaped match found in history (435 allowlisted, not counted). Exit code 1.
The one blocking match: commit 92e0b119..., path docs/decisions.md, patternId email-address.

Command 2: node --test src/secret-scan/history-scan.test.ts
Result: the test named "OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass" FAILS -- assertion false !== true, at src/secret-scan/history-scan.test.ts line 117.

This means npm test itself currently fails on this branch's HEAD, contradicting 92e0b11's own commit-message claim of "npm test (785/785)" and docs/decisions.md's own new row claiming the Manager independently re-ran history-scan.ts to exit 0. Both claims were true against a tree state that did not yet include the very row making the claim -- the identical "checked before the last edit landed" gap that caused Issue #180 (and, before that, #131) in the first place. This is the THIRD occurrence of docs/qa/recurring-findings-registry.md's own newly-added class ("a fix round's own committed artifacts red a gate that only reads committed state") -- inside the same close-out that added that row.

Domains in tension: docs/process discipline (append a decisions.md ruling row, following the story's own precedent of quoting the exact literal for clarity) versus the CI/security gate (OSS-01's exact-path allowlist has zero tolerance for a new, unlisted quote of the literal, anywhere, including prose that documents the fix). Neither lane alone would have caught this: a docs-focused pass has no reason to run history-scan.ts; a code lane was not dispatched this round at all.

Exposure: 100% of any npm test / CI run against this branch's current HEAD, measured (ran both checks myself, raw output above). Irreversibility: OSS-01 scans committed git history -- once this HEAD is pushed, the literal is history-permanent until scrubbed, same class as #180 originally. Silence: not silent -- fails loud, exit 1 / assertion failure, matching #180's own "failing loudly, by design" characterization (architecture-reviewer's council report used the identical framing to justify #180 as mandatory-fix, not a disclosable residual -- the same reasoning applies here unchanged).

Minimal fix: add one docs/qa/secret-scan-allowlist.json entry -- path docs/decisions.md, patternId email-address, with a reason mirroring the 9 entries 04fe9ac already added for this exact literal elsewhere. docs/decisions.md's own append-only convention means the offending row itself is not editable; the allowlist entry is the only correct fix, consistent with how every other prose-quotes-the-exemplar case in this story was resolved.

Filed as GitHub Issue #183 (bug, severity:high, qa, Milestone "S1 -- Protect the baseline").

### Finding 2 -- CLEAN, code-traced. The 9 allowlist entries 04fe9ac added are all legitimate
Cross-checked each of the 9 new entries (marker-corpus-probe.test.ts, CHANGELOG.md, docs/REVIEW_LOG.md, docs/qa/recurring-findings-registry.md, 4 docs/reviews/s1-closeout-164-154 reports, docs/STATE.md) against a direct grep for the literal: exactly these 8 doc/report files plus the one test file contain it, and none of architecture-2026-09-13.md / impact-analyst-2026-09-13.md / red-team-round3-2026-09-13.md do -- no over-broad or missing entry among the 9. Confirmed structurally by partitionAllowlisted's exact path+patternId join (src/secret-scan/history-scan.ts lines 103-114) and by the live scan itself, which shows 0 blocking matches from any of these 9 paths.

### Finding 3 -- CLEAN, demonstrated. No scope creep in 04fe9ac
Diffed c2408ba..04fe9ac file-by-file. Every changed file maps to one of the 4 council-ordered build tasks (#180 allowlist fix, #181 registry row, #182 disclosure comment plus backlog addendum) or to required DoD bookkeeping (CHANGELOG.md, docs/STATE.md, docs/.maat-state.json). The 7 newly-added docs/reviews/s1-closeout-164-154 files are round-3/council report artifacts that should already have existed per the self-persist discipline; committing them here is catch-up, not new scope. No unrelated code changed.

### Finding 4 -- CLEAN, code-traced. #182 disclosure is honest and matches the ruling
src/qa/marker-corpus-probe.ts lines 210-215's new comment states the residual (untracked scratch files drift the published total, measured 1087 to 1106 to 1110) and points at docs/decisions.md's ruling row, which in turn matches the council brief's reasoning (redefining the count would fail the already-shipped Issue #172 regression test) verbatim. No functional change in the diff -- confirmed the diff to marker-corpus-probe.ts is comment-only.

### Finding 5 -- CLEAN, demonstrated. Issue Discipline: #180/#181 closed after their fixing commit
gh issue view timestamps: #180 closed 2026-09-14T03:02:52Z, #181 closed 2026-09-14T03:02:56Z, both after commit 04fe9ac's authored time (2026-09-13 22:47:45 -0400, equal to 2026-09-14T02:47:45Z). #182 correctly left OPEN (disclosed residual, matches #154's precedent). No recurrence of the #174-class premature-closure defect this round.

### Finding 6 -- CLEAN, demonstrated. recurring-findings-registry.ts and completeness-claim-checker.ts pass for real
node src/qa/recurring-findings-registry.ts: PASS, 2 recurring finding classes logged, all structurally valid.
node src/qa/completeness-claim-checker.ts: PASS, 2 files checked, all completeness claims verified.
Both green against current HEAD. Only history-scan.ts fails (Finding 1).

## Coverage gaps
No domain reviewer (code-reviewer/red-team) ran this pass -- by design, per the council's lighter-ceremony ruling. Acceptable: the remaining scope was isolated single-file fixes, and this pass is the compensating check. Nothing in this diff falls outside a reviewed lane otherwise.

## Editorial (non-blocking, prose only)
CHANGELOG.md's new entry ends with a literal unfilled template placeholder, an "ADR cache: RESULT-placeholder" line immediately following a correct "ADR cache: unchanged" sentence -- a leftover draft artifact, not a claim anyone relies on. Fix as a plain edit next touch.

## Verdict: REWORK
Finding 1 is a demonstrated, currently-failing gate (npm test itself fails at HEAD) that collides with devops ADR-0008's merge-blocking rule. This is not a condition to note and ship -- it is the same class of mandatory-fix-before-merge the council itself already ruled #180 to be, recurring inside the very commit that reported #180 fixed. Minimal fix is one allowlist entry (5 minutes), no new review round warranted once applied -- re-run history-scan.ts and the npm test dogfood assertion after the fix; if both pass, this closes without further ceremony.

## Single next action
Add a docs/qa/secret-scan-allowlist.json entry for path docs/decisions.md, patternId email-address (mirroring the 9 entries already added), then re-run node src/secret-scan/history-scan.ts and npm test against the new commit to confirm both pass for real before closing Issue #183.

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] docs/decisions.md (commit 92e0b11) quotes the test-at-example-dot-com literal with no allowlist entry -- history-scan.ts exit 1 and npm test's OSS-01 dogfood assertion fail at current HEAD; add one docs/qa/secret-scan-allowlist.json entry mirroring the 9 already added.
2. [CLEAN][code-traced] all 9 new allowlist entries in 04fe9ac are legitimate exact matches, none over-broad, none missing.
3. [CLEAN][demonstrated] no scope creep in 04fe9ac -- every changed file maps to the 4 council-ordered build tasks or required DoD bookkeeping; the 7 new review-report files are catch-up self-persistence, not new scope.
4. [CLEAN][code-traced] #182 disclosure comment (marker-corpus-probe.ts lines 210-215) is honest, comment-only, and matches docs/decisions.md's ruling verbatim.
5. [CLEAN][demonstrated] Issue Discipline clean -- #180/#181 closed strictly after commit 04fe9ac's timestamp; #182 correctly left open; no #174-class recurrence.
6. [CLEAN][demonstrated] docs/qa/recurring-findings-registry.ts and docs/qa/completeness-claim-checker.ts both PASS against current HEAD.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=4 code-traced=2 derived=0
checks=node src/secret-scan/history-scan.ts (EXIT=1, 1 blocking/435 allowlisted); node --test src/secret-scan/history-scan.test.ts (1 fail: OSS-01 dogfood assertion); node src/qa/recurring-findings-registry.ts (PASS 2/2); node src/qa/completeness-claim-checker.ts (PASS 2/2 files)
adr=HIT(35, whole catalog)
report=docs/reviews/s1-closeout-164-154-cross-domain-closeout-2026-09-13.md
