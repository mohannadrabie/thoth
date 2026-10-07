# Red Team: s308-455 #484 re-check, HEAD e57689f

- Scope: #484 delta only, git diff 94b6b60 HEAD (0ed0e65 test, e57689f fix). CRITICAL. Worktree C:\playground\thoth-kb-rev2. Reviewer: red-team (Sutekh). Date: 2026-10-06.
- ADR cache: HIT, 38 ADRs [adr/devops:12, adr/software-engineering:23, docs/adr:3], fp da6ef03.
- Verdict: go (no HIGH). #484 is NOT FULLY FIXED. The new rule refuses eval, Function, the vm and worker_threads modules, .constructor calls and process.binding/_linkedBinding/dlopen when written directly. Two routes the rule matches only by name still pass: a computed globalThis lookup and an aliased process object. Both are latent (~0 percent current exposure). They are recorded on #484 rather than a new Issue (same finding).

## What I ran

- Scanner harness (scratchpad/redteam-455, scanSource on 14 fixture sources) and an end-to-end harness (pluginHookScan, injected reader, 5 commands).
- node src/qa/protected-path-list.ts -> PASS, 132 protected paths (3 from plugin hooks).
- node src/qa/f1-settings-named-scripts-judged.ts -> PASS, 3 plugin-hook script(s) protected; 1 note.
- node --test over the four suites -> tests 68, pass 68, fail 0, skipped 0.

## Findings

### 1. [ISSUE][MED][demonstrated] #484 not fully fixed: a computed globalThis key and an aliased process object pass the name-based rule
Scanner rows: [globalThis computed] (a key built by string concatenation, then globalThis[key](...)) -> OK, no throw. [process alias binding] (const p = process; then p.binding(...)) -> OK, no throw.
End-to-end rows: [script globalThis[k]] scripts=[docs/b.mjs] unenum=0; [-e body globalThis[k]] scripts=[] unenum=0; [script process alias] scripts=[docs/c.mjs] unenum=0.
The new checks match the literal text eval/Function, a literal element key, and the exact text process before .binding. A non-literal element access on globalThis, and any alias of process, are not refused, so the command stays enumerable and F1 passes.
Exposure: ~0 percent of current runs, basis: counted in the live snapshot (no plugin body or followed script uses either form). Proof-test: scanner: a non-literal element access on globalThis (or globalThis/self/global/window) and any alias of the process object throw. Suggested rule: refuse any element access whose key is not a string literal when the object is a global object, and taint-and-refuse any binding whose initializer is the bare identifier process.

### 2. [CLEAN][demonstrated] Direct eval / Function / vm / process.binding are refused end-to-end
[484 eval], [484 Function ctor], [484 vm import], [484 process.binding] all THROW in scanSource. End-to-end: [-e body eval] unenum=1; [script eval] unenum=1, so F1 fails until judged.

### 3. [CLEAN][demonstrated] The requested bypass shapes throw
Reflect.construct with Function (the Function reference is refused), a non-literal import specifier, require of module, process.mainModule.require, a literal globalThis element key for eval, and an arrow-function .constructor chain all THROW.

### 4. [CLEAN][demonstrated] A getter and a with statement alone reach no dynamic primitive
[indirect via getter] and [with statement] return OK, which is correct: neither names or reaches eval, Function, vm or a process escape by itself. Reaching one through with would require naming it (refused) or a computed lookup (finding 1).

### 5. [CLEAN][demonstrated] Live snapshot unchanged
Same 3 scripts (session-brief, adr-cache, decisions-archive), generator PASS 132, F1 PASS, tests 68/68.

### 6. [SUSPICION][MED][derived] Carried forward, unchanged: snapshot-vs-installed-plugins is checked only locally; CI reports unverified (disclosed)

## Go / No-go

GO: no HIGH; finding 1 is latent at ~0 percent current exposure. I recommend closing the two routes now on this branch before #484 is closed.

RECEIPT: verdict=go
1. [ISSUE][MED][demonstrated] #484 not fully fixed: computed globalThis key and aliased process pass the name-based rule, unenum=0; Exposure ~0pct of current runs, basis: counted in live snapshot
2. [CLEAN][demonstrated] direct eval/Function/vm/process.binding refused; end-to-end unenumerable via -e body and followed script
3. [CLEAN][demonstrated] Reflect.construct(Function), non-literal import, require of module, mainModule.require, literal globalThis key, .constructor chain all throw
4. [CLEAN][demonstrated] getter and with statement alone reach no dynamic primitive (OK is correct)
5. [CLEAN][demonstrated] live: same 3 scripts, generator PASS 132, F1 PASS, 68/68
6. [SUSPICION][MED][derived] snapshot-vs-installed-plugins CI-unverified (carried, disclosed)
counts: issues=1 suspicions=1 clean=4
evidence: demonstrated=5 code-traced=0 derived=1
checks=68 passed/0 failed/0 skipped (node --test) + generator PASS + F1 PASS
adr=HIT(38)
report=docs/reviews/s308-455-red-team-reconfirm3-2026-10-06.md
