# Red Team (Sutekh) — S4 shell-command semantic detector, round-4 re-confirm

- **Scope:** S4, Milestone #22, CRITICAL tier. Independent re-verification of the Issue #83 fix and
  the two additional exploits `story-implementer` found on its own, plus a dedicated adversarial pass
  on the new shared escape infrastructure (`escapedChars` / `isLiveGreaterThan`).
- **Date:** 2026-09-06
- **Prior reports (immutable — PRINCIPLES rule 11):** `…red-team-2026-09-02.md` (round 1) ·
  `…red-team-2026-09-03.md` (round 2) · `…red-team-round3-2026-09-03.md` (round 3)
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e) [CACHE=HIT]`
- **Verdict: no-go.** Issue #83 and both self-found exploits are genuinely fixed, and the new escape
  infrastructure is correct on every probe I could build. The blocker is a **different, pre-existing
  one-line rule** in `findLiveRedirectMatches` that round 4 did not touch — and that **I missed in
  round 3**, with a LOW suspicion sitting directly on top of it. Disclosed as my own miss below.

---

## Correction to my own method, stated first

My first pass this round produced three apparent fail-opens. All three were artifacts of **my test
harness's** string escaping, not defects: TypeScript string literals collapsed my `\>` into `>`, so
I was feeding the detector different bytes than I believed. I caught it because the harness printed
`JSON.stringify(cmd)` and the backslashes were absent.

I re-ran everything with `String.raw`-style single-level construction plus a character-by-character
dump of each input (`[BS]` marking a literal backslash), and the three apparent findings evaporated.
Every input in this report is shown as its actual characters for that reason. A red-team finding
built on a mis-escaped test string would have been a manufactured finding, and at this stage — where
a non-clean verdict costs an automatic hard stop — that would have been the worst possible error.

---

## What I ran (raw)

```
$ npm test
tests 412 | pass 412 | fail 0 | cancelled 0 | skipped 0 | todo 0 | duration_ms 8527.1732
  (412/412 claim verified, 0 skipped)

$ node src/qa/shell-detector-mutants.ts
[QA-06 shell-detector-mutants] PASS: 49 of 49 mutant(s) KILLED.
  (49/49 claim verified, up from 46)

$ npm run typecheck -> PASS      $ npm run lint -> PASS

$ git diff --stat -- src/policy/normalizer/registry.ts src/policy/kernel/ \
    src/policy/normalizer/action-catalog.ts src/policy/normalizer/target-format.ts
(no output — zero-diff claim verified)

$ node tmp-rt4/{a,b,c,d}.ts   # 37-input full regression + byte-verified escape matrix + deep probe
```

---

## Part 1 — Issue #83 and the two self-found exploits, re-verified

### Issue #83 (escaped `\>` before `&` hides a separator) — FIXED

```
chars : kubectl get --context=prod [BS]>& kubectl delete secrets/db-creds --context=prod
record: deny  unresolved=["command separator \"&\" detected outside quotes"]
```

My round-3 repro now correctly identifies the `&` as a real background separator. **CLOSED.**

### Self-found exploit 1 (`echo a \> b` fabricated a write target) — FIXED

```
chars : echo a [BS]> b
record: deny  targets=[]        <- no phantom target; previously "b" was extracted as a write target
```

The escaped `>` no longer registers as a redirect at all. **Verified closed.**

### Self-found exploit 2 (`cmd \&> /tmp/out` misread as the `&>` both-streams form) — FIXED

```
chars : cmd [BS]&> /tmp/out
record: deny  targets=["/tmp/out"]   <- correct: literal "&", live ">" redirecting to /tmp/out
```

`precededByLiveAmpersand` correctly declines to treat an escaped `&` as part of `&>`. **Verified closed.**

### The shared escape infrastructure itself — attacked directly, SURVIVES

`escapedChars` / `isLiveGreaterThan` are now load-bearing for three call sites, so a gap in them
would be inherited three times over. I probed the backslash-parity arithmetic and the
escape/quote interaction, printing each `>`'s computed state and escaped flag:

```
chars: cat p [BS][BS]> /tmp/out           '>' state=none escaped=false  -> LIVE   (correct: \ is a literal backslash, > redirects)
chars: cat p [BS][BS][BS]> /tmp/out       '>' state=none escaped=true   -> literal (correct)
chars: cat p [BS][BS][BS][BS]> /tmp/out   '>' state=none escaped=false  -> LIVE   (correct)
chars: ... "[BS]>" & ...                  '>' state=double escaped=false -> not live, and the trailing & IS still a separator
chars: ... '[BS]>' & ...                  '>' state=single escaped=false -> not live, and the trailing & IS still a separator
chars: cat p [BS]"> /tmp/out              '>' state=none escaped=false  -> LIVE   (escaped quote does not open a span)
chars: cat p [BS]>> /tmp/out              idx7 escaped=true | idx8 escaped=false -> first literal, second LIVE
```

Even/odd backslash parity is exact, escaped quotes do not open spans, and the `\>>` case resumes the
scan at `idx + 1` so a live `>` glued onto an escaped one is still found. I could not construct an
input where a genuinely live operator is marked escaped, or vice versa. Consolidating three
divergent adjacency checks into one predicate was the right call and it was executed correctly.

---

## Part 2 — the blocker

### 1. `[ISSUE][HIGH][demonstrated]` `>&FILE` is treated as fd-dup and its write target vanishes — appending one `&` to a redirect turns a denied compound command into a clean read-only record

**Exposure: 100% of invocations using the `>&word` redirect form. basis: counted-in-code**
(`shell-scanner.ts`, `findLiveRedirectMatches`: `if (liveText[idx + length] === "&") continue;` —
an unconditional skip) **+ demonstrated.** Security / data-integrity class, so rule 21's exposure cap
does not apply.

**Provenance, stated plainly:** this line arrived with round 3's Issue #81 fix; round 4 did not touch
it. **I missed it in round 3** — my round-3 report carries a `[SUSPICION][LOW]` (finding 3) about
`>& /tmp/x` *over-denying*, which means I looked directly at this operator, graded the fail-closed
symptom, and did not test the fail-open sibling. That is my error, not a regression introduced this
round, and it is why this round is non-clean.

**Scenario.** Bash treats `>&` two different ways: `>&DIGIT` (and `>&-`) duplicates a file
descriptor, while `>&WORD` — with or without an intervening space — is a **file redirect**, exactly
equivalent to `&>WORD`. The detector's skip does not distinguish them, so every `>&WORD` write target
is silently dropped before `extractRedirectTargets` can report it:

```
input : kubectl get pods/api --context=prod >& out
record: CLEAN-RESOLVE verbs=["get"] targets=["prod/cluster/prod/pods/api"] unresolved=[]
        extractRedirectTargets() -> []          <- the write to file "out" does not exist to the record

control (one character different):
input : kubectl get pods/api --context=prod > out
record: deny  unresolved=["command assembles 2 targets — denied wholesale ... (Issue #82)"]
```

Real-shell confirmation, run this session:

```
$ bash -c 'echo HIDDEN-WRITE >& ./rtx1'   ; rtx1 exists=YES content=HIDDEN-WRITE
$ bash -c 'echo HIDDEN-WRITE2 >&./rtx2'   ; rtx2 exists=YES content=HIDDEN-WRITE2
$ bash -c 'echo TO-STDOUT >&1'            ; file named 1 exists=NO   (genuine fd-dup, correctly no file)
$ bash -c 'echo get --context=prod >& ./rtx4 delete secrets/db-creds'
                                            rtx4 exists=YES content=get --context=prod delete secrets/db-creds
```

**Why this matters more than my two previous narrow findings.** My round-2 (N1) and round-3 (#83)
blockers each needed a contrived quoting or escaping trick — I graded both honestly as ~0% of benign
traffic. This one needs **no trick at all**: a single `&` appended to an ordinary redirect operator.
It is a documented, fully-supported bash form that people with csh habits write by hand, so it is
plausible in benign traffic as well as trivially available to an adversary. And it lands squarely on
the guard this entire council round was built around: because the target never enters
`redirectTargets`, the assembled-target count stays at 1 and the Issue #82 guard never fires.
`REQUIREMENTS.md:173` names "fd-dup ampersand handling" as ported scope, and SUR-08
(`REQUIREMENTS.md:464`) requires that target extraction "shall not lose the target to its own
preprocessing" — which is precisely what happens here.

**Current defense, honestly assessed.** The fd-dup skip was the right instinct — a genuine `2>&1` has
no file target and fabricating one (the pre-round-3 behaviour) was a real defect worth fixing. The
mistake is that the skip is unconditional where bash's own rule is conditional on what follows the
`&`. Everything around it is sound: `2>&1` and `&>` both still resolve correctly, and the escape
handling added this round is exact.

**Verdict: BREAKS.**

**Named failing test required before merge:**
- `SUR-08/fd-dup: '>&WORD' is a file redirect and its target is reported; only '>&DIGIT' and '>&-' are fd-dup`

**Fix shape (mechanical, one condition):** in `findLiveRedirectMatches`, skip the match as fd-dup only
when the text after the `&` begins with a digit or `-` (bash's actual rule); otherwise treat it as a
file redirect whose target starts after the `&`, the same way `&>` is already handled via
`tokenStart`. The existing `&>`/`&>>` handling is the model — this is its mirror image.

---

### 2. `[SUSPICION][MED][code-traced]` The multi-target invariant still rests on one producer, unchanged from round 3

`kernel.ts:121-127` still composes an ALLOW match with `.some()` across `action.targets` (verified
unchanged, zero diff), and the invariant protecting it lives in `shell.ts` alone.
`structured-cluster.ts:36-41` remains structurally single-target, so the boundary holds today. Still
no test or type fails if a future normalizer emits two. Carried forward from round 3 unchanged —
correctly-recorded council deferral, not a new defect. Finding 1 is a reminder of the cost of that
choice: a guard that can be starved upstream protects nothing downstream.

---

## Part 3 — what survived

### 3. `[CLEAN][demonstrated]` Full three-round regression, 37 inputs, no re-opened defect

Every repro from rounds 1-3 still behaves: newline and `&` separators, `<<<` herestring, all four
directory-flag spellings, multi-resource, double redirect, impact-analyst's compound PoC, the quoted
`">"` case (#80), `2>&1` and `&>` resolving (#81), the `at`-heredoc body, `xargs`, `sudo`,
substitution, unterminated quote, depth cap. Happy paths still resolve: single resource, single
write, SUR-08's named heredoc-plus-redirect test, the `nohup` wrapper, flag reordering.

### 4. `[CLEAN][demonstrated]` The escape infrastructure is correct (detail in Part 1)

Seven byte-verified probes across backslash parity, quote/escape interaction and glued operators; no
gap found in the predicate now shared by three call sites.

### 5. `[CLEAN][demonstrated]` Implementer's claims verified exactly

412/412 tests with 0 skipped, 49/49 mutants killed, typecheck and lint clean, zero diff to
`kernel.ts` / `registry.ts` / `action-catalog.ts` / `target-format.ts`. Fourth consecutive round in
which the mutation gate grew with the change rather than after it.

### 6. `[CLEAN][code-traced]` The fix was a consolidation, not a fourth parallel patch

Three divergent raw-character adjacency checks were replaced by one `isLiveGreaterThan` predicate,
and the implementer found two of the three sites itself, before writing any fix, having generalised
from my single reported instance. That is the correct response to a repeating root-cause class, and
it is the reason finding 1 is a *different* rule rather than a fourth instance of the same one.

---

## Findings-to-tests reconciliation

Open findings: **2** (1 `[ISSUE]`, 1 `[SUSPICION]`). Named failing tests: **1**, for the `[ISSUE]`.
The `[SUSPICION]` is a carried-forward council deferral whose unlock is a registry-level test I have
named twice now; it resolves as a residual-register line, not a test of this story's.

## Issues closed this round

`#83` — re-verified by me against my own round-3 repro, with the two implementer-found exploits
verified separately and the shared predicate probed directly.

## Note for the human this hard-stop reaches

This verdict triggers PRINCIPLES rule 16's hard stop, so the decision is yours, and I want the
trade-off stated fairly rather than dramatically:

- **The architecture the council ruled GO on is holding.** Four rounds of attack have not found a
  structural problem with it. The ≥2-target guard, the position-based tokenizer, the quote model and
  now the escape model have all survived direct attack.
- **This round's actual work is good.** #83 is fixed, the implementer found two more instances of the
  same class on its own before being asked, and consolidated them into one predicate instead of
  patching three places. That is the behaviour you want when a root-cause class repeats.
- **The blocker is one conditional, and it is not this round's regression** — it came in with round 3
  and I failed to catch it then, while explicitly looking at the same operator. If my round-3 pass
  had been better, this would have been fixed alongside #83 in the same batch.
- **What it costs to ship as-is:** a one-character, no-trick bypass of the multi-target guard that
  hides a file write. S4 is inert library code today (no hook wires it to a live session until S5),
  so live exposure is 0% right now — but it becomes real at S5, and it is security-class, so it is
  not eligible for the exposure-cap downgrade.

My recommendation, offered as input to your ruling and not as a verdict: **the fix is one condition
plus one named test, mechanically identical in shape to the `&>` handling already shipped and
working**. If you would rather not spend another autonomous round, the honest alternative is to ship
S4 with this finding recorded as a day-1 blocking task on S5 — the story that actually wires the
normalizer to a session — since that is the point at which 0% exposure stops being 0%.

## The single scariest unproven assumption

**That an operator's meaning is fixed by its own characters, independent of what follows it.** The
detector now handles quoting, position and escaping correctly — but `>&` is the case where bash's
meaning depends on the *next* token's shape (digit versus word), and the code decides before looking.
It is the same lesson as rounds 2 and 3 in a third costume: a local shortcut standing in for a
structural fact that lives one character away.

## Go / no-go

**no-go**, on finding 1 alone, with the provenance disclosed: pre-existing from round 3, missed by me
in round 3, not a regression introduced by round 4's work.

## Single next action

In `findLiveRedirectMatches`, make the fd-dup skip conditional — `>&` followed by a digit or `-` is
fd-dup, anything else is a file redirect whose target begins after the `&` (mirroring the existing
`&>` `tokenStart` handling) — and add `SUR-08/fd-dup: '>&WORD' is a file redirect and its target is
reported; only '>&DIGIT' and '>&-' are fd-dup` as its failing test.

---

RECEIPT: verdict=no-go
attacks (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] `findLiveRedirectMatches` skips ANY `>` followed by `&` as fd-dup, but bash treats `>&WORD` (space or glued) as a FILE redirect and only `>&DIGIT`/`>&-` as fd-dup - `kubectl get pods/api --context=prod >& out` CLEAN-RESOLVEs as a read with extractRedirectTargets()=[] while bash creates and writes the file (real-bash confirmed 4 ways); the control `> out` denies, so ONE appended `&` flips deny->allow and starves the Issue #82 assembled-target guard upstream. PRE-EXISTING from round 3 and MISSED BY ME in round 3 (my round-3 finding 3 graded the fail-closed symptom of this exact operator) - not a round-4 regression. Exposure: 100% of `>&word` invocations, basis: counted-in-code.
2. [SUSPICION][MED][code-traced] Multi-target invariant still enforced in shell.ts alone while kernel.ts:121-127 still `.some()`s across targets (verified unchanged); structured-cluster.ts:36-41 is structurally single-target so the boundary holds today, but nothing fails if a future normalizer emits two - carried forward from round 3 unchanged, correctly-recorded council deferral.
3. [CLEAN][demonstrated] Issue #83 FIXED - my round-3 repro `kubectl get --context=prod [BS]>& kubectl delete secrets/db-creds --context=prod` now denies with `command separator "&" detected outside quotes`.
4. [CLEAN][demonstrated] Implementer's self-found exploit 1 FIXED - `echo a [BS]> b` yields targets=[] where it previously fabricated `b` as a write target.
5. [CLEAN][demonstrated] Implementer's self-found exploit 2 FIXED - `cmd [BS]&> /tmp/out` correctly reads a literal `&` plus a live `>` to /tmp/out, no longer the `&>` both-streams form.
6. [CLEAN][demonstrated] The new shared escape infrastructure SURVIVES direct attack - 7 byte-verified probes: backslash parity exact at 1/2/3/4 backslashes, escaped quotes do not open spans, `[BS]>>` resumes the scan so the glued live `>` is still found, and quoted-escape combinations still surface the trailing separator; no input marked a live operator escaped or vice versa.
7. [CLEAN][demonstrated] Full three-round regression across 37 inputs re-run, no defect re-opened - separators, herestring, all 4 directory-flag spellings, multi-resource, double redirect, compound PoC, quoted `">"`, `2>&1`/`&>`, at-heredoc, xargs, sudo, substitution, unterminated quote, depth cap; happy paths all still resolve.
8. [CLEAN][demonstrated] Implementer's claims verified exactly - 412/412 tests 0 skipped, 49/49 mutants KILLED, typecheck PASS, lint PASS, zero-diff to kernel.ts/registry.ts/action-catalog.ts/target-format.ts empty.
9. [CLEAN][code-traced] The fix was a consolidation, not a fourth parallel patch - three divergent raw-character adjacency checks replaced by one `isLiveGreaterThan`, two of the three sites found by the implementer itself before writing any fix.
counts (CHECKSUM): issues=1 suspicions=1 clean=7
evidence (CHECKSUM): demonstrated=7 code-traced=2 derived=0
checks=npm test 412 pass/0 fail/0 skip (claim verified); qa:mutation-shell 49/49 KILLED (claim verified); typecheck PASS; lint PASS; zero-diff to kernel boundary empty; 37-input full regression + 8 byte-verified escape-matrix inputs + 7 deep escape probes + 6 fd-dup repros executed, 1 wrong clean-resolve; 4 real-bash semantic confirmations; 3 first-pass apparent findings discarded as my own harness escaping artifacts
adr=HIT(35)
report=docs/reviews/s4-shell-semantic-detector-red-team-round4-2026-09-06.md
