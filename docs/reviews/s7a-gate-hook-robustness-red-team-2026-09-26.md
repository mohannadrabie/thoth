# Red Team (Sutekh) - s7a-gate-hook-robustness, post-build CRITICAL review

- Date: 2026-09-26
- Scope: story s7a-gate-hook-robustness, Issues 303 and 304
- Branch: fix/s7a-gate-hook-robustness
- HEAD: 7d25865eb7a52b184cc133e13c8650134466f424 (diff base: master at b345adc47173a4a66102a9d6a5bb630ba51f3309)
- Tier: CRITICAL (ratified, docs/.maat-state.json)
- ADR cache: BUILT, cataloged 2 ADRs, CACHE=HIT. Attack-surface slice read from adrCatalog.adrs in docs/.maat-state.json: THOTH-ADR-0001 (fixture standing exception, applicableTo security/architecture/code) and THOTH-ADR-0002 (value-scoped secret-scan allowlist entries, same lanes). Neither is touched by this diff: no file under docs/qa/ and no secret-scan allowlist entry changes, and no new code hardcodes a committed fixture entry name. No ADR violation found.
- Reviewed read-only. Every mutant applied in an isolated worktree was reverted; the working tree was verified clean afterwards with git status --porcelain (empty output) and git diff --stat HEAD (empty).
- Activation state verified, not assumed: .claude/settings.json carries hooks keys SessionStart and UserPromptSubmit only, and hooks.PreToolUse is undefined. Live exposure of every finding below is therefore zero today; each becomes live at Issue 308.

## Verdict

no-go, on one HIGH that is demonstrated. The unlock is narrow and named, and the story itself is strong: the two defects it set out to fix are fixed, proven, and mutation-tested. What blocks is that the same fail-open class Issue 304 names is still reachable at one fifth of the input size, through a different code path in the same file, while this diff records that class as closed.

## What this story got right (assessed, not flattered)

- The equivalence claim is carried by a running instrument with a stated scope sentence, not by prose. That is the correct shape for a rewrite whose output feeds deny-rule write-target detection.
- The linear rewrite is genuinely linear and genuinely equivalent. I attacked it with a generator family deliberately unlike the shipped one and could not produce a single divergence in 1,563,236 cases across eleven exported functions.
- The scaling proof is deterministic (a character-visit meter), with the wall-clock check kept as a separate second guard. That is the right way round.
- The AC-H13 documenting-comment workaround, which looked like the weakest thing in the diff, holds under attack: the locked test's real verification is a mark file and a pass-through control, not the comment.

## Attack 1 - HIGH - the same input-size fail-open, still open, in the separator scan

Status: BREAKS. Evidence: demonstrated (and code-traced).
Exposure: ~0% of live sessions today (the hook is unwired, verified above); ~100% of Bash gate evaluations after Issue 308 whose command text ends in roughly 8 KB or more of whitespace containing many newline characters. basis: measured.

Scenario. A session issues a Bash command whose text ends in a long run of blank lines. Nothing hostile is needed: a multi-line script pasted with trailing blank lines, a Windows-authored command ending in carriage-return plus newline pairs, or a generated command with a padded tail. The gate normalizes the command, reaches src/policy/normalizer/shell.ts line 147, and calls findLiveTrailingSensitiveSeparator on the whole heredoc-stripped command text. That function is quadratic in the length of a trailing whitespace run that contains newline characters, so the hook never returns. A PreToolUse hook that times out is NON-BLOCKING on the measured runtime: the call proceeds. This is exactly the fault Issue 304 names, reached at a smaller input than the redirect scan ever needed.

Root cause, code-traced. src/policy/normalizer/shell-scanner.ts, function findLiveTrailingSensitiveSeparator (lines 194 to 213). The outer loop visits every character. For every live newline character (and for a live single ampersand), the inner loop at lines 208 to 210 walks forward over every following whitespace character looking for live content. When the whitespace run reaches the end of the text there is no live content, so the function does not return and the outer loop advances by one and repeats the same forward walk. Work is therefore the square of the trailing-whitespace length. The character-class test in that inner loop is a regular-expression test per character, which makes the constant large. This function is NOT in this story's diff; it was read as linear in the plan (docs/plans/s7a-gate-hook-robustness-phase1-2026-09-26.md, section 13, "chain operator, substitution and separator scans read as linear"), and that code read is wrong.

Measured, in-process, one call per cell, Node 24.15, this branch. Input: the word echo, a space, the word hello, then N newline characters. Milliseconds for findLiveTrailingSensitiveSeparator alongside every other exported scanner function, raw output:

    trailing-blank-lines len=8202  quoteStates=0.6 escapedChars=1.0 hasUnterminatedQuote=0.5 findLiveChainOperator=2.9 findLiveSubstitution=1.4 findLiveTrailingSensitiveSeparator=539.4 stripHeredocBodies=1.4 tokenize=0.6 extractRedirectTargets=0.9 findLiveRedirectOperatorPositions=0.5
    trailing-blank-lines len=16394 quoteStates=0.2 escapedChars=0.2 hasUnterminatedQuote=0.2 findLiveChainOperator=0.5 findLiveSubstitution=0.5 findLiveTrailingSensitiveSeparator=2098.1 stripHeredocBodies=1.0 tokenize=0.5 extractRedirectTargets=0.7 findLiveRedirectOperatorPositions=0.6
    trailing-blank-lines len=32778 quoteStates=0.3 escapedChars=0.4 hasUnterminatedQuote=0.3 findLiveChainOperator=1.2 findLiveSubstitution=0.9 findLiveTrailingSensitiveSeparator=8148.5 stripHeredocBodies=1.5 tokenize=1.0 extractRedirectTargets=0.8 findLiveRedirectOperatorPositions=0.9
    trailing-blank-lines len=65546 quoteStates=0.5 escapedChars=0.5 hasUnterminatedQuote=0.5 findLiveChainOperator=2.2 findLiveSubstitution=6.7 findLiveTrailingSensitiveSeparator=33038.3 stripHeredocBodies=5.7 tokenize=2.0 extractRedirectTargets=1.7 findLiveRedirectOperatorPositions=1.9

Four times the cost for two times the input, at every step: quadratic, with every redirect function now flat beside it.

Through the REAL hook, spawned exactly as the sandbox helper hooks/test-support/gate-sandbox.ts spawns it (fresh cold process, JSON payload on stdin, 30 s spawn timeout), raw output. outcome is the strict classification from that helper; a null exit code is the spawn timeout:

    trailing-blank-lines len=16394  ms=2294  code=0    outcome=deny  outLen=257 errLen=0
    trailing-blank-lines len=65546  ms=30023 code=null outcome=other outLen=0   errLen=73  "spawn error: ... ETIMEDOUT"
    trailing-blank-lines len=131082 ms=30010 code=null outcome=other outLen=0   errLen=73  "spawn error: ... ETIMEDOUT"
    trailing-blank-lines len=262154 ms=30018 code=null outcome=other outLen=0   errLen=73  "spawn error: ... ETIMEDOUT"

At 16 KB the hook already crosses the declared OPS-03 budget of 2000 ms (src/qa/gate-latency-budget-check.ts, OPS03_CEILING_MS). At 64 KB it does not finish in 30 s. The Windows carriage-return-plus-newline variant behaves the same (1204 ms at 16 KB, 16875 ms at 64 KB, timeout at 128 KB), which matters because a command authored on Windows naturally carries that line ending.

Contrast that proves the shape, not a general size limit: the same padding with spaces only is flat (145 ms at 16 KB, 221 ms at 256 KB), and blank lines followed by any live content are flat (132 ms at 16 KB, 221 ms at 256 KB) because the first candidate then returns immediately. The pathological shape is specifically a newline-dense whitespace run that reaches the end of the text.

Current defense, honestly assessed. None. The story's redirect-scan work meter covers only the two redirect entry points, so the deterministic scaling test in src/policy/normalizer/shell-scanner-linear.test.ts cannot see this function. The latency corpus in src/qa/gate-latency-budget-check.ts carries three 128 KB entries, all of them redirect shapes built by src/qa/redirect-shapes.ts, so the wall-clock guard cannot see it either. The wrapper recursion in src/policy/normalizer/shell.ts (depth cap 5) can run this scan up to six times on one command, which makes it worse, not better.

Named proof-test required before merge (one failing test, not a condition list):
- Name: separator-scan-work-is-linear-on-trailing-whitespace, in src/policy/normalizer/shell-scanner-linear.test.ts. Extend the existing optional work meter through findLiveTrailingSensitiveSeparator and assert, for a trailing-newline shape and a trailing carriage-return-plus-newline shape at 16, 64 and 128 KB, that visited characters stay within a constant multiple of the input length and that the 64 KB figure is at most 4.5 times the 16 KB figure. Add the same two shapes to src/qa/redirect-shapes.ts (or a sibling shape table) so they also enter the latency corpus and the real-hook wall-clock cases.
The fix itself is small: remember how far the forward whitespace walk already reached and resume the outer loop from there, since a whitespace run that reached the end of the text can never contain live content for any later candidate inside it.

## Attack 2 - MED - the fail-open enumeration now records a class as closed that is still open

Status: BREAKS. Evidence: code-traced.
Exposure: the recorded-decision artifact SUR-10 requires, read by every later reviewer and by the activation story. basis: counted in code.

The row input-size-timeout in src/qa/gate-fail-open-probe.ts (line 65) is now expect BLOCKS, probed true, with no activation-precondition field. Its note is correctly scoped in prose ("a padded 128 KB redirect-dense command"), but the row identity is the fault CLASS, not that one shape, and the row is what the both-ways set-equality test in src/qa/gate-fail-open-probe.test.ts enforces. After this diff the enumeration asserts that input size no longer makes this gate fail open, and attack 1 shows a 64 KB benign command that still does. The separate row hook-timeout-runtime-property (line 66) is about the runtime's treatment of a timeout, not about input-driven work inside the script, so it does not carry this path either.

The same overclaim appears twice more in the records, each time as an absolute:
- docs/decisions.md, the 2026-09-26 S7-A row, ruling 1: launcher-level faults "kill the process before any hook code runs, so nothing inside the hook can catch them", presented as the residual set.
- docs/plans/s7a-gate-hook-robustness-phase1-2026-09-26.md, section 12, the draft comment for Issue 308: "What remains is launcher-level only".
- src/qa/gate-fail-open-probe.ts, header lines 17 to 21: "What stays PROCEEDS is launcher-level only (AP-13, narrowed)".

Attack 1 is an in-script fail-open that is not launcher-level, so all three sentences are false as written.

Current defense, honestly assessed. The hook header comment in hooks/pretooluse-kernel-gate.mjs (lines 50 and 51) is the one place that scopes the claim correctly, to "a padded redirect-dense command". The prose note on the probe row is also correctly scoped. Neither of those is what the both-ways test reads.

Named proof-test required before merge:
- Name: input-size-fail-open-is-recorded-per-shape, in src/qa/gate-fail-open-probe.test.ts. Split the row: keep a redirect-dense row recorded BLOCKS and probed, and add a second row for the newline-dense trailing-whitespace shape whose recorded expectation matches whatever attack 1's fix actually delivers. If the fix lands in this story the second row is BLOCKS and probed; if it is deferred, the row is PROCEEDS with its own activation-precondition id and an Issue number, and the three "launcher-level only" sentences above are reworded in the same commit.

## Attack 3 - MED - an out-of-memory abort inside the hook fails open and is not enumerated at all

Status: BREAKS. Evidence: demonstrated.
Exposure: unquantified for real sessions; reproducible on demand with a constrained heap. basis: measured for the fault, assumption for how often a real runner is that constrained.

Scenario. The gate process starts normally, reads its payload, and dies mid-decision because V8 cannot grow the heap. V8 aborts the process, which on Windows is exit code 134. classifyOutcome in src/qa/gate-fail-open-probe.ts (lines 71 to 82) maps anything that is neither exit 2 nor a deny JSON to PROCEEDS, so the call proceeds. The trigger is a container or runner memory limit, or a NODE_OPTIONS heap flag, combined with an ordinary large command. This is not a launcher fault (the process starts and runs), and it is not the runtime timeout row.

Raw output, real hook in the sandbox copy tree, glued redirect shape, heap capped at 40 MB through the environment:

    heap=40MB glued len=131072  code=0   verdict=BLOCKS   outLen=283 errHead=""
    heap=40MB glued len=524288  code=134 verdict=PROCEEDS outLen=0   errHead="\r\n<--- Last few GCs --->\r\n\r\n[31172:...]      192 ms: Mark-Compact 46.2 (79.4) -> 29.5 (94.1) MB, ... allocation failure"
    heap=40MB glued len=2097152 code=134 verdict=PROCEEDS outLen=0   errHead="\r\n<--- Last few GCs --->\r\n\r\n[28556:...]      116 ms: Scavenge (interleaved) 29.2 (46.9) -> 29.2 (62.9) MB, ... allocatio"

Note the second-order effect: the abort writes a V8 heap report to stderr, a model-visible channel this story deliberately reduced to one fixed line. That output comes from the runtime, not from the hook's own code, so it is not a regression of the stderr hardening, but it is the one path where the hook's fixed-line discipline does not hold.

Current defense, honestly assessed. None, and no row. There is no memory-exhaustion entry in RECORDED_DECISIONS. The CHANGELOG entry for this story reports that the OLD scan "died of heap exhaustion (exit 134) after about 26 seconds at 128 KB", so the failure mode was observed during the build and treated as a symptom of the quadratic scan rather than as its own unenumerated fail-open path.

Named proof-test required before merge (a row, plus the test that pins it):
- Name: memory-exhaustion-is-a-recorded-fail-open, in src/qa/gate-fail-open-probe.test.ts. Add a RECORDED_DECISIONS row for an in-process allocation failure, probed with a capped heap and a large command, recorded PROCEEDS with its own activation-precondition id owned by Issue 308 (the launcher can map any non-zero, non-2 exit to 2, which closes this row and the three AP-13 rows with one mechanism). If the row is recorded BLOCKS instead, it must be probed and observed BLOCKS, which today it is not.

## Attack 4 - MED - the differential instrument frozen oracle is not independent of the module it audits

Status: BREAKS (proof independence, no live defect). Evidence: code-traced, with the gap independently closed by attack 5.
Exposure: every future change to src/policy/normalizer/shell-scanner.ts that this instrument is expected to gate. basis: counted in code.

src/qa/redirect-scan-differential.ts line 26 imports quoteStates, escapedChars and tokenize FROM the module under test, and builds its frozen old scan out of them (lines 42 to 81). The file header states the justification: it is built only from the scanner exports quoteStates, escapedChars and tokenize, "which the rewrite left untouched". That justification does not hold for this diff. The rewrite DID change the tokenizer: tokenizeWithOffsets was rewritten to delegate to a new scanTokens core (src/policy/normalizer/shell-scanner.ts lines 454 to 519) and tokenize is a thin wrapper over it, and walkQuoteState also changed. A regression inside scanTokens would move the new scan and the oracle in the same direction, and the instrument would report 0 mismatches over all 2,696,822 cases while the write-target output was wrong.

The instrument result itself is real (raw output, this branch):

    [S7-A redirect-scan-differential] PASS: redirect scan differential: 2696822 cases, 0 mismatches: identical outputs on this corpus (not a proof over all strings).
      - C1 exhaustive (every string of length 0 to 7 over 8 symbols): 2396745 cases, 0 mismatches
      - C2 seeded random (1 to 80 characters over a 24-entry alphabet): 200000 cases, 0 mismatches
      - C3 fixture commands (enumerated from the normalizer fixture module at run time): 53 cases, 0 mismatches
      - C4 shape sweeps (6 shapes at 64, 256, 1024, 4096 characters): 24 cases, 0 mismatches
      - C5 seeded pieces (1 to 30 multi-character redirect and quoting pieces): 100000 cases, 0 mismatches

Current defense, honestly assessed. Partial and indirect: the unmodified scanner tests in src/policy/normalizer/shell-scanner.test.ts cover tokenize and quoteStates directly, and the shipped mutation harness kills 56 of 56 mutants, so the shared helpers are not unguarded. What is missing is that the central equivalence artifact cannot see a fault in the half of the code it depends on, which is the property it is presented as having.

Named proof-test required before merge:
- Name: frozen-oracle-is-self-contained, in src/qa/redirect-scan-differential.test.ts. Move frozen copies of the quote walk, the escape marking and the tokenizer into the oracle section of src/qa/redirect-scan-differential.ts so that file imports nothing from src/policy/normalizer/shell-scanner.ts except the two functions under comparison, and assert exactly that (the static-import-specifier extractor in src/qa/kernel-purity-check.ts is already reused by this repo for structure tests). With self-contained copies, a mutation inside scanTokens must make the instrument report mismatches; today it cannot.

## Attack 5 - CLEAN - output equality outside the shipped corpus, attacked with a different generator family

Status: SURVIVES. Evidence: demonstrated.

I did not extend the shipped corpus; I replaced the method. Two differences from src/qa/redirect-scan-differential.ts that matter: the oracle is the WHOLE old module, loaded from the previous revision of src/policy/normalizer/shell-scanner.ts, so a regression inside the shared helpers is visible (this closes attack 4 blind spot for this diff); and eleven exported functions are compared per case by deep equality, not two: extractRedirectTargets, findLiveRedirectOperatorPositions, tokenize, tokenizeWithOffsets, quoteStates, escapedChars, hasUnterminatedQuote, findLiveChainOperator, findLiveSubstitution, findLiveTrailingSensitiveSeparator and stripHeredocBodies.

Corpus classes, raw output:

    E1 exhaustive maxlen 8 over 4 symbols gt amp backslash dquote: 87381 cases, 0 mismatches
    E2 exhaustive maxlen 8 over 4 symbols gt amp squote one: 87381 cases, 0 mismatches
    E3 exhaustive maxlen 8 over 4 symbols gt amp space backslash: 87381 cases, 0 mismatches
    E4 exhaustive maxlen 6 over 8 symbols incl tab newline two dash: 299593 cases, 0 mismatches
    E5 random unicode and control, 300k up to 60 chars: 300000 cases, 0 mismatches
    E6 random multi-char pieces, 300k up to 40 pieces: 300000 cases, 0 mismatches
    E7 grammar-structured redirect forms, 400k: 400000 cases, 0 mismatches
    E8 long structurally mixed strings: 1500 cases, 0 mismatches (lengths 1437 to 2030)
    TOTAL over the eight classes: 1563236 cases, 0 mismatches

What each class was aimed at, since a corpus without an attack model is decoration:
- E1 to E3 go two characters DEEPER than the shipped exhaustive class (length 8 rather than 7) on three different four-symbol alphabets, so every arrangement of an escape, a quote delimiter and a redirect operator run within eight characters is covered, including the escaped-operator resume path at src/policy/normalizer/shell-scanner.ts line 383.
- E4 adds tab, newline, the digit two and a hyphen to the exhaustive space at length 6, which is what reaches the fd-dup word classification (a digit-only word versus a hyphen-leading word versus a digit-leading word) and the whitespace token boundaries.
- E5 is the class the shipped corpus has none of: non-ASCII and control characters. No-break space, line separator, byte-order mark, carriage return, a NUL character, an astral-plane character as a surrogate pair, a combining mark, and an Arabic tatweel. No-break space and line separator both match the tokenizer whitespace class, and a surrogate pair is the case where a value offset counted in code units could have gone wrong.
- E6 mixes multi-character redirect pieces with those same control and non-ASCII characters.
- E7 is a grammar over fifteen redirect operator forms, thirty target forms and fifteen separators, assembled one to five times per case plus a trailing target: the fd-dup word forms, quoted and escaped targets, empty targets, a bare backslash target, a NUL-prefixed target, and a target that is itself a redirect operator.
- E8 concatenates sixty grammar fragments per case to reach 1.4 to 2 KB, the regime where the binary search in firstTokenFrom runs over hundreds of tokens rather than a handful, which the shipped shape sweeps (uniform, six shapes, at most 4 KB) do not reach with mixed structure.

Where the equality argument holds, code-traced, so this SURVIVES is not only a count. firstTokenFrom (src/policy/normalizer/shell-scanner.ts lines 341 to 354) is exact only at an offset that is a tokenizer step boundary whose quote state is none with no pending escape. Both call sites pass the position immediately after either a live redirect operator run or the ampersand that follows one (lines 403 and 429). The character before the offset is therefore always a greater-than or an ampersand, which means: it is never a backslash, so the offset is never the second character of an escape pair and its value-offset entry is always written; it never opens a quote, so the quote state at the offset is none, which is also the state a fresh scan of the remainder starts in; and it is always inside a token, so the offset is inside the span of the first token whose end is past it. The offset is also always within the value-offset array bounds, because the largest offset any caller can pass equals the text length. Every one of those is a property of the two call sites, not of the corpus, which is why the count and the argument agree.

## Attack 6 - CLEAN - no other superlinear site in the gate path

Status: SURVIVES (for every shape except the one in attack 1). Evidence: demonstrated.

Eleven further shapes through the real hook at 16, 64, 128 and 256 KB. All flat; the range across all forty-four runs is 117 to 221 ms, which is process start-up plus a linear scan:

    one-huge-token       141 / 153 / 177 / 218 ms
    unterminated-quote   129 / 135 / 142 / 152 ms
    subst-dense          126 / 147 / 152 / 192 ms
    backtick-dense       124 / 140 / 152 / 189 ms
    chain-dense          132 / 157 / 167 / 211 ms
    heredoc-dense        125 / 117 / 118 / 132 ms
    quote-dense          144 / 139 / 152 / 189 ms
    escape-dense         123 / 146 / 154 / 189 ms
    pipe-dense           128 / 151 / 181 / 207 ms
    semicolon-dense      134 / 142 / 178 / 212 ms
    amp-dense            128 / 146 / 166 / 203 ms
    space-pad-after-amp  145 / 155 / 171 / 221 ms

The redirect family, through the real hook, well past the corpus ceiling, showing the scaling of the rewrite itself:

    glued 128 KB   254 ms  (deny, 283-byte decision)
    glued 256 KB   341 ms
    glued 512 KB   472 ms
    glued 1 MB     719 ms
    glued 2 MB    1282 ms
    glued 8 MB    4554 ms
    glued 32 MB   no exit inside the 30 s harness limit

The sliced-string design holds: the deny decision stays 283 to 285 bytes at every size from 128 KB to 8 MB, so the logically quadratic target output of the glued shape never reaches stdout and is never flattened on the way there. The shipped latency instrument agrees:

    [OPS-03 gate-latency-budget-check] PASS: OPS-03: measured p99 (350.42ms) stays under the declared 2000ms latency budget.
      - iterations=70 min=198.18ms p50=223.20ms p95=317.29ms p99=350.42ms max=350.42ms ceiling=2000ms

Assessed honestly: this is a real improvement of more than two orders of magnitude in the size a redirect-dense command must reach before the gate stops answering. The 8 MB figure crossing the 2000 ms budget is outside the declared largest realistic input, not a defect.

## Attack 7 - CLEAN - the hook fail-closed paths, attacked by mutation

Status: SURVIVES. Evidence: demonstrated.

Baseline, whole suite, this branch: npm test reports tests 1289, pass 1289, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 146758.

Each mutant below was applied to the worktree copy, the named test files were run, and the mutant was reverted. Counts are from the run, not from a reading.

- M6, the stdout error listener at hooks/pretooluse-kernel-gate.mjs line 121 replaced by a comment. hooks/pretooluse-kernel-gate-launch.test.ts plus src/qa/gate-fail-open-probe.test.ts: tests 16, pass 15, fail 1, skipped 0. KILLED.
- M7, the awaited stdout write at hooks/pretooluse-kernel-gate.mjs line 169 replaced by a bare unawaited write. Same two files: tests 16, pass 12, fail 4, skipped 0. KILLED.
- M10, the gate call at hooks/pretooluse-kernel-gate.mjs line 167 replaced by a hard-coded silent-allow output (the gate module is never called, the documenting comment left intact). hooks/pretooluse-kernel-gate-classification.test.ts plus src/qa/gate-fail-open-probe.test.ts: tests 22, pass 7, fail 15, skipped 0. KILLED.

So the two new fail-closed mechanisms are each pinned by at least one named test, and a hook that stops routing through the gate module cannot hide behind the documenting comment.

Not attacked, because it is a declared residual and I could not improve on the record: a hook process that never starts, and a hook that hangs until the runtime timeout. Both are recorded PROCEEDS rows and both are correct as recorded.

## Attack 8 - CLEAN - the AC-H13 documenting-comment workaround is honest

Status: SURVIVES. Evidence: demonstrated.

The concern the Manager named is the right one to raise: hooks/pretooluse-kernel-gate.mjs lines 124 to 127 carry a COMMENT written in static-import spelling, purely so that the locked test AC-H13 in hooks/pretooluse-kernel-gate-classification.test.ts can still find it, after the fix turned that import dynamic. A comment that exists to satisfy a regex is normally a smell.

It is not masking a check gap here, and the reason is structural. Read hooks/pretooluse-kernel-gate-classification.test.ts lines 292 to 300 and 344 to 377: the regex is only a DISCOVERY step (it reads the export NAMES the hook uses). The verification is three other things, all of which run against the real hook: the test renames the real gate module aside and writes a pass-through wrapper exporting those names; it asserts a mark file exists, which can only happen if the hook actually called the wrapped function; and it asserts a pass-through control run is a silent allow while five mutated result shapes all block.

Demonstrated both ways:
- M9, the comment line at hooks/pretooluse-kernel-gate.mjs line 127 replaced by a comment with no import spelling. hooks/pretooluse-kernel-gate-classification.test.ts: tests 14, pass 13, fail 1, skipped 0; the failing test is AC-H13. So a stale or removed comment fails loudly rather than silently weakening the check.
- M10 (above), which keeps the comment and stops routing through the gate module: 15 of 22 failures. So the comment cannot certify a route that is not taken.

What I would still change, and it is not a blocker: nothing asserts that the module path in the comment equals one of the dynamic import specifiers the hook actually uses. A2 in hooks/pretooluse-kernel-gate-launch.test.ts asserts every dynamic specifier begins with a project source prefix, and AC-H13 fails if the comment disagrees with reality, so the gap is covered by consequence rather than directly. The clean fix, when someone touches this file next, is for AC-H13 to read the DYNAMIC import specifier and its destructuring instead of a comment, which removes the need for the comment at all. The decisions row for this story already flags AC-H13 for a Manager or human reading, which is the correct disclosure.

## Attack 9 - CLEAN - mutation sensitivity of the new scan, including one honest survivor

Status: SURVIVES. Evidence: demonstrated.

Shipped harness, this branch: [QA-06 shell-detector-mutants] PASS: 56 of 56 mutant(s) KILLED.

My own mutants against src/policy/normalizer/shell-scanner.ts, each run over src/policy/normalizer/shell-scanner.test.ts, src/policy/normalizer/shell-scanner-linear.test.ts, src/policy/normalizer/shell.test.ts, src/qa/redirect-scan-differential.test.ts and src/qa/redirect-scan-linear.test.ts (182 tests):

- M2, firstTokenFrom returns the whole token value instead of the suffix from the recorded value offset: tests 182, pass 148, fail 34, skipped 0. KILLED.
- M4, the binary search comparison in firstTokenFrom made inclusive: tests 182, pass 150, fail 32, skipped 0. KILLED (the differential instrument itself reported 12 mismatches).
- M5, the fd-dup word read one character early: tests 182, pass 165, fail 17, skipped 0. KILLED.
- M1, the token-start comparison in firstTokenFrom changed from at-or-after to strictly-after: tests 182, pass 182, fail 0, skipped 0. SURVIVED.

M1 is an EQUIVALENT mutant, not a coverage hole, and I proved it rather than asserting it: with M1 applied I reran two exhaustive differential classes against the old module and got 174,762 cases, 0 mismatches. The reason is in the code: when a token starts exactly at the offset, its recorded value offset is zero, so slicing from zero returns the whole value. Reporting this as a finding would have been a manufactured one.

## Attack 10 - LOW SUSPICION - the launcher-fault residual wording names an owner but not a mechanism

Status: UNPROVEN. Evidence: derived (no code exists to trace; nothing runnable to settle it in this diff).

The three residual rows in src/qa/gate-fail-open-probe.ts (lines 55 to 57) each say residual, owned by the launcher, the future settings entry command form, Issue 308. Each is probed and observed PROCEEDS, so the OUTCOME is measured, and the interpreter-off-PATH note is exactly right that no code inside a process that never starts can catch anything. My reservation is narrower: two distinct mechanisms would be needed to actually close these rows, and neither the rows, the decisions row, nor the plan section 12 draft says which is committed. Sanitising the environment (so a bad heap or option flag never reaches the interpreter) closes the two environment rows; mapping any non-zero, non-2 exit status to 2 in the launcher closes all three, plus the unenumerated abort path in attack 3. The second is strictly stronger and also cheaper. The rows also correctly record that the reach of a settings environment block to a hook is unproven, so the residual is honest about what it does not know.

Not a finding against this diff, and not gating. It resolves as one line on Issue 308 naming the exit-status mapping as the committed mechanism, so a future reader does not have to re-derive it.

## Attack 11 - LOW SUSPICION - the deny decision grows one-for-one with the command length

Status: UNPROVEN for its reach, demonstrated for the size. Evidence: demonstrated (size), derived (impact).

A single-token command of 262,149 characters produces a 262,396-byte decision on stdout (measured, real hook); at 16 KB it is 16,636 bytes; the quote-dense shape at 256 KB produces 87,634 bytes. So the decision reflects command text roughly one-for-one for shapes whose targets or tokens survive normalization. S7 capped the reflected tool_name at 512 escaped characters, but a shell positional or redirect target is a different field and is not capped.

This is pre-existing behaviour outside this diff (the redirect scan rewrite did not change it; the 128 KB redirect shapes keep a 283-byte decision because their targets are collapsed by the multi-target wholesale deny). I am recording it so it is not lost rather than charging it to this story: it belongs in docs/backlog.md or as its own Issue, decided by the Manager, not in this diff (PRINCIPLES rule 12).

## Gates re-run on this branch (raw)

    npm test                             tests 1289, pass 1289, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 146758.4528
    npm run typecheck                    tsc --noEmit, no output, exit 0
    npm run lint                         eslint ., no output, exit 0
    npm run qa:mutation-shell            [QA-06 shell-detector-mutants] PASS: 56 of 56 mutant(s) KILLED.
    node src/qa/redirect-scan-differential.ts   PASS: 2696822 cases, 0 mismatches
    node src/qa/gate-latency-budget-check.ts    PASS: p99 350.42ms under the 2000ms budget (iterations=70)
    npm run qa:kernel-purity             PASS: 4 production files under the kernel root, zero violations
    npm run qa:normalizer-registry-purity PASS: zero dispatch-chain or sibling-import violations
    npm run qa:gate-command-path         PASS: 2 command-type hook entries, every referenced script resolves
    npm run qa:gate-matcher-drift        PASS: 19 referenced tool names, all present in the vendored snapshot
    npm run qa:gate-manifest             PASS: exactly 1 gate manifest, .claude/settings.json
    npm run qa:completeness-claims       PASS: 2 files checked, all completeness claims verified
    npm run qa:broken-instrument-gate    VACUOUS-PASS: 0 known-broken instruments registered (disclosed)

## Open findings and failing tests

Open findings: 4 (attacks 1, 2, 3, 4). Named failing tests required: 4, one per finding, listed inside each attack. The two LOW suspicions (attacks 10 and 11) have no executable form by design: attack 10 resolves as one sentence on Issue 308 naming the committed launcher mechanism, and attack 11 is out-of-scope pre-existing behaviour that resolves as a backlog line or its own Issue. Both are recorded as residual-register lines, not tests, per PRINCIPLES rule 19.

## Editorial (verdict-neutral, fix as plain edits, no re-review)

- docs/plans/s7a-gate-hook-robustness-phase1-2026-09-26.md section 13 states that the separator scan reads as linear. It is not; attack 1 measures it quadratic. The sentence is a code read, not a claim of having measured it, but it is wrong and it is the reason the site was scoped out.
- The CHANGELOG entry for this story says the latency corpus carries three 128 KB entries; that matches src/qa/gate-latency-budget-check.ts, which is correct. Worth stating explicitly that all three are redirect shapes, so a later reader does not read "128 KB entries" as coverage of large inputs generally.
- src/qa/gate-fail-open-probe.ts header lines 17 to 21, docs/decisions.md 2026-09-26 S7-A row ruling 1, and docs/plans/s7a-gate-hook-robustness-phase1-2026-09-26.md section 12 all contain the phrase that what remains is launcher-level only. Reword all three in the same commit as the attack 2 fix.

## The single scariest unproven assumption

That the fail-open enumeration in src/qa/gate-fail-open-probe.ts is COMPLETE for input-driven work inside the script. This story re-probed one shape at one size, found it fast, and recorded the whole input-size class as closed. Two paths that are neither launcher-level nor a runtime timeout were found by looking for ten minutes: a quadratic separator scan reachable with a benign 64 KB command, and an allocation failure that aborts the process with a code the probe classifies as PROCEEDS. The enumeration is what Issue 308 will read to decide the gate is safe to wire, so an enumeration that says closed when the answer is open is more dangerous than the individual defects it hides.

## Go or no-go, and the single next action

no-go.

Single next action: fix the quadratic forward-whitespace walk in findLiveTrailingSensitiveSeparator (src/policy/normalizer/shell-scanner.ts lines 208 to 210) by resuming the outer loop past the whitespace run already walked, and land its named work-meter test (separator-scan-work-is-linear-on-trailing-whitespace) plus the two trailing-whitespace shapes in the latency corpus. Attacks 2, 3 and 4 then follow in the same round as record and instrument changes, none of which needs new design.

---

RECEIPT: verdict=no-go
attacks (ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] findLiveTrailingSensitiveSeparator (src/policy/normalizer/shell-scanner.ts 194-213) is quadratic on a trailing newline-dense whitespace run, so a benign 64 KB command makes the real hook exceed 30 s and 16 KB already crosses the 2000 ms OPS-03 budget: the same timeout fail-open Issue 304 names, at one fifth the input size, untouched by this diff; current defense none (the work meter covers only the two redirect entry points, the latency corpus carries only redirect shapes). Exposure: ~0% of live sessions today (hook unwired, verified), ~100% of post-activation Bash gate evaluations whose command text ends in roughly 8 KB or more of newline-dense whitespace, basis: measured.
2. [ISSUE][MED][code-traced] probe row input-size-timeout (src/qa/gate-fail-open-probe.ts:65) now records the whole input-size fault class BLOCKS with no activation precondition, and three records state that what remains is launcher-level only, while finding 1 is an in-script fail-open: SUR-10 enumeration says closed where it is open; current defense is prose scoping on the row note and the hook header, which the both-ways set-equality test does not read.
3. [ISSUE][MED][demonstrated] an allocation failure inside the hook aborts with exit 134, which classifyOutcome maps to PROCEEDS (measured: 512 KB and 2 MB commands with a 40 MB heap cap), and no RECORDED_DECISIONS row covers memory exhaustion; current defense none, and the CHANGELOG shows the same exit 134 was seen during the build and read as a symptom of the quadratic scan.
4. [ISSUE][MED][code-traced] the differential instrument builds its frozen oracle from quoteStates, escapedChars and tokenize imported from the module under test (src/qa/redirect-scan-differential.ts:26) while the diff rewrote the tokenizer core, so a scanTokens regression moves oracle and subject together and all 2,696,822 cases still report 0 mismatches; no live defect (closed independently by finding 5); current defense is indirect coverage from the unmodified scanner tests and 56 of 56 shipped mutants.
5. [CLEAN][demonstrated] output equality of the new linear scan against the WHOLE old module over 11 exported functions and 1,563,236 cases in 8 classes unlike the shipped ones (exhaustive to length 8 on three alphabets, length 6 on eight symbols, unicode and control characters incl. NUL, no-break space, byte-order mark, surrogate pairs and combining marks, a 400k-case redirect grammar, 1.4 to 2 KB mixed strings): 0 mismatches, and the firstTokenFrom precondition is unviolatable by both call sites by construction.
6. [CLEAN][demonstrated] no other superlinear site in the gate path: 11 further shapes flat from 16 KB to 256 KB through the real hook (117 to 221 ms), redirect family linear to 8 MB (254 ms at 128 KB, 4554 ms at 8 MB), deny decision stays 283 to 285 bytes so the sliced-string design never flattens, shipped latency instrument p99 350.42 ms against 2000 ms.
7. [CLEAN][demonstrated] the two new fail-closed mechanisms are each pinned: removing the stdout error listener fails 1 of 16, replacing the awaited write with a bare write fails 4 of 16, bypassing the gate module fails 15 of 22.
8. [CLEAN][demonstrated] the AC-H13 documenting-comment workaround masks nothing: the comment is only a name-discovery step, and deleting it fails AC-H13 (1 of 14) while keeping it and bypassing the gate module fails 15 of 22; the real verification is a mark file plus a pass-through control.
9. [CLEAN][demonstrated] mutation sensitivity of the new scan: suffix offset ignored 34 of 182 red, inclusive binary-search comparison 32 of 182 red (differential reported 12 mismatches), fd-dup word read one character early 17 of 182 red; the one survivor is provably equivalent (174,762 cases, 0 mismatches with it applied), not a coverage hole.
10. [SUSPICION][LOW][derived] the three AP-13 residual rows name the launcher as owner but not which of two mechanisms closes them (environment sanitising versus mapping any non-zero non-2 exit to 2); the stronger one also closes finding 3; resolves as one line on Issue 308, not a test.
11. [SUSPICION][LOW][demonstrated] the deny decision reflects command text roughly one-for-one for surviving tokens (262,396 bytes for a 262,149-character command, 87,634 bytes for a 256 KB quote-dense command); pre-existing, outside this diff, recorded so it is not lost rather than charged to this story.
counts (CHECKSUM): issues=4 suspicions=2 clean=5
evidence (CHECKSUM): demonstrated=8 code-traced=2 derived=1
checks=npm test 1289 pass / 0 fail / 0 skipped; typecheck exit 0; lint exit 0; qa:mutation-shell 56 of 56 killed; redirect-scan-differential 2696822 cases 0 mismatches; gate-latency-budget p99 350.42ms under 2000ms (70 iterations); 7 further qa gates PASS (1 disclosed VACUOUS-PASS); my own differential 1563236 cases 0 mismatches; 8 mutants applied and reverted, 7 killed 1 provably equivalent; working tree verified clean after reverting
adr=HIT(2)
report=docs/reviews/s7a-gate-hook-robustness-red-team-2026-09-26.md
