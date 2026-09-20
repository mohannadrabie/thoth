---
id: THOTH-ADR-0002
title: Value-scoped entries for the OSS-01 secret-scan allowlist (docs/qa/secret-scan-allowlist.json)
status: proposed
date: 2026-09-19
applicableTo:
  - security
  - architecture
  - code
constraints:
  security:
    - "Every entry in docs/qa/secret-scan-allowlist.json MUST carry a valueSha256 list; an entry exempts a match only when its path, its patternId and the sha256 of the matched bytes all equal the entry's. An entry without a valid valueSha256 list MUST be rejected (its matches block); there is no legacy path-plus-pattern shape."
    - "The value hash MUST be computed at match time in the scanner over the matched bytes; raw matched text MUST NOT be written to the allowlist, the scan report or any log beyond the existing redaction."
    - "A usable credential (a value that authenticates) MUST NOT be allowlisted; it is rotated and removed. An entry is a reviewed statement that one named value is not a secret (a synthetic fixture, a reserved-domain address, a documented example). One truncated identifier-segment exception is named in this ADR (Named exception, below) and is the human's decision at the pull request."
    - "Adding a value to an entry MUST arrive in a pull request whose diff shows it, with a non-empty reason; no other exemption shape (glob, line range, expiry, in-file marker, second file) MAY be added for this gate."
    - "A migrated entry MUST NOT be widened: the migrated set is a subset of what the file allowlisted before. The generator's verify mode enforces it structurally (every migrated entry sits on a legacy pair with its reason verbatim, every listed hash is carried by a real match, an already value-scoped entry is unchanged) and counts the newly allowlisted occurrences over the scanner's own matches, which MUST be zero."
    - "The allowlist loader MUST fail closed: an unreadable, unparseable or non-array allowlist file yields no entries, so every match blocks."
    - "A pull request that regenerates the allowlist after a moved base (generate --base) MUST state the count delta of verify's totals against the current ones (108 hashes, 17 credential-shaped), so a reviewer sees any value the regeneration added."
  code:
    - "The docs/reviews/ path MUST NOT be excluded from the REVIEWED_BASELINE guard in src/secret-scan/history-scan.test.ts; every credential-shaped grant is pinned to a reviewed baseline at grant time."
    - "A change to a pattern's match boundary in src/secret-scan/patterns.ts MUST be accompanied, in the same pull request, by re-derived valueSha256 lists for every entry of that pattern, each hash checked against the same reviewed literal under the old boundary."
---

# THOTH-ADR-0002: Value-scoped entries for the OSS-01 secret-scan allowlist

- **Status:** Proposed (2026-09-19) by `story-implementer` (Ptah). Agents MUST NOT self-accept (SE ADR-0001); the human accepts or declines at the pull request. The ADR catalog (`docs/adr-cache.mjs`) serves a `proposed` ADR's rules exactly like an accepted one's (Issue #220), so readers check this field.
- **Date:** 2026-09-19
- **Deciders:** the Manager (Osiris) ruled the design under the human's delegation (`docs/decisions.md`, the two newest 2026-09-19 rows, pending human ratification); `story-implementer` drafted this record.
- **Tier:** project (this repository only). Lives under `docs/adr/`, listed in `maat.json` `adr.dir`.
- **Relationship to org ADRs:** takes a position on devops ADR-0008 and on SE ADR-0001 below. Edits neither.

# Context

- `docs/qa/secret-scan-allowlist.json` exempts a match when the match's `path` and `patternId` equal an entry's. The join carries no value, line, commit or expiry (`partitionAllowlisted`, `src/secret-scan/history-scan.ts`).
- Consequence, demonstrated with a positive control (Issue #136, red-team, cifix round 3): an identical synthetic credential passes the gate in a file that has an entry and fails in a file that has none. The entry blinds the gate to that pattern in that file for every future edit.
- The same class recurred in Issue #193, Issues #199 and #200, and Issues #201, #202 and #203, each time patched by a narrower guard on one file rather than by binding the exemption to content (`docs/qa/recurring-findings-registry.md`). The test-level `REVIEWED_BASELINE` guard (sha256 of each reviewed literal) is the idiom this ADR moves into the production gate.
- Measured on 2026-09-19 (`docs/spikes/s1-136-value-triples-2026-09-19.mjs`): the allowlist has 50 entries; the scanner's own scope (history reachable from HEAD, blobs deduped, plus the simulated pre-commit tree) has 108 distinct (path, patternId, value-sha256) triples; every entry matches something; nothing outside the entries matches today.

# Decision

- An allowlist entry is `{ path, patternId, valueSha256: [<64 lowercase hex>, ...], reason }`.
- `valueSha256` values are sha256 over the matched bytes (the regex match text, `m[0]`), computed in the scanner when the match is found. The match object carries the hash; the raw text is never stored.
- A match is allowlisted only when an entry has the same `path` and `patternId` and lists the match's hash. Otherwise it blocks. An allowlisted match is still reported, as today.
- One mechanism for every pattern id in the allowlist (all six present today), not a credential-only subset. No legacy shape: an entry without a valid `valueSha256` list is rejected by the loader and its matches block.
- The 50 existing entries migrate in one commit through a tested generator whose output a reviewer approves. The generator's verify mode checks the migrated set is a subset of what the file allowlists today (ratchet only): structurally, plus a count of newly allowlisted occurrences over the scanner's own matches that must be zero. That count is reachable but never the only failure (a widening always also trips a structural check; the test `sb2-verify-widening-is-always-also-caught-structurally` enumerates it), so it is a second, direct measurement, not the sole proof. An independent instrument (red-team, post-build report) reached the same zero.
- The `REVIEWED_BASELINE` guard tests stay. Issue #203 strengthens them: the `docs/reviews/` exclusion is removed and those grants are pinned like every other file.
- A blocked match's output names its unlock: the rule, a per-pair command that prints the hashes of a blob's matches beside their redacted form (`src/secret-scan/allowlist-tool.ts hash`), and the fact that the hashed value is the regex MATCH text (for `generic-password-assignment` and `aws-secret-access-key` that includes the key name, operator and quotes, not only the secret). The hash of a BLOCKED match is never printed by the gate. The command is printed only for a path of `[A-Za-z0-9._/-]`; the path comes from the tree of a pull request, so it is contributor-chosen, and any other path gets a line that is not a command, with the path percent-encoded (Issue 239). The how-to line for such a path names no path and no command: the value hash is the sha256 of the matched text (the whole regex match, no trailing newline), computed with a local sha256 tool over the literal in the developer's own file, and the allowlist entry's path field is the percent-decoded form of the printed path; or the path is renamed to a shell-safe one or reviewed by a maintainer. An earlier version told the developer to quote the path by hand; it was removed because every quoting strategy executed a payload for some hostile name in some shell (Issue 241, red-team).
- A rejected entry is named in the blocking output (index, path, pattern id, reason class; never a value or a hash; the path and pattern id are contributor-authored, so they are percent-encoded and clipped to 120 code points, Issue 243), and an unreadable, unparseable or non-array file is named as a file-level rejection.
- The history-scan report file (a generated, gitignored artifact that CI uploads) carries `valueSha256` only for allowlisted matches, never for blocking ones: an unsalted hash of a possibly-real secret can be guessed.
- The generator's verify and report output is counts only (blessed values per pattern id, under the dated-reports directory, credential-shaped), so a reviewer approving opaque hashes still has value-level evidence without a raw value.

# Rules for agents

- **MUST** give every allowlist entry a `valueSha256` list of lowercase 64-hex sha256 strings; **MUST** treat an entry missing it, or carrying an empty or malformed list, as rejected, so that its matches block.
- **MUST** compute the value hash in the scanner at match time over the matched bytes, and **MUST NOT** persist or print raw matched text (the redaction in `redact()` stays the only echo).
- **MUST NOT** allowlist a usable credential (a value that authenticates). Rotate it and remove it from the tree (devops ADR-0008: no `--no-verify` to force a flagged secret through). The one truncated identifier-segment exception is named below; adding another needs an amendment to this ADR, not a new hash.
- **MUST** add a value to an entry only through a pull request whose diff shows the hash and a non-empty `reason`. **MUST NOT** introduce any other exemption shape for this gate (glob, line range, expiry, in-file marker, a second allowlist file).
- **MUST NOT** widen a migrated entry: the migrated set is a subset of what the file allowlisted before. The generator's verify mode enforces it structurally (every migrated entry sits on a legacy pair with its reason verbatim, every listed hash is carried by a real match, an already value-scoped entry is unchanged) and counts the newly allowlisted occurrences over the scanner's own matches, which **MUST** be zero.
- **MUST** pin every credential-shaped grant in `REVIEWED_BASELINE`, including grants under `docs/reviews/`; **MUST NOT** re-add a path-prefix exclusion.
- **MUST**, when a regex edit changes a pattern's match boundary, re-derive the affected entries' hashes in the same pull request and check each against the same reviewed literal; the stale hashes otherwise block, loudly.
- **MUST** keep the loader failing closed: an unreadable, unparseable or non-array allowlist file yields no entries, so every match blocks.
- **MUST**, in a pull request that regenerates the allowlist after a moved base (`generate --base`), state the count delta of `verify`'s totals against the current ones (108 hashes, 17 credential-shaped), so a reviewer sees any value the regeneration added.

# Position on devops ADR-0008

| ADR-0008 text | Position |
|---|---|
| "MUST NOT ... broaden suppression/ignore lists (ratchet only)" | **Satisfied.** Each migrated entry is strictly narrower than the entry it replaces; the subset holds structurally, and verify reports zero newly allowlisted occurrences over the scanner's own scope; an independent instrument agreed. A later addition names one reviewed literal in a pull request diff, the same approval act the file required before. |
| Exception process: a suppression is "time-bound (expiry date or 'revisit when ...')" | **Deviation, stated.** Value scoping is used instead of an expiry. An expiry narrows time, not content; a value hash narrows content, so an unrelated new literal in the same file is never exempt regardless of date. The human removed the sibling expiry timer in PR #225 (THOTH-ADR-0001). The human accepts or declines this deviation when accepting this ADR. |
| Gitleaks and Cosign "have no suppression path" | **Not the same subject.** This repository runs its own OSS-01 scanner, not Gitleaks. An entry does not waive a real match: it records that one named value is not a secret. Whether OSS-01 as a whole satisfies the Gitleaks row is an existing state this ADR does not decide. |

If the human holds that a project-tier ADR cannot waive an org-tier clause, the route is an amendment pull request to the org ADR repository (THOTH-ADR-0001 records the same alternative).

# Position on SE ADR-0001

The allowlist entry shape is a security-control data model, so it is architecturally significant. This ADR is the proposal SE ADR-0001 requires (status Proposed, flagged for the human). The precedent for a standing change to an exemption mechanism in this repository is THOTH-ADR-0001.

# Migration and rollback

- **Generator:** reads the legacy file, takes the scanner's own matches over history at the story's base commit, and writes each legacy entry with the sorted distinct hashes of its `(path, patternId)` matches. A legacy entry that matches nothing is dropped and counted. Idempotent: run on its own output it changes nothing.
- **Order:** the loader change and the migrated file land in one commit. The strict loader on the legacy file blocks every match, so no intermediate state is shippable.
- **Rollback: revert the whole story as one unit.** After merge, revert the merge commit (`git revert -m 1 <merge>`) or the squash commit. On an unmerged branch, revert every commit after `7b62344` (the parent of `fefce23`) with `git revert --no-commit 7b62344..<branch tip>`. The range has no caret because cmd treats a caret as an escape character: probed in bash, cmd and PowerShell 5.1, the caret form counted one commit too short in cmd only. Drilled in a scratch clone at the code tip: the result is byte-identical to `7b62344` and the secret-scan test files pass (61 of 61). The five story commits alone (`7b62344..62b95b2`) no longer revert cleanly once the fix-round commits edit the same files. Reverting only the migration commit (`f77cd56`) restores loader and file together, so the gate itself is safe, but it leaves the suite red: the red-first tests committed before it and the generator's own test still expect the new behavior (cross-domain drill at commit 46e8d88 over the three secret-scan test files: 19 of 61 fail; at a later commit that revert also conflicts in two files, because the fix round edited them, so do not attempt it).
- **Facts that stay true (drilled):** an old loader reads the new file (the extra field is ignored), so a code-only revert leaves a valid file. With the new loader in place and a damaged file, re-run the generator on the legacy file at the base commit (`git show <base>:docs/qa/secret-scan-allowlist.json`); its output is deterministic, and the repaired file commits without `--no-verify`.
- **Blast radius of a bad migration:** fail closed for every commit (the pre-commit hook reads the allowlist and the code from disk) and every CI run of the OSS-01 step. Nothing fails open.

# Named exception (human decision at the pull request)

- One migrated value is not a synthetic literal. The entry for the fine-grained-token pattern on the dated design-challenger report of the S5 hook-wiring story records, in its own reason, a truncated prefix (a 22-character identifier segment and its separator, secret segment absent) of what that report describes as a real credential, quoted as demonstrated evidence. Issue 89 (human-only, still open) tracks the rotation call.
- The migration would bless that value by hash and make the exemption permanent. It is not "a value that authenticates" on its own (its entry says the truncated prefix cannot be reconstructed into a working credential), which is why the rule above says usable credential; but it contradicts the plainer "not a real credential" reading, so it is named here rather than hidden in 108 hashes.
- Decision for the human: **accept** this one named exception, or **rotate and remove** per issue 89, after which the entry, its hash and its baseline pin are deleted in a pull request. The value is also pinned in `REVIEWED_BASELINE` with a reason that says the same. The generator did not drop the entry silently.

# Residual risk (disclosed)

| Residual | Effect |
|---|---|
| No oracle: an author who adds a literal and its hash and its `REVIEWED_BASELINE` pin in one pull request passes every automated check | The pull request diff and the `reason` are the review, as in THOTH-ADR-0001. Value scoping closes the unattended path (a new literal in an already-granted file), not the deliberate one. The gate blocks a legacy-shaped (whole-file) report grant; a report grant that carries the literal's own correct hash passes the gate. The baseline guard catches an OMITTED pin, not a deliberate self-hashed grant (test `oss01-attack-e-report-grant-without-a-baseline-pin-is-caught-by-the-baseline-guard`). Report immutability is not enforced mechanically (Issue #233). |
| The hash binds the regex match, not the whole token | The internal-hostname and private-IPv4 patterns match a prefix of a longer real name, so a granted value can vouch for a prefix of a longer one. `aws-access-key-id` is unanchored on both sides too (four letters, then sixteen upper-case alphanumerics, no boundary), so a granted 20-character fixture hash also vouches for any longer token that embeds it: 12 of 108 blessed values use that pattern (`allowlist-tool verify`, "blessed values by pattern"). Real AWS ids are exactly 20 characters, so there is no practical gain today. A reviewer sees the file diff either way. |
| A reviewer of a hash addition sees opaque hex | The reason and the diff are the review; the generator's counts-only classification is the value-level evidence, and the Manager asks red-team to classify the blessed values independently after the build. |
| The one named exception above (issue 89) | Human decision at the pull request: accept it as named, or rotate and remove. |
| A moved base: an allowlist or fixture change lands on the default branch before this merges | The new legacy file or the new literal is not in the migrated file, so CI goes red loudly. Re-run the generator on the new legacy file (`generate --base <ref>`) and re-verify. Fails closed, never open. The recovery step itself re-blesses: `generate --base` blesses EVERY value the history at that ref holds at a granted pair, including one that slipped into a granted file under the old whole-file rule, and `verify` cannot object because its baseline is that same old rule. The last bullet of Rules for agents requires the regeneration pull request to state the count delta against the current totals (108 hashes, 17 credential-shaped, from `verify`), so a reviewer sees any value added by the regeneration. |
| A NUL byte in the first 8000 bytes makes the scanner skip a text file, an allowlist entry or not | Pre-existing and orthogonal (issue 237); not changed here. A test asserts that no file in the index (the tree about to be committed) is skipped as binary. It does not cover older commits, and the gate walks history: one blob of this story's own history is still skipped, an earlier version of the spike file committed with NUL separators and repaired in a later commit (one blob, by instrument). Its content was measured clean (0 scanner matches with the skip lifted), and history is not rewritten. |
| Entries are coupled to a pattern's exact match boundary | A regex edit that moves the boundary blocks the entry's matches until the hashes are re-derived (rule above); fail-loud, the safe direction. |
| An entry that matches nothing is invisible | Tracked in Issue #235; out of scope here. |
| A mistakenly allowlisted low-entropy secret publishes a crackable hash | A value entry puts an unsalted sha256 of the match into a public, tracked file. For `generic-password-assignment` and `aws-secret-access-key` the hashed text includes the key name, operator and quotes plus the secret, so a short password is dictionary-guessable from it. The old shape leaked nothing on a wrong grant. The control is human review of the diff (the MUST NOT above). Present exposure is nil: 0 of 108 blessed values use either pattern (instrument). |
| A path outside `[A-Za-z0-9._/-]` gets no runnable unlock command | The gate prints a line that is not a command, with the path percent-encoded, and a how-to line that names no path: the value hash is the sha256 of the matched text (the regex match, as this ADR defines it: the whole match, no trailing newline), computed with a local sha256 tool over the literal in the developer's own file; the allowlist entry's path field is the percent-decoded form of the printed path, which measured as the exact loader key for every hostile and plain name tried where the raw name worked only for some; or the path is renamed to a shell-safe one or reviewed by a maintainer. Hand-quoting a contributor-chosen path was removed as advice because every quoting strategy executed a payload for some hostile name in some shell. Today exactly one tracked path is affected, `Claude outputs/maat-review-2026-09-09.md` (a plain space in the name): 1 of 374 tracked paths at this writing (`git ls-files` filtered by the safe-set regex). The percent-encoded form covers the unlock lines and the rejected-entry lines. Three other line classes still print contributor-chosen text raw: the blocking-match line and the ALLOWLISTED line (the path as git spells it, pre-existing, Issue #241) and the problem lines of `allowlist-tool verify` (entry paths from the allowlist file; a developer-run tool, not part of CI). Issue #241 tracks a shell-safe hash channel as an enhancement. |
| The gate and the allowlist both come from the pull request's own checkout | A pull request can change the scanner and the file together. Pre-existing, not changed here. The protection is the Manager's CRITICAL-tier call for the scanner files (CLAUDE.md's sensitive-area glob for them matches no tracked file until Issue #234 lands, so no mechanical trigger exists yet) and the reviewed-baseline guard. |
| Duplicate entries for one path and pattern id | The loader unions their hash lists (the narrower direction: a duplicate cannot bless a value it does not list, and the pull request diff shows both entries), while the generator refuses duplicates and verify reports them. Kept as is: adding a hash by a second entry is the same reviewed act as adding it to the first. 0 duplicate pairs in the real file (50 entries, 50 distinct pairs, by instrument). |
| The rejected-entry diagnostic is best-effort | `rejected` rides on the loaded array, so any copy or filter of it drops the diagnostic, never the gating: a rejected entry is never in the array, so its matches block regardless. The diagnostic is also shown only on a blocking run, not on a passing one (an allowlist with a malformed entry whose pair no longer matches is invisible in the log). Both live callers pass the loaded object straight through. |
| The scanner dedupes blobs by sha, so a byte-identical copy of a file at a second path is not evaluated under that path | Pre-existing; values in it were already evaluated at the first path. Not changed by this ADR. |

# Consequences

## Positive
- A novel secret in a file that has an entry blocks, at the gate and at the pre-commit hook. This is the Issue #136 demonstration, inverted.
- The exemption is content-addressed: reviewers see exactly which values each entry covers.
- The hash idiom already proven in `REVIEWED_BASELINE` is now the production mechanism.

## Negative
- The file grows from one line of scope per pair to one hash per value (108 hashes across 50 entries today); the hashes are opaque, so review relies on the generator's verify output and the report.
- Adding a fixture literal now needs its sha256 computed; the block message names the command.
- Editing a fixture literal that is allowlisted invalidates its hash.

# Alternatives considered

1. **Line range or commit scope.** Rejected: the scan walks full history and dedupes by blob, so line numbers are per blob version.
2. **Expiry per entry.** Rejected: narrows time, not content; the human removed the sibling timer in PR #225.
3. **Fixture rewrite only (build literals at runtime, delete the entry).** Rejected as the sole fix: it leaves every other entry whole-file. Kept as the hygiene rule for new fixtures.
4. **Credential-shaped patterns only.** Rejected: leaves a second, legacy shape, and leaves the internal-hostname entry the human named unnarrowed.
5. **One entry per triple.** Not chosen: repeats each `reason` across its values; a list per pair keeps one reason per reviewed pair.

# Compliance verification

- Automated: the named tests in `src/secret-scan/history-scan.test.ts` and `src/secret-scan/pre-commit-scan.test.ts` (novel secret in a granted file blocks at `summarizeMatches` and at the pre-commit CLI; malformed scope rejected; partial migration honors no legacy entry; regex edit blocks loudly; the three human-named pairs are value-scoped; `docs/reviews/` grants pinned). The generator's own tests (subset, idempotence, an already value-scoped entry is never widened, a dropped entry or hash that still matches fails verify, no value or hash printed). The unlock command printed by a blocked run is executed verbatim in the platform shell and its output is accepted by the gate, for every pattern id and for a plain path; a path with any character outside `[A-Za-z0-9._/-]` never appears in a printed command (it gets a line that is not a command, with the path percent-encoded), tested with hostile names in the real CLI output and pasted into the platform shell; the report file omits the hash of blocking matches; a rejected entry is named in the blocking output; no tracked text file is skipped as binary.
- Manual: reviewers run the generator's verify mode against the legacy file at the base commit and read its counts; reviewers read every `valueSha256` addition and its `reason` in a pull request diff.
- Evidence location: `docs/qa/secret-scan-allowlist.json`; `docs/plans/s1-136-value-scoped-allowlist-phase1-2026-09-19.md`; Issues #136, #203.

# References

- Issues #136, #203, #193, #199, #200, #201, #202, #233, #234, #235, #241; PR #225
- `docs/reviews/cifix-red-team-round3-2026-09-09.md` (finding 1); `docs/reviews/path-b-precommit-secret-scan-red-team-round5-2026-09-14.md` (F3); `docs/reviews/s1-135-pat-regression-test-cross-domain-2026-09-19.md` (sections 4 and 5)
- `docs/decisions.md`: the two newest 2026-09-19 rows (design ruling and its amendment)
- `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md` (precedent for the format and for the ADR path)
- `adr/devops/0008-cicd-gates-and-policy-as-code.md`; `adr/software-engineering/0001-record-architecture-decisions.md`
