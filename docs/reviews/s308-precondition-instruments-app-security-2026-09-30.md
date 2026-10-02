# s308-precondition-instruments app-security review (Horus), 2026-09-30

[app-security-reviewer] STANDARD tier. Commit 773fbc2 (test-only). ADR cache: HIT (37 ADRs); no applicable ADR security standard for test-only instruments.
`git show --stat 773fbc2`: 5 files (3 tests, CHANGELOG, plan addendum), 845 insertions, no production file. Confirmed.
Baseline in own worktree at 773fbc2: 57 pass / 0 fail / 0 skipped (3 files). Worktree removed afterwards.

## Verdict: APPROVE-WITH-CONDITIONS
The instruments go red on 18 of 18 in-scope real-file mutants (including the claimed classes). Two gaps let a security-relevant edit pass green; both are cheap and demonstrated, and #308 is still unwired, so nothing is exposed today. Fix before #308 activation cites the instruments.

## Findings (ranked)

1. [ISSUE][MED][demonstrated] R1-6c pins `catalog:` WRITERS by file, not by value. Mutant: `src/policy/gate/tool-routing.ts` line `catalog: ctx.catalog,` -> `catalog: ({version:"x",tools:[]} as never),` => `node --test src/qa/catalog-single-source.test.ts` 14 pass / 0 fail. A hand-built (empty) catalog reaches the kernel with the funnel test green. Attack: a change in an already-pinned writer file hands the gate a catalog with no classifications. Fix: pin the writer's value expression (`ctx.catalog` in tool-routing.ts, shorthand `catalog` in decide-tool-call.ts) rather than the file. Exposure: ~100% of gated MCP/Bash calls if the mutation lands after #308 wiring, basis: counted in code (single route, decide-tool-call.ts:80-81 -> tool-routing.ts:60); 0% today (gate unwired). Failing test to add: "R1-6c: the writer value in tool-routing.ts is exactly ctx.catalog".
2. [ISSUE][MED][demonstrated] AC-3j-4 dedups env sites by `file|scope|what`, so a NEW read of an already-pinned shape inside a pinned function is invisible. Mutant: in `central-source.ts resolveSystemRegExePath` add `const leak = process.env.PATH;` => hook-import-pins 32 pass / 0 fail. Same for `process.env.X`/`process.cwd()` inside `projectDir`. Attack: widen the environment surface that picks reg.exe (SystemRoot-class risk, #320/X-8) without touching the allow-set. Fix: record occurrences with the property text (or a per-site count) in the pinned key. Exposure: 1 pinned function on the win32 central-policy path, reachable from `central.defaultCentralPolicySource` on every win32 call, basis: counted in code. Failing test to add: "AC-3j-4: a second process.env read in resolveSystemRegExePath changes the site set".
3. [SUSPICION][LOW][demonstrated] AC-3j-4 ambient routes omit `eval`, the `Function` constructor and `(()=>{}).constructor(...)`. Mutants in sanitize.ts (`eval("process.env")`; `(()=>{}).constructor("return process")().env`) => 32 pass / 0 fail. Needs a deliberate evasion inside the graph (assembled-name shapes are already disclosed); add `eval`, `Function`, `.constructor` to the flagged set.
4. [SUSPICION][LOW][demonstrated] R1-6c enumerator skips any dir named `test-support`, `*.test.*` names and non-`.ts/.mjs/.js` extensions (`.mts`, `.cjs`): a production module so named that defines a `loadCatalog` port stays green (three planted files, all 14 pass). Matters only if it is in the hook's import graph; AC-3j-4 still scans its env reads. Fix: scan every file in the AC-3j import graph regardless of name.
5. [SUSPICION][LOW][code-traced] AC-3j-4 ENV_BUILTINS omits `fs`, `net`, `http(s)`, `dns`. A `node:fs` import in the graph (reading /proc/self/environ) is green (mutant: 32/0). Bare `child_process` without `node:` IS a violation. Hardening only.
6. [SUSPICION][LOW][demonstrated] AP-12 set is Bash/SlashCommand/Task/PowerShell/Skill/Workflow/CronCreate/RemoteTrigger. `NotebookEdit` at read-only and an MCP entry `shell-exec` at read-only are green (11 pass / 0 fail). MCP is disclosed in the header; NotebookEdit does not itself execute. Optional: flag any central `read-only` entry for review. No lowering path is unread: classification has exactly two layers (built-in, central; precedence.ts:384; only production caller classification-catalog.ts:123), no project layer, and the lowering guard runs before the merge.
7. [CLEAN][demonstrated] AC-3j graph completeness: `export * from`, `export {..} from`, dynamic `import("./x.ts")` literal, type-only import, `node:module` all go red; extensionless specifier and directory/index import go red (unresolvable / EISDIR, fail closed). `import x = require()` and `.json` imports are not followed, but neither loads under Node type-stripping / neither executes.
8. [CLEAN][demonstrated] Real-file mutants red: new env fn in central-source.ts; hook uses `catalog.projectDir` (AC-3j-1 and R1-6c); Bash/Task/SlashCommand read-only in built-in layer; central fixture Task, PowerShell, lowercase `bash` at read-only; hook returns `.builtinLayer`; hook uses env location; second `loadCatalog` in new src file; gate call site replaced by literal. Synthetic controls are backed by these (the scans they exercise fire on real files).
9. [CLEAN][code-traced] No production code changed in 773fbc2.

## Blockers vs hardening
Blockers: none. Conditions (before #308 activation cites these instruments): findings 1 and 2. Hardening: 3-6.

## Editorial
None.

Mutant log (own worktree, reverted): A1,A2,B1-B4,B7,B8,C1-C6,D1,D2,D4,D5 red; A3,A4,A5,A6,B5,B9,C7,C8,D3,E1-E3 green (findings above; B5/B9 harmless).

Next action: story-implementer adds the two failing tests (findings 1, 2) and tightens the pins.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] tool-routing.ts:60 `catalog:` writer pinned by file; a literal catalog there stays green (catalog-single-source.test.ts 14/0); pin the value expression
2. [ISSUE][MED][demonstrated] hook-import-pins.test.ts scanEnvSites dedups sites; extra process.env read inside resolveSystemRegExePath stays green (32/0); key by occurrence
3. [SUSPICION][LOW][demonstrated] AC-3j-4 ambient routes miss eval / Function / .constructor (32/0)
4. [SUSPICION][LOW][demonstrated] R1-6c enumerator skips test-support dirs, *.test.* names, .mts/.cjs (14/0)
5. [SUSPICION][LOW][code-traced] ENV_BUILTINS omits fs/net/http(s)/dns
6. [SUSPICION][LOW][demonstrated] AP-12 set misses NotebookEdit and MCP exec-named entries at read-only (11/0); MCP disclosed
7. [CLEAN][demonstrated] AC-3j graph follows export-star/from, dynamic literal, type-only, node:module; extensionless and index fail closed
8. [CLEAN][demonstrated] 18 real-file mutants across the three instruments go red
9. [CLEAN][code-traced] no production code changed (git show --stat 773fbc2)
counts: issues=2 suspicions=4 clean=3
evidence: demonstrated=7 code-traced=2 derived=0
checks="57/0/0"
adr=HIT(37)
report=docs/reviews/s308-precondition-instruments-app-security-2026-09-30.md
