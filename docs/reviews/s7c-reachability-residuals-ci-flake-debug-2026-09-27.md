# Debug report — CI-only red on `oss01-allowlist-tool-verify-problem-lines-never-carry-a-shell-metacharacter-from-the-allowlist-file` ("still-matches" class)

**Date:** 2026-09-27
**Debugger:** Serqet (maat:debugger)
**Trigger:** PR #342, branch `feat/s7c-reachability-residuals`, head commit `1c892d5`. CI run https://github.com/mohannadrabie/thoth/actions/runs/36355247461 — **both attempts failed identically** on the same commit.
**PR diff scope:** `src/policy/config/*`, `src/policy/normalizer/tool-class-format.ts` only. **Nothing in the diff touches `src/secret-scan/`.**
**This is a recurrence** of a previously diagnosed, previously reported issue: `docs/reviews/oss01-verify-still-matches-debug-2026-09-23.md` (PR #281, 2026-09-23). Same test, same failing class, same mechanism — confirmed independently below before I read the prior report.

## ADR check
`node docs/adr-cache.mjs --ensure` → `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] [CACHE=HIT]`. No ADR governs test-flake handling; the OSS-01 scan-timeout design (`history-scan.ts`'s own header comments, Issues 247/264/271) is the relevant prior decision and is unaffected by this finding.

## 1. Reproduction

Could not reproduce the actual end-to-end CI test failure on demand locally (expected — it is a host-scheduling-dependent race, same as the 2026-09-23 incident):
- `node --test --test-concurrency=1 src/secret-scan/allowlist-tool.test.ts` → passes every time (confirmed, matches the task brief).
- Windows dev box has 22 logical cores vs GitHub `ubuntu-latest`'s small fixed vCPU count — vastly different contention headroom.

Reproduced the underlying **mechanism** directly, with a throwaway script (not committed) that replicates `history-scan.ts:145-171`'s exact `vm.Script` + `runInContext({timeout: 500})` pattern against a trivial 24-byte string and the real `AKIA[0-9A-Z]{16}` shape:

| Condition | Trials | Timeouts (>500ms) | max ms | avg ms | p95 ms |
|---|---|---|---|---|---|
| No contention (baseline) | 200 | 0 | 1 | 0 | 0 |
| 22 busy workers (= core count, saturated) | 200 | 0 | 153 | 83 | 116 |
| 88 busy workers (4x oversubscribed) | 100 | **16** | **949** | 280 | 843 |

At 4x CPU oversubscription — a rough proxy for `node --test`'s default multi-file parallel concurrency plus per-test `git`/`node` subprocess spawns competing on a small fixed vCPU count — the identical trivial regex match that takes ~0ms with headroom times out 16% of the time, with p95 already past the 500ms budget. This is scheduling delay, not slow regex work: the `vm` watchdog timer measures **wall-clock**, not CPU time consumed by the script.

## 2. Isolation

`src/secret-scan/history-scan.ts:145-171`:
```ts
export const SCAN_TIMEOUT_MS = 500;
function matchAllBounded(text, regex) {
  timeoutSandbox.text = text; timeoutSandbox.regex = regex;
  try { return matchAllScript.runInContext(timeoutSandbox, { timeout: SCAN_TIMEOUT_MS }); }
  catch { return null; } // -> reported as SCAN_TIMEOUT_PATTERN_ID ("oss01-scan-timeout")
}
```
`allowlist-tool.ts`'s `verifyMigration()` (lines 250–258) keys `hashesAtPair` by the exact `(path, patternId)` pair (`allowlist-tool.ts:226–232`). A real match reported under `oss01-scan-timeout` instead of the pattern's real id (`AWS` here) is invisible to any check keyed on the real id.

Confirmed this is the **only** class in the failing test that can be affected by scan timing:
- `invalid-entry`, `two-entries`, `no-legacy-pair`, `changed-reason` — pure structural JSON comparisons, no real scan involved.
- `unbacked-hashes`, `differs-from-scoped` — use synthetic `patternId`s (e.g. `pid("unbacked", p)`) that never match anything real regardless of scan outcome, and synthetic dummy hashes (`h("h1")`/`h("h2")`) — contention-immune by construction.
- `still-matches` (line 553, 579) is the **one** class built from a real path + the real `AWS` pattern id against real scanned content (`phase1`'s `lit(i)` fixture: `k = AKIA...`) — the only class whose result depends on the scanner classifying that content under its real pattern id within the wall-clock budget.

This matches the observed failure exactly: every class before `still-matches` in the assertion loop (line 595) passed; only `still-matches` (count 0) failed.

## 3. Root cause (with evidence)

**Confirmed pre-existing latent bug, not caused by this PR's diff.** `src/secret-scan/history-scan.ts` and `src/secret-scan/allowlist-tool.test.ts` are both absent from PR #342's actual diff (`git diff --stat 8fa9eee..1c892d5` touches only 3 files in `src/policy/`). This code and its wall-clock timeout ceiling are unchanged from master.

What plausibly changed the *odds* of tripping it: `npm test` = `node --test` on `ubuntu-latest` with no `--test-concurrency` override (confirmed in `.github/workflows/ci.yml:203`) runs the whole suite's files concurrently on a small fixed vCPU count. Measured test-suite growth since the prior (2026-09-23) incident:

| | Prior incident (PR #281, commit `23a339c`) | Now (PR #342, commit `1c892d5`) | Δ |
|---|---|---|---|
| `.test.ts` files | 62 | 87 | +40% |
| Total test-file lines | 16,512 | 22,910 | +39% |

A ~40% larger concurrently-scheduled test suite on the same fixed CI vCPU count raises sustained contention pressure — consistent with this run failing **2/2** identically, versus the prior incident's single occurrence that self-healed on one rerun.

Evidence chain: real `SCAN_TIMEOUT_MS`/`vm.Script` mechanism, reproduced under measured CPU oversubscription, converts a genuine sub-millisecond regex match into a `oss01-scan-timeout` finding at match rates (16% per call at 4x oversubscription in my repro) that plausibly compound to "0 of ~8 still-matches survive" when the fixture's ~8 sequential blob scans (`withPlumbingPhases`'s `treeNames`) all fall inside one sustained contention window on CI's actual (worse-than-my-repro) subprocess-heavy load.

## 4. Fix

**No fix applied — diagnosis only, as directed.** Same conclusion as the 2026-09-23 report, now with two additional data points:
1. **Recurrence**: this is the second known occurrence of the identical mechanism.
2. **Escalation signal**: prior occurrence was a single flake that self-healed on rerun; this occurrence failed 2/2 identically on the same commit, and the test suite driving contention has grown ~40% since. The prior report's own stated re-evaluation trigger ("if this recurs frequently enough to be disruptive, measure actual CI contention") is now met.

Fix options, none applied, for the Manager to weigh:
- **Re-run CI again** (human-run, no code change) — cheapest option, but given 2/2 identical failures already (unlike the prior 1/1-then-green case), a bare rerun is a weaker bet than last time; it may pass if the runner's concurrent job mix happens to be lighter, but the mechanism itself is unchanged and the suite is now larger, so recurrence should be expected to keep getting *more* likely, not less, over time.
- **Loosen `SCAN_TIMEOUT_MS` or make it CI-aware** — touches `src/secret-scan/history-scan.ts`, a security-relevant scan-timing ceiling (anti-ReDoS budget, Issues 247/264/271). CRITICAL tier; needs `app-security-reviewer` + `cross-domain-reviewer` and a fresh dated report before any change ships — not something to do reactively for one flaky test.
- **Lower CI's effective `node --test` concurrency** (e.g. `--test-concurrency=<n>` in `package.json`'s `test` script, or job-level runner change) — trades CI wall-clock time for contention headroom; touches `.github/workflows/ci.yml` and/or `package.json`, both of which are named sensitive/CI-gate surfaces per `CLAUDE.md` and need the same review ceremony before shipping.
- **Isolate this one test file** (mark it to avoid default parallel scheduling) — smallest blast radius of the code-touching options, but it is the test file the story's own hard rule (`docs/PRINCIPLES.md`/CLAUDE.md DoD) protects: `story-implementer` does not edit a reviewed test file; this one is also untouched by the current PR, so touching it now would be exactly the kind of out-of-scope edit the workflow disallows without its own story/review.

## 5. Regression check

N/A — no code change made. If the Manager decides to act on the escalation signal, the regression check for any of the above is a repeat of this report's own repro table (before/after, under the same simulated oversubscription) plus a rerun of the real CI job.

## 6. Blast radius & tier

No diff produced by this investigation. Tier for **this debug pass**: TRIVIAL (no code change). Any future change motivated by this recurrence — to `src/secret-scan/history-scan.ts`, `.github/workflows/ci.yml`, or `package.json`'s test invocation — is CRITICAL/STANDARD per `CLAUDE.md`'s named sensitive areas (secret-scan gate, CI gates) and needs its named reviewer(s) (`app-security-reviewer` + `cross-domain-reviewer` at minimum) and a fresh dated report before it ships, same as the 2026-09-23 report already flagged.

## Answers to the four asked questions

1. **Pre-existing latent bug vs PR-caused**: pre-existing, present on master today. PR #342's diff does not touch this code at all. The PR's own change (390 lines added to `rule-reachability.test.ts`) is not the defect — it's a plausible contributor to the CI job's total concurrent-file contention, alongside ~25 other test files added to the suite since the prior incident.
2. **Precise mechanism**: `vm.Script#runInContext({ timeout: 500 })` in `matchAllBounded()` (`history-scan.ts:160-171`) measures wall-clock time, not CPU time. Under real CPU oversubscription (many `node --test` worker files each spawning their own `git`/`node` child processes on `ubuntu-latest`'s fixed small vCPU count), a trivially fast regex match can be scheduled out long enough that the 500ms ceiling elapses before the actual work runs, converting a genuine match into an `oss01-scan-timeout` finding under a different `patternId`. `verifyMigration()`'s pair-keyed lookup (correctly, by design) cannot tell that apart from "no match," so the `still-matches` problem line never prints for that entry.
3. **Minimal safe fix**: none applied. No safe *code* fix exists that doesn't touch a named-sensitive area (the anti-ReDoS timeout itself, or the CI concurrency it races against) — see options above. This is a Manager decision (fix-now with full review ceremony vs defer-with-Issue vs re-run), not mine to make.
4. **Would a re-run likely pass**: uncertain, weaker odds than the prior incident. This is a genuine timing race (not a deterministic logic bug), so a re-run *can* pass — but it already failed 2/2 on this commit (vs the prior incident's 1-off self-heal), and the measured ~40% growth in concurrently-scheduled test files since then means the contention window has gotten wider, not narrower. Treat a bare re-run as a coin-flip-or-worse, not a confident fix.

---
RECEIPT: verdict=UNREPRODUCIBLE tier=TRIVIAL regressionCheck=n/a adr=HIT(37) report=docs/reviews/s7c-reachability-residuals-ci-flake-debug-2026-09-27.md
