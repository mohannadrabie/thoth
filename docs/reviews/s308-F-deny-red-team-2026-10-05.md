# Red Team (Sutekh) — #308 story F (deny rules / gate self-protection, AP-10, F8=#411)

- Scope: e9c1638..9e238c5 (single commit 9e238c5), CRITICAL tier, HELD behind THOTH-ADR-0003 (PROPOSED — not a finding).
- Date: 2026-10-05. HEAD: 9e238c5. ADR cache: HIT (38 ADRs; full catalog via adr submodule junction).
- State honestly: the gate is UNWIRED (no .claude/settings.json PreToolUse entry) and defaultOutcome is bootstrap allow. All probes run the real hook (node hooks/pretooluse-kernel-gate.mjs on PreToolUse JSON) in a detached 9e238c5 worktree. Live exposure of every finding is 0% today because nothing is enforced.

## Method
Ran the real hook against ~35 crafted commands; ran the F story tests (15/15 pass); probed the generated-list AST walk with an injected require() dependency; ran a latency sweep to 60k tokens.

## Findings (ranked by blast radius)

### 1. [ISSUE][MED][demonstrated] Generated protected-path list silently omits require()/createRequire deps; F3 add-import mutant tests static import only
src/qa/protected-path-list.ts specifierOf() recognises ImportDeclaration, ExportDeclaration (export-from), and import() CallExpressions with a literal specifier. A require("./x") / createRequire(import.meta.url)("./x") is a CallExpression on an Identifier, not ImportKeyword, so specifierOf returns undefined and the dependency is never queued. The header claims the generated half is "every module in its relative-import graph" — false for require-form deps.

Demonstrated (hook whose only dependency is require("./secret-sibling.ts")): generator returns protected count 1, secret-sibling protected? false, only hooks/pretooluse-kernel-gate.mjs listed.

The F3-mutant-add-import test (activation-preconditions.test.ts:109-114) injects a static import "./synthetic-extra-module.ts" only — it passes, so no test catches the require-form hole. A future gate module pulled in via require/createRequire goes unprotected with every gate green.

- Exposure: ~0% of runs today, basis: counted-in-code — 0 production modules in the live hook closure use require (the 3 require( hits are all *.test.ts, not in the graph); gate unwired. Latent integrity gap in a self-protection instrument.
- Proof-test before activation: extend F3-mutant-add-import with a require()/createRequire form; it must fail today. Teach specifierOf to follow require, or make a require/unresolvable specifier throw (fail-closed, matching the existing computed and non-relative throws).

### 2. [SUSPICION][LOW][demonstrated] Tool-token blindness: a decoy makes a destructive binary resolve as a clean READ record (premise of F deny rules)
The shell normalizer ignores the binary name and resolves the verb from the first positional after it; so "rm get pods/x --context=prod", "cp get .claude/settings.json --context=c", "truncate get pods/x -s0 CLAUDE.md --context=c", "python get pods/x --context=c" each produce a clean read record and are allowed (bootstrap default-allow). This is why F path deny rules fire on nothing via shell today. Not a new F defect: tracked by #414 (PT-2 verb-read) and owned by E0 (#408); the 2026-10-05 decisions row discloses "F path deny rules are defence in depth until #408; today POL-05 denies first." Named as story F scariest standing assumption, not re-filed.

### 3. [CLEAN][demonstrated] F8 — no redirect/fd form lets a non-resolving command through as allow
Ran against the real hook: single-gt, append, 1gt, 2gt, 9gt, ampersand-gt, gt-ampersand, lt-gt, gt-pipe, no-space glued, heredoc, process substitution. Each denies — via REDIRECT_DECORATES_UNRESOLVED (POL-05), the #82 multi-target cap, or the chain/substitution scan. "rm -rf hooks > /dev/null" (the #411 repro) now denies. F8-corpus test (rm, python -c, node -e, sed -i, git checkout + redirect, 11 commands) green; F8-controls confirms a self-resolving command is unchanged and 2-ampersand-1 is not a file target. No input resolves to a single clean write target (redirect-only is F8-unresolved; redirect+resource is 2 targets, POL-05).

### 4. [CLEAN][demonstrated] Quadratic fix — no super-linear input within 60s
canonicalizePathTarget runs only after the under-2-target guard (<=1 target per call). Latency: glued-gt x60000 = 115ms; resource-dense x60000 = 213ms; dotdot x60000 = 185ms. All sub-250ms.

### 5. [CLEAN][demonstrated] F4 canonicalization matches once a record resolves
F4 test green (70ms): case, backslash, dot-slash, dotdot, double-slash, absolute and cwd-relative forms reach the record in canonical project-relative lowercase form and are denied. Residual forms disclosed in the function header; trailing-dot/space and ADS already filed (#416). Absolute/drive/PWD-var/tilde-user/8.3 deliberately never equal a project-relative target (disclosed, fail-closed direction — under-match only, POL-05 denies first today).

### 6. [CLEAN][demonstrated] F3 / F3a mutants fail as designed
15/15 F story tests pass. F3-mutant-drop-rule, F3-mutant-add-import (static), F3a-mutant-drop-fixture-deny all fail on the mutant as required. (Add-import mutant completeness is Finding 1.)

### 7. [CLEAN][demonstrated] F8 breaks no legitimate allow path
F8-controls confirms a self-resolving command is unchanged and the fd-dup idiom is not a file target. The only new denials are genuinely-unresolvable redirect-decorated commands (echo x redirect file, denied until E0) — intended, disclosed in the 2026-10-05 decisions row.

## Raw evidence
Hook probes (default-allow, unwired): "rm -rf hooks > /dev/null" deny (POL-05 redirect decorates F8); "echo x > .thoth/policy.json" deny (F8); "kubectl get pods/x --context=prod" ALLOW (clean read); "rm get pods/x --context=prod" ALLOW (tool-blind, Finding 2); "truncate get pods/x -s0 CLAUDE.md --context=c" ALLOW (tool-blind); "kubectl get pods/x --context=prod >hooks/x" deny (#82 multi-target); fd forms and glued redirect to hooks all deny; ">| hooks/.." deny (chain operator pipe).
F story tests: node --test -> tests 15, pass 15, fail 0, skipped 0.
Generator drift check: protected-path-list PASS, 41 protected paths.
require-blindness probe: generator returns 1 path, sibling unprotected.
Latency: glued-gt x{1k,5k,20k,60k}=12/17/20/115ms; resources x=10/24/119/213ms; dotdot x=2/9/79/185ms.

## Scariest unproven assumption + go/no-go
Scariest: the tool token is ignored, so a decoy verb makes a destructive binary resolve as read (Finding 2) — benign today only because POL-05/multi-target deny first and the gate is unwired; the load-bearing assumption E0/#408 must close before K wires the gate. For story F itself, the deny mechanism and F8 survive intact.

Verdict: go (story F sound; HELD behind THOTH-ADR-0003). One MED (Finding 1) is a latent completeness gap in the self-protection generator at 0% current exposure — does not block the held story but must become a failing test before activation (K).

Single next action: extend the F3 add-import mutant to a require()/createRequire form (it must fail), then make specifierOf follow or fail-closed on require specifiers.

RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated] Generated protected-path list omits require()/createRequire deps; F3 add-import mutant tests static import only — future gate module via require goes unprotected, all gates green. Exposure: ~0% of runs, basis: counted-in-code (0 production closure files use require; gate unwired).
2. [SUSPICION][LOW][demonstrated] Tool-token blindness: rm/cp/truncate/python get ... resolve as clean READ and allow (default-allow) — F premise; tracked #414/#408, not re-filed.
3. [CLEAN][demonstrated] F8: no redirect/fd form lets a non-resolving command allow.
4. [CLEAN][demonstrated] Quadratic fix: 60k-token glued/resource/dotdot inputs all <250ms.
5. [CLEAN][demonstrated] F4 canonicalization matches once record resolves; residual forms disclosed, #416 tracks ADS/trailing-dot.
6. [CLEAN][demonstrated] F3/F3a mutants fail as designed (15/15 F tests pass).
7. [CLEAN][demonstrated] F8 breaks no legitimate allow path (controls green).
counts: issues=1 suspicions=1 clean=5
evidence: demonstrated=7 code-traced=0 derived=0
checks=15/0/0 (F story tests) + generator PASS + ~35 hook probes + latency sweep
adr=HIT(38)
report=docs/reviews/s308-F-deny-red-team-2026-10-05.md
HEAD: 9e238c5
