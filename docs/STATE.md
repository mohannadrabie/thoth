# Project State
_Read this first (PRINCIPLES.md rule 14). The Manager keeps it current at every ship-close so the loop resumes across sessions. Keep it short — bullets and tables, not prose._

**Last updated:** 2026-09-01

## Current state
- **S2 (canonical Action record + pure policy kernel) — built, reviewed, verified, audited. Shipped this session; ready for the human's push/merge.**
  - Scope: ADR-0021 shapes 1 (kernel) + 2 (Action record) only, per `docs/decisions.md`'s 2026-09-01 S2 row — shape 3 (normalizer registry) and real config-file loading (T10/S6) explicitly deferred, pure in-memory/fixture data throughout.
  - New: `src/policy/kernel/{action-record,rule-types,verdict,kernel}.ts` (+ tests), `src/policy/rule/{schema,precedence}.ts` (+ tests), `src/policy/fixtures/{action-records,rules}.ts`, `src/qa/kernel-purity-check.ts` (+ test) + its `selftest-fixture/kernel-purity/{clean,violating}` pair, `docs/plans/S2-phase1-2026-09-01.md` (Phase 1 plan, Manager-persisted). Edits: `package.json` (`qa:kernel-purity` script), `.github/workflows/ci.yml` (wired into the main `ci` job), `CHANGELOG.md`.
  - POL-05 (fail-closed on opaque/unresolved) and SUR-09 (deferred evaluated as execution) are hard-coded, unconditional kernel rules; POL-01/POL-06/POL-08 proven via `src/policy/rule/` + fixtures, wired end-to-end in `kernel.test.ts`'s three-layer-conflict case. POL-11 (kernel purity) enforced by the new `qa:kernel-purity` structural instrument, non-vacuously green against the real `src/policy/kernel/`.
  - **Stage 3 review — full arc, two fix-now rounds:**
    - Round 1: `app-security-reviewer` APPROVE-WITH-CONDITIONS (2 demonstrated MED, Issues #62/#63); `cross-domain-reviewer` REWORK (1 code-traced HIGH, Issue #61 — `ActionRecord.source` was an open tool-family string, not ADR-0021's `"parsed"|"structured"|"opaque"` enum). Human approved fix-now.
    - Fix-now round 1: Issue #61 fixed cleanly (retyped, fixtures/tests updated). Issue #63 interim half fixed (widened `FORBIDDEN_GLOBAL_PATTERNS`). **Issue #62's fix was comment-only** — the underlying `isMutating()`/`pol05Rule` gate behavior was unchanged; `app-security-reviewer`'s re-confirm caught this by re-running its own PoC directly rather than trusting the fix claim.
    - Re-confirm: `cross-domain-reviewer` APPROVE (Issue #61 genuinely closed). `app-security-reviewer` APPROVE-WITH-CONDITIONS, Issue #62 still open (real gap: `isMutating()` gated on a hardcoded verb list *before* ever checking `unresolved`, so an action whose verb was unclassifiable never reached the ambiguity check), plus a new adjacent gap on Issue #63 (bare Node `global` identifier bypassed the widened regex). Human approved a second, narrower fix-now.
    - Fix-now round 2: `isMutating()` now also returns `true` whenever `action.unresolved.length > 0`, independent of verb classification (additive OR) — ambiguity forces the check regardless of verb recognition. `kernel-purity-check.ts` gained a `global` bare-identifier pattern. Both reproduced by the implementer as real `allow`→`deny` / `[]`→`[detected]` behavior changes, not just passing tests.
    - Final re-confirm: **both reviewers APPROVE**, each independently re-ran the original PoCs against the live code (not the implementer's word) and confirmed both gaps genuinely closed, no regression to prior clean findings. Issues #61/#62 closed `completed`; Issue #63 stays open — deliberately, non-blocking, durable AST-based check tracked in `docs/backlog.md`.
    - Residual, deliberately deferred (`docs/backlog.md`, "S2 re-confirm" entry): an unrecognized verb *without* an explicit `unresolved` flag still defaults to non-mutating → `allow`. Needs a real action catalog/verb taxonomy (ADR-0021 shape 3, a later story) to resolve properly — not S2's to guess at.
  - **Stage 4 (verify):** independently re-run by the Manager — `npm run typecheck` clean, `npm run lint` clean, `npm test` 187/187 pass/0 fail/0 skipped, `npm run qa:kernel-purity` PASS (4 files, non-vacuous).
  - **Stage 5 (audit) + 5.5 (pre-merge full read):** both persisted reports read in full (STANDARD tier; `receipt-check.mjs` flagged both REOPEN — expected, each carries 3 appended RECEIPT blocks across the two fix-now rounds; the final blocks are both clean APPROVE). No unaddressed defect found. `docs/decisions.md`'s 2026-09-01 S2-scope row read and confirmed accurate.
  - GitHub: tracking Issue #64 created and closed `completed`, linked to Milestone #20, added to the delivery board (`Status=Shipped`, `Risk tier=STANDARD`). Issues #61/#62 closed `completed`; #63 open by design.
  - **Pre-existing, out-of-scope QA-15 gap noticed during this build (not caused by S2):** `node src/qa/completeness-claim-checker.ts` FAILed on this file's own S1 close-out prose (a bare numeric completeness claim with no `[[completeness: ...]]` marker). Fixed as a same-session housekeeping edit while this file was already being touched (rephrased, not marker-fabricated — no instrument tracks "reports read in full").
- **S1b (QA-17, runtime-settings drift check) — built, reviewed clean, verified, audited, merged and pushed.** GitHub board hygiene fixed this session (Status/Risk tier were never set on the project item; now `Shipped`/`STANDARD`).
  - Scope: QA-17 only (Milestone #36, Issue #59, closed `completed`). Build-shape ruling logged in `docs/decisions.md` 2026-09-01 row.
  - New: `docs/qa/runtime-settings-inventory.json`, `src/qa/runtime-settings-drift-check.ts` + `.test.ts`. Edits: `package.json`, `.github/workflows/ci.yml` (weekly `schedule:` job), `CHANGELOG.md`.
  - Stage 3: `app-security-reviewer` APPROVE (5/5 clean). `cross-domain-reviewer` APPROVE-WITH-CONDITIONS → fixed same-turn (Issue #60, CI trigger-scope bleed) → re-confirmed APPROVE.
  - Stage 4: `npm test` 99/99 pass. Stage 5: both reports read in full, no unaddressed defect.
- **S1 ("protect the baseline") — built, reviewed clean, verified, audited, merged and pushed.**
  - Scope: CI-01, QA-01/02/05/06/13-16, OSS-01. Commits `2992bfb` + `366c54d`. Built against ADR-0021 (accepted).
  - Stage 3: `app-security-reviewer` REWORK → APPROVE (Issue #57 fixed); `cross-domain-reviewer` APPROVE-WITH-CONDITIONS → APPROVE-WITH-CONDITIONS (Issue #18 fixed, 1 LOW backlogged). `reviewRoundsSinceClean` reset to 0.
  - Stage 4: `npm test` 89/89 pass. Stage 5: both ADR-0021 checkpoint reports and both S1 review-round reports read in full (4 reports total), no unaddressed defect.
  - Toolchain established: TypeScript (native Node type-stripping, `engines.node >=22.18.0`), `node:test`, npm, ESLint flat config. License: Apache-2.0 (T9).

## Next (in order)
1. **Human: push `thoth`'s `master`** — this session's S2 commit is local, unpushed. `git push origin master`.
2. **Plan S3** — the next story on the critical path (S1→S1b→S2→S3→S4→S5→S11a→S11b per the human-approved breakdown). GitHub Milestone #21 already exists, open.

## Blocked on a human
- Push `thoth`'s `master` (see Next #1).
- Repo visibility flip to public — out of scope until OSS-02–14 (Milestone #35).
- T6 (rehearsal account/cluster) — doesn't block S1–S3, will block S11c/S12 (Milestones #31/#32) when reached.

## GitHub tracking (updated 2026-09-01, this session)
- **Milestones:** #19 (S1) through #35 (S15), #36 (S1b) — all pre-existing, unchanged this session except #20 (S2, now has a closed tracking issue).
- **Issues this session:** #61 (HIGH, `ActionRecord.source` enum) closed `completed`. #62 (MED, POL-05 fail-open) closed `completed` after a real second fix. #63 (MED, purity-check obfuscation) — interim half + `global`-addendum closed via comments, parent issue stays open by design (durable AST-based check, tracked in `docs/backlog.md`). #64 (S2 tracking issue) created and closed `completed`, linked to Milestone #20.
- **"thoth delivery board" project (v2, id 4):** Issue #64 added, `Status=Shipped`, `Risk tier=STANDARD`. Issue #59 (S1b)'s Status/Risk tier fields were never set in a prior session — corrected this session to `Shipped`/`STANDARD`.

## Open questions / pending decisions
- All logged and ratified in `docs/decisions.md` (9 active rows, including this session's S2-scope ruling, review-back 2026-09-15). Nothing new unlogged.

## Session savings (ADR cache)
- **2026-08-29 to 2026-09-01 (prior sessions):** ≈154,200 tokens (~$0.47) cumulative. See `docs/decisions-archive.md`/prior STATE.md history for the per-session breakdown.
- **2026-09-01, this session (S2 build):** 3 dispatches confirmed an explicit `≈17,300 tokens saved` figure (fp `83b2e3e`, 35 ADRs) in their own reported/persisted receipt: session-start hydration, `story-implementer`'s Phase 1 plan, `cross-domain-reviewer`'s original Stage-3 pass. **≈51,900 tokens saved this session.** Every other dispatch (2 build/fix-now passes, 2 re-confirm rounds × 2 reviewers, `app-security-reviewer`'s original pass) confirmed `CACHE=HIT` with the same fingerprint but did not restate the token figure, so is **not** counted toward this total (real reuse happened there too, just not quantified in cite-able form). Est. cost saved: **~$0.16** = 51,900 × Sonnet $3/M. Rough estimate.
