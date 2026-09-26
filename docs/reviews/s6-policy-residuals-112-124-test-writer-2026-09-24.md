# Test Writer (Khnum) — s6-policy-residuals-112-124, test-first pass (2026-09-24)

Branch `feat/s6-policy-centralization`, cut from `ae6b4f1`. Plan: `docs/plans/s6-policy-residuals-112-124-phase1-2026-09-24.md` (untracked, not committed by this pass).
Node measured: v24.15.0. CI's Node 22.18.0 is NOT measured.

ADR cache: `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] ... [CACHE=HIT]`. No applicable ADR standard is violated by these tests (SE ADR-0005: no test deleted or weakened; #124 strengthens one; SE ADR-0002: the tests keep the `rule/` to `config/` layering by placing the bootstrap fallback on the loader side).

## Discovery

| Layer | Found |
|---|---|
| UI | n/a (no UI flow; policy library and printer surface only) |
| API / library | `node:test` + `node:assert/strict`, run by `node --test` (`package.json` script `test`). No second framework introduced. |

## Commits (two, one per job, no other files)

| Job | Commit | Files |
|---|---|---|
| 1, #124 | `38a4fe2` test(policy): tighten rejection-message contract (Issue #124) | `src/policy/config/printer.test.ts` only |
| 2, #112 | `51bcefd` test(policy): defaultOutcome proof-tests, red at HEAD (Issue #112) | `src/policy/config/loader.test.ts`, `src/policy/rule/mandatory-lock-conformance.test.ts`, `src/policy/rule/schema.test.ts` |

`docs/run-log.jsonl` (modified before this pass) and the plan file (untracked) were left alone. This report is untracked as well.

---

## JOB 1 — Issue #124 (zero production diff; GREEN at HEAD by design, confirmed by mutation)

### What changed in `printer.test.ts`

- `buildExpectedRejectionStdout`'s 4th parameter changed from `messagePattern: RegExp` (every site passed `/./`) to a REQUIRED `bound: RejectionBound`, no default. The type is not a RegExp, so a wildcard cannot be passed either.
  - `{ kind: "raw-bytes-absent", raw }`: `!actual.includes(raw)` where `raw` is the trimmed offending policy text. Used at 5 sites: central json-parse-error and central schema-invalid (inline strings, `.trim()`), project-BOM minified, shipped-defaults malformed, project-BOM pretty (`readFileSync(fixture).trim()`).
  - `{ kind: "exact-message", message }`: the central read-error site (no file exists); the rejection tail must equal `REJECTED: central policy load failed (read-error): <thrown message>` exactly.
- New proof-test `ISSUE-123(b): a fail-closed rejection's stdout contains the status line and the REJECTED message and NOTHING ELSE -- ...` (name per red-team round 6, finding 2). It drives the same six sites from one table and names the failing site.
- Existing tests keep their intent; only the wildcard argument changed at each call. Header gained INTERPRETATION CHOICE 8 (dated) including the Node-version note.

### Completeness instruments (running, not hand-typed)

```
$ grep -c "buildExpectedRejectionStdout(.*\(rawBound\|fixtureBound\|kind: \"exact-message\"\)" src/policy/config/printer.test.ts
6
$ grep -c "buildExpectedRejectionStdout(.*/\./" src/policy/config/printer.test.ts
0
$ (temp-append a 3-arg call and a wildcard-RegExp call to the test file, run tsc, then restore)
src/policy/config/printer.test.ts(684,1): error TS2554: Expected 4 arguments, but got 3.
src/policy/config/printer.test.ts(685,66): error TS2345: Argument of type 'RegExp' is not assignable to parameter of type 'RejectionBound'.
```

A seventh call site that omits the bound, or passes `/./`, fails `npm run typecheck` (tests are in the tsconfig include). The file was restored (verified by `git status`).

### Baseline (after the amendment)

```
node --test src/policy/config/printer.test.ts     tests 13  pass 13  fail 0  skipped 0   (12 pre-existing + ISSUE-123(b))
six policy test files (pin, loader, printer, schema, precedence, conformance)
                                                  tests 112 pass 112 fail 0 skipped 0   (Node 24.15.0)
tsc --noEmit                                      clean
eslint printer.test.ts                            clean
```

Deviation from plan row A10: the plan expected the count to stay at 12 tests. It is 13 because the dispatch asked for a named `ISSUE-123(b)` proof-test in addition to the per-site bounds. All 13 pass.

### Mutation drills (each mutant applied, run, reverted; raw summaries saved from the drill script)

Amended suite, Node 24.15.0, `node --test src/policy/config/printer.test.ts`:

```
=== P2@loader:211 (project parse failure + raw project file appended to message)
  tests=13 pass=10 fail=3 skipped=0
  FAILED: ISSUE-108(a) ; ISSUE-108(c) ; ISSUE-123(b)
=== P2@loader:193 (shipped parse failure + raw shipped file)
  tests=13 pass=11 fail=2 skipped=0
  FAILED: ISSUE-108(b) ; ISSUE-123(b)
=== P2@loader:162 (central parse/schema failure + raw central text)
  tests=13 pass=10 fail=3 skipped=0
  FAILED: AC5b (json-parse-error) ; AC5b (schema-invalid) ; ISSUE-123(b)
=== P2@loader:146 (central read-error + appended diagnostic)
  tests=13 pass=11 fail=2 skipped=0
  FAILED: AC5c ; ISSUE-123(b)
=== P1 (printer.ts re-hardcodes "central")
  tests=13 pass=10 fail=3 skipped=0
  FAILED: ISSUE-108(a) ; ISSUE-108(b) ; ISSUE-108(c)
```

Control, the pre-amendment test file from `HEAD` run against the same P2 mutants (proves the amendment is what closes the gap):

```
P2@loader:211  tests=12 pass=12 fail=0   <-- SURVIVES at HEAD
P2@loader:193  tests=12 pass=12 fail=0   <-- SURVIVES
P2@loader:162  tests=12 pass=12 fail=0   <-- SURVIVES
P2@loader:146  tests=12 pass=12 fail=0   <-- SURVIVES
P1             tests=12 pass=9  fail=3   ISSUE-108(a)(b)(c)
```

Every return site the plan named (211, 193, 162, 146) goes red under its own mutant with the amendment, and survives without it. P1 still fails ISSUE-108(a)(b)(c), 3 of 3 as round 6 measured. After every drill `git diff --stat -- src/policy/config/loader.ts src/policy/config/printer.ts` was empty, and `git status` showed only the test file (and the two pre-existing items).

### Node 22.18 caveat

The raw-bytes form assumes V8's `JSON.parse` error snippet does not echo a whole source of this length. The five sources are 62 to 597 bytes; V8 shows the whole source only for very short inputs and a truncated context otherwise (reasoning from V8's behavior, NOT a measurement on 22.18). No site was switched to the terminator-regex form because nothing false-failed on the measured version. If a site false-fails on CI's Node 22.18, replace that ONE site's bound with red-team's terminator form; the header note says so.

### Gates run for job 1

`npm run qa:reference-resolver` exit 0, `qa:completeness-claims` exit 0, `oss:secret-scan` exit 0, the commit's pre-commit scan PASS (full history, 0 blocking matches).

Confirmation in place of RED-CONFIRMED: GREEN-AT-HEAD + MUTANT-RED at every site (above).

---

## JOB 2 — Issue #112 proof-tests B1 to B15 (RED at HEAD for the right reason)

Interface the tests specify (does not exist at HEAD):
`RuleSet.defaultOutcome?`, `NamedRuleLayer.defaultOutcome?`, `MandatoryLockResult.defaultOutcome?: { outcome; source: LayerName }`, `LoadSuccess.defaultOutcome: { outcome; source: "shipped-defaults" | "central" | "project" | "bootstrap" }`.

Rulings encoded: D1 (no `defaultOutcomeMandatory` key; central locked implicitly by trust rank; red-team's test name kept verbatim as the umbrella), D2 (lower-trust layer may only tighten allow to deny; peers override each other, asserted), D3 (exposed only on `LoadSuccess`; bootstrap "allow" applied by the loader; voided layers contribute nothing; central absent means no central posture).

### Tests added (39 at runtime: 27 declared + 12 generated by the B6 matrix)

| Id | File | Tests | State at HEAD |
|---|---|---|---|
| B1 | schema.test.ts | allow/deny accepted | RED (unknown key) |
| B2 | schema.test.ts | non-enum values rejected by name, `expected` is the enum, message is not "unknown key" | RED |
| B3 | schema.test.ts | absent key still validates | green by construction |
| B4 | schema.test.ts | duplicate top-level key, literal and `\u`-escaped, rejected with rawText | green by construction (generic duplicate scan) |
| B5 | schema.test.ts | per-rule `defaultOutcome` is an unknown key | green by construction |
| B5b (derived, D1) | schema.test.ts | `defaultOutcomeMandatory` is an unknown key | green by construction |
| B5c (derived) | schema.test.ts | unknown-key `expected` lists `version, rules, defaultOutcome` (also fixes the order; the existing `/version, rules/` test stays valid) | RED |
| B6 | conformance (Part E) | matrix: every forward layer pair x every (declared, declared) outcome pair, enumerated from `TRUST_RANK`; plus an enumeration self-check whose count is derived | 12 cells RED; self-check green |
| B7 | conformance (Part F) | 8 hand-written ground-truth tests (relax ignored, tighten, redundant, shipped to central, peers override, none declared, single declarer x layers x outcomes, three-layer chains) | 7 RED; "none declared" green by construction |
| B8 | conformance (Part F) x3, loader x1 | voided layer contributes nothing; control without collision | RED except "voided alone gives undefined" (green by construction; its control is RED) |
| B9 | loader.test.ts | red-team's name verbatim; (i) each tier may declare, (ii) later layer overrides, (iii) central cannot be relaxed by project | RED |
| B10 | loader.test.ts | none declared gives `{allow, bootstrap}`, equal to `BOOTSTRAP_DEFAULT_OUTCOME` | RED (field missing) |
| B11 | loader.test.ts | central absent/unsupported + project deny gives deny/project | RED |
| B12 | loader.test.ts | central deny + project allow gives deny/central, ok, project rules still merge, nothing voided | RED |
| B13 | loader.test.ts | invalid value in each of three layers rejects the whole load (schema-invalid, layer named, not an unknown-key message) | RED |
| B14 | loader.test.ts | pin digests differ when only project `defaultOutcome` differs | RED at HEAD (both documents are rejected as unknown key) |
| B15 | loader.test.ts | success shape `{outcome, source}` exactly, across central absent/unsupported/present | RED |

Mapping instrument (grep-counted, not hand-typed): `grep -h -o -E "^// B[0-9]+ \(Issue #112\)" <3 files> | grep -o "B[0-9]*" | sort -u | wc -l` gives 15 distinct ids (B1 to B15); B6 tags also appear inside the generated test names.

### Raw red run (Node 24.15.0)

```
six policy test files (pin, loader, printer, schema, precedence, conformance)
  tests 151  pass 119  fail 32  skipped 0
    pre-existing tests: 112, all still pass (151 total minus 39 new)
    new tests: 39 = 32 red + 7 green-at-HEAD by construction
    the 32 red = 3 schema + 21 conformance + 8 loader

full suite (node --test)
  tests 1130  pass 1097  fail 33  skipped 0
    32 = the new red tests above
    1  = pre-existing, unrelated, environmental: src/qa/gate-manifest-check.test.ts
        "findHooksManifests: this repo's real .claude/settings.json is found as the (only) real manifest"
        fails in isolation too, because stale agent worktrees under .claude/worktrees/ each carry a
        .claude/settings.json (actual: 5 manifests, expected: 1). Not caused by this pass.
```

Reasons the red tests fail (sampled from the runner): loader tests report `defaultOutcome: unknown key ...` (schema rejects the key), or `defaultOutcome must be an object; got undefined` (field missing); conformance tests report `actual: undefined` against the expected `{outcome, source}`. Feature missing, not a typo.

Typecheck and lint at HEAD are also red, for the same single cause and no other:
```
tsc --noEmit: every error is TS2339/TS2353 "'defaultOutcome' does not exist on type 'LoadSuccess' / 'MandatoryLockResult' / 'NamedRuleLayer'" (0 errors that do not mention defaultOutcome)
eslint: 7 no-unsafe-* errors in loader.test.ts, all downstream of the missing LoadSuccess field
```
Both go green once the implementer adds the types. Until then `npm run typecheck` and `npm run lint` are red on this branch by design.

### Gates run for job 2

`qa:reference-resolver` 0, `qa:completeness-claims` 0, `qa:kernel-purity` 0, `qa:fixture-coverage` 0, `qa:diff-fixture` 0, `qa:fixture-isolation` 0; pre-commit history scan PASS (0 blocking). A standalone `oss:secret-scan` run under full-suite load hit my 100 s timeout (exit 124, not a finding); it had passed in job 1 and the commit hook's scan passed for both commits.

### Notes for the implementer (do not edit these tests; flag back instead)

- Append `"defaultOutcome"` LAST in `RULE_SET_KEYS`. B5c fixes that order.
- `mergeLayersWithMandatoryLock` result and `NamedRuleLayer` carry `defaultOutcome`; a redundant lower-trust declaration leaves the holder as source (B7, "deny + deny gives central").
- `defaultOutcome` values `"ask"`, `"DENY"`, `true`, `null`, `1`, `""` all fail with the field's own enum message (not "unknown key").
- Build layer objects with a conditional spread (`exactOptionalPropertyTypes`).
- Hook and `bootstrap-ruleset.ts` untouched by these tests.

---

RECEIPT (job 1, #124): verdict=NOT-APPLICABLE-AS-RED (GREEN-AT-HEAD by design) — confirmation: MUTANT-RED-CONFIRMED
scope=API
discovery: ui-framework=n/a api-framework=found: node:test (node --test)
tests="0/0/0/1" (one new named proof-test ISSUE-123(b), negative; plus six existing sites given a required bound) mapped to 6/6 rejection sites (grep-counted: 6 bounded calls, 0 wildcard calls; typecheck rejects a seventh)
red-run: checks="0/13 failing at HEAD by design; mutants P2 at 4 return sites and P1 all fail the suite (5/5 mutants killed); pre-amendment file lets 4/4 P2 mutants survive"
adr=HIT(37)
report=docs/reviews/s6-policy-residuals-112-124-test-writer-2026-09-24.md

RECEIPT (job 2, #112): verdict=RED-CONFIRMED
scope=API
discovery: ui-framework=n/a api-framework=found: node:test (node --test)
tests="0/0/34/5" (negative = the five tests asserting a schema-level rejection: B2, B4, B5, B5b, B13; voided/ignored-declaration tests counted positive because they assert a resolved value) mapped to 15/15 acceptance criteria (grep-counted from B-tags)
red-run: checks="32/39 failed (7 green-at-HEAD by construction: B3, B4, B5, B5b, B7 none-declared, B8 voided-alone, Part E self-check); 0 pre-existing tests broken (112/112 pass); full suite 33 failing = 32 new + 1 unrelated environmental (stale agent worktrees)"
adr=HIT(37)
report=docs/reviews/s6-policy-residuals-112-124-test-writer-2026-09-24.md

---

## ADDENDUM 2026-09-24 (append-only) — Issue #291: bound the rejection echo below whole-file

Cause: app-security and red-team independently showed that Job 1's `raw-bytes-absent` bound (`!actual.includes(<whole trimmed file>)`) only fires on a complete echo. A mutant appending all-but-one character, or the first 80 bytes, of the offending policy at a loader rejection site passed the suite. Job 1's own drills only tried whole-file mutants, so the gap was mine. Branch `feat/s6-policy-centralization`, HEAD at start `8e65a2b`; the #112 implementation had landed, so the six policy files run 152/152 green.

### Change (`src/policy/config/printer.test.ts` only; zero production diff)

- The bound is now exact equality of the rejection tail against `REJECTED: <layer> policy load failed (<reasonKind>): <message>`, with `<message>` computed in the test from the offending source by the same engine that produced it in the loader:
  - parse failures: `<origin>: <JSON.parse's own error message for that exact text>`;
  - schema failures: `<origin>: <field>: <message>; ...` from `validateRuleSet` (new import of `src/policy/rule/schema.ts` into the test);
  - central read-error: the thrown message (unchanged).
- `RejectionBound` is now `{ message: string; raw?: string }` (still a required parameter; a seventh call site omitting it, or passing `/./`, still fails `tsc`, re-verified: TS2554 and TS2345).
- `ISSUE-123(b)` kept: whole-echo check on `raw`, skipped only where the honest message itself already contains the whole source. New `ISSUE-123(c)` (red-team's name): exact equality at all six sites. Both share one `rejectionSites()` list. File: 14 tests (13 before plus `ISSUE-123(c)`), all pass.
- Header gained INTERPRETATION CHOICE 9 with the reasoning below.

### Why equality, not a "no run of N source characters" rule, and not the terminator regex

Measured on Node 24.15.0 (longest contiguous run of source characters that the honest `JSON.parse` message itself contains):

```text
printer-project-bom-malformed.json         trimmed=337  msgLen=55  longestEchoedRun=11
printer-shipped-defaults-malformed.json    trimmed=126  msgLen=82  longestEchoedRun=3
printer-project-bom-pretty-malformed.json  trimmed=594  msgLen=55  longestEchoedRun=10
```

A run-length rule must catch a 20 to 30 byte prefix (the dispatch asked for it) yet stay above the honest echo of about 11, and V8's snippet keeps up to roughly 10 characters either side of the error position, so the margin would be thin (about 1.5x to 2x) and would depend on V8's snippet format. The terminator regex (`/is not valid JSON$/`) depends on that format too, and does not exist for the shipped-defaults fixture (its honest message is the position form, `Expected ':' after property name in JSON at position N`, no such suffix), nor for schema errors. Equality has no threshold and assumes no message format: the expected text is computed by the engine under test's own runtime, so it is identical on Node 22.18.0 by construction. Margin: not applicable (no threshold); the only residual Node dependency is `ISSUE-123(b)`'s skip condition, which fails safe (skipped, never falsely failed). Red-team's measured whole-echo threshold (17 to 21 characters against a 126-byte smallest fixture) is now irrelevant to correctness. Node 22.18.0 remains not installed here; CI's run of the PR is the confirmation.

### Mutation drills (real mutants, each applied, run, reverted; script and raw output kept in the session scratchpad)

Sites (current lines): read-error central `:167`, parse/schema central `:183`, parse shipped-defaults `:214`, parse project `:232`. Variants appended to the message: whole file, all-but-one-char, first 80 bytes, first 25 bytes, a 30-byte window from the middle, and a one-character suffix (24 leak mutants), plus P1.

```text
Amended suite (14 tests): honest baseline 14/14 pass. 24 of 24 leak mutants fail the suite; P1 fails 4
  (ISSUE-108(a)(b)(c) and ISSUE-123(c)). Whole-file mutants fail ISSUE-123(b) and (c) plus the site test;
  every partial, prefix, window and one-char mutant fails ISSUE-123(c) plus the site test.
  Examples: :232 all-but-one-char   fail=3 (ISSUE-108(a), ISSUE-108(c), ISSUE-123(c))
            :232 first-80-bytes     fail=3 (same)
            :232 first-25-bytes     fail=3 (same)
            :183 first-25-bytes     fail=3 (AC5b x2, ISSUE-123(c))
            :167 one-char-suffix    fail=2 (AC5c, ISSUE-123(c))
Control (the committed pre-fix file, same mutants): 13 of 24 SURVIVE 13/13 green
  (:183 all-but-one, 25-byte, window, one-char; :214 first-80, first-25, window, one-char;
   :232 all-but-one, first-80, first-25, window, one-char). Whole-file mutants and :167 were already caught.
```

After each revert `git status` and `git diff --stat -- src/policy/config/loader.ts src/policy/config/printer.ts` were empty; the control copy of the old test file was created and deleted, never committed.

### Gates

`tsc --noEmit` clean; `eslint printer.test.ts` clean; policy suite (pin, loader, printer, schema, precedence, conformance) 152 tests, 152 pass, 0 fail, 0 skipped; `qa:reference-resolver` 0; `qa:completeness-claims` 0; `node src/secret-scan/history-scan.ts` 0.

Site-count instrument: `grep -c "buildExpectedRejectionStdout(.*(parseFailureBound|schemaFailureBound|fileParseFailureBound|{ message:)"` gives 6; wildcard calls give 0. Not covered by any printer test (out of this issue's scope, noted only): the shipped-defaults and project file read-error return sites in `loader.ts`; `loader.test.ts` covers their message and layer.

RECEIPT: verdict=GREEN-AT-HEAD by design; MUTANT-RED-CONFIRMED
scope=API
discovery: ui-framework=n/a api-framework=found: node:test
tests="0/0/0/1" (new ISSUE-123(c), negative; six site tests now carry an exact-message bound) mapped to 6/6 rejection sites (grep-counted; tsc rejects a seventh)
red-run: checks="0/14 fail at HEAD by design; 24/24 partial and whole leak mutants plus P1 kill the suite; 13/24 of the same mutants survive the pre-fix file"
adr=HIT(37)
report=docs/reviews/s6-policy-residuals-112-124-test-writer-2026-09-24.md
