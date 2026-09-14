# Code Review (Anubis) -- round-3 re-confirm -- s1-closeout-164-154 (Issues #164 + #154)

Reviewer: code-reviewer (Anubis)
Date: 2026-09-13
Branch: fix/s1-closeout-164-154 @ c2408ba, base master @ ad196c5
Diff scope (as instructed): git diff 713dbdd c2408ba (round-2 fix-now -> round-3 fix-now)
Tier: CRITICAL (unchanged, ratified docs/run-log.jsonl 2026-09-13T23:08:44). This is the round immediately before PRINCIPLES rule 16(c) mandatory-council trip-wire (2 consecutive REWORK-class rounds already recorded in docs/.maat-state.json: reviewRoundsSinceClean=2, reviewRoundsTotal=2).

## ADR compliance

node docs/adr-cache.mjs --ensure returned: ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- fp 83b2e3e [CACHE=HIT]. Unchanged fingerprint from rounds 1/2. My domain slice (code/testing/error-handling/maintainability): ADR-0003 (SOLID), ADR-0004 (idempotency), ADR-0005 (testing strategy), ADR-0010 (code quality/maintainability). No applicable ADR is violated by this round diff -- the diff stays inside src/qa/, src/lib/git.ts, and doc/report artifacts; no kernel/gate/audit-log/secret-scan-mechanism surface touched (the secret-scan allowlist DATA file is affected as a consequence, see Finding 1, but the diff itself does not touch src/secret-scan/* or .github/workflows/ci.yml). No BLOCKER from my own ADR slice.

## Scope of this pass

Round 2 (my own prior report) gave SHIP-AFTER-FIXES on one HIGH (Issue 176, the flaky Issue 172 proof-test) plus 2 LOW findings (floating duplicate comment; lsFilesWorkingTree trim asymmetry). This round dispatch asked me to: (1) verify Issue 176 fix (mkdtemp isolation + in-process assertion) is actually equivalent in what it proves to the old subprocess test, not narrower; (2) check the newly-exported functions do not leak something that should stay private; (3) re-run the suite at high concurrency to confirm 0 flakes; (4) re-check disposition of my own 2 round-2 LOW findings; (5) review Issue 177 (injectable readFileImpl + mutation-pinned ENOENT test) and Issue 178 (slash-suffix directory filter) for quality, not just pass/fail; (6) review Issue 179 deferral wording for honesty.

## Finding 1 -- HIGH, demonstrated -- round 3 itself broke the OSS-01 secret-scan dogfood gate (corroborates cross-domain-reviewer's independently-filed Issue 180)

Found this independently, before reading any other round-3 report, then confirmed cross-domain-reviewer filed the identical defect as Issue 180 with a REWORK verdict (docs/reviews/s1-closeout-164-154-cross-domain-round3-2026-09-13.md). Not re-filed as a new Issue (duplicate-check performed via gh issue list --search, per CLAUDE.md Issue Discipline) -- I posted a corroborating [code-reviewer]-prefixed comment on Issue 180 with my own independent measurements instead.

Demonstrated, raw, this session, repeatedly (full suite run, default concurrency):

    tests 785
    pass 784
    fail 1
    skipped 0

Identical result on 4 more full-suite runs (5 of 5 total), on an isolated re-run of just node --test src/secret-scan/history-scan.test.ts (3 of 3), and again at --test-concurrency=1 (fully serial) -- 8 of 8 runs, deterministic, not a flake. Every failure is the same assertion:

    fail: OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass
    AssertionError: expected a clean pass, got: 1 secret-shaped match(es) found in history (356 allowlisted, not counted)
      c2408bae3c06 src/qa/marker-corpus-probe.test.ts [email-address] an email address (possible personal data): test...[REDACTED 16 chars]

Root cause, code-traced: round 3 own Issue 176 fix added withIsolatedGitRepo() to src/qa/marker-corpus-probe.test.ts (git show 713dbdd:src/qa/marker-corpus-probe.test.ts | grep test@example -> no match, confirming this is new). Line 29: await run("config", "user.email", "test@example.com") -- the identical literal src/secret-scan/history-scan.test.ts already needed its own allowlist entry for (docs/qa/secret-scan-allowlist.json, path src/secret-scan/history-scan.test.ts, patternId email-address). docs/qa/secret-scan-allowlist.json has zero entries for src/qa/marker-corpus-probe.test.ts of any patternId (confirmed via grep) -- the allowlist keys on exact (path, patternId), not on value, so the identical string at a new path is a genuinely new, unallowlisted match.

This directly falsifies this round own stated verification. CHANGELOG.md line 33 claims: "npm test 785/785 pass, 0 fail, 0 skipped, confirmed across 10 consecutive full-suite runs ... zero flakes across every run". The real, current, reproducible number is 784/785, 1 fail, deterministic -- not a flake that disappeared between their run and mine; the failure is committed and permanent (git-history-scanning), reproducing on every invocation. This is CLAUDE.md own named sensitive area (secret scanning / CI gates) and collides with devops ADR-0008 MUST-NOT-merge-with-a-failing-gate rule (cited in full by cross-domain-reviewer report; not re-derived here since it is outside my own domain slice).

Exposure: 100 percent of npm test / CI runs on this branch from commit c2408ba forward, basis: measured (8 of 8 independent reproductions this session, deterministic content match, not concurrency-dependent -- git-history-scanning means this failure is permanent once committed, not transient).

Minimal fix (matches cross-domain-reviewer own, independently arrived at the same way): add one entry to docs/qa/secret-scan-allowlist.json -- path src/qa/marker-corpus-probe.test.ts, patternId email-address, a reason mirroring the existing history-scan.test.ts entry own wording (a reserved-test-domain address used only to configure a throwaway mkdtemp git repo committer identity for one test duration, not a real person address). No code-behavior change needed; the fixture own use of test@example.com is fine (same reserved-domain convention this project already uses twice) -- only the allowlist is one entry short.

## Finding 2 -- Issue 176 equivalence question: is the in-process assertion as meaningful as the old subprocess test?

Answer: yes, not narrowed in a way that loses coverage -- CLEAN, code-traced plus demonstrated.

The new test (marker-corpus-probe.test.ts, around line 184) calls computeMarkerCorpusStats(await collectFullTreeFileTexts(repoDir)) directly, in-process, never spawning the CLI. This removes CLI-argv-parsing/main()-wiring/stdout-print coverage from this specific test -- but collectFullTreeFileTexts itself still calls git.lsFilesWorkingTree() via makeGitOps(realRunner, repoDir), i.e. a real git subprocess against a real, throwaway mkdtemp repo -- the actual production code path under test (list enumeration + content read + the real computeMarkerCorpusStats/scanReferences classifier) is exercised for real, nothing is mocked. Only the outer CLI-process-spawn layer is removed, and that layer is independently exercised elsewhere in the same file: the Issue 156 test (line 113, single subprocess spawn, asserts --field=total output shape) and the Issue 173 test (line 144, single subprocess spawns per bad-argv case) both still exercise main()/argv-parsing/print end-to-end via a real, single (non-racing) CLI spawn. So the full CLI contract remains covered somewhere in this file; the Issue 172-specific test was correctly narrowed to isolate exactly the property it proves (list/content tree-state parity) without duplicating what the other two tests already prove, and without the two-live-subprocess race that made it flaky. This is good test-design instinct (isolate the variable under test), not a coverage regression.

## Finding 3 -- widened export surface (collectFullTreeFileTexts, readFileTexts)

CLEAN, code-traced. Both exports exist solely to let each file own .test.ts call them in-process (the Issue 176 fix whole point). Neither function is in a CLAUDE.md-named sensitive area, neither touches the kernel-purity boundary (ADR-0021 governs src/kernel|gates|policy-rooted code; these are standalone src/qa instrument scripts), and nothing about the exported signatures leaks a secret, a credential, or an internal git-plumbing detail that should stay hidden -- readFileTexts(files, readFileImpl = readFile) and collectFullTreeFileTexts(repoRoot) are both inert, general-purpose helpers. Confirmed the two files readFileTexts bodies are byte-identical (diff of the extracted function bodies -- only the doc-comment text differs, each citing its own file own Issue history) -- deliberate per-file duplication, consistent with this story own established "one enumeration mechanism per file" convention (set at Issue 164 own fix, re-affirmed at Issue 172), not an accidental copy-paste drift. Agrees with cross-domain-reviewer independent read (their report calls this the same non-gating DRY observation).

One genuine but LOW/cosmetic nit, code-traced: reference-resolver.ts line 534 shouldScanFile(repoRelativePath: string) names its parameter repoRelativePath, but both collectFullTreeFileTexts implementations now call it via readFileTexts on ABSOLUTE paths (workingTreeFiles.map(f => resolve(repoRoot, f))), both files. This is not a functional bug -- shouldScanFile only check is "!path.endsWith('.test.ts')", which is invariant to an absolute-vs-relative prefix, and confirmed computeMarkerCorpusStats never reads the fileTexts Map keys, only its values (for (const text of fileTexts.values())), so the path shape has zero effect on the published statistic. Purely a stale parameter name now describing something no longer universally true of its real callers. Not filed as an Issue (LOW/cosmetic, no behavior change).

## Finding 4 -- disposition of my own 2 round-2 LOW findings

Both still open, as CHANGELOG.md itself explicitly discloses ("Two code-reviewer round-2 LOW ... findings are explicitly left open, not silently dropped ... do not trigger CLAUDE.md same-turn Issue-filing rule"). Confirmed directly:
- Floating duplicate comment block: now spans a larger region of marker-corpus-probe.ts (grown again with a new Issue 176 paragraph appended). Still detached from any single declaration, still substantially restated in collectFullTreeFileTexts own JSDoc a few lines below. Third round flagged; still cosmetic, still non-blocking, still correctly disclosed rather than silently ignored this time (an improvement in process even though the nit itself persists).
- lsFilesWorkingTree() cached/others trim asymmetry (src/lib/git.ts around line 157, cached.push(entry.slice(tabIdx + 1)) -- no trim -- vs. others -- .map(l => l.trim())): unchanged, still present, still LOW (no real repo path is affected by this in practice).

Both remain LOW, non-blocking, and honestly disclosed as deferred -- no new finding, no change in disposition.

## Finding 5 -- Issue 177 (injectable readFileImpl + mutation-pinned ENOENT test): quality review

CLEAN, code-traced. readFileTexts(files, readFileImpl = readFile) is a clean, minimal DI seam -- default parameter means every real caller (main(), collectFullTreeFileTexts) is unaffected, only a test needs to pass a fake. The ENOENT-vs-anything-else branch is unchanged logic from round 2 (verified identical), just now exercised by a real test instead of zero tests. The two new tests (per file) are genuinely mutation-proving, not just shape-asserting: one forces a fake EACCES and asserts it propagates (assert.rejects with an EACCES message match), the other forces ENOENT and asserts it is silently skipped -- both branches of the "if ENOENT continue else throw" logic are independently pinned. The CHANGELOG own claim that reverting the narrowing back to a blanket catch was directly verified to flip the new EACCES test red, then reverted, is consistent with what the test own structure would in fact do (a blanket catch-continue would make readFileTexts resolve instead of reject for the broken.md case) -- I did not re-run this specific mutation myself this round (time-boxed), but the test logic is trivially capable of catching it by direct inspection, and the same mutation-proving methodology was already independently demonstrated by me in round 1 for a related test. No dead code, no unused seam.

## Finding 6 -- Issue 178 (slash-suffix directory filter in lsFilesWorkingTree): quality review

CLEAN, code-traced plus demonstrated. src/lib/git.ts around line 157-160 filter -- length greater than 0 and does not end with slash -- is the correct, minimal fix, applied at the right layer (source of the list, not a downstream patch in each of the two probe files that consume it, avoiding the exact "two-copy" drift risk this story has repeatedly had to fix elsewhere). Comment placement is good this time: attached directly to the lsFilesWorkingTree() method own doc comment, not floating (contrast with Finding 4 still-floating Issue 164/172/176 comment). Two tests cover it from different angles: git.test.ts fake-runner unit test pins the exact fake --others output shape (a real untracked file plus a nested-repo-shaped trailing-slash entry -> only the first survives), and marker-corpus-probe.test.ts end-to-end test creates a REAL nested git repo inside a real mkdtemp fixture and confirms the whole probe path (collectFullTreeFileTexts -> computeMarkerCorpusStats) no longer crashes and does not leak the nested repo own citation into the count. Re-ran both tests directly (part of the 3-file combo run below) -- clean.

## Finding 7 -- Issue 179 deferral wording: is it honest?

CLEAN, code-traced. continuation-residual-probe.test.ts test title now reads: "QA-14 continuation-residual-probe (KNOWN GAP, tracked in Issue 179 -- not a contract): a stray positional argument is currently silently ignored, producing a valid working-tree answer rather than failing loud", and its preceding comment explicitly states this "pins CURRENT behavior only -- it is not an endorsement that silently accepting a stray positional/unknown flag is correct," names the twin file already-fixed equivalent (Issue 173 / assertKnownArgs) as the target shape, and states what must replace this test when Issue 179 is fixed. This is materially different from round 2 wording (which asserted the silent-swallow as if correct) and is now accurate, unambiguous, and gives a future implementer the exact replacement shape needed. No overclaim, no hedge-free false confidence.

## Re-run the suite myself: flake re-confirmation for Issue 176

Independent of Finding 1 deterministic OSS-01 failure (unrelated to concurrency), specifically targeting whether the Issue 176 fix (mkdtemp isolation + in-process assertion) is actually flake-free under load:
- node --test src/qa/marker-corpus-probe.test.ts alone, 6 fully concurrent invocations (the exact red-team round-2 repro shape that failed 6 of 6 before this round fix): 6 of 6 clean, 15 of 15 tests each.
- node --test on all three touched test files together (git.test.ts, marker-corpus-probe.test.ts, continuation-residual-probe.test.ts), 3 sequential runs: 3 of 3 clean, 41 of 41 tests each.
- Full suite at --test-concurrency=1 (fully serial) and default concurrency (5 runs): 784/785 every time -- the OSS-01 failure (Finding 1) is the only failure, same test, same assertion, every single run; zero additional flakiness anywhere else in the suite.

The Issue 176 flaky-test defect class is genuinely, verifiably closed. No new flake introduced by round 3 other changes.

## Verification, real (re-run myself, not taken on any receipt)

- npm run typecheck -- clean.
- npm run lint -- clean.
- node src/qa/completeness-claim-checker.ts -- PASS: 2 files checked, all completeness claims verified.
- npm test (full suite) -- 784/785 pass, 1 fail, 0 skipped, deterministic (8 of 8 runs this session; contradicts CHANGELOG.md own "785/785, 0 fail" claim -- see Finding 1).
- node --test src/qa/marker-corpus-probe.test.ts x6 concurrent -- 6 of 6 clean, 15 of 15 each.
- node --test src/lib/git.test.ts src/qa/marker-corpus-probe.test.ts src/qa/continuation-residual-probe.test.ts x3 -- 3 of 3 clean, 41 of 41 each.
- gh issue view on 176/177/178/179 plus git show -s --format=%cI c2408ba -- confirmed Issues 170/171/172/173/176/177/178 all closed strictly after c2408ba own commit timestamp (2026-09-14T01:51:17Z vs. closures at 01:52:32Z through 01:52:50Z) -- the recurring Issue-174-class premature-closure process defect did NOT recur this round.
- gh issue list --search for the OSS-01/allowlist finding -- found Issue 180 already filed by cross-domain-reviewer; posted a corroborating [code-reviewer] comment rather than filing a duplicate.

## Verdict

SHIP-AFTER-FIXES. One HIGH, demonstrated, corroborating an already-independently-filed Issue (180): round 3 own Issue 176 fix introduced a new, unallowlisted secret-scan match that deterministically breaks the OSS-01 dogfood gate and directly falsifies this round own stated "785/785 pass, 0 fail" verification claim. The fix itself is a single, well-understood, one-line allowlist addition -- not a design flaw, not a re-litigation of Issue 176/177/178 own substance, all three of which are correct, well-tested, and (for Issue 176 specifically) now genuinely flake-free under real concurrent load. Everything else reviewed this round -- the equivalence of the Issue 172 in-process test, the widened export surface, Issue 177 mutation-pinned tests, Issue 178 source-layer fix, Issue 179 honest deferral wording, and this round own (finally correct) commit-before-close Issue Discipline -- is clean.

Praised decision: withIsolatedGitRepo() mkdtemp-sandboxed shape (Issue 176) correctly diagnosed and fixed the actual defect class (racing a real CLI subprocess against a shared, live working tree) rather than papering over the symptom with a longer sleep or a retry -- and the round own repo-relative-vs-absolute-path fix folded in alongside it was a genuine, previously-latent bug caught in passing, not gold-plated in.

## Single next action

Add one entry to docs/qa/secret-scan-allowlist.json (path src/qa/marker-corpus-probe.test.ts, patternId email-address, reason mirroring the existing history-scan.test.ts entry), re-run npm test to confirm a real 785/785, then re-dispatch this lane (and red-team, if not yet re-confirmed) for a final round-4 re-confirm -- noting that a 4th non-clean round trips PRINCIPLES rule 16(c) mandatory council per this story own already-recorded round count, so the human/Manager should weigh a small mechanical fix-now vs. going straight to council.

---

RECEIPT: verdict=SHIP-AFTER-FIXES
findings (ALL of them, one terse line each, ranked by severity -- status [ISSUE]=confirmed / [SUSPICION]=unconfirmed / [CLEAN]=verified-sound-worth-naming; prefix every [ISSUE]/[SUSPICION] with severity; tag every finding with evidence tier):
1. [ISSUE][HIGH][demonstrated] docs/qa/secret-scan-allowlist.json (missing entry) -- src/qa/marker-corpus-probe.test.ts line 29 new test@example.com literal (Issue 176 mkdtemp fixture) has no allowlist entry, deterministically fails OSS-01 dogfood gate (784/785, not the 785/785 this round own CHANGELOG/STATE.md/commit message claim), reproduced 8 of 8 times independently this session -- corroborates cross-domain-reviewer already-filed Issue 180 (not duplicated, commented instead); minimal fix is one allowlist entry mirroring the existing history-scan.test.ts precedent.
2. [CLEAN][code-traced][demonstrated] Issue 176 in-process test is not meaningfully narrower than the old subprocess test -- still exercises a real git subprocess and the real classifier via collectFullTreeFileTexts; the CLI/main() contract it no longer covers directly remains covered by two other single-spawn subprocess tests in the same file (Issue 156, Issue 173 tests).
3. [CLEAN][code-traced] Widened export surface (readFileTexts, collectFullTreeFileTexts) leaks nothing sensitive, no ADR collision, deliberate per-file duplication consistent with this story own established convention (confirmed byte-identical bodies via diff) -- not an accidental copy-paste drift.
4. [ISSUE][LOW][code-traced] reference-resolver.ts line 534 shouldScanFile(repoRelativePath) now sometimes receives an absolute path via both probes readFileTexts callers -- no functional bug (suffix check is prefix-invariant, computeMarkerCorpusStats never reads the Map keys) but the parameter name is now stale for some callers -- cosmetic rename candidate, not filed as an Issue.
5. [ISSUE][LOW][code-traced] marker-corpus-probe.ts floating/duplicated Issue 164/172/176 comment block (my own round-1+round-2 finding) still not folded into collectFullTreeFileTexts own JSDoc -- 3rd round flagged, but this round CHANGELOG.md explicitly discloses it as deliberately deferred rather than silently dropped.
6. [ISSUE][LOW][code-traced] src/lib/git.ts lsFilesWorkingTree() cached/others path-trim asymmetry (my own round-2 finding) still unfixed -- also explicitly disclosed as deferred this round, no real repo path affected today.
7. [CLEAN][code-traced] Issue 177 readFileImpl DI seam plus mutation-proving EACCES/ENOENT tests are correct, minimal, and genuinely pin both branches of the ENOENT-vs-propagate logic.
8. [CLEAN][code-traced][demonstrated] Issue 178 slash-suffix directory filter is fixed at the correct layer (source of the list, not duplicated downstream), well-commented (not floating), covered by both a fake-runner unit test and a real end-to-end nested-repo test -- re-ran both, clean.
9. [CLEAN][code-traced] Issue 179 deferral wording is now honest and clear -- states plainly this pins current (wrong) behavior, not a contract, names the exact replacement shape for when it is fixed.
10. [CLEAN][demonstrated] This round own Issue Discipline: Issues 170/171/172/173/176/177/178 all closed strictly after commit c2408ba own timestamp -- the recurring Issue-174-class premature-closure process defect did not recur this round.
11. [CLEAN][demonstrated] Re-confirmed 0 flakes for the Issue 176 fix specifically: 6 of 6 concurrent isolated runs of marker-corpus-probe.test.ts (15 of 15 each), 3 of 3 runs of the 3-file combo (41 of 41 each), full suite at concurrency=1 and default (5 runs) -- 784/785 every time, only Finding 1 OSS-01 failure, nothing else flaky.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=4 suspicions=0 clean=7
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=6 code-traced=9 derived=0
checks="784/785/0 (npm test, 8 independent runs this session, deterministic); typecheck=clean; lint=clean; completeness-claim-checker=PASS(2); marker-corpus-probe.test.ts alone x6 concurrent=6/6 clean 15/15 each; 3-file combo x3=3/3 clean 41/41 each; concurrency=1 full serial=784/785 unchanged; gh issue timestamp checks=170/171/172/173/176/177/178 all closed after c2408ba; gh issue list --search=180 found, commented not duplicated"
adr=HIT(35)
report=docs/reviews/s1-closeout-164-154-code-round3-2026-09-13.md
