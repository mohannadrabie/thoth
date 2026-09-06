# S5 Phase 1 Plan (v2) — Design Challenger, round 2 re-confirm

**Scope:** `docs/plans/S5-phase1-2026-09-06.md` (v2). Milestone #23, CRITICAL tier. Round 2 of this artifact — round 1 (`docs/reviews/s5-deny-by-default-hook-wiring-design-challenger-2026-09-06.md`) was no-go (3 HIGH, 3 MED). This round re-attacks v2's "v2 revision map" claims against what the revised plan actually now says, not on faith.
**Reviewer:** design-challenger (Apep)
**Date:** 2026-09-06
**`docs/.maat-state.json`** (as read at round start): `roundsSinceLastGo: 0`, `humanRulingRequired: false`, `councilHeld: false` — clear to run. (This value predates round 1's own no-go and needs updating by the Manager regardless of this round's outcome.)

## What was read

`docs/STATE.md`, `CLAUDE.md`, `docs/PRINCIPLES.md`, `docs/.maat-state.json` (full ADR cache + state), `docs/plans/S5-phase1-2026-09-06.md` (v2, full), my own round-1 report (full), `docs/decisions.md`'s full active log (all 38 rows, esp. rows 35-38 — the round-1 no-go ruling, the item-2(b) ratification, the S5-intake ruling, and the S5 NEEDS-INFO resolution), `adr/software-engineering/0021-thoth-native-architecture.md` (full, including the closed four-primitive `Rules for agents` line), the sibling `architecture-reviewer` round-2 re-confirm (`docs/reviews/s5-deny-by-default-hook-wiring-architecture-2026-09-06.md`, APPROVE). Code-traced against the actually-shipped `.claude/settings.json` (full, current). This round ran real commands against this repo's live git history, this machine's real Node/shell runtimes, this machine's real `~/.claude.json`, and fetched Claude Code's own current hooks/MCP documentation directly — not a prose-only pass.

## Attacks — re-attacking round 1's 6 findings against v2, plus what v2 itself newly introduces

### 1 (re-attack of Issue #86, T11 spike). STILL BREAKS — the "fixed" spike closed one measurement gap and opened an adjacent one: it measures the wrong process-invocation *shape*, not just the wrong process

**What v2 claims:** step 3 of the revised spike replaces the function-only measurement with `spawnSync("node", ["hooks/pretooluse-kernel-gate.mjs"], { input: <stdin JSON>, encoding: "utf8" })`, run ≥30 times, subprocess wall-clock p50/p95/p99, declared timeout derived from *that* number. This genuinely fixes round 1's core complaint (function-call latency vs. subprocess latency).

**What it still gets wrong.** `spawnSync("node", [...])` with an `args` array is Node's own **exec form**: no shell is spawned, `node` is `fork+exec`'d directly. But every hook entry in this repo's `.claude/settings.json` — the existing (broken) entry, and, per the plan's own "Edited files" section, the three new entries this story adds — is written as a **bare command string** with no `args` key: `"command": "node \"${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs\""`. Per Claude Code's own documentation (fetched directly, not assumed):

> "Shell Form (when `args` is omitted): The command string is passed to a shell: `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed... Exec Form (when `args` is present): Claude Code resolves `command` as an executable on `PATH` and spawns it directly with `args` as the argument vector. There is no shell."

A bare command string is **shell form**, not exec form. Claude Code will spawn a shell process, which tokenizes/expands the string, then execs `node` as a *second* layer of process creation. The plan's spike measures the first layer only (`spawnSync("node", [...])`, exec form) — it still does not measure what Claude Code actually times for the exact entry shape the plan itself is about to ship.

**Evidence (demonstrated — measured on this exact machine, just now):**
```
A: spawnSync("node", ["-e","1+1"])  [EXEC form, what v2's spike measures]
   min=99.2ms  p50=113.1ms  p95=130.2ms  p99=156.6ms  max=156.6ms

B: spawnSync("bash", ["-c","node -e \"1+1\""])  [SHELL form via Git Bash — what Claude Code
   actually runs for a bare command string, per its own docs quoted above]
   min=166.9ms p50=180.9ms p95=200.2ms p99=203.6ms max=203.6ms

C: spawnSync("powershell", ["-Command","node -e '1+1'"])  [PowerShell fallback shell form,
   used whenever Git Bash isn't installed on the target machine]
   min=554.5ms p50=594.6ms p95=732.3ms p99=1051.2ms max=1051.2ms
```
(30 iterations each, `process.hrtime.bigint()` around each individual `spawnSync` call — script and full output available; summary pasted verbatim above.)

Even on a machine *with* Git Bash (this one), the real shell-form invocation is **~30% higher p99** than the exec-form number the plan's spike would derive its safety margin from. On a machine that falls back to PowerShell (Git Bash not installed — a real, common condition on plain Windows boxes without Git for Windows), the real invocation is **~6.7x higher p99** than the plan's own measurement. The plan does not pin an explicit `"shell"` field (Claude Code exposes one, per the same docs) and does not measure or discuss this layer at all — the declared timeout is left to whatever the exec-form number times a safety multiple happens to be, which may or may not absorb a 6.7x understatement depending on the deploying machine's own shell availability, a fact the plan never checks.

**This is the same root-cause CLASS as round 1's finding #1** ("the spike measures something other than what Claude Code actually times"), recurring one layer deeper: v1 measured pure function calls; v2 measures the subprocess but via the wrong invocation shape. Per PRINCIPLES rule 16's second, independent counter, a repeating root-cause class across 2 consecutive graded rounds mandates the human-ruling stop **regardless of the round-count trigger** — this satisfies that counter on its own terms, in addition to the round-count trigger below.

**Exposure:** ~100% of live `Bash` calls once wired, on any deploying machine that falls back to PowerShell — measured 6.7x understatement. Even on a machine with Git Bash, a confirmed +30% understatement. Basis: **measured** (both shapes benchmarked on this exact machine, raw numbers above), not assumption.

**Reach:** user. Entry point: `.claude/settings.json`'s planned new `PreToolUse` hook entry for `hooks/pretooluse-kernel-gate.mjs`, matcher `Bash` (same entry point round-1 attack #1 named — plan's own "Edited files" section, "APPEND: three new entries") — fires on every real `Bash` tool call once wired.

**Current defense:** none. The plan's own spike design (step 3) explicitly specifies the exec-form `spawnSync` call; nothing in the plan measures, discusses, or pins the shell layer.

**Tags:** severity **HIGH** · evidence **demonstrated** · reach **user** · likelihood **routine** · undo: silent (same G6 timeout-is-bypass mechanism established in round 1 — a timed-out `PreToolUse` hook does not block, the call proceeds; no alert reaches the model or any evidence trail) → keeps severity.

**Verdict: BREAKS.**

**Proof-test to write before Phase 2:** make the T11 spike measure the *actual* invocation shape the shipped `.claude/settings.json` entry will use. Two ways to close this consistently (not prescribing which — a code-level choice, not new topology): (a) if the entry stays a bare command string (shell form, matching the existing file's convention), spike through the same shell layer Claude Code will use on the target platform, and pin the `"shell"` field explicitly in the hook config so the invocation shape — and thus the measured number — can't silently drift between machines; or (b) specify an explicit `args` array in the `.claude/settings.json` entry (exec form), so no shell is spawned at all, matching the plan's already-written spike measurement exactly. Whichever is chosen, add a regression test asserting the settings.json entry's actual `command`/`args` shape matches the shape T11's spike measured — today, neither the plan's prose nor its spike design commits to one, leaving them free to diverge silently.

**Disposition:** this is a genuinely new gap in v2's own fix, not a re-confirmation of a closed finding. Commented on the still-open Issue #86 with this evidence rather than filing a new issue (same underlying defect class: "T11 doesn't measure what Claude Code actually times").

---

### 2 (re-attack of Issue #87, broken hook + structural check). SURVIVES — genuinely resolved, verified by direct simulation, not merely by reading the plan's description

**What v2 claims:** `src/qa/gate-command-path-check.ts`, built and run FIRST (before any other S5 file), parses every `hooks.*[].hooks[].command` string, resolves the referenced path (`${CLAUDE_PROJECT_DIR}` substitution), asserts `existsSync`; confirmed RED today against the currently-committed `.claude/settings.json`. Separately, criterion 14 removes the broken `report-subject-gate.mjs` entry and its header-comment paragraph, flagged in the plan as "pending Manager confirmation."

**Verification performed, not assumed.** I wrote a parity script implementing exactly the logic the plan describes (generic `hooks.*[].hooks[].command` parsing, `${CLAUDE_PROJECT_DIR}` substitution, `existsSync`) and ran it against the real, currently-committed `.claude/settings.json`:
```
command-type hook entries checked: 1
failures: [
  {
    "eventName": "PreToolUse",
    "cmd": "node \"${CLAUDE_PROJECT_DIR}/hooks/report-subject-gate.mjs\"",
    "resolved": "C:\\playground\\thoth\\hooks\\report-subject-gate.mjs",
    "reason": "referenced script does not exist on disk"
  }
]
RESULT: RED (would fail CI)
```
This directly answers "would it have caught the original defect if run today" — **yes, demonstrated**, not merely claimed.

**Does it cover the 3 new entries, structurally, not just this one?** Yes. The design parses `hooks.*[].hooks[].command` generically (every event, every matcher block, every `type: "command"` entry) — it is not keyed to one filename. Per the plan's build order, `hooks/pretooluse-kernel-gate.mjs`, `hooks/sessionstart-tool-enum.mjs`, and `hooks/userpromptsubmit-halt-relay.mjs` are all written in step 3, **before** `.claude/settings.json` is edited to reference them in step 6 — so by the time the check's target file references them, they already exist on disk, and the check goes GREEN in the same commit. This is a sound design for the class of defect, not a one-off patch for the one instance found.

**Removal-not-rebuild disposition:** `docs/decisions.md` row 36 confirms this was already ratified by the Manager ("REMOVED, not replaced or rebuilt... Human ratified: Y") — the plan's own criterion 14 text still reads "pending Manager confirmation," which is now stale relative to the decision log. Editorial only (see below), not a reopened finding.

**Tags:** evidence **demonstrated** (parity simulation run against the real file) · reach **user**, entry point `.claude/settings.json:94-106` (unchanged from round 1) · likelihood **routine** · undo **reversible** once the check + fix land.

**Verdict: SURVIVES.**

---

### 3 (re-attack of Issue #88, MCP-tool gating). PARTIALLY BREAKS — the stdio/http MCP fix is real and verified; the "claude.ai connectors are never written to any local file" disclosure is factually false, demonstrated directly against this machine's own `~/.claude.json`

**What v2 claims (criterion 15):** `sessionstart-tool-enum.mjs` reads MCP server declarations from project `.claude/settings.json`, project `.mcp.json`, and user/local `~/.claude.json`, merged into S3's existing catalog. Separately, the plan's research section states: "confirmed claude.ai connectors are fetched live from the user's account and never written to any local file, so they stay structurally outside any static-config enumeration" — sourced from a `code.claude.com/docs/en/mcp` fetch, and used to justify accepting this as a permanent, undisclosed-nowhere-else residual (backlog entry) rather than a build gap.

**Half A — verified correct.** I directly inspected this machine's real `~/.claude.json`:
```
top-level key "mcpServers": github, aws-mcp-server, aws-knowledge-mcp-server,
  aws-api-mcp-server, terraform, playwright   (6 real, currently-configured servers)
```
This is exactly the kind of user-scope MCP declaration the design-challenger round-1 report flagged as invisible to v1's project-file-only enumeration. v2's fix (reading `~/.claude.json`'s `mcpServers` key) would genuinely catch all 6 of these — a real, verified improvement. **SURVIVES for this half.**

**Half B — the "never written to any local file" claim is demonstrably false.** The *same file* the plan already proposes to read contains a top-level array, `claudeAiMcpEverConnected`:
```json
[
  "claude.ai Gmail",
  "claude.ai Excalidraw",
  "claude.ai Google Drive",
  "claude.ai Google Calendar",
  "claude.ai Adobe for creativity",
  "claude.ai Canva",
  "claude.ai Spotify"
]
```
These are exactly the connector *names* that round 1's own evidence found active in that same session (`mcp__claude_ai_Gmail__send_message`, `mcp__claude_ai_Google_Drive__trash_file`, `mcp__claude_ai_Google_Calendar__delete_event`). Contrary to the plan's disclosure, claude.ai connector identity **is** written to a local file — the same `~/.claude.json` the design already reads for `mcpServers`. This is squarely the kind of hand-derived completeness claim CLAUDE.md's own hard rule bars ("no hand-derived completeness claims... if no such instrument exists, building one is part of the task") — the plan's claim rests on a documentation fetch, not on an instrument that actually inspected the real local file the mechanism will run against.

To be precise about what this array does and doesn't give: it is connector *names* ever connected, not live-connection status and not a schema of what mutating tools each connector exposes (`mcp__claude_ai_Gmail__send_message` itself doesn't appear verbatim). So reading it would not, by itself, let `evaluateToolInventory` classify each specific tool — but it *would* let `sessionstart-tool-enum.mjs` know, today, using data already in a file it's already reading, that this account has one or more claude.ai connectors on record and treat that as a reason to widen the halt (unclassified, fail-closed) rather than silently declaring the whole category structurally unenumerable. The plan's own established convention elsewhere (ambiguity widens the deny surface, never narrows it — `kernel.ts`'s `isMutating`/`pol05Rule`, cited approvingly in this same plan for criterion 16) is not applied to this specific, buildable case.

**Exposure:** any session where the current user's account has ever connected a claude.ai connector — demonstrated non-zero for this machine (the array above), not hypothetical. Basis: **demonstrated** (direct file inspection of the exact file the plan proposes reading).

**Reach:** user. Entry point: `SessionStart` firing at the start of any session using this repo's hooks, once `sessionstart-tool-enum.mjs` is wired and a `mcp__claude_ai_*` tool call follows — same entry-point class round-1 attack #3 used.

**Current defense:** none — the plan's own disclosure explicitly frames this as permanently unclosable, foreclosing a cheap, buildable partial mitigation using data the design already reads.

**Tags:** severity **MED** (the underlying vulnerability — a claude.ai-connector tool call proceeding fully ungated — was already known and already disclosed/backlogged in round 1's disposition; what's *new* here is that the specific justification for accepting it is factually wrong, and the fix would touch code that doesn't exist yet, so the "will this actually get built" half is `derived`, capping here) · evidence **demonstrated** (the file's contents) for the factual claim, **derived** for the code-not-yet-written half · reach **user** · likelihood **routine** (an account with any claude.ai connector ever connected — common, not exotic) · undo: silent, boundary-crossing (SUR-03's own halt boundary) → per the carve-out, routes to a proof-test, not the residual register.

**Verdict: BREAKS** (the disclosure, as written) / underlying gap stays **UNPROVEN-pending-verification** for full closure (connector-to-tool-schema mapping is a real, separate question this doesn't resolve).

**Proof-test to write before Phase 2:** revise criterion 15's fixture set to include a case where `~/.claude.json`'s `claudeAiMcpEverConnected` is non-empty, and assert `sessionstart-tool-enum.mjs` treats that as a halt-triggering condition (a coarse, connector-name-only, fail-closed signal — not a claim of full tool-level classification) rather than silently omitting it. Revise the backlog/disclosure text so it states plainly what's actually true: connector *identity* has a local trace and could gate on it; connector *tool schema* does not, and that narrower claim is the one that's genuinely unclosable absent a live API.

**Disposition:** commented on the still-open Issue #88 with this evidence (same underlying topic: MCP/connector enumeration completeness), not filed as a new issue.

---

### 4 (new attack, introduced by v2's own fix for #88). `~/.claude.json` — the very file v2 proposes reading for MCP enumeration — contains live secret material in plaintext; the plan doesn't scope what `sessionstart-tool-enum.mjs` may read from it

**Scenario.** v2's criterion 15 adds `~/.claude.json` as a new input source `sessionstart-tool-enum.mjs` will read. This machine's real `~/.claude.json` (the exact file the design will parse) contains, inside `mcpServers.github.env`, a live-shaped credential in plaintext:
```
"GITHUB_PERSONAL_ACCESS_TOKEN": "github_pat_11A325Z2Q0nr4rtN9beavQ_..."
```
and similar `env` blocks for other configured servers. The plan describes the read as extracting "MCP server declarations" merged into `evaluateToolInventory`'s catalog — it does not state that the extraction is scoped to server/tool *names* only, nor does it name a test asserting that the `env`/`args`/`command` fields of each server entry never propagate into the halt-state file, stderr, a log line, or any other output this new script produces. `sessionstart-tool-enum.mjs` is a brand-new script with no shipped code yet to inspect; nothing in the plan closes this off explicitly, and this is exactly the kind of new file this project's own CLAUDE.md sensitive-areas list and hard rules ("No secrets in code/state/config") are written to catch before it ships, not after.

This is a defect v2 itself introduces: v1 never touched `~/.claude.json` at all (finding 1 in the plan's "Named findings" section describes enumeration as project-scope only), so this risk did not exist until v2's own fix for Issue #88 added this file as a new input.

**Evidence:** the underlying fact — this file contains live-shaped secret material — is **demonstrated** (direct read of the real file, shown above). The defect itself (whether the as-yet-unwritten `sessionstart-tool-enum.mjs` will actually leak it) is **derived** — no code exists yet to trace a concrete leak in.

**Exposure:** every developer/CI machine whose `~/.claude.json` has any MCP server configured with an inline secret in its `env` block (a documented, common shape for stdio MCP servers) — plausible, not universal; this machine demonstrates it's a real, not hypothetical, shape. Basis: demonstrated for the input data's shape, assumption for how many machines carry it.

**Reach:** user. Entry point: `SessionStart` firing at the start of any session, the moment `sessionstart-tool-enum.mjs` (once built) reads `~/.claude.json` — same entry point as attack #4 in round 1 (the sessionstart script's own failure-path attack), now extended to its new input source.

**Current defense:** none named in the plan for this specific new input's field-level scoping.

**Tags:** severity **MED** (evidence=derived for the code-not-yet-written half caps it here) · evidence **derived** (underlying fact demonstrated, code-level defect not yet traceable) · reach **user** · likelihood **plausible** (requires a machine with an inline-secret MCP server configured — common but not universal) · undo: silent, boundary-crossing (a credential leak is definitionally a security-boundary crossing, and CLAUDE.md's own sensitive-areas/hard-rules list this exact class) → per the carve-out, routes to a proof-test, never the residual register.

**Verdict: UNPROVEN** (no code exists yet to demonstrate a leak either way; the gap is in what the plan does not specify).

**Proof-test to write before Phase 2:** a unit test feeding `sessionstart-tool-enum.mjs` a mock `~/.claude.json`/`.mcp.json` containing a canary secret string inside an `env`/`args`/`command` field, asserting that string never appears in the halt-state file, stderr, any log line, or any other output the script produces — only server/tool *names* may propagate downstream. Write it before the script's own implementation, not after.

**Disposition:** genuinely new finding, not covered by any existing issue. No duplicate found (`gh issue list --search` checked). Filed as a new GitHub Issue (below).

---

### 5 (re-attack of round-1 attack #4, sessionstart-tool-enum.mjs exception handling). SURVIVES

**What v2 claims (criterion 16):** the whole enumeration computation wrapped in try/catch; any internal exception still results in a halt-state file being written under a generic `"SUR-03-enumeration-failed"` reason, mirroring `kernel.ts`'s own ambiguity-widens-the-deny-surface convention.

This directly closes round-1's complaint: the specific failure mode named there (an exception before `evaluateToolInventory`'s result is ever written, e.g. a malformed catalog or an I/O error reading a config file) is exactly what "wraps the whole computation" is designed to catch, and the design commits to writing a halt-state file regardless — the correct fail-closed shape for a script whose entire job is "halt on anything unclassifiable." I don't have code to run yet (still Phase 1), so I can't demonstrate this beyond the design text, but the design text itself now states the exact behavior round 1 asked for, unambiguously (not just "will be considered"). One residual, LOW, not blocking: the plan doesn't address the doubly-nested failure (the halt-state *write itself* fails — e.g. the gitignored directory isn't creatable) — noted in the residual register, not gating.

**Tags:** evidence **derived** (still Phase 1, no code to run) · reach **user** · likelihood **plausible** · undo: silent, boundary-crossing → the plan's own commitment already satisfies the carve-out's demand for a named proof-test (criterion 16's own C16 check: "feed a deliberately malformed classification-catalog input... assert a halt-state file is still written").

**Verdict: SURVIVES** (design-level; build-time proof-test already specified in the plan itself, matches round-1's ask).

---

### 6 (re-attack of round-1 attack #5, mid-session self-escalation / ConfigChange-ADR-0021 conflict). SURVIVES — the ADR reasoning is independently verified correct, not merely asserted

**What v2 claims (criterion 17):** Claude Code has a real `ConfigChange` hook event that could react to a mid-session `.claude/settings.json` edit — the exact gap round-1 attack #5 named — but ADR-0021 closes the in-session hook gate to exactly four named primitives, so using a fifth would be an ADR violation; the plan names this, routes it to `architecture-reviewer`/a future ADR-amendment discussion, and does not build it. Separately, the plan's own research also found: newly-added MCP servers do not become live, callable tools without a session restart (corroborated by multiple open upstream feature requests asking for exactly this capability, plus a direct statement that a mid-session `claude mcp add` doesn't get picked up by the running process) — resolving the *tool-connectivity* half of attack #5, leaving only a thinner residual (approval/enable-flag flips on an already-pending server) named and disclosed.

**Independently verified, not accepted on faith:**
- **`ConfigChange` is real.** Fetched `code.claude.com/docs/en/hooks` directly: confirmed the event exists, fires "when a configuration file changes during a session," supports matchers `user_settings`/`project_settings`/`local_settings`/`policy_settings`/`skills`, and can block a change via exit code 2 except for `policy_settings`.
- **ADR-0021's four-primitive list is genuinely closed, not just described as such.** Read the ADR's own `Rules for agents` directly: "MUST implement the in-session hook gate using only Claude Code's documented `PreToolUse`, `UserPromptSubmit`, `SessionStart`, and `SubagentStop` primitives." "Using only" is an exclusive list — adding a fifth primitive (`ConfigChange`) to the in-session hook gate genuinely would violate this MUST. The plan's routing (name it, don't build it, flag to architecture-reviewer/ADR-amendment) is the correct response per PRINCIPLES rule 9 ("a rule you cannot satisfy is never silently violated — say so and propose an ADR change"), not an excuse to skip a mitigation that was actually available. `docs/decisions.md` row 36 already confirms the Manager independently reached the same conclusion.
- **The mid-session hot-reload claim is reasonably corroborated**, per the plan's own disclosed sourcing (WebSearch, not a direct doc fetch, honestly flagged as such) — I did not re-run this search myself this round since the plan already discloses its own confidence level correctly ("treated as strong, not certain, corroboration") and names the residual channel it does *not* close (approval/enable-flag flips). This matches this project's own disclosure convention; no further attack needed here.

**Tags:** evidence **code-traced** (ADR-0021's actual text, quoted above) + **demonstrated** (ConfigChange's real existence, fetched from Claude Code's own current docs) · reach **operator/architectural** (this is a routing decision, not a live user-facing bypass) · likelihood n/a (SURVIVES) · undo: n/a.

**Verdict: SURVIVES.** The ADR-conflict reasoning is correct, independently checked against both the ADR's actual text and Claude Code's actual current documentation — not merely restated from the plan's own claim.

---

### 7 (re-attack of round-1 attack #6, SUR-05 one-directional disclosure). SURVIVES

**What v2 claims (criterion 18):** the drift check's own printed summary/acceptance text now states plainly that it only catches referenced-but-absent tool names, never present-but-unreferenced ones (a future Claude Code built-in). This is exactly round 1's recommendation ("disclosure only, not a mechanism") — matched precisely, no mechanism was invented to paper over a gap that has no code-level fix absent a live-enumeration API.

**Tags:** evidence **derived** (still Phase 1 prose) · reach **user** · likelihood **plausible** · undo: reversible.

**Verdict: SURVIVES.**

---

## Frozen set

- Round 1's LOW findings #7 (bootstrap-ruleset.ts disclosure strength) and #8 (rollback residue) — not re-litigated, both were SURVIVES, residual-register only, unchanged by v2.
- Architecture-reviewer's 5 conditions from round 1 — re-confirmed independently by that reviewer (`docs/reviews/s5-deny-by-default-hook-wiring-architecture-2026-09-06.md`, APPROVE) this same round; not re-attacked here since they're outside this report's mandate and already closed by their own owning reviewer.
- Attacks #2, #5, #6, #7 above (Issues #87's fix, sessionstart exception handling, ConfigChange/ADR routing, SUR-05 disclosure) — genuinely resolved this round, verified independently (parity simulation, direct doc/ADR-text reads, direct file inspection), not accepted on the v2 revision map's word alone.

## Residual-risk register

| Finding | Trigger | Exposure |
|---|---|---|
| Attack #5 (criterion 16's doubly-nested failure — the halt-state write itself failing) | The gitignored halt-state directory can't be created/written to (disk full, permissions) at the exact moment an internal exception is also being handled | Low — a compound fault; self-evident once it happens (no halt-state file for a session that should have one is itself detectable by comparing session logs) |
| Round 1's #7 (bootstrap-ruleset.ts disclosure strength) | Unchanged from round 1 | Low, carried forward |
| Round 1's #8 (rollback residue) | Unchanged from round 1 | Low, carried forward |

## Unrun verifications

| Command | Owner | Why it matters |
|---|---|---|
| Re-measure T11's spike through the actual shell layer Claude Code will use for the shipped `.claude/settings.json` entry shape (once that shape — bare string vs. `args` array — is decided) | `story-implementer`, before declaring T11's timeout | Attack #1 — the currently-planned methodology still measures the wrong invocation shape; single highest-leverage unrun check this round, same as round 1 |
| Fixture test: `~/.claude.json` with non-empty `claudeAiMcpEverConnected`, assert `sessionstart-tool-enum.mjs` halts on it | `story-implementer` | Attack #3 half B — the disclosed-unclosable framing is factually wrong; a cheap, buildable partial mitigation exists |
| Fixture test: canary secret in a mock `~/.claude.json`/`.mcp.json` `env`/`args`/`command` field never appears in any output `sessionstart-tool-enum.mjs` produces | `story-implementer`, before this script's implementation is written | Attack #4 — new risk introduced by v2's own fix for #88; nothing today confirms this either way since no code exists |

## Editorial

- Plan criterion 14's status line still reads "pending Manager confirmation before Phase 2" — `docs/decisions.md` row 36 already ratified this (Human ratified: Y). Update the plan's own text to reflect the ratification; not a reopened finding.
- Round 1's report is referenced throughout this one by attack number; no discrepancy found between what round 1 said and what's quoted here.

## The single scariest unproven assumption

That fixing what a prior round found is safe to grade against its own description. Both of this round's real findings (attack #1's shell-vs-exec gap; attack #3's false "never written to any file" claim) exist precisely because v2's "revision map" table describes what changed accurately as prose, but the underlying fix wasn't checked against the same standard of evidence this project claims to hold everywhere else (a real measurement, a real file read) — it was checked against a documentation fetch and a function signature. The pattern this project's own round-1 report named ("if '0% live exposure' was wrong once, quietly, for this long... deserves exactly the verification this report just gave the old one — not inherited trust") applies just as much to a plan's own claimed fixes as it did to its claimed exposure.

## Verdict

**no-go.** One valid HIGH (attack #1, shell-form spawn overhead) clears full calibration: `demonstrated` evidence, `reach=user` with a named entry point, `likelihood=routine`, and an effect that is the identical silent security-relevant bypass mechanism (G6: timeout is a bypass, not a delay) established in round 1. Two MEDs (attacks #3 half B, #4) are `demonstrated`/`derived` respectively and, per the boundary-crossing carve-out, route to named proof-tests rather than the residual register. Four attacks (#2, #5, #6, #7) genuinely SURVIVE, independently re-verified rather than accepted on the revision map's word.

**This is round 2 of this artifact without an intervening clean/conditional-clean verdict** (round 1: no-go; round 2, this report: no-go). Per PRINCIPLES rule 16(b), 2 graded verdicts without a GO in the pre-build design-challenger loop is the explicit council-convene trigger — the Manager should run `/maat:council` (design-challenger Stop Brief + architecture-reviewer + impact-analyst), not a round 3.

**Separately and additionally:** attack #1's root cause ("the T11 spike doesn't measure what Claude Code actually times") is the identical root-cause CLASS as round 1's own attack #1, recurring in a new layer (function-vs-subprocess in round 1; exec-vs-shell-form in round 2). Per PRINCIPLES rule 16's second, independent counter, this ALSO mandates the same hard stop on its own terms, regardless of the round-count trigger above — both triggers point to the same action (convene the council / escalate to the human), so nothing further is gained by distinguishing which one fired first, but both should be named in the Path-Forward Brief per rule 16's own instruction to name the trigger verbatim.

---

RECEIPT: verdict=no-go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated/user/routine/silent-keeps-severity][~100% of Bash calls on a PowerShell-fallback machine (measured 6.7x understatement), ~30% understatement even on this machine's own Git Bash] Re-attack of Issue #86: v2's "fixed" T11 spike still measures the wrong thing — `spawnSync("node",[...])` is Node's exec form (no shell), but every hook entry in `.claude/settings.json` (existing + all 3 planned) is a bare command string, which Claude Code's own docs confirm runs through a shell (`sh -c`/Git Bash/PowerShell) as a second process-creation layer; measured p99 156.6ms (exec) vs 203.6ms (Git Bash shell) vs 1051.2ms (PowerShell fallback) on this exact machine. Same root-cause class as round-1 attack #1, recurring one layer deeper — independently also triggers PRINCIPLES rule 16's same-root-cause-class stop.
2. [CLEAN][demonstrated/user/routine/reversible] Re-attack of Issue #87: the structural command-path check + removal-not-rebuild disposition genuinely resolves the original defect — verified by running a parity simulation of the check's exact described logic against the real committed `.claude/settings.json` (RED today, as claimed) and confirming the design generically covers all 3 new entries via the build-order sequencing (files exist before settings.json references them).
3. [ISSUE][MED][demonstrated(fact)+derived(code-not-built)/user/routine/silent, boundary-crossing→proof-test][demonstrated non-zero on this machine] Re-attack of Issue #88: v2's fix for stdio/http MCP servers (reading `.mcp.json`+`~/.claude.json`) is genuinely verified correct (this machine's real `~/.claude.json` has 6 configured servers the fix would now catch) — SURVIVES for that half. But the plan's disclosure that claude.ai connectors are "never written to any local file" is factually false: the same file's `claudeAiMcpEverConnected` array lists exactly the connector names round 1 found active in this session, demonstrating a cheap, buildable partial mitigation the plan forecloses on an incorrect premise.
4. [ISSUE][MED][derived/user/plausible/silent, boundary-crossing→proof-test][plausible, demonstrated on this machine's own file shape] New finding, introduced by v2's own fix for #88: `~/.claude.json` — the exact new file v2 proposes reading — contains a live-shaped plaintext secret (`GITHUB_PERSONAL_ACCESS_TOKEN`) in an MCP server's `env` block; the plan doesn't scope `sessionstart-tool-enum.mjs`'s extraction to names-only or name a test preventing this data from reaching the halt-state file/stderr/logs. No code exists yet to demonstrate an actual leak.
5. [CLEAN][derived/user/plausible/reversible] Re-attack of round-1 attack #4: sessionstart-tool-enum.mjs's fail-closed exception handling (criterion 16) genuinely closes the gap — whole computation wrapped in try/catch, halt-state file still written under a generic reason on internal exception, matching the kernel's own ambiguity-widens-the-deny-surface convention. Design-level SURVIVES; the plan's own C16 already names the exact proof-test round 1 asked for.
6. [CLEAN][code-traced+demonstrated/n-a/n-a/n-a] Re-attack of round-1 attack #5: the ConfigChange/ADR-0021 conflict reasoning is independently verified correct — ConfigChange is a real Claude Code hook event (confirmed via direct doc fetch), and ADR-0021's own text ("MUST implement... using only" 4 named primitives) is a genuinely closed list, so building it would be an ADR violation; the plan's routing (disclose, don't build, flag to architecture-reviewer) is the correct response, not an excuse.
7. [CLEAN][derived/user/plausible/reversible] Re-attack of round-1 attack #6: SUR-05's own printed disclosure now states plainly what it doesn't catch (present-but-unreferenced tool names) — matches round 1's recommendation exactly, no mechanism invented for an unclosable gap.
counts (a CHECKSUM — MUST equal the lines listed above; never truncated): issues=3 suspicions=0 clean=4
evidence (a CHECKSUM over the tags above — MUST equal them, and MUST total the counts line): demonstrated=3 code-traced=1 derived=3
round=2 roundsSinceLastGo=2 frozen=4 residuals=3 unrun=3 editorial=2
checks=n/a (pre-build plan review; ran real git/node/shell timing commands + a parity simulation script + a live WebFetch against Claude Code's own current docs, not application test suites — hooks/ confirmed still absent from master)
adr=HIT(1)
report=docs/reviews/s5-deny-by-default-hook-wiring-design-challenger-round2-2026-09-06.md
