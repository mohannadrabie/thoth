# s1-136-value-scoped-allowlist: red-team round 3 (small targeted confirm of the Issue 241 batch), 2026-09-20

[red-team]
Red Team (Sutekh) -- attacking the Manager-ruled removal of the hand-quote instruction, its tests, and the round's doc wording (Story S-B2, Issues 136 and 203).

- Branch `fix/s1-136-value-scoped-allowlist` at `c0326d5`. Delta under attack `git diff 0ca15db HEAD` (six files). Base `25291ff`. Tier CRITICAL (Manager-ratified, not re-litigated).
- My round-2 verdict on this target was **go** with one new MED (Issue 241) and one LOW. This report does not edit that one; it re-attacks the fix the Manager ordered for it.
- Method: throwaway git-plumbing repositories and one scratch clone, all outside the repository. No tracked file in the working tree was edited; nothing was pushed; the untracked root file was never staged. Every hostile name and every payload was built at runtime inside the scratch scripts. No value, no hash, no secret-shaped literal and no working payload string appears in this report -- payloads are described, never written.
- ADR cache: HIT, reused 37 ADRs (devops 12, software-engineering 23, docs/adr 2), fingerprint b63f3ff. Rules read for this attack surface: THOTH-ADR-0002 (the artifact, amended again in this delta), THOTH-ADR-0001, devops ADR-0008 (ratchet-only suppression), SE ADR-0004, SE ADR-0005, SE ADR-0012, SE ADR-0021.
- Read in full before attacking: my round-2 report, the whole delta, `src/secret-scan/history-scan.ts`, the touched test file, `docs/adr/thoth-0002-value-scoped-secret-scan-allowlist.md`, `docs/plans/s1-136-value-scoped-allowlist-phase1-2026-09-19.md` and `CHANGELOG.md`.

## Verdict: go -- the ruled fix holds and measures better than the wording it replaced; two MED findings, neither on the delta's own behaviour

The removal is the right change and it is correct in a way the previous wording was not. The new how-to line is inert in bash, cmd and PowerShell; its recipe (the sha256 of the regex match text) is exactly right for every pattern id, including the two context-including ones; every misreading of it fails closed rather than granting something wrong; and its rename alternative actually works against a gate that walks history. My round-2 MED (Issue 241) is closed on the mechanism: there is no instruction to hand-carry a path anywhere.

Two things are worth a Manager decision. First, a different printed line class -- the rejected-entry line -- echoes a contributor-authored allowlist path raw, and pasting one executes a payload in all three shells. That line is new in this story (commit f77cd56), is untouched by this delta, and no prior round of any lane measured it: round 2 classified unlock, instrument and match-detail lines and never generated a rejected entry. Second, the new guard test that pins the Manager's ruling is a blacklist of phrasings rather than a property: five rewordings that reinstate exactly the instruction the ruling removed all pass green.

## Attacks, ranked by blast radius (exposure x irreversibility x silence)

### F1. A rejected allowlist entry's path is echoed raw, and pasting that line runs a payload in bash, cmd and PowerShell -- BREAKS (MED)

- **Scenario.** A contributor opens the pull request the ADR itself prescribes for an exemption ("adding a value to an entry MUST arrive in a pull request whose diff shows it"). They add an entry whose path field holds a command-substitution form and whose valueSha256 is deliberately malformed, so the loader rejects it. Their branch also carries any blocking match, so the gate takes the failing branch and prints the rejection diagnostic. The CI log now contains a line that spells the attacker's string verbatim. A maintainer triaging the red run copies the diagnostic line into a terminal to grep or to re-read it, and the command substitution runs before the shell ever complains that the first token is not a command.
- **Evidence (demonstrated).** Real `src/secret-scan/history-scan.ts` CLI, throwaway plumbing repository, seven hostile allowlist entries built at runtime, payload only writes a marker file into a scratch directory; every printed rejection line pasted raw and prefix-stripped into each shell:

```
exit=1 | allowlist entries supplied: 7 | REJECTED-ENTRY physical lines printed: 7
lines in column 0 (no two-space dash prefix): 0
PASTE bash        strays=1 ["MARK"]
PASTE cmd         strays=1 ["MARK"]
PASTE powershell  strays=1 ["MARK"]
```

The same isolation over the whole CLI output of a thirteen-pair run (twelve hostile tree entries plus one safe one, three rejected entries), each class pasted separately:

```
PASTE bash        class=HASH-COMMAND   strays=0
PASTE bash        class=NOCMD-HOWTO    strays=0
PASTE bash        class=NOCMD-PATH     strays=0
PASTE bash        class=OMITTED-PAIRS  strays=0
PASTE bash        class=UNLOCK-PROSE   strays=0
PASTE bash        class=INSTRUMENT     strays=0
PASTE bash        class=MATCH-DETAIL   strays=1
PASTE bash        class=REJECTED-ENTRY strays=1
(cmd and powershell: identical pattern, 0 for every unlock class, 1 for MATCH-DETAIL, 1 for REJECTED-ENTRY)
TOTAL strays across all shells and classes: 6
```

- **Honest attribution and novelty.** The `clip` and `rejectedDetails` functions do not exist at the base: the file at 25291ff contains neither, and a pickaxe search names commit f77cd56 (this story's feature commit) as their origin. They are NOT in this round's delta -- the delta touches them zero times -- so this is a finding against the story under review, not against the Issue 241 batch. Round 2's paste table covered four classes (unlock no-command, unlock prose, instrument, match-detail); it never constructed a rejected entry, so this class was never exercised.
- **Why it is worse than the already-disclosed match-detail sink.** The match-detail path comes from a tree listing without a NUL separator, so git C-quotes anything with a newline, a quote or a backslash. The rejected-entry path comes from JSON and gets no quoting at all: `clip` only replaces bytes below 32 and byte 127 with a question mark and truncates at 120 characters. A raw double quote, a backslash and an unbalanced bracket therefore reach the terminal verbatim, which git's own spelling would have neutralised.
- **Current defense (honestly assessed).** Partial. Control characters are stripped, so there is no line breakout: seven hostile entries produced seven physical lines, zero of them in column zero, and a path crafted to forge a second rejection line stayed inside its own line (the forged text is visible inline, which is a readability annoyance, not a breakout). Nothing else defends it: the line is not percent-encoded, and the story's own comment above the safe-set regex states the rule (a path is placed in a printed command only when no shell can give any character in it a meaning) for the unlock lines only. No printed line tells anyone to paste this one -- that is the whole reason it is MED and not HIGH.
- **Exposure: reachable on any pull request that edits `docs/qa/secret-scan-allowlist.json` (the ADR's prescribed unlock channel) and also carries a blocking match; 0 of the 50 entries in the tracked file take the branch today, basis: counted in code by instrument. The execution step needs a maintainer to paste a prose diagnostic, basis: assumption.** Security class, so PRINCIPLES rule 21's narrow-exposure cap does not apply; the severity is set by the mechanism and by the missing paste instruction, not by the count.
- **Tags:** severity MED / evidence demonstrated / reach user (maintainer workstation) / likelihood plausible / undo irreversible.
- **Minimal fix.** Percent-encode the `clip` output the same way the no-command line already encodes a path, or restrict `clip` to the safe set and show the rest encoded. The encoder already exists three functions above it; this is a one-line change and it makes the function's two line classes consistent.
- **Named failing proof-test:** `oss01-rejected-entry-line-never-carries-a-shell-metacharacter-from-the-allowlist-file` -- for an allowlist whose entries hold hostile path and pattern-id values, no printed rejected-entry line matches the suite's own metacharacter regex, and pasting every printed line into the platform shell produces no marker file. Red today.

### F2. The test that pins the Manager's ruling is a blacklist of phrasings, not a property: five rewordings of the removed instruction pass green -- BREAKS (MED)

- **Scenario.** A later change reintroduces the hazard the Manager ruled out, in different words -- escape the path for your shell, enclose the path in quotes, use the path exactly as shown on the detail line above -- or adds the advice on a line whose prefix the guard never reads. The suite stays green, the ruling silently lapses, and the next reviewer sees a passing test whose name promises the property is held.
- **Evidence (demonstrated).** Each mutant applied to the shipped source in a scratch clone at c0326d5, the touched test file run, then reverted.

```
BASELINE (unmutated clone)                                     tests pass 49 fail 0 skipped 0 exit 0
M1r restore the round-2 hand-quote instruction verbatim        killed   tests pass 47 fail 2 skipped 0
    killed by: sb2-unlock-command-never-embeds-a-shell-metacharacter-path,
               oss01-unlock-no-command-line-never-instructs-hand-quoting-or-pasting-a-path
W1  same advice, the word escape instead of quote              SURVIVED tests pass 49 fail 0 skipped 0
W2  same advice, the word enclose instead of wrap              SURVIVED tests pass 49 fail 0 skipped 0
W3  same advice, surround plus shell-quoting phrasing          SURVIVED tests pass 49 fail 0 skipped 0
W4  same advice on a NEW line prefix the guard does not read   SURVIVED tests pass 49 fail 0 skipped 0
W5  the advice points at the detail line, worded differently   SURVIVED tests pass 49 fail 0 skipped 0
```

- **Root of it, code-traced.** The guard's regex at `src/secret-scan/history-scan.test.ts:1340` enumerates the words quote, hand-quot, wrap-then-quotes, paste, copy-the-path, spelled-as, type-the-path and match-line. It lists no synonym for escape, enclose or surround. The offenders filter on the next lines keeps only lines beginning with the no-command, unlock or hash-command prefixes, so W4's new prefix is never examined. The line-level assertions that follow are positive (sha256, matched text, sha256 tool, rename, Issue 241) plus one negative on the old command string, all of which an appended sentence satisfies.
- **Current defense (honestly assessed).** Real but narrow. The verbatim old instruction is genuinely dead (M1r, killed by two tests), and the shipped text is correct today, so nothing is broken in the product. What is weak is only the regression guard for a Manager ruling -- exactly the artifact whose job is to survive the next author.
- **Exposure:** the whole future of this line; 5 of 5 rewordings I tried survive, basis: counted in code by instrument.
- **Tags:** severity MED / evidence demonstrated / reach operator / likelihood plausible / undo reversible.
- **Minimal fix.** Pin the sentence itself, not a vocabulary: assert the how-to line equals a constant declared beside the test, so any edit, benign or not, forces a reviewer to look; and widen the offenders filter from three prefixes to every printed detail line. One line each.
- **Named failing proof-test:** `oss01-unlock-no-command-line-is-pinned-verbatim-and-every-printed-line-is-checked` -- the how-to line equals its declared constant, and the hand-quoting check runs over all printed detail lines rather than three prefixes. Red under W1 to W5 today.

### F3. The rollback range this delta introduces silently reverts one commit too few in cmd -- BREAKS (LOW)

- **Scenario.** A release goes wrong, someone follows the ADR's rollback bullet on a Windows machine, and pastes the documented range into the default terminal. cmd treats the caret as its escape character, eats it, and git happily reverts four commits instead of five with exit 0 and no warning. The first story commit -- the red-first tests -- stays, so the tree is in a state the ADR explicitly says it is not.
- **Evidence (demonstrated).** Real repository, the same range string typed into each shell:

```
argv (no shell)          the documented range     -> 5 commits
argv (no shell)          the range minus a caret  -> 4 commits
typed into bash          stdout="5" exit=0
typed into cmd           stdout="4" exit=0   <-- silently one commit short
typed into powershell    stdout="5" exit=0
```

- **Attribution.** New in this delta. At 0ca15db the ADR, the CHANGELOG and the plan all wrote the range as two shas joined by the word "through"; this round turned it into a caret range in all three files.
- **Current defense (honestly assessed).** None. Exit code 0, no diagnostic, and the ADR's parenthetical "both ends included" reads as reassurance that it worked.
- **Exposure:** 1 of the 3 shells this project's own tests target, on the platform the repository is developed on, basis: measured.
- **Tags:** severity LOW / evidence demonstrated / reach operator / likelihood rare / undo reversible.
- **Minimal fix.** Write the inclusive range as two explicit endpoints, using the parent's own sha 7b62344 (confirmed by instrument to be the parent of fefce23) instead of the caret form.
- **Named failing proof-test:** none proposed; this is a documentation string with no runnable surface. It belongs in the residual register or as a plain edit.

### F4. The how-to hands over the hash but not the path, and this delta deleted the only sentence about path spelling -- BREAKS (LOW)

- **Scenario.** A developer is blocked on a file whose name needs quoting. They follow the new line, compute the sha256 of the matched text, and open the allowlist file to add the entry. The entry needs a path too. The gate prints that path percent-encoded on the line above and, on the match line, in git's own escaped spelling. Nothing says which of the two is the key the loader compares against, and the previous wording -- removed in this delta -- was the only place that mentioned path spelling at all.
- **Evidence (demonstrated).** Six hostile names, one entry built from each candidate spelling, re-scanned:

```
name                       true path (raw)  percent-decoded printed form  git-spelled detail form
plain space                UNBLOCKS         UNBLOCKS                      no
command-substitution form  UNBLOCKS         UNBLOCKS                      no
non-ASCII                  no               UNBLOCKS                      no
a double quote             no               UNBLOCKS                      no
a backslash                no               UNBLOCKS                      no
a newline                  no               UNBLOCKS                      no
```

- **Current defense (honestly assessed).** Better than it looks, and undisclosed. The percent-encoded form is a lossless encoding of the loader's actual map key: decoding it unblocks 6 of 6, including the four names where the raw name does NOT, because the key is git's escaped spelling for those. The no-command line even states the encoding (each two-hex group is one byte). So the unlock exists and never crosses a shell -- it is simply not named as the unlock anywhere.
- **Exposure:** every blocking match on a path outside the safe set; 1 of 374 tracked paths reaches that branch benignly today, basis: counted in code by instrument (the tracked-file list filtered by the safe-set regex).
- **Tags:** severity LOW / evidence demonstrated / reach operator / likelihood routine / undo reversible.
- **Minimal fix.** One clause on the existing no-command line: the percent-decoded form of the path shown here is the path value for the allowlist entry. No new tool, no new line.
- **Named failing proof-test:** folded into Issue 241's enhancement (a shell-safe channel); no separate one proposed.

### F5. The phrase "over the literal in your own file" is ambiguous for the two context-including patterns and for a CRLF working copy -- BREAKS (LOW)

- **Scenario.** A developer reads "the literal in your own file" narrowly and hashes only the quoted secret, not the whole assignment; or hashes a multi-line match from a working copy checked out with CRLF while the blob holds LF. Either way the entry they add does nothing and the gate stays red with no explanation of why their hash did not take.
- **Evidence (demonstrated).** Every pattern id, one entry per reading, re-scanned:

```
reading                                            unblocks
A  sha256 of the regex match text                  10 of 10 pattern ids
B  sha256 of the bare quoted literal                8 of 10 -- fails for the two context-including ids
C  sha256 of the match plus its trailing newline    0 of 10
D  sha256 of the whole source file                  0 of 10
non-ASCII value, hashed from the file's raw bytes   UNBLOCKS
multi-line match, hashed from the LF blob           UNBLOCKS
multi-line match, hashed from a CRLF working copy   still blocked
pattern ids where a wrong reading unblocks anything: 0
```

- **Current defense (honestly assessed).** The unlock prose line two lines above names both context-including pattern ids and says the match includes the key name, operator and quotes, so the caveat is on screen. More importantly the failure direction is right: every wrong reading costs a round trip and never blesses anything, measured at 0 widenings across the whole table.
- **Exposure:** the two context-including pattern ids; 0 of 108 blessed values use either today (the verify pattern breakdown), basis: measured.
- **Tags:** severity LOW / evidence demonstrated / reach operator / likelihood routine / undo reversible.
- **Minimal fix.** Three words on the how-to line pointing back at the unlock caveat. Or nothing -- it fails closed.
- **Named failing proof-test:** none proposed; the behaviour is correct and the residual is wording.

## Attacks that SURVIVE (celebrated; every line is a command a reader can rerun)

### C1. Every printed unlock line class is inert in all three shells, including the new how-to line. SURVIVES (demonstrated)

Thirteen pairs through the real CLI (twelve hostile tree entries built at runtime -- command substitution, backticks, an ampersand separator, a semicolon, a pipe, even and odd double-quote parity, a single-quote wrap, a PowerShell at-paren, a PowerShell sub-expression, a raw newline separator, a plain space, non-ASCII -- plus one safe path), with three rejected allowlist entries so every line class appears at once. Classes printed: one runnable hash command, nine no-command path lines, one no-command how-to line, one omitted-pairs line, two unlock prose lines, thirteen match-detail lines, three rejected-entry lines, two instrument lines. Each class pasted raw AND prefix-stripped into bash, cmd and PowerShell in a fresh scratch directory: strays 0 for every unlock class in every shell (full grid under F1). The new how-to line carries no shell metacharacter, its bracket expression is a glob in bash and inert elsewhere, and its first token is not a command.

### C2. The how-to's hash recipe is exactly right for all ten pattern ids, including the two context-including ones, and every wrong reading fails closed. SURVIVES (demonstrated)

See F5's table. The sha256 of the regex match text unblocks 10 of 10 pattern ids -- the six present in the tracked allowlist (aws-access-key-id, email-address, ipv4-private, github-fine-grained-pat, internal-hostname, github-pat) and the four that are not, including both context-including ones where the match text carries the key name, the operator and the quotes. The scanner's latin1 round trip means a sha256 tool run over the file's raw bytes is the right instrument even for a non-ASCII match (measured). No reading of the sentence grants anything wrong: 0 of 10 pattern ids admit a widening under any of the three misreadings tested.

### C3. The rename alternative works, and it works the right way against a gate that walks history. SURVIVES (demonstrated)

```
1a before the rename (hostile path only)      exit=1 runnable=0 no-command=1
1b after a PURE rename (identical blob)       exit=1 runnable=1 no-command=0
2  rename + edit (blob changes)               exit=1 runnable=1 no-command=1
3  copy, the hostile path still present       exit=1 runnable=0 no-command=1
```

A pure rename gives the runnable command, because the scanner dedupes by blob sha and walks commits newest-first, so the blob is attributed to the new safe path. A rename that also edits the blob leaves the old blob at the old path and keeps a no-command line -- the fail-closed direction, and the honest one. A copy that keeps the hostile path gets nothing, also correct. The advice is therefore true and not a trap.

### C4. The percent-encoded form is a lossless, shell-inert encoding of the loader's own map key. SURVIVES (demonstrated)

See F4's table: percent-decoding the printed form yields a working allowlist entry for 6 of 6 hostile names, including four where the raw name does not, because git's escaped spelling is the key. This is the one printed representation of a hostile path that is simultaneously safe to display and exact. It is a genuinely good property of the Issue 239 fix; F4 is only that nothing says so.

### C5. The one changed assertion is stricter, and exactly one existing test line moved. SURVIVES (demonstrated)

```
git diff -U0 0ca15db HEAD on the test files
  deleted lines (existing lines changed): 1
    the old positive assertion that the how-to line named the hash tool
  added lines: 88
  test files touched: 1  (src/secret-scan/history-scan.test.ts)
whole-branch test churn vs base 25291ff: 3 test files, 1459 insertions, 52 deletions
```

The single replaced assertion becomes two: a positive match on the new wording plus a negative-match assertion on the old command string. One assertion in, two out, and the new one is an anti-regression pin the old line did not have. Nothing was loosened. The eighty-eight added lines are the new guard test and the three code-reviewer pins.

### C6. Mutation battery on the delta's code: 17 applied, 17 killed, 0 survivors. SURVIVES (demonstrated)

Scratch clone at c0326d5, baseline `tests 49 pass 49 fail 0 skipped 0`. Each mutant applied to the shipped source (or, for the helper pin, to the helper the pin is about), the touched test file run, then reverted. Raw counts for the sample mutant M1r: `tests pass 47 fail 2 skipped 0`.

| Mutant | Result | Killed by |
|---|---|---|
| M1 restore the round-2 hand-quote instruction verbatim | killed | the metacharacter test and the new guard test |
| M2 the how-to also says to quote the path yourself | killed | the new guard test |
| M3 the how-to also says to paste the path | killed | the new guard test |
| M4 the how-to points at the match line | killed | the new guard test |
| M5 the how-to no longer names a sha256 tool | killed | both unlock tests |
| M6 the how-to drops the rename alternative | killed | the new guard test |
| M7 the how-to drops the Issue 241 pointer | killed | the new guard test |
| M8 the how-to drops what is hashed | killed | the new guard test |
| M9 the how-to line carries a shell metacharacter | killed | both unlock tests |
| M10 the whole how-to line is dropped | killed | three unlock tests |
| P1a the encoder drops the hex zero pad | killed | the new encoding pin |
| P1b the encoder iterates UTF-16 units, not code points | killed | the new encoding pin |
| P2 the unlock dedupe key drops the pattern id | killed | the new per-pattern pin |
| P3a the scanner's binary window narrows to 4000 | killed | the new binary-helper pin |
| P3b the test helper's window narrows to 4000 | killed | the same pin |
| S1 the safe set also allows a dollar | killed | the two Issue 239 tests |
| S2 the no-command line shows the raw path | killed | the two Issue 239 tests plus the encoding pin |

All three code-reviewer LOW pins are load-bearing, in both the shipped-code and the helper direction. The five surviving mutants are the wording variants under F2, which are a property of the guard's regex, not of the shipped behaviour.

### C7. Independence of the round. SURVIVES (demonstrated)

The diffstat from 0ca15db to HEAD is EMPTY for all fourteen paths that should not have moved: `src/secret-scan/patterns.ts`, `src/secret-scan/pre-commit-scan.ts`, `src/secret-scan/simulated-commit.ts`, `src/secret-scan/pre-commit-scan.test.ts`, `src/secret-scan/allowlist-tool.ts`, `.github/workflows/ci.yml`, `.githooks/pre-commit`, `src/lib/git.ts`, `docs/STATE.md`, `docs/decisions.md`, `CLAUDE.md`, `docs/adr-cache.mjs`, `docs/qa/secret-scan-allowlist.json`, `docs/reviews`. The whole delta is six files. The working tree carries only the untracked root file.

```
[allowlist-tool generate] entries written: 50 (carried already-scoped: 0), dropped as matching nothing: 0, value hashes: 108
cmp of the regenerated file against the tracked one -> IDENTICAL (exit 0)
[allowlist-tool verify] PASS (--base 25291ff) legacy 50, migrated 50, dropped 0, hashes 108
  occurrences allowlisted before 1535, after 1535; newly allowlisted 0; newly blocking 0   exit 0
```

### C8. Every doc claim this round moved is true by instrument. SURVIVES (demonstrated)

```
tracked paths at HEAD: 374 | outside the safe set: 1
the affected path: the space-bearing review file under the Claude outputs directory
ADR frontmatter constraint lines: 9 | body MUST bullets under Rules for agents: 9 | parity: 1:1
catalog served rules for THOTH-ADR-0002 in docs/.maat-state.json: 9
[allowlist-tool verify] blessed values by pattern: aws-access-key-id=12, email-address=23,
  github-fine-grained-pat=3, github-pat=2, internal-hostname=67, ipv4-private=1
[allowlist-tool verify] blessed credential-shaped values: 17
npm test: tests 941 pass 941 fail 0 skipped 0 todo 0
```

The ADR's new residual row names the right instance and the right denominator (1 of 374, the space-bearing path). The moved-base rule's figures (108 hashes, 17 credential-shaped) match verify. The ADR's crackable-hash row claim that neither context-including pattern is present is confirmed by the pattern breakdown. The unanchored-key row's 12 of 108 is confirmed. The CHANGELOG's 941 is exact, and it is now prose rather than a bare numeric rollback figure. The plan's honesty edit about the parity script (checked ad hoc during the round, not kept in the repo) is a correct downgrade of a claim I cannot otherwise reproduce.

### C9. Drills on the final tree: the hook-free bypass is still caught, and output discipline is unchanged. SURVIVES (demonstrated)

Fresh clone at c0326d5; a novel key-shaped literal built at runtime appended to a file that already holds a grant; committed with a plumbing commit, so no hook runs at all:

```
HEAD after the hook-free commit: c4091b4 (scratch clone only)
history-scan exit=1
[OSS-01 history-scan] FAIL: 1 secret-shaped match(es) found in history (1829 allowlisted, not counted).
raw-literal occurrences on scan stdout: 0
64-hex strings on scan stdout: 0
raw-literal occurrences in the generated report: 0
report matches: 1830 carrying a hash: 1829 not carrying one: 1
unlock lines printed: 3
```

The single blocking match is the single report entry without a hash, nothing hex reaches stdout, and the real repository's gate is green: PASS, full history scanned, 0 blocking secret-shaped matches found, 1822 allowlisted.

### C10. A hostile allowlist path cannot split a printed line or forge one in column zero. SURVIVES (demonstrated)

Seven hostile entries, including one crafted to forge a second rejection line and two with bare control bytes: seven entries produced seven physical lines, zero lines began in column zero, and the forged text stayed inside its own line. The clip helper replaces every byte below 32 and byte 127 with a question mark, and the instrument printer prefixes every detail with two spaces and a dash. The execution hazard in F1 is real; the log-integrity hazard is not.

## Residual-risk register (additions from this round; earlier rounds' entries stand)

| Id | Residual | Trigger | Exposure |
|---|---|---|---|
| RR9 | Rejected-entry lines echo a contributor-authored allowlist path and pattern id raw, while the sibling line class in the same function is percent-encoded | a pull request adding a malformed allowlist entry with a hostile path, on a branch that also has a blocking match | 0 of 50 tracked entries take the branch today (measured); one attacker-authored entry is the whole precondition |
| RR10 | The guard test for the Manager's Issue 241 ruling is a phrase blacklist; five rewordings that reinstate the instruction pass green | any future edit to the how-to line | the whole future of that line (measured, 5 of 5) |
| RR11 | The documented rollback range uses a caret, which cmd eats silently | a Windows rollback | 1 of 3 shells, measured |
| RR12 | The unlock needs a path as well as a hash; the percent-decoded printed form is the exact key, but no line says so | any blocking match on a path outside the safe set | 1 of 374 tracked paths reaches the branch benignly today, measured |

## Editorial (uncounted, verdict-neutral, plain edits)

- The ADR's new residual row says the percent-encoded form covers the unlock lines only, and that the blocking-match line above them still prints the path as git spells it. True, and it closes my round-2 editorial item -- but the row now enumerates the raw-path line classes and omits the rejected-entry one, which is the finding in F1. One clause would make the enumeration complete.
- The encoder's docstring gained a careful and correct caveat about cmd reading a percent-delimited name as a variable reference. It still calls the encoding injective without the lone-surrogate qualification from my round-2 editorial list; unreachable from git's output, so still a sentence to narrow rather than a defect.
- The ADR's trust-base row now says CLAUDE.md's sensitive-area glob for the scanner files matches no tracked file until Issue 234 lands. Confirmed by instrument: the glob in CLAUDE.md names a scripts-level prefix, and 0 tracked files start with it. Honest disclosure of a gap rather than a claim of protection.

## The single scariest unproven assumption

That a diagnostic line which is plainly not a command will never be pasted into a shell. That assumption now carries two line classes rather than one, and the newer of the two -- the rejected-entry line -- is the only place in this gate where a contributor-authored string reaches a terminal with no quoting of any kind applied to it, not even git's.

## Go / no-go and the single next action

**go.** The Manager's ruling is implemented correctly and measures better than the wording it replaced: inert in three shells, right for every pattern id, fail-closed under every misreading, with a rename alternative that actually works against a history walk, and seventeen of seventeen behaviour mutants dead. The two MED findings are on a line class this delta never touched and on the strength of a regression guard, not on the shipped behaviour of the fix. Neither forces a rework; both are filed with named failing tests.

**Single next action:** percent-encode the clip output in the rejected-entry line builder, with `oss01-rejected-entry-line-never-carries-a-shell-metacharacter-from-the-allowlist-file` written red first. It is the same one-line mechanism the Issue 239 fix already ships, applied to the one line class that was left out.

## Persistence

- Report: this file. Review-log row appended in `docs/REVIEW_LOG.md`.
- Bug Issues: duplicate check run first, over rejected-entry, allowlist path, shell, paste and quoting, plus the three story issue numbers. Issues 238, 239 and 241 are the existing unlock-line issues and none covers a rejected-entry line or the guard test's strength, so F1 and F2 are filed as new bugs at severity MED. Issue 241's remainder is not re-filed. F3, F4 and F5 are LOW and file nothing. Filed this round: Issue 243 for F1 and Issue 244 for F2, both labelled bug, severity-med and oss, milestone S1.
- Nothing pushed. No tracked file in the working tree was edited. Every scratch clone and throwaway repository lives outside the repository, and the untracked root file was never staged.

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] F1 a rejected allowlist entry's path and pattern id are echoed raw by the rejected-entry line class, so pasting one executes a payload in bash, cmd and PowerShell (1 marker file per shell, 7 hostile entries); new in this story at commit f77cd56, untouched by this delta, never exercised by any prior round's paste table, and not percent-encoded although the sibling line class in the same function is; Exposure: any pull request editing the allowlist (the ADR's own unlock channel) that also carries a blocking match, 0 of 50 tracked entries take the branch today, basis: counted-in-code, with the paste step basis: assumption (security class, rule 21 cap does not apply)
2. [ISSUE][MED][demonstrated] F2 the test pinning the Manager's Issue 241 ruling is a blacklist of eight phrases, not a property: five rewordings that reinstate exactly the removed instruction all pass at 49 pass 0 fail 0 skipped, including one on a line prefix the offenders filter never reads, while the verbatim old wording is correctly killed at 47 pass 2 fail
3. [ISSUE][LOW][demonstrated] F3 the caret rollback range this delta introduces into the ADR, the CHANGELOG and the plan is eaten by cmd on the project's own platform, reverting 4 commits instead of 5 with exit 0 and no diagnostic (bash 5, PowerShell 5, cmd 4)
4. [ISSUE][LOW][demonstrated] F4 the how-to yields the hash but the allowlist entry also needs the path, and this delta deleted the only sentence about path spelling; the percent-decoded printed form is the exact loader key (6 of 6 hostile names unblock, 4 of them where the raw name does not), but no printed line says so
5. [ISSUE][LOW][demonstrated] F5 the phrase "over the literal in your own file" is ambiguous for the two context-including pattern ids and for a CRLF working copy; measured fail-closed in every case (0 of 10 pattern ids admit a widening under any misreading), so it costs a round trip, never a wrong grant
6. [CLEAN][demonstrated] C1 every printed unlock line class is inert: 13 pairs through the real CLI, 8 line classes, each pasted raw and prefix-stripped into bash, cmd and PowerShell, 0 strays for the hash command, both no-command forms, the omitted-pairs line, the unlock prose and the instrument lines in all three shells
7. [CLEAN][demonstrated] C2 the how-to's recipe is exactly right for all ten pattern ids including the six in the allowlist and both context-including ones (10 of 10 unblock), and the scanner's latin1 round trip makes a byte-level sha256 tool the correct instrument even for a non-ASCII match
8. [CLEAN][demonstrated] C3 the rename alternative works and fails in the right direction: pure rename gives the runnable command, rename-plus-edit keeps the old blob blocked, a copy that keeps the hostile path gets nothing
9. [CLEAN][demonstrated] C4 the percent-encoded form is a lossless, shell-inert encoding of the loader's own map key -- decoding it produces a working entry for 6 of 6 hostile names, including the four git C-quotes where the raw name fails
10. [CLEAN][demonstrated] C5 exactly 1 existing test line changed in the delta (88 added, 1 file), and that assertion became two, adding a negative-match anti-regression pin: stricter, not weaker
11. [CLEAN][demonstrated] C6 mutation battery on the delta's code and the three new pins: 17 applied, 17 killed, 0 survivors, baseline 49 pass 0 fail 0 skipped and sample mutant 47 pass 2 fail
12. [CLEAN][demonstrated] C7 independence: empty diffstat for all 14 paths that should not have moved, 6-file delta, allowlist byte-identical to a fresh generate (cmp exit 0), verify PASS at base 25291ff with 0 newly allowlisted and 0 newly blocking
13. [CLEAN][demonstrated] C8 every doc claim this round moved is true by instrument: 1 of 374 tracked paths and the named one, ADR parity 9 frontmatter to 9 body MUSTs to 9 served in the catalog, 108 hashes and 17 credential-shaped, 12 of 108 unanchored, 0 of 108 context-including, 941 tests
14. [CLEAN][demonstrated] C9 drills on the final tree: a hook-free plumbing-commit bypass is still caught by the full-history scan, 0 raw literal on stdout and in the report, 0 hex on stdout, 1 of 1830 report matches without a hash
15. [CLEAN][demonstrated] C10 no log-line breakout from a hostile allowlist path: 7 entries gave 7 physical lines, 0 in column zero, and a path crafted to forge a second rejection line stayed inside its own line
counts (CHECKSUM): issues=5 suspicions=0 clean=10
evidence (CHECKSUM): demonstrated=15 code-traced=0 derived=0
checks=npm test (real repo): tests 941 pass 941 fail 0 skipped 0 todo 0, exit 0; npm run typecheck exit 0; npm run lint exit 0; npm run oss:secret-scan PASS exit 0 (1822 allowlisted, 0 blocking); allowlist-tool verify --base 25291ff PASS exit 0 (50 of 50, 108 hashes, 0 newly allowlisted, 0 newly blocking); allowlist-tool generate --base 7b62344 then cmp against the tracked file exit 0 IDENTICAL; touched test file in a scratch clone: tests 49 pass 49 fail 0 skipped 0; 17-mutant battery 17 killed 0 survivors (sample raw count, M1r: 47 pass 2 fail 0 skipped) plus a 5-mutant wording battery with 5 survivors at 49 pass 0 fail 0 skipped; 13-pair hostile-name drill through the real CLI with 8 printed line classes pasted raw and prefix-stripped into bash, cmd and PowerShell; 7-entry hostile-allowlist rejection drill in the same three shells; 10-pattern-id follow-the-how-to hash drill with four readings each; 6-name path-spelling drill; 3-case rename-against-history drill; hook-free plumbing-commit bypass drill in a fresh clone; three-shell rollback-range probe
adr=HIT(37)
report=docs/reviews/s1-136-value-scoped-allowlist-red-team-round3-2026-09-20.md
