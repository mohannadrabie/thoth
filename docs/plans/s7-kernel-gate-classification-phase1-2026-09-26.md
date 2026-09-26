# Phase 1 plan: s7-kernel-gate-classification (Issue #93, #288 preconditions, #107)

[story-implementer]
Story Implementer (Ptah) - Phase 1: planning

Branch `feat/s7-kernel-gate-classification` @ `fff858c` (origin/master). Input: `docs/plans/s7-kernel-gate-intake-2026-09-26.md`, Q1-Q5 ruled as "Recommended" (ratified constraints). Class: STORY. Hook stays UNWIRED (no `PreToolUse` entry in `.claude/settings.json`).

`📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog - ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`

## 0. Readiness

| Item | Result | Evidence |
|---|---|---|
| Q2 route (a): can the seven Action-record fields carry class? | YES. No blocking finding. No ADR change. | Section 4 encoding; `kernel.ts` `matchesVerb`/`matchesTarget` already match on `verbs` and `targets` data; unresolved/opaque path reuses POL-05 |
| Missing material fact | none that blocks planning | Two design forks need a ruling before `test-writer` runs (section 12, Q-A, Q-B) |
| Baseline | not re-run (no code touched this phase) | CI on master `fff858c`: run 36219917467, 1139 tests, 1139 pass, 0 fail, 0 skipped, node v22.18.0 (`gh run view`) |

## 1. ADR review (hard gate)

| ADR | Verdict | Rule quoted / reason |
|---|---|---|
| SE ADR-0021 (thoth-native) | APPLICABLE | "**MUST** normalize every governed tool call into a canonical Action record carrying at minimum the seven §3.1 fields ... **MUST NOT** add a field outside these seven that the kernel branches on." / "**MUST** register each per-tool-type normalizer on the normalizer registry by declaration; **MUST NOT** add a tool type by editing a shared dispatch chain or the kernel (POL-12)." / "**MUST NOT** let a normalizer return a verdict, or let the kernel inspect a tool's identity or shape directly." / "**MUST NOT** implement a second decision path anywhere" / "**MUST** deny a mutating action whose Action record has `source: opaque` or a non-empty `unresolved` field" / "**MUST** implement the policy kernel as a pure function" |
| THOTH-ADR-0001 (central-classification fixture) | APPLICABLE + UNCLEAR (Q-C) | Rule: "**MUST NOT** hardcode an entry of either list in `hooks/` or `src/`"; "**MUST** keep the fixture path resolving only from the project root plus `docs/qa/s5-central-classification.json`, or from `DEFAULT_FIXTURE_PATH` ... **MUST NOT** let any environment variable select an arbitrary fixture file". UNCLEAR: its residual table row "Inert classification" and its "the merged PR diff is the approval" ruling were made while class drove nothing. See Q-C |
| SE ADR-0002 (layering) | APPLICABLE | "**MUST** define external dependencies as interfaces/ports owned by the inner layer" - drives the gate module taking loader and catalog as parameters |
| SE ADR-0003 (SOLID/YAGNI) | APPLICABLE | "**MUST** inject I/O-performing dependencies ... via constructor/parameters"; "**SHOULD NOT** over-abstract". Supports the DI seam and the no-cache decision (section 6) |
| SE ADR-0005 (testing) | APPLICABLE | "**MUST** write unit tests for every new/changed domain or application behavior"; "**MUST NOT** delete or weaken a failing test to make CI pass". Bears on R9 test migration (Q-D) and on locked `test-writer` files |
| SE ADR-0006 (blast radius) | APPLICABLE | "**MUST** gate new user-facing behavior behind a feature flag defaulting to OFF when the change is risky" (the unwired hook is that flag); "**MUST NOT** widen a change's scope opportunistically" (R7 deferral) |
| SE ADR-0010 (quality gates) | APPLICABLE | "**MUST NOT** ... delete tests"; "**MUST** leave touched code at least as clean as found" (stale-comment list, section 10) |
| SE ADR-0004 (idempotency) | NOT-APPLICABLE (state) / one cheap determinism test kept (N8) | no mutating endpoint; `decide()` is pure |
| SE ADR-0001 | APPLICABLE (process) | agents propose ADR amendments, never edit an accepted one; THOTH-ADR-0001's stale row goes through `/maat:adr-amend` (Q-C) |
| THOTH-ADR-0002, SE ADR-0007..0009, 0011..0020, devops ADR-0001..0010 | NOT-APPLICABLE | secret-scan allowlist, tagging/cost/observability, data, port-fidelity (superseded 0017/0018), IaC. No infra in this story |

## 2. Restatement

Make a tool's classified class an input to the kernel verdict (fail-closed: read-only allow; workspace-mutating and remote-mutating deny unless a rule allows; unclassified deny) through a registered normalizer that carries class in the existing Action-record fields; make the gate hook consume the loader's resolved rules and posture; discharge the #288 and #107 go-live preconditions; leave the hook unwired.

## 3. SPIKE results (PRINCIPLES rules 17, 18). All run this session, 2026-09-26, Claude Code 2.1.267, Node 24.15.0, Windows 11.

### S-1. Runtime `tool_name` for MCP calls: OBSERVED (real `claude -p` session, logging PreToolUse hook, stdio MCP server defined in a scratch `.mcp.json`)

| Configured server key | Configured tool | Observed `tool_name` on stdin |
|---|---|---|
| `spike-one` | `echo.tool-x` | `mcp__spike-one__echo_tool-x` |
| `spike two.x y` | `echo.tool-x` | `mcp__spike_two_x_y__echo_tool-x` |
| built-in | - | `Read`, `ToolSearch` |

- Shape: `mcp__<server>__<tool>`. Space and `.` became `_` in both segments; `-` and `_` kept. Other characters were not tried (assumption: the same rule; a mismatch fails closed, the tool reads as unclassified and is denied).
- Classification keys are MCP server config names (fixture `centralLayer.tools[].name`, e.g. `github`). The runtime name needs the server segment extracted and both sides sanitized before lookup. The catalog holds no tool-level names.
- The runtime matcher regex form (`mcp__.*`) was NOT tested (spike matcher was empty = all tools). Activation check AP-4, not needed for this story.
- Raw log: scratchpad `spike/hook-log.jsonl` (4 PreToolUse lines: `ToolSearch`, the two MCP names, `Read`). Payload keys: `session_id, transcript_path, cwd, permission_mode, hook_event_name, tool_name, tool_input, tool_use_id` (+ `scratchpad_dir, prompt_id`).

### S-2. What a hook `allow` does to the normal permission prompt (Q5): OBSERVED

| Hook output | Result for `mcp__spike-one__echo_tool-x` with no `allowedTools` |
|---|---|
| exit 0, empty stdout | "Claude requested permissions to use mcp__spike-one__echo_tool-x, but you haven't granted it yet." (normal flow, not executed) |
| `permissionDecision: "allow"` | tool EXECUTED (`echo:hi`), no prompt |
| `permissionDecision: "deny"`, reason "spike deny" | blocked, reason surfaced to the model |
| hook `allow` + settings `permissions.deny: Read(./x.txt)` | Read denied ("denied by your permission settings"); the hook was never invoked (no log line) |

- Finding: **a kernel `allow` emitted as `permissionDecision: "allow"` is an auto-approve that skips the user's prompt.** Settings deny rules still win. See Q-B.
- The `process.stdout.write(...)` then `process.exit(0)` pattern (same as the shipped hook) was honored by the runtime for both the allow and the deny output.

### S-3. Runtime built-in tool universe vs the vendored inventory: OBSERVED (stream-json init `tools` list, mcp__ names excluded) and DIFFED by script

- Runtime built-ins: 34. Vendored `docs/qa/tool-inventory.json`: 19.
- In runtime, NOT vendored (23): `Artifact, CronCreate, CronDelete, CronList, DesignSync, EnterWorktree, ExitWorktree, ListAgents, ListMcpResourcesTool, Monitor, PowerShell, PushNotification, ReadMcpResourceDirTool, ReadMcpResourceTool, RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskOutput, TaskStop, ToolSearch, Workflow`.
- Vendored, NOT in runtime (8): `MultiEdit, BashOutput, KillShell, SlashCommand, ExitPlanMode, AskUserQuestion, ListMcpResources, ReadMcpResource`.
- Consequence: under "unclassified deny at call time" a live gate denies all 23, including `ToolSearch`. Observed in the deny-mode run: `ToolSearch` was the first call blocked, so a session could not even load deferred tools. SessionStart does not flag these (its universe is the vendored list). This is an ACTIVATION blocker (AP-2), out of this story's scope; it is why activation stays a separate step.
- Instrument (rerunnable): `claude -p "say ok" --model haiku --max-turns 1 --output-format stream-json --verbose < /dev/null`, read `system/init.tools`, subtract `mcp__*`, diff against `docs/qa/tool-inventory.json`.

### S-4. Loader per-call latency (Q4, R12): MEASURED. Method = `qa:gate-latency-budget`'s own: `spawnSync("node <script>", {shell:true})`, cold process each, stdin = a Bash `kubectl get` call, N=40, `hrtime`.

| Run | min | p50 | p95 | p99 | max (ms) |
|---|---|---|---|---|---|
| M1 node cold start only | 64.8 | 72.1 | 104.9 | 105.9 | 105.9 |
| M2 current hook (bootstrap constant, no loader) | 105.0 | 142.4 | 173.2 | 178.0 | 178.0 |
| M3 prototype hook: real `loadEffectivePolicy` (real `reg.exe` spawn, real shipped/project files, pin sha256) + catalog merge + kernel | 146.9 | 184.5 | 245.2 | 254.5 | 254.5 |

- Loader adds about +42 ms p50, +76 ms p99 (per-call `reg.exe` alone: p50 24.0, p99 38.5, N=30). p99 254.5 ms is 12.7% of the 2000 ms OPS-03 ceiling.
- Worst case, not typical: `central-source.ts` timeout is 5000 ms. A hung `reg.exe` costs 5 s (above OPS-03, far below the 60 s hook ceiling), then throws, then deny (fail-closed). Recorded as SUR-10 hook-timeout decision, attack point for design-challenger.
- CI is `ubuntu-latest`: central is "unsupported", no `reg.exe` spawn, so CI cannot measure the Windows cost. The Windows number above is the only measurement of it (disclosed, same caveat as the S5 spike).
- Decision: **NO cache.** Saving is about 40 ms against a 2000 ms budget; a cache is session-writable state on a policy path, and per-call reads make mid-session policy edits take effect immediately. Prototype: scratchpad `proto-hook.mjs`, `bench.mjs` (not repo code).

### S-5. #107 evidence (R9): MEASURED on this host

- `ls C:\Windows\System32\de-DE` has no `reg.exe.mui`: no non-English `reg.exe` messages exist on this machine, so **capturing a verified non-English sample is not possible here.**
- `reg query HKLM\SOFTWARE\Policies` (parent): exit 0, stdout lines `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\<subkey>` (CRLF). Root name and key names are data, not UI strings.
- `reg query HKLM\SOFTWARE\Policies\Thoth` and `... /v CentralPolicyJson`: exit 1, stderr English text (matches the shipped fixture).
- Prototype of the two-step existence check (scratchpad `li-check.mjs`, never reads stderr), 6 cases run against real `reg.exe`:

| Case | Result | Spawns |
|---|---|---|
| REAL target `Policies\Thoth` (nothing deployed) | `absent` | 1 |
| present key+value (stand-in `Windows NT\CurrentVersion\ProductName`) | `present`, data `Windows 10 Home` | 2 |
| key exists, value missing (stand-in) | `absent` | 2 |
| parent key missing | THROWS (fail-closed) | 1 |
| parent access denied (`HKLM\SAM\SAM`) | THROWS (fail-closed) | 1 |
| value type `REG_QWORD` | THROWS (fail-closed) | 2 |

- Timing (N=30): current one-call query p50 24.0 / p99 38.5 ms; proposed absent path (1 spawn) p50 29.8 / p99 36.9 ms; present path (2 spawns, stand-in with a large parent listing) p50 104.2 / p99 138.4 ms.
- Residual, disclosed: correctness on non-English hosts rests on the mechanism not reading any localized text (proved in tests C2), and on `HKLM\SOFTWARE\Policies` existing (present on this host; unverified elsewhere; if absent the load rejects fail-closed, an availability cost). Not demonstrated on a non-English host.

## 4. Design (one page; PRINCIPLES rule 17)

**Encoding (Q2 route a).** A new normalizer registered by declaration, `toolType: "tool-class"`, in `src/policy/normalizer/tool-class.ts`. Input `raw = { toolName, catalog, environment, identity, deferred }`. Output Action record:

| Case | `source` | `verbs` | `targets` | `unresolved` |
|---|---|---|---|---|
| read-only | structured | `["read"]` | `["tool/read-only/<kind>/..."]` | [] |
| workspace-mutating | structured | `["write"]` | `["tool/workspace-mutating/..."]` | [] |
| remote-mutating | structured | `["execute"]` | `["tool/remote-mutating/..."]` | [] |
| not in catalog, unparseable, `/` in a name, ambiguous sanitized collision, non-string input | opaque | [] | [] | one entry naming the cause |

- Target grammar: built-in `tool/<class>/builtin/<name>`; MCP `tool/<class>/mcp/<sanitizedServer>/<tool>`. Rules match with the existing kernel matcher (exact, or prefix ending `/`): whole class `tool/read-only/`, whole server `tool/remote-mutating/mcp/github/`, one tool exact.
- Class-to-verb table is `Record<ToolClass, string>`: a fourth class is a compile error (same property as `TRUST_RANK`).
- MCP lookup: for each catalog entry, match `mcp__<sanitize(entry.name)>__` as a prefix (trailing delimiter anchors it; longest match wins; two entries with different classes at the same sanitized name means unresolved). Built-ins match by exact name. Sanitize = `[^A-Za-z0-9_-]` to `_` (S-1).
- Unclassified is opaque plus unresolved, so **POL-05 denies it unconditionally** (`isMutating` is true whenever `unresolved` is non-empty). No rule can allow it; this is the ruled "unclassified deny at call time".
- "Mutating deny unless a rule allows" = posture deny plus allow rules. The kernel's deny-wins semantics rule out deny-class rules, so the deny side is the resolved `defaultOutcome`, the allow side is rules. See Q-A.
- Kernel, `registry.ts`, `shell.ts`, `structured-cluster.ts`, `action-record.ts`: zero diff. ADR-0021 not amended.

**Gate module** `src/policy/gate/decide-tool-call.ts` (new, pure with injected `loadPolicy()` and `loadCatalog()`; ADR-0002/0003). Flow: validate input; `TOOL_TYPE_BY_TOOL_NAME` data table (`Bash` maps to `shell`, default `tool-class`; a table, not a chain; a future filesystem normalizer is a data row); normalize; `loadPolicy()` failure means deny with `failedLayer` and `reasonKind` only (never the raw message: #124/#294 bound); `decide({rules: merged.rules, defaultOutcome: posture.outcome}, action)`. Flag for architecture-reviewer: the one table and the new directory.

**Hook** `hooks/pretooluse-kernel-gate.mjs`: thin. Reads stdin, builds real deps, calls the gate module, emits, exit 2 on any exception (unchanged). Paths: shipped-defaults and project policy module-relative (env-immune, as `print-cli.ts`); classification fixture per THOTH-ADR-0001 rule 5 (project root via `CLAUDE_PROJECT_DIR`/cwd, else `DEFAULT_FIXTURE_PATH`; same 3-line resolution as `hooks/sessionstart-tool-enum.mjs`, duplicated per that repo's convention). Catalog loaded only for non-Bash calls. Loader per call, no cache.

**Class is coarse:** the gate does not inspect `tool_input` for class-path calls (a `Read` of any path is one read-only call). Path-level rules need a filesystem normalizer (proposed backlog).

## 5. Risk tier: CRITICAL (agree with the Manager's proposal)

- Justification: adds the first live consumer of the loader and of tool class to a `PreToolUse` gate (sensitive areas: policy enforcement/session gate, guard/policy engine, policy delivery); an error fails open on enforcement, and this story fixes the go-live semantics even though it ships unwired.
- Challenge considered and rejected: "STANDARD because zero live exposure." CLAUDE.md requires a fresh dated review report for any change to these areas regardless of wiring, and the activation step inherits every decision made here.
- Persisted to `docs/.maat-state.json` by the Manager on ratification.

## 6. Constraints

- **CLAUDE.md hard rules:** no terraform/prod; no secrets (registry reader reads a policy blob, prints no env/args); unit tests with the feature; **no hand-derived completeness claims** (R11 fail-open list and the stale-comment list are instrument-generated: G9, S3); no gold-plating (everything else goes to section 13); merge stays human-only.
- **Sensitive areas touched, each needing a named reviewer's fresh dated report in `docs/reviews/`:**

| Area | Files | Reviewer report needed |
|---|---|---|
| Policy enforcement / session gate | `hooks/pretooluse-kernel-gate.mjs` | `red-team`, `app-security-reviewer` |
| Guard / policy engine | `src/policy/normalizer/tool-class.ts`, `src/policy/gate/*` | `red-team`, `cross-domain-reviewer` |
| Policy delivery / config surface | `shipped-defaults.json` (content), `printer.ts`, `print-cli.ts`, `central-source.ts` (R9), `central-classification.ts` (comment) | `app-security-reviewer` |
| Fixture (THOTH-ADR-0001) | `docs/qa/s5-central-classification.json` `notes` text only, no entry change | covered by this PR |
| Gate manifest | `.claude/settings.json` COMMENT lines only, no `hooks` change | `cross-domain-reviewer` verifies the diff |
| Untouched (stated): halt-state, evidence trail (`audit-log`), secret scanning / CI, `precedence.ts`, `schema.ts`, kernel | - | - |

- **Chain (CRITICAL):** `red-team` + `app-security-reviewer` (domain) + `cross-domain-reviewer` (standing), each isolated worktree; pre-build `design-challenger` and `architecture-reviewer` (section 11).
- **QA gates over new prose** (`decisions.md`, `backlog.md`, `CHANGELOG.md`, `STATE.md`, review reports): avoid backticked slash-containing shorthand paths and bare "all N" claims without a marker (QA-14, QA-15 tripped before). Run the qa gates locally before the PR.
- Never edit a `test-writer` file; flag it back.

## 7. Acceptance criteria as named test cases (`TW` = test-writer authors, `IMPL` = implementer's own tests, `CMD` = command evidence, `[D]` = derived)

### H: hook black-box, stdin to stdout (TW). New file `hooks/pretooluse-kernel-gate-classification.test.ts`; amendments to the locked file only where listed in section 9.

| ID | Named check |
|---|---|
| H1 | `tool_name Read (built-in read-only) is not denied: exit 0, decision present and not deny` |
| H2 | `tool_name Edit (built-in workspace-mutating, no allow rule) is denied` (locked AC-19 Edit test, stays valid) |
| H3 | `MCP tool of a remote-mutating server (mcp__github__create_issue, committed fixture) is denied` |
| H4 | `MCP tool of a server absent from the catalog (mcp__nosuchserver__x) is denied` |
| H5 | `R1 flip: with a planted fixture (isolated CLAUDE_PROJECT_DIR) classifying github read-only, mcp__github__create_issue is NOT denied; with the committed fixture it is denied` |
| H6 | `sanitized server name: planted fixture entry "spike two.x y" read-only, tool_name mcp__spike_two_x_y__echo_tool-x not denied; same entry remote-mutating denied` (names from S-1) |
| H7 | `Bash verdict is independent of Bash's class entry: planted fixture with Bash read-only, a POL-05 command is still denied` |
| H8 | `tool_name missing, or a non-string, denies` (locked AC-19 "missing" test plus a non-string case) |
| H9 | `on a kernel allow, stdout carries [per ruling Q-B]: no permissionDecision "allow" (default) / permissionDecision "allow"` |
| H10 | `the hook and the gate module import no filesystem-write API (no durable evidence trail claim, R13)` (structural: source scan) |

### N: normalizer unit (IMPL). `src/policy/normalizer/tool-class.test.ts`

| ID | Named check |
|---|---|
| N1 | hand-written ground truth: each of the 3 classes yields the section 4 verb and target, `source: structured`, `isActionRecord()` true |
| N2 | typecheck: `Record<ToolClass, ...>` is exhaustive (CMD `npm run typecheck`; adding a class fails compile) |
| N3 | name absent from catalog: `source: opaque`, `unresolved` non-empty; composed with `decide()` gives deny by POL-05 even with an allow rule for everything |
| N4 | MCP parse: sanitized names, longest-prefix, trailing-delimiter anchor (`mcp__aws-mcp-server__x` never matches entry `aws`), two entries colliding at one sanitized name with different classes is unresolved |
| N5 | a name containing `/` is unresolved (never a silent longer target; Issue #66 discipline) |
| N6 | malformed raw (non-string `toolName`, missing catalog, unknown class string at runtime) returns opaque and never throws |
| N7 | STRUCTURAL: `npm run qa:kernel-purity` PASS, `npm run qa:normalizer-registry-purity` PASS, `git diff --stat` empty for `kernel.ts`, `action-record.ts`, `rule-types.ts`, `registry.ts`, `shell.ts`, `structured-cluster.ts` (R10) |
| N8 | run twice, identical record and verdict (ADR-0004 lite) |

### G: gate module (IMPL). `src/policy/gate/decide-tool-call.test.ts`

| ID | Named check |
|---|---|
| G1 | each `LoadFailureReasonKind` (3) at each `failedLayer` (3), via a table typed `Record<LoadFailureReasonKind, ...>`: deny; reason names layer and kind and does NOT contain the raw message |
| G2 | `loadCatalog()` throws: deny (or propagates to the hook's exit 2; the test pins which) |
| G3 | R3 flip: same Bash action, loader posture `{deny, shipped-defaults}` denies, `{allow, bootstrap}` allows; posture comes from `LoadSuccess.defaultOutcome.outcome`, not a constant |
| G4 | R1 flip in memory: same tool, catalog class `read-only` allowed (class rule), `remote-mutating` denied, both directions asserted |
| G5 | per-tool allow rule (exact target) allows one mutating-class tool while its sibling stays denied ("deny unless a rule allows") |
| G6 | an explicit deny rule beats the class allow for a read-only tool (kernel deny-wins) |
| G7 | central declares deny, project declares allow, through the real loader with injected paths: verdict deny, source central (R3 with #288 semantics) |
| G8 | Bash `tool_input.command` missing or non-string: deny (moved from hook, behavior unchanged) |
| G9 | exported `GATE_FAIL_OPEN_DECISIONS` covers every path name parsed from the REQUIREMENTS.md SUR-10 row (set equality both ways) and every row names an existing test id |

### P: printer and CLI (TW). Amendment to `src/policy/config/printer.test.ts` (additive only) plus new `src/policy/config/print-cli.test.ts`.

| ID | Named check |
|---|---|
| P1 | `PrinterResult.posture` equals `{outcome, source}` for: shipped deny; central deny with project allow (source central); none declared (`{allow, bootstrap}`); undefined on rejection |
| P2 | `PrinterResult.postureLine` exact strings: `posture: deny (source: central)`; `posture: deny (source: shipped-defaults; in-repo layer, not centrally enforced)`; same shape for project; `posture: allow (source: bootstrap; no layer declared a posture)` |
| P3 | rejection: `postureLine` is `posture: unresolved (policy load rejected)`; `posture` undefined |
| P4 | `stdout` unchanged and does not contain the posture line (the locked exact-equality tests all pass unmodified; `git diff` for the file shows additions only) |
| P5 | disclosure-truth: `ENFORCEMENT_DISCLOSURE` says the hook is not wired iff `.claude/settings.json` has no `PreToolUse` entry for the gate script (both directions; activation forces a text update) |
| P6 | `print-cli` smoke: spawn `node src/policy/config/print-cli.ts`, stdout has one line matching `^posture: (allow\|deny) \(source: |^posture: unresolved`, exit code 0 or 1 |

### C: central-source reader, R9 (IMPL). Amend `src/policy/config/central-source.test.ts`

| ID | Named check |
|---|---|
| C1 | parent listing lacks the key: `absent`, runner called once with args `["query", "HKLM\\SOFTWARE\\Policies"]` |
| C2 | no stderr text can produce `absent`: parent listing fails with exit 1 and stderr in en-US (the old not-found string), de-DE, ja-JP and gibberish: all throw |
| C3 | key listed, key listing has a `REG_SZ` value line: `present`, `raw` and `channel` (fixture = real captured stdout shape) |
| C4 | key exists, value not listed: `absent` (parity with today) |
| C5 | value listed with a non-`REG_SZ` type: throws |
| C6 | key listing fails (status 1): throws |
| C7 | timeout or output overflow (status null / error set) at either call: throws |
| C8 | lookalike subkeys (`ThothX`, `Thoth2`) only: `absent` (exact match, not substring) |
| C9 | case-insensitive key match (`...\POLICIES\THOTH`): treated as the key existing |
| C10 | call shape: absolute `%SystemRoot%\System32\reg.exe` path, exact args, no shell, `stdio: ["ignore","pipe","pipe"]` |
| C11 | non-win32: `unsupported`, zero runner calls (existing test, unchanged) |
| C12 | present path parses the byte-for-byte real captured `reg query` sample already in this file |

### L: latency (R12)

| ID | Named check |
|---|---|
| L1 | CMD `npm run qa:gate-latency-budget` on Windows with the loader in the path: PASS, p99 recorded (M3 baseline p99 254.5 ms) |
| L2 | CMD spike `bench.mjs` on the built hook, BOTH a Bash call and an MCP call, N>=40: p99 below 2000 ms, numbers in the receipt |
| L3 | CMD the PR's CI run of `qa:gate-latency-budget` (Linux, no `reg.exe`): PASS |

### S: structural, regression, and mutation drills

| ID | Named check |
|---|---|
| S1 | CMD `npm run typecheck`, `npm run lint`, `npm run qa:kernel-purity`, `npm run qa:normalizer-registry-purity`, `node --test` (real pass/fail/skipped counts; skipped is not passed) |
| S2 | R2 regression: CMD `git diff origin/master -- .claude/settings.json` shows comment lines only and NO `hooks` object change; `npm run qa:gate-command-path`, `qa:gate-matcher-drift`, `qa:runtime-settings-drift`, `qa:gate-manifest` PASS |
| S3 | stale-comment scan: the grep in section 10 returns only the historical allow-list (0 stale hits) |
| S4 | R6: CMD `gh run view <this PR's run> --log` shows node v22.18.0 and the `ISSUE-123(b)` and `ISSUE-123(c)` tests `ok`; baseline already recorded at master `fff858c` (run 36219917467: v22.18.0, tests 1139, pass 1139, fail 0, skipped 0, `ok 187`, `ok 188`) |
| M1 | mutation drill: flip `github` to `read-only` in the real fixture, run: H3 goes RED; revert |
| M2 | mutation drill: normalizer ignores the class (same verb for all): N1, G4, H5 go RED |
| M3 | mutation drill: hook re-hardcodes `BOOTSTRAP_DEFAULT_OUTCOME`: G3, G7 go RED |
| M4 | mutation drill: `LoadFailure` returns allow: G1 goes RED |

### D: docs (IMPL drafts, Manager ratifies)

| ID | Named check |
|---|---|
| D1 | `docs/decisions.md` rows drafted: #288(2) peer re-decision; #107 row re-opened and resolved; S5 criterion-12 matcher-scope supersession for the class path; R7 deferral; Q-B outcome |
| D2 | `docs/backlog.md` #93 entry gets a RESOLVED note; section 13 items added |

### Requirement trace (R1-R13), from the table above

| R | Covered by |
|---|---|
| R1 | H3, H5, H6, G4, M1, M2 |
| R2 | DEFERRED by the Q3 ruling (no entry added); S2 proves nothing wired and the QA checks stay green; AP-1..AP-8 list what activation needs |
| R3 | G3, G7, M3 |
| R4 | P1, P2, P3, P4, P6 |
| R5 | section 8 decision; P2 (names the non-central source); G7; existing conformance Part F ground truth (shipped deny + project allow = allow/project) stays green, no `precedence.ts` diff |
| R6 | S4 (baseline evidence already in hand) |
| R7 | DEFERRED (section 8b); D2 backlog line |
| R8 | no `defaultOutcomeMandatory` key: `schema.ts` and `precedence.ts` show zero diff; existing schema tests green (S1) |
| R9 | C1-C12, S-5 evidence, D1 |
| R10 | N7, N1 (`isActionRecord`), section 4 |
| R11 | G9, section 9 |
| R12 | L1, L2, L3, S-4 |
| R13 | H10; hook header keeps its no-durable-trail disclosure |

## 8. Decisions requested

### 8a. #288 (2) peer-override re-decision (R5). Recommendation: KEEP peer semantics; do not touch `precedence.ts`.

| Case | Decision | Why |
|---|---|---|
| Project may relax a shipped-defaults `deny` when central is absent or declares no posture | KEEP (allowed; disclosed at print) | Both layers are in-repo, session-writable files; an agent that can edit `.thoth/policy.json` can edit `shipped-defaults.json`. Forbidding project-over-shipped adds no protection and would need a new trust axis in a sensitive file. The authority is central only |
| A lower-trust layer may tighten to deny | KEEP (availability lever, fail-closed direction) | Already ratified 2026-09-24 D2 |
| Central-declared posture relaxed by a lower layer | still impossible (trust rank) | red-team: 243 combinations, zero relax violations |
| What changes instead | The posture and its source are printed (R4), and a non-central source is labelled "in-repo layer, not centrally enforced" | Honest disclosure replaces a control that would be cosmetic |

- The real protection of the policy files under a live gate is a deny rule on them (Edit/Write deny by class posture, path rules later); that is filesystem-normalizer work (section 13).
- Alternative rejected: shipped posture firm against project (project may only tighten). Cost: a project cannot loosen the shipped deny without editing the shipped file (same trust), plus a `precedence.ts` change and conformance-test churn, for no security gain.

### 8b. R7 (disclose an ignored relaxing declaration): DEFER to backlog

- Not a small change in already-touched files: it needs `precedence.ts` (trust-rank mechanism, otherwise untouched), `loader.ts`, `printer.ts`, plus test amendments (about 30 lines and one more sensitive file). The ignored relax is fail-closed and visible through `source` on the R4 line. ADR-0006 forbids opportunistic widening.

### 8c. #107 resolution (R9): REPLACE the text match with the two-step locale-independent existence check

- Evidence for it (S-5): a captured non-English sample is impossible on this host (no de-DE `reg.exe.mui`); the exit-code alternative has no discriminating power (measured 2026-09-08, re-confirmed: exit 1 for absent, missing parent, access denied alike); the enumeration mechanism reads no localized text, absent path is still 1 spawn (p50 29.8 ms vs 24.0 ms), timeout/overflow become throws (closes the C6/C7 class round-2 already noted).
- Derived, not measured: a localized OEM code page read as UTF-8 would garble a captured sample anyway, which favors dropping text matching.
- Fail-closed by construction: only "parent listed OK and key not in it" (or key listed and value not in it) resolves `absent`; every other outcome throws into the read-error bucket.
- Cost: removes `isNotFoundError` and `NOT_FOUND_PATTERNS` and their tests, replaced by C1-C12. See Q-D.

## 9. R11: fail-open paths of the live wiring, each an enumerated decision (G9 generates the list; this table is the recorded decision)

| SUR-10 path | Decision for this hook | Test |
|---|---|---|
| missing configuration | project policy, shipped-defaults, or fixture unreadable: `LoadFailure` or throw: deny (never fall back to the bootstrap policy). Central absent contributes nothing (AC5a, unchanged): posture comes from lower layers and is printed | G1, G2, C1 |
| unknown tool | unclassified or unparseable name: opaque plus unresolved: POL-05 deny | N3, H4 |
| internal exception | exit 2 with stderr (unchanged) | existing AC-6 tests |
| malformed input | bad JSON, empty stdin: exit 2. Missing or non-string `tool_name`, or a Bash command that is not a string: deny | H8, G8 |
| unrecognised syntax | shell normalizer unresolved: POL-05 deny (S4, unchanged) | existing AC-1 |
| depth cap | S4 behavior, unchanged | existing shell tests |
| lock timeout | not applicable: no lock exists in this hook or the loader (the audit-log lock is S8) | G9 records the N/A |
| hook timeout | runtime property: a timed-out hook does NOT block. Declared timeout stays 60 (set at activation); measured p99 254.5 ms, `reg.exe` worst case 5 s | L1, L2 |
| non-blocking hook surface | runtime property, disclosed, not testable | G9 records it |
| (gate-specific) posture `bootstrap` allow | when no layer declares a posture; disclosed by the R4 line | P1, P2 |
| (gate-specific) sanitizer mismatch | an unobserved special character mismatches: tool reads unclassified: deny (availability, not bypass) | N4 |

## 10. Stale comments to correct (list generated by a grep instrument, not by hand; rerun in S3)

Instrument: `grep -rn -E "presence-only|inert today|class.{0,40}inert|inert.{0,40}class|does not itself (gate|drive)|no consumer read|tracked at docs/backlog.md as|Issue #93|still reads (its|via) (own|its)|own, separate loadBootstrapRuleSet|hook still reads|nothing consumes it until|not itself gate anything" src hooks docs/qa .claude docs/backlog.md docs/adr` (non-test files), which returned:

| File:line | Fix |
|---|---|
| `src/policy/tools/central-classification.ts:9-13` | class is consumed by the gate (unwired); replace "inert" text |
| `docs/qa/s5-central-classification.json:6` (`notes[2]`) | same; edit `notes` only, no entry (THOTH-ADR-0001) |
| `src/policy/tools/builtin-tool-inventory.ts:29-30` | class now drives the gate's mutating-vs-read decision; remove "future story's job" |
| `src/policy/config/loader.ts:113-114` | `ResolvedPosture` doc: hook consumes it (unwired) |
| `src/policy/config/printer.ts:31` (`ENFORCEMENT_DISCLOSURE`) | text must stay TRUE: hook consumes the loader but is not wired, so nothing is enforced live; P5 ties it to `.claude/settings.json` |
| `docs/backlog.md:24` | #93 entry gets a RESOLVED note (D2) |
| `docs/adr/thoth-0001-...md:71` (row "Inert classification") | ACCEPTED ADR: agents cannot edit it. Proposal via `/maat:adr-amend` (Q-C) |
| `.claude/settings.json` comment item 6 ("that is S6's job", matcher scope "Bash ONLY", "pending T5" residual) | comment-only rewrite; no `hooks` change (S2) |
| `hooks/pretooluse-kernel-gate.mjs` header (matcher scope, criterion 12, bootstrap reads) | rewritten with the hook |
| `src/policy/config/bootstrap-ruleset.ts` header | hook is no longer a consumer of `loadBootstrapRuleSet` (still used by the loader for the fallback outcome) |

Also noted, not edited by an agent: `CLAUDE.md` "Sensitive areas" still names the deleted `hooks/report-subject-gate.mjs` (human-owned).

## 11. Test-first dispatch check (step 7): YES, dispatch `test-writer` BEFORE Phase 2

- Externally observable surfaces that change: (1) the hook's stdin/stdout contract (non-Bash tools no longer blanket-denied, LoadFailure now denies, MCP names, allow-emission per Q-B); (2) the printer surface (`PrinterResult.posture`, `postureLine`) and the CLI line.
- **Locked tests that need a `test-writer` amendment:**
  - `hooks/pretooluse-kernel-gate.test.ts`: file header and the AC-19 section comments ("any value other than Bash denies" is no longer true, `Read` is allowed); AC-2 header note (depends on "bootstrap allow", now loader posture) and, if Q-B rules "defer", the AC-2 assertion `notEqual(decision, undefined)`. The AC-19 `Edit` and "missing tool_name" tests stay valid as written. AC-1 and AC-6 unchanged.
  - `src/policy/config/printer.test.ts`: additive tests P1-P5 only; no existing assertion changes (P4).
- Not test-writer (internal, IMPL's own, first as failing tests): N, G, C suites; C amends implementer-owned `central-source.test.ts`.
- Sequencing: (0) rulings Q-A, Q-B; (1) `design-challenger` + `architecture-reviewer` on this plan; (2) `test-writer` dispatch H, P, P6; RED-CONFIRMED; (3) IMPL writes N, G, C failing first; (4) build; (5) mutation drills M1-M4; (6) comment/docs corrections; (7) review chain; (8) verify. Activation is a separate story.

## 12. Blocking questions (ranked by build impact; A and B must be ruled before `test-writer` runs)

1. **Q-A. `shipped-defaults.json` content.** Q1's "mutating deny unless a rule allows" needs a deny posture in data, because the kernel is deny-wins and has one default. Recommend **X**: ship `defaultOutcome: "deny"`, rule `sur03-read-only-class-allow` (targets `tool/read-only/`), rule `sur03-non-mutating-verbs-allow` (verbs read, list, describe, get). It keeps locked AC-2 (`kubectl get`) green and makes R1 real against shipped data. Alternative **Y**: ship nothing, prove semantics only with fixture policies; then a wired hook would run at bootstrap `allow` posture and class would not deny anything. X changes shipped policy content (this is not the baseline for benign shell or Edit; that stays the activation content, AP-1). Hook unwired, so no live effect either way.
2. **Q-B. What the hook emits on a kernel `allow`.** S-2 proved `permissionDecision: "allow"` skips the user's prompt. Recommend **defer**: emit nothing on allow (normal permission flow decides) and emit only `deny`. Alternative: keep emitting `allow` (the gate becomes an auto-approver for everything a rule allows). Defer needs the AC-2 amendment above; outcomes stay allow/deny at the kernel (Q5 unchanged).
3. **Q-C (human; does not block build, blocks activation). THOTH-ADR-0001.** Its "the merged PR diff is the approval, no dated report for entry-only PRs" ruling and its "Inert classification" residual were made while class drove nothing. Once class grants allow, a one-line fixture edit (`class: "read-only"`) widens an allow by PR diff alone. Does the ruling stand? The stale row needs a `/maat:adr-amend` proposal; agents cannot edit an accepted ADR. Default in this plan: ruling stands unchanged until activation, gap disclosed.
4. **Q-D. ADR-0010 reading for R9.** Replacing the text match removes `isNotFoundError`, `NOT_FOUND_PATTERNS` and their tests (replaced by C1-C12; no coverage lowered). If "MUST NOT delete tests" is read strictly, fall back to additive: keep the English fast path and add the enumeration only for exit 1 with non-matching text (two mechanisms). Recommend replace; needs a Manager ack.

## 13. Proposed backlog (out of scope, not in the diff)

- Refresh `docs/qa/tool-inventory.json` (23 runtime built-ins missing) and classify them; make the drift check bidirectional against a runtime probe.
- Filesystem normalizer so Edit/Write can be allowed by path; deny rule protecting `.thoth/policy.json`, `shipped-defaults.json` and the fixture.
- Baseline allow content for shell and built-ins; classification decision for the 8 exempt connectors' tools (no class today).
- `gate-matcher-drift-check` awareness of `mcp__` matchers (it splits on `|` and compares to the vendored built-ins).
- Dedupe `resolveFixtureLocation` between the two hooks.
- Delete `loadBootstrapRuleSet` once unused (test-deletion ruling needed).
- Per-call `reg.exe` timeout shorter than 5000 ms for the hook; extend the latency corpus to non-Bash calls and add a Windows job.
- R7 ignored-relaxation disclosure. Tool-level (not server-level) MCP classification. Verify sanitization for characters beyond space and dot.
- `/maat:adr-amend` proposal for THOTH-ADR-0001's stale residual row. `CLAUDE.md` sensitive-areas drift (human).

## 14. Activation preconditions (a later, separate step; each with evidence above)

| # | Precondition | Evidence |
|---|---|---|
| AP-1 | baseline allow content (shell, built-ins, path rules) | Edit/Write deny under posture X until a rule allows |
| AP-2 | refresh the vendored inventory, classify 23 runtime built-ins including `ToolSearch` | S-3; deny run blocked `ToolSearch` |
| AP-3 | ruling on the 8 `knownConnectors` (unclassified, so denied at the gate) | fixture `knownConnectors`; connectors have no class |
| AP-4 | matcher choice and regex semantics (`Bash\|mcp__.*` plus built-ins), matcher-drift check update | S-1 (matcher untested); code-traced `gate-matcher-drift-check.ts` |
| AP-5 | add the entry with `timeout` 60; rerun the 4 qa checks; measure on the real runtime | R2 deferred |
| AP-6 | decisions row superseding S5 criterion 12 (matcher scope Bash only) | hook header |
| AP-7 | Q-C ruling and ADR amendment | THOTH-ADR-0001 |
| AP-8 | SessionStart and gate agree on one inventory | S-3 |

## 15. File-level change list

| File | Change | Owner |
|---|---|---|
| `src/policy/normalizer/tool-class.ts` (new) | normalizer registered by declaration | IMPL |
| `src/policy/normalizer/tool-class.test.ts` (new) | N1-N8 | IMPL |
| `src/policy/gate/decide-tool-call.ts` (new dir, 1 file) | DI gate composition; `TOOL_TYPE_BY_TOOL_NAME`; `GATE_FAIL_OPEN_DECISIONS` | IMPL |
| `src/policy/gate/decide-tool-call.test.ts` (new) | G1-G9 | IMPL |
| `hooks/pretooluse-kernel-gate.mjs` | thin shell over the gate module; header rewritten | IMPL |
| `hooks/pretooluse-kernel-gate-classification.test.ts` (new), `hooks/pretooluse-kernel-gate.test.ts` (amend) | H1-H10; header/AC-19/AC-2 amendments | TW |
| `src/policy/config/shipped-defaults.json` | content per Q-A (X) | IMPL |
| `src/policy/config/printer.ts`, `print-cli.ts` | `posture`, `postureLine`, disclosure text, CLI line | IMPL |
| `src/policy/config/printer.test.ts` (amend), `print-cli.test.ts` (new) | P1-P6 | TW |
| `src/policy/config/central-source.ts`, `central-source.test.ts` | R9 two-step check; C1-C12 | IMPL |
| `src/policy/config/loader.ts`, `bootstrap-ruleset.ts` | comments only | IMPL |
| `src/policy/tools/central-classification.ts`, `builtin-tool-inventory.ts`, `docs/qa/s5-central-classification.json` (`notes`) | comments/notes only | IMPL |
| `.claude/settings.json` | comment lines only, no `hooks` change | IMPL |
| `docs/decisions.md`, `docs/backlog.md`, `CHANGELOG.md`, `docs/STATE.md` | D1, D2 | IMPL drafts, Manager ratifies |
| NOT touched | `src/policy/kernel/**`, `registry.ts`, `shell.ts`, `structured-cluster.ts`, `precedence.ts`, `schema.ts`, `pin.ts`, `hooks/sessionstart-tool-enum.mjs`, halt-relay, `.github/**`, `docs/qa/tool-inventory.json` | - |

Estimated production diff about 250-300 lines. Rollout: no deploy; the unwired hook is the flag (ADR-0006). Rollback: `git revert`; nothing in a session changes.

## 16. design-challenger and architecture-reviewer: YES to both, in parallel, before `test-writer`

- Novel shape (rule 15): first normalizer that carries a semantic class in `targets`, first live consumer of the loader, first per-call registry read. `architecture-reviewer` question: is class-in-targets plus a deny posture the right home, versus a non-kernel-branching field (not possible: the kernel must match on it), and is the `src/policy/gate/` module and `TOOL_TYPE_BY_TOOL_NAME` table a dispatch chain in disguise.
- `design-challenger` attack list: (1) posture X and the read-verb allow rule; (2) auto-approve on allow (Q-B); (3) 5 s `reg.exe` timeout against OPS-03; (4) fixture as an enforcement source under THOTH-ADR-0001; (5) sanitizer collision and unobserved characters; (6) the two-step registry check when `Policies` is absent; (7) fixture path via `CLAUDE_PROJECT_DIR` on an enforcement hook (ADR permits; is it wise); (8) project-over-shipped relax (8a).

## 17. Next single action

Manager: rule Q-A and Q-B (defaults X and defer stand if silent), ack Q-D, then dispatch `design-challenger` and `architecture-reviewer` on this plan; `test-writer` follows.

RECEIPT: verdict=BLOCKED(plan-ready; Q-A and Q-B need rulings before test-writer) criteria="58/58 (counted by grep over section 7 rows; R1-R13 all traced)" checks="0/0/0 (plan only; 6 spikes run, evidence in section 3)" adr=HIT(37) pr=n/a
