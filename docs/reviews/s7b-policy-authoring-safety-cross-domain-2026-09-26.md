# S7-B policy-authoring-safety: cross-domain review (Ra), 2026-09-26

HEAD: f663d6b (branch feat/s7b-policy-authoring-safety; diff base fix/s7a-gate-hook-robustness, three-dot). Tier: CRITICAL. Stage 3, round 1.

## 1. Lanes and ground covered

| Lane | Ran | Ground |
|---|---|---|
| app-security-reviewer | yes (report in another checkout; its RECEIPT read) | guard and reachability as controls, mutants, sanitization, Issue 328 (relative path under a directory named mcp) |
| red-team | pending at read time | adversarial |
| test-writer | yes, RED-CONFIRMED | PT-7 at hook level |
| cross-domain (this pass) | yes | whole ADR catalog (37 ADRs: 12 devops, 23 software-engineering, 2 project), seams, records, stacked-PR hygiene |

ADR cache: `📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]` (built after the ADR submodule was initialized; the committed state file already carries 37 entries).

Diff surface (19 files): production edits in src/policy/tools/classification-catalog.ts, src/policy/config/loader.ts, src/policy/normalizer/tool-class-format.ts, new src/policy/config/rule-reachability.ts; five new test files, one test edited (G13b) and one additive list edit (G19); plan, test-writer report, CHANGELOG, decisions, backlog, REVIEW_LOG, run-log, state file. Hooks, kernel, rule/, schema, precedence, fixture JSON, CI workflow: untouched (the diff stat over those paths is empty).

## 2. Cross-domain ADR verdict (whole catalog against the changed files)

| ADR | Verdict | Evidence |
|---|---|---|
| THOTH-ADR-0001 rule 1 (do not cite for another control) | OK | Not cited as authority for R1 or R2; the plan names it as the constraint honored. |
| THOTH-ADR-0001 rule 2 (loader or reader change needs a fresh dated review report) | OK once stage 3 lands | classification-catalog.ts is the shared fixture reader and changed; this report plus the app-security and red-team reports are the dated set. The fixture JSON is not edited, so the entry-only carve-out is not in play. |
| THOTH-ADR-0001 rule 4 (no hardcoded entry in hooks/ or src/) | OK, demonstrated | The ADR's own single-source query printed `14 names, quoted-literal hits: 1`; the one hit is `src/policy/fixtures/allowlist-settings.ts "github"`, the documented different allowlist. The guard reads built-in names from the inventory at run time. |
| THOTH-ADR-0001 rule 5 (loader MUST throw on malformed input; path and source recorded) | OK for SessionStart, open for the gate (pre-existing) | `assembleCatalog` throws on a lowering entry; SessionStart's catch records the resolved path and source (R1-7 asserts both). The write-free gate cannot record them; that gap is the human ruling AP-7 in Issue 308, unchanged by this diff (a malformed fixture already threw there). |
| Does a stricter loader narrow or extend the exception? | **Narrows. The Manager reading is sound.** | The exception exempts named entries from an INT-07 verification the fixture cannot perform. R1 only adds a throw: a lowering entry now fails the load (SessionStart: generic enumeration-failed halt; gate: exit 2 on the MCP path) instead of being merged. No path in the diff admits an entry that was rejected before, and the raise-or-keep behavior (central wins) is unchanged. Two caveats: (a) rule 2 says an entry's presence in the merged file is its approval, and a code guard now vetoes a merged entry; the reading that keeps both true is that R1 is a validity rule of the loader (same family as rule 5's malformed-input rejection), not a review requirement, so an entry-only pull request is still never held for a report and merely fails CI (R1-4) if it lowers; (b) this reading is not in the decisions row (finding 1). |
| SE ADR-0021 single decision path / identical verdicts | OK, demonstrated | The only production caller of the merge is `assembleCatalog` (R1-6 green in the 1479-test run); both hooks reach the catalog through it; SessionStart R1-7 and gate PT-7 both green. The guard and the reachability check are load-time validity rules, not a second decision path. Kernel, Action record, registry untouched; `qa:kernel-purity` and `qa:normalizer-registry-purity` PASS. |
| SE ADR-0005 (G13b replacement, locked keys) | OK, code-traced | Removed lines over the test files are the G13b title, its comment lines, the inert-shape table and the loop with its message; every assertion (schema errors equal 0, kernel non-match for each of the four shapes, controls) is present in the added lines, plus loader assertions. No test deleted. precedence.test.ts, schema.test.ts, the classification tests, the H-series and the printer tests are not in the diff. |
| SE ADR-0010 (no deleted tests, gates) | OK | typecheck and lint clean; no test removed. |
| SE ADR-0002 / ADR-0003 (layers, SOLID) for config to normalizer | OK, demonstrated | The new import in the config layer is value-only from the normalizer grammar file; that file imports only a type from the tools directory; the normalizer directory imports nothing from config (grep); no cycle. rule/ imports are unchanged. The reachability check is its own module, not in schema.ts or the loader body. Direction is downward (config consumes grammar); acceptable. |
| SE ADR-0006 (blast radius, no opportunistic scope) | OK | Backlog candidates stayed out of the diff (section 5). |
| SE ADR-0004/0009/0011-0015, ADR-0007/0008, devops 0001-0010, SE 0016-0020, THOTH-ADR-0002 | NOT-APPLICABLE | No data store, IaC, ported file, secret-scan allowlist or CI workflow touched. |

## 3. Seam findings

### Finding 1 [ISSUE][LOW][code-traced]: the THOTH-ADR-0001 reading is not in the record
Evidence: the docs/decisions.md S7-B row (items 1 to 10) never names THOTH-ADR-0001; the CHANGELOG entry names it only as a sensitive area. The Manager ruled that the stricter loader narrows the exception, pending human ratification; the earlier ADR-reading rows (SE ADR-0005 and 0010 for the S6 amendments) were recorded so a human could ratify them from the decisions log.
Minimal fix (plain edit, no re-review): add one clause to the S7-B decisions row: "R1 narrows THOTH-ADR-0001: the guard is a loader validity rule (rule 5 family), never a review requirement; pending human ratification, bundled with the SE ADR-0005 reading."
Exposure: none live (documentation gap); no executable form.

### Finding 2 [SUSPICION][LOW][code-traced]: the gate's block text points at the wrong unlock for the two new load failures
Evidence: hooks/pretooluse-kernel-gate.mjs line 86 carries the one unlock for an internal exception ("retry the call; if it fails again a human must repair the gate hook (Node 22.18 or newer and an intact checkout)"); a lowering entry lands in that catch, so an operator reading the gate line is told to repair the hook, not the fixture. For a rejected rule, src/policy/gate/decide-tool-call.ts line 86 says only "policy load failed: layer X, kind Y; fail-closed", no unlock. The actionable text (entry name, class, Unlock) lives only in SessionStart's halt detail and in `npm run policy:print`. PRINCIPLES rule 2. Both texts are locked or ruled (S7-A fixed line; H6) and the hook is unwired, so this is an activation matter, not a defect in the diff; S7-B widens the set of authoring mistakes that reach these two lines.
Minimal fix: add an activation precondition row to Issue 308: the gate's policy-load-failure and catalog-failure lines each name where the operator reads the detail (`npm run policy:print`, the SessionStart halt). Unproven whether an operator reaches SessionStart's halt first; settle at activation with the H6 output on a real project.
Exposure: ~0% of runs today, basis: counted in code (gate unwired).

### Finding 3 [SUSPICION][LOW][derived]: stacked-PR hygiene not yet stated for this branch
Evidence: this branch shares append points with the open S7-A pull request (docs/.maat-state.json head block, CHANGELOG top, decisions.md, run-log.jsonl, backlog Open list); docs/STATE.md line 15 names only the S6 close-out as first in the merge order and is not edited by this diff (the DoD lists STATE.md). A squash merge of the S7-A pull request will conflict with this branch on those files; a merge commit will not. The state file diff is 4.5k lines only because each new scope re-indents every nested prior scope (28 levels deep, valid JSON, top-level adrCatalog intact with 37 entries, 341960 bytes); it is a conflict magnet, not a defect.
Minimal fix: the S7-B pull request body and STATE.md state the order (S6 close-out, then S7-A, then S7-B; merge commits, not squash). Unproven; settle with a dry merge at PR time.
Exposure: n/a (process).

### Redundancy check (not re-listed as findings)
- Issue 328 (app-security finding 1, MED): a rule targeting a relative file path under a directory named mcp is rejected as "can never match". I reproduced it independently and it is not re-filed: the normalizer emits verb write and target an example file name under a directory named mcp for a shell redirect to that path, the kernel `matchRules` matches a deny rule on that pair, and `loadEffectivePolicy` returns `ok: false`, failedLayer project, reasonKind schema-invalid. One addition for the fix of Issue 328, not a new finding: the same premise is worded "forged" in the decisions row (item 2), the CHANGELOG entry, the tool-class-format.ts header (facts 3 and 4) and the R2-6 drift comment; the decisions row records a consequence narrower than the demonstrated one. The drift corpus has no relative path under mcp, which is why R2-6 stays green. Whatever the fix, correct those four wordings with it.
- App-security's V4, letter-case and unknown-class-rank items: already named, not re-listed.

## 4. Coverage gaps

- Node 22: the suite ran on Node 24.15 only here; the CI matrix covers 22. The new tests use only type-stripping-safe syntax by inspection; not proven. Settle: CI on the pull request.
- No lane claims the state file, run-log and STATE.md; the state file is well-formed (checked), the STATE.md gap is finding 3. Otherwise intentionally low risk.
- G13b lives in tool-class-golden.test.ts, an implementer-owned file (added in the S7 build commit), not a test-writer answer key; editing it by recorded replacement is within the DoD.
- The twelve-mutant run is a scratch run with no committed instrument (the CHANGELOG says so); app-security independently killed the same mutant set (its M1 to M11 with 2a and 2b), which corroborates it. Not blocking.

## 5. Records versus the diff

- Decisions row: honest about "pending human ratification" and about its build deviations (item 10). Item 9 (Issue 309) is unrelated to this diff's code and reads stale: Issue 309 is now CLOSED, state reason not_planned, milestone S7, with a Manager comment stating the decision, its basis and the reopen condition; the number matches the described title. Closed honestly; the "confirm the issue number" caveat is resolved.
- CHANGELOG: counts are in word form ("Twelve named mutants"); no numeral completeness claim. `qa:completeness-claims`: 2 files checked, PASS. The QA-15 marker is correctly unchanged: no shell-detector file is in the diff and `qa:mutation-shell` reports 59 of 59 killed.
- Backlog candidates: five entries, each names a concrete unrejected shape or an unowned surface and matches plan section 10; none is in the diff. This project has an Issues tracker and CLAUDE.md says new backlog items become Issues; the project has kept using docs/backlog.md through S7 (precedent), so I treat it as accepted practice (editorial).
- Instrument counts: 57 guard pairs printed by R1-1 (the 13 lowering, 25 raising and 19 same-class pairs of the test-writer row sum to it); R2-10 prints zero rules in each shipped policy file (independently read: 0 and 0).
- Issue discipline: Issues 305 and 306 open, labels bug, severity:med, sur / pol, milestone S7; closure by `Closes` at the pull request is the Manager's step; nothing closed by me.

## 6. Reproduced instruments (raw)

```
npm test                       -> tests 1479 / pass 1479 / fail 0 / cancelled 0 / skipped 0 / todo 0 (duration_ms 181112)
npm run typecheck              -> clean (no output)
npm run lint                   -> clean (no output)
npm run qa:mutation-shell      -> [QA-06 shell-detector-mutants] PASS: 59 of 59 mutant(s) KILLED.
npm run qa:gate-latency-budget -> PASS: measured p99 (594.19ms) stays under the declared 2000ms latency budget (iterations=100)
npm run qa:kernel-purity       -> PASS: 4 production .ts file(s), zero violations
npm run qa:normalizer-registry-purity -> PASS
npm run qa:completeness-claims -> PASS: 2 file(s) checked
npm run qa:gate-manifest       -> PASS: Exactly 1 gate manifest found: .claude/settings.json
reference-resolver (diff mode, base = the S7-A branch, head = HEAD) -> PASS: 318 citation(s): 267 resolved, 51 unclassified (non-blocking), 0 failed
```
Probe for Issue 328 (node, inline): record targets `["an example file name under a directory named mcp"]`, verbs `["write"]`; `matchRules([rule], record)` matches: true; loader result `{"ok":false,"failedLayer":"project","reasonKind":"schema-invalid"}`.

## 7. Verdict

APPROVE-WITH-CONDITIONS. No HIGH. Conditions: (1) record the THOTH-ADR-0001 narrowing reading in the decisions row (finding 1, plain edit); (2) Issue 328 is fixed or ratified as a residual by the Manager and its four "forged" wordings corrected with it (owned by app-security's finding, not a new one); (3) state the merge order in the pull request and STATE.md (finding 3). Finding 2 goes to Issue 308's precondition list.

Open findings versus failing tests: this report opens 3 findings (1 issue, 2 suspicions, all LOW) and 0 failing tests; none has an executable form (record wording, activation text, merge procedure). The one executable defect in the seam set, Issue 328, is app-security's and has its own named test.

Single next action: the Manager adds the THOTH-ADR-0001 clause to the S7-B decisions row, then decides Issue 328 (fix or ratified residual) before the pull request opens.

## Editorial (verdict-neutral, plain edits)
- The S7-B decisions row item 9 (Issue 309) is stale (section 5) and unrelated to this story's code.
- hooks/sessionstart-tool-enum-builtin-override.test.ts: the second test title says EVERY non-lowering pair, but it samples one built-in per class (it prints "6 pairs from 3 built-ins"). Retitle to "one built-in per class".
- Backlog candidates could be Issues per CLAUDE.md; precedent says docs/backlog.md (section 5).

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL, ranked):
1. [ISSUE][LOW][code-traced] docs/decisions.md S7-B row: the THOTH-ADR-0001 narrowing reading (pending human ratification) is not recorded; add one clause, plain edit
2. [SUSPICION][LOW][code-traced] hooks/pretooluse-kernel-gate.mjs:86 and src/policy/gate/decide-tool-call.ts:86: gate block text gives a wrong or missing unlock for lowering-entry and rejected-rule failures; add an activation precondition row to Issue 308. Exposure: ~0% of runs, basis: counted in code
3. [SUSPICION][LOW][derived] stacked-PR hygiene: shared append points with the open S7-A pull request and STATE.md merge order names only the S6 close-out; state order S6 close-out, S7-A, S7-B with merge commits
4. [CLEAN][demonstrated] THOTH-ADR-0001 rules 1, 2, 4, 5 checked: single-source query 1 hit (the expected different allowlist); the stricter loader narrows the exception, Manager reading sound
5. [CLEAN][demonstrated] SE ADR-0021 single decision path: assembleCatalog is the only merge caller, both hooks tested green, kernel and registry purity PASS
6. [CLEAN][code-traced] SE ADR-0005 G13b replacement: every prior assertion present in the added lines, no test deleted, locked keys not in the diff
7. [CLEAN][demonstrated] SE ADR-0002/0003 config-to-normalizer value import: no cycle, rule/ untouched, purity checks PASS
8. [CLEAN][demonstrated] gates reproduced: npm test 1479 pass, 0 fail, 0 skipped; mutation-shell 59 of 59; latency p99 594ms under 2000ms; typecheck, lint, manifest, QA-14 diff, QA-15 PASS
9. [CLEAN][code-traced] docs/.maat-state.json shape: valid JSON, top-level adrCatalog intact with 37 entries, churn is nesting re-indent only
10. [CLEAN][code-traced] records: decisions row honest about pending ratification, Issue 309 closed not_planned with a Manager comment, CHANGELOG counts in word form, backlog candidates real and out of the diff
11. [CLEAN][demonstrated] SessionStart versus gate split for a lowering fixture: SessionStart halts with path and source recorded, gate exits 2 on the fixed line reading only the committed module-relative fixture (CI-guarded by R1-4)
counts: issues=1 suspicions=2 clean=8
evidence: demonstrated=5 code-traced=5 derived=1
checks=npm test 1479 pass/0 fail/0 skipped; qa:mutation-shell 59/59 killed; qa:gate-latency-budget PASS p99 594.19ms<2000ms; typecheck clean; lint clean; kernel-purity, registry-purity, completeness-claims, gate-manifest, reference-resolver(diff) PASS; not run: Node 22 matrix (CI)
adr=HIT(37, whole catalog)
report=docs/reviews/s7b-policy-authoring-safety-cross-domain-2026-09-26.md

## Manager addendum (2026-09-26, PRINCIPLES rule 11: the evidence above is otherwise verbatim)

After the fix-now round, the Manager made one wording substitution so that QA-14 (a blocking CI gate, which has no opt-out) could pass on this range. Meaning is unchanged. Substitution: the example redirect path the reviewer used to reproduce Issue 328 (a file with a py extension under a directory named mcp) was reworded to "an example file name under a directory named mcp". No finding, verdict, severity, evidence tag or receipt line was edited.
