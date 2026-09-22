# Red Team (Sutekh) — s1-oss01-detection-residuals, 2026-09-22

**Scope** CRITICAL-tier post-build adversarial pass. Branch `fix/s1-oss01-detection-residuals`, HEAD `39572a2`, delta `origin/master...HEAD` (1 commit, 7 files, +524/-25). Issues 246, 247, 249, 250 — all four originating from my own prior report `docs/reviews/s1-237-nul-byte-scan-red-team-2026-09-20.md` (attacks 1-3), read first.

**Verdict: no-go.** One HIGH. Three of the four fixes are correct, non-vacuous and independently re-measured — #250 closes the vulnerability it names, #246's decode is additive and hash-stable, and the `vm.Script` timeout genuinely does interrupt catastrophic backtracking (the claim I was asked to attack hardest, and it survives). The HIGH is in what #247 added on top: the new `oss01-scan-timeout` finding is grantable through the value-scoped allowlist, but its `valueSha256` is computed over no blob content at all — only the pattern id and the text length — so one grant permanently blinds that path to *any* content of that length. That is Issue #136's whole-file blinding, reintroduced under a new pattern id, inside the one mechanism THOTH-ADR-0002 exists to content-address. Demonstrated end to end below. The fix is one line.

**ADR cache** `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — approx 18300 tokens saved this pass (fp b588a48) [CACHE=HIT]`. ADRs read for this attack surface: THOTH-ADR-0002 (value-scoped allowlist — the hash rule, the path-agreement rule, the no-other-exemption-shape rule, the residual register), devops ADR-0008 (suppression lists, ratchet-only), SE ADR-0005 / SE ADR-0010 (test deletion/weakening), SE ADR-0003 (injected I/O).

**Rule of engagement** Every secret-shaped literal in every probe is built at runtime; none is written into this report or into any tracked file. One three-way mutation drill was applied to `src/secret-scan/history-scan.ts` and reverted; `git status --porcelain` after the revert shows only this session's own `docs/REVIEW_LOG.md`, `docs/run-log.jsonl` and the parallel lane's cross-domain report.

---

## Scorecard

| # | Attack | Status | Severity | Evidence |
|---|---|---|---|---|
| 1 | A granted `oss01-scan-timeout` is a content-blind, permanent blind spot for a path | BREAKS | HIGH | demonstrated + code-traced |
| 2 | The unlock command the gate prints for a scan-timeout block never runs | BREAKS | MED | demonstrated |
| 3 | The new 0xA0 behaviour probe only sees NEGATED classes; 4 other shapes of the same defect pass | BREAKS | MED | demonstrated |
| 4 | THOTH-ADR-0002's residual register is now stale in two rows this diff falsifies | BREAKS | MED | code-traced |
| 5 | BOM-less UTF-16 residual has no successor tracker if #246 is closed at merge | UNPROVEN | LOW | code-traced |
| 6 | No AGGREGATE scan-time bound: the per-call 500ms is the only in-process ceiling | UNPROVEN | LOW | demonstrated |
| 7 | `vm.Script#runInContext` timeout really interrupts catastrophic backtracking | SURVIVES | — | demonstrated |
| 8 | Make the timeout fail OPEN, or leak a termination into the next scan | SURVIVES | — | demonstrated |
| 9 | 500ms is too tight: legitimate content spuriously blocks (DoS-on-self) | SURVIVES | — | demonstrated |
| 10 | #250: a grant at path A still exempts the identical blob at path B | SURVIVES | — | demonstrated |
| 11 | #246 additive decode: double-count, double-hash, or cross-variant allowlist masking | SURVIVES | — | demonstrated |
| 12 | The `FF FE` sniff adds chance-matches on ordinary binary content | SURVIVES | — | demonstrated |
| 13 | Concurrency: the shared module-level `vm` sandbox is written by two scans at once | SURVIVES | — | code-traced |
| 14 | The three new guards are vacuous | SURVIVES | — | demonstrated |
| 15 | Definition-of-Done on the real tree | SURVIVES | — | demonstrated |

---

## 1. [ISSUE][HIGH][demonstrated + code-traced] A granted scan-timeout blinds a path to any content of that length

**Scenario.** A generated asset lands at `assets/big.dat` and trips the new 500ms budget on `internal-hostname` and `email-address`. CI goes red. A maintainer does exactly what `src/secret-scan/history-scan.ts:36-38` tells them to do — "reviewable and grantable through the SAME value-scoped allowlist" — and adds two entries for `patternId: "oss01-scan-timeout"` at that path. From that commit on, **any** blob at `assets/big.dat` whose decoded length equals the granted one and which times out on the same pattern is exempt, whatever it contains. A timeout means the blob was *never matched* against that pattern, so every `internal-hostname` and `email-address` value in it is invisible, and the gate is green.

**Root cause, code-traced.** `src/secret-scan/history-scan.ts:174` computes the timeout finding's hash over a synthetic string — `hashMatchedBytes` of `oss01-scan-timeout:<pattern.id>:<text.length>`. No blob byte enters it. `entryRejection` (`src/secret-scan/history-scan.ts:453-464`) validates shape only and never checks `patternId` against `SECRET_PATTERNS`, so `oss01-scan-timeout` is a fully grantable pattern id. The hash is also publicly derivable from the gate's own log line, which prints `pattern=` and `bytes=`.

```
$ node scratch/a2.mjs
-- timeout finding shape --
blob A: …[SCAN-TIMEOUT pattern=internal-hostname bytes=102401] a9931b2fc7a31e9dd775d09f700880f0cbd6221adf7baab6365582d1143b6569
blob B: …[SCAN-TIMEOUT pattern=internal-hostname bytes=102401] a9931b2fc7a31e9dd775d09f700880f0cbd6221adf7baab6365582d1143b6569
same length, TOTALLY different content -> same hash? true
```

End-to-end, on a real git repository, with the literals built at runtime:

```
$ node scratch/a8-grant.mjs
ROUND 1 (the asset the maintainer grants):
    oss01-scan-timeout …[SCAN-TIMEOUT pattern=internal-hostname bytes=200000] 5255f1b3fa3a7054
    oss01-scan-timeout …[SCAN-TIMEOUT pattern=email-address bytes=200000] 3ab1f58052675703
   -> maintainer adds 2 allowlist entr(ies) for patternId oss01-scan-timeout
   gate now: PASS

ROUND 2 (attacker's blob at the SAME path): length 200000 == granted length 200000 true
    oss01-scan-timeout …[SCAN-TIMEOUT pattern=internal-hostname bytes=200000] 5255f1b3fa3a7054
    oss01-scan-timeout …[SCAN-TIMEOUT pattern=email-address bytes=200000] 3ab1f58052675703
   gate with the round-1 grants still in place: PASS  <=== SECRET NOT REPORTED, GATE GREEN
   is the email/hostname reported anywhere? false
```

Round 2's blob carries a runtime-built internal hostname and a corporate email address. Neither is reported by any pattern, and the gate passes.

**Current defense, honestly assessed.** Real but incidental, not designed. (a) No grant of this pattern id exists today — 0 of 50 entries, by instrument. (b) The 500ms budget has 103x headroom on this repo's real content (attack 9), so nothing legitimate trips it yet. (c) The documented unlock command for this pattern id is broken (attack 2), which accidentally makes the grant hard to add. None of those is a control; they are reasons the trigger has not fired yet.

**ADR position.** Two THOTH-ADR-0002 `Rules for agents` MUSTs are not satisfied by this finding class: *"MUST compute the value hash in the scanner at match time over the matched bytes"* — there are no matched bytes and the hash is over a constructed string; and *"MUST NOT introduce any other exemption shape for this gate"* — a length-scoped exemption wearing the `valueSha256` field is functionally a new shape, not a reuse of the old one. The source comment at `history-scan.ts:37-38` asserts the opposite ("THOTH-ADR-0002 forbids a NEW exemption shape, not reuse of the existing one"); the reuse is nominal, because the property the ADR's whole Decision section turns on — content-addressing — is absent.

**Exposure: 0% of runs today (0 of 50 allowlist entries use this pattern id, counted in `docs/qa/secret-scan-allowlist.json`); 100% of the granted (path, pattern, length) triple from the first grant onward, basis: measured.** Security category, so PRINCIPLES rule 21's exposure cap does not apply.

**Proof-test required before merge:** `oss01-a-scan-timeout-grant-does-not-exempt-a-different-blob-at-the-same-path`. **Minimal fix (one line):** make the timeout finding content-addressed — hash the blob's own sha (or its bytes) rather than `text.length` — so one grant covers exactly one blob. Alternative, if a scan-timeout should never be grantable: reject `SCAN_TIMEOUT_PATTERN_ID` in `entryRejection` and say so in the block message.

## 2. [ISSUE][MED][demonstrated] The unlock the gate prints for a scan-timeout never runs

`unlockDetails` prints a `HASH-COMMAND` for every blocking (path, patternId) pair, including the new one. `runHash` → `hashLines` (`src/secret-scan/allowlist-tool.ts:298-302`) looks the id up in `SECRET_PATTERNS` and throws before reading a single byte, so the printed command fails for every scan-timeout block, on every path, always.

```
$ node scratch/a10-unlock.mjs          # real CLI on a crafted repo
[OSS-01 history-scan] FAIL: 2 secret-shaped match(es) found in history (0 allowlisted, not counted). Values redacted below.
  - 89f1036e4015 assets-big.dat [oss01-scan-timeout] scan of this blob against pattern 'internal-hostname' did not finish within 500ms and was stopped; ...
  - HASH-COMMAND for assets-big.dat [oss01-scan-timeout]: node src/secret-scan/allowlist-tool.ts hash 89f1036e4015 "assets-big.dat" oss01-scan-timeout

$ node src/secret-scan/allowlist-tool.ts hash HEAD "CHANGELOG.md" oss01-scan-timeout
[allowlist-tool] unknown pattern id oss01-scan-timeout
$ echo $?
2
```

**Current defense, honestly assessed.** None. No test exercises the unlock path for this pattern id; `oss01-scan-time-is-bounded-on-a-hostile-blob` asserts the block, never the unlock. PRINCIPLES rule 2 ("every block names its unlock") and THOTH-ADR-0002's Decision text ("A blocked match's output names its unlock ... a per-pair command") are both unmet for the one new finding class this diff adds.

**Exposure: 100% of scan-timeout blocks, basis: counted-in-code** (the throw is unconditional at `allowlist-tool.ts:300`). Note the interaction with finding 1: fixing this one *without* fixing finding 1 makes the content-blind grant easy to add, which is worse. Fix them together.

**Proof-test required:** `oss01-every-blocking-pattern-id-has-a-runnable-unlock-command`.

## 3. [ISSUE][MED][demonstrated] The behaviour probe is behavioural only about negated classes

Issue 249 replaced a spelling blacklist with a behaviour probe — a genuine improvement, and it catches every negated-class spelling I tried, including the four the old tokenizer missed. But the probe's *input* is still a syntactic family: `negatedClasses()` extracts `[^...]` and nothing else. The test states the premise explicitly at `src/secret-scan/patterns.test.ts:216` — "a non-negated class can only match MORE, never hide data" — and that premise is false. Replacing a negated class with a positive one narrows.

Four shapes of the *identical* defect, each substituted into the real shipped `generic-password-assignment` source, each probed with a runtime-built 0xA0-bearing literal:

```
$ node scratch/a7c.mjs
defect shape                            guard-flags-it  matched-text
shipped, fixed (control)                false           "password = \"abcd<A0>efgh\""   (whole literal matched)
A: negated class re-adds \s (old bug)   true            null  (caught)
B: POSITIVE class [\x21-\x7e]           false           null  <== GUARD BLIND, defect LIVE
C: POSITIVE class [\w!@#$%^&*()+=./-]   false           null  <== GUARD BLIND, defect LIVE
D: negative lookahead (?!\xa0)          false           null  <== GUARD BLIND, defect LIVE
E: \p{ASCII}                            false           null  <== GUARD BLIND, defect LIVE
```

**Current defense, honestly assessed.** Strictly better than what it replaced, and non-vacuous (attack 14). But this is the same root-cause CLASS as Issue 249 itself and as Issue 244 before it: a guard that enumerates one way of writing a thing. A positive value class is arguably the *more* idiomatic spelling — the shape a future maintainer reaches for when tightening the pattern to cut false positives — so this is not an exotic residual.

**Exposure: 0% of runs today** (the shipped catalog has exactly one value class and it is negated), **~100% of future pattern edits that express the value class positively or with a lookahead, basis: measured** (4 of 4 above).

**Proof-test required:** `oss01-no-value-class-however-written-hides-a-high-byte` — probe the whole PATTERN, not its classes: splice each byte 0x80-0xFF into each exemplar's value position and assert the match still covers the whole literal. The instrument already exists in concept as the insertion sweep in my 2026-09-20 report (attack 9), and it is spelling-independent *and* construct-independent.

## 4. [ISSUE][MED][code-traced] THOTH-ADR-0002's residual register now documents two closed residuals as open

Under PRINCIPLES rule 9 the ADR is the architecture source of truth, and its residual register is what the next reviewer reads to learn what is still open. Two rows are falsified by this diff and neither is touched by it (the diff has 7 files; no ADR, no `docs/decisions.md`, no `docs/STATE.md`):

- `docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md:101` — "What remains open is UTF-16 text (a byte order mark and interleaved NUL bytes), which still matches nothing under latin1 decoding ... tracked under issue 246." The BOM'd half is now fixed; only the BOM-less half remains. The same row also asserts "no other exemption shape is added", which finding 1 contradicts.
- `:109` — "The scanner dedupes blobs by sha, so a byte-identical copy of a file at a second path is not evaluated under that path | Pre-existing ... Not changed by this ADR." Now false; that is precisely what Issue 250 fixed.

**Current defense, honestly assessed.** The CHANGELOG entry is accurate and complete; the source header comments are accurate. But a reviewer following PRINCIPLES rule 14's hydration order reaches the ADR last and reads a stale register, and the ADR outranks CHANGELOG prose.

**Exposure: 100% of future readers of this ADR's residual register, basis: counted-in-code** (2 rows, both quoted above). No executable form — resolves as an ADR amendment in this PR (`/maat:adr-amend`), not a test.

## 5. [SUSPICION][LOW][code-traced] The BOM-less UTF-16 residual is disclosed but not yet tracked

The gap is real and reproducible with one ordinary command (`iconv -t UTF-16LE`, which writes no BOM, unlike `-t UTF-16`):

```
$ node scratch/a6-utf16.mjs
plain-ASCII hash of the literal: f36279c0
  plain.txt      -> ["aws-access-key-id/f36279c0"]
  le-bom.txt     -> ["aws-access-key-id/f36279c0"]
  be-bom.txt     -> ["aws-access-key-id/f36279c0"]
  le-nobom.txt   -> []
  be-nobom.txt   -> []
=> a UTF-16 file WITHOUT a BOM hides the secret completely: true
```

It is honestly disclosed in four places — the CHANGELOG bullet, `history-scan.ts:20-23`, `decodeBlobVariants`'s own doc comment, and the named test `oss01-utf16-without-a-bom-stays-a-disclosed-residual`. The commit message carries no `Closes #246`, and #246 is still OPEN, so nothing is over-claimed **today**. The suspicion is about merge: #246's title is the general claim ("a UTF-16 text file still hides a secret"), so closing it at merge without a narrowing comment plus a successor Issue turns a disclosed residual into an untracked one. My 2026-09-20 attack 10 graded the analogous narrowing CLEAN precisely *because* the narrowing was recorded in five places before the Issue closed. **Exposure: not a live gate defect; basis: counted-in-code.** Unlock: comment the narrowing on #246 and open the successor before closing it.

## 6. [SUSPICION][LOW][demonstrated] The per-call ceiling is the only in-process bound; there is no aggregate one

500ms is per (blob, pattern, **variant**). A BOM-prefixed hostile blob therefore has a per-blob ceiling of 2 variants x 10 patterns x 500ms = 10s, not 5s.

```
$ node scratch/a9.mjs
one BOM-prefixed hostile blob: variants=2 timeouts=2 wall=1024ms  (worst-case per-blob ceiling = 10s)
=> blobs needed to exhaust the new 30-minute CI cap: 1758
```

**Current defense, honestly assessed.** Adequate and fails closed. `timeout-minutes: 30` is the aggregate bound in CI and it kills the job loudly; the blocking scan-timeout findings make an attack self-announcing rather than silent. The uncovered half is the **pre-commit hook**, which has no equivalent cap: a poisoned repository makes every local `git commit` pay the same bill, forever, with no job-level killer. That is the unfixed remainder of my 2026-09-20 attack 1, correctly descoped here. **Exposure: ~0% today (0 hostile blobs in history, measured); 100% of local commits on a poisoned branch, basis: measured.** Test: `oss01-total-scan-time-is-bounded-across-a-history-of-hostile-blobs`.

## 7. [CLEAN][demonstrated] The `vm.Script` timeout really does interrupt catastrophic backtracking

This was the claim I was asked to attack hardest, on the grounds that `vm` timeouts do not preempt every synchronous operation. On Node v24.15.0 it holds: V8's regexp engine honours the termination interrupt.

```
$ node scratch/a1-timeout.mjs
node v24.15.0 SCAN_TIMEOUT_MS = 500
hyphen-run  25KB (all patterns)   811ms matches=0 timeouts=0
hyphen-run  50KB (all patterns)  1018ms matches=2 timeouts=2
hyphen-run 100KB (all patterns)  1029ms matches=2 timeouts=2
hyphen-run 200KB (all patterns)  1033ms matches=2 timeouts=2
```

The 200 KB row measured **179682ms** unbounded in my 2026-09-20 report (attack 1); it is now 1033ms, flat across an 8x size range — the signature of a real wall-clock cut, not of a faster regex. The residual caveat is honest and worth recording: this is a V8-version-dependent property, not a contract Node documents. It is pinned by a named test, which is the right containment.

## 8. [CLEAN][demonstrated] The timeout fails closed, and a termination does not leak into the next scan

```
$ node scratch/a2.mjs
control clean scan finds it: 1
hostile scan: 510 ms timeouts= 1
IMMEDIATELY after a timeout, control still found: 1
hostile+secret, ALL patterns -> generic-password-assignment,oss01-scan-timeout,oss01-scan-timeout
```

The catch-all in `matchAllBounded` funnels every throw shape (timeout, OOM, a non-global regex added later) into the same fail-closed path, and the `finally` clears the sandbox even after a V8 termination. A blob that times out on two patterns is still fully matched by the other eight. Mutating the fail-closed branch to fail open turns the named test red (attack 14).

## 9. [CLEAN][demonstrated] 500ms does not spuriously block legitimate content

The implementer's "~100x headroom" claim reproduces independently, measured over every real (blob, pattern) call in this repository's whole history — 11,740 calls, not a sample:

```
$ node scratch/a3-headroom.mjs
commits 281 distinct blobs 1174
TOP 3 slowest (blob,pattern) calls over REAL full history (unbounded):
       4.9ms  internal-hostname   320367B  matches=5  CHANGELOG.md
       4.3ms  internal-hostname   301797B  matches=5  CHANGELOG.md
       4.2ms  internal-hostname   325878B  matches=5  CHANGELOG.md
max=4.9ms  budget=500ms  real headroom = 103.0x
calls over 50ms: 0   over 100ms: 0   over 250ms: 0   over 500ms: 0   total calls: 11740
```

And against content this repo does not have yet but plausibly could, including the shapes closest to the catastrophic one:

```
$ node scratch/a4-fp.mjs
markdown rule line, one line of 128KB dashes      131072B worst=    0ms
single-line base64 blob (embedded asset)          546136B worst=    3ms
package-lock-ish: 40k dotted module names        1868889B worst=   11ms
CHANGELOG.md x8 (natural growth)                 2707352B worst=   19ms
60k hyphenated hostnames, one per line           2208889B worst=   44ms
minified-js proxy: 500KB no newlines              708890B worst=    4ms
```

Worst realistic shape is 44ms at 2.2 MB — 11x under budget. A 2-core GitHub runner is roughly 2-4x slower than this machine for single-threaded JS, which still leaves 3-25x. The catastrophic case needs the specific alternating hyphen shape with no terminator, which no legitimate content produces. No DoS-on-self.

## 10. [CLEAN][demonstrated] Issue 250's own vulnerability is actually closed

Built directly against the new code, on a real git repository, with the literal built at runtime:

```
$ node scratch/a5-dedupe.mjs
paths reported: ["aaa-blessed.dat","zzz-smuggled.dat"]
grant scoped to aaa-blessed.dat ->  allowlisted: [ 'aaa-blessed.dat' ]  BLOCKING: [ 'zzz-smuggled.dat' ]
RESULT: #250 FIXED -- the identical blob at the ungranted path still blocks

default (HEAD) scan sees side-only.dat? false
allRefs scan sees side-only.dat?       true
```

This is my 2026-09-20 attack 3's exact scenario, inverted. Ref scoping is unchanged and correct (pre-existing, by design). Reverting the key to sha-alone turns the named test red (attack 14).

## 11. [CLEAN][demonstrated] The additive decode neither double-counts nor lets one variant mask the other

```
$ node scratch/a6-utf16.mjs
plain-ASCII hash of the literal: f36279c0
  plain.txt   -> ["aws-access-key-id/f36279c0"]
  le-bom.txt  -> ["aws-access-key-id/f36279c0"]
  be-bom.txt  -> ["aws-access-key-id/f36279c0"]
one ASCII-hash grant at le-bom.txt: allowlisted@le-bom = 1  still-blocking@le-bom = 0
```

The specific masking shape I was asked to construct does not exist. The hash is over the matched text, so two variants collide only when they matched byte-identical text — which is the intended equivalence (the Manager's one-entry-covers-both ruling), not a bypass: hash equality *is* value equality. Exactly one finding per occurrence per variant; the latin1 reading of a UTF-16 blob contributes nothing extra for these patterns, so there is no double-count. #250's `(path, sha)` key is content-addressed and `decodeBlobVariants` is a pure function of the blob's bytes, so the cache stays correct under the variant decoding. `allowlist-tool.ts hash` was updated in the same diff to decode identically, so the unlock and the gate cannot drift (for the nine real pattern ids — see finding 2 for the tenth).

## 12. [CLEAN][demonstrated] The `FF FE` sniff adds no chance-match load

```
$ node scratch/a9.mjs
FF FE-prefixed random binary, 16MB: latin1 reading matches=0, extra utf16 reading matches=0
gzip(CHANGELOG) with FF FE prefix (113760B): latin1=0 utf16=0
```

The `high-bytes.bin` concern the implementer designed around is genuine and the additive design is the right answer to it; the second reading costs a decode and adds no false positives on the binary shapes I could build.

## 13. [CLEAN][code-traced] The shared `vm` sandbox cannot be raced

`timeoutSandbox` is module-level mutable state, which is the shape that usually breaks. It survives because the window between the sandbox write and the `finally` that clears it contains no `await` and no yield point — `matchAllBounded` and its caller `scanBlobText` are fully synchronous (`src/secret-scan/history-scan.ts:139-152`, `:163-193`), so Node's single-threaded model makes interleaving impossible even if two `scanHistory` calls run concurrently. The one concurrent call site, `Promise.all([scanHistory(...), loadAllowlist(...)])` at `src/secret-scan/pre-commit-scan.ts:53`, pairs a scan with a file read that never touches the sandbox. `worker_threads` would get its own module instance. Residual, worth a comment rather than a finding: the safety is entirely a consequence of `scanBlobText` being synchronous, and nothing asserts that — making it `async` later would silently corrupt cross-blob results. The existing header comment names the sequential-use requirement, which is the honest half of that.

## 14. [CLEAN][demonstrated] The three new guards are non-vacuous

Three mutations applied simultaneously to `src/secret-scan/history-scan.ts` and reverted: M1 return only the latin1 variant (revert #246), M2 treat a timeout as no-match (fail OPEN — the single most dangerous regression this diff could take), M3 revert the dedupe key to sha-alone (revert #250).

```
$ node --test src/secret-scan/history-scan.test.ts src/secret-scan/pre-commit-scan.test.ts
x oss01-utf16-text-file-does-not-hide-a-secret (439.1104ms)
x oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another (359.8294ms)
x oss01-scan-time-is-bounded-on-a-hostile-blob (4140.608ms)
   x a long hyphen-joined run (internal-hostname / email-address) is bounded, not left to run
   x a repeated BEGIN marker with no END (private-key-block) is bounded too
x oss01-utf16-text-file-does-not-hide-a-secret (pre-commit CLI) (847.5238ms)
tests 112  pass 106  fail 6  skipped 0

$ git checkout -- src/secret-scan/history-scan.ts && git status --porcelain
 M docs/REVIEW_LOG.md
 M docs/run-log.jsonl
?? docs/reviews/s1-oss01-detection-residuals-cross-domain-2026-09-22.md
```

Each mutation is caught by exactly the named test that claims to cover it, at `scanHistory` and at the real pre-commit CLI. The fail-open mutation is caught on the `timeouts.length > 0` assertion, not merely on wall time, which is the assertion that matters.

## 15. [CLEAN][demonstrated] Definition-of-Done on the real tree

```
$ node --test src/secret-scan/history-scan.test.ts src/secret-scan/patterns.test.ts \
               src/secret-scan/pre-commit-scan.test.ts src/secret-scan/allowlist-tool.test.ts
tests 143  suites 0  pass 143  fail 0  cancelled 0  skipped 0  todo 0  duration_ms 108885.2151

$ npm run typecheck     (tsc --noEmit -p tsconfig.json)   -- no output, clean
$ npm run lint          (eslint .)                        -- no output, clean

$ time node src/secret-scan/history-scan.ts
[OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (2067 allowlisted).
exit=0
real  1m11.342s

$ node -e "count the allowlist"
entries 50 timeout entries 0
```

2067 allowlisted / 0 blocking matches the CHANGELOG's own disclosed post-commit figure exactly; the allowlist is untouched (50 entries, unchanged from the 2026-09-20 baseline). Note for the Manager, not a finding: the diff touches no `docs/STATE.md`, `docs/decisions.md` or `docs/plans/` artifact — the cross-domain lane filed the missing-plan-artifact citation as its own MED, and I confirm the same absence rather than re-filing it.

---

## Residual register (no Issue owed)

| Residual | Disposition |
|---|---|
| The `vm` timeout's interruption of regex backtracking is a V8-version property, not a documented Node contract | Pinned by `oss01-scan-time-is-bounded-on-a-hostile-blob`; that test is the early-warning instrument if a Node upgrade changes it |
| The sandbox's thread-safety rests entirely on `scanBlobText` being synchronous, and nothing asserts it | Attack 13; a one-line assertion or a comment on the function itself |
| The pre-commit hook has no aggregate time cap (CI now does) | Attack 6; the unfixed remainder of 2026-09-20 attack 1, correctly descoped |
| UTF-32, legacy code pages, base64 and compressed content still yield 0 matches | The wider class behind Issue 246; unchanged by this story |

## Editorial (verdict-neutral, plain edits, no re-review)

- `src/secret-scan/patterns.test.ts:216`, "a non-negated class can only match MORE, never hide data" — false as written (finding 3). The accurate sentence is that a non-negated class widens *relative to a wider non-negated class*; replacing a negated class with a positive one narrows.
- `src/secret-scan/history-scan.ts:37-38`, "THOTH-ADR-0002 forbids a NEW exemption shape, not reuse of the existing one" — true of the *field*, not of the *property* (finding 1). Reword once finding 1's fix lands.
- `src/secret-scan/history-scan.ts:96-99` describes `SCAN_TIMEOUT_MS`'s headroom against "~5ms, CHANGELOG.md" — correct, and now independently confirmed at 4.9ms over all 11,740 real calls. Worth citing the count, since a single-file figure reads as a spot check.

---

## The single scariest unproven assumption

**That "grantable through the existing allowlist" means the grant inherits the allowlist's safety property.** It does not. The allowlist's entire value, the thing THOTH-ADR-0002 was written to establish after Issue #136, is that an exemption is bound to *content*. The scan-timeout finding reuses the field, the loader, the review path and the ADR's own language — and binds to a pattern id and an integer. Everything about it looks like a value-scoped grant except the one property that makes a value-scoped grant safe. That the code is correct today rests on nobody having used the feature yet.

## Go / no-go

**no-go.** One demonstrated HIGH in a security gate's exemption mechanism, in a sensitive area, fixable in one line. The rest of the diff is good work and should not be unwound: #250 closes its vulnerability, #246 is additive and hash-stable with an honestly narrowed residual, the timeout mechanism genuinely works and fails closed under mutation, and the 100x-headroom claim reproduces at 103x over every real call in history rather than a sample. Fix finding 1 together with finding 2 — landing 2 alone makes 1 easier to reach — re-run the named test, and this ships.

## Single next action

Change `src/secret-scan/history-scan.ts:174` so the scan-timeout finding's `valueSha256` is computed over the blob's own content (its sha), not over `text.length`, and add `oss01-a-scan-timeout-grant-does-not-exempt-a-different-blob-at-the-same-path`.

## Findings to failing tests

Open findings: 6. Named failing tests: 4. The two without an executable form are named below with why.

| Finding | Named test |
|---|---|
| 1 | `oss01-a-scan-timeout-grant-does-not-exempt-a-different-blob-at-the-same-path` |
| 2 | `oss01-every-blocking-pattern-id-has-a-runnable-unlock-command` |
| 3 | `oss01-no-value-class-however-written-hides-a-high-byte` |
| 4 | none — an ADR residual-register amendment, resolved by editing `docs/adr/thoth-0002-...md:101,109` in this PR |
| 5 | none — Issue-tracking hygiene (a narrowing comment plus a successor Issue on #246 before it closes) |
| 6 | `oss01-total-scan-time-is-bounded-across-a-history-of-hostile-blobs` |

---

RECEIPT: verdict=no-go
attacks (ALL, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] A granted `oss01-scan-timeout` blinds a path to ANY content of that length — its valueSha256 is sha256 of "oss01-scan-timeout:<patternId>:<text.length>" with zero blob bytes in it (history-scan.ts:174) and entryRejection never validates patternId (:453-464), so two different 200000-byte blobs produce the identical hash and a round-1 grant makes a round-2 blob carrying a real hostname+email pass the gate green, unreported; violates THOTH-ADR-0002's "hash over the matched bytes" and "no other exemption shape" MUSTs; Exposure: 0% today (0 of 50 entries use the id, counted in the allowlist file), 100% of the granted (path,pattern,length) triple from the first grant on, basis: measured — security category, rule 21 cap does not apply; defense = incidental only (no grant exists yet, 103x headroom, and the unlock is broken) -> test oss01-a-scan-timeout-grant-does-not-exempt-a-different-blob-at-the-same-path; one-line fix: hash the blob's own sha
2. [ISSUE][MED][demonstrated] The HASH-COMMAND the gate prints for every scan-timeout block never runs — hashLines throws "unknown pattern id oss01-scan-timeout" at allowlist-tool.ts:300 before reading any blob, exit 2, for every path and commit; PRINCIPLES rule 2 and THOTH-ADR-0002's "a blocked match's output names its unlock" both unmet; Exposure: 100% of scan-timeout blocks, basis: counted-in-code; defense = none, no test covers the unlock for this id -> test oss01-every-blocking-pattern-id-has-a-runnable-unlock-command (fix with finding 1, never alone)
3. [ISSUE][MED][demonstrated] The new 0xA0 behaviour probe only extracts NEGATED classes, so 4 non-negated spellings of the identical defect pass green against the real shipped pattern (positive [\x21-\x7e], positive [\w...], negative lookahead (?!\xa0), \p{ASCII}); the test's own premise at patterns.test.ts:216 ("a non-negated class can only match MORE") is demonstrably false; same root-cause CLASS as Issues 249 and 244; Exposure: 0% today (catalog has one negated class), ~100% of future edits using a positive class, basis: measured (4 of 4); defense = strictly better than the spelling blacklist it replaced and non-vacuous, but still syntax-family-scoped -> test oss01-no-value-class-however-written-hides-a-high-byte (whole-pattern insertion sweep)
4. [ISSUE][MED][code-traced] THOTH-ADR-0002's residual register now documents two closed residuals as open — :101 "What remains open is UTF-16 text (a byte order mark and interleaved NUL bytes)" (the BOM'd half is fixed) and its "no other exemption shape is added" (contradicted by finding 1), and :109 "The scanner dedupes blobs by sha ... Not changed by this ADR" (that is exactly what #250 fixed); the diff touches no ADR; PRINCIPLES rule 9 makes this the source of truth a reviewer reads last; Exposure: 100% of future readers of that register, basis: counted-in-code (2 rows); defense = accurate CHANGELOG and source comments, which the ADR outranks -> ADR amendment in this PR, no executable form
5. [SUSPICION][LOW][code-traced] The BOM-less UTF-16 gap is real (iconv -t UTF-16LE, one command: le-nobom.txt and be-nobom.txt report zero matches while the BOM'd twins hash identically to plain ASCII) and honestly disclosed in 4 places with a named test, and the commit carries no Closes #246 — the risk is only at merge, if #246 is closed on its general title without a narrowing comment and a successor Issue; Exposure: not a live gate defect, basis: counted-in-code; defense = the disclosure itself, which my 2026-09-20 attack 10 accepted as sufficient when it was recorded before closure
6. [SUSPICION][LOW][demonstrated] No aggregate scan-time bound: 500ms is per (blob, pattern, VARIANT), so a BOM-prefixed hostile blob's ceiling is 10s not 5s (measured 1024ms for 2 timing-out patterns, 2 variants) and ~1758 such blobs exhaust the new 30-minute CI cap on this machine, fewer on a 2-core runner; Exposure: ~0% today (0 hostile blobs in history, measured), 100% of local commits on a poisoned branch, basis: measured; defense = timeout-minutes: 30 kills CI loudly and the findings are blocking, so it fails closed and self-announces — but the pre-commit hook has no equivalent cap -> test oss01-total-scan-time-is-bounded-across-a-history-of-hostile-blobs
7. [CLEAN][demonstrated] vm.Script#runInContext's timeout genuinely interrupts catastrophically-backtracking RegExp on Node v24.15.0: the same 200 KB hyphen-run I measured at 179682ms unbounded on 2026-09-20 is now 1033ms, flat across 25KB->200KB, with 2 timeout findings recorded — the signature of a real wall-clock cut, not a faster regex
8. [CLEAN][demonstrated] The timeout fails CLOSED and leaks nothing: a clean control scan immediately after a termination still finds its literal; a blob timing out on 2 patterns is still fully matched by the other 8; the catch-all funnels every throw shape into the same blocking path; mutating the branch to fail open turns the named test red on its timeouts.length assertion, not merely on wall time
9. [CLEAN][demonstrated] 500ms does not spuriously block legitimate content: max 4.9ms over ALL 11740 real (blob,pattern) calls in this repository's history (103x headroom, 0 calls over 50ms), and the closest realistic hostile-shaped content — 2.2 MB of hyphenated hostnames — is 44ms, 11x under budget; a 2-4x slower CI runner still leaves 3-25x
10. [CLEAN][demonstrated] Issue 250's own vulnerability is closed: a byte-identical blob at aaa-blessed.dat and zzz-smuggled.dat is now reported at BOTH paths, a grant scoped to the first exempts only the first, the second blocks at scanHistory, at partitionAllowlisted and at the real CLI; reverting the key to sha-alone turns the named test red
11. [CLEAN][demonstrated] The additive decode neither double-counts nor masks: UTF-16LE-with-BOM and UTF-16BE-with-BOM both hash identically to the plain-ASCII form (f36279c0), one grant covers exactly one occurrence with nothing left blocking and nothing extra allowlisted; hash equality is value equality, so the cross-variant masking shape I was asked to construct cannot exist; the (path,sha) cache stays correct because decodeBlobVariants is pure over the blob's bytes
12. [CLEAN][demonstrated] The FF FE sniff adds no chance-match load: 0 extra matches from the second reading over 16 MB of FF FE-prefixed random binary and over a real gzip asset with the same prefix
13. [CLEAN][code-traced] The shared module-level vm sandbox cannot be raced: no await or yield point exists between the sandbox write and the finally that clears it (history-scan.ts:139-152, :163-193 are fully synchronous), and the one concurrent call site (pre-commit-scan.ts:53's Promise.all) pairs the scan with loadAllowlist, which never touches it
14. [CLEAN][demonstrated] The three new guards are non-vacuous: a simultaneous 3-way mutation (latin1-only decode, timeout fails open, sha-alone dedupe) turns 6 assertions red across exactly the 4 named tests that claim to cover them, at scanHistory and at the real pre-commit CLI; tree reverted clean
15. [CLEAN][demonstrated] DoD on the real tree: 143 pass / 0 fail / 0 skipped across the four secret-scan suites, typecheck clean, lint clean, real gate PASS 0 blocking / 2067 allowlisted in 71s (matching the CHANGELOG's disclosed figure), allowlist unchanged at 50 entries with 0 using the new pattern id
counts (a CHECKSUM — equals the lines above): issues=4 suspicions=2 clean=9
evidence (a CHECKSUM over the tags above): demonstrated=13 code-traced=2 derived=0
checks=secret-scan suites (history-scan, patterns, pre-commit-scan, allowlist-tool) 143 pass / 0 fail / 0 skipped; 3-way mutation drill 106 pass / 6 fail / 0 skipped, reverted clean; typecheck clean; lint clean; node src/secret-scan/history-scan.ts PASS 0 blocking (2067 allowlisted) in 71s; 11740 real (blob,pattern) timing calls, max 4.9ms; 9 adversarial probe scripts (a1,a2,a3,a4,a5,a6,a7c,a8,a9,a10)
adr=HIT(37)
report=docs/reviews/s1-oss01-detection-residuals-red-team-2026-09-22.md

---

## Addendum (2026-09-22, appended after the RECEIPT above; the report body is unchanged per PRINCIPLES rule 11)

Cross-lane reconciliation performed at Issue-filing time, so the Manager does not have to:

- **Finding 1 was already filed by a parallel lane as Issue #264** ("oss01-scan-timeout allowlist grants are hashed by (patternId, length) only, not content"), at `severity:high`. I did not open a duplicate; I commented my independent end-to-end reproduction and the no-go consequence on #264. Findings 2, 3 and 4 had no existing Issue and are filed as #267, #268 and #269 (`bug` + `severity:med` + `oss`, milestone S1).
- **Issue #265, filed by another lane, claims `oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another` intermittently false-passes through the real CLI.** My attack 10 graded #250 CLEAN on the *behaviour* — `scanHistory`, `partitionAllowlisted` and the real CLI, on a purpose-built repository — and my mutation drill ran that test once and saw it go red as claimed. I did not run it repeatedly, so I cannot speak to intermittency and my CLEAN should be read as "the fix is behaviourally correct", not "the proof-test is stable". Those are different claims and #265 owns the second one.
- **Issue #266 ("UTF-16 decode + latin1 hash truncation collides distinct values for 2 of 8 patterns")** is a finding I did not reach; my attack 11 probed cross-variant *masking* through the allowlist and found none, which is a narrower question than hash collision across the decode boundary. Treat #266 as the stronger result on that seam.
