# s1-237-nul-byte-scan: application security review (Horus), 2026-09-20

[app-security-reviewer] App Security Reviewer (Horus). Tier CRITICAL (secret-scanning sensitive area), domain lane app-security. Story: Issue 237 (narrowed: the NUL skip and the 0xA0 miss; UTF-16 is Issue 246). Branch fix/s1-237-nul-byte-scan, HEAD 942d8ac, delta e42a54f..HEAD (4 commits). Reviewed as the adversary: can a secret in a NUL-bearing blob still pass, can the newly scanned bytes leak or inject into output, what regressed.

ADR: 📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog, about 18300 tokens saved this pass (fp e6c5377) [CACHE=HIT]. Security-domain rules read: THOTH-ADR-0002 (proposed, served like accepted). No violation: no exemption shape added, the hash is still computed at match time over the matched bytes, and the boundary change moves no allowlisted value (0 of 50 entries use the affected pattern; verify PASS, fresh generate byte-identical, below).

## Verdict: APPROVE

No blocker, no hardening required before merge. Two LOW findings (a measured cost and a pre-existing sibling of Issue 247). No Issue filed for either (a LOW never spawns one).

## What ran (raw output, counts)

| Check | Command / instrument | Result |
|---|---|---|
| Secret-scan tests, two files | `node --test src/secret-scan/patterns.test.ts src/secret-scan/pre-commit-scan.test.ts` | tests 39, pass 39, fail 0, skipped 0 |
| Secret-scan tests, two more files | `node --test src/secret-scan/history-scan.test.ts src/secret-scan/allowlist-tool.test.ts` | tests 92, pass 92, fail 0, skipped 0 |
| Gate on the real repo | `node src/secret-scan/history-scan.ts` | PASS: Full history scanned, 0 blocking secret-shaped matches found (1948 allowlisted). exit 0 |
| Story spike, re-run | `node docs/spikes/s1-237-nul-blob-counts-2026-09-20.mjs` | 1097 distinct blobs, 1 formerly skipped (6141 bytes, 0 matches); triples old 108, new 108, only-old 0, only-new 0; STOP (a) none, STOP (b) none |
| Allowlist unchanged | `allowlist-tool.ts generate --base 7b62344 --out <scratch>` then `cmp`; `verify --base 7b62344 --migrated docs/qa/secret-scan-allowlist.json` | byte-identical; PASS, 50 entries, 108 hashes, occurrences 1540 before and 1540 after, newly allowlisted 0, newly blocking 0 |
| Untouched paths | `git diff e42a54f..HEAD --stat` over the allowlist file, pre-commit-scan.ts, simulated-commit.ts, allowlist-tool.ts, ci.yml, .githooks/pre-commit, src/lib/git.ts | empty diffstat |
| Binary-to-git files | `git ls-files --eol`, count of i/-text | 0 |
| Independent drills | scratch Node scripts in the session scratchpad (not committed), literals built at runtime, temp git repos | sections A to E |
| Mutation battery | 4 mutants applied to a scratch copy of the tip, the new named tests re-run | section F |

Executed test cases: 131 pass, 0 fail, 0 skipped (39 plus 92), plus the mutation runs.

## A. Detection at both entry points (demonstrated, CLEAN)

70 files (10 pattern ids, each in 7 layouts: NUL at offset 0, 7999 and 9000, PNG-header prefix, 3000 NUL bytes of padding on both sides, NUL adjacent to the literal, high bytes plus NUL). One commit for the CI CLI and one staged tree for the hook CLI. Expected (path, pattern id) pairs: 70.

```
NEW history-scan CLI  : exit=1 expectedPairs=70 missing=0
BASE history-scan CLI : exit=1 expectedPairs=70 missing=60
NEW pre-commit CLI    : exit=1 expectedPairs=70 missing=0
BASE pre-commit CLI   : exit=1 expectedPairs=70 missing=60
```

The 10 pairs the base does find are the "NUL at 9000" layout (past the 8000-byte window), so the base control also shows the defect. Real installed hook, scratch clone with core.hooksPath set to .githooks: on this tip, git commit of a NUL-bearing file with a runtime-built key exits 1 and names the path (0 occurrences of the literal in the hook output). The same commit on base e42a54f exits 0 and lands.

No other skip path exists. git grep over non-test src finds no NUL or binary test other than the deleted one. scanBlobText is reached only through scanHistory and the hash subcommand, and both entry points call scanHistory (history-scan.ts:98, pre-commit-scan.ts:54). catFileBlob reads git cat-file -p as latin1 with no filter (git.ts:117-123).

## B. Can the newly scanned bytes leak or inject into output? (demonstrated, CLEAN)

- Every printed match line carries only redact(match): the first 4 characters of the match plus a length. Those 4 characters come from a letter, digit, underscore, dot, plus or hyphen, or the literal prefix (four hyphens, AKIA, pass, aws_), because the word-character escape is ASCII-only without the u flag. A control byte cannot reach the prefix (patterns.ts:80-83).
- Drill: a NUL-bearing blob whose lines carry a screen-clear sequence, an OSC title sequence, BEL, CR and an ESC inside a password value. Output: exit 1; bytes outside printable ASCII and newline: none (the only non-ASCII in any output is the constant ellipsis); the key body and the password value absent; no 64-hex run. The redacted report JSON: key body absent, value absent, no raw ESC, no hash (a blocking match carries none).
- Same over the 70-file drill (section A): secretFragmentsInOutput=[], oddOutputBytes=[], hexRunOf64=false, for both CLIs.
- A NUL-bearing path cannot exist: a git tree entry name is NUL-terminated by the object format, so no output line can carry one (format fact, not exercised: git offers no way to write one).
- Hostile paths holding a NUL-bearing blob (12 tree entries written as a raw tree object with hash-object --literally: ESC sequence, CR, tab, newline, double quote, space, shell metacharacters, U+202E, an accented character, backslash, leading dash, 300 characters). Result: 12 of 12 matches printed, one line each, control characters escaped by git (for example a path shown as "a\033[31mb.bin"), 0 runnable commands printed for them, 10 NO-COMMAND lines (the ten-pair cap, then the omitted-count line). Under core.quotePath=false the raw bytes of U+202E and the accented character are echoed on the match line. That is the disclosed raw-path class (Issue 241, ADR residual row). The story adds no print site and no new class, only more blobs that can reach the existing one.

## C. Allowlist hash for NUL-bearing matches (demonstrated, CLEAN)

A match can itself contain NUL and latin1 high bytes (the value class and the PEM body allow them). Fixture: a NUL, then a generic-password assignment whose value holds a NUL, 0xA0 and 0xE0 0xA0, all in a NUL-bearing blob.
- The sha256 computed independently in the drill over the raw bytes equals the gate hash. A hand-written allowlist entry with that hash gives exit 0 and an ALLOWLISTED line at the CI CLI, and exit 0 at the hook CLI.
- allowlist-tool.ts hash (commit, path, generic-password-assignment) prints a first hash equal to the independent one (the latin1 round trip is exact over NUL).
- A second, novel literal added to the same NUL-bearing file blocks at both entry points (exit 1). Its value and its hash are not printed.

## D. False negatives and false positives from the class change (demonstrated, CLEAN for negatives)

- Monotone: the new value class (ASCII whitespace listed by hand) excludes strictly fewer characters than the old one (the whitespace escape, which also excluded 0xA0 and, outside latin1, U+1680 to U+FEFF whitespace). It matches everything the old class matched. Confirmed by instrument: spike triples 108 old, 108 new, 0 only-old, 0 only-new over history and the simulated tree; verify 1540 before, 1540 after, 0 and 0.
- The tests kill a revert of the class (section F, M3).
- The four separator whitespace-star tokens stay as ruled. Not re-litigated.
- False positives are finding 1.

## E. Regex cost on newly scanned blobs (demonstrated)

A NUL byte does not change exposure to Issue 247: an attacker who wants a slow blob omits the NUL, and the old skip only shielded a blob that also carried one.
- Hyphen-joined run, 20000 characters: 576 ms plain, 587 ms NUL-prefixed. At 40000 characters on a noisy machine (two runs): plain 4405 and 6937 ms, NUL-prefixed 8932 and 7568 ms, the same order. A NUL placed at each thousandth byte breaks the run and is faster (32 ms at 20000).
- Binary shapes, 50 MB each, whole catalog: zeros 1569 ms, 0xFF 741 ms, random 4696 ms (the spike run: 3370 ms on random). Linear; no pathological binary shape found.
- See finding 2 for a sibling shape.

## F. Test strength (demonstrated, CLEAN)

Scratch copy of the tip, one mutant at a time, the story named tests run with --test-name-pattern matching oss01-(nul|no-|high|utf8|ascii|latin1) over the three test files:

| Mutant | Result |
|---|---|
| M0 none (control) | 39 pass, 0 fail |
| M1 skip a blob with NUL in the first 8000 bytes (the old rule) | 16 pass, 23 fail |
| M2 skip a blob with NUL anywhere | 11 pass, 28 fail |
| M3 value class reverted to the whitespace escape | 35 pass, 4 fail (oss01-utf8-character-ending-in-0xa0-does-not-hide-a-password, oss01-no-negated-whitespace-class-hides-a-high-byte, oss01-high-byte-in-a-password-value-does-not-hide-it, plus one subtest) |
| M4 decode as utf8 instead of latin1 | 36 pass, 3 fail |

4 of 4 mutants killed, 0 survivors. A first M3 attempt did not apply because of a quoting slip in my patch script; its 39/0 result was discarded, and the mutant was re-applied and confirmed before the numbers above.

## G. The spike script own safety (code-traced, CLEAN)

docs/spikes/s1-237-nul-blob-counts-2026-09-20.mjs prints counts, the JSON-quoted path of a formerly skipped blob and a 12-character blob sha. It never prints a matched value, a value hash or a redaction prefix (the redacted field is stored in a map and never logged). It makes no file writes; the only side effect is the dangling tree and commit object that buildSimulatedCommit writes (same as the hook), plus temp-index cleanup in a finally block. No raw NUL byte in the file (git ls-files --eol: 0 i/-text), and the gate passes with the file in history.

## Findings, ranked by exposure x irreversibility x silence

### 1. [ISSUE][LOW][demonstrated] Real binaries block far more often than a chance match suggests: allowlist churn if this repo ever tracks executables or fonts

Evidence (a scan of the reviewer machine own NUL-bearing binaries with scanBlobText, not this repo blobs):

```
random 200 MB total chance matches 13 {"email-address":13}
real NUL-bearing binaries scanned: 904 files, 475 MB; files with any match: 213 {"internal-hostname":182,"email-address":345,"ipv4-private":9,"private-key-block":2,"aws-access-key-id":1}
by extension (files, files with a match): png 23/0, gif 13/0, ico 3/0, dll 328/48 (15%), exe 364/188 (52%), ttf 343/177 (52%)
```

The plan residual row frames a legitimate binary as a chance match (about 0.07 per MB of random data). Executables and fonts carry real embedded emails and hostnames, so the rate per file is 15 to 52 percent, with many matches per file and one allowlist hash each. Attack sketch: none (a nuisance, fails closed). Exposure: ~0% of this repo blobs today, basis: measured (spike: 0 of 1097 newly blocking; no tracked binary). The per-extension rates come from a foreign corpus and are illustrative. Minimal fix: none in code (the ruling stands). Correct the residual wording in the plan and the ADR row to say executables and fonts commonly match while images did not (0 of 39), so the next contributor is not surprised. Wording only; no test.

### 2. [ISSUE][LOW][demonstrated] private-key-block is quadratic on repeated BEGIN markers with no END (pre-existing sibling of Issue 247, not NUL-specific)

Evidence: the 27-character BEGIN marker repeated k times, no END, whole catalog: k=500 17 ms, k=1000 66 ms, k=2000 401 ms (6x for 2x input, at 54 KB). NUL-prefixed: 19, 54, 370 ms. The lazy any-character scan between the markers restarts at each marker and runs to the end of the blob. Attack sketch: a contributor commits a large blob of repeated markers to stall CI or the hook (fails closed, no bypass); extrapolation to megabyte size is derived, not measured. Exposure: ~0% of runs today, basis: measured (no such blob in history). Minimal fix: fold it into Issue 247 as a comment and fix with a linear formulation when that Issue is taken (it changes a match boundary, so the ADR re-derivation rule applies). Named test that settles it: oss01-scan-time-is-linear-on-a-long-hyphen-run extended with a repeated-BEGIN cell, out of this story.

### CLEAN (verified sound)

3. [CLEAN][demonstrated] Detection: 70 of 70 pairs at the CI CLI and at the hook CLI (base 10 of 70); the real installed hook refuses (base lets the commit land). Section A.
4. [CLEAN][demonstrated] No leakage and no terminal injection from newly scanned content: printed prefix charset, 0 odd bytes, 0 literals, 0 hashes, report JSON clean. Section B.
5. [CLEAN][demonstrated] Hostile paths on NUL-bearing blobs: 12 of 12 one-line, control characters escaped by git, no runnable command for a non-safe path. The raw high-byte echo under core.quotePath=false is the existing Issue 241 class. Section B.
6. [CLEAN][demonstrated] Value-scoped allowlist and NUL-bearing matches: the hash equals an independent sha256 over raw bytes at both entry points and in the hash tool; a novel literal in the same blob still blocks. Section C.
7. [CLEAN][demonstrated] No false-negative regression and no allowlist movement: monotone class change, triples 108/108/0/0, verify PASS with 0 and 0, fresh generate byte-identical, 0 of 50 entries on the affected pattern, empty diffstat on the untouched set. Section D.
8. [CLEAN][demonstrated] Tests bite: 4 of 4 mutants killed. Section F.
9. [CLEAN][demonstrated] A NUL blob does not change Issue 247 exposure. Section E.
10. [CLEAN][code-traced] The spike script is safe (counts and paths only, no value, hash or prefix, no working-tree writes). Section G.
11. [CLEAN][code-traced] One scan chain, no second skip: git.ts:117-123, history-scan.ts:75-98, pre-commit-scan.ts:54.
12. [CLEAN][code-traced] The UTF-16 residual is disclosed and not claimed: the header comment (history-scan.ts:12-17), the ADR residual row, the CHANGELOG line and the decisions row all name Issue 246 and claim no UTF-16 coverage.

## Blockers vs hardening

- Blockers: none.
- Hardening (optional): correct the binary-match wording (finding 1); add the repeated-BEGIN shape to Issue 247 (finding 2).

## Open findings and failing tests

Open findings 2, failing tests 0. Both are LOW. Finding 2 has a named executable form (the Issue 247 test above, red only once a repeated-BEGIN cell is added, which is out of this story). Finding 1 has none: it is a wording correction with no behavior to test.

## Editorial

- Plan section 8 says 50 MB of random bytes gave 2 chance matches; this review measured 3 (one run) and 13 per 200 MB (all email-address). Same order of magnitude.
- The modified docs/.maat-state.json and docs/run-log.jsonl were already present in git status at the start of this review, not produced by it.

## Single next action

Manager: ratify APPROVE and hand to the human PR review; optionally comment the repeated-BEGIN shape on Issue 247 so it is not lost.

RECEIPT: verdict=APPROVE
findings:
1. [ISSUE][LOW][demonstrated] docs/plans/s1-237-nul-byte-scan-phase1-2026-09-20.md section 8 and THOTH-ADR-0002 residual row: real executables and fonts match at 15 to 52 percent per file (images 0 of 39), not a chance-match rate; allowlist churn if binaries are ever tracked (0 of 1097 blobs today); fix is wording only
2. [ISSUE][LOW][demonstrated] src/secret-scan/patterns.ts:40 private-key-block lazy scan is quadratic on repeated BEGIN markers with no END (66 ms to 401 ms for 2x input), pre-existing and NUL-neutral; fold into Issue 247
3. [CLEAN][demonstrated] both entry points detect a secret in a NUL-bearing blob: 70 of 70 pairs at CI CLI and hook CLI (base 10 of 70), real hook refuses (base commits)
4. [CLEAN][demonstrated] no leakage or terminal injection from newly scanned bytes: 0 odd output bytes, 0 literals, 0 hashes in stdout and report JSON
5. [CLEAN][demonstrated] hostile paths on NUL-bearing blobs: 12 of 12 one-line, git escapes control bytes, no runnable command; raw high-byte echo under quotePath=false is the existing Issue 241 class
6. [CLEAN][demonstrated] value-scoped allowlist hash for NUL-bearing matches equals an independent sha256 at both entry points and in the hash tool; a novel literal in the same blob still blocks
7. [CLEAN][demonstrated] no false-negative regression: class change is a strict superset, triples 108/108/0/0, verify PASS 0 newly allowlisted 0 newly blocking, fresh generate byte-identical, untouched-path diffstat empty
8. [CLEAN][demonstrated] new tests kill 4 of 4 mutants (old 8000 window, skip-any-NUL, class revert, utf8 decode), control 39 of 39 green
9. [CLEAN][demonstrated] a NUL blob does not change Issue 247 exposure (576 vs 587 ms at 20000 chars; same order at 40000)
10. [CLEAN][code-traced] spike script prints counts and paths only, no value, hash or prefix, no working-tree writes, no raw NUL
11. [CLEAN][code-traced] single scan chain, no second NUL or binary skip (git.ts:117-123, history-scan.ts:75-98, pre-commit-scan.ts:54)
12. [CLEAN][code-traced] UTF-16 residual disclosed and never claimed (history-scan.ts:12-17, ADR row, CHANGELOG, decisions row: Issue 246)
counts: issues=2 suspicions=0 clean=10
evidence: demonstrated=9 code-traced=3 derived=0
checks="131/0/0"
adr=HIT(37)
report=docs/reviews/s1-237-nul-byte-scan-app-security-2026-09-20.md
