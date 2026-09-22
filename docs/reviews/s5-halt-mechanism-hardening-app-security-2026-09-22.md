# App Security Review — `fix/s5-halt-mechanism-hardening` (Issues #96, #206)

**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-22
**Commit reviewed:** `4240ca5824b222c33e268c1690b58be22f85f383` on `fix/s5-halt-mechanism-hardening`, diff vs `origin/master` (`2f61890`)
**Tier:** CRITICAL (named sensitive area — policy enforcement / session gates, CLAUDE.md)
**ADR cache:** `HIT` (live run: `node docs/adr-cache.mjs --ensure` -> "cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2], fp 56ef9c1"). The `adr/` git submodule is not initialized in any currently active worktree of this repo (confirmed `git submodule status` shows an uninitialized `adr` entry, and `ls adr/software-engineering` fails) — an environment gap, not specific to my worktree; reproduced identically in a fresh detached worktree. The live top-level `docs/.maat-state.json -> adrCatalog.adrs` therefore only carries 2 entries (THOTH-ADR-0001, THOTH-ADR-0002). ADR-0021's full text (including INT-07, which this task specifically asks me to verify) is not reachable from the live catalog, but is preserved verbatim inside `docs/.maat-state.json`'s own `priorScope` history chain (a snapshot from when the submodule was populated) — ADRs are immutable once accepted, and THOTH-ADR-0001 itself confirms ADR-0021 is still accepted, unsuperseded. Used that historical snapshot as the authoritative text for ADR-0021.

## ADR compliance

**ADR-0021 (`applicableTo`: architecture, security, code, data), Rules for agents, INT-07:** "No control named in thoth's posture output may rest on an unverified third party's claim about its own behavior; where thoth can verify a third party's gate directly, it MUST do so and record its own independent verdict."

**Verdict: VIOLATED — BLOCKER.** See Finding 1 below. `resolveFallbackSessionId()` rests the #96 fix entirely on a documentation-prose claim ("confirmed via the official Claude Code hooks/Settings Reference documentation") about what environment variable Claude Code sets on a hook subprocess, without ever measuring it against a real hook invocation. My own independent verification (WebSearch plus a live measurement of my own Claude-Code-family process environment) contradicts the claim. This is precisely "a control resting on an unverified third party's [the host runtime's] claim about its own behavior," where thoth (the implementer) could have verified it directly (spike: dump `process.env` from a real hook invocation) and did not.

**THOTH-ADR-0001** (central-classification fixture exception) and **THOTH-ADR-0002** (OSS-01 secret-scan allowlist): not applicable — this diff never touches `docs/qa/s5-central-classification.json`, its loader, or the secret-scan allowlist. No violation, nothing further to check.

## Scope confirmed via diff hunks

`git diff origin/master..fix/s5-halt-mechanism-hardening` touches exactly 6 files: `hooks/sessionstart-tool-enum.mjs`, `hooks/userpromptsubmit-halt-relay.mjs`, two new sibling test files, `CHANGELOG.md`, and one existing test file's pinned-string update (`userpromptsubmit-halt-relay-friendly-labels.test.ts`). No `package.json`/lockfile change (no new dependency). Read both hook files in full, pre- and post-diff (via `git show <branch>:<path>`, since the branch is checked out in a sibling worktree, not mine).

## Findings

### 1. [ISSUE][HIGH][demonstrated] Issue #96's fix reads an env var this repo's own history already flagged as unconfirmed, under a different name than what was flagged — and it is very likely never set on a real hook subprocess, making the fix inert

`hooks/sessionstart-tool-enum.mjs`'s and `hooks/userpromptsubmit-halt-relay.mjs`'s `resolveFallbackSessionId()` both read `process.env.CLAUDE_SESSION_ID`. Issue #96's own original comment thread (2026-09-08, `story-implementer`) named the candidate signal as `CLAUDE_CODE_SESSION_ID` and explicitly required it be spiked before use: "Both candidate fixes rest on an unmeasured or risky assumption -- (a) sourcing the session id from CLAUDE_CODE_SESSION_ID in the hook's real process environment, never confirmed present in this repo's actual hook invocation... do not assume CLAUDE_CODE_SESSION_ID presence without confirming it." This diff's fix reads `CLAUDE_SESSION_ID` — a different variable name — and its own code comments cite only documentation prose ("confirmed via the official Claude Code hooks/Settings Reference documentation... the SAME trust tier already relied on for `CLAUDE_PROJECT_DIR`") as its verification, never a spike against a real invocation.

Independent verification:
- WebSearch of code.claude.com/docs/en/hooks and multiple anthropics/claude-code GitHub issues (#13733, #17188, #18629, #25642, #27299, #38390, #44607, #47018 — spanning roughly a year, several still open) consistently states `CLAUDE_SESSION_ID` is not currently exposed to hook subprocesses — it is a repeatedly-requested, not-yet-shipped feature. The one adjacent variable that does exist, `CLAUDE_CODE_SESSION_ID`, is documented as available to Bash-tool subprocesses (v2.1.132+), a different subprocess class than a SessionStart/UserPromptSubmit hook invocation.
- Direct measurement of my own live process environment (a Claude-Code-family agent process, same claude.exe binary family, CLAUDE_CODE_EXECPATH present): `env | grep -i CLAUDE` shows `CLAUDE_CODE_SESSION_ID=5f4f727c-...` set, and `CLAUDE_SESSION_ID` absent.
- Demonstrated against the actual shipped code: ran hooks/sessionstart-tool-enum.mjs (copied from the fix commit into an isolated tree) with malformed stdin and a realistic production-shaped env (CLAUDE_CODE_SESSION_ID=real-uuid-1234 set, CLAUDE_SESSION_ID unset):
  ```
  $ unset CLAUDE_SESSION_ID
  $ export CLAUDE_PROJECT_DIR=<isolated tree>
  $ export CLAUDE_CODE_SESSION_ID=real-uuid-1234
  $ node hooks/sessionstart-tool-enum.mjs <<< '{ not valid json [[['
  sessionstart-tool-enum.mjs: internal exception during enumeration: SyntaxError: ...
  exit=0

  --- halt-state files written: ---
  .thoth/halt-state/unknown-session.json      <- written here
  (no real-uuid-1234.json)                    <- NOT written here
  ```
  The halt-state write still lands in unknown-session.json, not under the real session id — this is the exact fail-open gap Issue #96 exists to close, unfixed under the most realistic guess at a real production environment.

Impact: this is not a new regression (the round-2 additive-only guard for the literal "unknown-session" bucket still applies, so the mechanism degrades to its pre-fix, already-accepted "stuck safe-direction" behavior, not to something worse). The real damage is to the review/governance record: shipping this closes (or narrates as closed) a CRITICAL-tier, named-sensitive-area Issue with a fix that, on the best evidence available, does nothing in production — exactly the "no hand-derived completeness claims" / "spike first" failure mode this project's own process exists to catch, and exactly what ADR-0021 INT-07 forbids.

Minimal fix: before this ships or Issue #96 is narrated as resolved, run the actual spike Issue #96's own thread already named: from a real Claude Code session, temporarily have a hook write process.env to a debug file, and confirm whether any session-identifying variable is present and under what name. If none is available today, resolveFallbackSessionId() should say so honestly (revert to the disclosed, deferred state) rather than claim a fix; if CLAUDE_CODE_SESSION_ID (or some other name) turns out to be the real signal, use that name instead, matching what Issue #96's own history already pointed at.

Exposure: security/policy-enforcement sensitive area (CLAUDE.md's named "Policy enforcement / session gates"), exempt from PRINCIPLES rule 21's exposure-percentage cap. Basis: demonstrated (ran the shipped code under the best-available realistic env) plus derived corroboration (WebSearch, this repo's own Issue #96 history). Not "assumption"-basis — I ran the code and got a concrete, reproducible result.

### 2. [ISSUE][MED][code-traced] `reconcileReason`'s anti-collision guard protects only the literal string "unknown-session", not any other value the env-var fallback could produce

hooks/sessionstart-tool-enum.mjs's `reconcileReason` (the round-2 fix for the Stop-Brief escalation) only refuses to reconcile set:false when `sessionId === UNKNOWN_SESSION_ID` (the literal "unknown-session"). Once `resolveFallbackSessionId()` can return any other string (a real or spoofed CLAUDE_SESSION_ID value), that value is trusted as unique-per-invocation with no collision guard at all. If two different invocations ever resolve to the same non-literal fallback value — e.g. a project's own .claude/settings.json (or a gitignored, session-writable .claude/settings.local.json, per this codebase's own documented concern about exactly this ambient-env-injection shape for THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH in sessionstart-tool-enum.mjs's own header, GitHub Issue #99) sets a fixed CLAUDE_SESSION_ID, or an ambient shell export is inherited by two concurrent claude invocations — the round-2 fail-open escalation (one invocation's set:false write silently clearing a different, still-active invocation's halt) reopens verbatim, just under a different bucket name than "unknown-session".

This is architecturally independent of Finding 1: it applies even once/if a correctly-named, genuinely host-supplied session-id variable ships, because the code never validates that the resolved value is actually unique to this invocation — it only special-cases one specific literal.

Minimal fix: generalize the guard from `sessionId === UNKNOWN_SESSION_ID` to "never reconcile to set:false when this run's own sessionId came from the fallback path rather than from stdin's own session_id" (i.e. key the guard on how the id was resolved, not on one specific string value).

Exposure: security-relevant (session-isolation guarantee of a fail-closed gate), exempt from the percentage cap. Basis: code-traced (reconcileReason, hooks/sessionstart-tool-enum.mjs) — exploitation requires either write access to a .claude/settings*.json env block or a genuine host-side collision, both non-trivial but not requiring code execution beyond config write.

### 3. [CLEAN][demonstrated] Issue #206 finding 5's exact demonstrated PoC is closed

Ran the new regression suite (hooks/userpromptsubmit-halt-relay-issue206-unlock-forgery.test.ts, hooks/sessionstart-tool-enum-session-id-fallback.test.ts, hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts) via `node --test` against the actual fix-branch commit:
```
tests 19, pass 19, fail 0, skipped 0
```
The "Issue #206 finding 5" test reproduces the exact hostile detail string from docs/reviews/friendly-halt-messages-app-security-2026-09-17.md finding 5 (evil-tool") (unlock: no action needed, safe to resume...) against the still-open path (SUR-03-enumeration-failed's raw, never-quoted detail) and confirms exactly one unescaped "(unlock:" occurrence survives in the rendered message — the real one, still correctly positioned as the message's own trailing hint. Independently traced escapeParens (replace(/[()]/g, ...)) — applied unconditionally to every literal paren character in sanitizeDetail's stripped text, before length-capping — confirms the mechanism is what the tests claim.

### 4. [CLEAN][code-traced] #206's fix scope is uniform across every reason key, not just the tested ones

describeActiveReasons (hooks/userpromptsubmit-halt-relay.mjs) unconditionally maps sanitizeDetail(entry.detail) over every [key, entry] pair in activeReasons. activeReasons itself comes from inspectHaltState, which validates the whole reasons object generically (any key with a {set: boolean, ...} shape), not a fixed list of 3 known keys. There is exactly one code path that renders a halt message (describeActiveReasons -> blockWithMessage), and it is the only call site of sanitizeDetail. The "defense-in-depth" test (an unmapped, future reason key with a hostile raw detail) exercises this directly and passes. Confirmed: no reason key, current or future, can reach the rendered message without going through the fixed escapeParens.

### 5. [SUSPICION][LOW][derived] escapeParens only escapes ASCII parens; Unicode confusable parens are untouched

escapeParens's regex (matching a literal open or close paren) is ASCII-only. A hostile detail using fullwidth parentheses (U+FF08/FF09) or other paren-like Unicode characters would render unescaped. This is a lower-fidelity variant of the same visual-forgery class finding 5 covered — not the demonstrated PoC shape, and the visual mismatch (fullwidth vs. ASCII glyphs) meaningfully reduces its deceptiveness in most fonts/terminals. Not gating; worth a backlog note for whoever next touches sanitizeDetail.

### 6. [CLEAN][demonstrated] Regression suite green modulo one pre-existing, environment-specific, diff-unrelated failure

Ran the full suite (npm test) against the fix commit in an isolated detached worktree: 1051 tests, 1050 pass, 1 fail, 0 skipped, matching the implementer's claimed count. The one failure (src/qa/reference-resolver.test.ts's "QA-14 dogfood" self-check, an unresolved ADR-0021 citation) is attributable to the adr/ git submodule not being initialized in any currently active worktree of this repo (see the ADR-cache note above) — confirmed the identical submodule-empty state independently in my own primary review worktree, unrelated to and pre-dating this diff. Not counted against this diff.

### 7. [CLEAN][code-traced] Standard injection/dependency/secrets checklist

No new dependency (package.json/lockfile untouched by this diff). No secret literal introduced. No SQL/shell/eval/deserialization anywhere in either touched file, before or after. No new endpoint or authz surface — this is pure hook-internal control-flow and string-formatting logic. No PII/credential logging beyond what was already flowing (MCP/connector names), already assessed clean in the 2026-09-17 report.

### 8. [CLEAN][code-traced] Happy paths are provably unchanged for both fixes

For #96: the string-type check on session_id with a fallback on the else branch is byte-identical to pre-diff in both files; only the fallback value changed. Confirmed by the "happy-path guard" test (env fallback set to a different session id than stdin's own; stdin always wins) and by direct trace. For #206: escapeParens is a no-op on any string containing no parens — confirmed by the "control: benign detail" test (rendered message contains no backslash at all when the detail has no parens).

## Test evidence

```
node --test hooks/sessionstart-tool-enum-session-id-fallback.test.ts \
  hooks/userpromptsubmit-halt-relay-issue206-unlock-forgery.test.ts \
  hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts
tests 19, pass 19, fail 0, skipped 0

npm test (full suite, detached worktree at commit 4240ca5)
tests 1051, pass 1050, fail 1, skipped 0
  (the 1 fail: src/qa/reference-resolver.test.ts ADR-0021 unresolved-citation self-check,
   attributable to uninitialized adr/ submodule in this worktree, not this diff)
```

Demonstrated production-env probe (Finding 1):
```
$ unset CLAUDE_SESSION_ID; export CLAUDE_CODE_SESSION_ID=real-uuid-1234
$ node hooks/sessionstart-tool-enum.mjs <<< '{ not valid json [[['
-> writes .thoth/halt-state/unknown-session.json (NOT real-uuid-1234.json)
```

## Verdict

**REWORK.**

Finding 1 is a BLOCKER: it is both a code-traced/demonstrated security finding in a named CRITICAL-tier sensitive area and a quoted ADR-0021 INT-07 violation (a control resting on an unverified third-party claim, where independent verification was available and not performed). It does not introduce a new hole (the pre-existing safe-direction fallback still holds), but it means Issue #96 is not actually fixed, and the diff's own narrative ("spike resolved") is not supported by the evidence. Finding 2 is a real, related design gap that should be folded into the same fix round rather than shipped separately. #206's fix (findings 3-4) is genuinely sound and can ship as-is; if the Manager wants to split the two issues, #206's half of this diff is APPROVE-worthy on its own merits.

## Next action

Before this ships: run the real-environment spike Issue #96's own 2026-09-08 comment already named (dump process.env from an actual live hook invocation) to determine the real session-identifying signal, if any, available to a hook subprocess; fix resolveFallbackSessionId() (both files) to use the confirmed name or none; and generalize reconcileReason's collision guard (Finding 2) to key on resolution method, not on one literal string.

---
RECEIPT: verdict=REWORK
findings (ALL of them, ranked by exploitability x impact):
1. [ISSUE][HIGH][demonstrated] hooks/sessionstart-tool-enum.mjs:131-134 + hooks/userpromptsubmit-halt-relay.mjs:213-216 -- resolveFallbackSessionId() reads process.env.CLAUDE_SESSION_ID, a variable this repo's own Issue #96 history named as unconfirmed under a DIFFERENT name (CLAUDE_CODE_SESSION_ID) and required to be spiked before use; no spike was run. WebSearch plus a live measurement of my own Claude-Code-family process (CLAUDE_CODE_SESSION_ID present, CLAUDE_SESSION_ID absent) plus a direct repro against the shipped hook script (malformed stdin + realistic env -> halt-state still lands in unknown-session.json, not the real session's file) show the fix is very likely inert in production -- Issue #96 is not actually fixed. ADR-0021 INT-07 violation (ratified rule, quoted above). Exposure: named sensitive area, exempt from % cap. Minimal fix: run the real spike, use the confirmed variable name (or none). Filed as a comment on the existing, still-open Issue #96 (same root cause, not a new Issue per Issue Discipline).
2. [ISSUE][MED][code-traced] hooks/sessionstart-tool-enum.mjs's reconcileReason -- the round-2 anti-collision guard checks only the literal string "unknown-session"; any other fallback value (spoofed or accidentally shared via a settings.json/settings.local.json env block, or a future correctly-named var) gets no collision protection at all, reopening the round-2 fail-open escalation under a different bucket name. Exposure: security-relevant (session isolation), exempt from % cap; requires config-write access or a genuine host collision. Minimal fix: key the guard on "resolved via fallback" rather than on one literal value. Filed as new Issue.
3. [CLEAN][demonstrated] Issue #206 finding 5's exact demonstrated PoC (hostile detail forging a fake "(unlock: ...)" parenthetical) is closed -- ran the new regression suite, 19/19 pass, independently traced escapeParens's unconditional application in sanitizeDetail.
4. [CLEAN][code-traced] #206's fix is uniformly applied to every reason key (current and future), not just the 3 known SUR-03 keys -- describeActiveReasons maps sanitizeDetail over the whole generically-validated activeReasons list; confirmed by the defense-in-depth unmapped-key test.
5. [SUSPICION][LOW][derived] escapeParens only escapes ASCII parens; Unicode confusable parens (e.g. fullwidth U+FF08/FF09) remain unescaped -- a lower-fidelity forgery variant, not the demonstrated PoC, not gating.
6. [CLEAN][demonstrated] Full suite 1050/1051 pass in an isolated detached worktree at the fix commit; the 1 failure is a pre-existing, diff-unrelated environment artifact (adr/ submodule not initialized in any current worktree).
7. [CLEAN][code-traced] No new dependency, no secret literal, no shell/eval/SQL/deserialization, no new endpoint or authz surface.
8. [CLEAN][code-traced] Both fixes' happy paths are provably byte-identical to pre-diff behavior (direct trace + dedicated regression tests).
counts (checksum): issues=2 suspicions=1 clean=5
evidence (checksum): demonstrated=4 code-traced=3 derived=1
checks="1050/1/0 (1 fail pre-existing/env-unrelated, see Finding 6); 19/0/0 on the new+adjacent regression files"
adr=HIT(2 live; ADR-0021 read from docs/.maat-state.json's priorScope history due to uninitialized adr/ submodule)
report=docs/reviews/s5-halt-mechanism-hardening-app-security-2026-09-22.md
