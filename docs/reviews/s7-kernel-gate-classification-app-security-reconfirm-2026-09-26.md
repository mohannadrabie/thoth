# App-security RE-CONFIRM: s7-kernel-gate-classification, fix-now round (Issues #93, #288, #107, #303)

[app-security-reviewer]
App Security Reviewer (Horus) - reviewing for exploitable weakness

- Date: 2026-09-26. Tier: CRITICAL. Sensitive area: PreToolUse hook and gate. Targeted re-confirm of my earlier report (docs/reviews/s7-kernel-gate-classification-app-security-2026-09-26.md, findings 1, 4, 5) and the red-team report (docs/reviews/s7-kernel-gate-classification-red-team-2026-09-26.md, attacks 1 to 4).
- Head d81d86d (git reset --hard d81d86d in my own worktree, git log -1 --oneline shows d81d86d, submodule initialised, npm ci run because node_modules was missing). Reviewed only the delta d0f5978..d81d86d (16 files, 226 insertions, 27 deletions; production code in hooks/pretooluse-kernel-gate.mjs, src/policy/gate/decide-tool-call.ts, src/policy/normalizer/tool-class-format.ts, src/qa/gate-fail-open-probe.ts, src/qa/gate-latency-budget-check.ts).
- ADR cache: 📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]. No security ADR rule is violated by this delta (it narrows what the gate reflects and admits; it adds no allow path, no second decision path, no secret, no dependency). No new package in package.json; npm ci reports 0 vulnerabilities.
- Read-only. I edited only this report and appended my docs/REVIEW_LOG.md row. git status after all probes shows only docs/.maat-state.json, written by docs/adr-cache.mjs --ensure. Probe scripts and the mutation copy live in the session scratchpad, not in the repo.

## Verdict: APPROVE

Every fix in the round does what it says, and each guard is pinned by a named test that goes red when the guard is reverted. I found no HIGH or MED defect and no new leak, fail-open path or dependency. Three LOW items are hardening notes, none blocking.

Reach, stated honestly: the hook is unwired (.claude/settings.json has no PreToolUse entry), so today the delta is reachable by the operator, the test suite and the QA instruments only. If activated, the redaction, charset and cap fixes apply to every gated call. The AP-13 launch-failure family (NODE_OPTIONS, SYSTEMROOT) is still a recorded activation blocker, correctly recorded as PROCEEDS rather than claimed fixed.

Single next action: the Manager records the three LOW notes in the residual register (none needs a fix before merge) and proceeds to the merge handoff for the human.

## 1. Exit-2 stderr redaction (my finding 4): closed, demonstrated

Real hook copies run in the test sandbox (the test-writer helper, unedited):

| Input | Exit | Stdout | Stderr |
|---|---|---|---|
| invalid JSON stdin carrying the text CANARYX | 2 | empty | pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2): SyntaxError |
| empty stdin | 2 | empty | same prefix, Error |
| malformed classification fixture, reached through an MCP call (CANARY-BROKEN in the file) | 2 | empty | same prefix, SyntaxError |
| payload nested 5,000 and 200,000 arrays deep (stack overflow) | 2 | empty | 81 characters, fixed message |
| malformed project policy (raw text, binary bytes, wrong shape, missing file) | 0 | deny JSON | reason names only layer and kind, for example: policy load failed: layer project, kind json-parse-error; fail-closed |
| the real hook in the repo, malformed stdin and empty stdin | 2 | empty | fixed message plus SyntaxError or Error |

No absolute path, stack frame or parser text and no fragment of the input reaches stderr; exit 2 and a non-empty stderr are preserved, so locked AC-6 stays green (whole suite below). A malformed project policy never reaches the exit-2 path: the loader returns a typed failure and the gate emits a deny JSON, unchanged by this delta. The printed name comes only from err.name of errors thrown by JSON.parse, the stdin reader and the ports; no code path lets input text choose it. The other stderr writer in the adapter (the failClosed line in src/policy/gate/render-hook-output.ts) interpolates internal enum values, not input, and is outside this delta.

## 2. MCP tool-segment charset (red-team 4, my finding 5): closed, demonstrated

parseMcpToolName now requires the tool segment to match letters, digits, underscore and hyphen only, anchored at both ends. JavaScript end anchor without the multiline flag does not match before a trailing line feed, so a tool ending in a line feed is rejected (proved below, not assumed). Probe through the real hook with server docs classified read-only, posture deny, plus a class-only allow rule:

- Controls resolve and are silently allowed (exit 0, empty stdout, empty stderr): docs__x, docs__echo_tool-X9, a 64-character tool, a 5,000-character tool.
- Each of these is unresolved and denied by POL-05 (exit 0, deny JSON, constant 69-character reason, nothing reflected): trailing space, NUL, line feed, carriage return, tab, zero-width space, zero-width joiner, byte-order mark, Cyrillic small e and Cyrillic small ha, fullwidth x, dot, empty tool, leading underscore, double underscore, slash, backslash, e-acute, a lone surrogate, an emoji pair, colon, plus, a 100,000-character tool ending in a space, a server segment with a space and a zero-width space, a server segment with a slash, bare mcp__, mcp__docs, mcp__docs__, mcp__docs__x__.

Regression check (what was resolvable and legitimate before): the Claude Code API restricts tool names to letters, digits, underscore and hyphen, and plan S-1 observed space and dot becoming underscore. Grepping the mcp__ names spelled in docs/qa, hooks and src finds none outside the new charset except the deliberate negative cases and names that were already unresolved (the triple-underscore tool names). The remaining cost is names the runtime cannot produce, denied fail-closed. Unmeasured: a runtime that passes a tool name through unsanitised would now see those tools denied, an availability cost only, no bypass.

## 3. Reflected-name cap (red-team 2): closed, demonstrated

bounded() slices the JSON-stringified name to 512 characters and appends a marker: [truncated, N characters in all]. It applies AFTER JSON escaping, and the deny is then escaped again by the adapter, so the worst case is about double. Measured through the real hook (exit 0, deny JSON, stdout parses, stderr empty in every row):

| tool_name | Deny stdout bytes | Reason chars | Marker |
|---|---|---|---|
| Write | 198 | 85 | none (short names reflected whole) |
| 510 characters | 703 | 590 | none |
| 5 MB plain | 740 | 628 | yes |
| 5 MB of double quotes | 1,252 | 629 | yes |
| 2 MB backslashes | 1,251 | 628 | yes |
| 2 MB control characters | 827 | 629 | yes |
| 2 MB lone surrogates | 827 | 629 | yes |
| 2 MB emoji pairs, and a pair or a quote straddling the 512 cut | 745, 736, 737 | 628, 624, 624 | yes |
| 5 MB Bash plus spaces | 740 | 628 | yes |
| object with a 3 MB key, array of 300,000 numbers, object with a 1 MB escaped key | 728, 726, 1,238 | 616, 615, 616 | yes |
| null, true, 12345, 1e999, empty array | 179 to 182 | 68 to 71 | none |

Output is bounded near 1.3 KB for any input, no case balloons, each call took about 0.1 to 0.4 s, and a huge session_id (3 MB, string or object) is not reflected. A 5 MB mcp__ name goes through the MCP route and yields the unchanged 69-character POL-05 reason. A cut inside an emoji pair or an escape sequence still yields valid JSON (lone surrogates are escaped by the adapter's JSON.stringify).

## 4. Latency instrument (cross-domain finding 6, L4b): closed, demonstrated

assertHookOutcome(status, stdout), 30 probes run directly. Accepted: exit 2 (any stdout), exit 0 with empty or whitespace stdout, exit 0 with a JSON whose hookSpecificOutput.permissionDecision is exactly "deny" (also with a trailing newline). Rejected: exit 1, null, undefined and string "0" statuses; allow JSON; ask; {}; null; 123; true; []; an array wrapping a deny; the string "deny"; a misspelled key (permissionDecison); Deny; "deny " with a trailing space; a top-level permissionDecision; hookSpecificOutput as an array or a string; the decision nested one level too deep; the decision as an array; two concatenated JSON documents. The real qa:gate-latency-budget passes (40 iterations, p95 176.85 ms, ceiling 2000 ms).

## 5. Fail-open probe (my finding 1): recorded, demonstrated

runProbe on this Windows host: node-options-bad-flag (exit 9) and systemroot-nonexistent (exit 134) are classified PROCEEDS with ap AP-13; the other rows keep their previous outcomes (three earlier launch faults PROCEEDS, six gate outcomes BLOCKS). The payload used for both new rows is the one the gate denies on the same tree (the unclassified-mcp-tool row is BLOCKS), so PROCEEDS is a real contrast, not an artifact. The SYSTEMROOT row is gated twice, by process.platform equal to win32 in runProbe and by the row's platform field in the test that checks probed rows. envWith copies the ambient environment exactly as a default spawn would inherit it (no extra variable is passed), so nothing leaks that the child would not receive anyway; SYSTEMROOT is removed case-insensitively before the override. The probe writes only inside its own mkdtemp directory, removes it in a finally block (0 thoth-s7-probe- directories before and after my run), copies the hook and fixture rather than touching them, and the repo git status is unchanged by it. The third new row (stdout-closed-before-write) is recorded, not probed, correctly labelled UNPROVEN in a real session.

## 6. Mutation check: demonstrated

Scratch copy of the tree, node --test over the hooks, src/policy and src/qa suites (1,017 tests). The copy has no .git, so four QA-14 and QA-15 tests are red in the baseline (1,013 pass, 4 fail); that is a copy artifact, constant across mutants, and those tests pass in the real worktree. Each mutant below added exactly one new red test and nothing else changed:

| Mutant | New red test |
|---|---|
| stderr prints err.stack; stderr prints err.message | G22 (both) |
| charset check line deleted; regex without end anchor; regex without start anchor; charset admits dot; charset admits space | N13 (all five) |
| cap disabled; cap raised to 100,000; malformed-input reason left unbounded; unroutable reason left unbounded; truncation marker removed | G21 (all five) |
| latency deny check removed; latency check accepts allow JSON | L4b (both) |

One of my own mutants (whitespace class) was mis-escaped in my script and became a no-op; I redid it with a literal space and N13 went red. So each of the four guards is individually pinned.

## 7. Regression: demonstrated

- node --test on the whole repo: 1219 tests, 1219 pass, 0 fail, 0 cancelled, 0 skipped (Windows, about 121 s).
- Sixteen qa:* gates run one by one, all exit 0 (several print their disclosed vacuous-pass notes, as before; qa:mutation-shell 53 of 53 mutants killed; qa:gate-latency-budget p95 176.85 ms). tsc --noEmit and eslint print nothing.
- Answer keys byte-identical to aa97bdc, compared by blob id at aa97bdc and at HEAD for hooks/pretooluse-kernel-gate-classification.test.ts, hooks/test-support/gate-sandbox.ts, src/policy/config/print-cli.test.ts and src/policy/config/printer.test.ts, and the diff between aa97bdc and d81d86d on them is empty.
- No existing test weakened: the delta deletes two assertion lines in src/qa/gate-fail-open-probe.test.ts (a probed-row check made platform-aware, and the PROCEEDS list extended from three to the launch-failure group plus the two new rows, compared against an exact sorted list) and changes one comment line in .claude/settings.json. src/policy/gate/gate-structure.test.ts only gains the new test file in its expected list.

## 8. New in the delta

No new leak, fail-open path or dependency. The reflected text is now bounded and the exit-2 text is fixed. Three LOW notes:

1. assertHookOutcome still accepts a deny JSON with no reason string or the wrong hookEventName (probed: a bare permissionDecision deny passes), and exit 2 with arbitrary stdout. Both are correct under the PreToolUse contract (deny needs no reason to block, exit 2 blocks regardless) and the instrument's job is latency plus a coarse outcome check, so this is hardening only. Proposed test: assertHookOutcome(0, deny JSON without a reason) throws.
2. envWith in src/qa/gate-fail-open-probe.ts drops keys case-insensitively only for the names passed in (SYSTEMROOT). On Windows an ambient Node_Options in another casing would sit beside the override. Only risk is a flaky classification of the probe row, not a security effect; code-traced, not reproduced. Proposed test: run the probe with Node_Options set ambient and expect the row PROCEEDS.
3. Up to 512 characters of an untrusted tool_name (JSON-escaped) still reach the model-visible deny reason. That is bounded and visible now; the name comes from the runtime's tool registry, not free model text, so reach is narrow. Derived, no test.

## Findings (ranked by exploitability x impact)

1. [ISSUE][LOW][demonstrated] assertHookOutcome accepts a deny JSON without reason or event name (section 8, note 1); optional tightening, not a defect.
2. [SUSPICION][LOW][code-traced] envWith casing duplicate for NODE_OPTIONS on Windows (note 2).
3. [SUSPICION][LOW][derived] 512 escaped characters of untrusted tool_name still reflected (note 3).
4. [CLEAN][demonstrated] Exit-2 stderr carries a fixed message and error name only; exit 2 and non-empty stderr kept (section 1).
5. [CLEAN][demonstrated] Tool segment admits only letters, digits, underscore, hyphen; 27 hostile forms denied through the real hook, controls allowed (section 2).
6. [CLEAN][demonstrated] Reflected name bounded, marker visible, deny JSON valid and exit 0, output at most about 1.3 KB for 5 MB inputs (section 3).
7. [CLEAN][demonstrated] Latency instrument accepts only exit 2, empty exit 0, or a parseable deny JSON (section 4).
8. [CLEAN][demonstrated] Probe rows PROCEEDS, SYSTEMROOT Windows-only, no leftover state, cannot touch the real hook (section 5).
9. [CLEAN][demonstrated] Fourteen mutants across the four guards each turn exactly one named test red (section 6).
10. [CLEAN][demonstrated] 1219 pass, 0 fail, 0 skipped, sixteen qa gates and typecheck and lint clean, answer keys byte-identical (section 7).

BLOCKERS: none. Hardening: findings 1 to 3.

Open findings 3 (all LOW), failing tests 0: this is a read-only re-confirm and the LOW items are hardening notes with no blocking behavior; proposed test names are in section 8. Findings 4 to 10 are CLEAN, so they have no failing-test form.

## Editorial

- The plan's statement that tool names contain only letters, digits, underscore and hyphen cites S-1, which measured only space and dot for a server name; the tool segment claim rests on the API's documented name pattern. Wording only, verdict-neutral.

RECEIPT: verdict=APPROVE
findings (ranked by exploitability x impact):
1. [ISSUE][LOW][demonstrated] src/qa/gate-latency-budget-check.ts assertHookOutcome accepts a deny JSON with no reason or wrong hookEventName; optional tightening
2. [SUSPICION][LOW][code-traced] src/qa/gate-fail-open-probe.ts envWith drops only SYSTEMROOT case-insensitively; ambient Node_Options casing could duplicate NODE_OPTIONS on Windows (probe flake only)
3. [SUSPICION][LOW][derived] src/policy/gate/decide-tool-call.ts up to 512 escaped characters of untrusted tool_name still reach the model-visible deny reason (bounded, runtime-sourced)
4. [CLEAN][demonstrated] hooks/pretooluse-kernel-gate.mjs exit-2 stderr is a fixed message plus error name for bad stdin, empty stdin, malformed fixture, deep nesting; AC-6 intact
5. [CLEAN][demonstrated] src/policy/normalizer/tool-class-format.ts tool segment limited to letters, digits, underscore, hyphen; 27 hostile forms denied end to end, class-only allow still works
6. [CLEAN][demonstrated] src/policy/gate/decide-tool-call.ts reflected name capped at 512 with visible marker after escaping; 5 MB inputs give about 1.3 KB valid deny JSON, exit 0; POL-05 reason unchanged
7. [CLEAN][demonstrated] assertHookOutcome accepts only exit 2, empty exit 0, or parseable deny JSON; 30 shapes probed
8. [CLEAN][demonstrated] gate-fail-open-probe new env rows PROCEEDS, SYSTEMROOT row win32-only, mkdtemp-only, no leftover state
9. [CLEAN][demonstrated] mutation drill: 14 mutants over the four guards each turn exactly one named test red (G22, N13, G21, L4b)
10. [CLEAN][demonstrated] node --test 1219 pass, 0 fail, 0 skipped, sixteen qa gates, tsc and eslint clean, four answer-key files byte-identical to aa97bdc
counts: issues=1 suspicions=2 clean=7
evidence: demonstrated=8 code-traced=1 derived=1
checks="1219/0/0"
adr=HIT(37)
report=docs/reviews/s7-kernel-gate-classification-app-security-reconfirm-2026-09-26.md
