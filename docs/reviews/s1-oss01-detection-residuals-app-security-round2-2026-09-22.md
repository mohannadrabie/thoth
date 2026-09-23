# App Security Review — Round 2 — s1-oss01-detection-residuals

**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-22 (round 2, re-confirm)
**Scope:** branch `fix/s1-oss01-detection-residuals`, HEAD `c453959` (fix-now round on top of round-1 target `39572a2`)
**Tier:** CRITICAL
**Round-1 report:** `docs/reviews/s1-oss01-detection-residuals-app-security-2026-09-22.md` (verdict REWORK, findings 264/265/266)

This round verifies the story-implementer's fix-now round against my three round-1 findings, per the Manager's explicit instructions: re-run my original PoCs against the new commit, and give an honest, non-optimistic read on whether Finding #265 (the intermittent CLI false-pass) is a live production race or transient noise.

## Finding 1 (#264, HIGH) — CONFIRMED FIXED, in isolation

`src/secret-scan/history-scan.ts:212` now hashes `` `${SCAN_TIMEOUT_PATTERN_ID}:${pattern.id}:${text}` `` (the variant's own full scanned text) instead of `text.length`. Re-ran my original round-1 PoC (two 200,000-char blobs, same length, different content) directly against the fixed code:
```
hashA: ed05125fc94c649137b36cdecb59f4c9ed856b78e4dec127c303c08a33ce5313
hashB: c6fc7790c0bc22a79461546ac7a3f1c082aee12ed674fc8f6274ed30a7ff0839
COLLISION (should now be FALSE): false
SAME BLOB re-scanned -> same hash (should be TRUE): true
```
Collision closed, content-addressing restored, idempotence preserved. **In an isolated/deterministic run this is fixed.** See Finding 3 below for a critical caveat under concurrent execution.

## Finding 3 (#266, MED) — CONFIRMED FIXED, in isolation, and the intended cross-encoding unification is preserved

`hashMatchedBytes` now hashes a match's own UTF-16LE code units when it contains any code point above 0xFF, and falls back to the prior latin1 hash otherwise. Re-ran my original round-1 PoC (Armenian-range-disguised value vs. the plain-ASCII `"SuperSecretPW1"` it was built to collide with):
```
disguised matches: [{ id: 'generic-password-assignment', hash: '22b2edd5...' }]
COLLISION with reviewed hash (should now be FALSE): false
```
Collision closed. I also checked the Manager's specific question — does the hybrid hash choice reopen a different inconsistency? I verified the **intended** cross-encoding unification (the #246 design decision the Manager ruled on) is preserved for the case it was designed for: a genuine ASCII value written into a real UTF-16 file (no disguise) still hashes identically to the same value in a plain-ASCII file:
```
genuine UTF-16 (undisguised) hash: 65197b17d631648b8abd378444807dd930a905dbcf984b2eced81cc968f009cc
genuine UTF-16 == reviewed ASCII hash (should be TRUE): true
```
I traced the boundary condition (exactly 0xFF, the latin1 ceiling) and the branch predicate (`[...matched].some(ch => codePoint > 0xff)`, code-point-aware iteration, correctly handles surrogate pairs and unpaired surrogates via `Buffer.from(..., "utf16le")`, which needs no validation and cannot throw). Existing allowlist entries are unaffected: a latin1-decoded variant's text can never contain a code point above 0xFF by construction, so every pre-existing grant's hash is byte-identical under the new hybrid function — no allowlist migration needed. **CLEAN**, no new inconsistency found, in isolation. See Finding 3-continued below.

## Finding 2 (#265, HIGH) and a new, more precise discovery — NOT resolved; my honest read below

### What I did

Per the Manager's instruction, I re-ran my original round-1 reproduction method (`node --test` against the same three touched test files, matching CI's own `npm test` discovery/concurrency shape) as many times as needed for a real signal, against commit `c453959`.

### My original #265 symptom did not recur

Across 11 total multi-file runs of the exact 3-file combination in this round (1 standalone run + a 10-run loop), the specific test `oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another` (my original round-1 finding) **passed every time, 11/11**. I could not reproduce my original symptom this round. This is consistent with (though does not prove) the implementer's own 700+-trial investigation finding no reproduction of that specific assertion's failure.

### But a new, more precise, and more frequent anomaly appeared instead

In the same 11 multi-file runs, **3 runs (27%) failed** — not on my original test, but on the two NEW proof-tests this fix-now round added for Findings 1 and 3 above:
- `oss01-a-scan-timeout-grant-does-not-exempt-a-different-blob-at-the-same-path` (the #264 fix's own proof-test) — failed in 3 of 3 failing runs.
- `oss01-utf16-disguised-match-does-not-collide-with-a-reviewed-ascii-value` (the #266 fix's own proof-test) — failed in 1 of 3 failing runs (alongside the one above).

I pulled the full assertion detail from one failure:
```
AssertionError: the round-1 grant, hashed from blobA's content, must not exempt blobB's own scan-timeout finding
+ actual - expected
+ [
+   { ..., patternId: 'oss01-scan-timeout', redacted: '...[SCAN-TIMEOUT pattern=internal-hostname bytes=200000]',
+     valueSha256: '5255f1b3fa3a7054707bc23849d65257908c528508083a85bed4e1e47f267d15' },
+   { ..., patternId: 'oss01-scan-timeout', redacted: '...[SCAN-TIMEOUT pattern=email-address bytes=200000]',
+     valueSha256: '3ab1f5805267570363315f2bd47e71759df58fba4f4a46cb9c4a36cf7cf85f4c' }
+ ]
- []
```
I directly computed what the **OLD, pre-#264-fix, length-only formula** (`sha256("oss01-scan-timeout:<patternId>:<text.length>")`) produces for the exact same inputs (`text.length === 200000` for both blobA and blobB in this test):
```
OLD internal-hostname: 5255f1b3fa3a7054707bc23849d65257908c528508083a85bed4e1e47f267d15
OLD email-address: 3ab1f5805267570363315f2bd47e71759df58fba4f4a46cb9c4a36cf7cf85f4c
```
**Byte-for-byte identical to the failing run's actual output**, for both patterns simultaneously. I independently confirmed the CURRENT (fixed) code, run in isolation with the exact same blobA/blobB construction, produces the correct, distinct, content-addressed hashes (`ed05125f...` / `2fef9e65...` respectively) — nothing like the failing run's values. I also ran the two new proof-tests in isolation (`--test-name-pattern`, single file, no concurrent siblings) 30 and 27 times respectively: **0 failures in 57 isolated runs.**

### What this means

This is not vague, generic "flakiness." The failing run's `valueSha256` values are an exact, unambiguous match for a **specific, different, already-superseded version of the hashing logic** — as if that one process, for the duration of that one test, executed the pre-fix code despite the file on disk (verified via `git diff`) containing only the fixed version, and despite 57/57 isolated runs of the identical test confirming the fixed version is what's on disk and what normally executes. I checked for an on-disk explanation (a stale compiled artifact, a `dist/` directory, `NODE_COMPILE_CACHE`) and found none — this repo has `noEmit: true`, no `dist/`, and no compile-cache environment variable set. I could not identify the mechanism within this review's scope. It reproduces **only** under concurrent multi-file `node --test` execution (11 multi-file runs, 3 failures; 57 isolated runs, 0 failures) — the same shape that produced my original round-1 #265 symptom, and the same shape CI's plain `npm test` uses.

### My honest assessment, as the Manager asked for directly

I do **not** believe this is transient noise from my original round-1 machine/moment, and I do not think the implementer's negative result closes this. Three reasons:

1. **The failure mode is too precise to be noise.** Generic resource contention produces timing variance (slow tests, occasional real timeouts, subprocess spawn delays) — it does not produce a specific wrong VALUE that happens to exactly equal a different, already-superseded code path's output, for two independent patterns, in the same run. That shape looks like a real, if rare, defect in how this project's own module/process execution behaves under concurrency — not sampling noise.
2. **It is reproducible at a meaningful, roughly consistent rate** (round 1: 1/4 on my original test; round 2: 3/11 ≈ 27% on the new tests) **and only under the exact condition CI itself uses** (multi-file concurrent `node --test`, which is what plain `npm test` does with no file argument). Zero reproductions in 57 isolated single-test runs across two different tests strongly implicates concurrency itself as the trigger, not my machine's noise floor.
3. **It is not the same symptom as #265, but it is the same *class*:** a security-relevant computation (a value-scoped allowlist hash) intermittently produces output consistent with older, less-safe logic, under CI's real execution shape, in a way no isolated or deterministic check catches. Whatever the mechanism, this means **I cannot currently certify that Finding 1 (#264) and Finding 3 (#266) are reliably fixed under the way this repository's own CI actually runs its test suite** — even though both are correctly and completely fixed in the source, and both pass every deterministic/isolated check I ran.

I want to be equally honest about what I did **not** establish: I did not identify the mechanism (my leading candidates — a subprocess/module-loading race, or some V8/Node runtime effect of the `vm.Script` timeout interrupt bleeding into unrelated state under contention — are unconfirmed hypotheses, not findings). I also could not reproduce my *original* #265 CLI-subtest symptom this round (11/11 clean), so I cannot independently corroborate that specific assertion is still broken — only that the same execution shape produces a closely related, more frequent, and more precisely diagnosable anomaly elsewhere in the same file.

### Recommendation

This is a live, open, HIGH-severity blocker, not a disclosed residual to ship with. It should not be closed by further reproduction attempts alone (the implementer already ran hundreds without resolving it, and I could not resolve it either in this round, just characterize it more precisely). The most useful next step is almost certainly a targeted, low-cost instrumentation change — e.g., a self-check at the top of `hashMatchedBytes` (or a one-line source-identity assertion in the suspect tests) that would catch and report the anomaly ITSELF, in whichever process hits it, the moment it happens, rather than only inferring it from a downstream assertion failure. This turns "we can't reproduce it deterministically" into "the next occurrence tells us exactly what code executed and in which process," which is a fundamentally different, tractable debugging problem.

## Untouched from round 1 (per Manager's note, not re-attacked)

`.github/workflows/ci.yml`'s `timeout-minutes: 30` and the `vm.Script` sandbox usage in `matchAllBounded` are byte-identical to round 1 (confirmed: `git diff 39572a2..c453959 -- .github/workflows/ci.yml src/secret-scan/history-scan.ts` shows no hunk touching either). Round-1 CLEAN verdicts stand unchanged. I note, without re-opening either as a finding, that the concurrency anomaly above makes we want to flag one thing for awareness: the `vm.Script` timeout mechanism remains my leading (unconfirmed) hypothesis for the anomaly's mechanism, precisely because it is the one piece of this module that deliberately interrupts in-flight V8 execution via a hard timeout under contention — a category of API with documented edge cases around what state is left behind when the interrupt fires. This is not a new finding against the `vm.Script` usage itself (I found no code-level defect in it, again, this round) — it is context for whoever debugs the anomaly above.

## New round-2 additions verified, not independently re-attacked

`Issue #267` (the `oss01-scan-timeout` unlock command's own fix, `allowlist-tool.ts hashLines`) and `Issue #268` (the negated-class guard generalized to a whole-pattern behavioral sweep) were red-team findings, not mine — I read the diffs, confirmed they are structurally sound and consistent with the rest of the module (both reuse `scanBlobText`/`SECRET_PATTERNS` rather than reimplementing matching logic, so they inherit the same concurrency exposure as everything else in this file, not a new or separate one), and did not re-derive them independently. `cross-domain-reviewer`/`red-team`'s own round-2 passes own the deeper verification of those two.

## Standard checklist (round 2 delta only)

- No new dependency introduced this round (checked `git diff 39572a2..c453959 -- package.json package-lock.json`, empty).
- New test fixtures in this round's diff (`history-scan.test.ts`, `allowlist-tool.test.ts`, `patterns.test.ts`) are all synthetic/runtime-generated (`tag()`/`pad()` helpers, repeated filler characters, Armenian-codepoint-shifted characters) — no real-looking committed secret.
- No access-control, injection, or sensitive-data-exposure surface changed this round beyond what round 1 already covered.

## Verdict

**REWORK — still open.** Findings 1 (#264) and 3 (#266) are fixed correctly at the source level and I confirmed both with direct re-execution of my original PoCs — but this round surfaced direct, reproducible (3/11, 27%) evidence that their own proof-tests intermittently exhibit exactly the pre-fix, insecure hash output under the concurrent execution shape CI actually uses, for reasons neither I nor the implementer have isolated. Finding 2 (#265) did not reproduce this round (0/11) but is superseded in practical terms by the above: the same execution shape produces a more frequent, more precisely diagnosable variant of the same underlying risk category. I cannot responsibly downgrade this to a disclosed residual. My answer to the Manager's direct question: **more likely a genuine, unidentified concurrency-triggered defect than transient noise from my original run** — the exactness of the wrong value (not just wrong timing) is the deciding factor.

## Single next action

Do not ship on the current evidence. Add a lightweight self-check (e.g., assert `hashMatchedBytes` against one hardcoded, known-good input at the top of the two new proof-tests, or log the loaded module's own source text/hash at process start in the suspect tests) so the next occurrence identifies the mechanism directly, rather than running more blind reproduction sweeps — then re-run this same 3-file `node --test` combination until either the self-check fires (mechanism found) or a much larger sample (50+ runs) with zero further reproductions gives real confidence this is closed.

## Addendum — supplementary runs completed after the RECEIPT above was drafted

Two supplementary batches were still running when the RECEIPT's `checks=` line was written; their results, gathered before hand-off:

- **Full `npm test` (the true CI-equivalent invocation, no file arguments, auto-discovers and concurrently runs every test file in the repo, 1061 tests): 3 runs, 3 clean, 0 failures.** This did not reproduce the anomaly. This does not contradict the finding above (a 27% rate on a 3-file subset is not guaranteed to show up in 3 runs of a much larger, differently-scheduled full-suite invocation — the concurrency shape, worker count and scheduling differ from the narrower 3-file case), but it is disclosed here in full rather than omitted, per this project's evidence discipline: I did not get a full-suite reproduction in this round, only a narrower 3-file one.
- **2-file combo (`history-scan.test.ts` + `patterns.test.ts`, dropping `pre-commit-scan.test.ts`): 6 runs, 6 clean, 0 failures.** This is consistent with (but does not prove) the third file, or simply a higher total concurrent process/CPU load, being part of what triggers the anomaly — I did not narrow this further within this round's time budget.

Net effect on my verdict: **unchanged.** The anomaly is demonstrated (3/11 on the exact 3-file combination, with byte-exact evidence), even though it did not additionally reproduce in these 9 supplementary runs across two different invocation shapes. A defect that reproduces at roughly 1-in-4 under one specific concurrency shape and not (yet) under two related but different shapes is still a live, unresolved, demonstrated defect — the absence of failures in 9 more runs under different conditions narrows the trigger condition, it does not clear the finding. Updated checks line: `on isolation: 57/0/0 | on the exact 3-file combo: 11 runs, 3 failed | full npm test: 3/3 clean | 2-file subset: 6/6 clean`.

---

RECEIPT: verdict=REWORK
findings (ranked by exploitability x impact):
1. [ISSUE][HIGH][demonstrated] Concurrency-triggered anomaly (new discovery, round 2): under CI's own multi-file `node --test` execution shape, the #264 and #266 fix proof-tests (src/secret-scan/history-scan.test.ts, both added this round) intermittently produce valueSha256 output byte-identical to the OLD, pre-fix hashing formula -- 3 of 11 multi-file runs failed, 0 of 57 isolated runs failed. Root cause not isolated by either this reviewer or the implementer's own 700+ trials. Recommendation: add a source/behavior self-check to the suspect code path before the next reproduction attempt, do not ship on current evidence.
2. [ISSUE][HIGH][demonstrated] Original #265 (round-1 finding, GitHub #265) -- did not reproduce this round (0/11 multi-file runs of the exact original test), consistent with but not proof of the implementer's own negative result. Superseded in practical terms by finding 1 above (same execution shape, same risk category, more frequent and more precisely diagnosed). Left OPEN, not downgraded, pending the same investigation.
3. [CLEAN][demonstrated] #264 fix (src/secret-scan/history-scan.ts:212) -- re-ran the original two-200KB-blob PoC directly against c453959: collision closed, hashes now content-derived and distinct, idempotent on re-scan of the same blob. Correct at the source level, in isolation.
4. [CLEAN][demonstrated] #266 fix (hashMatchedBytes hybrid latin1/utf16le encoding) -- re-ran the original Armenian-glyph-disguise PoC: collision closed. Also confirmed the intended #246 cross-encoding unification (genuine ASCII value in a real UTF-16 file still hashes identically to the plain-ASCII form) is preserved, and existing allowlist entries are unaffected (latin1-variant text can never contain a code point above 0xFF, so the new branch is unreachable for every pre-existing grant). Correct at the source level, in isolation.
5. [CLEAN][code-traced] .github/workflows/ci.yml timeout-minutes and vm.Script usage in matchAllBounded are byte-identical to round 1 (confirmed via diff); round-1 CLEAN verdicts stand.
6. [CLEAN][code-traced] No new dependency this round; new test fixtures (#267/#268 red-team fixes' own tests) are synthetic, no committed secret.
counts (checksum): issues=2 suspicions=0 clean=4
evidence (checksum): demonstrated=4 code-traced=2
checks="isolation: 57/0/0 across two new proof-tests (30+27 runs) plus original #265 test 11/11, all clean|exact 3-file combo (matches original round-1 repro): 11 runs, 3 failed (4 individual test failures) -- see Finding 1/2|full npm test (true CI shape, 1061 tests): 3/3 clean|2-file subset (history-scan+patterns only): 6/6 clean"
adr=HIT(37, reused from round 1, no new ADR read required)
report=docs/reviews/s1-oss01-detection-residuals-app-security-round2-2026-09-22.md
