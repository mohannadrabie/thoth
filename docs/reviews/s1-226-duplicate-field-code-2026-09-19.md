[code-reviewer]
⚖️ Code Reviewer (Anubis) — reviewing for correctness & user-facing trust

# Code review: s1-226-duplicate-field (Issue #226)

HEAD: e980415 (vs origin/master 8760096, commits 46b275b..e980415). Tier STANDARD (Manager-ratified, not re-litigated). Date 2026-09-19.

**Verdict: SHIP.** The fix does what the story says, each criterion has a check that goes red when the behaviour is removed, and I found nothing a user would hit. Two LOW items are recorded for completeness.

## ADR compliance

`node docs/adr-cache.mjs --ensure`:
`📊 ADR cache HIT: reused 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1] from catalog — ≈17800 tokens saved this pass (fp 5dba384) [CACHE=HIT]`

- Read the catalog rules for my domains (code, testing, error-handling, maintainability). Applicable: SE ADR-0005 (unit tests for new behaviour, error paths and boundaries; met by 3 new tests per probe), SE ADR-0003/0010 as cited in the plan (pure check, no new I/O, no scope creep; met).
- No blocker: no ADR standard is violated by the diff.

## Scorecard

| Axis | Grade | Basis |
|---|---|---|
| 1. Correctness vs story (R1-R7) | SOLID | Table below; live demo and mutations reproduced |
| 2. Idempotency / re-runs | SOLID | Pure argv validator; no state; re-run gives identical result |
| 3. Inputs and edge cases | SOLID | Empty value, repeat, dup+bad value, dup+stray all traced/run (below) |
| 4. Error handling / operability | SOLID | Exit 1, empty stdout, tokens quoted on stderr |
| 5. Verification quality | SOLID | 4 of 5 mutants killed; 1 survivor is unspecified behaviour (LOW) |
| 6. Maintainability | SOLID | About 5 changed source lines per probe; deliberate duplication across the two probes is stated in the plan ("No shared helper") |

## Acceptance criteria to code to check

| R | Code | Check that proves it | Result |
|---|---|---|---|
| R1 marker: 2+ `--field=` rejected, both orders, stdout empty, stderr names tokens | `src/qa/marker-corpus-probe.ts:92-96` | T226-M1 (5 argv cases, both orders, 3 tokens, bogus, with a positional ref) and T226-M3 (subprocess, 3 cases) | green, killed by M1/M3/M4 |
| R2 continuation: same | `src/qa/continuation-residual-probe.ts:83-88` | T226-C1 (4 cases), T226-C3 (subprocess, 3 cases) | green, killed likewise |
| R3 rejected before any file collection or git call | `main()` order unchanged: `assertKnownArgs` then `parse*Field` then `collectFullTreeFileTexts` (`marker-corpus-probe.ts:222-227`, `continuation-residual-probe.ts:242-249`) | subprocess tests run from a non-git `mkdtemp` with `GIT_CEILING_DIRECTORIES`; assert tokens on stderr and no `not a git repository` | green; mutant M3 (reorder) turns both subprocess tests red |
| R4 valid invocations unchanged | single-flag path still runs on `flags[0]` | existing tests unmodified and green; `completeness-claim-checker.ts` run: `PASS: 2 file(s) checked` | green |
| R5 existing errors unchanged | `assertKnownArgs` and bad-value throw not edited | existing stray-arg and bad-value tests green | green |
| R6 identical repeat rejected | `flags.length > 1`, not a Set of values | T226-M2 / T226-C2, plus the identical case inside each subprocess test | green; M2 mutant (`new Set(flags).size > 1`) red |
| R7 no new surface | `git diff --name-only origin/master` = 8 files: the 4 source/test files, CHANGELOG, plan, state, run-log (exactly the plan's expected set); `git diff origin/master --stat -- src/lib/git.ts src/qa/completeness-claim-checker.ts docs/qa/secret-scan-allowlist.json .github` empty | instrument output | met |

## Edge cases checked

| Input | Result | Evidence |
|---|---|---|
| `--field= --field=` (empty value, repeated) | rejected as a duplicate, token `"--field="` quoted | demonstrated (live run below) |
| `--field=` alone | unchanged: falls to the existing bad-value throw | code-traced (`flags[0]` path untouched) |
| `--field` (no `=`) | rejected earlier by `assertKnownArgs` (`!startsWith("--field=")`), unchanged | code-traced `marker-corpus-probe.ts:114-121` |
| duplicate plus bad value (`--field=bogus --field=total`) | reports the duplicate (check precedes value validation); pinned by T226-M1/C1 case 3 | demonstrated (mutant M4 red) |
| duplicate plus stray positional | `assertKnownArgs` wins ("unrecognized argument"); pre-existing precedence, not pinned (see finding 1) | demonstrated |
| a real caller passes two `--field=` tokens | none: `KNOWN_INSTRUMENTS` lines 57-59 and 68-69 pass one each; `node src/qa/completeness-claim-checker.ts` exits 0 | demonstrated |

## Findings

1. **[SUSPICION][LOW][demonstrated] The ordering `assertKnownArgs` then `parse*Field` is not pinned.** Mutant M5 (swap the two calls in `main()` in both probes) leaves every Issue #226 test and every existing test green in a scratch copy (only the 2 scratch-only baseline failures, see Checks). User effect: none, since either order exits non-zero with empty stdout; only which message appears for `--field=a --field=b stray` would change. Outside R1-R7. Minimal fix if wanted: one subprocess case `["--field=marked","--field=total","stray"]` asserting stderr includes `"stray"`. Named failing test if pursued: `T226-M4 duplicated --field= plus a stray argument reports the stray argument`. Optional. No Exposure line needed (LOW, no user-visible wrong result).
2. **[SUSPICION][LOW][demonstrated] The history-scan test file failed once at file level in a full `npm test` run, then passed.** Run 1: `tests 879 / pass 878 / fail 1`, failing entry `✖ src\secret-scan\history-scan.test.ts (39507.0242ms)`. Isolated re-run of the file: 21/21. Full re-run: 891/891. The diff touches nothing under `src/secret-scan/`; this reads as a load-related flake (a 39.5 s file), not caused by this change. Not filed here (LOW suspicion, unrelated).

Verified sound (worth naming):

3. **[CLEAN][demonstrated] Mutation strength.** Reproduced in a scratch copy (never the working tree; `git status` shows only the untracked `prompt`): M1 delete the check gives 6 red (all three new tests, both probes); M2 `new Set(flags).size > 1` gives 4 red (identical-repeat unit test and subprocess test, both probes); M3 parse after collection gives 2 red (both subprocess tests); M4 dup check after value validation gives 2 red (the distinct-tokens unit tests, via the bogus-plus-total case). All match the CHANGELOG claims.
4. **[CLEAN][demonstrated] CHANGELOG text matches the diff.** Checked each claim: filter plus throw quoting via `JSON.stringify` comma-joined; check precedes value validation; identical repeat rejected; parsers placed inside the resolver; test inventory (1 distinct-tokens unit, 1 identical-repeat unit, 1 subprocess per file; `withNonGitDir` and `dirname` import added to the marker test); untouched-file list; mutation results. Issues #173 and #179 appear in the CHANGELOG as the stray-argument gate.
5. **[CLEAN][demonstrated] The subprocess tests are not vacuous.** `GIT_CEILING_DIRECTORIES=dirname(dir)` keeps git from walking out of the temp dir; the token assertion alone already fails under M3 (stderr becomes git's error).

Exposure lines: no `[HIGH]` findings.

## Checks run (raw)

- `node --test src/qa/marker-corpus-probe.test.ts src/qa/continuation-residual-probe.test.ts`: `tests 45 / pass 45 / fail 0 / cancelled 0 / skipped 0 / todo 0` (6 new Issue #226 tests among them).
- `npm run typecheck` (`tsc --noEmit -p tsconfig.json`): exit 0, no output.
- `npm run lint` (`eslint .`): exit 0, no output.
- `npm test` full suite, run 1: `tests 879 / pass 878 / fail 1 / skipped 0` (the fail is finding 2). Run 2: `tests 891 / pass 891 / fail 0 / cancelled 0 / skipped 0`.
- `node src/qa/completeness-claim-checker.ts`: `[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.`
- Live demo at repo root: `node src/qa/marker-corpus-probe.ts --field=total` gives `PASS: total=1502`, exit 0. `--field=marked --field=total` gives exit 1, 0 stdout bytes, stderr `Error: --field may be given only once, got: "--field=marked", "--field=total"`. `--field= --field=` and the continuation pair `--field=continuation-marked --field=continuation-residual` also exit non-zero with the same message shape.
- Scratch copy baseline (src, package.json and tsconfig copied out of git): 43 pass / 2 fail, both failures pre-existing tests that need a real git repo at cwd (`--field=continuation-marked emits ONLY that field`, `--field=total emits ONLY that field`), so every mutation count above is over that baseline of 2.
- `node src/qa/reference-resolver.ts origin/master HEAD` (QA-14): exit 1, Issue #229. 7 non-`unclassified` failures (all `unresolved-authority`: one nonexistent issue number and six nonexistent paths, none named here so this report adds nothing to the count). Same 7 the previous story recorded. None comes from prose this diff adds: in the added-line scan, 0 hits in CHANGELOG, src, run-log and the plan; the 7 textual hits are re-indented old lines in the state file (see Editorial).

## Missing checks by name

None required for R1-R7. Optional: `T226-M4` (finding 1).

## Editorial (verdict-neutral, plain edits)

- The state file note `note_2026-09-19d` says "Awaiting Manager ratification"; the run-log records the tier as ratified STANDARD and the CHANGELOG says so. Update the note at close-out.
- The state file diff is 1517 changed lines because each story re-nests the `priorScope` chain one level deeper. A textual added-line scan therefore shows old, already-failing citations as "added". Pre-existing pattern (the previous story did the same); not a defect of this change.

## Praised decision

Putting the check inside `parse*Field`, the resolver where the ambiguity is created, rather than in `assertKnownArgs`. A future direct caller cannot get first-wins back, the "unrecognized argument" contract stays true, and the ordering guarantee comes for free from `main()`. The mutations confirm the tests pin it.

## Single next action

Manager: proceed to merge-handoff for the human (push, PR, merge stay human-only); note finding 2 against any known history-scan flake history.

RECEIPT: verdict=SHIP
findings:
1. [SUSPICION][LOW][demonstrated] src/qa/marker-corpus-probe.ts:222-223 and src/qa/continuation-residual-probe.ts:242-243 — swapping assertKnownArgs/parse*Field order survives all tests (message precedence only, no user-visible wrong result); optional fix: one dup+stray subprocess case
2. [SUSPICION][LOW][demonstrated] src/secret-scan/history-scan.test.ts — failed once at file level in a full run (878/1/0), then 21/21 isolated and 891/891 on re-run; file untouched by this diff, reads as load flake
3. [CLEAN][demonstrated] mutations M1-M4 reproduced red in a scratch copy (6/4/2/2 red over a 2-failure scratch baseline); working tree untouched
4. [CLEAN][demonstrated] CHANGELOG text matches the diff claim by claim; expected file set exact; untouched-file list verified empty
5. [CLEAN][demonstrated] R1-R7 each mapped to code and a check; subprocess tests non-vacuous (GIT_CEILING_DIRECTORIES); empty-value repeat, dup+bad value, dup+stray traced and run
counts: issues=0 suspicions=2 clean=3
evidence: demonstrated=5 code-traced=0 derived=0
checks="891/0/0"
adr=HIT(36)
report=docs/reviews/s1-226-duplicate-field-code-2026-09-19.md
