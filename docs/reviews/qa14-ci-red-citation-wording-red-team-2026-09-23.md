# Red Team — qa14-ci-red-citation-wording (PR 281)

**Date:** 2026-09-23
**Agent:** red-team (Sutekh)
**Scope:** branch fix/qa14-ci-red-citation-wording, base df092f9 (master tip), head 162dcd3
**Tier:** CRITICAL (sensitive area: policy enforcement / session gates)
**Verdict:** go
**ADR cache:** `ADR cache BUILT: cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2], catalog now current (fp 65bdecc) [CACHE=HIT]`. Catalog slice read: THOTH-ADR-0001 (security/architecture/code — fixture-path resolution rules for `hooks/sessionstart-tool-enum.mjs`) and THOTH-ADR-0002 (secret-scan allowlist). Neither is touched by this diff; THOTH-ADR-0001's "no environment variable MAY select an arbitrary fixture file" rule is the subject of the comment edited at `hooks/sessionstart-tool-enum.mjs:444`, and that rule is still accurately described after the edit (finding A9).

## Redaction notice (this is finding A1, demonstrated on this document)

This report quotes real QA-14 output. Three literal spellings in that output are themselves QA-14-blocking shapes, so writing them verbatim here would re-red the very gate this branch fixes:

- the upstream repository slug immediately followed by a hash and an issue number is written as **UPSTREAM-SLUG issue N**
- the gitignored per-user Claude settings path is written **without backticks**
- the slash-shorthand for the two Node stream write methods is written **without backticks**

Nothing else is altered. Every count below is the real one.

## Diff-base correction

The task brief gave the diff base as 6737242. That is the QA-14 comparison window of the failing master run, not this branch's merge base. The real PR content is df092f9 to 162dcd3:

```
2  2  hooks/sessionstart-tool-enum.mjs
1  1  hooks/userpromptsubmit-halt-relay.mjs
```

The merge base of master and 162dcd3 is df092f9, the current master tip, so the branch is not stale and no rebase race applies. Both ranges were exercised below.

## Attacks, ranked by blast radius

### A1 — [ISSUE][MED][demonstrated] This change's own close-out artifacts are the highest-probability way to re-break the gate it just fixed

**Exposure:** ~100% of close-out artifacts written for this change, basis: counted-in-code.

**Scenario.** The Manager or implementer writes the CHANGELOG entry, the `docs/STATE.md` update, a `docs/decisions.md` row and this review round's dated reports describing what was fixed. The natural way to describe a wording fix is to quote the before and after verbatim. The moment any of those documents contains the upstream slug followed by a hash and 6574, or a backtick-quoted gitignored settings path, or the backtick-quoted slash-shorthand, QA-14 goes red again with the exact three citations this branch removed.

**Mechanism, verified.** `src/qa/reference-scope.ts` scans a changed file WHOLE by default; only `docs/decisions.md`, `docs/decisions-archive.md`, `docs/REVIEW_LOG.md`, `CHANGELOG.md` and `docs/reviews/` get added-text-only scope, and only when the path already exists at the diff base — a path absent at the base has no old text to skip and is checked whole. A brand-new dated report under `docs/reviews/` is therefore scanned in full, not incrementally. This report is such a file. That is why the redaction notice above exists, and it is the finding demonstrating itself.

**Current defense, honestly assessed.** None locally. `.githooks/pre-commit` runs only the OSS-01 pre-commit secret scan (`exec node src/secret-scan/pre-commit-scan.ts`); no QA-14 runs before a commit or a push. Detection is CI-only, after the push, on a branch whose whole purpose was to make CI green.

**Precedent that this is not hypothetical.** Issue #166 is the identical shape (QA-14 close-out prose reintroducing ADR-id-shaped false citations). Issue #280 is the live instance: all 7 remaining blocking citations sit inside this session's own review reports and its REVIEW_LOG row. `docs/qa/recurring-findings-registry.md` already registers the general class — "a fix round's own committed artifacts red a gate that only reads committed state", first seen Issue #131, second seen Issue #180 — but its promotion is an OSS-01 pre-commit hook only. QA-14 has no equivalent, and the class has no QA-14 row.

**Verdict: BREAKS** (the trigger is this change's own next commit).

**Named drill required before the close-out commit is pushed** (not before this PR merges): QA14-PREPUSH-CLOSEOUT — from the branch, with the ADR submodule initialised, run `node src/qa/reference-resolver.ts <master-tip> HEAD` against the close-out commit and require zero unresolved-authority, cross-repo-issue or unparseable entries attributable to the new prose. Then register the QA-14 instance of the recurring class as a row in `docs/qa/recurring-findings-registry.md`, second-seen citation Issue #280.

### A2 — [ISSUE][MED][code-traced] The three de-citations carry no inline reason, and sit beside backtick-quoted siblings

**Exposure:** 100% of future comment-style edits to these two files, basis: counted-in-code (5 sites).

**Scenario.** A maintainer normalises comment style. At `hooks/sessionstart-tool-enum.mjs:444` the settings path is now bare, while six lines later at `hooks/sessionstart-tool-enum.mjs:450` two sibling paths are backtick-quoted. Re-adding the backticks for consistency is the obvious, well-intentioned edit, and it re-reds QA-14 with no clue in the file as to why. The same latent shape survives twice more, un-backticked, at `hooks/userpromptsubmit-halt-relay.mjs:395` and `hooks/userpromptsubmit-halt-relay.mjs:529`; and at `hooks/sessionstart-tool-enum.mjs:12` the reworded upstream reference invites the reverse edit ("make this a proper cross-repo reference").

**Current defense, honestly assessed — real but partial.** QA-14 whole-file-scans both `.mjs` files on any diff that touches them (neither is in the append-only sets). Demonstrated: the 3-line PR-range run below still surfaced 25 citations, including two ADR ids that live in unchanged text. So a re-backticking is caught at PR CI, not after merge — the blast radius is a confusing red build on the offending PR, not a master outage. That is why this is MED and not HIGH.

**What is missing.** This project's own precedent documents exactly this avoidance inline: the header of `src/qa/reference-resolver.ts` states that its doc comments deliberately avoid writing a real-looking id or path-plus-line shape in backticks, and that it was "Fixed here by rewording rather than adding a self-exemption". This branch adopted the technique without the disclosure.

**Verdict: BREAKS** (recurrence and maintainability, bounded).

**Fix:** one short parenthetical at each of the three edited sites, or a single line in each file's header, naming QA-14 as the reason the backticks are absent. No test needed; the note is the fix.

### A3 — [ISSUE][LOW][demonstrated] "Fixes master CI red" is not established; master self-heals by window shift, and after merge the remaining 7 become unobservable

**Exposure:** the master CI signal, basis: measured.

**Scenario.** `.github/workflows/ci.yml` resolves diff refs as base = the push event's before-sha and head = the push sha; pull_request events use the PR base and head instead. The 10 blocking citations live in files changed between 6737242 and df092f9. The next push to master compares df092f9 to that push, a range containing none of those files. Measured: the PR-event range for this branch yields only 2 blocking entries, both local-environment artifacts (see the appendix). So master CI would have gone green on the next push to master with or without this branch.

The sharper half: after this merges, the 7 citations Issue #280 tracks are not merely unfixed, they are unobservable. No full-tree QA-14 run exists anywhere in CI — the scheduled drift job explicitly does not run QA-14 — so the only thing that ever surfaced them was one unlucky push window.

**Current defense.** Issue #280 is open at severity:high and names the residual honestly, and the commit message discloses "reduces QA-14's blocking count from 10 to 7" rather than claiming a full fix. Credit where due: nothing here is overclaimed by the author.

**Verdict: BREAKS** (the stated rationale, not the code). Does not gate: the three defects fixed are real defects regardless of whether the CI window would have hidden them.

**Named follow-up:** add a scheduled full-tree QA-14 job, tracked under Issue #280.

### A4 — [ISSUE][LOW][code-traced] A real cross-repo citation is now unverifiable rather than verified

**Exposure:** 1 citation, basis: counted-in-code.

QA-14's own acceptance text names an issue number belonging to a different repository as one of two non-optional failing shapes. The upstream reference at `hooks/sessionstart-tool-enum.mjs:12` is load-bearing — it is the evidence for Named Finding 1's claim that no live tool-enumeration API exists on this runtime — and it has been reworded out of machine-readable form. Demonstrated: the resolver now emits no citation at all for it (not resolved, not unresolved, absent). Human findability is preserved; machine checkability is gone, and the repository still has no sanctioned way to cite an upstream issue. House precedent (the resolver's own header) endorses rewording over self-exemption, so this is within style — but the resolver's own case was fabricated example text, not a real reference. Route to Issue #280 and Issue #252 rather than to this branch.

**Verdict: BREAKS** (gate coverage), LOW, does not gate this change.

### A5 — [ISSUE][LOW][code-traced] Definition-of-Done artifacts are absent from the branch, and the persisted tier belongs to the previous story

No CHANGELOG entry, no `docs/STATE.md` update, no `docs/decisions.md` row on this branch (2 files changed, both hooks). `docs/.maat-state.json` still records scope `s5-halt-mechanism-hardening` with tier CRITICAL — the correct tier value, but it is the prior story's ratification record, not a persisted ratification for this change. CLAUDE.md's Definition of Done requires the CHANGELOG entry and the STATE update; CLAUDE.md's hard rules require a fresh dated review report in `docs/reviews/` for a sensitive-area change, which this report supplies. A verify-stage item, listed here so it is not skipped silently.

**Verdict: BREAKS** (process), LOW. Note the collision with A1: writing those artifacts is exactly the act A1 says will re-red the gate. Run A1's drill as part of writing them.

## What survived

### A6 — [CLEAN][demonstrated] The change is comment-only; zero behavior change

Proven three independent ways, not taken on the commit message's word:

- Non-comment text is byte-identical on both sides of both files (md5 over each file with every line-comment line removed): `9cc986adf3d647833abc32fd9c986523` before and after for the SessionStart hook, `32d1737f43aa1fea272f764344a78d81` before and after for the relay.
- Line counts unchanged: 631 to 631, and 550 to 550. Exactly three lines differ, each a line comment on both sides, confirmed against a ten-line-context diff.
- Byte deltas reconcile exactly to the three stated edits: +4 on the SessionStart hook (+6 for the reworded upstream reference, -2 for the two removed backticks) and +16 on the relay (29 characters to 45). Nothing else could have moved without breaking that arithmetic.

### A7 — [CLEAN][demonstrated] The claimed 10 to 7 drop is real, and the 3 removed are exactly the 3 claimed

Reproduced both ends; see the appendix. The 10 at base become 7 at head. The three that disappear are precisely the upstream reference, the settings path and the slash-shorthand, each in its claimed hook file. No other citation's verdict changed, and the 7 survivors are byte-identical between the two runs.

### A8 — [CLEAN][demonstrated] No encoding, whitespace, EOL or lint regression

The index and worktree EOL attributes for both files are lf with an explicit text eol=lf attribute. No carriage return, no byte-order mark, no trailing whitespace on any changed line. The only non-ASCII character on a changed line is a pre-existing em dash, untouched. The relay's edited line is now 112 characters; `eslint.config.mjs` declares no max-len, no capitalized-comments, no spaced-comment and no other comment-affecting rule for the hooks block, and 12 lines in that file already exceed 110 characters (longest 285). Typecheck and lint both exit 0.

### A9 — [CLEAN][code-traced] The reworded comments remain true about the code

The relay imports `writeSync` at `hooks/userpromptsubmit-halt-relay.mjs:163` and every emit path uses it — `hooks/userpromptsubmit-halt-relay.mjs:403`, line 408, line 540, line 545. There is no call to either stream write method anywhere in the file, so the edited line's "instead of" claim is accurate, and the expansion into two explicit method names is if anything clearer than the shorthand it replaced. On the SessionStart hook, the edited line keeps the full force of its statement that no environment variable selects the fixture path — which is what THOTH-ADR-0001's fixture-path rule requires the code to do; only the backticks around the delivery-vector path were removed. No information was lost in any of the three rewordings.

### A10 — [CLEAN][demonstrated] No other gate regressed

QA-02 vacuous-pass on the PR range, QA-13 PASS, QA-15 PASS, QA-16 vacuous-pass, kernel-purity PASS, SUR-13 gate-manifest PASS, typecheck exit 0, lint exit 0. Full suite: 1090 tests, 1089 pass, 1 fail, 0 skipped. The single failure is the QA-14 dogfood self-test in `src/qa/reference-resolver.test.ts`, asserting on an ADR id that cannot resolve because the private ADR submodule is unpopulated in this worktree (the `adr` directory is empty, and the cache reporter confirms zero ADRs under both submodule roots). That file is not touched by this branch, and the same failure is recorded verbatim in the two preceding red-team rounds' REVIEW_LOG rows. Disclosed limitation: I could not populate the submodule (private repo, needs a PAT), so the commit's 1090-of-1090 claim is corroborated but not independently reproduced at full green.

## Open findings versus failing tests (PRINCIPLES rule 19)

5 open findings, 0 named failing tests; the gap is explained. A1 and A3 convert to a named pre-push drill and a scheduled-job follow-up rather than a unit test — both are properties of the CI diff window, not of any function. A2, A4 and A5 are documentation, gate-coverage and process items with no executable form. Nothing here is a code defect in the shipped hooks, which is why no test can be red for it.

## Scariest unproven assumption

That the people writing this change's close-out prose will remember the three spellings are load-bearing. The gate that catches them runs only in CI, only on the diff window, and the branch exists precisely because that combination already failed once this session.

## Go / no-go

**go.** The change does exactly what it claims, comment-only, proven by byte-level and gate-level evidence. Two MED findings are recurrence and documentation hygiene, neither a defect in the shipped hooks; three LOW findings are process and gate-coverage items belonging to Issue #280 and the verify stage.

## Single next action

Before writing any close-out artifact for this change, run QA14-PREPUSH-CLOSEOUT (A1) on the close-out commit and keep the three spellings out of the prose.

## Appendix — raw command output

All runs from a clean worktree of this repository, node v24.15.0 (CI pins 22.18.0), the private ADR submodule unpopulated. Redactions are only the three spellings named in the redaction notice.

### Diff shape

```
$ git diff --numstat df092f9 162dcd3
2       2       hooks/sessionstart-tool-enum.mjs
1       1       hooks/userpromptsubmit-halt-relay.mjs

$ git diff --raw df092f9 162dcd3
:100644 100644 ff3b4b1 9567130 M  hooks/sessionstart-tool-enum.mjs
:100644 100644 533e9db 0e8603e M  hooks/userpromptsubmit-halt-relay.mjs
```

No mode change, no rename, no binary, no added or deleted file.

### Comment-only proof

```
md5 over each file with every line-comment line removed:
a1 non-comment-md5=9cc986adf3d647833abc32fd9c986523   (sessionstart at df092f9)
b1 non-comment-md5=9cc986adf3d647833abc32fd9c986523   (sessionstart at 162dcd3)
a2 non-comment-md5=32d1737f43aa1fea272f764344a78d81   (relay at df092f9)
b2 non-comment-md5=32d1737f43aa1fea272f764344a78d81   (relay at 162dcd3)

line and byte counts on the same four dumps:
a1 lines=631 bytes=43986      b1 lines=631 bytes=43990
a2 lines=550 bytes=38204      b2 lines=550 bytes=38220

$ git ls-files --eol hooks/sessionstart-tool-enum.mjs hooks/userpromptsubmit-halt-relay.mjs
i/lf    w/lf    attr/text eol=lf        hooks/sessionstart-tool-enum.mjs
i/lf    w/lf    attr/text eol=lf        hooks/userpromptsubmit-halt-relay.mjs
```

### QA-14 at base (worktree checked out at df092f9)

```
$ node src/qa/reference-resolver.ts 6737242 df092f9
NODE_EXIT=1
[QA-14 reference-resolver] FAIL: 43 of 330 citation(s) failed to resolve; 56 more unclassified (non-blocking).
```

Blocking entries with the 33 ADR-id failures filtered out (those are the unpopulated-submodule artifact, identical on both sides):

```
  - [cross-repo-issue] UPSTREAM-SLUG issue 27299 - cites another repository, not this one [file: docs/REVIEW_LOG.md]
  - [cross-repo-issue] UPSTREAM-SLUG issue 27299 - cites another repository [file: docs/reviews/s5-halt-mechanism-hardening-red-team-2026-09-22.md]
  - [cross-repo-issue] UPSTREAM-SLUG issue 25642 - cites another repository [file: docs/reviews/s5-halt-mechanism-hardening-red-team-2026-09-22.md]
  - [unresolved-authority] origin-master-range-to-4240ca5 - path does not exist [file: docs/reviews/s5-halt-mechanism-hardening-red-team-2026-09-22.md]
  - [unresolved-authority] hooks/sessionstart-tool-enum-concurrency.test.ts - path does not exist [file: docs/reviews/s5-halt-mechanism-hardening-red-team-2026-09-22.md]
  - [unresolved-authority] GITIGNORED-SETTINGS-PATH - path does not exist [file: docs/reviews/s5-halt-mechanism-hardening-red-team-2026-09-22.md]
  - [unresolved-authority] scripts/guard.mjs - path does not exist [file: docs/reviews/s5-halt-mechanism-hardening-red-team-round2-2026-09-22.md]
  - [cross-repo-issue] UPSTREAM-SLUG issue 6574 - cites another repository [file: hooks/sessionstart-tool-enum.mjs]
  - [unresolved-authority] GITIGNORED-SETTINGS-PATH - path does not exist [file: hooks/sessionstart-tool-enum.mjs]
  - [unresolved-authority] STREAM-WRITE-SHORTHAND - path does not exist [file: hooks/userpromptsubmit-halt-relay.mjs]
```

Count: 10. This reproduces the failing master run exactly.

### QA-14 at head (worktree checked out at 162dcd3)

```
$ node src/qa/reference-resolver.ts 6737242 162dcd3
NODE_EXIT=1
[QA-14 reference-resolver] FAIL: 40 of 327 citation(s) failed to resolve; 56 more unclassified (non-blocking).
```

Same filter applied:

```
  - [cross-repo-issue] UPSTREAM-SLUG issue 27299 [file: docs/REVIEW_LOG.md]
  - [cross-repo-issue] UPSTREAM-SLUG issue 27299 [file: docs/reviews/s5-halt-mechanism-hardening-red-team-2026-09-22.md]
  - [cross-repo-issue] UPSTREAM-SLUG issue 25642 [file: docs/reviews/s5-halt-mechanism-hardening-red-team-2026-09-22.md]
  - [unresolved-authority] origin-master-range-to-4240ca5 [file: docs/reviews/s5-halt-mechanism-hardening-red-team-2026-09-22.md]
  - [unresolved-authority] hooks/sessionstart-tool-enum-concurrency.test.ts [file: docs/reviews/s5-halt-mechanism-hardening-red-team-2026-09-22.md]
  - [unresolved-authority] GITIGNORED-SETTINGS-PATH [file: docs/reviews/s5-halt-mechanism-hardening-red-team-2026-09-22.md]
  - [unresolved-authority] scripts/guard.mjs [file: docs/reviews/s5-halt-mechanism-hardening-red-team-round2-2026-09-22.md]
```

Count: 7. The delta from base is exactly the three hook-file entries and nothing else. Totals move 43 to 40 and 330 to 327, consistent with removing three citations and adding none.

### QA-14 on the real PR-event range

```
$ node src/qa/reference-resolver.ts df092f9 162dcd3
[QA-14 reference-resolver] FAIL: 2 of 25 citation(s) failed to resolve; 2 more unclassified (non-blocking).
  - [unresolved-authority] ADR-ID - no ADR with this id exists in the tree [file: hooks/sessionstart-tool-enum.mjs]
  - [unresolved-authority] ADR-ID - no ADR with this id exists in the tree [file: hooks/userpromptsubmit-halt-relay.mjs]
```

Both are the unpopulated-submodule artifact and resolve in CI. Note the 25 citations found from a 3-line diff: proof that both hook files are whole-file-scanned, which is A2's mitigating defense and A1's amplifier.

### Other gates and the suite

```
$ node src/qa/diff-fixture-check.ts df092f9 162dcd3
[QA-02 diff-fixture-check] VACUOUS-PASS: 0 policy rule files changed in this diff - vacuous pass.
$ node src/qa/recurring-findings-registry.ts
[QA-13 recurring-findings-registry] PASS: 3 recurring finding class(es) logged, all structurally valid.
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
$ node src/qa/broken-instrument-gate.ts
[QA-16 broken-instrument-gate] VACUOUS-PASS: 0 known-broken instruments registered - vacuous pass.
$ node src/qa/kernel-purity-check.ts
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
$ node src/qa/gate-manifest-check.ts
[SUR-13 gate-manifest-check] PASS: Exactly 1 gate manifest found: .claude/settings.json.
$ npx tsc --noEmit -p tsconfig.json
TSC_EXIT=0
$ npx eslint .
LINT_EXIT=0
$ node --test
tests 1090
suites 0
pass 1089
fail 1
cancelled 0
skipped 0
todo 0
failing: QA-14 (dogfood): this checker own source, run against itself, resolves clean (no self-inflicted false positive)
  AssertionError: expected no unresolved citations in this file own source, found an ADR id
  at src/qa/reference-resolver.test.ts:150
```

The one failure is the unpopulated-submodule artifact described in A10; it is present in this worktree at base as well, and is unrelated to the diff.

## Editorial (verdict-neutral, no re-review)

1. The relay now spells the same concept two ways: the edited line uses the two expanded method names, while lines 395 and 529 keep the slash shorthand. Harmless, but pick one.
2. The comment at `hooks/sessionstart-tool-enum.mjs:444` now mixes quoting styles inside one sentence - a bare path followed immediately by a backtick-quoted key name. Reads oddly; A2's inline reason note would fix both at once.
3. Running an npm clean install inside a git worktree rewrites the shared core.hooksPath setting from an absolute to a relative path (the install script warns about it). Both values resolve to the same hook directory, so nothing broke; I restored the original value. Worth knowing before someone treats the warning as a real problem.

## Filed

- Finding A1 -> Issue #283 (bug, severity:med, qa)
- Finding A2 -> Issue #284 (bug, severity:med, sur)
- A3 and A4 routed to the existing Issue #280; A5 is a verify-stage item; LOW findings file no Issue by convention.

Self-check of this report against the gate it reviews: committed to a throwaway detached-HEAD commit and scanned. Result: `FAIL: 2 of 30 citation(s) failed to resolve`, both being the ADR ids this worktree cannot resolve with the private submodule unpopulated (they resolve in CI, as the merged reports citing the same ids demonstrate). Zero cross-repo and zero path failures attributable to this report. The throwaway commit was discarded.

---

```
RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated] Close-out prose for this very change re-reds QA-14 - a new docs/reviews file is whole-scanned (reference-scope.ts), CHANGELOG/STATE/decisions added-text-scanned, and quoting the before/after verbatim reintroduces all three removed citations; defense is CI-only (pre-commit runs OSS-01 only), precedent Issue #166 / Issue #280 / registry row first-seen Issue #131 second-seen Issue #180 promoted for OSS-01 only. Exposure ~100% of this change's close-out artifacts, basis counted-in-code. Drill: QA14-PREPUSH-CLOSEOUT.
2. [ISSUE][MED][code-traced] Three de-citations carry no inline reason and sit beside backticked siblings (bare settings path at sessionstart:444 vs backticked siblings at :450; shorthand survives at relay:395 and :529) - a style-normalising edit re-reds CI with no local clue; defense is real but partial (whole-file scan catches it at PR CI, 25 citations from a 3-line diff), house precedent in reference-resolver.ts header documents such avoidance inline. Exposure 100% of future comment-style edits to these 2 files, basis counted-in-code.
3. [ISSUE][LOW][demonstrated] "Fixes master CI red" unestablished - push-event window (before-sha to push-sha) means master self-heals on the next push regardless, and after merge the 7 residuals become unobservable since no full-tree QA-14 runs anywhere in CI; author disclosed the 10-to-7 honestly, Issue #280 open. Basis measured.
4. [ISSUE][LOW][code-traced] A real, load-bearing upstream citation at sessionstart:12 is now emitted as no citation at all - machine-checkability traded for gate silence; repo still has no sanctioned way to cite upstream. Route to Issue #280 / Issue #252.
5. [ISSUE][LOW][code-traced] DoD artifacts absent from the branch (no CHANGELOG, no STATE, no decisions row) and .maat-state.json still records the previous story scope, so the CRITICAL tier cited is the prior ratification record, not one for this change.
6. [CLEAN][demonstrated] Comment-only, zero behavior change - non-comment text md5-identical both files, line counts 631/631 and 550/550, exactly 3 differing lines all comments, byte deltas +4 and +16 reconcile exactly to the 3 edits.
7. [CLEAN][demonstrated] The 10-to-7 drop is real and the 3 removed are exactly the 3 claimed; the 7 survivors are byte-identical across both runs.
8. [CLEAN][demonstrated] No encoding/whitespace/EOL/lint regression - lf both sides, no BOM, no trailing whitespace, no comment or max-len lint rule, typecheck and lint exit 0.
9. [CLEAN][code-traced] Reworded comments remain true about the code - relay uses writeSync at :163/:403/:408/:540/:545 with no stream-write call anywhere; the fixture-path comment still states THOTH-ADR-0001's no-env-var rule with full force; no information lost.
10. [CLEAN][demonstrated] No other gate regressed - QA-02/13/15/16, kernel-purity, SUR-13 all pass; suite 1090 tests, 1089 pass, 1 fail, 0 skipped, the 1 failure being the unpopulated private ADR submodule in this worktree, in a file this branch does not touch.
counts: issues=5 suspicions=0 clean=5
evidence: demonstrated=6 code-traced=4 derived=0
checks=node --test 1090 tests / 1089 pass / 1 fail (unpopulated ADR submodule, pre-existing, untouched file) / 0 skipped; tsc exit 0; eslint exit 0; QA-14 three ranges run (10 / 7 / 2-artifact); QA-02 vacuous-pass, QA-13 PASS, QA-15 PASS, QA-16 vacuous-pass, kernel-purity PASS, SUR-13 PASS
adr=HIT(2)
report=docs/reviews/qa14-ci-red-citation-wording-red-team-2026-09-23.md
```
