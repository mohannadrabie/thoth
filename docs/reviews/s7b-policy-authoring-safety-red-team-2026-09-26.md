# Red Team (Sutekh) — s7b-policy-authoring-safety

- **Date:** 2026-09-26
- **Scope:** story `s7b-policy-authoring-safety` (GitHub Issues 305, 306), CRITICAL tier, post-build
- **HEAD reviewed:** f663d6b (`feat/s7b-policy-authoring-safety`); diff base `fix/s7a-gate-hook-robustness` at 13d78ec, which is the direct parent of the story commits
- **Worktree:** isolated; `git submodule update --init` run, `node_modules` junctioned from the primary checkout and removed afterwards
- **ADR cache:** `node docs/adr-cache.mjs --ensure` printed `📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]`
- **ADR rules read for this attack surface** (security, state, failure-mode, code tags): SE ADR-0021 (kernel purity, one canonical Action record, POL-03 identical verdicts across gate surfaces, fail-closed on ambiguity), SE ADR-0005 (no deleted or weakened test), SE ADR-0010 (quality gates), SE ADR-0002/0003 (layering, SOLID), SE ADR-0006 (blast radius), THOTH-ADR-0001 (fixture standing exception: loader must throw on malformed input; fixture path resolves only from the project root or the module-adjacent default; a pull request touching the loader or the hooks that read the fixture still needs a fresh dated review report — this report is that artifact)
- **Verdict:** **go** — no HIGH. Six MED findings, each with a named test. The two guards themselves are demonstrably sound: seven applied mutants killed, a fourteen-variant name-normalization bypass battery survives, no ReDoS, no terminal-control or path leak on either model-visible channel.

## Scorecard

| # | Attack | Status | Severity | Evidence |
|---|---|---|---|---|
| 1 | V2 and V3 reject deny rules that match real shell-forged records; the disclosed residual covers only part of it | BREAKS | MED | demonstrated |
| 2 | Shape c is neither rejected nor disclosed, and PT-12 is recorded as satisfied | BREAKS | MED | demonstrated |
| 3 | The halt relay truncates the guard detail before the entry, the class and the unlock | BREAKS | MED | demonstrated |
| 4 | Guard key can drift away from the merge key with every gate green | BREAKS | MED | demonstrated |
| 5 | The single-funnel instrument is name-based, so a direct fixture read bypasses it | BREAKS | MED | demonstrated |
| 6 | A schema-valid central typo now denies every call in every session, with an unlock the blocked operator cannot perform | BREAKS | MED | code-traced |
| 7 | Guard bypass by name normalization (case, spaces, NUL, zero-width, combining, fullwidth, prototype keys, duplicates, position) | SURVIVES | — | demonstrated |
| 8 | Performance and ReDoS of the check and of the guard on hostile and huge input | SURVIVES | — | demonstrated |
| 9 | Error-message leakage: terminal control and path on the gate channel and the print surface | SURVIVES | — | demonstrated |
| 10 | Locked keys untouched; G13b replacement honest (no assertion weakened); test-writer file unmodified | SURVIVES | — | demonstrated |
| 11 | Mutation proof: seven mutants spot-applied and reverted | SURVIVES | — | demonstrated |

One decision worth praising: `assertNoBuiltinClassLowering` runs on the merge's own key and over EVERY central entry rather than the merge winner, so a fixture that both raises and lowers the same name throws in either order. Mutant M2 (winner-only) is killed by a test that says so in its title.

## 1. BREAKS [MED] V2 and V3 reject deny rules that the kernel actually matches; the disclosed residual is narrower than the shipped behaviour

- **Implicit assumption broken.** `src/policy/config/rule-reachability.ts` line 11 states "no record's target is a server alone (tool records are prefix/server/tool)". The shell normalizer emits a redirect target verbatim: `extractRedirectTargets` in `src/policy/normalizer/shell-scanner.ts` returns the first token after the operator, so ANY relative path is a legal target, including one under a directory named `mcp`. The same repo already documents shell target forgery (rule-author fact 3 in `src/policy/normalizer/tool-class-format.ts`).
- **Production trigger.** A project keeps its MCP server sources under a top-level directory named `mcp`. An operator writes a project-layer deny on writes to a file in it. The whole policy layer then fails to load and every governed call is denied until the rule is removed.
- **Exposure: ~100% of gated calls in any session whose policy holds one such rule; ~0% today, basis: counted in code** (`src/policy/config/shipped-defaults.json` holds zero rules; the gate is unwired, no PreToolUse entry in `.claude/settings.json`).
- **Current defense, honestly assessed.** R2-6 in `src/policy/config/rule-reachability.test.ts` asserts that the golden corpus contains no shell-emitted target under the MCP prefix. That makes the acceptance explicit, and the test comment says so, but it is a property of the corpus, not of the normalizer: it cannot fail when a real command produces such a target. The plan risk table and the `docs/decisions.md` S7-B row both disclose only the no-trailing-slash case (V2). V3 rejects a slash-bearing target too, whenever the second segment is not letters, digits and hyphens — which is what a real path segment usually is.
- **Duplicate check.** GitHub Issue 328 already covers the V2 half of this ("a deny rule that matches a shell redirect path under a directory named mcp/ is rejected as never matching, failing the whole policy layer"). No second Issue filed; a comment records the V3 half and the blast-radius measurement.
- **Named proof test required before merge:** `R2-13 reachability-accepts-every-shell-emitted-target` — drive the real shell normalizer over a corpus of redirect targets under the MCP prefix (with and without a further slash, with underscore and dot segments), and assert for each that `checkRuleReachability` returns zero errors for a deny rule carrying that exact target, or that the ruling explicitly names the whole rejected class in the decisions row.

Raw output (`node .redteam-tmp/a1.ts`, real `normalize("shell", ...)`, real `checkRuleReachability`, real `decide`):

```text
cmd: somecmd arg > mcp/servers.json
  source=parsed verbs=["write"] targets=["mcp/servers.json"]
  reachability errors=2
    rules[0].targets[0] :: rule "protect-mcp": target "mcp/servers.json" has no "/" after the server name; a target without a trailing "/" matches exactly and no record's target is a server alone, so it can never match. Unlock: write "mcp/servers.json/" for every tool of the server, or "mcp/servers.json/<tool>" for one tool
    rules[0].targets[0] :: rule "protect-mcp": target "mcp/servers.json" has server segment "servers.json", which is not an admitted server name (^[A-Za-z0-9-]+$), so it can never match a record. Unlock: use the sanitized runtime name (letters, digits and hyphens only)
  kernel verdict for the SAME rule vs the SAME record: deny
  RESULT: CONTRADICTION

cmd: somecmd arg > mcp/my_dir/secret
  source=parsed verbs=["write"] targets=["mcp/my_dir/secret"]
  reachability errors=1
    rules[0].targets[0] :: rule "protect-mcp": target "mcp/my_dir/secret" has server segment "my_dir", which is not an admitted server name (^[A-Za-z0-9-]+$), so it can never match a record. Unlock: use the sanitized runtime name (letters, digits and hyphens only)
  kernel verdict for the SAME rule vs the SAME record: deny
  RESULT: CONTRADICTION

cmd: somecmd arg > mcp/v1.2/config
  source=parsed verbs=["write"] targets=["mcp/v1.2/config"]
  reachability errors=1
    rules[0].targets[0] :: rule "protect-mcp": target "mcp/v1.2/config" has server segment "v1.2", which is not an admitted server name (^[A-Za-z0-9-]+$), so it can never match a record. Unlock: use the sanitized runtime name (letters, digits and hyphens only)
  kernel verdict for the SAME rule vs the SAME record: deny
  RESULT: CONTRADICTION

cmd: somecmd arg > mcp/tools/allowed
  source=parsed verbs=["write"] targets=["mcp/tools/allowed"]
  reachability errors=0
  kernel verdict for the SAME rule vs the SAME record: deny
  RESULT: consistent
```

Blast radius, measured through the real loader and the real gate module (`node .redteam-tmp/a2.ts`): one such rule in the project layer, alongside an unrelated valid deny, fails the whole load and denies BOTH routed tool shapes.

```text
load ok=false
reasonKind=schema-invalid failedLayer=project

call Bash
  gate result kind=refusal "policy load failed: layer project, kind schema-invalid; fail-closed"
  hook exitCode=0 stdout="{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"policy load failed: layer project, kind schema-invalid; fail-closed\"}}"

call mcp__docs__search
  gate result kind=refusal "policy load failed: layer project, kind schema-invalid; fail-closed"
  hook exitCode=0 stdout="{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"policy load failed: layer project, kind schema-invalid; fail-closed\"}}"
```

## 2. BREAKS [MED] Shape c stays silent on every surface, and PT-12 is recorded as satisfied

- **What PT-12 asked for.** `docs/reviews/s7-kernel-gate-classification-design-challenger-round2-2026-09-26.md` states the proof test as: a rule with a mistyped marker verb, OR a target equal to an MCP server segment without a trailing slash, OR "a deny rule whose verbs are only legacy mutating verbs and whose target has the mcp prefix", is EITHER rejected at load with a message naming the rule id, OR named on the operator print surface as matching no record the normalizer emits.
- **Shipped behaviour.** The first two limbs are rejected (V1, V2). The third limb, shape c, is deliberately not rejected — correctly, because it CAN match a shell-forged record — but it is also not named anywhere on the operator print surface. `docs/decisions.md` item 6 of the S7-B row and section 8 item 3 of `docs/plans/s7b-policy-authoring-safety-phase1-2026-09-26.md` record PT-12 as satisfied, and plan AP-1 names PT-12 as an activation entry test. The claim is stronger than what shipped.
- **Production trigger.** An operator writes "deny write, execute, delete on `mcp/docs-server/`" believing it blocks that server. Every MCP tool call from that server is allowed, silently, because a class record carries only a marker verb.
- **Exposure: ~0% today (the gate is unwired, counted in code: no PreToolUse entry in `.claude/settings.json`); at activation, every rule of that shape, basis: counted in code.**
- **Current defense, honestly assessed.** R2-4 in `src/policy/config/rule-reachability.test.ts` pins the non-match through the real kernel, and the rewritten fact 4 in `src/policy/normalizer/tool-class-format.ts` documents it for a reader of the source. Neither reaches an operator running `npm run policy:print`.
- **Named proof test required before merge:** `R2-14 shape-c-named-on-the-print-surface` — the real printer over a layer holding a legacy-verb-plus-MCP-target rule emits a line naming that rule as matching no class record; alternatively, amend the decisions row to record PT-12 as satisfied in two of three limbs, with the third carried as an open activation precondition on Issue 308.

Raw output (`node .redteam-tmp/d1.ts`, real `printEffectivePolicy`; and `node .redteam-tmp/d2.ts`, real tool-class normalizer plus real kernel):

```text
exitCode=0
central-channel status=absent
--- resolved rules (1) ---
rule id=deny-remote-mcp-writes effect=deny layer=project origin=<temp>/project.json line=1 mandatory=false
--- inert disclosure mentions? ---
stdout contains the word inert: false
stdout contains matches no record: false

record: source=structured verbs=["tool-class:remote-mutating"] targets=["mcp/docs-server/push_release"]
operator wrote a DENY on that server; kernel verdict for a remote-mutating call = allow
```

## 3. BREAKS [MED] The one channel that was supposed to carry the guard detail truncates it before the entry, the class and the unlock

- **The claim under attack.** Section 6 of the plan says "the hook's existing catch writes SUR-03-enumeration-failed with the message (the operator sees the entry and the class in the halt relay)". The `docs/decisions.md` S7-B row and `CHANGELOG.md` repeat the same split: the gate channel deliberately stays a fixed line, and the halt relay carries the detail.
- **What actually happens.** `hooks/userpromptsubmit-halt-relay.mjs` caps every diagnostic line at 200 characters (`MAX_DETAIL_LENGTH`). The guard message puts the RESOLVED FIXTURE PATH first, so with a real absolute path the 200 characters are spent before the entry name is reached. Measured against the real committed fixture path: entry name not visible, built-in class not visible, unlock not visible.
- **Consequence.** PRINCIPLES rule 2 (every block names its unlock) is met only by the relay trusted line, which says "fix the malformed config file named in the DETAILS section below". The fixture is not malformed — a reviewed entry is disallowed — so the operator is routed to look for a JSON syntax error that does not exist.
- **Exposure: ~100% of lowering-entry halts, basis: counted in code** (the 200-character cap is a module constant) **and measured** (the two runs below).
- **Current defense, honestly assessed.** R1-7 in `hooks/sessionstart-tool-enum-builtin-override.test.ts` asserts the entry name, the built-in class and `Unlock:` are present in the halt-state `detail` — which is the pre-truncation value. No test asserts on what the relay renders, so the truncation is invisible to the suite.
- **Named proof test required before merge:** `R1-11 relay-detail-names-the-entry-and-the-unlock` — run the real SessionStart hook with a lowering entry and then the real halt relay, and assert the rendered relay message names the quoted entry, the built-in class and an actionable unlock; the fix is to put the entry and the unlock before the fixture path in the guard message, or to raise or restructure the relay cap.

Raw output (`node .redteam-tmp/f1.ts`, real `hooks/sessionstart-tool-enum.mjs` plus real `hooks/userpromptsubmit-halt-relay.mjs` through the committed test-support fixture tree):

```text
SessionStart exit=0
halt-state detail length=480
halt-state detail: internal exception during tool enumeration: central classification fixture <temp>/project/docs/qa/s5-central-classification.json: an entry lowers a built-in tool's class ("Task" is built-in workspace-mutating but the fixture entry says read-only). A central entry may keep or raise a built-in's class, never lower it. Unlock: raise the entry's class to the built-in's class or higher, or remove the entry from the fixture.

halt relay exit=2
DETAILS[1] SUR-03-enumeration-failed: internal exception during tool enumeration: central classification fixture <temp>/project/docs/qa/s5-central-classification.json: an entry low...[truncated]
```

Same measurement against the REAL committed fixture path (`node .redteam-tmp/f2.ts`):

```text
full detail length: 469
OPERATOR SEES (first 200 chars, the relay cap):
internal exception during tool enumeration: central classification fixture <repo>/docs/qa/s5-central-classification.json: an entry lowers a built...[truncated]
entry name visible: false
built-in class visible: false
Unlock visible: false
```

## 4. BREAKS [MED] The guard key can drift away from the merge key with every gate green (mutation survivor)

- **The claim under attack.** Plan section 12 lists "Guard and merge disagree about which entry overrides a built-in" and answers it with "Same key (exact name); R1-5 property; R1-6 single merge site". The header of `src/policy/tools/classification-catalog.ts` repeats it: "The guard below runs BEFORE the merge, on the merge's own key (exact name), so the two cannot disagree".
- **What is untested.** Nothing fails when the guard's key becomes LAXER than the merge's. Mutant M7 folds both sides of the comparison to lower case, so a central entry named like a built-in but differing in letter case is now rejected although it never overrides that built-in. Result: full typecheck, full lint and the whole 1479-test suite stay green.
- **Consequence if it ever ships.** A legitimate MCP server whose name differs from a built-in only in case (admitted: the server-name pattern is letters, digits and hyphens, case-sensitive) makes the fixture unloadable: SessionStart halts and the gate exits 2 for every MCP call.
- **Exposure: ~0% today (the mutant is not shipped); the finding is that a future edit of the guard cannot be caught, basis: measured** (one mutant, whole suite green).
- **Current defense, honestly assessed.** R1-1 crosses every built-in name with every class, but only with the EXACT name, so it proves the strict direction only. R1-5 is a property over accepted pairs, also exact-name. R1-6 proves nobody else calls the merge, which is a different question.
- **Named proof test required before merge:** `R1-10 guard-key-is-the-merge-key` — for a near-miss name (the built-in name lower-cased, upper-cased, with a leading or trailing space, with a NUL, with a zero-width character, with a combining mark), assert `assembleCatalog` does NOT throw AND the built-in keeps its own class in the merged catalog and through `evaluateToolInventory`. The battery in attack 7 below is that test, already written and passing on the shipped code.

```text
M7 (guard name key folded to lower case, both sides), applied to src/policy/tools/classification-catalog.ts:
  npx tsc --noEmit -p tsconfig.json  -> exit 0
  node --test (whole repo)           -> tests 1479  pass 1479  fail 0  skipped 0  todo 0
  MUTANT SURVIVES
```

## 5. BREAKS [MED] The single-funnel instrument is name-based, so a production module that reads the fixture directly bypasses the guard undetected

- **The claim under attack.** `src/policy/tools/classification-catalog.ts` line 21: "This module is the ONLY production caller of the merge (instrument R1-6), so the guard applies to both hooks."
- **What R1-6 actually proves.** It scans comment-stripped production files under `src/` and `hooks/` for two NAMES: `mergeToolClassificationLayers`, and `loadCentralClassificationFixture` or `parseCentralClassificationFixture`. It is a good instrument for the shape it covers, and it bites: a second production file naming the merge fails it by name (mutant M8, below). It does NOT cover a module that reads the fixture file itself and builds a catalog object.
- **Production trigger.** A later story needs a classification catalog somewhere new, imports the exported `DEFAULT_FIXTURE_PATH` from `src/policy/tools/central-classification.ts`, parses the JSON and maps the entries. That module now serves a catalog with no built-in layer and no lowering guard, and every gate is green. It also silently breaks the THOTH-ADR-0001 statement that one module is the only code path that reads that file.
- **Exposure: ~0% today (no such site exists, counted by R1-6 itself); the finding is instrument reach, basis: measured** (mutant M9 survives the whole suite).
- **Named proof test required before merge:** `R1-6b no-other-production-fixture-reader` — extend the same comment-stripped scan so the only production files naming the fixture file name or `DEFAULT_FIXTURE_PATH` are `src/policy/tools/central-classification.ts` and `src/policy/tools/classification-catalog.ts`.

```text
M8 (a second production file naming the merge) added to src/policy/normalizer/tool-class.ts:
  R1-6: 101 production files scanned; merge named in ["src/policy/normalizer/tool-class.ts","src/policy/rule/precedence.ts","src/policy/tools/classification-catalog.ts"]
  X R1-6 single-merge-site ... KILLED

M9 (a production function that reads DEFAULT_FIXTURE_PATH directly and builds a catalog, no merge call, no loader call):
  node --test src/policy/tools/classification-builtin-override.test.ts src/policy/gate/gate-structure.test.ts src/policy/tools/classification-catalog.test.ts src/policy/normalizer/tool-class.test.ts
    -> tests 32  pass 32  fail 0  skipped 0
  node src/qa/normalizer-registry-purity-check.ts -> PASS
  node src/qa/kernel-purity-check.ts              -> PASS
  node --test (whole repo)                        -> tests 1479  pass 1479  fail 0  skipped 0
  MUTANT SURVIVES
```

## 6. BREAKS [MED] A schema-valid central typo now denies every call in every session, and the unlock names an edit the blocked operator cannot make

- **Code-traced.** `src/policy/config/loader.ts` lines 192 to 202: a `parseLayerText` failure on the central layer returns a whole-load `LoadFailure`, not a voided layer. The reachability check now lives inside `parseLayerText` (lines 149 to 159), so a class of content that is VALID by `src/policy/rule/schema.ts` joins that path for the first time. The gate turns a load failure into a deny for every routed call (demonstrated under finding 1).
- **Before this story** the same central typo loaded and did nothing. After it, the whole policy — including the project layer's own protective rules — is gone until the central source is repaired, and the central source is out of repo (`createWindowsRegistryCentralPolicySource` in `src/policy/config/central-source.ts`).
- **Unlock defect.** The message says, for a mistyped marker, "use one of tool-class:read-only, ...". That is addressed to whoever can edit the central policy, not to the operator whose session is now denying everything. PRINCIPLES rule 2 wants the block to name the unlock for the person blocked.
- **Exposure: ~0% today, basis: measured** — `defaultCentralPolicySource.read()` in this checkout returns `status absent`, so the central layer contributes nothing and cannot fail. Material at activation, once a central policy exists.
- **Current defense, honestly assessed.** The failure is attributed to the right layer (Issue 108 work) and `failedLayer: central` reaches the gate reason, so an operator can at least tell WHICH layer broke. Nothing offers a degraded mode.
- **Named proof test required before merge:** `R2-15 central-unreachable-rule-does-not-void-the-project-layer` — decide, and pin as a test, whether a reachability rejection in the central layer voids only that layer (matching the mandatory-lock precedent recorded in the header of `src/policy/rule/precedence.ts`) or keeps the whole-load rejection with an operator-actionable unlock.

```text
node .redteam-tmp/h1.ts
central status today = absent channel=undefined
```

## 7. SURVIVES Guard bypass by name normalization — fourteen variants, no lowering

The guard, the merge and the SessionStart lookup all key on the EXACT entry name, and all three use a `Map`, so prototype-named keys are inert data. Every variant either throws (exact name) or leaves the built-in at its own class in both the merged catalog and `evaluateToolInventory`. `buildServerIndex` admits some variants as MCP SERVER names (lower case, upper case, `constructor`, `prototype` all match the admitted pattern) — that is a separate namespace and does not change the built-in class. Non-string and whitespace-padded class values never reach the guard: `parseCentralClassificationFixture` throws first, because it requires a string `class` that is one of the three exact values.

Raw output (`node .redteam-tmp/c1.ts`, real `assembleCatalog`, real built-in layer, real `evaluateToolInventory`, real `buildServerIndex`):

```text
victim built-in: "Task" class=workspace-mutating
exact (control)      threw=YES  merged[Task]=absent               effective=absent               serverIdx=no LOWERED=false
trailing space       threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=no LOWERED=false
leading space        threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=no LOWERED=false
lowercased           threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=yes LOWERED=false
uppercased           threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=yes LOWERED=false
NUL suffix           threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=no LOWERED=false
zero width suffix    threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=no LOWERED=false
combining accent     threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=no LOWERED=false
NFKC fullwidth       threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=no LOWERED=false
__proto__            threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=no LOWERED=false
constructor          threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=yes LOWERED=false
prototype            threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=yes LOWERED=false
trailing slash       threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=no LOWERED=false
dot suffix           threw=no   merged[Task]=workspace-mutating   effective=workspace-mutating   serverIdx=no LOWERED=false
```

Duplicate entries in either order, and entries in any fixture position, are covered by the shipped R1-3 and R1-3b, and mutant M2 proves R1-3 bites. Residual worth one line, not an Issue: a near-miss name (wrong case) silently becomes an MCP SERVER classification instead of the built-in override the author intended, with no disclosure — the same silence class as finding 2, at a surface nothing enforces from today.

## 8. SURVIVES Performance and ReDoS

The server-name pattern is a simple character class with an anchored plus, no alternation and no nested quantifier, so there is nothing to backtrack. Values in messages are JSON-quoted and capped at 80 characters; the guard caps the number of reported offenders at five. The guard and the check are both single linear passes over Maps and arrays.

```text
node .redteam-tmp/e1.ts
2M-char no-slash target: errors=1 ms=6 msgLen=481
2M-char bad server segment: errors=1 ms=3 msgLen=370
200000 rules (400k verbs, 400k targets): errors=0 ms=91
200000-entry fixture guard: ms=8

node src/qa/gate-latency-budget-check.ts
[OPS-03 gate-latency-budget-check] PASS: OPS-03: measured p99 (327.22ms) stays under the declared 2000ms latency budget.
  - iterations=100 min=180.75ms p50=261.63ms p95=300.58ms p99=327.22ms max=327.22ms ceiling=2000ms
```

## 9. SURVIVES Error-message leakage on both model-visible channels

The gate channel carries layer and kind only, never the loader message and never a path (finding 1 raw output). On the operator print surface a rule id and a target carrying an escape sequence, an operating-system-command introducer, a bell and a line separator come out JSON-escaped by the check and then stripped by the printer sanitizer: the only remaining control byte in stdout is the newline the printer itself inserts. The absolute project path appears on the print surface, which is pre-existing operator-run behaviour, not the model channel.

```text
node .redteam-tmp/g1.ts
exit=1
active control bytes in stdout: 1
stdout length=819
(the rejected id and target render as backslash-u escapes; the line separator is stripped entirely)
```

## 10. SURVIVES Locked keys untouched, G13b replacement honest, test-writer file unmodified

A version-control diffstat from the base to HEAD, restricted to the locked paths, produced NO output at all — every one of them is byte-identical: `src/policy/rule/precedence.ts`, `src/policy/rule/schema.ts`, everything under `src/policy/kernel/`, `hooks/pretooluse-kernel-gate.mjs`, `hooks/sessionstart-tool-enum.mjs`, `hooks/userpromptsubmit-halt-relay.mjs`, `src/policy/rule/precedence.test.ts`, `src/policy/rule/schema.test.ts`, `src/policy/tools/classification.test.ts`, `hooks/pretooluse-kernel-gate-classification.test.ts`, `src/policy/normalizer/tool-class.test.ts`, `src/policy/gate/decide-tool-call.test.ts`, `src/policy/config/printer.test.ts`, `.github/workflows/ci.yml`, `docs/qa/s5-central-classification.json`.

A version-control log restricted to `hooks/pretooluse-kernel-gate-builtin-override.test.ts` lists exactly one commit, 2ec9607, the RED-CONFIRMED test-writer commit. The file was never edited after it was authored.

G13b in `src/policy/normalizer/tool-class-golden.test.ts`: the diff keeps both prior assertions for every one of the four inert shapes (the schema error count equals 0, and the kernel verdict equals allow) and ADDS a loader assertion plus a rule-id-in-message assertion. Only the title and comments changed. No assertion was weakened, nothing was deleted; the change matches what the decisions row records for SE ADR-0005. The only edit to `src/policy/gate/gate-structure.test.ts` is five additive entries in the G19 file list.

## 11. SURVIVES Mutation proof — nine mutants spot-applied and reverted

Baseline for the target files (`node --test` over the five new test files plus the golden test) gives `tests 32  pass 32  fail 0  skipped 0`. Every mutant was reverted by restoring the file from the index; the working tree at the end of this review holds no production change.

| Mutant | Change | Result | Killed by |
|---|---|---|---|
| M1 | guard comparison becomes less-or-equal (rejects same-class) | KILLED | R1-1, R1-7 controls, AC-R1-8 same-class control |
| M2 | guard checks only the entry that wins the merge | KILLED | R1-3 (both orders) |
| M3 | V2 removed | KILLED | R2-2, R2-5, R2-5b, G13b |
| M4 | V3 admits underscore in the server segment | KILLED | R2-3 |
| M5 | reachability check runs BEFORE schema validation | KILLED | R2-11 schema-first, R2-5, R2-5c, R2-9 |
| M6 | guard call removed from `assembleCatalog` | KILLED | R1-1, R1-2, R1-3, R1-3b, R1-5, R1-7, AC-R1-8 cases 1 and 2 |
| M7 | guard name key folded to lower case | **SURVIVED** | nothing (finding 4) |
| M8 | a second production file names the merge | KILLED | R1-6, which names the offending file |
| M9 | a production module reads the fixture path directly | **SURVIVED** | nothing (finding 5) |

M5 is worth naming: the loader test added in commit 8282b67 after the build's own mutation run is real, and it is what kills the check-before-schema ordering mutant. The disclosure in the decisions row that the first run left that mutant alive is accurate.

## Gates run on the clean tree

```text
node --test                                     -> tests 1479  pass 1479  fail 0  cancelled 0  skipped 0  todo 0
npx tsc --noEmit -p tsconfig.json               -> exit 0
npx eslint .                                    -> exit 0
node src/qa/gate-latency-budget-check.ts        -> PASS (p99 327.22ms, ceiling 2000ms)
node src/qa/completeness-claim-checker.ts       -> PASS (2 files checked)
node src/qa/gate-manifest-check.ts              -> PASS (exactly 1 gate manifest)
node src/qa/gate-matcher-drift-check.ts         -> PASS (19 referenced tool names)
node src/qa/normalizer-registry-purity-check.ts -> PASS
node src/qa/kernel-purity-check.ts              -> PASS (4 production files)
```

## Findings to failing tests

Six open findings, six named failing tests, one to one: R2-13 (finding 1), R2-14 (finding 2), R1-11 (finding 3), R1-10 (finding 4, already drafted as the attack 7 battery), R1-6b (finding 5), R2-15 (finding 6). No finding lacks an executable form.

## Editorial (verdict-neutral, plain edits, no re-review)

1. `src/policy/config/rule-reachability.ts` line 11 states "no record's target is a server alone" as a fact about all records. It is true of tool-class records only; a shell redirect target is any token. Reword, and add the accepted cost the way `src/policy/tools/classification-catalog.ts` already does for its own.
2. The plan risk table and the `docs/decisions.md` S7-B row describe the accepted residual as "without a trailing slash". V3 rejects slash-bearing targets too. Widen the sentence.
3. Plan section 6 and the `docs/decisions.md` row say the operator sees the entry and the class in the halt relay. As shipped the operator sees neither (finding 3). Correct the sentence when finding 3 is fixed.

## Scariest unproven assumption

**That the reachability check knows what the normalizers can emit.** It reasons about the tool-class grammar only, while the target namespace it polices is shared with the shell normalizer, whose targets are arbitrary caller text. Both directions of that gap are now demonstrated: a matchable rule rejected (finding 1) and an unmatchable-for-class rule accepted and undisclosed (finding 2). The instrument meant to close it (R2-6) asserts a property of a fixture corpus rather than of the normalizers, so it cannot fail on a real command.

## Verdict and next action

**go.** No HIGH. Nothing is live: the gate is unwired, both shipped policy layers hold zero rules, and the central channel reads absent in this checkout, so every finding is a pre-activation correctness or instrument matter rather than a live exposure. The two guards do what they claim under attack.

**Single next action:** land `R2-13 reachability-accepts-every-shell-emitted-target` as a failing test (finding 1, GitHub Issue 328) and let its result decide whether V2 and V3 narrow to the tool-class namespace or the ruling widens to name the whole rejected class.

---

```text
RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated] V2 and V3 reject deny rules the kernel actually matches: the real shell normalizer emits redirect targets under the MCP prefix, so a deny on a path in a directory named mcp is called unmatchable and fails the WHOLE layer load (measured: Bash and MCP both denied). Defense R2-6 asserts a corpus property, not a normalizer property, and the disclosed residual names only the no-trailing-slash half. Exposure: ~100% of gated calls in a session holding one such rule, ~0% today, basis: counted in code. Existing GitHub Issue 328, commented not duplicated.
2. [ISSUE][MED][demonstrated] Shape c (legacy verbs plus MCP target) is neither rejected nor named on the print surface, yet PT-12 is recorded satisfied in the decisions row and plan AP-1 names it an activation entry test; an operator deny on a server silently allows every class call. Defense R2-4 pins the non-match for a source reader only. Exposure: ~0% today (gate unwired), every rule of that shape at activation, basis: counted in code.
3. [ISSUE][MED][demonstrated] The halt relay caps diagnostics at 200 characters and the guard message puts the fixture path first, so the only channel meant to carry the detail shows neither the entry, the class nor the unlock; the trusted line misroutes the operator to a malformed file. Defense R1-7 asserts on the pre-truncation halt-state value. Exposure: ~100% of lowering-entry halts, basis: counted in code plus measured.
4. [ISSUE][MED][demonstrated] Guard-key drift is untested: folding the guard name key to lower case survives typecheck, lint and all 1479 tests, so the same-key-as-the-merge mitigation has no test; the drift would make a legitimate case-differing server name unloadable. Exposure: ~0% today, basis: measured.
5. [ISSUE][MED][demonstrated] The single-funnel instrument R1-6 is name-based: a production module reading the exported default fixture path directly and assembling a catalog bypasses both the merge and the guard with all 1479 tests and both purity checks green. It does bite on a second merge caller (M8 killed). Exposure: ~0% today, basis: measured.
6. [ISSUE][MED][code-traced] A schema-valid central-layer typo now fails the whole load, so one out-of-repo typo denies every call in every session, and the message unlock names an edit the blocked operator cannot make. Exposure: ~0% today, basis: measured (the central channel reads absent in this checkout).
7. [CLEAN][demonstrated] Guard bypass by name normalization: 14 variants (case, leading and trailing space, NUL, zero-width, combining mark, fullwidth, __proto__, constructor, prototype, trailing slash, dot) never lower the built-in class in the merged catalog or through the SessionStart lookup; guard, merge and lookup share one exact-name Map key; non-string and padded class values are rejected by the fixture parser first.
8. [CLEAN][demonstrated] Performance and ReDoS: 2M-character hostile targets in 3 to 6 ms, 200000 rules in 91 ms, 200000-entry fixture guard in 8 ms, messages bounded (JSON-quoted, 80-character value cap, five-offender cap); gate p99 327 ms against a 2000 ms budget.
9. [CLEAN][demonstrated] Error-message leakage: terminal-control bytes in a rejected rule id and target are JSON-escaped then stripped on the print surface (one control byte left, the printer newline); the gate channel carries layer and kind only, never the message or a path.
10. [CLEAN][demonstrated] Locked keys byte-identical (empty diffstat over all 15 locked paths), test-writer file has exactly one commit, G13b keeps every prior assertion and only adds loader assertions, G19 edit is additive.
11. [CLEAN][demonstrated] Mutation proof: M1 guard less-or-equal, M2 merge-winner-only, M3 V2 removed, M4 V3 admits underscore, M5 check before schema, M6 guard removed, M8 second merge site all KILLED with named tests; M7 and M9 survived and are findings 4 and 5.
counts (CHECKSUM over the 11 lines above): issues=6 suspicions=0 clean=5
evidence (CHECKSUM over the tags above): demonstrated=10 code-traced=1 derived=0
checks=node --test 1479 passed / 0 failed / 0 skipped; typecheck exit 0; eslint exit 0; gate-latency-budget PASS p99 327.22ms; completeness-claim-checker PASS; gate-manifest-check PASS; gate-matcher-drift-check PASS; normalizer-registry-purity PASS; kernel-purity PASS; 9 mutants applied and reverted (7 killed, 2 survived)
adr=HIT(37)
report=docs/reviews/s7b-policy-authoring-safety-red-team-2026-09-26.md
```
