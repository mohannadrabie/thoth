# Impact Analyst (Wepwawet) — `qa14-marker-redesign` design council

- **Date:** 2026-09-11
- **Scope:** branch `fix/qa14-marker-redesign` @ `a26e55a`, repo `mohannadrabie/thoth`, CRITICAL tier
- **Convened by:** `docs/decisions.md` 2026-09-11 round-4 triage row, per red-team round-4's council-escalation ruling
- **Question:** what does each candidate path for Issue #154's residual do to everything else — upstream/downstream impact, CONTAINS / RELOCATES / WIDENS. I price candidates; I don't write the fix or rule on shape.

## Read

`docs/decisions.md` rows 60-69 (in full — round-1 through round-4 triage/build rows, the R3/R4/R5/R6 scope ruling, the round-3 structural ruling and its self-imposed council tripwire, the round-4 council-convening row); `docs/reviews/qa14-marker-redesign-red-team-round4-2026-09-11.md` (full); `docs/reviews/qa14-marker-redesign-red-team-round3-2026-09-11.md` (full); `docs/plans/qa14-marker-redesign-phase1-2026-09-11.md` (full); `src/qa/reference-resolver.ts`, `src/qa/marker-corpus-probe.ts`, `src/qa/completeness-claim-checker.ts` (full, current HEAD). Live checks run at `a26e55a`, tree clean except 3 pre-existing untouched working-tree edits from a concurrent council agent (`docs/.maat-state.json`, `docs/REVIEW_LOG.md`, `docs/decisions.md` — 4-line diff total, not touched by me, disclosed per the round-1 triage row's own "shared working tree, concurrent review agents" caution).

## Mechanical baseline (re-measured, not reused from any report)

```
$ git rev-parse HEAD
a26e55ad0e34c2ee4bd681bad944ae1aa24598ae
$ node src/qa/marker-corpus-probe.ts
[QA-14 marker-corpus-probe] PASS: marked=445 unmarked=474 total=919 — approx 52% ... (222 files scanned)
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
```

The corpus has already moved since red-team round-4's own measurement (`919` vs round-4's `925`/`915` window) — this is itself a live, current-session demonstration of the exact self-referential-corpus effect every candidate below has to reckon with, not a historical claim about it.

**The 4 permanently-scanned locations, grepped mechanically, not eyeballed:**

```
$ grep -n "residual\|#154" CHANGELOG.md docs/STATE.md
CHANGELOG.md:15   -> LIVE, non-struck: "10/400 real occurrences, 5 distinct blocking gate failures"
CHANGELOG.md:35   -> historical, inside a struck/corrected "Fixed" entry — point-in-time, not read-forward
CHANGELOG.md:38   -> historical, same as above
CHANGELOG.md:46   -> already de-hardcoded (round-3), correctly qualitative, points at line 54
CHANGELOG.md:54   -> round-3's qualitative entry — correct shape, the template
docs/STATE.md:6   -> resume-point line, no residual figure present (checked directly, clean)
```

Confirms red-team round-4 finding 1 exactly: **1 of 4 locations (`CHANGELOG.md:15`) is still live-stale at this HEAD.** `src/qa/reference-resolver.ts`/`reference-resolver.test.ts` are already qualitative (verified by reading both in full above — no frozen count in either).

**Where the round-3 build's fabricated evidence sentence lives:** `docs/decisions.md` row 68 (its own text, quoted above from my earlier read): *"marked=434 unmarked=455 total=889 vs. the published 430/456/886"* — a triple red-team round-4 proved matches no real tree state. `docs/decisions.md` is **append-only by this project's own convention** (`completeness-claim-checker.ts:198-209` explicitly excludes it from `DEFAULT_FILES` for exactly this reason: *"a later ruling strikes through and appends, it never edits an old row's numbers in place"*). This means **no candidate path below can fix this specific instance** — it is permanently wrong, forever, in the historical record, regardless of which path the council picks. That is a hard scope boundary common to all four candidates, not a defect in any one of them.

**Diff-scope self-pollution is already demonstrated in the existing historical record, not merely reasoned about.** `docs/decisions.md` row 64 (round-1 build): *"The one blocking-occurrence increase vs. the original build's own 23/270 figures ... is `#000` inside this file's own row 63 above, which quotes red-team's `'Closes #7, #000'` repro verbatim ... the disclosed Issue #154 comma-residual manifesting in real text one row up."* Row 63 is itself inside the diff-scope range that measurement covered. This is a real, already-occurred instance of a review artifact landing inside a diff and inflating that same diff's own residual count — direct evidence against the premise that narrowing the corpus to "just this PR's diff" would dodge the self-referential-growth problem.

**The known dormant bug that a diff-scoped instrument would activate.** `src/qa/marker-corpus-probe.ts:107/114/121` (code-traced, still present, unfixed — red-team round-3 finding 7, LOW, never actioned):

```
const ref = argv.find((a) => !a.startsWith("--")) ?? "HEAD";
...
const resolved = await resolveChangedFiles(git, "0000000000000000000000000000000000000000", ref);
...
fileTexts.set(file, await readFile(file, "utf8"));   // <-- ALWAYS reads the WORKING TREE
```

Passing any non-`HEAD` `ref` selects the **file list** from that ref but always reads **content** from the current working tree — a number describing a tree state that never existed, precisely the defect class this whole story exists to eliminate. Today this path is dormant (every live marker uses the default `HEAD`). Any design that diff-scopes this probe by feeding it a non-HEAD `ref` argument exercises this exact bug for the first time.

**False-positive check on a plausible cheap guard (a candidate I derived and priced, then rejected on evidence):**

```
$ grep -noE '[0-9]+/[0-9]+' CHANGELOG.md docs/STATE.md | wc -l
112
```

112 `N/M`-shaped numbers already live in the two QA-15-scanned files, the overwhelming majority legitimate test-count reporting (`708/708 pass`, `430/456`, `17/17`). A blanket `\d+/\d+` addition to `BARE_CLAIM_PHRASES` would false-positive on essentially all of them — not a viable guard as a blanket pattern. Reported as a negative result, not a candidate.

---

## Candidate A — Build a real `--field`-style instrument for #154's residual, no blocking marker

**Classification: seam.** Crosses from `reference-resolver.ts`'s pure classification core into a new consumer (a probe/instrument) and into `completeness-claim-checker.ts`'s `KNOWN_INSTRUMENTS` allowlist — a different module boundary sees new behavior, even though nothing blocks on it.

**Upstream — who feeds this?** The instrument's only real input is `classifyBareHashMatch`'s output shape. Enumerated mechanically:

```
$ grep -rn "classifyBareHashMatch\|BareHashClassification" src/qa/*.ts
src/qa/reference-resolver.ts:300  type BareHashClassification = "already-recorded" | "marked" | "unmarked";
src/qa/reference-resolver.ts:331  function classifyBareHashMatch(...)
```

One producer, one file. **But it does not currently distinguish *why* something is "marked"** — a same-line marker word and a list-continuation inheritance both collapse to `"marked"`. To report "continuation-marked" as its own number (the actual quantity every prior round's manual measurement targeted), `classifyBareHashMatch`'s return type needs a 4th value or an out-parameter — a production change to the one file this story has now run four CRITICAL-tier adversarial rounds against. That is the hidden second half of this candidate: it is not additive-only the way #150's `--field` fields were (those read an already-existing `kind`/`raw` shape with zero core-logic change).

**Downstream — who consumes this?** Mechanical enumeration of `KNOWN_INSTRUMENTS` consumers and the probe's own consumers:

```
$ grep -rln "KNOWN_INSTRUMENTS\|qa14-marker-corpus-probe\|marker-corpus-probe" --include="*.ts" --include="*.mjs" --include="*.yml" --include="*.md" | grep -v node_modules
CHANGELOG.md, docs/backlog.md, docs/decisions.md, docs/reviews/*.md (historical, read-only),
docs/REVIEW_LOG.md, docs/STATE.md,
src/qa/completeness-claim-checker.test.ts, src/qa/completeness-claim-checker.ts,
src/qa/marker-corpus-probe.test.ts, src/qa/marker-corpus-probe.ts,
src/qa/runtime-settings-drift-check.ts
```

`.github/workflows/ci.yml` is **not** in this list — confirmed separately (`grep -n "reference-resolver\|completeness-claim-checker\|marker-corpus-probe" .github/workflows/ci.yml` returns only the two unconditional QA-14/QA-15 steps, no new step for this probe). So the only real downstream consumer of a new field is a human running it on demand, plus `completeness-claim-checker.ts`'s allowlist (safe to extend — it's an allowlist by design, additions are a reviewed code change per its own header comment) and `src/qa/runtime-settings-drift-check.ts`, which I checked: it does not reference `marker-corpus-probe` by name, it showed up only because it imports something adjacent — not a real coupling to this specific field.

**The numerator problem (not in the framing question, found by tracing the actual consumer need).** What every prior round's manual measurement actually reported is not "how many bare `#N` are continuation-marked" (a pure, sync count — cheap, safe) but "how many of those are *false* — a real `gh` non-existence" (the blocking-leak count, the number people actually want). Getting that requires live, credentialed `gh issue view` calls. `marker-corpus-probe.ts`'s `stubDeps.issueExists: () => null` is **deliberately** a no-op today (its own header comment: *"no real `gh` call, no network, no credential"*) — building the leak-count field walks that design decision back. Two ways to do it, both with a real cost:
- A second, bespoke `gh`-calling path inside the probe, bypassing `resolveIssueCitations`'s existing `QA14_MAX_ISSUES` cap and dedup — **this is exactly the "bespoke apparatus, built and thrown away" pattern red-team named as the round-2/round-3/round-4 recurring cost**, now made permanent in committed code instead of a throwaway measurement script.
- Reuse `resolveIssueCitations`/`checkIssueViaGh` for real — safer (keeps the rate-limit cap), but touches the two-pass wiring the original Phase 1 plan explicitly declared a **hard scope boundary** ("`resolveIssueCitations`'s two-pass wiring ... structurally untouched") — a second CRITICAL-tier round now proposes crossing a boundary the first round drew on purpose.

**Invariant delta.** Before: no numeric claim about this residual lives in a machine-checkable form anywhere. After: one exists, on-demand, non-blocking. What is newly true and who now depends on it: nobody is forced to depend on it (no blocking marker per the framing), but once it exists, prose in `CHANGELOG.md`/`STATE.md` will very likely start citing its output as if it were live-verified — the same drift-by-habit pattern that turned #150's informational fields into a blocking gate in round 2 without anyone deciding to add ceremony, they just wired it in because the number was sitting right there.

**Whack-a-mole verdict.** Defect class: **an exact numeric claim, hand-typed into a permanently-rescanned file, goes stale before or shortly after it ships.** Prior fix attempts on this exact class, on this exact residual: **≥3** (round 1's `0/316`, round 2's `10/400`, round 3's de-hardcoding attempt that both left one location live and fabricated a verification sentence) — well past the 2+ threshold that makes this a structural finding regardless of what round 5 does.

**Verdict: RELOCATES**, conditionally. Building the field cleanly (denominator only, reusing the existing wiring for any numerator) removes today's two live falsehoods and gives future rounds a real, callable answer — genuine progress, the same kind #150 got. But nothing stops the next fix-now round from typing a fresh "N of M" sentence into `CHANGELOG.md` right next to the new field's output (nothing in `BARE_CLAIM_PHRASES` catches the `N/M` slash shape that broke round 1/2 — see the 112-hit false-positive measurement above, which is why extending that heuristic isn't a free win either). The class moves from "the number is wrong" to "the number is right but nothing stops someone writing a *different*, wrong number next to it" — same root cause, new location for the same failure to recur.

**Ledger:**
```
Fix A: touches ~5-6 files (reference-resolver.ts core type change, marker-corpus-probe.ts + .test.ts,
completeness-claim-checker.ts allowlist, 4 permanently-scanned prose locations) / ~2-4 call sites
· new preconditions: 0 blocking (explicit), but 1 soft precondition if it reuses gh — `gh` CLI +
credentials available to get the "real" numerator locally, a dependency #150's fields never had
· migration: no · reversible: yes (pure addition/revert)
· exposure if wrong ~unmeasured (no CI consumer, non-blocking by design) — basis: assumption
· residual if NOT fixed ~25% of the 4 named locations still stale today (demonstrated, matches
  red-team round-4 finding 1 exactly), 100% of readers of that one CHANGELOG.md bullet see a wrong
  number (demonstrated)
```

**Verdict: PATCH-WITH-CONDITIONS** — only if scoped to the denominator (continuation-marked count, pure/sync, genuinely mirrors #150) and the numerator is answered by *reusing*, not duplicating, `resolveIssueCitations`'s capped gh path, with the scope-boundary exception logged explicitly rather than silently crossed.

---

## Candidate B — Same as A, scoped to the diff only

**Classification: seam**, same boundary as A, plus a second new boundary: whichever mechanism selects "this PR's own changed range" (git diff refs) now has to be wired into the probe, which today only knows how to do a full-tree scan.

**Upstream.** Same one producer (`classifyBareHashMatch`) as Candidate A — no difference there.

**Downstream — the demonstrated self-pollution.** Already shown above, from the existing historical record, not hypothesized: `docs/decisions.md` row 64's own measurement shows a review-report file landing inside a diff range inflated that same diff's own residual count (the `#000` inside row 63). Diff-scoping shrinks the *absolute* denominator (fewer files → fewer bare `#N`s) but does not remove the review-report-in-the-diff mechanism that keeps polluting it — if anything, a smaller denominator makes the same absolute pollution swing a *larger* percentage, which is precisely what round-4 finding 6 flagged as the residual's fragility ("single-digit percent... unfalsifiable tomorrow").

**Also downstream: the dormant bug.** `marker-corpus-probe.ts:107/114/121` (quoted above, code-traced) reads content from the working tree regardless of the `ref` argument passed. Candidate B's entire mechanism — "scope to the diff" — requires driving this probe (or a close variant of it) with a non-`HEAD` ref, which is precisely the path that bug lives on and which nothing in this repo has ever exercised. Building Candidate B on top of the existing probe either ships a number that lies about which tree state it describes (the exact defect class under discussion, reproduced by the fix meant to end it) or requires writing a *third* separate ref/diff-content-reading implementation (`reference-resolver.ts`'s `main()` already has one correct one via `readFile` against files named by `resolveChangedFiles`'s real diff mode; `marker-corpus-probe.ts` has a second, broken one) — more duplicated scanning machinery in a file this project's own dogfood mandate (QA-16, "no hand-derived completeness claims") explicitly argues against multiplying.

**Invariant delta.** Before: "the residual's size" is undefined for any given commit. After (if built naively on the existing `ref` argument): "the residual's size for this diff" is defined but silently wrong for any ref other than `HEAD` — a **new** false-numeric-claim source, not a narrower true one. After (if built correctly, with fresh ref-aware content reading): defined and correct, at the cost of a third duplicate scanning path.

**Whack-a-mole verdict.** Same defect class as A. **Verdict: WIDENS** if built on the existing `ref` mechanism (activates a known, currently-harmless bug and makes it load-bearing) — this is not a hypothetical, it's the direct, necessary consequence of the code as it stands today. **RELOCATES at best** if built correctly from scratch — same conditional-progress argument as A, at strictly higher cost for a metric (per-diff residual size) that doesn't even match what the 4 permanently-scanned files are claiming: they describe a durable property of the codebase in general ("real, non-zero, small, fails loud"), not a property of any one PR's diff. Scoping the *instrument* to the diff answers a question those files were never asking.

**Ledger:**
```
Fix B: touches ~6-7 files (Candidate A's set + new ref/diff-content wiring, either reused-buggy or
freshly built) / ~3-5 call sites · new preconditions: 0 blocking, but activates a currently-dormant
LOW defect (finding 7, code-traced, still open) the moment it's used with a non-HEAD ref
· migration: no · reversible: yes
· exposure if wrong ~100% of invocations with a non-default ref, if built on the existing mechanism
  (basis: code-traced — the bug is unconditional, not probabilistic)
· residual if NOT fixed: identical to Candidate A's (same 2 live locations today)
```

**Verdict: WIDENS** as literally specified ("mirroring `marker-corpus-probe.ts`'s pattern") because that pattern's ref-handling is itself broken; **PATCH-WITH-CONDITIONS at best**, and only by not reusing the existing `ref` mechanism — which then makes it strictly more expensive than Candidate A for a narrower, arguably wrong-shaped answer.

---

## Candidate C — Ship as-is, corrected: finish the qualitative de-hardcoding this round, no new instrument

**Classification: local.** Touches only prose in the 1 remaining stale location (`CHANGELOG.md:15`) plus, optionally, a corrective note appended (never edited) after `docs/decisions.md` row 68. No code, no new module boundary, no new consumer.

**Upstream.** N/A — this is a documentation correction, not a mechanism change. The "producer" of the stale text is the round-3 build's own prose-writing process, already identified.

**Downstream — who consumes this?** The same 4 locations already enumerated above, mechanically (`grep -n "residual\|#154" CHANGELOG.md docs/STATE.md`, `src/qa/reference-resolver.ts`/`.test.ts` read in full). All 4 are read by: any future contributor reading `CHANGELOG.md`/`docs/STATE.md`/the source comments, and QA-15 itself (`DEFAULT_FILES = ["docs/STATE.md", "CHANGELOG.md"]`, confirmed by reading `completeness-claim-checker.ts:213` directly) — which, importantly, **already partially guards this class**: its `BARE_CLAIM_PHRASES` heuristic demonstrably reddens on `\d+ of \d+` and `all/every \d+` shapes in exactly these two files (round-4 finding 6's own drill, reproduced in spirit by my 112-hit grep above). It does **not** catch the `N/M` slash shape that actually broke rounds 1-2 (`10/400`) — a real, measured coverage gap in the project's own existing mechanical guard, not a new one this candidate would introduce.

**Invariant delta.** Before: 1 of 4 locations lies; 1 sentence in an unfixable append-only row lies permanently. After: 0 of 4 live-editable locations lie; the append-only row is still permanently wrong (out of scope for every candidate, as established above). What was true before that's no longer true: nothing structural — the same hand-authorship process that produced the current 2 live falsehoods remains fully intact and will produce the next one under the same conditions, with nothing new to catch it.

**Whack-a-mole verdict.** Same defect class, ≥3 prior fix attempts (structural finding, independent of this round's outcome). This is literally the fourth attempt at the "fix the prose" move — the same move that failed at round 1 (fabricated `0/316`), round 2 (`10/400`, stale on arrival), and round 3 (incomplete sweep + a fabricated evidence sentence). **Verdict: RELOCATES**, most directly — it is the shape red-team explicitly warned about: *"removing the number removes the evidence of the problem, not the problem."* The one thing that changes this round versus rounds 1-3 is *how* the sweep is done — if genuinely run as a mechanical grep against all 4 named locations (as I did above, not re-typed from memory) rather than hand-checked, it should actually be complete this time, which is real, if narrow, progress.

**Ledger:**
```
Fix C: touches 1 file (CHANGELOG.md:15) / 1 call site · new preconditions: 0
· migration: no · reversible: yes (trivially, it's prose)
· exposure if wrong ~unmeasured for a 5th miss — basis: assumption, informed by a 3-for-3 prior-miss
  rate on this exact sweep (finding 1's own point: round 3 also claimed "every ... location" and
  was wrong) · residual if NOT fixed ~25% of locations stale today / 100% of that bullet's readers
  see a wrong number (both demonstrated, same figures as A/B)
```

**Verdict: SAFE-TO-PATCH** for what it actually is — a same-day, near-zero-cost correction of two live falsehoods — **but it does not answer the council's framing question** ("should this get machine-verifiable treatment") and should not be presented as if it did. It is the right *immediate* action regardless of which structural path the council picks next, since it is a strict subset of every other candidate's own prose cleanup step.

---

## Candidate D (derived, checked, and rejected) — extend `BARE_CLAIM_PHRASES` to catch the `N/M` shape

I looked for a cheap, generic, mechanical guard before pricing the two expensive instrument-building paths, since CLAUDE.md's hard rule prefers a mechanical guard over both hand-editing prose and building bespoke apparatus. Measured directly (see baseline section): **112 existing `N/M`-shaped numbers in the two QA-15-scanned files**, the overwhelming majority legitimate (`708/708 pass`, `17/17`). A blanket `\d+/\d+` pattern added to `BARE_CLAIM_PHRASES` would false-positive on essentially every test-count sentence this project already writes, turning QA-15 into exactly the "rubber-stamp reflex" generator red-team's own round-3 report warned against for #150's markers. A narrower pattern (anchored to "residual"/"continuation" nearby) is fragile and overfit to this one instance — functionally equivalent to hardcoding a phrase instead of a number, no more durable. **Rejected on evidence, not asserted** — reported here so the council doesn't have to re-derive and re-measure the same dead end.

---

## Structural findings (defect classes fixed 2+ times — binding regardless of which candidate ships)

1. **"An exact numeric claim, hand-typed into a permanently-rescanned file, goes stale."** Fixed/attempted ≥3 times on this one residual alone (rounds 1, 2, 3), plus once already on the sibling #150 corpus-stats claim (which itself then had to be *un-fixed* in round 3 when the blocking marker it grew turned into a ~50%-of-commits false-red generator, per red-team round-3 finding 2 — measured, not asserted, in that report). **The guard this needs is not a smarter regex and not a third scanning mechanism** — it's a place for a *durable, point-in-time* number (which this project already has and already uses correctly: dated `docs/reviews/` reports, explicitly exempted from `DEFAULT_FILES` for exactly this reason) versus a place for a *forward-read* qualitative claim (which `CHANGELOG.md`/`STATE.md`/source comments are). The actual guard already exists in the codebase's own convention (`completeness-claim-checker.ts:198-209`'s reasoning for excluding `docs/decisions.md`) — it has just never been generalized into a rule the other three files follow consistently, and nothing mechanical enforces the distinction on `CHANGELOG.md`/`STATE.md`/source comments the way `DEFAULT_FILES`'s membership enforces it for `docs/decisions.md`.
2. **`docs/decisions.md`'s append-only convention silently converts a mistake into a permanent artifact.** Row 68's fabricated evidence sentence cannot be fixed by any candidate above — worth the council naming explicitly rather than letting it sit as an unowned gap, since a future auditor reading that row cold has no signal it's wrong without cross-referencing this report or red-team round-4's.

## Unmeasured

- Exposure of a wrong on-demand instrument output (Candidates A/B) if a human runs it and trusts it without re-verifying — no CI consumer exists to force a number, so this is genuinely a `assumption`-basis figure; the command that would measure it doesn't exist because the instrument doesn't exist yet.
- How many future rounds would actually recur under Candidate C alone — historical rate is 3-for-3 misses on this exact sweep shape, but that's a small sample; no instrument exists to project a 5th-round probability better than the historical count already presented.
- Real `gh` API cost/latency of a numerator-producing instrument if Candidate A/B reuses `resolveIssueCitations` — not measured here (would require actually building and timing it); `checkIssueViaGh`'s existing 30s per-call timeout and `QA14_MAX_ISSUES=300` cap are the only real numbers on record for this class of call.

## Recommended path

**Candidate C now (finish the mechanical sweep, ship this round), Candidate A's *denominator-only* half as a deliberately separate, lower-ceremony follow-up — not gating this round's close-out.** Reasoning in one sentence: the blast radius here is, by red-team's own repeated and independently-reproduced assessment, documentation-only, non-security, fully reversible, and this story has already spent 4 CRITICAL-tier adversarial rounds on it — PRINCIPLES rule 16's "ceremony without a corresponding safety gain" warning, which the Manager already invoked once on this exact file for a related finding, applies with more force here than it did then.

**Strongest argument against this recommendation:** red-team's own "scariest unproven assumption" is specifically that Candidate C's move ("stop writing the number down") only looks like it closes the class — the underlying hand-authorship process is untouched, and this project's own track record (3 straight misses on the same sweep) says a 4th, careful pass is not obviously more reliable than the first three were when they also believed themselves careful. If the council weighs *process trust* over *measured blast radius*, Candidate A's denominator field is the better bet than another round of prose promises, and this report's job is only to price that trade-off honestly, not resolve it.

## Editorial

None beyond what's already folded into the analysis above — no prose-only defects found in the materials I read that weren't already load-bearing findings.

---

```
RECEIPT: verdict=PATCH-WITH-CONDITIONS
candidates (ALL of them, ranked by risk):
1. [ISSUE][MED][code-traced][~100% of non-default-ref invocations] Candidate B (diff-scoped instrument, built on marker-corpus-probe.ts's existing ref mechanism) — activates a known, currently-dormant ref-content bug (probe.ts:107/114/121, content always read from the working tree regardless of ref), producing a number for a tree state that never existed — the exact defect class this story exists to eliminate, reproduced by the fix meant to end it. WIDENS as literally specified.
2. [SUSPICION][MED][derived][~25% of 4 named locations, demonstrated baseline] Candidate A (build a `--field`-style instrument, no blocking marker) — the denominator (continuation-marked count) is cheap and safe, genuinely mirrors #150; the numerator (blocking-leak count) requires either a second bespoke gh-calling path (bypasses the existing QA14_MAX_ISSUES cap — WIDENS) or reuse of resolveIssueCitations (crosses a scope boundary the original Phase 1 plan explicitly drew — RELOCATES at best). Verdict depends entirely on which half the council picks.
3. [SUSPICION][LOW][code-traced][~higher cost than A for a narrower answer] Candidate B, if built correctly (fresh ref-aware content reading instead of reusing the buggy mechanism) — RELOCATES, not WIDENS, but is a third duplicate scanning implementation in a file this project's own QA-16 doctrine argues against multiplying, and answers a per-diff question the 4 permanently-scanned files were never asking.
4. [CLEAN][demonstrated][25% of locations stale today, 100% of that bullet's readers] Candidate C (finish the mechanical sweep, no new instrument) — cheapest, lowest-risk, strictly necessary regardless of which other candidate ships; does not by itself close the recurring class (RELOCATES), but is not asked to.
5. [CLEAN][demonstrated][112 false-positive hits measured] Candidate D (derived: extend BARE_CLAIM_PHRASES with a blanket N/M pattern) — checked and rejected on direct measurement before being proposed to the council; not a live option.
counts (CHECKSUM): issues=1 suspicions=2 clean=2
evidence (CHECKSUM): demonstrated=2 code-traced=2 derived=1
traced: upstream=1 producer (classifyBareHashMatch) · downstream=8 consumer files (KNOWN_INSTRUMENTS/probe grep) + 4 permanently-scanned prose locations · structural=2 classes fixed 2+ times (numeric-claim-drift on this residual ≥3x; the sibling #150-marker-became-a-false-red-generator class, 1x on this same story)
recommended=C-now-plus-A-denominator-as-followup unmeasured=3
checks=node src/qa/marker-corpus-probe.ts -> PASS marked=445 unmarked=474 total=919 (222 files); node src/qa/completeness-claim-checker.ts -> PASS 2 files, all claims verified; grep -n "residual|#154" CHANGELOG.md docs/STATE.md -> 1 of 4 locations still live-stale (CHANGELOG.md:15); grep -c "N/M shape" CHANGELOG.md+STATE.md -> 112; git status -> 3 files pre-existing-modified by a concurrent agent, not touched by me, 0 files touched by me
adr=NONE(0) — no ADR governs QA-instrument internals per the Phase 1 plan's own ADR pass (re-confirmed by reading adrCatalog scope, not re-scanned independently this pass)
report=docs/reviews/qa14-marker-redesign-impact-analyst-2026-09-11.md
```
