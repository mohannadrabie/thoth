# Red Team: s308-455 delta re-confirm (round 1 fix-now), HEAD 82bea47

- Scope: s308-455 delta re-confirm, HEAD 82bea47 (CRITICAL). Delta: git diff 08cd8b8 82bea47 (56897fe tests, 82bea47 fixes).
- Worktree: C:\playground\thoth-kb-rev2 (detached 82bea47). Reviewer: red-team (Sutekh). Date: 2026-10-06.
- ADR cache: HIT, 38 ADRs [adr/devops:12, adr/software-engineering:23, docs/adr:3], fp da6ef03.
- Verdict: go (no HIGH). #473, #474, suspicion 4 and app-security LOW 1 are FIXED. Four new MED latent silent drops remain (current exposure ~0 percent). They are the same class as #473/#474, so I recommend fixing them now on this branch.

## Correction to my round-1 report (s308-455-red-team-2026-10-06.md)

My round-1 findings 8 and 10 were marked CLEAN, but my own probe output contradicted them:
- Finding 10: the quoted-variable form (quote CLAUDE_PROJECT_DIR quote, then /docs/x.mjs) came back scripts=[] outside=1. The in-repo script was classified as outside the repo. The dotdot row was never actually tested (my sed corrupted that row).
- Finding 8: an aliased process.execPath child, a flag-first argument list child, and an import-then-spawn child were all left unfollowed with no throw.
Those verdicts were wrong, and I am correcting them here. The aliased case is now fixed (it throws). The other two are new findings 2 and 3 below. The quoted-variable form is new finding 1.

## What I ran

- Attack harness (scratchpad, imports pluginHookScan and commandFullyAccounted from rev2, injected reader, 30 command shapes and synthetic spawn chains). Raw rows quoted per finding.
- node src/qa/protected-path-list.ts -> PASS, 132 protected paths (3 from plugin hooks), exit 0.
- node src/qa/f1-settings-named-scripts-judged.ts -> PASS, 3 plugin-hook script(s) protected; 1 note, exit 0.
- Live derivation: ["docs/adr-cache.mjs","docs/decisions-archive.mjs","docs/session-brief.mjs"], the same 3 as round 1.
- node --test over protected-path-list.plugin-hooks, f1-settings-named-scripts-judged, protected-path-list, k-readiness -> tests 59, pass 59, fail 0, skipped 0. installed-live skipped per instruction.

## Findings (ranked by blast radius)

### 1. [ISSUE][MED][demonstrated] Quoted-variable CLAUDE_PROJECT_DIR form is classified outside the repo, so the in-repo script stays unprotected and F1 passes
Rows: [quoted-var CPD (documented)] acct=true scripts=[] out=1 unenum=0; [quoted-var braced] same. The token splitter breaks at the closing quote and yields /docs/x.mjs, which classifyToken treats as absolute (outside). commandFullyAccounted accepts the shell word because it ends in .mjs. Result: reported as outside, not protected, F1 PASS. Quoting the variable and leaving the path outside the quotes is the form the Claude Code hooks docs show for project scripts.
Exposure: ~0 percent of current runs, basis: counted in the live snapshot (no plugin uses CLAUDE_PROJECT_DIR). Proof-test: plugin-hooks: quoted-variable CLAUDE_PROJECT_DIR form resolves in-repo and is protected.

### 2. [ISSUE][MED][demonstrated] A node spawn whose argument list starts with a flag is not followed and does not throw
Row: [flag-first arg] spawnSync(process.execPath, ['--no-warnings','docs/hidden2.mjs']) -> scripts=[docs/flag.mjs], hidden2 absent, no throw. spawnedScripts checks only args.elements[0]; a flag there is skipped silently.
Exposure: ~0 percent, basis: counted (the three live scripts put the script first). Proof-test: spawn-follow: flag-first argument list follows the script or throws.

### 3. [ISSUE][MED][demonstrated] A spawn inside a file reached only by import is never followed
Row: [import chain] root.mjs imports lib.mjs, and lib.mjs spawns child-via-import.mjs -> scripts=[docs/root.mjs], child not followed, unenum=0. The spawn-follow queue holds only spawn and command targets. importGraphFiles adds lib.mjs to the list but never runs spawnedScripts on it.
Exposure: ~0 percent, basis: counted (the three live scripts import only node: modules). Proof-test: plugin-hooks: spawn inside an imported module is followed.

### 4. [ISSUE][MED][demonstrated] bash -c / sh -c bodies are only checked to name a script, so an extensionless sibling inside the body is dropped
Row: [bash -c body w/ script] bash -c "node docs/x.mjs; docs/run" -> acct=true, scripts=[docs/x.mjs], unenum=0. The disclosed limit names only the inline node -e body. -c is in INLINE_FLAGS, and a shell body could be checked by running shellSimpleCommands on it recursively.
Exposure: ~0 percent, basis: counted. Proof-test: plugin-hooks: shell -c body is accounted like a top-level command.

### 5. [ISSUE][LOW][demonstrated] Disclosed residuals: a node -e body that runs an extensionless program, and .exec on a non-cp namespace alias
Rows: [node -e spawns run] acct=true unenum=0; [namespace exec] proc.exec(...) -> no throw, child unfollowed. Both are within the builder's two disclosed limits. Residual register; no Issue filed (LOW).

### 6. [CLEAN][demonstrated] #473 FIXED
[473 no-ext sibling] acct=false unenum=1, so F1 fails until the command is judged.

### 7. [CLEAN][demonstrated] #474 FIXED
[474 concat -e] abs=1 unenum=1, so F1 fails. [PWD var] is unresolved -> unenum=1.

### 8. [CLEAN][demonstrated] Suspicion 4 FIXED: execSync in a followed script throws
[execSync child] THROWS: a spawned script that cannot be followed statically.

### 9. [CLEAN][demonstrated] App-security LOW 1 FIXED: a spawn with an aliased program throws
[aliased execPath] THROWS.

### 10. [CLEAN][demonstrated] Shell-operator bypasses fail closed
Each of these gives unenum=1: semicolon, pipe, double-pipe true, newline, paren subshell, FOO=1 docs/run, env node, cmd /c, cmd /c node with an ampersand sibling, pwsh -Command, pwd command-substitution, npm run. FOO=1 node docs/x.mjs is correctly accounted and protected. Backslash, dotdot-lexical and braced-in-quotes all resolve in-repo and are protected.

### 11. [CLEAN][demonstrated] Live snapshot unchanged; generator and F1 pass
The same 3 scripts are derived, the generator reports PASS 132, F1 passes, and the tests run 59/59.

### 12. [SUSPICION][MED][derived] Carried forward, unchanged: snapshot-vs-live is checked only locally, and CI reports unverified (disclosed)

## Scariest unproven assumption

Finding 12 is unchanged. Among code defects, finding 1 is the most likely real trigger, because the quoted-variable form is the documented hook idiom.

## Go / No-go

GO: no HIGH, and all remaining breaks are latent. I recommend fixing findings 1-4 now on this branch, as with #473/#474.

## Next action

Add the four named proof-tests (red), then fix: split shell words with quote removal before classifying; scan every literal arg in a node spawn (or throw on a leading flag); run spawnedScripts over the plugin import closure; run the -c body through shellSimpleCommands.

RECEIPT: verdict=go
1. [ISSUE][MED][demonstrated] quoted-var CLAUDE_PROJECT_DIR form classified outside -> in-repo script unprotected, F1 PASS
2. [ISSUE][MED][demonstrated] flag-first node spawn arg list unfollowed, no throw
3. [ISSUE][MED][demonstrated] spawn inside import-closure file never followed
4. [ISSUE][MED][demonstrated] bash/sh -c body only checked to name a script; extensionless sibling dropped
5. [ISSUE][LOW][demonstrated] disclosed residuals: node -e body running an extensionless program; .exec on a non-cp alias
6. [CLEAN][demonstrated] #473 FIXED (unenumerable, F1 fails)
7. [CLEAN][demonstrated] #474 FIXED (assembled/missing -> unenumerable)
8. [CLEAN][demonstrated] suspicion 4 FIXED (execSync throws)
9. [CLEAN][demonstrated] app-sec LOW 1 FIXED (aliased program throws)
10. [CLEAN][demonstrated] semicolon, pipe, double-pipe, newline, subshell, env, cmd /c, pwsh, command-substitution, npm all fail closed
11. [CLEAN][demonstrated] live: same 3 scripts, generator PASS 132, F1 PASS
12. [SUSPICION][MED][derived] snapshot-vs-live CI-unverified (carried, disclosed)
counts: issues=5 suspicions=1 clean=6
evidence: demonstrated=11 code-traced=0 derived=1
checks=59 passed/0 failed/0 skipped (node --test; installed-live skipped) + generator PASS + F1 PASS
adr=HIT(38)
report=docs/reviews/s308-455-red-team-reconfirm-2026-10-06.md
