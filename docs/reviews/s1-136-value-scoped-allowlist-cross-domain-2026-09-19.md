# Cross-domain review: s1-136-value-scoped-allowlist (Issues 136 and 203, Story S-B2)

[cross-domain-reviewer] Ra. Standing pass, CRITICAL tier. Branch `fix/s1-136-value-scoped-allowlist`, reviewed HEAD 46e8d88, diff base 25291ff (stacked on the s1-135 and s1-226 branches). Date 2026-09-19. Whole ADR catalog read unfiltered.

## 1. Lanes and ground covered

| Lane | State when this report was written | Ground |
|---|---|---|
| app-security-reviewer | Report on disk: `docs/reviews/s1-136-value-scoped-allowlist-app-security-2026-09-19.md`, verdict REWORK, one HIGH (Issue 239, the printed unlock command executes an attacker-named path when pasted) | exemption logic, report-file exposure, supply chain, named exception, ADR-0008 ratchet, CLI shell safety |
| code-reviewer | No report on disk yet | correctness, tests |
| red-team | Attacking the built gate in parallel | adversarial |
| design-challenger | Round 1 report on disk, verdict go | pre-build design |

Not re-listed here (a lane already named it): Issue 239 (HIGH, app-security). It shares its sink with Issue 238 (quote handling in the same printed command), which Issue 239 makes worse than Issue 238 states; the app-security report says the same.

## 2. Instruments and raw output (counts and exit codes only)

Every completeness statement below comes from a command run in this session. No secret-shaped literal, allowlisted value or hash of one is quoted anywhere in this report.

### 2.1 Sensitive-area boundary
```
git diff --stat 25291ff HEAD -- <the nine must-stay-untouched paths> | cat     -> no output (empty diffstat)
git diff --name-only 25291ff HEAD | grep for hooks/, src/policy/, .github/, .thoth/, root gitleaks files  -> 0 lines
git diff --name-only 25291ff HEAD | grep -E '^(src/secret-scan/|docs/qa/secret-scan-allowlist\.json)'
  docs/qa/secret-scan-allowlist.json
  src/secret-scan/allowlist-tool.test.ts
  src/secret-scan/allowlist-tool.ts
  src/secret-scan/history-scan.test.ts
  src/secret-scan/history-scan.ts
  src/secret-scan/pre-commit-scan.test.ts
```
The nine untouched paths are `src/secret-scan/patterns.ts`, `src/secret-scan/pre-commit-scan.ts`, `src/secret-scan/simulated-commit.ts`, `.github/workflows/ci.yml`, `.githooks/pre-commit`, `src/lib/git.ts`, `docs/STATE.md`, `docs/decisions.md`, `CLAUDE.md`. Result: empty diffstat. The literal secret-scan globs in CLAUDE.md match 0 changed files, because they name paths that are absent from the tree (Issue 234, already filed; not worsened, one more file now lives in the unnamed `src/secret-scan/` area). The gate here is the dated reports for this chain, which exist for the design-challenger and app-security lanes.

### 2.2 Readers and writers of the allowlist and the old entry shape
`git grep -n -I -E "secret-scan-allowlist|partitionAllowlisted|loadAllowlist|isValidAllowlistEntry|AllowlistEntry"` over the whole repo, minus dated reports and machine logs. Code consumers: `src/secret-scan/history-scan.ts`, `src/secret-scan/pre-commit-scan.ts`, `src/secret-scan/allowlist-tool.ts`, three test files, and the spike script. Callers by name: `package.json` scripts `oss:secret-scan` and `oss:pre-commit-scan` (unchanged command lines), `.github/workflows/ci.yml` (run step plus the report upload, unchanged), `src/qa/completeness-claim-checker.ts` (registers the same scan command, unchanged), `.githooks/pre-commit` (execs the pre-commit CLI, unchanged). `REQUIREMENTS.md` OSS-01 states the goal (full history scanned) and says nothing about entry shape, so it is not stale. `README.md` has no allowlist text. The only place the report-file schema is read is the CI upload (a gitignored artifact); nothing parses it.

Stale present-tense prose about the old semantics (editorial, section 7): `src/secret-scan/history-scan.test.ts` lines 124, 133, 142, 191, 210, plus the test title at line 38, and one comment in `src/secret-scan/patterns.test.ts` line 77.

### 2.3 Migration reproducibility and non-widening
```
node src/secret-scan/allowlist-tool.ts generate --base 7b62344 --out <scratch>      exit 0
   entries written: 50 (carried already-scoped: 0), dropped as matching nothing: 0, value hashes: 108
cmp <scratch> docs/qa/secret-scan-allowlist.json                                    exit 0  (byte-identical)
git show f77cd56:docs/qa/secret-scan-allowlist.json | cmp - docs/qa/secret-scan-allowlist.json   exit 0 (no later edit)
node src/secret-scan/allowlist-tool.ts verify --base 7b62344 --migrated docs/qa/secret-scan-allowlist.json   exit 0
   PASS; legacy entries: 50, migrated entries: 50, dropped: 0, value hashes: 108
   occurrences allowlisted before: 1540, after: 1540; newly allowlisted: 0; newly blocking: 0
   blessed by pattern: aws-access-key-id=12, email-address=23, github-fine-grained-pat=3, github-pat=2, internal-hostname=67, ipv4-private=1
   blessed under docs/reviews/: 57; blessed credential-shaped: 17
```
The committed allowlist is exactly what the generator emits from the legacy file at the base (SE ADR-0004, re-runnable and deterministic). Entry keys are `path, patternId, reason, valueSha256` for all 50, hashes sorted and unique in each entry, no reason text changed (0 changed reason lines in the diff).

Credential-shaped grants against `REVIEWED_BASELINE` (parsed from the test file, counts only): 15 grants, 17 blessed hashes, 15 baseline keys, 0 grants with no baseline key, 0 pinned hashes missing from the allowlist, 1 blessed hash not pinned. The one unpinned value belongs to `docs/STATE.md` x `aws-access-key-id`, whose baseline is intentionally zero-tolerance (empty list); its reason states it quotes a command naming a historical literal. It exists only in history, and the live-text guard would fail if it reappeared in the current file. Coherent, not a finding.

### 2.4 Stacked-branch validity and the moved-base residual (design-challenger A9)
```
git diff --quiet origin/master 25291ff -- docs/qa/secret-scan-allowlist.json      exit 0  (master's allowlist == this branch's legacy file)
git diff --quiet origin/master 25291ff -- src/secret-scan/patterns.ts             exit 0
node docs/spikes/s1-136-value-triples-2026-09-19.mjs   (at HEAD, 207 commits)
   history distinctTriples=108; simulated pre-commit tree distinctTriples=107; union distinctTriples=108 distinctPairs=50
   allowlistEntries=50; grants matching something: 50 of 50; non-granted triples (would block today): 0
node src/secret-scan/allowlist-tool.ts verify --base origin/master --migrated docs/qa/secret-scan-allowlist.json   exit 0
   PASS; before 1458, after 1458; newly allowlisted 0; newly blocking 0; all 108 hashes carried by a real match on master's history
node src/secret-scan/history-scan.ts                    exit 0  (PASS, 0 blocking, 1665 allowlisted)
```
The two earlier stacked branches (s1-135 test additions, s1-226 probe validators) introduced no new distinct (path, pattern, value) triple: the union over every commit reachable from HEAD is still 108, the base figure. The migrated file therefore verifies against master's own history as well, so merging the stacked PRs in either order, or by squash, keeps it valid. Origin master has not moved since the base (its allowlist file equals the legacy file). The residual stays exactly as the ADR states: a fixture literal or allowlist edit landing on the default branch first makes CI red until `generate --base <ref>` is re-run; it fails closed. Local `master` is behind `origin/master`; the comparisons above use `origin/master`.

### 2.5 The unlock command through the pre-commit path
The plan tests the printed unlock command only through the CI history-scan CLI. In the pre-commit CLI the printed commit is the dangling simulated commit. Scratch drill (new repo, runtime-built synthetic literal, staged, pre-commit CLI run): blocked exit 1; a HASH-COMMAND line for the pair printed; that command run in the platform shell exited 0 with empty stderr; the hash it printed equals an independent sha256 of the literal; after adding it to the entry the pre-commit CLI exited 0. The abbreviated dangling commit resolves. Clean for well-formed paths. (The path-quoting defect is Issue 239 and Issue 238.)

### 2.6 Tests not deleted or weakened (SE ADR-0005, SE ADR-0010)
Test names extracted from base and HEAD for `history-scan.test.ts` and `pre-commit-scan.test.ts`: removed names 0 in both (history-scan 21 to 41, pre-commit 13 to 19); `assert.` occurrences in `history-scan.test.ts` 40 to 113. The lines removed from that file are fixture-shape edits, the dogfood test now loading through `loadAllowlist`, and the removal of the report-directory exclusion (Issue 203). The X1 flip (one fixture expectation) strengthens the guard, as the issue asks. The permanent real-repo round trip the plan once listed was dropped in commit 62b95b2; it never existed at base, so nothing that existed was deleted. The dogfood test in the suite already runs the real allowlist over the real history through the real loader, and CI runs the CLI on the same file.

### 2.7 QA gates
```
npm run qa:recurring-findings   exit 0   PASS: 3 recurring finding class(es) logged, all structurally valid   (QA-13)
npm run qa:completeness-claims  exit 0   PASS: 2 file(s) checked, all completeness claims verified            (QA-15)
node src/qa/reference-resolver.ts origin/master 25291ff   exit 1   26 failing of 1386 citations (master baseline, stacked stories)     (QA-14)
node src/qa/reference-resolver.ts 25291ff HEAD            exit 1   18 failing of 921 citations (files this story touched)
node src/qa/reference-resolver.ts origin/master HEAD      exit 1   30 failing of 1662 citations
```
QA-14 is red on master (Issue 229). Of the 18 failing citations in this story's files, 0 are net-new: each failing token already occurs in the base text of its file (two appear on "added" lines only because the state file is re-indented one level, so its old note text shows as added). This story adds no failing citation. QA-14 output is reported as counts and exit codes only.

### 2.8 Suite
`npm test`: tests 929, pass 929, fail 0, cancelled 0, skipped 0 (exit 0). `npm run typecheck` exit 0. `npm run lint` exit 0. Matches the CHANGELOG figure of 929 passed, 0 failed, 0 skipped.

### 2.9 Rollback drill (SE ADR-0006)
A scratch worktree at HEAD, `git revert --no-commit f77cd56` (the migration commit, exactly the procedure the ADR, plan and CHANGELOG name), then `node --test` over the three secret-scan test files: tests 61, pass 42, fail 19, skipped 0. See finding 2.

### 2.10 Catalog parity (ADR frontmatter vs body)
Script over `adrCatalog.adrs`: 7 ADRs carry both a frontmatter `constraints` block and a `Rules for agents` section; 4 serve fewer rules in the catalog than their body lists: ADR-0017 (superseded) 5 of 9, ADR-0019 (accepted) 5 of 12, ADR-0021 (accepted) 11 of 16, THOTH-ADR-0002 (proposed) 6 of 8. THOTH-ADR-0001 is 7 of 7. See finding 1.

## 3. Cross-domain ADR verdict (whole catalog, 37 entries, unfiltered)

Cache: `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp e63297b) [CACHE=HIT]`. THOTH-ADR-0002 is in the catalog (id, status `proposed`, applicableTo security/architecture/code, 6 constraints), the catalog gained exactly that one entry and no existing entry changed, and the state file's `priorScope` chain equals the previous state minus its catalog (chain preserved). Per Issue 220 the catalog serves a proposed ADR's rules like an accepted one's; this report treats THOTH-ADR-0002 as binding accordingly and notes its status.

| ADR | Verdict against the diff |
|---|---|
| devops ADR-0008 (ratchet-only) | Satisfied: verify PASS, 50 to 50 entries, 0 newly allowlisted, 0 newly blocking. Time-bound-exception clause is a stated deviation in THOTH-ADR-0002's own position table: a human decision, not a blocker. Gitleaks row: not the same subject (own scanner). No `--no-verify` path added. |
| SE ADR-0001 | Satisfied: the ADR is drafted as proposed and never self-accepted; frontmatter valid (id, title, status, date, applicableTo, constraints). |
| SE ADR-0004 (re-runnable) | Satisfied, demonstrated: regenerating from the base is byte-identical (2.3). |
| SE ADR-0005, SE ADR-0010 | Satisfied: no test deleted or weakened (2.6). |
| SE ADR-0006 (rollback) | Rollback is stated but the named procedure leaves a red suite (finding 2). |
| THOTH-ADR-0001 | Not applicable as a rule (a different allowlist); the ADR uses it as precedent and does not extend it. |
| SE ADR-0016, 0019, 0020, 0021; devops ADR-0009 | Not applicable: none names the OSS-01 scanner, the allowlist, hooks or CI gates in a way this diff touches (the audit-log and port-fidelity rules concern the audit-log hook and ported files, both untouched). |
| Remaining devops and SE entries | Not applicable (cloud, data, tagging, CDK, monitoring). |
| THOTH-ADR-0002 vs code | Each of its eight body rules and six constraints checked against the code and tests: hash at match time over the matched bytes, invalid entries rejected, fail-closed loader (file-level problems return no entries), report hashes only for allowlisted matches, no other exemption shape, report-directory exclusion removed, no diff to `patterns.ts`. No contradiction with the code or the plan addendum found. |

## 4. Findings

### Finding 1 [ISSUE][MED][demonstrated] The ADR catalog serves 6 of THOTH-ADR-0002's 8 body rules
- Evidence: `docs/adr-cache.mjs:173` builds rules from the markdown `Rules for agents` section only when the frontmatter produced none, so a frontmatter `constraints` block wins and the body bullets are dropped. Catalog rules for THOTH-ADR-0002: 6. Body `Rules for agents` MUST bullets: 8 (`docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md`). The two absent are the migrated-set subset rule and the loader-fails-closed rule; I checked both against the code by hand and both hold, so this is a visibility gap, not a violation. Whole-catalog script (2.10): 4 of 7 dual-format ADRs are affected, including two accepted ones.
- Seam: ADR authoring format, the catalog builder, and every reviewer's ADR read. Each lane reads a compressed catalog; a rule that is only in the body is invisible to all of them, and to this pass.
- Recurrence: this is Issue 9 (closed as completed 2026-08-24; its fix merged body bullets and removed the empty-rules guard). This repo's copy has the guard again (the file was refreshed by the plugin update, commit 3b8d3eb). Per Issue Discipline the same issue was reopened with a comment instead of filing a duplicate.
- Exposure: ~25% of THOTH-ADR-0002's rules (2 of 8), and 14 body rules across 3 live ADRs (0019: 7, 0021: 5, THOTH-ADR-0002: 2), unserved to every catalog reader; basis: measured (counts from the committed catalog and the ADR files).
- Minimal fix: in this PR add the two rules to the ADR frontmatter `constraints` (the ADR is proposed, so editable) and re-run `node docs/adr-cache.mjs --ensure`; the systemic fix (merge body bullets with frontmatter, exact-string dedup) belongs to the plugin adr-cache script, then a plugin refresh here.
- Failing test: none exists in the repo. The instrument is the parity script in 2.10 (it reports 4 short today, must report 0); a permanent test belongs with the plugin fix. That is why the executable form is a script, not a repo test.

### Finding 2 [ISSUE][LOW][demonstrated] The stated rollback leaves a red suite
- Evidence: the ADR ("Migration and rollback"), the CHANGELOG entry and the plan section 8 say `git revert` of the migration commit restores loader and file together. Drill (2.9): reverting f77cd56 alone leaves 19 of 61 tests failing across the three secret-scan test files (the red-first tests from commit fefce23 and the generator test that imports a module the revert deletes). The gate itself (old loader plus legacy file) is restored, so this is loud and gate-safe, but `npm test` is red.
- Minimal fix: reword the rollback to revert the whole story (the PR merge commit with `-m 1`, or the range fefce23 through 62b95b2) as one unit. A wording edit; no executable test form (a claim about a procedure).
- Exposure: applies to 100% of rollbacks that follow the stated procedure, basis: counted (drill); rollbacks are rare and the failure is loud, so LOW.

### Finding 3 [SUSPICION][LOW][derived] No CLAUDE.md carve-out for value additions, so the hard rule still asks for a dated report each time
- The ADR residual table says a hash addition review is the pull request diff "as in THOTH-ADR-0001". CLAUDE.md carves that out only for the other fixture; this allowlist has no carve-out, and the hard rule requires a fresh dated review report for changes in the secret-scanning area. After merge, every new fixture literal (a one-hash addition) is either a report-worthy change or silently non-compliant. Not worsened by this diff (same situation as the legacy file), but the ADR implies a review model CLAUDE.md does not grant. Reasoned from documents only, so it cannot block; it is a human decision (section 6) and a residual-register line. Resolves to: a CLAUDE.md sentence, or an ADR sentence saying the report requirement stands.

### Seams checked and sound
4. [CLEAN][demonstrated] Sensitive-area boundary and the untouched set (2.1).
5. [CLEAN][demonstrated] Readers and writers of the allowlist and old shape (2.2); no consumer outside `src/secret-scan/` reads the file or the report schema.
6. [CLEAN][demonstrated] Migration is reproducible, non-widening and matches SE ADR-0004 (2.3).
7. [CLEAN][demonstrated] Stacked-branch validity and A9: 108 triples at HEAD, verify PASS on both bases, master allowlist identical to legacy (2.4).
8. [CLEAN][demonstrated] Unlock command works through the pre-commit simulated commit for well-formed paths (2.5).
9. [CLEAN][demonstrated] No test deleted or weakened; X1 flip strengthens; dropped round trip never existed at base (2.6).
10. [CLEAN][demonstrated] QA-13 and QA-15 pass; QA-14 red on master, 0 net-new failing citations from this story (2.7).
11. [CLEAN][code-traced] Bookkeeping (section 5).
12. [CLEAN][demonstrated] Hygiene: the full-history gate passes (0 blocking, 1665 allowlisted) with this story commits in scope; 64-hex tokens on added lines outside the allowlist: 7, all in `history-scan.test.ts` (the seven `REVIEWED_BASELINE` pins Issue 203 requires, same idiom as the existing pins); none in prose, the CHANGELOG, the ADR, the plan or any report. No artifact quotes a secret-shaped literal or an allowlisted value.
13. [CLEAN][code-traced] THOTH-ADR-0002 positions and rules vs code and the plan addendum (section 3).

## 5. Bookkeeping coherence
- `docs/.maat-state.json`: scope `s1-136-value-scoped-allowlist`, tier CRITICAL, `priorScope` equals the previous state minus its catalog (chain preserved), catalog 37 entries (one added: THOTH-ADR-0002, proposed), note text names the proposed tier and the ADR. The diff is 1550 lines with whitespace but 34 without, because every story re-indents the whole nested chain one level; noise, not a defect.
- `docs/run-log.jsonl`: one line for this scope, `tier-ratified` CRITICAL to CRITICAL; no `story-shipped` yet (Manager close-out).
- `docs/backlog.md`: 2 lines changed (the Issue 136 item and the Issue 203 item struck through as done); nothing added, per the human constraint.
- `docs/qa/recurring-findings-registry.md`: the appended promotion note is truthful (the shape change and the baseline pins are in the diff). It ends "Awaiting Stage-3 review", which the Manager updates at close-out; the same row earlier "deliberately unfixed, human-ruled" text is history and now superseded by the appended note.
- CHANGELOG: claims checked against the diff and the instruments above (entry count, 108 hashes, zero newly allowlisted and blocking, 929 pass, untouched paths, filed issues). The timing claim (14.18 s to 14.43 s) was not re-measured. It does not yet mention Issue 239, which was filed after the entry was written (Manager close-out).
- `docs/REVIEW_LOG.md` has the design-challenger and app-security rows; this pass appends its own.

## 6. Human decisions at the pull request (for the Manager summary)
1. Accept or decline THOTH-ADR-0002 (status proposed, agents never accept). Its rules already bind reviewers through the catalog (Issue 220).
2. The named exception: one migrated value is the truncated prefix of what its report calls a real credential (Issue 89, still open, human-only): accept it as named, or rotate and remove it, after which the entry, its hash and its baseline pin are deleted in a follow-up pull request.
3. The devops ADR-0008 time-bound clause deviation (value scoping instead of expiry), or route it as an amendment to the org ADR repository.
4. The Manager delegated design rulings, pending human ratification (the two newest 2026-09-19 decisions rows and the plan addendum): the R203-3 reading (a legacy-shaped report grant blocks at the gate, a self-hashed one is a stated residual), one entry per path and pattern with a hash list, generator kept, ship with the ADR proposed, and the permanent real-repo round-trip test dropped for cost.
5. Whether to add a CLAUDE.md carve-out for one-hash additions (finding 3), or state that the dated-report requirement stands.
6. Merge order and rebase for the stacked PRs; if the origin master allowlist or fixtures move first, re-run the generator and verify. Merging is human-only.
7. Ship gate context: the app-security REWORK (Issue 239) is open and is not mine to lift.

## 7. Coverage gaps and editorial
Coverage gaps named:
- The sensitive-area globs in CLAUDE.md (Issue 234) do not name `src/secret-scan/*` or the allowlist, so no mechanical trigger asks for these dated reports; the chain here is the Manager call. Not a new finding.
- The unlock command is covered by a permanent test through the CI CLI only; the pre-commit path was drilled here (2.5) but has no permanent test. Low risk, same code path, so left as a note.
- The code-reviewer lane (correctness, tests) had no report on disk when this was written; nothing here substitutes for it.
- The timing figures in the CHANGELOG were not re-measured (informational, low risk).

Editorial (verdict-neutral, plain edits, no re-review):
- `src/secret-scan/history-scan.test.ts` lines 124, 133, 142, 191, 210 still describe the old whole-file, path-plus-pattern-only semantics in the present tense, and the test title at line 38 says "exact path+patternId" (now path, pattern id and value hash); `src/secret-scan/patterns.test.ts` line 77 says new fixtures should not lean on "the whole-file allowlist entry"; the comment at `src/secret-scan/history-scan.test.ts` line 300 cites `history-scan.ts` lines that have moved (the loader is now near line 260).
- THOTH-ADR-0002 "Deciders" points at the decisions rows for the Manager ruling; the row for this story is added at Manager close-out.

## 8. Verdict and next action
**APPROVE-WITH-CONDITIONS** from the cross-domain lane: no ADR violation, no cross-lane contradiction, and the migration and the stacked-branch reality hold under measurement. Conditions: fix now, in this PR, the two frontmatter constraint lines and re-run the cache (finding 1); reword the rollback (finding 2). The ship gate itself stays closed on the app-security Issue 239.

Single next action: the Manager routes Issue 239 to a fix round and folds findings 1 and 2 (two small edits) into the same round, then re-runs the parity script and the ADR cache before close-out.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] docs/adr-cache.mjs:173 + docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md -- catalog serves 6 of 8 body rules (frontmatter wins, body dropped; 4 of 7 dual-format ADRs short); recurrence of Issue 9, reopened with comment; fix: add the 2 rules to frontmatter constraints and re-run the cache, plugin merges body bullets. Exposure: ~25% of this ADR rules (2 of 8) and 14 body rules across 3 live ADRs unserved, basis: measured
2. [ISSUE][LOW][demonstrated] THOTH-ADR-0002 "Migration and rollback" / CHANGELOG / plan section 8 -- reverting only f77cd56 leaves 19 of 61 secret-scan tests failing; reword the rollback to revert the whole story as one unit
3. [SUSPICION][LOW][derived] CLAUDE.md hard rule vs the ADR "PR diff is the review": no carve-out for one-hash additions, so a dated report is still required each time; human decision or one sentence
4. [CLEAN][demonstrated] sensitive-area boundary: empty diffstat on the nine untouched paths; only src/secret-scan/* and the allowlist changed in the area
5. [CLEAN][demonstrated] readers/writers of the allowlist and old shape derived by git grep; package.json, CI, hook, README, REQUIREMENTS unchanged and not stale
6. [CLEAN][demonstrated] migration byte-identical on regeneration; verify PASS, 0 newly allowlisted, 0 newly blocking (SE ADR-0004, devops ADR-0008 ratchet)
7. [CLEAN][demonstrated] stacked branches: 108 triples at HEAD, verify PASS on base and origin/master, master allowlist identical to legacy (A9 holds today)
8. [CLEAN][demonstrated] printed unlock command works through the pre-commit simulated commit for well-formed paths
9. [CLEAN][demonstrated] 0 test names removed, assertions 40 to 113; X1 flip strengthens; dropped round trip never existed at base (SE ADR-0005/0010)
10. [CLEAN][demonstrated] QA-13 and QA-15 pass; QA-14 red on master (Issue 229) with 0 net-new failing citations
11. [CLEAN][code-traced] state file chain preserved, tier CRITICAL, catalog 37; run-log one tier-ratified line; backlog nothing added; registry note truthful; CHANGELOG claims match
12. [CLEAN][demonstrated] hygiene: gate PASS with story commits in scope; 7 new pins are the required Issue 203 baseline hashes; no literal, allowlisted value or hash in any prose artifact
13. [CLEAN][code-traced] THOTH-ADR-0002 rules and positions vs code, plan addendum and the whole catalog: no contradiction
counts: issues=2 suspicions=1 clean=10
evidence: demonstrated=10 code-traced=2 derived=1
checks=npm test 929 pass/0 fail/0 skip; typecheck exit 0; lint exit 0; history-scan gate exit 0 (0 blocking, 1665 allowlisted); allowlist-tool verify exit 0 twice (bases 7b62344 and origin/master); generate cmp byte-identical exit 0; spike union 108 triples; QA-13 exit 0; QA-15 exit 0; QA-14 exit 1 (18 of 921 story scope, 0 net-new; master 26 of 1386); rollback drill 42 pass/19 fail/0 skip of 61; pre-commit unlock drill pass
adr=HIT(37, whole catalog)
report=docs/reviews/s1-136-value-scoped-allowlist-cross-domain-2026-09-19.md
