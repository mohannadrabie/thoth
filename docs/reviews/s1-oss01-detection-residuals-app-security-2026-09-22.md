# App Security Review — s1-oss01-detection-residuals

**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-22
**Scope:** branch `fix/s1-oss01-detection-residuals`, HEAD `39572a2`, diff `origin/master (2f61890)...39572a2`
**Tier:** CRITICAL (Manager-ratified; secret-scanning sensitive area)
**Context:** bundled fix for OSS-01 residuals #246 (UTF-16 decode), #247 (scan-time bound), #249 (0xA0 behavioral guard), #250 (blob-dedupe path-scoping). A parallel `cross-domain-reviewer` pass (APPROVE-WITH-CONDITIONS, 2026-09-22) and a parallel `red-team` pass ran independently on the same diff.

## ADR compliance (mandatory first step)

`node docs/adr-cache.mjs --ensure` returned `ADR cache HIT: reused 37 ADR(s) [CACHE=HIT]`. Per the cache-HIT protocol, read the applicable ADRs from the shared catalog (`docs/.maat-state.json -> adrCatalog.adrs`) rather than re-reading every ADR body. Applicable to this domain (security / secrets / data-model for a security control):

- **THOTH-ADR-0002** (`docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md`, status Proposed; the catalog serves a proposed ADR's rules like an accepted one's) - the governing ADR for this entire diff. Read in full.
- devops ADR-0008 (CI/CD gates and policy-as-code) - checked against the `ci.yml` `timeout-minutes` change; no rule it violates.
- SE ADR-0010 (code quality gates) - "MUST add a new third-party dependency only with a justification paragraph" - not triggered, no new dependency (verified below).

No other applicable ADR in this domain's slice. Cross-domain (whole-catalog) collision detection is `cross-domain-reviewer`'s job, already run and reported separately - not repeated here.

## THOTH-ADR-0002 end-to-end verification

The ADR's core rule: "An entry exempts a match only when its path, its patternId and the sha256 of the matched bytes all equal the entry's." `partitionAllowlisted` (`src/secret-scan/history-scan.ts:297-316`) still gates on exactly `(path, patternId, valueSha256 in entry.valueSha256)`, unchanged by this diff, and applies uniformly to every finding kind including the new `oss01-scan-timeout` id. That part of the contract holds.

Two places where the *hash itself* is no longer a faithful, unique fingerprint of "the matched bytes" were found - both undermine the ADR's stated guarantee that "reviewers see exactly which values each entry covers" (ADR "Positive" consequences) and its Rule "the value hash MUST be computed ... over the matched bytes."

### Finding 1 - oss01-scan-timeout grants are hashed by length, not content (HIGH, demonstrated)

`src/secret-scan/history-scan.ts:187` (the timeout branch of `scanBlobText`):
```
valueSha256: hashMatchedBytes(`${SCAN_TIMEOUT_PATTERN_ID}:${pattern.id}:${text.length}`),
```
The hash is a function of `(patternId, text.length)` only - never the blob's actual bytes (there are none to hash, since nothing matched, but the code fills that gap with a length, not a content digest). Any two blobs of the *same decoded length* that both trip the 500ms budget on the same pattern at the same path produce the identical `valueSha256`. Demonstrated directly against the shipped code (scratch script, not committed, deleted after use):

```
blobA.length 200000 blobB.length 200000 blobB contains secret: true
blobA matches: [ { id: 'oss01-scan-timeout' } ]
blobB matches: [ { id: 'oss01-scan-timeout' } ]
hashA: 5255f1b3fa3a7054707bc23849d65257908c528508083a85bed4e1e47f267d15
hashB: 5255f1b3fa3a7054707bc23849d65257908c528508083a85bed4e1e47f267d15
COLLISION (same hash, totally different content incl. a real secret hidden in B): true
```
`blobA` is `"a-".repeat(100000)` (the padding shape a human would legitimately grant per the ADR's own residual note: "if a human judges it a genuine oversized-but-legitimate asset"). `blobB` is a completely different blob - same 200,000-char length, a different padding character, and it embeds the literal string `REAL-LEAKED-KEY-DO-NOT-SHIP-1234567890` - yet both hash identically, because `hashMatchedBytes` never sees the real bytes, only the length.

Attack sketch: a maintainer reviews and grants one `oss01-scan-timeout` entry for a genuine oversized binary asset at path P/pattern Q (exactly the workflow the ADR anticipates). Any later commit at the same P whose blob (a) has the identical decoded text length and (b) independently trips the same pattern's 500ms budget - both fully attacker-controlled, since the attacker authors the whole blob - is silently marked ALLOWLISTED, no new allowlist.json diff required, no reviewer ever sees it.

Exposure: 0% of the current repo (0 of 460 lines in `docs/qa/secret-scan-allowlist.json` are `oss01-scan-timeout` entries today, grep-confirmed), but 100% of any future `oss01-scan-timeout` grant is affected by construction. Basis: counted-in-code + demonstrated. Security finding - exempt from PRINCIPLES rule 21's exposure cap regardless of the 0%-today figure; the mechanism ships now and the first legitimate grant made under it is unsafe on day one.

Minimal fix: hash the actual scanned text (e.g. `hashMatchedBytes(text)` over the full decoded variant, or the blob's own git sha, already known one call frame up in `scanBlob`) instead of `text.length`.

### Finding 2 - UTF-16 decode + latin1 hash truncation collides distinct values for two patterns (MED, demonstrated)

`hashMatchedBytes` (`src/secret-scan/history-scan.ts:83-91`) does `Buffer.from(matched, "latin1")`. For a JS string built from UTF-16 decoding (`decodeBlobVariants`, added by #246), a character's code point can be anywhere in the BMP (0-0xFFFF), but `Buffer.from(str, "latin1")` truncates each UTF-16 code unit to its low byte, discarding the high byte. Verified directly: `Buffer.from(String.fromCharCode(0x1041), "latin1")` yields `<Buffer 41>`, identical to `Buffer.from("A","latin1")`.

For the two patterns whose matched text can contain arbitrary characters - `generic-password-assignment` (`[^'" \t\n\v\f\r]{8,}`, a negated class) and `private-key-block` (`[\s\S]*?`, the any-character idiom) - a UTF-16-decoded match can consist of high-code-point characters that are visually nothing like the reviewed literal yet truncate, byte-for-byte, to the exact same low-byte sequence as an already-reviewed plain-ASCII value, producing an identical `valueSha256`. Demonstrated:
```
prefix = 'password = "'; valueTarget = 'SuperSecretPW1'; suffix = '"'
disguisedValue = each char of valueTarget shifted to codepoint 0x0500+ch  (Armenian-range glyphs)
-> reviewed ASCII hash:   65197b17d631648b8abd378444807dd930a905dbcf984b2eced81cc968f009cc
-> disguised UTF-16 hash: 65197b17d631648b8abd378444807dd930a905dbcf984b2eced81cc968f009cc  (COLLISION: true)
```
This is narrower than Finding 1: the low-byte content a colliding blob can carry is anchored to the exact bytes of the already-reviewed value (the attacker gets freedom over the high byte of each UTF-16 code unit only, not the low byte), so this does not let an attacker smuggle an arbitrary, independently chosen ASCII secret past an unrelated grant - the collision always resolves to the same underlying reviewed bytes, just disguised. But it does mean: (a) a new commit at an already-granted (path, patternId) can pass with zero allowlist.json diff and zero reviewer visibility for content nobody actually looked at (contradicts the ADR's "reviewers see exactly which values each entry covers" claim), and (b) `allowlist-tool.ts hash` (`runHash`, line 342) uses the identical `decodeBlobVariants` + `hashLines` -> `scanBlobText` pipeline, so a reviewer relying on the printed unlock hash would see the same collision-prone value.

Exposure: 2 of 8 SECRET_PATTERNS entries (25%, counted in code) carry an open/negated match class; the other 6 use positive character classes and are immune (verified by reading each regex in `src/secret-scan/patterns.ts`, cross-checked against the #249 `negatedClasses()` extractor's own output, which finds exactly one negated class in the whole catalog). Security finding - exempt from the exposure cap.

Minimal fix: either (a) reject a UTF-16 decoded match whose text contains any code point above 0xFF before hashing (fail closed on the ambiguous case, consistent with this module's own "don't guess" posture elsewhere), or (b) hash the true UTF-16 bytes of the match (e.g., re-encode to UTF-8 before hashing) instead of lossily reinterpreting the decoded JS string as latin1.

## Finding 3 - the #250 proof-test intermittently false-passes through the real CLI (HIGH, demonstrated)

Task instruction: "verify their final state is actually correct, don't just trust the narrative." I ran the touched test files directly, the same discovery shape CI's `npm test` uses (`node --test` auto-discovers all `*.test.ts` files and runs them with default, i.e. multi-file, concurrency; `.github/workflows/ci.yml:203` runs plain `npm test`, no `--test-concurrency=1`):

```
$ node --test src/secret-scan/history-scan.test.ts src/secret-scan/patterns.test.ts src/secret-scan/pre-commit-scan.test.ts
...
X oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another (859.4949ms)
  AssertionError [ERR_ASSERTION]: and through the real CI entry point
      at file:///C:/playground/thoth/src/secret-scan/history-scan.test.ts:1985:12
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 0,
    operator: 'notStrictEqual'
tests 128
pass 127
fail 1
```
This is the named proof-test for #250 (the blob-dedupe-vs-path-scoping fix, this PR's headline ADR-0002 compliance fix). Its final subtest ("and through the real CI entry point") asserts the real `history-scan.ts` CLI, spawned as a subprocess against a fixture repo with a byte-identical secret at a granted path (`aaa-granted.dat`) and an ungranted path (`zzz-not-granted.dat`), exits non-zero (blocks). It got `cli.code === 0` - a clean pass - meaning the ungranted path's secret-shaped match was not reported as blocking by the real gate entry point in this run.

I reran the identical 3-file invocation three more times to check reproducibility:
```
RUN 1: tests 128 pass 128 fail 0
RUN 2: tests 128 pass 128 fail 0
RUN 3: tests 128 pass 128 fail 0
```
So: 1 failure in 4 total runs (25% observed rate on this machine) of the exact command shape CI executes. The failure is isolated to the subprocess-spawning subtest ("through the real CI entry point") - the in-process assertions earlier in the same test (`scanHistory` called directly, `partitionAllowlisted` output) passed every time, including in the failing run (the assertion trace shows only the final CLI subtest threw). I was not able to conclusively isolate the root cause within this review's scope - candidates are (a) timing/resource contention across concurrently-running test files affecting the freshly-spawned subprocess's own read of the fixture git repository, or (b) a genuine, narrow race in the production dedupe/report path under load. I could not rule out (b) with the time available, and evidence policy requires me to say so rather than assume the friendlier explanation.

Either way, this is demonstrated evidence that directly contradicts the diff's own CHANGELOG claim (`CHANGELOG.md`, `s1-oss01-detection-residuals` entry): "npm test: 1055 passed, 0 failed, 0 skipped (full run, this story's own branch)" - that claim is not reproducible as a deterministic guarantee; it is one lucky sample. A secret-scanning CI gate that can intermittently, silently pass a blob it should block is the single worst failure mode this review axis exists to catch, independent of the exact trigger.

Exposure: 25% observed (1/4), basis: measured, on this reviewer's own machine running the exact `node --test`/discovery shape CI uses. Security finding (the gate's own regression proof for its headline fix) - exempt from the exposure cap regardless of the measured rate.

Recommendation, not a redesign: before merge, the implementer reruns this exact test (ideally the full suite via `npm test`, matching CI exactly) 10+ times, or with `--test-concurrency` forced high, to get a reliable flake-rate estimate and isolate whether the failure is in the fixture harness (`withPlumbingRepo`/`runCli`) or in `scanHistory`/`scanBlob`'s own dedupe-cache-replay path under concurrent load. This is a "does the gate actually gate" question and must be closed with a repeatable green run (or a demonstrated, disclosed root cause with a fix) before this ships, not carried as a known flake.

## vm.Script usage - sandbox-escape / code-injection check

Read matchAllBounded and its surrounding setup directly, not inferred from the name. CLEAN. The vm.Script source is a fixed, hardcoded string, never built by concatenating or interpolating blob content. Attacker-controlled blob content only ever flows in as data: a plain string assigned to a sandbox property, then passed to String.prototype.matchAll, which treats it as text to search, never as code to evaluate. This is a legitimate, standard pattern for bounding a regex's wall-clock cost via V8's vm timeout interrupt mechanism - not a sandbox/escape risk. matchAllBounded itself is fully synchronous end to end, so per JS run-to-completion semantics no other code can observe or mutate the shared sandbox mid-call.

## .github/workflows/ci.yml timeout-minutes 30

Sensitive area per CLAUDE.md ("Secret scanning / CI gates"). Verified minimal and correctly scoped: the added line sits inside the ci job block only; runtime-settings-drift (a separate job) has no timeout-minutes of its own and is untouched by this diff. No permissions block, secret exposure, or other job's timeout is touched. CLEAN.

## Dependencies / supply chain

git diff origin/master...39572a2 for package.json and package-lock.json is empty - no dependency added, removed, or bumped. The only new import is node:vm, a Node builtin, not a package. CLEAN.

## oss01-scan-timeout interaction with the rest of the allowlist system

- Collision with a real pattern id: SCAN_TIMEOUT_PATTERN_ID = "oss01-scan-timeout" can never equal any SECRET_PATTERNS id (all real ids are lowercase-hyphenated names like aws-access-key-id; verified by reading patterns.ts's full list - none is oss01-scan-timeout), so an attacker cannot spoof a real finding as a timeout or vice versa by choosing blob content. CLEAN.
- Weak hash binding for this new id: covered as Finding 1 above (HIGH).
- Alert-fatigue risk (legitimate large files training reviewers to click through): the 500ms budget carries roughly 100x headroom over this repo's own measured worst-case real-content pattern time (about 5ms on the roughly 330KB CHANGELOG.md, per the module's own comment and the CHANGELOG entry), so today's real content is not expected to trip it. This claim rests on the "no real content observed in this repo" framing (PRINCIPLES rule 18's own disclosed-measurement discipline) - reasonable, but it is a measurement over this repo's current content, not a guarantee for a repo that starts genuinely tracking oversized binary assets. LOW, derived (no current data showing repeated legitimate timeouts) - not a blocker, worth a line in the residual register if this repo starts tracking large binaries.

## Standard checklist

- eval / unsafe deserialization: none found; vm.Script usage is the closest surface and is clean (see above). JSON.parse usage in loadAllowlist is on a repo-local config file, wrapped in try/catch, fails closed on parse error. CLEAN.
- Secrets in new test fixtures: read every new fixture in history-scan.test.ts, patterns.test.ts, pre-commit-scan.test.ts (UTF-16 tests, hyphen-run/BEGIN-marker hostile blobs, dedupe test, 0xA0 behavioral probes). All values are either a runtime fixture builder's output, synthetic placeholders, or structurally-generated hostile shapes (repeated short strings). No real-looking committed literal. CLEAN.
- Access control / IDOR: not applicable - this is a CI/pre-commit instrument with no request-scoped identity or object ownership model.
- Injection (SQLi/XSS/SSRF/path traversal): not applicable - no network calls, no SQL, no HTML rendering; paths are read from git's own tree listing, not attacker-suppliable outside the repo's own tracked tree.

## Findings summary

| Num | Severity | Evidence | Blocking |
|---|---|---|---|
| 1 | HIGH | demonstrated | Yes - ADR-0002 content-binding broken for a new reserved id, day-one unsafe |
| 2 | MED | demonstrated | Yes, security finding, no exposure cap - narrower blast radius than 1 |
| 3 | HIGH | demonstrated | Yes - the 250 proof-test itself is not deterministically green through the real CLI |
| 4 | LOW | derived | No - disclosed residual, not a blocker |

## Verdict

REWORK. Two HIGH findings (both demonstrated) and one MED (demonstrated) are all security findings against the diff's own headline ADR-0002 compliance claims, and per PRINCIPLES rule 21 they are exempt from the exposure-based non-blocking cap regardless of measured blast radius. None require a redesign: Finding 1 and 2 are both minimal, localized hash-construction fixes; Finding 3 needs the implementer to reproduce, isolate, and either fix or conclusively disclose the root cause of the intermittent CLI-level false pass on the 250 proof-test before this can be trusted as verified genuinely fixed.

## Single next action

Implementer fixes Finding 1 (hash the actual scanned text or blob sha, not text.length, for oss01-scan-timeout findings) and Finding 2 (reject or properly re-encode UTF-16 matches containing code points above 0xFF before hashing), then reruns the full npm test suite at least 10x (matching CI's exact invocation) to establish whether Finding 3's intermittent CLI false-pass is a test-harness artifact or a production race, fixing or disclosing accordingly, before this ships.

---

RECEIPT: verdict=REWORK
findings (ranked by exploitability x impact):
1. [ISSUE][HIGH][demonstrated] src/secret-scan/history-scan.ts:187 -- oss01-scan-timeout valueSha256 is hashMatchedBytes over patternId+pattern.id+text.length, a function of length only, not content; PoC shows two 200000-char blobs, one embedding a real-looking secret literal, hashing identically. Fix: hash the actual text or the blob sha, not its length.
2. [ISSUE][HIGH][demonstrated] src/secret-scan/history-scan.test.ts:1957-1996 (oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another) -- the 250 proof-test's "through the real CI entry point" subtest intermittently returns cli.code=0 (should block) when run at CI's own node --test discovery/concurrency shape: 1 fail in 4 runs observed. Root cause not isolated (candidate: test-harness timing vs a real dedupe-cache race under load). Fix: implementer reproduces with repeated/high-concurrency runs and isolates before ship.
3. [ISSUE][MED][demonstrated] src/secret-scan/history-scan.ts:83-91 (hashMatchedBytes) plus decodeBlobVariants (246) -- Buffer.from with latin1 truncates UTF-16 code points above 0xFF to their low byte, letting a disguised non-ASCII-visual UTF-16 match collide-hash with an already-reviewed plain-ASCII value for 2 of 8 patterns with open/negated match classes (generic-password-assignment, private-key-block). Demonstrated PoC collision. Fix: reject match text with code points above 0xFF, or hash the true UTF-16 bytes instead of the lossy latin1 reinterpretation.
4. [SUSPICION][LOW][derived] oss01-scan-timeout's 500ms budget (100x headroom over today's measured worst case) could eventually create reviewer alert-fatigue noise if this repo starts tracking genuinely large binary assets -- no current data, not a blocker, worth a residual-register line.
5. [CLEAN][code-traced] vm.Script usage in matchAllBounded -- fixed script source, blob content only ever passed as data, no code-injection or sandbox-escape path; synchronous end-to-end so no cross-call state race.
6. [CLEAN][code-traced] .github/workflows/ci.yml timeout-minutes 30 -- correctly scoped to the ci job only; runtime-settings-drift job and permissions block untouched.
7. [CLEAN][code-traced] No new dependency (package.json/package-lock.json diff empty); only new import is node:vm, a builtin.
8. [CLEAN][code-traced] partitionAllowlisted's path/patternId/valueSha256 gate is unchanged and applied uniformly, including to the new oss01-scan-timeout finding kind.
9. [CLEAN][code-traced] pre-commit-scan.ts reuses scanHistory directly, so the UTF-16 decode and scan-timeout bound apply uniformly to the pre-commit path with no separate or bypassable code path.
10. [CLEAN][code-traced] SCAN_TIMEOUT_PATTERN_ID cannot collide with any real SECRET_PATTERNS id (verified against the full catalog).
11. [CLEAN][code-traced] All new test fixtures (UTF-16, hostile hyphen-run/BEGIN-marker, dedupe, 0xA0 probes) are synthetic or runtime-generated; no real-looking committed secret.
counts (checksum): issues=3 suspicions=1 clean=7
evidence (checksum): demonstrated=3 derived=1 code-traced=7
checks="127/1/0 (first run, 3 touched test files, one failure) then 128/0/0 x3 reruns|n/a for the full 1055-test suite (not run in full within this review's time budget)"
adr=HIT(37)
report=docs/reviews/s1-oss01-detection-residuals-app-security-2026-09-22.md
