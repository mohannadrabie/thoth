# Cross-domain review, round 3: s312-fixnow-360-363 fix-now delta (Issues #360, #367, #368)

Reviewer: cross-domain-reviewer (Ra). Tier: CRITICAL. Date: 2026-09-29. HEAD: e63cd4b (delta `12a4454..e63cd4b`, 6 commits, 7 files; `hooks/*.mjs` and `.github/workflows/ci.yml` zero diff, counted by `git diff --stat`).
Checks ran in an own `git worktree` (detached at e63cd4b), no commits or pushes.

ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp 13c1476) [CACHE=HIT]. Whole catalog read, unfiltered.

## Lanes
- Running alongside: red-team and app-security-reviewer (attack surface: guard bypasses, suppression class, ratchet gaming). Not re-covered here.
- My ground: SE ADR-0010 / ADR-0005 test integrity, devops ADR-0008 ratchet-only, THOTH-ADR-0001/0002, SE ADR-0021, instruments keyed off JSON shape, lint scope, record accuracy, CI wiring.

## ADR verdicts (whole catalog)
| ADR | Verdict | Evidence |
|---|---|---|
| SE ADR-0010 (no test deleted/weakened, no lint ignore broadened) | CLEAN | Title-diff script over both test files, 12a4454..e63cd4b: exactly 2 titles gone from sanitize.test.ts, both the deliberate AC-7/AC-7c (reworded to "no alias") and AC-7b (flipped to "REJECTED"). Zero titles removed since the RED commit 463ad9a in either test file. hook-typecheck-coverage-check.test.ts has 0 diff lines. Lint delta bans more, broadens nothing. |
| SE ADR-0005 (MUST NOT delete/weaken a failing test) | CLEAN | Same script. The flip strengthens the guard (alias hoist now rejected). |
| devops ADR-0008 (MUST NOT broaden suppression/ignore lists, ratchet only) | CLEAN on the CI path; see F1 | Existing snapshot: --regenerate-baseline refuses a new identity (probe below). |
| SE ADR-0021 (POL-11/12, kernel purity), SE ADR-0002 | CLEAN | Delta touches no kernel/registry file; qa:kernel-purity PASS. |
| THOTH-ADR-0001 / THOTH-ADR-0002 (allowlists) | CLEAN | No fixture or secret-scan allowlist change; history-scan rc=0 (all matches already allowlisted); snapshot excerpts are code lines only. |
| Remaining ADRs (devops 0001-0010 IaC/cost/tags, SE 0001/0003/0004/0006-0009/0011-0020) | Not applicable to the changed files | No infra, schema, tagging, or governance-plugin-tree file in the diff. |

## Seams checked

**Snapshot generated, not hand-typed (CLAUDE.md no-hand-derived-completeness).** `node src/qa/hook-typecheck-coverage-check.ts --regenerate-baseline` on the clean tree: "0 identity(ies) paid down, 0 added", JSON unchanged (byte-identical to the committed file). Totals 30 and 22 reproduce (qa:hook-typecheck-coverage PASS).

**Ratchet-only, existing snapshot.** Planted one new type error (`zzProbe.nope();`) in hooks/userpromptsubmit-halt-relay.mjs: regenerate printed `ADDED ... (+1)`, "REFUSED ... only ratchets DOWN", snapshot untouched; qa:hook-typecheck-coverage reported "1 identity(ies) exceed the pinned baseline ... NEW regression". Reverted.

**Other instruments keyed off JSON shape.** Repo-wide .json walkers in src/qa/: only gate-manifest-check.ts (listFilesRecursive with a .json filter, top-level `hooks` key). Other .json readers name fixed paths. qa:gate-manifest PASS: "Exactly 1 gate manifest found". The `pinned` rename holds.

**Lint scope.** noInlineConfig sits inside the hooks/**/*.mjs + hooks/**/*.js block. Probes: hooks/zz-probe.js with an eslint-disable ban-ts-comment block comment plus a ts-ignore pragma gives the ban error and "no effect because you have noInlineConfig"; hooks/zz-probe2.mjs eslint-disable-next-line no-undef ignored, error stands; src/zz-probe.ts with the same disable comment is still honoured (only an "unused directive" warning). No .js file exists under hooks/ today (git ls-files hooks), so the glob widening changes nothing on the real tree. Probes deleted.

**Fail-loud for a new hook.** A new hooks/zz-new.js is listed by listProductionHooks and fails "does not resolve inside tsconfig.hooks-coverage.json's file list" (the tsconfig include is a fixed 3-file list). Fails closed.

**CI wiring.** `npm test` is `node --test` (no file list); the new hook-typecheck-coverage-check.fixnow.test.ts ran in the full suite (its titles are in the output). The ci.yml QA-18 step runs the check with no args, so it needs no new step and cannot trigger the regenerate path.

**CHANGELOG / STATE claims vs code.** Zero diff hooks+ci.yml: confirmed. 14 AC-7d bypass shapes: 14 "AC-7d ... REJECTS" results in the run. 30/22: confirmed. Flag refusal, removals allowed, printed added/removed, suppression refusal, no-snapshot bootstrap: confirmed in code and by the N3 regenerate tests. STATE commit hashes (463ad9a, b7318c7, cd5e2a6, 835474d, 997f953) exist. No Closes/Fixes trailer in the 6 commit messages.

## Findings

**F1 [LOW][demonstrated] The "only ratchets down" claim holds only while the snapshot file exists; deleting it and running the documented bootstrap re-pins any debt.** src/qa/hook-typecheck-coverage-check.ts regenerateBaseline, `committed` undefined path. Probe: added one new type error to userpromptsubmit-halt-relay.mjs, removed src/qa/hook-typecheck-baseline.json, ran `--regenerate-baseline hooks/sessionstart-tool-enum.mjs hooks/userpromptsubmit-halt-relay.mjs`: 35 ADDED, file written; qa:hook-typecheck-coverage then PASS at 23 (raised from 22). Domains in tension: devops ADR-0008 ratchet-only vs a self-service bootstrap. Not a new capability (a hand edit does the same, CI cannot see either), the diff stays visible in review, and CHANGELOG discloses the bootstrap. Exposure: ~0% of runs, requires a deliberate delete-and-regenerate; basis: counted in code. Minimal fix (optional): refuse the bootstrap when the snapshot path is tracked by git, or state in the CHANGELOG line that a re-bootstrap equals a hand edit. Residual-register line; blocks nothing.

**F2 [LOW][code-traced] The alias-hoist reversal has no decision-log row.** CHANGELOG attributes it to "Manager, 2026-09-29"; the requesting brief calls it a human ruling. `git diff --stat 12a4454..e63cd4b` shows no change to docs/decisions.md or docs/run-log.jsonl, and neither has a row for it. PRINCIPLES rule 7 wants Manager decisions logged with rationale. The flip strengthens the guard so no ADR is violated; only the record is thin, and the 2026-09-28 decisions row (line 91) still says the alias hoist was "reconfirmed", now overtaken. Fix: append one decisions.md row (who ruled, that it strengthens the guard). Exposure: record-only.

**F3 [LOW][demonstrated] The lint message for the banned pragma steers to another banned pragma.** Probe output on a ts-ignore pragma in hooks/zz-probe.js: `Use "@ts-expect-error" instead of "@ts-ignore"`, while the config now bans ts-expect-error too. Cosmetic; a contributor following the hint hits the second error. No code change needed.

## Coverage gaps (named)
- The snapshot JSON itself: no CI check compares it to the base branch, so a hand edit or the F1 bootstrap that raises debt is caught only by human review. Pre-existing (the old hand-typed PINNED_BASELINES had the same property); low-risk today, hooks unwired (Issue #308). Treat any snapshot diff as review-required at activation.
- tsconfig.hooks-coverage.json include is a hand-typed 3-file list (red-team R1 territory, already named by that lane); fails loud for a new hook.

## Editorial
- F2 (decision-log row) and F3 (hint text) are plain edits.

## Verdict: APPROVE
Open findings 3, all LOW; failing tests 0 (F1-F3 have no executable form worth a red test: F1 is an accepted equivalence to a hand edit, F2 and F3 are record and message text). Nothing blocks.

Single next action: append the decisions.md row for the alias-hoist ruling (F2), then let the human merge.

Checks run (worktree at e63cd4b, npm ci, adr submodule contents copied in):
- `npm test`: tests 1584, pass 1583, fail 1, skipped 0. The 1 failure is reference-resolver.test.ts QA-14 dogfood ("ADR-0021 unresolved") because the worktree's adr/ submodule was empty; re-run of that file after copying adr/ in: 85 tests, 85 pass, 0 fail, 0 skipped. Targeted (fixnow + coverage-check + sanitize test files): 74 pass, 0 fail, 0 skipped.
- `npm run typecheck` rc=0; `npm run lint` rc=0.
- qa:gate-manifest, qa:hook-typecheck-coverage, qa:kernel-purity, qa:completeness-claims, qa:recurring-findings, qa:gate-command-path PASS; qa:fixture-coverage, qa:broken-instrument-gate VACUOUS-PASS (disclosed, pre-existing); oss:secret-scan rc=0; reference-resolver 12a4454 e63cd4b rc=0.

RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by blast radius):
1. [ISSUE][LOW][demonstrated] src/qa/hook-typecheck-coverage-check.ts regenerateBaseline bootstrap path: delete snapshot + regenerate re-pins raised debt (22 to 23, CI PASS); equals a hand edit; optional fix refuse bootstrap when snapshot is git-tracked
2. [ISSUE][LOW][code-traced] alias-hoist reversal (CHANGELOG says Manager, brief says human) has no docs/decisions.md or run-log row; append one row
3. [ISSUE][LOW][demonstrated] eslint ban-ts-comment message says use ts-expect-error though that pragma is now banned; cosmetic
4. [CLEAN][demonstrated] SE ADR-0010/0005: title-diff script, only the 2 ruled AC-7 tests changed, 0 removed since RED commit, existing coverage-check test 0 diff
5. [CLEAN][demonstrated] snapshot is generated (regenerate on clean tree byte-identical, 30/22) and refuses a new identity on the existing file; gate-manifest is the only JSON-shape walker, PASS with key pinned
6. [CLEAN][demonstrated] noInlineConfig and .js glob scoped to hooks/ only (src probe still honours inline disable; no .js hook exists today; new .js hook fails loud)
7. [CLEAN][code-traced] CHANGELOG/STATE claims match code (zero hooks/ci.yml diff, 14 shapes, 30/22, flag behaviour, commit hashes)
8. [CLEAN][demonstrated] ci.yml needs no step: npm test (node --test) ran the fixnow file, 74/74 on the three touched test files
counts: issues=3 suspicions=0 clean=5
evidence: demonstrated=6 code-traced=2 derived=0
checks=npm test 1583 pass / 1 fail (environmental: empty adr submodule in worktree; re-run of that file 85 pass / 0 fail) / 0 skip; targeted 74 pass / 0 fail / 0 skip; typecheck rc0; lint rc0; 6 qa scripts PASS, 2 VACUOUS-PASS; oss:secret-scan rc0
adr=HIT(37, whole catalog)
report=docs/reviews/s312-fixnow-360-363-cross-domain-round3-2026-09-29.md
