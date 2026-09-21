[code-reviewer]
⚖️ Code Reviewer (Anubis) — reviewing for correctness & user-facing trust

# Code review: s1-135-pat-regression-test (Issue #135, Story B part S-B1)

- Scope: `git diff 4644b2b HEAD` (base = tip of the stacked branch for the previous story, not re-reviewed). HEAD 6d048d5 (build commits 320dba6 and 6d048d5; plan 84a99d5).
- Tier: STANDARD (Manager-ratified in the run log; not re-litigated). Sensitive area: test file under `src/secret-scan/`, so a named reviewer.
- ADR cache line: `📊 ADR cache HIT: reused 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1] from catalog — ≈17800 tokens saved this pass (fp 5dba384) [CACHE=HIT]`.
- ADRs applicable to this domain (code, testing): SE ADR-0005 (testing strategy) only. Rules that bite here: "MUST NOT delete or weaken a failing test to make CI pass", "MUST NOT use ... ordering-dependent tests", "MUST make each test create/own its data". No violation (evidence below). Not applicable: devops ADRs, the other SE ADRs. No BLOCKER.

## Scorecard

| Axis | Grade | Basis |
|---|---|---|
| 1 Correctness vs R135-1..3 | SOLID | each criterion mapped to a test and a mutation that turns it red (below) |
| 2 Idempotency / re-runs / order | SOLID | lastIndex probe demonstrated (below) |
| 3 Inputs and edge cases | SOLID | all four exemplars individually distinguish the old regex from the current one |
| 4 Error handling / operability | n/a | test-only diff |
| 5 Verification quality | SOLID, one survivor | M1-M4 reproduced; one extra mutation (M6) survives, LOW |
| 6 Maintainability | SOLID | fixtures built from named constants, no copy-paste divergence |

## Criteria map

| Criterion | Code | Check that proves it |
|---|---|---|
| R135-1 the snake_case prose exemplars do not match, real format still does | first new test in `src/secret-scan/patterns.test.ts` (title starts "github-fine-grained-pat: does NOT match ordinary PAT-discussion prose") | M1 (old `\w{20,255}` form) turns exactly this test red, failing on the first exemplar; M3 (identifier floor 20 to 1) turns exactly this test red |
| R135-2 truncated prefix-only shape (22-char identifier, empty secret) matches as the whole fixture | second new test ("matches a truncated prefix-only disclosure"), `deepEqual(match, [fixture])` | M2 (secret segment `*` to `+`) turns exactly this test red |
| R135-3 both reviewer-proposed names greppable | one title carries the Issue #135 regression wording and the bracketed `github-fine-grained-pat-word-boundary-test` suffix | grep of the title in the test file; folding is sound because the red-team spec is a subset of the first test assertions |

## Real check results (raw)

Run at HEAD 6d048d5, working tree clean apart from the untracked root `prompt` file (never staged).

```
node --test src/secret-scan/patterns.test.ts
ℹ tests 10   ℹ suites 0   ℹ pass 10   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0

npm run typecheck   -> tsc --noEmit -p tsconfig.json  (no output, exit 0)
npm run lint        -> eslint .                        (no output, exit 0)

npm test (full)     ℹ tests 893   ℹ pass 893   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   exit=0
   (baseline recorded in the previous story row: 891; +2 = the two new tests)

node src/qa/completeness-claim-checker.ts   (QA-15) exit 0
npm run oss:secret-scan (real full-history scan)
   "[OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (1512 allowlisted)."
node src/qa/reference-resolver.ts <merge base> HEAD   (QA-14) exit 1, 26 of 1348 citations fail, 252 more unclassified (non-blocking)
   (known red on the trunk, Issue #229; counts only, strings deliberately not listed)
git diff --stat 4644b2b HEAD -- (patterns.ts, the allowlist json, history-scan.ts, pre-commit-scan.ts, ci.yml)   -> empty
git diff --numstat 4644b2b HEAD -- (patterns.test.ts, CHANGELOG.md)   -> 32/0 and 11/0  (added/removed: zero removed lines)
```

## Mutation results (scratch copy outside the working tree; tracked files never edited)

The scratch copy held `patterns.ts` and `patterns.test.ts`; each mutation was applied to the copy of `patterns.ts` by an exact string replace that throws if the target is absent, then restored. `git status` afterwards: only the untracked `prompt` file.

| Mutation | Result (10 tests total) | Reds | Plan expectation | Match? |
|---|---|---|---|---|
| M1 old `\w{20,255}` form | 9 pass / 1 fail | prose test only ("must not match prose: <first exemplar>") | prose red; truncated and existing green | yes |
| M2 secret segment `*` to `+` | 9 / 1 | truncated test only ("the whole truncated fixture is the match") | truncated red; prose and existing green | yes |
| M3 floor 20 to 1 | 9 / 1 | prose test only (first exemplar matches) | prose red; truncated green | yes |
| M4 floor 20 to 23 | 7 / 3 | prose test (fails on the contrast assertion, "the synthetic real-format token must still match"), truncated test, and the pre-existing full-format test | plan said prose test stays green | NO, a plan deviation; see below |

M4 deviation claim in the CHANGELOG entry: verified accurate. The entry says raising the floor to twenty-three turns the truncated test red "and the other two tests of this pattern too, since their identifier segments are shorter than twenty-three". Measured: the contrast token in the prose test has a 22-character identifier segment and the pre-existing test has 20, so both fall below 23. The CHANGELOG states the real behavior; only the plan M4 row (stale; a plan is a dated artifact) says otherwise. Editorial, below.

A first M1 attempt was discarded: my shell mangled the backslash and produced a regex matching nothing, which reddened all three tests. The result in the table is from the corrected mutation (verified by printing the mutated line before running).

## The lastIndex risk (specific risk from the brief): demonstrated NOT to make the tests vacuous or order-dependent

Setup facts (code-traced): every pattern in `src/secret-scan/patterns.ts` carries the `g` flag; `findPattern` in `src/secret-scan/patterns.test.ts` (lines 5-10) returns the shared object from `SECRET_PATTERNS` after `p.regex.lastIndex = 0`. Both new tests call `findPattern` before each use: the exemplar loop calls it once per iteration; the contrast assertion calls it again; the truncated test calls it once and then uses `String.prototype.match`, which with a global regex sets lastIndex to 0 itself before scanning.

Runs (raw):

```
isolation, prose test alone:        tests 1  pass 1  fail 0  skipped 0
isolation, truncated test alone:    tests 1  pass 1  fail 0  skipped 0
V0  poison test inserted before the new tests (sets lastIndex=100000 on EVERY pattern), helper reset intact:
                                    pass 11  fail 0  skipped 0
V1  same poison AND the reset line REMOVED from the shared helper (sabotage of the pre-existing helper):
                                    pass 9   fail 2  -> both fails are PRE-EXISTING tests (internal-hostname FQDN, ipv4-private);
                                    the two new tests still pass
V1 + M1                             prose test still RED (fails on the second exemplar; the first is vacuous under the poison)
V1 + M3                             prose test still RED (same)
```

Reading:

- As shipped, the new tests cannot be poisoned: the helper resets per call, and the `match` in the truncated test resets on its own. Nothing carries over from an earlier test or between the loop calls. The implementer claim "no ordering-dependent state" holds, and the plan statement that the helper "zeroes lastIndex" is accurate.
- Depth: with the helper reset deliberately removed, the pre-existing tests break but the new tests do not; a failed `.test` on a global regex resets lastIndex to 0, so a stale index can blind only the first exemplar of the loop, and the remaining three (and the contrast) still evaluate. That is why four exemplars, not one, is the right shape.
- After the contrast assertion succeeds, lastIndex is left non-zero on the shared object. Every later test in the file calls `findPattern` first (or uses `match`), so nothing reads it; the `node --test` runner also gives each file its own process.
- Vacuity: each of the four exemplars matches the OLD regex and not the current one (run individually: old true, current false for all four), so none is a dead exemplar. The positive contrast assertion means a regex that never matches turns the prose test red, so the negative loop cannot pass alone.

## Secret-shaped text in the diff (does anything depend on an allowlist entry?)

- Instrument: every pattern in `src/secret-scan/patterns.ts` run over the ADDED lines of each of the six changed files. Result: zero hits in all six (test file, CHANGELOG, plan, decisions row, run log, state json).
- Differential (regex match counts over the whole text of the test file, base vs HEAD): identical for all ten patterns, github-fine-grained-pat one and one. The one existing literal is the pre-existing whole-file allowlist grant; the new text adds none. This confirms the CHANGELOG "Measured, not typed" sentence.
- The allowlist file, patterns.ts, both scan drivers and the CI workflow are byte-identical to the base (empty diffstat above).
- Real history scan: PASS, 0 blocking (1512 allowlisted, the same class of grants as before). The installed pre-commit hook is exercised again at the commit of this report.

## CHANGELOG accuracy against the diff

Checked sentence by sentence: "test-only", "two tests appended after the existing github-fine-grained-pat test" (they sit immediately after it), "no existing test line edited" (0 removed lines), "patterns.ts and the allowlist byte-identical" (empty diffstat), both names in the title, the truncated shape and whole-fixture match, "match count is one at the base and one in the working tree" (reproduced), M1-M4 outcomes (reproduced, including the M4 side effects), and the camelCase residual (the prefix, twenty or more alphanumerics, then an underscore still matches: reproduced with a 20-character run). All accurate. The history entry for the earlier fix is untouched (append-only respected).

## Findings (ranked by user-trust impact x blast radius)

The change adds tests only; nothing here can reach a user of the scanner. No blocking finding.

1. [SUSPICION][LOW][demonstrated] Mutation survivor, optional. Making the separating underscore optional (`_` to `_?`, all else equal) leaves all ten tests green (10 pass / 0 fail). So no test pins "the identifier segment must be followed by the separator". Effect if it regressed: a bare prefix plus 20 or more alphanumerics with no separator would match; whether that shape appears in real prose is unmeasured, so severity is capped at LOW under rule 18. Minimal fix if wanted: one negative assertion in the truncated test (prefix plus 22 alphanumerics, no trailing underscore, expect no match). The plan section "Not pinned, deliberately" already accepts residuals of this kind; declining it for simplicity is reasonable. Failing test that would settle it: "github-fine-grained-pat: does NOT match a prefix and identifier run with no separator".
2. [CLEAN][demonstrated] lastIndex robustness (section above): no vacuous pass, no order dependence; holds even with the reset removed from the shared helper.
3. [CLEAN][demonstrated] M1, M2, M3 each turn exactly the intended test red; M4 behaves as the CHANGELOG (not the plan) says.
4. [CLEAN][demonstrated] Nothing in the diff matches any pattern; no allowlist dependence; allowlist and scan code untouched; real history scan 0 blocking.
5. [CLEAN][demonstrated] SE ADR-0005 honored: zero removed lines in the test file, every new test owns its state, no ordering dependence.
6. [CLEAN][demonstrated] All four exemplars individually discriminate old from current regex (no dead exemplar).

## Missing checks by name

- `github-fine-grained-pat: does NOT match a prefix and identifier run with no separator` (finding 1, optional).
- None required for R135-1..3.

## Editorial (verdict-neutral, plain edits, no re-review)

- CHANGELOG: "The four snake_case exemplars Issue #135 named": the Issue body names two; all four are in its red-team comment. Reword to "named in Issue #135 and its comment", or leave.
- The plan mutation row M4 says the prose test stays green; measured red via the contrast assertion (the CHANGELOG already states the real behavior). Correct the plan or leave as history.
- The state json note for this scope still says "awaiting Manager ratification" although the run log records the ratification (the same stale-note class the previous story fixed at close-out).
- Test title uses a plain double hyphen where sibling titles use an em dash; cosmetic.

## Verdict: SHIP

Open findings = 1 (LOW suspicion, optional); failing tests = 0. The two numbers differ by that one item: it has no test because it is a declined-by-default nice-to-have, not a defect; its would-be test is named above.

## Praised decision

Building the positive fixtures from named constants at runtime keeps the new tests out of the whole-file allowlist grant and out of the value-hash migration set the next story will measure, and pairing four negative exemplars with a positive contrast in one test is what makes the loop immune to a stale global-regex index.

## Single next action

Manager: relay SHIP with the cross-domain report; decide finding 1 (recommend decline for simplicity) and the Editorial edits at close-out; the human pushes and opens the PR.

RECEIPT: verdict=SHIP
findings:
1. [SUSPICION][LOW][demonstrated] src/secret-scan/patterns.test.ts (new tests): mutation `_` to `_?` in the pat regex leaves 10/10 green, separator requirement unpinned; optional one-assertion fix, decline for simplicity is reasonable
2. [CLEAN][demonstrated] lastIndex: no vacuous or order-dependent pass (poison run 11/0/0; even with helper reset removed the new tests pass clean and still catch M1/M3)
3. [CLEAN][demonstrated] M1/M2/M3 each red exactly the intended test; M4 red on three tests, CHANGELOG states it accurately (plan row stale)
4. [CLEAN][demonstrated] no pattern matches any added line; differential match counts identical; allowlist/patterns.ts/scan drivers/ci untouched; history scan 0 blocking
5. [CLEAN][demonstrated] SE ADR-0005: zero removed lines, no shared state between new tests
6. [CLEAN][demonstrated] all four exemplars individually discriminate old vs current regex
counts: issues=0 suspicions=1 clean=5
evidence: demonstrated=6 code-traced=0 derived=0
checks="893/0/0"
adr=HIT(36)
report=docs/reviews/s1-135-pat-regression-test-code-2026-09-19.md
