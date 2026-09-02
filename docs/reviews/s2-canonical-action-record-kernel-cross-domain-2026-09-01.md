# S2 -- Canonical Action record + pure policy kernel -- cross-domain review

**Scope:** Milestone #20 (GitHub), STANDARD tier, ratified `docs/run-log.jsonl` 2026-09-02 `tier-ratified scope=S2`.
**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-01
**Lanes running alongside this pass:** `app-security-reviewer`, dispatched per the Phase 1 plan's Manager-ratification note (`docs/plans/S2-phase1-2026-09-01.md` section 3) -- domain-reviewer slot overridden from the implementer's proposed `architecture-reviewer` to `app-security-reviewer`, scoped narrowly to POL-05's fail-closed-on-ambiguity/authz-correctness property (the "Guard / policy engine" sensitive-area rule, applied by function). No `architecture-reviewer`/`code-reviewer` general-correctness pass runs on this diff -- this report's focus-area 6 (general correctness) is the compensating coverage for that gap, per this task's explicit mandate.

## ADR cache

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]

Read the WHOLE catalog (both `adr/devops/` and `adr/software-engineering/`), unfiltered, per this role's standing mandate (PRINCIPLES.md rule 9).

## Cross-domain ADR verdict

- **12 `adr/devops/*` ADRs:** not applicable -- no infra/IaC/cloud/cost/pipeline surface in this diff. Clean.
- **SE ADR-0001, 0003, 0010 (process, SOLID, quality gates):** satisfied by existing tooling/convention; nothing new required. Clean.
- **SE ADR-0004 (idempotency), 0005 (Playwright/E2E), 0006 (blast radius), 0007-0009 (tagging/cost/observability), 0011-0015 (data):** not applicable -- no mutating endpoint, no UI/E2E surface, no datastore/deploy surface. Clean.
- **SE ADR-0016-0020 (M1.5-lineage porting/self-protection):** ruled non-governing for this fresh build (`docs/decisions.md` 2026-08-29 row); ADR-0017 superseded by ADR-0021. Not re-litigated. Clean.
- **SE ADR-0002 (multi-layer architecture, pure-domain-layer precedent):** kernel directory's actual layering matches the precedent it claims to mirror. `src/policy/kernel/**` imports only from inside itself (`action-record.ts`, `rule-types.ts`, `verdict.ts` -- verified, zero cross-directory imports in `kernel.ts`). `src/policy/rule/{schema,precedence}.ts` depend INWARD on `../kernel/rule-types.ts` types only, never the reverse -- the one-directional dependency the kernel purity boundary's own header comments describe ("what the kernel itself may import, not a wall against being depended on") is real, not just documented. **CLEAN.**
- **SE ADR-0021 (thoth-native architecture) -- the primary applicable ADR:**
  - Kernel purity (no fs/network/process/timer/vendor-SDK import under `src/policy/kernel/**`): **CLEAN**, both code-traced (read every kernel file, zero forbidden imports/globals) and demonstrated (`npm run qa:kernel-purity` -> `PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations`, non-vacuous).
  - POL-05 fail-closed evaluated inside the kernel: **CLEAN** -- `pol05Rule()` (`src/policy/kernel/kernel.ts:62-82`) is unconditional, reads no external state, denies on `source === "opaque"` or non-empty `unresolved`, tested directly (`kernel.test.ts:50-70`).
  - SUR-09 (deferred-as-execution): **CLEAN** -- `isMutating()`/`pol05Rule()` deliberately never read `action.deferred`; proven by parity assertions (`kernel.test.ts:41-46, 72-83`) rather than by absence-of-evidence.
  - No AGT/third-party governance-decision import anywhere: **CLEAN** -- `grep -rn "agent-governance" src/` returns only pre-existing, unrelated secret-scan regression-test fixtures; `package.json`'s diff adds zero new dependencies.
  - **The 7-field Action record floor, with no extra kernel-branching fields: [ISSUE][HIGH] -- see finding 1 below.** This is the one real collision this pass found.

## Seam findings

### Finding 1 -- `ActionRecord.source`'s value domain contradicts ADR-0021's own canonical shape and REQUIREMENTS.md section 3.1

**Domains in tension:** the Action-record *contract* (shape 2, this story's own explicit scope) vs. the kernel *consumer* of that contract (`pol05Rule`, this story's own scope) vs. every *future normalizer* that will produce real records against this contract (ADR-0021 shape 3, a later story) -- a seam entirely inside this one diff's declared scope, not an app-security concern (POL-05's opaque-sentinel behavior itself still works correctly either way, which is why the narrowly-scoped `app-security-reviewer` lane would not surface this).

**Evidence (code-traced):**

ADR-0021's Decision section, "### 2. Canonical Action record" table (`adr/software-engineering/0021-thoth-native-architecture.md:111`):

    | `source` | `parsed` | `structured` | `opaque` | How confidently the normalizer understood the call. `opaque` is what POL-05 denies on |

REQUIREMENTS.md section 3.1 (`REQUIREMENTS.md:443`), cited directly by ADR-0021's own binding "Rules for agents" MUST line ("...before it reaches the kernel (REQUIREMENTS.md section 3.1, POL-04)"):

    Minimum fields: `source` as `parsed`, `structured` or `opaque` ...

Both sources agree: `source` is a three-value confidence/parse-state enum. `opaque` is one of exactly three legal values.

The shipped implementation (`src/policy/kernel/action-record.ts:17-20`) types `source` as an open `string` documented as "Canonical originating tool family (e.g. shell, fs, kubectl)", with `opaque` retained only as one special sentinel value among unboundedly many others. Confirmed with a direct grep of the whole diff: `grep -rn "parsed\|structured" src/policy` returns zero matches. Every fixture uses a tool-family value instead: `source: "fs"` (`src/policy/fixtures/action-records.ts:9`), `source: "shell"` (`:31`), `source: "shell"` (`action-record.test.ts:6`). None of the four fixtures, nor either `.test.ts`, ever construct a record with `source: "parsed"` or `source: "structured"` -- the two non-opaque values ADR-0021 actually names do not exist anywhere in this diff.

**Why this is a real collision, not a naming nicety:** ADR-0021's `source` field is meant to answer "how confidently did the normalizer understand this call" -- independent of which tool produced it. The implementation instead answers "which tool produced this call", with `opaque` as an out-of-band escape hatch. These are two different pieces of information conflated into one field, and the implementation has no field at all for the one ADR-0021 actually specifies (there is no way, under this shape, for a future normalizer to say "I identified this as a shell call, but only regex-parsed it, not structurally" -- parsed vs. structured confidence has no representation). This is exactly the shape (2) this story is scoped to build (`docs/decisions.md` 2026-09-01 S2 row), and it is the contract every later normalizer story (shape 3) will read `action-record.ts` and build against -- if this ships as-is, that future work inherits the wrong contract silently.

**Not disclosed as an intentional deviation:** the Phase 1 plan's section 4 "Blocking questions" lists three other implementer design calls explicitly (verdict effect vocabulary kept to allow/deny only; targets/verbs/identity kept as placeholder shapes; RuleSet carries a minimal schemaVersion literal) -- `source`'s redefinition from a 3-value enum to an open tool-family string is not among them. This is silent scope drift on the one field ADR-0021 is most explicit about, not a flagged, reasoned exception.

**Minimal fix:** retype `ActionRecord.source` as the literal union `"parsed" | "structured" | "opaque"` (matching ADR-0021's table and REQUIREMENTS.md section 3.1 exactly), update the four fixtures and both `.test.ts` files' sample records accordingly (`mutatingCleanAction`/`deferredMutatingCleanAction` would use `"structured"` or `"parsed"`, not `"fs"`/`"shell"`). If tool-family tracking is still wanted, add it as a **separate**, non-kernel-branching field (ADR-0021's own floor explicitly allows this -- see `adr/software-engineering/0021-thoth-native-architecture.md:15`). `pol05Rule`'s `action.source === "opaque"` check (`kernel.ts:65`) needs no change either way -- it already only tests for the one sentinel value. Alternatively, if tool-family-as-source is a deliberate, wanted redesign, that is a `/adr-amend` against ADR-0021's Decision table, not a silent code-level reinterpretation (PRINCIPLES.md rule 9: "a rule you cannot satisfy is never silently violated").

**Exposure:** 100% of `ActionRecord` instances in this diff (4/4 fixtures, all test records) use the wrong domain; 100% of the future normalizer-registry contract (ADR-0021 shape 3, deferred but not yet started) would inherit it if unfixed now, before any consumer exists to break compatibility with. Basis: **code-traced** (direct comparison of ADR-0021's own Decision-section table + REQUIREMENTS.md section 3.1 against the shipped type and every fixture/test usage in the diff, via grep confirming zero conforming values exist).

## Coverage gaps named

- **General code-quality/SOLID-style review:** this story's domain-reviewer slot was overridden to `app-security-reviewer` (sensitive-area rule), so no `architecture-reviewer`/`code-reviewer` pass runs. This report's own focus-area 6 (precedence-merge determinism, schema-validator error shape, kernel-purity-checker fixture adequacy) is the compensating coverage named by this task's mandate -- covered directly in this pass (see "General correctness" below), not a silent gap.
- **`docs/plans/S2-phase1-2026-09-01.md` itself:** a new file type (`docs/plans/*`) with no prior review precedent in this repo. Read in full against the actual diff (file layout, ACs, tier ratification) -- matches exactly, no drift either direction. Low-risk, intentionally low-ceremony (a persisted planning artifact, not shipped code) -- not a gap worth a finding.
- **Nothing else in this diff falls outside both lanes' coverage** -- the CI/package.json/CHANGELOG/decisions/backlog/STATE edits are all doc/config surface this report's focus areas 3/4/5 cover directly (below).

## General correctness (focus area 6)

- **Precedence-merge determinism (POL-08):** demonstrated -- `mergeLayers` is a pure, order-preserving, three-layer union-with-override; `precedence.test.ts` proves determinism directly ("merging the same three layers twice yields identical results", `precedence.test.ts:35-39`), the three-layer-conflict case resolves to `project`'s value (`:19-25`), and version-resolution/rule-ordering are both tested. **CLEAN.**
- **Schema-validator error shape (POL-06):** demonstrated -- `validateRule`/`validateRuleSet` (`src/policy/rule/schema.ts`) report every unknown key by name with the expected set, every missing/malformed field with `{message, field, expected}`, nested rule errors carry indexed paths (`rules[1].id`). `schema.test.ts` covers unknown-key, missing-field, wrong-type, and multi-rule-independence cases. **CLEAN.**
- **Kernel-purity checker fixture adequacy (POL-11 instrument trust):** the `clean`/`violating` fixture pair covers all three violation classes the checker implements (non-relative import, out-of-directory import, forbidden global) in one file each, plus a comment-stripping false-positive regression test and a dogfood test against the **real** `src/policy/kernel/` (`kernel-purity-check.test.ts:132-136`) -- not just synthetic fixtures. Representative and non-vacuous. **CLEAN.**

## CI wiring (focus area 3)

`qa:kernel-purity` step (`.github/workflows/ci.yml:98-99`) sits inside the main `ci` job (`if: github.event_name != 'schedule'`), runs on every push/pull_request, has no `continue-on-error`, and calls `node src/qa/kernel-purity-check.ts` directly -- `main()`'s `process.exit(exitCodeFor(result))` (`kernel-purity-check.ts:184-193`) exits non-zero on any violation, verified by reading `exitCodeFor` (`src/lib/instrument.ts:25-27`: `result.ok ? 0 : 1`) and by running the script directly (below). Not gated behind the weekly `schedule:` job (that job is QA-17-only, `if: github.event_name == 'schedule'`, structurally separate). **CLEAN** -- this project's recurring CI-wiring-mistake class (S1's Issue #60, S1b's own drift-check ruling) is not repeated here.

## Plan-vs-diff match (focus area 4)

`docs/plans/S2-phase1-2026-09-01.md` section 6's file layout matches the actual diff file-for-file (`src/policy/kernel/{action-record,rule-types,verdict,kernel}.ts` + tests where logic exists, `src/policy/rule/{schema,precedence}.ts` + tests, `src/policy/fixtures/{action-records,rules}.ts`, `src/qa/kernel-purity-check.ts` + test + fixture pair, `package.json`, `.github/workflows/ci.yml`, `CHANGELOG.md`). No file-I/O creep, no shape-3 normalizer-registry creep. No promised check is silently missing. **CLEAN** -- aside from finding 1's field-domain drift, which is a contract deviation within an otherwise-matching file, not an added/removed file.

## Docs edits (focus area 5)

`docs/decisions.md`, `docs/backlog.md`, `CHANGELOG.md` edits are accurate -- cross-checked against the actual diff and this session's real actions (including the Manager's own backlog reconciliation of the two now-closed "persist Phase 1 plans" items, confirmed against the real `docs/plans/S2-phase1-2026-09-01.md` file on disk). No overclaiming found. **CLEAN.**

**Editorial (non-blocking, verdict-neutral):** `docs/STATE.md:7` and `:37` still say "Awaiting Stage 3 review (architecture-reviewer or code-reviewer + cross-domain-reviewer...)" -- stale; the actual Manager-ratified reviewer set (`docs/plans/S2-phase1-2026-09-01.md:7,35`) is `app-security-reviewer` + `cross-domain-reviewer`. Did not cause harm this round (the correct reviewer was in fact dispatched, per this task's own framing), but a future session trusting `STATE.md`'s "Next" section literally would dispatch the wrong domain reviewer. Fix next time `STATE.md` is touched.

## Verification run (real, this session)

```
$ npm run typecheck        # clean, no output
$ npm run lint              # clean, no output
$ npm test
tests 175
pass 175
fail 0
skipped 0
$ npm run qa:kernel-purity
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
```

## Verdict

**REWORK** -- one code-traced HIGH finding (finding 1: `ActionRecord.source`'s value domain contradicts ADR-0021's own Decision-section table and REQUIREMENTS.md section 3.1, cited directly by the binding MUST rule). Per CLAUDE.md, an ADR collision is a blocker: fix, or `/adr-amend` -- never waived. Everything else in this diff -- kernel purity, POL-05/SUR-09 correctness, precedence-merge determinism, schema-validator shape, CI wiring, plan-vs-diff match, and the doc edits -- is clean, code-traced or demonstrated.

**Single next action:** `story-implementer` retypes `ActionRecord.source` to `"parsed" | "structured" | "opaque"` (or moves tool-family tracking to a separate non-kernel-branching field), updates the four fixtures + two `.test.ts` files' sample records to use conforming values, re-runs `npm run typecheck && npm test && npm run qa:kernel-purity`, and this review re-confirms.

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][code-traced] src/policy/kernel/action-record.ts:17-20 vs adr/software-engineering/0021-thoth-native-architecture.md:111 + REQUIREMENTS.md:443 -- ActionRecord.source implemented as open tool-family string, not the ADR/spec's parsed|structured|opaque enum; zero conforming fixture values exist. Fix: retype to the literal union, move tool-family to a separate non-kernel-branching field, or /adr-amend.
2. [CLEAN][code-traced] SE ADR-0002 layering -- kernel boundary is one-directional (rule/ depends inward on kernel types, never reverse); no accidental coupling.
3. [CLEAN][demonstrated] ADR-0021 kernel purity -- npm run qa:kernel-purity PASS, 4 files, 0 violations, non-vacuous.
4. [CLEAN][code-traced] ADR-0021 POL-05 fail-closed evaluated inside kernel, unconditional, tested directly.
5. [CLEAN][code-traced] ADR-0021 SUR-09 deferred-as-execution -- isMutating/pol05Rule never read deferred, proven by parity tests.
6. [CLEAN][code-traced] No AGT/third-party governance import anywhere in the diff; zero new dependencies.
7. [CLEAN][demonstrated] CI wiring -- qa:kernel-purity in main ci job only, not the weekly schedule job, real non-zero exit on failure.
8. [CLEAN][code-traced] Plan-vs-diff match -- docs/plans/S2-phase1-2026-09-01.md's file layout matches the diff exactly, no shape-3/file-I/O scope creep, no silently-missing check.
9. [CLEAN][code-traced] docs/decisions.md, docs/backlog.md, CHANGELOG.md edits accurate, no overclaiming, backlog reconciliation verified against the real docs/plans/S2-phase1-2026-09-01.md file.
10. [CLEAN][demonstrated] General correctness -- POL-08 precedence-merge determinism, POL-06 schema-validator error shape, kernel-purity-checker fixture adequacy (incl. dogfood test against the real kernel dir) all proven by real, passing tests.
counts (a CHECKSUM): issues=1 suspicions=0 clean=9
evidence (a CHECKSUM): demonstrated=4 code-traced=6 derived=0
checks=typecheck clean; lint clean; test 175/175 pass 0 fail 0 skipped; qa:kernel-purity PASS (4 files, 0 violations, non-vacuous)
adr=HIT(35, whole catalog)
report=docs/reviews/s2-canonical-action-record-kernel-cross-domain-2026-09-01.md

---

## Re-confirm pass (same review cycle, post fix-now)

**Date:** 2026-09-01
**Trigger:** `story-implementer` fix-now pass closing this report's Finding 1 (Issue #61) plus `app-security-reviewer`'s two MEDs (Issues #62, #63 interim half).

### 1. Issue #61 — `ActionRecord.source` retype

Confirmed fully closed. `src/policy/kernel/action-record.ts:26` now types `source: "parsed" | "structured" | "opaque"` — byte-for-byte the literal union ADR-0021's Decision table (`adr/software-engineering/0021-thoth-native-architecture.md:111`) and `REQUIREMENTS.md:443` specify. `isActionRecord`'s runtime guard (`action-record.ts:70`) checks all three literals by equality, not `typeof`.

Traced every remaining `source` reference in the diff (`grep -rn "source" src/policy`):
- `src/policy/fixtures/action-records.ts` — all four fixtures use conforming values (`"structured"`, `"opaque"`, `"parsed"`, `"opaque"`); zero tool-family strings (`"fs"`/`"shell"`) remain anywhere in the diff.
- `src/policy/kernel/action-record.test.ts:37-38` — new regression asserts `"shell"`/`"fs"` are explicitly rejected; `:41-45` asserts all three literals accepted.
- `src/policy/kernel/kernel.ts:96` — `pol05Rule`'s `action.source === "opaque"` check is an equality test against the now-literal type; no widening.
- `src/policy/rule/precedence.ts`'s unrelated `sourceLayer` field (a different concept — which policy layer a merged rule came from) was never in scope and is untouched.

No `as` cast anywhere in `src/policy/**` widens or bypasses `source`'s type — the only casts present are `input as Record<string, unknown>` (pre-existing unknown-narrowing idiom, unrelated to `source`) and `as const` array-literal narrowing in `action-record.ts`/`schema.ts` (the opposite of widening). Re-ran `npm run typecheck` myself: clean, no output, no errors.

**Verdict: genuinely closed.**

### 2. Scope-creep check

Compared file mtimes across the whole (still-uncommitted) working tree to separate the original S2 build pass from the fix-now pass. The fix-now cluster (all files touched after `docs/backlog.md`'s edit, ~14:12 onward) is exactly:
`src/policy/kernel/action-record.ts`, `src/policy/fixtures/action-records.ts`, `src/policy/kernel/action-record.test.ts`, `src/policy/kernel/kernel.ts`, `src/policy/kernel/kernel.test.ts`, `src/qa/kernel-purity-check.ts`, `src/qa/selftest-fixture/kernel-purity/violating/obfuscated-globals.ts`, `src/qa/kernel-purity-check.test.ts`, `CHANGELOG.md`, `docs/STATE.md`.

This is exactly the three approved fixes (action-record.ts+fixtures/tests; kernel.ts+test; kernel-purity-check.ts+fixture+test) plus the two approved doc updates. Nothing else was touched in this pass — no scope creep.

### 3. Prior clean findings re-checked

- **SE ADR-0002 layering:** `kernel.ts:20-22`'s only imports are `./action-record.ts`, `./rule-types.ts`, `./verdict.ts` — all type-only, all inside the kernel directory. Unchanged, still self-contained. **Still CLEAN.**
- **CI wiring:** `qa:kernel-purity` step's position/gating in `.github/workflows/ci.yml` untouched by the fix-now pass (not in the touched-file list above). **Still CLEAN.**
- **POL-08 precedence-merge determinism / POL-06 schema-validator correctness:** `precedence.ts`/`schema.ts` and their tests untouched by the fix-now pass; `npm test` still shows all their tests passing within the 181/181 total. **Still CLEAN.**
- **Plan-vs-diff match:** `docs/plans/S2-phase1-2026-09-01.md` deliberately left untouched (historical record, per this task's framing) and still matches the (now slightly larger, fix-now-augmented) diff's file layout — the fix-now pass only edited files the plan already named. **Still CLEAN.**

None of the three fixes disturbed any of these.

### 4. `docs/STATE.md` correction check

`docs/STATE.md:41` now reads "This is the Manager-ratified reviewer set for S2 ... — **not** `architecture-reviewer`/`code-reviewer` (a prior version of this line named the wrong pair; corrected here per the cross-domain-reviewer's own editorial note...)". This matches the actual Manager-ratified set (`app-security-reviewer` + `cross-domain-reviewer`, `docs/plans/S2-phase1-2026-09-01.md` section 3). **Correction confirmed landed and accurate.**

### 5. Verification run (real, this session)

```
$ npm run typecheck        # clean, no output
$ npm run lint              # clean, no output
$ npm test
tests 181
pass 181
fail 0
cancelled 0
skipped 0
todo 0
$ npm run qa:kernel-purity
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
```

181/181 matches the fix-now receipt's claimed count (175 prior + 6 new regression tests). `qa:kernel-purity`'s non-vacuous PASS is unchanged (the fixes touched doc comments/type/tests/QA-instrument patterns, not the shipped kernel's own import/global surface) — confirmed directly, not trusted from the receipt.

### Re-confirm verdict

**APPROVE.** Finding 1 (Issue #61) is genuinely, fully closed: `ActionRecord.source` is byte-for-byte the ADR-0021/REQUIREMENTS.md literal union, every fixture and test conforms, no cast papers over it, and `npm run typecheck` confirms clean. No scope crept beyond the three approved fixes. All four prior clean findings re-verified and still hold. `docs/STATE.md`'s editorial correction landed accurately. All real checks (typecheck, lint, 181/181 tests, kernel-purity) pass, directly re-run this session.

**Single next action:** Manager closes GitHub Issue #61 (`completed`) and proceeds to Stage 4 (verify)/Stage 5 (audit) for S2.

---

RECEIPT (re-confirm pass): verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius — status [ISSUE]=confirmed collision/gap / [SUSPICION]=unconfirmed, needs a second look / [CLEAN]=seam checked, sound; evidence tag [demonstrated|code-traced|derived]):
1. [CLEAN][code-traced] Issue #61 fully closed — src/policy/kernel/action-record.ts:26 now the literal union "parsed"|"structured"|"opaque", isActionRecord guards on it, all 4 fixtures + 2 test files conform, kernel.ts:96's opaque check unaffected, no widening cast anywhere in src/policy/**.
2. [CLEAN][code-traced] No scope creep — mtime-clustered fix-now touched exactly the 3 approved fixes (action-record.ts+fixtures/tests, kernel.ts+test, kernel-purity-check.ts+fixture+test) plus CHANGELOG.md/STATE.md, nothing else.
3. [CLEAN][code-traced] SE ADR-0002 layering still holds — kernel.ts's imports remain self-contained, type-only, inside src/policy/kernel/.
4. [CLEAN][demonstrated] CI wiring, POL-08 precedence-merge, POL-06 schema-validator, plan-vs-diff match all unchanged by the fix-now pass and still verified clean (untouched files, all tests passing in the 181/181 total).
5. [CLEAN][code-traced] docs/STATE.md:41's reviewer-pair correction landed accurately (app-security-reviewer + cross-domain-reviewer, matching the Manager-ratified set).
counts (a CHECKSUM): issues=0 suspicions=0 clean=5
evidence (a CHECKSUM): demonstrated=1 code-traced=4 derived=0
checks=typecheck clean; lint clean; test 181/181 pass 0 fail 0 skipped; qa:kernel-purity PASS (4 files, 0 violations, non-vacuous)
adr=HIT(35, whole catalog)
report=docs/reviews/s2-canonical-action-record-kernel-cross-domain-2026-09-01.md

---

## Final re-confirm pass (same review cycle, post second, narrower fix-now for Issue #62)

**Date:** 2026-09-01
**Trigger:** app-security-reviewer's own re-confirm found Issue #62 was NOT genuinely fixed by the first fix-now pass (comment-only, misleading test). story-implementer applied a second, narrower fix-now pass: isMutating() now also returns true whenever action.unresolved.length > 0, additive-OR to the existing MUTATING_VERBS check. kernel-purity-check.ts also gained a global bare-identifier pattern (Issue #63 addendum).

### 1. ADR-0021 compliance of the new isMutating logic

ADR-0021's binding "Rules for agents" line (adr/software-engineering/0021-thoth-native-architecture.md:205): "MUST deny a mutating action whose Action record has source: opaque or a non-empty unresolved field, evaluated inside the kernel itself (POL-05)" -- scoped to a mutating action, matching pol05Rule's isMutating() gate. The narrative section (:101) repeats the same qualifier. Line 105's compact formula (source === 'opaque' || unresolved.length > 0 -> deny) omits the qualifier, but the binding MUST line is what governs.

The shipped change (kernel.ts:73: action.verbs.some((v) => MUTATING_VERBS.has(v)) || action.unresolved.length > 0) does not touch the source: opaque half of POL-05 at all -- it only widens what counts as "mutating" to also include any record the normalizer already flagged as ambiguous via unresolved. This is data the kernel already receives (shape 2, in scope); it needs no verb taxonomy, no action catalog, and no normalizer-registry knowledge (shape 3, deferred) to evaluate. It is a legitimate, minimal, in-scope tightening of the existing fail-closed check, not a new capability that reaches into shape 3's territory.

Ran the exact case split myself, directly against the live kernel (not taken on either report's word):

Case A -- opaque source, sole verb outside MUTATING_VERBS, unresolved EMPTY (the deliberately-deferred case):
  { source: "opaque", verbs: ["patch"], unresolved: [] }
  isMutating: false   pol05Rule: null   decide(): allow

Case B -- verbs empty, unresolved non-empty (the case this fix closes):
  { source: "structured", verbs: [], unresolved: ["verb"] }
  isMutating: true    pol05Rule: DENY (POL-05, unresolved)   decide(): deny

Case A staying allow is not a new gap I'm raising -- app-security-reviewer's final re-confirm (docs/reviews/s2-canonical-action-record-kernel-app-security-2026-09-01.md:266-297) already reproduced this exact case, ruled it consistent with ADR-0021's "mutating action" qualifier (not a MUST-line violation), and closed Issue #62 on that basis after confirming Case B (the actually-demonstrated PoC) now denies. Re-litigating a gap a lane reviewer already examined and ruled on is noise, not a new finding (PRINCIPLES.md rule 9) -- I re-ran it myself only to confirm the ADR-compliance boundary I was asked to check, not because I doubt their ruling.

Confirming the implementer's disclosed boundary matches the code exactly: the "REMAINING, DELIBERATELY-DEFERRED GAP" comment (kernel.ts:62-70) states only a verb outside MUTATING_VERBS combined with an empty unresolved stays uncaught -- "only a verb the normalizer FLAGGED as ambiguous (via unresolved) is never silently exempted... no matter what the verb string itself is." Verified with a direct test (kernel.test.ts:112-124, and reproduced myself): { verbs: ["patch"], unresolved: [] } -> isMutating returns false. The claimed boundary is what the code actually does -- no overclaim, no gap between the comment's promise and the runtime behavior.

Verdict: CLEAN, code-traced + demonstrated. The isMutating widening fits ADR-0021's fail-closed framing (it only makes the check fire in MORE cases, never fewer, and only using data already in scope), does not reach into shape 3, and its disclosed boundary is accurate.

### 2. Scope-creep check

Compared mtimes across the whole (still-uncommitted) working tree to isolate this second fix-now pass from the S2 build and the first fix-now pass:

22:20:13  src/policy/kernel/kernel.ts
22:20:35  src/policy/kernel/kernel.test.ts
22:20:53  src/qa/kernel-purity-check.ts
22:21:09  src/qa/selftest-fixture/kernel-purity/violating/obfuscated-globals.ts
22:21:38  src/qa/kernel-purity-check.test.ts
22:22:53  CHANGELOG.md
22:23:47  docs/STATE.md

Every other file in the working tree (docs/backlog.md, docs/decisions.md, .github/workflows/ci.yml, package.json, docs/run-log.jsonl, docs/REVIEW_LOG.md, src/policy/kernel/action-record.ts and siblings) carries an earlier mtime, outside this pass. This is exactly the file list this task named -- nothing else touched. git diff --stat HEAD on the tracked files (ci.yml, package.json, docs/backlog.md, docs/decisions.md, docs/run-log.jsonl, docs/REVIEW_LOG.md) shows only edits attributable to the earlier S1b/S2-build/first-fix-now passes, not this one. No scope creep.

### 3. CHANGELOG.md / docs/STATE.md accuracy

Both read in full. CHANGELOG.md:20 still carries the first pass's overclaiming entry, now struck through (~~...~~) with a corrective note immediately following it in the same bullet ("This entry overclaimed: it was a code-comment-only change, not a behavior fix... The real fix is below"), then a new, separate "Fixed -- second, targeted fix-now pass" section (CHANGELOG.md:24-25) describing the actual behavior change accurately, with before/after PoC values. No stale text stands unqualified, and there is no confusing double-entry -- a reader hits the strikethrough, the one-line correction, and a pointer to where the real fix is documented, in that order.

docs/STATE.md:13-18 mirrors the same discipline: the Issue #62 bullet is struck through with the same correction, followed by a "Stage 3 review (re-confirm pass)" subsection and then this second pass's own bullets (:15-17) stating the real fix with before/after values, and a verification block (:18) with the real 187/187 count. Matches what I ran myself (below). Accurate, no residual overclaim.

### 4. docs/backlog.md's "S2 re-confirm" entry

docs/backlog.md:6 (untouched by this pass -- earlier mtime, confirmed above) reads: "S2 fixes the narrower, demonstrated gap (unresolved-non-empty now always forces the mutating check regardless of verb). This wider question -- should an unrecognized verb itself count as ambiguous even without an explicit unresolved flag -- needs a real action catalog/verb taxonomy to answer properly, which is ADR-0021 shape 3's job."

Checked word-for-word against the actual, current kernel.ts behavior: yes, exactly. isMutating now forces the check on unresolved non-empty regardless of verb (confirmed above); the still-open case is precisely "unrecognized verb, not flagged via unresolved" (Case A above), and that is precisely what shape 3 (normalizer registry / real verb taxonomy) would need to resolve, not this story. The entry was written accurately in advance of (or concurrent with) the actual fix and did not need updating after the fix landed -- it already described the boundary the shipped code produces, not an aspirational or stale one. Still accurate.

### 5. Verification run (real, this session)

$ npm run typecheck        # clean, no output
$ npm run lint              # clean, no output
$ npm test
tests 187
pass 187
fail 0
cancelled 0
skipped 0
todo 0
$ npm run qa:kernel-purity
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.

187/187 matches both the implementer's claim and app-security-reviewer's independently-run count. qa:kernel-purity's non-vacuous PASS confirms the global pattern addition (Issue #63 addendum) did not break the checker's own self-scan of the real kernel directory.

### Cross-check against app-security-reviewer's parallel final re-confirm

Read docs/reviews/s2-canonical-action-record-kernel-app-security-2026-09-01.md:246-336 in full. Their independently-reproduced regression table (4 boundary cases: recognized-mutating-verb x opaque/non-opaque, non-mutating-verb x opaque/non-opaque, all unresolved: []) covers exactly the ADR-scoping boundary I checked in section 1 above, reaching the identical conclusion (Case A/"read+opaque" stays allow by design, not a regression). Their verdict: APPROVE, Issue #62 and the Issue #63 global-addendum both closed with independent PoC reproduction; Issue #63's parent (durable AST-based check) correctly stays open as pre-scoped, non-blocking hardening. GitHub confirms: #61 CLOSED/COMPLETED, #62 CLOSED/COMPLETED, #63 OPEN (as intended). No divergence between the two lanes' findings on this pass.

### Final re-confirm verdict

APPROVE. The second fix-now pass is a genuine, minimal, in-scope behavior fix: isMutating()'s additive OR on action.unresolved.length > 0 closes the demonstrated PoC (Case B) without overstepping into ADR-0021 shape 3's territory, and its disclosed remaining boundary (Case A -- an opaque or unrecognized verb with unresolved empty) is exactly what the code does, exactly what ADR-0021's own "mutating action" qualifier permits, and exactly what app-security-reviewer independently ruled non-blocking. Scope held to the seven files this task named -- no creep. CHANGELOG.md/docs/STATE.md corrections are honest (strikethrough + pointer, not silent rewrite or a confusing double-entry). docs/backlog.md's "S2 re-confirm" entry matches current kernel.ts behavior exactly, unchanged and accurate. All real checks (typecheck, lint, 187/187 tests, kernel-purity) pass, re-run directly this session, matching both this report's and app-security-reviewer's independent counts.

Single next action: Manager proceeds to Stage 4 (verify) / Stage 5 (audit) for S2 -- nothing outstanding from either reviewer lane blocks ship. Issue #63 (durable AST-based purity check) stays open on the backlog as intentional, non-blocking hardening.

---

RECEIPT (final re-confirm pass): verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius -- status [ISSUE]=confirmed collision/gap / [SUSPICION]=unconfirmed, needs a second look / [CLEAN]=seam checked, sound; evidence tag [demonstrated|code-traced|derived]):
1. [CLEAN][demonstrated] ADR-0021 compliance of isMutating()'s unresolved-OR widening (kernel.ts:73) -- Case B (the demonstrated PoC) now denies end-to-end, Case A (opaque/unrecognized verb, unresolved empty) stays allow by design, matching ADR-0021's "mutating action" MUST-line qualifier (0021-thoth-native-architecture.md:205); reproduced directly against the live kernel, not taken on report word.
2. [CLEAN][code-traced] isMutating's disclosed "REMAINING, DELIBERATELY-DEFERRED GAP" comment (kernel.ts:62-70) matches actual runtime behavior exactly -- no overclaim between the comment's promise and what the code does.
3. [CLEAN][code-traced] No scope creep -- mtime-clustered second fix-now touched exactly the 7 named files (kernel.ts/.test.ts, kernel-purity-check.ts/.test.ts, obfuscated-globals.ts fixture, CHANGELOG.md, docs/STATE.md); everything else in the working tree predates this pass.
4. [CLEAN][code-traced] CHANGELOG.md/docs/STATE.md corrections are honest -- strikethrough + one-line correction + pointer to the real fix, no stale unqualified overclaim, no confusing double-entry.
5. [CLEAN][code-traced] docs/backlog.md's "S2 re-confirm" entry matches current kernel.ts behavior word-for-word; untouched by this pass, did not need updating.
6. [CLEAN][code-traced] SE ADR-0002 layering still holds (kernel.ts's imports remain self-contained, type-only, inside src/policy/kernel/) -- re-checked, unaffected by this pass.
7. [CLEAN][demonstrated] Real checks all green, re-run this session: typecheck clean, lint clean, 187/187 tests, qa:kernel-purity PASS (4 files, 0 violations, non-vacuous) -- matches both the implementer's and app-security-reviewer's independently-run counts.
8. [CLEAN][code-traced] No divergence with app-security-reviewer's parallel final re-confirm (APPROVE, Issue #62 + #63-addendum closed, #63 parent correctly left open) -- both lanes reach the same conclusion on the same boundary cases independently.
counts (a CHECKSUM): issues=0 suspicions=0 clean=8
evidence (a CHECKSUM): demonstrated=3 code-traced=5 derived=0
checks=typecheck clean; lint clean; test 187/187 pass 0 fail 0 skipped; qa:kernel-purity PASS (4 files, 0 violations, non-vacuous)
adr=HIT(35, whole catalog)
report=docs/reviews/s2-canonical-action-record-kernel-cross-domain-2026-09-01.md
