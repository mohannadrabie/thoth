# Cross-domain re-confirm, round 2: s1-136-value-scoped-allowlist (Issues 136 and 203, Story S-B2)

[cross-domain-reviewer] Ra. Targeted re-confirm of the fix-now round, CRITICAL tier. Branch `fix/s1-136-value-scoped-allowlist`, HEAD aa2f0c8, delta `git diff 5156eff HEAD` (seven commits, eight files). Date 2026-09-19. Whole ADR catalog (37 entries) read unfiltered. Round-1 report: `docs/reviews/s1-136-value-scoped-allowlist-cross-domain-2026-09-19.md` (not edited).

Hygiene: counts and exit codes only. No secret-shaped literal, allowlisted value or hash of one, and no working shell payload appears here. Issue citations are word-form.

## 1. Lanes and ground

| Lane | Ground | Status |
|---|---|---|
| app-security-reviewer | exemption logic, unlock-command shell safety (Issue 239), report exposure, supply chain | report on disk, REWORK in round 1; its HIGH is the item the fix round addressed |
| code-reviewer | correctness, tests | report on disk, SHIP |
| red-team | adversarial | report on disk, no-go in round 1 (same HIGH) |
| design-challenger | pre-build | report on disk, go |
| this pass | seams, whole-catalog ADRs, rollback and coherence of the round-1 conditions | below |

Not re-listed: anything a lane already named (Issue 239 and its fix logic belong to the app-security and red-team lanes). Round-1 conditions re-checked here: the catalog served 6 of 8 rules (MED), the rollback left the suite red (LOW), and the carve-out question (derived, a human decision).

## 2. Instruments and raw output

### 2.1 Catalog parity (round-1 MED)
```
node docs/adr-cache.mjs --ensure   -> ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] (fp 60f0085) [CACHE=HIT]
parity script over adrCatalog.adrs (state file): catalog entries 37; THOTH-ADR-0002 status proposed, served rules 8, distinct served rules 8
body "Rules for agents" bullets 8 (all 8 carry MUST); each body bullet keyed to a served rule by a distinctive phrase: 8 of 8, at distinct rule indexes 0 to 7
frontmatter constraint lines (security 6 + code 2): 8
whole catalog: 35 ADRs have body rule bullets; ones serving fewer rules than their body lists: 3
   ADR-0017 (superseded) 5 of 9, ADR-0019 (accepted) 5 of 12, ADR-0021 (accepted) 11 of 16   (was 4; THOTH-ADR-0002 is no longer short)
git diff --stat 5156eff HEAD -- adr docs/adr docs/adr-cache.mjs docs/adr-template.md
   only docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md (17 insertions, 10 deletions)
   adr-cache.mjs, adr-template.md, every org ADR and the adr submodule pointer: untouched
docs/.maat-state.json delta: 3 hunks (counters 0 to 2, catalog version, the two added constraints); no other catalog entry changed, priorScope chain untouched
```
Was 6 of 8; now 8 of 8. The three remaining short ADRs are the systemic plugin defect already tracked in Issue 9 (reopened last round); nothing new here.

### 2.2 Rollback drills (scratch clones only, never the working tree)
The ADR now says: revert the whole story as one unit (merge commit with `-m 1`, or on an unmerged branch the range from `fefce23` through `62b95b2` plus the fix-round commits).
```
Drill A (the range stated in the ADR, code-carrying commits reverted newest first, 10 reverts, 0 conflicts):
   git diff --cached --stat 25291ff -- src docs/qa/secret-scan-allowlist.json      -> empty (identical to the base)
   node --test src/secret-scan/*.test.ts                                           -> tests 61, pass 61, fail 0, skipped 0
   history-scan CLI gate                                                            -> exit 0
Drill B (-m 1 merge simulation: merge the tip into the base with --no-ff, then git revert -m 1):
   revert exit 0; git diff --stat 25291ff HEAD -> empty; node --test src/secret-scan/*.test.ts -> tests 61, pass 61, fail 0, skipped 0
```
The round-1 figure was 42 pass and 19 fail when only the migration commit was reverted. Now green under both whole-story forms.

Drilled facts that should still hold:
```
Old loader reads the new file: clone at the base commit 25291ff, tracked allowlist replaced by the migrated file, history-scan CLI:
   exit 0, PASS, 0 blocking, 1535 allowlisted; control (legacy file, same old code): exit 0, 1535 allowlisted. Identical.
Damaged file repair (clone at HEAD, hook installed via core.hooksPath, no --no-verify anywhere):
   corrupted file (not JSON): history-scan exit 1, 1744 blocking, 0 allowlisted, a file-level REJECTED-ALLOWLIST-FILE line (not-valid-json) printed
   git commit with the corrupted file staged: exit 1 (refused; HEAD unchanged)
   generate --base 7b62344 --out <the file>: entries 50, dropped 0, value hashes 108; cmp with HEAD file: byte-identical
   git commit of an unrelated file with the hook on: exit 0 (PASS, 0 blocking, 274 allowlisted in the simulated tree)
```
One more fact, not part of the ADR claim: at HEAD, `git revert f77cd56` alone (the migration commit) no longer applies cleanly. It conflicts in `src/secret-scan/history-scan.ts` and on `src/secret-scan/allowlist-tool.ts` (modified by the fix round, deleted by the revert). Reproduced the old "19 of 61" at the reviewed commit 46e8d88 over the three named test files (history-scan, pre-commit-scan, allowlist-tool): tests 61, pass 42, fail 19. See Editorial.

### 2.3 Truth of the reworded verify and subset text (ADR, CHANGELOG, Addendum 2)
Code read, `src/secret-scan/allowlist-tool.ts` function `verifyMigration` (lines 205 to 270): every migrated entry sits on a legacy pair (else a problem), its reason must equal the legacy reason, every listed hash must be carried by a scanned match at that pair, an already value-scoped legacy entry must be unchanged, dropped legacy entries that still match are reported, and only then the newly-allowlisted and newly-blocking counts. The ADR, CHANGELOG and Addendum 2 sentences match this exactly.
```
sb2-verify-widening-is-always-also-caught-structurally: 5 legacy shapes x 5 migrated hash lists x 8 subsets of 3 scanned values = 200 cases over one pair, with a non-vacuity control (widenings reached > 0). Green.
allowlist-tool verify --base 7b62344 --migrated <file>: exit 0 PASS; legacy 50, migrated 50, dropped 0, hashes 108;
   occurrences allowlisted before 1540, after 1540; newly allowlisted 0; newly blocking 0; blessed by pattern: aws-access-key-id 12, email-address 23, github-fine-grained-pat 3, github-pat 2, internal-hostname 67, ipv4-private 1; under docs/reviews 57; credential-shaped 17
allowlist-tool generate --base 7b62344 --out <scratch>: 50 entries, 108 hashes; cmp with docs/qa/secret-scan-allowlist.json: byte-identical (exit 0)
Issue 240 pin, mutation check in a scratch clone (test sb2-generator-and-verify-scope-history-and-legacy-file-to-the-base-ref):
   control green (pass 1, fail 0); mutant 1 (generate scans HEAD not the base) red; mutant 2 (verify scans HEAD) red; mutant 3 (legacy file read at HEAD) red. "Red under three mutants" is exact.
Red-team "same zero": its report states newly allowlisted 0 at both bases by its own instrument.
```
"Always" in the ADR is backed by a bounded enumeration plus a per-pair independence argument, not an unbounded proof. It is exactly what the test enumerates, and the sentence says so ("enumerates it"). Fine as written.

### 2.4 Residual-row counts, spot-checked by instrument
```
12 of 108 blessed values use aws-access-key-id                     -> allowlist read: aws-access-key-id 12; total hashes 108   (row states 12 of 108: exact)
0 of 108 use generic-password-assignment or aws-secret-access-key  -> read: 0 hashes for both patterns                            (row states 0 of 108: exact)
0 duplicate pairs, 50 entries, 50 distinct pairs                    -> read: entries 50, distinctPairs 50                          (row exact)
aws-access-key-id regex                                             -> fixed AKIA prefix then 16 upper-case alphanumerics, no boundary either side (row exact)
NUL-skip row: blobs added or modified in 25291ff..HEAD: 47, with a NUL in the first 8000 bytes: 1 (the earlier version of the spike file);
   whole history: 1042 distinct blobs, 1 with a NUL in the first 8000 bytes (the same one)
   scanner patterns run over that blob with the skip lifted: 0 matches                                                              (row exact: "one blob", "0 scanner matches")
   the index-scoped test (git ls-files -s + one cat-file --batch, no working tree read) matches the row: the index, not older commits
loader unions duplicate hash lists (code: a Map of Sets in partitionAllowlisted), generator refuses duplicates (test case), verify reports two entries for a pair (code)  -> row exact
rejected diagnostic printed on a blocking run only (summarizeMatches); both live callers pass the loaded object straight through (history-scan main and pre-commit-scan) -> row exact
Issue 89 named exception: still in the ADR (Named exception section, and a residual row); Issue 89 is open, human-only; not agent-resolved
spike, at HEAD: history 219 commits, distinct triples 108, simulated tree 107, union 108 over 50 pairs, 50 of 50 grants match something, 0 non-granted triples
```

### 2.5 The fixed unlock command through the pre-commit path (round 1 drilled only well-formed paths)
Scratch repo, hostile-shaped file name (a space, a semicolon, a command-substitution shape, an ampersand), runtime-built synthetic literal, staged, real pre-commit CLI: exit 1; one NO-COMMAND-PRINTED line naming the path percent-encoded; 0 HASH-COMMAND lines carry the hostile name (the 9 command lines are for plain paths); the raw name appears only on the detail line, which is not a command. The hash-by-hand line names the tool usage. Both the CI and pre-commit CLIs share `summarizeMatches`, so the same code path serves both. There is no permanent test in `src/secret-scan/pre-commit-scan.test.ts` (untouched by the delta); the unlock lines for hostile names are tested through the CI CLI only. Same code, low risk; a coverage note (section 5), not a finding.

### 2.6 Named-test list regenerated by command
`git grep -h -o -E` over the secret-scan test files for test titles starting with sb2- or oss01- (the same command Addendum 2 prints), unique: 37 names. The list in Addendum 2, extracted from the plan by script: 37 names. `diff`: identical.

### 2.7 Sensitive-area boundary and the untouched set
```
git diff --stat 5156eff HEAD -- patterns.ts pre-commit-scan.ts simulated-commit.ts pre-commit-scan.test.ts ci.yml .githooks/pre-commit src/lib/git.ts docs/STATE.md docs/decisions.md CLAUDE.md docs/adr-cache.mjs docs/qa/secret-scan-allowlist.json adr
   -> empty diffstat (all untouched in this delta)
git diff --stat 25291ff HEAD, same list except pre-commit-scan.test.ts and the allowlist (the two files the earlier commits legitimately changed) -> empty
delta file list (8): CHANGELOG.md, docs/.maat-state.json, the ADR, the plan, and four files under src/secret-scan (allowlist-tool.ts, allowlist-tool.test.ts, history-scan.ts, history-scan.test.ts)
delta files under hooks/, src/policy/, the guard scripts, .github/, .thoth/, root gitleaks files: 0
allowlist at HEAD vs 5156eff: unchanged; byte-identical to generate --base 7b62344 (2.3)
```
CLAUDE.md is untouched, so the carve-out question stays a human decision. No fixture literal was added: the full-history gate passes at HEAD (0 blocking, 1749 allowlisted, exit 0) and the distinct-triple count did not move (108).

### 2.8 Bookkeeping
- `docs/.maat-state.json`: reviewRoundsSinceClean 2, reviewRoundsTotal 2, tier CRITICAL, scope intact; the only changes in the delta are those counters (0 to 2, the Manager update), the catalog version, and the two added constraint lines. No other catalog entry changed.
- `docs/run-log.jsonl`, `docs/REVIEW_LOG.md`, `docs/qa/recurring-findings-registry.md`, `docs/backlog.md`: none touched by the delta. Backlog additions against the base: 0 (two struck-through lines only, from the original story). Nothing added to the backlog this round, as the human constraint requires.
- CHANGELOG and Addendum 2 claims checked against the diff and the instruments above: the unlock-command text (safe set, NO-COMMAND-PRINTED, the by-hand line), the positive control that the old shape executes in the platform shell (present in the test), the Issue 240 pin with three mutants (2.3), the ten-pair cap and hash-subcommand tests (names present), the two verify tests, the object-database read for the binary-skip assurance and its ENOENT test (present), the verdict recaps (code SHIP, red-team no-go, app-security REWORK, cross-domain conditional), 937 passing (2.9). Exact.
- Issues 233 to 240 and 89 all exist and are open; 239 and 240 carry the S1 milestone and bug plus severity labels. Not re-filed.

### 2.9 QA gates and suite
```
QA-13  npm run qa:recurring-findings      exit 0  PASS 3 classes, all structurally valid
QA-15  npm run qa:completeness-claims     exit 0  PASS 2 files checked, all completeness claims verified
QA-14  reference-resolver origin/master 25291ff   exit 1  26 failing of 1387 (master baseline, stacked stories; Issue 229)
       reference-resolver 25291ff HEAD            exit 1  18 failing of 1014 (files this story touched)
       reference-resolver 25291ff 5156eff         exit 1  18 failing of 1005
       reference-resolver 5156eff HEAD            exit 1  14 failing of 741 (delta files)
       failing lines only in the HEAD run vs the 5156eff run: 0. Net-new failing citations from the fix round: 0; from the story: 0 (round 1).
npm test (first full run, while three other reviewers and my scratch drills ran in the same tree): tests 937, pass 936, fail 1, skipped 0.
   The one failure: the R4 fresh-clone test hit EBUSY removing its temp clone (a Windows file lock under heavy parallel load).
   That test is untouched by this story (the story hunks in that file sit at other lines), passed 2 of 2 in isolation, and the class is tracked in Issue 231.
npm test (second full run, tree quiet): tests 937, pass 937, fail 0, cancelled 0, skipped 0, exit 0.
npm run typecheck exit 0. npm run lint exit 0.
```
QA-15 also failed once (exit 1, one instrument produced no parseable number) while the first suite was running concurrently; it passed cleanly on a quiet rerun (exit 0). Same contention cause; no claim text changed in the delta.

## 3. Cross-domain ADR verdict (whole catalog, 37 entries, unfiltered)

| ADR | Verdict against the delta |
|---|---|
| THOTH-ADR-0002 (proposed, binds via the catalog per Issue 220) | Frontmatter and body now agree (8 of 8). Its eight rules and six positions checked against the code again: hash at match time over the matched bytes, invalid entries rejected, fail-closed loader (unreadable, unparseable or non-array), subset enforced structurally plus a zero count, no other exemption shape, report-directory exclusion removed, no diff to `patterns.ts`. Two prose points in its residual table are inexact (findings 1 and 2). No contradiction with the code. |
| devops ADR-0008 (ratchet-only) | Satisfied: verify PASS, 50 to 50, 0 newly allowlisted, 0 newly blocking. The time-bound clause deviation is stated in the ADR own position table: a human decision. No `--no-verify` path added (the repair drill also commits without it). |
| SE ADR-0001 | Satisfied: still `proposed`, never self-accepted. |
| SE ADR-0004 (re-runnable) | Satisfied, demonstrated: regeneration is byte-identical. |
| SE ADR-0005, SE ADR-0010 | Satisfied: the fix round only adds tests (37 named tests today, none removed); the comment-only edits change no assertion. |
| SE ADR-0006 (rollback) | Now satisfied: the stated procedure is drilled green (2.2). One inexact sentence remains (Editorial). |
| THOTH-ADR-0001 | Not applicable as a rule; precedent only. |
| SE ADR-0016, 0019, 0020, 0021; devops ADR-0009; remaining devops and SE entries | Not applicable to this delta (no hook, audit-log, cloud, data or tagging change). |

## 4. Findings

### Finding 1 [ISSUE][LOW][code-traced] A new normative MUST lives in a residual-table row, outside both served rule lists
- Evidence: `docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md` line 98 (moved-base row): "The regeneration pull request MUST state the count delta against the current totals". Instrument: an awk pass over the ADR body outside the frontmatter and outside the "Rules for agents" section lists every line with the word MUST: 4 lines. Lines 25 and 66 quote an org ADR rule; line 102 refers back to a rule above; line 98 is the one new normative statement. The served catalog entry has 8 rules and none says this. This is a recurrence of the round-1 MED class (a rule invisible to every catalog reader), at 1 of 9 rules instead of 2 of 8.
- Seam: ADR authoring format, the catalog builder, and every reviewer ADR read; a future regeneration by an implementer, who reads the catalog, will not see the requirement that guards the re-blessing residual.
- Exposure: 1 rule of 9 in this ADR unserved; applies only at a moved-base regeneration (frequency not measured), basis: counted (awk) for the rule, assumption for the frequency, so LOW.
- Minimal fix: add the sentence as a MUST bullet in "Rules for agents" and one constraint line in the frontmatter, then `node docs/adr-cache.mjs --ensure`; or, if it is not meant to bind, reword MUST to a plain statement.
- Failing test: none exists in the repo. The instrument is the awk command above, which reports 1 unserved normative MUST today and must report 0; a permanent form belongs with the plugin fix for Issue 9. The round-1 parity script does not catch it (it checks the rules section only).

### Finding 2 [ISSUE][LOW][code-traced] The trust-base residual names a reviewer rule whose glob does not match the files
- Evidence: the ADR line 103: "The protection is the named-reviewer rule for `src/secret-scan/*` and the reviewed-baseline guard." CLAUDE.md line 57 names the secret-scanning sensitive area scanner glob under the scripts directory, not the source directory. Instrument: `git ls-files` on the CLAUDE.md-named secret-scan glob, `.gitleaks.toml` and `.gitleaksignore` returns 0 tracked files; `git ls-files` on the source secret-scan glob returns 10. So no mechanical named-reviewer trigger covers the scanner files (Issue 234, already filed and cited in round 1); the review for this story exists because the Manager chose it. This is the row that tells the human what stops a pull request from changing the scanner and the allowlist together, so the claim matters to the accept decision.
- Exposure: one reader (the human deciding on the ADR), silently; the underlying gap is already tracked in Issue 234, so this is wording only; basis: counted (0 and 10), impact assumption, so LOW.
- Minimal fix: one clause: "the Manager CRITICAL-tier call for the scanner files (the CLAUDE.md glob does not yet name them: Issue 234) and the reviewed-baseline guard", and add Issue 234 to the References.
- Failing test: no executable form. It is a claim about a governance control, not behavior; the two `git ls-files` counts above are the instrument.

### Finding 3 [SUSPICION][LOW][derived] No CLAUDE.md carve-out for one-hash additions (carried from round 1, unchanged)
- CLAUDE.md is untouched by the delta, as required. The ADR residual still says a hash addition is reviewed by the pull request diff as in THOTH-ADR-0001, while CLAUDE.md carves that out only for the other fixture; the hard rule still asks for a fresh dated report for this area. A human decision (section 6), reasoned from documents only, so it cannot block.

### Seams checked and sound
4. [CLEAN][demonstrated] Catalog parity 8 of 8, catalog 37, cache HIT, adr-cache.mjs and every other ADR untouched (2.1).
5. [CLEAN][demonstrated] Rollback as now stated is green: whole-story range 61 of 61, `-m 1` simulation 61 of 61, both trees identical to the base (2.2).
6. [CLEAN][demonstrated] Drilled facts hold: an old loader reads the new file (exit 0, identical 1535 allowlisted); a damaged file fails closed (exit 1, 1744 blocking, named), is repaired by re-running generate at the base (byte-identical), and commits with the hook on and no `--no-verify` (2.2).
7. [CLEAN][demonstrated] The verify and subset wording is exactly true against the code and the 200-case enumeration; the "red under three mutants" claim is reproduced (2.3).
8. [CLEAN][demonstrated] Residual-row counts and the NUL row are exact by instrument (2.4).
9. [CLEAN][demonstrated] The Issue 239 fix holds through the pre-commit path with a hostile-shaped name (2.5).
10. [CLEAN][demonstrated] Sensitive-area boundary and the untouched set: empty diffstats; allowlist byte-identical to generate; gate 0 blocking; 108 triples (2.7).
11. [CLEAN][code-traced] Bookkeeping: counters 2 and 2 intact, only the catalog version and the two constraint lines changed in the catalog, backlog additions 0, CHANGELOG and Addendum 2 claims exact (2.8).
12. [CLEAN][demonstrated] QA-13, QA-15 pass on a quiet tree; QA-14 red on master with 0 net-new failing citations; suite 937 pass 0 fail 0 skipped on a quiet rerun (2.9).
13. [CLEAN][demonstrated] The regenerated named-test list equals the Addendum 2 list (37 names, `diff` identical) (2.6).

## 5. Coverage gaps
- The unlock lines for hostile names are permanently tested through the CI CLI only; the pre-commit CLI path was drilled here (2.5) but has no permanent test in the untouched pre-commit test file. Same shared function; intentionally low risk.
- The catalog-parity script exists only ad hoc (mine and the implementer); Addendum 2 says "checked by script" but no such script is in the repo, so a reader cannot re-run it. The permanent form belongs with the plugin fix for Issue 9. Not a finding.
- The CLAUDE.md sensitive-area globs (Issue 234) still name no path under the source secret-scan directory. Already filed.
- The code-reviewer, app-security and red-team lanes own the re-confirm of the Issue 239 fix logic itself; this pass covered only the pre-commit path and the wording.

## 6. Human decisions at the pull request (updated)
1. Accept or decline THOTH-ADR-0002 (status proposed; agents never accept). Its rules already bind reviewers through the catalog (Issue 220). Fix findings 1 and 2 first, or accept knowing them.
2. The named exception: one migrated value is the truncated prefix of what its report calls a real credential (Issue 89, open, human-only): accept as named, or rotate and remove it, after which the entry, its hash and its baseline pin are deleted in a follow-up.
3. The devops ADR-0008 time-bound clause deviation (value scoping instead of expiry), or route it as an amendment to the org ADR repository.
4. The Manager delegated design rulings, pending human ratification (the two newest 2026-09-19 decisions rows and Addendum 2): the R203-3 reading, one entry per path and pattern with a hash list, generator kept, ship with the ADR proposed, the permanent real-repo round-trip test dropped for cost, and now the fix-round dispositions (the wording of the subset claim, the residual rows, the rollback as one unit).
5. Whether to add a CLAUDE.md carve-out for one-hash additions, or state that the dated-report requirement stands (finding 3; agents do not edit CLAUDE.md).
6. Closing decisions: Issues 136, 203, 238, 239 and 240 (the CHANGELOG says closing is the human call); the Issue 89 disposition; Issue 9 (plugin catalog fix) stays open.
7. Merge order and rebase for the stacked pull requests; if the origin allowlist or fixtures move first, re-run generate and verify and state the count delta (108 hashes, 17 credential-shaped). Merging and pushing are human-only.

## 7. Editorial (verdict-neutral, plain edits, no re-review)
- ADR "Migration and rollback": "Reverting only the migration commit (`f77cd56`) restores loader and file together ... (drilled by cross-domain review: 19 of 61 secret-scan tests fail)". The 19 of 61 reproduces at the reviewed commit 46e8d88 over three test files; at HEAD that revert now conflicts in two files because the fix round edited them. Add "at 46e8d88; at HEAD it conflicts". The same sentence appears in the CHANGELOG and Addendum 2; harmless, since all three tell the reader not to do it.
- Addendum 2 says the ADR now pairs one-to-one "(checked by script)"; name the script or say "checked ad hoc".
- Round-1 editorial items (stale present-tense comments in `history-scan.test.ts`) were fixed by the comment-only commit, as the delta shows.

## 8. Verdict and next action
**APPROVE-WITH-CONDITIONS.** All three round-1 conditions are met or unchanged: the catalog now serves 8 of 8 rules (was 6 of 8), the whole-story rollback is drilled green (61 of 61 under both forms; was 42 pass and 19 fail), and the carve-out question stays with the human with CLAUDE.md untouched. No ADR violation, no cross-lane contradiction, the untouched set is untouched, nothing added to the backlog, gates green on a quiet tree (937, 0, 0). Two LOW ADR wording points remain, both one-clause edits (fix-now, no re-review): finding 1 (move the moved-base MUST into the served rule lists) and finding 2 (say the reviewer rule is a Manager call until Issue 234 lands). No new HIGH or MED, so no Issue is filed and no design council is convened.

Single next action: the Manager applies the two ADR edits, re-runs `node docs/adr-cache.mjs --ensure`, and hands the pull-request decisions in section 6 to the human.

Open findings 2, failing tests 1: finding 1 maps to the awk instrument (1 today, must be 0); finding 2 has no executable form (a claim about a governance control), stated above.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, ranked by blast radius):
1. [ISSUE][LOW][code-traced] docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md:98 -- the moved-base row carries a new normative MUST (regeneration pull request states the count delta) outside both served rule lists, so the catalog does not serve it (recurrence of the round-1 catalog-visibility class, 1 of 9 rules); fix: add it as a Rules-for-agents bullet plus a frontmatter constraint and re-run the cache, or reword MUST. Exposure: 1 of 9 rules unserved, applies only at a moved-base regeneration, basis: counted, frequency assumption
2. [ISSUE][LOW][code-traced] docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md:103 -- the trust-base row names the named-reviewer rule for the scanner files but CLAUDE.md:57 names a glob that matches 0 tracked files (the scanner lives in 10 files it does not name; Issue 234); fix: one clause saying it is the Manager tier call until Issue 234 lands, add Issue 234 to References
3. [SUSPICION][LOW][derived] CLAUDE.md carve-out for one-hash additions still absent (untouched, human decision carried from round 1)
4. [CLEAN][demonstrated] catalog parity 8 of 8 (was 6 of 8), 37 entries, cache HIT, adr-cache.mjs and all other ADRs untouched
5. [CLEAN][demonstrated] rollback as stated is green: whole-story range 61 of 61, -m 1 simulation 61 of 61 (was 42 pass, 19 fail), trees identical to base
6. [CLEAN][demonstrated] drilled facts hold: old loader reads new file (exit 0, 1535 allowlisted both), damaged file fails closed (exit 1, 1744 blocking), generate at base repairs byte-identical, commit passes with hook and no --no-verify
7. [CLEAN][demonstrated] verify/subset wording exactly true against code and a 200-case enumeration; Issue 240 pin red under three mutants (reproduced)
8. [CLEAN][demonstrated] residual-row counts exact: 12 of 108, 0 of 108, 50 entries 50 pairs, one NUL blob in all history with 0 matches
9. [CLEAN][demonstrated] Issue 239 fix holds through the pre-commit CLI with a hostile-shaped name (1 NO-COMMAND line, 0 commands carrying it)
10. [CLEAN][demonstrated] sensitive-area boundary and untouched set: empty diffstats vs 5156eff; allowlist byte-identical to generate --base 7b62344; gate 0 blocking; 108 triples
11. [CLEAN][code-traced] bookkeeping: counters 2/2 intact, only catalog version and two constraints changed, backlog additions 0, CHANGELOG and Addendum 2 claims exact
12. [CLEAN][demonstrated] QA-13/QA-15 pass, QA-14 red on master with 0 net-new (18 of 1014 both before and after the fix round); suite 937/0/0 on quiet rerun
13. [CLEAN][demonstrated] regenerated named-test list equals Addendum 2 (37 names)
counts: issues=2 suspicions=1 clean=10
evidence: demonstrated=9 code-traced=3 derived=1
checks=npm test run 1: 937 tests, 936 pass, 1 fail (R4 EBUSY temp-dir cleanup under parallel load, untouched test, passes 2 of 2 in isolation, Issue 231 class), 0 skip; run 2 (quiet): 937 pass/0 fail/0 skip exit 0; typecheck exit 0; lint exit 0; history-scan gate exit 0 (0 blocking, 1749 allowlisted); verify exit 0 (108 hashes, 0 newly allowlisted, 0 newly blocking); generate cmp byte-identical; spike 108 triples; QA-13 exit 0; QA-15 exit 0 (one contended run exit 1, quiet rerun exit 0); QA-14 exit 1 (18 of 1014 story scope, 0 net-new; master 26 of 1387); rollback drills A and B 61/61 pass; old-loader and repair drills pass; three-mutant check 3 red
adr=HIT(37, whole catalog)
report=docs/reviews/s1-136-value-scoped-allowlist-cross-domain-round2-2026-09-19.md
