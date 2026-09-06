# Red Team (Sutekh) — S4 round-6 fast final re-confirm: Issue #84 close-out

- **Date:** 2026-09-06
- **Scope:** the uncommitted round-6 fix applying red-team's own round-5 candidate — `src/policy/normalizer/shell-scanner.ts` `findLiveRedirectMatches`, plus the conformance-table test, the #84 residual regression test, and the mutant re-anchoring. Working tree on `master`, HEAD `2869227`, 7 files modified, nothing committed.
- **Tier:** CRITICAL (ratified; not re-litigated).
- **Mandate:** the fast final re-confirm named in the human's Option A ruling on `docs/reviews/s4-shell-semantic-detector-issue84-path-forward-2026-09-06.md` and logged in `docs/decisions.md`'s 2026-09-06 Option-A row.
- **Verdict:** **go.** Issue #84's defect is dead — proven independently, not accepted on receipt. Two findings remain, neither in the detector: one MED (a required CI gate is red) and one LOW (an unresolvable prose citation).
- **ADR cache:** `[CACHE=HIT]`, 35 ADRs reused (adr/devops:12, adr/software-engineering:23), fp 83b2e3e.
- **Exposure calibration (standing, all detector findings):** ~0% of live sessions today, basis: counted-in-code — no `hooks/` directory exists; nothing wires this normalizer to a live session yet. S5 is the story that does. Same basis every S4 round has used.

---

## 0. What was checked, and how

Nothing below rests on the implementer's receipt or on the new test files' own pass.

| # | Check | Method |
|---|---|---|
| 1 | Fix identity | `git diff` on `shell-scanner.ts`, compared character-by-character to the round-5 report's Finding-1 unlock block |
| 2 | bash ground truth | 25 forms **re-executed this round** against real bash 5.3.9(1)-release in fresh `mktemp -d` dirs, `ls -A` after each |
| 3 | Live-code conformance | my own throwaway `.ts` importing the REAL `extractRedirectTargets` / `normalizeShellCall` / `findLiveRedirectOperatorPositions` by absolute `file://` URL, and the REAL exported fixture — not the repo's tests |
| 4 | Adversarial extension | 14 **additional** `>&` forms NOT in the committed table, each graded against a fresh bash run, classified AGREE / OVER(fail-closed) / UNDER(bypass) |
| 5 | Slice-boundary attack | 6 prefix-quoting / escaped-space / quoted-space shapes probing the one structural risk `tokenize(slice)` introduces |
| 6 | Mutant non-vacuity | I applied the new mutant to the REAL file myself, ran the suite, restored, and compared `git hash-object` before/after |
| 7 | Anchor resolution | scripted occurrence count of all 5 branch anchors in the live source; runtime `MUTANTS.length` + duplicate-id check |
| 8 | Full gate suite | build, typecheck, lint, test, and **every** `qa:*` script — with true exit codes, not `tail`'s |
| 9 | Pre-existing vs introduced | detached `git worktree` at HEAD to grade the red gate without touching the working tree |

---

## 1. Fix identity — byte-identical, not a variant

Round-5 report Finding 1 proposed:

```ts
const [fdWord] = tokenize(liveText.slice(idx + length + 1));
const isFdDup = fdWord !== undefined && (fdWord.startsWith("-") || /^\d+$/.test(fdWord));
```

Shipped at `src/policy/normalizer/shell-scanner.ts:364-365`: **identical, character for character.** Surrounding comment rewritten (the round-5 Editorial item 2 fix); no other logic touched in the function.

---

## 2. bash ground truth, re-measured this round

Re-ran the 25-form oracle rather than trusting round 5's table. Output identical to round 5, so the rule holds unchanged:

> `>&WORD` is fd-dup **iff** WORD is entirely digits, **or** WORD starts with `-`. Every other WORD — including one that merely *begins* with digits — is a real file redirect.

---

## 3. Findings, ranked by blast radius

### FINDING 1 — [ISSUE][MED][demonstrated] — the QA-15 completeness gate is RED, and CI runs it unconditionally.

**Exposure: 100% of CI runs on this branch, basis: counted in code** — `.github/workflows/ci.yml:95-96` runs `node src/qa/completeness-claim-checker.ts` as an unconditional step.

```text
$ npm run qa:completeness-claims ; echo exit=$?
[QA-15 completeness-claim-checker] FAIL: 1 of 3 file(s) had a failing completeness claim.
  - CHANGELOG.md: 1 of 1 numeric completeness claim(s) failed.
  -   MISMATCH: claim says 49, instrument "qa-mutation-shell" re-run reports 53 ([[completeness: cmd="qa-mutation-shell" expect=49]])
exit=1
```

The marker lives at `CHANGELOG.md:14`. The mutant count moved 49 -> 52 (round 4) -> 53 (this round); the marker never moved.

**Pre-existing or introduced?** Graded in a detached worktree so the working tree was never touched:

```text
$ git worktree add <scratch>/head-wt HEAD --detach
worktree at HEAD=2869227
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] FAIL: 1 of 3 file(s) had a failing completeness claim.
  -   MISMATCH: claim says 49, instrument "qa-mutation-shell" re-run reports 52 ...
```

**Already red at HEAD** (49 vs 52). This round does not introduce the failure; it widens the delta to 49 vs 53 while explicitly editing that same CHANGELOG section, and does not fix it.

**Current defense, honestly assessed.** The instrument itself is excellent and worked exactly as designed — it caught a hand-derived number drifting from its instrument, which is precisely CLAUDE.md's "No hand-derived completeness claims" hard rule made executable. The defense that failed is the *habit*: three consecutive rounds edited the mutant count in prose without re-running the gate that checks it.

**My own miss, disclosed.** Round 5's report claimed "the full gate suite is green" on the strength of 7 gates. There are 16. This gate was red then too, and I did not run it. That claim was over-broad and I am correcting it here.

**Severity honestly bounded.** Irreversibility: zero (a one-character-class edit). Silence: none — it fails loudly. It does not touch the detector, the kernel, or any security boundary. It is MED solely because it is a **required DoD gate that is currently red**, which makes the change not merge-ready.

**Recurrence note.** This is the second QA-15 staleness failure on this project (Issue #79, closed, was the first — a different marker in `docs/decisions.md`). Two instances in one story is a class, and `qa:recurring-findings` currently registers only 1 class — this one is not among them.

**Verdict: BREAKS.**

**Named failing check (the gate IS the test):** `npm run qa:completeness-claims` — currently exit 1, must be exit 0.
**Unlock:** `CHANGELOG.md:14`, `expect=49` -> `expect=53`. Then re-run the gate.

---

### FINDING 2 — [ISSUE][LOW][demonstrated] — a fresh bare-basename citation, in the very sentence that fixes bare-basename paths.

```text
$ npm run qa:reference-resolver
[QA-14 reference-resolver] FAIL: 89 of 235 citation(s) failed to resolve.
  - [unresolved-authority] shell-scanner.ts:357 — shell-scanner.ts does not exist
```

`CHANGELOG.md:56` cites the `shell-scanner.ts:357`-area comment — a bare basename the project's own citation resolver cannot resolve. It sits inside the sentence recording the fix for round-5 Finding 4, which was *about* bare basenames not resolving. Same defect class, same paragraph, one clause later.

**Shared blame, stated plainly:** my own round-5 report used that exact citation shape first (`docs/reviews/s4-shell-semantic-detector-red-team-round5-2026-09-06.md:335`), and the implementer echoed it. This is as much my defect as theirs.

**Verdict: BREAKS (LOW).** No Issue filed (LOW per CLAUDE.md). Fix: `src/policy/normalizer/shell-scanner.ts:357`.

---

### FINDING 3 — [SUSPICION][LOW][demonstrated] — QA-14's CI verdict cannot be settled from this environment.

`qa:reference-resolver` exits 1 locally, but 88 of its 89 failures are `cannot verify (no issue-tracker access) — fails closed, not silently skipped` — environment-dependent by design. CI invokes it with base/head refs and, presumably, a token. I cannot determine whether CI is red on QA-14.

**Verdict: UNPROVEN-pending-verification.** Settles with: the CI job's own QA-14 step on a pushed branch, or `node src/qa/reference-resolver.ts <base> <head>` with a GitHub token in the environment. Who: CI, or a human with a token. Only Finding 2's path citation is environment-independent, and it is graded there.

---

### FINDING 4 — [CLEAN][demonstrated] — the round-5 HIGH repro is dead, and now matches both its controls exactly.

Live code, real fixture, real `normalizeShellCall`:

```text
DENY  "kubectl get pods/api --context=prod >&2026-09-06.log"   scan=["2026-09-06.log"] ops=[36] unres="command assembles 2 targets — denied wholesale"
DENY  "kubectl get pods/api --context=prod >& 2026-09-06.log"  scan=["2026-09-06.log"] ops=[36] unres="command assembles 2 targets — denied wholesale"
DENY  "kubectl get pods/api --context=prod > 2026-09-06.log"   scan=["2026-09-06.log"] ops=[36] unres="command assembles 2 targets — denied wholesale"
DENY  "kubectl get pods/api --context=prod >&2out"             scan=["2out"]
DENY  "kubectl get pods/api --context=prod >&12x"              scan=["12x"]
DENY  "kubectl get pods/api --context=prod >&2.txt"            scan=["2.txt"]
```

The glued, spaced and un-ampersanded spellings are now indistinguishable to the policy record. Deleting a space no longer flips deny to allow. **SURVIVES.**

---

### FINDING 5 — [CLEAN][demonstrated] — 25/25 live conformance against the freshly re-measured oracle.

```text
CONFORMANCE(live extractRedirectTargets): 25/25 pass, 0 fail
```

Run by my own harness against the real module, with expectations set from this round's own bash run — not from the committed test's expectations. **SURVIVES.**

---

### FINDING 6 — [CLEAN][demonstrated] — zero bypasses across 14 forms the committed table does NOT cover.

I graded each against a fresh bash run. `UNDER` = detector misses a file bash creates (a real bypass); `OVER` = detector invents one (fail-closed).

```text
echo hi >& 2               []        []        AGREE
echo hi >& -               []        []        AGREE
echo hi >& 02              []        []        AGREE
echo hi >&                 []        []        AGREE
echo hi >>&2               []        []        AGREE
echo hi >&2 >&out          ["out"]   ["out"]   AGREE
echo hi >&out >&2          ["out"]   ["out"]   AGREE
echo hi >&"2x"             ["2x"]    ["2x"]    AGREE
echo hi >&2"x"             ["2x"]    ["2x"]    AGREE
echo hi >&"2"x             ["2x"]    ["2x"]    AGREE
echo hi >&2\-              []        ["2-"]    OVER(fail-closed)
echo hi >& out extra       ["out"]   ["out"]   AGREE
echo hi 1>&2out            ["2out"]  ["2out"]  AGREE
echo hi 3>&out2            []        ["out2"]  OVER(fail-closed)

agree=12 over(fail-closed)=2 under(BYPASS)=0
```

Also probed and DENIED (fail-closed): an Arabic-Indic digit target (`/^\d+$/` is ASCII-only, and here that is the safe direction), digit + zero-width space, `>&$(id)` (substitution guard fires), `>&"unterminated` (unterminated-quote guard fires). **SURVIVES.**

---

### FINDING 7 — [CLEAN][demonstrated] — the slice-boundary quote-state risk the fix introduces does not bite.

`tokenize(liveText.slice(idx + length + 1))` recomputes `quoteStates` on a **slice**, losing the prefix's quote context. Structurally that is safe — a live-but-unclosed quote before `idx` would have made `states[idx] !== "none"` and skipped the branch one line earlier — and it holds empirically:

```text
"cat \"a\" >&2\"x\""            scan=["2x"]              unres=[]     bash: 2x
"cat \\\" >&2out"               scan=["2out"]            unres=[]     bash: 2out
"cat 'a' >&2out"                scan=["2out"]            unres=[]     bash: 2out
"cat x >&\"2"                   scan=[]  unres="unterminated quote — cannot confidently …"  bash: syntax error
"cat x >&'2"                    scan=[]  unres="unterminated quote — cannot confidently …"  bash: syntax error
"cat \"a b\" >&2026-09-06.log"  scan=["2026-09-06.log"]  unres=[]
"cat x >&2\ out"               scan=["2 out"]           unres=[]     bash: '2 out'
"cat x >&\"2 x\""               scan=["2 x"]             unres=[]     bash: '2 x'
```

Escaped-space and quoted-space targets both resolve to the single token bash creates. `tokenize` is total (`shell-scanner.ts:415-461`) — it never throws, so a malformed slice degrades to `[]`, not an exception. **SURVIVES.**

Performance note, not a finding: the new `tokenize(slice)` is O(n) per redirect match, but `extractRedirectTargets:390` already called `tokenize(rest)` per match before this fix. The change is a constant factor, not a new complexity class.

---

### FINDING 8 — [CLEAN][demonstrated] — both new tests exist, are real, and map to what round 5 asked for.

| Round-5 required test | Landed |
|---|---|
| `Issue #84 residual (round 5): "…>&2026-09-06.log" must DENY` | `src/policy/normalizer/shell.test.ts:542` yes |
| `extractRedirectTargets bash-conformance table — 25 named '>&' forms match bash 5.3.9` | `src/policy/normalizer/shell-scanner.test.ts:449` yes |

Non-vacuity is not taken on trust — both **fail** under the mutant I applied myself (Finding 9), and the table asserts exact values with an anti-shrink guard (`assert.equal(cases.length, 25, "this table must stay at exactly the 25 forms the report measured")`). The two files went 143 -> 145 tests: exactly +2. **SURVIVES.**

---

### FINDING 9 — [CLEAN][demonstrated] — the mutant re-anchoring is real; the new mutant is a genuine new branch.

Every anchor resolves exactly once in the live source — scripted, not eyeballed:

```text
OK   occurrences=1  trailing-ampersand-word-form-treated-as-fd-dup
OK   occurrences=1  trailing-ampersand-digit-dash-check-inverted
OK   occurrences=1  trailing-ampersand-all-digits-vs-digit-prefix-broken
OK   occurrences=1  redirect-match-fd-dup-exclusion-disabled
OK   occurrences=1  length+1 extension
MUTANTS.length = 53 ; duplicate ids: []
$ npm run qa:mutation-shell
[QA-06 shell-detector-mutants] PASS: 53 of 53 mutant(s) KILLED.
```

`summarizeMutationRun` fails the run on any `MUTATION-NOOP` (`src/qa/mutation-harness.ts:115-123`), so 53/53 KILLED with 0 NOOP is itself proof every anchor matched.

**Independent kill proof** — I applied the new mutant to the real file, ran the suite, and restored:

```text
anchor occurrences of "/^\d+$/.test(fdWord)" = 1
mutant applied -> "/^\d/.test(fdWord)"
tests 145 | pass 143 | fail 2 | skipped 0
RESTORE: before=d3050220209284d8e2a2050d2cd8640f9076146a after=d3050220209284d8e2a2050d2cd8640f9076146a IDENTICAL
```

Two tests die under it — the conformance table and the #84 residual repro. The all-digits-vs-digit-prefix distinction is genuinely the decision this round's fix added, not padding. **SURVIVES.**

---

### FINDING 10 — [CLEAN][demonstrated] — round-5 Finding 2 (fail-closed over-denials) is fixed as a side effect.

`tokenize`'s quote/escape awareness resolves what the raw character read could not:

```text
ALLOW-CLEAN "kubectl get pods/api --context=prod >&\"2\""   scan=[]  verbs=["get"]
ALLOW-CLEAN "kubectl get pods/api --context=prod >&\2"     scan=[]  verbs=["get"]
ALLOW-CLEAN "kubectl get pods/api --context=prod >& -x"     scan=[]  verbs=["get"]
```

All three match bash (fd-dup / close-fd, no file). Three of round-5 Finding 2's five rows are genuinely gone; the remaining two (`2>&out`, `>>&out`) are bash *syntax errors* the detector does not model as a third outcome, and it over-approximates them fail-closed — documented in the test's own comment. **SURVIVES.**

---

### FINDING 11 — [CLEAN][demonstrated] — round-5 Finding 4 (vacuous frozen-file pathspec) is genuinely fixed.

The check now uses real paths, and I proved the pathspec is non-vacuous rather than assuming it:

```text
$ git ls-files -- src/policy/kernel/kernel.ts src/policy/normalizer/action-catalog.ts \
    src/policy/normalizer/target-format.ts src/policy/normalizer/registry.ts
src/policy/kernel/kernel.ts
src/policy/normalizer/action-catalog.ts
src/policy/normalizer/registry.ts
src/policy/normalizer/target-format.ts

$ git diff --numstat -- <same four>
(no output — zero diff)
```

Four pathspecs, four tracked files, zero diff. The instrument no longer passes vacuously. **SURVIVES.**

---

### FINDING 12 — [CLEAN][demonstrated] — genuine fd-dup and `&>` forms are not regressed.

```text
ALLOW-CLEAN  >&2   >&12   >&-x   >&-report.log   2>&1   >&9999999999
DENY         &> out   &>out   &>> out      (ops=[36] — tokenStart still shifts to '&', Issue #80 contract intact)
DENY         \>& out                        (unres="command separator \"&\" detected outside quotes" — Issue #70 path, escape-liveness intact)
```

**SURVIVES.**

---

### FINDING 13 — [CLEAN][demonstrated] — the correctness gate suite is green, with true exit codes.

```text
$ npm run build      -> tsc --noEmit    exit=0
$ npm run typecheck  -> tsc --noEmit    exit=0
$ npm run lint       -> eslint .        exit=0
$ npm test
  tests 427 | suites 0 | pass 427 | fail 0 | cancelled 0 | skipped 0 | todo 0 | duration_ms 25974.6393

exit codes captured directly, not from `tail`:
qa:completeness-claims             exit=1 <<< FAIL   (Finding 1)
qa:reference-resolver              exit=1 <<< FAIL   (Findings 2/3)
qa:recurring-findings              exit=0 PASS
qa:runtime-settings-drift          exit=0 PASS
qa:mutation-shell                  exit=0 PASS
qa:kernel-purity                   exit=0 PASS
qa:normalizer-registry-purity      exit=0 PASS
```

**427 pass / 0 fail / 0 skipped** — skipped genuinely zero, read off the raw summary. `qa:fixture-coverage`, `qa:diff-fixture`, `qa:fixture-isolation`, `qa:mutation-selftest`, `qa:broken-instrument-gate` all report **disclosed** VACUOUS-PASS (no content yet), which the project treats as honest, not green. Diff surface is 7 files, matching the stated scope. **SURVIVES** (the two red gates are Findings 1-3, both outside the detector).

---

## 4. Open findings vs failing tests (PRINCIPLES rule 19)

| Open finding | Named failing check |
|---|---|
| Finding 1 (MED) | `npm run qa:completeness-claims` — exit 1, must be exit 0 |
| Finding 2 (LOW) | `npm run qa:reference-resolver` — the `shell-scanner.ts:357` row specifically |

**open findings = 2, failing checks = 2.** Finding 3 is [SUSPICION] pending an environment I do not have; it is a task, not a blocker.

---

## 5. Editorial (verdict-neutral, plain edits, no re-review)

1. `shell-scanner.test.ts:449` — the test name claims all 25 forms "match observed bash 5.3.9", but rows 24-25 (`2>&out`, `>>&out`) explicitly do *not*; the comment above says so honestly, the name does not. Suggest "…match observed bash 5.3.9, with 2 documented fail-closed over-approximations".
2. `shell.test.ts:542` — asserts only `record.unresolved.length > 0`. That oracle would still pass under a hypothetical deny-everything regression. Adding an exact `extractRedirectTargets` assertion would pin the actual behavior. Not a gap (the mutation gate and conformance table cover the class), a robustness suggestion.
3. `CHANGELOG.md:56` — the bare-basename citation from Finding 2.
4. For the next reader: counting `textMutant(` occurrences in `src/qa/shell-detector-mutants.ts` yields 54, not 53, because the function's own definition matches. `MUTANTS.length` at runtime is the correct instrument. My first count was wrong; the CHANGELOG's "52 -> 53" is right.

---

## 6. Scariest unproven assumption, go/no-go, next action

**Scariest unproven assumption:** that "the gate suite is green" means what a reviewer thinks it means. This project has 16 `qa:*` scripts; round 5 ran 7 and I called that "the full gate suite." Two of the nine I skipped were red, one of them for three consecutive rounds, wired unconditionally into CI. The detector defect that consumed five rounds was found by an *external oracle* (real bash). The gate defect that survived five rounds was hiding behind a *partial enumeration* — the exact failure shape CLAUDE.md's no-hand-derived-completeness rule exists to prevent, committed by the reviewer enforcing it. Whoever reviews S5 should run every script in `package.json`'s `qa:` namespace and capture true exit codes, not a curated subset.

**Verdict: go** — on the question this round was convened to answer. Issue #84's defect is genuinely, independently dead: byte-identical to the pre-validated fix, 25/25 against a freshly re-measured bash oracle, zero bypasses across 14 additional forms, the slice-boundary risk probed and held, both new tests proven non-vacuous by a mutation I applied myself, and the two round-5 [SUSPICION] instrument gaps genuinely closed. Five rounds on one function is a real cost, and this is the first round where the fix was graded against an external oracle before it was written rather than against the repro it was handed — that is the process change worth keeping.

Finding 1 is MED and does not force no-go under the Evidence Policy, but it **is a required DoD gate sitting red**, so it is a merge condition, not a nice-to-have.

**Single next action:** edit `CHANGELOG.md:14`, `expect=49` -> `expect=53`, re-run `npm run qa:completeness-claims` to exit 0, and fix the `shell-scanner.ts:357` citation to `src/policy/normalizer/shell-scanner.ts:357` in the same edit. No re-review needed for either.

---

## Appendix — provenance

- Repo `c:\playground\thoth`, branch `master`, HEAD `2869227`, fix uncommitted (7 files) at time of review.
- bash 5.3.9(1)-release; Node v24.15.0.
- All harnesses written to the session scratchpad, never the repo. Working tree verified unchanged after every experiment: `git hash-object` identical before/after the mutant application, `git status --porcelain` identical before/after the worktree add/remove.

---
```text
RECEIPT: verdict=go
attacks (ALL, ranked by blast radius):
1. [ISSUE][MED][demonstrated] QA-15 completeness gate RED and CI-wired (.github/workflows/ci.yml:95-96): CHANGELOG.md:14 marker expect=49 vs instrument reporting 53. Proven already-red at HEAD (49 vs 52) via detached worktree, so pre-existing — but this round edits that same section and widens the delta without fixing it. Defense (the instrument) worked perfectly; the habit of re-running it did not. My own round-5 "full gate suite green" claim ran 7 of 16 gates and was over-broad — disclosed. Exposure: 100% of CI runs on this branch, basis: counted in code. Second QA-15 staleness on this project (Issue #79 was the first) and not in the recurring-findings registry.
2. [ISSUE][LOW][demonstrated] CHANGELOG.md:56 introduces a bare-basename citation 'shell-scanner.ts:357' that QA-14 cannot resolve — inside the very sentence recording the fix for round-5's bare-basename finding. My own round-5 report used that shape first; shared blame.
3. [SUSPICION][LOW][demonstrated] qa:reference-resolver exits 1 locally but 88 of 89 failures are environment-dependent 'no issue-tracker access' fail-closed rows; CI's verdict on QA-14 unsettleable from here. Settles with the CI QA-14 step, or the script run with a GitHub token.
4. [CLEAN][demonstrated] Round-5 HIGH repro dead: '>&2026-09-06.log' now DENYs and is indistinguishable from both its '>& ' and '> ' controls; '>&2out', '>&12x', '>&2.txt' likewise. Deleting a space no longer flips deny to allow.
5. [CLEAN][demonstrated] Applied fix byte-identical to the round-5 candidate, not a variant; only the surrounding comment changed.
6. [CLEAN][demonstrated] 25/25 live conformance via my own harness against a bash 5.3.9 oracle re-measured THIS round, not round 5's table.
7. [CLEAN][demonstrated] 14 forms outside the committed table graded against fresh bash runs: agree=12, over(fail-closed)=2, UNDER(bypass)=0. Unicode-digit, zero-width-space, substitution and unterminated-quote shapes all deny fail-closed.
8. [CLEAN][demonstrated] Slice-boundary quote-state risk introduced by tokenize(slice) probed with 6 prefix-quoting/escaped-space/quoted-space shapes — all agree with bash ('>&2\ out' -> '2 out', '>&"2 x"' -> '2 x'); structurally unreachable via the states[idx] guard, and tokenize is total so it cannot throw.
9. [CLEAN][demonstrated] Both new tests exist, map to the round-5 asks, and are non-vacuous: +2 tests exactly (143->145), anti-shrink guard on the table's 25 rows, and both die under the mutant I applied myself.
10. [CLEAN][demonstrated] Mutant re-anchoring real: all 5 branch anchors resolve exactly once (scripted), MUTANTS.length=53 with no duplicate ids, 53/53 KILLED, NOOP fails the run by construction (mutation-harness.ts:115-123).
11. [CLEAN][demonstrated] New mutant is a genuine new decision branch, not padding — I applied '/^\d+$/'->'/^\d/' to the real file, got 2 failures, and restored byte-identically (git hash-object match).
12. [CLEAN][demonstrated] Round-5 Finding 2 over-denials fixed as a side effect: '>&"2"', '>&\2', '>& -x' now correctly clean fd-dup, matching bash.
13. [CLEAN][demonstrated] Round-5 Finding 4 vacuous-pathspec gap genuinely closed: git ls-files proves all 4 frozen pathspecs match tracked files, and the diff is zero.
14. [CLEAN][demonstrated] Genuine fd-dup ('>&2','>&12','>&-x','2>&1'), '&>' synonym (ops=[36], Issue #80 intact) and escaped '\>&' (Issue #70 separator path) all unregressed.
15. [CLEAN][demonstrated] Correctness gates green with true exit codes: build/typecheck/lint exit 0; 427 pass / 0 fail / 0 skipped; mutation, kernel-purity, registry-purity, recurring-findings, runtime-settings-drift all exit 0; 5 further gates disclosed VACUOUS-PASS.
counts (CHECKSUM): issues=2 suspicions=1 clean=12
evidence (CHECKSUM): demonstrated=15 code-traced=0 derived=0
checks=npm run build exit 0; npm run typecheck exit 0; npm run lint exit 0; npm test 427 pass / 0 fail / 0 skipped; qa:mutation-shell 53/53 KILLED 0 NOOP exit 0; qa:kernel-purity exit 0; qa:normalizer-registry-purity exit 0; qa:recurring-findings exit 0; qa:runtime-settings-drift exit 0; qa:completeness-claims exit 1 FAIL; qa:reference-resolver exit 1 FAIL; qa:fixture-coverage/diff-fixture/fixture-isolation/mutation-selftest/broken-instrument-gate disclosed VACUOUS-PASS; bash 5.3.9 oracle 25+14+6 forms executed; live-code conformance 25/25; independent mutant kill 145 tests/2 fail then restored byte-identical
adr=HIT(35)
report=docs/reviews/s4-shell-semantic-detector-red-team-round6-2026-09-06.md
issue84=CLOSED (state_reason: completed) with an independent re-verification comment
```
