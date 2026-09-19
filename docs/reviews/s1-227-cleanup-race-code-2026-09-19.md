# Code review — s1-227-cleanup-race (GitHub Issue #227) — 2026-09-19

[code-reviewer]
Code Reviewer (Anubis) — reviewing for correctness & user-facing trust

HEAD: 3f94d1d4076e53a007c50185353a3ad7de0dfbe5 (branch fix/s1-227-cleanup-race; base origin/master f10ae2d)
Scope: s1-227-cleanup-race · Tier: STANDARD (ratified, not re-litigated) · Area: Secret scanning (named-reviewer pick)
Reviewed: `git diff origin/master...HEAD` (b575225 state/plan, 6b1ab75 build, 3f94d1d plan-citation reword), Issue #227, plan + Manager-rulings addendum.

## ADR compliance

`📊 ADR cache BUILT: cataloged 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1], catalog now current (fp 5dba384) [CACHE=HIT]`

Slice read (code / testing / error-handling / maintainability): SE ADR-0003 (quality), SE ADR-0005 (testing), SE ADR-0010 (quality/process). ADR-0021 and THOTH-ADR-0001 (`code`) concern the kernel and the central-classification fixture, not this diff. No blocker.

| ADR rule | Verdict |
|---|---|
| 0005 "MUST NOT delete or weaken a failing test" | Met: no assert/test line added or removed (section 1). |
| 0005 "MUST NOT use arbitrary sleeps" | Met: `retryDelay` is rm own bounded retry inside cleanup, not test synchronization. |
| 0010 "MUST NOT delete tests / do not scope-creep" | Met: same 13 tests; sibling sites deferred to Issue #231. |
| 0003 "SHOULD NOT over-abstract" | Met: inline 3-line helper. |

## Scorecard

| Axis | Grade |
|---|---|
| Correctness vs story | SOLID — every cleanup site routed; race hardened; assertions untouched |
| Idempotency / re-runs | SOLID — `force:true` makes re-delete of a missing path a no-op |
| Inputs / edge cases | SOLID (one LOW note: persistent-failure latency, finding 1) |
| Error handling | SOLID — no catch; exhausted retries reject with the original ENOTEMPTY |
| Verification quality | GAPS-by-design — no permanent test for the race or R2 (Manager veto of D1; stand-in is measurement, re-run here) |
| Maintainability | SOLID — one helper, one comment |

## Raw evidence

### 1. R3 — same 13 tests, no assertion touched
```
$ node --test src/secret-scan/pre-commit-scan.test.ts
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 24865.3271

$ git diff -U0 origin/master...HEAD -- src/secret-scan/pre-commit-scan.test.ts | grep -E "^[+-].*(assert|test\()"
(no output)  exit=1
$ grep -c "^test(":  HEAD file = 13 ; origin/master file = 13
$ grep -nE "\.skip|\.todo|skip:" src/secret-scan/pre-commit-scan.test.ts   -> no match (exit 1)
```
The 25 changed +/- lines are: the helper plus its comment (9 added), six `rm(` -> `removeTree(` swaps, and the 2-line comment plus `-c` args on the noprepare clone.

### 2. Node semantics of `rm` `maxRetries` (the load-bearing claim)
Read from Node source at the two tags in play (fetched with `gh api repos/nodejs/node/contents/...?ref=<tag>`):
```
v22.18.0 lib/internal/fs/promises.js:806   async function rm(path, options) { ... return lazyRimRaf()(path, options); }
v24.15.0 lib/internal/fs/promises.js:807   (identical)
v22.18.0 lib/internal/fs/rimraf.js:35-36   const retryErrorCodes = new SafeSet([EBUSY, EMFILE, ENFILE, ENOTEMPTY, EPERM]);
v22.18.0 lib/internal/fs/rimraf.js:48-51   if (retryErrorCodes.has(err.code) && retries < options.maxRetries) { retries++; const delay = retries * options.retryDelay; return setTimeout(_rimraf, ...) }
v24.15.0 rimraf.js:28-29,40-43             (identical)
rimraf.js (both): the only error rewritten to success is ENOENT ("The file is already gone.")
```
So ENOTEMPTY IS retried by `maxRetries` in `fs.promises.rm` on Node 22.18.0 and 24.15.0; backoff is linear (100, 200, 300, 400, 500 ms); after `maxRetries` the error goes to the caller. `force:true` only suppresses ENOENT.

Behavioral confirmation (deterministic persistent failure: `fs.rmdir` patched before the first `rm` call, because rimraf binds `fs.rmdir` lazily; the stuck dir always answers ENOTEMPTY), run on BOTH versions:
```
v24.15.0 bare     rmdir attempts on stuck dir: 2  | rejected: true ENOTEMPTY | elapsed_ms: 1
v24.15.0 shipped  rmdir attempts on stuck dir: 72 | rejected: true ENOTEMPTY | elapsed_ms: 10831
v22.18.0 bare     rmdir attempts on stuck dir: 2  | rejected: true ENOTEMPTY | elapsed_ms: 2
v22.18.0 shipped  rmdir attempts on stuck dir: 72 | rejected: true ENOTEMPTY | elapsed_ms: 10783
```
ENOTEMPTY is retried (72 attempts vs 2) and a persistent one still rejects with ENOTEMPTY, not swallowed, on the CI Node version (22.18.0, via `npx -y node@22.18.0`) and locally.

Independent concurrent-writer injection (same-process writer recreating files in a `.git/objects/info/commit-graphs`-shaped tree; 40 trials each; Windows, Node 24.15.0; harness lived in the session scratchpad, not committed):
```
bare      bounded writer n=50     34/40 rejected {"ENOTEMPTY":34}
shipped   bounded writer n=50      0/40 rejected {}
bare      bounded writer n=200    32/40 rejected {"ENOTEMPTY":32}
shipped   bounded writer n=200     0/40 rejected {}
bare      bounded writer n=500    34/40 rejected {"ENOTEMPTY":34}
shipped   bounded writer n=500     0/40 rejected {}
```
Reproduces the planner numbers (32-35/40 bare, 0/40 shipped). The Linux race itself is not reproduced (not demanded).

### 3. `git clone -c ... --local -q` validity, persistence, no hooksPath interaction
```
clone exit=0   (git clone -c gc.auto=0 -c maintenance.auto=false --local -q <project> <dir>)
default clone:  gc.auto (exit 1, unset)  maintenance.auto (exit 1, unset)  core.hooksPath (exit 1, unset)
-c clone:       gc.auto = 0   maintenance.auto = false   core.hooksPath (exit 1, unset)
                file:.git/config  gc.auto 0 ; file:.git/config  maintenance.auto false
GIT_TRACE=1 git commit (successful) in default clone:
  trace: run_command: git maintenance run --auto --quiet --detach     <- spawned
GIT_TRACE=1 git commit (successful) in -c clone:
  (no maintenance line; grep exit 1)
GIT_TRACE=1 git commit refused by the hook (core.hooksPath=.githooks, secret canary), default clone:
  commit exit=1 ; count of "maintenance run" lines = 0     <- first R4 test correctly left alone
```
Both keys land in the clone own `.git/config` (option order `-c ... --local` is valid), so the later `git commit` sees them. `core.hooksPath` stays unset in the noprepare clone, so the test still proves what its title says.

### 4. Cleanup-site coverage (running instruments)
```
$ grep -nE "\b(rm|rmSync|rmdir|rmdirSync)\s*\(" src/secret-scan/pre-commit-scan.test.ts
19:  return rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

$ grep -nE "unlink|rmdir|fs\.rm|rimraf|import .*node:fs|import .*fs|mkdtemp|tmpdir|removeTree|finally|after\(|afterEach|cleanup|Cleanup" src/secret-scan/pre-commit-scan.test.ts
3:import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
4:import { tmpdir } from "node:os";
13:// Temp-dir cleanup ...   18:function removeTree ...
33:  const repoDir = await mkdtemp(...)     42:  } finally {   43: await removeTree(repoDir);
201: mkdtemp   203: removeTree   226: } finally {  227: removeTree
232: mkdtemp   234: removeTree   249: } finally {  250: removeTree
270: mkdtemp   282: } finally {  283: removeTree
```
4 `mkdtemp` calls, 6 `removeTree` calls (43, 203, 227, 234, 250, 283), 1 `rm(` (inside the helper). No `unlink`, `rmdir`, `rimraf`, second fs import, `after`/`afterEach` hook, or cleanup inside another helper. `rm` is imported once, from `node:fs/promises`, and used only in `removeTree`.

### 5. Scope
```
$ git diff --stat origin/master...HEAD
 CHANGELOG.md                                        |   14 +
 docs/.maat-state.json                               | 1513 ++++++++++----------  (CRLF churn; with -w --ignore-cr-at-eol: 11 real lines, Manager state)
 docs/plans/S1-227-cleanup-race-phase1-2026-09-19.md |  122 ++
 docs/run-log.jsonl                                  |    1 +
 src/secret-scan/pre-commit-scan.test.ts             |   25 +-
$ git diff --name-only origin/master...HEAD | grep -E "ci\.yml|secret-scan-allowlist|src/lib/git\.ts|pre-commit-scan\.ts$|backlog\.md|CLAUDE\.md"
(no output) exit=1
```
None of the forbidden files is named; no other test file changed.

### 6. Gates
```
npm run typecheck  -> exit 0
npm run lint       -> exit 0
npm test           -> ℹ tests 885 / pass 885 / fail 0 / cancelled 0 / skipped 0 / todo 0   (duration 63.8s)
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
```
Matches the build claim (885 / 0 / 0). QA-14 red is Issue #229, untouched by this diff.

## Findings (ranked by user-trust impact x exposure x irreversibility x silence)

**1. [ISSUE][LOW][demonstrated] Time-to-fail on a PERSISTENT cleanup failure is superlinear in tree depth — `src/secret-scan/pre-commit-scan.test.ts:19`.**
- Evidence: Node `maxRetries` wraps every level of the recursion (`rimraf.js` `_rmchildren` calls the retrying `rimraf` for each child; a child failure propagates to the parent wrapper, which retries the whole subtree again). Measured with a permanently-ENOTEMPTY dir, shipped options, Node 24.15.0:
```
wrappers=1 rejected=true ENOTEMPTY attempts=12  elapsed_ms=1541  predicted_ms=1500
wrappers=2 rejected=true ENOTEMPTY attempts=72  elapsed_ms=10782 predicted_ms=10500
wrappers=3 rejected=true ENOTEMPTY attempts=432 elapsed_ms=66154 predicted_ms=64500
```
  These fit T(k) = 6*T(k-1) + 1500 ms. The failing path in the Issue, `<cloneDir>/.git/objects/info/commit-graphs`, is 5 levels: extrapolated about 2.3M ms, roughly 39 minutes, before the original ENOTEMPTY surfaces (extrapolation is derived from the measured recurrence, not run). `.github/workflows/ci.yml` sets no `timeout-minutes` (grep exit 1), so the platform default applies.
- User action -> wrong result: a maintainer whose CI hits a genuinely stuck directory sees the Test step hang for tens of minutes and then fail, rather than failing in about 2 s with ENOTEMPTY. It stays loud (rejects, never swallowed), only late.
- Exposure: ~unknown% of runs; only under a persistent (not transient) cleanup failure; basis: assumption (none observed; the one CI event was transient by the fix premise). Capped at LOW; the transient race in the Issue resolves at the innermost level at no extra cost (0/40 above).
- Minimal fix (optional, non-blocking): state it in the PR/CHANGELOG ("a persistent failure still fails, after nested retries: minutes, not seconds"); for a hard bound instead, replace the option literal with a 3-line loop that calls plain `rm` up to 5 times with a sleep and rethrows the last error. Under the Manager D1 veto this has no permanent test; record as a residual-register line.
- Failing test that would pin it: none under the veto (open findings 1 / failing tests 0; the gap is the deliberate veto of permanent tests).

**2. [CLEAN][demonstrated] R3: 13 tests, 0 skipped, no assertion or test line added/removed** — section 1.

**3. [CLEAN][demonstrated] Load-bearing claim holds: ENOTEMPTY is retried by `fs.promises.rm` `maxRetries` on Node 22.18.0 and 24.15.0, and exhaustion rejects, not swallows** — Node source lines quoted plus deterministic injection on both versions (section 2).

**4. [CLEAN][demonstrated] The fix works under injection: bare 34/32/34 of 40 fail vs shipped 0/0/0 of 40** — independent re-run reproduces the planner measurement (section 2).

**5. [CLEAN][demonstrated] R2 is valid, persists, and is correctly scoped** — `-c` before `--local` clones fine, both keys land in the clone `.git/config`, `core.hooksPath` unaffected, maintenance spawn present in a default clone and absent in the `-c` clone, a hook-refused commit never spawns maintenance so the first R4 test is rightly left alone (section 3).

**6. [CLEAN][demonstrated] Every cleanup site is covered** — 6 `removeTree` calls over 4 `mkdtemp` dirs, exactly one `rm(` (in the helper), no other cleanup path in the file (section 4).

**7. [CLEAN][demonstrated] Scope clean and gates green** — no forbidden file named; typecheck 0, lint 0, `npm test` 885/0/0, QA-15 PASS (sections 5, 6).

## Missing checks by name

- No permanent test pins (a) that `removeTree` keeps `maxRetries`, (b) that it has no catch, (c) that the noprepare clone carries `gc.auto=0` / `maintenance.auto=false`. Mentally mutating: dropping `maxRetries`, adding a catch, or deleting the two `-c` args leaves all 13 tests green. This is the Manager ruled trade-off (D1 vetoed, plan addendum) for a roughly 1-in-40, test-only flake, with the evidence recorded (planner S1-S3 and this report sections 2-3). Named so the toothlessness is on the record, not as a demand.

## Editorial (verdict-neutral; fix as plain edits, no re-review)

- CHANGELOG heading "no longer flakes on temp-dir cleanup" states an outcome the evidence cannot show (the Linux race is not reproduced; base rate 1 event in 40 runs). The body labels the cause "inferred" correctly; the heading reads stronger. Suggest "hardened against" or "should no longer flake".
- CHANGELOG says "raw counts in the PR" and "the evidence is recorded in the PR"; no PR exists yet. The raw counts currently live in the plan S2 row and in this report; point there, or open the PR with them before merge.
- CHANGELOG "Only the test that makes a successful commit in a clone of the real repo does this" is accurate as to the measured trigger (section 3), but the isolated-repo tests also make successful commits; they are covered by the retry, not by R2. One clause would stop a reader inferring they are immune.
- `docs/.maat-state.json` shows 1513 changed lines but 11 real ones (CRLF churn). Manager-owned; noted only. Also: running the mandated `node docs/adr-cache.mjs --ensure` left `docs/.maat-state.json` modified in the working tree (ADR cache rebuilt); the reviewer did not edit it and did not commit it.

## Verdict: SHIP

One LOW residual (finding 1), no blocker, no ADR violation. Every item in the review focus was verified by running something.

## Praised decision

Routing all six sites (including the empty-directory one at old line 194) through one helper with deliberately no catch, and pairing it with cause-removal (`-c gc.auto=0 -c maintenance.auto=false`) on only the one clone that makes a successful commit: the fix removes the writer where it is proven and retries where it is merely possible, while every persistent failure stays loud. The Manager veto kept it three lines.

## Single next action

Manager: commit this report and the REVIEW_LOG row, apply the CHANGELOG editorial edits if wanted, run `cross-domain-reviewer`, then hand off for the human push/PR (`Closes #227`).

RECEIPT: verdict=SHIP
findings:
1. [ISSUE][LOW][demonstrated] src/secret-scan/pre-commit-scan.test.ts:19 — Node maxRetries nests per tree level; persistent failure takes 1.5s/10.8s/66s at 1/2/3 levels (~39 min extrapolated at the real 5-level path; ci.yml has no timeout-minutes); still rejects, only late; optional fix: note it in PR or use a flat 5-try loop; exposure basis assumption
2. [CLEAN][demonstrated] R3 holds: 13 tests / 0 skipped, no assert or test line added or removed
3. [CLEAN][demonstrated] ENOTEMPTY is retried by fs.promises.rm maxRetries on Node 22.18.0 and 24.15.0 (source + injection) and exhaustion rejects with ENOTEMPTY (no swallow)
4. [CLEAN][demonstrated] Independent injection: bare 34/32/34 of 40 fail vs shipped 0/40 in all three writer sizes
5. [CLEAN][demonstrated] git clone -c gc.auto=0 -c maintenance.auto=false valid, both keys persist, hooksPath unaffected, maintenance spawn absent; refused-commit test correctly untouched
6. [CLEAN][demonstrated] All cleanup sites covered: 6 removeTree over 4 mkdtemp, one rm call (in the helper), no other cleanup path in the file
7. [CLEAN][demonstrated] Scope clean (no ci.yml/allowlist/git.ts/pre-commit-scan.ts/backlog/other tests); typecheck 0, lint 0, npm test 885/0/0, QA-15 PASS
counts: issues=1 suspicions=0 clean=6
evidence: demonstrated=7 code-traced=0 derived=0
checks="885/0/0"
adr=HIT(3)
report=docs/reviews/s1-227-cleanup-race-code-2026-09-19.md
