# Code Review — qa14-issue137-precision-fastfollow (Issue #137, R1+R2)
**Reviewer:** code-reviewer (Anubis) — CRITICAL tier
**Date:** 2026-09-13
**Scope reviewed:** uncommitted working-tree diff, git diff --stat:
```
 CHANGELOG.md                               |  16 ++++
 docs/.maat-state.json                      |  25 ++++--
 docs/STATE.md                              |  16 +++-
 docs/decisions.md                          |   1 +
 docs/run-log.jsonl                         |   1 +
 src/qa/continuation-residual-probe.test.ts |   1 +
 src/qa/continuation-residual-probe.ts      |   8 ++
 src/qa/marker-corpus-probe.ts              |   3 +
 src/qa/reference-resolver.test.ts          | 128 +++++++++++++++++++++++++++++
 src/qa/reference-resolver.ts               |  71 ++++++++++++++--
 10 files changed, 256 insertions(+), 14 deletions(-)
```

## ADR compliance
node docs/adr-cache.mjs --ensure -> "ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23]" [CACHE=HIT].
Code-domain slice read from docs/.maat-state.json's adrCatalog.adrs (code/testing/error-handling/maintainability): ADR-0003 (SOLID), ADR-0004 (Idempotency by default), ADR-0005 (Testing strategy), ADR-0006 (Blast radius control), ADR-0010 (Code quality/maintainability gates), ADR-0021 (Thoth-native architecture). No BLOCKER ADR violation found against the code diff itself (see finding 3 for the ADR-0006 "no opportunistic widening" check on the 4 stub sites - clean). cross-domain-reviewer owns the whole-catalog seam pass; not re-derived here.

## Verification - real commands, run myself
- npm run typecheck -> clean (0 errors).
- npm run lint -> clean (0 errors).
- npm test -> 769 pass, 0 fail, 0 skipped (matches the build receipt's claimed 759 carried + 10 new = 769 exactly).
- node src/qa/completeness-claim-checker.ts -> "PASS: 2 file(s) checked, all completeness claims verified." (matches claim).
- Real-corpus measurement, independently re-run (node src/qa/reference-resolver.ts <zero-sha> HEAD, full-tree, current working tree as-is): "FAIL: 144 of 3727 citation(s) failed to resolve; 500 more unclassified." Breakdown: unresolved-authority=119, unparseable=12, cross-repo-issue=13, unclassified=500. This does not match the diff's own claimed numbers (unparseable: 57->3, unresolved-authority: 235->117, unclassified: 498 both times) - see Finding 1, the root cause and full reproduction.

## Findings

### 1. [ISSUE][HIGH][demonstrated] - this diffs own close-out prose reintroduces the exact false-citation shape it just fixed, staling its own before/after claim
CHANGELOG.md:10,16,19, docs/STATE.md:10,13, docs/decisions.md:79, docs/.maat-state.json:687 all write literal ADR-id-shaped example strings in backticks - ADR-12, ADR-1a, ADR-9999, ADR-003, ADR-007 - to illustrate the R2 tightening. These four files are not .test.ts (the only extension shouldScanFile excludes, reference-resolver.ts:534-536), so QA-14s own gate scans their full text on any diff/full-tree run that includes them as changed files - which this PRs own commit will.

Confirmed via the command: git show HEAD:CHANGELOG.md | grep -c ADR-12 (and similarly for the others) that none of these five strings existed anywhere in these four files before this diff - this is wholly new, self-inflicted contamination, not a pre-existing residual.

Reproduced directly (node --experimental-strip-types -e, calling scanReferences on the CHANGELOG.md text):
- unparseable ADR-12 -- ADR id must be exactly ADR-#### (4 digits)
- unparseable ADR-1a -- ADR id must be exactly ADR-#### (4 digits)
- adr unresolved-authority ADR-9999 -- no ADR with this id exists in the tree
- unparseable ADR-003 -- ADR id must be exactly ADR-#### (4 digits)
- unparseable ADR-007 -- ADR id must be exactly ADR-#### (4 digits)

The same 5 strings repeat (each deduped per-file by scanReferences own seen map) in docs/STATE.md, plus ADR-12 again in docs/decisions.md and docs/.maat-state.json - accounting for the gap between the diff claimed final numbers (unparseable: 3, unresolved-authority: 117) and what was independently measured against the actual working tree (unparseable: 12, unresolved-authority: 119).

This is exactly the failure mode reference-resolver.ts own header already names and defends against in its own comments (paraphrased: this file own doc comments deliberately avoid writing a real-looking ADR-#### shape in backticks, fixed by rewording rather than adding a self-exemption) - the developer applied that discipline correctly inside reference-resolver.ts own new comments (explicitly noting real digit-suffix examples deliberately avoided here at lines 95-96 and 375-376) but did not apply the same discipline to the CHANGELOG/STATE.md/decisions.md prose describing the identical examples.

User-facing (CI-gate) impact: the story stated purpose is to reduce QA-14 blocking failures, and this is a CRITICAL-tier story explicitly ratified partly for QA-14 CI-gate blast radius. The artifact that ships also reintroduces about 10 new blocking failures via its own bookkeeping, and the before/after numbers committed to CHANGELOG.md/docs/STATE.md no longer describe the state that will actually be merged.

Minimal fix: reword the five example citations in CHANGELOG.md, docs/STATE.md, docs/decisions.md, and the note_2026-09-13 string in docs/.maat-state.json so they do not literally match the ADR_CANDIDATE_RE shape (e.g. describe shapes without the literal ADR- prefix, or break the token as reference-resolver.ts own comments already do for its own examples) - then re-run the real corpus measurement and correct the published numbers before merge. No code-logic change required.

Exposure: 100 percent of any QA-14 run (diff-scoped or full-tree) against this exact commit - measured directly via node and grep, not assumed.

Filed as GitHub Issue #166 (bug, severity:high, qa).

### 2. [SUSPICION][LOW][derived] - classifyPath now exceeds ADR-0003 SHOULD line-count guidance, and the guidance is currently unenforced
classifyPath (reference-resolver.ts:304-357) is now about 54 lines, versus ADR-0003 SHOULD guidance of under about 40 lines (see ADR-0010 for enforcement). Checked eslint.config.mjs: no complexity or max-lines-per-function rule is actually configured, so this SHOULD is presently a toothless check for this file (lint ran clean regardless). Not a blocker - the function stays linear (a sequence of early returns, no nested branching), and SHOULD is not MUST - naming it because the review lens asks for toothless-check calibration.

### 3. [CLEAN] - the 4 flagged necessary-stub deviations are genuine type-satisfaction shims, verified by tracing consumer logic, not by trusting the comment
Traced both instruments this diff stubs (continuation-residual-probe.ts x2 call sites plus its .test.ts, marker-corpus-probe.ts):
- marker-corpus-probe.ts stubDeps.pathExists is hardcoded to always return true - classifyPath path:line branch never takes the pathExists-false arm at all, so findByBasename is structurally unreachable regardless of its stub body.
- continuation-residual-probe.ts first stubDeps (denominator pass, line 64-73) has the same always-true pathExists shape - same unreachability.
- Its second baseDeps (line 218-239, the real gh-backed numerator pass) uses real pathExists/lineCount, but computeContinuationResidual (line 128-153) only reads citations where markedVia equals continuation - markedVia is undefined for every kind except bare-hash issue citations (per Citation.markedVia own doc comment, reference-resolver.ts:52-56), so a path-kind citation classification, right or wrong, is never read by this instrument own metric either way.
Zero behavior change confirmed by code trace, not assumption. This is a forced consequence of TypeScript structural typing on the widened ReferenceResolverDeps interface (a new required member breaks every existing object-literal construction site), not an opportunistic while-I-am-here widening - ADR-0006 rule against widening a change scope opportunistically is not violated.

### 4. [CLEAN] - R1/R2 core logic matches all 13 acceptance criteria; the 10 new tests are boundary-shaped, not happy-path-only
Traced each AC against code plus a specific test or command:
- AC1-3 (R2 digit-boundary): the tightened ADR_CANDIDATE_RE - manually traced ADR-1a (candidate, classifyAdr still rejects on non-digit suffix, giving unparseable), ADR-amendment / ADR-cache / ADR-NNNN (lookahead fails at the fixed ADR- anchor, zero candidates) - matches all 4 new R2 tests exactly.
- AC4 (pinned reference-resolver.test.ts ADR-12 test): confirmed unedited by the diff (not present in either hunk touching this file).
- AC5/AC6 (classifyAdr byte-identical, other ADR fixtures untouched): confirmed - zero diff lines touch classifyAdr (reference-resolver.ts:236-245).
- AC7 (only path:line branch changes): confirmed - the bare-path/no-line-number branch (348-357) is structurally untouched in the diff.
- AC8-AC11, AC13 (fallback scope, 0/1/2+ match outcomes, in-range/out-of-range): each has a dedicated new test with a call-counting spy (for the two never-called guards) or an explicit deps override (for the 0/1/2+ match cases) - mutation-traced: an implementation that skipped the ambiguity check (always took the first match) would flip the 2+-match test expected unresolved-authority to resolved and fail it; an implementation that bounds-checked against the wrong (cited, not matched) path would return null from lineCount and flip the out-of-range test expected unresolved-authority to resolved and fail it. Both are caught.
- AC12 (findByBasename injected, classifyPath/scanReferences stay pure): confirmed - the only real (non-stub) implementation is built once in main() (reference-resolver.ts:769-789) from a single listFilesRecursive walk reusing the same node_modules/.git exclusion already used for the ADR catalog (verified in src/lib/fs-walk.ts:21); no direct existsSync/readFileSync call was added inside classifyPath (confirmed by reading the full function body).

### Editorial (non-blocking, no re-review needed)
- CHANGELOG.md:10 pinned regression test at reference-resolver.test.ts:47 is off by one line - the actual test(...) call is at line 48 (line 47 is blank, the closing brace of the prior test). Cosmetic.

## Idempotency
N/A - scanReferences/classifyPath/classifyAdr are pure, read-only classifiers; main() performs no mutating writes. Confirmed by read, no ADR-0004 applicability.

## Missing checks by name
None identified beyond finding 2 toothless complexity/line-count lint gate (pre-existing project-wide gap, not introduced by this diff).

## Verdict: SHIP-AFTER-FIXES
The R1/R2 code change itself is correct, well-tested (10 new boundary-focused tests, all traced against plausible mutations), and the flagged stub deviations are genuine, verified no-ops. The one blocking finding is entirely inside this diff own close-out documentation (not its code) and has a trivial, same-scope fix: reword 4 files example citations, then re-run and correct the published corpus numbers.

## Praised decision
Tracing computeContinuationResidual actual consumer logic to confirm findByBasename stub is unreachable, rather than accepting the build report no-behavior-change claim on faith, was the right call, and it held up: the stub sites are exactly what they claim to be.

## Single next action
story-implementer: reword the 5 literal ADR-id-shaped examples in CHANGELOG.md/docs/STATE.md/docs/decisions.md/docs/.maat-state.json so they do not match ADR_CANDIDATE_RE, re-run node src/qa/reference-resolver.ts against the zero-sha and HEAD for real, and correct the published before/after numbers - then this is ready for cross-domain-reviewer.

---

RECEIPT: verdict=SHIP-AFTER-FIXES
findings (ALL of them, one terse line each, ranked by severity):
1. [ISSUE][HIGH][demonstrated] CHANGELOG.md:10,16,19 + docs/STATE.md:10,13 + docs/decisions.md:79 + docs/.maat-state.json:687 write literal ADR-id-shaped examples (ADR-12/ADR-1a/ADR-9999/ADR-003/ADR-007) that QA-14 own scanner picks up as real citations, reintroducing about 10 new blocking failures and staling this diff own claimed unparseable 57 to 3 (actual re-measured: 12) - reword the examples, re-measure, fix the published numbers.
2. [SUSPICION][LOW][derived] reference-resolver.ts:304-357 classifyPath is about 54 lines vs ADR-0003 SHOULD about-40-line guidance; no complexity/max-lines ESLint rule is configured (toothless check), not a blocker.
3. [CLEAN] the 4 findByBasename stub sites (continuation-residual-probe.ts x2 plus its .test.ts, marker-corpus-probe.ts) are genuine type-satisfaction shims - traced each consumer own logic, confirmed structurally unreachable/never-read, no ADR-0006 opportunistic-widening violation.
4. [CLEAN] R1/R2 core logic matches all 13 ACs by code trace plus the 10 new boundary-focused tests (0/1/2+ match, in-range/out-of-range, never-called spy guards); classifyAdr byte-identical, bare-path branch untouched, findByBasename wired once in main(), classifyPath/scanReferences stay pure.
counts (checksum): issues=1 suspicions=1 clean=2
evidence (checksum): demonstrated=1 code-traced=2 derived=1
checks="769/0/0 (npm test); typecheck clean; lint clean; completeness-claim-checker PASS 2/2"
adr=HIT(35)
report=docs/reviews/qa14-issue137-precision-fastfollow-code-2026-09-13.md

---

## Addendum - targeted re-confirm of Issues #166/#167 fixes (same day, second pass)

Reviewer: code-reviewer (Anubis). Scope: the round-2 fix-now diff (all files, current working tree, uncommitted) - re-verifying only #166 and #167 own fixes, not re-litigating R1/R2 (already cleared above).

### ADR compliance
node docs/adr-cache.mjs --ensure -> HIT, 35 ADRs, unchanged since the main report above. Only ADR-0005 (testing strategy, software-engineering) applies to this delta; no violation (new tests added, none deleted/weakened).

### Verification - real commands, run myself
- npm run typecheck -> clean.
- npm run lint -> clean.
- npm test -> 773 pass, 0 fail, 0 skipped (matches claim: 769 carried + 4 new).
- node src/qa/completeness-claim-checker.ts -> PASS: 2 file(s) checked, all completeness claims verified.
- Mutation-demonstrated #167 new pattern myself (independent of the build own claim): commented out the new regex line in completeness-claim-checker.ts, re-ran the 4 new tests in isolation -> tests 4, pass 2, fail 2, skipped 0 (exactly the claimed shape: removing the pattern breaks exactly 2 of 4). Restored the file; git diff --stat confirmed byte-identical to before the mutation.
- Full-tree QA-14, run 3 ways via git stash isolation (node src/qa/reference-resolver.ts 0000000000000000000000000000000000000000 HEAD):
  - everything stashed (true baseline, nothing applied): 299 of 3758 blocking - matches the claimed "before" exactly.
  - only completeness-claim-checker.ts/.test.ts stashed (R1+R2 fix + #166 doc reword applied, #167 not yet applied): 132 of 3733 blocking - matches the claimed diff-scoped "after" figure exactly.
  - full current working tree, nothing stashed (what actually ships): 135 of 3738 blocking (unresolved-authority=117, unparseable=5, cross-repo-issue=13).

### Findings

#### 5. [ISSUE][HIGH][demonstrated] - #166 own contamination bug recurs inside the #167 fix, in a real tracked source file, and the shipped "disclosed residual" note misattributes the cause
src/qa/completeness-claim-checker.ts:138-139 (the new BARE_CLAIM_PHRASES pattern explanatory comment, added this round for #167) quotes the literal digit-bearing tokens ADR-003, ADR-007, ADR-12 verbatim - copied from red-team own report prose, without applying the non-digit-placeholder discipline this same round just used to fix #166 in the four .md/.json files. completeness-claim-checker.ts is NOT a .test.ts file, so shouldScanFile does NOT exempt it (reference-resolver.ts:534-536) - QA-14 scans it like any other source file.

Demonstrated by isolation, not asserted: git stash push on just completeness-claim-checker.ts/.test.ts drops the full-tree blocking count from 135 to 132 - the entire +3 delta is these three tokens (confirmed via grep -n "ADR-003\|ADR-007\|ADR-12" src/qa/completeness-claim-checker.ts -> exactly one hit each, lines 138-139; the pre-existing docs/manager-summary-format.md:97-98 ADR-003/ADR-007 mentions are unrelated and already counted on both sides of this isolation).

This disproves the diff own "Disclosed residual" paragraph (CHANGELOG.md new entry, and its docs/STATE.md/docs/decisions.md mirrors), which attributes the 135-vs-132 gap to code-reviewer own report file (docs/reviews/qa14-issue137-precision-fastfollow-code-2026-09-13.md) quoting the same tokens as evidence, and states explicitly "this is not this round's own contamination." That review-report attribution is factually wrong and independently falsifiable: the report file is untracked (git ls-files | grep -c docs/reviews/qa14-issue137-precision-fastfollow -> 0), and resolveChangedFiles zero-SHA fallback (src/lib/git.ts:52-56) walks git.lsTree, i.e. only committed/tracked blobs - an untracked file can never contribute to this count, full-tree or diff-scoped, committed or not. The real cause is completeness-claim-checker.ts own new tracked comment, which WILL land in the real PR diff once committed, so this is not a benign one-time full-tree artifact: the next real CI run (diff-scoped, base..head) will also see these 3 new blocking failures, because completeness-claim-checker.ts is itself part of the diff being scanned.

This is the exact recurrence class this entire story exists to close - three reviewers (this report own round-1 pass, red-team, cross-domain-reviewer) all checked the four .md/.json files named in Issue #166 but none re-checked completeness-claim-checker.ts own new comment (added to fix #167 in the same round) against QA-14 after the fact.

Minimal fix: reword the comment at completeness-claim-checker.ts:138-139 to use the same non-digit placeholder convention already applied elsewhere this round (e.g. ADR-tooshort, ADR-mixedsuffix, ADR-noentry, matching the pattern CHANGELOG.md/docs/STATE.md already use) instead of ADR-003/ADR-007/ADR-12. The identical string in completeness-claim-checker.test.ts:253 is inert for QA-14 (.test.ts is exempted) but should be rewritten too for internal consistency, at the implementer discretion - not blocking. Then correct the "Disclosed residual" paragraph root-cause claim in CHANGELOG.md/docs/STATE.md/docs/decisions.md (all three still uncommitted, safe to edit pre-commit per this same round own typo-fix-before-anyone-acted precedent) and re-run the full-tree measurement - it should return to 132 once the sole remaining new source is fixed.

Exposure: 100% of the next real CI QA-14 diff-scoped run against this PR once committed - measured directly via git stash isolation, not assumed.

Filed as GitHub Issue #168 (bug, severity:high, qa).

### Re-confirmed findings from the prior pass
- #166 (main report finding 1): genuinely fixed in the four originally-named files. Direct grep of CHANGELOG.md/docs/STATE.md/docs/decisions.md/docs/.maat-state.json for any digit-bearing ADR- shaped token found only pre-existing, real ADR catalog references (ADR-0021, ADR-0006, etc.) - zero remaining literal example tokens of the illustrative kind #166 targeted. The placeholders ADR-tooshort/ADR-mixedsuffix/ADR-noentry are present exactly where claimed.
- #167 (regex correctness): the new pattern correctly catches the exact #166-shaped false-claim sentence and does not false-positive on the real, already-shipped qa1415fix CHANGELOG sentence or on an ordinary "every remaining X" sentence with no parenthetical enumeration - confirmed via the checker own real-corpus PASS run (only 2 files are in DEFAULT_FILES: docs/STATE.md, CHANGELOG.md) plus a project-wide grep for "every/all/each remaining" (docs/decisions.md, docs/plans/, REQUIREMENTS.md, review reports) confirming none of those additional occurrences are in QA-15 scanned file set, so no untested exposure there.

### Verdict: SHIP-AFTER-FIXES (unchanged from the main report, re-confirmed on new evidence)
#166 and #167 are each genuinely fixed in isolation, but the #167 fix reintroduced #166 own defect class in a new location, and the round own written explanation for the resulting number mismatch is wrong. Both are one-line reword fixes with no logic risk - not a reason to escalate to DO-NOT-SHIP, but real enough (demonstrated, code-traced, will hit the real CI diff) to block a clean ship verdict.

### Single next action
story-implementer: reword completeness-claim-checker.ts:138-139 (and optionally .test.ts:253) to non-digit placeholders, correct the "Disclosed residual" paragraph root-cause claim in CHANGELOG.md/docs/STATE.md/docs/decisions.md to name the real cause, re-run node src/qa/reference-resolver.ts <zero-sha> HEAD fresh, and confirm the count returns to 132 - then this is ready for a final one-line re-confirm, not a full round.

---

RECEIPT (addendum): verdict=SHIP-AFTER-FIXES
findings (this addendum only, ranked by severity):
5. [ISSUE][HIGH][demonstrated] completeness-claim-checker.ts:138-139 quotes real ADR-003/ADR-007/ADR-12 (copied from red-team report), a tracked non-.test.ts file QA-14 scans - reintroduces #166 own contamination class (135 vs claimed 132, isolation-demonstrated via git stash), and the diff own "disclosed residual" note misattributes this to the reviewer report (which is untracked and structurally cannot contribute to this count) - reword to non-digit placeholders, correct the root-cause note, re-measure.
6. [CLEAN] #166 fix in CHANGELOG.md/docs/STATE.md/docs/decisions.md/docs/.maat-state.json is genuinely complete - zero remaining literal digit-bearing example tokens, verified by direct grep across all four files.
7. [CLEAN] #167 regex is correctly narrow - mutation-demonstrated (pattern removed -> exactly 2/4 new tests fail, restored -> all pass), catches the exact #166-shaped false claim, zero false positives on the real QA-15-scanned corpus (docs/STATE.md, CHANGELOG.md) or on the already-shipped qa1415fix sentence it was measured against.
counts (checksum): issues=1 suspicions=0 clean=2
evidence (checksum): demonstrated=3 code-traced=0 derived=0
checks="773/0/0 (npm test); typecheck clean; lint clean; completeness-claim-checker PASS 2/2; QA-14 full-tree 299(before)/132(diff-scoped after, #167 excluded)/135(full current tree, #167 included)"
adr=HIT(35)
report=docs/reviews/qa14-issue137-precision-fastfollow-code-2026-09-13.md
