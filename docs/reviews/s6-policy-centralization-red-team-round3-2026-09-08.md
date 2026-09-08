# Red Team (Sutekh) — S6 policy centralization, ROUND 3: re-confirm of the council-ratified Path B fix

**Date:** 2026-09-08 · **Scope:** commit `0ee4871` ("S6 Stage-3 round 3: council-ratified Path B fix for Issue #114 (HIGH), Issue #115 (MED), build task #1"), diffed against `280f1c7` — `src/policy/rule/{precedence,schema}.ts`, `src/policy/rule/mandatory-lock-conformance.test.ts` (new), `src/policy/config/{loader,printer,print-cli}.ts`
**HEAD:** `0ee4871` — the tree is committed this round (round-2 finding 5 resolved: `git status --short` is empty)
**Round 1:** `docs/reviews/s6-policy-centralization-red-team-2026-09-08.md` (no-go) · **Round 2:** `docs/reviews/s6-policy-centralization-red-team-round2-2026-09-08.md` (no-go, Issues #114 HIGH + #115 MED)
**Council:** `docs/reviews/s6-policy-centralization-{design-challenger-council-stopbrief,council-trust-model-architecture,council-impact-analyst}-2026-09-08.md` — Path B ratified
**Verdict: go** — both gating Issues independently re-verified closed against my own round-2 repros. Two NEW MED findings, both in the assurance layer rather than the enforcement path, both with named failing tests.
**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]

ADRs re-read from `adrCatalog.adrs` for this attack surface: SE ADR-0021 (kernel purity, POL-03 identical verdicts, "never silent allow"), SE ADR-0019 (self-protection / boundary placement), SE ADR-0006 (blast radius, no scope widening), SE ADR-0002/0003 (layering, injectable I/O).

**The headline, stated plainly:** the Path B fix is real. My round-2 HIGH exploit no longer reproduces — I ran it end to end through the real printer and the git-tracked layer cannot touch central. #115's exact repro now rejects at exit 1 with the key named. The conformance instrument is genuinely load-bearing for the three real layers (I mutation-tested it twice; it caught both mutations, including a reintroduction of the exact #114 exploit). What it does **not** hold is the forward-looking exhaustiveness its own header claims — I added a 4th layer and watched all 12 tests stay green while half the matrix went unexercised. And the parser-agreement invariant that closed #115 was applied to a scanner in `schema.ts` but not to `position-parser.ts`, which still does the same raw-text key comparison the bug family is made of. Neither gates. Both are named failing tests.

## What I actually ran

```
$ node --test --test-reporter=tap
# tests 638
# pass 637
# fail 1
# cancelled 0
# skipped 0
# todo 0
not ok - OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass
                          # pre-existing at HEAD, Issue #113, unchanged from rounds 1 and 2

$ npm run typecheck                    # clean, exit 0
$ npm run lint                         # clean, exit 0
$ node --test src/policy/rule/mandatory-lock-conformance.test.ts   # 12 pass / 0 fail / 0 skipped
$ node --test src/policy/config/printer.test.ts                    #  9 pass / 0 fail / 0 skipped
$ npm run policy:print                 # raw output in C5 below
```

Plus six purpose-built round-3 harnesses: a direct re-run of round 2's #114 exploit at the unit level, the same exploit end-to-end through the real `printEffectivePolicy`, a 216-case brute-force layer/mandatory-flag matrix checked against an independently written model, round 2's exact escaped-duplicate-key repro, a 336-document differential fuzz on the new agreement invariant, a 7-shape exotic-key probe, and **three source mutations applied to `precedence.ts` and reverted** (a 4th trust layer; the `>` to `>=` check relaxation; a corrupted `TRUST_RANK` value). Raw output inline. `git status --short` is empty after all of it.

---

# Findings, ranked by blast radius (exposure x irreversibility x silence)

## 1. [ISSUE][MED][demonstrated] The conformance matrix's enumeration domain is hand-typed, so a 4th layer leaves half the matrix unexercised — and the self-check test *confirms* the incomplete matrix as complete

**Attack.** `mandatory-lock-conformance.test.ts` is the council's GO condition 4 — the standing instrument meant to catch the NEXT instance of the "general-looking mechanism, wrong dimension" family (5 recurrences: #65/#66/#99/#114/#115). Its own header claims:

> "every layer-pair combination this function's trust-rank check can ever be asked to adjudicate is exercised here, mechanically enumerated from the SAME `TRUST_RANK` table the implementation uses (imported, never hand-copied) ... so a future 4th layer or a future trust-rank change cannot silently leave one cell unverified."

Part A imports `TRUST_RANK` for its **expectation values**. It does not derive its **enumeration domain** from it. That comes from a hand-typed constant at `mandatory-lock-conformance.test.ts:37`:

```ts
const PRECEDENCE_ORDER: readonly LayerName[] = ["shipped-defaults", "central", "project"];
```

A `readonly LayerName[]` is not exhaustiveness-checked. I added a 4th layer the way a future story would — to both `LayerName` and `TRUST_RANK`, ranked above central:

```
$ node -e "...add 'enterprise' to LayerName; add enterprise: 2 to TRUST_RANK..."
MUTATION APPLIED: added a 4th layer "enterprise" (rank 2) to LayerName + TRUST_RANK

$ npm run typecheck
> tsc --noEmit -p tsconfig.json          # exit 0 -- the Record<LayerName,number> compile-error
                                         # property precedence.ts claims IS real and IS satisfied

$ node --test --test-reporter=spec src/policy/rule/mandatory-lock-conformance.test.ts
OK  mandatory-lock conformance (self-check): the forward-pair enumeration covers exactly every {i,j}
    with i walked before j -- 3 pairs for 3 layers
OK  ... (Part A x3, Part B x4, Part C x3, Part D x1)
tests 12   pass 12   fail 0   skipped 0
```

12/12 green. 3 of 6 forward pairs covered. The `enterprise` layer is never constructed, never merged, never asserted on. The test whose *name* is "covers exactly every {i,j} with i walked before j" asserts `forwardPairs.length === 3` against a hardcoded three-name list (`:72-78`) — so the one guard against an incomplete matrix passes **because** the matrix is incomplete, and reports that as coverage.

The sharpest form: Part B's "central can NEVER appear in voidedLayers, for ANY forward pair" (`:127-135`) iterates the same `forwardPairs`. With a rank-2 layer present, central becomes voidable — the exact Issue #114 property — and that test silently narrows its own claim to the pairs it happens to know about, still green.

**Current defense, honestly assessed.** Genuinely strong for the three layers that exist today, and I want that on the record with equal weight. I mutation-tested it twice:

```
=== MUTATION 2: relax the trust check from > to >= (peer locks now fire) ===
tests 12   pass 10   fail 2
FAIL Part A: shipped-defaults declares mandatory, project attempts to redefine -> NOT voided
FAIL Part B (ground truth): shipped-defaults's mandatory declaration can NEVER void project -- peers

=== MUTATION 3: corrupt TRUST_RANK values (shipped-defaults: 2) -- reintroduces the #114 exploit ===
tests 12   pass 8   fail 4
FAIL Part B: shipped-defaults's mandatory declaration can NEVER void central -- the exact #114 direction
FAIL Part B: shipped-defaults's mandatory declaration can NEVER void project -- peers
FAIL Part B: central can NEVER appear in voidedLayers, for ANY forward pair
FAIL Part D: central is NEVER voided, across all 8 mandatory-flag combinations
```

The two-layer design (Part A moves with the table; Part B is independent ground truth) works exactly as its header describes — Part A stayed green under mutation 3 while Part B caught it four ways. That is a real instrument, not a pass-through. The defect is one axis: the domain it enumerates over.

**Why it matters beyond neatness.** CLAUDE.md's hard rule: *"Any claim of completeness/exhaustive enumeration is generated by a running instrument — never hand-typed or hand-derived in prose."* The claim here is generated by a hand-typed list. Today the set is 3 and trivially eyeballed, so the proportionality clause covers the present state; the claim the file makes is explicitly about the *future* state, and that half is false as shipped.

**Exposure:** 0% of runs today — this is a test file with no runtime effect, and all cells for the 3 real layers are covered and correct (basis: counted-in-code + demonstrated). 100% of future layer additions or trust-tier introductions, which the architecture council's own report names as a live evolution path ("if a macOS plist channel eventually ships ... Path B's trust-rank concept") (basis: counted-in-code). Irreversible: no. Silent: yes — green tests, with the guard asserting the wrong thing.

**Verdict: BREAKS** (assurance-instrument defect, no runtime exposure — does not gate).

**Proof-test required (one small edit, same file):**
- `mandatory-lock-conformance.test.ts` -> **"the pairwise matrix's enumeration domain equals TRUST_RANK's own key set, and the forward-pair count equals n(n-1)/2 for n = Object.keys(TRUST_RANK).length"** — replace the hardcoded `assert.equal(forwardPairs.length, 3)` and the three-name `deepEqual` with assertions derived from `TRUST_RANK`, and assert `new Set(PRECEDENCE_ORDER)` equals `new Set(Object.keys(TRUST_RANK))`. Adding a 4th layer must then turn this file red until the layer is placed in walk order.

---

## 2. [ISSUE][MED][demonstrated] The tokenizer/parser-agreement invariant was applied to `schema.ts`'s scanner but not to `position-parser.ts` — a single escaped `"rules"` key still silently destroys every origin line

**Attack.** #115's fix asserts that `schema.ts`'s own raw-text key scanner agrees with `JSON.parse`. Correct, and it closes the duplicate shape. But the module whose output actually feeds the origin line — `position-parser.ts` — still compares raw text (`position-parser.ts:195`):

```ts
if (prevColon?.type === ":" && prevKey?.type === "string" && unquoteSimple(prevKey.raw) === "rules")
```

`prevKey.raw` is deliberately un-unescaped (that decoupling is documented and correct for *position* tracking) — but it is then used for **key identity**, which is exactly the competing-notion-of-identity defect #115 was filed for, one file over. So a document with a *single* escaped top-level rules key — no duplicate at all, so the duplicate check never fires and the agreement invariant is satisfied because `schema.ts` unescapes correctly — passes every gate:

```
================ NEW: SINGLE escaped top-level rules key (no duplicate at all) ================
--- raw bytes on disk ---
{
  "version": "1.0.0",
  "rules": [
    { "id": "a-first", "effect": "allow", "verbs": ["get"], "targets": ["pod"] },
    { "id": "b-second", "effect": "deny", "verbs": ["exec"], "targets": ["prod"] }
  ]
}

contains a real backslash-u escape in a top-level key? true
JSON.parse keys           = ["version","rules"]
findTopLevelKeys(raw)     = ["version","rules"]        <-- schema scanner AGREES (unescapes)
findDuplicateTopLevelKeys = []
validateRuleSet errors    = []  <-- ACCEPTED
position-parser findRulePositions = []                 <-- the THIRD view disagrees

--- printer ---
central-channel status=absent
--- resolved rules (2) ---
rule id=a-first  effect=allow layer=project origin=.../project.json line=-1 mandatory=false
rule id=b-second effect=deny  layer=project origin=.../project.json line=-1 mandatory=false
exitCode=0
```

`findRulePositions` returns an empty array, `loader.ts:111` maps every rule to `positions[i]?.line ?? -1`, and POL-10's answer for the entire layer becomes `line=-1`, at exit 0. Control confirms the mechanism is the key comparison and nothing else: an escaped `"version"` key with a literal `rules` key prints `line=4` correctly.

**Current defense, honestly assessed.** Better than round 2's defect, and I will say so: this reports `-1`, an obviously-invalid sentinel, not a plausible-but-wrong line number. An operator is misled into "no answer" rather than into "the wrong answer". Nothing about the *decision* changes — every rule still resolves with the correct id, effect, layer and origin **file**. What is absent: any check that `findRulePositions`'s notion of the top-level rules key matches `JSON.parse`'s, and any handling of the `-1` sentinel anywhere downstream (`printer.ts` prints it verbatim).

REQUIREMENTS.md:434, POL-10 (P1): *"The resolved effective policy shall be printable with the origin file and line of every rule."* Acceptance: *"One command answers 'why is this blocked' without reading a script."* For such a document, it does not.

**And my own round-2 proof-test named the right invariant on the wrong module.** I wrote: *"loader.test.ts -> the tokenizer's top-level key set equals Object.keys(JSON.parse(text)), or the layer is rejected."* The implementer read "the tokenizer" as `schema.ts`'s new scanner. `position-parser.ts` is the tokenizer whose disagreement actually produces the defect. That ambiguity is mine; I am recording it rather than grading it as a miss.

**Exposure:** 0% of the three real policy documents shipped today — all use literal keys, verified (basis: measured — `shipped-defaults.json`, `.thoth/policy.json`, and the registry fixture set). 100% of any layer document whose rules key carries a unicode escape (basis: counted-in-code — one raw comparison, `position-parser.ts:195`). Frequency of such documents in practice: unknown; I am not pricing the finding on it. Irreversible: no. Silent: yes — exit 0, green, and the degraded field is the one POL-10 exists to provide.

**Verdict: BREAKS** (diagnostics-integrity, not enforcement — does not gate).

**Proof-tests required:**
- `loader.test.ts` -> **"a layer whose top-level rules key is written with a unicode escape either reports correct origin lines or is rejected — never resolves at exit 0 with line=-1"**. Minimal fix: unescape `prevKey.raw` through `schema.ts`'s existing `unescapeJsonStringLiteral` before the comparison (one call, no new notion of identity), **or** assert in `parseLayerText` that `findRulePositions(...).length === ruleSet.rules.length` and reject the layer otherwise.
- `printer.test.ts` -> **"line=-1 is never printed for a layer that loaded successfully"** — the sentinel backstop, independent of which fix is chosen.

---

# What held up (SURVIVES — re-attacked with my own round-2 repros, and defended)

- **C1 [demonstrated] Issue #114 is CLOSED at the unit level.** Round 2's exploit — a git-tracked `shipped-defaults` rule declaring `mandatory: true` on a central id — re-run directly against `mergeLayersWithMandatoryLock`:
  ```
  TRUST_RANK = {"shipped-defaults":0,"central":1,"project":0}

  === A1: ROUND-2 EXPLOIT REPRO -- shipped-defaults collides with TWO central mandatory ids ===
  voidedLayers      = [{"layer":"project","ruleId":"central-deny-secret-read"}]
  inertDeclarations = [{"layer":"shipped-defaults","ruleId":"central-deny-prod-exec"}]
  resolved          = central-deny-prod-exec=deny(central), shipped-allow-list=allow(shipped-defaults),
                      central-deny-secret-read=deny(central)
  central rules surviving in merge: 2 (round 2 exploit gave 0)
  central voided?  false
  project's relaxation of central-deny-secret-read landed?  false
  ```
  Both central mandatory denies survive as `deny`, sourced from `central`. The attacker's `allow` loses on ordinary POL-08 precedence. The compounding step — the one that made round 2 a HIGH — is gone: project's relaxation is now the thing that gets voided, which is the intended direction. The check is at `precedence.ts:261-264`, keyed on `TRUST_RANK[declaringLayer] > TRUST_RANK[layer.name]`, with no layer-name literal anywhere. SURVIVES.

- **C2 [demonstrated] Issue #114 is CLOSED end-to-end through the real printer, not just the unit.** Same attack through `printEffectivePolicy` with real files on disk and central present:
  ```
  ### ATTACK: git-tracked shipped-defaults.json declares mandatory on a CENTRAL id
  central-channel status=present channel=win32-registry:HKLM/SOFTWARE/Policies/Thoth
  VOIDED: layer "project" rejected in its entirety: rule id "central-deny-secret-read" redefines a
          mandatory rule from an earlier layer
  --- resolved rules (3) ---
  rule id=central-deny-prod-exec   effect=deny  layer=central          line=4  mandatory=true
  rule id=shipped-allow-list       effect=allow layer=shipped-defaults line=15 mandatory=false
  rule id=central-deny-secret-read effect=deny  layer=central          line=15 mandatory=true
  exitCode=0
  inertMandatoryDeclarations=[{"layer":"shipped-defaults","ruleId":"central-deny-prod-exec"}]
  ```
  Round 2's same input produced `voidedLayers = [{"layer":"central",...}]` and **0** central rules surviving. It now voids the offender instead, names the inert shipped-defaults claim, and central's two mandatory denies are both effective. Origin lines cross-checked by hand against the fixture. SURVIVES.

- **C3 [demonstrated] The sub-case the implementer resolved without an explicit council answer is genuinely enforced in code, not merely documented.** Does a `shipped-defaults` mandatory rule lock `project`?
  ```
  === A2: shipped-defaults mandatory vs project ===
  voidedLayers = []                                                  (peer lock does NOT fire)
  inert        = [{"layer":"shipped-defaults","ruleId":"shipped-deny-secrets"}]
  effective    = shipped-deny-secrets=allow(project)
  ```
  No. The single expression at `precedence.ts:263` uses `>`, not `>=`, and `hasLockingForce` (`:169-172`) independently reports the declaration inert. Both halves are code, not comment. This **is** a deliberate reversal of round 2's own C2 CLEAN (where the same input voided `project`), it is the amendment the architecture council explicitly required (`council-trust-model-architecture-2026-09-08.md:110`, on Path B leaving the shipped-defaults claim silently inert if un-amended), and it is disclosed rather than silent (C5). The mechanism is correct; I note only that `precedence.ts:148-153`'s phrasing — that shipped-defaults' claim on its peer "was never real force to begin with" — is inaccurate as history: round 2 demonstrated it **was** real force under the then-shipped code, and Path B removed it. Editorial, listed below. SURVIVES.

- **C4 [demonstrated] No peer-layer lock fires anywhere, and central is never voided — brute-forced, and checked against an independently written model.** All 27 ordered triples of layer names (repeats included, so a caller passing layers out of POL-08 order is covered) times all 8 mandatory-flag combinations, one shared colliding id:
  ```
  === A3: brute force ===
  brute force: 216 cases, central appeared in voidedLayers 0 times
  peer-lock firings observed: 0
  (0 mismatches against an independently written expectation model)
  ```
  I wrote the model from the trust-rank rule directly rather than reusing the implementation's expression. Zero divergences, zero central voidings across every arrangement. Combined with C1/C2, the "central can never be voided" claim in `precedence.ts:118-124` holds for the three layers that exist. SURVIVES.

- **C5 [demonstrated] The council's loud-disclosure condition is genuinely met, through the real shipped CLI — not a field nobody prints.** I temporarily wrote a `mandatory: true` rule into the real `.thoth/policy.json` and ran the actual command (file restored; `git status --short` empty afterwards):
  ```
  $ npm run policy:print
  central-channel status=absent
  --- resolved rules (1) ---
  rule id=project-claims-mandatory effect=allow layer=project origin=C:\playground\thoth\.thoth\policy.json line=4 mandatory=true
  pin: sha256:202a00da... channel=(absent) computedAt=2026-09-08T19:08:18.322Z
  NOTE: this reflects S6's own resolved policy (loadEffectivePolicy) -- it is not necessarily what
        hooks/pretooluse-kernel-gate.mjs enforces live today ...
  NOTE: rule id="project-claims-mandatory" (layer=project) declares mandatory:true but has no real
        locking force -- only the central layer's mandatory declarations are authoritative; this
        declaration is NOT silently dropped, it still resolves normally, but it does not protect anything.
  exit=0
  ```
  The inert declaration is named, its layer is named, and the message says plainly what protection does and does not exist. `hasLockingForce` derives it from `TRUST_RANK` rather than hardcoding a layer name, so the *predicate* tracks the table. Threaded `MandatoryLockResult` to `LoadSuccess` to `PrinterResult` to `print-cli.ts` via the same field-not-stdout pattern `pin` and `disclosure` already use, so `printer.ts`'s locked stdout string is untouched. SURVIVES.

- **C6 [demonstrated] Issue #115 is CLOSED against my own round-2 repro, byte for byte.** The exact escaped-duplicate-key fixture from round 2, with the backslash built at runtime so no shell or JS layer could quietly resolve it (the probe prints `contains a real backslash-u escape in a top-level key? true`):
  ```
  JSON.parse keys           = ["version","rules"]
  findTopLevelKeys(raw)     = ["version","rules","rules"]     <-- now unescaped, sees both
  findDuplicateTopLevelKeys = ["rules"]
  validateRuleSet errors    = duplicate top-level key "rules" - JSON.parse silently keeps only the
                              LAST occurrence; rejected outright rather than silently resolved

  ### printer
  REJECTED: central policy load failed (schema-invalid): .../project.json: rules: duplicate top-level
            key "rules" - ...
  exitCode=1
  ```
  Round 2's same input was accepted at exit 0 with `line=4` for a rule opening on line 7. The fix delegates unescaping to `JSON.parse` itself (`schema.ts:71-77`) rather than hand-rolling a third decoder, which is the right call. SURVIVES.

- **C7 [demonstrated] The new agreement invariant introduces no false rejections and no silent divergences on valid input.** 336-document differential fuzz (14 adversarial rationale payloads — escaped quotes, braces and brackets, escaped newlines, double backslashes, unicode escapes, an embedded rules-array decoy string, astral emoji, CJK, empty string, a raw punctuation soup — times 3 indent styles times LF/CRLF times 1-4 rules), each checked three ways:
  ```
  differential fuzz: 336 valid documents
    false rejections by the NEW agreement invariant / any schema error : 0
    scanner-vs-JSON.parse disagreements NOT caught by the invariant    : 0
    position-parser rule-count misalignment vs JSON.parse              : 0
  ```
  No availability regression from the new rejection path, and the third view stays index-aligned on every valid document I could build. SURVIVES.

- **C8 [demonstrated] Seven exotic top-level key shapes, all handled, no prototype pollution.**
  ```
  __proto__ top-level key                       -> unknown key "__proto__"   (prototype polluted? false)
  constructor key                               -> unknown key "constructor" (prototype polluted? false)
  escaped duplicate via TWO DIFFERENT spellings -> duplicate top-level key "rules"
  key with an escaped quote character           -> unknown key, quote decoded correctly
  near-miss key: rules plus an escaped space    -> unknown key "rules ", correctly NOT a duplicate
  duplicate "version" key                       -> duplicate top-level key "version"
  byte-identical duplicate "rules"              -> duplicate top-level key "rules"
  ```
  The two-different-spellings case matters: the fix is not a blocklist on one escape spelling — both normalize and collide. The near-miss correctly does **not** collide, so the unescape is precise rather than lossy. `Object.keys` on `JSON.parse`'s `__proto__` own data property is safe. SURVIVES.

- **C9 [demonstrated] `printer.test.ts` — test-writer's locked answer key — is genuinely untouched and still 9/9 green.**
  ```
  $ git diff --stat 280f1c7 0ee4871 -- src/policy/config/printer.test.ts
  (empty)

  $ node --test --test-reporter=spec src/policy/config/printer.test.ts
  tests 9   pass 9   fail 0   cancelled 0   skipped 0   todo 0
  ```
  This is now a real git diff, not a claim — the file was committed in `280f1c7` (the state my round-2 read was written against) and is byte-identical in `0ee4871`. The field-not-stdout threading for `inertMandatoryDeclarations` is what preserved it. The older, separate residual stands unchanged: the file was first committed at round 2, not at RED-CONFIRMED, so its RED-time bytes remain unrecoverable (round-2 finding 5's standing fix). SURVIVES for this round's question.

- **C10 [demonstrated] The conformance instrument is load-bearing, not a pass-through — proven by mutation, twice.** See finding 1's raw output: relaxing `>` to `>=` fails 2 tests including a ground-truth one; corrupting the shipped-defaults entry of `TRUST_RANK` to 2 (which literally reinstates the #114 exploit) fails 4, three of them the un-voidability assertions. Part A moved with the corrupted table exactly as its header predicts, and Part B caught what Part A could not — the two-layer design is doing real work. This is a genuine standing instrument for the three layers that exist; finding 1 is about the fourth. SURVIVES.

- **C11 [demonstrated] Suite, types and lint are where the commit message says.** 638 tests, 637 pass, 1 fail, **0 skipped**, 0 todo — up from round 2's 618/617/1. The single failure is `OSS-01 (dogfood)`, pre-existing at HEAD, Issue #113, unrelated to this diff and unchanged across all three rounds. `npm run typecheck` and `npm run lint` both exit 0. The 12 new conformance tests plus the round-3 additions to `precedence.test.ts`, `schema.test.ts` and `loader.test.ts` account for the +20 delta. SURVIVES.

- **C12 [demonstrated] The tree is committed — round-2 finding 5 is closed.** `git log --oneline -3` shows `280f1c7` (the S6 build plus round-2 state) and `0ee4871` (this fix), and `git status --short` is empty both before and after every mutation I applied and reverted. Round 3 had a real diff to read, which rounds 1 and 2 did not. SURVIVES.

- **C13 [code-traced] The shipped-defaults/project peer ranking is defensible for this repo as it exists.** I checked the one scenario that would break it — a distributed package where `shipped-defaults.json` ships inside the installed module and is *not* consumer-writable, which would make it strictly more trusted than the consumer's own `.thoth/policy.json` and the peer rank wrong. `package.json` is private, with no `files`, `bin` or `main` field: thoth is not published, so there is no install in which the two files have different writability. Both are git-tracked in one repo, both editable by any change under review, both rank 0. The council's reasoning holds on today's facts. Worth revisiting if publication is ever on the table — a `docs/backlog.md` note, not a finding. SURVIVES.

- **C14 [code-traced] Today's live blast radius of the peer demotion is zero, measured.** Both real in-repo layers are empty — `shipped-defaults.json` and `.thoth/policy.json` are each a version string plus an empty rules array — so no shipped mandatory declaration lost force in this change, and no inert NOTE prints on a real run. The reversal of round-2's C2 is a semantic change to a mechanism with no current content flowing through it. SURVIVES.

---

# A note on what this round did NOT re-litigate

Round 2's findings 3, 4, 6 and 7 (pin scope, decision-row Issue-number drift, `reviewRoundsSinceClean`, the "central policy load failed" prefix) were outside this re-confirm's scope and I did not re-run them. Nothing I ran this round touched `pin.ts` or `printer.ts`'s rejection prefix, and the round-3 diff does not modify either. Their status is the Manager's ledger, not mine, and I am naming the omission rather than letting silence imply they were checked (PRINCIPLES rule 13).

# The single scariest unproven assumption

**That the instrument built to catch the sixth recurrence would notice a layer it was never told about.** The whole point of `mandatory-lock-conformance.test.ts` — stated in its own header, and the council's GO condition 4 — is that the next "general-looking mechanism, wrong dimension" bug gets caught by a machine instead of by a reviewer one round later. Its trust *expectations* are derived from `TRUST_RANK`. Its *universe of cases* is a hand-typed list of three names sitting one screen above them. Add the macOS plist tier the architecture council's own evolution path names, rank it anywhere, and this file reports full coverage of a matrix it is half-exercising — including, specifically, the "central can never be voided" assertion that Issue #114 exists to protect. It is a five-line fix and it is the difference between an instrument and a memento.

# Verdict

**go.** Both gating Issues are independently re-verified closed against my own round-2 repros, at the unit level and end to end through the real CLI, plus a 216-case brute force and three source mutations. The Path B implementation is faithful to the council's ruling including the sub-case it had to resolve alone, and the loud-disclosure condition is genuinely met on stdout rather than parked in a field.

Two new MED findings, both demonstrated, neither in the enforcement path: one is a test file's enumeration domain, one is a P1 diagnostics field degrading to a `-1` sentinel on an input shape no real document uses today. Neither meets the bar to hold a ship, and per PRINCIPLES rule 19 each converts to a named failing test rather than a condition. Open findings: 2. Failing tests to be written: 3 — finding 2 warrants two (the fix-side test and the sentinel backstop), which is the one place the counts legitimately differ, and it is stated rather than reconciled away.

The fix work was good, and it deserves saying next to the go: the exploit I demonstrated is gone in the direction I demonstrated it and in every direction I could brute-force, the reversal of a previously-CLEAN assertion was disclosed rather than slipped in, the implementer resolved the unanswered sub-case with a reason instead of a guess, and `printer.test.ts` came through with a real, empty git diff.

# Single next action

Land finding 1's one-test fix — derive `PRECEDENCE_ORDER`'s completeness from `Object.keys(TRUST_RANK)` in `mandatory-lock-conformance.test.ts` so a 4th layer turns the file red — before this instrument is relied on by any future story that adds a trust tier.

---

# Editorial (verdict-neutral, fix as plain edits, no re-review)

- `precedence.ts:148-153` states shipped-defaults' claim on project "was never real force to begin with". Inaccurate as history: under `280f1c7` it *was* real force (round 2's C2 demonstrated it voiding the project layer); Path B removed it deliberately. The accurate sentence is that it was force under the pre-Path-B check, and is removed here because it was never *legitimate* force.
- `print-cli.ts:39` hardcodes the sentence "only the central layer's mandatory declarations are authoritative". The *predicate* (`hasLockingForce`) is derived from `TRUST_RANK`; this sentence is not, and would become false the moment a second trusted tier ships. Derive the layer name(s) from the table or drop the clause.
- `mandatory-lock-conformance.test.ts:70-71`'s comment — "exactly 3 forward-walk-order pairs exist for 3 layers (3 choose 2), so this matrix is genuinely exhaustive, not a guessed subset" — is the prose form of finding 1. It becomes true once the enumeration domain is derived.
- `precedence.ts:186-192`'s `mergeLayers` POST-S6 DISPOSITION note is still prose-only; a `@deprecated` tag would make the warning come from tooling. Carried unchanged from rounds 1 and 2.
- `precedence.ts:167-172`'s `hasLockingForce` is a global property of `TRUST_RANK`, not of the layers present in a given call — a call passing only the central layer reports its mandatory declaration as having locking force it cannot exercise there. Harmless (it under-reports inertness, never over-claims protection to an operator) and arguably the right semantics, but worth one clarifying word in the doc comment.

---

```
RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] mandatory-lock-conformance.test.ts derives its trust EXPECTATIONS from TRUST_RANK but its ENUMERATION DOMAIN from a hand-typed PRECEDENCE_ORDER (:37) - I added a 4th layer "enterprise" (rank 2) to LayerName+TRUST_RANK, typecheck stayed clean, and all 12 tests stayed green while covering 3 of 6 forward pairs; the self-check test whose name is "covers exactly every {i,j}" asserts a hardcoded length===3 and so CONFIRMS the incomplete matrix, and Part B's "central can NEVER be voided" silently narrows to the pairs it knows about even though a rank-2 layer makes central voidable. Contradicts the file's own header claim and CLAUDE.md's no-hand-derived-completeness rule. Defense: genuinely strong for today's 3 layers - two source mutations (> to >=, and TRUST_RANK shipped-defaults:2) were caught 2/12 and 4/12 respectively, Part B ground truth catching what Part A cannot. Exposure: ~0% of runs today (test file, all 3-layer cells correct), basis counted-in-code; 100% of future layer/trust-tier additions, an evolution path the architecture council itself names, basis counted-in-code.
2. [ISSUE][MED][demonstrated] The #115 agreement invariant was applied to schema.ts's scanner but NOT to position-parser.ts:195, which still does unquoteSimple(prevKey.raw)==="rules" - a SINGLE escaped top-level rules key (no duplicate, so the duplicate check never fires and the invariant is satisfied because schema.ts unescapes correctly) is ACCEPTED at exit 0 and findRulePositions returns [], so loader.ts:111 maps every rule to -1 and POL-10's origin line for the whole layer prints line=-1. Same bug family (a competing notion of key identity), third view of the document, recurrence #6. Defense: degrades to an obviously-invalid sentinel rather than a plausible-but-wrong line, and no decision/id/effect/layer/origin-file is affected; nothing downstream handles -1. My own round-2 proof-test said "the tokenizer" ambiguously and pointed at the wrong module - recorded, not graded as a miss. Exposure: ~0% of the 3 real policy documents (all literal keys), basis measured; 100% of any layer whose rules key carries a unicode escape, basis counted-in-code.
3. [CLEAN][demonstrated] Issue #114 CLOSED at the unit level: round 2's exact exploit (git-tracked shipped-defaults declaring mandatory:true on a central id) now leaves BOTH central mandatory denies effective and sourced from central (2 surviving vs round 2's 0), central voided=false, and project's relaxation is what gets voided instead - the intended direction.
4. [CLEAN][demonstrated] Issue #114 CLOSED end-to-end through the real printEffectivePolicy with central present: VOIDED names layer "project", exit 0, all three rules resolve with correct origin lines cross-checked by hand, and the inert shipped-defaults claim is reported - versus round 2's voidedLayers=[{"layer":"central"}] with zero central rules surviving.
5. [CLEAN][demonstrated] The sub-case the implementer resolved without a council answer IS enforced in code, not just documented: shipped-defaults mandatory vs project gives voidedLayers=[] and inert=[{shipped-defaults,...}]; the strictly-greater ">" at precedence.ts:263 and hasLockingForce at :169-172 are both real code. Deliberate reversal of round-2's own C2 CLEAN, and exactly the amendment the architecture council required at its report line 110.
6. [CLEAN][demonstrated] No peer-layer lock fires anywhere and central is never voided: 216-case brute force over all 27 ordered layer-name triples (repeats included, so out-of-POL-08-order callers are covered) x 8 mandatory-flag combos, checked against an independently written expectation model - 0 mismatches, 0 central voidings, 0 peer-lock firings.
7. [CLEAN][demonstrated] The council's loud-disclosure GO condition is genuinely met through the real shipped CLI, not parked in an unprinted field: npm run policy:print against a real .thoth/policy.json carrying mandatory:true emits a NOTE naming the rule id, the layer, and plainly what protection does and does not exist (file restored, git status clean after).
8. [CLEAN][demonstrated] Issue #115 CLOSED against my own round-2 repro byte for byte, with the backslash built at runtime so no shell/JS layer could resolve it: findTopLevelKeys now sees ["version","rules","rules"], validateRuleSet rejects by name, printer exit 1 - versus round 2's exit 0 with line=4 for a rule opening on line 7. Unescaping is delegated to JSON.parse itself rather than a third hand-rolled decoder.
9. [CLEAN][demonstrated] The new agreement invariant causes no false rejections and no silent divergences: 336-document differential fuzz (14 adversarial payloads incl. an embedded rules-array decoy string, astral emoji, CJK, double backslashes, escaped newlines x 3 indents x LF/CRLF x 1-4 rules) - 0 false rejections, 0 uncaught scanner-vs-JSON.parse disagreements, 0 position-parser misalignments.
10. [CLEAN][demonstrated] Seven exotic top-level key shapes all handled with no prototype pollution: __proto__ and constructor rejected as unknown keys, TWO DIFFERENT escape spellings of "rules" collide correctly (so the fix is not a one-spelling blocklist), a near-miss "rules"-plus-escaped-space correctly does NOT collide (the unescape is precise, not lossy), duplicate "version" caught.
11. [CLEAN][demonstrated] printer.test.ts (test-writer's locked answer key) is genuinely untouched - a real empty git diff between 280f1c7 and 0ee4871, not a claim - and still 9 pass / 0 fail / 0 skipped. The field-not-stdout threading for inertMandatoryDeclarations is what preserved it.
12. [CLEAN][demonstrated] The conformance instrument is load-bearing, not a pass-through, proven by two reverted source mutations: > to >= fails 2/12 incl. a ground-truth test; TRUST_RANK shipped-defaults:2 (literally reinstating the #114 exploit) fails 4/12 incl. all three un-voidability assertions, while Part A moved with the corrupted table exactly as its header predicts.
13. [CLEAN][demonstrated] Suite, types and lint match the commit message: 638 tests / 637 pass / 1 fail / 0 skipped / 0 todo (up from round 2's 618/617/1), the single failure being the pre-existing OSS-01 dogfood test (Issue #113), unrelated and unchanged across all three rounds; typecheck and lint both exit 0.
14. [CLEAN][demonstrated] Round-2 finding 5 is closed: the S6 tree is committed in two commits (280f1c7 build+round-2 state, 0ee4871 this fix), git status --short empty before and after every mutation I applied and reverted - round 3 had a real diff to read, which rounds 1 and 2 did not.
15. [CLEAN][code-traced] The shipped-defaults/project peer ranking is defensible on today's facts: the one scenario that would break it is a published package where shipped-defaults.json is not consumer-writable, and package.json is private with no files/bin/main - thoth is not published, both files are git-tracked in one repo, both editable by any change under review. Backlog note if publication is ever on the table.
16. [CLEAN][code-traced] Today's live blast radius of the peer demotion is zero, measured: both real in-repo layers carry an empty rules array, so no shipped mandatory declaration lost force and no inert NOTE prints on a real run.
counts (CHECKSUM): issues=2 suspicions=0 clean=14
evidence (CHECKSUM): demonstrated=14 code-traced=2 derived=0
checks=638 tests / 637 pass / 1 fail / 0 skipped / 0 todo (full suite; the 1 fail pre-existing at HEAD, Issue #113); mandatory-lock-conformance.test.ts 12 pass / 0 fail / 0 skipped; printer.test.ts 9 pass / 0 fail / 0 skipped; typecheck exit 0; lint exit 0; 216-case brute-force layer/flag matrix 0 mismatches; 336-document differential fuzz 0 false rejections / 0 silent disagreements; 7-shape exotic-key probe; 3 source mutations applied and reverted (4th trust layer, > to >=, corrupted TRUST_RANK), git status --short empty afterwards
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-red-team-round3-2026-09-08.md
```
