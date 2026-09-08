# S6 POL-10 Printer CLI — test-writer report (Khnum)

**Date:** 2026-09-08. **Scope:** API/CLI (the printer's black-box I/O contract only — loader/lock/pin
internals stay `story-implementer`'s own unit tests, per the plan's own §7 dispatch scope).
**Story:** S6 (Milestone #24, Policy centralization). **Source plan:** `docs/plans/S6-phase1-v2-2026-09-08.md`
(v2, authoritative — v1 superseded, historical only).

## ADR compliance gate

`node docs/adr-cache.mjs --ensure` → `📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12,
adr/software-engineering:23] from catalog — ≈17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`.

Applicable ADRs, read from the shared catalog per this story's own plan §1 (unchanged from v1,
already ratified — not re-litigated here): ADR-0021 (kernel purity — the printer's I/O lives in
`src/policy/config/**`, outside `src/policy/kernel/**`, unchanged by this test-only pass), SE
ADR-0002 (domain layer free of SDK imports — not touched by test files), SE ADR-0003 (injectable
I/O dependencies via constructor/parameter, never instantiated inside business logic — this is the
ADR that directly shapes this file's central design decision: `printEffectivePolicy()` takes an
injected `CentralPolicySource`, and my printer contract test calls that function directly rather
than inventing a process-boundary fixture-injection seam — see INTERPRETATION CHOICE 3 in the test
file's own header). No ADR my test files could violate (I write no application code, no test
framework choice, no new dependency). No BLOCKER.

## Discovery

- **UI framework:** none found relevant — POL-10 is a CLI, not a web/UI flow (plan's own §1 ADR
  review already ruled SE ADR-0005/Playwright not-applicable for this reason). `n/a`.
- **API/backend test framework:** Node's built-in test runner (`node --test`), used project-wide —
  confirmed via `package.json`'s `"test": "node --test"` and `"test:coverage": "node --test
  --experimental-test-coverage"`, and via every existing `.test.ts` file under `src/policy/**` and
  `hooks/**` (e.g. `src/policy/config/bootstrap-ruleset.test.ts`, `hooks/sessionstart-tool-enum.test.ts`).
  Node 24.15.0 confirmed installed and running these files directly (native TypeScript type-stripping,
  no build step, no transpiler config found). No second/competing framework introduced.
- Fixture directory `docs/qa/s6-policy-loader-fixtures/` did not exist before this pass (only
  `docs/qa/` existed) — created it, per the plan's own "New files" list naming this exact path.

## The printer contract this file specifies (full grammar, reproduced from the test file's own header)

`src/policy/config/printer.ts` must export:
```ts
export interface PrinterInput {
  shippedDefaultsPath: string;
  projectPolicyPath: string;
  centralSource: CentralPolicySource;
}
export interface PrinterResult { stdout: string; exitCode: number; }
export function printEffectivePolicy(input: PrinterInput): PrinterResult;
```
Never throws — internally catches `centralSource.read()` throwing, JSON.parse failures, and schema
validation failures, translating each into a `PrinterResult` with `exitCode: 1`.

**Stdout grammar** (exact, `\n`-joined):
- Success (`exitCode: 0` — central status is `absent`, `unsupported`, or `present`-and-valid):
  - Line 1: `central-channel status=<absent|unsupported|present>[ channel=<channel>]`
  - Line 2: `--- resolved rules (<n>) ---`
  - Lines 3..: `rule id=<id> effect=<allow|deny> layer=<shipped-defaults|central|project> origin=<origin> line=<line> mandatory=<true|false>`, one per resolved rule, in `mergeLayers`-order (first-appearance across shipped-defaults → central → project; the WINNING layer's value is shown, per POL-08's existing last-write-wins semantics).
- Fail-closed rejection (`exitCode: 1` — AC5b/AC5c):
  - Line 1: `central-channel status=present channel=<channel>` (malformed-JSON / schema-invalid) or `central-channel status=read-error` (`.read()` itself threw — no channel is ever known)
  - Line 2: `REJECTED: central policy load failed (<reason-kind>): <message>`, `<reason-kind>` in `{json-parse-error, schema-invalid, read-error}`
  - Exactly these 2 lines — no `rule id=` line ever appears (whole load void).

Full reasoning, and every INTERPRETATION CHOICE made (stdout format itself, the CLI command name
`policy:print`, the deliberate deviation from the hooks/*.test.ts subprocess-spawn mechanism and
why, the `.gitattributes`-forced-LF finding that rules out a committed CRLF fixture file, and the
`mandatory=<bool>` display choice) are written verbatim as the header comment of
`src/policy/config/printer.test.ts` — not duplicated here in full; see that file directly.

### Why direct function-call testing, not subprocess spawn (the one deliberate deviation from the S5 hooks precedent)

Hooks are spawned as real child processes because that IS their only real entry point (Claude Code
itself invokes them that way). The printer's CLI entry is a thin wrapper with near-zero logic:
production wiring constructs the real win32 `reg query` `CentralPolicySource` and calls
`printEffectivePolicy()`. Testing that exported function directly, in-process — this repo's own
established pattern (`bootstrap-ruleset.test.ts` imports and calls `loadBootstrapRuleSet()`
directly) — exercises the exact same public function the CLI wrapper itself calls.

This is not merely a style preference. A subprocess-spawn test of the real `npm run policy:print`
would need a process-boundary mechanism (an env var or CLI flag) to substitute a fixture
`CentralPolicySource` for the real registry reader. This project already shipped, and then
REMOVED FROM PRODUCTION for a proven CRITICAL security reason (GitHub Issue #99,
`hooks/sessionstart-tool-enum-fixnow.test.ts`'s own header), exactly that shape of seam for a
sibling "Policy delivery / config surface" mechanism (`central-classification.ts`'s
`THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH`). Inventing the equivalent seam here — unilaterally,
in a test file — would silently reintroduce the exact defect shape this project already paid to
fix once, and designing any such seam is a production-code decision for `story-implementer`'s own
plan and this sensitive area's named reviewers, not test-writer's to invent. Confirmed by reading
that test file's header directly, not assumed.

Separately: `.gitattributes` (`* text=auto eol=lf`, `*.json text eol=lf`) forces LF normalization
on every committed `.json` file at checkout on this Windows repo (`core.autocrlf=true`, confirmed
via `git config --get core.autocrlf`). A committed "CRLF fixture" `.json` file would therefore be
silently rewritten to LF by git itself and prove nothing about AC10's CRLF case — confirmed by
reading `.gitattributes` directly. The CRLF+non-ASCII central fixture is therefore an in-memory
string built with explicit `\r\n` inside the test file, never a checked-in raw-CRLF file.

## Self-verification (evidence, not a claim) — my own answer key was checked for latent bugs

Before treating this as done, I wrote a throwaway reference implementation of `printer.ts` and
`central-source.ts` in my scratchpad (never committed to this repo) matching the contract above
exactly, copied `printer.test.ts` and the two committed fixtures alongside it, and ran the suite.
First run: 7/9 passed, 2 failed. Both failures were investigated:
- `package.json` ENOENT — an artifact of the scratch dir having no `package.json`; added a stub and it passed. Not a defect in the test file.
- The table test's "every case's status LINE is pairwise distinct" assertion genuinely failed against my OWN correct reference implementation — `present-valid`, `malformed-json`, and `schema-invalid` legitimately share line 1 (`central-channel status=present channel=...`) by my own grammar, since the READ itself succeeds identically in all three; only the content's validity differs. This was a real bug in my test's assertion, not in the reference implementation. **Fixed**: the assertion now checks pairwise distinctness of the FULL `(exitCode, stdout)` rendering instead of line 1 alone, with the test's own docstring updated to state this explicitly. Re-ran: 9/9 pass against the reference implementation.

This is exactly the "if any new test unexpectedly passes against nothing... fix the test" discipline applied in reverse — a test that would have falsely failed a CORRECT implementation is just as much a defect as one that falsely passes a broken one, and it was caught before handoff, not after.

## RED confirmation — raw command output, against the real repo

```
$ cd C:/playground/thoth && node --test src/policy/config/printer.test.ts
node:internal/modules/esm/resolve:271
    throw new ERR_MODULE_NOT_FOUND(
          ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\playground\thoth\src\policy\config\printer.ts' imported from C:\playground\thoth\src\policy\config\printer.test.ts
    ...
Node.js v24.15.0
✖ src\policy\config\printer.test.ts (116.521ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 127.7271
```

Clean, unambiguous RED — a module-not-found error, not a flaky/ambiguous failure. Node's test
runner reports `tests 1 / fail 1` because the whole file's top-level `import { printEffectivePolicy
} from "./printer.ts"` fails before any of the 9 `test()` calls can even register — expected, same
shape as this project's own S5 precedent (`hooks/sessionstart-tool-enum.test.ts`'s own header:
"every test below is expected to fail with a 'module/file not found' style error right now").

**Regression check — the rest of the suite is unaffected:**
```
$ node --test --test-reporter=spec src/policy/**/*.test.ts hooks/**/*.test.ts
...
ℹ tests 381
ℹ suites 0
ℹ pass 380
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2654.408
✖ failing tests:
test at src\policy\config\printer.test.ts:1:1
```
380 pre-existing tests pass unchanged; the ONE failure across the entire suite is exactly the new
printer.test.ts's expected module-not-found RED. Nothing else broke.

## AC mapping — grep-counted, not hand-typed

```
$ grep '^test(' src/policy/config/printer.test.ts | grep -cE "\bAC3\b"   -> 4
$ grep '^test(' src/policy/config/printer.test.ts | grep -cE "\bAC5a\b"  -> 2
$ grep '^test(' src/policy/config/printer.test.ts | grep -cE "\bAC5b\b"  -> 3
$ grep '^test(' src/policy/config/printer.test.ts | grep -cE "\bAC5c\b"  -> 2
$ grep '^test(' src/policy/config/printer.test.ts | grep -cE "\bAC10\b"  -> 1
```
All 5 acceptance criteria relevant to this dispatch (AC3 POL-10, AC5a/b/c the three fail-closed
states, AC10 tokenizer edge case) have at least 1 tagged test; none are missing, none are zero. 9
tests total: 8 AC-tagged + 1 untagged `fixture-integrity` guard test (on this file's own committed
fixtures' hand-verified line numbers, not itself an acceptance criterion).

**Test breakdown:**
- Positive (success path): AC3/AC5a-absent, AC3-unsupported, AC3/AC10-present-valid, AC3-package.json-script (4)
- Negative (fail-closed / rejection path): AC5b-malformed-json, AC5b-schema-invalid, AC5c-read-error, AC5a/AC5b/AC5c-table (4)
- Support (not AC-mapped): fixture-integrity guard (1)

## Files

- `C:\playground\thoth\src\policy\config\printer.test.ts` (new — the answer key)
- `C:\playground\thoth\docs\qa\s6-policy-loader-fixtures\printer-shipped-defaults.json` (new fixture)
- `C:\playground\thoth\docs\qa\s6-policy-loader-fixtures\printer-project.json` (new fixture)
- No application source touched. No `central-source.ts`/`printer.ts` written (story-implementer's job).

## Open item flagged, not invented

The plan's file list names `src/policy/config/printer.ts` + "a runnable entry (`npm run
policy:print` or similar)" without pinning the exact command name. Per this dispatch's own explicit
authorization ("pick the exact command name if the plan hasn't pinned one, and say so plainly"), I
picked **`policy:print`** verbatim, matching the plan's own suggested name and this repo's existing
`qa:*` script-naming convention. This is disclosed as a pick, not silently assumed — if
`story-implementer` or the Manager prefers a different name, that's a one-line change to my test's
single `policy:print` string literal, flagged back rather than silently diverging.

No other ambiguity was left unresolved by invention-without-disclosure: the stdout format itself,
while entirely unspecified by the plan, is treated as squarely within test-writer's own charter to
specify (the "answer key" test-writer exists to write) and is documented exhaustively, with
reasoning, in the test file's own header — same convention this project's S5 test-writer pass
already used for its own INTERPRETATION CHOICES. Nothing here reopens or invents PRODUCTION-code
design (e.g. no fixture-injection env var/CLI-flag seam on `central-source.ts`/`printer.ts`
themselves) — that boundary is honored explicitly, with the Issue #99 precedent as direct evidence
for why it matters here specifically.

RECEIPT: verdict=RED-CONFIRMED
scope=API
discovery: ui-framework=n/a api-framework=found: Node built-in test runner (node --test)
tests="0/0/4/4" mapped to 5/5 acceptance criteria (grep-counted from AC tags, not hand-typed)
red-run: checks="1/1" (all new tests must show failed, 0 unexpectedly passing)
adr=HIT(35)
report=docs/reviews/s6-policy-printer-test-writer-2026-09-08.md
