# S7-B policy-authoring-safety: Phase 1 plan (2026-09-26)

Branch: `feat/s7b-policy-authoring-safety` (cut from `fix/s7a-gate-hook-robustness`, which holds the S6 close-out). Author: story-implementer (Ptah), Phase 1 only. Nothing is built.
Issues: #305 (a central fixture entry can lower a built-in tool's class), #306 (deny rules an author naturally writes load clean and never match). Milestone S7. Activation owner: Issue #308 (the gate hook is unwired; live exposure is 0% today for both).
Sources read: `gh issue view 305 306`; `docs/reviews/s7-kernel-gate-classification-design-challenger-2026-09-26.md` (PT-7); `docs/reviews/s7-kernel-gate-classification-design-challenger-round2-2026-09-26.md` (attack 1, PT-12); `docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md` (section 14, AP-1); `src/policy/tools/classification-catalog.ts`, `central-classification.ts`, `builtin-tool-inventory.ts`; `src/policy/config/loader.ts`; `src/policy/normalizer/tool-class-format.ts`, `tool-class-golden.test.ts`; `src/policy/gate/tool-routing.ts`, `decide-tool-call.ts`; `hooks/pretooluse-kernel-gate.mjs`, `hooks/sessionstart-tool-enum.mjs`; `hooks/pretooluse-kernel-gate-classification.test.ts` (H8); `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md`.

## 1. Readiness and one-sentence restatement

- Readiness: PASS. The two Manager rulings (R1 for #305, R2 for #306) settle every design fork; no material fact is missing. No blocking questions (section 9 lists two non-blocking confirmations).
- Restatement: make a central fixture entry that lowers a built-in tool's class a load error, and make a policy rule that provably cannot match any record the normalizers emit a load error, so neither mistake is silent once the gate is activated.
- Spike and skeleton (PRINCIPLES rules 17, 18): no number is assumed by this design and the shape is not novel (a guard in an existing funnel, a validator in an existing parse step), so no spike and no walking skeleton. The only quantities are counts the tests compute at run time.

## 2. ADR review (hard gate; `node docs/adr-cache.mjs --ensure`: CACHE=HIT, 37 ADRs)

| ADR | Verdict | Rule this story honors |
|---|---|---|
| THOTH-ADR-0001 (fixture standing exception) | APPLICABLE | Rule 5: "**MUST** keep the loader throwing on malformed input" (R1 throws from `assembleCatalog`; SessionStart's existing catch records it, never a silent exempt-everything). "**MUST NOT** hardcode an entry of either list in `hooks/` or `src/`" (new tests read names from the fixture at run time; G19 covers the new files). Rule 1 (do not cite the exception for any other control): not cited. Rule 2 (a PR touching the loader or the hooks that read the file still needs a fresh dated review report): this story changes `classification-catalog.ts`, the shared reader of the fixture, so a dated review report is required. The fixture JSON itself is not edited. The Q-C(a) ruling ("PR diff is the approval" once a class grants allow) stays a human-only activation blocker, unchanged. |
| SE ADR-0021 (thoth-native architecture) | APPLICABLE | "Every governed tool call MUST be normalized into exactly one canonical Action record" and "the kernel MUST NOT branch on a field outside these seven": neither R1 nor R2 touches the kernel, the record, or `mergeToolClassificationLayers`. "The kernel MUST deny a mutating action whose Action record has `source: opaque`": unchanged. "The startup gate, the in-session hook gate ... MUST return identical verdicts on identical input": both hooks reach the catalog through the one funnel `assembleCatalog`, so the guard cannot apply to one and not the other (proved by instrument R1-6 below). |
| SE ADR-0005 (testing strategy) | APPLICABLE | "MUST write unit tests for every new/changed domain or application behavior" (every criterion below is a named test); "MUST NOT delete or weaken a failing test to make CI pass" (G13b is edited by explicit replacement, section 8; no locked test is edited); "MUST make each test create/own its data" (temp dirs per test). |
| SE ADR-0010 (quality gates) | APPLICABLE | "MUST run the full local equivalent of CI gates before declaring work complete"; "MUST NOT ... delete tests"; functions stay within the complexity limit (the guard and each of V1 to V3 are separate small functions). |
| SE ADR-0003 (SOLID) | APPLICABLE | "MUST NOT create classes/modules that mix unrelated responsibilities": reachability check lives in its own module, not in `schema.ts` (layering) and not in `loader.ts`'s body. "SHOULD NOT over-abstract": no interface, three small functions. |
| SE ADR-0002 (layers) | APPLICABLE, low | The new config module imports two constants from the normalizer's grammar file (`tool-class-format.ts`). That is a config-to-normalizer dependency the project does not have today; the file imports only a type from `src/policy/tools/`, so no cycle and no I/O. Recorded as a seam for `cross-domain-reviewer` (section 9, confirmation 2). |
| SE ADR-0006 (blast radius) | APPLICABLE, low | "MUST NOT widen a change's scope opportunistically": the backlog candidates in section 10 stay out of the diff. |
| SE ADR-0004, ADR-0009, ADR-0011 to 0015, ADR-0007/0008, DevOps ADR-0001 to 0010, SE ADR-0016 to 0020, THOTH-ADR-0002 (proposed) | NOT-APPLICABLE | No data store, IaC, ported file, secret-scan allowlist, or mutating operation is touched. `.github/workflows/ci.yml` is not touched (new checks run inside `npm test`). |

UNCLEAR ADR applicability: none.

## 3. Risk tier (proposal for Manager ratification)

**CRITICAL.** Justification: the change edits the policy-delivery/config surface (`src/policy/config/loader.ts` plus a new module under `src/policy/config/`) and the shared reader of the classification fixture (`src/policy/tools/classification-catalog.ts`, THOTH-ADR-0001's named loader-adjacent path), and it changes fail-closed behavior of both session-gate hooks (`hooks/pretooluse-kernel-gate.mjs`, `hooks/sessionstart-tool-enum.mjs`, unedited but behavior-changed through the funnel). A wrong guard is a silent allow (a lowered class) or a whole-policy denial (a false-positive rule rejection). Mitigations that keep it out of "over-tiered": the hook is unwired (live exposure 0%, counted: the shipped-defaults and project layers hold zero rules, checked by a test in this story), and both changes only add load-time rejections. It is not under-tiered because a mistaken rejection blocks the whole policy load for every session once activated.

## 4. Test-first dispatch check

- Does the plan identify a new or changed UI flow or API surface? **Partly.**
  - #306 (loader-level rule rejection): NO externally observable UI/API surface change; the loader's result type and the printer's stdout shapes are unchanged (the existing `schema-invalid` kind carries a new message). Implementer-owned tests, written failing first.
  - #305 changes observable gate-hook behavior: with a lowering fixture entry, an MCP call goes from a class-driven verdict to a fail-closed exit 2 with the fixed stderr line. That is a changed outcome at a gate surface whose black-box tests (the H series) are `test-writer`-owned.
- **Decision: dispatch `test-writer` now, before Phase 2, for ONE item: PT-7 at hook level** (brief in section 7). Reasons: CRITICAL tier; the expected outcome (exit 2, silent stdout, no leak) is exactly the thing an implementer could rig if it also wrote the test; the sandbox helper (`hooks/test-support/gate-sandbox.ts`) already exists, so the cost is one small new test file. Phase 2 does not start until that file exists and its receipt says `RED-CONFIRMED`.
- The hook-level file is a NEW file; the locked hook tests (H8 and the rest) are not edited.

## 5. Acceptance criteria as named test cases

"Red first" = fails on today's code. All new files are additive. Names below are the test titles' ids. Counts in test output are computed at run time; none is typed in a test or in prose.

### 5.1 #305 (R1): a central entry cannot lower a built-in class

Guard: `assembleCatalog` in `src/policy/tools/classification-catalog.ts`, before `mergeToolClassificationLayers`. Class order read-only < workspace-mutating < remote-mutating, held as `Record<ToolClass, number>` (a fourth class is a compile error). Match relation is the merge's own key (exact name), so the guard and the merge cannot disagree about which entries override a built-in.

| Id | Case | Check |
|---|---|---|
| R1-1 `builtin-lowering-enumerated` | Every built-in name (read from `loadBuiltinToolClassificationLayer()` at run time) crossed with every class (read from the class table): `assembleCatalog` on a temp fixture holding that one entry throws exactly when the entry's class ranks below the built-in's; otherwise returns and the merged entry carries the entry's class with `sourceLayer` central (T5 "central wins" survives for same-class and raising). The test prints the pair count it computed. | new file src/policy/tools/classification-builtin-override.test.ts |
| R1-2 `error-names-entry-and-class` | The thrown message names the entry, the built-in's class, and the unlock (raise the class or remove the entry). Values are built from the run-time pair, never typed. The entry name is quoted with `JSON.stringify` and length-bounded. | same file |
| R1-3 `within-fixture-order-independent` | A fixture holding a raising entry and a lowering entry for the same built-in name throws in both orders (each entry is checked, not only the entry that wins the merge). | same file |
| R1-4 `committed-fixture-passes` | `assembleCatalog(moduleRelativeFixtureLocation())` returns; the test derives the overlap between committed entry names and built-in names by script and asserts no committed entry lowers a built-in. | same file |
| R1-5 `merged-never-below-builtin` | Property over the accepted pairs of R1-1: for every built-in name in the merged catalog, merged rank >= built-in rank. | same file |
| R1-6 `single-merge-site` | Structural instrument (comment-stripped scan of `src/` and `hooks/`, tests excluded, reusing the existing `stripComments`): the only production caller of `mergeToolClassificationLayers` is `classification-catalog.ts`, and the only production callers of the fixture loader/parser are that file's `assembleCatalog` and the test-only sites. Failing output lists the offending files. | same file |
| R1-7 `sessionstart-halts-on-lowering` | New hook test (implementer-owned; the locked SessionStart tests are not edited): a project-relative fixture holding a lowering entry makes `hooks/sessionstart-tool-enum.mjs` exit 0 and write `SUR-03-enumeration-failed` active, whose text names the entry and the built-in class and whose recorded fixture path and source are the resolved ones (THOTH-ADR-0001 rule 5). Controls: a raising entry and a same-class entry leave that reason unset. | new file hooks/sessionstart-tool-enum-builtin-override.test.ts |
| R1-8 `PT-7 gate-exit-2-on-lowering` | `test-writer` item (section 7): lowering entry, then an MCP call, exit 2, empty stdout, the fixed stderr line, and no leak of the entry name, the class strings or the fixture path. Controls: raised and same-class entries leave the MCP call a silent allow; an MCP call against the unmodified fixture is a silent allow. | new file hooks/pretooluse-kernel-gate-builtin-override.test.ts (test-writer) |
| R1-9 `bash-and-unroutable-unchanged` | H8 (locked) stays green UNMODIFIED: `Bash`, `Write`, `Edit`, `Task` never load the catalog (`needsCatalog` is false for Bash; unroutable names are refused before any load), so their outcomes with a planted lowering fixture are identical to baseline. Verified by running H8 before and after, output recorded. | locked file, run only |

### 5.2 #306 (R2): rules that cannot match an emitted record are load errors

New module src/policy/config/rule-reachability.ts, called from `parseLayerText` in `src/policy/config/loader.ts` after `validateRuleSet` passes. Failures return the existing `schema-invalid` reason kind (no new kind; `LoadFailureReasonKind` is untouched, so G1's union type check is unaffected). `src/policy/rule/schema.ts` is untouched. Checks apply per element of `verbs` and `targets` (section 9, confirmation 1).

| Rule | Rejected | Accepted (documented) |
|---|---|---|
| V1 | a verb that starts with the marker prefix and is not one of the class marker verbs; the message lists the valid markers | the three markers; any verb not starting with the prefix (out of scope, section 10) |
| V2 | a target that starts with the MCP target prefix, has a non-empty remainder, and that remainder has no "/" (a server name with no trailing slash and no tool segment) | the bare prefix (matches every MCP target); a server with trailing slash; a server plus tool |
| V3 | a target under the MCP prefix whose server segment (up to the first "/") does not match the admitted server-name pattern, including an empty segment | a server segment of letters, digits and hyphen |
| not rejected | legacy mutating verbs plus an MCP target (matches shell-forged records only; stays documented, shape c) | |

| Id | Case | Check |
|---|---|---|
| R2-1 `v1-marker-typo` | Misspelled marker, marker prefix alone, and a marker with a trailing character each reject with `schema-invalid`; each of the three valid markers (taken from the marker table at run time) loads; the message contains the field path (`rules[i].verbs[j]`), the rule id, and every valid marker. | new file src/policy/config/rule-reachability.test.ts |
| R2-2 `v2-no-trailing-slash` | A server target without slash rejects; with slash, with a tool segment, and the bare prefix load. | same file |
| R2-3 `v3-declared-name` | Server segments containing a space, a colon, a dot, an underscore, or empty reject; letters, digits, hyphen load; a tool segment is not checked here. | same file |
| R2-4 `shape-c-loads` | Legacy mutating verbs plus an MCP server prefix load (0 errors) and, with the real kernel, never match a class record (the documented fact, kept). | same file |
| R2-5 `PT-12 entry test` | Through the real `loadEffectivePolicy`, for each of the three layers (central via an injected source with a channel descriptor, shipped-defaults and project via temp files): shapes a (marker typo), b (no trailing slash) and d (declared name) return `ok: false`, `reasonKind: "schema-invalid"`, `failedLayer` equal to the layer under test (never misattributed, Issue #108), and a message naming rule id and field path; shape c loads `ok: true`; the valid deny rules (marker only, marker plus server prefix, server prefix only, an exact server-and-tool target) load `ok: true`. The test prints the case count it computed from its own tables. | new file src/policy/config/loader-reachability.test.ts |
| R2-6 `drift-emitted-vocabulary-accepted` | Drift instrument, part 1: over the golden corpus (the exported shell-call fixtures in `src/policy/fixtures/normalizer-calls.ts` enumerated by `Object.values`, the verb catalog `KNOWN_VERBS` enumerated, and one tool-class record per class for each admitted stand-in server plus each committed fixture server read at run time), every verb and every target a normalizer emits, used as a one-element rule, passes the check. The corpus must be non-empty and contain no shell-emitted target under the MCP prefix (a forged one would be rejected by V2 by ruling; the assertion makes that a decision, not an accident). | `rule-reachability.test.ts` |
| R2-7 `drift-authored-shapes-validate` | Part 2: every marker verb rule, and every `mcp/<server>/` prefix rule for each admitted committed fixture server and each stand-in, passes the check. | same file |
| R2-8 `no-retyped-vocabulary` | Structural: the new module contains no literal of the marker prefix, the MCP target prefix, or the server-name pattern (comment-stripped scan); the marker table's values all start with the exported prefix constant; the builder `buildMcpTarget` produces the exported target prefix. These come from `tool-class-format.ts` exports (`ADMISSIBLE_SERVER_NAME`, new `CLASS_MARKER_PREFIX`, new `MCP_TARGET_PREFIX`). | same file |
| R2-9 `rejection-through-printer` | The real printer over a project layer holding an inert rule prints the layer, the schema-invalid failure and the message, without adding a stdout shape; a terminal-control character inside a rejected target reaches the printer's stdout stripped (S6-294 render boundary; the echo-sanitize enumerating walk stays green). The rejected value in the message is JSON-quoted and length-bounded. | new file src/policy/config/loader-reachability.test.ts |
| R2-10 `no-rules-today` | The shipped-defaults and project files hold zero rules (read and counted by the test): the check rejects nothing that loads today (migration exposure counted, 0). | `loader-reachability.test.ts` |
| R2-11 `g13b-replaced` | The documenting test G13b keeps its schema-level assertion (0 schema errors; `schema.ts` untouched) and its kernel non-match assertions, is retitled and re-commented so it no longer claims the shapes "load clean", and gains the loader-level rejection for shapes a, b, d and load for c (section 8). | edit `src/policy/normalizer/tool-class-golden.test.ts` |

### 5.3 Story-wide

| Id | Case | Check |
|---|---|---|
| S-1 `locked-keys-unmodified-and-green` | `git diff --stat` over the locked paths is empty, and each passes: `src/policy/rule/precedence.test.ts` (T5), `src/policy/tools/classification.test.ts`, `hooks/pretooluse-kernel-gate-classification.test.ts` (H8 and the test-writer tests), `src/policy/normalizer/tool-class.test.ts` (N10), `src/policy/gate/decide-tool-call.test.ts` (G16), the SessionStart test files, the printer test files (exact stdout), `src/policy/rule/schema.test.ts`. Also empty: `git diff` on `src/policy/rule/precedence.ts` and `src/policy/rule/schema.ts`. If any locked test must change: STOP and flag back. |
| S-2 `g19-covers-new-files` | The new test files are added to G19's `STORY_TEST_FILES` list in `src/policy/gate/gate-structure.test.ts` (additive), so none types a committed fixture entry name. New tests use stand-in names only. |
| S-3 `mutation-proof` | Named mutants run through the existing `runMutationHarness` engine from a scratch script (raw output kept in the build report, no new committed instrument): guard uses less-or-equal (rejects same-class); guard uses greater-than; guard checks only the merged result; guard removed; V1 drops the marker-set check; V1 prefix without the colon; V2 removed; V3 admits underscore; V3 skips empty segments; check not called for the project layer; check called before `validateRuleSet`; message omits the valid markers. Every mutant must be KILLED; a survivor gets a test or a written residual. |
| S-4 `gates` | `npm run typecheck`, `npm run lint`, `npm test` (real pass/fail/skipped counts; skipped is not passed), `npm run qa:gate-latency-budget` (the guard adds one linear pass to the catalog load; the budget check proves it stays inside), `qa:kernel-purity`, `qa:normalizer-registry-purity`, the completeness-claim checker, the secret scan, and the reference-resolver in diff mode (QA-14; plan and report use repo-root paths only). |

## 6. Design (minimal)

Files, production:

| File | Change |
|---|---|
| `src/policy/tools/classification-catalog.ts` | Add the class-rank table and an exported guard function; `assembleCatalog` calls it after loading both layers and before the merge; header and the "central wins" doc line reworded to say a lowering entry is a load error. `mergeToolClassificationLayers` is not touched. |
| `src/policy/normalizer/tool-class-format.ts` | Export `ADMISSIBLE_SERVER_NAME`; add exported `CLASS_MARKER_PREFIX` and `MCP_TARGET_PREFIX`; `buildMcpTarget` uses the latter; header fact 4 replaced (section 8). No marker is renamed and `GRAMMAR_VERSION` stays "1" (record shapes do not change; the golden G13 pins this). |
| src/policy/config/rule-reachability.ts (new) | One exported function taking the parsed rule set and returning error entries in the `{ message, field }` shape `parseLayerText` already joins; three small private checks V1, V2, V3. Pure, no I/O. |
| `src/policy/config/loader.ts` | `parseLayerText` calls the new check after `validateRuleSet` returns no errors and returns the same `schema-invalid` failure shape. No other change. |

Files, docs: `docs/decisions.md` (one or two new rows, section 8), `CHANGELOG.md`, and the plan's build report is not written as a file (the receipt carries the counts). `docs/backlog.md` gets the section 10 candidates. The fixture JSON is not edited (the fixture-only exception is not needed and not invoked).

Behavior notes the reviewers should know:
- SessionStart: a lowering entry throws inside `assembleCatalog`; the hook's existing catch writes `SUR-03-enumeration-failed` with the message (the operator sees the entry and the class in the halt relay), and the session still starts (SessionStart cannot block; the halt point is the prompt hook).
- The gate: the MCP path throws, the hook's catch exits 2 with the fixed stderr line (error type only, by the S7-A ruling), so the entry name is deliberately not on the gate's channel. `Bash` and unroutable names never load the catalog and are unchanged.
- One bad fixture entry now blocks classification for the whole fixture until it is fixed. That is the ruled load-error choice (over ignore-with-disclosure) and follows THOTH-ADR-0001 rule 5.
- A rule the check rejects fails the whole layer's load (existing `schema-invalid` semantics), so under an active gate a project-layer typo denies every governed call until fixed. The deny reason names layer and kind only (H6); the message with rule id, field path and valid markers is on the print surface (`npm run policy:print`). This is fail-closed by design; the unlock is stated in the message.

Rollout and rollback: unwired hook, no shipped rules, no fixture edit, so there is no live behavior to roll out. Rollback is `git revert` of the story commits; nothing is persisted.

## 7. `test-writer` dispatch brief (PT-7, hook level), to run before Phase 2

Deliverable: one new file hooks/pretooluse-kernel-gate-builtin-override.test.ts, black-box through `createGateSandbox()`, RED-CONFIRMED before the implementer builds.
- Built-in names: read at run time from the built-in inventory layer (a lowering case exists only for built-ins whose class is above read-only; derive, do not hand-type). Committed fixture entry names: read from the fixture (G19).
- Case 1: edit the sandbox fixture so one such built-in is listed at a lower class; then `sb.mcp(<committed entry name>, "x")` returns exit 2, empty stdout, stderr matching the existing fixed line, and stderr and stdout contain none of: the entry name, the class strings, the sandbox fixture path.
- Case 2 (enumerated): the same for each lowerable built-in name from the run-time list.
- Controls: the same entry raised, and the same entry at the built-in's own class, leave the MCP call a silent allow (exit 0, empty stdout, empty stderr); the unmodified fixture gives a silent allow (H1 shape).
- Not in scope for the file: `Write`, `Edit`, `Task`, `Bash` calls (H8 covers them; do not edit H8).
- Expected today: Case 1 and 2 fail (the MCP call is not exit 2), controls pass. That is the RED.

## 8. Decisions to record in `docs/decisions.md` at build (pending human ratification; never "ratified by human")

The human preapproved Manager decisions this session; each row is marked pending.
1. R1 and R2 rulings as made, with evidence (the two design-challenger reports, this plan). Accepted cost stated: an MCP server literally named like a built-in cannot be classified lower.
2. **Replacement decision (SE ADR-0005), G13b and rule-author fact 4.** G13b currently documents that four inert deny shapes "load clean". R2 makes three of them load errors, so that claim is replaced: G13b keeps every assertion it has (schema 0 errors, kernel non-match) and adds the loader assertions, so nothing is deleted or weakened; only its title and comments change. Fact 4 in the `tool-class-format.ts` header is rewritten to say: three shapes are load errors, the legacy-verb-plus-MCP-target shape still loads and never matches a class record. This is an explicit replacement, recorded for a human reading of ADR-0005 as the AC-2 amendment was.
3. **Plan AP-1 wording (the S7 plan is immutable, so recorded here).** AP-1 names PT-12 as an entry test for activation; S7-B satisfies PT-12 (R2-5). AP-1's other content (baseline allow content, PT-1, PT-2) is unchanged and still open.
4. Per-element reading of V1 to V3 (section 9, confirmation 1), the config-to-normalizer import (confirmation 2), and the `test-writer` dispatch for PT-7 only.
5. Q-C(a) stays a human-only activation blocker; this story does not change it (PT-7's guard removes only the lowering vector from it).

## 9. Non-blocking confirmations (defaults taken unless the Manager objects at approval)

1. **V1 to V3 apply per element.** A rule listing one valid and one mistyped marker is rejected. The alternative (reject only when no element can match) would let the typo through silently. Default: per element, as the ruling's wording reads.
2. **Config imports the grammar constants from the normalizer file.** The ruling requires reuse rather than re-typing; the import is value-only from a pure file. Default: accept; `cross-domain-reviewer` is asked to look at the direction.

## 10. Not in scope (backlog candidates, not in the diff; PRINCIPLES rule 12)

- Verbs with different letter case (a rule verb differing only in case from an emitted one is inert; the normalizers emit lowercase).
- A tool segment in a target outside the admitted tool-name pattern (provably unmatchable; V3 as ruled covers the server segment only).
- Verbs outside the verb catalog that do not start with the marker prefix (existing tests use free-form verbs; a catalog check is a wider rule change).
- The gate's fixed stderr line does not name the offending fixture entry (by the S7-A ruling); a bounded, sanitized detail channel is a follow-up.
- Print-surface disclosure of a class override (the PT-7 print-surface half rode on Q-C, human).

## 11. Sensitive areas and reviewers

Sensitive areas touched (CLAUDE.md): policy delivery / config surface (`src/policy/config/loader.ts`, the new module, the fixture reader `classification-catalog.ts` under THOTH-ADR-0001); policy enforcement / session gates (behavior of `hooks/pretooluse-kernel-gate.mjs` and `hooks/sessionstart-tool-enum.mjs`, neither edited). Not touched: the fixture JSON, `.github/workflows/ci.yml`, secret-scan files, the evidence trail, `.thoth/halt-state/` code (SessionStart's existing write path is reused, not edited).

Reviewers required by CRITICAL: `red-team` plus `app-security-reviewer` (the guard is an authz-adjacent control: can a class be lowered, can a rule be made inert), and `cross-domain-reviewer` (standing; asked about the config-to-normalizer seam, the funnel instrument, and the SessionStart versus gate behavior split). No third domain reviewer; `architecture-reviewer` is not required (no novel shape). `test-writer` runs first for PT-7 only (section 4). Findings arrive as failing tests (PRINCIPLES rule 19).

## 12. Risks

| Risk | Mitigation |
|---|---|
| False-positive rejection blocks a whole layer once active | R2-5 valid-rule table, R2-6 and R2-7 drift instruments over the emitted vocabulary, R2-10 (no rules load today); message states the unlock |
| Guard and merge disagree about which entry overrides a built-in | Same key (exact name); R1-5 property; R1-6 single merge site |
| Future class added and rank table not updated | `Record<ToolClass, number>` is a compile error; R1-1 reads classes from the table |
| Marker or prefix vocabulary drifts from the check | Imported constants; R2-6, R2-7, R2-8 |
| A forged shell target under the MCP prefix is now unmatchable by a target-only deny without a trailing slash | By ruling; R2-6 asserts the corpus contains none, so the acceptance is explicit; disclosed in the decisions row |
| The operator cannot see the entry name on the gate channel | SessionStart halt relay carries it; gate stays fixed-line by the S7-A ruling; follow-up in section 10 |
| `npm test` run time grows | R1-1 uses one temp fixture per pair; the count is small and printed; the file-based pair loop is synchronous |

## 13. Build order (Phase 2, after approval and the `test-writer` receipt)

1. Confirm `test-writer`'s PT-7 file exists and reads `RED-CONFIRMED`.
2. Commit the implementer's failing tests (R1-1 to R1-7, R2-1 to R2-10, S-2), red, before any production change.
3. Production: the exported constants in `tool-class-format.ts`, the guard, the new module, the loader call; then G13b and the header text (R2-11).
4. Run the locked keys and H8 (S-1), the mutants (S-3), the gates (S-4); record raw counts.
5. Decisions rows, CHANGELOG entry, backlog lines; PR skeleton with the criteria checklist (criteria are `Closes #305`, `Closes #306`), constraints honored, and the review chain (section 11).

Single next action: the Manager ratifies the tier and approves this plan, then dispatches `test-writer` with the section 7 brief.
