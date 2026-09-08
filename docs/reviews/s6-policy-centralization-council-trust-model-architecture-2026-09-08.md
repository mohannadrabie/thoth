# Architecture Reviewer (Imhotep) — S6 council seat: POL-07's trust-model ruling

**Scope:** the BUILT diff at `280f1c7` — `src/policy/rule/precedence.ts`'s `mergeLayersWithMandatoryLock`,
`src/policy/kernel/rule-types.ts`'s `mandatory` field, `src/policy/config/loader.ts` — triggered by
`docs/reviews/s6-policy-centralization-red-team-round2-2026-09-08.md` (Issue #114, HIGH, the second
consecutive no-go that tripped PRINCIPLES rule 16(c)) and Issue #115 (MED).
**Council seat:** "whether the shape should exist" — ruling POL-07's actual trust model, per PRINCIPLES
rule 16(c) and this project's own council convention (`design-challenger` + `architecture-reviewer` +
`impact-analyst`, conducted by the Manager; this document is `architecture-reviewer`'s own dated report).
**My earlier pass on this story:** `docs/reviews/s6-policy-centralization-architecture-2026-09-08.md`
(pre-build, APPROVE-WITH-CONDITIONS) — this is a different question. That pass judged the plan before
code existed; POL-07's mandatory-lock trust order was not concretely wrong until `mergeLayersWithMandatoryLock`
was written and red-team exercised it against a real, git-tracked `shipped-defaults.json`.
**Date:** 2026-09-08
**ADR cache:** `node docs/adr-cache.mjs --ensure` -> "ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog - approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]"

## What was read

`docs/PRINCIPLES.md` (full, rules 1-21); `docs/reviews/s6-policy-centralization-red-team-round2-2026-09-08.md`
(full, findings 1-10 plus SURVIVES C1-C11); `docs/reviews/s6-policy-centralization-architecture-2026-09-08.md`
(my own pre-build pass, full); `docs/decisions.md`'s 2026-09-08 rows in full (S6 intake NEEDS-INFO, S6 Phase 1
plan ratification, S6 pre-build review, Stage-3 round 1, Stage-3 round 2, S6 Phase 2 build complete, Stage-3
round-1 fix-now); `REQUIREMENTS.md` section 0.4 (lines 63-71, the three centralization properties), section 1.4
(lines 214-232, the registry-channel table and its "a change under review cannot alter the policy that judges
it" line), POL-07/08/09 (lines 431-434). Code-traced against the real shipped diff at `280f1c7`:
`src/policy/rule/precedence.ts` (full, `mergeLayersWithMandatoryLock` lines 150-183 plus its header comment),
`src/policy/kernel/rule-types.ts` (full, `mandatory` field lines 28-33), `src/policy/config/loader.ts` (full),
`src/policy/rule/precedence.test.ts` lines 190-260 (the two tests red-team names, `:219` and `:236`, plus their
neighbors), `src/policy/rule/schema.ts` lines 1-95 (`findDuplicateTopLevelKeys`, Issue #115's own function).
Confirmed via `gh issue view 114/115` that both Issues are OPEN, correctly labeled (`bug`,
`severity:high`/`severity:med`, `pol`), and neither is a duplicate of anything else. Confirmed
`docs/.maat-state.json`: `reviewRoundsSinceClean: 2`, `humanRulingRequired: false`, `councilVerdict: null`,
`scope: "s6"` — matches the ratified Stage-3-round-2 row exactly (Issue #117's correction landed). Confirmed
HEAD is `280f1c7` (`git log --oneline -3`), tree clean, matching the brief.

## The trust-model ruling

### What the code actually does today

`mergeLayersWithMandatoryLock` (`precedence.ts:150-165`) walks layers in **precedence order**
(`shipped-defaults`, `central`, `project`). Any layer whose rule id collides with an id an **earlier**
layer marked `mandatory: true` is voided in its entirety. Precedence order is a total order over three
named layers; the code treats "earlier in precedence" as "may lock a later layer" with no further
qualification. `shipped-defaults.json` is git-tracked, lives inside `src/policy/config/`, and is editable
by any change under review — the exact adversary REQUIREMENTS.md section 0.4 property 2 names ("A change
under review cannot alter the rules that judge it"). Because it is earliest in precedence, it is currently
the **most** authoritative locker in the system, ahead of `central` — the one layer REQUIREMENTS.md section
1.4 line 225 actually protects with an admin-only write ACL ("The plist and HKLM channels require
administrator privileges to write, so a change under review cannot alter the policy that judges it").

Red-team's finding 1 (HIGH, demonstrated, `precedence.test.ts:219`/`:236` pinning it as intentional) is a
real defect against POL-07's literal text (REQUIREMENTS.md:431: "The central policy source shall be able
to mark a rule mandatory; downstream configuration cannot relax it") and against section 0.4 property 2.
I re-derive nothing here — the repro, the two green tests, and the exit-0/silent-selective-suppression
shape are `code-traced` against the same lines red-team cites, and I confirm them independently reading
`precedence.ts:150-165` myself: the collision check (`lockedMandatoryIds.has(rule.id)`) never inspects
which layer is doing the locking, only whether an id was previously locked by *some* earlier-accepted
layer, unconditionally. VIOLATES POL-07.

### Ruling on the three candidate paths

**(A) `mandatory` is a central-source-only declaration.**
Implementation: `loader.ts` (which is layer-aware; `schema.ts` deliberately is not, and should stay that
way — it validates identical shape for all three layers today, a real, useful invariant) rejects, loudly,
any `mandatory: true` on a rule not sourced from the `central` layer. Matches POL-07's literal text
exactly ("the central policy source shall be able to mark a rule mandatory" — no other source is named).
Smallest change; strongest signal (a loud rejection at load time, not a merge-time no-op), consistent with
POL-06's own "unknown key is an error, not a silent no-op" ethos and this codebase's own "fail loud"
pattern (POL-05's "deny a mutating action whose record is opaque," schema.ts's unknown-key rejection).

**But it reverses a specific, already-ratified human ruling, and I name that plainly.** The 2026-09-08
plan-ratification row's Q2 text is unambiguous: "POL-07 mandatory-lock scope: build the general
any-layer-locks-later-layers form ... but S6's own tests exercise only the literal central to project case
... doesn't foreclose the general shape without inventing untested behavior." Path A forecloses exactly
that general shape — it downgrades "any layer" to "central only," a scope narrowing the human explicitly
declined to make when asked. This was a human ruling via `AskUserQuestion`, not a Manager or reviewer
call; PRINCIPLES rule 7 ("the human overrides") and rule 9's "ADR vs convention" reasoning both point the
same direction here: reversing it is not something a council GO should do unilaterally, even though rule
16(c)'s mechanics technically permit GO to proceed without waking the human. Verdict: REWORK as the
primary path — not because the fix is wrong, but because adopting it as the council's ruling requires a
fresh human decision, and the council should present it as an option, not silently substitute it for the
ruling already on record.

**(B) A lock only voids a layer strictly LESS trusted than the locking layer.**
Implementation: a small trust-rank table, `{ central: 1, "shipped-defaults": 0, project: 0 }` today (two
tiers, not three — `shipped-defaults` and `project` are peers: both are git-tracked, in-repo,
session-writable, with none of section 1.4 line 225's ACL protection; nothing distinguishes their trust
today). `mergeLayersWithMandatoryLock`'s lock check becomes: a layer's rule collides with a lock only if
the locking layer's trust rank is *strictly greater* than the colliding layer's own rank. Central's
mandatory locks still void project exactly as today (rank 1 > rank 0) — the tested, ratified,
human-asked-for case is untouched. `shipped-defaults`' `mandatory: true` becomes structurally inert
against both peers and against central (rank 0 is never greater than rank 0 or rank 1) — Issue #114
closes completely: no in-repo edit can ever again lock anything more trusted than itself.

This does not reverse the human's general-form ruling — it completes it. Re-reading Q2's own stated
reasoning: the ask was for a lock check that is general in the sense the design-challenger/red-team Issues
#65/#66/#99 lineage cares about — one that never hardcodes `sourceLayer === "central"` in the
collision-detection logic itself, so the mechanism doesn't silently work for the tested direction only.
Trust rank satisfies that reasoning exactly: the collision check still never references a layer name, only
a rank comparison over an abstraction that happens to be 1 for one layer and 0 for two today. It is the
same "general by construction, not by convention" shape `precedence.ts`'s own header comment (lines 82-90)
already argues for — I am applying that argument to the one axis (trust) the human ruling was never asked
to address, because the trust-order bug did not exist as a nameable question before this code shipped.
This is precisely this council seat's own charter: a defect the pre-build round could not have seen.
Verdict: APPROVE. No fresh human ruling required — it stays inside the scope already granted.

**(C) Something structurally cleaner — a hybrid, not a third independent shape.**
Path A and Path B converge to *identical enforced behavior* under today's single-trusted-source system
(only `central`'s `mandatory: true` ever has locking force) — they differ only in *mechanism* (schema-time
rejection vs. merge-time trust-rank check) and in *silence*. Un-amended, Path B leaves `shipped-defaults`'
inert `mandatory: true` declaration exactly as silent as today's bug was (red-team's own finding-1
exposure line: "Silent: partially"). I recommend closing that gap without reopening the scope question:
Path B's trust-rank mechanism, plus a loud, non-error disclosure — a rule with `mandatory: true` sourced
from a layer whose trust rank never gives it locking force is reported (printer/pin disclosure line, same
mechanism `PrinterResult.disclosure` already carries for Issue #109) as "declared mandatory but not
authoritative — only the central layer's `mandatory` is enforced," not silently dropped. This is not a new
design axis, just Path B disclosed as loudly as Path A would have rejected it — the two paths' best
properties combined at near-zero marginal cost, since the printer/pin plumbing already exists. Recommend
as part of the Path B build task, not a separate path.

### Ruling table

| Path | Matches POL-07 text | Closes #114 | Reverses ratified 2026-09-08 scope ruling | Verdict |
|---|---|---|---|---|
| A - central-only declaration | Exactly | Yes | Yes - needs a fresh human ruling before adoption | REWORK (present as option, don't silently substitute) |
| B - trust-rank, strictly-less-trusted-only | Satisfies text via the one trusted layer that exists today | Yes | No - completes the general-form ask on an axis it never addressed | APPROVE |
| B + loud disclosure (recommended build shape) | Same as B | Yes, plus closes the silent tail of red-team's own exposure line | No | APPROVE - this is my recommendation |

## Issue #115 ruling — same root-cause CLASS, independently fixable, does NOT belong in this council's scope

`findDuplicateTopLevelKeys` (`schema.ts:45-88`) accumulates each top-level key's raw, still-escaped
source text and compares those strings; `JSON.parse` compares unescaped values. A `\u0072ules` top-level
key is therefore two keys to the scanner and one to the parser — the exact shape red-team demonstrated
(`printer.ts` reports the wrong origin line, exit 0).

**Structural parallel to #114, worth naming, not worth conflating.** Both bugs are the same family: a
locally-reimplemented signal (precedence order for #114; raw-text key identity for #115) stood in for the
actual authoritative property (trust, for #114; `JSON.parse`'s own notion of key identity, for #115) and
the substitution was correct for every tested shape and wrong for one untested one. This is the third-plus
time this exact family has shown up in this codebase (Issues #65/#66/#99 were named by design-challenger
as the same lineage before either #114 or #115 existed). That is worth a standing backlog line — see below
— but it is not the same finding, and it does not carry the same design weight.

**Why it stays out of council scope.** #114 required a design ruling because there were multiple
defensible shapes (A vs. B vs. hybrid) and picking among them cost something against an already-ratified
human decision — exactly the kind of question `architecture-reviewer`/`design-challenger`/`impact-analyst`
exist to adjudicate. #115 has no such fork: red-team's own proposed fix ("JSON-unescape each captured key
before counting, or reject any top-level key containing a backslash," plus the invariant test "the
tokenizer's top-level key set equals `Object.keys(JSON.parse(text))`") is the obvious, uncontested correct
fix — a mechanical parser-differential bug with one right answer, not a trust-model question. It touches
`schema.ts` only, never `precedence.ts`'s lock logic, and has zero interaction with whichever path the
council rules on for #114. Ruling: #115 is a plain next-round (Stage-3 round 3) fix-now item, filed and
tracked (already is, Issue #115, OPEN, MED), landed alongside the #114 fix in the same round since they
touch overlapping files — not a second council question.

**Recommended backlog line (new, not previously named):** a standing QA convention — any hand-rolled
scanner that mirrors `JSON.parse`'s (or another authoritative parser's) notion of identity ships with a
differential fuzz test proving agreement, not merely hand-picked shape coverage — would have caught #115
before red-team did, and generalizes to the next instance of this recurring family. `docs/backlog.md`,
owner TBD.

## Cost to the already-ratified 2026-09-08 human decisions

1. **Mandatory-lock strictness ruling** ("reject outright, unconditionally... no field-by-field diff
   logic") — untouched by either path. Both A and B still reject a colliding id unconditionally; the
   question both paths answer is which layer's mandatory claim is authoritative enough to trigger that
   rejection in the first place, a question the strictness ruling never addressed (it answered "how
   forgiving is the check," not "who may assert it").
2. **Mandatory-lock scope ruling** ("build the general any-layer-locks-later-layers form... doesn't
   foreclose the general shape") — Path B honors it; Path A reverses it. This is the crux of my
   recommendation: Path B is the only one of the two that ships without asking the human to revisit a
   decision they already made deliberately, in writing, among presented options, one session ago.
3. **Channel choice** (thoth-owned `HKLM\SOFTWARE\Policies\Thoth` sibling key) — untouched by either path.
   Neither path changes which registry key central reads from or how; the trust-rank concept in Path B is
   keyed by layer name (`central`/`shipped-defaults`/`project`), not by channel mechanics. My own
   pre-build finding 11 on the channel choice itself stands unchanged (CLEAN, still architecturally sound).

## Blast radius, coupling, evolution — judged directly

**Blast radius today: zero live enforcement, contained.** `loadEffectivePolicy` has exactly one
production consumer (`printer.ts`, itself only reachable via `npm run policy:print`, a manual CLI) — no
hook consumes it yet (`hooks/pretooluse-kernel-gate.mjs` stays on its own separate
`loadBootstrapRuleSet()` path per Q2's earlier, unrelated ruling). Both paths are equally contained by
this: whichever is chosen, the fix lands before any live gate depends on it, which is the best possible
time to fix a trust-model defect — before it has a blast radius to correct for.

**Coupling: Path B adds one small, real coupling point that Path A would not.** A trust-rank table is a
new piece of shared knowledge `precedence.ts` and (if the loud-disclosure recommendation is built)
`printer.ts` must agree on. It is small (two ranks, three names) and lives in one file, but it is a second
place, alongside `LayerName`'s own three-value union, that must be extended together if a fourth layer or
a second trust tier is ever introduced. This is the honest cost of Path B over Path A: Path A needs no new
concept at all, just a layer-name check already implicit in `loader.ts`'s existing per-layer control flow.

**Evolution path: Path B is the one that doesn't need re-deciding when the shape it was built for
actually arrives.** REQUIREMENTS.md section 1.4 names macOS's plist channel and the admin-console-delivered
file as siblings to HKLM — S6 ships only the Windows reader (my own pre-build finding 2, still open, still
a NOT-COVERED item, unaffected by this ruling either way). When a second out-of-repo, admin-ACL-protected
channel eventually ships (a second `central`-tier reader, not a fourth layer), Path B's trust-rank concept
already has the right shape to recognize it as trust-rank 1 alongside the Windows reader, with no schema
change; Path A's central-only schema restriction would need no change either, since both readers still
feed the same `central` `NamedRuleLayer` slot — so this particular forward case does not actually
distinguish the two paths as much as it might first appear. The real distinguishing forward case is
narrower and more honest: a second trusted-but-not-central layer (not named anywhere in REQUIREMENTS.md
today, not on this project's roadmap I could find) is the only scenario where Path B's generality earns
its keep over Path A's simplicity. I flag this rather than overclaim it: Path B is not obviously cheaper
to maintain than Path A on a five-year view; it is cheaper today, on the one axis that matters for this
ruling — not needing to re-litigate a decision the human already made this session.

**Cost shape:** both paths are read-path-only, no new I/O, no new external dependency, bounded by the
same three-layer, small-rule-count shape POL-08 already bounds. Neither introduces an unbounded variable.

**Operability:** the loud-disclosure addition to Path B directly improves operability over the shipped
code's current silent-tail behavior — an operator running `policy:print` today sees `VOIDED:` lines only
when something actually gets dropped; under the recommended shape, a `shipped-defaults` rule declaring
`mandatory: true` and being ignored is now visible too, closing a class of "policy author assumed a
protection that was never real" surprise before it ships content that leans on it (my own pre-build
finding 6 already flagged the untested shipped-defaults-origin lock paths as a fast-follow content-story
risk — this closes part of that risk structurally rather than just via a test).

## Verdict table

| Axis | Verdict | Basis |
|---|---|---|
| 1. Fit | Path B fits; Path A over-corrects the ratified scope | POL-07's acceptance text only requires central's mandatory to hold; Path B delivers exactly that without narrowing the general mechanism the human explicitly asked to keep |
| 2. Blast radius and coupling | APPROVE (Path B) | Zero live enforcement today either way; Path B's only new coupling is a small, single-file trust-rank table |
| 3. Compliance | Current code VIOLATES POL-07 (REQUIREMENTS.md:431) and section 0.4 property 2 (already tracked as Issue #114, HIGH); Path B brings it to CONFORMS | Quoted operative text above; code-traced against `precedence.ts:150-165` |
| 4. Cost shape | CONFORMS | Read-path only, no unbounded variable, no new I/O |
| 5. Operability | Path B + loud disclosure IMPROVES on shipped state | Closes the silent tail red-team's finding 1 named; reuses existing `PrinterResult.disclosure` plumbing |

## Findings, ranked by blast radius

1. [ISSUE][HIGH][code-traced] Current shipped code (`precedence.ts:150-165`) uses POL-08 precedence
   order as trust order, letting the git-tracked, session-writable `shipped-defaults.json` void the
   entire `central` layer at exit 0 — already tracked as Issue #114 (OPEN, correctly labeled, no
   duplicate filed here). Quoted: REQUIREMENTS.md:431, "The central policy source shall be able to mark
   a rule mandatory; downstream configuration cannot relax it"; section 0.4 property 2, "A change under
   review cannot alter the rules that judge it." Two green tests (`precedence.test.ts:219`, `:236`)
   currently pin the wrong behavior. Exposure: 100% of loads with an earlier-layer mandatory id colliding
   with a later one (basis: counted-in-code, one branch); 0% of live enforcement today (basis:
   counted-in-code, `printer.ts` is the sole production consumer). Security category, exempt from the
   exposure cap. Resolution ruled here: Path B (trust-rank), APPROVE.
2. [ISSUE][MED][code-traced] `findDuplicateTopLevelKeys` (`schema.ts:56-69`) compares raw escaped key
   text while `JSON.parse` compares unescaped values — already tracked as Issue #115 (OPEN, correctly
   labeled, no duplicate filed here). Ruled: same root-cause FAMILY as #114 (locally-reimplemented signal
   substituted for the authoritative one), but independently fixable with no design fork — a plain
   next-round fix, not council scope.
3. [SUSPICION][LOW][derived] No standing QA instrument catches this recurring bug family (proxy signal
   vs. authoritative signal, now 5 instances counting #65/#66/#99/#114/#115) before red-team does each
   time. Recommend a `docs/backlog.md` line: any hand-rolled scanner mirroring an authoritative parser's
   notion of identity ships with a differential fuzz test, not just hand-picked shape coverage. Exposure:
   0% today — process-hygiene only. Basis: derived from the pattern across five now-named Issues.
4. [CLEAN][code-traced] The mandatory-lock STRICTNESS ruling (reject outright, unconditionally, no
   field-diff) is untouched by either candidate path — both preserve it exactly.
5. [CLEAN][code-traced] The channel choice (`HKLM\SOFTWARE\Policies\Thoth`) is untouched by either
   candidate path — my own pre-build finding 11 (CLEAN) stands unchanged.
6. [CLEAN][code-traced] `mergeLayersWithMandatoryLock`'s composition with the shared `mergeLayersById`
   core (my own pre-build finding 1) was built exactly as prescribed — confirmed at `precedence.ts:167`,
   a literal call to the shared core, never a second hand-rolled loop. Trust-rank (Path B) extends this
   same shape; it does not require re-deriving the composition.

## NOT-COVERED / AMBIGUOUS list (architect's work queue)

1. Path A remains a legitimate alternative if the human, on seeing this ruling, prefers the simpler
   central-only shape over trust-rank generality — that choice is the human's to make, not mine to
   pre-empt; the Manager's Path-Forward Brief should present both A and B (recommended) rather than only
   B.
2. The recurring proxy-vs-authoritative-signal bug family (finding 3) has no owning story yet — a
   backlog line, not a blocker.
3. My own pre-build findings 2-6 (non-win32 `CentralPolicySource` behavior, subprocess-cache reuse,
   interface return shape, admin-provisioning runbook, untested shipped-defaults-lock paths) are
   unaffected by this ruling and remain open exactly as my pre-build report left them — restated here
   only to confirm none of them are silently resolved by the trust-model fix.

## Findings vs. failing tests

Both open [ISSUE] findings (1, 2) already have named failing-test proposals on record: red-team's own
three proof-tests for finding 1 (adjusted here to name Path B's trust-rank shape rather than leaving the
choice open — "a mandatory-lock violation may only void a layer with a STRICTLY LOWER trust rank than the
locking layer; a `shipped-defaults`-declared lock colliding with `central` never voids `central`, and
`central`'s own lock still voids `project`" replaces the ambiguous phrasing in the original proof-test),
plus a new one for the loud-disclosure recommendation ("a non-authoritative layer's `mandatory: true`
declaration is reported, not silently dropped"); red-team's two proof-tests for finding 2 stand unchanged.
Open findings: 2 [ISSUE] + 1 [SUSPICION]. Failing tests named: 2 (finding 1's set) + 2 (finding 2's set,
already red-team's own) = the same count as the [ISSUE] findings; finding 3 (backlog line) has no
executable form by design (process hygiene, not a code defect) — the gap is explained, not silently left.

## Verdict

APPROVE — Path B (trust-rank, strictly-less-trusted-only), with the loud-disclosure amendment, as the
council's recommended path. Path A is REWORK only in the narrow sense that adopting it requires a fresh
human ruling first (it reverses an explicit, already-ratified scope decision) — it is not architecturally
wrong, and the Manager's Path-Forward Brief should offer it as the human's alternative, not hide it.
Issue #115 is ruled OUT of this council's scope: same bug family, independently fixable, no design fork,
lands in the next Stage-3 round alongside whichever #114 fix is built.

## Single next action

Manager posts the Path-Forward Brief naming Path B (trust-rank + loud disclosure) as the recommended
council ruling and Path A (central-only) as the human's alternative if they'd rather reverse the
mandatory-lock scope ruling instead of completing it; on the human's confirmation (or on a council GO if
the Manager judges Path B doesn't require waking the human, since it reverses nothing already decided),
`story-implementer` lands Path B's trust-rank check plus Issue #115's unescape-before-compare fix in one
Stage-3 round 3, replacing `precedence.test.ts:219`/`:236` with the corrected assertions named above, then
`red-team` re-confirms.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][code-traced] Shipped mergeLayersWithMandatoryLock (precedence.ts:150-165) uses POL-08 precedence order as trust order - a git-tracked, session-writable shipped-defaults.json can void the entire central layer at exit 0, against POL-07's literal text (REQUIREMENTS.md:431) and section 0.4 property 2; already tracked as Issue #114 (OPEN), no duplicate filed. Ruled: Path B (trust-rank, strictly-less-trusted-only) closes it and honors the already-ratified "general any-layer-locks-later-layers" scope decision; Path A (central-only) also closes it but reverses that scope decision and needs a fresh human ruling before adoption. Exposure: 100% of loads with an earlier-layer mandatory id colliding with a later one (counted-in-code); 0% of live enforcement today (counted-in-code, printer.ts sole consumer). Security category, exempt from exposure cap.
2. [ISSUE][MED][code-traced] findDuplicateTopLevelKeys (schema.ts:56-69) compares raw escaped key text while JSON.parse compares unescaped values - a unicode-escaped duplicate key bypasses it; already tracked as Issue #115 (OPEN), no duplicate filed. Ruled: same root-cause FAMILY as #114 (locally-reimplemented signal substituted for the authoritative one) but independently fixable, no design fork - belongs in the next Stage-3 round, not this council's scope.
3. [SUSPICION][LOW][derived] No standing QA instrument catches this recurring proxy-vs-authoritative-signal bug family (5th instance counting #65/#66/#99/#114/#115) before red-team finds it each time - recommend a docs/backlog.md line for a differential-fuzz-test convention on hand-rolled scanners.
4. [CLEAN][code-traced] The mandatory-lock STRICTNESS ruling (reject outright, unconditionally, no field-diff) is untouched by either candidate path.
5. [CLEAN][code-traced] The channel choice (HKLM\SOFTWARE\Policies\Thoth) is untouched by either candidate path - pre-build finding 11 (CLEAN) stands.
6. [CLEAN][code-traced] mergeLayersWithMandatoryLock's composition with the shared mergeLayersById core (my own pre-build finding 1) was built exactly as prescribed (precedence.ts:167) - Path B extends this shape without re-deriving it.
counts (CHECKSUM): issues=2 suspicions=1 clean=3
evidence (CHECKSUM): demonstrated=0 code-traced=5 derived=1
checks=n/a (council-seat design ruling on an already-reviewed, already-tested diff - no new code run this pass; relies on red-team round 2's own executed evidence, 617 pass / 1 fail (pre-existing, Issue #113) / 0 skipped, re-cited not re-run)
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-council-trust-model-architecture-2026-09-08.md

---

## ADDENDUM (2026-09-08, same day, appended not edited — PRINCIPLES rule 11)

Cross-checked against the other two council seats' reports after my own ruling above was already
written and persisted: `docs/reviews/s6-policy-centralization-council-impact-analyst-2026-09-08.md`
(impact-analyst, SAFE-TO-PATCH, recommends Candidate B) and
`docs/reviews/s6-policy-centralization-design-challenger-council-stopbrief-2026-09-08.md`
(design-challenger, go, Stop Brief naming Paths A/B/C without recommending). Both independently reach
the same overall shape I did (Path B preferred; Path A viable but costlier than it looks). Reconciling
one real discrepancy between the two:

**Design-challenger's Stop Brief states Path A "costs nothing against the current fixture: `src/policy/
config/shipped-defaults.json` today is `{"version": "0.0.0-s6-placeholder", "rules": []}` — zero rules,
so zero legitimate `mandatory` usages would be broken by forbidding it there."** Impact-analyst's report
states the opposite: Candidate A breaks 3 LOCKED `printer.test.ts` cases via a committed test-writer
fixture. **I independently code-traced this myself, and impact-analyst is correct; design-challenger
checked the wrong file.** `src/policy/config/shipped-defaults.json` (the production placeholder) is
indeed empty — but `printer.test.ts` does not read that file. It reads
`docs/qa/s6-policy-loader-fixtures/printer-shipped-defaults.json` (a separate, committed test-writer
fixture, confirmed via `SHIPPED_DEFAULTS_PATH` in `printer.test.ts`), which contains:

```json
{
  "version": "1.0.0-fixture",
  "rules": [
    { "id": "shipped-baseline-deny-secrets", "effect": "deny", "targets": ["secrets/"],
      "mandatory": true, "rationale": "Shipped-defaults baseline: secrets access is denied by
      default and mandatory-locked so no downstream layer can silently relax it." }
  ]
}
```

Three test cases (`printer.test.ts:292`, `:300`, `:310` — confirmed by direct read, matching
impact-analyst's count exactly) assert **exit code 0 and a full successful rule listing** with this
rule's `mandatory: true` echoed through the printer output, no collision anywhere in the fixture set
(`printer-project.json`'s ids are disjoint, confirmed by direct read). Under Path A, the mere
*declaration* of `mandatory: true` on a non-central-sourced rule is itself illegal — no collision
required — so all three tests would flip from an expected successful listing to an unexpected
rejection. These are `printer.test.ts` cases: the LOCKED test-writer answer key this project's own DoD
forbids `story-implementer` from silently editing ("If `story-implementer` believes a test is wrong or
impossible per spec, it flags that back rather than silently editing the test file").

**This strengthens my Path B recommendation with harder, more concrete evidence than my original
ruling cited.** My original text argued Path A costs a *process* reversal (a human ruling needs
revisiting). This addendum adds a *mechanical* cost design-challenger's own brief missed: Path A cannot
land without either (a) a flag-back-and-reauthor cycle with `test-writer`/the Manager to legitimately
change the three LOCKED assertions (not optional ceremony — a DoD-mandated precondition), or (b)
discovering, only after attempting Candidate A, that the fixture itself already exercises the exact
"defense-in-depth baseline mandatory rule with no central deployed" scenario my original ruling flagged
as an unproven-but-plausible legitimate use case for the general form — which is now not merely
hypothetical, it is a use case a committed test-writer fixture already encodes as intended behavior.
Both readings point the same direction: **Candidate B remains my recommendation, now for a second,
independently-derived reason beyond the one my original ruling gave.**

No change to my verdict, my ruling table, or my RECEIPT below the original report — this addendum adds
one corroborating fact, code-traced, catchable by any reader who opens `printer.test.ts` and
`docs/qa/s6-policy-loader-fixtures/printer-shipped-defaults.json` directly. Recommend the Manager fold
this cross-check into the Path-Forward Brief so design-challenger's "costs nothing" characterization of
Path A is not carried forward uncorrected.

ADDENDUM RECEIPT: verdict=APPROVE-WITH-CONDITIONS (unchanged)
addendum findings:
7. [ISSUE][HIGH][code-traced] Design-challenger's Stop Brief claim that Path A "costs nothing against the current fixture" checked the wrong file (src/policy/config/shipped-defaults.json, empty) rather than the fixture printer.test.ts actually reads (docs/qa/s6-policy-loader-fixtures/printer-shipped-defaults.json, non-empty, mandatory:true on a shipped-defaults-sourced rule with no collision). Path A breaks 3 LOCKED printer.test.ts cases (lines 292, 300, 310, independently re-confirmed by direct read) and cannot land without a DoD-mandated test-writer flag-back/reauthor cycle. Corroborates (does not replace) this report's original Path B recommendation.
counts (revised CHECKSUM): issues=3 suspicions=1 clean=3
evidence (revised CHECKSUM): demonstrated=0 code-traced=6 derived=1
report=docs/reviews/s6-policy-centralization-council-trust-model-architecture-2026-09-08.md

---

## Final consolidated RECEIPT (supersedes nothing above — restates the original RECEIPT plus the addendum's finding 7 together, as this file's own closing block, per the "RECEIPT as last lines" requirement)

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][code-traced] Shipped mergeLayersWithMandatoryLock (precedence.ts:150-165) uses POL-08 precedence order as trust order - a git-tracked, session-writable shipped-defaults.json can void the entire central layer at exit 0, against POL-07's literal text (REQUIREMENTS.md:431) and section 0.4 property 2; already tracked as Issue #114 (OPEN), no duplicate filed. Ruled: Path B (trust-rank, strictly-less-trusted-only) closes it and honors the already-ratified "general any-layer-locks-later-layers" scope decision; Path A (central-only) also closes it but reverses that scope decision and needs a fresh human ruling before adoption. Exposure: 100% of loads with an earlier-layer mandatory id colliding with a later one (counted-in-code); 0% of live enforcement today (counted-in-code, printer.ts sole consumer). Security category, exempt from exposure cap.
2. [ISSUE][HIGH][code-traced] Design-challenger's Stop Brief claim that Candidate A "costs nothing against the current fixture" checked the wrong file (src/policy/config/shipped-defaults.json, empty) rather than the fixture printer.test.ts actually reads (docs/qa/s6-policy-loader-fixtures/printer-shipped-defaults.json, non-empty, mandatory:true on a shipped-defaults-sourced rule, no collision). Candidate A breaks 3 LOCKED printer.test.ts cases (lines 292, 300, 310, independently re-confirmed by direct read) and cannot land without a DoD-mandated test-writer flag-back/reauthor cycle - a second, independent reason (beyond the human-ruling reversal) that Candidate B is the cheaper, correct recommendation.
3. [ISSUE][MED][code-traced] findDuplicateTopLevelKeys (schema.ts:56-69) compares raw escaped key text while JSON.parse compares unescaped values - a unicode-escaped duplicate key bypasses it; already tracked as Issue #115 (OPEN), no duplicate filed. Ruled: same root-cause FAMILY as #114 (locally-reimplemented signal substituted for the authoritative one) but independently fixable, no design fork - belongs in the next Stage-3 round, not this council's scope.
4. [SUSPICION][LOW][derived] No standing QA instrument catches this recurring proxy-vs-authoritative-signal bug family (5th instance counting #65/#66/#99/#114/#115) before red-team finds it each time - recommend a docs/backlog.md line for a differential-fuzz-test convention on hand-rolled scanners.
5. [CLEAN][code-traced] The mandatory-lock STRICTNESS ruling (reject outright, unconditionally, no field-diff) is untouched by either candidate path.
6. [CLEAN][code-traced] The channel choice (HKLM\SOFTWARE\Policies\Thoth) is untouched by either candidate path - pre-build finding 11 (CLEAN) stands.
7. [CLEAN][code-traced] mergeLayersWithMandatoryLock's composition with the shared mergeLayersById core (my own pre-build finding 1) was built exactly as prescribed (precedence.ts:167) - Path B extends this shape without re-deriving it.
counts (CHECKSUM): issues=3 suspicions=1 clean=3
evidence (CHECKSUM): demonstrated=0 code-traced=6 derived=1
checks=n/a (council-seat design ruling on an already-reviewed, already-tested diff - no new code run this pass; relies on red-team round 2's own executed evidence, 617 pass / 1 fail (pre-existing, Issue #113) / 0 skipped, re-cited not re-run; cross-checked sibling council reports' own executed evidence, 47/47 precedence.test.ts+schema.test.ts per design-challenger's Stop Brief, re-cited not re-run)
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-council-trust-model-architecture-2026-09-08.md
