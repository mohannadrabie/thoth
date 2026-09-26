# s6-294-echoed-key-sanitize: cross-domain review (Ra), 2026-09-26

[cross-domain-reviewer] Cross-Domain Reviewer (Ra) scanning the seams between reviewer lanes.

Scope: Issue #294 (closes the S6 milestone), CRITICAL. Branch fix/s6-294-echoed-key-sanitize at 41ab7b4; diff = merge-base b345adc (master) to 41ab7b4. Checked out detached in this worktree. Nothing on the branch was edited: every mutation below was reverted and the worktree status was clean afterwards.

## Lanes and ground

| Lane | Status | Ground |
|---|---|---|
| app-security-reviewer | ran in parallel (filed Issue #313 before this report) | injection class, scan-heuristic hole, print-cli behavioral gap |
| red-team | parallel per plan section 8 | bypass classes (format characters, lone surrogates, unenumerated positions) |
| test-writer | ran pre-review | two locked-oracle amendments in the printer test file |
| cross-domain (this) | standing | whole catalog vs diff; seams; records vs tree; Issue discipline |

Not re-listed here (lane-owned): the interpolation-scan concatenation hole and print-cli's missing behavioral coverage (Issue #313, app-security).

## ADR step

Ran `node docs/adr-cache.mjs --ensure` after the ADR submodule init:
`📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]`
Read whole and unfiltered (37 entries; THOTH-ADR-0002 is `proposed`, the rest of the in-scope set `accepted`).

## Cross-domain ADR verdict

| ADR | Verdict | Basis |
|---|---|---|
| SE ADR-0005 (no delete/weaken a failing test) | No collision; human reading still pending | No test deleted; both amendments strengthen (expected message computed through the sanitizer; more-than-2 lines became exactly 2). The path followed the ADR's "fix the code or escalate": implementer flagged, test-writer amended, Manager ruled. Full suite reproduced green (checks line). The pending reading covers only ONE of the two amendments (finding 1). |
| SE ADR-0010 (run CI gates, no deleted tests, no lowered thresholds) | No collision | typecheck, lint, full test run, qa gates green. No threshold or lint list touched. |
| SE ADR-0021 (kernel purity, one gate artifact) | No collision | The range's changed-file list holds no kernel, gate, hook, loader, schema or qa-fixture file. qa:kernel-purity PASS (4 files, 0 violations); qa:normalizer-registry-purity PASS. |
| SE ADR-0002 / ADR-0003 | No collision | Helper is its own module beside its consumers; one function, no options; no new import into kernel or rule. |
| SE ADR-0004 (idempotency) | Not applicable | Helper is pure; an idempotence test exists anyway. |
| THOTH-ADR-0001 / THOTH-ADR-0002 | Not applicable | Neither the central-classification fixture nor secret-scan allowlist or pattern files are in the diff. |
| SE ADR-0006 (no opportunistic scope) | No collision | Hook deny path held out as Issue #312; loader and schema untouched. |
| Remaining SE (0007-0009, 0011-0020) and all devops ADRs | Not applicable | No cloud, data, tagging, port, or IaC surface. |

CLAUDE.md sensitive-area rule (policy delivery / config surface): a fresh dated report is required before ship. This report plus the lane reports satisfy it once committed on the branch. The copy persisted here is uncommitted in this worktree, so the Manager must carry it onto the branch.

## Findings

### 1. [ISSUE][MED][code-traced] Records describe one oracle amendment and an open conflict; the tree has two amendments and none open (Issue #314)

- Decisions row (`docs/decisions.md:74`, item 4) and CHANGELOG (`CHANGELOG.md:15`) say test-writer changed "one helper" (`parseFailureBound`) and ask the human to ratify that reading of SE ADR-0005/0010.
- The last commit (41ab7b4) is a second amendment: `src/policy/config/printer.test.ts:618-630` rewrites the ISSUE-108(c) title and turns its `> 2` lines assertion into `=== 2`. It appears in the test-writer report's addendum and in no ratification row.
- CHANGELOG bullet at `CHANGELOG.md:17` ("Open at build close ... not edited here") and the state note (`docs/.maat-state.json:10`, "Open at build close ...") still describe that conflict as open. 41ab7b4 closed it.
- Consequence: the human ratifying "the reading" ratifies a partial description. The second amendment changes what a locked test proves (the multi-line rejection shape it pinned is no longer producible by that fixture), the same class the S7 AC-2 row asks a human to read.
- Exposure: not a runtime defect; affects 1 of 1 human ratification gates for this story, basis: counted in code. Not blocking.
- Minimal fix: append a decisions addendum row naming amendment 2 (decisions is append-only); delete the stale CHANGELOG bullet and fix the "one helper" sentence (Unreleased entry, editable); correct the state note.
- Failing test: none (a record, not behavior). Residual: Issue #314.

### 2. [ISSUE][LOW][demonstrated] Top-level `adrCatalog` lost from `docs/.maat-state.json` (same defect commit 43bfa2d fixed before)

- The story's state edit wrapped the previous scope block under `priorScope` and the catalog went with it. Branch top-level keys: scope, tier, reviewRoundsSinceClean, reviewRoundsTotal, humanRulingRequired, councilHeld, councilVerdict, roundsSinceLastGo, note_2026-09-26b, priorScope. Master carries `adrCatalog` at top level.
- Demonstrated: `node docs/adr-cache.mjs --ensure` on the branch prints `BUILT` and adds 723 lines to the file; on master it only bumps the version.
- Consequence: every reviewer after merge pays a rebuild and dirties the tree with an unrelated diff (test-writer already noted a dirty state file). Self-healing; no correctness impact.
- Minimal fix: run `node docs/adr-cache.mjs --ensure` and commit the file. No Issue (LOW).

### 3. [ISSUE][LOW][demonstrated] Deferred owners not bound where the activation implementer will look

- Manager comments on #288 and #107 (2026-09-26 15:24) say the remaining work belongs to #308 and that #107's review-back (backstop 2026-10-24) is tied to it. #312's own body says "add to that activation's preconditions".
- `gh issue view 308` shows one body and two comments; none names #312, #288 or #107. The link is one-directional, the asymmetry that produced Issue #292.
- Exposure: 0% today (hook unwired, no policy content ships), basis: counted in code (no PreToolUse entry). Rises to every gated call at activation.
- Minimal fix: one comment on #308 listing #312, the remaining #288 items and #107 as activation preconditions. No Issue (LOW).

### 4. [SUSPICION][LOW][code-traced] The #312 fix cannot reuse this helper from the gate

- `src/policy/gate/decide-tool-call.ts:4` and the structural test `src/policy/gate/gate-structure.test.ts:48` forbid any import from the config directory into the gate. The verdict reason #312 must sanitize is built in the kernel and rendered by the gate, so `sanitizeForTerminal` cannot be imported there as placed.
- Result: #312 will add a third copy of the strip class or move the helper. The drift guard here compares exactly two parties (helper vs the UserPromptSubmit hook).
- Unconfirmed: whether sanitizing belongs in the hook script (which does import config code) rather than the gate. Suggest a line on #312 so its Phase 1 decides the helper's home and re-points the drift guard. Not filed (LOW suspicion).

### Clean seams checked

- [CLEAN][demonstrated] Suite: `npm test` reproduces the test-writer claim exactly: 1325 tests, 1325 pass, 0 fail, 0 skipped. Consistent with S7's CI count (1219) plus the 106 tests of the two new files (run alone: 106/106).
- [CLEAN][demonstrated] Drift guard is real: dropping U+2029 from the hook's strip class makes exactly the drift test fail (6 tests, 5 pass, 1 fail); reverted.
- [CLEAN][demonstrated] Interpolation scan bites on the CLI file: removing the wrapper on the pin channel fails the scan test (100 tests, 99 pass, 1 fail); reverted. Its concatenation blind spot is Issue #313.
- [CLEAN][demonstrated] Clean-input identity: `npm run policy:print` on master vs branch, output hashes equal after masking the one timestamp field (both 424fb4ea...c630d). Weak alone (the repo's own inputs yield zero rules); the locked exact-string printer tests (20/20) carry the rest.
- [CLEAN][demonstrated] Issue discipline: #294 is the only open issue left in the S6 milestone, so "closes the milestone" holds. #312 exists, severity:low, milestone S7, and its description matches the code (kernel reason built from rationale or id at `src/policy/kernel/kernel.ts:177,186`). #288 and #107 carry dated re-home comments consistent with their labels and milestone (S7); two wording nits under Editorial.
- [CLEAN][demonstrated] Other gates: typecheck exit 0; lint exit 0; qa:kernel-purity, qa:normalizer-registry-purity, qa:gate-manifest, qa:gate-command-path, qa:gate-matcher-drift PASS; qa:completeness-claims PASS (2 files); QA-14 diff mode (base b345adc, head 41ab7b4) PASS: 182 citations, 138 resolved, 44 unclassified (non-blocking), 0 failed; oss:secret-scan exit 0 with the tree clean afterwards.

## Coverage gaps

- `docs/STATE.md` is not in the diff. The DoD requires it updated at close; that is the Manager's close-out step and no lane claims it. Not a finding yet.
- `docs/.maat-state.json` (machine state) is claimed by no lane; finding 2 came from it.
- `docs/run-log.jsonl` (one appended tier-ratified line) and the plan and test-writer documents: low risk, intentionally uncovered.

## Editorial (verdict-neutral, plain edits)

- `docs/decisions.md:74` item 2, "the loader's only outflow is the printer", holds only for the failure message. The loader has two non-test consumers: the printer, and the kernel-gate hook, which forwards layer and reason kind only but does consume the merged rules (that is #312). Reword to "the loader's only failure-message outflow".
- The 15:24 re-home comment on #288 lists "the hook consuming LoadSuccess.defaultOutcome" as remaining; the merged hook already reads it (unwired). The earlier comment said "as a live path"; restore that qualifier.
- The header comment in the amended printer test file (interpretation choice 7) still describes the old more-than-2-lines relaxation. Locked file: fix it in the same test-writer pass as finding 1, or leave it.

## Verdict

APPROVE-WITH-CONDITIONS. No HIGH; no ADR collision. Conditions (record fixes, no code): (1) close finding 1 before merge; (2) restore the top-level catalog key; (3) one comment on #308.

Open findings 4 (3 issues plus 1 suspicion); failing tests 0. The difference is explained: all four are records, issue links, or a future-story design note with no executable form, so each resolves to a plain edit or a comment.

Single next action: the Manager appends the decisions addendum for the ISSUE-108(c) amendment, removes the stale "Open at build close" lines (CHANGELOG, state note), restores the catalog key, and comments on #308.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by blast radius):
1. [ISSUE][MED][code-traced] docs/decisions.md:74 + CHANGELOG.md:15,17 + docs/.maat-state.json:10 -- ratification row, changelog and state note cover one oracle amendment and call ISSUE-108(c) open; tree has two amendments, none open (printer.test.ts:618-630). Append decisions addendum, drop stale bullets. Issue #314. Exposure: 1 of 1 human ratification gates for this story, basis: counted in code (not a runtime defect)
2. [ISSUE][LOW][demonstrated] docs/.maat-state.json -- top-level adrCatalog lost when priorScope was wrapped (adr-cache --ensure BUILT, +723 lines); rerun --ensure and commit.
3. [ISSUE][LOW][demonstrated] Issue 308 -- no mention of #312, #288 remainder or #107 residual though re-home comments point there (one-directional bind, cf. #292); add one comment.
4. [SUSPICION][LOW][code-traced] src/policy/gate/gate-structure.test.ts:48 -- gate may not import from config, so the #312 fix cannot reuse sanitize.ts; helper home and drift guard need a decision in #312.
5. [CLEAN][demonstrated] npm test reproduced: 1325 tests, 1325 pass, 0 fail, 0 skipped; new files alone 106/106.
6. [CLEAN][demonstrated] Drift guard real: mutated hook class fails exactly the drift test (5/6 pass).
7. [CLEAN][demonstrated] Interpolation scan bites on print-cli wrapper removal (99/100); concatenation hole is lane-owned Issue #313.
8. [CLEAN][demonstrated] Clean-input identity: policy:print master vs branch equal after masking the timestamp.
9. [CLEAN][demonstrated] ADR-0021, ADR-0005, ADR-0010, ADR-0002/0003: no collision; no kernel, gate, hook, loader or schema file in diff; qa:kernel-purity and registry-purity PASS.
10. [CLEAN][demonstrated] Issue discipline: #294 only open in S6; #312 accurate; #288/#107 re-home comments consistent (two wording nits, editorial).
11. [CLEAN][demonstrated] Gates: typecheck, lint, gate-manifest, gate-command-path, matcher-drift, completeness-claims, QA-14 diff mode (0 failed), secret scan all pass.
counts: issues=3 suspicions=1 clean=7
evidence: demonstrated=9 code-traced=2 derived=0
checks=npm test 1325/1325 pass, 0 fail, 0 skipped; sanitize+echo-sanitize 106/106; typecheck exit 0; lint exit 0; qa:kernel-purity, qa:normalizer-registry-purity, qa:gate-manifest, qa:gate-command-path, qa:gate-matcher-drift PASS; qa:completeness-claims PASS; QA-14 diff mode 182 citations, 0 failed; oss:secret-scan exit 0; mutation drills 2 (hook class, print-cli wrapper) both caught, reverted
adr=HIT(37, whole catalog)
report=docs/reviews/s6-294-echoed-key-sanitize-cross-domain-2026-09-26.md
