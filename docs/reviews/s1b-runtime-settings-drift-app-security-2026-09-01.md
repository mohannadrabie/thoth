# S1b app-security review — runtime-settings drift check (QA-17)

**Reviewer:** app-security-reviewer (Horus)
**Subject:** working-tree diff, repo `mohannadrabie/thoth` (Milestone #36, Issue #59, QA-17), not yet committed
**Tier:** STANDARD (ratified `docs/run-log.jsonl` 2026-09-01T23:58:02.501Z: `additive-CI-only,narrow-blast-radius,compensating-control-already-named`)
**Reason I'm the pick:** diff touches `.github/workflows/ci.yml`, a CLAUDE.md-named sensitive area ("Secret scanning / CI gates").

## ADR compliance

`node docs/adr-cache.mjs --ensure` gave ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp 83b2e3e, CACHE=HIT.

Applicable ADRs read from the cached catalog (`docs/.maat-state.json -> adrCatalog.adrs`), scoped to my domain (secrets, dependencies, injection, data exposure, CI supply chain):

- SE ADR-0009 (Monitoring and observability) - "MUST NOT log secrets, tokens, passwords, or personal data." Applicable: the new instrument prints to stdout/CI logs.
- SE ADR-0010 (Code quality and maintainability gates) - "MUST add a new third-party dependency only with a justification paragraph" and "MUST NOT lower coverage thresholds, delete tests, or broaden lint ignore lists." Applicable: diff touches CI + package.json.
- devops ADR-0008 (CI/CD gates and policy-as-code) and devops ADR-0009 (Least-privilege IAM and secrets in IaC) - CDK/cdk-nag/Trivy/Cosign/SBOM/Gitleaks apparatus. Per established precedent in this same repo's prior app-security reviews (docs/reviews/s1-protect-baseline-app-security-2026-08-30.md finding set), these are not directly applicable - thoth has no CDK/IaC/container-image/cloud-secrets surface - checked for completeness (specifically the generic "ratchet, don't rot" clause, which binds regardless of the CDK-specific tooling).

No violation of any of these ADRs' text found. No applicable-ADR BLOCKER.

## What I checked and how

1. Read the full diff directly, not the build receipt's claim:
   - `git diff .github/workflows/ci.yml` - every hunk in the existing `ci:` job is a pure addition (a comment block above `name: CI`, a `schedule:` trigger, and an entirely new job appended at file end). Zero lines removed inside the original `ci:` job's steps - confirmed by inspection of the raw diff, not by trusting the PR/commit message.
   - `git diff package.json` - one line added (`qa:runtime-settings-drift` script), nothing else.
   - `git status --porcelain package-lock.json` - empty output, i.e. zero diff. No new/updated npm dependency was added by this story, confirmed directly on the lockfile rather than taking the plan's "stdlib only" claim at face value.
2. Read the new instrument source (`src/qa/runtime-settings-drift-check.ts`) end to end: two file reads (`readFile(inventoryPath)`, `readFile(requirementsPath)`), pure-function diff (`parseDocumentedKeys`, `computeDrift`), no fetch/http(s) import, no eval/Function/child_process/shell-out anywhere in the file.
3. Regex-by-regex ReDoS check on every regex in the file:
   - `SECTION_HEADING_RE` and `NEXT_HEADING_RE` - anchored, no nested quantifiers, linear.
   - `SETTING_KEY_SHAPE_RE` - the repeated group is delimited by a literal dot, so there is no ambiguity in how a given character is consumed (each character belongs unambiguously to either an alnum run or a dot); this is not the classic ReDoS shape. Linear in input length.
   - the backtick-span matchAll regex - bounded negated-class span, linear.
   - Input is this repo's own REQUIREMENTS.md (committed, reviewed content), not attacker-supplied at runtime - no external/network/user input reaches this parser at all.
4. Ran the new test suite live: `node --test src/qa/runtime-settings-drift-check.test.ts` -> 10 pass, 0 fail, 0 skipped (raw output below). Includes a self-test proving no fetch/http(s) import exists in the shipped file (AC1), and a live check that the real vendored fixture matches the real REQUIREMENTS.md section 1.4 table today with zero drift.
5. Ran the instrument itself: `node src/qa/runtime-settings-drift-check.ts` -> PASS, 18 vendored runtime-settings keys all still match REQUIREMENTS.md section 1.4 (vendored 2026-09-01). Output is key-count plus a summary sentence only; no full file contents, no secret-shaped material.
6. Ran typecheck: `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) -> clean, no errors.
7. Read `src/lib/instrument.ts` (`printInstrumentResult`) - the shared reporter used by every QA instrument, including this one: emits only summary + details strings the instrument itself constructed (key names, ADDED/REMOVED lines) - no raw file dump, no environment/credential echo.
8. Read the vendored fixture (`docs/qa/runtime-settings-inventory.json`) - sourceUrl, capturedAt, and 18 plain setting-key strings, all public Claude Code documentation terms, nothing secret-shaped, no credentials/tokens/PII.
9. CI-gate specifics:
   - New `runtime-settings-drift` job has no per-job `permissions:` override - it inherits the workflow-level `permissions: contents: read` (ci.yml:25-26), same as the existing `ci` job. No `secrets:` context is referenced anywhere in the new job.
   - Gated `if: github.event_name == 'schedule'` - it never runs against a PR head, so a fork/PR cannot use it as an injection vector; GitHub Actions schedule triggers always run the workflow file as committed on the default branch, not a PR's modified copy, so a malicious PR editing ci.yml's schedule job cannot execute anything until merged.
   - Actions used (actions/checkout v4.4.0, actions/setup-node v4.4.0, both SHA-pinned) are the same refs already in use in the untouched ci job - no new third-party action/marketplace dependency introduced.
   - `npm ci` in the new job installs from the same committed, unmodified lockfile as the existing job - no parallel/alternate install source.
10. Sensitive-data exposure - confirmed via steps 5, 7, 8 above: PASS/FAIL output is key-name/diff-line level only, never full file contents, never anything beyond public settings-key strings.

### Raw command output

```
$ node --test src/qa/runtime-settings-drift-check.test.ts
tests 10, pass 10, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 135.3308

$ node src/qa/runtime-settings-drift-check.ts
[QA-17 runtime-settings-drift-check] PASS: 18 vendored runtime-settings key(s) all still match REQUIREMENTS.md section 1.4 (vendored 2026-09-01).

$ npm run typecheck
(clean, tsc --noEmit exits 0, no output)

$ git status --porcelain package-lock.json
(empty - no diff)
```

## Findings

### 1. [CLEAN][code-traced] No injection/ReDoS/RCE surface
`src/qa/runtime-settings-drift-check.ts` reads two local, repo-controlled files only (node:fs/promises readFile), no network, no eval/Function/shell-out, no user input. Every regex is anchored and unambiguous (delimiter-separated repetition, no nested-quantifier ReDoS shape) - see analysis above, `runtime-settings-drift-check.ts:41-48,89-102`. Confirmed by 10/10 passing self-tests including a literal "no fetch/http(s) import" assertion.

### 2. [CLEAN][code-traced] No secrets touched or logged
Fixture (`docs/qa/runtime-settings-inventory.json`) contains only public Claude Code documentation terms (setting-key names, a public doc URL, a capture date). `printInstrumentResult` (`src/lib/instrument.ts:11-21`) emits only the instrument's own constructed summary/detail strings - key names and ADDED/REMOVED diff lines, never a raw file dump. Verified live: running the instrument produced only a one-line PASS summary naming a key count.

### 3. [CLEAN][code-traced] No new npm dependency / supply-chain surface
`package-lock.json` has zero diff (`git status --porcelain package-lock.json` empty). `package.json`'s only change is a script-alias line. The new source files import only `node:fs/promises`, `node:url`, and this repo's own `../lib/instrument.ts` - no third-party package added.

### 4. [CLEAN][code-traced] CI-gate least privilege maintained; existing push/PR job unchanged
New `runtime-settings-drift` job inherits the workflow-level `permissions: contents: read` (ci.yml:25-26), no per-job override, no `secrets:` reference. Gated `if: github.event_name == 'schedule'`, so it never executes against PR-supplied workflow content (GitHub always runs schedule triggers from the default-branch copy of the workflow file). Actions pinned to the same SHAs already used by the untouched `ci` job - no new action introduced. `git diff .github/workflows/ci.yml` confirmed the existing `ci:` job's steps are a pure superset (only additions, zero removed lines) - verified directly on the diff, not from the build receipt's claim.

### 5. [CLEAN][code-traced] Applicable ADRs (SE-0009, SE-0010) satisfied; devops ADR-0008/0009 not applicable but ratchet clause checked
SE-0009's "MUST NOT log secrets" - satisfied per Finding 2. SE-0010's "MUST add a new dependency only with justification" - moot, no new dependency (Finding 3); "MUST NOT lower gate thresholds, delete tests, broaden suppression lists" - not done (only additions). devops ADR-0008/0009's CDK/container/Gitleaks-specific apparatus doesn't apply to this repo (no IaC/container surface, established precedent from `docs/reviews/s1-protect-baseline-app-security-2026-08-30.md`), and the generic ratchet clause is not violated either.

## Verdict

APPROVE. No BLOCKERS, no hardening conditions. This is a narrow, offline, stdlib-only, read-only instrument wired into CI on a schedule-only trigger with no elevated permissions and no new supply-chain surface - the exact shape the S1b decision ruling and tier-ratification called for.

## Findings and tests

All findings above are [CLEAN] - no open findings, no failing tests to name. open findings = 0, failing tests = 0 (both zero; no discrepancy to explain).

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][code-traced] src/qa/runtime-settings-drift-check.ts:27-102 -- no injection/ReDoS/RCE surface; offline, stdlib-only, unambiguous anchored regexes; 10/10 self-tests pass.
2. [CLEAN][code-traced] src/lib/instrument.ts:11-21 + docs/qa/runtime-settings-inventory.json -- no secrets touched/logged; output is key-names/diff-lines only, fixture is public doc terms only.
3. [CLEAN][code-traced] package-lock.json (zero diff) + package.json (one script-alias line) -- no new npm dependency introduced.
4. [CLEAN][code-traced] .github/workflows/ci.yml:25-26,108-132 -- new scheduled job has no elevated permissions/secrets, gated to schedule-only, reuses already-pinned actions/lockfile; existing push/PR job's steps confirmed unchanged via raw git diff (pure additions only).
5. [CLEAN][code-traced] SE ADR-0009/0010 satisfied; devops ADR-0008/0009 not applicable (no IaC/container surface, per established repo precedent) and its ratchet clause not violated.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=0 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=0 code-traced=5 derived=0
checks="10/0/0|typecheck clean|n/a"
adr=HIT(35)
report=docs/reviews/s1b-runtime-settings-drift-app-security-2026-09-01.md
