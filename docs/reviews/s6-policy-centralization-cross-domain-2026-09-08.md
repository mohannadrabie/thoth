# S6 "Policy Centralization" — Cross-Domain Review (Ra)

**Scope:** S6 built diff (Milestone #24, "Policy centralization"), uncommitted working tree — `src/policy/config/{central-source,position-parser,loader,pin,printer,print-cli}.ts` (+tests), `src/policy/rule/precedence.ts`'s `mergeLayersWithMandatoryLock`, `src/policy/kernel/rule-types.ts`'s `mandatory` field, `src/policy/rule/schema.ts`, `src/policy/config/shipped-defaults.json`, `.thoth/policy.json`, `REQUIREMENTS.md`'s T10 row, `docs/backlog.md`'s 3 new S6 lines, `CHANGELOG.md`. **Tier:** CRITICAL. **Reviewer:** cross-domain-reviewer (Ra). **Date:** 2026-09-08.

**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, approx 17300 tokens saved this pass (fp 83b2e3e). Per this role's own step, the WHOLE catalog was read (not filtered to any one lane's applicableTo slice).

## Who else ran, and what ground they covered

Per docs/REVIEW_LOG.md and docs/.maat-state.json: design-challenger and architecture-reviewer both reviewed the plan pre-build (verdicts go / APPROVE-WITH-CONDITIONS, all findings folded into plan v2). **app-security-reviewer already reviewed this actual built diff** (verdict APPROVE, docs/reviews/s6-policy-centralization-app-security-2026-09-08.md -- its REVIEW_LOG.md row appeared between my own initial read of that log and this round's append, i.e. it ran concurrently with this pass, not before it) -- I read it in full before finalizing this report. Its domain slice (authn/authz, input handling, secrets, dependencies, data exposure) covered subprocess-injection-safety, fail-closed correctness, the discriminated-union/single-read-invariant structural fixes, prototype-pollution/duplicate-JSON-key/id-case-folding bypass classes, and secrets/data-exposure -- confirmed CLEAN across 10 findings plus 2 LOW hardening suspicions (id-normalization; disclosed single-line-REG_SZ assumption, traced to fail closed in the worst case), all demonstrated/code-traced, none overlapping the finding below. **red-team has not yet run against this diff** -- no red-team S6 report exists in docs/reviews/ as of this pass, confirmed via ls docs/reviews | grep -i s6. I independently re-ran the real test suite, typecheck, lint, and kernel-purity gate myself rather than trusting either build-session or reviewer claims, and wrote one small reproduction script to test a specific hypothesis app-security-reviewer's own lane did not cover (below) -- this is demonstrated evidence, not merely code-traced.

## What I ran

```
$ node --test src/policy/config/*.test.ts src/policy/rule/precedence.test.ts src/policy/rule/schema.test.ts
tests 84 / pass 84 / fail 0 / cancelled 0 / skipped 0 / todo 0

$ npm run typecheck   -> clean (tsc --noEmit, no output, exit 0)
$ npm run lint        -> clean (eslint ., no output, exit 0) -- CONTRADICTS CHANGELOG.md's/decisions.md's
                         claim of one pre-existing failure at printer.test.ts:399 (see Editorial)
$ npm run qa:kernel-purity              -> PASS: 4 production .ts file(s) under src/policy/kernel/, 0 violations
$ npm run qa:normalizer-registry-purity -> PASS: 0 dispatch-chain/sibling-normalizer-import violations
$ git status --porcelain -- hooks/                          -> empty (Q2's "hook not rewired" ruling holds)
$ git status --porcelain | grep -i classification            -> empty (S3's tool-classification mechanism untouched)
$ git diff package.json                                      -> one new npm script only, zero new dependencies
```

Plus a targeted repro (own script, real printEffectivePolicy() call, real fixtures) proving the finding below.

## Cross-domain ADR verdict -- whole catalog

| ADR | Verdict | Note |
|---|---|---|
| SE ADR-0021 (kernel purity, POL-05/07/11) | CONFORMS | qa:kernel-purity re-run clean. Rule.mandatory is invisible to kernel.ts's decide()/pol05Rule()/isMutating() -- read directly: none of those functions reference mandatory, only verbs/targets/environments/effect/rationale/id via matchRules. No risk of the new field silently widening what the kernel branches on. |
| SE ADR-0002 (layer boundary/DI) | CONFORMS | CentralPolicySource is an interface at the config-layer seam; no vendor/SDK type crosses into kernel.ts or rule-types.ts. |
| SE ADR-0003 (constructor-injected I/O) | CONFORMS | Traced every construction site: print-cli.ts builds defaultCentralPolicySource once and passes it as a parameter into printEffectivePolicy(); printer.ts never instantiates a CentralPolicySource itself, only accepts one via PrinterInput; loader.ts likewise takes centralSource as an input field. No inline instantiation inside business logic anywhere in the four new modules. |
| SE ADR-0006 (no opportunistic scope-widening) | CONFORMS | git status --porcelain -- hooks/ is empty -- hooks/pretooluse-kernel-gate.mjs genuinely untouched, matching Q2's ruling exactly. mergeLayers left byte-identical (only a new doc comment added above it), same signature, same three pre-existing test call sites all still pass unmodified. |
| SE ADR-0010 (no new dependency without justification) | CONFORMS | git diff package.json shows exactly one new npm script (policy:print) and zero dependency/devDependency changes. |
| SE ADR-0001 (ADR process) | CONFORMS | New code's header comments cite governing POL-IDs and SE ADR numbers at every architectural seam. |
| SE ADR-0004/0005/0011-0015 (idempotency, data/DB, Playwright) | NOT-APPLICABLE | Read-only path, no mutation, no database, no UI flow -- confirmed by inspection, matches both pre-build reviewers' own disposition. |
| SE ADR-0009 (observability) | NOT-APPLICABLE (by convention) | print-cli.ts is a manually-invoked diagnostic CLI, not a new service/endpoint; matches this repo's own qa:* script convention. |
| Devops ADR-0001-0010 | NOT-APPLICABLE | No AWS/IaC files touched anywhere in this diff. |
| SE ADR-0016/0018/0019/0020 (porting/self-protection) | NOT-TRIGGERED | No maat-legacy porting activity in this diff. |
| SE ADR-0017 | SUPERSEDED, not applicable. | |

No ADR collision found outside the lanes the pre-build reviewers already covered (their domain slice was, unusually, the whole architecture/security/code/data/quality/reliability set -- a wide slice for a STANDARD reviewer, by design for this novel-shape story). The gap is not an uncovered ADR; it's that Stage 3's dedicated ADVERSARIAL pass (red-team) hasn't happened yet -- app-security-reviewer's own Stage-3 subprocess-trust pass already ran clean (see Coverage gaps).

## Seam findings

### 1. [ISSUE][MED][demonstrated] printer.ts's origin-line lookup reports the WRONG line when one layer's own file defines the same rule id twice -- schema.ts never rejects the duplicate, precedence.ts's merge silently keeps the last one, printer.ts's findIndex silently reports the first one's line

**The seam:** three new modules built together in this same diff each made a locally-reasonable assumption that the others don't actually guarantee: schema.ts (POL-06) checks every rule's fields but never checks id-uniqueness within one RuleSet; precedence.ts's mergeLayersById (pre-existing, inherited by the new mergeLayersWithMandatoryLock) resolves a same-layer duplicate id by silent last-write-wins (byId.set() overwrites on each occurrence); printer.ts's renderSuccess() then looks up "which line did the winning rule open on" via layer.ruleSet.rules.findIndex((r) => r.id === rule.id) -- findIndex returns the FIRST match, not the one whose VALUE actually won the merge. No single module is wrong in isolation; the combination is.

**Demonstrated** (own script, real printEffectivePolicy(), real fixture -- not simulated):
```
// central layer's raw JSON (pretty-printed, 2-space indent):
//  4:     {
//  5:       "id": "dup",
//  6:       "effect": "allow"
//  7:     },
//  8:     {
//  9:       "id": "dup",
// 10:       "effect": "deny",
// 11:       "rationale": "the real winning one"
// 12:     }
const result = printEffectivePolicy({ shippedDefaultsPath, projectPolicyPath, centralSource });
// => "rule id=dup effect=deny layer=central origin=test-channel line=4 mandatory=false"
```
effect=deny is correctly the winning (second, line-8) rule's value. line=4 is the FIRST (line-4) rule's opening brace -- the wrong object. An operator running policy:print to answer "why is this blocked" (POL-10's entire acceptance bar) who trusts line=4 and opens their editor there finds the allow rule, not the deny rule that's actually in effect -- exactly the "operator trusts a wrong line number, edits the wrong rule" failure design-challenger's Attack E named as the top-ranked risk category for this printer, but from a different root cause than Attack E considered (Attack E covered tokenizer CRLF/escape/non-ASCII edge cases; this is a validation gap one layer up, in the id-uniqueness space, that Attack E's tokenizer-focused scope didn't reach). Confirmed untested: grep -n -i "duplicat" src/policy/config/*.test.ts src/policy/rule/*.test.ts -> no matches.

**Exposure:** ~0% today, basis: counted in code (shipped-defaults.json and .thoth/policy.json are both real, git-tracked, verified-empty rules: [] placeholders -- content-authoring is explicitly out of S6's scope per the ratified intake). Not exempt from the percentage cap the way POL-07/POL-09 findings are (POL-10 is an inspectability/observability mechanism, not itself an authorization-boundary enforcement point) -- but this is not an assumption-basis exposure claim either (I read the actual placeholder file contents), so it does not cap at LOW; MED holds on reach=operator, likelihood=routine (a duplicate id within one hand-authored file is an ordinary copy-paste-shaped authoring mistake, not a contrived edge case -- the same class of mistake POL-06's "unknown key is an error, not a silent no-op" ethos already exists to catch for other fields).

**Minimal fix:** add one check to validateRuleSet() in src/policy/rule/schema.ts -- track seen ids in a Set while iterating input.rules, emit a ValidationError naming the duplicate id and its first/second index (same shape as every other error this function already produces) the moment a repeat is found. This closes the gap at its root (POL-06's own validation layer) rather than patching printer.ts's lookup -- consistent with "one merge core, one validation layer" discipline this diff already established elsewhere (architecture-reviewer finding 1). A single schema.test.ts case (duplicate id within one layer -> rejected) is the matching failing test.

### 2. [CLEAN][code-traced] mergeLayersWithMandatoryLock's composition with the kernel's POL-05 fail-closed rule -- no interaction, by design

Traced kernel.ts's decide()/pol05Rule()/isMutating()/matchRules() in full: none references Rule.mandatory. The kernel consumes an already-merged RuleSet (WorldFacts.rules) purely by verbs/targets/environments/effect/rationale/id -- POL-05's opaque-source/unresolved-field check is evaluated entirely from the ActionRecord, never from rule content. mandatory is fully resolved and discarded before any rule reaches the kernel's matching logic (in fact, S6 doesn't wire the loader's output into the kernel at all yet -- Q2's ruling). No divergence risk between POL-05 and the new mandatory-lock mechanism exists, because they operate on disjoint inputs at disjoint pipeline stages.

### 3. [CLEAN][code-traced] The three mergeLayersById consumers (mergeLayers, mergeLayersWithMandatoryLock, mergeToolClassificationLayers) stay consistent where they need to be, and diverge only where the ratified scope says they should

All three call the identical shared core (mergeLayersById) for order/last-write-wins-by-key semantics -- verified by reading precedence.ts in full, not by trusting the header comments' own claim. mergeLayersWithMandatoryLock adds exactly one new behavior (the lock-check pass) layered around the shared core, never re-implementing it -- matching architecture-reviewer's pre-build finding 1's prescribed shape, confirmed built as specified. mergeToolClassificationLayers (S3, ToolClassificationEntry, two-tier) correctly has NO mandatory-lock semantics at all -- ToolClassificationEntry carries no mandatory field, so there is nothing for a lock check to inspect; this is the correct absence, not a gap. No drift found between the three consumers' shared behavior.

### 4. [CLEAN][code-traced] POL-10's printer correctly does NOT surface S3's tool-classification layer, and this is the right scope line, not an oversight

printer.ts renders MergedRuleSet (POL-08's rule-precedence output) only; it has no import of, or reference to, mergeToolClassificationLayers/MergedToolClassificationSet. These are genuinely two different data shapes serving two different acceptance criteria (POL-10 names "origin file and line of every RULE"; the tool-classification catalog is a different mechanism entirely, out of scope per the plan's own explicit "no gold-plating, Issue #93 stays out of scope" note). Confirmed this is deliberate, not accidental, by checking git status --porcelain | grep -i classification returns empty -- nothing in that mechanism was touched.

### 5. [CLEAN][code-traced] Subprocess safety -- first-time diligence in this codebase, reasonably shaped even before app-security-reviewer's dedicated pass

central-source.ts's execFileSync call: bounded timeout (5000ms), maxBuffer (1MB), windowsHide: true, argv passed as an array (never string-interpolated into a shell command), no shell: true anywhere. REGISTRY_KEY_PATH/REGISTRY_VALUE_NAME are hardcoded module constants, not derived from any external/session input -- there is no injection surface reachable from a governed session's own action. This is a reasonable first pass, independently corroborated by app-security-reviewer's own dedicated Stage-3 pass (verdict APPROVE, findings 1-3 of that report) -- I did not attempt to adversarially defeat it myself, only confirm the shape is not obviously unsafe; red-team's still-pending pass is the one that would.

## Coverage gaps (named, not necessarily defects)

1. **red-team has not yet run against this actual built diff** (no S6 red-team report exists in docs/reviews/ as of this pass). app-security-reviewer HAS now run (verdict APPROVE, see "Who else ran" above) -- its dedicated subprocess-injection-safety scrutiny (the plan's own explicitly-named first-time-diligence concern) is discharged, superseding my own finding 5 below as the authoritative check on that specific question (mine stands as an independent corroborating check, not the primary one). Adversarial red-team scrutiny of this diff is still the one outstanding Stage-3 pass named in the plan's own section 8 reviewer table.
2. **The human-owned real-registry write/provisioning round-trip** (plan section 3a point 3: a real admin-provisioned HKLM\SOFTWARE\Policies\Thoth\CentralPolicyJson value, written by a real elevated process, read back end-to-end) remains unexercised, exactly as central-source.ts's own header discloses. Not a defect -- a named, disclosed, human-owned gap, unchanged in kind from the pre-build report, only narrower now (the read+parse path is real-byte-tested this session).
3. **.thoth/halt-state/*.json test-artifact files** sitting untracked in the working tree (confirmed .gitignore's .thoth/halt-state/ entry covers them) are pre-existing S5 leftovers, not touched by this diff -- correctly out of this review's scope, named so a future reader doesn't mistake them for part of the S6 diff.
4. **CHANGELOG.md/docs/decisions.md's "known lint failure at printer.test.ts:399" claim is stale** -- npm run lint runs clean (exit 0) as of this review. Either the file was fixed after that prose was written without the prose being updated, or the original claim was itself imprecise (no no-unnecessary-type-assertion rule is even configured in eslint.config.mjs, and no matching assertion was found at that line). This is a prose accuracy issue, not a code defect -- routed to Editorial, not a blocking finding, per this role's evidence policy.

## Editorial (non-blocking, no re-review needed)

- CHANGELOG.md's S6 entry and docs/decisions.md's "S6 Phase 2 build complete" row both assert "npm run lint fails on ONE pre-existing, unnecessary-type-assertion error inside printer.test.ts line 399" -- independently re-run, npm run lint is clean (exit 0). Fix: either strike that sentence (if the fix genuinely landed after the claim was written) or correct it to name the real current gap, if any. No finding severity changes either way -- this is prose, not code.

## Process hygiene

- docs/REVIEW_LOG.md: current through the pre-build rounds; this round's row appended below by me.
- docs/decisions.md: 2026-09-08 rows accurately reflect what was ruled -- intake NEEDS-INFO ruling, Phase 1 plan ratification (3 blocking questions), pre-build review folding (section 4a option (a) chosen), and Phase 2 build-complete row all cross-checked directly against the code and each matches (T10 row, backlog lines, mandatory-lock composition, single-read invariant, discriminated-union return shape, AC9 whole-layer-rejection granularity -- all present in the code exactly as the decisions.md rows describe).
- docs/.maat-state.json: scope "s6", tier "CRITICAL", reviewRoundsSinceClean 0, humanRulingRequired false, councilHeld false -- consistent with S6 being the active, non-stalled story; priorScope correctly closes out S5's council GO. No inconsistency found.

## Verdict

**APPROVE-WITH-CONDITIONS.** No ADR collision, no cross-domain seam break in the kernel-purity/DI/scope-widening/dependency lanes. One genuine, demonstrated MED-severity defect (finding 1) in the new POL-10 printer's own trust promise -- narrow blast radius today (0% exposure, placeholder content only), clean minimal fix (one validateRuleSet() check), does not require reopening any of this story's architecture. Condition: fix finding 1 (schema-level duplicate-id rejection) before this diff is considered done, with the one named failing test below. app-security-reviewer's Stage-3 pass already ran clean (verdict APPROVE); red-team is the one remaining Stage-3 pass named in the plan's own reviewer table, independent of this finding.

## Findings vs. failing tests

Open findings: 1 ([ISSUE][MED], finding 1). Failing tests: 1 -- schema.test.ts: "validateRuleSet: a duplicate rule id within one rule set is rejected, naming both indices" (not yet written; this is the named test finding 1's minimal fix implies). Counts match.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][MED][demonstrated] src/policy/config/printer.ts's renderSuccess() findIndex-based origin-line lookup reports the FIRST same-id rule's line while the merge silently keeps the LAST one's value when one layer's own file defines a duplicate id -- schema.ts (src/policy/rule/schema.ts) never rejects the duplicate; minimal fix: reject duplicate ids in validateRuleSet()
2. [CLEAN][code-traced] mergeLayersWithMandatoryLock vs. kernel.ts's POL-05 fail-closed rule -- no interaction, disjoint inputs/pipeline stages, kernel never reads Rule.mandatory
3. [CLEAN][code-traced] mergeLayers / mergeLayersWithMandatoryLock / mergeToolClassificationLayers -- all three share mergeLayersById correctly, diverge only where the ratified scope says they should
4. [CLEAN][code-traced] POL-10 printer correctly excludes S3's tool-classification layer -- different mechanism, out of scope per the plan's own no-gold-plating note, confirmed untouched
5. [CLEAN][code-traced] central-source.ts subprocess call shape (bounded timeout, output cap, windowsHide, no shell interpolation) -- reasonable first pass, independently corroborated by app-security-reviewer's own dedicated Stage-3 pass (verdict APPROVE, see Who else ran)
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=4
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=1 code-traced=4 derived=0
checks=node --test src/policy/config/*.test.ts src/policy/rule/precedence.test.ts src/policy/rule/schema.test.ts: 84 pass/0 fail/0 skip; npm run typecheck: clean; npm run lint: clean; npm run qa:kernel-purity: PASS; npm run qa:normalizer-registry-purity: PASS
adr=HIT(35, whole catalog)
report=docs/reviews/s6-policy-centralization-cross-domain-2026-09-08.md
