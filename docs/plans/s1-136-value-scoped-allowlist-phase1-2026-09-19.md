# s1-136-value-scoped-allowlist: Phase 1 plan (2026-09-19)

**Status: PLAN-READY, nothing built.** Story S-B2 of Story B (Issues #136 and #203; the two newest `docs/decisions.md` rows bind this plan). Branch `fix/s1-136-value-scoped-allowlist`, stacked on `fix/s1-135-pat-regression-test` at 25291ff. Tier PROPOSED: **CRITICAL** (Manager ratifies). New Issue filed from this planning: Issue #236 (pre-commit reads the allowlist from the working tree), out of scope.

**Story.** An allowlist entry exempts a match only when its `path`, its `patternId` and the sha256 of the matched bytes all agree; entries without a valid value scope are rejected and their matches block; the fifty entries migrate in one commit via a tested generator proven a subset of today's coverage; Issue #203's report-grant exclusion is removed and those grants are pinned.

## 1. Readiness and ADR review

- Readiness: no missing fact. Issues #136 and #203 read in full (no comments on either); both reports read; the design and its amendment are ruled. Spike figures match the cross-domain reviewer's, so no re-ruling is triggered (section 3).
- ADR cache: `node docs/adr-cache.mjs --ensure` reported HIT at start (36 ADRs); after the draft ADR below it rebuilt to 37 and now reports HIT.

| ADR | Verdict | Rule this story honors |
|---|---|---|
| devops ADR-0008 | APPLICABLE | "MUST NOT lower gate thresholds, delete tests, or broaden suppression/ignore lists (ratchet only)": satisfied by the subset proof. Also: "MUST NOT suppress ... without an inline justification comment AND a human-approved, time-bound exception": **deviation, stated**, value scoping replaces the expiry (draft ADR position table; the human decides at PR). "MUST install and run the Gitleaks pre-commit hook; MUST NOT bypass it (`--no-verify`)": OSS-01 is this repo's own scanner; not decided here. |
| SE ADR-0001 | APPLICABLE | "MUST propose a new ADR (status `Proposed`) when making a significant decision not covered here ... agents MUST NOT self-accept". Drafted, status proposed. |
| SE ADR-0005 | APPLICABLE | "MUST NOT delete or weaken a failing test to make CI pass". No test is deleted; fixture-shape edits are listed in section 6. |
| SE ADR-0010 | APPLICABLE | "MUST NOT lower coverage thresholds, delete tests, or broaden lint ignore lists". Same. One assertion is flipped by #203 itself (section 6, row X1), flagged for the Manager. |
| SE ADR-0004 | APPLICABLE | "MUST write re-runnable operational scripts and migrations; a second run is a no-op": the generator has a run-twice test (G2). |
| SE ADR-0006 | APPLICABLE | "MUST make every schema/data migration reversible or explicitly two-phase, and state the rollback plan": section 8. |
| THOTH-ADR-0001 | NOT-APPLICABLE as a rule (a different allowlist) | Used as the format precedent. Its "PR diff is the review" premise is reused for value entries. |
| Remaining catalog entries | NOT-APPLICABLE | Cloud, data, tagging, CDK, policy-kernel ADRs; none names the OSS-01 scanner. |

## 2. Acceptance criteria (R-ids from the task; every one maps to a named check in section 6)

R136-1 entry exempts only its granted values. R136-2 gate-level `oss01-allowlisted-file-still-blocks-a-novel-secret`. R136-3 reviewed literals stay allowlisted and reported. R136-4 one shared implementation reaches history-scan, pre-commit-scan and the dogfood test. R136-5 the three human-named pairs are value-scoped. R136-6 malformed or missing scope rejected, matches block. R136-7 no broadening, by script. R136-8 completeness claims by instrument. R136-9 real verification. R203-1 exclusion removed, report grants pinned. R203-2 stale rule-11 prose corrected. R203-3 Attack E fails. Amendment: `sb2-partial-migration-does-not-leave-legacy-shape-entries-honored`, `sb2-regex-edit-invalidates-entries-loudly`, the draft ADR. None derived; all come from the two decisions rows and the two Issues.

## 3. Spike (first task; runnable, counts only): `docs/spikes/s1-136-value-triples-2026-09-19.mjs`

Run 2026-09-19 at HEAD (199 commits), `node docs/spikes/s1-136-value-triples-2026-09-19.mjs`:

| Measure | Result | Cross-domain reviewer |
|---|---|---|
| Distinct (path, patternId, value-sha256) triples, history from HEAD, blobs deduped | 108 (995 text blobs, 1535 occurrences) | 108 over 196 commits: **reproduced** |
| Same, simulated pre-commit tree | 107 (358 blobs, 274 occurrences) | not measured |
| Union of both scopes | 108; 50 distinct pairs | 50 pairs |
| Allowlist entries / grants that match something / non-granted triples | 50 / 50 of 50 / 0 | 50 / 50 of 50 / 0: **reproduced** |
| By pattern | hostname 67, email 23, aws-key 12, github-pat 2, fine-grained-pat 3, ipv4 1 | same |
| Human-named pairs, distinct values (fine-grained-pat, github-pat, hostname) | 1, 1, 5 | 1, 1, 5 |
| Matches containing a non-ASCII byte | 0 | not measured |
| Credential-shaped grant pairs / under `docs/reviews/` / other | 15 / 7 / 8 (all 7 report grants have one live value in today's text) | 15 grants; red-team round 5 counted 6 reports: one more since |
| Hash cost | 1809 digests in about 15 ms total (about 3 ms on the simulated tree) | n/a |
| Pre-commit scan runtime, baseline, 3 back-to-back runs | 10.29 s, 10.49 s, 10.85 s | Path B rows said about 12 to 25 s (machine dependent) |
| `npm test` baseline | 893 pass, 0 fail, 0 skipped (46 s); typecheck and lint clean | 893 |

Reading: the migrated file has 108 hashes across 50 entries; hashing adds about 0.03 percent of the hook's runtime. **Rollback and blast radius (measured, not assumed):** a wholesale-rejected allowlist turns 1535 history occurrences (108 distinct triples) and 274 simulated-tree occurrences into blocking matches. The hook reads code and allowlist from disk, so the fix commit itself is not blocked once the file on disk is repaired; `--no-verify` is not needed for that path (drill in Phase 2, section 8).

## 4. Consumer file list (derived by instrument, not from the decisions row)

```
git grep -n -l -E "loadAllowlist|partitionAllowlisted|AllowlistEntry|summarizeMatches|isValidAllowlistEntry" -- ':!*.md'
  src/secret-scan/history-scan.test.ts, history-scan.ts, pre-commit-scan.test.ts, pre-commit-scan.ts
git grep -n -l -E "secret-scan-allowlist" -- ':!*.md' ':!docs/reviews'
  the four above, docs/qa/secret-scan-allowlist.json itself, docs/.maat-state.json (note text only)
git grep -n -E "patternId: *\"[a-z-]+\"[^\n]*reason" -- src ':!*.md'
  history-scan.test.ts: 7 inline old-shape literals; pre-commit-scan.test.ts: 3
git grep -n -E "readFile\(.*(ALLOWLIST_PATH|secret-scan-allowlist)" -- src hooks scripts .github
  history-scan.test.ts: 5 raw JSON reads that bypass loadAllowlist
```

Consequences: the dogfood test and both scan CLIs must load through `loadAllowlist` (the dogfood reads raw JSON today); the inline old-shape literals move to the new shape, except the self-grant mutation test's local array, which never reaches the partition. Phase 2 re-runs these four commands and attaches the output; a difference from this list is a stop-and-report.

## 5. Shape note (one page)

**Topology.**

```
allowlist.json --loadAllowlist--> isValidAllowlistEntry (path, patternId, valueSha256 = non-empty list of lowercase 64-hex, reason)
                                   invalid entry: dropped (its matches block)
scanBlobText: m[0] --> { redacted, valueSha256 = sha256(bytes of m[0]) }        (raw text never stored)
scanHistory --> matches --> partitionAllowlisted (path + patternId + hash) --> summarizeMatches --> ok / exit code
      ^ shared by: history-scan CLI (CI) | pre-commit-scan CLI (hook, simulated tree) | dogfood test
one-shot generator (new): legacy file + scanHistory(story base) --> migrated file; verify mode --> subset proof
```

Design points held to the ruling: one mechanism for the six pattern ids present; one entry per (path, patternId) carrying a hash list (50 entries stay 50, one reason each; see Question 2); no legacy shape; hash over matched bytes (latin1 round trip of the scanner's decoded string), so it equals the hash of the file's own bytes, the idiom `REVIEWED_BASELINE` already uses. The block message gains one detail line naming the unlock (PRINCIPLES rule 2): a real secret is rotated and removed; a reviewed fixture literal is exempted by adding its sha256 to the entry, with the command to compute it. No hash is printed for a blocked match (a weak value's hash is guessable); the history-scan report file (gitignored, generated per run) gains the hash per match (Manager ruled Q5).

**Blast radius.** The gate runs on every commit and every CI run. A malformed migration fails closed everywhere (nothing fails open); a loader bug that over-blocks does the same. Rollback and unlock: section 8.

**Evolution.** New fixture literal: a PR adds its hash and a reason; the diff is the review (THOTH-ADR-0001 premise). **Regex-edit procedure (one line):** when an edit changes a pattern's match boundary, the same PR re-derives the hashes of only the affected reviewed literals (run history-scan, read the blocked path and redacted text, hash those literals), shows old and new hash per literal in the PR description, and never regenerates a whole entry wholesale; until then the stale entries block, loudly. Later, human-approved: retire the redundant `REVIEWED_BASELINE` tests. Tracked elsewhere: Issue #233 (report immutability), Issue #235 (entries matching nothing), Issue #236 (allowlist read from disk).

## 6. Criteria to named tests (tests are the answer key, written RED first by the implementer; `test-writer` not dispatched, section 10)

Files: HS = `src/secret-scan/history-scan.test.ts` (appended), PC = `src/secret-scan/pre-commit-scan.test.ts` (appended), G = new generator test file next to the generator (no email, hostname or key-shaped literal in its text; fixtures built at runtime). Every planted literal is built at runtime so no test file gains an allowlist need. Hashes in tests are computed with an independent local `createHash` helper, never through the production function.

| Id | Named check | Level | File | Asserts | Covers |
|---|---|---|---|---|---|
| T1 | `oss01-entry-exempts-only-its-granted-values` | unit | HS | 4 cells: same path, pattern, granted hash allowlisted; other hash blocks; same hash other pattern blocks; same hash other path blocks | R136-1 |
| T2 | `oss01-allowlisted-file-still-blocks-a-novel-secret` | gate: temp git repo, `scanHistory`, `summarizeMatches` | HS | granted literal plus a novel one in the same granted file: `ok=false`, 1 blocking, granted literal still listed ALLOWLISTED, details name the unlock, raw novel text absent | R136-2, R136-3 |
| P1 | same name, suffix (pre-commit CLI) | gate: real CLI in a fixture repo | PC | granted plus novel: exit non-zero and unlock line on stdout; granted alone: exit 0 (positive control); novel alone in the granted file: non-zero | R136-2 |
| T3 | `oss01-reviewed-literal-stays-allowlisted-and-reported` | unit | HS | allowlisted match appears as an ALLOWLISTED detail, `ok=true` | R136-3 |
| T10 | `oss01-real-allowlist-refuses-a-novel-value-in-every-granted-pair` | gate on the REAL file: one file per real entry at that entry's path, holding a runtime-built novel literal of that entry's pattern | HS | every real entry, all six pattern ids, refuses a novel value; a pattern id with no builder fails loudly; count is derived from the file | R136-1, R136-4, R136-8 |
| T8 | `sb2-three-human-named-pairs-are-value-scoped` | real file + behavior | HS | the three pairs named in `docs/backlog.md` (test file for pattern catalog by fine-grained-pat, github-pat, internal-hostname) each have a valid non-empty hash list, none is whole-file, a novel value blocks | R136-5 |
| T4 | `sb2-malformed-or-missing-scope-is-rejected-and-blocks` | unit + loader | HS | table: missing, empty list, string not list, null, non-hex, uppercase hex, wrong length, non-string element: each dropped by `loadAllowlist`, its match blocks; valid control honored | R136-6 |
| T5 | `sb2-partial-migration-does-not-leave-legacy-shape-entries-honored` | loader + gate | HS, PC | file with valid, legacy, valid entries: only the two valid honored; the legacy pair's match blocks; CLI exits non-zero | amendment |
| T6 | `sb2-regex-edit-invalidates-entries-loudly` | gate with a variant pattern via the `patterns` option | HS | entry hashed under boundary A allowlists; the same literal under boundary B blocks with the entry now stale; ok=false | amendment |
| T7 | `sb2-scanner-hashes-at-match-time-and-stores-no-raw-text` | unit | HS | each match carries sha256 of the matched bytes (independent helper, incl. a non-ASCII byte case); serialized matches contain no raw literal | R136-4 |
| T9 | `sb2-real-allowlist-loads-with-no-rejected-entry` | real file | HS | `loadAllowlist` length equals raw JSON length (nothing silently dropped); the existing dogfood test now loads through `loadAllowlist` | R136-4, R136-9 |
| T11 | "OSS-01 allowlist: a docs/reviews/* credential grant is pinned to a baseline at grant time like every other file, not excluded" (red-team's name, verbatim) | real file | HS | every credential-shaped grant under `docs/reviews/` is in the derived set and has a non-empty pinned baseline; the #202 key-set-equality test (unchanged) then holds at the re-derived count | R203-1 |
| T12 | `oss01-attack-e-legacy-shaped-report-grant-blocks-at-the-gate` | gate | HS, PC | new report file with a live literal plus its own whole-file (legacy-shaped) grant: `ok=false`, CLI non-zero | R203-3 |
| T13 | `oss01-attack-e-self-hashed-report-grant-is-caught-by-the-baseline-guard` | guard | HS | a new report grant with the literal's own hash but no baseline pin: the gate passes (no oracle, stated), the baseline guard reports it | R203-3 (Question 1) |
| X1 | existing test "deriveMutableCredentialGrants includes ANY new file's credential grant": the fixture line that expects the `docs/reviews/` entry to be excluded now expects it included | unit | HS | the exclusion is gone | R203-1 |
| G1 | `sb2-generator-scopes-each-legacy-entry-to-the-hashes-of-its-own-matches` | unit | G | output entry has the legacy path, pattern, reason verbatim, and sorted distinct hashes of its own matches only | R136-7 |
| G2 | `sb2-generator-is-idempotent-and-deterministic` | run-twice | G | second run on its own output is byte-identical | SE-0004 |
| G3 | `sb2-generator-drops-and-reports-a-legacy-entry-that-matches-nothing` | unit | G | dropped, counted, never written | R136-7 |
| G4 | `sb2-verify-rejects-a-widened-set` | mutation table | G | an added pair, an added hash no match has, a changed reason, a surviving legacy-shaped entry: each fails verify; the honest output passes | R136-7 |
| G5 | `sb2-generator-cli-prints-counts-only` | CLI | G | stdout and output file carry no raw literal and no hash in stdout | R136-8 |
| G6 | `sb2-generator-refuses-a-malformed-scoped-input` | unit | G | an input entry with a malformed `valueSha256` throws; the generator never guesses | R136-6 |

Existing tests edited (fixture shape only, meaning unchanged; instrument: the section 4 greps): in HS the tests that pass inline old-shape entries (partition split, allowlisted-but-reported, match-not-on-list, loader accepts a reason, loader rejects no reason, and the dogfood test which now loads through `loadAllowlist`); in PC the three fixture allowlists (hash of the fixture secret computed at runtime). The `REVIEWED_BASELINE` guard tests are not deleted or weakened; #203 adds pins and flips X1.

**Script checks (not permanent tests, they read a git ref):** R136-7 by the generator's verify mode against the legacy file at the story base (structural subset, every hash comes from a real match, allowlisted set after is a subset of allowlisted set before on the scanner's scope, counts printed); R136-8 by the section 4 greps, the spike's triple count and the generator's counts, attached verbatim to the build receipt; R136-9 by `node src/secret-scan/history-scan.ts` (exit 0, 0 blocking), `npm test` (0 fail, 0 skipped), `npm run typecheck`, `npm run lint`.

**#203 prose (R203-2).** In the source comment block of HS, delete the rule-11 immutability justification and the disclosed-residual sentences that pointed at Issue #203; state that report grants are pinned like every other file and that report immutability is not mechanically enforced (Issue #233). `docs/decisions.md` is not edited (append-only; the amendment row already supersedes).

## 7. Walking skeleton (first build step; the design-challenger round attacks this, not this document)

Thinnest end-to-end path, in the working tree, against a real git repo and the real CLI: (1) `scanBlobText` computes the hash at match time and the match carries it; (2) `partitionAllowlisted` partitions by value; (3) `isValidAllowlistEntry` accepts one migrated entry in a fixture allowlist; (4) T2 and P1 go red then green (red today because the old join exempts the whole file). Nothing else is built until the skeleton is shown green. Not yet migrated at that point: the real file, so T8, T9, T10 stay red until the migration; that is expected and listed.

## 8. Phase 2 order, hygiene, verification, rollback

| Step | Content | Hook state at commit |
|---|---|---|
| C1 | All named tests red (T1 to T13, P1 to P3, G1 to G6). Generator test fails to load (module absent): expected. Existing tests untouched. T3, T5's valid-entry control and the P1 positive control guard behavior that must not change, so they pass at C1 by design; the red set is enumerated from the run output, not typed here. | Old code plus old file: passes; tests use runtime literals |
| skeleton | in the working tree, uncommitted | n/a |
| C2 | Hash and loader and partition and unlock line; generator and verify; migrated file; existing-fixture edits: **one atomic commit**, because the strict loader on the legacy file blocks every match, so no intermediate state can commit | New code plus migrated file on disk: passes |
| C3 | #203: remove the prefix, pin the report grants (hashes computed by the derive instrument, reasons written by hand), prose fix, X1 flip | passes |
| C4 | CHANGELOG (no count claims), registry row promotion note (QA-13), `docs/backlog.md` item marked done | passes |
| drill | the `git commit-tree` novel-secret drill on the final tree, LAST, after every artifact is on disk | n/a |

Generation scope: history reachable from the story's base commit only (recorded at Phase 2 start), never the to-be-committed tree, so a new literal in my own diff blocks instead of being absorbed into the migration.

**Hygiene traps.**
1. No secret-shaped literal or allowlisted value is quoted verbatim in this story's artifacts; fixtures are built at runtime; prose describes them.
2. Per-commit invariant: the spike's union triple count must equal the base value (108); any new value in a changed file makes it 109. A raw literal committed in C1 under the old whole-file code would otherwise sit in history and block CI forever, so this check runs before C1.
3. Generate and verify the migrated file in a scratch directory; replace the tracked file only after verify passes; the legacy file stays recoverable from the base commit.
4. QA-14 (red on master, Issue #229) counts whole changed files: word-form Issue citations, existing repo paths only, failing-string text never re-quoted; baseline is 26 failing of 1381 citations (before this story's files); Phase 2 confirms the failing count does not move.
5. QA-15: no numeric completeness phrasing in HS comments or the CHANGELOG (the file self-checks on every `npm test`).

**Runtime.** The pre-commit scan is measured before (10.49 s median of 3) and re-measured after in the same session; acceptance: median of 3 within 10 percent of a same-session baseline, plus the direct hash cost in milliseconds.

**Rollback (SE ADR-0006).** Before merge: `git restore docs/qa/secret-scan-allowlist.json` plus stash the code, or `git revert` C2. After merge: `git revert` of C2 restores loader and file together. New loader and a damaged file: re-run the generator on `git show <base>:docs/qa/secret-scan-allowlist.json`; output is deterministic. Drill in a scratch clone: corrupt the migrated file, observe fail-closed with the measured blocking count, repair on disk, observe the commit passes without `--no-verify`. Blast radius of a bad migration: every commit and every CI run of the OSS-01 step, fail closed; the old loader also reads the migrated file (the extra field is ignored), so a code-only revert leaves a valid file. **[Superseded 2026-09-19, post-build review: reverting C2 alone leaves the suite red; revert the whole story as one unit. See Addendum 2, "Corrected rollback".]**

## 9. Files (Phase 2; derived from section 4, plus new files)

Modified: `src/secret-scan/history-scan.ts`, `src/secret-scan/history-scan.test.ts`, `src/secret-scan/pre-commit-scan.test.ts`, `docs/qa/secret-scan-allowlist.json`, `docs/qa/recurring-findings-registry.md`, `docs/backlog.md`, `CHANGELOG.md`. New: the generator and its test (both in `src/secret-scan/`, named in Phase 2), the spike and the draft ADR (already on disk). Must stay untouched, proved by an empty diffstat: `src/secret-scan/patterns.ts`, `src/secret-scan/pre-commit-scan.ts`, `src/secret-scan/simulated-commit.ts`, `.github/workflows/ci.yml`, `.githooks/pre-commit`, `src/lib/git.ts`. If any must change: stop and report.

## 10. Tier, reviewers, rule 15, test-first check

- **Tier PROPOSED: CRITICAL.** Justification: the secret-scanning sensitive area (the suppression list and the code that reads it), on a recurring hot path (every commit, every CI run; PRINCIPLES rule 20 (a)), whose failure mode (a widened exemption) is silent. Reversible by revert, which lowers likelihood of harm, not the ceremony. Persisted to `docs/.maat-state.json` as proposed; the Manager ratifies.
- **Chain expected:** design-challenger on the walking skeleton (pre-build, gating); post-build `red-team`, `app-security-reviewer`, `code-reviewer` (two domain reviewers, the cap) and `cross-domain-reviewer` (always). A fresh dated report per reviewer in `docs/reviews/`.
- **Rule 15 (first-ever instance of a pattern): my judgment is that it does not apply.** The named triggers (first background job, state machine, managed service, resumable write path) are absent, and the mechanism generalizes an idiom already in this repo (`REVIEWED_BASELINE`'s sha256 pins). The repeat-root-cause clause is keyed to two consecutive design-challenger NO-GOs and has not fired; the class has recurred (Issues #136, #193, #199 to #203) but the design ruling is content binding, which is the root-cause fix. Adding `architecture-reviewer` would draw on a sparingly used lane for no new question; `cross-domain-reviewer` already reads the draft ADR against the whole catalog. The Manager decides.
- **Test-first dispatch check (step 7).** Is there a new or changed UI flow or API surface? **No.** The externally observable surface is the two CLIs' exit codes and the allowlist file format: an internal gate, not a UI or API. `test-writer` is not dispatched by the CLAUDE.md trigger; the implementer writes the named tests red first. Option for the Manager: because this is a security control whose answer key the implementer authors, dispatch `test-writer` for T2, P1, T12 and T13 only (Question 3).

## 11. Draft ADR

`docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md`, id THOTH-ADR-0002, **status proposed**; never accepted by an agent. States the entry shape, the position on devops ADR-0008 (ratchet satisfied by the subset proof; time-bound clause deviated from and why; Gitleaks row not the same subject), the position on SE ADR-0001, migration and rollback, and residuals. Default was to draft it; a project-tier ADR is right because the entry shape is a security-control data model (SE ADR-0001) and THOTH-ADR-0001 is the precedent.

## 12. Out of scope (filed or already filed; nothing goes to `docs/backlog.md`)

Issue #233 report immutability (filed). Issue #234 stale sensitive-area globs (filed). Issue #235 entries that match nothing (filed). **Issue #236** (new, this planning; duplicate check found none): pre-commit-scan loads the allowlist from the working tree, demonstrated by a scratch drill.

## 13. Questions for the Manager (each has a default; only Question 1 changes acceptance wording)

1. **R203-3 reading (blocking acceptance wording).** "Attack E must FAIL at the gate level" cannot hold for a report grant that carries the literal's own correct hash: the gate has no oracle to tell an attacker's hash from a reviewed one (the architect's finding on in-file markers applies). The plan proves: legacy-shaped grant blocks at the gate (T12); self-hashed grant passes the gate and is caught by the baseline guard and the PR diff (T13); this residual is stated in the draft ADR. **Default if unanswered:** proceed with that reading. If a stronger gate is wanted, it is a different mechanism (branch protection or CODEOWNERS, Issue #233 territory).
2. **Granularity.** One entry per (path, patternId) with a hash list (50 entries, one reason each) versus one entry per triple (108, reason repeated). **Default:** the list. Reversible before C2.
3. **Test independence.** Whether to dispatch `test-writer` for the gate-level tests (section 10). **Default:** not dispatched.
4. **Generator retention.** The generator stays in the tree after the migration (its verify mode is what a reviewer re-runs); retiring it is a later, human-approved cleanup. **Default:** keep.
5. **Proposed ADR timing.** The code lands while THOTH-ADR-0002 is Proposed; the human accepts or declines it at the PR (THOTH-ADR-0001 was accepted before its PR merged). **Default:** ship the PR with the ADR Proposed.

## Addendum: design-challenger round 1 dispositions (2026-09-19, appended at Phase 2; sections 1 to 13 above are unchanged)

Source: `docs/reviews/s1-136-value-scoped-allowlist-design-challenger-2026-09-19.md`, verdict `go`, no valid HIGH. Its frozen set (hash boundary and parity, path keying and dedupe, loader fail-closed table, the issue 203 reading, consumer list, sequencing, rollback claim) is not reversed by anything below. Base commit recorded at Phase 2 start: 7b62344 (the generator's scope is history reachable from it).

### Manager answers to section 13

| Question | Answer | Effect on the build |
|---|---|---|
| 1. R203-3 reading | Accepted. The gate blocks a legacy-shaped report grant (T12). A self-hashed grant is a stated residual caught only by the baseline guard for an OMITTED pin and by the PR diff. | T13's name and assertion were overclaiming; renamed `oss01-attack-e-report-grant-without-a-baseline-pin-is-caught-by-the-baseline-guard`. The ADR says so. |
| 2. Granularity | One entry per (path, patternId) with a hash list. | Built as planned. |
| 3. `test-writer` | Not dispatched. | The implementer authored the tests, red first. |
| 4. Generator | Keep. | Kept in `src/secret-scan/`. |
| 5. ADR timing | Ship with THOTH-ADR-0002 Proposed; never marked accepted by an agent. Rule 15 does not apply. | Status stays proposed. |

### Dispositions of the findings

| Finding | Severity | Disposition |
|---|---|---|
| A3 skeleton adequacy | MED | Skeleton widened (below). |
| A2 generator re-run semantics and one-directional verify | LOW | Behavior defined and tested: an already value-scoped entry is carried through unchanged and never gains a hash (a re-run is a no-op); verify fails on a dropped entry or dropped hash that still matches. Tests `sb2-generator-never-adds-a-hash-to-an-already-scoped-entry`, `sb2-verify-rejects-a-dropped-entry-or-hash-that-still-matches`. |
| A5 hash of a blocked match in the CI-uploaded report | LOW | **Correction of section 5's self-contradiction.** Section 5 says no hash is printed for a blocked match and also that the report file gains the hash per match. The rule is: the hash appears in the report file (and in any log) ONLY for allowlisted matches, never for blocking matches. Test `sb2-report-file-omits-value-hash-for-blocking-matches`. |
| A6 spike file holds raw NUL bytes | LOW | Separators replaced by the printable escape; the spike still runs and prints the same triple counts. Test `sb2-no-tracked-text-file-is-skipped-as-binary`, derived from `git ls-files` with the scanner's own rule. |
| A7 unlock command and the hashed value | LOW | The unlock line states the hashed value is the regex MATCH text (key name, operator and quotes included for `generic-password-assignment` and `aws-secret-access-key`), and prints a per-pair command that runs in the Windows shell. Test `sb2-unlock-command-output-is-accepted-by-the-gate`, run for every pattern id in the catalog. |
| A8 a dropped entry is silent | LOW | The loader records each rejection (index, path, pattern id, reason class; never a value or hash); the blocking output names them. Test `sb2-rejected-entry-is-named-in-blocking-output`. |
| A4 the migration blesses the one value whose own entry says it is a real credential (issue 89, human-only, still open) | LOW | Fixed by wording, no new test: the ADR rule now reads "usable credential (a value that authenticates)", names this one truncated identifier-segment value as an explicit exception with a pointer to issue 89, states it is the human's decision at the PR (accept it as named, or rotate and remove per issue 89), and adds it to the residual table. The entry is not dropped silently. |
| A9 moved base | LOW | Residual only: if any allowlist or fixture change lands on the default branch before this merges, re-run the generator on the new legacy file (`generate --base <ref>`) and verify; CI goes red loudly otherwise (fails closed). |
| A1 pre-existing NUL-byte skip in the scanner | MED | Out of scope: issue 237, not gating. The scanner's binary-file rule is not touched. |
| Scariest unproven assumption (a reviewer approving opaque hashes is not reviewing values) | n/a | The generator's report and verify output print counts only, classified per pattern id (blessed values per pattern, under the dated-reports directory, credential-shaped); the Manager asks red-team to classify the blessed values independently after the build. |

### Widened walking skeleton (built before anything else, working tree, uncommitted)

Original (section 7): hash at match time, partition by value, loader accepts one fixture entry, T2 and P1 red then green. Added by A3:

1. A minimal generator (`generate` only) run against the REAL legacy file at the base commit, output to a scratch directory.
2. The real migrated file round trip (`sb2-skeleton-real-file-round-trip-scans-clean`), run as a SCRIPT check, not a permanent test: in a scratch clone at the base commit, the CI entry point scans the real history with the generated file and exits 0 with zero blocking, and the file's hash count equals the independent spike's triple count. A permanent test measured about 40 seconds inside the suite and repeats what CI's own full-history OSS-01 step already does on the same repo and the same file; the entry-point behavior it was meant to cover is pinned by the cheap subprocess tests in item 3. Dropped for cost; a one-line re-add if the Manager wants it permanent.
3. The history-scan CLI as CI runs it, spawned as a subprocess (`sb2-history-scan-cli-exits-nonzero-on-novel-secret-in-granted-file`, with a granted-alone control).

### Updated named-test list (generated from the test files by `git grep`, not typed)

```
oss01-entry-exempts-only-its-granted-values
oss01-allowlisted-file-still-blocks-a-novel-secret                         (unit/gate)
oss01-allowlisted-file-still-blocks-a-novel-secret (pre-commit CLI: three cells)
oss01-reviewed-literal-stays-allowlisted-and-reported
oss01-real-allowlist-refuses-a-novel-value-in-every-granted-pair
oss01-attack-e-legacy-shaped-report-grant-blocks-at-the-gate               (gate and pre-commit CLI)
oss01-attack-e-report-grant-without-a-baseline-pin-is-caught-by-the-baseline-guard   (renamed from T13)
OSS-01 allowlist: a docs/reviews/* credential grant is pinned to a baseline ... not excluded   (T11, red-team's name)
sb2-three-human-named-pairs-are-value-scoped
sb2-malformed-or-missing-scope-is-rejected-and-blocks
sb2-partial-migration-does-not-leave-legacy-shape-entries-honored          (loader and pre-commit CLI; plus a control each)
sb2-regex-edit-invalidates-entries-loudly
sb2-scanner-hashes-at-match-time-and-stores-no-raw-text
sb2-real-allowlist-loads-with-no-rejected-entry
sb2-rejected-entry-is-named-in-blocking-output                             (A8)
sb2-history-scan-cli-exits-nonzero-on-novel-secret-in-granted-file        (A3, plus a granted-alone control)
sb2-report-file-omits-value-hash-for-blocking-matches                      (A5)
sb2-unlock-command-output-is-accepted-by-the-gate                          (A7)
sb2-no-tracked-text-file-is-skipped-as-binary                              (A6)
sb2-generator-scopes-each-legacy-entry-to-the-hashes-of-its-own-matches
sb2-generator-is-idempotent-and-deterministic
sb2-generator-drops-and-reports-a-legacy-entry-that-matches-nothing
sb2-generator-never-adds-a-hash-to-an-already-scoped-entry                 (A2)
sb2-verify-rejects-a-widened-set
sb2-verify-rejects-a-dropped-entry-or-hash-that-still-matches              (A2)
sb2-generator-refuses-a-malformed-scoped-input
sb2-generator-reports-classification-counts-per-pattern
sb2-generator-cli-prints-counts-only
sb2-hash-lines-hash-the-regex-match-text
```

Plus the X1 flip (the existing fixture test now expects a report grant to be included; done in the first build commit so it is red first). The generator is `src/secret-scan/allowlist-tool.ts` and its tests `src/secret-scan/allowlist-tool.test.ts`.

### Phase 2 deviations from sections 1 to 13 (recorded plainly)

- Commit order: red tests, then a separate commit for the spike NUL fix, then the atomic migration commit, then the issue 203 commit, then docs. The spike fix is its own commit because it is independent of the atomic constraint.
- X1 flipped at the first commit, not at the issue 203 commit, so it is red first (section 8 said existing tests are untouched at C1).
- One more existing-test fixture edit than section 6 listed: the "matches present -> FAIL" test builds a `HistoryMatch` literal, and the type now requires the hash. Found by the typechecker; meaning unchanged.
- The C1 partial-migration pre-commit test first used three byte-identical fixture files, so the scanner's blob dedupe never evaluated the second and third path (residual R1 in action); the fixture now gives each file distinct bytes. It is red on the old code and green on the new.
- The real-repo round trip through the CLI is a script check, not a permanent test (see the widened skeleton, item 2). Its raw output is in the Phase 2 receipt.
- The unlock command needed a helper subcommand (`hash`) in the tool, because a printable command that is correct in every Windows shell cannot be a `node -e` one-liner.


## Addendum 2: post-build FIX-NOW round dispositions (2026-09-19; sections 1 to 13 and the first addendum are unchanged except one pointer in section 8)

Sources: `docs/reviews/s1-136-value-scoped-allowlist-{app-security,red-team,code,cross-domain}-2026-09-19.md`. Verdicts: app-security REWORK (HIGH, Issue 239), red-team no-go (the same HIGH found independently), code-reviewer SHIP (MED Issue 240 plus LOWs), cross-domain APPROVE-WITH-CONDITIONS. Every item below sits inside the approved scope; the Manager's dispositions are binding.

| Finding | Disposition |
|---|---|
| Issue 239 HIGH (also red-team F1; covers the symptom of Issue 238) | Fixed. A runnable unlock command is printed only for a path of `[A-Za-z0-9._/-]`; any other path gets a `NO-COMMAND-PRINTED` line that is not a command and carries the path percent-encoded, plus one how-to line that names no path (the sha256 of the whole matched text computed with a local sha256 tool, the note that the allowlist path field is the percent-decoded printed path, or rename the path; the earlier instruction to hand-quote the path was removed by a Manager ruling, Issue 241). Tests `sb2-unlock-command-never-embeds-a-shell-metacharacter-path` and `oss01-unlock-command-never-interpolates-shell-metacharacters-from-a-path`, written red first. Issue 238 stays open for the human to close. |
| Issue 240 MED | Pinned by `sb2-generator-and-verify-scope-history-and-legacy-file-to-the-base-ref` (green on the shipped code, red under three mutants). |
| Code LOW: ENOENT on an unstaged deletion | The binary-skip assurance reads blobs from the object database. New red-first test `sb2-no-tracked-text-file-is-skipped-as-binary-tolerates-an-unstaged-deletion`. |
| Red-team F3 | ADR residual reworded: the assurance covers the index; one blob of this story's own history is still skipped, its content measured clean, history is not rewritten. |
| Code LOW pins | `sb2-unlock-command-lists-ten-pairs-then-counts-the-rest`, `sb2-hash-command-prints-one-line-per-match-in-a-blob`. |
| Red-team F2 | Investigated by exhaustive enumeration: the newly-allowlisted count is reachable but never the only failure; kept as a second, direct measurement. Tests `sb2-verify-counts-and-names-a-widening` and `sb2-verify-widening-is-always-also-caught-structurally`. The wording "the subset is proven by the verify script" in section 5 and the first addendum is superseded by: the subset holds structurally (every migrated entry sits on a legacy pair with its reason verbatim, every listed hash is carried by a real match, an already value-scoped entry is unchanged), verify also counts newly allowlisted occurrences over the scanner's own matches (zero), and an independent instrument (red-team) reached the same zero. |
| Red-team F4, F5 | Residual-table lines in the ADR; a comment at the `LoadedAllowlist` type. No behavior change. |
| Cross-domain MED (catalog visibility) | The two missing rules added to the ADR frontmatter `constraints`; the served entry now pairs one-to-one with the body's MUST bullets (checked ad hoc by a parity script run during the round, not kept in the repo; the final batch adds the moved-base rule, so both lists hold nine). |
| Cross-domain LOW (rollback) | See the corrected rollback below. |
| App-security LOW residual rows | Added to the ADR: unanchored `aws-access-key-id`, the re-blessing moved-base recovery, the crackable hash of a wrong grant, the trust base. |
| Editorial | Present-tense comments in `history-scan.test.ts` that described the old whole-file semantics corrected (comments only); CHANGELOG sentences corrected. |

### Corrected rollback (supersedes the section 8 sentence "git revert of C2 restores loader and file together")

Revert the whole story as one unit: after merge, the merge commit with `git revert -m 1` (or the squash commit); on an unmerged branch, every commit after `7b62344` (the parent of `fefce23`) with `git revert --no-commit 7b62344..<branch tip>`, a range without a caret because cmd eats a caret (Addendum 3). Reverting only the migration commit (`f77cd56`) restores loader and file together and leaves the gate safe, but the suite is red: the red-first tests committed before it and the generator's test still expect the new behavior (cross-domain drill at commit 46e8d88 over the three secret-scan test files: 19 of 61 fail; at a later commit that revert also conflicts in two files, because the fix round edited them). Facts that stay true: an old loader reads the new file, and a damaged file is repaired by re-running `generate` on the legacy file at the base commit.

### Named-test list, regenerated by command (supersedes the hand-annotated list in the first addendum, which omitted two control tests)

```
git grep -h -o -E '^test\("(sb2|oss01)-[a-z0-9-]+' -- 'src/secret-scan/*.test.ts'   (names counted once; a repeated title is one name used by several cells)
oss01-allowlisted-file-still-blocks-a-novel-secret
oss01-attack-e-legacy-shaped-report-grant-blocks-at-the-gate
oss01-attack-e-report-grant-without-a-baseline-pin-is-caught-by-the-baseline-guard
oss01-entry-exempts-only-its-granted-values
oss01-real-allowlist-refuses-a-novel-value-in-every-granted-pair
oss01-reviewed-literal-stays-allowlisted-and-reported
oss01-unlock-command-never-interpolates-shell-metacharacters-from-a-path
sb2-generator-and-verify-scope-history-and-legacy-file-to-the-base-ref
sb2-generator-cli-prints-counts-only
sb2-generator-drops-and-reports-a-legacy-entry-that-matches-nothing
sb2-generator-is-idempotent-and-deterministic
sb2-generator-never-adds-a-hash-to-an-already-scoped-entry
sb2-generator-refuses-a-malformed-scoped-input
sb2-generator-reports-classification-counts-per-pattern
sb2-generator-scopes-each-legacy-entry-to-the-hashes-of-its-own-matches
sb2-hash-command-prints-one-line-per-match-in-a-blob
sb2-hash-lines-hash-the-regex-match-text
sb2-history-scan-cli-control-granted-literal-alone-exits-zero
sb2-history-scan-cli-exits-nonzero-on-novel-secret-in-granted-file
sb2-malformed-or-missing-scope-is-rejected-and-blocks
sb2-no-tracked-text-file-is-skipped-as-binary
sb2-no-tracked-text-file-is-skipped-as-binary-tolerates-an-unstaged-deletion
sb2-partial-migration-control-all-valid-entries-are-honored
sb2-partial-migration-does-not-leave-legacy-shape-entries-honored
sb2-real-allowlist-loads-with-no-rejected-entry
sb2-regex-edit-invalidates-entries-loudly
sb2-rejected-entry-is-named-in-blocking-output
sb2-report-file-omits-value-hash-for-blocking-matches
sb2-scanner-hashes-at-match-time-and-stores-no-raw-text
sb2-three-human-named-pairs-are-value-scoped
sb2-unlock-command-lists-ten-pairs-then-counts-the-rest
sb2-unlock-command-never-embeds-a-shell-metacharacter-path
sb2-unlock-command-output-is-accepted-by-the-gate
sb2-verify-counts-and-names-a-widening
sb2-verify-rejects-a-dropped-entry-or-hash-that-still-matches
sb2-verify-rejects-a-widened-set
sb2-verify-widening-is-always-also-caught-structurally
```

The dated-report pin test keeps red-team's own title (`OSS-01 allowlist: a docs/reviews/* credential grant is pinned to a baseline ...`) and is not in the list above because it does not carry an `sb2-` or `oss01-` prefix.


## Addendum 3: round-3 dispositions (2026-09-20)

Sources: `docs/reviews/s1-136-value-scoped-allowlist-{app-security,red-team}-round3-2026-09-20.md`. Verdicts: app-security APPROVE, red-team go with two MED (Issues 243 and 244) and three LOW.

| Finding | Disposition |
|---|---|
| Red-team F1, Issue 243 MED | Fixed. The rejected-entry line shows the allowlist entry's path and pattern id percent-encoded and clipped to a fixed length (a lone percent sign for a non-string or empty value). Test `oss01-rejected-entry-line-never-carries-a-shell-metacharacter-from-the-allowlist-file`, red first, with a positive control that the raw-echo shape executes here. `REJECTED-ALLOWLIST-FILE` carries no file text. Other places allowlist-file text is printed: the blocking-match and ALLOWLISTED lines (pre-existing, Issue 241) and the problem lines of `allowlist-tool verify`, which round four then closed (see below). |
| Red-team F2, Issue 244 MED | The how-to sentence is one constant, pinned verbatim by `oss01-unlock-no-command-line-is-pinned-verbatim-and-every-printed-line-is-checked`, which also classifies every printed detail line through the unit output and the real CLI. The blacklist test stays. |
| Red-team F4, F5, app-security LOW 2 | The how-to now says the allowlist entry's path field is the percent-decoded form of the printed path (measured: it unblocked every name tried), that the hashed text is the whole regex match with no trailing newline, and that the sha256 tool is local. |
| Red-team F3 | The rollback range is written without a caret (see the ADR). Drilled in a scratch clone: reverting every commit after `7b62344` restores that tree byte for byte and the secret-scan test files pass. |

### Round four (2026-09-20): the verify tool's own output

The Manager put `allowlist-tool.ts` in scope after round three named its `verify` problem lines as an unencoded sink of the same class as Issue 243. Test `oss01-allowlist-tool-verify-problem-lines-never-carry-a-shell-metacharacter-from-the-allowlist-file`, written red first. Fixed: every problem line, and the per-pattern classification line, shows the entry's path and pattern id through the same `clip()` helper (exported from `history-scan.ts`, one encoder); unparseable input gets a fixed message. Still echoing argv the developer typed, by grep of the tool's output sites: the `hash` subcommand's errors and the base ref in one error.
