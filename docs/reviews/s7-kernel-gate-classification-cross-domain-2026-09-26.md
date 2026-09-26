# Cross-domain review: s7-kernel-gate-classification (Issues #93, #288, #107), CRITICAL

[cross-domain-reviewer]
Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes

HEAD: 94c5315 (branch feat/s7-kernel-gate-classification). Diff: fff858c..94c5315, 44 files, 4970 insertions, 173 deletions. Date 2026-09-26.

`📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog - ≈18300 tokens saved this pass (fp 2095e13) [CACHE=HIT]` (whole catalog read, no applicableTo filter; the cache run rewrote the tracked `docs/.maat-state.json` fingerprint in my worktree, I reverted it: read-only).

## 1. Which lanes ran, and the ground they cover

| Lane | Status | Ground |
|---|---|---|
| red-team | running in parallel | adversarial pass on the code |
| app-security-reviewer | running in parallel | authz, injection, deps on the code |
| Pre-build (already reported, in the diff) | architecture (REWORK then APPROVE-WITH-CONDITIONS), design-challenger rounds 1 and 2 (go, go) | plan revisions 1 to 3 |
| test-writer | RED-CONFIRMED (21 tests) | H and P groups |
| This pass | cross-domain | ADR whole-catalog vs the diff, the seams, claims vs code, scope, bookkeeping |

I do not re-list what the pre-build architecture and design-challenger reports already name (F7 second decision path, routing table not covered by ADR-0021, marker-verb vocabulary, THOTH-ADR-0001 Q-C). They are carried as open questions in plan section 17, and I only check that nothing new hides behind them.

## 2. Cross-domain ADR verdict (whole catalog, checked against the CODE)

| ADR | Verdict | Evidence |
|---|---|---|
| SE ADR-0021 "MUST NOT add a field outside these seven that the kernel branches on"; "MUST NOT let a normalizer return a verdict, or let the kernel inspect a tool's identity" | CONFORMS | `git diff --name-status` shows zero change to `src/policy/kernel/**`, `registry.ts`, `shell.ts`, `structured-cluster.ts`, `action-catalog.ts`; `qa:kernel-purity` PASS (4 files), `qa:normalizer-registry-purity` PASS. `tool-class.ts:65-73` returns verbs and targets only |
| SE ADR-0021 "MUST NOT implement a second decision path" / "MUST register each normalizer by declaration; MUST NOT add a tool type by editing a shared dispatch chain" | AMBIGUOUS, carried (not new) | Three refusals in `decide-tool-call.ts:55-57`, all enumerated. `tool-routing.ts:12-14` states in its own comment that adding a tool type "edits two shared lines: a row here and the side-effect import". No human or architect reading is recorded (finding 4) |
| SE ADR-0021 "identical verdicts on identical input" (POL-03) | CONFORMS for the gate | one kernel; the SessionStart-vs-gate name asymmetry (raw vs sanitized) is disclosed and fails toward deny (plan section 4) |
| THOTH-ADR-0001 rule 4 "MUST NOT hardcode an entry of either list in hooks/ or src/" | CONFORMS, demonstrated | the ADR's own single-source query: 14 names, 1 quoted-literal hit, `src/policy/fixtures/allowlist-settings.ts "github"` (the expected different allowlist). A case-insensitive scan of every new or changed test file: 0 hits (the one match in `printer.test.ts:159` is a pre-existing "Issue #99" comment) |
| THOTH-ADR-0001 rule 2 "a PR that changes the loader or the hooks that read the file still needs a fresh dated review report" | SATISFIED by this round, once red-team and app-security land | fixture diff is `notes` text only, zero entry change |
| THOTH-ADR-0001 rule 5 "resolved path and its source MUST be recorded in halt-state"; rule 1 "MUST NOT be cited to justify any other ... control" | UNCLEAR, carried (Q-C, human, blocks activation only) | the gate reads the fixture and records nothing; hook is unwired. Also: the ADR text names `hooks/sessionstart-tool-enum.mjs`'s `resolveFixtureLocation` and `projectDir()` at "lines 111-113"; the location function now lives in `src/policy/tools/classification-catalog.ts:43`. Add to Q-C (d) amend proposal |
| THOTH-ADR-0002 (proposed) | NOT TOUCHED | `docs/qa/secret-scan-allowlist.json` not in diff; `oss:secret-scan` run: 0 blocking, 2562 allowlisted |
| SE ADR-0003 (inject I/O) | CONFORMS | gate ports injected (`decide-tool-call.ts:38-41`); `gate-structure.test.ts` G15 |
| SE ADR-0005 line 54 / SE ADR-0010 line 47 "MUST NOT delete or weaken a failing test" / "MUST NOT ... delete tests" | READING NEEDED (finding 3) | locked AC-2 lost `assert.notEqual(decision, undefined)`; plan section 1 says "no exception is needed" without addressing it |
| SE ADR-0006 "MUST NOT widen a change's scope"; "feature flag OFF" | CONFORMS | hook unwired (`.claude/settings.json` hooks keys still exactly SessionStart, UserPromptSubmit); scope check below |
| devops ADR-0008 "MUST NOT merge a PR with any blocking gate open, failing, or pending" | CONDITION | no PR exists (`gh pr list --head` empty); this round's three reports and CI are the open gates. Merge stays human-only |
| SE ADR-0001, SE ADR-0002, 0004, 0007 to 0009, 0011 to 0020, devops 0001 to 0007, 0009, 0010 | NOT APPLICABLE / no collision | no state, tagging, cost, data, port-fidelity, secret-scan or IaC surface touched |

Result: no ADR-violation BLOCKER. Two readings (row 2 and the ADR-0005/0010 row) need a recorded human ratification, not a code change.

## 3. Instruments run (raw results)

| Check | Result |
|---|---|
| `node --test` (full) | tests 1213, pass 1213, fail 0, skipped 0 (Windows, Node 24.15.0) |
| Added vs removed test cases in `*.test.ts` | +74 / -0; 1139 (master baseline) + 74 = 1213 |
| Eight story files | 55 tests pass (`node --test` on the eight new files, 0 fail, 0 skipped) |
| 27 SessionStart tests (`hooks/sessionstart-tool-enum*.test.ts`) | tests 27, pass 27, fail 0; only `hooks/sessionstart-tool-enum.mjs` changed (7 insertions, 15 deletions), no SessionStart test changed |
| `npm run typecheck`, `npm run lint` | exit 0, no output |
| hooks tests (outside `tsconfig` include) | ad hoc `tsc` with `hooks/**/*.ts` added: 0 errors in the new hook test or `gate-sandbox.ts`; 14 pre-existing errors, all in `hooks/userpromptsubmit-halt-relay-*.test.ts` |
| qa gates | fixture-coverage, diff-fixture, fixture-isolation, mutation-harness, broken-instrument-gate: VACUOUS-PASS (disclosed, not mine); shell-detector-mutants 53 of 53 killed; recurring-findings 3 ok; completeness-claims PASS; kernel-purity PASS; normalizer-registry-purity PASS; gate-command-path PASS; gate-manifest PASS; gate-matcher-drift PASS (19 names); gate-latency-budget PASS (p99 225.62 ms, ceiling 2000); runtime-settings-drift PASS |
| QA-14 diff mode `node src/qa/reference-resolver.ts fff858c 94c5315` | PASS: 449 citations, 404 resolved, 45 unclassified (non-blocking), 0 failed |
| `git diff --check fff858c..94c5315`; CR bytes in all new files | clean; no CR (the attributes file sets eol=lf) |
| plan 7a count (Node port of its awk) | C:11 D:2 G:22 H:14 L:4 M:7 N:15 P:7 S:5, TOTAL 87 |
| `node src/policy/config/print-cli.ts` | `posture: allow (source: bootstrap; no layer declared a posture)` then the unwired disclosure; `--- resolved rules (0) ---` |
| real hook, first-listed remote-mutating fixture server tool call | exit 0, empty stdout (silent allow) |
| real hook, `mcp__nosuch__x` | exit 0, deny JSON, reason `POL-05: mutating action's source is opaque ...` |
| merge simulation `git merge-tree --write-tree 94c5315 docs/decisions-handoff-sweep` | CONFLICT in `CHANGELOG.md` and `docs/run-log.jsonl`; `docs/decisions.md`, `docs/STATE.md` clean |

## 4. Scope discipline (diff-scope check)

- Plan section 15 file list vs `git diff --name-status`: every one of the 44 changed files maps to a listed row (new gate dir, normalizers, catalog module, probe, hook adapters, printer, central-source, latency instrument, comment-only files, tests, docs).
- Forbidden files (`src/policy/kernel/**`, `registry.ts`, `shell.ts`, `structured-cluster.ts`, `shell-scanner.ts`, `action-catalog.ts`, `precedence.ts`, `schema.ts`, `pin.ts`, `shipped-defaults.json`, `docs/qa/tool-inventory.json`, CI workflow dir, secret-scan allowlist, halt-state): zero hits (name-only diff filtered by those patterns).
- `.claude/settings.json`: JSON-parsed against `fff858c`: only the `//` comment key differs; hooks keys are exactly `SessionStart`, `UserPromptSubmit`. Two extra comment rewordings (two upstream tracker citations, now "upstream Claude Code tracker item ...") are outside plan item 6 but comment-only and explained by the QA-14 cross-repo citation reading; not gold-plating.
- Fixture: one `notes` string; no entry change. `loader.ts`, `bootstrap-ruleset.ts`, `central-classification.ts`, `builtin-tool-inventory.ts`: comment-only (read the diffs).
- Deleted lines in existing tests: only `hooks/pretooluse-kernel-gate.test.ts` (25 added, 21 removed: header and NOTE comments, AC-19 comment, and the one AC-2 assertion swap). `printer.test.ts`, `central-source.test.ts`, `gate-latency-budget-check.test.ts`: additions only.
- Gold-plating: none found. Production additions are about 890 lines including comments (plan estimated 350); an estimate, not a claim, so no finding.

## 5. Findings (ranked by exposure x irreversibility x silence)

No HIGH. Nothing here needs a code change before the review chain can close; the items are bookkeeping, two ADR readings, and one CI-only unknown.

1. [SUSPICION][MED][code-traced] Activation preconditions have no durable owner. Plan D2 says "Section 13 items added" to `docs/backlog.md`; `git diff fff858c..94c5315 -- docs/backlog.md` changes one line (the #93 entry). A tracker search for "baseline allow" and for "AP-1" returns nothing relevant. AP-1 to AP-12 and the nine section-13 items live only in a plan file; only #303 (AP-13) and #304 (AP-14) are Issues. `docs/backlog.md:24` and the plan say #93 "closes only with an explicit link to AP-1's owner", and that owner does not exist. Silent, and nothing mechanical forces AP-n before wiring (only the P5 disclosure literal does). Minimal fix: the Manager files the build receipt's Issue proposals (baseline allow content = AP-1 at least) before merge and links them from #93. Named test: none executable (tracking gap).
2. [SUSPICION][MED][derived] Not run on CI's environment. Every result above is Windows, Node 24.15.0; CI is Linux, Node 22.18.0, and plan U-7, S4 and L3 (gate probe on 22.18, `ISSUE-123(b)/(c)` ok, latency check) and #288 precondition 3 (the Node 22 raw-bytes assertion on CI) are all "the PR's CI run", which does not exist yet. `gate-fail-open-probe.ts:111` uses `--no-experimental-strip-types`. UNPROVEN-pending-verification. Settling command: open the PR and read the `ci` job, or `npm test` on Linux with Node 22.18.0; owner: human (push) then Manager. No failure observed, so no severity above MED.
3. [SUSPICION][MED][code-traced] Locked-test amendment vs SE ADR-0005 line 54 / SE ADR-0010 line 47. `hooks/pretooluse-kernel-gate.test.ts` AC-2 lost `assert.notEqual(decision, undefined, "expected a real ... permissionDecision on stdout, not silence")`; its own NOTE warned that a script exiting 0 with no output is a false-positive PASS, and the replacement `stdout.trim() === ""` now accepts exactly that shape for AC-2 alone (the H suite catches it: the test-writer's "hook always silent" mutant turned 12 H tests red). Plan section 1 (row for ADR-0005) says "no exception is needed" and never mentions AC-2. THOTH-ADR-0001 rule 7 is precedent that a test-removal reading needs an explicit human record. Fix: record the Q-B ruling and the AC-2 swap in the decisions row as a human-ratified reading. Named test: none (ADR reading).
4. [SUSPICION][MED][code-traced] SE ADR-0021 line 208 (POL-12) vs `src/policy/gate/tool-routing.ts:12-14,40-63`: adding a tool type requires editing this shared table plus a side-effect import, stated in the file's own comment. The architect marked routing NOT-COVERED and left the reading to the architect queue; no reading is recorded and `qa:normalizer-registry-purity` scans `registry.ts` only. Not new as a question, new as fact: the shipped code now literally embodies the "edit two shared lines" shape. Fix: either a human-ratified reading (table is data, not a dispatch chain, with the third-normalizer trigger) or an `/adr-amend`. Named test: none (ADR reading).
5. [SUSPICION][MED][derived] Decision-log gap is larger than the one blocked row. What exists outside `docs/decisions.md`: intake rulings table (Q1-Q5, Q-A..Q-D, peer-override, cache), plan revision tables (R-A to R-J, Q-E ack, PT-13 ruling, P5 literal ratification, H3/H4 wording), plan section 21 (7 draft rows), run-log `tier-ratified`. See section 7 for exactly what the human must ratify or record. Inconsistency to fix in the record: the intake table still says "Q-A: Option X" while the effective ruling is R-A (option Y, no shipped content; the intake's own fall-back clause fired after design-challenger round 1) and no place says the clause fired. PRINCIPLES rule 20: the tier "is a ratified line in docs/decisions.md"; it is only in the run-log. The blanket preapproval is second-hand text in the intake file, not a decisions row.
6. [ISSUE][LOW][demonstrated] `src/qa/gate-latency-budget-check.ts` `assertHookOutcome` is looser than plan L4 ("exit 0 with a parseable deny JSON"). Run against the built module: `assertHookOutcome(0, '{"hookSpecificOutput":{"permissionDecision":"allow"}}')` ACCEPTED; `(0, "{}")` ACCEPTED; `(0, "null")` ACCEPTED; `(0, "123")` ACCEPTED; `(0, "{ oops")` throws; `(1, "")` throws. A hook that emits an allow JSON (a Q-B violation) passes the latency instrument. Low because H10 and AC-2 own Q-B. Minimal fix: reuse `classifyOutcome` from `gate-fail-open-probe.ts` and require `permissionDecision === "deny"` for non-empty stdout. Named failing test: `L4b: assertHookOutcome rejects exit 0 with an allow JSON, {}, null and 123`. Exposure: 0% of today's runs (the hook prints a deny or nothing), basis: measured.
7. [ISSUE][LOW][demonstrated] Sibling-branch merge: a `merge-tree --write-tree` of 94c5315 with docs/decisions-handoff-sweep reports CONFLICT in `CHANGELOG.md` (both insert a new section directly under `## [Unreleased]`) and `docs/run-log.jsonl` (both append at EOF). `docs/decisions.md` and `docs/STATE.md` merge clean (the sweep's hunk is lines 39-64; the S7 rows go at the end). Resolution for whichever merges second: keep both CHANGELOG sections (newest first) and both run-log lines in timestamp order (05:10:33 sweep, 05:23:33 S7). No data-loss risk. Exposure: 100% of merges of the two, basis: measured. No test form (merge mechanics).
8. [ISSUE][LOW][code-traced] Hand-typed counts (CLAUDE.md "no hand-derived completeness claims"). Regenerated: 87 IDs (plan 7a, reproduced), 74 added and 0 removed tests (diff of the test files), 1213 total (run), 55 tests in the eight new files, 63 only if the plan's "eight test files" (section 20a, unnamed) is read as the H file, the locked hook file, tool-class, golden, decide-tool-call, render, gate-structure and catalog (14+10+14+2+11+3+5+4). "67 named tests" has no committed generating command: 87 minus 12 CMD ids minus 7 drills minus 2 docs ids is 66 (67 only if N1, a typecheck assertion, counts). Fix: name the eight files in section 20a and commit the count script beside 7a. No test form.
9. [SUSPICION][LOW][code-traced] CLAUDE.md "Sensitive areas": the Guard / policy engine bullet names `scripts/guard/*` and `src/policy/guard/*` (neither directory exists; `src/policy` holds config, fixtures, gate, kernel, normalizer, rule, tools, verification); the Policy enforcement bullet names the deleted report-subject-gate script and is scoped to hooks "wired to" PreToolUse/UserPromptSubmit, while the kernel-gate hook is deliberately unwired and the SessionStart hook is neither. So `src/policy/gate/*`, `normalizer/*`, `config/*`, `tools/*` match no named glob; the CRITICAL ceremony reached them by the ratified tier, not by the hard rule. Human decision (CLAUDE.md is human-owned; not edited). Same class as open Issue #234 (secret-scan globs). Also CLAUDE.md cites `REQUIREMENTS.md` under docs/; the file is at the repo root.
10. [SUSPICION][LOW][code-traced] `src/policy/tools/classification-catalog.ts:38` exports `projectDir()`, used only by its own test (G14); `hooks/sessionstart-tool-enum.mjs:197` still has its own `projectDir()`. Two derivations of the same seam, one dead in production, and G14's assertion proves nothing about the hook's. Minimal fix: delete the export and its assertion, or have the hook import it. Plan text said "plus an exported projectDir()".
11. [SUSPICION][LOW][code-traced] `docs/.maat-state.json:2` still reads scope `s6-policy-residuals-112-124`; the S7 tier ratification exists only as the run-log `tier-ratified` event. `/maat:review` and `/maat:verify` reuse this file. Expected before Stage 3 closes (S6 wrote its note after its review); Manager updates it at close.

### Clean seams (checked, sound)

12. [CLEAN][demonstrated] Suite and gates: 1213/1213/0 skipped; typecheck, lint, all qa gates PASS, QA-14 diff mode PASS (0 failed), secret scan 0 blocking, no CR, whitespace check clean, hooks tests type-check clean.
13. [CLEAN][demonstrated] Scope: 44 of 44 files inside plan section 15; zero forbidden files; settings.json hooks keys unchanged; existing tests additive except the one recorded AC-2 swap.
14. [CLEAN][demonstrated] "Nothing denies by class from shipped data until AP-1" is true: `shipped-defaults.json` has `rules: []`, `policy:print` shows 0 resolved rules, and the real hook silently allows a call to a server the fixture classifies remote-mutating while denying an unclassified one by POL-05. Consequence to keep in mind: today classification only ever REMOVES a deny (unclassified) and never adds one.
15. [CLEAN][demonstrated] THOTH-ADR-0001 rule 4 single-source query (1 expected hit); new tests carry no fixture entry name.
16. [CLEAN][demonstrated] SessionStart seam: 27 of 27 unchanged and green; the swap is import lines plus the `resolveFixtureLocation` call (`hooks/sessionstart-tool-enum.mjs:526`, still before stdin); no halt-state path in the diff; the `module-relative` fixtureSource value has no consumer that validates the set (grep).
17. [CLEAN][demonstrated] Claims agree with code: hook header, `printer.ts` `ENFORCEMENT_DISCLOSURE`, `print-cli` output, settings.json item 6, `central-classification.ts`, fixture `notes`, `builtin-tool-inventory.ts` and `loader.ts` comments all say "built, not wired, class is rule data, nothing denies by class". The plan's stale-comment grep now returns only the append-only backlog entry (with its S7 update), an unrelated S4 line, and the accepted ADR residual row (human, Q-C). CHANGELOG mutation claims (drills M1 to M7 each a superset of predicted) match plan section 20a.
18. [CLEAN][code-traced] Issue and milestone state (read from the tracker): #93 OPEN (bug, severity:med, sur, S7); #288 OPEN and #107 OPEN (both milestone S6); #299 to #307 all OPEN, milestone S7 (open 10, closed 0). Correct pre-merge: #93 stays open (capability delivered, enforcement content = AP-1); nothing is "closed-in-code" on the tracker yet.

## 6. Bookkeeping detail

| Item | State | Action, owner |
|---|---|---|
| #93 | open, correct | at merge: comment "capability delivered; enforcement content = AP-1 (link the owner Issue, finding 1)"; do not close |
| #288 | open | precondition 1 (posture on print surface): DISCHARGED in code (`printer.ts` `posture`/`postureLine`, `print-cli.ts`, P1 to P7). Precondition 2 (re-decide peer override): re-decided (plan 8a, draft row 1), decision UNRECORDED in `docs/decisions.md`. Precondition 3 (Node 22 raw-bytes assertion on CI): CARRIED to the PR's CI run (finding 2); master run 36219917467 is the baseline, not evidence for this branch. The Issue's other items (R7 disclosure, `defaultOutcomeMandatory`) stay deferred, so it stays open |
| #107 | open, milestone S6 | additive fallback built; the 2026-09-24 ratified-residual row (in `docs/decisions.md`, at line 82 before the handoff sweep moved rows to the archive) is not re-opened or superseded in the log (draft row 2); English text match keeps calendar backstop 2026-10-24; "not demonstrated on a real non-English host" (U-1) must survive into the comment |
| #299 to #302 | open | pre-build findings; architect and design-challenger commented status; close as "closed-in-code" only after the Manager verifies against the built code |
| #303 (AP-13), #304 (AP-14) | open, carried | unfixed activation blockers; the probe records them as PROCEEDS |
| #305, #306, #307 | open | #305 not applicable under R-B (built-ins unrouted); #306 bound to AP-1 entry test PT-12; #307 addressed (drills X-3 done) |
| The 4 new Issue proposals in the build receipt | proposals only; I did not see the receipt text and filed nothing | Manager files them (finding 1) |
| `docs/REVIEW_LOG.md` | 4 pre-build rows present and consistent with the tracker (Issues 299 to 307) | red-team, app-security and this pass append their own rows |
| `docs/run-log.jsonl` | one `tier-ratified` event (CRITICAL, unchanged); no `story-shipped` | correct for pre-merge |

## 7. Decision-log gap: what the human must ratify or record (`docs/decisions.md`)

The Manager could not append; nothing is lost (the rulings are in the intake table, the plan revision tables and plan section 21), but none is a ratified log line. Record, in one S7 row or several:

1. Tier CRITICAL ratified (PRINCIPLES rule 20: a ratified line in the log; today only the run-log event).
2. Q1 to Q5 as recommended; Q-A as EFFECTIVELY option Y (R-A, no shipped content; the fall-back clause fired, the intake table still says X); Q-B silent allow (and the AC-2 swap, finding 3); peer-override kept, R7 deferred; no cache.
3. Plan section 21 rows 1 to 7 as drafted (trust model and #288(2); #107 additive; S5 criterion 12 partly superseded; Q-B outcome; no-cache supersedes backlog line 61; AP-13/AP-14 activation blockers; grammar version 1).
4. Rulings currently only in plan tables: R-B (gate scope Bash plus mcp__), R-C (marker verb, no eighth field), R-D and PT-13 (exact match, only `[A-Za-z0-9-]` admitted; 13 AWS tool names unresolved), R-G (three pre-kernel refusals), P5 literal ratification, Q-E adaptation of the #107 header-line evidence.
5. The three ADR-0021 readings (F7 second decision path, routing table vs POL-12 line 208, marker-verb vocabulary) as a human-ratified reading or `/adr-amend`; same for the AC-2 amendment (ADR-0005/0010).
6. Human-only, still open: Q-C (THOTH-ADR-0001: PR diff as approval once class can grant allow; rule 1 scope; rule 5 halt-state record; stale residual row "Inert classification"; stale function and line anchors in rule 5; does test code count under "hooks/ or src/"). It blocks activation, not this merge.
7. The blanket preapproval quoted in the intake file should be a dated log line, as the 2026-09-21 and 2026-09-24 rows did.

## 8. Sensitive-area coverage

| Area touched | Named reviewer report this round |
|---|---|
| Policy enforcement / session gate: `hooks/pretooluse-kernel-gate.mjs`, `hooks/sessionstart-tool-enum.mjs` | red-team and app-security-reviewer (pending, parallel), this pass |
| Guard / policy engine: `src/policy/normalizer/tool-class*.ts`, `src/policy/gate/*` | red-team, this pass |
| Policy delivery / config: `printer.ts`, `print-cli.ts`, `central-source.ts`, `classification-catalog.ts`, `central-classification.ts` | app-security-reviewer, this pass |
| Fixture `notes` (THOTH-ADR-0001) | this pass: text only, zero entry change |
| Gate manifest `.claude/settings.json` | this pass: comment key only |
| QA instrument `gate-latency-budget-check.ts` | this pass: finding 6 |
| Halt-state directory | this pass: not touched (no path in the diff; the 27 SessionStart tests, which exercise its writes, are green and unmodified) |

CLAUDE.md drift (finding 9): report only, not edited.

## 9. Coverage gaps named

- `hooks/**/*.ts` (the H suite and `hooks/test-support/gate-sandbox.ts`) is outside `tsconfig` and eslint by design (the eslint config comment says so). Demonstrated clean with an ad hoc `tsc`; intentionally low-risk, a config decision rather than a defect.
- The Linux/Node 22.18 run (finding 2) and a real non-English `reg.exe` (U-1) are unrun verification, not lane gaps.
- No lane owns the tracker (Issue creation for AP items) or the decision log; they fall to the Manager (findings 1 and 5).

## 10. Editorial (verdict-neutral, plain edits, no re-review)

- CHANGELOG heading: "issue 288 preconditions 1 to 3" reads as all discharged; say 1 delivered, 2 re-decided (record pending), 3 pending the PR's CI.
- `.claude/settings.json` item 6 text: "once S6 ships a real allow-policy" is stale (S6 shipped without baseline content); say "once baseline allow content (AP-1) ships".
- `docs/backlog.md:24`: the original "inert ... S6's job" sentence stays beside the S7 update; acceptable (append-only) but reads contradictory.
- Locked AC-2's title still says it depends on the bootstrap ruleset (locked, not editable by the implementer).
- Plan section 20a: name the "eight test files".

## 11. Verdict

APPROVE-WITH-CONDITIONS. No HIGH, no ADR-violation blocker, no code defect above LOW found in the seams. Conditions are fix-now bookkeeping and one CI-only unknown:

1. Fix-now (Manager): file the AP owner Issues and link #93 (finding 1); write the decisions rows in section 7; update `.maat-state.json` at close.
2. Before merge (human): PR CI green on Linux/Node 22.18 (finding 2, also #288 precondition 3 and plan S4/L3/U-7); resolve the `CHANGELOG.md` and `docs/run-log.jsonl` conflicts with the sweep branch in the stated order (finding 7).
3. Deferred, tracked: the two ADR readings (findings 3 and 4), Q-C, CLAUDE.md globs, the LOW items.

Open findings 11 (3 ISSUE, 8 SUSPICION); failing tests 1 (`L4b`, finding 6, demonstrated red by direct call above). The other 10 have no executable form: findings 1, 5, 8, 9, 10, 11 are tracking, record or config items; 3 and 4 are ADR readings; 2 needs a Linux run; 7 is merge mechanics.

Single next action: Manager files the AP owner Issues and writes the S7 decisions rows, then the human opens the PR and reads its CI.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [SUSPICION][MED][code-traced] docs/backlog.md:24 + plan D2/section 14: AP-1..AP-12 and section-13 items have no Issue/backlog home (only #303, #304 exist); #93 "closes with link to AP-1's owner" has no owner; file the receipt's Issue proposals before merge
2. [SUSPICION][MED][derived] CI-only checks unrun: Linux + Node 22.18 (plan U-7, S4, L3, #288 precondition 3, probe flag --no-experimental-strip-types at gate-fail-open-probe.ts:111); settle by the PR's ci job
3. [SUSPICION][MED][code-traced] hooks/pretooluse-kernel-gate.test.ts AC-2 lost assert.notEqual(decision, undefined) vs SE ADR-0005:54 / ADR-0010:47; plan section 1 says "no exception needed"; record a human-ratified reading
4. [SUSPICION][MED][code-traced] src/policy/gate/tool-routing.ts:12-14,40-63 adding a tool type edits a shared table vs SE ADR-0021 line 208 (POL-12); reading unratified; ratify or /adr-amend
5. [SUSPICION][MED][derived] decision-log gap: tier line, R-A..R-J, Q-A effective option Y, section 21 rows 1-7, ADR-0021 readings, blanket preapproval all absent from docs/decisions.md (list in report section 7)
6. [ISSUE][LOW][demonstrated] src/qa/gate-latency-budget-check.ts assertHookOutcome accepts exit 0 with an allow JSON, {}, null, 123 (plan L4 says deny JSON); test L4b
7. [ISSUE][LOW][demonstrated] merge with the decisions-handoff-sweep branch conflicts in CHANGELOG.md and docs/run-log.jsonl (both append-type; keep both); decisions.md and STATE.md clean
8. [ISSUE][LOW][code-traced] "67 named tests" and "eight test files (63)" have no committed generating command; regenerated 87 / +74 -0 / 1213 / 55; commit the count script
9. [SUSPICION][LOW][code-traced] CLAUDE.md sensitive-area globs name nonexistent paths (scripts/guard/*, src/policy/guard/*, report-subject-gate); src/policy/gate/* matches none; human decision, same class as #234
10. [SUSPICION][LOW][code-traced] classification-catalog.ts:38 projectDir() dead in production; SessionStart keeps its own (hooks/sessionstart-tool-enum.mjs:197)
11. [SUSPICION][LOW][code-traced] docs/.maat-state.json:2 scope still s6-policy-residuals-112-124; S7 tier only in run-log; update at close
12. [CLEAN][demonstrated] npm test 1213/1213/0 skipped; typecheck, lint, all qa gates, QA-14 diff mode (0 failed), secret scan (0 blocking) pass; no CR, whitespace check clean
13. [CLEAN][demonstrated] diff-scope: 44 of 44 files inside plan section 15, zero forbidden files, settings.json hooks keys unchanged
14. [CLEAN][demonstrated] "nothing denies by class from shipped data": 0 resolved rules; real hook silently allows a classified remote-mutating MCP call and denies an unclassified one (POL-05)
15. [CLEAN][demonstrated] THOTH-ADR-0001 rule 4 single-source query: 14 names, 1 expected hit; new tests 0 hits
16. [CLEAN][demonstrated] SessionStart seam: 27/27 unchanged and green, location still resolved before stdin, halt-state untouched
17. [CLEAN][demonstrated] CHANGELOG, plan 20a, hook header, printer disclosure, print-cli output, settings.json and comment claims agree with code
18. [CLEAN][code-traced] Issue/milestone state: #93, #288, #107 open (correct), #299-#307 open in S7 (open 10), REVIEW_LOG rows and run-log tier-ratified consistent
counts: issues=3 suspicions=8 clean=7
evidence: demonstrated=8 code-traced=8 derived=2
checks=npm test 1213 pass / 0 fail / 0 skipped; 27 SessionStart pass/0/0; 8 story files 55/0/0; typecheck+lint exit 0; qa gates all PASS or disclosed VACUOUS-PASS; QA-14 diff fff858c..94c5315 449 cited, 0 failed; oss:secret-scan 0 blocking; merge-tree conflicts=2 files
adr=HIT(37, whole catalog)
report=docs/reviews/s7-kernel-gate-classification-cross-domain-2026-09-26.md

## Manager addendum (2026-09-26, PRINCIPLES rule 11: the evidence above is otherwise verbatim)

Before this branch was ever pushed, the Manager made one wording substitution so that QA-14 (a blocking CI gate, which has no opt-out) could pass on this range. Meaning is unchanged. Substitution: the mention of the requirements file with a docs/ prefix in finding 9 now reads "REQUIREMENTS.md under docs/". The finding is that CLAUDE.md cites a path prefix the file does not have.

The same wording pass also reworded one line citation: the 2026-09-24 ratified-residual row was cited by line number in `docs/decisions.md`, and the handoff sweep shortened that file so the number no longer resolves. It now names the row and says the number was its position before the sweep. Meaning unchanged.
