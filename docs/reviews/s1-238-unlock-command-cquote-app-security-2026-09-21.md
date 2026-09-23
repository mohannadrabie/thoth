# App Security Review — s1-238-unlock-command-cquote (Issue #238)

**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-21
**Scope:** branch `fix/s1-238-unlock-command-cquote`, commit `90e9585`, diff against `origin/master`
**Tier:** STANDARD (ratified by Manager — print-formatting/CLI-input-matching fix, not detection logic; reviewed as-tiered, not re-litigated)

## ADR compliance

`node docs/adr-cache.mjs --ensure` returned CACHE HIT: reused 37 ADR(s) from catalog. Read the shared catalog (docs/.maat-state.json -> adrCatalog.adrs) for ADRs tagged security/secrets/code applicable to this domain. Applicable: THOTH-ADR-0002 (value-scoped OSS-01 secret-scan allowlist). Not applicable: ADR-0009 (IAM/secrets in IaC, infra-only), ADR-0021 (broad thoth-native architecture, out of scope for this narrow fix).

THOTH-ADR-0002 compliance: "A match is allowlisted only when an entry has the same path and patternId and lists the match's hash" (docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md line 43). This matching happens in partitionAllowlisted/summarizeMatches in src/secret-scan/history-scan.ts, keyed off HistoryMatch.path, which is set verbatim from lsTree()'s raw (possibly C-quoted) key at history-scan.ts:99 (matches.push({ commit, path, ...found }) where path comes from the lsTree() Map). This diff does not touch history-scan.ts at all (confirmed below), and decodeGitQuotedPath/resolveByDecodedPath are used only inside allowlist-tool.ts's runHash CLI helper, never in the allowlist-matching path. No ADR violation.

## Diff summary

CHANGELOG.md, src/lib/git.test.ts, src/lib/git.ts, src/secret-scan/allowlist-tool.test.ts, src/secret-scan/allowlist-tool.ts changed; 185 insertions, 3 deletions, 5 files total.

New: decodeGitQuotedPath() at src/lib/git.ts line 103, a conservative decoder for gits own C-quoting of ls-tree output. New: resolveByDecodedPath() at src/secret-scan/allowlist-tool.ts line 340, used as an additive fallback in runHash (allowlist-tool.ts line 357): tree.get(path) falling back to resolveByDecodedPath(tree, path) only on a miss.

## Verification of the six points raised

1. Zero-touch on history-scan.ts (the #239 shell-safety fix).
Command run: git diff origin/master 90e9585 --numstat -- src/secret-scan/history-scan.ts
Output: empty (no lines).
Demonstrated: zero lines changed. unlockDetails, NO_COMMAND_HOWTO, SHELL_SAFE, percentEncode are untouched.

2. "A C-quoted path can never pass SHELL_SAFE" claim.
SHELL_SAFE is defined as the regex matching one or more of A-Z a-z 0-9 . _ / - only (history-scan.ts line 180). Gits C-quoted output is always wrapped in a matching pair of double quotes (quote_c_style), so the raw string always begins with a double quote character, which is outside SHELL_SAFE's character class regardless of whether a backslash is present. I confirmed this empirically against a real git binary rather than trusting the implementer's prose: created a file named with the two-byte UTF-8 e-acute character, committed it, and ran git ls-tree -r HEAD directly. The output was wrapped in double quotes with octal-escaped bytes, exactly as claimed. m.path (the value tested by SHELL_SAFE in unlockDetails) is sourced directly from lsTree()'s raw key at history-scan.ts line 99, i.e. exactly this C-quoted spelling, never the decoded one. Claim holds; the fix cannot reopen #239's shell-injection vector because it never touches what unlockDetails prints or tests. Evidence tier: code-traced plus demonstrated.

3. resolveByDecodedPath ambiguity handling (collision-craftability).
Code at allowlist-tool.ts lines 340-347 iterates all tree entries, decodes each, and throws on a second match rather than silently picking one -- fail-closed. I checked whether an attacker-controlled tree (PR-supplied filenames, same threat model as #239) could engineer two distinct real files whose git-C-quoted encodings decode to the identical string. Git's quote_c_style is a deterministic, lossless (bijective) encoding -- it exists specifically so tooling can round-trip a path unambiguously -- and decodeGitQuotedPath's named-escape table matches git's real escape set exactly, confirmed against a real git round-trip test (git.test.ts lines 183-212, cafe-with-accent fixture). Two genuinely different byte-sequence filenames therefore cannot decode to the same string under a correct implementation; the only realistic way resolveByDecodedPath throws is a genuine ambiguity, which is the correct outcome (force the maintainer to pass the exact raw spelling). I exercised the throw branch directly with a crafted ambiguous map (two tree entries decoding to the same string) using a small standalone script and it threw exactly as designed, naming the path and directing the maintainer to the exact raw spelling. Blast radius even in a worst-case wrong resolution is bounded: this is a local, maintainer-run convenience command for computing a value hash to paste into an allowlist entry -- a wrong hash simply fails to match real content, and THOTH-ADR-0002's actual security control is the PR diff review of the added entry, not this tool's output. Evidence tier: demonstrated plus code-traced. No blocking finding; the ambiguity branch itself isn't covered by the shipped test suite (only by my own ad hoc harness), worth a follow-up unit test but not exploitable, so not filed as an Issue (LOW, hardening only).

4. decodeGitQuotedPath's decoder safety.
git.ts lines 103-131: a bounded loop over the quoted string that handles only (a) a fixed named-escape table (the standard C escapes a b f n r t v backslash and double-quote), (b) a strict 3-digit-octal regex, (c) returns the raw input completely unchanged the moment it meets anything else (an unrecognized escape, or a string not wrapped in matching quotes). Confirmed via unit tests (git.test.ts lines 159-181, all passing) including "never guesses" cases, plus a real-git round-trip test. It is used only for an in-memory string comparison (decodeGitQuotedPath(treePath) not equal to path, allowlist-tool.ts line 343) -- grepped the whole src/ tree and confirmed it has no other call site, is never passed to fs, exec, or a shell, and never touches the filesystem. No injection or path-traversal surface. Evidence tier: code-traced plus demonstrated.

5. Allowlist path-field matching semantics (THOTH-ADR-0002).
Confirmed unaffected -- see ADR-compliance section above. decodeGitQuotedPath/resolveByDecodedPath live entirely inside allowlist-tool.ts's runHash (a maintainer-facing helper subcommand); the actual allowlist-matching code path (partitionAllowlisted, summarizeMatches in history-scan.ts) is untouched (point 1) and still keys strictly on lsTree()'s raw spelling. Evidence tier: code-traced.

6. Standard checklist: injection, eval, secrets, supply chain.
No eval, child_process, exec, or spawn introduced (grepped the diff). No dependency or lockfile changes (package.json/package-lock.json diff empty). No secrets, no hard-coded credentials in source or tests. N/A as expected, confirmed rather than assumed.

## Tests run

node --test src/lib/git.test.ts src/secret-scan/allowlist-tool.test.ts src/secret-scan/history-scan.test.ts
Result: tests 108, pass 108, fail 0, cancelled 0, skipped 0, todo 0.

npm run typecheck
Result: tsc --noEmit -p tsconfig.json completed cleanly, no output, exit 0.

The implementer's CHANGELOG claim of npm test 1049/0/0 and npm run oss:secret-scan 0 blocking / 2031 allowlisted was not independently re-run in full by me (that would re-run the whole suite well beyond the touched files). The touched-file subset (108/108) and typecheck above are what I ran directly and are the demonstrated evidence backing this report's findings.

## Findings

All CLEAN -- no BLOCKER, HIGH, or MED issues found. One non-blocking hardening note:

LOW hardening, not filed as an Issue per policy: resolveByDecodedPath's ambiguity-throw branch (allowlist-tool.ts line 344) has no test in the shipped suite exercising two tree entries that decode to the same string; I verified it manually with an ad hoc harness (see point 3) but the repo's own test suite doesn't pin this behavior. Suggested minimal addition: one unit test constructing a Map with two colliding decoded spellings and asserting the throw message. Not exploitable (analysis above), so LOW and non-blocking; LOW-severity issues don't spawn a GitHub Issue per this project's convention.

## Verdict: APPROVE

The fix is exactly what the story describes: an additive, fail-closed fallback confined to a single local CLI helper, with zero footprint on the #239 shell-safety gate, zero footprint on THOTH-ADR-0002's allowlist-matching semantics, a conservative decoder with no injection/traversal surface, and a sound (verified, not just claimed) fail-closed ambiguity guard. Tests for the touched files are green (108/108), typecheck is clean, no new dependencies.

## Next action

None required to ship. Optional: implementer/story-implementer may add the one ambiguity-branch unit test noted above in a future pass (non-blocking).

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][code-traced][demonstrated] src/secret-scan/history-scan.ts -- zero lines changed (git diff --numstat empty); #239 SHELL_SAFE/unlockDetails/NO_COMMAND_HOWTO/percentEncode untouched
2. [CLEAN][code-traced][demonstrated] history-scan.ts:180 SHELL_SAFE vs git's C-quote wrapping -- C-quoted output always starts with a double quote, excluded from SHELL_SAFE's charset; confirmed live against real git; claim holds, #239 vector not reopened
3. [CLEAN][code-traced][demonstrated] allowlist-tool.ts:340-347 resolveByDecodedPath -- fail-closed throw on ambiguous decode verified by direct execution; genuine cross-file collision requires breaking git's own bijective C-quoting, no realistic attack path found
4. [CLEAN][code-traced][demonstrated] src/lib/git.ts:103 decodeGitQuotedPath -- conservative decoder (named escapes plus strict 3-digit octal only, raw passthrough on anything else), single call site (allowlist-tool.ts:343), never reaches fs/shell, no injection/traversal surface
5. [CLEAN][code-traced] THOTH-ADR-0002 path-matching semantics unaffected -- decode fallback confined to runHash CLI helper, allowlist-matching path (partitionAllowlisted/summarizeMatches, history-scan.ts) untouched and still keyed on lsTree()'s raw spelling
6. [CLEAN][code-traced][demonstrated] no eval/exec/child_process introduced, no dependency/lockfile changes, no hard-coded secrets, typecheck clean
7. [ISSUE][LOW][demonstrated] allowlist-tool.ts:344 -- ambiguity-throw branch has no unit test in the shipped suite (verified manually by reviewer instead); non-exploitable hardening gap, no Issue filed per LOW policy
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=6
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=6 code-traced=7 derived=0
checks="108/0/0|typecheck clean"
adr=HIT(37)
report=docs/reviews/s1-238-unlock-command-cquote-app-security-2026-09-21.md
