# Code Review (Anubis) -- round-2 re-confirm -- s1-closeout-164-154 (Issues #164 + #154)

Reviewer: code-reviewer (Anubis)
Date: 2026-09-13
Branch: fix/s1-closeout-164-154 @ 713dbdd, base master @ ad196c5
Diff scope (as instructed): git diff b9fed71 713dbdd (round-1 build to round-2 fix-now)
Tier: CRITICAL (unchanged, ratified docs/run-log.jsonl 2026-09-13T23:08:44)
ADR cache: ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23], fingerprint 83b2e3e -- unchanged from round 1.

## ADR slice read (my domain: code, testing, error-handling, maintainability)

adr/software-engineering/0003-solid-principles.md, 0005-testing-strategy-playwright.md, 0010-code-quality-and-maintainability.md, 0021-thoth-native-architecture.md. No applicable ADR is violated by this round diff -- no BLOCKER. Same conclusion as round 1; the round-2 diff stays entirely inside src/qa/, src/lib/git.ts, and review/doc artifacts -- no kernel/gate/audit-log/Action-record surface touched.

## Scope of this pass

Round 1 (my own prior report, docs/reviews/s1-closeout-164-154-code-2026-09-13.md) gave SHIP with one LOW cosmetic finding, unrelated to this round. This pass re-confirms the round-2 fix-now diff that closed cross-domain-reviewer 1 HIGH + 1 MED and red-team 3 MED findings. Reviewed for: correctness of the ENOENT-only catch narrowing, correctness of lsFilesWorkingTree() submodule-mode-filter logic, gaps in assertKnownArgs(), whether the new/modified tests actually exercise edge cases, dead code/style, and disposition of my own round-1 LOW finding.

## Finding 1 -- HIGH, demonstrated -- the round-2 fix-now own NEW regression test is itself flaky under real concurrent npm test load

Round 2 fixed cross-domain-reviewer HIGH (#170: the OLD two-live-subprocess byte-identity test was flaky, about 17 percent over 6 runs) by replacing it with single-spawn assertions, AND separately added a brand-new real-subprocess regression test for Issue #172 (marker-corpus-probe.test.ts:147-172, the "a genuinely untracked, uncommitted, scannable file IS now counted" test). That #172 test performs the exact same risky shape the #170 fix just eliminated elsewhere: two live, timing-sensitive full-tree-scanning subprocess spawns of the real CLI (before/after), separated by a real writeFile to the actual repo working tree, under real npm test concurrency (no --test-concurrency=1 set; package.json "test": "node --test").

Demonstrated, raw, this session (I ran the full suite myself, independently, twice):

Batch 1 (loop of 3 full npm test runs, default concurrency):

run 2 of 3:
AssertionError [ERR_ASSERTION]
actual: 1023, expected: 1025, operator: strictEqual

Batch 2 (4 more full-suite runs, default concurrency, a separate later invocation):

run 4 of 4:
FAIL QA-14 marker-corpus-probe (real subprocess, regression): a genuinely untracked, uncommitted,
scannable file IS now counted -- list and content agree on the same tree state (2386.156ms)
AssertionError [ERR_ASSERTION]: an untracked file with 1 marked + 1 unmarked bare hash-N citation
must raise the total by exactly 2 -- if it does not, the file list and content have drifted
back to two different tree states
1021 !== 1025
actual: 1021, expected: 1025, operator: strictEqual

Both failures are the same test (marker-corpus-probe.test.ts:147), both under plain default concurrency (no elevated --test-concurrency needed to trigger it), both showing the total drifting by more than the file own +2 -- i.e. the same class of defect #170 was filed for (a live, uncontrolled working-tree read racing against concurrent process/IO load), now reintroduced in this round own new test. 2 failures in 7 independent full-suite runs this session (about 29 percent), all isolated to this one test -- confirmed NOT reproducible in isolation (5/5 clean, node --test src/qa/marker-corpus-probe.test.ts alone) or in a 3-file combo of every real-subprocess-scanning test file in this repo (6/6 clean) -- it needs the full suite process/IO contention to manifest, exactly like #170 did. Cleanup (finally unlink) held in both failure cases -- no leftover scratch file, confirmed via git status --porcelain after.

A concurrently-running cross-domain-reviewer round-2 report (docs/reviews/s1-closeout-164-154-cross-domain-round2-2026-09-13.md, filed to this same working tree during my own review session) claims 10/10 clean full-suite runs (5 default + 5 at --test-concurrency=64) -- but that pass was scoped to re-confirming the old #170 test fix and a seam-check of new surfaces, not a dedicated stress test of this specific new test; at my own observed about-29-percent single-run failure rate, a clean 10-run sample has a non-trivial chance of occurring by chance alone (roughly 3-10 percent depending on the true underlying rate) -- the two results are not in real conflict, they are both consistent with a real, stochastic, load-triggered race that my own raw output demonstrates directly.

Exposure: about 20-30 percent of full local/CI npm test runs, basis: measured (2 failures out of 7 independent full-suite runs, this session, raw output quoted above) -- every future CI run and local npm test inherits this indefinitely since the test is now committed; this is the exact same spurious-red-run-looks-like-a-real-regression harm cross-domain-reviewer already named for #170, now reintroduced by the same round own fix.

Minimal fix: apply the same fix-shape cross-domain-reviewer already prescribed for the #170 test -- stop asserting a before/after property across two independently-timed live CLI subprocess spawns of a full-tree-scanning probe under concurrent load. Either (a) export the file-collection helper and call it directly, in-process, twice (write the scratch file, call collectFullTreeFileTexts/computeMarkerCorpusStats directly rather than spawning node src/qa/marker-corpus-probe.ts twice), removing the double-subprocess timing dependency while still exercising the real fix; or (b) keep the CLI-subprocess shape for one call only and assert the delta against an in-process computeMarkerCorpusStats call for the other side.

## Finding 2 -- round-1 LOW (floating duplicate comment block) -- NOT addressed, still present

My round-1 report flagged marker-corpus-probe.ts:33-44: a floating, undeclared-attachment Issue #164 comment block duplicating the JSDoc at collectFullTreeFileTexts (then :119-123). Round 2 did not fold this in -- it instead grew the floating block (now :33-55, adding a second stacked paragraph for Issue #172) and left the collectFullTreeFileTexts JSDoc (now :150-161) still restating the same core mechanism, this time with an explicit back-reference note rather than a full re-explanation. This is a smaller duplication than round 1 version, but the underlying issue -- a substantial explanatory block floating between the import list and the first real declaration, unattached to anything -- is still there and slightly larger. Non-blocking, cosmetic. Minimal fix unchanged: fold the floating block content into the collectFullTreeFileTexts JSDoc it already points back to, delete the floating copy.

## Correctness checks requested by this round dispatch

ENOENT-only catch (marker-corpus-probe.ts:162-185, continuation-residual-probe.ts matching lines) -- CLEAN, code-traced. ENOENT is the one case where a listed path can legitimately vanish before readFile runs (deleted between listing and reading). No other error code deserves the same silent-skip treatment for this instrument stated purpose: EISDIR (a listed path is actually a directory -- should not happen given the submodule filter below, and if it does, it is a real anomaly worth surfacing, not silently masking) and EACCES/EMFILE/etc are all real failures that would previously have silently undercounted; now they propagate loud, matching the fix own stated intent and this project git.ts-established do-not-swallow-into-a-silent-pass discipline (Issue #18 precedent). No missed legitimate-skip case found.

lsFilesWorkingTree() submodule-mode-filter (src/lib/git.ts:141-162) -- CLEAN, code-traced plus demonstrated. Verified directly against the real repo: git ls-files -z -s --cached piped to grep 160000 confirms adr is the only mode-160000 (submodule gitlink) entry, correctly excluded by the mode-equals-160000 check. Two-call design (--cached mode-filtered, --others not) is correct: an untracked path can never be a submodule gitlink (a submodule is always index-tracked), so only the cached half needs the mode check -- confirmed no nested submodule exists under adr/ today that a future-proofing gap could miss. New tests (git.test.ts) cover this directly: a real submodule-shaped fixture (mode 160000) is excluded, and an empty tree returns an empty array not an array with one empty string. One minor inconsistency, code-traced, LOW, non-blocking: cached entries are pushed via a raw slice (no trim), but others entries go through a per-line trim -- an asymmetry that would only matter for a real filename with meaningful leading/trailing whitespace (vanishingly rare in this repo), but the two code paths should treat paths identically for consistency sake.

assertKnownArgs() gaps -- CLEAN, code-traced. An empty --field= value and a wrong-case --field=Total value both pass assertKnownArgs shape check (they start with the --field= prefix), then fail with a clear, quoted error from the pre-existing (round-1, unchanged this round) parseMarkerCorpusField. No silent gap. Neither case has its own dedicated test (the closest existing test, parseMarkerCorpusField throws on an unrecognized field value, only covers --field=bogus), but parseMarkerCorpusField itself is unchanged by this round diff -- this is a pre-existing, out-of-scope test-coverage gap, not a regression; behavior is correct by direct code trace either way.

Test quality -- mostly strong, one weak spot (Finding 1 above). The new assertKnownArgs tests exercise four distinct bad-shape cases (bare ref-like token, HEAD~5, unknown flag, valid flag plus stray positional) plus a pure deterministic unit test with no I/O -- good edge-case coverage, not just the happy path. The lsFilesWorkingTree tests exercise the submodule-mode-filter and the empty-tree case directly. The one place test quality is actually weak is Finding 1 own new test, which is exactly the class of test this round was supposed to be hardening against.

Dead code / unused imports / style -- CLEAN. The now-unused resolveChangedFiles import correctly removed from marker-corpus-probe.ts (only makeGitOps remains imported from the git lib). npm run lint and npm run typecheck both clean (re-ran myself, not taken on the receipt). No new TODO/FIXME introduced (checked via diff grep). Style consistent with the rest of both files (comment density, JSDoc shape, error-message shape all match existing conventions).

continuation-residual-probe.ts own assertKnownArgs-equivalent gap -- CLEAN, correctly disclosed, not a regression. Confirmed by code-trace: continuation-residual-probe.ts still silently accepts a stray positional argument (its own test at continuation-residual-probe.test.ts:161 explicitly asserts this). This is explicitly, consistently disclosed as scoped-out in three places (CHANGELOG.md, docs/STATE.md, red-team own round-1 report calling it a backlog line, not this diff) -- correctly not gold-plated in, and not silently inconsistent.

## Verification, real (re-run myself, not taken on any receipt)

- npm run typecheck -- clean.
- npm run lint -- clean.
- node src/qa/completeness-claim-checker.ts -- PASS: 2 files checked, all completeness claims verified.
- npm test (full suite) -- 2 failures observed in 7 independent full-suite runs this session (raw output quoted in Finding 1); isolated re-run of marker-corpus-probe.test.ts alone: 5/5 clean (12/12 tests each); 3-file combo (marker-corpus-probe.test.ts plus completeness-claim-checker.test.ts plus continuation-residual-probe.test.ts) together: 6/6 clean (57/57 tests each).
- git ls-files -z -s --cached piped to grep 160000 -- confirmed adr is the repo only submodule gitlink, correctly excluded by the new mode filter.
- git status --porcelain -- confirmed no leftover scratch file after either observed test failure (cleanup held).

## Verdict

SHIP-AFTER-FIXES. One HIGH, demonstrated: this round own new regression test (Issue #172 proof-test) reintroduces the identical flaky-under-load defect class Issue #170 was filed and fixed for elsewhere in this same diff -- a real, measured (about 29 percent in my sample), silent-until-CI-runs-it reliability defect in the shipped test suite. Everything else in this round diff -- the ENOENT-only catch narrowing, the submodule-mode-filter logic, assertKnownArgs() coverage, dead-code/style -- is correct and well-tested. This does not indicate a logic defect in the shipped production code paths (git.ts, marker-corpus-probe.ts actual fix logic); it is confined to how one new test proves that fix.

Praised decision: applying the ENOENT-vs-blanket-catch fix to BOTH twin files (marker-corpus-probe.ts and continuation-residual-probe.ts) in the same pass, rather than just the one that happened to flake first, closes an identical latent defect before it had its own chance to bite -- exactly the kind of one-fix-both-twins discipline this file family history rewards.

## Single next action

Fix Finding 1: replace the untracked-file regression test two live CLI-subprocess spawns with a direct, in-process call to the underlying file-collection helper (or keep one CLI spawn and assert the delta against a direct in-process call for the other side), removing the double-subprocess timing dependency; re-run the full suite at least 10x consecutively under default concurrency (not just elevated concurrency) to confirm the flake is gone, then re-dispatch this review round.

---

RECEIPT: verdict=SHIP-AFTER-FIXES
findings (ALL of them, one terse line each, ranked by severity):
1. [ISSUE][HIGH][demonstrated] src/qa/marker-corpus-probe.test.ts:147-172 -- this round own new Issue #172 proof-test reintroduces the identical flaky-under-concurrent-load defect class Issue #170 was just fixed for elsewhere in this diff (two live CLI subprocess spawns racing a real working-tree write); demonstrated failing twice in 7 independent full-suite runs this session (about 29 percent), raw AssertionError output quoted, not reproducible in isolation or a 3-file combo -- fix by asserting via a direct in-process function call instead of two live subprocess spawns.
2. [ISSUE][LOW][code-traced] src/qa/marker-corpus-probe.ts:33-55 -- my own round-1 LOW finding (floating, undeclared-attachment duplicate comment block) was not addressed this round; it grew slightly instead -- fold into the collectFullTreeFileTexts JSDoc it already back-references, delete the floating copy.
3. [ISSUE][LOW][code-traced] src/lib/git.ts:150-161 -- lsFilesWorkingTree() others array is trimmed per path but the cached array is not, an inconsistency that could mis-handle a real filename with meaningful leading or trailing whitespace -- align the two code paths.
4. [CLEAN][code-traced] readFile catch narrowed to ENOENT-only in both marker-corpus-probe.ts and continuation-residual-probe.ts is the correct and complete set of legitimate skips; no other error code deserves silent-skip treatment, confirmed by direct trace.
5. [CLEAN][code-traced][demonstrated] lsFilesWorkingTree() submodule-mode-filter (mode 160000) correctly excludes this repo real adr submodule, confirmed via direct git ls-files -s read; two-call cached/others split is logically sound (only cached can ever be a submodule); no nested submodule exists to miss today.
6. [CLEAN][code-traced] assertKnownArgs() has no gap for an empty --field= value or a wrong-case --field=Total value -- both fail loud with a clear, quoted message via the pre-existing (unchanged) parseMarkerCorpusField; behavior correct despite no dedicated new test for these two exact shapes.
7. [CLEAN][code-traced] No dead code, unused imports, or style drift -- resolveChangedFiles import correctly dropped from marker-corpus-probe.ts, lint and typecheck both clean, style consistent with the rest of both files.
8. [CLEAN][code-traced] continuation-residual-probe.ts own stray-argument-swallowing gap (the #173 twin) is explicitly, consistently disclosed as scoped-out this round (CHANGELOG.md, docs/STATE.md, red-team own report) -- not gold-plated in, not silently inconsistent.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=3 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=8 derived=0
checks: typecheck clean; lint clean; completeness-claim-checker PASS 2 files; npm test full suite 2 fail of 7 runs raw output in report both isolated to marker-corpus-probe.test.ts line 147; npm test isolated marker-corpus-probe.test.ts alone 5 of 5 clean 12 of 12 each; npm test 3-file combo 6 of 6 clean 57 of 57 each; git ls-files submodule check confirmed adr is the only 160000 entry; git status porcelain after failure no leftover scratch file
adr=HIT(35)
report=docs/reviews/s1-closeout-164-154-code-round2-2026-09-13.md
