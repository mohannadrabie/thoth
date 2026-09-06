# S4 - Shell-command semantic detector: cross-domain re-review (round 3, post-council fix-now)

**Target:** story-implementer's round-3 fix-now closing Issue #82 (my own round-2 finding), Issue #80 (red-team round-2 Finding N1), and Issue #81 (red-team round-2 Finding N2), per the council's GO ruling on Path B (docs/reviews/s4-shell-semantic-detector-council-path-forward-2026-09-03.md, docs/decisions.md's 2026-09-03 row).

**Scope of this pass, per the coordinator's instruction:** (1) re-verify Issue #82's fix against my own original repro AND impact-analyst's sharper compound PoC, independently; (2) check whether the wrapper-recursion path (my own round-2 seam) can still construct a multi-target record that reaches the kernel; (3) re-run the coordinator's three claims (403/403 tests, 46/46 mutants, zero-diff to kernel.ts/action-catalog.ts/target-format.ts/registry.ts) against raw output; (4) a fresh whole-catalog ADR sweep on the delta since my last pass; (5) close Issue #82 once confirmed.

**Council context read directly (not summarized secondhand):** docs/reviews/s4-shell-semantic-detector-council-path-forward-2026-09-03.md and docs/decisions.md's 2026-09-03 row, including the recorded dissent - impact-analyst preferred a kernel-side matchesTarget fix (Path A, "mathematically a no-op" on existing tests, retires the general risk); the Manager ruled for architecture-reviewer's normalizer-only path (Path B) instead, to honor S4's already-ratified zero-diff-to-kernel.ts scope (ADR-0006's no-opportunistic-scope-widening clause). The general kernel-layer question (what an ALLOW rule means against a multi-target ActionRecord) is recorded, not solved - confirmed present in docs/backlog.md, checked below.

## ADR cache

ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) - re-pulled fresh via node docs/adr-cache.mjs --ensure this session. Fingerprint unchanged since my last two passes - no ADR added or amended.

## Coordinator's three claims - independently re-verified against raw output

```
$ npm test 2>&1 | tail -6
tests 403
pass 403
fail 0
skipped 0
                                     <- matches claim (403/403)

$ node src/qa/shell-detector-mutants.ts
[QA-06 shell-detector-mutants] PASS: 46 of 46 mutant(s) KILLED.
                                     <- matches claim (46/46)

$ git diff --stat -- src/policy/kernel/kernel.ts src/policy/normalizer/action-catalog.ts src/policy/normalizer/target-format.ts src/policy/normalizer/registry.ts
(empty output)                      <- confirms zero-diff claim, still holds
```

All three claims confirmed against raw output, not trusted from the dispatch message.

## Issue #82 fix - independently re-verified, including impact-analyst's PoC and the wrapper-recursion seam

**The fix, read directly (src/policy/normalizer/shell.ts:378-391):** resolveKubectlShape now computes assembledTargetCount = resourceTargets.length + redirectTargets.length - combining BOTH collection paths, not resource-token count alone - and denies wholesale via unresolved whenever that sum reaches 2 or more, before kernel.ts ever sees the record. The "not kubectl attempted" bare-write branch (line 350-363) has its own equivalent redirectTargets.length >= 2 check, consistent with the same rule for the case where there are no resources to combine with. This matches the council-ruled Path B exactly, including the broadening impact-analyst's condition required.

**Re-ran my own original #82 repro, impact-analyst's compound PoC, the wrapper-recursion seam I flagged in round 2, and four sanity/edge cases - independently, against the live current code, using the same realistic allow-rule scenario as my round-2 demonstration (targets:["prod-env/cluster/prod-cluster/pods/"]):**

```
1. original #82 repro (two resource tokens: pods/api + secrets/db-creds)
   verdict: deny (POL-05, "command assembles 2 targets - denied wholesale ... (Issue #82)")

2. impact-analyst PoC (ONE resource token + ONE unquoted redirect: pods/api > /etc/cron.d/pwn)
   verdict: deny (POL-05, "command assembles 2 targets - denied wholesale ... (Issue #82)")
   <- confirms the BROADENED guard catches the sharper instance a naive resource-token-count
      check would have missed, exactly as council required.

3. wrapper-recursion: bash -c wrapping the impact-analyst shape
   command: bash -c "kubectl delete pods/api --context=prod-cluster > /etc/cron.d/pwn"
   verdict: deny (POL-05, same message), deferred:true correctly propagated from the recursive call

4. wrapper-recursion: eval wrapping two resource tokens
   command: eval "kubectl delete pods/api secrets/db-creds --context=prod-cluster"
   verdict: deny (POL-05, same message), deferred:true correctly propagated

5. sanity: single resource, no redirect - still resolves cleanly and is ALLOWED by the scoped rule
   (confirms the fix is not over-broad - a genuinely single-target case is unaffected)

6. sanity: fd-dup ampersand idiom (2>&1) on a single-resource call - resolves to a clean
   single-target record, no false multi-target deny, no false chain-operator deny (Issue #81
   composes correctly with the new Issue #82 guard)

7. two redirects, no kubectl resource at all (bare-write branch's own guard)
   command: cat file1 > /tmp/a > /tmp/b
   verdict: deny (POL-05, "command assembles 2 targets ...")

8. one resource + two redirects (assembledTargetCount = 3)
   command: kubectl delete pods/api --context=prod-cluster > /tmp/a > /tmp/b
   verdict: deny (POL-05, "command assembles 3 targets ...")

9. a quoted literal ">" positional argument + one resource + one live redirect - confirms
   Issue #80's position-based operator exclusion does not reintroduce a bypass here either
   command: kubectl delete pods/api --context=prod-cluster ">" > /tmp/out
   verdict: deny (POL-05, "command assembles 2 targets ...")
```

All nine cases behave exactly as expected: every multi-target-assembling shape denies, through EVERY path that can produce one (direct kubectl-shape, the bare-write shape, and recursion through both a bash -c and an eval wrapper), and the single-target/fd-dup sanity cases confirm the fix is not over-broad. The wrapper-recursion seam I flagged as an open question in my round-2 report is closed: the assembledTargetCount guard fires inside normalizeAtDepth at WHATEVER depth the multi-target assembly actually happens (resolveWrapperMatch never merges an outer wrapper's own targets with an inner call's targets - it delegates wholesale, so the inner call's own guard is the only one that ever needs to fire, and it does).

**Issue #82: CLOSED.** Confirmed genuinely fixed, not merely claimed - by independent re-run against the live code, covering my own original repro, impact-analyst's sharper compound PoC, and the wrapper-recursion seam I flagged as open in my round-2 report. Closing now (state_reason: completed) per the coordinator's instruction.

## Fresh whole-catalog ADR sweep (delta since my 2026-09-03 pass)

Same method as prior passes: whole 35-ADR catalog, checked against every ADR outside app-security/architecture/red-team's own lanes. Cache fingerprint unchanged (no ADR added/amended). This round's delta is small and fully contained within src/policy/normalizer/{shell,shell-scanner}.ts plus their tests, the mutant list, and docs (backlog.md, decisions.md, CHANGELOG.md) - no new infrastructure, data, or architectural-layer surface.

**SE ADR-0006 (blast radius control, "MUST NOT widen a change's scope opportunistically") - re-checked given this is now three rounds of rewrite on the same two files.** Every line of this round's delta traces to a specific council-approved item (Issue #80's position-based redirect fix, Issue #81's fd-dup exclusion, Issue #82's assembled-target-count guard) or to the recorded backlog item documenting the deferred kernel-layer question - cross-checked against shell.ts's own updated header comment (items 8-10) and docs/backlog.md's new entry, both consistent with the council brief and decisions.md's ruling. No unrelated refactor rode along. Still the deliberately normalizer-only shape the council ruled - kernel.ts, action-catalog.ts, target-format.ts, and registry.ts all remain zero-diff, confirmed above.

**SE ADR-0010 (code quality gates) - still clean.** docs/decisions.md still passes QA-15; the pre-existing docs/STATE.md gap is unchanged and still out of this diff's scope (same conclusion as both prior passes - not re-derived line by line here). CHANGELOG.md's qa-mutation-shell marker is correctly updated to expect=46, matching the confirmed 46/46 KILLED count exactly.

**No new ADR collision found.** Nothing in this round's delta crosses into infra, data, or a new architectural layer; the two files touched are already inside app-security-reviewer's and architecture-reviewer's own checked lane for this exact round (both posted APPROVE-equivalent verdicts on this precise delta before this report - checked their reconfirm/council-seat reports directly, not summarized).

## Coverage gaps named

- The council's own recorded NOT-COVERED architectural question (what an ALLOW rule means against a multi-target ActionRecord in general, kernel.ts's matchesTarget/matchesVerb OR-across-facet semantics) is confirmed present in docs/backlog.md, worded consistently with the council brief and the decisions.md ruling - not silently dropped between the ruling and the build. This is the correct disposition per the council's own GO terms; not re-opened here.
- No other file type or module in this round's delta is left unclaimed - the two touched files and their tests are inside the other lanes' already-checked scope for this exact round.

## Verdict

**APPROVE.** Issue #82 (my own finding) is genuinely closed - independently re-verified against my own original repro, impact-analyst's sharper compound PoC, and the wrapper-recursion seam I raised in round 2, across nine total test cases including sanity/edge checks. The council's ruled path (Path B, broadened) is faithfully implemented, not merely claimed. No new ADR collision or seam gap found in this round's delta. This closes my own participation in this review loop for the current diff, pending any further round.

**Single next action:** close Issue #82 (state_reason: completed) - done, this pass. Story proceeds per the council's GO terms: gating verification (already re-run above) was build task #1 of this round.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [CLEAN][demonstrated] Issue #82 (my own round-2 HIGH finding) confirmed genuinely fixed - independent re-run of my original repro, impact-analyst's compound PoC, and the wrapper-recursion seam (bash -c and eval), all correctly deny; single-target and fd-dup sanity cases confirm the fix is not over-broad. Closed.
2. [CLEAN][demonstrated] Coordinator's three claims independently re-verified: npm test 403/403, qa:mutation-shell 46/46 KILLED, zero-diff to kernel.ts/action-catalog.ts/target-format.ts/registry.ts confirmed via git diff --stat (empty).
3. [CLEAN][code-traced] Council's recorded NOT-COVERED architectural question (kernel-layer ALLOW-arity question) confirmed present in docs/backlog.md, worded consistently with the ruling - not silently dropped.
4. [CLEAN][code-traced] SE ADR-0006 (no opportunistic scope widening) holds - every line of this round's delta traces to a specific council-approved item; SE ADR-0010 (quality gates) still clean, CHANGELOG marker correctly updated to expect=46.
5. [CLEAN][code-traced] No new ADR collision found outside the three lanes' domains; no ADR added/amended since the last pass (cache fingerprint unchanged).
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=0 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=3 derived=0
checks=403 pass/0 fail/0 skipped (npm test); qa:mutation-shell 46/46 killed; zero-diff to kernel.ts/action-catalog.ts/target-format.ts/registry.ts confirmed empty; QA-15 FAIL (docs/STATE.md only, pre-existing, out of scope) / docs/decisions.md clean; 9 independent adversarial re-verification cases run against live code, all correct
adr=HIT(35, whole catalog)
report=docs/reviews/s4-shell-semantic-detector-cross-domain-2026-09-04.md
