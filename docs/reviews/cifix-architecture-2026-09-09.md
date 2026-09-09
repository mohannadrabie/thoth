# cifix -- Architecture Review (Imhotep), Design Council seat

**Trigger:** PRINCIPLES rule 16(c) -- 2 consecutive non-clean Stage-3 rounds on cifix (red-team no-go round 1 and round 2; infra-security-reviewer/cross-domain-reviewer APPROVE-WITH-CONDITIONS both rounds).
**Scope of this seat:** not "is the CI-checkout/PAT fix proven" (settled, design-challenger/red-team lane) and not impact pricing (impact-analyst seat). The question here only: should the OSS-01 exact-path-allowlist shape exist, long-term, given the maintenance-burden failure mode red-team demonstrated twice this round.
**Date:** 2026-09-09
**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]
**ADRs read for this domain (architecture/coupling/cost/evolution/standards):** devops ADR-0008 (CI/CD gates and policy-as-code -- ratchet-only rule, directly governs how any exemption mechanism may behave), devops ADR-0009 (least-privilege secrets -- not directly on point, already covered by infra-security lane), SE ADR-0009 (must-not-log-secrets -- already covered). No ADR in the 35-entry catalog governs secret-scan-pattern-catalog completeness or exemption-mechanism shape -- independently confirmed against cross-domain own round-1/round-2 whole-catalog passes, which reached the same conclusion (docs/reviews/cifix-cross-domain-round2-2026-09-09.md section 3). This is genuinely NOT-COVERED, not a slice being skipped.

## What was read
docs/reviews/cifix-{red-team,red-team-round2,infra-security,infra-security-round2,cross-domain,cross-domain-round2}-2026-09-09.md, docs/decisions.md three 2026-09-09 rows, docs/plans/cifix-phase1-2026-09-09.md, live: .github/workflows/ci.yml, src/secret-scan/patterns.ts + .test.ts, src/secret-scan/history-scan.ts (full), docs/qa/secret-scan-allowlist.json (full, 5 entries), plus -- because it turned out to be the load-bearing precedent -- src/qa/completeness-claim-checker.ts (QA-15 own marker mechanism), confirmed via grep across the repo.

---

## 1. Topology ruling

**The mechanism, read exactly as shipped (src/secret-scan/history-scan.ts:103-114):**
```
export function partitionAllowlisted(
  matches: HistoryMatch[],
  allowlist: AllowlistEntry[],
): { blocking: HistoryMatch[]; allowlisted: HistoryMatch[] } {
  ...
  const hit = allowlist.some((e) => e.path === m.path && e.patternId === m.patternId);
```
**Correction to the brief framing (worth stating precisely, it changes the risk shape slightly):** the key is (path, patternId), not (path, exact-string). One allowlist row exempts every future match of that pattern, anywhere in that file -- coarser and more permissive than "every string needs its own entry," but the growth axis the brief names (a new file needs a new row, forever, no glob/prefix support) is real and is what actually broke this round: docs/qa/secret-scan-allowlist.json has exactly 5 rows today, all for 2 test-fixture files, and none for internal-hostname in patterns.test.ts -- which is why this diff own regression-test comments (patterns.test.ts:37,43,48) and its own CHANGELOG.md prose independently tripped the scanner (demonstrated by red-team round 2, git commit-tree simulation, ok=false, 7 blocking matches minimum / 11 with the review+plan docs -- not re-run here; already-demonstrated evidence in an accepted report, cited not re-litigated).

**Ruling: the mechanism is sound for the population it was built for (a small, closed, rarely-touched set of unit-test fixtures -- 5 rows in this project entire history) and unsound as the general answer, because a second population now shares the same gate: prose that legitimately quotes a pattern-shaped exemplar for evidentiary reasons -- CHANGELOG.md, docs/decisions.md, docs/plans/*, docs/reviews/*.** That population is not bounded by code size; it is bounded by review cadence, and this project own CLAUDE.md ties review cadence to risk tier, not to time -- every CRITICAL-tier story runs red-team plus a domain reviewer plus cross-domain, several rounds if non-clean, and PRINCIPLES rule 10/19 require every one of those reports to paste raw command output verbatim, including the literal strings that trip or do not trip a security pattern. That is not a hypothetical growth curve: it already produced two independent hits inside this single round (red-team round 1 own fake-token line; round 2 fixtures/CHANGELOG/its own report). The blast radius is every future security-adjacent review report on this project, forever, and the failure mode is silent-until-commit (green in the working tree, red the moment git commit runs) -- the worst combination for a CI-gating instrument.

## 2. Evolution path -- comparing the three candidates

**A directly-relevant precedent already ships in this codebase and materially changes the calculus: src/qa/completeness-claim-checker.ts (QA-15) already solved the identical shape of problem** -- prose that must legitimately cite a thing the gate would otherwise flag (a hand-derived completeness claim), without becoming a false positive -- with an in-prose, machine-readable marker parsed at scan time:
```
completeness-claim-checker.ts:5-6:  // Machine-readable marker (the authoritative mechanism this check enforces):
                                     //   [[completeness: cmd="<known instrument name>" expect=<N>]]
completeness-claim-checker.ts:61:   const MARKER_RE = /\[\[completeness:\s*cmd="([^"]+)"\s*expect=(\d+)\s*\]\]/g;
```
This is a shipped, reviewed, tested QA instrument in this exact repo solving OSS-01 exact structural problem for a sibling gate. That reframes Path B from "novel mechanism, unproven risk" to "port an already-proven local pattern to a second instrument" -- the single biggest fact shaping the verdict below.

| | Path A -- mechanical patch | Path B -- scanner-recognized marker | Path C -- keep examples out of scanned content |
|---|---|---|---|
| Fit | Fits today narrow need (unblock cifix CI restoration) | Fits the recurring problem at the scale this project own review cadence actually produces | Does not fit: fights the evidentiary-discipline requirement (PRINCIPLES rule 10/19 -- verbatim raw output) for exactly the population most likely to trip the scanner |
| Blast radius and coupling | None -- same code path, same file, isolated to docs/qa/secret-scan-allowlist.json plus its one consumer | One new code path inside history-scan.ts, isolated exactly like QA-15 own marker parser; touches no other instrument, no ci.yml change, no patterns.ts detection-logic change; reversible (grep-revertable to allowlist rows if abandoned) | Requires rewriting every existing prose exemplar across patterns.ts own comments, patterns.test.ts, and every future review report -- the widest blast radius of the three, and an ongoing authorial tax on every future reviewer |
| Compliance | CONFORMS -- no ADR touched; ratchet-only (ADR-0008) honored (adds rows, does not widen an existing one meaning) | NOT-COVERED today (no ADR governs this mechanism) -- becomes CONFORMS once written up, since the "still reported, never silently dropped" discipline (history-scan.ts own header) carries forward unchanged and satisfies ADR-0008 spirit exactly as the file-allowlist already does | AMBIGUOUS -- no ADR forbids it, but it sits in tension with the evidentiary discipline rule 10/19 impose project-wide; escalate rather than assume |
| Cost shape (steady-state) | Near-zero to build; unbounded, linear-in-review-count to maintain -- one manual edit per future report/plan/CHANGELOG citation, forever, each a chance to forget (which is exactly what happened this round) | Small one-time build cost (reuse, not invention); flat marginal cost per future citation -- the author writes the marker once, inline, at the point of use, no second file to remember | Cost is front-loaded (retrofit today fixtures/comments) and recurring (every future author must remember to obfuscate) and carries a quality cost (a redacted/obfuscated exemplar is harder for the next reader to verify against the real regex) |
| Operability | Failure is silent until git commit (working tree green, committed tree red) -- exactly what red-team demonstrated; the only guard is a human/agent remembering to run the drill before every commit | Same "reported never dropped" transparency as today, plus a missing/malformed marker fails loud and locally, at the point of authorship -- same class of message QA-15 already gives ("NO INSTRUMENT REFERENCE") -- a strict improvement, because the marker lives next to the string an author is already writing, not in a separate file they must remember to also touch | No instrument-level failure mode changes; operability is unaffected either way, so this axis does not argue for Path C |

## 3. Cost shape of Path B -- justified now, or premature generalization?

Premature-generalization risk is real in general (PRINCIPLES rule 17/18, CLAUDE.md no-gold-plating hard rule) and was weighed seriously before ruling. Two facts move it from "premature" to "due": (a) the recurrence is not speculative -- it already hit twice inside one review round, across two different file classes (test-fixture comments and report/CHANGELOG prose), not once; (b) the marginal engineering cost is low specifically because Path B is not a new invention -- it is porting completeness-claim-checker.ts already-shipped, already-tested marker convention to a second, structurally-identical instrument. That combination (real, already-repeated pain plus a proven, low-cost local precedent) is the bar PRINCIPLES rule 17 asks a design decision to clear before it is allowed to add a code path, and it clears it. What would not clear it: building Path B speculatively, before the recurrence, or inventing a bespoke marker syntax instead of mirroring QA-15 own.

**Condition on Path B, not a blocker on shipping it:** keep it a second, narrower mechanism, not a replacement -- the existing docs/qa/secret-scan-allowlist.json continues to serve the small, stable, code-owned test-fixture population (5 rows in this project history, each hand-reasoned, rarely touched) exactly as well as it does today. Forcing that population through an inline marker too buys nothing and adds churn to files whose whole point is stability. The marker job is specifically the prose/report/plan/CHANGELOG population, where inline-at-point-of-use is a genuine win over a separate registry file.

## 4. Verdict per candidate path

- **Path A -- mechanical patch: APPROVE, for cifix only, as the immediate unblock -- not as a final answer.** CI has been dead 8+ days; red-team own oss01-post-commit-dogfood-drill is the correct, sufficient, and already-named gating verification for this scope. Reworking the scanner architecture is explicitly out of scope for a CRITICAL-tier story already two non-clean rounds deep -- bundling a new mechanism in now would itself be the gold-plating CLAUDE.md hard rules warn against.
- **Path B -- scanner-recognized marker: APPROVE-WITH-CONDITIONS, as the long-term shape, scoped to its own follow-on story (STANDARD tier -- it is an internal-tooling instrument change, not a new pattern for this codebase, per PRINCIPLES rule 20(c)).** Conditions: (1) supplement, do not replace, secret-scan-allowlist.json; (2) mirror completeness-claim-checker.ts marker discipline exactly -- a fixed, named, reviewed syntax, not a fresh bespoke regex; (3) preserve "allowlisted/marked matches are still reported, never silently dropped" (already this file own stated discipline, history-scan.ts:92-96); (4) write the decision up as a new ADR (or an amendment naming this NOT-COVERED gap) so the next reviewer does not have to re-derive it from a review report.
- **Path C -- keep examples out of scanned content: REWORK, as a general strategy.** Narrow, optional utility for the closed test-fixture population only (where the existing allowlist already works fine, so there is no forcing reason to adopt it there either) -- and actively wrong for the prose/report population, where it fights this project own evidence policy. Not recommended project-wide.
- **No fourth path proposed** -- B, scoped as above, is not merely adequate but is the lower-risk option relative to continuing Path A indefinitely, because it reuses proven local mechanism rather than inventing one.

## 5. Issues 129 and 130 -- architectural symptom or simple fix-now?

**Issue 129 (github-pat regex misses GitHub fine-grained PAT format -- the exact shape ADR_REPO_PAT uses):** a different axis from the allowlist-growth problem above. The allowlist question is about exemption-management (suppressing known-false-positives without unbounded maintenance). Issue 129 is about detection-coverage (a real credential format the catalog does not recognize at all). patterns.ts own header already discloses the catalog is "curated... not a claim of exhaustiveness" -- that is an honest, accepted limitation shared by every heuristic secret scanner (gitleaks/trufflehog ship curated, hand-updated pattern sets too); Issue 129 does not indict the architecture (pattern-matching heuristics), it indicts staleness against a token format this project just started using for real. This is a simple, contained fix-now -- one new regex entry plus one regression test, exactly mirroring the existing github-pat entry (cross-domain round 2 already specified both). No architecture change needed to close it. Worth one non-blocking backlog line (not a blocker, not part of this council ruling): when a new secret type is provisioned as a real repo secret, check it against SECRET_PATTERNS as part of that provisioning own checklist, rather than discovering the gap after the fact, as happened here.

**Issue 130 (Issue 113 fix is measurably over-broad -- no regression test on the true-positive class it could now miss):** likewise unrelated to the allowlist topology -- it is evidence that any narrowing of a detection regex needs a same-commit regression test asserting the true-positive class survives, symmetrically with the false-positive class the narrowing was fixing (email-address own prior narrowing in this same file already sets that precedent; this fix did not follow it). Already correctly named as a fix-now test (internal-hostname-subdomain-continuation-test, red-team round 2 / infra-security round 2). Not an architecture question -- a testing-discipline gap on this specific edit.

---

## Findings (RECEIPT-format, per the standing evidence policy)

1. [SUSPICION][MED][code-traced] partitionAllowlisted (history-scan.ts:103-114) keys on (path, patternId), and no ADR governs this mechanism shape (confirmed against the full 35-ADR catalog, corroborating cross-domain own round-1/round-2 whole-catalog passes) -- NOT-COVERED; the population that actually breaks (prose in reports/plans/CHANGELOG, not test fixtures) grows with review cadence, not code size, and already recurred twice this round (cited from red-team own already-demonstrated git commit-tree simulation, not re-run here). Feeds a new ADR.
2. [CLEAN][code-traced] Correction to the task brief framing: the allowlist is (path, patternId) exact-match, not per-literal-string -- coarser/more permissive than described. Does not change the structural conclusion (finding 1) but matters for anyone designing the fix.
3. [SUSPICION][LOW][code-traced] A directly-analogous, already-shipped, already-tested precedent for exactly this problem exists in this codebase: src/qa/completeness-claim-checker.ts marker mechanism (lines 5-6, 61) -- de-risks Path B from "novel mechanism" to "port a proven local pattern." Load-bearing fact for the verdict above.
4. [SUSPICION][LOW][derived] Path C conflicts with PRINCIPLES rule 10/19 mandatory verbatim-raw-output evidentiary discipline for the prose/report population; feasible only for the closed test-fixture population, where the existing allowlist already suffices -- not a general answer, not recommended project-wide.
5. [CLEAN][derived] Issue 129 is a detection-coverage gap (different axis from findings 1/3/4 exemption-management problem) -- simple fix-now, no architecture change; one non-blocking backlog line recommended (audit SECRET_PATTERNS whenever a new secret type is provisioned as a real repo secret).
6. [CLEAN][derived] Issue 130 (over-broad internal-hostname narrowing, no true-positive regression test) is a testing-discipline gap, unrelated to allowlist topology -- already has a named fix-now test in the accepted reports.

**Findings-to-tests note (PRINCIPLES rule 19):** findings 2, 5, 6 are CLEAN/informational -- no test owed. Finding 3 is supporting evidence for a verdict, not a defect -- no test owed. Finding 1 (the only open SUSPICION with teeth) has no executable test today, and that gap is explained rather than hidden: Path B does not exist yet, so the settling test (oss01-marker-recognized-at-scan-time-test -- a prose file with a marker plus a pattern-shaped exemplar scans ok=true; the same file without the marker scans ok=false, mirroring completeness-claim-checker.test.ts own dual positive/negative marker tests) is itself the deliverable of whichever follow-on story builds Path B, not something pointed at as already failing. This is a design-shape ruling, not a code defect -- consistent with this seat mandate (no fix written here).

## APPROVE / APPROVE-WITH-CONDITIONS / REWORK

- Path A (mechanical patch, cifix scope only): APPROVE -- required now, insufficient long-term.
- Path B (scanner-recognized marker, own follow-on STANDARD-tier story): APPROVE-WITH-CONDITIONS -- see section 4 conditions.
- Path C (obfuscate examples, general strategy): REWORK -- not recommended.

## Single next action

Manager: rule Path A in for cifix immediate merge (red-team own oss01-post-commit-dogfood-drill is sufficient gating verification, already named, takes minutes) -- this is not gated by anything in this report. Separately, open a docs/backlog.md line (or a small STANDARD-tier follow-on story) for Path B, citing this report, so the marker convention gets built deliberately -- mirroring completeness-claim-checker.ts -- rather than the allowlist being hand-patched a third time when the next report quotes a pattern-shaped string.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [SUSPICION][MED][code-traced] Exact-path allowlist (history-scan.ts:103-114, keyed (path,patternId)) is NOT-COVERED by any ADR and is structurally unfit for the prose/report population (grows with review cadence, already recurred twice this round per red-team own demonstrated git commit-tree simulation) -- sound only for the small, stable test-fixture population it was built for. Feeds a new ADR.
2. [CLEAN][code-traced] Corrects the brief: allowlist keys on (path,patternId), not per-exact-string -- coarser/more permissive than described, does not change finding 1 conclusion.
3. [SUSPICION][LOW][code-traced] completeness-claim-checker.ts marker mechanism (lines 5-6,61) is a directly-analogous, already-shipped, already-tested precedent in this codebase -- de-risks Path B from novel mechanism to proven-pattern reuse.
4. [SUSPICION][LOW][derived] Path C (obfuscate examples) conflicts with PRINCIPLES rule 10/19 mandatory verbatim-evidence discipline for the prose population; feasible only for the fixture population, where the existing allowlist already suffices -- not a general answer.
5. [CLEAN][derived] Issue 129 (github-pat misses fine-grained-PAT format) is a detection-coverage gap, a different axis from findings 1/3/4 exemption-management problem -- simple fix-now, no architecture change; one non-blocking backlog line recommended (audit SECRET_PATTERNS whenever a new secret type is provisioned).
6. [CLEAN][derived] Issue 130 (over-broad internal-hostname narrowing, no true-positive regression test) is a testing-discipline gap, unrelated to allowlist topology -- already has a named fix-now test in the accepted reports.
counts (CHECKSUM): issues=0 suspicions=3 clean=3
evidence (CHECKSUM): demonstrated=0 code-traced=3 derived=3
checks=n/a -- ran no build/test/lint this pass (design-topology ruling only, per this seat mandate not to re-litigate proof status); grep/read verification performed: history-scan.ts full read (path:line cited), secret-scan-allowlist.json full read (5 entries confirmed), completeness-claim-checker.ts marker mechanism confirmed via grep across repo (11 files reference the marker), patterns.ts/.test.ts full read, docs/backlog.md checked for an existing entry on this topic (none found)
adr=HIT(35)
report=docs/reviews/cifix-architecture-2026-09-09.md

---

## ADDENDUM (same session, before turn close) — revising Path B in light of impact-analyst's council report

Read after this report was first persisted: `docs/reviews/cifix-impact-analyst-council-2026-09-09.md` (same council, impact-pricing seat). Per PRINCIPLES rule 11, the original sections above are left verbatim; this addendum corrects and narrows the verdict rather than silently rewriting it.

**Two corrections, both material:**

1. **Growth is worse than this report's original text stated.** Impact-analyst independently re-ran the real `SECRET_PATTERNS`/`partitionAllowlisted` against the live working tree (not cited from red-team, a fresh measurement) and found **44 blocking matches full-tree**, up from red-team round 2's own 7/11 -- because two more review reports were persisted between round 2 and council convening. This *strengthens* finding 1 above (the allowlist-growth problem is structural, not a one-time fluke): the count grew again, purely from the review process itself continuing, which is exactly the "bounded by review cadence, not code size" mechanism this report already named. No change to the verdict on finding 1; the evidence for it is now stronger.

2. **Path B's safety analogy to QA-15 does not fully hold, and this report understated Path B's cost and risk.** Re-reading `src/qa/completeness-claim-checker.ts` in full (lines 1-54, not only the marker regex quoted in section 2 above): QA-15's marker is **not self-attesting** -- its own header states plainly, "the checker re-runs the allowlisted instrument (via an injected runner), parses the LAST integer in its stdout, and fails if it doesn't equal `expect`" (line 16), and `cmd=` resolves only against a fixed, code-owned `KNOWN_INSTRUMENTS` table (lines 39-54), never executed as raw text. **The safety property that makes QA-15's marker trustworthy is that it is cross-checked against a live, re-run, ground-truth oracle.** OSS-01 has no equivalent oracle: there is no instrument that can independently confirm "this exemplar string is not a real secret" the way `qa-reference-resolver` can confirm "this instrument really printed 660." A marker that grants exemption on its own say-so, as this report's section 2 sketched Path B, would necessarily be self-attesting in exactly the way QA-15's marker is not -- impact-analyst's independent finding on Path B ("creates a self-attesting exemption class with no reviewed-file tripwire... a real, not hypothetical, cost... the same 'trust a comment claiming intent' failure mode this project's own allowlist header explicitly designed around") is better-grounded than this report's original section 2/3 gave credit for. Impact-analyst also traced that the scan loop itself (`scanBlobText`, `history-scan.ts:44-57`) has no line/position tracking today, so recognizing an in-file marker is a structural addition to the scan loop, not a drop-in port of QA-15's regex -- correcting this report's "small one-time build cost" claim in section 3, which understated the lift.

**Revised verdict on Path B:** narrowed, not reversed to REWORK outright, because the underlying topology question (is a growing, exact-path-only allowlist the right long-term shape for the prose/report population) still stands, and the operability gap (silent-until-commit) is still real and still worth closing. But the closure must **not** take the form of a new, self-attesting exemption surface. The safe form, consistent with both this report's own topology argument and impact-analyst's structural finding 1 (`docs/reviews/cifix-impact-analyst-council-2026-09-09.md`, "Structural findings" section): **`docs/qa/secret-scan-allowlist.json` remains the sole exemption-granting mechanism, unchanged** -- no marker, inline comment, or fenced block may itself suppress a match. What closes the operability gap instead is promoting the ad hoc `git commit-tree` drill red-team ran twice by hand into a **standing, named pre-commit/CI-adjacent instrument** that scans the actual to-be-committed tree before the commit lands, so "green in the working tree, red in the commit" (this report's own worst-case framing in section 2's Operability row) can no longer happen silently. This is a smaller, safer change than the original Path B sketch: it adds no new grant-of-exemption surface, it only moves an existing check earlier and makes it standing rather than adversarial-and-manual.

**Revised APPROVE-WITH-CONDITIONS on Path B, restated:** APPROVE the underlying topology argument (allowlist-only is not sustainable against the prose population's growth) -- but the concrete mechanism is **not** an in-file exemption marker (REWORK that specific shape, on impact-analyst's evidence); it is a standing pre-commit dogfood check with **no change to who may grant an exemption**. This still needs its own follow-on STANDARD-tier story and, given it touches a CLAUDE.md-named sensitive area's enforcement point, its own dated review round when built -- not bundled into `cifix`.

**Path A, Path C, Issues #129/#130 verdicts above are unaffected by this addendum.**

### Addendum findings

7. [ISSUE][MED][code-traced] Section 2/3's original Path B sketch (an in-file exemption marker analogized to QA-15's) understated cost (scan-loop position-tracking is a structural addition, not a drop-in port, per `history-scan.ts:44-57`'s lack of line tracking, code-traced) and risk (a marker that itself grants exemption is self-attesting, unlike QA-15's marker which cross-checks a live instrument oracle per `completeness-claim-checker.ts:16,39-54`, code-traced). Corrected above; superseded by the narrower "standing pre-commit check, no new grant surface" recommendation.
8. [CLEAN][derived] Impact-analyst's independently-measured 44-match full-tree count (vs. this report's cited 7-11 from red-team round 2) corroborates and strengthens finding 1; no change to that finding's verdict.

### Addendum RECEIPT delta

```
ADDENDUM RECEIPT: original verdict=APPROVE-WITH-CONDITIONS, unchanged at the top level; Path B's
CONCRETE MECHANISM revised from "in-file exemption marker" to "standing pre-commit dogfood check,
zero new exemption-grant surface, allowlist.json remains sole grantor" -- on evidence from
docs/reviews/cifix-impact-analyst-council-2026-09-09.md (independent re-measurement: 44 vs 7-11
blocking matches; structural finding on scan-loop position-tracking cost; self-attestation risk
QA-15's own oracle-check design does not share).
new findings this addendum: 7. [ISSUE][MED][code-traced] 8. [CLEAN][derived]
counts (CHECKSUM, addendum only): issues=1 suspicions=0 clean=1
evidence (CHECKSUM, addendum only): demonstrated=0 code-traced=1 derived=1
report=docs/reviews/cifix-architecture-2026-09-09.md (this file, addendum section)
```
