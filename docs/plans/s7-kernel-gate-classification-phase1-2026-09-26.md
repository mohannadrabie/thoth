# Phase 1 plan (revision 3): s7-kernel-gate-classification (Issue #93, #288 preconditions, #107)

[story-implementer]
Story Implementer (Ptah) - Phase 1: planning (revision 3, small revision, plan file only)

Branch `feat/s7-kernel-gate-classification` @ `982acdf` (revision 2 is `81028f5`). Inputs: intake record and its "Manager rulings after the Phase 1 plan" table; round-1 reports (`docs/reviews/s7-kernel-gate-classification-architecture-2026-09-26.md`, `docs/reviews/s7-kernel-gate-classification-design-challenger-2026-09-26.md`); round-2 reports (`docs/reviews/s7-kernel-gate-classification-architecture-reconfirm-2026-09-26.md`, APPROVE-WITH-CONDITIONS, PC-8..PC-14, N1..N7; `docs/reviews/s7-kernel-gate-classification-design-challenger-round2-2026-09-26.md`, go, PT-12..PT-16, Issues #306 and #307); Manager rulings R-A..R-J and the Q-E ack (unchanged). Class: STORY. Hook stays UNWIRED: no `PreToolUse` entry, no `hooks` key change in `.claude/settings.json`.

`📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog - ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`

## Changes since revision 2 (Manager fold-in list to sections)

| # | Item | What changed | Sections |
|---|---|---|---|
| 1 | PC-8, N1, #307 mutation predictions | added N9b (class-only allow, marker verb, no targets; PT-14a) and H11b; added N3b (lookup exactness; PT-14b) and re-expressed G16 (Bash record parsed and resolved for every class; PT-14c); every M red set corrected to the measured sets; X-3 made a Phase 2 gate | 7 (N, G, H, M) |
| 2 | PC-9, N2 | shared function split into a LOCATION function and a CATALOG function; SessionStart keeps resolving location before stdin; G14 rewritten, G14b added; the 27 SessionStart tests stay unmodified | 4, 6, 7 (G14, G14b), 15 |
| 3 | PC-10, N4, #306, PT-12 | rule-author grammar facts and the four inert deny shapes stated in the grammar header; G13b added; `schema.ts` untouched; PT-12 bound to AP-1 as an ENTRY test with PT-1 and PT-2; #306 stays open | 4, 7 (G13b), 14 (AP-1), 13 |
| 4 | PT-13 (ruling) | fixture server names admitted only if solely `[A-Za-z0-9-]`; price restated (13 AWS names, 2 of 6 servers); SessionStart coupling stated; N4 rewritten, N4b added; X-2 on the unrun list | 3 (S-6), 4, 7 (N4, N4b), 18 |
| 5 | PC-11, N5 | fixture entry names derived from the fixture in tests; G19 added; Q-C gains question (e) | 7 (H, G13, G19, M2), 12 |
| 6 | PC-12, N6 | CHOICE: the routing row carries the raw-call builder and a catalog flag; G11 updated, G11b added | 4, 7 (G11, G11b) |
| 7 | PC-13, N7 | D2 reworded (capability delivered, enforcement content tracked by AP-1); stale-comment row for `docs/backlog.md:24` reworded | 7 (D2), 10 |
| 8 | PC-14 | U-9 SETTLED cheaply (settings env block did not override `CLAUDE_PROJECT_DIR`); the gate resolves its fixture module-relative anyway (env-immune); H12 added; X-1 and U-9 on the unrun list | 3 (S-9), 4, 7 (H12), 18 |
| 9 | PT-15 | typed, fail-closed hook output: only an exact allow verdict is silent; G20 and H13 added; SUR-10 row | 4, 7 (G20, H13), 9 |
| 10 | R-4, R-6 | recorded as residuals; sandbox pins the registry source to absent (recorded limit) | 12a |
| 11 | recount | script recount after the edits | 7a |

## Changes since the first plan (revision 2, ruling to sections)

| Ruling | What changed | Sections |
|---|---|---|
| R-A (Y, no shipped content) | `shipped-defaults.json` untouched; option X dropped; R1 proved in memory plus a copy-tree hook sandbox; plain statement of what Y means | 4, 7 (H, G), 8, 12, 15 |
| R-B (gate scope Bash + mcp__ only) | all other `tool_name` keep today's fail-closed deny; AC-19 stays green; no ADR-0005 ruling; built-in fixture entries have no effect | 4, 7 (H8, N10, G17), 11 |
| R-C (marker verb, PC-1) | class rides on a marker verb outside `KNOWN_VERBS`; targets carry identity only; one builder/parser module; golden test; forgery red tests | 4, 7 (N, G13), 8 |
| R-D (injective-or-unresolved) | exact sanitized-name match only; ambiguous fixture names rejected; measured effect on the real tool list | 3 (S-6), 4, 7 (N3-N5, H4) |
| R-E (trust model, PC-3) | scalar-only truth stated; print line does not overclaim; P7 documenting test; central-cannot-require-allow question drafted for the queue only | 7 (P2, P7, G7), 8a, 17 |
| R-F (#107 additive, PC-4) | C1, C2 (now C2r), C3, C10, 8c, S-5, Q-D, R9 rewritten; existing central-source tests untouched; header-line evidence measured (Q-E) | 3 (S-5, S-7), 7 (C), 8c, 12 |
| R-G (gate and hook, PC-5) | refusals limited and enumerated; routing table own file (G11); gate-owned ports (G15); one shared fixture/catalog function for both hooks (G14) | 4, 7 (G), 9, 15, 17 |
| R-H (activation) | AP-9..AP-14 added; SUR-10 row for launch failures; G9 enumerates by script | 9, 14 |
| R-I (check quality) | strict deny helper, H7 re-expressed, latency instrument asserts exit status, M3 red set corrected, P5 exact-equality, M5 added, counts by script | 7, 7a |
| R-J (other) | no cache stays; supersedes `docs/backlog.md` line 61 (proposed record); Q-C extended; R7 deferred | 8, 8d, 12 |

## 0. Readiness

| Item | Result | Evidence |
|---|---|---|
| Route (a): seven fields carry class | YES, no ADR change | Section 4; kernel matches only `verbs` and `targets` data (`src/policy/kernel/kernel.ts:115-127`) |
| R-B feasible (gate evaluates only Bash and mcp__ names, all else denied as today) | YES, no blocking finding | Section 4; the shipped hook already denies every non-Bash `tool_name` (`hooks/pretooluse-kernel-gate.mjs:92`); locked AC-19 asserts exactly that |
| R-F feasible as worded | ALMOST: one detail is not implementable, adapted with equivalent evidence | S-7: `reg query` prints the queried key's own header line only when the key has values; `HKLM\SOFTWARE\Policies` here has none. Adaptation in 8c, ack in Q-E |
| Missing material fact | none | - |
| Baseline | not re-run (no code touched) | master `fff858c` CI run 36219917467: 1139 tests, 1139 pass, 0 fail, 0 skipped, node v22.18.0; `central-source.test.ts` 16 of 16 pass at 2e24a06 (architecture report evidence) |

## 1. ADR review (hard gate)

| ADR | Verdict | Rule quoted / reason |
|---|---|---|
| SE ADR-0021 | APPLICABLE | "**MUST** normalize every governed tool call into a canonical Action record carrying at minimum the seven §3.1 fields ... **MUST NOT** add a field outside these seven that the kernel branches on." / "**MUST** register each per-tool-type normalizer ... by declaration; **MUST NOT** add a tool type by editing a shared dispatch chain or the kernel (POL-12)." / "**MUST NOT** let a normalizer return a verdict, or let the kernel inspect a tool's identity or shape directly." / "**MUST NOT** implement a second decision path anywhere" / "**MUST** deny a mutating action whose Action record has `source: opaque` or a non-empty `unresolved` field". Marker verbs and identity targets are still `verbs` and `targets`; no eighth field |
| SE ADR-0021, three open readings (architect queue, section 17) | AMBIGUOUS / NOT-COVERED | (1) whether pre-kernel refusals are a "second decision path" (F7); (2) how a runtime `tool_name` reaches a registry `toolType` (F6); (3) a normalizer-owned verb vocabulary beside "verbs from the action catalog" (F1, F2) |
| THOTH-ADR-0001 | APPLICABLE + UNCLEAR (Q-C, human) | "**MUST NOT** hardcode an entry of either list in `hooks/` or `src/`" (conforms: the routing table names `Bash` and the prefix only). UNCLEAR rules: rule 1 (exception "MUST NOT be cited to justify any other allowlist, file, or control"; the fixture becomes an enforcement input) and rule 5 (resolved fixture path recorded in halt-state; the gate is write-free and `.thoth/halt-state/` is a named sensitive area), plus the "PR diff is the approval" ruling and the residual row "Inert classification". Interim: the gate reads the fixture and records nothing; activation waits for the ruling |
| SE ADR-0002 (layering) | APPLICABLE | "**MUST** define external dependencies as interfaces/ports owned by the inner layer": the gate owns its port result types; the hook adapts `LoadResult` |
| SE ADR-0003 (SOLID/YAGNI) | APPLICABLE | "**MUST** inject I/O-performing dependencies ... via constructor/parameters"; "**SHOULD** prefer adding a new strategy/handler over extending an if/else ... when a third variant appears" (two variants may stay a table; the third normalizer is the named trigger) |
| SE ADR-0005 (testing) | APPLICABLE | "**MUST NOT** delete or weaken a failing test to make CI pass". R-B keeps AC-19 green and R-F keeps every central-source test, so no exception is needed |
| SE ADR-0006 (blast radius) | APPLICABLE | "**MUST** gate new user-facing behavior behind a feature flag defaulting to OFF" (the unwired hook is the flag); "**MUST NOT** widen a change's scope opportunistically" (R7, #303, #304 stay out) |
| SE ADR-0010 (quality gates) | APPLICABLE | "**MUST NOT** ... delete tests"; "**MUST** leave touched code at least as clean as found" (section 10) |
| SE ADR-0001 | APPLICABLE (process) | agents propose ADR amendments only; the stale THOTH-ADR-0001 residual row goes through `/maat:adr-amend` |
| SE ADR-0004, ADR-0007..0009, ADR-0011..0020, THOTH-ADR-0002, devops ADR-0001..0010 | NOT-APPLICABLE | no state, tagging, cost, data, port-fidelity (0017/0018 superseded), secret-scan or IaC surface |

## 2. Restatement

Make a classified MCP tool's class a rule-matchable input to the kernel verdict through a normalizer that carries class on a marker verb no other normalizer can emit; make the gate hook consume the loader's resolved rules and posture; discharge the #288 and #107 go-live preconditions; ship no policy content and leave the hook unwired.

**What Y means (R-A), stated plainly:** class becomes rule data that a central or project rule can match (a rule keyed on a marker verb such as `tool-class:remote-mutating`). **Nothing denies by class from shipped data until AP-1** (baseline allow content, an activation step). With shipped defaults empty and the resolved posture at the bootstrap `allow`, the gate denies only: unclassified, ambiguous or unroutable names; malformed input; a load failure; and whatever S4's shell normalizer and POL-05 already deny for Bash.

## 3. SPIKE results (rules 17, 18). Run 2026-09-26, Claude Code 2.1.267, Node 24.15.0, Windows 11.

Unchanged from revision 1 (evidence stands): S-1 MCP `tool_name` shape, S-2 hook `allow` semantics, S-3 built-in inventory drift, S-4 loader latency. Summaries only; raw tables are in git history at `0a485b3`.

- **S-1 (observed).** `mcp__<server>__<tool>`; space and dot became `_`, hyphen and `_` kept. Server "spike two.x y" arrived as `mcp__spike_two_x_y__echo_tool-x`. Other characters not tried (a mismatch fails closed). Matcher regex `mcp__.*` untested (U-5).
- **S-2 (observed).** Empty stdout with exit 0 leaves the normal permission flow; `permissionDecision:"allow"` skips the prompt and executes the tool; `deny` blocks with the reason surfaced; a settings deny rule wins over a hook allow. Basis of Q-B (emit nothing on allow), which the design-challenger confirmed (C-1: a 4 MB deny reason delivered intact).
- **S-3 (observed, scripted diff).** 34 runtime built-ins vs 19 vendored; 23 unvendored including `ToolSearch`. Under R-B built-ins are not class-routed, but they also are not exempt from AP-2 for the SessionStart halt and for any future matcher.
- **S-4 (measured, N=40, Windows).** Cold hook with loader in the path: p50 184.5 ms, p99 254.5 ms; current hook p50 142.4, p99 178.0; node start p50 72.1. Loader adds about 42 ms p50 and 76 ms p99. No cache. CI (Linux) spawns no registry reader and cannot measure the Windows cost.

New or changed in this revision:

### S-5. #107 additive path (R-F): MEASURED with real `reg.exe` on this English host; the earlier numbers measured the REPLACE design and are withdrawn

Prototype (scratchpad `additive-check.mjs`, not repo code): call 1 is the real `reg query ... /v CentralPolicyJson`; for the non-English row its stderr text is replaced with German text to defeat the English match (a forced simulation, NOT a captured localized sample); call 2 is the real parent listing. N=30 each.

| Path | Result | Spawns | p50 | p95 | p99 | max (ms) |
|---|---|---|---|---|---|---|
| English host, real stderr (fast path, unchanged) | absent | 1 | 19.5 | 27.7 | 28.5 | 28.5 |
| Forced non-English stderr, parent listing recognised, key not listed | absent | 2 | 41.0 | 47.6 | 52.2 | 52.2 |

- Listing classifier run over 8 shapes: real captured shape without Thoth = key-absent; with Thoth = key-listed; `ThothX` only = key-absent; `POLICIES\THOTH` = key-listed; empty stdout, a different-script header, and a garbled non-anchored line = unrecognised (rethrow); a header plus value lines without Thoth = key-absent.
- Worst case: two sequential 5 s timeouts, 10 s, still far under the 60 s ceiling; recorded in the hook-timeout row (section 9).
- NOT demonstrated: a real non-English host (no localized `reg.exe.mui` exists here). U-1.

### S-6. R-D consequences on the real runtime tool list: MEASURED (init `tools` of a real session, 333 names, 299 `mcp__`)

- Rule: server segment = text up to the first `__`; resolvable only if the tool segment is non-empty, does not start with `_`, and contains no `__`. The server segment must match an index entry exactly; index entries consist solely of `[A-Za-z0-9-]` (PT-13 ruling, section 4).
- Result in MY session (aws-mcp-server was "pending", so its tools were absent): **294 of 299 resolvable; 5 unresolved (deny)**, all `mcp__aws-knowledge-mcp-server__aws___*` (tool names contain `___`). The 6 committed fixture entries all consist solely of `[A-Za-z0-9-]`, so all 6 are admitted.
- **Corrected price (design-challenger round 2, counted from a session where the server was connected): 13 AWS tool names are unresolved (8 `mcp__aws-mcp-server__aws___*` plus the 5 aws-knowledge names), i.e. 100% of the tools of 2 of the 6 committed servers.** The figure depends on which servers are connected, not on the design; the accurate statement is "every tool of a server whose tool names contain a double underscore". Availability cost, not a bypass. My own count of 5 understated it because the second server was not connected in my session.
- The alternative (accept a split at the first or last `__`) lets an unlisted server `docs__evil` inherit a read-only entry `docs`; injective-or-unresolved is kept.
- Not measured: which characters the runtime sanitizes beyond space and dot (X-2). Any unobserved character mismatches toward deny.

### S-7. Does `reg query` print the queried key's own header line? MEASURED: only when the key has values

- `reg query HKLM\SOFTWARE\Policies` (no values): output is one blank line then `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\<subkey>` lines, NO header line. `Policies\HP`, `Policies\Microsoft`: same. `Windows NT\CurrentVersion` (has values): blank line, header line, then indented value lines.
- Consequence: R-F's "output contains the parent key's own header line" cannot hold for the real target. Adapted evidence in 8c (Q-E).

### S-8. Copy-tree hook sandbox: FEASIBLE (measured)

- Copying `hooks/pretooluse-kernel-gate.mjs`, `src`, `package.json`, `docs/qa/tool-inventory.json`, `docs/qa/s5-central-classification.json` and `.thoth/policy.json` (1.7 MB) to a temp dir and running the copy: exit 0, 216 ms. Module-relative policy and fixture paths then resolve inside the copy, so a test can author project policy and a fixture without touching tracked files. Used by every H check and the G9 probe. The design-challenger round 2 confirmed fidelity (the copy is made at test time, so it cannot drift from the real tree) and that the strict helper rejects crash-as-deny.
- **Registry pinning (R-6).** The hook takes no central-source seam, so a spawned hook reads the real registry. The sandbox helper therefore overwrites the COPY's `src/policy/config/central-source.ts` default export with a fixed "absent" source, so H verdicts cannot flip on a Windows host with central policy deployed. Recorded fidelity limit: the real reader is exercised only by the C suite, C11, P6 and the locked hook tests (which still spawn the real reader; residual R-6 in 12a).

### S-9. Can an env block in the local settings override file override `CLAUDE_PROJECT_DIR` for a hook process? SETTLED cheaply (U-9): NO on this runtime

- Real `claude -p` session (2.1.267, Windows, haiku), the local settings override file with `env.CLAUDE_PROJECT_DIR` set to a nonexistent directory, a PreToolUse hook logging `process.env.CLAUDE_PROJECT_DIR` and `cwd`: the hook saw the real scratch project directory for both. Limits: one runtime version, print mode, only the local settings override file tried (not user or managed settings).
- Effect on the design: the gate does not use `CLAUDE_PROJECT_DIR` at all (section 4, item 8); the evidence only supports leaving SessionStart's existing seam alone.

## 4. Design (one page; rule 17)

**Encoding (R-C, PC-1).** New normalizer `toolType: "tool-class"` registered by declaration. Class rides on a MARKER VERB owned by the normalizer and absent from `KNOWN_VERBS` (`src/policy/normalizer/action-catalog.ts`); identity rides in `targets`.

| Case | `source` | `verbs` | `targets` | `unresolved` |
|---|---|---|---|---|
| classified MCP tool | structured | one marker: `tool-class:read-only`, `tool-class:workspace-mutating` or `tool-class:remote-mutating` | one target: mcp, server, tool joined by slashes | [] |
| not `mcp__`, not in index, ambiguous, slash in a name, non-string input | opaque | [] | [] | one entry naming the cause |

- Why it is safe: the shell normalizer emits verbs only from `KNOWN_VERBS` plus the constant `write` (`shell.ts:356,393-396`); a shell verb token equal to a marker fails `resolveVerb` and becomes unresolved. A shell redirect can forge an identity TARGET string, so **rule authors MUST pair an allow rule's identity target with the marker verb; a deny rule may be target-only (a forged match only denies)**. N9 and N9b pin the facts; the class-wide allow (marker, no targets) is the shape activation content will ship and is what N9b and H11b protect.
- Class is out of the identity path: a rule keyed on server identity survives reclassification (F2). A class rule is a verb rule on the marker.
- No legacy verb (read, write, execute) is emitted, so the kernel's `isMutating` is false for a classified record and POL-05 applies only to unresolved records. Unclassified = opaque plus unresolved = POL-05 deny, unconditionally.
- One builder and parser module `src/policy/normalizer/tool-class-format.ts` (mirrors `target-format.ts`): marker table `Record<ToolClass, string>` (a fourth class is a compile error), `sanitizeMcpName`, `parseMcpToolName`, `buildMcpTarget`, `buildServerIndex` (returns the index and a `rejected` list with a reason per entry), a `GRAMMAR_VERSION` constant, and the rule-author grammar in its header. Golden test G13 pins output for a fixed call list, so a grammar change is a visible test diff.
- **Rule-author grammar facts (PC-10, N4, #306), stated in the module header and pinned by G13b.** `schema.ts` is NOT touched (forbidden file), so none of these is checked at load:
  1. Class records carry NO legacy verb. A central deny keyed on write, create, modify, delete, move, rename or execute never sees a tool-class record.
  2. A marker-paired deny follows the fixture (flip the class and the deny stops matching); an identity-keyed deny (server target, no marker) survives the flip. "This server is always denied" is written as an identity-keyed deny; "this class is denied" as a marker rule.
  3. The rule schema accepts any string in `verbs` and `targets` (`schema.ts:189`), so a typo loads clean and never matches.
  4. `GRAMMAR_VERSION` is a constant in-repo; out-of-repo central authors cannot see it and a rule carries no version. Markers are append-only (never renamed). A bump needs a decisions row plus a central-rule migration note.
  5. The four natural-but-inert deny shapes (design-challenger round 2, attack 1, Issue #306; each loads with 0 schema errors and never matches, demonstrated against the real validator and kernel): (a) a misspelled marker verb; (b) a server target without the trailing slash (exact match instead of prefix match); (c) the legacy mutating verbs plus the mcp target prefix; (d) the declared server name instead of the sanitized runtime name.
  Nothing ships rules in this story, so this is an activation blocker (AP-1 entry test PT-12), not a build blocker.
- **Name mapping (R-D, PT-13 ruling): injective-or-unresolved, and only `[A-Za-z0-9-]` names are admitted.** `parseMcpToolName` splits at the FIRST `__` after `mcp__`. `buildServerIndex` takes only catalog entries with `sourceLayer === "central"` (never the built-in layer) and admits an entry ONLY if its name is non-empty and consists solely of `[A-Za-z0-9-]`: no underscore, space, dot, colon or any other character the runtime sanitizes. Every other entry is rejected, its tools read as unclassified (deny), and it appears in the `rejected` list (reported by N4, N4b; the real committed fixture must have an empty `rejected` list, derived, not typed). Lookup is exact match of the server segment against the index: no prefix, no longest match. Consequence: a canonical underscore name such as `claude_ai_Gmail` can never be inherited by an unlisted server whose declared name sanitizes to it (space, dot, colon variants).
- **SessionStart coupling, stated.** SessionStart compares the RAW declared name against the catalog; the gate can admit only the sanitized form. Under the charset rule they stay consistent in the safe direction only: a server whose declared name is solely `[A-Za-z0-9-]` is classified by both surfaces; any other declared name passes SessionStart (the raw entry suppresses the halt) but its tools are denied at the gate (an availability cost, never a bypass), and a sanitized-form entry would be rejected too. Nothing is classified at the gate that SessionStart would halt on.
- Built-ins: `tool-class` accepts only `mcp__` names; any other name is unresolved. A fixture entry named `Write` can only ever classify an MCP server literally named `Write`.

**Gate scope (R-B).** The gate evaluates ONLY `tool_name == "Bash"` (shell normalizer) and names starting `mcp__` (tool-class normalizer). EVERY other `tool_name` keeps today's fail-closed refusal (unchanged behavior, locked AC-19). No built-in is routed through classification in this story.

**Gate module (R-G, PC-5).** New directory `src/policy/gate/`, pure, no `node:*` value import (G15), ports owned by the gate:
- `tool-routing.ts`: the routing rows (Bash exact to shell, `mcp__` prefix to tool-class). **CHOICE (PC-12): each row carries the raw-call builder and a `needsCatalog` flag**, so `decide-tool-call.ts` holds no per-toolType conditional. The builders are pure and hold no policy logic (the Bash `tool_input.command` type check is a malformed-input refusal, section 9). The only file allowed to hold the literals `Bash`, `mcp__`, `shell` and `tool-class` (G11, G11b). Evolution: at the third normalizer (a filesystem one) move to registration-time declaration and delete the table; two shared lines (row, side-effect import) are the accepted cost until then.
- `decide-tool-call.ts`: validate input; route (row lookup); build the raw call via the row's builder; call `loadPolicy()` port; normalize; call `loadCatalog()` port only when the row says `needsCatalog`; `decide({rules, defaultOutcome: posture}, action)`. Returns a CLOSED result union: a kernel verdict (`allow` or `deny`, from `VerdictOutcome`) or a refusal with a non-empty reason.
- `render-hook-output.ts` (PT-15): a pure, typed function from the closed result union to `{exitCode, stdout, stderr}`. Silence (exit 0, empty stdout) ONLY for an exact allow verdict; a deny verdict and a refusal render the deny JSON; ANY other shape (outcome `ask`, undefined, null, an unknown kind, a refusal without a reason) renders exit 2 with stderr and no silence. The hook writes what it returns. This removes the polarity risk that under Q-B every non-deny result is a silent allow (residual R-5).
- **Pre-kernel refusals (F7 reading, flagged for an architect ruling, no policy logic in any of them):** malformed input (non-string `tool_name`, non-string Bash command); unroutable `tool_name` (today's behavior, retained by R-B); load failure (deny, layer and kind only, never the raw message: #124/#294 bound). Each is an enumerated SUR-10 row (section 9). The alternative (route a load failure through `decide` with a deny posture so the verdict shape has one author) is NOT adopted per R-G; its cost is a few lines and one test.
- **Shared module `src/policy/tools/classification-catalog.ts` with TWO separate exports (PC-9, N2):** (1) a LOCATION function `resolveFixtureLocation(projectDir, exists)`, pure and non-throwing (project-relative when the file exists, else `DEFAULT_FIXTURE_PATH`), plus an exported `projectDir()` derivation; (2) a CATALOG function `assembleCatalog(location)` that loads the fixture and merges the layers, and may throw. `hooks/sessionstart-tool-enum.mjs` keeps resolving the location BEFORE it reads stdin, so its catch path can still record `fixturePath` in halt-state when the catalog load throws (THOTH-ADR-0001 rule 5, "never silent"); its change is a swap of the inline body of `resolveFixtureLocation` and the merge lines for calls into this module; halt-state code untouched; its 27 existing tests must pass unmodified (G14, G14b).
- **The gate does NOT use the project-dir seam (PC-14, N3).** It resolves its fixture module-relative (`DEFAULT_FIXTURE_PATH`, the ADR-permitted fallback), env-immune like the loader, so no session-reachable environment signal decides which policy source a fail-closed gate trusts (Issue #99 principle). In the real repo this is the same file SessionStart reads. S-9 settled that a settings env block did not override `CLAUDE_PROJECT_DIR` on this runtime, but the gate does not rely on it.
- Hook `hooks/pretooluse-kernel-gate.mjs`: thin adapter. Reads stdin, builds real ports (loader with module-relative shipped and project paths; catalog via `assembleCatalog(DEFAULT location)`), calls the gate, writes what `renderHookOutput` returns. A kernel allow emits NOTHING (Q-B, unchanged). Exit 2 on any exception (unchanged). No cache (S-4).
- Class is coarse: no `tool_input` inspection on the tool-class path.

## 5. Risk tier: CRITICAL (unchanged, Manager-ratified)

- One line: first live consumer of the loader and of tool class on a `PreToolUse` gate (policy enforcement, guard/policy engine, policy delivery); it fixes go-live semantics even though it ships unwired.
- Review chain: `red-team` + `app-security-reviewer` + standing `cross-domain-reviewer`, each in an isolated worktree; fresh dated reports. Pre-build `architecture-reviewer` (REWORK, addressed here) and `design-challenger` (rounds 1 and 2, both go) and the architect re-confirm (APPROVE-WITH-CONDITIONS) are done, section 16.

## 6. Constraints

- CLAUDE.md hard rules: no terraform or prod; no secrets; unit tests with the feature; **no hand-derived completeness claims** (counts by script, section 7a; SUR-10 rows enumerated by a probe, G9; stale-comment list by grep, S3); no gold-plating (section 13); merge human-only.
- Sensitive areas touched, each needing a fresh dated report:

| Area | Files | Reviewer |
|---|---|---|
| Policy enforcement / session gate | `hooks/pretooluse-kernel-gate.mjs`; `hooks/sessionstart-tool-enum.mjs` (shared-function swap only) | `red-team`, `app-security-reviewer` |
| Guard / policy engine | `src/policy/normalizer/tool-class.ts`, `tool-class-format.ts`, `src/policy/gate/*` | `red-team`, `cross-domain-reviewer` |
| Policy delivery / config surface | `printer.ts`, `print-cli.ts`, `central-source.ts` (R9), `src/policy/tools/classification-catalog.ts`, `central-classification.ts` (comment) | `app-security-reviewer` |
| Halt-state directory | `.thoth/halt-state/`: NOT touched; the SessionStart swap does not alter any read or write of it (existing halt-state tests are the check) | `cross-domain-reviewer` verifies the diff |
| Fixture (THOTH-ADR-0001) | `docs/qa/s5-central-classification.json` `notes` text only, no entry change | covered by this PR |
| Gate manifest | `.claude/settings.json` comment lines only; no `hooks` key change | `cross-domain-reviewer` |
| QA instrument | `src/qa/gate-latency-budget-check.ts` (asserts child exit status, R-I) | `cross-domain-reviewer` |

- NOT touched (S5): `src/policy/kernel/**`, `registry.ts`, `shell.ts`, `structured-cluster.ts`, `shell-scanner.ts`, `action-catalog.ts`, `precedence.ts`, `schema.ts`, `pin.ts`, `shipped-defaults.json`, halt-relay, `.github/**`, `docs/qa/tool-inventory.json`, the settings `hooks` keys.
- QA gates over prose: no backticked slash shorthand for illustrative strings; run the qa gates locally (QA-14, QA-15). Never edit a `test-writer` file.

## 7. Acceptance criteria as named test cases (`TW` test-writer authors; `IMPL` implementer's own, written failing first; `CMD` command evidence)

**Authorship, stated for the `test-writer` that runs next:**

| Group | Author | Notes |
|---|---|---|
| H1-H13 (incl. H11b), P1-P7, and the AC-2 amendment plus the hook-header comment edit | `test-writer` (TW) | H1-H13 in a new file with a sandbox helper; P1-P5 and P7 additive in `printer.test.ts`; P6 in a new `print-cli.test.ts` |
| N (incl. N3b, N4b, N9b), G (incl. G11b, G13b, G14b, G19, G20), C, L4, the M drills, D | implementer (IMPL), written failing first | `central-source.test.ts` and `gate-latency-budget-check.test.ts` are implementer-owned and amended additively |
| S1-S5, L1-L3, N12, C10, C11 | command evidence (CMD), implementer runs | real counts recorded |

**Test-name rule (PC-11, N5):** no test in this story types a literal entry name from `docs/qa/s5-central-classification.json`. Tests obtain committed entry names at run time from the fixture (the first entry, or the `rejected` list) or use stand-ins (`docs`, `my server`) that are not committed entries. G19 scans for violations.

### H: hook black-box (TW). New file `hooks/pretooluse-kernel-gate-classification.test.ts` plus a sandbox helper (S-8). Every H check runs in the copy-tree sandbox with the registry source pinned to absent (R-6 pin). Strict helper `wasPolicyDenied` = exit 0, stdout exactly one JSON object with `permissionDecision: "deny"`, non-empty reason, empty stderr (a crashing exit 2 must NOT pass; PT-8). Fixtures are planted by editing the sandbox copy's own fixture file (the gate is env-immune; no `CLAUDE_PROJECT_DIR` planting).

| ID | Named check |
|---|---|
| H1 | `MCP tool of a classified server (the first committed fixture entry, name read from the fixture) is not denied: exit 0, empty stdout, empty stderr` |
| H2 | `tool_name Edit is denied (strict helper)` (complements locked AC-19, which stays unmodified) |
| H3 | `MCP tool of an unclassified server (mcp__nosuchserver__x) is denied (strict) by the kernel's POL-05 rule (the deny is not the pre-kernel refusal); the reason is the kernel's fixed POL-05 text and does not name the cause` |
| H4 | `sandbox fixture with stand-in entry docs: mcp__docs__x not denied (control); mcp__docs___x and mcp__docs__evil__x denied; stand-in entry "my server": mcp__my_server__x denied (rejected entry); entries "my server" plus my_server: mcp__my_server__x denied; stand-in entry my_server alone: mcp__my_server__x denied (underscore names are not admitted); the first committed entry name plus a tool segment holding a triple underscore is denied by the kernel's POL-05 rule` |
| H5 | `sandbox: project policy defaultOutcome deny: Bash kubectl get pod/x --context=c is denied (strict); defaultOutcome allow: not denied` (R3 wiring at hook level) |
| H6 | `sandbox: corrupt project policy: Bash and MCP calls denied (strict); reason names layer project and kind json-parse-error; reason does not contain the file bytes` |
| H7 | `sandbox: project rule "deny verbs [tool-class:remote-mutating] targets [mcp/<first fixture entry>/]": that server's MCP call denied; the sandbox fixture flips that entry to read-only: not denied` (R1 at hook level, both directions) |
| H8 | `sandbox fixture entries naming Write, Edit, Task, Bash as read-only have no effect: tool_name Write, Edit, Task denied (strict); Bash kubectl delete pods/x --context=c is NOT denied under posture allow, identical to the same call with no such entries` (design-challenger #305 not applicable under R-B) |
| H9 | `tool_name missing or a non-string is denied (strict)` (locked AC-19 "missing" stays) |
| H10 | `Q-B: a kernel allow emits nothing: Bash kubectl get pod/x --context=c gives exit 0, empty stdout, empty stderr` |
| H11 | `sandbox forgery, path-scoped rule: posture deny, project rule "allow verbs [tool-class:read-only] targets [mcp/docs/]", sandbox fixture docs read-only: Bash "echo x > mcp/docs/x" and "kubectl tool-class:read-only pods/x --context=c" are denied (strict); mcp__docs__x not denied` |
| H11b | `sandbox forgery, CLASS-ONLY rule (PT-14a): posture deny, project rule "allow verbs [tool-class:read-only]" with NO targets, sandbox fixture docs read-only: Bash "rm tool-class:read-only a/b --context=c" and "kubectl tool-class:read-only pods/x --context=c" are denied (strict); mcp__docs__x not denied. Red when the marker is added to KNOWN_VERBS (M5)` |
| H12 | `the gate is env-immune: sandbox with CLAUDE_PROJECT_DIR set to a second tree holding a different fixture: the verdict follows the sandbox's own fixture` |
| H13 | `typed fail-closed output (PT-15): the sandbox copy's gate module replaced by one returning each odd shape (outcome ask, undefined, null, unknown kind, refusal without a reason): the hook exits 2 or emits a deny JSON for every shape; silence only for an exact allow verdict` |

### N: normalizer unit (IMPL). `src/policy/normalizer/tool-class.test.ts`

| ID | Named check |
|---|---|
| N1 | `typecheck exhaustiveness: the marker table is Record<ToolClass, string>` (CMD `npm run typecheck`; adding a class fails compile) |
| N2 | `unclassified, non-mcp or absent-from-index: source opaque, unresolved non-empty; composed with decide() and an allow-everything rule set: deny by POL-05` |
| N3 | `exact match only: index holds docs; mcp__docs__x resolves; mcp__docs___x and mcp__docs__evil__x are unresolved` |
| N3b | `lookup exactness (PT-14b; kills M7): index holds stand-ins docs and a hyphenated name; servers docs-evil, docsevil, docs2 and a proper prefix of the hyphenated name are unresolved; a lookup by prefix or longest match would resolve them. Goes red under M7` |
| N4 | `charset admission (PT-13 ruling): only names solely [A-Za-z0-9-] are admitted; entries "my server", my_server, my.server, a:b, docs_, docs__evil, _a, a_, empty are rejected, appear in rejected with a reason, and their tools are unresolved; "my server" plus my_server both unresolved; buildServerIndex over the REAL committed fixture returns an empty rejected list (derived from the file, not typed)` |
| N4b | `unlisted server cannot inherit an entry (PT-13): with a stand-in entry my_server (rejected) and with an admitted stand-in docs-x, runtime names generated by the same sanitizer from the space, dot and colon variants of "my server" are unresolved; a stand-in name mixing capitals and underscores (Some_Name) is rejected and reported` |
| N5 | `ambiguous split: entries foo; mcp__foo__bar__x is unresolved (tool segment contains __)` (F11) |
| N6 | `a slash in the server or tool segment is unresolved` |
| N7 | `malformed raw (non-string toolName, missing catalog, unknown class string) returns opaque and never throws` |
| N8 | `marker set is disjoint from every verb any other registered normalizer can emit, derived from KNOWN_VERBS plus the verbs the shell and cluster normalizers emit over the whole src/policy/fixtures/normalizer-calls.ts corpus, and no marker is in KNOWN_VERBS` |
| N9 | `forgery on the shipped normalizer and kernel, path-scoped rule: under a test rule set (posture deny, allow verbs [tool-class:read-only] targets [mcp/docs/]) these Bash calls are all denied: python evil.py > mcp/docs/x; echo x > mcp/docs/../../.thoth/policy.json; kubectl tool-class:read-only pods/x --context=c; python evil.py > tool-class:read-only. Documenting: a TARGET-ONLY allow rule for mcp/docs/ IS matched by "echo x > mcp/docs/x" (the rule-author constraint in section 4)` (note: this shape stays green when the marker guard is removed; it does NOT kill M5) |
| N9b | `forgery, CLASS-ONLY rule (PT-14a; kills M5): posture deny, allow verbs [tool-class:read-only] with NO targets: Bash "rm tool-class:read-only a/b --context=c" and "kubectl tool-class:read-only pods/x --context=c" are denied; a genuine read-only MCP record is allowed. Red when the marker is added to KNOWN_VERBS` |
| N10 | `built-in names never yield a class record: Write, Edit, Bash, Task, Read, ToolSearch are unresolved even when the catalog lists them` |
| N11 | `determinism: the same call and catalog twice give an identical record and verdict` |
| N12 | STRUCTURAL CMD: `npm run qa:kernel-purity` PASS, `npm run qa:normalizer-registry-purity` PASS |

### G: gate module and shared assembly (IMPL). `src/policy/gate/*.test.ts`, `src/policy/tools/classification-catalog.test.ts`, `src/qa/gate-fail-open-probe.test.ts`

| ID | Named check |
|---|---|
| G1 | `loadPolicy failure table: each of the 3 reason kinds at each of the 3 layers (typed Record over the kind union) denies; reason names layer and kind and does not contain the raw message` |
| G2 | `loadCatalog throws for a tool-class call: the error propagates (the hook exits 2); pinned` |
| G3 | `R3 at module level: same Bash action, injected posture {deny} denies, {allow} allows; the outcome comes from the port, not a constant` |
| G4 | `R1 flip, both directions, in memory: test rule set (posture deny; allow verbs [tool-class:read-only]; deny verbs [tool-class:remote-mutating] targets [mcp/<stand-in server>/]); a stand-in server classified remote-mutating is denied, flipped to read-only it is allowed; per-class allow and deny rows asserted for all 3 classes` |
| G5 | `per-tool allow (marker verb plus exact target) allows one workspace-mutating tool while its sibling stays denied under posture deny` |
| G6 | `an explicit deny rule beats a class allow for a read-only tool (kernel deny-wins)` |
| G7 | `documenting (R-E): central posture deny plus a project allow RULE resolves posture deny/central and verdict allow through the real loader with injected paths; and a project redefinition of a shipped rule id with broader targets wins` |
| G8 | `Bash command missing or a non-string is denied; a non-string tool_name is refused` |
| G9 | `SUR-10 by script: a probe runs the real hook command string under injected faults (node without TS stripping, hook copy without ../src, interpreter not on PATH, empty stdin, invalid JSON, numeric tool_name, unroutable tool_name, corrupt project policy) and classifies each BLOCKS (exit 2, or exit 0 with a deny JSON) or PROCEEDS (anything else); every PROCEEDS must have a recorded row naming its AP; every recorded row must correspond to a probed fault` |
| G10 | `central mandatory deny keyed on a server identity (target only) is still denied after the fixture flips that server to read-only (real merge, real loader with injected paths; server name is a stand-in or read from the fixture)` (F2) |
| G11 | `routing purity: the gate directory has no switch and no string literal Bash or mcp__ outside tool-routing.ts, and the routing table has exactly the 2 rows the plan lists, each carrying a raw-call builder and a needsCatalog flag` |
| G11b | `no per-toolType conditional (PC-12): the gate directory has no string literal shell or tool-class outside tool-routing.ts, so a conditional on the toolType cannot survive G11` |
| G13 | `golden: exact ActionRecords of the tool-class normalizer for a fixed call list (3 classes, each unresolved cause, the first committed fixture entry read from the fixture, runtime-shaped names from S-6 built from that entry name), and GRAMMAR_VERSION` |
| G13b | `rule-shape facts pinned (PC-10, #306; documenting, real schema validator plus kernel): a deny keyed on legacy mutating verbs does not match a class record; an identity-keyed deny survives a fixture flip and a marker-paired deny does not; the four natural-but-inert deny shapes (marker typo; server target without trailing slash; legacy verbs plus the mcp prefix; declared instead of sanitized name) load with 0 schema errors and never match; GRAMMAR_VERSION is exported and asserted` |
| G14 | `shared module, LOCATION function: project-relative when the file exists, else DEFAULT_FIXTURE_PATH; both hook sources import the module and neither contains an inline resolveFixtureLocation body or loadCentralClassificationFixture call (source scan); for the real repo the gate's module-relative path and SessionStart's resolved path are the same file` |
| G14b | `location is separate and non-throwing (PC-9): resolveFixtureLocation returns even when the fixture at that location is malformed, and a SessionStart run against a malformed fixture writes fixturePath and fixtureSource into halt-state (the catch path); the 27 existing SessionStart tests stay green unmodified` |
| G15 | `gate directory has no node:* value import and no import from src/policy/config/ (ports are gate-owned)` |
| G16 | `Bash is routed to the shell normalizer (PT-14c; kills M6): catalog Bash set to each of the 3 classes: the record for kubectl delete pods/x --context=c is parsed and resolved (unresolved empty, verbs [delete]) for every class, and identical across classes, and holds no marker. Re-expressed: the earlier form (identical verdicts, no marker) stayed green under M6` |
| G17 | `unroutable names are refused whatever the catalog holds: Write, Edit, Task, ToolSearch, Skill, PowerShell` |
| G18 | `no write path: neither the hook nor the gate directory imports a filesystem-write API` (R13; source scan, plus the existing no-halt-state-write property) |
| G19 | `no literal fixture entry name in this story's new test files (PC-11): a source scan over the new test files, with the forbidden names derived from docs/qa/s5-central-classification.json at run time` |
| G20 | `renderHookOutput is closed and fail-closed (PT-15): each of allow verdict (silent, exit 0), deny verdict and refusal (deny JSON), and the odd shapes outcome ask, undefined, null, unknown kind, refusal without a reason (exit 2, stderr, never silent)` |

### P: printer and CLI (TW). Additive amendment to `src/policy/config/printer.test.ts`; new `src/policy/config/print-cli.test.ts`

| ID | Named check |
|---|---|
| P1 | `PrinterResult.posture equals {outcome, source} for: shipped deny; central deny with project allow posture (central); none declared ({allow, bootstrap}); undefined on rejection` |
| P2 | `postureLine exact strings, never claiming more than the merge does: central: "posture: deny (source: central; rules from lower-trust layers can still allow)"; shipped-defaults or project: "posture: deny (source: shipped-defaults; in-repo layer, not centrally enforced; rules from other layers can still allow)"; bootstrap: "posture: allow (source: bootstrap; no layer declared a posture)"` |
| P3 | `rejection: postureLine is "posture: unresolved (policy load rejected)"; posture undefined` |
| P4 | `stdout unchanged and does not contain the posture line; every existing test unmodified (git diff shows additions only)` |
| P5 | `disclosure cannot pass both ways: the test derives wired = ".claude/settings.json has a PreToolUse entry for the gate script"; expected = wired ? WIRED_LITERAL : UNWIRED_LITERAL, both literals in the test; disclosure must equal it exactly (no regex)` |
| P6 | `print-cli smoke: spawn node src/policy/config/print-cli.ts; stdout has one line matching ^posture: (allow|deny) \(source: | ^posture: unresolved; exit 0 or 1` |
| P7 | `documenting (R-E): real loader, central posture deny plus a project allow rule: PrinterResult.posture is deny/central while decide() over the same merged rules returns allow; postureLine carries the lower-trust-rules clause` |

### C: central-source reader, #107 additive (IMPL). Amend `src/policy/config/central-source.test.ts` by ADDING tests with a call-indexed scripted runner; every existing test (16, lines 131-167 the answer key) untouched

| ID | Named check |
|---|---|
| C1 | `trigger: exit 1 with stderr the English patterns do not classify (de-DE, ja-JP, gibberish), then a recognised parent listing that lacks the Thoth subkey: absent; exactly 2 runner calls; call 1 args ["query","HKLM\\SOFTWARE\\Policies\\Thoth","/v","CentralPolicyJson"], call 2 args ["query","HKLM\\SOFTWARE\\Policies"]` |
| C2r | `English not-found text with exit 1 still resolves absent in exactly ONE runner call (the existing test's behavior, now with the call count pinned)` |
| C3 | `absent requires positive parse evidence; each of these rethrows the ORIGINAL error object: listing stdout empty; stdout with lines under a different-script path; stdout with no line equal to or under the parent path; a garbled non-anchored line; parent listing exit 0 but unrecognised` |
| C4 | `the listing shows the Thoth subkey (exact, case-insensitive, THOTH): rethrows the original error (key exists, value unreadable)` |
| C5 | `lookalike subkeys ThothX and Thoth2 only: absent (exact match, not substring)` |
| C6 | `trigger limits: status 2, null status (timeout), spawn error, oversize: NO second call, original error rethrown (existing tests stay green)` |
| C7 | `call 2 failure (status not 0, timeout, error): the ORIGINAL error from call 1 is rethrown, not call 2's` |
| C8 | `call shape for BOTH calls: absolute %SystemRoot%\\System32\\reg.exe path, exact args, no shell, stdio ["ignore","pipe","pipe"], timeout 5000, maxBuffer 1 MiB` |
| C9 | `listing classifier golden over the real captured parent-listing bytes (CRLF, no header line, S-7) and a with-values header shape` |
| C10 | CMD `git diff -- src/policy/config/central-source.test.ts` shows no removed line; `node --test src/policy/config/central-source.test.ts` real counts |
| C11 | CMD host smoke: `npm run policy:print` on this English host prints `central-channel status=absent` via the fast path |

### L: latency and instrument (R12, R-I)

| ID | Named check |
|---|---|
| L1 | CMD `npm run qa:gate-latency-budget` on Windows with the loader in the path: PASS, p99 recorded (baseline p99 254.5 ms) |
| L2 | CMD bench (S-4 method) on the built hook for a Bash call and an MCP call, N at least 40: p99 below 2000 ms, numbers recorded |
| L3 | CMD the PR's CI run of `qa:gate-latency-budget` (Linux, no registry spawn): PASS |
| L4 | `latency instrument asserts the child's outcome: a pure assertHookOutcome accepts exit 0 with empty stdout, exit 0 with a parseable deny JSON, exit 2; throws on exit 1, null status (timeout), exit 0 with unparseable stdout; measureLatency fails when it throws` (large-input corpus entries belong to #304's activation story) |

### S: structural and regression

| ID | Named check |
|---|---|
| S1 | CMD `npm run typecheck`, `npm run lint`, `npm run qa:kernel-purity`, `npm run qa:normalizer-registry-purity`, `node --test` with real pass/fail/skipped counts (skipped is not passed) |
| S2 | CMD R2 regression: `git diff origin/master -- .claude/settings.json` shows comment lines only; a JSON parse prints hooks keys exactly SessionStart and UserPromptSubmit; `qa:gate-command-path`, `qa:gate-matcher-drift`, `qa:runtime-settings-drift`, `qa:gate-manifest` PASS |
| S3 | CMD stale-comment grep from section 10 returns only the recorded historical hits |
| S4 | CMD R6: this PR's CI log shows node v22.18.0 and `ISSUE-123(b)`, `ISSUE-123(c)` ok (baseline: run 36219917467, ok 187 and ok 188, 1139/1139) |
| S5 | CMD zero-diff: `git diff --stat origin/master --` over the NOT-touched list in section 6 is empty; `hooks/sessionstart-tool-enum.mjs` diff is limited to the shared-function swap and its existing tests pass unmodified |

### M: mutation drills. X-3 is a PHASE 2 GATE: the implementer runs M1-M7 on the built code before review and records the ACTUAL red set next to the PREDICTED one (PT-11); a mismatch is a plan defect fixed before the review chain starts. Predicted sets below are corrected to what the design-challenger and architect measured on a plan-faithful prototype

| ID | Mutant | Predicted red set (corrected) | Measured on the prototype |
|---|---|---|---|
| M1 | normalizer emits one marker for every class | G13, G4, G5, H7 | H7, G4, G5 (G13 not in the prototype) |
| M2 | fixture entry (the first committed one) flipped to read-only | G13 (fixture-derived case), H7 | H7 (G13 not in the prototype) |
| M3 | hook re-hardcodes the bootstrap outcome instead of the loader posture | H5, H11 (G3 stays GREEN: it injects the port and never runs the hook wiring) | H5, H11 |
| M4 | LoadFailure returns allow | G1, H6 | H6 (G1 not in the prototype) |
| M5 | add the marker verbs to `KNOWN_VERBS` | N8, N9b, H11b (N9 and H11, the path-scoped forms, stay GREEN and are not claimed) | N8 only (before N9b and H11b existed) |
| M6 | route Bash through tool-class | H5, H10, G3, and G16 as re-expressed (PT-14c). G11 and the earlier G16 stay GREEN and are not claimed | H5, H10, G3; the earlier G16 green |
| M7 | server lookup by prefix or longest match | N3b (PT-14b). N3, N4, N5, H4 stay GREEN (the parser rejects their names first) and are not claimed | none (survived before N3b existed) |

### D: docs (IMPL drafts; Manager ratifies; nothing written into `docs/decisions.md` by this story's plan phase)

| ID | Named check |
|---|---|
| D1 | rows drafted for: #288(2) plus the scalar-only trust truth; #107 additive reading; S5 criterion 12 partly superseded (mcp__ names added, built-ins still refused); Q-B outcome; no-cache supersedes `docs/backlog.md` line 61; AP-13 and AP-14 bound as activation blockers |
| D2 | `docs/backlog.md`: the #93 entry is reworded as CAPABILITY DELIVERED (a tool's class is rule-matchable data through the tool-class normalizer; the gate is unwired); ENFORCEMENT CONTENT is tracked by AP-1; #93 stays open, or closes only with an explicit link to AP-1's owner (PC-13). It does not say RESOLVED. Section 13 items added |

### 7a. Counts, generated by script (design-challenger U-6). The counts in the receipt come from this command, not from hand counting

```bash
awk '/^## 7\. /{on=1;next} /^## 8\. /{on=0} on && /^\| [A-QS-Z]+[0-9]+[a-z]? \|/{split($0,a,"|"); gsub(/ /,"",a[2]); print a[2]}' docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md | sed -E 's/[0-9]+[a-z]?$//' | sort | uniq -c | awk '{n+=$1; printf "%s:%s ", $2,$1} END{print ""; print "TOTAL", n}'
```

### Requirement trace (R1-R13)

| R | Covered by |
|---|---|
| R1 (#93) | G4, H7, G13 (fixture-derived case), M1, M2; class is rule data, nothing denies by class from shipped data until AP-1 (section 2); #93 stays open (D2) |
| R2 | DEFERRED by ruling; S2 proves nothing wired; AP-4, AP-5 |
| R3 | G3, H5, M3 |
| R4 | P1, P2, P3, P4, P6 |
| R5 | section 8a; P2, P7, G7; existing conformance Part F unchanged |
| R6 | S4 (baseline in hand) |
| R7 | DEFERRED (8b) |
| R8 | no explicit lock flag: `schema.ts`, `precedence.ts` zero diff (S5) |
| R9 | C1..C11, S-5, S-7, D1 |
| R10 | N8, N9, N9b, N12, G13, G13b, S5, section 4 |
| R11 | G1, G2, G8, G9, G20, H13, section 9 |
| R12 | L1, L2, L3, L4, S-4 |
| R13 | G18; hook header keeps its no-durable-trail disclosure |

## 8. Decisions

### 8a. #288 (2) peer-override and the trust model (R-E). Ruling kept: peer semantics, `precedence.ts` unchanged. The truth, stated

- **Central posture is un-relaxable as a SCALAR only.** A rank-0 layer cannot relax a central `defaultOutcome`. It CAN add an allow RULE: the kernel evaluates matched allow rules before the default outcome, so project (or a shipped rule id redefined by project, since shipped and project are peers and a shipped `mandatory` flag is inert) can allow what a central posture denies. Demonstrated by the architecture report (F3) and the design-challenger (rows B, C, E) with the real merge; documented by G7 and P7.
- What stays as ratified 2026-09-24: project may relax a shipped posture when central is absent or declares nothing; a lower-trust layer may tighten to deny (availability lever).
- What changes: the R4 print line names the source and says rules from lower-trust layers can still allow (P2). It does not say "enforced".
- Central cannot require its own allow ("deny unless central allows"); that is a POL-07 extension, not built here (section 17).

### 8b. R7 (disclose an ignored relaxing declaration): DEFER (unchanged)

- Needs `precedence.ts`, `loader.ts`, `printer.ts` plus tests; `precedence.ts` is otherwise untouched here. The ignored relax is fail-closed and visible through the source on the R4 line.

### 8c. #107 (R9), ADDITIVE per R-F. The 2026-09-24 condition ("capture a verified non-English sample or replace the text match") is met by a third route the Manager ruled: keep the English match as the fast path and add a locale-independent fallback

- Keep `isNotFoundError`, `NOT_FOUND_PATTERNS` and every existing test untouched.
- Trigger: only when call 1 exits with status 1 AND its stderr is not classified by the English patterns. Status 2, a null status (timeout, overflow) and spawn errors rethrow as today, with no second call.
- Fallback: run the parent listing (`reg query HKLM\SOFTWARE\Policies`). It may only DOWNGRADE the failure to absent, and only when ALL hold: it exits 0; the listing is RECOGNISED (positive parse evidence, below); and no line equals the Thoth subkey line (exact, case-insensitive). Any other outcome, including a failure of call 2, rethrows the ORIGINAL error from call 1. The key-listing step is dropped.
- **Recognised listing (Q-E adaptation of R-F's "own header line").** S-7: the header line exists only for keys with values, so it cannot be required. Equivalent locale-independent evidence: at least one non-blank line equals the parent path or starts with the parent path plus a backslash (case-insensitive), and every non-blank line is such a line or an indented value line. An empty parent (no subkeys, no values) prints nothing and is unrecognised, so it rethrows (fail-closed, availability only).
- Spawns: English absent 1 (unchanged); non-English absent 2; present 1. Worst case two sequential 5 s timeouts (10 s), recorded in section 9.
- Evidence and limits: S-5 (measured with real `reg.exe`, non-English stderr FORCED, not captured), classifier golden C9 over real bytes. Not demonstrated on a non-English host (U-1); the English text match remains a ratified residual with calendar backstop 2026-10-24.
- Drift risk (design-challenger attack 6, PT-9): an unrecognised non-English listing must throw, never silently drop central policy; C3 pins it.
- Decisions row (D1): the ratified 2026-09-24 #107 condition is discharged by a locale-independent fallback with the English match kept.

### 8d. No cache (R-J)

- Unchanged: no cache (S-4). Recorded as a proposed decision that it SUPERSEDES the S6 architecture pre-build recommendation at `docs/backlog.md` line 61 (compute once per session), on measured evidence. Not written into `docs/decisions.md` here.

## 9. SUR-10: every fail-open path of the live wiring, each a recorded decision. G9 enumerates by probe; this table is the recorded decision

| Path | Decision | Test |
|---|---|---|
| missing configuration | project policy, shipped-defaults or fixture unreadable: load failure or throw: deny, never a bootstrap fallback. Central absent contributes nothing (AC5a) and the posture comes from lower layers | G1, G2, H6, C1 |
| unknown tool | unclassified, ambiguous or unparseable MCP name: opaque plus unresolved: POL-05 deny | N2, N3, H3, H4 |
| unknown tool (unroutable name) | pre-kernel refusal, today's behavior retained by R-B (F7 reading) | G17, H2, H8 |
| internal exception | exit 2 with stderr (unchanged) | existing AC-6 tests, G2 |
| malformed input | bad JSON or empty stdin: exit 2; missing or non-string `tool_name`, non-string Bash command: refusal | H9, G8, G9 |
| unrecognised syntax / depth cap | S4 behavior, unchanged | existing AC-1 and shell tests |
| lock timeout | not applicable: no lock in this hook or the loader (the audit-log lock is S8) | G9 records the N/A |
| hook timeout | runtime property: a timed-out PreToolUse hook does NOT block. Declared timeout 60 at activation; nominal p99 254.5 ms; registry worst case 5 s (English path) or 10 s (additive path) | L1, L2 |
| non-blocking hook surface | runtime property, disclosed | G9 records it |
| **process fails before the hook's own try/catch (three unnamed launch paths: node without TS type-stripping, missing import target, interpreter not on PATH)** | exit 1 is non-blocking on Claude Code 2.1.267 (design-challenger, real runtime): the call PROCEEDS. **NOT fixed in this story; bound as activation blocker AP-13 (Issue #303)** | G9 (probe records each as PROCEEDS with the AP) |
| **input-size timeout (quadratic redirect scan; 2000 ms crossed near 16 KB)** | a timed-out hook proceeds. **NOT fixed here (`shell-scanner.ts` untouched); bound as AP-14 (Issue #304)** | G9 records it as not probed here, with the AP |
| loader failure | deny (Q4), layer and kind only | G1, H6, M4 |
| **gate result the adapter does not recognise (outcome `ask`, undefined, null, unknown kind, refusal without a reason)** | under Q-B silence means allow, so the adapter is typed and closed: only an exact allow verdict is silent; every other shape exits 2 with stderr, never silent (PT-15, residual R-5 closed) | G20, H13 |
| posture `bootstrap` allow | when no layer declares a posture (the case under Y); disclosed by the print line | P1, P2 |
| sanitizer mismatch on an unobserved character, or a fixture name outside `[A-Za-z0-9-]` | tool reads unclassified: deny (availability, not bypass); rejected entries are reported | N3, N4, N4b |

## 10. Stale comments to correct (generated by grep; rerun as S3)

Instrument: `grep -rn -E "presence-only|inert today|class.{0,40}inert|inert.{0,40}class|does not itself (gate|drive)|no consumer read|tracked at docs/backlog.md as|Issue #93|still reads (its|via) (own|its)|own, separate loadBootstrapRuleSet|hook still reads|nothing consumes it until|not itself gate anything" src hooks docs/qa .claude docs/backlog.md docs/adr` (non-test files). Results and fixes:

| File:line | Fix |
|---|---|
| `src/policy/tools/central-classification.ts:9-13` | class is consumed by the gate as rule data (unwired); state it |
| `docs/qa/s5-central-classification.json:6` (`notes` entry 3) | same; `notes` text only, no entry |
| `src/policy/tools/builtin-tool-inventory.ts:29-30` | built-in classes still drive nothing in the gate (R-B); rewrite honestly, drop "future story's job" |
| `src/policy/config/loader.ts:113-114` | `ResolvedPosture` doc: the hook consumes it (unwired) |
| `src/policy/config/printer.ts:31` (`ENFORCEMENT_DISCLOSURE`) | must stay TRUE: hook consumes the loader but is not wired, nothing enforced live; P5 ties the literal to the settings state |
| `docs/backlog.md:24` | #93 entry reworded: capability delivered, enforcement content tracked by AP-1, #93 stays open (D2); not "RESOLVED" |
| `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md:71` | accepted ADR: agents cannot edit; proposal via `/maat:adr-amend` (Q-C) |
| `.claude/settings.json` comment item 6 | comment-only rewrite (matcher scope now Bash plus mcp__ names once activated); no `hooks` change (S2) |
| `hooks/pretooluse-kernel-gate.mjs` header | rewrite; also correct the claim that the whole body runs in one try/catch (static imports do not, AP-13) |
| `src/policy/config/bootstrap-ruleset.ts` header | the hook no longer consumes `loadBootstrapRuleSet` |
| `src/policy/config/central-source.ts` header (#107 notes) | describe the additive fallback |

Not edited by an agent: `CLAUDE.md` "Sensitive areas" still names the deleted report-subject gate hook script (human-owned).

## 11. Test-first dispatch check: YES, dispatch `test-writer` BEFORE Phase 2

- Externally observable surfaces that change: the hook stdin/stdout contract (Q-B silent allow, MCP names, load-failure deny, typed fail-closed output) and the printer surface (`posture`, `postureLine`, CLI line).
- **Locked tests needing a `test-writer` amendment, exactly (unchanged from revision 2):**
  1. `hooks/pretooluse-kernel-gate.test.ts`, AC-2: the assertion `notEqual(decision, undefined)` and the header comment about the bootstrap `defaultOutcome` (Q-B: a kernel allow emits nothing). Existing ruling; H10 supplies the exact empty-stdout assertion that replaces it.
  2. Same file, comment-only: the header block that says any tool other than Bash denies (now "other than Bash and mcp__ names"). No assertion changes.
  3. `src/policy/config/printer.test.ts`: additive P1-P5, P7 only; no existing assertion changes.
- Locked tests that need NOTHING: AC-19 (all 3, R-B), AC-1, AC-6, every `central-source.test.ts` test (R-F), the `hooks/sessionstart-tool-enum*.test.ts` files (27 tests, G14 and G14b must keep them green unmodified).
- New `test-writer` files: `hooks/pretooluse-kernel-gate-classification.test.ts` (H1-H13 incl. H11b) with the sandbox helper (registry source pinned), `src/policy/config/print-cli.test.ts` (P6). Fixture entry names are derived at run time (PC-11).
- Implementer-owned, written failing first: N, G, C, L4 (`src/qa/gate-latency-budget-check.test.ts` additive).
- Sequence: (1) `test-writer` H, P (rounds 1 and 2 of design-challenger and the architect re-confirm are done); RED-CONFIRMED; (2) implementer writes N, G, C, L4 failing first; (3) build; (4) drills M1-M7 with actual versus predicted red sets recorded (X-3, a Phase 2 gate); (5) comment and docs corrections; (6) review chain; (7) verify. Activation is a separate story.

## 12. Blocking questions

None. Nothing blocks `test-writer`. Two items for the Manager and human:

1. **Q-E (Manager ack, given; not blocking).** R-F's "parent key's own header line" is not implementable for the real target (S-7). The adaptation in 8c (a line equal to or under the parent path, plus indented value lines only) keeps R-F's intent: positive, locale-independent parse evidence, downgrade-only, rethrow the original otherwise. The Manager's revision brief says the Q-E ack stands.
2. **Q-C (HUMAN; blocks activation only), extended per PC-6 and PC-11.** THOTH-ADR-0001: (a) the "the merged PR diff is the approval" ruling once a class can grant allow; (b) rule 1 (fixture as an enforcement control beyond SUR-03 halt suppression); (c) rule 5 (recording the resolved fixture path in halt-state, which the write-free gate cannot do); (d) the stale residual row "Inert classification" needs an `/maat:adr-amend` proposal; (e) **does test code count as "code" for the rule "MUST NOT hardcode an entry of either list in `hooks/` or `src/`"?** Interim: the gate reads the fixture and records nothing; the plan's tests derive entry names at run time (G19), which is conformant under either reading.

### 12a. Residuals recorded, no build work

| # | Residual | Trigger / monitor | Note |
|---|---|---|---|
| R-4 | #107: format drift that affects only the Thoth line of a recognised listing (BOM, NBSP or an indent on that line) still resolves absent | first captured non-English listing (U-1) or any `reg.exe` output change | LOW, assumption. Optional PT-16 (a decorated Thoth line rethrows) stays OPTIONAL and is not in the count. Trailing decoration is a different key name and stays a C5 decision |
| R-6 | H checks spawn the real registry reader, so a Windows dev host with central policy deployed can flip verdicts | a dev host with central policy | The sandbox CAN pin the source: it overwrites the copy's `central-source.ts` default export with a fixed "absent" source (S-8), so H1-H13 are host-independent. Recorded fidelity limit: the real reader is covered by the C suite and C11 only. STILL host-dependent: the locked hook tests (AC-1, AC-2, AC-6, AC-19), P6 and L1/L2 |
| R-5 | (closed by PT-15) adapter polarity | - | typed closed output, G20, H13 |
| R-7 | both AWS MCP servers' tools are unresolved by the double-underscore rule (13 names counted) | AP-2, AP-3 classification work | availability only (S-6) |
| R-8 | shell verb resolution is tool-blind (round 1 PT-2) | the story that adds baseline allow content | AP-1 names PT-1 and PT-2 as entry tests |
| R-9 | P5 derives wired-or-not from the tracked settings file only; a local, user or managed entry is invisible to it | any wiring outside `.claude/settings.json` | LOW |

## 13. Proposed backlog (out of scope, not in the diff)

- AP-2 inventory refresh and classification (23 unvendored built-ins); bidirectional drift check against a runtime probe.
- Filesystem normalizer so Edit and Write can be allowed by path; deny rules protecting the policy files (AP-10).
- Baseline allow content (AP-1); classification decision for the 8 exempt connectors' tools.
- `gate-matcher-drift-check` awareness of `mcp__` matchers.
- Fix #303 (launch failure) and #304 (quadratic redirect scan) in their own story before activation.
- Delete `loadBootstrapRuleSet` once unused (needs a test-deletion ruling).
- Shorter per-call registry timeout for the hook; latency corpus with large inputs and a Windows job.
- R7 ignored-relaxation disclosure; per-tool MCP classification; verify sanitization for characters beyond space and dot; print allow-rule counts per layer (architecture F3 option).
- `CLAUDE.md` sensitive-areas drift (human).

## 14. Activation preconditions (a later, separate step)

| # | Precondition | Evidence |
|---|---|---|
| AP-1 | baseline allow content (shell, tools, path rules); nothing denies by class from shipped data until then. **ENTRY tests, all three must be green before any rule ships: PT-1 (a shipped class allow cannot be forged by a shell target), PT-2 (a read verb does not authorize a different binary; the shell's verb resolution is tool-blind, R-8), and PT-12 (a rule that cannot match any emitted record is not silent: rejected at load or named on the print surface; the four inert deny shapes in section 4 item 5). Issue #306 stays open and is cited here** | section 2, R-A; round-1 PT-1, PT-2; round-2 PT-12 |
| AP-2 | refresh the vendored inventory; classify 23 runtime built-ins including `ToolSearch` | S-3 |
| AP-3 | ruling on the 8 `knownConnectors` (unclassified, so denied at the gate) | fixture |
| AP-4 | matcher choice and regex semantics (`Bash` and `mcp__.*`), matcher-drift check update | U-5; code-traced `gate-matcher-drift-check.ts` |
| AP-5 | the entry with `timeout` 60; rerun the 4 qa checks; measure on the real runtime | R2 deferred |
| AP-6 | decisions row for S5 criterion 12 | hook header |
| AP-7 | Q-C ruling and ADR amendment | THOTH-ADR-0001 |
| AP-8 | SessionStart and gate agree on one inventory (G14 shares the module; the gate reads the fixture module-relative, SessionStart via the project-dir seam, the same file in the real repo; the inventory refresh is AP-2) | G14, S-9 |
| AP-9 | recovery when the policy load fails: every gated call denies, including Edit and Bash; an agent that can write the policy file can induce it; state the out-of-session repair step | architecture F9 |
| AP-10 | deny rules protecting `.thoth/policy.json`, `shipped-defaults.json` and the fixture (they are the whole authority for allow) | F3, F9 |
| AP-11 | what Q-B means under `permission_mode` bypass, where "emit nothing" proceeds without a prompt | F9 |
| AP-12 | no arbitrary-execution tool (PowerShell, Skill, Workflow, CronCreate, RemoteTrigger) may be classifiable read-only; checked mechanically over the inventory | F6 |
| AP-13 | **Issue #303**: the hook exits 1 before its own try/catch and Claude Code 2.1.267 proceeds; three unnamed launch paths (old Node, missing import, interpreter off PATH). Not fixed here; `.claude/settings.json` untouched | design-challenger attack 2; G9 records them |
| AP-14 | **Issue #304**: quadratic `extractRedirectTargets`; a timeout lets the call run; OPS-03 2000 ms crossed near 16 KB, 60 s near 90-105 KB (extrapolated). Not fixed here (`shell-scanner.ts` untouched) | design-challenger attack 3 |

## 15. File-level change list

| File | Change | Owner |
|---|---|---|
| `src/policy/normalizer/tool-class-format.ts` (new) | marker table, sanitize, parse, build, `buildServerIndex`, `GRAMMAR_VERSION`, grammar doc | IMPL |
| `src/policy/normalizer/tool-class.ts` (new) | normalizer registered by declaration | IMPL |
| `src/policy/normalizer/tool-class.test.ts` (new) | N1-N11 incl. N3b, N4b, N9b (N12 is CMD) | IMPL |
| `src/policy/normalizer/tool-class-golden.test.ts` (new) | G13, G13b | IMPL |
| `src/policy/gate/tool-routing.ts`, `decide-tool-call.ts`, `render-hook-output.ts` (new dir) | routing rows with builders and flag; gate with gate-owned ports; typed closed hook output | IMPL |
| `src/policy/gate/decide-tool-call.test.ts`, `src/policy/gate/render-hook-output.test.ts`, `src/policy/gate/gate-structure.test.ts`, `src/policy/tools/classification-catalog.test.ts`, `src/qa/gate-fail-open-probe.ts` and `src/qa/gate-fail-open-probe.test.ts` (new) | G1-G20 (no G12) | IMPL |
| `src/policy/tools/classification-catalog.ts` (new) | LOCATION function, `projectDir()`, and CATALOG function (two exports) | IMPL |
| `hooks/pretooluse-kernel-gate.mjs` | thin adapter; module-relative fixture; header rewritten | IMPL |
| `hooks/sessionstart-tool-enum.mjs` | keep resolving the location before stdin; swap inline `resolveFixtureLocation` body and merge lines for calls into the shared module; nothing else | IMPL |
| `hooks/pretooluse-kernel-gate-classification.test.ts` (new), sandbox helper under `hooks/test-support/` (registry source pinned), `hooks/pretooluse-kernel-gate.test.ts` (amend AC-2 and comments) | H1-H13 incl. H11b | TW |
| `src/policy/config/printer.ts`, `print-cli.ts` | `posture`, `postureLine`, disclosure text, CLI line | IMPL |
| `src/policy/config/printer.test.ts` (additive), `print-cli.test.ts` (new) | P1-P7 | TW |
| `src/policy/config/central-source.ts`, `central-source.test.ts` (additive) | additive fallback; C1-C9 | IMPL |
| `src/qa/gate-latency-budget-check.ts`, its test (additive) | assert child outcome; L4 | IMPL |
| comments only | `loader.ts`, `bootstrap-ruleset.ts`, `central-classification.ts`, `builtin-tool-inventory.ts`, fixture `notes`, `.claude/settings.json` (no `hooks` change) | IMPL |
| `docs/decisions.md` (drafts for Manager), `docs/backlog.md`, `CHANGELOG.md`, `docs/STATE.md` | D1, D2 | IMPL drafts, Manager ratifies |
| NOT touched | see section 6 | - |

Estimated production diff about 350 lines. Rollout: none; the unwired hook is the flag (ADR-0006). Rollback: `git revert`.

## 16. Pre-build review status

- design-challenger round 1 go (PT-1..PT-11); round 2 go (2 MED issues #306, #307; PT-12..PT-16); architecture round 1 REWORK addressed; architecture re-confirm APPROVE-WITH-CONDITIONS (PC-8..PC-14, folded in by this revision). The design-challenger stated it is not asking for another plan revision round; PT-12..PT-16 fold into day-1 failing tests (PT-12 is bound to AP-1 as an entry test; PT-16 stays optional, R-4).
- No further pre-build round is requested. Frozen set (Q-B stdout integrity, module-relative and env-immune fixture, registry timeout direction, no accidental activation, stale-comment list, marker unforgeable from Bash, sandbox fidelity) is inherited.

## 17. Drafted questions for the architect and human queue (NOT for `docs/decisions.md`)

1. **Central cannot require its own allow.** The kernel evaluates matched allow rules from any layer before the default outcome, so a rank-0 project rule can allow what a central posture denies; central can only add deny rules. Is an allow-list-only central mode ("deny unless a central rule allows", a POL-07 extension) wanted? Accepted for now, disclosed by P2 and P7. (F3, PC-3)
2. **F7.** Are the enumerated pre-kernel refusals (malformed input, unroutable name, load failure) inside or outside ADR-0021's "MUST NOT implement a second decision path"? Precedent: the hook's existing tool_name refusal.
3. **Marker verb vocabulary.** May the tool-class normalizer own a verb vocabulary outside the action catalog (ADR-0021 says verbs come from the catalog)? Marker verbs never enter `KNOWN_VERBS` by design. (F1, F2, F8)
4. **Routing declaration.** How a runtime `tool_name` reaches a registry `toolType`: data table now, registration-time declaration at the third normalizer. (F6)
5. **INT-07 wording.** What a posture line naming "central" may claim when lower layers can add allow rules and the classification called "central" is an in-repo file. (F3, F5)
6. **Q-C** (section 12), human.

## 18. Unrun verifications (owner, command)

| # | What | Status | Command / owner |
|---|---|---|---|
| U-1 | Non-English `reg query` listing format and the recognised-listing rule on a real localized host | UNRUN (no such host) | `reg query HKLM\SOFTWARE\Policies` and one child on a de-DE or ja-JP host, save raw bytes; human |
| U-2 | Additive path against real `reg.exe` | DONE for an English host with forced non-English stderr (S-5); still unrun on a real localized host | see U-1 |
| U-3 | Wall clock of a hung registry reader through the built hook | UNRUN | a fake `System32\reg.exe` that blocks, run the built hook, expect deny in about 5 s (10 s additive); implementer |
| U-4 | PT-1..PT-3 shapes against the built hook | re-expressed as N9, N9b, H11, H11b (built and run in Phase 2) | `node --test hooks/`; test-writer and implementer |
| U-5 | Matcher regex semantics for `mcp__.*` | UNRUN (AP-4) | scratch `claude -p` session with a PreToolUse matcher `mcp__.*` and a stdio MCP server; at activation |
| U-6 | Count of acceptance criteria and checks | DONE by script (7a) | the awk command in 7a |
| U-7 | `--no-experimental-strip-types` launch fault on Node 22.18.0 (CI's version); the design-challenger measured it on 24.15.0 | UNRUN | run the G9 probe on CI's Node |
| U-8 | Real `claude -p` session against the built hook for a Bash call and an MCP call | UNRUN (activation) | Manager or implementer at activation |
| U-9 | An env block in the local settings override file overriding `CLAUDE_PROJECT_DIR` in a real session | SETTLED for the local settings override file on 2.1.267 in print mode (S-9: not overridden); still UNRUN for user and managed settings | the gate does not depend on it (module-relative) |
| X-1 | A child key the user cannot read is still listed by the parent query (bears on C4: the fallback rethrows when the listing shows Thoth) | UNRUN (the harness refused a registry write) | scratch key under HKCU, deny read on the child, run `reg query` on the parent and on the child with `/v`; human or implementer |
| X-2 | Which characters the runtime sanitizes beyond space and dot | UNRUN | scratch `claude -p` session with servers declared as `a:b`, `a+b`, `a b`, `a.b`, an accented name, `a__b`; print `tool_name` from a PreToolUse hook; implementer. Until run, any unobserved character mismatches toward deny (and only `[A-Za-z0-9-]` names are admitted) |
| X-3 | Drills M1-M7 on the built code, actual red sets next to predicted | PHASE 2 GATE (not run: no code exists) | implementer, before the review chain |

## 19. Next single action

Manager: dispatch `test-writer` for H (H1-H13 incl. H11b, with the registry-pinned sandbox helper) and P (P1-P7), plus the AC-2 amendment and comment edits.

RECEIPT: verdict=PLAN-READY(no blocking questions; Q-C is a human activation blocker) criteria="87/87 mapped (script-generated, section 7a: C:11 D:2 G:22 H:14 L:4 M:7 N:15 P:7 S:5)" checks="0/0/0 (plan only; 1 cheap probe run this revision: S-9 settings env override of CLAUDE_PROJECT_DIR; X-1, X-2, X-3, U-1, U-3, U-5, U-7, U-8 unrun)" adr=HIT(37) pr=n/a

## 20. Phase 2 build record (appended 2026-09-26; docs only)

### 20a. X-3: mutation drills on the BUILT code, actual red set next to the predicted one

Method: each mutant applied to the built file, the story's eight test files run (63 tests, baseline 63 pass), the file reverted with git checkout. Every predicted test went red; no predicted check survived.

| Drill | Mutant | Predicted red set | ACTUAL red set | Match |
|---|---|---|---|---|
| M1 | normalizer emits one marker for every class | G13, G4, G5, H7 | H7, H12, G4, G5, G13, G13b | superset (H12 and G13b also red) |
| M2 | first committed fixture entry flipped to read-only | G13, H7 | H7, G13 | exact |
| M3 | hook re-hardcodes the bootstrap outcome | H5, H11 (G3 green) | H5, H11 | exact; G3 stayed green as predicted |
| M4 | load failure ignored by the gate | G1, H6 | H6, G1 | exact |
| M5 | marker verbs added to KNOWN_VERBS | N8, N9b, H11b | H11b, N8, N9b | exact; N9 and H11 stayed green as predicted |
| M6 | route Bash through tool-class | H5, H10, G3, G16 (G11 and the old G16 "stay green") | H5, H8, H10, H13, AC-2, G3, G7, G16, G11 | superset; **prediction defect: G11 went RED**, because the built G11 also pins the routing table's row to toolType mapping, so a mis-pointed row is caught there. H8, H13, AC-2 and G7 were also red |
| M7 | server lookup by prefix or longest match | N3b (H4, N3, N4, N5 "stay green") | H4, N3b | superset; H4 also red (test-writer added exactness cases; the plan's "H4 stays green" was too weak) |

Findings from the drills: none unkilled. Two prediction understatements (M6: G11 and others; M7: H4), both in the safe direction (more checks catch the mutant than the plan claimed). Drill driver and raw output: scratchpad, not repo code.

### 20b. Other Phase 2 evidence (real output recorded in the hand-back receipt)

- Full suite: 1213 tests, 1213 pass, 0 fail, 0 skipped (baseline at master was 1139).
- G9 probe (real hook, injected faults): three PROCEEDS (node without type stripping, missing import target, interpreter not on PATH; all recorded as AP-13) and six BLOCKS (empty stdin, invalid JSON, numeric tool_name, unroutable tool_name, unclassified MCP tool, corrupt project policy). Not probed and recorded: input size (AP-14), hook timeout, lock timeout.
- Latency with the loader in the path (Windows, N=40, shell-form spawn): qa gate-latency-budget p50 164.8 ms, p99 193.1 ms; Bash allow p50 165.8, p99 196.4; classified MCP allow p50 162.8, p99 189.0; unclassified MCP deny p50 167.1, p99 187.5. All far below the 2000 ms budget (p99 about 9.8 percent). CI runs Linux, no registry spawn.
- Stale-comment grep (S3): the stale phrases are gone from every file this story may edit. Remaining hits are three recorded historical or accepted-record lines: the append-only backlog entry for the issue (with the S7 update appended), an unrelated S4 line in the same file, and the accepted ADR residual row (human, Q-C).
- Diff-scope check against the Phase 2 base: PASS, zero forbidden paths, comment-only files equal after comment stripping, settings.json equal outside its comment key, fixture equal outside its notes, zero deleted lines in the existing central-source, printer, latency and locked hook tests, no SessionStart test changed.

## 21. Draft decisions rows for the Manager to ratify (NOT written into the decision log by the implementer)

1. **#288 precondition 2 and the trust model (R5, R-E).** Peer semantics kept, no change to the rule precedence module: project may relax a shipped posture when central is absent or declares nothing; a lower-trust layer may tighten to deny. Central posture is un-relaxable as a SCALAR only: a rank-0 layer's allow RULE (or a redefined shipped rule id) can still allow what a central posture denies. The print line says so (tests P2, P7, G7). Central cannot require its own allow; queued for the architect.
2. **#107 additive reading.** The ratified 2026-09-24 condition is discharged by a locale-independent fallback with the English match kept as the fast path (no test deleted). The header-line evidence of the ruling was adapted to a line at or under the parent path (Q-E, measured: the header line is printed only for keys with values). Not demonstrated on a non-English host; the calendar backstop 2026-10-24 stays for the English text match.
3. **S5 criterion 12 partly superseded.** The gate now also evaluates mcp__ names; every other tool_name, built-ins included, is still refused. Nothing is wired.
4. **Q-B outcome.** A kernel allow emits nothing; measured that a hook allow skips the user's permission prompt.
5. **No cache supersedes the S6 architecture pre-build recommendation in the backlog (compute once per session)**, on measured evidence (about 42 ms p50, 76 ms p99 added).
6. **AP-13 and AP-14 bound as activation blockers** (issues 303 and 304); not fixed here.
7. **Grammar version 1** of the tool-class markers and targets, with the rule-author facts in the grammar module header; a bump needs a decisions row and a central-rule migration note.
