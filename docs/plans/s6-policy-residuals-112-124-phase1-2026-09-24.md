# Phase 1 plan: s6-policy-residuals-112-124

[story-implementer]
Story Implementer (Ptah) — Phase 1: planning

Branch `feat/s6-policy-centralization` @ `ae6b4f1` (clean). Class: STORY (bundle of two residual issues) plus one docs-only ratified residual (#107).

## 0. Readiness and liveness (read from code at HEAD, plus commands run)

| Item | Live at HEAD? | Evidence |
|---|---|---|
| #112 `defaultOutcome` not expressible in any tier | LIVE | `src/policy/kernel/rule-types.ts` `RuleSet` is `{version, rules}`; `src/policy/rule/schema.ts` line 13 `RULE_SET_KEYS = ["version","rules"]`; `src/policy/config/loader.ts` `LoadSuccess` has no outcome field; only supplier is `src/policy/config/bootstrap-ruleset.ts` `BOOTSTRAP_DEFAULT_OUTCOME = "allow"` |
| #124 rejection message content unbounded | LIVE | `grep -n "buildExpectedRejectionStdout("` in `src/policy/config/printer.test.ts`: helper at line 378, six call sites at lines 453, 461, 471, 485, 496, 520, all pass `/./` |
| P2 mutant site | LIVE | `src/policy/config/loader.ts:211` `message: projectParsed.message` (also :193 shipped, :162 central, :146 central read-error) |
| #108, #110 | CLOSED (confirmed `gh issue view`) | no work |
| #107 | OPEN, ratified residual | no code; decisions row only (section 8) |
| Baseline | GREEN | `node --test` on pin/loader/printer/schema/precedence/mandatory-lock-conformance test files: 111 tests, 111 pass, 0 fail, 0 skipped (Node 24.15.0) |

Hidden blockers found: none that stop the build. Two traps recorded so they do not bite in Phase 2:
1. `src/policy/rule/schema.test.ts:91` asserts `unknown.expected` matches `/version, rules/`. Add `"defaultOutcome"` at the END of `RULE_SET_KEYS` (`version, rules, defaultOutcome`) or that existing test breaks.
2. Master CI was dead when red-team wrote finding 2 (round 6); it is green now (STATE.md, ruleset `protect-master`). `printer.test.ts` therefore now runs on CI's Node 22.18.0 for the first time in anger. See risk R7.

No missing material fact. Nothing to send back to intake-refiner.

## 1. ADR review (hard gate; catalog from `node docs/adr-cache.mjs --ensure`)

Output: `ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] ... [CACHE=HIT]`.

| ADR | Verdict | Rule quoted / reason |
|---|---|---|
| SE ADR-0005 (testing) | APPLICABLE | "MUST write unit tests for every new/changed domain or application behavior"; "MUST NOT delete or weaken a failing test to make CI pass". #124 strengthens a test (never weakens); #112 ships tests with the feature |
| SE ADR-0010 (quality) | APPLICABLE | "MUST NOT lower coverage thresholds, delete tests"; "MUST leave touched code at least as clean as found". The #124 amendment removes no test; it removes a wildcard that weakened one |
| SE ADR-0021 (thoth-native) | APPLICABLE | "The policy kernel MUST be pure: no filesystem, network, or process access" (POL-11). `rule-types.ts` sits inside the kernel boundary; the type-only edit must keep `npm run qa:kernel-purity` PASS. Also: "The kernel MUST deny a mutating action whose Action record has source: opaque or a non-empty unresolved array (POL-05)" — unchanged, resolved posture only governs the residual no-rule-matched case |
| SE ADR-0002 (layering) | APPLICABLE (design constraint) | `src/policy/rule/*` must not import from `src/policy/config/*` (`schema.ts` header). So the bootstrap-`allow` fallback is applied in `loader.ts`, never inside `precedence.ts` |
| SE ADR-0003 (SOLID/YAGNI) | APPLICABLE | "SHOULD NOT over-abstract: no speculative interfaces". Supports the minimal-shape ruling (no explicit lock flag, no PrinterResult passthrough) |
| THOTH-ADR-0001, THOTH-ADR-0002 | NOT-APPLICABLE | scope is the central-classification fixture and the secret-scan allowlist; this story touches neither |
| SE ADR-0001, 0004, 0006–0009, 0011–0020 | NOT-APPLICABLE | process/cloud/data/observability/port-lineage ADRs; none constrains a policy schema or a test helper. ADR-0016–0020 are scoped out by the 2026-08-29 decisions row |
| devops ADR-0001–0010 (IaC/CDK) | NOT-APPLICABLE | no infrastructure in this story. (ADR-0008 CI gate rule is about merge behavior; the Manager already owns that) |
| UNCLEAR | none | |

Requirement anchor: POL-01 (REQUIREMENTS.md line 425): "No rule an operator is expected to tune shall live in a code literal." POL-07 (mandatory locking, central-only intent). POL-09 (pin: raw bytes of all three layers, so `defaultOutcome` is covered automatically). POL-10 (printer; stdout answer key stays untouched).

## 2. Restatement

Let a policy layer declare an optional `defaultOutcome`, resolved through the existing trust-rank so a central-declared posture cannot be relaxed by lower-trust layers, exposed as a result field on the loader (not printer stdout); and close the unbounded-rejection-message gap in `printer.test.ts` without changing production code.

## 3. Acceptance criteria as named test cases

`[D]` = derived (not stated verbatim in an issue). None of the derived ones changes the build materially except D1/D2 (section 4, confirm-before-dispatch).

### #124 — file: `src/policy/config/printer.test.ts` only (test-writer). Zero production diff.

| ID | Named check | Type |
|---|---|---|
| A1 | `ISSUE-123(b) central json-parse-error: stdout does not contain the trimmed CENTRAL_MALFORMED_JSON_RAW bytes` | test, raw-bytes form |
| A2 | `ISSUE-123(b) central schema-invalid: stdout does not contain the trimmed CENTRAL_SCHEMA_INVALID_RAW bytes` | test, raw-bytes form |
| A3 | `ISSUE-123(b) central read-error: rejection tail equals exactly "REJECTED: central policy load failed (read-error): <thrown message>"` (no policy file exists at this site, so the whole tail is bounded by equality instead of a bytes check) [D] | test, exact-tail form |
| A4 | `ISSUE-123(b) project BOM (minified): !actual.includes(readFileSync(PROJECT_BOM_MALFORMED_PATH).trim())` | test, raw-bytes form |
| A5 | `ISSUE-123(b) shipped-defaults malformed: !actual.includes(trimmed SHIPPED_DEFAULTS_MALFORMED_PATH bytes)` | test, raw-bytes form |
| A6 | `ISSUE-123(b) project BOM (pretty): !actual.includes(trimmed PROJECT_BOM_PRETTY_MALFORMED_PATH bytes)` | test, raw-bytes form |
| A7 | Every call of `buildExpectedRejectionStdout` must supply the bound: the wildcard `messagePattern: RegExp` parameter is replaced by a REQUIRED parameter, so a 7th call site that omits it fails `npm run typecheck` (tests are in `tsconfig` `include`). This is the completeness instrument for "all six sites"; the count of six above is from `grep`, not hand-typed [D] | typecheck |
| A8 | Mutant P2 (append raw file dump to the message at `src/policy/config/loader.ts:211`) turns A4 and A6 red; same shape at :193 turns A5 red; at :162 turns A1 and A2 red; append at :146 turns A3 red. Each mutant applied, run, reverted, raw output saved | mutation drill, in test-writer's report |
| A9 | Mutant P1 (`printer.ts` re-hardcodes `"central"`) still fails `ISSUE-108(a)`, `(b)`, `(c)` (3 of 3, as round 6 measured) | mutation drill |
| A10 | HEAD unchanged in count and green: `printer.test.ts` stays 12 `test(` cases, all pass; the six files stay 111/111 (amendment adds assertions, not tests) | command |
| A11 | Zero production diff: `git diff --stat -- src/policy/config/printer.ts src/policy/config/loader.ts` empty for #124's commit | command |

Measured, not assumed (rule 18): on Node 24.15.0 the `JSON.parse` message for each of the three file fixtures and the central malformed string does NOT contain the trimmed source, so the raw-bytes form has no false-positive at HEAD. Sources are 62 to 595 chars; V8 truncates the snippet to a short context for long input. Not measured on Node 22.18.0 (CI's version); the CI run of the PR is that measurement. `String.prototype.trim` strips the U+FEFF BOM, which is intended: the leak mutant still contains the trimmed remainder.

### #112 — production files plus new proof tests

| ID | Named check | File |
|---|---|---|
| B1 | `validateRuleSet: defaultOutcome "allow" and "deny" are accepted (0 errors)` | `src/policy/rule/schema.test.ts` |
| B2 | `validateRuleSet: a non-enum defaultOutcome ("ask", "DENY", true, null, 1) is rejected, error names field "defaultOutcome", expected '"allow" | "deny"'` | schema.test.ts |
| B3 | `validateRuleSet: absent defaultOutcome still validates` (back-compat; the pre-existing well-formed test stays green unmodified) | schema.test.ts |
| B4 | `validateRuleSet: a duplicate top-level "defaultOutcome" key (deny then allow) is rejected when rawText is supplied` — the relax-by-duplicate path; expected to pass via the existing generic duplicate-key scan, kept as a named regression | schema.test.ts |
| B5 | `validateRule: "defaultOutcome" inside a single rule is still an unknown-key error` (it is a RuleSet key only) [D] | schema.test.ts |
| B6 | Precedence matrix, enumerated mechanically from `TRUST_RANK` over every ordered layer pair and every (declared, declared) outcome pair; expectation rule: higher-trust declarant + lower-trust later layer = tighten-only; otherwise later layer wins | `src/policy/rule/mandatory-lock-conformance.test.ts` (new Part E) |
| B7 | Ground truth, hand-written, independent of `TRUST_RANK` values: central deny + project allow = deny/central; central allow + project deny = deny/project (tighten allowed); shipped deny + central allow = allow/central; shipped deny + project allow = allow/project (peers, disclosed); nothing declared = undefined | conformance Part F |
| B8 | A layer voided by a mandatory-id collision contributes no `defaultOutcome` (its declaration is ignored with the rest of its content) | conformance Part F |
| B9 | **`a RuleSet may declare defaultOutcome, a later layer may override it, and a central layer may mark it mandatory so no project layer can relax it`** — red-team's named test, name kept verbatim; body proves: (i) each tier may declare, (ii) a later same-or-higher-trust layer overrides, (iii) central's declaration cannot be relaxed by project. Under ruling D1 "mark it mandatory" is satisfied by central's declaration being locked by trust rank, so the body asserts that and there is no separate flag | `src/policy/config/loader.test.ts` |
| B10 | `no layer declares defaultOutcome -> LoadSuccess.defaultOutcome is { outcome: "allow", source: "bootstrap" }` (bootstrap fallback preserved) | loader.test.ts |
| B11 | `central absent + project declares deny -> deny/project` (tighten works without central) | loader.test.ts |
| B12 | `central present deny + project allow -> deny/central, load ok:true, project's rules still merge` (only the posture is ignored, the layer is not voided) | loader.test.ts |
| B13 | `invalid defaultOutcome in central -> whole load rejected, reasonKind schema-invalid, failedLayer central` (fail-closed, no silent default) | loader.test.ts |
| B14 | `two policies differing ONLY in project defaultOutcome produce different pin digests` (POL-09 coverage, free via raw bytes, kept as a regression) | loader.test.ts |
| B15 | Every successful load, across the existing central states table, carries a `defaultOutcome` field of `{outcome, source}` shape [D] | loader.test.ts |
| B16 | Hook stays unwired and unchanged: `hooks/pretooluse-kernel-gate.test.ts` AC-2 (allow) green and unmodified; `git diff --stat` shows `hooks/pretooluse-kernel-gate.mjs` and `src/policy/config/bootstrap-ruleset.ts` untouched | command |
| B17 | `printer.test.ts`'s exact-equality answer key untouched by #112: `git diff` for `printer.test.ts` in #112's commits is empty (the only printer.test.ts amendment is #124's) | command |
| B18 | Full gates: `npm run typecheck`, `npm run lint`, `npm run qa:kernel-purity`, `npm test` with real counts; skipped is not passed | command |

Findings-as-failing-tests: B1–B15 are written first by test-writer and confirmed RED at HEAD before any production line changes (B3, B4, B5, B10 may be green-at-HEAD by construction; test-writer must say which, and for B10 the red form is "the field does not exist").

## 4. Confirm before dispatching test-writer for #112 (non-blocking; defaults stated, tests encode them)

These are the only places I diverge from, or narrow, the literal wording. Defaults proceed unless the Manager says otherwise, but the test names and semantics in B6 to B15 depend on them, so change them BEFORE test-writer runs.

| # | Decision | Default in this plan | Why |
|---|---|---|---|
| D1 | Lock mechanism. Red-team's test name says a central layer "may mark it mandatory". The ruling says a central-declared posture cannot be relaxed by lower-trust layers | **Implicit lock by trust rank. No new `defaultOutcomeMandatory` key.** Central's declaration binds every lower-rank layer; central is the only rank-1 layer, so this is exactly POL-07's central-only intent. Red-team's alternative branch ("or a ratified decision row") is not needed, but the name deviation is recorded in a ratification row | Simplest thing that meets the ruling; an admin cannot forget a flag. Cost: central cannot declare a posture that is relaxable. That is not a case anyone asked for |
| D2 | Untrusted-layer semantics | A lower-trust layer may only **tighten** (allow to deny). A relaxing declaration (deny to allow) is ignored; the layer is NOT voided. Same-or-higher trust later layer overrides (last wins). Peers (shipped-defaults, project, both rank 0) override each other, exactly as their rules do today | Direct reuse of `TRUST_RANK`; matches the ruling |
| D3 | Where the resolved value is exposed | `LoadSuccess.defaultOutcome: { outcome: "allow" | "deny"; source: "shipped-defaults" | "central" | "project" | "bootstrap" }` **only**. No `PrinterResult` field, no `print-cli.ts` line | Nothing consumes it until the hook-rewiring story; passthrough would be an untested field. See section 6 for the dropped sub-features |

## 5. Risk tier: PROPOSED CRITICAL — agree with the Manager's expectation

One line: the diff changes how policy is authored and how trust ranks resolve (CLAUDE.md named sensitive area "Policy delivery / config surface"; `precedence.ts` is the trust-rank mechanism itself), and it edits a locked answer-key test of a sensitive-area printer, so full ceremony applies even though the production diff is about 50 lines.

Challenge I considered and reject: #124 alone is TRIVIAL/STANDARD (test-only). The story tier is the max of its parts, and the CLAUDE.md hard rule "no changes to the sensitive areas without a fresh dated review report" is triggered by #112 regardless. I do not propose to split the story to lower #124's tier: that adds a second PR for a zero-production-diff change.

Review chain the tier requires (dispatch each in an isolated worktree, per the STATE.md process lesson): `red-team` (attack tighten-only, relax-by-duplicate, voided-layer bypass, central-absent) + ONE domain reviewer `app-security-reviewer` (authz/trust semantics) + `cross-domain-reviewer` (standing, does not count against the cap). `code-reviewer` is not needed. Fresh dated reports in `docs/reviews/`.

## 6. Scope discipline: dropped sub-features (user values simplicity over polish)

Dropped, each with a `docs/backlog.md` line to be written in Phase 2 (not the diff):
- Printing the resolved posture in `printer.ts` stdout: forbidden (answer key).
- `PrinterResult.defaultOutcome` passthrough and a `print-cli.ts` line: nothing reads it until hook rewiring; would ship untested (printer.test.ts is locked and only #124 may amend it). One-line follow-up for the rewiring story.
- A per-rejection disclosure list of ignored relaxing declarations (analogue of `inertMandatoryDeclarations`): the ignored relax is fail-closed and reflected in `source`; a disclosure array adds a type, a loader field and a printer line. Backlog only.
- An explicit `defaultOutcomeMandatory` flag: see D1.
- Any change to `hooks/pretooluse-kernel-gate.mjs`, `bootstrap-ruleset.ts`, `kernel.ts`.
- Any new `ask` outcome: `VerdictOutcome` is `"allow" | "deny"`; validation is exactly that.

## 7. Constraints (CLAUDE.md hard rules and ADRs that bind this build)

- Sensitive areas touched: policy delivery/config surface (`schema.ts`, `precedence.ts`, `loader.ts`, `rule-types.ts`). Named reviewers: `red-team`, `app-security-reviewer`, `cross-domain-reviewer`. A fresh dated review report is required before merge.
- No IAM, no secrets, no terraform: none apply. Merge stays human-only.
- Domain logic gets unit tests with the feature (SE ADR-0005): B1–B15.
- No hand-derived completeness claims: B6 is enumerated from `TRUST_RANK`; A7's "all six call sites" is enforced by a required parameter plus `tsc`, and the six was counted by `grep`.
- Never edit a test-writer-produced test: after test-writer lands B-tests in `schema.test.ts`, `loader.test.ts`, `mandatory-lock-conformance.test.ts` and the A-amendment in `printer.test.ts`, the implementer does not touch those hunks. A wrong-looking test is flagged back, not edited.
- QA gates over new prose (`docs/decisions.md`, `docs/backlog.md`, `docs/STATE.md`, `CHANGELOG.md`): avoid backtick-quoted slash-containing shorthands and cross-repo issue reference shapes (QA-14 tripped on both in PR #281's window), and avoid bare numeric "all N" completeness claims without a marker (QA-15). Run `npm run qa:gate` equivalents locally before the PR.
- `exactOptionalPropertyTypes` is on: never pass `defaultOutcome: undefined`; build layer objects with a conditional spread.

## 8. Plan

### Test-first dispatch check (stage 1 step 7)

Does the plan identify a new or changed UI flow or API surface? **Strict reading: no UI flow, no HTTP API.** But two independent reasons make `test-writer` required, and I flag both explicitly:

1. **#124: YES, dispatch.** The files to change are test-writer's locked answer key (`printer.test.ts`). The implementer may not edit it (CLAUDE.md DoD, story-implementer rule). Only `test-writer` (or the Manager's ruling) may amend it. Zero production diff means there is no red phase in the usual sense: the amended tests are GREEN at HEAD and must go RED under mutants P2 (four return sites) while P1 stays red. Accept `GREEN-AT-HEAD + MUTANT-RED (A8, A9)` as the equivalent of `RED-CONFIRMED` for this item; Phase 2 does not start for #124 because there is no Phase 2 for #124.
2. **#112: YES, dispatch.** It adds a new author-facing configuration key to the policy format, which is the externally observable surface central admins write against (POL-01/POL-06), plus a new loader result contract. Not a pure internal refactor and not infra-only. Also findings must arrive as failing tests (charter rule 19), and independence from the implementer is the point. test-writer appends B1–B15 to the three named test files and confirms RED at HEAD before Phase 2 starts.

Phase 2 (build) does not start until both receipts exist (`RED-CONFIRMED` for #112; mutant-red evidence for #124).

### Sequencing (only ONE printer.test.ts amendment in flight)

1. test-writer dispatch A: #124, `printer.test.ts` only. Commit alone.
2. test-writer dispatch B: #112 proof tests, in `schema.test.ts`, `mandatory-lock-conformance.test.ts`, `loader.test.ts`. Touches no printer file, so it may run in parallel with dispatch A without violating the one-amendment rule; run it after A if the Manager prefers strict serial.
3. Phase 2 build of #112 (after dispatch B is RED-CONFIRMED and D1 to D3 are confirmed).
4. Docs commit: decisions rows, backlog lines, CHANGELOG, STATE.
5. Review chain (section 5), fix-now rounds as needed.

### File list

| File | Change | Owner |
|---|---|---|
| `src/policy/config/printer.test.ts` | #124 amendment: replace `/./` wildcard by a required bound parameter; six call sites; header/INTERPRETATION CHOICE note dated | test-writer |
| `src/policy/rule/schema.test.ts` | B1–B5 appended | test-writer |
| `src/policy/rule/mandatory-lock-conformance.test.ts` | B6–B8 appended as Parts E, F | test-writer |
| `src/policy/config/loader.test.ts` | B9–B15 appended | test-writer |
| `src/policy/kernel/rule-types.ts` | `RuleSet` gains `defaultOutcome?: VerdictOutcome` (type-only import from `src/policy/kernel/verdict.ts`); doc comment naming POL-01 | implementer |
| `src/policy/rule/schema.ts` | `RULE_SET_KEYS` gains `"defaultOutcome"` LAST; enum validation in `validateRuleSet`; file header note | implementer |
| `src/policy/rule/precedence.ts` | `NamedRuleLayer.defaultOutcome?`; small `resolveDefaultOutcome` over ACCEPTED layers using `TRUST_RANK`; `MandatoryLockResult.defaultOutcome?: { outcome; source: LayerName }` (undefined when none declared); `mergeLayers` untouched | implementer |
| `src/policy/config/loader.ts` | thread each layer's `defaultOutcome` into `namedLayers` (conditional spread); map undefined to `{ outcome: BOOTSTRAP_DEFAULT_OUTCOME, source: "bootstrap" }`; `LoadSuccess.defaultOutcome`; header comment | implementer |
| `docs/decisions.md` | two new rows (section 9 draft for #107; ratification row for D1 to D3 and #112/#124 disposition) | implementer drafts, Manager ratifies |
| `docs/backlog.md` | line 64 (the `defaultOutcome` entry) gets an appended RESOLVED note; new lines for the section 6 drops | implementer |
| `CHANGELOG.md`, `docs/STATE.md` | entries | implementer |
| NOT touched | `hooks/pretooluse-kernel-gate.mjs`, `bootstrap-ruleset.ts`, `kernel.ts`, `printer.ts`, `print-cli.ts`, `central-source.ts`, `pin.ts`, `.github/**` | |

Estimated production diff: about 50 lines across four files.

### Minimal design (one paragraph, no more)

`resolveDefaultOutcome(acceptedLayers)` walks layers in precedence order holding `(outcome, layer)`. First declaration is adopted. A later declaration replaces the holder if `TRUST_RANK[later] >= TRUST_RANK[holder.layer]` (override), or if it is lower-trust AND says "deny" while the holder says "allow" (tighten). Otherwise it is ignored. Voided layers never reach it (it runs over `acceptedLayers`). Nothing in it names a layer, only `TRUST_RANK`, matching the "general by construction" property of the existing lock check. The loader, not `precedence.ts`, applies the bootstrap fallback (layering: SE ADR-0002). Pin needs no change: it hashes raw bytes.

### Verification plan (criterion to check)

Every A and B id in section 3 maps to a named test, a mutation drill, or a command as listed there (A1–A11, B1–B18). Commands for Phase 2: `npm run typecheck`, `npm run lint`, `npm run qa:kernel-purity`, `node --test src/policy/`, `npm test` (real pass/fail/skipped counts), plus the `git diff --stat` checks in A11, B16, B17.

### Rollout and rollback

No deploy. Nothing is wired: the kernel gate hook keeps `BOOTSTRAP_DEFAULT_OUTCOME` ("allow") and never calls `loadEffectivePolicy`, so the runtime behavior of any session is unchanged by this story. Rollback is `git revert` of the story's commits. #124 is test-only and independently revertable.

## 9. Draft decisions.md wording

### Row for #107 (ratified residual; docs only)

| Date | Decision (+ evidence) | By | Dissent | Human ratified | Review-back |
|---|---|---|---|---|---|
| 2026-09-24 | **Issue #107 (central-source absent detection depends on an English-only pattern list for the Windows registry tool's error text) is a RATIFIED RESIDUAL. No code is built for it in story s6-policy-residuals-112-124.** Reason: a verified non-English sample of that tool's not-found message does not exist in this repository or in any reachable evidence. A translated pattern added from guesswork would make the loader classify unverified text as "absent" (a non-rejecting state), which is a fail-open direction, i.e. it would fabricate the very signal the loader must fail closed on. Current behavior stays: on a non-English host with no central policy deployed, the load is rejected as a read-error (loud, fail-closed, availability cost only). Live impact today: none, because the loader is not on any enforcement path (the kernel gate hook is unwired and reads its own bootstrap ruleset). The exit-code alternative was measured on 2026-09-08 and has no discriminating power (exit code 1 for not-found, access-denied and invalid-syntax alike). **Review-back is tied to the story that rewires `hooks/pretooluse-kernel-gate.mjs` to consume the loader** (unblocks Issue #93): that story's Phase 1 must, before the loader becomes a live path, either capture a verified non-English sample or replace the text match with a locale-independent existence check, and must re-open this row. Calendar backstop only if that story has not started: 2026-10-24. Evidence: `src/policy/config/central-source.ts` (pattern array and exit-code precondition), the 2026-09-08 S6 fix-now decisions row, `docs/backlog.md` (the #107 line), `docs/reviews/s6-policy-centralization-red-team-2026-09-08.md` finding 2. | Manager (Osiris), pre-approved intake ruling; drafted by story-implementer (Ptah) | none | pending | at intake of the hook-rewiring story; backstop 2026-10-24 |

Draft avoids backtick-quoted slash shorthands; every path cited resolves in the repo.

### Row for #112/#124 disposition (ratification of D1 to D3)

Content to draft in Phase 2 from section 4 and section 6: defaultOutcome lives in the policy format as an optional per-layer key; implicit lock by trust rank (deviation from red-team's "mark it mandatory" wording, red-team's own alternative branch not used); tighten-only for lower-trust layers; peers override each other; central absent means no central posture (same as AC5a for rules); result field only, no printer or CLI surface; #124 closed by a test-only amendment with per-site bounds.

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Peers (shipped-defaults and project, both rank 0) override each other's `defaultOutcome`: a project file can set "allow" over a shipped "deny". Consistent with how their rules already behave, but a reader may expect shipped to be firmer | Disclosed in the decisions row and B7 ground-truth test; not fixed here (would need a new trust model, out of scope) |
| R2 | Central absent or unsupported means no central posture, so a hosted "deny" silently disappears and bootstrap "allow" applies. Inherent to AC5a (absent contributes nothing) | Named in the decisions row; live impact none today (unwired); relevant to the rewiring story's Phase 1 |
| R3 | A lower-trust layer may tighten to deny: an availability lever for anyone who can edit the project file | Accepted by ruling (fail-closed direction) |
| R4 | `rule-types.ts` is inside the kernel purity boundary | Type-only import from a sibling kernel file; `npm run qa:kernel-purity` must stay PASS (B18) |
| R5 | `src/policy/rule/schema.test.ts:91` regex order trap | Append the new key last (section 0, trap 1) |
| R6 | New field consumed by nothing until hook rewiring, so it could rot | B15 asserts its shape on every success; backlog line names the consumer story |
| R7 | The raw-bytes assertion is measured on Node 24.15.0 only; CI runs 22.18.0. Assumption: sources are long enough that neither Node version echoes them whole in the parse error | Measure by the CI run of the PR (rule 18 says the number is measured, this is the measurement); if it false-fails on 22, fall back to red-team's alternative terminator form for that site only |
| R8 | test-writer appends to files the implementer owns (`schema.test.ts`, `loader.test.ts`, conformance) | Appended hunks are delimited and dated; implementer does not edit them; existing tests unchanged |
| R9 | QA-14/QA-15 gates re-trip on new prose | Section 7 drafting rules; run the gates locally before the PR |

## 11. Is design-challenger warranted? No.

- Not a novel shape (rule 15): no first-ever pattern; it is a scalar added to an existing per-layer trust-rank mechanism the council already ruled on (Path B).
- The design fits one paragraph (rule 17); there is no number to spike (rule 18); the existing loader plus the `printer.test.ts` fixtures are the walking skeleton.
- The one real question (tighten-only from untrusted layers) was ruled by the Manager at intake. `red-team` runs post-build anyway at CRITICAL and should be pointed at: tighten-only edge cases, duplicate/escaped-key relax paths, voided-layer bypass, central-absent.
- Reconsider only if D1 to D3 change to something with a new trust axis.

## 12. Next single action

Manager: confirm (or amend) D1 to D3, then dispatch `test-writer` for #124 (`printer.test.ts` only) and for #112 (B1–B15) in the files named in section 8. Phase 2 for #112 starts only after the #112 receipt says `RED-CONFIRMED`.
