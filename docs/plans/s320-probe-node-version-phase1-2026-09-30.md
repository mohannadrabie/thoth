# #320 systemroot-nonexistent probe row is Node-version dependent: Phase 1 plan (2026-09-30)

Branch: `s7/closeout` (no switch, no commit). Author: story-implementer (Ptah), Phase 1 only. Nothing is built.
Sources: `gh issue view 320 --json body,comments` (no comments); `docs/decisions.md` 2026-09-30 intake-answers row, item (3); `src/qa/gate-fail-open-probe.ts`; `src/qa/gate-fail-open-probe.test.ts`; plan s7a A5.
ADR cache: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`

## 1. Readiness and restatement

Readiness: PASS. The Manager's ruling settles the only fork (either outcome accepted, no skip, keep the residual/launcher wording, any third outcome fails).

Restatement: make the win32-only probe row `systemroot-nonexistent` record that both PROCEEDS (launcher-owned residual, #308) and BLOCKS (fail closed) are acceptable observations, so G9 passes on Node 22.18 and 24.15 on Windows, while any other outcome, and every other row, still fails exactly as before.

## 2. Host facts (measured now)

- Local Node: v24.15.0 (`C:\Program Files\nodejs\node.exe`). Only this version is installed on the host as far as `where node` shows; Node 22.18 is not available here, so the BLOCKS path cannot be observed locally.
- Outcome this host produces: PROCEEDS (exit 134, empty stdout, Node aborts in `InitializeOncePerProcess`). G9 passes today here (12/12 in `gate-fail-open-probe.test.ts`), matching the issue: the failure only shows on 22.18.
- Where the code lives: table `RECORDED_DECISIONS` at `src/qa/gate-fail-open-probe.ts:65` (row at line 70; the probe call at line 160); G9 at `src/qa/gate-fail-open-probe.test.ts` (line ~43); A5 asserts the row is `expect: PROCEEDS`, `probed`, `ap: AP-13`, note has "residual" and "launcher" (line ~73).

## 3. ADR review

Catalog read via the cache line above (37 ADRs). This story changes one QA probe record and its test; no hook, policy loader, guard, secret-scan or CI file. No ADR rule found that applies beyond the project rule that an accepted ADR outranks CLAUDE.md; nothing UNCLEAR. I did not open each ADR file for this Phase 1; the Manager should treat this as NOT-APPLICABLE by scope (a test-table tolerance), and flag it if the catalog has a probe/evidence ADR I should have quoted.

## 4. Acceptance criteria (named tests)

Derived criteria are marked (D). None is load-bearing on an unknown.

| # | Criterion | Named check |
|---|---|---|
| AC1 | The row type can record an additional accepted outcome; `expect` stays the primary recorded decision (PROCEEDS) | `G9` (compiles and passes on this host); new test `A20 systemroot-row-accepts-either-launch-outcome` asserts the row has `expect: PROCEEDS` and `alsoAccepts: ["BLOCKS"]` |
| AC2 | G9 passes when the observed outcome for `systemroot-nonexistent` is PROCEEDS or BLOCKS | `G9` on Node 24.15 (PROCEEDS, run here); new pure-function test `A21` on the acceptance predicate with (PROCEEDS, BLOCKS) both accepted (covers the 22.18 path without needing 22.18) |
| AC3 | Any outcome outside the accepted set still fails G9 (third outcome) | `A21` asserts the predicate rejects a value outside the set, using a synthetic row with `expect: PROCEEDS`, `alsoAccepts: ["BLOCKS"]` and a fabricated observed value; also asserts a row with no `alsoAccepts` still accepts only its `expect` (D: guards every other row's strictness) |
| AC4 | Every other row is unchanged: exact-match on `expect` | `G9` (loop over all observed rows) plus `A21` no-`alsoAccepts` case |
| AC5 | No skip: the row is still probed on win32 and `recorded row ... was never probed` still fires | `G9` second loop unchanged; `A5` still requires `probed: true` |
| AC6 | Row keeps `ap: "AP-13"`, and its note keeps "residual" and names the launcher / #308; the note gains a sentence that BLOCKS is also accepted (Node 22.18 runs the hook and denies; Node 24.15 aborts, exit 134) | `A5` (unchanged assertions, still passes); `A20` matches `/BLOCKS/` and `/22\.18/` in the note (D) |
| AC7 | The PROCEEDS-list assertion in G9 counts `systemroot-nonexistent` only when it was actually observed PROCEEDS: expected list is built from the recorded rows, with the win32 row included only if observed PROCEEDS | `G9` final `deepEqual`, verified on 24.15 (row observed PROCEEDS, in list); the BLOCKS branch is covered by the shared predicate in `A21` and by reading, not by a live 22.18 run (see risk) |
| AC8 | The "PROCEEDS rows carry an AP" rule keeps applying (row is `expect: PROCEEDS`); the "BLOCKS rows carry no AP" rule keys on `expect` only, so this row does not trip it when it observes BLOCKS | `G9` rule loop; `A20` (D) |
| AC9 | Full `qa:` gate and `npm test` for the probe files stay green with real counts | `node --test src/qa/gate-fail-open-probe.test.ts` and the repo's usual test run |

## 5. Risk tier

Proposed: **STANDARD**. Justification: it loosens one assertion in the probe that records the fail-open evidence (SUR-10), so it must be reviewed, but it changes no hook, gate or policy behavior, adds no new capability, and the loosening is bounded by a human ruling to one row and one extra outcome (the extra outcome is the safer one). Not TRIVIAL because it touches the evidence surface; not CRITICAL because nothing enforceable changes. The Manager ratifies and persists.

## 6. Sensitive areas and reports required

- Evidence / audit trail (assurance evidence, SUR-10 probe table): `src/qa/gate-fail-open-probe.ts` and its test record what the gate does on launch faults. This is a QA record, not the audit-log hook (not yet built), but it is the incapability evidence CLAUDE.md names, so treat as touched.
- Not touched: `hooks/*`, `scripts/guard/*`, `src/policy/*`, CI, secret scanning, policy delivery.
- Reports: one domain reviewer, `code-reviewer` (test correctness: the tolerance cannot mask a third outcome), plus the standing `cross-domain-reviewer` (every tier above TRIVIAL). A fresh dated report in `docs/reviews/` is required by the hard rule for the evidence surface; no `red-team` at STANDARD unless the Manager raises the tier.

## 7. Blocking questions

None. One non-blocking note for the Manager: Node 22.18 is not installed on this host, so the BLOCKS branch cannot be seen live here. The plan covers it by testing the acceptance predicate directly (AC2, AC3). If a live run is wanted, install 22.18 (for example via `npx node@22.18`) and run G9 once; I will not install anything without a go-ahead.

## 8. Plan

Test-first dispatch check: this story has NO new or changed UI flow or API surface (a test-table tolerance in an internal QA module). `test-writer` is NOT dispatched. The failing tests come from the implementer (Step 1).

Files: `src/qa/gate-fail-open-probe.ts`, `src/qa/gate-fail-open-probe.test.ts`. No other file. (STATE.md and CHANGELOG entries at the Manager's close-out as usual.)

Design (minimal, about 20 lines):
1. In `RecordedDecision` add `alsoAccepts?: readonly FaultOutcome[]` with a comment: extra outcomes that are accepted for a fault whose result depends on the runtime version; `expect` stays the primary decision.
2. Export a pure `outcomeAccepted(row, observed): boolean` returning `observed === row.expect || (row.alsoAccepts ?? []).includes(observed)`.
3. Row `systemroot-nonexistent`: keep `expect: "PROCEEDS"`, `probed: true`, `platform: "win32"`, `ap: "AP-13"`; add `alsoAccepts: ["BLOCKS"]`; extend the note (keep the existing "residual, owned by the launcher (Issue #308)" wording) with: "Node 22.18 starts and the hook denies (BLOCKS, fail closed, strictly safer); Node 24.15 aborts (PROCEEDS); either is accepted (human ruling 2026-09-30, #320)".
4. G9: replace the `assert.equal(o.outcome, r.expect ...)` with `assert.ok(outcomeAccepted(r, o.outcome), ...)` (message keeps observed, recorded and the accepted set). Build `expectedProceeds` so the win32 row is included only when it was observed PROCEEDS (derive: the fixed four plus `systemroot-nonexistent` iff observed on win32 as PROCEEDS), and assert that when observed BLOCKS it is not in the list. Leave the AP rules keyed on `expect`.

Steps:
- Step 1, failing tests first (red, recorded): add `A20` and `A21` (they fail to compile or assert until step 2, since `outcomeAccepted` and `alsoAccepts` do not exist). Record the red counts.
- Step 2, implement items 1 to 4. Run `node --test src/qa/gate-fail-open-probe.test.ts`; expect G9, A5, A20, A21 green (14 tests, up from 12).
- Step 3, run the wider test suite and lint/typecheck/fmt as the repo defines; report real counts.
- Step 4, PR skeleton: story, AC checklist, constraints honored (no skip; no hook change; wording kept), evidence, review chain (code-reviewer, cross-domain-reviewer).

Rollout/rollback: test-only and record-only; revert the commit. No runtime behavior change; nothing to flag or deploy.

Constraints honored: no skip (skipped is not passed); row still probed; residual/launcher-owner wording kept (A5); third outcome still fails; no edit to any `test-writer` file (none exists); the completeness of "every other row unchanged" is asserted by the running G9 loop, not by prose.

Out of scope (goes to #308): the launcher-fault fix (mapping every exit other than 0 and 2 to 2).

RECEIPT: verdict=PLAN-READY criteria="9/9" tier=STANDARD(proposed) adr=HIT(37) blocking-questions=0 test-first=not-dispatched(no UI/API surface) pr=n/a
