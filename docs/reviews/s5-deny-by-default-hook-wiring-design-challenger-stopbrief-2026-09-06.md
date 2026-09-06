# S5 Phase 1 Plan — Design Challenger, Stop Brief (council seat)

**Scope:** `docs/plans/S5-phase1-2026-09-06.md` (v2). Milestone #23, CRITICAL tier.
**Trigger:** 2 consecutive no-go rounds on this artifact with no intervening clean/conditional-clean verdict (round 1: no-go, 3 HIGH/3 MED/2 LOW; round 2: no-go, 1 HIGH/2 MED/4 CLEAN) — PRINCIPLES rule 16(b)'s council-convene trigger. Round 2 also independently named PRINCIPLES rule 16's second counter (same root-cause CLASS — "the spike measures something other than what Claude Code actually times" — recurring across both graded rounds).
**Seat:** design-challenger (Apep), Stop Brief mode. Not a round 3. No new attack surface opened here; nothing below was not already said in round 1 or round 2.
**`docs/.maat-state.json`** (read at brief time): `reviewRoundsSinceClean: 0`, `humanRulingRequired: false`, `councilHeld: false`, `roundsSinceLastGo: 0` — the last field is stale (round 2's own report already flagged this; it predates round 2's own no-go and should read 2, a Manager bookkeeping fix, not a blocker to this seat).
**Issues checked at brief time:** #86 OPEN (my round-2 comment posted, not closing), #87 OPEN (no comment — design verified sound in round 2 but the actual code fix hasn't shipped; correctly still open, still Phase 1), #88 OPEN (my round-2 comment posted, not closing), #89 OPEN (filed by round 2 for the new secrets-exposure finding, `severity:med`, no comments yet).

---

## 1. Frozen set

Established across round 1 + round 2, by evidence stronger than the plan's own prose (a parity simulation, a live doc fetch, an ADR-text read, a direct file inspection) — the other two council seats should build on these, not re-derive them:

| Item | Verdict | Evidence basis |
|---|---|---|
| Round 1 LOW #7 — `bootstrap-ruleset.ts` disclosure strength (file-header only) | SURVIVES, residual note | derived; not re-litigated in round 2 |
| Round 1 LOW #8 — rollback residue (manual, non-atomic partial rollback) | SURVIVES, residual note | derived; not re-litigated in round 2 |
| Issue #87 fix design — `gate-command-path-check.ts` (structural command-path check) + removal-not-rebuild of the broken `report-subject-gate.mjs` entry | SURVIVES — **verified**, not accepted on the plan's word: a parity script implementing the check's exact described logic was run against the real, currently-committed `.claude/settings.json` and returned RED (confirms the check is non-vacuous against the exact defect it targets); build-order sequencing (hook files exist before `.claude/settings.json` references them) confirmed to cover all 3 new entries generically, not just the one instance found | demonstrated |
| `sessionstart-tool-enum.mjs` fail-closed exception handling (criterion 16) | SURVIVES at the design level — closes round 1's exact complaint (try/catch the whole computation; halt-state file still written under a generic reason on internal exception) | derived (still Phase 1, no code to run; the plan's own C16 already names the exact proof-test) |
| `ConfigChange` hook / ADR-0021 four-primitive-list conflict (mid-session settings self-escalation, tool-connectivity half) | SURVIVES — independently verified, not accepted on faith: `ConfigChange` confirmed real via direct fetch of Claude Code's current hooks doc; ADR-0021 line 210's "using only" four named primitives confirmed genuinely closed by reading the ADR's own text; the plan's routing (disclose, route to architecture-reviewer/ADR-amendment, don't build) is the correct response, not an excuse. Separately, the plan's own research (corroborated, not certain) establishes a newly-added MCP server does not become live/callable without a session restart, resolving the tool-connectivity half of the original gap; a thinner residual (approval/enable-flag flips on an already-pending server) is named, not built | code-traced + demonstrated |
| SUR-05 one-directional drift-check disclosure (criterion 18) | SURVIVES — the check's own printed text now states plainly what it doesn't catch (present-but-unreferenced tool names); matches round 1's own recommendation exactly, no mechanism invented for a gap with no code-level fix absent a live-enumeration API | derived |
| Architecture-reviewer's 5 conditions from round 1 (tool_name fail-closed check inside the hook, halt-state multi-reason schema, `bootstrap-ruleset.ts` function-not-constant, test placement, evidence-trail disclosure) | Resolved and re-confirmed APPROVE by that reviewer's own round-2 pass — outside this seat's mandate, not re-attacked here, but folded into the "what's proven safe" packet | that reviewer's own evidence, not re-verified by this seat |

**Do not re-open any of the above without new evidence** (a test run, a measurement, a code diff) — re-deriving from the document is not sufficient per the frozen-set rule.

---

## 2. Genuinely open, ranked

Restated precisely from round 2 — no re-derivation.

### Open #1 — HIGH — T11 spike still measures the wrong invocation shape (Issue #86, still OPEN)

Round 2's "fixed" spike replaced function-only measurement with `spawnSync("node", ["hooks/pretooluse-kernel-gate.mjs"], {...})` — genuinely closing round 1's complaint (function vs. subprocess) — but this is Node's **exec form** (`args` array present, no shell). Every hook entry in `.claude/settings.json` — the existing broken one, and the plan's own "Edited files" section for all 3 new entries — is a **bare command string** with no `args` key, which is Claude Code's own documented **shell form** (`sh -c` / Git Bash / PowerShell fallback, per a direct fetch of Claude Code's current docs). The spike measures the wrong layer for the exact entry shape the plan is about to ship.

Measured on the review machine, 30 runs each:
```
exec form  (spawnSync("node", ["-e","1+1"])):              p50=113.1ms p95=130.2ms p99=156.6ms
shell form (spawnSync("bash", ["-c","node -e \"1+1\""])): p50=180.9ms p95=200.2ms p99=203.6ms   (+30% p99)
shell form (spawnSync("powershell", ["-Command",...])):    p50=594.6ms p95=732.3ms p99=1051.2ms  (+6.7x p99)
```

**Tags:** severity **HIGH** · evidence **demonstrated** · reach **user**, entry point `.claude/settings.json`'s planned `PreToolUse` entry for `hooks/pretooluse-kernel-gate.mjs`, matcher `Bash` · likelihood **routine** · undo: **silent** (G6: a timed-out `PreToolUse` hook is a bypass, not a delay — no alert reaches the model or any evidence trail) → keeps severity.

**Verdict: BREAKS.** This is the same root-cause CLASS as round 1's own finding #1, recurring one layer deeper (function-vs-subprocess in round 1; exec-vs-shell-form in round 2) — the independent PRINCIPLES rule 16 trigger.

### Open #2 — MED — claude.ai-connector disclosure is factually wrong (Issue #88, still OPEN, half B only — half A closed)

The plan's stdio/http MCP fix (reading `.mcp.json` + `~/.claude.json`) is verified correct — this machine's real `~/.claude.json` has 6 configured servers this fix would now catch. That half SURVIVES.

But the plan's disclosure that claude.ai connectors "are fetched live from the user's account and never written to any local file" is demonstrably false: the same file — `~/.claude.json`, the exact file the fix already reads — carries a top-level array `claudeAiMcpEverConnected` listing exactly the connector names round 1's own evidence found active in this session (`claude.ai Gmail`, `claude.ai Google Drive`, `claude.ai Google Calendar`, etc.). This gives connector *identity*, not a tool-schema mapping — but identity alone is enough to treat "any claude.ai connector on record" as a halt-triggering condition, a cheap, buildable partial mitigation the plan forecloses on an incorrect premise.

**Tags:** severity **MED** (evidence=demonstrated for the factual claim, derived for the not-yet-built code half, which caps it here) · evidence **demonstrated** (file contents) + **derived** (code-not-built half) · reach **user** · likelihood **routine** · undo: silent, boundary-crossing (SUR-03's own halt boundary) → per the carve-out, routes to a named proof-test, never the residual register.

**Verdict: BREAKS** (the disclosure, as written) / underlying gap **UNPROVEN-pending-verification** for full closure (connector-to-tool-schema mapping is a separate, genuinely unclosable question absent a live enumeration API).

### Open #3 — MED — `~/.claude.json` secrets-exposure risk, newly introduced by v2's own fix (Issue #89, OPEN, new)

v2's fix for Open #2 (reading `~/.claude.json` for MCP enumeration) reads a file that, on this exact machine, contains a live-shaped plaintext credential (`GITHUB_PERSONAL_ACCESS_TOKEN`) inside an MCP server's `env` block. The plan describes the read as extracting "MCP server declarations" but does not state the extraction is scoped to server/tool *names* only, and names no test asserting that `env`/`args`/`command` fields never propagate into the halt-state file, stderr, or any log line. No code exists yet for `sessionstart-tool-enum.mjs` to trace a concrete leak in — this is a risk v1 never had (v1 never touched `~/.claude.json` at all); it is a defect v2's own fix introduces.

**Tags:** severity **MED** (evidence=derived for the code-not-yet-written half caps it here; underlying fact — the file's shape — is demonstrated) · evidence **derived** · reach **user**, entry point `SessionStart` once `sessionstart-tool-enum.mjs` (not yet built) reads `~/.claude.json` · likelihood **plausible** (requires a machine with an inline-secret MCP server configured — common but not universal; this machine demonstrates the shape is real) · undo: silent, boundary-crossing (a credential leak is definitionally a security-boundary crossing) → per the carve-out, routes to a named proof-test, never the residual register.

**Verdict: UNPROVEN** (no code exists yet to demonstrate a leak either way).

---

## 3. What has never been run

| Verification | Would settle | Owner | Status |
|---|---|---|---|
| Re-measure T11 through the **actual invocation shape** the shipped `.claude/settings.json` entry will use (bare command string → real shell layer on the real target machine class; or an explicit `args` array → exec form, no shell) | Open #1 in full | `story-implementer`, before declaring the timeout | Not run. The shape decision (bare string vs. `args` array) has not even been made yet — this is upstream of the measurement itself. |
| The same re-measurement on a **PowerShell-fallback machine** (no Git Bash installed) — a real, common Windows condition this review only measured indirectly (`spawnSync("powershell", ...)` on a machine that *does* have Git Bash, not on a machine where PowerShell is the actual fallback) | The true worst-case bound on Open #1's exposure | `story-implementer`/CI, on a second machine image | Not run anywhere. |
| Fixture test: `~/.claude.json` with non-empty `claudeAiMcpEverConnected` → assert `sessionstart-tool-enum.mjs` halts on it | Open #2 | `story-implementer` | Not written — no code exists yet (still Phase 1). |
| Fixture test: canary secret in a mock `~/.claude.json`/`.mcp.json` `env`/`args`/`command` field never appears in the halt-state file, stderr, or any log output | Open #3 | `story-implementer`, before `sessionstart-tool-enum.mjs`'s implementation is written | Not written — no code exists yet. |
| Whether Claude Code hot-reloads MCP server config mid-session without a restart | Round 1 attack #5 / the mid-session self-escalation window's real triggerability | Already reasonably corroborated (round 2, via WebSearch against multiple open upstream feature requests) — not a direct doc-fetch confirmation | Partially run; treated by round 2 as "strong, not certain" corroboration, correctly disclosed as such, not re-verified by this seat. |

The single highest-leverage unrun item is the first row: **no measurement exists yet against the real invocation shape**, and the shape itself (bare string vs. `args` array) is an open decision, not a settled fact the plan can measure around. Per this agent's own round budget rule, this outranks any further prose-only attack.

---

## 4. Candidate paths (rough pricing, not designed — impact-analyst/architect's job to size and rule on)

**(A) Fix T11 properly.** Decide the `.claude/settings.json` entry's invocation shape first (bare string vs. explicit `args` array), then measure the real end-to-end cost for *that* shape on the actual target machine class(es), including a PowerShell-fallback machine if that's a real deploy target. Cost: one more spike cycle (hours, not days) — this is a measurement task, not new code. Converges the HIGH definitively if the shape is pinned first; does not by itself resolve Opens #2/#3 (separate, unrelated gaps). Leaves open: cross-machine variance beyond whatever machine classes are actually measured.

**(B) Sidestep the measurement problem.** Adopt Claude Code's documented default timeout (600s, already confirmed available and unbounded-below-that in both rounds' research) instead of a tightly-derived number. Cost: near-zero — no further spike needed, ships today. Leaves open: a much larger fail-open window in principle, but since the hook normally resolves in well under a second, a 600s ceiling essentially never triggers a bypass-via-timeout in ordinary operation — it defers the "tight margin" question to a later story once real production latency data exists across real deploy machines, rather than resolving it now. Does not touch Opens #2/#3.

**(C) Pin exec form in the shipped config.** Give the 3 new `.claude/settings.json` entries an explicit `args` array (exec form, no shell spawned) instead of a bare command string — this is a config-shape parameter, not new topology, and it is exactly what the plan's own spike already measures, so no new measurement is needed at all once this choice is made. Cost: very low, converges fastest for Open #1. Leaves open: still needs confirmation this doesn't collide with any documented constraint on how Claude Code passes stdin/env in exec form vs. shell form (not checked this round), and does not touch Opens #2/#3 either.

None of these three touch Open #2 or Open #3 — those are independent gaps in the MCP-enumeration fix, not consequences of the invocation-shape question, and should be priced and routed separately (both already have named proof-tests in section 2 above; neither requires new topology to close).

---

## 5. The single scariest unproven assumption

That there is one stable number to measure at all. Twice now, a "fixed" spike has turned out to still be timing the wrong process-creation layer — first function calls vs. subprocess (round 1), then exec-form vs. shell-form subprocess (round 2) — each fix closing exactly the gap the prior round named and opening an adjacent one at the same root cause. Nothing yet establishes that a third layer (e.g., a Windows machine's first-run antivirus/Defender scan of a freshly-written `.mjs` file, `node_modules` resolution cost on a cold OS file-cache, or per-machine Node version differences) isn't waiting one level further down. The council's real decision is not "which measurement fixes this" but whether to keep spending rounds converging a spike toward an exact number (Path A) or to accept a loose, safe ceiling now and revisit with real production data later (Path B) — because the pattern across both rounds gives no assurance that Path A's next iteration is actually the last one.

---

## Verdict

Not a graded round — no new verdict computed by this seat. Restated for the council's shared packet: **1 open HIGH** (Open #1, T11 invocation-shape), **2 open MEDs, both boundary-crossing → route to named proof-tests, not the residual register** (Open #2, Open #3). Recommendation defaults to **"build now, open findings become day-1 failing tests"** per this agent's own Stop Brief default — nothing here requires new topology or an ADR change; Open #1 is a measurement-methodology fix (or a config-shape decision per Path C), and Opens #2/#3 are each a named, buildable fixture test against code that doesn't exist yet. The one item this seat flags as a genuine council-level judgment call, not a code fix, is the **Path A vs. Path B tradeoff** in section 4 — how tightly to pursue the timeout number before shipping — which is a cost/risk call for the impact-analyst and architecture-reviewer, not something this seat resolves alone.
