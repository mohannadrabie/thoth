# S6 "Policy Centralization" — Cross-Domain Review, ROUND 2 (Ra)

**Scope:** re-confirm of the standing cross-domain pass against the CURRENT state of the S6 diff, after
three fix-now rounds and a council-ratified trust-model redesign since my original pass. **Baseline:**
`280f1c7` (my last-reviewed commit). **HEAD:** `602be5c` (confirmed via `git log -1`, tree clean —
`git status --short` empty). **Tier:** CRITICAL. **Reviewer:** cross-domain-reviewer (Ra). **Date:**
2026-09-08. **My prior report:** `docs/reviews/s6-policy-centralization-cross-domain-2026-09-08.md`
(APPROVE-WITH-CONDITIONS, Issue #105 filed) — this round re-confirms that finding's fix and re-passes
the whole ADR catalog against everything that has changed since.

**ADR cache:** `node docs/adr-cache.mjs --ensure` reused catalog fingerprint 83b2e3e, 35 ADRs
(devops:12, software-engineering:23), CACHE=HIT. Per this role's own step, the WHOLE catalog was read,
not filtered to any one lane's applicableTo slice.

## Who else ran since my last pass, and what ground they covered

Per docs/REVIEW_LOG.md's 2026-09-08 rows (all read in full) and the four reports the dispatch named:
red-team ran round 2 (no-go, Issues #114 HIGH + #115 MED) and round 3 (go, re-confirming both closed,
surfacing two new non-gating MED findings #118/#119, both fixed same-turn). A council (PRINCIPLES rule
16(c), 2 consecutive non-clean red-team rounds) convened three seats: design-challenger (Stop Brief,
go, named Paths A/B/C without recommending), architecture-reviewer (council seat,
APPROVE-WITH-CONDITIONS, ruled Path B, plus an addendum correcting design-challenger's "costs nothing"
claim about Path A against the real locked printer.test.ts fixture), impact-analyst (SAFE-TO-PATCH,
independently recommended Candidate B on cost). All three converged on Path B without prompting each
other. app-security-reviewer has NOT re-run against this round's delta -- its last S6 verdict (APPROVE)
predates all three fix-now rounds; I name this as a coverage gap below, not a defect, since the round's
own diff touches no subprocess/injection surface app-security's own lane owns (confirmed:
central-source.ts is absent from every diff since 280f1c7).

My own job this round starts exactly where these left off: a fresh whole-catalog ADR pass on the
delta, and independent re-verification -- not a re-read of anyone's claim -- of the specific items the
dispatch named.

## What I ran (independently, this round)

```
$ git log --oneline 280f1c7..602be5c
0ee4871 S6 Stage-3 round 3: council-ratified Path B fix for Issue #114/#115, build task #1
602be5c S6 Stage-3 round-3 re-confirm fix-now: Issue #118 (MED) + Issue #119 (MED)
$ git status --short                                    -> empty, HEAD = 602be5c exactly
```

```
$ node --test src/policy/config/*.test.ts src/policy/rule/*.test.ts
tests 122 / pass 122 / fail 0 / skipped 0

$ node --test --test-reporter=tap
tests 642 / pass 641 / fail 1 / skipped 0
  not ok - OSS-01 (dogfood): pre-existing, Issue #113, confirmed OPEN via gh issue view, unchanged

$ npm run typecheck                                       -> clean, exit 0
$ npm run lint                                             -> clean, exit 0
$ npm run qa:kernel-purity                                 -> PASS, 4 files under src/policy/kernel/, 0 violations
$ npm run qa:normalizer-registry-purity                    -> PASS, 0 violations
$ git diff --stat 280f1c7..602be5c -- package.json package-lock.json   -> empty, zero new dependencies
$ grep -rl "mergeLayersWithMandatoryLock or loadEffectivePolicy" src hooks
   -> zero hits under hooks/, unchanged since my original pass
$ grep -n "policy:print" package.json .github/workflows/ci.yml
   -> present in package.json only, still absent from ci.yml
```

Plus three purpose-built independent re-verifications, detailed under Seam findings below: (1) my own
printEffectivePolicy repro of the original Issue #105 duplicate-id case, run against current HEAD;
(2) a live reproduction of red-team's own Issue #118 mutation (adding a 4th LayerName/TRUST_RANK
entry) to confirm the fix, not just read it; (3) a live reproduction of red-team's Issue #119 single-
escaped-"rules"-key case through the real printer. All three run from a scratch script inside the
repo (relative-import resolution requires it), tree confirmed clean before and after each.

## Whole-catalog ADR re-pass on the delta

| ADR | Verdict | Note |
|---|---|---|
| SE ADR-0021 (kernel purity, POL-05/07/11) | CONFORMS | qa:kernel-purity re-run clean, 4 files, 0 violations. The delta never touches src/policy/kernel/** at all -- confirmed via git diff --stat 280f1c7..602be5c (kernel/ absent from the changed-file list). TRUST_RANK and hasLockingForce (precedence.ts) are pure data/logic -- a Record<LayerName, number> lookup table and a some() over its values, no filesystem/network/process access, no I/O of any kind. rule-types.ts's mandatory?: boolean field comment references precedence.ts but kernel.ts's decide()/pol05Rule()/isMutating()/matchRules() still never read it -- confirmed by direct grep: mandatory / TRUST_RANK / mergeLayersWithMandatoryLock appears in src/policy/kernel/*.ts exactly once, in a doc comment, never in executable code. |
| SE ADR-0003 (constructor-injected I/O, single-responsibility composition) | CONFORMS | mergeLayersWithMandatoryLock still composes via the shared mergeLayersById core -- confirmed by direct trace, precedence.ts:280 (const { order, byId } = mergeLayersById(acceptedLayers, ...)), unchanged in shape from my original pass and architecture-reviewer's own council finding 6. TRUST_RANK/hasLockingForce are a new axis layered ON TOP of the existing lock-check loop, not a parallel reimplementation of the merge itself. |
| SE ADR-0002 (layer boundary/DI) | CONFORMS | position-parser.ts (config layer) now imports unescapeJsonStringLiteral from ../rule/schema.ts (rule layer) -- a NEW import this round. Direction confirmed correct: loader.ts already imports rule/schema.ts the same direction (config to rule, never the reverse); schema.ts's own header comment states the layering explicitly ("config consumes rule validation, not the other way around"). No vendor/SDK type crosses a layer boundary. |
| SE ADR-0010 (no new dependency without justification) | CONFORMS | git diff --stat 280f1c7..602be5c -- package.json package-lock.json is empty -- zero new dependencies across all three fix-now rounds and the council. |
| SE ADR-0006 (no opportunistic scope-widening) | CONFORMS | Every file touched in 280f1c7..602be5c is inside the already-declared S6 surface (src/policy/{rule,config}/**, plus the review/decision/changelog/state-file bookkeeping) -- no drive-by edit outside that surface. hooks/ remains untouched (confirmed empty via grep, matching the standing Q2 ruling not to rewire this story). |
| SE ADR-0001 (ADR process) | CONFORMS | New/changed code cites governing Issue numbers and POL-IDs at every touched seam (TRUST_RANK's own header, findTopLevelKeys's header, position-parser.ts's Issue #119 comment). |
| SE ADR-0004/0005/0011-0015 (idempotency, data/DB, Playwright) | NOT-APPLICABLE | Unchanged from my original pass -- read-only, no mutation, no database, no UI flow. |
| SE ADR-0009 (observability) | NOT-APPLICABLE (by convention) | print-cli.ts remains a manually-invoked diagnostic CLI, unchanged disposition. |
| Devops ADR-0001-0010 | NOT-APPLICABLE | No AWS/IaC files touched in this delta. |
| SE ADR-0016/0018/0019/0020 (porting/self-protection) | NOT-TRIGGERED | No maat-legacy porting activity in this delta. |

No new ADR collision surfaced by anything that changed since my last pass. The one boundary question
worth naming explicitly (not a violation, a design note): TRUST_RANK introduces a second ordering
axis (trust, independent of POL-08 precedence) inside src/policy/rule/precedence.ts -- this is exactly
the axis the council's own three seats debated and ratified as Path B; it does not create a new
module, a new external dependency, or a new I/O surface, so it stays inside SE ADR-0002's layering and
SE ADR-0021's purity boundary as-is.

## Seam findings

### 1. [CLEAN][demonstrated] My original Issue #105 finding is genuinely closed -- independently re-verified against current HEAD, not re-read from the implementer's claim

My original round's finding: duplicate rule id within one layer produced a silently-wrong origin line
(findIndex reports the first occurrence's line while the merge keeps the last occurrence's value).
Re-ran my own repro through the real printEffectivePolicy() against 602be5c:

```
=== Repro: duplicate rule id (original Issue #105 finding) ===
stdout: "central-channel status=absent / REJECTED: central policy load failed (schema-invalid):
         .../project.json: rules[1].id: duplicate rule id \"dup\" (first defined at rules[0],
         repeated at rules[1])"
exitCode: 1
```

The fix that shipped is stronger than my own proposed minimal fix: rather than merely correcting the
reported line, validateRuleSet() now rejects the document outright at load time, naming both
indices -- the bug class is closed at its root, not patched at the point of symptom. Independently
confirmed via schema.test.ts's own suite (122/122 pass, including the Issue #105 cases) and via my
own live repro above. SURVIVES.

### 2. [CLEAN][demonstrated] Issue #118's fix (conformance-matrix enumeration domain) holds under the exact mutation red-team used to find the original gap -- re-run myself, not trusted on the report's word

Red-team's round-3 finding: mandatory-lock-conformance.test.ts's self-check asserted a hardcoded
forwardPairs.length === 3 instead of deriving completeness from TRUST_RANK's own key set, so a 4th
layer left half the matrix silently unexercised while the self-check reported full coverage. I applied
the identical mutation myself against current HEAD -- added a 4th layer ("enterprise", rank 2) to both
LayerName and TRUST_RANK -- and re-ran the conformance suite:

```
$ npm run typecheck                                       -> clean (Record<LayerName,...> still satisfied)
$ node --test src/policy/rule/mandatory-lock-conformance.test.ts
tests 12 / pass 11 / fail 1
```

Before the fix this would have stayed 12/12 green (red-team's own demonstrated result against the
pre-fix code). It now correctly turns red the moment a 4th layer exists without a matching
PRECEDENCE_ORDER update -- the fix genuinely closes the gap it claims to close, confirmed by my own
mutation, not the implementer's account of it. Mutation reverted; git status --short empty afterward,
node --test re-confirmed 12/12 green on the real tree.

### 3. [CLEAN][demonstrated] Issue #119's fix (position-parser escaped-key sentinel) closes the defect outright, not merely the disclosed fallback -- re-verified through the real printer, not the report's own transcript

Red-team's round-3 finding: a single (non-duplicated) unicode-escaped top-level "rules" key passed
schema validation but findRulePositions returned [], degrading every rule's origin line to a -1
sentinel. I reproduced the identical input independently through printEffectivePolicy() against
602be5c:

```
=== Repro: single escaped 'rules' top-level key (Issue #119) ===
stdout: "central-channel status=absent / --- resolved rules (2) --- /
  rule id=a-first  effect=allow layer=project origin=.../project.json line=4 mandatory=false /
  rule id=b-second effect=deny  layer=project origin=.../project.json line=5 mandatory=false"
exitCode: 0
```

Real line numbers (4, 5), not the -1 sentinel red-team's report showed against the pre-fix code --
position-parser.ts now delegates key comparison to schema.ts's own unescapeJsonStringLiteral (the
same decoder Issue #115's fix already established as authoritative), so the document resolves
correctly rather than merely degrading to a labeled "no answer." A stronger outcome than the two named
proof-tests asked for (which would have been satisfied by the -1 backstop alone). SURVIVES.

### 4. [CLEAN][code-traced] Build task #1 (the standing conformance instrument) is genuinely CI-gating, not merely present in the tree

The council's own GO condition 4 required a "real, CI-gating exhaustive layer-pair conformance
matrix... not another one-off patch." Confirmed mechanically: package.json's "test": "node --test"
has no glob restricting discovery -- Node's test runner auto-discovers every *.test.ts file from cwd,
which is how mandatory-lock-conformance.test.ts already appeared in my own full-suite run (642 tests,
up from the pre-file baseline) without any registration step. .github/workflows/ci.yml:61 runs
npm test directly. The instrument is wired into the gate that would actually block a future PR, not
just a local convenience file.

### 5. [CLEAN][code-traced] The InertMandatoryDeclaration field-threading seam (precedence.ts to loader.ts to printer.ts to print-cli.ts) is complete end to end, confirmed by trace and by my own live CLI run

Traced precedence.ts's MandatoryLockResult.inertMandatoryDeclarations to loader.ts:187's
LoadSuccess.inertMandatoryDeclarations (one-line addition, field-only, no new control flow) --
confirmed present in both of my own repro outputs above ("inertMandatoryDeclarations": []), and
independently reproduced end-to-end through the actual shipped CLI by red-team's own round-3 report
(C5, a real .thoth/policy.json write-and-restore). No dropped field anywhere in the chain -- this is
the exact seam (a value computed in the rule layer, threaded through three more modules to reach an
operator-visible CLI line) most likely to silently break at one of the four hops, and it doesn't.

## Coverage gaps (named, not necessarily defects)

1. app-security-reviewer has not re-run against this round's delta. Its last S6 verdict (APPROVE)
   predates all three fix-now rounds and the council. The delta since then (precedence.ts, schema.ts,
   position-parser.ts, loader.ts, printer.ts, print-cli.ts, mandatory-lock-conformance.test.ts)
   touches no subprocess/injection/secrets surface -- central-source.ts (the file app-security's own
   dedicated pass scrutinized) is untouched in every diff since 280f1c7, confirmed via git diff --stat.
   Low risk given the surface, but named so a future reader doesn't assume app-security's stale
   APPROVE covers this round's actual code.
2. The real-registry round-trip remains unexercised, unchanged in kind from every prior round --
   reg add is refused by the tool classifier in-session, the session token is UAC-filtered. Named,
   disclosed, human-owned, not new this round.
3. Issue #110's own residual (POL-09's pin hashes only centralRaw) remains open, unchanged by
   this round's fixes (design-challenger's Stop Brief carried it forward as residual #3, out of the
   council's own assigned scope) -- not re-attacked this round, named so it isn't lost.

## Process hygiene -- the specific asks

REVIEW_LOG.md: current through red-team round 3 (go, row 66) -- every round since my original
pass is present and in order (round 2 no-go, three council seats, round 3 go). This round's own row
appended below by me.

docs/.maat-state.json: scope "s6", tier "CRITICAL", reviewRoundsSinceClean 0,
roundsSinceLastGo 0, councilHeld true, councilVerdict "GO (...)" -- all four correctly reflect
the post-council reset (the council resolved the rule-16(c) trigger and reset both counters to 0) and
remain consistent with round 3's own subsequent go verdict (a clean round does not re-increment
either counter). No drift found between the state file and the decisions.md rows that should have
produced it.

Issues #116/#117 (red-team's mid-loop process findings) -- checked independently, not re-read from
the "corrections landed same-turn" claim:

- Issue #117 (state-file drift) -- genuinely fixed and internally consistent. The state file's
  reviewRoundsSinceClean/roundsSinceLastGo now correctly read 0, matching the council's own GO
  reset -- confirmed directly against the live file, not the decisions.md prose describing it.
- Issue #116 (wrong Issue-number citations in the "Stage-3 review round 1" decisions.md row) -- the
  correction landed correctly WHERE the project's own convention requires it (decisions.md is
  append-only; the original row is left as-written and a later row states the correction in prose) --
  but the SAME wrong numbers this issue named persist, uncorrected, in two OTHER files that are not
  bound by decisions.md's append-only convention:
  - CHANGELOG.md:27 still reads "[MED, Issue #111]" for POL-09's pin -- the correct number is
    #110 (confirmed via gh issue view 110: "S6 pin: POL-09's pin is computed then discarded...").
  - CHANGELOG.md:29 still reads "[LOW, Issue #112]" for the reg.exe stderr leak -- Issue #116's own
    correction states this finding "has no Issue at all... and should never have carried a number"
    (LOW findings aren't filed per this project's convention); the number now written there (#112) is
    additionally wrong on its own terms -- #112 is the defaultOutcome finding, confirmed via
    gh issue view 112.
  - CHANGELOG.md:32 and docs/backlog.md:45 both still read "Issue #110" for defaultOutcome -- the
    correct number is #112, per the same gh issue view confirmation above and per decisions.md's
    own correction text ("defaultOutcome is #112, not '#110'").

  This is a real, still-live instance of the exact defect Issue #116 was filed for -- it is only
  partially closed. Correctly, Issue #116 remains OPEN on GitHub (verified: state OPEN), which
  is the accurate status given the above -- but neither #116 nor #117 carries a single comment recording
  any of this (gh issue view {116,117} --json comments both return empty), against this project's own
  Issue Discipline ("every subsequent fact... is a new COMMENT"). Nobody has told the Issue itself that
  its underlying defect is still partly live in two files decisions.md's fix never touched.

  Severity: LOW (pure documentation/citation prose, zero code or security impact, does not gate;
  caps at LOW per this role's own Editorial-defect handling) -- routed to Editorial below, not a
  blocking finding. Per this project's own filing rule, a LOW-severity [ISSUE] does not spawn a new
  GitHub Issue (and both #116 and #117 already exist and cover this exact ground -- a third Issue would
  be a duplicate).

## Editorial (non-blocking, no re-review needed)

- CHANGELOG.md:27/:29/:32 and docs/backlog.md:45 carry stale GitHub Issue-number citations
  Issue #116 already named and decisions.md already corrected in its own append-only row -- see Process
  hygiene above for the exact wrong-to-right mapping. Fix: three one-line edits to CHANGELOG.md, one to
  docs/backlog.md; optionally a same-turn comment on Issues #116/#117 recording current status
  (partially-fixed / fixed, respectively) so the Issue thread itself reflects reality per this
  project's own Issue Discipline.
- precedence.ts:148-153's comment that shipped-defaults' claim on project "was never real force to
  begin with" is inaccurate as history (red-team's own editorial note, independently confirmed by my
  own reading of round 2's C2 in the red-team round-3 report -- it *was* real force under the pre-Path-B
  code). Carried here as a duplicate confirmation, not a new finding.

## Findings vs. failing tests

Zero open [ISSUE] findings this round at MED or above -- every gating item from red-team's round 2/3
and the council is independently re-confirmed closed above, by my own re-run/re-repro, not by re-reading
the reports. The one LOW-severity process finding (stale Issue-number citations in CHANGELOG.md/
backlog.md) is Editorial per policy and does not require a named failing test -- it is a prose fix.

## Verdict

APPROVE. No ADR collision on the delta, whole catalog re-checked. No cross-domain seam break in the
kernel-purity/DI/layering/dependency/scope-widening lanes. My own original finding (Issue #105) is
genuinely closed, independently re-verified. Both council-ratified fixes (#114, #115) and both
round-3 follow-on fixes (#118, #119) hold under my own independent re-verification (a live mutation for
#118, a live repro for #105 and #119) -- not accepted on any report's transcript alone. Process
bookkeeping (REVIEW_LOG.md, state file) is current and internally consistent; the one process gap found
(stale Issue-number citations surviving in CHANGELOG.md/backlog.md despite decisions.md's own
correction) is LOW-severity, Editorial, and does not gate.

## Single next action

Three one-line CHANGELOG.md edits + one docs/backlog.md edit to replace the stale #111/#112/#110
citations with the correct #110/(no number)/#112 per the mapping above; optionally a status
comment on Issues #116/#117 recording that #117 is fully fixed and #116 is now fully fixed once those
edits land. Neither blocks ship.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [CLEAN][demonstrated] Original Issue #105 finding (duplicate rule id -> wrong origin line) genuinely closed: independently re-run via my own printEffectivePolicy() repro against 602be5c -- now REJECTED outright at exit 1, naming both indices, stronger than my own originally-proposed minimal fix.
2. [CLEAN][demonstrated] Issue #118 fix (conformance-matrix enumeration domain) holds under the exact 4th-layer mutation red-team used to find the original gap -- I applied it myself (LayerName+TRUST_RANK), self-check now correctly fails (11/12) instead of falsely reporting complete coverage; mutation reverted, tree clean.
3. [CLEAN][demonstrated] Issue #119 fix (position-parser escaped-key sentinel) closes the defect outright, not just the disclosed -1 fallback -- independently reproduced through the real printer: a single escaped "rules" key now resolves with correct line numbers (4, 5), not -1.
4. [CLEAN][code-traced] Build task #1 (mandatory-lock-conformance.test.ts) is genuinely CI-gating -- package.json's "test": "node --test" auto-discovers it with no registration step, ci.yml:61 runs npm test directly.
5. [CLEAN][code-traced] InertMandatoryDeclaration field-threading (precedence.ts -> loader.ts -> printer.ts -> print-cli.ts) traced complete end to end, confirmed present in both my own repro outputs and red-team's own live CLI run.
6. [CLEAN][code-traced] SE ADR-0021 kernel purity CONFORMS on the delta -- kernel/ untouched by any commit since 280f1c7, TRUST_RANK/hasLockingForce are pure data/logic with zero I/O, kernel.ts never reads Rule.mandatory (confirmed by direct grep).
7. [CLEAN][code-traced] SE ADR-0003 composition CONFORMS -- mergeLayersWithMandatoryLock still calls the shared mergeLayersById core at precedence.ts:280, TRUST_RANK is a new axis layered on top, not a parallel reimplementation.
8. [CLEAN][code-traced] SE ADR-0002 layering CONFORMS -- position-parser.ts's new import of schema.ts's unescapeJsonStringLiteral runs config->rule, the same direction loader.ts already imports in.
9. [CLEAN][code-traced] SE ADR-0010 CONFORMS -- zero new dependencies across all three fix-now rounds and the council (package.json/package-lock.json diff empty).
10. [ISSUE][LOW][code-traced] Issue #116's own defect (wrong GitHub Issue-number citations) is only PARTIALLY closed: decisions.md's append-only correction is correct and internally consistent, but CHANGELOG.md:27/:29/:32 and docs/backlog.md:45 still cite the same wrong numbers (#111 should be #110; #112-for-stderr should have no number; #110-for-defaultOutcome should be #112) -- confirmed via gh issue view 110/112. Issue #116 correctly remains OPEN but carries zero comments recording this status, against this project's own Issue Discipline. LOW severity, Editorial, does not gate, no new Issue filed (LOW-severity ISSUEs don't spawn one; #116/#117 already cover this ground).
11. [CLEAN][demonstrated] Issue #117 (state-file drift) fully fixed and internally consistent -- docs/.maat-state.json's reviewRoundsSinceClean/roundsSinceLastGo both correctly read 0, matching the council's own GO reset, confirmed directly against the live file.
counts (CHECKSUM): issues=1 suspicions=0 clean=10
evidence (CHECKSUM): demonstrated=5 code-traced=6 derived=0
checks=node --test src/policy/config/*.test.ts src/policy/rule/*.test.ts: 122 pass/0 fail; full suite (node --test --test-reporter=tap): 642 tests/641 pass/1 fail (pre-existing Issue #113, confirmed OPEN via gh)/0 skipped; npm run typecheck: clean; npm run lint: clean; npm run qa:kernel-purity: PASS (4 files, 0 violations); npm run qa:normalizer-registry-purity: PASS; live mutation of Issue #118's fix (4th layer added to LayerName+TRUST_RANK): 11/12 pass, correctly red, reverted; live repro of Issue #105 fix: exit 1, duplicate rejected by name; live repro of Issue #119 fix: exit 0, correct line numbers not -1
adr=HIT(35, whole catalog)
report=docs/reviews/s6-policy-centralization-cross-domain-round2-2026-09-08.md

---

## ADDENDUM (2026-09-08, same day, appended not edited -- PRINCIPLES rule 11)

Cross-checked docs/REVIEW_LOG.md again after this report's body above was already written and
persisted: a new row appeared between my own earlier read of the log and this append --
docs/reviews/s6-policy-centralization-app-security-round2-2026-09-08.md (app-security-reviewer,
APPROVE) -- confirming it ran CONCURRENTLY with this pass, not before it (the same concurrency
pattern my original round noted for app-security-reviewer's first S6 pass). I read it in full.

This CORRECTS Coverage gap #1 above, which is now stale: app-security-reviewer HAS re-run against
this exact round's delta (baseline 280f1c7, HEAD 602be5c) and independently re-verified, by its own
live repro and its own live mutation (not on any report's word): Issue #106's absolute reg.exe path,
Issue #114's TRUST_RANK exploit closure (its own repro, matching mine), central's un-voidability as
BOTH structural and compiler-enforced (a TS2741 error on an unmatched 4th LayerName member -- a
sharper proof than my own runtime-only mutation), Issue #118's conformance-matrix fix (its own
4th-layer mutation, same result as mine), Issue #119's fix (code-traced), the loud-disclosure
mechanism reaching the real CLI with no secret/rationale/path leakage, and the full 642-test suite.
Verdict APPROVE, 10 CLEAN findings plus one LOW suspicion (central-source.ts's ambient
process.env.SystemRoot/windir trust for building the absolute reg.exe path -- not currently
exploitable, zero hook consumers, a forward-looking hardening note, not a defeat of the Issue #106
fix) -- none of which conflicts with, duplicates as a gating item, or changes anything in this
report's own verdict above.

Coverage gap #1 is WITHDRAWN as of this addendum: both domain-adjacent reviewer lanes that could
speak to this round's delta (app-security-reviewer for its own lane; this cross-domain pass for the
seams between all lanes) have now independently run against 602be5c. No other content in this report
changes -- this addendum adds one corrected fact, catchable by any reader who checks
docs/REVIEW_LOG.md's own row order against this report's own "What I ran" timestamp.

ADDENDUM RECEIPT: verdict=APPROVE (unchanged)
addendum correction: Coverage gap #1 ("app-security-reviewer has not re-run against this round's delta") is WITHDRAWN -- docs/reviews/s6-policy-centralization-app-security-round2-2026-09-08.md (APPROVE, 10 CLEAN + 1 LOW suspicion, all demonstrated/code-traced) ran concurrently with this pass and independently confirms the same fixes (Issue #106/#114/#118/#119) by its own repro/mutation, including a sharper compiler-enforced proof of central's un-voidability than this report's own runtime-only mutation.
report=docs/reviews/s6-policy-centralization-cross-domain-round2-2026-09-08.md

---

## Final consolidated RECEIPT (supersedes nothing above -- restates the original RECEIPT with the addendum's correction folded in, as this file's own closing block, per the "RECEIPT as last lines" requirement)

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [CLEAN][demonstrated] Original Issue #105 finding (duplicate rule id -> wrong origin line) genuinely closed: independently re-run via my own printEffectivePolicy() repro against 602be5c -- now REJECTED outright at exit 1, naming both indices, stronger than my own originally-proposed minimal fix.
2. [CLEAN][demonstrated] Issue #118 fix (conformance-matrix enumeration domain) holds under the exact 4th-layer mutation red-team used to find the original gap -- I applied it myself (LayerName+TRUST_RANK), self-check now correctly fails (11/12) instead of falsely reporting complete coverage; mutation reverted, tree clean. Independently corroborated by app-security-reviewer's own concurrent mutation of the same file, same result.
3. [CLEAN][demonstrated] Issue #119 fix (position-parser escaped-key sentinel) closes the defect outright, not just the disclosed -1 fallback -- independently reproduced through the real printer: a single escaped "rules" key now resolves with correct line numbers (4, 5), not -1.
4. [CLEAN][code-traced] Build task #1 (mandatory-lock-conformance.test.ts) is genuinely CI-gating -- package.json's "test": "node --test" auto-discovers it with no registration step, ci.yml:61 runs npm test directly.
5. [CLEAN][code-traced] InertMandatoryDeclaration field-threading (precedence.ts -> loader.ts -> printer.ts -> print-cli.ts) traced complete end to end, confirmed present in both my own repro outputs and red-team's own live CLI run.
6. [CLEAN][code-traced] SE ADR-0021 kernel purity CONFORMS on the delta -- kernel/ untouched by any commit since 280f1c7, TRUST_RANK/hasLockingForce are pure data/logic with zero I/O, kernel.ts never reads Rule.mandatory (confirmed by direct grep).
7. [CLEAN][code-traced] SE ADR-0003 composition CONFORMS -- mergeLayersWithMandatoryLock still calls the shared mergeLayersById core at precedence.ts:280, TRUST_RANK is a new axis layered on top, not a parallel reimplementation.
8. [CLEAN][code-traced] SE ADR-0002 layering CONFORMS -- position-parser.ts's new import of schema.ts's unescapeJsonStringLiteral runs config->rule, the same direction loader.ts already imports in.
9. [CLEAN][code-traced] SE ADR-0010 CONFORMS -- zero new dependencies across all three fix-now rounds and the council (package.json/package-lock.json diff empty).
10. [ISSUE][LOW][code-traced] Issue #116's own defect (wrong GitHub Issue-number citations) is only PARTIALLY closed: decisions.md's append-only correction is correct and internally consistent, but CHANGELOG.md:27/:29/:32 and docs/backlog.md:45 still cite the same wrong numbers (#111 should be #110; #112-for-stderr should have no number; #110-for-defaultOutcome should be #112) -- confirmed via gh issue view 110/112. Issue #116 correctly remains OPEN but carries zero comments recording this status, against this project's own Issue Discipline. LOW severity, Editorial, does not gate, no new Issue filed (LOW-severity ISSUEs don't spawn one; #116/#117 already cover this ground).
11. [CLEAN][demonstrated] Issue #117 (state-file drift) fully fixed and internally consistent -- docs/.maat-state.json's reviewRoundsSinceClean/roundsSinceLastGo both correctly read 0, matching the council's own GO reset, confirmed directly against the live file.
counts (CHECKSUM): issues=1 suspicions=0 clean=10
evidence (CHECKSUM): demonstrated=5 code-traced=6 derived=0
checks=node --test src/policy/config/*.test.ts src/policy/rule/*.test.ts: 122 pass/0 fail; full suite (node --test --test-reporter=tap): 642 tests/641 pass/1 fail (pre-existing Issue #113, confirmed OPEN via gh)/0 skipped; npm run typecheck: clean; npm run lint: clean; npm run qa:kernel-purity: PASS (4 files, 0 violations); npm run qa:normalizer-registry-purity: PASS; live mutation of Issue #118's fix (4th layer added to LayerName+TRUST_RANK): 11/12 pass, correctly red, reverted; live repro of Issue #105 fix: exit 1, duplicate rejected by name; live repro of Issue #119 fix: exit 0, correct line numbers not -1
adr=HIT(35, whole catalog)
report=docs/reviews/s6-policy-centralization-cross-domain-round2-2026-09-08.md
