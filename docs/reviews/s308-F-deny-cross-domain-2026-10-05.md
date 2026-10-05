# s308 story F (AP-10 deny rules, F4, F8) - cross-domain review (Ra)

[cross-domain-reviewer] Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes
Diff e9c1638..9e238c5, CRITICAL tier, HELD behind THOTH-ADR-0003 (proposed; not a finding). Read at the commit via git archive into a scratch dir (removed).
ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 702b16a) [CACHE=HIT]

## Lanes that ran
- app-security-reviewer (docs/reviews/s308-F-deny-app-security-2026-10-05.md): path-form bypasses (ADS, trailing dot), parent-dir move/delete, tool-inventory.json unprotected, Edit() vs Bash, case sensitivity, loader levers. Not re-listed here.
- red-team runs in parallel (report not read before this pass).
- Ground checked here: ADRs outside security/code, wired enforcement points outside the PreToolUse graph, decisions rows vs code, K text vs J5/J9/K5, CI wiring, #406 closure.

## ADR verdict (whole catalog, 38; none filtered)
- SE ADR-0002 layering: OK. protected-path-list.ts imports downward only; kernel-purity and normalizer-registry-purity PASS.
- SE ADR-0005 testing / recorded acts: OK. Changed expectations are recorded in the decisions row 2026-10-05; 60/60 shell mutants killed.
- SE ADR-0010 quality gates: OK. hook-typecheck-coverage PASS (both hooks at 0 diagnostics).
- ADR-0016/0019/0020/0021 self-protection, fidelity, native kernel: OK for the diff; see finding 1 on protection scope.
- THOTH-ADR-0001: OK, fixture deny rule present (F3a mutant). THOTH-ADR-0002: n/a.
- THOTH-ADR-0003 (proposed): F held per its rule 4; no ship claim. Not a finding.
- devops ADR-0001..0010 and SE ADR-0004/0006-0009/0011-0015: not applicable (no infra, data, cloud or ops surface in the diff).
No ADR collision.

## Seam findings

### 1. [ISSUE][MED][code-traced + demonstrated] Two wired enforcement hooks and one private import are outside the protected list
- .claude/settings.json:148-170 wires hooks/sessionstart-tool-enum.mjs (SessionStart) and hooks/userpromptsubmit-halt-relay.mjs (UserPromptSubmit) today. The relay header calls itself the ACTUAL halt point. The CLAUDE.md Sensitive areas section names any hooks/* enforcement point wired to UserPromptSubmit and the code that reads/writes the halt-state directory.
- The generated half is the PreToolUse hook import graph only, so it cannot produce these. The named half has the halt-state directory (protected-path-list.ts, namedPaths) but not the scripts that write and read it, nor src/policy/tools/mcp-enumeration.ts (imported only by the SessionStart hook).
- Demonstrated (scratch tree at 9e238c5), protectedPaths(root).all.includes(path): hooks/userpromptsubmit-halt-relay.mjs false; hooks/sessionstart-tool-enum.mjs false; src/policy/tools/mcp-enumeration.ts false. The K proposal has no Edit entry for them either.
- Effect: after K a session can Edit those scripts (the gate refuses non-Bash tools; permissions.deny lacks them) and neuter the halt relay or the SUR-03 enumeration while the halt-state directory itself stays denied.
- Exposure: ~100% of enforcement files outside the PreToolUse graph (3 of 3), basis: counted in code. Reachable only once the gate is wired; no live exposure today.
- Minimal fix: add the three paths to namedPaths() (and the F1 named array in the test), run node src/qa/protected-path-list.ts --write (41 becomes 44 paths, K proposal follows).

### 2. [ISSUE][LOW][demonstrated] Q2 ruling said cwd-resolve; code is lexical only; the decisions row does not record the narrowing
- Decisions row 2026-10-04 Q2: canonicalize redirect targets (cwd-resolve, backslash, dot-dot, case). path-canonical.ts deliberately does not resolve. CHANGELOG discloses it; decisions.md does not.
- Demonstrated with shipped rules and a resolved record: a redirect to .thoth/policy.json is denied; a redirect to the absolute /c/playground/thoth/.thoth/policy.json, the drive form C:/playground/thoth/.thoth/policy.json, a PWD-variable prefix, and a HOME-variable prefix on the user settings file are all allowed.
- Exposure: 0% today (POL-05 denies first); once E0 emits resolvable writes, every absolute-form write to a protected path. Basis: measured above.
- Seam: the #406 closure rests on K Edit entries for built-in tools and on F rules for Bash after E0; the latter fails on absolute forms.
- Minimal fix: one decisions row recording the narrowing, plus an E0 acceptance criterion that an absolute, drive-lettered or variable/tilde-user producer target is unresolved. Not filed (LOW).

### 3. [ISSUE][LOW][code-traced] qa:protected-path-list is wired nowhere in CI
- package.json:37 defines it; .github/workflows/ci.yml has no step; no test calls main(). npm test covers protect-* rule drift (F-committed) and the proposal (F5), but not the version string or the serialization of non-protect rules, which only the CLI compares.
- Fix: a CI step, or one test calling main with no args and expecting 0. Not filed (LOW).

## Seams checked, sound
- F8 vs runbook / launcher / story B: docs/runbooks/policy-load-recovery.md has no redirect in a gated command; npm run policy:print is already POL-05-unresolved before F (E0, #408). The launcher is run by the runtime, not through the gate. Normalizer probe: echo x redirected to a file, and cat a appended to .claude/settings.json, now carry verb write, canonical target and unresolved, as claimed.
- Halt-state directory is on the list with a /** Edit entry; Q3 verbs match CHANGELOG; read and execute stay free (F-read-free).
- K proposal vs J5/J9/K5/#401: it holds only permissions.deny, no hook entry, so the K5 pinned launcher form and the J9 args choice are untouched. package.json type is not a lever (demonstrated: removing it only prints MODULE_TYPELESS_PACKAGE_JSON, gate still denies).
- #406 closure: CHANGELOG (closes only when K ships the settings protection) is accurate. F alone closes nothing; with K it covers project/local/user settings for built-in file tools; Bash writes stay blocked by POL-05 until E0 (finding 2).
- CHANGELOG and test-header claims match the code: verbs, one rule per path, path count printed by the instrument.

## Coverage gaps named
- .github/workflows/ci.yml, .gitleaks*, src/secret-scan/* (CLAUDE.md sensitive areas): not claimed by AP-10 (session-gate self-protection); detective, human-reviewed at merge. Intentionally uncovered, not a finding.
- .git/*, .gitattributes: ruled, go with E0.

## Editorial
- None.

## Verdict: APPROVE-WITH-CONDITIONS
Condition (fix-now, small, before K): finding 1. Single next action: add the three wired-hook paths to namedPaths(), run node src/qa/protected-path-list.ts --write, rerun the activation test.

## Evidence run
- node --test activation-preconditions, shell-redirect-decorates, path-canonical tests: tests 15 pass 15 fail 0 skipped 0.
- node src/qa/protected-path-list.ts: PASS, 41 protected paths.
- QA set PASS: kernel-purity, normalizer-registry-purity, gate-command-path, gate-manifest, shell-detector-mutants (60 of 60), gate-path-scaling-sweep, hook-typecheck-coverage, gate-latency-budget (p99 299 ms).
- Full node --test in a git-less archive: tests 1897 pass 1886 fail 11 skipped 0. The 11 are OSS-01/QA-14/QA-15/R4/R187 (need .git) and one latency test that passes standalone; none touch the diff. Not run in the real tree.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][code-traced] src/qa/protected-path-list.ts namedPaths - wired SessionStart/UserPromptSubmit hooks (settings.json:148-170) and mcp-enumeration.ts not on the list (demonstrated false, 3 of 3); add to namedPaths, --write
2. [ISSUE][LOW][demonstrated] src/policy/normalizer/path-canonical.ts:1 - Q2 cwd-resolve not done, absolute and variable forms allowed once resolvable; record narrowing, add E0 criterion
3. [ISSUE][LOW][code-traced] package.json:37 - qa:protected-path-list not in ci.yml or any test; version and non-protect serialization unchecked in CI
4. [CLEAN][demonstrated] F8 vs runbook/launcher/story B: nothing documented-allowed now denies
5. [CLEAN][code-traced] halt-state dir, Q3 verbs, read-free match CHANGELOG
6. [CLEAN][demonstrated] K proposal vs J5/J9/K5/#401 and package.json type: no conflict
7. [CLEAN][code-traced] #406 closure claim accurate (K needed; Bash side rests on POL-05 until E0)
8. [CLEAN][code-traced] CHANGELOG/test-header claims match code; whole-catalog ADR pass, no collision
counts: issues=3 suspicions=0 clean=5
evidence: demonstrated=3 code-traced=5 derived=0
checks=15 pass/0 fail/0 skip (F tests); 8 qa checks PASS; full suite in git-less archive 1886 pass/11 fail/0 skip (all .git- or load-dependent, none in diff)
adr=HIT(38, whole catalog)
report=docs/reviews/s308-F-deny-cross-domain-2026-10-05.md
HEAD: 9e238c5
