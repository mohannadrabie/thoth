# Red Team: s308-455 last #484 re-check, HEAD f41b2d6

- Scope: #484 delta only, git diff 603089d f41b2d6 (87a1006 and 5826c16 tests, f41b2d6 scanner). CRITICAL. Worktree C:\playground\thoth-kb-rev2. Reviewer: red-team (Sutekh). Date: 2026-10-06.
- ADR cache: HIT, 38 ADRs [adr/devops:12, adr/software-engineering:23, docs/adr:3], fp da6ef03.
- Verdict: go (no HIGH). All four re-confirm-4 routes are FIXED, and the numeric-key narrowing holds on every shape probed. One route still bypasses a claimed refusal: the name constructor bound to a const string literal and passed as a call argument reaches the Function constructor with unenum=0. Under the Manager ruling this is an ISSUE (it bypasses the claimed constructor-by-any-route refusal with a const literal, not a runtime let/var value). Recorded on #484 (same finding). Routes that depend on runtime let/var strings are classified [SUSPICION][LOW] under the disclosed residual.

## What I ran

- Scanner harness (scratchpad/redteam-455): 4 re-confirm-4 routes, 13 narrowing and constructor shapes, 3 constructor-argument shapes.
- End-to-end: the const-string constructor route through pluginHookScan (injected reader).
- node src/qa/protected-path-list.ts -> PASS, 132 protected paths (3 from plugin hooks). F1 -> PASS, 3 plugin-hook script(s) protected; 1 note. Live derivation: docs/adr-cache.mjs, docs/decisions-archive.mjs, docs/session-brief.mjs.
- node --test over the four suites -> tests 70, pass 70, fail 0, skipped 0.

## Findings

### 1. [ISSUE][MED][demonstrated] constructor bound to a const string literal and passed as a call argument reaches the Function constructor
Scanner row [const string in arg]: a const bound to the string constructor, passed as the key argument to Object.getOwnPropertyDescriptor on a function prototype -> OK, no throw. End-to-end (the same, then .value called and the result called): docs/n.mjs unenum=0, F1 passes.
The new rule refuses the string constructor written directly as a call argument (row [descriptor string arg] THROWs) but not the same string reached through a const. The const is a literal known at scan time, so this is not the disclosed let/var residual; it bypasses the claimed constructor-by-any-route refusal.
Exposure: ~0 percent of current runs, basis: counted in the live snapshot. Proof-test: scanner: a const bound to the string constructor throws (at the declaration, or wherever it is used). Suggested rule: refuse the string literal constructor anywhere in a scanned source, not only as a direct call argument.

### 2. [CLEAN][demonstrated] All four re-confirm-4 routes FIXED
Computed constructor key -> THROW (key not a number by construction). Tagged template on .constructor -> THROW (tag not a plain identifier). Reflect.get chain -> THROW (Reflect.get refused). Stored async-function constructor -> THROW (reference to constructor).

### 3. [CLEAN][demonstrated] The numeric-key narrowing holds
THROW: a string literal key, a plus key, a const string key, a call key, a template key, a unary minus over a string. Allowed, correctly: a numeric literal key and a length-minus-one key. A plain string constructor in an in-expression is allowed and is benign (it reads nothing).

### 4. [CLEAN][demonstrated] constructor is refused on the direct routes
Destructuring constructor, a shorthand property named constructor, the string constructor written directly as a call argument, and a reference to Function (via getOwnPropertyDescriptor on Function.prototype) all THROW.

### 5. [SUSPICION][LOW][demonstrated] Disclosed residual: runtime let/var strings
[let runtime key] (a let bound to a process argument, used as an element key) -> OK. [names list runtime] (a let bound to an element of Object.getOwnPropertyNames on a prototype, passed as a descriptor key) -> OK. Both depend on a runtime string, which is the disclosed residual per the Manager ruling (a syntax allowlist for human-installed, protected scripts, not a sandbox). Residual register; no Issue.

### 6. [CLEAN][demonstrated] Live snapshot unchanged
Same 3 scripts, generator PASS 132, F1 PASS, tests 70/70.

### 7. [SUSPICION][MED][derived] Carried forward, unchanged: snapshot-vs-installed-plugins is checked only locally; CI reports unverified (disclosed)

## Go / No-go

GO: no HIGH; finding 1 is latent at ~0 percent current exposure. Finding 1 is a one-line extension of the existing rule (refuse the string constructor anywhere). I recommend making it before #484 closes.

RECEIPT: verdict=go
1. [ISSUE][MED][demonstrated] constructor via a const string literal as a call argument reaches Function, unenum=0 (bypasses the claimed constructor-by-any-route refusal); Exposure ~0pct of current runs, basis: counted in live snapshot
2. [CLEAN][demonstrated] all four re-confirm-4 routes FIXED (computed key, tagged template, Reflect.get chain, stored async ctor)
3. [CLEAN][demonstrated] numeric-key narrowing holds (string, plus, const string, call, template, unary keys throw; numeric and length-minus allowed)
4. [CLEAN][demonstrated] constructor refused on direct routes (destructure, shorthand, direct string arg, Function reference)
5. [SUSPICION][LOW][demonstrated] runtime let/var string keys and property-name lists pass (disclosed residual, Manager ruling)
6. [CLEAN][demonstrated] live: same 3 scripts, generator PASS 132, F1 PASS, 70/70
7. [SUSPICION][MED][derived] snapshot-vs-installed-plugins CI-unverified (carried, disclosed)
counts: issues=1 suspicions=2 clean=4
evidence: demonstrated=6 code-traced=0 derived=1
checks=70 passed/0 failed/0 skipped (node --test) + generator PASS + F1 PASS
adr=HIT(38)
report=docs/reviews/s308-455-red-team-reconfirm5-2026-10-06.md
