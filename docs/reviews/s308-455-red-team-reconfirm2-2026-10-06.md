# Red Team: s308-455 round-2 re-confirm, HEAD 3f80024

- Scope: s308-455 round-2 re-confirm, HEAD 3f80024 (CRITICAL). Delta: git diff 09482b9 3f80024 (30ea0c9 tests, 3f80024 fix).
- Worktree: C:\playground\thoth-kb-rev2 (detached 3f80024). Reviewer: red-team (Sutekh). Date: 2026-10-06.
- ADR cache: HIT, 38 ADRs [adr/devops:12, adr/software-engineering:23, docs/adr:3], fp da6ef03.
- Verdict: go (no HIGH). The heuristic accounting is replaced by a two-part design: an allowlist of hook-command shapes (classifyHookCommand) and one AST scanner (scanSource) over every script, every node -e body and every imported module. #480-#483 are all FIXED. The child_process surface is locked down hard. One MED remains: the scanner is blind to dynamic code-execution primitives (eval, Function, vm, process.binding), so a followed script or an allowlisted node -e body can launch a sibling repo script with no protection and no unenumerable flag; this contradicts the stated "everything else throws".

## What I ran

- Harness in scratchpad/redteam-455 (imports classifyHookCommand, scanSource, pluginHookScan from rev2; injected reader; 30 command shapes, 29 scanner shapes, 6 end-to-end derivations). Raw rows quoted per finding.
- node src/qa/protected-path-list.ts -> PASS, 132 protected paths (3 from plugin hooks), exit 0.
- node src/qa/f1-settings-named-scripts-judged.ts -> PASS, 3 plugin-hook script(s) protected; 1 note, exit 0.
- Live derivation unchanged: docs/session-brief.mjs, docs/adr-cache.mjs, docs/decisions-archive.mjs.
- node --test over the four suites -> tests 67, pass 67, fail 0, skipped 0. installed-live skipped per instruction.

## Findings (ranked by blast radius)

### 1. [ISSUE][MED][demonstrated] The scanner is blind to eval / Function / vm / process.binding, so a followed script or a node -e body can launch an unprotected sibling with no unenumerable flag
End-to-end through pluginHookScan with an injected reader:
- a node -e body of eval of a string -> scripts=[] unenum=0 absent=0. An -e body is on the allowlist and is scanned, but eval is not refused.
- a followed script whose body evals a string that calls execFileSync(process.execPath, [docs/secret.mjs]) -> scripts=[the eval script], docs/secret.mjs NOT protected, unenum=0. The eval-launched child is a silent miss.
- a followed script calling vm.runInThisContext(...) -> scripts=[the script], unenum=0 (vm not refused).
- a followed script calling process.binding(spawn_sync) -> scripts=[the script], unenum=0 (process.binding not refused).
The scanner refuses every alias/member/module reference in the child_process family (see finding 5), but has no rule for eval, Function, vm or process.binding, which are themselves code-execution and child-spawning primitives. The design states only exact child_process call shapes are followed or allowed and everything else throws -- these primitives are everything else and return OK instead of throwing.
Current defense: none for these primitives. Exposure: ~0 percent of current runs, basis: counted in the live snapshot (the maat -e body uses execFileSync and is followed correctly; no plugin ships an eval/vm body). Verdict: BREAKS (latent). Proof-test: scanner: eval, Function, a vm member call, or process.binding in a scanned source throws (fail closed).

### 2. [CLEAN][demonstrated] #480 FIXED
The quoted and braced CLAUDE_PROJECT_DIR forms after node now classify as a script token and are protected. The bare quoted-var form with no interpreter is unenumerable (fails closed). CLAUDE_PLUGIN_ROOT scripts classify and resolve outside, as before.

### 3. [CLEAN][demonstrated] #481 FIXED (flag-first spawn arg list) and #482 FIXED (spawn in an imported module)
scanSource maps every literal element of a node spawn arg array and takes the first element not starting with a dash, so a leading flag no longer hides the script. Imports are followed to a fixpoint and scanned by the same scanner: a .cjs require chain (root.cjs -> childcjs.cjs -> grandchild.mjs) and a .ts import chain (importts.mjs -> mod.ts -> ts-child.mjs) each protect every member and child. A non-literal element throws.

### 4. [CLEAN][demonstrated] #483 FIXED
The no-extension sibling with double-ampersand, the bash -c body, a pipe, a semicolon, a subshell, a redirect, an env prefix on a bare script, npm run, and sh on a non-.sh file are all unenumerable. The env prefix before node on a script is still accepted and protected. A trailing arg that expands makes the command unenumerable.

### 5. [CLEAN][demonstrated] The child_process aliasing surface fails closed
All of these THROW in scanSource: storing a cp function in a variable; passing a cp function as an argument; bracket access on the module; storing the module in a second variable; a dynamic import of child_process; module.require; a computed import specifier; a non-relative import; createRequire of module; a Worker/SharedWorker; import.meta.resolve; a bare reference to a cp function with no call; exec and execSync always; a reassigned or twice-declared const used as a spawn argument. A rename-destructure is correctly followed and protects the child. spawn on a literal git program is allowed and not followed. A const bound once to a string literal resolves in an args array (the one accepted exception), and is refused the moment that name is also assigned, incremented, shadowed, or taken as a parameter.

### 6. [CLEAN][demonstrated] Allowlist quoting edges fail closed or resolve correctly
A dollar-paren command-substitution token is unenumerable. A backtick-substitution token slips past classifyHookCommand (it checks for a dollar sign but not a backtick or the word expands flag), but downstream it resolves to a nonexistent path and is reported absent, which marks the command unenumerable -- fails closed. node -p, a leading-flag-before-script form, and an escaped space in a name are all unenumerable. Tab-separated, leading/trailing whitespace, a trailing CR, and a single-quoted path all resolve correctly.

### 7. [CLEAN][demonstrated] Live snapshot unchanged; generator and F1 pass
Same 3 scripts derived, generator PASS 132, F1 PASS, tests 67/67.

### 8. [SUSPICION][MED][derived] Carried forward, unchanged: snapshot-vs-installed-plugins is checked only locally; CI reports unverified (disclosed)

## Scariest unproven assumption

Finding 8 is unchanged. Among code defects, finding 1 is the real one: the scanner refuse-list omits the dynamic-eval and low-level spawn primitives, so the everything-else-throws guarantee has a hole reachable through the allowlisted node -e shape.

## Go / No-go

GO: no HIGH; finding 1 is latent at ~0 percent current exposure. I recommend adding the eval/Function/vm/process.binding refusal now on this branch, since the surrounding design already fails closed everywhere else and this is a one-rule addition to scanSource.

## Next action

Add a red proof-test (an eval/vm/process.binding call in a scanned source must throw), then extend scanSource pass 2 to refuse a call of eval or Function (identifier or new-expression), a member call on a vm module binding, and process.binding.

RECEIPT: verdict=go
1. [ISSUE][MED][demonstrated] scanner blind to eval/Function/vm/process.binding -> followed script or -e body launches unprotected sibling, no unenumerable flag; ~0pct current exposure (basis: counted in live snapshot), latent
2. [CLEAN][demonstrated] #480 FIXED (quoted/braced CLAUDE_PROJECT_DIR resolves in-repo and is protected)
3. [CLEAN][demonstrated] #481 + #482 FIXED (flag-first spawn args; spawn in imported .cjs/.ts modules followed)
4. [CLEAN][demonstrated] #483 FIXED (shell operators, -c body, env, npm, non-.sh all unenumerable)
5. [CLEAN][demonstrated] child_process aliasing surface fails closed (alias/bracket/dynamic-import/module.require/Worker/createRequire/bare-ref all throw; const-once exception is tight)
6. [CLEAN][demonstrated] allowlist quoting edges fail closed or resolve correctly (backtick slips parser but is absent downstream -> unenumerable)
7. [CLEAN][demonstrated] live: same 3 scripts, generator PASS 132, F1 PASS, 67/67 tests
8. [SUSPICION][MED][derived] snapshot-vs-installed-plugins CI-unverified (carried, disclosed)
counts: issues=1 suspicions=1 clean=6
evidence: demonstrated=7 code-traced=0 derived=1
checks=67 passed/0 failed/0 skipped (node --test; installed-live skipped) + generator PASS + F1 PASS
adr=HIT(38)
report=docs/reviews/s308-455-red-team-reconfirm2-2026-10-06.md
