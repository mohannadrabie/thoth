# s1-136-value-scoped-allowlist: red-team (post-build), 2026-09-19

[red-team]
Red Team (Sutekh) -- attacking the BUILT value-scoped OSS-01 allowlist (Story S-B2, issues 136 and 203).

- Branch `fix/s1-136-value-scoped-allowlist` at 46e8d88. Diff under review `git diff 25291ff HEAD`. Tier CRITICAL (Manager-ratified, not re-litigated).
- Method: scratch clones and `mkdtemp` throwaway repositories outside the repository. No tracked file in the working tree was edited; nothing was pushed. Every attack literal was built at runtime inside the scratch scripts; none is reproduced here. No value, no hash and no secret-shaped literal appears in this report.
- `node docs/adr-cache.mjs --ensure`: `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] ... [CACHE=HIT]`. Rules read for this attack surface: THOTH-ADR-0002 (proposed, the artifact under attack), THOTH-ADR-0001 (precedent), devops ADR-0008 (CI/CD gates and policy-as-code, ratchet-only suppression), devops ADR-0009 (secrets in IaC), SE ADR-0004 (idempotency), SE ADR-0005 (testing strategy), SE ADR-0012 (data integrity), SE ADR-0021 (evidence trail).
- Prior round read in full: `docs/reviews/s1-136-value-scoped-allowlist-design-challenger-2026-09-19.md` (verdict go). Its frozen set is re-tested against the built code below, not re-argued.

## Verdict: no-go -- one demonstrated security-class defect in new code; everything else survives

The story's central claim holds under every attack I could run. An entry now exempts a match only when path, pattern id and the sha256 of the matched bytes all agree; the migration launders nothing; the 108 blessed values classify cleanly with exactly one declared exception. The block is a single new line in the unlock message that interpolates a repository path into a double-quoted shell command: a contributor-chosen file name containing a command substitution executes on the maintainer's machine when the printed command is pasted. Demonstrated end to end. The fix is small and local.

## Attacks, ranked by blast radius (exposure x irreversibility x silence)

### F1. The new unlock message turns an attacker-chosen file name into shell code on the maintainer's machine -- BREAKS

- **Scenario.** This repository is being prepared to go public, which is the whole reason OSS-01 exists. A drive-by contributor opens a pull request adding a plausible-looking file whose NAME contains a shell command substitution, and whose CONTENT carries any secret-shaped literal (a credential-shaped fixture is the natural cover story). The gate does exactly what it was designed to do: it blocks, and -- per PRINCIPLES rule 2 -- it names the unlock, printing a per-pair `HASH-COMMAND` with the match path interpolated inside double quotes. The maintainer copies that line into a shell to compute the hash. Both shells this project uses expand a command substitution inside double quotes, so the file name runs as code.
- **Evidence (demonstrated).** Real `history-scan.ts` CLI, throwaway repository, file name built at runtime as a harmless `echo` substitution (the name itself is elided here as `<NAME>`):

```
gate exit: 1
printed unlock line: "... HASH-COMMAND for <NAME> [aws-access-key-id]: node src/secret-scan/allowlist-tool.ts hash <commit12> \"<NAME>\" aws-access-key-id"
pasted into bash ->  "src/secret-scan/allowlist-tool.ts hash <commit12> RT-INJECTED.md aws-access-key-id"
powershell expansion of the same quoted path -> "RT-INJECTED.md"
```

  The substitution executed and its output replaced the path in both shells. Code: `src/secret-scan/history-scan.ts:191` (the interpolation), reached from `summarizeMatches` on every blocking run, which is both the CI entry point (`.github/workflows/ci.yml`, the OSS-01 full-history step) and the installed pre-commit hook (`src/secret-scan/pre-commit-scan.ts`).
- **Why git's own quoting does not save it.** `makeGitOps.lsTree` runs `git ls-tree -r` without `-z` (`src/lib/git.ts:98`), so git applies `core.quotePath` (unset here, default on) and C-quotes non-printable and non-ASCII bytes. Dollar, backtick, parenthesis and semicolon are printable ASCII: git passes them through unquoted. So terminal-escape injection is closed and shell injection is open -- the opposite of what the double quotes suggest.
- **Relationship to the already-filed issue 238.** Issue 238 names this same printed command, but as a usability defect ("names a path key that is not in the commit and exits non-zero; the developer has to compute the hash by hand"), labelled enhancement / severity low. That description is not what I measured. A path git does NOT quote is the dangerous case, and it is absent from that issue. I did not file a duplicate; I escalated issue 238 with this evidence instead. The built code makes that issue materially worse than its own text says: before this diff `summarizeMatches` printed no command at all (`git show 25291ff:src/secret-scan/history-scan.ts` has no unlock lines).
- **Current defense (honestly assessed).** None. The path goes straight into the string. `clip()` exists in the same file and sanitises control characters, but it is applied only to rejected-entry output, never to the unlock line.
- **Exposure: ~0% of runs today, 0 of 368 tracked paths contain a shell metacharacter, basis: counted in code (`git ls-files` against a metacharacter class). One attacker-authored file is the entire precondition, and the gate itself delivers the payload.** Security class, so PRINCIPLES rule 21's narrow-exposure cap does not apply.
- **Tags:** severity HIGH / evidence demonstrated / reach user (maintainer workstation) / likelihood plausible / undo irreversible (arbitrary code already ran).
- **Minimal fix.** Print the command only when the path matches a conservative safe set (`[A-Za-z0-9._/-]+`); for anything else print the path on its own line and tell the reader to pass it as an argument by hand. Three lines, fail-closed, no new surface.
- **Named failing proof-test:** `oss01-unlock-command-never-interpolates-shell-metacharacters-from-a-path` -- for a blocked match whose path contains a command substitution, a backtick and a semicolon, the printed `HASH-COMMAND`, executed verbatim in both bash and PowerShell against a sentinel, must produce no substitution (or no command line at all). Red today.

### F2. The verify mode's non-widening counter is inert -- the ADR's proof of "no widening" is structural, not empirical -- BREAKS (low)

- **Scenario.** THOTH-ADR-0002's Rules for agents say the migrated set being a subset of the old one is "shown by the generator's verify mode, not by prose". A future maintainer trusts that sentence, changes the migration, and reads a PASS. The counter that reads like the empirical proof cannot fail.
- **Evidence (demonstrated).** Mutation battery, scratch clone, named tests only (39 tests):

```
M11  verify drops the newly-allowlisted (widening) check : tests=39 pass=39 fail=0   *** SURVIVING MUTANT ***
M11b verify drops BOTH widening and unbacked checks      : tests=39 pass=37 fail=2
M12  verify drops the unbacked-hash check                : tests=39 pass=37 fail=2
M14  verify drops the no-legacy-pair check               : tests=39 pass=38 fail=1
M15  verify drops the reason-changed check               : tests=39 pass=38 fail=1
```

  The test named for the widened set is killed by the unbacked-hash check alone. Code: `src/secret-scan/allowlist-tool.ts:267`. Reading the surrounding checks, the widening counter appears unreachable-nonzero by construction: a migrated entry on a pair with no legacy entry is already a problem, a legacy pair with no hash list covers every match at that pair, and a narrower already-scoped legacy entry is already caught by the differs-from-an-already-value-scoped-legacy-entry check.
- **Current defense (honestly assessed).** The property itself HOLDS -- I proved it with my own instrument, not the tool's (see C3). What does not hold is the ADR sentence's implication that verify empirically demonstrates it.
- **Exposure:** 1 of 8 checks inside the verify function, basis: counted in code; 0 runtime effect today.
- **Tags:** severity LOW / evidence demonstrated / reach instrument / likelihood routine / undo reversible.
- **Minimal fix.** Either delete the counter and say in the ADR that non-widening is structural (every migrated entry sits on a legacy pair, which IS checked), or construct the case it is meant to catch and pin it. Do not leave a check nobody can make fail.
- **Named failing proof-test:** `sb2-verify-widening-counter-is-load-bearing-or-absent` -- either a crafted migrated file drives the widening counter above zero and verify fails, or the counter is gone. Red today under M11.

### F3. The "no skipped text file" assurance reads the HEAD tree; the gate reads history, and one of this story's own blobs is still skipped there -- BREAKS (low)

- **Scenario.** THOTH-ADR-0002's residual table says a test now asserts no tracked text file is skipped as binary, "so this story's own artifacts cannot hide that way". The test derives its file list from the git index, while the gate walks every blob reachable from HEAD. A file committed with a NUL byte and fixed in a later commit stays permanently unscanned and permanently invisible to the assurance test. This story did exactly that: its spike was committed with raw NUL separators and repaired in fb2b4ce.
- **Evidence (demonstrated).** Independent instrument mirroring the scanner's own rule, over the scratch clone at 46e8d88:

```
HEAD-tree:    blobs=365  skippedAsBinary=0
HEAD-history: blobs=1022 skippedAsBinary=1
   skip: docs/spikes/s1-136-value-triples-2026-09-19.mjs
```

  Code: `src/secret-scan/history-scan.test.ts:1097` (an index read) versus `src/secret-scan/history-scan.ts:88` (the history walk).
- **Current defense (honestly assessed).** The skipped blob's own content carries no secret-shaped match (measured by the prior round, reproduced here: my full-history scan over 1022 blobs finds 1665 occurrences and 108 distinct triples, unchanged from the base). Today's exposure is nil; the defect is that the claim is broader than the instrument.
- **Exposure:** 1 of 1022 history blobs (0.1%), basis: counted in code; 0 secret-shaped matches inside it, measured. The underlying NUL-skip is issue 237, out of scope and not re-filed.
- **Tags:** severity LOW / evidence demonstrated / reach instrument / likelihood routine / undo reversible.
- **Minimal fix.** Either widen the test's file list to history (the same commit-and-tree walk the gate uses), or narrow the ADR residual's sentence to say the check covers the current tree only.
- **Named failing proof-test:** `sb2-no-blob-in-history-is-skipped-as-binary` -- over every blob reachable from HEAD, the count skipped by the binary heuristic outside a named list is zero. Red today with exactly one file.

### F4. The loader honours duplicate entries for one pair and unions their hash lists; the generator refuses them -- BREAKS (low)

- **Scenario.** Two entries for the same path and pattern id, one reviewed and one slipped in beside it, both take effect: the partition function merges their hash sets. A reviewer counting entries, or reading the entry they expect to be authoritative, does not see the second. The generator throws on exactly this input, and verify reports it as a problem -- so the two halves of one mechanism disagree about whether a duplicate pair is legal.
- **Evidence (demonstrated).** Loader table against the real loader, scratch fixture files:

```
control: one good entry                    honored=1 rejected=0
duplicate entries for one pair (union?)    honored=2 rejected=0 reasons=[]
```

  Code: `src/secret-scan/history-scan.ts:146-151` (the union) versus `src/secret-scan/allowlist-tool.ts:74` (the generator's refusal) and `src/secret-scan/allowlist-tool.ts:218` (verify's report).
- **Current defense (honestly assessed).** Value scoping bounds the damage: a duplicate cannot bless a value that is not hashed in it, and the pull request diff shows both entries. The real allowlist has zero duplicate pairs (measured: 50 entries, 50 distinct pairs).
- **Exposure:** 0 of 50 entries today, basis: measured.
- **Tags:** severity LOW / evidence demonstrated / reach operator / likelihood plausible / undo reversible.
- **Minimal fix.** Reject the second entry for a pair in the loader and name it in the rejected list, matching what the generator already does.
- **Named failing proof-test:** `sb2-duplicate-pair-entry-is-rejected-and-named` -- an allowlist with two entries for one path and pattern id honours one and names the other in the blocking output. Red today.

### F5. The rejected-entry diagnostic is lost by any array copy, and never shown on a passing run -- BREAKS (low)

- **Scenario.** The loaded allowlist is an array type intersected with a rejected property. Any caller that filters, spreads or maps the array silently drops that property, and the rejection reporter then reports nothing -- the failure mode the diagnostic exists to prevent. Separately, the clean branch of the summariser never emits rejections at all, so an allowlist with a malformed entry whose pair no longer matches is invisible.
- **Evidence (demonstrated).**

```
summarize with the loaded object   : 1 REJECTED line(s)
summarize after a .filter() copy   : 0 REJECTED line(s)
summarize after a spread copy      : 0 REJECTED line(s)
rejection surfaced when NOTHING blocks: 0 REJECTED line(s) (ok= true )
```

  Code: `src/secret-scan/history-scan.ts:136` (the intersection type), `:198` (the ride-along read), `:213-219` (the clean branch, which emits none).
- **Current defense (honestly assessed).** Both live callers pass the loaded object straight through (`src/secret-scan/history-scan.ts:307`, `src/secret-scan/pre-commit-scan.ts:57`), so nothing is lost today. Spoofing is not possible from the file: a JSON array cannot carry a property, so the rejected list can never be forged by an allowlist author. The fail-closed direction is preserved in every case -- a rejected entry's matches still block.
- **Exposure:** 0 of 2 live call sites today, basis: counted in code.
- **Tags:** severity LOW / evidence demonstrated / reach instrument / likelihood plausible / undo reversible.
- **Minimal fix.** Return a record of entries and rejections instead of an intersection type, or thread the rejections explicitly into the summariser; and emit them on the clean branch too.
- **Named failing proof-test:** `sb2-rejected-entries-survive-a-caller-copy-and-a-clean-run` -- rejections are named after a filter round trip and on a run with zero blocking matches. Red today.

## Attacks that SURVIVE (celebrated; every line is a command a reader can rerun)

### C1. The central claim, end to end through three real entry points. SURVIVES (demonstrated)

Issue 136's positive control, inverted, against the real history-scan CLI in throwaway repositories (literals built at runtime):

```
D1a granted-only in granted file:           exit=0 (expect 0)
D1b novel value in the SAME granted file:   exit=1 (expect non-zero) leaks=false
D1c novel value in an ungranted file:       exit=1 (expect non-zero)
D1d legacy whole-file entry:                exit=1 (expect non-zero) namesRejection=true
```

And against the REAL INSTALLED pre-commit hook, in a fresh clone of this repository at 46e8d88 with the hooks path set exactly as the prepare script sets it, a novel key-shaped literal appended to a file that already holds a grant:

```
REAL HOOK: git commit exit=1
[Path B pre-commit-scan] FAIL: 1 secret-shaped match(es) found in history (274 allowlisted, not counted). Values redacted below.
  - UNLOCK: a real secret is rotated and removed from the tree, never allowlisted...
  - HASH-COMMAND for src/secret-scan/patterns.test.ts [aws-access-key-id]: ...
HEAD after: 46e8d88 (nothing landed)
raw-literal occurrences on hook stdout: 0
```

The commit-tree drill (no hook runs at all) confirms the second layer holds:

```
HEAD now: 1b09c0c bypass
history-scan exit=1
[OSS-01 history-scan] FAIL: 1 secret-shaped match(es) found in history (1677 allowlisted, not counted).
raw-literal occurrences in scan stdout: 0
raw-literal occurrences in the uploaded report: 0
```

A hook bypass buys nothing: the CI full-history step catches it, and neither layer prints the literal.

### C2. Attack E, both halves, and the honesty of the stated residual. SURVIVES (demonstrated)

```
D2a Attack E legacy-shaped report grant: exit=1 (blocks)
D2b Attack E self-hashed report grant:   exit=0 (STATED RESIDUAL: passes the gate)
```

The Manager's Q1 reading is exactly right and the ADR says so in its own words. A legacy-shaped whole-file grant on a dated report is refused by the loader; a grant carrying the literal's own correct hash passes the gate, and what catches it is the reviewed-baseline guard for an OMITTED pin plus the pull request diff. The test that pins this carries a comment saying, in terms, that it does not claim the gate blocks a deliberate self-hashed grant. No overclaim anywhere.

### C3. The migration launders nothing. SURVIVES (demonstrated, with my own instrument)

Independent comparison of the legacy file at 25291ff against the migrated file at HEAD, over my own re-implementation of the scanner's scope (not the generator's verify):

```
legacy entries=50 migrated entries=50 duplicatePairsInMigrated=0
legacy entries already value-scoped=0
NEW (path,patternId) pairs present in migrated but absent from legacy: 0
legacy pairs dropped from migrated: 0
migrated entries whose reason text differs from legacy: 0
scope 25291ff: distinctTriples=108 occ=1535 | hashes backed=108 unbacked=0 | allowlisted legacy=1535 migrated=1535 NEWLY-ALLOWLISTED=0 newly-blocking=0
scope HEAD:    distinctTriples=108 occ=1665 | hashes backed=108 unbacked=0 | allowlisted legacy=1665 migrated=1665 NEWLY-ALLOWLISTED=0 newly-blocking=0
```

No value is newly allowlisted, no path is widened, no reason was altered, and every one of the 108 hashes is backed by a real match at both the base and HEAD. The shipped tool agrees with my instrument to the digit at both declared bases:

```
[allowlist-tool verify] PASS  (--base 25291ff)  legacy 50, migrated 50, dropped 0, hashes 108; before 1535, after 1535; newly allowlisted 0; newly blocking 0
[allowlist-tool verify] PASS  (--base 7b62344)  legacy 50, migrated 50, dropped 0, hashes 108; before 1540, after 1540; newly allowlisted 0; newly blocking 0
```

The allowlist file's diff is 208 insertions and 0 deletions -- an append-only, line-per-hash shape a reviewer can actually read.

### C4. Independent classification of all 108 blessed values. SURVIVES (demonstrated); the ADR's named exception is honest and complete

Required by the Manager, done with my own scanner harness that keeps the matched text in memory, resolves each blessed hash back to its match over the scanner's own scope at HEAD, and classifies it. **Counts only below; no value, hash, host name, address or literal is reproduced.** All 108 hashes resolved (unresolved at ref: 0).

| Class | Count |
|---|---|
| Synthetic fixture, credential-shaped (sequential alphabet or digit runs, fake-marked literals, regex-overlap test fixtures; each confirmed from its surrounding code with the value masked out) | 16 |
| Real-credential-derived, credential-shaped: a truncated identifier segment and its separator, secret segment absent | 1 |
| Reserved-domain example address | 17 |
| Documented placeholder or throwaway test-identity address, and fake-token URL userinfo shapes | 6 |
| Documentation-range private IPv4 | 1 |
| Generic-label internal-looking host name (18 distinct labels, every one a textbook documentation example; none resolves to anything belonging to this project or its author) | 67 |
| **Total** | **108** |

By pattern id, matching the shipped tool's own counts exactly: aws-access-key-id 12, email-address 23, github-fine-grained-pat 3, github-pat 2, internal-hostname 67, ipv4-private 1.

- **The one real-credential-derived value: CONFIRMED, not refuted.** Grouping the 17 credential-shaped hashes by value gives 8 distinct values; 7 are synthetic and one is not. Its length is exactly the fine-grained-token prefix plus a 22-character identifier segment plus the separator, with no secret segment, and the surrounding text in its file describes it as a live credential read out of a local tool configuration. It is blessed at exactly **one** path, so the ADR's "one named exception" is accurate as a count, not only as a claim.
- **The ADR wording is honest.** THOTH-ADR-0002's Rules for agents say "usable credential (a value that authenticates)" and its Named exception section describes this value with the same shape I measured (truncated prefix, identifier segment and separator, secret segment absent), names issue 89 as the open rotation call, and routes the accept-or-rotate decision to the human at the pull request. It is also pinned in the reviewed baseline (`src/secret-scan/history-scan.test.ts:364`) with a reason that says the same thing. Nothing is hidden inside 108 hashes.
- **No undeclared value needs justification.** Every value my automatic classifier could not settle (6 of 108) I resolved by reading its surrounding context with the value itself masked out; all six resolved to synthetic fixtures, a throwaway test identity, or a documented lab line. I flag nothing by path and pattern.

### C5. Loader hostile input and the fail-open hunt. SURVIVES (demonstrated)

Loader table against the real loader (21 hostile files). Every malformed shape fails closed:

```
uppercase hex / whitespace-padded / trailing newline / non-string element / nested-array element -> rejected (valueSha256-element-malformed)
empty list -> valueSha256-empty ; string not list / null -> valueSha256-not-a-list ; entry is an array -> not-an-object
BOM-prefixed file / not JSON -> not-valid-json ; object not array -> not-an-array ; null entry -> not-an-object (neighbours survive)
prototype-pollution keys inside an entry -> honored=1 (the good entry only; grants nothing extra)
unknown extra keys -> honored (unchanged behaviour, which is what keeps the code-only rollback claim true)
huge list (100k hashes) -> honored, no degradation ; path containing a NUL -> honored but can never collide with a real key
```

The NUL case deserves a word: the partition function joins path and pattern id with a NUL, so in principle an entry could straddle the separator. It cannot in practice -- a git path never contains a NUL and no catalog pattern id does, so a match's key is always unambiguous. Fail-closed.

Fail-open hunt against the real CLI, throwaway repositories:

```
path form 'docs/reviews/r.md'             -> exit 0 (granted)
path form with capitalised directories    -> exit 1 (case does not launder)
path form with backslash separators       -> exit 1 (separators do not launder)
path form with a leading dot-slash        -> exit 1
path form with a dot-dot round trip       -> exit 1
rename: granted file moved to an ungranted path -> exit 1 (fail-closed)
dedupe: copy at a LATER-sorting path      -> exit 0 (the disclosed residual)
dedupe: copy at an EARLIER-sorting path   -> exit 1 (over-blocks; the safe direction)
dedupe: differing copy with a novel value -> exit 1
```

The one exemption is the residual the ADR already discloses, and it carries no value that was not already granted at the original path. Re-measured at HEAD with my own instrument: **235 blobs carry a match; 0 of them appear at more than one path**, so the residual has no instance in this repository today.

### C6. Output discipline: no hash or raw text of a blocking match escapes. SURVIVES (demonstrated)

```
A5 exit=1 blockedHashInStdout=false blockedHashInReport=false grantedHashInReport=true rawValueAnywhere=false
A5 64-hex strings in the report: 1; all are the granted value's hash: true
```

Exactly one hash reaches the CI-uploaded report and it belongs to the allowlisted value, which is already in clear text in a tracked file. The prior round's A5 finding is closed by the built code. The allowlist tool is equally disciplined under hostile input -- every bad invocation exits 2 with a named message and prints no hash and no value:

```
args=[hash]                                   exit=2 hexLines=0 :: hash needs <commit> <path> <patternId>
args=[hash HEAD nope.txt aws-access-key-id]   exit=2 hexLines=0 :: nope.txt is not in HEAD
args=[hash HEAD README.md no-such-pattern]    exit=2 hexLines=0 :: unknown pattern id no-such-pattern
args=[verify] / [generate] / [bogus] / []     exit=2 hexLines=0 :: named usage errors
args=[verify --base HEAD --migrated <absent>] exit=2 hexLines=0 :: ENOENT, named
```

The hash subcommand does print the hash of a blocked value -- that is its entire purpose, it runs on the developer's own machine, and the gate never does. Consistent with the ADR.

### C7. Hash parity between the history scan and the simulated pre-commit tree. SURVIVES (demonstrated)

Both paths call one function on the same blob bytes, and the built code behaves that way: the same literal, hashed once from the file's own bytes and added to an entry, is accepted by both entry points in the same repository (pre-commit exit 0, history exit 0), and both print the same path-and-pattern pair in the unlock line when it is absent. A CRLF-terminated line does not split them. The design round's frozen item S1 survives contact with the built code.

### C8. Mutation battery against the new tests. SURVIVES (demonstrated); 12 of 13 mutants killed

Baseline: the named sb2 and oss01 tests over the three test files -- `tests 35 pass 35 fail 0 skipped 0`. With the broader pattern including the issue 203 guard test, 39 tests. Each mutant applied to the shipped source in a scratch clone, then reverted:

| Mutant | Result |
|---|---|
| M1 partition ignores the value hash (revert to path-plus-pattern) | killed, 8 tests red |
| M2 loader honours an entry with no hash list | killed, 12 red |
| M3 loader accepts uppercase hex | killed, 3 red |
| M4 loader accepts an empty hash list | killed, 2 red |
| M5 report keeps the hash of blocking matches | killed, 1 red |
| M6 unlock prints no hash command | killed, 1 red |
| M7 rejected entries never named | killed, 2 red |
| M8 hash computed over a different decoding | killed, 1 red |
| M9 baseline guard re-excludes the reports directory (issue 203 reverted) | killed, 2 red |
| M10 generator widens an already-scoped entry | killed, 1 red |
| M11 verify drops the widening check | **SURVIVES** (see F2) |
| M12 verify drops the unbacked-hash check | killed, 2 red |
| M13 generator classification output leaks a hash | killed, 2 red |

The core mutant M1 -- reverting the whole story -- is killed by eight named tests. That is the property that matters most, and it is well pinned.

### C9. Issue 203 is fully closed at the code level. SURVIVES (code-traced)

The path-prefix exclusion is gone, not narrowed: the derivation at `src/secret-scan/history-scan.test.ts:260` now filters on credential-shaped pattern id alone, with no path test of any kind, where the base revision carried an immutable-report-prefix skip. Seven dated-report grants are pinned in the reviewed baseline, each with its own written reason. Because the derivation has no path filter at all, the obvious evasion -- registering the grant under a differently-cased or differently-spelled report path -- gains nothing: any credential-shaped grant anywhere is in the checked set. A repository-wide grep finds no remaining prefix exclusion in the guard.

### C10. Scope boundaries and the story's own artifacts. SURVIVES (demonstrated)

- `git diff --stat 25291ff HEAD` over `src/secret-scan/pre-commit-scan.ts`, `src/secret-scan/simulated-commit.ts`, `src/secret-scan/patterns.ts` and the hooks directory is **empty**. The three out-of-scope issues (236, 237, 238) are untouched by the diff; only issue 238's severity is misstated relative to the built code, which is F1 and is routed there by comment, not by a duplicate.
- The story's own committed artifacts trip nothing: at HEAD the full-history scan finds 1665 occurrences, all allowlisted, 0 blocking, and the distinct-triple count is still 108 -- the plan, ADR, spike, tests, CHANGELOG and prior report added no new triple. The real history-scan CLI on the real repository exits 0.
- The dropped permanent round-trip test (removed in 62b95b2) unpins nothing material: the real repository against the real allowlist is still pinned in-process by the dogfood test (`src/secret-scan/history-scan.test.ts:115`), the real file's zero-rejection load is pinned by its own named test, the CLI entry point is pinned by two subprocess tests on throwaway repositories, and CI runs the history scan on every push (`.github/workflows/ci.yml:258`). The only lost composition is the one CI itself performs.

## Frozen set from the prior round: re-tested against the built code

| Prior item | Status against the build |
|---|---|
| S1 hash boundary and scan-path parity | holds (C7) |
| S2 path keying and blob dedupe | holds; the residual re-measured at 0 of 235 (C5) |
| S3 loader fail-closed table | holds; the shipped loader reproduces the prototype table (C5) |
| S4 issue 203 reading and baseline-guard claims | holds (C2, C9) |
| S5 consumer and dependency list | holds; no new reader outside the named files |
| S6 sequencing and the story's own text | holds; 108 triples stable (C10) |
| S7 rollback claim (old loader reads the new file) | holds; unknown keys still accepted (C5) |

Nothing in the frozen set is reversed by the built code.

## Residual-risk register (accepted, monitored, trigger stated)

| Id | Residual | Trigger | Exposure |
|---|---|---|---|
| RR1 | A self-hashed grant on a new dated report passes the gate; the baseline guard catches only an omitted pin | any pull request adding a grant and its pin together | the diff and the reason are the review, as the ADR states |
| RR2 | A byte-identical copy of a granted file at a later-sorting path is exempt under its own path | a second path holding a matched blob | 0 of 235 matched blobs today, measured |
| RR3 | The hash binds the regex match, so truncating patterns vouch for a prefix of a longer real name | a granted host name or address that is a prefix of a longer real one | 68 of 108 triples use truncating patterns, counted |
| RR4 | The one real-credential-derived blessed value (issue 89 open) | the human's ratification of THOTH-ADR-0002 | 1 of 108, measured independently (C4) |
| RR5 | A NUL byte in a blob's first bytes hides it from the gate, permanently once committed | any commit of a NUL-bearing text file | issue 237, out of scope; 1 of 1022 history blobs today, content measured clean (F3) |
| RR6 | A moved base or a concurrent branch adds values or old-shape entries the migrated file lacks | any merge to the default branch before this one | loud CI red, revert-safe |

## Unrun verifications

| Verification | Command | Owner |
|---|---|---|
| Full suite, typecheck and lint against the real working tree with dependencies installed | the three npm scripts | Manager at verify |
| The CHANGELOG's own test count | as above | Manager at verify |

I ran the full suite only in a dependency-free scratch clone: `tests 869 pass 866 fail 3 skipped 0`, and all three failures are artefacts of that clone (two files fail with a missing TypeScript package, one resolved once the ADR tree was copied in). None is in the secret-scan module. I therefore neither reproduce nor dispute the CHANGELOG's own figure; that number belongs to verify, against a real install.

## Editorial (uncounted, verdict-neutral, plain edits)

- THOTH-ADR-0002's residual table says a test asserts no tracked text file is skipped "so this story's own artifacts cannot hide that way". Narrow it to the current tree, or widen the test (F3).
- THOTH-ADR-0002's Rules for agents point at the generator's verify mode as the proof of non-widening. The empirical part of that proof is the unbacked-hash and no-legacy-pair checks, not the widening counter (F2).
- The plan addendum records the generator base as 7b62344; the CHANGELOG says "the base commit" without naming it. Both verify clean, but naming the ref once in the CHANGELOG would save the next reader a lookup.

## The single scariest unproven assumption

That a developer will paste the command the gate tells them to paste. Everything else in this story is content-addressed, fail-closed and independently reproducible; the one place it hands control to a human it also hands control to whoever chose the file name.

## Go / no-go and the single next action

**no-go**, on F1 alone. It is a security-class defect in code this diff introduces, demonstrated end to end in both of this project's shells, and PRINCIPLES rule 21 exempts security findings from the narrow-exposure cap. It is also a small fix. If the Manager judges the paste step to be a sufficient barrier, that is a rule 21 severity-triage call to make explicitly and log -- not something I will make quietly on its behalf.

**Single next action:** guard the path interpolation at `src/secret-scan/history-scan.ts:191` behind a conservative safe-character set, with `oss01-unlock-command-never-interpolates-shell-metacharacters-from-a-path` written red first.

## Persistence

- Report: this file. Review-log row appended in `docs/REVIEW_LOG.md`.
- Bug Issues: duplicate check run first (searches on unlock, quoting, injection, allowlist, binary, duplicate). F1's code path is already tracked by issue 238; I escalated that issue with this evidence and its severity labels rather than filing a duplicate, as the discipline requires. F2 to F5 are LOW and file nothing.
- Nothing pushed. No tracked file in the working tree was edited. All scratch clones and throwaway repositories live outside the repository.

## Addendum (same turn, before commit): F1 was independently filed by a parallel reviewer

The duplicate check for F1 was run after this report's body was written and found **issue 239**, opened the same day by `app-security-reviewer` (labels bug, severity:high, oss; milestone S1 -- Protect the baseline), describing the same sink in the same line of code and demonstrating it in three shells. This report's F1 is therefore an INDEPENDENT REPRODUCTION, arrived at by a different route (a repository-content attack on the gate's own unlock path rather than a security-property sweep), and it corroborates that finding rather than adding a new one.

Consequences, stated plainly:
- No new Issue was filed for F1. I commented my own evidence on issue 239 instead, per the duplicate rule. The Persistence section above, which anticipated escalating issue 238, is superseded by this paragraph; issue 238 remains the separate, lower-severity quoting defect it always was, and issue 239 is the security half.
- Two reviewers reaching the same HIGH by independent methods raises, not lowers, confidence in the no-go. It also means the fix closes both findings at once.
- Nothing else in this report changes. F2 to F5 and C1 to C10 were derived from my own runs and are unaffected.

RECEIPT: verdict=no-go
attacks (ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] F1 the new unlock line interpolates the match path into a double-quoted shell command, so a contributor-chosen file name containing a command substitution executes in bash and PowerShell when the maintainer pastes it; no defense in the code, and git does not quote the dangerous characters; Exposure: ~0% of runs, 0 of 368 tracked paths, basis: counted-in-code, one attacker-authored file is the whole precondition (security class, rule 21 cap does not apply)
2. [ISSUE][LOW][demonstrated] F2 verify's newly-allowlisted (widening) counter is a surviving mutant and appears unreachable, so the ADR's "shown by verify, not by prose" overstates it; the property itself holds, proven by my own instrument
3. [ISSUE][LOW][demonstrated] F3 the no-skipped-text-file assurance reads the index while the gate reads history; one blob of this story's own history is still skipped as binary, contradicting the ADR residual's wording; that blob holds no match, measured
4. [ISSUE][LOW][demonstrated] F4 the loader honours duplicate entries for one pair and unions their hashes while the generator refuses them; 0 duplicates in the real file today
5. [ISSUE][LOW][demonstrated] F5 the rejected-entry diagnostic is lost by any array copy of the loaded allowlist and is never shown on a passing run; both live callers pass it through today
6. [CLEAN][demonstrated] C1 the central claim end to end: a novel value in a granted file blocks at the gate, at the CLI, and through the REAL installed pre-commit hook; a commit-tree hook bypass is caught by the full-history scan; no raw literal on any output
7. [CLEAN][demonstrated] C2 Attack E both halves: legacy-shaped report grant blocks, self-hashed grant passes; the Manager's Q1 reading and the ADR's residual wording are exactly right, no overclaim in the test names
8. [CLEAN][demonstrated] C3 no laundering: 0 new pairs, 0 dropped, 0 reason changes, 108 of 108 hashes backed at base and HEAD, 0 newly allowlisted occurrences at either scope, measured by my own instrument and matched digit for digit by the shipped tool
9. [CLEAN][demonstrated] C4 independent classification of all 108 blessed values: 16 synthetic credential fixtures, 1 real-credential-derived (the ADR's single named exception, confirmed not refuted, blessed at exactly one path), 17 reserved-domain addresses, 6 placeholders, 1 documentation IPv4, 67 generic-label host names; nothing flagged as unjustifiable; the ADR's named-exception wording is honest and the value is baseline-pinned
10. [CLEAN][demonstrated] C5 loader hostile-input table and fail-open hunt: 21 malformed shapes all fail closed, prototype-pollution keys grant nothing, a NUL in an entry path cannot collide; case, separators, dot-slash, dot-dot and rename all fail closed; only the disclosed copy-at-a-later-path residual is exempt, 0 of 235 matched blobs multi-path
11. [CLEAN][demonstrated] C6 output discipline: no hash and no raw text of a blocking match on stdout or in the CI-uploaded report (exactly one hash in the report, the allowlisted one); the allowlist tool exits 2 with a named message on every hostile input and prints no hash or value
12. [CLEAN][demonstrated] C7 hash parity: the same literal hashed from the file's own bytes is accepted by both the history scan and the simulated pre-commit tree; a CRLF line does not split them
13. [CLEAN][demonstrated] C8 mutation battery: 12 of 13 mutants killed, including the core revert-the-whole-story mutant (8 tests red); the single survivor is F2
14. [CLEAN][code-traced] C9 issue 203 closed at code level: the reports-directory exclusion is gone entirely, not narrowed; the derived guard set has no path filter, so a case-variant report path gains nothing; 7 report grants pinned with written reasons
15. [CLEAN][demonstrated] C10 scope boundaries: pre-commit-scan, simulated-commit, patterns and the hooks directory have an empty diffstat; the story's own artifacts add 0 blocking matches and 0 new triples; the dropped round-trip test unpins nothing material
counts (CHECKSUM): issues=5 suspicions=0 clean=10
evidence (CHECKSUM): demonstrated=14 code-traced=1 derived=0
checks=secret-scan suite in a scratch clone: tests 97 pass 97 fail 0 skipped 0; named sb2/oss01 subset: tests 35 pass 35 fail 0 skipped 0; broader named subset with the issue 203 guard: 39 tests, baseline green; full suite in a dependency-free scratch clone: tests 869 pass 866 fail 3 skipped 0 (all 3 traced to the clone's missing node_modules and submodule, none in the secret-scan module); allowlist-tool verify --base 25291ff and --base 7b62344 both PASS exit 0; 13-mutant battery (12 killed, 1 survivor); independent 108-value classification (0 unresolved); independent legacy-versus-migrated comparison at two refs; loader table over 21 hostile files; 9 fail-open probes; real-installed-hook and commit-tree drills; unlock-injection drill in bash and PowerShell; not run by me: npm test / typecheck / lint against a real install
adr=HIT(37)
report=docs/reviews/s1-136-value-scoped-allowlist-red-team-2026-09-19.md
