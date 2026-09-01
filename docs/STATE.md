# Project State
_Read this first (PRINCIPLES.md rule 14). The Manager keeps it current at every ship-close so the loop resumes across sessions. Keep it short — bullets and tables, not prose._

**Last updated:** 2026-09-01

## Current state
- **Requirements loop re-run this session: REQUIREMENTS.md's 2026-09-01 amendment (runtime managed-settings absorbed SUR-04, INT-01's runtime-settings half, POL-09's delivery half; QA-17 added) reconciled against GitHub tracking. No code built this session — intake + reconciliation only. See `docs/decisions.md` (2026-09-01 row) for the full ruling.**
  - New story **S1b** (Milestone #36, Issue #59) opened for QA-17 only, sequenced **before S2** — small standalone instrument, no dependency on S2's kernel work.
  - Milestone descriptions corrected for the two unstarted stories the amendment touches: **#25 (S7)** INT-01 narrowed (runtime-settings half is now configure-and-verify, not build); **#24 (S6)** POL-09 narrowed to the pinning/stamping half only. **#31 (S11c)** got an informational ENV-13 note, no scope change.
  - T15 (policy-engine substrate, §12) marked **superseded by ADR-0021** directly in REQUIREMENTS.md — its "AGT `PolicyEngine` is the current choice" premise is overturned by ADR-0021's Accepted native-build decision.
  - Confirmed unchanged, no carry from the old (pre-pivot) plan: §1's reuse ledger and §13's old M1–M8 table stay untouched historical record, per the 2026-08-29/30 scoping — this session's edits touched only the amendment's actual requirement-table deltas plus the one stale T15 row.
  - `REQUIREMENTS.md` and `CHANGELOG.md` amendment text (already drafted, uncommitted at session start) plus the T15 correction, `docs/decisions.md`, and this file are committed together this session (see commit below).
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
1. **Human: push the ADR-0021 acceptance commit** — `adr` submodule commit `cdb245d` ("Accept ADR-0021... supersede ADR-0017") is made locally, not yet pushed. `git -C adr push origin main`. Human decision already given ("I accept") this session; the Manager made the commit but is holding the push (any push to a default branch is human-only, including the `adr` submodule's `main`).
2. **Then: plan S1b** (Milestone #36, Issue #59) — QA-17 only, the runtime-primitive drift instrument. Small and standalone; do this before S2 since it's cheap and the document names it P0.
3. **After that:** plan S2 (kernel / Action record / normalizer registry, ADR-0021 shapes 1–3) — the next story on the critical path (S1→S1b→S2→S3→S4→S5→S11a→S11b per the human-approved breakdown, now 18 stories with S1b inserted). GitHub Milestone "S2 — Canonical Action record + pure policy kernel" (#20) already exists, open.

**thoth's own push (S1's code) is done** — `master` confirmed pushed and matching `origin/master` at `d3a833f` (verified via `git fetch` this session, not assumed).

## Blocked on a human
- Push the `adr` submodule's acceptance commit (see Next #1) — the one remaining action before S2 can start.
- Repo visibility flip to public — explicitly out of S1's scope (OSS-01 builds/runs the scan only); revisit at OSS-02–14 (Milestone #35).
- T6 (rehearsal account/cluster) — doesn't block S1/S2, will block S11c/S12 (Milestones #31/#32) when reached.
- T9 was decided this session (Apache-2.0) — no longer blocking.

## GitHub tracking (reconciled 2026-09-01)
- **Milestones:** the 9 stale pre-pivot milestones (old M1/M1.5/M2–M8 titles, zero linked issues) deleted. Replaced with 17 fresh milestones matching the human-approved story breakdown: #19 (S1, closed/shipped) through #35 (S15). Numbering/titles: S1=#19, S2=#20, S3=#21, S4=#22, S5=#23, S6=#24, S7=#25, S8=#26, S9=#27, S10=#28, S11a=#29, S11b=#30, S11c=#31, S12=#32, S13=#33, S14=#34, S15=#35.
- **Issues:** #58 created for S1, closed `completed`, linked to Milestone #19, cites commits `2992bfb`/`366c54d`/`d3a833f`.
- **"thoth delivery board" project (v2, id 4):** the one stale item (Issue #32, from the abandoned lineage) removed. Issue #58 added, `Status=Shipped`, `Risk tier=STANDARD`.
- **Same-day follow-up (requirements-loop re-run, later this session):** Milestone #36 (S1b — Runtime-primitive drift check, QA-17) created; Issue #59 created, linked to #36, added to the delivery board project. Milestone #25 (S7) and #24 (S6) descriptions corrected for the 2026-09-01 REQUIREMENTS.md amendment (INT-01/POL-09 narrowed); #31 (S11c) got an informational ENV-13 note.

## Open questions / pending decisions
- All logged and ratified in `docs/decisions.md` (6 active rows — AGT-pivot, its consequences, S1 tier/ceremony/toolchain, the AGT-reuse-evaluation refinement, the autonomous-continuation authorization, the fresh-start-from-`master` row, and this session's requirements-loop reconciliation row). Nothing new unlogged.

## Session savings (ADR cache)
- **This session (2026-08-29 to 2026-08-30):** 5 agent dispatches confirmed an explicit `≈N tokens saved` figure in their own reported/persisted receipt: 3× ≈16,800 (fp `30ac82c`, 34 ADRs — two Phase-0/Phase-1 planning passes before the AGT-pivot, one after) + 2× ≈17,300 (fp `6c22c70`/`be365e4`, 35 ADRs — `architecture-reviewer`'s checkpoint-1 ADR review, `story-implementer`'s Phase 2B build). **≈85,000 tokens saved this session** (3×16,800 + 2×17,300). Several other dispatches (intake-refiner, both S1 Stage-3 review rounds, both re-confirm passes, the ADR-0016 amender, several ADR-cache `BUILT` rebuilds after ADR edits) confirmed `CACHE=HIT` with a real ADR count in their receipt but did not include the token-saved number in their reported output, so are **not** counted toward this total — real reuse happened there too, just not quantified in a form this rule can cite without inventing a figure.
- Est. cost saved: **~$0.26** = 85,000 × Sonnet $3/M. Rough estimate.
- **This session (2026-09-01):** session-start hydration confirmed `CACHE=HIT`, 35 ADRs, **≈17,300 tokens saved** (fp `83b2e3e`). The one agent dispatch this session (`intake-refiner`, requirements-loop intake) doesn't read the ADR catalog — its job is testable-requirement extraction, not ADR compliance — so it reported no `📊 ADR cache` line and contributes no additional figure here; not counted rather than estimated. Total this session: **≈17,300 tokens (~$0.05)**.
