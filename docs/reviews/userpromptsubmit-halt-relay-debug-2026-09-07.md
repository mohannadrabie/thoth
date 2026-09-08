# Debug report: `hooks/userpromptsubmit-halt-relay.mjs` — operator-reported "session appears to die" persists after uncommitted fix

**Debugger:** Serqet (`/maat:debug`)
**Date:** 2026-09-07
**Scope:** `hooks/userpromptsubmit-halt-relay.mjs` (uncommitted working-tree change) — CRITICAL-tier sensitive area (project CLAUDE.md names this file explicitly under "Policy enforcement / session gates").
**ADR cache:** `📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23]` (fp 83b2e3e), CACHE=HIT.

## 1. Wiring — confirmed genuinely live, no conflicts

- `.claude/settings.json` (project) has exactly one `hooks.UserPromptSubmit` entry, `command: node "${CLAUDE_PROJECT_DIR}/hooks/userpromptsubmit-halt-relay.mjs"`, `timeout: 10`.
- `PreToolUse` is deliberately **absent** (per the file's own header, S6-deferred) — not relevant to this event.
- Checked for conflicting/duplicate wiring: `~/.claude/settings.json`, `~/.claude/settings.local.json`, project `.claude/settings.local.json` — **none define any `hooks` key**. No `managed-settings.json` found anywhere on the filesystem.
- Confirmed via official docs (code.claude.com/docs/en/hooks.md) that Claude Code substitutes `${CLAUDE_PROJECT_DIR}`-style placeholders **itself**, before shell invocation, and defaults to Git Bash on Windows when installed (`CLAUDE_CODE_GIT_BASH_PATH` is set in this session's env, confirming Git Bash is present) — ruling out a shell-syntax/quoting wiring failure.
- **Verdict: wiring is genuinely live and singular.** Not the cause.

## 2. Documented contract — verified independently, not taken from the in-code comment

Fetched `code.claude.com/docs/en/hooks.md` directly (WebFetch + WebSearch corroboration):

- **Exit code 2 on `UserPromptSubmit`**: "Blocks prompt processing **and erases the prompt**" — it does **not** terminate/kill the session. The session survives; only that one prompt is blocked and erased.
- **`hookSpecificOutput` schema for `UserPromptSubmit`** (confirmed field list): `hookEventName`, `additionalContext`, `systemMessage` — exactly what the in-code comment claims, and exactly what the uncommitted code emits. No `permissionDecision`/`decision`/`reason` fields exist for this event (those are `PreToolUse`-only) — confirmed correct.
- **Visibility table**: `systemMessage` → "Yes, in transcript" (both user and Claude see it); `additionalContext` → hidden from user, Claude-only.
- **Timeout behavior**: a timed-out command hook is cancelled and its output discarded; docs do not say a timeout kills the session — only that hook's own decision is dropped.

**Conclusion:** the JSON-shape correction (nesting `systemMessage` under `hookSpecificOutput`) in the uncommitted fix is **verified correct** against the real documented schema, not just the in-code paraphrase. The premise that exit-2 "kills the session" is **false** per docs — the real behavior is prompt-block-and-erase, session survives.

## 3. Direct reproduction of the script's own I/O

Built a real halt-state fixture matching `hooks/sessionstart-tool-enum.mjs`'s actual write shape (`{sessionId, reasons: {<key>: {set, detail, setAt}}}`) at `.thoth/halt-state/<id>.json`, then ran the uncommitted script directly via `node hooks/userpromptsubmit-halt-relay.mjs` piping a realistic `{"session_id":...,"prompt":...}` stdin payload, output redirected to files (non-TTY, matching the piped-not-TTY condition the code comment worries about):

```
EXIT CODE: 2
STDOUT: {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","systemMessage":"thoth halt: session debug-repro-1788828023 blocked -- SUR-03-unclassified-tool: unclassified: github, aws-mcp-server"}}
STDERR: thoth halt: session debug-repro-1788828023 blocked -- SUR-03-unclassified-tool: unclassified: github, aws-mcp-server
```

Well-formed JSON, correct exit code, matches the verified schema. The `anyReasonSet`/malformed-detection logic and halt-state read path both work correctly — **not the cause**.

Also ran a 100-iteration `spawnSync`-based harness (piped stdio, mirroring how a parent captures a child hook's output) comparing the **old** approach (`process.stdout/stderr.write()` + immediate `process.exit(2)`) against the **new** approach (`fs.writeSync` on raw fd). Under a well-behaved reader (parent waits for the child to exit and drains fully — the same behavior `spawnSync`/`execFileSync`-style consumers use), **both approaches delivered the message intact 100/100 times, exit code 2 both times.** The "flush-before-exit race" the header comment describes as "especially prone to lagging on Windows pipes" **did not reproduce under normal conditions on this exact runtime** (Node v24.15.0, Windows 11) — so that theorized race is not demonstrated to be the operator's actual problem.

## 4. Root cause — demonstrated, not guessed

Tested one more condition: what happens when the **reader** of the hook's stdout pipe stops reading / closes its end **before** the hook script's synchronous write executes — the same class of Windows-specific behavior independently reported in a different (but structurally identical) UserPromptSubmit hook: [`thedotmack/claude-mem#2604`](https://github.com/thedotmack/claude-mem/issues/2604) — "UserPromptSubmit hook blocks prompts on Windows... stdout pipe closes before the hook completes... write error."

Reproduced this **3/3 times against the real, uncommitted `hooks/userpromptsubmit-halt-relay.mjs` file itself** (not a toy analog) — spawned the real script with a real halt-state fixture, destroyed the parent's read end of the child's stdout pipe ~5ms after spawn, stderr left inherited/visible:

```
thoth halt: session pipe-close-real-1788828328692 blocked -- SUR-03-unclassified-tool: unclassified: github
thoth halt: userpromptsubmit-halt-relay.mjs hit an internal exception and is failing closed (blocking): EPIPE: broken pipe, write
Error: EPIPE: broken pipe, write
    at writeSync (node:fs:917:3)
    at blockWithMessage (file:///C:/playground/thoth/hooks/userpromptsubmit-halt-relay.mjs:113:3)
    at main (file:///C:/playground/thoth/hooks/userpromptsubmit-halt-relay.mjs:154:5)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
node:fs:917
  handleErrorFromBinding(ctx);
  ^
Error: EPIPE: broken pipe, write
    at writeSync (node:fs:917:3)
    at file:///C:/playground/thoth/hooks/userpromptsubmit-halt-relay.mjs:180:3
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5) {
  errno: -4047, syscall: 'write', code: 'EPIPE'
}

=== REAL HOOK FILE exit code: 1 signal: null ===
```

**Mechanism (line-cited against the actual uncommitted file):**

1. `blockWithMessage()`'s `writeSync(1, jsonPayload)` at **line 113** throws a synchronous, uncaught `EPIPE` when the stdout pipe's reader is gone. Neither `writeSync` call in `blockWithMessage` (lines 112–113) nor in the top-level exception handler (line 180) is wrapped in `try/catch`.
2. Because `blockWithMessage` is called synchronously from inside the `async function main()` (from the `anyReasonSet` branch, line 154, or the malformed branch, line 147), the throw becomes a rejected promise that `main().catch(...)` (lines 161–182) **does** catch.
3. But that catch handler **re-attempts the identical unguarded write** (`writeSync(1, ...)` at line 180) against the still-broken pipe — which throws EPIPE **again**, this time with no handler left. Node's default uncaught-exception path fires, prints its own raw stack trace, and the process exits with **code 1**.

**Net effect — this is strictly worse than the pre-fix bug it was meant to solve, not equivalent to it:**
- **No `systemMessage` ever reaches stdout** (write throws before completing) — same "no message" symptom the fix was meant to solve, still present.
- **Exit code degrades from the intended 2 to 1.** Per the documented exit-code table (§2), exit code 2 is what blocks-and-erases the prompt on `UserPromptSubmit`; a plain exit code 1 is not documented as carrying that blocking semantic. This is a **fail-open regression on a fail-closed CRITICAL-tier gate** — introduced by this exact uncommitted change, in the precise adversarial condition (host not reading the hook's stdout promptly) that a real, independently-reported Windows bug for this same event says does occur in the wild.
- Whatever raw Node stack trace the host does or doesn't surface is not the intended human-readable `"thoth halt: ..."` line — fully consistent with the operator's "still confusing, no readable explanation" report after applying this exact fix.

**By contrast**, the **old** (pre-fix) `process.stdout/stderr.write()` approach, run through the identical broken-pipe test, does **not** crash — `Writable.write()` to a broken pipe queues an async `'error'` event that never fires before `process.exit()` tears the process down, so the write is silently swallowed but the process still exits cleanly with the **intended code 2**. This matches the file's own header's account of the *original* bug (exit 2, no message) — but shows the new `fs.writeSync` fix, under exactly the condition it says it's guarding against, actually trades "silently lost message, correct exit code" for "silently lost message, WRONG exit code, uncaught crash trace." The "flush race" the header cites as motivation was not reproduced under normal conditions (§3); the adversarial condition that *was* reproduced was never the one the fix was designed against.

## 5. What is confirmed vs. what remains open

**Confirmed (demonstrated, this session):**
- Wiring is live, singular, uncorrupted (§1).
- The JSON schema fix (`hookSpecificOutput.systemMessage`) matches the real documented contract (§2).
- Exit code 2 on `UserPromptSubmit` blocks/erases the prompt; it does **not** kill the session (§2) — contradicts the "session death" framing at face value.
- Halt-state read/parse/`anyReasonSet` logic is correct (§3).
- An unguarded `fs.writeSync` on the hook's own stdout/stderr crashes the script with an uncaught `EPIPE` and **downgrades exit code 2 → 1** when the pipe's reader is unavailable at write time — reproduced 3/3 against the real uncommitted file (§4).

**Not confirmed (cannot be tested from this non-interactive sandbox):**
- Whether the VS Code-extension-hosted Claude Code client's own hook-output reader actually exhibits the "closes/doesn't-read-promptly" pipe behavior that triggers §4 on the operator's machine specifically, as opposed to some other host-side rendering gap for `systemMessage`. The community report (`claude-mem#2604`) demonstrates this class of Windows behavior exists for this exact hook event in a different codebase, and §4 shows the local code is unsafe against it regardless — but I did not drive a live VSCode chat session end-to-end.
- Whether, once the EPIPE crash is fixed, the VS Code extension host renders `hookSpecificOutput.systemMessage` prominently enough in the transcript for the operator to recognize it as "the explanation" (vs. terminal-CLI rendering, which the docs describe uniformly but do not evidence per-client).

## 6. Proposed fix direction (diagnosis only — not implemented)

1. **Minimal, targeted fix:** wrap every `writeSync` call (both inside `blockWithMessage` and the inlined duplicate in the top-level `main().catch()` handler) in its own `try { } catch { }` that swallows the error. `process.exit(2)` must be the last statement executed **unconditionally** on every blocking path, never reachable only through a write that can itself throw. Message delivery is best-effort; the block (exit 2) is the actual security property and must never degrade to exit 1 because a message-delivery write failed.
2. Do **not** re-litigate `process.stdout.write` vs `fs.writeSync` as the primary fix — §3 shows the write-race that motivated switching to `writeSync` isn't demonstrated under normal conditions on this runtime, while §4 shows `writeSync`'s synchronous-throw behavior is exactly what turns a benign swallowed-write into an uncaught crash. Either primitive works once guarded; the guard (try/catch never allowed to escape to an uncaught exception) is the actual fix, not the choice of write API.
3. Separately flag (not blocking, cosmetic): the docstring on `blockWithMessage` (lines 92–99) claims a third destination, `hookSpecificOutput.permissionDecisionReason`, that the function's actual code does not write — stale comment vs. implementation, harmless (the field doesn't apply to `UserPromptSubmit` per §2) but should be corrected for accuracy when this is fixed.
4. Recommend a live smoke test (an actual VS Code Claude Code session with a genuine halt-state fixture) once the crash fix lands, to close the one item in §5 that can't be verified from this sandbox.

## Risk tier & required reviewers

**CRITICAL** — this file is explicitly named under this project's CLAUDE.md "Sensitive areas → Policy enforcement / session gates" (hooks wired to `UserPromptSubmit`), and the defect found is a fail-open regression on a fail-closed gate. Per the tier table: `red-team` (adversarial) + the relevant domain reviewer (`app-security-reviewer`, since this is application/Node code implementing a security-relevant control), plus `cross-domain-reviewer` (joins every tier above TRIVIAL, uncounted against the reviewer cap).

**Verdict note:** this is diagnosis only, per explicit task instruction — no fix has been applied to `hooks/userpromptsubmit-halt-relay.mjs`. The root cause is demonstrated (§4, reproduced 3/3 against the real file), and it constitutes a genuine security-relevant regression (fail-open on a fail-closed CRITICAL-tier gate) in the *uncommitted, unmerged* working-tree change — this is exactly the shape of finding this project's CLAUDE.md says never merges without the named reviewers. It is flagged BLOCKED (not FIXED) so the Manager routes it to `story-implementer` to apply the minimal fix in §6, then to `red-team` + `app-security-reviewer` + `cross-domain-reviewer` to gate it, before any merge. No human-only action is implicated (this is a repo-local hook script, not IAM/prod/destructive-SQL), but the CRITICAL-tier reviewer ceremony is not optional here.

---

RECEIPT: verdict=BLOCKED tier=CRITICAL regressionCheck=passed adr=HIT(35) report=docs/reviews/userpromptsubmit-halt-relay-debug-2026-09-07.md
