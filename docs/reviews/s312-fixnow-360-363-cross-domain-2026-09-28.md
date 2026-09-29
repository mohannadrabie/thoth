# Cross-domain review -- s312-fixnow-360-363 (PR #365)

**Reviewer:** cross-domain-reviewer (Ra)
**Scope:** `s312-fixnow-360-363` -- Issues #360/#361/#362/#363 fix-now round
**PR:** #365, branch `fix/360-363-strip-comments-guard-hardening` (HEAD `4ae8942`) vs base `master` (`c806c95`)
**Tier:** CRITICAL (Manager-ratified)
**Date:** 2026-09-28
**Lanes running alongside this pass:** `app-security-reviewer` (report landed mid-session, `docs/reviews/s312-fixnow-360-363-app-security-2026-09-28.md`, verdict REWORK), `red-team` round 3 (not yet landed at the time of this report).

## Ground already covered (not re-litigated here)

`app-security-reviewer` read the diff for the security lane and found 2 real, demonstrated HIGH findings, both already filed as Issues:
- **#366** -- `isSanitizeModuleImportCall` (sanitize.test.ts) matches the import specifier by `endsWith("/config/sanitize.ts")`, not exact path; a decoy import plus a path ending in that suffix can satisfy both the AST check and the raw-text regex.
- **#367** -- `hook-typecheck-coverage-check.ts`'s pinned-baseline ratchet compares a raw diagnostic **count**; a `// @ts-ignore` on a genuinely new bug in either pinned hook yields a zero count delta, defeating the ratchet's purpose.

Both are within app-security's own lane (security-tagged ADR territory, injection/bypass-shaped). I did not re-verify these independently beyond confirming they are filed and not duplicated by anything below -- PRINCIPLES.md rule 9 ("a gap already named by a lane reviewer isn't a new finding, it's noise").

## Full ADR catalog re-check (37 ADRs, whole catalog, unfiltered)

ADR cache: `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2]` (fp `13c1476`).

Checked the diff against every ADR **outside** app-security's security-tagged lane (the lane a domain reviewer already covers), since that's the seam this role exists to close:

| ADR | Tag | Verdict | Basis |
|---|---|---|---|
| SE ADR-0010 (code quality/maintainability) | quality, process | **CLEAN** | No test deleted (diff is pure add/replace -- `lineFirstThenBlock` and the old `isSanitizeForTerminalAccess`/`findRenderHookOutputSecondArg` are replaced by corrected, more precise implementations, not removed coverage); no lint-ignore broadened; touched code left cleaner. |
| SE ADR-0006 (blast radius control) | architecture, reliability | **CLEAN** | "MUST NOT widen a change's scope opportunistically" -- diff stays inside the 4 named Issues (#360-#363); no drive-by refactor found in the 15 changed files. |
| SE ADR-0005 (testing strategy) | testing, quality | **CLEAN** | New unit tests added for every changed behavior; no Playwright needed -- no user-facing flow changed, consistent with the ratified "no `test-writer` dispatch" call in the Phase 1 plan. |
| SE ADR-0002 (multi-layer architecture) | architecture | **CLEAN** | New QA script (`hook-typecheck-coverage-check.ts`) is standalone tooling under `src/qa/`, same pattern as the pre-existing `kernel-purity-check.ts`/`normalizer-registry-purity-check.ts` -- not part of the domain/application/infra layering this ADR governs. |
| SE ADR-0021 (kernel purity, POL-11/POL-12) | architecture, security, code, data | **CLEAN** | `stripComments` rewrite makes the structural gate *more* precise, not weaker (see Findings below); no kernel-boundary import added; normalizer registry untouched in behavior. |
| THOTH-ADR-0001 (central-classification fixture exception) | security, architecture, code | **N/A** | Diff doesn't touch `docs/qa/s5-central-classification.json` or its loader. |
| devops ADR-0002/0003/0004/0005/0006/0007/0009/0010 (CDK/IaC) | iac, cdk, cost, iam | **N/A** | Diff touches no AWS/CDK infrastructure. |
| devops ADR-0008 (CI/CD gates and policy-as-code) | pipeline, quality, security | **CLEAN (adjacent, not violated)** | Topically the closest devops ADR to the `.github/workflows/ci.yml` change, though it's written for a CDK/cdk-nag/Trivy/SBOM pipeline this repo doesn't run. Its spirit ("MUST NOT lower gate thresholds... ratchet only", "MUST NOT merge with any blocking gate... pending") is honored: a gate was *added*, none lowered; no suppression broadened; no `continue-on-error` introduced. |

No ADR collision found in any non-owning lane. No ADR text anywhere in the 37-ADR catalog specifically addresses CI workflow file changes -- the review requirement for `.github/workflows/ci.yml` comes from CLAUDE.md's named-sensitive-areas list, not an ADR.

## Seam check 1 -- does Unit 2 (sanitize.test.ts, app-security's lane) interact with Unit 1 (stripComments rewrite, kernel-purity's lane)?

**[CLEAN], code-traced.** Traced `sanitize.test.ts`'s new AST-resolution helpers (`isSanitizeModuleImportCall`, `resolveModuleBinding`, `resolvesToSanitizeModuleImport`) -- none of them call `stripComments`, `stripCommentsAstOracle`, or any other `kernel-purity-check.ts` export (grep for those identifiers in `sanitize.test.ts` returns zero hits). The guard parses the real `.mjs` hook independently via its own `ts.createSourceFile("pretooluse-kernel-gate.mjs", hook, ...)` call.

Separately confirmed `sanitize.test.ts` itself is not, and never was, in `kernel-purity-check.ts`'s scan scope: `checkKernelPurity` only walks `src/policy/kernel/**` non-`.test.ts` files (`kernel-purity-check.ts:587-591`); `sanitize.test.ts` fails on both counts (wrong directory, `.test.ts` suffix). The two units are cleanly decoupled -- the stripComments rewrite could not have broken, or silently helped, the sanitize-binding guard, and vice versa.

## Seam check 2 -- does the `.github/workflows/ci.yml` change get scrutiny anywhere?

Confirmed this diff is exactly 3 lines added (`.github/workflows/ci.yml:254-256`): a new "QA-18 hook-typecheck-coverage-check" step running `node src/qa/hook-typecheck-coverage-check.ts`. Checked: no `continue-on-error` (consistent with every other step in the job); step name doesn't collide with the separately-scheduled `QA-17` job; placement (after `S3 normalizer-registry-purity-check`, before `S5 gate-command-path-check`) doesn't skip or reorder any existing gate. This is the entirety of the YAML-level change -- minimal and low-risk on its own terms.

This is exactly the kind of change that risks falling in the seam between "app security" (authz/injection/deps -- not CI YAML) and "a red-team drill" (adversarial exploitation, not a config diff) -- neither lane's mandate names CI workflow files as their target. In practice the gap did not open here: app-security's own report went past the 3-line YAML diff and substantively reviewed the instrument the new step wires in (`hook-typecheck-coverage-check.ts`), finding the #367 ratchet-gaming HIGH. Combined with this report's own YAML-shape check, CLAUDE.md's "fresh dated review report" prerequisite for this named sensitive area is satisfied by the reports actually filed against this PR -- contingent on `red-team`'s round-3 report also landing, since CRITICAL tier names all three reviewers as required, not any two.

**Flagging this explicitly per the task brief:** had app-security's report stopped at the YAML diff (reasonable, since CI config isn't its named lane) without reading the instrument logic, this sensitive area would have gone through on a 3-line rubber stamp. It didn't this round, but the review chain has no structural guarantee that the substance behind a CI-gate change gets read unless a reviewer chooses to follow it past the workflow file -- worth naming as a standing risk for future CI-touching PRs, not a defect in this one.

## New finding (mine, not a restatement)

**[SUSPICION][LOW][code-traced]** `src/qa/kernel-purity-check.test.ts`'s new `enforcedLaneSources()` (added this PR, ~lines 68-77) hardcodes the kernel lane (`["action-record.ts", "kernel.ts", "rule-types.ts", "verdict.ts"]`) and normalizer lane (`["registry.ts"]`) as literal arrays, while the **gate** lane in the same function dynamically enumerates its directory (`readdirSync(join(repoRoot, "src", "policy", "gate")).filter(...)`). This is an inconsistency introduced within one new function in this PR.

Effect: a future production `.ts` file added to `src/policy/kernel/` or `src/policy/normalizer/` would not automatically be picked up by this specific AST-oracle differential test (the secondary verification layer this PR's own doc comment says exists to close exactly this kind of blind spot) -- though it would still be caught by the real, dynamically-walking production gate (`checkKernelPurity`'s `listFilesRecursive`, unchanged and still fully dynamic), so there is no live production exposure today.

Exempt from CLAUDE.md's "no hand-derived completeness claims" rule under the proportionality clause -- a 4-file and a 1-file set are trivially eyeballable today, so the hardcoded list is not itself a rule violation. Flagged as a minor robustness suggestion, not a blocker: switch those two lane definitions to `readdirSync(...).filter(...)` like the gate lane already does, for symmetry and to remove the future-drift risk entirely rather than rely on it staying small.

**Exposure:** ~0% today (basis: measured -- `checkKernelPurity` remains the real enforcement path and stays fully dynamic; this gap only affects a secondary differential-test's own future coverage, not current production behavior).

Not filed as an Issue (LOW severity, per project convention LOW findings don't spawn one).

## Independent verification run

Built a throwaway worktree (`git worktree add`) at PR tip `4ae8942`, `npm install`, then:

\`\`\`
$ npm run typecheck
> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.hooks.json
(clean, exit 0)

$ node src/qa/hook-typecheck-coverage-check.ts
[QA hook-typecheck-coverage-check] PASS: 3 production hook(s) under hooks/, each resolves inside a tsconfig project and stays within its coverage bar.
  - hooks/pretooluse-kernel-gate.mjs: 0 diagnostic(s), fully covered
  - hooks/sessionstart-tool-enum.mjs: 30 diagnostic(s) (pinned Issue #361 baseline: 30, pre-existing debt, not yet fixed)
  - hooks/userpromptsubmit-halt-relay.mjs: 22 diagnostic(s) (pinned Issue #361 baseline: 22, pre-existing debt, not yet fixed)

$ node src/qa/kernel-purity-check.ts
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.

$ node src/qa/normalizer-registry-purity-check.ts
[QA normalizer-registry-purity-check] PASS: src/policy/normalizer/registry.ts: zero dispatch-chain/sibling-normalizer-import violations.

$ node --experimental-strip-types --test src/policy/config/sanitize.test.ts
tests 10, pass 10, fail 0, skipped 0

$ node --experimental-strip-types --test src/policy/gate/gate-structure.test.ts src/qa/kernel-purity-check.test.ts src/qa/hook-typecheck-coverage-check.test.ts
tests 71, pass 71, fail 0, skipped 0
\`\`\`

**81/81 pass, 0 fail, 0 skipped** across the 4 PR-touched test files -- matches app-security's own independently-reported "81/0/0" exactly, a useful cross-check between two independently-run reviews.

Also ran `npm test` (full suite) in the same worktree: 2 failures observed, both confirmed **environmental, not caused by this PR's diff**:
- `QA-14 (dogfood)`: fails with `ADR-0021: no ADR with this id exists in the tree` -- the ad hoc `git worktree add` does not initialize the `adr/` git submodule, so the catalog is empty in that worktree only (confirmed: `ls adr/` returns nothing there). This exact environmental artifact is already logged repeatedly in `docs/REVIEW_LOG.md` for this same story's prior rounds.
- `pre-commit-scan.test.ts` R4: `EBUSY: resource busy or locked, rmdir` on a temp clone directory -- a Windows temp-directory file-lock race during test cleanup, unrelated to any file this PR touches.

Disclosed for honesty; neither gates this report, consistent with how prior rounds of this same story logged the identical two failure classes as environmental.

## Docs hygiene (Definition of Done)

- **CHANGELOG.md** -- updated, new dated section under "Fix-now round 3", additive only (diff confirmed pure additions, no existing entry altered).
- **docs/STATE.md** -- updated, new "Resume point" section at the top, prior entry preserved below as "superseded", per the file's own stated convention.
- **docs/decisions.md** -- updated, one new row appended at the end of the table. Diff confirmed append-only: zero removed lines against any existing row, satisfying the file's own append-only convention.
- **docs/.maat-state.json** -- `scope`/`tier` already read `s312-kernel-hook-sanitize`/CRITICAL at review time (the parent story); the decisions.md row states the new scope `s312-fixnow-360-363` was tier-ratified and logged to `docs/run-log.jsonl` separately -- consistent with how prior fix-now rounds in this same family handled interim scope tracking without a premature `.maat-state.json` transition.

No gold-plating found: all 15 changed files trace directly to the 4 named Issues; the new `tsconfig.hooks-coverage.json`/`hook-typecheck-coverage-check.ts` pair is exactly the scoped registration Issue #361 asked for (a real, measured, dated baseline -- not a phantom backlog citation), not scope creep.

## Coverage gaps named

None found outside what's already covered by the two lanes running alongside this pass. `package.json` (1-line script alias) and the new fixture (`selftest-fixture/kernel-purity/violating/string-literal-comment-opener.ts`) are both directly exercised by the new/changed tests reviewed above -- no orphaned file in this diff.

## Verdict

**APPROVE** (this lane: cross-domain ADR sweep and seam-hunt, clean -- one LOW suggestion, non-blocking).

**This does not make PR #365 shippable.** `app-security-reviewer`'s REWORK verdict (2 HIGH, demonstrated, Issues #366/#367) stands and is the actual blocker; `red-team` round 3 has not yet reported. CRITICAL tier requires all three lanes clean before merge.

## Single next action

Fix Issues #366 (exact-path comparison instead of `endsWith`) and #367 (pin diagnostic identity, not raw count, or ban `@ts-ignore`/`@ts-expect-error` under `hooks/`) in a follow-up commit on this branch, then obtain `red-team` round 3 sign-off -- at that point all three CRITICAL-tier reports plus this one collectively discharge the `.github/workflows/ci.yml` sensitive-area review requirement.

---

RECEIPT: verdict=APPROVE
findings (ranked by blast radius):
1. [CLEAN][code-traced] src/policy/config/sanitize.test.ts (app-security lane) vs src/qa/kernel-purity-check.ts stripComments rewrite (kernel-purity lane) -- zero interaction, sanitize.test.ts never calls stripComments/kernel-purity-check and is out of kernel-purity's scan scope by directory and file-type; seam is clean.
2. [CLEAN][code-traced] .github/workflows/ci.yml 3-line new step (QA-18) -- minimal, no continue-on-error, no name collision, correct placement; substance behind it (hook-typecheck-coverage-check.ts) got real scrutiny from app-security (Issue #367), discharging the CLAUDE.md sensitive-area review requirement collectively with this report and the pending red-team round 3.
3. [CLEAN][code-traced] Full 37-ADR catalog re-checked outside app-security's security lane (SE ADR-0010, -0006, -0005, -0002, -0021; devops ADR-0008 adjacent) -- no collision in any non-owning lane.
4. [SUSPICION][LOW][code-traced] src/qa/kernel-purity-check.test.ts:68-77 enforcedLaneSources() hardcodes kernel/normalizer lane file lists while the gate lane in the same function dynamically enumerates its directory -- a future new kernel/normalizer file would miss this specific differential test's coverage (real production checkKernelPurity scan stays fully dynamic and unaffected). Exposure: ~0%, basis: measured. Not filed (LOW). Fix: switch to readdirSync(...).filter(...) like the gate lane already does.
5. [CLEAN][demonstrated] Independently reproduced 81/81 pass, 0 fail, 0 skipped across the 4 PR-touched test files (typecheck clean, 3 QA instruments PASS with baselines exactly matching measured counts) -- matches app-security's own independently-run 81/0/0 exactly.
6. [CLEAN][code-traced] Docs hygiene: CHANGELOG.md, docs/STATE.md, docs/decisions.md all updated; decisions.md append-only preserved (pure addition, zero edits to prior rows). No gold-plating -- all 15 changed files trace to Issues #360-#363.
counts (checksum): issues=0 suspicions=1 clean=5
evidence (checksum): demonstrated=1 code-traced=5 derived=0
checks="typecheck clean|81/0/0 targeted (matches app-security's 81/0/0)|3 QA instruments PASS|full-suite 1523/1525 (2 environmental: adr submodule uninitialized in ad hoc worktree, Windows EBUSY temp-dir race -- neither in a touched file)"
adr=HIT(37, whole catalog)
report=docs/reviews/s312-fixnow-360-363-cross-domain-2026-09-28.md
