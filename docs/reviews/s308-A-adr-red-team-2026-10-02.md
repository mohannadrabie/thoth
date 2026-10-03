# Red team: #308 story A, THOTH-ADR-0003 (fixture as PreToolUse gate input)

[red-team] Red Team (Sutekh), CRITICAL tier, attacking the s308-A ADR amendment with failure scenarios.

- **Scope:** `git diff 35f49e9..07e88f3` (commits 1ba378a, 07e88f3). Files: `docs/adr/thoth-0003-central-classification-fixture-as-gate-input.md` (new, proposed), the pointer sentence on `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md:24`, a `docs/decisions.md` row, a CHANGELOG entry, `docs/plans/s308-A-adr-amendment-plan-2026-10-02.md`.
- **HEAD reviewed:** 07e88f3. Experiments ran in a detached scratch worktree at 07e88f3, removed afterwards. The shared working tree was not modified, except for this report and the REVIEW_LOG row.
- **ADR cache:** `📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog — ≈18800 tokens saved this pass (fp d37bef7) [CACHE=HIT]`. Read: THOTH-ADR-0001, THOTH-ADR-0003 (catalog entries), SE ADR-0001, SE ADR-0021 (INT-07, POL-05), and the security and state tags touching the gate.
- **Verdict:** **no-go.** There is one HIGH (security, demonstrated): the fixture's protection precondition cannot cover the built-in file-edit tools. The unlock is a wording change to one rule and one Decision sentence, plus one named story-F test.

## Attacks, ranked by exposure x irreversibility x silence

### A1. [ISSUE][HIGH][demonstrated] "Protect the gate" is scoped to a mechanism that cannot see the Edit tools (Issue #395)

- **Assumption:** "Once the gate is wired, the fixture MUST be among the paths the gate's deny rules protect" (frontmatter rule 5; Rules bullet 6, line 64). Decision line 53 says "A session cannot write the file".
- **Break:** the gate routes only `Bash` and `mcp__*` (`src/policy/gate/tool-routing.ts:8-9`, `ROUTES` has 2 rows). Every other tool name is refused as unroutable. So the activation matcher cannot include `Edit|Write|MultiEdit|NotebookEdit` without denying every edit in the session. Demonstrated:

```text
== Edit   (tool_input.file_path = docs/qa/s5-central-classification.json)
{"hookSpecificOutput":{...,"permissionDecision":"deny","permissionDecisionReason":"the gate evaluates only Bash and mcp__ tool names; got tool_name=\"Edit\"; fail-closed"}}exit=0
== Write  -> identical refusal
```

- Story F's criteria (`docs/plans/s308-activation-phase0-2026-10-02.md` F1-F4) are kernel and normalizer rules ("F4: normalizer-level cases"). Story F built to spec therefore satisfies this ADR's MUST and leaves the Edit path open.
- **Scenario:** the gate is wired. Under AP-11 bypass mode, where an Edit runs with no prompt (Claude Code permissions doc: bypassPermissions "skips permission prompts"), the model is steered by injected content. It uses `Edit` to append `{"name":"x","class":"read-only"}` to the fixture. The gate reads the fixture on every call with no cache (hook header lines 21-24), so the next `mcp__x__*` call passes. Demonstrated in the scratch worktree:

```text
--- D1 baseline unlisted server (mcp__evilsrv__exfiltrate)
{"hookSpecificOutput":{...,"permissionDecision":"deny","permissionDecisionReason":"POL-05: mutating action's source is opaque — fail-closed on ambiguity"}} exit=0
--- D2 after adding evilsrv as remote-mutating (well-formed edit, no commit)
 exit=0        <- empty stdout = kernel ALLOW
halt-state files written: 0
```

- **Tamper detection (the rule 5 question):** none. The gate writes nothing (G18). SessionStart records path and source once, at session start, and no content hash. A well-formed edit is neither blocked nor recorded. The ADR's "never silent is met by blocking" covers only missing or malformed input. Before ADR-0003, a fixture edit affected the next SessionStart only. Now it changes a live gate outcome in the same session. The residual table (lines 70-75) omits this.
- **Current defence:** the ADR-0001 residual "a session with commit access can edit the file". The ADR-0003 residual says story F "narrows this", but the Decision states it as closed.
- **Exposure:** ~100% of Edit/Write/MultiEdit/NotebookEdit writes to the fixture in a wired session. Basis: counted in code (`tool-routing.ts` ROUTES = 2 rows; F1-F4 normalizer-level). Security category, so the rule-21 cap does not apply.
- **Minimal fix (ADR text, before acceptance):** rule 5 and Rules bullet 6 should read: "...MUST be deny-protected on every session write path before the gate is wired: Bash and `mcp__` calls by the gate's deny rules, and the built-in file-edit tools by a `permissions.deny` `Edit(...)` entry in `.claude/settings.json` (Claude Code: "Edit rules apply to all built-in tools that edit files")." Correct Decision line 53 to match. Add a residual row: "a well-formed in-session fixture edit changes the live gate outcome with no record".
- **Proof test (failing until fixed):** `ADR3-fixture-deny-every-write-tool`. Story F's `activation-preconditions` asserts, for the fixture path, that a Bash write (`>`, `tee`, `sed -i`), an `mcp__` call, and the `Edit`/`Write` tools are each denied by a named mechanism, with a seeded mutant per mechanism.

### A2. [ISSUE][MED][demonstrated] The allow-granting trigger reads as a class property; under the ruled posture every new entry is allow-granting (dup of #394, comment added)

- **Assumption:** rule 2 separates "places a tool in a class the gate allows" (fresh report) from "every other entry-only change" (exemption). Residual line 72: "the line between the two kinds is judged by the reviewer".
- **Break:** `src/policy/config/shipped-defaults.json` and `.thoth/policy.json` both have `rules: []`, and `BOOTSTRAP_DEFAULT_OUTCOME = "allow"` (`src/policy/config/bootstrap-ruleset.ts:49`, `loader.ts:284`). AP-1 keeps default allow. So every class is "a class the gate allows". D1/D2 above show `remote-mutating`, the class a reader takes for the deny class, flipping an unlisted server from deny to allow. The only changes left on the light path are removals and raises.
- **Slip path:** `CLAUDE.md:67` still says "adding or removing an entry ... is not, by itself, a change needing a fresh dated review report". The catalog still serves ADR-0001 rule 2 with the same sentence (#390). The ADR-0001 pointer names "rules 1, 4 and 5" and not rule 2 (#391). No instrument computes the outcome change.
- **Exposure:** ~100% of entry-addition PRs after activation. Basis: counted in code (rules arrays empty, bootstrap allow). Medium, not high: the narrowing is still pending the human, the gate is unwired, and "or otherwise lowers a gate outcome" covers it when read correctly.
- **Fix:** state it plainly in the ADR: "Under a default-allow posture, adding any entry is allow-granting (it turns a POL-05 opaque deny into the default outcome)". Name the instrument below.
- **Proof test:** `ADR3-entry-outcome-diff`. For each `centralLayer.tools` name in base or head, compute the gate decision for `mcp__<name>__probe` at base and at head. Fail when any outcome lowers and the diff adds no `docs/reviews/*` file.

### A3. [ISSUE][MED][demonstrated] Rule 4 is not narrowed; it is broadened, and the tree violates it today (dup of #392, comment added)

- **Break:** ADR-0001 rule 4 reads "MUST NOT hardcode an entry of either list **for this allowlist**". ADR-0003 drops the qualifier, adds "test code included", and closes the list to two carve-outs. Scan (literal reading, 206 files under hooks/ and src/):

```text
src/policy/tools/mcp-enumeration.test.ts:62: github
src/policy/tools/mcp-enumeration.test.ts:96: github
src/policy/verification/allowlist.test.ts:48: github
src/qa/vendor-tool-inventory.test.ts:84: claude.ai Gmail
src/secret-scan/history-scan.test.ts:727: github
src/secret-scan/patterns.test.ts:78: github
files scanned=206 hits=6
```

- None of the six encodes a classification. On acceptance the repo is non-conformant with a MUST. Either a conformance triage edits a secret-scan PAT-prefix test, or reviewers learn to ignore the rule (PRINCIPLES rule 9: never silently violated).
- **Exposure:** 5 of 206 files. Basis: counted (scan above).
- **Fix:** restore "for this allowlist" (a literal used as a classification or exemption of that name), or add a third carve-out for a coincidental string not used to classify or exempt. Cite G19 (`src/policy/gate/gate-structure.test.ts:129`) as the existing partial instrument.
- **Proof test:** `ADR3-R4-scan`. The scan above as a test, with each hit either derived from the fixture or listed with a reason. It fails on an unlisted hit.

### A4. [SUSPICION][MED][code-traced] The protection MUST is delegated to an instrument that, as planned, cannot see the fixture

- Plan F2: "the protected-path list is generated from the hook import graph". The fixture is read with `readFileSync` (`src/policy/tools/central-classification.ts:114`), not imported (hook imports at `hooks/pretooluse-kernel-gate.mjs:173-180`). The same holds for `shipped-defaults.json`, `.thoth/policy.json` and `docs/qa/tool-inventory.json`.
- F3's mutant ("remove one deny rule") would not fail for the fixture unless F1 lists it by hand. This is unproven because F is not built. It overlaps the cross-domain report's suspicion.
- **Proof test:** `F3-mutant-drop-fixture-deny`. Delete the fixture's deny rule; `activation-preconditions` must go red.

### A5. [SUSPICION][LOW][demonstrated] The catalog serves the widenings but not the acceptance hold

- `docs/.maat-state.json` `adrCatalog` for THOTH-ADR-0003 serves 6 rules: the MAY widening, the narrowing, the rule 5 scoping, connectors, deny-protection, and rule 4. It does not serve "MUST NOT ship E, F, J ... before the human accepts" or "MUST NOT self-accept"; those are in the body only (lines 23, 65-66).
- The window is mostly closed. The catalog entry carries `status: proposed`, merge is human-only, and the widenings served early (gate reads the fixture, gate records nothing) describe code already on master (`hooks/pretooluse-kernel-gate.mjs:202`, G18). No early action changes code behaviour.
- **Fix:** add the hold as a frontmatter `constraints` line.
- **Proof test:** `ADR3-hold-in-constraints`. The catalog's rules for THOTH-ADR-0003 contain "#308 stories E, F" while status is `proposed`.

### A6. [CLEAN][demonstrated] Loader throws, gate fails closed

```text
--- D3 entry lowering built-in Bash to read-only
pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2). Unlock: a human must fix the tool classification file through a reviewed pull request; retrying will not help. Error type: ClassificationCatalogError
 exit=2
--- D4 malformed fixture   -> same fixed line, exit=2
--- D5 missing fixture     -> same fixed line, exit=2
--- D6 restored            -> exit=0
```

- The ADR's claims on line 44 (`assembleCatalog` throws; exit 2 with the fixed classification unlock text) and on rule 3 (fail closed with fixed-text stderr) hold.
- The lowering guard covers built-in names only. An MCP-entry downgrade is a review matter, covered by A2.

### A7. [CLEAN][code-traced] No environment-selected fixture for the gate

- `moduleRelativeFixtureLocation()` returns `DEFAULT_FIXTURE_PATH` (`classification-catalog.ts:68-70`), which is derived from `import.meta.url` (`central-classification.ts:63`).
- The gate calls only that function (`hooks/pretooluse-kernel-gate.mjs:202`).
- The launcher's project-dir variable selects the whole gate module, not the fixture alone, so it is not a fixture-specific gap.

### A8. [CLEAN][code-traced] Rule 5 scoping does not open a path gap; the gate is write-free

- G18 (`src/policy/gate/gate-structure.test.ts:62-69`) bans file-write APIs in the hook and `src/policy/gate/*`.
- `ALLOWED_SPECIFIERS` (`src/policy/config/sanitize.test.ts:418-419`) refuses `node:fs` in the hook.
- A grep of non-test `src/policy` for write APIs returns 0 hits.
- The fixture path is a module constant, so recording it would add nothing.
- The content-tamper gap is A1, not a rule 5 defect.

### A9. [CLEAN][demonstrated] The ADR's claims about current code are true, with the citation slips under Editorial

`moduleRelativeFixtureLocation`, `assembleCatalog`, `centralLayer.tools` merged at `hooks/pretooluse-kernel-gate.mjs:202`, `ClassificationCatalogError`, and story H's unlock text all exist and behave as stated (A6). The cited compliance tests pass:

```text
node --test src/policy/tools/central-classification.test.ts hooks/sessionstart-tool-enum-fixnow.test.ts src/policy/gate/gate-structure.test.ts src/policy/tools/classification-catalog.test.ts src/policy/config/sanitize.test.ts hooks/pretooluse-kernel-gate-unlock.test.ts
ℹ tests 152
ℹ pass 152
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

## MUSTs that nothing checks

| MUST | Checked by | Gap |
|---|---|---|
| Fresh report when an entry lowers an outcome | nothing | A2, `ADR3-entry-outcome-diff` |
| Fixture deny-protected before wiring | story F, planned | A1 and A4 |
| Tests derive names at run time | G19, for a hand-listed file set only | A3, `ADR3-R4-scan` |
| Not cited for any other allowlist; knownConnectors not described as a control | review only | acceptable for scope-limiting prose |
| Supersede with ADR-0001 when #224 ships | review only | acceptable |

## Editorial (uncounted, verdict-neutral)

- Lines 33 and 98 cite "the AC-3h / AC-3 member-write allow-list" in "the gate structure tests" as the write-free evidence. AC-3h is a JS member-write pin in `src/policy/config/sanitize.test.ts:414-416,606`. The filesystem-write guard is G18 in `src/policy/gate/gate-structure.test.ts:62-69`.
- Compliance line 99 says test-code hardcodes are "checked by review". G19 already derives names from the fixture for `STORY_TEST_FILES`; cite it.
- ADR-0001 pointer (`docs/adr/thoth-0001-central-classification-fixture-standing-exception.md:24`): "rules 1, 4 and 5 are narrowed or scoped". Rule 1 is widened, and rule 2 is also changed (#391).
- Rule 4's "synthetic name" carve-out is not a carve-out: a synthetic name is not an entry of the real lists.

## Scariest unproven assumption, decision, next action

- **Scariest:** that "the gate's deny rules" can make the fixture unwritable by a session. Structurally they cannot reach the Edit tools, and the gate reads the fixture live on every call.
- **Go/no-go:** **no-go** on A1, demonstrated, security.
- **Single next action:** `story-implementer` amends THOTH-ADR-0003, before human acceptance: rule 5 and Rules bullet 6 name every write path (gate rules for Bash and `mcp__`, `permissions.deny` `Edit(...)` for the file tools), Decision line 53 is corrected, and the same-session tamper residual row is added. Then re-run this red team on the amended text.

## Findings to tests

Open findings: 5 (A1-A5). Failing tests named: 5 (`ADR3-fixture-deny-every-write-tool`, `ADR3-entry-outcome-diff`, `ADR3-R4-scan`, `F3-mutant-drop-fixture-deny`, `ADR3-hold-in-constraints`). The numbers match.

RECEIPT: verdict=no-go
attacks:
1. [ISSUE][HIGH][demonstrated] A1 fixture protection scoped to "the gate's deny rules", which never see Edit/Write/MultiEdit/NotebookEdit (gate routes Bash and mcp__ only); a well-formed in-session edit flips POL-05 deny to allow on the next call with no record. Exposure: about 100% of file-tool writes to the fixture in a wired session, basis: counted in code. Issue #395
2. [ISSUE][MED][demonstrated] A2 "class the gate allows" trigger: under empty rules plus bootstrap allow, every new entry (remote-mutating included) is allow-granting (D1/D2); CLAUDE.md:67 and served ADR-0001 rule 2 still exempt additions; no instrument. Dup #394 (commented)
3. [ISSUE][MED][demonstrated] A3 rule 4 drops "for this allowlist" and closes carve-outs; 6 hits in 5 existing test files violate it on acceptance. Dup #392 (commented)
4. [SUSPICION][MED][code-traced] A4 story F's import-graph-generated protected list cannot contain the fixture (readFileSync, not an import); the MUST is delegated to a blind instrument
5. [SUSPICION][LOW][demonstrated] A5 catalog serves 0003's widenings but not its acceptance hold; window closed in practice by status:proposed plus human-only merge
6. [CLEAN][demonstrated] A6 missing, malformed and built-in-lowering fixtures each exit 2 with fixed unlock text
7. [CLEAN][code-traced] A7 gate fixture path is a module constant; no env var selects it
8. [CLEAN][code-traced] A8 gate is write-free (G18, node:fs banned, 0 write APIs in src/policy); rule 5 scoping opens no path gap
9. [CLEAN][demonstrated] A9 ADR's code claims verified; cited compliance tests 152/0/0
counts: issues=3 suspicions=2 clean=4
evidence: demonstrated=6 code-traced=3 derived=0
checks=node --test (6 cited files): 152 pass / 0 fail / 0 skip; gate probes: 11 runs, 11 as expected; rule-4 scan: 206 files, 6 hits
adr=HIT(38)
report=docs/reviews/s308-A-adr-red-team-2026-10-02.md
