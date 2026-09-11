# Cross-domain review placeholder

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-10
**Scope:** `fix/qa1415-issue-existence-and-decisions-scope` vs `master` (commit `d05ca33`), CRITICAL tier (`.github/workflows/ci.yml` is a CLAUDE.md-named sensitive area, ratified consistent with `cifix`'s own ruling on this file).
**Seated alongside:** `red-team` (adversarial) + `infra-security-reviewer` (token scoping/injection on `ci.yml`), per `docs/.maat-state.json`'s `note_2026-09-10`. Neither report existed in `docs/reviews/` at the time of this pass.

ADR cache: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fingerprint 83b2e3e, CACHE=HIT. Read the WHOLE catalog (both roots), unfiltered, per PRINCIPLES rule 9 and this role's own standing instruction, not a domain slice.

## What the other seated lanes cover (not re-covered here)

- `infra-security-reviewer`: token scoping/injection on `.github/workflows/ci.yml`'s new `permissions: { issues: read }` grant and `GH_TOKEN` wiring, devops ADR-0008/ADR-0009's security rules on that file are their lane.
- `red-team`: adversarial/failure-scenario attack on `checkIssueViaGh`'s fail-closed branches, `gh` output spoofing, etc.
- My job starts where those stop: the whole ADR catalog (not a slice), the seams between the two-pass design's pieces, test-coverage adequacy the domain lanes would not think to check, and documentation/disclosure honesty across CHANGELOG.md, docs/decisions.md, and the GitHub Issues this story touches.

## Cross-domain ADR verdict (full 35-ADR catalog)

Checked the diff's changed files (`src/qa/reference-resolver.ts`/`.test.ts`, `src/qa/completeness-claim-checker.ts`, `.github/workflows/ci.yml`) against every ADR outside infra-security-reviewer's own lane (their slice: devops ADRs tagged security/iam/secrets/pipeline, plus the SE ADRs devops ADR-0001 cross-references: SE-0004 idempotency, SE-0006 blast radius, SE-0007 tagging, SE-0008 cost, SE-0009 observability). That leaves SE ADR-0002 (layering), ADR-0003 (SOLID/DI), ADR-0005 (testing strategy), ADR-0010 (code quality gates), ADR-0011 through 0015 (data), ADR-0016 through 0021 (governance-plugin porting / thoth-native architecture) as my remit.

- SE ADR-0002 (multi-layer architecture): CLEAN. `scanReferences`/`classifyIssue`/`verifyLocalIssue` stay synchronous and pure (unchanged); the new `checkIssueViaGh(n, repoSlug, runner)` lives one layer up at `main()`'s existing async I/O boundary, `Runner` injected rather than a bare child_process call.
- SE ADR-0003 (SOLID): CLEAN. I/O dependency (Runner) injected via parameter, not instantiated inside business logic.
- SE ADR-0005 (testing strategy): CLEAN on no-test-deleted-or-weakened, verified independently below. All 19 pre-existing reference-resolver.test.ts cases present, unmodified. 6 new tests added.
- SE ADR-0010 (code quality gates): CLEAN. No new third-party dependency (the gh CLI is an existing CI-image tool, already relied on by cifix's own ADR_REPO_PAT wiring). No suppressed lint/test/coverage rule.
- SE ADR-0011 through 0015 (data): N/A, no data-layer file touched.
- SE ADR-0016 through 0021 (governance-plugin porting / thoth-native architecture): N/A, no file under the kernel/policy/hooks/bin boundary touched.
- SE ADR-0006 (blast radius), read for completeness even though it is nominally infra-security's cross-referenced set: `checkIssueViaGh`'s gh call sets an explicit 30s timeout, compliant with the explicit-timeouts half. The bounded-retries-with-backoff-and-jitter half is absent, a single transient gh/network blip fails closed to null (cannot verify), which fails the whole QA-14 gate loudly rather than silently passing. Checked whether this is a new gap: grep -rn for retry, backoff, jitter across src/qa/*.ts and src/lib/*.ts returns zero matches anywhere in this codebase, no QA instrument or src/lib runner has ever implemented retry logic across S1 through S6 and cifix, all already reviewed and shipped. Pre-existing, repo-wide, already-accepted convention this diff does not worsen, not re-raised as a new finding.

No cross-domain ADR collision found.

## Seam findings

### 1. [ISSUE][MED] docs/decisions.md:55 falsely claims QA-14 exits 0 at HEAD, contradicts this same diff's own CHANGELOG.md disclosure

Evidence (demonstrated): docs/decisions.md's new 2026-09-10 "qa1415fix build complete" row ends: "node src/qa/reference-resolver.ts and node src/qa/completeness-claim-checker.ts both exit 0 at HEAD." This is false for the first instrument. Independently re-run on the branch (d05ca33, clean working tree):

  command: npm run qa:reference-resolver -- HEAD~1 HEAD
  output:  [QA-14 reference-resolver] FAIL: 27 of 481 citation(s) failed to resolve.
  real exit code: 1

QA-15 alone does exit 0 (npm run qa:completeness-claims -> PASS: 2 file(s) checked, matches the CHANGELOG's claim for that instrument). It is specifically the reference-resolver half of the sentence that is wrong.

Why this matters, the seam: this story's entire premise (Issue #120's own framing, restated in the task brief) is that QA-14 will still fail in CI after this merges, for Issue #137's separate, legitimate reason, and that this must not be overclaimed as "CI fixed." CHANGELOG.md's own entry in the same diff gets this exactly right ("node src/qa/reference-resolver.ts does NOT exit 0 at HEAD, this PR's own CI run will still show QA-14 red, for Issue #137's reason"), and the GitHub Issue #120 closing comment (posted same session) also gets it right. Only docs/decisions.md's own row, the project's permanent, append-only decision record, contradicts both of its own siblings. This is exactly the "does the story practice what it preaches" seam the task asked me to check, and it does not, in one specific row.

Blast radius: Exposure ~1 doc row out of the 2 new rows this diff adds to docs/decisions.md; the sibling CHANGELOG.md entry and the GitHub Issue #120 comment (both same session, same facts) are correct, so a reader who checks either of those two is not misled, only a reader who trusts docs/decisions.md in isolation would be. Basis: measured (ran the actual command; also grepped for the exact false sentence, one occurrence). Category: documentation-integrity, not security/data-integrity/legal/safety, capped at MED under PRINCIPLES rule 21 regardless of how the sentence reads.

Minimal fix: correct docs/decisions.md:55's closing clause to match CHANGELOG.md's own accurate wording (e.g. "node src/qa/completeness-claim-checker.ts exits 0 at HEAD; node src/qa/reference-resolver.ts does not, Issue #137, disclosed, out of scope"). This row was added in this same, not-yet-merged diff, so a direct correction is appropriate, not a supersession under the "strike through plus append SUPERSEDED" convention, which is for reversing an already-active or archived decision.

Filed as GitHub Issue #138 (bug, severity:med, qa), body is a one-line summary plus link to this report, no duplicate found (gh issue list --search checked first).

### 2. [ISSUE][LOW] GitHub Issue #137 filed with chore instead of the applicable qa Feature-ID label

Evidence (demonstrated): gh issue view 137 showed labels bug, severity:med, chore. This repo has a qa label ("Requirement group QA") that is the exact, already-used precedent for this class of finding: Issue #120 (this same story's own parent issue) and Issue #134 (cifix's directly analogous "the diff documents a QA-15 miscount" finding) both carry qa. Per CLAUDE.md's Issue Discipline, the Feature ID label applies "if one applies, else the chore catch-all," one applies here.

Blast radius: Exposure 1 Issue's label metadata; a qa-scoped triage query would silently miss #137. Basis: measured (direct label comparison against the exact precedent issues in this repo). LOW, cosmetic/metadata only, no substance change, no re-review needed. Not filed as a separate Issue (LOW findings do not spawn one); fixed directly instead, since labels are mutable metadata, not the immutable body: gh issue edit 137 --add-label qa --remove-label chore, plus a same-turn cross-domain-reviewer-prefixed comment on #137 explaining the change.

### 3. [SUSPICION][LOW] The two-pass batching/dedup property itself has zero test coverage

Evidence (code-traced): checkIssueViaGh (the unit) is well covered, 6 new tests hit null-repoSlug, success, not-found, auth-failure, timeout, and unparseable-JSON. But the actual architectural claim this story's comments and CHANGELOG make, that each cited number is looked up once and not once per citation occurrence, lives entirely in main()'s wiring (queriedIssueNumbers Set feeding one checkIssueViaGh call per distinct number, then an issueCache Map consulted in pass 2), and main() is not exported or unit-tested (it reads process.argv/process.cwd() and calls realRunner directly). A regression here (e.g. a future refactor that calls checkIssueViaGh once per citation instead of once per distinct number) would not turn any existing test red, the full suite would stay green while quietly multiplying gh calls.

Why this is only a SUSPICION, not a confirmed defect: the failure mode this gap permits is a latency/rate-limit regression, not a correctness regression, every call for the same number returns the same verdict, so results would be identical either way. Not blocking. Named here because the task explicitly asked whether the 6 new tests exercise the real branches or miss an edge case neither domain lane would check, this is that edge case, real but low-materiality. Recommend a one-line backlog entry (not a GitHub Issue, LOW, no code defect today) if this instrument is touched again: an integration-level test asserting gh-call count via a counting fake Runner across a 2-citation-same-number fixture.

## Editorial (non-blocking, verdict-neutral)

- CHANGELOG.md's "17/17 pre-existing test in that file passes unmodified" is a miscount. Verified: master's reference-resolver.test.ts has 19 top-level test() cases (git show master:src/qa/reference-resolver.test.ts, counted); the branch's file runs 25 total (node --test); 25 minus 6 new equals 19 unchanged, not 17. Matches the Evidence Policy's own named example of a non-blocking prose defect ("a N call sites claim that is actually N+3"). Fix as a plain edit, no re-review needed.

## Coverage gaps named

- No code-reviewer or architecture-reviewer is seated for this CRITICAL-tier scope (only red-team, infra-security-reviewer, and cross-domain-reviewer per docs/.maat-state.json). General TS code-quality/architecture-layering correctness of reference-resolver.ts/completeness-claim-checker.ts therefore fell to no domain lane by default, I checked it myself (see the ADR-0002/0003/0005/0010 verdicts above): clean. Not a gap that needs filling beyond what is already in this report.
- Performance/latency of the new sequential per-distinct-number gh call loop in CI is not covered by any seated lane (gate-latency-budget-check.ts covers a different, session-scoped gate, not this CI job's own runtime). Intentionally low-risk today (same-repo issue citations are rare in a typical diff; worst case bounded by the 30s-per-call timeout), named, not filed.

## Confirmation of the explicitly out-of-scope item (not re-raised as a finding)

Issue #137 (the citation-classification precision gap the real gh lookup exposed) is filed, correctly substantively scoped, not a duplicate (gh issue list --search checked), and Issue #120 was commented on (not edited) with the closing disclosure, all independently re-verified this session (gh issue view calls), plus its own measured numbers (246/2222 full-tree, breakdown 198/40/8) cross-checked against a fresh, independent full-tree run of mine: 246/2222 (categories identical: 198/40/8). Issue #137's own "2221" total is off by one from my independent re-measurement, immaterial (a report likely landed between measurements), not re-raised. The one substantive gap in #137's own filing (label) is finding 2 above, already fixed directly.

## Verification run this session

Command: npm test
Result: tests 670, pass 670, fail 0, skipped 0 (matches CHANGELOG.md's claimed 670/670)

Command: npm run qa:completeness-claims
Result: PASS: 2 file(s) checked, all completeness claims verified. Exit code 0.

Command: npm run qa:reference-resolver -- HEAD~1 HEAD
Result: FAIL: 27 of 481 citation(s) failed to resolve. Real exit code 1.

Command: npm run qa:reference-resolver -- 0000000000000000000000000000000000000000 HEAD
Result: FAIL: 246 of 2222 citation(s) failed to resolve. unresolved-authority 198, unparseable 40, cross-repo-issue 8. Real exit code 1.

## Verdict

APPROVE-WITH-CONDITIONS. No ADR collision. No security/data-integrity/architectural blocker. Two conditions before merge:
1. Correct docs/decisions.md:55's false "both exit 0" clause (Issue #138, MED).
2. (Done this session) Issue #137's label corrected to qa.
Both are the same order of magnitude as a one-line prose fix, no rebuild, no new review round required once condition 1 is corrected.

## Next action

story-implementer (or the Manager) corrects docs/decisions.md:55's closing clause to match CHANGELOG.md's own accurate disclosure, then this scope is ready for Stage 4 (verify).

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius, status [ISSUE]/[SUSPICION]/[CLEAN], severity on ISSUE/SUSPICION, evidence tag per PRINCIPLES rule 19):
1. [ISSUE][MED][demonstrated] docs/decisions.md:55 falsely claims node src/qa/reference-resolver.ts exits 0 at HEAD (real exit=1, FAIL 27/481), contradicts this diff's own CHANGELOG.md/Issue #120 disclosure; fix: correct the row's wording pre-merge. Filed Issue #138.
2. [ISSUE][LOW][demonstrated] Issue #137 filed with chore instead of the applicable, precedented qa Feature-ID label, fixed directly (label swapped, comment posted), no new Issue (LOW).
3. [SUSPICION][LOW][code-traced] The two-pass batching/dedup property (1 gh call per distinct issue number) has zero test coverage, only checkIssueViaGh unit-tested, main()'s wiring is not; a regression here would be a latency/rate-limit risk, not a correctness break. Non-blocking, backlog note only.
4. [CLEAN][code-traced] Two-pass main() design: layering-clean (SE ADR-0002/0003), fail-closed consistently pass-1-to-pass-2, no unhandled-exception/inconsistent-state risk (realRunner never throws, JSON.parse guarded, 30s timeout bounded), no cross-repo/local issue-number collision (classifyIssue only calls issueExists for same-repo shapes), no secret/token leak in logged output (ADR-0009).
5. [CLEAN][code-traced] Full 35-ADR catalog scan outside infra-security-reviewer's lane (SE ADR-0002/0003/0005/0010/0011-15/0016-21), no violation in the diff's changed files.
6. [CLEAN][demonstrated] SE ADR-0005 no-test-deleted-or-weakened: all 19 pre-existing reference-resolver.test.ts cases present unmodified in the diff; 6 new added.
7. [CLEAN][code-traced] SE ADR-0006 no-retry-on-network-call gap checked project-wide (grep for retry/backoff/jitter across src/qa and src/lib = 0 matches anywhere), pre-existing, repo-wide, already-accepted convention, not worsened by this diff, not re-raised.
8. [CLEAN][demonstrated] Issue #137 substance/duplicate-check/#120-comment-not-edit discipline all correct except the label gap (finding 2); #137's own measured numbers independently re-confirmed (246/2222 full-tree, categories 198/40/8 identical, 1-off total immaterial).
counts (a CHECKSUM, MUST equal the lines listed above, never truncated): issues=2 suspicions=1 clean=5
evidence (a CHECKSUM over the tags above, MUST equal them, and MUST total the counts line): demonstrated=5 code-traced=3 derived=0
checks=npm test 670/670 pass 0 fail 0 skipped; npm run qa:completeness-claims exit=0 (PASS 2/2 files); npm run qa:reference-resolver -- HEAD~1 HEAD exit=1 (FAIL 27/481, real re-run not taken on CHANGELOG's word); npm run qa:reference-resolver -- 0-SHA HEAD exit=1 (FAIL 246/2222, cross-checks Issue #137's own claimed 246/2221)
adr=HIT(35, whole catalog)
report=docs/reviews/qa1415fix-cross-domain-2026-09-10.md
