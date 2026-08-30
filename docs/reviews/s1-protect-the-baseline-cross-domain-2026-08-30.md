# Cross-Domain Review — S1 "protect the baseline" (commit 2992bfb)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-08-30
**Subject:** commit `2992bfb` (local, unpushed), diff from `a5448c6`, 42 files, +4636/-9.
**Tier:** STANDARD. Running alongside `app-security-reviewer` (covering CI-workflow-security, `src/secret-scan/*`, supply-chain/deps) per `docs/STATE.md` Stage 3 dispatch.

## Lanes already covered

`app-security-reviewer` (parallel, this session): CI-workflow security (`.github/workflows/ci.yml` permissions, secrets, injection), `src/secret-scan/*` (pattern design, redaction correctness, allowlist mechanism), supply-chain/deps (`package.json`/`package-lock.json`). I did not re-litigate that surface's own internal correctness -- I checked it only for seams against the rest of the diff and for ADRs outside their lane.

My own pass: whole 35-ADR catalog (unfiltered), seam-hunting across `src/lib/`, `src/qa/`, `src/secret-scan/`, `.github/workflows/ci.yml`, and independent re-runs of typecheck/lint/test/CLI instruments.

## ADR cache

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp be365e4, CACHE=HIT

## Cross-domain ADR verdict (whole catalog, outside app-security's lane)

| ADR | Verdict | Basis |
|---|---|---|
| devops ADR-0001-0010 (IaC/CDK/tagging/cost/pipeline/IAM) | N/A -- confirmed, not assumed | git show --stat diff has zero cloud/IaC/CDK/Terraform files; no cdk.json, no stack code, no tags, no IAM. Checked the file list directly, not inferred. |
| SE ADR-0001 (no self-accept) | CLEAN | adr/software-engineering/0021-thoth-native-architecture.md:4 still status: proposed. grep -rn "ADR-0021" src/ docs/qa/ CHANGELOG.md .github/ shows only future-tense/hedged references (policy-fixtures.ts:4 "may supersede") and test fixture data (reference-resolver.test.ts) -- no file claims or implies acceptance. |
| SE ADR-0002/0003 (layering, SOLID) | CLEAN | I/O confined to src/lib/exec.ts (injectable Runner), src/lib/git.ts (takes a Runner), src/lib/fs-snapshot.ts/fs-walk.ts (isolated recursive-read helpers). Every decision function is pure and unit-tested without I/O: checkCoverage, checkDiffFixtures, validateRegistry, checkBrokenInstruments, summarizeMutationRun, summarizeCitations, summarizeMatches, scanReferences, classifyAdr/classifyIssue/classifyPath. main() functions are the only I/O-touching code, matching the pattern exec.ts's own header comment names explicitly. |
| SE ADR-0004 (idempotency) | CLEAN | Every instrument is a read-only check (or overwrites the same output file, docs/qa/history-scan-report.json, gitignored); no accumulating state, no mutating operation to re-run-twice-test. |
| SE ADR-0005 (test-per-behavior, error paths) | ISSUE -- see finding 1 | Spot-checked exec.ts/git.ts/patterns.ts regression tests against the three claimed bugs -- all three are real, with real regression tests (below). But diff-fixture-check.ts and reference-resolver.ts's main() error-handling branch (git-diff failure) is completely untested in both .test.ts files -- an error path with zero coverage, which is exactly what this ADR requires covered. |
| SE ADR-0006 (blast radius) | CLEAN | find src -iname "*kernel*" -o -iname "*action*.ts" -o -iname "*normalizer*" -o -iname "*audit-log*" -o -iname "*evidence*" returns nothing -- none of ADR-0021's six S2+ shapes (kernel, canonical Action record, normalizer registry, gate surfaces, audit log, environment model) exist in this diff. Diff stays inside the 10 requirement IDs it claims (CI-01, QA-01/02/05/06/13/14/15/16, OSS-01). |
| SE ADR-0009 (no secrets/PII in logs) | CLEAN (independently re-derived) | redact() (src/secret-scan/patterns.ts:28-31) shows only the first 4 chars + a length. For every pattern whose entire regex match IS the secret (aws-access-key-id, github-pat, slack-token), those 4 chars are the pattern's own fixed constant prefix (AKIA, ghp_, xoxb), carrying no entropy from the actual secret. For patterns where the match includes a label (aws-secret-access-key, generic-password-assignment), the 4 chars are label text, not secret content. printInstrumentResult only ever prints result.details, which for OSS-01 is already-redacted strings. No raw secret text reaches console, file, or report at any point I traced. |
| SE ADR-0010 (gate parity, ratchet, justified deps) | CLEAN | package.json scripts (typecheck, lint, test, every qa:*, oss:secret-scan) match .github/workflows/ci.yml's steps 1:1, independently re-run below. New deps are all devDependencies (eslint, typescript, typescript-eslint, @types/node, @eslint/js) -- standard toolchain, justified by docs/decisions.md 2026-08-30's tier-ratification row. grep for .only(/.skip(/eslint-disable/@ts-ignore/@ts-expect-error across src/ returns nothing -- no suppressions anywhere. |

## Seam findings

### 1. [ISSUE][MED] QA-02 and QA-14's CI-ref failure path silently vacuous-passes -- a recurrence of a previously-closed, previously-predicted finding

**Domains in tension:** CI-workflow ref resolution (the diff-refs step in .github/workflows/ci.yml, app-security's named lane) x the QA instruments' own error-handling design (src/qa/diff-fixture-check.ts, src/qa/reference-resolver.ts, story-implementer's territory). Each side's "not my problem" meets exactly here: the CI step supplies github.event.before uncritically; the instrument's main() catches ANY git diff failure -- including an invalid/zero ref -- and reports it as VACUOUS-PASS, indistinguishable in the CI log from the legitimate "nothing changed" case.

**Evidence -- demonstrated.** I ran both instruments with a zero-SHA base ref (the exact value GitHub Actions documents for github.event.before on a branch's first push or a history-discontinuous push -- precisely what this repo's own history already did once, per docs/decisions.md 2026-08-29's orphan-branch-reset row):

    $ node src/qa/diff-fixture-check.ts 0000000000000000000000000000000000000000 HEAD
    [QA-02 diff-fixture-check] VACUOUS-PASS: No diff available between 0000...0000 and HEAD
      (git diff --name-only 0000...0000...HEAD failed (exit 128): fatal: Invalid symmetric
      difference expression 0000...0000...HEAD) -- vacuous pass.
    exit=0

    $ node src/qa/reference-resolver.ts 0000000000000000000000000000000000000000 HEAD
    [QA-14 reference-resolver] VACUOUS-PASS: No diff available between 0000...0000 and HEAD -- vacuous pass.
    exit=0

Both exit 0. Both print the instrument's own boilerplate "no real content exists yet for this check to act on" -- which is false in this case: real content exists, the diff computation itself failed. This is precisely the class QA-16 (src/qa/broken-instrument-gate.ts) exists to police in other instruments -- an instrument reporting green while silently doing nothing -- but neither QA-02 nor QA-14 applies that discipline reflexively to their own main().

**Evidence -- code-traced, exposure counted in code, not assumed.** diff-fixture-check.test.ts (5 tests) and reference-resolver.test.ts (17 tests) both exercise only the pure checkDiffFixtures/scanReferences functions -- confirmed 0 of 22 combined tests touch either main()'s catch branch. 2 of the 9 diff-consuming/diff-aware S1 instruments (QA-02, QA-14) share this exact untested pattern; the other 7 (QA-01, QA-05, QA-06, QA-13, QA-15, QA-16, OSS-01) do not consume a CI-supplied diff ref at all and are not affected.

**This is a recurrence, not a new class.** GitHub Issue #18 (filed 2026-08-25 against the prior lineage, closed COMPLETED 2026-08-30) named this exact gap before it was built: "github.event.before is documented to be all-zeros on a branch's first push or a force-push, which needs its own fallback handling to avoid trading this bug for a worse one (diffing against a nonexistent ref)." S1's fresh build fixed the issue's original defect (hardcoded HEAD^ HEAD, now correctly event-conditional in ci.yml's diff-refs step) but never built the fallback handling the same issue explicitly called for -- so the predicted "worse bug" is now present, demonstrated above. Per CLAUDE.md's Issue Discipline ("if a closed issue's problem recurs, REOPEN the same issue... never open a fresh duplicate"), I reopened #18 rather than filing a new issue -- see below.

**Minimal fix:** in both main()s, distinguish "ref invalid/unreachable" from "no changes" -- e.g. detect the zero-SHA sentinel explicitly and fall back to scanning the full tree (or the single head commit) instead of silently no-op'ing, or fail loudly with a distinct exit code/message so it cannot be mistaken for the legitimate vacuous case. Add one test per instrument exercising the throw path.

**Exposure:** 2 of 9 diff-consuming S1 instruments; 0% of that error branch covered by tests (counted in code, 0/22 tests). Current real-world trigger is the documented github.event.before zero-SHA case (first push / history-discontinuous push to master) -- narrow but not hypothetical for this specific repo, which already discontinuous-reset master's history once this session.

### 2. [SUSPICION][LOW] OSS-01's redacted-report artifact uploads on if: always(), including on a failing (secrets-found) run

.github/workflows/ci.yml:89-95 uploads docs/qa/history-scan-report.json unconditionally, even when the OSS-01 full-history secret scan step fails (real matches found). The report contains 4-char-prefix-plus-length redactions per match. Today's exposure is 0% -- docs/decisions.md 2026-08-30 explicitly scopes the repo-visibility flip to public out of S1, so no public artifact-visibility risk exists yet -- but the moment that flip happens, a failing run's own remediation artifact becomes part of what a public-repo Actions run publishes. This sits on the boundary between "CI workflow design" and "secret-scanner report handling," both named as app-security-reviewer's lane this round; flagging in case it fell in the seam between "the workflow's problem" and "the scanner's problem" rather than being covered by either. Not blocking -- narrow-entropy redaction, zero current exposure, easy to gate behind a failure/visibility condition later if it is not already on their list.

### 3. [CLEAN] QA-13's shipped scope matches the human-ratified lighter form exactly

Checked src/qa/recurring-findings-registry.ts and docs/qa/recurring-findings-registry.md against docs/decisions.md 2026-08-30's ruling ("a registry file plus this documented convention, not an automated classifier... deferred to docs/backlog.md"). The shipped code is a structural validator only (table shape, date+citation format, non-placeholder status) -- no recurrence-detection logic, no prose classifier. Matches the ratified scope exactly, neither over- nor under-built.

### 4. [CLEAN] Build receipt's own claims independently verified

- npm run typecheck -- clean, 0 errors (re-run myself).
- npm run lint -- clean, 0 findings (re-run myself).
- npm test -- 80 pass, 0 fail, 0 cancelled, 0 skipped, 4049ms (re-run myself, raw output captured, matches the claimed "80/80, 0 skipped" exactly).
- All 3 claimed bugs are real, each with a real regression test that fails without the fix and would catch a reintroduction: exec.test.ts (NODE_TEST_CONTEXT leak), git.test.ts (gitlink/submodule lsTree entries), patterns.test.ts (email-regex TLD false positive on npm version specifiers).
- "11/11 AC mapped" claim: UNPROVEN-pending-verification -- no persisted Phase 1 plan artifact exists in the repo (docs/STATE.md itself says the plan lives only in this session's story-implementer transcript). I have no independent artifact to check the 11-item reconstruction against. This is the Manager's call to settle from the transcript, not something I can demonstrate or code-trace from the diff alone; not a blocker on its own.

## Coverage gaps (named, not necessarily findings)

- package-lock.json (1518 lines), .github/workflows/ci.yml's own permissions/injection surface, src/secret-scan/*'s pattern-design correctness -- squarely app-security-reviewer's named lane this round (CI-workflow-security/secret-scanner/supply-chain); intentionally not re-audited here beyond the seam check above.
- tsconfig.json, eslint.config.mjs -- low-risk build config; covered indirectly by my own clean typecheck/lint re-runs, not independently line-audited beyond that.
- REQUIREMENTS.md's M1 milestone text also names INT-01; S1's own scope (per docs/STATE.md/docs/decisions.md) is the 10 IDs above, not the full M1 milestone -- expected under the fresh 17-story decomposition, not a gap in this diff.

## Addendum — app-security-reviewer's report (published mid-review, read after mine was drafted)

`docs/reviews/s1-protect-baseline-app-security-2026-08-30.md` landed while I was writing this report. Their verdict is **REWORK**: a demonstrated HIGH, `src/qa/completeness-claim-checker.ts:76-99`'s `verifyMarkerClaim` execFile()s an attacker-controlled `cmd=` string parsed straight out of `docs/STATE.md`/`docs/decisions.md`/`CHANGELOG.md` prose, wired unconditionally into `ci.yml`'s QA-15 step. Worth naming here for two reasons, not to re-litigate it:

1. **No redundancy** — I read `completeness-claim-checker.ts` myself during this pass (see `src/qa/completeness-claim-checker.ts` in my own notes above) and it does not overlap with either of my two findings; my finding 1 (QA-02/QA-14 silent vacuous-pass) is a different file pair, a different mechanism (error-swallowing, not command injection), and a different domain (fail-open on ref-resolution failure, not RCE). No double-count.
2. **It validates this role's own method.** Their finding lives in `src/qa/*`, a file *outside* their dispatch brief's named sensitive-area list (`.github/workflows/ci.yml`, `src/secret-scan/*`) — caught only because they followed the wiring (QA-15 is unconditionally invoked by the same `ci.yml` they were dispatched to check) rather than the file list. That is exactly the seam-following method this role also uses, arriving independently at a different seam (QA-02/QA-14's error path, also reachable only by following wiring rather than a named-file list).

**Net effect on the Stage 3 gate:** the joint verdict the Manager acts on is **REWORK**, driven by app-security-reviewer's HIGH finding — my own APPROVE-WITH-CONDITIONS below describes only what I found on my own ground and does not override or soften theirs. Both reports' conditions/blockers should be resolved together before re-review, not sequentially.


## Verdict

APPROVE-WITH-CONDITIONS.

One condition: finding 1 (QA-02/QA-14 silent vacuous-pass on diff-ref failure) should be fixed before or shortly after this ships -- it is real, demonstrated, and it undermines exactly the guarantee QA-02/QA-14 exist to provide, but current exposure is narrow (0 policy rules exist yet for QA-02; QA-14's exposure is real but bounded to one CI run per trigger, fully self-healing on the next normal push) and nothing here touches a sensitive area beyond what is already gated. Does not block merge on its own; track it as the open condition.

## Failing tests mapped to open findings

| Finding | Named failing test (to be added) |
|---|---|
| 1 | src/qa/diff-fixture-check.test.ts: "main(): git diff failure is NOT silently reported as vacuous pass" (assert a distinct failure/exit-code, not VACUOUS-PASS, when the base ref is unresolvable) |
| 1 | src/qa/reference-resolver.test.ts: same shape, for QA-14's main() |

Open findings = 1 ([ISSUE]); failing tests = 2 (one per affected instrument, since each instrument's main() needs its own regression test -- same finding, two executable forms, named above).

## RECEIPT

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][demonstrated] src/qa/diff-fixture-check.ts:88-99 + src/qa/reference-resolver.ts:208-220 -- CI ref-resolution failure (e.g. github.event.before zero-SHA) silently reports VACUOUS-PASS instead of failing, untested (0/22 tests cover it), recurrence of closed Issue #18's own prediction; reopened #18, fix: detect the invalid-ref case explicitly and fail loud or fall back to full-tree scan, add one regression test per instrument.
2. [SUSPICION][LOW][code-traced] .github/workflows/ci.yml:89-95 -- OSS-01's redacted report artifact uploads on if: always() including failing runs; 0% exposure today (repo not public per S1 scope), flag in case it is outside app-security-reviewer's own list.
3. [CLEAN][code-traced] SE ADR-0001/0002/0003/0004/0006/0009/0010 and all 10 devops ADRs -- checked against the diff directly, no violation; devops ADRs confirmed N/A (no IaC files in diff, not assumed).
4. [CLEAN][code-traced] QA-13 shipped scope matches the 2026-08-30 human ruling's lighter registry-file form exactly, neither over- nor under-built.
5. [CLEAN][demonstrated] Build receipt's 80/80 tests / typecheck / lint / 3 real regression-tested bugs -- independently re-run, all confirmed as claimed.
6. [SUSPICION][LOW][derived] "11/11 AC mapped" claim -- UNPROVEN-pending-verification, no persisted Phase 1 plan artifact exists to check it against; not a blocker, Manager's call from the session transcript.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=2 clean=3
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=3 derived=1
checks=typecheck: 0 errors; lint: 0 findings; test: 80 pass/0 fail/0 skipped/0 cancelled (4049ms); demonstrated QA-02/QA-14 zero-SHA vacuous-pass via direct CLI invocation (both exit 0)
adr=HIT(35, whole catalog)
report=docs/reviews/s1-protect-the-baseline-cross-domain-2026-08-30.md
