# Code review — `s1-qa-probe-hardening` (S1 Story A: Issues #175, #179, #182)

[code-reviewer] Code Reviewer (Anubis) — reviewing for correctness and user-facing trust

- Date: 2026-09-19. Tier: STANDARD (ratified, not re-litigated).
- HEAD: 793299d (5 commits, `git diff f892518..793299d`), branch `fix/s1-story-a-probe-hardening`.
- Plan: `docs/plans/S1-storyA-probe-hardening-phase1-2026-09-19.md` (AC 1-13, T179/T175/TW/TWR, M1-M9, "Will NOT do").
- Verdict: **SHIP**. Two LOW findings, neither gating; no user-facing defect found.

## ADR compliance

`📊 ADR cache HIT: reused 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1] from catalog — ≈17800 tokens saved this pass (fp 5dba384) [CACHE=HIT]`

Applicable to the code/testing/quality lane (from `docs/.maat-state.json → adrCatalog`): SE ADR-0003 (inject I/O), SE ADR-0005 (testing: no ordering-dependent tests, do not delete or weaken a failing test), SE ADR-0010 (full local gates, no scope creep). ADR-0021 does not touch this diff (no kernel, hook, or audit-log file changed).

| Rule | Status |
|---|---|
| SE-0003 inject I/O | Met. `untrackedScanWarning(runner, repoRoot)` takes an injected `Runner`; `warnIfUntrackedScannable` takes an injected `write` sink; `main()` passes `realRunner` and `console.error`. |
| SE-0005 no weakening | Met. The KNOWN-GAP test is replaced by T179-3, the successor its own comment ordered ("this test must be REPLACED with one asserting a non-zero exit and a message naming the offending token"). No other test removed or loosened (removed-lines listing of the test diff read in full). |
| SE-0005 no ordering-dependent tests | Met, one LOW caveat (finding 1). |
| SE-0010 full local gates | Met (below). No `.skip`, no lint suppression, no threshold change. |

No ADR BLOCKER.

## Scorecard

| Axis | Grade | Basis |
|---|---|---|
| 1. Correctness vs story (AC 1-13) | SOLID | table below; live demo in a fixture repo |
| 2. Idempotency / re-runs | SOLID | read-only probes; the warning is one extra read-only git call |
| 3. Inputs / edge cases | SOLID | gate rejects `""`, `--field`, `--bogus-flag`, refs, a SHA beside a valid flag |
| 4. Error handling / operability | SOLID | gate exits 1 with the token quoted; a failed warning read throws (TW-4), never "no warning" |
| 5. Verification quality | SOLID | every mutation I ran went red on the named test; see below |
| 6. Maintainability | SOLID | one shared helper, one call site per probe (grep instrument) |

## Acceptance criteria mapped to code and check

| AC | Code | Check | Result |
|---|---|---|---|
| 1 | `continuation-residual-probe.ts:98-107` `assertKnownArgs` (`!a.startsWith("--field=")`, quotes every offender via `JSON.stringify`) | T179-1 (pure), T179-3 (subprocess) | green; M3 red |
| 2 | `:244` gate is the first statement after `argv`, before `collectFullTreeFileTexts` at `:247` | T179-3 ordering half (`not a git repository` must be absent) | green; M1 and M2 red (caveat: finding 1) |
| 3 | `parseContinuationResidualField` untouched; `KNOWN_INSTRUMENTS` argv unchanged | T179-2, T179-4; `completeness-claim-checker` PASS | green |
| 4 | KNOWN-GAP test and comments removed | grep instrument | 0 hits |
| 5 | `collectFullTreeFileTexts` uses `git.lsFilesWorkingTree()`; `resolveChangedFiles` import dropped | T175-1; M4 | green; M4 red on T175-1, T175-2, TWR-3 |
| 6 | same | T175-1: baseline 1, add untracked `Closes #10, #11, #12.`, rises by exactly 2, `filesScanned` +1, fixture is `mkdtemp`, untracked-ness asserted via `git status --porcelain` | green |
| 7 | untouched `src/lib/git.ts` `lsFilesWorkingTree` (gitlink `160000` skipped, trailing-`/` dropped) | existing `git.test.ts`; T175-2 (real nested `git init`) | green |
| 8 | doc comments rewritten in both probes | grep instrument | 0 hits |
| 9 | `untracked-scan-warning.ts`: count in header, cap 10 then `... and N more`, stderr sink | TW-1..4, 6, 7; TWR-1, TWR-3 | green; M5, M6a-c, M7, M8 red |
| 10 | warning is called after collection and before the `--field` branch; count, stdout print and `process.exit` untouched | TWR-1, TWR-3 (`/total=3\s*$/`, `/continuation-marked=3\s*$/`, stdout has no `WARNING`/`untracked`, exit 0); M9 red | green |
| 11 | `untracked.length === 0` returns `null` | TW-5, TWR-2 | green; M6a, M6b red on TW-5 |
| 12 | one definition `untracked-scan-warning.ts`, one call per probe | grep instrument | met (below) |
| 13 | no `git.ts` / allowlist / resolver / checker edit; no address-shaped literal added | `git diff --stat` empty; history-scan rc 0 | met |

## Raw evidence (what I ran)

**Gates**
```
$ npm run typecheck   -> tsc --noEmit -p tsconfig.json   (no output, exit 0)
$ npm run lint        -> eslint .                        (no output, exit 0)
$ node --test src/qa/continuation-residual-probe.test.ts src/qa/marker-corpus-probe.test.ts src/qa/untracked-scan-warning.test.ts
ℹ tests 47
ℹ pass 47
ℹ fail 0
ℹ skipped 0
$ two of those runs concurrently: 47/47/0/0 and 47/47/0/0
$ node --test --test-concurrency=32     (full suite, this tree)
ℹ tests 885  ℹ pass 885  ℹ fail 0  ℹ skipped 0  ℹ cancelled 0
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
$ node src/secret-scan/history-scan.ts   -> rc=0 (only the pre-existing ALLOWLISTED rows)
$ node src/qa/reference-resolver.ts      -> rc=1, "FAIL: 5 of 388 citation(s) failed to resolve"
```
QA-14 is the known red (Issue #120). The 5 failures (`Issue#0`, `clean/safe-single-constructor-access.ts`, `.claude/settings.local.json`, `docs/reviews/_probe.md`, `hooks/report-subject-gate.mjs`) do not appear in this diff (`git diff | grep` for each: no hit), so the diff adds nothing to it. `pre-commit-scan.test.ts` R4 did not flake in the runs above.

**Grep instruments**
```
AC4  grep -rn "KNOWN GAP" src/qa/continuation-residual-probe*.ts src/qa/marker-corpus-probe*.ts      -> 0 hits (rc=1)
AC8  grep -rniE "disclosed residual|disclosed, not fixed|still comes from|still carries|live, separate defect" (both probes + tests) -> 0 hits (rc=1)
AC12 grep -rn "untracked-scan-warning|warnIfUntrackedScannable|untrackedScanWarning" src (excluding the helper's own files):
       continuation-residual-probe.ts:61 (import), :249 (the one call)
       marker-corpus-probe.ts:33 (import), :224 (the one call)
       the rest are comments and the two probe test files
AC13 git diff --stat f892518..793299d -- src/lib/git.ts docs/qa/secret-scan-allowlist.json src/qa/reference-resolver.ts src/qa/completeness-claim-checker.ts -> empty
     git diff | grep for an address-shaped added line -> no hit
```

**Mutations** (applied by hand in a throwaway git copy of `src/` under the scratchpad, restored with `git checkout -- src` between runs; the real tree was never touched, `git status --short` clean before and after)

| Mutation | Result (only the listed tests failed) |
|---|---|
| M1 remove the `assertKnownArgs(argv)` call | fail 1: T179-3 |
| M2 move it after `collectFullTreeFileTexts` | fail 1: T179-3 |
| M3 gate relaxed to `!a.startsWith("-")` | fail 2: T179-1, T179-3 |
| M4 list back to `resolveChangedFiles(git, zero-sha, "HEAD")` | fail 3: T175-1, T175-2, TWR-3 |
| M5 helper drops `"--others"` | fail 1: TW-1 |
| M6a drop the `/` filter | fail 2: TW-2, TW-5 |
| M6b drop `shouldScanFile` | fail 2: TW-3, TW-5 |
| M6c drop the cap slice | fail 1: TW-7 |
| M7 warning to stdout (continuation, marker) | fail 1 each: TWR-3, TWR-1 |
| M8 warn call removed (continuation, marker) | fail 1 each: TWR-3, TWR-1 |
| M9 warn sink calls `process.exit(3)` (continuation) | fail 1: TWR-3 |

Every mutation in the plan table was killed by the test the plan named (M4 additionally by T175-2 and TWR-3, M6a/M6b additionally by TW-5). M9 was applied to the continuation probe only. No toothless check found among the new tests.

**Live demo** (fixture repo: one committed `tracked.md` = `Closes #1, #2.`, one untracked `scratch.md` = `Closes #10, #11, #12.`)
```
continuation --field=continuation-marked  rc=0  stdout: "[QA-14 continuation-residual-probe] PASS: continuation-marked=3"
                                                stderr: "WARNING: 3 untracked file(s) are inside the counted number, ... - err.txt - out.txt - scratch.md ... (The count itself is unchanged.)"
marker       --field=total                rc=0  stdout: "PASS: total=5"   stderr: same WARNING block
continuation HEAD~5                       rc=1  stdout: ""  stderr: Error: unrecognized argument(s): "HEAD~5" — this probe only accepts --field=continuation-marked|continuation-residual (no positional ref and no other flag)
```
(`err.txt` and `out.txt` are my own redirect files, which is the warning working as designed.)

## Findings (ranked by exposure x irreversibility x silence)

Neither finding can gate: both are LOW, and finding 1 has an exposure that rests on an assumption.

### 1. [ISSUE][LOW][demonstrated] T179-3 ordering half is vacuous when the OS temp dir sits inside a git worktree

- Evidence: `src/qa/continuation-residual-probe.test.ts` `withNonGitDir` creates `mkdtemp(join(tmpdir(), ...))`, and T179-3 proves ordering only by the absence of `not a git repository` on stderr. If `TEMP`/`TMP` is inside any git worktree, git finds the parent repo, collection succeeds, and the reordered gate still passes the test.
- Demonstrated: M2 applied, `node --test src/qa/continuation-residual-probe.test.ts`.
  - TEMP outside any repo: `ℹ fail 1 / ℹ pass 21`, T179-3 red.
  - TEMP inside a git worktree (`TEMP=TMP=<repo>/tmpx`): `ℹ fail 0 / ℹ pass 22`, M2 survives.
- User action to wrong result: a contributor whose temp dir is under a git repo (home dir or dotfiles repo) reorders the gate after collection; the suite stays green, and a bad argv on a real run then costs a full-tree read before it fails (the token still appears, so the user-visible harm is small).
- Exposure: unknown share of developer machines, basis: assumption. CI (fresh runner, `/tmp`) is unaffected. Capped at LOW; the recommendation is "measure it", but the fix is one line.
- Minimal fix: pass `env: { GIT_CEILING_DIRECTORIES: dirname(dir) }` (the `Runner` already accepts `env`, `src/lib/exec.ts:17`) in T179-3 `runProbe` call, so no ancestor repo can be discovered.
- Failing test that captures it: T179-3 made hermetic; today the same test under M2 with a repo-nested TEMP is the red case above.

### 2. [ISSUE][LOW][demonstrated] PRE-EXISTING, not added by this diff: `--field=continuation-residual` stdout does not end in the field integer

- Evidence: `src/qa/continuation-residual-probe.ts:316` (same statement at `f892518:293`) prints `details: [continuation-marked=..., distinct issue numbers queried=...]`; `completeness-claim-checker.ts:204-208` `lastInteger` reads the last integer in stdout. Live demo: stdout is `continuation-residual=3` / `- continuation-marked=3` / `- distinct issue numbers queried=5`, so `lastInteger` returns 5, not 3.
- User action to wrong result: a `[[completeness: cmd="qa14-continuation-residual-probe-residual" expect=3]]` marker would compare against 5. No marker references it today (the registry comment says "callable-but-non-blocking by design"), which is why it is LOW.
- Relevance: it explains why T179-4 asserts "ends in the single field integer" only for `continuation-marked`, and `continuation-residual=\d+` for the residual mode. That deviation is correct; the stricter assertion would have been false. The plan AC 10 wording is true for every mode this diff TWR tests exercise.
- Exposure: 0 runs today (no marker uses the entry), basis: counted in code.
- Minimal fix (out of scope, do not fold in): backlog line "print only the field integer for `--field=continuation-residual`, or read the first line only in the KNOWN_INSTRUMENTS path".
- Failing test that would capture it: `verifyMarkerClaim` against a fixture repo for `qa14-continuation-residual-probe-residual` (not written; out of scope).

### Verified sound (worth naming)

3. [CLEAN][demonstrated] argv gate: rejects every non-`--field=` token (positional, ref, flag, SHA next to a valid flag), runs first, quotes tokens; M1, M2, M3 red.
4. [CLEAN][demonstrated] #175 list source: `lsFilesWorkingTree()` with gitlink (`160000`) and nested-repo (`/`) exclusion intact and untouched in `git.ts`; T175-1 and T175-2 use real `mkdtemp` repos; M4 red on three tests.
5. [CLEAN][demonstrated] #182 warning helper: exact git args pinned (TW-1), `/` and `*.test.ts` filters (TW-2, TW-3), non-zero git exit throws (TW-4), cap 10 plus true remainder including the exactly-10 and 11 boundaries (TW-7), single write (TW-8); M5, M6a-c red.
6. [CLEAN][demonstrated] stderr-only, count/stdout/exit unchanged: one call per `main()` after collection and before the `--field` branch; TWR-1..3 subprocess tests assert stdout ends in the integer with no warning text and exit 0; M7, M8, M9 red; live demo agrees.
7. [CLEAN][demonstrated] scope discipline: `git.ts`, allowlist, resolver and checker diffs empty; no gold-plating; the exported `collectFullTreeFileTexts` and the dropped `resolveChangedFiles` import are both planned.
8. [CLEAN][demonstrated] fixtures, cross-platform, concurrency: unique `mkdtemp` dirs, `-c user.email=fixture` (no address-shaped literal), NUL-split `-z` parsing (no quoting or CRLF issue), git emits `/` separators so Windows paths do not matter; 47/47 on Windows twice concurrently, full suite at `--test-concurrency=32` 885/0/0. R4 (#227) did not flake.

## Deviations reported by the implementer

| Deviation | Verdict |
|---|---|
| T179-4 asserts the field integer only for `continuation-marked` | Correct. Finding 2 shows the residual mode stdout never ended in the field integer (pre-existing). |
| TW-5 is green against the stub (always-null helper) | Acceptable. TW-5 guards the over-warn direction and goes red under M6a and M6b. The under-warn direction is TW-1/2/3/6/7, red under M5/M6c. |

## Noted, not findings

- A file that is `git add`-ed but uncommitted counts as tracked, so it moves the number without a warning. Plan D1 chose `--others` only and rejected the tracked-vs-HEAD diff on stated grounds (C-quoted names, unborn HEAD). Consistent with the human ruling of 2026-09-19; nothing to change.
- The warning helper does not `.trim()` entries as `git.ts` does for the counted set; only a filename with leading or trailing whitespace could differ. Not worth code.

## Missing checks by name

- None that block. For finding 1: a hermetic (`GIT_CEILING_DIRECTORIES`) T179-3. For finding 2: a `verifyMarkerClaim` test for the residual instrument (out of scope).

## Editorial (verdict-neutral, plain edits)

- `docs/STATE.md` still reads "PLAN-READY, awaiting human approval; nothing is built" on branch `fix/s1-qa-probe-hardening`; the built branch is `fix/s1-story-a-probe-hardening`. Manager close-out edit (the plan reserved STATE.md and `docs/decisions.md` to the Manager).
- T179-x, T175-x and TWR-x IDs live in comments above the tests, not in test titles (only TW-x are in titles), so a grep by ID finds no test name for 9 of the 17 named tests. Optional: put the ID in the title.
- The plan names branch `fix/s1-qa-probe-hardening`; the branch reviewed is `fix/s1-story-a-probe-hardening`.

## Verdict, praise, next action

**SHIP.** Every AC maps to code and a check that can go red; every mutation I applied was killed by the named test; the full suite is 885/0/0.

**Praised decision:** injecting both the `Runner` and the output sink into the warning helper (D1/D2), so eight helper tests run hermetically against a fake git and the two probes cannot drift. That is what made every mutation above cheap to kill.

**Single next action:** Manager closes out (STATE.md, `docs/decisions.md` rulings, `cross-domain-reviewer` report) and hands the branch to the human for push and PR; optionally fold the one-line `GIT_CEILING_DIRECTORIES` change into T179-3 first.

RECEIPT: verdict=SHIP
findings (ALL of them, ranked):
1. [ISSUE][LOW][demonstrated] src/qa/continuation-residual-probe.test.ts (T179-3 withNonGitDir/runProbe) — ordering half is vacuous when TEMP is inside a git worktree (M2 survives, 22/22 green); fix: pass env GIT_CEILING_DIRECTORIES=dirname(dir) to that runProbe call. Exposure: unknown, basis: assumption.
2. [ISSUE][LOW][demonstrated] src/qa/continuation-residual-probe.ts:316 — PRE-EXISTING (same at f892518): --field=continuation-residual stdout ends in "queried=N", so lastInteger reads 5 not 3; no marker uses it today; backlog, not this diff.
3. [CLEAN][demonstrated] continuation-residual-probe.ts:98,244 — argv gate rejects every non---field= token and runs first; M1/M2/M3 red.
4. [CLEAN][demonstrated] continuation-residual-probe.ts:235-238 — list from lsFilesWorkingTree, gitlink/nested-repo exclusion intact; T175-1/2 real fixtures; M4 red x3.
5. [CLEAN][demonstrated] untracked-scan-warning.ts — git args, filters, cap, throw-on-git-failure pinned by TW-1..8; M5, M6a-c red.
6. [CLEAN][demonstrated] main() of both probes — warning is stderr-only, count/stdout/exit unchanged; TWR-1..3 plus live demo; M7/M8/M9 red.
7. [CLEAN][demonstrated] scope — git.ts, allowlist, resolver, checker untouched; grep instruments AC4/8/12/13 clean; history-scan rc 0.
8. [CLEAN][demonstrated] fixtures/cross-platform/concurrency — mkdtemp isolation, NUL-split, no address literals; 47/47 twice concurrently, full suite 885/0/0 at concurrency 32.
counts: issues=2 suspicions=0 clean=6
evidence: demonstrated=8 code-traced=0 derived=0
checks="885/0/0"
adr=HIT(36)
report=docs/reviews/s1-qa-probe-hardening-code-reviewer-2026-09-19.md
