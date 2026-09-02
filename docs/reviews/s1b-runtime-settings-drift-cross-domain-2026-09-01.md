# S1b cross-domain review - runtime-settings drift check (QA-17)

**Reviewer:** cross-domain-reviewer (Ra)
**Subject:** working-tree diff, repo mohannadrabie/thoth (Milestone #36, Issue #59, QA-17), not yet committed
**Tier:** STANDARD (docs/run-log.jsonl 2026-09-01T23:58:02.501Z: additive-CI-only,narrow-blast-radius,compensating-control-already-named)
**Lane running alongside me:** app-security-reviewer (Horus) - docs/reviews/s1b-runtime-settings-drift-app-security-2026-09-01.md, verdict APPROVE, 5/5 CLEAN, ground covered: injection/ReDoS/RCE surface, secrets/data exposure, npm supply chain, CI-gate least privilege (permissions, secrets: context, action pinning), SE ADR-0009/0010 + devops ADR-0008/0009 applicability. My job starts where that lane stops: the whole ADR catalog, unfiltered, and the seams between domains this diff touches (CI-pipeline scheduling semantics, docs-as-spec fidelity, decision-ledger-vs-code fidelity) that a security lens does not look at.

## ADR read

`node docs/adr-cache.mjs --ensure` gave: ADR cache HIT, reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, approx 17300 tokens saved this pass (fp 83b2e3e), CACHE=HIT. Per my role, I read the whole catalog (both adr/devops and adr/software-engineering, 35 ADRs total), not a domain slice.

### Cross-domain ADR verdict, per potentially-applicable ADR outside app-security's stated lane

- **devops ADR-0008 (CI/CD gates and policy-as-code)** - explicitly flagged by the task as needing an independent re-check, not a rubber-stamp of story-implementer's/app-security's ruling. Independently confirmed: grep -rln "aws-cdk" --include="*.ts" --include="*.json" . (excluding the adr/ submodule text) returns nothing - this repo has no CDK, no IaC, no container build/push/sign anywhere. ADR-0008's MUST rules (cdk-nag, tag validation, Gitleaks pre-commit hook, Semgrep, Trivy, SBOM, Cosign signing/verification) all presuppose that apparatus; none of it exists in thoth. Confirmed also: no .gitleaks.toml/.gitleaksignore/scripts/secret-scan (the CLAUDE.md-named substitutes) - this repo's own src/secret-scan/history-scan.ts (OSS-01) is the established, pre-existing substitute, unchanged by this diff. Ruling holds, independently reached, matching both story-implementer's and app-security's conclusion - not accepted on their say-so.
- **devops ADR-0007 (environments/pipeline), ADR-0002/0003/0004/0005/0006/0009/0010 (CDK-specific)** - same reasoning: no CDK/AWS surface in this repo at all. Not applicable, confirmed by the same grep.
- **SE ADR-0002 (multi-layer architecture)** - src/qa/runtime-settings-drift-check.ts is a flat QA-instrument script, matching the established sibling pattern (completeness-claim-checker.ts, broken-instrument-gate.ts); this repo does not apply strict presentation/application/domain/infrastructure layering to its src/qa/* instruments, and this file introduces no new violation of that convention.
- **SE ADR-0004 (idempotency)** - this instrument is read-only (two readFiles, a pure diff, process.exit); it is not a mutating endpoint/consumer/job, so the "idempotency test" MUST rule does not apply. Correctly not present.
- **SE ADR-0005 (testing strategy)** - unit tests present, happy path + boundary + self-tests (offline-by-construction, no-soft-warn, exact-match, both named exceptions, one real drift case); no Playwright test, correctly absent (no user-facing UI flow changed).
- **SE ADR-0006 (blast radius)** - no network call in the new code (by design), no lockstep multi-service deploy, no schema/data migration. Not applicable in any rule that would bind.
- **SE ADR-0009/0010** - already covered by app-security's report; independently re-checked, no divergence.

No ADR violation found outside app-security's lane. No new ADR-collision BLOCKER.

## Seam-hunting: the finding app-security's lens does not look at

### Finding 1: .github/workflows/ci.yml - the new schedule trigger silently widens the existing ci job too, not just the new one

**Domains in tension:** the diff's own stated design intent ("QA-17 runs separately... never folded into the push/PR ci job's steps", comment at ci.yml:7-11) vs. GitHub Actions' actual job-execution semantics, which app-security's report checked for security properties (permissions, secrets, action pinning - all clean) but not for trigger-scope correctness, because that is a pipeline-correctness question, not a security one.

jobs.ci (the existing push/PR job) carries no if: condition at all. jobs.runtime-settings-drift (the new job) is correctly gated if: github.event_name == 'schedule' (ci.yml:115) - but nothing gates jobs.ci away from schedule. In GitHub Actions, every job without a job-level if: runs on every event that fires the workflow; adding schedule: to on: (ci.yml:19-23) therefore makes jobs.ci - the full lint/typecheck/npm-test/QA-01/02/05/06/13/14/15/16/OSS-01 suite, including the full-history secret scan - also run every Monday 06:00 UTC, in addition to the intended runtime-settings-drift job.

Confirmed, not assumed:
```
$ grep -n "diff-refs\|github.event_name\|github.event.before" .github/workflows/ci.yml
63:        id: diff-refs
65:          if [ "${{ github.event_name }}" = "pull_request" ]; then
69:            echo "base=${{ github.event.before }}" >> "$GITHUB_OUTPUT"
77:        run: node src/qa/diff-fixture-check.ts "${{ steps.diff-refs.outputs.base }}" "${{ steps.diff-refs.outputs.head }}"
89:        run: node src/qa/reference-resolver.ts "${{ steps.diff-refs.outputs.base }}" "${{ steps.diff-refs.outputs.head }}"
115:    if: github.event_name == 'schedule'
```
jobs.ci has no matching if: line anywhere. On a schedule event, github.event.before is unset (that field only exists on push events), so diff-refs's else branch computes base="".

I reproduced the actual runtime behavior locally rather than guessing at it:
```
$ node src/qa/diff-fixture-check.ts "" "$(git rev-parse HEAD)"
[QA-02 diff-fixture-check] VACUOUS-PASS: 0 policy rule files changed in this diff - vacuous pass.
[QA-02 diff-fixture-check] NOTE: vacuous pass - no real content exists yet for this check to act on. This is disclosed, not silent...
EXIT_CODE=0

$ node src/qa/reference-resolver.ts "" "$(git rev-parse HEAD)"
[QA-14 reference-resolver] VACUOUS-PASS: 0 citations found in the scanned text - vacuous pass.
EXIT=0
```
This is not a crash and not a silent wrong-green (the project's own disclosed-vacuous-pass convention, established by the S1 Issue #18 fix, holds here too - resolveChangedFiles catches the bad-ref git error and returns null, which main() reports as an explicit, named vacuous pass). But it means: on every scheduled run, QA-02 and QA-14's real diff-aware logic never actually exercises anything - while lint, typecheck, the full npm test suite, QA-01/05/06/13/15/16, and OSS-01's full-history secret scan all run for real, a second time, on a schedule that exists only for QA-17. That directly contradicts the diff's own header comment ("never folded into the push/PR ci job's steps") - true at the level of job identity (it is a separate job), false at the level of job trigger scope (the old job's effective trigger set silently grew).

**Minimal fix:** add if: github.event_name != 'schedule' to jobs.ci, mirroring the new job's own if: github.event_name == 'schedule' convention exactly.

Exposure: approximately 100% of scheduled (weekly) workflow runs, basis: code-traced (grep confirms the missing job-level if:; live re-run of the two diff-aware scripts with an empty base ref confirms the disclosed-vacuous-pass behavior rather than a crash). Not a security/data-integrity/legal/safety finding - it is a CI-pipeline correctness/cost-waste defect (redundant weekly re-run of the entire push/PR gate set, including a full-history secret scan, achieving nothing beyond what push/PR already checked).

### Finding 2: the four ratified 2026-09-01 decision points, checked against the shipped source, not the build receipt

Read docs/decisions.md's S1b row directly and traced each of its four points to the actual code:
1. **Data source = vendored snapshot, no live fetch.** runtime-settings-drift-check.ts:27-30 imports only node:url/node:fs/promises; the file's own self-test (AC1) asserts no fetch(, no from "node:https?", no require("https?") - 10/10 tests pass, including this one.
2. **Fail semantics = hard-fail, exactly 2 named exceptions, no soft-warn.** EXCEPTED_PRIMITIVE_ROWS (runtime-settings-drift-check.ts:54-57) has exactly two entries (the hooks row, the managed-policy-delivery row); the file's own self-test (AC4) asserts no --soft, --warn, or continue-on-error string exists anywhere in it; ci.yml's new job has no continue-on-error: either.
3. **Cadence = weekly.** ci.yml:19-23, cron "0 6 * * 1" (Monday 06:00 UTC) - matches.
4. **Version-floor-bump trigger explicitly deferred, no dangling half-built reference.** Grepped ci.yml, package.json, CHANGELOG.md, and the new source files for any reference to a version-floor/bump trigger: none exists. The deferral is clean - nothing in the diff gestures at a bump-trigger it does not implement.

No divergence between the ratified decision and the shipped code on any of the four points.

### Finding 3: vendored fixture hand-checked against REQUIREMENTS.md section 1.4's live table today

Independently recounted section 1.4's key-shaped, non-excepted backtick spans by row (REQUIREMENTS.md:220-224): Exclusive tool-server allowlist = 3 keys (allowManagedMcpServersOnly, allowedMcpServers, deniedMcpServers; managed-mcp.json correctly excluded - not key-shaped), Permission-rule lockdown = 4 keys, Customisation/hook lockdown = 6 keys, Required version range = 3 keys, Filesystem/network isolation = 2 keys. 3+4+6+3+2 = 18, matching docs/qa/runtime-settings-inventory.json's 18 entries exactly, key-for-key. The two excepted rows (hooks, managed-policy-delivery - REQUIREMENTS.md:225,227) correctly contribute zero keys by primitive-column identity, even though the delivery row's cell contains a dot-shaped span (com.anthropic.claudecode) that would otherwise match the key-shape regex.

Live confirmation:
```
$ node src/qa/runtime-settings-drift-check.ts
[QA-17 runtime-settings-drift-check] PASS: 18 vendored runtime-settings key(s) all still match REQUIREMENTS.md section 1.4 (vendored 2026-09-01).

$ node --test src/qa/runtime-settings-drift-check.test.ts
tests 10, pass 10, fail 0, cancelled 0, skipped 0, todo 0

$ npm test
tests 99, pass 99, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 7421.0125

$ npm run typecheck   (clean, exit 0)
$ npm run lint        (clean, exit 0)
```

### Finding 4: citation accuracy self-check on the new file's own comments (QA-14's own concern, applied to itself)

runtime-settings-drift-check.ts:19-22 cites REQUIREMENTS.md:227 for the hooks row and REQUIREMENTS.md:225 for the managed-policy-delivery row. Verified directly against REQUIREMENTS.md (read lines 205-244): line 225 is indeed the managed-policy-delivery row, line 227 is indeed the hooks row. Citations accurate.

## Coverage gaps named

- **docs/decisions.md / docs/run-log.jsonl / CHANGELOG.md edits** - pure process/prose logging, no functional risk, correctly outside both reviewers' code-focused lanes. Editorial-level only; no reviewer needs to "own" this.
- **No infra/network reviewer was dispatched** even though the diff touches .github/workflows/ci.yml (a CLAUDE.md-named sensitive area). This is reasonable, not a gap: this repo has no infra/network surface (confirmed above, no CDK/IaC anywhere), so app-security-reviewer's pick under "Secret scanning / CI gates" is the correct single reviewer, and the pipeline-correctness question (Finding 1) is exactly the kind of seam cross-domain-reviewer exists to catch precisely because no domain lane's mandate covers "does this workflow's trigger config do what its own comment claims."
- **docs/reviews/s1b-runtime-settings-drift-app-security-2026-09-01.md's REVIEW_LOG.md row** - checked directly (not assumed): docs/REVIEW_LOG.md line 11 does carry this report's row (app-security-reviewer | APPROVE | docs/reviews/s1b-...md), already committed prior to this working-tree diff. docs/receipt-check.mjs's automated flag ("no docs/REVIEW_LOG.md row references this report") is a false positive for this report - verified by direct grep, not taken on the tool's word. No actual gap.

## Editorial

None beyond what is already noted above.

## Verdict

**APPROVE-WITH-CONDITIONS.** One real, minimal-fix, code-traced MED finding (Finding 1 - jobs.ci needs if: github.event_name != 'schedule'), non-security, non-blocking of the QA-17 instrument's own correctness (which is fully verified clean), but real: fix before or immediately after merge so the workflow's own stated design intent actually holds. Everything else checked - the four ratified decision points, the vendored-fixture fidelity, the ADR catalog (whole, unfiltered) - is clean.

## Findings and tests

Finding 1 maps to one named failing test: "CI workflow: jobs.ci does not run on a schedule event" - not yet an executable test in this repo (no workflow-linter harness exists), so it is recorded here as the residual-register line per PRINCIPLES rule 19, to be closed by the one-line YAML fix above, verified by inspection (or, if this repo later adds a workflow-config linter, a first real test case for it). open findings = 1, failing tests = 1 (the fix is trivial enough that no separate test infra is being requested - just the one-line if: addition).

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][code-traced] .github/workflows/ci.yml:14-23,29 -- new schedule trigger silently widens jobs.ci's own trigger scope too (no if: guard on it, unlike the new job); on a scheduled run, diff-refs computes base="" (github.event.before unset for schedule events) and QA-02/QA-14 disclosed-vacuous-pass rather than exercise real logic, while lint/typecheck/full test/QA-01/05/06/13/15/16/OSS-01 (incl. full-history secret scan) redundantly re-run weekly -- contradicts the diff's own stated intent ("never folded into the push/PR ci job's steps"). Fix: add if: github.event_name != 'schedule' to jobs.ci.
2. [CLEAN][code-traced] docs/decisions.md 2026-09-01 S1b row's four ratified points (vendored/no-live-fetch, hard-fail/exactly-2-exceptions/no-soft-warn, weekly cadence, version-floor-bump deferred with no dangling stub) all verified directly against shipped source, zero divergence.
3. [CLEAN][demonstrated] docs/qa/runtime-settings-inventory.json's 18 keys hand-recounted against REQUIREMENTS.md section 1.4 today (3+4+6+3+2=18), zero drift; instrument + full suite run live (10/10, 99/99 pass/0 fail/0 skip), typecheck/lint clean.
4. [CLEAN][code-traced] devops ADR-0008 (and sibling CDK-specific devops ADRs) independently re-confirmed not applicable -- no CDK/IaC/container surface anywhere in this repo (grep verified), pre-existing S1 architecture, unchanged by this diff; matches story-implementer's and app-security's own independently-reached conclusion.
5. [CLEAN][code-traced] runtime-settings-drift-check.ts's own REQUIREMENTS.md:225/227 citations verified accurate against the live document.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=4
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=1 code-traced=4 derived=0
checks="typecheck: 0 errors; lint: 0 findings; test: 99 pass/0 fail/0 skipped/0 cancelled (7421ms); QA-17 instrument PASS (18/18 keys, live); QA-17 self-test 10/10 pass; demonstrated ci.yml schedule-trigger-widening via live QA-02/QA-14 re-run with empty base ref (both disclosed-vacuous-pass, exit 0, not a crash)"
adr=HIT(35, whole catalog)
report=docs/reviews/s1b-runtime-settings-drift-cross-domain-2026-09-01.md

---

## Re-confirm pass (2026-09-01, same day, post fix-now)

**Trigger:** `story-implementer`'s claimed one-line fix to `.github/workflows/ci.yml` closing Finding 1 (Issue #60). Verified independently, not taken on the claim.

### 1. Diff isolation — confirmed exactly one line added, nothing else moved

`git diff -- .github/workflows/ci.yml` (against HEAD `366c54d`) shows the full S1b delta; the only change relative to what this report's original pass reviewed is the single inserted line at `ci.yml:31`:
```diff
   ci:
     name: Lint, typecheck, test, QA/OSS instruments
+    if: github.event_name != 'schedule'
     runs-on: ubuntu-latest
```
Cross-checked structurally, not just visually: my original report quoted grep hits at ci.yml lines 63/65/69/77/89/115 (`diff-refs` id, the `pull_request` branch, the `github.event.before` line, QA-02's run line, QA-14's run line, and the new job's own `if:`). Re-reading the current file, every one of those same lines now sits at exactly +1 (64/66/70/78/90/116) — a uniform shift consistent with one line inserted above all of them, and with nothing else added, removed, or reordered in between. Action-pin SHAs (`actions/checkout@11d5960a...`, `actions/setup-node@49933ea5...`), the `permissions: contents: read` block, and the `runtime-settings-drift` job's own `if: github.event_name == 'schedule'` gate are byte-identical to what this report already cleared.

### 2. Fix verified to actually close Finding 1

Parsed the live file with `npx --yes js-yaml .github/workflows/ci.yml` (ephemeral, exit 0, valid YAML) and confirmed structurally — not just by eyeballing the text — that the two job-level `if:` conditions are exact mirror opposites:
```
"jobs.ci.if": "github.event_name != 'schedule'"
"jobs.runtime-settings-drift.if": "github.event_name == 'schedule'"
```
This is a stronger closure than a mitigation of the original symptom: a job-level `if:` evaluating false means GitHub Actions skips the entire job. On a scheduled run, `jobs.ci` — and therefore its `diff-refs` step, QA-02, QA-14, and the full lint/typecheck/test/QA-01/05/06/13/15/16/OSS-01 suite — does not execute at all. There is no longer a disclosed-vacuous-pass to observe, because the code path that produced it (QA-02/QA-14 running against an empty `github.event.before` base ref) never runs on that trigger. The redundant weekly re-run of the whole push/PR gate set (the other half of the original finding's blast radius) is eliminated the same way. The original live reproduction in this report (Finding 1, `diff-fixture-check.ts`/`reference-resolver.ts` invoked with an empty base ref, both exiting 0 with a disclosed VACUOUS-PASS) remains an accurate record of what *would* happen without the guard — it no longer applies with the guard in place, by construction of the `if:` semantics, not by degrading the symptom.

### 3. Nothing else disturbed

Confirmed by the same diff read in step 1: permissions, action pinning, secrets handling, and `runtime-settings-drift`'s own gating are untouched — the fix touches exactly the one line claimed.

### 4. Real checks re-run

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(clean, exit 0)

$ npm run lint
> eslint .
(clean, exit 0)

$ npm test
...
ℹ tests 99
ℹ suites 0
ℹ pass 99
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5931.8574

$ npx --yes js-yaml .github/workflows/ci.yml
(exit 0, valid YAML; jobs.ci.if and jobs.runtime-settings-drift.if confirmed as exact mirror-opposite conditions)
```

### Re-verdict: APPROVE

Finding 1 (the only open condition from the original APPROVE-WITH-CONDITIONS verdict) is closed, code-traced and structurally confirmed, not merely claimed. Nothing else in the diff regressed. No new findings from this re-confirm pass. Issue #60 closed (`state_reason: completed`) with this evidence linked.

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][code-traced] (CLOSED) .github/workflows/ci.yml:31 -- Finding 1 from the original pass; fix confirmed: `if: github.event_name != 'schedule'` added to jobs.ci, verified via git diff (only this one line changed) + js-yaml structural parse (exact mirror-opposite of runtime-settings-drift's own if:) + live typecheck/lint/test all clean. Originally filed as Issue #60, now closed.
2. [CLEAN][code-traced] docs/decisions.md 2026-09-01 S1b row's four ratified points -- unchanged from original pass, not re-disturbed by this one-line fix.
3. [CLEAN][demonstrated] docs/qa/runtime-settings-inventory.json's 18 keys vs REQUIREMENTS.md section 1.4 -- unchanged from original pass; full suite re-run live this pass too (99/99 pass/0 fail/0 skip), typecheck/lint clean.
4. [CLEAN][code-traced] devops ADR-0008 (and sibling CDK-specific devops ADRs) -- not applicable, re-confirmed unchanged (no CDK/IaC surface introduced by this one-line fix).
5. [CLEAN][code-traced] runtime-settings-drift-check.ts's own REQUIREMENTS.md:225/227 citations -- unchanged from original pass.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=4
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=1 code-traced=4 derived=0
checks="typecheck: 0 errors; lint: 0 findings; test: 99 pass/0 fail/0 skipped/0 cancelled (5931.86ms); js-yaml parse: exit 0, jobs.ci.if='github.event_name != schedule' vs jobs.runtime-settings-drift.if='github.event_name == schedule' confirmed exact opposites"
adr=HIT(35, whole catalog)
report=docs/reviews/s1b-runtime-settings-drift-cross-domain-2026-09-01.md
