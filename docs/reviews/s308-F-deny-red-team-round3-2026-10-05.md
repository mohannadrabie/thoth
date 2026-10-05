# Red Team (Sutekh): #308 story F ROUND 3 re-confirm (F9b, F10). INCOMPLETE

- Scope: commit 695d3f1 (F9b wrapper bare-name gate, F10 kubectl flag closed set, #418 load forms, #421, #422). CRITICAL tier, held behind THOTH-ADR-0003.
- Date: 2026-10-05. HEAD: 695d3f1. Detached worktree, node_modules and adr junctions. ADR cache: HIT (38).
- Status: this re-confirm did NOT complete. A safety classifier stopped the run partway through the attack phase. No new bypass probes were run against the hook, and this report claims no new finding.

## What was checked
1. Conditions tests at 695d3f1 (shell-wrapper-and-flag-closed-set.test.ts plus activation-preconditions.test.ts): tests 20, pass 20, fail 0, skipped 0.
2. Code read (diff of 695d3f1):
   - F9b, shell.ts normalizeAtDepth: if detectWrapper matches and the raw tokens[0] differs from the normalized tool token, the record is unresolved. Applied at every recursion depth, because each nested inner command goes back through normalizeAtDepth. This matches the round 2 proof-test and closes round 2 Finding 1 as written.
   - F10, shell.ts resolveKubectlShape plus scanFlags: KUBECTL_GRAMMAR_FLAGS = {context}. Any flags key outside that set, or any positional token starting with "-", is unresolved. scanFlags now pushes an unrecognized short `-x=v` form into positional rather than dropping it.
   - #418, protected-path-list.ts specifierOf: new Worker/SharedWorker, member-access `.require(...)` and import.meta.resolve now return "(computed)", so the walk throws. Round 2 Finding 3 is addressed in code.
   - #421: read-by-path now also follows projectDir()/homeDir() roots.

## Attack items requested but not settled (UNPROVEN-pending-verification)
Each needs the named check run by another red-team pass or by the Manager on the real hook at 695d3f1:
- A. Wrapper and nesting paths at depth, including wrappers that are not in the dispatch table. Settles with: a hook-probe corpus extending F9b-corpus/F9b-nested to multi-level nesting and to non-table wrapper names. Each must deny.
- B. Flag forms outside the closed set (glued short flags, `--` separator, repeated --context, context values that are paths or URLs, env-prefix variables, @-file arguments). Settles with: an extension of F10-corpus. Each must deny, or be argued decision-inert.
- C. Whether scanFlags keeps every unknown flag form visible. Settles with: a property test that no token starting with "-" disappears from both flags and positional except --context/-c.
- D. Residual: bare sh/bash resolve, so rc files, BASH_ENV, or PATH ordering are the remaining lever. This is presumed to be settings/PATH territory (#398, #409) per the decisions log; not re-verified here.
- E. #418 residual throw forms and the #421 widening: code-read only (above), no mutant run.

## Verdict
No verdict. The round 2 HIGH (#420 wrapper leg) appears closed in code, and its named test passes, but this pass did not adversarially re-confirm it. Do not treat this report as a red-team go. Next action: re-dispatch the round 3 attack (items A-C) in a fresh pass.

## Editorial
none

RECEIPT: verdict=incomplete (no go issued; the run was interrupted)
attacks:
1. [SUSPICION][MED][code-traced] F9b wrapper gate: the code closes the round 2 leg at every depth; adversarial nesting and non-table wrapper corpus not run (item A).
2. [SUSPICION][MED][code-traced] F10 flag closed set: the code rejects every flags key except context and every dash-prefixed positional token; unusual flag-form corpus not run (items B, C).
3. [SUSPICION][LOW][derived] Bare sh/bash rc/BASH_ENV/PATH lever: presumed #398/#409 territory, not re-verified (item D).
4. [CLEAN][code-traced] #418 load forms now fail closed (throw); #421 projectDir/homeDir read-by-path added (item E, code-read only).
counts: issues=0 suspicions=3 clean=1
evidence: demonstrated=0 code-traced=3 derived=1
checks=20/0/0 (conditions tests at 695d3f1)
adr=HIT(38)
report=docs/reviews/s308-F-deny-red-team-round3-2026-10-05.md
HEAD: 695d3f1
