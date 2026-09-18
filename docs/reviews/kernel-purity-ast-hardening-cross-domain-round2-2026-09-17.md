# Cross-Domain Review -- kernel-purity-ast-hardening -- ROUND 2 (targeted re-confirm) (Ra)

**Scope:** targeted re-confirm of the fix-now round on top of my own round-1 report (docs/reviews/kernel-purity-ast-hardening-cross-domain-2026-09-17.md, REWORK). Diff re-confirmed: git diff d227090..3bde1a2. Branch feat/kernel-purity-ast-hardening, now at commit 3bde1a2. Tier: STANDARD (unchanged).

**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT] -- same fingerprint as round-1, whole catalog unchanged. Round-1s whole-catalog verdict stands for anything not re-checked below.

**Who else ran:** app-security-reviewer (Horus) filed its own round-1 report (docs/reviews/kernel-purity-ast-hardening-app-security-2026-09-17.md, REWORK) independently confirming my round-1 Finding 1 (Issue #211, HIGH) and adding its own Finding 2 (Issue #210, MED, the .constructor.constructor prototype pivot). Both lanes round-1 ground is not re-litigated here except where the fix-now round touched files or claims outside what either report already checked.

## Re-confirm 1 -- Issue #211 (HIGH), alias-then-call bypass -- CLOSED, independently re-demonstrated

src/qa/kernel-purity-check.ts:284-300 (detectDirectCallViolation) is now wired into detectUsages (:335-340) via a new ts.isCallExpression branch, resolving the callee through resolveExpressionRoot/the alias map -- same shape as the existing property/element-access branches, as claimed.

Live re-probe (independent script, not the storys own test file, run directly via node --experimental-strip-types against the shipped module and deleted after):


```
=== fetch-alias-call ===        AST: [{"name":"fetch","detail":"direct call through forbidden global \"fetch\" (possibly via alias)"}]
=== setTimeout-alias-call ===   AST: [{"name":"setTimeout", ...}]
=== setInterval-alias-call ===  AST: [{"name":"setInterval", ...}]
=== require-alias-call ===      AST: [{"name":"require", ...}]
=== eval-alias-call (control) ===  regex: [eval] (still caught)   AST: [{"name":"eval", ...}] (now ALSO caught -- bonus, no regression)
```

4/4 of the roots the Q1 ruling added are now caught for their dominant real invocation shape (bare call through an alias). The eval control shows no regression -- it was caught before (by the regex layer) and stays caught, and is now also caught redundantly by the AST layers own new call branch (harmless overlap, not a new false-positive path -- fetch.bind(null)() was tested by the storys own suite to confirm the call branch does not double-fire on a non-identifier callee).

**Verdict on this finding: CLOSED.** [CLEAN][demonstrated].

## Re-confirm 2 -- bookkeeping (run-log.jsonl / .maat-state.json) -- CLOSED on this branch; one new LOW cross-branch note

- grep -n "kernel-purity-ast-hardening" docs/run-log.jsonl on this branch returns exactly ONE line: {"at":"2026-09-18T03:11:00.911Z","event":"tier-ratified","scope":"kernel-purity-ast-hardening","proposed":"STANDARD","ratified":"STANDARD",...}. Not a duplicate on this branch.
- docs/.maat-state.json: top-level scope="kernel-purity-ast-hardening", tier="STANDARD"; priorScope.scope="friendly-halt-messages"/CRITICAL; priorScope.priorScope.scope="path-b-precommit-secret-scan"/CRITICAL -- verified by parsing the file with node -e "JSON.parse(...)" (valid JSON) and walking the chain programmatically. Matches the nesting shape every prior transition in this file uses (confirmed against the friendly-halt-messages transition immediately above it in the same file).
- **Verdict on the on-branch claim: CLOSED.** [CLEAN][code-traced].

**New note -- the cross-branch duplicate is a real merge conflict, not a harmless append-only artifact (demonstrated, not assumed).** The task asked me to assess this rather than take it on faith either way, so I tested it directly instead of reasoning about JSONL append semantics in the abstract: I added a disposable git worktree at the two branches common ancestor (83b6af9) and ran git merge feat/kernel-purity-ast-hardening followed by git merge fix/state-md-bare-claim-regression. Result:

```
Auto-merging docs/run-log.jsonl
CONFLICT (content): Merge conflict in docs/run-log.jsonl
Automatic merge failed; fix conflicts and then commit the result.
```

The conflict markers show both branches independently appended a tier-ratified line for scope kernel-purity-ast-hardening (identical proposed/ratified/reason, different timestamps: 03:11:00.911Z on this branch vs 02:17:52.987Z on fix/state-md-bare-claim-regression) at the same append point, which gits merge treats as two conflicting insertions at the same anchor rather than silently unioning them. docs/STATE.md conflicts too, for the same reason (both branches edited the same resume-point section). The worktree probe was removed after (git worktree remove --force); no artifact left in the real working tree.

This is NOT a silent duplicate-event risk (the "harmless append-only log artifact" framing does not hold) -- but it is also not a defect in what is on THIS branch: it is self-announcing (git refuses to merge silently) and trivially resolved by whoever merges second, by deleting one of the two identical-content lines during conflict resolution. No data corruption, no silent double-count survives an actual merge. Severity LOW: it costs a human/agent one manual conflict-resolution step when these two branches converge, nothing more. [ISSUE][LOW][demonstrated] -- not filed as a GitHub Issue per this projects Issue Discipline (LOW-severity issues do not spawn one); noted here so whoever merges second is not surprised, and so "is this actually a problem" has a demonstrated answer instead of a guess.

## Seam / architecture check -- detectConstructorPivotViolation (Issue #210 fix-now)

src/qa/kernel-purity-check.ts:302-323 (asConstructorPropertyAccess, 3 lines; detectConstructorPivotViolation, ~12 lines) -- both single-purpose, well under SE ADR-0003s "~40 lines / complexity <= 10" guidance, consistent with round-1s function-size finding for the rest of the file. The design is root-independent by construction (matches the headers own framing: "a distinct detection rule, not an extension of (a)-(c)"), which is architecturally the right call -- a .constructor.constructor pivot does not touch the alias map at all, so bolting it onto resolveExpressionRoot would have been the wrong shape. It is wired into the same detectUsages ts.isCallExpression branch as the new call-violation check, which is reasonable (both are "something interesting happened at a CallExpression" checks) rather than a third tree walk.

Residual disclosure re-verified against my own probe, not read-and-trusted:

```
=== adjacent-chain constructor-pivot (should be caught) ===
source: ({}).constructor.constructor("return this")();
AST layer findings: [{"name":"constructor-pivot", ...}]

=== split-chain constructor-pivot (disclosed residual) ===
source: const step1 = ({}).constructor; const step2 = step1.constructor; step2("return this")();
AST layer findings: []
```

The header comments claim (splitting the chain across two variable declarations still bypasses it; this check does not track aliases of .constructor itself) holds exactly as written -- [CLEAN][demonstrated]. The false-positive guard also holds: x.constructor.name and x.constructor() (single-level) produce zero findings, per the storys own safe-single-constructor-access.ts fixture, which I re-ran through npm run qa:kernel-purity (PASS) rather than trusting the fixtures own self-description.

No cross-domain ADR collision from this addition: it is a QA-instrument-internal detection rule, same file, same applicableTo (quality/architecture, SE ADR-0003) already covered in round-1s clean verdict; no infra file touched.

## Regression re-confirm

- npm test: **874 pass, 2 fail, 0 skipped** -- the 2 failures are AC1-b (connector-fixture pin) and QA-15 (STATE.md bare-claim regression), by name and assertion content identical to round-1s disclosed pre-existing/unrelated pair; confirmed via full raw output, not the summary line alone.
- npm run qa:kernel-purity: **PASS**, "4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations" -- unchanged from round-1, still non-vacuous.
- node --test --experimental-test-coverage src/qa/kernel-purity-check.test.ts: **50/50 pass**, kernel-purity-check.ts line 98.17% / branch 95.33% -- still comfortably clears SE ADR-0005s 80% floor (round-1 measured 97.87%/94.51% at 43 tests; coverage rose with the 7 new tests, as expected).
- git status --porcelain at close: clean. The two ad-hoc probe scripts from a concurrent red-team session, noted as an addendum in my round-1 report, are no longer present on this branch (not this passs concern either way -- just confirming no stray state).

## Coverage gaps named

- Same as round-1: the two new dated review reports (app-security, cross-domain round-1) are not re-audited line-by-line beyond the specific claims re-checked above; low-risk documentation.
- Issue #210 is still OPEN on GitHub as of this pass, despite the fix landing on this branch (checked via gh issue view 210). Closing it (with state_reason: completed and a Fixes #210 reference) is the implementers/Managers normal closure step once this branch merges -- not a gap in this review, just noted so it is not lost.

## Verdict

**APPROVE.** Both round-1 blocking findings (Issue #211 HIGH, and my own bookkeeping MED) are independently re-demonstrated closed on this branch, with no regression (same 2 pre-existing/disclosed test failures, qa:kernel-purity still PASS) and no new HIGH/MED. The one new observation (cross-branch run-log/STATE.md merge conflict) is LOW, self-resolving, and not a defect in this branchs own diff.

**Single next action:** hand 3bde1a2 to the human for merge; whoever merges feat/kernel-purity-ast-hardening and fix/state-md-bare-claim-regression together (in either order) should expect a manual conflict in docs/run-log.jsonl and docs/STATE.md and resolve it by keeping one copy of the duplicate tier-ratified line, not both.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][LOW][demonstrated] docs/run-log.jsonl (cross-branch, not this diff) -- feat/kernel-purity-ast-hardening and fix/state-md-bare-claim-regression each independently appended a tier-ratified line for scope kernel-purity-ast-hardening; live test-merge in a disposable worktree confirmed a real CONFLICT (not a silent duplicate) in docs/run-log.jsonl and docs/STATE.md; self-announcing and trivially resolved (keep one line) at merge time, no code change needed on this branch.
2. [CLEAN][demonstrated] src/qa/kernel-purity-check.ts:284-340 detectDirectCallViolation/detectUsages -- Issue #211 CLOSED, independently re-probed: 4/4 alias-then-call roots (fetch/setTimeout/setInterval/require) now caught, eval control still caught with no regression.
3. [CLEAN][code-traced] docs/run-log.jsonl + docs/.maat-state.json (this branch) -- exactly one tier-ratified line for scope kernel-purity-ast-hardening, scope/tier correctly transitioned, priorScope chain nests correctly (verified by parsing and walking the JSON), matching the file's own established convention.
4. [CLEAN][demonstrated] src/qa/kernel-purity-check.ts:302-323 detectConstructorPivotViolation -- Issue #210 fix well-isolated (SE ADR-0003 size/complexity), root-independent by design, disclosed residual (split-across-two-declarations bypass) re-verified true via live probe, header comment honest.
5. [CLEAN][demonstrated] npm test 874/2/0 -- same 2 pre-existing/disclosed/unrelated failures as round-1 (AC1-b, QA-15), no new failures; npm run qa:kernel-purity still PASS.
6. [CLEAN][demonstrated] node --test coverage on kernel-purity-check.ts -- 50/50 pass, 98.17% line / 95.33% branch, clears SE ADR-0005's 80% floor.
7. [CLEAN][code-traced] no new cross-domain ADR collision -- fix-now round touches only the same file family round-1 already cleared (QA script, tests, fixtures, docs); no infra file touched; ADR catalog fingerprint unchanged (83b2e3e) since round-1.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=6
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=6 code-traced=2 derived=0
checks=npm test: 874 pass, 2 fail, 0 skipped (same 2 pre-existing as round-1); node --test --experimental-test-coverage src/qa/kernel-purity-check.test.ts: 50 pass, 0 fail, 98.17% line / 95.33% branch; npm run qa:kernel-purity: PASS, 4 files, 0 violations; live re-probe script: 4/4 alias-call bypass now caught, 1/1 eval control caught (no regression); live test-merge in disposable worktree: CONFLICT confirmed in docs/run-log.jsonl + docs/STATE.md
adr=HIT(35, whole catalog)
report=docs/reviews/kernel-purity-ast-hardening-cross-domain-round2-2026-09-17.md

---

**Addendum (same session, appended not edited per PRINCIPLES rule 11):** at close, git status showed one untracked, uncommitted file not authored by this pass: scratch_half1.txt, an in-progress "App Security Re-confirm" draft report (header identifies it as app-security-reviewer/Horus's own round-2 targeted re-confirm scratch work, consistent with a concurrent Horus session sharing this checkout, mirroring the round-1 addendum's red-team-probe-script observation). Its content independently reproduces the same Issue #211 re-probe result this report reaches (4/4 caught, eval control unregressed) via a separately-written probe script -- consistent corroboration, not something this pass relied on. Left untouched (not mine to alter or clean up); disclosed for the Manager's awareness only, does not change this report's verdict.
