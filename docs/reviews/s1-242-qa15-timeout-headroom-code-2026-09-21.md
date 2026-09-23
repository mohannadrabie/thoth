# Code Review — s1-242-qa15-timeout-headroom (Issue #242)

**Reviewer:** code-reviewer (Anubis) | **Date:** 2026-09-21 | **Tier:** STANDARD (ratified) | **HEAD:** `49a6ece` (branch `fix/s1-242-qa15-timeout-headroom`) vs `origin/master` (`2f61890`)

## Scope
`src/qa/completeness-claim-checker.ts` (+21/-1), `src/qa/completeness-claim-checker.test.ts` (+34), `CHANGELOG.md` (+9). Fixes Issue #242: QA-15's `verifyMarkerClaim` hardcoded a single `timeoutMs: 60_000` shared by every `KNOWN_INSTRUMENTS` entry; `qa-mutation-shell` ran close enough to it (39s quiet / 56.5s loaded, two reviewers' reports) that a loaded CI runner produced a false red. Fix: extract `INSTRUMENT_TIMEOUT_MS = 180_000` as a named, documented, exported constant, global (no per-instrument override).

## ADR compliance
`node docs/adr-cache.mjs --ensure` returned `ADR cache HIT: reused 37 ADR(s) ... [CACHE=HIT]`. This file is not in CLAUDE.md's named sensitive areas (hooks/guard/audit-trail/secret-scan-CI/policy-delivery/halt-state) -- confirmed by inspection, not assumed. Applicable software-engineering ADRs read from the cached catalog: SE-ADR-0003 (SOLID), SE-ADR-0004 (idempotency), SE-ADR-0005 (testing strategy), SE-ADR-0010 (code quality/maintainability). Devops ADRs not applicable (app-only diff, no IaC touched).

- SE-ADR-0003: `verifyMarkerClaim` already injects `runner: Runner` (I/O dependency) -- unchanged, compliant.
- SE-ADR-0004 (idempotency): not applicable -- no mutating endpoint/consumer/job in this diff (a read-only CI check).
- SE-ADR-0005 (testing): "unit tests for every new/changed behavior -- happy path, error paths, boundaries" -- satisfied for the new behavior (the constant's value and its wiring); no new error-path behavior was introduced (timeout-triggered failure handling is pre-existing, untouched by this diff).
- SE-ADR-0010: "run the full local equivalent of CI gates before declaring complete" -- verified myself (see Checks below); "leave touched code at least as clean as found" -- satisfied.

No ADR violations found.

## Verification performed (raw)

```
$ npm test
tests 1045
pass 1045
fail 0
skipped 0
duration_ms 113787.4242
```
Matches CHANGELOG's claimed "1045 passed, 0 failed, 0 skipped" exactly.

```
$ node --test src/qa/completeness-claim-checker.test.ts
tests 33
pass 33
fail 0
```

```
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
```

```
$ npm run typecheck   # tsc --noEmit -p tsconfig.json  -> clean, no output
$ npm run lint        # eslint .                       -> clean, no output
```

### Mutation-proved the two new tests (non-vacuous)
Mutation A -- revert the forwarding call to a literal `{ timeoutMs: 60_000 }` while leaving `INSTRUMENT_TIMEOUT_MS = 180_000` exported and unused elsewhere:
```
FAIL QA-15 (Issue #242, regression): verifyMarkerClaim passes INSTRUMENT_TIMEOUT_MS through...
  60000 !== 180000
```
Only the intended test failed; the rest of the 33-test file stayed green.

Mutation B -- restore the forwarding but drop the constant itself back to `60_000`:
```
FAIL QA-15 (Issue #242): INSTRUMENT_TIMEOUT_MS carries real headroom...
  must be at least 2x the slowest measured quiet instrument runtime (oss-history-scan)
```
Again, only the intended test failed. Both mutations reverted; working tree restored to the original diff (git status shows only the pre-existing, unrelated `docs/run-log.jsonl` change).

### Re-measured instrument timings myself (point 5 of the brief)
```
$ time node src/qa/shell-detector-mutants.ts     -> PASS 53/53 KILLED, real 0m23.238s   (claimed ~23s -- match)
$ time node src/secret-scan/history-scan.ts      -> real 1m12.332s                       (claimed ~69s quiet -- close, +4.7 percent, machine/history-growth variance)
$ time node src/qa/marker-corpus-probe.ts        -> real 0m0.487s                        (claimed sub-second -- match)
```
`qa-reference-resolver` (see Finding 1) did not reproduce the claimed ~47s -- see below.

### No conflicting/shorter timeout elsewhere (point 1 of the brief)
`grep -rn "60_000|60000|timeoutMs"` across `*.ts` and `.github/workflows/ci.yml` found: (a) this file's own historical comment references to the old value, (b) `src/lib/exec.ts:63`'s unrelated default (`30_000`, used only when no `timeoutMs` is passed -- not this code path), (c) `mutation-harness.ts:75` and `reference-resolver.ts:609`'s own internal, pre-existing 30s per-sub-call budgets nested well inside the outer 180s (not a conflict -- see Finding 1 for why `reference-resolver.ts`'s nesting still matters), (d) `.github/workflows/ci.yml:254`'s comment explicitly and correctly distinguishes `gate-latency-budget-check.ts`'s separate, unrelated `.claude/settings.json` `"timeout": 60` enforcement ceiling from this QA-15 cap -- confirmed by reading `gate-latency-budget-check.ts:7-44`, which never reads or is read by `completeness-claim-checker.ts`. No `timeout-minutes` set on the CI job (grep found none) -- pre-existing, tracked separately (Issue #247's spirit).
Confirmed clean: no other code path shares or conflicts with this timeout.

### 180s fully wired through (point 2 of the brief)
`grep -rn "60_000|timeoutMs" src/qa/completeness-claim-checker.ts` after the diff: the only literal `60_000` left is inside a historical/explanatory comment; the one runtime call site now reads `{ timeoutMs: INSTRUMENT_TIMEOUT_MS }`. Confirmed by Mutation A above that nothing else in the module still hardcodes the old value.

## Findings

**1. [ISSUE][LOW][code-traced] `qa-reference-resolver`'s real worst-case runtime is network-call-bound and citation-count-scaled, not a stable "quiet" baseline like its sibling instruments -- the comment's ~47s figure did not reproduce on my own re-run of the exact configured invocation.**

`KNOWN_INSTRUMENTS["qa-reference-resolver"]` invokes `node src/qa/reference-resolver.ts` with no args, which defaults `base`/`head` to `HEAD~1`/`HEAD` (`reference-resolver.ts:762-763`) -- a single-commit diff. `resolveIssueCitations` (`reference-resolver.ts:690-724`) then runs a sequential `for` loop, one real `gh issue view` network call per distinct issue-shaped citation found (`:721-723`), each individually capped at its own `timeoutMs: 30_000` (`:605-610`), up to `DEFAULT_MAX_DISTINCT_ISSUES = 300` citations (`:658-671`) before a fail-closed bailout. That is structurally up to 300 times 30s of sequential network time before the outer `INSTRUMENT_TIMEOUT_MS` (180s, applied by `completeness-claim-checker.ts`'s subprocess call) kills it -- reproducing Issue #242's exact false-red failure class, just at a higher threshold, on a commit that legitimately cites many issues (routine in this repo's own close-out commits: STATE.md/CHANGELOG.md entries commonly cite 10-30 issue numbers each) combined with degraded gh/GitHub API latency.

I re-ran the literal configured command twice (`node src/qa/reference-resolver.ts` and `node src/qa/reference-resolver.ts 2f61890 49a6ece`): 3.85s and 4.15s, not the comment's claimed ~47s -- demonstrating this number is not a stable per-instrument constant the way the CPU-bound instruments' numbers are; it is a function of whatever citation set happened to be present when it was measured.

This is not a regression -- the old 60s cap was more exposed to the same mechanism (only about 2 slow gh calls needed to trip false-red, versus about 6 now) -- and it does not change what actually shipped. Its blast radius depends on an unmeasured figure (how often a commit's diff cites more than 6 issues while gh is slow), so per PRINCIPLES rule 18 this caps at LOW with the recommendation "measure it": time `reference-resolver.ts` against a synthetic diff carrying 30-50 distinct issue citations, or (cheaper) grep this repo's own commit history for the real distribution of distinct-issue-citation-count per commit, before deciding whether this instrument needs its own dedicated headroom or parallelization rather than sharing the global cap.

Exposure: unmeasured, basis: assumption (structural bound counted-in-code: up to 300x30s = 9000s theoretical ceiling; real-world frequency not measured).

**2. [ISSUE][LOW][demonstrated] The `INSTRUMENT_TIMEOUT_MS` comment's "measured directly ... across every registered instrument" omits one entry.**

`KNOWN_INSTRUMENTS` has 14 keys (confirmed via `Object.keys()`). The comment's measured breakdown lists `qa14-marker-corpus-probe-*` (a glob covering `-marked`/`-unmarked`/`-total`) but never names the bare `qa14-marker-corpus-probe` key (no `--field` flag), which does not match that glob textually. I timed it directly: 0.487s, consistent with its siblings, so the omission changes nothing about the constant's safety -- this is a prose-completeness gap, not a functional one, but notable because this exact file's entire purpose is catching unverified "every X" claims. Minimal fix: reword to `qa14-marker-corpus-probe (bare + -marked/-unmarked/-total)` or list all 4 explicitly.

**3. [SUSPICION][LOW][derived] The 3x-longer worst-case wait before a genuinely hung instrument reports failure (60s to 180s) is not discussed anywhere in the fix.**

No `timeout-minutes` is set on the CI job either (confirmed absent by grep), so nothing else bounds total wall-clock if this step hangs the full 180s. This is a real but minor operability/feedback-loop cost of the fix's own chosen tradeoff (global, generous raise; "no instrument here needs a short timeout to fail fast"). Not a new gap this diff introduced -- the same job-level absence is already tracked under Issue #247's spirit (STATE.md's own open item: "#247 ... a scan-time bound plus timeout-minutes on the ci job"). Recommend a one-line acknowledgment in the CHANGELOG entry naming the tradeoff explicitly; non-blocking, no new Issue (duplicate territory of #247).

**4. [CLEAN] No conflicting/shorter timeout exists elsewhere for this gate.** See Verification above.

**5. [CLEAN] 180s value fully wired through; zero remaining `60_000` in runtime code.** Confirmed by grep and by Mutation A.

**6. [CLEAN] Both new tests are non-vacuous, each pinning exactly what it claims to.** Confirmed by two independent mutations, each failing only its intended test.

**7. [CLEAN] Re-measured timings corroborate the story's central claims for the CPU-bound instruments** (`qa-mutation-shell`, `oss-history-scan`, `qa14-marker-corpus-probe`) within normal machine variance; full suite count matches CHANGELOG exactly (1045/0/0); typecheck and lint clean.

## Editorial (non-blocking, uncounted)
- `docs/STATE.md` is not updated in this commit's diff (only `CHANGELOG.md` is). Consistent with this repo's own observed convention of a separate close-out commit landing STATE.md updates after review (e.g. the s1-229-qa14-red story split its fix commits from its close-out commit the same way) -- not flagged as a DoD gap for this specific commit, just naming it so the close-out step for #242 is not forgotten at merge time.

## Scorecard
| Axis | Verdict |
|---|---|
| Correctness vs. story / user-facing bug | No user-facing bug; internal CI gate. Fix does what Issue #242 asked (headroom, not just a bump for the one reported instrument) and is more thorough than the bug report required (measured the actual slowest instrument, not just the reported one). |
| Idempotency and re-runs | N/A -- pure constant/config change, no state. |
| Inputs and edge cases | Handled: the constant is a single source of truth, no per-instrument drift possible. |
| Error handling and operability | Pre-existing timeout-failure messaging unchanged (not this diff's scope); Finding 3 notes the tradeoff is not discussed. |
| Verification quality | Real, re-run by me: full suite, unit file, typecheck, lint, QA-15 self-check, two mutation drills, three independent instrument timing re-measurements. |
| Maintainability | Constant is named, exported, documented with its own measurement provenance -- a real improvement over the prior magic number. |

## Verdict: SHIP

No HIGH or blocking MED finding. Both findings that reached [ISSUE] status are LOW (one self-capped by PRINCIPLES rule 18's "depends on an assumed number" rule, one a harmless prose-completeness gap) and neither requires a GitHub Issue per this project's own filing rule (LOW-severity issues do not spawn one). This is genuinely diligent, measurement-first work -- the implementer went beyond the letter of Issue #242 (which only named `qa-mutation-shell`) and found the repo's actual slowest instrument first, then sized the fix against that, with two properly mutation-proven regression tests.

**Praised decision:** measuring every registered instrument before picking a number, and headroom-checking against the slowest one found (`oss-history-scan`) rather than only the one instrument the bug report named -- exactly the discipline PRINCIPLES rule 18 asks for, and it caught a second real risk (`oss-history-scan` already over the old cap) that a narrower fix would have missed.

## Single next action
Implementer/Manager: file a follow-up Issue (or fold into the existing #247 conversation) to measure `qa-reference-resolver`'s real runtime under a synthetic diff with about 30-50 distinct issue citations (Finding 1) -- everything else here ships as-is.

---
RECEIPT: verdict=SHIP
findings (ranked by severity):
1. [ISSUE][LOW][code-traced] src/qa/reference-resolver.ts:658-671,690-724,605-610 -- qa-reference-resolver's runtime scales with sequential gh-call count (up to 300x30s), not a stable baseline; my re-run measured 3.85s/4.15s vs the comment's claimed ~47s; not a regression (old cap was more exposed), blast radius unmeasured -> caps LOW per rule 18, recommend "measure it" against a synthetic many-citation diff.
2. [ISSUE][LOW][demonstrated] src/qa/completeness-claim-checker.ts:210-228 -- INSTRUMENT_TIMEOUT_MS comment's "every registered instrument" measured list omits the bare qa14-marker-corpus-probe key (glob notation does not textually cover it); timed it directly (0.487s), harmless, reword the comment.
3. [SUSPICION][LOW][derived] CHANGELOG.md / src/qa/completeness-claim-checker.ts:210-229 -- 3x longer worst-case wait before a genuine hang reports failure is undiscussed; no ci.yml job timeout-minutes either, but that gap is already tracked under Issue #247's spirit, not new to this diff.
4. [CLEAN][demonstrated] No other conflicting/shorter timeout exists for this gate (grepped .ts/.mjs/.yml; the only other "60s" is the unrelated, explicitly-distinguished .claude/settings.json enforcement ceiling).
5. [CLEAN][demonstrated] 180s fully wired through, zero remaining literal 60_000 in runtime code, confirmed via mutation.
6. [CLEAN][demonstrated] Both new tests are non-vacuous -- two independent mutations each failed exactly the intended test and nothing else.
7. [CLEAN][demonstrated] Re-measured qa-mutation-shell (23.2s), oss-history-scan (72.3s), qa14-marker-corpus-probe (0.487s), full suite (1045/0/0), typecheck/lint clean -- all corroborate the story's claims within normal variance.
counts: issues=2 suspicions=1 clean=4
evidence: demonstrated=5 code-traced=1 derived=1
checks="1045/0/0 (npm test); 33/0/0 (checker unit file); typecheck clean; lint clean; QA-15 self-check PASS"
adr=HIT(4)
report=docs/reviews/s1-242-qa15-timeout-headroom-code-2026-09-21.md
