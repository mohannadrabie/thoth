# Build report — s1-229-qa14-red (GitHub Issue 229)

- **Phase:** 2 (build), story-implementer (Ptah). Plan: `docs/plans/s1-229-qa14-red-phase1-2026-09-21.md` (approved; tier CRITICAL ratified by the Manager).
- **Branch:** fix/s1-229-qa14-red. Base: master at 22b7141. Plan commit: bd0541e.
- **State at this report:** all planned commits landed; review chain (red-team, code-reviewer, cross-domain-reviewer) not yet run. No push, no PR, no merge.
- **ADR cache line:** `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp b588a48) [CACHE=HIT]`

## 1. Commits

| # | Commit | Content | Tests at that commit |
|---|---|---|---|
| 1 | 67b7bee test(qa): file name on each QA-14 failure line (red) | AC4a, AC4b written | 7 tests: 5 red, 2 guards pass |
| 2 | 90c4a2b feat(qa): name the file on each QA-14 failure line | P5 | 7 green |
| 3 | 41e03a9 test(qa): scoping cases against a whole-file stub (red) | stub module plus 31 scoping tests | 38 tests: 13 red, 25 pass |
| 4 | d888307 feat(qa): added-text scan for append-only records and adrCatalog exclusion | P1, P2, `main()` call | 38 green |
| 5 | 425ff0e docs: reword the standing example references in STATE.md and backlog.md | P4 | n/a |
| 6 | c9dce36 test(qa): make the moved-and-edited case sensitive to the identity check | mutation-driven fixture fix (section 5) | 38 green |
| 7 | docs: CHANGELOG entry, plan status line, this report | CHANGELOG, plan status, one-token path fix in the Manager's ruling row (section 9), report | n/a |
| 8 | docs: final gate runs added to this report | section 12 | n/a |

- Commits 6 and 8 are additions to the plan's six; commit 7 is the plan's sixth, plus the report.
- Every commit passed the pre-commit OSS-01 scan without `--no-verify`. One intermediate attempt of commit 3 was blocked (a fixture git identity written as an email address matched the email pattern); the fixture now uses a non-email identity, and no allowlist entry was added.

## 2. Red evidence (commits 1 and 3)

**Commit 1**, `node --test src/qa/reference-scope.test.ts` before P5: tests 7, pass 2, fail 5, exit 1. Failures: the file suffix absent from the failure line; `file` absent from citations returned by `resolveIssueCitations`. The two passing tests pin behavior that must not change (a citation with no file prints as before; `scanReferences` output has no file).

**Commit 3**, same command against the whole-file stub: tests 38, pass 25, fail 13, exit 1. Re-run on the committed state: same counts.

- **13 red, each on an assertion about the missing behavior:** the routine-append exit-0 test; same token on a new line (the clean append must exit 0); addendum (old example must not be reported); mirror unit test; mirror end to end; C-quoted path; archive-sweep move; multiset; laundering control (a move out of STATE.md); CRLF; header-spoof parsing; real-git parsing (attribution of added and removed text); scope constants.
- **25 pass against the stub:** 7 AC4 tests (P5 already landed) and 18 guard tests that pin fail-closed directions already true of whole-file scanning (a bad added citation exits 1; a path the parser cannot attribute is scanned whole; the laundering cases exit 1). A guard cannot be red first; each is validated by the mutations in section 5.

## 3. Acceptance criteria mapped

| AC | Result | Evidence (test name or command) |
|---|---|---|
| AC1 | pass | `R1 a diff that only appends prose to CHANGELOG, STATE, decisions and REVIEW_LOG exits 0 while the append-only records already hold example references of every failing kind` (diff-mode exit 0; full-tree control on the same head exits 1 and names all three kinds) |
| AC2a | pass | `R2 a new nonexistent path on an appended decisions row exits 1` |
| AC2b | pass | `R2 a new malformed ADR id on an appended CHANGELOG line exits 1` |
| AC2c | pass | `R2 a new cross-repo issue reference on an appended REVIEW_LOG row exits 1` |
| AC2d | pass | `R2 a new nonexistent issue number on an appended decisions row fails, and an existing one passes (fake runner)` |
| AC2e | pass | `same token, new line, same file: ...` (clean append exits 0, then the same token on a new line exits 1) |
| AC2f | pass | `R2 a new docs/reviews file with a bad citation exits 1 (every line is added)` |
| AC2g | pass | `R2 an addendum appended to an existing report is checked; the report's old example references are not` |
| AC2h | pass | `whole-file kept: an edit to STATE.md that adds a bad citation exits 1, and a bad token on an untouched STATE.md line also exits 1` |
| AC2i | pass | `.maat-state.json: a bad citation in an authored field exits 1; ...` (unit) and `.maat-state.json end to end: the mirror is excluded in diff mode and in full-tree mode; an authored field is not` |
| AC3a | pass | `a scoped file the diff parser cannot attribute (C-quoted path) is scanned whole`; `a pure rename into an append-only path ... is scanned whole, and exits 1 on an old example` (real git) |
| AC3b | pass | `diffText failing falls back to whole-file scanning, never to a vacuous pass` |
| AC3c | pass | `full-tree fallback (zero SHA) scans append-only records whole` |
| AC3d | pass | `a line moved verbatim by the real archive-sweep script from decisions.md to decisions-archive.md exits 0` (runs `docs/decisions-archive.mjs --apply`) |
| AC3e | pass | `a moved line with one edit that adds a bad citation exits 1` |
| AC3f | pass | `CRLF files: added and removed lines compare equal after CR stripping` |
| AC4a | pass | three tests, section AC4a of `src/qa/reference-scope.test.ts` |
| AC4b | pass | four tests, section AC4b of the same file |
| AC5 | pass | `git diff --diff-filter=MDR --name-only master...HEAD -- docs/reviews` printed nothing, exit 0 |
| AC6 | pass except QA-14 rows | section 6 (QA-14 diff-mode and full-tree rows are in section 12, after the docs commits) |
| AC7 | measured | section 7 |
| AC8 | pass | AC1 and AC3d above are the regression tests |
| AC9 | see section 12 | `node src/qa/reference-resolver.ts master HEAD` on the final head |
| AC10 | pass | `APPEND_ONLY_FILES`, `APPEND_ONLY_DIR_PREFIXES`, `GENERATED_MIRROR_FILE` are named exports with a doc comment each; the module header states the reason for both narrowings and what fails closed; the Manager's ruling row names what QA-14 no longer checks |
| AC11 | pass | see section 8 |

Additional tests, beyond the plan's list:

- `moved-line rule is a multiset: each removed line licenses at most one added identical line` (Manager addition 1; the three scenarios in one test, plus the count of unlicensed copies left in the scanned text).
- Five laundering tests and one control (Manager addition 2; section 4).
- `parseUnifiedDiff` on a header-shaped content line, and on real git output (new, deleted, renamed with an edit, binary, mode-only, no trailing newline).
- `added text from separate runs is never joined into a false adjacency`.
- `a deleted file (nothing on disk) and a test file are not scanned`; `an empty diff for a changed append-only file is scanned whole`; `scope constants ...`.

## 4. The laundering rule (Manager addition 2)

- **Rule (stated in the module header):** a removed line licenses an added identical line only if it came from a file the same run scans. "Scans" means a changed file that passes `shouldScanFile` and exists on disk at head, and never `docs/.maat-state.json` (its `adrCatalog` lines are not scanned).
- **What no longer licenses a move:** a removal from a `*.test.ts` file, from the mirror, from a file the diff deletes, from the old path of a renamed file, or from a path the parser cannot attribute.
- **Accepted consequence (stricter):** a line moved out of a deleted or renamed-away file is checked as new text.
- **Tests:** one per source above; each keeps the added copy checked (exit 1 through the entry point, except the unattributable-path case, which is a unit test on the scanned text); the control (a line moved out of STATE.md, a scanned living file, into CHANGELOG.md) exits 0.
- **Not closed, disclosed:** text that is licensed by a removal from a file that IS scanned but was, at base, never checked (an append-only record edited before this mechanism existed, or a file that QA-14 only checked as added text at an earlier date). Such a line already existed in the repository; the rule treats it as a move.

## 5. Mutation checks (throwaway clone, each mutation run against the committed test file)

The plan's M1 to M4 plus the Manager's M5, and further mutations for the fail-closed paths and the laundering rule. "Named" is the test the mutation must turn red.

| Id | Mutation | Named test red? | All red tests (count) |
|---|---|---|---|
| M1a | every added line in an append-only record passes (identity check absent) | yes: `a moved line with one edit ...` and the multiset test | 16 |
| M1b | identity dropped, any removal licenses any added line, counts kept | yes: `a moved line with one edit ...` (after commit 6), multiset, archive-sweep | 3 |
| M2 | a file absent from the parsed diff is treated as empty | yes: C-quoted path | 3 (C-quoted, pure rename, empty diff) |
| M3 | the `adrCatalog` filter is dropped | yes: both `.maat-state.json` tests | 2 |
| M4 | the append-only set is narrowed to nothing | yes: AC1 (R1) | 9 |
| M5 | multiset count replaced by set membership (a licence is never spent) | yes: the multiset test, and only that | 1 |
| M6 | no separator between added runs | yes: `added text from separate runs ...`, only that | 1 |
| M7 | removal-source restriction dropped (any file's removal licenses) | yes: four laundering tests (test file, mirror, deleted file, rename old path) | 4 |
| M8 | mirror exclusion dropped from the removal source | yes: the mirror laundering test, only that | 1 |
| M9 | `docs/STATE.md` added to the append-only set | yes: `whole-file kept ...` and the constants test | 2 |
| M11 | the full-tree flag is ignored | yes: `full-tree fallback ...`, only that | 1 |
| M12 | carriage returns not stripped before comparing | yes: the CRLF test, only that | 1 |
| M10 | an unreadable diff falls back to an empty parse | no test red | 0 (equivalent mutant: an empty parse leaves the file absent from the diff, so it is scanned whole, the same behavior as the shipped fallback) |
| M13 | the per-file header reset on a `diff --git` line is dropped | no test red | 0 (equivalent for git-produced diffs: every section that carries hunks also carries `---` and `+++` headers that reassign both paths) |

- M1 turns more than one test red because "every line passes" also defeats the plain "bad line added" tests; the plan's named tests (AC2e or AC3e) are among them.
- M1b initially survived the moved-and-edited test: the archive file that the test created also received header lines, which spent the single licence first. Commit 6 gave the test an existing archive so the edited row is the only added line; the assertions are unchanged and the test now turns red under M1b.
- The mutation runner is a throwaway script and is not in the repository.

## 6. AC6 commands (real outputs; skipped is not passed)

| Command | Exit | Result line(s) |
|---|---|---|
| `node --test src/qa/reference-resolver.test.ts` | 0 | tests 85, pass 85, fail 0, cancelled 0, skipped 0, todo 0 |
| `node --test src/qa/reference-scope.test.ts` | 0 | tests 38, pass 38, fail 0, cancelled 0, skipped 0, todo 0 |
| `npm test` | 0 | tests 1018, pass 1018, fail 0, cancelled 0, skipped 0, todo 0 (baseline before this story: 980) |
| `npm run typecheck` | 0 | no output |
| `npm run lint` | 0 | no output |
| `node src/qa/completeness-claim-checker.ts` (QA-15) | 0 | `PASS: 2 file(s) checked, all completeness claims verified.` |
| `node src/qa/broken-instrument-gate.ts` (QA-16) | 0 | `VACUOUS-PASS: 0 known-broken instruments registered` (pre-existing: nothing is registered) |
| QA-14 diff-mode `master HEAD`; QA-14 full-tree | see section 12 | |

`src/qa/reference-resolver.test.ts` is unmodified by this story (empty diff against master), so no existing test was edited. Test count for the resolver file is 85 because the file contained 85 tests at the base.

## 7. AC7: per-file failure maps, from the shipped file-naming output

Command: `node src/qa/reference-resolver.ts 22b7141~1 22b7141`, failure lines only (`unresolved-authority`, `unparseable`, `cross-repo-issue`), aggregated with `sed -n 's/.*\[file: \(.*\)\]$/\1/p' | sort | uniq -c`. The lines with the `unclassified` verdict also carry a file and are excluded, because they do not fail the run. Counts only are recorded here; the failure lines quote example references and are deliberately not reproduced.

| Leg | Resolver code | Working tree | Header line | Failures by file |
|---|---|---|---|---|
| 1 | commit 90c4a2b (file naming only, whole-file scan) | detached worktree at 22b7141, `adr/` copied in | `26 of 1412 citation(s) failed to resolve; 267 more unclassified`, exit 1 | CHANGELOG.md 5; docs/.maat-state.json 2; docs/REVIEW_LOG.md 7; docs/STATE.md 5; docs/decisions.md 6; src/secret-scan/patterns.ts 1 |
| 2 | branch code at d888307 (mechanism alone) | same worktree at 22b7141 | `6 of 518 citation(s) failed to resolve; 117 more unclassified`, exit 1 | docs/STATE.md 5; src/secret-scan/patterns.ts 1 |
| 3 | branch head after commit 6 | the branch working tree (STATE.md and backlog.md reworded) | `1 of 513 citation(s) failed to resolve; 117 more unclassified`, exit 1 | src/secret-scan/patterns.ts 1 |

- Legs 1 and 2 match the Phase 1 spike exactly (26 to 6, same files and counts).
- The one remaining failure is a comment in `src/secret-scan/patterns.ts` naming a real but gitignored config file; it is a sensitive-area file left unedited by ruling D4. It appears only in a run whose changed-file list includes that file.

## 8. Scope evidence (AC5, AC11)

- `git diff --stat master...HEAD` at commit 6: `docs/.maat-state.json`, `docs/STATE.md`, `docs/backlog.md`, `docs/decisions.md`, the plan, `docs/run-log.jsonl`, `src/qa/reference-resolver.ts` (35 lines changed), `src/qa/reference-scope.ts` (357 lines, new), `src/qa/reference-scope.test.ts` (828 lines, new).
- Untouched (empty diff): `.github/workflows/ci.yml`, `src/lib/git.ts`, `REQUIREMENTS.md`, `CLAUDE.md`, `hooks/`, `src/secret-scan/` (so `patterns.ts` too), `src/qa/reference-resolver.test.ts`, and every path under `docs/reviews/`.
- Resolver diff: the header pointer comment, one import, the optional `file` field on `Citation`, the file suffix in `summarizeCitations`, the pass-2 loop tagging each citation, and the file-reading loop in `main()` replaced by one `buildScanTexts` call. No `classify*` function and not `scanReferences` was edited.
- `docs/decisions.md` carries a one-token change (section 9).

## 9. Deviations from the plan and open points

- **Module size.** The plan estimated about 80 lines; the shipped `src/qa/reference-scope.ts` is 357 lines, of which about 40 are header comment. The growth comes from the diff parser (hunk-count based, so a content line shaped like a file header cannot start a new file, about 75 lines) and from cutting the `adrCatalog` object out of the original JSON text with a small tokenizer (about 65 lines) instead of a parse and reserialize (about 15 lines). The reserialize version loses text under a duplicate key, so authored text could hide there; the tokenizer version keeps it. If the Manager prefers the simpler version, the duplicate-key hole is the cost; one test (`stripAdrCatalog` duplicate key case) pins the difference.
- **AC1 fixture wording.** The plan says the first three files "already hold example references of every failing kind", and STATE.md is among them. STATE.md is read whole, so a standing example in it would fail the run. The fixture puts the examples in the append-only records (CHANGELOG, decisions, REVIEW_LOG) and keeps STATE.md clean, and appends prose to all four.
- **Narrower mirror rule than the plan text.** The plan says every `adrCatalog` key. The shipped rule cuts it only at the root and along the `priorScope` chain, and only when its value is an object. A key of that name elsewhere, or a string under it, is authored text and is scanned. This answers the plan's third red-team question directly and is tested.
- **AC7 aggregation.** The plan's command aggregates every line carrying a file; unclassified lines carry one too, so the map filters to failure lines first.
- **Projection replaced by measurement:** section 11.
- **One token changed in the Manager's ruling row.** `docs/decisions.md`, the new row: two bare file names in backticks were rewritten with their `docs/` prefix. The bare name for STATE.md did not resolve and was the only failing citation in this branch's own diff-mode run before the edit (AC9 requires zero). No ruling text changed. Revert if unwanted; the fix then needs to happen another way.
- **Extra commit 6** (test fixture strengthening) and commit 8 (this report's final section).
- **Not verified by an instrument:** behavior under a non-default `diff.noprefix` or `color.diff=always` git configuration. A manual run of each in a scratch repository exited 1 on an added bad citation (no crash, no vacuous pass); which lines it then scanned was not distinguished. The design intent is whole-file scanning (stricter).

## 10. Proposed follow-ups (Manager files the Issues; none are in this diff)

| Id | Item | Why |
|---|---|---|
| F1 | A changed file whose name holds a non-ASCII character is never scanned in diff mode: `git diff --name-only` prints it C-quoted, the existence check fails, and it is skipped as "deleted". Reproduced in a scratch repository: the file's added bad citation produced no failure. | Pre-existing fail-open in QA-14, independent of this story; reachable in `docs/reviews/` too. The fix belongs in `src/lib/git.ts` (`-z` output or `core.quotePath` off), which this story may not edit. |
| F2 | Make `diffText` robust to user git configuration (explicit `--no-color`, `--src-prefix=a/`, `--dst-prefix=b/`, `--no-ext-diff`). | Today a non-default prefix or a colored diff makes every append-only file fall back to a whole-file scan (stricter, never a pass). Not a hole; a source of surprising red. `src/lib/git.ts` again. |
| F3 | The QA-14 requirement amendment (plan section 6) and the 28 stale predecessor-era citations in `REQUIREMENTS.md`. | Already ruled (D2). |
| F4 | One chore Issue listing the standing failures in files left alone under D4, from the instrument's per-file output (section 12). | Already ruled (D4). |
| F5 | Reviewer guidance: cite example references in word form in a new report. | A new report that quotes example references still fails (accepted residual, ruling row item j). |
| F6 | QA-16 registers zero known-broken instruments and passes vacuously. | Pre-existing; unrelated to this story. |

## 11. Section 2 projection, replaced by measurement (15 PR merges)

Method (as in the plan): the 15 most recent PR merges on master's first-parent history, each diffed against its first parent; files read at the merge commit; path and issue lookups at the current branch head (gh, memoised). "Whole-file" is the scanning `main()` did before this story; "shipped" is `buildScanTexts`. The harness is a throwaway script, not in the repository.

| PR | Whole-file failures | Shipped failures | Shipped, with STATE.md and backlog.md failures set aside | What remains (docs/reviews reports are files the PR added) |
|---|---|---|---|---|
| 251 | 26 | 6 | 1 | patterns.ts 1 |
| 245 | 30 | 10 | 1 | reports 1 |
| 232 | 5 | 5 | 0 | none |
| 230 | 44 | 21 | 12 | reports 12 |
| 228 | 5 | 5 | 0 | none |
| 225 | 38 | 19 | 10 | reports 4; CLAUDE.md 3; hooks 3 |
| 218 | 25 | 6 | 1 | reports 1 |
| 214 | 24 | 11 | 6 | reports 5; CHANGELOG.md 1 |
| 209 | 5 | 5 | 0 | none |
| 208 | 26 | 13 | 4 | reports 1; hooks 3 |
| 204 | 38 | 18 | 9 | reports 9 |
| 184 | 38 | 19 | 10 | reports 10 |
| 169 | 29 | 13 | 8 | reports 5; REVIEW_LOG.md 3 |
| 165 | 30 | 19 | 18 | reports 12; CHANGELOG.md 1; REVIEW_LOG.md 2; decisions.md 2; one plan 1 |
| 148 | 24 | 14 | 9 | reports 7; REVIEW_LOG.md 2 |

- **Green merges:** whole-file, none of the fifteen; shipped mechanism alone, none of the fifteen (STATE.md holds five standing failures in the thirteen merges from PR 251 back to PR 169, and one in each of the last two); shipped mechanism with STATE.md and backlog.md failures set aside, three of the fifteen (PRs 232, 228, 209). The plan projected four of the fifteen; the measured figure is three. The difference is PR 251, whose remaining failure is the one in `src/secret-scan/patterns.ts` (ruling D4).
- **Setting STATE.md and backlog.md aside is what commit 5 does for the current tree.** Historical merges cannot show it, because their files are read at the merge commit.
- **Reading.** In every merge the shipped figure is below the whole-file figure. What remains is text the PR itself added: new review reports quoting standing example names (eleven of the twelve merges that still fail), plus additions to REVIEW_LOG.md, CHANGELOG.md, decisions.md, a plan, hooks and CLAUDE.md. That is the accepted residual: the gate flags new text that quotes an example.

## 12. Final gate runs and full-tree residual (measured at the final head)

Recorded in commit 8, after the last docs commit, so that each run sees the final tree.
