# S6 fix-now: printer.test.ts amendment — Issue #108 (test-writer, Khnum)

**Date:** 2026-09-08
**Scope:** s6 (post-ship residual, fix-now round)
**Tier:** CRITICAL (inherited, persisted in docs/.maat-state.json)
**Trigger:** GitHub Issue #108 (open, reopened by red-team round 4) — `src/policy/config/printer.ts`'s `renderRejection` hardcodes the prefix "central policy load failed" for ALL THREE load-rejection reason kinds, regardless of which layer (central / shipped-defaults / project) actually failed. The current locked test at `printer.test.ts` pinned this wrong behavior as the contract. Per this project's DoD, only test-writer may amend a locked answer key, and only when the test itself is wrong.

## ADR cache

```
📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ≈17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]
```

Applicable ADR: **ADR-0005 (software-engineering)** — "Testing strategy — unit tests + Playwright E2E" (applicableTo: testing, quality). Relevant rules checked: "MUST NOT delete or weaken a failing test to make CI pass; fix the code or escalate" (not violated — this is a correction of a pinned bug in the test itself, per Issue #108, not a weakening to dodge a real failure); "MUST make each test create/own its data" (both new tests use dedicated fixture files, no shared mutable state). No blocker found. This is a Node-native `node:test` file, matching the existing convention already used by every other `src/policy/config/*.test.ts` file in this repo — no framework substitution.

## Issue #108 — full read

Issue body: `loader.ts:149` (whole-load discard on lock violation, ratified AC9/CHANGELOG whole-LAYER) — already fixed, closed by red-team round 2. Second defect (the one this pass addresses): `printer.ts:40` (now `:67`) misattributes a project-file fault to the central channel; that 4th reason kind (non-central layer failure) had no printer test. Red-team REOPENED the Issue round 4 specifically for this second half, with a real repro:

- Windows operator saves `.thoth/policy.json` (PROJECT layer) via PowerShell 5.1 `Out-File -Encoding utf8` or Notepad "UTF-8 with BOM".
- Central is absent and wholly uninvolved.
- Printer output: `central-channel status=absent` / `REJECTED: central policy load failed (json-parse-error): ...project.json: Unexpected token...` — line 1 says central is absent, line 2 blames central. Fail-closed either way (exit 1, no data leak) — message-clarity defect, not security/correctness, but violates POL-10's "one command answers 'why is this blocked'" by naming the wrong owner.
- Named unlock: "this needs a test-writer amendment... first, then the printer change." Two named regression tests: (a) printer.test.ts — "a rejection caused by the PROJECT layer never claims the central channel failed"; (b) loader.test.ts — "a UTF-8 BOM on any layer file is either tolerated or rejected with that layer named."

## Confirming the test pins the bug, not a second code-side bug

Read `src/policy/config/printer.ts`, `printer.test.ts`, `src/policy/config/loader.ts` before touching anything.

- `printer.ts`'s `renderRejection` (line 67, before amendment): the string template hardcodes the literal `"central"`, independent of which branch in `loader.ts` produced the failure.
- `loader.ts` has three distinct `return { ok: false, ... }` sites: central-parse-failure (line 137-145, genuinely central), shipped-defaults-parse-failure (line 154-156), project-parse-failure (line 160-162). None of the three sets a `layer` field on `LoadFailure` today — but the `message` field already carries the correct failing origin path (via `parseLayerText`'s own `origin:` prefix), so the layer information IS available/derivable at the call site; `printer.ts` simply never used it.
- Ran the ORIGINAL (pre-amendment) `printer.test.ts` against the current code: 9/9 pass — confirmed the original suite was genuinely pinning printer.ts's wrong behavior, not exposing a second loader.ts defect. This is a printer.ts fix, not a loader.ts fix — consistent with Issue #108's own diagnosis.
- Reproduced the real repro directly against `printEffectivePolicy()` with a genuine UTF-8-BOM'd project fixture (before writing any test): confirmed byte-for-byte the same misattribution the Issue describes.

## Discovery

- **UI-touching:** n/a — no UI surface in this story.
- **Backend/API layer:** `node:test` (Node's native test runner), already the established convention across every `src/policy/config/*.test.ts` file in this repo (bootstrap-ruleset.test.ts, central-source.test.ts, loader.test.ts, pin.test.ts, position-parser.test.ts, printer.test.ts itself). No new framework introduced.
- `loader.test.ts` was read and confirmed to be story-implementer's own white-box unit-test file (plain node:test unit tests against temp-dir fixtures, no test-writer lock header/language) — out of test-writer's ownership per this project's "two layers, two authors" rule. Not touched.

## What was amended (test file only — no production code touched)

`src/policy/config/printer.test.ts`:

1. **STDOUT GRAMMAR doc comment** (fail-closed rejection section) — updated to require `REJECTED: <layer> policy load failed (<reason-kind>): <message>` where `<layer>` is one of "central", "shipped-defaults", "project" — naming whichever layer actually failed, replacing the old hardcoded-to-"central" text.
2. **New "INTERPRETATION CHOICE 6" section** — dated amendment note: what changed, why (Issue #108), the code-vs-test diagnosis above, the real-world BOM repro, and an explicit disposition of both of Issue #108's named regression tests:
   - (a) PROJECT-layer misattribution test — added below, in this file.
   - (b) loader-level BOM-tolerance/rejection test in loader.test.ts — confirmed not separately needed: loader.test.ts is story-implementer's own file (out of scope for test-writer), and test (a)'s own fixture (a real 3-byte EF BB BF BOM, not a simulated string) already exercises the real, non-BOM-tolerant loadEffectivePolicy path end-to-end through the real printer, satisfying (b)'s own disjunctive wording ("either tolerated OR rejected with that layer named" — it is rejected, and now correctly named). Confirmed via loader.ts inspection that BOM is never stripped (readFileSync(path,"utf8") feeds raw bytes straight into JSON.parse) — BOM-tolerance itself (a design choice to strip vs. reject) is a separate, NOT-currently-broken concern this amendment does not take a position on; flagged rather than silently expanded into.
3. **`buildExpectedRejectionStdout` helper** — now takes an explicit `layer: "central" | "shipped-defaults" | "project"` parameter and asserts the REJECTED line names that exact layer (previously hardcoded to "central" unconditionally).
4. **Three pre-existing call sites updated** (central-malformed-JSON, central-schema-invalid, central-read-error) to pass `layer: "central"` explicitly — these ARE genuine central-layer failures, so their expected text is unchanged in substance, only made explicit. All three still pass.
5. **Two new regression tests added**, immediately after the existing AC5c test:
   - `ISSUE-108(a)`: central ABSENT and uninvolved, PROJECT layer fails to parse via a real UTF-8 BOM (the Issue's own repro) — asserts the rejection names "project", and explicitly asserts it never says "REJECTED: central policy load failed".
   - `ISSUE-108(b)`: symmetric case — central ABSENT and uninvolved, SHIPPED-DEFAULTS layer fails to parse (plain malformed JSON) — asserts the rejection names "shipped-defaults". Added because Issue #108's own defect description names all three layers ("central / shipped-defaults / project"); leaving the shipped-defaults branch completely unverified would leave a real gap in the fix this Issue asks for. This completes the fix's own stated scope rather than expanding beyond it.

New fixture files (dedicated, own data, per ADR-0005):
- `docs/qa/s6-policy-loader-fixtures/printer-project-bom-malformed.json` — real 3-byte UTF-8 BOM (EF BB BF) prefix + compact single-line JSON (compact deliberately, to avoid V8 embedding a literal newline inside its JSON.parse error-preview text, which would otherwise break the "exactly 2 stdout lines" invariant for reasons unrelated to the actual bug — this was caught and fixed during the red-run below).
- `docs/qa/s6-policy-loader-fixtures/printer-shipped-defaults-malformed.json` — truncated/malformed JSON, no BOM needed (proves the same branch regardless of why the layer failed to parse).

## RED-CONFIRMED run

Baseline (BEFORE amendment, original locked test against current unfixed code) — confirms the original file was pinning the bug:

```
$ node --test src/policy/config/printer.test.ts
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

AFTER amendment, against the SAME unfixed printer.ts/loader.ts (no production code touched):

```
$ node --test src/policy/config/printer.test.ts
✔ fixture-integrity: ...
✔ AC3/AC5a: central channel ABSENT ...
✔ AC3: central channel UNSUPPORTED ...
✔ AC3/AC10: central channel PRESENT and valid ...
✔ AC5b: central channel PRESENT but syntactically invalid JSON ...
✔ AC5b: central channel PRESENT, syntactically valid JSON, but fails schema validation ...
✔ AC5c: centralSource.read() itself THROWS ...
✖ ISSUE-108(a): central channel ABSENT and wholly uninvolved, but the PROJECT layer itself fails to parse ...
✖ ISSUE-108(b): central channel ABSENT and wholly uninvolved, but the SHIPPED-DEFAULTS layer itself fails to parse ...
✔ AC5a/AC5b/AC5c table: ...
✔ AC3: package.json defines a policy:print script ...
ℹ tests 11
ℹ suites 0
ℹ pass 9
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 148.3682

✖ failing tests:

test at src\policy\config\printer.test.ts:431:1
✖ ISSUE-108(a) ...
  AssertionError [ERR_ASSERTION]: expected line 2 to start with the exact "REJECTED: project policy load failed (json-parse-error):" prefix -- naming the layer that ACTUALLY failed, not hardcoded to "central" regardless of the true offender (Issue #108 [MED]); got:
  central-channel status=absent
  REJECTED: central policy load failed (json-parse-error): C:\playground\thoth\docs\qa\s6-policy-loader-fixtures\printer-project-bom-malformed.json: Unexpected token, "..." is not valid JSON
  actual:   REJECTED: central policy load failed (json-parse-error): ...
  expected: /^REJECTED: project policy load failed \(json-parse-error\): /

test at src\policy\config\printer.test.ts:442:1
✖ ISSUE-108(b) ...
  AssertionError [ERR_ASSERTION]: expected line 2 to start with the exact "REJECTED: shipped-defaults policy load failed (json-parse-error):" prefix -- naming the layer that ACTUALLY failed, not hardcoded to "central" regardless of the true offender (Issue #108 [MED]); got:
  central-channel status=absent
  REJECTED: central policy load failed (json-parse-error): C:\playground\thoth\docs\qa\s6-policy-loader-fixtures\printer-shipped-defaults-malformed.json: Expected ',' or '}' after property value in JSON at position 127 (line 7 column 1)
  actual:   REJECTED: central policy load failed (json-parse-error): ...
  expected: /^REJECTED: shipped-defaults policy load failed \(json-parse-error\): /
```

Both new tests fail cleanly and specifically on the layer-naming assertion (the exact bug Issue #108 describes) — not on any incidental setup/fixture error. All 9 pre-existing tests still pass (their expected text is unchanged in substance; the helper's new `layer` parameter was explicitly set to "central" for all three, which is what they always were). 0 unexpectedly passing among the new tests. `npx tsc --noEmit -p tsconfig.json` — clean, no type errors introduced.

## Traceability (grep-counted, not hand-typed)

```
$ grep -c "test(\"ISSUE-108" src/policy/config/printer.test.ts
2
$ grep -c "^test(" src/policy/config/printer.test.ts
11
```

2 new ISSUE-108-tagged tests, both mapped to the 2 named regression-test asks in Issue #108's own reopening comment: (a) directly implemented; (b) confirmed subsumed by (a)'s real-BOM fixture per the reasoning in INTERPRETATION CHOICE 6 (documented in-file, not silently dropped). 2/2 clean mapping — no AC left untagged, no duplicate tags.

## Out of scope / flagged, not silently expanded

- `loader.test.ts`'s own BOM-tolerance design choice (strip vs. reject) is untouched — this amendment does not mandate BOM-stripping, only correct layer-attribution on rejection, matching Issue #108's own disjunctive wording. If the Manager/story-implementer later wants loader.ts to tolerate (strip) a BOM instead of rejecting it, that is a new, separate design decision — not this Issue.
- `docs/STATE.md` and `docs/backlog.md` show as pre-existing modified in `git status` at session start / from unrelated prior activity — not touched by this pass.

## Lane discipline

No production code touched: printer.ts, loader.ts, and every other src/** file outside printer.test.ts and the two new fixture JSON files are untouched. Confirmed via `git status --short`:

```
 M src/policy/config/printer.test.ts
?? docs/qa/s6-policy-loader-fixtures/printer-project-bom-malformed.json
?? docs/qa/s6-policy-loader-fixtures/printer-shipped-defaults-malformed.json
```

RECEIPT: verdict=RED-CONFIRMED
scope=API
discovery: ui-framework=n/a api-framework=found: node:test (existing convention)
tests="0/2/0/2" mapped to 2/2 acceptance criteria (grep-counted from ISSUE-108 tags, not hand-typed)
red-run: checks="2/11" (9 pre-existing tests pass unchanged, 2 new regression tests fail cleanly on the layer-naming assertion, 0 unexpectedly passing)
adr=HIT(35)
report=docs/reviews/s6-printer-test-writer-fixnow-2026-09-08.md
