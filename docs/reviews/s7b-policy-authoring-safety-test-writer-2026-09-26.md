# S7-B policy-authoring-safety: test-writer report, PT-7 at hook level (2026-09-26)

[test-writer]
Test Writer (Khnum): API/integration tests (gate hook, stdin/stdout black box), written before story-implementer touches code.

Branch: feat/s7b-policy-authoring-safety. Plan: docs/plans/s7b-policy-authoring-safety-phase1-2026-09-26.md (section 5.1 row R1-8, section 7 brief). Tier CRITICAL (Manager-ratified). Ruling: R1 (Issue 305).

## 1. ADR compliance

- `node docs/adr-cache.mjs --ensure`: `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] ... [CACHE=HIT]`.
- Applicable to this test pass: THOTH-ADR-0001 rule 1 (no committed fixture entry name hardcoded in tests: honored, names read from the fixture at run time; a case-insensitive scan of the new file against every committed entry and connector name found 0 hits) and SE ADR-0005 (tests own their data: every case runs in a copy-tree sandbox; no locked test edited).
- No ADR mandates a different test framework or tag scheme. No blocker.

## 2. Discovery

- ui-framework: n/a (no UI in this item).
- api-framework: found: node:test (the runner behind `npm test`, which is `node --test`) plus the existing black-box sandbox helper hooks/test-support/gate-sandbox.ts, used by every existing gate-hook test (hooks/pretooluse-kernel-gate-classification.test.ts, hooks/pretooluse-kernel-gate-stderr.test.ts). No second framework introduced; the helper is not edited.

## 3. What was written

One new file: hooks/pretooluse-kernel-gate-builtin-override.test.ts (6 tests). Every test title starts with the tag `AC-R1-8` (the plan's row for this item).

Method:
- Built-in names and classes are read at run time from `loadBuiltinToolClassificationLayer()` (the real built-in layer).
- Lowering, raising and same-class pair lists are derived from that layer crossed with the ruled class order (read-only < workspace-mutating < remote-mutating).
- The class order is the only typed vocabulary. It is the ruling's oracle, not an enumeration, and the instrument test asserts every class found in the built-in layer is in it.
- Each case plants one extra entry (built-in name, chosen class) beside the committed entries in the sandbox fixture, then makes an MCP call through the real hook, using the first committed entry name (read from the fixture) as the server.

| Test | Kind | Expected behavior |
|---|---|---|
| `AC-R1-8 instrument` | instrument | Enumeration non-empty; one same-class pair per built-in; every built-in crosses every class once; every built-in class is in the ruled order; the fixed stderr template (from an existing fail-closed path, a broken fixture) contains no built-in name and no class string, so the leak check is falsifiable |
| `AC-R1-8 control` (unmodified fixture) | positive control | Silent allow (exit 0, empty stdout, empty stderr) |
| `AC-R1-8 case 1` | negative (fail closed) | First derived lowering pair: exit 2, empty stdout, stderr is the single fixed line, no leak of entry name, any class string, fixture path, sandbox root |
| `AC-R1-8 case 2` | negative (fail closed), enumerated | Every derived lowering pair (13 today) gets the case 1 outcome; failures are collected and reported together |
| `AC-R1-8 control` (raising pairs) | positive control, enumerated | Every raising pair (25 today) stays a silent allow |
| `AC-R1-8 control` (same-class pairs) | positive control, enumerated | Every same-class pair (19 today) stays a silent allow |

Counts printed by the run itself (not typed): 19 built-ins read at run time; 13 lowering, 25 raising, 19 same-class pairs derived.

## 4. RED run (real code, before any production change)

Command: `node --test hooks/pretooluse-kernel-gate-builtin-override.test.ts` (exit non-zero). Raw output, stack frames omitted:

```
AC-R1-8 instrument: 19 built-ins read at run time; 13 lowering, 25 raising, 19 same-class pairs derived
AC-R1-8 case 2: 13 lowering pairs computed at run time
AC-R1-8 raising control: 25 raising pairs computed at run time
AC-R1-8 same-class control: 19 same-class pairs computed at run time
✔ AC-R1-8 instrument: the run-time enumeration is non-empty, covers only ruled classes, and the fixed stderr template holds none of the names or classes it is checked against (263.0209ms)
✔ AC-R1-8 control: the unmodified fixture leaves an MCP call of a classified server a silent allow (exit 0, empty stdout, empty stderr) (167.9091ms)
✖ AC-R1-8 case 1: one lowering entry (first derived pair, name and classes read at run time) makes an MCP call exit 2, silent stdout, the fixed stderr line, and leaks no name, class string or fixture path (179.7385ms)
✖ AC-R1-8 case 2: EVERY lowering pair (each built-in above read-only crossed with each lower class, derived at run time) makes an MCP call exit 2 with the fixed line and no leak (1701.0248ms)
✔ AC-R1-8 control: EVERY raising pair (entry class above the built-in's) leaves an MCP call a silent allow (central still wins for a raise) (3083.0553ms)
✔ AC-R1-8 control: EVERY same-class pair (entry class equal to the built-in's) leaves an MCP call a silent allow (2390.3212ms)
ℹ tests 6
ℹ suites 0
ℹ pass 4
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7967.2658

✖ failing tests:

test at hooks\pretooluse-kernel-gate-builtin-override.test.ts:133:1
✖ AC-R1-8 case 1: one lowering entry (first derived pair, name and classes read at run time) makes an MCP call exit 2, silent stdout, the fixed stderr line, and leaks no name, class string or fixture path (179.7385ms)
  AssertionError [ERR_ASSERTION]: built-in "Task" (workspace-mutating) planted as read-only: expected the fail-closed exit 2; got code=0 stdout="" stderr=""
  + actual - expected
  
  + [
  +   'exit code 0 (expected 2)',
  +   'stderr is not the single fixed fail-closed line'
  + ]
  - []
  
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: [ 'exit code 0 (expected 2)', 'stderr is not the single fixed fail-closed line' ],
    expected: [],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at hooks\pretooluse-kernel-gate-builtin-override.test.ts:144:1
✖ AC-R1-8 case 2: EVERY lowering pair (each built-in above read-only crossed with each lower class, derived at run time) makes an MCP call exit 2 with the fixed line and no leak (1701.0248ms)
  AssertionError [ERR_ASSERTION]: 13 of 13 lowering pairs did not fail closed:
  built-in "Task" (workspace-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "Bash" (workspace-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "Edit" (workspace-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "Write" (workspace-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "MultiEdit" (workspace-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "NotebookEdit" (workspace-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "WebFetch" (remote-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "WebFetch" (remote-mutating) planted as workspace-mutating: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "WebSearch" (remote-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "WebSearch" (remote-mutating) planted as workspace-mutating: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "TodoWrite" (workspace-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "KillShell" (workspace-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  built-in "SlashCommand" (workspace-mutating) planted as read-only: exit code 0 (expected 2); stderr is not the single fixed fail-closed line [code=0 stdout="" stderr=""]
  
  13 !== 0
  
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 13,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

Reading:
- Both behavior-under-test tests fail on today's code. The MCP call with a lowering entry exits 0 with empty output (a silent allow) in 13 of 13 lowering pairs, where exit 2 is required.
- The instrument and the three controls pass, as the plan expects (section 7: controls pass, that is the RED). They prove the sandbox and the enumeration are healthy.

Satisfiability check (so the test is not merely impossible): in a scratch mirror of the tree outside the repository (the repository itself was not touched), a five-line lowering guard placed before the merge in the catalog assembly made all 6 tests pass (`tests 6, pass 6, fail 0`). A guard that rejected same-class or raising entries would turn a control red.

## 5. What cannot be expressed at hook level (stated honestly)

- The entry name and class are deliberately NOT on the gate channel (S7-A ruling: fixed line, error type only), so the hook test can prove only that they do not leak. That the thrown message NAMES the entry, the built-in class and the unlock is unobservable here; it belongs to R1-2 (catalog level) and R1-7 (SessionStart halt text), both implementer-owned.
- Hook level cannot tell "the guard threw" from any other cause of the same fixed-line exit 2 (for example a broken fixture). Cause attribution is R1-1 and R1-2 (catalog level).
- Hook level cannot show within-fixture order independence (R1-3), the committed fixture passing (R1-4, only partly covered by the baseline control), the merged-never-below property (R1-5), or the single merge site (R1-6). All are catalog-level or structural, implementer-owned.
- The error type in the fixed line is asserted as letters only (the existing contract), not as a specific class name, because the ruling does not fix the thrown error type.
- Bash, Write, Edit and Task never load the catalog and are out of scope (the locked H8 covers them, unedited; R1-9 is a run-only check).
- Hand-off item (plan S-2): this file is not yet in the `STORY_TEST_FILES` list of src/policy/gate/gate-structure.test.ts. It types no committed name (scan above), so it will pass G19 when added. Only the implementer adds it (locked-lane rule).

## 6. Lane discipline

- Only two new files: the test and this report; plus one row in docs/REVIEW_LOG.md.
- No application source, no existing test, and no helper was edited.
- The run-log file modified in the working tree at dispatch is not part of this commit.

## 7. Traceability (grep-counted)

- Test titles carrying the `AC-R1-8` tag: 6. Total tests in the file: 6. Untagged tests: 0.
- Acceptance criteria owned by test-writer in the plan (section 5.1, row R1-8): 1. Mapped: 1/1.

RECEIPT: verdict=RED-CONFIRMED
scope=API
discovery: ui-framework=n/a api-framework=found: node:test + hooks/test-support/gate-sandbox.ts
tests="0/0/3/2" (plus 1 instrument check) mapped to 1/1 acceptance criteria (grep-counted from AC tags, not hand-typed)
red-run: checks="2/6" (both behavior-under-test tests failed, 13 of 13 lowering pairs; the 4 passing are 3 controls and 1 instrument the plan expects green today; 0 behavior tests unexpectedly passing)
adr=HIT(37)
report=docs/reviews/s7b-policy-authoring-safety-test-writer-2026-09-26.md
