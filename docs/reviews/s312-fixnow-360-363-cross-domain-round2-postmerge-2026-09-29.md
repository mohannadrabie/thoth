# Cross-domain review (Ra) - s312-fixnow-360-363, post-merge re-confirm of round 4

Date: 2026-09-29. Tier: CRITICAL. Scope: `s312-fixnow-360-363`. Audited: shipped code at `949b108` (merge of PR #365) - delta `49097d3` and `git diff c806c95..949b108` (25 files). Prior pass: `docs/reviews/s312-fixnow-360-363-cross-domain-2026-09-28.md` (APPROVE). Branch `review/365-post-merge-reconfirm` (code identical to master).

[cross-domain-reviewer] Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes

## Lanes running / ground covered
- `red-team` and `app-security-reviewer` (post-merge re-confirm, running in parallel): guard-code attack surface (#366/#367, R1-R5) and the sanitize-binding AST guard.
- Not re-covered here: sanitize.test.ts binding-resolution logic (app-security lane), drill re-runs (red-team lane).
- ADR step: `node docs/adr-cache.mjs --ensure` -> `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] ... [CACHE=HIT]`. Whole catalog, no domain filter.

## Cross-domain ADR verdict
| ADR | Verdict | Basis |
|---|---|---|
| SE ADR-0010 (no lint-ignore broadening, no test deletion, no inline suppression) | CLEAN | `eslint.config.mjs` delta ADDS one rule (`ban-ts-comment`) plus a plugin registration inside the existing `hooks/**/*.mjs` block; `ignores` list unchanged. Test counts: sanitize.test.ts 7->13, kernel-purity-check.test.ts 56->60, gate-structure / marker-corpus / hook-sanitize unchanged; 0 `.skip`/`.todo`; 0 new `eslint-disable`/`@ts-*` in the diff additions. |
| devops ADR-0008 (ratchet only; no merge with a gate open) | CLEAN on code; see F2 (record) | QA-18 is a new gate and lowers nothing. The 2-hook pinned baseline is a dated, named exception (Issue #361) in a human-merged PR. |
| SE ADR-0021 POL-11/POL-12 | CLEAN | Kernel dir untouched. `render-hook-output.ts` +2 lines (comment only). `normalizer-registry-purity-check.ts` only exports an existing constant (`REGISTRY_PATH`). `qa:kernel-purity` PASS (4 files); normalizer-registry-purity-check PASS. |
| SE ADR-0002 (layer boundaries) | CLEAN | New `src/qa/hook-typecheck-coverage-check.ts` imports only `node:*`, `typescript`, `src/lib/instrument.ts`; no gate/kernel import edge added. |
| THOTH-ADR-0001 (central classification fixture) | N/A | `docs/qa/s5-central-classification.json` and its loader untouched. |
| THOTH-ADR-0002 (secret-scan allowlist) | N/A | No allowlist or pattern change. |
| SE ADR-0006 / 0017 / 0005 and the rest | N/A / CLEAN | No scope creep found (R6 correctly routed to backlog); no AGT surface touched; test-writer not applicable (no UI/API surface). |

## Checks run (raw)
Isolated detached worktree at `949b108` (the shared working tree was being mutated by a parallel reviewer, see F5):
```
node --test src/qa/kernel-purity-check.test.ts src/qa/hook-typecheck-coverage-check.test.ts src/policy/gate/gate-structure.test.ts src/policy/config/sanitize.test.ts hooks/pretooluse-kernel-gate-sanitize.test.ts src/qa/normalizer-registry-purity-check.test.ts
tests 101  pass 101  fail 0  skipped 0
npm run build -> rc=0 (both tsc projects)     npx eslint hooks src/qa -> clean
node src/qa/hook-typecheck-coverage-check.ts -> PASS: pretooluse-kernel-gate.mjs 0; sessionstart-tool-enum.mjs 30 (pinned 30); userpromptsubmit-halt-relay.mjs 22 (pinned 22)
```
Baseline vs real tree: pinned 30/22 equal the measured 30/22, so the pin is real, not stale.

Mutation probe (isolated worktree, then discarded): append `// @ts-expect-error because reasons` above `const zzBug = 1 + {};` to `hooks/sessionstart-tool-enum.mjs`:
```
eslint hooks/sessionstart-tool-enum.mjs        -> rc=0
node src/qa/hook-typecheck-coverage-check.ts   -> PASS (30 diagnostics, pinned 30)
node --test src/qa/hook-typecheck-coverage-check.test.ts -> pass 8 / fail 1 (Issue #367 no-pragma test)
control (same bug, no pragma): QA-18 FAIL "2365:625 (new, x1)"
```

## Seam findings

**F1 [LOW][demonstrated] - ESLint `ban-ts-comment` does not ban what its comment, CHANGELOG and STATE say it bans (eslint.config.mjs:85). Domains in tension: lint config, QA-18 ratchet, test suite.** The rule is registered with defaults. typescript-eslint 8.68.0 defaults `ts-expect-error` to `allow-with-description` (`node_modules/@typescript-eslint/eslint-plugin/dist/rules/ban-ts-comment.js:79`), and an `eslint-disable-next-line` line also defeats it. Demonstrated (probe above): a described `@ts-expect-error` above a real type error gives eslint rc=0 and QA-18 PASS (the diagnostic vanishes, which is exactly the #367 route). The net gate holds only because the test in `src/qa/hook-typecheck-coverage-check.test.ts` titled "Issue #367: no hooks/*.mjs file contains @ts-ignore, @ts-expect-error, or @ts-nocheck" fails - so the protection is the unit test (top-level `hooks/*.mjs` only), not the lint layer the docs credit. Exposure: ~0% of runs today (zero pragmas in `hooks/`, hooks unwired per #308), basis: measured; blocks nothing. Minimal fix: set `ts-expect-error` to `true` in the rule options (one line), or reword the comment and CHANGELOG to say the unit test is the gate. Belongs with open Issue #367 (commented there; no new Issue).

**F2 [LOW][demonstrated] - records: #362/#363 were closed by merge before their round-4 residuals were independently re-verified, and STATE.md says otherwise.** `gh issue view` shows #362/#363 CLOSED/COMPLETED; the last red-team comment on each (2026-09-29T03:00Z) says "PARTIALLY RESOLVED - this Issue stays OPEN" with residuals (#362: regex-class disclosure, hand-typed lane lists, 104-file consumer; #363: oracle missing trailing comment ranges) that were fixed only in `49097d3`, after that comment. `docs/STATE.md` (Last updated line and resume point) asserts that #362 and #363 were correctly auto-closed and "closing was already earned" because red-team round 3 re-confirmed them - inaccurate for those residuals. Cause: PR #365 body still carries "Closes #362. Closes #363." No stale trailers exist in commit messages: `git log c806c95..949b108` has 0 matches for closes/fixes/resolves #N. Fix: leave closed only if this post-merge red-team pass confirms the residuals; otherwise reopen (CLAUDE.md Issue Discipline 2). Commented on #362/#363. Correct the STATE line by addendum, not by editing history. Exposure: record-only, 2 Issues, basis: counted.

**F3 [LOW][code-traced] - line-anchored pin will churn on the very files S7 activation edits.** `PINNED_BASELINES` identities are code:line pairs (`src/qa/hook-typecheck-coverage-check.ts`, header + `diagnosticIdentity`). Any insertion above a pinned diagnostic in `sessionstart-tool-enum.mjs` / `userpromptsubmit-halt-relay.mjs` reads as N new diagnostics and forces a re-pin; the re-pin is a routine edit that can also absorb a real new bug. Disclosed in the file header. No fix now; for the Issue #308 activation review, treat any PINNED_BASELINES diff as review-required. Exposure: ~100% of edits to those 2 hooks, basis: counted in code; impact is CI friction, not a fail-open.

**F4 [LOW][code-traced] - consumer-count claims verified; one uncounted sibling.** Generated by AST scan (not hand-derived): exactly 8 files import `stripComments` from `kernel-purity-check.ts` (rule-reachability.test, gate-structure.test, classification-builtin-override.test, classification-catalog.test, kernel-purity-check.test, normalizer-registry-purity-check, redirect-scan-differential.test, hooks/pretooluse-kernel-gate-launch.test) - CLAIM CORRECT. "8 enforced-lane files, zero regex literals": AST scan of 4 kernel + registry + 3 gate files = 8 files, 0 RegularExpressionLiteral - CLAIM CORRECT. "104 production files": classification-builtin-override.test prints 104 (R1-6) and 101 (R1-6b/6d, excludes hooks/test-support) - accurate for one of two scans. Uncounted: `src/policy/config/print-lines.test.ts:111` keeps a private, older hand-rolled `stripComments` (string-aware, not the shared primitive) guarding `print-cli.ts`; it is outside the 8 importers and outside the wider differential. Self-disclosed heuristic, test-only; a coverage note, not a defect.

**F5 [process, no severity] - parallel reviewers share one working tree.** During this pass `hooks/sessionstart-tool-enum.mjs` and `hooks/pretooluse-kernel-gate.mjs` appeared modified in the shared checkout (another reviewer running drills), which made one early test run fail on the no-pragma test until I re-ran in an isolated worktree. This is the condition CLAUDE.md "Branch discipline" (d2cfaad) describes; mutation drills belong in a worktree. My own probe on that file was restored byte-identically from a backup; my worktree was removed. I did not touch the other reviewer edits.

## Seams checked and sound
- **CI vs QA instrument:** QA-18 is the only `ci.yml` delta (3 lines, after the S3 normalizer step); `package.json` has the matching `qa:hook-typecheck-coverage` script; the real-tree unit test also runs under `npm test`. `ci.yml` needed a fresh dated report: covered by my 2026-09-28 pass (the step landed in round 3; round 4 did not touch it).
- **tsconfig.hooks-coverage.json vs build:** confirmed not referenced by `build`/`typecheck`; the `tsconfig.hooks.json` header now cites it and Issue #361 (no dangling backlog citation).
- **Lane list vs directory walk:** kernel lane `listFilesRecursive`, normalizer lane from exported `REGISTRY_PATH`, gate lane `readdirSync` - one generator per lane; the wider "never loses real code" differential covers all `src/` + `hooks/` sources.
- **Issue state (as briefed):** #362/#363 CLOSED/completed; #360/#361/#366/#367 OPEN. Consistent; see F2 for the one accuracy gap.

## Coverage gaps
- `docs/.maat-state.json` (+5.2k lines, nested `priorScope` reindent) and STATE/CHANGELOG prose have no owning lane; only the checkable numbers above were verified (F4). Low-risk, intentionally uncovered.
- Nested `hooks/**/` `.mjs` files: ESLint scope is recursive, but `listProductionHooks` and `tsconfig.hooks-coverage.json` are top-level only. None exist today, so no live gap.

## Verdict: APPROVE
No HIGH, no ADR collision. Four LOW findings, none blocking. Open findings 4; failing tests 1 (F1: the unit-test-only catch shows the lint layer needs its own assertion). F2/F3/F4 have no failing-test form (record correction / design note / coverage note), so the counts differ by design.

**Single next action:** red-team and app-security close out #366/#367 and confirm the #362/#363 residuals; then set `ts-expect-error` to `true` on `ban-ts-comment` in the same change.

## Editorial
- The eslint.config.mjs comment, CHANGELOG and STATE say the rule bans all three pragmas - reword or fix per F1.
- STATE.md "closing was already earned" for #362/#363 - add an addendum per F2.

RECEIPT: verdict=APPROVE
findings:
1. [ISSUE][LOW][demonstrated] eslint.config.mjs:85 - ban-ts-comment defaults allow described @ts-expect-error and eslint-disable defeats it; lint + QA-18 pass a suppressed real bug, only the unit test catches it; fix: ts-expect-error option true (commented on #367)
2. [ISSUE][LOW][demonstrated] docs/STATE.md resume point vs gh - #362/#363 closed by merge while round-3 residuals were fixed only in 49097d3 and unverified; STATE says earned; reopen unless this re-confirm clears them (commented on #362/#363)
3. [ISSUE][LOW][code-traced] src/qa/hook-typecheck-coverage-check.ts - line-anchored pin churns on any edit to the 2 excepted hooks (S7 activation edits them); treat a PINNED_BASELINES diff as review-required
4. [ISSUE][LOW][code-traced] src/policy/config/print-lines.test.ts:111 - private older stripComments outside the 8-importer set and wider differential; self-disclosed, test-only (8 importers and 8-lane-files/0-regex claims verified correct)
5. [CLEAN][code-traced] SE ADR-0010 / devops ADR-0008 / SE ADR-0021 POL-11/12 / SE ADR-0002 / THOTH-ADR-0001/0002 - no collision (eslint delta adds a rule only; no test removed; 0 new suppressions)
6. [CLEAN][demonstrated] QA-18 baseline vs real tree - pinned 30/22 equal measured 30/22; ci.yml delta is 3 lines; coverage tsconfig not wired into build
counts: issues=4 suspicions=0 clean=2
evidence: demonstrated=3 code-traced=3 derived=0
checks=node --test (6 files, isolated worktree @949b108) 101 pass / 0 fail / 0 skip; build rc=0; eslint hooks src/qa clean; qa hook-typecheck-coverage PASS; qa:kernel-purity PASS; normalizer-registry-purity PASS; mutation probe (@ts-expect-error + real bug): eslint rc=0, QA-18 PASS, unit test FAIL(1)
adr=HIT(37, whole catalog)
report=docs/reviews/s312-fixnow-360-363-cross-domain-round2-postmerge-2026-09-29.md
