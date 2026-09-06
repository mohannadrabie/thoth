# Red Team (Sutekh) — S4 shell-command semantic detector

- **Scope:** S4, Milestone #22, CRITICAL tier. Post-build Stage 3 adversarial review of the shipped working-tree diff on top of `247e5fb`.
- **Date:** 2026-09-02
- **HEAD:** `247e5fb6e08595e3f7fd69a02671ad5225637f21` (the S4 diff is uncommitted in the working tree)
- **Files attacked:** `src/policy/normalizer/{shell,shell-scanner,flag-catalog,wrapper-catalog}.ts`, `src/qa/shell-detector-mutants.ts`, `src/policy/fixtures/normalizer-calls.ts`, `.github/workflows/ci.yml`
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
- **ADRs read from `adrCatalog.adrs` for this attack surface** (security / architecture / reliability / data slices): SE ADR-0002 (layering), ADR-0003 (SOLID), ADR-0004 (idempotency), ADR-0006 (blast-radius control), ADR-0012 (data integrity), ADR-0016/0019/0020 (port fidelity + self-protection), ADR-0021 (thoth-native architecture, section 3.2 never-silently-dropped).
- **Verdict: no-go.** Four `[HIGH]` `demonstrated` fail-opens, all in the security / data-integrity class (PRINCIPLES rule 21 exemption applies — the exposure cap does not soften them).

---

## What I ran

```
$ npm test
tests 336
suites 0
pass 336
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 9719.7395

$ npm run typecheck        -> clean (tsc --noEmit, no output)
$ npm run lint             -> clean (eslint ., no output)

$ node src/qa/shell-detector-mutants.ts
Error: shell-detector-mutants: mutant "inner-unresolved-propagation-broken"'s anchor text was not
found in policy/normalizer/shell.ts — the source moved or was refactored; update this mutant's
anchor rather than let it silently stop covering anything.
    at Object.apply (file:///c:/playground/thoth/src/qa/shell-detector-mutants.ts:55:15)
(process exited non-zero, uncaught throw)

$ node tmp-redteam/mutrun.ts     # same staging, .ts sources LF-normalized first
ok= true summary= 28 of 28 mutant(s) KILLED.

$ npm run qa:completeness-claims -> FAIL (exit 1)   # also FAILs at HEAD, see finding 8
$ npm run qa:fixture-coverage / qa:diff-fixture / qa:fixture-isolation /
  qa:broken-instrument-gate / qa:kernel-purity / qa:normalizer-registry-purity /
  qa:recurring-findings           -> PASS (7/7)
```

Adversarial inputs executed directly against `normalizeShellCall`: **33**. Of those, **15 produced a
clean, fully-resolved `ActionRecord` (`unresolved: []`) where the real shell executes a command the
record never mentions.** Real-shell semantics for every exploit below were confirmed by running the
same string under `bash` (raw output included in each finding).

The zero-diff claim was verified independently rather than trusted:

```
$ git diff --stat -- src/policy/normalizer/registry.ts src/policy/kernel/ \
    src/policy/normalizer/action-catalog.ts src/policy/normalizer/target-format.ts
(no output)
```

---

## Findings, ranked by blast radius

### 1. `[ISSUE][HIGH][demonstrated]` Newline and `&` are not in the chain-operator table — a leading read-only call hides a trailing mutating one

**Exposure: ~100% of multi-line and `&`-separated shell invocations reaching this normalizer. basis: counted-in-code** (`shell-scanner.ts:63` — `CHAIN_OPERATORS = ["&&", "||", ";", "|"]`, exactly four entries; neither newline nor `&` is present) **+ demonstrated**. Security / data-integrity class, so PRINCIPLES rule 21's narrow-blast-radius cap does not apply.

**Scenario.** An agent session emits a two-line Bash tool call — the most ordinary shape a model
produces when it wants to do two things. `tokenize()` treats newline as plain whitespace (`/\s/`,
`shell-scanner.ts:218`), so both lines collapse into one token stream; `resolveKubectlShape` reads
the verb from `positional[0]` and the resource from the first `/`-bearing token, and the second line
never exists as far as the record is concerned.

```
input:  "kubectl get pods/api --context=prod\nkubectl delete secrets/db-creds --context=prod"
record: CLEAN-RESOLVE verbs=["get"] targets=["prod/cluster/prod/pods/api"] unresolved=[]

input:  "kubectl get pods/api --context=prod & kubectl delete secrets/db-creds --context=prod"
record: CLEAN-RESOLVE verbs=["get"] targets=["prod/cluster/prod/pods/api"] unresolved=[]
```

Real shell, same shapes (raw output of the verification run):

```
$ bash -c 'echo FIRST
echo SECOND-EXECUTED'
FIRST
SECOND-EXECUTED

$ bash -c 'echo FIRST & echo SECOND-EXECUTED'
SECOND-EXECUTED
FIRST
```

The defect reaches through the wrappers, including via the mechanism `at` is documented to use — a
heredoc body, which is multi-line by construction (`wrapper-catalog.ts:124` feeds `bodies.at(-1)`
straight back into `normalizeShellCall`):

```
input:  "at now + 1 minute <<HD\nkubectl get pods/api --context=prod\nkubectl delete secrets/db-creds --context=prod\nHD"
record: CLEAN-RESOLVE verbs=["get"] targets=["prod/cluster/prod/pods/api"] unresolved=[]

input:  "bash -c \"kubectl get pods/api --context=prod\nkubectl delete secrets/db-creds --context=prod\""
record: CLEAN-RESOLVE verbs=["get"] targets=["prod/cluster/prod/pods/api"] deferred=true unresolved=[]

input:  "eval kubectl get pods/api --context=prod & kubectl delete secrets/db-creds --context=prod"
record: CLEAN-RESOLVE verbs=["get"] targets=["prod/cluster/prod/pods/api"] unresolved=[]

input:  "nohup kubectl get pods/api --context=prod\nkubectl delete secrets/db-creds --context=prod &"
record: CLEAN-RESOLVE verbs=["get"] targets=["prod/cluster/prod/pods/api"] unresolved=[]
```

**Current defense, honestly assessed.** The chain-operator detector is real, correct and
mutant-covered for the four operators it lists — `kubectl get pods/api --context=prod && rm -rf /`
correctly denies, and the mutants `chain-operator-table-emptied` and
`chain-operator-quote-liveness-broken` both die. It simply does not list the two separators that need
no special syntax at all. `REQUIREMENTS.md:173` names **"fd-dup ampersand handling"** as part of what
ports for SUR-06..09, so `&` is named scope, not an out-of-scope surprise. `REQUIREMENTS.md:462`
(SUR-06, P0) states the acceptance bar verbatim: *"One leading read-only call cannot disable
evaluation of a later mutating one."* That criterion is demonstrably false today.

**Verdict: BREAKS.**

**Named failing tests required before merge:**
- `SUR-06a: a newline-separated read-then-mutate command reports unresolved`
- `SUR-06a: an '&'-separated read-then-mutate command reports unresolved`
- `SUR-09/at: a heredoc body carrying two commands reports unresolved, never resolves only its first line`

---

### 2. `[ISSUE][HIGH][demonstrated]` A `<<<` herestring is mis-detected as a heredoc marker; every following line is swallowed as inert "body"

**Exposure: ~100% of invocations containing a `<<<` herestring. basis: demonstrated + code-traced** (`shell-scanner.ts:127`). Security / data-integrity class.

**Scenario.** `findLiveHeredocMarker`'s marker regex matches `<<` optionally followed by a quoted or
bare identifier. Against the text `<<<DELIM` the match at index 1 consumes the 2nd and 3rd `<` as the
marker and `DELIM` as the delimiter — both live. `stripHeredocBodies` then eats every subsequent line
as heredoc body (there is no terminating delimiter line), so the only text reaching chain detection,
tokenization and verb/target extraction is line 1.

```
input:  "kubectl get pods/api --context=prod <<<DELIM\nkubectl delete secrets/db-creds --context=prod"
record: CLEAN-RESOLVE verbs=["get"] targets=["prod/cluster/prod/pods/api"] unresolved=[]
```

Real shell — `<<<DELIM` is a herestring (stdin becomes the literal text `DELIM`); the next line is an
ordinary command and runs. Raw output of the verification run:

```
$ bash -c 'cat <<<DELIM
echo SECOND-EXECUTED'
DELIM
SECOND-EXECUTED
```

**Current defense, honestly assessed.** None. This is a distinct root cause from finding 1 and is
**not** fixed by adding newline/`&` to `CHAIN_OPERATORS`: body stripping runs first (`shell.ts:256`),
so the payload lines are gone from `liveText` before `collectSyntaxUnresolved` ever sees them. SUR-08
(`REQUIREMENTS.md:464`) is the criterion this inverts — *"Target extraction shall not lose the target
to its own preprocessing."* Here the preprocessing loses the entire command.

**Verdict: BREAKS.**

**Named failing test required before merge:**
- `SUR-08: a '<<<' herestring is not treated as a heredoc marker — the following line stays live and is evaluated`

---

### 3. `[ISSUE][HIGH][demonstrated]` The directory-flag guard (design-challenger Finding #2's mandated fix) is bypassable by three ordinary spellings — and `-C=` is silently re-read as `--context=`

**Exposure: ~100% of directory-flag invocations written in equals form or long-space form. basis: demonstrated.** Security class (a deliberate policy-evasion surface).

**Scenario.** `matchDirectoryFlagToken` (`flag-catalog.ts:46-57`) recognizes exactly two shapes:
`--directory=<v>`, and the bare short tokens `-C` / `-d` followed by a separate value token. The
three neighbouring spellings a user or a model writes just as readily all slip past:

```
input:  "kubectl delete secrets/db-creds --context=prod --directory /etc"   (long, space-separated)
record: CLEAN-RESOLVE verbs=["delete"] targets=["prod/cluster/prod/secrets/db-creds"] unresolved=[]

input:  "kubectl delete secrets/db-creds --context=prod -d=/etc"            (short, equals form)
record: CLEAN-RESOLVE verbs=["delete"] targets=["prod/cluster/prod/secrets/db-creds"] unresolved=[]

input:  "kubectl delete secrets/db-creds -C=prod"                           (short, equals form)
record: CLEAN-RESOLVE verbs=["delete"] targets=["prod/cluster/prod/secrets/db-creds"] unresolved=[]

contrast - the two shapes that ARE covered:
input:  "kubectl delete secrets/db-creds --context=prod -C /etc"
record: unresolved=["directory flag (-C/-d/--directory) present"]
```

The third case is the worst, and is a second, separate defect in the same code path: `-C=prod` misses
the directory-flag check (its short-form pattern requires a bare token), falls through to
`scanFlags`'s generic short-form branch (`shell.ts:116`), and `resolveFlagAlias` lowercases its input
(`flag-catalog.ts:30`) — so `C` resolves to the canonical `context` alias. A **directory flag
supplies the cluster field**, turning a call that would otherwise be `unresolved` for a missing
`--context` into a clean resolve against an attacker-chosen cluster name.

**Current defense, honestly assessed.** The mandated fix exists, its two regression tests pass, and
its two mutants (`directory-flag-long-form-disabled`, `directory-flag-short-form-disabled`) both die
— but the tests pin exactly the two spellings the code implements, so the suite cannot notice the
other three. `REQUIREMENTS.md:173` names "bash -c / -C / --directory / patch -d resolution" as ported
scope, and `REQUIREMENTS.md:463` (SUR-07, P0) requires detection to survive *"flag reordering,
directory flags, abbreviations"*. Pinning two spellings of a flag is literal detection, not semantic
detection.

**Verdict: BREAKS.**

**Named failing tests required before merge:**
- `Finding #2 (widened): '-C=<path>', '-d=<path>' and '--directory <path>' each report unresolved`
- `Finding #2 (alias collision): '-C=<v>' is never resolved to the canonical 'context' flag`

---

### 4. `[ISSUE][HIGH][demonstrated]` Only the FIRST resource token is extracted — a benign resource masks every later one in the same invocation

**Exposure: ~100% of multi-resource invocations. basis: code-traced** (`shell.ts:192`,
`positional.find((t) => t.includes("/"))` — a `find`, not a filter) **+ demonstrated**.
Data-integrity class.

**Scenario.** `kubectl delete` accepts a list of resources. The record reports only the first, so a
rule that permits pod deletion but denies secret deletion evaluates against `pods/api` and never sees
`secrets/db-creds` — while kubectl deletes both.

```
input:  "kubectl delete pods/api secrets/db-creds --context=prod"
record: CLEAN-RESOLVE verbs=["delete"] targets=["prod/cluster/prod/pods/api"] unresolved=[]
```

The same shape reaches through the `xargs` wrapper, where it is worse: xargs's entire purpose is to
**append arguments from stdin**, invisible to any static parse, yet the wrapper resolves the visible
prefix cleanly instead of reporting the invisible remainder as `unresolved`:

```
input:  "xargs kubectl delete secrets/db-creds --context=prod"
record: CLEAN-RESOLVE verbs=["delete"] targets=["prod/cluster/prod/secrets/db-creds"] unresolved=[]
```

**Current defense, honestly assessed.** The single-resource path is well defended — Issue #65's
exact-2-segment check is intact and its mutant (`resource-token-segment-count-check-broken`) dies.
The gap is the arity assumption, not the parse. S4 also widened this surface: S3's fixed grammar read
`tokens[2]`, whereas S4's order-independent `positional.find` will now skip past intervening tokens
to land on a benign-looking first match. `ActionRecord.targets` is already `string[]`, so nothing
about the record shape forces the singular read.

**Verdict: BREAKS.**

**Named failing tests required before merge:**
- `SUR-06: a multi-resource kubectl invocation reports every resource in targets, or reports unresolved`
- `SUR-09/xargs: an xargs invocation reports unresolved for its stdin-supplied argument list`

---

### 5. `[ISSUE][MED][demonstrated]` Only the FIRST live redirect target is extracted — bash writes every one of them, and stdout lands on the LAST

**Exposure: ~100% of invocations with more than one live redirect. basis: demonstrated + code-traced**
(`shell-scanner.ts:187-202` returns on the first match).

```
input:  "cat payload > /tmp/harmless > /etc/cron.d/pwn"
record: CLEAN-RESOLVE verbs=["write"] targets=["/tmp/harmless"] unresolved=[]

input:  "cat p > /tmp/ok >> /etc/cron.d/pwn"
record: CLEAN-RESOLVE verbs=["write"] targets=["/tmp/ok"] unresolved=[]

input:  "cat p > /tmp/ok 2> /etc/cron.d/pwn"
record: CLEAN-RESOLVE verbs=["write"] targets=["/tmp/ok"] unresolved=[]
```

Real shell — **both** files are opened and truncated, and stdout ends up on the second. Raw output:

```
$ bash -c 'echo payload > ./ok.txt > ./pwn.txt' ; ls -la ok.txt pwn.txt ; cat pwn.txt
-rw-r--r-- 1 mohan 197609 0 Sep  2 18:02 ok.txt
-rw-r--r-- 1 mohan 197609 8 Sep  2 18:02 pwn.txt
payload
```

A deny rule on `/etc/cron.d/**` evaluates against `/tmp/harmless` and allows.

**Current defense, honestly assessed.** Redirect extraction is otherwise solid — the heredoc-line
preservation SUR-08 asks for genuinely works, the additive kubectl-plus-redirect branch works, and
both have live mutants. The defect is the early `return` rather than collecting all matches; "the
first redirect is the effective one" is simply not bash's rule.

**Verdict: BREAKS.**

**Named failing test required before merge:**
- `SUR-08: a command carrying two live redirects reports both targets (or unresolved), never only the first`

---

### 6. `[ISSUE][MED][demonstrated]` The new CI gate `qa:mutation-shell` hard-crashes on any CRLF checkout — including this repo's own working tree — with a message that misdirects the reader

**Exposure: ~100% of runs on a `core.autocrlf=true` checkout; 0% on the Linux CI runner. basis: demonstrated.**

**Scenario.** `.github/workflows/ci.yml` gained a required, non-`continue-on-error` step running
`node src/qa/shell-detector-mutants.ts`. Its mutant anchors are newline-joined literals. This repo has
`core.autocrlf=true` and **no `.gitattributes`**, so tracked, previously-committed files come back
CRLF while newly-created untracked files stay LF — an exact split confirmed here:

```
$ node -e "<count line endings per file>"
src/policy/normalizer/shell.ts           CRLF count: 278  bare-LF count: 0
src/policy/normalizer/shell-scanner.ts   CRLF count: 0    bare-LF count: 255
src/policy/normalizer/flag-catalog.ts    CRLF count: 0    bare-LF count: 57
src/policy/normalizer/wrapper-catalog.ts CRLF count: 0    bare-LF count: 152
anchor found (LF form): false
anchor found (CRLF form): true
```

Every multi-line anchor targeting `shell.ts` therefore misses, and `textMutant` throws
"the source moved or was refactored; update this mutant's anchor" — a message that sends the next
engineer hunting a refactor that never happened. Knock-on: `CHANGELOG.md`'s
`[[completeness: cmd="qa-mutation-shell" expect=28]]` marker cannot be satisfied, and
`qa:completeness-claims` reports `MISMATCH: instrument "qa-mutation-shell" produced no parseable
number in its output`.

**Current defense, honestly assessed.** The gate's substance is genuinely good — re-running the same
staging with `.ts` sources LF-normalized gives `28 of 28 mutant(s) KILLED`, and the
loud-throw-on-missing-anchor design is right in intent. What fails is portability: the anchor
mechanism is byte-literal and the repo has no line-ending policy. A CRITICAL-tier gate that cannot
run on the platform the project is developed on is a gate that will be run rarely.

**Verdict: BREAKS.**

**Named failing test / fix required before merge:**
- `qa:mutation-shell runs green on a CRLF working tree` — satisfied either by adding `.gitattributes`
  with `*.ts text eol=lf`, or by normalizing both `originalSource` and `anchor` in `textMutant` before
  comparison. Fix the message too: distinguish "anchor not found" from "anchor not found after
  normalization".

---

### 7. `[ISSUE][MED][code-traced]` `shell-detector-mutants.ts` makes exactly the hand-derived completeness claim this project's hard rules ban

`src/qa/shell-detector-mutants.ts:8-13` states: *"One mutant per meaningfully distinct decision branch
actually introduced by S4's diff ... derived from the real, shipped code below, not hand-counted or
asserted in advance (this project's own no-hand-derived-completeness-claims hard rule). The list is a
real enumeration of what got built, kept current by the fact that each mutant's `apply()` throws
loudly if its anchor text ever stops existing."*

The instrument named in defence proves a strictly weaker property: that each **listed** mutant still
points at live code. Nothing enumerates the branch set, so the "one mutant per branch" half is
hand-derived prose. The branches with no mutant are not hypothetical — they are precisely the ones
this report exploits:

| Unmutated branch | path:line | Exploited in |
|---|---|---|
| `CHAIN_OPERATORS` membership (which separators count) | `shell-scanner.ts:63` | finding 1 |
| `findLiveHeredocMarker`'s marker regex | `shell-scanner.ts:127` | finding 2 |
| `matchDirectoryFlagToken` shape coverage / precedence over `resolveFlagAlias` | `flag-catalog.ts:46`, `shell.ts:116` | finding 3 |
| `positional.find` single-resource selection | `shell.ts:192` | finding 4 |
| `extractRedirectTarget` first-match `return` | `shell-scanner.ts:199` | finding 5 |

A table-emptying mutant (`CHAIN_OPERATORS = []`) proves the table is consulted; it never asks whether
the table is complete. That is the gap between a mutation gate and a fuzz/differential gate, and the
header comment claims the stronger one.

**Verdict: BREAKS** (against the hard rule, not against the detector).

**Named failing test required before merge:** either downgrade the comment to what the anchor-throw
actually proves, or build the instrument — `qa:mutation-shell asserts a mutant exists for every
decision branch enumerated from the shipped AST`. The honest cheap fix is the former plus a
`docs/backlog.md` line for the latter.

---

### 8. `[SUSPICION][MED][demonstrated]` `qa:completeness-claims` is red at HEAD, not only with this diff — a required CI step appears to be failing on master

```
$ npm run qa:completeness-claims          # with the S4 diff
exit=1
  - docs/decisions.md: 1 of 1 numeric completeness claim(s) failed.
  - CHANGELOG.md: 1 of 1 numeric completeness claim(s) failed.
  -   MISMATCH: instrument "qa-mutation-shell" produced no parseable number in its output

$ git stash push -- docs/decisions.md CHANGELOG.md docs/backlog.md && npm run qa:completeness-claims
BASELINE(HEAD docs): FAIL
  - docs/STATE.md: 2 of 2 numeric completeness claim(s) failed.
  -   NO INSTRUMENT REFERENCE: "...Stage 3 review..." (line 12) - carries no [[completeness: ...]] marker
  -   NO INSTRUMENT REFERENCE: "...Stage 5 (audit)..." (line 15) - carries no [[completeness: ...]] marker
```

`.github/workflows/ci.yml:95-96` runs this as step "QA-15 completeness-claim-checker" with no
`continue-on-error`. The failure predates S4 (the offending rows are `docs/STATE.md`'s and
`docs/decisions.md`'s S3 rows), so this is **not** an S4 defect — but S4 ships under a Definition of
Done that says "policy pass", and it adds one new red line to a gate that is already red. UNPROVEN as
to whether master's CI is actually red: I did not run the workflow.
**Settled by:** `gh run list --workflow=ci.yml --branch master --limit 3` — Manager or any maintainer.

**Verdict: UNPROVEN.** Routes to the Manager, not to this diff.

---

### 9. `[SUSPICION][LOW][derived]` SUR-10's fail-open register does not exist anywhere in the repo

`REQUIREMENTS.md:466` (SUR-10, P0): *"Every fail-open path shall be enumerated and each shall be a
recorded decision"* — naming, among others, "unrecognised syntax" and "malformed input".
`grep -rn "SUR-10"` over `docs/*.md` and `src/**/*.ts` returns nothing. Every one of findings 1-5 is
an unenumerated fail-open, and the `DEPTH_CAP` comment (`shell.ts:53-61`) is currently the closest
thing to a recorded fail-open decision in the codebase. This is very likely a later milestone's
artifact, so it is not charged to S4 — but S4 is the story that created five new entries for it.

**Verdict: UNPROVEN** (as to whether SUR-10 is S4's obligation).
**Settled by:** the Manager checking SUR-10's milestone assignment. Residual-register line, not a test.

---

### 10. `[CLEAN][demonstrated]` The zero-diff claim to `kernel.ts` / `registry.ts` / `action-catalog.ts` / `target-format.ts` holds

Verified independently rather than trusted:

```
$ git diff --stat -- src/policy/normalizer/registry.ts src/policy/kernel/ \
    src/policy/normalizer/action-catalog.ts src/policy/normalizer/target-format.ts
(no output - zero diff)
```

`qa:kernel-purity` and `qa:normalizer-registry-purity` both PASS. ADR-0006's
no-opportunistic-scope-widening clause is respected. **SURVIVES.**

---

### 11. `[CLEAN][demonstrated]` The quoting model matches real bash on every case I could break it with

The asymmetry the design chose — chain operators inert inside *both* quote types, substitution live
inside double quotes but inert inside single quotes — is correct bash semantics, and the escape
handling (backslash-quote and backslash-backslash inside double quotes, no escapes inside single
quotes, backslash-x outside quotes) is right. I attacked it with quote-inside-quote, escaped quotes,
mid-word quotes and ANSI-C `$'...'` quoting:

```
input:  "kubectl get pods/api --context=$(cat /tmp/c)"
record: unresolved=["command/process substitution \"$(\" detected"]
```

The one divergence I found is fail-**closed**: a `#` shell comment containing `&&` is reported as a
live chain operator. That is a false positive, i.e. the correct direction for this component. An
unterminated-quote input does clean-resolve, but no shell will execute that string at all (it is a
parse error), so there is no production trigger. **SURVIVES.**

---

### 12. `[CLEAN][demonstrated]` The `sudo` / `su -c` / `doas` / interpreter-`-c` "grammar accident" still holds after S4's reordering rewrite

design-challenger's residual Finding #4 asked whether S4's order-independent rewrite of
`resolveKubectlShape` silently removed the accident that makes unlisted privilege-elevation and
interpreter wrappers fail closed. It did not — the verb slot is still read from `positional[0]`
(`shell.ts:189`) and every one of these lands a non-catalog token there:

```
sudo kubectl delete secrets/db-creds --context=prod   -> unresolved ["command verb \"kubectl\""]
sudo bash -c "kubectl delete secrets/db-creds ..."    -> unresolved ["command verb \"bash\"", "command flag --context"]
su -c "kubectl delete secrets/db-creds ..."           -> unresolved ["command verb \"-c\"", ...]
python -c "import os; os.system('rm -rf /')"          -> unresolved ["command verb \"-c\"", ...]
perl -e "unlink 'x'"                                  -> unresolved ["command verb \"-e\"", ...]
doas kubectl delete secrets/db-creds --context=prod   -> unresolved ["command verb \"kubectl\""]
xargs -0 kubectl delete secrets/db-creds ...          -> unresolved ["indirect-execution-shaped command does not match a recognized wrapper's expected form"]
```

`wrapper-catalog.ts:8-14` documents the accident plainly instead of dressing it up as coverage, which
is the right call. **SURVIVES** — with the standing caveat that finding 4's `positional.find`
widening is exactly the kind of change that erodes this accident, so it stays a live residual.

---

### 13. `[CLEAN][demonstrated]` Depth cap, inner-`unresolved` propagation, and the mutation gate's own substance

`28 of 28 mutant(s) KILLED` once line endings are normalized (finding 6 is about *running* the gate,
not about its content). The two mutants that matter most here — `depth-cap-check-disabled` and
`inner-unresolved-propagation-broken` — both die, and the at-cap / over-cap tests exist and pass. I
could not construct a nesting that escapes the cap or an inner `unresolved` that is dropped on the
way out. The `at`-heredoc multi-command case (finding 1) reaches the recursion through a different
door, not through this one. **SURVIVES.**

---

## Editorial (verdict-neutral, fix as plain edits, no re-review)

- `shell.ts:15-16` — "zero diff to either, or to `kernel.ts`/`registry.ts`" is accurate, but the
  comment's own list omits `action-catalog.ts` / `target-format.ts` that the preceding sentence names.
- `shell-scanner.ts:88-90` and `121-123` — `hasLiveChainOperator` / `hasLiveSubstitution` are exported
  wrappers with no production caller; they are test-only conveniences. Mark them so or drop them.
- `shell-detector-mutants.ts:17` — "~28 shadow copies" is now exactly 28; the tilde reads as an
  estimate over a set the file itself defines.
- A carriage return inside a command is treated as a token separator by `tokenize` (JS `/\s/` matches
  it) where bash treats it as an ordinary word character. Fail-open in shape but not exploitable
  (bash errors on the resulting word), so editorial rather than a finding.

---

## Findings-to-tests reconciliation

Open findings: **9** (7 `[ISSUE]`, 2 `[SUSPICION]`). Named failing tests: **7** — one per `[ISSUE]`
family, listed under each finding above (findings 1, 3 and 4 each name more than one case, but each
finding maps to exactly one test family). The 2 `[SUSPICION]` findings have no executable form in
this repo and are stated as such: finding 8 is an already-red existing instrument plus a CI-history
question only the Manager can settle; finding 9 is a missing documentation artifact whose ownership
is a milestone question, so it resolves to a residual-register line, not a test.

---

## The single scariest unproven assumption

**That a shell command is one command.** Every branch of this detector — verb from `positional[0]`,
resource from the first `/`-token, target from the first `>`, "chaining" defined as four operators —
assumes the input string names exactly one action, and it reports a clean, fully-resolved,
policy-evaluable record whenever that assumption happens to parse. Bash has at least four ways to put
a second command in one string (newline, `&`, a mis-parsed `<<<` body, a second argument), and all
four currently produce a record that says `unresolved: []`. The component's stated identity is
fail-closed; on the multi-command axis it is fail-open by default, and silent about it.

## Go / no-go

**no-go.** Findings 1-4 are `[HIGH]`, `demonstrated`, and in the security / data-integrity class, so
PRINCIPLES rule 21's narrow-blast-radius cap does not apply to them.

## Single next action

Write the failing test for finding 1 first — `SUR-06a: a newline-separated read-then-mutate command
reports unresolved` — because it is the cheapest reproduction of the scariest assumption, and its
`at`-heredoc variant proves the same bug reaches through a wrapper this story shipped as covered.

---

RECEIPT: verdict=no-go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] Newline and `&` absent from CHAIN_OPERATORS (shell-scanner.ts:63) - "kubectl get pods/api --context=prod\nkubectl delete secrets/db-creds --context=prod" clean-resolves as get-only while bash runs both (verified); reaches through at/bash -c/eval/nohup; SUR-06 P0 acceptance demonstrably false; defense = a correct 4-operator table that omits the two separators needing no syntax. Exposure: ~100% of multi-line/&-separated invocations, basis: counted-in-code.
2. [ISSUE][HIGH][demonstrated] `<<<` herestring mis-matched as a heredoc marker (shell-scanner.ts:127) - following lines stripped as inert body before any chain check while bash executes them (verified); NOT fixed by widening the separator table; defense = none. Exposure: ~100% of `<<<` invocations, basis: demonstrated.
3. [ISSUE][HIGH][demonstrated] Directory-flag guard bypassable via `-C=v`, `-d=v`, `--directory v` (flag-catalog.ts:46), and `-C=v` further aliased to `--context=v` by resolveFlagAlias's lowercasing (flag-catalog.ts:30) so a directory flag SUPPLIES the cluster field; defense = the design-mandated fix exists but its tests pin only the two spellings the code implements. Exposure: ~100% of equals/space-form directory flags, basis: demonstrated.
4. [ISSUE][HIGH][demonstrated] Only the first resource token extracted (shell.ts:192 `positional.find`) - "kubectl delete pods/api secrets/db-creds --context=prod" reports pods/api only while both are deleted; same shape via xargs's stdin args; defense = single-resource path well defended, arity assumption not. Exposure: ~100% of multi-resource invocations, basis: code-traced.
5. [ISSUE][MED][demonstrated] Only the first live redirect target extracted (shell-scanner.ts:199) - "cat p > /tmp/ok > /etc/cron.d/pwn" reports /tmp/ok while bash truncates both and stdout lands on the last (verified); defense = correct extraction, wrong arity.
6. [ISSUE][MED][demonstrated] New CI gate qa:mutation-shell hard-crashes on any CRLF checkout (repo has core.autocrlf=true, no .gitattributes) with a misdirecting "source moved or was refactored" message, and blocks CHANGELOG's expect=28 completeness marker; 28/28 mutants DO kill under LF normalization - portability defect, not a substance defect.
7. [ISSUE][MED][code-traced] shell-detector-mutants.ts:8-13 claims "one mutant per meaningfully distinct decision branch ... not hand-counted"; the anchor-throw only proves listed mutants still point at live code - five unmutated branches named, and they are exactly the ones findings 1-5 exploit (CLAUDE.md no-hand-derived-completeness-claims hard rule).
8. [SUSPICION][MED][demonstrated] qa:completeness-claims exits 1 at HEAD as well as with the diff (docs/STATE.md rows carry no markers) - a required, non-continue-on-error CI step appears red on master; pre-existing, routes to Manager; settled by `gh run list --workflow=ci.yml --branch master --limit 3`.
9. [SUSPICION][LOW][derived] No SUR-10 fail-open register exists anywhere (grep "SUR-10" over docs/ and src/ returns nothing) while findings 1-5 add five unenumerated fail-opens; likely a later milestone's artifact, not charged to S4.
10. [CLEAN][demonstrated] Zero-diff claim to kernel.ts/registry.ts/action-catalog.ts/target-format.ts verified by `git diff --stat` (empty) plus kernel-purity and registry-purity gates PASS - SURVIVES.
11. [CLEAN][demonstrated] Quoting model (chain ops inert in both quote types, substitution live in double / inert in single, escape handling) matches bash under quote-in-quote, escaped-quote, mid-word-quote and ANSI-C-quoting attacks; the one divergence found (# comment) is fail-closed - SURVIVES.
12. [CLEAN][demonstrated] sudo / su -c / doas / python -c / perl -e / xargs -0 all still fail closed after S4's order-independent rewrite (design-challenger residual #4 re-verified over 7 inputs) - SURVIVES.
13. [CLEAN][demonstrated] Depth cap, inner-unresolved propagation and mutation substance: 28 of 28 mutants KILLED on LF-normalized sources; no nesting escaped the cap, no inner unresolved dropped - SURVIVES.
counts (CHECKSUM): issues=7 suspicions=2 clean=4
evidence (CHECKSUM): demonstrated=11 code-traced=1 derived=1
checks=npm test 336 pass/0 fail/0 skip; typecheck PASS; lint PASS; 7 qa gates PASS; qa:completeness-claims FAIL (exit 1, also fails at HEAD); qa:mutation-shell CRASH on CRLF / 28-of-28 KILLED on LF rerun; 33 adversarial inputs executed against normalizeShellCall, 15 wrong clean-resolves; 4 real-bash semantic confirmations
adr=HIT(35)
report=docs/reviews/s4-shell-semantic-detector-red-team-2026-09-02.md
