# Red Team (Sutekh): s361-hooks-typecheck, 2026-09-30

Scope: Issue #361, CRITICAL tier. Diff `e26e7aa..eb0b2d2` on `s7/closeout` (commits 13e055f, fd1558f, eb0b2d2). Two session-gate enforcement hooks (`hooks/sessionstart-tool-enum.mjs`, `hooks/userpromptsubmit-halt-relay.mjs`) annotated with JSDoc and added to `tsconfig.hooks.json`; QA-18 baseline ratcheted to empty; QA-18 tests re-pinned to fixtures; the R1-11 source scrape regex widened.
HEAD reviewed: `eb0b2d2`, in an isolated worktree (`git worktree add ../thoth-rt361 eb0b2d2 --detach`). `node_modules` and, for one rerun, `adr/` were junction-linked read-only from the main tree. The worktree was removed at the end of the turn.
ADR: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`. Rules read: SE ADR-0010 (no inline type suppression without a comment AND a human-approved exception; no weakening of tests), SE ADR-0021 (gate surfaces), ADR-0016 (self-protection). The CLAUDE.md sensitive-area rule applies to both hooks.

## Verdict: go

The load-bearing claim is AC-7: no runtime change. It holds, and I checked it with an instrument that has a working negative control. The halt relay has 0 code-token diffs. SessionStart differs by exactly 4 pairs of parentheses, at the 4 catch-variable sites. The build gate now catches arity and type bugs in both hooks (N6 reproduced). Every #367/#368 defence in QA-18 except one still kills its mutant after the re-pin to fixtures, and the one survivor was already untested before this story. There is one MED finding: an explicit `@param {any}` hides a live TS2345 and gets past the QA-18 suppression scan. Runtime impact today is nil, so it is filed as #374 and does not block.

## Attacks (ranked by exposure x irreversibility x silence)

### 1. [ISSUE][MED][demonstrated] An explicit `any` hides a live diagnostic, and the suppression scan cannot see that spelling
**Assumption:** "annotation-only, no suppression" (plan AC-5) means no annotation hides a real diagnostic.
**Scenario:** `hooks/sessionstart-tool-enum.mjs` `computeSessionTools` is annotated `@param {any} fixtureLocation`. Its own comment says it is left `any` because the degraded fallback in main() is the wider `HaltFixtureLocation`. Restoring the honest type shows the diagnostic it suppresses:
```
$ (replace @param {any} with @param {import("../src/policy/tools/classification-catalog.ts").FixtureLocation}) && npx tsc --noEmit -p tsconfig.hooks.json
hooks/sessionstart-tool-enum.mjs(597,76): error TS2345: Argument of type "HaltFixtureLocation" is not assignable to parameter of type "FixtureLocation".
  Types of property "fixtureSource" are incompatible.
    Type "string" is not assignable to type "FixtureSource".
rc=2
```
(tsc prints single quotes around type names; they are shown here as double quotes.)
The same kind of suppression gets through every gate when it is spelled `@param`. I planted a real bug in halt-relay (`haltStatePath(123)`) and then hid it three ways:
```
S0 real bug haltStatePath(123):   tsc rc=2 [error TS2345 ] QA-18 rc=1 lint rc=0
S1 hidden by @type{any} cast:     tsc rc=0 []              QA-18 rc=1 lint rc=0   <- banned class, caught
S2 hidden by @param{any}:         tsc rc=0 []              QA-18 rc=0 lint rc=0   <- same effect, invisible
S3 hidden by @param{Object}:      tsc rc=0 []              QA-18 rc=0 lint rc=0   <- Object is any in JS
```
`scanHookSuppressions` (`src/qa/hook-typecheck-coverage-check.ts:152-160`) only matches `@type\s*\{\s*(?:any|\*)\s*\}`. `@typescript-eslint/no-explicit-any` is scoped to `src/**/*.ts` (`eslint.config.mjs:26,38`), so the hooks carry no ban at all. I counted the explicit-any sites this diff adds with `git diff e26e7aa..eb0b2d2 -- hooks/ | grep -cE "^\+.*\{[^}]*\bany\b[^}]*\}"`: **8**, out of 48 added JSDoc type tags.
**Current defence, assessed honestly:**
- The `@param {any}` spelling was ruled a residual on #367 (decisions.md 2026-09-29) on the premise "0% live exposure". That premise no longer holds, because 8 sites are now live.
- 7 of the 8 are fills on JSON-shaped or tuple inputs. Those are type-equivalent to the prior implicit any, and the behavioural tests guard them (attack 4).
- The 8th, `computeSessionTools`, is not a JSON input. It is an internal typed value, and the `any` silences a real mismatch. CHANGELOG.md:25 groups it with the "JSON-shaped inputs", and it does not belong there.
- SE ADR-0010 rule 2 requires a comment AND a human-approved exception for an inline type suppression. The comment exists; I found no recorded approval.
- Runtime today: nil. `resolveFixtureLocation` is non-throwing (verified: `resolve ok` on a nonexistent dir), so the degraded value never reaches `computeSessionTools`. If it did, `assembleCatalog({fixturePath:null})` throws `ERR_INVALID_ARG_TYPE`, the catch in main() handles it, and the session halts with ENUMERATION_FAILED. That is fail-closed.

**Exposure:** ~0% of SessionStart runs today (basis: counted in code, degraded path unreachable). The gate-blindness applies to 1 of 8 explicit-any sites that hide a live diagnostic (basis: measured).
**Verdict:** BREAKS (MED). The gate’s "no suppression" property is false for one site, and the scan cannot detect the class. It does not block: the runtime has a fail-closed backstop and the class is a ruled residual.
**Named failing test:** `src/qa/hook-typecheck-coverage-check.fixnow.test.ts`: "explicit-any JSDoc inventory: every `{any}`/`{*}`/`{Object}`/`{Function}` type tag in hooks/*.mjs matches a reviewed allowlist (8 today, computeSessionTools flagged as a live-diagnostic suppression); a new one fails". Also required: record a human-approved exception for the computeSessionTools site per SE ADR-0010, or re-type it. Filed as **#374**.

### 2. [CLEAN][demonstrated] AC-7 no-runtime-change: the token diff is real, and it has a negative control
The builder’s instrument had no negative control, so I built my own (scratchpad `tokdiff.mjs`). It walks the leaf AST tokens via `ts.createSourceFile(...).getChildren()`, skips the JSDoc node kinds, computes an LCS diff, and cross-checks against `ts.createPrinter({removeComments:true})`.
Controls, run on halt-relay (1 token each unless noted):
```
NC1 !== -> !=                      diffs=2  - ExclamationEqualsEqualsToken:!==  + ExclamationEqualsToken:!=
NC2 template head text             diffs=2  - TemplateHead:`DETAILS[${          + TemplateHead:`DETAILX[${
NC3 regex literal {1,128}->{1,129} diffs=2  - RegularExpressionLiteral:/^[A-Za-z0-9._-]{1,128}$/ ...
NC4 template middle after ${}      diffs=2  - TemplateMiddle:}: ${               + TemplateMiddle:}:: ${
NC5 line 438 process.exit(2)->(0)  diffs=2  - FirstLiteralToken:2                + FirstLiteralToken:0
NC6 sessionstart drop 2nd arg      diffs=2  - CommaToken:,  - Identifier:sessionTools
PC1 comment-only edit (JSDoc + //) diffs=0  (positive control: trivia excluded)
```
The first NC5 attempt edited a `process.exit(2)` inside a comment (line 67). It correctly reported 0 diffs, which is a second trivia control. I then redid NC5 on code line 438.
Result on the real diff:
```
=== sessionstart-tool-enum   tokens old=1341 new=1349 diffs=8   (4x + OpenParenToken:( / + CloseParenToken:) )
printer differingLines=4: ${locErr?.stack} ${err?.message} ${writeErr?.stack} ${err?.stack} -> each wrapped as (x)?.…
=== userpromptsubmit-halt-relay   tokens old=1130 new=1130 diffs=0   printer differingLines=0
```
`(err)?.message` has the same semantics as `err?.message`: parentheses around a bare identifier do not create an optional-chain boundary. The inline sanitize copy in the relay and the forgery-proof composition carry 0 code-token change. **SURVIVES.**

### 3. [CLEAN][demonstrated] Drill N6 reproduced: the real build gate now bites both hooks
```
N6a sessionstart evaluateToolInventory(merged)   npm run build rc=2  hooks/sessionstart-tool-enum.mjs(519,22): error TS2554: Expected 2 arguments, but got 1.  QA-18 rc=1
N6b halt-relay trustedUnlockHint(key)             tsc(hooks) rc=2  1x TS2554   QA-18 rc=1
N6c halt-relay composeFullMessage(array, …)       tsc(hooks) rc=2  1x TS2345   QA-18 rc=1
N6d sessionstart writeHaltReason(…, "true", …)    tsc(hooks) rc=2  1x TS2345   QA-18 rc=1
```
The worktree was restored with `git checkout` after every drill, and `git status --short` was empty after each batch. **SURVIVES.**

### 4. [CLEAN][demonstrated] Bugs the type gate cannot see behind `any`-typed JSON params are killed by the unedited hook tests
These four plants pass the typechecker (tsc rc=0, QA-18 PASS) because the params are `any`. The behavioural suite catches every one:
```
baseline hooks/sessionstart-tool-enum*.test.ts + hooks/userpromptsubmit-halt-relay*.test.ts: 73 pass / 0 fail / 0 skipped
U1 inspectHaltState haltState.reasons -> .reason           tsc rc=0 | tests 39 pass / 34 fail / 0 skipped
U2 composeDiagnosticLines entry.detail -> .details         tsc rc=0 | tests 52 pass / 21 fail / 0 skipped
U3 enableAllProjectMcpServers typo                         tsc rc=0 | tests 60 pass / 13 fail / 0 skipped
U4 wasReasonActive initialHaltState.reasons -> .reason     tsc rc=0 | tests 70 pass / 3 fail / 0 skipped
```
The sanitize param is `@param {unknown} value`, not `any`, so it keeps full type force. Hook tests are unedited: `git diff --name-only e26e7aa..eb0b2d2 -- "hooks/*.test.ts" | wc -l` gives 0. Full suite: `npm test` 1664 tests, 1663 pass / 1 fail / 0 skipped. The 1 fail is `QA-14 (dogfood)` (`ADR-0021 ... no ADR with this id exists in the tree`), caused by the `adr/` submodule not being initialised in the review worktree (`git submodule status` gives `-cdb245d… adr`). Rerun with `adr/` linked: `src/qa/reference-resolver.test.ts` 85 pass / 0 fail / 0 skipped. `npx eslint hooks/ src/qa/ <R1-11 file>` rc=0. **SURVIVES.**

### 5. [CLEAN][demonstrated] The re-pin to fixtures did not hollow out the #367/#368 ratchet defences
Baseline for the QA-18 tests: 36 pass / 0 fail / 0 skipped. Mutants on `src/qa/hook-typecheck-coverage-check.ts`, applied with LF-preserving edits. The first pass used a CRLF-writing editor; I discarded it and reran everything, with identical results.
```
M1 multiset -> raw count compare (offset-gameable)   35/1/0  killed by R4 drill C2
M2 identity position-dependent (code:line)           31/5/0  killed by N3 control + 2 cosmetic + regen-dup + C2
M3 suppression scan disabled                         29/7/0  killed by 7 #367/N2/N4 class cases
M4 @type{any} cast arm removed                       34/2/0  killed by JSDoc any-cast / star-cast cases
M5 regenerate accepts additions                      34/2/0  killed by N3 regenerate refuse cases
M6 empty pinned baseline = free pass                 35/1/0  killed by AC-13 (real hook, real empty baseline)
M7 unlisted hook tolerates 1 diagnostic              34/2/0  killed by suppression control + not-clean fixture
M9 not-in-project check removed                      35/1/0  killed by absent-from-project test
M8 see attack 6
```
The re-pinned fixtures each carry an unmutated control (the N3 control; the C2 `control.ok` sanity check). A mutant therefore fails the test on the edit itself, not on setup. M6 is the one that matters most for the empty-baseline state, and it is killed by a drill against the real hook. **SURVIVES.**

### 6. [ISSUE][LOW][demonstrated] The multiset occurrence-count arm of `checkHookTypecheckCoverage` is untested, before and after this story
```
M8 countByIdentity: counts.set(id,(counts.get(id)??0)+1) -> counts.set(id,1)
  @eb0b2d2: 36 pass / 0 fail / 0 skipped   (survives)
  @e26e7aa: 35 pass / 0 fail / 0 skipped   (survives: pre-existing)
```
The only "second occurrence of a pinned identity" test exercises `regenerateBaseline`, which has its own counting. With every pinned list now empty, the arm cannot fire on the real hooks (allowed is always 0). **Exposure:** 0% of CI runs today (basis: counted in code). The gap becomes live only if a hook is ever re-pinned. **Named failing test:** `hook-typecheck-coverage-check.fixnow.test.ts`: "multiset: a fixture pinned at identity X x1 that now shows X x2 fails checkHookTypecheckCoverage". LOW, so no Issue.

### 7. [CLEAN][demonstrated] The R1-11 regex widening did not weaken what R1-11 guards
R1-11 reads the SessionStart detail prefix from the hook source to calculate the relay’s visible window. The widened regex still anchors the literal prefix and `?.message`, and the captured group is unchanged.
```
R0 as shipped                               2 pass / 0 fail / 0 skipped
R1 detail .message -> .stack                1 pass / 1 fail   (killed)
R2 prefix text lengthened                   1 pass / 1 fail   (killed)
R3 pre-story uncast form                    2 pass / 0 fail   (correctly accepted)
R4 extra expression inside the cast parens  1 pass / 1 fail   (killed)
```
The independent `\)?` accepts `${err)?.message`, which is not valid JS; the build would reject it before R1-11 ever mattered. **SURVIVES.**

## Scariest unproven assumption
That nobody will use `@param {any}` or `@param {Object}` on a callee in a hook to make a real type mismatch go away. The gate, QA-18 and lint are all blind to that spelling (S2/S3), and the diff now has 8 in-file examples a reviewer will read as normal style.

## Go / no-go
**go.** No HIGH. The one MED (#374) has a nil runtime effect today and a fail-closed backstop, so it goes to Manager triage as fix-now or deferred.

## Single next action
Manager: triage #374. The cheapest option is to add the explicit-any inventory test (attack 1) with computeSessionTools as its one flagged entry, and record the SE ADR-0010 human exception for that site in decisions.md.

## Open findings to failing tests
Open findings: 2 (#1 MED, #6 LOW). Named failing tests: 2 (one per finding, named above). They match.

## Editorial (uncounted, verdict-neutral)
- `tsconfig.hooks.json` header: "a dropped required argument or a type mismatch in any of them fails `npm run build`" is too broad. A type mismatch flowing through the 8 explicit-any sites does not fail (U1-U4 all show tsc rc=0).
- CHANGELOG.md:25 lists the `fixtureLocation` of `computeSessionTools` among "external JSON-shaped inputs". It is an internal typed value whose `any` hides TS2345 (attack 1).
- SessionStart’s `isValidSessionId` carries `@returns {id is string}` but the relay’s copy does not. Cosmetic asymmetry.
- Several JSDoc blocks end their prose with a stray ` *` before the new tags (e.g. `path. *` then ` * @param`). A formatting artefact of appending tags to an existing block.

RECEIPT: verdict=go
attacks:
1. [ISSUE][MED][demonstrated] sessionstart computeSessionTools `@param {any}` hides a live TS2345 (HaltFixtureLocation->FixtureLocation); @param{any}/{Object} evade QA-18 scan and lint (S2/S3); no SE ADR-0010 human exception; runtime nil (degraded path unreachable, fails closed); filed #374
2. [CLEAN][demonstrated] AC-7 token diff with 6 negative + 1 positive controls: halt-relay 0 diffs, sessionstart exactly 4 paren pairs at the 4 catch casts; printer cross-check agrees
3. [CLEAN][demonstrated] N6 reproduced: npm run build rc=2 TS2554; halt-relay TS2554 and 2x TS2345 plants caught; QA-18 red on all 4
4. [CLEAN][demonstrated] any-typed JSON params are tsc-blind (U1-U4 rc=0) but the unedited hook tests kill all 4 (34/21/13/3 fails); sanitize param is `unknown`; full suite 1663/1/0 (the 1 fail is the worktree’s missing adr submodule, rerun 85/0/0)
5. [CLEAN][demonstrated] QA-18 #367/#368 defences survive the re-pin: 8 of 9 checker mutants killed, including the empty-baseline free-pass mutant (M6) via AC-13
6. [ISSUE][LOW][demonstrated] multiset occurrence-count arm of checkHookTypecheckCoverage is untested (M8 survives at eb0b2d2 and at e26e7aa; pre-existing, 0% exposure while baseline empty)
7. [CLEAN][demonstrated] R1-11 regex widening not weakened: .stack / prefix-text / extra-expr mutants killed, uncast form still accepted
counts: issues=2 suspicions=0 clean=5
evidence: demonstrated=7 code-traced=0 derived=0
checks=build rc=0; tsc hooks rc=0; QA-18 PASS; QA-18 tests 36/0/0; hook tests 73/0/0; npm test 1663/1/0 (1=env adr submodule, rerun 85/0/0); eslint rc=0; tokdiff controls 7/7 as expected; checker mutants 8 killed/1 survived; N6 drills 4/4 caught; U1-U4 tsc-blind 4/4, test-killed 4/4; R1-11 mutants 5/5 as expected; S0-S3 suppression drill 4/4 as reported
adr=HIT(37)
report=docs/reviews/s361-hooks-typecheck-red-team-2026-09-30.md
