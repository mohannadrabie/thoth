# s1-136-value-scoped-allowlist: red-team round 4 (scoped confirm of the round-3 findings and the new verify sink), 2026-09-20

[red-team]
Red Team (Sutekh) -- attacking the round-3 fix batch (Story S-B2, Issues 136 and 203).

- Branch `fix/s1-136-value-scoped-allowlist` at `ef21a94`. Delta under attack `git diff c0326d5 HEAD -- src/ docs/adr docs/plans CHANGELOG.md` (seven files). Base `25291ff`. Tier CRITICAL (Manager-ratified, not re-litigated).
- Scope, deliberately narrow, as instructed: confirm F1 (Issue 243), F2 (Issue 244), F3, F4 and F5 from my round-3 report are closed, and that the delta introduced nothing new. Nothing cleared in rounds 1 to 3 is re-litigated.
- Method: throwaway git-plumbing repositories and scratch clones, all outside the repository. No tracked file in the working tree was edited; nothing was pushed; the untracked root file was never staged. Every hostile name and every payload was built at runtime inside the scratch scripts and only ever wrote a marker file into a scratch directory. No value, no hash, no secret-shaped literal and no working payload string appears in this report -- payloads are described, never written.
- ADR cache: HIT, reused 37 ADRs (devops 12, software-engineering 23, docs/adr 2), fingerprint 325a142. Rules read for this attack surface: THOTH-ADR-0002 (the artifact, amended again in this delta), THOTH-ADR-0001, devops ADR-0008, SE ADR-0004, SE ADR-0005, SE ADR-0012, SE ADR-0021.
- Read in full before attacking: my round-3 report, the whole delta, `src/secret-scan/history-scan.ts`, `src/secret-scan/allowlist-tool.ts`, both touched test files, `docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md`, the plan's Addendum 3 and `CHANGELOG.md`.

## Verdict: go -- all five round-3 findings are closed on executed evidence; one MED remainder on Issue 244, two LOW

F1 (Issue 243) is closed, and the encoder is stronger than its docstring needs to be: 24 hostile allowlist entries, including bare control bytes, a line separator, a lone surrogate and an astral code point sitting exactly on the cap, produce 24 well-formed single-line diagnostics, and pasting every one of them raw and prefix-stripped into bash, cmd and PowerShell runs nothing, while the shape the round-3 code printed executes in all three. The new `allowlist-tool verify` sink surface is closed to the same standard, and the positive control shows that closing it was load-bearing rather than cosmetic: the old raw classification line executed a payload in 6 of 9 hostile rows in bash. F3, F4 and F5 are closed and their doc claims are exact by instrument.

F2 (Issue 244) is materially improved and not finished. Every one of my five round-3 rewordings now dies against the verbatim pin, the whole-output classifier cannot be evaded by appending advice to any existing line class, and a brand-new printed line class is caught. What still passes green is a deliberate edit that changes the sentence in the source constant AND in the test constant in the same commit: three of my five rewordings (escape, enclose, surround) survive that, because the round-2 phrase blacklist -- the only remaining guard on that path -- still lists no synonym for them. That is the open remainder of Issue 244, and it is a three-word fix.

## Attacks, ranked by blast radius (exposure x irreversibility x silence)

### R1. The Issue 244 pin is defeated by a two-file edit, and the blacklist behind it still misses three of five rewordings -- BREAKS (MED)

- **Scenario.** A later author polishes the no-command how-to sentence. The exact-equality pin fails, so they do the natural thing and update the declared constant in the test to match -- the test file invites this, since the constant is declared beside the assertion. The advice they added is "escape the path for your shell". The suite goes green. The Manager ruling that removed hand-quoting advice has lapsed, and the only thing between the ruling and the next release is a reviewer noticing a two-line diff.
- **Evidence (demonstrated).** Scratch clone at `ef21a94`. Baseline `src/secret-scan/history-scan.test.ts`: `tests 51 pass 51 fail 0 skipped 0 todo 0`, exit 0. Each mutant applied to the shipped source (and, where stated, to the test constant too), the touched test file run, then restored from git.

```
source-constant edits only (the round-3 rewordings, re-run against the new pin)
  W1 ESCAPE the path for your shell            killed   tests 51 pass 50 fail 1 skipped 0
  W2 ENCLOSE the path in quotes                killed
  W3 SURROUND the path with shell quoting      killed
  W4 the advice on a NEW line prefix           killed
  W5 use the path EXACTLY AS SHOWN above       killed
  killer in every case: oss01-unlock-no-command-line-is-pinned-verbatim-and-every-printed-line-is-checked

the same advice applied to BOTH the source constant and the test constant
  D2 ESCAPE    SURVIVED   D4 ENCLOSE  SURVIVED   D5 SURROUND SURVIVED
  D3 QUOTE     killed     D6 PASTE    killed
  killer for D3 and D6: oss01-unlock-no-command-line-never-instructs-hand-quoting-or-pasting-a-path
```

- **Root of it, code-traced.** The verbatim pin compares the printed line to a constant declared in the test file, so it detects a change; it cannot classify one. The only guard that judges CONTENT is the round-2 blacklist regex in `src/secret-scan/history-scan.test.ts`, whose word list is quote, hand-quot, wrap-then-quotes, paste, copy-the-path, spelled-as, type-the-path and match-line. It still has no synonym for escape, enclose or surround -- exactly the gap my round-3 F2 named. D3 and D6 die only because their wording happens to land on a listed word.
- **Current defense (honestly assessed).** Real, and much better than round 3. The cheap failure mode -- a one-file wording edit -- is now dead in five of five cases, and the whole-output classifier closes the side doors. The shipped sentence is correct today. What remains requires a deliberate, diff-visible two-file change, which the source comment and the plan's Addendum 3 both state as the intended property. This is a disclosed residual, not a hidden one -- but it is the same class my round-3 finding named, and it is not yet closed.
- **Exposure:** the whole future of that line; 3 of 5 rewordings survive a both-files edit, 0 of 5 survive a one-file edit, basis: counted in code by instrument.
- **Tags:** severity MED / evidence demonstrated / reach operator / likelihood plausible / undo reversible.
- **Minimal fix.** Three word stems in the existing blacklist regex: escape, enclos, surround. No new test, no new mechanism.
- **Named failing proof-test:** `oss01-unlock-no-command-line-never-instructs-hand-quoting-or-pasting-a-path` extended with those three stems -- red under D2, D4 and D5 today, green on the shipped text.
- **Filing:** this is the open remainder of Issue 244, not a new defect. Commented there; no new Issue filed.

### R2. Two documented properties of the new `clip` helper are unpinned, and both mutants pass green -- BREAKS (LOW)

- **Scenario.** A future refactor simplifies the clip to a plain string slice, or drops the empty-string branch. The suite stays green. THOTH-ADR-0002 says the fields are "clipped to 120 code points" and the function's own docstring says a non-string or empty value prints as a lone percent sign; neither statement is then true, and a reader of a diagnostic sees a shorter path than the rule promises, or an empty field where the sentinel should be.
- **Evidence (demonstrated).** Same clone and baseline as R1.

```
B3 the cap counts UTF-16 units instead of code points   SURVIVED  tests 51 pass 51 fail 0 skipped 0
B5 clip no longer special-cases an EMPTY string         SURVIVED  tests 51 pass 51 fail 0 skipped 0
controls in the same battery
B1 clip stops percent-encoding                          killed
B2 clip drops the cap entirely                          killed
B4 the sentinel becomes an empty string, not a percent  killed
B8 the cap is raised from 120 to a very large number    killed
```

- **Consequence, measured, and it is not a security one.** Under B3 the printed field stays inside the safe character set, stays one physical line and carries no partial escape in every row I tried; what changes is fidelity. For a name made entirely of astral code points the mutant shows 60 code points where the rule promises 120, and a surrogate pair sitting across the boundary is replaced by the replacement-character encoding instead of being kept whole. Under B5 an entry whose path is the empty string prints an empty field rather than the documented sentinel, which also takes that line outside the strict shape the new test asserts for every other row.
- **Current defense (honestly assessed).** Partial and deliberate-looking. The new test asserts the printed field equals an independently restated encoding of the clipped input, which is the right shape of assertion -- its fixture table simply has no row whose 120th code point is astral and no row with an empty-string field, so neither half of the rule is exercised. The security-relevant halves of the same rule (the encoding itself, the cap existing at all, the non-string sentinel) are all pinned and all kill their mutants.
- **Exposure:** the two named properties only; 0 of 50 tracked entries take the rejected branch today, basis: counted in code by instrument. No security consequence measured under either mutant.
- **Tags:** severity LOW / evidence demonstrated / reach operator / likelihood rare / undo reversible.
- **Minimal fix.** Two rows in the existing fixture table of `oss01-rejected-entry-line-never-carries-a-shell-metacharacter-from-the-allowlist-file`: one path whose 120th code point is an astral character followed by more text, and one entry whose path and pattern id are the empty string.
- **Named failing proof-test:** `oss01-rejected-entry-line-clips-by-code-point-and-prints-the-sentinel-for-an-empty-field` -- red under B3 and B5, green on the shipped code.

### R3. The new encoder multiplies the worst-case log volume of an uncapped line class -- BREAKS (LOW)

- **Scenario.** A pull request adds a large batch of malformed allowlist entries whose path and pattern id are long non-ASCII names, on a branch that also carries a blocking match. Every rejected entry prints one line, with no cap on how many, and each line is now up to an order of magnitude longer than before. The CI log for that job becomes large enough that the useful part -- the blocking match and its unlock -- is buried or truncated by the log viewer.
- **Evidence (demonstrated).** Real CLI, throwaway plumbing repositories.

```
1000 malformed entries, fields of 130 astral code points
  printed lines 1000 | stdout bytes 2,955,898 | longest line 2954 chars | 381 ms
1000 malformed entries, ASCII path and astral pattern id
  printed lines 1000 | stdout bytes 1,635,898 | longest line 1634 chars | 295 ms
allowlist-tool verify, 5000 invalid migrated entries
  printed lines 5033 | stdout bytes 889,246 | lines without the fixed prefix 0
per-field printed characters for the same 130-astral input
  round-3 printer 120 | round-4 printer up to 1440
```

- **Honest attribution.** The uncapped line COUNT is pre-existing: `rejectedDetails` has never had a cap, while `unlockDetails` in the same file caps at ten pairs. What this delta adds is the per-line factor -- roughly twelve times in the worst case, because a code point outside the safe set now costs up to twelve characters instead of one. Neither half is a correctness or security defect: the gate still fails, the exit code is still 1, and nothing raw reaches the log.
- **Current defense (honestly assessed).** The pull request diff shows the entries, and a reviewer approving a batch of malformed allowlist entries is the real control. There is no mechanical cap.
- **Exposure:** any pull request that edits `docs/qa/secret-scan-allowlist.json` with many malformed entries AND carries a blocking match; 0 of 50 tracked entries take the branch today, basis: counted in code by instrument.
- **Tags:** severity LOW / evidence demonstrated / reach operator / likelihood rare / undo reversible.
- **Minimal fix.** Give `rejectedDetails` the same ten-item cap and one summarising line that `unlockDetails` already uses. One block, copied from four functions above it.
- **Named failing proof-test:** none proposed; this belongs in the residual register or as a small follow-up, and the cap's shape is already tested for the sibling function.

## Attacks that SURVIVE (celebrated; every line is a command a reader can rerun)

### C1. F1, Issue 243: the rejected-entry line is inert in all three shells, for every hostile field including the reason. SURVIVES (demonstrated)

24 hostile allowlist entries through the real history-scan CLI in a throwaway plumbing repository -- command substitution, backticks, an ampersand, a semicolon, a pipe, even and odd double-quote parity, a PowerShell subexpression, a PowerShell at-paren, a raw newline crafted to forge a second rejection line, a bare carriage return, a NUL byte, a line separator, an ANSI control sequence, percent forms, an over-cap name, an astral code point at the cap, a lone surrogate at the cap, a percent at the cap, a backslash-quote pair, a non-string path, a non-string pattern id, empty strings and a null reason:

```
exit=1 | entries supplied 24 | REJECTED-ENTRY physical lines printed 24
lines in column zero (not the two-space dash prefix, not a bracketed status line): 0
rejected lines matching the strict single-line shape: 24 of 24
distinct reason classes printed: missing-path, missing-patternId, missing-reason, valueSha256-element-malformed
hostile REASON values echoed anywhere on stdout or stderr: 0 of 16
payload substring anywhere on stdout or stderr: NO
PASTE bash        raw and prefix-stripped   strays=0
PASTE cmd         raw and prefix-stripped   strays=0
PASTE powershell  raw and prefix-stripped   strays=0
CONTROL, the round-3 raw-echo shape: bash 9 of 24, cmd 2 of 24, powershell 7 of 24 executions
```

### C2. A hostile reason field is structurally unreachable, not merely encoded. SURVIVES (demonstrated and code-traced)

The reason printed on a rejected line is never the contributor's text. The loader stores the return value of the entry-rejection classifier, which is one of seven fixed class names, and the file-level path stores one of three fixed literals (both in `src/secret-scan/history-scan.ts`). Measured: 16 hostile reason strings supplied, 0 echoed, and only the four reachable class names appeared. This closes the half of the round-4 brief that asked about hostile reason values -- there is nothing to encode there, which is stronger than encoding it.

### C3. The clip helper cannot be smuggled past, split, or made to emit a partial escape. SURVIVES (demonstrated)

Direct property harness over the shipped exported function:

```
corpus rows (NUL, CR, LF, CRLF, DEL, U+2028, U+2029, NEL, VT, FF, lone high and low
  surrogates, two astral code points, literal percent, a percent followed by hex, backslash,
  both quote characters, an ANSI control sequence, a right-to-left override, a zero-width
  joiner, the empty string, a lone percent): 24 rows
  charset / line-split / well-formed-escape failures: 0
cap-boundary rows (astral exactly at code point 120, astral at 121, all-astral name, lone high
  surrogate at 120, lone low surrogate at 120, a surrogate pair straddling the cap, a percent at
  120, a percent at 121, a NUL at 120): 9 rows, 0 bad
  every row: partialEscape=false charset=true oneLine=true decodedCodePoints<=120 wellFormedUTF8=true
randomized fuzz over all planes including lone surrogates and NUL: 200,000 cases
  charset violations 0 | partial escapes 0 | cases over the 120-code-point cap 0
  longest printed field observed 1199 chars | max decoded code points 120
non-string and empty sentinel rows: 7, all print the lone percent, 0 failures
injectivity sample (short names, no surrogates): 20,000 cases, 0 collisions
```

The cap-edge question has a structural answer: truncation happens on code points BEFORE encoding, so a percent sign at the boundary can never be cut mid-escape, and a surrogate pair can never be split by the cap. A lone surrogate in the input folds to the replacement character encoding, which is lossy but shell-inert.

### C4. The file-level rejection carries no text from the file at all. SURVIVES (demonstrated)

Seven file shapes through the real CLI -- unparseable junk carrying a payload, a hostile JSON object, a hostile JSON string, a bare number, an array of non-objects, a 3000-entry array, and an allowlist path that is a directory:

```
every case: exit=1, file-level lines off their fixed three-class shape 0,
            lines in column zero 0, payload text on either stream NO, paste strays in 3 shells 0
the unreadable case prints exactly: REJECTED-ALLOWLIST-FILE: unreadable-or-missing
```

### C5. The NEW sink surface -- every allowlist-tool verify and generate line -- is inert in all three shells. SURVIVES (demonstrated)

19 hostile values used in seven entry roles at once (invalid entry, duplicate pair, no legacy pair, changed reason, unbacked hash, differs-from-scoped, and a fully VALID entry whose hostile pattern id reaches only the classification line), against a base commit whose tree also carries seven hostile file names so the still-matches class fires:

```
verify exit=1 | stdout lines 223 | lines without the tool fixed prefix 0 | payload on either stream NO
problem lines 217 | problem-line fields outside the safe character set 0
classification line 10,812 chars, body outside the safe character set 0
PASTE bash        all 223 lines, raw and prefix-stripped   strays=0
PASTE cmd         all 223 lines, raw and prefix-stripped   strays=0
PASTE powershell  all 223 lines, raw and prefix-stripped   strays=0
generate, hostile legacy including an invalid entry: exit=2, fixed message (index plus class), payload NO
generate, valid legacy with hostile pattern ids:     exit=0, 4 lines, 0 unprefixed, paste strays 0
verify, unparseable migrated file:  exit=2, fixed message, payload NO
verify, unparseable legacy at base: exit=2, fixed message, payload NO
verify, non-array migrated and non-array legacy: the fixed one-line problem, payload NO
verify, 5000 invalid entries: exit=1, 5033 lines, 0 unprefixed, payload NO
verify, missing migrated file: exit=2, the message names only the path the developer typed
```

### C6. Closing the verify sink was load-bearing, not cosmetic -- the old shape executed in bash, not only in cmd. SURVIVES (demonstrated)

The positive control I ran for round 4 is sharper than the round-3 one, because it also pastes each PHYSICAL line of a raw-echo string whose field held a newline:

```
old raw shape                      shell        whole string        per physical line
verify problem line                bash         0 of 9              1 of 13
verify problem line                cmd          1 of 9              2 of 13
verify problem line                powershell   0 of 9              1 of 13
verify classification line         bash         6 of 9              6 of 13
verify classification line         cmd          1 of 9              2 of 13
verify classification line         powershell   0 of 9              1 of 13
history-scan rejected line         bash         7 of 9              7 of 13
history-scan rejected line         cmd          1 of 9              3 of 13
history-scan rejected line         powershell   5 of 9              5 of 13
```

The problem lines wrap their fields in parentheses, which a POSIX shell rejects as a syntax error before anything expands -- so for those, cmd was the exposed shell. The classification line has no such accident, and it is the one new sink this round added: under the old raw echo it executed in six of nine hostile rows in bash. The newline rows also show the second-physical-line hazard the encoding removes.

### C7. The messages left raw are developer-typed and not reachable from file content. SURVIVES (code-traced)

Four messages in `src/secret-scan/allowlist-tool.ts` still interpolate their argument raw. Each argument comes from `process.argv` and nowhere else: the legacy-read helper names a module constant plus the value of `--base`; the unknown-pattern message in the hash-lines helper has exactly one caller, the hash subcommand, whose three values are positional argv; the not-in-commit and no-match messages of that same subcommand use the same two. No file content reaches any of them, which the missing-file run confirms -- the message named only the path I typed. Leaving them raw is the right call: a developer echoing an argument back at their own terminal is not a channel an attacker controls.

### C8. Mutation battery over the new and changed code and tests of this round: 37 mutants, 31 killed. SURVIVES (demonstrated)

Scratch clone at `ef21a94`, restored from git between mutants. Baselines: history-scan test file `tests 51 pass 51 fail 0 skipped 0 todo 0`; allowlist-tool test file `tests 15 pass 15 fail 0 skipped 0 todo 0`. A killed mutant raw count, sampled on W1: `tests 51 pass 50 fail 1 skipped 0`.

| Group | Mutants | Killed | Survived |
|---|---|---|---|
| clip behaviour (B1 to B8) | 8 | 6 | B3, B5 (finding R2) |
| the how-to constant, source only (C1, C2, W1 to W5) | 7 | 7 | 0 |
| whole-output classifier evasion (E1 to E5) | 5 | 5 | 0 |
| allowlist-tool sinks and fixed messages (A1 to A10) | 10 | 10 | 0 |
| the one-word export (X1) | 1 | 1 | 0 |
| both-files how-to edits (D1 to D6) | 6 | 2 | D1, D2, D4, D5 (finding R1; D1 is the designed control) |

The evasion group is the one I most expected to find a hole in, and did not. The match and ALLOWLISTED branch of the line classifier looked permissive on reading -- it accepts anything after the description separator -- but appending hand-quoting advice to either of those lines (E1, E2) is still killed, as is appending it to the no-command path line (E3), to an unlock constant (E4), and adding a brand-new printed advice line (E5). Every one of the ten allowlist-tool sink mutants dies, including both fixed-message mutants that would have re-exposed the file-quoting message the JSON parser produces.

### C9. F3: the rollback range is caret-free, counts the same in all three shells, and the revert lands the tree it claims. SURVIVES (demonstrated)

```
caret occurrences of the old range form in the ADR, the CHANGELOG and the plan: 0
range count, typed into each shell      bash 36   cmd 36   powershell 36
the OLD caret form, same three shells   bash 36   cmd 35   powershell 36   (the round-3 defect, reproduced)
the documented revert, run through cmd in a scratch clone: exit 0
  tree after the revert equals the tree at the named parent commit: IDENTICAL (empty diffstat)
  reverted-tree secret-scan test files: tests 61 pass 60 fail 1 skipped 0
  the single failure is a Windows teardown error (a busy temporary directory) in a test that
  clones a repository, triggered by my own four parallel mutation runs; re-run serially on the
  same tree: tests 13 pass 13 fail 0 skipped 0, exit 0
```

The ADR claim of 61 of 61 therefore stands; the one failure was environmental and reproducible only under concurrent load, which is worth knowing but is not a finding against this delta.

### C10. F4: the path-field claim on the how-to line is exactly right, and not overstated. SURVIVES (demonstrated)

Ten names, one allowlist entry built from each candidate spelling, re-scanned through the real CLI:

```
name                    no-command line   raw name    percent-decoded   git spelling   decoded is the key
a plain space           printed           UNBLOCKS    UNBLOCKS          UNBLOCKS       yes
command substitution    printed           UNBLOCKS    UNBLOCKS          UNBLOCKS       yes
backticks               printed           UNBLOCKS    UNBLOCKS          UNBLOCKS       yes
non-ASCII               printed           no          UNBLOCKS          UNBLOCKS       yes
a double quote          printed           no          UNBLOCKS          UNBLOCKS       yes
a backslash             printed           no          UNBLOCKS          UNBLOCKS       yes
a newline               printed           no          UNBLOCKS          UNBLOCKS       yes
a tab                   printed           no          UNBLOCKS          UNBLOCKS       yes
percent form            printed           UNBLOCKS    UNBLOCKS          UNBLOCKS       yes
astral                  printed           no          UNBLOCKS          UNBLOCKS       yes

the how-to claim (percent-decoded) unblocks 10 of 10; the raw name unblocks 4 of 10;
the decoded form equals the loader key 10 of 10
```

The sentence the delta added is true for every name tried and is the only spelling that works for all of them. It is not overstated: it says the decoded form IS the path field, which is exactly what the last column measures.

### C11. F5: the what-to-hash sentence is right for every pattern id, and every misreading fails closed. SURVIVES (demonstrated)

```
reading                                     unblocks
A  the whole regex match (the sentence)     10 of 10 pattern ids
B  the bare quoted literal only              8 of 10 -- fails exactly for the two the sentence names
C  the match plus its trailing newline       0 of 10
D  the whole source file                     0 of 10
pattern ids where a wrong reading unblocks anything reading A does not: 0
CRLF drill, the one pattern id whose match spans lines:
  hashed from the LF blob                   UNBLOCKS
  hashed from a CRLF working copy           still blocked (fail-closed)
  hashed from the match plus a newline      still blocked (fail-closed)
```

The two ids where the bare literal fails are exactly the two the sentence calls out, so the caveat is load-bearing and correctly placed. Nothing widens under any misreading.

### C12. The pre-commit path shares the same printer and is equally inert. SURVIVES (demonstrated)

The pre-commit scanner imports the same summarize and load helpers from `src/secret-scan/history-scan.ts`, so the encoding reaches the hook as well as CI. Confirmed end to end through the real pre-commit CLI: 6 hostile entries, exit 1, 6 rejected lines, 0 off their strict shape, 0 payload text on either stream, 0 paste strays across bash, cmd and PowerShell.

### C13. Independence of the round. SURVIVES (demonstrated)

```
diffstat from c0326d5 to HEAD for the twelve paths that should not have moved: EMPTY
  patterns.ts, pre-commit-scan.ts, simulated-commit.ts, pre-commit-scan.test.ts, ci.yml,
  the pre-commit hook, src/lib/git.ts, docs/STATE.md, docs/decisions.md, CLAUDE.md,
  docs/adr-cache.mjs, docs/qa/secret-scan-allowlist.json
removed lines in the delta test files (git diff -U0 on the test files): 0
the delta is seven files; the working tree carries only the untracked root file
[allowlist-tool generate] entries 50 (carried already-scoped 0), dropped 0, value hashes 108
cmp of the regenerated file against the tracked one: IDENTICAL (exit 0)
ADR frontmatter constraint lines 9, Rules-for-agents bullets 9, catalog served rules 9: parity YES
```

### C14. The real checks, with raw counts. SURVIVES (demonstrated)

```
npm test                 tests 944 pass 944 fail 0 skipped 0 todo 0   exit 0
npm run typecheck                                                     exit 0
npm run lint                                                          exit 0
npm run oss:secret-scan  PASS, full history scanned, 0 blocking
                         secret-shaped matches (1867 allowlisted)     exit 0
allowlist-tool verify --base 25291ff --migrated the tracked file
                         PASS, legacy 50, migrated 50, dropped 0, value hashes 108
                         occurrences allowlisted before 1535, after 1535
                         newly allowlisted 0, newly blocking 0        exit 0
                         classification figures unchanged from round 3
```

The classification figures are what round 3 measured, which is the check that the newly-applied encoder is the identity for every real pattern id and changed no reviewer-facing number.

### C15. Drill on the final tree: the hook-free bypass is still caught, and output discipline is unchanged. SURVIVES (demonstrated)

Fresh clone at `ef21a94`; a novel key-shaped literal built at runtime, committed with git plumbing so no hook of any kind runs:

```
history-scan exit=1
FAIL: 1 secret-shaped match(es) found in history (1867 allowlisted, not counted)
raw novel literal occurrences on stdout: 0
64-character hexadecimal strings on stdout: 0
raw novel literal occurrences in the generated report: 0
report matches 1868, carrying a hash 1867, not carrying one 1
unlock lines printed: 3
```

### C16. No machine consumer parses the lines this delta changed. SURVIVES (code-traced and demonstrated)

The classification-line builder has two callers, both of which only print it; nothing in `src/`, `docs/` or `.github/` parses the text of a classification, problem or rejected line except the shape assertions of the test suite itself. A grep over the repository for the literal prefix of the classification line returns the producing function, the tests, the ADR and review prose -- no parser.

## Residual-risk register (additions from this round; earlier rounds entries stand)

| Id | Residual | Trigger | Exposure |
|---|---|---|---|
| RR13 | The Issue 244 verbatim pin detects a change but cannot classify one; the content judgement is still the round-2 phrase blacklist, which misses escape, enclose and surround | a future edit to the how-to sentence that also updates the test constant | 3 of 5 rewordings survive a both-files edit (measured); 0 of 5 survive a one-file edit |
| RR14 | The 120-code-point cap and the empty-string sentinel are unpinned; both mutants pass green, with no security consequence measured | a refactor of the clip helper | the two named properties only (measured) |
| RR15 | Rejected-entry and problem lines have no cap on their number, while each line is now up to twelve times longer in the worst case | a pull request with many malformed allowlist entries on a branch that also has a blocking match | 0 of 50 tracked entries take the branch today (measured) |
| RR16 | A test that clones a repository fails on Windows with a busy-temporary-directory teardown error under concurrent load | running several test processes in parallel on the same machine | 1 of 61 secret-scan tests, reproducible only under my own parallel load; green serially (measured) |

## Editorial (uncounted, verdict-neutral, plain edits)

- The clip docstring says the encoding is applied exactly like a path in the no-command line, and that a non-string or empty value prints as a lone percent sign. Both are true. It does not mention that a lone surrogate in the input folds to the replacement character encoding, so two different lone surrogates print identically -- the same lone-surrogate qualification my round-2 editorial list raised against the injectivity claim of the encoder, now inherited by the clip. Unreachable from the output of git; a sentence to narrow, not a defect.
- The ADR residual row for a path outside the safe set now enumerates the encoded line classes and names the two that still print contributor-chosen text raw. The enumeration is complete against the shipped code as of this delta, which closes my round-3 editorial item on the same row.
- The round-four paragraph of Addendum 3 in the plan says the remaining raw echoes are the errors of the hash subcommand and the base ref in one error, found by grep of the tool output sites. Confirmed by reading: that is the complete set, and both are argv.

## The single scariest unproven assumption

That the next author who edits the no-command how-to sentence will read the comment above it rather than simply making the test agree with the source. The verbatim pin makes that edit visible in a diff; it does not make it fail. Three of the five wordings that reinstate exactly the advice a Manager ruling removed still go green through that door, and the guard that would catch them is three words short.

## Go / no-go and the single next action

**go.** All five round-3 findings are closed on executed evidence. F1 and the new verify sink are closed to a standard the positive control shows was needed -- the old shape executed a payload in bash, cmd and PowerShell, the new one in none of them across 24 rejected lines, 223 verify lines and 6 pre-commit lines. F3, F4 and F5 are closed and their doc claims measure exactly. Thirty-one of thirty-seven mutants die, including every sink mutant and every classifier-evasion attempt. The three findings this round adds are one MED remainder of an already-open Issue and two LOWs, none of which touches shipped behaviour that a user or a CI run depends on. No finding is HIGH, and nothing here forces a rework.

**Single next action:** add the three word stems escape, enclos and surround to the existing blacklist regex in `src/secret-scan/history-scan.test.ts`, and confirm it goes red under the both-files reword. It is the smallest change that closes the remainder of Issue 244, and it needs no new test.

## Persistence

- Report: this file. Review-log row appended in `docs/REVIEW_LOG.md`.
- Bug Issues: duplicate check run first over rejected entry, clip, allowlist tool, percent-encode, classification, how-to and log volume, plus the three story issue numbers. Issue 243 and Issue 244 are the existing round-3 Issues. R1 is the open remainder of Issue 244, so it is a comment there, not a second Issue for the same finding. R2 and R3 are LOW and file nothing. No new Issue was filed this round.
- Nothing pushed. No tracked file in the working tree was edited. Every scratch clone and throwaway repository lives outside the repository, and the untracked root file was never staged.

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] R1 the Issue 244 verbatim pin kills all five of my round-3 rewordings on a one-file edit, but three of five (escape, enclose, surround) still pass green when the source constant and the test constant are changed together, because the round-2 phrase blacklist behind it still lists no synonym for them; the two that die (quote, paste) die only by landing on a listed word; open remainder of Issue 244, three-word fix
2. [ISSUE][LOW][demonstrated] R2 two documented clip properties are unpinned and their mutants pass green at 51 pass 0 fail 0 skipped -- the 120 cap counted in code points (the ADR own wording) and the lone-percent sentinel for an EMPTY string; measured to have no security consequence (safe charset, one physical line, no partial escape all hold under both), while the security-relevant halves all kill their mutants
3. [ISSUE][LOW][demonstrated] R3 the new encoder raises the worst-case printed field from 120 to 1440 characters while the rejected-entry line class has no cap on its count (the sibling unlock class caps at ten): 1000 malformed entries print 1000 lines and 2.96 MB of stdout, verify with 5000 prints 5033 lines; the uncapped count is pre-existing, only the per-line factor is new
4. [CLEAN][demonstrated] C1 F1 and Issue 243 are closed: 24 hostile entries through the real CLI give 24 physical lines, 0 in column zero, 24 of 24 on the strict shape, 0 of 16 hostile reason values echoed, and 0 paste strays raw and prefix-stripped in bash, cmd and PowerShell, against a control that executes 9, 2 and 7 times
5. [CLEAN][demonstrated] C2 a hostile reason field is structurally unreachable, not merely encoded: the printed reason is one of seven loader-fixed entry classes or three file classes, and 16 hostile reason strings produced 0 echoes
6. [CLEAN][demonstrated] C3 the clip cannot be smuggled past, split or made to emit a partial escape: 24 corpus rows, 9 cap-boundary rows and 200,000 fuzz cases over all planes including lone surrogates and NUL give 0 charset violations, 0 partial escapes, 0 line splits and a maximum of 120 decoded code points, because truncation precedes encoding
7. [CLEAN][demonstrated] C4 the file-level rejection carries no file text at all across seven file shapes including a 3000-entry array and an allowlist path that is a directory: 0 off-shape lines, 0 column-zero lines, 0 paste strays
8. [CLEAN][demonstrated] C5 the new allowlist-tool sink surface is inert: 19 hostile values in seven entry roles give 223 verify lines, 0 without the fixed prefix, 0 fields outside the safe charset, 0 paste strays in three shells, plus clean generate, non-array, unparseable-legacy, unparseable-migrated, 5000-entry and missing-file runs
9. [CLEAN][demonstrated] C6 closing the verify sink was load-bearing: under the old raw shape the classification line executed in 6 of 9 hostile rows in bash and the rejected line in 7 of 9 bash and 5 of 9 PowerShell, and a field holding a newline put a second, pasteable physical line in column zero
10. [CLEAN][code-traced] C7 the four messages left raw are developer-typed and not file-reachable: each argument comes from process.argv only, the hash-lines helper has exactly one caller, and the missing-file run echoed only the path I typed
11. [CLEAN][demonstrated] C8 mutation battery over the new and changed code and tests of this round: 37 mutants, 31 killed, baselines 51 pass 0 fail 0 skipped and 15 pass 0 fail 0 skipped, sample killed mutant 50 pass 1 fail; every sink mutant, every fixed-message mutant, the one-word export and all five classifier-evasion mutants die
12. [CLEAN][demonstrated] C9 F3 is closed: the caret-free range counts 36 in bash, cmd and PowerShell while the old caret form counts 35 in cmd, and the documented revert run through cmd lands a tree byte-identical to the named parent, with the reverted-tree suite green on a serial re-run
13. [CLEAN][demonstrated] C10 F4 is closed and not overstated: the percent-decoded form unblocks 10 of 10 hostile and plain names and equals the loader key in 10 of 10, where the raw name works for only 4
14. [CLEAN][demonstrated] C11 F5 is closed: the recipe of the sentence unblocks 10 of 10 pattern ids, the bare literal fails exactly for the two the sentence names, trailing-newline and whole-file readings unblock 0 of 10, and a CRLF working copy fails closed
15. [CLEAN][demonstrated] C12 the pre-commit hook shares the same printer and is equally inert: 6 hostile entries, 6 lines, 0 off-shape, 0 paste strays in three shells
16. [CLEAN][demonstrated] C13 independence: empty diffstat for all twelve paths that should not have moved, 0 removed test lines, the allowlist byte-identical to a fresh generate at the story parent commit, and ADR parity 9 frontmatter to 9 body rules to 9 served
17. [CLEAN][demonstrated] C14 the real checks: 944 tests pass with 0 failed and 0 skipped, typecheck and lint clean, the gate PASSES with 0 blocking matches, and verify PASSES with 0 newly allowlisted and 0 newly blocking and classification figures unchanged from round 3
18. [CLEAN][demonstrated] C15 drill on the final tree: a hook-free plumbing-commit bypass is still caught, with 0 raw literal and 0 hexadecimal strings on stdout and exactly 1 of 1868 report matches carrying no hash
19. [CLEAN][code-traced] C16 no machine consumer parses any line this delta changed: the classification builder has two callers that only print, and nothing outside the shape assertions of the test suite reads that text
counts (CHECKSUM): issues=3 suspicions=0 clean=16
evidence (CHECKSUM): demonstrated=17 code-traced=2 derived=0
checks=npm test: tests 944 pass 944 fail 0 skipped 0 todo 0, exit 0; npm run typecheck exit 0; npm run lint exit 0; npm run oss:secret-scan PASS exit 0 (1867 allowlisted, 0 blocking); allowlist-tool verify --base 25291ff PASS exit 0 (50 of 50, 108 hashes, 0 newly allowlisted, 0 newly blocking); allowlist-tool generate at the story parent then cmp against the tracked file exit 0 IDENTICAL; scratch-clone baselines history-scan test file 51 pass 0 fail 0 skipped and allowlist-tool test file 15 pass 0 fail 0 skipped; 37-mutant battery 31 killed 6 survived (sample killed mutant 50 pass 1 fail 0 skipped); 24-entry hostile rejected-entry drill through the real CLI in bash, cmd and PowerShell; 7-shape file-level rejection drill; 19-value, 7-role hostile verify and generate drill (223 lines) in the same three shells; 3-shape, 9-row, 3-shell positive control on the round-3 raw echo; 200,000-case clip fuzz plus 24 corpus and 9 cap-boundary rows; 10-name path-field drill; 10-pattern-id what-to-hash drill with four readings each plus a CRLF drill; 6-entry pre-commit drill; 3-shell rollback-range probe plus a real revert in a scratch clone (reverted tree 61 tests, 60 pass, 1 environmental teardown failure, green on a serial re-run at 13 pass 0 fail); hook-free plumbing-commit bypass drill in a fresh clone
adr=HIT(37)
report=docs/reviews/s1-136-value-scoped-allowlist-red-team-round4-2026-09-20.md
