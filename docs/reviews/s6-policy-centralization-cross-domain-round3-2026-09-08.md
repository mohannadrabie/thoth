# Cross-Domain Review (Ra) - S6 policy centralization, ROUND 3: fix-now re-confirm, Issues #110 + #108

**Date:** 2026-09-08 - **Scope:** three commits on `master` - `8468ab4` (Issue #110: pin now covers all 3 policy layers), `a7014ab` (Issue #108 REOPENED: printer names the actual failed layer + shipped-defaults/project readFileSync now fail closed with a typed error), `88002aa` (test-writer lint-only comment fix, no semantic change) - diffed against `4113cfb`
**Tier:** CRITICAL (inherited, docs/.maat-state.json) - **Files touched:** src/policy/config/{loader,pin,printer}.ts + their .test.ts files, two new BOM/malformed-JSON fixtures under docs/qa/s6-policy-loader-fixtures/, CHANGELOG.md, docs/reviews/s6-printer-test-writer-fixnow-2026-09-08.md
**Prior cross-domain rounds:** docs/reviews/s6-policy-centralization-cross-domain-2026-09-08.md (APPROVE-WITH-CONDITIONS, first built-diff pass) - docs/reviews/s6-policy-centralization-cross-domain-round2-2026-09-08.md (APPROVE, delta 280f1c7 to 602be5c)
**Verdict: APPROVE**

## ADR cache

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog - approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]

Full catalog read, unfiltered (35 ADRs: 12 devops, 23 software-engineering) - this role's mandate, not a domain slice.

## Who ran alongside, and where their ground stops

app-security-reviewer's last report (s6-policy-centralization-app-security-round2-2026-09-08.md) and red-team's last report (s6-policy-centralization-red-team-round4-2026-09-08.md) both stop at commit 602be5c, which predates this diff - neither has reviewed 8468ab4/a7014ab/88002aa yet. Issue #110 (round-2 red-team finding) and Issue #108 (round-4 red-team REOPEN) are the findings this diff fixes, but red-team's own re-confirm on the fix has not landed as of this report. I reviewed the actual current code fresh, independent of any prior finding text, per my own mandate - I did not wait for or substitute for red-team's re-confirm, which is still the outstanding CRITICAL-tier gate (see Coverage gaps, below).

## Cross-domain ADR verdict - whole catalog vs. the diff

| ADR | Status | Basis |
|---|---|---|
| SE ADR-0002 (layering/DI) | CONFORMS | No new cross-layer import in this diff. printer.ts imports FailedLayerName from ./loader.ts (same layer, config-to-config); pin.ts's new Hash type import is from node:crypto (unchanged provider). No production file imports across the config/rule/kernel boundary that wasn't already conforming per cross-domain round 2's own table (unchanged this round). |
| SE ADR-0021 (kernel purity, POL-03/05/11) | CONFORMS | git diff --stat 4113cfb..HEAD (re-run myself, see below) shows zero src/policy/kernel/** entries - this diff never touches the kernel boundary. |
| SE ADR-0003 (SOLID / injected I/O) | CONFORMS (pre-existing pattern, unchanged) | loader.ts's two readFileSync calls are direct, not constructor-injected - this was already true before this diff (only central's read is injected via CentralPolicySource); this round only wraps the SAME pre-existing calls in try/catch, it does not add a new I/O surface. Not a new violation introduced by this diff. |
| SE ADR-0009 (observability) | NOT-APPLICABLE (by convention, unchanged) | Re-affirms cross-domain round 2's own ruling: this is a manually-invoked diagnostic CLI (print-cli.ts), not a service/endpoint - no golden-signal-metric or structured-error-log requirement attaches. Nothing in this diff changes that disposition - loader.ts's new failure returns are still plain typed values consumed by the CLI's own stdout rendering, not a new always-on service. |
| SE ADR-0005 (testing strategy) | CONFORMS | Every new/changed behavior (pin's 3-layer coverage, failedLayer attribution, the two now-wrapped readFileSync calls) ships with a happy-path + boundary test; each test owns its own temp dir / dedicated fixture file (withTempDir, or the two new fixture JSONs) - no shared mutable test state. |
| SE ADR-0010 (code quality gates) | CONFORMS | The one flagged lint failure (no-irregular-whitespace from a literal BOM byte in a comment, disclosed in a7014ab's own commit message as "flagged, not fixed - outside my ownership") was resolved same-day in 88002aa by test-writer itself, not suppressed. npm run lint is clean at HEAD (re-run myself, below) - no suppression, no ratchet violated. |
| SE ADR-0006 (blast radius / no lockstep) | CONFORMS | Both fixes explicitly cite this ADR in their own commit messages and are landed as independently revertible commits (8468ab4 before a7014ab), consistent with "no simultaneous deploy of multiple services" applied at the commit-granularity level this project uses it at. |
| devops ADR-0001 through ADR-0010 (IaC/CDK/cost/IAM/pipeline) | NOT-APPLICABLE | Diff touches only src/policy/config/*.ts, their tests, two fixture JSONs, and docs - no infrastructure, no CDK, no cloud resource. |
| SE ADR-0011 through ADR-0015 (data) | NOT-APPLICABLE | No database, no persistent store - .thoth/policy.json/shipped-defaults/project files are read-only config inputs, not a dataset this ADR family governs. |
| SE ADR-0016 through ADR-0020 (M1.5/governance-plugin porting) | NOT-APPLICABLE | No ported M1.5 file touched by this diff. |

No cross-domain ADR collision found. No ADR outside red-team's/app-security's own lane is violated by either fix.

## Seam findings

### 1. ComputePinInput's two new REQUIRED fields - caller-set completeness, verified independently

The implementer's commit message claims the only caller is loader.ts's one call site, plus pin.test.ts/loader.test.ts in tests. Verified independently rather than trusting the claim:

```
$ grep -rn "computePin(" --include="*.ts" src/ | grep -v ".test.ts"
src/policy/config/loader.ts:230:  const pin = computePin({
src/policy/config/pin.ts:85:export function computePin(input: ComputePinInput, now: Date = new Date()): PolicyPin {
```

One production call site (loader.ts:230), one definition site. printer.ts imports type PolicyPin (line 16) but only ever consumes result.pin as a value (printer.ts:100) - it never constructs a ComputePinInput. print-cli.ts only reads result.pin.digest/.channel/.computedAt (three read-only property accesses) - also never constructs one. The claimed caller set is the actual, complete caller set.

### 2. loader.ts's new try/catch around shipped-defaults/project reads vs. printer.ts's outer catch-all - compose correctly, no double-catch

loader.ts:179-190 and loader.ts:196-208 now wrap both previously-unwrapped readFileSync calls, returning a typed LoadFailure with failedLayer set (and central's own already-known centralStatus/centralChannel preserved) before any exception can reach printer.ts. printer.ts:106-121's own try/catch is unchanged in shape but now genuinely narrower in practice: it is a last-resort backstop for an exception loader.ts itself doesn't already name - e.g. a throw inside validateRuleSet, mergeLayersWithMandatoryLock, findRulePositions/tokenize, or computePin, none of which are wrapped inside loader.ts's own try blocks. On that residual path, printer.ts:120 defaults failedLayer to "central" - documented in-line as "the true origin is genuinely unknown at this point," not a regression: every named failure shape (the common case, and the one both Issues #108/#110 concern) is now attributed correctly by loader.ts itself. No entry is caught twice, nothing is swallowed differently than before - the outer catch's scope only shrank.

### 3. Issues #110 and #108 touch disjoint control flow inside the same loadEffectivePolicy function - compose correctly

Issue #110's change (computePin's two new required fields) is reachable only on the success path, after both shippedText/projectText have already been successfully read and parsed (loader.ts:230). Issue #108's change (the failedLayer-carrying early returns, plus the two new read-error returns) lives entirely in the failure branches that precede that point. The two fixes never touch the same statement, and the type system enforces the composition: computePin's now-required shippedRaw/projectRaw are only ever callable with the two let bindings that TypeScript can only see as narrowed-to-string past every one of Issue #108's new early-return guards - a caller cannot reach the computePin call with an unset/failed read in hand.

### 4. Independent re-run of every check claimed in both commit messages

```
$ npm run typecheck        # tsc --noEmit -p tsconfig.json         exit 0
$ npm run lint              # eslint .                              exit 0
$ node --test src/policy/config/loader.test.ts src/policy/config/pin.test.ts src/policy/config/printer.test.ts
# tests 43  pass 43  fail 0  skipped 0
$ node --test --test-reporter=tap
# tests 655  pass 654  fail 1  skipped 0  todo 0
# the one failure: "OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass" - confirmed by name, the same pre-existing Issue #113 failure both commit messages cite, unrelated to this diff.
```

Every number in both commit messages (28/28, 43/43, 655/654/1/0) matches what I independently re-ran. No discrepancy.

### 5. BOM fixture - real bytes, not a simulated string

docs/qa/s6-policy-loader-fixtures/printer-project-bom-malformed.json claims a real 3-byte UTF-8 BOM prefix (not an escaped \uFEFF string). Verified: xxd shows "ef bb bf 7b 22 76 65 72 73 69 6f 6e..." - a genuine EF BB BF prefix immediately before the JSON. Claim holds.

No [ISSUE]/[SUSPICION] findings this round - every seam checked composes correctly, and the whole-catalog ADR sweep found no collision outside red-team's/app-security's own lanes.

## Coverage gaps

- **This exact diff has not yet been re-confirmed by red-team.** Both app-security-reviewer and red-team's most recent reports stop at 602be5c; Issues #110 and #108 were named by red-team in earlier rounds, but the fix landed in 8468ab4/a7014ab/88002aa has not yet had red-team's own adversarial re-attack against it. Per CLAUDE.md's CRITICAL tier ("red-team + the relevant domain reviewer(s)"), this is the standing required gate, not yet closed - naming it plainly rather than silently treating my own pass as a substitute for it (PRINCIPLES rule 13).
- CHANGELOG.md and the test-writer amendment report (docs/reviews/s6-printer-test-writer-fixnow-2026-09-08.md) are documentation-only changes in this diff; no reviewer lane specifically claims prose review of them, and that's fine here - low-risk, and I spot-checked both for factual accuracy against the code while reviewing (no discrepancy found).
- Two uncommitted working-tree changes (docs/STATE.md, docs/backlog.md) exist at review time but are NOT part of this diff (git diff --stat 4113cfb..HEAD does not include them) - out of scope for this report.

## Verdict and next action

**APPROVE.** No ADR collision, no seam defect, all claimed checks independently re-run and matching. The one open item is procedural, not a defect: **red-team's re-confirm round on commits 8468ab4/a7014ab/88002aa is the single next action** before this fix-now round can close per this project's own CRITICAL-tier ceremony.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by blast radius):
1. [CLEAN][code-traced] Whole-ADR-catalog sweep (35 ADRs) vs. the diff -- no collision outside red-team's/app-security's own lanes; SE ADR-0002/0003/0021 conform (no new cross-layer import, kernel untouched), SE ADR-0009 stays not-applicable by convention (manual CLI, unchanged ruling from round 2), SE ADR-0005/0006/0010 conform, devops + SE-0011-0020 not-applicable (no infra/data/ported-file touched).
2. [CLEAN][code-traced] ComputePinInput/computePin caller-completeness independently verified via grep -rn "computePin(" src/ (excluding tests) -- single production call site loader.ts:230; printer.ts/print-cli.ts only consume PolicyPin as a value, never construct the input. Implementer's claimed caller set is the real, complete set.
3. [CLEAN][code-traced] loader.ts's new readFileSync try/catch (loader.ts:179-190, 196-208) composes correctly with printer.ts's outer catch-all (printer.ts:106-121) -- no double-catch, no silent-swallow change; the outer catch's scope only narrowed to genuinely unnamed exceptions, documented in-line.
4. [CLEAN][code-traced] Issue #110 (success-path pin computation) and Issue #108 (failure-path early returns) touch disjoint control flow inside the same loadEffectivePolicy function and compose correctly -- type system enforces computePin's required fields are only reachable past every Issue #108 guard.
5. [CLEAN][demonstrated] Independently re-ran typecheck (exit 0), lint (exit 0), targeted tests (43/43 pass), full suite (655/654 pass/1 pre-existing fail, confirmed by name = OSS-01/Issue #113) -- every number in both commit messages matches exactly, no discrepancy.
counts (CHECKSUM): issues=0 suspicions=0 clean=5
evidence (CHECKSUM): demonstrated=1 code-traced=4 derived=0
checks=typecheck exit 0; lint exit 0; loader.test.ts+pin.test.ts+printer.test.ts 43/43 pass, 0 fail, 0 skipped; full suite 655 tests / 654 pass / 1 fail (pre-existing OSS-01, Issue #113, confirmed unrelated) / 0 skipped
adr=HIT(35, whole catalog)
report=docs/reviews/s6-policy-centralization-cross-domain-round3-2026-09-08.md
