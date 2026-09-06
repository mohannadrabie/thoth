# Red Team (Sutekh) — S4 shell-command semantic detector, round-3 re-confirm

- **Scope:** S4, Milestone #22, CRITICAL tier. Independent re-verification of round 3 (the
  council-approved Path B, broadened) against my own repro strings, plus a fresh adversarial pass on
  the new assembled-target-count guard and the new fd-dup exclusion.
- **Date:** 2026-09-03
- **Prior reports (immutable, not edited — PRINCIPLES rule 11):**
  `docs/reviews/s4-shell-semantic-detector-red-team-2026-09-02.md` (round 1, no-go) ·
  `docs/reviews/s4-shell-semantic-detector-red-team-2026-09-03.md` (round 2, no-go)
- **Council input read directly:** `docs/reviews/s4-shell-semantic-detector-council-path-forward-2026-09-03.md`
  (GO on Path B broadened; dissent recorded — `impact-analyst` preferred the kernel-side Path A)
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e) [CACHE=HIT]`
- **Verdict: no-go** — on ONE new defect the round-3 fd-dup fix introduced. Issues #80, #81 and #82
  are each confirmed closed against their own repros.

---

## What I ran (raw)

```
$ npm test
tests 403 | pass 403 | fail 0 | cancelled 0 | skipped 0 | todo 0 | duration_ms 8277.9759
  (implementer's 403/403 claim verified, 0 skipped)

$ npm run typecheck  -> PASS      $ npm run lint -> PASS

$ node src/qa/shell-detector-mutants.ts
[QA-06 shell-detector-mutants] PASS: 46 of 46 mutant(s) KILLED.
  (implementer's 46/46 claim verified, up from 40)

$ git diff --stat -- src/policy/normalizer/registry.ts src/policy/kernel/ \
    src/policy/normalizer/action-catalog.ts src/policy/normalizer/target-format.ts
(no output — zero diff to the kernel boundary still holds)

QA gates: kernel-purity PASS, normalizer-registry-purity PASS, fixture-coverage PASS,
  diff-fixture PASS, fixture-isolation PASS, broken-instrument-gate PASS, recurring-findings PASS
  qa:completeness-claims FAIL — pre-existing docs/STATE.md rows only, unchanged since HEAD, not S4's

$ node tmp-rt3/a.ts     # 20 inputs: my originals + impact-analyst's PoC + starvation hunt
unexpected: 1           # finding 1 below
```

---

## Part 1 — Issues #80, #81, #82 re-verified

### Issue #80 (quoted `">"` swallows the following resource token) — FIXED, proven independently

The end-to-end repro now denies — but it denies via the **new ≥2-target guard**, which would also be
true if the position-based fix were absent. That is not proof, so I isolated it: a single-resource
command where the quoted `">"` precedes the ONLY resource token. Under the old value-based skip this
returned `command resource ""` (the token was swallowed); under a working position-based fix the
token survives and resolves:

```
kubectl delete ">" secrets/db-creds --context=prod   -> CLEAN targets=["prod/cluster/prod/secrets/db-creds"]
kubectl delete ">>" secrets/db-creds --context=prod  -> CLEAN targets=["prod/cluster/prod/secrets/db-creds"]
kubectl delete '>' secrets/db-creds --context=prod   -> CLEAN targets=["prod/cluster/prod/secrets/db-creds"]
```

The token is no longer swallowed. `findLiveRedirectOperatorPositions` + `tokenizeWithOffsets` key the
exclusion on character offset, so a dequoted value can no longer impersonate an operator. **CLOSED.**

### Issue #81 (fd-dup `2>&1` / `&>` misread as command separators) — FIXED for its own repro

```
cat p > /tmp/ok 2>&1  -> CLEAN-RESOLVE verbs=["write"] targets=["/tmp/ok"]
cat p &> /tmp/ok      -> CLEAN-RESOLVE verbs=["write"] targets=["/tmp/ok"]
```

Both idioms resolve again, and `findLiveRedirectMatches` correctly distinguishes the two shapes:
`>&` (fd-dup destination, no file target) is skipped, while `&>`/`&>>` (redirect both streams to a
real file) still extracts its path. The separator check no longer fires. **CLOSED** — with a new
defect introduced by this same fix, filed separately as finding 1 below.

### Issue #82 (kernel `matchesTarget` OR-across-targets ALLOW bypass) — CLOSED at the normalizer boundary, verified against every compound repro I have

This one is cross-domain's finding, not mine, so I verified it myself rather than confirm on their
word. Every multi-target shape I or `impact-analyst` produced across three rounds now denies
wholesale:

```
kubectl delete pods/api secrets/db-creds --context=prod          -> unresolved ["command assembles 2 targets — ..."]
cat payload > /tmp/harmless > /etc/cron.d/pwn                    -> unresolved ["command assembles 2 targets — ..."]
kubectl delete pods/api --context=prod > /etc/cron.d/pwn         -> unresolved  (impact-analyst's compound PoC)
kubectl delete pods/api ">" secrets/db-creds --context=prod      -> unresolved  (#80's repro, now via the guard)
kubectl delete pods/api pods/api --context=prod                  -> unresolved  (duplicate resources)
bash -c "kubectl delete pods/api secrets/db-creds --context=prod"-> unresolved  (guard applies inside recursion)
nohup kubectl delete pods/api --context=prod > /etc/cron.d/pwn & -> unresolved  (guard applies through a wrapper)
```

Single-target happy paths are untouched — `kubectl delete secrets/db-creds --context=prod`,
`cat payload > /tmp/out`, and SUR-08's named heredoc-plus-redirect test all still resolve cleanly.

I also checked the guard cannot be **starved** — a target reaching `targets` from neither counted
path. It cannot, structurally: `shell.ts:394-398` builds `targets` from exactly the two arrays the
guard sums (`resourceTargets` + `redirectTargets`), so `targets.length === assembledTargetCount` by
construction, and the early write-only return at `shell.ts:350-353` carries its own copy of the
guard rather than bypassing it. **CLOSED.**

---

## Part 2 — findings

### 1. `[ISSUE][HIGH][demonstrated]` The fd-dup exclusion is a raw-character test, so an ESCAPED literal `>` disguises a real command separator — the record reports the wrong VERB on a real target

**Exposure: ~0% of benign traffic; 100% reliable as a deliberate evasion primitive. basis:
code-traced** (`shell-scanner.ts`, `findLiveTrailingSensitiveSeparator`: `text[i - 1] !== ">"`)
**+ demonstrated.** Security class — rule 21 exempts security findings from the exposure cap. Same
triage note as my round-2 finding N1 applies, and I make it again below rather than force it.

**Scenario.** Round 3 fixed #81 by excluding `&` from separator detection when it is adjacent to a
`>`. That test reads the raw neighbouring character and never asks whether that `>` is a *live
redirect operator* or a backslash-escaped literal — even though the sibling function
`findLiveRedirectMatches`, in the same file, does consult `quoteStates` for exactly this. A `\>`
is an ordinary argument character in bash, and the `&` after it is a real background separator:

```
input:  kubectl get --context=prod \>& kubectl delete secrets/db-creds --context=prod
record: CLEAN-RESOLVE verbs=["get"] targets=["prod/cluster/prod/secrets/db-creds"] unresolved=[]
```

The record says **get** on `secrets/db-creds`. The shell runs `kubectl get --context=prod '>'` in the
background and then **deletes** `secrets/db-creds`. A rule that permits `get` on secrets authorizes a
`delete`. Real-shell confirmation, run this session:

```
$ bash -c 'echo FIRST-ARGS: a \>& echo SECOND-EXECUTED'
FIRST-ARGS: a >
SECOND-EXECUTED

$ bash -c 'echo ONLY-COMMAND 2>&1'      # control: genuine fd-dup does NOT split
ONLY-COMMAND
```

**Why the ≥2-target guard does not catch it.** This is the part worth pausing on. The council's
broadened guard is a genuinely good backstop and it caught every other variant I threw at it —
including the same attack when the FIRST command also carries a resource:

```
kubectl get pods/api --context=prod \>& kubectl delete secrets/db-creds --context=prod
  -> unresolved ["command assembles 2 targets — ..."]      (2 resource tokens, guard fires)
```

The bypass works precisely by keeping the assembled target count at **1**: the first command
contributes no resource token, so the only surviving target is the hidden command's own. The guard
counts targets; it cannot count commands. That is not a criticism of the guard — it is the boundary
of what a target-count heuristic can do, and it is why the separator check has to be correct on its
own rather than backstopped.

**Current defense, honestly assessed.** Separator detection, quote-state modelling and redirect
matching are all otherwise sound, and `findLiveRedirectMatches` already computes the exact predicate
this check needs. The defect is one character class wide: a raw `text[i-1]`/`text[i+1]` comparison
where a live-operator lookup belonged.

**Verdict: BREAKS.**

**Named failing test required before merge:**
- `Issue #81 follow-on: an escaped literal '\>' immediately before '&' is not fd-dup — the '&' is still a command separator`

**Fix shape:** in `findLiveTrailingSensitiveSeparator`, treat `&` as fd-dup-adjacent only when the
neighbouring `>` is one of `findLiveRedirectMatches`'s live matches (or, equivalently, when the `>`
is not itself backslash-escaped), reusing the scan that already exists in the same module rather
than re-deriving adjacency from raw characters.

**Triage note, offered honestly:** as in round 2, this is an evasion primitive rather than something
benign traffic emits. If the Manager rules S4's threat model excludes a deliberately evasive session,
it drops to MED and does not gate — a legitimate rule-21 Role-2b call. Under the threat model a
session-governance engine actually has, it gates. I flag also that this is the third consecutive
round in which a fix has introduced a sibling defect in its own new code; that pattern, not this
single line, is the thing I would want the Manager weighing.

---

### 2. `[SUSPICION][MED][code-traced]` The "no record reaches the kernel with ≥2 targets" invariant is enforced inside one producer, with no instrument asserting it

The council's Path B deliberately left `kernel.ts`'s `matchesTarget` untouched — it still composes an
ALLOW match with `.some()` across `action.targets` (`kernel.ts:121-127`, verified unchanged, zero
diff). The safety of that now rests on an invariant enforced in `shell.ts` alone.

I checked whether any other shipped producer can violate it today, and none can:
`src/policy/normalizer/structured-cluster.ts:36-41` pushes at most one target, structurally. So the
boundary genuinely holds right now — this is a residual, not a live bypass, and the council recorded
the deferral explicitly. What is missing is any mechanism that *fails* when a future normalizer emits
two: no test asserts it across the registry, and `ActionRecord`'s type does not encode it.

**Verdict: UNPROVEN** as a defect — it is a correctly-recorded deferral. **Settled by** one cheap
registry-level test (`every registered normalizer's output carries at most 1 target`) that would make
the invariant self-enforcing at the point the next producer appears, rather than at the point someone
remembers to re-read this decision. Residual-register line; the Manager owns whether it lands in S4
or in the backlog item the council already created.

### 3. `[SUSPICION][LOW][demonstrated]` `>&` followed by a path over-denies with a confusing message

```
kubectl get pods/api --context=prod >& /tmp/x
  -> unresolved ["command resource \"pods/api, /tmp/x\""]
```

`>& word` is a real bash shape (redirect both streams to a file), but the `>&` is skipped as a
fd-dup destination and `/tmp/x` then falls into `positional`, where it is reported as a malformed
resource alongside a perfectly valid one. Fails CLOSED, so nothing leaks, and the message is
misleading rather than wrong. **UNPROVEN** as to whether the over-deny is intended.

---

## Part 3 — what survived my attack

### 4. `[CLEAN][demonstrated]` The fused no-space redirect form does not swallow a following token

This was my primary starvation hypothesis going in: `scanFlags` skips a redirect operator *and its
target token*, so a token where operator and target are glued together (`>/tmp/out`) could advance
past one innocent extra token. It is explicitly handled — `isBareOperator` advances by 1 for the
merged form and by 2 only for a genuinely bare `>`/`>>`/`&>`/`&>>`. Attacked with the space form as
control; both behave identically, which is the SUR-07 order-independence property that matters:

```
cat >/tmp/out secrets/db-password/extra-smuggled   -> unresolved ["command verb ...","command resource ...","command flag --context"]
cat > /tmp/out secrets/db-password/extra-smuggled  -> unresolved   (identical, control)
```

The smuggled token is reported in both spellings, exactly as `shell.ts`'s own `kubectlAttempted`
comment promises. Good work — I expected this one to break.

### 5. `[CLEAN][demonstrated]` A genuine fd-dup followed by a real separator still denies

```
cat p > /tmp/ok 2>&1 & kubectl delete secrets/db-creds --context=prod
  -> unresolved ["command separator \"&\" detected outside quotes"]
```

The #81 exclusion is narrow enough that it does not swallow the separator that follows it. Only the
escaped-literal case (finding 1) slips through.

### 6. `[CLEAN][demonstrated]` Every prior-round CLEAN still holds, and the happy paths still resolve

Single resource, single redirect write, SUR-08's named heredoc-plus-redirect test, wrapper recursion,
depth cap, and the `sudo`/interpreter grammar accident all behave as verified in rounds 1 and 2. The
≥2 guard did not collapse legitimate single-target resolution into blanket denial, which was the main
collateral risk of Path B.

### 7. `[CLEAN][demonstrated]` Zero diff to the kernel boundary held under real pressure

The council seriously considered Path A (patching `kernel.ts`) and `impact-analyst` dissented in
favour of it. The ratified scope was honoured anyway: `git diff --stat` over `kernel.ts`,
`registry.ts`, `action-catalog.ts` and `target-format.ts` is empty, with `qa:kernel-purity` and
`qa:normalizer-registry-purity` both PASS. The dissent is recorded rather than buried, and the
deferred general question is written down for the next story. That is the process working.

### 8. `[CLEAN][demonstrated]` The mutation gate grew with the change again

46 of 46 killed, up from 40 — 3 stale anchors repaired and 6 new mutants registered for round 3's own
logic, all verified by a real subprocess run rather than asserted. Three rounds, three times the gate
grew with the diff instead of after it.

---

## Findings-to-tests reconciliation

Open findings: **3** (1 `[ISSUE]`, 2 `[SUSPICION]`). Named failing tests: **1**, for the `[ISSUE]`.
Finding 2 has no executable form as a defect — it is a correctly-recorded deferral whose *unlock* is
a new registry-level test, which I name rather than convert; finding 3 is a precision question with
no security consequence. Both resolve as residual-register lines.

## Issues closed this round

`#80`, `#81`, `#82` — each re-verified by me against its own repro in this session, `#80` isolated
from the ≥2 guard so the position fix is proven on its own, `#82` verified independently of
cross-domain (whose finding it was) including a code-traced check that no other shipped normalizer
can emit a multi-target record today.

## The single scariest unproven assumption

**That adjacency in the raw text tells you syntactic role.** Round 2's scariest assumption was that a
token's *value* tells you its role; round 3 fixed that properly, with offsets — and then reintroduced
the identical class of error one function away, reading a raw neighbouring *character* to decide
whether an `&` is fd-dup. The same module already computes the live-operator predicate both call
sites need. The recurring shape is a local shortcut standing in for the structural fact that exists
three functions up.

## Go / no-go

**no-go**, on finding 1 alone, and the word is again smaller than it sounds: #80, #81 and #82 are
genuinely closed, the ≥2 guard is a sound backstop that caught every compound variant I could build,
and the fused-redirect case I most expected to break held. One character-class comparison stands
between this and a clean round.

## Single next action

In `findLiveTrailingSensitiveSeparator`, replace the raw `text[i-1] === ">"` / `text[i+1] === ">"`
adjacency test with a lookup against `findLiveRedirectMatches`'s live-operator offsets, then add
`Issue #81 follow-on: an escaped literal '\>' immediately before '&' is not fd-dup — the '&' is
still a command separator` as its failing test.

---

RECEIPT: verdict=no-go
attacks (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] NEW, introduced by #81's fd-dup fix: findLiveTrailingSensitiveSeparator excludes `&` from separator detection by RAW adjacent character (`text[i-1] !== ">"`) without asking whether that `>` is a live operator or a backslash-escaped literal - `kubectl get --context=prod \>& kubectl delete secrets/db-creds --context=prod` CLEAN-RESOLVEs as verbs=["get"] on secrets/db-creds while bash runs the DELETE (real-bash confirmed); a rule allowing get on secrets authorizes a delete. Deliberately keeps assembled targets at 1, so the >=2 guard cannot see it. Exposure: ~0% benign traffic, 100% reliable as an evasion primitive, basis: code-traced; rule-21 triage note in the report.
2. [SUSPICION][MED][code-traced] The "no record reaches the kernel with >=2 targets" invariant now rests entirely on shell.ts, with kernel.ts matchesTarget still `.some()`-ing across targets (verified unchanged) - structured-cluster.ts:36-41 is structurally single-target so the boundary holds TODAY, but no test or type fails if a future normalizer emits two; correctly-recorded council deferral, unlock is one registry-level test.
3. [SUSPICION][LOW][demonstrated] `kubectl get pods/api --context=prod >& /tmp/x` over-denies with a misleading "command resource \"pods/api, /tmp/x\"" - `>& word` is a real redirect shape whose path falls into positional; fails CLOSED, precision only.
4. [CLEAN][demonstrated] Issue #80 (quoted '">"' swallows the following token) FIXED and proven INDEPENDENTLY of the >=2 guard - isolated single-resource repros (`kubectl delete ">" secrets/db-creds --context=prod`, `">>"`, `'>'`) all resolve with the resource intact, where the old value-based skip returned 'command resource ""'.
5. [CLEAN][demonstrated] Issue #81 (fd-dup misread as separator) FIXED for its own repro - `cat p > /tmp/ok 2>&1` and `cat p &> /tmp/ok` both resolve as writes; `>&` (no file target) and `&>` (real file target) correctly distinguished. Sibling defect at finding 1.
6. [CLEAN][demonstrated] Issue #82 (kernel OR-across-targets ALLOW bypass) CLOSED at the normalizer boundary, verified by me rather than on cross-domain's word - all 7 compound shapes deny (my multi-resource, my double-redirect, impact-analyst's compound PoC, #80's repro, duplicate resources, and the bash -c / nohup wrapper routes), while single-target happy paths still resolve.
7. [CLEAN][code-traced] The guard cannot be starved - shell.ts:394-398 builds `targets` from exactly the two arrays the guard sums, so targets.length === assembledTargetCount by construction, and the early write-only return at shell.ts:350-353 carries its own copy of the guard rather than bypassing it.
8. [CLEAN][demonstrated] My primary starvation hypothesis FAILED to break it: the fused no-space redirect (`cat >/tmp/out secrets/db-password/extra-smuggled`) does not swallow the following token - isBareOperator advances by 1 for the merged form, and the space-separated control produces an identical record (SUR-07 order-independence preserved).
9. [CLEAN][demonstrated] A genuine fd-dup followed by a real separator still denies - `cat p > /tmp/ok 2>&1 & kubectl delete secrets/db-creds --context=prod` reports the separator; the #81 exclusion is narrow, and only the escaped-literal case slips.
10. [CLEAN][demonstrated] Every prior-round CLEAN still holds and the >=2 guard did not collapse legitimate resolution - single resource, single redirect write, SUR-08's named heredoc+redirect test, wrapper recursion, depth cap, sudo/interpreter grammar accident.
11. [CLEAN][demonstrated] Zero-diff to kernel.ts/registry.ts/action-catalog.ts/target-format.ts held under real pressure (the council considered and impact-analyst dissented FOR a kernel patch) - `git diff --stat` empty, kernel-purity and normalizer-registry-purity PASS.
12. [CLEAN][demonstrated] Mutation gate grew with the change for the third consecutive round - 46 of 46 KILLED (up from 40; 3 stale anchors repaired, 6 new mutants for round 3's own logic), proven by real subprocess runs.
counts (CHECKSUM): issues=1 suspicions=2 clean=9
evidence (CHECKSUM): demonstrated=9 code-traced=3 derived=0
checks=npm test 403 pass/0 fail/0 skip (claim verified); typecheck PASS; lint PASS; qa:mutation-shell 46/46 KILLED (claim verified); 7 QA gates PASS; qa:completeness-claims FAIL (pre-existing docs/STATE.md rows only, unchanged since HEAD); zero-diff to kernel boundary empty; 23 adversarial inputs executed, 1 wrong clean-resolve; 2 real-bash semantic confirmations
adr=HIT(35)
report=docs/reviews/s4-shell-semantic-detector-red-team-round3-2026-09-03.md
