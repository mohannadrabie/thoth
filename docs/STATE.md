# Project State
_Read this first (PRINCIPLES.md rule 14). The Manager keeps it current at every ship-close so the loop resumes across sessions. Keep it short — bullets and tables, not prose._

**Last updated:** 2026-08-30

## Current state
- **S1 ("protect the baseline") — built, reviewed clean, verified, audited. Ready to merge pending one human action (ADR-0021 acceptance).**
  - Scope: CI-01, QA-01, QA-02, QA-05, QA-06, QA-13, QA-14, QA-15, QA-16, OSS-01. Commits `2992bfb` (build) + `366c54d` (Stage-3 fix-now pass), both local, unpushed, on `master`.
  - Built against ADR-0021 revision 2 (`adr` submodule `76879ff` + `5a7fb09`, status `Proposed`) — six architecture shapes, each independently evaluated reuse-vs-build against verified current AGT facts (all six land BUILD, for stated, checked reasons — see `docs/reviews/adr0021-thoth-native-architecture-checkpoint2-2026-08-30.md`).
  - **Stage 3 review, full cycle:** round 1 — `app-security-reviewer` REWORK (1 demonstrated HIGH: arbitrary command execution via `completeness-claim-checker.ts`'s `cmd=` marker), `cross-domain-reviewer` APPROVE-WITH-CONDITIONS (1 demonstrated MED: silent `VACUOUS-PASS` on zero-SHA git ref, a second recurrence of Issue #18). Both fixed in commit `366c54d`. Round 2 (re-confirm) — `app-security-reviewer` **APPROVE**, `cross-domain-reviewer` **APPROVE-WITH-CONDITIONS** (1 new LOW, backlogged, non-blocking — QA-02's fallback-mode summary text overstates its own guarantee). `reviewRoundsSinceClean` reset to 0 — no rule-16(c) council trigger.
  - Issues #57 and #18 both closed `state_reason: completed`, comments correctly evidenced.
  - **Stage 4 (verify):** independently re-run by the Manager — `npm run typecheck` clean, `npm run lint` clean, `npm test` 89/89 pass/0 fail/0 skipped.
  - **Stage 5 (audit):** all 6 persisted reports (2 ADR-0021 checkpoints + 2 S1 review rounds) read in full by the Manager (STANDARD tier, none pre-exempted) — every RECEIPT checksum-verified by hand; `docs/receipt-check.mjs` flagged all 6 as REOPEN, every trigger traced to either expected STANDARD-tier behavior (conditional verdict, unconfirmed suspicions, `checks=n/a` on document-only reviews) or a cosmetic evidence-tally slip (logged to `docs/backlog.md` for `/maat:audit`'s reviewer-calibration sample) — no real, unaddressed defect found beyond what was already fixed.
  - Real bugs found and fixed during build/fix (not deferred): `NODE_TEST_CONTEXT` env leak in nested `node --test` subprocesses (`src/lib/exec.ts`), `git ls-tree` gitlink/submodule entries crashing the history scan (`src/lib/git.ts`), an email-regex false positive on npm version specifiers (`src/secret-scan/patterns.ts`), the command-execution and silent-pass fixes above.
  - Toolchain: TypeScript (native Node type-stripping, `engines.node >=22.18.0`), `node:test`, npm, ESLint flat config. License: Apache-2.0 (T9).

## Next (in order)
1. **Human: accept or reject ADR-0021** (`adr/software-engineering/0021-thoth-native-architecture.md`, currently `Proposed`) — the native architecture (policy kernel, canonical Action record, normalizer/extractor registry, gate surfaces, evidence trail, environment/assurance model) that S1 was built against and S2 needs accepted before it can start. Per SE ADR-0001, only a human can accept it — the Manager will not self-accept regardless of standing authorization.
2. **Human: merge S1** — `git push` then merge/fast-forward `master` with commits `2992bfb`+`366c54d` (already committed locally; human-only action, never done by the loop). See "Next action" below for the exact commands.
3. **After both:** plan S2 (kernel / Action record / normalizer registry, ADR-0021 shapes 1–3) — the next story on the critical path (S1→S2→S3→S4→S5→S11a→S11b per the human-approved 17-story breakdown, `docs/decisions.md` 2026-08-30).

## Blocked on a human
- ADR-0021 final acceptance (see Next #1).
- Merge of S1's two local commits (see Next #2) — human-only regardless of review verdict.
- Repo visibility flip to public — explicitly out of S1's scope (OSS-01 builds/runs the scan only); revisit at OSS-02–14.
- T6 (rehearsal account/cluster) — doesn't block S1/S2, will block S11c/S12 when reached.
- T9 was decided this session (Apache-2.0) — no longer blocking.

## Open questions / pending decisions
- All logged and ratified in `docs/decisions.md` (5 active rows this session — AGT-pivot, its consequences, S1 tier/ceremony/toolchain, the AGT-reuse-evaluation refinement, the autonomous-continuation authorization, and the fresh-start-from-`master` row). Nothing new unlogged.

## Session savings (ADR cache)
- **This session (2026-08-29 to 2026-08-30):** 5 agent dispatches confirmed an explicit `≈N tokens saved` figure in their own reported/persisted receipt: 3× ≈16,800 (fp `30ac82c`, 34 ADRs — two Phase-0/Phase-1 planning passes before the AGT-pivot, one after) + 2× ≈17,300 (fp `6c22c70`/`be365e4`, 35 ADRs — `architecture-reviewer`'s checkpoint-1 ADR review, `story-implementer`'s Phase 2B build). **≈85,000 tokens saved this session** (3×16,800 + 2×17,300). Several other dispatches (intake-refiner, both S1 Stage-3 review rounds, both re-confirm passes, the ADR-0016 amender, several ADR-cache `BUILT` rebuilds after ADR edits) confirmed `CACHE=HIT` with a real ADR count in their receipt but did not include the token-saved number in their reported output, so are **not** counted toward this total — real reuse happened there too, just not quantified in a form this rule can cite without inventing a figure.
- Est. cost saved: **~$0.26** = 85,000 × Sonnet $3/M. Rough estimate.
