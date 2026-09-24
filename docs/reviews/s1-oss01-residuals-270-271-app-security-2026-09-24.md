[app-security-reviewer]
Horus, App Security Reviewer, reviewing for exploitable weakness

# App-security review: s1-oss01-residuals-270-271 (CRITICAL), 2026-09-24

Scope: diff ae6b4f1..50dc996 (detached at 50dc996, adr submodule populated). Issues 270 (test-only) and 271 (grant hash and unlock). Sensitive area: src/secret-scan/*.

## ADR compliance
ADR cache line: ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] [CACHE=HIT].
Applicable security rules read: THOTH-ADR-0002 (value hash computed at match time; no raw matched text in allowlist/report/log; no second exemption shape) and devops ADR-0008 (ratchet: no broadening of suppression lists). The diff violates neither (F1, F3). No ADR blocker.

## Verdict: APPROVE

No exploitable weakness found. No blocking finding. No [ISSUE] to file.

## Checks run (raw)
- npm run typecheck: clean (tsc --noEmit, no output).
- npm run lint: clean (eslint, no output).
- node --test (whole repo): tests 1095, pass 1095, fail 0, cancelled 0, skipped 0.
- Targeted: node --test patterns.test.ts history-scan.test.ts allowlist-tool.test.ts: tests 129, pass 129, fail 0, skipped 0. Sweep diagnostics from the run: catalog patterns=10 free-form=2 ascii-only=8; sweep cells=2048.
- npm run oss:secret-scan: exit 0, PASS: Full history scanned, 0 blocking secret-shaped matches found (2412 allowlisted). docs/qa/ is untouched by the diff (allowlist file not edited).
- Grant-integrity probe (scratch node script against the shipped modules, deleted afterwards):
  - internal-hostname and email-address both time out on a 200,000-byte a- run: same hash = true; gate hash == scanTimeoutHash == hashLines output = dc49dd88...a269.
  - Blob A vs A+x: distinct hashes = true (content-addressed).
  - partitionAllowlisted with one grant (path one.txt, id oss01-scan-timeout, hash of A): same path + same blob = allowlisted; other path + same blob = BLOCKING; same path + different blob = BLOCKING; same path + that hash under a real pattern id (email-address) = BLOCKING. allowlisted=1, blocking=3 of 4.
  - hashLines on ordinary text returns exactly one line (hash + "...[SCAN-TIMEOUT bytes=5]"); no scan, no clock.
  - Blob = hostile prefix + an AWS-key-shaped literal: scanBlobText still reports aws-access-key-id alongside the two timeouts. A timeout grant never hides a real match in the same blob.

## Findings (ranked by exploitability x impact)

F1 [CLEAN][demonstrated] Grant integrity holds. Dropping pattern.id widens a grant only across patterns for the SAME path and SAME exact decoded text (probe above). It cannot cross paths (key is path NUL patternId, history-scan.ts:346-357), blob contents (sha256 over the whole text, history-scan.ts:182), or into a real pattern id (lookup key includes the finding patternId). The same-text namespace equality (a real match of the literal "oss01-scan-timeout:T" hashes like the timeout of T) is inert for the same reason and pre-dates this change (the old formula had the same prefix). ADR-0008 reading: 0 existing entries use the reserved id (allowlist file untouched), so nothing existing widens. I agree with the ruling.

F2 [CLEAN][code-traced] Unlock and CLI input handling unchanged in risk. The whole production diff to allowlist-tool.ts is the import and the reserved-id branch of hashLines (allowlist-tool.ts:311-314). The branch prints a hash, a fixed string and text.length (a number); no blob content, path or argv value is interpolated. SHELL_SAFE, percentEncode and unlockDetails are absent from the diff (verified by reading the complete diff), so the earlier protections are untouched. runHash (unchanged, allowlist-tool.ts:366-387) still echoes the argv patternId to stderr in its "no ... match" line; that is pre-existing local maintainer CLI behaviour, not in this diff, and the reserved-id branch never reaches it.

F3 [CLEAN][code-traced] Fail direction. (a) scanBlobText still emits a blocking oss01-scan-timeout finding on every timeout; only the identity changed, fail-closed preserved. (b) hashLines prints a hash even for text that does not time out: that can mint an entry that matches nothing (Issue 235, disclosed) and cannot exempt anything, because the gate exempts only a finding whose (path, id, hash) is on the file. No new fail-open path. The residual direction (false block under wall-clock race or CPU contention, never a false pass) is correctly described.

F4 [CLEAN][code-traced] The ratified residual is honestly disclosed. THOTH-ADR-0002 row 111 states the gate outcome near the boundary is unchanged and racy, includes the contention case with a report link, states the direction, and points to Issue 287 (open, labels chore + oss, verified). Row 110 states the widening in plain words ("one grant covers that blob timeout whichever pattern trips it"). decisions.md and CHANGELOG match the code. One caveat is unstated: a granted blob passes on any run, including one where a pattern did not scan it (a grant is over the whole text: the reviewer accepts the blob, not one rule). Hardening only, H1.

F5 [CLEAN][code-traced] Issue 270 is test-only: no production line changes in patterns.ts. The removed lines in patterns.test.ts are the hand-keyed exemplar map and single-offset sweep, replaced by a registry checked both ways, every-position replacement (2048 cells) and named controls for first-only, last-only and unclassified-11th narrowing, all green. The one edited test (sb2-hash-lines-...-without-throwing) trades a now-false expectation (empty result for ordinary text) for an oracle-based test; not a ratchet weakening.

F6 [CLEAN][demonstrated] No secrets in the diff or reports. oss:secret-scan 0 blocking; allowlist file unchanged.

## Blockers vs hardening
Blockers: none.
Hardening (optional):
- H1: say in ADR row 110 that a grant is over the whole text, so a granted blob is accepted on any run even where a slow pattern skipped it. One sentence.

## Not proven by me
- A mutation drill on production code (revert the 271 change, watch the two new tests fail) was blocked by the session permission classifier, so it was not run. The new tests assert equality across two patterns and an independently computed sha256, and the old formula in the diff keyed on pattern.id, so it cannot satisfy them by construction. The CHANGELOG claim that the tests were red before the code change is the implementer statement (derived for me). Settling command, runnable by anyone: revert the valueSha256 line in history-scan.ts to hash pattern.id plus text, then node --test src/secret-scan/history-scan.test.ts; expect oss01-a-scan-timeout-grant-does-not-depend-on-which-pattern-was-slow to fail.

## Editorial (verdict-neutral, plain edits)
- ADR row 110 still says "besides the six real pattern ids"; the catalog has 10 (the sweep test prints patterns=10). Plan criterion 13 removed "eight real", but this hand-typed count remains. Reword without a number.

## Next action
Manager: accept APPROVE, fix the ADR row 110 count wording as a plain edit, proceed to verify and merge-handoff (merge stays human).

Open findings = 0; failing tests = 0.

RECEIPT: verdict=APPROVE
findings:
1. [CLEAN][demonstrated] history-scan.ts:182,346-357 - grant stays content-addressed and path-scoped; probe: other path, different blob and real-id entry all still BLOCK (3 of 4), only same path+blob exempted
2. [CLEAN][code-traced] allowlist-tool.ts:311-314 - unlock branch prints hash + fixed string + length only; SHELL_SAFE/percentEncode/unlockDetails absent from diff
3. [CLEAN][code-traced] history-scan.ts:208-227 - every changed branch fail-closed; hash-for-non-timeout blob mints an inert entry only (Issue 235)
4. [CLEAN][code-traced] thoth-0002 rows 110/111 - ratified residual honestly disclosed, Issue 287 exists; hardening H1 one sentence
5. [CLEAN][code-traced] patterns.test.ts - 270 test-only, registry both ways, 2048 cells, controls green
6. [CLEAN][demonstrated] oss:secret-scan 0 blocking (2412 allowlisted), no secrets in diff
counts: issues=0 suspicions=0 clean=6
evidence: demonstrated=2 code-traced=4 derived=0
checks="1095/0/0"
adr=HIT(37)
report=docs/reviews/s1-oss01-residuals-270-271-app-security-2026-09-24.md
