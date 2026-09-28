# Cross-Domain Review — s339-registrant-drift-instrument (PR #350)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-28
**Scope:** GitHub PR #350, branch `feat/s339-registrant-drift-instrument`, tip `5710c88`, against `master` (origin tip `c2750a2`). Issue #339.
**Tier:** STANDARD, ratified (run-log `tier-ratified`, 2026-09-28T09:59:15.138Z: "test-only additive instrument, zero production edit, zero live exposure"). Sensitive area: "Policy delivery / config surface" (`src/policy/config/`) per CLAUDE.md, hence this report regardless of tier.

## Who else ran, and what ground they covered

`app-security-reviewer` (Horus) ran in parallel — `docs/reviews/s339-registrant-drift-instrument-app-security-2026-09-28.md` (found in worktree `agent-a5d6336ccad93363f`; not yet on this branch/worktree). Their verdict: APPROVE-WITH-CONDITIONS. They covered: ADR read (only 2 docs/adr ADRs -- their submodule was unpopulated, `adr/devops:0, adr/software-engineering:0`), the `git diff --stat` production-file-untouched claim, a direct re-run of the target test file (18/18), a real adversarial demonstration that `REGISTRANT_CALL` misses a `registerNormalizer(makeEntry())` factory-call shape (filed as Issue #351, MED), the file-identity residual (verified accurate), a `.mts`/`.cts` extension gap (LOW), the exact-path `registry.ts` exclusion (CLEAN), part 2 self-test non-vacuity (CLEAN), and injection/secrets/access-control exposure (CLEAN, none). That is a thorough security-lens pass over the one test file.

My job starts where theirs stops: the whole ADR catalog (they could only read 2 of 37 -- their submodule wasn't checked out), and the architecture/completeness lens -- including running the full local gate suite their scoped file-level run didn't reach.

## ADR verdict — whole catalog

`node docs/adr-cache.mjs --ensure` initially returned `[CACHE=HIT]` cataloging only the 2 `docs/adr/` THOTH ADRs (submodule not initialized in this worktree either, matching app-security's own gap). I ran `git submodule update --init` to populate `adr/devops` and `adr/software-engineering`, then re-ran the cache builder:

```
📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]
```

Read the whole 37-ADR catalog (not a lane slice). Checked against the diff's one touched production-tree file (`src/policy/config/rule-reachability.test.ts`, plus CHANGELOG.md/docs/STATE.md/docs/run-log.jsonl):

- **SE ADR-0021 (`applicableTo: architecture, security, code, data`) POL-12** -- the diff's own comments cite this ADR by name (a claim app-security could not verify directly, submodule unpopulated). Read `adr/software-engineering/0021-thoth-native-architecture.md` line 16 in full: "Per-tool-type normalizers MUST be registered on the normalizer registry by declaration; adding a tool type MUST NOT require editing a shared dispatch chain or the kernel itself (POL-12)." Cross-checked against `src/policy/normalizer/registry.ts` (unedited by this diff, confirmed by `git diff --name-status` below): the registry stays open/declaration-based, no dispatch chain exists to edit. This diff adds a test that reads the registrants' files, never a runtime dispatch mechanism -- it does not touch, narrow, or violate the registration mechanism POL-12 governs. **No violation.**
- **SE ADR-0005 (testing strategy)** -- "MUST write unit tests for every new/changed... behavior," "MUST NOT delete or weaken a failing test." This diff is purely additive (2 new tests, 0 edited/removed). No locked test touched. **Compliant.**
- **SE ADR-0010 (code quality)** -- "MUST NOT disable/skip/suppress lint... MUST leave touched code at least as clean as found." Grepped the new test code for `eslint-disable`, `@ts-ignore`, `.skip`, `.only`: zero hits. `npx eslint .` exit 0, `npx tsc --noEmit` exit 0 on the PR tip. **Compliant.**
- **SE ADR-0006 (blast radius)** -- "MUST NOT widen a change's scope opportunistically." Diff touches exactly the one test file plus the three standing bookkeeping files (CHANGELOG/STATE/run-log) for this story. No unrelated file touched. **Compliant.**
- **SE ADR-0016 (governance-plugin tree self-protection)** -- protected paths are `.claude-plugin/`, `fullstack/*`, `.governance.json`. None touched. **Not applicable.**
- **SE ADR-0018/0019/0020 (reference-port fidelity)** -- govern the ported `maat-legacy` files (`mutation-check.mjs`, `.ts→.mjs` translation, `guard.mjs`). None touched. **Not applicable.**
- **THOTH-ADR-0001/0002 (docs/adr/)** -- govern `docs/qa/s5-central-classification.json` and `docs/qa/secret-scan-allowlist.json` respectively. Neither file touched. **Not applicable.**
- **The 12 `adr/devops/` ADRs and the remainder of `adr/software-engineering/`** (idempotency, DB, backup, monitoring, cost, etc.) -- categorically inapplicable: this diff touches no infra, no database, no deployed service, no money/inventory operation. **Not applicable.**

**No ADR collision found anywhere in the catalog.**

## Constraint verification (independent)

```
$ git diff --name-status origin/master origin/feat/s339-registrant-drift-instrument
M	CHANGELOG.md
M	docs/STATE.md
M	docs/run-log.jsonl
M	src/policy/config/rule-reachability.test.ts
```
Confirmed: zero production files touched. `src/policy/normalizer/registry.ts` (the file the diff's own residual paragraph reasons about) read in full -- unedited, matches master.

```
$ node --test src/policy/config/rule-reachability.test.ts
tests 18
pass 18
fail 0
skipped 0
```
Matches both the PR's own claim and app-security's independent run.

**Independent grep-based cross-check of the "exactly 3 registrants" claim** (not trusting the instrument's own self-report alone):
```
$ grep -rn "registerNormalizer" src/ --include="*.ts" --include="*.js" --include="*.mjs" | grep -v "\.test\."
src/policy/normalizer/registry.ts:38:export function registerNormalizer(entry: NormalizerEntry): void {
src/policy/normalizer/shell.ts:452:registerNormalizer({
src/policy/normalizer/structured-cluster.ts:54:registerNormalizer({
src/policy/normalizer/tool-class.ts:76:registerNormalizer({
src/qa/normalizer-registry-purity-check.ts:17,49: (bare-token prose only, no call)
src/qa/selftest-fixture/normalizer-registry-purity/clean/registry.ts:11: (a declaration, `registerNormalizer(entry: ...)`, not a call)
```
No fourth real call site exists anywhere under `src/`, and none outside `src/` either (`grep -rln "registerNormalizer" . | grep -v ^./src/` → empty). The scan's directory scope (`src/` only) is not a live gap. The fixture-directory `registry.ts` files (two other files share that basename) are correctly *not* excluded by the scan's exact-relative-path filter and correctly hold no matching call shape -- confirmed by reading both.

## Seam findings

### 1. [ISSUE][HIGH][demonstrated] This PR's own STATE.md/CHANGELOG verification text trips QA-15's live bare-claim gate -- the "QA-15: PASS" claim in the same text is false

`docs/STATE.md:10` and `CHANGELOG.md:15` both contain the phrase `159 of 7879 pre-existing failures`. This matches `BARE_CLAIM_PHRASES`'s `/\b\d+\s+of\s+\d+\b/i` pattern in `src/qa/completeness-claim-checker.ts:106` -- a hand-typed completeness-shaped claim not wrapped in the project's `[[completeness: cmd="..." expect=N]]` marker mechanism. Demonstrated:

```
$ node --test src/qa/completeness-claim-checker.test.ts
...
✖ failing tests: 1
test at src\qa\completeness-claim-checker.test.ts:236:1
✖ QA-15 (Issue #159, end-to-end, real corpus): CHANGELOG.md and docs/STATE.md -- the exact
  two files this round corrected -- contain ZERO bare claims after this round's own edits
  AssertionError: expected no bare claims in docs/STATE.md, found: [{"raw":"- **Verified on
  the branch:** ... 159 of 7879 pre-existing failures ...", "context":"line 10"}]
ℹ tests 33
ℹ pass 32
ℹ fail 1
```

Confirmed 100% attributable to this diff, not pre-existing: `git show origin/master:docs/STATE.md` and `git show origin/master:CHANGELOG.md`, run through the same `findBareClaims()` function directly (`node --experimental-strip-types`), both return `0` bare claims on `master`. This diff's own two edits are the only source of the failure.

Both files' new text explicitly claim `QA-15: PASS` / `QA-15 ... all PASS` -- false at the tip of this branch, self-contradicted by the very gate the sentence describes. This is exactly the overclaiming pattern CLAUDE.md's "No hand-derived completeness claims" hard rule and QA-15 exist to prevent (recurring project history: Issues #150, #159, #134, #155, #195 are the same root-cause class -- a story's own CHANGELOG/STATE.md verification prose tripping the gate it claims passed -- all previously closed the same way, by rewording).

It also falsifies the adjacent `npm test`/full-suite claim: `1498 tests, 1498 pass, 0 fail, 0 skipped` is not true at this branch tip -- `completeness-claim-checker.test.ts` alone contributes 1 fail. (A second, unrelated, pre-existing Windows-specific flake -- `src/secret-scan/pre-commit-scan.test.ts`'s R4, an `EBUSY: resource busy or locked, rmdir` tmp-dir race -- also surfaced in my full-suite run; it is unrelated to this diff, touches a file this PR never edits, and is not counted as a finding here.)

**Minimal fix:** reword the two flagged sentences to drop the bare `N of M` shape -- e.g. "QA-14 full-tree (zero-SHA base): exit 1, pre-existing and unchanged in count from before this diff (grep-confirmed none cite `rule-reachability.test.ts`)" -- no digit pair, no code change, no new instrument. This is a same-PR, two-line doc edit; re-run `node --test src/qa/completeness-claim-checker.test.ts` to confirm green before merge.

**Evidence:** demonstrated (ran the real gate test against the real branch tip and against `origin/master` for attribution).
**Exposure:** ~100% of CI runs on this branch (measured -- the failure is deterministic, reproduced twice), since `completeness-claim-checker.test.ts` runs as part of the standard suite every time. Not a narrow-blast-radius finding; rule 21's cap does not apply.

### 2. [CLEAN][code-traced] SE ADR-0021 POL-12 compliance, independently confirmed

App-security's report explicitly flagged it could not check the diff's own POL-12 citation because their ADR submodule was unpopulated. Confirmed above (ADR verdict section): no violation. Worth recording here since it closes a gap their report explicitly named as unchecked.

### 3. [CLEAN][demonstrated] The disclosed file-identity residual is accurate, and the regex's call-shape blind spot app-security found (Issue #351) is real but not re-listed here

Independently reproduced the same defect app-security found and filed (a `registerNormalizer(entry)`/`registerNormalizer(makeEntry())` call with a non-literal argument is invisible to `REGISTRANT_CALL`) before discovering their report and Issue #351 already covered it, filed same-day, same severity (MED), same minimal fix. Per this project's redundancy-check convention, not re-listed as a second finding -- confirmed sound and not duplicated.

### 4. [CLEAN][code-traced] No gold-plating / scope creep

Diff is exactly: 2 new tests in one file, plus the three standing bookkeeping files (CHANGELOG, STATE, run-log) for the same story. Nothing beyond Issue #339's own scope.

## Coverage gaps named

- **No `code-reviewer` or `architecture-reviewer` dispatched.** Expected and correct at STANDARD tier (one domain reviewer + `cross-domain-reviewer`); `app-security-reviewer` was the tier's domain pick given the sensitive-area trigger. I covered the architecture/completeness angle (POL-12, the registrant-scan's own soundness, the DoD-claim accuracy) as part of this pass, so nothing here is silently unowned.
- **`test-writer` not dispatched.** Correct -- this story has no externally observable UI/API surface change (pure unit-test addition to an existing internal test file); per CLAUDE.md it stays covered by `story-implementer`'s own tests.
- **Full local gate suite (`npm test`, `completeness-claim-checker.test.ts`) was not independently re-run by either reviewer before my pass** -- app-security scoped their run to the target test file only. That gap is exactly where finding 1 above was sitting; now closed.

## Verdict

**REWORK.**

One HIGH, demonstrated, code-traced, self-inflicted, 100%-reproducible CI-gate failure in this PR's own bookkeeping text, which also falsifies the PR's stated "QA-15: PASS" and "0 fail" claims. The fix is a same-PR, two-line, non-code wording edit (precedented by five prior closed Issues of the identical shape in this project's own history) -- not a design problem, not a re-review-worthy change once fixed. No ADR collision anywhere in the 37-ADR catalog. No new seam beyond what's already named in Issue #351 (app-security's finding, not re-listed here).

**Open findings / failing tests:** 1 open finding, 1 named failing test (`src/qa/completeness-claim-checker.test.ts:236`, already exists -- no new test needed, it is currently red at this branch tip).

## Single next action

Reword `docs/STATE.md:10` and `CHANGELOG.md:15` to drop the bare `159 of 7879` phrasing (minimal fix above), re-run `node --test src/qa/completeness-claim-checker.test.ts` to confirm green, then re-request review (no re-review needed beyond confirming the gate is green -- this finding's fix is mechanical).

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius -- status [ISSUE]=confirmed collision/gap / [SUSPICION]=unconfirmed, needs a second look / [CLEAN]=seam checked, sound):
1. [ISSUE][HIGH][demonstrated] docs/STATE.md:10, CHANGELOG.md:15 -- this PR's own "159 of 7879" verification prose trips QA-15's live bare-claim gate (completeness-claim-checker.test.ts:236, currently red, 100% attributable to this diff vs clean on origin/master), falsifying the same text's own "QA-15: PASS" and "0 fail" claims -- fix: reword to drop the bare N-of-M shape, no code change.
2. [CLEAN][code-traced] whole 37-ADR catalog vs. diff -- no collision (SE ADR-0021 POL-12 independently confirmed compliant, closing the gap app-security's unpopulated submodule left open; SE ADR-0005/0006/0010/0016, ADR-0018/19/20, THOTH-ADR-0001/0002, all 12 devops ADRs all not applicable or compliant).
3. [CLEAN][demonstrated] src/policy/config/rule-reachability.test.ts:611 -- the non-literal-call-shape gap (registerNormalizer(makeEntry())) is real, independently reproduced, but already filed by app-security-reviewer as Issue #351 (MED) -- not re-listed per the redundancy-check convention.
4. [CLEAN][demonstrated] git diff --name-status + independent grep sweep -- "no production file touched" and "exactly 3 real registrant call sites in src/" both hold end-to-end (no call site outside src/, fixture-directory registry.ts files correctly not excluded and correctly hold no matching shape).
5. [CLEAN][code-traced] whole diff -- no scope creep beyond Issue #339 (2 new tests + the 3 standing bookkeeping files only).
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=4
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=3 code-traced=2 derived=0
checks=target file 18/0/0 skipped; full completeness-claim-checker.test.ts 32/1/0 skipped (1 fail = finding 1); tsc --noEmit exit 0; eslint . exit 0
adr=HIT(37, whole catalog)
report=docs/reviews/s339-registrant-drift-instrument-cross-domain-2026-09-28.md

---

## RE-CONFIRM ADDENDUM — 2026-09-28 (PR #350 fix-now round, tip 30ab631, was 5710c88 at prior review)

Lightweight re-confirm only, not a fresh full review. Scope: does commit `1c90d48` close finding 1 (HIGH) above without collision, and does `30ab631` (report persistence) change anything.

**What changed (`git diff 5710c88 30ab631 --stat`):** `CHANGELOG.md`, `docs/REVIEW_LOG.md`, `docs/STATE.md`, `docs/run-log.jsonl`, `src/policy/config/rule-reachability.test.ts`, plus the two dated review reports (this file and app-security's, both newly committed). No file outside this list changed. `rule-reachability.test.ts`'s diff is comments and two test-title strings only — `REGISTRANT_CALL` regex, assertions, and control-file logic are byte-identical; confirmed by reading the full diff hunk-by-hunk.

**1. Re-ran the tripped gate directly** (not trusting the claim): `node --test src/qa/completeness-claim-checker.test.ts` — 33 pass, 0 fail, 0 skipped, including `QA-15 (Issue #159, end-to-end, real corpus): CHANGELOG.md and docs/STATE.md ... contain ZERO bare claims after this round's own edits`, which runs the live scanner against the actual current file text, not a canned fixture. Finding 1 is closed: **demonstrated**.

**2. Spot-checked the "1498 tests" / "QA-15: PASS" claims are now true, not reworded around the trip.** `grep -c "1498" docs/STATE.md CHANGELOG.md` → 0/0: the stale bare test-count numeral was dropped entirely (replaced with qualitative "pre-existing pass count unchanged, two tests fail, both confirmed pre-existing and unrelated to this diff" prose), not just re-punctuated around QA-15's pattern. The "QA-15: PASS" claim in both files is now backed by the real re-run above. This matches the fix-now round's own framing ("re-verifying for real rather than rewording around the trip") — checked, not just taken at its word.

**3. `rule-reachability.test.ts` comment-only change vs. the whole ADR catalog.** Re-ran `node docs/adr-cache.mjs --ensure` after initializing the `adr/` submodule fresh in this worktree (it started uninitialized here) → `📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2]` — same 37-ADR catalog size as my original pass. The only change to this sensitive-area file (policy delivery/config surface) is disclosure prose naming a residual already ruled on by the Manager (do not broaden `REGISTRANT_CALL`); no behavior changed, so nothing new can trip SE ADR-0021 POL-12 or any other catalog entry beyond what my original pass already cleared. No collision.

**4. No other file changed beyond what's described.** Confirmed by the `--stat` above: the two new files are the persisted review reports (Manager backstop, as the story states), `docs/run-log.jsonl` gained one entry (automated verification log, consistent with a re-verification pass), `docs/REVIEW_LOG.md` gained the two rows for this round's original verdicts (already persisted in `30ab631`, matches what both reviewers filed). Nothing unexplained.

**Issue #352 (mine, HIGH):** re-confirmed closed for real, not just reworded — commented and closed (`state_reason: completed`) on GitHub same turn.

**Issue #351 (app-security's, MED):** out of my finding, but checked for collision per the task — the widened disclosure (file header + two test titles) is wording-only, does not touch the regex app-security flagged, and does not reopen anything in my ADR pass. No collision.

### Updated Verdict

**APPROVE.** Finding 1 (HIGH) is closed, demonstrated by a live re-run, not carried over from the PR's own claim. No new finding. No ADR collision. Open findings / failing tests: 0.

### Updated Single next action

None from this lane — ready for merge-handoff once app-security's own re-confirm is in.

---

RECEIPT (re-confirm addendum): verdict=APPROVE
findings (this pass only; the original round's findings remain listed above for history):
1. [CLEAN][demonstrated] src/qa/completeness-claim-checker.test.ts:236 — QA-15 gate genuinely green (33/33 pass, 0 fail, 0 skipped incl. the live-corpus zero-bare-claims assertion against current STATE.md/CHANGELOG.md text) — finding 1 (HIGH) closed for real.
2. [CLEAN][demonstrated] docs/STATE.md, CHANGELOG.md — "1498"/bare-count claim dropped entirely (grep -c "1498" = 0/0), not reworded around the trip; "QA-15: PASS" claim now backed by the re-run above.
3. [CLEAN][code-traced] src/policy/config/rule-reachability.test.ts — app-security's Issue #351 fix is comment/test-title wording only, REGISTRANT_CALL and all assertions byte-identical; no collision with any of the 37 cataloged ADRs.
4. [CLEAN][code-traced] git diff 5710c88..30ab631 --stat — no file changed beyond CHANGELOG.md, docs/REVIEW_LOG.md, docs/STATE.md, docs/run-log.jsonl, rule-reachability.test.ts, and the two persisted review reports; nothing unexplained.
counts: issues=0 suspicions=0 clean=4
evidence: demonstrated=2 code-traced=2 derived=0
checks=completeness-claim-checker.test.ts 33/0/0 skipped; grep -c "1498" docs/STATE.md CHANGELOG.md = 0/0; git diff --stat 5710c88..30ab631 = 7 files matching description
adr=HIT(37, whole catalog, re-verified after fresh submodule init in this worktree)
report=docs/reviews/s339-registrant-drift-instrument-cross-domain-2026-09-28.md
