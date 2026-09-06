# S4 — Shell-command semantic detector: impact-analyst (design council seat)

**Trigger:** PRINCIPLES.md rule 16(c) — two consecutive REWORK/BLOCKED-class verdicts on the same
review target (S4's post-build review loop) without an intervening clean/conditional-clean verdict.
Round 1 (2026-09-02): red-team `no-go`, app-security `REWORK`, cross-domain `REWORK`, architecture
`APPROVE-WITH-CONDITIONS` — not clean overall. Round 2 re-confirm (2026-09-03): red-team `no-go` (one
new HIGH), cross-domain `no-go`/`REWORK` (one new HIGH), app-security `APPROVE`, architecture
`APPROVE`. Confirmed via `docs/run-log.jsonl`'s own logged line:
`{"event":"stage","scope":"s4","stage":"review-round-2","outcome":"no-go-repeat"}`.

**Role:** price candidate paths forward for the two round-2 findings. I do not judge whether the
design should exist (architecture-reviewer's seat, already APPROVE this round) and I do not attack
new surface (design-challenger's seat). I trace upstream/downstream, classify blast radius, and price.

**Read:** `docs/STATE.md`, `docs/PRINCIPLES.md`, `docs/decisions.md` (all S4 rows), ADR-0021
(`adr/software-engineering/0021-thoth-native-architecture.md`), all 9 S4 review reports
(design-challenger, red-team ×2, app-security ×2, cross-domain ×2, architecture ×2), live code:
`src/policy/normalizer/shell.ts`, `src/policy/kernel/kernel.ts`, `src/policy/normalizer/
structured-cluster.ts`, `src/policy/kernel/rule-types.ts`, `src/policy/kernel/kernel.test.ts`,
`src/policy/normalizer/registry.test.ts`, `docs/backlog.md`, `docs/run-log.jsonl`.

**The two findings under discussion:**
- **#80 (HIGH)** — `shell.ts:146-149` (`scanFlags`'s redirect-operator exclusion): keyed on token
  *value* (`tokens[i] === ">"`) after quoting has already been stripped, so a **quoted literal**
  `">"` argument silently removes the *following* resource token from `positional` — the same harm
  as the original Issue #73, reached through the door #73's own fix opened.
- **#82 (HIGH)** — `kernel.ts`'s `matchesTarget` (`action.targets.some(...)`, unchanged since S2):
  OR-across-targets composes unsafely with S4's new ability to put more than one target in one
  `ActionRecord` — a narrowly-scoped ALLOW rule authorizes a whole compound call, including an
  unrelated, unauthorized resource bundled into it.

(#81, the `2>&1`/`&>` fd-dup MED finding, is precision-only — fails closed, not gating, not priced
here as one of the "two new HIGH bugs" the council seat was convened for; noted where relevant.)

---

## Independent verification before pricing anything

Per this role's evidence policy (never trust a hand-typed inventory), I re-ran the enumerations myself
rather than citing the reports' own counts.

```
$ grep -rn "matchesTarget|matchRules|decide\(|isMutating|pol05Rule" src --include="*.ts"
```
Non-test production references: `kernel.ts` only (definitions + `decide()`'s own internal call to
`matchRules`). Test references: `kernel.test.ts` (11 `decide(...)` calls, 6 direct `matchRules(...)`
calls), `registry.test.ts` (14 `decide(...)` calls). `matchesTarget` itself has **zero** direct
callers anywhere outside `matchRules` — confirmed, not assumed.

```
$ grep -n "targets:" src/policy/fixtures/rules.ts        # all 4 rule fixtures single-pattern
$ sed -n '19,42p' src/policy/normalizer/structured-cluster.ts
```
`structured-cluster.ts` — the only other registered normalizer — always builds `targets` as a
**0-or-1-element** array (`if (target) targets.push(target)`, no loop, no second producer). **S4's
`shell.ts` is the only producer of multi-target `ActionRecord`s anywhere in this codebase today.**

```
$ find . -type d -iname "hooks" -not -path "*/node_modules/*" -not -path "*/.git/*"
(no output)
$ grep -rn "normalizeShellCall|decide(" --include="*.ts" src | grep -v "\.test\.ts" | grep -v "shell.ts:" | grep -v "kernel.ts:"
(only comment references — zero real callers)
```
Confirms, independently, every report's own "reach=instrument today" claim: no `hooks/` directory
exists, no non-test code calls either function.

**New evidence this pass produced — a third, worse instance of #82's defect class, not yet reported
by anyone:**

```js
// file:///C:/playground/thoth/src/policy/normalizer/shell.ts + kernel.ts, run directly
rules: [{ id:"allow-pod-delete", effect:"allow", verbs:["delete"],
          targets:["prod-env/cluster/prod-cluster/pods/"], environments:["prod-env"] }]
call: "kubectl delete pods/api --context=prod-cluster > /etc/cron.d/pwn"

record: {"verbs":["delete","write"],
         "targets":["prod-env/cluster/prod-cluster/pods/api","/etc/cron.d/pwn"],
         "unresolved":[]}
verdict: {"outcome":"allow","reason":"allowed by rule allow-pod-delete", ...}
```
A rule scoped to `delete` on `pods/` alone authorizes an **arbitrary file write** bundled onto the
delete via a plain, unquoted redirect — no quoting trick needed at all. This uses the pre-existing
"additive kubectl-plus-redirect branch" (present since round 1, confirmed clean by red-team's original
report finding 11) composed with #74's fix (collect every redirect target, not just the first) and
#73's fix (collect every resource token). It is **not** caught by "deny when more than one
resource-shaped token exists" (there is exactly one resource token here — `pods/api`); the second
target arrives via the *redirect* branch, a structurally different code path. This matters directly
for pricing Path B below.

---

## Path A — targeted fix-now round 3

**Fix #80 (normalizer):** re-key `scanFlags`'s redirect exclusion on *position* (the offsets
`extractRedirectTargets` already computes over `liveText`) instead of token value.

**Fix #82 — two named sub-options, priced separately:**

### A1 — kernel-side: `matchesTarget`/`decide()`'s ALLOW path requires full target coverage

**Classification:** seam→systemic. It changes an invariant (`decide()`'s ALLOW matching semantics)
that every rule author and every current/future normalizer implicitly relies on — not "one line,"
per this role's own calibration rule, because the line is an invariant.

**Upstream — who feeds `matchesTarget` a multi-target record?** Mechanically enumerated above:
`shell.ts` alone, today. `structured-cluster.ts` never does. No hidden second producer exists.

**Downstream — who consumes `decide()`'s/`matchesTarget`'s behavior?** Mechanically enumerated above:
`kernel.test.ts` (11 `decide` + 6 `matchRules` calls, **all against single-target fixtures** — checked
every fixture in `src/policy/fixtures/action-records.ts`/inline test literals, none has `targets.length
> 1`) and `registry.test.ts` (14 `decide` calls; exactly **one**, `shellMultiResourceCall` at line 210,
is multi-target, and its own assertion is `assert.ok(verdict, ...)` — truthy-only, no outcome pinned).
For any single-target action, "every element covered by some rule" is logically identical to "some
element covered by some rule" — the existing 24 single-target call sites are **mathematically
invariant** under this fix; zero behavioral change is possible for them. **This is not a hand-wave: it
follows from the fix changing `.some()` to `.every()` only over an array whose length is provably 1 in
every existing fixture.**

**Does it reopen anything S2/S3 shipped and closed?** No. S2's Issue #61/#62 (source enum, POL-05
gating) and S3's Issue #65/#66 (resource-segment count, delimiter contamination) are untouched by this
function; none of their regression tests exercise `matchesTarget` with `targets.length > 1`.

**Does it close my own new compound-redirect finding?** Yes — traced by hand and confirms by the logic
above: the redirect target in my demonstration is not covered by `allow-pod-delete`'s pattern, so
full-coverage denies the rule match regardless of which code path added the second target. **A1 is a
single choke point that closes the class, not just the reported instance** — it doesn't matter how a
future normalizer, or a future `shell.ts` change, produces a second target; the invariant holds at the
one place all targets are ever evaluated.

**Invariant delta:** before, an ALLOW rule matched if *any* target satisfied it; after, an ALLOW rule
matches only if *every* target does. DENY stays `.some()` (fail-closed direction, unaffected — a
narrower change than "rewrite matching"). Who depended on the old behavior: nobody currently, since
nobody has ever exercised a multi-target ALLOW decision in a shipped test or real call (confirmed
above) — the "old behavior" was an unexercised default, not a used contract.

**Whack-a-mole verdict: CONTAINS.** Defect class: "a facet-matching function written for a single-value
field silently keeps OR semantics after the field becomes multi-valued." Prior-fix count in this class,
checked against `docs/backlog.md` and `docs/decisions.md`: **zero** — this is the first time this class
has been named in this scope. A1 removes it with a structural, not enumerative, guard: no future
producer of multi-target records can reintroduce the bypass without deliberately weakening
`matchesTarget` itself, which is one function, not N call sites to remember.

**Ledger:**
```
Fix A1: touches 1 file (kernel.ts, matchesTarget's caller in decide()) / 1 call site changed
· new preconditions: 0 (corrective — narrows an existing invariant to what rule authors already assume)
· migration: no · reversible: yes
· exposure if wrong ~0% of runs today (basis: measured — no hooks/ dir, zero real callers, confirmed above)
  → ~100% of multi-target shell calls the instant S5 wires the hook (S5 is the next story on the
    critical path per docs/STATE.md's own "Next" list — not speculative)
· residual if NOT fixed ~0% today / same ~100%-on-S5-wiring ceiling, but WIDENS-class (see Path C)
```

### A2 — normalizer-side: deny any multi-resource shell call outright via `unresolved`

Priced together with Path B below — they are the same mechanism scoped to the same file. See Path B's
pricing; A2 and Path B differ only in how completely the denial guard is scoped (a distinction that
turns out to matter, per the compound-redirect finding above).

**Fixing #80 alone — cost:** touches `scanFlags` (1 function, `shell.ts`), reuses an offset
computation the file already performs (`extractRedirectTargets`), removes rather than adds a
precondition, is reversible, and has no interaction with `kernel.ts` at all. No open question here —
every reviewer's report already agrees this is a contained, mechanical fix. Named test:
`Issue #73 follow-on: a quoted literal '>' argument never removes a resource-shaped token from the
record` (already named by red-team's round-2 report).

**Verdict, Path A overall (A1 + #80 position-fix): SAFE-TO-PATCH.**

---

## Path B — structural: normalizer denies any multi-resource shell call, `kernel.ts` untouched

**Classification, as literally scoped in the brief ("more than one resource token"):** local — appears
contained to `shell.ts`. **This classification does not survive contact with the code**, per the
finding below.

**Upstream:** same single producer as Path A (`shell.ts`) — no change.

**Downstream — does this close #82's shared root cause?** The brief frames Path B as closing "both
findings' shared root cause (the multi-target `ActionRecord` shape itself never needs to exist for
shell calls)." **Traced against the actual code, this claim is only true for the resource-collection
path, not the compound resource+redirect path.** `resolveKubectlShape`'s `targets` array is built additively:
```
src/policy/normalizer/shell.ts:327-336
const targets: string[] = !resourceMalformed && resources.length > 0 && cluster
    ? buildResourceTargets(resources, ...)
    : [];
const verbs = resolvedVerb ? [resolvedVerb] : [];
if (redirectTargets.length > 0) {
  verbs.push("write");
  targets.push(...redirectTargets);   // <-- a SECOND producer of extra targets, orthogonal to resource count
}
```
A guard written as "deny if `resourceTokens.length > 1`" (the brief's own literal framing) evaluates
`resourceTokens` — which only counts resource-*shaped* positional tokens — and is silent about the
redirect-additive branch entirely. My demonstrated compound case (`kubectl delete pods/api --context=
prod > /etc/cron.d/pwn`) has exactly **one** resource token and **one** redirect target: `resourceTokens.
length === 1`, so a narrowly-scoped Path B guard does not fire, and the record still gets `targets:
[pod, redirect]` with the same ALLOW-bypass I demonstrated above. **Path B, as scoped in the brief,
RELOCATES the defect class rather than closing it** — it closes the resource-arity instance
(#73/#82's originally-reported shape) and leaves the resource+redirect instance (a shape nobody has
yet filed as its own Issue) fully live.

**To actually close the class at the normalizer layer**, the guard has to be moved to the one place
`ActionRecord.targets` is finally assembled (the `return` at `shell.ts:338-346`) and phrased as "deny
via `unresolved` if the record this call is about to build would carry more than one target, from
*any* combination of resources and redirects" — not "count resource tokens." That is a materially
different, and larger, change than the brief's own framing: it has to reason about the two collection
paths jointly, not guard one of them.

**Does denying multi-resource wholesale satisfy Issue #73's own acceptance bar?** Yes, unambiguously —
red-team's own round-1 named test for Finding 4 is *"a multi-resource kubectl invocation reports every
resource in targets, **or reports unresolved**"* (`docs/reviews/…red-team-2026-09-02.md`, Finding 4).
The `unresolved` branch was explicitly pre-sanctioned; Path B does not reopen #73, it exercises the
branch #73's own fix never took. Also consistent with the *already-ratified* S4 design philosophy: the
2026-09-02 S4-intake ruling chose exactly this pattern for chained commands ("reports the call via
`unresolved` ... rather than attempting to split and independently evaluate each sub-command") — Path
B, correctly scoped, is more consistent with S4's own established idiom than #73's collect-and-report
fix was.

**Invariant delta:** a shell-sourced `ActionRecord` never carries more than one target — this is a
*narrower* guarantee than today's, not a new precondition on any caller; it trades recall for safety.
Benign multi-resource calls (two pods, same rule, same verb) that clean-resolved after #73's fix would
now deny outright — a real usability cost, but the exact same shape of tradeoff the project already
ratified for blanket chain-operator denial (`docs/backlog.md` line 6, design-challenger round-1,
"accepted, ratified tradeoff... not a defect").

**Whack-a-mole verdict, Path B as literally scoped: RELOCATES.** Defect class: same as A1's
("OR-composed matching over a field that stopped being single-valued") — Path B removes the shape's
*producer* for the reported instance but not for the sibling instance I demonstrated, and it leaves
`kernel.ts`'s `matchesTarget` itself unguarded, latent, for the next normalizer that ever produces a
multi-target record (which S4's own header comment establishes as a real future: this is the first
recursive/compound-producing normalizer in the codebase, and won't be the last). **Verdict, Path B
broadened to guard both collection paths jointly: CONTAINS-for-shell-calls-only** — still narrower than
A1, because it protects nothing for a *different future normalizer* that produces multi-target records;
A1's guard is structural regardless of producer, Path B's is per-normalizer and must be re-applied by
whoever writes the next one.

**Ledger:**
```
Fix B (correctly broadened, guarding both collection paths): touches 1 file (shell.ts) / 1 return
  site restructured · new preconditions: 0 (a normalizer-internal restriction)
· migration: no · reversible: yes
· exposure if wrong (i.e. if scoped narrowly, per the brief's own literal framing) ~0% today, same
  ~100%-on-S5-wiring ceiling as A1, because the compound-redirect instance is un-remediated
· residual if NOT fixed: same as A1's
```

**Verdict, Path B: PATCH-WITH-CONDITIONS** — the condition being: scope the denial to the point of
record assembly (both `resources` and `redirectTargets` jointly), not to `resourceTokens.length` alone,
or it silently ships with the compound bypass still live. As literally worded in the brief, it is
**not** SAFE-TO-PATCH.

---

## Path C — ship with #80/#82 open as day-1 failing tests, deferred

**What's actually exposed today:** independently confirmed above — `~0%` of anything, measured, no
`hooks/` directory, zero non-test callers of either function. This part of the brief's framing is
correct and I am not disputing the measurement.

**Is that the end of the analysis? No — this project's own precedent forecloses the deferral, not just
advises against it.** Three independent lines of evidence:

1. **Rule 21's own exemption is explicit and both findings are squarely inside it.** "Security,
   data-integrity, legal, and safety findings are exempt from this cap regardless of stated exposure."
   #80 is a demonstrated policy-visibility bypass (a resource silently vanishes from the record); #82
   is a demonstrated authorization bypass (an ALLOW rule's own stated `reason` is false — it claims to
   authorize a resource it was never scoped to). Both are security-class by any reading, not
   correctness-class.

2. **This exact reach-today/reach-on-S5-wiring argument was already litigated in round 1, on this same
   story, for the same-shaped findings, and lost.** App-security's original Finding 1 (Issue #68,
   round-1 report) used identical language — "reach=instrument today ... becomes ~100% ... the moment
   S5 wires the hook" — and still verdicted REWORK, not deferred-with-day-1-tests. Red-team's round-1
   report made the same reach argument for all four of its HIGH findings and still verdicted `no-go`.
   Treating round 2's #80/#82 differently from round 1's #68/#70-74 with the identical reach shape,
   inside the identical CRITICAL-tier story, has no principled basis in this project's own history —
   it would be the first departure from a pattern this project itself set twice already.

3. **App-security's own round-2 report says the quiet part explicitly:** "S5 will not re-review S4's
   detection logic, only its wiring." A day-1 failing test is a promise that someone looks at it before
   it matters — but the very next story in this component's own critical path is scoped, by this
   project's own convention, not to look. That is not a residual register entry with a known owner; it
   is a defect that ships silently into the one place nobody will be checking for it. **This is exactly
   the silence-above-everything condition this role's rules name as a trust wound**, not an ordinary
   deferral.

**Whack-a-mole verdict: WIDENS.** Path C does not touch the defect class at all — it creates new
surface only in the sense that it changes *when* the class gets caught (never, unless someone
specifically re-audits `shell.ts`'s detection logic during or after S5, which no ratified plan commits
to) rather than *whether*. Combined with the fact that rule 16(c) has already, mechanically, tripped —
this is not a fresh judgment call the council is making from scratch; the process's own hard-stop
already fired on this exact "keep deferring the same shape" pattern.

**Ledger:**
```
Fix C: touches 0 files / 0 call sites · new preconditions: 0
· migration: no · reversible: n/a (it is inaction)
· exposure if wrong ~0% of runs today, basis: measured (confirmed above)
  → ~100% of matching shell calls the instant S5 wires the hook, basis: counted-in-code
    (S5 is the immediate next story, docs/STATE.md's own "Next" list — not an assumption)
· residual if NOT fixed: identical to "exposure if wrong" above — Path C's cost and its residual
  are the SAME number, because Path C's entire content is "accept the residual." That collapse is
  itself the finding: there is no smaller number to weigh against fixing it now.
```

**Verdict, Path C: REDESIGN-REQUIRED is too strong a label (no design question is open — architecture
already APPROVEd) — the correct label under this role's own scale is that Path C is not
SAFE-TO-PATCH and not PATCH-WITH-CONDITIONS; it is WIDENS on the class, categorically, given the
security exemption and this project's own precedent. Not a legitimate council output for a CRITICAL,
"historically highest-incident component" review gate.**

---

## Structural findings

**1. `matchesVerb` (`kernel.ts:115-119`) carries the identical OR-across-facet shape as
`matchesTarget`, unaudited, currently unexercised only by an implementation coincidence.** Every
current path in `shell.ts` that adds a second verb (the redirect-additive branch: `verbs.push("write")`)
always adds an uncovered target in the same step — so A1's target-side fix happens to also close every
verb-arity variant I could construct, *today*. That is a property of `shell.ts`'s current wiring, not
a guarantee `kernel.ts` itself enforces. A future normalizer (or a future edit to `shell.ts`) that adds
a second verb without a correspondingly-uncovered target would defeat a verb-scoped ALLOW rule the same
way #82 defeated a target-scoped one, and nothing today would catch it. **Recommend:** whoever lands
A1 also adds a named regression test pinning the invariant "a multi-verb record with only some verbs
covered by an allow rule's `verbs` list does not allow" — same choke point, cheap, same session. This
is a first-time-named class (checked `docs/backlog.md`/`docs/decisions.md`: zero prior mentions), not
yet a 2+-recurrence structural finding, but it is the same shape one join over from #82 and is exactly
what this role exists to name before it becomes its own future round-3 finding.

**2. The "zero diff to kernel.ts" story-level invariant, repeated in four separate S4 review reports
as a load-bearing verified property, is not itself wrong to reopen — but reopening it needs to be a
Manager-ruled decision, not a drive-by edit.** Every report that cited zero-diff-to-kernel treated it
as evidence the story stayed in scope (ADR-0006's no-opportunistic-scope-widening). A1 crosses that
line deliberately, for a real reason, traced above — but `docs/decisions.md` should carry a new row
recording that the invariant was knowingly retired for this specific, narrow reason, the same way the
2026-09-02 "process gate miss" row disclosed a different scope deviation rather than silently crossing
it.

## Unmeasured

- Real-world frequency of legitimate multi-resource kubectl invocations in this org's governed
  traffic (shapes Path B's usability-cost estimate) — `unmeasured`, no traffic exists yet (pre-S5);
  command: none available until S5 ships and real calls are logged.
- Real-world frequency of a legitimate quoted `">"` literal argument to a governed tool (shapes #80's
  false-positive risk under either fix) — `unmeasured`, same reason.
- Whether any *other* planned normalizer (beyond S4's shell detector) is expected to produce
  multi-target records — `unmeasured` from this pass; would need `REQUIREMENTS.md`'s remaining SUR/POL
  items cross-checked against milestone descriptions the way the 2026-09-02 S4-intake ruling did for
  SUR-09; command: `gh api repos/{owner}/{repo}/milestones` read against each open milestone's own text.

## Recommended path

**A1 (kernel-side full-target-coverage fix) + the position-based fix for #80**, both in one round-3
fix-now pass. Reason, in one sentence: it is the only priced option that closes the defect class with
a single, structural choke point rather than an enumerable, per-normalizer guard — confirmed by the
fact it also closes my own newly-demonstrated compound-redirect instance that Path B (as scoped in the
brief) does not.

**Strongest argument against my own recommendation:** A1 touches `kernel.ts`, which this story's own
build and all four round-1/round-2 reports treated as an inviolate, independently-verified zero-diff
boundary — reopening it, even for one line, costs something this project has explicitly valued (a
verifiable "this story didn't widen its own footprint" claim) and sets a precedent that a normalizer
bug can be "fixed" by editing the kernel, which is exactly the kind of scope-creep ADR-0006 exists to
prevent in the general case. The counter is narrow and specific to this instance (a mathematically
provable no-op over every existing single-target fixture, and a structural closure of a real class),
not a general license — but it is a real cost, and the Manager should log it as a deliberate, disclosed
exception the same way the 2026-09-02 process-gate-miss row did, not wave it through silently.

## Single change most likely to be regretted in a month

**Choosing Path B exactly as worded in the brief** (guard `resourceTokens.length`, leave `kernel.ts`
untouched) **without also guarding the redirect-additive path.** It reads as the "safer," lower-blast-
radius option — no `kernel.ts` diff, contained to one file, satisfies #73's named test literally — and
every one of those properties is true. But it ships believing the class is closed when a materially
worse, unquoted, no-trickery-required instance (my compound-redirect demonstration) is still live, and
nobody currently has a filed Issue for it. A month from now, when S5 wires the hook and someone runs
exactly the ordinary command `kubectl delete pods/api --context=prod > /some/path`, this reads as the
same kind of "the fix looked complete because the named test passed" gap that produced #80 and #82 in
the first place — one more turn of the same wheel this council seat exists to stop.

---

RECEIPT: verdict=PATCH-WITH-CONDITIONS
candidates (ALL of them, one terse line each, ranked by risk):
1. [SUSPICION][MED][code-traced][~0% today, basis: measured] Path B as literally scoped in the brief (deny if `resourceTokens.length>1`) — closes #73/#82's originally-reported resource-arity instance but, demonstrated, does not close the resource+redirect compound instance (`kubectl delete pods/api --context=prod > /etc/cron.d/pwn`, one resource token + one redirect target, same ALLOW-bypass); RELOCATES unless broadened to guard both collection paths jointly at the record-assembly site.
2. [ISSUE][HIGH][demonstrated][~0% today → ~100% on S5 hook-wiring, basis: counted-in-code] Path C (ship #80/#82 open, day-1 failing tests, deferred) — both findings are security-class and exempt from rule 21's exposure cap; identical reach=instrument reasoning already lost this exact argument twice in round 1 on the same story; app-security's own round-2 report states S5 will not re-review this detection logic. WIDENS: the class isn't touched, only the timing of when it's caught, and nothing commits to catching it later.
3. [CLEAN][demonstrated,code-traced][~0% today → ~100% on S5 hook-wiring] Path A (A1 kernel-side full-target-coverage fix in matchesTarget/decide + position-based fix for #80) — CONTAINS: single choke point, mathematically invariant over all 24 existing single-target decide()/matchRules() test call sites (independently enumerated), closes both reported findings AND the newly-demonstrated compound-redirect instance, touches matchesTarget's only call path (matchRules→decide, no other production callers exist).
counts (a CHECKSUM — MUST equal the lines listed above; never truncated): issues=1 suspicions=1 clean=1
evidence (a CHECKSUM over the tags above — MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=2 derived=0
traced: upstream=1 producer (shell.ts is the sole multi-target-record producer in the codebase, structured-cluster.ts confirmed single-target) downstream=25 consumers (11 kernel.test.ts decide() + 6 kernel.test.ts matchRules() + 14 registry.test.ts decide(), all mechanically counted; matchesTarget has zero direct callers outside matchRules) structural=1 class (OR-across-facet matching; matchesVerb named as the same shape, first-time-named, not yet a 2+ recurrence)
recommended=A1(kernel-side)+position-fix(#80) unmeasured=3
checks=n/a (impact-analysis pass; no test suite executed by this role — grep/node verification commands pasted above are the executed evidence)
adr=HIT(1 applicable: ADR-0021, cache fingerprint unchanged at 83b2e3e per every S4 report this round)
report=docs/reviews/s4-shell-semantic-detector-impact-analyst-2026-09-03.md
