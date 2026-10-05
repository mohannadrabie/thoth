# Red team round 2: #308 story A, THOTH-ADR-0003 fix round (delta only)

[red-team] Red Team (Sutekh), CRITICAL tier, re-attacking the s308-A fix round.

- **Scope:** `git diff 07e88f3..af9285f`, ADR text only: `docs/adr/thoth-0003-central-classification-fixture-as-gate-input.md` and the pointer on `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md:24`. Story B files in the same commit are out of scope. Round 1: `docs/reviews/s308-A-adr-red-team-2026-10-02.md` (committed f1edacc).
- **HEAD reviewed:** af9285f. One experiment ran in a detached scratch worktree at af9285f, removed afterwards (`git worktree list` shows the main checkout only). The shared tree was not modified except for this report and the REVIEW_LOG row.
- **ADR cache:** `📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog — ≈18800 tokens saved this pass (fp 702b16a) [CACHE=HIT]`.
- **Verdict:** **go.** All five asks (a)-(e) are met in the ADR text, and the new code claims check out. Three suspicions remain, owned by stories F and K, not by this ADR. None blocks A.

## The five asks

### C1 (a). [CLEAN][code-traced] Every session write path is named, with a same-session tampering row

- Constraint 6 and Rules bullet 7 cover both paths: Bash and `mcp__` through the gate's deny rules (story F), and Edit, Write, MultiEdit and NotebookEdit through a `permissions.deny` `Edit(...)` entry (story K).
- New sentence: "MUST NOT state or imply that the gate's deny rules alone make the file unwritable."
- New residual row: "Same-session content tampering".
- **Context claim checked:** "The gate routes only `Bash` and `mcp__*`" matches `src/policy/gate/tool-routing.ts:8-9`. Round 1 demonstrated the Edit and Write refusals.
- **Mechanism checked against vendor docs.** From the permissions page: "`Edit` rules apply to all built-in tools that edit files", and Edit deny rules also cover recognised Bash file commands (`sed`, `tee`) and redirection targets. From the permission-modes page: "Deny rules block in every mode, including `bypassPermissions`." So the AP-11 bypass posture does not void the Edit deny.
- Round-1 A1 (#395) is resolved in text.

### C2 (b). [CLEAN][demonstrated] The fresh-report trigger is stated by effect

- Constraint 3 and the Decision require a report for "every entry ADDITION, and every label change that can change the gate's outcome for some call". They also state "Under the current posture (rules [] and fallback allow) every addition is allow-granting", and that the class name does not change this. That matches round-1 D1/D2.
- **New claim attacked:** "A removal ... can only turn a listed server back into an opaque, denied one". My hypothesis was that removing one of two same-name entries with different classes would un-collide the name and lower the outcome. Disproved:

```text
--- R1 github listed twice, different classes
 exit=0
--- R2 after REMOVING one of the two github entries
 exit=0
```

  The merge layer resolves the duplicate before `buildServerIndex` sees it, so the name never goes opaque, and removing the duplicate changes nothing. The claim survives.
- The label-change judgement still rests on review once story E adds rules. That is disclosed in residual row 3 ("holds by discipline") and is not counted.
- #394 is resolved in text.

### C3 (c). [CLEAN][demonstrated] "For this allowlist" is kept, and every site is triaged

- Rules bullet 6 and the code constraint restore "as an entry of this allowlist" and add three named non-violations.
- I checked each triage row against the code:

| Site | What the code shows |
|---|---|
| `src/qa/vendor-tool-inventory.test.ts:84` | a scrubber input; the test asserts that `mcp__` names are stripped |
| `src/policy/tools/mcp-enumeration.test.ts:62` | `extractMcpServerNames` output |
| `src/policy/verification/allowlist.test.ts:48` | the SUR-04 allowlist |
| `src/secret-scan/*` | PAT prefix |

- Scan rerun: `files scanned=206 hits=6`, the same set as round 1. `src/`, `hooks/` and the fixture are unchanged at af9285f.
- #392 is resolved in text.

### C4 (d). [CLEAN][code-traced] Story F must name the fixture explicitly, with a mutant test

- Constraint 7 and Rules bullet 8 require both.
- Compliance names `F3-mutant-drop-fixture-deny`.
- The stated reason, "read with readFileSync, not imported", matches `src/policy/tools/central-classification.ts:114`.

### C5 (e). [CLEAN][demonstrated] The acceptance hold is served by the catalog

```text
status proposed rules 9
8 Hold: #308 stories E, F, J and K, and the .claude/settings.json PreToolUse entry, MUST NOT ship before the hum...
```

### C6. [CLEAN][code-traced] The precedence constraint quotes real sentences

- The displaced sentence exists verbatim in two places: the security constraint at `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md:13` and Rules for agents at `:53` ("MUST NOT be held for a fresh dated review report").
- The "Inert classification" row exists at `:71`.
- #390 and #391 are resolved in text.

## Remaining suspicions (owned by stories F and K, not blocking A)

### S1. [SUSPICION][MED][code-traced] Nothing checks the Edit half of the protection

- The ADR now requires a `permissions.deny` `Edit(...)` entry before wiring, shipped with story K.
- No check verifies it:
  - No non-test file under `src/qa/` mentions `permissions` (grep: 0 files).
  - No file under `src/qa/` contains `Edit(`.
  - Story K's criteria (`docs/plans/s308-activation-phase0-2026-10-02.md:148-153`) are K1 (decisions row) and K2 (the four `qa:gate-*` checks). None of the four reads `permissions.deny`.
  - `.claude/settings.json` has no Edit deny today.
- **Scenario:** K's settings PR adds the PreToolUse entry, and the `Edit(...)` line is dropped in a rebase. Every check stays green, and the fixture is Edit-writable under a live gate.
- **Proof test:** `K3-edit-deny-covers-fixture`. When `.claude/settings.json` carries the gate's PreToolUse entry, `permissions.deny` must contain an `Edit(...)` rule matching `docs/qa/s5-central-classification.json`. Seeded mutant: delete the rule; the check goes red.

### S2. [SUSPICION][MED][code-traced] The other AP-10 paths have the same Edit-tool gap

- Round-1 A1's root cause is that the gate never sees the built-in file tools (`tool-routing.ts:8-9`). That applies to every AP-10 path, not only the fixture:
  - the gate's own code (`hooks/pretooluse-kernel-gate.mjs`, `src/policy/**`);
  - `src/policy/config/shipped-defaults.json` and `.thoth/policy.json`;
  - `.claude/settings.json`, which will carry the Edit deny itself.
- Story F's F1 still reads "Deny rules protect ... settings files" through the gate's rules.
- In bypass mode, writes to `.claude` are not prompted (permission-modes doc). Only a deny rule holds.
- ADR-0003 rightly scopes itself to the fixture, so this is story F's to close.
- **Proof test:** `F5-ap10-paths-edit-deny`. For every path in F's protected list, an `Edit(...)` deny entry exists. Seeded mutant per path.

### S3. [SUSPICION][LOW][code-traced] For mcp__ calls the gate cannot match a file path

- The tool-class normalizer's target is `mcp:<server>/<tool>` (`src/policy/normalizer/tool-class-format.ts:128-131`). The `mcp__` route never passes `tool_input` (`src/policy/gate/tool-routing.ts`, mcp row).
- A gate deny rule can therefore refuse an MCP server, tool or class, but never "an MCP write to the fixture path". The Decision's "both together close the session write paths this ADR knows of" holds for MCP only through server and class rules plus the reviewed-addition control.
- Exposure is not measured: no one has checked which listed servers can write local files. Recommendation: measure it, then reword "mcp__ calls by the gate's deny rules" to "mcp__ calls by server- or class-level deny rules and the reviewed-addition control".
- **Proof test:** `ADR3-mcp-local-write-inventory`. A recorded per-server answer for whether each listed server can write a local file.

## Editorial (uncounted)

- None new in the ADR delta.

## Scariest unproven assumption, decision, next action

- **Scariest:** that the Edit deny will actually be present when the gate goes live. The ADR now requires it, but no check fails if it is missing (S1).
- **Go/no-go:** **go** for story A. The ADR text is ready for the human's accept or decline.
- **Single next action:** the Manager adds `K3-edit-deny-covers-fixture` to story K's criteria and `F5-ap10-paths-edit-deny` to story F's, then puts THOTH-ADR-0003 in front of the human for acceptance.

## Findings to tests

Open findings: 3 (S1-S3). Named tests: 3 (`K3-edit-deny-covers-fixture`, `F5-ap10-paths-edit-deny`, `ADR3-mcp-local-write-inventory`). The numbers match.

RECEIPT: verdict=go
attacks:
1. [SUSPICION][MED][code-traced] S1 Edit-half of fixture protection unchecked: no qa check or story K criterion reads permissions.deny; a dropped Edit(...) line ships green under a live gate (test K3-edit-deny-covers-fixture; commented on #395)
2. [SUSPICION][MED][code-traced] S2 same Edit-tool gap on the other AP-10 paths (gate code, policy files, settings.json carrying the deny); story F F1 still relies on gate rules (test F5-ap10-paths-edit-deny; commented on #395)
3. [SUSPICION][LOW][code-traced] S3 gate cannot path-match an mcp__ write (target is mcp:server/tool, tool_input unread); MCP protection is server/class-level only, exposure unmeasured
4. [CLEAN][code-traced] C1 (a) every session write path named (gate rules + permissions.deny Edit, which per vendor docs covers all file-edit tools and holds in bypassPermissions); same-session tamper row added; #395 resolved in text
5. [CLEAN][demonstrated] C2 (b) trigger stated by effect; removal claim survives a duplicate-name attack (R1/R2 both allow); #394 resolved in text
6. [CLEAN][demonstrated] C3 (c) "for this allowlist" restored; triage verified per site; scan 206 files, same 6 hits; #392 resolved in text
7. [CLEAN][code-traced] C4 (d) story F must name the fixture explicitly with mutant F3; readFileSync claim true (central-classification.ts:114)
8. [CLEAN][demonstrated] C5 (e) catalog serves 9 rules for THOTH-ADR-0003, rule 8 is the acceptance hold
9. [CLEAN][code-traced] C6 precedence sentences exist verbatim (thoth-0001 :13, :53, :71); #390/#391 resolved in text
counts: issues=0 suspicions=3 clean=6
evidence: demonstrated=3 code-traced=6 derived=0
checks=gate probes in scratch worktree: 2 runs (duplicate-removal hypothesis disproved, 2/2 allow); rule-4 scan: 206 files, 6 hits (unchanged); catalog query: 9 rules, hold present; src/qa permissions grep: 0 files
adr=HIT(38)
report=docs/reviews/s308-A-adr-red-team-round2-2026-10-02.md
