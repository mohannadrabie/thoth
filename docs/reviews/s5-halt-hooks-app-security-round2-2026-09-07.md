# App-security review S5 halt-hook diff -- ROUND 2 re-confirm (Milestone 23, Deny-by-default + hook wiring)

**Reviewer:** Horus (app-security-reviewer)
**Date:** 2026-09-07 (round 2, re-confirm pass against the same uncommitted diff)
**Scope:** scope=s5, tier=CRITICAL (docs/.maat-state.json). Re-confirm pass against the fix-now round that followed round 1's REWORK verdict (docs/reviews/s5-halt-hooks-app-security-2026-09-07.md), human-ratified per docs/decisions.md's 2026-09-07 row ("S5 Stage-3 CRITICAL review round 1..."). Files re-examined:
- hooks/sessionstart-tool-enum.mjs
- hooks/userpromptsubmit-halt-relay.mjs
- src/policy/tools/central-classification.ts + central-classification.test.ts (new)
- docs/qa/s5-central-classification.json (new committed fixture)
- src/policy/tools/builtin-tool-inventory.ts (comment-only diff)
- hooks/sessionstart-tool-enum-fixnow.test.ts, hooks/userpromptsubmit-halt-relay-fixnow.test.ts (new)

**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e), CACHE=HIT. Same applicable catalog entry as round 1: ADR-0021 (in-session hook gate limited to documented PreToolUse/UserPromptSubmit/SessionStart/SubagentStop primitives; SessionStart alone cannot halt). No change to that boundary in this round's diff -- sessionstart-tool-enum.mjs still exits 0 unconditionally (line 333); userpromptsubmit-halt-relay.mjs remains the sole blocking surface. No ADR violation found.

## Human ruling re-confirmed (docs/decisions.md, 2026-09-07 row)

KNOWN_CONNECTORS was RATIFIED as a disclosed, dated (expiresOn: 2026-10-07), still-spoofable interim exemption -- a deliberate accepted residual risk. This round verifies the mechanism (disclosure honesty, fixture separation, runtime expiry enforcement), not the spoofability itself, which is accepted by design and stays open as a residual, not re-flagged as fresh.

## Findings -- round 1 dispositions

### 1. Round-1 Finding 1 (KNOWN_CONNECTORS spoofable) -- [CLEAN] on the ratified standard -- CLOSED

**Evidence (demonstrated + code-traced).**

(a) **Honest disclosure, in-code, citing the ratification.** hooks/sessionstart-tool-enum.mjs:52-63 and src/policy/tools/central-classification.ts:15-26 both state plainly that this is NOT a real security control -- a connector renamed, or a new connector deliberately named identically to one of the entries below, defeats this exemption completely (GitHub Issue #90). It ships anyway ONLY because the human explicitly reviewed and accepted this exact risk -- and cites docs/decisions.md's 2026-09-07 row by name. This is not a euphemism; it states the exact bypass mechanism, matches round 1's own finding text almost verbatim, and never claims the exemption is a real identity check.

(b) **Fixture separation, confirmed.** docs/qa/s5-central-classification.json is the ONLY place either allowlist is defined (version, expiresOn: 2026-10-07, ratifiedBy citing the decisions.md row, centralLayer.tools, knownConnectors). hooks/sessionstart-tool-enum.mjs contains zero inline hardcoded connector/tool-name strings -- grep-confirmed no KNOWN_CONNECTORS identifier remains in that file; both allowlists are loaded exclusively via loadCentralClassificationFixture() (central-classification.ts:113-115, sessionstart-tool-enum.mjs:239-241).

(c) **Runtime expiry enforcement, demonstrated, not just documented.** sessionstart-tool-enum.mjs:242-248 calls isFixtureExpired(fixture) on every run and, when true, replaces centralLayer with an empty tools array and knownConnectors with an empty Set -- reverting BOTH exemptions to unclassified/unknown. This is not a CI-only check: it runs inside computeSessionTools(), which executes on every real SessionStart invocation, not a separate build-time script. Ran the shipped regression suite (hooks/sessionstart-tool-enum-fixnow.test.ts, AC1 tests) myself as part of npm test (see below) -- both directions pass: a synthetic fixture with expiresOn 2099-01-01 exempts a matching tool/connector; the SAME fixture with expiresOn 2020-01-01 reverts both to halting, end-to-end through a real spawned hook process, not just a unit-level function call. Also independently confirmed isFixtureExpired's UTC-midnight boundary math via src/policy/tools/central-classification.test.ts (3 boundary tests, all passing, including a local-timezone-vs-UTC case that catches the exact class of bug an earlier draft reportedly had per that file's own header comment).

The regression test AC1-c (central-classification.test.ts:60-67) also fails the build the day the real fixture's expiresOn passes -- a second, independent layer of enforcement on top of the runtime check, exactly as the story's own design intends (build fails loud well before runtime silently reverts behavior with no warning).

**Verdict on this finding: CLOSED.** The mechanism is honest, correctly separated into a reviewable fixture, and its expiry is enforced at runtime (demonstrated) as well as at build time (demonstrated). The underlying spoofability is NOT gone -- it is not supposed to be; that is the ratified residual risk, unchanged and out of scope to re-flag.

### 2. Round-1 Finding 2 (EPIPE fail-closed fix) -- [CLEAN] -- re-confirmed, still holds

**Evidence (demonstrated, freshly re-run this round).** hooks/userpromptsubmit-halt-relay.mjs:191-200 (blockWithMessage) and :289-298 (top-level .catch()) are byte-identical in structure to round 1's confirmed-fixed version -- both writes still individually try/catch-guarded. Re-ran the debug report's own broken-pipe methodology directly against the CURRENT file (destroy the parent's read end of child stdout ~5ms after spawn):

```
run 1: exit=2 signal=null
run 2: exit=2 signal=null
run 3: exit=2 signal=null
run 4: exit=2 signal=null
fail-closed (exit 2) preserved: 4/4
```

No regression. Still CLOSED.

### 3. Round-1 Finding 3 (session isolation, session_id-scoped) -- [CLEAN] -- re-confirmed on its original scope; see NEW Finding 6 below for a materially different, adjacent gap this round surfaced

**Evidence (code-traced).** haltStatePath(sessionId) (hooks/userpromptsubmit-halt-relay.mjs:126-128) is still scoped strictly to input.session_id, host-supplied. For any session that supplies a real, distinct session_id (the documented, always-present contract per Claude Code's own hooks schema), isolation holds exactly as before -- unaffected by this diff. This finding's ORIGINAL scope stays CLEAN. A new, narrower interaction involving the pre-existing unknown-session fallback bucket (Issue #96) is reported separately as Finding 6 -- it is not a defect in session_id scoping itself, but in what happens when session_id resolution fails and multiple failures collide.

### 4. Round-1 Finding 4 (no sensitive-data leak via blockWithMessage) -- [CLEAN] -- re-confirmed

**Evidence (code-traced).** Unchanged data flow: only tool/connector names and generic exception text reach describeActiveReasons(). New this round: sanitizeDetail() is now interposed (hooks/userpromptsubmit-halt-relay.mjs:82-87, applied at :208) -- evaluated in Finding 7 below for its own correctness, not a data-source change. Still CLEAN on this finding's original scope (no credential-shaped value reaches the sink).

### 5. Round-1 Finding 5 (no new dependencies) -- [CLEAN] -- re-confirmed

**Evidence (demonstrated).** git status --short package.json package-lock.json returns empty -- no diff to either file in this round's changes. src/policy/tools/central-classification.ts imports only node:fs, node:url, node:path, and a local type import from ./classification.ts. Still CLOSED -- pure node:fs/node:path plus local modules only, as claimed.

## NEW findings this round

### 6. [ISSUE][MED][demonstrated] AC5's reason-clearing logic, stacked on the pre-existing (already-disclosed, deferred) Issue #96 unknown-session fallback-bucket gap, can clear a DIFFERENT session's genuinely-still-active halt reason -- a fail-open escalation of a previously fail-STUCK (safe-direction) gap

**Evidence (demonstrated).** Both hooks/sessionstart-tool-enum.mjs:280 and hooks/userpromptsubmit-halt-relay.mjs:214 fall back to the literal string "unknown-session" whenever input.session_id is missing or not a string -- a pre-existing, already-disclosed condition (GitHub Issue #96, "should never happen per the documented contract," deferred by human ruling 2026-09-07 pending a spike). Before this diff, a reason written under that shared bucket could only ever be SET, never cleared -- the worst outcome of two real sessions colliding on that fallback id was "stuck blocked" (safe direction: an unrelated session gets over-blocked, an availability bug, not a security bypass).

This diff's AC5 reconciliation (reconcileReason, sessionstart-tool-enum.mjs:172-179) actively writes set:false for a reason key whenever THIS run's own computed truth says the condition is resolved AND that key was previously set:true in the (shared) file -- with no check that the previous set:true entry was written by the SAME logical session. Reproduced end-to-end:

```
Run A (session_id missing, real unclassified server present) exit: 0
halt-state after run A: {"sessionId":"unknown-session","reasons":{"SUR-03-unclassified-tool":{"set":true,"detail":"unclassified: session-a-bad-server", ...}}}
Relay check right after run A, exit code (expect 2 = blocked): 2
Run B (different session, own condition resolved) exit: 0
halt-state after run B: {"sessionId":"unknown-session","reasons":{"SUR-03-unclassified-tool":{"set":false,"detail":"condition no longer holds as of this SessionStart run", ...}}}
Relay check for the SAME colliding id AFTER run B, exit code (2=blocked, 0=unblocked): 0
```

A second SessionStart invocation that ALSO fails to resolve a real session_id (Issue #96's own precondition), but whose own underlying tool state happens to already be resolved, overwrites the shared file's SUR-03-unclassified-tool entry to set:false -- unblocking the relay for ANY subsequent prompt that also falls into the same fallback bucket, regardless of whether the first colliding invocation's real condition was ever actually fixed.

**Attack sketch:** this requires Claude Code's own hook stdin contract to be violated (missing/non-string session_id) more than once with different underlying tool states before the first colliding invocation's own UserPromptSubmit runs -- a narrow, compound precondition resting on an already-disclosed "should never happen" gap, not something a remote attacker can trigger unilaterally. It is not equally reachable as round 1's Finding 1 (which needed only an attacker naming a connector). It is nonetheless a real, demonstrated fail-open path in this CRITICAL-tier halt mechanism, and it changes Issue #96's own risk direction: previously deferred as a safe-direction availability nuisance, now proven capable of silently discharging an unrelated session's still-active halt.

**Minimal fix:** never treat the synthetic "unknown-session" id as reconcilable -- either (a) reconcileReason's set:false branch is skipped entirely when sessionId equals "unknown-session" (only ever additively set:true for the fallback bucket, preserving the pre-diff safe-stuck direction), or (b) make the fallback id per-invocation-unique (e.g. suffix with a random or timestamp token) so no two failed-resolution runs ever share a bucket to begin with. Either is a small, mechanical, low-risk change to reconcileReason/haltStatePath, not a new mechanism.

**Exposure:** security/access-control finding on a named CRITICAL-tier sensitive-area mechanism (CLAUDE.md "Policy enforcement / session gates" / "Halt-state directory") -- exempt from the narrow-blast-radius percentage cap. Rated MED, not HIGH, because the triggering precondition is a compound, already-disclosed, documented-as-should-never-happen edge case (Issue #96), not independently attacker-reachable the way round 1's Finding 1 was.

**Disposition:** same root cause as the already-open GitHub Issue #96 (unknown-session.json fallback bucket) -- commented on that issue with this round's demonstrated escalation rather than filing a duplicate, per this project's duplicate-check discipline.

### 7. [ISSUE][MED][demonstrated] sanitizeDetail() strips only ASCII control characters; non-ASCII Unicode format/control characters pass through unstripped into the human-and-Claude-visible systemMessage

**Evidence (demonstrated).** Ran sanitizeDetail (hooks/userpromptsubmit-halt-relay.mjs:82-87) directly against adversarial inputs:

| Input class | Result |
|---|---|
| ANSI escape (ESC [31m ... ESC [0m) | ESC (0x1B) stripped -- inert text remains, correctly neutralized |
| Embedded newline (forging a fake second stderr line) | newline/carriage-return stripped, text concatenated without a line break -- correctly prevents line-splitting/forging |
| Very long string (5000 chars) | Capped at 200 plus a truncation marker -- correct |
| Unicode control/format chars: U+2028 (LINE SEPARATOR), U+2029 (PARAGRAPH SEPARATOR), U+200B (ZERO WIDTH SPACE), U+202E/U+202C (RIGHT-TO-LEFT OVERRIDE / POP DIRECTIONAL FORMATTING), U+FEFF (BOM) | Passed through completely unchanged -- sanitizeDetail(input) equals input, confirmed true |

The regex matching only 0x00-0x1F and 0x7F is scoped to ASCII control characters only, exactly as its own docstring states -- not an overclaim, but incomplete relative to the function's own stated threat model (third-party-controlled MCP server / connector names reaching a chat-visible message, per Issue #97's own framing). U+202E (RIGHT-TO-LEFT OVERRIDE) is a well-documented real-world spoofing primitive (used to visually disguise filenames and extensions); here it could be embedded in an attacker-named MCP server or connector to visually reorder or disguise the halt message an operator reads when deciding how to respond to a security-relevant block -- the exact class of message this sanitizer exists to protect.

**Attack sketch:** an attacker who can name an MCP server or claude.ai connector (the same actor class already accepted as a residual risk elsewhere in this story) embeds U+202E in that name; the halted operator sees a visually reordered or misleading unlock message and may act on a misread instruction. The block itself (exit code 2) is unaffected either way -- this is a display-integrity gap on the message text, not a bypass of the halt.

**Minimal fix:** extend the strip regex to also remove the common Unicode bidi and format-control range covering U+200B through U+200F, U+2028, U+2029, U+202A through U+202E, U+2066 through U+2069, and U+FEFF -- a one-line change to the existing function, no new mechanism.

**Exposure:** MED -- narrow (requires the attacker-names-a-connector precondition already accepted as residual elsewhere), display-integrity not control-bypass, but demonstrated and directly in-scope of the fix this same diff shipped to close Issue #97.

**Disposition:** same root cause and scope as the already-open GitHub Issue #97 (unsanitised third-party MCP/connector names interpolated verbatim into the halt relay's systemMessage) -- this is a residual, incomplete-fix gap on that same issue. Commented on Issue #97 with this round's demonstrated gap rather than filing a duplicate.

## Independent test run

```
$ npm test
...
tests 543
suites 0
pass 543
fail 0
cancelled 0
skipped 0
todo 0
```

Independently confirmed: 543/543 pass, 0 fail, 0 skipped. This matches the BODY figure in story-implementer's own build receipt, not the RECEIPT line's 551 figure -- the RECEIPT line's number is stale/wrong and should be corrected to 543 (editorial, not a re-review-worthy defect; no test is missing or hidden, the count line itself is simply wrong).

## Test-isolation re-verification (real home .claude.json never touched)

**Evidence (code-traced).** hooks/test-support/fixture-tree.ts:93-99 (fixtureEnv) sets CLAUDE_PROJECT_DIR, HOME, and USERPROFILE all to a freshly mkdtemp-created throwaway directory tree, and hooks/test-support/spawn-hook.ts:53-59 (runHook) passes an env object merging process.env with the overrides to spawnSync -- the overrides win, so the spawned hook's own homeDir() (sessionstart-tool-enum.mjs:103-105, reading HOME then USERPROFILE) resolves to the fixture directory, not the real one, on both POSIX and Windows resolution paths. Every fixnow test file uses this same helper. Confirmed by inspection only -- I did not execute anything against the real home .claude.json myself during this review, per this task's own instruction.

## Verdict: APPROVE-WITH-CONDITIONS

Round 1's blocking HIGH (Finding 1, KNOWN_CONNECTORS spoofability) is genuinely CLOSED to the ratified standard: the disclosure is honest, the mechanism lives in a committed, separately-reviewable, dated fixture, and its expiry is enforced at runtime (demonstrated) as well as at build time. Findings 2-5 remain CLEAN, two re-confirmed with fresh demonstrated evidence this round.

Two NEW findings (6, 7) surfaced this round, both MED, both demonstrated, both narrow-precondition residual gaps on top of already-disclosed and already-open issues (#96, #97) rather than fresh independent defects -- neither defeats the core security property the fix-now round shipped to restore (the halt itself, and third-party-text sanitization, both fundamentally work; each has an edge the fix did not fully cover). Per this project's own disclosed-residual-risk convention already used throughout S5, these are conditions, not blockers: both are small, mechanical, same-shape fixes (one skip-condition in reconcileReason, one regex extension in sanitizeDetail), tracked on their respective existing Issues (#96, #97) rather than reopening this CRITICAL-tier ceremony for a third round.

**Single next action:** story-implementer applies the two named minimal fixes (Finding 6: never set:false the unknown-session fallback bucket; Finding 7: extend sanitizeDetail's strip regex to cover Unicode bidi and format control characters) as a small, low-risk fix-now pass, re-runs the fixnow test suites, and closes Issues #96/#97 with the new fix -- no new CRITICAL-tier round required given both are incremental hardening on already-disclosed, already-tracked issues, not new independent HIGH-severity bypasses.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by exploitability x impact):
1. [CLEAN][demonstrated] hooks/sessionstart-tool-enum.mjs:52-63,242-248, src/policy/tools/central-classification.ts:15-35,113-126, docs/qa/s5-central-classification.json -- round-1 Finding 1 (Issue #90) CLOSED to the ratified standard: honest in-code disclosure citing docs/decisions.md 2026-09-07 row, both allowlists loaded exclusively from the one committed dated fixture (grep-confirmed zero inline KNOWN_CONNECTORS strings remain in the hook file), expiry enforced at RUNTIME (demonstrated via fixnow tests: exemption applies pre-expiry, reverts to halting post-expiry, through a real spawned hook process) and at build time (AC1-c). Spoofability itself is NOT closed -- that is the ratified residual, unchanged, not re-flagged.
2. [CLEAN][demonstrated] hooks/userpromptsubmit-halt-relay.mjs:191-200,289-298 -- EPIPE fail-closed fix re-confirmed this round: freshly re-ran the broken-pipe repro against the CURRENT file, exit code 2 preserved 4/4.
3. [CLEAN][code-traced] hooks/userpromptsubmit-halt-relay.mjs:126-128,214 -- session_id-scoped isolation re-confirmed unaffected by this diff for any session with a real, host-supplied session_id (the documented, normal case).
4. [CLEAN][code-traced] hooks/userpromptsubmit-halt-relay.mjs (describeActiveReasons/sanitizeDetail data flow) -- no credential-shaped value reaches the chat-visible sink; unchanged from round 1's finding.
5. [CLEAN][demonstrated] package.json/package-lock.json -- zero diff (git status confirmed); central-classification.ts imports only node:fs/node:url/node:path plus a local type import. No new dependencies.
6. [ISSUE][MED][demonstrated] hooks/sessionstart-tool-enum.mjs:172-179 (reconcileReason) plus the pre-existing unknown-session fallback (sessionstart-tool-enum.mjs:280, userpromptsubmit-halt-relay.mjs:214, GitHub Issue #96) -- AC5 set:false reconciliation, applied to the shared fallback bucket, can clear a DIFFERENT colliding session's genuinely-still-active halt reason; demonstrated end-to-end (relay unblocks, exit 0, after a second colliding invocation's own resolved state overwrites the shared file). Escalates Issue #96 from a safe-direction (stuck-blocked) gap to a fail-open direction. Fix: never write set:false for the unknown-session fallback id (additive-only there), or make the fallback id per-invocation-unique. Commented on existing Issue #96, not filed as a duplicate.
7. [ISSUE][MED][demonstrated] hooks/userpromptsubmit-halt-relay.mjs:82-87 (sanitizeDetail) -- strips only ASCII control chars (0x00-0x1F, 0x7F); non-ASCII Unicode format/control characters (U+202E RTL override, U+200B zero-width space, U+2028/2029 line/paragraph separators, U+FEFF BOM) pass through unstripped into the human-and-Claude-visible systemMessage, demonstrated live (sanitizeDetail(input) equals input for a string containing all five). U+202E is a known real-world spoofing primitive; an attacker-named MCP server or connector could visually disguise the halt message an operator reads. Block itself (exit 2) unaffected -- display-integrity gap, not a bypass. Fix: extend the strip regex to cover the Unicode bidi and format-control range. Commented on existing Issue #97 (same root scope), not filed as a duplicate.
counts (CHECKSUM): issues=2 suspicions=0 clean=5
evidence (CHECKSUM): demonstrated=5 code-traced=2 derived=0
checks="543/0/0|n/a"
adr=HIT(35)
report=docs/reviews/s5-halt-hooks-app-security-round2-2026-09-07.md
