# s1-135-pat-regression-test: Phase 1 plan (2026-09-19)

**Status: PLAN-READY, nothing built.** Story S-B1 of Story B (decomposition: the newest `docs/decisions.md` row). Issue #135 (Milestone "S1 — Protect the baseline", labels bug, severity:med, oss). Branch `fix/s1-135-pat-regression-test`, stacked on `fix/s1-226-duplicate-field` @ 4644b2b, deliberately not cut from origin/master.

**Story.** The `github-fine-grained-pat` regex already rejects snake_case PAT prose (fix shipped in cifix). The regression tests that fix's CHANGELOG entry claims do not exist. Add them, and a test for the truncated prefix-only shape that has none. TEST-ONLY.

## Readiness and ADRs

- Readiness: no missing facts. Issue #135's body and its one comment (red-team corroboration, named test) read in full.
- ADR cache: HIT, 36 ADRs, fingerprint 5dba384. Applicable: SE ADR-0005 (rule quoted: "MUST NOT delete or weaken a failing test to make CI pass"; also no ordering-dependent tests: each new test builds its own state), SE ADR-0010 (rule quoted: "MUST run the full local equivalent of CI gates before declaring work complete"; "do not scope-creep the PR"). Not applicable: all devops ADRs (no IaC), SE ADR-0002/0003/0004/0006-0009/0011-0021, THOTH-ADR-0001 (no classification file touched). None UNCLEAR.

## Facts checked at 6c9c457 (instruments run, raw output in the Phase 2 evidence)

| Fact | Evidence |
|---|---|
| Regex is already `/github_pat_[A-Za-z0-9]{20,}_[A-Za-z0-9]*/g`; `src/secret-scan/patterns.ts` is not touched | read of `src/secret-scan/patterns.ts` line 38 |
| The file has 8 tests, all pass, 0 skipped; only a full-format true-positive test (with a classic-PAT negative control) covers this pattern | `node --test src/secret-scan/patterns.test.ts` |
| **The existing true-positive fixture is a plain literal, not runtime concatenation.** It is covered by a whole-file allowlist entry (`docs/qa/secret-scan-allowlist.json`, path `src/secret-scan/patterns.test.ts` + patternId `github-fine-grained-pat`). Consequence: a scan of that file cannot show a new fixture matching or not matching, because any match there is already ALLOWLISTED | JSON parse of the allowlist |
| Tree measure with a throwaway script: the current regex matches 3 places in 357 tracked files, each already allowlisted (this test file, and two `docs/reviews/` reports); the old `\w{20,255}` form matches 28. Zero unexplained current-regex matches, so no camelCase false positive is demonstrated in the tracked tree. History not measured here | scratch script over `git ls-files` |
| Test files are excluded from QA-14 scanning (per the s1-226 plan) | `shouldScanFile` in `src/qa/reference-resolver.ts` |

## Acceptance criteria as named tests (`src/secret-scan/patterns.test.ts`, new, appended after the existing pattern test)

| Name | Asserts | Covers |
|---|---|---|
| **T135-1** "github-fine-grained-pat: does NOT match ordinary PAT-discussion prose (regression -- Issue #135) [github-fine-grained-pat-word-boundary-test]" | The four exemplars (`load_github_pat_for_submodule_checkout`, `read_github_pat_from_environment_variable`, `const github_pat_env_var_name_constant = 1`, `my.github_pat_helper_function_name_here()`) do not match; contrast in the same test: a synthetic full-format token still matches | R135-1, R135-3 (both names) |
| **T135-2** "github-fine-grained-pat: matches a truncated prefix-only disclosure (22-char identifier segment, empty secret segment; Issue #89 exemplar shape)" | `github_pat_` + 22 alphanumerics + `_` matches, and the match text is the whole fixture | R135-2 |

- **Fold decision (R135-3).** One test carries both names: infra-security's name is the leading part of the title, red-team's name is the bracketed suffix. Red-team's spec ("lead exemplar does not match, real format still does") is a subset of T135-1's assertions, and a second test with the same failure mode adds no mutation coverage. Both strings stay greppable.
- **Fixtures.** Exemplars are prose and do not match, so they need no allowlist entry. Positive fixtures (truncated and the contrast full-format) are built at runtime from a prefix constant, a 22-char identifier constant and (full only) a secret-segment constant, so the file's new text never contains the `github_pat_` prefix followed by 20 alphanumerics. This keeps the new fixtures out of Issue #136's value-hash migration set instead of leaning on entry-level file grants. Fixtures are visibly synthetic (`ABCDEFG...` runs). Reset state per assertion via `findPattern` (it zeroes `lastIndex`), no shared state.
- **Existing tests are not edited** (SE ADR-0005). No `docs/qa/secret-scan-allowlist.json` change. If one proves unavoidable: STOP and report, re-tier to CRITICAL.
- **Red-first is not available here.** The fix shipped, so both new tests pass on first run. The red evidence is the mutation table, run in a scratch copy (copies of `patterns.ts` and the new test file in a temp dir; the tracked `patterns.ts` is never edited).

## Mutation proofs (scratch copy, shown red)

| Mutation | Must go red | Must stay green |
|---|---|---|
| M1 old regex `/github_pat_\w{20,255}/g` | T135-1 | T135-2, existing full-format test |
| M2 secret segment `*` -> `+` (empty segment no longer allowed) | T135-2 | T135-1, existing test |
| M3 floor `{20,}` -> `{1,}` | T135-1 | T135-2 |
| M4 floor `{20,}` -> `{23,}` (above the 22-char segment) | T135-2 | T135-1 |

Not pinned, deliberately: a floor shift between 2 and 19, or between 21 and 22. No measured number justifies a tighter pin; residual camelCase shapes (`github_pat_` + 20+ alphanumerics + `_`) stay UNMEASURED beyond the tree scan above and are not designed for. A demonstrated one becomes a GitHub Issue (duplicate-check first; bug + severity + oss; milestone S1), never this diff.

## Other verification (Phase 2)

- Baseline first: `npm test`, `npm run typecheck`, `npm run lint`; recorded counts. Expected after: baseline + 2 tests, 0 failed, 0 skipped.
- Differential instrument: regex match count over the test file's text at base vs working tree is equal (the one existing literal; new text adds 0).
- Real scan: `npm run oss:pre-commit-scan` on the staged tree, plus the installed hook at commit, both expect 0 blocking. Caveat above: for the test file this shows no NEW blocking match only, the differential is the proof of no new match. The plan and CHANGELOG files (not allowlisted for this pattern) quote the exemplars, so the hook does prove the fixed regex ignores them there.
- `git diff --stat 6c9c457 HEAD -- src/secret-scan/patterns.ts docs/qa/secret-scan-allowlist.json src/secret-scan/history-scan.ts src/secret-scan/pre-commit-scan.ts .github/workflows/ci.yml` is empty.
- QA-15: `node src/qa/completeness-claim-checker.ts` passes. CHANGELOG entry is written without bare-count claim shapes.
- CHANGELOG: history is append-only, so the cifix entry (item 10 of its list) is not edited. One new [Unreleased] entry says plainly that the regression test claimed there was missing and is added now. Only word-form "Issue #135" and existing paths.

## QA-14 flag (red on master, Issue #229; counts WHOLE changed files)

- Test file: excluded, adds nothing. Source: none touched.
- Non-test files this diff must touch: `CHANGELOG.md` (about 13 pre-existing path-style failures on a stub scan, per the s1-226 plan) and `docs/.maat-state.json` (about 2) move those into the changed-file count. Whole-file effect, not new prose. This plan is written with word-form citations and existing paths only.
- Phase 2 check: run `node src/qa/reference-resolver.ts 6c9c457 HEAD`, expect exit 1 (Issue #229), confirm no failing citation comes from a line this diff adds. Baseline for the branch vs origin/master (includes s1-226): 26 of 1330 fail, 252 unclassified non-blocking. QA-14 is out of the pass/fail bar for this story.

## Tier, reviewers, test-first

- **Tier: STANDARD.** Test-only, no source, allowlist, CI or guard file; reversible by deleting two tests. Agree with the Manager's reading (s1-227 precedent: a test file under `src/secret-scan/` counts as inside the secret-scanning area): named `code-reviewer` plus `cross-domain-reviewer`, no `red-team`. **Re-tier to CRITICAL** if the diff must touch `src/secret-scan/patterns.ts`, the allowlist, `history-scan.ts`, `pre-commit-scan.ts` or `ci.yml`.
- **Test-first dispatch check: no new or changed UI flow or API surface; the story IS the tests. `test-writer` is not dispatched.**

## Will NOT do

- Change the regex, the allowlist, the loader or any hook; edit the old CHANGELOG entry; touch the `docs/decisions.md` sweep or `docs/STATE.md`; stage the untracked root `prompt` file.
- Pin or design for camelCase residuals; add extra negative controls beyond the four exemplars.

## Blocking questions

None. One factual correction to the brief, for the record: the existing true-positive fixture is a literal covered by a whole-file allowlist grant, not runtime concatenation. It does not change scope; it only means new fixtures are built by concatenation by choice (Issue #136 hygiene), and that the differential, not the file scan, is the no-new-match proof.
