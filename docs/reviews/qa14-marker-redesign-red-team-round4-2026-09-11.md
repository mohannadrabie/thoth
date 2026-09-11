# Red Team (Sutekh) — `qa14-marker-redesign` ROUND 4 targeted re-confirm

- **Date:** 2026-09-11
- **Scope:** branch `fix/qa14-marker-redesign` @ `a26e55a`, repo `mohannadrabie/thoth`
- **Tier:** CRITICAL (7th consecutive red-team round against `src/qa/reference-resolver.ts`)
- **Mandate:** confirm the round-3 STRUCTURAL fix (Issues #154 / #155 / #156 + 2 LOWs) actually closes the numeric-claim-drift class, or find a live recurrence.
- **Escalation constraint in force** (`docs/decisions.md`, 2026-09-11 round-3 triage row): a NEW instance of the drift class this round routes to `/maat:council`, not a round 5.
- **ADR cache:** `📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ≈17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`

## Verdict

**no-go — the drift class is NOT closed. This is a LIVE RECURRENCE, demonstrated twice.**

The structural fix is *largely real and I endorse its direction*: the three drifting `[[completeness:]]` markers are genuinely gone, QA-15 genuinely survives a corpus-growing commit, and the #156 mutation is genuinely caught. But this round's own prose shipped **two new false numeric claims into `CHANGELOG.md`**, a permanently-rescanned file — the exact class it set out to end — and one of them is the "matches no tree state that ever existed" sub-shape the Manager itself named for `decisions.md` row 66.

No `[HIGH]` is carried: blast radius is documentation-only, non-security, non-data, fully reversible. The `no-go` is not a safety call — it is the honest answer to the one question the Manager asked me to settle, and the Manager's own logged constraint keys on it.

## File-state integrity

Every mutation was confined to detached `git worktree`s (`wt-r4` @ `a26e55a`, `wt-r2`/`wt-r3` @ `4896420`). The primary tree was md5-pinned before and after; all seven pins identical, tree clean, `HEAD` unchanged.

```
fa218498f09842d30d63c24de574483b *src/qa/reference-resolver.ts
67aedd76563f3151b4828461032c13fb *src/qa/reference-resolver.test.ts
7df488422be51cdd3a0e2abebcd386ed *src/qa/marker-corpus-probe.ts
af349a5825f0661e1889907c07a23fb1 *src/qa/marker-corpus-probe.test.ts
82a2f11dedef52ab340304985f97c3b4 *src/qa/completeness-claim-checker.ts
e05a05322c28ebb130b2317601a0331e *CHANGELOG.md
a977cee7fdca135d8881493750fce008 *docs/STATE.md
git status --porcelain | wc -l  ->  0
git rev-parse HEAD              ->  a26e55ad0e34c2ee4bd681bad944ae1aa24598ae
```

> Worktree caveat, disclosed: the `adr/` submodule is not populated in a detached worktree, so one dogfood test (`QA-14 (dogfood): this checker's own source ... resolves clean`) fails there on a missing `ADR-0021`. That failure is a worktree artifact, not a defect, and is excluded from mutation analysis. The full-suite run below was executed in the primary tree.

---

## Attacks, ranked by blast radius

### 1. [ISSUE][MED][demonstrated] `CHANGELOG.md:15` still carries a LIVE, uncorrected, stale frozen count of the #154 residual — the round's "every permanently-scanned location" claim is false

**Exposure: 1 of the 4 named permanently-scanned locations for this residual (25%) still freezes an exact figure; 100% of readers of `CHANGELOG.md`'s R4 bullet see a wrong number. Basis: counted-in-code (grep over `git ls-tree HEAD`).**

**Scenario.** A future maintainer reads `CHANGELOG.md` top-down looking for the size of the comma-continuation residual. Line 46 (the round-2 entry) now says "run the live command". Line 15 (the round-1 R4 bullet) — the *same file*, 31 lines earlier — states a hard number as a **bold, non-struck correction**:

```
CHANGELOG.md:15
... remain open, disclosed, measured residuals (~~0/316 real-corpus incidence~~
**CORRECTED 2026-09-11 round-2 fix-now, Issue #154 — see below, that "0" was itself false:
10/400 real occurrences, 5 distinct blocking gate failures**).
```

The struck `0/316` was corrected. Its replacement, `10/400 real occurrences, 5 distinct blocking gate failures`, was **not** struck, **not** corrected, and is **stale**.

**My own independent measurement at `a26e55a`** (2-line-instrumented copy of the shipped `classifyBareHashMatch`, full `git ls-tree -r HEAD` enumeration, real `gh issue view` existence checks — 89 distinct numbers):

```
continuation-marked occurrences: 427
distinct (file,#N) pairs: 293
distinct numbers to existence-check: 89
numbers that DO NOT exist as real issues: 2 -> 000 9999
=> BLOCKING residual (file,#N) pairs: 6
     docs/REVIEW_LOG.md::#000
     docs/REVIEW_LOG.md::#9999
     docs/decisions.md::#000
     docs/reviews/qa14-marker-redesign-red-team-2026-09-11.md::#000
     docs/reviews/qa14-marker-redesign-red-team-2026-09-11.md::#9999
     docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md::#9999
=> residual as % of continuation-marked occurrences: 1.41%
```

Published on line 15: `10/400`, `5` blocking. Measured at HEAD: `6` blocking of `427`. Both numbers wrong.

**Current defense, honestly assessed.** None. The round-3 build scoped its de-hardcoding to "this file's **round-2 entry** above" (`CHANGELOG.md` round-3 entry, verbatim) and to `reference-resolver.ts` / `.test.ts` / `docs/STATE.md`. The round-1 R4 bullet on line 15 was never in scope and was never grepped for. The build row in `docs/decisions.md` and the CHANGELOG round-3 entry both nonetheless assert *"every permanently-scanned location that froze an exact 'N of M' figure ... now states the residual qualitatively"* — a hand-derived completeness claim, false, inside the story whose purpose is eliminating hand-derived completeness claims on this exact file. CLAUDE.md hard rule, "No hand-derived completeness claims", violated.

**Verdict: BREAKS.** This is a live instance of the drift class.

**Named proof-test required before merge:** `qa14: no frozen exact residual count survives in any permanently-scanned file` — a committed instrument (not a grep typed into a report) that enumerates `CHANGELOG.md`, `docs/STATE.md`, `src/qa/reference-resolver.ts`, `src/qa/reference-resolver.test.ts` and fails on any non-struck `\d+/\d+` or `\d+ of \d+` figure attributed to the comma-continuation residual. Without an instrument, round 5 will miss a 5th location the same way round 3 missed this one.

---

### 2. [ISSUE][MED][demonstrated] The round-3 entry's load-bearing evidence sentence is unreproducible — QA-15 **PASSES** at `4896420`, and the cited triple `434/455/889` matches no tree state that ever existed

**Exposure: 1 of 1 evidence sentences justifying the round's central structural decision. Basis: measured (5 distinct tree states enumerated in pristine detached worktrees).**

**Scenario.** A council or auditor re-opens `CHANGELOG.md` to check whether removing the three markers was justified. The round-3 verification paragraph says:

```
Confirmed the fix actually closes the drift hole, not just re-passes today: at this round's own
starting commit (4896420), node src/qa/completeness-claim-checker.ts was already FAILING — the
corpus had moved since round 2 shipped (marked=434 unmarked=455 total=889 vs. the published
430/456/886) — proving the structural problem was live, not hypothetical, before this round
touched anything
```

I reproduced `4896420` in a pristine detached worktree and ran the exact command:

```
$ git worktree add --detach .../wt-r2 4896420
HEAD is now at 4896420 fix(qa14-marker-redesign): round 2 fix-now — correct #154/#150 close-out claims, wire probe to QA-15
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
EXIT=0
$ node src/qa/marker-corpus-probe.ts
[QA-14 marker-corpus-probe] PASS: marked=430 unmarked=456 total=886 — approx 51% ... (220 files scanned)
```

**QA-15 PASSES at `4896420`, and the probe reports exactly the published `430/456/886`.** The headline claim is directly falsified.

I then enumerated every plausible tree state around that commit, to be fair to the build:

| tree state at/around `4896420` | probe | QA-15 |
|---|---|---|
| clean checkout | `430/456/886` | PASS |
| + round-3 review reports present but **untracked** | `430/456/886` | PASS |
| + red-team round-3 report committed | `432/460/892` | — |
| + cross-domain round-3 report committed | `433/469/902` | — |
| + **both** round-3 reports committed | `435/473/908` | **FAIL** (all 3 markers) |
| **claimed in `CHANGELOG.md`** | **`434/455/889`** | **claimed FAIL** |

The claimed triple appears in none of them. It is also internally impossible for the story it tells: `unmarked=455` is **below** the clean-checkout baseline of `456`, and every state in that progression is purely additive.

**Current defense, honestly assessed.** None — and note this is the *second* reviewer-caught instance of this specific sub-shape on this story, after `decisions.md` row 66's `422/434/856`. The pattern is not "the last measurement went stale"; it is "a number was typed that was never measured."

**In fairness, the conclusion the sentence supports is sound, and I proved it myself:** committing the two round-3 review reports on top of `4896420` reddens all three markers for real —

```
[QA-15 completeness-claim-checker] FAIL: 1 of 2 file(s) had a failing completeness claim.
  - CHANGELOG.md: 3 of 4 numeric completeness claim(s) failed.
  -   MISMATCH: claim says 430, instrument "qa14-marker-corpus-probe-marked" re-run reports 435
  -   MISMATCH: claim says 456, instrument "qa14-marker-corpus-probe-unmarked" re-run reports 473
  -   MISMATCH: claim says 886, instrument "qa14-marker-corpus-probe-total" re-run reports 908
QA15_EXIT=1
```

So the marker removal was justified. Only the cited evidence is fabricated.

**Verdict: BREAKS.** Second live instance of the drift class.

**Named proof-test required before merge:** `qa14: every commit-attributed measurement in CHANGELOG.md reproduces at that commit` — or, minimum viable: correct the sentence to the reproducible facts (`4896420` clean passes at `430/456/886`; landing the two round-3 reports on it yields `435/473/908` and reddens all three markers), and state who measured what, when.

---

### 3. [ISSUE][MED][demonstrated] The replacement "run this for the live number" pointer does not produce that number — the residual now has **no instrument at all**

**Exposure: 100% of readers following the pointer in `reference-resolver.ts`, `reference-resolver.test.ts`, `CHANGELOG.md` and `docs/STATE.md` (4 of 4 de-hardcoded sites carry it). Basis: measured (ran the command).**

**Scenario.** The de-hardcoding replaced a frozen count with, verbatim (`src/qa/reference-resolver.ts`, STRUCTURAL NOTE):

```
the CURRENT count is whatever `node src/qa/reference-resolver.ts <base> <head>` (or the
full-tree form) reports right now — run it for the live number.
```

A reviewer in round 5 runs exactly that:

```
$ node src/qa/reference-resolver.ts c598312 HEAD
[QA-14 reference-resolver] FAIL: 43 of 1085 citation(s) failed to resolve; 180 more unclassified (non-blocking).
  - [unresolved-authority] Issue#0 — Issue #0 does not exist in this repository
  - [unresolved-authority] reference-resolver.ts:327 — reference-resolver.ts does not exist
  - [unresolved-authority] .claude/settings.local.json — path does not exist in this repository
  - [unparseable] ADR-NNNN — ADR id must be exactly ADR-#### (4 digits)
  - [cross-repo-issue] cli/cli#14417 — cites cli/cli, not this repository (mohannadrabie/thoth)
  - [unresolved-authority] #000 — Issue #0 does not exist in this repository
  - [unresolved-authority] #9999 — Issue #9999 does not exist in this repository
  ... (43 total, mixed path / ADR / cross-repo / issue failures)
```

The output is an undifferentiated blocking-failure list across *every* citation kind. It does **not** report the continuation-marked population, does **not** isolate the comma-continuation residual, and does **not** emit a percentage. To obtain the figure the comment promises, I had to build a 2-line-instrumented copy of the shipped classifier and drive 89 real `gh` existence checks — the same bespoke apparatus rounds 2 and 3 each built and threw away.

**Current defense, honestly assessed.** Weak, and arguably a net regression in verifiability. Round 2 at least published a reproducible figure. Round 3 removed the figure and pointed at a command that cannot produce it, leaving the residual with **zero** machine-checkable representation — while the project's own hard rule says: *"If no such instrument exists, building one is part of the task."* The cure was already shipped in this very story for Issue #150 (`marker-corpus-probe.ts --field=<name>`) and was not applied here. That asymmetry was named in the round-3 report and was not acted on.

**Verdict: BREAKS.** This is the structural weakness at the heart of the round: the claim did not stop being stale, it stopped being *checkable*.

**Named proof-test required before merge:** `qa14-continuation-residual-probe: --field=continuation-marked|blocking-residual emits ONLY that number` — a committed instrument on the `marker-corpus-probe` pattern, registered in `KNOWN_INSTRUMENTS`, with a shape test. Then the comments point at a command that actually answers the question. **Explicitly NOT wired to a blocking `expect=N` marker** — that is the round-3 lesson and it should hold.

---

### 4. [ISSUE][LOW][demonstrated] The Milestone-word-form list-continuation conflation is **not** 0 incidence, and one instance is a live blocking gate finding

**Exposure: 3 occurrences across 1 of 222 scanned files (0.45% of files); 1 produces a real blocking `unresolved-authority` in the live gate. Basis: measured.**

**Scenario.** The round-3 build states: *"Left the Milestone-word-form list-continuation conflation disclosed, not fixed (0 measured incidence, unchanged)."* Measured full-tree at `a26e55a`, excluding `*.test.ts` exactly as the gate does:

```
$ git ls-tree -r --name-only HEAD | grep -viE '\.test\.ts$' \
    | xargs grep -aoniE "Milestone[ \t]*#[0-9]+[ \t]*(,|/|&|and|[-–—])[ \t]*#[0-9]+"
docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md:237:Milestone #23, #24
docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md:240:Milestone #23, #9999
docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md:319:Milestone #23, #24
```

Incidence is 3, not 0. `classifyBareHashMatch` seeds `state.lastMarkedListEnd` on its `already-recorded` (`issue|milestone`) branch (`src/qa/reference-resolver.ts:335-338`), so `#24`/`#9999` inherit marked status and are classified as **issues**. `docs/reviews/qa14-marker-redesign-red-team-round2-2026-09-11.md::#9999` appears in my blocking-residual set in finding 1 — it is a live gate failure today, produced by this exact gap.

**Current defense, honestly assessed.** Partially fair. All three occurrences are red-team's own demonstration examples, not organic citations, so *"0 incidence in organic prose"* is defensible. *"0 measured incidence"* is not — and the incidence is self-referentially generated by this story's own review corpus, which is precisely the growth mechanism every other finding in this story turns on. The risk direction remains the safe one (loud block, never a silent resolve).

**Verdict: BREAKS (LOW).** The decision to leave it unfixed is still correct; the number attached to that decision is wrong.

**Named proof-test / fix:** restate as "0 organic incidence; 3 self-referential occurrences in this story's own review reports, 1 of which is a live blocking finding" — or register it in the finding 3 instrument.

---

### 5. [ISSUE][LOW][demonstrated] `--field` mode emitting the **wrong field's value** (right shape, wrong number) survives the entire suite

**Exposure: 1 uncovered mutation class on 1 CLI path; 0 CI consumers remain now that the markers are removed. Basis: measured (mutation applied, full suite run).**

**Scenario.** Mutation M2 in an isolated worktree — `summary: ${field}=${stats[field]}` -> `summary: ${field}=${stats.marked}`:

```
$ node src/qa/marker-corpus-probe.ts --field=total
[QA-14 marker-corpus-probe] PASS: total=443
$ node src/qa/marker-corpus-probe.ts --field=unmarked
[QA-14 marker-corpus-probe] PASS: unmarked=443
$ node --test
(only failure: the pre-existing missing-submodule dogfood artifact; 0 tests catch M2)
```

Every field now reports `marked`'s value, wearing the correct label. The round-3 shape test passes by construction — it asserts shape, deliberately, not value.

**Current defense, honestly assessed.** Adequate for now, and I do not think the round should have done more: shape-vs-value was the right trade given a value assertion is exactly what went stale. With the three markers removed, nothing in CI consumes the value, so a wrong value misleads a human reading on-demand output and nothing else. Worth stating rather than leaving implicit.

**Verdict: BREAKS (LOW).** Named test if the finding-3 instrument ships: `--field=<f> equals computeMarkerCorpusStats(...)[f] for all three fields` — a value assertion against the *pure function*, which cannot drift with the corpus.

---

### 6. [SUSPICION][LOW][demonstrated] "single-digit percent of the continuation-marked population, every measurement to date" is a forward-looking numeric bound with no instrument — the drift class survives in weaker form

**Exposure: 3 permanently-scanned files carry this bound (`reference-resolver.ts`, `CHANGELOG.md`, `docs/STATE.md`). Basis: measured today; future truth is unverifiable by construction.**

**Scenario.** The round replaced an exact count with a *bound*. Measured at `a26e55a`, the bound is currently **true and comfortably so** — 6/427 = **1.41%**. But it is a claim about a corpus that grows, with no registered instrument (finding 3) and no failing test if it becomes false. The residual's numerator is driven by fake `#000`/`#9999` tokens that *reviewers keep writing into review reports*; a future round that demonstrates more such shapes moves the numerator faster than the denominator.

It also sits awkwardly with the round's own reasoning. QA-15's `BARE_CLAIM_PHRASES` heuristic reddens on any `\d+ of \d+` prose in `CHANGELOG.md`/`docs/STATE.md` — demonstrated:

```
$ printf '\nQA-14 gate run: 43 of 1085 citation(s) failed to resolve.\n' >> CHANGELOG.md
$ node src/qa/completeness-claim-checker.ts
FAIL: NO INSTRUMENT REFERENCE: "QA-14 gate run: 43 of 1085 citation(s) failed to resolve." (line 415)
QA15_EXIT=1

$ printf '\n- Shipped 3 of 7 planned checks this round.\n' >> docs/STATE.md
$ node src/qa/completeness-claim-checker.ts
FAIL: NO INSTRUMENT REFERENCE: "- Shipped 3 of 7 planned checks this round." (line 292)
QA15_EXIT=1
```

That is QA-15 working exactly as designed — not a false red, and not a finding against this round. But it means "single-digit percent" is a phrasing that **evades the gate's detection without gaining any verification**. The drift pressure did not go away; it moved from "the number goes stale" to "the claim is no longer checkable at all."

**Verdict: UNPROVEN.** True today, structurally unfalsifiable going forward. Resolves to the finding-3 instrument, or to a residual-register line accepting an unverifiable bound with eyes open.

---

### 7. [CLEAN][demonstrated] Issue #155 — the three markers are genuinely gone, and QA-15 genuinely survives a corpus-growing commit

**(a) Markers actually deleted, not struck-through-but-still-parseable.** Checked with the shipped parser itself, not by eye:

```
=== CHANGELOG.md
 markers: [{"raw":"[[completeness: cmd=\"qa-mutation-shell\" expect=53]]","cmd":"qa-mutation-shell","expect":53}]
 bareClaims: 0 []
=== docs/STATE.md
 markers: []
 bareClaims: 0 []
```

Exactly one marker survives repo-wide, and it is not one of the three. The round-2 strikethrough text describes the removed markers as prose (`cmd="qa14-marker-corpus-probe-marked" expect=430`) with the `[[completeness: ...]]` brackets deleted — `MARKER_RE` requires the literal `[[completeness:` prefix, so it does not match. The build report's specific claim on this point holds.

```
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
EXIT=0
```

**(b) The real test — grow the corpus, confirm QA-15 does not redden.** Executed in the detached worktree: committed an unrelated doc adding 10 bare `#N` citations.

```
BEFORE: marked=443 unmarked=472 total=915 (222 files scanned)  | QA-15 PASS exit 0
$ git commit -m "drill: unrelated commit that grows the bare-#N corpus"
AFTER : marked=444 unmarked=481 total=925 (223 files scanned)  | QA-15 PASS exit 0
```

The corpus moved on all three fields. QA-15 stayed green. Under round-2's state the equivalent commit reddened all three (finding 2's table). **The structural fix is real and it works.**

**(c) Was removing all three an overcorrection? My honest assessment: no.** I looked for the value that was lost and could not find much:
- The three `KNOWN_INSTRUMENTS` entries remain, real and callable (`node src/qa/marker-corpus-probe.ts --field=<name>` verified working).
- Nothing polices unreferenced allowlist entries — `npm run qa:broken-instrument-gate` -> `VACUOUS-PASS: 0 known-broken instruments registered`. No gate broke.
- The assertion itself had no invariant behind it. The only way to fix a red was to overwrite `expect=N` with today's number, which is a gate that can never fail meaningfully — ceremony with no safety gain, PRINCIPLES rule 16's own warning.

The one real cost is that nothing in CI now exercises the probe end-to-end; its correctness rests on unit tests. Given the alternative was a false-red generator on roughly half of all commits, that is the right trade. The reasoning in the build report (contrasting `qa-mutation-shell`'s version-controlled-source corpus against a whole-tree doc scan) is sound and I verified the distinction holds.

**Verdict: SURVIVES.**

---

### 8. [CLEAN][demonstrated] Issue #156 — the shape-based test genuinely catches the exact mutation that stayed green in round 2

Reproduced mutation M1 myself rather than trusting the claim. In the detached worktree, `const field = parseMarkerCorpusField(argv);` -> parse still called, emission suppressed:

```
  parseMarkerCorpusField(argv);
  const field: MarkerCorpusField | null = null; // RED-TEAM M1 MUTATION
```

```
BASELINE (unmutated): tests 9 | pass 9 | fail 0 | skipped 0

UNDER M1:
$ node src/qa/marker-corpus-probe.ts --field=total
[QA-14 marker-corpus-probe] PASS: marked=443 unmarked=472 total=915 — approx 52% ... (222 files scanned)

$ node --test src/qa/marker-corpus-probe.test.ts
tests 9 | pass 8 | fail 1 | skipped 0
  AssertionError [ERR_ASSERTION]
    expected: /marked=\d+ unmarked=\d+/
    operator: 'doesNotMatch'
    actual: "[QA-14 marker-corpus-probe] PASS: marked=443 unmarked=472 total=915 ..."
```

The failing test is exactly the new Issue #156 shape test. Reverted; md5 restored to `7df488422be51cdd3a0e2abebcd386ed`. Choosing shape over value was the correct design — a value assertion is precisely what kept going stale.

**Verdict: SURVIVES.**

---

### 9. [CLEAN][demonstrated] The #154 qualitative claim's *substance* is honest — real, non-zero, single-digit percent, and it fails LOUD

Re-verified with my own measurement rather than reading the prose for plausibility (finding 1's measurement block):

| qualitative claim | measured at `a26e55a` | honest? |
|---|---|---|
| real and non-zero | 6 blocking (file,#N) pairs | yes |
| small / single-digit percent of the continuation-marked population | 6/427 = **1.41%** | yes |
| fails LOUD, never silent | see below | yes |

"Fails loud" confirmed against the real shipped gate, not from code reading alone — the residual tokens surface as blocking `unresolved-authority` findings and the gate exits non-zero:

```
$ node src/qa/reference-resolver.ts c598312 HEAD
[QA-14 reference-resolver] FAIL: 43 of 1085 citation(s) failed to resolve; 180 more unclassified (non-blocking).
  - [unresolved-authority] #000 — Issue #0 does not exist in this repository
  - [unresolved-authority] #9999 — Issue #9999 does not exist in this repository
$ echo $?
1
```

No silent false-resolve path found. The no-code-fix rationale (a word list reintroduces the denylist failure mode; dropping comma continuation silently un-verifies every genuine comma-joined list) remains sound and I endorse it for the fourth round running.

**Verdict: SURVIVES** — the substance is honest. What is wrong is the bookkeeping around it (findings 1, 3, 6).

---

### 10. [CLEAN][demonstrated] The "% of bare #N occurrences" relabel is correct, and leaving the computation alone was the right call

`computeMarkerCorpusStats` (`src/qa/marker-corpus-probe.ts:87-101`) iterates `scanReferences(text, ...)` per file, and `scanReferences` dedupes per file on the raw string — so it counts distinct `(file, raw)` pairs. The new label, "distinct per-file bare #N citations", matches what is computed. The accompanying comment's claim that "raw occurrences run materially higher than this distinct-pair total" is directionally confirmed by my own instrumentation: within the continuation-marked subset alone, **427 occurrences vs 293 distinct pairs**.

Changing the label rather than the computation was right — the distinct-pair count is what the shipped QA-14 classifier treats as one citation event, so the instrument and the gate now describe the same population.

**Verdict: SURVIVES.**

---

### 11. [CLEAN][demonstrated] The claimed gates are real, with real counts

Run in the primary tree at `a26e55a`:

```
$ npm run typecheck        -> tsc --noEmit -p tsconfig.json    (clean, no output, exit 0)
$ npm run lint             -> eslint .                          (clean, no output, exit 0)
$ npm test
  tests 728
  pass 728
  fail 0
  cancelled 0
  skipped 0
  todo 0
  duration_ms 25737.1647
$ node src/qa/completeness-claim-checker.ts
  [QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.  exit 0
$ npm run qa:broken-instrument-gate
  [QA-16 broken-instrument-gate] VACUOUS-PASS: 0 known-broken instruments registered — vacuous pass.  exit 0
$ node src/qa/reference-resolver.ts c598312 HEAD
  [QA-14 reference-resolver] FAIL: 43 of 1085 citation(s) failed to resolve; 180 more unclassified.  exit 1
```

728/728, 0 fail, **0 skipped** — matches the build receipt exactly. No gate was broken by removing the three markers.

**Verdict: SURVIVES.**

---

## Scariest unproven assumption

**That "stop writing the number down" is the same thing as "fix the drift."** It is not. The drift class has three failure modes and this round closed only one of them:

| failure mode | round-3 status |
|---|---|
| a frozen number goes stale | **closed** for the marker mechanism (finding 7), **not closed** for prose (findings 1, 2) |
| a number is typed that was never measured | **not closed** — a new instance shipped this round (finding 2) |
| the claim becomes unverifiable | **newly opened** — the residual now has no instrument at all (findings 3, 6) |

The root cause was never "an exact count in a rescanned file." It is that **numeric claims about this corpus are authored by hand and verified only by whichever reviewer happens to re-measure.** Rounds 1-3 each fixed the *shape* of the last round's claim and each hand-authored a new one — including this round, twice. Removing the number removes the evidence of the problem, not the problem. The only structural cure the project's own hard rule already prescribes is an **instrument**, and this story shipped exactly that cure for Issue #150 while declining to apply it to Issue #154.

## Go / no-go

**no-go.** Not on safety — the shipped code is correct, the gates are real, and #155 and #156 are genuinely, structurally resolved. On the round's central claim: **the numeric-claim-drift class is NOT closed, and I am reporting a live recurrence, demonstrated twice, in `CHANGELOG.md` itself.**

Per `docs/decisions.md`'s 2026-09-11 round-3 self-imposed constraint — *"if red-team's round-4 re-confirm still finds a NEW instance of the numeric-claim-drift class ... escalate to `/maat:council` rather than a round 5"* — **this routes to `/maat:council`, not a round 5.** One thing for the council: rounds 4 and 5 of this pattern will produce the same result as rounds 1-3 unless the remedy changes from *editing prose* to *building the instrument*. The council question is not "what number should we write" — it is why this project's own anti-hand-derived-claim hard rule is being satisfied by prose, in a story about hand-derived claims.

## Single next action

Convene `/maat:council` on `qa14-marker-redesign` with one framing question: **should Issue #154's residual get the same `--field` instrument treatment Issue #150 already received, so the claim becomes machine-verifiable instead of merely unwritten?** Findings 1, 2, 3 and 6 all collapse into that one decision.

## Issue disposition

| Issue | Independently confirmed resolved? | Action |
|---|---|---|
| #155 | **Yes** — markers gone (parser-verified), QA-15 survives a corpus-growing commit, removal was the right call not an overcorrection | **CLOSED** `completed` |
| #156 | **Yes** — M1 reproduced independently, new shape test goes red under it | **CLOSED** `completed` |
| #154 | **No** — `CHANGELOG.md:15` still carries a live, stale, non-struck frozen count of this exact residual (finding 1), and the replacement pointer does not report the number it promises (finding 3) | **LEFT OPEN** |

## Open findings -> failing tests

6 open findings (5 ISSUE + 1 SUSPICION) map to 4 named tests; the mapping is not 1:1 and the gap is explained:

| finding | named test |
|---|---|
| 1 | `qa14: no frozen exact residual count survives in any permanently-scanned file` |
| 2 | `qa14: every commit-attributed measurement in CHANGELOG.md reproduces at that commit` |
| 3, 6 | `qa14-continuation-residual-probe: --field=<f> emits ONLY that number` (one instrument answers both) |
| 4 | no executable form — the defect is a wrong number in prose about a 0-vs-3 incidence count; it resolves to a plain edit plus coverage by finding 3's instrument |
| 5 | `--field=<f> equals computeMarkerCorpusStats(...)[f] for all three fields` |

## Editorial (verdict-neutral, plain edits, no re-review)

- `src/qa/reference-resolver.ts` STRUCTURAL NOTE: "this project has now had to correct a frozen count of this exact residual on this file four rounds running" — two corrections have occurred on this file (round 2 corrected round 1; round 3 corrected round 2). "Four rounds running" is ambiguous at best, and is itself an uninstrumented count inside the comment arguing against uninstrumented counts.
- `CHANGELOG.md` round-3 entry: "the 4th time this file shipped a frozen count of this residual that didn't survive its own commit" — same ambiguity; `CHANGELOG.md` carries two such shipped counts (line 15, line 46).
- `docs/decisions.md` round-3 build row: "confirmed the prior figure was ALREADY stale by re-running that exact command this session" — the cited command does not report this residual's count (finding 3), so this sentence is not reproducible either. Append-only, so this is a note for the next row, not an edit.
- Detached worktrees do not populate the `adr/` submodule, so the QA-14 self-dogfood test fails there on a missing `ADR-0021`. Worth one line in the contributor notes; it will trip the next reviewer who isolates a worktree.

---

RECEIPT: verdict=no-go
attacks (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][demonstrated] CHANGELOG.md:15 still carries a LIVE, non-struck, stale frozen count of the #154 residual ("10/400 real occurrences, 5 distinct blocking gate failures"; measured 6 of 427 at HEAD) — round 3's "every permanently-scanned location" completeness claim is false; defense: none, the de-hardcoding was scoped to the round-2 entry and never grepped. Exposure: ~25% of the 4 named locations, basis: counted-in-code. LIVE RECURRENCE of the drift class.
2. [ISSUE][MED][demonstrated] CHANGELOG.md round-3 verification para claims QA-15 "was already FAILING" at 4896420 with marked=434/unmarked=455/total=889 — ran it at a pristine detached worktree of 4896420: PASS exit 0, probe exactly 430/456/886; the claimed triple matches none of 5 enumerated tree states and unmarked=455 is below the additive baseline 456; defense: none. The conclusion it supports is nonetheless sound (reproduced the real FAIL by committing the two round-3 reports: 435/473/908). Exposure: 1 of 1 evidence sentences for the round's central decision, basis: measured. SECOND LIVE RECURRENCE.
3. [ISSUE][MED][demonstrated] The replacement pointer `node src/qa/reference-resolver.ts <base> <head>` does NOT report this residual's count (ran it: mixed 43-of-1085 blocking list across all citation kinds) — the residual now has zero machine-checkable representation, contra CLAUDE.md's "building the instrument is part of the task"; the cure was shipped for #150 and withheld here. Exposure: 100% of readers at 4 of 4 de-hardcoded sites, basis: measured.
4. [ISSUE][LOW][demonstrated] "Milestone-continuation conflation, 0 measured incidence" is false — 3 occurrences full-tree (all in the round-2 red-team report), and `...round2...md::#9999` is a live blocking gate finding today via the `already-recorded` branch seeding `lastMarkedListEnd`; the decision to leave it unfixed remains correct. Exposure: 1 of 222 scanned files, basis: measured.
5. [ISSUE][LOW][demonstrated] Mutation M2 (`stats[field]` -> `stats.marked`) makes every `--field` emit marked's value under the correct label and survives the whole suite, 0 tests catch it; blast radius now low since no marker consumes the value. Exposure: 1 CLI path, 0 CI consumers, basis: measured.
6. [SUSPICION][LOW][demonstrated] "single-digit percent, every measurement to date" is a forward-looking bound with no instrument and no failing test — true today (1.41%), unfalsifiable tomorrow; QA-15's own bare-claim heuristic (demonstrated red on both CHANGELOG.md and STATE.md) means the phrasing evades detection without gaining verification. The drift pressure moved from "stale" to "uncheckable".
7. [CLEAN][demonstrated] #155: exactly 1 marker survives repo-wide (`qa-mutation-shell expect=53`, parser-verified, not eyeballed), 0 bare claims, brackets truly deleted not struck; corpus-growth drill moved 915->925 with QA-15 still PASS exit 0 where round-2 state reddened all three; removal was the right call, not an overcorrection (KNOWN_INSTRUMENTS entries callable, no gate polices unreferenced entries, the assertion had no invariant behind it).
8. [CLEAN][demonstrated] #156: reproduced mutation M1 independently in an isolated worktree — new shape test goes RED (9 tests, 8 pass, 1 fail), reverted and md5-restored; shape-over-value was the correct design.
9. [CLEAN][demonstrated] #154's qualitative substance is honest — re-measured via a 2-line-instrumented shipped classifier + 89 real gh existence checks: 6 blocking pairs of 427 continuation-marked (1.41%, single-digit), and confirmed LOUD against the real gate (`[unresolved-authority] #000/#9999`, exit 1). No silent false-resolve path found.
10. [CLEAN][demonstrated] The "% of bare #N occurrences" -> "distinct per-file bare #N citations" relabel matches what `computeMarkerCorpusStats` computes (per-file dedupe in `scanReferences`); the "raw occurrences run materially higher" note is confirmed (427 occurrences vs 293 distinct pairs); leaving the computation alone was right.
11. [CLEAN][demonstrated] Gates real: typecheck/lint clean exit 0; npm test 728 tests / 728 pass / 0 fail / 0 skipped; QA-15 PASS exit 0; QA-16 vacuous-pass; real QA-14 gate FAIL exit 1. No gate broken by the marker removal.
counts (CHECKSUM): issues=5 suspicions=1 clean=5
evidence (CHECKSUM): demonstrated=11 code-traced=0 derived=0
checks=npm test 728 pass / 0 fail / 0 skipped; typecheck exit 0; lint exit 0; QA-15 PASS exit 0 (and FAIL exit 1 reproduced at 4896420+reports, and on 2 prose drills); QA-16 vacuous-pass exit 0; QA-14 real gate FAIL exit 1; mutation M1 -> 8 pass/1 fail (caught); mutation M2 -> 0 tests caught; corpus-growth drill 915->925 QA-15 still PASS
adr=HIT(35)
report=docs/reviews/qa14-marker-redesign-red-team-round4-2026-09-11.md
