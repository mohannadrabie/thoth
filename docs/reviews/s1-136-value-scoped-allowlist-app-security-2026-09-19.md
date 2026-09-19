# s1-136-value-scoped-allowlist: application-security review (post-build), 2026-09-19

[app-security-reviewer]
App Security Reviewer (Horus) -- reviewing for exploitable weakness

- Story S-B2 (issues 136 and 203), branch `fix/s1-136-value-scoped-allowlist`, HEAD 46e8d88. Diff: `git diff 25291ff HEAD` (16 files, no package or lockfile change). Tier CRITICAL (Manager-ratified, not re-litigated). Lane: the security properties; red-team owns the adversarial attacks and the independent classification of the blessed values.
- ADR check: `node docs/adr-cache.mjs --ensure` printed `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog` with `[CACHE=HIT]`. Rules read for my domain: THOTH-ADR-0002 (Proposed, own MUST and MUST NOT rules), devops ADR-0008 (ratchet only), SE ADR-0001.
- Method: real commands against the shipped code; every experiment ran in a scratch directory outside the repository; no tracked file was edited; nothing pushed. Every attack literal was built at runtime; none is written here, and no hash of a value appears in this report.

## Verdict: REWORK (one HIGH, demonstrated; the rest of the design is sound)

The core property holds: no path exists where a match becomes allowlisted unless path, pattern id and value hash all agree, and every malformed input fails closed. The one defect is outside the exemption logic: the unlock command the gate now prints embeds an attacker-chosen file path in a shell command, and it executes when a maintainer copies it (demonstrated in sh, PowerShell and cmd). It is a small, local fix.

## Findings, ranked by exposure x irreversibility x silence

### 1. [HIGH][demonstrated] The printed unlock command is a copy-paste code-execution sink for any file path

- **Evidence.** `src/secret-scan/history-scan.ts:191` builds `node src/secret-scan/allowlist-tool.ts hash <commit> "<path>" <patternId>` with `m.path` (the path exactly as git prints it) inside plain double quotes. Git C-quotes only control characters, the double quote, the backslash and non-ASCII bytes; the dollar sign, the backtick, `&`, `;`, `(` and `)` pass through raw. The block message tells the reader to run it (the `UNLOCK:` line at `src/secret-scan/history-scan.ts:172`), and it reaches a CI log and a developer's terminal.
- **Attack sketch.** A contributor commits a file whose NAME carries a shell payload and whose content holds any secret-shaped literal; the gate blocks it and prints the command with the payload inside; the maintainer who follows the printed UNLOCK runs the payload with their own privileges (merge rights, tokens, the human-only actions in CLAUDE.md). CI runs on `pull_request` (`.github/workflows/ci.yml:17`), so a fork PR puts the line in front of a maintainer.
- **Demonstrated (raw, scratch repos; the gate run as `node <repo>/src/secret-scan/history-scan.ts`, the printed line then executed verbatim).**

```
repo with three files whose names hold a command substitution (touch marker_sh), a backtick form, and a PowerShell
subexpression (New-Item marker_ps -ItemType File), each holding one AWS-key-shaped literal built at runtime
[OSS-01 history-scan] FAIL: 1 secret-shaped match(es) found in history (0 allowlisted, not counted)
  - HASH-COMMAND for <path with the PowerShell subexpression> [aws-access-key-id]: node src/secret-scan/allowlist-tool.ts hash <12-hex> "<same path>" aws-access-key-id
bash -c '<the command form with the touch substitution>'      -> marker_sh created (payload ran)
powershell -Command '<the New-Item form>'                     -> marker_ps created (payload ran)
cmd.exe with the same shape (a dollar-paren is inert in cmd)  -> marker_cmd absent (no execution)

cmd quote-parity variant: a git tree entry whose path holds two double quotes and then "& copy nul marker_cmd &"
(buildable on Linux or macOS; modelled here with update-index and core.protectNTFS off; the gate reads git objects only):
  printed:  node src/secret-scan/allowlist-tool.ts hash <12-hex> ""x\"\" & copy nul marker_cmd & \"y"" aws-access-key-id
  cmd.exe /c <a batch file holding that line>                 -> marker_cmd created (payload ran)
  (a variant with one quote pair put the ampersands inside the quotes and did NOT execute; the attacker picks the parity)
```

  All three shells the ADR names (sh, PowerShell, cmd) execute a payload; the shell-specific route differs, the sink is the same. Only marker files were created.
- **Why this is not issue 238.** Issue 238 is a correctness bug (a C-quoted non-ASCII or special path makes the command exit non-zero), tagged low with derived evidence. This finding is the security half of the same printed-command sink: a command substitution, a backtick and quote parity need no C-quoting at all and execute code. One fix covers both; the diff does not worsen 238, it introduced the sink both share.
- **Exposure:** ~100% of blocked matches at an attacker-named path (the attacker chooses the path); 1 of 366 tracked paths carries a character outside `[A-Za-z0-9._/-]` today (a space, benign), basis: measured (`git ls-files` count) and counted in code (one emit site, `src/secret-scan/history-scan.ts:191`). Security findings are exempt from the narrow-exposure cap (PRINCIPLES rule 21).
- **Existing test gap.** `sb2-unlock-command-output-is-accepted-by-the-gate` (`src/secret-scan/history-scan.test.ts:1063`) executes the printed command through the platform shell, but only for one benign path.
- **Minimal fix.** In `unlockDetails` print the runnable `HASH-COMMAND` only when the path matches `^[A-Za-z0-9._/-]+$`; for any other path print a non-runnable line (no path, no command) telling the reader to run the `hash` subcommand with the path typed by hand from the commit's own tree listing. Nothing else changes; the commit prefix (hex from git) and the pattern id (from the catalog) are already safe.
- **Failing test (write red first):** `sb2-unlock-command-never-embeds-a-shell-metacharacter-path` -- temp repo with a blocked literal in files whose names hold a command substitution, a backtick and a double quote; assert the printed HASH-COMMAND line, executed through the platform shell in a scratch directory, creates no marker file, and that a plain name still yields a command the gate accepts.

### 2. [LOW][demonstrated] ADR residual "the hash binds the regex match, not the whole token" is understated

- THOTH-ADR-0002's table names only the internal-hostname and private-IPv4 patterns. `aws-access-key-id` (`src/secret-scan/patterns.ts:11`, four letters then 16 upper-case alphanumerics) has no boundary on either side. Demonstrated in scratch: the granted fixture alone, the fixture followed by 20 extra upper-case characters, and the fixture preceded by two characters all produce the identical match text and so the identical hash (`prefix-vouching ... true ; leading-context true`). A grant of a 20-character value therefore vouches for any longer token that begins with, or is embedded around, it. Real AWS ids are exactly 20 characters, so there is no practical gain today; the residual row is simply incomplete.
- **Exposure:** 12 of 108 blessed values use this pattern, basis: measured (allowlist-tool verify, below); exploiting it needs a longer real token that embeds a granted fixture.
- Fix: one row edit (residual register). No executable form; not a test.

### 3. [LOW][code-traced] ADR residual "A moved base" hides that the recovery step re-blesses

- The row says a moved base "fails closed, never open" and directs re-running `generate --base <ref>`. The red CI is correct, but the remedy `migrateAllowlist` (`src/secret-scan/allowlist-tool.ts:81`) blesses EVERY value the history at that ref holds at a granted pair. If a novel literal slipped into a granted file on the moved base under the legacy whole-file rule (issue 136 own hole, open on the default branch until this merges), regeneration blesses it permanently by hash, and `verify` cannot object because its baseline is the legacy rule that already allowed it. The only value-level evidence is the counts-only line; a reviewer has to compare it with this story's own totals (108 hashes, 17 credential-shaped, 57 under the dated-reports directory).
- Fix: add that to the residual row and require the regeneration PR to state the count delta against 108 and 17. No executable form; not a test.

### 4. [LOW][derived] SUSPICION: a mistakenly allowlisted low-entropy secret now publishes a crackable hash

- The old shape leaked nothing on a wrong grant; a value entry puts an unsalted sha256 of the match into the public file, and for `generic-password-assignment` and `aws-secret-access-key` the hashed text is key name, operator and quotes plus the secret, so a short password is dictionary-guessable. The rule that stops it is human review of the diff (THOTH-ADR-0002 MUST NOT). Present exposure is nil: 0 of 108 blessed values use either pattern (per-pattern counts below). The design-challenger finding A5 made the same point for blocked matches; this is the allowlisted-by-mistake twin. Residual-register line only.

### CLEAN, verified sound

5. [CLEAN][demonstrated] Exemption logic (axis a). A scratch table over `loadAllowlist` and `partitionAllowlisted`, 25 cases, raw result: only the well-formed entry and an entry with extra keys grant; every one of these blocks: uppercase hex, trailing newline, leading space, mixed list, nested list, string instead of list, object-shaped list, empty list, blank reason, numeric path, array entry, null entry, path case difference, pattern id with a trailing space, a `./` path prefix, BOM file, top-level object, empty file, a `__proto__` key as the entry, and a path or pattern named `constructor` or `prototype`. `Object.prototype.valueSha256` stays undefined after loading a `__proto__` entry (no pollution; the grant map is a `Map`). Duplicate JSON keys resolve last-wins and both keys show in a diff. The join key is path, NUL, pattern id; git paths cannot hold NUL and a match key has exactly one, so no cross-field collision. The `rejected` list rides on the array only for diagnostics (`src/secret-scan/history-scan.ts:136`, `:260`); `partitionAllowlisted` (`:140-159`) never reads it, so it cannot widen anything, and losing it (a copy) only drops a message. Blob dedupe adds no gain: a copy of a granted blob at a later path carries only already-granted values (design-challenger S2, unchanged).
6. [CLEAN][demonstrated] Sensitive-data exposure (axis c). Real run on the repo: `[OSS-01 history-scan] PASS ... 0 blocking ... (1665 allowlisted)`; the generated report has 1665 matches, 1665 carrying a value hash (all allowlisted, all already public in the tracked allowlist), 0 blocking. Blocking-only scratch repo: the report keys are `commit,path,patternId,description,redacted`, no hash key. The report is gitignored (`.gitignore:7`; `git check-ignore` confirms) and CI uploads it on every run (`.github/workflows/ci.yml:260-265`, `if: always()`, untouched); what that exposes is redacted text plus hashes that are already in the repository. `redact()` (`src/secret-scan/patterns.ts:74`) and the catalog are unchanged (0 diff lines). Raw matched text is never stored: `HistoryMatch` carries the redacted form and the hash only. The `hash` subcommand prints a hash beside the redacted form for one blob, on the invoking developer terminal, never from the gate (matches the ADR statement that the gate never prints it).
7. [CLEAN][demonstrated] Secrets and supply chain (axis d). `git diff 25291ff HEAD --stat -- package.json package-lock.json` is empty; every added import is a `node:` built-in or a repo path. The real scanner over all added lines of the diff: 16 files, 0 matches. Full history gate: PASS, 0 blocking. `.github/workflows/ci.yml`, `.gitleaks*`, `hooks/` and `.githooks/` are untouched (`git diff --name-only`).
8. [CLEAN][demonstrated] The named exception is honestly worded and the code is consistent (axis e). Scanning the named report with the shipped scanner: one fine-grained-token match of 34 characters, segments of 22 and 0 characters after the prefix, followed by an ellipsis. That is exactly the ADR wording, a 22-character identifier segment and its separator with the secret segment absent; the entry reason and the baseline pin say the same, the entry was not dropped silently, and issue 89 stays the human rotation call. Rewording the MUST NOT to "usable credential" is disclosed in the plan A4 disposition, not hidden.
9. [CLEAN][demonstrated] devops ADR-0008 ratchet. `node src/secret-scan/allowlist-tool.ts verify --base 25291ff --migrated docs/qa/secret-scan-allowlist.json`, exit 0: `PASS`; `legacy entries: 50, migrated entries: 50, dropped as matching nothing: 0, value hashes: 108`; `occurrences allowlisted before: 1535, after: 1535; newly allowlisted: 0; newly blocking: 0`; `blessed values by pattern: aws-access-key-id=12, email-address=23, github-fine-grained-pat=3, github-pat=2, internal-hostname=67, ipv4-private=1`; `blessed values under docs/reviews/: 57`; `blessed credential-shaped values: 17`. The allowlist has 50 entries, 108 hashes, 0 entries with keys beyond path, patternId, valueSha256, reason. The time-bound clause is a stated deviation for the human (not treated as a blocker).
10. [CLEAN][code-traced] The rest of the CLI (axis b). `hash`, `generate` and `verify` reach git only through `execFile` with an argument array (`src/lib/exec.ts`, `src/lib/git.ts`), no shell. The user-supplied path is used only as a lookup key in the commit own tree map (`src/secret-scan/allowlist-tool.ts:317`); nothing reads a file at it, so there is no traversal. Blob shas passed to `cat-file` come from `ls-tree`, never from argv. `--out` and `--migrated` are the invoking developer own file arguments (no privilege boundary). An option-shaped `--base` value only changes which ref git reads. `generate` and `verify` print counts only (test `sb2-generator-cli-prints-counts-only` green). Hostile paths in block lines are safe for log injection: git C-quotes control characters, and every detail line starts with two spaces and a dash, never a double colon.
11. [CLEAN][demonstrated] `partitionAllowlisted` on unvalidated input fails closed: a legacy entry without a list and a list-shaped object throw a TypeError; a hash given as a string blocks. No path yields an exemption.
12. [CLEAN][code-traced] Out-of-scope issues 233, 235, 236, 237, 238 are not worsened. 233: improved (the reports exclusion in the baseline guard is gone, and nothing now relies on immutability). 235: unchanged in the loader; the generator counts and drops dead entries at migration. 236: unchanged (the pre-commit hook still reads the allowlist from the working tree). 237: unchanged, and a new test asserts no tracked text file is skipped as binary. 238: shares the printed-command sink with finding 1; one fix covers both.

## Residual table (axis f): is it complete and is any row understated?

The first row of the ADR table is honest: a deliberate self-hashed report grant passes the gate (an author who adds the literal, its hash and its baseline pin in one PR passes every automated check; the baseline guard catches an omitted pin, not a deliberate one). Compared with the old shape that is strictly better for credential patterns and equal for the other three, as the design-challenger S4 froze. The rest:

| Residual | Verdict |
|---|---|
| Hash binds the regex match | Understated: applies to every unanchored pattern, not only hostname and IPv4 (finding 2). |
| Moved base | Understated: the fail-closed red is real, the regeneration remedy re-blesses (finding 3). |
| Opaque hex in review | Accurate; the counts line is the value-level evidence, and red-team classifies independently. |
| Weak-secret hash in a public file after a wrong grant | Missing (finding 4). |
| The gate and the allowlist both come from the PR own checkout | Not stated, and pre-existing: a PR can change the scanner and the file together; the protection is the named-reviewer rule for `src/secret-scan/*` and the baseline guard. One row would make the trust base explicit. |

## Checks run (raw)

```
node --test src/secret-scan/history-scan.test.ts src/secret-scan/allowlist-tool.test.ts src/secret-scan/pre-commit-scan.test.ts
  tests 70  suites 0  pass 70  fail 0  cancelled 0  skipped 0  todo 0   exit=0
npm test (full)
  tests 929  suites 0  pass 929  fail 0  cancelled 0  skipped 0  todo 0   exit=0
npm run typecheck   exit=0
npm run lint        exit=0
npm run oss:secret-scan   [OSS-01 history-scan] PASS: 0 blocking (1665 allowlisted)   exit=0
allowlist-tool verify --base 25291ff --migrated docs/qa/secret-scan-allowlist.json   PASS   exit=0
scanner over the diff added lines: 16 files, 0 matches
```

Not run: a live PR from a fork through CI (the injection was demonstrated from the printed line, not from the hosted log).

## Findings to tests

- Open findings 4 (issues 3, suspicion 1); executable failing tests 1: `sb2-unlock-command-never-embeds-a-shell-metacharacter-path` for finding 1. Findings 2, 3 and 4 have no executable form (they are wording in the ADR residual table); they resolve as residual-register lines, per rule 19.

## Editorial

- The ADR Compliance section says the unlock command is executed verbatim "for every pattern id"; add "for a plain path" until finding 1 is fixed.

## Single next action

`story-implementer`: add the failing test `sb2-unlock-command-never-embeds-a-shell-metacharacter-path`, make it green with the safe-path gate in `unlockDetails`, make the three residual-table edits, then re-run this lane (a small, local re-review).

Persistence: this report; a REVIEW_LOG row; one bug Issue for finding 1 (labels bug, severity:high, oss; milestone S1 -- Protect the baseline). LOW findings are not filed.

RECEIPT: verdict=REWORK
findings:
1. [ISSUE][HIGH][demonstrated] src/secret-scan/history-scan.ts:191 -- the printed HASH-COMMAND embeds the git path in double quotes; a command substitution or backtick executes in sh and PowerShell, quote parity executes in cmd (payload markers created in all three); fix: emit the command only for paths matching ^[A-Za-z0-9._/-]+$, else a non-runnable line
2. [ISSUE][LOW][demonstrated] THOTH-ADR-0002 residual "hash binds the regex match" understated: aws-access-key-id is unanchored, a granted 20-char fixture hash vouches for any longer token embedding it (12 of 108 blessed values); edit the row
3. [ISSUE][LOW][code-traced] allowlist-tool.ts:81 -- the ADR moved-base remedy (regenerate) blesses every value at a granted pair, including one that slipped in under the legacy whole-file rule; verify cannot object; add to the row and require the count delta (108 / 17) in that PR
4. [SUSPICION][LOW][derived] residual missing: a mistakenly allowlisted low-entropy secret publishes a crackable unsalted hash in the repo (0 of 108 blessed use the two context-including patterns today)
5. [CLEAN][demonstrated] path + patternId + hash must all agree: 25-case loader/partition table, all malformed shapes block, no prototype pollution, no key collision, rejected list is diagnostics only
6. [CLEAN][demonstrated] hashes only for allowlisted matches: real report 1665/1665 hashed are allowlisted, blocking-only report has no hash key; report gitignored, CI upload unchanged; redact() untouched; raw text never stored
7. [CLEAN][demonstrated] no new dependency, no secret-shaped text: package files unchanged, node built-ins only, scanner over added lines 0 matches, full-history gate PASS, ci.yml/hooks untouched
8. [CLEAN][demonstrated] named exception honestly worded: shipped scanner shows a 34-char match, 22-char identifier segment, secret segment absent; entry, baseline pin and ADR agree; issue 89 stays the human call
9. [CLEAN][demonstrated] ADR-0008 ratchet proven: verify PASS, 50/50 entries, 108 hashes, 1535 before and after, 0 newly allowlisted, 0 newly blocking
10. [CLEAN][code-traced] CLI otherwise safe: execFile with argument arrays, path is a tree-map lookup key only (no fs read, no traversal), counts-only output, log lines cannot start a workflow command
11. [CLEAN][demonstrated] partitionAllowlisted fails closed on unvalidated entries (throws or blocks)
12. [CLEAN][code-traced] issues 233, 235, 236, 237, 238 not worsened; 238 shares the sink with finding 1
counts: issues=3 suspicions=1 clean=8
evidence: demonstrated=8 code-traced=3 derived=1
checks="929/0/0"
adr=HIT(3)
report=docs/reviews/s1-136-value-scoped-allowlist-app-security-2026-09-19.md
