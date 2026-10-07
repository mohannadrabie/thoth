# s308-archive-sweep: red-team review, round 1 (2026-10-06)

[red-team] Red Team (Sutekh), attacking s308-archive-sweep with failure scenarios.

- Scope: `git diff 2708cd8 7641053` (4 files: `docs/qa/secret-scan-allowlist.json` +1 entry; `docs/decisions.md` -6 rows; `docs/decisions-archive.md` +6 rows; `CHANGELOG.md`). Tier CRITICAL.
- Worktree: `C:\playground\thoth-kb-rev`, detached at `7641053`. Nothing committed by this review.
- Plan: `docs/plans/s308-archive-sweep-plan-2026-10-06.md`. Governing ADR: THOTH-ADR-0002 (proposed; its rules are served).
- ADR cache: `📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog — ≈18800 tokens saved this pass (fp da6ef03) [CACHE=HIT]`. Read: THOTH-ADR-0002 in full (security/state rules of this surface); devops ADR-0008 ratchet clause as quoted by ADR-0002.

## Verdict: go

The new entry exempts exactly one value (the sha256 of the reserved-domain example address) at exactly one path under exactly one pattern id. I could not make it exempt anything else. The sweep is lossless, byte-identical and order-preserving, measured by script. No non-due row moved and no due row was left behind. QA-14, QA-15, both secret scans and all 175 secret-scan tests pass. Three LOW findings, none blocking. One of them (attack 6) must be fixed before this round's reports are committed: two sibling review reports quote the literal and would block the pre-commit scan.

## Attacks, ranked by exposure x irreversibility x silence

### 1. The entry exempts more than one value at one path. SURVIVES (demonstrated)

Assumption under attack: the exemption is `(path, patternId, sha256(match))` with no normalization that could widen it.

Code: `partitionAllowlisted` (`src/secret-scan/history-scan.ts:341-360`) keys on the raw string `${path}\0${patternId}` and checks `.has(m.valueSha256)`. No case folding, no path normalization. Paths come from git plumbing (`ls-tree`, `ls-files -s -z`, `diff --cached --name-status -z`; `src/secret-scan/simulated-commit.ts:79-138`), so they are forward-slash and case-exact. The hash is over the regex match text (`history-scan.ts:102-106`, `:234`).

Probe (scratch script calling the real `loadAllowlist`, `scanBlobText` and `partitionAllowlisted` against the real allowlist file):

```
entries 52 rejected 0
"docs/decisions-archive.md"          "row quotes [literal] here"                  matches=1 allowlisted=1 blocking=0
"docs/decisions-archive.md"          "row quotes -[literal] here"                 matches=1 allowlisted=1 blocking=0   (same 16-char match text)
"docs/decisions-archive.md"          "row quotes [literal, T upper-cased] here"          matches=1 allowlisted=0 blocking=1
"docs/decisions-archive.md"          "row quotes [literal].evil.io here"        matches=1 allowlisted=0 blocking=1
"docs/decisions-archive.md"          "row quotes [other user at example.com]"         matches=1 allowlisted=0 blocking=1
"docs/decisions-archive.md"          "row quotes [real-domain address] here"     matches=1 allowlisted=0 blocking=1
"docs/decisions-archive.md"          "key AKIA[16 chars] here"                   matches=1 allowlisted=0 blocking=1   (other pattern, same path)
"docs/Decisions-Archive.md"          [literal]                                   allowlisted=0 blocking=1   (case variant)
"./docs/decisions-archive.md"        [literal]                                   allowlisted=0 blocking=1
"docs/decisions-archive.md "         [literal]                                   allowlisted=0 blocking=1
"docs/decisions-archive.mdx"         [literal]                                   allowlisted=0 blocking=1
"docs/archive/decisions-archive.md"  [literal]                                   allowlisted=0 blocking=1
archive entries: [["email-address",["973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b"]]]
utf16 collision string matches: 0
```

([literal] stands for the reserved example address, redacted so this report does not itself trip OSS-01.) (A backslash-path probe was mangled by the shell quoting, so I make no claim about it. Git never emits a backslash path, so that input cannot come from the scanner.)

- Hash of match text vs bare value: `node -e` sha256 of the latin1 bytes of the literal = `973dfe46...813b`, equal to the new entry and to the existing `docs/decisions.md` entry. For this pattern the match text is the bare address, so the two are the same.
- Different pattern, same bytes: the grant map key includes `patternId`, so a different pattern match on the same bytes is never exempted (row "AKIA" above; also by construction).
- Prefix/suffix tricks: a leading non-word char gives the same 16-char match (the same value, so no widening). Every suffix or case change gives a different match text and blocks.
- UTF-16LE collision: CJK code units whose LE bytes spell the literal give 0 email matches (`\w` is ASCII-only), so the `hashMatchedBytes` utf16le branch cannot reach the granted hash.
- Archive growing over time: any other value later swept into the archive gets a different hash and blocks (attack 7 shows the next real instance).

Gate and negative control on the real HEAD archive blob: `with entry: blocking 0 allowlisted 2 | without entry: blocking 2 allowlisted 0`. The entry is exactly what unblocks the 2 matches. Allowlist delta by script: `entries 51 -> 52 hashes 109 -> 110`, `dup pairs 0`, every old entry byte-present, one entry added, the new reason does not contain the raw literal (ADR-0002 rule), numstat `8 0`.

### 2. The sweep loses, alters, duplicates or reorders a row. SURVIVES (demonstrated)

Scratch `verify.mjs` over `git show` of both files at `2708cd8`, `0f980ff` and `7641053`, compared as latin1 Buffers:

```
eol dec pre/post LF LF arc pre/post LF LF
dec unchanged by allowlist commit: true
post is ordered subsequence of pre: true removed: 6
archive pre is exact line-prefix of post: true added: 6
removed == added, byte-identical, same order: true
  moved pre-line 18 | 2026-08-29 | ... bytes 1102
  moved pre-line 43 | 2026-09-13 | ... bytes 2442
  moved pre-line 47 | 2026-09-13 | ... bytes 3406
  moved pre-line 53 | 2026-09-19 | ... bytes 3198
  moved pre-line 54 | 2026-09-19 | ... bytes 2866
  moved pre-line 85 | 2026-09-27 | ... bytes 2823
added rows already in archive pre: 0 ; still in decisions post: 0
bytes pre total 500724 post total 500724 delta 0
```

The archive is append-only (the old archive is an exact line prefix of the new one). No row was duplicated or lost, and the combined byte count is unchanged.

### 3. A non-due row moved, or a due row stayed. SURVIVES (demonstrated)

- Independent cell read of the 6 moved rows (header at line 12, `Human ratified` col 5, `Review-back date` col 6): every row has 6 cells, a `Y`-prefixed ratified cell, a review-back date of 2026-09-20 to 2026-10-04 (all before 2026-10-06), and no `~~` or "supersed" marker. One row has the ratified cell `Y (delegated: human said "I preapprove...")`. That passes the script rule `^(Y|N)\b` and the human-approved plan lists it, so it is not a defect.
- A dry run in a scratch copy of the pre-sweep files gives the same 6 rows. A dry run on HEAD gives `0 rows eligible`. System date is `2026-10-06`, so no due row was left behind.

### 4. The sweep breaks doc citations. SURVIVES (demonstrated)

- QA-14 in CI diff mode (`node src/qa/reference-resolver.ts origin/master HEAD`, merge-base = origin/master = 6a780a4): `PASS: 678 citation(s): 453 resolved, 225 unclassified (non-blocking ...) — 0 failed.` Exit 0.
- QA-15 (`node src/qa/completeness-claim-checker.ts`, the CI step): `PASS: 2 file(s) checked`.
- Positional references ("row above/below", "previous row") in the remaining `docs/decisions.md` rows whose neighbour changed: scripted scan found 0. In the archive, the moved `s1-226` row says "named in the previous row". Its predecessor is still the `s1-227` row, because order is preserved.
- Ordinal citations across the repo (`git grep` for first...sixth/newest/last + an affected date + "row"): CHANGELOG.md:375, docs/STATE.md:340 and `rule-reachability.test.ts:7` cite "second 2026-09-27 row". That is still the S7-C stage-3 triage row (the moved #252 row was third). THOTH-ADR-0002:28/143 and a 09-19 review cite "the two newest 2026-09-19 rows". Those are still Story B and s1-135 (the moved rows were 3rd and 4th of six). Every ordinal still resolves to the same row.
- No CI append-only step exists for these files (`grep -i append .github/workflows/ci.yml`: none). Attack 2's prefix check is the append-only proof.

### 5. The `docs/decisions.md` email entry is now dead (Issue #235) and a cleanup removes it. SURVIVES (demonstrated). The premise is false.

The plan (lines 55 and 133) says the entry "matches nothing until a future row quotes the literal again". It is wrong for the history scan, which walks every blob reachable from HEAD:

```
history-scan ALLOWLISTED decisions.md email lines: 233   (distinct historical commits, e.g. 003613793e40, 0f980ff3a95f ...)
HEAD decisions.md literal count: 0
```

The entry still carries 233 historical matches and is load-bearing. Removing it would turn `oss:secret-scan` red. It is not dead under the definition in Issue #235 ("stops matching any blob in history or the tree"), so #235 is not triggered. This also corrects the LOW suspicion in the app-security review ("dead decisions.md grant"). The same holds for the new archive entry from now on: once `7641053` is in history, reverting the sweep does not make the entry inert (plan line 125 says it does), because the archived blob stays reachable. A revert of the allowlist commit alone would block (fail closed, loud).

### 6. This review round's own artifacts re-break OSS-01 when committed. BREAKS, LOW (demonstrated). Fails closed. Recurring class (#183).

Not in the diff under review, but it decides whether this round can close. The real gate functions (`loadAllowlist`, `scanBlobText`, `partitionAllowlisted`) run over the working-tree review artifacts of this round:

```
docs/reviews/s308-archive-sweep-red-team-2026-10-06.md     matches 0 blocking 0
docs/REVIEW_LOG.md                                          matches 6 blocking 0
docs/reviews/s308-archive-sweep-app-security-2026-10-06.md matches 4 blocking 4 email-address:test...[REDACTED 16 chars] x4
docs/reviews/s308-archive-sweep-cross-domain-2026-10-06.md matches 1 blocking 1 email-address:test...[REDACTED 16 chars]
```

Trigger: the Manager stages and commits the three reports. The pre-commit scan blocks with 5 matches, and so would the CI OSS-01 history step. The cause is that two reports quote the reserved example address verbatim, and neither report path has a grant. This is the same self-referential contamination as #183 (CHANGELOG.md:915 counts it as the 4th occurrence then). Current defense: fail closed and loud, with nothing exposed. The wrong fix is a new allowlist entry per report path, which would be another sensitive-area change and widen the grant set. The right fix is to redact the literal in those two reports, as this report does.
Exposure: 2 of 3 review reports of this round (counted by the gate run above); 100% of commits that include them as written.
Proof-test: `pre-commit-scan on the staged round-1 review artifacts reports 0 blocking` (run before the review commit).

### 7. The next sweep re-blocks on another allowlisted literal. BREAKS, LOW (demonstrated). Fails closed, a residual.

Remaining `docs/decisions.md` rows that carry a scanner match (scratch probe over the HEAD blob):

```
decisions.md entries: [["email-address",1],["aws-access-key-id",1]]
 row 42 2026-09-14 ... -> aws-access-key-id:228e2fa9:granted-at-archive=false
 row 43 2026-09-14 ratified: "pending" review-back: 2026-09-21 -> aws-access-key-id:228e2fa9:granted-at-archive=false
```

Trigger: the human ratifies row 43, so it becomes due (review-back 2026-09-21 has passed). The next handoff sweep moves it, and the pre-commit scan blocks the sweep commit. This is the same #379 class with a credential-shaped pattern, so the unlock also needs a `REVIEWED_BASELINE` pin (ADR-0002). Current defense: fail closed and loud. The block names its unlock, and nothing leaks. The cost is another CRITICAL-tier allowlist change per sweep, and the dry run gives no warning ahead of time.
Exposure: 2 of 113 remaining dated rows (counted: `git show 7641053:docs/decisions.md | grep -c "^| 20[0-9][0-9]-"` = 113; matches by probe); 0 silent outcomes.
Proof-test: `decisions-sweep-dry-run-flags-candidate-rows-with-unexempted-archive-matches` (dry run scans the candidate rows under the archive path and names any match that the archive grants do not cover). This is a backlog item. It is not a condition on this change.

### 8. Issues this change resolves are not linked, so they stay open. BREAKS, LOW (code-traced)

`git log 2708cd8..7641053` and the CHANGELOG entry cite `Refs #183` (closed) and `#308`. Open Issues #379 ("Decision-log archive sweep blocked by OSS-01...", chore/ci) and #298 ("Archive the two 2026-09-13 decision rows...", severity:low) describe exactly this fix. No `Closes`/`Fixes` reference ties them to the PR (CLAUDE.md Issue Discipline 2). After merge they stay open with nothing behind them.
Fix: the PR body carries `Closes #379` and `Closes #298` (one per Issue, per the #308 auto-close memory), or the Manager closes both at merge with a comment.
Proof-test: `post-merge: gh issue view 379/298 state == CLOSED (completed)`. This is a process check, not a code test.

## Checks run (raw)

- Probe of the real partition logic: 13 cases, all as expected (above).
- Sweep byte-identity script: all assertions true.
- `node docs/decisions-archive.mjs` dry run: pre-state 6 eligible; HEAD 0 eligible.
- `node src/secret-scan/history-scan.ts`: exit 0, `PASS: Full history scanned, 0 blocking secret-shaped matches found (3949 allowlisted)`. The 2 `docs/decisions-archive.md` matches at `7641053` are ALLOWLISTED.
- `node src/secret-scan/pre-commit-scan.ts`: exit 0, `PASS: ... 0 blocking ... (275 allowlisted)`.
- `node --test` over the 5 secret-scan test files: `tests 175, pass 175, fail 0, cancelled 0, skipped 0`. The cross-domain reviewer saw 2 failures under load. This run, with no other load from me, was clean.
- QA-14 diff mode: PASS 678, 0 failed. QA-15: PASS.
- Negative control (in memory, real HEAD archive blob): without entry 2 blocking; with entry 0.
- Gate run over this round's 4 review artifacts in the working tree: red-team report 0 blocking; REVIEW_LOG.md 0 blocking (6 granted); app-security report 4 blocking; cross-domain report 1 blocking (attack 6).

## Single scariest unproven assumption

None of this change's own assumptions is unproven. The nearest one is outside this diff: that every future sweep is dry-run against the scanner before `--apply`. Nothing enforces it, and attack 7 is the next concrete instance. It fails closed, so the risk is friction, not exposure.

Go/no-go: go. Next action: before committing this round's review artifacts, redact the literal in the app-security and cross-domain reports (attack 6) and rerun the pre-commit scan. Then the Manager adds `Closes #379` and `Closes #298` to the session PR body and files attack 7's proof-test as a backlog Issue.

## Editorial

- Plan lines 55 and 133 call the `docs/decisions.md` email entry one that "matches nothing" or "points at nothing". It carries 233 history matches (attack 5).
- Plan line 125: "The entry is inert without the archive matches". After merge the archived blob is permanent history, so the entry never becomes inert.
- Plan AC A2 expected an `allowlist-tool verify` run. The CHANGELOG replaces it with a script-measured delta and calls verify "migration-only". That is a reasonable reading of ADR-0002 (the count-delta MUST applies to `generate --base`), but it is a stated deviation from the approved AC. The delta itself (51->52, 109->110) reproduces.

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [CLEAN][demonstrated] New entry exempts only sha256(reserved example address) at the exact path under email-address; case/./suffix/other-value/other-pattern/utf16-collision probes all block; negative control 2 blocking without entry, 0 with
2. [CLEAN][demonstrated] Sweep lossless: 6 rows removed == 6 appended, byte-identical, same order, archive pre is exact prefix, combined bytes delta 0, LF preserved
3. [CLEAN][demonstrated] Only due rows moved (all Y-ratified, review-back before 2026-10-06, unstruck); pre dry run = same 6, HEAD dry run = 0 eligible
4. [CLEAN][demonstrated] Citations intact: QA-14 diff mode 0 failed of 678; QA-15 PASS; 0 broken positional refs; every ordinal date-row citation still resolves to the same row
5. [CLEAN][demonstrated] decisions.md email entry is NOT dead: 233 history matches, so #235 is not triggered and the entry must stay (refutes app-security LOW suspicion)
6. [ISSUE][LOW][demonstrated] This round's app-security (4) and cross-domain (1) reports quote the reserved example address at ungranted paths; committing them blocks the pre-commit scan (recurring #183 class); fix by redaction, not a new grant
7. [ISSUE][LOW][demonstrated] Next sweep re-blocks: 2 of 113 remaining rows carry an aws-access-key-id value granted only at decisions.md; fails closed, dry run gives no warning; backlog proof-test named
8. [ISSUE][LOW][code-traced] Open Issues #379 and #298 are resolved by this change but not referenced (only Refs #183/#308), so they stay open after merge
counts: issues=3 suspicions=0 clean=5
evidence: demonstrated=7 code-traced=1 derived=0
checks=secret-scan tests 175 pass/0 fail/0 skip; history-scan PASS 0 blocking (3949 allowlisted); pre-commit-scan PASS 0 blocking (275); QA-14 678 cites 0 failed; QA-15 PASS; partition probe 13/13 as expected; sweep byte-identity 5/5 assertions true; negative control 2 blocking without entry / 0 with; round-artifact gate scan 4 files: 2 with blocking matches (5 total)
adr=HIT(38)
report=docs/reviews/s308-archive-sweep-red-team-2026-10-06.md
