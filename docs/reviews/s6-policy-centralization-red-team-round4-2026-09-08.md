# Red Team (Sutekh) — S6 policy centralization, ROUND 4: final closing re-confirm of Issues #118 / #119

**Date:** 2026-09-08 · **Scope:** commit `602be5c` ("S6 Stage-3 round-3 re-confirm fix-now: Issue #118 (MED) + Issue #119 (MED)"), diffed against `0ee4871` — `src/policy/rule/mandatory-lock-conformance.test.ts`, `src/policy/rule/schema.ts`, `src/policy/config/position-parser.ts`, plus new cases in `src/policy/config/position-parser.test.ts` and `src/policy/config/loader.test.ts`
**HEAD:** `602be5c` — committed; zero `src/` entries in `git status --short` before and after every mutation I applied and reverted
**Prior rounds:** `docs/reviews/s6-policy-centralization-red-team-2026-09-08.md` (no-go) · `docs/reviews/s6-policy-centralization-red-team-round2-2026-09-08.md` (no-go, Issues #114/#115) · `docs/reviews/s6-policy-centralization-red-team-round3-2026-09-08.md` (go, Issues #118/#119)
**Verdict: go** — both assigned Issues independently re-verified CLOSED against my own round-3 repros. Issues #118 and #119 closed by me this turn.
**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]

ADRs re-read from `adrCatalog.adrs` for this attack surface: SE ADR-0021 (kernel purity, POL-03 identical verdicts, never a silent allow), SE ADR-0019 (self-protection / boundary placement), SE ADR-0002/0003 (layering, injectable I/O), SE ADR-0006 (blast radius / no scope widening).

**The headline, stated plainly:** both fixes are real, and both are the *better* of the two options I named in round 3. The `#118` self-check now fails on exactly the mutation that stayed 12/12 green last round, and it fails with a message that names the missing layer. The `#119` fix shares one decoder rather than adding a second, and it is precise rather than lossy — I probed eleven key spellings and every near-miss correctly did **not** match. Neither fix over-tightened: 336 valid documents, zero false rejections, zero index misalignments. What I found on the way is not in either fix: the `REJECTED: central policy load failed` prefix still blames the central channel for a **project**-file parse error, which was half of Issue #108's own stated defect and which I closed prematurely in round 2 on the other half. That is a re-opened Issue, not a new one, and it does not gate this round.

## What I actually ran

```
$ git rev-parse HEAD
602be5c8e701ea2793f3872e4d95553a658d286d

$ npm run typecheck                       # tsc --noEmit -p tsconfig.json     exit 0
$ npm run lint                            # eslint .                          exit 0

$ node --test --test-reporter=tap
# tests 642
# pass 641
# fail 1
# cancelled 0
# skipped 0
# todo 0

$ node --test --test-reporter=tap   (failing case only)
not ok 636 - OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass
                          # pre-existing at HEAD, Issue #113, unchanged across all four rounds

$ node --test src/policy/rule/mandatory-lock-conformance.test.ts \
              src/policy/config/position-parser.test.ts \
              src/policy/config/loader.test.ts \
              src/policy/rule/schema.test.ts
# tests 65   pass 65   fail 0   skipped 0   todo 0

$ node --test src/policy/config/printer.test.ts
# tests 9    pass 9    fail 0   skipped 0
```

Test-count delta 638 to 642 matches the diff exactly: +1 `position-parser.test.ts` case, +3 `loader.test.ts` cases, the `#118` self-check rewritten in place.

Plus, purpose-built this round: three source mutations applied and reverted (a 4th trust layer at three different walk positions), a direct re-run of round 3's `#119` repro with the backslash built at runtime, an eleven-spelling top-level-key matrix, two decoy probes, a twelve-shape `-1`-sentinel reachability probe, a 336-document differential fuzz, a per-file attribution of QA-14's citation failures, and eleven `qa:*` gate runs.

---

# Findings, ranked by blast radius (exposure x irreversibility x silence)

## 1. [ISSUE][MED][demonstrated] `REJECTED: central policy load failed` still blames the central channel for a **project**-file parse error — the other half of Issue #108, which I closed early in round 2

**Attack.** A Windows operator edits `.thoth/policy.json` and saves it from PowerShell 5.1 (`Out-File -Encoding utf8`) or Notepad's "UTF-8 with BOM". The file now begins with a BOM. Nothing about the central channel is involved — central is absent. Run the real printer:

```
=== UTF-8 BOM on .thoth/policy.json (pre-existing, NOT this diff) ===
central-channel status=absent
REJECTED: central policy load failed (json-parse-error): C:\...\project.json: Unexpected token '', "{
  "vers"... is not valid JSON
stderr: (none)
exitCode = 1
```

Line 1 says central is **absent**. Line 2 says **central policy** load failed. The broken file is the operator's own project layer, named correctly at the end of a long message but contradicted by the prefix. `src/policy/config/printer.ts:67` hardcodes the prefix for every rejection reason kind, and `renderRejection` is reached from every load failure — `json-parse-error`, `schema-invalid`, `read-error` — regardless of which of the three layers failed.

**This is half of Issue #108's own body**, verbatim: "printer.ts:40 then misattributes a project-file fault to the central channel, and that 4th reason kind has no printer test." The fix-now round correctly repaired the *voided-layer* attribution (`src/policy/config/printer.ts:75-79` names the offending layer by name), and my round-2 comment closed #108 on the strength of that path alone — "nothing is misattributed to 'central policy load failed' while central is absent". I checked the voided-layer path and did not check `renderRejection`. That closure was premature, it is mine, and I am recording it rather than restating the finding as new. Per this project's Issue Discipline rule 2, #108 is REOPENED rather than duplicated.

**Current defense, honestly assessed.** Fail-CLOSED, and that matters: `exitCode = 1`, two lines exactly, and an assertion that no rule data leaks through a rejection (`src/policy/config/printer.test.ts:276`). Nothing is silently allowed, no enforcement decision is affected, and the failing file's real path IS printed in the message body. The harm is purely diagnostic: POL-10's acceptance text is "One command answers 'why is this blocked' without reading a script", and for this input the command's first answer points the operator at the wrong owner — plausibly at an IT ticket about central policy when their own file has a BOM.

**The constraint that makes this non-trivial, named so the fix is not attempted blind:** the prefix is pinned by `test-writer`'s locked answer key. `src/policy/config/printer.test.ts:272` builds a RegExp on the exact literal prefix, and `src/policy/config/printer.test.ts:84` documents it as the contract. Per this project's DoD, `story-implementer` may not edit that file. **Unlock:** `test-writer` (or the Manager, in writing) amends the answer key's expected prefix — e.g. "REJECTED: policy load failed (reason-kind)", or a layer-attributed prefix — and only then does the printer change land.

**Exposure:** ~100% of load-rejection outputs whose failing layer is not central, basis: counted-in-code — one string literal, one call site, `src/policy/config/printer.ts:67`, reached by all three rejection reason kinds. Share of real operator runs that hit a rejection at all: unmeasured, and I am not pricing the finding on it. Irreversible: no. Silent: no — it is loud, it is just loudly wrong about who to blame.

**Verdict: BREAKS** — diagnostics attribution, not enforcement. Pre-existing, outside this re-confirm's assigned scope, and **not gating for round 4**: it predates `0ee4871`, this diff neither introduced nor touched it, and it is not a security, data-integrity, legal or safety finding (PRINCIPLES rule 21).

**Proof-tests required:**
- `src/policy/config/printer.test.ts` -> **"a rejection caused by the PROJECT layer never claims the central channel failed"** — feed a malformed project layer with central absent and assert the prefix does not contain the word central. Requires the answer-key amendment above first.
- `src/policy/config/loader.test.ts` -> **"a UTF-8 BOM on any layer file is either tolerated or rejected with that layer named"** — the concrete trigger, independent of prefix wording.

---

## 2. [ISSUE][MED][demonstrated] Two CI-gating steps are red at HEAD with no tracking Issue, and this commit's own CHANGELOG stopped disclosing them

**Attack.** A human performing merge-handoff reads the DoD's "tests green in CI with real counts" and the round-4 CHANGELOG entry, which lists typecheck/lint/full-suite and nothing else. I ran the exact commands `.github/workflows/ci.yml` runs:

```
$ node src/qa/completeness-claim-checker.ts          # CI step "QA-15 completeness-claim-checker"
[QA-15 completeness-claim-checker] FAIL: 1 of 3 file(s) had a failing completeness claim.
  - docs/decisions.md: 4 of 4 numeric completeness claim(s) failed.
REAL exit=1

$ node src/qa/reference-resolver.ts                  # CI step "QA-14 reference-resolver" (diff-aware)
[QA-14 reference-resolver] FAIL: 126 of 320 citation(s) failed to resolve.
REAL exit=1

$ npm test                                            # CI step "Test (full node:test suite)"
# fail 1   -> OSS-01 dogfood, Issue #113
```

Three red CI steps. One (OSS-01) is tracked by Issue #113. **Neither QA-14 nor QA-15 has an open tracking Issue** — a full `gh issue list --state all` across every S4/S5/S6 issue returns only closed predecessors (#79, #85) for different, since-fixed causes.

Per-file attribution of QA-14's 126 failures, generated by running the checker's own exported `scanReferences` over this diff's changed files rather than by hand:

```
CHANGELOG.md                                                     142 citations,  47 NOT-RESOLVED
docs/decisions.md                                                 84 citations,  31 NOT-RESOLVED
docs/backlog.md                                                   54 citations,  18 NOT-RESOLVED
docs/REVIEW_LOG.md                                                16 citations,  15 NOT-RESOLVED
docs/reviews/s6-...-red-team-round3-2026-09-08.md                 18 citations,   9 NOT-RESOLVED
src/policy/rule/schema.ts                                          4 citations,   4 NOT-RESOLVED
src/policy/config/position-parser.ts                               2 citations,   2 NOT-RESOLVED
TOTAL: 320 citations, 126 not resolved
```

Two distinct causes, and they deserve different treatment:
- **Structural, not fixable in a diff:** every issue-number citation resolves through `deps.issueExists`, wired to always return null at `src/qa/reference-resolver.ts:275` ("no issue-tracker credential ... fails closed"). Any changed file citing an issue number makes this gate red, by construction. This commit's new source comments add 3 more.
- **Mine, and fixable:** 6 of the 9 failures in the round-3 report are my own bare-filename citations — `position-parser.ts:195`, `loader.ts:111`, `precedence.ts:263`, `mandatory-lock-conformance.test.ts:37`, `print-cli.ts:39`, `council-trust-model-architecture-2026-09-08.md:110`. The resolver needs repo-relative paths. This round-4 report uses them throughout; that is the lesson applied, not merely noted.

**Current defense, honestly assessed.** The condition is loud, not silent — CI shows red, nobody is fooled by a green check. Rounds 1-3 disclosed it explicitly in `docs/decisions.md` and `CHANGELOG.md` ("fail on the same pre-existing rows/citations as every prior S6 round, none touched or added by this diff"). The round-4 entries do **not** repeat that disclosure — they omit both gates from their Verification lines. That is an omission, not a false claim, and I want the distinction on the record: nobody wrote anything untrue. But the round-3 claim "none touched or added by this diff" would not have held for round 4 had it been repeated, since this diff does add 3 new unresolved citations.

**Exposure:** 100% of CI runs on this branch, basis: demonstrated — I ran the three CI step commands verbatim and captured their real exit codes. Irreversible: no. Silent: no.

**Verdict: BREAKS** — process/CI-state, not a code defect, and **not gating**: pre-existing in kind, loud, and unrelated to either fix under review.

**Proof-test / resolution required:**
- One GitHub Issue tracking QA-14 + QA-15 red at HEAD (filed by me this turn), so merge-handoff is made against a known state rather than an assumed-green one.
- `src/qa/reference-resolver.ts` -> **"an issue-number citation in a changed file does not by itself make this gate red"** — either wire a real issue lookup (the file's own comment names this as a future story) or classify unverifiable local issue citations as a distinct non-failing verdict. Until one of those lands, this gate cannot pass on any diff that cites an issue number, which is nearly every diff this project makes.

---

# UNPROVEN — named, non-blocking, converted to tests

## 3. [SUSPICION][LOW][demonstrated] Part D's layer domain and flag-combination count are still hand-typed and do not grow with `TRUST_RANK`

Part D (`src/policy/rule/mandatory-lock-conformance.test.ts:179-195`) builds a literal three-layer array and iterates 8 flag combinations (2 to the 3rd). Under mutation B1 below — a 4th layer added to `LayerName`, `TRUST_RANK` **and** `PRECEDENCE_ORDER` — Part D stayed green while testing 3 of the 4 layers and 8 of the 16 combinations of a 4-way collision.

I am grading this LOW and UNPROVEN deliberately, because the file-level promise now holds and the narrow residual does not overturn it:
- Part D's test **name** honestly scopes itself ("across all 8 mandatory-flag combinations of a single id declared in **all three layers**"), so it makes no false completeness claim — CLAUDE.md's hand-derived-completeness rule is not violated here.
- The dangerous arrangement is caught elsewhere: mutation B2 (a rank-2 layer walked above central) turns Part B's ground truth red, so the file does not stay silently green when a new tier can void central. Demonstrated below.
- The uncovered cell is specifically a 4-or-more-way simultaneous collision. I could not construct a case where missing it hides a real defect.

**Named test:** `src/policy/rule/mandatory-lock-conformance.test.ts` -> **"Part D's layer set and flag-combination count are derived from TRUST_RANK — 2 to the power of the TRUST_RANK key count, over PRECEDENCE_ORDER, never a literal 8 over three literal names"**.

## 4. [SUSPICION][LOW][code-traced] The `-1` sentinel backstop landed as two fixtures, not as a property or a code guard

Round 3's second named proof-test was "line=-1 is never printed for a layer that loaded successfully" — a general backstop, independent of which fix was chosen. What shipped is two document-specific cases (`src/policy/config/loader.test.ts`, the plain-ASCII-key and escaped-key backstops). `src/policy/config/loader.ts:111` is unchanged: it still maps each rule index through a nullish fallback to a `-1` sentinel.

There is still no assertion anywhere that the position count equals the rule count, and nothing downstream treats `-1` specially. The guarantee now rests entirely on the two views sharing one decoder — which is the right fix, and strictly better than the reject-on-disagreement alternative I also named.

**I could not break it.** Twelve constructed divergence shapes (BOM, non-array rules, rule elements that are strings/arrays/null, nested objects inside a rule, empty array, escaped key with CRLF and with tabs, escaped key plus a nested rules decoy, a surrogate-pair key, a key with an escaped quote) plus 336 fuzz documents produced **0** reachable sentinels. So: UNPROVEN, LOW, not a demonstrated break.

**Named test:** `src/policy/config/loader.test.ts` -> **"parseLayerText asserts that findRulePositions returns exactly one position per validated rule, for every successfully-validated layer"** — a property over the two views, not two more fixtures.

---

# What held up (SURVIVES — re-attacked with my own round-3 repros, and defended)

- **C1 [demonstrated] Issue #118 is CLOSED — the exact round-3 mutation that stayed 12/12 green now fails.** I added `enterprise` (rank 2) to `LayerName` and `TRUST_RANK`, exactly as in round 3, leaving `PRECEDENCE_ORDER` untouched:
  ```
  MUTATION APPLIED: 4th layer "enterprise" (rank 2) added to LayerName + TRUST_RANK;
                    PRECEDENCE_ORDER left untouched at 3 names
  $ npm run typecheck                                          exit 0
  $ node --test src/policy/rule/mandatory-lock-conformance.test.ts
  tests 12   pass 11   fail 1   skipped 0
  FAIL mandatory-lock conformance (self-check): PRECEDENCE_ORDER's domain equals TRUST_RANK's own key set...
    AssertionError: PRECEDENCE_ORDER must enumerate EXACTLY the layers TRUST_RANK knows about
    + actual - expected
    + Set(3) {            - Set(4) {
        'central',            'central',
                          -   'enterprise',
        'project',            'project',
        'shipped-defaults'    'shipped-defaults'
  ```
  Round 3: 12 pass / 0 fail on this identical mutation. The failure message names the missing layer by name rather than reporting a bare length mismatch, so the next engineer is told what to do. SURVIVES.

- **C2 [demonstrated] The #118 fix is not over-tight — a legitimate 4th layer passes, and the matrix genuinely expands.** Mutation B1, the conscientious-developer case: `enterprise` added to `TRUST_RANK` **and** appended to `PRECEDENCE_ORDER`:
  ```
  tests 16   pass 16   fail 0   skipped 0
  Part A now derives 6 forward pairs (was 3), including three new enterprise cells:
    shipped-defaults declares, enterprise redefines -> NOT voided (rank 0 <= rank 2)
    central declares,          enterprise redefines -> NOT voided (rank 1 <= rank 2)
    project declares,          enterprise redefines -> NOT voided (rank 0 <= rank 2)
  Part C gained a 4th same-layer-duplicate case for enterprise.
  ```
  The forward-pair count for 4 layers is 6, satisfied. No false alarm, and the new cells are real cells, not padding. SURVIVES.

- **C3 [demonstrated] The #118 fix catches the direction that actually matters — a new tier outranking central.** Mutation B2: `enterprise` (rank 2) inserted **above** central in walk order.
  ```
  tests 16   pass 15   fail 1   skipped 0
  ok  5 - Part A (derived): enterprise declares mandatory, central attempts to redefine -> VOIDED (rank 2 > rank 1)
  ok  6 - Part A (derived): enterprise declares mandatory, project attempts to redefine -> VOIDED (rank 2 > rank 0)
  not ok 11 - Part B (ground truth): central can NEVER appear in voidedLayers, for ANY forward pair
  ```
  This is the whole point of the two-layer design and it now works across a layer-set change: Part A moves with the table and accepts the new voiding, Part B refuses to and goes red, forcing a human to reconcile "central is un-voidable" against a tier that legitimately outranks it. In round 3 this exact scenario was invisible. SURVIVES.

- **C4 [demonstrated] Issue #119 is CLOSED against my own round-3 repro, byte for byte.** Same probe, backslash built at runtime (`String.fromCharCode(92)`) so no shell or JS layer could quietly resolve it:
  ```
  contains a real backslash-u escape in a top-level key? true
  JSON.parse keys                   = ["version","rules"]
  findTopLevelKeys(raw)             = ["version","rules"]
  findDuplicateTopLevelKeys         = []
  validateRuleSet errors            = []
  position-parser findRulePositions = [{"line":4,"column":5},{"line":5,"column":5}]
  --- printer ---
  central-channel status=absent
  --- resolved rules (2) ---
  rule id=a-first  effect=allow layer=project origin=...project.json line=4 mandatory=false
  rule id=b-second effect=deny  layer=project origin=...project.json line=5 mandatory=false
  exitCode=0
  ```
  Round 3's identical input produced an empty `findRulePositions` and `line=-1` for both rules. Lines 4 and 5 are correct — hand-checked against the raw bytes (line 1 opening brace, line 2 version, line 3 the escaped rules key, lines 4-5 the two rule objects). SURVIVES.

- **C5 [demonstrated] The #119 fix is precise, not a blocklist and not lossy — eleven key spellings, all correct.**
  ```
  OK | literal rules                       decoded="rules"  positions=[3,3]  expect match
  OK | u0072ules (first char escaped)      decoded="rules"  positions=[3,3]  expect match
  OK | fully escaped every char            decoded="rules"  positions=[3,3]  expect match
  OK | mixed-case hex u006C in middle      decoded="rules"  positions=[3,3]  expect match
  OK | lowercase hex digits u006c          decoded="rules"  positions=[3,3]  expect match
  OK | u0052ules (capital R)               decoded="Rules"  positions=[]     expect NO match
  OK | near-miss: rules + escaped space    decoded="rules " positions=[]     expect NO match
  OK | near-miss: escaped space + rules    decoded=" rules" positions=[]     expect NO match
  OK | near-miss: Rules (capital R)        decoded="Rules"  positions=[]     expect NO match
  OK | decoy: rulesX                       decoded="rulesX" positions=[]     expect NO match
  OK | escaped solidus noise               decoded="rules"  positions=[3,3]  expect match
  ```
  Multiple independent spellings normalize to the same key (so this is not a one-escape-shape patch), and every near-miss correctly stays a non-match (so the unescape is precise rather than over-eager). SURVIVES.

- **C6 [demonstrated] The #119 fix creates no false positives — the escaped spelling does not leak past the depth check or into string values.**
  ```
  B. nested escaped rules decoy + a real top-level rules key:
     positions = [{"line":4,"column":14}]   -> only the real top-level one
  C. a rule's rationale VALUE containing the literal text of an escaped rules array:
     JSON.parse ok? true    positions = [3]  -> exactly the one real rule
  ```
  The depth-1 guard and the token boundaries still do their jobs; the change is confined to key identity. SURVIVES.

- **C7 [demonstrated] No regression on valid input — 336-document differential fuzz, zero misalignments, zero false rejections.** 14 adversarial rationale payloads (escaped quotes, braces and brackets, escaped newlines, double backslashes, unicode escapes, an embedded escaped-rules-array decoy string, astral emoji, CJK, empty string, punctuation soup, tabs, an accented escape, escaped solidus, a trailing quote) times 3 indent styles times LF/CRLF times 1-4 rules:
  ```
  differential fuzz: 336 documents; schema rejections=0; position-count misalignments=0
  ```
  The same shape as round 3's fuzz, re-run against the changed decoder path. SURVIVES.

- **C8 [demonstrated] The `-1` sentinel is not reachable through any input I could construct.** Twelve targeted divergence shapes, each checked for "schema ACCEPTS **and** fewer positions than rules":
  ```
  PARSE-ERR | BOM at file start              (rejected by JSON.parse -- fail-closed)
  ok        | rules value is an object       schemaErrs=1  [rules is required and must be an array]
  ok        | rule element is a string       schemaErrs=1  [rule must be an object]
  ok        | rule element is an array       schemaErrs=1  [rule must be an object]
  ok        | rule element is null           schemaErrs=1  [rule must be an object]
  ok        | nested obj inside a rule       schemaErrs=1  rules=1 positions=1
  ok        | rules array empty              schemaErrs=0  rules=0 positions=0
  ok        | escaped key + CRLF             schemaErrs=0  rules=1 positions=1
  ok        | escaped key + tabs             schemaErrs=0  rules=1 positions=1
  ok        | escaped key + nested rules     schemaErrs=1  rules=1 positions=1
  ok        | surrogate pair in a key        schemaErrs=1  rules=1 positions=1
  ok        | key with escaped quote         schemaErrs=1  rules=1 positions=1

  -1 sentinel reachable in 0 of 12 probed shapes
  ```
  Every shape either parses and aligns, or is rejected by name with a real message. Combined with C7's 336 documents and C5's eleven spellings: no reachable sentinel. Finding 4 records the residual honestly (no *property* guarantees this), but there is nothing to demonstrate. SURVIVES.

- **C9 [demonstrated] The new config-to-rule import creates no cycle and violates no layering ADR, and every other structural gate is green.** `src/policy/rule/schema.ts`'s only import is `../kernel/rule-types.ts` (type-only), so `position-parser.ts -> schema.ts` cannot close a cycle. The direction matches what `src/policy/config/loader.ts` already does. Eleven `qa:*` gates run individually:
  ```
  qa:kernel-purity                exit 0  PASS: 4 production .ts files under src/policy/kernel/, zero violations
  qa:normalizer-registry-purity   exit 0  PASS
  qa:gate-command-path            exit 0  PASS: 2 command-type hook entries, every script resolves
  qa:gate-matcher-drift           exit 0  PASS: 19 referenced tool names all present in the vendored snapshot
  qa:gate-manifest                exit 0  PASS: exactly 1 gate manifest
  qa:gate-latency-budget          exit 0  PASS: p99 184.72ms under the 2000ms budget
  qa:broken-instrument-gate       exit 0  VACUOUS-PASS (disclosed)
  qa:recurring-findings           exit 0  PASS: 1 recurring finding class, structurally valid
  qa:fixture-coverage             exit 0  VACUOUS-PASS (disclosed)
  qa:fixture-isolation            exit 0  VACUOUS-PASS (disclosed)
  qa:runtime-settings-drift       exit 0  PASS: 18 vendored keys all match REQUIREMENTS.md section 1.4
  ```
  The three vacuous passes are disclosed by the instruments themselves, not by me on their behalf. SURVIVES.

- **C10 [demonstrated] Suite, types and lint are exactly where the commit message says.** 642 tests / 641 pass / 1 fail / **0 skipped** / 0 todo, up from round 3's 638/637/1 by precisely the 4 cases the diff adds. The single failure is `OSS-01 (dogfood)`, pre-existing at HEAD, Issue #113, unchanged across all four rounds and untouched by this diff. `npm run typecheck` and `npm run lint` both exit 0. SURVIVES.

- **C11 [demonstrated] `printer.test.ts` — test-writer's locked answer key — is still genuinely untouched, and still 9/9.**
  ```
  $ git diff --stat 280f1c7 602be5c -- src/policy/config/printer.test.ts
  (empty)
  $ node --test src/policy/config/printer.test.ts
  tests 9   pass 9   fail 0   skipped 0
  ```
  A real git diff across two commits, not a claim. Both #118 and #119 regression tests landed in story-implementer's own files (`src/policy/config/position-parser.test.ts`, `src/policy/config/loader.test.ts`, and the conformance file's self-check rewritten in place), which is the correct channel. SURVIVES.

- **C12 [demonstrated] My mutations left no residue in source.** After three applied-and-reverted mutations across `src/policy/rule/precedence.ts` and `src/policy/rule/mandatory-lock-conformance.test.ts`:
  ```
  $ git status --short
   M docs/REVIEW_LOG.md
  ?? docs/reviews/s6-policy-centralization-app-security-round2-2026-09-08.md
  ?? docs/reviews/s6-policy-centralization-cross-domain-round2-2026-09-08.md
  ```
  **Zero `src/` entries.** Stated precisely rather than as "clean": the tree carries two sibling reviewers' uncommitted round-2 reports and their REVIEW_LOG rows — expected mid-round state, theirs to commit, and the Manager's to fold in before merge-handoff (PRINCIPLES rule 10: a report that is not committed is not yet evidence). SURVIVES for the question I own.

---

# A note on what this round did NOT re-litigate

This was a narrow, assigned closing re-confirm. I did not re-run round 2's findings 3, 4 and 6 (pin scope, decisions-row Issue-number drift — Issue #116, the review-round counter — Issue #117), nor round 3's editorial items, nor Issues #107 / #110 / #111 / #112, all of which remain open on the Manager's ledger. Nothing I ran touched `src/policy/config/pin.ts` or `src/policy/rule/precedence.ts`'s shipped behavior, and the round-4 diff modifies neither. I am naming the omission rather than letting silence imply coverage (PRINCIPLES rule 13). Finding 1 is the one exception — I did not go looking for it; a #119 probe walked into it.

# The single scariest unproven assumption

**That "we fixed this in the sibling file too" is ever complete when it is verified by reading rather than by running.** This codebase's signature defect is now at six recurrences (Issues #65/#66, #99, #114, #115, #119) and every one of them is the same shape: a general-looking mechanism, correct in the place someone checked, wrong in the place nobody did. Round 4 found the seventh instance of the *shape* — not in the code the fix touched, but in my own round-2 Issue closure: #108 named two defects in one body, I verified one of them, and closed both. The #118 fix is the antidote and it is real — the conformance matrix now goes red on a layer nobody told it about, which is exactly the property that was missing. Nothing equivalent exists for *Issue closures*: no instrument checks that every clause of an Issue's body was exercised before someone closes it, and the two #119 regression tests are two fixtures rather than the property I asked for. The mechanism improved this round; the habit that produced the bug family has not been closed, and it will surface next in whatever gets verified by careful reading.

# Verdict

**go.** Issue #118 and Issue #119 are independently re-verified CLOSED against my own round-3 repros, using the same mutations and the same runtime-constructed escape, plus two mutations round 3 never ran. Both fixes are the stronger of the two options I named, both are precise rather than broad, and neither regressed anything: 642 tests / 641 pass / 1 fail (pre-existing Issue #113) / 0 skipped, typecheck and lint clean, eleven structural QA gates PASS, 336-document fuzz clean, `src/policy/config/printer.test.ts` untouched with a real empty git diff.

Two MED findings, neither gating and neither introduced by this diff: an operator-facing rejection prefix that misattributes a project-file fault to the central channel (the un-fixed half of Issue #108, which I closed early in round 2 — reopened, not duplicated), and two CI-gating steps red at HEAD without a tracking Issue. Two LOW suspicions, both UNPROVEN and both converted to named tests.

Open findings: 4. Named failing tests: 5 — finding 1 warrants two (the prefix test and the BOM trigger test, which are independently useful), which is the one place the counts legitimately differ, stated rather than reconciled away.

The fix work was good and it should be said next to the go: both fixes chose the shared-abstraction option over the local-patch option, the #118 self-check now fails with a message that tells the next engineer what to do rather than just that something is wrong, `src/policy/config/printer.test.ts` came through with a real empty diff for the second round running, and the implementer's own comments in `src/policy/config/position-parser.ts` name the bug family and the import direction explicitly instead of leaving them to be rediscovered.

# Single next action

Route finding 1 to `test-writer`: the rejection prefix is pinned by `src/policy/config/printer.test.ts:272`, so the answer key must be amended before the printer can stop blaming the central channel for a project-file fault. Issue #108 is reopened with the repro.

---

# Editorial (verdict-neutral, fix as plain edits, no re-review)

- Issue #114 is closed as completed but still carries the `blocked-on-owner` label. Drop the label.
- `src/policy/rule/mandatory-lock-conformance.test.ts:70-82`'s new comment block is 13 lines of history for a 12-line test. Accurate, and longer than the thing it explains; the round-3 narrative belongs in `docs/decisions.md`, which already carries it verbatim.
- The round-4 `CHANGELOG.md` entry's Verification line drops `qa:completeness-claims` and `qa:reference-resolver`, which rounds 1-3 all named explicitly. Restore the line (finding 2).
- `src/policy/config/loader.ts:111`'s sentinel fallback deserves a one-line comment saying which invariant makes it unreachable, now that one exists.
- Carried unchanged from round 3, still true: `src/policy/rule/precedence.ts:148-153`'s "was never real force to begin with" is inaccurate as history; `src/policy/config/print-cli.ts:39` hardcodes "only the central layer's mandatory declarations are authoritative" while the predicate behind it derives from `TRUST_RANK`; `src/policy/rule/precedence.ts:186-192`'s post-S6 disposition note is still prose-only where a deprecation tag would make tooling say it.
- Red-team's own citation style is a QA-14 input. A bare `foo.ts:123` does not resolve; a repo-relative `src/policy/config/foo.ts:123` does. Applied throughout this report.

---

```
RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] "REJECTED: central policy load failed" (src/policy/config/printer.ts:67) blames the central channel for a PROJECT-file fault on every rejection reason kind - demonstrated end-to-end with a UTF-8 BOM on .thoth/policy.json (a real PowerShell 5.1 / Notepad trigger on a Windows-only product): line 1 says central-channel status=absent, line 2 says central policy load failed, the broken file is the operator's own. This is the un-fixed half of Issue #108's own body verbatim ("printer.ts:40 then misattributes a project-file fault to the central channel"); the fix-now round repaired the voided-layer path only, and my round-2 comment closed #108 on that path alone - my miss, recorded not restated. REOPENED per Issue Discipline rule 2, not duplicated. Defense: fail-CLOSED (exit 1, exactly 2 lines, no rule data leaks - asserted at src/policy/config/printer.test.ts:276), the real path IS in the message body, no enforcement decision affected. Constraint: the prefix is pinned by test-writer's locked answer key (src/policy/config/printer.test.ts:272 regex, :84 contract), so the unlock is a test-writer amendment, not an implementer edit. NOT GATING: pre-existing, untouched by this diff, out of assigned scope, not security/data-integrity/legal/safety. Exposure: ~100% of load-rejection outputs whose failing layer is not central, basis counted-in-code (one string, one call site, all 3 reason kinds).
2. [ISSUE][MED][demonstrated] Two CI-gating steps red at HEAD with NO tracking Issue: qa:completeness-claims real exit=1 (4 of 4 decisions.md claims) and qa:reference-resolver real exit=1 (126 of 320 citations) - I ran the exact .github/workflows/ci.yml commands; only the third red step (OSS-01) is tracked (Issue #113). Per-file attribution generated by running the checker's own exported scanReferences over the diff, not hand-derived. Two causes: structural (issueExists is wired to always return null at src/qa/reference-resolver.ts:275, so ANY changed file citing an issue number makes the gate red - this diff adds 3 more) and mine (6 of 9 failures in my round-3 report are my own bare-filename citations; fixed in this report's style). Defense: loud, not silent - CI shows red and rounds 1-3 disclosed it explicitly in decisions.md/CHANGELOG; the round-4 entries OMIT that disclosure (an omission, not a false claim - nobody wrote anything untrue). NOT GATING: pre-existing in kind, loud, unrelated to either fix. Exposure: 100% of CI runs on this branch, basis demonstrated (real exit codes captured).
3. [SUSPICION][LOW][demonstrated] Part D (src/policy/rule/mandatory-lock-conformance.test.ts:179-195) still hand-types its 3-layer array and its 8 flag combinations, so under mutation B1 (a legitimate 4th layer) it stayed green while testing 3 of 4 layers and 8 of 16 combinations. Graded LOW/UNPROVEN deliberately: its test NAME honestly scopes itself to "all three layers" (no false completeness claim), and the dangerous arrangement IS caught elsewhere - mutation B2 turns Part B's ground truth red. The uncovered cell is a 4-or-more-way simultaneous collision; I could not construct a case where missing it hides a real defect. Named test: derive Part D's layer set and combination count from TRUST_RANK.
4. [SUSPICION][LOW][code-traced] Round 3's second named proof-test ("line=-1 is never printed for a layer that loaded successfully") shipped as two document-specific fixtures in src/policy/config/loader.test.ts rather than a property; src/policy/config/loader.ts:111 still maps each rule index through a nullish fallback to -1, with no assertion that the position count equals the rule count and nothing downstream handling -1. The guarantee rests entirely on the two views now sharing one decoder - which is the right fix and better than the reject-on-disagreement alternative I also named. I could NOT break it: 12 constructed divergence shapes + 336 fuzz documents + 11 key spellings gave 0 reachable sentinels. UNPROVEN, not a demonstrated break. Named test: assert the count equality as a property in parseLayerText.
5. [CLEAN][demonstrated] Issue #118 CLOSED - the exact round-3 mutation (4th layer "enterprise" rank 2 added to LayerName+TRUST_RANK, PRECEDENCE_ORDER untouched) that stayed 12 pass / 0 fail last round now fails 1 of 12, typecheck still exit 0, and the AssertionError names the missing layer by name (Set(3) vs Set(4) with 'enterprise' diffed) rather than reporting a bare length mismatch.
6. [CLEAN][demonstrated] The #118 fix is not over-tight: mutation B1 (enterprise added to TRUST_RANK AND appended to PRECEDENCE_ORDER) passes 16/16, the matrix genuinely expands from 3 to 6 forward pairs with three real new enterprise cells, Part C gains a 4th same-layer case, and the derived n(n-1)/2 count for 4 layers is satisfied - no false alarm on a legitimate layer addition.
7. [CLEAN][demonstrated] The #118 fix catches the direction that matters: mutation B2 (enterprise rank 2 inserted ABOVE central in walk order) fails 1 of 16 - Part A derives "enterprise declares, central redefines -> VOIDED (rank 2 > rank 1)" and accepts it, while Part B's ground truth "central can NEVER appear in voidedLayers for ANY forward pair" goes RED, forcing a human to reconcile the invariant against a tier that legitimately outranks central. In round 3 this scenario was invisible.
8. [CLEAN][demonstrated] Issue #119 CLOSED against my own round-3 repro byte for byte, backslash built at runtime via String.fromCharCode(92): findRulePositions now returns line 4 and line 5 where round 3 returned an empty array, and the real printer prints line=4 / line=5 (hand-checked against the raw bytes) where round 3 printed line=-1 for both rules at exit 0.
9. [CLEAN][demonstrated] The #119 fix is precise, not a blocklist and not lossy - 11 top-level key spellings all correct: literal, first-char-escaped, fully-escaped-every-char, mixed-case hex, and escaped-solidus-noise all MATCH (multiple independent spellings normalize, so it is not a one-shape patch); capital-R escape, rules-plus-escaped-space, escaped-space-plus-rules, capital Rules, and rulesX all correctly do NOT match (the unescape is precise, not over-eager).
10. [CLEAN][demonstrated] The #119 fix creates no false positives: a nested escaped rules decoy alongside a real top-level rules key yields only the real one (line 4), and a rule's rationale VALUE containing the literal text of an escaped rules array yields exactly [3] - the depth-1 guard and token boundaries still hold; the change is confined to key identity.
11. [CLEAN][demonstrated] No regression on valid input: 336-document differential fuzz (14 adversarial rationale payloads incl. an embedded escaped-rules-array decoy, astral emoji, CJK, double backslashes, escaped newlines, tabs, escaped solidus, times 3 indents, times LF/CRLF, times 1-4 rules) - 0 schema rejections, 0 position-count misalignments.
12. [CLEAN][demonstrated] The -1 sentinel is unreachable across every divergence shape I could construct: 12 targeted probes (BOM, non-array rules, rule elements that are string/array/null, nested object in a rule, empty array, escaped key with CRLF and tabs, escaped key plus nested rules decoy, surrogate-pair key, escaped-quote key) each either parse-and-align or are rejected BY NAME with a real message - 0 of 12 reachable.
13. [CLEAN][demonstrated] The new config-to-rule import creates no cycle and no layering violation: src/policy/rule/schema.ts's only import is a type-only ../kernel/rule-types.ts, matching the direction src/policy/config/loader.ts already uses. All 11 structural gates green: qa:kernel-purity (4 kernel files, zero violations), normalizer-registry-purity, gate-command-path (2 entries resolve), gate-matcher-drift (19 tool names), gate-manifest (exactly 1), gate-latency-budget (p99 184.72ms under 2000ms), recurring-findings, runtime-settings-drift (18 keys), plus 3 self-disclosed VACUOUS-PASSes.
14. [CLEAN][demonstrated] Suite, types and lint match the commit message exactly: 642 tests / 641 pass / 1 fail / 0 skipped / 0 todo, up from round 3's 638/637/1 by precisely the 4 cases the diff adds; the single failure is the pre-existing OSS-01 dogfood case (Issue #113), unchanged across all four rounds; typecheck and lint both exit 0.
15. [CLEAN][demonstrated] src/policy/config/printer.test.ts (test-writer's locked answer key) is still genuinely untouched - git diff --stat 280f1c7 602be5c is empty, a real two-commit diff and not a claim - and still 9 pass / 0 fail / 0 skipped. Both #118 and #119 regression tests landed in story-implementer's own files instead.
16. [CLEAN][demonstrated] My three applied-and-reverted mutations left ZERO src/ entries in git status --short; stated precisely rather than as "clean" because the tree does carry two sibling reviewers' uncommitted round-2 reports plus their REVIEW_LOG rows - expected mid-round state, theirs to commit, and evidence only once committed (PRINCIPLES rule 10).
counts (CHECKSUM): issues=2 suspicions=2 clean=12
evidence (CHECKSUM): demonstrated=15 code-traced=1 derived=0
checks=642 tests / 641 pass / 1 fail / 0 skipped / 0 todo (full suite; the 1 fail pre-existing at HEAD, Issue #113); 4 touched test files 65 pass / 0 fail / 0 skipped; printer.test.ts 9 pass / 0 fail / 0 skipped; typecheck exit 0; lint exit 0; 11 qa:* structural gates exit 0 (3 self-disclosed vacuous); qa:completeness-claims exit 1 and qa:reference-resolver exit 1 (finding 2, pre-existing); 3 source mutations applied and reverted (4th layer at 3 walk positions) -> 1/12 fail, 16/16 pass, 15/16 fail respectively; 11-spelling key matrix 0 mismatches; 336-document differential fuzz 0 rejections / 0 misalignments; 12-shape -1-sentinel probe 0 reachable; 2 decoy probes; per-file QA-14 citation attribution; BOM repro through the real printer
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-red-team-round4-2026-09-08.md
```
