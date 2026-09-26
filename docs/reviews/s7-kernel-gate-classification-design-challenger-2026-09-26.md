# Design Challenger report: s7-kernel-gate-classification (Phase 1 plan, pre-build)

[design-challenger]
Design Challenger (Apep) - attacking the Phase 1 plan `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md` plus the intake rulings in `docs/plans/s7-kernel-gate-intake-2026-09-26.md`, round 1 of this artifact.

`📊 ADR cache MISS: catalog absent/stale (cached 13c1476 vs current 2095e13) - run node docs/adr-cache.mjs --ensure to build [CACHE=MISS]` (this worktree; the plan's own pass printed HIT at fp 13c1476). ADRs read directly for this pass: SE ADR-0021 (Rules for agents), THOTH-ADR-0001.

Worktree: branch `feat/s7-kernel-gate-classification` at 0a485b3 (detached in an isolated worktree). State: `humanRulingRequired` is not set for this artifact (`docs/.maat-state.json` still names the prior S6 scope; no S7 scope persisted yet), `roundsSinceLastGo` = 0, this is graded round 1, so there is no prior frozen set to inherit. Tier CRITICAL (ratified per the plan section 5).

All probes below ran in this session's scratchpad against the repo code at 0a485b3 on Windows 11, Node 24.15.0, Claude Code 2.1.267. Nothing in the repo was edited except this report and one `docs/REVIEW_LOG.md` row.

## Verdict: computed `go`, with a strongly worded activation gate and a Q-A recommendation to fall back

- No finding calibrates to HIGH. The reason is one calibration fact, stated once: `hooks/pretooluse-kernel-gate.mjs` has no `PreToolUse` entry in `.claude/settings.json`, so no real user's action invokes it today. The rules require a named entry point that a real user's action actually invokes for `reach=user`; wiring is a human step (AP-5), so every finding below is `reach=operator` and caps at MED.
- That cap is a grading fact, not a comfort. Five of the six BREAKS findings would flip to `reach=user` and grade HIGH the moment the wiring entry lands, and the plan itself says the story "fixes the go-live semantics". Manager: treat every PT-n proof-test below as a day-1 failing test for this story, not as a residual.
- Boundary-crossing carve-out applies (each of these weakens the gate's own self-protection or the central trust boundary): none of the MED findings below may route to the residual register; each routes to a named failing proof-test.
- Q-A recommendation (detail at the end): fall back to option Y. The Manager's own ruling condition ("if the attack stands, fall back to option Y") is met by a demonstrated end-to-end chain.

## Attacks, ranked by blast radius (exposure x irreversibility x silence)

### 1. Q-A option X: the shipped allow rules let a shell call take over the gate's own policy (BREAKS)

- **Attack:** the two shipped allow rules of option X each accept a shell call they should not, and chained they overwrite `.thoth/policy.json`.
- **Implicit assumption broken:** "`tool/read-only/` is a namespace only the class normalizer can write" and "verbs read/list/describe/get mean a non-mutating command".
- **Scenario (who does what):** a prompt-injected or adversarial agent issues two Bash calls under a live gate with shipped option X.
  - Mechanism A (namespace collision). `targets: ["tool/read-only/"]` with no verb constraint is matched by the kernel's prefix rule against every target of every normalizer (`src/policy/kernel/kernel.ts:121`). The shell normalizer copies a redirect target verbatim into `targets`, so `echo x > tool/read-only/f` produces verbs `["write"]`, targets `["tool/read-only/f"]`, `unresolved: []` and the class allow rule fires. A `..` traversal after the prefix stays a prefix match.
  - Mechanism B (tool-blind verb). The shell normalizer computes the binary name and never uses it for verb resolution (`src/policy/normalizer/shell.ts:438`; verb comes from the first positional token, `src/policy/normalizer/shell.ts:329`). So `<any binary> get a/b --context=x` resolves to verb `get`, and the rule with `verbs: [read, list, describe, get]` and no targets allows it. `mkdir get -p tool/read-only --context=x` is such a call and really creates directories.
  - Chain, run for real against git-bash: step 1 (mkdir) allowed by mechanism B creates `tool/read-only`; step 2 `echo '<allow-all policy JSON>' > tool/read-only/../../.thoth/policy.json` is allowed by mechanism A and the file is overwritten; the loader then merges the new project rule and `kubectl delete pods/prod-db --context=prod` flips from `deny [default]` to `allow [p]`.
- **Evidence (raw):** probe `p13.mjs` (real normalizer, real kernel, real `loadEffectivePolicy`, real `bash -c` in a scratch dir):

```
0. before                  : deny [default]
gate says allow [sur03-non-mutating-verbs-allow] <= mkdir get -p tool/read-only --context=x
gate says allow [sur03-read-only-class-allow]    <= echo '{"version":"1","rules":[{"id":"p","effect":"allow"}]}'
policy.json now: {"version":"1","rules":[{"id":"p","effect":"allow"}]}
1. after the two allowed calls: allow [p]
```

  Also `p1.mjs`: `echo pwn > .thoth/policy.json` is `deny` (no rule), `echo pwn > tool/read-only/../../.thoth/policy.json` is `allow [sur03-read-only-class-allow]`, `rm get a/b --context=x`, `curl get a/b --context=x`, `python get a/b --context=x` are all `allow [sur03-non-mutating-verbs-allow]`. Git-bash needs the intermediate directories to exist (a bare `>` through a missing `tool/read-only` fails with ENOENT, demonstrated), which is exactly why step 1 matters; PowerShell resolves `..` lexically with no directories (demonstrated), but the PowerShell tool is not a Bash call and reads unclassified.
- **Exposure:** 2 of 2 shipped option-X allow rules are exploitable (counted in code and demonstrated); 1 of 1 attempted chains succeeded end to end; basis measured. It applies to every Bash call under the prefix `tool/read-only/` and every kubectl-shaped call with first positional `get`.
- **Current defense:** the plan's H7 ("a POL-05 command is still denied") cannot see this class of bug because POL-05 fires before rules; Q-B means the user prompt still runs for an allowed call, which limits the blast to bypass-mode, allow-listed Bash, or a user who approves. An option-X allow is only a "gate does not deny", not an approval.
- **Tags:** severity MED / evidence demonstrated / reach operator (activation is a human wiring step; would be `user` HIGH on wiring) / likelihood plausible / undo runbook-reversible (`git checkout` of the policy file, but the divergence is silent).
- **Verdict: BREAKS.** Existing Issue #299 (architecture-reviewer, rated HIGH; same defect as mechanism A) now carries my comment adding mechanism B and the chain. My MED versus their HIGH is only the reach cap above; both route to the same day-1 tests.
- **Proof-tests (must fail on the current plan, pass before build):**
  - **PT-1 `shipped-class-allow-cannot-be-forged-by-a-shell-target`:** with the shipped defaults as they would be built, through the real hook, each of `echo x > tool/read-only/f`, `echo x > tool/read-only/../../.thoth/policy.json`, and the same two shapes with `tool/workspace-mutating/` and `tool/remote-mutating/` prefixes returns a deny whose ruleId is not any `sur03-*` allow rule.
  - **PT-2 `a-read-verb-does-not-authorize-a-different-binary`:** through the real hook, `mkdir get -p x/y --context=z`, `cp get a/b --context=z`, `rm get a/b --context=z` are denied, while `kubectl get pods/x --context=z` stays allowed (locked AC-2). As the plan is written this cannot pass without a change to `shell.ts`, which the plan lists as zero-diff. Routing for PT-2: `architecture-reviewer` and the Manager (either drop the verb allow rule and amend locked AC-2, or a normalizer change under the ADR-0021 route). I do not prescribe which.
  - **PT-3 `two-allowed-calls-cannot-rewrite-the-policy-files`:** replay the chain above in a scratch project; after both calls `.thoth/policy.json`, `src/policy/config/shipped-defaults.json` and `docs/qa/s5-central-classification.json` are byte-identical and at least one call was denied.

### 2. The hook fails open when it dies before its own try/catch: exit 1 is non-blocking, and the plan's SUR-10 table does not see it (BREAKS)

- **Attack:** the plan's R11 table records "internal exception: exit 2 (unchanged)". The shipped hook's own header claims the entire body runs inside one try/catch. The static imports do not (`hooks/pretooluse-kernel-gate.mjs:47-50`); the try/catch is `main().catch` at `hooks/pretooluse-kernel-gate.mjs:126`. The S7 hook adds more static imports (gate module, loader, central source, classification, printer types).
- **Scenario:** any condition that fails the module graph or the launcher exits with a code other than 2: Node older than the TypeScript type-stripping floor, a renamed or broken module in the import chain, `node` absent or shadowed on the hook's PATH. Claude Code treats a non-2 non-zero exit as a non-blocking error and runs the tool call. The failure is total (every gated call) and silent.
- **Evidence (raw), two parts.**
  - Fault injection against the shipped hook (`p12.mjs`, classification uses Claude Code's exit-2 / deny-JSON blocking contract):

```
baseline: valid delete call (bootstrap allow today)             | PROCEEDS (exit 0, no deny)
F1 node without TS type-stripping (old/unflagged runtime)       | PROCEEDS (non-blocking exit 1) | 69 ms
F2 a static import target missing/renamed (hook copied w/o ../src) | PROCEEDS (non-blocking exit 1) | 75 ms
F3 empty stdin                                                  | BLOCKS (exit 2)
F4 invalid JSON stdin                                           | BLOCKS (exit 2)
F5 tool_name is a number                                        | BLOCKS (exit 0 + deny JSON)
F6 interpreter not on PATH (command not found via shell)        | PROCEEDS (non-blocking exit 1) | 31 ms
F7 ~64KB redirect-dense command (see attack 3)                  | PROCEEDS (timeout)             | 20037 ms (capped)
```

  - Real runtime confirmation on Claude Code 2.1.267 (scratch project, PreToolUse hook on Read that appends a marker file then `process.exit(1)`): marker file written (hook ran), and the Read tool still returned the canary text. Same session type with a hook whose declared `timeout` is 3 s and which would deny after 20 s: hook started, no deny reached the transcript, canary returned. So both "exit 1" and "timeout" proceed on this runtime.
- **Exposure:** unbounded in the failure state (100% of gated calls while the condition holds), 3 unnamed launch fail-open paths (F1, F2, F6) found by 7 injected faults (counted; F7 is the already-named hook-timeout path); SUR-10's row names nine paths (`REQUIREMENTS.md:466`) and none is "process fails before its try/catch". Basis: measured.
- **Current defense:** none in the hook. G9 asserts set equality with the nine names parsed from the SUR-10 row and that each row names an existing test id; it is structurally unable to notice a fail-open that is not among the nine. The existing header comment states the try/catch guarantee as if it covered launch.
- **Tags:** MED / demonstrated / operator (would be user on wiring) / plausible (Node drift, a broken merge, PATH) / runbook-reversible (fix the environment) but silent.
- **Verdict: BREAKS.** Filed as Issue #303.
- **Proof-test PT-4 `hook-launch-failure-blocks`:** drive the exact command string the manifest will carry (not just the script) under (i) `node --no-experimental-strip-types`, (ii) the hook copied to a tree without `../src`, (iii) an interpreter name that does not resolve: each must end in a blocking outcome (exit 2, or exit 0 with a deny JSON), or the plan must record the decision that it does not and cite the mechanism that makes activation safe. Additionally G9's list must be produced from a fault-injection instrument (the `p12.mjs` shape), not from parsing the nine names.

### 3. Input size turns the gate's own parser into a bypass: quadratic redirect scan versus the 60 s timeout and the 2000 ms budget (BREAKS)

- **Attack:** OPS-03 requires the budget to be met "on the largest realistic input" and says exceeding the hook timeout is a bypass. The plan measures p99 on a benign `kubectl get` (254.5 ms) and the latency corpus is four short commands.
- **Evidence (raw):** `extractRedirectTargets` (`src/policy/normalizer/shell-scanner.ts:383`) is quadratic in live redirect operators. In-process `normalize("shell", ...)` timings (`p8.mjs`):

```
redirects   8007B:272ms  16007B:1096ms  32007B:4677ms  64007B:22281ms
append      10007B:342ms  20007B:1540ms  40007B:6714ms  80007B:28376ms
fddup       10007B:775ms  20007B:3041ms  40007B:12401ms   (the idiom 2>&1)
```

  Doubling the input quadruples the time. Extrapolated from the fit: the 2000 ms OPS-03 ceiling is crossed at about 16 KB (measured: 20 KB of `2>&1` is 3.0 s), the 60 s hook timeout at about 90 to 105 KB. The shipped hook itself, given a 160 KB redirect command, was killed at the 20 s test cap (`p7.mjs`). The other shapes tried (quotes, heredocs, tokens, escapes, `$x`, semicolons, `&&`, `<`) stayed under 300 ms at 280 to 860 KB.
- **Scenario:** a prompt-injected command padded to about 100 KB with `2>&1` or `> f` repeated outruns the timeout; the runtime then lets the call through (confirmed above), so the payload rides in the same command.
- **Exposure:** commands of roughly 90 to 105 KB with about 22,000 to 26,000 redirect operators bypass; commands of roughly 16 KB and up with a few thousand exceed the OPS-03 budget; basis measured for the curve, extrapolated for the 60 s crossing (state it as extrapolated).
- **Current defense:** none for size; the CI latency check discards the child's exit status and stdout entirely (`src/qa/gate-latency-budget-check.ts:78-84`), so a crashed or truncated run also passes.
- **Tags:** MED / demonstrated / operator (would be user) / plausible (adversarial input, no exotic precondition) / irreversible if the padded call is destructive.
- **Verdict: BREAKS.** Pre-existing in the S4 normalizer, but this story is the one that makes the gate live-capable and claims R12 and the hook-timeout row; filed as Issue #304.
- **Proof-test PT-5 `gate-time-does-not-grow-quadratically`:** through the real hook, redirect-dense commands of 16 KB, 64 KB and 128 KB each return a deny or allow in under 2000 ms wall time each (or are denied by a size rule before parsing), and `time(64 KB) / time(16 KB) < 8`. The `qa:gate-latency-budget` corpus gains a 128 KB entry and asserts per iteration that the child exited 0 or 2 with a parseable decision.

### 4. Central posture deny does not stop a project allow rule: the planned print line is truthful about the scalar and misleading about the verdict (BREAKS)

- **Attack:** the plan's G7, P2 and section 8a treat "posture: deny (source: central)" as central control. Rules beat the default outcome, and a rank-0 project layer supplies rules.
- **Evidence (raw):** `p4.mjs`, real `loadEffectivePolicy` and `decide`, command `kubectl delete pods/x --context=prod`:

```
A shipped X only                                             posture=deny/shipped-defaults => deny -
B project allow-all rule                                     posture=deny/shipped-defaults => allow p
C central posture deny, project allow-all rule               posture=deny/central => allow p
D central posture deny + mandatory deny-all, proj allow-all  posture=deny/central => deny c-deny
E project redefines shipped rule id to all targets           posture=deny/shipped-defaults => allow sur03-non-mutating-verbs-allow
F project posture allow (peer relax of shipped deny)         posture=allow/project => allow -
G central posture deny, project posture allow                posture=deny/central => deny -
```

  Row C is the trust wound: the operator sees central deny, the effective verdict is allow. Row G is what the plan's "243 combinations, zero relax violations" and G7 actually cover: the scalar only.
- **Exposure:** 1 of 1 central-deny-plus-project-rule configurations tried resolves allow (counted, real loader); every session that has a project policy file with at least one allow rule.
- **Current defense:** the printer lists resolved rules with layer and origin, so a diligent operator can see rule `p` from `project`; the R4 line itself says nothing about rules.
- **Tags:** MED / demonstrated / operator / plausible / runbook-reversible; silent divergence between the printed posture and the verdict.
- **Verdict: BREAKS.** Existing Issue #301 (architecture-reviewer, MED); I confirmed it independently and commented.
- **Proof-test PT-6 `central-posture-line-does-not-overstate-control`:** central declares `defaultOutcome: deny`, project declares a rule with `effect: allow` and no verbs or targets: through the real loader either the verdict for `kubectl delete pods/x --context=prod` is deny, or `PrinterResult` (and the CLI output) names the overriding in-repo allow rule ids and their layer. Add the same test for a project redefinition of a shipped rule id.

### 5. The central fixture is now an enforcement source, and it can reclassify a built-in tool (BREAKS)

- **Attack:** THOTH-ADR-0001's "the merged PR diff is the approval" ruling and the CLAUDE.md exception for entry-only fixture edits were made while class drove nothing (its own residual row "Inert classification"). Once class grants the allow, one fixture line is an enforcement change with no dated review report.
- **Evidence (raw):** `p10.mjs`, real fixture parser and real `mergeToolClassificationLayers` (`src/policy/rule/precedence.ts:46` region; central wins by name):

```
Write     -> read-only (source layer: central)
Edit      -> read-only (source layer: central)
Bash      -> read-only (source layer: central)
Task      -> read-only (source layer: central)
WebFetch  -> remote-mutating (source layer: shipped-defaults)
```

  The parser (`src/policy/tools/central-classification.ts`) accepts any string name and any valid class, including the built-ins in `src/policy/tools/builtin-tool-inventory.ts:73`. Under option X a `read-only` class is allowed by rule, so `Write` and `Edit` (the tools the plan relies on to protect the policy files, section 8a) are switched off by one fixture entry. The same edit also passes SessionStart, so nothing halts. The plan's flip tests H5 and H6 flip an MCP server only. Existing Issue #300 (architecture-reviewer, HIGH) covers the sibling case that a reclassification also detaches a central per-server deny rule (the class is a segment of the target); this finding is the built-in override, which #300 does not mention.
- **Quantification of what the ruling now permits:** 6 entries today (counted in `docs/qa/s5-central-classification.json`); a one-line flip changes the verdict for every tool of that server (unbounded tool count); a one-line new entry both suppresses the SUR-03 halt and grants the class allow; a one-line built-in override changes one of the 19 vendored built-ins per entry (counted in `docs/qa/tool-inventory.json`). The fixture is read from the project working tree each call, so a checkout or pull applies it immediately.
- **Environment seam (part of the brief):** `CLAUDE_PROJECT_DIR` is set for hooks and hook cwd stayed at the project root after a shell `cd sub` (Claude Code 2.1.267, probe `p9.mjs`, two PreToolUse payloads both `procCwd` = project root and `projDir` set). The model cannot steer the fixture path through cwd or env on this runtime. SURVIVES (item C-2 below).
- **Print line:** "in-repo layer, not centrally enforced" is attached to the posture only; nothing in the plan discloses that the class catalog itself comes from an in-repo file. Not enough.
- **Tags:** MED / code-traced (merge demonstrated; the decision is derived from the plan) / operator / plausible / runbook-reversible; PR-diff review is by discipline only (`master` has no branch protection per the ADR's own residual table).
- **Verdict: BREAKS.** Filed as Issue #305. Q-C stays human-only and blocks activation; the proof-test below is a build-time condition regardless.
- **Proof-test PT-7 `fixture-cannot-lower-a-builtin-class`:** with a fixture entry `{ name: "Write", class: "read-only" }` (and Edit, Task, Bash) the gate still denies Write and Edit, or the loader rejects the entry, and the print surface names that a classification override exists; plus an MCP flip test whose fixture edit also carries a central per-server deny (Issue #300's G10).

### 6. #107 additive variant: the negative-match "absent" is fail-open under format drift (UNPROVEN)

- **What survives the additive ruling:** the English text path is untouched, so today's behavior and tests are unchanged on English hosts; timeouts, output overflow, access denied, non-REG_SZ types, and a failing parent listing all throw (fail-closed) in the plan's own prototype cases; the additive present path is one spawn and is cheaper than the replace design. See item C-5 below.
- **What does not:** the new step resolves `absent` when the parent listing succeeds and the key line is not found. That is a negative match on parsed text. On a host where the listing format differs from the one captured here (only this English host was ever observed; S-5 says no non-English sample can be captured), an unrecognised listing reads as "key not listed" and central policy is silently dropped, where the same host today throws. The English path fails closed on a mismatch (positive match); the new path fails open on one.
- **Plan revision required (C1 to C12 under the additive ruling), also filed on #302:**
  - C1 and C2 as written contradict the additive design (English text does resolve absent, in one runner call with the original args; "no stderr text can produce absent" is false by design and would only pass if re-scoped to the second call, where it proves nothing).
  - C3 (present via key listing) is reachable only in an inconsistent state now; the real present path is call 1 exit 0 and is already tested.
  - C10 must assert up to three calls, each with the absolute path, exact args, no shell and the `["ignore","pipe","pipe"]` stdio, and the worst-case total (3 x 5 s = 15 s) belongs in the R11 hook-timeout row.
  - The S-5 numbers (p50 29.8 ms absent, 104.2 ms present) were measured on the replace prototype; the additive variant has not been prototyped or measured.
  - R9's literal wording is "either capture a verified sample or replace the text match". Additive does neither; the decisions row must say R9 is discharged by a different route, by the Manager's ruling.
- **Evidence tier:** derived (the variant is unbuilt); I could not run the drift case on a non-English host.
- **Exposure:** unbounded for hosts whose `reg query` listing format differs; basis assumption (no measurement possible here) so it caps at MED and, by the carve-out, routes to a test rather than the register.
- **Tags:** MED / derived / operator / plausible / runbook-reversible; silent.
- **Verdict: UNPROVEN-pending-verification.** Command that would settle it: on a non-English Windows host, `reg query HKLM\SOFTWARE\Policies` and `reg query HKLM\SOFTWARE\Policies\<a known subkey>`; owner: ops or human with such a host. Until then:
- **Proof-test PT-9 `registry-absence-requires-a-recognised-listing`:** fake runner where call 1 exits 1 with non-English text and the parent listing exits 0 with (a) empty stdout, (b) a header line in a different script, (c) the queried parent path missing from the header: each throws; a recognised listing that lacks the key gives absent; call 1 failed but the key listing shows the value present (inconsistent) throws.

### 7. Sanitizer lookup: the runtime name is lossy, and an underscore defeats the trailing-delimiter anchor (UNPROVEN)

- **Attack:** the plan anchors the server match with `mcp__<sanitized entry>__` and calls that unambiguous (N4 tests only a hyphen case). The runtime name maps space and dot to `_` (S-1 observed), keeps `_`, so `my server`, `my.server` and `my_server` are indistinguishable at the gate, and a server `docs_` (tool `x`) or `docs__evil` produces a name that still starts with `mcp__docs__`.
- **Evidence (raw):** spec model of the plan's section-4 algorithm (`p14.mjs`, not repo code, the normalizer is unbuilt), with a hypothetical read-only entry `docs`:

```
UNLISTED server named 'docs_' (tool 'x')                 -> read-only via entry "docs"
UNLISTED server named 'docs__evil' (tool 'x')            -> read-only via entry "docs"
UNLISTED server 'my_server' (entry is 'my server')       -> read-only via entry "my server"
real runtime name from this session (aws-mcp-server ...)  -> remote-mutating via entry "aws-mcp-server"
```

  Real runtime names from this session's tool list contain three underscores after the delimiter (`mcp__aws-mcp-server__aws___get_regional_availability`), so a rule that simply rejects a second `__` would deny real tools.
- **Why it matters little today and could later:** every shipped entry is `remote-mutating` (deny), so an unlisted server inheriting it is an availability effect only; a read-only MCP entry (which the plan's H5 and H6 create in tests) is the case where inheritance grants an allow. SessionStart also halts on the exact unlisted name, but that is a session-level relay, not a per-call check, and a server added after SessionStart is only seen by the gate.
- **Exposure:** 0 of 6 shipped entries are read-only (counted in the fixture), so 0% today; grows with the first read-only entry.
- **Tags:** MED / derived / operator / plausible / reversible. **Verdict: UNPROVEN.** The other unobserved sanitizer characters (the plan lists them as backlog) mismatch toward deny, which is fail-closed.
- **Proof-test PT-10 `lossy-server-segment-cannot-grant-an-allow`:** with a read-only entry `docs`, `mcp__docs___x` and `mcp__docs__evil__x` are denied (or unresolved); with a read-only entry whose name changes under sanitization (`my server`), `mcp__my_server__x` is denied; and the real runtime names `mcp__aws-mcp-server__aws___get_regional_availability` and `mcp__claude_ai_Gmail__send_message` (both taken from this session's tool list) resolve as designed (remote-mutating and unclassified).

### 8. Named checks that cannot fail, sampled (BREAKS as a group, instrument reach)

I sampled 14 of the 58 named checks. Each was read against the code it depends on; where a mutation could run cheaply I ran it.

| Check | Can it fail? | Evidence |
|---|---|---|
| H2, H3, H4, H8 ("is denied") | Only weakly. If written with the locked helper, a hook that crashes on every non-Bash call passes. | `hooks/pretooluse-kernel-gate.test.ts:57-61`: `wasDenied` returns true for exit code 2 as well as a deny JSON. |
| H1 ("exit 0, decision present and not deny") | Cannot be satisfied under Q-B (emit nothing on allow) and, by itself, passes for a hook that always exits 0 silently. | Plan H1 versus H9; Q-B. Editorial for the wording, instrument for the strength. |
| H7 ("Bash verdict independent of Bash's class entry: a POL-05 command is still denied") | Vacuous. POL-05 fires before any rule or class is consulted, so the test passes even if the hook read Bash's class. | `src/policy/kernel/kernel.ts:167` decide order, code-traced. A resolved mutating command (`kubectl delete pods/x --context=c`) would discriminate. |
| L1, L2, L3 (latency) | Cannot fail for a crashed hook, and never see large inputs. | `src/qa/gate-latency-budget-check.ts:78-84` discards status and stdout; corpus is 4 short commands. |
| G9 (SUR-10 set equality) | Cannot see a fail-open outside the nine names; it is green while attacks 2 and 3 are demonstrable. | Fault-injection table above versus `REQUIREMENTS.md:466`. |
| M3 (mutation: hook re-hardcodes the bootstrap outcome; "G3, G7 go RED") | Its predicted red set is wrong. G3 and G7 inject the loader into the gate module and never run the hook wiring, so they stay green. H2 or H3 (hook level, under the shipped deny posture) would go red. | Plan section 4: gate takes injected `loadPolicy()`; code-traced (derived: the module is unbuilt). |
| P5 (disclosure text true iff no PreToolUse entry) | Passes both ways if it asserts with a regex: the current text already contains "not necessarily what ... enforces live". | `src/policy/config/printer.ts:30-31`. Needs exact-string equality against two constants, with a temp settings copy toggled. |
| C2 | Contradicts the additive ruling (see attack 6). | #302. |
| N7 / M1 / S2 (CMD one-shots) | Not permanent tests; S2's four qa checks pass with zero or any `PreToolUse` entry. | `src/qa/gate-manifest-check.ts` counts files with a top-level hooks key, nothing else. Only P5 pins the wiring state. |
| H10 (no filesystem-write API in hook and gate module) | A source scan is blind to aliasing and to the loader path it calls (the registry reader spawns a process). | Instrument reach. |
| H5 / H6 / M1 (class flips) | Non-vacuous. The not-denied direction requires exit 0 with no deny, so a crash fails it. | Positive control. |
| G1, G4, G5, G6 | Non-vacuous on their face (tables typed over the failure kinds, both directions asserted). | Read only. |
| S3 (stale-comment scan, "0 stale hits") | Non-vacuous for the set it names. A broader grep I wrote (S6's job, drives no, presence-only, until S6, future story's job and others) found no additional stale file beyond the plan's list. | Ran both greps; same set of files. |
| P4 (stdout unchanged) | Redundant but harmless; the locked exact-equality tests already enforce it. | Read only. |

- **Tags:** MED / code-traced / instrument / routine / reversible; instrument reach caps at MED and never blocks.
- **Verdict: BREAKS** (the checks named above); not a product defect.
- **Proof-test PT-8 `hook-denials-are-policy-denials-not-crashes`:** every hook-level deny assertion (H2, H3, H4, H8) requires exit 0, stdout that is exactly one JSON object with `permissionDecision: "deny"`, a reason that names a ruleId or POL-05, and an empty stderr; H7 uses a resolved mutating command; the latency instrument fails on a non-0 non-2 exit or an unparseable decision.
- **Proof-test PT-11 `predicted-red-sets-are-true`:** the mutation drills M1 to M4 are executed once on day 1 and the observed red set is recorded next to the predicted one; P5 uses exact-string equality with both wired and unwired texts.

## Attacks that survive (frozen)

- **C-1. Q-B, emit nothing on allow (SURVIVES, demonstrated).** Empty stdout with exit 0 leaves the normal permission flow (plan S-2, observed). The deny JSON is the only blocking signal, so I tried to truncate it: a deny whose reason is 4,000,252 bytes was delivered intact and parseable through a pipe read 1.5 s late on Windows (`p6.mjs`), and with a fast reader at 10, 1,000, 60,000, 200,000, 1,000,000 and 4,000,000 bytes (`p5.mjs`). Caveat that is not a finding: the deny JSON must be the only thing on stdout, which PT-8 pins.
- **C-2. Environment seam for the fixture path (SURVIVES, demonstrated).** As in attack 5: `CLAUDE_PROJECT_DIR` is set and hook cwd does not follow a shell `cd` (Claude Code 2.1.267). THOTH-ADR-0001 rule 5 holds on this runtime.
- **C-3. The 5 s reg.exe timeout versus 60 s and 2000 ms (SURVIVES for fail-open, code-traced).** `central-source.ts:249` bounds each call at 5,000 ms and a timeout throws (status null), which the loader turns into a read-error deny; the worst case 5 s (one call) or 15 s (three calls, additive) is far below 60 s. It does exceed OPS-03's 2000 ms in the failure state, an availability cost, recorded in the residual register with a trigger. I could not demonstrate a real hung `reg.exe` (a node.exe copy renamed reg.exe aborted with status 134 instead of hanging), so the wall-clock behavior of the kill on Windows is an unrun verification, not a finding.
- **C-4. Activation cannot happen by accident in this story (SURVIVES, code-traced).** `.claude/settings.json` has exactly one manifest and no `PreToolUse` entry; the only references to the hook script are its own files, its tests, the latency check and comments (grep); the plan's changes to settings are comment lines. The `qa:gate-*` checks cannot detect an added entry (they pass with or without one), so the permanent guard is P5 plus S2's diff; a regex `mcp__.*` matcher would trip the matcher-drift check (fail-closed for activation). The 23 unvendored runtime tools stay a blocked activation precondition (AP-2); I re-confirmed the runtime built-in list differs from the vendored 19 (this session's own tool list includes `Skill`, `ToolSearch`, `PowerShell`, `Monitor`).
- **C-5. The additive #107 error handling (SURVIVES, derived).** English text still resolves absent in one call; timeouts, overflow, denied, invalid syntax and non-REG_SZ throw; lookalike subkeys and case are exact-match concerns C8 and C9 already cover. The one weak point is attack 6.
- **C-6. Stale-comment instrument (SURVIVES, demonstrated).** See the S3 row above.

## Frozen set (inherited by round 2)

Q-B stdout integrity and empty-stdout semantics; the `CLAUDE_PROJECT_DIR` fixture-path seam; the reg.exe timeout fail-closed direction; no accidental activation path in this story; the stale-comment list; plus every PT-n below once its test is green. Re-opening any of these needs new evidence (a run or a `path:line`).

## Residual-risk register (accepted, monitored)

| # | Residual | Trigger / monitor | Exposure |
|---|---|---|---|
| R-1 | A hung or slow `reg.exe` makes every call deny after 5 s (15 s additive), exceeding OPS-03's 2000 ms in the failure state; availability only, not a bypass | any recorded gate call over 2000 ms; backlog item "per-call reg.exe timeout shorter than 5000 ms" | measured p99 254.5 ms nominal (plan S-4); failure state assumption |
| R-2 | English text match false positive retained by the additive ruling (already ratified residual for #107, calendar backstop 2026-10-24) | the backstop date; a non-English capture | 0 known cases |
| R-3 | Per-call reload means a mid-session policy edit takes effect at once (a design choice, no cache) | any change that makes the policy files session-writable under a live gate | ties to PT-3 |
| R-4 | Plan H1 wording ("decision present") contradicts Q-B; and the plan's count "58" is a hand count by grep | test-writer authoring pass | editorial |

None of the six BREAKS findings and none of the three UNPROVEN findings may sit here (boundary-crossing carve-out); they are PT-1 to PT-11.

## Unrun verifications (owner and command)

| # | What | Command | Owner |
|---|---|---|---|
| U-1 | Non-English `reg query` listing format | `reg query HKLM\SOFTWARE\Policies` and one child key on a de-DE or ja-JP host; save raw bytes | human / ops |
| U-2 | Additive #107 against a real `reg.exe` with the text match forced off (drives steps 2 and 3) and the drift cases | implementer prototype with an injected runner mirroring `central-source.ts`; N=30 timing | implementer |
| U-3 | Wall clock of a hung `reg.exe` through the built hook | fake `SystemRoot\System32\reg.exe` that blocks (not a renamed node.exe), run the built hook, expect deny under about 5 s | implementer |
| U-4 | PT-1, PT-2, PT-3 against the built hook | day-1 failing tests in `hooks/`; `node --test hooks/` | test-writer |
| U-5 | Matcher regex semantics for `mcp__.*` (never tested, AP-4) | scratch `claude -p` session with a PreToolUse matcher `mcp__.*` and a stdio MCP server | Manager or implementer at activation |
| U-6 | The plan's 58 count | a script that counts the named-check rows in section 7 (CLAUDE.md completeness rule) | implementer |

The design's own first build task (write N, G, C failing first) is unrun and outranks any further prose; the PT-n tests are additions to that list, not a substitute.

## Q-A recommendation: fall back to option Y (no shipped policy content) in this story

Reasons:
1. Both option-X allow rules fail a demonstrated proof: rule 1 is forgeable by a shell target and detachable by a fixture edit (#299, #300); rule 2 accepts any binary of kubectl shape. Rule 2 cannot be repaired inside the plan's own zero-diff file set (PT-2), and rule 1 is repairable by rule data but only with several interacting conditions (#299, #300, #301).
2. Baseline allow content is activation precondition AP-1 anyway. Shipping it now freezes wrong content inside a sensitive area (`src/policy/config/shipped-defaults.json`, policy delivery) with the deny posture that makes the mistakes matter, before a filesystem normalizer, a tool-bound verb rule, or a central source exist.
3. The hook stays unwired, so option Y loses no live protection.

Costs of Y the plan does not state, so the Manager is not surprised:
- Under Y the resolved posture is bootstrap `allow`, so a workspace-mutating tool such as `Edit` is allowed by the gate. The locked test "AC-19: tool_name Edit denies" (`hooks/pretooluse-kernel-gate.test.ts:149`) would go red. Amending it inverts a locked assertion and needs a Manager or human ruling under SE ADR-0005 ("MUST NOT delete or weaken a failing test").
- H2, H3, H5 and H6 cannot be black-box hook tests, because the hook takes the shipped defaults module-relative and env-immune, so a test cannot inject policy. R1 ("flipping a class turns a named test red") is then proved by the in-memory gate tests G4 and N1, which the plan already has, plus a hook smoke that an unclassified name is denied (POL-05 denies regardless of posture).
- If the Manager prefers to ship the deny posture now, the minimum acceptable is X only when PT-1, PT-2 (which needs the out-of-scope normalizer decision), PT-6 and #300's G10 are green before build; that is a different, larger story.

## Editorial (uncounted, verdict-neutral)

- Plan section 7 H1 says "decision present" while H9 and Q-B say nothing is emitted on allow.
- Plan section 9 header says the hook timeout row is a runtime property "not testable"; two probes above test it on the real runtime.
- The hook header (`hooks/pretooluse-kernel-gate.mjs`) says the entire body runs inside one try/catch; the imports do not (fix as part of the header rewrite the plan already schedules).
- The plan cites the ADR cache as HIT at fp 13c1476; the worktree's own run printed MISS at 2095e13.

## The single scariest unproven assumption

That the runtime's `tool_name` mapping is stable and injective enough for a lossy server-segment lookup to carry allow authority: only two special characters were ever observed (space and dot), the gate cannot tell `my server` from `my_server`, and the `mcp__.*` matcher form was never tested.

## Computed verdict

`go` (no valid HIGH under the calibration; 6 BREAKS and 3 UNPROVEN at MED or below, all routed to PT-1 through PT-11 under the boundary-crossing carve-out). Q-A: fall back to option Y.

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated/operator/plausible/runbook-reversible][2 of 2 option-X allow rules exploitable, 1 of 1 chain succeeded] Q-A option X: shell redirect target forges the tool/read-only/ class prefix and any binary shaped "get a/b --context=x" passes the verb allow; chained they overwrite .thoth/policy.json and the next kubectl delete resolves allow; defense is only Q-B's remaining user prompt (would be HIGH on wiring; #299 commented)
2. [ISSUE][MED][demonstrated/operator/plausible/runbook-reversible][unbounded in failure state, 3 unnamed launch fail-open paths in 7 injected faults] hook exit 1 before its try/catch (old Node, missing module, no interpreter) is non-blocking on Claude Code 2.1.267 and is not among SUR-10's nine; G9 cannot see it (Issue #303)
3. [ISSUE][MED][demonstrated/operator/plausible/irreversible][commands of about 90-105 KB outrun 60 s, about 16 KB exceed 2000 ms; curve measured, crossing extrapolated] quadratic extractRedirectTargets makes a padded redirect command time out the gate, and a timed-out hook lets the call run; CI latency check ignores exit status and uses tiny inputs (Issue #304)
4. [ISSUE][MED][demonstrated/operator/plausible/runbook-reversible][1 of 1 central-deny plus project-allow-rule configs resolves allow] central posture deny is overridden by a project allow rule or a redefined shipped rule id while the print line says "posture: deny (source: central)" (#301 commented)
5. [ISSUE][MED][code-traced/operator/plausible/runbook-reversible][6 fixture entries today, a one-line edit changes a whole server or one of 19 vendored built-ins] central fixture can reclassify built-ins (Write, Edit, Task to read-only) so a PR-diff-approved line disables the class gate; H5/H6 flip MCP only (Issue #305; sibling #300)
6. [ISSUE][MED][code-traced/instrument/routine/reversible][14 sampled of 58 named checks, 5 weak or vacuous] wasDenied accepts exit 2, H7 passes via POL-05, latency instruments ignore exit status and large inputs, G9 blind to unnamed paths, M3 predicts the wrong red set, P5 can pass both ways
7. [SUSPICION][MED][derived/operator/plausible/runbook-reversible][unbounded, basis assumption] additive #107: the new step resolves absent on a negative parse of the parent listing, so an unrecognised non-English listing silently drops central policy; C1, C2, C3, C10 need revision and the S-5 numbers measured the replace design (#302 commented)
8. [SUSPICION][MED][derived/operator/plausible/reversible][0 of 6 shipped entries read-only, so 0% today] sanitized mcp name is lossy and underscores defeat the trailing-delimiter anchor, so an unlisted server (docs_, docs__evil, my_server) inherits a read-only entry's allow
9. [SUSPICION][MED][derived/instrument/routine/reversible][3 of the 14 sampled checks] mutation-drill and disclosure predictions (M3 red set, P5 regex, G9 source) would not fail as written; folded into PT-8 and PT-11
10. [CLEAN][demonstrated] Q-B emit-nothing-on-allow: deny JSON of 4 MB delivered intact through a slow pipe, empty stdout keeps the normal permission flow
11. [CLEAN][demonstrated] CLAUDE_PROJECT_DIR fixture seam: set for hooks, hook cwd does not follow a shell cd on 2.1.267
12. [CLEAN][code-traced] reg.exe 5 s timeout throws into a deny, far below the 60 s ceiling (15 s worst case additive); 2000 ms exceeded only in the failure state (residual R-1)
13. [CLEAN][code-traced] nothing in this story can activate the gate: one manifest, comment-only settings edits, qa gate checks cannot see a wiring entry (P5 is the guard); the 23 unvendored runtime tools stay a blocked activation precondition
14. [CLEAN][derived] additive #107 error handling of timeouts, overflow, access denied, non-REG_SZ and lookalikes stays fail-closed
15. [CLEAN][demonstrated] stale-comment scan list: a broader grep found no additional stale file
counts (a CHECKSUM): issues=6 suspicions=3 clean=6
evidence (a CHECKSUM): demonstrated=7 code-traced=4 derived=4
round=1 roundsSinceLastGo=0 frozen=5 residuals=4 unrun=6 editorial=4
checks=ran probes p1-p16 (scratchpad): 16 of 16 completed; 4 real Claude Code 2.1.267 spikes (exit 1 proceeds, timeout proceeds, cwd seam, Read canary): 4 of 4 as reported; no repo test suite run (plan-only artifact)
adr=MISS(2)
report=docs/reviews/s7-kernel-gate-classification-design-challenger-2026-09-26.md
