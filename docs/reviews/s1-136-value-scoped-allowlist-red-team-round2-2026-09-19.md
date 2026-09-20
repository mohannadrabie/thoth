# s1-136-value-scoped-allowlist: red-team round 2 (targeted re-attack of the fix-now round), 2026-09-19

[red-team]
Red Team (Sutekh) -- re-attacking the FIXED value-scoped OSS-01 allowlist (Story S-B2, issues 136 and 203).

- Branch `fix/s1-136-value-scoped-allowlist` at `aa2f0c8`. Delta under attack `git diff 5156eff HEAD`. Tier CRITICAL (Manager-ratified, not re-litigated).
- My earlier verdict on this target was **no-go on F1** (HIGH, issue 239) plus four LOW findings. This report re-attacks the fix with a fresh attacker's eye; it does not edit that report.
- Method: throwaway `mkdtemp` repositories and one scratch clone, all outside the repository. No tracked file in the working tree was edited; nothing was pushed. Every attack literal and every payload was built at runtime inside the scratch scripts; none is reproduced here. No value, no hash, no secret-shaped literal and no working payload string appears in this report.
- `node docs/adr-cache.mjs --ensure`: `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] ... [CACHE=HIT]`. Rules read for this attack surface: THOTH-ADR-0002 (the artifact, now amended), THOTH-ADR-0001, devops ADR-0008 (ratchet-only suppression), devops ADR-0009, SE ADR-0004, SE ADR-0005, SE ADR-0012, SE ADR-0021.
- Read in full before attacking: my round-1 report, the plan's Addendum 2, the CHANGELOG entry, `src/secret-scan/history-scan.ts`, `src/secret-scan/allowlist-tool.ts`, both test files, and THOTH-ADR-0002.

## Verdict: go -- the HIGH is closed, demonstrated; one MED residual the fix introduces on its own replacement path

F1 is dead. A runnable command is now printed only for a path of `[A-Za-z0-9._/-]`; every other path gets a line that is not a command and shows the path percent-encoded. I threw 23 hostile names at the real CLI through git plumbing, pasted every printed unlock line raw and prefix-stripped into bash, cmd and PowerShell, and got zero payload executions, against an old-shape positive control that does execute. F2, F3, F4 and F5 are all resolved honestly, two of them with wording I can now reproduce with my own instrument rather than take on trust.

What is left is the seam the fix opened while closing the sink: for a path it refuses to put in a command, the gate tells the maintainer to quote the path themselves, spelled exactly as in the match line -- and the match line still prints that path raw, in every shell-active form. I could not find a quoting strategy that is safe for all of a small hostile set, including the single-quote advice a peer reviewer proposed as the fix. That is a MED, not a gate: there is no ready-to-paste command any more, and the maintainer has to build the command by hand for it to bite.

## Attacks, ranked by blast radius (exposure x irreversibility x silence)

### R1. The replacement path tells the maintainer to hand-quote an attacker-chosen string, and no quoting strategy is safe -- BREAKS (MED)

- **Scenario.** The gate blocks on a file whose name holds shell syntax. It refuses to print a command (correct) and prints instead: quote the path yourself for your shell and run the hash tool, using "the path spelled exactly as in the match line". The maintainer scrolls up to the match line, which prints the path RAW, copies it, wraps it the way the gate's own safe-path command shape models (double quotes), and pastes. Quote parity breaks and the name runs.
- **Evidence (demonstrated).** Real `history-scan.ts` CLI, throwaway plumbing repository, five hostile names built at runtime (substitution, backticks, an ampersand separator, odd double-quote parity, a single-quote wrap); payload only creates a marker file in a scratch directory; names and payload elided:

```
gate exit=1; match-detail lines=5; paths recovered from the match lines: 5
FOLLOW-THE-INSTRUCTION bash        as printed, no extra quoting                            payload executed for 3/5 paths
FOLLOW-THE-INSTRUCTION bash        wrapped in double quotes (the safe-path command shape)  payload executed for 4/5 paths
FOLLOW-THE-INSTRUCTION bash        wrapped in single quotes                                payload executed for 1/5 paths
FOLLOW-THE-INSTRUCTION cmd         as printed, no extra quoting                            payload executed for 2/5 paths
FOLLOW-THE-INSTRUCTION cmd         wrapped in double quotes (the safe-path command shape)  payload executed for 0/5 paths
FOLLOW-THE-INSTRUCTION cmd         wrapped in single quotes                                payload executed for 2/5 paths
FOLLOW-THE-INSTRUCTION powershell  as printed, no extra quoting                            payload executed for 1/5 paths
FOLLOW-THE-INSTRUCTION powershell  wrapped in double quotes (the safe-path command shape)  payload executed for 2/5 paths
FOLLOW-THE-INSTRUCTION powershell  wrapped in single quotes                                payload executed for 1/5 paths
```

  And, isolating which class of printed line is dangerous when pasted (six hostile names, whole CLI output, both raw and prefix-stripped, marker files counted in a scratch directory):

```
PASTE bash        class=UNLOCK-NOCOMMAND   stray files=0 []
PASTE bash        class=UNLOCK-PROSE       stray files=0 []
PASTE bash        class=INSTRUMENT         stray files=0 []
PASTE bash        class=MATCH-DETAIL       stray files=2 ["MARK","MARKb.txt"]
PASTE cmd         class=MATCH-DETAIL       stray files=2 ["MARK","MARKb.txt"]
PASTE powershell  class=MATCH-DETAIL       stray files=1 ["MARK"]
```

- **Honest attribution.** The raw-path sink itself is NOT new: the blocking-match detail line at `src/secret-scan/history-scan.ts:273` is byte-identical at `25291ff`, at `5156eff` and at `aa2f0c8`, and `git diff 5156eff HEAD` touches it zero times. What IS new in this delta is the instruction that points at it, `src/secret-scan/history-scan.ts:233-239`. Before the fix nobody was told to hand-carry that path into a shell; now everyone blocked on such a path is.
- **The advice is accurate but unhelpable.** Passing the path exactly as the match line spells it, as one argument, does resolve -- git's C-quoted spelling is the tool's own map key (4 of 4 hostile names resolved with exit 0, one hash line each; undoing the C-quoting by hand fails with a named error for 2 of 4). So the maintainer genuinely has to transfer git's own escaped spelling through their shell's quoting rules. There is no shell-safe channel in the output for them to use instead.
- **Current defense (honestly assessed).** Partial and human. The no-command line removes the one-keystroke path; the how-to line does not say which quoting is safe, and my measurement says no single answer is. A peer reviewer (app-security round 2) reached the same seam and rated it LOW with the remedy "give single-quote advice"; single-quoting still executed for 1 of my 5 names in bash, so that remedy does not close it.
- **Exposure: ~0.27% of paths -- 1 of 370 tracked paths and 1 of 370 distinct paths across the whole of HEAD history already falls outside the safe set (a plain space in the name), basis: counted in code by instrument. For the executing case, one attacker-authored file is the entire precondition.** Security class, so PRINCIPLES rule 21's narrow-exposure cap does not apply; the severity is MED on the mechanism, not on the exposure.
- **Tags:** severity MED / evidence demonstrated / reach user (maintainer workstation) / likelihood plausible / undo irreversible.
- **Minimal fix.** Give the reader a channel that never crosses a shell. The blob sha is already safe hex: print it on the no-command line and add a `hash-blob <blobSha> <patternId>` form to `allowlist-tool.ts` beside the existing `hash`. The how-to line then stops pointing at the match line at all. Roughly ten lines, no new surface, and it also removes the C-quoting trap issue 238 is about.
- **Named failing proof-test:** `oss01-unlock-no-command-line-offers-a-shell-safe-way-to-get-the-hash` -- for a blocked match whose path is outside the safe set, the printed output contains a runnable command made only of characters in the safe set that yields that blob's hashes, and no printed line instructs the reader to copy the path from the match line. Red today.

### R11. One real tracked path today already loses its runnable unlock command -- BREAKS (LOW)

- **Scenario.** The safe set excludes the space. One tracked file in this repository has a space in its name. A future blocking match in it gets the no-command line, so a maintainer meets the hand-quoting path above with zero attacker involvement. Before the fix that path's command worked: a space inside the double quotes the old shape used is harmless in all three shells.
- **Evidence (demonstrated).** Instrument over the real repository:

```
tracked paths at HEAD: 370 ; outside [A-Za-z0-9._/-]: 1
distinct paths across HEAD history: 370 ; outside the safe set: 1 ["Claude outputs/maat-review-2026-09-09.md"]
```

- **Current defense (honestly assessed).** The rule is disclosed in the ADR and the CHANGELOG; what is not disclosed anywhere is that an existing tracked path already takes the branch. That matters because it makes R1's workflow reachable today rather than hypothetical.
- **Exposure:** 1 of 370 tracked paths, basis: counted in code.
- **Tags:** severity LOW / evidence demonstrated / reach operator / likelihood routine / undo reversible.
- **Minimal fix.** R1's fix removes this as a side effect. Otherwise name the instance in the ADR residual row.
- **Named failing proof-test:** folded into R1's test; no separate one.

## Attacks that SURVIVE (celebrated; every line is a command a reader can rerun)

### R2. F1 is closed: no hostile path reaches a printed command, in any of the three shells. SURVIVES (demonstrated)

23 hostile names, built at runtime, committed as tree entries via git plumbing in three throwaway repositories (so a name a Windows filesystem refuses can still be a path), through the real `history-scan.ts` CLI: command substitution, backticks, a PowerShell at-paren, a curly-brace variable, append and input redirection, an ampersand separator, a raw newline separator, a carriage return, cmd percent-variable and double-percent forms, delayed-expansion bangs, odd double-quote parity, tab, a C0 control byte, delete, a non-ASCII letter, a bidi override, a Cyrillic look-alike, a zero-width space, a leading dash, a double dash, and a 4000-character name.

```
batch 0: exit=1 names=8 runnable=3 nocommand=5
batch 1: exit=1 names=8 runnable=0 nocommand=8
batch 2: exit=1 names=7 runnable=0 nocommand=7
total printed lines=64 runnable=3 nocommand=20 gitSpellings=23
runnable commands were printed only for these paths:
   --base.txt      -rf.txt      d/a{...}.md
no-command lines containing any shell metacharacter EXCLUDING percent: 0
column-0 breakout lines: 0
lines starting with a double colon: 0
PASTE bash: stray files = 2   PASTE cmd: stray files = 2   PASTE powershell: stray files = 1
CONTROL bash: OLD shape executed a payload for 3/23 git spellings
CONTROL powershell: OLD shape executed a payload for 1/23 git spellings
```

The three runnable commands are the three names entirely inside the safe set -- exactly the rule. The stray files in the paste row are R1's match-detail lines, isolated in the table under R1; the unlock lines themselves produced zero in all three shells. The positive control (the shape the old code printed, with git's own spelling) executes, so the harness is not blind. My cmd control shows 0 of 23 because of how my own harness re-quotes a command for `cmd.exe`, not because cmd is safe -- the shipped test's own control, which uses the platform shell directly, asserts a non-empty execution set and is green.

### R3. The percent encoding is injective and inert; a safe path keeps its command; a leading dash buys nothing. SURVIVES (demonstrated)

```
injectivity: 40000 random paths over a hostile alphabet, distinct displayed forms=27255, collisions=0
inertness: displayed paths outside [A-Za-z0-9._/%-] = 0
```

The alphabet included percent, dollar, backtick, both quote characters, space, semicolon, ampersand, pipe, angle brackets, parentheses, backslash, newline, carriage return, tab, a non-ASCII letter, a bidi override, a C0 control, delete, a zero-width space and a Cyrillic look-alike. A literal percent is itself encoded, so the map is one-to-one over anything git can hand it.

Leading-dash names get their command as designed and are harmless: `runHash` (`allowlist-tool.ts:316-331`) reads its three arguments positionally, node has already consumed its own arguments at the script path, and the path is looked up as an exact map key, never as a pathspec or a filesystem path. No option injection, no glob.

### R4. No log-line breakout and no CI workflow-command injection. SURVIVES (demonstrated)

The gate's only path source is `GitOps.lsTree`, which runs `git ls-tree -r` without `-z`, so git C-quotes anything dangerous. I checked that this holds under both settings of the one knob that could weaken it:

```
core.quotePath=true:  entries=6 physical lines=6 malformed lines=0 unquoted-yet-dangerous paths=0
core.quotePath=false: entries=6 physical lines=6 malformed lines=0 unquoted-yet-dangerous paths=0
```

(six entries: a newline, a double quote, a backslash, a non-ASCII letter, a bidi override, a C0 control byte). A path can therefore never split a printed line. Driving the two GitHub-Actions shapes straight through `summarizeMatches` (git refuses those names on Windows, so the tree route is unavailable):

```
workflow command   runnable=0 nocommand=1 extra-physical-lines=0 lines-starting-double-colon=0
stop-commands      runnable=0 nocommand=1 extra-physical-lines=0 lines-starting-double-colon=0
```

`printInstrumentResult` prefixes every detail with two spaces and a dash, so a colon-colon path is never in column zero even if git ever stopped quoting.

### R5. F2 is resolved, and the ADR's new wording is true beyond the test that pins it. SURVIVES (demonstrated)

My round-1 finding was that verify's newly-allowlisted counter looked unreachable, so the ADR's "shown by verify, not by prose" overstated it. The implementer's answer -- reachable, but never the only failure -- is pinned by a 200-case one-pair enumeration. I attacked that claim with a wider independent search: two pairs, duplicate legacy entries in both orders, duplicate migrated entries, and every mix of absent, legacy-shaped and value-scoped shapes.

```
cases=29120 widenings=5535 cases-where-the-widening-count-is-the-ONLY-problem=0
```

The property also holds by argument, not only by enumeration: a migrated entry that survives the structural checks sits on a legacy pair whose entry is either legacy-shaped (covers every match at that pair) or value-scoped with an identical hash list (covers the same matches), so a newly allowlisted occurrence is impossible without a structural problem firing. The ADR text, the plan's Addendum 2 and the code comment at `allowlist-tool.ts:267-271` all say exactly this. My round-1 surviving mutant is now killed (see R10).

### R6. F3 is resolved and the ADR residual now matches the instrument. SURVIVES (demonstrated)

```
HEAD history at aa2f0c8: distinct blobs=1042 scanned=1041 skippedAsBinary=1
occurrences found in the scanned blobs: 1744
  SKIPPED path=docs/spikes/s1-136-value-triples-2026-09-19.mjs bytes=6141 -> with the skip lifted: matches=0 {}
```

One blob, its content measured clean with the skip lifted, exactly as the ADR's rewritten residual row now states -- including that the assurance covers the index and not older commits, and that history is not rewritten. The ENOENT half is fixed the right way: `trackedFilesSkippedAsBinary` reads every blob from the object database in one `git cat-file --batch`, so an unstaged deletion cannot change the answer, and `sb2-no-tracked-text-file-is-skipped-as-binary-tolerates-an-unstaged-deletion` pins it against a plumbing repository that has no working-tree files at all.

### R7. F4 and F5 became residual rows and a type comment; both are honest. SURVIVES (demonstrated)

```
real allowlist: entries=50 distinct (path,patternId) pairs=50 duplicates=0
entries with a valueSha256 list: 50 ; total hashes: 108
loadAllowlist: 24 grep hits under src/, 6 outside test files (1 declaration, 1 doc line, 2 live calls, 2 import/comment)
summarizeMatches: 33 grep hits under src/, 8 outside test files (1 declaration, 2 doc lines, 2 live calls, 3 import/comment)
```

Exactly two live call sites, both passing the loaded object straight through, which is what the ADR row and the `LoadedAllowlist` comment claim. The F4 row's direction is right too: a duplicate cannot bless a value it does not list, so the loader's union is the narrower behavior. The call-site lists were generated by `git grep`, not hand-typed.

### R8. Independence of the fix round. SURVIVES (demonstrated)

`git diff --stat 5156eff HEAD` is EMPTY for all twelve paths that should not have moved: `src/secret-scan/patterns.ts`, `pre-commit-scan.ts`, `simulated-commit.ts`, `pre-commit-scan.test.ts`, `.github/workflows/ci.yml`, `.githooks/pre-commit`, `src/lib/git.ts`, `docs/STATE.md`, `docs/decisions.md`, `CLAUDE.md`, `docs/adr-cache.mjs`, `docs/qa/secret-scan-allowlist.json`. The whole delta is eight files.

The allowlist is unchanged and still exactly what the tool produces:

```
[allowlist-tool generate] entries written: 50 (carried already-scoped: 0), dropped as matching nothing: 0, value hashes: 108
cmp regen.json docs/qa/secret-scan-allowlist.json -> IDENTICAL (exit 0)
[allowlist-tool verify] PASS (--base 7b62344) legacy 50, migrated 50, dropped 0, hashes 108; before 1540, after 1540; newly allowlisted 0; newly blocking 0   exit 0
```

### R9. The end-to-end drills on the final tree, and hash exposure. SURVIVES (demonstrated)

Real installed pre-commit hook, fresh clone at `aa2f0c8` with `core.hooksPath` set exactly as the prepare script sets it, a novel key-shaped literal (built at runtime) appended to a file that already holds a grant:

```
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) found in history (274 allowlisted, not counted). Values redacted below.
  - HASH-COMMAND for src/secret-scan/patterns.test.ts [aws-access-key-id]: node src/secret-scan/allowlist-tool.ts hash <commit12> "src/secret-scan/patterns.test.ts" aws-access-key-id
HEAD after: aa2f0c8 (nothing landed)
```

Commit-tree drill (no hook runs at all), then the full-history scan on the bypassed commit:

```
HEAD now: de74dc0 (rt2 bypass)
history-scan exit=1
[OSS-01 history-scan] FAIL: 1 secret-shaped match(es) found in history (1756 allowlisted, not counted).
raw-literal occurrences on scan stdout: 0
raw-literal occurrences in the uploaded report: 0
report matches: 1757 carrying a hash: 1756 not carrying one: 1
entries at the blocked pair carrying a hash: 4 of 5
64-hex strings on scan stdout: 0
```

Hash exposure is unchanged by this delta: the single blocking match is the single report entry without a hash, every allowlisted one keeps its hash, and nothing hex reaches stdout. On the real repository the gate is green: `[OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (1744 allowlisted).`

### R10. Mutation battery on the new and changed code: 14 of 14 killed. SURVIVES (demonstrated)

Baseline over the two touched test files in a scratch clone: `tests 59 pass 59 fail 0 skipped 0`. Each mutant applied to the shipped source, run, then reverted.

| Mutant | Result |
|---|---|
| N1 the safe set also allows a dollar | killed (`tests 59 pass 57 fail 2 skipped 0`) |
| N2 the safe set also allows a double quote | killed by the same two tests |
| N3 the path safety test is dropped (only pattern id and commit checked) | killed by the same two tests |
| N4 the no-command line shows the raw path instead of the encoded one | killed by the same two tests |
| N5 the encoder leaves a literal percent alone (not injective) | killed by `sb2-unlock-command-never-embeds-a-shell-metacharacter-path` |
| N6 the cap is nine, not ten | killed by `sb2-unlock-command-lists-ten-pairs-then-counts-the-rest` |
| N7 the cap is eleven, not ten | killed by the same test |
| N8 the omitted-pairs count line is dropped | killed by the same test |
| N9 the how-to line for a quoted path is dropped | killed by the two unlock tests |
| N10 verify drops the newly-allowlisted (widening) check | killed by `sb2-verify-counts-and-names-a-widening` -- my round-1 survivor, now dead |
| N11 generate reads history at HEAD, not at the base ref | killed by `sb2-generator-and-verify-scope-history-and-legacy-file-to-the-base-ref` |
| N12 generate reads the legacy allowlist at HEAD, not at the base ref | killed by the same test |
| N13 verify reads history at HEAD, not at the base ref | killed by the same test |
| N14 the hash subcommand prints only the first match of the blob | killed by `sb2-hash-command-prints-one-line-per-match-in-a-blob` |

No survivors. Every LOW pin the fix round added is load-bearing, including both directions of the cap.

## Residual-risk register (additions from this round; round 1's RR1 to RR6 stand)

| Id | Residual | Trigger | Exposure |
|---|---|---|---|
| RR7 | The no-command path asks the maintainer to hand-quote an attacker-chosen string taken from a line that prints it raw; no quoting strategy is safe for every name | any blocking match on a path outside the safe set | 1 of 370 tracked paths reaches the branch benignly today (measured); the executing case needs an attacker-authored name (R1) |
| RR8 | A path with a plain space loses its runnable unlock command, which the old shape handled correctly inside its double quotes | as above | 1 of 370 tracked paths, measured (R11) |

## Editorial (uncounted, verdict-neutral, plain edits)

- `percentEncode`'s docstring calls the encoding injective without qualification. Two distinct lone surrogates both display as the replacement character's three bytes. Unreachable from git's output (a path is already decoded before it gets there), so this is a sentence to narrow, not a defect to fix.
- THOTH-ADR-0002's new sentence "any other path gets a line that is not a command, with the path percent-encoded" is true of the unlock lines and only of them; the match line above still prints the path raw. One clause would make the residual table's coverage honest.
- The ADR's binary-skip residual row says "one blob ... by instrument" without naming the denominator; my instrument says 1 of 1042 distinct history blobs. Naming it costs four words.

## The single scariest unproven assumption

That a maintainer handed an unsafe-looking path will stop rather than improvise. The gate now refuses to hand them a loaded command, which is the right change, but its replacement sentence is an instruction to do by hand the exact thing the code just declined to do. Everything else in this story is content-addressed, fail-closed and independently reproducible.

## Go / no-go and the single next action

**go.** The HIGH that forced my round-1 no-go is closed with demonstrated evidence in all three shells, with a positive control, and with four mutants proving the guard is pinned. F2, F3, F4 and F5 are resolved, and two of them are now claims I can reproduce with my own instrument rather than take on trust. R1 is a MED on new text, not a gate: there is no pasteable command any more, and the failure needs a human to build one. It is filed and carries a named failing test.

**Single next action:** add the shell-safe hash channel (a `hash-blob` form plus the blob sha on the no-command line) with `oss01-unlock-no-command-line-offers-a-shell-safe-way-to-get-the-hash` written red first; it closes R1, R11 and the symptom behind issue 238 in one change.

## Persistence

- Report: this file. Review-log row appended in `docs/REVIEW_LOG.md`.
- Bug Issues: duplicate check run first (`gh issue list --search` on unlock, quoting, shell, and on the three story issue numbers). Issue 238 is the C-quoting usability defect and issue 239 is the closed HIGH; neither covers the hand-quoting instruction, so R1 is filed as a new bug at severity MED with the `oss` label and the S1 milestone. R11 is LOW and files nothing.
- Nothing pushed. No tracked file in the working tree was edited. Every scratch clone and throwaway repository lives outside the repository, and the untracked root `prompt` file was never staged.

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] R1 the new no-command path tells the maintainer to quote an attacker-chosen path themselves, spelled as in the match line, and the match line still prints it raw; every quoting strategy I tried executes a payload for at least one hostile name in at least one shell (bash 3/5, 4/5, 1/5; cmd 2/5, 0/5, 2/5; PowerShell 1/5, 2/5, 1/5), and the sink line itself is pre-existing and untouched while the instruction pointing at it is new; Exposure: ~0.27% of paths, 1 of 370 tracked and 1 of 370 history paths already take the branch, basis: counted-in-code, one attacker-authored name is the whole precondition for execution (security class, rule 21 cap does not apply)
2. [ISSUE][LOW][demonstrated] R11 one real tracked path (a plain space in the name) now loses its runnable unlock command, which the old double-quoted shape handled correctly; disclosed as a rule, but the existing instance is named nowhere
3. [CLEAN][demonstrated] R2 F1 is closed: 23 hostile names through the real CLI in plumbing repositories, every printed unlock line pasted raw and prefix-stripped into bash, cmd and PowerShell, zero payloads; runnable commands printed only for the three fully safe names; old-shape positive control executes, so the harness is not blind
4. [CLEAN][demonstrated] R3 the percent encoding is injective (0 collisions over 40000 random hostile paths, 27255 distinct forms) and inert (0 displayed characters outside the safe-plus-percent set); a leading-dash or double-dash name gains no argument injection, since the hash subcommand parses positionally and looks the path up as an exact map key
5. [CLEAN][demonstrated] R4 no line breakout and no CI workflow-command injection: git's ls-tree quoting holds under both core.quotePath settings (6 hostile entries, 6 physical lines, 0 unquoted-yet-dangerous), and the two-space detail prefix keeps a colon-colon path out of column zero
6. [CLEAN][demonstrated] R5 F2 resolved: my own wider enumeration (two pairs, duplicate legacy and migrated entries, 29120 cases) found 5535 widenings and 0 where the widening count is the only problem, so the ADR, plan and code comment now say something true; the round-1 surviving mutant is killed
7. [CLEAN][demonstrated] R6 F3 resolved: 1 of 1042 distinct history blobs is still skipped as binary and its content is clean with the skip lifted (0 matches), exactly as the rewritten ADR residual states; the ENOENT case reads blobs from the object database and is pinned by a named test
8. [CLEAN][demonstrated] R7 F4 and F5 wording is honest: 50 entries, 50 distinct pairs, 0 duplicates, 108 hashes, and exactly two live call sites, both passing the loaded object straight through, with the call-site list generated by git grep rather than hand-typed
9. [CLEAN][demonstrated] R8 independence: empty diffstat for all twelve paths that should not have moved, the allowlist byte-identical to a fresh generate at the declared base (cmp exit 0), verify PASS with 0 newly allowlisted and 0 newly blocking
10. [CLEAN][demonstrated] R9 drills on the final tree: the real installed hook blocks and nothing lands; a commit-tree hook bypass is still caught by the full-history scan; hash exposure unchanged (the one blocking match is the one report entry without a hash, 0 hex on stdout, 0 raw literal anywhere)
11. [CLEAN][demonstrated] R10 mutation battery on the new and changed code: 14 of 14 killed, 0 survivors, including both directions of the ten-pair cap and all three base-ref scoping mutants
counts (CHECKSUM): issues=2 suspicions=0 clean=9
evidence (CHECKSUM): demonstrated=11 code-traced=0 derived=0
checks=npm test (real install): tests 937 pass 937 fail 0 skipped 0 todo 0, exit 0; npm run typecheck exit 0; npm run lint exit 0; npm run oss:secret-scan PASS exit 0 (1744 allowlisted, 0 blocking); allowlist-tool verify --base 7b62344 PASS exit 0; cmp of a freshly generated allowlist against the tracked file exit 0; touched test files in a scratch clone: tests 59 pass 59 fail 0 skipped 0; 14-mutant battery 14 killed 0 survivors (sample raw count, mutant N1: tests 59 pass 57 fail 2 skipped 0); 23-name hostile drill through the real CLI in three plumbing repositories with every printed line pasted into bash, cmd and PowerShell plus an old-shape positive control; 5-name follow-the-instruction drill across three quoting strategies and three shells; 40000-path encoding injectivity and inertness probe; 29120-case independent verify enumeration; 1042-blob history binary-skip instrument; real installed pre-commit hook drill and commit-tree bypass drill in a fresh clone; git ls-tree quoting probe under both core.quotePath settings
adr=HIT(37)
report=docs/reviews/s1-136-value-scoped-allowlist-red-team-round2-2026-09-19.md
