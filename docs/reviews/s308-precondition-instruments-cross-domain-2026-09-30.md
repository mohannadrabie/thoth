# Cross-domain review: s308-precondition-instruments (773fbc2), 2026-09-30

Reviewer: cross-domain-reviewer (Ra). Tier: STANDARD. HEAD: 773fbc2.

> Persisted verbatim by the Manager as backstop: the reviewer's Bash tool failed mid-run (auto-mode classifier outage, "no verdict"), so it could not self-persist. Content below is the reviewer's own report, unedited.

Ran-nothing caveat: the checks that did run are the three new test files at 773fbc2 (57 pass, 0 fail, 0 skipped). Nothing else was executed, so the findings below are all code-traced or derived.

ADR line: 📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]

## Lanes and ground covered
.maat-state.json is stale (scope s361-hooks-typecheck, CRITICAL), so it does not describe this story.
- STANDARD tier, per the caller.
- Lane reviewers: none reported yet to me. Commit 773fbc2 is test-only, adding 3 test files, CHANGELOG and a plan addendum. No production file changed.
- The whole 37-ADR catalog was read unfiltered. Both the parent plan section 1 and the addendum say no ADR applies to test-only instruments.

## Cross-domain ADR verdict
| ADR | Verdict |
|---|---|
| THOTH-ADR-0001 (fixture standing exception) | No collision. "MUST NOT hardcode an entry of either list in hooks/ or src/" covers the knownConnectors and centralLayer.tools lists. The AP-12 tool names (Bash, SlashCommand, Task, PowerShell, ...) are an exec-tool deny-set, not fixture entries. The instrument reads the fixture through `loadCentralClassificationFixture()`. The fixture has no Bash/Task entry at all (`docs/qa/s5-central-classification.json`, lines 88-89 are comments in the built-in layer). The classes come from `src/policy/tools/builtin-tool-inventory.ts:88,89,94`: Bash, SlashCommand and Task are all workspace-mutating. So tightening to Bash/SlashCommand/Task does not conflict with the current content. |
| ADR-0010 / ADR-0005 (locked tests) | No collision. The diff only adds files and deletes or edits no existing test. |
| THOTH-ADR-0002 (secret-scan allowlist) | Not touched. |
| SE ADR-0021 (POL-12 normalizer registry) | Not touched. |
| Remaining catalog entries (devops/IaC, other SE) | No applicable rule for test-only files. |

No ADR collision. No blocker.

## Seam findings (ranked)

1. [LOW][code-traced] Triple hand-typed copy of the six hook import specifiers.
   - The six-namespace map is typed in three places: `src/policy/config/hook-import-pins.test.ts:34-41` (PINNED_NAMESPACES), `src/policy/config/sanitize.test.ts:231` (PROMISE_ALL_SHAPE, also feeds ALLOWED_SPECIFIERS at 420), and `src/qa/catalog-single-source.test.ts:45` (CATALOG_SPECIFIER).
   - All three assert against the real hook, so drift fails loudly rather than silently splitting. Severity is low because no silent divergence is possible today.
   - Minimal fix: import one exported const, or accept it as is. Deferring is fine.
   - Exposure: not applicable (non-blocking, a maintenance cost on the next hook import change, roughly 3 file edits).

2. [LOW][code-traced] Cross-file dependence between R1-6c and AC-3j-2.
   - `src/qa/catalog-single-source.test.ts:20-22` step 5 assumes the `catalog` binding is never aliased and cites AC-3j-2 as the reason.
   - Both are in the same CI glob (`npm test` runs `node --test`, and the 3 files ran together, 57 pass). If AC-3j is ever relaxed, R1-6c's assumption breaks without a signal.
   - Minimal fix: none needed. The header already names the dependence.

3. [LOW][code-traced] AP-12 tripwire forces a locked-test edit at AP-2.
   - `src/qa/arbitrary-exec-classification.test.ts:81` asserts the AP-12 names are NOT in the vendored inventory. When AP-2's human re-vendor adds PowerShell/Skill/etc., this test fails on purpose ("replace this test"), and the S5 re-vendor step must edit it.
   - That is an explicit recorded act under ADR-0005 territory. The parent plan section 5, step S5 does not mention it.
   - Minimal fix: add one sentence to the plan S5 row: "expect the AP-12 tripwire to fail; rewrite it to assert the real class".
   - The main AP-12 assertion over real layers already covers the newly vendored names once they are classified.

4. [LOW][derived] The AP-12 test "the REAL merge fed a central entry that lowers Task" overlaps `classification-builtin-override.test.ts` R1-1, which already proves lowering throws in `assembleCatalog`.
   - The AP-12 test uses `mergeToolClassificationLayers` directly. It therefore tests the flagging function on a merge result and not the funnel, so there is no drift risk.
   - Overlap is benign.

## Duplication and collision checks (each [CLEAN])
- sanitize.test.ts AC-3 (line 617: hook file only, no process.env/route to env): complementary to AC-3j-4, which scans the transitive relative-import graph. There is no contradiction. AC-3 allows only node:path and node:url in the hook, and the child_process import sits in central-source.ts, not the hook. [CLEAN]
- classification-builtin-override.test.ts R1-6, R1-6b and R1-6d ask who reads the fixture. R1-6c asks who supplies the catalog to the gate. The file header at lines 396-399 named R1-6c as deferred to #308, so this is the intended closure. That stale "deferred" comment sits in a locked test and stays. [CLEAN]
- gate-matcher-drift and kernel-purity: no overlap. This diff touches neither the matcher nor the kernel. [CLEAN]
- CI pick-up: the CI step is `npm test`, which runs `node --test` with the default glob. The three new `*.test.ts` files are discovered the same way as every other test, and they ran under `node --test` here. Path separators are normalised with `path.sep` joins (hook-import-pins.test.ts:231, 412), so Linux CI is not Windows-only. [CLEAN]
- AC-3j-4 extra pins versus the S7-B/#312 rulings and ADRs: parent plan section 3 already lists `child_process` in the scanned set ("process.env, process.cwd, process.argv, child_process"). Only the `projectDir` pin is new, and the addendum discloses it. Decision Q2 approved the transitive pin. AC-3j-4 is consistent with the #312 sanitize/no-env-route stance and no ADR forbids it. [CLEAN]
- CHANGELOG entry: the counts and claims match the code. Coverage-versus-#355 is stated as NOT covered by design, matching the file headers. It makes no hand-typed "all N" completeness claim; the enumerated sets are produced by scans at run time. [CLEAN]

## Plan table needs updating (Editorial, verdict-neutral)
`docs/plans/s308-activation-phase1-2026-09-30.md`:
- Line 40, AP-12: "No mechanical check found" is now stale. The instrument exists, but the five named tools are absent from the vendored inventory. Status should read "PARTLY MET: instrument built (773fbc2); real non-read-only assertion pending AP-2".
- Line 62, X-15 and line 64, X-17: the R1-6c instrument and the coverage statement now exist (`src/qa/catalog-single-source.test.ts`). Move both to MET, with the shapes 3/4 statement recorded.
- Line 67, X-20: AC-3j is built (`src/policy/config/hook-import-pins.test.ts`). Mark it MET.
- Line 38, AP-10: still NOT MET and unchanged, since it needs AP-1 rules. The `activation-preconditions` test is not built and out of scope for this commit.
- Line 102 (AC-3j-4 pin set): section 3 says the allow-set is `{SystemRoot, windir}` only. The build pins two more entries, the `child_process` import and `projectDir`. The addendum discloses both, but the parent text is now behind the build.
- Addendum wording: "child_process import ... disclosed additions" is slightly overstated, because the parent plan's line-102 scan list names `child_process`. The `projectDir` entry is the true addition.
- The parent plan's tally line says "Hand tally ... for orientation only", so keep it away from any gate.

## Coverage gaps
- CHANGELOG and plan addendum: prose, low risk, covered by this pass.
- No lane claims "instrument-of-the-instrument" quality, i.e. whether the seeded mutants are real. The build reported failing-first proofs; I did not re-run them.
- The launcher (AP-13), AP-2/3/7 human rulings and the settings.json entry are out of this diff and correctly uncovered.

## R4 pre-commit-scan EBUSY comparison
- Not settled. My first attempt ran chained commands in the background and printed nothing, possibly hitting the 120 s timeout. Bash then failed permanently before I could rerun.
- The worktree ended on the older commit, c97d35b (last observed `git rev-parse`), with 773fbc2 not restored. Nothing in it is unique work.
- The test at `src/secret-scan/pre-commit-scan.test.ts:201,232` clones the real project repo. Clone plus a junctioned `adr` submodule in my worktree is a likely source of Windows file-lock EBUSY. This is derived, not demonstrated.
- Unproven; task for the Manager: in the main tree, run `node --test src/secret-scan/pre-commit-scan.test.ts` at 773fbc2 and at c97d35b, output to a file, and compare.

## Verdict
APPROVE. No ADR collision. No seam finding above LOW. The three instruments run green (57/57), the CI glob picks them up, and duplication with existing instruments is complementary or benign.

RECEIPT: verdict=APPROVE
findings:
1. [ISSUE][LOW][code-traced] hook-import-pins.test.ts:34 / sanitize.test.ts:231 / catalog-single-source.test.ts:45 — six hook import specifiers hand-typed in three files; all assert against the real hook so drift fails loudly; optional single shared const.
2. [ISSUE][LOW][code-traced] arbitrary-exec-classification.test.ts:81 — AP-12 tripwire fails by design at the AP-2 re-vendor and forces a locked-test edit; add one sentence to plan S5.
3. [ISSUE][LOW][code-traced] catalog-single-source.test.ts:20-22 — R1-6c step 5 depends on AC-3j-2's no-alias guarantee; both run in the same CI glob, header names the dependence.
4. [SUSPICION][LOW][derived] arbitrary-exec-classification.test.ts:95 — lowering mutant overlaps R1-1 in classification-builtin-override.test.ts; benign.
5. [CLEAN][code-traced] THOTH-ADR-0001 / ADR-0010 / ADR-0005 / THOTH-ADR-0002 / ADR-0021 — no collision; tool names are not fixture entries; additions only.
6. [CLEAN][code-traced] sanitize.test.ts:617 AC-3 vs AC-3j-4 — complementary, hook-only versus transitive graph.
7. [CLEAN][code-traced] classification-builtin-override.test.ts R1-6/6b/6d vs R1-6c — reads versus supplies; the deferred comment at 396-399 is closed by this commit.
8. [CLEAN][demonstrated] CI glob pick-up — 3 new files ran under `node --test`, 57 pass, 0 fail, 0 skipped; separators normalised.
9. [CLEAN][code-traced] AC-3j-4 extra pins / AP-12 tightening vs the #312 rulings and the fixture — no contradiction; Bash/SlashCommand/Task are workspace-mutating in the built-in layer.
10. [CLEAN][code-traced] CHANGELOG / QA-15 claims — accurate, no hand-derived completeness claim.
counts: issues=3 suspicions=1 clean=6
evidence: demonstrated=1 code-traced=8 derived=1
checks=3 files (hook-import-pins, arbitrary-exec-classification, catalog-single-source) 57 pass / 0 fail / 0 skipped at 773fbc2; pre-commit-scan R4 comparison NOT run (Bash tool failed)
adr=HIT(37, whole catalog)
report=docs/reviews/s308-precondition-instruments-cross-domain-2026-09-30.md
