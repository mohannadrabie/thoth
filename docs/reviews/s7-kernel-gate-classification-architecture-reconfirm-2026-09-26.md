# Architecture re-confirm (pre-build): s7-kernel-gate-classification, plan revision 2

[architecture-reviewer]
Architecture Reviewer (Imhotep) - reviewing for design coherence

- Date: 2026-09-26. Tier: CRITICAL (Manager-ratified). Stage: pre-build re-confirm of my own REWORK, before `test-writer`.
- Subject: `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md` revision 2, at commit 81028f5 (worktree reset to it, submodule initialised, `git log -1 --oneline` printed 81028f5).
- Prior report (not overwritten): `docs/reviews/s7-kernel-gate-classification-architecture-2026-09-26.md` (PC-1 to PC-7, F1 to F17).
- Also read: `docs/reviews/s7-kernel-gate-classification-design-challenger-2026-09-26.md`, the tail of `docs/plans/s7-kernel-gate-intake-2026-09-26.md`, and the shipped code the encoding touches (`src/policy/normalizer/shell.ts`, `structured-cluster.ts`, `action-catalog.ts`, `registry.ts`, `src/policy/kernel/kernel.ts`, `src/policy/rule/precedence.ts`, `schema.ts`, `src/policy/config/central-source.ts`, `loader.ts`, `hooks/sessionstart-tool-enum.mjs`, `hooks/pretooluse-kernel-gate.mjs`).
- ADR cache line: `📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]`
- Read-only review. Nothing in the repo changed except this report and its log row (the cache reporter touched `docs/.maat-state.json`; restored with `git checkout`).
- Binding rulings honoured, not re-litigated: option Y, gate scope Bash and mcp__ only, marker verb outside KNOWN_VERBS with identity-only targets, injective-or-unresolved lookup, additive 107, scalar-only trust truth, AP-9 to AP-14, no cache.

## Summary

- Verdict: **APPROVE-WITH-CONDITIONS**. Both HIGH findings from the first report (F1, F2) are closed by the revised encoding, verified by running the shipped shell normalizer, cluster normalizer, kernel and merge against a spec model of plan section 4. The design is coherent.
- One new finding is a test-adequacy defect that must be fixed in the plan before `test-writer` authors H11: the forgery tests (N9, H11) use a rule that pairs the marker verb with an identity target, and that shape stays green when the marker guard is deleted (demonstrated). The rule shape operators will actually ship (a class-only allow) is untested, and the plan's predicted red set for mutation M5 is false.
- Seven smaller items (location/catalog split in the shared function, an env asymmetry, the rule-author grammar contract, hardcoded entry names in test specs, a routing conditional, the wording of the #93 closure, plus two carried readings) need plan text or one test each. None needs an ADR amendment.
- Files in plan section 15 touch none of the forbidden files (grep over section 15 exits 1, no match).

## Verdict table (five axes)

| Axis | Verdict | Basis |
|---|---|---|
| 1 Fit | APPROVE | Y plus marker verb solves SUR-03 capability at the stated scale; no gold-plating; the honest limit (nothing denies by class until AP-1) is stated in plan section 2. Wording risk on the #93 closure (N7) |
| 2 Blast radius and coupling | APPROVE-WITH-CONDITIONS | Unwired hook contains blast (hooks keys: SessionStart, UserPromptSubmit only, ran a JSON parse). Coupling of rule authors to the marker grammar is versioned in-repo but invisible out-of-repo (N4). Shared fixture function must keep location resolution separate (N2) |
| 3 Compliance | see ADR table | 0 VIOLATES, 2 AMBIGUOUS carried, 1 new AMBIGUOUS (THOTH-ADR-0001 hardcoded names in test specs), 3 NOT-COVERED carried to the architect queue |
| 4 Cost shape | CONFORMS | No cache, plan-measured p99 254.5 ms (not re-run); additive 107 spawns 1 (English absent), 2 (non-English absent), 1 (present); worst case 10 s |
| 5 Operability | APPROVE-WITH-CONDITIONS | Deploys in pieces (unwired hook is the flag); load failures deny visibly; AP-9 to AP-14 record the recovery, protection and launch-failure gaps |

## ADR and standard compliance (whole catalog, 37 ADRs; devops ADR-0001 to ADR-0010 NOT-APPLICABLE, no infrastructure in scope)

| ADR / standard | Verdict | Operative line and evidence |
|---|---|---|
| SE ADR-0021 "MUST implement the policy kernel as a pure function" | CONFORMS | plan section 15 lists no kernel file; `node src/qa/kernel-purity-check.ts` PASS (4 production files) |
| SE ADR-0021 "MUST NOT add a field outside these seven that the kernel branches on" | CONFORMS (F1, F2 effect now closed) | marker verb and identity target are still `verbs` and `targets`; demonstration D1 shows the shell cannot emit the marker (0 of 13 shapes) |
| SE ADR-0021 "MUST register each per-tool-type normalizer ... by declaration; MUST NOT add a tool type by editing a shared dispatch chain" | CONFORMS for the tool-class registration; NOT-COVERED for runtime tool_name to toolType routing (carried, plan section 17 item 4) | routing table in its own file with G11; a per-toolType conditional may remain in the gate (N6) |
| SE ADR-0021 "MUST NOT let a normalizer return a verdict, or let the kernel inspect a tool identity" | CONFORMS | normalizer returns a record; identity reaches the kernel only as target data |
| SE ADR-0021 field table: `verbs` "from the action catalog", "tool-agnostic" | NOT-COVERED (carried, plan section 17 item 3) | the marker vocabulary is normalizer-owned and outside KNOWN_VERBS by design; the table row is a descriptor, not a MUST line |
| SE ADR-0021 "MUST NOT implement a second decision path anywhere in the system" | AMBIGUOUS (carried, F7) | plan section 4 keeps three enumerated pre-kernel refusals (malformed input, unroutable name, load failure) by Manager ruling R-G; architect reading pending |
| SE ADR-0021 "MUST record thoth own independent verdict for every control named in posture output" (INT-07) | AMBIGUOUS (carried, F3, F5) | P2 wording no longer overclaims; what a "central" label may claim when the classification called central is in-repo stays a queue item |
| THOTH-ADR-0001 "Code under hooks/ and src/ MUST NOT hardcode an entry of either list for this allowlist" | AMBIGUOUS (new, N5) | plan tests H1, H4, G13, M2, H7 type real entry names (github, aws-knowledge-mcp-server) into new test files under hooks/ and src/; the ADR carve-out names only `src/policy/fixtures/allowlist-settings.ts`; existing classification tests use stand-ins (`hooks/sessionstart-tool-enum-fixnow.test.ts:66`) |
| THOTH-ADR-0001 rules 1 and 5, and the "PR diff is the approval" ruling | AMBIGUOUS, routed to the human (Q-C extended, plan section 12) | interim: the gate reads the fixture and records nothing; blocks activation only |
| SE ADR-0002 "MUST define external dependencies as interfaces/ports owned by the inner layer" | CONFORMS | G15 forbids node:* value imports and imports from `src/policy/config/` in the gate directory |
| SE ADR-0003 inject I/O; "SHOULD prefer a new strategy/handler ... when a third variant appears" | CONFORMS | two variants; the third normalizer is the named trigger; the shared function takes an existence probe |
| SE ADR-0005 "MUST NOT delete or weaken a failing test" | CONFORMS with a condition | R-B keeps AC-19, R-F keeps all 16 central-source tests (ran: 16 of 16 pass); the locked AC-2 amendment (Q-B) is a ruled spec change, so the amended assertion must be replaced by the exact empty-stdout assertion (H10 does), not just dropped |
| SE ADR-0006 flag default OFF; "MUST NOT widen scope opportunistically" | CONFORMS | hook stays unwired (S2 check); R7, #303, #304 deferred |
| SE ADR-0010 quality gates | CONFORMS | no test deleted; touched comments corrected (plan section 10) |
| SE ADR-0009 monitoring | CONFORMS by disclosure | no durable verdict trail until S8 (hook header keeps the disclosure) |
| SE ADR-0001 process | CONFORMS | agents propose only; the stale residual row goes through the amendment path |
| SE ADR-0004, ADR-0007, ADR-0008, ADR-0011 to ADR-0015, ADR-0016 to ADR-0020, THOTH-ADR-0002 | NOT-APPLICABLE | no state, tagging, cost, data, plugin-tree or secret-scan surface; ADR-0016 to ADR-0020 are scoped out for this build by the 2026-08-29 decisions row (ADR-0017 and ADR-0018 superseded) |

## PC-1 to PC-7 and F1 to F12: status in revision 2

Legend: CLOSED = the revised plan does what the finding required and a named check proves it; PARTIAL = done in part, remainder named; OPEN = not addressed. No item is OPEN.

| Item | Status | Plan section and check id | Verified against real code |
|---|---|---|---|
| PC-1 (marker verb, identity-only targets, one builder/parser, exact match) | CLOSED | section 4; N3, N4, N5, N6, N8, N9, G13 | yes, run: shell and cluster normalizers cannot emit the marker (D1); N8 structural guard exists, see N1 for the test gap |
| PC-2 (re-express the class rule, drop verb-only allow, add H11, N9-equivalent, G10, N4b-equivalent, G13, M5) | PARTIAL | sections 7, 12; H11, N8, N9, G10, N5, G13, M5 | Y drops the shipped rule (closes F1 as filed). H11 and N9 use a marker-plus-target rule; the predicted red set of M5 is false (N1, D4) |
| PC-3 (scalar-only truth, rule-level peer override, P7, drafted question) | CLOSED | sections 8a, 17; P2, P7, G7 | yes, run (D3): central posture deny plus project allow rule gives posture deny from central and verdict allow; a project redefinition of a shipped mandatory rule wins, mandatory inert |
| PC-4 (additive 107 rewrite of C-suite, 8c, S-5, Q-D) | CLOSED | sections 8c, 3 (S-5, S-7); C1 to C11 | yes: existing 16 tests pass at 81028f5; the Q-E recognised-listing rule holds on the real listing of this host (D5); existing tests stay green under the design by trace |
| PC-5 (load failure through kernel; routing file; gate ports; shared function; test ids off production data) | PARTIAL | sections 4, 9, 15; G11, G14, G15 | routing file, ports and test-id separation done. Load failure through the kernel not adopted (Manager ruling R-G, F7 carried). Shared function shape needs the split in N2 |
| PC-6 (Q-C extended; AP-9 to AP-12) | CLOSED | sections 12, 14 | AP-9 to AP-14 present in the section 14 table |
| PC-7 (decisions rows: no-cache supersedes backlog line 61; additive reading of 107) | CLOSED | sections 7 (D1), 8c, 8d | rows drafted for the Manager, not written into `docs/decisions.md`, as ruled |
| F1 (class namespace forgeable) | CLOSED | section 4; H11, N9, M5 | yes (D1); the shipped rule is moot under Y and the marker is unreachable from the shell; N1 is about the test, not the design |
| F2 (fixture flip detaches central deny) | CLOSED | section 4; G10 | yes, run (D2): identity-keyed central deny survives the flip |
| F3 (allow rules from rank-0 layers) | PARTIAL, accepted by ruling R-E | section 8a; P2, P7, G7; section 17 item 1 | disclosure wording is truthful and P7 documents the behaviour; the enforcement gap (central cannot require its own allow) is accepted and queued, not a defect of this story |
| F4 (C-suite contradicts existing tests) | CLOSED | section 8c; C1 to C11 | yes (16 of 16 existing pass; C10 CMD checks no removed line) |
| F5 (THOTH-ADR-0001 rules 1 and 5) | CLOSED (routing) | section 12 Q-C (a) to (d) | routed to the human as recommended; blocks activation only |
| F6 (routing table outside purity scope) | CLOSED, one gap | section 4; G11, AP-12 | routing file plus scan present; a per-toolType conditional can survive the scan (N6) |
| F7 (pre-kernel refusals) | PARTIAL | sections 4, 9, 17 item 2 | enumerated and limited by ruling; architect reading pending; no test (ADR reading) |
| F8 (unversioned grammar contract) | PARTIAL | section 4; G13, GRAMMAR_VERSION | builder/parser module, golden test and version constant exist; out-of-repo visibility and the rule-author facts are not covered (N4) |
| F9 (activation preconditions) | CLOSED | section 14 AP-9 to AP-12 (plus AP-13, AP-14) | present |
| F10 (hook not thin, duplicated fixture location and catalog) | PARTIAL | sections 4, 15; G14 | one shared function now planned; its return shape conflicts with the SessionStart ordering contract (N2) |
| F11 (longest prefix) | CLOSED | section 3 (S-6), section 4; N3, N4, N5 | yes: exact match, a double underscore in the tool segment is unresolved |
| F12 (gate hygiene) | CLOSED | section 4; G15; test ids not in production data | present |

## Demonstrations run (raw)

Method: Node 24.15.0 native TypeScript stripping, importing the shipped normalizer, kernel and merge modules from this worktree, plus a spec model of the plan section 4 tool-class normalizer written inline (not repo code; the normalizer does not exist yet). Scripts were inline node -e commands, not committed. Illustrative target strings are written without backticks on purpose.

### D1. Can a shell command emit the marker verb? (F1 residual, PC-1)

Marker strings in KNOWN_VERBS: none. 13 shell shapes tried, including the marker in verb position, argument position, flag position, quoted, upper-cased, behind env and bash -c, and as a redirect target:

```
markers in KNOWN_VERBS: []
kubectl tool-class:read-only pods/x --context=c      verbs [] unresolved ["command verb tool-class:read-only"]
TOOL-CLASS:READ-ONLY pods/x --context=c              verbs [] unresolved ["command verb pods/x"]
python evil.py > tool-class:read-only                verbs ["write"] targets ["tool-class:read-only"]
echo x > mcp/docs/x                                  verbs ["write"] targets ["mcp/docs/x"]
env tool-class:read-only get pods/x --context=c      verbs ["get"]
bash -c (quoted kubectl tool-class:read-only ...)    verbs [] unresolved ["command verb tool-class:read-only"]
shell records carrying a marker verb: 0 of 13
cluster raw.verb=marker -> verbs [] unresolved ["verb tool-class:read-only"]
```

The shell normalizer builds verbs only from `resolveVerb` (KNOWN_VERBS) plus the constant write (`src/policy/normalizer/shell.ts:330,393-396`); the structured cluster normalizer does the same (`src/policy/normalizer/structured-cluster.ts:21`). The marker cannot be emitted while it stays out of KNOWN_VERBS. An identity target can be forged by a redirect (a shell record can carry the target mcp/docs/x), so the plan rule "allow rules pair the marker with the identity target; deny rules may be target-only" is correct:

```
posture deny, rule allow verbs [tool-class:read-only] targets [mcp/docs/]
  forged redirect  echo x > mcp/docs/x                      -> deny
  forged marker    kubectl tool-class:read-only pods/x ...  -> deny [POL-05]
  genuine          mcp__docs__x (read-only)                 -> allow [a]
posture deny, rule allow targets [mcp/docs/] (target-only)
  forged redirect  echo x > mcp/docs/x                      -> allow [at]   (documented hazard, N9)
rule deny targets [mcp/github/] (target-only)
  forged redirect  echo x > mcp/github/x                    -> deny [d]     (a forgery only denies)
  genuine          mcp__github__create_issue                -> deny [d]
```

### D2. F2: fixture flip against a central per-server deny

```
central mandatory deny targets [mcp/github/] (identity-keyed, no verb), project class allow
github remote-mutating   -> deny [central-deny-github]
github FLIPPED read-only -> deny [central-deny-github]
other read-only server   -> allow [proj-class-allow]
central deny verbs [tool-class:remote-mutating] targets [mcp/github/] (marker-paired), same flip
github FLIPPED read-only -> allow [proj-class-allow]   (a marker-paired deny follows the classification)
central deny verbs [write, execute] (legacy verbs), posture allow
remote-mutating MCP call -> allow                       (class records carry no legacy verb)
```

The identity-keyed deny survives reclassification (F2 closed, G10 as specified). A rule that pairs the marker follows the fixture by construction, and legacy-verb rules never see class records; the grammar documentation must say so (N4).

### D3. F3 and P7 with the real merge

```
central posture deny, project allow rule on the remote-mutating marker
  posture {"outcome":"deny","source":"central"} voided [] => verdict allow [p-allow]
shipped mandatory rule sur03-x, project redefines the same id (no verbs)
  merged rule sur03-x sourceLayer project, no verbs; inertMandatoryDeclarations [shipped-defaults sur03-x]; voided []
```

P7 and G7 document exactly this; the wording of P2 ("rules from lower-trust layers can still allow") is true.

### D4. Mutation M5 (marker added to KNOWN_VERBS): the predicted red set in the plan is false

Ran the forgery shapes with the marker added to `KNOWN_VERBS` at runtime (it is a real Set), posture deny:

```
CURRENT (marker not in KNOWN_VERBS) | class-only allow: deny POL-05 | paired allow: deny | rm tool-class:read-only a/b --context=c
CURRENT (marker not in KNOWN_VERBS) | class-only allow: deny POL-05 | paired allow: deny | kubectl tool-class:read-only pods/x --context=c
M5 MUTANT (marker in KNOWN_VERBS)   | class-only allow: allow class-allow | paired allow: deny | rm tool-class:read-only a/b --context=c
M5 MUTANT (marker in KNOWN_VERBS)   | class-only allow: allow class-allow | paired allow: deny | kubectl tool-class:read-only pods/x --context=c
```

Under the mutant the shell record for the kubectl shape carries verbs ["tool-class:read-only"]. Plan N9 and H11 use the paired rule (marker plus a target under the mcp/docs/ prefix), which stays deny under the mutant because the forged record has no such target (every attempt to add one trips POL-05: two assembled targets, or a missing resource). So N9 and H11 stay green when the guard is removed. The class-only allow is the rule an operator writes for "allow the read-only class" and the shape AP-1 baseline content would ship.

### D5. Additive 107 (Q-E) on the real host

```
reg query HKLM\SOFTWARE\Policies -> 3 non-blank lines, all under HKEY_LOCAL_MACHINE\SOFTWARE\Policies
recognised (>= 1 anchored line, every line anchored or indented): true; lists Thoth subkey: false
call 1 (query ...\Policies\Thoth /v CentralPolicyJson): status 1, stderr "ERROR: The system was unable to find the specified registry key or value."
```

The Q-E rule works on the one real listing available (English host; the non-English shape stays UNPROVEN, plan U-1). Trace of the existing tests against the plan design: the status-2 test and the no-status test do not trigger the fallback; the access-denied test (a single stub throwing on every call, status 1) triggers call 2, call 2 fails, and the plan rule "rethrow the original error from call 1" keeps the throw assertion green.

### D6. Baselines run

```
node src/qa/kernel-purity-check.ts              PASS: 4 production .ts file(s)
node src/qa/normalizer-registry-purity-check.ts PASS
node --test src/policy/config/central-source.test.ts          tests 16 pass 16 fail 0 cancelled 0 skipped 0
node --test hooks/sessionstart-tool-enum*.test.ts (4 files)   tests 27 pass 27 fail 0 skipped 0
hooks keys in .claude/settings.json: [ SessionStart, UserPromptSubmit ]
grep over plan section 15 for kernel, registry, shell, cluster, precedence, schema, action-catalog, KNOWN_VERBS, shipped-defaults.json, tool-inventory.json, .github, pin.ts, halt-relay: exit 1 (no match)
grep -E of section 7 table rows by prefix: C 11, D 2, G 17, H 11, L 4, M 7, N 12, P 7, S 5 = 76 (matches the plan receipt)
```

## Findings, ranked by exposure x irreversibility x silence

### N1. [ISSUE][MED][demonstrated] N9 and H11 cannot detect removal of the marker guard; the predicted red set of M5 is false

- Plan N9 and H11 use a rule that pairs the marker with a target under the mcp/docs/ prefix. D4 shows the paired rule stays deny when the marker is added to KNOWN_VERBS, so neither test goes red under mutation M5. Only N8 (structural: no marker in KNOWN_VERBS, disjoint from corpus verbs) goes red. The plan lists the red set of M5 as N8, N9, H11 (design-challenger PT-11 requires predicted red sets to be true).
- The dangerous shape is the class-only allow (marker verb, no targets): under the mutant `rm tool-class:read-only a/b --context=c` is allowed by it (D4). This is the shape the F1 fix exists to protect and the one activation content will ship.
- Exposure: ~100% of shell calls of that shape once activated and once the guard regresses (0% today: hook unwired, guard intact), basis: counted-in-code (D4). Only one instrument (N8) stands between a one-line edit and this defect. MED because the guard is intact today and N8 covers the edit; the severity is for the test-plan gap only.
- Silent: yes (a green suite).
- Failing test that closes it: N9b and H11b, "class-only marker allow rule (no targets), posture deny: Bash rm tool-class:read-only a/b --context=c and kubectl tool-class:read-only pods/x --context=c are denied (strict helper); mcp__docs__x not denied", with the predicted red set of M5 corrected to N8, N9b, H11b.

### N2. [SUSPICION][MED][derived] The shared fixture function must not fuse location resolution with fixture loading

- Plan section 4 and G14: one shared function returns "location, fixture and merged catalog", used by SessionStart. SessionStart resolves the fixture location once, before stdin is read, precisely so the catch path can still record it when fixture loading throws (`hooks/sessionstart-tool-enum.mjs:386-390`, the comment block at `hooks/sessionstart-tool-enum.mjs:526-545`; the catch writes `fixtureLocation` into halt-state). A single function that also loads the fixture throws before it returns the location, so the recorded path degrades to unknown on exactly the failure path THOTH-ADR-0001 rule 5 ("never silent") was written for.
- No locked test pins this: the tests that assert `fixturePath` cover the unclassified-tool halt only (`hooks/sessionstart-tool-enum-fixnow.test.ts:400-450`); the malformed-fixture test at line 172 asserts the detail text, not the path. The swap could turn a SessionStart test red or, worse, leave them green while dropping the path (baseline today: 27 of 27 pass).
- Also: `projectDir()` (CLAUDE_PROJECT_DIR else cwd) is a second derivation each hook repeats; export it from the shared module.
- Failing test that closes it: G14b, "the shared module exports a pure, non-throwing location function separate from catalog assembly; with a malformed fixture the location is still returned and a SessionStart run records fixturePath in halt-state".

### N3. [SUSPICION][MED][derived] UNPROVEN-pending-verification: the gate loader is env-immune, its fixture path is env-controlled

- The plan builds the loader with module-relative shipped and project paths (env-immune, as print-cli.ts) but the fixture through the shared function, which takes CLAUDE_PROJECT_DIR. Issue #99 (closed) was closed on the principle that no session-reachable ambient signal decides which policy source a fail-closed gate trusts; CLAUDE_PROJECT_DIR was accepted as the seam because in real invocations it points at the same tree (comment block at `hooks/sessionstart-tool-enum.mjs:434-475`). Under the gate the fixture becomes rule input, so the asymmetry needs a decision: either the gate resolves the fixture module-relative too (the copy-tree sandbox S-8 already copies the fixture, so H4 and H7 do not need CLAUDE_PROJECT_DIR), or a settled proof that a gitignored settings.local.json env block cannot override CLAUDE_PROJECT_DIR for hook processes.
- I could not run this: it needs a real Claude Code session. Settling command: scratch project, a settings.local.json with an env entry setting CLAUDE_PROJECT_DIR to a different directory, and a PreToolUse hook that prints process.env.CLAUDE_PROJECT_DIR; owner: Manager or implementer at activation (add to plan section 18 as U-9 and to the evidence of AP-8).
- No executable form now; resolves to the U-9 line.

### N4. [SUSPICION][MED][demonstrated] The rule-author grammar contract still has undocumented facts (F8 residual, NOT-COVERED)

Facts demonstrated above or read in code; each belongs in the header of the planned tool-class-format.ts and in G13b:

- Class records carry no legacy verb (write, execute), so a central deny keyed on write or execute does not see workspace-mutating or remote-mutating tool calls (D2, last block). Rule authors will assume canonical verbs span all mutating actions.
- An identity-keyed deny survives reclassification; a marker-paired deny follows the fixture (D2). The grammar must say which shape a central author writes for "this server is always denied".
- The rule schema accepts any string in `verbs` (`src/policy/rule/schema.ts:189`); a typo in a marker or target inside a central deny rule silently never matches and falls to the posture or an allow rule. No load-time diagnostic exists (schema.ts is out of scope; a printer line is a backlog item).
- GRAMMAR_VERSION is a constant in-repo; out-of-repo central authors cannot see it and a rule carries no version. State that a bump requires a decisions row plus a central-rule migration note, and that markers are append-only (never renamed).
- Vocabulary ownership (normalizer-owned verbs beside "verbs from the action catalog") remains NOT-COVERED for the architect (plan section 17 item 3).
- Failing test that closes it: G13b, "rule-shape facts pinned: a legacy-verb deny does not match a class record; an identity-keyed deny survives a fixture flip; a marker-paired deny does not; GRAMMAR_VERSION is exported and asserted".

### N5. [SUSPICION][MED][derived] Test specs type real fixture entry names (THOTH-ADR-0001, AMBIGUOUS)

- Operative line: "Code under hooks/ and src/ MUST NOT hardcode an entry of either list for this allowlist; the hooks load the entries from docs/qa/s5-central-classification.json at runtime." Plan H1, H4 (the aws-knowledge runtime name with the triple underscore), H7, G13 ("the real committed fixture entry github") and M2 name real entries in new files under hooks/ and src/. The ADR carve-out lists only `src/policy/fixtures/allowlist-settings.ts`. Existing classification tests use stand-ins (`hooks/sessionstart-tool-enum-fixnow.test.ts:66`). Whether test code counts as "code" is not decided by the ADR (escalate; do not invent).
- Cheap conformant form: derive names from the fixture at run time (as N4 already does) or use stand-ins; the triple-underscore runtime-name case becomes the first fixture entry name plus a tool segment holding a triple underscore.
- Failing test that closes it: G19, "no new test file introduced by this story contains a literal name from `docs/qa/s5-central-classification.json`" (source scan derived from the fixture).

### N6. [SUSPICION][LOW][derived] A per-toolType conditional in the gate can survive G11

- Plan section 4: the routing table is "the routing data, nothing else" and decide-tool-call.ts will "on Bash check tool_input.command" and call loadCatalog() "only for tool-class calls". Building the raw call and deciding whether to fetch the catalog differ per tool type, so an if on the toolType string lives in the gate, outside the table, and G11 (no switch, no literal Bash or mcp__ outside the routing file) does not see it. At two variants ADR-0003 allows it; the plan text says otherwise.
- Fix: the routing row carries the raw-call builder and a catalog requirement flag, or G11 also forbids the toolType literals shell and tool-class outside the routing file.
- Failing test that closes it: G11b, "the gate directory has no string literal shell or tool-class outside tool-routing.ts".

### N7. [SUSPICION][LOW][derived] D2 says #93 gets a RESOLVED note; section 2 says nothing denies by class until AP-1

- Issue #93 asks that classification drive enforcement. Under Y it becomes rule-matchable, not enforcing. A RESOLVED note (and a Closes reference) would drop the only tracker of the remaining gap. Word it as capability delivered, enforcement content tracked by AP-1, and keep #93 open or close it with an explicit link to the AP-1 owner. No test (a documentation claim).

### F7 carried. [SUSPICION][MED][derived] Pre-kernel refusals: second decision path (AMBIGUOUS, architect)

- Plan section 4 keeps three enumerated refusals by ruling R-G; plan section 17 item 2 queues the reading. Unchanged from the first report. No test (an ADR reading).

### F3 carried. [SUSPICION][MED][demonstrated] A rank-0 allow rule overrides a central posture deny (accepted by R-E)

- D3 reproduces it with the real merge. The plan discloses it (P2, P7, G7) and queues the allow-list-only central mode (section 17 item 1) and the INT-07 wording (item 5). Accepted trade-off, not a defect of this story. No new test (P7 documents it and is green by design).

### Clean findings

- [CLEAN][demonstrated] F1 and F2 closed by the revised encoding: marker unreachable from the shell and cluster normalizers (0 of 13 shapes); identity-keyed central deny survives a fixture flip (D1, D2).
- [CLEAN][demonstrated] The additive 107 design is a coherent two-path absent detection: English fast path unchanged (1 spawn); the fallback downgrades only on status 1 plus a recognised listing that lacks the Thoth subkey, and rethrows the original on any other outcome; the Q-E rule holds on the real listing; the existing 16 tests stay green by trace (D5). Note for the decisions row: the English path treats "key present, value missing" as absent (ratified behaviour) while the fallback rethrows it (key listed); the direction is fail-closed.
- [CLEAN][code-traced] Plan section 15 touches none of the forbidden files (kernel, registry, shell, cluster, precedence, schema, KNOWN_VERBS, settings hooks keys, existing central-source tests, shipped defaults, fixture entries); notes text and comment lines only in the fixture and settings.json.
- [CLEAN][demonstrated] The criteria count of 76 in the plan matches a script over the section 7 rows (D6); the SessionStart locked tests pass 27 of 27 at baseline.
- [CLEAN][derived] Closed by the plan with no remaining gap: F4, F5 (routing), F6 (except N6), F9, F11, F12, PC-6, PC-7.
- [CLEAN][derived] Whole-catalog ADR collision sweep (37): no VIOLATES; no new collision beyond N5 and the carried readings; the ADR-0005 condition is stated in the table.

## Open findings to failing tests (one to one)

Pre-build: "failing" means a named test the plan must contain that is red against revision 2 and green once the change lands.

| Finding | Test | Where |
|---|---|---|
| N1 | N9b and H11b (class-only marker allow; forged rm with the marker as verb denied; M5 red set corrected) | H11b by test-writer, N9b by implementer |
| N2 | G14b (location function separate and non-throwing; SessionStart records fixturePath on a malformed fixture) | implementer |
| N4 | G13b (rule-shape facts, GRAMMAR_VERSION asserted) | implementer |
| N5 | G19 (no fixture entry name literal in the new test files) | implementer |
| N6 | G11b (no toolType literal outside the routing file) | implementer |
| N3 | none: needs a real Claude Code session; settle with U-9 | residual line |
| F7 | none: ADR reading | architect queue |
| F3 | none: accepted by ruling R-E, documented by a passing P7 | residual line |
| N7 | none: documentation claim | plan edit |

Open findings 9 (1 ISSUE, 8 SUSPICION); failing tests 5 (N1, N2, N4, N5, N6 each map to one named check; the check for N1 is two rows, N9b and H11b, one behaviour at two layers). The four without an executable form are N3 (needs a real runtime), F7 (an ADR reading), F3 (an accepted trade-off documented by a passing test) and N7 (a wording claim).

## NOT-COVERED and AMBIGUOUS work queue (the architect)

| # | Kind | Item | From |
|---|---|---|---|
| 1 | NOT-COVERED | Runtime tool_name to registry toolType routing declaration (table now, registration-time declaration at the third normalizer) | F6, N6 |
| 2 | NOT-COVERED | Normalizer-owned verb vocabulary (class marker verbs) beside "verbs from the action catalog"; ownership and versioning of the rule-author grammar | F1, F8, N4 |
| 3 | AMBIGUOUS | Whether enumerated pre-kernel refusals are a "second decision path" | F7 |
| 4 | AMBIGUOUS | THOTH-ADR-0001: rules 1 and 5, the PR-diff ruling (human), and whether test code counts as "code" for the no-hardcoded-entry rule | F5, N5 |
| 5 | AMBIGUOUS | INT-07 wording of a "central" posture line | F3 |
| 6 | NOT-COVERED | Central cannot require its own allow (POL-07 extension) | F3 |
| 7 | Human | CLAUDE.md sensitive areas still names the deleted hooks/report-subject-gate.mjs | plan |

## Exact plan changes required before test-writer runs

| # | Change | Findings |
|---|---|---|
| PC-8 | Section 7: add N9b and H11b (class-only marker allow, forged marker-in-verb-position shell calls with a non-kubectl binary denied under a strict helper); correct the predicted red set of M5 to N8, N9b, H11b. Do this before test-writer authors H11 | N1 |
| PC-9 | Section 4 and G14: two exports, a pure non-throwing location function (resolved before stdin, available to the catch path) and a catalog assembly function; export the project-dir derivation; add G14b | N2 |
| PC-10 | Section 4 grammar header and G13: state the rule-author facts in N4; add G13b; record that a GRAMMAR_VERSION bump needs a decisions row | N4 |
| PC-11 | Section 7 H1, H4, H7, G13, M2: derive entry names from the fixture (or stand-ins); add G19; add the human question (whether test code counts) to Q-C | N5 |
| PC-12 | Section 4 routing row: carry the raw-call builder and catalog flag, or add G11b | N6 |
| PC-13 | Section 7 D2: word the #93 note as capability delivered, enforcement content tracked by AP-1 | N7 |
| PC-14 | Section 18: add U-9 (CLAUDE_PROJECT_DIR override through a settings env block); the Manager decides whether the gate resolves the fixture module-relative | N3 |

PC-8 and PC-11 change what test-writer authors (H11, H1, H4, H7) and must land first; PC-9, PC-10, PC-12, PC-13 and PC-14 are plan text or implementer-owned tests and can land in the same revision.

## What this story must still NOT do

- Add a PreToolUse entry or change the hooks object in .claude/settings.json (S2 keeps it as a check).
- Touch the kernel files, registry.ts, shell.ts, structured-cluster.ts, precedence.ts, schema.ts, or add the marker verbs to KNOWN_VERBS (N8 and the N1 tests guard the last one).
- Edit a fixture entry or docs/qa/tool-inventory.json; add a cache; give the gate a write path.

## Evolution path

- This story: consumer, encoding, preconditions; hook unwired; no shipped policy content.
- Separate stories: AP-1 baseline content with AP-10 protection; AP-2 inventory refresh; AP-3 connectors; fix #303 and #304 before activation; activation (AP-4, AP-5, AP-6, AP-7, AP-11).
- Later: the third normalizer replaces the routing table with registration-time declaration; an allow-list-only central mode; an out-of-repo classification source (Issue #224) ends THOTH-ADR-0001.

## Editorial (verdict-neutral)

- Plan section 8c should spell the parent path form as HKEY_LOCAL_MACHINE expanded (the form the real listing prints), not the HKLM argument; C9 pins the real bytes.
- The Q-E ack should be recorded in the decisions row (the plan says it proceeds unless overruled).
- This review ran against a plan and a spec model; the built normalizer does not exist yet, so every finding above is pre-build and cheap.

## Next single action

Manager: return revision 2 to story-implementer for PC-8 to PC-14 in one small revision (PC-8 and PC-11 first because they change the test-writer input), then dispatch test-writer. The planned round-2 design-challenger pass (plan section 16) should attack the mutation drill of N1 on the real hook.

Duplicate-issue check (gh issue list, all states): no existing issue matches N1 exactly; it is the proof-test adequacy of Issue #299 (H11), so it is filed as a comment there. Status comments on #300, #301 and #302. No new Issue was created.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] N1 forgery tests N9/H11 use a marker-plus-target rule that stays green when the marker is added to KNOWN_VERBS; the M5 predicted red set is false; the class-only allow lets rm tool-class:read-only a/b --context=c through under the mutant; Exposure: ~100% of that call shape once activated and the guard regresses (0% today), basis: counted-in-code; test N9b/H11b
2. [SUSPICION][MED][derived] N2 shared fixture function fuses location with fixture load; SessionStart resolves location before stdin so the catch path can record it (hooks/sessionstart-tool-enum.mjs:386-390); no locked test pins it; test G14b
3. [SUSPICION][MED][derived] N3 gate loader is env-immune but the fixture path takes CLAUDE_PROJECT_DIR; UNPROVEN-pending-verification (U-9: settings.local.json env override in a real session)
4. [SUSPICION][MED][demonstrated] N4 rule-author grammar: legacy-verb rules do not see class records, marker-paired deny follows the fixture, schema accepts any verb string (schema.ts:189), GRAMMAR_VERSION invisible out-of-repo, vocabulary ownership NOT-COVERED; test G13b
5. [SUSPICION][MED][derived] N5 THOTH-ADR-0001 "MUST NOT hardcode an entry" vs real entry names typed in H1/H4/H7/G13/M2 (AMBIGUOUS whether test code counts); test G19
6. [SUSPICION][MED][derived] F7 carried: pre-kernel refusals as a second decision path (AMBIGUOUS, architect queue); no test
7. [SUSPICION][MED][demonstrated] F3 carried: rank-0 allow rule overrides a central posture deny (real merge rerun); accepted by ruling R-E, documented by P7; no new test
8. [SUSPICION][LOW][derived] N6 per-toolType conditional in decide-tool-call can survive G11; test G11b
9. [SUSPICION][LOW][derived] N7 D2 "#93 RESOLVED" contradicts "nothing denies by class until AP-1"; wording fix
10. [CLEAN][demonstrated] F1/F2 closed: marker unreachable from shell and cluster normalizers (0 of 13 shapes); identity-keyed central deny survives fixture flip
11. [CLEAN][demonstrated] additive 107 coherent: Q-E rule holds on the real reg listing, existing 16 tests pass and stay green by trace, fail-closed direction
12. [CLEAN][code-traced] plan section 15 touches none of the forbidden files (grep exit 1); comment and notes edits only
13. [CLEAN][demonstrated] criteria count 76 matches a script over section 7; SessionStart locked tests 27 of 27 pass at baseline
14. [CLEAN][derived] F4, F5 routing, F6 (except N6), F9, F11, F12, PC-6, PC-7 closed in revision 2
15. [CLEAN][derived] whole-catalog ADR collision sweep (37 ADRs): no VIOLATES
counts: issues=1 suspicions=8 clean=6
evidence: demonstrated=6 code-traced=1 derived=8
checks=pass 16/0/0 (central-source), 27/0/0 (sessionstart hooks, 4 files), kernel-purity PASS, registry-purity PASS, section-7 count 76; 6 inline demonstration scripts (marker leak, rule shapes, F2 flip, F3 merge, M5 mutant, real reg listing) output quoted; UNPROVEN: non-English reg listing (U-1), CLAUDE_PROJECT_DIR env override (U-9)
adr=HIT(37)
report=docs/reviews/s7-kernel-gate-classification-architecture-reconfirm-2026-09-26.md
