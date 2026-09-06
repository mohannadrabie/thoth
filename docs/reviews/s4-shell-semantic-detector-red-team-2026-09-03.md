# Red Team (Sutekh) — S4 shell-command semantic detector, re-confirm round

- **Scope:** S4, Milestone #22, CRITICAL tier. Independent re-verification of the `story-implementer`
  fix-now round against my own original repro inputs, plus a fresh attack pass on the fix itself.
- **Date:** 2026-09-03
- **Prior report (immutable, not edited — PRINCIPLES rule 11):**
  `docs/reviews/s4-shell-semantic-detector-red-team-2026-09-02.md` (verdict `no-go`, 7 issues / 2 suspicions / 4 clean)
- **HEAD:** `247e5fb6e08595e3f7fd69a02671ad5225637f21` (S4 diff still uncommitted in the working tree)
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] (fp 83b2e3e) [CACHE=HIT]`
- **Method:** I re-ran my ORIGINAL repro strings against the live code, not the fix summary. Every
  claim below is a command I executed in this session. I also attacked the fix's own new code paths.
- **Verdict: no-go** — but for ONE new defect the fix round introduced, not for any of my seven
  original findings. All seven are confirmed closed.

---

## Part 1 — my seven original findings, re-verified

Raw output of `node tmp-redteam2/reconfirm.ts` (my 16 original repro strings, verbatim, plus 6
regression guards). `deny` = must report `unresolved`; `clean` = must still resolve.

```
unresolved    | F1-A1 newline separator          unresolved=["command separator \"\n\" detected outside quotes"]
unresolved    | F1-A2 & separator                unresolved=["command separator \"&\" detected outside quotes"]
unresolved    | F1-B1 at-heredoc multi-line body unresolved=["command separator \"\n\" detected outside quotes"]
unresolved    | F1-A8 newline inside bash -c     unresolved=["command separator \"\n\" detected outside quotes"]
unresolved    | F1-B10 eval + & separator        unresolved=["command separator \"&\" detected outside quotes"]
unresolved    | F1-B11 nohup inner newline       unresolved=["command separator \"\n\" detected outside quotes"]
unresolved    | F2-A3 <<<herestring mimicry      unresolved=["command separator \"\n\" detected outside quotes"]
unresolved    | F3-B2 dirflag -C=v               unresolved=["directory flag (-C/-d/--directory) present"]
unresolved    | F3-B3 dirflag --directory space  unresolved=["directory flag (-C/-d/--directory) present"]
unresolved    | F3-B4 dirflag -d=v               unresolved=["directory flag (-C/-d/--directory) present"]
unresolved    | F3-B5 dirflag -C space           unresolved=["directory flag (-C/-d/--directory) present"]
CLEAN-RESOLVE | F4-A4 multi-resource delete      targets=["prod/cluster/prod/pods/api","prod/cluster/prod/secrets/db-creds"]
unresolved    | F4-B8 xargs stdin-fed            unresolved=["xargs: inner command not statically extractable from this invocation"]
CLEAN-RESOLVE | F5-A5 double redirect            targets=["/tmp/harmless","/etc/cron.d/pwn"]
CLEAN-RESOLVE | F5-B6 redirect + append          targets=["/tmp/ok","/etc/cron.d/pwn"]
unresolved    | F5-B7 stderr second redirect     targets=["/tmp/ok","/etc/cron.d/pwn"] unresolved=[...]
CLEAN-RESOLVE | REG baseline clean               targets=["prod/cluster/prod/pods/api"]
unresolved    | REG chain && denies              unresolved=["chain operator \"&&\" detected outside quotes"]
unresolved    | REG subst denies                 unresolved=["command/process substitution \"$(\" detected"]
CLEAN-RESOLVE | REG nohup trailing & still a wrapper  targets=["prod/cluster/prod/pods/api"]
unresolved    | REG sudo still fails closed      unresolved=["command verb \"kubectl\""]
CLEAN-RESOLVE | REG heredoc redirect (SUR-08)    targets=["/target"]

unexpected results: 0
```

### Finding 1 (#70, newline / `&`) — FIXED, verified

Six of my original inputs, including all four wrapper routes (`at` heredoc body, `bash -c`, `eval`,
`nohup`), now deny. The trailing exemption is real and correctly scoped: `nohup kubectl get
pods/api --context=prod &` still resolves as a wrapper (its `&` is trailing), while
`... & kubectl delete ... &` denies (the FIRST `&` has live content after it). Separator-primitive
probe, run directly:

```
"a & b &"            -> separator="&"        (first & non-trailing -> denies)
"a &\nb"             -> separator="&"
"a && b"             -> separator=undefined  (owned by CHAIN_OPERATORS, not double-counted)
"trailing newline\n" -> separator=undefined  (trailing exemption)
"nohup a &"          -> separator=undefined  (SUR-09 background marker preserved)
```

### Finding 2 (#71, `<<<` herestring) — FIXED, verified independently of the #70 fix

This one needed care: the end-to-end repro now denies on the *newline* separator, which would also
be true if the `<<<` fix were absent. I therefore verified the heredoc scanner directly, where the
#70 fix cannot mask it:

```
stripHeredocBodies("cmd <<<DELIM\nkubectl delete secrets/db-creds --context=prod")
  -> bodies = []   liveText = "cmd <<<DELIM\nkubectl delete secrets/db-creds --context=prod"   (line 2 KEPT live)
stripHeredocBodies("cmd <<DELIM\nswallowed\nDELIM\nkubectl get pods/api")
  -> bodies = ["swallowed"]   liveText = "cmd <<DELIM\nkubectl get pods/api"                   (real heredoc still works)
stripHeredocBodies("cmd <<<<DELIM\nkubectl delete secrets/db-creds")
  -> bodies = []                                                                               (4x "<" also rejected)
```

Both halves of the lookbehind/lookahead are load-bearing and both work.

### Finding 3 (#72, directory-flag bypass + `-C=`→`--context=` alias collision) — FIXED, verified

All four spellings now deny, and the alias collision closes as a consequence of ordering
(`matchDirectoryFlagToken` before the generic short-flag branch) rather than as a second patch —
`-C=prod` no longer supplies the cluster field.

### Finding 4 (#73, only-first-resource-token) — FIXED, verified, with a sibling defect (see Part 2)

`kubectl delete pods/api secrets/db-creds --context=prod` now reports BOTH targets. A malformed
resource among good ones denies the whole call rather than partially accepting
(`kubectl delete pods/api secrets/db/extra --context=prod` ->
`unresolved=["command resource \"pods/api, secrets/db/extra\""]`). `xargs` now always denies, which
is the honest answer for a construct whose arguments arrive on stdin.

### Finding 5 (#74, only-first-redirect-target) — FIXED, verified

`cat payload > /tmp/harmless > /etc/cron.d/pwn` now reports both targets, matching the bash
behaviour I demonstrated in the prior report (both files opened and truncated).

### Finding 6 (#75, CRLF crash) — FIXED, verified under a RECREATED CRLF condition

`shell.ts` is LF in the tree today, so the original crash condition no longer occurs naturally and
simply running the gate would have proved nothing. I recreated it:

```
$ node tmp-redteam2/crlfproof.ts
staged 35 .ts files as CRLF; shell.ts CRLF count = 382, bare-LF = 0
mutants registered = 40
RESULT ok= true | 40 of 40 mutant(s) KILLED.
```

The matching-layer fix (`normalizeLineEndings` in `textMutant`) carries this on its own — the new
`.gitattributes` is belt-and-braces, not the load-bearing half. The gate also passes unmodified:

```
$ node src/qa/shell-detector-mutants.ts
[QA-06 shell-detector-mutants] PASS: 40 of 40 mutant(s) KILLED.   exit=0
```

### Finding 7 (#76, mutant-list overclaim) — FIXED, verified

`src/qa/shell-detector-mutants.ts:8-21` now says plainly that the list is "a manually-curated, not an
AST-derived, enumeration" and that "completeness is asserted by the person writing this list, not
measured by an instrument." It keeps, correctly, the two properties that ARE mechanical. The durable
AST-derived instrument is recorded in `docs/backlog.md:11` rather than silently dropped. This is the
right resolution: the claim was downgraded to the truth instead of the truth being stretched.

### Finding 8 (qa:completeness-claims red) — S4's half RESOLVED; pre-existing half unchanged

The S4-attributable line is gone (`qa-mutation-shell` now emits a parseable 40). What remains is
exactly the two `docs/STATE.md` rows that already failed at HEAD before S4 existed. Still open, still
the Manager's to route, no longer S4's.

---

## Part 2 — attacking the fix itself

### N1. `[ISSUE][HIGH][demonstrated]` A quoted literal `">"` argument silently drops the NEXT positional token — a resource can be hidden from the record again

**Exposure: ~0% of benign traffic; 100% reliable as a deliberate evasion primitive. basis:
counted-in-code** (the skip is keyed on token VALUE at `shell.ts:146-149`) **+ demonstrated.**
Security class — PRINCIPLES rule 21 exempts security findings from the exposure cap, so I am filing
it HIGH; see the triage note at the end of this finding.

**Scenario.** #73's fix excludes a redirect operator and its target from `positional`, to stop a
redirect target being miscounted as a malformed resource. The exclusion tests the token's *value*:

```ts
// src/policy/normalizer/shell.ts:146-149
if (tokens[i] === ">" || tokens[i] === ">>") {
  i += 2; // skip the redirect operator and its target token (if any)
  continue;
}
```

`tokenize` has already stripped quoting by this point, so a **quoted literal** `">"` argument — which
a real shell passes through as ordinary data, not a redirect — is indistinguishable from a live
operator, and takes the following token with it:

```
input:  kubectl delete pods/api ">" secrets/db-creds --context=prod
record: CLEAN-RESOLVE verbs=["delete"] targets=["prod/cluster/prod/pods/api"] unresolved=[]
                                       ^ secrets/db-creds is invisible to the record

input:  kubectl delete pods/api ">>" secrets/db-creds --context=prod
record: CLEAN-RESOLVE verbs=["delete"] targets=["prod/cluster/prod/pods/api"] unresolved=[]
```

This is the same harm as the original Issue #73 — a resource silently absent from the Action record
while the real command acts on it — reached by a new door that #73's own fix opened.

**Current defense, honestly assessed.** The shipped comment at `shell.ts:135-139` anticipates this
exact case and asserts it is safe:

> "A quoted literal `>`/`>>` argument (a contrived, unlikely-in-practice shape) is indistinguishable
> from a live operator by token value alone once quoting is already stripped — that narrow case fails
> closed (the following token is skipped from `positional` too, at worst producing an `unresolved`
> 'command resource' report instead of a clean resolve), not silently accepted."

That claim holds only when the swallowed token was the *only* resource-shaped candidate — which I
confirmed:

```
input:  kubectl delete ">" secrets/db-creds --context=prod
record: unresolved=["command resource \"\""]        <- the documented behaviour, and it is correct here
```

It is false the moment another resource token exists to satisfy the check, which is the arrangement
above. A comment that asserts a safety property the code does not have is worse than no comment: the
next reader will trust it and stop looking.

**Verdict: BREAKS.**

**Named failing test required before merge:**
- `Issue #73 follow-on: a quoted literal '>' argument never removes a resource-shaped token from the record`

**Fix shape (one of):** key the exclusion on POSITION — the offsets `extractRedirectTargets` already
computes over `liveText` — rather than on token value; or drop the value-based skip and instead
subtract the known redirect-target VALUES from `resourceTokens`.

**Triage note, offered honestly:** this is a deliberate-evasion primitive, not something benign
traffic emits. If the Manager rules that S4's threat model excludes a deliberately evasive session,
this drops to MED and does not gate — that is a legitimate rule-21 Role-2b call and I am naming it
rather than forcing it. Under the threat model I believe a session-governance engine actually has
(the governed session may be manipulated), it gates.

---

### N2. `[ISSUE][MED][demonstrated]` The `&` separator fix denies `2>&1` and `&>` — the single most common shell idiom there is, and a shape REQUIREMENTS names as in-scope

**Exposure: 100% of invocations containing `2>&1` or `&>`. basis: demonstrated.** Not a security
finding — it fails CLOSED. Filed for precision and for the adoption risk a noisy gate carries.

**Scenario.** `findLiveTrailingSensitiveSeparator` treats any live single `&` with content after it
as a command separator. In `2>&1` the `&` is a file-descriptor duplication, not a separator:

```
input:  cat p > /tmp/ok 2>&1
record: unresolved=["command separator \"&\" detected outside quotes"]

input:  cat p &> /tmp/ok
record: unresolved=["command separator \"&\" detected outside quotes"]
```

`REQUIREMENTS.md:173` lists **"fd-dup ampersand handling"** among the reference detector's ported
behaviours for SUR-06..09 — so `2>&1` is not merely common, it is named scope, and it is currently
handled by denying it.

**Current defense, honestly assessed.** Fail-closed, so nothing leaks — this cannot become a wrong
`allow`. The cost is different in kind: a governance gate that denies `cmd > log 2>&1` will be
routed around by the humans it governs, and the SUR-06 fix I asked for is what introduced it. The
guard needs one more clause (`&` immediately preceded by a live `>` or a digit-plus-`>` is fd-dup,
not a separator), not a rollback.

**Verdict: BREAKS** (on precision, not on safety).

**Named failing test required before merge:**
- `SUR-06a/fd-dup: 'cmd > /tmp/ok 2>&1' resolves as a write, not as a command separator`

---

### N3. `[SUSPICION][LOW][demonstrated]` A no-space redirect (`>/path`) is no longer a clean write record

```
input:  cat payload >/etc/cron.d/pwn
record: verbs=["write"] targets=["/etc/cron.d/pwn"]
        unresolved=["command verb \"payload\"","command resource \">/etc/cron.d/pwn\"","command flag --context"]
```

The target IS extracted correctly and the record denies, so there is no fail-open — but the token
`>/etc/cron.d/pwn` is simultaneously counted as a malformed resource, which is a precision artifact
of the same value-based skip as N1 (the operator is only recognized as its own whitespace-separated
token). Fixing N1 by position rather than by value closes this at the same time.
**Verdict: UNPROVEN** as to whether this is intended; no security consequence either way.

---

### N4. `[CLEAN][demonstrated]` The fix round did not weaken anything I previously confirmed clean

Re-checked, all still holding: `sudo`/interpreter grammar accident (`sudo kubectl delete ...` ->
`unresolved`), depth cap (`exec` x6 -> `nested command exceeds depth cap (5)`), quoted-chain-operator
inertness, substitution detection, SUR-08's named heredoc-plus-redirect test, and the
`nohup ... &` wrapper. Plus the fix round closed a hole I had graded CLEAN in error: app-security's
Issue #68 (unterminated quote) is now checked first, so my prior report's "no production trigger"
reasoning on that input is superseded by a stronger, cheaper defense. Their call was better than
mine.

### N5. `[CLEAN][demonstrated]` Zero-diff to the kernel boundary still holds

```
$ git diff --stat -- src/policy/normalizer/registry.ts src/policy/kernel/ \
    src/policy/normalizer/action-catalog.ts src/policy/normalizer/target-format.ts
(no output — zero diff)
```

`qa:kernel-purity` and `qa:normalizer-registry-purity` both PASS. The fix round grew the detector by
~90 lines and touched none of the four protected files.

### N6. `[CLEAN][demonstrated]` The mutation gate grew with the fix, not after it

40 mutants, 40 killed, including named regression guards for the exact defects this review round
produced: `trailing-sensitive-separator-newline-disabled`,
`redirect-operator-exclusion-from-positional-disabled`,
`kubectl-attempted-uses-parsed-resources-only-regression`. The fix round wrote mutants for its own
new branches rather than leaving them uncovered.

---

## What I ran (raw)

```
$ npm test
tests 377 | pass 377 | fail 0 | cancelled 0 | skipped 0 | todo 0 | duration_ms 7385.3251
  (up from 336/336 in the prior round; 41 new tests, 0 skipped — the implementer's claim verified)

$ npm run typecheck   -> PASS (no output)
$ npm run lint        -> PASS (no output)

$ node src/qa/shell-detector-mutants.ts
[QA-06 shell-detector-mutants] PASS: 40 of 40 mutant(s) KILLED.   exit=0

$ node tmp-redteam2/crlfproof.ts        # CRLF condition recreated by me
staged 35 .ts files as CRLF; shell.ts CRLF count = 382, bare-LF = 0
RESULT ok= true | 40 of 40 mutant(s) KILLED.

$ node tmp-redteam2/reconfirm.ts        # my 16 original repros + 6 regression guards
unexpected results: 0

$ node tmp-redteam2/newattack.ts        # 12 fresh attacks on the fix itself
2 wrong clean-resolves (N1, N2 above)

QA gates: qa:fixture-coverage PASS, qa:diff-fixture PASS, qa:fixture-isolation PASS,
  qa:broken-instrument-gate PASS, qa:kernel-purity PASS, qa:normalizer-registry-purity PASS,
  qa:recurring-findings PASS, qa:mutation-selftest PASS, qa:runtime-settings-drift PASS
  qa:completeness-claims FAIL — pre-existing docs/STATE.md rows only, S4's own line now clean
  qa:reference-resolver FAIL — "cannot verify (no issue-tracker access), fails closed": a network
    restriction of MY run environment, not a code defect. Settled by the CI run, which has the token.
```

## Findings-to-tests reconciliation

Open findings: **3** (2 `[ISSUE]`, 1 `[SUSPICION]`). Named failing tests: **2**, one per `[ISSUE]`,
listed under each finding. The `[SUSPICION]` (N3) has no executable form as a defect — it is a
precision question that disappears when N1 is fixed by position rather than by value, so it resolves
as a residual-register line, not a test of its own.

## Issues closed this round

`#70`, `#71`, `#72`, `#73`, `#74`, `#75`, `#76` — each individually re-verified against its own
original repro input by me in this session, per the S2/S3 re-confirm convention. Never as a batch on
trust. `#73` is closed with a comment cross-referencing N1's new Issue, so the thread records that
its fix opened a sibling door.

## The single scariest unproven assumption

**That a token's value tells you its syntactic role.** The fix round closed five fail-opens by
reading the command's *structure* — quote states, positions, separators — and then introduced N1 by
reverting to a value check (`tokens[i] === ">"`) at the one place where quoting has already been
stripped and the value can no longer distinguish an operator from data. The prior round's scariest
assumption was "a shell command is one command"; this round's is its successor, and it is narrower
and cheaper to close.

## Go / no-go

**no-go**, on N1 alone, and I want to be precise about the size of that word: all seven of my
original findings are genuinely closed, the evidence for each is a command I ran rather than a
summary I read, and the fix round did its work honestly — it downgraded an overclaim instead of
defending it (#76), wrote mutants for its own new branches, and found two bugs of its own mid-round.
N1 is one line of logic, one named test, and this component ships.

## Single next action

Change `shell.ts:146`'s redirect-operator exclusion from a token-VALUE test to a POSITION test using
the offsets `extractRedirectTargets` already computes, then add
`Issue #73 follow-on: a quoted literal '>' argument never removes a resource-shaped token from the
record` as its failing test. That closes N1 and N3 together.

---

RECEIPT: verdict=no-go
attacks (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] NEW, introduced by #73's fix: shell.ts:146 excludes a redirect operator by token VALUE after quoting is stripped, so a quoted literal '">"' argument silently drops the FOLLOWING resource token - `kubectl delete pods/api ">" secrets/db-creds --context=prod` CLEAN-RESOLVEs with secrets/db-creds invisible; the shipped comment at shell.ts:135-139 explicitly claims this case fails closed, and it does so only when no other resource token exists (verified both ways). Exposure: ~0% of benign traffic, 100% reliable as a deliberate evasion primitive, basis: counted-in-code; rule-21 triage note offered in the report.
2. [ISSUE][MED][demonstrated] NEW, introduced by #70's fix: `2>&1` and `&>` are read as command separators, so `cat p > /tmp/ok 2>&1` denies - fails CLOSED so nothing leaks, but REQUIREMENTS.md:173 names "fd-dup ampersand handling" as ported scope and a gate that denies the commonest shell idiom gets routed around; needs one fd-dup clause, not a rollback.
3. [SUSPICION][LOW][demonstrated] A no-space redirect `>/etc/cron.d/pwn` extracts the target correctly but also counts the token as a malformed resource; denies, so no fail-open - same value-vs-position root cause as finding 1 and closes with it.
4. [CLEAN][demonstrated] Issue #70 (newline / `&` separators) FIXED - all 6 original repros deny, including via at-heredoc, bash -c, eval and nohup; trailing exemption correctly preserves `nohup ... &` as a wrapper while `a & b &` denies on the first, non-trailing `&`.
5. [CLEAN][demonstrated] Issue #71 (`<<<` herestring) FIXED - verified at the scanner level where the #70 fix cannot mask it: `<<<` yields bodies=[] with line 2 kept live, real `<<` heredocs still strip, `<<<<` also rejected.
6. [CLEAN][demonstrated] Issue #72 (directory-flag bypass) FIXED - all 4 spellings deny and `-C=v` no longer supplies the cluster field via the alias table.
7. [CLEAN][demonstrated] Issue #73 (only-first-resource) FIXED - both resources now reported; a malformed resource among good ones denies the whole call; xargs always denies. (Sibling defect at finding 1.)
8. [CLEAN][demonstrated] Issue #74 (only-first-redirect) FIXED - `cat payload > /tmp/harmless > /etc/cron.d/pwn` reports both targets, matching the bash behaviour demonstrated last round.
9. [CLEAN][demonstrated] Issue #75 (CRLF crash) FIXED - proven under a CRLF condition I recreated (382 CRLF / 0 LF in shell.ts): 40 of 40 mutants KILLED where it previously threw; the matching-layer fix carries it independently of the new .gitattributes.
10. [CLEAN][code-traced] Issue #76 (mutant-list overclaim) FIXED - header now states the list is manually curated and not AST-derived, keeps only the two mechanically-true properties, and records the durable instrument in docs/backlog.md:11.
11. [CLEAN][demonstrated] Prior-round CLEANs all still hold - sudo/interpreter grammar accident, depth cap via 6x exec, quoted-chain-operator inertness, substitution detection, SUR-08's heredoc+redirect test; and app-security's #68 fix supersedes my own prior "no production trigger" grading of the unterminated-quote input.
12. [CLEAN][demonstrated] Zero-diff to kernel.ts / registry.ts / action-catalog.ts / target-format.ts still empty by `git diff --stat`, with kernel-purity and registry-purity gates PASS, despite ~90 lines of new detector code.
13. [CLEAN][demonstrated] Mutation gate grew with the fix, not after it - 40/40 killed including named regression guards for this round's own new branches (trailing-sensitive-separator-newline-disabled, redirect-operator-exclusion-from-positional-disabled, kubectl-attempted-uses-parsed-resources-only-regression).
counts (CHECKSUM): issues=2 suspicions=1 clean=10
evidence (CHECKSUM): demonstrated=12 code-traced=1 derived=0
checks=npm test 377 pass/0 fail/0 skip (was 336); typecheck PASS; lint PASS; qa:mutation-shell 40/40 KILLED exit=0; CRLF-recreated rerun 40/40 KILLED; 9 QA gates PASS; qa:completeness-claims FAIL (pre-existing docs/STATE.md rows only, S4's own line now clean); qa:reference-resolver FAIL (no issue-tracker network access in my environment, not a code defect); 22 original-repro + 12 new adversarial inputs executed, 2 wrong clean-resolves
adr=HIT(35)
report=docs/reviews/s4-shell-semantic-detector-red-team-2026-09-03.md
