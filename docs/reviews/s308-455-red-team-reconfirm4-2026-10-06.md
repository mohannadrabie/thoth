# Red Team: s308-455 final #484 re-check, HEAD 978d369

- Scope: #484 delta only, git diff 0a474ef 978d369 (7063f7e test, 978d369 rule). CRITICAL. Worktree C:\playground\thoth-kb-rev2. Reviewer: red-team (Sutekh). Date: 2026-10-06.
- ADR cache: HIT, 38 ADRs [adr/devops:12, adr/software-engineering:23, docs/adr:3], fp da6ef03.
- Verdict: go (no HIGH). Both re-confirm-3 bypasses are FIXED. #484 stays NOT FULLY FIXED: four routes to the Function constructor pass the scanner with unenum=0. Latent, ~0 percent current exposure. Recorded on #484 (same finding), no new Issue.

## What I ran

- Scanner harness (scratchpad/redteam-455): 2 re-confirm-3 probes and 10 Function.prototype-class probes on scanSource.
- End-to-end harness: 4 invoked Function-constructor routes through pluginHookScan (injected reader).
- node src/qa/protected-path-list.ts -> PASS, 132 protected paths (3 from plugin hooks). F1 -> PASS, 3 plugin-hook script(s) protected; 1 note. Live derivation: docs/adr-cache.mjs, docs/decisions-archive.mjs, docs/session-brief.mjs.
- node --test over the four suites -> tests 69, pass 69, fail 0, skipped 0.

## Findings

### 1. [ISSUE][MED][demonstrated] #484 not fully fixed: four routes reach the Function constructor and run a string with no refusal
End-to-end, each command is node on a followed script, each result unenum=0 (F1 passes):
- docs/k.mjs: a constructor key built by string concatenation, used twice as a computed element key on an array literal, then called.
- docs/t.mjs: a tagged template whose tag is a .constructor member of a function literal (a tagged template is not a CallExpression, so the .constructor-call rule does not fire).
- docs/r.mjs: Reflect.get applied twice with the literal key constructor, then called.
- docs/s.mjs: the constructor of an async function prototype stored in a const, then called through the const.
The .constructor rule matches only a CallExpression whose callee is a literal .constructor member. A computed key, a tag, a Reflect/descriptor read, or a stored reference all avoid it. Three more scanner rows return OK for retrieval only (getOwnPropertyDescriptor, Reflect.get once, the async prototype read without a call); they are the first half of the routes above.
Exposure: ~0 percent of current runs, basis: counted in the live snapshot (no followed script or -e body uses any of these). Proof-test: scanner: any route to the Function constructor throws (computed key, tagged template, Reflect.get, stored reference).
Recommendation: this is the third name-based patch on #484 and each round leaks a new route. A structural rule should replace the denylist: refuse every non-literal element access in any scanned source; refuse the property name constructor reached by any route (member, literal element key, destructuring, or as a string argument to Reflect or Object reflection methods); refuse a tagged template whose tag is not a plain identifier. A stricter option is an allowlist of the globals and member calls a hook script may use.

### 2. [CLEAN][demonstrated] Re-confirm-3 bypasses FIXED
[rc3 globalThis computed] THROW: a use of globalThis other than a plain member access. [rc3 process alias] THROW: a use of process other than a plain member access.

### 3. [CLEAN][demonstrated] Literal .constructor call forms throw
Object.getPrototypeOf on a function literal then a .constructor call, an array literal .constructor.constructor call, and a destructured constructor followed by a .constructor call all THROW.

### 4. [CLEAN][demonstrated] import.meta and arguments.callee reach no dynamic primitive
[import.meta] (reading the url) and [arguments.callee] return OK, which is correct: neither runs code from a string by itself.

### 5. [CLEAN][demonstrated] Live snapshot unchanged
Same 3 scripts, generator PASS 132, F1 PASS, tests 69/69.

### 6. [SUSPICION][MED][derived] Carried forward, unchanged: snapshot-vs-installed-plugins is checked only locally; CI reports unverified (disclosed)

## Go / No-go

GO: no HIGH; finding 1 is latent at ~0 percent current exposure. I recommend the structural rule above before #484 closes, rather than a fourth name-based patch.

RECEIPT: verdict=go
1. [ISSUE][MED][demonstrated] #484 not fully fixed: computed constructor key, tagged template on .constructor, Reflect.get chain, stored constructor all reach Function with unenum=0; Exposure ~0pct of current runs, basis: counted in live snapshot
2. [CLEAN][demonstrated] re-confirm-3 bypasses FIXED (computed globalThis key, aliased process both throw)
3. [CLEAN][demonstrated] literal .constructor call forms throw (getPrototypeOf, array ctor ctor, destructured ctor)
4. [CLEAN][demonstrated] import.meta and arguments.callee reach no dynamic primitive (OK is correct)
5. [CLEAN][demonstrated] live: same 3 scripts, generator PASS 132, F1 PASS, 69/69
6. [SUSPICION][MED][derived] snapshot-vs-installed-plugins CI-unverified (carried, disclosed)
counts: issues=1 suspicions=1 clean=4
evidence: demonstrated=5 code-traced=0 derived=1
checks=69 passed/0 failed/0 skipped (node --test) + generator PASS + F1 PASS
adr=HIT(38)
report=docs/reviews/s308-455-red-team-reconfirm4-2026-10-06.md
