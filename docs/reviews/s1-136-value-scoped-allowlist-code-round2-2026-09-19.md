# s1-136-value-scoped-allowlist: code re-confirm, round 2 (correctness, test quality, maintainability), 2026-09-19

[code-reviewer]
Code Reviewer (Anubis): reviewing for correctness and user-facing trust.

- Scope: targeted re-confirm of story S-B2 (issues 136 and 203), branch `fix/s1-136-value-scoped-allowlist`. Code reviewed at aa2f0c8, delta `git diff 5156eff aa2f0c8` (the fix-now round). The tree HEAD at write time adds only peer review reports and log rows. My earlier report `docs/reviews/s1-136-value-scoped-allowlist-code-2026-09-19.md` is unchanged.
- Tier: CRITICAL (Manager-ratified, not re-litigated). Lane: correctness, test quality, maintainability, and the correctness half of the HIGH fix (`SHELL_SAFE`, `percentEncode`, `unlockDetails` in `src/secret-scan/history-scan.ts`). Security re-attack belongs to `app-security-reviewer` and `red-team`, in parallel.
- ADR cache: `[CACHE=HIT]`, 37 ADRs. Lane rules applied: the testing-strategy ADR (no arbitrary sleeps, no order-dependent tests, each test owns its data), the code-quality ADR (no deleted tests, no suppressions), THOTH-ADR-0002 (Proposed, served like an accepted ADR). No BLOCKER: each is satisfied by the instruments in section 4.
- Out of scope, already filed, not re-filed: issues 233, 234, 235, 236, 237, 238.

## Verdict: SHIP from this lane

- All three of my earlier findings are closed by named tests that go red under mutants (section 1).
- The HIGH fix is correct: a runnable command is printed only for a path of `[A-Za-z0-9._/-]`, every other path gets a non-command line, and the percent-encoder is round-trip exact and injective (200,000 random strings plus 33,824 exhaustive short strings, 0 failures).
- No new user-facing functional bug found in the delta. One LOW pin gap in the new code (finding 1). No Issue is filed (no new [ISSUE] at HIGH or MED).

## Scorecard

| Axis | Grade | Basis |
|---|---|---|
| Correctness vs story | SOLID | Every R136/R203/A2-A8 mapping from round 1 still holds; the delta adds 8 tests (929 to 937), arithmetic closes by instrument |
| Idempotency and re-runs | SOLID | Migrated file regenerates byte-identical from two bases; verify PASS, 0 newly allowlisted, 0 newly blocking |
| Inputs and edge cases | SOLID | Hostile path table of 18 names plus every printable ASCII character, through the real CLI and the unit function |
| Error handling and operability | SOLID | A non-runnable path gets a named line and a how-to line; nothing silent |
| Verification quality | SOLID with one LOW gap | 73 valid mutants, 63 killed, 10 survived (6 equivalent, 4 real pin gaps, all LOW) |
| Maintainability | SOLID | Delta in `history-scan.ts` is 57 lines, in `allowlist-tool.ts` 5 (comment only); no dead code |

## Checks run (raw, this session)

| Check | Result |
|---|---|
| Touched test files (`history-scan.test.ts`, `pre-commit-scan.test.ts`, `allowlist-tool.test.ts`), scratch clone at aa2f0c8 | tests 78, pass 78, fail 0, cancelled 0, skipped 0 (70 in round 1 plus 8 new) |
| `npm test` full, first run in the scratch clone | tests 937, pass 935, fail 2, skipped 0. Both failures were environmental: the clone had an empty ADR submodule directory (the reference resolver dogfood test reported 1 unresolved ADR citation), and a Windows temp-directory removal race (EBUSY) under load in the fresh-clone hook test |
| Same two test files after copying the submodule content into the clone, machine quiet | tests 104, pass 104, fail 0, skipped 0 |
| `npm test` full, second run, same clone with submodule content | tests 937, pass 937, fail 0, cancelled 0, skipped 0, todo 0; exit 0; 162 s |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run oss:secret-scan` (real tree, current HEAD) | PASS, 0 blocking, 1749 allowlisted (1665 at round 1; more history and reports since; the allowlist file is byte-unchanged since 5156eff), exit 0 |
| `node src/qa/completeness-claim-checker.ts` (real tree) | first run FAIL under load: instrument `qa-mutation-shell` produced no parseable number (its runtime alone is 56.5 s against the checker cap of 60 s; my mutation harness and three peer reviewers were running). Instrument alone: PASS, 53 of 53 mutants killed, exit 0. Re-run when quiet: PASS, 2 files checked, exit 0. See Observations |
| `git diff --stat 5156eff HEAD` on the must-stay-untouched set (`patterns.ts`, `pre-commit-scan.ts`, `simulated-commit.ts`, `ci.yml`, `.githooks/pre-commit`, `src/lib/git.ts`, `docs/STATE.md`, `docs/decisions.md`, `CLAUDE.md`, `docs/adr-cache.mjs`, the allowlist) | empty (untouched). Against base 25291ff the same set is empty except the allowlist: 208 additions, 0 deletions, unchanged since 5156eff |
| `allowlist-tool.ts generate --base 7b62344` and `--base 25291ff`, `cmp` against the tracked allowlist | both byte-identical; entries 50, carried 0, dropped 0, hashes 108; per pattern 12, 23, 3, 2, 67, 1; under reports 57; credential-shaped 17; exit 0 |
| `allowlist-tool.ts verify --base 7b62344` on the tracked file | PASS; legacy 50, migrated 50, dropped 0, hashes 108; allowlisted before 1540, after 1540; newly allowlisted 0; newly blocking 0; exit 0 |
| Not run | Linux execution of the new tests (see section 2, UNPROVEN-pending-verification) |

## 1. My three earlier findings: closed, by named test, red under mutants

Method: mutants applied in a scratch clone only (never a tracked file), restored by `git checkout` after each run, tests run by name.

| Earlier finding | Closing test | Green on shipped code | Red under |
|---|---|---|---|
| Issue 240 (MED): generate and verify base-ref scoping unpinned | `sb2-generator-and-verify-scope-history-and-legacy-file-to-the-base-ref` (`src/secret-scan/allowlist-tool.test.ts:310`) | yes (78 of 78; 937 of 937) | B1 generate scans HEAD: red; B2 verify scans HEAD: red; B3 legacy file read at HEAD: red; B4 generate scan with no ref: red (4 of 4 killed; the implementer named three) |
| LOW: binary-skip test dies with ENOENT on an unstaged deletion | `sb2-no-tracked-text-file-is-skipped-as-binary-tolerates-an-unstaged-deletion` (`history-scan.test.ts:1383`) plus the helper `trackedFilesSkippedAsBinary` (line 1341) reading blobs via `git cat-file --batch` | yes | Demonstrated red/green on the same input: with one tracked file deleted from the working tree, the old test file (5156eff) fails (fail 1), the new file passes (pass 2, fail 0). Helper NUL check off: killed; helper window cut to 3 bytes: killed. At the test-first commit db3d5d8 this test is red |
| LOW: ten-pair cap unpinned | `sb2-unlock-command-lists-ten-pairs-then-counts-the-rest` (line 1394) | yes | cap 9: red; cap 11: red; comparison `>=`: red; no omitted count: red; omitted count plus two: red; no dedupe: red; count line removed: red (7 of 7) |
| LOW: `hash` subcommand multi-match output unpinned | `sb2-hash-command-prints-one-line-per-match-in-a-blob` (`allowlist-tool.test.ts:357`) | yes | first line only: red; last line only: red; no dedupe: red (3 of 3) |

The two verify-counter tests from red-team F2 are also killed by their mutants: removing the newly-allowlisted increment turns both red, switching off the widening diagnostic turns one red.

## 2. The tests for the HIGH fix (Issue 239)

Tests: `sb2-unlock-command-never-embeds-a-shell-metacharacter-path` (`history-scan.test.ts:1163`, unit) and `oss01-unlock-command-never-interpolates-shell-metacharacters-from-a-path` (line 1265, real CLI plus the platform shell).

**Do they pin behavior?** Yes.
- Red-first: at the test-first commit db3d5d8 both are red (3 of 3 named tests red, including the ENOENT one); at the fix commit 9833d38 both are green. The two tests are byte-identical between those commits (only the helper body for the ENOENT test changed), so the tests were not edited to pass.
- `SHELL_SAFE` widened by one character at a time, 29 characters (space, dollar, backtick, semicolon, ampersand, pipe, both angle brackets, both quotes, backslash, parentheses, braces, star, question mark, tilde, bang, hash, caret, percent, equals, plus, comma, colon, at, both square brackets): 29 of 29 killed. Anchor removed at either end: killed. Slash dropped or dash dropped from the safe set (over-restriction): killed. Path check bypassed, or command always printed: killed.
- `percentEncode` mutants: lower-case hex, per-UTF-16-unit instead of per-byte, percent passed through, space passed through, no encoding, non-safe characters replaced, raw path in the non-command line: all killed.
- Survivors: 8 of 59 in this group, classified below.

| Survivor | Class |
|---|---|
| empty path accepted by `SHELL_SAFE` (`+` to `*`) | equivalent: an empty path is never a tree entry |
| `SHELL_SAFE` given the `i` flag | equivalent: the class already holds both cases |
| patternId check dropped; commit check dropped | equivalent by construction: every pattern id is asserted `[a-z0-9-]+` from the catalog on the test first line; a commit is hex |
| raw patternId or raw commit in the non-command line | equivalent, same reason |
| zero-padding of the hex byte removed | real pin gap, LOW (finding 1) |
| iteration by UTF-16 unit instead of code point | real pin gap, LOW (finding 1) |

**Deterministic and portable?**
- No randomness, no sleeps, no order dependence: each test builds its own throwaway repo with git plumbing (`hash-object`, `update-index --cacheinfo`, `write-tree`, `commit-tree`) so a name a filesystem refuses (a double quote, a pipe) is still a tree entry, and cleans up in `finally`. Secret-shaped content comes from the `novel(...)` builder at runtime; the gate finds 0 blocking matches in these files.
- Runtime here: unit test 12.6 ms; CLI test 13.1 s (Windows, cmd); the existing accepted-by-the-gate test 26.3 s (unchanged).
- Windows: passes in 4 separate full or partial runs. The platform shell is cmd via `spawnSync(line, { shell: true })`. PowerShell is not exercised by the permanent test; it is covered by construction (the safe set holds no character any of the three shells acts on) and by the security lane runs.
- Linux CI (traced, not run): the shell becomes `/bin/sh`; the plumbing repo needs only git 2.28 or later (`init -b`), already required by earlier tests; `core.protectNTFS=false` is passed to `update-index`, harmless on Linux. The positive control needs at least one hostile name to execute in the platform shell: command-substitution and backtick names execute in sh, quote-parity names in cmd, so the control is satisfiable on both. I emulated the sh half on this machine with the `sh.exe` that ships with Git for Windows, against the production `summarizeMatches` output for 18 hostile names: the old command shape executed a marker-writing payload for 7 of 18 names; the new unlock lines (HASH-COMMAND and NO-COMMAND-PRINTED, raw and prefix-stripped, 180 pastes) executed 0. Verdict on this point: **UNPROVEN-pending-verification** for the Linux runner itself. Settling command: `npm test` on the pull request Linux CI job, run by CI.
- Safety of the execution: the payload only writes a marker file into a fresh scratch directory under the temp directory, each paste has a 30 s timeout, the scratch directories are removed in `finally`, and the old-shape control invokes a script path that does not exist in the scratch directory (node exits at once).

**Percent-encoder correctness (property test, production code).** I extracted the shipped `SHELL_SAFE` and `percentEncode` text into a scratch file and ran 200,000 random strings from a 143-symbol alphabet (all 128 ASCII, plus 2-, 3- and 4-byte characters, a bidi separator, U+FFFD). The output always matches the grammar of safe characters or percent-plus-two-hex-digits; decode of encode equals the input; a safe path is unchanged. Exhaustive injectivity over all 33,824 strings of length 1 to 3 from a 32-character alphabet chosen to hit the padding, hex-letter, control and percent cases: 0 collisions. Result: 200000 random cases, 33824 exhaustive strings, 0 failures, exit 0. The encoder is correct. What the tests pin of it is narrower than what it does (finding 1).

**Cap accounting.** Pairs are keyed by path and pattern id; the first ten get a line (command or non-command), pair 11 onward is counted in one line; a second match at a listed pair adds nothing. Verified by 7 mutants (section 1). One oddity, not a defect: the how-to line is emitted only when a listed pair needed quoting, so a run whose only hostile pair is past the cap shows the count line wording about the no-command rule without the how-to; the pair reappears with the how-to on the next run once the first ten are dealt with.

## 3. F2 outcome: verify newly-allowlisted counter kept, two pinning tests

- Sound. I re-derived the property by hand: a widening needs a migrated entry on a pair with either no legacy entry (a structural check fires) or only value-scoped legacy entries none of which lists the value, in which case the migrated hash list differs from the legacy one (a structural check fires). Duplicate legacy entries do not break it: a legacy whole-pair entry covers everything, so there is no widening; otherwise the last-wins map still differs. The enumeration `sb2-verify-widening-is-always-also-caught-structurally` (5 legacy shapes by 5 hash lists by 8 subsets, 200 cases, non-vacuity asserted) is consistent with that.
- Not dead code: the count is reachable (the counts test builds two reachable widenings) and it is what the verify output prints. Removing the increment turns 2 tests red.
- Wording, checked: the comment above the widening diagnostic in `src/secret-scan/allowlist-tool.ts`, the ADR bullet, the ADR position row and the CHANGELOG sentence all say reachable, never the only failure, a second direct measurement, an independent instrument reached the same zero. All true: the red-team report holds its own comparison (before 1535 and 1540, after equal, 0 newly allowlisted) and my verify run above shows 0.

## 4. Instruments: testing-strategy and code-quality ADRs, comment-only claims, prose claims

**Removed or edited test lines.** Unified zero-context diff of every test file.
- Delta 5156eff to aa2f0c8: removed lines are (a) comment lines (the present-tense rewrite of the historical block and two word changes), and (b) the 10 lines of `sb2-no-tracked-text-file-is-skipped-as-binary`, whose header is removed and re-added unchanged and whose body moved into the helper `trackedFilesSkippedAsBinary`. The assertion line that compares the skipped list to an empty list is not in the removed set. Removed `test(` lines, delta: 1 (the header, re-added with the same title). Against base 25291ff: removed `test(` lines: 0.
- Judgement: not a weakening. The check is stronger (it reads the blob the scanner would read, not the working tree), it is now itself tested with a positive case (a blob with a NUL is found) and a negative case (excluded when named), and its ENOENT failure mode is gone. The one loosening is in finding 1 (the 8000-byte window is restated, not shared).
- Against base 25291ff, comment-stripped and type-stripped emit of the three touched test files: removed executable lines are exactly those round 1 classified (import edits, fixture literals gaining the hash field, the dogfood test reading through the loader, the removal of the report-directory exclusion in the derive helper for issue 203, the one flipped assertion). No test is deleted; test count 893 plus 44 added `test(` lines equals 937.
- Suppressions and sleeps: added lines matching eslint-disable, ts-ignore, skip, only, setTimeout, sleep or wait-for-timeout: 0.

**Comment-only claim for `history-scan.test.ts`.** Instrument: `ts.transpileModule` with `removeComments`, emit of 5156eff versus aa2f0c8, `git diff --no-index -U0`. Hunks: one import added, the new test block (about 180 lines), the binary-skip refactor. Zero hunks fall in the regions the implementer described as comment edits (the historical block, the two word changes, the reason-strictness comment). Confirmed comment-only.

**Prose claims checked against the tree.**
- CHANGELOG and Addendum 2: 937 pass 0 fail 0 skipped confirmed; red under three mutants for issue 240 confirmed (four); tests written red first confirmed at db3d5d8; the named-test list in Addendum 2 is identical to `git grep` output (37 names, diff empty).
- ADR residual rows: 12 of 108 blessed values use the unanchored AWS id pattern, 0 of 108 use the two context-including patterns, 50 entries on 50 distinct pairs, 17 credential-shaped: all match my counts. One blob of this story own history is still skipped: instrument over the 19 commits of 25291ff..aa2f0c8, 47 distinct blobs added or changed, 1 has a NUL in its first 8000 bytes, the spike file at commit 431c216. Confirmed.
- ADR frontmatter `constraints` 8, body rules 8, catalog entry 8: parity holds.
- Rollback wording: commits fefce23, 62b95b2 and f77cd56 exist and are in the stated order. The 19 of 61 secret-scan tests figure is the cross-domain drill, attributed to it; I did not re-drill it (the suite has since grown to 78 in those files).
- Migrated allowlist: byte-identical to a fresh generate from both bases (Checks run).

## Findings, ranked by user-trust impact and blast radius

### 1. [LOW][demonstrated] Three behaviors of the new unlock code, and the binary helper window, are unpinned

- Evidence (mutants applied in a scratch clone, tests by name and then across both secret-scan test files):
  - zero-padding of the hex byte removed (`src/secret-scan/history-scan.ts:183-190`): 64 of 64 pass in the two files. If it regressed, a path holding a control character below 0x10 would encode ambiguously (control 0x01 followed by `A` would collide with 0x1A).
  - iteration by UTF-16 unit instead of code point: survives. A four-byte character (an emoji) would encode as two replacement characters. Reachable only when git is configured with `core.quotePath=false`; by default git octal-quotes non-ASCII.
  - dedupe key by path only (`src/secret-scan/history-scan.ts:205`, unchanged since round 1): survives all 78 tests. A file blocked for two patterns would list one command, not two; the second reappears once the first is allowlisted.
  - helper `trackedFilesSkippedAsBinary` reading the whole blob instead of the 8000-byte window (`src/secret-scan/history-scan.test.ts:1366`): survives; the helper restates the scanner `looksBinary` window (unexported) and could drift from it.
- User action to wrong result: none today. Shipped code is correct for all four (property test above for the encoder); a later refactor of any of them would stay green.
- Exposure: ~0% of gate runs, basis: counted in code (control characters cannot appear in a path from git default quoting; four-byte characters need a non-default git setting; the other two are display or test-helper details).
- Minimal fix: add a control character, a four-byte character and a two-pattern-one-path case to the existing unit test, and a NUL just past byte 8000 to the plumbing test. Named tests: `sb2-percent-encoding-is-injective-for-control-and-astral-characters`, `sb2-unlock-command-lists-each-pattern-of-one-path`, `sb2-binary-helper-window-matches-the-scanner`. Each is green on shipped code and red under the named mutant; none has a failing form against the shipped tree.
- LOW: no Issue filed.

### Clean, verified (worth naming)

2. Issue 240 closed: the base-ref test is green on shipped code and red under 4 of 4 mutants.
3. ENOENT LOW closed: same deletion, old test file red, new test file green; the helper is tested both ways; the test-first commit is red.
4. Cap and multi-match LOWs closed: 7 of 7 and 3 of 3 mutants killed.
5. HIGH-fix tests pin behavior: red at the test-first commit, green at the fix, unchanged between; 29 of 29 single-character widenings and both anchors killed; 6 survivors are equivalent by construction.
6. Percent-encoder correct and injective: 200,000 random and 33,824 exhaustive cases, 0 failures.
7. Linux CI trace and POSIX-sh emulation: the old shape executes a payload for 7 of 18 hostile names, the new unlock lines 0 of 180 pastes; execution is confined to a scratch directory.
8. F2: the kept verify counter is reachable, not dead, and its wording is exactly true; the structural argument holds by hand and by enumeration.
9. Test discipline: 0 removed `test(` lines against base, the one moved body is stronger, comment-only edits confirmed by emit diff, 0 suppressions or sleeps, 893 plus 44 equals 937.
10. Migrated allowlist byte-identical from two bases; verify PASS with 0 newly allowlisted and 0 newly blocking; the untouched set has an empty diffstat.
11. Prose claims in the CHANGELOG, Addendum 2 and the ADR match the instruments (named-test list identical to `git grep`, parity 8 of 8 of 8, one NUL blob confirmed).

## Observations (outside this delta, not counted as findings)

- Pre-existing sink, already logged by the security lane as LOW: the blocking-match line prints the git-spelled path raw. In my sh emulation a hostile name executed a payload when the whole match line was pasted (16 of 360 pastes, all of that one line kind, none an unlock line). It is not a command the tool offers, it predates this story, and the fix-now round did not claim to close it.
- The completeness checker per-instrument cap of 60 s (`src/qa/completeness-claim-checker.ts`) sits close to the 56.5 s real runtime of the mutation-shell instrument on this machine; under load it reports a false red. Unchanged by this story; a candidate for the backlog, not for this diff.
- The comment above `SHELL_SAFE` and `percentEncode` says the encoded output uses characters that no shell treats as syntax. In cmd, a percent-delimited name is a variable reference. This is inert here (the line is not a command, and only the current-directory variable can be formed from hex-digit names), but the sentence is stronger than the fact.

## Missing checks, by name

- `sb2-percent-encoding-is-injective-for-control-and-astral-characters`, `sb2-unlock-command-lists-each-pattern-of-one-path`, `sb2-binary-helper-window-matches-the-scanner` (finding 1).
- A PowerShell run of the pasted-lines check is not in the permanent test; it is covered by construction and by the security lane.

## Failing tests versus open findings

Open findings: 1 ([ISSUE], LOW). Failing tests against the shipped code: 0. Reason for the gap: finding 1 is a set of pins for behavior that is correct today; each named test is green on the shipped tree and red under its mutant, so no failing form exists against the shipped code (the mutation results above are the executable evidence).

## Editorial (uncounted, verdict-neutral)

- Addendum 2 says found by enumeration, and the test comment says exhaustive: the enumeration is exhaustive over one pair and three values; the generalization to many pairs is by the per-pair structure of the check (argued in section 3), which is sound but is prose.
- The CHANGELOG rollback sentence says the range from `fefce23` through `62b95b2`; as git range syntax that needs the caret form on the first commit to be inclusive.
- The omitted-pairs line refers to a no-command rule that the run may not otherwise explain (section 2, cap accounting).

## Praised decision

The fix removes the class, not the instance: rather than quoting harder for three shells, it prints a command only when the path contains no character any shell can act on, and everything else becomes a line that cannot run. The tests then attack the decision from both sides (the whole printable ASCII range through the unit function, hostile names through the real CLI into a real shell) with a positive control that proves the harness can see an exploit.

## Single next action

Manager: with this lane clean, collect the app-security and red-team re-confirms and the cross-domain round-2 verdict; if all are clean or conditional-clean, hand the pull request to the human for the named-exception ruling and the closing of issues 136, 203, 238, 239 and 240.

RECEIPT: verdict=SHIP
findings:
1. [ISSUE][LOW][demonstrated] src/secret-scan/history-scan.ts:183-190,205 and history-scan.test.ts:1366 -- 4 surviving mutants: hex zero-pad, code-point iteration, path-only dedupe key, 8000-byte helper window; shipped code correct (property test 0 failures); add 3 small pins, no failing form today
2. [CLEAN][demonstrated] issue 240 closed: sb2-generator-and-verify-scope-history-and-legacy-file-to-the-base-ref green on shipped code, red under 4 of 4 base-ref mutants
3. [CLEAN][demonstrated] ENOENT LOW closed: same unstaged deletion, old test red, new test green; helper tested with positive and negative case; test-first commit red
4. [CLEAN][demonstrated] ten-pair cap and hash multi-match LOWs closed: 7 of 7 cap mutants and 3 of 3 hash mutants killed
5. [CLEAN][demonstrated] HIGH-fix tests pin behavior: red at db3d5d8, green at 9833d38, unchanged between; 29 of 29 single-character widenings, both anchors and 12 encoder mutants killed; 6 survivors equivalent by construction
6. [CLEAN][demonstrated] percentEncode correct and injective: 200000 random and 33824 exhaustive strings, 0 failures, output grammar safe-or-percent-HH
7. [CLEAN][demonstrated] portability: POSIX sh emulation shows old shape executes a payload for 7 of 18 hostile names, new unlock lines 0 of 180 pastes; execution confined to a scratch dir with 30 s timeout; Linux runner itself UNPROVEN-pending-verification (CI npm test on the PR)
8. [CLEAN][demonstrated] F2 kept verify counter is reachable, not dead, wording exactly true; structural argument holds by hand and by 200-case enumeration
9. [CLEAN][demonstrated] test discipline by instrument: 0 removed test( lines vs base 25291ff, moved body stronger not weaker, history-scan.test.ts comment edits confirmed comment-only by emit diff, 0 suppressions or sleeps, 893+44=937
10. [CLEAN][demonstrated] migrated allowlist byte-identical from generate at bases 7b62344 and 25291ff; verify PASS 0 newly allowlisted 0 newly blocking; must-stay-untouched set has empty diffstat
11. [CLEAN][demonstrated] CHANGELOG, Addendum 2 and ADR claims match instruments: named-test list identical to git grep (37), frontmatter/body/catalog parity 8/8/8, one NUL blob in story history, counts 12/0/50/17
counts: issues=1 suspicions=0 clean=10
evidence: demonstrated=11 code-traced=0 derived=0
checks="937/0/0"
adr=HIT(37)
report=docs/reviews/s1-136-value-scoped-allowlist-code-round2-2026-09-19.md
