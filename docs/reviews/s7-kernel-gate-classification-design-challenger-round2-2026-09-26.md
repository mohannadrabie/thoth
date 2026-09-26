# Design Challenger report, round 2: s7-kernel-gate-classification (Phase 1 plan revision 2, pre-build)

[design-challenger]
Design Challenger (Apep) - attacking `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md` (revision 2, commit 81028f5), round 2 of this artifact. Round 1 is `docs/reviews/s7-kernel-gate-classification-design-challenger-2026-09-26.md` (verdict go, PT-1..PT-11).

`📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]` (the build rewrote the adrCatalog version in `docs/.maat-state.json`; I reverted that one line, so the tree carries only this report and its log row). ADRs re-read for this pass: SE ADR-0021 Rules for agents, THOTH-ADR-0001.

State: `docs/.maat-state.json` shows `humanRulingRequired: false`, `roundsSinceLastGo: 0`, `councilHeld: false`; round 1 on this artifact was a `go`, so this is graded round 2 (budget 2, not exhausted). Worktree at 81028f5 (confirmed by `git log -1 --oneline` before reading), submodule initialised. Tier CRITICAL.

## Method and what was actually run

The plan's code does not exist yet, so probes fall in two groups. Group A ran against the real repo code at 81028f5 (real shell normalizer, kernel, schema validator, loader, real `reg.exe` on this Windows 11 host, Node 24.15.0). Group B ran against a plan-faithful prototype I wrote in the scratchpad from the plan text only (tool-class normalizer, gate module, hook adapter, sandbox copy-tree helper, 20 approximations of H, N and G checks). Anything resting on Group B is tagged `derived` unless a mutation run failed or passed on a named check; it is never presented as repo evidence.

| # | Probe | Group | Result |
|---|---|---|---|
| p1 | 40,008 crafted and random shell commands through the real shell normalizer, looking for a marker verb or an mcp identity target | A | 0 marker verbs; verbs seen only write, delete, get; 61 records carried an mcp identity target |
| p2 | plan R-D parse and index over 14 edge names, then a brute-force collision sweep against canonical entries | B | all parse edge cases unresolved; unlisted servers inherit a class through canonical entries that contain an underscore |
| p3 | additive #107 copied into a scratch copy of `central-source.ts` and the 16 existing tests run against it | A+B | 16 of 16 pass; classifier run over 22 listing shapes |
| p4 | four natural author rules against the plan record shape, real schema validator, real kernel | A | all four load clean and are inert |
| p5 | prototype hook, 20 checks; mutants M1..M7 plus M8, M9, M10 | B | see attack 3 |
| p6 | locked `hooks/pretooluse-kernel-gate.test.ts` run against the prototype hook | B | 9 of 10 pass; only AC-2 red, as the plan predicts |
| p7 | adapter polarity and crash paths, six injected gate faults plus stdin closed | B | see attack 5 |
| p8 | plan section 7a count reproduced (awk was refused by the harness, so the same regex ran in node) | A | C:11 D:2 G:17 H:11 L:4 M:7 N:12 P:7 S:5, TOTAL 76 |
| p9 | proposed diff-scope script run over the plan's section 15 list | A | 0 forbidden paths; content-level rules sanity-checked on synthetic edits |

Not run: a registry write probe under HKCU (the harness refused to run a `reg add`), so the "listing shows an access-denied child" claim is unrun (X-1 below).

## Verdict: `go` (0 valid HIGH), two MED issues routed to day-1 failing tests

- No finding calibrates to HIGH. The hook is still unwired (no PreToolUse entry in `.claude/settings.json`; the plan changes comment lines only) and option Y ships zero policy content, so every finding has `reach=operator` or `instrument`, and every exposure today is 0% counted. Round-1 reasoning about the reach cap stands.
- Boundary-crossing carve-out applies to attacks 1 and 2 (a central deny rule silently inert; an unlisted server inheriting an allow): they route to named failing proof-tests, never to the residual register.
- The revision closes the round-1 BREAKS that mattered. Closure table below. Two round-1 items are closed only by deferral to activation (PT-3, PT-5) and one is only partly closed (PT-10, PT-11).

## Round-1 closure table

| PT | Round-1 finding | Status | Proof in the plan (and my check) |
|---|---|---|---|
| PT-1 | shipped class allow forgeable by a shell target | CLOSED | Option Y: `shipped-defaults.json` untouched (S5); forgery re-expressed as N9, H11. Test-strength gap: attack 3 |
| PT-2 | a read verb authorizes any binary | CLOSED for this story, CARRIED to AP-1 | no shipped verb allow exists; the tool-blind verb resolution in the shell normalizer is unchanged and AP-1 does not name PT-2 as its entry test (residual R-8) |
| PT-3 | two allowed calls rewrite the policy files | CLOSED by scope change, CARRIED to AP-10 | under option Y nothing is allowed by class; but posture allow means a redirect write to `.thoth/policy.json` is allowed today, exactly as with the old hook; only AP-10 protects it and no plan check pins it |
| PT-4 | launch failure fails open | CLOSED per the PT wording (recorded decision plus fault-injection instrument) | G9 probes each launch fault and records PROCEEDS with AP-13 (Issue #303); still unfixed by design |
| PT-5 | quadratic redirect scan | OPEN-DEFERRED | recorded as AP-14 (Issue #304); the PT asked for a 128 KB corpus entry, the plan defers it to activation; L4 adds only the exit-status assertion |
| PT-6 | posture line overstates central control | CLOSED | P2 exact strings name lower-trust layers; P7 and G7 document the override |
| PT-7 | fixture can lower a built-in class | CLOSED for built-ins | R-B (only Bash and mcp__ names evaluated), N10, H8, G17; the print-surface half of PT-7 rides on Q-C (human) |
| PT-8 | denials must be policy denials, not crashes | CLOSED | strict `wasPolicyDenied`; verified: mutant M10 (hook always throws) turns all 11 H checks red; M9 (hook always silent) turns 9 red |
| PT-9 | absence needs a recognised listing | CLOSED | C3 plus the Q-E rule; 16 of 16 existing tests pass against my additive prototype; residual attack 4 |
| PT-10 | lossy server segment cannot grant an allow | PARTIALLY CLOSED | parse rules and fixture-side injectivity hold; raw-name collision with canonical underscore entries and exact lookup are not covered (attacks 2 and 3) |
| PT-11 | predicted red sets are true | PARTIALLY CLOSED | M3 corrected, M5 added, but 5 of 7 predictions are false as specified (attack 3) |

Explicit statement: every round-1 BREAKS is closed or dispositioned in the plan except PT-5 (deferred with a recorded blocker), PT-10 and PT-11 (partial). None of those three can block: PT-5 is bound to AP-14, PT-10 and PT-11 are `instrument` or MED-derived.

## Attacks, ranked by blast radius (exposure x irreversibility x silence)

### 1. Author-natural deny rules load clean and never match the new record shape (BREAKS)

- **Implicit assumption:** "a rule an author writes against the class or identity grammar either matches or is rejected." Nothing rejects it.
- **Scenario:** a central or project author writes a deny rule for the github MCP server. Under option Y the posture is bootstrap allow, so deny rules are the only enforcement. Four natural shapes are inert against the record the plan specifies (one marker verb, one identity target, no legacy verb, `unresolved` empty):
  - a misspelled marker verb;
  - a server target written without the trailing slash (the kernel does exact match without it, prefix match with it);
  - the legacy mutating verbs (write, create, modify, delete, move, rename, execute) plus the server prefix, which is what the kernel's own MUTATING_VERBS notion invites, and which the plan deliberately does not emit for class records (plan section 4, "No legacy verb");
  - the declared server name (with a colon, space or dot) instead of the sanitized runtime name.
  The operator sees a valid, loaded rule; the call is allowed silently.
- **Evidence (raw, real schema validator and real kernel, record shape taken from plan section 4):**

```
typo in marker verb                                                schema errors: 0 => verdict allow
server target without trailing slash                               schema errors: 0 => verdict allow
natural mutating-verb deny (kernel MUTATING verbs)                 schema errors: 0 => verdict allow
server name in sanitized-vs-declared form (plugin_x vs plugin:x)   schema errors: 0 => verdict allow
CONTROL: correct marker rule                                       schema errors: 0 => verdict deny r
CONTROL: correct server prefix                                     schema errors: 0 => verdict deny r
```

  Code-traced cause: `src/policy/rule/schema.ts:189` validates `verbs` and `targets` as string arrays only; nothing checks them against any vocabulary. The plan documents the forgery side of the grammar (N9, G13) but has no authoring-side check, and the marker vocabulary sits outside KNOWN_VERBS by design, so there is no existing place a check could live.
- **Exposure:** ~0% of rules today (shipped-defaults.json and `.thoth/policy.json` both hold zero rules, counted), basis: counted in code; every rule an author writes later is exposed.
- **Current defense:** the printer lists resolved rules with layer and origin; it does not say whether a rule can match anything. The N9 documenting test pins only the forged-target direction.
- **Tags:** severity MED / evidence demonstrated / reach operator / likelihood plausible / undo reversible (edit the rule) but silent, so severity is kept.
- **Verdict: BREAKS.** Filed as a new Issue (see Issues section).
- **Proof-test PT-12 `rule-that-cannot-match-any-emitted-record-is-not-silent`:** through the real loader and printer, a rule whose verbs contain a string starting with the marker prefix that is not one of the three markers, or a rule whose target equals an mcp server segment without a trailing slash, or a deny rule whose verbs are only legacy mutating verbs and whose target has the mcp prefix, is either rejected at load with a message naming the rule id, or named on the operator print surface as "matches no record this normalizer emits". The plan picks which. Whether class records should also carry a legacy verb is a shape question and routes to `architecture-reviewer`; I do not prescribe it.

### 2. Injective-or-unresolved covers the fixture side only; the runtime name is many-to-one on the other side (UNPROVEN)

- **Implicit assumption:** "an entry that equals its own sanitized form is safe to admit." True for the fixture; false for the names an unlisted server can present.
- **Scenario:** an author copies the runtime name from the tool list into the fixture, which is the only form the gate can admit. Real evidence of the mapping in this very session: the connector declared as "claude.ai Adobe for creativity" arrives as `mcp__claude_ai_Adobe_for_creativity__*` (dot and spaces all became underscore), and "claude.ai Gmail" arrives as `mcp__claude_ai_Gmail__*`. An entry named claude_ai_Gmail is canonical, so the plan admits it. Any unlisted server whose declared name sanitizes to the same string (a space, a dot, a colon, a non-ASCII letter) then resolves to that entry's class. N4 tests the case where both "my server" and my_server sit in the fixture; the case where only the canonical form is listed is not tested.
- **Evidence (spec model of plan section 4, not repo code):**

```
admitted [ 'my_server', 'docs', 'a-b', 'claude_ai_Gmail' ]
B raw "my server"      -> mcp__my_server__send_message       => RESOLVES as my_server (read-only)   <== UNLISTED SERVER INHERITS CLASS
B raw "my.server"      -> mcp__my_server__send_message       => RESOLVES as my_server (read-only)   <== UNLISTED SERVER INHERITS CLASS
B raw "claude.ai Gmail"-> mcp__claude_ai_Gmail__send_message => RESOLVES as claude_ai_Gmail          <== UNLISTED SERVER INHERITS CLASS
B raw "my  server"     -> mcp__my__server__send_message      => unresolved
committed entries containing '_': 0 of 6
```

  Parse rules themselves hold: 14 edge names (`___`, `__evil__`, leading and trailing underscore, empty server, `mcp__` alone, `mcp____x`, case, prefix) are all unresolved in the model.
- **Coupling the plan does not state:** SessionStart compares the raw declared name ("claude.ai Gmail") while the gate can admit only the sanitized form. For every server whose declared name contains a space, dot or colon, no single fixture entry satisfies both surfaces: the raw entry halts nothing but is rejected as lossy at the gate (its tools are denied forever); the sanitized entry classifies at the gate but leaves SessionStart halting on the raw name and opens the collision above.
- **Price honesty (S-6):** the plan reports 294 of 299 resolvable and 5 unresolved. Those five were measured on one session. In this session the aws-mcp-server tools are named `mcp__aws-mcp-server__aws___run_script` and its seven siblings (counted from this session's own tool list: 8 names), and the aws-knowledge server has 5 more `aws___` names, so 13 names are unresolved and 100% of the tools of 2 of the 6 committed fixture servers can never be classified (fail-closed availability cost, not a bypass). The figure is a property of which servers are connected, not of the design; the plan should say "every tool of a server whose tool names contain a double underscore".
- **Exposure:** 0 of 6 committed entries contain an underscore, so 0% today, basis: counted in code; grows with the first canonical underscore entry. Unobserved sanitizer characters (colon, other Unicode) are unmeasured (X-2).
- **Tags:** MED / derived / operator / plausible / reversible. Boundary-crossing carve-out: an unlisted server inheriting an allow is a security boundary weakened, so it routes to a test, not the register.
- **Verdict: UNPROVEN.** The settling run is X-2 below.
- **Proof-test PT-13 `unlisted-server-cannot-inherit-a-canonical-entry`:** with a read-only entry whose name contains an underscore, the runtime names produced by the space, dot and colon variants of that name (generated from the same sanitizer the plan uses, not typed) are unresolved, or the plan records a decision that entries containing an underscore are rejected or that the collision is accepted with a disclosure on the print surface; plus H4 and G13 include the real runtime name `mcp__aws-mcp-server__aws___run_script` and assert it is denied with a reason naming the cause.

### 3. Three of the plan's mutation-drill predictions are false and the named checks cannot kill those mutants (BREAKS, instrument)

- **Attack:** the plan lists M1..M7 with a predicted red set each and says each is run once on day 1 (PT-11). I built the plan-faithful prototype and ran each drill for real. Observed against predicted:

| Drill | Predicted red set (plan) | Observed red set (prototype) | Verdict |
|---|---|---|---|
| M1 one marker for every class | G13, G4, G5, H7 | H7, G4, G5 (G13 not in the prototype) | as predicted |
| M2 real fixture: github to read-only | G13 | H7 only (G13 not in the prototype) | H7 also red; prediction understated |
| M3 hook hardcodes the bootstrap outcome | H5 | H5, H11 | understated |
| M4 load failure returns allow | G1, H6 | H6 (G1 not in the prototype) | as predicted |
| M5 marker verbs added to KNOWN_VERBS | N8, N9, H11 | N8 only | N9 and H11 stay green: FALSE |
| M6 route Bash through tool-class | G16, G11 | H5, H10, G3; G16 stays green | FALSE |
| M7 lookup by prefix or longest match | N3, N4, N5, H4 | none | FALSE, mutant survives |

- **Why M5 survives:** the forgery cases in N9 and H11 use an allow rule with a target (the mcp prefix). A marker verb forged through the shell also needs an mcp target, and the shell normalizer cannot produce both: a redirect plus a resource token is two targets (unresolved), a lone redirect after a kubectl-shaped call is missing its resource (unresolved), and a plain redirect ignores the verb. The forged call is denied for reasons unrelated to KNOWN_VERBS. The property M5 breaks is a class-wide, target-less allow (the very rule shape G4 and H7 use): with markers in KNOWN_VERBS, a kubectl-shaped call whose verb is the marker string matches it. Only N8 stands between the marker set and that forgery.
- **Why M6 survives:** G16 asserts identical verdicts across classes and no marker in the verbs. A Bash call routed to the tool-class normalizer becomes an opaque record, denied identically for every class, with no marker: green. G11 counts rows, and a row that points at the wrong normalizer keeps the count at two.
- **Why M7 survives:** the parser already rejects the triple-underscore and double-underscore names before the lookup runs, so a prefix or longest-match lookup is never exercised by N3, N4, N5 or H4. The exact-match property (the plan's central R-D claim) is untested.
- **Discriminating checks I ran (all green on the baseline prototype, each red on its mutant):**

```
BASE pass 4 fail 0
M5 pass 2 fail 1 RED: PT-12
M6 pass 2 fail 1 RED: PT-14
M7 pass 2 fail 1 RED: PT-13
```

  The scratch labels map to this report's names: scratch PT-12 is PT-14a (a class-wide marker allow against a kubectl-shaped call whose verb token is the marker string), scratch PT-13 is PT-14b (mcp servers named docs-evil, docsevil, docs2, and aws against entries docs and aws-mcp-server must be denied), scratch PT-14 is PT-14c (the Bash record must be parsed, unresolved empty, verbs delete, for every catalog class). The fourth check in that file (scratch PT-15, prototype-property server names) is green on baseline and on M8, so it is not a finding.

  Also run: M9 (hook silent for everything) and M10 (hook always throws) turn 9 and 11 hook checks red, so the strict helper works; H1 and H10 alone would pass under M9, which is fine because H3 and H4 cover it.
- **Exposure:** 5 of 7 predicted red sets false or understated, 3 mutants unkilled or wrongly attributed, basis: measured on the prototype. Instrument reach: caps at MED and never blocks; the PT-11 procedure (record observed next to predicted) will surface it on day 1, which is why this is a routing, not a gate.
- **Tags:** MED / demonstrated (prototype) / instrument / routine / reversible.
- **Verdict: BREAKS.** Filed as a new Issue.
- **Proof-tests (names):** PT-14a `class-wide-marker-allow-cannot-be-forged-by-a-shell-verb-token`; PT-14b `server-lookup-is-exact-not-prefix-or-longest`; PT-14c `bash-is-routed-to-the-shell-normalizer-record-is-parsed-and-resolved`. The plan's M-table gets the observed sets recorded next to the predicted ones.

### 4. #107 additive fallback: "absent" still rests on a negative exact-line match (UNPROVEN, LOW)

- **What survives (frozen):** call 1 English path is unchanged; the additive prototype passes all 16 existing tests; timeouts, overflow, access denied, status 2, spawn errors and a failing call 2 all rethrow the original error; the recognised-listing rule rejects empty output, blank-only output, a short-form hive spelling, garbage indented lines alone and UTF-16 misdecodes. Classifier run over 22 shapes:

```
key-absent    real captured shape, no Thoth (expect key-absent)
key-listed    real shape + Thoth CRLF / LF / CR / THOTH upper
unrecognised  empty stdout | only blank lines | short-form hive (HKLM) | garbage single indented line | NUL misdecode
key-absent    ThothX only | Thoth\Sub only | Cyrillic lookalike only | 1 MiB of subkeys w/o Thoth (correct: key absent)
key-absent    Thoth line with trailing space / tab / 2-space indent / leading BOM   <== drift on the Thoth line only
```

- **What does not:** the last row. Any drift affecting only the Thoth line (leading whitespace, BOM or NBSP, which JavaScript `\s` classes as an indented value line) reads as "not listed" while the rest of the listing still looks recognised, so central policy is dropped. No real `reg.exe` output has been observed doing this, and no driver is known; the plan's own C5 chooses exact matching over availability for lookalike names.
- **Exposure:** unbounded in principle, basis assumption, so it caps at LOW. Fail direction is the same as round 1's attack 6 but narrowed to a single line.
- **Tags:** LOW / derived / operator / plausible / reversible, silent. Register R-4; trigger: the first captured non-English listing (U-1) or any `reg.exe` output change.
- **Verdict: UNPROVEN-pending-verification.** Command: X-1 and U-1 below.
- **Proof-test PT-16 (optional, LOW) `thoth-line-decoration-never-yields-absent`:** a recognised listing containing a line that is the Thoth path plus leading decoration (indent, BOM, NBSP) rethrows. Trailing decoration is a different registry key name and stays a C5 decision.

### 5. Hook adapter polarity: under Q-B every non-deny result is silent allow (UNPROVEN, LOW)

- **Attack:** before this story the hook emitted an explicit decision on every path, so silence meant a crash. Under Q-B silence means allow. The adapter is untyped `.mjs`, so a gate result the adapter does not recognise is allowed unless it happens to throw.
- **Evidence (prototype adapter, six injected gate returns, real spawn):**

```
gate returns {kind:'error'} (unknown result kind)          exit 2   (TypeError, fail-closed by accident)
gate returns {kind:'verdict', verdict:{outcome:'ask'}}     exit 0   stdout ""   <== silent allow
gate returns undefined                                     exit 2
gate returns null verdict                                  exit 2
gate returns {kind:'refusal'} without reason               exit 0   deny JSON, reason field omitted
gate throws                                                exit 2
stdin ignored (closed)                                     exit 2
```

- **Exposure:** 1 of 7 injected shapes is a silent allow, basis: measured on the prototype; today VerdictOutcome has only allow and deny, so unreachable.
- **Tags:** LOW / derived / operator / plausible / reversible. Register R-5; trigger: the VerdictOutcome union gains a member, or the gate result union gains a kind.
- **Verdict: UNPROVEN.** Proof-test PT-15 `adapter-emits-nothing-only-for-an-exact-allow`: with the gate module replaced in the sandbox copy-tree by one that returns each odd shape, the hook exits 2 or emits a deny for every shape except an exact allow verdict.

### 6. Hook checks read the real registry on a Windows host (UNPROVEN, LOW, instrument)

- The hook is env-immune by design and takes no central-source seam, so the H suite and the locked hook tests spawn the real loader, which spawns the real `reg.exe`. On CI (Linux) the channel is unsupported; on a Windows dev host with a central policy deployed, expected verdicts can flip. My prototype runs did spawn the real `reg.exe` (absent on this host). Tags LOW / code-traced / instrument / plausible / reversible. Register R-6.

## Attacks that survive (frozen)

1. **Marker verb unforgeable from Bash (demonstrated).** 0 marker verbs across 40,008 crafted and random commands, including case variants, quoting, `$V`, `${V}`, command substitution, backticks, escaped and Unicode lookalike tokens, here-docs, `env`, `sudo`, `bash -c`, redirects. Verbs seen: write, delete, get. Depends on N8 (marker set outside KNOWN_VERBS); attack 3 covers N8's discriminating partner.
2. **Identity-target forgery is real and documented (demonstrated).** 61 records carried an mcp identity target from shell input. The plan's rule (allow paired with the marker, deny may be target-only) holds; a forged deny only denies. Attack 1 is the authoring-side gap.
3. **Resolver parse edges (derived, spec model).** All 14 edge names unresolved; prototype-property server names (constructor, toString) also fall out through N7's unknown-class guard (mutant M8, an object-keyed index, stayed green because the guard sits on the marker lookup).
4. **#107 additive core (demonstrated).** 16 of 16 existing central-source tests pass against the additive prototype; English fast path is one spawn, unchanged.
5. **Sandbox harness fidelity (demonstrated).** Copy-tree copies the hook, `src`, fixture and policy at test time, so it cannot drift from the real tree; module-relative paths resolve inside the copy; strict helper rejects crash-as-deny (M10 turns all 11 red).
6. **Locked hook tests (demonstrated).** With the prototype hook, 9 of 10 locked tests pass (AC-1, AC-6, AC-19 untouched); only AC-2 is red, exactly the Q-B amendment the plan schedules. R-B is consistent.
7. **Counts and instruments (demonstrated).** The plan's script logic reproduces 76 (C:11 D:2 G:17 H:11 L:4 M:7 N:12 P:7 S:5). Every npm script the plan names exists in `package.json`. Each check group is marked TW, IMPL or CMD. `qa:completeness-claims` passes on the tree.
8. **File scope (code-traced).** Plan section 15 names zero forbidden files (kernel, registry, shell, cluster, scanner, action catalog, precedence, schema, pin, shipped defaults, tool inventory, workflows, halt relay). The proposed instrument below was validated on synthetic edits (comment-only accepted, code edit rejected, settings comment accepted, PreToolUse addition rejected).
9. **Q-B and crash paths (demonstrated, except polarity).** Exit-2 on stdin closed, gate throw and unknown result kind; round-1 spike results (empty stdout leaves the normal permission flow, exit 1 and timeouts proceed) reused unchanged. Only the polarity point in attack 5 is new.
10. **Round-1 frozen set inherited unchanged:** Q-B stdout integrity, the CLAUDE_PROJECT_DIR seam, registry timeout direction, no accidental activation, the stale-comment list.

## Frozen set (inherited by round 3, if one is needed)

Q-B stdout integrity; CLAUDE_PROJECT_DIR seam; registry timeout fail-closed direction; no accidental activation; stale-comment list; marker verbs unforgeable from shell; identity-target forgery documented; parse edge names; #107 additive core; sandbox fidelity and strict helper; locked hook tests 9 of 10; count 76; file scope; PT-1, PT-6, PT-7, PT-8, PT-9 closed. Re-opening any needs new evidence (a run or a path:line).

## Residual-risk register (accepted, monitored; none of these is a MED boundary-crossing finding)

| # | Residual | Trigger / monitor | Exposure |
|---|---|---|---|
| R-1 | slow or hung `reg.exe`: every call denies after 5 s (10 s additive); availability | any gate call over 2000 ms | nominal p99 254.5 ms (plan S-4); failure state assumption |
| R-2 | English text match retained by the additive ruling | calendar backstop 2026-10-24, or a non-English capture | 0 known cases |
| R-3 | per-call reload: a mid-session policy edit applies at once | any change making policy files session-writable under a live gate | ties to AP-10 |
| R-4 | #107 Thoth-line-only format drift resolves absent (attack 4) | U-1 capture or any `reg.exe` output change | assumption, LOW |
| R-5 | adapter treats any non-deny outcome as allow (attack 5) | VerdictOutcome or gate result union grows | 1 of 7 injected shapes, prototype |
| R-6 | H checks read the real HKLM on a Windows host (attack 6) | a Windows dev host with central policy deployed | plausible |
| R-7 | both AWS MCP servers' tools are unresolved by the double-underscore rule (13 names in this session); availability only | AP-2 and AP-3 classification work, or a change to the resolver | counted 13 |
| R-8 | shell verb resolution is tool-blind (round 1 PT-2); nothing in the plan makes AP-1 carry PT-1 and PT-2 as entry tests | the story that adds baseline allow content | carried |
| R-9 | P5 derives wired-or-not from the tracked settings file only; a local, user or managed settings entry is invisible to it | any wiring outside `.claude/settings.json` | LOW |

## Unrun verifications (owner and command)

| # | What | Command | Owner |
|---|---|---|---|
| U-1 | non-English `reg query` listing bytes | `reg query HKLM\SOFTWARE\Policies` on a de-DE or ja-JP host; save raw bytes | human |
| U-3 | wall clock of a hung registry reader through the built hook | fake System32 reg.exe that blocks; expect deny in about 5 s (10 s additive) | implementer |
| U-5 | matcher regex semantics for the mcp prefix | scratch `claude -p` session with a PreToolUse matcher and a stdio MCP server | Manager or implementer, at activation |
| U-7 | launch fault with type stripping off on CI's Node 22.18.0 | run the G9 probe on CI | implementer |
| U-8 | real `claude -p` session against the built hook for one Bash and one MCP call | at activation | Manager |
| X-1 | a child key the user cannot read is still listed by the parent query | create a scratch key under HKCU, deny read on the child, run `reg query` on the parent and on the child with `/v`; the harness refused the write in this session | human or implementer |
| X-2 | which characters the runtime sanitizes beyond space and dot | scratch `claude -p` session with servers declared as `a:b`, `a+b`, `a b`, `a.b`, an accented name and `a__b`; print `tool_name` from a PreToolUse hook | implementer |
| X-3 | drills M1..M7 on the built code | run the plan's M-table on day 1 and record observed next to predicted (I ran them on a prototype only) | implementer |

The design's own first build task (test-writer authors H and P, RED-CONFIRMED, then the implementer writes N, G, C failing first) is unrun and outranks further plan prose: proceed to it with PT-12 to PT-16 folded into the day-1 failing tests. I am not asking for another plan revision round.

## Proposed diff-scope instrument (attack 8 of the brief), validated on synthetic input

Run after build against the real diff; fail on any hit. The rules: a forbidden-path list (kernel, registry, shell, structured-cluster, shell-scanner, action-catalog, target-format, wrapper-catalog, flag-catalog, precedence, schema, pin, shipped-defaults, tool inventory, workflows, halt relay, the four gate-manifest and purity checks); for the comment-only files (loader, bootstrap-ruleset, central-classification, builtin-tool-inventory) equality of the comment-stripped text before and after; for `.claude/settings.json` equality after deleting the top-level comment key (which catches any hooks change); for the fixture equality after deleting `notes`; for the existing central-source tests and the sessionstart tests, zero deleted lines in `git diff --numstat`. I ran the path rules over the plan's section 15 and the content rules over synthetic edits; the script lives in my scratchpad and is not repo code, so the implementer writes the real one (proof-test S5 could adopt it).

## Issues filed

- New Issue #306: rules inert against the new record shape (attack 1), bug, severity:med, pol, milestone S7.
- New Issue #307: mutation-drill predictions false and named checks that cannot kill M5, M6, M7 (attack 3), bug, severity:med, sur, milestone S7.
- Existing #299 to #305: no new comment needed; none of this round's findings matches them. Attack 2 is a SUSPICION (not filed per the schema; recorded here and in the log).

## Editorial (uncounted, verdict-neutral)

- Plan section 7 counts D1 and D2 (document deliverables) as named checks; the 76 includes them.
- The G numbering skips G12; the plan refers to no G12.
- Section 15 names several files by basename only (`loader.ts`, `bootstrap-ruleset.ts`, `central-source.test.ts`); use repo-relative paths so a script can check them.
- S-6 should state that 5 unresolved is session-dependent (13 in this session) and that AP-3's connector list omits plugin-provided servers.
- Plan section 7 H8 wording lists Bash as a planted read-only entry but its verdict-unchanged clause has no stated expected value; give it one (allow under posture allow).
- AP-1 should name PT-1 and PT-2 as its entry tests.

## The single scariest unproven assumption

That the runtime's tool-name sanitization is a many-to-one map only over space and dot (the only two characters ever observed), so that an exact match on a canonical fixture name is injective; every other character is unmeasured (X-2), and the moment an author lists a canonical name that contains an underscore, any unlisted server can present that name.

## Computed verdict

`go`: 0 valid HIGH under the calibration; 2 BREAKS (MED) and 4 UNPROVEN (2 MED-capped derived, 2 LOW) routed as above. Attacks 1, 2 and 3 route to named failing proof-tests (PT-12, PT-13, PT-14a to c) on build day 1; attacks 4 to 6 go to the register.

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated/operator/plausible/reversible-but-silent][~0% of rules today (0 rules shipped), unbounded per later author rule] author-natural deny rules (marker typo, server target without trailing slash, legacy mutating verbs, declared-vs-sanitized name) load clean and never match the plan's record shape; schema validates string arrays only; central deny silently inert under posture allow
2. [SUSPICION][MED][derived/operator/plausible/reversible][0 of 6 committed entries contain an underscore] injective-or-unresolved covers the fixture side only: a canonical underscore entry (natural copy of the runtime name, e.g. claude_ai_Gmail) is inherited by any unlisted server whose declared name sanitizes to it; SessionStart raw-name versus gate sanitized-name coupling; price understated (13 AWS names unresolved in this session vs the plan's 5)
3. [ISSUE][MED][demonstrated/instrument/routine/reversible][5 of 7 predicted red sets false or understated, 3 mutants unkilled] M5, M6, M7 predictions false as specified: N9 and H11 use a target-scoped allow so M5 stays green (only N8 red); G16 stays green under M6; N3, N4, N5, H4 cannot exercise lookup exactness so M7 survives; PT-14a to c discriminate
4. [SUSPICION][LOW][derived/operator/plausible/reversible][assumption] #107 additive: a drift affecting only the Thoth line (leading BOM, NBSP or indent) still resolves absent while the rest of the listing looks recognised
5. [SUSPICION][LOW][derived/operator/plausible/reversible][1 of 7 injected gate shapes] Q-B polarity: any non-deny outcome from the untyped adapter is a silent allow (outcome ask exits 0 silent); unknown result kind exits 2 only by accident
6. [SUSPICION][LOW][code-traced/instrument/plausible/reversible][plausible on Windows hosts with central policy] hook and H checks spawn the real reg.exe (env-immune, no seam): verdicts can flip on a dev host with central policy deployed
7. [CLEAN][demonstrated] marker verb unforgeable from Bash: 0 of 40,008 crafted and random commands emitted one
8. [CLEAN][demonstrated] identity-target forgery is real (61 records) and documented; allow paired with the marker holds, a forged deny only denies
9. [CLEAN][derived] resolver parse edges: 14 edge names (___, __evil__, edge underscores, empty server, mcp__ alone, case, prefix) unresolved; prototype-property server names fall out via N7 (M8 green)
10. [CLEAN][demonstrated] #107 additive core: 16 of 16 existing central-source tests pass against the additive prototype; timeouts, overflow, status 2, call 2 failure rethrow the original
11. [CLEAN][demonstrated] sandbox harness fidelity and strict helper: copy-tree equals the real tree at test time; M10 (always throws) turns 11 of 11 H red, M9 (always silent) turns 9 red
12. [CLEAN][demonstrated] locked hook tests: 9 of 10 pass against the prototype hook, only AC-2 red as the plan predicts; R-B consistent
13. [CLEAN][demonstrated] count reproduces 76 (C:11 D:2 G:17 H:11 L:4 M:7 N:12 P:7 S:5); every named npm script exists; TW/IMPL/CMD marked per group
14. [CLEAN][code-traced] file scope: section 15 lists 0 forbidden files; diff-scope instrument validated on synthetic edits
15. [CLEAN][demonstrated] Q-B crash paths: stdin closed, gate throw and unknown result kind exit 2; round-1 runtime spikes reused
16. [CLEAN][derived] round-1 frozen set (stdout integrity, project-dir seam, timeout direction, no accidental activation, stale comments) unchanged by the revision
counts (a CHECKSUM): issues=2 suspicions=4 clean=10
evidence (a CHECKSUM): demonstrated=9 code-traced=2 derived=5
round=2 roundsSinceLastGo=0 frozen=18 residuals=9 unrun=8 editorial=6
checks=ran: 16 of 16 central-source tests pass on the additive prototype; 20 of 20 prototype H/N/G checks green on baseline; drills M1-M10 (see table); locked hook tests 9 of 10 pass on the prototype (AC-2 red as planned); no repo test suite run (plan-only artifact)
adr=HIT(37)
report=docs/reviews/s7-kernel-gate-classification-design-challenger-round2-2026-09-26.md
