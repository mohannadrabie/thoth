# s1-229-qa14-red — cross-domain review (Ra), 2026-09-21

[cross-domain-reviewer]
☀️ Cross-Domain Reviewer (Ra) — scanning the seams between reviewer lanes

- **Story:** GitHub Issue #229 (QA-14 red on every master CI run). Branch `fix/s1-229-qa14-red`, HEAD eae5451, base master 22b7141. Tier CRITICAL (ratified).
- **Method:** read-only. I ran the shipped gates myself; scratch outputs stayed in the session scratchpad, tracked files untouched (`git status` clean before and after).
- **Word-form rule (shared brief):** QA-14 scans this report in full. Standing example references are described by kind and count only; every path and issue number cited here is real.

📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp b588a48) [CACHE=HIT]

## 1. Lanes and ground covered

| Lane | Reviewer | Ground |
|---|---|---|
| Adversarial | red-team | scoping attacks: laundering through the move rule, paths that miss the diff parser, authored text under the mirror key |
| Correctness and tests | code-reviewer | `src/qa/reference-scope.ts`, `src/qa/reference-scope.test.ts`, the resolver hunks |
| Seams (this report) | cross-domain-reviewer | whole ADR catalog against the changed files; spec versus tool; process and doc seams; consumers of the changed output; Definition of Done |

I read no lane report. I checked the code and the artifacts.

## 2. Cross-domain ADR verdict (whole catalog, 37 ADRs, unfiltered)

Changed files (`git diff --name-status master...HEAD`): 11 files. Code: `src/qa/reference-scope.ts` (new), `src/qa/reference-scope.test.ts` (new), `src/qa/reference-resolver.ts` (35 lines). Docs and state: CHANGELOG.md, docs/STATE.md, docs/backlog.md, docs/decisions.md, docs/.maat-state.json, docs/run-log.jsonl, the plan and the build report.

| ADR | Verdict | Basis |
|---|---|---|
| devops ADR-0008 (CI gates, ratchet only) | NOT-APPLICABLE holds on its text; a closer call than the 2026-09-11 precedent (section 3) | `adr/devops/0008-cicd-gates-and-policy-as-code.md:135` |
| SE ADR-0005 (testing) | Complies | 38 new tests, each on its own mkdtemp repository; `git diff master...HEAD --stat -- src/qa/reference-resolver.test.ts` prints nothing (no test edited or deleted); the resolver test file still passes 85 of 85 |
| SE ADR-0010 (quality gates) | Complies | grep of both new files for lint or type suppressions, skips and sleeps: 0 hits; typecheck exit 0, lint exit 0; no threshold lowered; scope held (the STATE.md and backlog.md rewording is inside the Q3 ruling) |
| SE ADR-0003 (SOLID, injected I/O) | Complies | `src/qa/reference-scope.ts` performs no I/O; `diffText`, `readFile` and `shouldScan` are injected (header, lines 35-36) |
| SE ADR-0001 (record decisions) | Complies, labelled note | Plan D2 and the Manager ruled no new ADR; I concur the requirement text is the home. Note in section 3 |
| THOTH-ADR-0002 (proposed; OSS-01 allowlist shape) | No collision | Its "no other exemption shape" rule is scoped "for this gate" (`docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md:57`); this story adds nothing to OSS-01. Neither new narrowing is a value, glob or line-range grant: the added-text rule is a scan-scope rule keyed on file category, and a citation a diff adds is always checked |
| THOTH-ADR-0001 (central-classification fixture) | No collision | Its exception covers two lists in one JSON file and may not be cited elsewhere; it is not cited here |
| SE ADR-0002, 0004, 0006 to 0009, 0011 to 0015 | Not applicable | no domain layer, mutating operation, data, cost or monitoring surface |
| SE ADR-0016 to 0021 | Not applicable | governance-plugin port, kernel and normalizer architecture; the only "append-only" rule (0021) is about the runtime audit log, not the documentation records this story scopes |
| devops ADR-0001 to 0007, 0009, 0010 | Not applicable | IaC, tagging, cost; no infra changes. The OSS-01 full-history scan exits 0 with 0 blocking, so the new fixtures are clean |

## 3. The devops ADR-0008 question, read independently

I read the ADR in full and the archived 2026-09-11 row in `docs/decisions-archive.md` (line 46).

- **What the ADR covers.** The decision section enumerates its gates: seven IaC gates and a supply-chain table of six tools. The ownership table names those six tools. The "ratchet, don't rot" paragraph sits directly under that table and speaks of "gate thresholds and rule packs". QA-14 is in none of these lists. The 2026-09-11 reading (scoped to the named gate stack) still holds on the text.
- **What weakens the precedent here.** (1) The final MUST NOT at line 135 is unscoped: "MUST NOT lower gate thresholds, delete tests, or broaden suppression/ignore lists". (2) The catalog tags the ADR `pipeline` and `quality` as well as `cdk`. (3) The 2026-09-11 case changed how a citation is classified; this change narrows which text a CI gate reads, which is closer to an ignore list. (4) This repository's own practice treats the clause as reaching repo-authored gates: `docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md:68` states a position on the same clause for OSS-01 and asks the human to accept a stated deviation.
- **Against the three literal prohibitions.** No threshold lowered (QA-14's bar stays zero failures). No test deleted or weakened. The one arguable limb is "broaden ignore lists": two named scope narrowings were added (append-only records read as added text; the adrCatalog mirror cut out). Each carries its reason in code (`src/qa/reference-scope.ts:3-14`). Neither is time-bound; the approval act is the PR review.
- **Conclusion.** I cannot demonstrate a collision, so it stays NOT-APPLICABLE on the text. I record a labelled note (finding 3, LOW, derived, not a blocker): put a short position in the PR body, in the style of the THOTH-ADR-0002 table, so the human accepts the reading knowingly (no threshold lowered, no test deleted, two named narrowings each with a stated reason, no time bound, the PR approval is the exception act). Zero code.
- **SE ADR-0001 note (same PR-body line).** THOTH-ADR-0002 proposed an ADR for a new exemption shape on OSS-01. Ruling D2 chose the requirement text (amendment tracked in Issue #252) as the home for this one. Reasonable; the human should see the choice stated once.

## 4. Spec versus tool

The requirement is at `REQUIREMENTS.md:570`: "Every reference in a changed file". The tool now reads only the added text of five append-only record classes in diff mode, and cuts the adrCatalog mirror in both modes. The amendment is deferred by ruling D2 to Issue #252 (open, labels enhancement and qa; its body names the plan section that holds the amendment sentence and the 28 stale citations).

**Is the interim drift disclosed enough?** Yes, with one small gap.

| Where | Says | Verdict |
|---|---|---|
| `src/qa/reference-resolver.ts` header (4 added comment lines) | points to reference-scope.ts for what is checked | adequate pointer |
| `src/qa/reference-scope.ts:1-36` | full rules, reasons, fail-closed list, move rule | good; one inaccurate reason (Editorial a) |
| `docs/decisions.md:75` (Manager row) | rulings (c) to (e) and (j) | good; human ratification pending |
| `CHANGELOG.md` new entry | "What QA-14 no longer checks, stated for QA-16" and "Requirement text not amended here" | good |
| `REQUIREMENTS.md:570` | unchanged (ruling) | the drift is invisible to a reader of the requirement |
| Issue #252 | open, carries the amendment | exists, but see finding 2 |

**Gap (finding 2).** A `git grep` over the story's committed files finds no mention of Issue #252 (the number's only hit is inside an unrelated older row of the decision log). A maintainer who reads the code or the CHANGELOG learns the requirement is out of sync but not where it is tracked. One short clause in the CHANGELOG bullet and one line in the reference-scope.ts header close it.

**QA-16 (`REQUIREMENTS.md:572`, enforced by `src/qa/broken-instrument-gate.ts`).** What the code enforces: every id in `docs/qa/broken-instruments.json` (currently an empty array, so the gate exits 0 as a disclosed vacuous pass) must have a decision row containing the literal disable marker for that id, a valid date, and `Human ratified` = `Y`. QA-14 is not registered as broken or disabled, so the mechanical gate is not engaged. In spirit ("a recorded decision naming what is no longer checked"), row (e) of the newest decision row and the CHANGELOG bullet name the two classes of text no longer checked. The moved-line category (an added line identical to a removed line from a scanned file is not checked) is stated in ruling (d) and its own CHANGELOG bullet, not in the "no longer checked" list itself (Editorial f). If the row had to meet the mechanical bar it would not yet: its ratified cell is `pending`. That matches every other row of this delegated batch and is the human's PR-time act; if the human declines, the change reverts as one PR.

## 5. Seam findings

Ranked by exposure x irreversibility x silence. Nothing reaches HIGH or MED.

### Finding 1 — [ISSUE][LOW][demonstrated] the s1-237 entry's heading was destroyed in `CHANGELOG.md`

- Evidence: counting removed level-three heading lines in `git diff master...HEAD -- CHANGELOG.md` gives 1 (the removed line is the heading of the s1-237-nul-byte-scan entry). The count of level-three headings in CHANGELOG.md is 51 on master and 51 at HEAD although one entry was added. `CHANGELOG.md:21` (the last bullet of the new entry) ends with the tail of the old heading, and the s1-237 entry at line 23 now starts with no heading.
- Domains in tension: the story's DoD item (a CHANGELOG entry) against the record of the previous story. The edit that inserted the new heading consumed the old one.
- Exposure: ~0% of runs (no gate parses it), basis: counted in code. Silent, cosmetic, reversible.
- Minimal fix (fix-now, one docs edit): break line 21 after "same assertions." and restore the level-three "Fixed" heading with the s1-237 scope name in backticks in front of the orphaned tail. Check: the removed-heading count above then prints 0 and the heading total is 52.
- Executable form: the two counts above (no test exists for CHANGELOG structure; a one-line grep is proportionate).

### Finding 2 — [ISSUE][LOW][code-traced] no committed artifact names Issue #252

- Evidence: a `git grep` for the number over CHANGELOG.md, docs/decisions.md, docs/STATE.md, `src/qa/reference-scope.ts`, `src/qa/reference-resolver.ts`, the plan, the build report and docs/.maat-state.json returns one hit, in an unrelated older decision row. The row at `docs/decisions.md:75` says "a follow-up Issue carries it" without a number.
- Minimal fix (fix-now, docs and one comment): add the Issue number to the CHANGELOG bullet "Requirement text not amended here", and one sentence to the reference-scope.ts header saying the requirement text is not yet amended and is tracked there. It is a real number, so QA-14 resolves it.
- Exposure: ~0% of runs, basis: counted in code. The concern is silence: the drift is otherwise discoverable only by reading three documents.
- Executable form: a `git grep -c` for the number over CHANGELOG.md and `src/qa/reference-scope.ts` should report a hit in each; today neither does.

### Finding 3 — [SUSPICION][LOW][derived] the ADR-0008 and SE ADR-0001 positions are not stated for the human

- See section 3. A labelled note under the Manager's binding ruling, not a blocker. Resolves to a residual-register line: the PR body states the positions. No failing test exists for a decision that belongs to the human.

### Finding 4 — [SUSPICION][LOW][derived] the premise of the design-challenger skip changed during the build

- Ruling (i) skipped design-challenger because the change was "about 80 lines of pure functions" with every attack an enumerable test. The shipped module is 357 lines, of which about 75 are a hunk-count diff parser (`src/qa/reference-scope.ts:82-175`) and about 65 a JSON tokenizer (`src/qa/reference-scope.ts:177-277`). The three red-team questions were written for the 80-line version; parser desynchronisation and tokenizer edge cases (escapes, nesting, duplicate keys) are new attack surface that only the post-build red-team pass covers. I ran the module's 38 tests six more times: 6 of 6 runs passed 38 of 38, so this is a coverage question, not a defect. Resolves to: the Manager confirms red-team's report addresses the parser and the tokenizer.

## 6. The Manager's size question: is each block justified?

**Hunk-count diff parser (about 75 lines): justified under the plan constraint.**

- The only diff source is the existing `diffText` (the whole diff, all files), and the plan froze `src/lib/git.ts`.
- Consuming hunk bodies by their header counts is what stops an added content line shaped like a file header from re-targeting attribution; the tests pin it.
- Simplest safe alternative, if a one-method addition to `src/lib/git.ts` were allowed (build-report follow-up F2 already wants that file touched): a per-file diff with zero context lines, treating everything after the first hunk marker as content. No header or path parsing remains; that deletes most of the 75 lines and closes the "cannot attribute a path" class on the diff side. Cost: one git call per scoped file.
- Recommendation: keep it now (tested against real git, mutation-checked) and file the simplification with F2.

**adrCatalog tokenizer (about 65 lines): leaning liability; keep or swap is the Manager's call.**

- It guards one thing: a duplicate key in a machine-generated state file, which only a deliberate committer can create. Its failure direction is fail-open (a mis-skip hides authored text).
- Simplest safe alternative: parse, delete the mirror along the priorScope chain, re-serialise (about 15 lines), fail closed on a parse error. Accepted cost: a duplicate key collapses last-wins.
- Given the human's stated preference (simplicity over polish; drop a nice-to-have rather than add complexity), I would swap, invert the one duplicate-key test in the new file (a test the same story wrote, unmerged) and record the limitation.
- It is not a defect today: the tokenizer runs only on input that JSON.parse already accepted, and it is mutation-checked. If red-team finds any tokenizer flaw, the swap becomes the fix.

## 7. Process and document seams (checked; sound unless a finding says otherwise)

- **State transition.** I parsed master and HEAD versions of `docs/.maat-state.json`. HEAD priorScope deep-equals master root except that `adrCatalog` stays on the root only (identical object). Chain depth 17 to 18. New root fields: scope, tier CRITICAL, zero counters, one dated note key; earlier transitions use the same shape and note-key convention. Three `adrCatalog` objects at HEAD (root, depth 2, depth 4), matching the plan "three copies".
- **Run log.** One added line: a tier-ratified event for the scope, same field set as the earlier tier-ratified lines. The story-shipped line is the Manager's close-out.
- **Decision-row claims against the shipped code.** Reproduced with the shipped resolver: 28 stale citations in REQUIREMENTS.md (full tree); full-tree total 182 = 110 in docs/reviews (immutable) + 72 elsewhere, exit 1. The row statement of what QA-14 no longer checks is true of the code for both classes. I did not re-run the 22b7141 replay (26 to 6 to 1); the build report legs 1 and 2 match the plan's spike, and the diff-mode run below exits 0.
- **The edit to the Manager ruling row.** `git diff bd0541e..HEAD -- docs/decisions.md` shows two bare file names in backticks given their docs/ prefix; no ruling text changed. Acceptable: the row is new on this branch (not on master, so no merged history was altered), the meaning is unchanged, it was needed for AC9 (a bare name did not resolve and the row is new text the gate must check), and the build report discloses it. Worth keeping: the Manager's own new row failed the new gate until fixed, which is the accepted residual working as designed. The report says one token; two tokens changed (Editorial c).
- **STATE.md as it is now.** The story diff rewords three sentences and keeps every number. "Last updated" still reads the s1-237 close-out; the s1-229 resume point is the Manager's close-out edit. Deferred to the Manager, not a finding.
- **CLAUDE.md hard rules.** No push, merge or apply; no secrets (OSS-01 exit 0); tests ship with the feature; no gold-plating (follow-ups F1 to F6 are named, not built); no hand-derived completeness claim found except the CHANGELOG mutation count (Editorial b); no listed sensitive path edited.
- **Is a QA-14 instrument change in a listed sensitive area?** By path, no: the list names `.github/workflows/ci.yml`, `.gitleaks.toml`, `scripts/secret-scan/*` and the hooks and guard trees; `src/qa/*` is not listed and `src/lib/git.ts` is untouched. By heading ("Secret scanning / CI gates") a reader could argue QA-14 is a CI gate. It does not change the outcome: CRITICAL was chosen on gate-integrity grounds, and this round produces the fresh dated reports the hard rule asks for either way. No reclassification proposed.

## 8. Seams the lanes cannot see

- **Consumers of the new file suffix.** A `git grep` for the failure-line shapes and the resolver name across scripts, workflows, tests and docs finds no parser of these lines. The only CI use is the exit code (`.github/workflows/ci.yml:231`). QA-15 registers the resolver as a known instrument (`src/qa/completeness-claim-checker.ts:50`) but no marker in the tree cites it, so its output format is not consumed. The resolver's own 85 tests are unmodified and pass. Clean.
- **Other CI gates.** I ran QA-01, QA-02, QA-05, QA-13, kernel-purity, normalizer-purity and the three S5 gate checks: all exit 0 (three are disclosed vacuous passes, pre-existing). QA-15 exit 0 (2 files checked), QA-16 exit 0 (vacuous, pre-existing), typecheck and lint exit 0, OSS-01 history scan exit 0 with 0 blocking.
- **CI range semantics.** CI runs on push to master and on pull requests to master only (`.github/workflows/ci.yml:14-19`), so the full-tree fallback (which needs the all-zero before value) cannot occur in normal CI; ruling Q1 matches what CI performs. `diffText` and `diffNameOnly` use the same three-dot range (`src/lib/git.ts:125-132`), and checkout fetches full history, so a name-only success implies the diff succeeds; a failure falls back to whole-file scanning. On pull requests the checkout is the merge commit while the diff range ends at the PR head sha; added text therefore comes from the PR's own commits, the more conservative source. No worse than before for whole-file scanning.
- **Diff mode over this branch.** `node src/qa/reference-resolver.ts master HEAD`: exit 0, 567 citations, 448 resolved, 119 unclassified (non-blocking), 0 failed. Every failure or unclassified line now names its file (six files in the run).
- **Definition of Done.** CHANGELOG entry present (heading defect, finding 1). STATE.md: Manager close-out pending. Tests real: 123 of 123 across the two QA-14 test files, 0 skipped. Working tree clean at eae5451.
- **Durability of the fix (label only; ruling Q2 and residual (j) accepted).** The build report measured 15 merges: 0 green with the mechanism alone, 3 green with STATE.md and backlog.md cleared; the rest fail on new review reports that quote examples. Keeping master green after this PR therefore depends on reviewers writing example references in word form, which PRINCIPLES rule 10 (verbatim raw output) pulls against. Build-report follow-up F5 is the durable home; I suggest the Manager files it as an Issue rather than leave it a proposed line. Not a finding.

## 9. Coverage gaps named

- **docs/run-log.jsonl, docs/qa/*, older dated plans:** append-mostly, not in the scoped set, currently clean in diff mode (the run above passes with the run log changed). Low risk; no lane claims them and they need none.
- **Non-ASCII file names in diff mode (`src/lib/git.ts`):** pre-existing, already routed by the Manager; this diff neither worsens it nor newly depends on it (the parser only sees files that passed the name filter).
- **Cross-platform run of the new subprocess tests:** all my runs are Windows. CI is ubuntu; the fixtures use plain git in a temp directory, so I expect parity, but I did not verify it. The first CI run of the PR settles it.
- **Ratification flips (residual, disclosed in the CHANGELOG and the plan):** editing an old decision row in place re-scans that row whole. Several still-pending rows carry standing examples, so flipping one of them from pending to ratified will redden that PR until the row is reworded. Disclosed; listed so the human is not surprised.

## 10. Brief claims verified against the repo

| Claim | Result |
|---|---|
| Empty diffs for ci.yml, src/lib/git.ts, REQUIREMENTS.md, CLAUDE.md, hooks, src/secret-scan | `git diff --name-only master...HEAD` over those paths plus docs/adr, adr, docs/qa, .githooks, package.json and the resolver test file: 0 lines |
| docs/reviews has no modified, deleted or renamed file | `git diff --diff-filter=MDR --name-only master...HEAD -- docs/reviews`: 0 lines |
| Story commits bd0541e to eae5451 | nine commits, matches the log |
| 11 files changed; resolver diff is the header pointer, import, file field, suffix, pass-2 tag and one main() call | matches `git diff master...HEAD -- src/qa/reference-resolver.ts` |

## 11. Editorial (verdict-neutral; plain edits, no re-review)

- a. The stated reason for the mirror cut ("ADR files this repository does not author": `src/qa/reference-scope.ts:11-14`, the decision row, the CHANGELOG) is inaccurate for 2 of the 37 catalog entries: the catalog roots include `docs/adr`, whose two ADRs this repository authors. Coverage is unaffected (those source files are scanned whenever they change; the mirror only copies them).
- b. The CHANGELOG says "Nine mutations"; the build report table lists 12 mutations that turned a test red plus 2 equivalent ones, and the runner is not committed.
- c. The build report says one token of the decision row changed; two file names changed.
- d. Plan section 5 says full-tree mode stays whole-file everywhere; the shipped mirror cut also applies in full-tree runs (stated in the module header, line 14, and reflected in the build-report residual table).
- e. Ruling (i) in the decision row still says "about 80 lines"; the shipped module is 357.
- f. The decision-row "what QA-14 no longer checks" list omits the moved-line category (it is in ruling (d)).

## 12. Verdict

**APPROVE-WITH-CONDITIONS.** I found no ADR collision and no seam defect that can fail a gate or hide a citation. Conditions:

| # | Condition | Timing |
|---|---|---|
| 1 | Restore the s1-237 heading in `CHANGELOG.md` (finding 1) | fix-now (one docs edit) |
| 2 | Name Issue #252 in the CHANGELOG bullet and the reference-scope.ts header (finding 2) | fix-now (docs and one comment) |
| 3 | PR body states the ADR-0008 and SE ADR-0001 positions for the human (finding 3) | deferred to PR time, no diff change |

Open findings: 4 (2 issues, 2 suspicions). Failing tests: 0. They differ because none has a test form: findings 1 and 2 are doc defects with the one-line counts given above (both currently failing: 1 removed heading, 0 mentions of the tracker); findings 3 and 4 are human or Manager decisions with no executable form.

**Single next action:** the implementer makes the two small docs edits (findings 1 and 2) in one commit and re-runs `node src/qa/reference-resolver.ts master HEAD` (expect exit 0); then the Manager records this round.

Not verified: behaviour on an ubuntu runner; the 22b7141 replay legs; the red-team and code-reviewer conclusions (not read).

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by blast radius):
1. [ISSUE][LOW][demonstrated] CHANGELOG.md:21 — the s1-237 entry heading was consumed when the new entry was inserted (removed-heading count 1; heading total 51 before and after despite one added entry); restore the heading (fix-now, docs edit)
2. [ISSUE][LOW][code-traced] CHANGELOG.md and src/qa/reference-scope.ts header — no committed artifact names Issue #252, so the interim spec-versus-tool drift has no pointer to its tracker; add the number (fix-now, docs and one comment)
3. [SUSPICION][LOW][derived] adr/devops/0008-cicd-gates-and-policy-as-code.md:135 — NOT-APPLICABLE holds on the text but is a closer call than the 2026-09-11 precedent (unscoped MUST NOT, pipeline tag, narrowing is close to an ignore list, THOTH-ADR-0002 states a position for OSS-01); state the ADR-0008 and SE ADR-0001 positions in the PR body for the human (deferred, no code)
4. [SUSPICION][LOW][derived] src/qa/reference-scope.ts:82-277 — the design-challenger skip premise (about 80 lines) no longer holds (357 lines: parser plus tokenizer); confirm red-team covered parser desync and tokenizer edges
5. [CLEAN][demonstrated] no script, test, workflow or dashboard parses the new file suffix on failure lines; resolver tests 85 of 85 unmodified and green; QA-15 cites the resolver by name only, no marker uses it
6. [CLEAN][demonstrated] every other CI QA gate, QA-15, QA-16, typecheck, lint and the OSS-01 history scan exit 0 at eae5451 (3 disclosed vacuous passes, pre-existing)
7. [CLEAN][demonstrated] the brief's empty-diff claims verified: protected paths 0 lines, docs/reviews modify/delete/rename 0 lines
8. [CLEAN][demonstrated] docs/.maat-state.json transition (priorScope deep-equals master root, adrCatalog root-only and identical, depth 17 to 18) and the run-log tier-ratified line match earlier transitions
9. [CLEAN][demonstrated] decision-row and build-report figures reproduced with the shipped resolver: 28 stale REQUIREMENTS.md citations, full tree 182 = 110 + 72, diff mode master..HEAD exit 0 with 0 failed
10. [CLEAN][code-traced] THOTH-ADR-0001 and THOTH-ADR-0002: neither the added-text scope nor the mirror cut is an exemption shape they forbid (0002 is scoped to OSS-01; 0001 is not cited)
11. [CLEAN][demonstrated] SE ADR-0005 and SE ADR-0010: no test deleted or weakened (resolver test file diff empty), no suppression, skip or sleep in the new files, 123 of 123 tests pass, 0 skipped
12. [CLEAN][code-traced] QA-16 (REQUIREMENTS.md:572, src/qa/broken-instrument-gate.ts): mechanical gate not engaged (empty registry); the recorded-decision spirit is met by row (e) and the CHANGELOG bullet, ratification pending
13. [CLEAN][code-traced] CI range semantics: push and pull_request on master only, so full-tree cannot occur in normal CI; diffText and diffNameOnly share one three-dot range; failure falls back to whole-file
14. [CLEAN][code-traced] the implementer's edit to the Manager's ruling row is acceptable (row new on this branch, prefix-only, disclosed); it also shows the residual working as designed
15. [CLEAN][code-traced] sensitive-area judgment: src/qa/* is not a listed path; CRITICAL chosen on gate-integrity grounds; this round's dated reports satisfy the hard rule either way
16. [CLEAN][demonstrated] six repeat runs of the new test file: 6 of 6 exit 0, 38 of 38 each; no cleanup flake of the kind tracked in Issue #231
counts (a CHECKSUM): issues=2 suspicions=2 clean=12
evidence (a CHECKSUM): demonstrated=8 code-traced=6 derived=2
checks=node --test on the two QA-14 test files: tests 123 pass 123 fail 0 cancelled 0 skipped 0 todo 0 exit 0; reference-scope test file x6: 38/38 each exit 0; QA-14 diff mode (master HEAD) exit 0 (567 citations, 0 failed); QA-14 full tree exit 1 by design (182 failed: 110 docs/reviews + 72 other); QA-15 exit 0; QA-16 exit 0 (vacuous, pre-existing); OSS-01 history scan exit 0 (0 blocking); typecheck exit 0; lint exit 0; QA-01, QA-02, QA-05, QA-13, kernel-purity, normalizer-purity and 3 S5 gate checks all exit 0
adr=HIT(37, whole catalog)
report=docs/reviews/s1-229-qa14-red-cross-domain-2026-09-21.md
