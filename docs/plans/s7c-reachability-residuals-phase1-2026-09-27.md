# S7-C policy-reachability residuals: Phase 1 plan (2026-09-27)

Branch: `feat/s7c-reachability-residuals` (cut from the S7-B tip). Author: story-implementer (Ptah), Phase 1 only. Nothing is built.
Issues: #334 (a verb list mixing a class marker with a verb no normalizer emits loads inert), #335 (an allow rule on a server target the runtime cannot present silently widens). Milestone S7. Activation owner: Issue #308 (the gate hook is unwired; live exposure is 0% today, measured: the shipped-defaults and project policy files hold zero rules, re-read this session).
Sources read: `docs/STATE.md`, `CLAUDE.md`, `docs/PRINCIPLES.md`, `docs/decisions.md` (the three S7-B rows), `docs/reviews/s7b-policy-authoring-safety-red-team-round2-2026-09-26.md` (findings 2 and 3), `docs/plans/s7b-policy-authoring-safety-phase1-2026-09-26.md`, `src/policy/config/rule-reachability.ts` and its test, `src/policy/config/loader-reachability.test.ts`, `src/policy/config/loader.ts` (the one call site), `src/policy/normalizer/tool-class-format.ts`, `src/policy/normalizer/shell.ts`, `src/policy/normalizer/action-catalog.ts`, `src/policy/normalizer/tool-class-golden.test.ts` (G13b), `src/policy/kernel/kernel.ts` (rule matching), `src/policy/fixtures/mcp-redirect-commands.ts`; `gh issue view 334 335`.

## 1. Readiness and restatement

- Readiness: PASS. The Manager's three rulings settle every fork (allow-effect scope, marker-required scope, KNOWN_VERBS as the emitted set). No blocking question. Section 10 lists four non-blocking notes.
- Restatement: make the reachability check reject (a) any rule whose verbs hold a class marker and no verb a normalizer emits, and (b) an ALLOW rule with no verbs (absent or empty) on a server target the runtime never presents, so neither the inert mixed-verb rule nor the silent allow-widening loads on any layer.
- Spike (PRINCIPLES rules 17, 18), run this session, scratch script outside the repo: with a deny baseline and an allow rule on an underscore-named server target, over shell commands built from every catalog verb (verb alone, verb plus resource and context, plain echo), the kernel returned allow only for the `write` verb; an allow rule with no verbs allowed all three probe redirects. This confirms intake correction 5 (only `write` widens) and the widening. The build turns this spike into the run-time instrument in AC-335-3, so no count is typed as a claim. Not a novel shape: no walking skeleton.

## 2. ADR review (hard gate; `node docs/adr-cache.mjs --ensure`: CACHE=HIT, 37 ADRs)

| ADR | Verdict | Rule this story honors |
|---|---|---|
| SE ADR-0005 (testing strategy) | APPLICABLE | "MUST write unit tests for every new/changed domain or application behavior"; "MUST NOT delete or weaken a failing test to make CI pass". The R2-12 row flip is an explicit replacement (stricter, nothing deleted), recorded in a decisions row pending human ratification, as S7-B did for G13b. |
| SE ADR-0010 (quality gates) | APPLICABLE | "MUST run the full local equivalent of CI gates before declaring work complete"; "MUST NOT lower coverage thresholds, delete tests". |
| SE ADR-0003 (SOLID) | APPLICABLE | "MUST NOT create classes/modules that mix unrelated responsibilities"; "SHOULD keep functions under ~40 lines". The predicate stays a small pure function inside the existing module; no new module. |
| SE ADR-0006 (blast radius) | APPLICABLE | "MUST NOT widen a change's scope opportunistically": no-marker verb lists, allow rules without a marker on a presentable target, the aggregate-message cap and Issue #332 stay out of the diff (section 10). |
| SE ADR-0002 (layers) | APPLICABLE, low | One more value import from the normalizer directory into the config module (`KNOWN_VERBS`, pure data file with no imports). Same direction S7-B ruled item 4 accepted; recorded as a seam for `cross-domain-reviewer`. |
| SE ADR-0021 (thoth-native architecture) | APPLICABLE | "the kernel MUST NOT branch on a field outside these seven": kernel, record and schema untouched. |
| THOTH-ADR-0001 | NOT-APPLICABLE | No fixture entry or fixture reader is edited. |
| Every other catalog entry (DevOps, SE 0004, 0007 to 0020, THOTH-ADR-0002 proposed) | NOT-APPLICABLE | No IaC, data store, secret-scan allowlist or ported file is touched. |

UNCLEAR applicability: none.

## 3. Risk tier (PROPOSAL for Manager ratification)

**CRITICAL.** One line: the change edits the policy-delivery/config surface (the loader's reachability check), it adds two whole-load rejections (a false positive on the central layer denies every governed call until the out-of-session owner corrects the source, the exact failure class of S7-B Issue #328), and it closes a silent allow-widening (security-relevant).
Counter-considerations, stated so the Manager can overrule: the diff is one function plus tests and comments, the gate is unwired (live exposure 0%), and both rulings are already made. I do not propose STANDARD because the soundness proof (no rejection of a rule a normalizer-emitted record could match) is precisely what red-team attacked last round and found a real false-rejection on. If ratified STANDARD, the floor is `app-security-reviewer` plus `cross-domain-reviewer`, with red-team's soundness probe folded into the verification plan.

## 4. Test-first dispatch check

- New or changed UI flow or API surface? **No.** The loader result type, the printer stdout shapes and the hook outcomes are unchanged; a rule that used to load now fails with the existing `schema-invalid` kind and a message. Same call S7-B made for the identical module. `test-writer` is NOT dispatched; Phase 2 may start once the plan is ratified.
- Findings arrive as failing tests (PRINCIPLES rule 19): `R2-16` and `R2-17` (both named by red-team round 2) plus the replaced R2-12 row and the message-wording test are the first commit, red, before any production edit.

## 5. Acceptance criteria as named test cases

Numbering note: AC-334-7 is the Manager-named drift test. The intake list text was not in my input, so the other numbers are mine, built from the rulings and the intake corrections; reconcile if the intake numbering differs. Derived (not stated in an Issue): AC-334-5, AC-334-6, AC-335-4 boundary rows (they pin the rulings' edges).

The rule under test, exact: define `emittable(v)` = `KNOWN_VERBS.has(v)`. V2 and V3 apply to a rule when (i) its verbs are non-empty, hold at least one class marker, and hold no emittable verb (covers all-markers and marker-plus-stray), or (ii) its effect is `allow` and its verbs are absent or empty. Deny rules with absent or empty verbs are never checked. V1 is unchanged.

| ID | Criterion | Named check (file) | Red now? |
|---|---|---|---|
| AC-334-1 | A marker plus a verb no normalizer emits (empty string, a case-variant of a catalog verb, a near-miss of one, a marker-free stray) together with a V2 target (server, no trailing slash) is rejected at that target's own field path | `R2-12` matrix, row flipped and rows added, `src/policy/config/rule-reachability.test.ts` | yes |
| AC-334-2 | The same verbs with each V3 target (space, colon, dot, underscore, empty segment) are rejected | `R2-12` matrix | yes |
| AC-334-3 | The same shapes through the real loader on all three layers: `schema-invalid`, attributed to the layer that holds the rule, naming the rule id and `rules[i].targets[j]`, with the layer-aware Unlock (central: owner and "cannot repair", no edit instruction; file layers: `edit <that file>`) | `R2-16` part 1, `src/policy/config/rule-reachability.test.ts` | yes |
| AC-334-4 | Soundness: for every emitted record target under the MCP prefix that fails V2 or V3, a rule `[marker, stray verb]` plus that target is rejected AND `matchRules` (kernel) matches zero records over the R2-6 emitted corpus (shell, cluster, redirect-under-mcp, class records); counts computed and printed | `R2-16` part 2 | yes (rejection half) |
| AC-334-5 | No false rejection: each catalog verb, taken one at a time, paired with a marker (either order) plus a bad target loads; R2-6 (whole emitted records as rules) and R2-7 stay green unmodified | `R2-12` rows kept, `R2-6`, `R2-7` | green now, must stay |
| AC-334-6 | Scope edges: a list with no marker and only strays plus a bad target loads (backlog scope); a marker-prefixed typo is still rejected by V1 alone when a catalog verb sits beside it; deny with absent or empty verbs loads; all-markers rejection unchanged | `R2-12` rows, `R2-1`, `R2-2`, `R2-3` unchanged | green now, must stay |
| AC-334-7 | The emitted-verb set is `KNOWN_VERBS` imported from the action catalog, never retyped (scan: module imports it, holds no quoted literal of any catalog verb), AND a run-time drift test enumerates the verbs the real shell, cluster and class normalizers emit (golden corpus, redirect corpus, each catalog verb through verb-first shell and cluster shapes, every class) and asserts emitted is a subset of `KNOWN_VERBS` plus the markers; the comparator is self-tested (a synthetic extra emitted verb is reported) so the instrument can fail | `R2-8` extended, new `R2-19 emitted-verbs-subset-of-known-verbs` in `src/policy/config/rule-reachability.test.ts` | R2-8 part red, R2-19 green now (it guards future drift) |
| AC-334-8 | Message wording: for a mixed list the V2 and V3 text no longer says the verbs are "class markers only"; it says the list holds a class marker and no verb any normalizer emits; the all-markers text keeps its meaning; every text still ends in a layer-aware Unlock | `R2-20 mixed-list-message-wording` in `src/policy/config/rule-reachability.test.ts` | yes |
| AC-334-9 | Records: stale comments corrected (rule-reachability header, its test header, and fact 4 in the tool-class-format header); the R2-12 row flip recorded as an explicit replacement in a new decisions row, pending human ratification (SE ADR-0005); no test-writer file, no locked test, no G13b assertion edited | grep evidence plus `git diff --stat` over the locked files (verification step 7) | n/a |
| AC-335-1 | An allow rule with no `verbs` field on each V2 and V3 target is rejected on all three layers; message names the rule id and `rules[i].targets[j]`, says the rule has no verbs so it matches every verb and can match only a shell redirect into a directory of that name (a file write the baseline may deny), and the Unlock names the fix: add a class marker verb and write the sanitized name with a trailing slash; layer-aware | `R2-17` part 2 (loader, three layers), `src/policy/config/rule-reachability.test.ts` | yes |
| AC-335-2 | The same with `verbs: []` | `R2-17` part 2 | yes |
| AC-335-3 | The widening is real and is what the rejection prevents: through the REAL shell normalizer (the redirect corpus targets that fail V2 or V3, plus verb-first commands from every catalog verb) and the REAL kernel with a deny baseline, an allow rule with no verbs returns allow for the emitted record, and over the catalog verbs the set of verbs whose single-verb allow rule returns allow is exactly `write` (measured, the spike as an instrument); the same rules are rejected by the loader | `R2-17` part 1 (kernel, no loader) | part 1 green now (it documents the hazard), part 2 red |
| AC-335-4 | Ruled edges hold: an allow rule with `write` (or any single catalog verb) on the same target keeps loading; an allow with a well-formed target and no verbs loads; an allow with the bare MCP prefix loads; an allow with `[marker]` on a bad target is still rejected (all-markers, as before); a DENY rule with no verbs or empty verbs on the same targets loads; `R2-13` and the deny rows of `R2-12` pass with zero edits | `R2-17` part 3, `R2-13` (unmodified), `R2-12` deny rows | green now, must stay |

R2-18 is reserved for the LOW aggregate-message-cap finding, which belongs to no Issue here; the new tests take R2-19 and R2-20 so that number stays free.

## 6. Constraints

- `CLAUDE.md` hard rules: no `terraform`/deploy; no secrets; tests WITH the code; sensitive area "Policy delivery / config surface" draws a named reviewer and a fresh dated report in `docs/reviews/` before ship (the exception in the CLAUDE.md line covers only the classification fixture list, not the loader); no gold-plating (section 10 items go to Issues, never the diff); no hand-derived completeness claims: every count in tests and records is computed and printed by a running instrument, and the prose here and in the records avoids number-plus-completeness phrasings (QA-15).
- Human-only: merge, push to the default branch, ratification of the decisions rows.
- Review-chain rules: findings become named failing tests; `open findings` equals `failing tests`.
- Record discipline: append-only decisions row (the S7-B rows are not edited); a plain-language CHANGELOG entry; `docs/STATE.md` update at close by the Manager.
- QA-14 (diff mode): every path cited in a new or changed doc is a full repo-root path that exists at head; no path-plus-line citations; no ADR-shaped or Issue-shaped example strings that do not resolve (examples in new docs are worded in words). The new plan file and the new records follow this.

## 7. Plan

Files (production: one; the rest tests and records):

| File | Change |
|---|---|
| `src/policy/config/rule-reachability.ts` | Replace `hasOnlyMarkerVerbs` with one pure scope function returning `class-only`, `allow-widening` or none (imports `KNOWN_VERBS`); `checkTarget` takes the scope and words V2 and V3 messages per scope (the existing all-markers text and the substrings R2-15 checks stay). Header rewrite: the marker-only paragraph, the "Round-2 corrections" paragraph (now describing what is rejected, not a deferral) and the accepted-cost sentence. No change to V1, `unlock`, `quote`, the export or the loader. |
| `src/policy/normalizer/tool-class-format.ts` | Comment only, fact 4: the mixed-list and allow-widening sentences state the new rejection; still a documented, no-behavior change. |
| `src/policy/config/rule-reachability.test.ts` | Header comment; R2-12 rows (flip plus new rows, effect column); new R2-16, R2-17, R2-19, R2-20; R2-8 extended. `emittedCorpus` is reused in place; a small local loader helper is added rather than moving the corpus. |
| `docs/decisions.md`, `CHANGELOG.md`, `docs/STATE.md` | New decisions row pending ratification; changelog entry; STATE by the Manager. |
| Not touched | `src/policy/rule/schema.ts`, `src/policy/config/loader.ts`, kernel, `src/policy/config/loader-reachability.test.ts` (R2-13 and R2-15 stay unedited), G13b, every hook, every test-writer file. |

Design (minimal): `emittable` is a `KNOWN_VERBS` membership test, so the emitted set can only be over-approximated if a normalizer someday emits a verb outside the catalog; the drift test (AC-334-7) is what turns that into a failure, and over-approximation direction is the safe one (a rule is skipped, never wrongly rejected). Case is exact, matching the kernel's verb comparison, so a case-variant is a stray verb by design.

Build order (failing tests first, PRINCIPLES rule 19):
1. Baseline: run typecheck, lint and the full suite on the branch tip; record real counts (expected from STATE: 1489 pass).
2. Write the red tests: R2-16, R2-17 parts 2 and 3, R2-20, the R2-8 extension, and the R2-12 replacement (flip plus the effect rows). Run them; capture the real failure output (they must fail for the stated reason, not a typo). Commit red, message names the replacement of the R2-12 row.
3. Write the green-now guards: R2-17 part 1 (hazard instrument) and R2-19 (drift). Prove each can fail by a temporary mutation of the instrument input (self-test inside the test).
4. Implement the production change and comments; run the new tests green; run `R2-13`, `R2-6`, `R2-7`, G13b and the loader tests unmodified.
5. Spot mutants (recorded, each must be killed by the named test): M1 revert to all-markers-only (R2-16); M2 apply the allow branch to every effect (R2-13 and the R2-12 deny rows); M3 drop the empty-array case (R2-17 part 2); M4 replace the imported set with a retyped set (R2-8); M5 flip the subset direction so any catalog verb rejects (R2-12 and R2-6).
6. Full local gates: typecheck, lint, full `npm test`, the qa scripts named in `package.json` that CI runs (including reference resolver in diff mode against the base branch and the completeness-claim checker), secret scan, kernel and normalizer-registry purity; remove any agent worktrees first (process note).
7. Records: decisions row, changelog, header edits already done; `git diff --stat` proves the untouched list above; grep proves the three stale sentences are gone and the module no longer says the mixed case "can match".
8. PR skeleton: story, criteria checklist, constraints honored, evidence (raw counts), review chain required, human actions.

Verification of every criterion is in the section 5 table (each maps to a named test or a named command); the totals are read from the run, not typed.

Rollout and rollback: no flag (the gate is unwired; the check runs at policy load only). Rollback is a revert of the one function; a rule set that starts failing loads is corrected in its source, and the message names the layer and the fix. Availability note, stated: on the central layer a newly rejected rule fails the whole load until the out-of-session owner corrects it (whole-load rejection, ruled by the Manager in S7-B). Migration exposure: zero rules in either committed file (R2-10 prints the live counts).

## 8. Reviewers the tier calls for

- CRITICAL: `red-team` (one round expected; mandate: try to produce a rule the new check rejects that any normalizer-emitted record can match, i.e. the false-rejection class, plus any new bypass of the allow guard), `app-security-reviewer` (allow-widening closure, message text now names author values: quoting and bounding unchanged), and `cross-domain-reviewer` (always joins above TRIVIAL; seam: config-to-normalizer import direction, decisions and changelog accuracy). Never more than two domain reviewers.
- Fresh dated report(s) in `docs/reviews/` are required by the sensitive-area rule.
- `test-writer`: not dispatched (section 4). `design-challenger`: see section 9.

## 9. Design-challenger recommendation

None. Reasons: the design is a predicate change that two Manager rulings and a red-team report fully specify; it is not a first-of-its-kind shape (PRINCIPLES rule 15) and rests on no unmeasured number (rule 18; the one empirical fact was measured in the spike). The attack a design-challenger would run (does the check reject anything a real record can match) is executed by AC-334-4, AC-334-5 and R2-6, and again by red-team after the build. The Manager may still order one; if so, point it at the `allow-widening` branch, the only rejection that is a safety rule and not a reachability proof.

## 10. Blocking questions and non-blocking notes

Blocking: none.

Non-blocking, for the Manager:
1. AC numbering: the intake list was not in my input; section 5 numbers are mine (AC-334-7 as named).
2. The #335 rejection is a safety rule, not a "can never match" proof: an allow rule with no verbs on such a target CAN match a shell redirect record, which is the point. The header, the message and the decisions row say so; R2-6's "rejects nothing a normalizer emits" claim stays scoped to reachability, and I add whole-record allow rules to that drift so an emitted record used as an allow rule with its own verbs still loads.
3. Adjacent, not in this diff: an allow rule keyed on a presentable server target without a marker verb (rule-author fact 3) has the same shell-redirect exposure and still loads by ruling; propose a follow-up Issue for the Manager to file or decline. Also outside the diff: no-marker stray verb lists (backlog by ruling), Issue #332, and the LOW aggregate-message cap (R2-18).
4. Human decision pending after build: the decisions row for the R2-12 replacement (SE ADR-0005 reading), bundled with the S7-B rows.
