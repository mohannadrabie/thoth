# Phase 0 decomposition: #308 activation, remaining items

Date: 2026-10-02. Author: story-implementer (Ptah). Phase 0 only: nothing built, nothing committed, no file edited except this one.
Branch `s308/activation` at 9d2e412 (S0..S4 of the Phase 1 plan are merged via PR #380).
`📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT]`

Inputs: `docs/plans/s308-activation-phase1-2026-09-30.md`, `docs/decisions.md` row 2026-10-02 (human rulings), intake verdict (READY, PROJECT, 14 items).

## 1. ADR constraints that shape the boundaries

| ADR | Rule (quoted or paraphrased from catalog) | Effect on the split |
|---|---|---|
| THOTH-ADR-0001 | "MUST NOT be cited to justify any other allowlist, file, or control"; "MUST NOT hardcode an entry of either list in hooks/ or src/" | AP-1 rules cannot ship (fixture as enforcement input) until the amendment is accepted. Story A blocks story E. |
| THOTH-ADR-0001 exception (CLAUDE.md) | fixture entry add/remove needs no fresh review report; the merged diff is the approval | AP-3 labels are fixture entries: PR diff is the approval. Loader/hook changes are not covered. |
| SE ADR-0005 | locked tests are replaced as an explicit recorded act | AP-2 re-vendor replaces the AP-12 tripwire; AP-1 may flip locked rows. Each is its own commit with a decisions row. |
| SE ADR-0021 (INT-07, POL-12) | open normalizer registry; classes emit verbs | AP-3 labels use existing class `remote-mutating`; no new class. |

No other ADR applicable (no infra, no API/data surface).

## 2. Story set (commits on `s308/activation`, one PR)

> Exception: story A is a PR to the `adr/` submodule repo (per `/maat:adr-amend`), then a submodule-pointer bump commit here. Human accepts and merges both. Agents never self-accept.

| Story | Items | Goal | Depends on | Tier | test-writer |
|---|---|---|---|---|---|
| A | 1 (AP-7) | Draft THOTH-ADR-0001 amendment: fixture is an official gate input; rule 5 (halt-state path) does not bind the write-free gate; tests derive entry names from the fixture (Q-C (e)) | none (start first, long pole) | CRITICAL (policy delivery, ADR outranks CLAUDE.md) | No |
| B | 12 (AP-5, X-2, X-3, X-8, X-9, U-5) | Live spikes in a scratch folder outside the repo; raw output recorded as evidence | none (run early: rules 17/18, feeds D and J) | STANDARD (no repo behavior change; evidence only) | No |
| C | 2, 3, 4 (AP-2, AP-3, AP-8) | Re-vendor inventory, classify 23 built-ins incl. ToolSearch, label 8 connectors `remote-mutating`, replace the AP-12 tripwire, add shared-inventory agreement test | none | STANDARD, raise to CRITICAL if a built-in lands in a class the gate allows (data feeds the gate) | No |
| D | 11 (AP-13) | Launcher mapping every exit other than 0 and 2 to 2 on Windows | B (env-block reach decides the form); spike (d) local first | CRITICAL (session gate, launcher is a control surface) | No (Manager may rule launcher an API surface) |
| E | 5 (AP-1) | Baseline rules "read freely, protect the gate"; PT-1/PT-2/PT-12 failing first | A merged; C merged (rules reference classes) | CRITICAL (guard content, policy delivery) | No |
| F | 6 (AP-10) | Deny rules for gate code, policy files, fixture, settings; generated-list test `activation-preconditions` | E | CRITICAL (self-protection of the gate) | No |
| G | 7, 8, 10 (AP-6, AP-9, X-10, X-12, X-6/Q4) | Decisions rows (criterion 12, Q4), AP-9 runbook, read-only pre-flight of `loadEffectivePolicy` against live HKLM | none (pre-flight rerun after E, F) | TRIVIAL (docs, decisions) ; pre-flight is read-only | No |
| H | 9 (X-11) | Gate-side unlock wording for lowering fixture entry and schema-invalid rule, pinned by render test | Manager Q3 | CRITICAL (edits `hooks/pretooluse-kernel-gate.mjs` / `render-hook-output.ts`, named sensitive area) | No (no UI/API surface; render test written failing first) |
| J | 13 (AP-4, AP-5) + U-8 | Matcher `Bash` + `mcp__.*`, timeout 60: derive and record, rerun four qa checks, U-8 end-to-end in a scratch session against the real rules | D, E, F, H, B | CRITICAL (verification of the gate as it will wire) | No |
| K (held) | 14 (S12) | `.claude/settings.json` PreToolUse entry | all above, fresh reports, separate human approval | CRITICAL, HUMAN-ONLY | No |

### Sequencing

```
A ──────────────┐
C ──────────────┴─> E ──> F ──┐
B ──> D ──────────────────────┼─> J ──> K (held)
H (after Q3) ─────────────────┤
G (docs; pre-flight rerun) ───┘
```

- Critical path: A (human acceptance) -> E -> F -> J -> K.
- Start in parallel now: A (draft), B, C, G, H once Q3 is answered.
- Ship order within the PR: G-docs, C, H, D, E, F, J-evidence. K is not in the PR.
- Safety ordering: no rule ships (E) before A is accepted; no settings entry (K) before J is green and reports are fresh.
- No flag exists for the entry; the entry itself is the switch. Rollback is removing the entry (human).

## 3. Acceptance criteria per story (each mapped to a named check)

Check names beginning `NEW:` are tests to be written failing first; the rest exist today.

### A. ADR amendment

| # | Criterion | Check |
|---|---|---|
| A1 | Amendment text states: fixture is a gate input; label change only via reviewed PR; rule 5 does not bind the write-free gate; tests derive entry names at run time | Human read; `node docs/adr-cache.mjs --ensure` parses the amended ADR (rules block present, status accepted only after human acceptance) |
| A2 | The "MUST NOT hardcode an entry" rule is narrowed, not dropped | Diff review by architecture-reviewer |
| A3 | Submodule pointer bumped here only after the ADR repo PR merges | `git submodule status` shows the merged SHA |

### B. Live spikes (scratch folder outside this repo; raw `claude -p` output saved as evidence)

| # | Criterion | Check |
|---|---|---|
| B1 | AP-5: wall clock of the real hook at `timeout` 60 on the real runtime | Recorded measurement, compared with `qa:gate-latency-budget` p99 |
| B2 | X-2: stdout-closed-before-write reach in a real session | Recorded transcript; probe row `stdout-closed-before-write` unchanged |
| B3 | X-3: which characters the runtime sanitizes in tool names | Recorded server/tool names tried and the `tool_name` the hook received; N13 (`tool-class.test.ts:270`) re-read against it |
| B4 | X-8: whether a settings `env` block reaches hooks | Recorded run; result gates the form of D |
| B5 | X-9: reader buffer behavior for a deny reason near the 512-char cap | Recorded run |
| B6 | U-5: matcher regex `mcp__.*` matches an MCP call | Recorded run with a stdio MCP server |
| B7 | Nothing in this repo's `.claude/settings.json` changes | `git diff --stat -- .claude/settings.json` empty |

U-8 (full Bash + MCP session against the real rules) moves to J because it needs E and F.

### C. Inventory, connectors, agreement

| # | Criterion | Check |
|---|---|---|
| C1 | Inventory re-vendored from this install; capturedAt updated; evidence tier stated | `qa:gate-matcher-drift` PASS; diff review |
| C2 | All 23 built-ins classified, incl. ToolSearch | NEW: test enumerating inventory names vs `s5-central-classification.json` (generated list, not hand count) |
| C3 | AP-12 tripwire replaced as a recorded act with the real assertion: PowerShell, Skill, Workflow, CronCreate, RemoteTrigger not read-only | `src/qa/arbitrary-exec-classification.test.ts` rewritten; seeded mutant (reclassify one as read-only) is flagged; decisions row per SE ADR-0005 |
| C4 | 8 `knownConnectors` labelled `remote-mutating` | NEW: test over the fixture entries (names derived at run time per Q-C (e)) |
| C5 | SessionStart and gate agree on one inventory | NEW: agreement test calling both consumers through `classification-catalog.ts` (G14) over the refreshed inventory |
| C6 | Existing classification tests and R1-6c instrument still green | `node --test src/qa/catalog-single-source.test.ts` and classification tests |

### D. Launcher (AP-13)

| # | Criterion | Check |
|---|---|---|
| D1 | Spike first: exit-code behavior on Windows Node 24 with SYSTEMROOT nonexistent | Recorded spike output before any launcher code |
| D2 | Every exit other than 0 and 2 maps to 2 | NEW: launcher unit test with stub child exiting 1, 3, 127, signal-kill |
| D3 | Five probe rows flip PROCEEDS to BLOCKS: interpreter-off-PATH, NODE_OPTIONS bad flag, SYSTEMROOT nonexistent (Node 24), unparseable script, memory exhaustion | `node --test src/qa/gate-fail-open-probe.test.ts` (rows updated as a recorded act) |
| D4 | Launcher path resolves | `qa:gate-command-path` PASS |
| D5 | Disclosed limit: a tampered in-graph module that exits 0 is not closed (X-8) | Header comment in the launcher test; reviewer check |
| D6 | No claim about env-block behavior beyond B4 | Reviewer check against B4 evidence |

### E. Baseline rules (AP-1)

| # | Criterion | Check |
|---|---|---|
| E1 | PT-1, PT-2, PT-12 exist as named tests, written and seen failing before any rule ships | NEW: tests named `PT-1`, `PT-2`, `PT-12` against the real shipped-defaults; red run recorded |
| E2 | Read-only tools and commands allowed; N9/N9b/H11/H11b shapes re-run against real rules | Existing tests N9, N9b, H11, H11b, now run against shipped rules |
| E3 | Everything not matched follows the default outcome (see section 5, third item) | NEW: test asserting the resolved `defaultOutcome` and its `source` with the shipped rules loaded |
| E4 | Allow list ratified by the Manager before commit | Decisions row |
| E5 | #306 and #329 cited, still closed | Doc check |

### F. Deny rules (AP-10)

| # | Criterion | Check |
|---|---|---|
| F1 | Deny rules protect `.thoth/policy.json`, `shipped-defaults.json`, the classification fixture, the gate's own code, settings files | NEW: `activation-preconditions` |
| F2 | The protected-path list is generated from the hook import graph, not typed | `activation-preconditions` derives the list by AST over the hook's imports (same scan as `hook-import-pins.test.ts`) |
| F3 | Test fails when any path in the graph is unmatched | Seeded mutant: remove one deny rule or add one import; the test fails |
| F4 | A deny rule cannot be bypassed by the path forms Windows allows (case, `\` vs `/`, `..`) | NEW: normalizer-level cases against each protected path |

### G. Docs and decisions

| # | Criterion | Check |
|---|---|---|
| G1 | AP-6 decisions row for S5 criterion 12 (Manager writes) | `grep -i "criterion 12" docs/decisions.md` has a row |
| G2 | Runbook states out-of-session repair: write `CentralPolicyJson` or remove the key; includes X-12 (schema-valid central typo blast radius) and the non-English half-provisioned key (X-1, #309) | Doc review; `qa:reference-resolver origin/master HEAD` (QA-14 diff mode) |
| G3 | Read-only pre-flight: `loadEffectivePolicy` against live HKLM returns a result, no write | Recorded command output; command is read-only by inspection (reg query only) |
| G4 | Q4 decision row recorded (see section 5) | `docs/decisions.md` row |

### H. Gate-side unlock wording (X-11)

| # | Criterion | Check |
|---|---|---|
| H1 | Lowering fixture entry yields wording naming the real remedy | NEW: hook-level test with a lowering fixture on an MCP call; stderr matches the fixed line |
| H2 | Schema-invalid rule yields deny reason with an unlock clause, per failed layer | NEW: `render-hook-output.test.ts` case per `failedLayer` x `reasonKind` |
| H3 | No path, no stack frame, no parser text | Existing `hooks/pretooluse-kernel-gate-stderr.test.ts` (G22) and `pretooluse-kernel-gate-sanitize.test.ts` still pass |
| H4 | Unknown kind falls back to the generic line | NEW: render test with an unknown `reasonKind` |
| H5 | `FIXED_LINE` regex in `hooks/pretooluse-kernel-gate-builtin-override.test.ts:72` still matches | Existing test (a locked answer key; a regex change is a recorded act, not a silent edit) |

### J. Entry derivation and rerun (no entry written)

| # | Criterion | Check |
|---|---|---|
| J1 | Matcher `Bash` + `mcp__.*`, timeout 60 recorded as the proposed entry text, in the plan, not in settings.json | Doc |
| J2 | Four qa checks green against the proposed entry in a scratch copy of the settings | `qa:gate-command-path`, `qa:gate-matcher-drift`, `qa:gate-manifest`, `qa:gate-latency-budget` |
| J3 | U-8: a Bash call and an MCP call through the real runtime in a scratch session, allow and deny both exercised | Recorded transcript |
| J4 | Full regression | `npm test` real counts (skipped is not passed), `qa:*` set, fresh `docs/reviews/` reports |

### K. Held

| # | Criterion | Check |
|---|---|---|
| K1 | Explicit human approval recorded in `docs/decisions.md` | Row exists, Human = Y |
| K2 | After merge, `qa:gate-*` four checks green on the real file | Run |

## 4. Reviewer sets and human touchpoints

| Story | Sensitive area (CLAUDE.md) | Reviewers | Human touchpoint |
|---|---|---|---|
| A | Policy delivery / config surface | architecture-reviewer, cross-domain-reviewer | Accept and merge the ADR repo PR |
| B | none (evidence) | code-reviewer (evidence integrity) | Approve running live sessions (spend, scratch folder) |
| C | Policy delivery (fixture; exception applies to entries only), guard | app-security-reviewer, cross-domain-reviewer | Merge; re-vendor is a reviewed act |
| D | Session gate | red-team, app-security-reviewer, cross-domain-reviewer | none until merge |
| E | Guard / policy engine, policy delivery | red-team, architecture-reviewer, cross-domain-reviewer | Manager ratifies allow list |
| F | Guard, session gate (self-protection) | red-team, app-security-reviewer, cross-domain-reviewer | none until merge |
| G | none | self-review | Manager writes G1 and G4 rows |
| H | Session gate | app-security-reviewer, cross-domain-reviewer | Manager answers Q3 |
| J | Session gate | red-team, cross-domain-reviewer | none until merge |
| K | Session gate, settings file | all CRITICAL reports fresh | Separate explicit approval; human merges |

- Merge to master is human-only for the whole PR.
- Cap check: no story needs more than two domain reviewers beyond red-team and the standing cross-domain pass.
- Per CLAUDE.md, each sensitive-area story needs a fresh dated report in `docs/reviews/` before ship (C only as to loader/hook code, none expected).

## 5. Facts for the Manager's decisions

### 5a. Q3: gate-side unlock text (X-11)

Current text, `hooks/pretooluse-kernel-gate.mjs:87`:

```
Unlock: retry the call; if it fails again a human must repair the gate hook (it needs Node 22.18 or newer and an intact checkout).
```

Printed by `failClosed` (lines 69-96) as `pretooluse-kernel-gate.mjs: <what>, fail-closed (exit 2). <UNLOCK> Error type: <name>` on stderr, exit 2. The name is kept only if it matches `/^[A-Za-z]{1,40}$/`, else `Error`. Pinned shape: `FIXED_LINE` in `hooks/pretooluse-kernel-gate-builtin-override.test.ts:72`; no path, no `\n at ` frames (G22, launch test A6).

How the two failures reach the gate today:

| Failure | Where it surfaces | What the model/human sees | Defect |
|---|---|---|---|
| Lowering fixture entry | `assembleCatalog` throws (`classification-catalog.ts:110`) inside the `loadCatalog` port. Called only when the route `needsCatalog`, so MCP calls only; Bash is unaffected. The throw reaches the hook's `catch` | stderr, exit 2: "internal exception, fail-closed. Unlock: retry ... repair the gate hook (Node 22.18 ... intact checkout). Error type: Error". The thrown message (names the entry and the fix) is discarded by design | Remedy is wrong: the fix is a reviewed edit to the fixture entry, not Node or the checkout. Retrying cannot help |
| Schema-invalid rule | Loader returns `ok:false` (`reasonKind: "schema-invalid"`, `failedLayer`: central, shipped-defaults or project). Gate returns a `policy-load-failure` refusal; `renderHookOutput` emits a deny JSON on stdout, exit 0 | "policy load failed: layer project, kind schema-invalid; fail-closed". No unlock clause at all | Violates PRINCIPLES rule 2 (a block names its unlock). Applies to every gated call, Bash and MCP |

Constraints: reason text passes `sanitizeForTerminal` (#312); stderr must stay fixed text (G22); `GatePorts` carry layer and kind only (#124/#294); `src/policy/gate/**` imports no `node:*` or `config/` (G15).

Options:

| | Option 1: one broader generic line | Option 2: closed per-kind unlock text (recommended) |
|---|---|---|
| Lowering entry | Reword `UNLOCK` for all hook failures: "Unlock: retry the call; if it fails again a human must repair the gate: the hook needs Node 22.18 or newer and an intact checkout, and policy files and the tool classification file change only through a reviewed pull request." | Catalog throw is tagged with a fixed letters-only error name (for example `ClassificationFixtureError`); `failClosed` maps that name from a closed table to: "Unlock: a human must fix the tool classification file (an entry lowers a built-in tool's class) through a reviewed pull request; retrying will not help." Unknown name falls back to the generic line |
| Schema-invalid rule | Append one generic clause to the refusal reason: "Unlock: a human must correct the policy file of the named layer; retrying will not help." | Refusal text chosen from the closed `failedLayer` set: project or shipped-defaults: "Unlock: a human must correct that layer's policy file through a reviewed change; retrying will not help." central: "Unlock: the central policy owner must correct the central policy out of session; retrying will not help." |
| Cost | Edit one const and one string; two render/hook tests | One new error class, one closed map in the hook, one switch in `decide-tool-call.ts` or `render-hook-output.ts`; tests per layer and an unknown-kind fallback |
| Gap | Still gives the wrong first-line remedy for a lowering entry (retry) | None for the two named cases; adds code in a sensitive file |

Recommendation: Option 2. The current stderr line actively misdirects on the lowering case, and the central/non-central split matters (a session user cannot fix central; X-12). Both kinds are already closed enums, so no free text reaches the model. If the Manager prefers fewer moving parts, Option 1 is acceptable only if the lowering case is also reworded to drop "retry", which makes it Option 2-lite for the lowering path.

### 5b. Q4: the #288 ignored-relaxation disclosure (X-6)

Source: `gh issue view 288` body, bullet 3: "Disclose an ignored relaxing declaration (a lower-trust layer trying to relax a higher-trust posture) the way `inertMandatoryDeclarations` does; today it is ignored, fail-closed, and visible only through `source`." Re-home comment 2026-09-26 15:24 moved it to #308; the 16:52 comment narrowed the *other* item (hook consumption as a live path) and did not change this one. The red-team comment (2026-09-24 04:19) found the whole deferral "not bound to anything".

| Question | Answer (read from `src/policy/rule/precedence.ts:190-215`) |
|---|---|
| What is ignored | A `defaultOutcome` declaration from a layer of strictly lower `TRUST_RANK` than the layer holding the posture, when it does not tighten allow to deny. Rank: central 1; shipped-defaults and project 0 (peers) |
| Which path | `resolveDefaultOutcome`. `lowerTrust` and not `tightens` leaves `held` unchanged; the layer is not voided and nothing is reported |
| Who can trigger it | Only a project or shipped-defaults `defaultOutcome: "allow"` against a central `deny`. Peers override each other, so project can relax a shipped-defaults deny (decided and kept, #288 comment 2026-09-26 14:37). With no central key present, nothing is ignored |
| Effect on the gate | None beyond what fail-closed already gives: the stricter central value is the one the gate enforces |
| Author belief | An author who wrote `allow` in project believes it relaxed the posture; the gate stays at central's deny. The only trace is the posture line (`source`) on `policy:print`, and the hook does not print |
| Security posture | Not changed. The gate is stricter than the author believes, never looser. The relaxation attempt cannot weaken anything |

Classification: author-feedback only. It is an availability and surprise issue (an author's allow is silently inert), not a strictness gap.

Recommendation: does NOT bind activation. Record a decisions row (story G, G4) that it stays deferred with the posture line as the visible surface and the stricter-than-believed direction as the rationale; keep #288 open for it (or file it as a backlog Issue) rather than building it in the activation PR. Closing #288's other item (live-path consumption) happens with #308. Caveat: the human ratified "peers override each other" for project vs shipped-defaults, so a relaxing project declaration against shipped-defaults is live and intentional, not an ignored one.

### 5c. Which `defaultOutcome` applies to "everything else follows the default outcome" (AP-1 posture)

- Value today: `"allow"`.
- Source in code: `src/policy/config/loader.ts:284`: `lockResult.defaultOutcome ?? { outcome: BOOTSTRAP_DEFAULT_OUTCOME, source: "bootstrap" }`; `BOOTSTRAP_DEFAULT_OUTCOME = "allow"` (`src/policy/config/bootstrap-ruleset.ts:49`, pinned by `bootstrap-ruleset.test.ts:22`).
- Why no layer overrides it: `src/policy/config/shipped-defaults.json` is `{"version":"0.0.0-s6-placeholder","rules":[]}` and declares no `defaultOutcome`; `.thoth/policy.json` is `rules: []` (Phase 1 plan evidence). Central is absent unless HKLM is provisioned (G3 pre-flight checks it).
- The hook passes `loaded.defaultOutcome.outcome` (`hooks/pretooluse-kernel-gate.mjs`, `loadPolicy`) into `decideToolCall`; the kernel applies it last: POL-05, then configured rules, then `defaultOutcome` (`kernel.ts:177`).
- What "allow" means in practice: a cleanly resolved, non-ambiguous action that matches no rule is allowed. POL-05 still denies mutating actions whose source is opaque or whose `unresolved` list is non-empty before the default is reached. A cleanly resolved mutating Bash command (for example one that resolves to a known write verb) with no matching rule follows `allow`.
- Consequence to confirm with the human: under the ruled posture "read freely, protect the gate" plus default allow, only listed deny rules (AP-10 paths) stop a mutating command. The ruling said "Everything else follows the default outcome", so this is what it says, but it is not "deny by default". Unclassified MCP tools are refused at the catalog (gate), not by the default (Phase 1 AP-3 row), which is why AP-3 was needed.
- Open choice for E3: leave `defaultOutcome` undeclared (resolved source `bootstrap`) or declare `"allow"` explicitly in shipped-defaults (source `shipped-defaults`, relaxable by nobody above peers except project). Recommend leaving it undeclared: fewer files in the protected set and no new declaration to defend; E3 pins the value and the source either way.

## 6. Precondition status tally (script output, no hand count)

Script: `C:\Users\mohan\AppData\Local\Temp\claude\c--playground-thoth\8ad5767a-314b-4edb-9473-2aa394aa0c0a\scratchpad\tally.mjs` (throwaway, not committed). It parses the AP and X tables in `docs/plans/s308-activation-phase1-2026-09-30.md` and buckets each row by the leading token of its Status cell.

```
rows: 36
NOT MET 14   AP-1,AP-2,AP-3,AP-4,AP-5,AP-6,AP-7,AP-8,AP-10,AP-11,X-7,X-8,X-10,X-11
PARTLY MET 3 AP-9,AP-12,AP-13
MET-or-closed 16  AP-14,X-1,X-2,X-3,X-5,X-6,X-12,X-13,X-14,X-15,X-16,X-17,X-18,X-19,X-20,X-21
IN-FLIGHT 2  X-9,X-22
OTHER 1      X-4
Compound rows (leading token hides a NOT MET half): X-3, X-4, X-6, X-21
```

Reading it:
- The tally is of the table as written on 2026-09-30, a snapshot at s7/closeout 2d02d69. It has not been recomputed against current repo state, except for the issue checks below.
- Issues listed IN-FLIGHT or "stays OPEN until s7/closeout merges" are now CLOSED (live `gh issue view`): #361, #326, #320, #374, #375, #338, #340. So X-9, X-22 and the IN-FLIGHT half of X-4 are stale; X-19 and X-21's probe row stand. Rows were not edited.
- Still OPEN: #107 (X-7, backstop 2026-10-24), #93, #288, #308.
- AP-11, AP-7, AP-3, AP-2, AP-6 are now ruled in `docs/decisions.md` (2026-10-02) but the table still says NOT MET until the work lands, which is the correct reading: a ruling is not the built artifact.
- Compound rows are tallied by their first token; reading them whole, X-3 (X-2 settle), X-4 (two LOW notes), X-6 (disclosure) and X-21 (launcher) each still carry an unmet half.
- No claim of "all met". The tally must be regenerated after each story lands; story J reruns it.
- Instrument limit: it is a heuristic over first-token status text, not a verification of any status claim. A status cell edited without evidence changes the tally.

## 7. Questions for the Manager

1. Q3 (section 5a): Option 1 or Option 2? Blocks story H.
2. Q4 (section 5b): confirm "does not bind", with the decisions row in story G?
3. AP-1 posture (section 5c): confirm default stays `allow` (bootstrap, undeclared), consistent with "read freely, protect the gate"; confirm the human understands that only listed rules deny mutating commands the classifier resolves cleanly.
4. Is the launcher (story D) an "API surface" for `test-writer`? Default answer here: no.
5. Run B (live spikes) before D, as proposed? It spends live Claude Code sessions in a scratch folder; no repo change.

## 8. Next single action

Approve this shape (Manager answers Q3, Q4 and the AP-1 posture), then approve Phase 1 per story in the order G, C, H, A (draft, in parallel with B), D, E, F, J. Nothing is wired; K needs its own approval.

RECEIPT: verdict=BUILD-COMPLETE criteria="0 mapped/0 total (Phase 0: AC lists drafted per story, section 3)" checks="0/0/0 (tally script run: 36 rows, 14 NOT MET, 3 PARTLY, 16 MET-or-closed, 2 IN-FLIGHT, 1 OTHER)" adr=HIT(37) pr=n/a
