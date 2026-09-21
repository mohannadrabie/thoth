# Cross-domain review: s1-135-pat-regression-test (Issue #135, Story B part S-B1) - 2026-09-19

[cross-domain-reviewer] Ra. Reviewed HEAD 6d048d5 against base 4644b2b (`git diff 4644b2b HEAD`). Tier STANDARD (ratified, run-log `tier-ratified`). Domain reviewer alongside: `code-reviewer` (correctness, test quality, regex statefulness). Their report was not re-read for findings; nothing below repeats their lane.

## 1. Lanes and ground covered

| Lane | Ground | Not covered by it (mine) |
|---|---|---|
| `code-reviewer` | the two new tests, regex statefulness, mutation red/green, typecheck, lint, full suite | everything below |
| Ra (this pass) | whole ADR catalog vs diff, sensitive-area boundary, scan-pattern hygiene of added text, state and run-log bookkeeping, CHANGELOG claims, the Story B decisions row (facts re-derived by instrument, coherence against ADRs and earlier human rulings) | code correctness |

Diff: 6 files, 117 insertions excluding the state file (`.maat-state.json` is a re-nest): `CHANGELOG.md`, `docs/.maat-state.json`, `docs/decisions.md`, the Phase 1 plan, `docs/run-log.jsonl`, `src/secret-scan/patterns.test.ts` (numstat 32 added, 0 deleted).

## 2. Cross-domain ADR verdict (ADR cache: HIT, 36 catalog entries read whole and unfiltered)

```
$ node docs/adr-cache.mjs --ensure
ADR cache HIT: reused 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1] from catalog (fp 5dba384) [CACHE=HIT]
```

| ADR | Applies to this diff? | Verdict |
|---|---|---|
| SE ADR-0005 (testing) | yes: two tests added | Compliant. 0 lines deleted or edited in the test file; each new test builds its own state (fixtures are module constants, `findPattern` resets `lastIndex`); no ordering dependence. Its rule text is "MUST NOT delete or weaken a failing test to make CI pass"; the decisions row quotes it more broadly (see Editorial). |
| SE ADR-0010 (quality gates, no scope creep) | yes | Compliant at diff level; gate runs are `code-reviewer`'s and `/maat:verify`'s. |
| SE ADR-0001, devops ADR-0001 (record decisions; MUST propose an ADR for a significant decision) | the decisions row, not the code | See finding F4. |
| devops ADR-0008 (gates, suppression lists, "ratchet only") | the decisions row, not the code | Diff itself: allowlist byte-identical, no suppression broadened, no test deleted: compliant. Design ruling: see finding F4. |
| THOTH-ADR-0001 (central-classification fixture) | no | Not touched (the classification fixture file is absent from the diff). |
| SE ADR-0016, 0019, 0020, 0021 (guard, hooks, evidence trail, self-protection) | no | No guard, hook, policy, or evidence file in the diff (boundary check in section 3.1). |
| All other devops (IaC) and SE ADRs | no | No IaC, data, cloud, or tagging content in the diff. |

No cross-domain ADR collision by the code or test text. No BLOCKER.

## 3. Seam checks (instruments, raw output)

### 3.1 Sensitive-area boundary

```
$ git diff --name-only 4644b2b HEAD
CHANGELOG.md
docs/.maat-state.json
docs/decisions.md
docs/plans/s1-135-pat-regression-test-phase1-2026-09-19.md
docs/run-log.jsonl
src/secret-scan/patterns.test.ts
$ git diff --stat 4644b2b HEAD -- src/secret-scan/patterns.ts docs/qa/secret-scan-allowlist.json src/secret-scan/history-scan.ts src/secret-scan/pre-commit-scan.ts .github/workflows/ci.yml src/lib/git.ts | wc -l
0
(name filter over the changed list for hooks/, scripts/, src/policy/, .github/, src/lib/git.ts, the allowlist, the scanner sources)
none
```

Untouched: `patterns.ts`, the allowlist, `history-scan.ts`, `pre-commit-scan.ts`, `ci.yml`, `src/lib/git.ts`. The only secret-scanning-area file in the diff is the test file, consistent with the s1-227 precedent and the plan's re-tier trigger (not tripped).

### 3.2 Added text vs scan patterns and the allowlist

A scratch script scanned each changed file at base and at HEAD with the real `SECRET_PATTERNS`, hashing each match value (no raw text printed):

```
CHANGELOG.md | base matches 7 head matches 7 | new (pattern,value) or increased: 0
docs/.maat-state.json | base 0 head 0 | new: 0
docs/decisions.md | base 4 head 4 | new: 0
docs/plans/s1-135-pat-regression-test-phase1-2026-09-19.md | base (absent) head 0 | new: 0
docs/run-log.jsonl | base 0 head 0 | new: 0
src/secret-scan/patterns.test.ts | base 12 head 12 | new: 0
github-fine-grained-pat matches in patterns.test.ts: base 1, HEAD 1
```

```
$ node src/secret-scan/history-scan.ts
[OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (1512 allowlisted).
exit=0
$ node --test src/secret-scan/history-scan.test.ts   (dogfood + REVIEWED_BASELINE guards)
tests 21  pass 21  fail 0  skipped 0
$ node --test src/secret-scan/patterns.test.ts
tests 10  pass 10  fail 0  skipped 0
```

No text added by this diff matches a pattern, so nothing added depends on an allowlist entry; the runtime-built fixtures worked as the CHANGELOG says. The full-history pass also covers the plan and CHANGELOG prose that quote the four snake_case exemplars: the fixed regex ignores them where no grant exists.

### 3.3 State and run-log

- `docs/.maat-state.json`: head `priorScope` deep-equals the base root (minus `adrCatalog`): true. `adrCatalog` deep-equal to base, 36 entries. Chain from the head down: s1-135, s1-226, s1-227, s1-qa-probe-hardening, fixture-single-source-of-truth, and so on; coherent with prior transitions (the 1521-line diff is re-indentation from re-nesting).
- `docs/run-log.jsonl`: 61 lines, 0 unparseable; last line is `tier-ratified`, proposed and ratified STANDARD, `changed:false`. Consistent with the state file's tier.

### 3.4 CHANGELOG claims vs diff

- "patterns.test.ts only, two tests appended, no existing test line edited": numstat 32/0, tests 8 to 10. Matches.
- "`patterns.ts` and the allowlist are byte-identical to the base": empty diff (3.1). Matches.
- "match count one at base and one in the working tree": measured, one and one. Matches.
- Mutations, reproduced on scratch copies of `patterns.ts` (tracked file never edited), each mutation verified to apply:

| Mutation | Failing tests | CHANGELOG / plan said |
|---|---|---|
| M1 old word-character form, 20 to 255 | the prose test only (fail 1, pass 9) | prose test red: matches |
| M2 secret segment `*` to `+` | the truncated test only | matches |
| M3 identifier floor 20 to 1 | the prose test only | matches |
| M4 identifier floor 20 to 23 | the truncated test, the prose test (its 22-char contrast token), and the pre-existing full-format test (20-char segment): fail 3 | CHANGELOG states exactly this; the plan's "must stay green" cell for the prose test is stale (the M4-deviation sentence is correct) |

(An earlier M1 attempt of mine failed three tests because my shell substitution dropped the backslash from the word-character class; redone with a string-literal script, the row above is the valid result.)

### 3.5 Other claims of a regression test for Issue #135

Instrument: `git grep -n -i -E "regression test.*(#135|fine-grained)|(#135|fine-grained).*regression test|word-boundary-test" -- ':!docs/reviews'`. Hits: the new CHANGELOG entry, the original cifix CHANGELOG line ("Regression test added pinning both classes", now disclosed as untrue by the new entry and deliberately not edited), the new test title, the plan, the allowlist reason text at `docs/qa/secret-scan-allowlist.json:90` (refers to the existing classic-PAT negative control, accurate), and this story's decisions row. No other unmet claim.

### 3.6 Consistency with sibling tests

The new tests use the file's own `findPattern` helper (resets `lastIndex` per call, `src/secret-scan/patterns.test.ts:5-10`), the same `test(...)` plus long-title-with-regression-reference style, and `assert` from `node:assert/strict`. The prose test re-calls `findPattern` per exemplar because the regex is global; the truncated test uses `String.match` on a global regex, which resets `lastIndex`. Sound; statefulness depth is `code-reviewer`'s.

## 4. The Story B decisions row (`docs/decisions.md:70`), facts re-derived

### 4.1 Facts: all confirmed

```
$ node -e (JSON parse of docs/qa/secret-scan-allowlist.json)
total 50
under docs/reviews/ 23
by patternId: aws-access-key-id 10, email-address 21, ipv4-private 1, github-fine-grained-pat 3, internal-hostname 13, github-pat 2
$ git grep -l -E "loadAllowlist|partitionAllowlisted" -- ':!*.md'
src/secret-scan/history-scan.test.ts
src/secret-scan/history-scan.ts
src/secret-scan/pre-commit-scan.ts
```

- Fifty entries, twenty-three under `docs/reviews/`: confirmed. The row's "six pattern ids" is the six ids present in the allowlist; `SECRET_PATTERNS` itself defines nine.
- Consumers of the two functions: the three named files, and only those (source and test). Confirmed. Markdown hits (CHANGELOG, reports) are prose and excluded by the filter.
- Regex already fixed: `src/secret-scan/patterns.ts:38` is the alphanumeric-run form (twenty or more alphanumerics, an underscore, then zero or more alphanumerics after the fine-grained prefix). Confirmed. Regression test missing before this diff: 8 tests at base, none for the prose class. Confirmed.
- The prompt's quote ("needs my design call on value-scoped allowlist entries. Stop and ask me before planning it") is verbatim in the untracked root prompt file, and that file's standing rule reads "I preapprove your plan and tier decisions". The row discloses that it reads a later in-session message as extending this to the design call, and names PR review as the ratification point. I cannot verify the later message from the repo. Sound as disclosed.
- Q1's premise that line ranges cannot work: `scanHistory` walks every commit's tree and dedupes by blob sha (`src/secret-scan/history-scan.ts:71-90`), so a match is per blob version. Confirmed. The human's earlier ruling (`docs/backlog.md:72`) offered "exact test-fixture line ranges (or an equivalent value/line-scoped exemption mechanism)"; picking the value branch is within that ruling.
- Row claim that PR #225 removed the sibling expiry timer: PR #225 is merged ("Feat/fixture single source of truth"); consistent with the state file's note for that scope.

### 4.2 Measurement for Story B's spike (PRINCIPLES rule 18: the row defers the number to the plan's first task, which is proper; this is the input)

Scratch instrument: hash every match value over the scanner's own scope (history reachable from HEAD, blobs deduped), keyed (path, patternId, sha256 of value). Counts only; values never printed.

```
commits 196  unique blobs scanned 986
distinct (path,patternId,valuehash) triples over full history: 108
distinct (path,patternId) pairs with a match: 50 ; grants in file: 50
by pattern: internal-hostname 67, email-address 23, aws-access-key-id 12, github-pat 2, github-fine-grained-pat 3, ipv4-private 1
non-granted triples (would block today): 0
grants that match something: 50 of 50
triples per pair, top 10: 15,11,10,6,5,4,3,3,3,3
credential-shaped triples (fallback set): 17   (15 grants)
sharp-end pairs named by Issue #136 / backlog: fine-grained-pat 1 value, github-pat 1 value, internal-hostname 5 values
```

So the migrated file at HEAD would carry 108 value entries against 50 today (about 2.2x), 17 of them credential-shaped. The number moves with every commit that adds a match. The row's threshold "unreviewable in size" is undefined; 108 hash-keyed entries are not eyeball-reviewable in any case, so the real guard is the row's own "subset of what is allowlisted today, shown by script".

## 5. Findings

### F1 [SUSPICION][MED][demonstrated] The Q2 fallback contradicts Q3 and skips one of the three entries the human named

`docs/decisions.md:70` (d): Q2 says if the migrated file is unreviewable, fall back to "credential-shaped patterns only, with the rest filed as an Issue". Q3 says "no legacy shape: an entry without a valid value scope is rejected and its matches block".
- Under the fallback, the 35 non-credential grants (50 minus 15, measured above) stay whole-file, i.e. legacy shape, which Q3 rejects. Both cannot hold; a two-shape schema would contradict Q3's "no legacy shape".
- "Credential-shaped" is defined in code as every id except `internal-hostname`, `ipv4-private`, `email-address` (`src/secret-scan/history-scan.test.ts:157-159`). One of the three entries the human ruled on (`docs/backlog.md:72`: patterns.test.ts crossed with github-fine-grained-pat, github-pat, and internal-hostname) is `internal-hostname`, so the fallback would leave a human-named entry unnarrowed.
- Contingent: the fallback may never fire (108 entries). Nothing is broken today.

Minimal fix: one edit of the Q2/Q3 sentence before the human reviews the PR (say the fallback keeps a second, explicitly listed legacy shape, or drop the fallback in favor of the 108 measured). Executable form for S-B2: named test `sb2-partial-migration-does-not-leave-legacy-shape-entries-honored` (and one asserting the three human-named pairs are value-scoped).

### F4 [SUSPICION][MED][derived] The row states no ADR position

- SE ADR-0001 rule: "MUST propose a new ADR (status Proposed) when making a significant decision not covered here, and flag it for human approval". A new exemption data model (value-hash scope) for the secret-scanning gate is a security-control decision recorded only as a Manager row under delegation. The precedent for a standing change to an exemption mechanism in this repo is a project-tier ADR (THOTH-ADR-0001).
- devops ADR-0008: the "ratchet only" rule (no broadened suppression lists) is respected in substance (entries narrow; the subset-by-script guard is right), but the row never says so, and it explicitly rejects an expiry while ADR-0008's exception process makes suppressions time-bound. ADR-0008's literal MUST names other tools (cdk-nag, Semgrep, Trivy) and this repo has no Gitleaks, so applicability is arguable, but PRINCIPLES rule 9 says an unsatisfiable or unclear rule is stated, not silently passed.

Minimal fix: S-B2's Phase 1 states its position on both (a Proposed ADR for the entry shape, or a recorded reason it is not "significant", plus one line on ADR-0008 applicability). Resolves to a Phase 1 line, not a code test; capped at MED (derived).

### F2 [ISSUE][LOW][demonstrated] The consumer list omits the file-format consumers

The row's (b) claim is true of the two functions. As a scope input for a story that changes the entry shape it is incomplete:
- `src/secret-scan/pre-commit-scan.test.ts` writes three allowlist files in the legacy shape into fixture repos (writes at lines 83, 135, 152), and is not in the row's list.
- `src/secret-scan/history-scan.test.ts` reads the raw JSON at five sites (lines 115, 171, 190, 371, 406), bypassing `loadAllowlist`/`isValidAllowlistEntry`, and builds inline legacy-shape literals (instrument: git grep for a patternId string followed by a reason key under `src`: 7 in history-scan.test.ts, 3 in pre-commit-scan.test.ts).

Consequence: Q3 turns those ten literals red or silently changes what the dogfood test asserts. Minimal fix: S-B2 derives its file list from the instrument above, not from the row. No Issue: LOW.

### F3 [SUSPICION][LOW][derived] Entries are coupled to the regex's exact match text

Q1 hashes the matched string (`scanBlobText` yields the match text, `src/secret-scan/history-scan.ts:45-57`). Any edit that changes a pattern's match boundary (as Issue #135's own fix did to this pattern) makes its entries stale and blocks; that is fail-loud, the safe direction, but the row gives no procedure for regex edits. Basis: `src/secret-scan/patterns.ts` has 2 commits in history (`git log --oneline -- src/secret-scan/patterns.ts`), so churn is currently low. Minimal fix: one line in S-B2's plan. Test: `sb2-regex-edit-invalidates-entries-loudly`.

## 6. Coverage gaps named

- `docs/.maat-state.json`, `docs/run-log.jsonl`, `docs/decisions.md`: no domain reviewer lane claims bookkeeping files; covered here (3.3, section 4).
- Plan file: prose, no risk; covered by the scan in 3.2. Intentionally low risk.
- CHANGELOG: claims verified (3.4).
- The row's Story B out-of-scope list (report-immutability enforcement, stale sensitive-area globs, a lint for entries that match nothing): the row says these go to GitHub Issues; a title search shows only Issue #203 for immutability, so the other two are not yet filed. Manager action, not a defect of this diff. The "entries match nothing" lint is unmeasured as a need: 50 of 50 grants match something today.

## 7. QA-14 hygiene

`node src/qa/reference-resolver.ts origin/master HEAD`: exit 1; 26 of 1348 citations failed, 252 unclassified non-blocking (the plan's baseline was 26 of 1330; the failing count is unchanged, and no citation string is quoted here).

## 8. Editorial

- The decisions row cites SE ADR-0005 as forbidding deleting or weakening tests "without a human exception". ADR-0005's rule is narrower (a failing test, to make CI pass); the broader "delete tests" MUST is in SE ADR-0010 and devops ADR-0008. The conclusion (keep the baseline guard tests) stands.
- The row's "Human ratified" cell reads "delegated; ratified at PR review"; the convention is Y / N / pending. "pending" is accurate.
- The state file's note for this scope still says "awaiting Manager ratification" while the run-log line ratifies STANDARD (same defect fixed at the previous story's close-out).
- The plan's M4 "must stay green" cell is stale (already noted by `code-reviewer`; not a new finding).

## 9. Verdict

APPROVE-WITH-CONDITIONS. The story itself (two tests, one CHANGELOG entry) is clean at the seams: no sensitive-area file touched, no added text matches a pattern, allowlist untouched, bookkeeping coherent, CHANGELOG claims reproduce. The condition is on the docs row that will drive the CRITICAL S-B2: amend the Q2/Q3 wording (F1) before the human reviews the PR, and carry F4, F2, F3 into S-B2's Phase 1. Open findings 4; failing tests 0: each has no executable form until S-B2 exists, and each is assigned a named S-B2 test or a Phase 1 line above.

Single next action: the Manager edits the Q2 fallback sentence in the Story B row (F1), then proceeds to /maat:verify.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [SUSPICION][MED][demonstrated] docs/decisions.md:70 Q2 credential-only fallback contradicts Q3 no-legacy-shape (35 non-credential grants stay whole-file) and leaves one of the three human-named entries (patterns.test.ts x internal-hostname, backlog.md:72) unnarrowed; fix: reword Q2/Q3 before PR review.
2. [SUSPICION][MED][derived] docs/decisions.md:70 no ADR position: SE ADR-0001 (propose an ADR for a significant decision), devops ADR-0008 (time-bound clause vs "rejected: an expiry"; ratchet held only in substance, entries 50 to 108 measured); fix: S-B2 Phase 1 states both.
3. [ISSUE][LOW][demonstrated] docs/decisions.md:70 (b) consumer list omits file-format consumers: pre-commit-scan.test.ts (3 legacy-shape writes) and 5 raw-JSON reads plus 7 inline literals in history-scan.test.ts; fix: S-B2 derives its file list by instrument.
4. [SUSPICION][LOW][derived] value hash over the regex match text couples entries to match boundaries (history-scan.ts:45-57); patterns.ts has 2 commits so churn is low; fix: one procedure line in S-B2 plan.
5. [CLEAN][demonstrated] row facts re-derived: 50 entries, 23 under docs/reviews, consumers of loadAllowlist/partitionAllowlisted are exactly 3 files, regex already fixed at patterns.ts:38, test was missing (8 tests at base); measured 108 value triples over history for S-B2.
6. [CLEAN][demonstrated] sensitive-area boundary: patterns.ts, allowlist, history-scan.ts, pre-commit-scan.ts, ci.yml, src/lib/git.ts diff empty; no hooks/scripts/policy file in the diff.
7. [CLEAN][demonstrated] no added text matches a pattern or depends on an allowlist entry: per-file base/HEAD match counts equal, fine-grained-pat count 1 and 1, full history scan PASS 0 blocking (1512 allowlisted), history-scan.test.ts 21/0/0, patterns.test.ts 10/0/0.
8. [CLEAN][demonstrated] maat-state priorScope deep-equals base root, adrCatalog deep-equal (36), run-log 61 lines parseable with tier-ratified STANDARD.
9. [CLEAN][demonstrated] CHANGELOG claims match diff; M1-M4 reproduced red on scratch copies (1/1/1/3 failing tests), M4-deviation sentence correct.
10. [CLEAN][code-traced] new tests consistent with siblings (findPattern reset at patterns.test.ts:5-10, no shared state) and SE ADR-0005/0010 (0 deletions, self-owned state).
11. [CLEAN][demonstrated] no other unmet claim of an Issue #135 regression test: only the historical cifix CHANGELOG line, now disclosed and deliberately unedited.
12. [CLEAN][code-traced] Q1 premise holds: scanHistory walks every commit tree and dedupes by blob (history-scan.ts:71-90), so line ranges are per blob version; and 50 of 50 grants each match something today.
13. [CLEAN][derived] delegation reading: prompt quote verbatim in the untracked root prompt file, preapproval scope and later extension disclosed in the row, PR review named as ratification; later in-session message not verifiable from the repo.
counts: issues=1 suspicions=3 clean=9
evidence: demonstrated=8 code-traced=2 derived=3
checks=history-scan.test.ts 21 pass/0 fail/0 skip; patterns.test.ts 10/0/0; oss history-scan PASS exit 0 (0 blocking, 1512 allowlisted); mutations M1-M4 on scratch copies red as stated; reference-resolver origin/master..HEAD exit 1 (26 of 1348, unchanged from plan baseline); scratch spike 108 triples over 196 commits
adr=HIT(36, whole catalog)
report=docs/reviews/s1-135-pat-regression-test-cross-domain-2026-09-19.md
