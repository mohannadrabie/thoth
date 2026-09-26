# Red Team (Sutekh) - s7a-gate-hook-robustness, round 2 RE-CONFIRM of the fix-now delta

- Date: 2026-09-26
- Scope: story s7a-gate-hook-robustness, Issues 303 and 304, plus the round-1 review Issues 321 (HIGH), 322, 323 and 324
- Branch: fix/s7a-gate-hook-robustness. Delta reviewed: ff93aab..bc5def6 (19 files, 1505 insertions, 191 deletions)
- Reviewed at bc5def6 in an isolated worktree, detached HEAD, adr submodule initialised
- Tier: CRITICAL (ratified, docs/.maat-state.json)
- Round 1 report: docs/reviews/s7a-gate-hook-robustness-red-team-2026-09-26.md
- ADR cache: BUILT, cataloged 2 ADR(s), CACHE=HIT. Attack-surface slice read from adrCatalog.adrs in docs/.maat-state.json: THOTH-ADR-0001 (committed-fixture standing exception) and THOTH-ADR-0002 (value-scoped secret-scan allowlist entries). Neither is touched by this delta: no file under docs/qa/ changes, no allowlist entry changes, and no new code hardcodes a committed fixture entry name. No ADR violation found.
- Read-only on production code. Seven mutants were applied in this worktree and each was reverted; the tree was verified clean afterwards with git status --porcelain (empty) and git diff --stat HEAD (empty).

## Verdict

go. The round-1 HIGH is fixed, and the fix is proven equivalent both by an instrument I built with a different generator family and by the shipped one. The three MED findings are closed with real mechanisms, not wording. Two LOW findings remain and neither gates: the deterministic work meter can be blinded by deleting one unguarded line (the wall-clock backstop still catches the regression, just very slowly), and the residual register enumerates the weak form of hook tampering but not the strong one.

## What this delta got right (assessed, not flattered)

- The fix to the separator scan is one statement, and it is the right one. I could not find an input on which it changes the answer.
- The frozen oracle is now what its header claims: import-free, byte-identical to the base-commit scanner, and pinned by a hash I recomputed myself. A tokenizer-core regression makes the instrument fail loudly instead of moving with the subject.
- The memory-exhaustion row is not a bare PROCEEDS assertion. Its control run under the same heap cap must decide normally, and a test asserts exactly that, so the row cannot silently degrade into "the heap cap alone breaks everything".
- The records disclose their own stale artefact. The decisions addendum states plainly that the immutable plan sections 12 and 13 are now wrong, and tells the Manager which list to use on Issue 308 instead. That is the correct handling of an append-only record whose source document cannot be edited.

## Attack 1 - CLEAN - is the new separator scan output-identical to the base module for every input?

Status: SURVIVES. Evidence: demonstrated.

The whole behavioural change is one added loop-stop in the private scan helper in src/policy/normalizer/shell-scanner.ts: when the forward whitespace walk from a candidate reaches the end of the text, the scan stops instead of advancing the outer loop by one and re-walking the same run. The equivalence argument is short enough to state and check by hand: everything after the candidate is whitespace, a later candidate must be a newline or a lone ampersand, an ampersand is never whitespace, so only a newline can be a later candidate, and every such candidate's own forward walk also reaches the end and also returns nothing. The one subtlety I checked is that the inner walk tests the whitespace class WITHOUT consulting quote state, so a run may include whitespace inside a quoted span; that does not break the argument, because the only character that could be a later candidate is still a newline.

The other change in that function is that it now takes the quote states and the escape marks from ONE walk instead of two separate public calls. I verified that is a pure deduplication: the public escape-mark accessor returns exactly the escape array of the same single walk.

I attacked the claim with a generator family deliberately unlike the shipped corpus, against the true base module taken from the default branch. I first proved that oracle is the same bytes the delta froze: the frozen copy's body from its eighth line onward is byte-identical to the base-commit scanner (diff, no output), and its sha256 over line-ending-normalised bytes recomputes to the value pinned in src/qa/redirect-scan-differential.test.ts.

Fourteen exported functions compared per case by deep equality. Raw output:

    functions compared per case: 14 -- escapedChars, extractRedirectTargets, findLiveChainOperator, findLiveRedirectOperatorPositions, findLiveSubstitution, findLiveTrailingSensitiveSeparator, hasLiveChainOperator, hasLiveSubstitution, hasUnterminatedQuote, normalizeToolToken, quoteStates, stripHeredocBodies, tokenize, tokenizeWithOffsets
    F1 exhaustive maxlen 8 over newline amp space semicolon      : 87381 cases
    F2 exhaustive maxlen 6 over newline NBSP backslash squote amp : 19531 cases
    F3 exhaustive maxlen 6 over CR VT FF NUL amp                 : 19531 cases
    F4 20 ws classes x run 0/1/2/3/7 x 30 heads x 13 tails       : 39000 cases
    F5 ws runs inside quotes/heredocs/substitutions/escapes       : 1932 cases
    F6 seeded random multi-char pieces                           : 400000 cases
    F7 long structured plus trailing run                          : 3000 cases
    F8 break-boundary probes, separator before/after runs         : 5760 cases
    TOTAL: 576135 cases, 0 mismatches, 17.0 s

That is 8065890 function comparisons. What each class was aimed at, since a corpus without an attack model is decoration:

- F1 to F3 are exhaustive over three alphabets the shipped corpus does not use: the separator alphabet alone to length 8, and two length-6 spaces that mix a newline with a no-break space, a backslash and a quote, and with the carriage return, vertical tab, form feed and NUL characters. The NUL character matters because it is NOT in the whitespace class, so it terminates a run and forces the other branch.
- F4 crosses twenty whitespace classes (space, tab, carriage return, the carriage-return-plus-newline pair, vertical tab, form feed, NUL, no-break space, Ogham space mark, two further Unicode spaces, line separator, paragraph separator, narrow no-break space, medium mathematical space, ideographic space, byte-order mark, Mongolian vowel separator, zero-width space, newline) at run lengths 0, 1, 2, 3 and 7, after thirty head forms (unterminated quotes of both kinds, heredocs, substitutions, fd-dup forms, escaped operators, a bare separator, the empty string) and before thirteen tail forms (nothing, each separator, live content, a backslash-newline continuation, a lone backslash, a lone quote, a NUL). Run lengths 0 and 1 are the boundary cases the added loop-stop is most likely to get wrong.
- F5 puts the same runs INSIDE a double-quoted span, a single-quoted span, an unterminated span of each kind, a command substitution, a backtick substitution, a heredoc header, a heredoc body, and immediately after a live backslash.
- F6 and F7 are seeded random over fifty-one multi-character pieces including the backslash-newline continuation and all twenty whitespace classes, at up to fourteen pieces and at 800 to 4000 characters with a trailing run appended.
- F8 walks the boundary directly: a separator before the run, after the run, on both sides, and with live content beyond, at run lengths 1, 2, 3, 4, 8 and 33.

Because a difference can also hide at a size no small corpus reaches, I ran a second, size-focused equivalence pass on the separator function alone, against the same base module, at 2, 8 and 32 KB. Raw output:

    large trailing-run equivalence: 2592 cases at 2/8/32 KB (18 whitespace classes x 8 heads x 6 tails), 0 mismatches, 324.1 s

The 324 seconds are the base module's own quadratic cost on those inputs, which is an incidental second confirmation of what was fixed.

My instrument is not vacuous, and I proved that rather than asserting it: with the tokenizer core mutated (attack 4, mutant MU7) it reported 103929 mismatches over the same 576135 cases.

## Attack 2 - CLEAN - the round-1 HIGH shape through the REAL hook at 16, 64, 128 and 512 KB

Status: SURVIVES. Evidence: demonstrated.

Real hook, spawned exactly as the sandbox helper hooks/test-support/gate-sandbox.ts spawns it (fresh cold process, JSON payload on stdin, 30 s spawn timeout), six trailing-whitespace shape families, four sizes each. Every run ended in a decided deny of 257 bytes. Milliseconds at 16 / 64 / 128 / 512 KB, raw:

    newline-dense       137 / 153 / 177 / 264
    crlf                127 / 141 / 157 / 272
    mixed-ws            126 / 141 / 159 / 266
    nbsp-dense          138 / 138 / 155 / 237
    u2028-dense         157 / 143 / 168 / 249
    unicode-ws-mixed    140 / 158 / 163 / 271

Round 1 measured the same newline-dense shape at 2294 ms at 16 KB and no exit inside 30 s at 64, 128 and 256 KB. Nothing is now above 272 ms at four times the largest size round 1 could reach at all. The OPS-03 ceiling is 2000 ms; the worst of these twenty-four runs is about seven times under it.

The shipped guards agree, and I ran them rather than reading them:

    [OPS-03 gate-latency-budget-check] PASS: OPS-03: measured p99 (318.06ms) stays under the declared 2000ms latency budget.
      - iterations=100 min=204.04ms p50=270.81ms p95=308.03ms p99=318.06ms max=318.06ms ceiling=2000ms

The iteration count rose from 70 to 100 because the corpus in src/qa/gate-latency-budget-check.ts gained the three 128 KB trailing-whitespace entries built by src/qa/trailing-whitespace-shapes.ts. The probe row is real too: the live probe run reports the trailing-whitespace row as BLOCKS with all three shapes at exit 0 and a 257-byte decision.

## Attack 3 - CLEAN - further superlinear behaviour anywhere in the gate path, including shapes the sweep does not enumerate

Status: SURVIVES. Evidence: demonstrated.

The shipped sweep in src/qa/gate-path-scaling-sweep.ts enumerates its shapes from the scanner's own operator tables plus a fixed whitespace list, which means its blind spots are structural rather than operator-level. I built thirty shapes aimed at exactly those blind spots and measured them through the REAL hook at 16, 64, 128 and 512 KB: 120 cold-process spawns. Raw summary line:

    OVER-2000ms COUNT: 0

The full range over all 120 runs is 123 to 349 ms. The shapes, beyond the six in attack 2: a NUL character between newlines (a run that does not reach the end), an ampersand before a newline run, a newline run before an ampersand, an alternating ampersand-newline run, an alternating semicolon-newline run, a backslash-newline continuation run, a newline run inside an unterminated double-quoted span, a newline run inside a closed single-quoted span, a newline run after a redirect, deeply nested command substitutions, deeply nested alternating quotes, one huge single token, a very long argument word list, many short lines, many heredocs, a long here-string, a dense run of unterminated quotes, a dense run of unbalanced substitution markers, a dense backtick run, a dense brace-expansion run, a dense quote-pair run and a dense escape run.

Because the shell normalizer recurses into a wrapper's inner command (depth cap 5), a shape can also multiply the scan count. I measured thirty-one further real-hook spawns over nested wrapper forms carrying the pathological tail, plus the deferred-execution wrappers and heredoc shapes:

    nest1-newline-tail   len=32788    ms=145    nest1-newline-tail  len=262164   ms=209
    nest3-newline-tail   len=81968    ms=148    nest3-newline-tail  len=655408   ms=325
    nest5-newline-tail   len=278640   ms=209    nest5-newline-tail  len=2228336  ms=813
    nest8-newline-tail   len=2114120  ms=707    nest8-newline-tail  len=16908872 ms=5857
    nest5-glued-redirect len=131179   ms=290
    nest5-amp-newline    len=1179760  ms=520
    xargs-newline-tail   len=524304   ms=239
    nohup-amp-tail       len=524306   ms=262
    eval-newline-tail    len=524303   ms=249
    heredoc-then-newline-tail len=524306 ms=256
    heredoc-body-newlines     len=524300 ms=141
    OVER-2000ms COUNT: 1
    OVER nest8-newline-tail len=16908872 ms=5857

The single over-budget run is a 16.9 MB command, which is what eight levels of wrapper quoting does to a 128 KB inner command. It is not superlinear: 132 times the input of the 262164-character run costs 28 times the time. That matches round 1's finding that the redirect family stays linear to 8 MB, and 16.9 MB is far outside the largest realistic input the story declares. Its decision also stays 224 bytes, because the depth cap resolves to an unresolved deny.

Assessed honestly: this is the strongest part of the delta. Across 151 real-hook spawns of my own plus the shipped sweep's 7200 in-process calls, I found no shape whose cost is not flat in the input size.

Raw shipped-sweep output, which I ran:

    [S7-A gate-path-scaling-sweep] PASS: gate-path scaling sweep: 15 exported functions x 160 shapes x 3 sizes (16, 64, 128 KB), 7200 calls, none over the 1000 ms bound.

Slowest single call in that run: 41.8 ms, the shell normalizer entry point on a 131074-character spaced redirect-token run. The separator scan's own slowest is 8.8 ms.

## Attack 4 - CLEAN - is the frozen oracle truly self-contained and byte-pinned, and does the whole-module differential bite?

Status: SURVIVES. Evidence: demonstrated.

Three independent checks, all run:

1. Self-containment, checked against the file rather than the claim. src/qa/frozen-shell-scanner-s7a-base.ts has no import line at all (a grep for import and for from returned nothing). src/qa/redirect-scan-differential.ts imports the module under test only as one namespace, compared as a whole and never used to build the oracle; the structure test in src/qa/redirect-scan-differential.test.ts pins that import set in both directions and forbids a named import from the scanner.
2. Byte-pinning, recomputed rather than trusted. The pinned sha256 in the test is 3d406c8afa783f3c7eced75ae8346b04849c34215d1a4e47cb2c4290452ca37e and my own recomputation over line-ending-normalised bytes returned the same value. I also confirmed the pin is over the RIGHT bytes: the frozen file from line 8 onward diffs clean against the base-commit scanner. A single added comment token in the frozen file (mutant MU6) fails that test: 8 tests, 7 pass, 1 fail.
3. Does it bite? Mutant MU7 flips one quote-state comparison inside the shared tokenizer core, in the backslash branch, so an escaped character inside a single-quoted span is consumed instead of kept. That is a mutation the shipped self-containment test does not itself use. Raw output of the shipped instrument with MU7 applied:

    [S7-A redirect-scan-differential] FAIL: scanner differential: 183544 of 2975315 cases differ from the frozen old module; 0 coverage problem(s).
      - C1 exhaustive (every string of length 0 to 7 over 8 symbols; redirect scans): 2396745 cases x 2 function(s), 77424 mismatches
      - C2 seeded random (1 to 80 characters over a 24-entry alphabet; redirect scans): 200000 cases x 2 function(s), 43091 mismatches

My own independent instrument reported 103929 mismatches on the same mutant. So the oracle cannot move with the subject, and both instruments are non-vacuous.

Clean-tree run of the shipped instrument, for the record:

    [S7-A redirect-scan-differential] PASS: scanner differential: 2975315 cases, 9292546 function comparisons over 14 exported functions, 0 mismatches: identical outputs on these corpora (not a proof over all strings).

The function set is enumerated from both modules at run time and the adapter table is checked in both directions, so a function added to the scanner later fails the instrument until it is covered. The instrument also runs inside npm test (its report is built at module scope in the test file), so it is gated in CI even though it has no dedicated CI step of its own.

## Attack 5 - CLEAN - the fail-closed path against hostile error values

Status: SURVIVES. Evidence: demonstrated.

The delta moved the error-name lookup inside the try whose finally exits 2. I attacked it with eleven hostile shapes, each planted as a project module inside a fresh sandbox copy so the catch inside the hook meets the value. Raw output, abbreviated to the fields that matter:

    proxy-get-trap-throws              code=2 outLen=0 stderrLen=219
    thrown-string-primitive            code=2 outLen=0 stderrLen=219
    thrown-null                        code=2 outLen=0 stderrLen=219
    thrown-undefined                   code=2 outLen=0 stderrLen=219
    name-getter-throws-string          code=2 outLen=0 stderrLen=219
    name-getter-returns-huge           code=2 outLen=0 stderrLen=219
    name-getter-returns-path           code=2 outLen=0 stderrLen=219
    name-is-proxy-string               code=2 outLen=0 stderrLen=219
    toPrimitive-throws                 code=2 outLen=0 stderrLen=219
    getter-throws-itself-recursive     code=2 outLen=0 stderrLen=219
    name-getter-calls-process-exit-0   code=0 outLen=0 stderrLen=0

Ten of eleven exit 2 with the same fixed 219-byte line and nothing on stdout. Two of those deserve a note: the getter returning 100000 letters and the getter returning an absolute path both still produce exactly 219 bytes, so the letters-only length-capped name filter holds and neither the length nor the path reaches the model-visible channel.

The eleventh is discussed as finding 7 below. It is not a defect in the fail-closed path: a value whose name getter calls the process exit function with status 0 requires an attacker who already controls a module inside the module graph of the hook, and such an attacker can edit the hook itself.

The mechanism is also pinned by a test, which I verified by mutation. MU5 makes the inner catch rethrow instead of falling back to the bare type: launch tests report 9 tests, 8 pass, 1 fail, and the failing test is the new one this delta added.

## Attack 6 - CLEAN - are the two new PROCEEDS residual rows honestly recorded, and are the CURRENT records accurate for the Issue 308 comment?

Status: SURVIVES. Evidence: code-traced, with the probe rows read from a live run.

Live probe output, run by me. Every row and its observed outcome, raw:

    BLOCKS    node-without-ts-type-stripping
    BLOCKS    import-target-missing
    PROCEEDS  interpreter-not-on-path                    exit=1
    PROCEEDS  node-options-bad-flag                      exit=9
    PROCEEDS  systemroot-nonexistent                     exit=134
    BLOCKS    empty-stdin
    BLOCKS    invalid-json-stdin
    BLOCKS    numeric-tool-name
    BLOCKS    unroutable-tool-name
    BLOCKS    unclassified-mcp-tool
    BLOCKS    input-size-timeout
    BLOCKS    input-size-timeout-trailing-whitespace     newline-dense: exit=0 stdout=257 bytes; crlf: exit=0 stdout=257 bytes; mixed: exit=0 stdout=257 bytes
    PROCEEDS  memory-exhaustion                          exit=134 stdout=0 bytes control=ok (small denied payload, same heap cap: exit=0)
    PROCEEDS  hook-script-unparseable                    exit=1
    BLOCKS    corrupt-project-policy

Assessed point by point against the round-1 findings:

- Round-1 finding 2 (the input-size class recorded closed from one shape) is closed properly. The class is split into two rows by code path, each probed, each BLOCKS, and the trailing-whitespace row is BLOCKS only when all three of its shapes are. A test asserts the split, the per-shape notes, the Issue number and the observed outcome.
- Round-1 finding 3 (memory exhaustion unenumerated) is closed as a recorded PROCEEDS residual, and better than I asked for: the row carries a control run under the same heap cap, and a test asserts the control decided normally, so the row cannot pass on a heap cap that breaks everything. The note also records the second-order effect I flagged, that the abort writes a runtime heap report to stderr which the fixed-line rule of the hook does not cover.
- The retired overclaim is gone from code and pinned against return. A grep across the repository finds the phrase only in the immutable plan, in the round-1 report, in the REVIEW_LOG row and inside the test that forbids it. A test reads both the hook and the probe header and fails if either says the residual set is launcher-level only, or omits the memory-exhaustion residual, the unparseable-script residual or the trailing-whitespace input-size shape.
- The plan-versus-record inconsistency the Manager asked about is disclosed, not hidden. The decisions addendum item 1 states that the plan section 13 sentence reading the separator scan as linear was a code read and was wrong; item 7 states that the plan is not edited, that the section 12 draft comment is stale, and that the comment the Manager posts on Issue 308 must use the five-row residual list from the addendum instead. I checked the plan: the section 12 draft and the section 13 sentence are both still there, exactly as disclosed.
- The additional residual class this delta adds, the unparseable script, is honestly probed: exit 1 from a copy of the hook with one stray closing brace appended, inside a throwaway tree.

So the Issue 308 comment text is accurate PROVIDED it uses the five-row list from the addendum rather than the section 12 draft, and provided it does not claim that mapping every exit other than 0 and 2 to 2 closes hook tampering in general. See finding 7.

## Attack 7 - CLEAN - new raw echo or leakage in the delta

Status: SURVIVES. Evidence: code-traced.

I read every added line in the delta that writes to a channel. The hook itself gains no new output: the only change to its writing behaviour is that the error-name lookup moved inside the try, and the stderr line is unchanged and still fixed-length (measured at 219 bytes across all eleven hostile shapes in attack 5). Nothing new reaches stdout.

The new QA code writes only to instrument channels, and what it writes is bounded and non-session data:

- The probe detail for the memory-exhaustion row prints the first 60 characters of the stderr of the child, which is the runtime heap report, and the stdout LENGTH rather than its content. The trailing-whitespace row prints exit codes and stdout lengths only.
- The sweep prints shape names built from operator tokens parsed out of the scanner source and from its own fixed whitespace list, never command text from a session.
- The differential prints at most three mismatch examples per class, each with the input truncated to 200 characters. That is a failure diagnostic in a QA instrument, bounded, and only on failure.

No new path, stack frame or session payload reaches a model-visible channel.

## Finding 8 - LOW - the deterministic work meter can be blinded by deleting one unguarded line

Status: BREAKS (the instrument, not the shipped behaviour). Evidence: demonstrated.
Exposure: every future change to the separator scan in src/policy/normalizer/shell-scanner.ts, guarded by the wall-clock backstop rather than by the primary proof. basis: counted in code (one un-mutated meter increment).

The records name the deterministic work meter the primary scaling proof and the wall-clock cases the second guard. That ordering is right, and the meter does work. But the meter increment that accounts for the inner whitespace walk is itself unguarded, and removing it costs nothing that any test can see.

Mutants, each applied to this worktree, named test files run, then reverted. Counts are from the run:

- MU1, the loop-stop deleted so the whitespace run is re-walked per newline (the shipped mutation registry has this exact mutant): src/policy/normalizer/shell-scanner-work.test.ts reports 10 tests, 7 pass, 3 fail. KILLED, as designed.
- MU2, the inner-walk meter increment deleted, loop-stop left in place: the scanner work, scanner, linear-scan and differential test files together report 129 tests, 129 pass, 0 fail. SURVIVED. The scan still returns the same answers, so this changes no output; what it changes is what the meter can see.
- MU3, MU1 and MU2 together: src/policy/normalizer/shell-scanner-work.test.ts reports 10 tests, 10 pass, 0 fail. The scan is quadratic again and the primary proof is green.

Why: with the loop-stop present the outer loop runs only until the first candidate, so the per-character increment in the outer loop contributes about eleven characters on the trailing shapes, and the whole meter reading comes from the single quote walk. The assertions are that the meter is at least the text length and at most four times it, and a reading of exactly the text length satisfies both. Delete the inner-walk accounting and the meter stops being a measure of the work the function does.

Current defense, honestly assessed: it holds, but slowly. With MU3 applied, src/qa/gate-path-scaling-sweep.test.ts reports 5 tests, 2 pass, 3 fail, including the non-vacuity case that hands the sweep the old quadratic scan. So the regression IS caught. The cost is wall clock: that file runs in 17.0 seconds on the clean tree and took about 46 minutes to fail under MU3, because the sweep only compares against its 1000 ms bound AFTER each call returns and 83 of its 160 shapes are pathological for this fault (counted by script). In CI that is a job that appears to hang rather than a test that fails.

One related survivor, recorded so it is not mistaken for coverage: MU4 changes the scoped meter helper to clear the active meter in its finally instead of restoring the previous one. 121 tests, 121 pass. That is an equivalent mutant today, because no shipped caller nests metered entry points, and the meter is test-only scaffolding; it is worth one line of awareness, not a fix.

Named proof-test required (not gating, one failing test):
- Name: separator-scan-meter-counts-the-inner-whitespace-walk, in src/policy/normalizer/shell-scanner-work.test.ts. On a trailing newline-dense shape, assert the reported work is at least about twice the text length, which is only true if the inner walk is accounted for; and register the deleted-increment mutant in src/qa/shell-detector-mutants.ts beside the existing re-walk mutant, so the meter guards itself.
- Cheap hardening of the backstop, optional: give the sweep a per-shape early exit or measure the first size before the larger ones for every function, so a quadratic regression fails in seconds rather than in tens of minutes.

## Finding 9 - LOW - the residual register enumerates the weak form of hook tampering, not the strong one

Status: BREAKS (the enumeration, not the code). Evidence: demonstrated, with the record text code-traced.
Exposure: unquantified for real runners; the fault itself is reproducible on demand. basis: assumption for how often a runner or checkout is compromised, which caps this at LOW.

The new hook-script-unparseable row names its triggers as corruption, a bad merge, and tampering. Its stronger sibling is not enumerated: a project module inside the graph of the hook that RUNS and exits 0. Demonstrated in attack 5, the eleventh shape: exit 0, empty stdout, no stderr, which on this contract is a silent allow.

Why it matters for the wording rather than for the code: the residual notes and the decisions addendum both say that one launcher form, mapping every exit other than 0 and 2 to 2, closes all five AP-13 rows. That is true of those five. It is NOT true of tampering in general, because an exit of 0 with empty stdout is the allow signal and the mapping leaves it untouched. A reader of the residual register who sees tampering named under the unparseable-script row can reasonably conclude the launcher mapping covers tampering; it covers only the subset that fails to parse or fails to start.

Current defense, honestly assessed: nothing in the gate, and nothing can be. This is the class the S7 self-protection milestone exists for, and the repository already has structural gates around the hook manifest and command path. No in-script mechanism can defend against arbitrary code inside the graph it loads.

Resolution (a residual-register line, not a test, and not a gate):
- One line on Issue 308 or on the S7 self-protection milestone stating that the launcher exit mapping closes the five enumerated AP-13 rows and does NOT close a tampered in-graph module that exits 0, and that the countermeasure for that class is integrity of the checkout rather than anything the hook can do.

## Finding 10 - LOW SUSPICION - the deny decision can be about twice the command length, and crossed a one-megabyte reader buffer in my harness

Status: UNPROVEN for its reach, demonstrated for the size. Evidence: demonstrated (size), derived (impact).
Exposure: commands whose tokens survive normalization; measured, not estimated. basis: measured for the size, assumption for whether any real reader caps its buffer.

This sharpens round-1 suspicion 11 with a worse ratio than round 1 reported. A command that is a single-quoted span containing only newline characters yields a decision roughly TWICE the command length, not one for one. Raw, real hook:

    len=16007  code=0    outLen=32252
    len=130007 code=0    outLen=260252
    len=400007 code=0    outLen=800252
    len=524288 code=null outLen=1048814 stderr="spawn error: Error: spawnSync ... ENOBUFS"

The last line is my harness, not the hook: the default one-megabyte buffer of the synchronous spawn helper was exceeded, so the harness reported no exit status. I state that plainly rather than dressing it up as a timeout. The hook itself produced 1048814 bytes of a valid decision.

What is unproven and why it stays a suspicion: whether the real session runtime that reads this stdout caps its buffer, and what it does when a decision is truncated. If it truncates, an unparseable stdout with exit 0 is an allow on this contract. I have no way to measure that from here, and the hook is unwired, so nothing is live.

This is pre-existing behaviour outside this delta (the delta does not touch decision rendering) and the decisions addendum already records round-1 suspicion 11 as standing. It resolves as a backlog line or its own Issue, decided by the Manager, not in this diff.

## Gates re-run on this branch (raw)

    npm test                                tests 1324, pass 1323, fail 1, cancelled 0, skipped 0, todo 0, duration_ms 187281.4671
    npm run typecheck                       tsc --noEmit, no output, exit 0
    npm run lint                            eslint ., no output, exit 0
    npm run qa:mutation-shell               [QA-06 shell-detector-mutants] PASS: 59 of 59 mutant(s) KILLED.
    node src/qa/redirect-scan-differential.ts  PASS: 2975315 cases, 9292546 function comparisons over 14 exported functions, 0 mismatches
    node src/qa/gate-path-scaling-sweep.ts     PASS: 15 exported functions x 160 shapes x 3 sizes, 7200 calls, none over the 1000 ms bound
    node src/qa/gate-latency-budget-check.ts   PASS: p99 318.06ms under the 2000ms budget (iterations=100)
    npm run qa:kernel-purity                PASS: 4 production files under the kernel root, zero violations
    npm run qa:normalizer-registry-purity   PASS: zero dispatch-chain or sibling-import violations
    npm run qa:gate-command-path            PASS: 2 command-type hook entries, every referenced script resolves
    npm run qa:gate-matcher-drift           PASS: 19 referenced tool names, all present in the vendored snapshot
    npm run qa:gate-manifest                PASS: exactly 1 gate manifest, .claude/settings.json
    npm run qa:completeness-claims          PASS: 2 files checked, all completeness claims verified
    npm run qa:broken-instrument-gate       VACUOUS-PASS: 0 known-broken instruments registered (disclosed)

The single npm test failure is NOT this delta. It is the intermittent Windows temp-directory cleanup fault in src/secret-scan/pre-commit-scan.test.ts (a resource-busy error removing a fresh clone), already filed as Issue 293 per the 2026-09-24 decisions row. Re-run in isolation that file reports 26 tests, 26 pass, 0 fail. I am recording it rather than counting it against the delta.

Test-file runs I did myself, on the clean tree:

    src/qa/gate-fail-open-probe.test.ts      12 tests, 12 pass, 0 fail, 0 skipped, 13754.7 ms
    src/qa/gate-path-scaling-sweep.test.ts    5 tests,  5 pass, 0 fail, 0 skipped, 17020.9 ms
    src/secret-scan/pre-commit-scan.test.ts  26 tests, 26 pass, 0 fail, 0 skipped

## Mutants applied and reverted (7)

Each was applied to this worktree, the named test files were run, and it was reverted. Afterwards git status --porcelain was empty and git diff --stat HEAD was empty.

- MU1 separator loop-stop deleted (the shipped registry has this mutant): work test 10 tests, 7 pass, 3 fail. KILLED.
- MU2 inner-walk meter increment deleted: 129 tests across four files, 129 pass, 0 fail. SURVIVED (finding 8).
- MU3 MU1 plus MU2: work test 10 tests, 10 pass. Sweep test 5 tests, 2 pass, 3 fail, after about 46 minutes against 17.0 seconds clean. KILLED, slowly (finding 8).
- MU4 the scoped meter helper clears instead of restoring the previous meter: 121 tests, 121 pass. SURVIVED, provably equivalent today (no nested metered caller).
- MU5 the fail-closed inner catch rethrows: launch tests 9 tests, 8 pass, 1 fail, the new test. KILLED.
- MU6 one comment token added to the frozen oracle: differential tests 8 tests, 7 pass, 1 fail, the hash pin. KILLED.
- MU7 tokenizer-core backslash branch quote-state flipped: shipped differential FAIL with 183544 of 2975315 cases differing; my own instrument 103929 mismatches over 576135 cases. KILLED.

Five killed, two survived. Both survivors are output-equivalent: MU4 is equivalent in fact, MU2 is equivalent in behaviour and degrading only to the instrument, which is finding 8.

## Open findings and failing tests

Open findings: 2 (findings 8 and 9). Named executable form: 1 (finding 8, the meter test plus its registered mutant). Finding 9 has no executable form by design and resolves as a residual-register line on Issue 308 or the S7 self-protection milestone, because no in-script mechanism can defend against arbitrary code inside the graph the hook loads. Finding 10 is a LOW suspicion, pre-existing and outside this delta, and resolves as a backlog line or its own Issue at the discretion of the Manager. That accounting is the reason open findings (2) and failing tests (1) differ.

## Editorial (verdict-neutral, fix as plain edits, no re-review)

- The differential instrument and the scaling sweep have no dedicated CI step in .github/workflows/ci.yml, unlike the mutation harness and the latency budget check. Both DO run in CI, because each test file builds its report at module scope under npm test, so this is presentation rather than coverage. A named step would make a failure legible in the CI log without reading the test output.
- The sweep header states the bound is absolute and justifies 1000 ms with two orders of magnitude of headroom. The measured slowest call in a clean run is 41.8 ms, which is closer to 24 times of headroom than 100; the sentence is defensible as written about the quadratic cases it names, but a reader may take it as a statement about the current margin.
- src/qa/trailing-whitespace-shapes.ts cites the round-1 measurement of 2294 ms at 16 KB. That figure is now history rather than a property of the code; it reads correctly in context, and is worth keeping precisely because it dates the fault.

## The single scariest unproven assumption

That the deterministic work meter will still be a real measurement the next time someone edits this function. It is the artefact the records nominate as the primary scaling proof, it lives in the same function it measures, and one deleted line makes it report linear work for a quadratic scan without failing a single test. The backstop is a wall clock whose failure mode is a 46-minute test file rather than a red assertion. Nothing about the shipped behaviour is wrong today; what is fragile is the reason anyone will believe it is still right a year from now.

## Go or no-go, and the single next action

go. The round-1 HIGH is fixed and the fix is proven equivalent by two independent instruments and by 151 real-hook spawns; the three MED findings are closed with mechanisms rather than wording; the two remaining findings are LOW and neither gates a merge.

Single next action: add the named meter test separator-scan-meter-counts-the-inner-whitespace-walk and register the deleted-increment mutant beside the existing re-walk mutant, so the primary scaling proof guards itself. That is a follow-up, not a merge condition.

---

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [CLEAN][demonstrated] the round-1 HIGH (Issue 321) is fixed and the fix is output-identical to the base module: one added loop-stop, equivalence argument checked by hand including whitespace runs that cross quote spans, then 576135 cases x 14 exported functions (8065890 comparisons) in 8 classes built by a different generator family (three exhaustive alphabets to length 8 and 6, twenty whitespace classes including NBSP, Ogham, line and paragraph separators, byte-order mark, zero-width space, vertical tab, form feed, carriage return alone and NUL, runs of length 0/1/2/3/7 after thirty heads and before thirteen tails, runs inside quotes, heredocs, substitutions and after escapes, 400000 seeded piece strings, boundary probes) plus 2592 further cases at 2, 8 and 32 KB: 0 mismatches; the oracle is the true base module, proven byte-identical to the frozen copy and hash-recomputed; my instrument reports 103929 mismatches on a tokenizer mutant, so it is not vacuous.
2. [CLEAN][demonstrated] the same shape through the REAL hook at 16, 64, 128 and 512 KB across six trailing-whitespace families is flat at 126 to 272 ms with a 257-byte decision every time, against round 1 measuring 2294 ms at 16 KB and no exit inside 30 s at 64 KB and above; the shipped latency instrument now runs 100 iterations over a corpus that carries the three 128 KB trailing-whitespace entries and reports p99 318.06 ms against the 2000 ms ceiling.
3. [CLEAN][demonstrated] no further superlinear site in the gate path, including shapes the sweep does not enumerate: 30 shapes x 4 sizes = 120 real-hook spawns, 0 over 2000 ms, full range 123 to 349 ms (nested substitutions, nested quoting, one huge token, huge word list, many heredocs, long here-string, unbalanced quotes and substitution markers, backtick and escape density, runs inside quoted spans, NUL-interrupted runs, backslash-newline runs), plus 31 wrapper-recursion and heredoc spawns to depth 8 where the only over-budget run is a 16.9 MB command at 5857 ms and is sublinear, not quadratic; the shipped sweep passes 15 functions x 160 shapes x 3 sizes = 7200 calls with a slowest call of 41.8 ms.
4. [CLEAN][demonstrated] the frozen oracle is genuinely independent and byte-pinned: no import at all, body byte-identical to the base-commit scanner, sha256 recomputed to the pinned value, a one-token edit fails the hash test (1 of 8), and a tokenizer-core mutation the shipped test does not use makes the shipped instrument FAIL with 183544 of 2975315 cases differing, so the oracle cannot move with the subject.
5. [CLEAN][demonstrated] the fail-closed path survives eleven hostile error values (a throwing proxy get trap, a raw string, null, undefined, a name getter throwing a string, a name getter throwing itself, a name returning 100000 letters, a name returning an absolute path, a proxy pretending to be a string, a throwing primitive conversion): 10 of 11 exit 2 with the same fixed 219-byte stderr line and empty stdout, no length or path leak; the mechanism is pinned, since making the inner catch rethrow fails the new test (1 of 9).
6. [CLEAN][code-traced] the residual rows and records are honest: the input-size class is split per code path with both rows probed BLOCKS, the memory-exhaustion row carries a control run under the same heap cap that a test requires to have decided normally, the unparseable-script row is probed at exit 1, the retired overclaim is absent from code and pinned against return by a test over both headers, and the decisions addendum discloses that the immutable plan sections 12 and 13 are stale and names the five-row list the Issue 308 comment must use.
7. [CLEAN][code-traced] no new raw echo or leakage: the hook gains no new output and its stderr line is fixed at 219 bytes across every hostile shape; the new QA code prints bounded, non-session data only (stdout lengths not contents, 60 characters of runtime stderr, shape names parsed from the scanner source, and mismatch examples truncated to 200 characters on failure only).
8. [ISSUE][LOW][demonstrated] the deterministic work meter, which the records nominate as the primary scaling proof, can be blinded by deleting the one unguarded increment that accounts for the inner whitespace walk: that deletion survives 129 of 129 tests, and with it gone the shipped quadratic mutant also passes the work test 10 of 10; the wall-clock backstop still catches it (sweep test 3 of 5 red) but takes about 46 minutes against 17.0 seconds clean, because the bound is only compared after each call returns and 83 of 160 shapes are pathological. Exposure: every future change to the separator scan, basis: counted in code.
9. [ISSUE][LOW][demonstrated] the residual register names tampering as a trigger of the unparseable-script row but does not enumerate the stronger tamper form, an in-graph module that runs and exits 0 (demonstrated: exit 0, empty stdout, a silent allow), which the named launcher mechanism of mapping every exit other than 0 and 2 to 2 does NOT close; the record could be read as covering tampering generally. Exposure: unquantified for real runners, basis: assumption, which caps this at LOW.
10. [SUSPICION][LOW][demonstrated] the deny decision can be about twice the command length, not one for one as round 1 reported (32252 bytes for 16007 characters, 800252 for 400007), and at 524288 characters it produced 1048814 bytes which exceeded the default one-megabyte buffer of my own harness (an ENOBUFS in the harness, not a hook fault); whether any real reader caps its buffer, and what it does with a truncated decision, is unproven. Pre-existing, outside this delta, already recorded as standing from round 1.
counts (CHECKSUM): issues=2 suspicions=1 clean=7
evidence (CHECKSUM): demonstrated=8 code-traced=2 derived=0
checks=npm test 1324 tests / 1323 pass / 1 fail / 0 skipped (the one failure is the pre-existing intermittent Windows temp-cleanup fault in the secret-scan pre-commit tests, Issue 293; that file passes 26 of 26 in isolation); typecheck exit 0; lint exit 0; qa:mutation-shell 59 of 59 KILLED; redirect-scan-differential PASS 2975315 cases / 9292546 comparisons / 14 functions / 0 mismatches; gate-path-scaling-sweep PASS 7200 calls none over 1000 ms; gate-latency-budget PASS p99 318.06ms / 100 iterations / 2000ms ceiling; 7 structural qa gates PASS (1 disclosed VACUOUS-PASS); my own differential 576135 cases x 14 functions 0 mismatches plus 2592 large-run cases 0 mismatches; 151 real-hook spawns, 1 over 2000 ms at 16.9 MB and sublinear; 11 hostile fail-closed shapes, 10 exit 2; frozen-oracle sha256 recomputed equal to the pin; 7 mutants applied and reverted, 5 killed, 2 provably equivalent; working tree verified clean after reverting
adr=HIT(2)
report=docs/reviews/s7a-gate-hook-robustness-red-team-round2-2026-09-26.md
