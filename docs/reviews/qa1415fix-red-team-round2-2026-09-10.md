# Red Team (Sutekh) — `qa1415fix` round 2 re-confirm

- **Date:** 2026-09-10
- **Scope:** branch `fix/qa1415-issue-existence-and-decisions-scope`, commit `bc2b984` (parent `d05ca33`, no rebase)
- **Round:** 2 (re-confirm of my round-1 `no-go` on `d05ca33` — `docs/reviews/qa1415fix-red-team-2026-09-10.md`)
- **Tier:** CRITICAL (ratified — `.github/workflows/ci.yml` is a CLAUDE.md-named sensitive area)
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`
- **ADRs read for this attack surface (testing / quality gates / blast radius / self-protection):** software-engineering ADR-0005 (testing strategy), ADR-0006 (blast-radius control), ADR-0010 (code-quality and maintainability gates), ADR-0019 (reference-port fidelity and self-protection), ADR-0021 (thoth-native architecture); devops ADR-0008 (CI/CD gates and policy-as-code).
- **Verdict: `go`.** All five round-1 findings are genuinely closed, re-verified by my own instruments and my own re-applied mutants — not taken on the implementer's word. Two NEW MED defects were introduced by this round's own regex work; neither gates ship, both are filed.

---

## What I actually ran (raw)

```
$ npm test                       (at bc2b984, clean tree)
tests 684  pass 684  fail 0  skipped 0  todo 0  duration_ms 27204

$ npm run typecheck              -> tsc --noEmit -p tsconfig.json   (clean, no output)
$ npm run lint                   -> eslint .                        (clean, no output)

$ node src/qa/reference-resolver.ts   (default diff scope = d05ca33..bc2b984)
[QA-14 reference-resolver] FAIL: 27 of 572 citation(s) failed to resolve.
$ echo $?   ->  1
```

Mutants re-applied by me, one at a time, each reverted before the next (tree verified clean by
`git status --porcelain` between runs):

| # | Mutation | Site | Result |
|---|---|---|---|
| M1 (round-1 mutant, re-applied) | `issueExists: (n) => issueCache.get(n) ?? null` -> `issueExists: () => true` | `src/qa/reference-resolver.ts:395` | **CAUGHT** — `tests 684 / pass 683 / fail 1`: `QA-14 (Issue #140): resolveIssueCitations' real end-to-end wiring rejects a fabricated issue citation` |
| M2 (round-1 mutant, re-applied) | `export const DEFAULT_FILES = ["docs/STATE.md","CHANGELOG.md"]` -> `[]` | `src/qa/completeness-claim-checker.ts:201` | **CAUGHT** — `tests 684 / pass 682 / fail 2`: both Issue-#142 ratchet tests |
| M6 (new) | `ISSUE_CANDIDATE_RE` reverted to the round-1 broken form | `src/qa/reference-resolver.ts:80` | **CAUGHT** — `fail 1`, the whole `reference-resolver.test.ts` file fails |
| M7 (new) | `if (queriedIssueNumbers.size > maxDistinctIssues)` -> `if (false && ...)` | `src/qa/reference-resolver.ts:376` | **CAUGHT** — `fail 1`: `QA-14 (Issue #141): ... enforces the maxDistinctIssues cap loudly, spending ZERO gh calls once exceeded` |

Both round-1 mutants are dead. The regex fix and the cap are themselves ratcheted (M6/M7).

### My own re-measurement of the regex fix (I did not reuse the implementer's numbers)

Harness: extracts the three candidate regexes **verbatim from the shipped `src/qa/reference-resolver.ts` at `bc2b984`**, then counts every `#` + digits occurrence in each scanned file and how many are covered by a candidate match.

```
ISSUE_CANDIDATE_RE   = /\b[\w.-]+\/[\w.-]+#\d+(?!\w)|#\d+(?!\w)/g
ISSUE_WORD_CANDIDATE = /\bIssue\s*#\d+/gi
MILESTONE_CANDIDATE  = /\bMilestone\s*#\d+/gi

diff scope (d05ca33..bc2b984): files=10   occurrences total=723   covered=723   UNMATCHED=0
full tree                    : files=210  occurrences total=3496  covered=3489  UNMATCHED=7
```

All 7 full-tree residuals are mixed-alphanumeric CSS hex literals in `docs/dashboard.mjs`
(`#0f1115`, `#171a21`, `#2a2f3a`, `#e6e9ef`, `#9aa3b2`, `#5b8cff`, `#22262f`) — the `(?!\w)`
false-positive guard working exactly as documented. **The HIGH boundary bug is really fixed.**

Distinct `gh issue view` fan-out, measured through the real `scanReferences`:

```
diff scope   (10 files): 100 distinct issue numbers  (cap 300, headroom 200)
branch scope (13 files): 105 distinct                (cap 300, headroom 195)
full tree   (210 files): 116 distinct                (cap 300, headroom 184)
```

---

## Round-1 findings — resolution status

### #139 [HIGH, round 1] regex boundary bug — **RESOLVED / SURVIVES**

The human chose "fix it properly" over the disclose-only fallback, and that is what landed. The
`\b`-in-front-of-an-optional-group defect is replaced with two separately-anchored alternatives
(`src/qa/reference-resolver.ts:80`). Independently re-measured above: **0/723 unmatched on diff
scope, 7/3496 full-tree with every residual explained and intentional.** Ratcheted by M6 — a revert
to the old pattern fails the suite. The named citation forms from my round-1 report all pass, which
I confirmed by running the shipped module directly:

```
"Closes #120."                 -> raw="#120"  kind=issue      verdict=resolved
"A parenthetical (#121)."      -> raw="#121"  kind=issue      verdict=resolved
"#122 at line start."          -> raw="#122"  kind=issue      verdict=resolved
"Milestone #23."               -> raw="Milestone #23" kind=milestone verdict=resolved
```

**On the new `milestone` citation kind:** I accept the implementer's framing that this is the
minimal correct consequence of fixing the boundary, not scope creep — once a bare `#N` after
whitespace matches, `Milestone #23` *would* have been looked up in the Issues namespace, which is a
wrong-entity verification. Attacking it directly, I could not construct a case where a genuine
*Issue* citation is stolen by the milestone branch in text that exists in this tree today (measured:
0 occurrences of the one ambiguous shape — see NEW-4). It does introduce an unverified
`verdict: "resolved"` (`reference-resolver.ts:104-111`), but that is honest: the reason string says
so, and the round-1 state was "never seen at all", which is strictly worse. **SURVIVES.**

### #138 [MED, round 1] false "exits 0" claim in `docs/decisions.md` — **RESOLVED (with a convention disagreement, LOW)**

The corrected text is factually true — I verified the underlying fact myself rather than the edit:
`node src/qa/reference-resolver.ts` really does exit **1** at `bc2b984` on its own diff scope
(raw exit code above). The correction is right. I **disagree with the mechanism**, at LOW severity.
See NEW-6.

### #140 [MED, round 1] `main()` two-pass wiring had zero coverage — **RESOLVED / SURVIVES**

`resolveIssueCitations` is extracted and exported (`reference-resolver.ts:353-403`) with a `Runner`
seam, and `main()` is now a thin caller. **My own round-1 M1 mutant, re-applied verbatim, is caught**
(table above), by a negative test *and* a positive control. That is the pair I asked for. **SURVIVES.**

### #141 [MED, round 1] unbounded/uncached `gh` fan-out — **RESOLVED / SURVIVES (mitigation, honestly labelled)**

Spot-checked for real effectiveness, not presence:

- The cap test asserts `capExceeded === true`, `distinctIssueNumbers === 3`, **`calls === 0`** and
  `citations.length === 0`. Asserting *zero* `gh` calls is the right assertion — it proves the cap
  fires *before* spending budget, not after. M7 confirms it is load-bearing.
- The dedup test asserts `calls === 1` for `#7` cited three times across two files, **and** asserts
  the exact `gh` argv. Breaking dedup fails it on an exact count, not a range.
- Measured headroom: 100/300 on diff scope, 116/300 full tree. The cap will not fire spuriously.

Honest assessment of what this *is*: a loud circuit-breaker, not batching or cross-run caching.
Every CI run still issues ~100 sequential `gh issue view` calls. That is within the documented
~1,000/hr/repo budget for a handful of concurrent runs, and sequential rather than bursty, so I am
not blocking on it — but "the rate-limit problem is solved" would be an overstatement; "the
rate-limit problem now fails loudly instead of silently degrading" is accurate, and that is what the
code and its comment actually claim. **SURVIVES.**

### #142 [MED, round 1] `DEFAULT_FILES` narrowing had no instrument — **RESOLVED / SURVIVES**

Three tests: exact membership, explicit `docs/decisions.md` exclusion, non-empty. My M2 mutant is
caught by two of them. I also checked the ratchet is not decorative — that the pinned array is the
gate's *real* live scope and is not bypassed by CI passing explicit paths:

```
package.json : "qa:completeness-claims": "node src/qa/completeness-claim-checker.ts"
ci.yml:234   : run: node src/qa/completeness-claim-checker.ts
```

No arguments in either place, so `main()` falls through to `DEFAULT_FILES`. The ratchet pins what CI
actually scans. **SURVIVES.**

### Issue #137 scope — **CONFIRMED UNTOUCHED**

`node src/qa/reference-resolver.ts` on diff scope: **27 of 572 citations fail, exit 1** — exactly the
implementer's claim, measured by me. I read all 27: 20 are path / path-plus-line non-existence, 3 are
ADR-shape `unparseable`, 3 are cross-repo, 1 is the `#999999` fabricated fixture quoted in a review
report. **None** belong to any of the new classes this round introduced. The #137 tracked gap is
neither fixed nor worsened by this round.

---

## NEW findings, ranked by blast radius

### NEW-1 [MED] [demonstrated] — non-citation `#N` ordinals (`Finding #N`, `Build task #N`, `suspicion #N`) are classified and reported as *resolved Issue citations*

**Attack.** The round-2 fix correctly reasoned that `Milestone #N` is a different GitHub namespace
from `Issue #N` and must not be looked up as an issue. It stopped at exactly one such namespace. This
repo's prose uses `#N` as a plain **ordinal** at least as often: `Finding #1`, `Build task #1`,
`suspicion #4`, `round #N`. With the boundary fixed, every one of those now reaches `classifyIssue`.

**Scenario.** A reviewer writes "design-challenger Finding #2" in `CHANGELOG.md`. QA-14 issues
`gh issue view 2`, finds that Issue #2 exists (this repo is at #142), and reports
`kind=issue verdict=resolved — "issue confirmed to exist"`. The instrument has just certified a
reference to an entity it never looked at. This is live **today, on this diff's own scan scope**.

**Demonstrated** — every `#1`/`#2`/`#4`/`#6` match in `CHANGELOG.md` (in the current QA-14 scan
scope), with 14 chars of leading context, produced by running the shipped `ISSUE_CANDIDATE_RE`:

```
#1: 3 matches   " **Build task >>#1<< (counci"
                " **Build task >>#1<< (counci"
                "enger Finding >>#1<<), `stri"
#2: 1 match     "enger Finding >>#2<< - `-C`/"
#4: 2 matches   "enger Finding >>#4<<, tracke"
                "e's suspicion >>#4<< (whethe"
#6: 1 match     "enger Finding >>#6<< (SURVIV"
```

Seven matches; **zero** of them are issue references. Through the real shipped `scanReferences` with
a repo-accurate `issueExists` (issues 1..142 exist):

```
A. 'Finding #N' ordinal (CHANGELOG.md:190, verbatim)
   raw="#1" kind=issue verdict=resolved :: issue confirmed to exist
```

A second instance of the same class, an HTML numeric character entity at `docs/dashboard.mjs:33`
(the source text is the escape-map entry that renders an apostrophe, `&` `#39` `;`):

```
B. HTML numeric entity (docs/dashboard.mjs:33, verbatim)
   raw="#39" kind=issue verdict=resolved :: issue confirmed to exist
```

**Current defense, honestly assessed.** None. `scanReferences` (`reference-resolver.ts:217-223`) has
a `precedingWord` guard for exactly two words, `issue` and `milestone`. `Finding`, `task`, `round`,
`suspicion` and `&` are not among them.

**Exposure: 7 of 572 citations (~1.2%) on this diff's own scan scope, plus 77 `Finding #N`
occurrences across 20 files and 1 HTML numeric entity tree-wide. Basis: measured (`git ls-files`
plus the shipped regex).**

**Blast-radius honesty — why MED and not HIGH.** It never lets a genuinely broken citation through
and never blocks a correct change today; the damage is that the instrument's "N citations, all
resolved" headline silently overstates what it verified, plus ~7 wasted `gh` calls per run. It
becomes a *false CI failure* only if an ordinal exceeds the repo's max issue number (today 142;
findings run to about #12), which is not reachable soon. But it is silent, and it is the identical
namespace-conflation defect this round consciously fixed for `Milestone`.

**Verdict: BREAKS.**
**Named proof-test required:** `QA-14 (NEW-1): an ordinal shorthand ("Finding #2", "Build task #1",
"suspicion #4") and an HTML numeric entity are NOT classified as issue citations` in
`src/qa/reference-resolver.test.ts`, asserting `citations.filter(c => c.kind === "issue").length === 0`
for each shape. Filed as a GitHub Issue; not a merge gate.

---

### NEW-2 [MED] [demonstrated] — the shipped comment's "none exist in this tree today (checked)" is **false**, and the all-digit hex colour it denies is a live hard-fail

**Attack.** `reference-resolver.ts:77-79` justifies the `(?!\w)` guard's residual risk with:

> "A fully-numeric hex color (all-digit, no hex letters) would remain genuinely ambiguous with a real
> issue number; **none exist in this tree today (checked)**, so this is a documented, not a live, gap."

That sentence is (a) a *completeness claim over the whole tree*, (b) **hand-derived** — CLAUDE.md's
"No hand-derived completeness claims" hard rule requires a running instrument, and this is a file in
the QA instrument family whose sibling gate exists to catch exactly that class of claim — and (c)
**factually wrong**.

**Demonstrated.** Instrument over `git ls-files`, all-digit hex literal in a CSS property context:

```
  docs/dashboard.mjs:646  "background:#000"
ALL-DIGIT hex colour literals in CSS property context, tree-wide = 1
```

And through the real shipped `scanReferences`, on that verbatim line:

```
C. all-digit CSS hex colour (docs/dashboard.mjs:646, verbatim)
   raw="#000" kind=issue verdict=unresolved-authority :: Issue #0 does not exist in this repository
```

**Scenario with a plausible production trigger.** `docs/dashboard.mjs` is plugin-managed — its last
change was `3b8d3eb chore(maat): refresh plugin-managed docs/scripts via /maat:init --update`. The
*next* such refresh puts it in the PR diff, and QA-14 hard-fails CI with
`[unresolved-authority] #000 — Issue #0 does not exist in this repository` on a file the author never
semantically touched. There is no suppression mechanism; the only escapes are editing vendored CSS or
setting the whole gate aside.

**Current defense, honestly assessed.** The `(?!\w)` guard defends only *mixed* hex literals (it
provably handles the other 7 in the same file). Nothing defends all-digit ones, and the comment
asserting none exist is the *only* stated control — an assertion, not a control.

**Exposure: 1 file / 1 literal; 0% of runs today (`docs/dashboard.mjs` is not in the current diff
scope), rising to 100% of any run whose diff includes it. Basis: counted in code.** The failure is
loud, self-describing and reversible, which is why this is MED, not HIGH — but the governance half (a
false hand-derived completeness claim shipped as a risk justification in a CRITICAL-tier diff) is why
it does not drop to LOW.

**Verdict: BREAKS.**
**Named proof-test required:** `QA-14 (NEW-2): an all-digit CSS hex colour literal (#000, #333) in a
style block is not classified as an issue citation`, plus replacing the prose "checked" with the
generating one-liner (the `git ls-files` scan above) or a test asserting the tree contains no
unhandled all-digit hex literal. Filed as a GitHub Issue; not a merge gate.

---

### NEW-3 [LOW] [demonstrated] — the new `precedingWord` guard *silently drops* `Issue owner/repo#N` entirely

**Attack.** `reference-resolver.ts:220` skips any `ISSUE_CANDIDATE_RE` match preceded by
`/\b(?:issue|milestone)\s*$/i`, on the stated ground that "its own word-form pass already recorded
it". For the **cross-repo** alternative that premise is false: `ISSUE_WORD_CANDIDATE_RE` is
`/\bIssue\s*#\d+/gi`, which cannot match across an intervening owner/repo slug. So the word-form
pass does *not* record it, and the guard drops it.

**Demonstrated**, through the shipped module:

```
D. "Issue anthropics/claude-code#18846" (word-prefixed cross-repo)
   (no issue/milestone citations)
```

Zero citations — a silent skip, which is precisely the QA-16 doctrine violation this file's own
header (`reference-resolver.ts:5-6`) declares unacceptable.

**Current defense:** none. **Exposure: 0 occurrences tree-wide today. Basis: measured** — the shape
`(issue|milestone)s? <slug>#N`, scanned over `git ls-files`, returns 0. This repo writes the bare
`anthropics/claude-code#18846` form, never the word-prefixed one.

**Verdict: BREAKS (latent).** Zero live exposure, so LOW and no Issue filed. Fold the fix into
NEW-1's test: restrict the guard to the bare alternative (only skip when the match starts with a
hash).

---

### NEW-4 [LOW] [demonstrated] — `MILESTONE_CANDIDATE_RE` and the guard both span newlines, so a line-start Issue citation after a line ending in "milestone" is mis-kinded and auto-resolved

**Attack.** `MILESTONE_CANDIDATE_RE = /\bMilestone\s*#\d+/gi` — `\s` includes a newline. A markdown
line ending in the word "milestone", followed by a line starting with a real hash-N issue citation,
is captured as one milestone reference spanning the break, and `classifyMilestone` returns
`verdict: "resolved"` unconditionally without ever querying the Issues API.

**Demonstrated:**

```
E. line ends in the word "milestone", next line starts "#120"
   raw="milestone #120" kind=milestone verdict=resolved
     :: GitHub Milestone reference ... not verified against a live milestone list in this pass
```

A genuine Issue citation, silently reclassified and auto-passed. (The symmetric `Issue\s*#\d+` case
is harmless — it still lands in `verifyLocalIssue` with the right number.)

**Current defense:** none. **Exposure: 0 occurrences tree-wide today. Basis: measured** — the shape
"milestone, newline, hash-N" scanned over `git ls-files` returns 0.

**Verdict: BREAKS (latent).** LOW, no Issue. One-token fix: replace `\s*` with a space/tab class in
both `MILESTONE_CANDIDATE_RE` and the `precedingWord` guard.

---

### NEW-5 [LOW] [code-traced] — `DEFAULT_MAX_DISTINCT_ISSUES` parses its env override with no validation: NaN fails the cap **open**, empty string fails it **shut**

`reference-resolver.ts:334`:

```ts
export const DEFAULT_MAX_DISTINCT_ISSUES = Number(process.env.QA14_MAX_ISSUES ?? 300);
```

- `QA14_MAX_ISSUES` set to a non-numeric typo yields `NaN`. `queriedIssueNumbers.size > NaN` is
  always `false`, so the cap **never fires** — the Issue #141 guard silently disappears, which is the
  exact silent-degradation failure mode the cap was added to prevent.
- `QA14_MAX_ISSUES` set to the empty string yields `0` (and the `??` operator does not catch an
  empty string), so the cap fires on every run. GitHub Actions renders an unset `vars.X` or
  `secrets.X` interpolation as the empty string, which makes this reachable by a plausible workflow
  edit.

**Current defense:** none. **Exposure: 0% of runs today — `QA14_MAX_ISSUES` is set nowhere in
`.github/workflows/ci.yml` or `package.json` (grepped), so the 300 default is what runs.
Basis: counted in code.**

**Verdict: BREAKS (latent).** LOW, no Issue. Fix: accept the override only when it parses to a finite
positive number, and warn loudly when it does not.

---

### NEW-6 [LOW] [code-traced] — I disagree with the `docs/decisions.md` in-place correction; it should have been a strikethrough, not a deletion

**What happened.** The 2026-09-10 build-complete row's false fragment (the claim that
`node src/qa/reference-resolver.ts` exits 0 at HEAD) was **deleted** from the row and replaced with
an appended "Correction (round 2, Issue #138 ...)" clause, plus a new round-2 row.

**Why I disagree.** The implementer's stated justification is a carve-out — "this row has not yet
been activated by a merge/ship" — that the project's own written conventions do not contain:

- `docs/decisions.md:8` states the mechanism: "Supersede in place ... **strike the old row through**
  ... keep the history, **never delete it**. New decision gets its own row."
- CLAUDE.md's Issue Discipline section 1 states the same philosophy and allows exactly one exception:
  "an obvious same-session typo fix **before anyone has acted on** the issue." A false verification
  claim is not a typo, and someone **had** acted on it — I filed Issue #138 against that exact
  sentence in round 1.
- Most decisive: `docs/decisions.md`'s own **2026-09-09** row sets the opposite precedent one day
  earlier, in this same file, for this same class of correction: "Corrected via a same-turn comment
  on Issue #27 (**not a report edit** — the report stays as red-team wrote it, the correction is a
  separate, dated comment, **per this file's own append-only convention**...)."

**Substantive harm: none.** The correction clause quotes the original false claim verbatim in prose,
and the round-2 row repeats it, so nothing is actually lost and git history holds the rest. The
zero-cost convention-faithful option was available and was not taken.

**Exposure: 1 row, 0 readers misled. Basis: counted in code.** LOW, verdict-neutral, no Issue filed.
Remedy is one edit: restore the deleted fragment wrapped in strikethrough and keep the correction
clause.

---

## Observation (routes to Issue #137, not a finding)

`shouldScanFile` exempts `*.test.ts` but not `docs/reviews/*.md`. Review reports legitimately quote
fabricated citations as evidence (the 999999 fixture, `owner/repo`-slug examples, the `ADR-NNNN`
placeholder), so every dated report this workflow writes seeds future QA-14 failures the moment its
file re-enters a diff — 4 of the current 27 failures are already of this kind, and **this report adds
more**. That is Issue #137's citation-precision territory (a report-fixture exemption is the same
distinction `.test.ts` already gets), not this story's. Noted for the #137 thread, deliberately not
filed separately.

## Editorial (uncounted, verdict-neutral)

1. `reference-resolver.ts:56` — the boundary-fix comment's first line runs to about 140 columns while
   the rest of the block wraps at about 100; cosmetic only.
2. `reference-resolver.ts:86` and `:348` — two mid-sentence line breaks left over from editing
   ("...the fixed boundary / above...", "Before this, only / checkIssueViaGh..."); cosmetic only.
3. `reference-resolver.ts:326-327` — the comment cites "71 distinct numbers on this diff's own
   changed-file scope, 101 full-tree" as the sizing basis, but those are **pre-fix** figures.
   Measured post-fix: **100 diff-scope / 116 full-tree**. The 300 cap is still correctly sized; the
   stated basis is stale. Worth a one-line refresh so the next person sizing this cap is not reading
   a number that no longer describes the code above it.

---

## The single scariest unproven assumption

**That `Milestone` was the only namespace a bare hash-N collides with.** The round-2 fix reasoned its
way correctly to one namespace conflation, fixed it, and stopped — while this repo's own prose uses
hash-N as a bare ordinal (`Finding #N`, `Build task #N`, `suspicion #N`) 77+ times across 20 files,
and the instrument now certifies every one of them as a verified Issue reference. The regex was fixed
properly; the *classification* behind it is still calibrated to one example rather than to a measured
inventory of what hash-N actually means in this tree.

## Go / no-go

**`go`.** Every round-1 finding is independently reconstructed as closed — both of my own mutants
re-applied and caught, the regex fix re-measured at 0/723 unmatched on diff scope, the cap and the
ratchet each proven load-bearing by a fresh mutant, and Issue #137's 27-failure scope confirmed
unmoved. The two new MEDs are real but neither is silent-and-irreversible nor blocks a correct change
today; they belong on the board, not in another round. Blocking here would be ceremony, not risk
reduction.

## Single next action

File NEW-1 and NEW-2 as `bug` / `severity:med` / `qa` Issues (done, same turn), then merge. The two
named proof-tests land with whichever story next touches `src/qa/reference-resolver.ts`.

---

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Non-citation hash-N ordinals (Finding #N x77 across 20 files, "Build task #1", "suspicion #4", and an HTML numeric entity) are classified as issue citations and reported `resolved` without the cited entity ever being checked — 7 live on this diff's own scan scope; current defense is a precedingWord guard covering only the two words "issue" and "milestone"
2. [ISSUE][MED][demonstrated] docs/dashboard.mjs:646 `background:#000` classifies as Issue #0 and hard-fails QA-14 on any diff touching that plugin-managed file; the shipped comment at reference-resolver.ts:78-79 ("none exist in this tree today (checked)") is a hand-derived completeness claim (CLAUDE.md hard rule) and is demonstrably false — my instrument found exactly 1
3. [ISSUE][LOW][demonstrated] The new precedingWord guard silently drops "Issue owner/repo#N" entirely (the word-form pass cannot match across the slug, so nothing records it) — a QA-16 silent-skip violation; 0 occurrences tree-wide today
4. [ISSUE][LOW][demonstrated] MILESTONE_CANDIDATE_RE and the guard both span newlines, so a line-start real Issue citation after a line ending in "milestone" is mis-kinded as `milestone` and auto-`resolved` unverified; 0 occurrences today
5. [ISSUE][LOW][code-traced] DEFAULT_MAX_DISTINCT_ISSUES = Number(env ?? 300) is unvalidated — NaN fails the Issue #141 cap OPEN silently, empty string fails it SHUT every run; env not set in CI today
6. [ISSUE][LOW][code-traced] docs/decisions.md false fragment deleted rather than struck through — contradicts decisions.md:8, CLAUDE.md Issue-Discipline section 1, and the file's own 2026-09-09 precedent; content preserved in prose, zero substantive loss
7. [CLEAN][demonstrated] Issue #139 HIGH regex boundary bug — re-measured by me: 0/723 unmatched on diff scope, 7/3496 full-tree (all 7 mixed-hex literals, guard working as designed); M6 revert-mutant CAUGHT; all 4 named round-1 citation forms classify correctly — SURVIVES
8. [CLEAN][demonstrated] Issue #140 wiring coverage — my own round-1 M1 mutant (issueExists: () => true) re-applied verbatim and CAUGHT (684/683/1); negative test plus positive control both present — SURVIVES
9. [CLEAN][demonstrated] Issue #142 DEFAULT_FILES ratchet — my own round-1 M2 mutant (DEFAULT_FILES = []) re-applied and CAUGHT (684/682/2); ci.yml and package.json pass no args, so the pinned array is the real live scope — SURVIVES
10. [CLEAN][demonstrated] Issue #141 cap plus dedup — M7 (cap disabled) CAUGHT; cap test asserts ZERO gh calls, dedup test asserts exact argv and calls===1; measured headroom 100/300 diff, 116/300 full-tree; a loud circuit-breaker not batching, and honestly labelled as such — SURVIVES
11. [CLEAN][demonstrated] Issue #137 scope untouched — instrument re-run: exactly 27 of 572 fail, real exit code 1; read all 27, none of the new classes — SURVIVES
12. [CLEAN][demonstrated] Issue #138 correction is factually correct — I verified node src/qa/reference-resolver.ts really does exit 1 at HEAD — SURVIVES (mechanism disagreement tracked separately as finding 6)
counts (CHECKSUM): issues=6 suspicions=0 clean=6
evidence (CHECKSUM): demonstrated=9 code-traced=3 derived=0
checks=npm test 684 pass / 0 fail / 0 skipped; npm run typecheck clean; npm run lint clean; 4 mutants applied+reverted (M1, M2, M6, M7) ALL CAUGHT; QA-14 real run 27/572 fail exit 1; independent regex re-measurement 0/723 diff-scope and 7/3496 full-tree unmatched; gh fan-out 100/105/116 distinct vs cap 300
adr=HIT(35)
report=docs/reviews/qa1415fix-red-team-round2-2026-09-10.md
