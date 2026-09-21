# Red Team (Sutekh) — s1-237-nul-byte-scan, 2026-09-20

**Scope** CRITICAL-tier post-build adversarial pass. Branch `fix/s1-237-nul-byte-scan`, HEAD `942d8ac`, delta `e42a54f..HEAD` (4 commits). Issue 237, narrowed. `design-challenger` was skipped by Manager ruling, so its three questions (a) availability/fail-open beyond Issue 247, (b) honesty of closing 237, (c) safety of leaving 4 of 5 whitespace escapes, are carried here and answered below with executed evidence.

**Verdict: go.** No HIGH. The change is a net reduction in blind spots: it deletes a content-based skip and widens one value class, and every probe I could build confirms it fails closed. Three MED findings, all guard-strength or pre-existing-seam issues rather than a way past the gate, plus one LOW and one LOW suspicion. 9 attacks survived.

**ADR cache** `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — approx 18300 tokens saved this pass (fp e6c5377) [CACHE=HIT]`. ADRs read for this attack surface: THOTH-ADR-0002 (value-scoped allowlist: the hash/boundary rule and the no-other-exemption-shape rule), SE ADR-0005 / SE ADR-0010 (test deletion/weakening), devops ADR-0008 (suppression lists), SE ADR-0003 (injected I/O).

**Rule of engagement** Every literal in every probe is built at runtime; no secret-shaped literal is written into this report or into any tracked file. No source or test file was left modified: two mutation drills were applied and reverted, and `git status --porcelain` after each shows only the session's pre-existing `docs/.maat-state.json`, `docs/run-log.jsonl` and untracked `prompt`.

---

## Scorecard

| # | Attack | Status | Severity | Evidence |
|---|---|---|---|---|
| 1 | Hostile blob turns CI and the hook into a multi-hour stall, with content no reviewer can read | BREAKS | MED | demonstrated |
| 2 | The 0xA0 regression guard is spelling-based: 4 other spellings of the same defect pass green | BREAKS | MED | demonstrated |
| 3 | Blob dedupe defeats the allowlist path scoping, contradicting THOTH-ADR-0002's own rule | BREAKS | MED | demonstrated |
| 4 | "Monotone widening: can only add matches" is false — the widened class can swallow a neighbour | BREAKS | LOW | demonstrated |
| 5 | Legitimate binary assets now chance-match and need a per-version allowlist entry | UNPROVEN | LOW | demonstrated (property), 0% on this repo |
| 6 | Re-introduce looksBinary: do the inverted tests catch it? | SURVIVES | — | demonstrated |
| 7 | Revert the value class: does the 0xA0 proof catch it? | SURVIVES | — | demonstrated |
| 8 | Forge or destabilise the value hash of a NUL-bearing match | SURVIVES | — | demonstrated |
| 9 | Question (c): a high byte in a non-value position hides a secret from another pattern | SURVIVES | — | demonstrated |
| 10 | Question (b): is closing Issue 237 honest with UTF-16 open? | SURVIVES | — | demonstrated |
| 11 | Another skip/truncation elsewhere in the pipeline (size cap, path parsing) | SURVIVES | — | demonstrated |
| 12 | Terminal-escape or log-line forgery through newly scanned bytes | SURVIVES | — | code-traced + demonstrated |
| 13 | The allowlist moved, or THOTH-ADR-0002's boundary rule was skipped | SURVIVES | — | demonstrated |
| 14 | Definition-of-Done checks on the real tree | SURVIVES | — | demonstrated |

---

## 1. [ISSUE][MED][demonstrated] A hostile blob now reaches the quadratic patterns, and its content is invisible in the PR diff

**Scenario.** A contributor opens a pull request adding `asset.bin`, a 200 KB file whose first byte is NUL and whose body is a long hyphen-joined run. Git renders it as `Binary files /dev/null and b/asset.bin differ`; the reviewer sees `Bin 0 -> N bytes` and nothing else. Before this change the scanner skipped that blob outright. Now it matches it against all ten patterns. `internal-hostname` and `email-address` backtrack super-quadratically on that shape (Issue 247). Once the blob is in history, every CI run pays the cost forever, and every local `git commit` pays it too, because the pre-commit hook scans the whole simulated tree.

**Current defense, honestly assessed.** Real but partial. realRunner's 30 s timeout and 64 MiB maxBuffer are per-subprocess and do not bound regex time — the matching happens in-process in `scanBlobText`. `.github/workflows/ci.yml` has no `timeout-minutes` on the `ci` job (grep below returns nothing), so the GitHub default of 360 minutes applies. Issue 247 exists and is filed, at `severity:low`. The cost is identical for a plain-text file, so this change does not make the pre-existing path worse — it makes a previously free class of blobs expensive, and that class is exactly the one a reviewer cannot read.

```
$ node scratch/t1-cost.mjs      # looksBinary copied verbatim from e42a54f for the OLD column
crafted NUL+hyphen-run 25KB: bytes=25601 OLD(skip-check only)=0.0ms NEW(full scan)=888ms matches=0
crafted NUL+hyphen-run 50KB: bytes=51201 OLD(skip-check only)=0.0ms NEW(full scan)=6323ms matches=0
crafted NUL+hyphen-run 100KB: bytes=102401 OLD(skip-check only)=0.0ms NEW(full scan)=42721ms matches=0
crafted NUL+hyphen-run 200KB: bytes=204801 OLD(skip-check only)=0.0ms NEW(full scan)=179682ms matches=0
random binary 5MB (legit-asset proxy): bytes=5242880 OLD=0.0ms NEW(full scan)=85ms matches=1

$ node scratch/t9-delta.mjs     # is the delta the NUL class, or plain text too?
plain text, 50KB (scanned BEFORE and AFTER this change)   2462 ms matches=0
NUL at byte 0, 50KB (SKIPPED before, scanned now)         9210 ms matches=0
plain text, 100KB (scanned BEFORE and AFTER this change) 34565 ms matches=0
NUL at byte 0, 100KB (SKIPPED before, scanned now)       35462 ms matches=0
   pattern internal-hostname           21237 ms
   pattern email-address               16153 ms

$ grep -n "timeout-minutes" .github/workflows/ci.yml
(no output)

$ git show --stat HEAD | tail -3      # what a reviewer sees
 asset.bin | Bin 0 -> 10001 bytes
 1 file changed, 0 insertions(+), 0 deletions(-)
$ git diff HEAD~1 HEAD | head -6
Binary files /dev/null and b/asset.bin differ
```

Scaling is about n^2.7: 200 KB is 180 s, so roughly 1 MB is hours and roughly 2 MB exceeds GitHub's default job timeout. The blob produces **zero matches**, so it never blocks and never announces itself — it only burns time.

**Exposure: ~100% of CI runs and ~100% of local commits on a branch carrying such a blob, basis: measured** (the times above) **plus counted-in-code** (no `timeout-minutes`; no time bound in the scan loop, `src/secret-scan/history-scan.ts:93-102`). Trigger requires one merged or pushed blob.

**Proof-test/drill required:** `oss01-scan-time-is-bounded-on-a-hostile-blob` — a named test asserting a per-blob scan-time ceiling, and `timeout-minutes` on the `ci` job so an attack fails in minutes rather than hours. Filed as a comment on Issue 247 with a recommendation to re-rate it from `severity:low`: this change is what makes its worst case reachable from content a reviewer cannot inspect. **This does not gate the merge** — the plain-text path measures identically and predates the change.

## 2. [ISSUE][MED][demonstrated] The 0xA0 regression guard pins a spelling, not a behaviour

**Scenario.** Six months from now someone adds a pattern, or tightens this one, and writes the value class with an explicit `\xa0` or a `\p{White_Space}` escape instead of `\s`. Issue 237's second half is back. `oss01-no-negated-whitespace-class-hides-a-high-byte` stays green, because its tokenizer (`src/secret-scan/patterns.test.ts:126-155`) only recognises the two-character tokens `\s` and `\S`.

**Current defense, honestly assessed.** The guard is real and non-vacuous for the one spelling it knows — the mutation drill in attack 7 proves it fires on `\s`. It is blind to every other way to write the same exclusion. This is the same root-cause class as Issue 244 (a phrase blacklist that five rewordings evaded), which this project already paid for once in the previous story.

I extracted the SHIPPED tokenizer verbatim from the test file and ran it against five spellings of the identical defect, with a runtime-built probe:

```
$ node scratch/t4c.mjs
extracted tokenizer, self-test on the shipped catalog:
   aws-secret-access-key [["\s","outside"],["\s","outside"]]
   private-key-block [["\s","class"],["\S","class"]]
   generic-password-assignment [["\s","outside"],["\s","outside"]]

probe (runtime-built, no literal in any file): "password = \"abcd?efgh\""   (? is byte 0xA0)

spelling                                        shipped-guard-flags-it  actually-hides-0xA0
shipped, fixed (control)                        false                   false
old defect, spelled \s                          true                    true
same defect, spelled \xa0                       false                   true   <== GUARD BLIND
same defect, spelled                       false                   true   <== GUARD BLIND
same defect, spelled \p{White_Space}            false                   true   <== GUARD BLIND
same defect, a literal 0xA0 byte in the class   false                   true   <== GUARD BLIND
```

**The fix is cheap and I proved it works.** Replace the token-spelling assertion with a behaviour assertion: enumerate every negated class in every pattern source, rebuild it as a one-character regex, and assert it rejects no byte in 0x80-0xFF.

```
$ node scratch/t5.mjs
== proposed behaviour-based guard: no negated class may reject any byte 0x80-0xFF ==
  shipped, fixed (control)        rejects-high-bytes=none  clean
  old defect \s                   rejects-high-bytes=0xA0  FLAGGED
  defect \xa0                     rejects-high-bytes=0xA0  FLAGGED
  defect                     rejects-high-bytes=0xA0  FLAGGED
  defect \p{White_Space}          rejects-high-bytes=0x85,0xA0  FLAGGED
  defect literal 0xA0             rejects-high-bytes=0xA0  FLAGGED
  shipped catalog under the proposed guard:
    generic-password-assignment: negated classes=1 high-bytes-rejected=0
```

All five spellings caught; the shipped catalog passes unchanged.

**Exposure: ~0% of runs today** (the shipped catalog is correct), **~100% of future pattern edits that use another spelling, basis: measured** (5 of 5 spellings above). This is a guard-strength finding, not a live defect.

**Proof-test required:** `oss01-no-negated-class-rejects-a-high-byte`, the behaviour form above, keeping the existing test as the friendlier diagnostic if wanted.

## 3. [ISSUE][MED][demonstrated] Blob dedupe defeats the allowlist path scoping

**Scenario.** THOTH-ADR-0002's decision text says an entry "exempts a match only when its path, its pattern id AND the sha256 of the matched bytes all agree." `scanUnseenBlob` (`src/secret-scan/history-scan.ts:80-84`) returns null for any blob sha already seen, so a blob that lives at two paths is scanned once and attributed to whichever (commit, path) pair the walk reaches first. A grant at path A therefore exempts the byte-identical copy at path B, at every path, silently.

**Current defense, honestly assessed.** None at this layer. The containment is value scoping itself: the duplicate blob must be byte-identical to an already-blessed blob, so it can carry no new value. That bounds the damage to "path scoping is not enforced", not "a new secret passes".

```
$ node scratch/t7-dedupe.mjs
paths in the tree holding the literal: aaa-blessed.dat, zzz-smuggled.dat (byte-identical blob)
matches reported: ["aaa-blessed.dat"]
allowlisted: ["aaa-blessed.dat"]
blocking: []
=> the grant is scoped to aaa-blessed.dat, but zzz-smuggled.dat's copy is NEVER REPORTED (dedupe defeats path scoping)

$ node scratch/t7b-count.mjs        # reach on this repo's own history
commits: 245 distinct blobs: 1097
blobs living at MORE THAN ONE path (dedupe suppresses every path but the first): 1 = 0.1% of blobs
```

This is pre-existing, not introduced by this diff — but the diff's own safety argument ("a legitimate binary that produces a match is handled by the value-scoped allowlist below", `src/secret-scan/history-scan.ts:15`, and the edited ADR residual row) rests on the ADR sentence that this falsifies, so it belongs in this report rather than a future one.

**Exposure: ~0.1% of blobs (1 of 1097), basis: measured**, and it additionally requires a grant on one of the duplicate paths.

**Proof-test required:** `oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another`. Minimal fix: keep the cat-file dedupe for cost, but cache blob-sha to match-list and replay the cached matches for every path the blob appears at.

## 4. [ISSUE][LOW][demonstrated] "Monotone widening: the change can only ADD matches" is false

**Scenario.** The Phase 1 plan section 5 argues the change is safe because it "can only add matches". Under global non-overlapping matching that is not true: a widened value class can run past a 0xA0 and close on the NEXT quote, swallowing a following assignment that the old class matched on its own.

```
$ node scratch/t5.mjs
== is the widening monotone (can only ADD matches)? ==
  probe (runtime-built): "password = \"aaaaaaaa?token=\"bbbbbbbbbb\"\""   (? is byte 0xA0)
  OLD class matches: ["token=\"bbbbbbbbbb\""]
  NEW class matches: ["password = \"aaaaaaaa?token=\""]
  matches present under OLD and ABSENT under NEW: ["token=\"bbbbbbbbbb\""]
  => monotone-widening claim holds? false
  => does the new text still BLOCK the gate (>=1 match)? true
```

**Current defense, honestly assessed.** Strong in practice, weak in argument. The plan's own section 5 already caveats the overlap case, and criterion R237-11 measured it at zero on this repo; I reproduced that independently (attack 13). The swallowing match still blocks, and 0 of 50 allowlist entries use `generic-password-assignment` (attack 13), so nothing can be swallowed into an existing grant. The defect is that the stated invariant reads as provable when it is only measured here, today — and a future maintainer widening this class again will lean on the stronger sentence.

**Exposure: 0 occurrences in this repo's 1097 blobs, basis: measured.** No Issue filed (LOW). Resolve by softening the sentence and adding the named test `oss01-widening-a-value-class-can-swallow-an-adjacent-match`.

## 5. [SUSPICION][LOW][demonstrated] Legitimate binary assets now chance-match, and each version needs its own grant

Previously every binary with a NUL in its first 8000 bytes was free. Now each one is matched and any chance hit blocks until a reviewed allowlist entry is added — keyed to the exact matched bytes, so a regenerated asset needs a new entry every time. That is the bypass-by-attrition shape Issue 194 already named for this hook.

```
$ node scratch/t2-chance.mjs
random 4MB, seeds 0 to 7: matches=0 each
RANDOM TOTAL: 0 chance matches over 32MB = 0.00 per MB
gzip of docs/ (a real compressed asset): bytes=1748627 nulInFirst8000=true matches=1 {"email-address":1}
deflate of docs/: bytes=1748615 nulInFirst8000=true matches=1 {"email-address":1}
```

About 1 chance match per 1.75 MB of real compressed content; uniform random is clean. **Exposure: 0% on this repo, basis: measured** (`git ls-files --eol | grep -c "i/-text"` returns 0 — no tracked file is binary to git), so this is an adopter/future risk and UNPROVEN as a live one. Worth noting alongside it: the retired `sb2-no-tracked-text-file-is-skipped-as-binary` was the only instrument that would have warned when the first binary asset landed; nothing replaces that early warning. The same day's `app-security-reviewer` report measures the same class at higher per-file rates for executables and fonts; treat that figure as the stronger one.

## 6. [CLEAN][demonstrated] Re-introducing looksBinary is caught, loudly, at all three entry points

Mutation drill, applied to the working tree and reverted:

```
$ node --test src/secret-scan/history-scan.test.ts src/secret-scan/patterns.test.ts src/secret-scan/pre-commit-scan.test.ts
  (with looksBinary restored verbatim from e42a54f)
  x the literal in leading-nul.bin is matched / interior-nul.bin / trailing-nul.bin / nul-padding.bin / png-prefix.bin / every-byte-value.bin
x oss01-no-blob-is-skipped-whatever-its-bytes
x oss01-no-8000-byte-window-nul-at-7999-and-8000-are-both-scanned
  x scanHistory matches the key literal in nul-at-0.dat / nul-at-1.dat / nul-at-7000.dat / nul-at-7999.dat
x oss01-nul-byte-does-not-hide-a-secret
  x the CI entry point names nul-at-0.dat / nul-at-1.dat / nul-at-7000.dat / nul-at-7999.dat
x oss01-nul-byte-does-not-hide-a-secret (history-scan CLI)
x oss01-nul-bearing-blob-is-governed-by-the-value-scoped-allowlist
  x the hook names nul-at-0.dat / nul-at-1.dat / nul-at-7999.dat and never prints its literal
x oss01-nul-byte-does-not-hide-a-secret (pre-commit CLI)
tests 116  pass 93  fail 23  skipped 0

$ git checkout -- src/secret-scan/history-scan.ts && git status --porcelain
 M docs/.maat-state.json
 M docs/run-log.jsonl
?? prompt
```

23 failing assertions across 5 gate-level tests, at `scanHistory`, at the CI CLI and at the real pre-commit CLI. `high-bytes.bin` correctly stays green (it carries no NUL). **The in-place inversions are not a weakening**: both replacements fail on the exact behaviour their predecessors asserted, inverted, and the retired sibling's own state (no working-tree file for a tracked path) is asserted inside the replacement (the `existsSync` check at `history-scan.test.ts:1620`). That is evidence for the human's SE ADR-0005 / ADR-0010 exception; it does not decide whether the exception should be granted, which `cross-domain-reviewer` has correctly routed to the human.

## 7. [CLEAN][demonstrated] Reverting the value class is caught

```
$ node --test src/secret-scan/patterns.test.ts src/secret-scan/history-scan.test.ts
  (with the value class reverted to the whitespace-escape form)
  x a password containing a grave (C3 A0) is matched
x oss01-utf8-character-ending-in-0xa0-does-not-hide-a-password
x oss01-no-negated-whitespace-class-hides-a-high-byte
x oss01-high-byte-in-a-password-value-does-not-hide-it
tests 91  pass 87  fail 4  skipped 0

$ git checkout -- src/secret-scan/patterns.ts && git status --porcelain
 M docs/.maat-state.json
 M docs/run-log.jsonl
?? prompt
```

## 8. [CLEAN][demonstrated] The value hash of a NUL-bearing match is stable and cannot be forged

```
$ node scratch/t6-hash.mjs
plain value                                matches=1 scanHash=85c20c7ce92f0da5 matchesIndependentHash=true
value with an embedded NUL                 matches=1 scanHash=64d585ebebec9041 matchesIndependentHash=true
value with an embedded 0xA0                matches=1 scanHash=ffc16776ed435b39 matchesIndependentHash=true
same value, NUL padding around the line    matches=1 scanHash=85c20c7ce92f0da5 matchesIndependentHash=true

distinct hashes across the 4 matching variants: 3
the plain value and the NUL-padded-line value share a hash (same matched bytes): true
a NUL INSIDE the value changes the hash (no normalisation, cannot be forged from a blessed plain value): true
a 0xA0 INSIDE the value changes the hash: true
determinism over 200 scans of the NUL-bearing match: distinct hashes = 1
```

The latin1 round trip is exact, so the hash is over the blob's own bytes; NUL is not normalised away, so a blessed plain value cannot be turned into a NUL-bearing variant under the same hash, and vice versa. Surrounding NUL padding does not enter the hash, which is correct — only matched bytes do.

## 9. [CLEAN][demonstrated] Question (c): leaving 4 of 5 whitespace escapes alone is safe

Enumerated by instrument over the pattern sources, not by hand:

```
$ node scratch/t3-classes.mjs
== negated classes in the whole catalog (the only shape that can HIDE data) ==
  generic-password-assignment: rejects 8 byte(s): 0x09 0x0A 0x0B 0x0C 0x0D 0x20 0x22 0x27
  TOTAL negated classes in catalog: 1
== bytes the JS whitespace escape matches in a latin1-decoded blob == 0x9 0xA 0xB 0xC 0xD 0x20 0xA0
== control: every exemplar matches in full ==  (10 of 10 OK)
== insertion sweep: 0xA0 at every index of every exemplar ==
   generic-password-assignment  positions=26 lost=7 kept=19 shrunk=0
   private-key-block            positions=59 lost=50 kept=9 shrunk=0
   (8 more patterns, same shape)
```

The catalog contains exactly ONE negated class, and after the fix it rejects no byte above 0x7F. Everywhere else a byte inserted into a token destroys the token itself — a credential with 0xA0 spliced into it is no longer that credential — so there is no hiding position left for a high byte. The four separator escapes can only match more: the shipped control `oss01-latin1-nbsp-separator-still-matches` pins that, and narrowing them would create the evasion the Manager's Q3 refinement avoided. The any-character idiom is position-independent.

One residual, unchanged by this story and equally true of the old class: the value class still rejects ASCII space, so a password literal containing a space is invisible to the gate. Pre-existing, inherent to a heuristic catalog, not a regression — a residual-register line, not a finding.

## 10. [CLEAN][demonstrated] Question (b): closing Issue 237 is honest

Issue 237's body says "a UTF-16 text file ... is never matched against any pattern". That sentence stays literally true after the fix, so closing 237 without a recorded narrowing would have left a closed issue documenting a live defect. It is recorded, in five places:

```
$ gh issue view 237 --json comments --jq '.comments[] | .body'
[Manager] Scope narrowed by ruling (s1-237-nul-byte-scan, human-preapproved Manager decision, ratification
pending at PR): this Issue will be closed for (1) the NUL-byte skip in the first 8000 bytes and (2) the 0xA0
password-class miss. The UTF-16 case in the title is NOT fixed here; it is tracked as #246. The quadratic
regex cost found on the way is #247. Plan: docs/plans/s1-237-nul-byte-scan-phase1-2026-09-20.md.

$ gh issue view 246 --json number,title,state,labels,milestone
246 OPEN "OSS-01 does not decode UTF-16: a UTF-16 text file still hides a secret from the scanner (split from #237)"
    labels: bug, severity:med, oss   milestone: S1 — Protect the baseline

$ git diff e42a54f..HEAD | grep -in "utf-16\|utf16"
12 hits; every one states the residual — the CHANGELOG ("makes no claim about UTF-16"), the ADR residual row
("What remains open is UTF-16 text ... issue 246"), the decisions row (b), the plan, and history-scan.ts:15-17.
No hit claims coverage.
```

The comment predates my pass, names 246 and 247, and the CHANGELOG bullet is explicit. Nothing overclaims. SURVIVES.

## 11. [CLEAN][demonstrated] No other stage silently skips or truncates a blob

Two candidates, both probed on real repositories:

```
$ node scratch/t8-limits.mjs          # a 70 MB blob against realRunner's 64 MiB maxBuffer
(1) blob size: 73400343 bytes (maxBuffer is 67108864 )
    scanHistory THREW: git cat-file -p e305ed95f8446ee13e736916c095f2d329a6c496 failed:
    => fails CLOSED (the CLI exits non-zero; the pre-commit hook prints its BLOCKED message)

$ node scratch/t8d.mjs                # a tracked path containing a newline, vs lsTree's line split
core.quotePath=true:  ls-tree raw lines=2 (2 blobs in the tree)
   raw ls-tree: 100644 blob f54ad4... <TAB> "dir/a\nb.dat"  /  100644 blob 99bff0... <TAB> ordinary.dat
   scanHistory matches=2 paths=["\"dir/a\nb.dat\"","ordinary.dat"]
   => the newline-path secret is FOUND; the control is FOUND
core.quotePath=false: identical result
```

`git ls-tree` C-quotes a control byte in a path regardless of `core.quotePath`, so the line split in `makeGitOps.lsTree` (`src/lib/git.ts:101`) cannot drop an entry, and the secret in the newline path is caught. A blob over the buffer cap throws rather than returning empty — fail closed. Neither behaviour is changed by this diff (`catFileBlob` already ran before the old skip), and the pre-commit path shares the same `scanHistory`, so both hold there too. A grep for `looksBinary|isBinary|8000` over `src`, `.github/workflows` and `.githooks` finds no other content-based skip.

## 12. [CLEAN][code-traced + demonstrated] Newly scanned bytes cannot inject into the log

`redact` (`src/secret-scan/patterns.ts:80-83`) emits the first four characters of a match plus a length. For all ten patterns those four characters are fixed literal prefix characters (AKIA, the gh/github prefixes, the Slack prefix, the PEM dashes, the keyword words, word characters, digits) — never a contributor-chosen control byte, even now that a match may contain NUL or 0xA0 in its tail. The other contributor-controlled field on a detail line is the path, and attack 11 shows `git ls-tree` C-quotes control bytes there, so no raw newline or escape character reaches stdout and a detail line cannot be forged. The shipped tests assert the complementary half (no raw literal in any output) and pass.

## 13. [CLEAN][demonstrated] The allowlist did not move, and THOTH-ADR-0002's boundary rule is satisfied

R237-11 reproduced independently of the build receipt:

```
$ node src/secret-scan/allowlist-tool.ts verify --base 7b62344 --migrated docs/qa/secret-scan-allowlist.json
[allowlist-tool verify] PASS
[allowlist-tool verify] legacy entries: 50, migrated entries: 50, dropped as matching nothing: 0, value hashes: 108
[allowlist-tool verify] occurrences allowlisted before: 1540, after: 1540; newly allowlisted: 0; newly blocking: 0
[allowlist-tool verify] blessed values by pattern: aws-access-key-id=12, email-address=23,
                        github-fine-grained-pat=3, github-pat=2, internal-hostname=67, ipv4-private=1
[allowlist-tool verify] blessed values under docs/reviews/: 57
[allowlist-tool verify] blessed credential-shaped values: 17

$ node src/secret-scan/allowlist-tool.ts generate --base 7b62344 --out <scratch>/regen.json
[allowlist-tool generate] entries written: 50 (carried already-scoped: 0), dropped as matching nothing: 0, value hashes: 108
$ cmp <scratch>/regen.json docs/qa/secret-scan-allowlist.json
CMP: byte-identical

$ node -e "<count allowlist entries by patternId>"
entries: 50
entries by patternId: {"aws-access-key-id":10,"email-address":21,"ipv4-private":1,"github-fine-grained-pat":3,"internal-hostname":13,"github-pat":2}
total hashes: 108
```

**0 of 50 entries use `generic-password-assignment`** (instrument, not hand-read), so the ADR rule "a change to a pattern's match boundary MUST be accompanied by re-derived valueSha256 lists for every entry of that pattern" is satisfied vacuously — which is the right reading, and is also why attack 4 has no live consequence. No new exemption shape was added: the diff deletes one and adds none, which is what THOTH-ADR-0002's no-other-exemption-shape rule requires.

## 14. [CLEAN][demonstrated] Definition-of-Done checks on the real tree

```
$ npm test
tests 980  suites 0  pass 980  fail 0  cancelled 0  skipped 0  todo 0  duration_ms 169124.19

$ npm run typecheck      (tsc --noEmit -p tsconfig.json)   -- no output, clean
$ npm run lint           (eslint .)                        -- no output, clean

$ node src/secret-scan/history-scan.ts
[OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (1948 allowlisted).
exit=0

$ git ls-files --eol | grep -c "i/-text"
0
```

Note for the Manager: the same day's `cross-domain-reviewer` report raised a suspicion that the full suite went red in the shared working tree. My run of the same tree at the same HEAD gave **980 pass, 0 fail, 0 skipped**, a counter-data-point in favour of the interference explanation (concurrent lanes rewriting source in place) rather than a real flake in this change.

---

## Residual register (no Issue owed)

| Residual | Disposition |
|---|---|
| A password value containing an ASCII space is still invisible to `generic-password-assignment` | Pre-existing, unchanged by this story; inherent to a heuristic catalog |
| The "can only add matches" sentence in the plan overstates a measured result | Attack 4; soften the sentence, add the named test |
| Nothing warns when this repo's first binary asset lands | Attack 5; the retired real-tree assurance was that warning |
| UTF-16, and equally UTF-32, legacy code pages, base64 and compressed content | Issue 246 names UTF-16 only; the plan records the wider class |

## Editorial (verdict-neutral, plain edits, no re-review)

- `docs/plans/s1-237-nul-byte-scan-phase1-2026-09-20.md` section 5, "Removing the skip and widening the value class can only add matches" — measurably false as an absolute (attack 4); the same paragraph's own overlap caveat two sentences later is the accurate statement.
- The ADR residual row's "A test scans blobs with a NUL byte at every position" — the shipped fixture set is seven layouts, not every position; the sibling test covers offsets 0, 1, 7000, 7999, 8000 and 9000. `cross-domain-reviewer` raised the same wording.

---

## The single scariest unproven assumption

**That the gate's cost is bounded by the content people intend to commit.** Every performance number this story rests on (R237-13's 15.3 s versus 14.9 s, the spike's 50 MB random at 504 ms) measures benign content on a repository with no binary assets. The measured worst case is 180 s for 200 KB of content a reviewer cannot read, on a scan loop with no time bound and a CI job with no `timeout-minutes`. Nothing in the design says what the gate does when an input is adversarial rather than merely large — and this change is precisely what opens that input class.

## Go / no-go

**go.** No HIGH finding. The change removes a real, demonstrated blind spot; it fails closed everywhere I could push it; the allowlist is provably unmoved; both in-place test inversions are proven non-vacuous by mutation. The three MED findings are a guard that pins a spelling, a pre-existing dedupe seam that contradicts an ADR sentence, and an availability amplification of an already-filed Issue — none of them a way past the gate, all of them cheaper to fix as named tests after merge than to hold a security fix for.

## Single next action

Comment the measured worst case on Issue 247 and add `timeout-minutes` to the `ci` job, so an adversarial blob fails the build in minutes instead of burning the default six hours on every run, forever.

## Findings to failing tests

Open findings: 5. Named failing tests: 5 — one per finding, none without an executable form.

| Finding | Named test |
|---|---|
| 1 | `oss01-scan-time-is-bounded-on-a-hostile-blob` |
| 2 | `oss01-no-negated-class-rejects-a-high-byte` |
| 3 | `oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another` |
| 4 | `oss01-widening-a-value-class-can-swallow-an-adjacent-match` |
| 5 | `oss01-a-tracked-binary-asset-is-reported-before-it-blocks-a-commit` |

---

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated] Hostile NUL-prefixed blob reaches the quadratic patterns (200 KB = 180 s, old code 0.0 ms) with content invisible in the PR diff; no time bound in the scan loop, no timeout-minutes on the ci job; Exposure: ~100% of CI runs and local commits on an affected branch, basis: measured + counted-in-code; defense = Issue 247 filed at severity:low, which under-rates the now-reachable case -> commented on Issue 247, test oss01-scan-time-is-bounded-on-a-hostile-blob
2. [ISSUE][MED][demonstrated] oss01-no-negated-whitespace-class-hides-a-high-byte pins the \s spelling only; 4 of 5 spellings of the identical defect pass green while still hiding a 0xA0 password; Exposure: ~0% today, ~100% of future pattern edits using another spelling, basis: measured; defense = real but spelling-bound (same class as Issue 244) -> Issue 249, test oss01-no-negated-class-rejects-a-high-byte
3. [ISSUE][MED][demonstrated] Blob dedupe attributes a repeated blob to one path, so a grant at path A silently exempts the identical blob at path B, contradicting THOTH-ADR-0002's own path-agreement rule; Exposure: ~0.1% of blobs (1 of 1097), basis: measured; defense = value scoping bounds it to already-blessed values, nothing at the dedupe layer -> Issue 250, test oss01-a-grant-at-one-path-does-not-exempt-the-same-blob-at-another
4. [ISSUE][LOW][demonstrated] The plan's "widening can only add matches" is false: the widened class swallows an adjacent assignment and removes a match the old class found; Exposure: 0 of 1097 blobs, basis: measured; defense = plan's own overlap caveat plus R237-11 measured 0, and 0 of 50 entries use this pattern -> no Issue (LOW), test oss01-widening-a-value-class-can-swallow-an-adjacent-match
5. [SUSPICION][LOW][demonstrated] Legitimate binary assets now chance-match (1 per 1.75 MB of real compressed content, 0 per 32 MB random) and each asset version needs its own reviewed grant; Exposure: 0% on this repo (0 tracked binaries, measured); defense = the value-scoped allowlist, at per-version cost, with no early warning since the real-tree assurance test retired
6. [CLEAN][demonstrated] Mutation: looksBinary restored -> 23 assertions red across 5 gate-level tests at scanHistory, the CI CLI and the real pre-commit CLI; the in-place inversions are not a weakening
7. [CLEAN][demonstrated] Mutation: value class reverted -> 4 tests red including the tokenizer guard and the 128-high-byte sweep
8. [CLEAN][demonstrated] The value hash of a NUL-bearing match equals an independent latin1 sha256, is deterministic over 200 runs, and an embedded NUL or 0xA0 changes it, so a blessed value cannot be forged into a variant
9. [CLEAN][demonstrated] Question (c): exactly 1 negated class exists in the whole catalog (instrument) and it rejects no byte above 0x7F; leaving the 4 separator escapes and the any-character idiom alone is safe
10. [CLEAN][demonstrated] Question (b): closing Issue 237 is honest -- the narrowing comment, Issue 246 (severity:med, oss, milestone S1), Issue 247, the CHANGELOG, the ADR residual row, the decisions row and the source header all state the UTF-16 residual; 12 of 12 UTF-16 mentions in the diff disclose, 0 claim coverage
11. [CLEAN][demonstrated] No other skip or truncation: a 70 MB blob over the 64 MiB maxBuffer throws and fails closed; a newline-bearing tracked path is C-quoted by git ls-tree under both core.quotePath settings and its secret is found; no other content-based skip exists in src, workflows or hooks
12. [CLEAN][code-traced] redact emits only 4 fixed literal prefix characters plus a length, so no contributor-chosen control byte reaches the log through a match, and ls-tree C-quoting stops a path from forging a detail line
13. [CLEAN][demonstrated] Allowlist unmoved: verify --base 7b62344 PASS, 50/50 entries, 108 hashes, 1540 occurrences before and after, 0 newly allowlisted, 0 newly blocking; fresh generate byte-identical (cmp); 0 of 50 entries use generic-password-assignment, so THOTH-ADR-0002's boundary rule is satisfied
14. [CLEAN][demonstrated] DoD on the real tree: 980 pass 0 fail 0 skipped, typecheck clean, lint clean, OSS-01 gate PASS with 0 blocking, 0 files classified i/-text
counts (checksum over the lines above): issues=4 suspicions=1 clean=9
evidence (checksum over the tags above): demonstrated=13 code-traced=1 derived=0
checks=npm test 980 pass / 0 fail / 0 skipped; mutation M1 (looksBinary restored) 93 pass / 23 fail / 0 skipped; mutation M2 (value class reverted) 87 pass / 4 fail / 0 skipped; typecheck clean; lint clean; node src/secret-scan/history-scan.ts PASS 0 blocking (1948 allowlisted); allowlist-tool verify PASS, generate byte-identical
adr=HIT(37)
report=docs/reviews/s1-237-nul-byte-scan-red-team-2026-09-20.md
