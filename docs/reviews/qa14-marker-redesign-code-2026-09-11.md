# Code review -- qa14-marker-redesign

Reviewer: code-reviewer (Anubis)
Date: 2026-09-11
Scope: src/qa/reference-resolver.ts + .test.ts
Tier: CRITICAL

Part A written OK

## ADR compliance

ADR-0005, Rules for agents: "MUST write unit tests for every new/changed domain or application behavior -- happy path, error paths, and boundaries." VIOLATED -- BLOCKER.

## Plan-vs-diff fidelity

CITATION_MARKER_WORD_RE, GH_MARKER_RE, and LIST_CONTINUATION_RE are byte-identical to the plan.

## Verification

npm test -> tests 708, pass 708, fail 0, skipped 0
npm run typecheck -> clean
npm run lint -> clean

Real-corpus:
  before: FAIL: 34 of 515 citation(s) failed to resolve.
  after:  FAIL: 23 of 527 citation(s) failed to resolve; 93 more unclassified (non-blocking).
34 -> 23 confirmed exactly.

## Mutation test

Mutated LIST_CONTINUATION_RE to drop the dash/en-dash/em-dash class members.
npm test -> tests 708, pass 708, fail 0 (mutation survives -- nothing exercises this branch)

Manual probe on shipped code:
  "Closes #139-#142 in this batch." -> both #139 and #142 resolved
  "Fixed #105<endash>#113 upstream." -> both #105 and #113 resolved
  "Resolves #10<emdash>#12 today." -> both #10 and #12 resolved

File reverted after the mutation test (git diff --stat = empty).

## Findings

### 1. [ISSUE][HIGH] -- dash/en-dash/em-dash list-continuation branch has zero test coverage; ADR-0005 MUST violated
Evidence: code-traced (src/qa/reference-resolver.ts:148) + demonstrated (mutation test above).
This is new behavior -- the pre-redesign continuation regex had no dash support at all; the redesign explicitly adds it, grounded in the code own comment citing real corpus shapes (Issues #105 to #113, parenthesized #139-#142). Nothing in reference-resolver.test.ts exercises a dash-joined citation list. Zero user impact today (the shipped behavior is correct, verified by direct probe), but this is exactly the class of untested regex branch that has produced a real regression in three consecutive prior CRITICAL rounds on this same file, each caught only by red-team, never by self-review. unclassified is non-blocking, so a future regression here would silently degrade a real citation from a verified resolved to an unverified unclassified -- CI stays green, the loss is silent.
Minimal fix: one test asserting a dash-joined marked list resolves both members.
Exposure: 0% of current runs are wrong (code is correct, demonstrated); the risk is to the next regression in this file, whose own track record is 3 of 3 prior rounds where self-review missed a defect of this exact shape.

### 2. [CLEAN] Real-corpus measurement (34 to 23, diff-scope) -- independently reproduced exactly, matches CHANGELOG.md/decisions.md claim precisely.

### 3. [CLEAN] Dead code -- NON_ISSUE_ORDINAL_WORD_RE/shouldExcludeBareIssueMatch fully deleted (grep-confirmed); no orphaned exclusion logic left in any form.

### 4. [CLEAN] Non-regression -- read the assertions, not just the pass count. Closes #120, owner/repo#N, Milestone #N (with a throwing issueExists stub proving the namespace guard), GH#57 (traced: GH_MARKER_RE matches the word-boundary-correct GH token; confirmed no false-positive risk from words that merely contain gh, e.g. though/high, since no word boundary exists mid-word), and Closes #7, #8 (list continuation) all pass for the right reason, not incidentally.

### 5. [CLEAN] The 4 amended tests (2 named in the plan plus 2 found during build: the Issue #141 cross-file-dedup test and the NEW-4 milestone-line-boundary test) -- reasoning verified sound. Both newly-amended cases were genuinely testing the now-intentionally-changed bare-unmarked-#N shape as an incidental side effect of what they were really testing (cache dedup, line-boundary guard); both were correctly reworded to use an explicit marker or to assert the new unclassified/issue-candidate outcome instead, preserving each test real purpose. Not silent test-doctoring -- each carries a dated, explicit comment.

### 6. [CLEAN, demonstrated] summarizeCitations bad/unclassified partition -- traced the all-unclassified edge case by hand (0 bad, N unclassified -> resolvedCount = 0, ok: true, correct summary text) since no test covers it explicitly; the two shipped tests (mixed resolved+unclassified, mixed bad+unclassified) do correctly exercise the gating logic. Minor coverage gap but not a bug -- not filed as a separate finding.

### 7. Editorial -- test-count miscount in CHANGELOG.md/decisions.md
CHANGELOG.md and docs/decisions.md (2026-09-11 row 62) both state 15 new tests added. The actual diff adds 8 new test() functions; one of those 8 (the R4 test) iterates a 15-entry case table internally, which appears to be the source of the miscount (15 cases, not 15 tests). Prose defect, not a code defect -- no re-review needed, fix as a plain edit.

## Missing checks (named)

- No test for LIST_CONTINUATION_RE's dash/en-dash/em-dash class members (Finding 1).
- No explicit test for summarizeCitations on an all-unclassified citation set (traced correct by hand; free to add).

## Verdict: SHIP-AFTER-FIXES

One demonstrated, code-traced ADR-0005 MUST violation (Finding 1) -- a single, cheap, well-scoped fix (one or two new test cases). Everything else in this CRITICAL-tier redesign is sound: the implementation matches the plan mechanism with no drift, the real-corpus measurement was independently reproduced and matches exactly, dead code is fully removed, non-regression tests pass for the right reasons (traced, not trusted), and the 4 test amendments are legitimate, well-documented, non-silent changes.

Praised decision: replacing a negative denylist with a positive marker requirement is the right structural fix for a file that has now produced three consecutive regressions from exactly the unbounded-word-list failure mode -- the redesign eliminates that failure class by construction rather than adding a 13th, 14th, 15th denylist word.

## Single next action

Add one test to src/qa/reference-resolver.test.ts asserting a dash/en-dash/em-dash-joined citation list resolves every member via list continuation, then re-run npm test to confirm it is a genuine pin (fails on the mutation shown above, passes on shipped code).

---

RECEIPT: verdict=SHIP-AFTER-FIXES
findings (ranked):
1. [ISSUE][HIGH][code-traced][demonstrated] src/qa/reference-resolver.ts:148 -- LIST_CONTINUATION_RE dash/en-dash/em-dash class (new behavior this redesign adds) has zero test coverage; mutation removing it leaves 708/708 green (ADR-0005 MUST violated) -- add 1-2 tests for dash-joined citation lists.
2. [CLEAN][demonstrated] Real-corpus measurement (34 to 23 diff-scope) independently reproduced, matches CHANGELOG.md/decisions.md exactly.
3. [CLEAN][code-traced] Dead code (NON_ISSUE_ORDINAL_WORD_RE/shouldExcludeBareIssueMatch) fully deleted, no orphaned exclusion logic.
4. [CLEAN][code-traced] Non-regression tests (Closes #120, owner/repo#N, Milestone #N, GH#57, Closes #7,#8) pass for the right reason, assertions traced individually.
5. [CLEAN][code-traced] 4 amended tests (2 named plus 2 found: Issue #141 dedup, NEW-4 milestone-boundary) -- reasoning verified sound, not silent test-doctoring.
6. [CLEAN][code-traced] summarizeCitations all-unclassified edge case traced by hand, computes correctly (untested but not a bug).
counts (CHECKSUM): issues=1 suspicions=0 clean=5
evidence (CHECKSUM): demonstrated=2 code-traced=5 derived=0
checks="708/0/0 (npm test); typecheck clean; lint clean"
adr=HIT(35)
report=docs/reviews/qa14-marker-redesign-code-2026-09-11.md
