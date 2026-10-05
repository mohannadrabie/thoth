# #308 story E (AP-1 baseline rules): red-team review

[red-team] Red Team (Sutekh): attacking #308 story E (baseline rules, AP-1) with failure scenarios.

- Date: 2026-10-04
- Tier: CRITICAL (guard content, policy delivery)
- Diff: `217b4c4..e9c1638` (2d46d4e plan, b44f6b2 story E, e9c1638 plan fix). HEAD: e9c1638
- Worked in a detached worktree at e9c1638 (`scratchpad/rt-E`), node_modules junctioned read-only from the main repo; the shared working tree was not read. The worktree was removed afterwards.
- ADR: `📊 ADR cache BUILT: cataloged 3 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:3], catalog now current (fp 59887bb) [CACHE=HIT]`. Read THOTH-ADR-0001 and THOTH-ADR-0003 (rules 1 to 9; rule 8 hold, rule 9 hardcode ban). THOTH-ADR-0002 is out of scope.
- Exposure today: **the gate is not wired** (story K held), so 0% of live calls pass through it. With the real fixture, the shipped rule also matches **no** record: all 6 `centralLayer` entries are `remote-mutating` (count measured below). Every exposure figure below is latent: it applies once K wires the gate and a read-only entry or a deny posture exists.
- Known and ruled, not re-filed: verb-only allow withheld (PT-2); shipped `mandatory` inert (F); Bash POL-05 reads (#408); redirect hides command (#411); stale fixture notes and no read-only entry (#413, cross-domain); E6 per-file verdict (#412, architecture; my repro is posted there as a comment).

## Verdict: go

There is no HIGH. The rule data is sound: Bash cannot forge the marker, every rule-data mutant I planted dies, and no existing outcome changes. Two MED test-strength gaps: PT-2 cannot see the verb `read` (new, #414), and the E6 ratchet is per file (#412). Both are latent today, and both would let the next story ship something these checks are supposed to stop. The ADR-0003 hold still applies (E7). That hold is not a finding.

## Raw evidence

### Story E tests and the E6 script
```
$ node --test src/policy/config/baseline-rules.test.ts src/qa/fixture-name-triage.test.ts
E6: 8 hit(s) in 6 file(s): src/policy/fixtures/allowlist-settings.ts, src/policy/tools/mcp-enumeration.test.ts, src/policy/verification/allowlist.test.ts, src/qa/vendor-tool-inventory.test.ts, src/secret-scan/history-scan.test.ts, src/secret-scan/patterns.test.ts
ℹ tests 11  ℹ pass 11  ℹ fail 0  ℹ skipped 0
$ npm run -s qa:fixture-name-triage
fixture-name-triage: 14 fixture names read at run time; 8 literal hit(s) in 6 file(s)
exit=0
```

### Full suite at e9c1638
```
$ node --test
ℹ tests 1882  ℹ pass 1878  ℹ fail 4  ℹ cancelled 0  ℹ skipped 0
FAIL REAL_SHELL_FORM_TIMER + measureLatency: p99 (2388.38ms) exceeds (2000ms)        [machine load: suite ran in parallel]
FAIL QA-14 (dogfood): ADR-0021: no ADR with this id exists in the tree               [adr/ submodule not checked out in the worktree]
FAIL OSS-01 (dogfood): [oss01-scan-timeout] did not finish within 500ms              [timing under load]
FAIL R4: a fresh LOCAL clone: EBUSY: resource busy or locked, rmdir                  [Windows temp-dir lock]
```
None of the four failures touches a file in E's diff. All four depend on the environment (timing, the submodule missing from the worktree, a Windows file lock). No locked test asserted the placeholder `rules: []` or its version string, so the E-recorded step had nothing to replace.

### Rule-data and normalizer mutants (planted in the worktree, restored with git checkout after each)
```
M2 verbs+write: pass=5 fail=2 -> E-shape | PT-1
M3 all-markers: pass=5 fail=2 -> E-shape | PT-1
M4 empty-verbs: pass=4 fail=3 -> E-shape | PT-1 | PT-2
M4b no-verbs-key: pass=4 fail=3 -> E-shape | PT-1 | PT-2
M5 env-scoped: pass=5 fail=2 -> PT-12 | PT-1
M6 declared-deny: pass=5 fail=2 -> E-shape | E3
M10 target mcp/: pass=6 fail=1 -> E-shape
M11 marker typo: pass=1 fail=6 -> load failure, all but one test red
M12 extra verb-read rule: pass=5 fail=2 -> E-shape | PT-12        (PT-2 stays GREEN)
M1 marker in KNOWN_VERBS: pass=6 fail=1 -> PT-1
M7 sourceLayer filter removed (tool-class-format.ts): baseline-rules 7/7 green; killed by tool-class.test.ts N4 and N4 negative control
```
11 planted, 11 killed. Note that M7 is killed only by the pre-existing S7 tests, not by E's own tests.

### PT-2 per-verb probe
```
verb-only allow [read]: PT-2 flags 0 of 4; probe "rm read pods/x --context=c" -> verbs=["read"] unresolved=0 outcome=allow
verb-only allow [list]: PT-2 flags 1 of 4; probe "rm list pods/x --context=c" -> verbs=["list"] unresolved=0 outcome=allow
verb-only allow [describe]: PT-2 flags 1 of 4; probe "rm describe pods/x --context=c" -> verbs=["describe"] unresolved=0 outcome=allow
verb-only allow [get]: PT-2 flags 2 of 4; probe "rm get pods/x --context=c" -> verbs=["get"] unresolved=0 outcome=allow
```

### Outcome differential (real loader, real fixture catalog; shipped rules vs an empty shipped layer)
```
defaultOutcome shipped: {"outcome":"allow","source":"bootstrap"} base: {"outcome":"allow","source":"bootstrap"}
records=19 outcome-changed=0 ruleId-changed=0 (read-only entries in the real fixture: 0)
```
Corpus: 10 shell commands (reads, rm -rf, kubectl get/delete, redirect into mcp/, marker-token forgery, other-binary verb), the 6 real fixture servers as mcp__NAME__x, plus unlisted, built-in-named and space-named servers.

### Built-in-name entry probe
```
built-in read-only names: 15 AskUserQuestion,BashOutput,CronList,ExitPlanMode,Glob,Grep,ListAgents,ListMcpResources
entry {name:AskUserQuestion, read-only} passes the lowering guard; mcp__AskUserQuestion__delete_everything -> ["tool-class:read-only"] { outcome: allow, ruleId: baseline-allow-class-read-only }   (posture deny)
without the entry: opaque [ server "AskUserQuestion" is not classified ]
```

### E6 ratchet mutant (per-file verdict)
```
# appended to src/policy/tools/mcp-enumeration.test.ts a test whose body holds a SECOND fixture server name as a whole literal
$ npm run -s qa:fixture-name-triage ; echo exit=$?
exit=0
src/policy/tools/mcp-enumeration.test.ts  [not-violation]  synthetic .mcp.json fed to name extraction; asserts extraction, not classification
    line 158: "<name>"  (is or spells an entry name)
UNTRIAGED/STALE/VIOLATION lines: 0
```

### E6 spelling probe (names read from the fixture at run time; synthetic text)
```
FOUND   control: whole literal
FOUND   control: mcp__X__ form
MISSED  unquoted object key
MISSED  mcp__X without trailing __
MISSED  mcp/X without trailing slash
MISSED  concatenation
MISSED  interpolation in template
MISSED  regex literal
MISSED  runtime (sanitized) connector tool name
MISSED  connector sanitized, whole
MISSED  multi-line template
```
Real-repo cross-check: code lines that hold a fixture name and that the scanner did not report numbered 93. All 93 are prose, synthetic stand-ins (fixture-github-standin) or token-prefix strings, except one group: src/policy/tools/mcp-enumeration.test.ts lines 49, 60, 68, 79, 92, 101, 138 and 146 use a fixture name as an **unquoted object key** (mcpServers: { NAME: ... }). That file is caught only because it also holds quoted literals on lines 62 and 96. Extensions under hooks/ and src/: ts 209, mjs 3, json 3, sh 1 (the 3 json files hold no name).

## Attacks, ranked by exposure x irreversibility x silence

### 1. PT-2 cannot see the verb `read`: BREAKS (MED, demonstrated). Issue #414
**Assumption:** "PT-2: a read verb does not authorize a different binary", and PT2-mutant shows the check has teeth.
**Scenario:** story E0 (#408) brings back a verb-scoped shell read allow, as CHANGELOG and the plan promise. E-shape has to be edited to accept the new id, so PT-2 is the only check left on that allow. If the new rule allows `read`, or if E0 makes get/list/describe binary-aware and leaves `read` as it is, PT-2 stays green while `rm read pods/x --context=c` normalizes to verbs [read] and is allowed under a deny posture. PT2-mutant does not catch this because it seeds all four verbs at once and `get` alone trips it. `list` and `describe` each rest on a single witness.
**Current defense:** E-shape pins the id list exactly, so nothing can ship silently in E itself (M12 is killed by E-shape and PT-12, not by PT-2).
**Exposure:** 1 of the 4 read verbs (25%) is outside PT-2, counted in code (baseline-rules.test.ts OTHER_BINARY_READS). Runtime exposure is 0% today. The failure is silent: the test stays green.
**Proof test before E0 merges:** `PT-2 per-verb: for every non-mutating KNOWN_VERBS v, a verb-only allow [v] is flagged by pt2Violations`, with witnesses built from KNOWN_VERBS and not typed by hand.

### 2. The E6 ratchet is per file: BREAKS (MED, demonstrated). Duplicate of #412, repro posted there
**Assumption (EFJ plan, E6):** "a new hit fails the script until triaged".
**Scenario:** a later story adds a fixture-behavior test to mcp-enumeration.test.ts (the natural home for MCP-name tests) using a hardcoded entry name, which breaks ADR-0003 rule 9. The new hit inherits the not-violation verdict of the file, and the script and its test both stay green (exit 0, shown above).
**Exposure:** 6 of the 216 scanned files (about 3%) carry a blanket verdict, counted in code (TRIAGE). The failure is silent.
**Proof test:** `E6 ratchet: a new hit in an already-triaged file fails until its (file, name, count) is triaged`.

### 3. A built-in-name fixture entry grants a whole MCP server: BREAKS (LOW, demonstrated)
**Assumption:** a central entry named after a built-in tool restates or raises the class of that tool (ADR-0003 rule 3: "MUST NOT lower").
**Scenario:** a reviewed PR adds {name: a built-in read-only tool, class: read-only}, meaning "this built-in reads only". The lowering guard passes it, because the class is kept, not lowered. buildServerIndex admits the name as an MCP *server*, so every tool of any .mcp.json server with that name (mcp__NAME__delete_everything) gets the read-only marker and baseline-allow-class-read-only allows it, even under a deny posture. Without the entry, the same call is opaque and POL-05 denies it. This is a special case of the disclosed INT-07 name-spoofability residual, but a reviewer of such an entry would not see that it reaches MCP servers. AC-H8 tests only the built-in tool call, never its mcp__ spelling.
**Exposure:** 0 entries today; 15 built-in read-only names could be used this way, counted by probe. Severity is capped at LOW: the trigger is a reviewed fixture PR, and ADR-0003 rule 3 requires a dated review for every addition.
**Proof test:** `a central entry whose name equals a built-in tool name does not classify mcp__NAME__*` (or the catalog loader rejects such an entry).

### 4. E6 misses common spellings: BREAKS within disclosed limits (LOW, demonstrated)
**Scenario:** besides the two shapes it targets, the scanner misses unquoted object keys (a form this repo already uses for a fixture name, mcp-enumeration.test.ts line 49 and following), "mcp__NAME" with no trailing __ (a natural startsWith prefix), "mcp/NAME" with no slash (the no-slash inert shape a PT-12 test would write), the runtime-sanitized connector spelling mcp__claude_ai_X__, regex literals and multi-line templates. Concatenation and interpolation are deliberate evasion and fall outside an honesty instrument. The header discloses "string literals only" and "a name embedded in a longer literal in any other form is not found", which covers most of these. That is why this is LOW. The unquoted-key and prefix-only forms are the cheap ones to close.
**Exposure:** 9 of 9 alternate spellings missed by probe. In the real repo today, 1 file uses the missed form, and it is caught by other literals in the same file.
**Proof test:** `scanText finds unquoted-key, prefix-only (mcp__NAME, mcp/NAME) and sanitized-runtime spellings`.

### 5. E2: H11/H11b never run against the real shipped rule: UNPROVEN-pending-verification (LOW, code-traced)
**Assumption (EFJ plan, E2):** "Existing N9, N9b, H11, H11b re-run against shipped rules ... no edit to those tests".
**Reality:** hooks/test-support/gate-sandbox.ts:209 writes EMPTY_RULE_SET over the shipped-defaults of the sandbox, by design ("a later story that ships baseline policy content must not silently change these expectations"). H11/H11b therefore never see baseline-allow-class-read-only. PT-1 re-runs the N9b forgery shapes in memory through decide() against the real file, which covers the kernel half. The hook half (routing, the SHIPPED_DEFAULTS_PATH resolution of the hook, the loader inside the hook) with the real rule loaded has no test.
**Settles it:** `AC-H11b-shipped: gate sandbox keeping the REAL shipped-defaults.json, project defaultOutcome deny: Bash marker forgeries denied, genuine read-only MCP call allowed`. Owner: test-writer or story-implementer. Run with node --test hooks/pretooluse-kernel-gate-classification.test.ts.

### 6. Forging the read-only marker from Bash or MCP: SURVIVES (demonstrated)
The marker is not in KNOWN_VERBS (action-catalog.ts:21). resolveVerb lowercases and does an exact lookup, so no casing variant resolves. Shell and cluster verbs come only from resolveVerb plus "write". Planting the marker in KNOWN_VERBS (M1) is killed by PT-1. MCP names carrying ":" fail ADMISSIBLE_SERVER_NAME/ADMISSIBLE_TOOL_NAME and come out opaque. The rule has no target, so a redirect target into mcp/ cannot match (verb write is not the marker). The gate routes only Bash and mcp__ (tool-routing.ts:40). The cluster normalizer is not routed.

### 7. The rule data has teeth: SURVIVES (demonstrated)
Every rule-data mutant that matters dies: widened verbs (M2, M3), match-all (M4, M4b), environment-scoped (M5), declared deny posture (M6), added target (M10), misspelled marker (M11), extra verb rule (M12). E3 pins {allow, bootstrap}.

### 8. Does any existing outcome change? SURVIVES (demonstrated)
Kernel precedence (kernel.ts:179-206): an allow rule under a resolved allow default cannot change an outcome. The differential over 19 records gives 0 outcome changes and 0 ruleId changes, because no committed entry is read-only. The full suite shows no locked test broken by the edit. Honest corollary, already on #413 and #408: as of e9c1638, the AP-1 promise to "read freely" grants nothing in practice. Bash reads are POL-05-denied once wired, and the only class rule matches no committed entry.

### 9. Inventory drift, name spoofing, and self-grant via a fixture edit: SURVIVES as disclosed (code-traced)
- buildServerIndex considers only sourceLayer "central" (tool-class-format.ts:236). Removing that filter (M7) is killed by tool-class N4. Built-in layer entries never classify MCP servers, apart from the built-in-name case in attack 3.
- A .mcp.json server named like a read-only entry inherits the class. This is the disclosed INT-07 residual in THOTH-ADR-0003 ("Name spoofability"). Live exposure is 0: no read-only entry exists.
- A session editing the fixture to self-grant read-only: ADR-0003 rule 6 requires the story F deny rules and the story K permissions.deny Edit entry before wiring, and rule 8 holds E, F, J and K. The catalog is read per call (pretooluse-kernel-gate.mjs:202), so the protection has to be in place at wiring time, and the hold enforces that.
- Project-layer override of the shipped id (precedence.ts merge by id): the project layer can add any allow rule anyway, V4 applies on every layer, and replacing the shipped allow only narrows. This grants no new power.

## Scariest unproven assumption
That PT-2 is the safety net for the verb rule E0 will bring back. It is not: it is blind to `read`, and its mutant hides that.

## Go / no-go
**go** for the rule data, held behind THOTH-ADR-0003 acceptance (E7, not a finding).

## Single next action
Make the PT-2 witnesses and PT2-mutant per-verb, derived from the non-mutating KNOWN_VERBS (#414), before E0 (#408) starts.

## Open findings to failing tests
Open findings: 5 (attacks 1 to 5). Named failing tests: 5. One per finding, as listed under each attack.

## Editorial
- The CHANGELOG says the red run of baseline-rules recorded "3 failing". My mutants could not re-check this; the number is taken on trust.
- EFJ plan E1 says PT-12 shapes a, b and d are schema-invalid "on every layer" and that shape c and valid denies load. PT-12b asserts only shapes a and b, on the project layer only. If existing rule-reachability tests cover every layer, cite them in the plan; otherwise the plan overstates.
- baseline-rules.test.ts header: "PT-12 ... the inert deny shapes are still load failures on top of the shipped layer". Accurate for two of the four shapes.
- Fixture notes[2] and the gate header line 11 still say no shipped rule matches a class (#413, already filed).

RECEIPT: verdict=go
attacks:
1. [ISSUE][MED][demonstrated] PT-2 witness set never yields verb read; verb-only allow [read] flagged 0/4, authorizes `rm read pods/x`; PT2-mutant masks it (all 4 verbs); E-shape is the only guard until E0 (#414)
2. [ISSUE][MED][demonstrated] E6 verdict keyed per file: a new hardcoded entry name in triaged mcp-enumeration.test.ts stays exit 0; contradicts plan E6 "new hit fails" (dup of #412, repro commented)
3. [ISSUE][LOW][demonstrated] central entry named after a built-in read-only tool passes the lowering guard and makes mcp__NAME__* read-only, so baseline allow under a deny posture; 0 entries today, 15 usable names
4. [ISSUE][LOW][demonstrated] E6 misses unquoted object keys (used in repo today), mcp__NAME prefix, mcp/NAME without slash, sanitized connector spelling, regex, multi-line; 9/9 alternates missed; mostly disclosed in header
5. [SUSPICION][LOW][code-traced] E2 not executed at hook level: gate-sandbox.ts:209 blanks shipped-defaults, so H11/H11b never load the real rule; PT-1 covers the kernel half only
6. [CLEAN][demonstrated] Bash/MCP marker forgery: marker not in KNOWN_VERBS, M1 killed by PT-1, ":" names opaque, no target to redirect into
7. [CLEAN][demonstrated] rule-data mutants M2-M6, M10-M12 all killed by E-shape/PT-1/PT-2/PT-12/E3
8. [CLEAN][demonstrated] no existing outcome changes: 19-record differential 0 outcome / 0 ruleId changes; no locked placeholder test; full suite failures environmental only
9. [CLEAN][code-traced] inventory drift (M7 killed by N4), .mcp.json name spoofing (ADR-0003 disclosed residual, 0 read-only entries) and fixture self-grant (rule 6 plus rule 8 hold) all covered
counts: issues=4 suspicions=1 clean=4
evidence: demonstrated=7 code-traced=2 derived=0
checks=story-E tests 11 pass/0 fail/0 skip; full suite 1882: 1878 pass/4 fail (environmental: latency p99, QA-14 ADR-0021 submodule absent in worktree, OSS-01 scan timeout, R4 EBUSY)/0 skip; mutants 11 planted/11 killed; PT-2 per-verb [read] mutant SURVIVED (0/4); E6 ratchet mutant SURVIVED (exit 0); E6 spelling probe 9/9 missed, 2/2 controls found
adr=HIT(3)
report=docs/reviews/s308-E-baseline-red-team-2026-10-04.md
HEAD: e9c1638
