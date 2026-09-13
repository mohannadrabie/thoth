# qa14-marker-redesign -- Cross-Domain Review, ROUND 3 targeted re-confirm (Ra)

**Date:** 2026-09-11
**Scope:** fix/qa14-marker-redesign @ 4896420 (round-2 fix-now build, committed), vs. round-2 baseline 95e3a21, vs. master c598312
**Tier:** CRITICAL (docs/.maat-state.json, scope qa14-marker-redesign)
**Reviewer:** cross-domain-reviewer (Ra)
**Task:** targeted re-confirm of two still-open findings (Issue #150, Issue #154) per docs/decisions.md's 2026-09-11 row-65 triage and row-66 build; plus a final whole-ADR-catalog sweep on this round's own new diff, and an Issue Discipline pass across #149-#154.
**My own prior reports:** docs/reviews/qa14-marker-redesign-cross-domain-2026-09-11.md (round 1), docs/reviews/qa14-marker-redesign-cross-domain-round2-2026-09-11.md (round 2)

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp 83b2e3e, CACHE=HIT

## Who else ran this round

No other reviewer has posted a round-3 report as of this pass -- this is a targeted re-confirm the Manager dispatched to cross-domain-reviewer specifically (per docs/decisions.md row 65's own single-next-action: "targeted re-confirm from red-team + cross-domain-reviewer... code-reviewer need not re-run, its domain is unconditionally clean"). I independently re-derive both figures from scratch (my own separately-authored instrumentation for #154, not a reuse of the build's or red-team's script) rather than trusting the round-2 build's receipt.

## Task 1 -- Re-verify Issue #150 (marker-corpus-probe.ts wiring)

Read the round-2 fix-now diff (git diff 95e3a21..4896420 -- src/qa/marker-corpus-probe.ts src/qa/completeness-claim-checker.ts): a new --field=marked|unmarked|total CLI mode (parseMarkerCorpusField, tested) makes each invocation print exactly one number, plus 3 new KNOWN_INSTRUMENTS entries (qa14-marker-corpus-probe-marked/-unmarked/-total).

Ran it myself, twice, isolated from any other tool call:

    node src/qa/marker-corpus-probe.ts --field=marked    -> marked=430
    node src/qa/marker-corpus-probe.ts --field=unmarked  -> unmarked=456
    node src/qa/marker-corpus-probe.ts --field=total     -> total=886

Both runs agree exactly with each other and with the three live markers CHANGELOG.md ships ([[completeness: cmd="qa14-marker-corpus-probe-marked" expect=430]] etc.). node src/qa/completeness-claim-checker.ts at HEAD prints PASS: 2 file(s) checked, all completeness claims verified.

Independently tested that QA-15 actually enforces this, rather than trusting the build's own reported test. Temporarily corrupted the committed CHANGELOG.md's expect=886 to expect=999 and re-ran the real checker:

    [QA-15 completeness-claim-checker] FAIL: 1 of 2 file(s) had a failing completeness claim.
      - CHANGELOG.md: 1 of 4 numeric completeness claim(s) failed.
      -   MISMATCH: claim says 999, instrument "qa14-marker-corpus-probe-total" re-run reports 886 (...)

Restored via git checkout -- CHANGELOG.md; re-ran, clean PASS again; git status --short confirmed zero diff before continuing. Also ran the build's own new end-to-end test directly (npx tsx --test src/qa/completeness-claim-checker.test.ts): 16/16 pass, including the deliberately-wrong expect=0 test, caught for real, not a stubbed pass.

Verdict: genuinely fixed. The figure reproduces exactly, twice, and QA-15 demonstrably catches a wrong value against the real committed marker (my own corruption test, independent of the build's own test file). Commented on and closed Issue #150.

## Task 2 -- Re-verify Issue #154 (comma/whitespace continuation residual)

Wrote my own, separately-authored instrumented copy of reference-resolver.ts (2 lines added inside classifyBareHashMatch's list-continuation branch, tagging every continuation-marked raw match into an exported array) plus my own driver reusing resolveChangedFiles/checkIssueViaGh the same way the shipped main() does, but hand-written independently rather than reusing the build's or red-team's own instrumented script.

Diff-scope (c598312..HEAD, this round's own final commit -- a larger range now than either reviewer measured, since it also includes this round's own 3 new review-report files):

    distinct issue numbers queried: 105
    continuation-marked occurrences (this pass): 194
    continuation-marked occurrences that fail real existence: 10
    distinct failing raw #N values: 1 -> #9999

Cross-checked against the real shipped gate (node src/qa/reference-resolver.ts c598312 HEAD, exit 1, 35 blocking findings total): 6 of them (3x #000, 3x #9999) are this residual -- both are fixture/example numbers used repeatedly in this project's own review-report prose and test fixtures, not real citations. This is 1 finding more than the build's own disclosed "5 of 33" (grown to "6 of 35"), fully explained by the same self-referential corpus-growth pattern this project's history has already disclosed repeatedly (docs/STATE.md point 7; this story's own full-tree-drift entries) -- this round's own 3 review-report files (red-team, code-reviewer, and my own round-2 report, all committed as part of 95e3a21) landed in the tree after the build's 5/33 measurement was taken. Not a regression: same mechanism, same direction, same order of magnitude.

Judgment on "disclosed, no fix" as an architectural call: sound, reconfirmed. The residual is small, mechanically re-measured (not hand-derived), and fails in the safe direction -- a loud blocking gate failure on ordinary prose/fixture text, never a silent false-verify. The dash sub-case (the dangerous silent direction) was closed round 1. Closing the comma/whitespace case fully would require either a word list (reintroducing the exact denylist failure mode R3-R6 eliminated) or dropping comma continuation entirely (a strictly larger, silent harm -- un-verifying every genuine comma-joined citation list this repo's own review reports actually use). The "never"/"0 real occurrences" claims this issue was filed against are corrected in place everywhere they appeared (reference-resolver.ts, reference-resolver.test.ts, CHANGELOG.md) to the actual measured figure; no false claim remains.

Commented on and closed Issue #154.

## Task 3 -- Baseline gates, independently re-run

    npm run typecheck  -> clean (tsc --noEmit, exit 0)
    npm run lint       -> clean (eslint ., exit 0)
    npm test           -> 727/727 pass, 0 fail, 0 skipped

## Task 4 -- Final whole-ADR-catalog sweep on this round's new diff

This round's diff (95e3a21..4896420, 14 files) adds: a --field CLI mode to marker-corpus-probe.ts, 3 new KNOWN_INSTRUMENTS entries + 3 live [[completeness: cmd=... expect=N]] markers in CHANGELOG.md, corrected prose in CHANGELOG.md/docs/STATE.md/docs/decisions.md, and 3 new committed review-report files. Re-read the whole 35-ADR catalog (not a domain slice) against this specific diff, with particular attention to whether anything about "instrument correctness" or "verification-marker mechanisms" is governed by this project's own evidence-integrity doctrine:

- Grepped adr/ for completeness|marker|instrument|QA-14|QA-15 -- 6 hits, all incidental (ADR-0021's deferred field described as a "boolean/marker"; ADR-0012's soft-delete deleted_at marker; ADR-0009's generic OpenTelemetry "instrumentation"). No ADR anywhere in either domain folder names completeness-claim-checker.ts, the [[completeness: cmd=...]] marker convention, or QA-01..17 specifically. This mechanism is a CLAUDE.md hard-rule ("no hand-derived completeness claims") implemented as a homegrown QA instrument, not an ADR-governed surface.
- ADR-0021 (thoth-native architecture, evidence trail) -- read in full again. Its audit-log rules (hash-chained, append-only, atomic write, hooks/audit-log.mjs) govern the Plane A/C evidence trail specifically; completeness-claim-checker.ts/marker-corpus-probe.ts are QA/CI instruments over docs prose, not the audit log, the kernel, the Action record, or any of ADR-0021's six named shapes. Not applicable.
- ADR-0008 (devops, CI/CD gates ratchet rule) -- re-confirmed NOT-APPLICABLE, same conclusion as rounds 1/2, independently re-read from the ADR's own Decision/Ownership text (scoped to the named IaC/supply-chain tool stack -- Gitleaks/Semgrep/Trivy/Cosign/SBOM/cdk-nag/ZAP -- not to a QA instrument's own internal verification logic). .github/workflows/ci.yml is untouched this round.
- ADR-0010 (SE, code-quality gates ratchet rule) -- "MUST NOT lower coverage thresholds, delete tests, or broaden lint ignore lists" -- this round only adds tests (5 new: 3 in marker-corpus-probe.test.ts, 2 in completeness-claim-checker.test.ts) and tightens the marker-checker's own coverage (from an unverifiable registration to 3 live enforced markers). No violation, the direction is the ratchet's intended one.
- Full 35-ADR catalog re-checked against the round's 14-file diff generally: no IaC, no secrets, no IAM, no kernel/guard/evidence-trail surface, no CI config. Same conclusion as rounds 1 and 2 -- no collision.

Verdict: NOT-APPLICABLE across the whole catalog, independently reconfirmed a third time from the ADRs' own text.

## Task 5 -- Issue Discipline across #137, #143-#154

Checked every issue's actual GitHub state (not assumed from decisions.md prose):

| # | State before this round | Finding | Action taken |
|---|---|---|---|
| 137 | OPEN | Correctly the R1/R2 umbrella tracker (deferred future story) | No action -- correct as-is |
| 143 | OPEN (REOPENED) | Named "closed" by docs/decisions.md row 62's build-complete text, but never actually closed on GitHub across round-1/round-2 review | Independently re-tested this issue's own named repro shapes against shipped code ("Two findings (#1, #2)", "Finding #146 and Build task #147", "&#39;") -- all now correctly unclassified/unmatched, not resolved. Commented + closed completed. |
| 144 | OPEN (REOPENED) | Same gap as #143 | Independently re-tested ("background:#000" still 0 citations; "#000 and #333" in prose now unclassified, not a hard fail). Commented + closed completed. |
| 145 | OPEN, 0 comments | Same gap -- never closed despite 3 rounds of review (red-team + code-reviewer + cross-domain-reviewer, twice each) | Independently re-tested the issue's own named repro ("findings #118/#119") -- both now unclassified, never silently dropped, never a false ok=true. Commented + closed completed. |
| 146 | CLOSED (not_planned) | Correctly redirected into #143 as a duplicate filing (Manager comment on file) | No action -- correct as-is |
| 147 | CLOSED (not_planned) | Correctly redirected into #144 | No action -- correct as-is |
| 149 | CLOSED (completed) | Correct | No action |
| 150 | OPEN | See Task 1 | Commented + closed completed. |
| 151 | CLOSED (completed) | Correct | No action |
| 152 | CLOSED (completed) | Correct | No action |
| 153 | CLOSED (completed) | Correct | No action |
| 154 | OPEN | See Task 2 | Commented + closed completed. |

This is the one real finding of this round: #143/#144/#145 were repeatedly claimed "closed" in committed prose (docs/decisions.md row 62, this story's own build commit message) but the actual GitHub issues sat open, untouched, through two full rounds of review by three reviewers each (6 review passes total) without anyone checking the tracker state against the claim. All three are now independently re-verified as genuinely, structurally fixed by this story's redesign (not merely asserted) and closed. gh issue list --search run before every closure confirmed no duplicate filing risk. Final state: every one of #137/#143-#154 now correctly disposed, no duplicates.

## Coverage gaps named

None new this round. This round's diff is narrow (14 files, all doc/prose corrections + the --field flag + marker wiring) and fully covered between my own pass (ADR sweep, #150/#154 reproduction, Issue Discipline) and the domain reviewer ceremony already run in rounds 1-2. No file type or concern in this round's diff goes unowned.

## Verdict

APPROVE. Both round-2 conditions are independently confirmed genuinely resolved -- #150 reproduces exactly and is demonstrably enforced by QA-15 (my own corruption test); #154's claim is now honest and its "disclosed, no fix" architectural call is sound, reconfirmed against a fresh, larger measurement. No ADR collision anywhere in the whole 35-ADR catalog, checked a third time against this round's own new diff. The one real finding -- #143/#144/#145 left open despite being claimed closed -- is a process/Issue-Discipline gap, not a code defect; independently re-verified all three as genuinely fixed and closed them myself this round. Nothing blocks ship.

---

RECEIPT: verdict=APPROVE
findings (ranked by blast radius):
1. [ISSUE][LOW][demonstrated] Issues #143/#144/#145 were named "closed" in docs/decisions.md row 62's build-complete text and this story's own commit message, but sat OPEN/REOPENED on GitHub through 2 full review rounds (6 review passes) with zero comments on #145 -- a real Issue Discipline gap (claim vs. tracker state never cross-checked). Independently re-tested every one of their own named repro shapes against the shipped code (all now correctly unclassified/unmatched, not falsely resolved or hard-failing) -- genuinely fixed, not just asserted. Commented and closed all three completed this round. Exposure: 3 of 12 tracked issues in this story's own family (25%), basis: counted in code (gh issue list state check) -- process-only, no code/user-facing harm, since the underlying defects were genuinely already fixed.
2. [CLEAN][demonstrated] Issue #150: node src/qa/marker-corpus-probe.ts --field=marked|unmarked|total reproduces the published 430/456/886 exactly, twice, independently; completeness-claim-checker.ts PASS at HEAD; independently corrupted a live committed marker's expect= value and confirmed QA-15 catches the mismatch for real (then restored, clean). Closed.
3. [CLEAN][demonstrated] Issue #154: independently re-measured via a separately-authored instrumented classifier copy (not reused from the build or red-team) -- 10/194 continuation-marked occurrences fail real existence at diff-scope, all traceable to one fixture number (#9999); real shipped gate shows 6/35 blocking findings are this residual (grown by 1 from the build's disclosed 5/33, fully explained by the same self-referential corpus-growth pattern already disclosed elsewhere in this project). "Disclosed, no fix" architectural judgment reconfirmed sound -- small, mechanically measured, safe-direction (blocking, never silent). Closed.
4. [CLEAN][code-traced] Whole 35-ADR-catalog sweep on this round's new diff (probe --field flag, 3 new KNOWN_INSTRUMENTS entries, 3 live markers): grepped both ADR folders for completeness/marker/instrument/QA-14/QA-15 -- no ADR governs this project's completeness-claim-checker mechanism; ADR-0021's evidence trail (audit log) and ADR-0008's CI/CD ratchet rule both re-confirmed out of scope by reading their own text a third time. No collision.
5. [CLEAN][demonstrated] Baseline gates independently re-run: typecheck clean, lint clean, npm test 727/727 pass, 0 fail, 0 skipped.
6. [CLEAN][code-traced] No duplicate issues filed (gh issue list --search checked before every closure); final states of #137/#143-#154 all correctly disposed after this round's closures; working tree clean throughout (all scratch instrumentation removed before finishing).
counts (checksum): issues=1 suspicions=0 clean=5
evidence (checksum): demonstrated=4 code-traced=2 derived=0
checks=npm test 727/727 pass 0 fail 0 skip; npm run typecheck clean; npm run lint clean; node src/qa/marker-corpus-probe.ts --field=marked/unmarked/total -> 430/456/886 (2 repeats); node src/qa/completeness-claim-checker.ts -> PASS (2 files); live-marker corruption test (expect=999 vs real 886) -> FAIL then restored PASS; independent instrumented reference-resolver.ts copy -> 10/194 diff-scope continuation-marked fail real existence; node src/qa/reference-resolver.ts c598312 HEAD -> exit 1, 35 blocking, 6 attributable to the #154 residual; npx tsx --test src/qa/completeness-claim-checker.test.ts -> 16/16 pass
adr=HIT(35, whole catalog)
report=docs/reviews/qa14-marker-redesign-cross-domain-round3-2026-09-11.md
