# S7-A gate-hook-robustness: Phase 1 plan (2026-09-26)

Branch: `fix/s7a-gate-hook-robustness` (from master). Author: story-implementer (Ptah), Phase 1 only. Nothing is built.
Issues: #303 (hook exits 1 before its own try/catch), #304 (quadratic redirect scan outruns the hook timeout). Activation owner: Issue #308 (wiring is out of scope).
Sources read: `gh issue view 303 304`; `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md`; the design-challenger, red-team and app-security reports under `docs/reviews/s7-kernel-gate-classification-*`; `hooks/pretooluse-kernel-gate.mjs`; `src/qa/gate-fail-open-probe.ts`; `src/qa/gate-latency-budget-check.ts`; `src/policy/normalizer/shell-scanner.ts`.

## 1. Readiness and one-sentence restatement

- Readiness: PASS. No material fact is missing. Rulings 1 to 3 from the Manager settle the three design forks (launcher faults are documented residuals, linearize with no size cap, deterministic scaling proof). No blocking questions.
- Restatement: make the still-unwired kernel gate hook fail closed for every failure that can be fixed inside the script (module-load failure, stdout write failure) and make the shared redirect scan linear, so a large redirect-dense command finishes far inside the timeout with results identical to today's.

## 2. ADR review (hard gate; catalog rebuilt by `node docs/adr-cache.mjs --ensure`: CACHE=HIT, 37 ADRs)

| ADR | Verdict | Rule this story honors |
|---|---|---|
| SE ADR-0021 (thoth-native architecture) | APPLICABLE | "The startup gate, the in-session hook gate, and the pipeline gate MUST all invoke the same single kernel build artifact and MUST return identical verdicts on identical input" (drives R10 equivalence). "The kernel MUST deny a mutating action whose Action record has `source: opaque` or a non-empty `unresolved` array" (the normalizer's unresolved outputs must not change). Kernel purity: kernel files are not touched; `qa:kernel-purity` and `qa:normalizer-registry-purity` are rerun. |
| SE ADR-0005 (testing strategy) | APPLICABLE | "MUST write unit tests for every new/changed domain or application behavior"; "MUST NOT delete or weaken a failing test to make CI pass"; "MUST NOT use `waitForTimeout`, arbitrary sleeps, or ordering-dependent tests"; "MUST make each test create/own its data". The G9 expected-PROCEEDS list changes because two paths flip PROCEEDS to BLOCKS: that is a strengthening, named in section 8, not a weakening. |
| SE ADR-0010 (quality gates) | APPLICABLE | "MUST run the full local equivalent of CI gates before declaring work complete"; "MUST NOT lower coverage thresholds, delete tests"; functions stay within the complexity limit (a new helper is a separate small function, not a larger `walkQuoteState`). |
| SE ADR-0003 (SOLID) | APPLICABLE | Split by reason-to-change: token indexing is a helper next to the tokenizer; the hook stays a thin adapter (no scan logic in the hook). "SHOULD NOT over-abstract": the work meter is one optional parameter, not an interface. |
| SE ADR-0002 (layers) | APPLICABLE, low | The hook remains the adapter that owns the ports; the gate module keeps importing nothing from `src/policy/config/` (existing structure test). Dynamic import stays in the adapter. |
| THOTH-ADR-0001 (fixture standing exception) | APPLICABLE, narrow | "Code under hooks/ and src/ MUST NOT hardcode an entry of either list": new test files type no committed fixture entry name (they read names at run time, as the existing structure test does). The fixture and its loader are not touched. |
| SE ADR-0004 (idempotency), ADR-0009 (observability) | NOT-APPLICABLE | The hook mutates nothing and writes no log; it is a pure read-decide-exit adapter. The stderr message stays fixed text and names no secret. |
| SE ADR-0011 to 0015 (data), ADR-0006/0007/0008 (blast radius, tagging, cost), DevOps ADR-0001 to 0010 (IaC), SE ADR-0016 to 0020 (port fidelity), THOTH-ADR-0002 (proposed) | NOT-APPLICABLE | No data store, IaC, tagging, ported file or secret-scan allowlist is touched. `.github/workflows/ci.yml` is deliberately not touched (no new CI step; new checks run inside `npm test`). |

UNCLEAR ADR applicability: none.

## 3. Measured facts (spike run this session; PRINCIPLES rules 17 and 18)

In-process, Node 24.15 on Windows, before any change. Milliseconds for one call on a command of the stated size; `extract` is `extractRedirectTargets`, `positions` is `findLiveRedirectOperatorPositions`, `normalize` is the whole `normalizeShellCall`.

| Shape (repeated) | 4 KB extract | 8 KB extract | 16 KB extract | 16 KB positions | 16 KB normalize |
|---|---|---|---|---|---|
| ` 2>&1` (fd-dup) | 58 | 179 | 718 | 695 | 1366 |
| ` > a` (spaced) | 57 | 232 | 896 | 1 | 876 |
| ` >a` (glued, no space) | 300 | 1450 | 4793 | 1 | 4773 |
| ` &>x` | 85 | 225 | 870 | 1 | 885 |
| ` >&w` (word form) | 112 | 471 | 1826 | 907 | 2561 |
| plain arguments, no redirect | 0 | 0 | 0 | 0 | 3 |
| quoted `">"` arguments | 1 | 0 | 1 | 1 | 6 |

- Each doubling costs about 4x: quadratic in all five redirect shapes; the shapes with no live redirect are flat.
- Cost sits only in the two per-match `tokenize(liveText.slice(...))` calls (target extraction, and the fd-dup word check inside the shared match scan). A full single tokenize of the same text is 0.5 ms.
- **Correction to the intake note ("worst measured shape is `2>&1`")**: at 16 KB the glued shape is about 3.5x worse than `2>&1`, because each match's remainder is one long whitespace-free token. The gate-latency corpus entry and the scaling tests must cover the glued shape and the word-form `>&w` shape, not only `2>&1`.
- Under the identical-output rule (R10) the glued shape has inherently quadratic output SIZE (target `n` is the whole text from that redirect on). The linear design therefore returns suffix slices of one shared token string (V8 sliced strings, no copy); Phase 2 spike S2 confirms memory stays flat at 128 KB.
- Destroyed-stdout fault, current hook, Windows: 5 of 5 runs with the child's stdout pipe destroyed by the parent before the child started returned exit 0, empty stderr (the fail-open path is real and reproducible with an async spawn). Linux not yet run (spike S3).
- Dynamic import of a `.ts` module under `node --no-experimental-strip-types`: rejects with `TypeError` code `ERR_UNKNOWN_FILE_EXTENSION`, catchable, so a try/catch around dynamic imports turns the fault into exit 2. A missing module rejects with `ERR_MODULE_NOT_FOUND`, also catchable.
- Extrapolation, labelled derived (not measured): about 64x from 16 KB to 128 KB puts `2>&1` near 87 s and the glued shape in minutes. Red-team measured 31.9 s at 133 KB through the real hook for its shape (issue #304 comment), consistent.

## 4. Risk tier (proposal for Manager ratification)

**CRITICAL.** The change edits the PreToolUse session-gate hook (a named sensitive area) and the shell normalizer whose redirect-target output feeds deny-rule write-target detection; a behavior drift in either is a silent deny-to-allow bypass. Mitigations that keep it out of "over-tiered": the hook is unwired (live exposure 0% until #308), the change is behavior-preserving by a running differential proof, and no schema, IAM or CI workflow file is touched.

## 5. Test-first dispatch check

- Does the plan identify a new or changed UI flow or API surface? **NO.** The hook's stdin payload, stdout deny JSON and exit-code contract are unchanged for every input that succeeded before; the change is failure-path robustness and an internal algorithm swap. There is no UI. The externally observable change is limited to fault outcomes (PROCEEDS to BLOCKS), which are asserted by the implementer's own tests.
- `test-writer` is not dispatched. The implementer writes the failing-first tests (section 7, step 2) and commits them red before any production change.

## 6. Acceptance criteria as named test cases

"Red first" = fails on today's code. New test files are additive; nothing `test-writer` authored is edited. The existing shell scanner and shell normalizer test files (including the bash-conformance table) are not modified; step 9 verifies that by a git diff over those paths.

| # | Requirement | Named check (file) | Red first because |
|---|---|---|---|
| A1 | R1 | `hook-blocks-under-no-ts-type-stripping`: spawn `node --no-experimental-strip-types` on the hook with a Bash payload; classify with `classifyOutcome`; expect BLOCKS (exit 2) (hooks/pretooluse-kernel-gate-launch.test.ts) | today exit 1 |
| A2 | R1 | `hook-static-imports-are-node-builtins-only`: extract static import specifiers from the hook source with the same extractor the gate structure test uses; every one starts with `node:`; the project modules are reached only by `import(` inside the function that holds the catch (same file) | today five project modules are static |
| A3 | R2 | `hook-blocks-when-src-tree-missing`: copy only the hook to a temp tree with no src directory; expect BLOCKS (same file) | today exit 1 |
| A4 | R1, R2 | probe rows `node-without-ts-type-stripping` and `import-target-missing` are recorded `expect: BLOCKS`, no `ap`, and observed BLOCKS; the G9 both-ways test passes with the expected-PROCEEDS list amended (src/qa/gate-fail-open-probe.test.ts, existing G9 test, amended) | rows say PROCEEDS |
| A5 | R3, R4 | `residual-launch-faults-stay-proceeds-and-say-so`: rows `interpreter-not-on-path`, `node-options-bad-flag`, `systemroot-nonexistent` stay `expect: PROCEEDS`, `probed: true`, `ap: AP-13`, and each note contains the word "residual" and names the launcher as the owner (same probe test file) | notes lack the wording |
| A6 | R5 | `fail-closed-stderr-names-error-type-only-and-an-unlock`: for a payload failure and for both module-load faults, stderr contains a fixed "Unlock:" clause, no path separator, no stack frame, no parser text, and ends with the error type only (hooks/pretooluse-kernel-gate-launch.test.ts). The existing stderr redaction test (hooks/pretooluse-kernel-gate-stderr.test.ts) must pass UNMODIFIED, so the hint sits before the final `Error type: <Name>` clause and contains no slash, backslash or the words that test rejects | no Unlock clause today |
| A7 | R5 | `fail-closed-error-name-is-sanitized`: in a copy tree, plant a project module that throws an error whose `name` holds a path-like string; stderr ends with a bare `Error` type and the planted string never appears (same file) | name is printed raw today |
| A8 | R6 | `stdout-write-failure-exits-2`: async spawn with the child's stdout pipe destroyed before the child runs, a payload the gate denies; expect exit 2 with a fixed stderr message (src/qa/gate-fail-open-probe.ts new async entry, asserted in src/qa/gate-fail-open-probe.test.ts) | exit 0 today (measured, section 3) |
| A9 | R6 | probe row `stdout-closed-before-write` becomes `probed: true`, `expect: BLOCKS`, no `ap`; the row note states the in-process assertion only and that real-session reach stays unproven (LOW) (same probe test file) | row is PROCEEDS, not probed |
| A10 | R6 | `deny-json-still-reaches-a-healthy-stdout`: the existing hook tests that read the deny JSON and exit 0 with empty stderr stay green UNMODIFIED (run, not new code); one new case asserts a long deny reason is flushed whole (hooks/pretooluse-kernel-gate-launch.test.ts) | new case only |
| A11 | R7 | `no-stale-not-fixed-claims`: the hook header and the probe header do not contain the phrase "NOT fixed in this story", and every id in `RECORDED_DECISIONS` equals the probed set both ways (existing both-ways assertion, kept) (src/qa/gate-fail-open-probe.test.ts) | headers contain the phrase |
| A12 | R8, R10 | `redirect-scan-differential-equivalence`: a running instrument compares the NEW `extractRedirectTargets` and `findLiveRedirectOperatorPositions` with a frozen copy of the OLD implementation over the stated corpus (section 7 step 5); zero mismatches; minimum corpus counts asserted; it prints the counts (src/qa/redirect-scan-differential.ts with its test src/qa/redirect-scan-differential.test.ts) | new instrument; also mutation-checked (A18) |
| A13 | R8 | `glued-and-word-form-redirect-targets-keep-old-values`: literal expectations for `echo >a>b`, `echo >a>>b`, `cmd >&w`, `cmd >& 1`, `cmd 2>&1 >x`, quoted and escaped variants, each value pinned from the OLD implementation's actual output (src/policy/normalizer/shell-scanner-linear.test.ts) | passes on both; guards the new mapping |
| A14 | R8, R9 | `redirect-scan-work-is-linear` (deterministic, no wall clock): an optional work meter counts characters visited by the quote walk and the tokenizer core during one scan; for each shape (fd-dup, spaced, glued, `&>`, word form, `>>`) at 16, 64 and 128 KB assert work is at most K times the length, and work(64 KB) divided by work(16 KB) is at most 4.5 (linear is 4.0). K is set to twice the value measured by spike S1 and recorded in the test (src/policy/normalizer/shell-scanner-linear.test.ts) | old scan re-tokenizes per match: work about m times n |
| A15 | R9 | `real-hook-redirect-dense-under-2000ms-at-16-64-128KB`: through the real hook (`spawnSync`, cold process), every shape at each of the three sizes finishes under 2000 ms and passes `assertHookOutcome` (exit 0 or 2 with a parseable decision) (src/qa/gate-latency-budget-check.test.ts, new cases; a shared shape builder exported from the check file) | 16 KB already crosses 2000 ms for the glued shape (section 3); 64 and 128 KB hit the 30 s spawn timeout |
| A16 | R9, R11 | `latency-corpus-has-a-128KB-entry`: the corpus (exported) contains at least one command of 128 KB or more, and every iteration of every entry passes `assertHookOutcome` (existing timer already throws on a bad outcome); `npm run qa:gate-latency-budget` reports p99 under 2000 ms (command output, not a claim) (src/qa/gate-latency-budget-check.ts and its test) | corpus lacks the entry |
| A17 | R13 | probe row `input-size-timeout` is re-probed: `probed: true`, `expect: BLOCKS`, a padded 128 KB redirect-dense command the gate denies (two write targets), observed BLOCKS in under the probe's own timeout; its `ap: AP-14` is dropped (src/qa/gate-fail-open-probe.ts and its test) | row is PROCEEDS, not probed |
| A18 | R12 | `npm run qa:mutation-shell` still kills every `findLiveRedirectMatches` mutant and the multi-redirect collection mutant; its two moved anchors are updated in src/qa/shell-detector-mutants.ts; two new mutants (target-suffix offset ignored; fd-dup word taken from the whole token) are added and killed by A12/A13 (command output with killed and survived counts) | anchor for the multi-redirect mutant vanishes when the code moves |
| A19 | R10 | `existing-scanner-and-shell-tests-unmodified-and-green`: git shows zero diff on the existing shell scanner and shell normalizer test files; `npm test` full run green with real counts | n/a (regression guard) |
| A20 | R7 | `ap-narrowing-recorded-outside-persisted-reports`: a comment on Issue #308 (drafted in section 12) narrows AP-13 and AP-14; no file under docs/reviews is edited; the S7 phase 1 plan is not edited (this plan is the addendum) | n/a (process check: `git diff --stat` shows no docs/reviews path) |

Every requirement R1 to R13 maps to at least one row: R1 A1 A2 A4; R2 A3 A4; R3 and R4 A5; R5 A6 A7; R6 A8 A9 A10; R7 A11 A20; R8 A12 A13 A14; R9 A14 A15 A16; R10 A12 A13 A19; R11 A16; R12 A18; R13 A17. Criteria mapped: 20 of 20 (13 requirements). This mapping is the plan's own table; the build receipt's counts come from the test runs, not from this sentence.

## 7. Plan (order matters: spikes, red tests, then code)

**Step 1. Spikes (measure before shaping).**
- S1: prototype the linear scan in a scratch file, measure the work meter and wall clock at 16, 64, 128 KB for every shape, set K for A14, confirm 128 KB through the real hook is far under 2000 ms (needed margin at least 4x under the parallel `node --test` load). If the margin is under 4x, stop and tell the Manager; do not loosen the assertion.
- S2: memory at 128 KB glued (the sliced-string claim).
- S3: destroyed-stdout reproduction on Linux (CI is Linux, Node 22.18). If the pipe write does not fail there, the async probe row is asserted on the platform where it reproduces and the row records that; the in-process fix (write callback plus error listener) is platform-independent.
- S4: dynamic-import failure under `--no-experimental-strip-types` on Node 22.18 (CI) and 24.15 (local): confirmed catchable on 24.15 in this session; 22.18 confirmed by the CI run.

**Step 2. Failing tests first, committed red.** A1 to A3, A6, A7, A8, A9, A11, A13 (against old, passes), A14, A15, A17, plus the probe test amendments (A4, A5). Run and record the red counts. `qa:gate-latency-budget` corpus change (A16) lands here too, also red (the 128 KB entry times out on the old scan).

**Step 3. Hook (fixes #303 for everything fixable in the script).** Edit `hooks/pretooluse-kernel-gate.mjs`:
- Static imports become only `node:path` and `node:url`. The five project modules are loaded with `import()` inside the same async function that holds the catch (one `Promise.all`, so start-up cost is unchanged), and the module-level constants that used them move inside.
- Catch handler: fixed message text plus a fixed unlock clause plus `Error type: <name>`; the name is accepted only when it matches a short letters-only pattern, otherwise `Error`. No path, no raw message.
- Output: replace the bare `process.stdout.write(...)` then `process.exit(...)` with a write that waits for its callback and has a stdout error listener; on any write error the process prints a fixed stderr message and exits 2. A kernel allow (empty stdout) still exits 0 with no output; a deny still exits 0 with the deny JSON.
- Rewrite the header: delete both "NOT fixed in this story" sentences; state what is fixed, and state the residuals (interpreter off PATH, `NODE_OPTIONS` bad flag, `SYSTEMROOT` nonexistent) as documented residuals owned by the future settings entry's launcher form (Issue #308, AP-13 narrowed).

**Step 4. Probe.** `src/qa/gate-fail-open-probe.ts`: flip and re-probe rows per A4, A5, A9, A17; add an async entry for the destroyed-stdout fault (the sync `runProbe` stays; the test calls both and compares against `RECORDED_DECISIONS` in both directions); rewrite the header's "Not probed here" paragraph. The two environment rows and the interpreter row stay PROCEEDS, probed, `ap: AP-13`, with "residual" wording.

**Step 5. Scanner (fixes #304).** In `src/policy/normalizer/shell-scanner.ts`:
- Build one token index per call: the tokenizer core also records each token's raw end and, per raw position, how many value characters precede it inside its token. `tokenize` and `tokenizeWithOffsets` return exactly what they return today (existing tests).
- A helper answers "the first token a fresh tokenization of the text after offset would return": binary search for the first token whose raw end is past the offset; a token that starts at or after the offset is returned whole, a token that spans the offset returns its value from the recorded value offset on. Correct because every offset used is right after a live `>` or `&`, where the quote state is "none" with no pending escape, so a fresh scan from that point sees the same states as the full scan.
- `findLiveRedirectMatches` uses the helper for the fd-dup word check (keeping the `isFdDup` and `matches.push` lines textually unchanged so the existing mutant anchors hold); `extractRedirectTargets` uses it for each target. No `slice` plus `tokenize` per match remains.
- The optional work meter (one parameter on the internal walk and tokenizer core; no module-level mutable state, no change to any exported signature's required arguments) feeds A14.
- Complexity: new helper functions each small; no size cap (Manager ruling 2).

**Step 6. Differential instrument (A12).** A new instrument file under the qa source directory, named redirect-scan-differential, holds a frozen copy of the OLD `findLiveRedirectMatches`, `extractRedirectTargets` and `findLiveRedirectOperatorPositions` (built only from the exported `quoteStates`, `escapedChars`, `tokenize`; comment: "test oracle, frozen at the S7-A base commit, never changed"). Stated corpus, each class reported by the instrument with its count:
  - C1 exhaustive: every string up to a fixed length over the alphabet `>`, `&`, backslash, single quote, double quote, space, `a`, `1` (length chosen so the instrument stays under about 15 s; count printed).
  - C2 seeded random: fixed-seed generator, strings of 1 to 80 characters over a wider alphabet (adds newline, tab, `|`, `;`, `<`, `(`, `)`, `$`, backtick, `-`, `2`); at least 200000 cases.
  - C3 fixtures: every shell command string exported by `src/policy/fixtures/normalizer-calls.ts` (enumerated by the instrument at run time, not typed).
  - C4 shape sweeps: each of the six shapes at sizes up to 4 KB, where the old code completes.
  - Output compared by deep equality for both functions; the test asserts zero mismatches and the minimum count per class so the corpus cannot silently shrink. Scope statement (the claim the instrument supports): identical outputs on this corpus; not a proof over all strings.

**Step 7. Latency instrument.** Export the corpus and the shape builder from `src/qa/gate-latency-budget-check.ts`, add the 128 KB entry (glued shape, plus the fd-dup shape at 128 KB), keep the 2000 ms ceiling and the per-iteration outcome assertion (already in the timer).

**Step 8. Mutants.** Update the two anchors in `src/qa/shell-detector-mutants.ts` that move; add the two new mutants (A18).

**Step 9. Records and full gate run.** CHANGELOG entry; rerun the full local CI equivalent: `npm test`, typecheck, lint, `qa:mutation-shell`, `qa:kernel-purity`, `qa:normalizer-registry-purity`, `qa:gate-command-path`, `qa:gate-manifest`, `qa:gate-matcher-drift`, `qa:gate-latency-budget`, `qa:fixture-coverage`, `qa:completeness-claims`, QA-14 in diff mode, secret scan. Confirm no `.claude/worktrees` directory exists (it breaks the manifest check and QA-14). Prepare the PR skeleton. `docs/STATE.md`, `docs/decisions.md`, the run log and the issue comments are the Manager's records at close.

## 8. Existing tests this story must change, named up front

Both are the implementer's own tests from S7, not `test-writer`'s. Neither is weakened.
- src/qa/gate-fail-open-probe.test.ts, the G9 both-ways test: the expected-PROCEEDS list loses `import-target-missing` and `node-without-ts-type-stripping` (two paths become BLOCKS; strictly stronger). The test that says `stdout-closed-before-write` is "recorded, not probed, PROCEEDS" is replaced by A9.
- src/qa/gate-latency-budget-check.test.ts: additive cases only (A15, A16).
- Kept UNMODIFIED and expected green: hooks/pretooluse-kernel-gate-stderr.test.ts (redaction), the test-writer's hook tests, the shell scanner and shell normalizer tests.

## 9. Constraints honored

- CLAUDE.md hard rules: no secrets; no relative-path shorthand in docs; "no hand-derived completeness claims": the only completeness-style claims here (the corpus counts, the static-import set, "every shape") are produced by running instruments (A2, A12, A16), and the R1 to R13 mapping above is checked against the test run, not typed into the receipt.
- No `.github/workflows/ci.yml`, `.gitleaks.toml` or secret-scan file is touched. No settings file is touched (no wiring, no launcher string: Manager ruling 1).
- No shipped policy content, no kernel change, no fixture change (THOTH-ADR-0001).
- Gold-plating fence: no size cap (ruling 2); no launcher design; no new CI step; anything else found goes to a GitHub Issue, not the diff.

## 10. Sensitive areas touched and reviewers required

| Area (CLAUDE.md) | Touched by | Reviewer report needed |
|---|---|---|
| Policy enforcement / session gate: `hooks/pretooluse-kernel-gate.mjs` | hook fail-closed, stdout flush | `app-security-reviewer`, `red-team` |
| Guard / policy engine adjacency: the shell normalizer that feeds deny-rule write-target detection (`src/policy/normalizer/shell-scanner.ts`) | linear scan | `red-team` (equivalence attack), `app-security-reviewer` |
| Evidence / audit trail | none | none |
| Secret scanning / CI gates | none (ci.yml untouched) | none |
| Policy delivery / config surface | none | none |
| Halt-state directory | none | none |

Required review chain (CRITICAL): `red-team` plus `app-security-reviewer` (the two domain reviewers; no third), plus the standing `cross-domain-reviewer`. Each saves a dated report under docs/reviews (rule 10) and all are read before ship, since CLAUDE.md requires a fresh dated review report for sensitive-area changes. `test-writer`: not dispatched. `design-challenger`: not required by rules 15 or 16 (no novel shape; the equivalence claim is settled by the differential instrument, not a design argument); the Manager may add one round if it wants the equivalence argument in step 5 attacked before build, at the cost of one round. `architecture-reviewer`: not required. Ask of red-team specifically: try to produce a counterexample to output equality outside the stated corpus, the destroyed-stdout path, and whether the residual wording overstates or understates the launcher faults.

## 11. Risks

| Risk | Basis | Handling |
|---|---|---|
| The linear rewrite changes an output for some input outside the corpus (deny-to-allow drift) | code-traced: quote-state reasoning in step 5 | corpus C1 to C4 (exhaustive short, random, fixtures, shapes), mutants A18, red-team charge; existing tests unmodified |
| The wall-clock 2000 ms assertions flake under parallel test load on CI | assumption until S1 measures the margin | measure first; require 4x margin; the scaling proof itself (A14) is deterministic per ruling 3; if the margin is thin, escalate, do not loosen |
| The destroyed-stdout fault does not reproduce on Linux | unmeasured (S3) | platform-scoped assertion, recorded in the row note; fix is platform-independent |
| `node --test` file parallelism plus 128 KB real-hook spawns lengthens the suite | derived | 6 shapes x 3 sizes is 18 cold spawns; measure in S1; trim shapes to the ones S1 shows distinct |
| Dynamic import changes module-graph start-up timing | derived | latency check A16 measures it; the five loads are one `Promise.all` |
| A fail-closed message with an unlock hint reaches the model | code-traced: stderr is a model-visible channel (app-security finding 4) | fixed text only, no path, no raw message; A6 and A7 |
| Residual launcher faults stay fail-open at activation | measured (exit 9, exit 134, exit 127) | documented residual, AP-13 narrowed and still an activation blocker owned by Issue #308; not fixable inside the script (Manager ruling 1) |

## 12. Rollout, rollback, and Issue and AP record-keeping

- Rollout: single PR, human merges (human-only action). The hook is unwired, so live exposure is 0% before and after; nothing is deployed.
- Rollback: revert the PR. No data, schema or settings change.
- Suggested commit order, so the two independent halves can be split if the Manager prefers two PRs: tests red; hook and probe; scanner, differential instrument and mutants; latency corpus and records.
- Closing: the PR closes #304 (`Closes #304`). For #303 the script-fixable defect is fixed; the launcher residual moves to the AP-13 row of Issue #308. Recommendation: close #303 with a comment naming the residual and its new home. This is the Manager's call (non-blocking).
- Draft comment for Issue #308 (posted by the Manager or after ship; bodies of issues and persisted reports stay immutable):
  - AP-13 narrowed: the module-load faults (old Node without type stripping, missing import target) and the discarded-stdout-write fault are fixed in the hook and probe-verified BLOCKS. What remains is launcher-level only: interpreter not on PATH (exit 127 or 1), `NODE_OPTIONS` with an unknown flag (exit 9), `SYSTEMROOT` nonexistent on Windows (exit 134). Fix belongs to the settings entry's command form at activation; reach of a settings env block to hooks is still unmeasured.
  - AP-14 closed by the linear redirect scan: measured figures and the differential result are in the S7-A build report.

## 13. Out of scope (recorded, not built)

- The settings entry, any launcher string, the timeout value (activation, Issue #308).
- A size cap on commands (ruling 2).
- Other latent quadratic scans in the normalizer (chain operator, substitution and separator scans read as linear; the spike shows plain arguments flat). If S1 finds another super-linear site on a redirect-dense shape, it is fixed here only if it blocks A15; otherwise it becomes a new Issue.
- Real-session proof that a closed stdout occurs in Claude Code (stays LOW and unproven).
- Changes to the four persisted S7 review reports, or to the S7 phase 1 plan.

## 14. Single next action

Manager ratifies the CRITICAL tier and this plan (or answers the two non-blocking notes: the corrected worst shape; closing #303), then Phase 2 starts with the spikes and the red tests.
