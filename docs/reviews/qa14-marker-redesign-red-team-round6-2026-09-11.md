# Red Team (Sutekh) — `qa14-marker-redesign` ROUND 6 re-confirm (post-human-ruling)

- **Date:** 2026-09-11
- **Scope:** branch `fix/qa14-marker-redesign` @ `e34b91c`, repo `mohannadrabie/thoth`, CRITICAL tier
- **Mandate:** independently verify the three items the human ruling bounded this fix to, and answer whether the numeric-claim-drift class is structurally closed for this story's own artifacts.
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
- **Reading order followed:** `docs/decisions.md` last 2 rows in full (the round-5 hard-stop row, the human-ruling row) then `docs/reviews/qa14-marker-redesign-red-team-round5-2026-09-11.md` in full, then the live code at `e34b91c`.

## File-state integrity

```
git rev-parse HEAD      -> e34b91c8311117e5e5dfbcd248ffa5a2c573a1fb   (start == end)
git status --porcelain  -> (empty at start; empty at end)
sha256 (start == end, byte-identical)
  6ced2987...f153e   CHANGELOG.md
  c801a92f...1a28b0  docs/STATE.md
  5f3cc2b3...f84e    src/qa/completeness-claim-checker.ts
  1285d153...104ef   src/qa/continuation-residual-probe.ts
  4166f507...c33f28  src/qa/marker-corpus-probe.ts
  12946522...49b8    docs/decisions.md
```
One temporary `git worktree` at `a26e55a` created in the session scratchpad and removed (`git worktree list` -> single entry). One mutation applied to `src/qa/completeness-claim-checker.ts` (finding 2) and reverted with `git checkout --`; the sha256 above is the post-revert value and matches the pre-mutation value exactly.

## Gates, run by me at `e34b91c`

```
npm run typecheck                          -> clean, exit 0
npm run lint                               -> clean, exit 0
npm test                                   -> tests 756 | pass 756 | fail 0 | cancelled 0 | skipped 0 | todo 0 (29.2s)
node src/qa/completeness-claim-checker.ts  -> PASS: 2 file(s) checked, all completeness claims verified. exit=0
```

---

# Findings, ranked by blast radius

## 1. [ISSUE][MED][demonstrated] The round-5 correction annotations froze TWO new counts into the two permanently-scanned files — and `docs/STATE.md`'s is factually wrong, contradicting `CHANGELOG.md`'s

The commit struck `continuation-marked=273 continuation-residual=3` correctly (finding 6). In its place it wrote, live and unstruck:

```
CHANGELOG.md:70   "...independently re-measured 281/5, not 273/3..."
docs/STATE.md:14  "...already wrong at that commit — true value 271/5, per this round's own round-5 fix-now correction..."
docs/STATE.md:21  "...already wrong at the commit that published it — true value 271/5, not 273/3..."
```

Two permanently-scanned files now state two different "true values" for the same figure. I recomputed every relevant tree state independently, from git object content, using the shipped classifier via a different code path than the probe:

```
node <scratchpad>/true-count.mts <ref>     (list = git ls-tree -r <ref>; content = git show <ref>:<file>)
{"ref":"a26e55a","filesScanned":222,"continuationMarked":271}
{"ref":"f966a7b","filesScanned":227,"continuationMarked":281}   <- the commit that PUBLISHED 273/3
{"ref":"62d1c1a","filesScanned":228,"continuationMarked":281}
{"ref":"fb3da56","filesScanned":228,"continuationMarked":281}
{"ref":"e34b91c","filesScanned":228,"continuationMarked":281}   <- HEAD

node src/qa/continuation-residual-probe.ts --field=continuation-marked
[QA-14 continuation-residual-probe] PASS: continuation-marked=281      <- shipped instrument agrees at HEAD
```

`271` is the true value at **`a26e55a`**, the round-4 build's *baseline*. The commit that published `273/3` is `f966a7b`, whose true value is **`281`**. So:

- `CHANGELOG.md:70`'s `281/5` is **correct** but is a new frozen count.
- `docs/STATE.md:14` and `:21`'s `271/5` is **wrong**, and the sentence carrying it asserts precisely the thing it gets wrong ("already wrong at the commit that published it — true value 271/5").
- The round-5 commit message repeats the error and misattributes it: "(true value 271/5, per red-team's independent re-measurement)". My round-5 report states `281/5` at `f966a7b` and lists `271` explicitly as the `a26e55a` baseline (report lines 65-68).

**QA-15 is blind to both.** Run against the shipped `findBareClaims`:

```
MISSED | B1 THE LIVE CHANGELOG:70 correction | ...independently re-measured 281/5, not 273/3...
MISSED | B2 THE LIVE STATE:21 correction     | ...true value 271/5, not 273/3; see CHANGELOG.md
```

and the gate itself passes clean at HEAD (raw output above).

**Is this the same class or a new residual?** The same class, sixth instance — a frozen exact count, unstruck, in a permanently-rescanned file, wrong, under a green gate. It is materially **smaller** than rounds 1-5: it lives inside a dated *historical* correction annotation about a past measurement rather than in a headline claim about current state, and one of the two figures is numerically correct. But it is not a different failure shape, and the mechanism is now legible: **this project's correction convention forces the corrector to state "the true value was X", which is itself a new frozen count in the same file.** Shape-anchored regexes cannot catch that, because the corrector always picks a shape the last round did not write.

Exposure: 2 of 2 QA-15 `DEFAULT_FILES` carry a live, unstruck frozen count in a correction annotation; 1 of those 2 figures is factually false; basis: measured (own git-object recomputation at 5 refs, cross-checked against the shipped instrument). Reach: operator/auditor. Irreversibility: fully reversible — one edit. Silence: high, the gate is green.

**Verdict: BREAKS (MED).** Proof-test required: `qa15: a CORRECTED annotation in a DEFAULT_FILES member names the live command, never a number`. Minimal correction: delete `271/5` from `docs/STATE.md:14` and `:21` (and `281/5` from `CHANGELOG.md:70`), leaving the command pointer those same sentences already carry.

## 2. [ISSUE][MED][demonstrated] The human-ruled `BARE_CLAIM_PHRASES` extension is pinned by NOTHING — delete it and 756/756 still pass and the gate still says PASS

`git show e34b91c --stat` lists `src/qa/completeness-claim-checker.ts` but **not** `src/qa/completeness-claim-checker.test.ts`. The commit's "Mutation-demonstrated catching the exact former stale text" was a manual, uncommitted demonstration.

I applied the mutation and ran the whole suite plus the gate:

```
removing line 133:   /\bcontinuation-(?:marked|residual)=\d+\b/i,
grep -c "continuation-(?:marked|residual)=" src/qa/completeness-claim-checker.ts  -> 0

npm test
ℹ tests 756 | ℹ pass 756 | ℹ fail 0 | ℹ skipped 0

node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.  exit=0
```

Nothing in this repository objects to the guard's total removal. The human ruled for a mechanism "so a future reintroduction of this specific number-labeling convention is caught" — the mechanism exists today and is one refactor away from not existing, with zero signal. This is verbatim the shape of Issue #156 on this same story ("the `--field` output path has no test that fails when it breaks — mutation-demonstrated, 727 tests green"), which was filed, fixed and closed earlier in this very thread.

Contrast: item 3 of the same ruling *did* ship a real regression test (`continuation-residual-probe.test.ts:150`). The discipline was applied to one of two mechanical items.

Exposure: 100% of the round's single mechanical deliverable is unpinned — 1 of 1; basis: demonstrated (mutation applied, suite and gate both stayed green). Reach: instrument. Irreversibility: reversible. Silence: total.

**Verdict: BREAKS (MED).** Proof-test required, three cases in `src/qa/completeness-claim-checker.test.ts`: `findBareClaims` CATCHES `continuation-marked=281`; CATCHES `continuation-residual=5`; IGNORES the same text struck through. The first two fail today if the pattern is removed.

## 3. [ISSUE][MED][demonstrated] `marker-corpus-probe.ts`'s ref/content-mismatch bug is genuinely still live, and after #161 closes NO open Issue tracks it

Confirmed untouched and still defective — `src/qa/marker-corpus-probe.ts:107` (`const ref = argv.find((a) => !a.startsWith("--")) ?? "HEAD"`), `:114` (file LIST from `ref`), `:121` (`readFile(file)` — CONTENT from the working tree). Demonstrated live, not reasoned:

```
# TRUE total@a26e55a — a real git worktree at a26e55a, list AND content both a26e55a
[QA-14 marker-corpus-probe] PASS: total=915

# main tree, ref a26e55a — list@a26e55a, content@working tree
[QA-14 marker-corpus-probe] PASS: total=927      <- a tree state that never existed

# main tree, no ref
[QA-14 marker-corpus-probe] PASS: total=952
```

Leaving the code untouched is correct per the human's bounded scope — that was the ruling. The defect is that its **tracking** is about to be lost: Issue #161's title says "reproduces `marker-corpus-probe`'s ... bug", but its body is scoped entirely to `continuation-residual-probe.ts`, which is now fixed. Closing #161 as completed (which finding 10 says it deserves) deletes the only open record naming this bug. A full open-Issue scan for `marker-corpus|content-mismatch|working-tree` returns exactly one hit — #161 itself.

Exposure: 0% of runs today (no caller anywhere passes a ref to this probe — independently grepped); 100% of any future non-default-ref invocation, silently; basis: measured. Reach: instrument. Silence: total — it prints PASS and a plausible number, which is exactly how `273` entered this story's record in the first place.

**Verdict: BREAKS (MED).** Fix: file a bug Issue scoped to `marker-corpus-probe.ts` before closing #161 (done this turn), so the disclosed residual stays a tracked one. The code fix itself stays out of scope.

## 4. [ISSUE][LOW][demonstrated] The new pattern closes the two live shapes and still misses 3 of the 4 next-phrasings I measured in round 5 — plus two adjacent shapes, one of which is free to close

Shipped `findBareClaims`, run over 20 constructed strings:

```
CAUGHT | A1 reintroduced marked          | The probe reports continuation-marked=281 on the current tree.
CAUGHT | A2 reintroduced residual        | Residual today: continuation-residual=5.
CAUGHT | A3 both, as round 4 wrote it    | producing `continuation-marked=273 continuation-residual=3`.
MISSED | A4 struck (must be exempt)      | ~~...~~                                        <- correct
MISSED | D1 r5-missed: N out of M        | 3 out of 445 continuation-marked citations still fail
MISSED | D2 r5-missed: N/M continuation  | 3/281 continuation-marked citations fail real existence
MISSED | D3 r5-missed: exactly N residual| exactly 5 residual instances tree-wide
MISSED | D5 identifier variant           | continuationMarked=281 at HEAD
MISSED | D6 spaced equals                | continuation-marked = 281
MISSED | D7 prose number                 | the true value is 281 marked and 5 residual
totals: caught=3 missed=17 of 20
```

Round 5 measured 4 plausible next-phrasings missed; 3 of those 4 (D1, D2, D3) are still missed, and the newly-covered shape is the `identifier=N` one the human's ruling explicitly named. **That is within the ruling's bounded scope and is honestly disclosed in the code** (`completeness-claim-checker.ts:129-132`: "it does not claim to close the identifier=N class in general, only this story's own recurring shape"). LOW, not MED, for that reason.

One free widening: `/\bcontinuation-(?:marked|residual)\s*=\s*\d+\b/i` catches D6 and measures **0** matching live lines across both `DEFAULT_FILES` — zero false-positive cost.

**Verdict: BREAKS (LOW)** — residual register, not a gate. Named test if taken: `findBareClaims catches "continuation-marked = 281" (whitespace around =)`.

## 5. [ISSUE][LOW][code-traced] Round 5's finding 4 (the `lastInteger` contract) is still open and was correctly left out of scope

`continuation-residual-probe.ts:246-251` still prints the summary `continuation-residual=N` followed by two detail lines, so `lastInteger(stdout)` resolves to `distinctIssueNumbers`, not the residual. A future `[[completeness: cmd="qa14-continuation-residual-probe-residual" expect=N]]` marker would assert the wrong quantity. 0 consumers today; fails loud if wired. The human's ruling named three items and this was not one — the build was right not to touch it. Recorded so it is not lost.

---

# What genuinely landed — clean findings

## 6. [CLEAN][demonstrated] Item 1 fully landed: zero live, unstruck `continuation-(marked|residual)=N` survives in either scanned file, and the claimed third instance was real

Whole-tree grep for the exact shape, then a per-line strikethrough-aware scan using the same `~~...~~` stripping the gate itself applies:

```
node -e "...strip ~~spans~~, report any surviving continuation-(marked|residual)=\d+..."  over CHANGELOG.md + docs/STATE.md
scan complete                      <- zero LIVE-UNSTRUCK lines
```

All six occurrences (`CHANGELOG.md:70` x2, `:76`, `:80`; `docs/STATE.md:14`, `:21`) sit inside `~~...~~` spans with a dated `CORRECTED 2026-09-11 (round-5 fix-now, human-ruled...)` annotation. Struck, never deleted, per this project's own convention. Remaining tree-wide hits are in `docs/reviews/*`, `docs/decisions.md`, `docs/REVIEW_LOG.md` and the checker's own source comment — all dated/append-only/source, exempt by convention.

The "third instance" claim checks out: `git show fb3da56:docs/STATE.md` carries the figure on 2 lines (8 and 17) against `f966a7b`'s 1 — a genuinely new live instance introduced by `fb3da56`, after my round-5 report was written. *(Editorial: the commit message calls it the "Last updated" narrative line; it is in fact the hard-stop Resume-point paragraph.)*

## 7. [CLEAN][demonstrated] Item 2(a): the new pattern really does catch a reintroduced claim

A1/A2/A3 above, all CAUGHT by the shipped `findBareClaims` — the singular form, the plural form, and the exact byte sequence round 4 wrote.

## 8. [CLEAN][demonstrated] Item 2(b): zero false positives on every legitimate shape the build named

Every shape the commit message claimed it checked, run through the shipped function:

```
MISSED | C1 marked=380 unmarked=416 total=796            <- correct
MISSED | C2 blocking=295, exitCode=1                     <- correct
MISSED | C3 p99=186 ms                                   <- correct
MISSED | C4 demonstrated=6 code-traced=5 derived=0       <- correct
MISSED | C5 [[completeness: cmd="..." expect=53]]        <- correct
MISSED | C6 npm test 756/756 pass, 0 fail, 0 skipped     <- correct
MISSED | C7 43/45 pass, 17/17 green                      <- correct
```

7 of 7. The claim is true, and true for the reason stated.

## 9. [CLEAN][demonstrated] Rejecting the blanket `identifier=\d+` was the right call — I measured it myself rather than taking the commit's word

```
=== BLANKET identifier=N : 13 matching LIVE lines across DEFAULT_FILES ===
   STATE.md:34  «expect=0»        STATE.md:36  «marked=434»      STATE.md:42  «marked=380»
   STATE.md:60  «blocking=295»    STATE.md:115 «blocking=0»      STATE.md:200 «p99=186»
   STATE.md:216 «blocking=0»      STATE.md:260 «demonstrated=6»  (+5 more)
```

13 live false positives on the real corpus, including every example the commit message named. A blanket pattern would rubber-stamp-fail this project's own legitimate instrument reporting. The narrow trade is correct and evidence-grounded.

I also tested whether a **narrower pattern would catch MORE** (the question the mandate asked). A proximity pattern (`continuation-(marked|residual)` within 40 chars of a number) costs 4 false positives on ordinary prose. A "`CORRECTED` line carries no bare number" rule flags 14 of 15 CORRECTED lines (issue numbers, round numbers, test counts). Narrowing that to "a live `N/M` on a `CORRECTED` line" flags 9, of which 2 are the genuine new frozen counts from finding 1, 1 is a legitimate `755/755` test count, and 5 are quotes of the figure being corrected. **The regex path is near its ceiling.** Honest conclusion: what closes this class is a convention — *a correction annotation names the command, never a number* — not a seventh pattern.

## 10. [CLEAN][demonstrated] Item 3: the positional `ref` is genuinely deleted, and the claimed before/after reproduces exactly

Code-traced: `collectFullTreeFileTexts(repoRoot)` takes no `ref` and hardcodes `"HEAD"` (`continuation-residual-probe.ts:167-169`); `main()` no longer parses a positional argument (the `const ref = argv.find(...)` line is gone from the diff). Demonstrated:

```
node src/qa/continuation-residual-probe.ts --field=continuation-marked            -> continuation-marked=281
node src/qa/continuation-residual-probe.ts --field=continuation-marked a26e55a    -> continuation-marked=281
cmp -> IDENTICAL
node src/qa/continuation-residual-probe.ts --field=continuation-marked HEAD~5     -> continuation-marked=281
```

The claimed before/after reproduces in full. I re-implemented the *deleted* behaviour in the scratchpad (file list from `<ref>`, content from the working tree) and ran it:

```
PRE-FIX hybrid, ref=a26e55a : files=222, continuationMarked=273    <- the disputed 273, reproduced exactly
PRE-FIX hybrid, ref=f966a7b : files=227, continuationMarked=281
TRUE       a26e55a          : 271
TRUE       f966a7b          : 281
```

`273` was the hybrid; `271` was the truth at `a26e55a`; `281` is the truth at `f966a7b` and at HEAD. The fix removes the mechanism, not just the symptom, and is pinned by a real regression test (`continuation-residual-probe.test.ts:150`, real subprocess, asserts byte-identical stdout with and without a stray positional argument).

## 11. [CLEAN][demonstrated] No caller ever depended on the `ref` — re-checked myself, not taken from the commit message

A tree-wide grep for `continuation-residual-probe` across `*.ts`, `*.json`, `*.yml`, `*.mjs` (excluding `node_modules` and `docs/`) returns: the two `KNOWN_INSTRUMENTS` entries (both `--field=...` only), the checker's own comments and its allowlist test, and the probe's own test file. `.github/workflows/ci.yml` contains no reference to the probe at all. Zero call sites passed a ref; the deletion breaks nothing.

## 12. [CLEAN][demonstrated] Gates are real and green at `e34b91c`

typecheck exit 0, lint exit 0, `npm test` 756 pass / 0 fail / 0 skipped / 0 todo, QA-15 PASS exit 0. Skipped read from the raw summary line, not inferred. The "+1 new test" claim matches (755 -> 756).

## 13. [CLEAN][demonstrated] The shipped instrument's number is independently correct

My git-object recomputation at HEAD (`281`) matches the shipped probe's `continuation-marked=281` exactly, via a different enumeration path (`git ls-tree` + `git show` vs `resolveChangedFiles` + `readFile`). The instrument is trustworthy; it is the prose around it that keeps failing.

## 14. [CLEAN][code-traced] No ADR governs this surface

35-ADR catalog re-read from `adrCatalog.adrs` on the security / state / concurrency / failure-mode slice. devops ADR-0008's gate stack and SE ADR-0010's ratchet surfaces do not reach a non-blocking QA instrument or documentation prose. Seventh independent confirmation, unchanged.

---

# The load-bearing question: is the numeric-claim-drift class structurally closed?

**No — and I can now say precisely why, which is new.**

For the 4 permanently-scanned locations plus the new instrument, the *measurement* half is genuinely closed (findings 10, 11, 13): a real, callable, tested instrument exists, its output is reproducible, its one remaining defect is deleted at the root, and no caller depended on the deleted surface.

The *writing* half is not closed, and cannot be closed by the mechanism this story has used five times. Each round adds a regex anchored to the phrasing the **last** defect used. Each correction then writes a new number in a phrasing the new regex does not cover — because a correction, by this project's own convention, must say what the wrong figure should have been. Round 6's instance (`271/5` / `281/5`) is that mechanism operating on the round whose entire mandate was to end it.

I tested the obvious escape (a generic `CORRECTED`-line guard) and measured it unusable: 14 false positives on 15 lines, or 9 with at least 1 clear false positive when narrowed. **There is no cheap regex left.** The closure is a convention, enforced at review rather than by pattern: *a correction annotation points at the command and names no number.* `CHANGELOG.md:70` already states that rule in its own text — and violates it in the same sentence.

# Is this a new residual or the same class recurring?

Mixed, and the distinction matters:

- **Finding 1 is a genuine repeat of the exact failure shape**, at reduced magnitude (a dated historical annotation, not a headline claim; 1 of the 2 new figures is numerically correct). Round 1 froze `0/316`. Round 2 froze `10/400`. Round 3 fabricated `434/455/889`. Round 4 missed 2 of 3 locations. Round 5 froze `273/3`. Round 6 froze `271/5` (wrong) and `281/5` (right).
- **Finding 2 is NEW and different** — not drift at all, a durability gap: the ruled-for guard exists but nothing fails if it is deleted.
- **Findings 3, 4 and 5 are disclosed, deliberate, correctly-out-of-scope residuals.** Acceptable. Named.

**A 3rd escalation tier may be warranted, and this is the human's call, not mine.** Six rounds, one council, and one human ruling have not closed this class, and that is now a fact about the *process*, not about any one build. My recommendation for that tier is explicitly **not** a seventh fix-now round of the same shape — I measured that path to its ceiling (finding 9). It is: adopt the convention, delete the residual figures rather than restate them, and stop reviewing this file.

# Go / no-go

**no-go** — on two findings totalling one text deletion and three test cases. No design question, no council, no new analysis.

Stated fairly, because it matters: **items 1 and 3 of the human's ruling landed completely and correctly** (findings 6, 7, 8, 9, 10, 11), verified independently by me at every step, including a full reproduction of the disputed `273`/`271`/`281` arithmetic. Item 2 landed functionally and correctly-scoped. This is again the best round of the six, and the gap is the smallest yet.

What I cannot sign is "clean": `docs/STATE.md` states a false number about this story's own measured history, in the file every session reads first, contradicting `CHANGELOG.md`; and the single mechanical guard the human ruled for is provably unpinned — I deleted it and nothing in 756 tests noticed.

**Single next action:** apply the two-item unlock below as a fix-now with no re-review round — a `code-reviewer` or the Manager can confirm the diff in one pass, since both items have a named failing test:
1. Delete `271/5` from `docs/STATE.md:14` and `:21`, and `281/5` from `CHANGELOG.md:70` — the command pointer those sentences already carry is the whole correction.
2. Add the three `findBareClaims` cases to `src/qa/completeness-claim-checker.test.ts` (catches `continuation-marked=281`; catches `continuation-residual=5`; ignores the struck form).

# Open findings -> failing tests

| Finding | Named failing test | Executable? |
|---|---|---|
| 1 | `qa15: no live, unstruck frozen count survives in a CORRECTED annotation in DEFAULT_FILES` | Yes |
| 2 | `findBareClaims catches continuation-marked=281 / continuation-residual=5, ignores the struck form` (3 cases) | Yes |
| 3 | (tracking, not code) new bug Issue scoped to `marker-corpus-probe.ts`'s ref/content mismatch | Yes — filed this turn |
| 4 | `findBareClaims catches "continuation-marked = 281" (whitespace around =)` | Yes |
| 5 | `continuation-residual-probe: --field=continuation-residual emits ONLY that number (lastInteger === residual)` | Yes (carried from round 5) |

Open findings = 5; distinct failing tests = 5. Finding 3's "test" is an Issue rather than an assertion — it is a tracking gap, not a code defect; stated, not hidden.

# Editorial (verdict-neutral, no re-review)

- The round-5 commit message says the third struck instance was `docs/STATE.md`'s "Last updated" narrative line. It was the hard-stop **Resume point** paragraph; the `Last updated` line at `fb3da56` carried no figure.
- The same commit message attributes `271/5` to "red-team's independent re-measurement". My round-5 report states `281/5` at `f966a7b` and lists `271` as the `a26e55a` baseline.
- `CHANGELOG.md:70`'s correction ends "Run ... for the live count — never a frozen one" in the same sentence that freezes `281/5`.
- `CHANGELOG.md:47` carries a live, unstruck `422/427/849` inside a round-3-era CORRECTED annotation — same shape as finding 1, older, out of this ruling's scope, noted for the record.

---

RECEIPT: verdict=no-go
attacks (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Round-5's own correction annotations froze two NEW counts into both permanently-scanned files: CHANGELOG.md:70's `281/5` (correct but frozen) and docs/STATE.md:14/:21's `271/5` (WRONG — 271 is the a26e55a baseline; the commit that published 273/3 is f966a7b, true value 281, independently recomputed from git objects at 5 refs and cross-checked against the shipped probe) — the two scanned files now contradict each other, QA-15 PASSes clean on both, and the commit message repeats the error. Same class, 6th instance, materially smaller (a dated historical annotation, not a headline claim). Exposure: 2 of 2 DEFAULT_FILES, 1 of 2 figures false, basis: measured.
2. [ISSUE][MED][demonstrated] The human-ruled BARE_CLAIM_PHRASES extension is pinned by no test at all — `git show --stat` shows completeness-claim-checker.test.ts untouched; I deleted line 133 and got `npm test` 756/756 pass, 0 fail, 0 skipped AND `node src/qa/completeness-claim-checker.ts` PASS exit 0. Verbatim the shape of Issue #156, already filed/fixed/closed on this same story; item 3 of the same ruling DID ship a regression test, so the discipline was applied to 1 of 2 mechanical items. Exposure: 1 of 1 mechanical deliverable unpinned, basis: demonstrated.
3. [ISSUE][MED][demonstrated] marker-corpus-probe.ts's ref/content-mismatch bug is genuinely still live and untouched as ruled (real worktree total@a26e55a=915 vs probe-with-ref=927, a tree state that never existed; :107/:114/:121) — but the only open Issue naming it, #161, is bodied entirely on the now-fixed twin, so closing #161 would delete its tracking. Exposure: 0% of runs today (no caller passes a ref, re-grepped), 100% of any future non-default-ref run, silently; basis: measured.
4. [ISSUE][LOW][demonstrated] The new pattern closes the two live shapes and still misses 3 of the 4 next-phrasings I measured in round 5 (`3 out of 445`, `3/281 continuation-marked`, `exactly 5 residual`) plus `continuation-marked = 281` (spaced) and camelCase — 3 caught / 17 missed over 20 constructed strings. Within the ruling's bounded scope and honestly disclosed at completeness-claim-checker.ts:129-132; the spaced-equals widening costs 0 false positives on the real corpus.
5. [ISSUE][LOW][code-traced] Round-5 finding 4 still open and correctly out of scope: continuation-residual-probe.ts:246-251 prints detail lines after the summary, so lastInteger(stdout) is the gh-call count, not the residual — any future marker wired to that field asserts the wrong quantity. 0 consumers, fails loud if wired.
6. [CLEAN][demonstrated] Item 1 fully landed: a strikethrough-aware per-line scan finds ZERO live, unstruck `continuation-(marked|residual)=N` in either DEFAULT_FILES; all six occurrences sit inside `~~` spans with dated CORRECTED annotations, struck never deleted; and the claimed third instance was real (fb3da56's STATE.md carries it on 2 lines vs f966a7b's 1, added after my round-5 report).
7. [CLEAN][demonstrated] Item 2(a) works: shipped findBareClaims CATCHES `continuation-marked=281`, `continuation-residual=5`, and the exact byte sequence round 4 wrote; correctly exempts the struck form.
8. [CLEAN][demonstrated] Item 2(b) works: 7 of 7 legitimate shapes the commit named (marked=380/unmarked=416/total=796, blocking=295/exitCode=1, p99=186, demonstrated=6/code-traced=5, expect=53, 756/756, 43/45) correctly ignored — zero false positives.
9. [CLEAN][demonstrated] Rejecting the blanket identifier=\d+ was the RIGHT call, measured by me not taken on trust: 13 live false-positive lines across DEFAULT_FILES including every example the commit named. I also tested whether a narrower pattern would catch MORE — proximity costs 4 FPs, a CORRECTED-line no-bare-number rule flags 14 of 15 lines, narrowed to live-N/M-on-a-CORRECTED-line flags 9 with at least 1 clear FP: the regex path is at its ceiling, the closure is a convention not a 7th pattern.
10. [CLEAN][demonstrated] Item 3 landed at the root: the positional ref is gone (collectFullTreeFileTexts(repoRoot) hardcodes "HEAD"), stdout is byte-identical with `a26e55a`, with `HEAD~5`, and with no argument (all 281), pinned by a real-subprocess regression test — and the claimed before/after reproduces exactly: I re-implemented the deleted hybrid and got 273 at a26e55a against a true 271, with true f966a7b/HEAD = 281.
11. [CLEAN][demonstrated] No caller ever depended on the ref — re-grepped myself across *.ts/*.json/*.yml/*.mjs: only the two `--field=`-only KNOWN_INSTRUMENTS entries, the allowlist test, and the probe's own tests; ci.yml never references the probe at all.
12. [CLEAN][demonstrated] Gates real and green at e34b91c: typecheck exit 0, lint exit 0, npm test 756 pass / 0 fail / 0 skipped / 0 todo, QA-15 PASS exit 0; the "+1 new test" claim matches 755 -> 756.
13. [CLEAN][demonstrated] The instrument itself is trustworthy: my independent git-object recomputation at HEAD (281) matches the shipped probe (281) via a different enumeration path — it is the prose around the instrument that keeps failing, not the instrument.
14. [CLEAN][code-traced] No ADR governs this surface — 35-ADR catalog re-read on the security/state/concurrency/failure-mode slice; ADR-0008's gate stack and ADR-0010's ratchet surfaces do not reach a non-blocking QA instrument or documentation prose. Seventh confirmation, unchanged.
counts (CHECKSUM): issues=5 suspicions=0 clean=9
evidence (CHECKSUM): demonstrated=12 code-traced=2 derived=0
checks=npm run typecheck clean exit 0; npm run lint clean exit 0; npm test tests 756 pass 756 fail 0 cancelled 0 skipped 0 todo 0 (29.2s); node src/qa/completeness-claim-checker.ts PASS 2 files exit 0; MUTATION (BARE_CLAIM_PHRASES line 133 removed) -> npm test 756/756 pass 0 fail 0 skipped AND QA-15 PASS exit 0, then reverted (sha256 restored); continuation-residual-probe --field=continuation-marked -> 281, with a26e55a -> 281 (cmp IDENTICAL), with HEAD~5 -> 281; marker-corpus-probe --field=total: true worktree@a26e55a 915 vs main-tree-with-ref 927 vs no-ref 952; independent git-object recomputation a26e55a=271 f966a7b=281 62d1c1a=281 fb3da56=281 e34b91c=281; PRE-FIX hybrid reproduction a26e55a=273 f966a7b=281; findBareClaims over 20 constructed strings -> 3 caught / 17 missed as tabulated; blanket identifier=N measured -> 13 live FP lines in DEFAULT_FILES; CORRECTED-line guard candidates measured -> 14 of 15 / 9 of 15 flagged; strikethrough-aware live-figure scan over both DEFAULT_FILES -> 0 survivors; whole-tree grep for the figure shape; git status clean and sha256 identical before/after
adr=HIT(35)
report=docs/reviews/qa14-marker-redesign-red-team-round6-2026-09-11.md
