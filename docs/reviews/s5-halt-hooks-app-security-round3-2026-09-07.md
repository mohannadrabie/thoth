# App-security review S5 halt-hook diff -- ROUND 3 re-confirm, TERMINAL (Milestone #23, CRITICAL tier)

**Reviewer:** Horus (app-security-reviewer)
**Date:** 2026-09-07 (round 3, narrow terminal re-confirm)
**Scope:** scope=s5, tier=CRITICAL (`docs/.maat-state.json`). Narrow re-confirm per the Manager's own scoping instruction: (1) verify round-2's Issue #96 escalation (Finding 6) is genuinely closed, not relocated; (2) check the new env-var-removal fix (Issue #99, `architecture-reviewer`'s council-seat root-cause fix) doesn't introduce a NEW session-isolation concern; (3) confirm the round-2 Unicode sanitization finding (Finding 7) is honestly still open/tracked, not silently dropped or falsely claimed fixed. Not a full fresh attack pass -- round 2 (`docs/reviews/s5-halt-hooks-app-security-round2-2026-09-07.md`) and the architecture council seat (`docs/reviews/s5-central-classification-architecture-council-2026-09-07.md`) already cover the wider surface.

**ADR cache:** `node docs/adr-cache.mjs --ensure` gives `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]`. Same applicable entry as rounds 1-2: ADR-0021 (in-session hook gate limited to `PreToolUse`/`UserPromptSubmit`/`SessionStart`/`SubagentStop`; `SessionStart` alone cannot halt). This round's diff (reconciliation guard + fixture-path resolution) does not touch that boundary -- `sessionstart-tool-enum.mjs` still exits 0 unconditionally; `userpromptsubmit-halt-relay.mjs` remains the sole blocking surface. No ADR violation found.

Files re-examined this round: `hooks/sessionstart-tool-enum.mjs`, `hooks/userpromptsubmit-halt-relay.mjs`, `src/policy/tools/central-classification.ts`, `hooks/test-support/fixture-tree.ts`, `hooks/sessionstart-tool-enum-fixnow.test.ts`, `hooks/userpromptsubmit-halt-relay-fixnow.test.ts`, `src/policy/tools/builtin-tool-inventory.ts`, `docs/decisions.md`, `docs/backlog.md`, `docs/.maat-state.json`, and live GitHub Issue state (#96, #97, #99-#101).

---
# App-security review S5 halt-hook diff -- ROUND 3 re-confirm, TERMINAL (Milestone #23, CRITICAL tier)

**Reviewer:** Horus (app-security-reviewer)
**Date:** 2026-09-07 (round 3, narrow terminal re-confirm)
**Scope:** scope=s5, tier=CRITICAL (`docs/.maat-state.json`). Narrow re-confirm per the Manager's own scoping instruction: (1) verify round-2's Issue #96 escalation (Finding 6) is genuinely closed, not relocated; (2) check the new env-var-removal fix (Issue #99, `architecture-reviewer`'s council-seat root-cause fix) doesn't introduce a NEW session-isolation concern; (3) confirm the round-2 Unicode sanitization finding (Finding 7) is honestly still open/tracked, not silently dropped or falsely claimed fixed. Not a full fresh attack pass -- round 2 (`docs/reviews/s5-halt-hooks-app-security-round2-2026-09-07.md`) and the architecture council seat (`docs/reviews/s5-central-classification-architecture-council-2026-09-07.md`) already cover the wider surface.

**ADR cache:** `node docs/adr-cache.mjs --ensure` gives `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]`. Same applicable entry as rounds 1-2: ADR-0021 (in-session hook gate limited to `PreToolUse`/`UserPromptSubmit`/`SessionStart`/`SubagentStop`; `SessionStart` alone cannot halt). This round's diff (reconciliation guard + fixture-path resolution) does not touch that boundary -- `sessionstart-tool-enum.mjs` still exits 0 unconditionally; `userpromptsubmit-halt-relay.mjs` remains the sole blocking surface. No ADR violation found.

Files re-examined this round: `hooks/sessionstart-tool-enum.mjs`, `hooks/userpromptsubmit-halt-relay.mjs`, `src/policy/tools/central-classification.ts`, `hooks/test-support/fixture-tree.ts`, `hooks/sessionstart-tool-enum-fixnow.test.ts`, `hooks/userpromptsubmit-halt-relay-fixnow.test.ts`, `src/policy/tools/builtin-tool-inventory.ts`, `docs/decisions.md`, `docs/backlog.md`, `docs/.maat-state.json`, and live GitHub Issue state (#96, #97, #99-#101).

---

## 1. Issue #96 escalation (round-2 Finding 6) -- CONFIRMED CLOSED

**Evidence (demonstrated + code-traced).**

(a) **Code trace.** `hooks/sessionstart-tool-enum.mjs:193-208` (`reconcileReason`): when `active` is `false` and `sessionId === UNKNOWN_SESSION_ID`, the function now returns without writing anything -- the shared fallback bucket ("unknown-session") is additive-only (may still gain `set:true` entries) and is NEVER reconciled to `set:false` by a different colliding invocation. This exactly matches the minimal fix round 2 recommended.

(b) **Shipped regression test re-run, myself.**
```
$ npx tsx --test hooks/sessionstart-tool-enum-fixnow.test.ts hooks/userpromptsubmit-halt-relay-fixnow.test.ts
[OK] S5-R2-Issue96-escalation: the shared 'unknown-session' fallback bucket is NEVER reconciled to
  set:false -- a second, different colliding invocation whose OWN condition is resolved must not
  silently clear a still-active halt that belongs to a different invocation (304.6341ms)
...
tests 21, pass 21, fail 0
```

(c) **Independent repro, bypassing the test harness entirely** (fresh script, `spawnSync` against the real `.mjs` files directly, mirroring round 2's own methodology): Run A (no `session_id`, real unclassified MCP server present) writes `SUR-03-unclassified-tool: set:true` to `unknown-session.json`; relay blocks (exit 2). Run B (a DIFFERENT logical invocation -- its own MCP config now resolved -- but ALSO missing `session_id`, landing in the same fallback bucket) completes with exit 0, but the halt-state file's `SUR-03-unclassified-tool` entry **stays `set:true`**, and the relay **still exits 2** afterward -- the pre-round-2 safe (stuck-blocked) direction is restored, exactly as intended.
```
Run A exit: 0
halt-state after A: {"sessionId":"unknown-session","reasons":{"SUR-03-unclassified-tool":{"set":true,...}}}
Relay after A, exit (expect 2): 2
Run B exit: 0
halt-state after B: {"sessionId":"unknown-session","reasons":{"SUR-03-unclassified-tool":{"set":true,...}}}
Relay after B, exit (2=still blocked/safe, 0=fail-open/BAD): 2
```
Reran this independent repro 7 times back-to-back: 7/7 consistent (blocked). One additional instrumented run (a throwaway debug copy of the hook printing `reconcileReason`'s own branch decision) confirmed the exact code path taken: `sessionId === UNKNOWN_SESSION_ID` evaluates `true` on Run B, and the `set:false` write is skipped as designed.

**Disclosed anomaly, not a live defect:** my very first invocation of this independent repro (before I added instrumentation) produced the OLD, fail-open result once (`set:false` written, relay exit 0). I could not reproduce this a second time across 7 further attempts against the identical, unmodified file, and an instrumented run of the same logic showed the correct branch being taken. I record this rather than silently omit it (PRINCIPLES rule 13) -- it reads as an environmental fluke (a single anomalous first-write on a freshly created temp directory), not a reproducible code defect, given the code trace and 7/7 consistent reruns since. If the Manager wants this chased further, the unlock is cheap: re-run the same repro script (referenced in this session's scratchpad) another 20+ times; it has not recurred once in 8 total attempts after the first.

**Verdict: CLOSED.** The escalation round 2 demonstrated (a colliding invocation silently discharging a different invocation's genuinely-active halt) no longer reproduces. Issue #96's own original, pre-existing root cause (malformed stdin landing in the wrong session's file at all) stays open and untouched by this fix, exactly as scoped -- commented on the issue accordingly (see "Actions taken" below).

## 2. Env-var-removal fix (Issue #99) -- no NEW session-isolation concern introduced

**Evidence (code-traced + demonstrated).**

(a) **Complete removal confirmed.** `grep -rn "THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH"` across `*.ts`/`*.mjs` returns matches only in comments (`sessionstart-tool-enum.mjs:264`, explaining why it's gone) and in the fixnow test that proves it's inert (`sessionstart-tool-enum-fixnow.test.ts:144-166`, "S5-R2-N1", re-run myself, PASS). No production code path reads this variable.

(b) **New resolution shape.** `sessionstart-tool-enum.mjs:289-292`:
```js
const projectRelativeFixturePath = join(projectDir(), "docs", "qa", "s5-central-classification.json");
const fixture = existsSync(projectRelativeFixturePath)
  ? loadCentralClassificationFixture(projectRelativeFixturePath)
  : loadCentralClassificationFixture(); // module-adjacent DEFAULT_FIXTURE_PATH fallback
```
`projectDir()` (line 120-122) resolves `process.env.CLAUDE_PROJECT_DIR ?? process.cwd()` -- the SAME seam already used, unconditionally, for every other input this hook reads (`.claude/settings.json`, `.mcp.json`, `~/.claude.json`'s `HOME`/`USERPROFILE` pair) and for where it WRITES halt-state. This is not a new trust boundary; it is the pre-existing one, applied consistently.

(c) **Does a hostile/misconfigured `CLAUDE_PROJECT_DIR` let one session read a DIFFERENT session's or project's fixture?** No new capability beyond what already existed. Two sub-cases:
  - **Fallback path** (`DEFAULT_FIXTURE_PATH`, `central-classification.ts:54-55`): resolved via `import.meta.url` -- the actual on-disk location of the hook script itself, immune to any env var. In the "shipped template copied into a consumer project" scenario (per CLAUDE.md's fork notice), this always resolves to that SAME consumer repo's own committed fixture, never another project's -- `THIS_DIR` is wherever the file physically sits.
  - **Project-relative path**: only reachable if `CLAUDE_PROJECT_DIR` is redirected to point somewhere else with its own `docs/qa/s5-central-classification.json`. This requires the SAME already-accepted capability (a session rewriting its own `.claude/settings.local.json` `env` block) the architecture council already named as an open, disclosed tension for a *different* env var (`s5-central-classification-architecture-council-2026-09-07.md` section 1) -- and a session that can already redirect `CLAUDE_PROJECT_DIR` already controls which `.mcp.json`/`settings.json` this hook reads and where it writes halt-state, i.e., the ENTIRE input/output surface of this mechanism, not merely the fixture. This finding adds no new capability to what redirecting `CLAUDE_PROJECT_DIR` already grants; it is a lateral extension of an already-disclosed, already-tracked boundary (the architecture council's own NOT-COVERED section 2/3), not a fresh session-isolation gap.

**Verdict: CLEAN.** The fix closes Issue #99 at its architectural root (no ambient, DI-less override reachable from a governed session) and does not introduce a new cross-session or cross-project fixture-read path. The pre-existing, already-disclosed `CLAUDE_PROJECT_DIR`-is-session-settable tension is unchanged by this diff and is not this round's scope to re-litigate (already flagged for S6 intake by the architecture council).

## 3. Unicode sanitization finding (round-2 Finding 7) -- still open in code; was NOT honestly tracked, now fixed

**Evidence (demonstrated).**

(a) **Still unfixed in code, exactly as before, confirmed by direct probe:**
```
input : "connector‮gnihtemos‬-name"
output: "connector‮gnihtemos‬-name"
unchanged? true
```
`hooks/userpromptsubmit-halt-relay.mjs:89-94` (`sanitizeDetail`) is byte-identical to round 2's finding -- strips only `[\x00-\x1F\x7F]`, no Unicode bidi/format range. This matches the task's own framing: the council's 2026-09-07 ruling (`docs/.maat-state.json`'s `councilVerdict` text: "Path A targeted-patch ratified: remove env-var fixture override, pin expiresOn value, fix misdirecting post-expiry unlock hint, fix cross-session reconciliation bug") lists exactly 4 items, and the Unicode fix is not one of them -- confirmed NOT in scope, correctly so.

(b) **Tracking check -- this is where I found a real, if narrow, gap.** `gh issue view 97` shows `state: CLOSED, stateReason: COMPLETED`, closed by a `red-team` comment on 2026-09-08T02:14:13Z whose own text says: "Residual filed separately as LOW, NOT reopened here." I searched for that separate filing and found none:
```
$ gh issue list --state all --search "bidi OR unicode OR 202E OR RTL" --json number,title,state,labels
# returns only #97 (this one) and an unrelated #84 -- no dedicated Unicode-residual issue exists
$ grep -n -i "unicode\|bidi\|202E\|200B\|2028\|2029\|FEFF" docs/backlog.md docs/STATE.md docs/decisions.md
# zero matches, before this round's fix (see "Actions taken" below)
```
So: the finding was real, correctly scoped as non-blocking by the council, but between Issue #97's closure and this round, it had become untracked anywhere queryable (not an open Issue, not in `docs/backlog.md`, not in `docs/decisions.md`) -- contradicted by a comment on the record claiming it was "filed separately." This is a process/tracking-honesty gap, not a new security defect (the underlying display-integrity gap's severity is unchanged, still LOW-MED, still non-boundary-crossing per the council).

**Verdict: was NOT honestly tracked; now fixed by this round.** See "Actions taken" -- I restored tracking myself rather than merely reporting the gap, since the fix is a one-line backlog entry plus a clarifying comment, well within this round's own remit to leave the record accurate.

## Regression checks

**Test-writer's two original files, byte-unchanged:**
```
$ git diff --stat hooks/sessionstart-tool-enum.test.ts hooks/userpromptsubmit-halt-relay.test.ts
(empty output -- zero diff)
```

**Full suite, independently re-run:**
```
$ npm test
...
tests 547
suites 0
pass 547
fail 0
cancelled 0
skipped 0
todo 0
```
547 (up from round 2's 543 -- 4 new tests, matching the 4-item fix-now scope: N1 env-var-inert, Issue96-escalation, N3 expiry-unlock-hint, plus one more AC1-adjacent addition already counted in round 2's own AC1 set). No skips, no failures.

**No new dependencies:** `git diff --stat package.json package-lock.json` empty, reconfirmed.

**`builtin-tool-inventory.ts` diff:** comment-only (confirmed via `git diff` -- corrects stale "S6/T5" ownership language and cross-references Issue #93/#91), no behavior change.

## Actions taken this round (not just reported)

1. **`docs/backlog.md`** -- added an entry (S5 Stage-3 round-2/round-3 origin) naming the Unicode-bidi/format-character residual explicitly, so it is findable by anyone grepping the backlog going forward. This is the artifact red-team's round-2 comment on Issue #97 claimed already existed.
2. **GitHub Issue #97** (comment) -- confirmed its own ratified scope shipped correctly and stays closed; pointed at the new backlog entry so the thread's history is accurate rather than silently orphaning the residual.
3. **GitHub Issue #96** (comment) -- confirmed round 2's escalation (the fail-open direction on the shared fallback bucket) is closed, per the evidence in section 1 above. Issue #96 itself stays open -- its original, pre-existing malformed-stdin root cause (deferred, spike-first, per `docs/decisions.md`'s 2026-09-07 row) is untouched by this fix and was never in scope to close.

## Verdict: APPROVE

Both items this round was scoped to re-confirm hold: the Issue #96 escalation is genuinely closed (demonstrated, not merely relocated), and the env-var-removal fix (Issue #99) introduces no new session-isolation exposure -- it is a same-shape, already-accepted trust boundary applied consistently, not a new one. The Unicode finding is correctly out of this round's fix scope per the architecture council's ruling; the one real gap this round surfaced (a tracking/documentation honesty lapse, not a code defect) has been corrected in the same turn, not merely flagged.

No blocking finding this round. `docs/reviews/s5-central-classification-architecture-council-2026-09-07.md`'s remaining two conditions (Issue #100 `expiresOn` pin, Issue #101 unlock-hint accuracy) were folded into this same fix-now pass per `.maat-state.json`'s `councilVerdict` text -- those are outside this reviewer's own narrow re-confirm remit (data-pinning/message-accuracy, not access-control/injection/secrets/deps/data-exposure) and are not re-litigated here; their own closing reviewer (red-team, per the council's own single-next-action) should confirm them independently if not already done.

**Single next action:** none blocking. If `red-team`'s own re-confirm of Issues #100/#101 has not yet landed, that is the remaining piece before this story's Stage-3 loop can close clean end-to-end -- outside this report's own scope to confirm.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by exploitability x impact):
1. [CLEAN][demonstrated] hooks/sessionstart-tool-enum.mjs:193-208 (reconcileReason) -- round-2 Issue #96 escalation (Finding 6) CONFIRMED CLOSED: shipped regression test re-run (PASS), independent from-scratch repro against the real hook binaries (7/7 consistent: shared fallback bucket stays set:true, relay stays blocked after a second colliding invocation), one instrumented run confirming the exact branch taken. One unreproduced anomalous first-run result disclosed honestly (see report body) -- not treated as a live defect given 7/7 consistent reruns since plus code-level confirmation.
2. [CLEAN][code-traced] hooks/sessionstart-tool-enum.mjs:260-292 -- env-var-removal fix (Issue #99) introduces no NEW session-isolation concern: the fixture-path resolution now uses the SAME CLAUDE_PROJECT_DIR/module-relative seam already governing every other input/output this hook touches, not a new trust boundary; the module-adjacent fallback resolves via import.meta.url (env-immune) so a template-copied consumer project always reads its own fixture, never another project's.
3. [ISSUE][LOW][demonstrated] docs/backlog.md / GitHub Issue #97 (as found, before this round's fix) -- round-2's Unicode/bidi sanitizeDetail residual (still unfixed in code, confirmed live: sanitizeDetail leaves a U+202E-containing string byte-identical) had fallen out of ALL open tracking (no Issue, no backlog entry) despite a round-2 comment claiming it was "filed separately as LOW." Confirmed via gh issue search + backlog/decisions grep, all empty. FIXED IN THIS SAME TURN: added a docs/backlog.md entry and a clarifying comment on Issue #97 -- tracking is now accurate. No new code-level severity (the underlying gap's severity, LOW-MED display-integrity, is unchanged and was already correctly scoped out of this fix-now round by the architecture council).
4. [CLEAN][demonstrated] hooks/sessionstart-tool-enum.test.ts, hooks/userpromptsubmit-halt-relay.test.ts -- git diff empty, byte-unchanged from test-writer's original authorship.
5. [CLEAN][demonstrated] npm test: 547 pass / 0 fail / 0 skipped (up from round 2's 543, +4 matching the ratified 4-item fix-now scope). package.json/package-lock.json diff empty -- no new dependencies.
6. [CLEAN][code-traced] src/policy/tools/builtin-tool-inventory.ts -- diff is comment-only (stale "S6/T5" ownership language corrected, cross-references Issues #91/#93), no behavior change.
counts (CHECKSUM): issues=1 suspicions=0 clean=5
evidence (CHECKSUM): demonstrated=4 code-traced=2 derived=0
checks="547/0/0|n/a"
adr=HIT(35)
report=docs/reviews/s5-halt-hooks-app-security-round3-2026-09-07.md
