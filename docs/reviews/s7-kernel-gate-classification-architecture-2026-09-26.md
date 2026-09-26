# Architecture review (pre-build): s7-kernel-gate-classification

[architecture-reviewer]
Architecture Reviewer (Imhotep) - reviewing for design coherence

- Date: 2026-09-26. Tier: CRITICAL (Manager-ratified). Stage: pre-build, before `test-writer`.
- Subject: the Phase 1 plan and the intake record with its "Manager rulings after the Phase 1 plan" table, at commit 0a485b3 (branch feat/s7-kernel-gate-classification). Ruling in force: #107 is ADDITIVE (keep `isNotFoundError`, `NOT_FOUND_PATTERNS` and their tests; add a locale-independent check for the case the text match does not classify).
- Code read: `hooks/pretooluse-kernel-gate.mjs`, the kernel files under `src/policy/kernel/`, the normalizer files registry.ts, shell.ts, structured-cluster.ts, target-format.ts, action-catalog.ts, the rule files precedence.ts and schema.ts, the config files loader.ts, central-source.ts, shipped-defaults.json, print-cli.ts, bootstrap-ruleset.ts, the files under `src/policy/tools/`, `docs/qa/s5-central-classification.json`, `.thoth/policy.json`, the fixture resolution in `hooks/sessionstart-tool-enum.mjs`, the S6 decisions rows, Issue #288 and its comments.
- ADR cache line: `📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]`
- Read-only review. Nothing in the repo changed except this report and its log row.

## Summary

- Verdict: **REWORK** (targeted). The module boundary, the kernel zero-diff route, the no-cache latency decision and the additive #107 direction hold. The class encoding in section 4 of the plan does not hold: two HIGH findings, both demonstrated by running the shipped normalizer, kernel and merge code against the plan encoding and rule text.
- Both HIGH findings share one root cause and one fix: the class is written into the `targets` string inside the tool-identity path, and the seven fields carry no emitter binding. Another normalizer can forge the string, and an in-repo fixture edit can move a tool out from under a central rule.
- Nothing here needs an ADR amendment to fix. Section 4, the Q-A rule text, the C-suite and section 14 of the plan change. If test-writer runs first, the H, N and G tests get authored against the wrong grammar.

## Verdict table (five axes)

| Axis | Verdict | Basis |
|---|---|---|
| 1 Fit | REWORK | Solves SUR-03 at the stated scale, but class-in-targets is not a safe rule-author channel (F1, F2). No gold-plating found. Under-build: activation preconditions missing (F9) |
| 2 Blast radius and coupling | APPROVE-WITH-CONDITIONS | The unwired hook contains the blast (no PreToolUse entry in `.claude/settings.json`). Single points of failure named: the loader, `reg.exe`, and three files on the hook path, all deny on failure. Coupling of posture, allow rules, fixture and rule authors to one string grammar is the open item (F2, F3, F8) |
| 3 Compliance | see the ADR table below | 3 AMBIGUOUS, 2 NOT-COVERED, and one CONFORMS-in-letter whose effect breaks the ADR field descriptors (F1, F2) |
| 4 Cost shape | CONFORMS | Measured by the plan (not re-run here): p99 254.5 ms against a 2000 ms ceiling. Unbounded variable named in F13 |
| 5 Operability | APPROVE-WITH-CONDITIONS | Deploys in pieces (the unwired hook is the flag). Failure degrades visibly (deny with layer and kind). No in-session recovery path when the load fails (F9) |

## ADR and standard compliance (whole catalog; devops ADR-0001 to ADR-0010 are NOT-APPLICABLE, no infrastructure in scope)

| ADR / standard | Verdict | Operative line and evidence |
|---|---|---|
| SE ADR-0021 "MUST implement the policy kernel as a pure function" | CONFORMS | the plan shows zero kernel diff; node src/qa/kernel-purity-check.ts PASS (4 production files) |
| SE ADR-0021 "MUST NOT implement a second decision path anywhere in the system" | AMBIGUOUS (F7) | the plan puts LoadFailure to deny and non-string input to deny in a new gate module, outside the kernel. The shipped hook already does the same for non-Bash input (`hooks/pretooluse-kernel-gate.mjs:92`). The ADR does not say whether pre-kernel input refusals count |
| SE ADR-0021 "MUST deny a mutating action whose Action record has source: opaque or a non-empty unresolved" | CONFORMS | unclassified maps to opaque plus unresolved; `src/policy/kernel/kernel.ts:73` makes any non-empty `unresolved` mutating and `src/policy/kernel/kernel.ts:93` denies it before any rule |
| SE ADR-0021 "MUST NOT add a field outside these seven that the kernel branches on" | CONFORMS in letter; effect breaks the ADR field descriptors | the ADR table calls `verbs` "tool-agnostic" and `targets` "normalized resource references ... tool-agnostic". Route (a) puts tool identity and class into `targets` and reuses `read`, `write`, `execute` with a different meaning. No eighth field exists, but the channel is forgeable (F1) and unstable (F2) |
| SE ADR-0021 "MUST register each per-tool-type normalizer ... by declaration; MUST NOT add a tool type by editing a shared dispatch chain" | CONFORMS for the tool-class registration; NOT-COVERED for `TOOL_TYPE_BY_TOOL_NAME` (F6) | the ADR has no rule on how a runtime `tool_name` reaches a registry `toolType` |
| SE ADR-0021 "MUST NOT let a normalizer return a verdict, or let the kernel inspect a tool identity" | CONFORMS | the normalizer returns a record; the kernel is unchanged. Identity reaches the kernel only as data inside `targets` |
| SE ADR-0021 "MUST implement the in-session hook gate using only ... PreToolUse ..." | CONFORMS | spikes S-1 and S-2 in the plan show the runtime contract used |
| SE ADR-0021 "MUST record thoth own independent verdict for every control named in posture output" (INT-07) | AMBIGUOUS (F3, F5) | the new posture line names "source: central"; the tool classification called "central" is an in-repo file, and the line does not say lower-layer allow rules override the posture |
| THOTH-ADR-0001 "MUST NOT be cited to justify any other allowlist, file, or control" | AMBIGUOUS (F5) | the fixture becomes an enforcement input (a class grants allow), a control beyond SUR-03 halt suppression |
| THOTH-ADR-0001 "the resolved path and its source MUST be recorded in halt-state" | AMBIGUOUS (F5) | the gate hook is write-free by the plan H10 and R13; the ADR words the rule for the fixture loader generally |
| THOTH-ADR-0001 "MUST NOT hardcode an entry of either list in hooks/ or src/" | CONFORMS | the plan table holds `Bash` only, not a fixture name |
| THOTH-ADR-0001 residual "Inert classification" and the "PR diff is the approval" ruling (plan Q-C) | NOT-COVERED | already a human question in the plan; keep it as an activation blocker |
| SE ADR-0002 "MUST define external dependencies as interfaces/ports owned by the inner layer" | CONFORMS with condition (F12) | gate takes the loader and catalog as parameters; the port result type should be owned by the gate, not imported from config/ |
| SE ADR-0003 inject I/O; "SHOULD prefer adding a new strategy/handler over extending an if/else ... when a third variant appears" | CONFORMS | two variants (shell, tool-class) may stay a table; the third variant is the named trigger (F6) |
| SE ADR-0005 "MUST NOT delete or weaken a failing test" | CONFORMS under the additive ruling, after the F4 rework | plan tests C1, C2 and C10 as written contradict existing tests; rewrite them, leave the existing ones |
| SE ADR-0006 flag OFF; "MUST NOT widen a change scope opportunistically" | CONFORMS | the unwired hook is the flag; R7 is deferred |
| SE ADR-0010 "MUST NOT lower coverage thresholds, delete tests" | CONFORMS under the additive ruling | no test deleted; the `isNotFoundError` tests stay |
| SE ADR-0009 monitoring | CONFORMS by disclosure | gate verdicts have no durable trail until S8 (plan R13, hook header) |
| SE ADR-0004, ADR-0007, ADR-0008, ADR-0011 to ADR-0015, ADR-0016 to ADR-0020, THOTH-ADR-0002 | NOT-APPLICABLE | no state, tagging, cost, data, plugin-tree or secret-scan surface touched (ADR-0017 and ADR-0018 are superseded) |

## Findings, ranked by exposure x irreversibility x silence

Illustrative target strings are written without backticks on purpose (QA-14 reads backticked paths). Exposure figures for the two HIGH findings are stated for the moment the hook is activated; today the hook is unwired (no PreToolUse entry in `.claude/settings.json`), so live exposure is 0%.

### F1. [ISSUE][HIGH][demonstrated] The class namespace in targets is forgeable by the shell normalizer, and the plan shipped allow rule turns that into an allow

- Plan section 4 puts the class in a target string that starts with the literal segment tool, then the class. Plan Q-A option X ships the rule sur03-read-only-class-allow with `targets` only and no `verbs`.
- The shell normalizer takes a redirect target verbatim. Its plain-redirect branch (`src/policy/normalizer/shell.ts:350`) does not look at the command when no verb, resource token or context flag is present, so any command with no slash-shaped token and one redirect becomes a write record for the redirect target alone.
- Ran the shipped normalizer and kernel with the plan rule text and posture deny:

```
python evil.py > tool/read-only/x | verbs ["write"] targets ["tool/read-only/x"] unresolved [] => allow sur03-read-only-class-allow
python evil.py > /tmp/x           | verbs ["write"] targets ["/tmp/x"]           unresolved [] => deny (default)
node exfil.js > tool/read-only/x  | verbs ["write"] targets ["tool/read-only/x"] unresolved [] => allow sur03-read-only-class-allow
echo hi > tool/read-only/x        | verbs ["write"] targets ["tool/read-only/x"] unresolved [] => allow sur03-read-only-class-allow
```

- Pairing the rule with verb read stops this one (python evil.py > tool/read-only/x becomes deny by default). It does not stop the write class: a per-tool allow rule with verb write and target for a workspace-mutating tool (plan G5) is matched by the same redirect, because the shell also emits verb write. Verb pairing is not an emitter binding.
- Why it matters: the kernel matches `targets` by prefix (`src/policy/kernel/kernel.ts:121`). Nothing binds a target string to the normalizer that produced it. The ADR-0021 field table calls `targets` tool-agnostic resource references; a class claim inside it is a claim any normalizer can make.
- Mitigating, not closing: Q-B (emit nothing on allow) turns a forged allow into "no deny, normal permission flow" for a default session. It does not help where `permission_mode` is bypass or a settings allow rule already covers the command.
- Exposure: ~100% of Bash calls of that shape once activated (0% today), basis: counted-in-code (no PreToolUse entry) plus the demonstration above on the shipped normalizer and kernel.
- Silent: yes. The verdict cites the class rule id, so an operator reading the reason sees a legitimate-looking rule.
- Failing test that closes it: H11, "a Bash call whose redirect target starts with the class-target prefix is not allowed by any rule shipped in shipped-defaults.json" (hook black-box, real shipped file). Structural companion for the fix: N9, "the class marker set is disjoint from every verb any other registered normalizer can emit", derived from the registry, not typed.

### F2. [ISSUE][HIGH][demonstrated] Class inside the identity path lets an in-repo fixture edit detach a central per-server deny rule

- Plan target grammar: tool, class, mcp, server, tool name. A rule author who wants to deny the github server must key the rule on the class segment the fixture currently assigns (remote-mutating). The fixture is an in-repo file whose entry-only edits are approved by PR diff alone (THOTH-ADR-0001, human ruling 2026-09-19).
- Ran the kernel with a central mandatory deny keyed on the remote-mutating github prefix, the shipped class allow, and the same tool under both fixture classes:

```
github classified remote-mutating: verdict=deny  rule=central-deny-github
github classified read-only:       verdict=allow rule=sur03-read-only-class-allow
```

- One line in `docs/qa/s5-central-classification.json` (class to read-only) turns a central deny into an allow. This is the "a change under review alters the policy that judges it" inversion that `src/policy/rule/precedence.ts:162` (`TRUST_RANK`) exists to prevent, arrived at through the encoding instead of the merge. The mandatory lock cannot help: it protects a rule id, and the deny rule is untouched.
- Also an ergonomics defect: to allow one read tool of a remote-mutating server a rule author must write the class into every per-tool target, and every reclassification silently invalidates those rules.
- Exposure: ~100% of MCP calls to any server whose fixture class is edited, once activated (0% today: the hook is unwired and the six fixture entries are all remote-mutating), basis: counted-in-code.
- Silent: yes. No test fails on a fixture edit (THOTH-ADR-0001 residual "No mechanical tripwire").
- Failing test that closes it: G10, "a central mandatory deny keyed on a server is still denied after the fixture flips that server class to read-only" (gate module, real merge and real loader with injected paths).

Fix for F1 and F2 together (one design change; the architect picks the exact spelling, the two tests define done):
- Carry the class on a channel no other normalizer can emit: a class-marker verb owned by the tool-class normalizer and kept out of the action catalog vocabulary (`KNOWN_VERBS` in `src/policy/normalizer/action-catalog.ts`), because `resolveVerb` lets the shell and cluster normalizers emit anything in that set.
- Keep the class out of the identity path: targets carry identity only (tool, builtin, name; tool, mcp, server, tool name). A server rule then survives reclassification. A class rule is a verb rule on the marker.
- Keep the legacy verb (read, write, execute) alongside the marker only if the mutating-verb behavior in `src/policy/kernel/kernel.ts:73` is wanted; state that a central verb-only rule then spans shell and class records (demonstrated: a deny on verb write matches both a redirect and a workspace-mutating class record).
- Record the marker vocabulary as a normalizer-owned catalog in the decisions log. The ADR says verbs come from the action catalog, so this is NOT-COVERED (see the work queue).

### F3. [ISSUE][MED][demonstrated] "Deny unless a rule allows" takes its allow rules from the lowest-trust layers, so the planned posture line overstates what central controls

- Plan section 8a says a central-declared posture relaxed by a lower layer is "still impossible". That is true of the scalar only. Ran the real merge:

```
central posture deny, project allow rule on the remote-mutating class prefix
  resolved posture: {"outcome":"deny","source":"central"}  voided: []
  verdict for a remote-mutating github call: allow  proj-allow-remote

shipped-defaults (mandatory rule, posture deny), project redefines the same rule id with a broader target
  merged rule: sur03-read-only-class-allow, targets ["tool/"], sourceLayer project
  voided: []   inertMandatoryDeclarations: shipped-defaults   posture: deny (shipped-defaults)

shipped deny posture, project allow posture, central absent
  resolved posture: {"outcome":"allow","source":"project"}
```

- Cause: the kernel evaluates matched allow rules before `defaultOutcome` (`src/policy/kernel/kernel.ts:182`), and any layer may add an allow rule. Shipped-defaults and project are peers (`src/policy/rule/precedence.ts:162-166`), so project may also redefine a shipped rule id, and a shipped `mandatory` flag is inert (`src/policy/rule/precedence.ts:311`). Central cannot express "deny unless central allows"; it can only add deny rules, which win.
- Consequence for the R4 line: "posture: deny (source: central)" is truthful and still lets a session-writable file grant every class. Issue #288 precondition 2 (re-decide the peer case) is discharged in the plan for the posture only; the rule-level peer override is the same trust gap and is not in the decision.
- Exposure: reachable in ~100% of loads that have a project allow rule and a central posture (measured: today `.thoth/policy.json` holds no rules, so 0% now), basis: counted-in-code plus the demonstration.
- Silent: yes; the print surface shows only posture and source.
- Failing test that closes it: P7, "the operator print surface names the allow rules by source layer (count per layer) whenever any layer other than central supplies one". Decision needed with it: a decisions row stating that central cannot require its own allow and that this is accepted until an allow-list-only central mode exists (not built here).

### F4. [ISSUE][MED][code-traced] The plan C-suite still specifies the replace design and contradicts existing tests under the additive ruling

- Plan tests C1 (parent listing is the first call), C2 ("no stderr text can produce absent ... en-US ... all throw") and C10 (call shape) describe the replace design. Existing `src/policy/config/central-source.test.ts:131-140` asserts that the English not-found text with exit 1 resolves to absent, and lines 147-167 pin the status-2 and access-denied throws. C2 as written cannot be authored without deleting or weakening a test the ruling says to keep (SE ADR-0010).
- Also stale under the ruling: plan section 3 S-5 timings (the present path is now one spawn, not two), section 8c ("REPLACE"), Q-D, and R9 in the intake ("replace the text match"); the decisions row must say the ratified 2026-09-24 condition is met by a locale-independent fallback with the English match kept as the fast path.
- Exposure: not a runtime defect (plan-level); it decides whether test-writer and the implementer author contradictory tests. Basis: counted in code (the four existing tests cited).
- Failing test that closes it: C2r, "stderr that is not the English text (de-DE, ja-JP, gibberish) with exit 1 resolves absent only when the parent listing succeeds and lacks the key; the English text with exit 1 still resolves absent in one spawn".

### F5. [SUSPICION][MED][derived] THOTH-ADR-0001 rules 1 and 5 do not decide the fixture as an enforcement input (AMBIGUOUS, human or architect)

- Rule 1 limits the exception to the two lists and says it MUST NOT be cited to justify any other control. Making `class` grant allow makes the fixture a control input beyond SUR-03 halt suppression.
- Rule 5 says the resolved fixture path and its source MUST be recorded in halt-state. The gate hook is write-free by the plan H10 and R13, and .thoth/halt-state/ is a named sensitive area, so the gate cannot comply and should not gain a write path in this story.
- The plan raises only the "PR diff is the approval" ruling (Q-C). Add rules 1 and 5 to that human question. Interim position for the plan: the gate reads the fixture, records nothing, and the activation step waits for the ruling.
- Resolves to: residual-register line (no code test can decide an ADR reading).

### F6. [SUSPICION][MED][derived] TOOL_TYPE_BY_TOOL_NAME sits outside every structural check that protects POL-12

- Letter of the ADR: not a kernel edit, not a normalizer edit, and a data table is not a `switch`. Fit at this scale: one row (Bash to shell) plus a default; two variants may stay a conditional (SE ADR-0003).
- Gap: `src/qa/normalizer-registry-purity-check.ts:67` scans only `src/policy/normalizer/registry.ts` for a `switch` and sibling imports, and `src/qa/kernel-purity-check.ts` scans only the kernel directory. The new gate directory is in neither scope, so the one place a tool-name dispatch now lives has no instrument.
- Also: the gate needs a side-effect import per normalizer (as the hook already does for shell), so adding a tool type edits two shared lines (table row, import). Name that as the accepted cost.
- Evolution path to state in the plan: at the third normalizer (a filesystem one is the first candidate) move the mapping to registration-time declaration and delete the table.
- Class-path risk to name now: a tool that can run arbitrary commands (PowerShell, Skill, Workflow, CronCreate, RemoteTrigger and similar, all in the runtime list of plan S-3) defaults to the class path, where a read-only classification is total authority for allow. Activation needs a rule that such tools are never classifiable read-only (F9).
- Failing test that closes it: G11, "the gate directory contains no switch and no tool-name conditional outside the routing table, and the table has exactly the rows the plan lists" (source scan, same pattern as the registry purity check).

### F7. [SUSPICION][MED][derived] Pre-kernel denials in the gate module may be a second decision path (AMBIGUOUS)

- ADR-0021: "MUST NOT implement a second decision path anywhere in the system". The shipped hook already denies non-Bash and malformed input before the kernel (criterion 19), and the plan moves that into a gate module and adds LoadFailure to deny.
- A load failure can go through the kernel instead: call `decide` with a deny posture and no rules, so the verdict shape (outcome, reason, rule id) has one author. The gate then builds only the reason text. Cost: a few lines and one test; benefit: the POL-03 parity harness (one fixture set through all surfaces) has one path to compare.
- Resolves to: G12, "a LoadFailure yields a kernel-authored verdict (rule id or default-outcome reason present)", or an architect ruling that input-validity refusals are outside the rule.

### F8. [SUSPICION][MED][derived] The target and verb grammar is an undeclared contract between the normalizer and every rule author, including out-of-repo central authors

- Central rules live in the registry, written by an administrator on another cadence than this repo. A grammar change (class position, separator, sanitization) silently detaches those deny rules, which fails open toward the posture and any allow rule. No grammar version exists.
- Precedent to follow: `src/policy/normalizer/target-format.ts` is the single builder for cluster targets, used by both the shell and the structured normalizer.
- Needed: one builder and parser module for the tool targets, a documented grammar (with the escaping rule: a slash in a name is unresolved), and a golden test that pins normalizer output for a fixed call list, so a grammar change is a visible test diff.
- Verb overloading: the plan maps workspace-mutating to write and remote-mutating to execute. "Execute" for a GitHub issue create is not what the action catalog means. Demonstrated: a central deny on verb write matches a shell redirect and a class record alike. If the legacy verbs stay, say so in the grammar.
- Resolves to: G13, the golden test above.

### F9. [SUSPICION][MED][derived] Activation preconditions AP-1 to AP-8 omit four items this design creates

- AP-9: a recovery path when the load fails. A deny on every LoadFailure includes Edit and Bash, so a malformed policy file bricks the session; an agent that can write that file can induce it (self-inflicted denial, not an escalation). State the out-of-session repair step.
- AP-10: deny rules that protect `.thoth/policy.json`, shipped-defaults.json and the fixture belong in the activation list, not only the backlog (plan section 13). Under F3 those files are the whole authority for allow.
- AP-11: what Q-B means under `permission_mode` bypass, where "emit nothing" proceeds without a prompt.
- AP-12: a rule that arbitrary-execution tools are never classifiable read-only (F6), checked mechanically over the inventory.
- Resolves to: four named lines in plan section 14; each becomes a test in the activation story.

### F10. [SUSPICION][MED][derived] The hook is not thin as specified: fixture location, catalog assembly and loader wiring are composed in the hook and duplicated with the SessionStart hook

- Plan section 4 has the hook resolve the fixture path (three lines copied from `hooks/sessionstart-tool-enum.mjs`) and build the catalog. Two copies of a security-relevant path rule (Issue #99, THOTH-ADR-0001 rule 5 names one function as the anchor) and two catalog assemblies invite drift; AP-8 already needs both hooks to agree on one inventory.
- Move `resolveFixtureLocation` and the catalog assembly into one function under `src/policy/tools/` taking the project directory and an existence probe as parameters; both hooks call it; the gate receives `loadCatalog`.
- Dependency direction otherwise checks out: hook to gate to normalizer and kernel, no cycle added, the kernel imports nothing new.
- Resolves to: G14, "both hooks resolve the same fixture path and catalog for the same project directory".

### F11. [SUSPICION][LOW][derived] Longest-prefix wins when resolving an MCP name to a server

- Tool names are supplied by the server. A server named foo that exposes a tool called bar__x produces a runtime name that also starts with the prefix of a classified server foo__bar. Longest match would classify the call by the wrong server.
- Prefer: more than one candidate prefix means unresolved (deny). Resolves to N4b, an ambiguity case in the normalizer unit tests.

### F12. [SUSPICION][LOW][derived] Gate module hygiene

- Port types: the gate should own the small result type its `loadPolicy` port returns and let the hook adapt `LoadResult`; importing `LoadResult` from config/loader.ts points an inner module at a module that reads files.
- Production data that names test ids (`GATE_FAIL_OPEN_DECISIONS` rows naming tests) couples production code to the test suite; keep the row-to-test map on the test side and export only the decision list.
- Purity: H10 scans for write APIs only. Add a structural check that the gate directory has no `node:*` value import, so "pure gate, impure adapter" is enforced.
- Resolves to: G15, the structural scan.

### F13. [CLEAN][derived] Cost shape and latency

- Plan figures (measured by the plan on Windows, not re-run here): cold hook with the loader p50 184.5 ms, p99 254.5 ms; +42 ms p50 and +76 ms p99 over the current hook; against the 2000 ms ceiling. The no-cache ruling is sound: the saving is about 40 ms and a cache is session-writable state on a policy path.
- Unbounded variable: hook invocations per session. Once the matcher widens (AP-4) every tool call pays the cold start; at the plan p50, 500 calls cost about 92 s of cumulative latency (arithmetic on the plan figure). Bounded per call, visible, not a defect.
- Failure-mode cost: a hung registry read is 5 s per call (timeout in `src/policy/config/central-source.ts`), then deny. Under the additive #107 path the worst case is two sequential 5 s spawns, 10 s, still far below the 60 s hook ceiling, so a timed-out hook (which does not block) is not reached; it does exceed the OPS-03 figure for that failure mode, which the plan records as a decision.
- Paperwork: the S6 architecture pre-build finding at `docs/backlog.md:61` recommended compute-once-per-session caching for this story. The no-cache ruling supersedes it on measured evidence; the decisions row should say so, not leave the two disagreeing.
- CI is Linux with no registry spawn, so it cannot measure the Windows cost (plan S-4 discloses it). Residual-register line, not a blocker.

### F14. [CLEAN][code-traced] Route (a) stays inside the seven fields; kernel, registry, shell and cluster normalizers show zero diff

- `src/policy/kernel/kernel.ts:121-127` matches on `targets` and `verbs` data only; unclassified becomes opaque plus unresolved and is denied by POL-05 before any rule (`src/policy/kernel/kernel.ts:73`, `:93`). No ADR-0021 amendment is needed for the F1 and F2 fix either: a marker verb and an identity-only target are still verbs and targets.
- The new directory is justified: gate composition (normalize, load, decide) is the seam the POL-03 parity harness compares across the startup, in-session and pipeline surfaces; the hook stays an adapter over it (subject to F10 and F12). Dependency direction: hook to gate to normalizer and kernel; no import points the wrong way; the kernel gains no import.

### F15. [CLEAN][code-traced] The additive #107 design is coherent and testable if it follows these rules

- Trigger: enumerate only on exit status 1 with stderr that does not match the English pattern. Status 2, a null status (timeout, overflow) and a spawn error rethrow as today (existing tests at `src/policy/config/central-source.test.ts:147`, `:158`, `:169` stay green).
- The enumeration may only downgrade a failure to absent: `reg query` of the Policies parent succeeds and no subkey equals Thoth (exact, case-insensitive). Everything else, including the key being listed, rethrows the original error. That drops the plan key-listing step and its tests (simpler; the only cost is a non-English host where the Thoth key exists but the value does not, which stays a loud rejection).
- Spawns: English absent 1 (unchanged); non-English absent 2; present 1 (cheaper than the replace design, which needed 2). Bonus: an English host with no Policies parent no longer rejects, which the replace design would have caused.
- Testing: needs a call-indexed scripted runner in the test file (the existing stubs are single functions). Real registry behavior is proven only by the plan spike on one English host; say so in the residual register (not demonstrated on a non-English host).

### F16. [CLEAN][code-traced] Blast radius is contained by the unwired hook

- `.claude/settings.json` `hooks` keys are SessionStart and UserPromptSubmit only (ran a JSON parse: [ 'SessionStart', 'UserPromptSubmit' ]). The hook rewrite has no live consumer except tests and `npm run policy:print`.
- Shipped policy content is live for the print surface today: posture deny in shipped-defaults.json changes what `policy:print` reports. Intended (R4), and the plan already names the disclosure text (P5).

### F17. [CLEAN][derived] Q-B (emit nothing on a kernel allow) is consistent with ADR-0021 shape 4

- The ADR maps deny to permissionDecision deny and ambiguous to ask; nothing requires the gate to emit allow. Spike S-2 shows an emitted allow skips the user prompt, so emitting only deny keeps the gate a veto, not an auto-approver. Note for the hook header: a kernel allow means "no deny", and the verdict remains identical across surfaces (POL-03) because only the rendering differs.

## Open findings to failing tests (one to one)

Pre-build, so "failing" means: a named test the plan must contain, which is red against the current section 4 design and green once the change lands.

| Finding | Test | Where |
|---|---|---|
| F1 | H11 (forged class prefix in a redirect is not allowed by shipped rules) | new hook black-box file, test-writer |
| F2 | G10 (central deny survives a fixture class flip) | gate module tests, implementer |
| F3 | P7 (print surface names allow rules by source layer) | printer amendment, test-writer |
| F4 | C2r (non-English stderr absent only via parent listing; English path unchanged) | central-source tests, implementer |
| F6 | G11 (no switch or tool-name conditional in the gate directory outside the table) | gate module tests |
| F7 | G12 (LoadFailure verdict is kernel-authored) | gate module tests |
| F8 | G13 (golden output of the tool normalizer for a fixed call list) | normalizer tests |
| F10 | G14 (both hooks resolve the same fixture path and catalog) | hooks tests |
| F11 | N4b (ambiguous prefix is unresolved) | normalizer tests |
| F12 | G15 (gate directory has no node value import) | structural test |
| F5 | none | ADR reading; residual-register line R-1 and the human question |
| F9 | none | activation-story checks; residual-register line R-2 (plan section 14 gets AP-9 to AP-12) |

Open findings 12 (4 ISSUE, 8 SUSPICION); failing tests 10. F5 and F9 have no executable form now: F5 is an ADR reading, F9 are activation preconditions whose tests belong to the activation story. N9 (marker set disjoint from every other normalizer emittable verb) is the structural check the F1 fix needs; it rides with H11 and is not a separate finding.

## NOT-COVERED and AMBIGUOUS work queue (the architect)

| # | Kind | Item | From |
|---|---|---|---|
| 1 | NOT-COVERED | How a runtime tool_name reaches a registry toolType (routing declaration vs table); ADR-0021 has no rule | F6 |
| 2 | NOT-COVERED | A normalizer-owned verb vocabulary (class marker verbs) beside "verbs from the action catalog" | F1, F2 |
| 3 | AMBIGUOUS | Whether pre-kernel input and load-failure refusals are a "second decision path" (POL-03) | F7 |
| 4 | AMBIGUOUS | THOTH-ADR-0001 rule 1 (fixture as an enforcement control) and rule 5 (halt-state recording by a write-free gate), plus the plan Q-C ruling | F5 |
| 5 | AMBIGUOUS | INT-07: what a posture line naming "central" may claim when the tool classification called central is in-repo and lower-layer allow rules override the posture | F3 |
| 6 | NOT-COVERED | Central cannot require its own allow ("deny unless central allows"); a POL-07 extension, not built here | F3 |
| 7 | NOT-COVERED | Ownership and versioning of the rule-author-facing target grammar | F8 |
| 8 | Human | CLAUDE.md sensitive areas still names the deleted report-subject-gate hook (plan already noted) | plan |

## Exact plan changes required before test-writer runs

| # | Change | Findings |
|---|---|---|
| PC-1 | Plan section 4: replace the class-in-targets grammar. Class travels as a marker verb owned by the tool-class normalizer (outside KNOWN_VERBS); targets carry identity only; one builder and parser module for the grammar; slash in a name stays unresolved; ambiguous MCP prefix is unresolved, not longest-wins | F1, F2, F8, F11 |
| PC-2 | Plan section 12 Q-A and section 7: re-express the shipped class rule on the marker verb; do not ship a verb-only allow with no targets that pre-commits every future normalizer that emits read, list, describe or get (that breadth is the design-challenger attack, fallback Y stands). Re-word N1, N3 to N5, G4, G5, H5, H6 to the new grammar; add H11, N9, G10, N4b, G13 and mutation drill M5 (remove the marker, H11 goes red) | F1, F2, F8, F11 |
| PC-3 | Plan section 8a: state the scalar-only truth of "central posture cannot be relaxed"; add the rule-level peer override to the re-decision; add P7 to section 7; draft the decisions row that central cannot require its own allow | F3 |
| PC-4 | Plan C-suite, section 8c, S-5, Q-D: rewrite for the additive ruling per F15 (C2 becomes C2r, C10 keeps the first call shape, drop the key-listing tests, add a scripted-runner helper, keep the English path test and every existing test untouched) | F4 |
| PC-5 | Plan section 4 gate and hook: load failure through the kernel with a deny posture (or an architect ruling), routing table in its own file with G11, gate-owned port types and G15, one shared function for fixture location and catalog assembly with G14, test ids off the production decision list | F6, F7, F10, F12 |
| PC-6 | Plan Q-C and section 14: add THOTH-ADR-0001 rules 1 and 5 to the human question; add AP-9 (recovery when the load fails), AP-10 (deny rules protecting the policy files and the fixture), AP-11 (Q-B under bypass), AP-12 (no arbitrary-execution tool classifiable read-only) | F5, F9, F6 |
| PC-7 | Decisions rows to draft: the no-cache ruling supersedes `docs/backlog.md:61`; the additive reading of the 2026-09-24 #107 condition | F13, F4 |

## What this story must NOT do, so activation stays a separate reviewed step

- Add a PreToolUse entry or change the `hooks` object in `.claude/settings.json` (plan S2 proves it; keep it as a test).
- Change `ENFORCEMENT_DISCLOSURE` to claim live enforcement (P5 ties it to the settings file).
- Touch the kernel files, registry.ts, shell.ts, structured-cluster.ts, precedence.ts, schema.ts, or add the marker verbs to `KNOWN_VERBS` (that would let the shell emit them).
- Edit any fixture entry or `docs/qa/tool-inventory.json`, classify the 23 runtime built-ins, or rule on the 8 connectors (AP-2, AP-3).
- Give the gate hook a write path or a halt-state write; add a cache; add an ask outcome.
- Ship allow content for shell, Edit, Write or paths (AP-1); delete or edit any existing central-source test.

## Evolution path

- Stage 1 (this story, reworked): consumer, encoding and preconditions, hook unwired.
- Stage 2 (separate): AP-2 inventory refresh and classification, AP-3 connectors, AP-1 baseline allow content with AP-10 protection.
- Stage 3 (separate): AP-4 matcher, AP-5 entry with timeout 60, AP-6 decisions row for S5 criterion 12, AP-7 and Q-C ruling, AP-8 one inventory, AP-9 recovery, AP-11 bypass semantics, AP-12 exec-tool rule.
- Later: the third normalizer replaces the tool-name table with registration-time declaration (F6); Issue #224 moves classification out of repo and ends THOTH-ADR-0001.

## Editorial (verdict-neutral)

- Plan section 3 S-5 still says the present path costs two spawns and section 8c is headed REPLACE; both are stale under the additive ruling.
- Plan section 12 Q-D and the intake R9 wording ("replace") predate the ruling.
- The plan receipt counts 58 criteria by grep; the C-suite count changes with PC-4.
- The plan is a document only; this review ran the shipped normalizer, kernel and merge against it, but no plan test exists yet, so every design defect above is pre-build and cheap.

## Next single action

Manager: return the plan to `story-implementer` for PC-1 to PC-7 in one revision (no new spikes; the demonstrations in F1 to F3 become the red tests), then dispatch `design-challenger` on the reworked encoding and `test-writer` after it.

## Evidence run (raw)

Method: Node 24.15.0, native TypeScript stripping, importing the shipped modules from this worktree (base tree, plan not yet built), with the rule text of plan Q-A option X and the record shape of plan section 4 built by hand where the tool-class normalizer does not exist yet.

```
$ node src/qa/kernel-purity-check.ts
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
$ node src/qa/normalizer-registry-purity-check.ts
[QA normalizer-registry-purity-check] PASS: src/policy/normalizer/registry.ts: zero dispatch-chain/sibling-normalizer-import violations.
$ node --test src/policy/config/central-source.test.ts
tests 16, pass 16, fail 0, cancelled 0, skipped 0, todo 0
$ node -e "...Object.keys(JSON.parse(settings).hooks)"
[ 'SessionStart', 'UserPromptSubmit' ]
```

Demonstration scripts (inline node, not committed): normalizer plus kernel for F1; kernel with hand-built class records for F2; `mergeLayersWithMandatoryLock` for F3. Their raw output is quoted in F1 to F3 above.

Not run, and why: the Windows latency benchmark (needs the plan built hook; the plan figures are cited as derived), any non-English registry check (no such host; plan S-5 says the same), the built tool-class normalizer (does not exist). UNPROVEN-pending-verification: whether a real non-English `reg.exe` leaves the parent listing shape the additive check reads; settled by the plan L-suite on a non-English Windows host, run by the human.

Duplicate-issue check: none existing for these findings (gh issue list search). Filed same turn with labels bug, severity and sur or pol, milestone S7: Issue 299 (F1), Issue 300 (F2), Issue 301 (F3), Issue 302 (F4).

RECEIPT: verdict=REWORK
findings (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] F1 class namespace forgeable: "python evil.py > tool/read-only/x" is allowed by the plan shipped class rule (targets-only) through the shipped shell normalizer and kernel; Exposure ~100% of that call shape once activated (0% today, hook unwired), basis: counted-in-code; test H11
2. [ISSUE][HIGH][demonstrated] F2 class inside the identity path: flipping github to read-only in the in-repo fixture turns a central mandatory deny into allow (deny to allow shown by running the kernel); Exposure ~100% of calls to a reclassified server once activated, basis: counted-in-code; test G10
3. [ISSUE][MED][demonstrated] F3 allow rules from rank-0 layers override a central posture deny and project can redefine a shipped rule id (real merge run); the planned "posture: deny (source: central)" line overstates control; test P7
4. [ISSUE][MED][code-traced] F4 plan C1, C2, C10 contradict existing central-source tests at lines 131-167 under the additive ruling; test C2r
5. [SUSPICION][MED][derived] F5 THOTH-ADR-0001 rule 1 (fixture as enforcement control) and rule 5 (halt-state recording by a write-free gate) AMBIGUOUS, plus Q-C; residual line R-1
6. [SUSPICION][MED][derived] F6 tool-name routing table sits outside the registry purity and kernel purity scopes (POL-12 letter conforms, routing NOT-COVERED); test G11
7. [SUSPICION][MED][derived] F7 LoadFailure and input refusals decided in the gate module may be a second decision path (POL-03, AMBIGUOUS); test G12
8. [SUSPICION][MED][derived] F8 target and verb grammar is an unversioned contract with out-of-repo central rule authors; test G13
9. [SUSPICION][MED][derived] F9 activation preconditions omit recovery on load failure, policy-file protection, bypass semantics, arbitrary-execution tool classification; residual line R-2
10. [SUSPICION][MED][derived] F10 hook is not thin: fixture location and catalog assembly duplicated with the SessionStart hook; test G14
11. [SUSPICION][LOW][derived] F11 longest-prefix MCP name match can classify by the wrong server; test N4b
12. [SUSPICION][LOW][derived] F12 gate hygiene: port types imported from config, test ids in production data, no purity scan; test G15
13. [CLEAN][code-traced] F14 route (a) stays inside the seven fields; kernel, registry, shell, cluster show zero diff; unclassified denied by POL-05 (kernel.ts:73, :93)
14. [CLEAN][code-traced] F15 additive #107 is coherent and testable if enumeration triggers only on status 1 with non-English text and may only downgrade to absent
15. [CLEAN][code-traced] F16 blast radius contained: settings.json hooks keys are SessionStart and UserPromptSubmit only
16. [CLEAN][derived] F13 cost shape: plan-measured p99 254.5 ms of 2000 ms; no-cache ruling sound; unbounded variable is hook calls per session
17. [CLEAN][derived] F17 Q-B emit-nothing-on-allow consistent with ADR-0021 shape 4
counts: issues=4 suspicions=8 clean=5
evidence: demonstrated=3 code-traced=4 derived=10
checks=18/0/0 pass/fail/skip (kernel-purity 1, registry-purity 1, central-source tests 16); 3 demonstration scripts and a settings hooks parse also run, output quoted in F1 to F3
adr=HIT(37)
report=docs/reviews/s7-kernel-gate-classification-architecture-2026-09-26.md
