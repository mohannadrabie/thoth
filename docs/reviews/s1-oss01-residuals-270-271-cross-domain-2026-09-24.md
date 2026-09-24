[cross-domain-reviewer]
☀️ Cross-Domain Reviewer (Ra) — scanning the seams between reviewer lanes

# Cross-domain review: `s1-oss01-residuals-270-271` (Issues #270, #271), CRITICAL

Reviewed head `50dc996` (diff `ae6b4f1..50dc996`, 10 files, 3 commits: `276c435` build, `a6efbfd` docs, `50dc996` run-log). Isolated worktree, org ADR submodule populated.

`📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 0c8a2ca) [CACHE=HIT]` — whole catalog read, unfiltered.

## 1. Lanes running and ground covered

| Lane | Status at review time | Ground |
|---|---|---|
| `red-team` | dispatched in parallel (no report yet) | adversarial, both fixes |
| `app-security-reviewer` | dispatched in parallel (no report yet) | grant semantics, ADR rows 110/111 accuracy |
| `cross-domain-reviewer` (this) | running | whole ADR catalog, seams, hygiene |

`docs/.maat-state.json` still names the prior scope (`qa14-ci-red-citation-wording`). STATE.md and `.maat-state.json` are deliberately deferred to Manager wrap-up (parallel S6 branch): noted, not a finding.

## 2. Cross-domain ADR verdict (whole catalog)

| ADR | Verdict |
|---|---|
| devops ADR-0008 (line 135: "MUST NOT lower gate thresholds, delete tests, or broaden suppression/ignore lists (ratchet only)") | See finding 1. No test deleted, no threshold touched (`SCAN_TIMEOUT_MS`, `ci.yml`, allowlist file, loader all untouched). Only debatable point: the hash-identity change. |
| SE ADR-0010 ("MUST NOT lower coverage thresholds, delete tests, or broaden lint ignore lists") | No collision. The added lines in `src/` contain 0 of `eslint-disable`, `.skip`, `@ts-ignore`, `@ts-expect`, `as any` (grep over the diff = 0 hits). The only removed assertion in the patterns test is the weak `assert.ok(ids.length >= 2 ...)`, replaced by an exact two-direction registry check (strengthened). |
| SE ADR-0004 (idempotency) | Compatible: `scanTimeoutHash` is a pure function; the `hash` unlock has no state. |
| SE ADR-0021 (native architecture, audit-log rules) | Not touched. |
| THOTH-ADR-0002 | Rows 110/111 rewritten; accurate against code except one stale count (finding 2). "Hash computed over matched bytes": scan-timeout has no matched bytes, unchanged reading. "No other exemption shape": same reserved id, unchanged. |
| THOTH-ADR-0001, devops 0001-0007/0009/0010, SE 0001-0003/0005-0009/0011-0020 | Not applicable (IaC, data, monitoring, porting lineage, UI test strategy). Read, no collision. |

**Is the Manager's ADR-0008 reading defensible?** Yes for the shipped state, with one caveat (finding 1). Demonstrated:

```
$ grep -c "oss01-scan-timeout" docs/qa/secret-scan-allowlist.json   -> 0
$ node --test patterns.test.ts history-scan.test.ts allowlist-tool.test.ts at 50dc996
  ℹ tests 129  ℹ pass 129  ℹ fail 0  ℹ skipped 0
```

No existing grant can widen (0 entries). A grant stays content-addressed (path plus hash of the exact text) and path-scoped. What does change: a future grant no longer distinguishes WHICH pattern timed out (`oss01-a-scan-timeout-grant-does-not-depend-on-which-pattern-was-slow` proves internal-hostname and email-address timeouts share one hash). That is a per-entry semantics widening for a not-yet-used id, stated in plain words in ADR row 110, so disclosed, not hidden. ADR-0008 has no waiver path (fix or `adr-amend`); the Manager ruling is an interpretation, correctly logged with Human ratified = pending.

## 3. Findings

### 1. [SUSPICION][MED][derived] The "not a broadening" reading is the Manager's own interpretation of an unwaivable MUST NOT
- Seam: security lane (grant identity) x governance (ADR-0008 / SE-0010 ratchet). Evidence: the new last row of `docs/decisions.md`; `history-scan.ts:179-183` (`scanTimeoutHash` drops `pattern.id`).
- Failure shape (reasoned, not run): a grant recorded because pattern X was slow on blob B later also silences a newly added or edited pattern Y timing out on the same B, where the old formula blocked once. Bounded: same path, byte-identical blob, and a grant's stated meaning is "this text is not a secret".
- Resolves to: the row's own pending human ratification (review-back 2026-10-08). No test possible (interpretive). No fix required.
- Exposure: 0% of existing grants, basis: measured (grep count 0). Not gating.

### 2. [ISSUE][LOW][demonstrated] THOTH-ADR-0002 row 110 still carries a stale hand-typed count
- `docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md:110` says "besides the six real pattern ids"; the catalog has 10.

```
$ node -e "import('./src/secret-scan/patterns.ts').then(m=>console.log(m.SECRET_PATTERNS.length))"   -> 10
$ sed -n 110p docs/adr/thoth-0002*.md | grep -o "besides the [a-z]* real pattern ids"              -> besides the six real pattern ids
```

- Plan 3b.6 and criterion 13 asked for no hand-typed pattern count in row 110. The check was written narrowly (grep "eight real" = 0, true) and misses "six real". QA-15 does not catch a spelled-out number (`node src/qa/completeness-claim-checker.ts` -> PASS, 2 files).
- Minimal fix (plain edit): "besides the real pattern ids in `SECRET_PATTERNS`". Editorial-class, never blocking.

### 3. [SUSPICION][LOW][code-traced] `hash` unlock for the reserved id lost its "no match" signal and prints one hash per decoded variant
- `allowlist-tool.ts:311-314` returns one line for any text; `runHash` (`allowlist-tool.ts:380`) unions across `decodeBlobVariants`, so a BOM'd UTF-16 blob prints both the latin1-reading and UTF-16-reading hash even if the gate timed out on only one. A non-timeout invocation now exits 0 with a hash instead of exit 1.
- Impact: an extra committed hash matches nothing (Issue #235). Fail-safe direction unchanged; disclosed in plan R2. Named so the lanes know the unlock now means "prints a hash", not "confirms a timeout".

### 4. [SUSPICION][LOW][derived] Parallel S6 branch: append-point conflict hazard at wrap-up
- `merge-tree --write-tree --name-only 50dc996 feat/s6-policy-centralization` gives a clean tree today (S6 head `38a4fe2` touches only `src/policy/config/printer.test.ts`). Future hazard: `docs/decisions.md` (append at end), `CHANGELOG.md` (top of `[Unreleased]`) and `docs/run-log.jsonl` (append tail) are same-position append points; both branches adding there will conflict textually. Mechanical: keep both rows. Manager wrap-up owns it.

### 5. [ISSUE][LOW][code-traced] Plan criteria 3 and 4 shipped as one combined control
- Plan section 4 named two tests (first-character-only, last-character-only). Shipped: `oss01-no-value-class-however-written-hides-a-high-byte: catches a first-character-only and a last-character-only narrowing (positive control)`, one test looping over both labels. Coverage equal; only naming and count differ from the plan. Editorial-class.

### Clean seams checked

6. [CLEAN][demonstrated] Completeness claims in the diff. Cell and pattern counts come from the run: `ℹ sweep cells=2048`, `ℹ catalog patterns=10 free-form=2 ascii-only=8` (`t.diagnostic`, not typed). Grep for "both catalog patterns" in `src` = 0. `node src/qa/completeness-claim-checker.ts` -> `PASS: 2 file(s) checked, all completeness claims verified`. The claim "0 of the real allowlist entries" reproduced (grep = 0). CHANGELOG "1095 passed" reproduced (item 11). The only stale count is finding 2.
7. [CLEAN][demonstrated] Red-before-green claim ("the two new #271 tests and the one edited test were red before the code change"). Restored `history-scan.ts` and `allowlist-tool.ts` to `ae6b4f1`, kept the new tests:

```
✖ sb2-hash-lines-computes-the-scan-timeout-pattern-id-without-throwing
✖ oss01-scan-timeout-unlock-hash-does-not-depend-on-this-machines-speed
✖ oss01-a-scan-timeout-grant-does-not-depend-on-which-pattern-was-slow
ℹ tests 3  ℹ pass 0  ℹ fail 3
```

   Tree restored afterwards. Commit history alone cannot show this (tests and code share commit `276c435`, unlike plan section 4 "tests first, red"); the claim is true, demonstrated by this rerun.
8. [CLEAN][demonstrated] Issue discipline. #287 exists: `chore` + `oss`, one-line summary plus evidence links, no milestone, no project item, identical to backlog precedent #234 (same labels, no milestone, no project item). #270 and #271: `bug`, `severity:med`, `oss`, milestone "S1 - Protect the baseline", still OPEN as expected pre-merge. Commits say `Refs #270, #271`, not `Closes`; the merge PR body must carry `Closes #270` and `Closes #271` (CLAUDE.md Issue Discipline rule 2).
9. [CLEAN][code-traced] CLAUDE.md sensitive-area glob (`scripts/secret-scan/*`, Issue #234 open) is stale: no such path exists. Ceremony effect here: none. `src/secret-scan/*` is treated as the sensitive area by precedent; tier CRITICAL was ratified in the run-log (`tier-ratified`, 2026-09-24) with red-team, app-security and this pass; the "fresh dated review report" hard rule is met per lane as each report lands. The stale glob neither lowers nor raises anything.
10. [CLEAN][demonstrated] QA-14/QA-15 exposure of the new prose: `node src/qa/reference-resolver.ts ae6b4f1 HEAD` -> `PASS: 80 citation(s): 70 resolved, 10 unclassified (non-blocking) - 0 failed` (new bare `#270`/`#271` in CHANGELOG are unclassified, non-blocking). QA-15 PASS (item 6).
11. [CLEAN][demonstrated] Gates rerun in this worktree at `50dc996`:

```
npm run typecheck  -> clean
npm run lint       -> clean
node --test        -> tests 1095, pass 1095, fail 0, cancelled 0, skipped 0
node src/secret-scan/history-scan.ts -> PASS: Full history scanned, 0 blocking secret-shaped matches found (2412 allowlisted)
```

12. [CLEAN][code-traced] No other cross-lane ADR collision in the 37-ADR catalog (section 2). Production change is confined to `history-scan.ts:179-183,211-225` and `allowlist-tool.ts:311-314`; `SCAN_TIMEOUT_MS`, `matchAllBounded`, `ci.yml`, allowlist JSON, loader untouched.
13. [CLEAN][demonstrated] Mutation on the real catalog: gave the generic-password value tail a last-position narrowing in `patterns.ts`, ran `patterns.test.ts`: `ℹ pass 17  ℹ fail 4`; the sweep test and two controls went red, as the CHANGELOG claims. Mutation reverted, tree clean.

## 4. Deferred-artifact hygiene

| Item | Verdict |
|---|---|
| decisions.md row shape | Matches the file header columns; `pending` ratification legal per its convention; review-back 2026-10-08 (14 days); cites plan and reports. |
| CHANGELOG entry | Present; every count reproduced (item 11). |
| STATE.md and `.maat-state.json` | Deferred to Manager wrap-up by instruction. Not a finding; DoD is not met until it lands. |
| Plan vs diff | 14 criteria: 1-2, 5-12, 14 have real named checks that pass; 3-4 folded into one control (finding 5); 13 partly met (finding 2). |

## 5. Coverage gaps

- CHANGELOG and `decisions.md` prose: no domain lane owns it except this pass; checked (findings 2, 4).
- The `hash` CLI printed line lost its `pattern=<id>` display text: no doc references it (grep for scan-timeout outside src, tests and reviews finds only the ADR row). Low risk, uncovered by any lane, intentionally fine.
- BOM/UTF-16 behavior of the new unlock: app-security grant-semantics lane may cover it; named in finding 3.

## 6. Verdict

**APPROVE-WITH-CONDITIONS.** No HIGH. No collision with an accepted ADR that the domain lanes would miss.

Conditions (none gate merge; all are edits or human acts):
1. Plain edit: remove "six" from ADR-0002 row 110 (finding 2).
2. Human ratifies or overrules the ADR-0008 "not a broadening" ruling; the row stays `pending` until then (finding 1).
3. Merge PR body carries `Closes #270` and `Closes #271`.
4. Manager wrap-up updates STATE.md and `.maat-state.json`, and resolves the three append-point conflicts when S6 lands (finding 4).

Open findings vs failing tests: 5 open findings (2 ISSUE-LOW, 3 SUSPICION), 0 failing tests. None has an executable form: 1 (interpretive), 2 (prose count, editorial), 3 (accepted behavior), 4 (future textual merge), 5 (naming only). Each is LOW, derived or editorial per the Evidence Policy; none can gate. No `[ISSUE][HIGH]` or `[ISSUE][MED]` exists, so no bug Issue is filed.

Single next action: Manager makes the one-word ADR row edit (condition 1) and proceeds to the red-team and app-security verdicts.

## Editorial
- ADR-0002 row 110 "six real pattern ids" (finding 2).
- Plan section 4 names two controls where one shipped (finding 5).
- Commit `276c435` bundles tests and code, so plan section 4 "tests first, red" is not visible in history.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by blast radius):
1. [SUSPICION][MED][derived] docs/decisions.md last row + history-scan.ts:179-183 - Manager "not a broadening" ADR-0008 reading is interpretive and unwaivable by ADR; 0 existing grants widen (grep 0); resolves to the row's pending human ratification, no code fix.
2. [ISSUE][LOW][demonstrated] docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md:110 - stale hand-typed "six real pattern ids" (catalog = 10); plain edit, editorial-class.
3. [SUSPICION][LOW][code-traced] allowlist-tool.ts:311-314,380 - reserved-id hash unlock prints a hash for any text (no "no match" exit 1) and one per BOM variant; extra hash matches nothing (Issue #235), fail-safe.
4. [SUSPICION][LOW][derived] docs/decisions.md / CHANGELOG.md / docs/run-log.jsonl - same-position append points will textually conflict with S6 at wrap-up (merge-tree clean today).
5. [ISSUE][LOW][code-traced] patterns.test.ts - plan criteria 3 and 4 shipped as one combined control test; coverage equal, naming differs.
6. [CLEAN][demonstrated] completeness claims: counts from t.diagnostic; QA-15 PASS; "both catalog patterns" grep = 0.
7. [CLEAN][demonstrated] red-before claim: 3 tests red (0/3 pass) with prod files restored to ae6b4f1.
8. [CLEAN][demonstrated] Issue discipline: #287 matches backlog precedent (#234); #270/#271 labeled, milestone S1, Refs (not Closes) in commits.
9. [CLEAN][code-traced] stale sensitive-area glob (Issue #234): no ceremony change; CRITICAL ratified by run-log.
10. [CLEAN][demonstrated] QA-14 0 failed (10 unclassified, non-blocking); QA-15 PASS.
11. [CLEAN][demonstrated] typecheck clean, lint clean, npm test 1095/0/0 skipped, oss scan 0 blocking.
12. [CLEAN][code-traced] whole 37-ADR catalog swept; no other collision beyond the ADR-0008/SE-0010 reading (finding 1).
13. [CLEAN][demonstrated] last-position narrowing mutation on the real password pattern turns sweep tests red (pass 17 / fail 4), reverted.
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=2 suspicions=3 clean=8
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=7 code-traced=4 derived=2
checks=typecheck clean; lint clean; node --test 1095 pass / 0 fail / 0 skipped; 3-file secret-scan run 129/0/0; oss:secret-scan 0 blocking; qa14 0 failed; qa15 PASS; red-before 3 fail/0 pass on restored prod; mutation 4 fail/17 pass
adr=HIT(37, whole catalog)
report=docs/reviews/s1-oss01-residuals-270-271-cross-domain-2026-09-24.md
