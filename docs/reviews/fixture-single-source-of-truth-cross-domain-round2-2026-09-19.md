# Cross-domain review, round 2 (targeted re-confirm): fixture-single-source-of-truth (Issue #217)

[cross-domain-reviewer]
Cross-Domain Reviewer (Ra) -- scanning the seams between reviewer lanes

- Scope: `fixture-single-source-of-truth`, CRITICAL (Manager-ratified, not re-litigated). Branch `feat/fixture-single-source-of-truth`, `HEAD: 5cb6dfa`.
- Reviewed: fix-now delta only, `git diff 3dc2a99..5cb6dfa` (commits 79b18ec, c5576a2, 5cb6dfa; 7 files). Round 1 report: `docs/reviews/fixture-single-source-of-truth-cross-domain-2026-09-19.md` (F1-F7).
- Date: 2026-09-19.
- Also owns the ADR TEXT review (no architecture-reviewer seat). Question put to me: is THOTH-ADR-0001 ready for the human to accept as-is?

## 1. Lanes and ground covered

| Lane | Status | Ground |
|---|---|---|
| `app-security-reviewer` (round 1) | report on disk, APPROVE-WITH-CONDITIONS | hooks diff, Issue #99, ADR rules 4/5 wording (F1), status (F2), unlock-hint word (F3) |
| `red-team` (round 1) | report on disk, `go` | 9 mutations M1-M9, 2 vacuity proofs, deleted-test enumeration |
| me (round 2) | this report | whole ADR catalog vs the fix delta, ADR text, cross-file agreement (ADR / decisions / CHANGELOG / CLAUDE.md / backlog), new seams from the fix round |

Not re-reported: app-security F3 (unlock hint "reviewed", deliberately deferred, hook untouched). I read the Manager's reasoning and agree it is a wording matter under a human-reviewed PR.

## 2. ADR catalog (whole, unfiltered)

```
$ node docs/adr-cache.mjs --ensure
ADR cache HIT: reused 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1] from catalog (fp 64d7e9e) [CACHE=HIT]
```

- THOTH-ADR-0001 parses: `status: proposed`, `applicableTo: [security, architecture, code]`, 7 rules (rule 7 is the new SE-0010 clause). The catalog rule text equals the frontmatter `constraints` verbatim.
- `code` is a real lane tag: `code-reviewer` filters on "code, testing, error-handling, maintainability" (maat 2.0.0 `code-reviewer.md` line 16), and ADR-0021 already uses it. SE ADR-0010's own tags are `quality, process`, so a code-reviewer slicing by `code` did not previously see ADR-0010. The new tag on THOTH-ADR-0001 is what makes the exception visible in that lane.
- `docs/.maat-state.json` delta (`git diff 3dc2a99..5cb6dfa`): catalog `version` 4c11208 -> 64d7e9e, THOTH-ADR-0001 `applicableTo` gains `code`, rules 2/4/5/6 reworded, rule 7 added. Structural check against `3dc2a99`: `non-catalog identical: true` (all top-level keys, scope, tier, priorScope chain), catalog 36 -> 36, the other 35 entries `others equal: true`. Catalog-only, as claimed.

## 3. Round-1 closure table

| Round-1 item | Issue | Status | Evidence |
|---|---|---|---|
| app-security F1: rules 4/5 false or unverifiable | #219 | Closed, one wording residual (N1) | Rule 4 now scoped "for this allowlist" and exempts `allowlist-settings.ts` (`github`, SUR-04; lines 7 and 18 declare it for `allowedMcpServers`). I ran the ADR's own `node -e` query: `14 names, quoted-literal hits: 1` / `src\policy\fixtures\allowlist-settings.ts "github"`, exactly the documented expected output. Rule 5 now says `CLAUDE_PROJECT_DIR` is the project-root seam and path+source go to halt-state: `hooks/sessionstart-tool-enum.mjs:283-286` returns `fixtureSource`/`fixturePath`, and `writeHaltReason` lines 194-197 write them. The query is committed in the ADR and the decisions row; the un-reproducible "81 files" figure is dropped ("deliberately not asserted"). |
| app-security F2 / cross-domain F1: `proposed` status | #220 | Legitimately deferred to the human, still OPEN by design | Text now says the exception binds only from acceptance, the human accepts BEFORE the PR merges, and the catalog serves `proposed` rules like accepted ones. The "or a follow-up commit" escape is gone. See F1-carried. |
| app-security F3: hint word "reviewed" | none | Deferred, agreed | Hook untouched; decisions row (h) records the reasoning. |
| cross-domain F2: SE-0010 exception | #221 | Closed, one list residual (N2) | Rule 7 in ADR and frontmatter; `code` added. Rule-7 claims checked below. |
| cross-domain F3: removal-trigger owner | #222 / #224 | Closed in ADR, decisions row, CHANGELOG; residue in 3 non-ADR texts (N3) | Issue #224 exists (open, labels `enhancement`, `sur`); its body names the reason and links #90, #93, #217, backlog:47. `grep -cE "Removal trigger.*#[0-9]+"` on the ADR = 1 (was 0). #90 gets a backlink from #224's body, which meets my round-1 "link it before closing" condition. |
| cross-domain F4: rule 2 vs CLAUDE.md | none | Closed | ADR rule 2 states the fixture-entry-PR exemption; CLAUDE.md carries the matching sentence. |
| cross-domain F5: THOTH-ADR id scheme in QA-14 | none | Legitimately deferred | New `docs/backlog.md` line names the test `QA-14-resolves-THOTH-ADR-ids-against-docs-adr`. |
| cross-domain F6: supersede markers | none | Closed | `sed -n '31p;32p;94p' docs/decisions.md` piped to `grep -c "PARTIALLY SUPERSEDED"` -> 3 (was 0). All 83 table rows still 6 cells (counted by script); each marker is inside cell 2 (the Decision cell), so the table is intact. |
| cross-domain F7: comment says "the control" | none | Closed | `grep -n "IS the control" src/policy/tools/central-classification.ts` -> exit 1. `git diff 3dc2a99..5cb6dfa -U0 -- central-classification.ts`: 1 line changed, `non-comment changed lines: 0`. |

### Rule-7 accuracy (asked explicitly)

- Red-team report: A4 lists M1-M8, "8 one-way production mutations, 8 killed". A9 records M9 (unlock-hint generic branch gutted): "tests 869 / pass 863 / fail 6 ... 5 real kills". Its receipt says "9/9 killed". The ADR's "9 production mutations and all 9 were killed (8 by the new tests, 1 by the existing generic-hint tests)" matches. M9's killers pre-exist: `git show 953b078:hooks/userpromptsubmit-halt-relay-fixnow.test.ts` has `AC4: an active reason key with no bespoke unlock hint` at line 72.
- Nuance, not a finding: M7 is killed by one new test plus 9 pre-existing hook tests, so "8 by the new tests" means each of the 8 is killed by at least one new test, which is what A4's table shows.
- The two vacuity proofs are red-team A5 (old `/class/` assertion; old "not expired" test passing with the parser throwing). Matches ADR line 58.
- The ADR cites "A4 and A5" for all of it; M9 sits in A9. Editorial.
- Decisions row (h) says "red-team's 9 mutations and 2 vacuity proofs cited". CHANGELOG says "new rule 7, `code` in `applicableTo`". Both agree with the ADR.

## 4. Cross-domain ADR verdict (whole catalog vs the delta)

The delta is prose (ADR, decisions, CHANGELOG, backlog, CLAUDE.md), one code comment, and the state catalog.

| ADR | Applies? | Verdict |
|---|---|---|
| SE ADR-0001 (agents never self-accept; never edit an accepted decision) | yes | Complied. ADR stays `proposed`; ADR-0021 and the `adr/` submodule are not in the diff. |
| SE ADR-0010 line 47 "MUST NOT ... delete tests" | yes (deletions from the original diff) | Exception is now an ADR rule. Binding on acceptance only. |
| SE ADR-0005 line 54 (no deleting a failing test) | yes | Not violated: no deleted test was failing (baseline 879/0/0 per CHANGELOG; my round-1 name-diff). |
| ADR-0021 INT-07 | yes | Unchanged from round 1: the standing exception rests on THOTH-ADR-0001, binding from acceptance. |
| PRINCIPLES rule 9 (ADR outranks CLAUDE.md) | yes | CLAUDE.md's new sentence and ADR rule 2 say the same thing, so no outrank conflict arises even before acceptance. |
| ADR-0021 POL-11 kernel purity, audit-log rules, devops ADR-0001..0012, SE ADR-0002/0003/0004/0006 | checked | No collision; no kernel, audit-log or infra file in the delta. |

No new ADR-violation blocker.

## 5. New-seam hunt: does the fix round introduce anything?

### CLAUDE.md amendment: strictly narrower than the ruling?

Added: one sentence in the "Policy delivery / config surface" bullet ("Exception (THOTH-ADR-0001, human ruling 2026-09-19): adding or removing an entry in docs/qa/s5-central-classification.json is not, by itself, a change needing a fresh dated review report -- the merged PR diff is the approval; changes to the loader or hooks that read it still are."), plus "(see the Policy delivery exception above)" in the Hard rules bullet. `git diff --numstat`: CLAUDE.md 2 insertions, 2 deletions.

- One file only: it names `docs/qa/s5-central-classification.json`. It cannot be read to cover another fixture.
- Loader/hooks stay in scope ("still are"). I enumerated every non-test, non-report file naming the fixture: `hooks/sessionstart-tool-enum.mjs`, `hooks/userpromptsubmit-halt-relay.mjs` (hint text only), `src/policy/tools/central-classification.ts`, `builtin-tool-inventory.ts` (comment). The readers are the loader and the hook, so "loader or hooks that read it" covers every reader.
- "adding or removing an entry" does not cover editing the file's `notes` or `version`, or changing an existing entry's `class`. Those are not exempted. That is the narrower, safer reading.
- The Hard rules parenthetical reads correctly: "the Policy delivery exception above" is the sensitive-areas bullet, earlier in the same file.
- Agreement: ADR Decision bullet (line 45), rule 2 (line 53), frontmatter (line 13), decisions row (h), CHANGELOG bullet and CLAUDE.md all say: add/remove-only PR needs no fresh dated report, the merged diff is the approval, loader/hook changes still need one. Same for #224 and for the SE-0010 exception. No disagreement found.
- One open reading, recorded as N4: the sensitive-areas preamble's "always draw a named reviewer" is not amended.

### Other checked seams

- CHANGELOG edit beyond the added bullet: the QA-14 sentence in the "Verification, real" bullet. The new text (red on `master` from pre-existing debt; diff-scoped; none of the unresolved citations originate in lines this diff adds; earlier before/after comparison withdrawn) matches red-team's report (line 263) and my round-1 editorial 1. Accurate. "Issues #219 to #223, tracker #224": all six exist and are open.
- `docs/backlog.md`: CHANGELOG says "five new lines". `git diff --numstat` gives 6 insertions / 1 deletion = 5 new lines plus one appended reconciliation on the existing line 49. Matches. Issue #223 and the "proposed served as accepted" note are recorded, as the Manager said.
- QA-15: `node src/qa/completeness-claim-checker.ts` -> `PASS: 2 file(s) checked`. Its default scope excludes the ADR and `docs/decisions.md`; the ADR's 14-names figure reproduces by my own run.
- Decisions row (h) "Human ratified" cell reads "Y (directive and plan); ADR acceptance pending" and does not name the 2026-09-19 fixture-entry-PR ruling. Editorial.

## 6. Findings

### F1-carried [ISSUE][MED][demonstrated] THOTH-ADR-0001 is still `proposed` (Issue #220; expected, human action)

- Evidence: `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md:4` (`status: proposed`).
```
$ grep -q '^status: accepted' docs/adr/thoth-0001-central-classification-fixture-standing-exception.md; echo "status-accepted-check exit=$?"
status-accepted-check exit=1
```
- Not a fix-round defect: the Manager left it because only the human may accept, and the text now says so and requires acceptance before merge. Listed so the verdict does not hide that this gate is still closed.
- Exposure: ~100% of merges of this branch, basis: counted in code (one PR; 14 listed names). Governance-only, no runtime effect, so MED.
- Minimal fix: the human sets `accepted` in TWO places, frontmatter line 4 and the body "Status" bullet at line 24 (which currently reads "Proposed ... stays `proposed` until the human sets it"). Then re-run `node docs/adr-cache.mjs --ensure` and commit `docs/.maat-state.json` so the catalog reads `accepted`.
- Failing test (named): `THOTH-ADR-0001-status-accepted` = the grep above; exit 1 now.
- Already tracked: Issue #220. No new Issue filed.

### N1 [ISSUE][LOW][code-traced] "No environment variable" wording: rule 5 omits the cwd fallback, and the loader comment still says "of any kind"

- `hooks/sessionstart-tool-enum.mjs:111-113`: `projectDir()` is `process.env.CLAUDE_PROJECT_DIR ?? process.cwd()`. ADR rule 5 (line 56, frontmatter line 16) says the path "MUST resolve only from CLAUDE_PROJECT_DIR ... or DEFAULT_FIXTURE_PATH". With `CLAUDE_PROJECT_DIR` unset the hook uses its working directory. #219 rewrote the rule to be "true as written", so the omission matters to that claim, not to safety (a session cannot change the hook's cwd or env).
- `src/policy/tools/central-classification.ts:36`: "no environment variable of any kind chooses which fixture file loads". This is the same falsehood app-security F1 found in the ADR: `CLAUDE_PROJECT_DIR` does. The round fixed line 23 only.
```
$ <rule-5 line of the ADR> | grep -ciE "cwd|working directory"   -> 0
$ grep -n "of any kind" src/policy/tools/central-classification.ts -> 36:// silently), and no environment variable of any kind chooses which fixture file loads (GitHub Issue
```
- Minimal fix: rule 5 (and its frontmatter copy) add "or the hook's working directory when it is unset". Comment line 36: "no dedicated environment variable selects the fixture file; `CLAUDE_PROJECT_DIR` is the project-root seam". Comment-only, no gate change.
- Failing test (named): `THOTH-ADR-0001-rule5-and-loader-comment-name-the-project-root-seam` (the two greps above).
- LOW: documentation accuracy, no exploit; below the Issue-filing threshold.

### N2 [ISSUE][LOW][demonstrated] Rule 7's exception list omits `S5-R2-N3`, a deleted expiry test

- The original diff deleted `S5-R2-N3` (`hooks/sessionstart-tool-enum-fixnow.test.ts`, "once the exemption fixture expires, a distinct SUR-03-central-fixture-expired reason fires ..."). Rule 7 names `AC1-a`, `AC1-b`, `AC1-c`, `S5-R2-N2`, the `isFixtureExpired` tests and the `expiresOn`/`ratifiedBy` tests, then says "MUST NOT cite it to delete any other test". `S5-R2-N3` is not named; it is covered only if "expiry tests" is read loosely.
```
$ git show 953b078:hooks/sessionstart-tool-enum-fixnow.test.ts | grep -c '^test("S5-R2-N3'   -> 1
$ git show 3dc2a99:hooks/sessionstart-tool-enum-fixnow.test.ts | grep -c 'S5-R2-N3'          -> 0
$ awk '/^# Rules for agents/,/^# Residual/' docs/adr/thoth-0001-...md | grep -c 'S5-R2-N3'    -> 0
```
- The three old `AC1` hook tests were rewritten under new titles (replaced, not removed); only `S5-R2-N3` falls through the list.
- Minimal fix: add `S5-R2-N3` to rule 7, the frontmatter `code` constraint and the Consequences line. One token, three places.
- Failing test (named): `THOTH-ADR-0001-rule7-names-S5-R2-N3` (the third grep; 0 now).
- LOW: the intent is plain ("the exact-pin and expiry tests"); this is list precision inside a rule that says "MUST NOT cite it for any other test".

### N3 [ISSUE][LOW][demonstrated] Three non-ADR texts still name S6 as what ends the exception, contradicting the ADR and the decisions row

- ADR line 74: the removal trigger "is not a deliverable of S6 or Milestone #24". Decisions row (b): "S6 is not named as the owner". Still naming S6:
```
docs/qa/s5-central-classification.json:7        "... until an out-of-repo policy source ships (S6)."
src/policy/tools/central-classification.ts:32   // ... it ends when an out-of-repo policy source ships (S6).
docs/backlog.md:49   "The removal trigger is unchanged: an out-of-repo policy source shipping under S6/Milestone #24 ends the exception."
```
- The backlog line was touched this round (a "disposable" reconciliation was appended to it) but its S6 sentence was left. A reader of the fixture or the loader gets "S6", the misdirection #222 was filed to remove. The ADR governs once accepted, so no behavior is at risk.
- Minimal fix: "(S6)" -> "(Issue #224)" in the JSON note and the comment; "under S6/Milestone #24" -> "(Issue #224)" in the backlog line. The JSON edit is a `notes` change, not an entry, so the human ruling does not cover it; treat as an ordinary docs edit.
- Failing test (named): `no-S6-as-removal-trigger-owner` = grep for `(S6)` or `under S6` across the three files (3 hits now, 0 wanted).
- LOW: text drift only.

### N4 [SUSPICION][LOW][derived] The sensitive-areas preamble is not amended: "always draw a named reviewer"

- CLAUDE.md "Sensitive areas" preamble: "These areas always draw a named reviewer before a change to them is shippable". The new sentence exempts a fixture-entry PR from the fresh dated review report only. Read alone, a Manager could still seat a reviewer for such a PR and have nowhere to put the report. Read with PRINCIPLES rule 1 ("never drop a security change out of review"), the human's own PR-diff review is what stands in for it (and `master` has no branch protection, a disclosed residual).
- No action needed if that is the intent; "the merged PR diff is the approval" already says so. Derived from documents, no test, capped LOW. Residual-register line: "fixture-entry PR: the human PR-diff review is the named reviewer".

### Clean seams (checked, sound)

- C1 [demonstrated] #219: the ADR's single-source query reproduces (`14 names, quoted-literal hits: 1`, the SUR-04 `github` hit only); rules 4/5 accurate but for N1's cwd omission.
- C2 [demonstrated] #221: rule 7 exists, `code` in `applicableTo`; the 9-mutation (8 + 1) wording and 2 vacuity proofs match red-team A4/A5/A9; M9's killer test pre-exists at base.
- C3 [code-traced] #222/#224: Issue #224 exists and is cited in ADR, decisions row and CHANGELOG (`grep -cE "Removal trigger.*#[0-9]+"` = 1); #90 gets a backlink; no ADR text names S6 as owner (residue in N3 is outside the ADR).
- C4 [code-traced] CLAUDE.md amendment: one sentence + one parenthetical; one file; loader/hooks kept in scope; cannot cover other fixtures.
- C5 [demonstrated] decisions rows 31/32/94 carry `PARTIALLY SUPERSEDED` (3/3), 6 cells each, marker in the Decision cell; F7 comment-only (0 non-comment changed lines).
- C6 [demonstrated] `docs/.maat-state.json` catalog-only vs `3dc2a99` (non-catalog identical, 35 other entries equal); THOTH-ADR-0001 parses with 7 rules.
- C7 [code-traced] CHANGELOG (QA-14 sentence, "five new lines", "#219 to #223") and backlog counts accurate; ADR, decisions row, CHANGELOG and CLAUDE.md agree on the exemption, #224 and the SE-0010 exception.
- C8 [demonstrated] Checks: section 8.

## 7. Coverage gaps

| Part of delta | Claimed by a lane? | Note |
|---|---|---|
| CLAUDE.md two-line amendment | none | Covered here (section 5). |
| ADR text | none | Covered here (section 3, N1, N2). |
| Backlog / CHANGELOG / decisions prose | none | Covered here (N3, section 5); low risk. |
| `docs/.maat-state.json` catalog | none | Covered here (section 2). |
| Human acceptance of the ADR | n/a | A human action, not reviewable (F1-carried). |

## 8. Raw check output

```
$ node docs/adr-cache.mjs --ensure   -> ADR cache HIT: 36 ADRs [adr/devops:12, adr/software-engineering:23, docs/adr:1] (fp 64d7e9e) [CACHE=HIT]
$ npm test                           -> tests 869 / suites 0 / pass 869 / fail 0 / cancelled 0 / skipped 0 / todo 0
$ npm run typecheck                  -> tsc --noEmit clean (no output)
$ npm run lint                       -> eslint . clean (no output)
$ node src/qa/completeness-claim-checker.ts -> [QA-15] PASS: 2 file(s) checked, all completeness claims verified.
$ ADR single-source node -e query    -> 14 names, quoted-literal hits: 1 (src\policy\fixtures\allowlist-settings.ts "github")
$ grep -q '^status: accepted' ADR    -> exit 1
$ node docs/receipt-check.mjs --scope fixture-single-source-of-truth -> run after this file was written; output is in the hand-back (a report cannot hold the output of a check that reads it).
```

## 9. Editorial (verdict-neutral, plain edits)

1. ADR line 58 cites red-team "A4 and A5"; M9 is in A9. Add "A9".
2. CHANGELOG and decisions row use "M1 mutation proof" for the implementer's own JSON-edit proof; red-team's M1-M9 are a different set. Rename one to avoid the clash.
3. Decisions row (h) "Human ratified" cell: add the fixture-entry-PR ruling to "Y (directive and plan)".
4. Four of the five new backlog lines have no GitHub Issue. CLAUDE.md's gold-plating rule prefers an Issue once the project has an Issues setup; `docs/backlog.md` is this file's established practice. Verdict-neutral.
5. `docs/STATE.md` is still for the Manager to update at close (round-1 editorial 2 stands).

## 10. Is THOTH-ADR-0001 ready for the human to accept as-is?

Nearly. The substance is sound: rules 1-6 are true as worded except the cwd omission (N1), the SE-0010 exception is recorded (rule 7), the trigger is owned (#224), the exemption is stated, and the verification query reproduces. Two one-line edits are worth making in the same commit as the acceptance:

1. Rule 5 (and its frontmatter copy): add "or the hook's working directory when it is unset" (N1).
2. Rule 7 (and its frontmatter copy, and Consequences): add `S5-R2-N3` to the list (N2).

Neither blocks. The human may accept as-is and take N1/N2/N3 as a follow-up docs edit. The flip touches two places (frontmatter line 4 and the body Status bullet, line 24), then rebuild the catalog.

## 11. Verdict

**APPROVE-WITH-CONDITIONS.** The fix round closes every round-1 finding or defers it legitimately. It introduces no gate-behavior change, no ADR collision and no code defect. The one open gate is the human's acceptance (F1-carried, Issue #220). N1-N3 are LOW text drift, N4 a derived note.

Open findings: 4 issues + 1 suspicion = 5. Failing tests: 4 (F1-carried, N1, N2, N3). N4 has no executable form (a documented-intent question); it is a residual-register line.

**Single next action:** the human applies N1/N2 in THOTH-ADR-0001, sets `status: accepted` in both places, re-runs `node docs/adr-cache.mjs --ensure`, and commits before merge.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] docs/adr/thoth-0001...:4,24 -- ADR still `proposed` (human action, Issue #220 open); grep `^status: accepted` exit 1 -- human sets accepted in frontmatter AND body Status bullet, rebuilds catalog, before merge. Exposure: ~100% of merges of this branch, basis: counted in code
2. [ISSUE][LOW][demonstrated] docs/adr/thoth-0001... rule 7 -- exception list omits deleted expiry test `S5-R2-N3` (grep in rules section = 0) -- add the token in rule 7, frontmatter, Consequences
3. [ISSUE][LOW][code-traced] hooks/sessionstart-tool-enum.mjs:111-113 + src/policy/tools/central-classification.ts:36 + ADR rule 5 -- projectDir() falls back to cwd; ADR rule 5 omits it and loader comment still says no environment variable of any kind -- reword both, comment-only
4. [ISSUE][LOW][demonstrated] docs/qa/s5-central-classification.json:7, central-classification.ts:32, docs/backlog.md:49 -- still name S6 as what ends the exception, contradicting ADR line 74 / decisions row -- replace with Issue #224
5. [SUSPICION][LOW][derived] CLAUDE.md sensitive-areas preamble always-draw-a-named-reviewer unamended vs the fixture-entry-PR exemption -- residual line: PR-diff review is the named reviewer
6. [CLEAN][demonstrated] #219 ADR single-source query reproduces (14 names, 1 hit = SUR-04 github); rules 4/5 accurate but for finding 3
7. [CLEAN][demonstrated] #221 rule 7 + code tag present; 9 mutations (8 new-test kills + M9 by pre-existing AC4 tests), 2 vacuity proofs match red-team A4/A5/A9
8. [CLEAN][code-traced] #222/#224 owner: Issue #224 open and cited in ADR/decisions/CHANGELOG, #90 backlinked; no ADR text names S6 as owner
9. [CLEAN][code-traced] CLAUDE.md amendment strictly narrow: one file, loader/hooks kept in scope, parenthetical reads correctly, four texts agree on exemption/#224/SE-0010
10. [CLEAN][demonstrated] decisions rows 31/32/94 marked (3/3, 6 cells each, marker in Decision cell); F7 comment-only (0 non-comment changed lines)
11. [CLEAN][demonstrated] .maat-state.json catalog-only vs 3dc2a99 (non-catalog identical, 35 other entries equal); THOTH-ADR-0001 parses, 7 rules, code tag
12. [CLEAN][code-traced] CHANGELOG QA-14 sentence, five-new-backlog-lines count, #219-#223 range accurate
13. [CLEAN][demonstrated] npm test 869/0/0 skipped 0; typecheck+lint clean; QA-15 PASS
counts: issues=4 suspicions=1 clean=8
evidence: demonstrated=8 code-traced=4 derived=1
checks=npm test 869 pass/0 fail/0 skipped (869/0/0); typecheck clean; lint clean; qa:completeness-claims PASS (2 files); ADR single-source query 14 names/1 hit
adr=HIT(36, whole catalog)
report=docs/reviews/fixture-single-source-of-truth-cross-domain-round2-2026-09-19.md
