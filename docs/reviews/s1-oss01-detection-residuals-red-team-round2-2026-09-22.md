# Red Team (Sutekh) — s1-oss01-detection-residuals, round 2 re-confirm, 2026-09-22

**Scope** CRITICAL-tier round-2 targeted re-confirm. Branch `fix/s1-oss01-detection-residuals`, HEAD `c453959`, delta `39572a2..HEAD` (2 commits; `106e73b` is round-1 reports/log only, `c453959` is the fix-now round). Round-1 report: `docs/reviews/s1-oss01-detection-residuals-red-team-2026-09-22.md`.

**Verdict: go.** The round-1 HIGH (#264) is closed and I could not reopen it: the length collision is gone, and the end-to-end attack that made the gate green in round 1 now blocks at the real CLI. #267 landed in the same commit as #264, exactly as I asked. #269's ADR rewording is accurate against shipped code. #268 is genuinely better — all four of my round-1 evasions are caught — but it is not yet construct-independent in the dimension that matters most: its scope is a hand-maintained two-entry table and a single splice position, and I found three more shapes that walk through it. That is a MED, the fourth iteration of the same root-cause class, and it should be a named test rather than a merge blocker. Two MED, three LOW suspicions, seven clean.

**ADR cache** `ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 854c4b9) [CACHE=HIT]` (the fingerprint moved because this diff edits THOTH-ADR-0002 itself).

**Rule of engagement** Every secret-shaped literal is built at runtime. One three-way mutation drill was applied to `src/secret-scan/history-scan.ts` and `src/secret-scan/allowlist-tool.ts` and reverted; `git status --porcelain` after the revert shows only `docs/.maat-state.json`.

---

## Scorecard

| # | Attack | Status | Severity | Evidence |
|---|---|---|---|---|
| 1 | #268's new sweep: find a 5th/6th shape that still evades | BREAKS | MED | demonstrated |
| 2 | The scan-timeout outcome is a wall-clock race, so the grant is not reproducible | BREAKS | MED | demonstrated |
| 3 | #266's fix puts two encodings in one hash namespace with no domain separator | UNPROVEN | LOW | demonstrated |
| 4 | Post-timeout hashing is outside `SCAN_TIMEOUT_MS` (the Manager's own question) | UNPROVEN | LOW | demonstrated |
| 5 | #246's Issue still carries no narrowing comment while the ADR says it does | UNPROVEN | LOW | code-traced |
| 6 | #264: reopen the length collision with the round-1 two-blob attack | SURVIVES | — | demonstrated |
| 7 | #267: does the printed unlock produce a hash the gate actually accepts, and did it land WITH #264? | SURVIVES | — | demonstrated |
| 8 | #268: do all four round-1 evasions still pass? | SURVIVES | — | demonstrated |
| 9 | #269: is the reworded ADR accurate, and does it overstate what is fixed? | SURVIVES | — | code-traced |
| 10 | The three round-2 guards are vacuous | SURVIVES | — | demonstrated |
| 11 | The new hashing regresses the real gate's runtime | SURVIVES | — | demonstrated |
| 12 | #265 independent reproduction attempt (optional assignment) | SURVIVES | — | demonstrated |

---

## 1. [ISSUE][MED][demonstrated] The new sweep is construct-independent but scope- and position-dependent

`oss01-no-value-class-however-written-hides-a-high-byte` is a real improvement: it runs the compiled regex end to end instead of classifying its syntax, and it catches every shape I broke the old guard with (attack 8). But two things about it are still enumerated by hand rather than derived:

- **Scope.** `VALUE_CLASS_EXEMPLARS` is a hand-written `Record` with two hardcoded keys, and the test's only completeness assertion is `assert.ok(ids.length >= 2)`. An 11th pattern added to `SECRET_PATTERNS` with a narrow value class is never swept, and the suite stays green.
- **Position.** `withByte` splices the byte at exactly one offset (`abcd<B>efgh`, `MIIB<B>AAAA`). A narrowing that only bites the first or the last character of the value is invisible.

```
$ node scratch/r2c.mjs
control: shipped pattern sweeps clean: []

== EVASION SHAPE 5: a narrowing that only bites the FIRST value character ==
  shipped sweep (byte at index 4) flags it: false
  but a value whose FIRST char is 0xA0: null  -> whole literal matched? false
  (shipped pattern on the same input: "password = \"<A0>abcdefgh\"" )

== EVASION SHAPE 6: a narrowing that only bites the LAST value character ==
  shipped sweep (byte at index 4) flags it: false
  but a value whose LAST char is 0xA0: null  -> whole literal matched? false

== EVASION SHAPE 7: an 11th pattern with a defective value class, not in the hand-kept exemplar table ==
  catalog pattern ids today: 10
  a new pattern with a POSITIVE ASCII-only value class hides 0xA0: true
  would the shipped sweep see it? NO -- it iterates VALUE_CLASS_EXEMPLARS, not SECRET_PATTERNS.
```

**Current defense, honestly assessed.** Strictly stronger than the guard it replaces, and non-vacuous — its own positive control is real. The gap is that the *set swept* and the *position probed* are both hand-derived, which is the exact rule CLAUDE.md states as a hard invariant: "Any claim of completeness/exhaustive enumeration ... is generated by a running instrument — never hand-typed or hand-derived in prose." The test's comment asserts "both catalog patterns with a free-form value class are covered" — a hand-derived completeness claim about a 10-pattern catalog. This is the fourth iteration of one root-cause class: #244 (a phrase blacklist, five rewordings), #249 (a token spelling, four spellings), #268 (a syntax family, four constructs), and now a hand-kept scope plus a single splice offset. Worth the Manager's attention under PRINCIPLES rule 16's repeat-root-cause counter, even though each individual round did fix what it was asked to fix.

**Exposure: 0% of runs today** (the shipped catalog sweeps clean across 0x80-0xFF, verified), **~100% of future pattern additions and of any first/last-character narrowing, basis: measured** (3 of 3 shapes above).

**Proof-test required:** keep the name, fix the two dimensions — derive the swept set from `SECRET_PATTERNS` and fail when a pattern has no exemplar (so adding a pattern forces adding a sweep), and splice the byte at **every** position of the value rather than one. The whole-position sweep already exists as an instrument in my 2026-09-20 report (attack 9: `positions=26 lost=7 kept=19`). Neither change is more than a few lines.

## 2. [ISSUE][MED][demonstrated] The scan-timeout outcome is a wall-clock race, so its grant is not reproducible

`SCAN_TIMEOUT_MS` is a wall-clock threshold, so for a blob near it the gate's own verdict is nondeterministic on identical input, on one machine, run to run:

```
$ node scratch/r2e.mjs
size  run1..run5 -> which patterns timed out
 24KB  STABLE    (none)
 28KB  UNSTABLE  (none)   |   internal-hostname
 32KB  STABLE    email-address+internal-hostname
 36KB  STABLE    email-address+internal-hostname
 40KB  STABLE    email-address+internal-hostname
 44KB  STABLE    email-address+internal-hostname
```

Two consequences, both introduced by #264's otherwise-correct fix rather than by the timeout itself. The hash is now `sha256("oss01-scan-timeout:" + pattern.id + ":" + text)`, so it is keyed to **which pattern timed out**:

1. A marginal blob makes the gate intermittently red and green with no code change.
2. A developer running the printed `hash` command on a faster (or less loaded) machine gets a **different hash set** than CI computed — possibly none at all, in which case the command prints `no oss01-scan-timeout match in that blob`. The grant they commit is then incomplete and CI still blocks, with nothing reproducible locally. PRINCIPLES rule 2's "every block names its unlock" holds only when the two machines agree on which patterns were slow.

**Current defense, honestly assessed.** The security direction is safe: not timing out means the blob *was* fully scanned, so the unstable direction never hides anything. This is availability and unlock-reproducibility, not a bypass. Note for the Manager: this is the same class as Issue #265's complaint — a wall-clock threshold making a gate outcome machine-dependent — except demonstrated here in the **product**, not in a test.

**Exposure: 0% today** (round 1 measured this repo's worst real per-call time at 4.9 ms against a 500 ms budget, over all 11,740 calls), **100% of blobs inside the boundary band, measured at roughly ±15% around the threshold.**

**Proof-test required:** `oss01-a-scan-timeout-grant-does-not-depend-on-which-pattern-was-slow` — drop `pattern.id` from the hash input so one grant covers the blob rather than the blob-and-the-race, and have the block message say that a scan-timeout grant is machine-sensitive. Cheap, and it makes the unlock deterministic.

## 3. [SUSPICION][LOW][demonstrated] Two encodings now share one hash namespace with no domain separator

`hashMatchedBytes` picks its encoding from the match's content — `utf16le` when any code point exceeds 0xFF, `latin1` otherwise — and hashes the raw bytes either way. Nothing tags which branch produced them, so `latin1(S1)` and `utf16le(S2)` can be the same byte string for two different matched values:

```
$ node scratch/r2b.mjs
S2 (utf16le-hashed) code points: U+0061 U+0100 U+0062 U+0063
S1 (latin1-hashed)  code points: U+0061 U+0000 U+0000 U+0001 U+0062 U+0000 U+0063 U+0000
S1 === S2 ? false
hash(S1) = 64e66a1655d9eca7ccdb8b27a4516e7d08a9b5bee70a2b6d7d5d70551278de30
hash(S2) = 64e66a1655d9eca7ccdb8b27a4516e7d08a9b5bee70a2b6d7d5d70551278de30
CROSS-ENCODING COLLISION: true
```

**I could not reach it through the shipped catalog, and I tried.** Every pattern's match opens with an ASCII literal prefix, and any collision partner must carry that prefix NUL-interleaved, which no pattern matches:

```
$ node scratch/r2f.mjs
== which patterns can produce a match containing a code point > 0xFF ==
  generic-password-assignment    matched=true
  private-key-block              matched=true
== the ONLY latin1 string that could collide with that match ==
  first 24 chars, escaped: "p\u0000a\u0000s\u0000s\u0000w\u0000o\u0000r\u0000d\u0000 \u0000=\u0000 \u0000\"\u0000"
  is that collision partner itself a match of the same pattern? false
  => reachable through the shipped catalog? false
```

**Exposure: 0% today, basis: measured** (no reachable pair exists across the 10 shipped patterns). It is a latent property of the hash function, not a live hole — but it is the kind that becomes live the day a pattern without a fixed ASCII prefix is added. One-line fix: prefix a domain tag before the bytes, or hash every match as UTF-16LE unconditionally. Residual-register line, not a merge condition.

## 4. [SUSPICION][LOW][demonstrated] Post-timeout hashing is outside the budget it is meant to bound

The Manager asked this directly, and the answer is yes but bounded. `hashMatchedBytes` now runs on the *whole variant text* on the timeout path, and its `[...matched].some(...)` spreads that text into a per-code-point array before two further copies — none of it inside `SCAN_TIMEOUT_MS`:

```
$ node scratch/r2a.mjs
#247 regression check: wall time of ONE timing-out (blob,pattern) call, by blob size
     200KB      510ms  timeout=true  overshoot=10ms
     800KB      523ms  timeout=true  overshoot=23ms
    2000KB      547ms  timeout=true  overshoot=47ms
    8000KB      653ms  timeout=true  overshoot=153ms
   20000KB      825ms  timeout=true  overshoot=325ms
```

The overshoot is linear at roughly 16 ms per MB. At `realRunner`'s 64 MiB `maxBuffer` cap that is about 1 s per timing-out pattern, so a max-size blob's per-blob ceiling rises from the ~10 s I computed in round 1 (2 variants x 10 patterns x 500 ms) to roughly 30 s. #247 is not broken — the bound is still a bound, and it is still linear in a quantity git itself caps — but `SCAN_TIMEOUT_MS` no longer means what its name says on large inputs. **Exposure: 0% today (0 hostile blobs in history, and this repo's largest real blob is ~330 KB, measured); ~3x the stated per-blob ceiling at the maxBuffer cap, basis: measured slope.** Cheapest fix if wanted: hash the first N KB plus the length, or drop the `[...matched]` spread for a `for...of` with an early exit (it stops at the first high code point instead of materialising the whole array).

## 5. [SUSPICION][LOW][code-traced] The ADR says Issue 246 is kept open for the narrower gap; the Issue itself does not say so yet

The reworded ADR row states issue 246 is "still tracked under issue 246 (kept open for exactly this narrower gap, not closed at this story's merge)". #246 is indeed still OPEN — but its newest comment is the Manager's note from the *previous* story, and its title and body still carry the general claim. Nothing over-claims today; the risk is the same one I raised in round 1 (finding 5), now half-closed: the ADR carries the narrowing, the tracker does not.

```
$ gh issue view 246 --json comments --jq '.comments[-1].body[0:200]'
[Manager] From s1-237's cross-domain review ... UTF-32LE and base64 of a line also yield 0 matches ...
```

**Exposure: not a live gate defect; basis: counted-in-code.** Unlock: one comment on #246 narrowing its scope to BOM-less UTF-16 (and the wider encoding class), posted before merge.

## 6. [CLEAN][demonstrated] #264 is closed — the round-1 attack no longer works

The hash input moved from `text.length` to the variant's own text. Re-run of my round-1 probe:

```
$ node scratch/r2a.mjs
#264: two 200000-char blobs, different content
  A: ed05125fc94c649137b3
  B: 4ac82e2a1b0bb7090d82
  identical? false
  determinism (same text twice): true
```

And end-to-end through the real CLI, which is where round 1's attack succeeded:

```
$ node scratch/r2d.mjs
attacker blob, SAME path, SAME length (200000), old grant in place -> gate exit: 1
  [OSS-01 history-scan] FAIL: 2 secret-shaped match(es) found in history (2 allowlisted, not counted).
```

Round 1 printed `PASS  <=== SECRET NOT REPORTED, GATE GREEN` on that exact step. It now blocks. THOTH-ADR-0002's "hash over the matched bytes" rule is satisfied in substance, not just in field name.

## 7. [CLEAN][demonstrated] #267 is closed, landed in the same commit as #264, and the printed hash is the one the gate accepts

I warned in round 1 against shipping #267 without #264. Both are in `c453959`, one commit. Full unlock round trip on a crafted repository:

```
$ node scratch/r2d.mjs
gate exit: 1
printed unlock: - HASH-COMMAND for big.dat [oss01-scan-timeout]: node src/secret-scan/allowlist-tool.ts hash 6ce389b49920 "big.dat" oss01-scan-timeout
unlock exit: 0
   ed05125fc94c649137b36cdecb59f4c9ed856b78e4dec127c303c08a33ce5313  …[SCAN-TIMEOUT pattern=internal-hostname bytes=200000]
   ac23c14aa9a129c89bc5b29410d8aa29b02d9e410e58beb41b425fb3ddaba44a  …[SCAN-TIMEOUT pattern=email-address bytes=200000]
hashes printed: 2

after adding the printed hashes as a grant -> gate exit: 0
  [OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (2 allowlisted).
```

Exit 2 with `unknown pattern id` in round 1; exit 0 with two usable hashes now, and the gate accepts them verbatim. Attack 2 above is the one caveat on this: the hashes are only reproducible when the two machines agree on which patterns were slow.

## 8. [CLEAN][demonstrated] All four of my round-1 evasions are caught by the new sweep

```
$ node scratch/r2h.mjs
  control (shipped):                               []
  round-1 shape B: positive [\x21-\x7e]            CAUGHT (128 bytes flagged)
  round-1 shape C: positive [\w!@#$%^&*()+=./-]    CAUGHT (128 bytes flagged)
  round-1 shape D: negative lookahead (?!\xa0)     CAUGHT (1 bytes flagged)
  round-1 shape E: \p{ASCII}                       CAUGHT (128 bytes flagged)
```

The construct-independence claim holds for the dimension it was written for. Finding 1 is about the two dimensions it does not cover, not about this one.

## 9. [CLEAN][code-traced] The reworded ADR is accurate and does not overstate

Both edited rows check out against shipped code:

- The UTF-16 row now says the BOM'd case is closed, "additive on top of the always-on latin1 reading", and names the BOM-less case as the narrower open residual with its reason (interleaved NULs are indistinguishable from a NUL-separated-ASCII fixture). That matches `decodeBlobVariants` exactly, including the deliberate `high-bytes.bin` rationale, and it matches what I measured in round 1 (BOM'd LE and BE both caught and hashing identically to plain ASCII; both BOM-less forms report nothing). It claims "closed for the BOM'd case", not closed outright — the narrower, correct claim.
- The dedupe row now says "Closed (issue 250)", describes the `(path, sha)` key and the per-sha cache replayed under every distinct path, and records why `(commit, path)` was rejected with the measured 12x inflation. That matches `scanHistory`'s loop and the behaviour I re-verified in round 1.

One thing the register still does not carry, which is why I raise it here rather than call it finished: there is no row for the `oss01-scan-timeout` finding kind at all — that a pattern id outside `SECRET_PATTERNS` is grantable through this allowlist, and what its hash covers, is documented only in source comments. Editorial, listed below.

## 10. [CLEAN][demonstrated] The three round-2 guards are non-vacuous

Mutations applied simultaneously and reverted: M1 revert #264's hash to `text.length`; M2 revert #266's encoding choice to latin1-only; M3 revert #267's special case so the reserved id throws again.

```
$ node --test src/secret-scan/history-scan.test.ts src/secret-scan/allowlist-tool.test.ts
✖ sb2-hash-lines-computes-the-scan-timeout-pattern-id-without-throwing (0.807ms)
✖ oss01-a-scan-timeout-grant-does-not-exempt-a-different-blob-at-the-same-path (2811.285ms)
✖ oss01-every-blocking-pattern-id-has-a-runnable-unlock-command (1731.8313ms)
✖ oss01-utf16-disguised-match-does-not-collide-with-a-reviewed-ascii-value (784.4296ms)
tests 105  pass 101  fail 4  skipped 0

$ git checkout -- src/secret-scan/history-scan.ts src/secret-scan/allowlist-tool.ts && git status --porcelain
 M docs/.maat-state.json
```

Each mutation turns exactly the test that claims to cover it red, including the app-security lane's #266 test.

## 11. [CLEAN][demonstrated] No runtime regression from hashing the whole text

```
$ time node src/secret-scan/history-scan.ts
[OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (2108 allowlisted).
real  1m7.524s

$ node --test <the four secret-scan suites>
tests 149  pass 149  fail 0  skipped 0

$ npm run typecheck   -- clean
$ npm run lint        -- clean
```

67 s against round 1's 71 s on the same machine — the extra `[...matched].some(...)` on every normal match costs nothing measurable, because normal matches are short. The allowlisted count moves 2067 to 2108 for the ordinary reason (this round's own commit adds blob versions of files that already carry allowlisted fixtures).

## 12. [CLEAN][demonstrated] #265: I could not reproduce it either, and my run was not vacuous

Optional assignment. I ran the #250 proof-test — the one carrying the real-CLI subtest — 36 times under deliberate contention: six busy-loop processes pinning the CPU, three test workers in parallel per round.

```
$ bash scratch/r2g.sh
=== #265 repro: 36 runs of the proof-test under 6-way CPU contention x 3 parallel workers: pass=36 fail=0 ===

$ grep -E "✔ oss01-a-grant|ℹ (tests|pass|fail|skipped)" /tmp/r265-12-3.log
✔ oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another (1887.0408ms)
ℹ tests 1  pass 1  fail 0  skipped 0  todo 0
```

The second command matters: a `--test-name-pattern` that matches nothing exits 0, so I checked that each run actually executed the named test rather than filtering to zero. It did, every time.

**Read, stated honestly with its limits.** Against the originally reported ~1-in-4 rate, 36 clean runs would miss a genuine race with probability about 3 in 100,000, so this is strong evidence there is no 1-in-4 race **at this commit, on this platform, under this harness**. It is not evidence about a Linux CI runner with a different git version and filesystem, which I did not test. My read for the Manager: **environmental noise or an already-masked condition, not a genuine race** — but the honest residual is that the reported failure was on a different platform than the one three independent attempts (the implementer's 700+, app-security's re-attempt, my 36) have now cleared. If it recurs, capture the CI log rather than re-running locally.

---

## Residual register (no Issue owed)

| Residual | Disposition |
|---|---|
| `hashMatchedBytes` has two encodings in one namespace with no domain tag | Attack 3; unreachable through today's catalog, becomes live if a pattern without a fixed ASCII prefix is added |
| Post-timeout hashing costs ~16 ms/MB outside `SCAN_TIMEOUT_MS` | Attack 4; linear and capped by git's own 64 MiB buffer |
| THOTH-ADR-0002's residual register has no row for the `oss01-scan-timeout` finding kind | Attack 9; a grantable pattern id outside `SECRET_PATTERNS` is documented only in source comments |
| BOM-less UTF-16, UTF-32, legacy code pages, base64 | Unchanged; the ADR now states this narrowly and correctly |

## Editorial (verdict-neutral, plain edits, no re-review)

- `src/secret-scan/patterns.test.ts`, the `VALUE_CLASS_EXEMPLARS` comment "the two patterns app-security-reviewer identified as carrying an open or negated class" and the assertion message "both catalog patterns with a free-form value class are covered" — a hand-derived completeness claim over a 10-pattern catalog (CLAUDE.md hard rule). Covered substantively by finding 1; the wording is the editorial half.
- `c453959`'s message carries no `Closes #264 / #267 / #268 / #269` reference. CLAUDE.md's Issue Discipline ties closure to a real artifact; put the refs in the PR body if not the commit.
- THOTH-ADR-0002 should gain one residual row for the scan-timeout finding kind (attack 9), so the ADR records the full set of things the allowlist can exempt.

---

## The single scariest unproven assumption

**That a guard which is behavioural in one dimension is behavioural in all of them.** Round 1's guard classified syntax and lost to a construct it had not enumerated. Round 2's guard runs the real regex — genuinely better — and still enumerates by hand *which* patterns get swept and *where* the byte goes. Each round the enumeration moves one level up the stack and the same failure shape survives there. The thing that would end the sequence is deriving the swept set from `SECRET_PATTERNS` and the splice position from the exemplar's own length, so neither is a list a human maintains.

## Go / no-go

**go.** The round-1 HIGH is closed and I re-ran the exact attack that broke it; #267 landed with it as required; the ADR text is accurate; all four of my round-1 evasions are caught; the three new guards are proven non-vacuous by mutation; the gate is green with no runtime regression; and I independently failed to reproduce #265 across 36 non-vacuous runs under contention. The two MEDs are a guard that needs its scope derived rather than typed, and a wall-clock race that affects reproducibility rather than safety — both cheaper as named tests after merge than as another review round on a security fix that is now, on every measurement I can make, better than what it replaces.

## Single next action

Derive `VALUE_CLASS_EXEMPLARS` from `SECRET_PATTERNS` (fail when a pattern has no exemplar) and splice the probe byte at every position of the value, so the fourth instance of this root-cause class is also the last.

## Findings to failing tests

Open findings: 5. Named failing tests: 3. The two without an executable form are named below with why.

| Finding | Named test |
|---|---|
| 1 | `oss01-no-value-class-however-written-hides-a-high-byte` (same name, scope derived from `SECRET_PATTERNS` and every splice position) |
| 2 | `oss01-a-scan-timeout-grant-does-not-depend-on-which-pattern-was-slow` |
| 3 | `oss01-a-utf16-hashed-match-never-collides-with-a-latin1-hashed-one` |
| 4 | none — a measured residual-register line; the slope is linear and capped by git's own buffer limit |
| 5 | none — Issue hygiene (one narrowing comment on #246 before merge) |

---

RECEIPT: verdict=go
attacks (ALL, ranked by blast radius):
1. [ISSUE][MED][demonstrated] The new whole-pattern sweep is construct-independent but scope- and position-dependent: VALUE_CLASS_EXEMPLARS is a hand-written 2-key Record and the only completeness assertion is ids.length >= 2, and the byte is spliced at ONE fixed offset — 3 new evasions demonstrated (a narrowing biting only the FIRST value char, only the LAST, and an 11th catalog pattern never swept at all); violates CLAUDE.md's "no hand-derived completeness claims" hard rule; 4th iteration of one root-cause class (#244 phrase blacklist -> #249 token spelling -> #268 syntax family -> hand-kept scope + single offset), relevant to PRINCIPLES rule 16's repeat-root-cause counter; Exposure: 0% today (shipped catalog sweeps clean across 0x80-0xFF, verified), ~100% of future pattern additions and first/last-char narrowings, basis: measured (3 of 3); defense = strictly stronger than the guard it replaces and non-vacuous -> test oss01-no-value-class-however-written-hides-a-high-byte with scope derived from SECRET_PATTERNS and every splice position
2. [ISSUE][MED][demonstrated] The scan-timeout verdict is a wall-clock race: at 28KB, 5 runs of identical input on one machine give both "(none)" and "internal-hostname"; since #264's hash is keyed to which pattern timed out, a marginal blob flips the gate red/green with no code change, and a developer's `hash` run on a faster machine prints a different hash set (or none) than CI computed, so the grant they commit can be incomplete and CI still blocks with nothing reproducible locally — PRINCIPLES rule 2 conditional on two machines agreeing; same class as #265's complaint, demonstrated in the product rather than a test; Exposure: 0% today (worst real per-call 4.9ms vs a 500ms budget, 11740 calls, measured round 1), 100% of blobs in the boundary band (~±15% of the threshold, measured); defense = the unstable direction is fail-safe (not timing out means fully scanned) -> test oss01-a-scan-timeout-grant-does-not-depend-on-which-pattern-was-slow
3. [SUSPICION][LOW][demonstrated] #266's fix puts two encodings in one hash namespace with no domain separator: latin1(S1) == utf16le(S2) for distinct S1/S2, shown with a concrete colliding pair; NOT reachable through the shipped catalog (every pattern's match opens with an ASCII literal prefix and the collision partner needs that prefix NUL-interleaved, which no pattern matches — verified against both high-code-point-capable patterns); Exposure: 0% today, basis: measured; defense = the ASCII-prefix property of today's 10 patterns, which is incidental not designed -> one-line fix (domain tag, or hash utf16le unconditionally)
4. [SUSPICION][LOW][demonstrated] Post-timeout hashing is outside SCAN_TIMEOUT_MS (the Manager's own question, answered yes-but-bounded): hashMatchedBytes now runs on the whole variant text and its [...matched].some() spreads it per code point; overshoot measured linear at ~16ms/MB (10ms at 200KB, 325ms at 20MB), so at git's 64MiB maxBuffer cap the per-blob ceiling rises from ~10s to ~30s; #247 is not broken, but SCAN_TIMEOUT_MS no longer means what its name says on large inputs; Exposure: 0% today (largest real blob ~330KB), ~3x the stated per-blob ceiling at the cap, basis: measured slope; defense = linear and capped by a limit git itself enforces
5. [SUSPICION][LOW][code-traced] The reworded ADR says #246 is "kept open for exactly this narrower gap"; #246 is indeed still OPEN but its newest comment is from the PREVIOUS story and its title/body still carry the general claim, so the narrowing lives in the ADR and not yet in the tracker — round-1 finding 5, now half-closed; Exposure: not a live gate defect, basis: counted-in-code; unlock = one narrowing comment on #246 before merge
6. [CLEAN][demonstrated] #264 is closed: two 200000-char blobs of different content now hash differently (ed05125f vs 4ac82e2a), the hash is deterministic across repeat scans, and end-to-end at the real CLI the attacker's same-length blob at the same path with the legitimate grant in place now exits 1 where round 1 printed "PASS <=== SECRET NOT REPORTED, GATE GREEN"
7. [CLEAN][demonstrated] #267 is closed and landed in the SAME commit as #264 as I required: the printed HASH-COMMAND runs (exit 0), prints 2 hashes, and committing them as a grant turns the gate green (0 blocking, 2 allowlisted) — the printed hash is exactly what the gate accepts
8. [CLEAN][demonstrated] All four of my round-1 evasions are caught by the new sweep (positive [\x21-\x7e] 128 bytes flagged, positive [\w...] 128, negative lookahead (?!\xa0) 1, \p{ASCII} 128) while the shipped pattern sweeps clean — the construct-independence claim holds for the dimension it was written for
9. [CLEAN][code-traced] #269's ADR rewording is accurate and does not overstate: the UTF-16 row claims "closed for the BOM'd case" (not closed outright) with the BOM-less residual named and reasoned, matching decodeBlobVariants and my round-1 measurements; the dedupe row's (path,sha) description and the 12x (commit,path) rejection match scanHistory's loop
10. [CLEAN][demonstrated] The three round-2 guards are non-vacuous: a simultaneous 3-way mutation (hash by length, latin1-only encoding, reserved id throws) turns exactly 4 named tests red — including the app-security lane's own #266 test — 101 pass / 4 fail / 0 skipped, tree reverted clean
11. [CLEAN][demonstrated] No runtime regression: real gate PASS 0 blocking / 2108 allowlisted in 67s against round 1's 71s; four secret-scan suites 149 pass / 0 fail / 0 skipped; typecheck and lint clean
12. [CLEAN][demonstrated] #265 independent repro attempt (optional): 36 runs of the #250 proof-test under 6-way CPU contention x 3 parallel workers, pass=36 fail=0, and verified NON-vacuous (tests 1 pass 1 skipped 0 per run, so --test-name-pattern did not filter to zero); against the reported ~1-in-4 rate that is a ~3-in-100000 chance of missing a real race, so my read is environmental noise or an already-masked condition, NOT a genuine race — with the honest limit that I tested Windows, not the Linux CI runner where it was seen
counts (a CHECKSUM — equals the lines above): issues=2 suspicions=3 clean=7
evidence (a CHECKSUM over the tags above): demonstrated=10 code-traced=2 derived=0
checks=four secret-scan suites 149 pass / 0 fail / 0 skipped; 3-way mutation drill 101 pass / 4 fail / 0 skipped, reverted clean; #265 stress harness 36 runs pass=36 fail=0 (non-vacuous, tests 1 pass 1 per run); typecheck clean; lint clean; node src/secret-scan/history-scan.ts PASS 0 blocking (2108 allowlisted) in 67s; timeout-overshoot sweep over 5 blob sizes; determinism sweep 6 sizes x 5 runs; 8 adversarial probe scripts (r2a..r2h)
adr=HIT(37)
report=docs/reviews/s1-oss01-detection-residuals-red-team-round2-2026-09-22.md
