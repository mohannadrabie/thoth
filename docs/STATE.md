# Project State
_Read this first (PRINCIPLES.md rule 14). The Manager keeps it current at every ship-close so the loop resumes across sessions. Keep it short — bullets and tables, not prose._

**Last updated:** 2026-09-01

## Current state
- **S1b (QA-17, runtime-settings drift check) — built, reviewed clean, verified, audited. Ready to merge; nothing blocking.**
  - Scope: QA-17 only (Milestone #36, Issue #59). Build-shape ruling (data source, fail semantics, cadence, version-floor-bump deferral) logged in `docs/decisions.md` 2026-09-01 row.
  - New files: `docs/qa/runtime-settings-inventory.json` (vendored 18-key snapshot), `src/qa/runtime-settings-drift-check.ts` + `.test.ts`. Edits: `package.json` (script alias), `.github/workflows/ci.yml` (weekly `schedule:` trigger + new gated job), `CHANGELOG.md`.
  - **Stage 3 review:** `app-security-reviewer` APPROVE (5/5 CLEAN) first pass. `cross-domain-reviewer` APPROVE-WITH-CONDITIONS first pass — 1 demonstrated MED (Issue #60: new `schedule:` trigger silently widened the pre-existing `ci` job's own trigger scope too, no matching `if:` guard, causing a disclosed-vacuous-pass on QA-02/QA-14 and a redundant weekly full-suite re-run). Fixed same-turn (one-line `if: github.event_name != 'schedule'` added to `jobs.ci`). Re-confirmed: `cross-domain-reviewer` **APPROVE**, structurally verified via `js-yaml` parse (the two jobs' `if:` conditions confirmed exact mirror-opposites). Issue #60 closed `completed`.
  - **Stage 4 (verify):** `npm run typecheck` clean, `npm run lint` clean, `npm test` 99/99 pass/0 fail/0 skipped.
  - **Stage 5 (audit):** both persisted reports (app-security, cross-domain) read in full by the Manager (STANDARD tier; cross-domain's stale first-receipt verdict was a `receipt-check.mjs`-flagged reopen trigger — traced to the pre-fix RECEIPT block, resolved by reading the appended re-confirm section). No unaddressed defect found.
  - Toolchain/pattern: matches QA-15/QA-16 siblings (`src/qa/`, `src/lib/instrument.ts` shared reporter), stdlib-only (`node:fs`, `node:url`), no new npm dependency.
- **Requirements loop re-run 2026-09-01 (prior session): REQUIREMENTS.md's 2026-09-01 amendment (runtime managed-settings absorbed SUR-04, INT-01's runtime-settings half, POL-09's delivery half; QA-17 added) reconciled against GitHub tracking.**
  - Milestone descriptions corrected for the two unstarted stories the amendment touches: **#25 (S7)** INT-01 narrowed (runtime-settings half is now configure-and-verify, not build); **#24 (S6)** POL-09 narrowed to the pinning/stamping half only. **#31 (S11c)** got an informational ENV-13 note, no scope change.
  - T15 (policy-engine substrate, §12) marked **superseded by ADR-0021** directly in REQUIREMENTS.md — its "AGT `PolicyEngine` is the current choice" premise is overturned by ADR-0021's Accepted native-build decision.
  - Confirmed unchanged, no carry from the old (pre-pivot) plan: §1's reuse ledger and §13's old M1–M8 table stay untouched historical record, per the 2026-08-29/30 scoping.
- **S1 ("protect the baseline") — built, reviewed clean, verified, audited, merged pending human push (see below).**
  - Scope: CI-01, QA-01, QA-02, QA-05, QA-06, QA-13, QA-14, QA-15, QA-16, OSS-01. Commits `2992bfb` (build) + `366c54d` (Stage-3 fix-now pass), both local, unpushed, on `master`.
  - Built against ADR-0021 revision 2 (`adr` submodule `76879ff` + `5a7fb09`, status `Proposed`) — six architecture shapes, each independently evaluated reuse-vs-build against verified current AGT facts (all six land BUILD, for stated, checked reasons — see `docs/reviews/adr0021-thoth-native-architecture-checkpoint2-2026-08-30.md`).
  - **Stage 3 review, full cycle:** round 1 — `app-security-reviewer` REWORK (1 demonstrated HIGH: arbitrary command execution via `completeness-claim-checker.ts`'s `cmd=` marker), `cross-domain-reviewer` APPROVE-WITH-CONDITIONS (1 demonstrated MED: silent `VACUOUS-PASS` on zero-SHA git ref, a second recurrence of Issue #18). Both fixed in commit `366c54d`. Round 2 (re-confirm) — `app-security-reviewer` **APPROVE**, `cross-domain-reviewer` **APPROVE-WITH-CONDITIONS** (1 new LOW, backlogged, non-blocking — QA-02's fallback-mode summary text overstates its own guarantee). `reviewRoundsSinceClean` reset to 0 — no rule-16(c) council trigger.
  - Issues #57 and #18 both closed `state_reason: completed`, comments correctly evidenced.
  - **Stage 4 (verify):** independently re-run by the Manager — `npm run typecheck` clean, `npm run lint` clean, `npm test` 89/89 pass/0 fail/0 skipped.
  - **Stage 5 (audit):** all 6 persisted reports (2 ADR-0021 checkpoints + 2 S1 review rounds) read in full by the Manager (STANDARD tier, none pre-exempted) — every RECEIPT checksum-verified by hand; `docs/receipt-check.mjs` flagged all 6 as REOPEN, every trigger traced to either expected STANDARD-tier behavior (conditional verdict, unconfirmed suspicions, `checks=n/a` on document-only reviews) or a cosmetic evidence-tally slip (logged to `docs/backlog.md` for `/maat:audit`'s reviewer-calibration sample) — no real, unaddressed defect found beyond what was already fixed.
  - Real bugs found and fixed during build/fix (not deferred): `NODE_TEST_CONTEXT` env leak in nested `node --test` subprocesses (`src/lib/exec.ts`), `git ls-tree` gitlink/submodule entries crashing the history scan (`src/lib/git.ts`), an email-regex false positive on npm version specifiers (`src/secret-scan/patterns.ts`), the command-execution and silent-pass fixes above.
  - Toolchain: TypeScript (native Node type-stripping, `engines.node >=22.18.0`), `node:test`, npm, ESLint flat config. License: Apache-2.0 (T9).

## Next (in order)
1. **Human: push `thoth`'s `master`** — this session's S1b commit (+ the prior session's requirements-loop reconciliation commit) is local, unpushed. `git push origin master`.
2. **Plan S2** (kernel / Action record / normalizer registry, ADR-0021 shapes 1–3) — the next story on the critical path (S1→S1b→S2→S3→S4→S5→S11a→S11b per the human-approved breakdown, 18 stories). GitHub Milestone "S2 — Canonical Action record + pure policy kernel" (#20) already exists, open.

**Correction (this session):** the prior session's STATE.md said the `adr` submodule's ADR-0021 acceptance push was still blocked on the human. Checked directly this session — `adr`'s `main` is already at `cdb245d` and matches `origin/main` (`git -C adr log origin/main..main` empty, `git -C adr status` clean). **That push already happened**; nothing outstanding on the `adr` submodule.

## Blocked on a human
- Push `thoth`'s `master` (see Next #1) — the only remaining action before S2 can start.
- Repo visibility flip to public — explicitly out of S1's scope (OSS-01 builds/runs the scan only); revisit at OSS-02–14 (Milestone #35).
- T6 (rehearsal account/cluster) — doesn't block S1/S2, will block S11c/S12 (Milestones #31/#32) when reached.
- T9 was decided (Apache-2.0) — no longer blocking.

## GitHub tracking (reconciled 2026-09-01)
- **Milestones:** the 9 stale pre-pivot milestones (old M1/M1.5/M2–M8 titles, zero linked issues) deleted. Replaced with 17 fresh milestones matching the human-approved story breakdown: #19 (S1, closed/shipped) through #35 (S15). Numbering/titles: S1=#19, S2=#20, S3=#21, S4=#22, S5=#23, S6=#24, S7=#25, S8=#26, S9=#27, S10=#28, S11a=#29, S11b=#30, S11c=#31, S12=#32, S13=#33, S14=#34, S15=#35.
- **Issues:** #58 created for S1, closed `completed`, linked to Milestone #19, cites commits `2992bfb`/`366c54d`/`d3a833f`. #59 (S1b/QA-17) still open — tracks in-progress work until merge. #60 (cross-domain-reviewer's Stage-3 MED finding) closed `completed`, fix verified.
- **"thoth delivery board" project (v2, id 4):** the one stale item (Issue #32, from the abandoned lineage) removed. Issue #58 added, `Status=Shipped`, `Risk tier=STANDARD`.
- **Follow-up (requirements-loop re-run, prior session):** Milestone #36 (S1b — Runtime-primitive drift check, QA-17) created; Issue #59 created, linked to #36, added to the delivery board project. Milestone #25 (S7) and #24 (S6) descriptions corrected for the 2026-09-01 REQUIREMENTS.md amendment (INT-01/POL-09 narrowed); #31 (S11c) got an informational ENV-13 note.

## Open questions / pending decisions
- All logged and ratified in `docs/decisions.md` (8 active rows). The 2026-08-30 autonomous-continuation-authorization row passed its review-back date this session and was archived to `docs/decisions-archive.md` (verbatim, via `node docs/decisions-archive.mjs --apply`). Nothing new unlogged.

## Session savings (ADR cache)
- **2026-08-29 to 2026-08-30:** ≈85,000 tokens (~$0.26). See `docs/decisions-archive.md`/prior STATE.md history for the per-dispatch breakdown.
- **2026-09-01, earlier session (requirements-loop reconciliation):** ≈17,300 tokens (~$0.05) — session-start hydration only; the one dispatch (`intake-refiner`) doesn't read the ADR catalog.
- **2026-09-01, this session (S1b build):** 3 dispatches confirmed an explicit `≈17,300 tokens saved` figure (fp `83b2e3e`, 35 ADRs) in their own reported/persisted receipt: session-start hydration, `story-implementer`'s Phase 1 plan, `cross-domain-reviewer`'s original Stage-3 pass. **≈51,900 tokens saved this session.** `story-implementer`'s build/fix-now passes and `app-security-reviewer`'s report confirmed `CACHE=HIT` with the same fingerprint but did not restate the token figure, so are **not** counted toward this total (real reuse happened there too, just not quantified in cite-able form). Est. cost saved: **~$0.16** = 51,900 × Sonnet $3/M. Rough estimate.
