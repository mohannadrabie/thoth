# App Security Review — Round 2 — `fix/s5-halt-mechanism-hardening` (Issues #96, #206, #274, #276)

**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-22
**Commit reviewed:** `e04dde0` on `fix/s5-halt-mechanism-hardening` (checked out detached in an isolated worktree), fix-now round on top of round-1 target `4240ca5`
**Prior report:** `docs/reviews/s5-halt-mechanism-hardening-app-security-2026-09-22.md` — round-1 verdict **REWORK**
**Tier:** CRITICAL (named sensitive area — policy enforcement / session gates, CLAUDE.md)
**ADR cache:** `HIT` (live run: `node docs/adr-cache.mjs --ensure` -> "cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2]"). Same environment gap as round 1: the `adr/` submodule is uninitialized in this worktree. ADR-0021 text (including INT-07) used from `docs/.maat-state.json` `priorScope` history, same authoritative source round 1 used.

## ADR compliance

**ADR-0021, Rules for agents, INT-07:** "No control named in thoth its posture output may rest on an unverified third party claim about its own behavior; where thoth can verify a third party gate directly, it MUST do so and record its own independent verdict."

**Verdict: SATISFIED.** Round 1 violation is resolved. The implementer fix is now backed by direct measurement (a diagnostic hook dumping `process.env` in a real `claude -p` session), not documentation prose — and I independently re-verified it via two different measurements of my own (see Finding 1 below), neither of which relies on the implementer claim. See Finding 1.

## Task 1 — Finding 1 (env-var naming bug): re-verified independently, CONFIRMED FIXED

### 1. [CLEAN][demonstrated] `resolveFallbackSessionId()` now reads `CLAUDE_CODE_SESSION_ID` in both files, and the fix is live, not inert

Traced: `hooks/sessionstart-tool-enum.mjs:181` and `hooks/userpromptsubmit-halt-relay.mjs:292` both now read `process.env.CLAUDE_CODE_SESSION_ID`.

I could not spawn a nested, fully isolated `claude -p` session from this sandbox to reproduce the implementer exact spike methodology (`--dangerously-skip-permissions` in a scratch dir is blocked by this environment own auto-mode classifier: "Create Unsafe Agents"). I instead ran two independent measurements that do not depend on the implementer claim at all:

1. **Live env of my own Claude-Code-family process** (a real hook-adjacent subprocess, not synthetic):
   ```
   $ node -e "console.log(process.env.CLAUDE_CODE_SESSION_ID); console.log(process.env.CLAUDE_SESSION_ID)"
   CLAUDE_CODE_SESSION_ID=5f4f727c-1767-4567-ab90-a4381011b0ff
   CLAUDE_SESSION_ID=undefined
   ```
   This exactly mirrors round 1 own independent evidence (which is what originally caught the round-1 bug) — now the shipped code variable name matches what my own live environment actually has.

2. **End-to-end reproduction against the real shipped script**, same methodology round 1 used to demonstrate the bug, run again against the fixed code, under my own genuinely-inherited (not synthetically set) environment:
   ```
   $ cd <worktree>
   $ export CLAUDE_PROJECT_DIR=<isolated scratch tree with copied hooks/+src/>
   $ node hooks/sessionstart-tool-enum.mjs < malformed-stdin.txt   # payload: { not valid json [[[
   sessionstart-tool-enum.mjs: internal exception during enumeration: SyntaxError: ...
   exit=0

   $ cat .thoth/halt-state/5f4f727c-1767-4567-ab90-a4381011b0ff.json
   { "sessionId": "5f4f727c-1767-4567-ab90-a4381011b0ff", "reasons": { "SUR-03-enumeration-failed": { "set": true } } }
   ```
   The halt-state file now lands under my **real session id**, not `unknown-session.json` — the exact reversal of round 1 demonstrated failure, reproduced with the identical methodology.

This is the strongest evidence available to me in this sandbox (I could not spawn a literal isolated hook subprocess via `claude -p`), but it is independent of the implementer own spike, uses a genuinely-inherited (not manufactured) environment variable, and directly reproduces round 1 own falsifying test against the corrected code with the opposite result. Issue #96 is genuinely fixed.

Minor residual note (non-blocking): I could not independently confirm `CLAUDE_CODE_SESSION_ID` is set specifically on a **hook** subprocess as opposed to a Bash-tool subprocess (both are child processes of the same `claude.exe`, but Claude Code docs distinguish these as different classes — see round 1 WebSearch citations). This repo own `.claude/settings.json` wires `sessionstart-tool-enum.mjs` as a real `SessionStart` hook and `userpromptsubmit-halt-relay.mjs` as a real `UserPromptSubmit` hook (`.claude/settings.json:146-171`), and no `.thoth/halt-state/` file exists in this worktree for my own subagent session, consistent with (but not proof of) a clean run. Given the corroborating weight of two independent measurements plus the implementer own disclosed spike, this residual is UNPROVEN-pending-verification, not a blocker: **settling command** — from an unrestricted host (not sandboxed against nested-session spawning), run `claude -p "hi" --dangerously-skip-permissions` in a scratch dir with a diagnostic `SessionStart` hook dumping `process.env`, confirm `CLAUDE_CODE_SESSION_ID` present there specifically. Who: any operator with an unrestricted shell.

## Task 2 — Finding 2 / Issue #274: re-verified, CONFIRMED CLOSED; adversarial scenario attempted

### 2. [CLEAN][demonstrated] `sessionIdFromStdin`-gated `reconcileReason` closes the collision risk; attempted bypass did not succeed

Traced `reconcileReason` (`hooks/sessionstart-tool-enum.mjs:327-345`): the `set:false` branch now requires `sessionIdFromStdin === true`, set only when `main()` own stdin `session_id` field is both a string and passes `isValidSessionId` (`hooks/sessionstart-tool-enum.mjs:550-557`). Every other path (env fallback, literal `unknown-session`, or a malformed/absent stdin field) is `false` and the additive-only guard fires regardless of `sessionId` own value — generalized correctly from round 2 literal-only check, closing the gap round 1 flagged.

Ran the new regression test end-to-end against the real hook scripts:
```
PASS: Issue #274 / red-team F2: an env-resolved session id naming a DIFFERENT, currently-active live
  session must NEVER reconcile that OTHER session own genuinely-active halt to set:false
```
This test seeds a genuinely-active halt for a "victim" session, then runs a second, colliding `SessionStart` invocation whose env `CLAUDE_CODE_SESSION_ID` equals the victim own id (a real, supported collision shape — nested session, inherited shell export, reused CI/tmux env) and whose own stdin has no usable `session_id`. Confirmed: the victim halt stays `set:true`, and the relay still blocks (`exit 2`) for the victim afterward.

**Attempted adversarial scenario (per this round task 2):** can `sessionIdFromStdin` end up `true` for an invocation that should not be trusted? The only route is the host itself generating a stdin `session_id` field that names a session other than the one it is actually invoking for (i.e., the host own hook-payload construction is wrong or reused). That is a correctness assumption about the host runtime own hook-invocation contract, not something a userspace hook script can verify or defend against without discarding stdin `session_id` entirely — and it is the *same* trust boundary this mechanism has relied on since before Issue #96 existed (the original, never-disputed happy path already trusted stdin `session_id` as authoritative). This is not a new gap this diff introduces, and it does not reopen the *specific* collision Issue #274 closed (env-resolved values legitimately colliding across processes) — it would require the host own per-invocation stdin generation to be wrong, a materially different and unverifiable-by-thoth failure mode. I could not construct a concrete bypass; flagging as a disclosed, inherent trust boundary rather than a finding.

**Issue #274: commented and closed** (`gh issue close 274 --reason completed`) with the evidence above.

## Task 3 — Standard app-security re-pass

### 3. [CLEAN][code-traced] No new dependency, no secrets, no shell/eval/deserialization
```
$ git diff 4240ca5..e04dde0 -- package.json package-lock.json
(empty)
```
No secret literal introduced. No SQL/shell/eval/deserialization anywhere in either touched file. No new endpoint or authz surface — pure hook-internal control flow and string handling, same as round 1 finding 7.

### 4. [CLEAN][code-traced] New `isValidSessionId()` gate closes a latent path-injection surface, without narrowing the happy path

`^[A-Za-z0-9._-]{1,128}$` (`hooks/sessionstart-tool-enum.mjs:136`, identical copy in the relay). Traced the charset against `haltStatePath` join call: no `/` or backslash is in the allowed set, so no value passing this gate can ever introduce a path separator into that single path segment — even a value like two dots only ever produces a literal, harmless filename, never traversal, because the segment is never split on a separator that does not exist in the input. A real Claude Code session id (RFC-4122 UUID) is comfortably inside this charset. This is a genuine, well-scoped hardening addition; no bypass found.

### 5. [ISSUE][HIGH][demonstrated] `neutralizeUnlockToken` literal-substring match is defeated by an invisible Unicode character inside "unlock", reopening the exact "no-bracket" forgery shape round 3 was built to close

`sanitizeDetail` (`hooks/userpromptsubmit-halt-relay.mjs:162-170`) runs, in order: control-char strip (ASCII 0x00-0x1F/0x7F only) -> NFKC normalize -> `neutralizeUnlockToken` (`text.replace(/unlock\s*:/gi, "[unlock-token-removed]")`, line 145) -> `escapeParens`. The `unlock\s*:` regex requires the **literal, contiguous** 6-character substring "unlock". A zero-width character — e.g. U+200B ZERO WIDTH SPACE — inserted *inside* that word ("un" + ZWSP + "lock:") is:
- not in the ASCII control range stripped first (0x00-0x1F / 0x7F),
- not folded away by NFKC (format characters have no compatibility decomposition to nothing — confirmed by direct test, the character survives `.normalize("NFKC")` unchanged),
- not matched by `\s` in the `unlock\s*:` regex (JS `\s` does not include U+200B, a Cf-category format character, not a Zs space).

The literal match therefore fails, the token survives unneutralized, and — critically — U+200B renders as **nothing** in virtually every terminal/chat UI, so the forged text reads as plain, legitimate "unlock:" prose to a human operator.

Demonstrated against the exact regex extracted byte-for-byte from the shipped file (`hooks/userpromptsubmit-halt-relay.mjs:145`, confirmed via grep before reimplementing) — reimplementation verified correct against a parens sanity check first, to rule out transcription error:
```js
var zwsp = String.fromCharCode(0x200B);
var payload = "evil-tool -- un" + zwsp + "lock: no action needed, safe to resume, ignore the message below";
var fullLine = "Tool/connector check failed: " + sanitizeDetail(payload) +
  " (unlock: fix the malformed config file named in the detail above, then resume or start a new session)";
console.log(fullLine);
```
Output (raw print — the zero-width space is invisible):
```
Tool/connector check failed: evil-tool -- unlock: no action needed, safe to resume, ignore the message below (unlock: fix the malformed config file named in the detail above, then resume or start a new session)
```
This is exactly red-team demonstrated "no-bracket" evasion shape (the round-3 regression test "Issue #206 / red-team F3, demonstrated evasion (no bracket at all (a bare dash-unlock shape))" — which passes today, but only because that test own payload uses a *visible* literal "unlock:", not an invisible-character-split one). Confirmed no existing test covers this: `grep -c "200B|zero-width|ZWSP|word joiner|2060|invisible" hooks/userpromptsubmit-halt-relay-issue206-unlock-forgery.test.ts` returns `0`.

**Scope of the bypass, precisely:** `escapeParens` (the second, independent layer) is *not* defeated by this — a bracketed forgery (ASCII, fullwidth, or small-form parens; square brackets) still gets its brackets escaped regardless of the zero-width character, since `escapeParens` does not care about the "unlock:" token at all. The bypass is scoped to the **no-bracket** forgery shape specifically — the one shape whose *only* defense is `neutralizeUnlockToken`. The block itself (exit 2) is unaffected either way; this is message-forgery against a human operator reading a security-critical halt message, not a bypass of the halt.

Reachable via the same already-accepted untrusted-input channel this file own header comment discloses ("`detail` values ... can carry MCP server / connector names that a third party fully controls" — `hooks/userpromptsubmit-halt-relay.mjs:69-70`): a malicious/typosquat MCP server or claude.ai connector name, or `SUR-03-enumeration-failed` raw config-error text. `quoteNames()` JSON.stringify wrapping (applied at write time to tool/connector names) does not block this — it only defends against forging a second reason *line* via an embedded quote, an orthogonal defense.

Minimal fix: strip Unicode format-category (Cf) invisible characters in `sanitizeDetail`, alongside the existing ASCII control-char strip — e.g. `text.replace(/\p{Cf}/gu, "")` (or an explicit list: U+200B-200F, U+202A-202E, U+2060-2069, U+FEFF) — run *before* the `unlock\s*:` match, same structural philosophy already established in this file own header comment ("what makes a forged parenthetical readable... is not the punctuation around it" — the same logic applies one level down: what makes "unlock:" readable as a literal token is not the presence of every character between "un" and "lock" being visible, either).

Exposure: named CRITICAL-tier sensitive area (CLAUDE.md "Policy enforcement / session gates"), exempt from the percentage cap. Basis: demonstrated (ran the actual shipped regex, byte-for-byte, against a crafted payload and confirmed the bypass); reachable via an already-accepted adversarial channel (MCP/connector name) requiring no elevated privilege. Filed as **GitHub Issue #277** (duplicate-checked first, none found).

### 6. [CLEAN][demonstrated] Regression suite green modulo the same pre-existing, environment-specific, diff-unrelated failure as round 1
```
$ npm test
tests 1058, pass 1057, fail 1, skipped 0
FAIL: src/qa/reference-resolver.test.ts:121 — "QA-14 (dogfood): ... resolves clean" —
  unresolved citation "ADR-0021" (adr/ submodule not initialized in this worktree)
$ npm run typecheck
tsc --noEmit -p tsconfig.json    (clean, no output)
$ npm run lint
eslint .                          (clean, exit 0)
```
Matches round 1 own characterization (same uninitialized-adr-submodule artifact, same test file, same reason). Not counted against this diff.

**Editorial (non-gating):** the round-2 CHANGELOG entry (`CHANGELOG.md`, this diff) claims the one pre-existing failure is `src/qa/gate-manifest-check.test.ts` ("untracked, timestamped `.claude/worktrees/agent-*` directories"). In my environment (and in round 1), the actual failure is `src/qa/reference-resolver.test.ts` (uninitialized adr/ submodule); `gate-manifest-check.test.ts` passed cleanly here (grep for gate-manifest against the full npm test output matches nothing but source lines, no failures). This is plausibly a genuine environment-dependent flake (different host state at different times legitimately trips different pre-existing, diff-unrelated checks) rather than a fabricated claim, but the CHANGELOG specific file citation is not reproducible from this worktree. Verdict-neutral; worth a one-line correction next time this entry is touched.

### 7. [CLEAN][code-traced] Reason-key sanitization (round 1 findings 3-4, #276/red-team F4) remains structurally sound, uniformly applied — but inherits Finding 5 gap

`friendlyLabelFor`/`unlockHintFor` (`hooks/userpromptsubmit-halt-relay.mjs:205-233`) still route every unmapped-key fallback through the same `sanitizeDetail`, confirmed unchanged in shape from round 1. `Object.hasOwn` (not a bare lookup) still guards both known-key checks against prototype-chain keys (constructor, __proto__, etc.) — no regression. Since this path shares `sanitizeDetail`, it inherits Finding 5 zero-width bypass identically; today reason keys are all fixed literals owned by `sessionstart-tool-enum.mjs` itself (not third-party-controlled), so this sub-path is not independently reachable by an attacker today — noted for completeness, not a separate finding, and closes once Finding 5 fix lands (one shared function).

### 8. [CLEAN][code-traced] Happy paths remain provably unchanged

Traced: the stdin session_id string-type check (now additionally gated by `isValidSessionId`, which any real UUID passes) is otherwise untouched in both files; `resolveFallbackSessionId()`/`isValidSessionId` are only ever consulted on the fallback path. No regression to round 1 finding 8 conclusion.

## Task 4 — Security-completeness angle on the two newer, non-app-security-originated changes

Covered by Finding 5 above (the primary result of this angle): the `neutralizeUnlockToken` structural fix is a genuine improvement over round 2 escapeParens-only approach (closes 4 of red-team demonstrated evasions, confirmed by the 39/39 passing regression suite including all four named shapes), but it is still a **literal-substring** match, and literal-substring matching against untrusted text is exactly the pattern this codebase own header comment (line 95: "Enumerating bracket lookalikes is a losing race") already warns against — the warning was applied to *characters* (parens) but not carried through to the *token* match itself, which has the identical weakness one level up (an invisible character defeats a literal multi-character substring match the same way a lookalike character defeats a literal single-character match). Reason-key sanitization (Task 3, finding 7) shares the same underlying function and therefore the same gap, with no independent exposure today.

## Test evidence
```
node --test hooks/sessionstart-tool-enum-session-id-fallback.test.ts hooks/userpromptsubmit-halt-relay-issue206-unlock-forgery.test.ts hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts hooks/sessionstart-tool-enum-fixnow.test.ts
tests 39, pass 39, fail 0, skipped 0

npm test (full suite, this worktree, HEAD e04dde0)
tests 1058, pass 1057, fail 1, skipped 0
  (1 fail: src/qa/reference-resolver.test.ts, ADR-0021 unresolved citation,
   pre-existing/environment-specific -- uninitialized adr/ submodule, see above)

npm run typecheck -> clean (tsc --noEmit, no output)
npm run lint -> clean (eslint ., exit 0)

git diff 4240ca5..e04dde0 -- package.json package-lock.json -> empty (no new dependency)
```
Finding-5 PoC (zero-width "unlock:" bypass): see Finding 5 above for the full script and output.
Finding-1 re-verification (live env + real shipped-script reproduction): see Finding 1 above.

## Verdict

**REWORK.**

Round 1 two blockers (Finding 1: inert env-var fix / ADR-0021 INT-07 violation; Finding 2: reconcileReason literal-only collision guard) are both **genuinely closed**, independently re-verified via live measurement and end-to-end reproduction against the real shipped code, not just re-reading the implementer own claims. Issue #274 is closed. Issue #96 is comment-confirmed (left open for the merge step, per convention).

One **new** HIGH finding (Finding 5, Issue #277) reopens the same vulnerability *class* (message forgery in a named CRITICAL-tier sensitive area) that drove round 3 own structural rewrite, via a technique (invisible Unicode character breaking a literal-substring match) the rewrite did not anticipate. It is narrower than round 1 blockers — the halt/block itself is never bypassed, only one of two independent sanitization layers, for one specific ("no-bracket") forgery shape, over an already-accepted adversarial channel — but it is demonstrated against the real shipped regex, has a small, well-scoped, structurally-consistent fix, and lands in the same sensitive area this project has already invested three full review rounds defending. Consistent with how this exact mechanism has been treated across rounds 1-3, this gates.

## Next action

Add a Cf-category (Unicode format character) strip to `sanitizeDetail`, run before `neutralizeUnlockToken`, alongside the existing ASCII control-char strip (e.g. `text.replace(/\p{Cf}/gu, "")`). Add a regression test using U+200B inside "unlock" (or any Cf character) to prove the fix and pin against regression, following this file own established per-evasion-shape test pattern. No other change required — Findings 1 and 2 are closed and need no further action.

---
RECEIPT: verdict=REWORK
findings (ALL of them, ranked by exploitability x impact):
1. [ISSUE][HIGH][demonstrated] hooks/userpromptsubmit-halt-relay.mjs:145 (neutralizeUnlockToken) -- the literal /unlock\s*:/gi match is defeated by a zero-width Unicode character (e.g. U+200B) inserted inside "unlock"; survives control-strip and NFKC-normalize, renders invisible, reopens red-team F3 "no-bracket" forgery shape for the same third-party-controlled detail channel (MCP/connector name, or SUR-03-enumeration-failed raw error text). escapeParens (the second layer) is unaffected, so bracketed forgery shapes remain defended -- only the no-bracket shape is reopened. Minimal fix: strip Unicode Cf-category format characters in sanitizeDetail before the unlock-token match. Filed as new Issue #277.
2. [CLEAN][demonstrated] Round-1 Finding 1 (env-var naming bug, ADR-0021 INT-07 violation) is genuinely fixed -- both hook files now read CLAUDE_CODE_SESSION_ID; independently re-verified via (a) my own live process env matching the corrected name, (b) an end-to-end reproduction of round 1 own falsifying test against the fixed code, showing the halt-state file now lands under the real session id, not unknown-session.json. Issue #96 comment-confirmed (left open pending merge).
3. [CLEAN][demonstrated] Round-1 Finding 2 (Issue #274, reconcileReason literal-only collision guard) is genuinely closed by the sessionIdFromStdin provenance redesign -- traced the code, ran the new cross-session collision regression test, and attempted (unsuccessfully) to construct a bypass scenario; the only route requires the host own stdin generation to be wrong, a pre-existing, unverifiable-by-thoth trust boundary, not a gap this diff introduces. Issue #274 commented and closed.
4. [CLEAN][code-traced] New isValidSessionId() (^[A-Za-z0-9._-]{1,128}$) gate closes a latent path-injection surface without narrowing the happy path -- charset excludes all path separators, so no value passing it can produce traversal in haltStatePath join().
5. [CLEAN][code-traced] No new dependency (package.json/lockfile diff empty), no secrets, no shell/eval/deserialization, no new endpoint/authz surface.
6. [CLEAN][demonstrated] Full suite 1057/1058 pass in this worktree; the 1 failure is the same pre-existing, diff-unrelated environment artifact as round 1 (uninitialized adr/ submodule). typecheck and lint both clean.
7. [CLEAN][code-traced] Reason-key sanitization (#276/red-team F4) remains structurally sound and uniformly applied (Object.hasOwn prototype-chain guard intact) -- inherits Finding 1 gap via the shared sanitizeDetail function, but is not independently reachable today (today reason keys are all fixed literals, not third-party-controlled).
8. [CLEAN][code-traced] Both fixes happy paths remain provably unchanged from pre-diff behavior.
counts (checksum): issues=1 suspicions=0 clean=7
evidence (checksum): demonstrated=4 code-traced=4 derived=0
checks="1057/1/0 (1 fail pre-existing/env-unrelated, see Finding 6); 39/0/0 on the new+adjacent regression files; typecheck clean; lint clean"
adr=HIT(2 live; ADR-0021 read from docs/.maat-state.json priorScope history due to uninitialized adr/ submodule)
report=docs/reviews/s5-halt-mechanism-hardening-app-security-round2-2026-09-22.md
