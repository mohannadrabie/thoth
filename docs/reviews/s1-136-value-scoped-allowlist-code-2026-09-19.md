# s1-136-value-scoped-allowlist: code review (correctness, test quality, maintainability), 2026-09-19

[code-reviewer]
Code Reviewer (Anubis): reviewing for correctness and user-facing trust.

- Scope: story S-B2 (issues 136 and 203), branch `fix/s1-136-value-scoped-allowlist`. Code reviewed at HEAD 46e8d88 against base 25291ff. The tree HEAD at write time is ce08845, which adds only the two peer review reports.
- Tier: CRITICAL (Manager-ratified, not re-litigated). Lane: correctness against the story, test quality, maintainability. Security properties belong to `app-security-reviewer`; whole-catalog collisions to `cross-domain-reviewer`.
- ADR cache: `[CACHE=HIT]`, 37 ADRs. Lane rules read from the catalog: the testing-strategy ADR (unit tests for new behavior, idempotency test for mutating ops, no deleted or weakened tests) and THOTH-ADR-0002 (Proposed, served like an accepted ADR per issue 220). No BLOCKER: both are satisfied by the instruments below.
- Out of scope, already filed, not re-filed, not worsened by this diff: issues 233, 235, 236, 237, 238.

## Verdict: SHIP from this lane, with one MED pin to fold into the rework pass

- No user-facing functional bug found in the gate, the loader, the generator or the migrated file.
- One demonstrated MED: a missing pin on the generator's base-ref scoping (issue 240). Shipped behavior is correct; the check is toothless.
- The story as a whole is not clear to merge: `app-security-reviewer` filed a demonstrated HIGH on the printed HASH-COMMAND line (issue 239). It is in code I read, and my lane's checks could not have caught it (see "Missing checks").

## Scorecard

| Axis | Grade | Basis |
|---|---|---|
| Correctness vs story (R136-1..9, R203-1..3, A2 to A8) | SOLID | Every criterion maps to code and to a named test; 24 of 32 mutants killed, 8 survivors classified below |
| Idempotency and re-runs | SOLID | Generator run-twice byte-identical; already-scoped input carried unchanged; regenerate is byte-identical to the tracked file |
| Inputs and edge cases | SOLID | Loader fails closed on unreadable, non-JSON, non-array and every malformed entry shape; each rejection named without a value or hash |
| Error handling and operability | SOLID with one HIGH from the security lane | Unlock line accurate and actionable for well-formed paths (drilled through the pre-commit simulated commit); hostile path shapes are issue 239 |
| Verification quality | GAPS | 8 surviving mutants; one is a real pin gap (finding 1) |
| Maintainability | SOLID | About 150 net lines in `history-scan.ts`, one new 347-line tool that reuses the gate's own matching and hashing |

## Checks run (raw, this session)

| Check | Result |
|---|---|
| Touched test files (`history-scan.test.ts`, `pre-commit-scan.test.ts`, `allowlist-tool.test.ts`) in a scratch clone at 46e8d88 | tests 70, pass 70, fail 0, skipped 0 |
| `npm test` (full) | tests 929, pass 929, fail 0, cancelled 0, skipped 0 (929 = 893 baseline + 36 added test lines, counted by instrument) |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run oss:secret-scan` | PASS, 0 blocking, 1665 allowlisted |
| `node src/qa/completeness-claim-checker.ts` | PASS, 2 files checked, exit 0 |
| `git diff --stat 25291ff HEAD` on the six must-stay-untouched paths (patterns.ts, pre-commit-scan.ts, simulated-commit.ts, ci.yml, .githooks/pre-commit, src/lib/git.ts) | empty output (untouched) |
| Spike `docs/spikes/s1-136-value-triples-2026-09-19.mjs` at 46e8d88 | distinctTriples 108 (history), 107 (simulated tree), union 108, 50 pairs, 50 of 50 grants match, 0 non-granted; exit 0 |
| `allowlist-tool.ts verify --base 7b62344` against the tracked file | PASS; legacy 50, migrated 50, dropped 0, hashes 108; occurrences allowlisted before 1540, after 1540; newly allowlisted 0; newly blocking 0; exit 0 |
| Not run | Linux/POSIX execution of the new tests (see the UNPROVEN note in section 3) |

## 1. Acceptance criteria to code to named test, and mutation results

Mutants were applied in a scratch clone only (never the working tree) and the three touched test files run against each: 32 valid mutants, 24 killed, 8 survived. The harness lived outside the repo.

| Criterion | Code | Named test that goes red when the behavior is removed | Mutant evidence |
|---|---|---|---|
| R136-1 exempt only granted values | `partitionAllowlisted` (path, pattern id and hash must all agree) | `oss01-entry-exempts-only-its-granted-values`, `oss01-real-allowlist-refuses-a-novel-value-in-every-granted-pair` | ignore hash: 8 red; drop path from key: 7 red; drop pattern id from key: 1 red (the four-cell test) |
| R136-2 gate-level novel secret in a granted file | same, plus the CLIs | `oss01-allowlisted-file-still-blocks-a-novel-secret` (unit, and three pre-commit CLI cells), `sb2-history-scan-cli-exits-nonzero-on-novel-secret-in-granted-file` | killed by the ignore-hash mutant |
| R136-3 reviewed literal stays allowlisted and reported | `allowlistedDetails` | `oss01-reviewed-literal-stays-allowlisted-and-reported` plus the issue 194 stdout test | remove the ALLOWLISTED lines: 2 red |
| R136-4 one shared implementation | `scanBlobText` exported and reused by the tool; loader used by both CLIs and the dogfood test | `sb2-real-allowlist-loads-with-no-rejected-entry`, the dogfood test, `sb2-scanner-hashes-at-match-time-and-stores-no-raw-text` | latin1 to utf8 hash: 1 red (the non-ASCII case); hash the redacted text: 14 red |
| R136-5 three human-named pairs value-scoped | migrated file | `sb2-three-human-named-pairs-are-value-scoped` | first real entry made legacy-shaped: 4 red (dogfood, T10, T8, T9) |
| R136-6 malformed or missing scope rejected | `entryRejection`, `loadAllowlist` | `sb2-malformed-or-missing-scope-is-rejected-and-blocks` (ten shapes incl. one valid plus one malformed element) | uppercase accepted: 3 red; every to some: 1 red; empty list accepted: 2 red; missing list accepted: 12 red; whitespace reason accepted: 1 red |
| R136-7 no broadening, by script | `verifyMigration` | `sb2-verify-rejects-a-widened-set`, `sb2-verify-rejects-a-dropped-entry-or-hash-that-still-matches`, `sb2-generator-cli-prints-counts-only` | unbacked-hash check off: 2 red; reason-change check off: 1 red; no-legacy-pair check off: 1 red |
| R136-8 completeness by instrument | spike, generator counts | script checks above (108 triples, 50 of 50, verify counts) | n/a (script, not a test) |
| R136-9 real verification | this section | table above | n/a |
| R203-1 exclusion removed, grants pinned | `deriveMutableCredentialGrants` (prefix and its `continue` removed), 7 pins in `REVIEWED_BASELINE` | the T11 test (title verbatim from red-team), the X1 fixture test, the key-set equality test | re-adding the exclusion: 4 red |
| R203-2 prose | comment block and helper doc comment | by reading (no executable form) | n/a |
| R203-3 attack E | loader blocks a legacy-shaped report grant | `oss01-attack-e-legacy-shaped-report-grant-blocks-at-the-gate` (gate and pre-commit CLI); `oss01-attack-e-report-grant-without-a-baseline-pin-is-caught-by-the-baseline-guard` (renamed per the Manager ruling, states the residual honestly) | missing-list accepted: killed |
| A2 re-run semantics, two-directional verify | `migrateAllowlist` carry, `verifyMigration` | `sb2-generator-never-adds-a-hash-to-an-already-scoped-entry`, `sb2-verify-rejects-a-dropped-entry-or-hash-that-still-matches` | widen on carry: 1 red; no sort: 3 red |
| A3 skeleton layers | CLI subprocess tests | `sb2-history-scan-cli-exits-nonzero-on-novel-secret-in-granted-file` and its granted-alone control | ignore-hash mutant: red |
| A5 report file omits hash of blocking matches | `main()` `reportMatches` | `sb2-report-file-omits-value-hash-for-blocking-matches` | keep hash on blocking: 1 red |
| A6 no tracked text file skipped as binary | test derived from `git ls-files` | `sb2-no-tracked-text-file-is-skipped-as-binary` | passes on the real tree; see finding 2 for its one weakness |
| A7 unlock names the hashed value, runs in the platform shell | `unlockDetails` | `sb2-unlock-command-output-is-accepted-by-the-gate` (every pattern id) | drop the MATCH-text line: 1 red; drop all unlock lines: 5 red; print the blocked hash on the unlock line: 4 red |
| A8 rejected entry named | `rejectedDetails`, loader `rejected` | `sb2-rejected-entry-is-named-in-blocking-output` (entry-level and three file-level classes) | remove lines: 2 red; file-level unrecorded: 1 red |
| A4 by wording | ADR "usable credential" rule, Named exception section, residual row | read; matches the code and the pin reason (no test by design) | n/a |

### Surviving mutants (8), each classified

| Mutant | Why it survives | Class |
|---|---|---|
| generate and verify scan HEAD instead of the base ref | every generator test uses base equal to HEAD | real pin gap, finding 1 |
| legacy file read at HEAD instead of the ref | same fixture shape | real pin gap, finding 1 |
| unlock command cap off by one | no test has more than ten blocked pairs | LOW, finding 3 |
| `hash` subcommand prints only the first match of a blob | the CLI test uses one literal per file; the unit test covers `hashLines` only | LOW, finding 3 |
| verify: dropped-entry-that-still-matches diagnostic off | `ok` is still false through the newly-blocking count; redundant named diagnostic | equivalent on `ok` |
| verify: widening counter off | a widening is also reported by the unbacked-hash, no-legacy-pair and already-scoped checks | equivalent on `ok` |
| duplicate entries for one pair, last wins | narrower direction (fail closed); the real file has one entry per pair | not a defect |
| `partitionAllowlisted` treats a hash-less entry as a whole-pair grant | unreachable: the loader never lets such an entry through, and the type forbids it; the shipped code throws on one | not reachable |

## 2. Test-discipline by instrument (testing-strategy ADR, no deleted or weakened tests)

Instrument: the unified zero-context diff of every test file between the base and HEAD.

- Removed `test(` lines: 0. Added `test(` lines: 36 (equals 929 minus 893). Removed assertion lines: 1.
- Every removed or edited existing line, classified:

| Lines | Class |
|---|---|
| `history-scan.test.ts` matches-present fixture (one line) | plan-listed fixture-shape edit (recorded deviation: the type now requires the hash) |
| partition split, allowlisted-but-reported, match-not-on-list: match and entry literals gain the hash field | plan-listed fixture-shape edit |
| loader accepts a reason, loader rejects no reason (three entries, one match): gain the hash field, meaning unchanged | plan-listed fixture-shape edit |
| dogfood test: raw JSON read replaced by `loadAllowlist` | plan-listed (stronger: an invalid entry now blocks) |
| `pre-commit-scan.test.ts`: three fixture allowlists gain the hash of the fixture secret | plan-listed fixture-shape edit |
| `deriveMutableCredentialGrants` fixture line and its deepEqual assertion (the reports entry now expected included) | the X1 flip, the only assertion changed |
| comment block rewrite, helper doc comment, the prefix constant and its `continue` | plan-listed issue 203 work (R203-1, R203-2) |
| import line edits (three: two in `history-scan.test.ts`, one in `pre-commit-scan.test.ts`) and one comment word ("since-removed") | other, benign: additive imports for the new tests and a comment; no test or assertion is deleted or weakened |

The strict reading "any other is a finding" would count the four benign lines. I do not raise them: the ADRs forbid deleting or weakening tests, and the instrument shows neither. Disclosed under Editorial so the Manager can overrule.

- Dropped permanent test (`sb2-skeleton-real-file-round-trip-scans-clean`, 39.7 s): sound. The dogfood test already scans the real full history with the real allowlist through `loadAllowlist` and asserts zero blocking (mutating the real file to a legacy shape turns it red, demonstrated), and CI OSS-01 step scans the same history and file through the real entry point. The entry-point behaviors it was meant to cover are pinned by the cheap subprocess tests (mutants killed above). Unpinned by any permanent test after the drop: (a) that the real file hash count equals the independent triple count (an extra hash that matches nothing today; that is the entries-match-nothing lint, issue 235, out of scope) and (b) that `generate` reproduces the tracked file. I reproduced (b) in section 4 by script. Neither is a defect.

## 3. Correctness and edge cases

- **Hash at match time.** `hashMatchedBytes` is a latin1 round trip of the decoded blob text, so it equals the hash of the file own bytes; the non-ASCII case is pinned and its mutant killed. The spike counts 0 non-ASCII matches today.
- **`LoadedAllowlist` as an array intersected with a `rejected` property.** Sound as a type. The only production callers (`history-scan.ts` `main()` and `pre-commit-scan.ts`) pass the loaded value straight to `summarizeMatches`, so no caller loses diagnostics today. Latent residual: any future copy or filter of the array drops `rejected` silently (diagnostics only; fail-closed is unaffected because rejected entries are never in the array). Not raised as a finding.
- **Fail-closed.** An unreadable, non-JSON or non-array file yields zero entries plus a named file-level rejection, so every match blocks; each of those three classes is asserted. A passing run prints rejection lines in CI (details are kept) and none in the pre-commit hook (the existing issue 194 behavior suppresses details on a pass). A rejected entry that matches nothing is silent in the hook by design.
- **Partition.** Duplicate entries for one pair union their hashes; behavior is consistent and the real file has none.
- **`summarizeMatches` output.** UNLOCK lines state the rule, that the hashed value is the regex match text (naming the two patterns where it includes the key name and quotes), and a per-pair HASH-COMMAND. Demonstrated end to end in a scratch repo: a staged novel literal is refused by `pre-commit-scan.ts`, and the printed command (which names the abbreviated sha of the simulated commit) runs and prints one 64-hex value beside the redacted form (exit 0). The cap is ten pairs, then a count line. The blocked match hash is never printed by the gate (the mutant that prints it is killed by four tests). Hostile or special path shapes in the printed command are issue 239 (HIGH, security lane) and issue 238.
- **Generator.** `generate` scopes history and the legacy file to `--base`. Demonstrated correct on the shipped code in a two-commit scratch repo: base at the first commit gives 1 hash, base at HEAD gives 2; verify against the first commit on the 2-hash file fails with a "lists 1 hash(es) that no scanned match carries" problem, exit 1. Idempotent: an already-scoped entry is carried unchanged and never gains a hash. `verify` is two-directional (an added hash, a dropped entry and a dropped hash that still matches all fail).
- **Determinism and portability.** All 929 tests pass on Windows here. The unlock test runs the printed command through `spawnSync` with `shell: true`; the command shape (node, the repo-relative tool, `hash`, a sha, a quoted path, a pattern id) is valid in cmd, PowerShell and sh, and CRLF output is handled by `trimEnd`. Not run on Linux: **UNPROVEN-pending-verification**; the settling command is the same `npm test` on the CI Linux runner, run by CI on the pull request.

## 4. The migrated file, regenerated independently

`allowlist-tool.ts generate --base <ref> --out <scratch file>` from the legacy file at each of two bases (7b62344, the base recorded at Phase 2 start, and 25291ff, the reviewed stacked base; their legacy files are identical):

- Output: entries 50, carried 0, dropped 0, hashes 108; per pattern: fine-grained token 3, classic token 2, AWS key id 12, email 23, internal hostname 67, private IPv4 1; under the dated-reports directory 57; credential-shaped 17. Exit 0 both times.
- `cmp` against the tracked `docs/qa/secret-scan-allowlist.json`: **byte-identical** for both bases.
- Path, pattern id and reason of all 50 entries identical to the legacy file, in the same order; the diff of the tracked file against the base is additions only.

## 5. Issue 203

- The prefix constant is gone from code (no reference remains outside the comment in the test file and two historical mentions, an existing test title and its assertion message, left as instructed). The `continue` in `deriveMutableCredentialGrants` is gone.
- Seven report grants are pinned, hashes produced by the derivation, hand-written reasons that each say what the literal is; the reason of the one named exception says the rotation call is the human decision (issue 89).
- Re-adding the exclusion turns four tests red (mutation above). Removing a pin fails the key-set equality test and the T11 test (both assert non-empty pinned baselines for every derived report grant).
- Prose: the stale rule-11 justification is replaced by a statement that report immutability is not mechanically enforced (issue 233). Accurate.

## 6. Maintainability and claims

- `history-scan.ts`: 196 changed lines; loader, partition, unlock and rejection details are small pure functions. No dead code found. `isValidAllowlistEntry` is now used by tests and the tool only; kept as the documented public predicate.
- CHANGELOG, plan addendum, ADR and registry claims checked against the diff and instruments: 929/0/0 confirmed; 108 triples confirmed at 46e8d88; zero newly allowlisted and zero newly blocking confirmed; no legacy shape confirmed in `entryRejection`; the untouched-set claim confirmed by empty diffstat. The per-commit claim that the spike count did not move I confirmed only at the final tree (108), not commit by commit.
- **Runtime claim, re-measured.** Same tree (46e8d88 checkout), old `history-scan.ts` from 25291ff against the migrated file versus the new code, `pre-commit-scan.ts` on a clean index, interleaved, 5 rounds each, both exit 0: median new 20.74 s, median old 20.72 s, delta +0.1 percent; worst single-round positive delta +1.2 percent (round 1); means 20.56 s and 20.69 s. Absolute times are higher than the 14 s in the CHANGELOG because other reviewers were running on the same machine; the ratio, which is what the plan 10 percent acceptance tests, holds with wide margin. The 10.1 percent worst non-interleaved round in the brief does not reproduce when the runs are interleaved.

## Findings, ranked by user-trust impact and blast radius

### 1. [MED][demonstrated] The generator and verify base-ref scoping is not pinned by any test

- Evidence: `src/secret-scan/allowlist-tool.ts` `readLegacyAtRef` (reads the legacy file at `base`), and the `scanHistory` call with `{ ref: base }` in `runGenerate` and `runVerify`. Mutation applied in a scratch clone (scan HEAD; read the legacy file at HEAD): tests 70, pass 70, fail 0, skipped 0. Every generator test uses base equal to HEAD, so the property that a new literal in the diff blocks instead of being absorbed into the migration (plan section 8, hygiene) has no check.
- User action to wrong result: a maintainer follows the documented moved-base or damaged-file procedure, a later refactor makes the scan drift to HEAD, and the regenerated file silently blesses every value now in the tree; `verify` shares the same scan, so it cannot object. Shipped code is correct today (demonstrated), so this is a toothless check, not a live defect.
- Exposure: ~0% of gate runs, basis: counted in code (offline, human-run tool; used only in the documented regeneration and rollback-repair procedures).
- Minimal fix: one two-commit fixture test. Named test: `sb2-generator-and-verify-scope-history-and-legacy-file-to-the-base-ref` (commit one holds literal A and a legacy entry; commit two adds literal B and edits the allowlist; generate at commit one yields exactly one hash; verify at commit one fails on a file carrying the hash of B). It is green against today code and red under the applied mutant, so no executable failing form exists against the shipped code (see the failing-tests note).
- Issue filed: issue 240 (bug, severity:med, oss, milestone S1).

### 2. [LOW][demonstrated] `sb2-no-tracked-text-file-is-skipped-as-binary` fails with ENOENT on any unstaged deletion of a tracked file

- Evidence: it walks `git ls-files` and calls `readFile` on the working-tree path. Demonstrated: deleting one tracked file in a scratch clone gives pass 0, fail 1 with an ENOENT trace, not a scanner-relevant message.
- User action to wrong result: a developer deletes a tracked file, runs `npm test` before staging, and sees a failure that names an unrelated assertion.
- Minimal fix: skip a path whose read raises ENOENT (the scanner reads blobs, not the working tree), or read the blob through `git cat-file`. Named test: `sb2-no-tracked-text-file-is-skipped-as-binary-tolerates-an-unstaged-deletion` (has a failing form today).
- LOW: no Issue filed.

### 3. [LOW][demonstrated] Two behaviors of the unlock output are unpinned

- Evidence: surviving mutants (cap comparison in `unlockDetails` off by one; `hash` subcommand printing only the first line). Both leave 70 of 70 green.
- User action to wrong result: with more than ten blocked pairs the developer would see one command fewer than the count line implies; with several matches in one blob the `hash` command could omit one, and a hash the developer needs is missing.
- Minimal fix: named tests `sb2-unlock-command-lists-ten-pairs-then-counts-the-rest` and `sb2-hash-command-prints-one-line-per-match-in-a-blob`.
- LOW: no Issue filed.

### Clean, verified (worth naming)

4. Every criterion has a named test that goes red when the behavior is removed; the 24 kills above are the evidence.
5. The migrated file regenerates byte-identical from the legacy file at two bases; verify PASS, 0 newly allowlisted, 0 newly blocking.
6. No existing test removed; the only changed assertion is the ruled X1 flip; test-count arithmetic closes exactly (36 added, 893 to 929).
7. The dropped 39.7 s round-trip test is sound to drop.
8. Runtime: +0.1 percent median interleaved, against the plan 10 percent.
9. The `LoadedAllowlist` intersection type is sound; no production caller loses diagnostics; fail-closed is preserved.
10. The unlock line is accurate and actionable for well-formed paths, drilled through the pre-commit simulated commit; it never prints the hash of a blocked value.
11. Issue 203: exclusion removed, seven grants pinned, re-adding the exclusion fails four tests.
12. Untouched set has an empty diffstat; typecheck, lint, gate and QA-15 exit 0.

## Missing checks, by name

- `sb2-generator-and-verify-scope-history-and-legacy-file-to-the-base-ref` (issue 240).
- `sb2-unlock-command-lists-ten-pairs-then-counts-the-rest`, `sb2-hash-command-prints-one-line-per-match-in-a-blob` (finding 3).
- `sb2-no-tracked-text-file-is-skipped-as-binary-tolerates-an-unstaged-deletion` (finding 2).
- Belongs to the security lane, listed here because it is a toothless check in my lane: `sb2-unlock-command-output-is-accepted-by-the-gate` executes the printed command only for a plain path, so it cannot see a path-shape defect. The test that closes it is part of the fix for issue 239 (a path with shell metacharacters is refused or safely quoted). Not re-filed.

## Failing tests versus open findings

Open findings: 3 ([ISSUE]). Failing tests against today code: 1 (finding 2). Findings 1 and 3 are pins for behavior that is correct today: their tests are green on the shipped code and red under the named mutants, so no failing form exists against the shipped tree; the mutation results are the executable evidence.

## Editorial (uncounted, verdict-neutral)

- `src/secret-scan/history-scan.test.ts`: the title and assertion message of the baseline-integrity test still name the removed prefix constant (historical, left on purpose); the issue 193 comment block above the dogfood test describes the old whole-file join in present tense.
- The plan addendum list of named tests (stated as generated by git grep, not typed) holds 27 names; the test files hold 29: two control tests are only mentioned in its parentheses. The list is hand-annotated, not purely generated.
- CHANGELOG says existing tests changed only in fixture shape plus the one assertion; it omits the import additions, the comment rewrites and the removal of the exclusion in the derive helper (the issue 203 code); none weakens a test.
- CHANGELOG cost line quotes 14 s absolute; the ratio is what matters and it reproduces.
- Strict-reading disclosure for the other-class test lines: four benign lines (imports, one comment word), see section 2.

## Praised decision

The scanner hashes at match time, and the generator, the `hash` subcommand, the gate and the pre-commit hook all reuse the one exported `scanBlobText`. The unlock command, the migration and the gate therefore cannot disagree about what a match is, which is why a fresh regeneration is byte-identical to the shipped file.

## Single next action

Fix issue 239 (emit the HASH-COMMAND only for safely quotable paths) and, in the same pass, add the pin from issue 240; then ask `app-security-reviewer` to re-verify.

RECEIPT: verdict=SHIP
findings:
1. [ISSUE][MED][demonstrated] src/secret-scan/allowlist-tool.ts:123,133,300 -- generate/verify base-ref scoping and ref-scoped legacy read are unpinned (mutation stays 70/70 green); shipped behavior correct; add one two-commit fixture test (issue 240)
2. [ISSUE][LOW][demonstrated] src/secret-scan/history-scan.test.ts (sb2-no-tracked-text-file-is-skipped-as-binary) -- reads the working tree, ENOENT on an unstaged deletion of any tracked file; skip ENOENT or read the blob
3. [ISSUE][LOW][demonstrated] src/secret-scan/history-scan.ts unlockDetails cap and allowlist-tool.ts hash output -- cap off-by-one and first-line-only mutants survive; add two small pins
4. [CLEAN][demonstrated] every R136/R203/A2-A8 criterion maps to a named test that goes red on removal: 24 of 32 mutants killed, 8 survivors classified (2 real pin gaps, 2 equivalent, 2 unreachable or harmless, 2 LOW)
5. [CLEAN][demonstrated] migrated file regenerated at two bases is byte-identical to the tracked file; verify PASS, 0 newly allowlisted, 0 newly blocking, 108 hashes over 50 entries
6. [CLEAN][demonstrated] no existing test removed, one assertion changed (the ruled X1 flip), 36 tests added (893 to 929); every edited line classified by instrument
7. [CLEAN][demonstrated] dropped 39.7 s round-trip test is sound to drop (dogfood test and CI scan the same real history and file; entry point pinned by cheap CLI tests)
8. [CLEAN][demonstrated] runtime re-measured interleaved x5: median +0.1 percent (worst round +1.2 percent) against the 10 percent acceptance
9. [CLEAN][code-traced] LoadedAllowlist intersection type sound; no production caller loses diagnostics; fail-closed preserved
10. [CLEAN][demonstrated] unlock output accurate and actionable through the pre-commit simulated commit for well-formed paths; blocked hash never printed (mutant killed); hostile paths are issue 239
11. [CLEAN][demonstrated] issue 203: prefix removed, seven grants pinned, re-adding the exclusion fails four tests, prose accurate
12. [CLEAN][demonstrated] untouched set has empty diffstat; typecheck, lint, gate (0 blocking, 1665 allowlisted) and QA-15 exit 0
counts: issues=3 suspicions=0 clean=9
evidence: demonstrated=11 code-traced=1 derived=0
checks="929/0/0"
adr=HIT(37)
report=docs/reviews/s1-136-value-scoped-allowlist-code-2026-09-19.md
