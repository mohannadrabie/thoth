# S2 - Canonical Action record + pure policy kernel - app-security-reviewer report

**Date:** 2026-09-01
**Reviewer:** app-security-reviewer (Horus)
**Scope:** Milestone #20 (STANDARD tier). Working-tree diff: src/policy/kernel/{action-record,rule-types,verdict,kernel}.ts (+.test.ts), src/policy/rule/{schema,precedence}.ts (+.test.ts), src/policy/fixtures/{action-records,rules}.ts, src/qa/kernel-purity-check.ts (+.test.ts), src/qa/selftest-fixture/kernel-purity/{clean,violating}/, plus package.json, .github/workflows/ci.yml, CHANGELOG.md, docs/STATE.md, docs/backlog.md, docs/decisions.md, docs/run-log.jsonl.
**Binding spec:** ADR-0021, REQUIREMENTS.md section 3/3.1/3.2, docs/decisions.md 2026-09-01 "S2 scope ruled on two points" row, docs/plans/S2-phase1-2026-09-01.md.

## ADR compliance

node docs/adr-cache.mjs --ensure produced an ADR cache HIT reusing 35 ADRs. Read from the shared catalog: ADR-0021 (architecture, security, code, data - applicable, binding) and SE ADR-0002 (pure-domain-layer precedent ADR-0021 itself cites). No devops ADRs apply (no infra surface). No violation of any ADR-0021 Rules for agents MUST line found - see findings below for gaps that are spec-compliant-but-incomplete, not MUST violations.

## What I ran (real receipts, not the build receipt's word)

    $ npm run typecheck        -> tsc --noEmit -p tsconfig.json: clean, no output
    $ npm run lint              -> eslint .: clean, no output
    $ npm test                  -> node --test
      tests 175
      pass 175
      fail 0
      cancelled 0
      skipped 0
      todo 0
    $ npm run qa:kernel-purity
      [QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.

## Findings

### 1. [ISSUE][MED][demonstrated] POL-05's fail-closed gate is fail-open on the meta-ambiguity case: an action whose own mutating-ness is itself unresolved

src/policy/kernel/kernel.ts:49-51 (isMutating) and :62-63 (pol05Rule's early-return short-circuit on isMutating(), evaluated before source/unresolved are ever inspected).

isMutating matches only against a small, hardcoded, closed set (MUTATING_VERBS = write, create, modify, delete, move, rename, execute). Two related, both-demonstrated consequences:

**(a) A plausible real mutating verb outside the hardcoded set is invisible to POL-05.** An opaque-source action with verbs ["patch"] (an ordinary verb name, e.g. a PATCH-style config mutation) never reaches the opaque/unresolved checks at all:

    $ node verbs-demo.mjs
    # decide() against {source:"opaque", verbs:["patch"], unresolved:[]}, defaultOutcome="allow"
    verdict: { outcome: 'allow', reason: 'no kernel-level or configured rule matched this action - falling back to the configured default outcome' }

**(b) An action whose verb classification is itself the unresolved fact is never denied by POL-05, even though unresolved is non-empty.** A normalizer that cannot tell what an action does is expected to report that as an unresolved facet (unresolved: ["verb"]) - but if it also (correctly, per its own uncertainty) leaves verbs empty, the kernel classifies the whole action as non-mutating before ever looking at unresolved:

    $ node unresolved-verb-demo.mjs
    # {source:"shell", verbs:[], unresolved:["verb"], ...}, defaultOutcome="allow"
    pol05Rule direct: null
    decide() verdict: { outcome: 'allow', reason: 'no kernel-level or configured rule matched this action - falling back to the configured default outcome' }

This is spec-compliant as literally written - both REQUIREMENTS.md POL-05 (deny "a mutating action" whose record is opaque or carries unresolved fields) and ADR-0021's Rules for agents (MUST deny "a mutating action" whose Action record has source: opaque) scope the rule to mutating actions specifically, and kernel.test.ts explicitly tests and documents the non-mutating carve-out as intentional (its own comment: "POL-05 scopes to mutating actions only"). This is not an ADR violation and not a live exploit today - no normalizer exists yet (ADR-0021 shape 3, out of S2's scope per docs/decisions.md 2026-09-01) to actually emit such a record; only hand-built fixtures can produce it right now.

What it is: the fail-closed guarantee's completeness rests entirely on an undocumented invariant that any future normalizer (shape 3) must honor - never represent an action as non-mutating when its own mutating-ness is uncertain; when in doubt, classify as mutating. Nothing in this diff states, tests, or enforces that invariant anywhere a shape-3 author would see it (not in action-record.ts's header, not in ADR-0021, not in a kernel test that pins today's boundary as a named regression).

Exposure: 0% of live paths today (no normalizer exists; only this story's own fixtures produce real ActionRecord values, and they are all well-formed) - basis: counted in code (grep confirms no production caller of decide()/pol05Rule outside tests/fixtures). Not a live vulnerability; a documented-gap risk for the next story that will make this load-bearing.

Minimal fix: add one sentence to action-record.ts's unresolved/verbs doc comments stating the invariant explicitly (binding text for shape 3), and one kernel.test.ts case that pins today's actual boundary behavior (empty verbs + unresolved verb -> currently not denied) as a named, visible regression fixture rather than an implicit accident of the current code shape.

### 2. [ISSUE][MED][demonstrated] kernel-purity-check.ts's forbidden-globals detector is a literal-text regex, fully defeated by trivial string-concatenation obfuscation

src/qa/kernel-purity-check.ts:39-48 (FORBIDDEN_GLOBAL_PATTERNS) scans comment-stripped source text for the literal substrings process, fetch(, setTimeout(, setInterval(, require(, import(, __dirname, __filename. Demonstrated bypass, three independent PoCs, none detected by any CI gate (purity check, lint, or typecheck):

    $ cat src/policy/kernel/__demo_bypass.ts
    const p1 = "proc"; const p2 = "ess";
    export function leak() { return Reflect.get(globalThis, p1 + p2); }

    $ npx tsc --noEmit -p tsconfig.json     -> clean, no output
    $ npx eslint src/policy/kernel/__demo_bypass.ts   -> clean, no output
    $ node src/qa/kernel-purity-check.ts
    [QA kernel-purity-check] PASS: 5 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.

(File removed immediately after the demonstration; not part of the shipped diff.) A second PoC - a string-built require-equivalent and a disguised process split across two string literals - both also produced zero findings when scanForbiddenGlobals() was called directly.

eslint.config.mjs has no no-restricted-globals/no-restricted-syntax rule scoped to src/policy/kernel/** (confirmed by direct read), so there is no AST-level defense-in-depth anywhere in this repo's toolchain for this property; kernel-purity-check.ts is the only line of defense ADR-0021 names ("enforced by a lint rule or structural test, not by convention alone"), and it is convention-strength against a deliberate obfuscation attempt despite being framed as structural.

The checker's own "violating" self-test fixture only exercises blatant, unobfuscated violations (a literal node:fs/promises import, a literal process.cwd() call) - representative of an accidental violation by a well-meaning contributor, not of a deliberate evasion attempt. The test suite gives no signal this bypass class was ever considered.

Exposure: 0% of live/production paths today (kernel not wired to any gate surface - ADR-0021 shape 4 is explicitly future work); 100% of the checker's own detection surface against deliberately obfuscated access - basis: measured directly (three independent PoCs, zero detections across purity-check + lint + typecheck). The actual shipped kernel files are directly verified pure by inspection - this finding is about the strength of the check, not a violation present in today's shipped code.

Minimal fix (interim): add globalThis, Reflect, eval, Function to FORBIDDEN_GLOBAL_PATTERNS - raises the bar, does not close determined obfuscation. Durable fix: replace or augment the regex scan with an AST-based check using the typescript package (already a devDependency) - resolve identifier bindings rather than scanning raw text.

### 3. [CLEAN][code-traced + demonstrated] POL-08 precedence merge is deterministic and correct - project always wins, never silently dropped

src/policy/rule/precedence.ts:38-64. mergeLayers iterates layers in fixed order (shipped-defaults -> central -> project) and does byId.set(rule.id, ...) on each occurrence - last write wins, so project's value for any rule id it defines always overwrites central's/shipped's. Verified by direct code trace and by the real three-layer-conflict fixture (kernel.test.ts:179-191, precedence.test.ts:19-25,52-58): project's deny beats central's allow beats shipped's deny, and the reverse case (project silent, central wins) is also tested. No path found where a project-tier rule is silently dropped or defaults toward the less-restrictive layer.

### 4. [CLEAN][demonstrated] Schema validator has no prototype-pollution-shaped gap - unlike the precedent at completeness-claim-checker.ts:107

src/policy/rule/schema.ts. Verified directly:

    $ node proto-test.mjs
    Object.keys: [ 'id', 'effect', '__proto__' ]
    validateRule result: [ unknown key "__proto__", field "__proto__" ]
    ({}).polluted after validate: undefined
    validateRuleSet result: [ unknown key "constructor", field "constructor" ]
    ({}).polluted2 after validate: undefined

A JSON.parse'd payload carrying __proto__/constructor as an own enumerable key is correctly flagged as an unknown key (fail-closed for POL-06 purposes) and Object.prototype is not polluted. This is a structurally different shape from the backlog-flagged gap at src/qa/completeness-claim-checker.ts:107 - that one does a dynamic object-lookup keyed by unsanitized input (a lookup-by-key pattern that can resolve to Object.prototype members for a poisoned key); this validator only ever reads fixed, literal property names and only ever reads Object.keys() for membership-checking against a closed array - no dynamic property lookup or assignment anywhere in the file. Confirmed this class of gap does not recur here.

### 5. [CLEAN][code-traced] No new dependency, no secret, no fs/network/process code anywhere in the diff

    $ git diff package.json          -> only the qa:kernel-purity script line added; no dependencies changed
    $ grep -rniE secret/password/token/AKIA/BEGIN-key patterns across src/policy and the new qa files -> no matches
    $ grep -rn require\(/process\./fetch\(/http/child_process/exec\( across src/policy -> no matches

Satisfies ADR-0021's "no third-party governance-decision dependency" rule and CLAUDE.md's "no secrets in code" hard rule.

### 6. [CLEAN][demonstrated] SUR-09 (deferred-as-execution) correctly enforced by omission

isMutating/pol05Rule (kernel.ts:49-82) never read action.deferred anywhere - verified by direct code trace and by a parity test (kernel.test.ts:72-83) asserting a deferred mutating-opaque action is denied identically (same outcome, ruleId, reason) to its immediate equivalent, and that a deferred-but-otherwise-clean mutating action is not auto-denied merely for being deferred.

### 7. [CLEAN][demonstrated] Kernel purity check's literal-violation detection works correctly for the realistic accidental-violation threat model

Non-relative imports, out-of-directory relative imports, and unobfuscated forbidden-global literals are all correctly flagged - proven by the shipped violating fixture test and by 15 passing unit tests in kernel-purity-check.test.ts. The real src/policy/kernel/ directory scans clean, non-vacuously (4 production files, 0 violations). Scoped separately from Finding 2's deliberate-obfuscation gap - the mechanism works as designed for its stated purpose.

## Verdict

APPROVE-WITH-CONDITIONS.

Both findings are MED severity, demonstrated, but neither is a live exploit today (0% current exposure - the kernel has no production caller yet) and neither violates an ADR-0021 Rules-for-agents MUST line as literally written. Nothing HIGH found. The core POL-05/SUR-09 logic that is exercised by this story's own fixtures is correct, well-tested, and matches spec. Conditions:

1. Finding 1 (undocumented normalizer invariant) - fix-now is cheap (one doc-comment sentence plus one pinned regression test); recommend closing before or alongside ADR-0021 shape 3 (normalizer registry) is planned, so its author inherits the constraint explicitly rather than by accident.
2. Finding 2 (purity-check obfuscation gap) - deferred; not blocking S2 (kernel isn't live-wired), but must be strengthened before ADR-0021 shape 4 (gate wiring) treats qa:kernel-purity as sufficient assurance for a live enforcement boundary.

Both findings filed as GitHub Issues per CLAUDE.md's "Review Findings to Bug Issues" trigger.

## Editorial (non-blocking, not counted in findings)

None worth naming - the diff's comments, CHANGELOG, and STATE.md entries were checked for accuracy against the actual code and found consistent.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, ranked by exploitability x impact):
1. [ISSUE][MED][demonstrated] src/policy/kernel/kernel.ts:49-63 - POL-05 short-circuits on isMutating() before checking source/unresolved; a hardcoded closed verb-set or an unresolved-verb classification lets an ambiguous mutating action resolve to allow; spec-compliant as written but rests on an undocumented normalizer invariant. Fix: document the invariant + add a pinned regression test.
2. [ISSUE][MED][demonstrated] src/qa/kernel-purity-check.ts:39-48 - forbidden-globals regex fully evaded by trivial string-concatenation obfuscation (Reflect.get(globalThis, ...) etc.), undetected by purity-check, lint, or typecheck alike; no AST-level defense-in-depth exists. Fix: add globalThis/Reflect/eval/Function to the pattern list (interim) + AST-based check using the existing typescript devDependency (durable).
3. [CLEAN][code-traced] src/policy/rule/precedence.ts:38-64 - POL-08 merge deterministic, project always wins, no silent-drop path.
4. [CLEAN][demonstrated] src/policy/rule/schema.ts - no prototype-pollution-shaped gap; __proto__/constructor keys correctly rejected as unknown, no dynamic property lookup/assignment anywhere; differs from the completeness-claim-checker.ts:107 precedent.
5. [CLEAN][code-traced] no new dependency, no secret, no fs/network/process code anywhere in src/policy/** or the new qa instrument.
6. [CLEAN][demonstrated] SUR-09 correctly enforced by omission - isMutating/pol05Rule never read action.deferred, proven by a parity test.
7. [CLEAN][demonstrated] kernel-purity-check's literal-violation detection (imports, unobfuscated globals) works correctly for the accidental-violation case; real src/policy/kernel/ scans clean non-vacuously.
counts: issues=2 suspicions=0 clean=5
evidence: demonstrated=5 code-traced=2 derived=0
checks="175/0/0|typecheck clean|lint clean|qa:kernel-purity PASS"
adr=HIT(35)
report=docs/reviews/s2-canonical-action-record-kernel-app-security-2026-09-01.md

---

## Re-confirm pass -- 2026-09-01 (post fix-now: source retype for Issue #61, doc+test for Issue #62, regex-widening for Issue #63's interim half)

**Scope:** re-verify the fix-now diff against the real working tree (src/policy/kernel/{action-record,kernel}.ts, src/qa/kernel-purity-check.ts, kernel.test.ts, kernel-purity-check.test.ts) -- not the fix-now receipt's word.

### What I ran (real receipts)

    $ npm run typecheck   -> tsc --noEmit -p tsconfig.json: clean, no output
    $ npm run lint        -> eslint .: clean, no output
    $ npm test            -> node --test
      tests 181
      pass 181
      fail 0
      cancelled 0
      skipped 0
      todo 0
    $ npm run qa:kernel-purity
      [QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.

Matches the fix-now receipt's claimed 181/181 and non-vacuous purity PASS (4 files) -- confirmed directly, not taken on word.

### Issue #62 re-check -- NOT genuinely resolved; remains OPEN

I re-ran both of my original PoCs against the current, unmodified isMutating/pol05Rule (src/policy/kernel/kernel.ts:76-113 -- the executable logic is byte-identical to what I reviewed originally; only doc comments and a test were added):

    Case A -- opaque source, sole verb outside MUTATING_VERBS, unresolved empty:
      { source: "opaque", verbs: ["patch"], unresolved: [] }
      isMutating: false
      pol05Rule: null
      decide() (default allow): { outcome: 'allow', ... }

    Case B -- verb classification itself IS the unresolved fact, verbs empty:
      { source: "structured", verbs: [], unresolved: ["verb"] }
      isMutating: false
      pol05Rule: null
      decide() (default allow): { outcome: 'allow', ... }

Both PoCs still resolve to allow, identically to my original review.

The fix-now pass did not change the runtime behavior at all -- it added a doc comment (kernel.ts:49-75) and one new test (kernel.test.ts:87-114, "Issue #62 regression"). I checked whether that test is real and non-trivial (per the task's instruction) -- it is a real, executing assertion, not a comment-only stub. But it does NOT exercise the boundary I actually demonstrated: it constructs verbs: ["write", "patch"] -- i.e. it deliberately keeps a hardcoded-set verb ("write") alongside the unclassifiable one so that isMutating() is already true for an unrelated reason, and the test's own comment says so explicitly ("write keeps the action mutating overall so pol05Rule's isMutating() gate is reached at all").

That is an honest, correctly-scoped test of a different, narrower property (once isMutating() is already true, unresolved is checked unconditionally) -- it is not a regression test of Case A/B, and the CHANGELOG entry (CHANGELOG.md:20) accurately describes this narrower scope ("alongside a recognized mutating verb so pol05Rule is actually reached").

The in-code doc comment is less careful than the CHANGELOG, though: kernel.ts:68-69 states "pol05Rule denies on ANY non-empty unresolved, unconditionally, regardless of what isMutating decided" and then (kernel.ts:72-74) states what is "NOT covered" is only "a normalizer that emits an unclassifiable verb WITHOUT reporting it via unresolved" -- omitting the actual residual case demonstrated in Case B, where the normalizer does correctly report unresolved: ["verb"] (the invariant is honored) and the action is still allowed, because isMutating() gates the check first and returns false on empty/all-unclassifiable verbs. Reading kernel.ts:68-74 in isolation, a future shape-3 normalizer author could reasonably conclude "if I always report ambiguity via unresolved, POL-05 will catch it" -- which is false when the ambiguous verb is the sole/only verb.

This is not a new vulnerability (exposure is unchanged, still 0% -- no live caller today) and it does not violate ADR-0021's Rules-for-agents MUST line (POL-05 is scoped to "a mutating action" as literally written, same as my original finding). But the fix-now pass's own framing ("fixes #62") overstates what changed: the demonstrated gap is byte-for-byte identical to before; what changed is documentation, and that documentation itself is not fully accurate about the residual scope. Issue #62 stays open -- see the GitHub comment posted below for what would actually close it (either pin Case A/B as a named, visible "known gap" regression per my original minimal-fix ask, or tighten the doc comment to match the CHANGELOG's honest scoping, or -- a genuine fix -- change the gate to check unresolved.length > 0 independent of isMutating(), which is a small, well-contained change but a real behavior change worth a deliberate decision, not a fix-now drive-by).

### Issue #63 re-check -- interim PoC genuinely closed; one adjacent, equally-cheap gap found

Re-ran the exact original PoC and two related probes directly against scanForbiddenGlobals():

    $ Reflect.get(globalThis, "proc" + "ess")   -> [ { name: 'globalThis' }, { name: 'Reflect' } ]   CAUGHT
    $ (0, eval)("1+1")                          -> [ { name: 'eval' } ]                               CAUGHT
    $ globalThis["process"]                     -> [ { name: 'process' }, { name: 'globalThis' } ]    CAUGHT

The original demonstrated bypass is closed, and I could not reproduce the bracket-access or indirect-eval variants suggested in the task either -- both are also caught (the literal identifiers globalThis/eval still appear in each). Good, real widening.

One adjacent, equally-cheap gap remains, found while probing for the exact class of thing the task asked me to check for:

    $ cat src/policy/kernel/__demo_bypass2.ts
    const g: any = global;             // Node's bare `global`, distinct from `globalThis` -- NOT in the pattern list
    const p1 = "proc"; const p2 = "ess";
    export function leak(): unknown { return g[p1 + p2]; }

    $ scanForbiddenGlobals(source) -> []   ZERO detections

global (without "This") is Node.js's own alias for the global object (same object globalThis refers to on Node, distinct identifier) and is not in FORBIDDEN_GLOBAL_PATTERNS (kernel-purity-check.ts:45-63, which added globalThis, Reflect, eval, Function( but not global). Combined with string-concatenation to avoid the literal "process" substring, this fully bypasses the widened check with zero detections -- the same obfuscation class the fix-now pass targeted, via the sibling identifier. (File removed immediately after demonstration; not part of the shipped diff.)

This is exactly the kind of "obvious, cheap-to-also-catch gap" the task asked me to flag, not a demand to build the full AST-based fix (correctly deferred to docs/backlog.md). One more regex line (name: "global", re: /\bglobal\b/) would close it, consistent with the interim widening's own stated philosophy. Issue #63 stays open (as already scoped in docs/backlog.md's entry -- "Issue #63 stays open for this durable half") -- I'm adding this global-alias gap as a comment on the same issue rather than a new one, since it's the same underlying finding (obfuscation defeats the literal-text scan) continuing to apply, not a distinct new vulnerability class.

### Regression check (Issue #61's source retype) -- clean, no weakening found

- src/policy/kernel/action-record.ts:26 -- source is now "parsed" | "structured" | "opaque" (was an open string). isActionRecord's runtime check (action-record.ts:70) was already doing an equivalent three-way literal comparison before this change; the type retype makes the compile-time type match what the runtime check already enforced -- a strict tightening, not a weakening.
- src/policy/rule/schema.ts -- confirmed untouched by this pass (git diff shows no changes; the file validates Rule/RuleSet shape, which has no source field -- ActionRecord.source and Rule are unrelated types). My original Finding 3 (prototype-pollution) evidence is unaffected.
- src/policy/rule/precedence.ts -- untouched. My original Finding 3 (POL-08 determinism) evidence is unaffected.
- src/policy/fixtures/action-records.ts -- all six fixtures use valid union values ("structured", "opaque", "parsed"); no fixture needed updating for the retype beyond what's already correct.
- No new dependency, no new secret, no new fs/network/process import anywhere in the diff (git diff package.json -- only the previously-reviewed qa:kernel-purity script line; confirmed no further changes this pass).
- SUR-09 (Finding 6) and the purity-check's own accidental-violation detection (Finding 7) are unaffected -- neither kernel.ts's deferred-handling nor the purity-check's import-resolution logic changed in this pass.

### Updated verdict

APPROVE-WITH-CONDITIONS (unchanged from the original pass -- neither finding is a live exploit today, 0% exposure, no ADR-0021 MUST-line violation, nothing HIGH). Conditions carry forward, updated:

1. Issue #62 stays open. The fix-now pass added correct, honestly-scoped documentation and a real (if narrower-than-the-actual-gap) regression test, but the demonstrated runtime gap (Case A/B above) is unchanged. Recommend, before ADR-0021 shape 3 (normalizer registry) lands: either (a) add the actual boundary case as a named, visible "known gap, tracked" regression test (my original ask), and tighten kernel.ts:68-74's doc comment to match CHANGELOG.md:20's more careful scoping, or (b) make a deliberate, reviewed decision to change the gate itself (e.g. isMutating(action) || action.unresolved.length > 0) so unresolved is checked independent of verb classification -- a real behavior change, not a fix-now drive-by.
2. Issue #63 stays open (as already scoped -- durable AST-based check deferred to backlog). Interim demonstrated PoC (Reflect.get(globalThis, ...)) is genuinely closed; recommend also adding global (bare, Node-specific) to FORBIDDEN_GLOBAL_PATTERNS as a one-line follow-up to the same interim widening, since it's the same obfuscation class via a sibling identifier and equally cheap to catch.

Both issues left OPEN with an evidencing comment (not closed) -- see GitHub Issues #62, #63.

---

RECEIPT (re-confirm pass, 2026-09-01):
verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] src/policy/kernel/kernel.ts:76-113 (Issue #62, still open) -- runtime behavior unchanged from original review; Case A (verb outside MUTATING_VERBS, unresolved empty) and Case B (verbs empty, unresolved non-empty) both still resolve to allow. New regression test only covers a narrower, already-working case (ambiguous verb co-occurring with a recognized mutating verb); in-code doc comment (kernel.ts:68-74) overclaims coverage relative to the CHANGELOG's own honest scoping. Fix: pin the actual boundary as a named regression + tighten the comment, or make a deliberate decision to check unresolved independent of isMutating.
2. [ISSUE][MED][demonstrated] src/qa/kernel-purity-check.ts:45-63 (Issue #63, interim half -- new sub-finding) -- original PoC (Reflect.get(globalThis, ...)) now genuinely caught, but bare Node global (distinct from globalThis) is not in the widened pattern list; global["proc"+"ess"] bypasses the check with zero detections. Same obfuscation class via a sibling identifier. Fix: add name: "global", re: /\bglobal\b/ to FORBIDDEN_GLOBAL_PATTERNS.
3. [CLEAN][code-traced] src/policy/kernel/action-record.ts:26 (Issue #61's source retype) -- strict tightening (compile-time now matches what the runtime check already enforced), no regression to schema validator, precedence merge, SUR-09, or dependency/secret posture.
counts: issues=2 suspicions=0 clean=1
evidence: demonstrated=2 code-traced=1 derived=0
checks="181/0/0|typecheck clean|lint clean|qa:kernel-purity PASS (4 files, non-vacuous)"

---

## Final re-confirm pass -- 2026-09-01 (post second, narrower fix-now: real behavior fix for Issue #62, global-addendum fix for Issue #63)

**Scope:** independently re-verify the second fix-now diff against the real working tree (src/policy/kernel/kernel.ts, src/qa/kernel-purity-check.ts, kernel.test.ts, kernel-purity-check.test.ts, CHANGELOG.md, docs/STATE.md, docs/backlog.md) -- not the implementer claim.

### What I ran (real receipts)

    $ npm run typecheck    -> tsc --noEmit -p tsconfig.json: clean, no output
    $ npm run lint         -> eslint .: clean, no output
    $ npm test             -> node --test
      tests 187
      pass 187
      fail 0
      cancelled 0
      skipped 0
      todo 0
    $ npm run qa:kernel-purity
      [QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.

Matches the second fix-now pass claimed 187/187 and non-vacuous purity PASS -- confirmed directly.

### Issue #62 -- independently reproduced, genuinely CLOSED

Wrote and ran a standalone script importing isMutating/pol05Rule/decide directly from the live kernel.ts (not trusting the implementer transcript). Exact original PoC:

    { source: "opaque", verbs: ["patch"], unresolved: ["verbs[0]"] }
    isMutating: true                                              (was false)
    pol05Rule: { outcome: "deny", reason: "POL-05: mutating action source is opaque...", ruleId: "POL-05" }
    decide():  { outcome: "deny", ruleId: "POL-05" }               (was allow)

Non-opaque variant (source: "structured", same verbs/unresolved) also denies, on the unresolved-fields branch this time:

    isMutating: true
    pol05Rule: { outcome: "deny", reason: "POL-05: mutating action has unresolved field(s) [verbs[0]]..." }

Both variants of the original PoC now deny. This is a real, additive-OR behavior change at kernel.ts:73 (isMutating now also returns true whenever action.unresolved.length > 0, independent of verb classification), not the comment-only non-fix of the first attempt.

**Regression check (scope of the fix, task item 2):**

| Case | verbs | unresolved | source | isMutating | pol05Rule | decide() | Correct? |
|---|---|---|---|---|---|---|---|
| Recognized mutating verb, opaque, empty unresolved | ["write"] | [] | opaque | true | deny (POL-05, opaque) | deny | Yes -- unchanged from before, no regression |
| Recognized mutating verb, non-opaque, empty unresolved | ["write"] | [] | structured | true | null | allow (falls through to default) | Yes -- pol05Rule itself untouched; the OR only widened the gate, it did not make pol05Rule deny unconditionally |
| Non-mutating recognized verb, empty unresolved, structured source | ["read"] | [] | structured | false | null | allow | Yes -- non-mutating action correctly falls through |
| Non-mutating recognized verb, empty unresolved, opaque source | ["read"] | [] | opaque | false | null | allow | Yes -- POL-05 stays scoped to mutating actions only, matching spec; not auto-denied merely for an opaque source |

No regression: recognized-mutating-verb fixtures behave exactly as before (still deny via the pre-existing opaque/unresolved checks, still fall through to configured rules/default otherwise), and the OR did not turn into an overly-aggressive deny-everything gate -- a genuinely non-mutating, non-ambiguous action still allows, opaque source or not.

kernel.test.ts new "Issue #62 regression, real fix" tests (kernel.test.ts:97-160, confirmed by direct read) isolate the true boundary this time -- a record whose sole verb is outside MUTATING_VERBS, not riding alongside a recognized one as the first, misleading attempt did -- and a companion test pins the still-open, deliberately-deferred case (unrecognized verb, unresolved empty, stays non-mutating) as a named, visible fixture rather than an implicit accident.

**CHANGELOG/comment honesty (task item 4):** CHANGELOG.md:20 still carries the prior overclaiming entry, but now with an honest strikethrough plus a corrective note ("This entry overclaimed: it was a code-comment-only change... never exercised the actual gap") -- this is the append-only correction discipline working as intended, not silently rewriting history. CHANGELOG.md:24 new entry accurately states what changed and, correctly, does not drop the still-open wider question -- it explicitly routes an unrecognized-but-unflagged verb to docs/backlog.md S2 re-confirm entry, owned by ADR-0021 shape 3. docs/backlog.md:6 matches this framing exactly. kernel.ts:62-70 REMAINING, DELIBERATELY-DEFERRED GAP doc comment (re-read directly) now correctly and narrowly states the one case still open (an unclassifiable verb never reported via unresolved at all) -- this is the more careful scoping the CHANGELOG already had, not the doc comment prior overclaim.

**Verdict: genuinely resolved. Issue #62 closed** (gh issue close 62 --reason completed, evidencing comment posted).

### Issue #63 global-addendum -- independently reproduced, genuinely CLOSED; parent issue correctly stays open

Ran scanForbiddenGlobals() directly from the live kernel-purity-check.ts:

    scanForbiddenGlobals of global bracket-access with string concat  -> [{name:"global"}]        CAUGHT (was [])
    scanForbiddenGlobals of direct global["process"]                  -> [{name:"process"},{name:"global"}]  CAUGHT

False-positive probes, all clean:

    scanForbiddenGlobals of globalThis.foo                            -> [{name:"globalThis"}]     (not double-counted as "global")
    scanForbiddenGlobals of comment mentioning globalization/globalize -> []                         (substring, correctly ignored)
    scanForbiddenGlobals of identifier named globalConfig             -> []                         (identifier substring, correctly ignored)
    scanForbiddenGlobals of comment mentioning global                 -> []                         (comment-stripped before scan)

The \bglobal\b word-boundary pattern (kernel-purity-check.ts:70) works exactly as documented: it catches the bare identifier without false-positiving on globalThis, globalization, or globalConfig. kernel-purity-check.test.ts (:63-74, :179-184) and the extended obfuscated-globals.ts self-test fixture (second exported function, global bracket-access variant) give real, non-vacuous coverage of both the positive and false-positive cases -- confirmed by direct read and by re-running the checks myself.

This closes the specific gap flagged in the prior re-confirm pass. The **parent** Issue #63 finding -- the interim regex-based check remains evadable by other obfuscation shapes an AST-based check would close -- was always scoped as deliberately-deferred, non-blocking hardening (docs/backlog.md:7: "Issue #63 stays open for this durable half"), and stays open for that reason, unchanged from how it was originally triaged. Not left open because anything demonstrated today is still broken.

**Verdict: the addendum is genuinely resolved.** Evidencing comment posted on Issue #63; issue left OPEN (correctly, per its own already-documented scope) rather than closed.

### Updated verdict

**APPROVE.** Both re-confirmed gaps (Issue #62 real behavior fix, Issue #63 global-addendum) are genuinely closed, independently reproduced against the live code rather than taken on the implementer word, with no regression to the original POL-05 fixtures or the purity-check existing detection surface. Real checks all green: npm run typecheck clean, npm run lint clean, npm test 187/187 pass/0 fail/0 skipped, npm run qa:kernel-purity PASS (4 production files, non-vacuous). Nothing HIGH found across the whole review arc. The one remaining open item (Issue #63 durable AST-based check) was always non-blocking, deliberately-deferred hardening, correctly tracked in docs/backlog.md -- not a condition on this story ship.

---

RECEIPT (final re-confirm pass, 2026-09-01):
verdict=APPROVE
findings:
1. [CLEAN][demonstrated] src/policy/kernel/kernel.ts:73 (Issue #62, CLOSED) -- independently reproduced both original PoC variants (verb outside MUTATING_VERBS + non-empty unresolved, opaque and non-opaque source) now deny end-to-end via decide(); confirmed no regression to recognized-mutating-verb or non-mutating-verb fixtures across 4 boundary cases traced by hand.
2. [CLEAN][demonstrated] src/qa/kernel-purity-check.ts:70 (Issue #63 global-addendum, CLOSED) -- independently reproduced global bracket-access bypass now caught; confirmed no false positives against globalThis/globalization/globalConfig/comment text.
3. [CLEAN][code-traced] CHANGELOG.md:20/:24, docs/backlog.md:6-7, kernel.ts:62-70 doc comments -- correction is honest (strikethrough + corrective note, not silent rewrite), current coverage accurately stated, still-open wider question correctly routed to docs/backlog.md S2 re-confirm entry rather than dropped.
counts: issues=0 suspicions=0 clean=3
evidence: demonstrated=2 code-traced=1 derived=0
checks="187/0/0|typecheck clean|lint clean|qa:kernel-purity PASS (4 files, non-vacuous)"
adr=HIT(35)
report=docs/reviews/s2-canonical-action-record-kernel-app-security-2026-09-01.md
