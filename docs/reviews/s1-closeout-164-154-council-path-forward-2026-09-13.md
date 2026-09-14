# Path-Forward Brief — s1-closeout-164-154 — 2026-09-13

**Council verdict:** GO · **Rounds spent:** 3 Stage-3 review rounds + this council (round 4 overall) · **Feature code written so far:** ~140 lines net (marker-corpus-probe.ts, continuation-residual-probe.ts, src/lib/git.ts + their .test.ts files)
**Trigger:** rule 16(c) — 3 consecutive REWORK-class Stage-3 verdicts on this scope, each round's fix-now genuinely closing its assigned findings while introducing a new one.

## Business impact
- **What users cannot do today:** nothing external — this is internal QA/CI tooling (a citation-count instrument + a secret-scan gate), no user-facing surface, no money/data path.
- **Cost of the stall:** 3 CRITICAL-tier review rounds (9 reviewer dispatches) + this 3-seat council, to close 2 originally-small issues (#164, #154) plus the defects each round's own fix introduced.
- **Deadline pressure:** none.
- **Exposure if we ship with the current residuals:** #180 blocks CI/merge outright (100% of runs, `basis: measured`) — not optional. #181/#182 are both real but small (documentation-lint gap; a ~1-2% citation-count drift under transient untracked scratch files, `basis: measured`).
- **Exposure if we keep reviewing:** nothing further gets built; the 3-round pattern itself (verification blind to the next round's own defect class) is now well-understood and doesn't need a 4th review round to re-discover.

## The problem, technically
- All 9 of this story's original + round-1/2/3 fixes (#164, #154, #170→#176, #171, #172, #173, #177, #178, #179) are independently re-confirmed genuinely correct by 2-3 reviewers each, with real mutation/repro evidence — design-challenger's Stop Brief found zero calibrated blocking HIGH remaining.
- 3 genuinely open items: **#180** [HIGH by reviewer tag, git-history-permanent secret-scan gate break — mandatory fix, not a residual] · **#181** [MED, QA-13's own recurring-findings-registry owed a row — this defect class's 2nd occurrence] · **#182** [MED, `marker-corpus-probe.ts`'s published total silently drifts with transient untracked scratch files in the working tree].
- What's never been run, across all 3 rounds: any check of a round's OWN new committed content against the secret-scan allowlist, or against QA-13's registry, BEFORE the round is declared clean — every round's "N/N pass" was measured pre-commit, against a tree state the actually-failing gates (OSS-01, the registry) don't read.

## Root cause
This project's Stage-3 review loop has no standing pre-commit check of the actual to-be-committed tree state against its own full gate set (secret-scan, registry-lint) — a lesson this project already wrote down once (the `cifix` council's "Path B", 2026-09-09) and never operationalized, so round 3 reproduced it verbatim five days later in the same file family.

## Options

| | Path | Cost | Risk | Analyst verdict | Architect verdict |
|---|---|---|---|---|---|
| **A** | Fix #180 (allowlist entry, mandatory) + #181 (registry row) now, lighter ceremony (not a full 3-reviewer CRITICAL round — #164/#154's own substance settled after round 1, remaining items are isolated single-file fixes with no compounding history between each other); defer #182 as a disclosed residual (matching #154's own already-accepted precedent — rescoping the count risks failing the already-shipped #172 regression test, a guaranteed *reopening* of this exact 3-round pattern, not a hypothetical one) | ~1-2 files, hours, no new review round | #182 stays a small, disclosed, measured drift (~1-2%) | SAFE-TO-PATCH (as "Candidate C") | APPROVE-WITH-CONDITIONS |
| **B** | Build the standing pre-commit dogfood check (ratified in principle at `cifix`'s own council, never built) now, folded into this story | Multi-file, new mechanism, its own review ceremony (novel shape, PRINCIPLES rule 15) | WIDENS this story's own scope — the exact compounding pattern that got it to a council in the first place | SUSPICION/WIDENS-adjacent | REWORK (as folded in here) — APPROVE as its own next story |
| **C** | Ship all of #180/#181/#182 as disclosed residuals, no further code | None | #180 is a hard, git-history-permanent CI/merge blocker (devops ADR-0008) — not a residual you can choose to accept | N/A (#180 can't ship unfixed) | REWORK |

## Council recommendation
**Path A** — fix the one mandatory item (#180) plus the cheap, owed registry row (#181), with lighter ceremony given the remaining scope is now isolated and well-understood; disclose #182 rather than risk a 4th round chasing a fix that the analyst shows would guarantee re-triggering the exact class this council was convened over. Strongest argument against: #182 is a silent, `exit 0` drift in the very figure this instrument exists to publish — deferring it trusts readers to see the disclosure rather than trust the number at face value.

## Dissent
None — all three seats converge on Path A (architect's "Path A" and analyst's "Candidate C" describe the same reconciled shape: fix #180/#181 now, disclose #182, decline to fold Path B in here). Architect flags one refinement analyst didn't: #182's underlying "what does this count mean" question deserves a one-line named decision in `docs/decisions.md`, not just a code comment — folded into this brief's own build task list.

## Build tasks (GO — routed directly to `story-implementer`, no further review round required for this scope; commit-before-close ordering enforced per this story's own repeated lesson)
1. Fix #180: add the missing `docs/qa/secret-scan-allowlist.json` entry for `src/qa/marker-corpus-probe.test.ts`'s `test@example.com` literal, mirroring the existing `history-scan.test.ts` precedent. Re-run `node src/secret-scan/history-scan.ts` for real (post-commit, on the actual committed tree) to confirm exit 0 — this is the exact check that was missing all 3 rounds.
2. Fix #181: add the owed `docs/qa/recurring-findings-registry.md` row for "a fix round's own committed artifacts red a gate that only reads committed state" (2nd occurrence: Issue #131 → #180).
3. #182: disclose only — a one-line `docs/decisions.md` row naming the corpus-count-semantics question and the ruling (matches #154's own precedent: real, small, disclosed, not code-fixed), plus a code comment at the relevant line. No functional code change.
4. Route Path B (the standing pre-commit dogfood check) to `docs/backlog.md` as its own next STANDARD-or-higher-tier story — already scoped there in principle since `cifix`, now with a second concrete trigger cited.
5. Re-verify the FULL suite + `node src/secret-scan/history-scan.ts` + `node src/qa/recurring-findings-registry.ts` + `node src/qa/completeness-claim-checker.ts` all pass for real, post-commit — not pre-commit, given this is the exact gap that bit 3 rounds running.
6. Only then close #164/#154/#180/#181 (commit before close, verified by timestamp, not memory).

**Reports:** `docs/reviews/s1-closeout-164-154-design-challenger-stopbrief-2026-09-13.md` · `docs/reviews/s1-closeout-164-154-architecture-2026-09-13.md` · `docs/reviews/s1-closeout-164-154-impact-analyst-2026-09-13.md`
