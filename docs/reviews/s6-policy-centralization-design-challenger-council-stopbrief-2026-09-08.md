# Design Challenger (Apep) — S6 Policy Centralization, Council Stop Brief

**Date:** 2026-09-08 · **Scope:** the two live findings the council was convened to resolve — Issue #114
(HIGH, `mergeLayersWithMandatoryLock` trust-model) and Issue #115 (MED, `findDuplicateTopLevelKeys` parser
differential). **Trigger:** PRINCIPLES rule 16(c) — 2 consecutive non-clean `red-team` rounds against the
S6 diff (round 1: Issue #106 HIGH reg.exe PATH hijack, fixed; round 2: Issue #114 HIGH, open).
**HEAD:** `280f1c7` (confirmed committed — `git status --short` shows only `docs/decisions.md` modified;
the round-2 report's finding 5, "tree still uncommitted," is CLOSED as of this HEAD).
**Mode:** Stop Brief, per this council seat's contract — no new attack surface opened, no fix designed.
**ADR cache:** reused catalog fingerprint `83b2e3e`, 35 ADRs (`adr/devops:12`, `adr/software-engineering:23`).

Read in full before this brief: `docs/STATE.md`, `CLAUDE.md`, `docs/PRINCIPLES.md`, `docs/.maat-state.json`,
`docs/reviews/s6-policy-centralization-red-team-round2-2026-09-08.md` (the triggering report, all 21
findings), `docs/decisions.md`'s 2026-09-08 S6 rows, and the code at `280f1c7`:
`src/policy/rule/precedence.ts` (`mergeLayersWithMandatoryLock`, `mergeLayers`), `src/policy/rule/schema.ts`
(`findDuplicateTopLevelKeys`, `validateRuleSet`), `src/policy/config/loader.ts` (`loadEffectivePolicy`),
`src/policy/config/printer.ts`, `src/policy/config/shipped-defaults.json`. Independently re-ran
`precedence.test.ts` + `schema.test.ts` (47/47 pass) and grepped every production call site of
`mergeLayersWithMandatoryLock`/`loadEffectivePolicy` to confirm live-consumer count.

---

## 1. Issue #114 (HIGH per red-team) — `mergeLayersWithMandatoryLock` uses precedence order as trust order

**Attack (unchanged from red-team, independently re-traced).** `precedence.ts:150-165`:

```ts
for (const layer of layers) {
  const collision = layer.items.find((rule) => lockedMandatoryIds.has(rule.id));
  if (collision) {
    voidedLayers.push({ layer: layer.name, ruleId: collision.id });
    continue; // this layer's ENTIRE contribution is dropped -- not merged, does not lock anything
  }
  acceptedLayers.push(layer);
  for (const rule of layer.items) {
    if (rule.mandatory) lockedMandatoryIds.add(rule.id);
  }
}
```

Layers are walked in POL-08 precedence order — `[shipped-defaults, central, project]` — and "earlier
accepted" is the only thing that gets to lock a later layer. `shipped-defaults` is a git-tracked file
(`src/policy/config/shipped-defaults.json`) every change under review can edit; `central` is the one
out-of-repo, administrator-only tier (REQUIREMENTS.md §1.4: "The plist and HKLM channels require
administrator privileges to write, so a change under review cannot alter the policy that judges it"). A
`shipped-defaults` rule with `mandatory: true` and an id colliding with any `central` rule voids `central`
in its entirety — at exit code 0 — and, because a voided layer never locks anything (the correctly-pinned
`precedence.test.ts:236` case), also strips whatever mandatory locks `central` would otherwise have placed
on `project`. One in-repo edit removes the administrator tier and reopens every relaxation it was blocking.

**What I independently confirmed, not just re-read.**

```
$ node --test --test-reporter=tap src/policy/rule/precedence.test.ts
1..21 (all present, all passing) — including :219 ("a central redefinition of a shipped-defaults
mandatory id voids ONLY central, shipped-defaults' own definition still resolves") and :236 ("a voided
layer's OWN mandatory rules do not lock anything for a still-later layer").
```

Both tests pin the behavior as correct — this is not a slip, it is a designed-in and tested consequence of
treating array position as trust rank. The code trace matches red-team's report exactly; I did not need to
re-run their exploit script to confirm the mechanism, since the `continue`-before-locking branch at
`precedence.ts:157-160` is unconditional and generic across *which* layer collides with *which* — the same
branch that (correctly) protects `central` from `project` is the one that (incorrectly) lets
`shipped-defaults` void `central`.

**Live-consumer check (the fact that changes the calibration).**

```
$ grep -rl "mergeLayersWithMandatoryLock\|loadEffectivePolicy" src hooks
src/policy/rule/precedence.ts        (definition)
src/policy/rule/precedence.test.ts   (test)
src/policy/kernel/rule-types.ts      (type only)
src/policy/config/loader.ts          (definition, loadEffectivePolicy)
src/policy/config/loader.test.ts     (test)
src/policy/config/printer.ts         (the ONLY production caller)
                                       -- zero hits under hooks/
$ grep -n "policy:print" package.json .github/workflows/ci.yml
package.json:33:    "policy:print": "node src/policy/config/print-cli.ts"
                                       -- absent from ci.yml: not even CI-invoked
```

`printer.ts` is the sole production consumer, reached only by a human or agent manually running
`npm run policy:print`. No `hooks/*` file imports this loader (matches `docs/STATE.md`'s own resume point:
S5's `PreToolUse` entry is deliberately unwired, pending S6). This is exactly what S6 exists to become the
backing mechanism for — but it is not that mechanism yet.

**Calibration (my own tags, which diverge from red-team's on `reach` — explained, not overriding
red-team's report).**

- **severity: MED** (not HIGH) under this agent's strict calibration, for one reason only: `reach=user`
  requires a named live entry point where a real user's/session's ordinary action invokes the vulnerable
  code path, and none exists today — the grep above is the proof that it doesn't. Every other HIGH
  condition is met (`evidence=code-traced`, `likelihood=plausible`, `effect=security-boundary weakened`).
- **evidence: code-traced** (`precedence.ts:150-165`) + independently re-run tests confirming the pinned
  behavior. Also `demonstrated` in red-team's own report (I did not need to re-run their repro to accept
  it; the code trace alone settles it).
- **reach: operator** — reaching this today requires (a) a session/contributor editing
  `shipped-defaults.json` (an ordinary, permitted file edit — not privileged) AND (b) a human running
  `npm run policy:print` to observe any effect at all, since nothing else consumes the loader. Entry point
  named per the reach-proof requirement: `src/policy/config/print-cli.ts` -> `printer.ts` ->
  `loader.ts:loadEffectivePolicy` -> `precedence.ts:150`. No `PreToolUse`/session-gate entry point exists.
- **likelihood: plausible** — a single JSON edit, no race, no rare timing; foreseeable both by accident
  (two contributors independently choosing the same descriptive rule id) and adversarially (the exact
  "change under review" adversary REQUIREMENTS.md §1.4 and ADR-0021 both name by intent).
- **undo: runbook-reversible** — a git revert of `shipped-defaults.json` fixes it, but only once someone
  notices; the `VOIDED:` line does print (not fully silent) but the exit code stays 0 (no failure signal
  a script or CI gate would catch).
- **Exposure:** 0% of live enforcement decisions today (basis: counted-in-code — zero `hooks/` consumers,
  confirmed above; `policy:print` also absent from CI). 100% of loads that reach
  `mergeLayersWithMandatoryLock` with an earlier-declared layer's mandatory id colliding with a later
  layer's id, the moment any future gate wires this loader (basis: counted-in-code — one unconditional
  branch, `precedence.ts:157`).

**Verdict: BREAKS, capped at MED by my own `reach=user` proof requirement — but this does NOT mean it may
ship or defer.** The effect is a security boundary bypassed/weakened (the administrator-only central tier
silenced by a git-tracked file), which is this agent's mandatory boundary-crossing carve-out: **a MED
whose effect crosses a security boundary may never route to the residual register, regardless of what
capped it at MED.** It routes to (a) — a named failing proof-test — full stop, the same practical outcome
red-team's own HIGH tag already drives (red-team's rules exempt security findings from the exposure cap
directly, reaching the same "must fix, cannot defer" destination by a different, also-valid path). Read
this as two calibration lenses converging on one answer, not a disagreement: **this finding must close
before S6 ships, and specifically before S5's `PreToolUse` reactivation gives it a live entry point.**

**Proof-tests required (red-team's three, independently endorsed after code-tracing the same branch):**
- `precedence.test.ts` -> "a mandatory-lock violation may only void a layer LESS trusted than the layer
  whose lock it violated; a shipped-defaults lock colliding with central rejects the whole load" — or the
  narrower shape POL-07's own text implies (see Candidate Paths below).
- `precedence.test.ts` -> "voiding a layer never unlocks a mandatory id declared by a MORE-trusted layer"
  — this reverses the currently-green `:236` assertion; that reversal needs the Manager's explicit ruling,
  not a silent edit (PRINCIPLES rule 11: reports/pinned assertions are not silently overwritten).
- `printer.test.ts` -> "a voided layer is reported with a non-zero exit code when the voided layer is
  `central`" — an operator-truth backstop independent of which fix direction is chosen.

---

## 2. Issue #115 (MED) — `findDuplicateTopLevelKeys` is a parser differential, not a duplicate-key check

**Attack (unchanged from red-team, independently re-traced).** `schema.ts:56-62` accumulates each
top-level key's **raw, still-escaped source text**:

```ts
if (text[j] === "\\") {
  raw += (text[j] ?? "") + (text[j + 1] ?? "");   // keeps the backslash AND the escaped char, verbatim
  j += 2;
}
```

`JSON.parse` compares the **unescaped semantic value**. `"rules"` and `"rules"` are the same key to
the parser (`r` = `r`) and two different strings to this scanner. A document with both keys parses to
one `rules` array (JSON.parse's own last-write-wins on the literal, unescaped duplicate) while
`findDuplicateTopLevelKeys` reports zero duplicates, so `validateRuleSet` accepts the document with 0
errors — silently re-opening the exact wrong-origin-line defect Issue #105 was written to close.

**What this does and does not change.** I confirmed by code trace (not just accepting red-team's framing)
that the *effective ruleset* is not corrupted — `JSON.parse`'s last-write-wins is the same resolution any
ordinary single-`rules`-key document gets, so the rule that actually governs a real tool call is the
correct one. What is corrupted is `printer.ts`'s **attribution**: `findRulePositions` (`position-parser.ts`)
latches onto the *first* literal `"rules"` array's token positions while `JSON.parse` keeps the *second*
array's values, so the reported source line for the winning rule points at the wrong (decoy) array. This
is an audit-trail/evidence defect — POL-06's "unknown key is an error, not a silent no-op" and POL-10's
"inspectable" both bear on it — not an enforcement bypass.

**Is this the same root shape as #114, or a genuinely separate bug?** I read the code for both before
answering. **Mechanically separate — different files, different functions, different fixes; closing one
does not touch the other.** #114 is a *design/trust-model* defect inside `precedence.ts`: the algorithm
conflates two orderings (declared precedence vs. administrative trust) that happen to coincide in every
test case but diverge in the one case that matters. #115 is a *text-parsing invariant* gap inside
`schema.ts`: two independent views of the same document (a hand-rolled raw-text tokenizer and `JSON.parse`)
are assumed to agree on "what are the top-level keys" and nothing ever asserts that they do. There is a
shared **meta-pattern** worth naming for the council, without conflating the two: both defects are cases
where an unstated structural equivalence between two representations of untrusted input was never asserted
as an invariant, and was false. That meta-pattern is useful for review discipline (e.g., "any new
raw-text/JSON-differential check gets an explicit round-trip-equality test") — it is not evidence that
fixing #114 fixes #115 or vice versa, and I want that stated plainly so the council doesn't merge them into
one ticket.

**Calibration.**
- **severity: MED.** `reach=operator` (same live-consumer proof as #114 — `printer.ts`/`policy:print` only,
  no `hooks/` or CI consumer), `likelihood=plausible` (a single escape sequence, no race), `evidence:
  code-traced` (`schema.ts:56-88`) + `demonstrated` (red-team's repro, code-trace-confirmed as consistent
  with the actual comparison logic).
- **Boundary-crossing carve-out: does NOT apply here** — unlike #114, nothing here bypasses or weakens a
  security boundary; the enforced ruleset stays correct, only its *explanation* is wrong. This is a
  legitimate MED that a Manager could route to either (a) a proof-test or (b) the residual register under
  the normal MED rules — my own read favors (a), for three reasons stated as facts, not a mechanism
  recommendation: it re-opens a defect (#105) already once closed and reviewed; the fix is narrow (assert
  tokenizer/parser agreement, or unescape before comparing) so the cost of writing the test now is low; and
  `printer.ts`/audit-trail output is one of this project's named sensitive areas (`CLAUDE.md`'s "Evidence /
  audit trail" list) — CLAUDE.md's own hard rule requires a fresh dated review for changes here, which a
  named proof-test satisfies more durably than a residual line does.
- **Exposure:** every rule in a layer whose top-level key list contains an escape sequence in a duplicated
  key (basis: counted-in-code, one raw-text comparison, `schema.ts:69`); real-world frequency of such
  files is unknown (basis: assumption — not priced into this finding). Irreversible: no. Silent: yes — the
  origin line looks authoritative and is wrong, in the one command whose job is "why was this blocked."

**Verdict: BREAKS, MED, code-traced, reach=operator.** Not gating by itself under this agent's HIGH bar
(same reach argument as #114); recommend closing before S6 ships since it sits inside a named sensitive
area, but I am not the one who rules on (a) vs (b) here — flagging my own preference, not prescribing it.

**Proof-tests required:** `schema.test.ts` -> "a top-level key written with a `\uXXXX` escape that
normalizes to a duplicate of another top-level key is rejected"; `loader.test.ts` -> "the tokenizer's
top-level key set equals `Object.keys(JSON.parse(text))`, or the layer is rejected" (the invariant, which
subsumes every shape of this defect, not just the one demonstrated).

---

## Frozen set (proven safe — do not re-litigate without new evidence)

All independently re-verified this pass (test re-run and/or code trace), matching round 2's SURVIVES list:

- **Issue #106 (reg.exe PATH hijack) — CLOSED.** Resolution happens at call time inside `read()` against
  an absolute, `SystemRoot`-rooted path; a planted `whoami.exe` at PATH position 0 is never reached.
- **Issue #108's stated defect (attribution + granularity) — CLOSED for the `project`->`central`/
  `shipped-defaults` direction and the message-naming half.** `voidedLayers` correctly names the offending
  layer; a project-layer collision voids only `project`. (Finding #114 above is the *other* direction —
  `shipped-defaults`->`central` — which the same mechanism handles identically, and identically wrongly,
  because the mechanism has no trust concept at all, only position.)
- **Issue #105 and its extension (duplicate rule id, duplicate literal `"rules"` key) — CLOSED for both
  named shapes.** Both rejected with a message naming the offending key/indices, before the tokenizer runs.
  (Finding #115 is a **third**, unrelated shape neither of the two closed cases covers.)
- **The pin's delivery mechanism (single-read invariant) — CLOSED.** `centralSource.read()` is called
  exactly once per `loadEffectivePolicy` invocation; the printed pin is `sha256` of that one read's bytes.
  (The pin's *scope* — hashing only `centralRaw`, never the two in-repo layers — is round 2's separate
  finding 3, out of this brief's assigned scope; carried below as a residual, not re-attacked.)
- **The reg.exe stderr leak (Issue #109) — CLOSED.** stdio is pinned at the type level
  (`SyncRegQueryRunner`'s `["ignore","pipe","pipe"]`), no caller can widen it.
- **The #107 absent-detection deviation — introduces no new fail-open**, and closes a round-1 UNPROVEN
  (timeout/ENOBUFS-with-stray-not-found-text now fails closed) as a bonus. Disclosed accurately in
  `docs/backlog.md:47` as partial (English-only pattern list).
- **`precedence.ts:156`'s lock check is general by construction** — keys off the rule's own `mandatory`
  field, never a layer name — so the Issues #65/#66/#99 "looks-general-but-isn't" bug shape does not recur
  here. Finding #114 is a defect in *which dimension* the check is general along (position, not trust),
  not a return of that specific prior bug shape.
- **The S6 tree is committed.** `git log -1` = `280f1c7`; `git status --short` shows only
  `docs/decisions.md` modified. Round 2's finding 5 (100% uncommitted) is CLOSED as of this HEAD.
- **`reviewRoundsSinceClean`/`roundsSinceLastGo` now read 2 in `docs/.maat-state.json`**, consistent with
  this council's own trigger condition (2 consecutive non-clean rounds). Round 2's finding 6 (counter
  read 0 against a ratified "set to 1") is reconciled as of this state file.

## Residual-risk register (carried from round 2, not re-attacked — status as of this HEAD)

| # | Finding | Status | Notes for the council |
|---|---|---|---|
| 3 | POL-09's pin hashes only `centralRaw`; two materially different resolved policies (one with a voided layer) share one digest | **Still open, MED** | Out of this brief's assigned scope (#114/#115 only) — named so it isn't lost. REQUIREMENTS.md:433 explicitly warns "do not close this requirement on the delivery half alone." No backlog line exists for it. |
| 4 | `docs/decisions.md`'s ratified triage row cites the wrong GitHub Issue numbers for 3 of 9 items | **Governance/audit-trail defect, not code** | Does not affect #114/#115's calibration; the correct Issue numbers were independently confirmed via `gh issue view 114`/`115` for this brief. |
| 7 | `printer.ts:61` hardcodes "central policy load failed" for all rejection kinds; a project-file schema rejection with central absent still misattributes the headline | **Still open, LOW** | The origin path inside the message is the only thing that saves a careful operator. No Issue filed per this project's LOW convention. |
| 8 | `isNotFoundError` matches not-found text as a substring anywhere in stderr | **UNPROVEN, LOW** | Unchanged, much less reachable now that #106 is closed. |
| 9 | `resolveSystemRegExePath` trusts `process.env.SystemRoot` at call time | **UNPROVEN, LOW** | Fails closed; reaching it needs in-process code execution, a strictly higher bar than the closed PATH vector. |

## Unrun verifications

- **The full real-registry round trip (provision -> read -> merge -> print) has never been run.** Carried
  from round 1 and round 2, honestly disclosed in `central-source.ts`'s header and `docs/backlog.md:43`.
  `reg add` is refused by the tool classifier in-session; the session token is UAC-filtered. **Owner:**
  one human, one elevated shell — write the `HKLM\SOFTWARE\Policies\Thoth\CentralPolicyJson` key with a
  minified JSON value (include non-ASCII rationale text to also exercise the encoding path), then
  `npm run policy:print`, raw output pasted into the next Stage-3 evidence. This is unrelated to #114/#115
  but is this artifact's own largest never-executed gating measurement, per this agent's standing
  instruction to name that ahead of any `derived` finding.
- **Whichever of the candidate paths below the Manager rules on, its own proof-tests (this brief's §1) have
  not been written yet** — that is the next concrete action, not another attack round.

## Editorial (verdict-neutral, carried from round 2, uncounted)

- `docs/backlog.md:45` cites "Issue #110" for `defaultOutcome`; the real Issue is #112.
- `docs/decisions.md`'s fix-now row cites "#112 (LOW)" for the stderr leak; no Issue was ever filed for it
  (correctly, per LOW convention) — the number should be dropped, not reassigned.

---

## The single scariest unproven assumption

Not a new one — round 2 named it precisely and it survives unchanged: **that "earlier in POL-08's
precedence order" means "more trusted."** It does not. `shipped-defaults` is first in precedence and lives
in the repo; `central` is second in precedence and lives behind an administrator ACL. The mechanism this
whole story exists to build — "a change under review cannot alter the policy that judges it"
(REQUIREMENTS.md:433) — currently has exactly one gap, and it is precisely a change under review altering
the policy that judges it, using a file it already owns. What is genuinely new in this brief, not just
restated: that gap has **zero live blast radius today**, measured, not assumed — and will have its first
live blast radius the moment a future story wires this loader into `hooks/`. That is the fact the
severity-calibration disagreement with red-team hinges on, and it is the fact that should set the urgency:
fix this **before** wiring, not after discovering it in production.

## Candidate paths for #114 (stated, not recommended — this agent names what's possible, the architect
rules on shape, per this council's own division of labor)

**Path A — "mandatory: true is expressible only by the central layer; a shipped-defaults or project rule
declaring it is a schema error."**
*What's proven about it:* this is the narrowest textual reading of REQUIREMENTS.md:431 — "**The central
policy source** shall be able to mark a rule mandatory" — which never grants that capability to the other
two tiers. It costs nothing against the current fixture: `src/policy/config/shipped-defaults.json` today
is `{"version": "0.0.0-s6-placeholder", "rules": []}` — zero rules, so zero legitimate `mandatory` usages
would be broken by forbidding it there. It also matches the predecessor system's own model as described in
REQUIREMENTS.md:183/206 (mandatory-lock as a delta on a *parent-wins* semantics, not a general
any-tier-may-lock-any-tier semantics). *What's unproven:* whether a future legitimate use case wants
`shipped-defaults` to lock something before central is provisioned (e.g., a safe-by-default floor on a
fresh install with no central channel configured yet) — nothing in the requirements or fixtures speaks to
that scenario either way.

**Path B — "a lock may only void a layer strictly less trusted than the locking layer," with trust
independent of declared precedence order.**
*What's proven about it:* it closes the attack in both directions (shipped-defaults cannot lock central;
project remains lockable by either). *What's unproven, and worth flagging for the architect specifically:*
this requires introducing a second ordering — trust rank, distinct from precedence rank — where today
exactly one ordering (the `layers` array's declared sequence) does double duty as both. Whether that is a
small delta or "new topology" in this codebase's terms is a judgment call I am not making here per this
agent's lane discipline; I am naming that the question exists.

**Path C — revert to round-1's whole-load-rejection semantics on any mandatory-lock collision, keep only
this round's attribution/messaging improvements.**
*What's proven about it:* this was the actually-shipped, actually-tested behavior before Issue #108's
round-1 fix, and it is fail-closed by construction — no collision, from any layer, in any direction, ever
produces a silent partial suppression. *What's unproven:* whether the DoS-shaped cost that made round-1
grade this a MED (an accidental id collision anywhere denies the entire load) is acceptable as a permanent
trade rather than the temporary one it was scoped as.

---

## Verdict

**go, with a mandatory residual — not a discharge to the residual register.** Under this agent's own
calibration, neither #114 nor #115 clears a valid HIGH (both fail the `reach=user` entry-point proof —
mechanically confirmed: zero `hooks/` consumers, `policy:print` absent even from CI). That is a narrower
read than red-team's own HIGH tag on #114, and the difference is fully explained above (different agents'
rulebooks, not a factual disagreement about the code). It does not change the outcome the council needs:
**#114's effect is a security boundary bypassed/weakened, which this agent's boundary-crossing carve-out
makes non-dischargeable regardless of severity cap — it must become a named failing proof-test, and it
must close before any future story gives this loader a live `hooks/` entry point (i.e., before S5's
`PreToolUse` reactivation).** #115 is a genuine, separate MED, not required to gate ship the same way, but
sits in a named sensitive area (audit/evidence output) and is cheap to close now.

**Recommendation to the Manager, in this agent's own vocabulary:** rule on Path A vs. B vs. C (or a fourth
the architect proposes) for #114, land its three named proof-tests plus #115's two, then continue — this is
a **mechanical fix guided by an already-converged design question**, not a reason for a third
`design-challenger` round. `docs/PRINCIPLES.md` rule 16's own default applies: "build now, open findings
become day-1 failing tests," and here that default is easy to take because the live blast radius is
genuinely zero today, measured, and the fix is narrow.

---

```
RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][code-traced/operator/plausible/runbook-reversible][0% live today, 100% of colliding loads once wired] Issue #114 - mergeLayersWithMandatoryLock (precedence.ts:150-165) uses POL-08 precedence order as trust order; a git-tracked shipped-defaults.json edit voids the entire central layer at exit 0 and unlocks project's relaxations too, pinned as correct by precedence.test.ts:219/:236. Capped below red-team's HIGH tag only by this agent's stricter reach=user proof requirement (zero hooks/ consumers, confirmed by grep; policy:print absent from CI) - but the boundary-crossing carve-out (security boundary weakened) forces routing to a mandatory named proof-test regardless of the cap, matching red-team's own "must fix" conclusion by a different, also-valid path.
2. [ISSUE][MED][code-traced/operator/plausible][every rule in a layer with an escaped duplicate top-level key, basis counted-in-code] Issue #115 - findDuplicateTopLevelKeys (schema.ts:56-88) compares raw escaped key text while JSON.parse compares unescaped values; a r-escaped duplicate "rules" key bypasses the check and reopens Issue #105's wrong-origin-line defect. Mechanically SEPARATE root cause from #114 (different file/function/fix; the enforced ruleset stays correct, only its printed attribution is wrong) - shares only a meta-pattern (an unstated equivalence between two views of untrusted input was never asserted as an invariant). Does not cross a security boundary itself, so no mandatory carve-out; recommend (a) proof-test over (b) residual given it reopens a previously-closed defect in a named sensitive area (audit/evidence output).
3. [CLEAN][demonstrated] Issue #106 (reg.exe PATH hijack) stays closed - resolution happens at call time against an absolute SystemRoot-rooted path.
4. [CLEAN][demonstrated] Issue #108's project-direction attribution/granularity fix stays closed - voidedLayers correctly names the offending layer for shipped-defaults<-project collisions.
5. [CLEAN][demonstrated] Issue #105 and its literal-duplicate-key extension stay closed for both named shapes.
6. [CLEAN][demonstrated] The pin's single-read delivery mechanism stays closed (its SCOPE, hashing only centralRaw, is round-2 finding 3, out of this brief's assigned attack surface, carried as a residual not re-attacked).
7. [CLEAN][demonstrated] The reg.exe stderr leak (Issue #109) stays closed; stdio pinned at the type level.
8. [CLEAN][code-traced] precedence.ts:156's lock check stays general-by-construction (keys off the rule's own mandatory field, never a layer name) - the Issues #65/#66/#99 bug shape does not recur; #114 is a defect in which dimension it's general along, not a return of that shape.
9. [CLEAN][demonstrated] The S6 tree is committed at 280f1c7 (round-2 finding 5 closed); docs/.maat-state.json's reviewRoundsSinceClean/roundsSinceLastGo now read 2, consistent with this council's own trigger (round-2 finding 6 reconciled).
counts (CHECKSUM): issues=2 suspicions=0 clean=7
evidence (CHECKSUM): demonstrated=5 code-traced=4 derived=0
round=3 (council Stop Brief, not a graded design-challenger round) roundsSinceLastGo=2 frozen=9 residuals=5 unrun=2 editorial=2
checks=47/47 (precedence.test.ts + schema.test.ts, independently re-run); grep-confirmed zero hooks/ consumers of loadEffectivePolicy; policy:print confirmed absent from ci.yml
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-design-challenger-council-stopbrief-2026-09-08.md
```
