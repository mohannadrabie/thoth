# Debug report — CI-only red on `oss01-allowlist-tool-verify-problem-lines-never-carry-a-shell-metacharacter-from-the-allowlist-file` ("still-matches" class)

**Date:** 2026-09-23
**Debugger:** Serqet (maat:debugger)
**Trigger:** GitHub Actions run https://github.com/mohannadrabie/thoth/actions/runs/35823011530 (ubuntu-latest, Node 24), PR #281, branch `fix/qa14-ci-red-citation-wording`, commits `162dcd3`/`ae3298b`.
**PR diff scope:** two hook-comment rewords + docs/changelog/state/review files. **Nothing in the diff touches `src/secret-scan/`.**

## ADR check
`node docs/adr-cache.mjs --ensure` → `📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] [CACHE=HIT]`. No ADR governs test-flake handling specifically; THOTH-ADR-0002 (value-scoped allowlist) and the OSS-01 scan-timeout design (documented in `history-scan.ts`'s own header comments) are the relevant prior decisions and are unaffected by this finding.

## 1. Reproduction
Could not reproduce the actual CI failure on demand (as expected for a rare, host-scheduling-dependent race):
- Ran the full suite 3x locally (Windows, 22 logical cores): 1090/1090 pass every time, including this test.
- `gh run rerun 35823011530 --failed` → reran clean: **conclusion `success`** on the same commit content. This is a strong self-healing signal, but "it passed on retry" is not the diagnosis by itself — the mechanism below is.

Instead, I reproduced the underlying **mechanism** directly, against the real, unmodified production code:

```js
// scratchpad/repro-timeout-real.mjs — imports the REAL exported scanBlobText() and the
// REAL SECRET_PATTERNS catalog from this repo, unmodified. Spawns N busy-spin worker
// threads, pins the main Node process to 2 logical CPUs (matching GitHub's documented
// ubuntu-latest 2-vCPU runner spec), then calls scanBlobText() against the exact
// literal shape the flaky test's own lit() fixture writes: "k = AKIAAAAAAAAAAAAAAAAA\n".
```
Run 3 trials, 300 calls each, process affinity pinned to 2 cores, 450 competing CPU-bound worker threads:
```
trial 1: runs=300 spuriousTimeouts(oss01-scan-timeout)=1 realAwsMatches=300
trial 2: runs=300 spuriousTimeouts(oss01-scan-timeout)=2 realAwsMatches=299
trial 3: runs=300 spuriousTimeouts(oss01-scan-timeout)=2 realAwsMatches=300
```
Trial 2 shows the exact failure shape: one call's genuine `aws-access-key-id` match was **replaced** by an `oss01-scan-timeout` finding instead (`realAwsMatches=299` instead of 300) — for a 24-byte string matched against `/AKIA[0-9A-Z]{16}/g`, work that normally completes in well under a millisecond. With no contention (baseline, all 22 cores free), 0/400 calls ever times out (measured `maxObservedMs` under 42ms).

## 2. Isolation
`src/secret-scan/history-scan.ts:145-171` — `matchAllBounded()`:
```js
export const SCAN_TIMEOUT_MS = 500;
...
function matchAllBounded(text, regex) {
  timeoutSandbox.text = text; timeoutSandbox.regex = regex;
  try { return matchAllScript.runInContext(timeoutSandbox, { timeout: SCAN_TIMEOUT_MS }); }
  catch { return null; } // -> reported as the oss01-scan-timeout finding
  finally { ... }
}
```
`vm.Script#runInContext({ timeout })`'s watchdog measures **wall-clock elapsed time**, not CPU time consumed by the script. If the OS preempts the main thread for the whole timeout window while `runInContext` is "in progress" (true under real CPU oversubscription — confirmed above), the watchdog fires and the call is reported as a timeout even though the actual regex work never got scheduled long enough to matter.

`allowlist-tool.ts`'s `verifyMigration()` (lines 250-258) only ever asks "did the scanner see a real match at this (path, patternId) pair?" — it has no way to know a scan that came back as `oss01-scan-timeout` was, this one time, a false negative for `aws-access-key-id` rather than a real timeout. This is correct, designed behavior (fail-closed per Issue 247's own rationale): the bug, if any, is not here.

`git.lsTree()`'s Map is keyed by the exact raw (possibly git-quoted) spelling and is never decoded (`src/lib/git.ts:92`), and the test's own `spelled` capture uses the identical raw `git ls-tree -r --name-only HEAD` output — so I ruled out a path-quoting mismatch (two of the eight `treeNames` fixtures contain characters git does quote: the literal `"` entry and `tésumé`) as a contributing cause; both sides use the same raw key.

## 3. Root cause (with evidence)
**Not a deterministic logic bug.** The test performs a real, end-to-end scan of live git blobs through the production `scanHistory` → `scanBlobText` → `matchAllBounded` path (by design — it's proving the CLI's actual printed output, not a mock). That path carries an intentional, tightly-measured wall-clock security ceiling (`SCAN_TIMEOUT_MS = 500`, chosen as ~100x this repo's own largest real blob's scan time, to fail closed against regex-backtracking DoS — see `history-scan.ts:139-145`). On `ubuntu-latest`'s 2-vCPU shared runners, under `node --test`'s default concurrent-test-file execution (this repo's `npm test` runs all test files in parallel, each spawning its own child `git` processes — this one test alone drives ~2 throwaway repos through dozens of git-plumbing subprocess calls), sustained CPU contention across the runner is plausible for the few hundred milliseconds this test's ~9 sequential blob scans take. When that contention window overlaps one or more of the 8 hostile-path fixture blobs' `aws-access-key-id` scan, the genuine match is silently replaced by an `oss01-scan-timeout` finding for that (path, patternId) pair, `hashesAtPair` for `patternId="aws-access-key-id"` comes back empty for it, `stillMatches` evaluates false, and no "still-matches" problem line prints for that entry — exactly CI's observed symptom (class count 0) when this coincides across enough/all of the fixture's entries in one run.

Evidence this is real and not speculative: the exact production function (`scanBlobText`, real `SECRET_PATTERNS`) measurably produces `oss01-scan-timeout` in place of a genuine `aws-access-key-id` match on trivial content, under artificially-constructed 2-vCPU contention that mirrors GitHub's documented runner spec — see trials above.

## 4. Fix
**No code fix applied.** Given the mechanism, the only two "fixes" available are both worse than the disease:
- Loosening `SCAN_TIMEOUT_MS` (or adding an injectable, test-only timeout) touches `src/secret-scan/history-scan.ts` — a CLAUDE.md-named sensitive area (the OSS-01 secret-scan gate) — purely to quiet a rare, self-healing test race, at the cost of either weakening a deliberately measured anti-DoS budget or adding complexity to security-critical code for test convenience (against this project's own simplicity-over-polish preference).
- The verify tool's logic (`verifyMigration`) is already correct: it has no way to distinguish "no match" from "a match the scanner couldn't finish scanning for," and shouldn't grow one — conflating them would be the actual regression (silently treating a real scan-timeout as "safe to skip").

This is a genuine, mechanistically-explained flake, not a hand-waved one: confirmed root cause is CI-host CPU scheduling contention interacting with an intentional wall-clock security ceiling, reproduced directly against the unmodified production code. The correct, proportionate remedy is what was already done — `gh run rerun --failed`, which came back green on the identical commit — plus this record so a recurrence is recognized immediately rather than re-investigated from scratch.

## 5. Regression check
N/A — no code change made. (If a future report proposes touching `SCAN_TIMEOUT_MS` or adds an injectable timeout to `history-scan.ts`, the regression check for that change is a repeat of this report's own repro script under simulated 2-vCPU contention, before and after.)

## 6. Blast radius & tier
No diff produced by this investigation. Tier: **TRIVIAL** (no code change). Flagged for the record: `src/secret-scan/history-scan.ts` and `.github/workflows/ci.yml` are both CLAUDE.md-named sensitive areas — any future change motivated by this flake (timeout value, CI concurrency, injectable test knobs) is CRITICAL/STANDARD per that policy and needs its named reviewer(s) (`app-security-reviewer` + `cross-domain-reviewer` at minimum) and a fresh dated report before it ships, same as any other change to those areas.

## Next action
None required to merge PR #281 — the failure is unrelated to its diff (comment-only hook changes) and the identical commit already reran green. If this recurs frequently enough to be disruptive, the next action would be to measure actual CI contention (e.g., instrument `matchAllBounded`'s observed elapsed-vs-budget ratio in CI) before deciding whether a proportionate mitigation is warranted — not to preemptively touch the sensitive scan-timeout code on the strength of one occurrence.

---
RECEIPT: verdict=UNREPRODUCIBLE tier=TRIVIAL regressionCheck=n/a adr=HIT(37) report=docs/reviews/oss01-verify-still-matches-debug-2026-09-23.md
