# Cross-Domain Review -- s1-closeout-164-154 (Issues #164 + #154)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-13
**Branch:** fix/s1-closeout-164-154 @ b9fed71, base master @ ad196c5
**Diff scope (as instructed):** `git diff ad196c5 b9fed71 -- src/qa/marker-corpus-probe.ts src/qa/marker-corpus-probe.test.ts CHANGELOG.md docs/STATE.md`
**Tier:** CRITICAL (ratified, `docs/run-log.jsonl` 2026-09-13T23:08:44) -- same file family as `reference-resolver.ts`'s twin instruments, 3+ prior adversarial CRITICAL-tier catches.
**ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23]` -- fingerprint `83b2e3e`. Read the WHOLE catalog (35 ADRs across both domain folders), not a lane slice, per this role's own PRINCIPLES rule 9 mandate.

## Who else is reviewing, and what ground they cover

Per `docs/.maat-state.json`: `red-team` + `code-reviewer` + `cross-domain-reviewer`, CRITICAL tier. `code-reviewer` covers correctness/tests/maintainability/ADRs in its own domain lane (ADR-0003/0004/0005/0010, confirmed by a partial draft found at `docs/reviews/_probe3.md`, untracked, apparently a mid-session artifact -- not this review's concern, left untouched). `red-team` covers adversarial/regression-history angles on this exact file family. Neither reviewer's lane is defined to include: (a) the whole 35-ADR catalog outside their own domain slice, (b) GitHub Milestone metadata/closure honesty, or (c) re-running the full test suite repeatedly under real concurrency to hunt flakes (a single clean run satisfies their own gate-check obligation). This review's ground starts there.

## Cross-domain ADR verdict (whole catalog, not a domain slice)

- **ADR-0021 (thoth-native architecture -- kernel purity, Action record, gate surfaces, audit trail):** CLEAN. The diff is entirely inside `src/qa/` (test/QA tooling). No file touched sits under, imports from, or exports into the kernel/gate/normalizer-registry/audit-log/Action-record surface this ADR governs. No filesystem/network import was added to any kernel-boundary file. No collision.
- **ADR-0002 (multi-layer architecture), ADR-0006 (blast radius control), ADR-0010 (code quality gates):** CLEAN. This is a flat QA script, not a layered application component -- no layering violation possible. No scope creep: the 2 round-6 LOW residuals are explicitly named and left untouched, not folded in "while here." No lockstep-deploy risk (internal tooling, no consumer).
- **ADR-0016/0018/0019/0020 (governance-plugin porting / reference-port fidelity):** N/A -- no porting activity in this diff.
- **ADR-0004/0005 (idempotency, testing strategy):** CLEAN as a read-only reporting instrument; a real regression test was added for the changed behavior (see Finding 1 below for a defect in that test, not its absence).
- No ADR outside any lane's `applicableTo` is implicated by this diff. Verdict: no ADR collision.

## Seam findings

### Finding 1 -- [HIGH] New Issue #164 regression test is flaky under real concurrent `npm test` execution (demonstrated)

`src/qa/marker-corpus-probe.test.ts`'s new test (lines 105-116) asserts byte-identical stdout between two separate live subprocess spawns of `marker-corpus-probe.ts`, each of which internally re-enumerates and re-reads every git-tracked file in the working tree (`collectFullTreeFileTexts`, `marker-corpus-probe.ts:124-139`). This is the exact same assertion shape as the already-shipped Issue #161 test on this file's twin (`continuation-residual-probe.test.ts:152-156`) -- not a novel pattern, but newly re-exposed by being run again, repeatedly, under real load.

Demonstrated, raw:
```
$ npm test   # run 2 of 6 consecutive full-suite runs this session
[fail] QA-14 marker-corpus-probe (real subprocess, regression): a stray positional argument no longer
  changes the result -- working-tree-only, the ref/content-mismatch bug is deleted not merely dormant
  AssertionError [ERR_ASSERTION]: a positional argument must have zero effect -- the probe reads
  only the working tree
  + actual:   '[QA-14 marker-corpus-probe] PASS: total=951'
  - expected: '[QA-14 marker-corpus-probe] PASS: total=989'
```

Runs 1, 3, 4, 5, 6 of the same unmodified command (`npm test`) passed 774/774. 1 failure in 6 consecutive full-suite runs (~17%). In isolation (`npx tsx --test src/qa/marker-corpus-probe.test.ts` alone, 5 consecutive runs) it never failed -- the flake requires the real concurrency of the full suite (Node's test runner runs test files concurrently by default; no `--test-concurrency=1` is set in `package.json`'s `"test": "node --test"`).

Root cause, code-traced (not fully isolated, but grounded): the two subprocess spawns are not simultaneous -- several seconds can separate them under load -- and `collectFullTreeFileTexts`'s `readFile` failure path (`marker-corpus-probe.ts:132-136`) silently swallows any exception, not just "binary/unreadable/deleted-since-ref" as its comment claims: `catch { continue; }`. Confirmed via grep that no test in this suite writes to a real tracked file (every `writeFile`/`writeFileSync` in the suite targets an `os.tmpdir()` sandbox -- `fixture-coverage-check.test.ts`, `fixture-isolation-check.test.ts`, `gate-manifest-check.test.ts`, `loader.test.ts`, `history-scan.test.ts`, `mutation-harness.ts` shadow-copies to `tmpdir()`), and `git ls-tree -r HEAD` (what `resolveChangedFiles` uses for the zero-SHA full-tree fallback, `src/lib/git.ts:52-56`) returns a file list fixed to a HEAD that does not move mid-run -- so the file list cannot drift. The most plausible mechanism left is a transient Windows I/O failure (file handle/process-spawn contention under ~774 tests' worth of concurrent subprocess/file activity) on one of hundreds of `readFile` calls, silently absorbed by the blanket catch and dropping that file's citations from one of the two counts -- 951 vs. 989 is consistent with a handful of files (not the whole set) failing to read in one invocation.

Exposure: ~17% of `npm test` runs, measured directly (6 real runs, this environment) -- every future CI run and every future local `npm test` inherits this, indefinitely, since the test is now committed. This project has already spent entire review rounds investigating exactly this class of problem (`docs/decisions.md`'s `qa1415fix` flaky-test-suspicion row: 10 consecutive runs before concluding "not reproduced") -- a spurious red run here would trigger the same costly re-triage, and would look like a real regression in the just-fixed Issue #164 code, not what it actually is.

Minimal fix: stop asserting stdout-identity across two independently-spawned live subprocesses reading a live, uncontrolled working tree under concurrent load. Either (a) assert the CLI-arg-is-ignored property by calling `computeMarkerCorpusStats` directly over one captured `fileTexts` map with and without constructing an `argv` containing a stray positional -- no second tree-walk, no subprocess-timing dependency -- or (b) if the real-subprocess shape is kept (to also exercise the CLI/process boundary, as the twin does), harden `collectFullTreeFileTexts`'s catch to distinguish `ENOENT`/`EISDIR` (genuinely gone/not-a-file -- skip) from any other error code (fail loud, per this project's own git.ts:23-24 comment about exactly this class of silent-swallow risk on Issue #18) so a transient I/O hiccup surfaces instead of silently changing the count. The same fix (b) also closes the identical latent risk already living in the shipped twin, `continuation-residual-probe.ts`'s own `collectFullTreeFileTexts` (same catch shape, same already-merged two-subprocess test) -- worth naming as one shared follow-up rather than two.

This directly undermines the diff's own Definition-of-Done claim ("`npm test` 774/774 pass, 0 fail, 0 skipped") -- that claim was true for the single run it was captured on, but is not a stable property of the committed suite.

Evidence: demonstrated, raw command + output above, reproduced by re-running `npm test` 6 times in this review session; root cause code-traced to `src/qa/marker-corpus-probe.ts:132-136` and `src/qa/continuation-residual-probe.ts`'s matching lines.

### Finding 2 -- [MED] Milestone S1 closure-honesty risk: nothing in this diff corrects the stale "SHIPPED" description before the milestone re-closes (demonstrated)

`docs/decisions.md`'s own 2026-09-13 "Milestone-ownership gap" row (row 81) found and disclosed that GitHub Milestone #19 ("S1 -- Protect the baseline") was closed with description "...SHIPPED -- commits 2992bfb/366c54d/d3a833f." despite QA-14 never reaching its own named acceptance bar (every reference resolves), reopened it, and moved Issues #154/#164 into it -- but explicitly left the description-correction question "for whoever next reviews S1's own closure criteria." That is this review.

Demonstrated, current real state (not taken from any prior claim):
```
$ gh api repos/mohannadrabie/thoth/milestones/19 --jq '{title,state,open_issues,closed_issues,description}'
{"closed_issues":3,"description":"CI-01, QA-01/02/05/06(scaffold), QA-13-16, OSS-01,
native-architecture ADR (ADR-0021). SHIPPED -- commits 2992bfb/366c54d/d3a833f.","open_issues":0,
"state":"open","title":"S1 -- Protect the baseline"}

$ node src/qa/reference-resolver.ts 0000000000000000000000000000000000000000 HEAD
[QA-14 reference-resolver] FAIL: 143 of 3828 citation(s) failed to resolve; 506 more unclassified
(non-blocking).  # exit 1
```

Both #164 and #154 are now closed (confirmed `gh issue view`, `stateReason: COMPLETED` on both) -- Milestone #19 shows 0 open issues for the first time. QA-14 itself still fails: 143 blocking findings, a real, disclosed, human-accepted residual (per this same story's own #154 verify-and-close), not a defect -- but the milestone's own description does not say so; it still reads as a flat completion claim.

Nothing in this diff (`CHANGELOG.md`, `docs/STATE.md`) plans or performs a milestone-description correction. `docs/STATE.md`'s own "Single next action" line only names Stage 3 review -> verify/audit/PR -- no step names "correct Milestone #19's description, or leave it open with the residual disclosed, before/at re-closure." If the next action (Stage 5 audit, or the human) re-closes Milestone #19 purely because it now shows 0 open issues, without updating the stale "SHIPPED" text to disclose the accepted QA-14 residual, this recreates -- for the third time -- the exact "declared done, not actually done" pattern this project's own history has already caught twice (Issue #27: CI silently dead 8+ days behind a green-looking merge; Issue #120: QA-14/QA-15 gates hardcoded to always pass). The row that flagged this risk is itself evidence the project takes it seriously; leaving it unaddressed through this story's own close-out would be the missed catch.

Exposure: one governance artifact (Milestone #19), but high-visibility and high-recurrence-risk -- this exact failure mode has now surfaced 3 times in this project's own history (Issue #27, Issue #120, this row). Basis: measured (gh api + direct QA-14 run, both above).

Minimal fix: before Milestone #19 is (re-)closed, PATCH its description via the GitHub API to append a one-line disclosure -- e.g. "QA-14 100%-citation-resolution is a disclosed, accepted non-blocking residual (143 blocking findings measured 2026-09-13; comma/list-continuation classification, Issue #154), not a completion criterion for this milestone." -- or leave the milestone open with the same corrected description, human's call which; either way, not a silent re-close on the current unqualified "SHIPPED" text. This is a one-line milestone-metadata edit, not a code change -- does not block merging this diff's actual code, but should happen at or before whatever step next touches Milestone #19's state.

### Finding 3 -- `marker-corpus-probe.ts` / `completeness-claim-checker.ts` `KNOWN_INSTRUMENTS` contract -- [CLEAN]

All 4 registered entries (`qa14-marker-corpus-probe`, `-marked`, `-unmarked`, `-total`; `completeness-claim-checker.ts:51,57-59`) invoke `marker-corpus-probe.ts` with `--field=...` only, never a positional ref argument. Confirmed by direct code read and by grep across the whole repo (production code, `.github/workflows/ci.yml`, `package.json`, the pre-existing test file) -- zero callers ever passed a non-default ref. Deleting the `ref` parameter does not break this registry's contract. `continuation-residual-probe.ts`'s `collectFullTreeFileTexts` (already shipped, Issue #161) is confirmed byte-for-byte the same shape as this diff's new helper of the same name -- the "mirrors the twin" claim in the CHANGELOG is accurate, independently checked.

### Finding 4 -- Issue Discipline compliance -- [CLEAN]

`gh issue view 164` / `gh issue view 154`: both `state: CLOSED`, `stateReason: COMPLETED`. Every update across this saga's 6+ rounds (both issues have long histories predating this diff) was posted as a role-prefixed comment (`[story-implementer]`, `[red-team]`, `[cross-domain-reviewer]`) -- no body edits found, no duplicate issue filed at any point (repeated re-opens of the same thread, per CLAUDE.md's Issue Discipline point 2, e.g. #154's own 7-comment history across rounds 1-6 plus this close-out). The Milestone reopen/move (via the GitHub API, and `gh issue edit 154/164 --milestone`) was already executed and logged in `docs/decisions.md` row 81, prior to this diff -- consistent with the discipline, not something this diff needed to redo.

## Coverage gaps named

- `CHANGELOG.md` / `docs/STATE.md` prose -- not an uncovered gap: this exact project's history (Issues #166/#167/#168, same story family) shows `code-reviewer` and `red-team` actively catch self-referential digit-bearing-example contamination in these files. I independently re-ran `node src/qa/completeness-claim-checker.ts` (PASS, 2 files) and spot-read the new prose in this diff for that recurring class -- none found. Covered ground, confirmed sound, not left to chance.
- Full-suite-under-concurrency flakiness (Finding 1) is the one real gap: neither `code-reviewer`'s single-file correctness pass nor `red-team`'s adversarial-logic pass is structured to catch a test that only fails intermittently under real concurrent load -- that requires exactly what this role did (re-run the whole build artifact repeatedly). Now named, not silently missed.

## Verification performed directly (this review, not taken from any prior claim)

- `npm run typecheck` -- exit 0, clean.
- `npm run lint` -- exit 0, clean.
- `node src/qa/completeness-claim-checker.ts` -- PASS: 2 file(s) checked, all completeness claims verified.
- `npx tsx --test src/qa/marker-corpus-probe.test.ts` -- 10/10 pass, 5 consecutive isolated runs, always green.
- `npm test` (full suite) -- 6 consecutive runs: 5x 774/774 pass, 0 fail, 0 skipped; 1x 1 failure (Finding 1, raw output above).
- `node src/qa/reference-resolver.ts 0000000000000000000000000000000000000000 HEAD` -- exit 1, 143 of 3828 blocking (confirms QA-14 still not fully green -- Finding 2's basis).
- `gh api repos/mohannadrabie/thoth/milestones/19` -- confirmed current open/closed-issue counts and stale description (Finding 2).
- `gh issue view 164` / `gh issue view 154` -- confirmed closure state, comment history, no duplicates (Finding 4).

## Verdict

REWORK. Finding 1 is [HIGH], demonstrated (a real command run, raw pass/fail output quoted) -- per this role's own Evidence Policy, a demonstrated HIGH requires a non-clean verdict. Finding 2 is [MED], demonstrated, a real governance-honesty risk this project has already been burned by twice; it does not block merging this diff's code but must be resolved (milestone description corrected) at or before Milestone #19's next state change.

## Single next action

Fix Finding 1 first (swap the twin-subprocess byte-identity assertion for a direct-function-call assertion, or harden the `readFile` catch to distinguish real absence from a transient I/O failure -- same fix applies to both this file and its already-shipped twin), re-run `npm test` at least 6x consecutively to confirm the flake is gone, then re-dispatch this review round. Separately (not gating this diff): before Milestone #19 is next opened/closed, correct its description to disclose the QA-14 residual per Finding 2.

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] src/qa/marker-corpus-probe.test.ts:105-116 (+ inherited pattern in src/qa/continuation-residual-probe.ts's collectFullTreeFileTexts) -- the new Issue #164 regression test asserts byte-identical stdout across two live subprocess spawns of a full-tree-scanning probe; demonstrated flaky under real npm test concurrency (1 fail / 6 full-suite runs, raw output in report) -- assert via direct function call instead of two live spawns, or harden the blanket readFile catch (marker-corpus-probe.ts:132-136) to distinguish ENOENT from a transient I/O error.
2. [ISSUE][MED][demonstrated] GitHub Milestone #19 ("S1 -- Protect the baseline") is open with 0 open issues (both #164/#154 now closed) and description still reads bare "SHIPPED..." with no QA-14-residual disclosure (confirmed live: QA-14 still exits 1, 143 blocking) -- nothing in this diff corrects it before the next milestone-state change; per docs/decisions.md row 81's own open question, correct the description (disclose the accepted residual) before Milestone #19 is next closed, not a silent re-close on stale text.
3. [CLEAN][code-traced] marker-corpus-probe.ts's ref-param deletion vs. completeness-claim-checker.ts's KNOWN_INSTRUMENTS contract -- all 4 registered entries invoke --field=... only, never a positional ref; confirmed by code read + repo-wide grep, no caller broken.
4. [CLEAN][code-traced] ADR-0021 (thoth-native architecture / kernel purity) and every other ADR in the 35-ADR whole catalog -- no collision; diff is entirely inside src/qa/ QA tooling, touches no kernel/gate/normalizer/audit-log/Action-record surface.
5. [CLEAN][code-traced] Issue Discipline -- #164/#154 both closed state_reason COMPLETED via role-prefixed comments (no body edits, no duplicates); Milestone reopen/move already executed and logged prior to this diff.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=2 suspicions=0 clean=3
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=3 derived=0
checks=typecheck:pass lint:pass completeness-claim-checker:PASS(2 files) npm-test:5-pass-1-fail-of-6-runs(774/774 x5, 1-fail x1, raw output in report) reference-resolver-full-tree:exit1(143/3828 blocking) isolated-test-file:10/10-pass-x5
adr=HIT(35, whole catalog)
report=docs/reviews/s1-closeout-164-154-cross-domain-2026-09-13.md
