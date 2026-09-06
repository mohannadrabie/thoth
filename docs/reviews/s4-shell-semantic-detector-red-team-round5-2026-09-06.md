# Red Team (Sutekh) — S4 round-5 re-confirm: Issue #84 fix-now round

- **Date:** 2026-09-06
- **Scope:** the uncommitted fix-now round closing GitHub Issue #84 — `src/policy/normalizer/shell-scanner.ts`, `findLiveRedirectMatches` fd-dup classification. Working tree on `master`, HEAD `54a60aa`, fix NOT yet committed.
- **Tier:** CRITICAL (ratified; not re-litigated).
- **Mandate:** the red-team re-confirm named in `docs/decisions.md`'s 2026-09-06 row and in Issue #84's own Manager comment — "story-implementer must close #84 before any S5 build work starts, confirmed via red-team re-confirm."
- **Verdict:** **no-go.** Issue #84 is **half-closed**. The original repro is genuinely fixed (A/B demonstrated), but the same defect survives one character away, in the same code line, with a strictly more natural filename.
- **ADR cache:** [CACHE=HIT], 35 ADRs reused (adr/devops:12, adr/software-engineering:23), fp 83b2e3e.
- **Exposure calibration (standing, all findings):** ~0% of live sessions today, basis: counted-in-code — `ls -d hooks` returns "No such file or directory"; nothing wires this normalizer to a live session yet. S5 is the story that does. Same calibration basis every S4 finding has used, restated deliberately, not assumed.

---

## 0. What was checked, and how

Nothing below rests on the implementer's receipt. Every claim is re-derived.

| # | Check | Method |
|---|---|---|
| 1 | Diff read | `git diff` on all 6 touched files, `git status --porcelain` |
| 2 | bash ground truth | 25 redirect forms executed against real bash 5.3.9(1)-release in a scratch dir, files listed after each |
| 3 | Live-code PoC | throwaway .ts importing the REAL `normalizeShellCall` / `extractRedirectTargets` / `findLiveRedirectOperatorPositions` via absolute file:// URL — not the project's own tests |
| 4 | A/B behaviour proof | `git stash push -- shell-scanner.ts` then re-run then `git stash pop` |
| 5 | Unlock proof | candidate 2-line fix applied to an isolated `src/` copy in scratch, run against the same 25-case bash-conformance table plus the full 143-test normalizer suite |
| 6 | Completeness claim | my own `grep -rn` over `src/policy/normalizer/`, not the implementer's |
| 7 | Full gate suite | typecheck, lint, test, qa:mutation-shell, qa:kernel-purity, qa:normalizer-registry-purity, frozen-file `git diff --numstat` |

---

## 1. bash ground truth (the fact everything else is graded against)

Run against real bash 5.3.9(1)-release. `files=[...]` is `ls -A` immediately after, in an empty scratch dir.

```text
echo hi >& out                     => files=[out ]
echo hi >&out                      => files=[out ]
echo hi >&2out                     => files=[2out ]        <-- REAL FILE
echo hi >&12x                      => files=[12x ]         <-- REAL FILE
echo hi >&2.txt                    => files=[2.txt ]       <-- REAL FILE
echo hi >&0abc                     => files=[0abc ]        <-- REAL FILE
echo hi >&007x                     => files=[007x ]        <-- REAL FILE
echo hi >&2_1                      => files=[2_1 ]         <-- REAL FILE
echo hi >&1.0                      => files=[1.0 ]         <-- REAL FILE
echo hi >&+2                       => files=[+2 ]          <-- REAL FILE
echo hi >& 2out                    => files=[2out ]        <-- REAL FILE
echo hi >&"out"                    => files=[out ]
echo hi >&2                        => stdout=[hi]                 files=[]   (fd-dup)
echo hi >&02                       => stdout=[hi]                 files=[]   (fd-dup)
echo hi >&12                       => [12: Bad file descriptor]   files=[]   (fd-dup)
echo hi >&9999999999               => [9999999999: Bad fd]        files=[]   (fd-dup)
echo hi >&"2"                      => stdout=[hi]                 files=[]   (fd-dup)
echo hi >&\2                       => stdout=[hi]                 files=[]   (fd-dup)
echo hi >&-                        => [echo: write error: Bad fd] files=[]   (close)
echo hi >&-x                       => [echo: write error: Bad fd] files=[]   (close)
echo hi >&-2                       => [echo: write error: Bad fd] files=[]   (close)
echo hi >&-report.log              => [echo: write error: Bad fd] files=[]   (close)
echo hi >& -x                      => [echo: write error: Bad fd] files=[]   (close)
cat /etc/hosts 2>&out              => [out: ambiguous redirect]   files=[]
echo hello >>&out                  => [syntax error near unexpected token] files=[]
```

**The rule, measured not assumed:** `>&WORD` is fd-dup **iff** WORD is entirely digits, **or** WORD starts with `-`. Every other WORD — including one that merely *begins* with digits — is a real both-streams **file** redirect. This matches the bash manual's own wording ("word may not expand to a number or -"); the manual says *number*, the shipped fix reads *first character*.

---

## 2. Findings, ranked by blast radius

### FINDING 1 — [ISSUE][HIGH][demonstrated] — `>&<digits><non-digits>` still vanishes. Issue #84 is not closed.

**Exposure: ~0% of live sessions today, basis: counted-in-code** (no `hooks/` directory exists). Category: **security / authorization bypass** — exempt from PRINCIPLES rule 21's exposure cap, and gating on that basis, exactly as every prior S4 security finding was.

**Assumption broken.** The fix assumes "the character immediately after `&` tells you whether this is a fd-dup." bash classifies on the **whole word**, not its first character. `src/policy/normalizer/shell-scanner.ts:360-361`:

```ts
const afterAmpersand = liveText[idx + length + 1];
const isFdDup = afterAmpersand === "-" || (afterAmpersand !== undefined && /\d/.test(afterAmpersand));
```

`/\d/.test(afterAmpersand)` is a *single-character* test. Any filename beginning with a digit is therefore still classified as fd-dup and its write target still vanishes.

**Production trigger — and it is the most natural filename shape in ops, not an exotic one:** a date-prefixed log file.

```text
$ bash -c 'echo secret >&2026-09-06.log'
files created: 2026-09-06.log
content:       secret
```

Against the LIVE fixed code (`normalizeShellCall`, real module, real record):

```text
ALLOW {"cmd":"kubectl get pods/api --context=prod >&2026-09-06.log",
       "verbs":["get"],"targets":["prod/cluster/prod/pods/api"],"unresolved":[]}
DENY  {"cmd":"kubectl get pods/api --context=prod >& 2026-09-06.log",
       "verbs":[],"targets":[],"unresolved":["command assembles 2 targets - denied wholesale ..."]}
DENY  {"cmd":"kubectl get pods/api --context=prod > 2026-09-06.log",
       "verbs":[],"targets":[],"unresolved":["command assembles 2 targets - denied wholesale ..."]}
```

**Deleting one space flips deny to allow.** The record claims a clean read against a read-only allowlist while bash creates and writes the file. This is Issue #84's own sentence, verbatim, with a digit-leading filename.

More of the same family, all live-code output:

```text
ALLOW {"cmd":"kubectl get pods/api --context=prod >&2out",  "scannerTargets":[],"verbs":["get"],"unresolved":[]}
ALLOW {"cmd":"kubectl get pods/api --context=prod >&12x",   "scannerTargets":[],"verbs":["get"],"unresolved":[]}
ALLOW {"cmd":"kubectl get pods/api --context=prod >&2.txt", "scannerTargets":[],"verbs":["get"],"unresolved":[]}
```

**Current defense, honestly assessed.** Real and non-zero — the fix closes the `>&WORD`-with-alphabetic-first-character case completely, and the Issue #82 assembled-target guard does fire correctly once a target *is* produced (Finding 9). The defense simply does not extend to a word whose first character is a digit. There is no second layer behind it: `extractRedirectTargets` returning `[]` is terminal, and the multi-target guard is starved by construction — precisely the mechanism Issue #84's own title names.

**Verdict: BREAKS.**

**Named proof-test required before merge (day-1 failing test):**
`Issue #84 residual (round 5): "kubectl get pods/api --context=prod >&2026-09-06.log" must DENY — >&WORD is fd-dup only when WORD is ALL digits or starts with "-"` in `src/policy/normalizer/shell.test.ts`.

**Unlock — proven, not asserted.** Two lines, still narrower than the redirect-grammar rewrite the 2026-09-06 human ruling declined, and it reuses the `tokenize` this same function's caller already calls one line later:

```ts
const [fdWord] = tokenize(liveText.slice(idx + length + 1));
const isFdDup = fdWord !== undefined && (fdWord.startsWith("-") || /^\d+$/.test(fdWord));
```

Applied to an isolated copy of `src/` in scratch (repo untouched), against the 25-form bash-conformance table above:

```text
25/25 pass, 0 fail (expectations = observed bash 5.3.9 behavior)
```

and against the existing normalizer suite unchanged:

```text
$ node --test src/policy/normalizer/shell.test.ts src/policy/normalizer/shell-scanner.test.ts
tests 143 | pass 143 | fail 0 | skipped 0
```

Note for whoever applies it: two mutant anchors in `src/qa/shell-detector-mutants.ts` (`trailing-ampersand-word-form-treated-as-fd-dup`, `trailing-ampersand-digit-dash-check-inverted`) quote the old text and will report MUTATION-NOOP — they must be re-anchored in the same commit, and a new mutant added for the all-digits-vs-digit-prefix distinction itself.

---

### FINDING 2 — [ISSUE][LOW][demonstrated] — the same one-character read also misfires fail-closed, fabricating write targets bash never creates.

**Exposure: ~0% of live sessions today, basis: counted-in-code.** Not security — the direction is over-approximation (deny something bash would not write). Filed at LOW deliberately; it does **not** gate, and it needs no separate Issue.

Live-code output vs. measured bash:

| command | bash 5.3.9 | shipped code |
|---|---|---|
| `cat payload >&"2"` | fd-dup, no file | `verbs:["write"] targets:["2"]` |
| `cat payload >&\2` | fd-dup, no file | `verbs:["write"] targets:["2"]` |
| `cat payload >& -x` | closes fd, no file | `verbs:["write"] targets:["-x"]` |
| `cat payload 2>&out` | ambiguous redirect, no file | `verbs:["write"] targets:["out"]` |
| `cat payload >>&out` | syntax error, no file | `verbs:["write"] targets:["out"]` |

Same root cause, and the **same 2-line unlock from Finding 1 fixes all five** — the conformance table pins each one. Stated plainly: once S5 wires deny-by-default, these become spurious denials of legitimate fd-dup calls — a usability cost, not a safety one.

**Verdict: BREAKS (fidelity), fail-closed.** Resolves with Finding 1's second test: `extractRedirectTargets bash-conformance table — 25 named >& forms match bash 5.3.9` in `src/policy/normalizer/shell-scanner.test.ts`.

---

### FINDING 3 — [SUSPICION][LOW][demonstrated] — the completeness claim is literally true but scoped to a question that could not have found Finding 1.

The CHANGELOG asserts, and I reproduced exactly:

```text
$ grep -rn '=== "&"' src/policy/normalizer/ | grep -v '.test.ts'
src/policy/normalizer/shell-scanner.ts:194:      ch === "&" &&
src/policy/normalizer/shell-scanner.ts:351:      idx > 0 && liveText[idx - 1] === "&" && ...
src/policy/normalizer/shell-scanner.ts:352:    if (liveText[idx + length] === "&") {
src/policy/normalizer/wrapper-catalog.ts:69:      return last === "&" || last.endsWith("&") ? "match" : "shape-mismatch";
src/policy/normalizer/wrapper-catalog.ts:75:      if (last === "&") {
```

The claim ("this is a digit-vs-word classification question, not the `isLiveGreaterThan` liveness class") is **accurate as written**, and the grep is real. But the recurrence question that mattered was *"where does redirect-word classification read ONE character where bash reads a WHOLE word?"* — and the answer sits at `shell-scanner.ts:361`, inside the fix itself. A grep for `=== "&"` structurally cannot surface a `/\d/.test(...)` line. Per CLAUDE.md's no-hand-derived-completeness rule, the instrument that answers the real question is a bash-conformance table; none existed. The 25-case table in section 1 is that instrument and should ship with the fix.

**Verdict: UNPROVEN → resolved by shipping the conformance table as a test.**

---

### FINDING 4 — [SUSPICION][LOW][demonstrated] — the frozen-file zero-diff claim, as literally worded, can pass vacuously.

CHANGELOG (this entry and three prior ones) claims "zero diff to kernel.ts/action-catalog.ts/target-format.ts/registry.ts confirmed via `git diff --stat`". Three of those four paths do not exist at repo root or directly under `src/policy/`:

```text
$ find src -name kernel.ts -o -name action-catalog.ts -o -name target-format.ts -o -name registry.ts
src/policy/kernel/kernel.ts
src/policy/normalizer/action-catalog.ts
src/policy/normalizer/registry.ts
src/policy/normalizer/target-format.ts

$ git diff --stat -- src/policy/kernel.ts ; echo "exit=$?"
exit=0            # silent, exit 0 — an unmatched pathspec proves nothing
```

**The conclusion is nevertheless correct** — I re-ran it against the real paths:

```text
$ git diff --numstat -- src/policy/kernel/kernel.ts src/policy/normalizer/action-catalog.ts \
    src/policy/normalizer/target-format.ts src/policy/normalizer/registry.ts
(no output — 0 lines)
```

So the invariant holds. What does not hold is the *check as documented*: a reader copying those paths gets a green light from a query that matched nothing. Resolves as a residual-register line, or a one-line QA guard that fails when a frozen pathspec matches zero tracked files.

**Verdict: UNPROVEN (instrument quality); the invariant itself SURVIVES.**

---

### FINDING 5 — [CLEAN][demonstrated] — Issue #84's original repro IS genuinely closed. Behaviour change proven by A/B, not by a passing test.

`git stash push -- src/policy/normalizer/shell-scanner.ts`, re-run, `git stash pop`:

```text
########## WITH FIX (working tree) ##########
DENY  {"cmd":"kubectl get pods/api --context=prod >& out","verbs":[],"targets":[],"unresolved":["command assembles 2 targets ..."]}
DENY  {"cmd":"kubectl get pods/api --context=prod > out", "verbs":[],"targets":[],"unresolved":["command assembles 2 targets ..."]}
########## WITHOUT FIX (shell-scanner.ts at HEAD) ##########
ALLOW {"cmd":"kubectl get pods/api --context=prod >& out","verbs":["get"],"targets":["prod/cluster/prod/pods/api"],"unresolved":[]}
DENY  {"cmd":"kubectl get pods/api --context=prod > out", "verbs":[],"targets":[],"unresolved":["command assembles 2 targets ..."]}
```

ALLOW to DENY, and it now matches its own un-ampersanded control exactly. The glued spelling `>&out` behaves identically. This half of the fix is real. **SURVIVES.**

---

### FINDING 6 — [CLEAN][demonstrated] — genuine fd-dup forms are not regressed.

Live-code output; every one matches measured bash:

```text
{"cmd":"cat payload > /tmp/ok 2>&1",               "verbs":["write"],"targets":["/tmp/ok"],"unresolved":[]}
{"cmd":"cat payload > /tmp/ok >&-",                "verbs":["write"],"targets":["/tmp/ok"],"unresolved":[]}
{"cmd":"kubectl get pods/api --context=prod >&2",  "scannerTargets":[],"verbs":["get"],"unresolved":[]}
{"cmd":"kubectl get pods/api --context=prod >&12", "scannerTargets":[],"verbs":["get"],"unresolved":[]}
{"cmd":"cat payload >&-x",                         "scannerTargets":[]}   # bash: closes fd, no file - correct
{"cmd":"cat payload >&-report.log",                "scannerTargets":[]}   # bash: closes fd, no file - correct
```

Multi-digit `>&12`, the close form `>&-`, and — notably — the dash-prefixed word forms `>&-x` / `>&-report.log` all agree with bash. The `-` half of the conditional is correct as shipped; only the digit half is wrong. **SURVIVES.**

---

### FINDING 7 — [CLEAN][demonstrated] — the `&>` / `&>>` synonym is untouched.

```text
{"cmd":"kubectl get pods/api --context=prod &> out",  "scannerTargets":["out"],"opPositions":[36],"unresolved":["command assembles 2 targets ..."]}
{"cmd":"kubectl get pods/api --context=prod &>out",   "scannerTargets":["out"],"opPositions":[36],"unresolved":["command assembles 2 targets ..."]}
{"cmd":"kubectl get pods/api --context=prod &>> out", "scannerTargets":["out"],"opPositions":[36],"unresolved":["command assembles 2 targets ..."]}
```

`opPositions` is 36, i.e. `tokenStart` correctly shifted to the `&` — the Issue #80 token-exclusion contract the leading-ampersand branch owns. Unchanged by the new trailing branch. **SURVIVES.**

---

### FINDING 8 — [CLEAN][demonstrated] — the round-3.5 quote/escape-liveness defect class is NOT reintroduced by the two new raw-character reads.

The fix adds two raw reads that consult neither `states[]` nor `escaped[]` — `liveText[idx + length]` (line 352) and `liveText[idx + length + 1]` (line 360). That is exactly the shape of Issue #83. I attacked it and it holds, for a structural reason worth recording:

- `escaped[idx + length]` can never be true: it would require `liveText[idx + length - 1]` to be a live backslash, but that position is the last `>` of the matched operator.
- `states[idx + length] !== "none"` can never be true either: an open span at that index implies the span opened at or before `idx`, which would have been rejected one line earlier by the `states[idx] !== "none"` continue — and a span *opening* at `idx + length` puts a quote character there, not `&`.
- The same argument transfers to `idx + length + 1`: a quote character there is neither a digit nor a dash, so it correctly falls to the word branch.

Demonstrated, live code:

```text
{"cmd":"echo a \>& out",      "scannerTargets":[],"unresolved":["command separator \"&\" detected outside quotes"]}
{"cmd":"cat payload \>&2out", "scannerTargets":[],"unresolved":["command separator \"&\" detected outside quotes"]}
{"cmd":"echo 'a >& out'",      "scannerTargets":[],"unresolved":["command verb \"a >& out\"", ...]}
{"cmd":"echo \"a >& out\"",    "scannerTargets":[],"unresolved":["command verb \"a >& out\"", ...]}
```

An escaped `\>` correctly falls through to the Issue #70 command-separator denial (matching bash, where an escaped `>` is literal and the `&` really is a background operator); quoted spans stay fully inert. **SURVIVES.**

---

### FINDING 9 — [CLEAN][demonstrated] — the `length + 1` extension, token exclusion, and the Issue #82 assembled-target guard all interlock correctly.

A `>&WORD` redirect **does** count as an assembled target for the multi-target guard, and the glued spelling **is** excluded from `positional` at the right offset:

```text
{"cmd":"cat payload > /tmp/a >& /tmp/b","scan":["/tmp/a","/tmp/b"],"pos":[12,21],
 "tok":[[0,"cat"],[4,"payload"],[12,">"],[14,"/tmp/a"],[21,">&"],[24,"/tmp/b"]],
 "unresolved":["command assembles 2 targets ..."]}
{"cmd":"cat payload >& /tmp/a >& /tmp/b","scan":["/tmp/a","/tmp/b"],"pos":[12,22], ... denies at 2}
{"cmd":"kubectl get pods --context=prod >&out","scan":["out"],"pos":[32],
 "tok":[[0,"kubectl"],[8,"get"],[12,"pods"],[17,"--context=prod"],[32,">&out"]],
 "verbs":["get","write"],"targets":["out"]}
```

The `>&out` token starts at 32, `opPositions` reports 32, so it is excluded from `positional` rather than leaking in as a fake resource — and no target is extracted as `&out`, confirming the `length + 1` extension does what its comment claims. **SURVIVES.**

---

### FINDING 10 — [CLEAN][demonstrated] — the full gate suite is green and the frozen files are genuinely untouched.

```text
$ npm run typecheck   -> tsc --noEmit -p tsconfig.json      (clean, exit 0)
$ npm run lint        -> eslint .                            (clean, exit 0)
$ npm test
  tests 425 | suites 0 | pass 425 | fail 0 | cancelled 0 | skipped 0 | todo 0 | duration_ms 13244.637
$ npm run qa:mutation-shell
  [QA-06 shell-detector-mutants] PASS: 52 of 52 mutant(s) KILLED.
$ npm run qa:kernel-purity
  [QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
$ npm run qa:normalizer-registry-purity
  [QA normalizer-registry-purity-check] PASS: src/policy/normalizer/registry.ts: zero dispatch-chain/sibling-normalizer-import violations.
$ git diff --numstat -- <the four frozen files, REAL paths>
  (0 lines - genuine zero diff)
$ git diff --numstat
  10  0 CHANGELOG.md
  40  0 src/policy/fixtures/normalizer-calls.ts
  32  0 src/policy/normalizer/shell-scanner.test.ts
  17  1 src/policy/normalizer/shell-scanner.ts
  57  0 src/policy/normalizer/shell.test.ts
  42  4 src/qa/shell-detector-mutants.ts
```

**425 pass / 0 fail / 0 skipped** — skipped is genuinely zero, checked. The mutation gate is non-vacuous by construction: `summarizeMutationRun` (`src/qa/mutation-harness.ts:114-126`) fails the run on any MUTATION-NOOP, so 52/52 KILLED with 0 NOOP proves every anchor actually matched. The 6-file diff surface matches the implementer's stated scope exactly. **SURVIVES.**

---

## 3. Open findings vs failing tests (PRINCIPLES rule 19)

| Open finding | Named failing test |
|---|---|
| Finding 1 (HIGH) | `Issue #84 residual (round 5): "kubectl get pods/api --context=prod >&2026-09-06.log" must DENY - >&WORD is fd-dup only when WORD is ALL digits or starts with a dash` - `src/policy/normalizer/shell.test.ts` |
| Finding 2 (LOW) | `Issue #84 residual: extractRedirectTargets bash-conformance table - 25 named >& forms match observed bash 5.3.9` - `src/policy/normalizer/shell-scanner.test.ts` |

**open findings = 2, failing tests = 2.** Findings 3 and 4 are [SUSPICION], not open defects: Finding 3 is satisfied by shipping Finding 2's conformance table (it *is* the missing instrument); Finding 4 resolves to a residual-register line or a one-line frozen-pathspec guard, and its underlying invariant already verifies clean.

---

## 4. Editorial (verdict-neutral, fix as plain edits, no re-review)

1. `CHANGELOG.md` - the four frozen files are named by bare basename; the real paths are `src/policy/kernel/kernel.ts`, `src/policy/normalizer/action-catalog.ts`, `src/policy/normalizer/target-format.ts`, `src/policy/normalizer/registry.ts` (see Finding 4). The same wording appears in three earlier entries.
2. `shell-scanner.ts:357` - the comment claiming the fix mirrors `precededByLiveAmpersand`'s single-character adjacency check is not a valid analogy: that check genuinely only needs one character (an ampersand *is* one character), whereas a redirect *word* is not. The comment reads as a justification for the defect in Finding 1.
3. `shell-scanner.ts:361` - the `afterAmpersand !== undefined` guard is redundant; testing the digit regex against `undefined` coerces to the string "undefined" and is already false. Cosmetic only.

---

## 5. Scariest unproven assumption, go/no-go, next action

**Scariest unproven assumption:** that a single-character lookahead is a sufficient model of bash redirect-word classification. It is not - and the same assumption has now produced a HIGH finding in consecutive rounds against this one function (#81, then #83, then #84, now this). Each fix was narrowed to the exact repro the previous report handed over, and each time the *class* survived one character to the left or right. Round 3 read the wrong character's liveness; round 4 read the wrong *number* of characters. The repro-shaped fix is the pattern, and this round is its next instance - a design signal, not a coincidence. The proposed unlock is deliberately the first one graded against a measured external oracle (real bash) rather than against the repro it was handed.

**Verdict: no-go.** Issue #84 must **not** be closed, and S5 build work must not start on the strength of this round. It is a genuine and material improvement - half the defect really is gone, proven by A/B - but the human ruling's precondition ("close #84 before any S5 build work") is not yet met.

**Single next action:** apply the proven 2-line whole-word fix at `src/policy/normalizer/shell-scanner.ts:360-361`, re-anchor the two stale mutants in `src/qa/shell-detector-mutants.ts`, and land the 25-case bash-conformance table as a real test file - then re-run this same round-5 re-confirm against it.

---

## Appendix - provenance

- Repo `c:\playground\thoth`, branch `master`, HEAD `54a60aa` (fix uncommitted in the working tree at time of review).
- bash 5.3.9(1)-release.
- PoC / conformance harness written to the session scratchpad, not the repo; repo working tree verified unchanged after the `git stash` A/B (`git status --porcelain` identical before and after).

---

```text
RECEIPT: verdict=no-go
attacks (ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] '>&<digit-leading non-numeric WORD>' (e.g. '>&2026-09-06.log', '>&2out', '>&12x') still classified as fd-dup, write target vanishes, 'kubectl get pods/api --context=prod >&2026-09-06.log' clean-resolves as a read while bash 5.3.9 creates and writes the file; one deleted space flips deny to allow. Defense (digit/dash char-check at shell-scanner.ts:360-361) is real but reads ONE character where bash reads the WHOLE word. Issue #84 half-closed. Exposure: ~0% of live sessions today, basis: counted-in-code (no hooks/ dir); security category, rule-21 exempt.
2. [ISSUE][LOW][demonstrated] Same one-character read misfires fail-closed on '>&"2"', '>&\2', '>& -x', '2>&out', '>>&out' - fabricates write targets bash never creates; over-approximation, not a bypass; same 2-line unlock fixes all five.
3. [SUSPICION][LOW][demonstrated] Completeness claim reproduced and literally true, but scoped to a '=== "&"' grep that structurally could not surface the '/\d/.test()' residual in finding 1; the real instrument (a bash-conformance table) did not exist.
4. [SUSPICION][LOW][demonstrated] Frozen-file zero-diff claim names 3 of 4 paths that do not exist; 'git diff --stat -- <unmatched>' exits 0 silently, so the check as documented can pass vacuously. Re-verified against real paths: invariant genuinely holds.
5. [CLEAN][demonstrated] Issue #84 original repro genuinely closed - git-stash A/B proves ALLOW->DENY behaviour change, now matching its un-ampersanded control; glued '>&out' identical.
6. [CLEAN][demonstrated] Genuine fd-dup forms not regressed: '2>&1', '>&2', '>&12', '>&-', '>&-x', '>&-report.log' all agree with measured bash; the dash half of the conditional is correct as shipped.
7. [CLEAN][demonstrated] '&>' / '&>>' synonym untouched - tokenStart still shifts to the ampersand (opPositions 36), Issue #80 contract intact.
8. [CLEAN][demonstrated] Round-3.5 quote/escape-liveness class NOT reintroduced: both new raw reads are provably unreachable by a quoted or escaped character; escaped '\>&' still denies via the Issue #70 separator, quoted spans inert.
9. [CLEAN][demonstrated] 'length + 1' extension, position-based token exclusion, and the Issue #82 assembled-target guard interlock correctly - '>&WORD' counts as an assembled target and denies at 2; no '&out'-shaped bogus target.
10. [CLEAN][demonstrated] Full gate suite green and frozen files genuinely untouched; mutation gate non-vacuous by construction (MUTATION-NOOP fails the run).
counts (CHECKSUM): issues=2 suspicions=2 clean=6
evidence (CHECKSUM): demonstrated=10 code-traced=0 derived=0
checks=npm test 425 pass / 0 fail / 0 skipped; npm run typecheck clean; npm run lint clean; npm run qa:mutation-shell 52/52 KILLED 0 NOOP; npm run qa:kernel-purity PASS; npm run qa:normalizer-registry-purity PASS; frozen-file git diff --numstat 0 lines (real paths); bash 5.3.9 oracle 25 forms executed; candidate-fix conformance 25/25 pass + normalizer suite 143/143 pass
adr=HIT(35)
report=docs/reviews/s4-shell-semantic-detector-red-team-round5-2026-09-06.md
```
