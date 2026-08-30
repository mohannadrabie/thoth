# Cross-Domain Reviewer -- Re-confirmation Pass -- S1 protect the baseline fix-now commit

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-08-30
**Subject:** commit 366c54d (local, unpushed), diff from 2992bfb, 13 files, story-implementer Stage 3 fix-now pass.
**Tier:** STANDARD (unchanged).

## Lanes already covered (this round)

app-security-reviewer's original REWORK (HIGH, GH#57, completeness-claim-checker.ts command injection) is the item this commit's largest change addresses; I did not re-litigate injection-surface design from scratch -- I read the actual fixed code and its regression tests to confirm the claimed allowlist mechanism is real, which is squarely their lane's own subject matter but directly relevant to confirming the fix landed as described.

My own ground, per this role: the whole 35-ADR catalog (unfiltered), the shared resolveChangedFiles design choice across both affected instruments (the design-judgment question this task specifically raised), independent re-runs of typecheck/lint/test, and a fresh code-traced/demonstrated check of the new fallback's actual semantics rather than just confirming its tests pass.

## ADR cache

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp be365e4, [CACHE=HIT].

## Cross-domain ADR verdict (whole catalog)

No new territory: the 13 changed files stay inside src/lib/, src/qa/, .github/workflows/ci.yml, CHANGELOG.md, docs/STATE.md, docs/qa/recurring-findings-registry.md -- the same surface the prior report already cleared against SE ADR-0001/0002/0003/0004/0006/0009/0010 and confirmed all 10 devops ADRs N/A (no IaC files). Re-checked directly rather than re-deriving from scratch:

| ADR | Verdict | Basis |
|---|---|---|
| SE-0002/0003 (layering, SOLID) | CLEAN | New resolveChangedFiles/isZeroSha/resolveWithinRepo (src/lib/git.ts, src/qa/reference-resolver.ts) are pure, injectable-GitOps-based, unit-tested without real I/O. KNOWN_INSTRUMENTS allowlist in completeness-claim-checker.ts is a frozen, code-owned constant, not runtime-mutable state. |
| SE-0004 (idempotency) | CLEAN | Still read-only checks; the new full-tree-scan fallback is itself a pure read (git ls-tree), no new mutating operation introduced. |
| SE-0005/0010 (test coverage, no suppressions) | CLEAN | grep across src/ for .only(, .skip(, eslint-disable, ts-ignore, ts-expect-error returns nothing in the diff's touched files. 9 new regression tests, none tautological (see finding-by-finding verification below). |
| SE-0009 (no secrets/PII in logs) | CLEAN | New console.log NOTE lines in diff-fixture-check.ts/reference-resolver.ts print only the base/head ref strings and a fixed template -- no new secret-adjacent surface. |
| devops ADR-0001-0010 | N/A, confirmed not assumed | git show 366c54d --stat -- no IaC/CDK/Terraform files in this diff. |

No collision found in a lane outside app-security's/mine. No new ADR-0021 self-accept language (grep for ADR-0021 across CHANGELOG.md docs/STATE.md shows only proposed / hedged references, unchanged from prior pass).

## Verification of the 4 claimed fixes

### 1. [HIGH, GH#57] completeness-claim-checker.ts command-injection fix -- CONFIRMED REAL

src/qa/completeness-claim-checker.ts:33-46 -- KNOWN_INSTRUMENTS is a Readonly<Record<...>>, Object.freeze-d, mapping a fixed symbolic name to a fixed {cmd, args} pair. verifyMarkerClaim (line ~106) does KNOWN_INSTRUMENTS[claim.cmd] -- an object-property lookup, not a shell invocation of claim.cmd -- and returns a fail-closed result (ok: false, runner never called) when the name is not present. Confirmed by the new regression test's own logic: spyRunnerThatMustNotBeCalled() records every call and the test asserts calls.length === 0 after feeding cmd="node ./payload.js" and cmd="rm -rf / ; curl evil.example" -- both pass with zero runner invocations (verified via the real npm test run below, not just read). This is a real, structurally-sound fail-closed fix, not a superficial string-blocklist.

GH issue #57: confirmed CLOSED, state_reason: COMPLETED, with a same-turn [story-implementer] comment naming the fix and linking evidence -- Issue Discipline followed correctly.

### 2. [MED, GH#18 second recurrence] QA-02/QA-14 zero-SHA vacuous-pass fix -- REAL FIX, but a real design gap remains in QA-02's fallback semantics

The zero-SHA detection and fallback dispatch are genuine, not cosmetic:
- isZeroSha() (src/lib/git.ts:23-25) is a straightforward /^0+$/ regex check, tested against both the real 40-char sentinel and non-zero-looking refs (git.test.ts).
- resolveChangedFiles() (git.ts:41-53) checks isZeroSha before ever calling git diff -- proven not just asserted: all three new regression tests (git.test.ts, diff-fixture-check.test.ts, reference-resolver.test.ts) use a Runner that throws if args[0] === "diff" is ever reached, and the tests pass, meaning git diff genuinely never fires on the zero-SHA path.
- The fallback genuinely calls git.lsTree(scanRef), which uses ls-tree -r (git.ts:83, pre-existing, recursive) -- a real full-tree scan, not a stub returning []. Confirmed by reading the flag directly.

I independently re-ran both instruments the same way the original finding demonstrated the bug, to confirm the bug itself is actually gone (not just that new unit tests pass):

    node src/qa/diff-fixture-check.ts 0000000000000000000000000000000000000000 HEAD
    => [QA-02 diff-fixture-check] NOTE: base "0000...0000" / head "HEAD" included the zero-SHA sentinel ... falling back to a full-tree scan instead of a diff, not silently passing.
    node src/qa/reference-resolver.ts 0000000000000000000000000000000000000000 HEAD
    => [QA-14 reference-resolver] NOTE: base "0000...0000" / head "HEAD" included the zero-SHA sentinel ...

Neither instrument silently exits 0 with VACUOUS-PASS on the zero-SHA input anymore -- the original demonstrated defect is gone.

New regression tests are genuinely exercising, not tautological. All three (git.test.ts, diff-fixture-check.test.ts, reference-resolver.test.ts) construct a Runner that throws on diff and returns a real ls-tree-shaped stdout on ls-tree, then assert fullTreeFallback === true and the correct file list comes back. Reverting the fix (removing the isZeroSha pre-check) would make these fail -- the throwing runner would fire on the old code path since the old code always called diffNameOnly first.

But: I found a real, demonstrated design gap in the fallback's own semantics that the task specifically asked me to sanity-check, and neither the new regression tests nor the fix's own reasoning catch it.

checkDiffFixtures (src/qa/diff-fixture-check.ts) exists to enforce temporal coupling: a policy rule file changed in this diff with no accompanying fixture change in the same diff (see the file's own header comment, and QA-01's header comment explicitly contrasting itself: "Diff-aware: looks at what actually changed between two refs, not the whole tree -- that's QA-01's job"). On the full-tree fallback, resolveChangedFiles returns every tracked file as changed -- which means, fed into checkDiffFixtures, every rule file AND every fixture file in the repo is simultaneously changed. This collapses the temporal-coupling check into "does this rule have any fixture anywhere in the tree" -- regardless of whether that fixture was touched in this commit at all.

I demonstrated this directly by calling checkDiffFixtures with a full-tree-shaped file list containing one rule (POL-A) and its pre-existing, untouched fixture:

    fullTree = ["policy/a.rule.json", "policy/a.fixture.json", "src/unrelated.ts"]
    rules = [{ id: "POL-A", file: "a.rule.json" }]
    fixtures = [{ ruleId: "POL-A", file: "a.fixture.json", kind: "positive" }]
    checkDiffFixtures(fullTree, "policy", rules, fixtures)
    => {
      "ok": true,
      "vacuous": false,
      "summary": "1 changed policy rule(s), each with an accompanying fixture change.",
      "details": []
    }

ok: true and the summary text claims "each with an accompanying fixture change" -- a false claim: nothing was proven to have changed together in this commit; the fixture merely already existed, untouched, from before. On a zero-SHA CI run, a rule whose content changed in a way that quietly invalidates a pre-existing (but not updated) fixture would pass QA-02 with a confident-sounding, false-positive summary -- exactly the class of false-completeness assertion that QA-15 (completeness-claim-checker.ts, the very instrument fixed for GH#57 in this same commit) exists to catch in prose, now reproduced inside QA-02's own fallback logic.

This does not create an actual pipeline blind spot, because QA-01 (fixture-coverage-check.ts) runs unconditionally on every CI run (no base/head args -- confirmed via .github/workflows/ci.yml:62-63) and enforces the stricter invariant "every rule has at least one positive AND one negative fixture" regardless of what QA-02 does. So the actual coverage floor (a rule with literally zero fixtures) is still caught. What is lost, specifically on a zero-SHA CI run, is QA-02's own forcing-function value beyond QA-01: nudging a contributor to actually touch the fixture file when they touch the rule file, not merely have some fixture on disk.

By contrast, QA-14's fallback is safe by the same reasoning in the opposite direction. reference-resolver.ts's invariant (every reference in a changed file shall resolve) is not inherently diff-relative -- scanning every tracked file instead of just the diff's files is strictly broader, catching more, not less. Confirmed by reading scanReferences/shouldScanFile (reference-resolver.ts:148-188): nothing in the classification logic depends on whether a file was touched in this diff, only on file content. The shared resolveChangedFiles helper was applied uniformly to two callers whose own invariants have opposite relationships to "diff vs full tree" -- safe widening for one, silent narrowing-of-guarantee for the other, without either commit message or code comment flagging that the two callers' semantics diverge.

Exposure: basis is assumption, not measured -- no CI run history exists to count how often a zero-SHA event coincides with a rule-file change that has a stale-but-existing fixture. Per this role's evidence policy, an assumption-based exposure caps this finding at LOW regardless of the demonstrated code defect underneath it. Not blocking; QA-01 is a real backstop for the coverage floor. Recommend: a regression test in diff-fixture-check.test.ts that feeds resolveChangedFiles's real fallback output (not a hand-built full-tree array) into checkDiffFixtures with a rule whose fixture pre-exists and asserts the summary text does NOT claim "accompanying fixture change" on the fallback path -- or, more simply, have main() use QA-01-style wording when resolved.fullTreeFallback is true, since that is honestly what is being checked in that mode.

Registry entry re-confirmed. docs/qa/recurring-findings-registry.md's new row is well-formed (4 columns matching the header, dated citations, a real status). src/qa/recurring-findings-registry.ts:1-3 reads, verbatim: "This is NOT an automated recurrence classifier ... deferred until real review history exists to learn from" -- the disclosure is accurate; nothing in the file contains recurrence-detection logic, only structural validation of the markdown table (confirmed by reading the full file, not just the header comment). recurring-findings-registry.test.ts's updated dogfood test (vacuous: false now, was true) confirms the real file is exercised, not a fixture stand-in.

GH issue #18: confirmed CLOSED, state_reason: COMPLETED, with a same-turn [story-implementer] comment stating explicitly that a third recurrence reopens this same issue, not a new one -- correct Issue Discipline.

### 3. [LOW] CI Action pinning -- CONFIRMED, SHAs verified against the real tags

.github/workflows/ci.yml pins actions/checkout, actions/setup-node, actions/upload-artifact to 40-char commit SHAs with a version comment. I independently verified all three against GitHub's own API rather than trusting the comment:

    GET https://api.github.com/repos/actions/checkout/git/refs/tags/v4.4.0
    => sha: 11d5960a326750d5838078e36cf38b85af677262   (matches ci.yml exactly)
    GET https://api.github.com/repos/actions/setup-node/git/refs/tags/v4.4.0
    => sha: 49933ea5288caeca8642d1e84afbd3f7d6820020   (matches ci.yml exactly)
    GET https://api.github.com/repos/actions/upload-artifact/git/refs/tags/v4.6.2
    => sha: ea165f8d65b6e75b540449e92b4886f43607fa02   (matches ci.yml exactly)

All three real. Genuinely closes the floating-tag supply-chain surface for these three steps.

### 4. [LOW, SUSPICION] reference-resolver.ts path-traversal fix -- CONFIRMED REAL

resolveWithinRepo() (reference-resolver.ts:103-113) resolves relPath against repoRoot, then rejects (returns null) unless the resolved absolute path equals repoRoot or starts with repoRoot + sep -- a correct containment check (uses the actual OS separator, handles the exact-root edge case explicitly, not just a naive startsWith(repoRoot) which would be vulnerable to a sibling-directory-prefix bypass, e.g. repoRoot-evil). Both pathExists/lineCount (lines ~257-268) route through it before touching the filesystem. New regression test confirms ../../etc/passwd-style inputs return null while well-behaved relative paths still resolve correctly (no over-rejection).

## Independent re-run of the build receipt

    npm run typecheck    -> tsc --noEmit -p tsconfig.json: 0 errors
    npm run lint         -> eslint .: 0 findings
    npm test             -> tests 89, pass 89, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 9962

Matches the commit message's claimed "89/89, 0 skipped" exactly, independently re-run, not trusted from the message.

## Coverage gaps (named, not necessarily findings)

- app-security-reviewer's own re-confirmation of the GH#57 fix (their named lane) is a separate dispatch; I read and confirmed the fix's structural soundness above but that is not a substitute for their own pass.
- package-lock.json / dependency surface: unchanged in this diff, not re-audited (nothing new to check).

## Verdict

APPROVE-WITH-CONDITIONS.

Both prior blocking items (HIGH GH#57, MED GH#18) are genuinely fixed, verified by direct demonstration and code-tracing, not by trusting the commit message. One new condition, LOW severity, does not block merge: QA-02's full-tree fallback silently changes what "pass" means (from "rule and fixture changed together in this diff" to "rule has some fixture somewhere in the tree") without disclosing that shift in its own summary text, which claims a coupling that was not actually checked in fallback mode. QA-01 is a real, unconditional backstop for the underlying coverage floor, so this does not reopen GH#18 a third time -- it is a narrower, LOW-severity residual on the fallback path specifically.

## Failing tests mapped to open findings

| Finding | Named failing test (to be added) |
|---|---|
| QA-02 fallback semantic drift | src/qa/diff-fixture-check.test.ts: "main()/checkDiffFixtures on the fallback path does not claim an accompanying fixture change for a pre-existing, untouched fixture" (feed resolveChangedFiles's real fallback shape with a stale fixture and assert the result does not assert temporal coupling it did not check) |

Open findings = 1 ([ISSUE][LOW]); failing tests = 1 (single executable form, one instrument affected -- QA-14's fallback is not affected by the same class, confirmed above).

## RECEIPT

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][LOW][demonstrated] src/qa/diff-fixture-check.ts (checkDiffFixtures fed a full-tree-fallback file list) -- QA-02's fallback silently collapses "rule+fixture changed together in this diff" into "rule has any fixture anywhere in the tree", and the summary text falsely claims an accompanying fixture change for a stale, untouched fixture; exposure basis is assumption (no CI history to count zero-SHA-event frequency) so capped at LOW; not blocking, QA-01 backstops the real coverage floor unconditionally on every run; fix: do not claim temporal coupling in fallback-mode summary text, add one regression test feeding a stale-but-existing fixture through the real fallback path.
2. [CLEAN][demonstrated] src/qa/completeness-claim-checker.ts:33-46,~106 -- GH#57 HIGH fix confirmed real: KNOWN_INSTRUMENTS is a frozen allowlist, cmd= is a property lookup never a shell string, spy-runner regression tests prove zero invocations on a malicious payload; issue #18 and #57 both confirmed CLOSED/COMPLETED with correct same-turn comments.
3. [CLEAN][demonstrated] src/lib/git.ts:23-53 (isZeroSha/resolveChangedFiles) + both instruments' main() -- GH#18 MED fix confirmed real: zero-SHA detected before git diff is ever attempted (proven via throwing-runner tests), lsTree fallback is a genuine -r recursive scan not a stub; re-ran both instruments live against the zero-SHA sentinel, neither silently VACUOUS-PASSes anymore.
4. [CLEAN][demonstrated] .github/workflows/ci.yml Action SHA pins -- independently verified all 3 SHAs against GitHub's live tag API, all match the claimed v4.x releases exactly.
5. [CLEAN][code-traced] src/qa/reference-resolver.ts:103-113 resolveWithinRepo -- correct containment check (handles exact-root and sibling-prefix edge cases), regression test confirms rejection without over-rejecting well-behaved paths.
6. [CLEAN][code-traced] docs/qa/recurring-findings-registry.md + src/qa/recurring-findings-registry.ts -- new row well-formed, "documentation-only, not a classifier" disclosure independently confirmed accurate by reading the full validator source.
7. [CLEAN][demonstrated] Independent re-run: typecheck 0 errors / lint 0 findings / test 89 pass, 0 fail, 0 skipped -- matches commit message exactly.
8. [CLEAN][code-traced] Whole 35-ADR catalog re-checked against this diff's 13 files -- no new territory beyond what the prior pass already cleared; no collision in a lane outside app-security's/mine.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=7
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=6 code-traced=2 derived=0
checks=typecheck: 0 errors; lint: 0 findings; test: 89 pass/0 fail/0 skipped/0 cancelled (9962ms); demonstrated QA-02/QA-14 zero-SHA no-longer-vacuous-pass via direct CLI re-run; demonstrated QA-02 fallback semantic-drift via direct function call; demonstrated 3 CI Action SHAs match GitHub's live tag API
adr=HIT(35, whole catalog)
report=docs/reviews/s1-protect-the-baseline-cross-domain-reconfirm-2026-08-30.md
