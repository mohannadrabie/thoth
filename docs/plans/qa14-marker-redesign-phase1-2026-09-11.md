# QA-14 bare-`#N` issue-citation classification redesign — Phase 1 plan

**Date:** 2026-09-11
**Author:** story-implementer (Ptah)
**Scope:** `src/qa/reference-resolver.ts` + `src/qa/reference-resolver.test.ts` only — `classifyIssue`/`ISSUE_CANDIDATE_RE`'s bare-issue-matching code path. Covers Issue #137 finding (c) (R3) + reopened #143 (R4) + reopened #144 (R5) + #145 (R6).
**Explicitly out of scope:** R1 (bare-filename path resolution, `classifyPath`) and R2 (`ADR_CANDIDATE_RE` 4-digit tightening) — different code path, ruled deferred, `docs/decisions.md` 2026-09-11 row 61.

ADR cache: `📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ≈17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`

---

## 0. Readiness

Every fact this plan needs is either grounded in the story brief, `docs/decisions.md`'s 2026-09-11 rows 60/61, `docs/reviews/qa1415fix-red-team-round3-2026-09-10.md`, the current shipped source, or a real grep/probe I ran against this repo's own tracked corpus (below). No invented fact. **No blocking questions remain** — see step 4.

## 1. ADR review (mandatory gate)

No ADR in either `adr/devops` or `adr/software-engineering` governs QA instrument internals, citation-classification regex design, or CI-gate blocking/non-blocking semantics. Scanned `adrCatalog.adrs` (35 entries) for anything `applicableTo` a QA/CI-instrument-correctness or evidence-trail surface — none match; the closest is process/CI-pipeline ADRs (ADR-0001, ADR-0008), which govern *whether a PR may merge with a gate open/failing*, not *how a specific instrument computes pass/fail*. This story doesn't change gate wiring (`.github/workflows/ci.yml` is untouched) or merge policy — it changes what one instrument's classification function returns.

**Verdict: NOT-APPLICABLE, all 35.** No ADR is a constraint on this story. **No ADRs govern this change** beyond the general "ADR outranks convention" rule (rule 9), which has nothing to apply against here.

## 2. Restatement + acceptance criteria

**One sentence:** Replace the ordinal/hex-literal denylist in `classifyIssue`'s bare-`#N` matching with a positive, explicit-citation-marker requirement, and route everything that doesn't carry a marker to a new, non-blocking `unclassified` result kind that is always reported and counted, never silently resolved and never silently dropped.

1. **R3.** A bare `reponame#N` citation with no `owner/` prefix (real in-tree example: `` `claude-mem#2604` ``, `docs/reviews/userpromptsubmit-halt-relay-debug-2026-09-07.md:91`) classifies `unclassified` — never `cross-repo-issue` (asserting cross-repo for an owner-less shape is itself a directional guess, per the 2026-09-11 ruling) and never routed through `issueExists`/`verifyLocalIssue` as a local number.
2. **R4.** Every ordinal/count-word-adjacent bare `#N` shape — the 9 words the existing denylist already names, red-team's ≥12 named residual shapes (`items`, `rule`, `criterion`, `Next`, `recommendation`, `residual`, `Coverage gap`, `HIGH #N`, `LOW #N`, open-paren, backtick, angle-marker forms), **and any future unlisted ordinal word** — classifies `unclassified`, never `resolved`. Achieved structurally (no word is ever enumerated as "excluded"), not by extending the denylist.
3. **R5.** An all-digit hex literal (`#000`, `#333`) quoted in prose or backticks (not just the already-fixed `property:#000` CSS-declaration shape) classifies `unclassified`, never `unresolved-authority`/"Issue #0 does not exist."
4. **R6.** A real issue citation immediately following an excluded/ordinal-adjacent term in the same comma/slash/"and"/dash-range list (e.g. `findings #118/#119`, both real GitHub Issues) is never silently dropped — it appears in the report as `unclassified` (loud, counted in `details` and in the summary line), never a zero-citation silent omission.
5. **Non-blocking bucket (ruled, `docs/decisions.md` row 61).** `unclassified` never flips `summarizeCitations`'s `ok` to `false` by itself; QA-14's exit code stays `0` on a citation set containing only `resolved` + `unclassified` verdicts. Every `unclassified` citation is printed in `details` and counted in `summary`, on both PASS and FAIL runs — never buried.
6. **Non-regression.** Every currently-correct marker-based case keeps resolving exactly as today: `Issue #N`, `Milestone #N` (own kind, untouched), `owner/repo#N` (own kind, untouched), `Closes/Fixes/Resolves/Closed/Fixed #N`, multi-issue marked lists (`Closes #7, #8` resolves both members).
7. **Scope boundary.** `classifyPath`, `ADR_CANDIDATE_RE`, `resolveWithinRepo`, `checkIssueViaGh`, `resolveIssueCitations`'s two-pass wiring, and `parseMaxDistinctIssues` are structurally untouched — zero diff outside the bare-hash marker-classification logic and its tests. — **[DERIVED, not load-bearing: confirmed via reading the current source; the redesign is additive/substitutive only to `NON_ISSUE_ORDINAL_WORD_RE`/`shouldExcludeBareIssueMatch`'s replacement.]**

None of 1–7 required inventing a fact not already given or measured — no criterion is marked derived-and-load-bearing per step 4's guidance, because the one genuinely load-bearing derived consequence (below) is fully resolved by evidence, not guessed.

## 3. Risk tier: **CRITICAL**

**My own read, not just precedent:** this is a genuine redesign of a hard, 100%-of-PRs CI gate's classification state machine (removes one exclusion mechanism, adds a marker + list-continuation mechanism) in the single file this project has now run three adversarial CRITICAL-tier rounds against — every one of those three rounds found a real, subtle regression self-review alone missed (boundary-regex bug round 1, ordinal/hex false positives round 2, list-continuation false negative round 3). That track record is direct evidence the ceremony is warranted here, not habit. It also underpins this project's own evidence-integrity doctrine (QA-16, "no hand-derived completeness claims applied to itself") — a defect here degrades trust in every future review's citation trail, silently, unless caught. Consistent with (not merely copying) `docs/.maat-state.json`'s precedent, which twice overruled a STANDARD proposal to CRITICAL for this same file/scope.

**Reviewers:** `red-team` (adversarial) + `code-reviewer` (domain — correctness/tests fits exactly: pure logic/regex/state-machine change, no API contract, no schema, no infra file touched this time so `infra-security-reviewer` isn't warranted) + `cross-domain-reviewer` (always joins CRITICAL tier, uncounted).

## 4. Blocking questions: **none**

Every candidate question resolves from evidence already in hand:

- **Marker vocabulary** — grounded via `grep`/`git log` against this repo's real corpus (not invented): `Issue #N` (existing dedicated regex), `Issues #N[, #N...]` (plural — **new finding, see §5**), `Closes|Fixes|Resolves|Closed|Fixed #N` (confirmed real usage: `CHANGELOG.md:40`, `docs/decisions.md:59/61`, multiple `docs/reviews/*.md`, `git log` commit-message conventions), `GH#N`/`GH-#N` word-glued shorthand (confirmed: `src/qa/reference-resolver.test.ts:268-269`, `docs/reviews/s1-protect-the-baseline-cross-domain-reconfirm-2026-08-30.md`), `owner/repo#N` (own kind, unaffected), `Milestone #N` (own kind, unaffected). No markdown-link-to-a-local-issue form exists anywhere in this repo's tracked files (only one external cross-repo markdown link found, already handled correctly by the existing slash-based cross-repo regex) — **not adding a marker form with zero grounded need**, per this project's own "don't invent" convention.
- **R3 routing (unclassified vs. cross-repo)** — already ruled, `docs/decisions.md` row 61 point (2).
- **`unclassified` blocking/non-blocking** — already ruled, `docs/decisions.md` row 61 point (1).
- **R1/R2 scope split** — already ruled, `docs/decisions.md` row 61 point (3).
- **The one genuinely load-bearing derived consequence** (does a bare, unmarked `(#N)`/line-start `#N` — this repo's *other* dominant real citation convention — still resolve, or become `unclassified` too?) is resolved by **evidence, not a guess**: see §5. I did not treat this as a blocking question because red-team's own report already supplies a demonstrated counter-example proving the alternative (treat bare parens as an implicit marker) doesn't work.

## 5. Design

### 5.1 The load-bearing finding this plan is built on

I measured, via a scratchpad probe (not committed — reproducible: walk every tracked `.md/.ts/.mjs/.js/.json/.yml` file except `*.test.ts`, run the shipped `ISSUE_CANDIDATE_RE`, classify each bare (non-cross-repo) match as "would-be-marked" under the marker set below vs. "would-be-unmarked"):

```
marked=530 unmarked=1399 (would become unclassified) total=1929
```

**~73% of today's bare-`#N` occurrences in this repo's own corpus carry no explicit marker.** Two representative real (not synthetic) examples from this exact corpus:
- `CHANGELOG.md`: `"...and a handful of them land in #137"` — a genuine reference, no marker, would become `unclassified`.
- `docs/decisions.md`, `CHANGELOG.md`: bare parenthetical lists like `(#80)`, `(#122/#123)`, `(#139-#142)` — this repo's *other* dominant citation convention (alongside `Closes #N`), used extensively in review reports and the changelog, **carries no marker word at all**.

**Why I did not add "bare parenthesized `#N`" to the marker set to preserve that coverage:** red-team's own round-3 report already disproves it. `"Two findings (#1, #2) are BREAKS."` (ordinal, false-positive-shaped) and `"findings #118/#119"` (real citations) are *both* structurally "a bare number near an ordinal-looking word" — the presence of parentheses does not distinguish them, because red-team's own D1 finding is a **parenthesized** ordinal example. Treating "wrapped in parens" as an implicit marker would silently reintroduce exactly the R4 false-positive class this story exists to eliminate, for zero real gain (the same words that make "Finding #2" ambiguous make "findings (#1, #2)" ambiguous too, paren or no paren). So a bare, unmarked `#N` — parenthesized or not, line-start or not — **classifies `unclassified` under this design**, same as an ordinal-adjacent one. This is the direct, evidence-backed consequence of the already-ruled "stop guessing in either direction" principle (`docs/decisions.md` row 61), not a new independent guess, and it is why the measured 73% figure is large: the redesign trades a large chunk of *unverified* "resolved" claims (which were never actually safe — see the false-positive corpus above) for an honest, loud "unclassified," per the ruling's own explicit anticipation ("revisit the unclassified rate once measured … post-ship").

Two round-2 non-regression tests currently assert `verdict: "resolved"` for exactly this now-intentionally-changed shape (`"(#120) mid-sentence"`, `"#120 is the first thing on this line."`, both from Issue #139's own test block) — these are `story-implementer`'s own instrument tests (no `test-writer` owns this file; see §6), and will be updated in Phase 2 to assert `"unclassified"` instead, with an explicit comment naming this as the deliberate, ruled behavior change, not silent test-doctoring.

### 5.2 Mechanism replacing `NON_ISSUE_ORDINAL_WORD_RE` / `shouldExcludeBareIssueMatch`

**Deleted:** `NON_ISSUE_ORDINAL_WORD_RE` (the 9-word denylist) and `shouldExcludeBareIssueMatch`'s ordinal-checking branch — this is the whole point of the redesign; no word list to maintain, ever again, for this bug class.

**Added:**

```ts
export type Verdict = "resolved" | "unresolved-authority" | "cross-repo-issue" | "unparseable" | "unclassified";

// Citation.kind gains "issue-candidate" — a bare #N recorded but never asserted as a real
// citation (no explicit marker found). Distinct from kind:"issue" (which always means "a marker
// or an owner/repo/Milestone shape put this through real classification"), so every existing
// test that filters `kind === "issue"` keeps its original meaning unchanged.

// Word-adjacent markers, case-insensitive, same-line, optional whitespace before "#":
//   Issue(s), Closes, Closed, Fixes, Fixed, Resolves
const CITATION_MARKER_WORD_RE = /\b(?:issues?|closes|closed|fixes|fixed|resolves)[ \t]*$/i;
// Glued marker (no whitespace), case-insensitive: "GH#57", "GH-#57"
const GH_MARKER_RE = /\bGH-?$/i;
// List continuation: once a #N carries a real marker, a later #N in the SAME list inherits it
// when only punctuation/connector separates them — comma, slash, "and", "&", a hyphen/en-dash/
// em-dash range separator ("Issues #105–#113", "(#139-#142)"), or whitespace. No word may
// intervene (a genuinely new sentence breaks continuation, same as the old ordinal-list guard).
const LIST_CONTINUATION_RE = /^(?:[ \t,/&–—-]|and)*$/i;

interface MarkedListGuardState { lastMarkedListEnd: number; }

type BareHashClassification = "already-recorded" | "marked" | "unmarked";

function classifyBareHashMatch(text, idx, matchLength, state): BareHashClassification {
  const sameLineBefore = /* same-line prefix, as today */;
  if (/\b(?:issue|milestone)[ \t]*$/i.test(sameLineBefore)) return "already-recorded"; // unchanged guard (a)
  if (CITATION_MARKER_WORD_RE.test(sameLineBefore) || GH_MARKER_RE.test(sameLineBefore)) {
    state.lastMarkedListEnd = idx + matchLength;
    return "marked";
  }
  const between = state.lastMarkedListEnd >= 0 ? text.slice(state.lastMarkedListEnd, idx) : null;
  if (between !== null && LIST_CONTINUATION_RE.test(between)) {
    state.lastMarkedListEnd = idx + matchLength;
    return "marked";
  }
  state.lastMarkedListEnd = -1;
  return "unmarked";
}
```

`scanReferences`'s bare-hash loop: cross-repo matches unchanged (own regex signature, own kind). Non-cross-repo matches: `"already-recorded"` → skip (unchanged); `"marked"` → `record(raw, () => classifyIssue(raw, deps))` (unchanged downstream — `classifyIssue`/`verifyLocalIssue`/`checkIssueViaGh` are untouched, only which candidates *reach* them changes); `"unmarked"` → `record(raw, () => ({ raw, kind: "issue-candidate", verdict: "unclassified", reason: "no explicit citation marker (Issue(s)/Closes/Fixes/Resolves/Closed/Fixed/GH/owner-repo) precedes this bare #N on the same line — not verified as a real issue citation, not silently treated as ordinary prose either" }))`.

The existing `(?<![:&])`/`(?<!&)` pre-filters on `ISSUE_CANDIDATE_RE` (excluding `property:#000` CSS declarations and `&#39;` HTML entities from ever becoming a *candidate* at all) are **kept** — pure noise reduction, not load-bearing for correctness anymore (an un-filtered CSS hex literal would just become a harmless `unclassified` line today, not a hard failure), but keeping them stops `dashboard.mjs`'s many CSS declarations from flooding every scan's `unclassified` list.

**R3 routing, concretely:** `claude-mem#2604` — no slash, so it never matches the cross-repo alternative; matches the bare alternative as `#2604` (word "claude-mem" not attached to the regex match, same as today). `classifyBareHashMatch` checks the same-line prefix ending in `...claude-mem`: not `issue(s)`, not `closes/closed/fixes/fixed/resolves`, not `GH`/`GH-` → `"unmarked"` → `unclassified`. Never reaches `verifyLocalIssue`, never queries `gh`, never asserts cross-repo. Exactly the ruled behavior.

### 5.3 `summarizeCitations`

```ts
const bad = citations.filter(c => c.verdict !== "resolved" && c.verdict !== "unclassified");
const unclassified = citations.filter(c => c.verdict === "unclassified");
const details = [
  ...bad.map(c => `[${c.verdict}] ${c.raw} — ${c.reason}`),
  ...unclassified.map(c => `[unclassified] ${c.raw} — ${c.reason}`),
];
// ok = bad.length === 0 (unclassified never gates); summary always names both counts, e.g.:
// "563 citation(s): 412 resolved, 151 unclassified (non-blocking, no explicit citation marker) — 0 failed."
// or, when bad.length > 0: "N of M citation(s) failed to resolve; K more unclassified (non-blocking)."
```

`details` is populated (and printed by `printInstrumentResult`, which always prints every `details` line regardless of PASS/FAIL) whether the run passes or fails — satisfies "reported/printed distinctly and counted, never silently... dropped."

### 5.4 Side effect worth naming (not a new requirement, a consequence)

`resolveIssueCitations`'s pass-1 collector only calls `issueExists`/queries `gh` for **marked** candidates now (unmarked ones never reach `classifyIssue`). This *reduces* the distinct-issue-number query volume against `QA14_MAX_ISSUES`'s rate-limit cap (Issue #141) — strictly safer, not a new risk, worth one line in the build's verification output.

## 6. Test-first dispatch check

**No.** This plan identifies no new or changed UI flow or API surface. `reference-resolver.ts` is a CLI/CI-instrument's internal classification logic; its exported functions (`scanReferences`, `classifyIssue`, …) are consumed only by the instrument's own `main()` and its own test suite — not a public API, not a UI. The externally-observable artifact that changes is QA-14's own stdout report shape/exit-code semantics (a new non-blocking `unclassified` line class) — a CLI tool's printed output, not a UI flow or API surface in the sense `test-writer`'s black-box acceptance tests target. This is squarely the CLAUDE.md STANDARD-tier carve-out class ("pure internal refactor, infra-only, schema-only" instrument logic with no UI/API surface) even though the tier itself is CRITICAL for blast-radius reasons — tier and test-first dispatch are independent axes. `test-writer` is **not** dispatched; coverage stays with `story-implementer`'s own `reference-resolver.test.ts`, extended and (for the two identified, ruled-changed cases) amended in Phase 2.

## 7. Plan: files, verification, rollout

**Files:** `src/qa/reference-resolver.ts` (delete `NON_ISSUE_ORDINAL_WORD_RE`/`shouldExcludeBareIssueMatch`'s ordinal branch; add the marker/list-continuation mechanism in §5.2; extend `Verdict`/`Citation.kind`; update `summarizeCitations` per §5.3; rewrite the stale header comments that describe the now-removed denylist), `src/qa/reference-resolver.test.ts` (new tests per criteria below; amend the 2 identified now-intentionally-changed assertions with an explicit comment citing this plan). No other file changes — `.github/workflows/ci.yml` untouched (same gate wiring, same hard `continue-on-error: false` step), no `docs/backlog.md`/`CHANGELOG.md`/`docs/decisions.md` edits until the build's own close-out per this project's normal convention.

**Verification — every criterion mapped to a named check:**

| AC | Named check |
|---|---|
| 1 (R3) | New test: `claude-mem#2604` (real in-tree shape) → `unclassified`, never `cross-repo-issue`, `issueExists` never invoked (assert via a throwing stub, same pattern as existing `GH#57`/`Milestone` tests) |
| 2 (R4) | Tests for all ≥12 red-team-named residual shapes (`items`, `rule`, `criterion`, `Next`, `recommendation`, `residual`, `Coverage gap`, `HIGH #N`, `LOW #N`, open-paren, backtick, angle-marker) + one **novel, never-before-named** ordinal word (e.g. `"sample #4"`) proving the fix is structural, not pattern-matched against red-team's specific list — all assert `kind !== "issue"` / `verdict === "unclassified"` |
| 3 (R5) | `"the palette uses (#000, #333) tokens"` and `` "colours `#000` and `#333`" `` (red-team's own C4/C5 repro) → both `unclassified`, never `unresolved-authority` |
| 4 (R6) | `"findings #118/#119"` (red-team's own repro) and the `"Finding #3, #143 filed"` case → `#143`/`#119`/`#118` all appear in `citations` as `unclassified`, never absent, never `resolved` |
| 5 (non-blocking) | `summarizeCitations` unit test: mixed resolved+unclassified → `ok:true`, both counts named in `summary`, unclassified lines present in `details`; mixed bad+unclassified → `ok:false`, `bad.length` excludes unclassified |
| 6 (regression) | Existing marker tests kept green (`Closes #120`, `owner/repo#N`, `Milestone #N`, `GH#57`, `Closes #7, #8`); new test for plural `Issues #138, #139, #140` (real corpus shape, found during probing — not previously tested); 2 identified tests amended (parenthetical/line-start bare `#N`: `resolved` → `unclassified`, comment citing this plan) |
| 7 (scope boundary) | `git diff --stat` on the final diff shows only `reference-resolver.ts`/`.test.ts` touched; `classifyPath`/`ADR_CANDIDATE_RE`/`resolveWithinRepo` byte-identical (confirmed by reading the diff, not asserted) |
| Dogfood | Existing "this checker's own source, run against itself, resolves clean" test stays green |
| Real corpus | `node src/qa/reference-resolver.ts <base> <head>` on this diff's own range AND a full-tree control range; compare failing-citation counts before/after this change — **expected to only decrease or stay flat, never increase** (§5.4/rollback note below), every remaining failure read individually, not asserted from the total |
| Baseline | `npm test`, `npm run typecheck`, `npm run lint` all clean |

**Rollout/rollback:** No infra/deploy surface. This change can only ever *decrease or hold flat* QA-14's blocking failure count on any given diff — every reclassification moves a match from a blocking verdict toward `unclassified` (non-blocking) or fixes a genuine misclassification (R3); nothing here can newly promote a previously-`resolved` match into a blocking verdict. Rollback is a straight revert of the single commit; no data/state to unwind. Required review chain per §3: `red-team` + `code-reviewer` + `cross-domain-reviewer`, fresh dated reports in `docs/reviews/`.

---

**Single next action:** dispatch this plan for the human/Manager's confirmation (tier ratification + the one named design decision in §5.1, presented as evidence-backed rather than a coin-flip), then proceed straight to Phase 2 build — no `test-writer` stage per §6.
