# cifix -- Infra Security Review, ROUND 3 re-confirm (Wadjet)

**Date:** 2026-09-09
**Reviewer:** infra-security-reviewer (Wadjet)
**Scope:** cifix, CRITICAL tier, infra-only. Round-3 re-confirm, post-council fix-now round.
Council ratified Path A (mechanical allowlist patch, no scanner architecture change) -- `docs/decisions.md`'s 2026-09-09 "cifix design council" row. Since round 2, story-implementer fixed Issues #132 (ls-remote credential/network vs. gitlink-reachability message split), #129 (new `github-fine-grained-pat` pattern), #130 (narrowed internal-hostname lookahead + true-positive regression test -- closes MY OWN round-2 MED finding #3), #134 (completeness-claim number corrections), and ran the real gating dogfood drill to `ok=true` with scoped allowlist entries.
**ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`

## ADR compliance

Same applicable ADRs as rounds 1-2 (devops ADR-0008 CI/CD gates and policy-as-code, devops ADR-0009 least-privilege IAM/secrets), read from the shared catalog per PRINCIPLES.md rule 9, not re-read here. No literal rule in either ADR addresses a GitHub-Actions-secrets/PAT scenario or a secret-scan-pattern false-positive rate; their spirit (vaulted secrets, least-privilege scope, disclosed rotation, ratchet-only gating) is unchanged and still satisfied -- see findings below. No applicable-ADR violation found in this round's delta.

## What I did (re-verification, not trust)

1. Read this session's live diff end to end: `.github/workflows/ci.yml`, `src/secret-scan/patterns.ts`, `src/secret-scan/patterns.test.ts`, `docs/qa/secret-scan-allowlist.json` (`git diff` against HEAD for each).
2. Independently reproduced the Issue #132 message-split mechanism's credential-safety property in a real local git repo (fake HOME, fake token, insteadOf rewrite) -- ran `git ls-remote` against a real GitHub URL forced into an auth-failure shape, captured raw stdout+stderr, and confirmed the token literal never appears in git's own failure message, which names the original (uncredentialed) URL only.
3. Read the full "Init adr submodule" step (ci.yml:34-135) line by line against round 2's own findings to confirm no regression to the credential-handling mechanism itself.
4. Independently re-ran the full internal-hostname true/false-positive differential (25 constructed cases spanning both #113's FP class and #130's TP class) against the live regex, confirming my own round-2 MED finding #3 is now closed by a real narrowing plus a real regression test, not just a comment.
5. Independently probed the new github-fine-grained-pat regex for false positives with 7 constructed cases mimicking ordinary code/prose that discusses PAT handling without containing a secret -- 4 of 7 false-positived. Verified a minimal tightened regex against both the false-positive cases and both true-positive fixtures (patterns.test.ts's synthetic literal and the real, already-committed Issue #89 exemplar).
6. Independently checked Issue #89's newly-surfaced old exemplar: read the S5 report it lives in (docs/reviews/s5-deny-by-default-hook-wiring-design-challenger-round2-2026-09-06.md:135), read the GitHub Issue #89 thread itself (gh issue view 89), and ran `git log --all -p -S "11A325Z2Q0nr4rtN9beavQ" -- .` and `git log --all -p -G "github_pat_" -- .` over the ENTIRE repo history to confirm no fuller or less-truncated version of this string was ever committed anywhere.
7. Re-ran the real test suite (npm test) for a fresh, live count.
8. Checked for pre-existing leftover scratch files in the working tree (git status --short) -- found and reused two (__rt3pat.ts, __rt3scan.ts, apparently left by a prior round's ad hoc reproduction) rather than duplicating equivalent probes from scratch; removed my own scratch file after use.

## Findings (ranked by exploitability x impact)

### 1. [CLEAN][demonstrated] -- Issue #132's message-split fix introduces no credential-leak regression; the secret still never appears in either message path

**Evidence -- reproduced directly, not read-and-trusted:**
```
$ HOME=<fake> GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0="url.https://x-access-token:FAKETOKEN12345@github.com/mohannadrabie/adr.git.insteadOf" \
  GIT_CONFIG_VALUE_0="https://github.com/mohannadrabie/adr.git" \
  git ls-remote https://github.com/mohannadrabie/adr.git 2>&1
exit=128
remote: Invalid username or token. Password authentication is not supported for Git operations.
fatal: Authentication failed for https://github.com/mohannadrabie/adr.git/
$ echo "$OUT" | grep -c "FAKETOKEN12345"
0
```
Git's own fatal-auth-failure message names the original, uncredentialed URL argument, never the insteadOf-rewritten credentialed form -- this is structural (git reports the URL as invoked, not as internally rewritten), not merely masked-after-the-fact. The new ci.yml:109-111 path (`LS_REMOTE_OUTPUT="$(git ls-remote ... 2>&1)"` captured and echoed verbatim into the error message) therefore cannot surface the token via this failure class, because the token was never in git's message to begin with. Combined with round 2's already-verified finding (GitHub's own secret-value log masking covers the residual theoretical case where a different git failure mode ever did echo a credentialed URL, since secrets.ADR_REPO_PAT is referenced via the standard interpolation form in this same step), both the structural and the belt-and-suspenders mitigations still hold against this round's new message-echo path. No regression.

### 2. [CLEAN][code-traced][demonstrated] -- Round-2's own MED finding (Issue #130, internal-hostname false-negative on multi-label FQDNs) is genuinely fixed, not just claimed

**Evidence:** src/secret-scan/patterns.ts's internal-hostname regex is now narrowed from round 2's blanket "no continuation at all" lookahead to exclude only the two continuation shapes that actually caused Issue #113 (a file-extension-like suffix, or a hyphenated-English-modifier suffix), not any dot/hyphen continuation whatsoever. Independently re-ran the differential (25 cases) against the live regex:
```
ok  want=MATCH got=MATCH(host01.corp)  host01.corp.contoso.com
ok  want=MATCH got=MATCH(api.internal) api.internal.acme.com
ok  want=MATCH got=MATCH(db1.internal) db1.internal.example.com
ok  want=no    got=no                  settings.local.json   (#113 FP, still excluded)
ok  want=no    got=no                  settings.local-shaped strings   (#113 FP variant, still excluded)
```
patterns.test.ts now also carries a named regression test for exactly this class (lines 51-60), asserting host01.corp.contoso.com/api.internal.acme.com/db1.internal.example.com all match. My round-2 recommended fix (narrow the lookahead plus add the named test) is exactly what shipped. Closes round-2 finding #3 -- recommend closing Issue #130.

One residual, minor, non-blocking observation from my own differential: "svc.internal-prod" (a hyphen-then-lowercase-word continuation with no digit) still does not match -- the exclusion lookahead is slightly wider than only the -shaped/-only modifiers named in the comment, so a real host literally named svc.internal-prod would still false-negative. This is a much narrower residual than round 2's blanket exclusion (measured today: zero occurrences in this repo's tracked content, same instrument as round 2's own measurement), not worth a fresh Issue on its own -- noting it in case a future narrowing pass wants the full picture.

### 3. [ISSUE][MED][demonstrated] -- Issue #129's new github-fine-grained-pat pattern false-positives on ordinary snake_case English/code phrases that discuss PAT handling but contain no secret

**Evidence -- ran it, not reasoned about it:**
```
=== github-fine-grained-pat FALSE-POSITIVE probe ===
  ok  want=MATCH got=MATCH  github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwx
  **  want=no    got=MATCH  load_github_pat_for_submodule_checkout
  **  want=no    got=MATCH  read_github_pat_from_environment_variable
  **  want=no    got=MATCH  const github_pat_env_var_name_constant = 1
  **  want=no    got=MATCH  my.github_pat_helper_function_name_here()
  ok  want=no    got=no     GITHUB_PAT_UPPERCASE_ENV_NAME_HERE_XXXX
  ok  want=no    got=no     github_pat_short
```
The regex requires the literal prefix github_pat_ followed by 20 to 255 word characters, with no further structure required -- any snake_case identifier or plain-English phrase (comment, doc, log line, variable name) that happens to contain the literal substring github_pat_ followed by 20+ word characters matches unconditionally, because a word-character class accepts letters, digits, AND underscores. This is not hypothetical: it is exactly the kind of phrase a security review discussing PAT-handling code would naturally write (as this very report just demonstrated by needing to quote four such phrases for evidentiary purposes) -- a materially larger false-positive surface than Issue #113's original hostname-in-filename problem, because "discussing this credential type in prose" is common security-review language, not a narrow accidental filename collision.

**Measured exposure today:** 0 percent (no such phrase exists yet in this repo's tracked history -- confirmed via the same history sweep used for finding 4 below, only the one real Issue #89 exemplar exists). This will not stay at 0 percent: this very report, once committed, contains four matching phrases in the block quoted above and will itself need a docs/qa/secret-scan-allowlist.json entry before it can be committed clean -- a live, self-demonstrating instance of the same allowlist-growth dynamic architecture-reviewer's council report already named as structural (docs/reviews/cifix-architecture-2026-09-09.md, finding 1), now shown to also apply to this newer pattern, not only internal-hostname.

**Minimal fix, verified:** tighten to GitHub's actual documented two-segment shape (a fixed-alphabet identifier segment, then a literal underscore, then a fixed-alphabet secret segment, no further underscores permitted inside either segment) -- require both segments to be plain alphanumeric (no underscore) rather than the looser word-character class currently used. Re-ran against all 7 false-positive/true-positive cases above plus both fixtures already in the codebase:
```
ok  want=false got=false  load_github_pat_for_submodule_checkout
ok  want=false got=false  read_github_pat_from_environment_variable
ok  want=false got=false  const github_pat_env_var_name_constant = 1
ok  want=false got=false  my.github_pat_helper_function_name_here()
ok  want=true  got=true   patterns.test.ts's own synthetic true-positive fixture
ok  want=true  got=true   the real (truncated) Issue #89 exemplar
```
Zero regressions against either existing true-positive fixture; every constructed false positive rejected. Not filed as blocking cifix -- same reasoning the council already applied to the analogous internal-hostname false-positive/negative class: a pattern-catalog precision issue, contained, disclosed, with a verified minimal fix, on a scanner whose own header already discloses it is a curated set, not a claim of exhaustiveness. Filed as GitHub Issue #135 (new this round -- no prior reviewer flagged this specific false-positive class; architecture-reviewer's council report addressed Issue #129 only as a detection-coverage gap, not as an FP risk of its own).

**Named failing test (per PRINCIPLES rule -- findings become tests):** "github-fine-grained-pat: does NOT match ordinary PAT-discussion prose (regression -- Issue #135)" -- asserting the pattern does not match "load_github_pat_for_submodule_checkout"; currently it does match against the shipped regex.

### 4. [CLEAN][code-traced][demonstrated] -- Issue #89's newly-surfaced old exemplar: allowlist-and-flag-for-human-rotation-call is the correct, proportionate response, not an under-response

Independently checked, not taken on the allowlist entry's own word:

- **What the string actually is:** docs/reviews/s5-deny-by-default-hook-wiring-design-challenger-round2-2026-09-06.md line 135 quotes a github_pat_-prefixed value truncated with a trailing ellipsis, sourced (per the report's own demonstrated-tagged evidence and Issue #89's own filed body) from a direct read of a real ~/.claude.json on the reviewing machine on 2026-09-06 -- genuinely real, not a fixture or synthetic example. Confirmed via `gh issue view 89`.
- **Exactly how much of the real secret is present:** GitHub's fine-grained PAT format is the literal prefix github_pat_ (11 chars) plus a 22-char identifier segment plus an underscore plus a 59-char secret segment, 93 chars total. Counting the disclosed suffix precisely gives exactly 23 characters: the 22-char identifier segment plus its trailing separator underscore, matching the allowlist entry's own "23 of approximately 93" count exactly. Zero characters of the 59-char secret segment are present. The identifier segment is not itself secret material (it does not participate in the credential's authentication entropy); nothing in the committed string is sufficient to reconstruct or brute-force the actual secret (59 base62 characters is roughly 350 bits of entropy -- computationally infeasible from a bare prefix).
- **No fuller version exists anywhere in history:** a full-history search for the disclosed substring, and a separate full-history search for the github_pat_ prefix generally, across the ENTIRE repo history both return exactly one hit -- this same truncated line, in this same commit. The truncation was applied at authoring time and never existed in a less-truncated form in this repo.
- **Verdict: the allowlist-plus-human-flag response is right-sized, not under-sized.** It correctly (a) does not silently drop the match (partitionAllowlisted still reports it, per OSS-01's own "reported, never silently dropped" discipline -- independently confirmed at the allowlisted-still-reported test, still passing), (b) does not attempt an in-repo remediation this reviewer role has no standing to make (rotating a human's personal GitHub PAT is not a code change), and (c) escalates the one decision that genuinely needs a human -- whether the live credential behind this identifier is still active and should be rotated -- rather than resolving it unilaterally by guessing. A mandatory-rotation blocking gate on cifix would be disproportionate: this exposure predates cifix by three days, is already tracked (Issue #89, OPEN), was already flagged for a rotation call (docs/backlog.md line 56), and blocking an already-8-day-dead CI restoration over a zero-secret-entropy prefix disclosure would not improve security, only delay an unrelated fix. Not escalated further; no new Issue needed for this finding -- the existing backlog flag is sufficient and correctly scoped.

### 5. [CLEAN][code-traced] -- Least-privilege/credential-scope conclusions from rounds 1-2 still hold against the final diff

- The top-level permissions block (contents: read) is unchanged.
- ADR_REPO_PAT is still single-repo (mohannadrabie/adr), Contents:Read-only, 90-day-expiry (ci.yml lines 71-72, unchanged text) -- matches docs/decisions.md's 2026-09-09 ruling and docs/backlog.md's rotation-tracking line, unchanged since round 2.
- Default GITHUB_TOKEN (the Checkout step) is never widened -- submodules: deliberately absent, unchanged.
- The credential remains fully isolated to the one "Init adr submodule" step's env block; no later step re-reads or re-exports it.

### 6. [CLEAN][demonstrated] -- Full suite genuinely green, fresh count

```
$ npm test
tests 662
pass 662
fail 0
skipped 0
duration_ms 19723.16
```
662 (up from round 2's 660 -- the two new regression tests for Issues #129/#130), all passing, 0 skipped. The OSS-01 dogfood test itself passed as part of this run. Also independently re-confirmed via a fresh ad hoc scan against HEAD~1 (ok=true, blocking=0, allowlisted=10).

## Editorial

- Two untracked scratch files (__rt3pat.ts, __rt3scan.ts) were already present in the working tree at the start of this round, apparently left by a prior round's ad hoc reproduction -- untracked, so they cannot be accidentally committed by a plain git commit of tracked changes, but worth a git clean pass before this scope archives. Reused rather than duplicated for finding 3's probe; my own additional scratch file was removed after use.
- docs/qa/secret-scan-allowlist.json's Issue #89 entry reason text says "23 of approximately 93 chars" -- independently re-verified as exactly correct (see finding 4 above), not a stale or wrong number.

## Verdict

**APPROVE-WITH-CONDITIONS.**

Round 2's one open MED (Issue #130, internal-hostname false-negative) is genuinely closed -- independently re-verified, not taken on trust. Issue #132's message-split change introduces no credential-leak regression -- the secret structurally cannot appear in the ls-remote failure path this round's diff added, confirmed by direct reproduction. Issue #89's newly-surfaced old exemplar is handled correctly: allowlist-and-flag-for-human-decision is the proportionate response given zero secret-entropy is actually exposed, and escalating further would not improve security. This round's one new finding -- the github-fine-grained-pat pattern's false-positive risk on ordinary PAT-discussion prose -- is real, demonstrated, and self-evidencing (this very report needs its own allowlist entry), but is a precision and friction cost on a disclosed-heuristic scanner, not a security hole, and does not block restoring CI (dead 8+ days). It tracks as a fast-follow with a named test and a filed Issue (#135).

**Condition:** land the tightened github-fine-grained-pat regex (verified above: require both PAT segments to be plain alphanumeric, no embedded underscore, rather than the looser word-character class currently used) plus the named regression test, before or shortly after this scope archives -- same convention as round 2's condition on Issue #130, now itself proven out. Separately: this report will need its own docs/qa/secret-scan-allowlist.json entry (for finding 3's quoted false-positive phrases) before it can be committed clean, mirroring the existing self-referential convention already used for six other reports this round.

## Next action

story-implementer (or a fast-follow) lands the tightened github-fine-grained-pat regex plus its named regression test (Issue #135), and adds an allowlist entry for this report's own quoted false-positive phrases. Everything else in my lane is clear to ship.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][demonstrated] Issue #132's ls-remote message-split fix introduces no credential-leak regression: git's own auth-failure message names the original uncredentialed URL only (reproduced directly, fake-token repro, 0 occurrences of the token in output), so the new captured-and-echoed ls-remote output structurally cannot surface the secret; GitHub's own log masking remains the backstop for any other failure shape, unchanged from round 2.
2. [CLEAN][code-traced][demonstrated] Round-2's own MED finding (Issue #130, internal-hostname false-negative on multi-label FQDNs) is genuinely fixed: narrowed lookahead plus named regression test, independently re-verified via a 25-case differential (host01.corp.contoso.com etc. now match; #113's FP class still excluded). Recommend closing Issue #130. One minor non-blocking residual noted (a hyphen-word continuation shape still false-negatives; 0 occurrences today).
3. [ISSUE][MED][demonstrated] src/secret-scan/patterns.ts's new github-fine-grained-pat regex (Issue #129) false-positives on ordinary snake_case PAT-discussion prose (4 of 7 constructed cases, e.g. load_github_pat_for_submodule_checkout) with zero secret material present -- self-demonstrating, since this very report's quoted evidence will itself need an allowlist entry. Minimal fix verified: require both PAT segments to be plain alphanumeric with no embedded underscore (rejects all 4 false positives, matches both existing true-positive fixtures). Filed as GitHub Issue #135 (new -- not previously flagged by any prior reviewer).
4. [CLEAN][code-traced][demonstrated] Issue #89's newly-surfaced old exemplar (truncated github_pat_-shaped string in a 2026-09-06 S5 report) independently assessed: allowlist-and-flag-for-human-rotation-call is the correct, proportionate response, not under-response. The disclosed 23-char suffix is EXACTLY the non-secret 22-char identifier segment plus separator, ZERO chars of the 59-char secret segment; a full-history search confirms no fuller version was ever committed. Not escalated further; no new Issue needed for this finding specifically.
5. [CLEAN][code-traced] Least-privilege/credential-scope conclusions from rounds 1-2 still hold: contents:read permission unchanged; ADR_REPO_PAT still single-repo/Contents:Read-only/90-day-expiry; default GITHUB_TOKEN never widened; credential isolated to one step.
6. [CLEAN][demonstrated] Full suite re-run fresh: 662/662 pass, 0 fail, 0 skipped (up from round 2's 660 -- the two new Issue #129/#130 regression tests). OSS-01 dogfood independently re-confirmed clean via a fresh ad hoc scan (ok=true, blocking=0).
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=5 code-traced=1 derived=0 (per-finding gating tag: 1=demonstrated, 2=demonstrated (dual-tagged code-traced+demonstrated, counted once under its gating tag), 3=demonstrated, 4=demonstrated (dual-tagged code-traced+demonstrated, counted once under its gating tag), 5=code-traced, 6=demonstrated -- totals 5+1=6, matching issues=1+clean=5)
checks="662/0/0|plus ad-hoc reproduction scripts run directly and pasted above (ls-remote credential-failure repro, internal-hostname 25-case differential, github-fine-grained-pat 7-case FP probe plus tightened-regex verification, full-history sweep for Issue #89's exemplar, fresh OSS-01 dogfood re-scan against HEAD~1) -- not part of the named test suite but raw output quoted in this report"
adr=HIT(35)
report=docs/reviews/cifix-infra-security-round3-2026-09-09.md
