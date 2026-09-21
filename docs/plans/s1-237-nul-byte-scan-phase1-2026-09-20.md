# s1-237-nul-byte-scan: Phase 1 plan (2026-09-20)

**Status: PLAN-READY, nothing built.** Story: Issue 237 (found by design-challenger, S-B2 pre-build round 1, attack A1). Branch `fix/s1-237-nul-byte-scan`, cut from origin/master e42a54f (S-B2 merged). Tier PROPOSED: **CRITICAL** (the Manager ratifies; not yet persisted to `docs/.maat-state.json`, that write waits for the ratification).

**Story.** OSS-01 skips a whole blob when a NUL byte sits in its first 8000 bytes (`looksBinary`), in the pre-commit hook and in CI. Remove the skip so every blob is matched against the patterns like any other, and close the second decode miss the same issue names (a UTF-8 character whose second byte is 0xA0 hides a password value).

**Manager rulings (human preapproved the Manager's decisions this session; push and merge stay human-only; human ratification pending, the human reviews them at PR time).**

| Q | Ruling | Consequence in this plan |
|---|---|---|
| Q1 | A NUL-bearing blob is scanned like any other. NUL is an ordinary byte. Same latin1 decode, so `hashMatchedBytes` and the 108 pinned hashes are untouched. No new fail-closed "unscannable" state, no new exemption shape (THOTH-ADR-0002). Legitimate binaries that match are handled by the existing value-scoped allowlist. | Delete `looksBinary` and its call. Nothing replaces it. |
| Q2 | UTF-16 decoding is out of scope (simplicity over polish). It is a named residual with its own Issue. The CHANGELOG and the Issue-close wording for 237 must not claim UTF-16 is covered. | Issue 246 filed during this planning (section 8). |
| Q3 | The 0xA0 miss is in scope, fixed by the regex class, not by the decode. Enumerate every whitespace-sensitive class by a running instrument. Named test. Report whether any allowlist triple changes; `verify` PASS and a byte-identical fresh `generate` is the bar. | Sections 5 and 6. One refinement of the ruling's letter, stated in section 5 and put to the Manager as question 1. |
| Q4 | S-B2's performance criterion carries over: pre-commit median of 3 within 10 percent of a same-session baseline. First build task is a spike counting NUL-bearing blobs across full history and what they would match. A surprise that breaks Q1: STOP and report. | Section 4. |

## 1. Readiness and ADR review

- Readiness: no missing fact. Issue 237 read in full (no comments). The design-challenger report (A1, S1, R7), THOTH-ADR-0002, the S-B2 decisions rows and the S-B2 plan read. Working tree clean at start (one pre-existing untracked file, `prompt`, not part of this story).
- ADR cache: `node docs/adr-cache.mjs --ensure` reported `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] ... (fp 325a142) [CACHE=HIT]`.
- Baselines measured this session, before any change: `npm test` 944 pass, 0 fail, 0 skipped; `allowlist-tool.ts generate --base 7b62344` output byte-identical to the tracked allowlist (`cmp`); `verify --base 7b62344` PASS, 50 entries, 108 hashes, 1540 occurrences before and after, 0 newly allowlisted, 0 newly blocking; `git ls-files --eol` shows 0 files classified `i/-text` (no tracked file is binary to git).

| ADR | Verdict | Rule this story honors |
|---|---|---|
| THOTH-ADR-0002 (proposed; the catalog serves it like an accepted one) | APPLICABLE | "no other exemption shape (glob, line range, expiry, in-file marker, second file) MAY be added for this gate": Q1 adds none; a skip-by-content is an exemption shape and this story removes it. "A change to a pattern's match boundary in patterns.ts MUST be accompanied ... by re-derived valueSha256 lists for every entry of that pattern": the class change adds matches and moves no existing boundary; 0 of 50 entries use the affected pattern (`generic-password-assignment`); proved by `verify` plus byte-identical `generate` (criterion R237-11). "The hash MUST be computed at match time over the matched bytes": untouched. Its residual row and one compliance line describe the old skip; both are edited (section 9), the ADR is still Proposed so an edit is permitted. |
| SE ADR-0005 | APPLICABLE | "MUST NOT delete or weaken a failing test to make CI pass; fix the code or escalate." Three old-behaviour tests must go (section 7). They fail because they assert the defect, not because they are inconvenient; each is replaced by a named test asserting the inverse at equal or greater strength. Flagged for the human with the rulings. |
| SE ADR-0010 | APPLICABLE | "MUST NOT lower coverage thresholds, delete tests". Same treatment and same flag. No threshold changes. |
| devops ADR-0008 | APPLICABLE | "MUST NOT ... broaden suppression/ignore lists": the change narrows an implicit suppression (the skip) and adds no allowlist entry. |
| SE ADR-0001 | NOT-APPLICABLE | No new architectural decision beyond the rulings; no new ADR drafted (an edit to THOTH-ADR-0002's residual row records the change). |
| Remaining catalog entries | NOT-APPLICABLE | Cloud, data, tagging, policy-kernel ADRs; none names the OSS-01 scanner. |

No UNCLEAR applicability.

## 2. Measured before shaping (PRINCIPLES rules 17 and 18): scratch preview, 2026-09-20

The committed spike (section 4) re-runs these and supersedes them. Counts only; no value printed.

| Id | Measure | Result |
|---|---|---|
| S1 | Full history from HEAD: commits, distinct blobs | 241 commits, 1086 distinct blobs |
| S2 | Blobs the old rule skips (NUL in first 8000 bytes) / NUL only after byte 8000 (already scanned) | 1 / 0. The one skipped blob is an earlier version of the S-B2 spike file (6141 bytes, ASCII with NUL separators), repaired in a later commit |
| S3 | Matches in the formerly skipped blobs: new distinct (path, pattern, hash) triples / of those, not covered by the allowlist (would block) | 0 / 0 |
| S4 | Whitespace-class change, over the 1085 already-scanned blobs: triples with the old class vs the new class; only-old; only-new | 108; 108; 0; 0 |
| S5 | Cost: random binary 5 MB / 50 MB; the regexes over the already-scanned blobs | 49 ms / 504 ms; 1029 ms total |
| S5b | Worst case, not part of this fix: a text of hyphen-joined alphanumerics, whole scan at 100 KB / 200 KB (same with a NUL prepended) | 8955 ms / 37735 ms (37811 ms). Per pattern the culprits are `internal-hostname` and `email-address`, 189 ms at 20,000 bytes to 2986 ms at 80,000 (about 4x per doubling). Pre-existing, identical for a text file, so not created by this story; filed as Issue 247 |
| S6 | High bytes 0x80 to 0xFF inside a password value that hide it today | 1 of 128 (0xA0). UTF-8 "à" (C3 A0) hides it; "é" (C3 A9) does not |
| S7 | Latin1 characters JS `\s` matches | 0x09 to 0x0D, 0x20, and 0xA0 |
| S8 | UTF-16 (BOM) file with a key literal, NUL treated as ordinary | 0 matches for LE and BE (plain text: 1). This is the residual of Q2 |

Reading: on this repo the fix changes what is scanned by one historic blob and no triple; the Q1 premise holds on the preview. The class change added no triple and removed none.

## 3. Acceptance criteria to named checks (every criterion maps; none derived)

Test files: HS = `src/secret-scan/history-scan.test.ts`, PC = `src/secret-scan/pre-commit-scan.test.ts`, PT = `src/secret-scan/patterns.test.ts`. Every planted literal is built at runtime; NUL and high bytes are written as escapes, never as raw bytes in a test file. Hashes in tests come from an independent local `createHash` helper.

| Id | Criterion | Named check | Level, file |
|---|---|---|---|
| R237-1 | A NUL byte at offset 0, 1, 7000, 7999, 8000 or 9000 does not stop the scan: the runtime-built key literal is matched, once per file, with `valueSha256` equal to an independent hash of the literal | `oss01-nul-byte-does-not-hide-a-secret` (scanHistory cells). Controls: no NUL, and NUL at 8000 and 9000, pass today by design | gate on a temp repo, HS |
| R237-2 | Same through the CI entry point | same name, CLI cells: `history-scan.ts` exits 1 and names every path, a control repo without NUL also exits 1, so the exit is not a fluke of the fixture | subprocess, HS |
| R237-3 | Same through the pre-commit hook | `oss01-nul-byte-does-not-hide-a-secret (pre-commit CLI)`: every file staged, `pre-commit-scan.ts` exits non-zero, each path in the blocking output, the raw literal never printed | real CLI, PC |
| R237-4 | The 8000-byte window is gone: NUL at 7999 and at 8000 are both scanned (replaces the old window test, section 7) | `oss01-no-8000-byte-window-nul-at-7999-and-8000-are-both-scanned` | gate, HS |
| R237-5 | No blob is skipped whatever its bytes: leading, interior, trailing and all-NUL padding, high bytes, a PNG-header-like prefix, and a run of every byte value 0x00 to 0xFF, each with a distinct literal; matches equal the fixture count (derived) | `oss01-no-blob-is-skipped-whatever-its-bytes` (replaces the real-tree skip assurance, section 7) | gate on a plumbing repo, HS |
| R237-6 | A NUL-bearing blob is governed by the existing value-scoped allowlist and nothing else: a granted literal in it is allowlisted and reported, a novel literal in the same file blocks, a legacy-shaped grant blocks | `oss01-nul-bearing-blob-is-governed-by-the-value-scoped-allowlist` | gate, HS |
| R237-7 | No `\s` or `\S` sits inside a negated character class in any pattern (the miss shape); the remaining tokens are enumerated from the pattern sources by a tokenizer, non-vacuously | `oss01-no-negated-whitespace-class-hides-a-high-byte` | instrument, PT |
| R237-8 | Every high byte 0x80 to 0xFF inside a password value leaves the whole literal matched (loop, so 128 cells derived); a UTF-8 "à" password matches through `scanHistory` | `oss01-high-byte-in-a-password-value-does-not-hide-it`, `oss01-utf8-character-ending-in-0xa0-does-not-hide-a-password` | unit PT; gate HS |
| R237-9 | No narrowing (controls, green at C1 by design): each ASCII whitespace byte still ends a password value; a lone 0xA0 between the name and the operator still matches | `oss01-ascii-whitespace-still-ends-a-password-value`, `oss01-latin1-nbsp-separator-still-matches` | unit, PT |
| R237-10 | Hash and hash boundary untouched: the dogfood test and `sb2-real-allowlist-loads-with-no-rejected-entry` stay green and unedited | existing tests, unchanged | HS |
| R237-11 | No allowlist triple changes (Q3 bar): `verify --base 7b62344 --migrated docs/qa/secret-scan-allowlist.json` PASS with 0 newly allowlisted and 0 newly blocking; a fresh `generate --base 7b62344 --out <scratch>` is byte-identical (`cmp`) to the tracked file; the spike's triple sets old vs new are equal | script checks, output attached to the build receipt; not a permanent test (a real-history test costs tens of seconds inside the suite and CI's own OSS-01 step already does it) | script |
| R237-12 | Spike (Q4): counts of NUL-bearing blobs across full history, new matches, would-be-blocking triples; STOP conditions in section 4 | the committed spike, run before any test is written | spike |
| R237-13 | Pre-commit runtime: median of 3 within 10 percent of a same-session baseline, old code first, then new, same tree | script check, three runs each, both medians printed | script |
| R237-14 | UTF-16 is a named residual, not claimed: the Issue exists and the CHANGELOG and PR wording carry no UTF-16 coverage claim | Issue 246 (filed); `git grep -n -i "utf-16" -- CHANGELOG.md` lists only the residual sentence | script |
| R237-15 | Real verification: typecheck, lint, `npm test` (0 fail, 0 skipped), `npm run oss:secret-scan` PASS with 0 blocking, QA-14 failing count unchanged from a fresh baseline, QA-15 pass | commands, raw output attached | script |
| R237-16 | Scope held: an empty diffstat on `docs/qa/secret-scan-allowlist.json`, `src/secret-scan/pre-commit-scan.ts`, `src/secret-scan/simulated-commit.ts`, `src/secret-scan/allowlist-tool.ts`, `.github/workflows/ci.yml`, `.githooks/pre-commit`, `src/lib/git.ts` | `git diff --stat <base>..HEAD -- <those paths>` | script |

## 4. Spike (first build task, before any test): counts only, committed as a dated artifact

A new file in `docs/spikes/`, dated 2026-09-20, in the shape of the S-B2 spike; prints counts and never a value, a hash or a redaction prefix. It reuses the scanner's own `SECRET_PATTERNS`, `scanBlobText` and `catFileBlob` so it cannot disagree with the gate.

- Scope: history from HEAD (CI's scope), and separately `--all-refs` (reported, not gating).
- Prints: commits; distinct blobs; blobs with NUL in the first 8000 bytes; blobs with NUL only later; total and largest formerly-skipped blob; largest blob overall; per formerly-skipped blob a matches-by-pattern count; new distinct (path, pattern, hash) triples; how many are not covered by `docs/qa/secret-scan-allowlist.json` (would block); the old-class vs new-class triple sets over every blob (Q3); per-pattern time on the largest blobs and on a random 50 MB buffer.
- **STOP and report, do not improvise, if:** (a) any formerly-skipped blob yields a triple not on the allowlist (adding an entry would change the allowlist, a sensitive area, and needs the Manager); (b) any of the 108 triples changes under the class change; (c) the new code's pre-commit median exceeds the baseline median by more than 10 percent. Any of these breaks the Q1 premise ("handled by the existing allowlist") or the Q4 criterion.
- The spike file must contain no raw NUL byte (A6 lesson: a file that is binary to git cannot be diffed in review). Check: `git ls-files --eol` shows 0 `i/-text` after every commit.
- The spike is committed first (S0), then the tests.

## 5. Shape note (source change; two files)

```
git cat-file blob --> Buffer --(looksBinary skip: DELETED)--> latin1 string --> scanBlobText --> hash of matched bytes --> partition by allowlist
                                                               patterns.ts: generic-password value class [^'"\s] --> [^'" \t\n\v\f\r]
```

- `src/secret-scan/history-scan.ts`: delete `looksBinary` and the `if (looksBinary(content)) return null;` line in `scanUnseenBlob`; `scanUnseenBlob` still returns null only for a blob already seen (dedupe unchanged). Update the header comment. Diff size: about 10 lines.
- `src/secret-scan/patterns.ts`: `generic-password-assignment` value class `[^'"\s]{8,}` becomes `[^'" \t\n\v\f\r]{8,}` and a comment records why: the scanner reads a blob as latin1 and JS `\s` matches 0xA0, so any UTF-8 character whose second byte is 0xA0 ended the value early and hid the password.
- **Instrument, not hand count (CLAUDE.md completeness rule).** Whitespace-sensitive tokens are enumerated by running a tokenizer over `SECRET_PATTERNS[].regex.source` (test R237-7; the preview run found: `aws-secret-access-key` two `\s*` separators; `private-key-block` the `[\s\S]` any-character idiom; `generic-password-assignment` two `\s*` separators and one `\s` inside the negated value class). Classification by position:
  - inside a negated class: hides data (the miss). One token. Changed.
  - separator (`\s*` between the name, the operator and the value): treating 0xA0 as whitespace here can only match more, never hide. Four tokens. **Not changed** (refinement of the ruling's letter, question 1): converting them would stop matching a latin1 file whose separator is a lone 0xA0, a new evasion, for no gain. Pinned by R237-9.
  - the `[\s\S]` idiom: any character, independent of the whitespace definition. One token. Not changed.
- **Monotone widening (why the blast radius is bounded).** Removing the skip and widening the value class can only add matches. A value that matched before contained no 0xA0 (the class excluded it and the closing quote had to follow), so it still matches. Both changes fail closed; neither can open a gap. The one way an existing triple could still move is a newly found earlier match overlapping an old one (leftmost, non-overlapping matching); R237-11 measures that and the preview found 0.
- Hash boundary: `hashMatchedBytes` and the latin1 decode are not touched. NUL is a byte like any other in the hash.
- Unchanged edge: a blob is read through the runner's 64 MiB `maxBuffer` before the old skip too, so a very large binary was never cheap to skip and its failure mode (a thrown error, which the pre-commit hook turns into a refused commit) is unchanged.

## 6. Consumer file list (derived by instrument)

```
git grep -n -E "looksBinary|trackedFilesSkippedAsBinary|KNOWN_BINARIES|8000" -- src docs ':!docs/reviews' ':!docs/plans'
  src/secret-scan/history-scan.ts:34,84 ; src/secret-scan/history-scan.test.ts (helper, three tests, comments) ;
  the THOTH-ADR-0002 residual row and one compliance line ; docs/spikes S-B2 spike (historical, dated, not edited)
git grep -n -E "SECRET_PATTERNS|scanBlobText|scanUnseenBlob" -- src ':!*.md'
  history-scan.ts, allowlist-tool.ts (hash helper, latin1, unaffected), pre-commit-scan.ts (comment only), the three test files
git grep -n -i -E "utf-16|utf16" -- CHANGELOG.md
  before this story: no match
```

Phase 2 re-runs these and attaches the output; a difference is a stop-and-report. `docs/qa/secret-scan-allowlist.json` has one grant on `src/secret-scan/patterns.ts` itself, value-scoped: any comment added to `patterns.ts` or `history-scan.ts` must not add a hostname-, email-, address- or key-shaped string (the spike's union triple count must stay 108).

## 7. Tests: red first, then the change

New tests are section 3's names. Old-behaviour tests are **replaced, not silently edited**; each replacement is named and the mapping is the reviewer's check that nothing was weakened:

| Old test or helper (in HS) | What it asserts today | Replacement | Why it is not a weakening |
|---|---|---|---|
| `sb2-binary-helper-window-matches-the-scanner` | a NUL at byte 7999 makes the scanner skip the blob, a NUL at 8000 does not | `oss01-no-8000-byte-window-nul-at-7999-and-8000-are-both-scanned` | same two offsets, inverted: both must be scanned |
| `sb2-no-tracked-text-file-is-skipped-as-binary`, its sibling `...-tolerates-an-unstaged-deletion`, the helper `trackedFilesSkippedAsBinary` and `KNOWN_BINARIES` (three edits of one coupled set, found by the section 6 grep; the ruling named two) | no tracked blob would be skipped by the 8000-byte rule, read from the index | `oss01-no-blob-is-skipped-whatever-its-bytes` | the invariant ("OSS-01 never silently ignores a blob") is now enforced structurally and tested on generated bytes at every position; the real-tree instrument retires with the rule it measured |

Sequence (the old tests stay green until the source change lands, so the replacement is visible in the diff):

| Step | Content | State at commit |
|---|---|---|
| S0 | Spike, run, output recorded | green |
| C1 | New tests only (section 3). Red set enumerated from the run output. Controls (no NUL, NUL at 8000 and 9000, ASCII whitespace, NBSP separator, `oss01-real...` unchanged) pass by design | old code, old tests: pass; the new red tests are the only red |
| C2 | The source change (two files) plus removal of the three old tests, the helper and unused imports, in one commit, because the old tests fail the instant the skip goes | all green; red set of the full suite is exactly the three old tests before their removal (verified by running the suite once with the source change and the old tests in place, output attached) |
| C3 | THOTH-ADR-0002 residual row and compliance line; CHANGELOG (no count claims, no UTF-16 coverage claim) | green |
| drill | Real-repo drill, last: a scratch clone of the branch tip, a file with a NUL at byte 0 and a runtime-built key literal, `git add`, `pre-commit-scan.ts` exits non-zero and `history-scan.ts` on the commit exits non-zero; the same drill against the base commit exits 0 (control: the demonstrated defect) | n/a |

The `git commit` at C1 passes the pre-commit hook because every fixture literal is built at runtime; that is checked before C1 by the spike's union count (108).

## 8. Residuals and out of scope

| Item | Disposition |
|---|---|
| UTF-16 text files (BOM, interleaved NUL) still match nothing (S8) | **Issue 246** filed 2026-09-20 during this planning: bug, `severity:med`, `oss`, milestone S1; duplicate check first found only Issue 237; carries the demonstration, the proof-test name `oss01-utf16-text-file-does-not-hide-a-secret` (named, not committed: a red test cannot land on a green suite) and the open design point (what the allowlist hashes for a decoded match) |
| Quadratic time in `internal-hostname` and `email-address` on a long hyphen-joined run (S5b) | **Issue 247** filed the same way: bug, `severity:low`, `oss`, milestone S1; pre-existing and independent of NUL; named test `oss01-scan-time-is-linear-on-a-long-hyphen-run`. Not fixed here: it would move pattern boundaries (ADR rule) and is not the approved change. The story's own runtime criterion (R237-13) measures the real tree, not this shape |
| Issue 247's body says "0 secret-shaped matches expected" beside the 50 MB random figure; the measured value is 2 chance matches | An edit to correct it was refused by the permission system, so it stands. Needs a corrective comment (immutable-body discipline allows it) by the Manager or the human |
| Issues 238, 242, 229 | Not in this story (ruled) |
| A future legitimate binary that produces a chance match (50 MB of random bytes gave 2) | Handled by the existing value-scoped allowlist: a hash and a reason in a PR; the unlock line already prints the command. No new mechanism (Q1) |
| Other non-ASCII-compatible encodings (UTF-32, legacy code pages), base64 or compressed content | Same class as Issue 246, not separately filed; Issue 246's title names UTF-16 only |

## 9. Files, rollback, hygiene

Modified: `src/secret-scan/history-scan.ts`, `src/secret-scan/patterns.ts`, `src/secret-scan/history-scan.test.ts`, `src/secret-scan/pre-commit-scan.test.ts`, `src/secret-scan/patterns.test.ts`, `docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md` (residual row and one compliance line only; no rule and no `constraints` entry changes, so the catalog parity holds; `adr-cache --ensure` rebuilds), `CHANGELOG.md`. New: one dated spike in `docs/spikes/`. Untouched, proved by an empty diffstat: the section 3 R237-16 list.

- **Rollback (SE ADR-0006):** revert the story as one unit (S-B2's lesson: reverting only the source commit leaves the suite red). Merged: `git revert -m 1 <merge>`; unmerged: `git revert --no-commit <base>..<tip>`, a range without a caret (cmd eats a caret). The change only adds matches, so a rollback can only lift a block that a NUL-bearing or 0xA0 file newly drew; it never re-opens a fixed gap except the one being fixed. Blast radius of a mistake: over-blocking on every commit and CI run, fail closed, measured at 0 new blocking triples on this repo's history.
- **Hygiene:** (1) fixtures and CHANGELOG hold no secret-shaped literal; NUL and high bytes are escapes. (2) After every commit `git ls-files --eol` shows 0 `i/-text` files. (3) QA-14 counts whole changed files: word-form Issue citations ("Issue 237"), existing repo paths only, failing-string text never re-quoted; re-measure the failing count at Phase 2 start (the S-B2 baseline is stale) and confirm it does not move. (4) QA-15: no digit directly after "all" or "every" in any changed file (the suite self-checks on every `npm test`). (5) Comment text added to `patterns.ts` and `history-scan.ts` adds no allowlisted-shape value (section 6).
- **Runtime (R237-13):** baseline first with the old code, three runs of `node src/secret-scan/pre-commit-scan.ts`, then three with the new code, same session and tree; accept new median at most 1.10 times the baseline median. Expected effect about zero (the simulated tree has no formerly-skipped blob at HEAD); measured, not assumed.

## 10. Tier, reviewers, rule 15, design-challenger, test-first

- **Tier PROPOSED: CRITICAL.** Justification: the secret-scanning sensitive area (`src/secret-scan/history-scan.ts` and `patterns.ts`, the code that decides what the gate sees), a recurring hot path (every commit, every CI run; PRINCIPLES rule 20 (a)), whose failure mode (a blind spot) is silent and irreversible once pushed (rotation is the only undo). The change is small and monotone-widening, which lowers the chance of harm, not the ceremony. Prior notes in `docs/.maat-state.json` already say a diff touching these two files re-tiers to CRITICAL.
- **Sensitive areas touched and the reports they call for:** Secret scanning / CI gates: fresh dated reports in `docs/reviews/` from `red-team`, `app-security-reviewer`, `code-reviewer` (two domain reviewers, the cap) and `cross-domain-reviewer` (always). Not touched: the allowlist, `pre-commit-scan.ts`, `ci.yml`, hooks, evidence trail. If the diff must touch the allowlist (spike STOP (a)), that is a stop, then a fresh review of the entry.
- **Rule 15 (`architecture-reviewer`): does not apply.** No first-of-its-kind shape (removing a skip and widening one class); the repeat-root-cause clause is keyed to design-challenger NO-GOs and has not fired.
- **Test-first dispatch check (step 7): NO.** No new or changed UI flow or API surface. The externally observable surface is two CLIs' exit codes and the scanner's coverage, an internal gate; the implementer writes the named tests red first. (Option, as in S-B2, if the Manager wants an independent answer key for a security control: `test-writer` for `oss01-nul-byte-does-not-hide-a-secret` only. Default: not dispatched.)
- **Should design-challenger run on this plan? Recommendation: YES, one bounded pre-build round, on the skeleton (S0 spike plus the first red proof test at both entry points), not on this document (rule 17).** Reasoning: the tier is CRITICAL and the design was set by delegated rulings that no adversarial pass has seen; two rulings depart from the fail-closed default an attacker would probe (Q1: no unscannable state, NUL as an ordinary byte; Q3: a class edit instead of a decode fix), and my own probing found three facts a ruling did not anticipate (the separators/NBSP trade-off, the pre-existing quadratic cost that any newly scanned NUL blob inherits, and that Issue 237's headline example, UTF-16, stays unfixed). S-B2's round found this very Issue. Suggested brief: (a) does scanning NUL-bearing blobs open a fail-open or availability path beyond Issue 247; (b) is closing Issue 237 honest when its headline case is a residual; (c) is leaving four of five `\s` tokens unchanged safe. Budget: 1 graded round (PRINCIPLES rule 20 (b)-style ceiling for a small change). If the Manager judges a roughly 10-line source change too small for a pre-build round, the same three questions go into the `red-team` brief instead; the post-build chain is unchanged either way.

## 11. Questions for the Manager (none blocks the build; each has a default)

1. **Q3 scope.** The ruling says replace `\s` in "the affected patterns". This plan changes the one token that hides data and leaves four separator tokens and the `[\s\S]` idiom (section 5). Default: as planned. Alternative: convert all five `\s`, measured effect on triples 0, cost one new evasion (lone 0xA0 separator in a latin1 file).
2. **Closing Issue 237.** Its title leads with UTF-16, which stays a residual (Issue 246). Default: the PR body says a closing line for Issue 237 covering the NUL-skip and the 0xA0 miss, names Issue 246 for UTF-16, and the human closes 237 at merge; a comment on 237 (Manager or human) records the narrowed scope. Alternative: leave 237 open.
3. **Test replacement under SE ADR-0005 and ADR-0010.** Three old-behaviour tests and a helper are removed (section 7). Default: proceed under the ruling, mapping table as evidence, human ratifies at PR with the other rulings.
4. **Issue 247's body typo** (section 8): needs a corrective comment.
5. **design-challenger** (section 10): default YES, one round on the skeleton.

RECEIPT-INPUT (for the Manager): criteria mapped 16/16, none derived; ADR review 5 applicable, 2 not applicable, 0 unclear; new Issues filed 246 and 247.
