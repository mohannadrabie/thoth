# S1 Story A: QA probe hardening — Phase 1 plan (2026-09-19)

**Status: PLAN-READY, awaiting human approval.** Nothing built. Scope `s1-qa-probe-hardening`. Tier: STANDARD (proposed by `story-implementer`, ratified by the Manager, logged in `docs/run-log.jsonl`). Branch: `fix/s1-qa-probe-hardening`, cut from `master` @ `8513b58`.

Issues: #175, #179, #182 (Milestone "S1 — Protect the baseline"). Related, filed separately: #226 (duplicated `--field=` resolves first-wins, LOW). Not part of this story: #227 (CI flake in `pre-commit-scan.test.ts` R4).

## Human decisions already made (2026-09-19)

| # | Decision |
|---|---|
| a | #182: **warn on stderr** when untracked-but-scannable files are inside the counted number. The number and stdout are unchanged. No new flag, no separate number. Consistent with the 2026-09-13 "disclose only" ruling in `docs/decisions.md`. |
| b | The same warning applies to `continuation-residual-probe.ts` once #175 makes it count untracked files, so the twins cannot drift. |
| c | Values simplicity over polish: drop a nice-to-have rather than add complexity. |

## The three issues, verified against master @ 8513b58

| Issue | Real? | Evidence |
|---|---|---|
| #175 | Yes | `src/qa/continuation-residual-probe.ts:214-219` builds the file LIST with `resolveChangedFiles(git, zero-sha, "HEAD")` (an `ls-tree HEAD` read, `src/lib/git.ts:68-73`) while CONTENT comes from the working tree. Untracked files are invisible. The twin was fixed at `src/qa/marker-corpus-probe.ts:210-218` with `git.lsFilesWorkingTree()`. |
| #179 | Yes | `main()` (`continuation-residual-probe.ts:221-226`) only calls `parseContinuationResidualField`, which ignores everything but `--field=`. Live: `node src/qa/continuation-residual-probe.ts not-a-ref --field=continuation-marked` prints a count and exits 0. Test `continuation-residual-probe.test.ts:216-224` asserts exit 0 with a stray arg. |
| #182 | Yes | `marker-corpus-probe.ts:212` takes its list from `lsFilesWorkingTree()` (`git.ts:163-167`, includes `--others --exclude-standard`); `shouldScanFile` (`src/qa/reference-resolver.ts:534-536`) rejects only `*.test.ts`. A stray scratch file changes the published total silently. |

## Acceptance criteria and named checks

| AC | Criterion | Check |
|---|---|---|
| 1 | Any argv token that is not `--field=...` exits non-zero, stderr names the token(s), no count on stdout. Cases: `not-a-ref-at-all`, `HEAD~5`, a SHA beside a valid `--field=`, `--bogus-flag`. | T179-1, T179-3 |
| 2 | Rejection happens before any file collection. | T179-3 ordering half; mutation M2 |
| 3 | Valid invocations unchanged (no args, `--field=continuation-marked`, `--field=continuation-residual`); the two `KNOWN_INSTRUMENTS` entries (`completeness-claim-checker.ts:68-69`) keep working. | T179-2, T179-4; existing `completeness-claim-checker.test.ts:147-156` untouched |
| 4 | KNOWN-GAP test replaced; "KNOWN GAP" comments removed. | grep returns 0 |
| 5 | Continuation probe list comes from `lsFilesWorkingTree()`. | T175-1; mutation M4 |
| 6 | An untracked, uncommitted scannable file with `Closes #A, #B, #C` raises `continuation-marked` by the exact expected count, in-process, in an isolated `mkdtemp` repo. | T175-1 |
| 7 | Submodule gitlinks and nested untracked repos stay excluded. | existing `git.test.ts:99-135`; T175-2 |
| 8 | Comments claiming the twin still has the mismatch, or that #182 is a disclosed residual, are corrected. | grep instrument returns 0 |
| 9 | When untracked scannable files are in the scan, stderr names the count and the paths (cap 10, then "and N more"). | TW-1..4, TW-6, TW-7; TWR-1, TWR-3 |
| 10 | Counted number and stdout unchanged; stdout still ENDS in the single field integer; exit code unchanged. | TWR-1, TWR-3; existing #172 test; `completeness-claim-checker.test.ts:158-165` |
| 11 | No warning when no untracked scannable file exists. | TW-5, TWR-2 |
| 12 | One shared warning implementation (twins cannot drift). | grep instrument: definition, its test, one call site per probe |
| 13 | No `git.ts` edit, no allowlist edit, no reserved-domain email literal added. | `git diff --stat` on `src/lib/git.ts` and `docs/qa/secret-scan-allowlist.json` is empty; history scan exits 0 |

**Named tests.**
- T179-1: `assertKnownArgs` (new, exported, mirrors `marker-corpus-probe.ts:108-116`) throws for each case; message quotes the token.
- T179-2: silent for `[]` and the two valid `--field=` values.
- T179-3: subprocess with `cwd` = a non-git `mkdtemp` dir; each bad argv exits non-zero, stderr has the token and `unrecognized argument`, and does NOT have `not a git repository` (proves the gate runs before collection).
- T179-4: subprocess in a fixture repo; valid invocations exit 0, stdout ends in an integer.
- T175-1: committed `tracked.md` with `Closes #1, #2.` gives a baseline of 1; add an untracked file with three citations; the count rises by exactly 2 (goes red on the count, not a throw).
- T175-2: same fixture plus an untracked nested git repo; no crash, no nested-repo file in the texts.
- TW-1..8: fake-`Runner` unit tests for the shared helper (exact git args, `/`-suffix drop, `*.test.ts` drop, non-zero git exit throws, `null` when empty, header count, 10-path cap with "and N more", one write through the injected sink).
- TWR-1..3: subprocess wiring tests (marker with untracked file; marker clean; continuation with untracked file); assert stdout has no warning text, stderr does, exit 0, last stdout integer = tracked + untracked.

**Fixture rule (OSS-01 trap).** Real-git fixtures commit with `git -c user.name=fixture -c user.email=fixture -c commit.gpgsign=false commit`. There is no `@`-shaped string in any new file, so no allowlist entry is needed. Never write the reserved-domain committer literal in committed prose.

## Design choices the human may veto (none blocks the plan)

- **D1. Telling untracked from tracked without touching `git.ts`.** A second read in a new shared helper: `git ls-files -z --others --exclude-standard` through an injected `Runner`, filtered by `shouldScanFile` and by dropping trailing-`/` entries. Rejected: diffing `lsFilesWorkingTree()` against `lsTree("HEAD")` (C-quoted non-ASCII names give false warnings; an unborn HEAD throws; staged-new files are ambiguous). Rejected: a new `GitOps.lsFilesUntracked()` (works, small, but `git.ts` is shared with secret-scan and QA-14; would raise the tier). Cost accepted: one duplicated git arg vector outside `git.ts`, about 41 ms.
- **D2.** One shared helper (`src/qa/untracked-scan-warning.ts`) for the warning; a mirrored, unshared `assertKnownArgs` for #179 (leaves reviewed marker argv code byte-identical).
- **D3.** CHANGELOG: add a new `[Unreleased]` entry closing the old disclosures; do not rewrite dated history.
- **D4.** Warning cap is 10 listed paths (a named constant, not a design number).

## Ordered plan (Phase 2, after approval)

0. Baseline on the clean branch: `npm test`, `npm run typecheck`, `npm run lint`; record real counts.
1. **#179:** write T179-1..4 red; add `assertKnownArgs`, call it first in `main()`; replace the KNOWN-GAP test; run mutations M1-M3.
2. **Shared helper** `src/qa/untracked-scan-warning.ts` with its test file (TW-1..8, red first).
3. **#175:** write T175-1, T175-2 red; swap the list source to `git.lsFilesWorkingTree()`, export the function, drop the unused `resolveChangedFiles` import; run M4.
4. **Wire the warning:** one call per `main()`, after collection and before the `--field` branch; write TWR-1..3 red first; run M6-M8.
5. **Comments and docs:** rewrite the doc comments named in AC 8; new CHANGELOG entry. `docs/STATE.md` and `docs/decisions.md` (log the human's 2026-09-19 rulings) stay the Manager's close-out edits.
6. **Verify** (real counts, skipped is not passed): typecheck, lint, `npm test` vs baseline, `node src/qa/completeness-claim-checker.ts`, `node src/qa/reference-resolver.ts` (QA-14 scans this diff's own prose: cite only real issues), the OSS-01 pre-commit scan then `node src/secret-scan/history-scan.ts` after the commit, `npm test` at `--test-concurrency=32` and `64`, two concurrent `node --test` runs on the new files, a manual demo in an isolated fixture repo, and the grep instruments from AC 4, 8, 12, 13.
7. PR skeleton: story, criteria checklist, ADR notes (SE ADR-0003 injected I/O, SE ADR-0005 replacement-of-KNOWN-GAP-test note, SE ADR-0010 full local gates), evidence, review chain.

**Mutation proofs** (applied by hand, shown red, restored):

| Mutation | Test that must go red |
|---|---|
| M1 remove `assertKnownArgs` call | T179-3 |
| M2 move it after collection | T179-3 (ordering half) |
| M3 relax gate to `!a.startsWith("-")` | T179-1 |
| M4 revert list to `resolveChangedFiles(..., "HEAD")` | T175-1 |
| M5 helper drops `--others` or adds tracked files | TW-1 |
| M6 drop the `/` filter / `shouldScanFile` / the cap | TW-2 / TW-3 / TW-7 |
| M7 warning written to stdout | TWR-1, TWR-3 |
| M8 remove the warn call from each `main()` | TWR-1 (marker); TWR-3 (continuation) |
| M9 warning changes exit code or count | TWR-1, TWR-3; existing #172 test |

## Constraints and reviewers

- ADRs: SE ADR-0003 (inject I/O), ADR-0005 (no weakening tests; replacing the KNOWN-GAP test is the ordered successor, not weakening), ADR-0010 (full local gates, no scope creep). Others not applicable.
- Sensitive areas touched: none, provided `src/lib/git.ts` and `docs/qa/secret-scan-allowlist.json` stay untouched. If Phase 2 finds either must change, STOP and re-tier (allowlist or secret-scan-adjacent change raises it).
- Reviewers (STANDARD): `code-reviewer` + `cross-domain-reviewer`. Extra `red-team` is optional: this function chain produced a fresh defect in each of 4 rounds of the earlier `s1-closeout-164-154` story, so the mutation proofs above are the mitigation.
- `test-writer`: not dispatched (no UI flow or HTTP API; the argv/stderr contract is an internal CLI). The implementer writes the named tests first, red, as its own discipline.
- Human-only: push, PR, merge.

## What changes for the human

- **Stray argv** to `continuation-residual-probe.ts`: before, prints a count and exits 0; after, exit 1, nothing on stdout, stderr `unrecognized argument(s): "<token>" ...`. A Node stack trace also appears, as the twin's gate does today; no try/catch added to hide it.
- **Untracked scannable files present** (either probe): stderr gains a block naming the count and up to 10 paths ("Commit, delete, or .gitignore them for a reproducible number. (The count itself is unchanged.)"). stdout is byte-for-byte what it is today.
- **Consequence to know:** after #175, `--field=continuation-residual` sends untracked-file citations to `gh`; a large scratch log could exceed the distinct-issue cap (default 300, `reference-resolver.ts:660`) and fail loud with exit 1. The warning is what tells the operator why the count moved.

## Will NOT do

- Touch `src/lib/git.ts`, `docs/qa/secret-scan-allowlist.json`, `reference-resolver.ts`, `completeness-claim-checker.ts`.
- Add a flag, a separate untracked number, or change the counted number or stdout.
- Edit historical CHANGELOG entries, review reports, or existing `docs/decisions.md` rows.
- Refactor the twins' duplicated helpers or share the argv gate.
- Fix a duplicated `--field=` (#226) unless the human folds it in (it is a small change once `assertKnownArgs` exists).

## Open question for the human at approval

Fold #226 into this story (small, same gate) or leave it as its own Issue? Default: leave it.
