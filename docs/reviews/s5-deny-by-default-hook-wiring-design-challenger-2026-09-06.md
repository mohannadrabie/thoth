# S5 Phase 1 Plan — Design Challenger (pre-build), round 1

**Scope:** `docs/plans/S5-phase1-2026-09-06.md` (Milestone #23, "Deny-by-default + hook wiring"). CRITICAL tier. Attacked BEFORE any code is written — `hooks/` directory confirmed absent from the working tree and from `master`'s entire history.
**Reviewer:** design-challenger (Apep)
**Date:** 2026-09-06
**Round:** 1 of this artifact. No prior design-challenger report exists for S5 (checked: `docs/reviews/s5-*design-challenger*` — no match). Frozen set from the sibling pre-build `architecture-reviewer` pass (`docs/reviews/s5-deny-by-default-hook-wiring-architecture-2026-09-06.md`, APPROVE-WITH-CONDITIONS) is noted below but not re-litigated here except where it bears directly on an attack.
**`docs/.maat-state.json`:** `reviewRoundsSinceClean: 0`, `humanRulingRequired: false`, `councilHeld: false` — clear to run.

## What was read

`docs/plans/S5-phase1-2026-09-06.md` (full), `docs/STATE.md`, `docs/decisions.md` (all rows, esp. the two 2026-09-06 S5 rows), `adr/software-engineering/0021-thoth-native-architecture.md` (full), `REQUIREMENTS.md` (SUR-02/03/05/09–14, OPS-01–05, G2–G8, T1'/T11, threat-register table), `docs/reviews/s5-deny-by-default-hook-wiring-architecture-2026-09-06.md` (sibling pre-build pass, for frozen-set purposes). Code-traced against the actually-shipped artifacts this plan will call into: `src/policy/kernel/kernel.ts`, `src/policy/tools/classification.ts`, `.claude/settings.json` (full, with line numbers). Ran real commands against this repo's live git history and this machine's actual Node runtime (below) — this is not a prose-only pass.

## Attacks, ranked by blast radius (exposure × irreversibility × silence)

### 1. T11's spike methodology measures the wrong latency — the declared timeout will likely be set below real per-call cost, turning the gate into a routine, silent bypass from day one

**Scenario.** The plan's spike (§5, steps 1–4) measures `normalize("shell", raw) + decide(worldFacts, action)` wall-clock via `process.hrtime.bigint()` in a warm loop (`≥1000 iterations`), then declares `timeout = safety-margined multiple of measured p99`. This benchmarks only the in-process function calls. It does not measure the actual unit of work Claude Code times against the declared `timeout`: a fresh `node "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs"` **subprocess**, from spawn to exit, including module resolution/TypeScript type-stripping of `kernel.ts`/`shell.ts`/`registry.ts` and their import graph, stdin JSON read, and stdout JSON write. Every real `PreToolUse` invocation pays that subprocess cost; the spike's loop pays it exactly once (to start the benchmark harness) and then amortizes it away.

**Evidence (demonstrated — ran it on this exact machine, in this exact repo, just now):**
```
node -e "
const {execSync} = require('child_process');
const N = 20; const times = [];
for (let i=0;i<N;i++){
  const start = process.hrtime.bigint();
  execSync('node -e \"1+1\"', {stdio:'ignore'});
  times.push(Number(process.hrtime.bigint()-start)/1e6);
}
times.sort((a,b)=>a-b);
console.log('min='+times[0].toFixed(1)+'ms max='+times[19].toFixed(1)+'ms p50='+times[10].toFixed(1)+'ms p95='+times[19].toFixed(1)+'ms');
"
→ min=148.3ms max=175.0ms p50=162.3ms p95=175.0ms
```
A bare `node -e "1+1"` — the absolute floor of "spawn a Node process and exit," with zero module loading, zero I/O — already costs 148–175ms wall-clock on this machine. `hooks/pretooluse-kernel-gate.mjs`'s real invocation adds TypeScript-transpiled module loading of the kernel/normalizer/registry graph, stdin read, and JSON serialization on top of that floor — it will not be cheaper. The pure `normalize()+decide()` function calls the spike actually measures are synchronous string/array operations over small inputs and will almost certainly land in the sub-5ms range even for the plan's own "worst-case constructions" (depth-cap-5 nesting, long multi-target commands) — two to three orders of magnitude below the process-spawn floor already measured above.

If T11's declared `timeout` is derived as "a safety-margined multiple" of the narrow function-only p99 (e.g., p99≈2–5ms × a 10–20x margin ≈ 20–100ms), it will sit **below** the real per-invocation floor this exact machine already demonstrates (148–175ms, before any module-loading is even added). Every real `Bash` call would then hit the declared timeout — and per gap G6, already documented in this repo's own `REQUIREMENTS.md:466/468/633` and restated in `.claude/settings.json:68` for the existing hook ("a timed-out `PreToolUse` hook does not block... the call proceeds through the normal permission flow"), a timeout is a **bypass, not a delay**. The mechanism this entire story exists to build would silently no-op on essentially every Bash call from the first day it runs, with no alert beyond stderr text shown to the user's transcript (never fed to the model, never logged to any evidence trail — no evidence trail exists for this hook at all per the architecture-reviewer's finding 5).

**Exposure:** ~100% of live `Bash` calls in any session governed by these hooks, once deployed, if the timeout is derived as literally specified. Basis: **measured** (the subprocess-floor number above, on this repo's own machine) against the plan's own stated derivation method (§5 step 4).

**Reach:** user. Entry point: `.claude/settings.json`'s planned new `PreToolUse` hook entry for `hooks/pretooluse-kernel-gate.mjs`, matcher `Bash` (plan §5, "New files," first bullet) — fires on every real `Bash` tool call any user's session makes once wired.

**Current defense:** none. The plan's own spike design (§5 steps 1–2) explicitly scopes the measurement to the two named function calls, not the invoked command. Step 3 confirms Claude Code's documented *default* timeout ceiling (600s) but the plan does not propose using that default — it deliberately derives a tight, measured number, which is the right instinct applied to the wrong measurement.

**Tags:** severity **HIGH** · evidence **demonstrated** · reach **user** · likelihood **routine** · undo: silent (no alert reaches the model or any evidence trail; keeps severity per the silent-effect rule) → **irreversible in effect** until someone notices independently.

**Verdict: BREAKS.**

**Proof-test to write before Phase 2:** extend the T11 spike (or add a sibling measurement) that invokes the real hook script as a subprocess — `spawnSync("node", ["hooks/pretooluse-kernel-gate.mjs"], {input: <realistic stdin JSON>})` — ≥30 times on the actual target machine class, recording p50/p95/p99 of the **subprocess** wall-clock, not the in-process function call. Assert in a committed test that the declared `timeout` in `.claude/settings.json` is a safety-margined multiple of *that* number. Today, running the 8-line snippet above already demonstrates the subprocess floor (148–175ms) dwarfs any plausible function-only p99 — this is not a hypothetical regression, it is the starting condition.

---

### 2. `.claude/settings.json`'s existing `PreToolUse` hook already references a script that has never existed on `master` — the plan's "leave it untouched" assumption inherits a live, silent, fail-open defect, undetected through four prior CRITICAL-tier review cycles

**Scenario.** `.claude/settings.json:96/100` wires:
```json
"matcher": "Edit|Write|MultiEdit|NotebookEdit",
"command": "node \"${CLAUDE_PROJECT_DIR}/hooks/report-subject-gate.mjs\""
```
This entry, and the extensive header comment above it (`.claude/settings.json:39-69`) describing it as a shipped, functioning "report-subject AUDIT recorder" that hash-chains every verdict to `docs/gate-audit.log` via `hooks/audit-log.mjs`, has been committed on `master` since `master`'s own orphan **Initial commit** (`a5448c6`).

**Evidence (demonstrated — ran these commands just now):**
```
$ git ls-files | grep -i hook          → (no output — no hooks/ file tracked on master)
$ git log --oneline --all -- hooks/    → a7af1c2 Record thoth's own protected-path write verdicts (advisory, not enforcing)
$ git merge-base --is-ancestor a7af1c2 HEAD  → NO-not-ancestor
$ git branch --all --contains a7af1c2  → feat/report-subject-audit-recorder   (only)
```
`hooks/report-subject-gate.mjs` and `hooks/audit-log.mjs` exist **only** on the abandoned `feat/report-subject-audit-recorder` branch — the branch `docs/decisions.md`'s 2026-08-29 row explicitly records as *not* the build target ("left untouched on disk, not built on, not merged, not deleted"). `master`'s Initial commit nonetheless shipped a `.claude/settings.json` that already wires a `PreToolUse` hook to that never-merged file, with a header comment asserting the mechanism works as designed. **On `master`, right now, this file does not exist.**

**Consequence.** Per Claude Code's documented hook exit-code contract (0 = success, 2 = blocking, any other non-zero = non-blocking error shown to the user only, tool call proceeds) — the same contract this repo's own G6 disclosure already relies on — a `node` invocation against a missing file exits non-zero (module-not-found) but is **not** exit code 2. That is a **non-blocking** hook error: the Edit/Write/MultiEdit/NotebookEdit call proceeds exactly as if no hook were configured at all. Every claim in the header comment (EVD-06/07/08/09/14 compliance, a tamper-evident hash-chained log at `docs/gate-audit.log`) is fictional in the actual, currently-committed state of this repo. This is not a hypothetical for S5 to introduce — it is the present, live, undetected state of the one sensitive-area hook this codebase has claimed to ship since S1.

**This slipped past the sibling pre-build review too.** `docs/reviews/s5-deny-by-default-hook-wiring-architecture-2026-09-06.md` finding 5 and finding 8 both cite "`hooks/report-subject-gate.mjs` (the existing, already-shipped sensitive-area hook)" and tag the claim `[code-traced]` — but the trace was against the header comment's own self-description, not against the file's actual existence. That reviewer's "What was read" section lists `.claude/settings.json` but not `hooks/report-subject-gate.mjs` itself, nor a `git ls-files hooks/`. This corroborates the finding's severity: the defect has now survived S1 through S4's full CRITICAL-tier ceremony (multiple `red-team`/`app-security-reviewer`/`cross-domain-reviewer`/`architecture-reviewer` rounds) plus this story's own pre-build architecture pass, undiscovered, because every reader trusted the file's own header comment rather than checking the referenced path.

**Why this matters for S5 specifically.** The plan's §5 "Edited files" line reads: "`.claude/settings.json` (append new `Bash`/`SessionStart`/`UserPromptSubmit` hook entries to the existing array — `report-subject-gate.mjs`'s entry untouched...)." This treats the existing entry as a known-good precedent to model the new entries' shape on, and as something safe to leave alone. Neither is true: it's a broken precedent, and "untouched" preserves rather than fixes a live defect in a file this plan is *also* about to add three more hook entries to, using the identical `command: "node \"${CLAUDE_PROJECT_DIR}/hooks/<name>.mjs\""` shape — with no instrument anywhere in the plan (`gate-matcher-drift-check.ts` checks tool *names* against a vendored snapshot; `gate-manifest-check.ts` counts *files that define a `hooks` key*) that would catch a referenced script path failing to resolve to a real file, either for the old entry or the three new ones this story adds.

**Exposure:** 100% of `Edit`/`Write`/`MultiEdit`/`NotebookEdit` calls in any live Claude Code session using this repo's own `.claude/settings.json`, today, prior to any S5 code. Basis: **counted in code** — confirmed via `git ls-files`/`git log --all`/`git merge-base`, not assumption.

**Reach:** user. Entry point: `.claude/settings.json:94-106` (`hooks.PreToolUse[0]`), matcher `Edit|Write|MultiEdit|NotebookEdit` — the most routine tool-call shape in any coding session.

**Current defense:** none. `SUR-05`'s planned drift check compares tool *names* referenced by matchers against the vendored tool-name snapshot; it has no concept of "does the command string's file path resolve." `SUR-13`'s planned manifest check counts hooks-key-defining files, not command validity.

**Tags:** severity **HIGH** · evidence **demonstrated** · reach **user** · likelihood **routine** · undo: silent (four review cycles missed it; keeps severity).

**Verdict: BREAKS.**

**Proof-test to write before Phase 2:** a structural CI check — sibling to `gate-manifest-check.ts`/`gate-matcher-drift-check.ts` — that parses every `hooks.*[].hooks[].command` string in the one manifest file, extracts the referenced script path (resolving `${CLAUDE_PROJECT_DIR}`-style variables against the repo root), and asserts the file exists on disk. Run it today, before writing any other S5 code, against the committed `.claude/settings.json`: it FAILS red immediately (`hooks/report-subject-gate.mjs` absent) — this is the fastest possible confirmation that the check is non-vacuous, and it must also gate the three new entries this story is about to add.

---

### 3. The live `Bash`-only matcher, plus a project-file-only enumeration model, leaves every MCP-server-provided mutating tool completely outside any deny-capable gate — and outside the SUR-03 halt's own field of view

**Scenario.** Two compounding gaps, both real today, neither addressed by the plan's own disclosed findings:

**(a) No gate at all for non-Bash, non-Edit/Write/MultiEdit/NotebookEdit tool calls.** The plan's finding 2 (ratified) scopes the live, deny-capable `PreToolUse` matcher to `Bash` only, and separately discloses that Claude Code's other *built-in* mutating tools (`Edit`/`Write`/`MultiEdit`/`NotebookEdit`) stay ungated (routed only to the broken advisory hook from attack #2). It never names the much larger category: any **MCP-server-provided** tool. Criterion 3 ("SUR-02: ...terminal fall-through is deny") is true only for a call whose `ActionRecord` reaches the kernel at all — an MCP tool call is never routed to `PreToolUse`'s `Bash`-matcher hook in the first place, so SUR-02's fall-through-deny guarantee, real as it is one layer down (`src/policy/normalizer/registry.ts`), never gets invoked. The only theoretical backstop is SUR-03's SessionStart-computed, next-turn-only halt (criterion 4) — which requires the tool to have been *enumerated* at all.

**(b) The enumeration model is scoped to one settings file, not to Claude Code's real, multi-scope settings hierarchy.** The plan's ratified finding 1 states the tool universe is "vendored built-in snapshot ∪ configured MCP servers (currently none, per this repo's own `.claude/settings.json`)." `.claude/settings.json:92` confirms `"enableAllProjectMcpServers": false` and no `mcpServers` key — i.e., the *project*-scope surface is genuinely empty. But Claude Code's own documented settings precedence layers enterprise/user/project/local scopes, and MCP servers are commonly configured at the user (global) level, entirely outside any file this repo's own `sessionstart-tool-enum.mjs` is described as reading.

**Evidence (demonstrated — this is not hypothetical, it is the observed state of the live environment this review is running in):** this very design-challenger session has upward of a dozen active MCP connectors (`mcp__github__push_files`, `mcp__github__merge_pull_request`, `mcp__claude_ai_Gmail__send_message`, `mcp__claude_ai_Google_Drive__trash_file`, `mcp__claude_ai_Google_Calendar__delete_event`, among others) — real, currently-invocable, mutating tools — **none of which appear anywhere in thoth's project-scope `.claude/settings.json`**, which was read in full above and contains no `mcpServers` key at all. This directly demonstrates that a session's real, live tool surface is not fully determined by a repo's own project-scope settings file — exactly the scope the plan's finding 1 names as its enumeration source. thoth's own team has already documented awareness of this multi-scope pattern for *other* settings keys in the very same file (`.claude/settings.json:21-23`: "Claude Code's own settings hierarchy scopes this key to managed-settings.json, deployed outside any single repo, which this project does not operate") — but finding 1's enumeration model doesn't extend that same awareness to MCP-server discovery.

**Compound effect.** A session with any personally-configured MCP tooling (an unremarkable, common developer setup — directly evidenced above) has an entire class of real mutating capability — pushing to git remotes, merging pull requests, sending email, deleting calendar events, trashing files — that: is never routed to a deny-capable gate (a), and is never even seen by the one enumeration mechanism that could otherwise flag it unclassified and halt the session (b). No halt fires. No deny fires. No log entry is written (no evidence trail exists for any of this yet, per the architecture-reviewer's finding 5). The action simply succeeds, silently, exactly as if none of S5's machinery existed.

**Exposure:** unbounded across "however many MCP tools are configured outside the project's own `.claude/settings.json`" — demonstrated non-zero in this very session. Basis: **demonstrated** (this session's own directly observed tool list), not assumption.

**Reach:** user. Entry point: any `mcp__*` tool call site available to a governed session — concretely, `mcp__github__push_files` or `mcp__claude_ai_Gmail__send_message`, both live in this conversation right now.

**Current defense:** none for (a) — matcher scope is `Bash` only, by explicit, already-ratified design. Partial, unproven defense for (b) — SUR-03's halt exists in principle but its enumeration source is scoped narrower than the runtime's real tool surface.

**Tags:** severity **HIGH** · evidence **code-traced + demonstrated** · reach **user** · likelihood **routine** (personally-configured MCP tooling is common, not exotic) · undo: silent, irreversible in effect (no record of the bypass exists to undo from).

**Verdict: BREAKS.**

**Proof-test to write before Phase 2:** (i) a fixture test asserting `sessionstart-tool-enum.mjs`'s tool-universe computation is built to read MCP server configuration from every scope Claude Code documents (not project-scope `.claude/settings.json` alone) — or, if that is genuinely infeasible pre-S6, an explicit acceptance criterion stating this scope limitation in the same disclosed-gap language the plan already uses for finding 2/3, rather than the current silent omission; (ii) a fixture proving that a session whose live tool set includes an MCP-provided mutating tool not present in project-scope config still halts (or is otherwise denied) rather than executing ungated — write it today and watch it fail, since as designed, nothing in this plan closes it. If closing this requires a mechanism beyond static config reading (e.g., some cross-scope introspection this runtime doesn't expose), that is a real architectural question, not a code fix — route it to `architecture-reviewer` rather than treating finding 1/2's existing disclosure as if it already covers this case.

---

### 4. `sessionstart-tool-enum.mjs`'s own internal-exception handling is unspecified — and SessionStart can never block regardless of exit code, so an uncaught exception here silently defaults the flagship "deny-by-default" halt to no-halt

**Scenario.** The plan explicitly designs fail-closed exception handling for `hooks/pretooluse-kernel-gate.mjs` ("Every SUR-10 fail-open path explicit: try/catch whole body, exit 2 + stderr on internal exception"). It says nothing equivalent for `hooks/sessionstart-tool-enum.mjs` beyond "on `haltRequired`, writes a gitignored, `session_id`-correlated halt-state file." If the enumeration computation itself throws **before** reaching that write (a malformed catalog, an I/O error reading the vendored snapshot, an unexpected tool-name shape), the halt-state file is simply never written for that session. Unlike the `PreToolUse` gate, `SessionStart`'s own exit code cannot rescue this: per ADR-0021's own text (gap G5, restated in `REQUIREMENTS.md:632`) "a `SessionStart` hook cannot stop a session. Exit code 2 on that event shows stderr to the user and the session proceeds" — so even a maximally defensive `exit 2` on internal exception does not itself halt anything; only the *absence of a halt-state file* controls what `userpromptsubmit-halt-relay.mjs` later does, and the plan never states that the enumeration script's own failure path produces one.

This directly inverts this codebase's own established fail-closed convention: `pol05Rule`/`isMutating` (`src/policy/kernel/kernel.ts:66-96`) and `evaluateToolInventory` (`src/policy/tools/classification.ts`) both treat ambiguity/unclassifiability as something that must *widen* the deny surface, never narrow it. An unspecified exception path in the one script whose entire job is "halt on anything I can't classify" defaulting to *no halt* is the same class of near-miss ADR-0021's own Issue #62 history (`src/policy/kernel/kernel.ts:47-56`, cited in that file's own comments) already identifies and fixed once in the kernel — the plan doesn't show it has been carried into this new script.

**Evidence:** derived from the plan's own text (`hooks/sessionstart-tool-enum.mjs`'s description omits this) and the shipped ADR-0021/G5 text establishing SessionStart's own exit code is powerless to halt regardless. No code exists yet to run directly against.

**Exposure:** every session whose `sessionstart-tool-enum.mjs` run throws before writing halt state — plausible on a real fault (malformed config, an I/O hiccup), not routine. Basis: assumption bounded by the shipped G5 text, not measured.

**Reach:** user. Entry point: `SessionStart` firing at the start of any session using this repo's hooks, the moment `sessionstart-tool-enum.mjs` is wired.

**Current defense:** none named in the plan for this specific script's own failure path.

**Tags:** severity **MED** (evidence=derived caps it here) · evidence **derived** · reach **user** · likelihood **plausible** · undo: silent — effect crosses the same security boundary SUR-03 exists to hold (an unclassified/unenumerable tool universe silently defaulting to unhalted). Per the boundary-crossing carve-out, this MED **must** route to a proof-test, not the residual register, regardless of the derived-evidence cap.

**Verdict: UNPROVEN** (no code exists yet to demonstrate it either way; the gap is in what the plan does *not* specify).

**Proof-test to write before Phase 2:** a unit test on `sessionstart-tool-enum.mjs` that feeds it a deliberately malformed/corrupt classification-catalog input (mirroring the existing `selftest-fixture` pattern `kernel-purity-check.ts`/`normalizer-registry-purity-check.ts` already use) that would throw before `evaluateToolInventory`'s result is written, and asserts the script still results in a halt-state file being written — fail-closed on its own internal exception, not silent no-halt. Write it red against the plan's current description, then make it pass.

---

### 5. A session can silently widen its own tool universe mid-session by editing `.claude/settings.json` — SUR-03's enumeration never re-runs until the next `SessionStart`

**Scenario.** `.claude/settings.json` is a normal, session-writable file (already the subject of the plan's own §0.4-disclosed finding 3, in the context of the *bootstrap ruleset* specifically — the same property applies to the settings file itself). Session-start enumeration (SUR-03, criterion 4) computes the tool universe **once**, at `SessionStart`. Nothing in the plan re-triggers enumeration on a live settings change within the same session. If a session (whether by legitimate maintenance work — this exact story edits this exact file — or under adversarial influence) adds an MCP server entry to `.claude/settings.json` mid-session, and Claude Code picks it up without a full session restart, the newly available tools were never part of the SessionStart-computed universe and are never checked as unclassified; the halt mechanism has nothing to fire on until a brand-new session begins.

**Evidence:** derived from the plan's own text (enumeration is described only as a `SessionStart`-time computation) plus the demonstrated fact that `.claude/settings.json` is an ordinary tracked file with no in-session write protection beyond the already-broken advisory hook (attack #2) — an `Edit` call against this exact file triggers the same non-functional gate as any other edit.

**Exposure:** requires a session to actually edit its own governing config mid-session — plausible (this is routine maintenance work in this exact codebase), not universal. Basis: assumption about Claude Code's MCP-config hot-reload behavior, not measured this session.

**Reach:** user. Entry point: an `Edit`/`Write` call against `.claude/settings.json` itself, mediated by the (currently broken, attack #2) `PreToolUse` hook at `.claude/settings.json:94-106`.

**Tags:** severity **MED** (derived cap) · evidence **derived** · reach **user** · likelihood **plausible** · undo: silent, security-boundary-adjacent (self-escalation of tool grants) → boundary-crossing carve-out applies, routes to proof-test, not residual register.

**Verdict: UNPROVEN.**

**Proof-test to write before Phase 2:** name (do not build) a test that demonstrates whether Claude Code re-reads MCP server configuration mid-session without a restart, and if so, whether any mechanism in this design re-triggers SUR-03's enumeration before the next mutating call. If closing this requires new topology (a live config-watch, a re-enumeration trigger tied to file-change detection), route to `architecture-reviewer` — this is not a small code fix, it is a new cross-request protocol question.

---

### 6. SUR-05's drift check can only catch a referenced-but-missing tool name — it structurally cannot catch a present-but-unreferenced one (a new Claude Code built-in shipped in a version bump)

**Scenario.** Criterion 5 states SUR-05 "fails loudly if a tool name referenced by the classification catalog or a hook matcher is absent from the vendored built-in-tool snapshot." This only checks one direction: a name already written into the catalog/matcher that the snapshot doesn't corroborate. It has no way to detect the opposite and more dangerous direction — a genuinely new built-in tool Claude Code ships in a later version, present in a live session, absent from both the vendored snapshot and the classification catalog. Given finding 1's own confirmed fact (no live tool-enumeration API exists — `anthropics/claude-code#6574` is an open upstream request), there is no mechanism anywhere in this design that could ever discover such a tool exists until a human manually re-vendors the snapshot after reading a changelog. Such a tool wouldn't even register as "unclassified" (which at least halts, per SUR-03) — it would be outside the universe `evaluateToolInventory` is ever handed at all, i.e., invisible rather than flagged.

**Evidence:** derived directly from the plan's own criterion 5 text and finding 1's own confirmed no-live-API fact — both already-written artifacts, not speculation about future Claude Code releases.

**Exposure:** fires only on a future Claude Code version bump introducing a new tool type — plausible over this project's lifetime, not present today. Basis: assumption about future upstream releases.

**Tags:** severity **MED** (derived cap) · evidence **derived** · reach **user** · likelihood **plausible** · undo: silent, security-boundary-adjacent → boundary-crossing carve-out, routes to proof-test/disclosure, not residual register.

**Verdict: UNPROVEN-pending-verification.** No proof-test can fully close this — it is a genuine epistemic limit absent a live-enumeration API upstream, not a build gap this project can code its way out of.

**What would settle it:** nothing today; the honest disposition is a disclosure. **Recommendation is disclosure only, not a mechanism** — SUR-05's own acceptance text/plan criterion 5 should say plainly what it does *not* catch (present-but-unreferenced tools), mirroring this project's own disclosure convention already used elsewhere (`.claude/settings.json`'s own header, `REQUIREMENTS.md`'s G4 pattern), rather than "fails loudly" reading as broader coverage than a referenced-name-only diff provides.

---

### 7. §0.4's file-header-only disclosure for `bootstrap-ruleset.ts` is thinner than a mitigation this project already has for free

**Scenario.** The already-ratified §0.4 disclosed gap (plan finding 3) is not re-litigated here. What is in scope: the plan's proposed *mitigation* for that disclosed gap is a file-header comment only. CLAUDE.md's own "Sensitive areas" section already names "Policy delivery / config surface — anything that changes how policy is authored or delivered to the enforcement point" as a standing sensitive-area convention requiring a named reviewer before merge — `bootstrap-ruleset.ts` plausibly falls under this today, and the story's CRITICAL-tier ceremony likely covers it by virtue of reviewing the whole diff. But the plan's own constraints section (§4) doesn't explicitly name `bootstrap-ruleset.ts` under this convention, and no structural check (mirroring `SUR-13`'s `gate-manifest-check.ts`, or the EVD-06/07/08-style unlock-declaration checks this project already knows how to build) flags a future, unreviewed edit to this specific file the way this project's own established conventions do for other protected paths.

**Evidence:** derived — a comparison between what this project's own conventions already do elsewhere and what this plan proposes here.

**Tags:** severity **LOW** · evidence **derived** · reach **operator** (a future edit to this file happens through the normal review-gated development process, not a live user action) · likelihood **plausible** · undo: reversible.

**Verdict: SURVIVES-with-a-note.** Not a blocker — the ratification of the §0.4 gap itself stands; this is a residual observation about the strength of its stated mitigation, not a re-opening of the ratified decision.

**Residual-register entry**, not a proof-test (no boundary crossing beyond what's already accepted): consider naming `bootstrap-ruleset.ts` explicitly under CLAUDE.md's existing "Policy delivery / config surface" sensitive-area convention in the plan's own §4, at zero build cost, since the convention already exists.

---

### 8. Rollback ("delete the three new hook blocks") is safe for the documented atomic case; a partial/manual rollback has a narrow, low-likelihood residue window

**Scenario.** If all three new `.claude/settings.json` hook entries are removed together, in one edit, the gitignored halt-state file becomes immediately inert (`userpromptsubmit-halt-relay.mjs` no longer runs to read it) — this is a clean rollback. The risk is a **non-atomic, manual** rollback (a human editing the file by hand, removing entries one at a time) that transiently leaves `userpromptsubmit-halt-relay.mjs` wired while `sessionstart-tool-enum.mjs` is removed (or vice versa) — in that window, a stale halt-state file from a session whose `session_id` is never reused (Claude Code session IDs are UUIDs; collision is not a realistic concern) causes no confusion. The actual residue risk is narrower than the prompt anticipates: **SURVIVES** for the documented rollback path; the only live low-probability scenario is a human-error partial edit, which is `operator-error`-tagged and self-correcting once the remaining entry is also removed.

**Tags:** severity **LOW** · evidence **derived** · reach **operator** · likelihood **operator-error** · undo: reversible.

**Verdict: SURVIVES.** Logged as a residual note only.

---

## Frozen set

No prior design-challenger round exists for this artifact (round 1). Nothing above is re-litigating the sibling `architecture-reviewer` pass's five conditions (tool_name fail-closed check inside the hook, halt-state file multi-reason shape, `bootstrap-ruleset.ts` function-not-constant export, test placement, evidence-trail disclosure) — those stand as that reviewer's own findings, unchallenged and un-duplicated here, and should be folded into the plan alongside this report's findings before Phase 2, not instead of them.

## Residual-risk register

| Finding | Trigger | Exposure |
|---|---|---|
| #7 (bootstrap-ruleset.ts disclosure strength) | A future edit to `bootstrap-ruleset.ts` lands without the same named-reviewer ceremony CLAUDE.md's "Policy delivery / config surface" convention already implies | Low — S5's own CRITICAL-tier ceremony likely covers it this time; risk is a *later* story touching this file alone under a lower tier |
| #8 (rollback residue) | A human performs a manual, non-atomic rollback of the three hook entries | Low — self-correcting once the remaining entry is removed; no data loss, no silent misbehavior beyond a transiently-inert file |

## Unrun verifications

| Command | Owner | Why it matters |
|---|---|---|
| Subprocess-level T11 re-measurement (`spawnSync("node", ["hooks/pretooluse-kernel-gate.mjs"], ...)`, ≥30 runs, p50/p95/p99) | `story-implementer`, before declaring T11's timeout | Attack #1 — the currently-planned methodology measures the wrong thing; this is the single highest-leverage unrun check in this whole review |
| `git ls-files hooks/` + a structural "does every `hooks.*.command` path resolve to a real file" check, against `.claude/settings.json` as committed today | `story-implementer`/CI | Attack #2 — already demonstrably red; costs nothing to confirm, should be the very first thing S5's build touches |
| Manual confirmation of whether Claude Code hot-reloads MCP server config from `.claude/settings.json` mid-session without a restart | `story-implementer` (WebFetch against Claude Code's own docs, same discipline as the plan's own T11 step 3) | Attack #5 — determines whether the mid-session self-escalation window is real or moot |

## Editorial

- Plan §5's "New files" list orders `hooks/pretooluse-kernel-gate.mjs`, `hooks/sessionstart-tool-enum.mjs`, `hooks/userpromptsubmit-halt-relay.mjs` without stating build/commit order relative to the `.claude/settings.json` edit that references them — worth a sentence given attack #2's evidence that this exact ordering mistake has already happened once, silently, in this repo.

## The single scariest unproven assumption

That "0% live exposure today" (`docs/STATE.md`, `docs/decisions.md`'s 2026-09-06 S5 rows) is actually true. It is true in the sense the team means it — no *kernel-backed* deny mechanism is live yet. But `.claude/settings.json` already has a *wired, currently-active* `PreToolUse` hook (attack #2) that has been silently non-functional since `master`'s first commit, through four CRITICAL-tier review cycles and one architecture-reviewer pass on this exact story, undetected until this round actually ran `git ls-files hooks/`. If "0% live exposure" was wrong once, quietly, for this long, in this codebase's one prior hook, the corresponding claim about the three *new* hooks this story adds deserves exactly the verification this report just gave the old one — not inherited trust.

## Verdict

**no-go.** Three valid HIGH findings (attacks #1, #2, #3), each clearing the full calibration: `demonstrated`/`code-traced` evidence, `reach=user` with a named entry point, `likelihood=routine`, and an effect that is either a silent security-relevant bypass of the story's own core mechanism (#1, #3) or a silent divergence between claimed and actual behavior in a sensitive-area file (#2). Findings #4/#5/#6 are MED, `derived`, and — per the boundary-crossing carve-out — route to named proof-tests rather than the residual register, since each touches the same "deny-by-default" security boundary this story exists to build. Findings #7/#8 are LOW and residual.

---

RECEIPT: verdict=no-go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated/user/routine/irreversible][~100% of live Bash calls] T11 spike measures only in-process normalize()+decide() latency (sub-5ms expected), never the real `node <hook>.mjs` subprocess cost — measured 148-175ms process-spawn floor on this exact machine today — so the declared timeout will likely sit below real per-call latency, turning the gate into a routine, silent, day-one bypass exactly as gap G6 warns against.
2. [ISSUE][HIGH][demonstrated/user/routine/irreversible][100% of Edit/Write/MultiEdit/NotebookEdit calls] `.claude/settings.json:100`'s existing PreToolUse hook references `hooks/report-subject-gate.mjs`, which has never existed on `master` (confirmed via git ls-files/log/merge-base — it exists only on the abandoned, non-ancestor `feat/report-subject-audit-recorder` branch); the plan's "leave it untouched" inherits this live, undetected-through-four-review-cycles fail-open defect, and no planned instrument (gate-matcher-drift-check, gate-manifest-check) would catch a referenced script path that doesn't resolve, for this entry or the three new ones.
3. [ISSUE][HIGH][demonstrated/user/routine/irreversible][unbounded, demonstrated non-zero] Bash-only live matcher scope plus a project-file-only enumeration model (finding 1's "currently none, per this repo's own .claude/settings.json") leaves every MCP-server-provided mutating tool outside both any deny-capable gate and SUR-03's own halt field-of-view — directly demonstrated by this very session's own dozen-plus active MCP connectors (mcp__github__push_files, mcp__claude_ai_Gmail__send_message, etc.), none declared in thoth's project settings.
4. [SUSPICION][MED][derived/user/plausible/silent, boundary-crossing→proof-test] `sessionstart-tool-enum.mjs`'s own internal-exception path is unspecified (unlike the PreToolUse script's explicit try/catch-then-deny design), and SessionStart's exit code can never itself halt a session (gap G5) — an uncaught exception here silently defaults the flagship deny-by-default halt to no-halt.
5. [SUSPICION][MED][derived/user/plausible/silent, boundary-crossing→proof-test] A session can edit its own `.claude/settings.json` mid-session (e.g. adding an MCP server); SUR-03 enumeration only runs at SessionStart, so no re-check exists inside the same session — a self-escalation window with unconfirmed real-world triggerability (depends on whether Claude Code hot-reloads MCP config).
6. [SUSPICION][MED][derived/user/plausible/silent, boundary-crossing→disclosure-only] SUR-05's drift check can only catch a referenced-but-absent tool name, never a present-but-unreferenced one (a new Claude Code built-in from a version bump) — genuinely unclosable without an upstream live-enumeration API; recommend disclosure, not a mechanism.
7. [CLEAN][derived][operator/plausible/reversible] §0.4's bootstrap-ruleset.ts mitigation is file-header-only when this project's own "Policy delivery / config surface" sensitive-area convention already implies stronger ceremony — residual note, not a blocker, ratification not re-litigated.
8. [CLEAN][derived][operator/operator-error/reversible] Rollback via deleting the three hook blocks is safe for the documented atomic case; only a manual, non-atomic partial rollback has a narrow, self-correcting residue window.
counts (a CHECKSUM — MUST equal the lines listed above; never truncated): issues=3 suspicions=3 clean=2
evidence (a CHECKSUM over the tags above — MUST equal them, and MUST total the counts line): demonstrated=3 code-traced=0 derived=5
round=1 roundsSinceLastGo=0 frozen=0 residuals=2 unrun=3 editorial=1
checks=n/a (pre-build plan review; hooks/ confirmed absent from master's entire history — ran real git/node commands, not application test suites)
adr=HIT(1)
report=docs/reviews/s5-deny-by-default-hook-wiring-design-challenger-2026-09-06.md
