# S4 — Shell-command semantic detector: cross-domain review

**Target:** `story-implementer` build for S4 (Milestone #22, CRITICAL tier, "historically highest-incident component"), agent `a40050257abcfbbcc`, built on shipped S3 (`247e5fb`). Working-tree diff (uncommitted at review time): `src/policy/normalizer/{shell,shell-scanner,flag-catalog,wrapper-catalog}.ts` (+ 4 test files), `src/policy/fixtures/normalizer-calls.ts`, `src/qa/shell-detector-mutants.ts`, `src/qa/mutation-harness.ts` (disclosure-text only), `src/qa/completeness-claim-checker.ts` (+1 allowlist entry), `package.json`, `.github/workflows/ci.yml`, `CHANGELOG.md`, `docs/backlog.md`, `docs/decisions.md`.

**Role:** cross-domain-reviewer (Ra) - standing seam-check per PRINCIPLES.md rule 9, running alongside red-team, app-security-reviewer, and architecture-reviewer (all in parallel; none of their reports existed yet at review time - checked docs/reviews/ directly, only the pre-build design-challenger round-1 report is present). Reads the WHOLE ADR catalog, unfiltered, and checks the diff against every ADR outside those three lanes' domains, plus hunts non-ADR seam/coverage gaps.

## Ground the other lanes cover (so I don't re-tread it)

Per CLAUDE.md's reviewer taxonomy: app-security-reviewer = authz/injection/deps (ADR tags: security); architecture-reviewer = design (ADR tags: architecture); red-team = adversarial attack on the shipped mechanism. Between them that covers ADR-0021 (architecture/security/code/data - the only ADR the design-challenger round-1 report itself named as applicable), SE ADR-0002 (layering), SE ADR-0003 (SOLID), SE ADR-0006 (blast radius), and the security-shaped attack surface design-challenger's round 1 already exercised (command substitution, directory flags, chain-operator blanket-deny, wrapper completeness, quote re-stripping, depth cap - see that report, docs/reviews/s4-shell-semantic-detector-design-challenger-2026-09-02.md).

## ADR cache

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) - pulled fresh via node docs/adr-cache.mjs --ensure this session, not trusted from the dispatch description. Read whole, unfiltered (all 35 entries, including the two directory README placeholders and the two template stubs, which carry no rules).

## Cross-domain ADR verdict, per applicable ADR outside the three lanes above

All 12 adr/devops/* ADRs: N/A - this diff touches zero infrastructure/IaC/CDK/pipeline/tagging/cost surface. No collision, nothing to check further.

| ADR | Tags | In red-team/app-security/architecture's lane? | Verdict against this diff |
|---|---|---|---|
| SE-0001 (record architecture decisions) | process | no (process, not any of the three) | Clean - no new architectural decision made outside an ADR; the two design-challenger-mandated additions were ruled in docs/decisions.md, not silently decided. |
| SE-0004 (idempotency by default) | architecture, reliability | architecture-reviewer's tag, but reliability isn't - checked anyway | Clean/N/A - normalizeShellCall is a pure function with no side effects to be non-idempotent about; nothing here creates resources, moves money/inventory, or needs an idempotency key. |
| SE-0005 (testing strategy) | testing, quality | outside all three lanes | Clean - unit tests cover happy path, error paths (every unresolved branch), and boundaries (depth-cap exact vs. exceeded); no waitForTimeout; each fixture is a self-contained constant, no shared mutable test state. Verified: npm test 336/336 pass, 0 fail, 0 skipped (raw output below). |
| SE-0007 (resource tagging) | cloud, cost, operations | N/A, no billable resource created | N/A |
| SE-0008 (cost tracking) | cloud, cost, finops | N/A | N/A |
| SE-0009 (monitoring/observability) | operations, reliability | outside all three lanes, but conditionally N/A | N/A now - S4 creates no new service/endpoint and has no live wiring yet (confirmed: no hooks/ dir, no CI job feeds real commands through this normalizer - same finding design-challenger's round 1 already made under "Reach"). This ADR's ownership resurfaces at S5 (hook wiring), not S4. |
| SE-0010 (code quality and maintainability gates) | quality, process | outside all three lanes - nobody's job here | VIOLATION - see Finding 1 below. |
| SE-0011-0015 (data/DB) | data | N/A, no DB/schema touched (pure in-memory) | N/A |
| SE-0016/0019/0020 (porting/self-protection) | architecture, integration, security | architecture+security tags, and explicitly ruled non-binding for this build (2026-08-29 decision row, re-confirmed by design-challenger round 1) | N/A, correctly not a port |
| SE-0021 (thoth-native architecture) | architecture, security, code, data | covered by architecture-reviewer's/app-security-reviewer's own lane | Not re-attacked here (see Finding 2, a confirmatory check only, not new ground). |

## Finding 1 - SE ADR-0010 violation: a required CI gate is red against this diff (QA-15, completeness-claim-checker.ts)

**ADR rule violated (SE ADR-0010, "Code quality and maintainability gates," tags quality/process - outside all three lanes running alongside me):** "MUST run the full local equivalent of CI gates before declaring work complete; failing gates = unfinished work." Also: "MUST leave touched code at least as clean as found."

**Evidence (demonstrated - ran the exact CI step, .github/workflows/ci.yml lines 95-96, "QA-15 completeness-claim-checker", a required, non-continue-on-error step per that file's own header comment: "Any failing step fails the job... there is no permanently-pending state"):**

```
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] FAIL: 2 of 3 file(s) had a failing completeness claim.
  - docs/STATE.md: 2 of 2 numeric completeness claim(s) failed. [pre-existing, see below]
  - docs/decisions.md: 1 of 1 numeric completeness claim(s) failed.
      NO INSTRUMENT REFERENCE: text includes "checked directly against all 17 open milestones descriptions via gh api" (line 27) - carries no [[completeness: ...]] marker
$ echo $?
1
```

docs/decisions.md's 2026-09-02 "S4 intake NEEDS-INFO" row - added as part of this same build's decision trail - contains a bare numeric completeness claim ("checked directly against all 17 open milestones' descriptions") with no [[completeness: cmd="..." expect=N]] marker. completeness-claim-checker.ts's own BARE_CLAIM_PHRASES heuristic (the "all N" pattern) catches it, and per this project's own hard rule (CLAUDE.md, "No hand-derived completeness claims") and QA-15's own acceptance text, a bare claim like this must either cite a re-runnable instrument or be rephrased to not read as a machine-checkable completeness claim - exactly the fix this project already applied once before (see below).

**This is not the pre-existing docs/STATE.md failure.** I isolated the two: running the checker against a clean pre-S4 baseline (git stash, re-run, git stash pop) shows docs/STATE.md alone already failing (1 of 3 files) on master before any of S4's changes - a real, standing defect from S3-era prose (docs/STATE.md lines 12/15, "all 11 findings", "2 of 2"), not caused by S4 and not this diff's problem to fix. **docs/decisions.md is the new failure S4's own diff introduces** - before this diff, decisions.md passed cleanly; after it, it doesn't. CHANGELOG.md's own new marker (qa-mutation-shell expect=28) is correct and passes (confirmed once I undid an unrelated CRLF/LF working-tree artifact from my own git stash round-trip - see note below; not a real defect in the diff).

**Direct precedent already in this project's own history for the fix:** docs/STATE.md's S2-era section (line 31 in the current file) records exactly this situation happening once before - "Pre-existing, out-of-scope QA-15 gap noticed during this build... Fixed as a same-session housekeeping edit while this file was already being touched (rephrased, not marker-fabricated - no instrument tracks 'reports read in full')." The same fix pattern applies here: rephrase the decisions.md row's "checked directly against all 17 open milestones" clause so it doesn't read as a machine-checkable numeric completeness claim (there is no re-runnable instrument for a one-time gh api check performed during intake) - do not fabricate a completeness marker for something no instrument tracks.

**Why this fell in the seam:** none of app-security-reviewer (authz/injection/deps), architecture-reviewer (design), or red-team (adversarial attack on the shipped mechanism) would run this specific CI script as part of their own lane - SE ADR-0010's tags are quality/process, not security or architecture, so it falls outside all three ADR-tag filters those reviewers apply to the catalog. It is also not something story-implementer's own tests catch (npm test is 336/336 green; QA-15 is a separate, prose-scanning instrument). This is exactly the seam cross-domain-reviewer exists to catch.

**Severity/exposure:** HIGH. Exposure: ~100% of CI runs against this diff (measured - the gate is a required, non-skippable step; every push/PR run of this exact diff fails at this step). Basis: measured, not assumed. Not capped by PRINCIPLES rule 21 (that cap only applies below 3% exposure; this is ~100%).

**Minimal fix:** rephrase the one clause in docs/decisions.md's 2026-09-02 S4-intake row (the text "checked directly against all 17 open milestones' descriptions via gh api") to avoid the bare-numeric-claim heuristic - e.g. "checked directly against the open-milestones list via gh api (no later milestone claims this scope)" - matching the project's own established rephrase-not-fabricate convention. Re-run the completeness checker scoped to that file to confirm exit 0. docs/STATE.md's separate, pre-existing failure is out of this diff's scope (not touched by S4) but worth noting to the Manager: CI will not go fully green on master until that row is also fixed, independent of S4.

**Named failing check (rule 19 - this finding's own executable form):** node src/qa/completeness-claim-checker.ts docs/decisions.md, currently exit 1 / FAIL: 1 of 1 file(s); must be exit 0 before merge.

## Finding 2 - confirmatory recheck of ADR-0021's kernel-purity/registry-declaration rules against S4's new files (not a new ground claim, a verification)

Checked directly (not relying on architecture-reviewer's forthcoming report, since a violation in a non-owning lane produces no finding there if I don't check the code myself):
- src/policy/normalizer/{shell-scanner,flag-catalog,wrapper-catalog}.ts are pure string-manipulation modules - no fs/network/process/timer imports, confirmed by reading all three files in full and by "node src/qa/kernel-purity-check.ts" -> PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations (they aren't even under the kernel boundary, but the point stands: nothing here reaches for I/O).
- Zero diff to src/policy/kernel/kernel.ts or src/policy/normalizer/registry.ts (confirmed via git status/git diff --stat) - shell.ts still self-registers via registerNormalizer() at its own file's bottom, unchanged mechanism from S3. "node src/qa/normalizer-registry-purity-check.ts" -> PASS.
- kernel.ts's isMutating() still does not special-case action.deferred (SUR-09's "evaluated as execution, not a lesser class" - unread, unchanged, still correct by construction for the recursively-resolved records S4 now produces).

**Verdict: SURVIVES/Clean.** No new ADR-0021 violation found in the seam between S4's new modules and the unchanged kernel/registry.

## Seam-hunting (non-ADR)

**Seam 1 - S4's recursive wrapper resolution vs. S2's kernel isMutating/POL-05.** A "bash -c <clean inner call>" composes: the recursive normalizeShellCall call resolves the inner text into a normal verbs/targets record, then deferred:true is forced on the way out (shell.ts, resolveWrapperMatch). Because isMutating() never reads deferred, a resolved-and-clean inner mutating call still gets evaluated on its own merits (not silently downgraded because it arrived via a wrapper) - checked directly against kernel.ts's unchanged source, and pinned by registry.test.ts's new SUR-06/09 end-to-end tests plus shell.test.ts's wrapper tests. **Clean**, no gap.

**Seam 2 - S4's syntax-level fail-closed scan (collectSyntaxUnresolved, computed on the FULL raw command before wrapper detection) vs. S4's own wrapper/inner-extraction logic.** A concern (design-challenger's Finding #5) was whether eval's extractInner would pass an unstripped, still-quoted inner string to the recursive call, letting a live semicolon hide inside quotes at the recursive level. Traced directly: tokenize() (used by detectWrapper) already strips quote delimiters from token content per its own documented contract ("the enclosing quote DELIMITER characters are stripped from the token's value"), so wrapper.inner is already unquoted by the time it's re-fed into normalizeShellCall. Confirmed by the shipped test wrapper-catalog.test.ts: eval "true ; rm -rf /tmp/x" produces inner: "true ; rm -rf /tmp/x" (quotes already gone), and by the mutation gate having no surviving mutant on this path. **Clean**, Finding #5 is resolved in the shipped code, not left open.

**Seam 3 - the two design-challenger-mandated BREAKS (Finding #1 command/process substitution, Finding #2 directory flags) as day-1 failing tests, per the design-challenger's own "routes to (a)" ruling.** Confirmed both are now real, passing, named tests (shell-scanner.test.ts's "Finding #1" block; shell.test.ts's "Finding #1"/"Finding #2" blocks) and both are covered by named mutants in shell-detector-mutants.ts (substitution-markers-table-emptied, substitution-single-quote-inertness-broken, directory-flag-long-form-disabled, directory-flag-short-form-disabled) - all KILLED (28 of 28 mutant(s) KILLED, raw output below). **Clean**, the ratified fix is actually shipped, not just claimed.

## Coverage gaps named

- **QA-06 mutation gate scope.** shell-detector-mutants.ts scopes its shadow copy to src/policy/** only (documented rationale: "self-contained, no imports outside itself"). Confirmed true today (checked every new file's imports - all relative, all within src/policy/). Not a gap now; would become one if a future story made any of these files import from src/lib/ or src/qa/ without widening the shadow-copy scope to match. Not a finding - the file's own header already documents the assumption, so a future violation would be visible, not silent.
- **.github/workflows/ci.yml is a CLAUDE.md "sensitive area"** ("Secret scanning / CI gates" list names this exact file) - this diff adds one new step to it. Not itself a gap: the sensitive-area rule requires "a fresh dated review report" before shipping, and this CRITICAL-tier ceremony (red-team + app-security-reviewer + architecture-reviewer + this report) satisfies that once all four land. Named here only so it isn't silently assumed covered by any one lane.
- **No file type or module in this diff is left completely unclaimed.** Code (.ts production + .test.ts) is app-security-reviewer's/architecture-reviewer's/red-team's to attack on their own axes; the CI/QA-gate surface (.github/workflows/ci.yml, package.json scripts, src/qa/*) is this report's Finding 1 lane; CHANGELOG.md/docs/backlog.md prose is editorial (checked, accurate - see below). Nothing observed with no owner.

## Editorial

- docs/backlog.md's four new S4-round-1 entries (chain-deny tradeoff, wrapper completeness, depth cap, directory-flag scope) accurately restate design-challenger's own residual-risk register - cross-checked line by line, no drift.
- CHANGELOG.md's S4 entry and its qa-mutation-shell expect=28 completeness marker are accurate (28 mutants, all present in MUTANTS, all KILLED) once the CRLF/LF working-tree artifact noted below is not present.

**Note on my own tooling, disclosed per this project's own evidence discipline:** mid-review I ran git stash / git stash pop to diff against a pre-S4 baseline; on this Windows checkout (core.autocrlf=true, no .gitattributes) that round-trip flipped several working-tree files (including shell.ts) from LF to CRLF, which broke several of shell-detector-mutants.ts's multi-line textual anchors (they embed a literal newline inside the anchor string) and produced a misleading crash/false failure on qa:mutation-shell and a false CHANGELOG.md QA-15 mismatch. I traced this to my own action (not the diff), renormalized the affected files back to LF (a byte-only change - git diff computed identically before and after, confirming no logical content changed), and re-ran every check in the clean state before reporting. Not filed as a finding against the diff - noted here so the Manager doesn't need to re-derive it, and as an observation that this repo has no .gitattributes line-ending policy, which is a latent (not demonstrated against the real committed state, since core.autocrlf=true normalizes to LF on git add/commit regardless of working-tree state) fragility in any future textMutant anchor that embeds a literal newline. Not a finding (derived, no demonstrated breakage of the actual committed/committable state) - flagged for awareness only, not gating.

## Verification run (this session, clean state)

```
$ npm test 2>&1 | tail -6
tests 336
suites 0
pass 336
fail 0
cancelled 0
skipped 0

$ npm run typecheck   # clean, zero output

$ npm run lint         # clean, zero output

$ node src/qa/shell-detector-mutants.ts
[QA-06 shell-detector-mutants] PASS: 28 of 28 mutant(s) KILLED.

$ node src/qa/kernel-purity-check.ts
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.

$ node src/qa/normalizer-registry-purity-check.ts
[QA normalizer-registry-purity-check] PASS: src/policy/normalizer/registry.ts: zero dispatch-chain/sibling-normalizer-import violations.

$ node src/qa/fixture-coverage-check.ts   # VACUOUS-PASS (0 rules yet, disclosed)
$ node src/qa/fixture-isolation-check.ts  # VACUOUS-PASS (0 live roots yet, disclosed)
$ node src/qa/recurring-findings-registry.ts
[QA-13 recurring-findings-registry] PASS: 1 recurring finding class(es) logged, all structurally valid.
$ node src/qa/broken-instrument-gate.ts   # VACUOUS-PASS (0 known-broken instruments, disclosed)

$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] FAIL: 2 of 3 file(s) had a failing completeness claim.   (see Finding 1)
```

## Verdict

**REWORK** - one blocking finding (SE ADR-0010 violation, Finding 1), minimal fix is a one-clause rephrase in docs/decisions.md's own 2026-09-02 S4-intake row. Everything else checked (ADR sweep outside the three lanes, the two named seams, the two design-challenger-mandated proof-tests, coverage gaps) is clean. This is not a design or security defect - the shipped detector code itself is sound, fully tested (336/336), and mutation-proven (28/28 killed) - it is a process/quality-gate miss (SE ADR-0010's own "failing gates = unfinished work") that must close before this story is "unfinished work" no longer.

**Single next action:** story-implementer rephrases the flagged clause in docs/decisions.md's 2026-09-02 "S4 intake NEEDS-INFO" row (drop the bare "all 17" phrasing) and re-runs the completeness checker scoped to that file to confirm exit 0, before this story proceeds to Stage 4 (verify).

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] docs/decisions.md's 2026-09-02 S4-intake row ("all 17 open milestones") fails QA-15 (src/qa/completeness-claim-checker.ts, SE ADR-0010 "failing gates = unfinished work") - required CI step exits 1; rephrase the clause per this project's own S2-era precedent (STATE.md line 31), never fabricate a marker.
2. [CLEAN][code-traced] ADR-0021 kernel-purity/registry-declaration rules hold against S4's 3 new normalizer modules - zero diff to kernel.ts/registry.ts, all new files pure (no fs/network/process import), confirmed via kernel-purity-check.ts + normalizer-registry-purity-check.ts both PASS.
3. [CLEAN][code-traced] Seam: recursive wrapper resolution (deferred:true) composes correctly with kernel.ts's unchanged isMutating() (never reads deferred) - SUR-09 "evaluated as execution" holds for S4's new recursion.
4. [CLEAN][demonstrated] Seam: design-challenger Finding #5 (eval/bash -c inner-quote re-stripping before recursion) is resolved in shipped code - tokenize() already strips quotes before wrapper.inner is built; named test + 0 surviving mutants confirm.
5. [CLEAN][demonstrated] Both design-challenger-mandated BREAKS (Finding #1 command/process substitution, Finding #2 directory flags) are shipped as real, passing, mutation-covered tests, not left as claims.
6. [CLEAN][code-traced] SE ADR-0004/0005/0007/0008/0009/0011-0015/0016/0019/0020 checked against this diff - all N/A or satisfied, no collision.
7. [SUSPICION][LOW][derived] shell-detector-mutants.ts's multi-line textual anchors (embedded literal newline) are fragile to CRLF working-tree normalization on Windows checkouts (no .gitattributes in this repo) - not demonstrated against the real committed/committable state (core.autocrlf=true normalizes to LF on git add regardless), self-inflicted during this review's own diagnostic git stash, not a defect in the diff as delivered. Flagged for awareness, not gating.
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=1 suspicions=1 clean=5
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=4 code-traced=3 derived=1
checks=336 pass/0 fail/0 skipped (npm test); typecheck clean; lint clean; QA-06 shell-detector-mutants 28/28 killed; kernel-purity PASS; normalizer-registry-purity PASS; QA-13 PASS; QA-15 FAIL (exit 1, Finding 1); QA-01/QA-05/QA-16 vacuous-pass (disclosed, no real content yet)
adr=HIT(35, whole catalog)
report=docs/reviews/s4-shell-semantic-detector-cross-domain-2026-09-02.md

---

## Addendum (same session, after red-team/app-security-reviewer/architecture-reviewer reports landed)

Per PRINCIPLES.md rule 11 (reports are immutable; verification is appended) - not an edit to the findings above, a correction plus cross-validation now that the parallel lane reports exist.

**Correction to my own Finding 7 (the CRLF/mutation-anchor SUSPICION I tagged LOW and "not gating").** `red-team`'s independently-filed Finding 6 (`docs/reviews/s4-shell-semantic-detector-red-team-2026-09-02.md`, filed as GitHub Issue #75) proves this is a real, demonstrated defect, not an artifact of my own `git stash` diagnostic as I concluded. Their own byte-level line-ending count shows the actual mechanism: `shell.ts` is a previously-**tracked** file (existed pre-S4, modified by this diff) so `core.autocrlf=true` normalizes it to CRLF on any ordinary git operation (checkout/stash/pull/merge) on this Windows-configured repo with no `.gitattributes`; the three brand-new files (`shell-scanner.ts`, `flag-catalog.ts`, `wrapper-catalog.ts`) are untracked and never pass through that git normalization path, so they stay LF. That split is exactly what broke `shell-detector-mutants.ts`'s multi-line anchors when I triggered a git operation on `shell.ts` (my `git stash`/`git stash pop`) - the trigger was mine, but the underlying fragility is real, reproducible by any ordinary git operation on this exact repo, and not limited to my own diagnostic session. I withdraw my "not a defect in the diff... flagged for awareness only, not gating" characterization of Finding 7 above. Already filed as GitHub Issue #75 by `red-team`, tagged `[ISSUE][MED][demonstrated]` there - not re-filed here (would duplicate).

**Cross-validation, not redundancy, on Finding 1.** `red-team`'s own Finding 8 (`[SUSPICION][MED][demonstrated]`, routed to the Manager, not filed as an Issue) independently reaches the same underlying fact I did - QA-15 is red against this diff and partly pre-existing - from its own separate evidence run. Two differences kept my Finding 1 as its own filed Issue rather than a duplicate: (1) `red-team`'s report attributes `docs/decisions.md`'s failing row to "S3 rows" (plural); I isolated it precisely to the single new 2026-09-02 S4-intake row via a clean pre-S4-diff baseline comparison (`git stash` to bare `247e5fb`, re-run, confirmed `decisions.md` passes clean at that baseline) - a sharper, name-the-exact-row result. (2) `red-team` tagged its version `SUSPICION` (by their own convention, `[SUSPICION]` findings never spawn an Issue) and explicitly routed it to the Manager as `UNPROVEN as to whether master's CI is actually red`; I tagged mine `ISSUE`/`HIGH`/`demonstrated` because I ran the exact CI-equivalent command myself and captured its exit code directly - no `UNPROVEN` half remains once the local run is the evidence, rather than an inference about the live GitHub Actions state. Filed as GitHub Issue #79.
