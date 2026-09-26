# Red-team report: s7-kernel-gate-classification (post-build, CRITICAL)

[red-team]
Red Team (Sutekh) - attacking the built s7 kernel-gate classification change with failure scenarios

- **Scope**: Issues #93, #288 (preconditions), #107. Branch feat/s7-kernel-gate-classification @ 94c5315; base origin/master fff858c; diff reviewed: fff858c..94c5315 (44 files, +4970/-173).
- **Sensitive areas touched**: PreToolUse hook adapter, guard/policy engine (src/policy/gate/, src/policy/normalizer/), policy delivery (classification fixture as an enforcement input), central policy channel reader.
- **Reach today**: the hook is UNWIRED. Verified mechanically: .claude/settings.json hooks keys are exactly ["SessionStart","UserPromptSubmit"], the serialized hooks object contains no kernel-gate reference, and no .claude/settings.local.json / .mcp.json exists in the tree. Every enforcement-behaviour finding below therefore has OPERATOR/INSTRUMENT reach now and would-be reach only at activation; I say so per finding.
- **Lanes I did not repeat**: the trust-boundary and cross-domain lanes were cleared by two other reviewers (no HIGH). This report attacks forgery, name resolution, fail-open behaviour of the real hook, the #107 additive reader, posture truthfulness, mutation-kill strength, activation containment, answer-key integrity, and the #299-#308 issue set.

ADR cache line, printed by docs/adr-cache.mjs --ensure at the start of this pass:

    ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]

ADRs read on my attack surface from adrCatalog.adrs: ADR-0021 (kernel purity, POL-05, normalizer registry, gate surfaces), SE ADR-0002/0003 (DI seams), ADR-0006 (no opportunistic scope widening / the unwired hook as the flag), THOTH-ADR-0001 (central classification fixture standing exception - its "PR diff is the approval" ruling is the one the plan itself flags as UNCLEAR now that a class is enforcement data; bound to Q-C/AP-7, human-owned, not re-litigated here).

## What I ran (all commands run in my own worktree at 94c5315)

| # | Instrument | Raw result |
|---|---|---|
| 1 | npm test (full suite, baseline) | tests 1213 / pass 1213 / fail 0 / cancelled 0 / skipped 0 / todo 0, duration 126252 ms |
| 2 | node --test over the story's 8 drill files | tests 63 / pass 63 / fail 0 / skipped 0 (matches the plan's X-3 baseline) |
| 3 | Forgery fuzz against the REAL shell normalizer | 60,073 commands (73 seeded marker/redirect families + 60,000 random) |
| 4 | Name-resolver fuzz against the REAL tool-class grammar | 4,021 server names, 13 parse shapes, 7 normalizer shapes |
| 5 | Real hook spawned with real stdin JSON | 18 payload shapes + 4 pipe/stdin fault shapes + a redirect-density latency curve |
| 6 | #107 additive fallback with a scripted 2-call runner | 18 stdout/stderr/exit combinations |
| 7 | Mutation drills | 7 plan drills (M1-M7) re-run + 8 NEW mutants of mine |
| 8 | Answer-key integrity | sha256 of the test-writer files at aa97bdc vs 94c5315 |
| 9 | Activation containment | settings.json parsed, local-override files enumerated |

## Findings, ranked by blast radius (exposure x irreversibility x silence)

### 1. [ISSUE][MED][demonstrated] The #107 fallback turns a partially provisioned central key into a session-wide deny on a non-English host, where an English host proceeds

**Scenario.** An enterprise provisions central policy in two steps (or with a differently named value): HKLMSOFTWAREPoliciesThoth exists, CentralPolicyJson does not yet. Call 1 (reg query ...Thoth /v CentralPolicyJson) fails with status 1 and a LOCALIZED value-not-found message. On an English host isNotFoundError matches and the reader returns absent - the session runs on the lower layers. On a non-English host no pattern matches, the additive fallback lists the parent, sees the Thoth subkey, classifies key-listed, and RETHROWS the original error. loader.ts turns that into the fail-closed read-error bucket, so at activation EVERY gated call (Bash and every mcp__ name) denies for as long as the half-provisioned key exists, with no in-session repair.

**Evidence (scripted runner against the real createWindowsRegistryCentralPolicySource, platform pinned win32):**

    1 EN not-found (fast path)                     RESULT status absent
    2 DE + listing without Thoth                   RESULT status absent
    3 DE + listing WITH Thoth                      THROW  reg failed
    17 DE + value lines indented under Thoth       THROW  reg failed

Cases 3 and 17 are exactly the key-exists-value-missing shape. The divergence is by design (downgrade only on positive evidence, plan 8c) and it errs fail-closed, so this is an AVAILABILITY finding, not a bypass.

**Current defense, honestly assessed.** None specific. The plan residual register covers a different case (R-4, format drift on the Thoth line). AP-9 covers recovery-when-the-policy-load-fails generically but does not name this trigger, and the calendar backstop (2026-10-24) is about the English text match, not about this asymmetry. Nothing in central-source.ts header discloses it.

**Reach.** Operator/instrument today (unwired). At activation: non-English Windows hosts only, and only while the key is half-provisioned. Exposure: ~0% of runs today (hook unwired, verified); at activation ~100% of gated calls on an affected host, basis: counted in code (a loader read-error is a hard deny for every route) plus the demonstrated classifier behaviour above.

**Verdict: BREAKS (availability), MED.** Proof-test required before ACTIVATION, not before this merge: named test **C12 - non-English stderr plus a listed Thoth key without the value rethrows, and the activation runbook names the repair** in src/policy/config/central-source.test.ts, plus one line in AP-9 naming the trigger and its out-of-session repair (write the value, or remove the key).

### 2. [ISSUE][LOW][demonstrated] The deny reason reflects the whole untrusted tool_name back, unbounded

**Scenario.** permissionDecisionReason is model-visible and operator-visible text. The unroutable-tool refusal interpolates JSON.stringify(tool_name) with no length cap, so the hook will emit a 400 KB single-line JSON decision.

**Evidence (real hook, real stdin):**

    bigname.json | exit=0 | ms=107 | outLen=400197 | valid-json

I checked the two consequences that would have made this worse and both are clean: (a) stdout is NOT truncated by process.exit even against a slow reader - the child blocks and delivers all 300,193 bytes (probe: childExitedAt 3022 ms with the reader resumed at t=3000 ms, bytesRead 300193); (b) the POL-05 path does not echo the opaque cause, so realistic denies measured 180-283 bytes.

**Current defense.** None; no cap anywhere in render-hook-output.ts or decide-tool-call.ts.

**Reach.** Operator/instrument today. At activation: log/UI bloat and a prompt-reflection surface, not a bypass. Exposure: ~0% of runs today; unbounded per call at activation only for pathological tool names, basis: assumption (so capped LOW by the evidence policy).

**Verdict: BREAKS (hygiene), LOW.** Proof-test: named test **G21 - every rendered reason is capped at 512 chars and the cap is visible in the reason** in src/policy/gate/render-hook-output.test.ts. Not a merge blocker.

### 3. [SUSPICION][LOW][demonstrated] A closed stdout makes a decided deny vanish with exit 0 - a silent allow that is not in the SUR-10 table

**Scenario.** The hook decides deny, writes the JSON, and exits 0. If the reader has closed the pipe, the write is discarded and the parent observes exit 0 with empty stdout, which on this runtime means ALLOW (plan Q-B: silence means allow).

**Evidence (real hook; the child stdout stream destroyed immediately after stdin.end):**

    A destroyed-stdout, deny payload : close code=0 sig=null    (the deny JSON was never delivered)

**Current defense, honestly assessed.** Structurally none. renderHookOutput is closed and typed and that genuinely works (my mutant X-C, which makes silence the default for any non-deny outcome, is killed by AC-H13 and G20), but the adapter cannot know its write was discarded: it calls process.stdout.write and then process.exit with no error listener and no flush check. The nearest recorded SUR-10 row is hook-timeout / non-blocking-hook-surface; a discarded write is a different mechanism and is not enumerated. Separate from AP-13 (a launch failure before the try/catch, exit 1) and AP-14 (input-size timeout).

**Reach / trigger honesty.** I could not show Claude Code closing a hook stdout before the hook exits; the realistic route is a runner timeout kill, which already proceeds for its own recorded reason. The trigger is therefore plausible only in a crash/kill window.

**Verdict: UNPROVEN-pending-verification, LOW.** Settling work (who: implementer, at activation): add a write-error listener plus a post-write flush check to the adapter, then a named probe row **gate-fail-open-probe id stdout-closed-before-write, expect BLOCKS** (exit 2 when the write fails). Until settled it belongs in the SUR-10 enumeration as a recorded PROCEEDS row - not in the residual register as closed.

### 4. [SUSPICION][LOW][demonstrated] Injective-or-unresolved is enforced on the SERVER segment only; the TOOL segment admits invisible characters verbatim into the identity target

**Scenario.** A per-tool identity deny (target mcp/github/create_issue) is evaded by a tool whose declared name carries a trailing space or a zero-width character: the runtime target string differs while the rule an operator reads looks identical. Class-keyed rules and server-prefix rules (a pattern ending in a slash) are unaffected.

**Evidence (real grammar module, parseMcpToolName + buildMcpTarget):**

    parse mcp__a__b(trailing space)  => server a, tool b(trailing space), target mcp/a/b(trailing space)
    parse mcp__a__U+0000        => server a, tool U+0000, target mcp/a/U+0000
    parse mcp__U+FF53__b        => server fullwidth-s (then fails fixture admission, so opaque, so denied)

**Current defense.** The admission charset [A-Za-z0-9-] is applied to fixture SERVER names only (ADMISSIBLE_SERVER_NAME); parseMcpToolName constrains the tool segment only against empty, a leading underscore, a double underscore and a slash. The grammar header name-mapping paragraph promises injective-or-unresolved without qualifying that the promise covers the server segment alone.

**Reach.** Depends on unmeasured runtime behaviour: X-2 (which characters the runtime sanitizes) is on the plan unrun list. If the runtime sanitizes tool names the way it sanitizes server names, this shape cannot reach the gate at all.

**Verdict: UNPROVEN-pending-verification, LOW.** Settling command (who: implementer, X-2 at activation): declare an MCP server whose tool names carry a trailing space, a zero-width space and an accent, then print tool_name from a PreToolUse hook in a scratch claude -p session. If unsanitized, the fix is one line in the grammar plus a named test **N13 - a tool segment outside the printable-safe set is unresolved**, and one qualifying sentence in the rule-author facts.

### 5. [CLEAN][demonstrated] Marker-verb forgery from Bash: 0 hits in 60,073 commands, and the end-to-end path holds

**Attack.** Get the shell normalizer to emit a tool-class marker verb, or to produce a record an author-natural class allow rule would match, so a shell command borrows an MCP class allowance (the #299 shape, restated for the marker design).

**Evidence.** 60,073 commands through the REAL normalizeShellCall (73 seeded families: the three markers bare, quoted, path-qualified, backslash-prefixed, chained, redirected-to, wrapped in env/sudo/eval/xargs/nohup/bash -c/command/time/pipe, plus mcp/srv/tool as a redirect, resource and copy target; 60,000 random strings over a 26-token alphabet built from marker, mcp, path and operator fragments):

    cases: 60073 threw: 0
    MARKER-VERB FORGERIES: 0
    RESOLVED mcp-target FORGERIES: 15

The 15 target hits are the DOCUMENTED shape (rule-author fact 3): a redirect forges the identity STRING with verb write, for example

    echo hi > mcp/srv/tool                  verbs [write] targets [mcp/srv/tool]
    ls > mcp/aws-mcp-server/run_script      verbs [write] targets [mcp/aws-mcp-server/run_script]

so a deny keyed on identity is safe (a forged match only denies) while an ALLOW keyed on identity alone is forgeable - which is why AP-1 holds PT-1 as an entry test and #299 stays open. Marker verbs are not in KNOWN_VERBS and my mutant that adds them (M5) is killed by N8, N9b and AC-H11b.

**Verdict: SURVIVES** for the class dimension; the identity-allow authoring hazard is correctly carried to activation (AP-1 / PT-1 / #299), not closed.

### 6. [CLEAN][demonstrated] The mcp__ name resolver is injective-or-unresolved under fuzz

**Attack.** Find two distinct configured server names where one is admitted and the other collides with it after the runtime sanitizer, or a parse that splits two ways, or a prototype-property name that poisons the index.

**Evidence.** 4,021 names (space, dot, colon, plus, slash, backslash, underscore, double and triple underscore, NUL, zero-width space, combining accent vs precomposed, fullwidth, case variants, 5,000-character names, __proto__ / constructor / toString / hasOwnProperty) through the real sanitizeMcpName and buildServerIndex:

    names=4021 admitted=443
    COLLISIONS (a distinct configured name sanitizing onto an admitted entry): 0
    proto-name entries admitted: ["constructor","toString"]   (stored in a Map, so no prototype reachability)
    duplicate name, same class: kept once; duplicate name, different class: rejected ("listed twice with different classes")

Parse ambiguity shapes all resolve to unresolved: mcp__a__b__c, mcp____b (empty server), mcp__a___b, mcp__a__ (empty tool), mcp__a__b/c, mcp__a/b__c, MCP__a__b (case). Case sensitivity is fail-closed: mcp__GitHub__a against a fixture entry github yields source opaque, i.e. a deny.

**Verdict: SURVIVES.** My two mutants against this property (X-A: drop the double-underscore ambiguity guard; X-B: admit underscore into server names) are both killed - X-A by AC-H4, G13, N3, N5; X-B by AC-H4, N4, N4b.

### 7. [CLEAN][demonstrated] Fail-open hunt on the real hook: no NEW silent-allow path; AP-13 and AP-14 both reproduced

**Evidence.** 18 payload shapes spawned against the real hook (node hooks/pretooluse-kernel-gate.mjs, real stdin JSON, cwd deliberately outside the repo at C:/). Every line below is raw:

    arr.json (a JSON array)             exit=0 outLen=157 valid-json deny "hook payload is not a JSON object"
    bash-ok.json (ls -la)               exit=0 outLen=255 valid-json deny POL-05
    bigbash.json (4000 chained writes)  exit=0 outLen=232 valid-json deny POL-05
    bigname.json (400 KB tool_name)     exit=0 outLen=400197 valid-json deny unroutable
    bom.json (BOM before the JSON)      exit=2 outLen=0 stderr SyntaxError - fail-closed
    crlf.json (trailing CRLF)           exit=0 outLen=197 valid-json deny unroutable
    empty.json (empty stdin)            exit=2 outLen=0 stderr empty-stdin - fail-closed
    hugestdin.json (8 MB payload)       exit=0 outLen=252 valid-json deny POL-05 (167 ms)
    input-str.json (tool_input a string)exit=0 outLen=186 valid-json deny malformed
    lookalike.json (Cyrillic Vash)      exit=0 outLen=197 valid-json deny unroutable
    lower.json (bash, lowercase)        exit=0 outLen=197 valid-json deny unroutable
    nul.json (Bash + NUL)               exit=0 outLen=204 valid-json deny unroutable
    no-input.json (tool_input missing)  exit=0 outLen=186 valid-json deny malformed
    mcp-unknown.json (unclassified srv) exit=0 outLen=180 valid-json deny POL-05 opaque
    read.json (tool_name Read)          exit=0 outLen=197 valid-json deny unroutable
    mcp-gh.json (classified server)     exit=0 outLen=0  no stdout  = ALLOW (posture allow, 0 rules)
    padbash.json (200 KB single write)  exit=0 outLen=0  no stdout  = ALLOW (posture allow, 0 rules)

The two allows are the shipped baseline, not a defect: both policy layers carry zero rules and npm run policy:print reports **posture: allow (source: bootstrap; no layer declared a posture)** plus the not-wired disclosure. Note for the activation reviewer: classifying a server in the fixture moves an mcp__ call from deny (opaque, POL-05) to allow (structured, no rule matches), which is the intended consequence of option Y but means the fixture is now an allow-granting input - already bound to Q-C / AP-7 and AP-1.

Two disclosed fail-opens reproduced, both already owned:

    AP-13 / #303: node --no-experimental-strip-types hooks/pretooluse-kernel-gate.mjs  ->  exit=1 (ERR_UNKNOWN_FILE_EXTENSION), non-blocking on this runtime
    AP-14 / #304: redirect-density curve through the real hook (one invocation, no chain operator):
      redirects=  100 cmdBytes=   596 ms=  148
      redirects= 1000 cmdBytes=  6896 ms=  215
      redirects= 2000 cmdBytes= 14896 ms=  514
      redirects= 4000 cmdBytes= 30896 ms= 1974   (crosses the 2000 ms OPS-03 budget near 31 KB)
      redirects= 8000 cmdBytes= 62896 ms= 7233
      redirects=16000 cmdBytes=132896 ms=31874
      redirects=24000 cmdBytes=204896 ms=78641   (crosses the planned 60 s entry timeout near 205 KB -> the call would PROCEED)

Also probed and clean: stdin never closed - the hook waits indefinitely with no internal watchdog (5 s observed, then I killed it), which is the disclosed hook-timeout row rather than a new mechanism; and no stdout truncation under a slow reader (finding 2).

**Verdict: SURVIVES** - every malformed, oversized, Unicode-lookalike and mistyped shape denies or exits 2. The only new mechanism I found is finding 3 (closed stdout), and it is UNPROVEN.

### 8. [CLEAN][demonstrated] The #107 additive fallback can only downgrade to absent on positive parse evidence

**Attack.** Make the reader answer absent while central policy might exist. 18 combinations of call-1 status/stderr and call-2 stdout/exit through the real source with a scripted runner:

    1  EN not-found (fast path)                         absent   (1 spawn, English path unchanged)
    2  DE + listing without Thoth                       absent   (intended downgrade)
    3  DE + listing WITH Thoth                          THROW
    4  DE + BOM on the Thoth line                       THROW
    5  DE + NBSP before the Thoth line                  THROW
    6  DE + one space before the Thoth line             THROW
    7  DE + CRLF listing with Thoth                     THROW
    8  DE + garbage on exit 0                           THROW
    9  DE + empty stdout on exit 0                      THROW
    10 DE + the second call itself throws               THROW
    11 status 5 + DE stderr                             THROW   (no fallback for a non-1 status)
    12 status 1 + EMPTY stderr + listing without Thoth  absent  (the one widened shape)
    13 DE + Thoth listed with trailing spaces           THROW
    14 DE + lowercase hive spelling, Thoth listed       THROW
    15 DE + a ThothX lookalike only                     absent  (correct: not the Thoth key)
    16 DE + only the parent line                        absent
    17 DE + value lines indented under Thoth            THROW
    18 DE + a WOW6432Node view of the parent            THROW   (unanchored listing, unrecognised)

No combination returns absent while the Thoth key is visible. The English fast path is byte-identical and every pre-existing test is intact: git diff aa97bdc..94c5315 --numstat for src/policy/config/central-source.test.ts is **165 added, 0 deleted**.

**Verdict: SURVIVES.** One availability consequence is finding 1; one editorial correction to residual R-4 is below.

### 9. [CLEAN][demonstrated] The posture print surface does not overclaim central enforcement, and the peer-override truth holds

**Evidence.** renderPostureLine, against real ResolvedPosture values:

    posture: deny (source: central; rules from lower-trust layers can still allow)
    posture: deny (source: project; in-repo layer, not centrally enforced; rules from other layers can still allow)
    posture: deny (source: shipped-defaults; in-repo layer, not centrally enforced; rules from other layers can still allow)

And the claim is true in the direction that matters - a rank-0 allow RULE does override a central posture deny, run against the real kernel:

    central posture deny + project allow rule on the marker verb  ->  outcome allow, ruleId proj-allow

npm run policy:print on this tree prints central-channel status=absent, 0 resolved rules, the posture line, and the not-wired disclosure naming .claude/settings.json. The disclosure literal is tied to the settings state by printer.test.ts AC-P5, so wiring the hook forces a deliberate edit here. Issue #301 is closed in code.

**Verdict: SURVIVES.**

### 10. [CLEAN][demonstrated] Mutation strength: the X-3 table reproduces, and 7 of my 8 new mutants die

Baseline for the 8 drill files: **tests 63 / pass 63 / fail 0 / skipped 0**. Plan drills re-run on the built code (mutation applied to the built file, story test files only, git checkout after each):

    M1 one marker for every class        pass 56 fail 7  RED: AC-H7, AC-H12, G4, G5, G13, G13b, N1
    M2 first fixture entry to read-only  pass 61 fail 2  RED: AC-H7, G13
    M3 hook re-hardcodes the posture     pass 61 fail 2  RED: AC-H5, AC-H11
    M4 load failure ignored by the gate  pass 61 fail 2  RED: AC-H6, G1
    M5 markers added to KNOWN_VERBS      pass 60 fail 3  RED: AC-H11b, N8, N9b
    M6 route Bash through tool-class     pass 54 fail 9  RED: AC-H5, AC-H8, AC-H10, AC-H13, AC-2, G3, G7, G16, G11
    M7 server lookup by prefix           pass 61 fail 2  RED: AC-H4, N3b

Six of the seven ACTUAL red sets equal the plan section 20a table exactly, including M6 where the plan had already corrected its own prediction defect (G11, 9 tests for 9). M1 gave one test more than the table (N1, the compile-shape test) - a difference in how the mutant was expressed, not a missed kill; editorial only.

My 8 new mutants:

    X-A parse drops the ambiguous double-underscore guard    KILLED  AC-H4, G13, N3, N5
    X-B admission regex allows underscore (injectivity off)  KILLED  AC-H4, N4, N4b
    X-C silence polarity: silent unless exactly deny         KILLED  AC-H13, G20
    X-D gate fixture becomes env-controlled (Issue #99)      KILLED  AC-H12, G14
    X-F builtin entries admitted as server names             KILLED  N4
    X-G deny emitted with exit 1 instead of 0                KILLED  19 tests (the strict deny helper really is strict)
    X-H opaque record carries no unresolved cause            KILLED  AC-H3, AC-H4, G13, N2, N3
    X-E gate drops the Array.isArray payload guard           SURVIVED  63/63 green

**The survivor is an equivalent mutant, not a defect**: a JSON array payload has no tool_name property either way, so it still lands on the malformed-input refusal and still denies - only the reason string differs, and no test pins that distinction. Worth one assertion if anyone touches that branch; not a finding.

**Verdict: SURVIVES.** X-C, X-D, X-G and X-H are the four that mattered (output polarity, env-immune policy source, blocking exit code, POL-05 reachability) and all four die loudly.

### 11. [CLEAN][demonstrated] Nothing in this diff can activate the gate

    hooks keys: ["SessionStart","UserPromptSubmit"]
    kernel-gate present in the serialized hooks object: false
    .claude/settings.local.json exists: false     .mcp.json exists: false
    git diff --stat fff858c..94c5315 -- .claude/settings.json: 16 insertions, 14 deletions, all inside the comment key

**Verdict: SURVIVES.** The residual the plan already records (R-9: a user or managed settings entry outside the tracked file is invisible to this check) is real and stays.

### 12. [CLEAN][demonstrated] Answer-key integrity: the test-writer files are byte-identical

    git diff aa97bdc..94c5315 -- hooks/pretooluse-kernel-gate-classification.test.ts hooks/test-support/gate-sandbox.ts src/policy/config/print-cli.test.ts src/policy/config/printer.test.ts hooks/pretooluse-kernel-gate.test.ts
    (no output - empty diff)
    sha256 classification.test.ts  aa97bdc 70dad27c9d64f3898a5b56de7e52a8ae38588fc515cc41a16572b8b057c5e273
    sha256 classification.test.ts  94c5315 70dad27c9d64f3898a5b56de7e52a8ae38588fc515cc41a16572b8b057c5e273
    sha256 gate-sandbox.ts         aa97bdc 921237b535a86f5dace961acba4ab89ff7efe0638e53d714f619edf088ac3601
    sha256 gate-sandbox.ts         94c5315 921237b535a86f5dace961acba4ab89ff7efe0638e53d714f619edf088ac3601

The only test-file change after the test-writer commit is src/policy/config/central-source.test.ts (+165 / -0), the implementer-owned C suite the plan assigns to it. No answer key was edited to pass.

**Verdict: SURVIVES.**

### 13. [CLEAN][code-traced] Re-check of Issues #299-#307 against the built code

| Issue | Status against 94c5315 | Basis |
|---|---|---|
| #299 class namespace forgeable by a shell redirect (HIGH) | CLOSED IN CODE for the class dimension: class rides a marker verb outside KNOWN_VERBS, 0 forgeries in 60,073 commands, and the mutant that adds markers to KNOWN_VERBS dies (N8, N9b, AC-H11b). CARRIED TO ACTIVATION for the residual authoring hazard: an allow rule keyed on identity alone is still forgeable, held by AP-1 / PT-1 | finding 5 |
| #300 a fixture class flip detaches a central per-server deny (HIGH) | CLOSED IN CODE: targets carry identity only (mcp/server/tool, no class segment). Identity deny vs a flipped class: deny / deny. Class deny vs a flipped class: allow / deny, exactly as rule-author fact 2 documents | ran against the real normalizer and kernel |
| #301 posture line overstates central control (MED) | CLOSED IN CODE | finding 9 |
| #302 C1/C2/C10 contradict the existing central-source tests (MED) | CLOSED IN CODE: the additive design keeps all 16 existing tests (+165 / -0) | finding 8 |
| #303 exit 1 before the try/catch is non-blocking (MED) | OPEN, CARRIED to AP-13. Reproduced: exit=1 with ERR_UNKNOWN_FILE_EXTENSION | finding 7 |
| #304 quadratic redirect scan outruns the timeout (MED) | OPEN, CARRIED to AP-14. Reproduced and quantified: 2000 ms near 31 KB, 78.6 s at 205 KB, i.e. past the planned 60 s entry timeout | finding 7 |
| #305 fixture can override a built-in tool class (MED) | NO GATE EFFECT today (R-B: no built-in is class-routed; AC-H8 pins it) and my X-F mutant that admits built-in entries as server names dies on N4. CARRIED to AP-2 / AP-12 | mutation drill X-F |
| #306 author-natural deny shapes load clean and never match (MED) | OPEN, CARRIED: the four inert shapes are documented in the grammar header and pinned by G13b; PT-12 is an AP-1 entry test | code-traced tool-class-format.ts header, G13b |
| #307 mutation-drill predictions false (MED) | CLOSED IN CODE: the plan now records ACTUAL red sets and my independent re-run reproduces 6 of 7 exactly | finding 10 |
| #308 activation (feature) | OPEN by design; my findings 1, 3 and 4 add named work to it | - |

## Editorial (verdict-neutral, fix as plain edits, no re-review)

1. **Residual R-4 overstates its own risk and names the wrong examples.** R-4 says a format drift affecting only the Thoth line (BOM, NBSP or an indent on that line) still resolves absent. It does not: classifyParentListing trims each line before the anchor comparison, so a BOM-prefixed, NBSP-prefixed, space-indented or trailing-space Thoth line is still recognised as listed and the original error is rethrown (cases 4, 5, 6, 13 in finding 8). The real drift that would resolve absent is one where the Thoth line PATH TEXT differs (a redirected 32-bit view, a different hive spelling), and case 18 shows that shape making the whole listing unrecognised, which also rethrows. R-4 should be restated or closed.
2. **Plan section 20a, M1 row.** My independent M1 run also reddens N1; the table lists six tests. Harmless (more kills than claimed), but the row reads as exhaustive.
3. **hooks/pretooluse-kernel-gate.mjs SUR-10 header comment** enumerates the fail-open paths and is honest about AP-13 and AP-14; it does not mention a discarded stdout write (finding 3). One line would close the gap between the comment and the probe.

## The single scariest unproven assumption

**That "silence means allow" is safe because the adapter is the only thing that can produce silence.** The typed, closed renderHookOutput genuinely removes the polarity risk INSIDE the process (mutant X-C dies), but the process can still be silent for reasons the adapter never sees: a launch failure before the try/catch (AP-13, reproduced, exit 1), a timeout on a padded command (AP-14, reproduced, 78.6 s at 205 KB), and a write whose pipe went away (finding 3, exit 0 with the deny discarded). Every one of those is a silent allow on a fail-closed gate, and only the first two are recorded. The design compensates by staying unwired - which is the right call, and is exactly why this merge is safe.

## Go / no-go

**go** for merging this diff as an UNWIRED change. No HIGH finding survived my attacks: 0 marker-verb forgeries in 60,073 commands, 0 name collisions in 4,021 names, 18 of 18 hostile hook payloads deny or exit 2, 18 of 18 registry combinations refuse to invent an absent, 7 of 7 plan drills reproduce and 7 of my 8 new mutants die. The two BREAKS are one MED availability asymmetry on a non-English host (activation-scoped) and one LOW hygiene defect (unbounded reason reflection). **No-go for activation** until findings 1, 3 and 4 are named on #308 alongside AP-1..AP-14, because each of them is a would-be MED-to-HIGH the moment the PreToolUse entry exists.

## Single next action

Add the three named proof-tests (C12, G21 and the stdout-closed-before-write probe row) plus the X-2 settling command to Issue #308 as activation work, then merge the unwired diff.

## RECEIPT

    RECEIPT: verdict=go
    attacks (ALL, ranked by blast radius):
    1. [ISSUE][MED][demonstrated] #107 additive fallback: on a non-English host a Thoth key present WITHOUT its value is rethrown as a read-error (English resolves absent), so at activation every gated call denies until the half-provisioned key is fixed; defense: none specific (R-4 covers a different case, AP-9 does not name this trigger); proof-test C12 + an AP-9 line
    2. [ISSUE][LOW][demonstrated] the unroutable-tool deny reason interpolates the whole untrusted tool_name with no cap (real hook emitted 400,197 bytes of valid deny JSON); defense: none; stdout is NOT truncated under a slow reader (300,193 bytes intact), POL-05 reasons stay 180-283 bytes; proof-test G21 (cap at 512 chars)
    3. [SUSPICION][LOW][demonstrated] a destroyed/closed stdout makes a decided deny vanish with exit 0 = silent allow; defense: renderHookOutput is closed and typed (mutant X-C dies) but the adapter has no write-error listener or flush check; not in the SUR-10 table; trigger only in a crash/kill window, so UNPROVEN; settle with a gate-fail-open-probe row stdout-closed-before-write expecting BLOCKS
    4. [SUSPICION][LOW][demonstrated] injective-or-unresolved is enforced on the SERVER segment only: a tool segment with a trailing space, NUL or zero-width char lands verbatim in the identity target, so an exact per-tool deny can be evaded while class and server-prefix rules still fire; defense: parse guards cover only empty/leading-underscore/double-underscore/slash; depends on unrun X-2, so UNPROVEN; settle with X-2 then test N13
    5. [CLEAN][demonstrated] marker-verb forgery from Bash: 0 hits in 60,073 real shell-normalizer cases; the 15 identity-target forgeries are the documented fact 3 shape (deny-safe, allow-unsafe) and stay carried to AP-1/PT-1/#299; defense (marker outside KNOWN_VERBS) assessed and it holds
    6. [CLEAN][demonstrated] mcp__ name resolver: 0 collisions over 4,021 names (space/dot/colon/underscore/unicode/case/5000-char/prototype-property), all ambiguous splits unresolved, index is a Map so prototype names are inert, duplicate-with-different-class rejected
    7. [CLEAN][demonstrated] fail-open hunt on the real hook: 18 hostile payload shapes (BOM, CRLF, array, 8 MB stdin, missing/mistyped tool_input, Cyrillic Bash lookalike, lowercase bash, NUL suffix, 400 KB tool_name) all deny or exit 2; AP-13 reproduced (exit 1) and AP-14 reproduced and quantified (2000 ms near 31 KB, 78.6 s at 205 KB, past the planned 60 s entry timeout); no NEW path except attack 3
    8. [CLEAN][demonstrated] #107 fallback is downgrade-only: 18 crafted stdout/stderr/exit combinations, absent only on positive parse evidence, Thoth visible (incl. BOM/NBSP/indent/trailing-space/CRLF variants) always rethrows; existing central-source tests +165/-0
    9. [CLEAN][demonstrated] posture print wording does not overclaim central enforcement and the peer-override truth is real (central posture deny + rank-0 allow rule = allow, run on the real kernel); disclosure literal tied to settings state by AC-P5
    10. [CLEAN][demonstrated] mutation strength: 63/63 baseline; M1-M7 re-run, 6 of 7 red sets exactly equal the plan X-3 table (M1 a 7-test superset); 8 new mutants, 7 killed (X-A,X-B,X-C,X-D,X-F,X-G,X-H), 1 survivor (X-E) that is behaviourally equivalent
    11. [CLEAN][demonstrated] nothing can activate the gate: hooks keys are SessionStart and UserPromptSubmit only, no kernel-gate reference in the hooks object, no settings.local.json or .mcp.json, settings diff is comment-only
    12. [CLEAN][demonstrated] answer-key integrity: the five test-writer paths are byte-identical aa97bdc vs 94c5315 (empty diff, sha256 equal); only central-source.test.ts changed after test-writer (+165/-0)
    13. [CLEAN][code-traced] Issues #299-#307 re-checked: #299 (class dimension), #300, #301, #302, #307 closed in code; #303, #304, #305, #306 carried to activation; #308 open by design
    counts (CHECKSUM): issues=2 suspicions=2 clean=9
    evidence (CHECKSUM): demonstrated=12 code-traced=1 derived=0
    checks=full suite 1213 pass / 0 fail / 0 skipped (npm test); drill baseline 63 pass / 0 fail / 0 skipped; 15 mutation runs (7 plan drills + 8 new, 14 killed, 1 equivalent survivor); 60,073 shell-forgery cases; 4,021 name-resolver cases; 18 real-hook payloads + 4 pipe/stdin faults + a 7-point latency curve; 18 registry-combination cases; AP-13 launch fault reproduced
    adr=HIT(37)
    report=docs/reviews/s7-kernel-gate-classification-red-team-2026-09-26.md
