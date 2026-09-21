# s1-136-value-scoped-allowlist: design-challenger, round 1 (pre-build), 2026-09-19

[design-challenger]
Design Challenger (Apep) -- attacking the value-scoped OSS-01 allowlist design (Story S-B2, Issues 136 and 203), round 1 of this artifact.

- Branch `fix/s1-136-value-scoped-allowlist` at 431c216. Tier CRITICAL (Manager-ratified, not re-litigated).
- Artifacts attacked: `docs/plans/s1-136-value-scoped-allowlist-phase1-2026-09-19.md` (shape note, tests, skeleton, rollback), `docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md` (Proposed), the two newest 2026-09-19 rows of `docs/decisions.md`, Issues 136 and 203, and the real code: `src/secret-scan/history-scan.ts`, `src/secret-scan/pre-commit-scan.ts`, `src/secret-scan/simulated-commit.ts`, `src/secret-scan/patterns.ts`, `src/secret-scan/history-scan.test.ts`, `docs/qa/secret-scan-allowlist.json`, the spike, and the two earlier red-team reports.
- Method: a scratch clone outside the repository (`git clone`; tracked files in the working tree never edited; nothing pushed); the design's hash and partition were prototyped in the scratch clone only. Every attack literal was built at runtime inside the scratch scripts; none is written here. `docs/adr-cache.mjs --ensure`: HIT, 37 ADRs (devops 12, software-engineering 23, project 2).
- Prior state: `docs/.maat-state.json` shows `roundsSinceLastGo` 0, `humanRulingRequired` false, no earlier design-challenger report on this artifact. This is graded round 1.

## Verdict: go (no valid HIGH), with findings that become day-1 failing tests

No attack produced a fail-open path in the design as specified. The design's core claim (an entry exempts only path AND pattern AND value) survived every attack I could run against real code. The findings: one MED pre-existing scanner evasion that this design does not touch (filed as its own Issue, not gating), one MED skeleton-adequacy gap, and LOW items that each become a named test or a residual line.

## Attacks, ranked by blast radius (exposure x irreversibility x silence)

### A1. The scanner silently skips any text file that has a NUL byte in its first 8000 bytes (pre-existing, orthogonal to the design)

- **Scenario.** A contributor commits a file carrying a secret whose bytes include a NUL in the first 8000 (a UTF-16 file, which is what a Windows PowerShell 5 redirect produces, or a stray control byte). `looksBinary` returns true, `scanUnseenBlob` returns null, and the blob is never matched. No allowlist is involved; value scoping cannot help. Silent, and irreversible once pushed (rotation is the only undo).
- **Evidence (demonstrated).** Real `scanHistory` on throwaway repos, key literal built at runtime:
  ```
  A1 plain: 1  NUL@0: 0  NUL@7000: 0  NUL@9000: 1
  ```
  (a matching file yields 1 match; a NUL at byte 0 or 7000 yields 0; a NUL past the 8000-byte sample window yields 1). Code: `src/secret-scan/history-scan.ts:30` (`looksBinary`, sample 8000 bytes) and `src/secret-scan/history-scan.ts:67` (`if (looksBinary(content)) return null;`), reached on every commit through `src/secret-scan/pre-commit-scan.ts:54`. The accident is not hypothetical: this very story committed one such file (A6).
- **Reach:** user, entry point `src/secret-scan/pre-commit-scan.ts:54` (the pre-commit hook) and the CI OSS-01 full-history step in `.github/workflows/ci.yml`.
- **Exposure:** ~0% today (0 of 1 skipped tracked file holds a secret-shaped match); 1 of 362 tracked blobs is skipped (0.3%), basis: counted in code (`git ls-tree` plus the scanner's own `looksBinary`). Latent for every future text file with a NUL in its first 8000 bytes.
- **Current defense:** none in the scan. The design under attack does not change this code path.
- **Tags:** severity MED / evidence demonstrated / reach user / likelihood plausible / undo irreversible.
- **Severity note, stated openly.** On paper this meets the four HIGH preconditions. I grade MED because (1) it pre-exists and is outside the design's change surface (the design neither introduces nor worsens it, and cannot close it), (2) measured present exposure is zero, and (3) gating S-B2's build on it would block a fix that is unrelated to it. If the Manager reads "the gate can be blinded" as inside S-B2's scope, this flips to HIGH and the verdict to no-go; I do not read it that way.
- **Verdict: BREAKS (pre-existing, not gating S-B2).** Filed as its own bug Issue (see Persistence). Proof-test, its own story: `oss01-nul-byte-does-not-hide-a-secret` (unit at `scanHistory` on a temp repo): a file with a NUL at byte 0, and one with a NUL at byte 7000, each holding a runtime-built key literal, must yield at least one match or a fail-closed "unscannable file" result; today both yield zero.

### A3. The walking skeleton does not touch three of the layers the rest of the plan leans on

- **Scenario.** Skeleton (plan section 7) = hash at match time, partition by value, loader accepts one fixture entry, T2 and P1 red then green. It does not touch: (a) the generator and the real migrated file (the first time real data meets the strict loader is C2, one atomic commit), (b) the `history-scan.ts` CLI `main()` that CI actually runs, where the report file is written, (c) the REVIEWED_BASELINE and Issue 203 edits. Instrument: no `src/secret-scan/*.test.ts` file spawns `history-scan.ts` as a process (the only reference is the import at `src/secret-scan/history-scan.test.ts:9`); the tests call `scanHistory` and `summarizeMatches` directly, plus the dogfood run on the real repo (positive control only). The plan's proof for the real file (R136-9, `node src/secret-scan/history-scan.ts` exits 0) is a script check at the end, not a skeleton exit criterion.
- **Evidence (derived from plan section 7; the coverage gap is demonstrated by the grep above).**
- **Exposure:** 3 of 6 layers named in the plan's topology (loader, scanner hash, partition, history CLI, pre-commit CLI, generator) are outside the skeleton, basis: counted from plan sections 5 and 7.
- **Tags:** severity MED / evidence derived / reach instrument / likelihood plausible / undo reversible.
- **Verdict: UNPROVEN.** Proof-tests, added to the skeleton's exit criteria so the first green is on real data:
  - `sb2-skeleton-real-file-round-trip-scans-clean` (script or gate test): generator output for the base legacy file, written to a scratch path, then `node src/secret-scan/history-scan.ts` against the repo at the base commit with that file exits 0 with zero blocking, and its hash count equals the independent spike's count (108). Independent hashing, never the production function.
  - `sb2-history-scan-cli-exits-nonzero-on-novel-secret-in-granted-file` (CLI, temp repo): the CI entry point; granted literal plus a novel one in the same granted file; non-zero exit and the unlock line on stdout.

### A2. The retained generator and its verify mode: re-run semantics on already-scoped input are unspecified, and verify is one-directional

- **Scenario.** The plan keeps the generator in the tree (section 13, Question 4) and requires `sb2-generator-is-idempotent-and-deterministic` (second run on its own output is byte-identical) plus `sb2-generator-refuses-a-malformed-scoped-input`. Neither says what a run does with a valid already-scoped entry when history now holds an extra matching value at that pair. If it re-derives hashes from matches, a later run "to repair" the file re-creates whole-file semantics: every value currently present at a granted pair is blessed in one command, a second path to grant that the ADR forbids ("no other exemption shape"). Separately, verify checks after-subset-of-before, which is structural (every migrated entry sits on a legacy pair, so the subset holds by construction). Dropping a legacy entry, or a hash that still matches, passes verify; only the later gate run turns red (loud and fail-closed, a nuisance rather than a bypass).
- **Evidence (derived):** the plan text only (sections 6 and 8, tests G2, G4, G6). No generator code exists.
- **Current defense:** the plan's runbook re-runs the generator on the legacy file at the base commit, which is deterministic and safe. The unsafe use is any other base.
- **Exposure:** today 0 additional blessings (108 of 108 measured triples are already granted; non-granted triples 0), basis: measured by the reproduced spike (S6). Future exposure is bounded by the entry count (50, counted).
- **Tags:** severity LOW / evidence derived / reach operator / likelihood operator-error / undo runbook-reversible (git revert of the allowlist file).
- **Verdict: UNPROVEN.** Proof-tests (write RED before the build):
  - `sb2-generator-never-adds-a-hash-to-an-already-scoped-entry` (unit, generator test file): input entry scoped to hash set S, history holds one extra matching value at the same pair; the output hash set is a subset of S, or the generator refuses. Fails if it unions in the extra value.
  - `sb2-verify-rejects-a-dropped-entry-or-hash-that-still-matches` (extends the G4 mutation table): a migrated file missing a legacy entry that matches, and one missing a single hash whose value still matches, must each fail verify or make verify report newly blocking occurrences; the honest output passes.

### A4. The migration blesses, by hash and permanently, a value whose own entry says it is a real credential; the ADR rule says that must not happen

- **Scenario.** `docs/qa/secret-scan-allowlist.json:73` grants `github-fine-grained-pat` on a review report; its `reason` says the value is a truncated prefix of a real credential, quoted as demonstrated evidence and flagged to the human for a rotation call (Issue 89, still OPEN). The generator carries reasons verbatim and hashes that value. ADR rule (THOTH-ADR-0002, Rules for agents): "MUST NOT allowlist a real credential. Rotate it and remove it". The file the story ships contradicts the rule the human is asked to accept.
- **Evidence (code-traced):** the entry at `docs/qa/secret-scan-allowlist.json:73`; the ADR rule; Issue 89 read through `gh` (state OPEN). My classification pass over the 108 measured values (counts and shapes only, no value printed): of 17 credential-shaped values, 16 look synthetic by name or shape (one of them is the labeled brand-new fixture literal, which a keyword heuristic missed) and exactly 1 does not: this entry. The other 91 values are 23 addresses (17 reserved-domain, 4 fake-token URL userinfo shapes, 2 short placeholders), 67 hostnames with generic labels and 1 private IPv4. So no undeclared real value is blessed today, but nothing in the design would have told a reviewer that, and the subset proof cannot (it is structural).
- **Exposure:** 1 of 108 migrated triples (0.9%), basis: counted (classification instrument above and the entry's reason text).
- **Current defense:** the value is already exempt today (whole-file); the migration does not widen it. The delta is the honesty of the ADR and the permanence of the exemption.
- **Tags:** severity LOW / evidence code-traced / reach operator / likelihood routine / undo reversible.
- **Verdict: BREAKS (ADR text versus shipped data).** Route: residual register plus a human decision at the pull request (rotate and remove per Issue 89, or record a named exception in the ADR). Proof-test to keep them from drifting: `sb2-adr-real-credential-rule-has-no-unnamed-exception` (real file): the set of migrated entries whose reason self-describes as a real credential equals the exception list the ADR names; fails today.

### A5. Hashes of blocked matches will land in a CI-uploaded artifact

- **Scenario.** Plan section 5 says no hash is printed for a blocked match because a weak value's hash is guessable, then says the generated history-scan report file gains the hash per match. The report writes every match, blocked or allowlisted (`src/secret-scan/history-scan.ts:189`), and CI uploads it on every run, failures included (`.github/workflows/ci.yml:260`, `if: always()`). For a `generic-password-assignment` match the 4-character redaction shows only the keyword, so today the artifact reveals nothing about the password; an unsalted sha256 of the whole match is dictionary-crackable. The decision row (Q5) justified hashes for allowlisted values (already cleartext in a tracked file); blocked values are not.
- **Delta caveat.** CI only runs on pushed commits, whose plaintext is readable by the same audience as the artifact, so the added disclosure is near zero while the commit is visible; it matters if a commit is later removed from view.
- **Evidence (code-traced):** `src/secret-scan/history-scan.ts:187` (writes `matches` wholesale) and `.github/workflows/ci.yml:260`.
- **Exposure:** ~0% added disclosure while the pushed commit is visible; unbounded after a force-push removal, basis: assumption. Caps at LOW.
- **Tags:** severity LOW / evidence code-traced / reach user (CI artifact reader; entry point `.github/workflows/ci.yml:260`) / likelihood plausible / undo irreversible (artifact retention window).
- **Verdict: BREAKS (internal contradiction of the plan).** Proof-test (cheap, day 1): `sb2-report-file-omits-value-hash-for-blocking-matches` (CLI, temp repo): run the CI entry point with one blocked and one allowlisted match and parse the generated report; the blocked match carries no `valueSha256`; the allowlisted one may.

### A6. This story's own committed spike is a binary file to git, to reviewers and to the scanner

- **Scenario.** `docs/spikes/s1-136-value-triples-2026-09-19.mjs` contains 8 raw NUL bytes (used as key separators). Git classifies it binary (`git ls-files --eol` shows `i/-text`; `git diff-tree --numstat` prints `- -`; `git grep` prints "Binary file ... matches"), so a pull request shows no diff for it, and `looksBinary` makes OSS-01 skip it. It is the seed of the generator the plan asks a reviewer to approve; a generator written the same way would be unreadable in review and unscanned.
- **Evidence (demonstrated):**
  ```
  tracked blobs 362 skipped as binary 1   ->  docs/spikes/s1-136-value-triples-2026-09-19.mjs
  NUL offsets: 2325 2333 2611 2996 3206 4757 5335 5541
  spike text with NULs neutralised: matches no pattern (0 lines printed, NUL count 8)
  ```
  So replacing the separators is safe: it does not turn the file into a new blocking triple.
- **Exposure:** 1 of 362 tracked blobs (0.3%), basis: counted in code. The skipped file holds no secret-shaped text (measured above).
- **Tags:** severity LOW / evidence demonstrated / reach instrument / likelihood routine / undo reversible.
- **Verdict: BREAKS (story artifact).** Proof-test: `sb2-no-tracked-text-file-is-skipped-as-binary` (instrument over `git ls-tree -r HEAD`): the count of tracked blobs the scanner skips as binary, excluding a named list of real binaries, is zero; red today with exactly this one file. It must also cover the generator and its test file when they land.

### A7. The unlock line and the hash boundary: the value hashed is the regex match, not the secret

- **Scenario.** The plan's block message tells a developer to add the literal's sha256 with "the command to compute it". For eight of the ten pattern ids the match is the literal (or the whole secret block). For `generic-password-assignment` and `aws-secret-access-key` the match includes the key name, operator and quotes, and the design forbids printing the blocked hash. A developer hashing "the secret" gets a hash that never matches. The command must also work in the project's Windows shell (an `echo`-style pipe adds a trailing newline; PowerShell 5 pipes UTF-16). No entry uses those two patterns today, so this is latent.
- **Evidence (derived; supporting fact demonstrated):** the hash of the matched bytes equals sha256 of the file's own bytes for a multibyte match (prototype run, S1); the two context-including regexes are at `src/secret-scan/patterns.ts:12` and `src/secret-scan/patterns.ts:41`.
- **Exposure:** 2 of 10 pattern ids match a string longer than the secret, basis: counted in `src/secret-scan/patterns.ts`; 0 of 108 current triples use them.
- **Tags:** severity LOW / evidence derived / reach user / likelihood plausible / undo reversible.
- **Verdict: UNPROVEN.** Proof-test: `sb2-unlock-command-output-is-accepted-by-the-gate` (gate, temp repo): for each pattern id, the unlock line's own printed command, run verbatim through the platform shell on a runtime-built fixture (including a context-including pattern), yields the hash the gate accepts once it is added.

### A8. A dropped entry is silent: the block does not say the entry was rejected

- **Scenario.** `loadAllowlist` swallows a parse failure into an empty list and filters invalid entries with no diagnostic (`src/secret-scan/history-scan.ts:161`). Under the new design a typo (uppercase hex, wrong length, an entry left in the old shape) drops that entry and its matches block, which is the intended fail-closed direction, but the developer sees only a list of blocked matches and an unlock line telling them to add a hash to an entry that was never honored. A BOM makes the whole file unreadable and blocks everything with no cause named.
- **Evidence (code-traced; demonstrated on the prototype loader):** BOM file yields 0 entries, uppercase hex rejected, extra keys accepted, duplicate JSON key last-wins (S3).
- **Exposure:** every entry-level typo and every unreadable file; a wholesale-rejected allowlist turns 1535 history occurrences (108 distinct triples) into blocking matches, basis: measured (spike and plan).
- **Tags:** severity LOW / evidence code-traced / reach user / likelihood plausible / undo reversible.
- **Verdict: UNPROVEN.** Proof-test: `sb2-rejected-entry-is-named-in-blocking-output` (loader plus gate): a file with one valid, one uppercase-hex and one legacy-shaped entry, and a BOM-prefixed file, each produce an output line naming the rejected index or path and pattern and the reason class, never a value or hash.

### A9. Concurrent branches and a moving base

- **Scenario.** The generator scope is history at the story base "recorded at Phase 2 start". Any other PR merged to the default branch before this one, or any open branch, that adds a literal to an already-granted file, or an old-shape entry to the allowlist, lands values the migrated file has never seen, or an entry the strict loader drops. CI on the merge commit turns red, loudly. The repository already carries several stacked story branches that touch `src/secret-scan/` test files.
- **Evidence (derived):** plan section 8 (generation scope); `git for-each-ref` shows 6 local story branches, 4 of them touching `src/secret-scan/` or the allowlist against the default branch (counted).
- **Exposure:** unbounded in principle; bounded per merge by the count of new values in granted files, basis: assumption. Caps at LOW.
- **Tags:** severity LOW / evidence derived / reach operator / likelihood plausible / undo reversible.
- **Verdict: UNPROVEN.** Routed to the residual register with its trigger; no test.

## Attacks that SURVIVE (each celebrated; the evidence is what a reader can rerun)

### S1. Hash boundary and scan-path parity. SURVIVES (demonstrated)
- Both scan paths call one function (`scanBlobText`, `src/secret-scan/history-scan.ts:45`) on the same `git cat-file` bytes, so the history scan and the simulated pre-commit tree cannot hash the same blob differently by construction.
- Prototype (scratch clone, the design's `sha256(Buffer.from(m[0], "latin1"))`): a multibyte match (an e-acute inside a password value) hashes equal to sha256 of the file's UTF-8 bytes (`true`). A match spanning a CRLF hashes over the raw bytes (equal to the raw text, not to an LF-normalised copy).
- Measured over full history at HEAD, all 1535 occurrences: 0 contain a newline, 0 contain a CR, 0 contain a non-ASCII byte (`{ tot: 1535, nl: 0, cr: 0, blobs: 998, crBlobs: 0 }`), and `.gitattributes` sets `* text=auto eol=lf`. `matchAll` clones the regex and the code resets `lastIndex` first, so the `g` flag does not change which matches are hashed; matches are non-overlapping and leftmost, identical in both paths.
- Limit, not a break: for a regex that truncates (the internal-hostname regex matches the leading label plus the ending, so a longer real dotted name yields the same match as a shorter fixture) the hash binds the match, not the whole token. Among the granted patterns only the hostname and private-IPv4 patterns truncate; a reviewer sees the file diff either way. Residual R2.
- Side observation (pre-existing, no design impact): a password containing a UTF-8 character whose second byte is 0xA0 is not matched at all, because that byte reads as whitespace once decoded as latin1 (an accented-a password: 0 matches; an accented-e password: 1 match). Same family as A1; folded into the Issue filed for it.

### S2. Path keying against blob dedupe. SURVIVES (demonstrated, counted); the ADR residual row is true
- Prototype partition, one granted file and a byte-identical copy: a copy at a LATER-sorting path is never evaluated under its own path (0 blocking, 1 allowlisted, reported at the original path); a copy at an EARLIER-sorting path takes the first-seen slot and blocks (1 blocking). A differing-content copy carrying a novel value blocks (novel value not exempt).
- So a granted value can pass at an ungranted path only inside a byte-identical copy, which by construction holds no value that was not already granted at the original. No secret is gained. The reverse (a legitimate value blocked because an ungranted path is first-seen) is fail-closed.
- Instrument (git-derived, scratch): 225 blobs carry a match; 0 of them appear at more than one path across history. The order-dependent over-block has no instance today.
- Path forms: git prints non-ASCII paths C-quoted (an accented directory comes back as a quoted, octal-escaped string) and matching is exact string equality, so a non-ASCII path can only be granted by writing the quoted form; nothing normalizes to an allowlisted path. Fail-closed.
- Frozen with residual R1. The ADR's "Pre-existing, not changed" wording is accurate.

### S3. Loader fail-closed edge cases. SURVIVES (demonstrated on a prototype loader)
Prototype `isValidAllowlistEntry` with the plan's rule (non-empty list of lowercase 64-hex):
```
L good true | upper false | trailingNL false | empty false | str false | dupKeysProto false | extraKeys true
L BOM file -> 0   object -> 0   dupkey(last wins) -> 1   good -> 1
```
Uppercase, trailing newline, empty list and string-not-list are rejected. A `__proto__` key inside the entry is an own property after parse and grants nothing. A non-array file and a BOM file yield no entries (every match blocks). Duplicate JSON keys: the last wins, and both keys are visible in a diff. An unknown extra key is accepted (as the current loader does), which is what makes the rollback claim in S7 hold. One dropped entry does not affect its neighbours (`filter`). Only the lack of a diagnostic is a finding (A8).

### S4. Issue 203 and the baseline guard. SURVIVES (code-traced); the plan's reading is sound and the ADR claim is honest
- The plan's reading (a self-hashed report grant passes the gate; the baseline guard catches only an accidental omission; the pull request diff is the review) is correct. A deliberate author adds the entry, the hash and the baseline pin in one commit and every automated check passes. That is exactly today's behavior for the deliberate path.
- Compared with today: credential-shaped patterns, strictly better (today a report grant needs one edit and no pin because of the prefix exclusion at `src/secret-scan/history-scan.test.ts:269`; after Issue 203 it needs the entry with a value hash, a baseline key and hash, and a non-empty baseline reason, `src/secret-scan/history-scan.test.ts:307` and `src/secret-scan/history-scan.test.ts:401`). The three non-credential patterns (email, internal hostname, private IPv4) have no baseline today and none after: equal to today for a deliberate self-hashed grant, better for accidents (a whole-file grant on a report covered every future value; a hash covers one). No regression.
- "Closes the unattended path, not the deliberate one" is honest and complete. Nothing in the design still relies on report immutability (Issue 233 stays out of scope). Editorial: the name of T13 says the guard "catches" a self-hashed grant; it catches an omitted pin only.
- The `REVIEWED_BASELINE` idiom hashes the working-tree text; the gate hashes blob bytes; they agree for the single-line ASCII values in question (S1).

### S5. Hidden dependencies on the old file shape. SURVIVES (demonstrated by `git grep`)
`git grep -n -E "secret-scan-allowlist"` outside reports, decisions, state, changelog and plans, and `git grep -n -E "AllowlistEntry|loadAllowlist|partitionAllowlisted|summarizeMatches|HistoryMatch|scanHistory|isValidAllowlistEntry"` outside `history-scan.ts`: the readers are `src/secret-scan/history-scan.ts`, `src/secret-scan/history-scan.test.ts`, `src/secret-scan/pre-commit-scan.ts`, `src/secret-scan/pre-commit-scan.test.ts`, the allowlist itself and the spike. No reader in `hooks/`, no `scripts/` directory, and `.github/workflows/ci.yml` names only the uploaded report path; nothing parses the report's fields. Adding a `valueSha256` field to a match breaks no consumer. This matches the plan's section 4 list.

### S6. The C1 to C4 order and the story's own committed text. SURVIVES (demonstrated), except A6
Reproduced the plan's spike at 431c216 (scratch clone): `history: commits=200 ... distinctTriples=108`, `simulated pre-commit tree ... distinctTriples=107`, `union distinctTriples=108 distinctPairs=50 allowlistEntries=50`, `grants matching something: 50 of 50`, `non-granted triples (would block today): 0`, `hash cost: 1809 digests in 21.89 ms`. The plan and ADR commit added no new triple (108 unchanged; the plan's "199 commits" is 200 now because 431c216 is itself a commit: Editorial). The allowlist has 2 entries on itself (email and internal hostname), whose values live in reason text that the migration carries verbatim, and 64 lowercase-hex strings match no pattern, so the migrated file creates no new triple. C2 atomicity holds: the hook reads code and allowlist from disk (`src/secret-scan/pre-commit-scan.ts:55`, `.githooks/pre-commit`).

### S7. The rollback claim ("the old loader safely reads the new file"). SURVIVES (code-traced)
The current `isValidAllowlistEntry` (`src/secret-scan/history-scan.ts:150`) ignores unknown keys, so old code plus the migrated file honors every entry at path and pattern: exactly today's behavior, never broader. A code-only revert therefore leaves a valid file at today's semantics; there is no downgrade path worse than today.

## Frozen set (inherited by the next round; re-open only with new code, a test run or a measurement)

- S1 hash boundary and parity (byte hash over the scanner's decoded string; 1535 occurrences with 0 newline, 0 CR, 0 non-ASCII; one shared function).
- S2 path keying and dedupe (0 of 225 matched blobs multi-path; the copy-at-a-later-path exemption is disclosed and carries no value that was not granted).
- S3 loader fail-closed table (prototype level; the shipped loader must reproduce it: T4 and T5).
- S4 the Issue 203 reading and the baseline-guard claims.
- S5 consumer and dependency list.
- S6 the sequencing, and the plan and ADR text not tripping the gate (spike reproduced, 108 stable).
- S7 the rollback claim.

## Residual-risk register (accepted, monitored, trigger stated)

| Id | Residual | Trigger | Exposure |
|---|---|---|---|
| R1 | A byte-identical copy of a granted file at a later-sorting path is exempt from its own path; at an earlier path it over-blocks | a second path holding the same blob as a matched blob | 0 of 225 matched blobs today, counted |
| R2 | The hash binds the regex match; truncating patterns (internal hostname, private IPv4) vouch for a prefix of a longer real name | a granted hostname or IPv4 value that is a prefix of a longer real name | hostname 67 and IPv4 1 of 108 triples, counted |
| R3 | A reviewer of a hash addition sees opaque hex; nothing maps a hash to a value, and generator and verify output counts only | any pull request that adds a hash | the ADR already states the diff and the reason are the review |
| R4 | Reasons written for whole-file entries stay verbatim after migration | reading a reason that says the whole file | editorial, 50 entries |
| R5 | A9: other branches or a moved default branch add values or old-shape entries | any merge before this PR | loud CI red, revert-safe |
| R6 | A4: one migrated value is a fragment of a real credential (Issue 89 open); the ADR rule needs an exception or a rotation | the human's ratification of the ADR | 1 of 108 |
| R7 | A1: NUL-byte evasion, pre-existing and orthogonal; filed | any commit of a UTF-16 or NUL-bearing text file | 0 secret-bearing skipped files today |
| R8 | devops ADR-0008 time-bound clause is deviated from by design; the human ratifies | ADR acceptance | policy, not runtime |

## Unrun verifications (commands nobody has executed yet)

| Verification | Command | Owner |
|---|---|---|
| The walking skeleton itself (T2 and P1 red then green) | `node --test src/secret-scan/history-scan.test.ts src/secret-scan/pre-commit-scan.test.ts` after the skeleton is built | story-implementer |
| Real-file round trip (A3), first on real data, before C2 | generator to a scratch path, then `node src/secret-scan/history-scan.ts` with that file: exit 0, 0 blocking, 108 hashes | story-implementer |
| CI entry point negative control (A3) | temp-repo drill against `node src/secret-scan/history-scan.ts` | story-implementer |
| Rollback drill (corrupt the migrated file in a scratch clone, count blocking, repair on disk, commit without `--no-verify`) | plan section 8 | story-implementer |
| Runtime re-measure, median of 3 within 10 percent of a same-session baseline | `node src/secret-scan/pre-commit-scan.ts`, three runs, before and after | story-implementer |
| Not run by me: full test suite, typecheck and lint (a design round; nothing built) | the three npm scripts | Manager at verify |

## Editorial (uncounted, verdict-neutral, plain edits)

- Plan section 3 says 199 commits and 995 blobs; at 431c216 the same scan reports 200 commits and 998 blobs (the plan's own commit). Triple counts are unchanged.
- Plan test row T8 names the fine-grained pattern `fine-grained-pat`; the real id is `github-fine-grained-pat` (the spike uses the right one).
- T13's name overstates what the baseline guard catches (an omitted pin, not a deliberate one).
- The spike reads report files as UTF-8 for one measure and latin1 elsewhere; harmless for ASCII values, worth one comment.
- Reason strings written for whole-file entries stay verbatim through migration (generator test G1 requires it); some describe "the file".
- Six local story branches exist; whichever merges second needs its own regenerate step (folded into A9).

## The single scariest unproven assumption

That a reviewer approving 108 opaque hashes plus counts-only generator output is reviewing values: the "subset of today's coverage" proof holds by construction (every migrated entry sits on a legacy pair), so it says nothing about which values are blessed. The only value-level evidence in this round is my own counts-only classification pass, which found one real-credential fragment that its own entry already declares, and no test repeats it.

## Computed verdict

Valid HIGH count: 0 (A1 is pre-existing and graded MED with its reasoning stated; every other finding is LOW, or MED derived). **go**, round 1, roundsSinceLastGo 0. Every MED and LOW is routed to a named day-1 proof-test or a residual line above; none crosses a tenant or security boundary inside the design's own change surface.

## Persistence

- Report: this file. Review log row appended in `docs/REVIEW_LOG.md`.
- Bug Issue filed for A1 (the only MED finding listed as a finding): labels bug, severity:med, oss; milestone S1 Protect the baseline; duplicate check first found none (searches on NUL, binary, looksBinary, skipped files). The Issue number is recorded in the run summary, not repeated in this file.
- No LOW finding was filed (the rule files HIGH and MED only).
- Nothing pushed; the scratch clone lives outside the repository; the working tree's tracked files were not edited.

RECEIPT: verdict=go
attacks:
1. [ISSUE][MED][demonstrated/user/plausible/irreversible][~0% today, 0 of 1 skipped file holds a secret; 1 of 362 tracked blobs skipped, counted] A1 pre-existing: a NUL byte in a text file's first 8000 bytes makes OSS-01 skip the whole file; no defense in the scan; orthogonal to the design, filed, not gating
2. [SUSPICION][MED][derived/instrument/plausible/reversible][3 of 6 layers outside the skeleton, counted from the plan] A3 skeleton omits generator plus real file, the CI history-scan entry point and the baseline edits; first real-data contact is the atomic C2
3. [SUSPICION][LOW][derived/operator/operator-error/runbook-reversible][today 0 extra blessings, 50 entries bound the future, measured] A2 retained generator re-run semantics on scoped input unspecified; verify is one-directional
4. [ISSUE][LOW][code-traced/operator/routine/reversible][1 of 108 triples, counted] A4 migration blesses by hash a value whose entry says it is a real credential (Issue 89 open); the ADR rule contradicts shipped data
5. [ISSUE][LOW][code-traced/user/plausible/irreversible][~0% added while the pushed commit is visible, assumption] A5 hashes of blocked matches will be written to the report the CI uploads on every run
6. [ISSUE][LOW][demonstrated/instrument/routine/reversible][1 of 362 tracked blobs, counted] A6 the story's own committed spike has 8 NUL bytes: binary to git, unreviewable in a diff, skipped by the scanner
7. [SUSPICION][LOW][derived/user/plausible/reversible][0 of 108 triples use the 2 context-including patterns, counted] A7 unlock line: the hashed value is the regex match not the secret; the printed command must work in the Windows shell
8. [SUSPICION][LOW][code-traced/user/plausible/reversible][1535 occurrences would block on an unreadable file, measured] A8 dropped or unreadable allowlist entries are silent; the block does not say the entry was rejected
9. [SUSPICION][LOW][derived/operator/plausible/reversible][unbounded per merge, assumption] A9 a moved default branch or a concurrent branch adds values or old-shape entries the migrated file lacks
10. [CLEAN] S1 hash boundary and scan-path parity: byte hash equals file bytes for multibyte and CRLF matches; 0 newline, 0 CR, 0 non-ASCII in 1535 occurrences; one shared function
11. [CLEAN] S2 path keying against blob dedupe: copy-at-later-path exemption is real, disclosed and carries no ungranted value; 0 of 225 matched blobs multi-path
12. [CLEAN] S3 loader fail-closed table: uppercase, trailing newline, empty, string, __proto__, BOM, non-array all rejected; extra keys accepted
13. [CLEAN] S4 Issue 203 reading and the baseline-guard claims: sound, honest, no regression versus today, improvement for credential patterns, equal for the other three
14. [CLEAN] S5 hidden consumers of the old file shape: none in hooks, scripts, workflows or docs beyond the plan's list
15. [CLEAN] S6 C1 to C4 order and the story's own text: spike reproduces 108 stable, plan and ADR add no triple, C2 atomicity holds
16. [CLEAN] S7 rollback claim: the old loader ignores the extra field and reads today's semantics, never broader
counts: issues=4 suspicions=5 clean=7
evidence: demonstrated=7 code-traced=5 derived=4
round=1 roundsSinceLastGo=0 frozen=7 residuals=8 unrun=6 editorial=6
checks=ran: spike reproduced (108 triples, 50 pairs, 50 of 50 grants match, 0 non-granted); multi-path instrument 0 of 225; newline/CR/non-ASCII counts 0/0/0 of 1535; attack scripts A1 (NUL evasion), hash boundary, dedupe copy, loader table, ls-tree quoting; skipped-binary count 1 of 362; not run: test suite, typecheck, lint
adr=HIT(3)
report=docs/reviews/s1-136-value-scoped-allowlist-design-challenger-2026-09-19.md
