[code-reviewer]
Code Reviewer (Anubis) - reviewing for correctness & user-facing trust

# Code review: Issue #325 separator-scan meter proof test + mutant (STANDARD, test-only)

Delta `a1f3d27..9f993c9` (457d62c, 9f993c9): 4 files, +38/-0. No production file changed.
ADR: `[CACHE=HIT]` 37 ADRs; SE ADR-0005/0010 (tests are the answer key, add-only) applied.

## Scorecard
| Axis | Verdict |
|---|---|
| Correctness vs Issue #325 (named test, registered mutant) | SOLID |
| Bound arithmetic / margin / flake risk | SOLID |
| Mutant registration | SOLID |
| ADR-0005/0010 add-only | SOLID (0 deletions in diff) |
| Scope / gold-plating | SOLID (optional sweep early-exit left on the Issue) |
| CHANGELOG / STATE accuracy | SOLID |

## Bound, traced (shell-scanner.ts:229-246)
- Real code meter = quote walk `n` (line 110) + outer loop up to first newline (`f+1` steps) + inner run `n-f-1` = **2n** exactly.
- Test floor = `n + innerRun - 16` = 2n-27 (innerRun = n-f-1, f+1 = 11/12/12 for newline/crlf/mixed).
- Mutant = `n + f+1` = n+11 or n+12. Margin between floor and mutant ~ n-38 = ~4058 chars at 4 KB. The floor sits 27 below real, so the check is exact-arithmetic, not statistical: no wall clock, deterministic, not flaky.
- Slack 16 covers off-by-one in the outer/inner boundary only; it is small enough that a half-counting mutant (`>> 1`) also dies (see below). Justified.
- False-fail on a legitimate optimisation: only if a refactor stops metering the inner run while still doing it, which is the defect the test exists to catch. A refactor that skips the walk (early exit) and meters what it visits could lower the count and would need this floor updated: that is the meter contract, not a defect.
- Shapes newline / CRLF / mixed match the existing `TRAILING_UNITS`; the fixture asserts a separator newline exists (`firstNewline > 0`), so a fixture drift fails loud.

## Mutant registration
- Anchor `meterAdd(j - i - 1);` occurs exactly once in shell-scanner.ts (grep -c = 1), so `textMutant` cannot mis-anchor.
- Placed beside the sibling #321 separator-scan mutant; scanner is `SCANNER`; `shell-scanner-work.test.ts` is in `TEST_FILES` (line 41), so the mutant can die there.

## Verification (run by me)
```
node --test src/policy/normalizer/shell-scanner-work.test.ts   -> tests 11, pass 11, fail 0, skipped 0
npm run qa:mutation-shell -> [QA-06 shell-detector-mutants] PASS: 60 of 60 mutant(s) KILLED.   (~76 s)
```
Own mutation in a detached `git worktree` at 9f993c9 (removed afterward; `git worktree list` shows only the main tree):
- Line deleted: `fail 1` -> `newline: meter read 4107 for a 4096-character text with a 4085-character inner whitespace run ... (expected about 8181)`; pass 10.
- Variant `meterAdd((j - i - 1) >> 1)`: `fail 1`, pass 10. Killed too, so the floor is not merely tuned to the one deletion.

## Findings
No defects. No missing checks: the mutant is the toothed check for the deleted-increment class; the test is the named proof-test from the Issue.

## Editorial
- The Issue's optional sweep early-exit is not done and #325 stays open by design (`Refs`, not `Closes`); close it only once the human decides the sweep item is dropped or filed separately.

## Verdict: SHIP
Praised decision: asserting a floor on the meter (text length plus inner run) instead of a new wall-clock or ratio test: it is deterministic, names exactly the increment it protects, and the failure message prints both numbers.

Single next action: human merges the branch, then decides whether the remaining sweep early-exit stays on #325 or is split out so #325 can close.

RECEIPT: verdict=SHIP
findings:
1. [CLEAN][demonstrated] shell-scanner-work.test.ts:59-78 - floor 2n-27 vs real 2n vs mutant n+11: line-deleted and half-count variants both fail the new test in own worktree (4107 vs about 8181)
2. [CLEAN][code-traced] shell-detector-mutants.ts:472-478 - anchor `meterAdd(j - i - 1);` unique (1 occurrence), scanner file, shell-scanner-work.test.ts in TEST_FILES; 60/60 killed
3. [CLEAN][code-traced] diff a1f3d27..9f993c9 is +38/-0, no production change: SE ADR-0005/0010 add-only holds; optional sweep early-exit not gold-plated
counts: issues=0 suspicions=0 clean=3
evidence: demonstrated=1 code-traced=2 derived=0
checks="71/0/0"
adr=HIT(37)
report=docs/reviews/s325-separator-meter-proof-test-code-review-2026-09-29.md
