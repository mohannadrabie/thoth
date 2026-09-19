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
    - "A real credential MUST NOT be allowlisted; it is rotated and removed. An entry is a reviewed statement that one named value is not a secret (a synthetic fixture, a reserved-domain address, a documented example)."
    - "Adding a value to an entry MUST arrive in a pull request whose diff shows it, with a non-empty reason; no other exemption shape (glob, line range, expiry, in-file marker, second file) MAY be added for this gate."
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
- The 50 existing entries migrate in one commit through a tested generator whose output a reviewer approves. A script proves the migrated set is a subset of what the file allowlists today (ratchet only).
- The `REVIEWED_BASELINE` guard tests stay. Issue #203 strengthens them: the `docs/reviews/` exclusion is removed and those grants are pinned like every other file.

# Rules for agents

- **MUST** give every allowlist entry a `valueSha256` list of lowercase 64-hex sha256 strings; **MUST** treat an entry missing it, or carrying an empty or malformed list, as rejected, so that its matches block.
- **MUST** compute the value hash in the scanner at match time over the matched bytes, and **MUST NOT** persist or print raw matched text (the redaction in `redact()` stays the only echo).
- **MUST NOT** allowlist a real credential. Rotate it and remove it from the tree (devops ADR-0008: no `--no-verify` to force a flagged secret through).
- **MUST** add a value to an entry only through a pull request whose diff shows the hash and a non-empty `reason`. **MUST NOT** introduce any other exemption shape for this gate (glob, line range, expiry, in-file marker, a second allowlist file).
- **MUST NOT** widen a migrated entry: the migrated set is a subset of what the file allowlisted before, shown by the generator's verify mode, not by prose.
- **MUST** pin every credential-shaped grant in `REVIEWED_BASELINE`, including grants under `docs/reviews/`; **MUST NOT** re-add a path-prefix exclusion.
- **MUST**, when a regex edit changes a pattern's match boundary, re-derive the affected entries' hashes in the same pull request and check each against the same reviewed literal; the stale hashes otherwise block, loudly.
- **MUST** keep the loader failing closed: an unreadable or non-array allowlist file yields no entries, so every match blocks.

# Position on devops ADR-0008

| ADR-0008 text | Position |
|---|---|
| "MUST NOT ... broaden suppression/ignore lists (ratchet only)" | **Satisfied.** Each migrated entry is strictly narrower than the entry it replaces; the subset is proven by script over the scanner's own scope. A later addition names one reviewed literal in a pull request diff, the same approval act the file required before. |
| Exception process: a suppression is "time-bound (expiry date or 'revisit when ...')" | **Deviation, stated.** Value scoping is used instead of an expiry. An expiry narrows time, not content; a value hash narrows content, so an unrelated new literal in the same file is never exempt regardless of date. The human removed the sibling expiry timer in PR #225 (THOTH-ADR-0001). The human accepts or declines this deviation when accepting this ADR. |
| Gitleaks and Cosign "have no suppression path" | **Not the same subject.** This repository runs its own OSS-01 scanner, not Gitleaks. An entry does not waive a real match: it records that one named value is not a secret. Whether OSS-01 as a whole satisfies the Gitleaks row is an existing state this ADR does not decide. |

If the human holds that a project-tier ADR cannot waive an org-tier clause, the route is an amendment pull request to the org ADR repository (THOTH-ADR-0001 records the same alternative).

# Position on SE ADR-0001

The allowlist entry shape is a security-control data model, so it is architecturally significant. This ADR is the proposal SE ADR-0001 requires (status Proposed, flagged for the human). The precedent for a standing change to an exemption mechanism in this repository is THOTH-ADR-0001.

# Migration and rollback

- **Generator:** reads the legacy file, takes the scanner's own matches over history at the story's base commit, and writes each legacy entry with the sorted distinct hashes of its `(path, patternId)` matches. A legacy entry that matches nothing is dropped and counted. Idempotent: run on its own output it changes nothing.
- **Order:** the loader change and the migrated file land in one commit. The strict loader on the legacy file blocks every match, so no intermediate state is shippable.
- **Rollback:** `git revert` of that commit restores loader and file together. With the new loader in place and a damaged file, re-run the generator on the legacy file at the base commit (`git show <base>:docs/qa/secret-scan-allowlist.json`); its output is deterministic.
- **Blast radius of a bad migration:** fail closed for every commit (the pre-commit hook reads the allowlist and the code from disk) and every CI run of the OSS-01 step. Nothing fails open.

# Residual risk (disclosed)

| Residual | Effect |
|---|---|
| No oracle: an author who adds a literal and its hash and its `REVIEWED_BASELINE` pin in one pull request passes every automated check | The pull request diff and the `reason` are the review, as in THOTH-ADR-0001. Value scoping closes the unattended path (a new literal in an already-granted file), not the deliberate one. Report immutability is not enforced mechanically (Issue #233). |
| Entries are coupled to a pattern's exact match boundary | A regex edit that moves the boundary blocks the entry's matches until the hashes are re-derived (rule above); fail-loud, the safe direction. |
| An entry that matches nothing is invisible | Tracked in Issue #235; out of scope here. |
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

- Automated: the named tests in `src/secret-scan/history-scan.test.ts` and `src/secret-scan/pre-commit-scan.test.ts` (novel secret in a granted file blocks at `summarizeMatches` and at the pre-commit CLI; malformed scope rejected; partial migration honors no legacy entry; regex edit blocks loudly; the three human-named pairs are value-scoped; `docs/reviews/` grants pinned). The generator's own tests (subset, idempotence, no value printed).
- Manual: reviewers run the generator's verify mode against the legacy file at the base commit and read its counts; reviewers read every `valueSha256` addition and its `reason` in a pull request diff.
- Evidence location: `docs/qa/secret-scan-allowlist.json`; `docs/plans/s1-136-value-scoped-allowlist-phase1-2026-09-19.md`; Issues #136, #203.

# References

- Issues #136, #203, #193, #199, #200, #201, #202, #233, #235; PR #225
- `docs/reviews/cifix-red-team-round3-2026-09-09.md` (finding 1); `docs/reviews/path-b-precommit-secret-scan-red-team-round5-2026-09-14.md` (F3); `docs/reviews/s1-135-pat-regression-test-cross-domain-2026-09-19.md` (sections 4 and 5)
- `docs/decisions.md`: the two newest 2026-09-19 rows (design ruling and its amendment)
- `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md` (precedent for the format and for the ADR path)
- `adr/devops/0008-cicd-gates-and-policy-as-code.md`; `adr/software-engineering/0001-record-architecture-decisions.md`
