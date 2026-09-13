# Code review (round 2, re-confirm) -- qa14-marker-redesign

Reviewer: code-reviewer (Anubis)
Date: 2026-09-11
Scope: `fix/qa14-marker-redesign` @ `95e3a21` (round-1 fix-now commit, on top of `64a18ed`)
Tier: CRITICAL
Prior report: `docs/reviews/qa14-marker-redesign-code-2026-09-11.md` (SHIP-AFTER-FIXES, 1 HIGH -> Issue #149)
Triage ruling read: `docs/decisions.md` 2026-09-11 rows 63-64

## 1. Re-verification of Issue #149

Read the 2 new tests -- they pin a tight hyphen-joined range and a tight en-dash/em-dash range, asserting both ends resolve via the mocked issueExists.

Independently re-ran the mutation myself (not just re-read the tests): mutated TIGHT_DASH_CONTINUATION_RE's body to never-match, leaving everything else shipped-as-is.

```
npx vitest run src/qa/reference-resolver.test.ts -t "Issue #149"
ℹ tests 69
ℹ pass 67
ℹ fail 2
```

Both Issue #149 tests, and only those two, go red. File reverted (git diff --stat empty after). Genuinely load-bearing, confirmed by my own hand, not by re-reading the build's claim.

## 2. Independent review of this round's new code

### 2a. Dedup-shadowing fix (Issue #152, red-team's finding)

Read scanReferences/recordBareHash (src/qa/reference-resolver.ts:342-369) start to finish. Traced by hand, then verified live with a 3-occurrence probe script (unmarked -> marked -> unmarked-again; marked -> unmarked -> marked-again with a different marker word; unmarked -> unmarked -> marked -> unmarked) against the real shipped scanReferences:

```
A (unmarked, marked, unmarked): kind=issue verdict=unresolved-authority  (marked wins, stays won)
B (marked, unmarked, marked again): kind=issue verdict=resolved           (first marked classification kept, never re-verified, never downgraded)
C (unmarked, unmarked, marked, unmarked): kind=issue verdict=unresolved-authority
```

All three orderings correct: a marked classification always wins over an unmarked one, for any scan order, and a later unmarked/re-marked occurrence never re-triggers issueExists or downgrades a settled result.

Independently mutation-tested this fix too (not required by the task, done for the same confidence level as #149): reverted recordBareHash to old plain-record (Set-based, first-wins) semantics.

```
npx vitest run src/qa/reference-resolver.test.ts -t "Issue #152"
ℹ tests 69
ℹ pass 67
ℹ fail 2
```

2 of the 3 new #152 tests go red (the third, "marked occurrence FIRST" regression guard, correctly stays green under both old and new code -- it was never broken). File reverted afterward, working tree confirmed clean.

[CLEAN, demonstrated] The dedup-shadowing fix is correct for every ordering tested, including the multi-occurrence orderings the task specifically asked about.

### 2b. src/qa/marker-corpus-probe.ts / .test.ts

Read both files in full. computeMarkerCorpusStats is pure, reuses the shipped scanReferences classifier directly (no second regex copy -- the exact discipline CLAUDE.md's hard rule demands), and its 5 tests are meaningful (marked/unmarked/excluded-population/cross-file-sum/vacuous cases), not tautological. Confirmed the KNOWN_INSTRUMENTS wiring is real, not just declared: src/qa/completeness-claim-checker.ts:51 registers "qa14-marker-corpus-probe": { cmd: "node", args: ["src/qa/marker-corpus-probe.ts"] }, and running it directly works:

```
node src/qa/marker-corpus-probe.ts
[QA-14 marker-corpus-probe] PASS: marked=422 unmarked=427 total=849 -- approx 50% ... (217 files scanned)
```

(Numbers drift from the build's own 380/416/796 because the tree has grown since -- expected and correct for a live-measuring instrument, not a bug.)

One minor, non-blocking observation: the marked=380 unmarked=416 total=796 figure quoted in CHANGELOG.md/docs/decisions.md is not wrapped in a machine-readable [[completeness: cmd="qa14-marker-corpus-probe" expect=...]] marker, so QA-15's own drift-detection gate does not track it going forward (confirmed: node src/qa/completeness-claim-checker.ts PASSes either way -- this figure's shape, marked=N unmarked=N total=N, doesn't trip findBareClaims's heuristic phrase list either). This satisfies the CLAUDE.md hard rule's substance (the number was produced by a real, committed, re-runnable instrument, not hand-derived) even without the marker syntax -- the marker is what would additionally let CI catch future drift automatically. Not filed as an Issue: no false claim exists today, this is a "could be tightened" note, not a defect.

### 2c. TIGHT_DASH_CONTINUATION_RE and the disclosed comma/whitespace residual (Issue #154, partial fix)

Read the code and doc comments (src/qa/reference-resolver.ts:144-169, 284-328). The partial-fix-and-disclose choice is implemented cleanly:
- isListContinuationGap composes the two regexes explicitly, each with its own header comment stating exactly what it covers and why (corpus-grounded, not a guess).
- The still-open comma/whitespace leak is pinned by a dedicated regression test ("Issue #154, disclosed residual, NOT fixed this round") whose assertion documents the known-bad behavior rather than silently passing it through untested.
- CHANGELOG.md's prior false "never" claims (R4, R5) are struck through and corrected in place with dates and issue numbers, not silently rewritten.

No confusing or inconsistent code left behind -- this is a well-disclosed partial fix, not scope-creep-disguised-as-caution.

## 3. Test quality, this round's new tests

Read all 14 new tests (9 in reference-resolver.test.ts, 5 in marker-corpus-probe.test.ts). Each asserts on a distinguishing mock (issueExists returning true/false per case) and checks both kind and verdict, not just citation count -- none is tautological. Test-count claim double-checked against the diff itself (learned from round 1's own editorial finding): git diff 64a18ed..95e3a21 -- src/qa/reference-resolver.test.ts | grep -c "^+test(" = 9; marker-corpus-probe.test.ts has 5 test( bodies. 9 + 5 = 14 = 722 - 708. Matches exactly, no miscount this round.

## 4. Baseline gates (independently re-run)

```
npm run typecheck   -> clean
npm run lint         -> clean
npm test x10          -> 722/722 pass, 0 fail, 0 skipped, EVERY run (10/10)
```

No flake reproduced across 10 consecutive full-suite runs, matching the build's own claim.

## Findings

1. [CLEAN, demonstrated] Issue #149 -- genuinely fixed, re-mutation-confirmed by hand.
2. [CLEAN, demonstrated] Issue #152 dedup-shadowing fix -- correct for every ordering tested (including 3+-occurrence sequences), independently mutation-tested.
3. [CLEAN, code-traced] marker-corpus-probe.ts/.test.ts -- real instrument, correctly wired into KNOWN_INSTRUMENTS, runs successfully, tests meaningful.
4. [CLEAN, code-traced] TIGHT_DASH_CONTINUATION_RE + disclosed comma residual -- clean partial-fix-and-disclose, no inconsistent code left behind.
5. [CLEAN, code-traced] Issue #153 seeding fix -- traced directly, straightforward, covered by 2 tests.
6. [CLEAN, demonstrated] Test-count claim (9 + 5 = 14) verified against the diff itself, no repeat of round 1's editorial miscount.
7. Minor, non-blocking, no Issue filed -- marker-corpus-probe's own measured figure isn't wrapped in a [[completeness: cmd=...]] marker, so QA-15 doesn't track its future drift. Free to add; not a defect today.

## Missing checks (named)

None newly identified this round. (Round 1's "no explicit test for summarizeCitations on an all-unclassified set" remains a free-standing, non-blocking, traced-correct-by-hand gap -- unchanged from round 1, not touched by this round's diff.)

## Verdict: SHIP

Issue #149 is genuinely fixed, re-confirmed by my own independent mutation test, not just by reading the new tests. The substantial new code this round added (dedup-shadowing fix, marker-corpus-probe, tight-dash guard) is correct, well-tested, and cleanly disclosed where a residual stays open. No new HIGH or MED findings from this pass. Baseline gates clean; 722/722 across 10 consecutive full-suite runs, no flake.

This verdict is scoped to code-reviewer's own domain (correctness, testing, error-handling, maintainability) against this round's diff. red-team's and cross-domain-reviewer's own re-confirms of their own findings (#150, #151, #152's blast-radius framing, #153, #154, the flaky-test suspicion, and the full-tree drift figure) are their own domain's responsibility, not re-litigated here.

Praised decision: independently re-running the mutation test rather than trusting "tests exist" is exactly the discipline this round validated -- the build's own claim ("2 new tests pin the dash class... manually mutation-verified") checked out byte-for-byte when re-run cold, on both #149 and (extra credit) #152.

## Single next action

None required from code-reviewer -- close Issue #149 (completed) and hand off to red-team's/cross-domain-reviewer's own re-confirms for the remaining triaged items.

---

RECEIPT: verdict=SHIP
findings (ranked):
1. [CLEAN][demonstrated] Issue #149 dash/en-dash/em-dash coverage -- independently re-mutation-tested, both new tests go red on mutation, green on shipped code.
2. [CLEAN][demonstrated] Issue #152 dedup-shadowing fix -- correct for every ordering tested (3+ occurrences), independently mutation-tested (2/3 new tests go red on the old Set-based mutation).
3. [CLEAN][code-traced] marker-corpus-probe.ts/.test.ts -- real, re-runnable instrument, correctly wired into completeness-claim-checker.ts's KNOWN_INSTRUMENTS, confirmed runnable, tests meaningful not tautological.
4. [CLEAN][code-traced] TIGHT_DASH_CONTINUATION_RE + disclosed comma/whitespace residual -- clean partial-fix-and-disclose, pinned by a dedicated regression test, no inconsistent code left behind.
5. [CLEAN][code-traced] Issue #153 already-recorded-branch seeding fix -- traced directly, correct, covered by 2 tests.
6. [CLEAN][demonstrated] This round's test-count claim (9 reference-resolver.test.ts + 5 marker-corpus-probe.test.ts = 14 = 722-708) verified against the diff itself, no repeat of round 1's miscount.
counts (CHECKSUM): issues=0 suspicions=0 clean=6
evidence (CHECKSUM): demonstrated=3 code-traced=3 derived=0
checks="722/0/0 (npm test, x10 runs); typecheck clean; lint clean"
adr=HIT(35)
report=docs/reviews/qa14-marker-redesign-code-round2-2026-09-11.md
