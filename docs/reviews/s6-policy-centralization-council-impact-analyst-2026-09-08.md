# Impact Analyst (Wepwawet) — S6 policy centralization, council round (rule 16(c))

**Date:** 2026-09-08 · **Scope:** Issue #114 (HIGH, trust-model flaw) and Issue #115 (MED, parser
differential) from `docs/reviews/s6-policy-centralization-red-team-round2-2026-09-08.md`. Tree at
`280f1c7`. Files priced: `src/policy/rule/precedence.ts`, `src/policy/rule/schema.ts`,
`src/policy/config/{loader,printer,print-cli,central-source}.ts`, `src/policy/kernel/rule-types.ts`
and their `.test.ts` files.

**Visibility note:** running without the other two council seats' briefs for this round (not yet
persisted at the time this report was written) — I could not fold their candidate paths in. Pricing
below covers the two candidates the Manager's dispatch named (A, B) plus Issue #115, derived
independently.

**ADR cache:** not re-run this pass — reused the fingerprint (`83b2e3e`, 35 ADRs) already confirmed
`CACHE=HIT` by every sibling report this session; no new ADR text needed beyond what round-2's
red-team report already cites (SE ADR-0021, 0019, 0006, 0004, 0002/0003).

---

## What I actually ran (mechanical enumeration, not recall)

```
$ grep -rn "mandatory:\s*true" --include=*.ts,*.json (repo-wide, filtered to VALUE producers)
  -> docs/qa/s6-policy-loader-fixtures/printer-shipped-defaults.json (shipped-defaults layer)
  -> src/policy/config/loader.test.ts:270 (shipped-defaults layer)
  -> src/policy/config/loader.test.ts:203 (central layer)
  -> src/policy/rule/precedence.test.ts (9 mergeLayersWithMandatoryLock cases, layer varies per case)
  -> src/policy/config/printer.test.ts:285,317 (shipped-defaults layer, LOCKED fixture)

$ grep -n "^test(" src/policy/rule/precedence.test.ts   -> 21 tests total (7 mergeLayers, 5
  mergeToolClassificationLayers, 9 mergeLayersWithMandatoryLock)
$ grep -n "^test(" src/policy/config/printer.test.ts    -> 9 tests total

$ grep -rn "validateRuleSet\(" --include=*.ts           -> 1 production call site (loader.ts:95)
$ grep -rn "mergeLayersWithMandatoryLock" --include=*.ts -> 1 production call site (loader.ts:163)
$ grep -rln "LayerName|NamedRuleLayer" --include=*.ts    -> 4 files (precedence.ts def,
  loader.ts consumer, precedence.test.ts, tools/classification.ts — unrelated 2-tier function,
  no mandatory-lock call)
$ grep -rln "voidedLayers" --include=*.ts                -> 5 files (loader.ts/.test.ts,
  printer.ts, precedence.ts/.test.ts)
$ grep -rln "loadEffectivePolicy|printEffectivePolicy" --include=*.ts -> 5 files: loader.ts/.test.ts,
  printer.ts/.test.ts, print-cli.ts. Zero matches outside src/policy/config/** — confirms
  hooks/pretooluse-kernel-gate.mjs is NOT a consumer (it stays on its own separate
  loadBootstrapRuleSet() path per the 2026-09-08 Q3 ruling) — 0% live-enforcement exposure either
  way, matching red-team's own finding-1 exposure line.
```

---

## Candidate A — `mandatory` becomes a central-source-only declaration

*(any layer other than `central` declaring `mandatory: true` is a schema error — red-team's
"simpler shape POL-07's text implies")*

**Classification: SEAM, bordering SYSTEMIC.** It crosses the `loader.ts` → `schema.ts` contract
(validation needs to know which layer it's validating, a parameter that doesn't exist today) and it
changes an invariant a **locked, committed test-writer artifact** already encodes as intentional
behavior — not merely a convention, an answer key this project's own DoD forbids editing.

**Upstream — who produces a `mandatory: true` value today, mechanically enumerated (command above):**

| Producer | Layer | Editable? |
|---|---|---|
| `docs/qa/s6-policy-loader-fixtures/printer-shipped-defaults.json` | shipped-defaults | **NO — test-writer's own committed fixture, part of the locked `printer.test.ts` answer key** |
| `src/policy/config/loader.test.ts:270` | shipped-defaults | Yes — story-implementer's own unit test (plan v2 §7: "loader/lock/pin internals are story-implementer's own unit tests, out of test-writer's scope") |
| `src/policy/config/loader.test.ts:203` | central | Yes, and legal under A unchanged |
| `src/policy/rule/precedence.test.ts` (9 cases) | mixed — 7 declare mandatory only on `central`, legal under A; **2 declare it on `shipped-defaults`** (lines 219, 236 — the same two red-team already named) | Yes — story-implementer's own file |
| `src/policy/config/printer.test.ts:285,317` | shipped-defaults, via the locked fixture above | **NO — locked** |

**None of these five producers can satisfy Candidate A's new precondition today without either (a) an
editable-test rewrite (loader.test.ts, precedence.test.ts) or (b) reopening a locked test-writer
contract (printer.test.ts + its fixture).** (b) is the hidden second half of this fix: DoD text is
explicit — *"If `story-implementer` believes a test is wrong or impossible per spec, it flags that
back rather than silently editing the test file — the test is the answer key."* Candidate A cannot
land without that flag-back-and-reauthor cycle actually happening; it is not optional ceremony, it is
a precondition this candidate's producers cannot clear unilaterally.

**Downstream — who consumes `mergeLayersWithMandatoryLock`'s general-form guarantee:**
`loader.ts:163` (1 production call site) → `printer.ts` (renders `voidedLayers`) → `print-cli.ts`
(CLI entry). All three stay mechanically unchanged in *shape* under A (the `MandatoryLockResult`
type doesn't need new fields) — but the "general any-layer-locks-later-layers form" the 2026-09-08
plan-ratification row (Q2) explicitly ordered built, and the design-challenger-driven widening that
added the shipped-defaults→central regression test "now, not backlogged," both go **unused for 2 of
3 layers** the moment A ships: the code path that lets `shipped-defaults` declare `mandatory` becomes
dead by construction. That is a second-order cost separate from the test breakage — a general
mechanism this project explicitly paid to build and test becomes only partially exercised.

**Invariant delta.** Before: any layer may declare `mandatory: true`; POL-07's "downstream cannot
relax it" is layer-agnostic by design (precedence.ts's own comment names this deliberate, citing
Issues #65/#66/#99 as the reason a layer-identity check was avoided). After Candidate A: `mandatory`
is legal only on `central`. Who depended on the old truth: the two `precedence.test.ts` cases
(219/236), the **printer.test.ts locked answer key** (3 of 9 cases), and the human's own 2026-09-08
Q2 ruling text ("doesn't foreclose the general shape without inventing untested behavior") — Candidate
A doesn't merely narrow the tested surface, it forecloses the general shape outright, which is a
sharper reversal than the round-1 widening it undoes.

**Whack-a-mole verdict: CONTAINS, conditionally.** The defect class here — **"a general-looking
mechanism keyed on the wrong dimension (precedence position instead of trust), the same shape as
Issues #65/#66 (S2/S3), #99 (S5's env-var trust inversion), and now #114"** — is fixed cleanly by A
IF the schema-level rejection is paired with a structural test enumerating every layer, not a
one-off check for `central` alone (the same "structurally impossible to write wrong" bar
precedence.ts's own comment already sets for the mandatory-lock check itself). Without that
structural test, A is another instance of the same recurring shape it's trying to close: a check
that happens to be correct for the layers tested and silently wrong for a layer nobody wrote a test
against. **This defect class has now recurred at least 4 times in this project's history** (Issues
#65/#66, #99, #114) — see Structural Findings below.

**Ledger:**
```
Fix A: touches 9 files (schema.ts, schema.test.ts, loader.ts, loader.test.ts, precedence.ts
[doc/comment], precedence.test.ts [2 tests], printer.test.ts [3 LOCKED tests],
printer-shipped-defaults.json [LOCKED fixture], rule-types.ts [comment]) / 2 production call sites
(validateRuleSet, mergeLayersWithMandatoryLock) · new preconditions: 1 (mandatory legal only on
central) · migration: no · reversible: yes in code, NO in process — reopening a locked test-writer
answer key requires a flag-back/reauthor cycle, not a plain revert · exposure if wrong: 0% of live
enforcement (measured — zero consumers outside src/policy/config/**), ~24% of this story's own
directly-relevant test surface (5 of 21+9=30 precedence.test.ts+printer.test.ts cases, counted
above) · residual if NOT fixed: ~100% of loads where an earlier in-repo layer's mandatory id
collides with central's (red-team's own counted-in-code figure, unchanged by which candidate is
chosen).
```

**Verdict: PATCH-WITH-CONDITIONS.** Condition: land it only together with (1) the flag-back to
test-writer/Manager to legitimately re-author `printer.test.ts`'s 3 affected cases and its fixture
(not a silent implementer edit), and (2) a structural (not one-off) test proving `mandatory` is
schema-illegal on EVERY non-central layer, not just the two currently tested.

---

## Candidate B — a lock only voids a strictly-less-trusted layer (new trust-rank concept)

*(shipped-defaults/project rank below central for lock-voiding purposes; a lower-trust layer's
attempt to void a higher-trust layer's mandatory rule rejects the WHOLE load, fail-closed, rather
than silently voiding the higher-trust layer)*

**Classification: SEAM.** New concept (trust rank), but scoped entirely inside the
`precedence.ts` → `loader.ts` → `printer.ts` chain that already exists for this exact mechanism —
no new module, no new external dependency.

**Upstream — who produces a `mandatory: true` value (same enumeration as Candidate A, above):** all
five producers listed above satisfy Candidate B's new precondition **without any change**, because
B does not restrict *who may declare* `mandatory` — it only changes what happens when a collision's
voiding direction runs the wrong way. `printer.test.ts`'s locked fixture (`shipped-defaults`
declaring `mandatory: true` with **no id collision anywhere in that file's fixtures** — verified
directly: `printer-project.json` and the central-fixture raw text use different ids entirely) never
triggers the new trust-rank branch at all. This is the load-bearing difference from Candidate A:
**Candidate A breaks printer.test.ts by declaration alone; Candidate B only fires on an actual
collision, which printer.test.ts's fixtures never construct.**

**Downstream:** `loader.ts:163` (1 call site) gains a new outcome to handle — a lower-trust-locks-
higher-trust collision now needs a WHOLE-LOAD REJECT branch, which `MandatoryLockResult` doesn't
have today (only `{merged, voidedLayers}` — no reject/failure shape). `loader.ts` must map this into
`LoadFailureReasonKind` (a new member, e.g. `"mandatory-lock-trust-violation"`) and `printer.ts`
must attribute it correctly by layer name (folding naturally into finding 7's still-open LOW —
"never attribute a non-central rejection to central policy" — since this is precisely another
non-central-attributable rejection shape). This is genuine new seam surface Candidate A does not
need (A's rejection happens earlier, at schema-validation time, reusing the existing
`"schema-invalid"` bucket).

**Invariant delta.** Before: precedence order (shipped → central → project) doubles as trust order
for lock purposes — the exact conflation Issue #114 is about. After: a layer's position in
precedence and its trust rank for lock-voiding purposes are two different, independently-declared
facts. Who depended on the old (conflated) truth: the same two `precedence.test.ts` cases
(219, 236) red-team named — nothing else. **`printer.test.ts`'s locked answer key is unaffected.**

**Whack-a-mole verdict: CONTAINS, same condition as A.** Same defect class (#65/#66/#99/#114,
"positional/general-looking check silently wrong on an untested dimension") — B closes it for THIS
instance only if the trust-rank check is proven by an exhaustive layer-pair matrix (3 layers × 3
layers = 9 ordered pairs, most already trivial/no-op, but the 2 currently-collapsing ones — central
locked-by-shipped, central locked-by-project's not-yet-mandatory case — need explicit coverage), not
by the two hand-picked cases in the current diff. Without that, B is exposed to the identical
"looks general, isn't" recurrence as A.

**Ledger:**
```
Fix B: touches 4 files (precedence.ts [core logic + trust-rank constant + new reject-shape],
precedence.test.ts [2 tests, same 219/236 as A], loader.ts [new failure branch], printer.ts
[attribute the new rejection, likely bundled with finding 7's fix]) / 1 production call site
(mergeLayersWithMandatoryLock's return shape changes, its 1 caller must handle the new branch) ·
new preconditions: 1 (a trust-rank ordering exists among layers) · migration: no · reversible:
yes, cleanly — no locked-test conflict to unwind · exposure if wrong: 0% of live enforcement
(same measured fact as A), ~7% of this story's own test surface (2 of 30 cases — precedence.test.ts
only, printer.test.ts untouched) · residual if NOT fixed: same ~100% figure as A, unchanged by
which candidate is chosen.
```

**Verdict: SAFE-TO-PATCH.** Same condition on the structural matrix as A's PATCH-WITH-CONDITIONS,
but B clears it without touching a locked test-writer artifact, so the condition is cheaper to
satisfy (story-implementer's own file, no flag-back cycle) and the ledger's exposure is roughly a
third of A's.

---

## A vs. B: does either reverse the 2026-09-08 human ruling?

The ruling (`docs/decisions.md`, S6 Phase 1 plan ratification, Q2): *"build the general
any-layer-locks-later-layers form ... but S6's own tests exercise only the literal central→project
case"* — then widened by the pre-build design-challenger round to also require the
shipped-defaults→central regression test, "now, not backlogged."

- **Candidate A reverses BOTH rulings.** It doesn't just undo the widening (the shipped→central
  test) — it forecloses the general form itself: `mandatory` stops being a property any layer may
  declare, contradicting Q2's own text ("doesn't foreclose the general shape without inventing
  untested behavior"). The general mechanism was BUILT per that ruling; A makes 2 of its 3 layers
  structurally unable to ever exercise it.
- **Candidate B preserves both rulings' letter.** The general "any layer may declare mandatory"
  shape stays intact; only the VOIDING direction gains a trust check. The shipped→central test Q2's
  widening asked for still exists and still fires (it's precisely test 219, still relevant, just
  reasserting a different expected outcome) — B narrows what "locks" means, not who may lock.

This is a real, non-trivial cost differential for A that the round's dispatch brief should weigh
explicitly, not treat as a wash between "smallest change" (A) and "matches the general form" (B) —
mechanically, A is NOT the smaller change once the locked-test cost is counted.

---

## Issue #115 — parser/tokenizer differential (independent of A/B)

**Candidate:** assert a tokenizer/parser-agreement invariant in `schema.ts` (red-team's own second
proposed test: the raw-text top-level key set, unescaped, must equal `Object.keys(JSON.parse(text))`
or the layer is rejected) — replacing the current raw-escaped-text comparison in
`findDuplicateTopLevelKeys`.

**Classification: LOCAL.** `schema.ts`'s `validateRuleSet` already receives both the parsed object
(`input`) and the raw text (`rawText`) — the invariant check needs no new parameter, no new call
site, no seam crossing.

**Upstream:** 1 producer — `loader.ts:95`, the sole call site that ever passes `rawText`
(confirmed above: `validateRuleSet(` has exactly 1 production call site, plus 10 test-only calls in
`schema.test.ts` that omit `rawText` and are therefore unaffected). **Downstream:** 1 consumer —
`loader.ts` reading the returned `ValidationError[]`. No interaction with `precedence.ts`,
`central-source.ts`, or either candidate above — confirmed by the fact that `findDuplicateTopLevelKeys`
appears in exactly `schema.ts` (definition), `schema.ts` (self-call), and `schema.test.ts` (tests);
zero references in `precedence.ts`, `loader.ts`, or `printer.ts` beyond the error-array plumbing
already in place.

**Whack-a-mole verdict: CONTAINS.** This is genuinely a smaller, cleaner class than #114's: "a
raw-text scanner and `JSON.parse` disagree on what a key IS" is closed outright by asserting they
must agree, not by blocklisting one more escape shape (which is what the current, round-1 fix did,
and exactly why round 2 found a bypass in the first place — same recurring "blocklist an instance
instead of asserting the invariant" pattern, 2nd occurrence on this exact function within two
rounds).

**Ledger:**
```
Fix #115: touches 2 files (schema.ts, schema.test.ts) / 1 production call site · new
preconditions: 0 (tightens an existing check, adds no new caller obligation) · migration: no ·
reversible: yes, cleanly · exposure if wrong: 0% of live enforcement (same measured fact as A/B) ·
residual if NOT fixed: every rule in a layer whose top-level key list contains an escape sequence
(red-team's own counted-in-code figure) — narrow, but silent (wrong origin line, exit 0).
```

**Verdict: SAFE-TO-PATCH, same round as either A or B.** No shared file, no shared logic, no
ordering dependency — land it independently and in parallel with whichever of A/B is chosen.

---

## Effect on the still-open round-1 residuals

| Residual | Affected by A? | Affected by B? |
|---|---|---|
| **Issue #107** (locale gap, `central-source.ts`, narrowed not closed) | No — disjoint file/logic (central-source.ts's `isNotFoundError`, never touches precedence.ts) | No — same |
| **Issue #110** (pin hashes only `centralRaw`, scope too narrow) | **Marginally better** — the shipped-defaults→central collision shape that currently lets two materially different resolved policies share one pin digest can no longer reach an `ok:true` load at all (A rejects it at schema time, before any pin is ever computed) | **Marginally better**, same mechanism — B's whole-load reject for this specific collision also means no pin is computed for it. Neither A nor B touches `pin.ts` or closes #110's general gap (project/shipped bytes still never hashed for any OTHER divergence) — this is a narrowing of one reachable path, not a fix. |
| **Issue #111** (uncommitted-tree verifiability) | Resolved by the `280f1c7` commit already landed. Whichever candidate ships must be committed promptly on its own — `git status --short` at report time shows only `docs/decisions.md` modified, confirming the tree is currently clean of new S6 code; the NEXT fix-now round must not repeat the twice-recurring uncommitted-work pattern (round 1 and round 2 both drew this exact finding). | Same |
| **Issue #112** (`defaultOutcome` code literal, backlog-deferred) | No — disjoint file (`bootstrap-ruleset.ts`), unrelated to the `Rule.mandatory` field | No — same |

---

## Structural findings (defect classes fixed 2+ times, this scope)

1. **"General-looking mechanism, wrong dimension" — 4th occurrence.** Issues #65/#66 (S2/S3,
   `shell.ts`/`target-format.ts` typed fields trusted without validation), #99 (S5, an ambient env
   var trusted as a fixture-path override), and now #114 (S6, precedence order trusted as trust
   order) are the same shape: a mechanism written to look general, verified against the cases that
   were tested, silently wrong on a dimension nobody wrote a test for. **The absence of a mechanical
   guard is the finding, not any one instance.** Recommend an exhaustive, CI-gating conformance
   matrix for `mergeLayersWithMandatoryLock` — every `{locking layer, colluding layer}` ordered pair
   (9 cells for 3 layers) asserted against its expected outcome in one table-driven test, so a future
   4th layer or a future trust-rank change cannot silently leave a cell unverified. This applies to
   whichever candidate (A or B) is chosen — neither one's current diff includes this matrix yet.
2. **"Blocklist an instance instead of asserting the invariant" — 2nd occurrence on the same
   function within 2 rounds.** Round 1's `findDuplicateTopLevelKeys` fix closed two named shapes
   (duplicate id, duplicate literal key); round 2 found the escaped-key bypass because the fix
   blocklisted shapes instead of asserting tokenizer/parser agreement. Issue #115's own proposed fix
   (the invariant, not another blocklist entry) is the correct level per PRINCIPLES rule 5's "the
   minimal change that resolves it" — but "minimal" here means the invariant, not a third blocklist
   entry for the next unicode escape shape nobody has thought of yet.
3. **"S6 tree left uncommitted across a review round" — 2nd occurrence** (round 1 finding 7, round 2
   finding 5). Both times, the fix committed at the very end closed it retroactively. Recommend
   committing at the top of the NEXT fix-now round, not the end, so a 3rd occurrence needs a
   deliberate choice to happen rather than the default.

## Unmeasured

- **Frequency of escape-sequence-bearing top-level keys in real policy authoring** (Issue #115's own
  exposure line, `basis: assumption` per red-team) — `unmeasured`; the command that would source it
  doesn't exist yet (no corpus of real central/project policy files to sample — none has been
  authored, per the 2026-09-08 intake ruling that content-authoring is explicitly out of S6's scope).
- **Whether the other two council seats (design-challenger, architecture-reviewer) named a third
  candidate path** — not visible to this report; if one exists, it needs its own upstream/downstream
  pass before the Manager rules.

## Recommended path

**Candidate B**, on cost: it closes Issue #114 for the same ~100% residual reduction as A, at
roughly a third of A's test-surface exposure (2 tests vs. 5), touches no locked test-writer artifact
(zero flag-back ceremony), and preserves both halves of the 2026-09-08 human ruling (general form +
the shipped→central widening) rather than reversing them. **Strongest argument against this
recommendation:** B is a genuinely new concept (trust rank, independent of precedence order) that
has never existed in this codebase before — it is more code and more design surface than A's
one-line-per-red-team's-own-phrasing schema restriction, and a new concept is exactly the kind of
thing this project's rule 15 says warrants an architecture pass before it's built, not just an
impact price. That call belongs to `architecture-reviewer`'s seat, not mine.

## The single change most likely to be regretted in a month

Landing either A or B's two `precedence.test.ts` fixes (219/236) as hand-picked cases without the
structural 9-cell layer-pair matrix named above. Both candidates fix the two tested cells; neither,
as currently scoped, proves the other seven. That gap is exactly how #114 itself was born — round
1's fix passed every test written against it and was wrong on the one untested dimension.

---

```
RECEIPT: verdict=SAFE-TO-PATCH
candidates (ALL of them, ranked by risk):
1. [SUSPICION][MED][code-traced][~24% of this story's own test surface] Candidate A ("mandatory" central-source-only): RELOCATES — closes Issue #114 but reverses both halves of the 2026-09-08 human ruling (general form + its shipped->central widening), breaks 3 LOCKED printer.test.ts cases via its committed fixture (no collision needed, declaration alone trips it) plus the same 2 precedence.test.ts cases B also needs, and requires a test-writer flag-back/reauthor cycle DoD forbids the implementer from doing unilaterally. CONTAINS only if paired with a 9-cell structural matrix, not the 2 hand-picked cases in the candidate as named.
2. [CLEAN][code-traced][~7% of this story's own test surface] Candidate B (trust-rank, void only a less-trusted layer, reject-whole-load on a higher-trust collision): CONTAINS Issue #114's instance at roughly a third of Candidate A's test-surface cost, touches zero locked test-writer artifacts, preserves both halves of the 2026-09-08 ruling. Needs the same 9-cell structural matrix as A to fully CONTAIN the recurring defect class; as scoped (2 hand-picked tests) it is RELOCATES, not yet CONTAINS.
3. [CLEAN][code-traced][0% live, narrow-instance] Issue #115 fix (tokenizer/parser-agreement invariant in schema.ts): CONTAINS — independent of A/B, 2 files, 1 production call site, no shared logic with precedence.ts. Safe same-round with either A or B.
counts (CHECKSUM): issues=0 suspicions=2 clean=1
evidence (CHECKSUM): demonstrated=0 code-traced=3 derived=0
traced: upstream=5 producers (mandatory:true value sites) + 1 producer (rawText for #115) downstream=4 consumers (loader.ts, printer.ts, print-cli.ts, precedence.test.ts) + 1 consumer (#115) structural=3 classes fixed 2+ times (general-looking-wrong-dimension x4 occurrences, blocklist-not-invariant x2, uncommitted-tree x2)
recommended=B unmeasured=2
checks=n/a (impact-analyst is read-only; all counts above are mechanical greps/reads, commands pasted in "What I actually ran")
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-council-impact-analyst-2026-09-08.md
```
