# App Security Re-confirmation — S1 "protect the baseline" (Stage 3 fix-pass)

**Reviewer:** app-security-reviewer (Horus)
**Subject:** commit `366c54d` (local, unpushed), diff from `2992bfb`, repo `mohannadrabie/thoth`
**Prior report:** `docs/reviews/s1-protect-baseline-app-security-2026-08-30.md` (verdict REWORK — 1 HIGH, 2 LOW)
**Tier:** STANDARD (ratified `docs/decisions.md` 2026-08-30)
**Type:** re-confirmation pass, not a fresh full review
**Date:** 2026-08-30

## ADR compliance

`node docs/adr-cache.mjs --ensure` -> ADR cache HIT, reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp be365e4, CACHE=HIT.

Same applicable ADRs as the prior report (SE-0009, SE-0010, SE-0021, devops-0009, devops-0008), re-read from the cached catalog, not re-derived. This diff introduces no new dependency, no new logging, no new IaC/secrets surface, and no AGT import, so none of these ADRs are newly implicated. No violation found.

## Method

- `git show 366c54d --stat` and `git diff 2992bfb 366c54d` for the full 13-file diff (301 insertions, 45 deletions).
- Read the actual current `src/qa/completeness-claim-checker.ts` diff in full: the `KNOWN_INSTRUMENTS` allowlist, the rewritten `verifyMarkerClaim`, and the new regression tests in `completeness-claim-checker.test.ts`.
- Re-ran the original demonstrated payload (`cmd="node <payload.js>"`, a `writeFileSync` proof write) against the fixed code, live, in an isolated scratchpad, same technique as the original finding.
- Additionally probed a class of bug the fix's plain-object-lookup shape invites (`cmd="__proto__"`, `cmd="constructor"`) to check whether an attacker could reach a truthy-but-unintended `KNOWN_INSTRUMENTS[...]` entry and smuggle a real command through, demonstrated, not assumed.
- Read the `reference-resolver.ts` diff (`resolveWithinRepo`) and its new regression test; traced the containment check by hand against both an escaping and a non-escaping input.
- Verified all three pinned Actions SHAs against the GitHub API directly (`gh api repos/OWNER/REPO/commits/SHA` and the matching `git/refs/tags/TAG` endpoint), confirming each SHA is the exact commit GitHub itself tags as the claimed version, not just "looks like a SHA".
- Read the `src/lib/git.ts` (`resolveChangedFiles`/`isZeroSha`) and `diff-fixture-check.ts` diff hunks (the QA-18/cross-domain fix bundled into the same commit) far enough to confirm no new injection surface: `run()` still passes args as an array to `execFile`, never a shell string, and `base`/`head` are still GitHub-supplied commit SHAs, consistent with the prior CLEAN finding on `ci.yml`'s injection surface. This is cross-domain-reviewer's primary finding, not re-litigated here beyond the security spot-check.
- Independently ran `npm run typecheck`, `npm run lint`, `npm test` myself, raw output below.
- Checked GitHub Issues #57 and #18 (`gh issue view`), both closed, matching the commit message's claim.

## Findings

### 1. [CLEAN][code-traced][demonstrated] HIGH finding (Issue #57) is genuinely fixed, not cosmetic

`src/qa/completeness-claim-checker.ts:34-52` now defines a fixed, code-owned `KNOWN_INSTRUMENTS` allowlist (`Object.freeze`d, 7 entries), each mapping a symbolic name to a hardcoded `{cmd, args}` pair pointing at this repo's own real QA scripts. `verifyMarkerClaim` (around lines 107-119) no longer splits `claim.cmd` into a shell command; it looks the name up in `KNOWN_INSTRUMENTS` and only ever passes the allowlist entry's own fixed `instrument.cmd`/`instrument.args` to `runner()`. There is no remaining code path where attacker-controlled marker text reaches `execFile`: the only string derived from parsed prose is used as an object-key lookup, never as the executed command or its arguments.

Re-attempted the original demonstrated payload against the fixed code, live:

```
$ cat fake-STATE2.md
Progress: [[completeness: cmd="node <tmp>/payload.js" expect=0]]
$ node --experimental-strip-types src/qa/completeness-claim-checker.ts fake-STATE2.md
[QA-15 completeness-claim-checker] FAIL: 1 of 1 file(s) had a failing completeness claim.
  -   MISMATCH: instrument name "node <tmp>/payload.js" is not on the fixed completeness-instrument
      allowlist, never executed ([[completeness: cmd="node <tmp>/payload.js" expect=0]])
$ ls <tmp>/   # payload.js and fake-STATE2.md only, no proof.txt written
$ cat <tmp>/proof.txt
cat: proof.txt: No such file or directory
```

No proof file was written, the runner was never invoked. This matches the new regression test's own assertion shape: `completeness-claim-checker.test.ts`'s `spyRunnerThatMustNotBeCalled()` (added in this diff) proves the runner receives zero calls for a disallowed `cmd=`, for both the original payload shape and a shell-metacharacter-laden one (`"rm -rf / ; curl evil.example"`), both tests pass as part of the 89/89 suite run below.

**Additional probe, plain-object-lookup edge case (not in the original finding, checked for completeness):** `KNOWN_INSTRUMENTS[claim.cmd]` is a plain-object index, so `claim.cmd = "__proto__"` or `"constructor"` resolves to a truthy `Object.prototype`/`Object` value rather than `undefined`, meaning the `if (!instrument)` fail-closed check does not catch these two names by that message path. Demonstrated live:

```
$ echo 'Progress: [[completeness: cmd="__proto__" expect=0]]' > proto-STATE.md
$ node --experimental-strip-types src/qa/completeness-claim-checker.ts proto-STATE.md
MISMATCH: instrument "__proto__" produced no parseable number in its output
```

Traced why this is still safe rather than exploitable: `instrument.cmd`/`instrument.args` on `Object.prototype`/`Object` are `undefined`, so `runner(undefined, undefined, ...)` is called. `src/lib/exec.ts:42-61`'s `realRunner` wraps `execFileAsync` in try/catch; Node's `child_process.execFile` synchronously throws `ERR_INVALID_ARG_TYPE` for a non-string `file` argument, `util.promisify` converts that synchronous throw into a promise rejection, and `realRunner`'s catch converts that rejection into `{stdout: "", stderr: ..., code: 1}`, so `lastInteger("")` is `null` and the claim fails closed with a different message ("produced no parseable number") but the same outcome: no command runs, `ok: false`. No RCE achieved via this path.

This is real, not cosmetic. The fix closes the exact demonstrated gadget from the prior report, and the one adjacent edge case found is also fail-closed today, just by relying on `execFile`'s own argument validation rather than an explicit guard on the lookup. See Finding 4 (hardening, non-blocking) below.

**Exposure (residual):** 0% today, no reachable path from marker text to command execution was found, demonstrated against both the direct payload and the object-lookup edge case.

Issue #57 (severity:high) is CLOSED, verified via `gh issue view 57`. Confirmed correctly closed.

### 2. [CLEAN][code-traced] LOW, CI Actions pinning is genuinely to real, verified commit SHAs

`.github/workflows/ci.yml:23,32,91` now pin:
- `actions/checkout@11d5960a326750d5838078e36cf38b85af677262` (# v4.4.0)
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (# v4.4.0)
- `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` (# v4.6.2)

Verified independently against the GitHub API, not trusting the comment: for each action, `gh api repos/OWNER/REPO/commits/SHA` resolves the SHA to a real commit, and `gh api repos/OWNER/REPO/git/refs/tags/CLAIMED-VERSION` resolves the tag itself to the identical SHA. All three pins are exact matches to the GitHub-published tag for the exact version claimed in the trailing comment, not merely SHA-shaped strings.

### 3. [CLEAN][code-traced] LOW/SUSPICION, path containment fix is real and the regression test is non-tautological

`src/qa/reference-resolver.ts` (`resolveWithinRepo`, around lines 103-116) resolves both `repoRoot` and the candidate path, then rejects (`return null`) unless the resolved path equals `resolvedRoot` exactly or starts with `resolvedRoot + sep`, a real prefix-containment check, not a substring check (avoids the classic `/repo` vs `/repo-evil` false-accept bug by appending the separator before comparing). `pathExists` and `lineCount` (around lines 257-269) both now route through `resolveWithinRepo` first and return false/null on rejection, before ever calling `existsSync`/`readFileSync`. Traced the full call chain, confirmed no other path in the file bypasses this and calls `existsSync`/`readFileSync` directly on an unresolved citation.

The new regression test (`reference-resolver.test.ts` around lines 154-171) is not tautological: it calls the real exported `resolveWithinRepo` function against concrete escaping inputs (`"../../etc/passwd"`, `"../../../secrets/config.json"`) and asserts `null`, AND asserts a well-formed contained path (`"docs/STATE.md"`, `"."`) still resolves normally. A test that only checked the escaping case could pass by accident if the function always returned `null`; this test would catch that regression. This test executed as part of the 89/89 suite below, not run in isolation only.

### 4. [SUSPICION][LOW][demonstrated] Hardening: KNOWN_INSTRUMENTS plain-object lookup relies on execFile's own argument validation, not an explicit key guard

Per Finding 1's probe above: `claim.cmd` values that collide with `Object.prototype` members (`__proto__`, `constructor`, `toString`, `hasOwnProperty`, etc.) pass the `if (!instrument)` check (the prototype member is truthy) and fall through to `runner(undefined, undefined, ...)`. Today this fails safely only because `execFile` synchronously rejects a non-string command and `realRunner`'s try/catch absorbs that into a normal `ok:false` result, a coincidental, not designed, safety net. If `verifyMarkerClaim`'s runner were ever swapped for one that shell-interprets its first argument, or that coerces `undefined` to the string `"undefined"` and looks that up as a file/PATH entry, this specific class of input could behave differently than intended. No exploit exists today, demonstrated above; this is a robustness nit, not a live gap.

**Minimal fix (optional, non-blocking):** guard the lookup with `Object.prototype.hasOwnProperty.call(KNOWN_INSTRUMENTS, claim.cmd)` (or build the allowlist with `Object.create(null)`) before treating the result as present, so the fail-closed path is explicit rather than incidental.

### 5. [CLEAN][code-traced] Bundled QA-18/cross-domain fix (src/lib/git.ts, diff-fixture-check.ts) introduces no new injection surface

Spot-checked per this task's scope note (spot-check only if diff touches previously-CLEAN areas), since this diff touches `ci.yml`'s consumer code. `resolveChangedFiles` (`git.ts`, around lines 52-64) and its callers still source `base`/`head` from `process.argv`/`QA02_HEAD_REF`/`QA14_HEAD_REF` env vars ultimately populated by `ci.yml`'s `steps.diff-refs.outputs.base`/`.head`, themselves derived from `github.event.pull_request.base.sha`/`.head.sha`/`github.sha` (commit SHAs), consistent with the prior report's Finding 6 (no PR title/body/branch text interpolated anywhere). `run()` (`git.ts`, around lines 67-73) still passes `args` as an array straight to the injectable `Runner`, never a concatenated shell string. No new shell/eval/deserialization surface. This is primarily cross-domain-reviewer's finding to own; noted here only to confirm it does not reopen anything in my domain.

### 6. [CLEAN][demonstrated] Verification suite, real counts, independently run

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(exit 0, no output)

$ npm run lint
> eslint .
(exit 0, no output)

$ npm test 2>&1 | tail -8
tests 89
suites 0
pass 89
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 9780.6451
```

Matches the commit message's claimed 89/89 (80 prior + 9 new), 0 failed, 0 skipped. Independently confirmed, not taken on the commit message's word.

## Verdict

**APPROVE.**

Both open findings from the prior REWORK verdict are genuinely closed:
- The HIGH (Issue #57, arbitrary command execution) is fixed at the root: `cmd=` is now purely a lookup key into a fixed, code-owned allowlist, never executed text. Re-attempted the exact original payload; it is rejected, and the runner is never invoked (confirmed live, not just re-read). An adjacent edge case (prototype-collision keys) was probed and found to already fail closed today, for reasons traced in Finding 4, flagged as non-blocking hardening, not a live gap.
- The two LOWs are both genuinely closed: Actions are pinned to commit SHAs independently verified against GitHub's own API to match the claimed release tags exactly, and `reference-resolver.ts`'s path-containment check is a real prefix check wired in front of every filesystem touch, backed by a non-tautological regression test.

Nothing in this diff reopens or touches the areas already found CLEAN in the prior report (secret-scan redaction, allowlist mechanism, dependency audit, library bug fixes, no-AGT-import), confirmed via `git diff 2992bfb 366c54d`'s file list, none of which overlap those areas except `ci.yml` (Actions pinning, already re-verified) and the git/diff-fixture-check pairing (spot-checked in Finding 5, clean).

`npm run typecheck`, `npm run lint`, and `npm test` were run independently by this reviewer, not taken from the commit message: 89/89 tests pass, 0 skipped, typecheck and lint both clean.

**Findings-to-tests mapping:** the one open non-blocking item (Finding 4) has no failing test to name because it demonstrates no defect, it is a hardening suggestion for defense-in-depth, backed by a passing (not failing) demonstration that the current behavior is already safe. Per PRINCIPLES rule 19, only a derived-capped or unconfirmed finding requires a named failing test as its resolution path; this finding is demonstrated to be currently non-exploitable, so no failing test exists to write, the optional hardening fix in Finding 4 is a code-quality improvement, not a defect closure.

open findings = 1 (0 blocking, 1 non-blocking hardening suggestion); failing tests = 0, no gap: the one open item is a robustness improvement demonstrated to be currently safe, not a defect with a red test to point at.

## Next action

None required to ship, S1's app-security scope is clear. Optional, non-blocking: apply Finding 4's hasOwnProperty guard to KNOWN_INSTRUMENTS lookup in a future pass for defense-in-depth (not worth a dedicated Issue at LOW severity per this project's Issue-filing threshold).

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][code-traced][demonstrated] src/qa/completeness-claim-checker.ts:34-119 -- Issue #57 HIGH RCE gadget genuinely fixed: cmd= resolves only against fixed KNOWN_INSTRUMENTS allowlist, original payload re-attempted live and rejected with runner never invoked (no proof file written); Issue #57 closed.
2. [CLEAN][code-traced] .github/workflows/ci.yml:23,32,91 -- actions/checkout, setup-node, upload-artifact pinned to commit SHAs independently verified via GitHub API to be the exact commits tagged v4.4.0/v4.4.0/v4.6.2.
3. [CLEAN][code-traced] src/qa/reference-resolver.ts:103-116,257-269 -- resolveWithinRepo is a real prefix-containment check wired in front of every existsSync/readFileSync call; new regression test exercises both escaping and non-escaping inputs, not tautological.
4. [SUSPICION][LOW][demonstrated] src/qa/completeness-claim-checker.ts:107 -- KNOWN_INSTRUMENTS[claim.cmd] plain-object lookup lets __proto__/constructor-shaped cmd= reach a truthy-but-empty instrument object; demonstrated currently safe only because execFile's own sync arg validation + realRunner's try/catch absorb the undefined cmd, not an explicit guard; optional hasOwnProperty guard recommended, non-blocking.
5. [CLEAN][code-traced] src/lib/git.ts resolveChangedFiles/run() + diff-fixture-check.ts -- QA-18 fix bundled into this commit introduces no new injection surface: base/head still GitHub-supplied SHAs, args still passed as array to execFile, never shell-concatenated.
6. [CLEAN][demonstrated] npm run typecheck (clean) + npm run lint (clean) + npm test (89/89 pass, 0 failed, 0 skipped) -- independently run, matches commit message's claimed counts.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=0 suspicions=1 clean=5
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=3 code-traced=5 derived=0
checks="89/0/0 (npm test) + typecheck clean + lint clean|n/a"
adr=HIT(35)
report=docs/reviews/s1-protect-baseline-app-security-reconfirm-2026-08-30.md
