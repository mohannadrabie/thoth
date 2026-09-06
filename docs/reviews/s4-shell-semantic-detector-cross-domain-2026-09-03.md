# S4 - Shell-command semantic detector: cross-domain re-review (fix-now round, fresh whole-catalog pass)

**Target:** story-implementer's S4 fix-now round closing red-team/app-security-reviewer/architecture-reviewer's Stage-3 findings (Issues #68-#78), agent a40050257abcfbbcc. Diff has grown substantially since my 2026-09-02 pass (roughly 726 -> 1040+ lines changed): new .gitattributes, shell.ts/shell-scanner.ts/flag-catalog.ts/wrapper-catalog.ts all substantially rewritten (new collectResources/buildResourceTargets/extractRedirectTargets/findLiveTrailingSensitiveSeparator/walkQuoteState/hasUnterminatedQuote functions, normalizeShellCall split into a public wrapper plus unexported normalizeAtDepth).

**Why a fresh report, not an addendum to the 2026-09-02 one:** per the coordinator's instruction - the diff changed enough (multiple new functions, a materially different multi-resource/multi-redirect record shape) to warrant a full fresh whole-catalog pass, not just a re-confirm of my one original finding (Issue #79, already fixed and closed by the Manager directly). PRINCIPLES rule 11 (reports immutable, verification appended) governs my 2026-09-02 report; this is a new dated report for a new round, same as the other three lanes are each producing their own dated reconfirm reports this round.

**What the other three lanes have posted so far (checked docs/reviews/ directly before starting):**
- app-security-reviewer: s4-shell-semantic-detector-app-security-reconfirm-2026-09-03.md - APPROVE, both original findings (Issues #68/#69) confirmed fixed by independent re-run, plus a fresh bypass-hunt on the new logic (collectResources, extractRedirectTargets, findLiveTrailingSensitiveSeparator, the redirect-skip branch, the depth parameter) - one non-blocking LOW/SUSPICION found (cosmetic fabricated-resource pollution from an attached-form redirect), explicitly traced through kernel.ts's matchesTarget/matchRules and found only able to ADD a match, never remove one.
- architecture-reviewer: s4-shell-semantic-detector-architecture-reconfirm-2026-09-03.md - APPROVE, both owned findings (Issues #77/#78) confirmed closed, plus a fresh ADR-0021 "exactly one Action record" conformance check against the multi-resource/multi-redirect widening - still conforms, unchanged mechanism.
- red-team: no reconfirm report posted yet as of this pass (only the original 2026-09-02 no-go report exists) - proceeding independently rather than waiting, per the coordinator's instruction to do a fresh pass now.

## ADR cache

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) - re-pulled fresh via node docs/adr-cache.mjs --ensure this session. Read whole, unfiltered, same 35 entries as my 2026-09-02 pass (fingerprint unchanged - no ADR was added/amended between passes).

## Verification run (this session, claims checked against raw output, not trusted)

```
$ npm test 2>&1 | tail -8
tests 377
pass 377
fail 0
skipped 0
                                     <- matches claim (377/377)

$ npm run qa:mutation-shell
[QA-06 shell-detector-mutants] PASS: 40 of 40 mutant(s) KILLED.
                                     <- matches claim (40/40)

$ npm run qa:kernel-purity
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
$ npm run qa:normalizer-registry-purity
[QA normalizer-registry-purity-check] PASS: src/policy/normalizer/registry.ts: zero dispatch-chain/sibling-normalizer-import violations.
                                     <- both match claim (PASS)

$ git diff --stat -- src/policy/kernel/kernel.ts src/policy/normalizer/action-catalog.ts src/policy/normalizer/target-format.ts src/policy/normalizer/registry.ts
(empty output)                      <- confirms zero-diff claim

$ npm run typecheck   # clean, zero output
$ npm run lint         # clean, zero output

$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] FAIL: 1 of 3 file(s) had a failing completeness claim.
  - docs/STATE.md only (2 failing claims - the SAME pre-existing S3-era gap named in my 2026-09-02
    report, untouched by this diff - git diff --stat / git status confirm docs/STATE.md carries no
    change in this round either). docs/decisions.md now passes clean (Issue #79 fix confirmed).
```

All four of the coordinator's claims (377/377, 40/40 KILLED, both purity checks PASS, zero-diff to kernel.ts/action-catalog.ts/target-format.ts/registry.ts) are independently confirmed against raw output, not trusted from the dispatch message. Issue #79 (my own prior finding) is confirmed fixed - docs/decisions.md no longer fails QA-15. docs/STATE.md's failure is unchanged, still out of this diff's scope (same conclusion as my 2026-09-02 report), still not re-filed.

## Cross-domain ADR sweep (fresh, against the current diff)

Same method as my 2026-09-02 pass: whole 35-ADR catalog, checked against every ADR outside app-security/architecture/red-team's own lanes. No ADR was added or amended since my last pass (cache fingerprint unchanged), and this round's diff still touches zero infrastructure/IaC/cost/data-schema surface, so the devops ADRs (all 12) and the data ADRs (SE-0011-0015) remain N/A for the same reasons as before - not re-derived line by line here.

**SE ADR-0010 (code quality/maintainability gates, tags quality/process - outside all three lanes) - now CLEAN.** My 2026-09-02 Finding 1 (docs/decisions.md failing QA-15) is fixed and independently re-verified above. .github/workflows/ci.yml's qa:mutation-shell step (added last round) is unchanged in shape this round; still a required, non-continue-on-error step, still green (40/40).

**SE ADR-0006 (blast radius control) - re-checked given the size of this round's rewrite.** "MUST NOT widen a change's scope opportunistically" - every new function (collectResources, extractRedirectTargets, findLiveTrailingSensitiveSeparator, walkQuoteState, hasUnterminatedQuote, the module-internal depth split) is traceable to a specific named reviewer finding (Issues #68/#69/#70/#71/#72/#73/#74/#77/#78 per shell.ts's own updated header comment, cross-checked against each issue's title via gh issue list - all present, none invented). No unrelated refactor rode along. Clean.

**No new ADR collision found this round.** The rewrite added new pure functions inside the same two files (shell.ts, shell-scanner.ts) already inside architecture-reviewer's/app-security-reviewer's checked lane; nothing crossed into infra, data, or a new architectural layer.

## Seam-hunting (fresh pass against the larger rewrite)

### Finding 1 - kernel.ts's OR-across-targets rule matching (matchesTarget, S2-shipped, zero-diff, unchanged) was never audited against a MULTI-target ActionRecord until this round's fix - and a narrowly-scoped ALLOW rule can be bypassed to authorize an unrelated, unintended resource bundled into the same shell invocation

**The seam:** this round's fix for red-team's Issue #73 (only the first resource token was extracted, silently hiding a second mutation from policy) is real and correctly closes the UNDER-reporting direction - confirmed above, and independently confirmed by both app-security-reviewer's and architecture-reviewer's reconfirm passes. But the fix's OTHER side effect - ActionRecord.targets can now legitimately contain MULTIPLE distinct resources from ONE shell invocation, for the first time in this codebase's history - lands on top of kernel.ts's matchesTarget function (kernel.ts, unchanged since S2, explicitly zero-diff this round and confirmed as such above), which was written and reviewed when every normalizer only ever produced a SINGLE target per record.

matchesTarget's real, current logic (src/policy/kernel/kernel.ts, unchanged): a rule's target patterns are matched via action.targets.some(t => targets.some(pattern => ...)). action.targets.some(...) means a rule matches the WHOLE action if ANY ONE of its (now potentially multiple) targets satisfies the rule's pattern - and decide() (also unchanged) grants ALLOW for the entire action the instant any matched rule's effect is allow and no rule's effect is deny. Neither function evaluates targets independently; both were written for, and only ever exercised against, single-target records until this round.

**Demonstrated** (ran the real, current normalizeShellCall and the real, current decide() together - not a hypothetical):

```
$ node scratchpad_seam_test.mjs
rules: [{ id: "allow-pod-delete", effect: "allow", verbs: ["delete"],
          targets: ["prod-env/cluster/prod-cluster/pods/"], environments: ["prod-env"] }]
call: "kubectl delete pods/api secrets/db-creds --context=prod-cluster"

record: {"source":"parsed","verbs":["delete"],
  "targets":["prod-env/cluster/prod-cluster/pods/api","prod-env/cluster/prod-cluster/secrets/db-creds"],
  "environment":"prod-env","identity":"svc","deferred":false,"unresolved":[]}

verdict: {"outcome":"allow","reason":"allowed by rule allow-pod-delete","ruleId":"allow-pod-delete"}
```

A rule an operator writes to authorize ONLY pod deletion (targets: ["prod-env/cluster/prod-cluster/pods/"] - an ordinary, encouraged least-privilege pattern, the exact shape this whole project's policy model exists to make safe) grants ALLOW to a compound invocation that ALSO deletes secrets/db-creds, with the kernel's own verdict reason falsely claiming the secrets deletion was "allowed by rule allow-pod-delete" - a rule that was never written to cover secrets at all. This is the mirror image of Issue #73 (which hid a mutation from a DENY rule's view); this is a bundled, unrelated resource riding past scoping on an ALLOW rule's back.

**Why this is not the same thing app-security-reviewer already checked and cleared.** Their reconfirm pass (s4-shell-semantic-detector-app-security-reconfirm-2026-09-03.md, "Bypass-hunt pass on the new logic") explicitly traced through matchesTarget/matchRules and concluded: "it can only ever ADD a match, never remove one... could not construct a path where this extra fabricated target causes a real mutating action to escape a deny rule." That conclusion is correct and sufficient for the scenario they tested (a fabricated, garbage extra target from a redirect-parsing edge case, evaluated against the DENY direction only) - adding a match can only make a DENY rule MORE likely to fire, which is safe. But the same "can only ADD a match" mechanism is UNSAFE in the mirror direction they did not evaluate: adding a match also makes an ALLOW rule MORE likely to fire, and my demonstration uses a REAL, legitimately-shaped second resource (not a parsing artifact) to show that direction is exploitable. Their bypass-hunt scope and mine are the same code region, different security property (false-negative-on-deny vs. false-positive-on-allow) - not a duplicate finding.

**Why this fell in the seam between lanes:** app-security-reviewer checked this exact function and this exact mechanism, but from one direction only. architecture-reviewer's pass confirmed ADR-0021's "exactly one record, correctly array-typed" schema conformance - a true and separate property from whether the KERNEL's matching arity is sound against that array. red-team's original Finding 4 (Issue #73) is the under-reporting direction, already fixed; their reconfirm pass (not yet posted) may or may not independently reach this - but as of this pass, no report has closed the over-authorization direction. This is exactly why the standing cross-domain pass reads the WHOLE seam rather than trusting each lane's own scoped conclusion.

**Exposure:** requires (a) a governed environment with at least one ALLOW rule scoped by target pattern (an ordinary least-privilege authoring pattern this project's own policy model is built to encourage, not a contrived setup) and (b) a shell caller bundling an authorized resource with an unauthorized one in one invocation (trivial to do, no special syntax). Basis: demonstrated, against real shipped code. This is a security/policy-bypass category finding - per PRINCIPLES rule 21, security findings are exempt from the exposure-percentage cap regardless of stated reach; not gated on measuring how often operators author scoped allow rules or bundle resources.

**Reach today:** same reach=instrument calibration every other S4 finding across all four reports has applied (no hooks/ directory exists, no live session wires this normalizer to a real governed call yet - S5's job). Content severity is HIGH (policy engine authorization bypass, silent, the verdict's own stated reason is misleading) and, per every prior report's own established pattern for this exact reach caveat, becomes reach=user the instant S5 wires the hook - the defect itself will not have changed between now and then.

**Minimal fix - two options, not prescribing one (kernel.ts is currently a stated zero-diff invariant for this story; either resolving this within the normalizer or reopening that invariant is the Manager's call, not mine):**
1. Kernel-side (the more general, durable fix): change ALLOW-path matching to require EVERY element of action.targets to be covered by SOME matching allow rule (not just one target satisfying one rule) before the action as a whole resolves to allow - DENY can safely stay .some() (fail-closed direction, unaffected). This is a small, targeted change to matchesTarget's caller in decide(), not a rewrite - but it touches kernel.ts, breaking this story's own stated "zero diff to kernel.ts" commitment, which would need to be explicitly re-ruled, not silently crossed.
2. Normalizer-side (stays within S4's own stated scope): treat a MULTI-resource invocation itself as ambiguous and deny it via unresolved (the same "detect the shape, don't try to fully resolve it, fail closed" pattern already used for chain operators and command substitution), rather than fully resolving every bundled resource into targets. Notably, this is explicitly allowed by red-team's own original Finding 4 named test bar ("a multi-resource kubectl invocation reports every resource in targets, or reports unresolved" - the "or reports unresolved" branch was never taken).

**Named failing test (rule 19's own executable form):** decide() must not return allow for a multi-target ActionRecord when only a strict subset of its targets is covered by the matched allow rule's target patterns and no rule covers the remainder - e.g. the exact repro above (allow-pod-delete scoped to pods/, a call bundling pods/api + secrets/db-creds) must resolve to deny (or unresolved/fail-closed), not allow.

**Verdict: BREAKS.** This is a genuine, demonstrated authorization-bypass gap introduced by this round's own fix (the multi-resource collection did not exist before this round; the kernel code it now exercises differently was never re-examined for this new exercise pattern by any lane). Boundary-crossing carve-out applies (security-control bypass) - not discharged to the residual register regardless of reach=instrument's cap on content-severity-vs-priority framing.

## Coverage gaps named

- Red-team's own reconfirm pass has not landed yet as of this report. Given their original Finding 4 (Issue #73) is the closest existing finding to this seam (same code region, opposite direction), their reconfirm may independently surface this or a related angle - if it does, that is convergent evidence, not redundant noise (same reasoning I applied to red-team's Finding 6/8 in my 2026-09-02 report's addendum). Filed now regardless, since my own evidence is independently demonstrated and complete.
- No other file type or module in this round's diff is left unclaimed. The new pure functions are within app-security's/architecture's already-checked file set; .gitattributes is infra-adjacent but non-executable config, checked and clean (closes Issue #75 correctly, confirmed working with a deliberate CRLF re-break-and-retest by architecture-reviewer's own reconfirm, independently corroborated by my own clean npm run qa:mutation-shell run above).

## Editorial

- docs/backlog.md's new/updated entries (the env/xargs note updated to reflect xargs's now-permanent unresolved design, the two new backlog lines from Issues #76 and red-team's suspicion #9, architecture's suspicion #4) are accurate against the current code and issue set - cross-checked.
- CHANGELOG.md's qa-mutation-shell marker is now expect=40, matching the current mutant count exactly (confirmed by the raw PASS output above).

## Verdict

**REWORK.** One new, demonstrated, HIGH-severity finding (Finding 1 above) - a real authorization-bypass path this round's own multi-resource fix opened up in composition with unchanged kernel code, not caught by either lane whose report already exists for this round. My 2026-09-02 finding (Issue #79) is confirmed fixed. No other new gap found in the fresh ADR sweep or the rest of the seam-hunt.

**Single next action:** story-implementer (or the Manager, since this touches the "zero diff to kernel.ts" invariant) decides between the two fix options above and lands a named failing test proving the fix before this story returns to review; red-team's still-pending reconfirm pass should also independently check this exact seam once it lands, since their Finding 4 is the closest existing evidence trail to it.

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] src/policy/kernel/kernel.ts's matchesTarget (OR-across-targets, unchanged since S2) composes unsafely with S4's new multi-resource ActionRecord.targets: a narrowly-scoped ALLOW rule (e.g. targets:["prod/.../pods/"]) grants ALLOW to a compound invocation that also deletes an unrelated, unauthorized resource (e.g. secrets/db-creds) bundled into the same shell call - demonstrated live against the real kernel.decide(). Fix: require ALL targets covered for allow (kernel-side) or deny multi-resource calls via unresolved (normalizer-side, already within red-team's own Finding 4 named-test bar).
2. [CLEAN][demonstrated] Coordinator's four claims independently re-verified: npm test 377/377, qa:mutation-shell 40/40 KILLED, qa:kernel-purity PASS, qa:normalizer-registry-purity PASS, zero-diff to kernel.ts/action-catalog.ts/target-format.ts/registry.ts confirmed via git diff --stat (empty).
3. [CLEAN][demonstrated] My own prior finding (Issue #79, QA-15/decisions.md) confirmed fixed - docs/decisions.md now passes the completeness-claim-checker cleanly.
4. [CLEAN][code-traced] SE ADR-0010 clean this round (Finding 1 above is a seam finding, not an ADR collision); SE ADR-0006 (blast radius, no opportunistic scope widening) checked against every new function in this round's diff, each traced to a specific reviewer-filed Issue.
5. [CLEAN][code-traced] docs/STATE.md's pre-existing QA-15 failure remains unchanged and out of this diff's scope, same conclusion as the 2026-09-02 report - not re-filed.
6. [CLEAN][code-traced] No new ADR collision found outside app-security/architecture/red-team's lanes; no ADR added/amended since the last pass (cache fingerprint unchanged).
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=4 code-traced=3 derived=0
checks=377 pass/0 fail/0 skipped (npm test); typecheck clean; lint clean; qa:mutation-shell 40/40 killed; qa:kernel-purity PASS; qa:normalizer-registry-purity PASS; QA-15 FAIL (docs/STATE.md only, pre-existing, out of scope) / docs/decisions.md now clean
adr=HIT(35, whole catalog)
report=docs/reviews/s4-shell-semantic-detector-cross-domain-2026-09-03.md
