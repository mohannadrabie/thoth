# Design Challenger (Apep) — `qa14-marker-redesign` STOP BRIEF

- **Date:** 2026-09-11
- **Scope:** branch `fix/qa14-marker-redesign` @ `a26e55a`, repo `mohannadrabie/thoth`, CRITICAL tier
- **Mode:** Stop Brief, invoked directly by `/maat:council` (not a normal attack round; no round budget consumed)
- **Mandate:** what is proven safe, what is genuinely open, what has never been run — not a ruling on shape, not a fix.
- **ADR cache:** `📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]` — no ADR governs QA-instrument internals or CI-gate blocking/non-blocking semantics for this file (confirmed independently, same conclusion as the Phase 1 plan §1 and every review round since).

## Reading order followed

`docs/decisions.md` rows 58–69 (full `qa1415fix`→`qa14-marker-redesign` history, all 4 rounds) → `docs/reviews/qa14-marker-redesign-red-team-round4-2026-09-11.md` (full, the triggering report) → `docs/reviews/qa14-marker-redesign-red-team-round3-2026-09-11.md` (full) → `docs/plans/qa14-marker-redesign-phase1-2026-09-11.md` (full) → the live code (`src/qa/reference-resolver.ts`, `src/qa/marker-corpus-probe.ts`, `src/qa/completeness-claim-checker.ts`) and the live tree state (`CHANGELOG.md`, `docs/STATE.md`, `docs/.maat-state.json`) at `a26e55a`. `docs/.maat-state.json`: `humanRulingRequired: false`, `councilHeld: false` — clear to proceed.

I did not treat red-team round 4's report as ground truth by citation alone — every load-bearing claim below that I use is either independently re-run by me this session or explicitly marked inherited-frozen with its own evidence tier stated.

---

## Frozen set — proven safe, by evidence

These are **not open questions**. Re-opening any of them requires new evidence (code, a test run, a measurement), not re-derivation from prose, per the calibration rule.

| # | Claim | Evidence tier | How I verified it (not just cited) |
|---|---|---|---|
| F1 | **Issue #155 closed for real** — the three whole-corpus `expect=N` blocking markers are gone from `CHANGELOG.md`; only `qa-mutation-shell expect=53` remains as a live numeric marker. | demonstrated | Ran `node src/qa/completeness-claim-checker.ts` myself at `a26e55a`: `PASS: 2 file(s) checked`. `grep -n "434\|455\|889"` and `grep -n "10/400"` across `CHANGELOG.md`/`docs/STATE.md`/`src/qa/reference-resolver.ts`/`.test.ts` confirm no `[[completeness: cmd="qa14-marker-corpus-probe-*" expect=N]]` bracket text survives (round-4 report's parser-verified check, independently corroborated by my grep). |
| F2 | **Issue #156 closed for real** — the `--field` CLI-mode plumbing is pinned by a shape test that a real mutation (suppressed emission) turns red. | demonstrated (inherited from red-team round 4, which independently reproduced mutation M1 in an isolated worktree: 9 tests, 8 pass, 1 fail, reverted, md5-restored) | Not re-run by me — this is a mechanical, low-ambiguity mutation-test result with full command/output already in the round-4 report; nothing about it depends on corpus state, so there is nothing time-sensitive to re-check. |
| F3 | **#154's core architectural call (round 1) is sound and stays out of scope, per this task's own constraint**: real, non-zero, always fails LOUD via a blocking `unresolved-authority`, never a silent false-verify. Both alternatives (word-list denylist, dropping comma continuation) are worse. | demonstrated | Ran `node src/qa/completeness-claim-checker.ts` (PASS) and confirmed via code read that `classifyBareHashMatch`'s comma/whitespace continuation path (`src/qa/reference-resolver.ts:331-` area) has no silent-resolve exit — every path that reaches `"marked"` still goes through real `classifyIssue`/`verifyLocalIssue`, which fails closed. This matches 3 independent reviewer measurements across rounds 2/3/4, all agreeing on the mechanism (not always the number). |
| F4 | **Gates are real and green at HEAD.** | demonstrated | `node src/qa/completeness-claim-checker.ts` → `PASS: 2 file(s) checked`, exit 0, this session. (`npm test`/`typecheck`/`lint` not independently re-run by me this session — inherited from red-team round 4's same-commit run: 728/728 pass, 0 fail, 0 skipped, typecheck/lint clean; nothing in this diff-since-last-round changes those surfaces.) |
| F5 | **No ADR governs this surface.** | code-traced | `adrCatalog.adrs` (35 entries) scanned; closest candidates (ADR-0008 ratchet rule, ADR-0001 process) are scoped to the named IaC/supply-chain gate stack or general process, not a QA instrument's internal classification/claim-verification semantics — independently re-confirmed 4 times across this story's rounds, unchanged. |

---

## Genuinely open — not settled by any round, calibrated

None of these can carry a HIGH: this is a CI/QA instrument's internal correctness and its own documentation's numeric accuracy — every path here is `reach=operator` (a maintainer or reviewer running a gate/reading a doc) or `reach=instrument` (the claim-checking machinery itself), never `reach=user`. That ceiling is structural, not a softening — there is no end-user-facing entry point in this file at all.

### O1. [ISSUE][LOW][demonstrated] The stale, non-struck `10/400`/`5 distinct blocking gate failures` figure survives in **more locations than round 4 found** — I independently found 2 more

**Round 4's finding 1** named exactly one location: `CHANGELOG.md:15`. I re-ran the same grep round 4 used, widened to all 4 named "permanently-scanned" files, and it returns **3** live non-struck hits, not 1:

```
$ grep -n "10/400\|10 of 400\|5 distinct blocking\|400 continuation-marked\|400, 10 of which" \
    CHANGELOG.md docs/STATE.md src/qa/reference-resolver.ts src/qa/reference-resolver.test.ts

CHANGELOG.md:15   — the R4 bullet (round 4's finding 1, already known)
CHANGELOG.md:35   — the round-1 Issue #154 entry's own "CORRECTED round-2" annotation (NOT found by round 4)
docs/STATE.md:35  — the round-1 resume-point's own "CORRECTED round-2" annotation (NOT found by round 4)
```

`src/qa/reference-resolver.ts` and `.test.ts` return zero hits — those two files' comments are genuinely fully de-hardcoded, confirming that half of round 3's claim independently.

**Reach: operator** — a maintainer or auditor reading `CHANGELOG.md`/`docs/STATE.md`, not a code path any end user's action invokes. **Exposure: 3 of 4 named permanently-scanned files carry at least one live stale figure (basis: counted-in-code, my own grep, reproducible); within those, 3 of an unknown-but-bounded total occurrence count.** **Likelihood: routine** (a reader following the file top-to-bottom hits it on the first or second pass, no special trigger needed). **Undo: reversible** (it's markdown prose; a maintainer who cross-checks the live command notices the mismatch and corrects it — but nothing forces that cross-check, and 4 rounds of professional reviewers have each independently missed at least one instance, which is itself evidence against relying on a human catching all instances by eye).

**Verdict: BREAKS (LOW).** This is not a new class of defect — it is the *same* class round 4 already flagged, demonstrating a stronger form of round 4's own point: even a dedicated red-team pass built specifically to hunt this exact shape did not find all of it by eye. That is the argument for an instrument, not a further manual sweep — proof-test: `qa14: no non-struck "N of M"/"N/M" figure attributed to the comma-continuation residual survives in CHANGELOG.md, docs/STATE.md, reference-resolver.ts, or reference-resolver.test.ts` (mechanical, not hand-grepped once and trusted).

### O2. [ISSUE][MED][code-traced] The residual has no committed instrument, and the reason is structural, not "nobody added the CLI flag yet"

Round 4's finding 3 established that the replacement pointer command doesn't isolate the residual's count. I traced **why**, one level deeper than round 4 did: `Citation.kind` (`src/qa/reference-resolver.ts:41`) has exactly one value, `"issue"`, for **both** a directly-marked bare `#N` (`"Closes #7"`) and a continuation-marked one that inherited status from an earlier list member (`"Closes #7, #8"`'s `#8`). `classifyBareHashMatch` (line 331, **not exported**) makes this distinction internally via `MarkedListGuardState`/`isListContinuationGap`, but the distinction is discarded before it reaches any caller — `scanReferences`'s emitted `Citation[]` has already collapsed it.

This is *why* every single measurement of this residual across rounds 2, 3, 4 (and every reviewer's own ad hoc count) required hand-building a byte-diffed fork of the shipped file with 2–4 added instrumentation lines, never reusable, never committed, never re-run by the next person without rebuilding it from scratch. It is not that the `--field` CLI convenience was skipped for #154 the way it was built for #150 — it's that **#150's stat (marked vs. unmarked count) is already fully computable from the exported `Citation.kind`, and #154's stat (of the marked population, how many were marked only via continuation, and of those, how many fail real existence) is not exposed by the shipped type at all.** A `--field=continuation-residual` flag bolted onto `marker-corpus-probe.ts` today, without a corresponding change to what `Citation` (or `scanReferences`) exposes, could only re-derive the classification externally — reintroducing the exact "second, independently-maintained copy of the regex/marker logic" anti-pattern `marker-corpus-probe.ts`'s own header comment (lines 13–16) explicitly says it was built to avoid for #150.

**Reach: instrument** (this is a gap in the review/audit tooling itself, not in anything a user or even a normal CI run encounters). **Exposure: 100% of attempts to measure this residual to date (3 of 3 rounds that tried) rebuilt bespoke, uncommitted instrumentation — basis: counted-in-code/counted-in-reports.** **Likelihood: routine for any future reviewer who tries to check the number.** **Undo: runbook-reversible** — the number is always obtainable by someone willing to rebuild the fork again, which is precisely the CLAUDE.md-named anti-pattern ("no hand-derived completeness claims... if no such instrument exists, building one is part of the task").

**Verdict: BREAKS (MED).** Capped at MED, not HIGH, purely on `reach=instrument`. **What it would take to close, stated as a proof obligation, not a design:** a change to what the shipped classifier exposes (so "direct-marked" vs "continuation-marked" survives past `scanReferences`, for any consumer — not just a probe script), plus a real-existence check limited to the continuation-marked subset. Both are code changes to the reviewed/CRITICAL-tier classification path itself, which is a build decision for `story-implementer`/the architect, not something I prescribe here.

### O3. [SUSPICION][LOW][derived] The cost of the instrument O2 would need is unmeasured — real `gh` calls, not free like #150's probe

`marker-corpus-probe.ts` (`--field` mode for #150) runs in 277–290ms because it uses `stubDeps` (`issueExists: () => null`, no network, no `gh` process spawn — see its own header comment, lines 33–38). A residual-count instrument for #154 cannot use that shortcut: it must actually resolve existence for the continuation-marked population (red-team round 4 measured 89 distinct numbers needing a real check at `a26e55a`). `DEFAULT_MAX_DISTINCT_ISSUES` (`src/qa/reference-resolver.ts:587`, fallback 300) already exists as a rate-limit guard for exactly this kind of real-`gh`-call volume elsewhere in this file — so the cap mechanism exists and 89 is comfortably under it — but nobody has run a residual-only instrument end-to-end and measured its actual wall-clock cost, its behavior under `gh` rate-limiting, or whether it should share `QA14_MAX_ISSUES` or need its own cap. This is a straightforward measurement, not a design question, and it directly bears on whether such an instrument is safe to run routinely (e.g., in CI) versus only on demand.

**Verdict: UNPROVEN-pending-verification.** Settles with: build a throwaway prototype of the residual-only check and time it / observe its `gh` call count against a real token, before deciding whether it's CI-safe or on-demand-only. Owner: whoever builds the council's chosen path.

### O4. [ISSUE][MED][demonstrated] Round 3's own evidence sentence for the structural fix is still fabricated at HEAD, uncorrected

Round 4's finding 2 (QA-15 "was already FAILING" at `4896420` with `marked=434 unmarked=455 total=889`) is **still present, unedited, non-struck**, in `CHANGELOG.md`'s round-3 entry as of `a26e55a` — I re-grepped it independently this session:

```
$ grep -n "434\|455\|889\|already FAILING" CHANGELOG.md
59:...at this round's own starting commit (`4896420`), `node src/qa/completeness-claim-checker.ts`
   was already FAILING — the corpus had moved since round 2 shipped (`marked=434 unmarked=455
   total=889` vs. the published `430/456/886`)...
```

Round 4 independently reproduced `4896420` in a pristine detached worktree and got `PASS` at exactly `430/456/886` — the cited triple matches none of 5 enumerated tree states and is internally impossible (`unmarked=455` sits below the additive clean-checkout baseline of `456`). This is not a disagreement about interpretation; it's a number nobody measured. **Reach: operator** (an auditor re-reading the close-out to judge whether the structural fix was justified). **Exposure: 1 of 1 evidence sentences backing the round's central decision — basis: measured (round 4's own 5-tree-state enumeration, which I did not need to re-run since it's a clean reproducible negative: PASS where a FAIL was claimed).** **Likelihood: routine** for the next person who checks the citation. **Undo: reversible** (the conclusion the sentence supports is independently true — round 4 proved it by committing the two round-3 reports on `4896420` and getting a real `FAIL` at `435/473/908` — so this is a citation-accuracy defect, not a reasoning defect).

**Verdict: BREAKS (MED).** Same class as O1: a number that was typed, not measured, sitting in a permanently-rescanned file.

---

## Residual-risk register

| # | Item | Tier at close | Trigger | Exposure |
|---|---|---|---|---|
| O1 | Stale `10/400` figures (now 3 known locations, possibly more) | LOW | Any future reader trusting the written figure over the live command | 3 of 4 named files, counted; unknown total occurrence count until an instrument checks |
| O4 | Round-3's fabricated `434/455/889` evidence sentence | MED | An auditor re-litigating whether removing the 3 blocking markers was justified | 1 evidence sentence, but it is the round's *only* cited evidence for a structural decision |
| — | Round-4's own finding 4 (Milestone-word-form conflation, 0 organic incidence but 1 live self-referential blocking finding) | LOW | Unchanged from round 4 — inherited, not re-litigated here | 3 occurrences / 222 files, 1 live |
| — | Round-4's own finding 5 (mutation M2, wrong `--field` value under correct label) | LOW | Unchanged from round 4 — inherited | 1 CLI path, 0 CI consumers today |
| O3 | Unmeasured cost of a real-`gh`-backed residual instrument | LOW/UNPROVEN | Whoever builds candidate path A | N/A — a measurement gap, not a risk yet |

None of these cross a tenant or security boundary — this file has no multi-tenant surface — so the boundary-crossing carve-out does not apply; every item here may legitimately route to this register rather than a mandatory proof-test, and O1/O4 in particular are one-line prose corrections that need no new mechanism at all.

---

## Unrun verifications

1. **`qa14: no non-struck "N of M" figure attributed to the comma-continuation residual survives in the 4 permanently-scanned files`** — never built as an instrument; every check to date (mine included) is a hand-typed grep run once. Owner: `story-implementer`, day 1 of whatever the council picks.
2. **`qa14: every commit-attributed measurement in CHANGELOG.md/docs/decisions.md reproduces at the commit it names`** — never built; would have caught both O4 (this round) and `docs/decisions.md` row 66's own already-known bad triple (round 3's finding 4) automatically instead of by a 7th manual red-team pass.
3. **Wall-clock/rate-limit cost of a real-`gh`-backed `#154` residual instrument** (O3) — never run even as a prototype.
4. **Whether `Citation`/`scanReferences` can expose the direct-marked-vs-continuation-marked distinction without widening the reviewed classification surface** — never attempted; this is the actual proof obligation behind the council's own framing question, not yet touched by any round.

---

## Candidate paths (council weighs; I do not design or rule)

**A. Build the residual as a real, committed, on-demand instrument** (same spirit as #150's `--field`, explicitly *not* wired to a blocking `expect=N` marker — round 3's and round 4's own finding 3 already say that combination is the wrong one). Needs, to actually work: (1) the shipped classifier to expose the direct/continuation distinction it already computes internally but currently discards (O2); (2) a bounded, rate-limited real-existence check over just that subset (O3, cost unmeasured); (3) registration in `KNOWN_INSTRUMENTS` as callable-but-non-blocking, so prose can point at a command that actually answers the question. This is a real code change to a CRITICAL-tier, 4-round-hardened file — its own review ceremony, not a documentation fix.

**B. Build a generic "no frozen numeric claim survives" linter** (unrun-verification #1/#2 above), independent of whether path A is also built. This closes O1 and O4 as a class, and would have caught 3 of this story's 4 rounds' worth of recurrence automatically. Complementary to A, not a substitute for it — A answers "what is the true number," B answers "did anyone freeze a number they shouldn't have."

**C. Fix the currently-known prose instances only (O1's 3 locations, O4's 1 sentence) as plain edits, ship, and accept the residual class as a standing, disclosed limit** — no new instrument. This is the cheapest path and the one this story has effectively already tried 3 times running (rounds 2, 3, 4 each "fixed the prose" and each was caught with a live recurrence by the next round). Naming that pattern plainly: **path C is not a fresh option, it is repeating what has already failed to converge three times**, demonstrated by `docs/decisions.md` rows 65/67/69 in sequence. It is not unsafe to ship (no HIGH, no silent harm) — it is simply the option with a proven, repeated failure-to-converge history, stated as fact for the council to weigh, not as a recommendation either way.

---

## The single scariest unproven assumption

That editing the sentence is the same thing as closing the finding. Three rounds running, a fix has "closed" this residual's claim-accuracy problem by rewriting the prose, and three times the next independent pass found a live variant — including, this round, a variant even round 4's own dedicated hunt for this exact class missed (O1's second and third locations). The pattern is not "the last editor was careless" — every one of these edits was made by a competent, adversarial, evidence-citing reviewer. The pattern is that **prose accuracy about a number nobody re-derives mechanically is not a property that stays true**, regardless of how carefully or how many times it is re-typed. The only thing that has actually held across all 4 rounds without a single recurrence is the one place this story *did* build a real instrument and stopped asserting an exact value through it (Issue #155's removal) — which is architectural evidence, not a hunch, for why path A's actual hard part (exposing the direct/continuation distinction, O2) is the thing worth the council's attention, not another wording pass.

## Go / no-go

**go.** No open finding here calibrates to HIGH — every path in this file is `reach=operator`/`reach=instrument`, which caps at MED by construction, and money/data/security are not in play. `residuals=5`. Recommendation defaults per the Stop Brief rule to **"build now, open findings become day-1 failing tests"** — nothing here is a calibrated HIGH the council must resolve before build resumes; what remains is the shape question (A vs. B vs. C vs. some combination) that is this council's actual job, informed by O2/O3 above as real proof obligations rather than hand-waved feasibility.

---

RECEIPT: verdict=go
attacks (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][code-traced][instrument/routine/runbook-reversible][100% of 3 measurement attempts to date] `Citation.kind` collapses direct-marked and continuation-marked bare-#N into one value ("issue"), so no committed instrument can compute #154's residual without re-deriving the classifier externally — every measurement to date (rounds 2/3/4) rebuilt a bespoke, uncommitted fork; this is the structural reason the #150 `--field` pattern can't be copied verbatim, not a missing CLI flag.
2. [ISSUE][MED][demonstrated][operator/routine/reversible][1 of 1 evidence sentences for the round's central decision] Round-3's CHANGELOG.md evidence sentence ("QA-15 already FAILING at 4896420, marked=434/unmarked=455/total=889") is still present, non-struck, at HEAD — independently re-confirmed via grep this session; round 4 already proved it unreproducible (PASS at 430/456/886, the claimed triple internally impossible) and it has not been corrected since.
3. [ISSUE][LOW][demonstrated][operator/routine/reversible][3 of 4 named permanently-scanned files] The stale "10/400, 5 distinct blocking gate failures" figure survives in 2 locations (CHANGELOG.md:35, docs/STATE.md:35) that round 4's own dedicated hunt for this exact class did not find, in addition to the 1 location (CHANGELOG.md:15) it did find — demonstrates that manual re-sweeping doesn't converge even under adversarial review, not just that the last sweep was incomplete.
4. [SUSPICION][LOW][derived][instrument/plausible/n-a] The real-`gh`-call cost of any future residual-only instrument (candidate path A) is unmeasured — #150's probe is network-free (stub deps) and #154's residual check cannot be; ~89 distinct real existence checks needed per round-4's own count, under the existing 300-call rate-limit cap but never actually timed or run end-to-end.
5. [CLEAN][demonstrated] Issue #155: three blocking whole-corpus markers genuinely removed — re-verified via a real `completeness-claim-checker.ts` run this session (PASS, 2 files) and grep confirming no `expect=N` bracket text survives outside `qa-mutation-shell`.
6. [CLEAN][demonstrated, inherited] Issue #156: `--field` CLI shape test genuinely catches mutation M1 — round 4's independent worktree reproduction (9 tests, 8 pass/1 fail under mutation) stands unchallenged, no corpus-dependence to go stale.
7. [CLEAN][demonstrated] #154's core mechanism (round-1 architectural call) remains sound: real, non-zero, always fails loud via blocking `unresolved-authority`, never silent — confirmed via code read of the continuation path's exit conditions and a live gate run.
8. [CLEAN][demonstrated] No ADR governs this surface — re-confirmed against the 35-ADR catalog, unchanged across all 4 rounds and this pass.
counts (CHECKSUM): issues=4 suspicions=1 clean=4
evidence (CHECKSUM): demonstrated=6 code-traced=1 derived=1
round=1 (Stop Brief, council-invoked; does not consume the normal attack-round budget) roundsSinceLastGo=0 frozen=5 residuals=5 unrun=4 editorial=0
checks=node src/qa/completeness-claim-checker.ts PASS exit 0 (this session, at a26e55a); grep for stale-figure patterns across 4 named files (3 hits, this session); grep for the round-3 fabricated-evidence sentence (1 hit, still present, this session); npm test/typecheck/lint not independently re-run this session (inherited from red-team round 4's same-commit run: 728/728 pass, 0 fail, 0 skipped)
adr=HIT(35)
report=docs/reviews/qa14-marker-redesign-design-challenger-2026-09-11.md
