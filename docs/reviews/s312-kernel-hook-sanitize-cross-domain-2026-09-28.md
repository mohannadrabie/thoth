# Cross-Domain Review -- s312-kernel-hook-sanitize (PR #358)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-28
**Scope:** Issue #312 -- sanitize the kernel verdict reason and the PreToolUse gate hook's deny output (second, currently-unwired site of the #294 terminal-spoofing defect class).
**PR:** #358, story/312-kernel-hook-sanitize -> master, base origin/master at 4f5df2f (branch cut from c2750a2).
**Tier:** CRITICAL (ratified, run-log tier-ratified, s312-kernel-hook-sanitize, unchanged proposed->ratified).

## Who ran alongside me

Per the task brief: red-team (adversarial) and app-security-reviewer (authz/injection/deps) are the CRITICAL-tier domain reviewers on this same PR, in parallel. No dated report from either existed in docs/reviews/ at the time of this pass (ls docs/reviews | grep -i 312 empty), so this report has nothing to de-duplicate against yet. Their ground: the sanitization logic's correctness against hostile policy-authored text, the purity-boundary (G15/kernel-purity-check) discipline, and the fail-closed/empty-after-sanitize behavior. My job starts where their lane stops: the whole ADR catalog (unfiltered), and the seams between this change and the rest of the project's bookkeeping/process.

## ADR cache

node docs/adr-cache.mjs --ensure initially reported adr/devops:0, adr/software-engineering:0 -- the adr git submodule was uninitialized in this worktree. Ran git submodule update --init --recursive, re-ran the ensure:

```
[ADR cache] BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]
```

Read the full, unfiltered adrCatalog.adrs (37 entries, both domain folders plus docs/adr/'s two THOTH ADRs) from docs/.maat-state.json.

## Cross-domain ADR verdict (whole catalog, checked against the diff's changed files)

Diff touches only: hooks/pretooluse-kernel-gate.mjs, src/policy/gate/render-hook-output.ts, hooks/pretooluse-kernel-gate-sanitize.test.ts, src/policy/config/sanitize.test.ts, src/policy/gate/render-hook-output.test.ts, plus CHANGELOG.md/docs/STATE.md/docs/decisions.md/docs/run-log.jsonl. No infrastructure/IaC file touched.

- **devops/* ADRs (0001-0010): CLEAN, not applicable.** Zero infra files in the diff; devops ADR-0001's own Rules for agents scope its MUSTs to "infrastructure, pipelines, or IaC" work.
- **SE ADR-0021 (Thoth-native architecture -- kernel, Action record, normalizer registry, gate surfaces, evidence trail): CLEAN.** Read the full Rules for agents section (adr/software-engineering/0021-thoth-native-architecture.md:201-219). No rule mandates a specific sanitization pattern (no "always use a drift guard" MUST) -- this PR's injected-port design (vs. S6's inline-copy-plus-diff drift guard) is a permitted variant, not a deviation from an ADR rule. The PR's own header comment in render-hook-output.ts:8-30 states the reason (gate/kernel purity boundary forbids importing config/ directly) and the new structural drift-guard test (sanitize.test.ts's new "Issue #312" test) is a sound substitute for the literal-diff shape S6 used, given there is no second literal here to diff against. Confirmed by running: G15 ("no node:* import and no import from src/policy/config/") and kernel-purity-check.ts both still pass against this diff (see Checks below) -- the design change does not cross the purity boundary it claims to respect.
- **SE ADR-0004 (idempotency) / SE ADR-0005 (testing strategy): CLEAN, not applicable to the idempotency MUSTs.** This hook is a pure read-decide-render path with no filesystem-write API (G18, confirmed passing) -- not a "mutating endpoint, consumer, or job," so ADR-0004's idempotency-test MUST does not attach. ADR-0005's unit-test-coverage MUST is satisfied: happy path (AC-5 clean-reason byte-identity), error paths (AC-1/AC-2 hostile deny/refusal), boundary (AC-4 empty-after-sanitize fail-closed), plus an end-to-end proof (AC-8) through the real sandboxed hook.
- **THOTH-ADR-0001 (central-classification fixture standing exception): CLEAN, not applicable.** Read its Rules for agents (docs/adr/thoth-0001-...md:50-58) -- scoped strictly to docs/qa/s5-central-classification.json and the hooks/loader that read it (hooks/sessionstart-tool-enum.mjs, src/policy/tools/central-classification.ts). This diff touches neither; pretooluse-kernel-gate.mjs's pre-existing catalog.assembleCatalog(...) import is unchanged by this PR (only the new sanitizeMod import is added to that Promise.all). No collision.
- **SE ADR-0001 (record architecture decisions): one MUST not met -- see Finding 2 below.**
- **THOTH-ADR-0002 (secret-scan allowlist): not applicable, diff carries no allowlist entries.**

## CLAUDE.md sensitive-area cross-check (task items 2 and 5)

- **"Evidence / audit trail" (hooks/audit-log.mjs and any component that records/verifies incapability/assurance evidence): CLEAN, no collision, because the component doesn't exist yet.** A repo-wide search for *audit-log* (excluding node_modules/adr) returns nothing anywhere in the tree. This matches docs/STATE.md's own prior note that the real audit-trail owner is "not-yet-reached ... S8/Milestone #26/INT-05." The sanitized text this PR touches is the PreToolUse hook's own stdout (permissionDecisionReason), which is Claude Code's enforcement-decision channel, not a durable evidence-trail write -- confirmed by gate-structure.test.ts's G18 ("no write path: neither the hook nor any gate file calls a filesystem-write API"), unchanged by this diff and passing. There is no live audit component today for a sanitized-vs-raw mismatch to occur against.
- **"Guard / policy engine" (scripts/guard/*, src/policy/guard/*): CLEAN, not applicable.** Neither path exists in this repo (this project uses hooks/*.mjs + src/policy/gate|kernel/* instead of that naming).
- **"Policy delivery / config surface": correctly ceremonied, not a gap.** This PR is exactly "a change to ... the hooks that read [policy]" per the sensitive-area bullet, and it is correctly drawing the full CRITICAL review chain (red-team + app-security-reviewer + cross-domain-reviewer), so the process invariant is honored, not violated.

## Seam-hunting

This is a narrow, effectively single-domain (app/security) change -- the seams worth naming are process/bookkeeping ones between this story's ship-loop artifacts and the rest of the project's state, not a functional domain-boundary defect in the shipped code itself.

**Finding 1 [MED, demonstrated] -- docs/.maat-state.json's top-level scope/tier was never transitioned for this story; it still reads the prior story.**

Every prior story in this project's history transitions docs/.maat-state.json's top-level scope/tier at ship-close, cascading the previous value into priorScope -- confirmed via the commit history for that file, which shows a dedicated "state scope transition" commit for every recent story (f663d6b docs(s7b): ... state scope transition (Issues 305, 306); 7d25865 docs(s7a): ... maat state transition; 979575a docs(s6-294): scope state, ...; etc.). PR #358's diff (9 files, verified against gh pr view --json files) does NOT include docs/.maat-state.json. At the branch tip, that file's top-level scope still reads "s7b-policy-authoring-safety" (already-shipped, per docs/STATE.md's own history), not "s312-kernel-hook-sanitize".

This is not a false completeness claim (docs/decisions.md's row and docs/STATE.md's resume-point correctly list only "a decisions.md row" and "the tier ratification already recorded in docs/run-log.jsonl" as pending/done -- neither claims the state-file transition happened), so QA-15 does not catch it; it is a missing step against the project's own established convention and against CLAUDE.md's Risk Tier Definitions section ("It is then persisted once to docs/.maat-state.json, and /maat:review and /maat:verify reuse it rather than re-deriving").

Consequence, demonstrated: docs/session-brief.mjs (lines 48-49) reads st.scope/st.tier directly from this file and surfaces them as "the facts a resuming session asks for first" (its own header comment, line 8). A session resuming after this PR would currently be briefed scope=s7b-policy-authoring-safety tier=CRITICAL -- the wrong story name (tier happens to still read CRITICAL correctly by coincidence, since s7b was also CRITICAL). Exposure: 100% of resume-session briefings until the next story's own transition commit overwrites it (measured: session-brief.mjs's direct field read); basis: measured, not assumption. Not security/data-integrity/legal/safety, so this does not gate under rule 21's cap regardless -- capped at non-blocking, routed as a condition.

**Minimal fix:** one follow-up commit (can ride with the merge or immediately after) that moves the current top-level scope/tier/counters into priorScope and sets the top level to "s312-kernel-hook-sanitize" / "CRITICAL", matching every prior story's own transition-commit shape.

**Finding 2 [LOW, demonstrated] -- PR #358's body cites no ADR number, per SE ADR-0001's own MUST.**

adr/software-engineering/0001-record-architecture-decisions.md line 40: "MUST reference the governing ADR number(s) in PR descriptions (e.g. Complies with ADR-0004, ADR-0007)." gh pr view 358 --json body (quoted in full during this review) names G15/kernel-purity-check.ts and #294 but cites no ADR number anywhere. This is real but not novel to this PR: spot-checking recent merged PRs in the same family (gh pr view 327/337/346), PR #327 (the directly comparable S7-A gate-hook-robustness fix) also carries zero ADR citation in its body, with no prior finding against it that I could find. Systemic, pre-existing, non-security -- kept at LOW, non-blocking, not filed as its own Issue (below the [MED] filing threshold). Recommendation: fold into the existing bookkeeping condition above, or open a docs/backlog.md item to either start citing ADR numbers in PR bodies project-wide or narrow SE ADR-0001's MUST to match actual practice.

## Verified independently (own commands, own output -- task instruction: "Verify claims yourself")

Checked out origin/story/312-kernel-hook-sanitize in this worktree and ran, base origin/master at 4f5df2f (not the stale local master at c2750a2 -- caught and corrected mid-review; confirmed the corrected diff matches gh pr view --json files's 9-file list exactly):

```
npm run typecheck                 -> clean (tsc --noEmit -p tsconfig.json, no output, exit 0)
npm run lint                      -> clean (eslint ., no output, exit 0)
npm test                          -> tests 1504, pass 1504, fail 0, cancelled 0, skipped 0, todo 0
node --test <5 new/changed test files + gate-structure.test.ts>
                                   -> tests 22, pass 22, fail 0, skipped 0 (includes G11, G11b, G15,
                                      G18, G19, G20, AC-1..AC-5, AC-8 x2, the Issue #312 drift-guard test)
node src/qa/kernel-purity-check.ts        -> PASS: 4 production .ts files, zero violations
node src/qa/gate-manifest-check.ts        -> PASS: exactly 1 gate manifest
node src/qa/gate-matcher-drift-check.ts   -> PASS: 19 referenced tool names, all present
node src/qa/reference-resolver.ts origin/master HEAD
                                   -> PASS: 470 citations, 344 resolved, 126 unclassified (non-blocking), 0 failed
node src/qa/completeness-claim-checker.ts -> PASS: 2 files checked, all completeness claims verified
node src/secret-scan/history-scan.ts      -> exit 0, all matches pre-allowlisted, 0 new
```

Every number in the PR's own Test Plan checklist and in docs/STATE.md's "Verified on the branch tip" bullet reproduces exactly. kernel.ts::decide()'s reason-building (denyMatch.rationale, falling back to a template with denyMatch.id, lines 177/186) matches the PR's own description of what feeds the sanitizer. renderHookOutput's only caller is hooks/pretooluse-kernel-gate.mjs (grepped project-wide) -- the required-parameter signature change has no other call site to silently break. main()'s single top-level try/catch means a throwing sanitize (defensive case, not realistically reachable given the simple regex) still fails closed via the existing failClosed("internal exception", err) path, exit 2 -- confirmed by reading the control flow, not merely assumed.

## Coverage gaps named

- **Docs bookkeeping (docs/.maat-state.json scope transition) is not any domain reviewer's lane** -- app-security-reviewer and red-team check the code; this is exactly the seam this role exists to catch (Finding 1).
- **No gap in the security-relevant surface itself**: sanitization coverage (deny-verdict reason, refusal reason, both call sites converge on one sanitizedDenyJson function), the allow-path's total discard of reason before any sanitize call (not just sanitized-then-discarded), and the empty-after-sanitize fail-closed behavior are all exercised by both unit and real end-to-end (through the actual sandboxed hook binary, not just the exported function) tests. This is real, reproduced coverage, not a gap.
- Everything else in the diff (docs prose) was read and cross-checked against the actual code/test diff and my own reproduced command output -- accurate, no repeat of the QA-15-class overstatement incident this project has had before.

## Verdict

**APPROVE-WITH-CONDITIONS.**

No HIGH. No ADR collision that blocks. One MED (bookkeeping, non-security, fixable in a one-line follow-up commit) and one LOW (pre-existing, systemic, non-blocking). The shipped code itself -- the sanitization logic, the purity-boundary discipline, the fail-closed behavior, the test coverage -- is sound and independently reproduced.

**Conditions:**
1. Before or immediately after merge: transition docs/.maat-state.json's top-level scope/tier to s312-kernel-hook-sanitize/CRITICAL, cascading the current s7b-policy-authoring-safety entry into priorScope, matching every prior story's own transition-commit convention.
2. Optional, LOW: add an explicit ADR-number citation to PR bodies going forward per SE ADR-0001, or file a backlog item to reconcile that MUST with actual practice.

## Single next action

Post-merge (or same-turn, before merge), run the one-line docs/.maat-state.json scope-transition commit for s312-kernel-hook-sanitize so docs/session-brief.mjs briefs the next resuming session correctly.
---

## Addendum (same session, appended not edited): Finding 1's Issue disposition

Duplicate check (gh issue list --search) found this exact root-cause class already tracked, open: **Issue #260** (docs/.maat-state.json not transitioned, filed against s1-238-unlock-command-cquote) and **Issue #185** (same class, path-b-precommit-secret-scan, closed COMPLETED but the class recurred). Per this project's no-fragmentation Issue discipline, this session's instance (s312-kernel-hook-sanitize) was posted as a comment on the still-open #260 rather than filed as a new Issue: https://github.com/mohannadrabie/thoth/issues/260#issuecomment-5876326582. Finding 2 (LOW) does not meet the [MED]/[HIGH] filing threshold, so no Issue was filed or needed for it.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by blast radius):
1. [ISSUE][MED][demonstrated] docs/.maat-state.json top-level scope/tier never transitioned from s7b-policy-authoring-safety to s312-kernel-hook-sanitize for this story (no commit in PR #358 touches this file, breaking the project's own per-story convention); docs/session-brief.mjs lines 48-49 read st.scope/st.tier directly and would brief a resuming session with the wrong story name. Fix: one-line state-transition commit cascading s7b into priorScope, matching every prior story's own pattern.
2. [ISSUE][LOW][demonstrated] PR #358's body cites no ADR number, per SE ADR-0001's MUST ("Rules for agents", adr/software-engineering/0001-record-architecture-decisions.md line 40); pre-existing/systemic (PR #327 also lacks one), non-blocking, fold into backlog.
3. [CLEAN][code-traced] SE ADR-0021 Rules for agents: no MUST mandates a specific sanitization/drift-guard pattern; the injected-port design vs. S6's inline-copy diff-guard is a permitted variant, purity boundary (G15, kernel-purity-check) unbroken and passing.
4. [CLEAN][demonstrated] SE ADR-0004/0005 idempotency MUSTs: not applicable, this hook is a pure read/decide/render path with no filesystem-write API (G18 passing, confirmed); ADR-0005's unit-test MUST satisfied (happy/error/boundary + e2e).
5. [CLEAN][code-traced] THOTH-ADR-0001 (central-classification fixture exception): scoped to docs/qa/s5-central-classification.json and its own loader/hook, both untouched by this diff.
6. [CLEAN][code-traced] devops/* ADRs (0001-0010): not applicable, zero infra files in the diff.
7. [CLEAN][code-traced] CLAUDE.md "Evidence / audit trail" sensitive area: hooks/audit-log.mjs does not exist anywhere in the repo yet (confirmed by search); this hook writes nothing durable (G18 passing), so there is no live component to collide with.
8. [CLEAN][code-traced] CLAUDE.md "Guard / policy engine" sensitive area: scripts/guard/* and src/policy/guard/* do not exist in this repo; not applicable.
9. [CLEAN][demonstrated] docs/decisions.md, CHANGELOG.md, docs/STATE.md entries for Issue #312 are accurate: every claimed check (typecheck, lint, 1504/1504 tests, QA-14, QA-15, secret scan, kernel-purity/gate-manifest/gate-matcher-drift) reproduced independently with matching real counts.
10. [CLEAN][demonstrated] Sanitization coverage is complete on the real call graph: kernel.ts::decide()'s rationale/id-fallback reason (lines 177/186) and the pre-kernel refusal reason both converge on renderHookOutput's single sanitizedDenyJson call site; the allow path discards reason before any sanitize call (AC-3 spy test, 0 calls); empty-after-sanitize fails closed (AC-4); no other caller of renderHookOutput exists to leave unsanitized (grepped project-wide).
counts (checksum): issues=2 suspicions=0 clean=8
evidence (checksum): demonstrated=5 code-traced=5 derived=0
checks=typecheck clean; lint clean; npm test 1504/1504 pass 0 fail 0 skip; targeted suite (5 new/changed files + gate-structure.test.ts) 22/22 pass 0 fail 0 skip; kernel-purity-check PASS; gate-manifest-check PASS; gate-matcher-drift-check PASS; QA-14 (reference-resolver, diff mode) PASS 470 citations 0 failed; QA-15 (completeness-claim-checker) PASS 2 files; secret scan exit 0 all pre-allowlisted
adr=HIT(37, whole catalog)
report=docs/reviews/s312-kernel-hook-sanitize-cross-domain-2026-09-28.md
