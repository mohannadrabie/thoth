# s1-226-duplicate-field: Phase 1 plan (2026-09-19)

**Status: PLAN-READY, nothing built.** Issue #226 (Milestone "S1 — Protect the baseline", labels bug, severity:low, qa). Branch `fix/s1-226-duplicate-field` from `master` @ 8760096. Follow-on to Story A (`docs/plans/S1-storyA-probe-hardening-phase1-2026-09-19.md`), which deferred this on purpose.

**Story.** A duplicated `--field=` to either QA probe must fail loud (non-zero exit, nothing on stdout, stderr naming the tokens) instead of resolving first-wins and exiting 0.

## Readiness and ADRs

- Readiness: no missing facts. R6 (identical repeat is rejected) is a Manager ruling, human-preapproved.
- ADR cache: HIT, 36 ADRs, fingerprint 5dba384. Applicable: SE ADR-0003 (no new I/O in the validator: the check is pure), SE ADR-0005 (tests are the answer key; existing tests stay unmodified), SE ADR-0010 (full local gates, no scope creep). Not applicable: all devops ADRs, SE 0002/0004/0006-0009/0011-0016, 0017-0021 and THOTH-ADR-0001 (no data, no policy path, no `git.ts`). None UNCLEAR.

## Facts checked against 8760096

| Fact | Evidence |
|---|---|
| `parse*Field` has exactly one non-test call site per probe, directly after `assertKnownArgs(argv)` and before `collectFullTreeFileTexts` | grep of `src` (non-test): `marker-corpus-probe.ts:219-222`, `continuation-residual-probe.ts:244-247` |
| No real caller passes two `--field=` tokens | grep over `.github`, `package.json`, `KNOWN_INSTRUMENTS` (`src/qa/completeness-claim-checker.ts` lines 57-59 and 68-69, one field each): the only two-token hits are historical demos in `docs/reviews/*` |
| `parse*Field` is unit-tested with `["HEAD","--field=total"]`-shaped argv | `src/qa/marker-corpus-probe.test.ts` 90-99; `src/qa/continuation-residual-probe.test.ts` 204-212 |
| The non-git `mkdtemp` + `GIT_CEILING_DIRECTORIES` helpers exist in the continuation test only | `src/qa/continuation-residual-probe.test.ts` 44-55 and 264-284; the marker test file has neither `withNonGitDir` nor `dirname` and needs a mirrored copy |
| Stale comments about first-wins | grep `first-wins`, `226` in `src`: none, nothing to correct |

## Placement decision: inside `parse*Field`, not `assertKnownArgs`

- The defect is in the resolver (`Array.find`), so the fix goes where the ambiguity is resolved. A future direct caller of `parse*Field` cannot get first-wins back.
- `assertKnownArgs` says "unrecognized argument"; `--field=` is a recognized flag, so its contract and message stay untouched (R5, R7).
- Ordering is preserved for free: `main()` already calls `parse*Field` before collection. Pinned by the subprocess test and mutation M3.
- Shape: `const flags = args.filter(a => a.startsWith("--field="))`; if `flags.length > 1` throw an Error naming every token via `JSON.stringify`, joined `, `; the duplicate check runs before value validation; then the existing single-flag logic on `flags[0]`. About 4 changed lines per file; no try/catch (uncaught rejection gives exit 1, as Story A's gate does). The message does not repeat field-value lists.

## Acceptance criteria mapped to named checks

| R | Criterion | Named check(s) |
|---|---|---|
| R1 | marker: 2+ `--field=` rejected, both orders; non-zero, empty stdout, stderr has both tokens | T226-M1 (unit, both orders, message includes both quoted tokens); T226-M3 (subprocess, both orders) |
| R2 | continuation: same | T226-C1, T226-C3 (orders: `continuation-marked`/`continuation-residual` and reverse) |
| R3 | rejection before any file collection or git call | T226-M3, T226-C3: cwd = non-git `mkdtemp`, `GIT_CEILING_DIRECTORIES=dirname(dir)`, assert stderr does NOT match `not a git repository`; mutation M3 |
| R4 | valid invocations unchanged | existing, unmodified (MT = `src/qa/marker-corpus-probe.test.ts`, CT = `src/qa/continuation-residual-probe.test.ts`, lines after the path): parse tests (MT 90-99, CT 204-212), real-subprocess `--field=` tests (MT 116, 298-312; CT 224, 287-302), `src/qa/completeness-claim-checker.test.ts` 129-165 |
| R5 | existing errors unchanged | existing, unmodified: stray-arg and `assertKnownArgs` tests (MT 147-173; CT 237-284), bad-value tests (MT 102-104; CT 214-219) |
| R6 | identical repeat rejected | T226-M2, T226-C2: `["--field=total","--field=total"]` (continuation: `continuation-marked` twice) throws, names the token |
| R7 | no new surface | grep instrument: `git diff --name-only origin/master` equals the expected file set (below); `git diff origin/master --stat -- src/lib/git.ts src/qa/completeness-claim-checker.ts docs/qa/secret-scan-allowlist.json` is empty |

Assertions check tokens (`err.message.includes(JSON.stringify(token))`), never invented prose. Tests go in the existing test files, in a new "duplicated --field= (Issue #226)" block; no existing test line is edited.

## Mutation proofs (by hand, shown red, restored)

| Mutation | Must go red |
|---|---|
| M1 delete the duplicate check in each `parse*Field` (back to first-wins) | T226-M1, M2, M3 / T226-C1, C2, C3 |
| M2 relax to "reject only when values differ" (e.g. `new Set(flags).size > 1`) | T226-M2 / T226-C2 |
| M3 move the `parse*Field(argv)` call after `collectFullTreeFileTexts` in `main()` | T226-M3 / T226-C3 (stderr becomes git's error, token absent) |

M1 also proves the subprocess tests are safe: in a non-git dir the mutant dies in `git ls-files` before any `gh` or network call, even for `--field=continuation-residual`.

## Order of work (Phase 2, after approval)

1. Baseline on the clean branch: `npm test`, `npm run typecheck`, `npm run lint`; record real counts.
2. Write T226-M1..M3 and T226-C1..C3 first, run them red (both probes still first-wins).
3. Add the check to each `parse*Field`; tests green; run M1-M3 on each probe, restore.
4. `CHANGELOG.md`: one `[Unreleased]` entry closing Issue #226 (Definition of Done). `docs/STATE.md` and `docs/decisions.md` stay the Manager's close-out; the decisions sweep is out of scope and untouched.
5. Verify (skipped is not passed): typecheck, lint, `npm test` vs baseline, `node src/qa/completeness-claim-checker.ts`, live demo at repo root (`--field=total` exit 0; `--field=marked --field=total` exit 1, empty stdout), the QA-14 note below, the OSS-01 pre-commit scan.
6. PR skeleton (story, criteria checklist, ADR notes, evidence, review chain). Human-only: push, PR, merge. The untracked `prompt` file is never staged.

Expected diff (exactly): `src/qa/marker-corpus-probe.ts`, `src/qa/continuation-residual-probe.ts`, both `.test.ts` files, `CHANGELOG.md`, this plan, plus the tier persistence in `docs/.maat-state.json` and later reviewer reports.

## Tier, reviewers, test-first

- **Tier: STANDARD.** Two pure argv validators in internal QA CLIs, about 8 lines of source, reversible, no sensitive-area file (Story A's reading). Re-tier if the diff must touch `completeness-claim-checker.ts`, `src/lib/git.ts`, the allowlist or `.github/workflows/ci.yml`.
- Reviewers: `code-reviewer` + `cross-domain-reviewer`. No `red-team` (mutation proofs M1-M3 are the mitigation).
- **Test-first dispatch check: no new or changed UI flow or API surface.** The only change is the argv/stderr/exit-code contract of two internal CLIs, so `test-writer` is not dispatched. The implementer writes the named tests red first as its own discipline.

## QA-14 baseline flag (QA-14 is red on master, Issue #229; it scans WHOLE changed files)

- Test files are excluded by `shouldScanFile` (`src/qa/reference-resolver.ts` lines 534-536), so the two test edits add nothing.
- Stub scan of the two probe sources at 8760096: 0 blocking failures (3 non-blocking `unclassified`: #164, #170 in marker, #170 in continuation). Added comments will use the word form "Issue #226".
- Stub scan (NOT the CI figure; ADR ids and basename lookups stubbed) of files this diff must touch anyway: `CHANGELOG.md` shows about 13 pre-existing path-style failures; `docs/.maat-state.json` shows 2. Editing them moves those into the changed-file count. This is a whole-file effect, not new prose.
- This plan file is written with word-form issue citations and only existing paths.
- Phase 2 check: run the real `node src/qa/reference-resolver.ts origin/master HEAD`, expect exit 1 (Issue #229), and confirm no failing citation comes from a line this diff adds (added-lines scan). QA-14 stays out of the pass/fail bar for this story.

## Will NOT do

- Shared helper, or a change to `src/lib/git.ts`, `completeness-claim-checker.ts`, `docs/qa/secret-scan-allowlist.json`.
- Change the existing error messages or `assertKnownArgs`; edit historical CHANGELOG entries or review reports.
- Touch the `docs/decisions.md` sweep. Anything else found goes to a GitHub Issue, never `docs/backlog.md` or this diff.

## Blocking questions

None.
