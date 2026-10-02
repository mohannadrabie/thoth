# Phase 1 plan: story C (inventory re-vendor, connector labels, AP-12 replacement, agreement test)

Date: 2026-10-02. Author: story-implementer (Ptah). Phase 1 only: nothing built, nothing committed. Branch `s308/activation`.
Inputs: `docs/plans/s308-activation-phase0-2026-10-02.md` (story C), `docs/decisions.md` 2026-10-02 rows (human rulings (2) AP-3, (5) AP-2; "#308 remainder" item (4)).
`📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT]`

## 0. Findings that change the Phase 0 text

| # | Phase 0 said | Measured / read | Effect |
|---|---|---|---|
| F1 | "classify 23 built-ins" | Live init lists 35 non-`mcp__` tools; 25 are not in the vendored 19; 9 of the vendored 19 are absent from the live list | 25 to classify, not 23 (see section 3) |
| F2 | C2: test vs `s5-central-classification.json` | Built-in classes live in `CLASSIFICATION` in `src/policy/tools/builtin-tool-inventory.ts`, not in the fixture | C2 is a test over inventory vs `CLASSIFICATION`; the fixture holds only MCP servers and connectors |
| F3 | AP-3 "label the 8 connectors `remote-mutating`" | Gate grammar v1 admits a server name only if it is `[A-Za-z0-9-]+` (`ADMISSIBLE_SERVER_NAME`, `tool-class-format.ts:91`). Runtime spelling is `claude_ai_Gmail` (underscore); the fixture spelling is `claude.ai Gmail` (dot, space). Neither can be admitted | A fixture label is inert under grammar v1: connector tool calls stay opaque and POL-05 denies them. See Q1 |
| F4 | AP-12: arbitrary-exec built-ins | All five AP-12 names are present in the live list (PowerShell, Skill, Workflow, CronCreate, RemoteTrigger) | The real assertion can now be written over the real inventory |
| F5 | gate-matcher-drift may break | `.claude/settings.json` has no `matcher` today (S12 held). The check compares `CLASSIFICATION` names (derived from the inventory) and matcher names to the inventory | Passes after re-vendor; the real break is `buildBuiltinToolClassificationLayer` throwing on unclassified names (section 5) |
| F6 | -- | SessionStart's universe is the inventory itself (`builtinLayer.tools` names, `sessionstart-tool-enum.mjs:534`), plus MCP server names. The gate evaluates only `Bash` and `mcp__` names (`tool-class.ts` header, plan R-B) | A built-in's class drives no enforcement decision today. This is why STANDARD holds (section 7) |

## 1. Restated story

Re-vendor `docs/qa/tool-inventory.json` from this Claude Code install with a script, classify every new built-in, label the 8 known connectors in the fixture, replace the AP-12 tripwire with the real non-read-only assertion as a recorded act, and add a behavioural test that SessionStart and the gate assemble the same catalog.

## 2. How the inventory is re-vendored

- **Source on this install:** the `system`/`init` event of `claude -p --output-format stream-json --verbose --max-turns 1`. Its `tools` array is the runtime's own tool list. Built-ins are every entry not starting with `mcp__`.
- **Existing vendoring script:** none. Searched `src/`, `hooks/`, `package.json`, no `scripts/` dir exists. The current file was hand-captured from a web search (evidenceTier `derived`, 2026-09-06).
- **Plan: new instrument `src/qa/vendor-tool-inventory.ts`** (npm script `qa:vendor-tool-inventory`, not part of CI: it calls the live binary; same offline-in-CI convention as QA-17).
  - Pure functions, unit-tested: `extractBuiltinNames(initEvent)`, `mergeInventory(previous, measured)`, `renderDiff(previous, merged)`.
  - `main`: runs the command above with `cwd` = an OS temp dir outside the repo (no repo settings or hooks load), reads the init event, writes `docs/qa/tool-inventory.json`, prints the generated diff.
  - `--from <init.jsonl>`: reads a saved init event instead of spawning (tests, and reproducing the diff in review).
  - No tool name is typed by hand anywhere. The `capturedAt`, `claude_code_version`, `platform`, `permissionMode` fields come from the event and the process.
- **Exact command (this pass, run in a scratch folder; raw output kept in the session scratchpad `probe/init.jsonl`, `probe/plan.jsonl`):**

```bash
cd "$(mktemp -d)" && claude -p "say ok" --output-format stream-json --verbose --max-turns 1 > init.jsonl
node -e "const l=require('fs').readFileSync('init.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse);const i=l.find(x=>x.type==='system'&&x.subtype==='init');console.log(i.claude_code_version,i.tools.filter(t=>!t.startsWith('mcp__')).sort().join('\n'))"
```

- **Measured:** Claude Code 2.1.267, win32, 35 built-ins. A second run with `--permission-mode plan` gave 33: `ArtifactComments` and `ArtifactData` are absent. The list depends on mode, account, and platform (`PowerShell` is Windows). The inventory is therefore a union-able, install-specific measurement.
- **Evidence tier to record in the JSON:** `measured` (live init event, this install, this account, this platform), not `derived`. The `evidenceNote` states the dependence above and keeps the "never fetched in CI" sentence.
- **Merge rule (default, see Q2):** `tools` = measured names ∪ previously vendored names. Two new fields record provenance: `measuredTools` (init event) and `carriedForward` (previously vendored, absent from the event). The parser reads only `tools` today, so extra fields are inert. The 9 carried-forward names stay classified, so a session that does expose them (interactive-only tools) still resolves.

## 3. Inventory diff and proposed classification (generated 2026-10-02 from the init event)

Generated diff against the vendored file (set difference by script, not hand-typed):

- NEW (25): Artifact, ArtifactComments, ArtifactData, CronCreate, CronDelete, CronList, DesignSync, EnterWorktree, ExitWorktree, ListAgents, ListMcpResourcesTool, Monitor, PowerShell, PushNotification, ReadMcpResourceDirTool, ReadMcpResourceTool, RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskOutput, TaskStop, ToolSearch, Workflow.
- ABSENT FROM LIVE LIST (9): AskUserQuestion, BashOutput, ExitPlanMode, KillShell, ListMcpResources, MultiEdit, ReadMcpResource, SlashCommand, TodoWrite.
- Present in both (10): Bash, Edit, Glob, Grep, NotebookEdit, Read, Task, WebFetch, WebSearch, Write.

Rule used (existing header rule in `builtin-tool-inventory.ts`): where ambiguous, pick the higher bucket. Buckets: read-only < workspace-mutating < remote-mutating. The class is judgment, not measured; `app-security-reviewer` confirms each row. Because no built-in is gate-evaluated today, a wrong row cannot allow anything now, but it is data the AP-1 rules may key on later.

| Tool | Proposed class | Reason | Confidence |
|---|---|---|---|
| ToolSearch | read-only | Returns schemas of deferred tools; no side effect itself. It makes deferred tools callable, so the gate (not this class) is what bounds those | high |
| ListAgents | read-only | Lists agents | high |
| CronList | read-only | Lists scheduled jobs | high |
| TaskOutput | read-only | Successor of BashOutput (read-only today) | high |
| ListMcpResourcesTool | read-only | Matches existing `ListMcpResources` | high |
| ReadMcpResourceTool | read-only | Matches existing `ReadMcpResource` | high |
| ReadMcpResourceDirTool | read-only | Directory form of the same | high |
| PowerShell | workspace-mutating | Same as Bash; AP-12 named; must not be read-only | high |
| Skill | workspace-mutating | Same as SlashCommand; AP-12 named | high |
| Workflow | workspace-mutating | Runs multi-step agent work; AP-12 named | medium |
| CronCreate | workspace-mutating | Schedules future prompt execution; AP-12 named | medium |
| CronDelete | workspace-mutating | Removes a schedule | high |
| ScheduleWakeup | workspace-mutating | Schedules a session wake-up; like TodoWrite's "session state" call | medium |
| Monitor | workspace-mutating | Streams a background command's output, so it runs a command | medium |
| TaskStop | workspace-mutating | Successor of KillShell | high |
| EnterWorktree | workspace-mutating | Creates and switches a git worktree | high |
| ExitWorktree | workspace-mutating | Leaves, may remove, a worktree | high |
| RemoteTrigger | remote-mutating | Triggers a remote agent run; AP-12 named | high |
| PushNotification | remote-mutating | Sends a notification off the machine | medium |
| SendMessage | remote-mutating | Ambiguous (agent or external recipient), so higher bucket | low |
| Artifact | remote-mutating | Creates or edits a hosted artifact | medium |
| ArtifactComments | remote-mutating | Writes comments on a hosted artifact | low |
| ArtifactData | remote-mutating | Reads/writes hosted artifact data; ambiguous, higher bucket | low |
| DesignSync | remote-mutating | Syncs designs to a remote service; semantics not verified | low |
| ReportFindings | remote-mutating | Ambiguous destination, higher bucket | low |

- The 9 carried-forward names keep their current `CLASSIFICATION` entries unchanged.
- "Low" rows are flagged to the reviewer with the init event as the only evidence. No docs lookup was done in this plan; the build step may add one `tools-reference` cross-check at `derived` tier, recorded as such.

## 4. Acceptance criteria, each mapped to a named check (new = failing first)

Commit order inside the story is in section 6.

| # | Criterion | Named check | Status |
|---|---|---|---|
| C1 | Inventory comes from the script; `capturedAt`, version, platform, tier `measured` recorded | `vendor-tool-inventory.test.ts`: `extractBuiltinNames` drops every `mcp__` name and keeps the rest; `mergeInventory` keeps carried-forward names and labels them; `renderDiff` lists exactly the set difference. Plus `npm run qa:gate-matcher-drift` PASS | NEW, red first (module absent) |
| C1b | The committed `tools` list equals what the script derives from the saved init event | `vendor-tool-inventory.test.ts`: run `--from` against a committed fixture `src/qa/fixtures/claude-init-2.1.267.json` and deep-equal the committed inventory's `measuredTools` | NEW, red first |
| C2 | Every inventory name has a `CLASSIFICATION` entry, and every `CLASSIFICATION` key is in the inventory (both directions, enumerated at run time) | `builtin-tool-inventory.test.ts`: existing self-test (forward) plus a new reverse test; needs a read-only export of the key set (`CLASSIFICATION_NAMES`) | forward exists; reverse NEW |
| C2b | ToolSearch, and each of the 25 new names, is classified | Same test, plus a named assertion `ToolSearch` present and `read-only` | NEW, red after step 2 re-vendor |
| C3 | Tripwire replaced: PowerShell, Skill, Workflow, CronCreate, RemoteTrigger are present in the real inventory and classed workspace-mutating or remote-mutating; none read-only | `src/qa/arbitrary-exec-classification.test.ts`, rewritten in its own commit with a decisions row | rewrite; current tests 1 and 2 fail at re-vendor (expected, section 5) |
| C3b | The seeded mutants stay flagged: Bash/Task lowered, each AP-12 name at read-only in the fixture, unknown class, different casing | Same file, mutants kept unchanged | existing, must stay green |
| C3c | New mutant: the real built-in layer with `PowerShell` flipped to read-only is flagged | Same file, new test | NEW |
| C3d | Each AP-12 name is asserted PRESENT in the inventory (not skipped when absent), so a later inventory drop cannot make the assertion vacuous | Same file, `assert.ok(present.length === AP12_NAMED.length)` over the derived list | NEW |
| C4 | The 8 `knownConnectors` carry class `remote-mutating`, names read from the fixture at run time (Q-C (e)) | NEW `src/policy/tools/connector-labels.test.ts`: for every `knownConnectors` entry assert a matching label entry with class `remote-mutating`; seeded mutant: drop one label, expect failure | NEW, red first. Form depends on Q1 |
| C4b | A label cannot lower or collide: the fixture still loads, `assertNoBuiltinClassLowering` passes | Existing `central-classification.test.ts` and `classification-builtin-override.test.ts` | existing |
| C5 | SessionStart and the gate assemble the same catalog | NEW `src/policy/tools/shared-inventory-agreement.test.ts`: (i) `assembleCatalog(resolveFixtureLocation(repoRoot))` deep-equals `assembleCatalog(moduleRelativeFixtureLocation())`; (ii) every non-`mcp__` inventory name is classified in both catalogs and the classes are equal; (iii) the SessionStart hook run in a sandbox over the real repo reports no unclassified built-in. Seeded mutant: a project-relative fixture with one changed class makes (i) fail | NEW, red first |
| C6 | Existing classification tests and R1-6c still green | `node --test src/qa/catalog-single-source.test.ts src/policy/tools/*.test.ts hooks/*.test.ts` | existing |
| C7 | Dead-name hygiene: no instrument or test hard-codes the 19-name count | `grep` over `src hooks` for the old names returns only the three known files (`builtin-tool-inventory.ts`, `arbitrary-exec-classification.test.ts`, `gate-matcher-drift-check*`) | checked in this plan; rerun at build |

## 5. What breaks, and how each is handled

| Break | Why | Handling |
|---|---|---|
| `buildBuiltinToolClassificationLayer` throws on 25 unclassified names | `builtin-tool-inventory.ts:98` throws when a name has no `CLASSIFICATION` entry. Everything importing it fails: `builtin-tool-inventory.test.ts`, `classification-catalog`, both hooks, `gate-sandbox.ts` and the probe copy the inventory | Intended red. The re-vendor commit and the `CLASSIFICATION` commit land together as one reviewable pair; the red state is shown, not merged separately |
| AP-12 tripwire test 2 | `assert.ok(!inventory.tools.includes(name), "... replace this test ...")` fires once the five names are vendored | Replaced as the recorded act in section 6, commit 4. A strengthening (absent-allowed becomes present-and-non-read-only), not a deletion; SE ADR-0005 "MUST NOT delete or weaken a failing test" is honored and cited in the decisions row |
| AP-12 tripwire test 1 | Needs `present.length > 0`; stays true | Kept, tightened by C3d |
| `qa:gate-matcher-drift` | No matcher names in `.claude/settings.json`; classification names derive from the inventory | Expected PASS. If Q2 were "replace", dead `CLASSIFICATION` keys would remain unflagged, which C2 reverse closes |
| `hooks/*builtin-override.test.ts`, `sessionstart-tool-enum*.test.ts` | Vanilla-session fixtures copy the real inventory (`gate-sandbox.ts:202`) | No count assertions found (`grep` for 19 returned none); run the full set to confirm |
| `hook-import-pins.test.ts` | Pins file-level imports of `builtin-tool-inventory.ts` | A new `CLASSIFICATION_NAMES` export adds no import; confirm by running it |
| `catalog-single-source.test.ts` (R1-6c) | Pins catalog holders and writers | Unaffected: no new catalog writer; the agreement test is a test file (excluded from its scan) |
| Connector label entries (Q1) | Under grammar v1 `buildServerIndex` lists them in `rejected` and nothing consumes `rejected` outside tests | Inert and harmless. Verify with C4b and the tool-class golden tests |
| Fixture note text | `notes[]` says "no test pins this file's contents" | C4 adds the first test over fixture contents (entry presence derived from `knownConnectors`). Update the note in the same commit; it is a fixture entry change under the THOTH-ADR-0001 exception |

## 6. Plan: commits on `s308/activation` (no branch switch; one PR)

1. **Tests first (red):** `vendor-tool-inventory.test.ts` + committed init fixture, `shared-inventory-agreement.test.ts`, `connector-labels.test.ts`, the C2 reverse test. All fail (module absent, labels absent).
2. **Script:** `src/qa/vendor-tool-inventory.ts` + `package.json` script. Tests for C1 go green.
3. **Re-vendor + classify (one pair):** run the script, commit `docs/qa/tool-inventory.json`; add 25 `CLASSIFICATION` entries and `CLASSIFICATION_NAMES`; add the 8 connector labels. C2, C4, C5 go green; AP-12 tests 2 fails here only if this commit is split, so keep it single.
4. **Recorded act: tripwire replacement.** Rewrite `arbitrary-exec-classification.test.ts` header and tests per C3 to C3d; add one `docs/decisions.md` row (SE ADR-0005; what changed, why it strengthens). Own commit, not mixed with 3.
5. **Evidence + docs:** CHANGELOG, `docs/STATE.md`, decisions row for the re-vendor (tier `measured`, version, 35/25/9 counts as printed by the script).
- Run before push: `npm run qa:gate-matcher-drift`, `node --test` over the touched dirs, type check, `node src/qa/reference-resolver.ts origin/master HEAD` (QA-14 diff mode), the S5 hook tests, and the completeness check (`qa:completeness-claims`). Every "all N" in the PR text comes from the script's printed counts.
- **Test-first dispatch check:** no new or changed UI flow or API surface. `test-writer` is not dispatched; Phase 2 may start once Q1 to Q3 are answered.
- **Rollout / rollback:** one revert of the PR restores the 19-name inventory and the old tripwire; nothing is wired (S12 held), so no live session changes.
- Not in scope: the gate matcher, baseline rules (E), grammar changes, connector enforcement.

## 7. Tier and reviewers

- **Tier: STANDARD, confirmed.** Reason: the gate evaluates only `Bash` and `mcp__*` names; no built-in class and no inert connector label reaches a decision today. The Phase 0 raise-to-CRITICAL trigger ("a built-in lands in a class the gate allows") does not fire.
- **Domain reviewer: `app-security-reviewer` (confirmed).** Checks the 25 class rows (a mutating tool labelled read-only), the seeded-mutant coverage, and that the script cannot write a name that was not in the event.
- **Plus `cross-domain-reviewer` (always above TRIVIAL).**
- **Raise to CRITICAL** and split into its own story if Q1 resolves to a grammar change (`tool-class-format.ts` GRAMMAR_VERSION bump, loader or hook edits are named sensitive areas needing a fresh dated report).
- Review reports: the new instruments (script, agreement test, tripwire rewrite) need fresh dated reports in `docs/reviews/`. The 8 fixture labels alone do not (THOTH-ADR-0001 exception: the merged diff is the approval).

## 8. ADR review

- **THOTH-ADR-0001 (project tier):** APPLICABLE. Fixture is the single source of connector and MCP-server labels; rule "MUST NOT hardcode an entry of either list in hooks/ or src/" means C4 and C5 read names from the fixture at run time. Exception in CLAUDE.md covers entry add/remove only.
- **SE ADR-0005 (testing):** APPLICABLE. "MUST NOT delete or weaken a failing test to make CI pass; fix the code or escalate." C3 strengthens; recorded in its own commit and decisions row. "MUST write unit tests for every new/changed domain behavior": C1, C2, C4, C5.
- **SE ADR-0021 (open normalizer registry, classes emit verbs):** APPLICABLE to AP-3. Uses the existing class `remote-mutating`; no new class, no grammar change unless Q1 (b).
- **SE ADR-0010 (code quality):** APPLICABLE (coverage gate on new code). Script is pure-function split so it is unit-covered.
- Other 33 catalog ADRs (devops, API, data, migration): NOT-APPLICABLE; no infra, API surface, or schema.
- UNCLEAR: none.

## 9. Blocking questions (3)

1. **AP-3 form (build impact: high).** Under grammar v1 no connector label can take effect, because `claude_ai_Gmail` and `claude.ai Gmail` both fail `ADMISSIBLE_SERVER_NAME`. Connector calls stay opaque and POL-05-denied. Choose:
   - (a) Recommended: add 8 fixture entries to `centralLayer.tools` named by the display string, class `remote-mutating`, each with a note "inert under grammar v1". Fixture-only; covered by the THOTH-ADR-0001 exception; fail-closed unchanged.
   - (b) Bump grammar to admit sanitized names. Separate CRITICAL story: `GRAMMAR_VERSION`, golden test, decisions row, central-rule migration note (rule 5 of the grammar header).
   - (c) Change the fixture schema so `knownConnectors` entries carry a class. Loader change; sensitive area; needs a fresh report.
   Does the human's "labelled `remote-mutating`" ruling mean (a), or does it expect the label to be enforced (b)?
2. **Absent names (build impact: medium).** 9 vendored names are not in the `-p` init list (AskUserQuestion, BashOutput, ExitPlanMode, KillShell, ListMcpResources, MultiEdit, ReadMcpResource, SlashCommand, TodoWrite). Some are renames (TaskOutput, TaskStop, the `*Tool` MCP names), some are probably interactive-only. Union with provenance fields (recommended) or replace with the measured list? Replace drops their classification entries; no enforcement effect either way today.
3. **Evidence source (build impact: low).** The init list varies with mode and account (`ArtifactData` absent under plan mode; `Artifact*`/`DesignSync` look account-specific; `PowerShell` platform-specific). Accept the `-p` init event on this machine as "this install" (recommended), or also require a second source (the `tools-reference` docs page at `derived` tier) before merge?

## 10. Next single action

- Answer Q1 to Q3, then run Phase 2 starting at commit 1 (tests, red).

`📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT]`
