# Red Team (Sutekh) — S6 policy centralization, ROUND 2: re-confirm of the Stage-3 fix-now round

**Date:** 2026-09-08 · **Scope:** the SAME S6 diff as round 1, now fixed — `src/policy/config/{central-source,position-parser,loader,pin,printer,print-cli}.ts`, `src/policy/rule/{precedence,schema}.ts`, `src/policy/kernel/rule-types.ts`, `src/policy/config/shipped-defaults.json`, `.thoth/policy.json`
**HEAD:** `b8cb88e` (the entire S6 diff — original build AND this round's fixes — is still uncommitted/untracked; see finding 5)
**Round 1:** `docs/reviews/s6-policy-centralization-red-team-2026-09-08.md` (no-go, 1 HIGH / 8 MED / 2 LOW / 2 UNPROVEN)
**Verdict: no-go** — one NEW HIGH, demonstrated, security-category, introduced by this round's own fix.
**ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`

ADRs re-read from `adrCatalog.adrs` for this attack surface: SE ADR-0021 (kernel purity, POL-03 identical verdicts, "never silent allow"), SE ADR-0019 (self-protection / boundary placement), SE ADR-0006 (blast radius, no scope widening), SE ADR-0004 (idempotency), SE ADR-0002/0003 (layering, injectable I/O).

**The headline, stated plainly:** five of the six ratified fix-now items are genuinely, independently
re-verified closed against my own round-1 repros. The sixth (#107) shipped a measured, well-reasoned
deviation that introduces no new fail-open and in fact closes a round-1 UNPROVEN as a bonus. And the fix
for round-1 finding 3 — the one *I* asked for — opened a strictly worse hole one layer down, in the
direction round 1 never checked. That is the no-go.

## What I actually ran

```
$ node --test --test-reporter=tap
# tests 618
# pass 617
# fail 1
# cancelled 0
# skipped 0
# todo 0
not ok 612 - OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass
                                          # pre-existing at HEAD, Issue #113, unchanged from round 1

$ npm run typecheck      # clean, exit 0
$ npm run lint           # clean, exit 0
$ npm run policy:print   # raw output in C4/C5 below
```

Plus eight purpose-built round-2 harnesses, all re-runs or extensions of my own round-1 attacks:
a planted-binary PATH hijack, a `SystemRoot` env-poisoning probe, a mandatory-lock trust-direction
matrix, a duplicate-key parser-differential, a pin TOCTOU + scope probe, a 15-shape `reg.exe` failure
matrix, a 300-document origin-line differential fuzz, and a 20,000-rule CLI truncation re-test. Raw
output inline.

---

# Findings, ranked by blast radius (exposure x irreversibility x silence)

## 1. [ISSUE][HIGH][demonstrated] This round's #108 fix lets an in-repo file void the ENTIRE central layer — and unlock every other central mandatory rule — with a successful, exit-0 load

**Attack.** `mergeLayersWithMandatoryLock` (`precedence.ts:150-165`) now drops the *offending layer*
rather than failing the call. The layer order is `[shipped-defaults, central, project]`, and the lock is
"an earlier layer's `mandatory: true` id may not be redefined by a later layer." `shipped-defaults` is
therefore the most authoritative locker — and `src/policy/config/shipped-defaults.json` is a git-tracked,
in-repo file that **every change under review can edit**.

Add one rule to it, with `mandatory: true` and an id that matches any central rule:

```
=== CONTROL: honest shipped-defaults ===
central-channel status=present channel=win32-registry:HKLM/SOFTWARE/Policies/Thoth
--- resolved rules (5) ---
rule id=shipped-deny-secrets      effect=deny  layer=shipped-defaults ... mandatory=true
rule id=shipped-allow-list        effect=allow layer=shipped-defaults ... mandatory=false
rule id=central-deny-prod-exec    effect=deny  layer=central          ... mandatory=true
rule id=central-deny-secret-read  effect=deny  layer=central          ... mandatory=true
rule id=project-note              effect=allow layer=project          ... mandatory=false
exitCode = 0 | ok = true | voidedLayers = []
central rules surviving in merge: 2

=== ATTACK: shipped-defaults.json adds ONE mandatory rule colliding with a central id ===
central-channel status=present channel=win32-registry:HKLM/SOFTWARE/Policies/Thoth
VOIDED: layer "central" rejected in its entirety: rule id "central-deny-prod-exec" redefines a mandatory rule from an earlier layer
--- resolved rules (3) ---
rule id=central-deny-prod-exec effect=allow layer=shipped-defaults origin=.../shipped-attack.json line=4 mandatory=true
rule id=shipped-allow-list     effect=allow layer=shipped-defaults origin=.../shipped-attack.json line=5 mandatory=false
rule id=project-note           effect=allow layer=project          origin=.../project-plain.json  line=1 mandatory=false
exitCode = 0 | ok = true | voidedLayers = [{"layer":"central","ruleId":"central-deny-prod-exec"}]
central rules surviving in merge: 0
```

Both central mandatory denies are gone. Only ONE was named in the collision; `central-deny-secret-read`
was collateral. The attacker's own `allow` for the exact verb/target central denied now stands, tagged
`mandatory=true`. **The load succeeds. Exit code 0.**

It compounds. Voiding central also destroys central's locks, so the *project* layer's relaxations —
correctly rejected in the control — now land:

```
=== CONTROL honest shipped-defaults ===
voided: [{"layer":"project","ruleId":"central-deny-secret-read"}]
central-deny-secret-read effective: deny from central          # project's relaxation correctly refused

=== ATTACK shipped-defaults collides with central id #1 ===
voided: [{"layer":"central","ruleId":"central-deny-prod-exec"}]
resolved: ["central-deny-prod-exec=allow(shipped-defaults)","shipped-allow-list=allow(shipped-defaults)","central-deny-secret-read=allow(project)"]
central-deny-secret-read effective: allow from project         # every central mandatory deny is now an allow
```

**This is a regression created by this round, not a pre-existing gap.** Before the fix, the same
shipped-defaults edit produced a whole-load rejection — my own round-1 finding 3 captured it verbatim:
`REJECTED: central policy load failed (mandatory-lock-violation) ... exitCode 1`. Loud, visible, nothing
resolved. After the fix it is a successful load with the highest-trust tier silently subtracted. The
attacker traded a hard failure for a working policy of their own authorship.

**Why it is not a slip.** Two green tests pin the behavior as *desired*:

- `precedence.test.ts:219` — "a central redefinition of a shipped-defaults mandatory id voids ONLY
  central, shipped-defaults' own definition still resolves"
- `precedence.test.ts:236` — "a voided layer's OWN mandatory rules do not lock anything for a still-later
  layer — the layer is treated as never having happened"

The second one asserts my compounding step as correct. The root cause is a conflation the whole chain
missed, me included: **POL-08's precedence order was used as the trust order.** They are not the same.
Precedence is shipped, then central, then project; trust is central (out-of-repo, unwritable by the
session) above the two git-tracked layers. The lock keys off position, so the least-trusted-but-earliest
layer outranks the most-trusted one.

**Requirement text, not reviewer opinion.** REQUIREMENTS.md:431, POL-07: *"**The central policy source**
shall be able to mark a rule mandatory; downstream configuration cannot relax it."* The shipped
mechanism lets any layer mark `mandatory`, and lets an in-repo layer relax central by voiding it.
REQUIREMENTS.md:225 (§1.4): *"The plist and HKLM channels require administrator privileges to write, so
a change under review cannot alter the policy that judges it."* This attack alters it from a file inside
the repo. That is §0.4 property 2 inverted — the same property that made round-1's #106 a HIGH.

**Current defense, honestly assessed.** Partial and real: the `VOIDED:` line does print, and it names
`layer "central"` correctly, so an operator running `policy:print` and reading carefully sees it. That is
better than round 1's misattribution. What is absent: any exit-code signal (0), any distinction between
"a low-trust layer was voided" (benign, intended) and "the high-trust layer was voided" (a
policy-integrity event), and any restriction on which layers may declare `mandatory` at all.

**Exposure:** 100% of loads where an earlier layer declares a `mandatory` id also present in a later layer
(basis: counted-in-code — one branch, `precedence.ts:157`). Reachable by any change that can edit
`src/policy/config/shipped-defaults.json`, i.e. every change under review — the exact adversary §0.4
property 2 names (basis: counted-in-code). 0% of live enforcement decisions today, because no gate
consumes `loadEffectivePolicy` yet (basis: counted-in-code, one production consumer — `printer.ts`);
this is the mechanism S6 ships and a future story activates. Irreversible: no. Silent: partially — one
stdout line, exit code 0.

Security category, so exempt from PRINCIPLES rule 21's exposure cap.

**Verdict: BREAKS.**

**Proof-tests required before merge (pick the fix, then write all three):**
- `precedence.test.ts` -> "a mandatory-lock violation may only void a layer LESS trusted than the layer
  whose lock it violated; a shipped-defaults (in-repo) lock colliding with the central layer rejects the
  whole load (fail-closed) rather than silently voiding central" — **or** the simpler shape POL-07's own
  text implies: "`mandatory: true` declared by any layer other than `central` is a schema error."
- `precedence.test.ts` -> "voiding a layer never unlocks a mandatory id declared by a MORE-trusted layer"
  (replaces the current `:236` assertion, which pins the opposite).
- `printer.test.ts` -> "a voided layer is reported with a non-zero exit code when the voided layer is
  `central`" — an operator-truth backstop independent of whichever fix is chosen.

Note the middle test **reverses a currently-green, ratified assertion**. That is deliberate and needs the
Manager's ruling, not a silent edit.

---

## 2. [ISSUE][MED][demonstrated] The new duplicate-key scanner is a parser differential — one `\u0072` re-opens round-1's wrong-origin-line defect

**Attack.** `findDuplicateTopLevelKeys` (`schema.ts:45-88`) accumulates each key's **raw, still-escaped**
source text (`schema.ts:56-62`) and compares those strings. `JSON.parse` compares **unescaped** key
values. So `"rules"` and `"\u0072ules"` are one key to the parser and two different keys to the scanner:

```
$ cat project-esckey.json
{
  "version": "1.0.0",
  "rules": [
    { "id": "decoy-allow", "effect": "allow", "verbs": ["get"], "targets": ["pod"] }
  ],
  "\u0072ules": [
    { "id": "real-deny", "effect": "deny", "verbs": ["get"], "targets": ["pod"] }
  ]
}

$ node a105bypass.mjs
JSON.parse -> Object.keys: ["version","rules"]
JSON.parse -> rules: [{"id":"real-deny","effect":"deny",...}]
findDuplicateTopLevelKeys(raw): []            <-- the new check sees nothing
validateRuleSet(parsed, raw) errors: []       <-- accepted
printer exit=0
rule id=real-deny effect=deny layer=project origin=.../project-esckey.json line=4 mandatory=false
                                                                          ^^^^^^
      # "real-deny" opens on line 7. Line 4 is the DISCARDED decoy. POL-10's answer is wrong.
```

The escaped key also slips past `validateRuleSet`'s unknown-top-level-key check, because by the time that
check runs `JSON.parse` has already normalized it to `rules`.

**And round 1's own named proof-test would not have caught it either.** I proposed "reject a layer whose
tokenized rule-object count disagrees with its parsed rules count." Measured:

```
$ node a105b2.mjs
findRulePositions -> [{"line":4,"column":5}]
JSON.parse rules.length -> 1
count-agreement invariant (round-1's proposed proof-test) would catch this? false
ACTUAL winning rule 'real-deny' opens on source line: 7
```

Counts agree (1 = 1) because `findRulePositions` latches only the first *literal* `"rules"` array while
`JSON.parse` keeps the second. Positions come from the wrong array entirely. My round-1 recommendation
was insufficient; I am saying so rather than letting it stand.

**Current defense, honestly assessed.** The two shapes the round was asked to close ARE closed, correctly
and with good messages (see CLEAN C3). The gap is that the fix blocklists input *shapes* instead of
establishing the *invariant* — that the tokenizer's view of the document and `JSON.parse`'s view agree.
Any escape sequence in a top-level key defeats a raw-text comparison.

**Exposure:** every rule in a layer whose top-level key list contains an escape sequence (basis:
counted-in-code — one raw-text comparison, `schema.ts:69`). Frequency of such files in practice: unknown
(basis: assumption — do not price the finding on it). Irreversible: no. Silent: yes — the origin line
looks authoritative and is wrong, in the one command whose job is answering "why is this blocked".

**Verdict: BREAKS.**

**Proof-tests required:** `schema.test.ts` -> "a top-level key written with a `\uXXXX` escape that
normalizes to a duplicate of another top-level key is rejected" (minimal fix: JSON-unescape each captured
key before counting, or reject any top-level key containing a backslash); `loader.test.ts` -> "the
tokenizer's top-level key set equals `Object.keys(JSON.parse(text))`, or the layer is rejected" — the
invariant, which subsumes every shape of this defect including ones neither of us has thought of.

---

## 3. [ISSUE][MED][demonstrated] POL-09's pin scope half was never fixed, never deferred, and printing the pin made it worse

**Attack.** Issue #110's title names two defects: *"POL-09's pin is computed then discarded, **and hashes
only the central layer**."* The round fixed the first half. `computePin` (`pin.ts:49-60`) still hashes
`centralRaw` alone. Two materially different resolved policies now share one printed digest:

```
$ node a111.mjs
p1 resolved rules: 3 | p2 resolved rules: 2
p1 pin digest: 4e81fba5bdc89649800a28746a3cd4633256fa1bb9615a51a9d63658a3bcb3da
p2 pin digest: 4e81fba5bdc89649800a28746a3cd4633256fa1bb9615a51a9d63658a3bcb3da
materially different effective policies share ONE pin digest? true
```

p2's project layer was *voided by a mandatory-lock collision*; p1's applied in full. The pin cannot tell
those apart, because neither in-repo layer is in the digest — precisely the layers a change under review
can edit, which is the exact property POL-09 exists to make provable ("A change under review cannot alter
the policy that judges it", REQUIREMENTS.md:433, which carries its own explicit warning: **"Do not close
this requirement on the delivery half alone."**).

Surfacing it made the overclaim worse, not better. An operator now reads
`pin: sha256:202a00da... channel=(absent)` on every run and reasonably takes it for a fingerprint of the
policy they were just shown. It fingerprints one third of it.

**Current defense.** None for the scope half. There is no `docs/backlog.md` line for it either — I checked
all 47 lines; lines 44-47 cover the S6 residuals and none is this one. It was not fixed and not deferred;
it fell out of the triage. Finding 4 explains how.

**Exposure:** 100% of printed pins (basis: counted-in-code — one `computePin` call site, `loader.ts:171`).
Irreversible: no. Silent: yes.

**Verdict: BREAKS** (scope overclaim, now operator-visible).

**Proof-test required:** `pin.test.ts` -> "two loads whose PROJECT layers differ produce different pin
digests" — or, if pinning the file layers stays deliberately out of scope, the limit is stated in
`pin.ts`'s header, in the printed line itself (`pin: sha256:... (central channel only)`), and as a named
residual on REQUIREMENTS.md POL-09's row. Silence is the one option that is not available.

---

## 4. [ISSUE][MED][code-traced] The ratified triage row cites the wrong GitHub Issue numbers, and acting on it literally closes the wrong Issues

**Attack.** `docs/decisions.md`'s 2026-09-08 Stage-3 triage row and fix-now row map three items to numbers
that belong to different Issues. Measured against `gh issue list --state all`:

| Item | Number cited in `decisions.md` | Actual GitHub Issue |
|---|---|---|
| POL-09 pin | `#111` | **#110** ("pin is computed then discarded, and hashes only the central layer") |
| `reg.exe` stderr leak | `#112` | **no Issue exists** (round-1 LOW, correctly unfiled per convention) |
| `defaultOutcome` code literal | `#110` | **#112** ("defaultOutcome ... is expressible in no policy tier") |
| test-writer answer key / RED commit | *(unnumbered prose)* | **#111** |

`docs/backlog.md:45` propagates the same error ("`BOOTSTRAP_DEFAULT_OUTCOME` ... (Issue #110 MED)").

This is not cosmetic. The row's ratified disposition is *"Deferred to backlog: `defaultOutcome` (#110)."*
Executed literally, that marks the **pin** Issue deferred. And that is exactly what happened: #110's
second half — the pin's scope — is the one finding in this round that is neither fixed nor backlogged
(finding 3). The number drift is the mechanism by which a half-finding disappeared.

**Current defense.** None. No instrument reconciles a decision row's Issue citations against the tracker.

**Exposure:** 3 of 9 Issue citations in the two ratified rows (basis: counted — enumerated against
`gh issue list --state all`). Irreversible: no, but a wrong close is a lost finding. Silent: yes, until
someone opens the Issue and finds it is about something else.

**Verdict: BREAKS** (audit-trail defect).

**Proof-test required:** an addendum row in `docs/decisions.md` restating the correct mapping (the file is
append-only; the original row is not edited), plus — since this project's own hard rule forbids
hand-derived completeness claims — a QA check that every issue number cited in `docs/decisions.md` and
`docs/backlog.md` resolves to an Issue whose title matches the cited subject. The existing
`qa:reference-resolver` is the natural home.

---

## 5. [ISSUE][MED][demonstrated] The S6 tree is still 100% uncommitted — the fix the decision row promised would resolve Issue #111 has not happened, and there is now twice as much un-diffable work

**Attack.** `docs/decisions.md`'s Stage-3 row rules: *"the `printer.test.ts` mtime/lint-fix 'unmodified
since RED' unverifiability resolves itself the moment this fix-now round is committed."* It has not been
committed.

```
$ git log --oneline -1
b8cb88e S5: review, harden, and ship the out-of-session KNOWN_CONNECTORS/blockWithMessage diff

$ git status --short
 M CHANGELOG.md            M REQUIREMENTS.md          M docs/.maat-state.json
 M docs/REVIEW_LOG.md      M docs/backlog.md          M docs/decisions.md
 M docs/run-log.jsonl      M package.json             M src/policy/kernel/rule-types.ts
 M src/policy/rule/precedence.test.ts   M src/policy/rule/precedence.ts
 M src/policy/rule/schema.test.ts       M src/policy/rule/schema.ts
?? .thoth/  ?? docs/plans/S6-phase1*.md  ?? docs/qa/s6-policy-loader-fixtures/
?? docs/reviews/s6-policy-centralization-*.md
?? src/policy/config/{central-source,loader,pin,position-parser,print-cli,printer}.ts
?? src/policy/config/*.test.ts  ?? src/policy/config/shipped-defaults.json
```

Every new module and its tests are still untracked. The fix-now receipt concedes the consequence:
*"`central-source.test.ts`/`loader.test.ts`, untracked — no git baseline this round, red-team's own
finding 7."* So this round's +11/+9 test-case deltas are measurable only for the two tracked files; for
the two untracked ones the claim rests on a current count with nothing to diff against.

It has gotten worse, not better: round 1 had one un-diffable body of work (the build). There are now two
(the build, and the fixes on top), and no reviewer, auditor or future session can ever reconstruct what
`test-writer` authored at RED.

**Exposure:** 1 of 1 test-writer artifacts, and 100% of this story's code (basis: measured —
`git status`). Irreversible: yes, the RED-time bytes are unrecoverable. Silent: yes, until an audit looks.

**Verdict: BREAKS.** Issue #111 stays open.

**Unlock:** commit the S6 tree now, in two commits (build, then fixes), before any further review round.
Standing fix already named in round 1: test-writer output is committed at RED-CONFIRMED, before Phase 2
starts, every story.

---

## 6. [ISSUE][MED][code-traced] `reviewRoundsSinceClean` reads 0 while the ratified decision row says it was set to 1 — rule 16(c)'s council trigger is not counting

**Attack.** `docs/decisions.md`'s Stage-3 row states: *"`reviewRoundsSinceClean` set to 1."* The state
file disagrees:

```
$ grep -n "reviewRoundsSinceClean" docs/.maat-state.json
679:  "scope": "s6",
681:  "reviewRoundsSinceClean": 0,
682:  "humanRulingRequired": false,
684:  "councilVerdict": null,
```

PRINCIPLES rule 16(c) hard-stops the post-build loop and convenes the design council on **2 consecutive
REWORK/BLOCKED-class verdicts on the same review target**. Round 1 was no-go. This round is no-go. That
is 2 — the council trigger. With the counter reading 0, the increment lands at 1 and the gate does not
fire. PRINCIPLES rule 13: a silently-skipped gate is the worst failure mode.

I am not ruling on whether round 1's counter should have been reset by the same-round APPROVE /
APPROVE-WITH-CONDITIONS from `app-security-reviewer` and `cross-domain-reviewer` — rule 16(c) says
"without an intervening clean or conditional-clean verdict", and whether a sibling reviewer's verdict in
the *same* round counts as intervening is the Manager's call, not mine. What is not a judgement call is
that the log and the state contradict each other, so whichever reading is correct, one of the two
artifacts is wrong.

**Exposure:** 1 of 1 gate counters for this story (basis: counted-in-code). Irreversible: no. Silent: yes.

**Verdict: BREAKS** (governance-gate accounting).

**Proof-test required:** reconcile `docs/.maat-state.json` with the ratified row and state the rule-16(c)
count explicitly in the Manager's next summary, before dispatching a round 3.

---

## 7. [ISSUE][LOW][demonstrated] Every rejection is still prefixed "central policy load failed", and this round's #105 fix routes project-file errors straight through it

`printer.ts:61` hardcodes the prefix for all three remaining reason kinds. Round-1 finding 3(b) asked
that the printer "never attribute it to the central channel when central is absent". The mandatory-lock
half of that is fixed (C2). The parse/schema half is not, and the new duplicate rejections are its most
likely trigger:

```
$ node a105.mjs
central-channel status=absent
REJECTED: central policy load failed (schema-invalid): .../project-dupid.json: rules[2].id: duplicate rule id "dup-rule" ...
```

Central was `absent`. The failure is in `.thoth/policy.json`. The origin path is in the message, so a
careful operator recovers — the headline still points at a registry key that does not exist.
**Verdict: BREAKS**, LOW — no Issue filed per this project's LOW-severity convention.

**Proof-test:** `printer.test.ts` -> "a rejection caused by a project or shipped-defaults file names that
file's layer in the headline, never central policy".

---

## 8. [SUSPICION][LOW][demonstrated] `isNotFoundError` still matches the not-found text anywhere in stderr, noise included

```
C11 exit=1, not-found text EMBEDDED in noise     -> RESULT {"status":"absent"}
```

Unchanged from round 1, and materially less reachable now: the only realistic way to control reg.exe's
stderr was the PATH hijack, which is closed (C1). A real reg.exe emitting the not-found line plus
unrelated noise is a shape neither of us has ever observed. **Verdict: UNPROVEN** — I could not construct
a real occurrence. **Settles it:** anchor the pattern to a full stderr line rather than a substring, or
record the substring match as deliberate in the `NOT_FOUND_PATTERNS` comment.

---

## 9. [SUSPICION][LOW][demonstrated] `resolveSystemRegExePath` trusts `process.env.SystemRoot` at call time

```
$ node a106c.mjs      # process.env.SystemRoot set in-process before the call
resolved = ...\scratchpad\fakeroot\System32\reg.exe
READ threw: Command failed: ...\fakeroot\System32\reg.exe query HKLM\SOFTWARE\Policies\Thoth ... | status= 1
```

The redirect works, and it fails CLOSED (a read error, not a silent "absent"). Reachability is the point:
the closed PATH vector needed only a *file* dropped into `node_modules/.bin` by any dependency install.
This one needs code execution inside the process or control of the parent environment — and an attacker
with either can monkey-patch `child_process` directly, so the fix is not what stands between them and the
channel. Setting it from the shell did not even propagate (`SystemRoot=... node ...` still resolved
`C:\WINDOWS`). Residual, not a regression, and not a reason to widen the fix.
**Verdict: UNPROVEN** (reachability, not mechanism). **Settles it:** `central-source.test.ts` -> "the
resolved reg.exe path is rejected if it is not an absolute path under a system-owned root", if the
Manager wants belt-and-braces.

---

## 10. [SUSPICION][MED][code-traced] The full real-registry round trip has still never been run

Carried from round 1, unchanged and honestly disclosed in `central-source.ts`'s header and
`docs/backlog.md:43`. Nothing this round touched the write half. `reg add` remains refused by the tool
classifier, and this session's token remains UAC-filtered. **Verdict: UNPROVEN** — a task with a named
human owner, not a blocker. **Settles it:** one human, one elevated shell: `reg add` the key with a
minified JSON value containing non-ASCII rationale text, then `npm run policy:print`, raw output pasted
into the Stage-3 evidence.

---

# What held up (SURVIVES — re-attacked with round 1's own repros, and defended)

- **C1 [demonstrated] Issue #106, the reg.exe PATH hijack, is CLOSED.** A copy of `whoami.exe` renamed
  `reg.exe`, planted in a directory prepended to PATH exactly the way `npm run` prepends
  `node_modules/.bin`:
  ```
  === HIJACKED PATH ===
  PATH[0] = ...\scratchpad\hijack
  resolveSystemRegExePath() = C:\WINDOWS\System32\reg.exe
  OUTBOUND cmd = "C:\WINDOWS\System32\reg.exe"
  OUTBOUND stdio = ["ignore","pipe","pipe"]
  is absolute: true | rooted at SystemRoot: true
  REAL READ -> {"status":"absent"}
  ```
  The planted binary is discriminating: `whoami.exe` exits 0 with a username on stdout, which would drive
  `extractRegSzValue` to null and throw "unexpected output shape". Instead the read returned `absent` —
  the real reg.exe answered. Resolution happens at call time inside `read()`, not at module load, so the
  exported `defaultCentralPolicySource` is covered too. SURVIVES.

- **C2 [demonstrated] Issue #108's stated defect is CLOSED — only the offending layer is voided, and it
  is named correctly.** With central absent and with central present:
  ```
  central-channel status=absent
  VOIDED: layer "project" rejected in its entirety: rule id "shipped-deny-secrets" redefines a mandatory rule from an earlier layer
  --- resolved rules (2) ---
  rule id=shipped-deny-secrets effect=deny layer=shipped-defaults ... mandatory=true
  ok= true  voidedLayers= [{"layer":"project","ruleId":"shipped-deny-secrets"}]
  ```
  Shipped-defaults' mandatory rule survives the project layer's attempt to redefine it, central still
  merges when present, and the message names `project` — never "central policy load failed" with central
  absent. Round-1 finding 3(a) and 3(b) are both satisfied *for this direction*. Finding 1 is about the
  other direction. SURVIVES.

- **C3 [demonstrated] Issue #105 and its extension are CLOSED for both named shapes.** Duplicate rule id:
  `rules[2].id: duplicate rule id "dup-rule" (first defined at rules[0], repeated at rules[2])`, exit 1.
  Duplicate top-level "rules" key: `duplicate top-level key "rules" - JSON.parse silently keeps only the
  LAST occurrence; rejected outright`, exit 1. Both messages name the offending key and both indices, as
  POL-06 requires. Rejection happens before the tokenizer is ever reached, which is the right place.
  SURVIVES (the escaped-key variant is finding 2, a different input shape).

- **C4 [demonstrated] The pin is surfaced, and the single-read invariant survived being threaded through
  the printer.** Real run:
  ```
  $ npm run policy:print
  central-channel status=absent
  --- resolved rules (0) ---
  pin: sha256:202a00dafe29bb3811be1f07a3b4bdf8b885cadc2f49ba56f71e5d394c2b6dd1 channel=(absent) computedAt=2026-09-08T18:03:27.492Z
  NOTE: this reflects S6's own resolved policy (loadEffectivePolicy) -- it is not necessarily what hooks/pretooluse-kernel-gate.mjs enforces live today ...
  ```
  TOCTOU probe with a source returning DIFFERENT bytes on every call, through the full printer path:
  ```
  read() call count through printer+pin path: 1 (must be 1)
  pin.channel: ch1 | stdout channel line: central-channel status=present channel=ch1
  pin digest == sha256(FIRST read's bytes)? true
  ```
  Threading the pin through `PrinterResult` rather than into the locked `stdout` string introduced no
  second read and no new call site. Issue #109's disclosure line ships on the same mechanism. SURVIVES
  (the pin's *scope* is finding 3).

- **C5 [demonstrated] The stderr leak is CLOSED.** Round 1: `node print-cli.ts 2>&1 1>/dev/null` printed
  `ERROR: The system was unable to find the specified registry key or value.` Now:
  ```
  $ node src/policy/config/print-cli.ts 2>&1 1>/dev/null
  [end of stderr capture]        # empty
  ```
  and stdio is asserted at the type level (`SyncRegQueryRunner`'s `stdio: ["ignore","pipe","pipe"]`), so a
  caller cannot pass anything else. stderr is still captured into the thrown error — C6's matrix proves
  classification still works. SURVIVES.

- **C6 [demonstrated] The #107 deviation introduces no new fail-open, and closes a round-1 UNPROVEN as a
  bonus.** 15-shape failure matrix through the injected runner:
  ```
  C1  exit=1, en-US not-found                      -> RESULT {"status":"absent"}
  C2  exit=1, de-DE not-found                      -> THROWS -> loader read-error (fail-closed)
  C3  exit=1, fr-FR not-found                      -> THROWS -> loader read-error (fail-closed)
  C4  exit=1, ACCESS DENIED                        -> THROWS -> loader read-error (fail-closed)
  C5  exit=1, invalid syntax                       -> THROWS -> loader read-error (fail-closed)
  C6  TIMEOUT: status=null, stderr HAS not-found   -> THROWS -> loader read-error (fail-closed)
  C7  ENOBUFS: status=undefined, not-found stderr  -> THROWS -> loader read-error (fail-closed)
  C8  exit=0-ish (status=0) + not-found stderr     -> THROWS -> loader read-error (fail-closed)
  C9  ENOENT (binary missing), empty stderr        -> THROWS -> loader read-error (fail-closed)
  C10 exit=1, not-found as a Buffer                -> RESULT {"status":"absent"}
  C11 exit=1, not-found text EMBEDDED in noise     -> RESULT {"status":"absent"}     (finding 8)
  C12 exit=1, stderr undefined                     -> THROWS -> loader read-error (fail-closed)
  C13 exit=0, real captured stdout shape           -> RESULT {"status":"present", ...}
  C14 exit=0, value line MISSING                   -> THROWS -> fail-closed
  C15 non-win32 platform                           -> RESULT {"status":"unsupported"}
  ```
  Exactly one shape resolves to absent for the right reason, and **C6/C7 are new**: the
  exit-code-1-as-necessary-precondition closes round-1 finding 13 (a timeout or maxBuffer overflow whose
  captured stderr happened to contain the not-found text used to classify as absent — the fail-open
  direction). The deviation is a net security improvement over the literal ask, not merely a substitute
  for it. C2/C3 confirm the locale gap is narrowed, not closed, and the direction stays fail-closed
  (availability, never bypass). `docs/backlog.md:47` discloses this accurately — "only PARTIALLY closed",
  "extensible, currently-English-only pattern array", "needs a verified translated sample (not an
  invented one)" — with no overclaim anywhere in it. This is the right engineering call, correctly
  disclosed. SURVIVES.

- **C7 [demonstrated] Origin-line reporting is correct on every valid document I could build.**
  300-document differential fuzz (LF/CRLF x 3 indent styles x 1-5 rules x 10 adversarial rationale
  payloads — escaped quotes, backslashes, real newline escapes, braces/brackets inside strings, astral
  emoji, tabs, empty strings, an embedded "rules" array decoy, non-ASCII/CJK), each reported line
  cross-checked against independently computed ground truth:
  `origin-line differential: 300 documents, 0 mismatches`. Now that duplicate ids are rejected,
  `printer.ts:81`'s `findIndex` is exact. SURVIVES.

- **C8 [demonstrated] print-cli's two NEW trailing writes do not truncate its output.** The
  write-then-`process.exit` footgun re-tested against a 20,000-rule policy:
  `through a pipe: 20004 lines`, `to a file: 20004 lines`, last line intact, pin line present. SURVIVES.

- **C9 [code-traced] validateRuleSet's new optional `rawText` parameter is not a silently-skipped check
  in production.** A grep for non-test `validateRuleSet(` call sites across `src` and `hooks` returns
  exactly one — `loader.ts:95`, `validateRuleSet(parsed, text)` — which always passes it. The optionality
  only affects direct object-literal callers in tests. SURVIVES.

- **C10 [demonstrated] The suite, types and lint are where the receipt says.** 617 pass / 1 fail /
  0 skipped / 0 todo, up from round 1's 603/1/0; the single failure is `OSS-01 (dogfood)`, pre-existing at
  HEAD, tracked as Issue #113, unchanged. `npm run typecheck` and `npm run lint` both exit 0 — including
  on `printer.test.ts`, re-confirming round 1's finding that the recorded lint failure does not reproduce.
  SURVIVES.

- **C11 [code-traced] The Issues #65/#66/#99 bug shape is still structurally impossible.**
  `precedence.ts:156` finds a collision by asking `lockedMandatoryIds.has(rule.id)` — no layer name
  appears anywhere in the lock check, before or after this round's rewrite. The shipped-defaults to
  central direction has its own named test. Finding 1 is a *trust-model* defect, not this bug shape: the
  code is general exactly as claimed; being general in the wrong dimension is the problem. SURVIVES.

---

# The single scariest unproven assumption

**That "earlier layer" means "more trusted layer".** It does not. `shipped-defaults` is first in
precedence and lives in the repo; `central` is second in precedence and lives behind an administrator
ACL. This round's fix — the one round 1 asked for — converted that latent conflation into a working
exploit: a three-line edit to a git-tracked JSON file removes the entire out-of-repo policy tier, unlocks
everything it was protecting, and reports success. The mechanism S6 exists to build is the mechanism that
"a change under review cannot alter the policy that judges it" rests on, and right now a change under
review alters it with a file it already owns.

Round 1's scariest assumption was about *which binary* speaks for the central channel. That one is fixed,
cleanly and completely. This round's is about *which layer is allowed to silence it*.

# Verdict

**no-go.** One HIGH, demonstrated, security-category, introduced by this round's own fix and pinned by two
green tests. Five MED and one LOW besides, each with a named failing test.

The fix work itself was good, and I want that on the record next to the no-go: five of six ratified items
independently re-verified closed against my own repros, no regression in the 300-document origin fuzz, no
regression in the failure matrix, no new TOCTOU, no truncation, and the #107 deviation is a better
engineering call than the thing I asked for — it closed a fail-open I had only flagged as UNPROVEN. The
no-go is one design question — *which layer may lock which* — not a rewrite.

**Rule 16(c) notice for the Manager:** this is the second consecutive REWORK/BLOCKED-class verdict on this
review target. Whether the same-round APPROVE / APPROVE-WITH-CONDITIONS from the sibling reviewers counts
as an intervening clean verdict is the Manager's call, and finding 6 records that the state file and the
decision log disagree about the count. Naming it rather than letting it pass silently (PRINCIPLES rule 13).

# Single next action

Rule on POL-07's trust model — either "mandatory is a central-source-only declaration" (matches
REQUIREMENTS.md:431's literal text, smallest change) or "a lock may only void a layer less trusted than
the locking layer" — then land finding 1's three proof-tests, one of which reverses the currently-green
`precedence.test.ts:236`. Commit the tree (finding 5) in the same pass so round 3 has a diff to read.

---

# Editorial (verdict-neutral, fix as plain edits, no re-review)

- `docs/backlog.md:45` cites "Issue #110" for `defaultOutcome`; the real Issue is #112 (finding 4).
- `precedence.ts:186-192`'s POST-S6 DISPOSITION comment on `mergeLayers` is now accurate (zero production
  callers, confirmed) — still worth a `@deprecated` tag so the warning comes from tooling, not prose.
  Carried unchanged from round 1.
- `printer.ts:72-73`'s comment states "Every one of test-writer's own printer.test.ts fixtures has ZERO
  voided layers, so this loop is a strict no-op against every locked assertion in that file" — true, and
  it is a completeness claim about a test file made in prose. CLAUDE.md's hard rule wants those generated
  by an instrument; here the set is short enough to eyeball, so this is a note, not a violation.
- `central-source.ts:113` uses a separate re-export statement for `resolveSystemRegExePath` while every
  other export in the file is inline. Cosmetic.
- `docs/decisions.md`'s fix-now row describes the stderr fix as "#112 (LOW)"; no Issue was ever filed for
  it (correctly — round 1 graded it LOW). The number should simply be dropped, not reassigned.

---

```
RECEIPT: verdict=no-go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] This round's #108 fix lets the in-repo, git-tracked shipped-defaults.json void the ENTIRE central layer with ONE mandatory-id collision - exit 0, the load "succeeds", and every other central mandatory id is unlocked too so the project layer's relaxations then land; pre-fix the same edit gave a visible whole-load REJECTED / exit 1, so this is a regression from denial-of-service to silent selective-suppression. Precedence order was used as trust order. Contradicts POL-07's literal text (REQUIREMENTS.md:431) and section 0.4 property 2; pinned as correct by two green tests (precedence.test.ts:219 and :236). Defense: the VOIDED line prints and names the layer - no exit-code signal, no trust-rank check. Exposure: 100% of loads with an earlier-layer mandatory id also present later, basis counted-in-code; reachable by every change under review, basis counted-in-code; 0% of live enforcement today (no gate consumes the loader).
2. [ISSUE][MED][demonstrated] The new findDuplicateTopLevelKeys (schema.ts:45-88) compares RAW escaped key text while JSON.parse compares unescaped values - a unicode-escaped duplicate "rules" key re-opens round-1's B3 wrong-origin-line defect (printer reports line=4 for a rule that opens on line 7, exit 0); round-1's own proposed count-agreement proof-test was measured and would not catch it either (positions 1 = rules 1). Defense: none - the fix blocklists two input shapes instead of asserting the tokenizer/parser agreement invariant.
3. [ISSUE][MED][demonstrated] Issue #110's second half (the pin hashes only centralRaw) is neither fixed nor backlogged, and printing the pin made the overclaim operator-visible: two materially different resolved policies (3 rules vs 2, one with a voided layer) share one digest, demonstrated byte-identical. REQUIREMENTS.md:433 explicitly warns not to close POL-09 on the delivery half alone. Defense: none; no backlog line exists across all 47.
4. [ISSUE][MED][code-traced] docs/decisions.md's ratified triage rows cite the wrong Issue numbers for 3 of 9 items (pin is #110 but cited as #111; defaultOutcome is #112 but cited as #110; the stderr leak has no Issue at all but is cited as #112), propagated into docs/backlog.md:45 - executing the ratified "defer #110" literally defers the PIN issue, which is precisely how finding 3's half-finding vanished. Defense: no instrument reconciles decision-row citations against the tracker.
5. [ISSUE][MED][demonstrated] The S6 tree is still 100% uncommitted (git log HEAD=b8cb88e, every config module untracked) - the decision row's "resolves itself the moment this fix-now round is committed" has not happened, Issue #111 stays open, and there are now TWO un-diffable bodies of work instead of one; the fix-now receipt itself concedes there was no git baseline this round for two test files. Defense: none; the RED-time bytes are unrecoverable.
6. [ISSUE][MED][code-traced] docs/.maat-state.json:681 reads reviewRoundsSinceClean=0 while the ratified decision row says it was set to 1 - with this second consecutive no-go, PRINCIPLES rule 16(c)'s council trigger increments to 1 instead of 2 and does not fire. Log and state contradict each other; one of them is wrong either way. Defense: none.
7. [ISSUE][LOW][demonstrated] printer.ts:61 still hardcodes the "central policy load failed" prefix for all three reason kinds, and this round's #105 fix routes project-file duplicate-id / duplicate-key rejections straight through it while central is absent - round-1 finding 3(b) is only half fixed; the origin path inside the message is the only thing that saves a careful operator. No Issue filed per this project's LOW convention.
8. [SUSPICION][LOW][demonstrated] isNotFoundError matches the not-found text as a substring anywhere in stderr, noise included (matrix case C11) - unchanged from round 1, and much less reachable now that the PATH hijack is closed; could not construct a real occurrence.
9. [SUSPICION][LOW][demonstrated] resolveSystemRegExePath trusts process.env.SystemRoot at call time; an in-process override redirects the binary (demonstrated, and it fails CLOSED). Reaching it needs code execution in-process, a strictly higher bar than the closed file-drop vector, and such an attacker can patch child_process anyway - residual, not a regression.
10. [SUSPICION][MED][code-traced] The full real-registry round trip (provision, read, merge, print) has still never been run; nothing this round touched the write half, reg add is still refused by the tool classifier, and the session token is still UAC-filtered. Human-owned task, not a blocker.
11. [CLEAN][demonstrated] Issue #106 CLOSED: a planted whoami.exe renamed reg.exe at PATH position 0 no longer answers - the outbound cmd is the absolute System32 reg.exe path resolved at call time, and the real reg.exe returned status=absent where the planted one would have thrown "unexpected output shape".
12. [CLEAN][demonstrated] Issue #108's stated defect CLOSED: a project-layer collision voids ONLY the project layer; shipped-defaults' mandatory rule survives and central still merges when present; the VOIDED line names layer "project", never "central policy load failed".
13. [CLEAN][demonstrated] Issue #105 and its extension CLOSED for both named shapes: a duplicate rule id and a duplicate top-level "rules" key are each rejected by validateRuleSet with a message naming the key and both indices, exit 1, before the tokenizer is ever reached.
14. [CLEAN][demonstrated] The pin's delivery half is done and the single-read invariant survived being threaded through the printer: pin printed by print-cli, a mutating-source probe shows read() called exactly once through printer plus pin, and the digest equals sha256 of the first read's bytes.
15. [CLEAN][demonstrated] The reg.exe stderr leak is CLOSED: running print-cli with stdout discarded now captures nothing on stderr, and the stdio triple is pinned in SyncRegQueryRunner's own type so no caller can widen it.
16. [CLEAN][demonstrated] The #107 deviation introduces no new fail-open across a 15-shape failure matrix, and it CLOSES round-1 finding 13 as a bonus (a timeout or ENOBUFS carrying not-found stderr now fails closed); docs/backlog.md:47 discloses the residual English-pattern dependence accurately, with no overclaim.
17. [CLEAN][demonstrated] Origin-line reporting is correct on valid input: a 300-document differential fuzz (CRLF/LF x 3 indents x 1-5 rules x 10 adversarial payloads including escaped quotes, astral emoji, an embedded rules-array decoy, and CJK) produced 0 mismatches.
18. [CLEAN][demonstrated] print-cli's two NEW trailing writes do not truncate its output: 20,004 of 20,004 lines through a pipe and to a file, last line intact, pin line present.
19. [CLEAN][code-traced] validateRuleSet's new optional rawText parameter is not a silently-skipped check: exactly one non-test production call site (loader.ts:95), and it always passes rawText.
20. [CLEAN][demonstrated] Suite, types and lint match the receipt: 617 pass / 1 fail / 0 skipped / 0 todo (up from 603/1/0), the 1 fail pre-existing at HEAD (Issue #113); typecheck and lint both exit 0, re-confirming that printer.test.ts's recorded lint failure does not reproduce.
21. [CLEAN][code-traced] The Issues #65/#66/#99 bug shape stays structurally impossible: precedence.ts:156 keys off the rule's own mandatory field, with no layer name anywhere in the lock check. Finding 1 is a trust-model defect, not this shape.
counts (CHECKSUM): issues=7 suspicions=3 clean=11
evidence (CHECKSUM): demonstrated=16 code-traced=5 derived=0
checks=617 pass / 1 fail / 0 skipped / 0 todo (full suite, the 1 fail pre-existing at HEAD, Issue #113); typecheck exit 0; lint exit 0; 300-document origin-line differential fuzz 0 mismatches; 15-shape reg.exe failure matrix; 20,004-line CLI truncation re-test; 8 custom round-2 attack harnesses
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-red-team-round2-2026-09-08.md
```
