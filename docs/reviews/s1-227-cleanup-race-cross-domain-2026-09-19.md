# Cross-Domain Review (Ra) - s1-227-cleanup-race (Issue #227)

[cross-domain-reviewer]
Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes

- Date: 2026-09-19. Tier: STANDARD (ratified by the Manager, run-log `tier-ratified` 2026-09-19T17:23:38Z; not re-litigated).
- HEAD: 3f94d1d4076e53a007c50185353a3ad7de0dfbe5 (3 commits since origin/master f10ae2d: b575225 state/plan, 6b1ab75 build, 3f94d1d plan-citation reword). Branch `fix/s1-227-cleanup-race`.
- Diff: `git diff origin/master...HEAD`, 5 files: `CHANGELOG.md`, `docs/.maat-state.json`, `docs/plans/S1-227-cleanup-race-phase1-2026-09-19.md`, `docs/run-log.jsonl`, `src/secret-scan/pre-commit-scan.test.ts` (the only code file: one helper, six routed cleanup sites, two `-c` clone arguments).
- **Verdict: APPROVE.** No ADR collision, no seam defect, no HIGH/MED. 0 open findings, 0 failing tests. 4 Editorial items.

## Lanes

| Lane | Who | Ground covered |
|---|---|---|
| Domain (code / test correctness) | `code-reviewer` (parallel; its report was not yet on disk when this ran) | helper semantics, clone-arg validity, grep coverage, no weakened assertion |
| Cross-domain (this pass) | Ra | whole ADR catalog vs the diff, sensitive-area ceremony, process record, hard rules, QA-14/15 gates, follow-up Issue shape, seams |

Not re-covered here: the test-body logic and the retry option literal (code-reviewer lane). Only what I ran to confirm a seam claim is reported below.

## ADR cache and whole-catalog read

```
[ADR cache] HIT: reused 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1] from catalog - about 17800 tokens saved this pass (fp 5dba384) [CACHE=HIT]
```

Read the catalog whole and unfiltered: 36 entries = devops 0001-0010 (+ template, README), SE 0001-0021 (0017 and 0018 superseded; + template, README), THOTH-ADR-0001. Rules for agents read for every accepted, non-superseded ADR whose text could bind a test-only cleanup change.

## Cross-domain ADR verdict

| ADR | Verdict | Basis |
|---|---|---|
| SE-0005 (testing) "MUST NOT delete or weaken a failing test" | Clear | `git diff -U0 origin/master...HEAD -- src/secret-scan/pre-commit-scan.test.ts` filtered for added/removed `assert` or `test(` lines printed nothing (grep exit 1); `grep -c "^test("` = 13, same as base. |
| SE-0005 "MUST NOT use ... arbitrary sleeps" | Clear (reading stated) | The rule targets waits inside a test body. `retryDelay: 100` is the Node built-in bounded retry inside teardown (`maxRetries: 5`), not a sleep the test asserts around. If the Manager reads it strictly, the route is `/maat:adr-amend`, not a waiver. |
| SE-0005 "MUST make each test create/own its data" | Clear | Every fixture is its own `mkdtemp` (4 calls, lines 33/201/232/270); cleanup only touches that dir. |
| SE-0006 "MUST NOT retry non-idempotent operations" and "MUST NOT widen scope opportunistically" | Clear | `rm(..., {force:true})` is idempotent. Diff is confined to the one test file plus docs; the 29 sibling sites went to Issue #231, not into the diff. |
| SE-0010 "MUST NOT ... delete tests", "file follow-ups, do not scope-creep", "run full local CI gates" | Clear | No test deleted; follow-up filed (#231); gates run below (QA-14 red is the standing #229, none of it from this diff). |
| devops ADR-0008 (Gitleaks pre-commit, no bypass, no ratchet loosening) | Clear | Hook, scanner, allowlist and `ci.yml` are not in the diff. OSS-01 history scan exit 0 (below). |
| SE-0016 / 0019 / 0020 (port fidelity, self-protection) | N/A | No ported file touched. |
| SE-0021 (kernel purity, gates, audit trail), THOTH-ADR-0001 (classification fixture) | N/A | No `src/policy`, `hooks/`, or `docs/qa/s5-central-classification.json` change. |
| SE-0002/0003/0004/0007/0008/0009/0011-0015, devops 0002-0007/0009/0010 | N/A | No layering, IaC, data, tagging, cost, or observability surface touched. |

No collision. No `/adr-amend` needed.

## Seam findings

### 1. [CLEAN][code-traced] Whole-catalog ADR pass over the 5-file diff (table above). No accepted ADR is violated in any lane, including the lanes no reviewer covers here (devops, data, integration).

### 2. [CLEAN][demonstrated] Sensitive-area ceremony is satisfiable, and the re-tier trigger has not fired.

`src/secret-scan/pre-commit-scan.test.ts` is outside the literal `scripts/secret-scan/*` glob in CLAUDE.md and inside its intent; the Manager ruled it in-area. The hard rule needs a named reviewer plus a fresh dated report in `docs/reviews/`. Named reviewer: `code-reviewer`. Fresh dated report from this pass: this file. The rule closes once both reports are committed (the Manager commits reports; the code-reviewer report was not on disk yet when I checked `docs/reviews` for 227 or cleanup-race). The tier note re-tier trigger ("re-tier to CRITICAL if pre-commit-scan.ts, the allowlist or ci.yml must change") has not fired:

```
$ git diff origin/master...HEAD --name-only
CHANGELOG.md
docs/.maat-state.json
docs/plans/S1-227-cleanup-race-phase1-2026-09-19.md
docs/run-log.jsonl
src/secret-scan/pre-commit-scan.test.ts
```

### 3. [CLEAN][demonstrated] Process record is consistent.

- `docs/.maat-state.json` at HEAD parses; top level `scope=s1-227-cleanup-race tier=STANDARD`, rounds 0/0, `humanRulingRequired=false`, `councilHeld=false`. `priorScope` nesting is 12 deep, in order `s1-227-cleanup-race <- s1-qa-probe-hardening <- fixture-single-source-of-truth <- ... <- s6`. Deepening lost nothing: comparing the origin/master top level to the HEAD `priorScope`, the key sets are identical except that the 36-entry `adrCatalog` now rides inside the nested level, and the deeper `priorScope` chain is byte-equal (`JSON.stringify` compare true).
- Run-log carries exactly one `tier-ratified` event for the scope (`2026-09-19T17:23:38.337Z`, proposed=ratified=STANDARD, changed=false), consistent with the state file.
- Plan addendum vs build: D1 vetoed, so the diff has no new module or test file (name-only above); inline `removeTree` at the top of the test file with the planned literal and no catch (test.ts:18-20); six sites routed (lines 43, 203, 227, 234, 250, 283); D2 on the `noprepare` clone only (line ~240); sibling follow-up is Issue #231, no backlog line (`docs/backlog.md` is not in the diff).

### 4. [CLEAN][demonstrated] Hard rule "no hand-derived completeness claims" holds.

The one completeness claim (CHANGELOG line 14, "every temp-directory cleanup ... goes through `removeTree`") names its instrument. Reran it:

```
$ grep -nE "\b(rm|rmSync|rmdir|rmdirSync)\s*\(" src/secret-scan/pre-commit-scan.test.ts
19:  return rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
$ grep -nE "mkdtemp\(|removeTree\(" src/secret-scan/pre-commit-scan.test.ts   # 4 mkdtemp, 6 removeTree call sites (+ the definition)
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
```

The "13 tests, 0 failed, 0 skipped" statement is a measurement, reproduced in finding 6.

### 5. [CLEAN][demonstrated] QA-14: the Manager claim "7 unresolved, none on added lines" is true, and the mechanism is worth knowing.

```
$ node src/qa/reference-resolver.ts origin/master HEAD
[QA-14 reference-resolver] FAIL: 7 of 496 citation(s) failed to resolve; 58 more unclassified (non-blocking).
  - [unresolved-authority] Issue#0
  - [unresolved-authority] clean/safe-single-constructor-access.ts
  - [unresolved-authority] .claude/settings.local.json
  - [unresolved-authority] docs/reviews/_probe.md
  - [unresolved-authority] hooks/report-subject-gate.mjs
  - [unresolved-authority] fullstack/plugin.json
  - [unresolved-authority] fullstack/scripts/test-guard.sh        (exit=1)
```

Where each lives (`git show <ref>:<file> | grep -cF`, same count at HEAD and origin/master): `Issue#0`, `safe-single-constructor-access`, `settings.local.json`, `_probe.md`, `report-subject-gate` are in `CHANGELOG.md` (counts 1/3/2/1/2 at both refs); `fullstack/plugin.json` (1) and `test-guard.sh` (6) are in `docs/.maat-state.json` (identical at origin/master). The plan file and the diff added lines (155 lines, state file excluded) contain none of the 7. QA-14 reads the WHOLE text of every changed non-`*.test.ts` file (`shouldScanFile`, reference-resolver.ts:534), so any story that edits CHANGELOG or the state file inherits these; this is the standing Issue #229. The new citations this story adds (#227, #229, #230, #231) resolve or are unclassified; none is unresolved.

### 6. [CLEAN][demonstrated] The `-c gc.auto=0 -c maintenance.auto=false` clone arguments do not interact with anything else.

Probe (scratchpad clone of this repo with the exact arguments, git 2.54.0.windows.1):

```
clone exit=0
gc.auto (local)          -> 0
maintenance.auto (local) -> false
core.hooksPath (local)   -> exit 1 (unset)     # the test title claim "NO core.hooksPath configured" still holds
GIT_TRACE=1 commit in the clone: 0 lines mentioning maintenance
source repo: git config --local --get gc.auto -> exit 1 (unset, unaffected)
```

Both keys land in the clone own `.git/config` only. The R4 hook-installed test uses a separate `cloneDir` and a separate config; the real `.githooks/` is only reached via `core.hooksPath`, which the `noprepare` clone never sets; CI runs each test file in its own process, so no shared git config. Full file run on this box:

```
$ node --test src/secret-scan/pre-commit-scan.test.ts
... tests 13   pass 13   fail 0   cancelled 0   skipped 0   duration_ms 30682   (exit 0)
```

### 7. [CLEAN][demonstrated] Issue #231 is well-formed and its instrument agrees with the plan.

`gh issue view 231`: OPEN, labels `bug`, `severity:low`, `oss`, no milestone; body is a one-line ask, a regenerate command (not a typed count), and a three-line fix. Leaving the milestone unset is defensible: the CLAUDE.md link-a-milestone rule keys on code inside the CURRENT ratified scope, and #231 concerns other owners files (13 files across `hooks/`, `src/qa`, `src/policy`, `src/lib`, `src/secret-scan`); the S1 milestone description says SHIPPED. The `oss` label fits only the 3 secret-scan files of 13; `chore` was the alternative, not worth a change. Instrument cross-check: the #231 regex (`\brm(Sync)?\(` over `src hooks scripts`) and the plan S4 regex (`\b(rm|rmSync|rmdir|rmdirSync)\s*\(` over `src hooks scripts .githooks`) both return 29 sites outside the target file, in the same 13 files the plan lists (no `rmdir` or `rmdirSync` use exists).

### 8. Also checked, clean

- OSS-01: `node src/secret-scan/history-scan.ts` exit 0 (only ALLOWLISTED entries listed); its report file is gitignored (`.gitignore:7`), tree not polluted. No secret-shaped text in the added lines.
- No line-number or hash pin anywhere references `pre-commit-scan.test.ts` (repo grep excluding reviews, run-log, state): the routed lines cannot break a pinned reference.
- `git clone -c` semantics (applies before fetch, persists in the new repo) confirmed by the probe above.

## Coverage gaps (named)

- **Linux-runner efficacy is unprovable here.** The race does not reproduce on this Windows box (Node 24, git 2.54); Node 22 and git 2.55 on ubuntu are unmeasured. The plan and CHANGELOG already say so ("inferred, not captured"; no "N green runs" criterion), so it is a declared limit, not a finding. Settling command, for the human after merge: `gh run list --branch master --limit 60`, then `gh run view <id> --log-failed` grepped for ENOTEMPTY per red Test step. The PR own CI run is the first Linux execution of this diff.
- **`-c` arguments have no permanent test** (plan mutation M6, declared). Dropping them later silently reverts to retry-only, which still masks the race. Intentionally low-risk.
- **Docs files** (`CHANGELOG.md`, plan, run-log, state) are claimed by no domain lane; I read all four. Clean apart from the Editorial items.
- No `test-writer` gap: no UI or API surface.

## Editorial (verdict-neutral, plain edits, no re-review)

1. CHANGELOG line 9 says "Only `src/secret-scan/pre-commit-scan.test.ts` and this file change"; the branch diff has five files (state, run-log, plan too). Say "the only code file".
2. CHANGELOG line 19 sends the reader to "raw counts in the PR"; no PR exists yet. The Phase 1 raw counts are already committed in the plan S2 row (31/40, 34/40, 32/40, 36/40 bare; 0/40 retrying). Cite the plan, or paste the Phase 2 re-measure into the PR body. Also "three sizes" versus the plan four configurations (one wall-clock, three count-bound) is a wording drift.
3. Plan header still reads "Status: PLAN-READY, awaiting Manager ratification and human approval. Nothing built." The addendum at the end says it wins where it differs; a one-line status update would stop a reader who stops at the header.
4. `docs/.maat-state.json` is uncommitted-modified (+701 lines): `adr-cache.mjs --ensure` regenerated the top-level `adrCatalog`, which deep-equals the one origin/master committed (assert compare true). The HEAD copy of the state file carries the catalog only inside `priorScope`. Commit it or `git checkout` it before close-out so "working tree clean" (DoD) holds; expect the cache tool to re-add it on any later run.

## Expected, not findings (Manager close-out after review)

`docs/STATE.md` (its header still describes the Story A branch), a `docs/decisions.md` row for the D1 veto and the human preapproval, and the run-log `story-shipped` event are Manager post-review records.

## Evidence summary

| Check | Result |
|---|---|
| `node --test src/secret-scan/pre-commit-scan.test.ts` | 13 pass, 0 fail, 0 skipped |
| `node src/qa/completeness-claim-checker.ts` (QA-15) | PASS, 2 files |
| `node src/qa/reference-resolver.ts origin/master HEAD` (QA-14) | FAIL exit 1, 7 of 496 unresolved, all pre-existing in the whole-file scan of CHANGELOG.md and .maat-state.json, none on added lines |
| `node src/secret-scan/history-scan.ts` (OSS-01) | exit 0 |
| clone-arg probe | gc.auto=0 and maintenance.auto=false persisted; hooksPath unset; 0 maintenance trace lines |
| state and run-log parse, nesting compare | parses; chain of 13 scopes; run-log event present once |

Open findings: 0. Failing tests: 0. (Same number; nothing here has an executable form because nothing is open.)

**Single next action:** the Manager collects the code-reviewer report, commits both reports plus the REVIEW_LOG rows, does the close-out records (STATE.md, decisions row, `story-shipped`), and hands the branch to the human for push, PR (`Closes #227`), and merge.

RECEIPT: verdict=APPROVE
findings:
1. [CLEAN][code-traced] whole-catalog pass (36 ADRs) vs the 5-file diff: no collision in any lane; SE-0005 sleep clause read as not applying to the Node bounded teardown retry (reading stated)
2. [CLEAN][demonstrated] sensitive-area ceremony satisfiable (named reviewer + this dated report); re-tier trigger unfired (name-only diff shows no scanner/allowlist/ci.yml/git.ts change)
3. [CLEAN][demonstrated] process record: state parses, 12-deep priorScope lossless (only adrCatalog relocated), one tier-ratified event, plan addendum matches the build
4. [CLEAN][demonstrated] completeness claim is instrument-backed (grep = 1 match inside helper; QA-15 PASS); no hand-typed "all N"
5. [CLEAN][demonstrated] QA-14 7 unresolved verified: all pre-existing in CHANGELOG.md/.maat-state.json (whole-file scan), none on added lines
6. [CLEAN][demonstrated] -c gc.auto=0/maintenance.auto=false persists only in the noprepare clone, hooksPath stays unset, no interaction with R4 hook clone/.githooks/CI; file 13/0/0
7. [CLEAN][demonstrated] Issue #231 shape sound (bug/severity:low/oss, short body, milestone unset defensible); its 29-site instrument equals the plan
counts: issues=0 suspicions=0 clean=7
evidence: demonstrated=6 code-traced=1 derived=0
checks=node --test pre-commit-scan.test.ts 13 pass/0 fail/0 skipped; QA-15 PASS; QA-14 FAIL exit1 (7/496, pre-existing, none on added lines); OSS-01 history-scan exit 0; clone-arg probe ok
adr=HIT(36, whole catalog)
report=docs/reviews/s1-227-cleanup-race-cross-domain-2026-09-19.md
