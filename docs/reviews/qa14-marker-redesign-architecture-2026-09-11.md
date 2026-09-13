# Architecture Review (Imhotep) - qa14-marker-redesign council question

- **Date:** 2026-09-11
- **Scope:** branch `fix/qa14-marker-redesign` @ `a26e55a`, repo `mohannadrabie/thoth`, CRITICAL tier
- **Mandate:** the council framing question from `docs/decisions.md`'s 2026-09-11 round-4 row - should Issue #154's residual get the same `--field`-style live-instrument treatment Issue #150/#155 already received, or is there an architecturally better-shaped resolution?
- **ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]

## Verdict table

| Axis | Verdict | Basis |
|---|---|---|
| **Fit** | NO - under-fit. Round 3 applied a cheaper, weaker remedy ("edit prose, point at a command") to #154 than the remedy it applied in the same round to #155 ("build a real callable instrument"), for a problem that is structurally identical in both cases. | code-traced |
| **Blast radius & coupling** | Sound, low-risk either way. Three files share one classifier, never a second hand-copied regex set; the cmd= allowlist security boundary is untouched by either candidate path. No new single point of failure. | code-traced |
| **Compliance** | devops ADR-0008 (CI-gate ratchet): NOT-APPLICABLE, independently re-read. SE ADR-0010 ("MUST NOT lower coverage thresholds... or broaden lint ignore lists"): AMBIGUOUS as applied to round 3's removal of #155's blocking markers. | code-traced |
| **Cost shape** | Any metric whose corpus is "the whole tracked tree" scales its false-positive rate with commit frequency, not with actual defects (red-team round-3: 4 of 8 constant-classifier commit transitions moved the number). A blocking marker over such a metric is unbounded-cost; a non-blocking callable instrument is flat-cost. | derived |
| **Operability** | The #150/#155 shape degrades safely (staleness is invisible and harmless, nothing gates on it). The #154 shape as shipped (round 3) degrades unsafely: it looks fixed but is less checkable than before. | demonstrated |

## Findings, ranked by blast radius

### 1. [ISSUE][MED][demonstrated] CHANGELOG.md:15 still carries a live, non-struck, stale exact count - and QA-15's own bare-claim heuristic cannot catch it, by construction

Independently reproduced, not reused from red-team's round-4 report. At a26e55a:

```
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
```

QA-15 passes clean on the very file (CHANGELOG.md) that still contains, at line 15, a bolded, non-struck claim: "10/400 real occurrences, 5 distinct blocking gate failures" - stale (current measured figure is 6/427 per red-team's round-4 remeasurement) and never corrected by round 3's de-hardcoding pass, which only touched the round-2 entry lower in the file.

**Root cause, beyond what red-team named:** I traced why QA-15's own findBareClaims heuristic doesn't catch this line, rather than assuming it should have:

```
BARE_CLAIM_PHRASES includes: /\b\d+\s+of\s+\d+\b/i   -- matches "10 of 400"
CHANGELOG.md:15 actual text: "10/400 real occurrences, 5 distinct blocking gate failures"

$ node -e "console.log(/\b\d+\s+of\s+\d+\b/i.test('10/400 real occurrences, 5 distinct blocking gate failures'))"
false
```

The heuristic matches "N of M" phrasing only. This project's own prose (this exact story, repeatedly) also writes the shorthand "N/M" form - 10/400, 422/434/856, 430/456/886 all appear verbatim in this story's own CHANGELOG/decisions rows. None of them would be caught by findBareClaims if they went stale in a DEFAULT_FILES member with no bracket marker nearby. This is not a one-off miss; it is a structural blind spot in the safety-net mechanism the whole story is trying to strengthen.

**Exposure:** 1 of 4 named permanently-scanned locations still carries the stale figure (25 percent, counted in code); 100 percent of completeness-claim-checker.ts runs against CHANGELOG.md pass clean despite it (demonstrated, this session). **Filed:** GitHub Issue #159 (new - not a duplicate of #154/#157/#158, which cover the underlying classification defect and the round-3 evidence-sentence/pointer defects respectively, not this heuristic-phrasing gap).

### 2. [ISSUE][MED][demonstrated] The de-hardcoded pointer produces no isolated number - independently reproduced

```
$ node src/qa/reference-resolver.ts c598312 HEAD
[QA-14 reference-resolver] FAIL: 43 of 1091 citation(s) failed to resolve; 182 more unclassified (non-blocking).
  - [unresolved-authority] Issue#0 - Issue #0 does not exist in this repository
  - [unresolved-authority] reference-resolver.ts:327 - reference-resolver.ts does not exist
  ... (path / ADR / cross-repo / issue failures, all mixed, undifferentiated)
```

Confirmed by reading summarizeCitations (src/qa/reference-resolver.ts:465-490) myself: bad is citations.filter(c => c.verdict !== "resolved" && c.verdict !== "unclassified") - every failure reason (path-not-found, unparseable ADR id, cross-repo mismatch, and the comma-continuation residual) is folded into one undifferentiated count. There is no field, flag, or mode anywhere in this file or marker-corpus-probe.ts that isolates how many of these are the comma-continuation residual specifically. The STRUCTURAL NOTE's promise ("run it for the live number") points at a command that cannot produce that number. This duplicates GitHub Issue #158 exactly - commented there with this independent reproduction rather than filing a new issue.

### 3. [SUSPICION][LOW][derived] NOT-COVERED - no standing rule distinguishes "stable, PR-gated corpus -> blocking marker OK" from "whole-tracked-tree corpus -> callable instrument only, never blocking"

This is the actual architectural root cause of the four-round stall, not a code bug. The distinction exists, but only as prose buried in one CHANGELOG.md entry (round 3's #155 rationale, contrasting qa-mutation-shell's scoped src/policy/** corpus against the whole-tree corpus) - and it was discovered and applied correctly to #155 in the same round it was withheld from #154. Nothing makes this rule discoverable the next time someone proposes a new whole-corpus metric; it will be re-derived from scratch (or missed) a third time. See "Recommended shape" below for where this belongs.

### 4. [SUSPICION][LOW][derived] AMBIGUOUS - does SE ADR-0010's ratchet rule govern removing a blocking completeness marker?

ADR-0010's rule reads: "MUST NOT lower coverage thresholds, delete tests, or broaden lint ignore lists." Read literally, it names three specific surfaces; a completeness-claim marker is none of them, so round 3's removal of #155's three blocking markers is not a literal violation. But it is unmistakably the same spirit (a blocking CI assertion got weaker, not stronger) and a future reviewer could reasonably read the ratchet principle as extending to it. The standard doesn't decide this either way - I am not inventing a stricter reading, but flagging it for the ADR owner: either extend ADR-0010's named surface list explicitly, or note in completeness-claim-checker.ts's own header that removing a marker asserting no real invariant is not the kind of gate-lowering this ADR targets (my own judgment of the correct answer, offered as a recommendation, not a ruling).

### 5. [CLEAN][code-traced] The completeness-claim-checker.ts / marker-corpus-probe.ts / reference-resolver.ts coupling shape is sound

All three files reuse one classifier (scanReferences, classifyBareHashMatch) rather than maintaining independent copies of the marker/list-continuation regex logic; cmd= stays a symbolic name resolved only against a fixed, code-owned allowlist (KNOWN_INSTRUMENTS, src/qa/completeness-claim-checker.ts:45-63), never executed as raw text - the arbitrary-command-execution gadget this file's own header names as the reason for that design (docs/reviews/s1-protect-baseline-app-security-2026-08-30.md, finding 1) stays closed under either candidate path. Extending marker-corpus-probe.ts with one more --field value, as Path A recommends, adds no new coupling shape - it is the same shape #150's fix already used three times.

### 6. [CLEAN][code-traced] devops ADR-0008 independently re-confirmed NOT-APPLICABLE

Read adr/devops/0008-cicd-gates-and-policy-as-code.md in full. Its "ratchet, don't lower gate thresholds" rule and its Ownership table are scoped explicitly to the named IaC/supply-chain security gate stack (Gitleaks, Semgrep, Trivy, Cosign/SBOM, cdk-nag, ZAP) - QA-14/QA-15/the marker-corpus-probe are not in that set, and this story does not touch .github/workflows/ci.yml's gate wiring. The plan's and prior rounds' own NOT-APPLICABLE conclusion holds on independent re-read, not merely re-assumed.

### 7. [CLEAN][derived] The --field-style "real callable instrument, never a blocking marker" pattern is the right general default for a whole-tracked-tree metric in this codebase

Citing red-team's own demonstrated measurements (not re-run by me this session, hence derived not demonstrated): the whole-tree corpus moves on roughly half of all commits (4 of 8 constant-classifier transitions), including via the review's own report files landing in the tree. A blocking expect=N marker over such a quantity asserts nothing (round 3's own reasoning, which I endorse: a marker with no invariant behind it is ceremony with no safety gain, PRINCIPLES rule 16). A non-blocking, registered, on-demand instrument (exactly qa14-marker-corpus-probe's current three fields) keeps the number real and re-runnable without ever gating an unrelated commit.

## Recommended shape (answering the council's framing question)

**Path A - extend #154 with the same pattern #150/#155 already received, no blocking marker. APPROVE-WITH-CONDITIONS.**

This is the right general pattern for any whole-tracked-tree metric in this codebase going forward, with one boundary condition made explicit (Finding 3): a blocking [[completeness: expect=N]] marker is permitted only when the underlying corpus changes exclusively via a deliberate, reviewed PR to a bounded, non-doc surface - qa-mutation-shell's scoped src/policy/** mutation corpus is the only current example. Any metric over "the whole tracked tree" (which by definition includes docs, review reports, and CHANGELOG/decisions rows) never gets a blocking marker; it gets a real, registered, callable instrument, used live or cited in a dated point-in-time report, never frozen into a permanently-rescanned file.

**Concrete design sketch for the story-implementer to execute** (a design sketch, not something I built or ran - flagged accordingly):

The comma-continuation residual is not the same shape of computation as #150/#155's marked/unmarked count. #150's probe deliberately stubs issueExists to return null (no network call, pure text classification). The #154 residual specifically needs to know whether a continuation-marked #N fails real existence - that already requires the real gh-backed check reference-resolver.ts's own live gate already performs. The missing piece is not a new network-calling probe; it is a way to isolate the existing gate's own output by cause:

1. Tag Citation/classifyBareHashMatch's output with which mechanism marked it - markedVia: "direct" | "continuation" (a small, pure, no-network addition, reusing the already-shipped classifier).
2. Add one more --field-style mode that filters the already-computed bad set down to verdict === "unresolved-authority" && markedVia === "continuation" and prints only that count - the same "last integer in stdout, nothing else" discipline --field=marked/unmarked/total already established, plus the shape test Issue #156 already proved out.
3. Register it in KNOWN_INSTRUMENTS, but per Finding 3's boundary condition, do not wire a blocking expect=N marker to it.
4. Point the STRUCTURAL NOTE / CHANGELOG.md / docs/STATE.md prose at this command, not at the generic diff-gate command (which answers a different question - "did this PR introduce a leak," which it already answers correctly and loudly - not "how big is the whole-tree residual today").
5. Fix Finding 1 as a mechanical sweep: build the instrument red-team already named (no frozen exact residual count survives in any permanently-scanned file) rather than hand-grepping once more, and extend BARE_CLAIM_PHRASES to also catch the "N/M" slash-separated shape (Issue #159) - otherwise a 5th recurrence of exactly this defect will sail through QA-15 clean again.

**Path B - scope the instrument to the diff only, to avoid self-reference. REWORK - not recommended as the primary fix, reframes rather than resolves.**

Diff-scoping does not answer the question a whole-corpus sizing statistic is actually asking (how big is this residual across the whole repo today); it answers a different, already-answered question (did this PR introduce a new instance, which the existing live CI gate already catches structurally, loudly, per-diff, today). Diff-scoping also does not eliminate self-reference: the single largest measured contributor to this story's own numbers moving was the review reports themselves landing in the tree (red-team round-3: one report alone moved the whole-tree probe by +14) - a diff that adds a review report still contains that report's own new residual instances, whatever the diff's scope. Self-reference is a property of what gets measured (documents about the measurement, committed into the corpus the measurement counts), not of how much tree gets scanned; narrowing the scan window doesn't remove it. The existing diff-scoped gate stays valuable for its own, distinct purpose and needs no change.

## NOT-COVERED / AMBIGUOUS - architect's work queue

1. No standing project convention distinguishes a stable/PR-gated corpus (blocking marker permitted) from a whole-tracked-tree corpus (callable instrument only, never blocking). Recommend: one paragraph added to completeness-claim-checker.ts's own header comment stating this boundary condition explicitly, citing qa-mutation-shell as the only current stable example. Low cost, prevents a third rediscovery.
2. Whether SE ADR-0010's ratchet rule extends by spirit (not literal text) to removing a completeness-claim marker that asserts no real invariant. Escalate to the ADR owner for an explicit clarification or a one-line ADR-0010 amendment; my own reading is that it does not, but the standard's text doesn't decide it, so I am not ruling on the ADR owner's behalf.

## Overall verdict

**APPROVE-WITH-CONDITIONS** on Path A as the council's resolution - conditions are the 5-point design sketch above, which collapses Findings 1 and 2 (Issues #159 and #158) into failing tests already named by this report and by red-team's round-4 report. Path B is not recommended; the council should not adopt "scope to diff" as the fix for this specific metric, though the existing diff-scoped gate itself needs no change.

## Findings to failing tests

| Finding | Named test | Executable form? |
|---|---|---|
| 1 (Issue #159) | qa14: no frozen exact residual count survives in any permanently-scanned file, plus extend BARE_CLAIM_PHRASES to match N/M | Yes |
| 2 (Issue #158, duplicate) | qa14-continuation-residual-probe: --field=continuation-residual emits ONLY that number | Yes |
| 3 (NOT-COVERED) | No executable form - a documentation/convention gap, resolved by a header-comment addition, not a test | No |
| 4 (AMBIGUOUS) | No executable form - resolved by an ADR clarification or owner ruling, not a test | No |

Open findings = 2 ISSUE + 2 SUSPICION = 4; failing tests = 2; the gap is explained above (findings 3/4 are convention/ADR-clarification gaps, not code defects).

## Single next action

story-implementer executes the Path-A design sketch above (extend Citation/classifyBareHashMatch with markedVia, add the isolated --field mode, wire it non-blocking, fix Issues #158/#159 as part of the same round, add the BARE_CLAIM_PHRASES N/M-shape fix) as this story's round-5 fix-now, then red-team re-confirms once - this is the council's answer, not a new open question.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][demonstrated] CHANGELOG.md:15 still carries a live, non-struck, stale exact residual count ("10/400... 5 distinct blocking gate failures"); QA-15 PASSES clean on it at HEAD because its bare-claim heuristic only matches "N of M" phrasing, not the "N/M" shorthand this project's own prose actually uses (demonstrated via direct regex test) - a structural blind spot in the safety net itself, not just a missed grep. Exposure: 1 of 4 named locations still stale (25 percent, counted-in-code); 100 percent of checker runs against CHANGELOG.md pass despite it. Filed as new Issue #159.
2. [ISSUE][MED][demonstrated] The de-hardcoded pointer (node src/qa/reference-resolver.ts base head) does not isolate the comma-continuation residual's count - independently reproduced (own run, own read of summarizeCitations's undifferentiated bad filter, src/qa/reference-resolver.ts:465-490). Duplicate of Issue #158; commented there with this independent reproduction and the recommended design sketch (markedVia tag + filtered --field mode), not filed as new.
3. [SUSPICION][LOW][derived] NOT-COVERED: no standing convention distinguishes a stable/PR-gated corpus (blocking marker OK, qa-mutation-shell's own precedent) from a whole-tracked-tree corpus (callable instrument only, never blocking) - the actual root cause of this story's 4-round stall, currently discoverable only as buried CHANGELOG prose. Recommend one paragraph in completeness-claim-checker.ts's own header.
4. [SUSPICION][LOW][derived] AMBIGUOUS: whether SE ADR-0010's ratchet rule extends by spirit to removing #155's blocking completeness markers - read literally it does not (none of the three named surfaces match), but the standard doesn't decide it either way; escalate to the ADR owner rather than invent a reading.
5. [CLEAN][code-traced] Coupling shape sound: completeness-claim-checker.ts/marker-corpus-probe.ts/reference-resolver.ts share one classifier, never a hand-copied second regex set; cmd= allowlist security boundary stays closed under either candidate path.
6. [CLEAN][code-traced] devops ADR-0008 independently re-confirmed NOT-APPLICABLE - its blocking-gate stack/Ownership table names only Gitleaks/Semgrep/Trivy/Cosign/SBOM/cdk-nag/ZAP; this story doesn't touch ci.yml's gate wiring.
7. [CLEAN][derived] The "real callable instrument, never a blocking marker" pattern (#150/#155's shape) is the right general default for any whole-tracked-tree metric in this codebase - citing red-team's own demonstrated ~50-percent-of-commits drift measurement, not re-run by me this session.
counts (CHECKSUM): issues=2 suspicions=2 clean=3
evidence (CHECKSUM): demonstrated=2 code-traced=3 derived=2
checks=node src/qa/completeness-claim-checker.ts -> PASS exit 0 (own run, a26e55a); node src/qa/reference-resolver.ts c598312 HEAD -> FAIL 43 of 1091, exit 1, undifferentiated (own run); node -e regex test confirming BARE_CLAIM_PHRASES misses N/M shape (own run); git rev-parse HEAD / git status --porcelain (own run, confirmed scope a26e55a)
adr=HIT(35)
report=docs/reviews/qa14-marker-redesign-architecture-2026-09-11.md
