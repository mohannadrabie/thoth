# Red Team (Sutekh) — `qa14-issue137-precision-fastfollow` (Issue 137, R1 + R2)

**Date:** 2026-09-13
**Scope:** uncommitted working-tree diff in `C:\playground\thoth` — `src/qa/reference-resolver.ts` (+ `.test.ts`), 3 mechanical stub sites, close-out docs.
**Tier:** CRITICAL (ratified). **ADR cache:** `HIT` — 35 ADRs reused (`adr/devops:12`, `adr/software-engineering:23`), fp `83b2e3e`, ~17300 tokens saved.
**Verdict: go** — no HIGH. Both code changes survived every attack. The two MED findings are in the close-out prose and in the gate that should have caught it, not in the shipped logic.

---

## ADR rules read for this attack surface

Read from `adrCatalog.adrs` in `docs/.maat-state.json` (cache HIT, no re-parse): SE ADR-0005 (testing strategy), SE ADR-0006 (blast radius control), devops ADR-0008 (CI/CD gates), SE ADR-0008, devops ADR-0010, ADR-0021. The ones that bind here:

- **SE ADR-0006** — "MUST NOT widen a change's scope opportunistically ('while I'm here' refactors); separate PR." -> attack 7, SURVIVES.
- **SE ADR-0005** — "MUST NOT delete or weaken a failing test to make CI pass" / "MUST write unit tests for every new/changed behavior — happy path, error paths, and boundaries." -> attack 6, SURVIVES (the pinned malformed-ADR test is unedited; the test-file diff is purely additive plus 3 compile-forced stub lines).
- **devops ADR-0008** — "MUST NOT merge a PR with any blocking gate open, failing, or pending." QA-14 is already red at HEAD (299 blocking) on the pre-existing, tracked Issue #120. This diff does not turn a green gate red; it takes the gate 299 -> 144. Assessed, not a new violation, but see finding 1 for the 132 -> 144 self-inflicted portion.

---

## Findings, ranked by blast radius

### 1. [ISSUE][MED][demonstrated] The diff's own close-out prose adds 12 new blocking QA-14 citations, making the number it advertises unreproducible on the tree it ships in

**Attack / implicit assumption broken:** "The CHANGELOG entry describes the fix's effect; writing it is inert." On this project it is not — QA-14 scans `CHANGELOG.md` and `docs/STATE.md` as ordinary corpus, and the entry documenting an ADR-citation fix is written in ADR-citation-shaped tokens.

**Scenario:** the commit lands; CI runs QA-14; the gate prints **144** blocking failures while `CHANGELOG.md` in that same commit states **133**. A reader reconciling the two finds an 11-failure gap with no explanation, on a file whose documented failure mode is exactly numeric-claim drift (two prior design councils; Issues #157 / #160 / #162).

**Evidence — measured, same command, three tree states** (the 40-zero sentinel, which the instrument's own note confirms falls back to a full-tree scan):

```
$ node src/qa/reference-resolver.ts 0000000000000000000000000000000000000000 HEAD

A: full working tree (what will be committed)
[QA-14 reference-resolver] FAIL: 144 of 3727 citation(s) failed to resolve; 500 more unclassified (non-blocking).

B: code change applied, docs stashed at HEAD
[QA-14 reference-resolver] FAIL: 132 of 3710 citation(s) failed to resolve; 498 more unclassified (non-blocking).

C: pure HEAD baseline
[QA-14 reference-resolver] FAIL: 299 of 3760 citation(s) failed to resolve; 498 more unclassified (non-blocking).
```

The 12 blocking failures present in A and absent from B — i.e. introduced by `CHANGELOG.md` + `docs/STATE.md` alone (`comm -23 A.txt B.txt`), with the id tokens written here in a deliberately inert form so this report does not repeat the defect:

```
  - [unparseable] ADR-<3-digit>   x2   (the "003" example token)
  - [unparseable] ADR-<3-digit>   x2   (the "007" example token)
  - [unparseable] ADR-<2-digit>   x4   (the "12" example token)
  - [unparseable] ADR-<digit+letter> x2 (the "1a" example token)
  - [unresolved-authority] ADR-<4-digit-nonexistent> x2 (the "9999" example token)
```

Per-verdict: `unparseable` **2 -> 12**, `unresolved-authority` **117 -> 119**.

**Current defense, honestly assessed:** the *source file* applies exactly the right discipline and says so twice — `reference-resolver.ts:96` ("Real digit-suffix examples deliberately avoided here — see this file's own header dogfood note") and the same note at line 314. The discipline was correctly applied where it was written down, and not applied to the two `.md` files QA-14 also scans. A real inconsistency, not a conceptual gap.

**Secondary consequence:** the CHANGELOG's own enumeration — "`unparseable`: 57 -> 3 (54 fewer). **Every remaining one** is a real digit-bearing, wrong-length ADR id (three ids listed)" — is false on the shipped tree. Measured unique unparseable raw strings in state A: **four**, not three, and the fourth is introduced by the sentence two bullets above it.

**Verdict: BREAKS (MED).**
Exposure: ~100% of QA-14 runs on this commit, basis: **measured**. Irreversibility: low (a doc edit). Silence: medium — the gate is already red on pre-existing Issue #120, so the +12 hides inside an existing failure rather than announcing itself. Ranked MED, not HIGH, because no code behavior is wrong and nothing green turns red.

**Named proof-test / drill required before commit:** re-run `node src/qa/reference-resolver.ts 0000000000000000000000000000000000000000 HEAD` after neutralizing the example tokens, and assert the printed blocking count equals the number those files claim. The tokens must be written in a form that is not a candidate — this diff's own R2 rule makes any zero-digit form inert, which is the self-consistent fix.

**Issue:** already filed as **#166** by a concurrent reviewer this same session. Not duplicated; commented instead with the 12-citation measurement and the fourth-unparseable evidence above.

---

### 2. [ISSUE][MED][demonstrated] QA-15's bare-claim detector is structurally blind to the word-form exhaustive enumeration this diff actually used, so a false completeness claim ships with the gate green

**Attack:** "CLAUDE.md's hard rule against hand-derived completeness claims is enforced by QA-15, so an unmarked claim cannot ship." Broken.

**Scenario:** an agent writes `Every remaining one is X (A, B, C)` — no `[[completeness: cmd=...]]` marker, no digit adjacent to `every`. QA-15 passes. The claim is wrong. Not hypothetical: it is sitting in the working tree right now.

**Evidence:**

```
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
EXIT=0
```

`CHANGELOG.md` IS one of the two scanned files (`completeness-claim-checker.ts:279` — `DEFAULT_FILES = ["docs/STATE.md", "CHANGELOG.md"]`). All seven `BARE_CLAIM_PHRASES` patterns (`completeness-claim-checker.ts:103-116`) tested directly against the shipped sentence:

```
matched by any BARE_CLAIM_PHRASES pattern: false
  pat0 \ball\s+\d+\b                                                  -> false
  pat1 \bevery\s+\d+\b                                                -> false
  pat2 \b\d+\s+of\s+\d+\b                                             -> false
  pat3 \bfull set of\s+\d+\b                                          -> false
  pat4 \bexhaustive\b.{0,40}\b\d+\b                                   -> false
  pat5 \b\d+\/\d+\b\s+(?:real\s+)?occurrences?\b                      -> false
  pat6 \b\d+\/\d+\b.{0,20}\bdistinct\b.{0,30}\b(?:failures?|leaks?)\b -> false
```

Root cause: every pattern requires a **digit adjacent to the quantifier**. "every remaining one", "every consumer", "all of them", "the full set" — the natural English forms — carry no adjacent digit and are invisible. Issue #159 (closed) fixed the "N/M" slash shape; this is a different, still-open shape.

**Current defense, honestly assessed:** the detector is genuinely well-reasoned for the shapes it targets — its own comments explain, correctly, why a blanket `identifier=\d+` was rejected against this repo's corpus. The gap is a real blind spot, not carelessness, and it is the mechanism that let finding 1 ship.

**Verdict: BREAKS (MED).** Pre-existing gate scope, not introduced by this diff.
Exposure: every unmarked word-form completeness claim in the 2 scanned files, basis: **counted in code** (7 of 7 patterns require an adjacent digit). Irreversibility: low. Silence: **high** — the gate returns PASS, which is the worst property here.

**Named proof-test required:** a failing case in `completeness-claim-checker.test.ts` asserting that a literal "Every remaining one is ... (A, B, C)" sentence is detected as a bare claim; then extend `BARE_CLAIM_PHRASES` with a digit-free quantifier shape (e.g. `/\b(?:every|all|each)\s+remaining\b/i`) and re-run `node src/qa/completeness-claim-checker.ts`.

**Issue:** filed new — not a duplicate of #159 / #163 (different shape, both closed).

---

### 3. [CLEAN][demonstrated] R1 fail-closed correctness under real-world ambiguity — 0/1/2+ discrimination is exactly right, and no file is silently mis-selected

**Attack:** "Two files sharing a basename cause the wrong one to be silently selected instead of failing closed."

**Evidence — independent full-tree harness** (built the same index from `listFilesRecursive`, ran `scanReferences` over every `.md`/`.ts`/`.mjs`/`.yml`/`.json`/`.js` file, once with the real index and once with a `() => []` stub simulating pre-R1 behavior):

```
INDEX: files=361 distinct_basenames=354 unique=349 ambiguous=5
TOP AMBIGUOUS: kernel.ts(3), registry.ts(3), 0000-template.md(2), README.md(2), shell.ts(2)

stub index:  BARE_PATHLINE_UNRESOLVED_UNIQUE(104)  split: ambiguous(2+)=8 zero-match=3 one-match=93
real index:  BARE_PATHLINE_UNRESOLVED_UNIQUE(12)   split: ambiguous(2+)=8 zero-match=3 one-match=1
```

- All **8** ambiguous citations (`kernel.ts` x3, `shell.ts` x5) correctly stayed `unresolved-authority` — fail-closed, never guessed.
- All **3** zero-match citations correctly stayed `unresolved-authority`.
- **93 of 93** one-match citations resolved. The single remaining one-match entry is the new test's own deliberate out-of-range fixture — the bounds check fired against the MATCHED path, as designed.

This also independently confirms the build report's self-corrected "8 ambiguous / 3 zero-match" split, which an earlier draft had overclaimed as "all 11 ambiguous". The final committed wording ("most of those 11 are genuinely ambiguous ... a few remain 0-match") is accurate against my re-run.

**Correctness of the selected file, spot-verified by reading the target lines** — on the diff-scoped run, R1 newly resolved exactly 4 real citations. All 4 point at the right file:

| citation basename | resolved to | correct? |
|---|---|---|
| `reference-resolver.test.ts` | `src/qa/reference-resolver.test.ts` | yes (the pinned malformed-ADR test block) |
| `history-scan.test.ts` | `src/secret-scan/history-scan.test.ts` | yes (the OSS-01 allowlist test) |
| `precedence.test.ts` | `src/policy/rule/precedence.test.ts` | yes (the Issue #114 TRUST_RANK block) |
| `ci.yml` | `.github/workflows/ci.yml` | yes (the `permissions:` block) |

Scanning the 93 newly-resolved basenames for a plausible CROSS-REPO citation — a file named in prose that lives in the `maat` plugin repo or elsewhere and coincidentally has a unique in-repo namesake — found none: all 93 are unambiguously this repo's own `.ts`/`.yml`/`.mjs` sources plus two of this repo's own review reports. **Verdict: SURVIVES.**

---

### 4. [CLEAN][demonstrated] The R2 lookahead produces no live false negative

**Attack:** "A real ADR-id-shaped citation now silently fails to become a candidate at all."

```
$ grep -rn "ADR-[A-Za-z]" docs/ adr/ *.md src/
```

Every hit is genuine prose or a placeholder — the NNNN/XXX/YYY/ZZZ template placeholders, the "ADR-ID" table header, "ADR-cache", "ADR-amendment", "ADR-word", "ADR-id", "ADR-relevant". Zero are real ADR ids. The live before/after diff of the real instrument confirms exactly and only these 10 candidate-removals, and nothing else changed in that class. Total citations 459 -> 449 on the diff-scoped corpus; all 10 removed were genuine false positives.

**The residual I probed for and did not find:** a hyphenated `ADR-<word>-<digits>` shape would now be dropped SILENTLY where it was previously reported loudly, because the character class cannot cross a hyphen. `grep -rnE "ADR-[A-Za-z]+-[0-9]"` across `docs/`, `adr/`, `*.md`, `src/` returns **zero hits** — the shape does not exist in this corpus. Named as a residual, not a finding.

`classifyAdr` confirmed untouched: `git diff -U0 src/qa/reference-resolver.ts | grep classifyAdr` returns only a comment line. **Verdict: SURVIVES.**

---

### 5. [CLEAN][demonstrated] The 4 stub sites genuinely cannot change behavior — and both probes prove it byte-for-byte

**Attack:** "Zero behavior change" is an assertion. One of these probes can actually reach `findByBasename` and now diverges from the real instrument.

Two independent confirmations:

1. **Code-traced unreachability.** 3 of the 4 sites set `pathExists: () => true`, and the entire fallback sits behind `if (!deps.pathExists(path))` — structurally dead: `marker-corpus-probe.ts:40`, `continuation-residual-probe.ts:65`, `continuation-residual-probe.test.ts:51`. The 4th (`continuation-residual-probe.ts:219`, real `pathExists`) CAN reach it, but its 0-match branch returns a byte-identical reason string and the identical `unresolved-authority` verdict, because on that branch the matched path and the cited path are the same value.

2. **Demonstrated.** Ran both probes at HEAD and at the working tree and diffed full stdout:

```
=== marker-corpus-probe diff ===         IDENTICAL
=== continuation-residual-probe diff === IDENTICAL
```

**Verdict: SURVIVES.**

---

### 6. [CLEAN][demonstrated] Test quality — 5 of 5 mutants killed, including the two that would silently guess

Each mutant applied to the shipped source, suite re-run, source restored; APPLIED verified by `diff` on each pass:

```
MUTANT [APPLIED] M1 >1 -> >2  (2 matches silently picks matches[0])     -> pass 84 fail 1 skipped 0
MUTANT [APPLIED] M2 ===0 -> <0 (no-match falls through to the index)     -> pass 84 fail 1 skipped 0
MUTANT [APPLIED] M3 drop the slash guard                                 -> pass 84 fail 1 skipped 0
MUTANT [APPLIED] M4 R2 lookahead made vacuous (required digit -> option) -> pass 81 fail 4 skipped 0
MUTANT [APPLIED] M5 drop the matched-path assignment                     -> pass 83 fail 2 skipped 0
```

M1 is the mutant that matters most — it is precisely "silently select the wrong file instead of failing closed", and the suite kills it. Baseline unmutated: `tests 85 pass 85 fail 0 skipped 0`. **Verdict: SURVIVES.**

---

### 7. [CLEAN][demonstrated] Scope discipline (SE ADR-0006 blast radius) — the diff really is R1 + R2

**Attack:** an opportunistic touch to Issue #154 (comma-continuation residual) or #164 (marker-corpus-probe ref/content mismatch) rode along.

```
$ git diff --stat
 src/qa/continuation-residual-probe.test.ts |   1 +
 src/qa/continuation-residual-probe.ts      |   8 ++
 src/qa/marker-corpus-probe.ts              |   3 +
 src/qa/reference-resolver.test.ts          | 128 +++++++++++
 src/qa/reference-resolver.ts               |  71 ++++++++--
```

The 12 lines across the three probe files are the `findByBasename` stubs plus their explanatory comments — nothing else. A `git diff -U0` grep for `looksLikePath`, the bare repo-relative branch, `TIGHT_DASH`, `CONTINUATION` and `markedVia` returns **nothing**: the bare-path branch, the list-continuation machinery, and `markedVia` are all absent from the diff. `classifyAdr` untouched. `docs/.maat-state.json` still parses as valid JSON after its `priorScope` re-nesting (verified by a live `require`). **Verdict: SURVIVES.**

Supporting green checks: `npx tsc --noEmit` exit 0; `npm run lint` exit 0; `npm test` **769 pass / 0 fail / 0 skipped** — matching the build report's claim exactly.

---

### 8. [SUSPICION][LOW][code-traced] The basename index is a snapshot: adding one colliding file silently flips ~30 unrelated citations, and the index is case-sensitive where `pathExists` is not

**Attack:** the index is assumed stable. It is a single walk of today tree, rebuilt per run.

**Trigger A — collision by addition.** 93 citations now resolve BECAUSE their basename happens to be unique. This codebase already has `src/policy/config/loader.ts` and a naming convention that makes a second `loader.ts` entirely plausible. The moment one lands, every `loader.ts`-plus-line citation across unrelated docs flips to `unresolved-authority` and QA-14 blocking count jumps on a commit that touched none of that prose. **Assessed as acceptable, not a defect:** the direction is fail-closed (never a wrong answer) and the reason string is genuinely loud — it names the match count and states that it is failing closed rather than guessing. The human explicitly ruled this behavior (`docs/decisions.md` 2026-09-13 row 79, ruling 1). Named so it is a known property, not a future surprise.

**Trigger B — platform divergence.** The index keys off exact-case basenames (`fs-walk.ts:26`) while `pathExists` uses `existsSync` (`reference-resolver.ts:786-787`), which is case-insensitive on Windows and case-sensitive on Linux. A wrong-case citation can resolve via the literal `pathExists` on a Windows dev machine and reach the index — which has no matching key — on Linux CI, producing `unresolved-authority`. **Pre-existing**: the `pathExists` half of the divergence predates this diff; R1 does not change its direction, only adds a second exact-case layer behind it.

**Verdict: UNPROVEN (LOW).**
Exposure: trigger A — 93 citations are collision-dependent, basis: **measured**; trigger B — 0 live instances found in the corpus, basis: **measured**. Both non-gating.
**Settles it:** a Linux CI run of the instrument against the same base/head refs, compared with the same command locally. Runnable by whoever next unblocks the QA-14 CI job (tracked under Issues #120 / #27).

---

## Editorial (verdict-neutral, plain edits, no re-review)

- The new resume-point block in `docs/STATE.md` and the `CHANGELOG.md` entry both state the measurement as 305 -> 133 (of 3764 -> 3712). My independent re-run gives 299 -> 132 (of 3760 -> 3710). The gap is small and fully consistent with concurrent edits landing in the tree during this review — `docs/REVIEW_LOG.md` and two new review reports appeared mid-session from the parallel reviewers. I make **no claim these figures were wrong when measured**; they are simply already drifting, which is the argument for finding 1 fix.
- The build report cites its reproduction command with a zero-sha placeholder. The literal git empty-tree sha yields VACUOUS-PASS, and a root-commit base crashes with `EISDIR` on the `adr` submodule gitlink (pre-existing, unrelated to this diff). Only the 40-zero sentinel actually works. Worth writing the exact working invocation into the entry so the next reader reproduces it first try.
- `docs/decisions.md` row 79 cites the pinned regression test at a line number two lines before the test it names. The resolver only bounds-checks lines, never content, so this passes the gate — harmless, but it is the very citation the entry holds up as the pinned test.

---

## Single scariest unproven assumption

**A unique basename means the cited file.** R1 fail-closed design correctly refuses to choose between 2+ candidates, but it treats 1 candidate as proof of identity. In a 361-file repo with 349 unique basenames that is safe today, and I measured it as safe — 93 of 93 newly-resolved citations point inside this repo, 4 of 4 spot-verified by reading the target lines. The assumption degrades silently as the repo grows, or as prose starts citing files from sibling repos (the `maat` plugin own command docs are exactly the shapes that would land here). It is loud when it collides and silent when it coincides.

## Go / no-go

**go.** No HIGH. Both R1 and R2 survive corpus, mutation, dependency, stub-reachability, and scope attacks, with 5/5 mutants killed and demonstrated byte-identical behavior at all four stub sites. The two MED findings are a doc-prose defect (finding 1, already tracked as #166, a same-commit edit) and a pre-existing gate blind spot (finding 2, tracked separately).

## Single next action

Neutralize the ADR-id-shaped example tokens in `CHANGELOG.md` and `docs/STATE.md` — use zero-digit forms, which this diff own R2 rule makes inert — then re-run the instrument with the 40-zero sentinel base and write the number it actually prints into those files. One edit closes #166 and removes the 12 self-inflicted blocking citations.

---

## Open findings vs failing tests

Open findings: **2**. Named failing tests: **1** (finding 2 `completeness-claim-checker.test.ts` bare-claim case). Finding 1 has no executable test form in this repo — its assertion is that the number written in a markdown file equals the number the instrument prints, which is exactly what the completeness-marker mechanism exists for; the correct executable form is a marker on that CHANGELOG line, which is itself blocked on finding 2 detector gap. Stated rather than forced into a fake test.

---

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Close-out prose in CHANGELOG.md/STATE.md adds 12 new blocking QA-14 citations (unparseable 2->12, unresolved-authority 117->119; full tree 132->144) by quoting live ADR-id-shaped example tokens; the source file own "real examples deliberately avoided" discipline was not applied to the .md files QA-14 also scans, so the advertised 133 is unreproducible on the shipped tree and the "every remaining one is (three ids)" enumeration is false - a fourth exists. Already tracked as #166 - commented, not duplicated.
2. [ISSUE][MED][demonstrated] QA-15 PASSes on that false claim: all 7 BARE_CLAIM_PHRASES patterns (completeness-claim-checker.ts:103-116) require a digit adjacent to the quantifier, so word-form enumerations are invisible; CHANGELOG.md is in DEFAULT_FILES, so the file was scanned and cleared. Pre-existing gate gap, distinct from closed #159/#163.
3. [CLEAN][demonstrated] R1 fail-closed 0/1/2+ discrimination exact: bare-filename unresolved 104->12, split 8 ambiguous / 3 zero-match / 1 out-of-range; all 8 ambiguous fail closed; 93/93 one-match resolved; 4/4 newly-resolved spot-verified as the correct file by reading target lines; no cross-repo namesake among the 93.
4. [CLEAN][demonstrated] R2 lookahead has no live false negative: all 10 removed candidates are genuine prose/placeholders, 459->449 citations; zero hyphenated ADR-word-digit shapes exist in the corpus; classifyAdr byte-identical.
5. [CLEAN][demonstrated] 4 stub sites inert: 3 set pathExists to always-true (fallback structurally dead, code-traced), the 4th returns a byte-identical reason/verdict; both probes full stdout IDENTICAL at HEAD vs working tree.
6. [CLEAN][demonstrated] Test quality: 5/5 mutants killed (>1 to >2, ===0 to <0, drop slash guard, vacuous R2 lookahead, drop matched-path assignment); baseline 85/85, full suite 769 pass / 0 fail / 0 skipped.
7. [CLEAN][demonstrated] Scope discipline (SE ADR-0006 MUST NOT widen scope opportunistically): #154/#164 untouched; looksLikePath, bare-path branch, continuation/markedVia machinery absent from the diff; the 12 probe-file lines are compile-forced stubs only; tsc and lint clean.
8. [SUSPICION][LOW][code-traced] Basename index is a per-run snapshot: 93 citations are collision-dependent (a second loader.ts flips ~12 unrelated ones), and index keys are exact-case while pathExists uses case-insensitive existsSync on Windows - a Windows/Linux verdict divergence. Both fail-closed and loud; 0 live instances of the case divergence found.
counts (a CHECKSUM - MUST equal the 8 lines above): issues=2 suspicions=1 clean=5
evidence (a CHECKSUM over the tags above, totalling the counts line): demonstrated=7 code-traced=1 derived=0
checks=npx tsc --noEmit exit 0; npm run lint exit 0; npm test 769 pass / 0 fail / 0 skipped; reference-resolver.test.ts 85 pass / 0 fail / 0 skipped; 5 mutants applied+reverted, 5/5 killed; full-tree instrument run across 3 tree states (299/132/144 blocking); marker-corpus-probe + continuation-residual-probe before/after stdout diff IDENTICAL; node src/qa/completeness-claim-checker.ts PASS (2 files); independent 361-file basename-index harness (349 unique / 5 ambiguous)
adr=HIT(35)
report=docs/reviews/qa14-issue137-precision-fastfollow-red-team-2026-09-13.md
