# Cross-domain review: #308 story D (AP-13 launcher), 2026-10-02

[cross-domain-reviewer] Ra. Tier CRITICAL. Lanes alongside: red-team and app-security-reviewer (env handling, exit mapping, attack surface). Ground I did not re-cover: launcher exploitability, shell levers, exit mapping.
📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 702b16a) [CACHE=HIT]. Whole catalog read, unfiltered.

## Cross-domain ADR verdict
- SE ADR-0005 (locked tests replaced as a recorded act): MET. Commit aa80117 holds only the probe module, its test and the red-run evidence; the locked tests (SUR-10 expectedProceeds, A5, memory row, unparseable row, A20) are replaced with stronger assertions (observed BLOCKS plus a direct-run control per row), not deleted or weakened. The decisions.md row (fd8714c, same PR) names the five ids, old and new outcome, reason and disclosed limits. Order is act-then-row in one PR, which the plan section 6 anticipated. Human column says "Y (pre-approved)"; the only pre-approval precedent rows are the 2026-09-30 S7 close-out rows, none naming D. Editorial, not a finding.
- SE ADR-0010 (gates): MET. `npm test` (node --test) picks up the 4 D test files: 51 pass, 0 fail, 0 skipped on this Windows host. hooks/launch-gate.sh is not enumerated by hook-typecheck-coverage (listProductionHooks takes .mjs/.js only, hook-typecheck-coverage-check.ts:138), so the .sh is neither covered nor choked; its integrity gate is the SHA-256 pin run under npm test. qa:gate-manifest PASS, qa:gate-command-path PASS, pin check PASS. No eslint/ts suppressions added.
- THOTH-ADR-0003 (proposed): D adds no allowlist or fixture entry; handoff to F is already in the plan (F1a names the launcher shim). Not violated.
- ADR-0021 / ADR-0019/0020 kernel purity and self-protection: launcher is under hooks/, outside src/ kernel boundaries; no kernel import. Not violated.
- Remaining ADRs (devops IaC/CDK set, data, cost, tagging, SE 0001-0004, 0006-0009, 0011-0016): no collision in the diff (no infra, schema, tags).
- CI: ci.yml runs `npm test`, which covers the pin check (gate-launcher-pin-check.test.ts) and launcher tests. .gitattributes `* text=auto eol=lf` covers .sh (`git ls-files --eol`: i/lf w/lf attr eol=lf), so the pinned hash is stable on a Windows autocrlf checkout. Secret-scan surface untouched.

## Seam findings
1. MED, code-traced, ISSUE. The probe now records the five launch faults as BLOCKS "through the launcher" (gate-fail-open-probe.ts:83-87), but nothing in D, J or K structurally asserts that the wired PreToolUse entry actually invokes the launcher. gate-command-path-check.ts only checks that every named script exists (`checkCommandPaths`, resolves each path); gate-manifest, matcher-drift and latency checks never read the command shape. J2 reruns exactly those four checks; K3 adds only a permissions.deny check. A PreToolUse entry written as bare `node "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs"` passes every check while the probe rows keep reporting AP-13 closed. Domains in tension: probe/evidence lane (rows claim closure) vs settings/wiring lane (J, K). Exposure: 0% today (settings.json has no PreToolUse entry; counted in code), 1 of 1 future gate entry at K; silent if wrong. Minimal fix: add to J/K one check (or one `activation-preconditions` assertion) that the PreToolUse gate entry's command matches `sh "..launch-gate.sh" "..pretooluse-kernel-gate.mjs"`, with a seeded bare-node mutant that must fail. Failing test name: `K-pretooluse-entry-uses-launcher`.
2. LOW, code-traced. gate-latency-budget-check.ts:111 times `node "<gate>"` directly; the budget gate J reruns never times the `sh launcher gate` form. Measured overhead is +32 to +89 ms on a 2000 ms ceiling (spike S8), so low risk; J6 should time the launcher form, not only the allow path. Hand to J.
3. LOW, code-traced. F's list (plan F1a) names the shim but not src/qa/gate-launcher-pin-check.ts, where the pin constant lives; the file header says F's deny rules "cover both paths". With the shim denied the pin matters little, but the sentence is not yet true. Add the pin file to F1a or soften the header.

## Seams checked, sound
- command-path check: `extractScriptPaths` (quoted tokens first) resolves both .sh and .mjs for the string `sh "${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh" "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs"`; matches the plan's J string. [CLEAN]
- qa gates mutating tracked files: `git status` after running the D tests, pin check, command-path, gate-manifest shows no tracked file changed. src/qa/vendor-tool-inventory.ts:199 writes docs/qa/tool-inventory.json by design unless `--dry-run`; it is a vendoring command, not a CI gate (absent from ci.yml), and its last tracked change is story C (26a9ed1). Pre-existing behaviour. [CLEAN] hook-typecheck-coverage writes only under `--regenerate-baseline`.

## Coverage gaps
- Linux CI: `D2-env-shell-levers-block` and `D2-disclosed-limit-256` are skipped off win32, and the SYSTEMROOT guard and row are win32-only, so ubuntu CI does not exercise them (skipped is not passed). The Windows-only runtime makes this intended; the rest of the suite should run on Linux (`/usr/bin/env`, `sh`). I could not run Linux: UNPROVEN-pending-verification; settle with the first CI run on this PR, `gh run view` skipped count.
- hooks/launch-gate.sh is covered by no linter or typechecker (no shell lint exists in the repo); the pin plus tests are its only gates. Intentional per plan; low risk.

## Verdict: APPROVE-WITH-CONDITIONS
Condition: finding 1 handed to J/K as a named test before K can merge (Issue filed). Findings 2 and 3 are J and F notes.
Next action: add `K-pretooluse-entry-uses-launcher` to the J/K criteria in docs/plans/s308-activation-phase0-2026-10-02.md.

Editorial: decisions row "Y (pre-approved)" cites no pre-approval source.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][code-traced] gate-fail-open-probe.ts:83-87 vs gate-command-path-check.ts — nothing asserts the wired PreToolUse entry uses the launcher; add `K-pretooluse-entry-uses-launcher` with bare-node mutant (J/K).
2. [ISSUE][LOW][code-traced] gate-latency-budget-check.ts:111 — budget times direct node, not the launcher form; J6 to time `sh launcher gate`.
3. [ISSUE][LOW][code-traced] src/qa/gate-launcher-pin-check.ts:3 header — F1a does not name the pin file; add it or soften the sentence.
4. [SUSPICION][LOW][derived] Linux CI skips 2 win32-only tests and the SYSTEMROOT row; ubuntu run of the suite not proven here.
5. [CLEAN][demonstrated] SE ADR-0005 recorded act (aa80117 + fd8714c), no test weakened.
6. [CLEAN][demonstrated] hooks typecheck/lint/manifest/pin gates and .gitattributes LF on the .sh; no tracked file mutated by qa runs.
counts: issues=3 suspicions=1 clean=2
evidence: demonstrated=2 code-traced=3 derived=1
checks=node --test (4 D files): 51 pass / 0 fail / 0 skip; qa:gate-launcher-pin PASS; qa:gate-command-path PASS; qa:gate-manifest PASS; git status clean of tracked mutations
adr=HIT(38, whole catalog)
report=docs/reviews/s308-D-launcher-cross-domain-2026-10-02.md
