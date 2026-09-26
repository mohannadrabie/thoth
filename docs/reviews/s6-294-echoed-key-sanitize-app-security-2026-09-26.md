# app-security review: s6-294-echoed-key-sanitize (Issue #294), 2026-09-26

[app-security-reviewer] Horus. Tier CRITICAL (ratified, run-log). Post-build. HEAD: 41ab7b4, diff against merge-base b345adc (master). Read-only on production code; every mutation was applied in this isolated worktree and reverted.

ADR: cache HIT, 37 ADRs cataloged. Security-domain ADRs read: SE ADR-0021 (kernel purity, fail-closed, single decision path), THOTH-ADR-0001, THOTH-ADR-0002. No violation: the change adds no kernel, hook, or decision path; the loader, schema, hooks, and the S5 classification file are untouched (empty diff, below). SE ADR-0005 and ADR-0010 are testing and quality ADRs: assessed only for the oracle-amendment question asked of me (section 4); the Manager owns the ruling.

## Verdict: APPROVE-WITH-CONDITIONS

The fix closes Issue #294's terminal-injection class on every rejection and print path I could enumerate, and the walk instrument is real. Two conditions: one hardening of the interpolation-scan half of the completeness claim (MED, demonstrated), one wording gap in the accepted-residuals row (LOW). No blocker.

Exposure statement (no HIGH filed): the MED finding has exposure ~0% of runs today, basis counted in code (no current unsanitized echo exists); it guards future edits only.

## 1. Evidence run (raw)

| Check | Command (worktree at 41ab7b4) | Result |
|---|---|---|
| Focused suites | node --test on echo-sanitize, sanitize, printer, loader tests | tests 158, pass 158, fail 0, skipped 0 |
| Full suite | node --test (whole repo) | tests 1325, pass 1325, fail 0, cancelled 0, skipped 0 |
| Typecheck | npm run typecheck | exit 0, no output |
| Lint | eslint over src/policy/config | no output (clean) |
| Kernel purity | npm run qa:kernel-purity | PASS, 4 production files, zero violations |
| Completeness-claim checker | npm run qa:completeness-claims | PASS, 2 files checked |
| Scope held | name-only diff of master against HEAD restricted to hooks, loader.ts, schema.ts and docs/qa | empty output (none changed) |
| Clean-output identity | npm run policy:print with master printer files vs branch printer files, computedAt masked, sha256 | both 6c346ce20979ce60c6f93e4d7682c38425989da232a015971b481ae9f7e37a42 |

Clean-output caveat: the policy:print identity run has zero rules and no inert-mandatory line (this repository ships no policy content). The stronger identity evidence is the unmodified locked printer.test.ts exact-string suite (20 of 20 pass after the amendments) plus the echo-sanitize check that the NOTE line for clean input equals the pre-change literal.

## 2. Mutation results (does the completeness claim fail on a new unsanitized echo?)

Each row: remove or weaken one sanitize call in this worktree, run the new instruments, revert. Counts are node --test totals for the named files.

| # | Mutation | Result | Caught by |
|---|---|---|---|
| M1 | rejection message unwrapped (printer.ts, renderRejection) | printer + echo-sanitize + sanitize: 126 tests, 79 pass, 47 fail | walk (many positions), printer.test.ts |
| M2 | rule id unwrapped in the rule line | echo-sanitize: 100 tests, 93 pass, 7 fail | walk, scan |
| M3 | origin unwrapped in the rule line | 100 tests, 97 pass, 3 fail | channel test, scan |
| M4 | voided-layer name unwrapped | 100 tests, 99 pass, 1 fail | scan only (value is a code enum, no behavioral difference exists) |
| M5 | voided rule id unwrapped | 100 tests, 97 pass, 3 fail | mandatory-collision test, scan |
| M6 | central channel unwrapped in status line | 100 tests, 97 pass, 3 fail | hostile-channel test, scan |
| M7 | inert-mandatory note rule id unwrapped | 3 fail (96 pass in the file) | note tests, scan |
| M9 | pin channel unwrapped (print-cli.ts) | 100 tests, 99 pass, 1 fail | scan only (no behavioral test reaches print-cli.ts) |
| M12 | sanitizer class drops the line and paragraph separators (control characters only) | red (walk failures) | walk, BMP range test |
| M13 | sanitizer class rewritten as C0, DEL and the two separators (no C1) | red | walk, BMP range test |
| M10 | print-cli.ts NOTE loop replaced by plain string concatenation of the raw rule id (no template literal) | echo-sanitize + printer: 120 tests, 120 pass, 0 fail | NOTHING: stays green |
| M14 | pin channel expression becomes an empty-string sanitize call, a plus sign, then the raw channel | echo-sanitize: 100 tests, 100 pass, 0 fail | NOTHING: stays green |

Reading: for anything printer.ts renders, removing a call goes red (behavioral walk or scan). The instrument does NOT fail on a new unsanitized echo written in print-cli.ts by concatenation or by a wrapper-plus-raw expression: see finding 1.

## 3. Findings (ranked)

### 1. [MED][demonstrated] The scan half of the completeness claim has two blind spots, and print-cli.ts has no behavioral coverage
- Evidence: src/policy/config/echo-sanitize.test.ts, the interpolations() function (finds only the dollar-brace template form) and the unsanitized() predicate (accepts any expression that starts with the sanitizer call and ends with a close parenthesis). Mutations M10 and M14 above: both leave the suites fully green (120 of 120, 100 of 100).
- print-cli.ts cannot be tested behaviorally by design (Issue #99 bars path seams), so its pin line and NOTE loop are guarded only by the scan.
- Attack sketch: a later edit adds a line to print-cli.ts written with plain concatenation (or a chained call ending in a parenthesis) that echoes policy text; CI stays green and the terminal-injection defect returns silently.
- Blast radius: Exposure: ~0% of runs today, basis: counted in code (zero current unsanitized echoes; this guards future edits). The test-file header already labels the scan a heuristic, so this is a gap in the stated backstop, not a false claim.
- Minimal fix (either): route the pin line through an exported renderer in printer.ts and cover it with a behavioral test like the NOTE line; or extend the scan to flag plus-concatenation of non-literals in the two print modules and require the wrapper to be one balanced call spanning the whole expression.
- Named test for the fix: "the interpolation scan flags string concatenation and wrapper-plus-raw expressions" (fails today via M10 and M14).
- Disposition: fix-now is cheap and inside the instrument this story owns; deferral is acceptable because no exploit exists today.

### 2. [LOW][demonstrated] The accepted-residuals row names key collisions only; rule-id collisions on a successful load are the same class with less friction
- Evidence: I loaded two layers whose rules were named alike, one carrying a trailing control character and the opposite effect. Both loaded (exit 0, no duplicate-id rejection, because the loader compares raw ids), and the printer printed two lines with identical id text and opposite effects, distinguishable only by the layer and origin fields.
- Attack sketch: a project policy author makes a rule read like a shipped or central rule id in the operator output. Loader semantics are unchanged (raw comparison), and layer plus origin stay honest.
- Fix: add a clause to the residuals row (or a follow-up row): rule ids that differ only by stripped characters load as distinct rules and print identically. No code change; a visible escape instead of a strip would remove it but is the Manager ruling Q3.
- Named test (optional): "rule ids differing only by stripped characters print with distinct layer and origin fields".

## 4. Verified sound (CLEAN)

- Coverage of the class: the walk puts hostile text in every node value and renames every key of every object in all three layers through the real load and print path; the structural echoes (duplicate key, duplicate id, mandatory collision, malformed JSON, read errors, the printer last-resort catch, hostile channel) are separate tests. M1 to M7, M12 and M13 show it goes red on removal. The base-document test derives the schema key sets from the schema error text, so a new schema key forces the base to grow.
- Drift guard is real: I added one Unicode class to the hook inline literal in this worktree; the drift test failed (5 pass, 1 fail); reverted. A reordered class also fails (no literal found). It is one-directional, which is what a drift guard needs.
- Clean-output byte identity holds (section 1).
- Fail-closed unchanged: sanitizing only edits printed strings; exit codes, posture line and rejection shape are untouched in the diff, and the walk asserts exit 1 plus the unresolved posture for every rejection variant and exit 0 for every valid-load variant. The kernel-gate hook forwards only the failed layer name and reason kind, never the message, so the printer is the single outflow of loader messages; the kernel and hook deny reason is Issue #312, out of scope and correctly untouched.
- Amended oracle does not weaken coverage. (a) parseFailureBound now computes the expected message through the sanitizer: with the message sanitize call removed, printer.test.ts alone goes red (20 tests, 18 pass, 2 fail, including the amended ISSUE-108(c) line-count test and ISSUE-123(c)). (b) ISSUE-108(c) changes from more-than-2 lines to exactly 2 lines: the old property (a raw newline riding through) is precisely the defect being fixed, and exactly 2 is the stricter contract. (c) Two notes for the human reading, neither weakening: the expected message now shares the implementation sanitizer (independence is preserved by the BMP range oracle in sanitize.test.ts); and the raw-echo guard in that test file cannot match a multi-line raw text after stripping, so the exact-message equality is what bounds a whole-file echo (it does).
- Scope: loader, schema, hooks and the S5 classification file unchanged (empty diff).
- Residuals recorded honestly and none worse than stated, with the finding 2 clause as the only gap: format characters (bidi, zero-width) survive, exactly the S5 #278 residual; homoglyphs survive; two hostile keys can strip to the same text; a stripped key can read like a known key (the line still says unknown key, and a rejection stays a rejection). No NFKC and no truncation are deliberate and recorded in the helper header.

## 5. Blockers vs hardening

- Blockers: none.
- Hardening: finding 1 (MED, fix-now recommended, deferrable), finding 2 (LOW, wording).

## 6. Findings to tests

Open findings: 2. Failing tests committed by me: 0 (read-only reviewer; production and test code untouched). Each finding has one named test proposed above; finding 1 is executable now as the M10 and M14 mutations, which currently pass green, and that is the failure of the instrument.

## Editorial (verdict-neutral, fix as plain edits)

- The 2026-09-26 decisions row for this story (item 4) says one helper in the locked printer test was changed; the second amendment (ISSUE-108(c), more-than-2 to exactly 2) is also an amended locked assertion and is not named there, so the human ratification as written under-describes it. Add an addendum row naming it.
- The CHANGELOG entry still carries an "Open at build close" bullet saying the ISSUE-108(c) assertion is unedited; it was amended in the final commit.
- Stale comments remain in printer.test.ts (the more-than-2-lines rationale and the at-least-2 message text) describing newlines as legitimately embedded; harmless, the assertions are tolerant.

## Single next action

Manager: route finding 1 to story-implementer as a fix-now (extend the scan or move the pin line into printer.ts), make the two documentation edits above, then proceed to the cross-domain pass.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] src/policy/config/echo-sanitize.test.ts interpolations()/unsanitized(): scan misses plain concatenation and wrapper-plus-raw expressions and print-cli.ts has no behavioral test; mutations M10 and M14 stay green (120/120, 100/100); fix: move the pin line into printer.ts with a behavioral test or extend the scan. Exposure: ~0% of runs today, basis: counted in code.
2. [ISSUE][LOW][demonstrated] decisions row residuals cover key collisions only; rule ids differing only by stripped characters load as distinct rules and print identically (loader compares raw ids); fix: add a clause to the residuals wording.
3. [CLEAN][demonstrated] mutation sweep M1-M7, M9, M12, M13: removing or weakening any printer.ts sanitize call or the class goes red (walk and scan); M4 and M9 are visible only to the scan (code-controlled or CLI-only values).
4. [CLEAN][demonstrated] drift guard against the hook inline class fails when the hook literal is altered (5 pass, 1 fail), reverted.
5. [CLEAN][demonstrated] clean-output byte identity: policy:print hash equal before and after with computedAt masked; locked printer.test.ts exact-string suite 20/20; full suite 1325/1325.
6. [CLEAN][demonstrated] fail-closed unchanged: walk asserts exit 1 and unresolved posture for every rejection variant and exit 0 for valid variants; hook forwards no message text; kernel purity PASS.
7. [CLEAN][demonstrated] amended printer.test.ts oracle is not weaker: printer.test.ts alone goes red (18 pass, 2 fail) when the message sanitize call is removed; exactly-2-lines is stricter than more-than-2; shared-sanitizer and raw-echo-guard subtleties noted for the human reading.
8. [CLEAN][demonstrated] scope held: loader, schema, hooks and the S5 classification file have an empty diff versus master.
9. [CLEAN][code-traced] recorded residuals (bidi and zero-width format characters, homoglyphs, key collision after strip, stripped key reads as a known key) are accurately described in the helper header and the decisions row; only the finding 2 clause is missing.
counts: issues=2 suspicions=0 clean=7
evidence: demonstrated=8 code-traced=1 derived=0
checks="1325/0/0"
adr=HIT(37)
report=docs/reviews/s6-294-echoed-key-sanitize-app-security-2026-09-26.md
