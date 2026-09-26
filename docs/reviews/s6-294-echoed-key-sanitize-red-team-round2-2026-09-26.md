# Red Team (Sutekh) — s6-294-echoed-key-sanitize, round 2 (re-confirm of the fix-now delta)

- Date: 2026-09-26
- Scope: re-attack of the fix-now delta on branch `fix/s6-294-echoed-key-sanitize`
- Range: `e93d7b2..ac2656c`; HEAD `ac2656c`; base `master` at `b345adc`
- Tier: CRITICAL (ratified); sensitive area: policy delivery / config surface
- Round 1 report: `docs/reviews/s6-294-echoed-key-sanitize-red-team-2026-09-26.md`
- Verdict: **go** (no HIGH; two MED issues, one LOW issue, one LOW suspicion, eleven clean)
- ADR state: `HIT(37)` — `node docs/adr-cache.mjs --ensure` after `git submodule update --init`. Attack-surface slice read: THOTH-ADR-0001 (central-classification exception) and THOTH-ADR-0002 (secret-scan allowlist), plus the security/state/failure-mode ADRs of the pulled catalog. No rule of either is engaged by this delta: it touches no allowlist, no scanner pattern, no fixture loader.
- Environment settled: this worktree now has an initialized `adr` submodule and an installed dependency tree, so the two gates round 1 left `UNPROVEN-pending-verification` are settled below.

## What round 2 attacked

The delta is three things: a total backstop for any thrown value in `src/policy/config/printer.ts` (Issue 315); a new exported pin-line renderer in the same file with `src/policy/config/print-cli.ts` reduced to renderer calls, guarded by `src/policy/config/print-lines.test.ts` and a stricter interpolation scan in `src/policy/config/echo-sanitize.test.ts` (Issue 313); and records plus the restored ADR catalog in `docs/.maat-state.json` (Issues 314, 316).

| Assumption the delta rests on | Attack | Result |
| --- | --- | --- |
| The backstop cannot throw for any thrown value | 17 exotic values through the real printer | SURVIVES |
| The fail-closed shape is unchanged vs master | exit code, line count, posture, status word on every value | SURVIVES |
| The pin line's clean bytes are unchanged | text comparison against master and against the pre-delta branch state | SURVIVES |
| A hostile channel descriptor is neutralized | the new renderer's own hostile-channel assertion, proven to bite by two mutants | SURVIVES |
| Round 1's two surviving mutant shapes are dead | both reapplied here | SURVIVES (both now red) |
| The delta adds no new raw echo | every backstop path traced to the one sanitizing interpolation | SURVIVES |
| The guard proves the CLI builds no text of its own | a locally defined concatenating renderer | BREAKS (finding 1) |
| The sanitizer's inputs are always strings at the render boundary | a non-string channel descriptor from a port | BREAKS (finding 2) |
| The guard only fires on a real defect | a trailing comment containing a backtick | BREAKS (finding 3) |
| The restored catalog reproduces from this branch | rebuild from the branch's own pinned submodule | UNPROVEN (finding 4) |

## Findings, ranked by blast radius

### 1. [ISSUE][MED][demonstrated] The Issue 313 guard still admits a raw policy-derived echo from the CLI: a locally defined renderer

- Exposure: 0% of production runs today, basis: counted-in-code — the only shipped channel descriptor is a module constant in `src/policy/config/central-source.ts`. The risk is future regression, which is exactly what the guard exists to stop.
- Scenario: a later story adds one more trailing line to the CLI and writes it through a helper defined in that same file rather than in the printer. The guard accepts the write because its allowed-argument pattern matches any identifier beginning with `render` followed by a capital letter applied to the pin or the declaration variable; it never checks that the identifier is an imported binding. The helper builds its text by concatenation, so the interpolation scan sees nothing, and the behavioural renderer tests only cover the two renderers that live in the printer.
- Mutant applied (reverted): a third write line calling a locally defined helper that returns a fixed label concatenated with the raw channel descriptor.

```
node --test "src/policy/config/*.test.ts"
ℹ tests 219   ℹ pass 219   ℹ fail 0   ℹ skipped 0

tsc --noEmit -p tsconfig.json        → TSC=0
eslint src/policy/config/print-cli.ts → LINT=0
```

- Current defense, honestly assessed: the guard's own header calls itself a heuristic and names the behavioural renderer tests as the backstop, so the shape of the gap is acknowledged in kind. What is not honest yet is the claim carried in the CLI comment, the changelog entry and the decisions addendum — that this file "builds no text of its own" and the guard proves it. The guard proves the file's *current* writes are renderer calls; it does not prove the renderer is the printer's.
- Fix (one line): require every `render`-prefixed identifier used in a write to appear in the file's import list from the printer module, which the guard already reads.
- Named proof-test before this class is closed: `a renderer defined inside the CLI module is rejected by the write guard`.

### 2. [ISSUE][MED][demonstrated] Issue 315 hardened the printer's backstop but not the CLI's own two renderer calls, which sit outside every `try`

- Exposure: 0% of production runs today, basis: counted-in-code — the shipped channel descriptor is a module constant and rule ids are schema-validated strings. Reachable through any policy source port that is not type-checked against the interface (a plain-JS implementation, or a type assertion).
- Scenario: a port reports a present channel whose descriptor is not a string. The pin computation passes it through unchanged (its own fallback only replaces a nullish value), and the new pin renderer hands it straight to the sanitizer, which is typed for a string and calls a string method on it. The printer's own contract is intact — the value never passes through `printEffectivePolicy` — but the CLI has no `try`, so the exception escapes the entry point.
- The consequence is worse than the Issue 315 case it mirrors: the throw happens after the resolved-rules block has already been written and before the posture line and the enforcement disclosure. The operator sees rules, no posture, no disclosure, and a stack trace with absolute paths on stderr — the same leak class the S7 fix-now removed from the hook — instead of a fail-closed two-line rejection.

- Raw evidence (the new renderer called with a numeric channel descriptor):

```
THREW TypeError text.replace is not a function
```

- Current defense: none at this site. The asymmetry is internal to the same file: the central-channel status line already coerces its descriptor with an explicit string conversion before sanitizing, and the Issue 315 helper exists precisely to keep that coercion out of the sanitizer. The pin renderer and the inert-mandatory renderer do not do it.
- Not a regression introduced by this delta: the pre-delta branch state called the sanitizer on the same value from the CLI, so this arrived with Issue 294 itself and Issue 315 did not reach it.
- Fix (one line each): coerce with an explicit string conversion in the pin renderer, matching the status-line site.
- Named proof-test: `the pin renderer returns a line, not a throw, for a non-string channel descriptor`.

### 3. [ISSUE][LOW][demonstrated] The new guard fails the build on a comment, and says the file builds text of its own

- Exposure: ~100% of future edits that add a trailing comment containing a backtick to the CLI module, basis: counted-in-code (the guard strips whole-line comments only, then tests the remaining text for a backtick anywhere).
- Scenario: someone appends a trailing comment naming a function in backticks — the house style in the sibling printer module, which uses them throughout. The guard reports "a template literal: print-cli.ts builds no text of its own". Nothing about the message points at the comment, so the reader looks for an interpolation that is not there. This is PRINCIPLES rule 2: a gate that blocks without naming its unlock.
- Raw evidence (a trailing comment containing backticks appended to the posture-line write, then reverted):

```
✔ the print-cli guard bites: it flags concatenation, wrapper-plus-raw and a template literal, and accepts renderer calls
✖ print-cli.ts writes only printer.ts renderer output or named PrinterResult fields, and uses both renderers
ℹ tests 4   ℹ pass 3   ℹ fail 1
```

- Current defense: none; the comment stripper handles whole-line comments only.
- Fix: strip trailing comments too, or restrict the backtick test to the write arguments the guard already extracts.
- Named proof-test: `a trailing comment containing a backtick does not trip the write guard`.

### 4. [SUSPICION][LOW][demonstrated] The restored ADR catalog is content-correct but its fingerprint does not reproduce, and Issue 316's second half is untouched

- Exposure: ~100% of subsequent sessions in any checkout other than the one that wrote the catalog, basis: measured. Effect is a dirty tracked file, not a wrong ADR read.
- Restored half, verified: the committed state file carries a top-level catalog of 37 ADRs, with no duplicate nested under the prior-scope block, and the scope and tier fields read this story and CRITICAL.
- What does not reproduce: rebuilding in this worktree, with the submodule at exactly the commit this branch pins, yields an identical 37-entry catalog but a different version fingerprint, so `--ensure` rewrites one line of a tracked file. Every agent runs `--ensure` as its first step, so every session starts by dirtying the state file, against the working-tree-clean item in the Definition of Done.

```
node docs/adr-cache.mjs --ensure
📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]

git diff --stat docs/.maat-state.json
 docs/.maat-state.json | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)      (the version field only)

git submodule status
 cdb245d977fd67889bf69c9710a13b70a8b5045f adr (heads/main)   — matches the gitlink exactly
```

- Issue 316's second half is not fixed, and the Issue body names it explicitly as one of two fixes: the cache reporter still reports a success verdict when two of the three configured roots resolve to zero ADR files. The delta does not touch `docs/adr-cache.mjs`. Raw evidence, the first command run in this session, before the submodule was initialized:

```
📊 ADR cache BUILT: cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2], catalog now current (fp 9b0b204) [CACHE=HIT]
```

- Therefore Issue 316 stays OPEN. This is not a blocker for this story — the shipped catalog is correct, so no later agent reads a shrunken slice from this merge — but closing 316 here would close a half-fixed Issue.
- Current defense for the reproducibility half: none, and none is owed by this story; the behaviour predates it and `master` carries a committed catalog the same way. Recorded, no test asked for.
- Named proof-test for the second half, unchanged from round 1: `adr-cache refuses to report HIT when a configured ADR root resolves to zero ADR files`.

## What survived the attack

### 5. [CLEAN][demonstrated] The Issue 315 backstop holds for every thrown value tried — 17 shapes, none throws, none leaks

Every case returned exit code 1, exactly two lines, the unresolved posture line, the read-error status word, and zero terminal-active code units. The first four runs count the line separator, so the "active" column reads 1 there and 0 in the later batches where the separator is excluded; no run carried an active character inside a line.

```
T1  revoked Proxy                exit=1 lines=2 | "...(read-error): (unprintable thrown value)"
T2  Proxy whose get trap throws   exit=1 lines=2 | "...(read-error): (unprintable thrown value)"
T3  BigInt                        exit=1 lines=2 | "...(read-error): 1000000000000000000000000000000"
T4  object with a hostile toString exit=1 lines=2 | "...(read-error): ts[2JREJECTED: forged (x): y"
T5  cyclic object                 exit=1 lines=2 active=0 len=100  | "...: [object Object]"
T6  Symbol.toPrimitive throws     exit=1 lines=2 active=0 len=111  | "...: (unprintable thrown..."
T7  Symbol.toPrimitive -> object  exit=1 lines=2 active=0 len=111  | "...: (unprintable thrown..."
T8  null-prototype object         exit=1 lines=2 active=0 len=111  | "...: (unprintable thrown..."
T9  Symbol, hostile description   exit=1 lines=2 active=0 len=103  | "...: Symbol(s[2Jforged)"
T10 8 MiB message                 exit=1 lines=2 active=0 len=8388693 ms=113
T11 2 MiB of active characters    exit=1 lines=2 active=0 len=85    ms=14
T12 message getter: non-string, then throws on second access  exit=1 lines=2 | "...: (unprintable thrown value)"
T13 message getter: object, then a hostile string             exit=1 lines=2 | "...: E: 2nd[2Jread"
T14 toString recursing without bound (stack overflow)         exit=1 lines=2 | "...: (unprintable thrown value)"
T15 message getter recursing without bound                    exit=1 lines=2 | "...: (unprintable thrown value)"
T16 empty string thrown                                       exit=1 lines=2 | "...(read-error): "
T17 object whose message is the empty string                  exit=1 lines=2 | "...(read-error): "
```

The shape is airtight by construction, not only by sample: the helper reads the message property once into a local, returns it only when its type is string, otherwise returns a string conversion, and the whole body sits inside a `try` whose `catch` returns a constant. Every path therefore yields a primitive string, which is the one type the sanitizer needs. The "getter that throws on second access" case cannot bite because the first read is stored; where the string conversion re-reads the property through the error prototype's own conversion, the re-read is inside the same `try`. A stack overflow is a throw like any other and degrades to the constant (T14, T15).

### 6. [CLEAN][demonstrated] Round 1's two surviving mutant shapes are now red, and both are killed twice over

Baseline in this worktree: 219 pass, 0 fail, 0 skipped. Each mutant was applied in place and reverted.

```
M-A  pin renderer, sanitizer wrapper removed
       → 217 pass / 2 fail
       ✖ every interpolation in the print modules is sanitized or allowlisted
       ✖ renderPinLine with a hostile channel descriptor is one line with no terminal-active character

M-B  pin renderer, wrapper-plus-raw (round 1's surviving shape, moved into the printer)
       → 217 pass / 2 fail   (same two tests)

M-C  NOTE line rebuilt by concatenation in the CLI (app-security's demonstrated mutant)
       → 218 pass / 1 fail
       ✖ print-cli.ts writes only printer.ts renderer output or named PrinterResult fields, and uses both renderers

M-D  CLI pin line as wrapper-plus-raw (round 1 mutant M2, which survived all 206 tests then)
       → 217 pass / 2 fail
       ✖ print-cli.ts writes only printer.ts renderer output or named PrinterResult fields, and uses both renderers
       ✖ AC-P6: print-cli smoke: the CLI prints exactly one posture line ...

M-E  a third write line through a renderer defined inside the CLI module
       → 219 pass / 0 fail   SURVIVED (finding 1)

M-F  the backstop's last-resort constant replaced by another string conversion
       → 217 pass / 2 fail
       ✖ the backstop returns the fail-closed rejection when a port throws an object with no useful toString
       ✖ the backstop still returns the rejection when an Error subclass's message getter throws

M-G  the backstop always converts, never prefers a string message
       → 217 pass / 2 fail
       ✖ the backstop shows a string message on a thrown non-Error object, as master did
       ✖ the backstop shows the message of an Error subclass
```

M-F and M-G matter beyond the mutant count: they prove the two halves the fix is actually claiming — that the constant fallback is load-bearing, and that parity with master's text for an error or a message-bearing object is pinned, not incidental.

### 7. [CLEAN][code-traced] The fail-closed rejection shape and exit code are unchanged vs master for an error and for a message-bearing object

Master's backstop passed an error's message property through unchanged; the new helper returns that same value whenever it is a string, so the rendered text is identical for both shapes. The renderer around it — status line, rejection prefix, exit code 1, unresolved posture, empty declarations, undefined posture — is untouched by this delta. The shipped instrument asserts all five properties per case, and the two parity assertions go red under M-G above. Where the text does differ from master is the case master could not render at all: a non-error throw printed the word for an absent value before and now prints the value's own string conversion, sanitized.

### 8. [CLEAN][code-traced] The pin line's clean bytes are unchanged

Master built the line inline in the CLI with a raw descriptor; the pre-delta branch state built the same line inline with the descriptor sanitized; the delta moves that expression into the printer verbatim, renaming only the parameter. The sanitizer is proven byte-identity-preserving on clean text by its own code-point test, and the new renderer test asserts the exact literal for two descriptors, one of them the real registry-shaped value with backslashes. A live run of the real entry point prints the expected five lines and exits 0.

```
node src/policy/config/print-cli.ts
central-channel status=absent
--- resolved rules (0) ---
pin: sha256:3153014795265683fa9c4e4bd5506ceb4e7f159184497f42ab130c535be320b8 channel=(absent) computedAt=...
posture: allow (source: bootstrap; no layer declared a posture)
NOTE: this reflects S6's own resolved policy ...
CLI_EXIT=0
```

### 9. [CLEAN][demonstrated] A hostile channel descriptor through the new renderer is one line with no terminal-active character

The shipped renderer test drives a descriptor carrying an escape-introduced sequence, a line feed, a line separator, a next-line control, a carriage return, a null, a delete and an eight-bit control introducer, then asserts the exact visible text, scans every code unit for a terminal-active one, and asserts a single line. That assertion is the test M-A and M-B both kill, so it is not decorative.

### 10. [CLEAN][code-traced] The new helper adds no raw echo path

Every value it returns reaches stdout through exactly one interpolation, and that interpolation is wrapped by the sanitizer inside the rejection renderer. Nothing in the delta writes the thrown value anywhere else: there is no logging call, no stderr write, no second render. Demonstrated too — T4 and T9 above show a hostile string conversion arriving stripped. The one residual is the pre-existing one: the forged marker text survives mid-line, never at the start of a line, because line breaks are stripped.

### 11. [CLEAN][demonstrated] The stricter interpolation scan is a real tightening, self-tested, and the scan's own allowlist was re-pointed correctly

The scan now accepts an interpolation only when a single sanitizer call spans the whole expression, checked by matching the call's own closing parenthesis to the last character rather than by a greedy pattern. Its self-test adds three cases: wrapper-plus-raw, a raw value between two wrapper calls, and a legitimate nested conversion inside the wrapper. The two code-controlled allowlist entries were renamed with the parameter, so the CLI's former entries are gone and the printer's new ones are covered; the scan's unused-entry check would fail otherwise, and it passes.

### 12. [CLEAN][demonstrated] Suites, typecheck and lint — the two gates round 1 could not run are settled green

```
tsc --noEmit -p tsconfig.json         → exit 0, no diagnostics
eslint .                              → exit 0, no findings

node --test "src/policy/config/*.test.ts"
ℹ tests 219   ℹ pass 219   ℹ fail 0   ℹ skipped 0

node --test        (whole repository, submodule initialized)
ℹ tests 1338  ℹ pass 1338  ℹ fail 0   ℹ skipped 0   duration_ms 141264
```

Round 1's single failure (the reference-resolver dogfood test, from the uninitialized submodule) is gone, and the policy-config suite grew from 206 to 219: the two new files run 9 and 4 tests respectively (counted by running each file), and the interpolation scan gained assertions inside tests that already existed.

### 13. [CLEAN][demonstrated] Every CI gate this delta can reach passes locally, and no pull request exists yet so CI has not run it

```
[QA-14 reference-resolver] PASS: 142 citation(s): 104 resolved, 38 unclassified (non-blocking) — 0 failed.
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
[QA-13 recurring-findings-registry] PASS: 3 recurring finding class(es) logged, all structurally valid.
[QA-17 runtime-settings-drift-check] PASS: 18 vendored runtime-settings key(s) all still match REQUIREMENTS.md
[QA kernel-purity-check] PASS: 4 production files under the kernel, zero violations.
[SUR-13/Issue-87 gate-command-path-check] PASS: 2 command-type hook entries, every script resolves.
[QA-16 broken-instrument-gate] VACUOUS-PASS   [QA-05 fixture-isolation-check] VACUOUS-PASS
[QA-01 fixture-coverage-check] VACUOUS-PASS   [QA-06 mutation-harness] VACUOUS-PASS
[QA-02 diff-fixture-check] VACUOUS-PASS
```

Five of those are disclosed vacuous passes — they say so themselves and are not evidence their mechanism works. Reported as run, not as coverage.

### 14. [CLEAN][code-traced] Nothing in the delta widens what a compromised runner reaches, and there is no partial-failure or concurrency surface

The three production lines added are pure string functions over values already in memory. No file is written, no credential read, no network call, no new dependency, no workflow or secret-scan config change. The one new test file reads only the CLI module's own source from disk. There is no resource to half-create, no lock, no state to diverge, and nothing in this delta is ordered against anything else, so the partial-failure and concurrency lenses have no surface to attack here beyond the truncated-output case already filed as finding 2.

### 15. [CLEAN][demonstrated] The records delta matches the tree

The changelog fix-now bullet, the decisions addendum and the review-log rows name the two oracle amendments, the residual clauses for colliding rule ids and surviving format characters including the agent-transcript channel, and all four fix-now Issues. Round 1 raised two editorial notes; both still stand, listed again below. The sanitizer module header still asks the Manager to record residuals that are now recorded, and the state document is still untouched on this branch (it names this story only as a pre-existing low-severity open item).

## Issue resolutions, verified honestly

| Issue | Claim | Verified | Action taken |
| --- | --- | --- | --- |
| 315 | the backstop returns a fail-closed rejection for any thrown value | YES — 17 exotic shapes, 9 shipped test cases, 2 kill-mutants, and the helper's every path returns a primitive string | closed, `completed`, with evidence in a comment |
| 313 | the scan misses concatenation and wrapper-plus-raw; the CLI has no behavioural coverage | YES for both named shapes — M-B, M-C and M-D all go red where M2 survived in round 1, and the pin line now has a behavioural hostile-channel test | closed, `completed`, with the finding-1 residual named in the comment |
| 316 | restore the catalog **and** make the reporter refuse a success verdict on a zero-ADR root | HALF — the catalog is restored and correct; the reporter is untouched and still reported 2 ADRs as a hit in this session | left OPEN, comment posted; do not close at ship |
| 314 | the records name two oracle amendments and the residual clauses | YES — changelog, decisions addendum and review-log rows all read correctly | not this round's to close; no defect found |

## Editorial (verdict-neutral)

- The sanitizer module header still carries the parenthetical asking the Manager to record the residuals in the decision log. The row exists; the parenthetical can go.
- The state document is not updated on this branch, and it still describes this story only as a pre-existing low-severity open item. The Definition of Done asks for it.
- The write guard's allowed-argument pattern hard-codes the two loop/variable names it expects. A third renderer with a differently named argument would be reported as a violation with no hint that the pattern, not the code, is what needs editing.
- No pull request exists for this branch, so nothing in the delta has been through CI. Every CI gate was run locally instead and is listed above.

## Scariest unproven assumption

That a source-scan guard proves the CLI module builds no text of its own. It does not — it proves the module's current writes look like renderer calls. Finding 1 shows a shape that passes the guard, the interpolation scan, the type checker and the linter while writing a raw policy-derived descriptor to stdout. Nothing is leaking today because the only shipped descriptor is a constant, but the guard is the only thing standing between that constant and a future one, and it is one identifier-shape away from being bypassed by an author who is not trying to bypass it.

## Verdict and next action

**go.** No HIGH; the two MED findings do not gate (PRINCIPLES rule 21 leaves that call with the Manager, and both have zero exposure on today's production path). Issue 315 is genuinely and thoroughly fixed — the 17-shape sweep found no value that makes the printer throw, leak an active byte, or change its fail-closed direction, and the fix is pinned by two mutants in each direction. Issue 313's two named mutant shapes are dead, demonstrated. Two of this round's findings are MED, graded to match how the same two classes were graded in round 1 and by app-security rather than softened because they are late; both have zero exposure on today's production path. The third is LOW. Issue 316 stays open because half of what its body asks for is untouched; that is a record-keeping correction, not a ship blocker.

Single next action: add the one-line import check to the write guard (finding 1), since that guard is now the load-bearing defence for the whole class Issue 294 exists to close.


## Findings to tests (PRINCIPLES rule 19)

Four open findings, four named failing tests, one residual-register line. No numbered conditions list.

| Finding | Named test that closes it |
| --- | --- |
| 1 | `a renderer defined inside the CLI module is rejected by the write guard` |
| 2 | `the pin renderer returns a line, not a throw, for a non-string channel descriptor` |
| 3 | `a trailing comment containing a backtick does not trip the write guard` |
| 4, second half (Issue 316) | `adr-cache refuses to report HIT when a configured ADR root resolves to zero ADR files` |
| 4, first half | residual-register line, no test asked for: the committed catalog fingerprint does not reproduce across checkouts, so `--ensure` rewrites one line of a tracked file each session |

Findings 1 and 2 are MED and each drew a `bug` Issue this turn — 317 for finding 1 and 318 for finding 2 — labelled `bug`, `severity:med` and `pol`, milestoned to the policy-centralization milestone. Finding 3 is LOW and finding 4 is a LOW suspicion, so neither spawns one; finding 3 is the Manager's call between a fix-now line and a backlog entry, and finding 4's second half already has Issue 316 as its home, left open for it.
## RECEIPT

```
RECEIPT: verdict=go
attacks (ALL, ranked by blast radius):
1. [ISSUE][MED][demonstrated] the #313 write guard accepts any `render`-prefixed identifier without checking it is imported from the printer, so a renderer defined inside the CLI module writes the raw channel descriptor with 219/219 green, typecheck 0 and lint 0 — guard self-labels as heuristic, but the changelog/decisions claim "builds no text of its own" overstates it. Exposure: 0% of production runs today (constant descriptor), basis: counted-in-code
2. [ISSUE][MED][demonstrated] the CLI's two renderer calls sit outside every try, and the pin renderer hands its descriptor to the string-typed sanitizer with no coercion (the sibling status-line site has one): a non-string descriptor raises a TypeError AFTER the rules block and BEFORE the posture and disclosure lines — truncated output plus an absolute-path stack trace instead of a fail-closed rejection. Pre-existing from #294, not reached by #315. Exposure: 0% today, basis: counted-in-code
3. [ISSUE][LOW][demonstrated] the new write guard strips whole-line comments only, so a trailing comment containing a backtick fails the build with "a template literal: print-cli.ts builds no text of its own" — a gate that blocks without naming its unlock (PRINCIPLES rule 2). Exposure: ~100% of future edits adding such a comment, basis: counted-in-code
4. [SUSPICION][LOW][demonstrated] #316 is half-fixed: the 37-ADR catalog is restored top-level with no nested duplicate, but the reporter still printed "cataloged 2 ADR(s) ... [CACHE=HIT]" in this session, and the committed fingerprint does not reproduce from the branch's own pinned submodule, so every `--ensure` rewrites a tracked file
5. [CLEAN][demonstrated] #315 holds on 17 exotic thrown values (revoked Proxy, throwing get trap, BigInt, cyclic, Symbol.toPrimitive throwing and returning an object, null-prototype, hostile Symbol description, 8 MiB message, 2 MiB of active characters, getter throwing on second access, getter returning a hostile string on second access, unbounded toString and getter recursion, empty string, empty message): exit 1, two lines, unresolved posture, read-error status, zero active bytes, never throws
6. [CLEAN][demonstrated] round 1's two surviving mutant shapes are dead; 7 mutants applied, 6 killed (M-A 2 fail, M-B 2 fail, M-C 1 fail, M-D 2 fail, M-F 2 fail, M-G 2 fail), M-E survived = finding 1; M-F and M-G prove the constant fallback and master-text parity are pinned, not incidental
7. [CLEAN][code-traced] fail-closed shape and exit code identical to master for an error and for a message-bearing object; only the case master could not render (a non-error throw) changed text, from an absent-value word to the sanitized string conversion
8. [CLEAN][code-traced] the pin line's clean bytes are unchanged: the expression moved verbatim into the printer, parameter renamed only; the renderer test asserts the exact literal for two descriptors including the registry-shaped one; a live run prints five lines, exit 0
9. [CLEAN][demonstrated] a hostile channel descriptor through the new renderer is one line with no terminal-active code unit — and that assertion is exactly what M-A and M-B kill, so it is load-bearing
10. [CLEAN][code-traced] the new helper adds no raw echo: every value it returns reaches stdout through one sanitizer-wrapped interpolation, no log, no stderr, no second render; forged marker text survives mid-line only, the pre-existing residual
11. [CLEAN][demonstrated] the stricter interpolation scan is a real tightening (one whole sanitizer call per interpolation, matched by paren depth), self-tested on three new cases, and its code-controlled allowlist was re-pointed with no unused entry left behind
12. [CLEAN][demonstrated] typecheck exit 0 and lint exit 0 — the two gates round 1 left UNPROVEN are now settled; policy-config 219/219/0 skipped; whole repo 1338/1338/0 skipped with round 1's single environmental failure gone
13. [CLEAN][demonstrated] every CI gate reachable locally passes (QA-14 142 citations 0 failed, QA-15, QA-13, QA-17, kernel-purity, gate-command-path), 5 disclosed vacuous passes reported as run not as coverage; no pull request exists so CI itself has not run this delta
14. [CLEAN][code-traced] no new reach for a compromised runner and no partial-failure or concurrency surface: three pure string functions, no write, no credential, no network, no dependency, no workflow or scanner-config change
15. [CLEAN][demonstrated] records match the tree: changelog, decisions addendum and review-log rows name both oracle amendments, the residual clauses and all four fix-now Issues; two round-1 editorial notes still stand
counts (CHECKSUM): issues=3 suspicions=1 clean=11
evidence (CHECKSUM): demonstrated=11 code-traced=4 derived=0
checks=typecheck exit 0; lint exit 0; policy-config 219 pass/0 fail/0 skipped; whole repo 1338 pass/0 fail/0 skipped; 7 mutants applied and reverted, 6 killed; 17 exotic thrown values through the real printer; 11 CI gates run locally (6 real PASS, 5 disclosed VACUOUS-PASS)
adr=HIT(37)
report=docs/reviews/s6-294-echoed-key-sanitize-red-team-round2-2026-09-26.md
```
