# S7 intake: wire `hooks/pretooluse-kernel-gate.mjs` (Issue #93)

Date: 2026-09-26. Source: `intake-refiner` run, Manager-checked. **Verdict: NEEDS-INFO.** Phase 1 does not start until the five questions below are ruled.

## Story

- Tool classification must drive an enforcement decision (SUR-03: "the classification shall drive enforcement"). Today `centralLayer.tools[].class` is read by nothing (Issue #93).
- `hooks/pretooluse-kernel-gate.mjs` is built and tested but has no `PreToolUse` entry in `.claude/settings.json`.
- Binding preconditions: Issue #288 (Manager comment) and the Issue #107 ratified residual.

## Facts established at intake

| Fact | Evidence |
|---|---|
| No `PreToolUse` entry exists in `.claude/settings.json` | `hooks` holds only `SessionStart` and `UserPromptSubmit` |
| The report-subject gate hook script does not exist | not in `hooks/`; settings comment says the entry was deleted 2026-09-06 (Issue #87) |
| `CLAUDE.md` "Sensitive areas" still names the deleted report-subject gate hook script | doc drift; human-owned file, not edited here |
| The hook accepts only `tool_name == "Bash"` and denies any other tool | `hooks/pretooluse-kernel-gate.mjs`, criterion 19 |
| The classification fixture holds 6 tools, all `remote-mutating` MCP servers | `docs/qa/s5-central-classification.json` |
| `shipped-defaults.json` has `rules: []` | wiring Bash live denies ordinary commands until baseline policy content exists |
| `VerdictOutcome` is `allow` or `deny` only | `src/policy/kernel/` |

## Requirements

| # | Requirement | Source |
|---|---|---|
| R1 | A tool's class drives an enforcement decision. Acceptance: flipping a `centralLayer.tools[].class` entry turns a named test red. Mapping is open (Q1). | SUR-03; `docs/backlog.md` #93 entry |
| R2 | Add a `PreToolUse` entry with an explicit `timeout` (the hook header declares 60). Must pass `qa:gate-command-path`, `qa:gate-matcher-drift`, `qa:runtime-settings-drift`. | SUR-12, SUR-13, SUR-05 |
| R3 | The hook passes the loader's resolved posture as `WorldFacts.defaultOutcome`, replacing the bootstrap constant. | #288 body; `loader.ts` |
| R4 | **Go-live blocker.** Surface the resolved posture and its source on the operator print surface: a `PrinterResult` field plus a `print-cli.ts` line, not printer stdout. Needs a test-writer amendment to `printer.test.ts`. | #288 PRECONDITION (1) |
| R5 | **Go-live blocker.** Re-decide the peer-override case in Phase 1: project may relax a shipped-defaults deny when central is absent; a lower-trust layer may tighten to deny. | #288 PRECONDITION (2) |
| R6 | **Go-live blocker.** Confirm the Node 22 raw-bytes assertion in `printer.test.ts` on CI. | #288 PRECONDITION (3) |
| R7 | Disclose an ignored relaxing declaration, like `inertMandatoryDeclarations`. In scope or not: Q3. | #288 body |
| R8 | No explicit `defaultOutcomeMandatory` flag. The lock by trust rank stays. | #288 body; 2026-09-24 D1 |
| R9 | Issue #107: before the loader is live, either capture a verified non-English sample or replace the text match with a locale-independent existence check, and re-open the ratified-residual row. Calendar backstop 2026-10-24. | `docs/decisions.md` 2026-09-24 row |
| R10 | Kernel constraints (SE ADR-0021): one kernel artifact for all gates; no branch on a field outside the seven Action-record fields; no tool-identity inspection; a normalizer never returns a verdict. | ADR-0021 "Rules for agents" |
| R11 | Every fail-open path of the live wiring is an enumerated, recorded decision. | SUR-10 |
| R12 | Latency stays inside the `qa:gate-latency-budget` ceiling (p99 2000 ms) with the loader in the path. | OPS-03; SUR-12 |
| R13 | No durable-evidence-trail claim; hook verdicts have no trail until S8 (INT-05). | hook header |

## Open questions, with the Manager's recommendation

**Q1. What does "drives enforcement" mean, and which tools must the gate see?**
- Only `Bash` reaches the gate today; the classified tools are MCP servers. A class-driven gate needs the matcher widened to MCP calls. The runtime `tool_name` shape for an MCP call is unverified and needs a spike (PRINCIPLES rule 18).
- Recommended mapping, fail-closed: `read-only` allow; `workspace-mutating` and `remote-mutating` deny unless a rule allows; unclassified deny at call time (session-start halt stays).

**Q2. Mechanism against ADR-0021.** The kernel may not inspect tool identity or branch outside the seven fields.
- (a) A normalizer carries the class into existing fields, so class is rule data. No ADR change; new normalizers are registered by declaration (POL-12).
- (b) Amend the ADR to allow a class field. Human-accepted only.
- Recommended: (a). If Phase 1 shows the seven fields cannot carry it, stop and bring (b) back as a ruling.

**Q3. Scope and activation.** Is this #93 plus R4 to R6 and R9, or #93 alone?
- Recommended: R3 to R6 and R9 in, because they block go-live. R7 in only if it is a small change in the same files.
- Recommended split: this story delivers the consumer and preconditions with the hook still unwired. Activation in `settings.json` is a last step gated on baseline allow-policy content existing (the "real baseline policy content" fast-follow), so a live gate does not lock this repo out of its own Bash calls.

**Q4. Failure semantics and per-call cost.** When the loader returns a `LoadFailure`, deny or fall back to the bootstrap policy? Does the loader run per call (it spawns `reg.exe` on Windows) or once at session start?
- Recommended: deny on `LoadFailure`, matching the hook's exit 2 on any exception. Phase 1 measures per-call cost against the 2000 ms ceiling before choosing to cache.

**Q5. Outcome vocabulary.** `VerdictOutcome` has no `ask`.
- Recommended: keep `allow` and `deny` only. Adding `ask` is a separate change. Phase 1 verifies what `permissionDecision: "allow"` does to the normal permission prompt in Claude Code.

## Flagged for Phase 1

- Sensitive areas touched: a hook wired to `PreToolUse`, policy delivery (`loader.ts`, `precedence.ts`, printer), guard/policy engine (`src/policy/*`). Tier will be CRITICAL; a fresh dated review report is required.
- `test-writer` pass required: the hook's stdin/stdout contract is externally observable, and widening the matcher changes the locked AC-19 tests.
- Comments that say "inert" or "S6's job" become false once class is live: `central-classification.ts` header, the fixture `notes`, `.claude/settings.json` comment item 6, the `docs/backlog.md` #93 entry, `builtin-tool-inventory.ts` header.
- `intake-refiner` had no shell in this run and did not read the Issue threads; the Manager read #93 and #288 directly and supplied them.

## Manager rulings after the Phase 1 plan (2026-09-26)

Recorded here, not in `docs/decisions.md`: an attempt to append the decision-log row was blocked by the session's auto-mode classifier, so it is left for the human to record or ratify. The human said in-session on 2026-09-26 that they preapprove the Manager's decisions.

| Question | Ruling | Condition |
|---|---|---|
| Q1 to Q5 (intake) | As recommended in the section above. | Phase 1 confirmed route (a) works with the seven fields. |
| Q-A: `shipped-defaults.json` content | Option X: `defaultOutcome: "deny"`, an allow rule for the `tool/read-only/` class, an allow rule for non-mutating verbs. | `design-challenger` must attack the breadth of the allow rule. If the attack stands, fall back to option Y (no shipped content). |
| Q-B: hook output on a kernel allow | Emit nothing on allow, emit only deny. The gate is not an auto-approver. | `test-writer` amends locked AC-2. |
| Q-C: THOTH-ADR-0001 "PR diff is the approval" once class grants allow | Not ruled. Human-only. Blocks activation, not the build. | Recorded as an activation precondition. |
| Q-D: #107 under SE ADR-0010 ("MUST NOT delete tests") | Additive variant: keep `isNotFoundError`, `NOT_FOUND_PATTERNS` and their tests untouched; add the locale-independent two-step existence check for the case the text match does not classify. | No test is deleted, so no ADR-0010 exception is needed. |
| Peer-override (#288 precondition 2) | Keep peer semantics, no change to `precedence.ts`; the print line names a non-central source as "in-repo layer, not centrally enforced". | R7 deferred to backlog. |
| Cache | No cache; the measured saving is about 40 ms. | |
