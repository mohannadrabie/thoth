# Cross-Domain Review (Ra) — s6-policy-residuals-112-124 (2026-09-24)

[cross-domain-reviewer]
Cross-Domain Reviewer (Ra) — scanning the seams between reviewer lanes

Tier CRITICAL. Target: `8e65a2b` (detached), diff `ae6b4f1..8e65a2b`, 14 files: 4 production (`loader.ts`, `rule-types.ts`, `precedence.ts`, `schema.ts`), 4 test files, 6 docs. Issues #112, #124 (addressed), #107 (ratified residual, no code).

`📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 1f5bc09) [CACHE=HIT]` — whole catalog read, unfiltered.

## Verdict: APPROVE-WITH-CONDITIONS

No ADR collision, no blocking seam. One MED suspicion (how #112 gets closed) and one LOW merge hazard. Everything else I attacked is clean.

## Lanes that ran, and what I did not redo

- `red-team` (branch `review/red-team-s6-112-124`, go): tighten-only matrix (243 cells), hostile keys, voided-layer, pin, kernel purity, five mutants. Filed #292 (posture invisible; #288 unbound).
- `app-security-reviewer` (branch `review/appsec-s6-112-124`, APPROVE-WITH-CONDITIONS): 27-cell trust matrix, schema probes, secret scan, the partial-dump oracle gap.
- Named by them, so NOT re-listed here: the #124 oracle bounds only a whole-file dump; posture invisible on operator surfaces; #288 has no milestone/severity/precondition (#292); peers let project relax a shipped-defaults deny; a declared posture is inert until the hook is rewired.

## Cross-domain ADR verdicts (whole catalog, checked against the code)

| ADR | Verdict | Evidence |
|---|---|---|
| SE ADR-0021 (POL-11 kernel purity) | COMPLIANT | New `import type { VerdictOutcome } from "./verdict.ts"` in `src/policy/kernel/rule-types.ts`. The structural test is the enforcement the ADR names. `node src/qa/kernel-purity-check.ts` -> `PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.` `node --test src/qa/kernel-purity-check.test.ts` 53/53. `kernel.ts` unchanged (POL-05 still precedes any posture). |
| SE ADR-0002 (layering) | COMPLIANT | grep for imports from `../config` in non-test `src/policy/rule/*.ts` -> empty: `rule/` never imports `config/`. The `"bootstrap"` fallback lives in `config/loader.ts`, as `precedence.ts` says. |
| SE ADR-0003 (SOLID/YAGNI) | COMPLIANT (advisory) | The YAGNI line is SHOULD-level and targets speculative interfaces. The key is not speculative: it is the ask of an open MED Issue (#112) and POL-01, and its non-consumption is disclosed (D3, #288). No new interface; one 16-line function reusing `TRUST_RANK`. |
| SE ADR-0005 (testing) | COMPLIANT | Tests written first, red at HEAD (32 red plus 7 green-by-construction per the test-writer report), green after. No user-facing flow and no mutating op (pure function), so no Playwright or idempotency obligation. |
| SE ADR-0010 (quality) | COMPLIANT | `npx tsc --noEmit -p tsconfig.json` exit 0, no output; `npx eslint src/policy/kernel src/policy/rule src/policy/config` exit 0, no output; no lint ignore, no `.skip`; the `printer.test.ts` amendment tightens a wildcard (the deleted lines are the wildcard), it deletes no test. |
| SE ADR-0016/0019/0020 (port fidelity, self-protection) | COMPLIANT | ADR-0020 flags that `precedence.ts`/`schema.ts`/types have no lint override and must have a structural test or explicit discipline-only acceptance. The kernel-purity structural test covers `rule-types.ts`; `precedence.ts` and `schema.ts` sit outside the kernel root and import only from it. |
| THOTH-ADR-0001/0002, devops 0004/0008/0009 | N/A / COMPLIANT | Neither `docs/qa/s5-central-classification.json` nor the secret-scan patterns are touched. `node src/secret-scan/history-scan.ts` -> `PASS: Full history scanned, 0 blocking secret-shaped matches found (2380 allowlisted).` Devops ADRs are IaC-scoped; nothing in the diff. |

No ADR-violation blocker.

## Seam findings

### 1. [SUSPICION][MED][code-traced] `Closes #112` would close an Issue whose stated harm is still true in effect

Domains in tension: the policy-format lane (schema + loader, done) and the enforcement lane (kernel-gate hook, untouched).

Issue #112's body: "A central admin cannot mandate deny-by-default". After this diff the loader can resolve a central deny, but nothing acts on it:
- The only production caller of `loadEffectivePolicy` is `printEffectivePolicy` (`src/policy/config/printer.ts:108`), a diagnostic CLI. A grep for `loadEffectivePolicy|printEffectivePolicy` over `hooks` and `src` (non-test) returns loader, printer and print-cli only.
- `hooks/pretooluse-kernel-gate.mjs:118-119` still passes `defaultOutcome: BOOTSTRAP_DEFAULT_OUTCOME` (`"allow"`); the hook is byte-identical to before.
- Demonstrated resolution (real `loadEffectivePolicy`, temp policy files, throwaway script deleted afterwards): central `deny` + project `allow` -> `{"outcome":"deny","source":"central"}`; nothing declared anywhere (central absent, the default deployment) -> `{"outcome":"allow","source":"bootstrap"}`; shipped `deny` + project `allow` -> `allow/project`; central `allow` + project `deny` -> `deny/project`; `null`, `"Deny"` and a duplicate key are rejected fail-closed with the field's own error. So the mandate exists in the data model and does not exist at the enforcement point.

The residual IS honestly disclosed: decisions row D3 ("result field only ... nothing consumes it yet"), the CHANGELOG bullet, the `LoadSuccess`/`ResolvedPosture` doc comments, the backlog RESOLVED note, and #288. What is unsettled is the Issue-closure semantics. CLAUDE.md Issue Discipline: an Issue closes only when its work is genuinely done. #112's title claim (expressible in no tier) is fixed; its body claim (admin cannot mandate) is not, until the hook consumes the field.

Exposure: ~0% of enforcement decisions today, basis: counted in code (no enforcement caller; no shipped policy file declares the key). The risk is status overstatement, not runtime behavior.
Minimal fix: the PR body may say `Closes #112` only with a same-turn comment on #112 stating that the operational mandate is carried by #288 (and #292's precondition), or use `Refs #112` and let the hook-rewiring story close it. Human/Manager call; both are honest.
Executable form (belongs to the hook-rewiring story, red today by design, not a condition on this PR): `pretooluse-kernel-gate: a central defaultOutcome "deny" denies a non-matching, non-mutating action`.

### 2. [ISSUE][LOW][demonstrated] Append-point merge conflicts with `fix/s1-oss01-residuals-270-271` (and among the review branches)

`git merge-tree --write-tree --name-only 8e65a2b fix/s1-oss01-residuals-270-271` printed:
```
CONFLICT (content): Merge conflict in CHANGELOG.md
CONFLICT (content): Merge conflict in docs/decisions.md
CONFLICT (content): Merge conflict in docs/run-log.jsonl
```
One hunk each (merged-tree markers at `docs/run-log.jsonl:90-94`, `docs/decisions.md:82-87`, `CHANGELOG.md:7-28`), all adjacent appends; zero conflicts in `src/`, `hooks/` or tests. Resolution is mechanical: keep both sides, the rows and lines are independent. Separately, `review/red-team-s6-112-124` and `review/appsec-s6-112-124` each append a `docs/REVIEW_LOG.md` row and conflict with each other (`merge-tree` -> `CONFLICT (content): Merge conflict in docs/REVIEW_LOG.md`); mine will as well. Same fix.
Exposure: 100% of whichever PR merges second, basis: measured (merge-tree). Cost: minutes; no data loss.
Executable form: none (procedural); settled when `merge-tree` reports no conflict after the second PR rebases.

## Clean seams (checked, sound)

3. [CLEAN][demonstrated] DoD "test-writer tests GREEN, UNMODIFIED": the diff `51bcefd..8e65a2b` over `src/policy/**/*.test.ts` and `src/policy/config/printer.test.ts` is empty (no output). Both test-writer commits (38a4fe2 for #124, 51bcefd for #112) are ancestors of the build commit and untouched by it.
4. [CLEAN][demonstrated] Node 22.18.0 (CI's version) settles red-team finding 10 (their UNPROVEN). Installed v22.18.0 locally: `node --test src/policy/config/printer.test.ts` -> `# tests 13 # pass 13 # fail 0`; the #112 test files plus `precedence.test.ts` 127/127; full `node --test` 1130/1130 on the last two runs. The first full run on 22.18.0 showed 1129 pass / 1 fail with the failing test not identified (not in this diff's files, not reproduced on two further full runs); noted, not attributable.
5. [CLEAN][demonstrated] Independent mutants (mine, not the implementer's), each turned tests red and was restored: `precedence.ts` `<` -> `<=` (4 red), `tightens` inverted (7 red), resolve over `layers` instead of `acceptedLayers` (3 red), source retained on tighten (14 red), peers hardcoded by layer name (4 red); `loader.ts` central posture dropped in `namedLayer` (2 red), fallback source flipped (2 red), project posture dropped (2 red); #124: raw file text appended to the json-parse-error message -> `printer.test.ts` 5 red / 8 green. Tree clean after each (`git status --short` empty).
6. [CLEAN][demonstrated] CI-gate parity: `node --test` 1130 pass, 0 fail, 0 skip on Node 24.15.0 (the known gate-manifest environmental failure did not occur here); `node src/qa/reference-resolver.ts ae6b4f1 8e65a2b` -> `PASS: 203 citation(s): 182 resolved, 21 unclassified (non-blocking) — 0 failed`; `completeness-claim-checker.ts` -> `PASS: 2 file(s) checked, all completeness claims verified`; recurring-findings PASS; normalizer-registry-purity PASS. QA-14/QA-15 exposure of the new prose: none.
7. [CLEAN][code-traced] Issue Discipline: #112 and #124 carry `bug`, `severity:med`, `pol`, milestone "S6 — Policy centralization" (`gh issue list` JSON). #107 stays OPEN with milestone and labels; its ratified-residual row matches the red-team round-2 comment on #107 (exit code 1 for every failure, measured). Commits cite `Issue #112` / `Issue #124` with no `Closes` yet: the PR body must carry the closing refs, subject to finding 1. #288 was filed with `chore`+`pol` and no milestone (red-team's #292 names this; not repeated).
8. [CLEAN][code-traced] Decisions rows: six columns each (matches the header at `docs/decisions.md:12`), `Human ratified: pending`, evidence cited. Row 1's review-back is a trigger not a date (`docs/decisions-archive.mjs` leaves unparseable dates in place, "conservative") with a 2026-10-24 backstop; row 2 is 2026-10-08. D1 (implicit lock, deviating from red-team's "may mark it mandatory") is recorded honestly: it names the deviation, keeps the test name verbatim as the umbrella (`src/policy/config/loader.test.ts:691`), and states red-team's alternative branch was not taken. The cost of the choice is stated ("central cannot declare a posture a lower layer may relax").
9. [CLEAN][code-traced] Plan-vs-diff fidelity: A1-A11 and B1-B18 each have a named check or command in the plan; the test-writer report maps them and I re-ran the commands (typecheck, lint, kernel-purity, full suite, hook 0-byte diff). A10's "12 tests" became 13: the test-writer report (line 60) records it as a deviation because the dispatch asked for the named `ISSUE-123(b)` proof-test, which is the only added `test(` in the diff. Fine.
10. [CLEAN][demonstrated] POL-01 acceptance ("changing a forbidden action ... is a configuration change plus a fixture"): met for the policy format; the hook-side residual is disclosed in the places listed under finding 1. `ENFORCEMENT_DISCLOSURE` (`printer.ts:30`) is generic and does not name the posture; that is red-team #2 / #292, not repeated.

## Coverage gaps

- No reviewer lane owns "does an enforcement path exist for a central posture". Intentional (unwired hook, #288), not a review gap; the red-today test named in finding 1 is its future form.
- `docs/STATE.md` and `docs/.maat-state.json` are outside every lane and unchanged: `STATE.md:459` still lists #112 as an open POL-01 code literal, and `.maat-state.json` `scope` is still `qa14-ci-red-citation-wording` (the new tier is recorded only in `docs/run-log.jsonl`). Manager ship-close items (DoD: STATE updated); low risk.
- Fresh dated review reports: the sensitive-area hard rule needs them in `docs/reviews/` of the PR branch. They currently sit on three separate `review/*` branches (red-team, app-security, this one), not on `feat/s6-policy-centralization`. Bring them onto the PR branch, resolving the `REVIEW_LOG.md` append conflict (finding 2).
- `docs/run-log.jsonl` one-line append and the CHANGELOG/backlog prose: intentionally low-risk, no lane needed.

## Editorial (verdict-neutral, plain edits)

1. `docs/decisions.md` row 2 and `CHANGELOG.md` say the kernel is "byte-unchanged"/"unchanged"; `src/policy/kernel/rule-types.ts` gained 7 lines (a type-only import and an optional field; the diff stat over `src/policy/kernel` shows exactly that file). `kernel.ts` (the logic) is unchanged. Say "kernel logic (`kernel.ts`)".
2. Row 2 point (5) and the CHANGELOG cite "the story's build report" for the seven-mutant results; no such file exists in `docs/reviews/` at `8e65a2b`. I re-derived nine mutants independently (finding 5); persist the implementer's own or drop the pointer.
3. Row 2 ends "Post-build ... cross-domain-reviewer reports are still to come; this row is not final until they land." That becomes stale as these reports land; append a follow-up row per the supersede-in-place convention.
4. `docs/backlog.md` #108 row: the edit added the path prefix `src/policy/config/` to `printer.test.ts:272` for QA-14, but line 272 is not the "central policy load failed" regex at either `ae6b4f1` (a fixtures comment) or `8e65a2b` (a header comment); the pointer was already stale. Cite the test name instead of a line.
5. `src/policy/config/loader.test.ts:691`'s test name says a central layer "may mark it mandatory"; the body proves the trust-rank lock (D1). A one-line comment above it saying so would save the next reader a search.

## Findings to failing tests

Open findings: 1 [ISSUE][LOW] (finding 2) and 1 [SUSPICION][MED] (finding 1); failing tests in this PR: 0. Neither is a defect in this diff's code. Finding 1's executable form is the hook-level test named above, red by design, owned by the hook-rewiring story (#288/#292). Finding 2 has no executable form (procedural merge conflict), settled by the second PR's rebase.

## Single next action

Manager: before opening the PR, (a) decide `Closes #112` vs `Refs #112` per finding 1 and comment on #112 either way, (b) bring the three review reports onto the PR branch, and (c) resolve the append conflicts against the S1 branch by keeping both sides.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [SUSPICION][MED][code-traced] hooks/pretooluse-kernel-gate.mjs:118-119 + src/policy/config/printer.ts:108: loader resolves a central deny but no enforcement path calls it (only the diagnostic CLI), so "Closes #112" overstates "admin cannot mandate deny-by-default"; fix = comment on #112 pointing to #288/#292, or use Refs #112
2. [ISSUE][LOW][demonstrated] CHANGELOG.md, docs/decisions.md, docs/run-log.jsonl: merge-tree vs fix/s1-oss01-residuals-270-271 gives 3 single-hunk append conflicts (plus REVIEW_LOG.md across review branches); fix = keep both sides
3. [CLEAN][demonstrated] ADR sweep over all 37: SE-0021 kernel purity (qa:kernel-purity PASS, 4 files), SE-0002 layering (rule/ imports no config/), 0003/0005/0010/0016-0020, THOTH-0001/0002, devops 0004/0008/0009: no collision
4. [CLEAN][demonstrated] DoD: diff 51bcefd..8e65a2b over all test files is empty; test-writer tests unmodified
5. [CLEAN][demonstrated] Node 22.18.0 (CI) settles red-team #10: printer.test.ts 13/13, full suite 1130/1130 on rerun (one earlier unidentified transient 1129/1)
6. [CLEAN][demonstrated] 9 independent mutants (5 precedence, 3 loader, 1 #124 dump) each turn tests red; tree restored clean
7. [CLEAN][demonstrated] CI-gate parity: tsc/eslint clean, 1130/1130, QA-14 0 failed, QA-15 PASS, history-scan 0 blocking
8. [CLEAN][code-traced] Issue Discipline: #112/#124 labels+milestone correct, #107 open with residual row matching red-team round-2 comment; PR body must carry closing refs (commits use "Issue #N" only)
9. [CLEAN][code-traced] decisions rows: 6 columns, pending ratification, D1 deviation honestly recorded, review-back triggers/dates valid
10. [CLEAN][code-traced] plan-vs-diff fidelity A1-A11/B1-B18; 13 vs 12 tests is a recorded test-writer deviation
11. [CLEAN][demonstrated] POL-01 acceptance: format met; hook-side residual disclosed in decisions row, CHANGELOG, loader comments, backlog, #288
counts (a CHECKSUM): issues=1 suspicions=1 clean=9
evidence (a CHECKSUM): demonstrated=7 code-traced=4 derived=0
checks=node --test 1130 pass/0 fail/0 skip (Node 24.15.0); 1130/0/0 (Node 22.18.0 rerun; one earlier full run 1129/1 unidentified, not reproduced); tsc exit 0; eslint exit 0; QA-14 0 failed; QA-15 PASS; kernel-purity PASS; history-scan 0 blocking; 9 mutants killed
adr=HIT(37, whole catalog)
report=docs/reviews/s6-policy-residuals-112-124-cross-domain-2026-09-24.md
