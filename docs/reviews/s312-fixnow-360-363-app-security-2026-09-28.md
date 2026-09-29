# App Security Review -- PR #365 (fix/360-363-strip-comments-guard-hardening)

Reviewer: app-security-reviewer (Horus)
Date: 2026-09-28
Scope: PR #365 vs master -- closing red-team round-2 residuals #360/#361/#362/#363 on the already-shipped Issue #312 kernel/hook sanitize story. CRITICAL tier (Manager-ratified), touches the kernel-purity import-boundary check, the sanitize-binding AST guard, gate G21, and a new CI gate (QA-18 hook-typecheck-coverage-check).

## ADR compliance

node docs/adr-cache.mjs --ensure gave: ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] [CACHE=HIT].

Read (my domain -- security/code/architecture applicable-to entries): ADR-0021 (Thoth-native architecture, POL-11/POL-12), ADR-0016/0019/0020 (reference-port self-protection), THOTH-ADR-0001, THOTH-ADR-0002. None of this PR's changes touch a ported file, a protected-path boundary widening, or either fixture allowlist shape. The PR does not weaken POL-11/POL-12 enforcement (the kernel-purity structural test is made more precise, not looser) and does not touch .governance.json or add a third-party governance dependency. No applicable ADR is violated by this diff.

## What I verified independently

- Ran the full targeted suite: node --test src/qa/kernel-purity-check.test.ts src/qa/hook-typecheck-coverage-check.test.ts src/policy/config/sanitize.test.ts src/policy/gate/gate-structure.test.ts -> 81/81 pass, 0 fail, 0 skipped. The PR's own claims (AC-1 through AC-13) are each backed by a passing named test; I did not find a claimed-but-untested AC.
- Read the full diff, not the PR summary: src/qa/kernel-purity-check.ts, src/qa/kernel-purity-check.test.ts, src/policy/config/sanitize.test.ts, src/policy/gate/gate-structure.test.ts, src/policy/gate/render-hook-output.ts, src/qa/hook-typecheck-coverage-check.ts (+its test), tsconfig.hooks.json, tsconfig.hooks-coverage.json, .github/workflows/ci.yml.
- Built two standalone reproductions (copying the actual diff's logic verbatim, run against the typescript package from this repo's own node_modules) to test the specific bypass shapes the task called out. Both reproduced successfully; raw output included below.

## Findings

### 1. [HIGH] Sanitize-binding guard: path-suffix match plus a raw-text regex decoupled from the AST resolution together let an attacker-controlled module satisfy both checks

src/policy/config/sanitize.test.ts:151-155 (isSanitizeModuleImportCall):

    const SANITIZE_MODULE_SUFFIX = "/config/sanitize.ts";
    function isSanitizeModuleImportCall(expr) {
      if (!ts.isCallExpression(expr) || expr.expression.kind !== ts.SyntaxKind.ImportKeyword || expr.arguments.length !== 1) return false;
      const arg0 = expr.arguments[0];
      return arg0 !== undefined && ts.isStringLiteralLike(arg0) && arg0.text.endsWith(SANITIZE_MODULE_SUFFIX);
    }

This is the exact function PR #365 introduced to close #360's property-name-only bypass (R2: a local object literal ported as an object keyed "sanitizeForTerminal" satisfied it while an env var still gated a raw-ESC/NUL leak). The fix correctly requires the property access's object to trace back to a real dynamic import(...) call -- but it only checks that the import specifier's text ENDS WITH "/config/sanitize.ts", not that it equals the one real relative path ("../src/policy/config/sanitize.ts") the hook must use. import("../../attacker-controlled/config/sanitize.ts") also ends with "/config/sanitize.ts" and passes.

Separately, the pre-existing regression assertion at src/policy/config/sanitize.test.ts:242-245 (assert.match(hook, /import\(\s*["']\.\.\/src\/policy\/config\/sanitize\.ts["']\s*\)/, ...)) is a plain raw-text regex over the whole file, structurally INDEPENDENT of the AST resolution above: it only asserts the string appears somewhere in the file, dead code and comments included, not that it is the import actually feeding renderHookOutput's second argument.

Attack sketch: a hook diff that (a) keeps a no-op/dead-code copy of the literal import string anywhere in the file to satisfy the raw-text regex, and (b) wires the real Promise.all([...]) destructure to import("../../attacker-controlled/config/sanitize.ts") -- a module the same PR adds, exporting an identity sanitizeForTerminal -- passes every assertion in this test file while the shipped hook leaks raw ESC/NUL through stdout, exactly the vulnerability class #360/#312 exists to prevent.

Evidence -- demonstrated (copied the diff's own functions verbatim into a scratch script, ran against this repo's typescript):

    raw-text regex (AC-7 literal-import check) passes: true
    new AST guard (resolvesToSanitizeForTerminal) passes: true
    BYPASS CONFIRMED: both checks green while renderHookOutput's real sanitizer import is attacker-controlled
    (../../attacker-controlled/config/sanitize.ts), not the real module.

Minimal fix: compare the import specifier for exact equality against the one real relative path ("../src/policy/config/sanitize.ts"), not a suffix; and/or resolve the specifier to an absolute path and compare it to the real module's resolved path. The raw-text regex assertion at line 242-245 should be dropped or re-anchored to the same resolved call the AST check inspects -- as written it provides no security value beyond what the AST check should itself enforce, and its independence from that check is exactly the gap that let this pass.

Exposure: 100% of attempts at this exact bypass shape against the sanitize-binding guard succeed (measured -- reproduced against the guard as merged in this PR). Threat model: an insider/compromised-contributor with write access to hooks/pretooluse-kernel-gate.mjs (already a named CLAUDE.md sensitive area requiring a dated review) -- i.e. this is a compensating control meant to catch exactly this shape of devious diff during automated review, and it does not.

### 2. [HIGH] hook-typecheck-coverage-check.ts's pinned-baseline ratchet is gameable with a plain "// @ts-ignore" -- a new real bug in an excepted hook produces ZERO diagnostic-count change, not merely "within budget"

src/qa/hook-typecheck-coverage-check.ts:106-120: the ratchet compares a raw COUNT of ts.getPreEmitDiagnostics results per file against a pinned baseline (30 for hooks/sessionstart-tool-enum.mjs, 22 for hooks/userpromptsubmit-halt-relay.mjs). The PR's own AC-13 regression test proves the ratchet catches an UNSUPPRESSED new diagnostic (a dropped required argument). It does not test the suppressed case.

"// @ts-ignore" (or "// @ts-expect-error") directly above a broken line removes that diagnostic from ts.getPreEmitDiagnostics's output entirely -- it does not trade one diagnostic for another, it makes the new bug's diagnostic not exist for this instrument's purposes. Nothing in this repo's eslint.config.mjs bans @ts-ignore/@ts-expect-error (checked: no ban-ts-comment rule present). So a new real type-incorrect change in either of the two pinned-baseline hooks -- both of which are named CLAUDE.md sensitive areas (sessionstart-tool-enum.mjs is explicitly named under "Halt-state directory"; userpromptsubmit-halt-relay.mjs is the UserPromptSubmit halt gate itself) -- ships with the count exactly unchanged, well under baseline.

Evidence -- demonstrated, reproduced in the exact allowJs/checkJs configuration tsconfig.hooks-coverage.json uses:

    function evaluateToolInventory(merged, sessionTools) { return merged.length + sessionTools.length; }
    // @ts-ignore
    evaluateToolInventory([1,2,3]);

    diagnostics on bad.mjs (arity error suppressed via @ts-ignore, checkJs mode): 0

(A .ts reproduction of the same suppression, run through ts.createProgram/ts.getPreEmitDiagnostics directly, also gave 0.)

Minimal fix: in addition to (or instead of) a raw count, assert diagnostic IDENTITY stability for the pinned-baseline files -- e.g. pin the sorted list of (code, line) tuples, not just .length -- so a suppression that swaps which lines error is visible; and/or add an ESLint ban-ts-comment rule (or a grep-based instrument) forbidding @ts-ignore/@ts-expect-error under hooks/, closing the suppression vector directly rather than trying to detect its effect after the fact.

Exposure: 100% of attempts to hide a new type bug via @ts-ignore in either pinned-baseline hook succeed (measured, same threat model as finding 1 -- an insider/compromised-contributor with write access to a named sensitive-area hook file).

### 3. [CLEAN] stripComments's ts.createScanner rewrite -- the disclosed regex-in-character-class residual is honestly scoped and self-guarded

The new stripComments (kernel-purity-check.ts:183-213) correctly delegates string/template/comment tokenization to ts.createScanner, closing the #362/#363 string-literal blind spot (verified: checkKernelPurity catches the string-literal-comment-opener.ts fixture; 27/27 relevant tests pass). The header discloses one residual precisely: a raw scanner without reScanSlashToken() misreads a bare slash as division, so a regex character class with an unescaped, adjacent double-slash is misread as a line-comment opener.

I reproduced this residual directly against a synthetic source containing a regex literal with an unescaped double-slash inside a character class, followed by a real forbidden import on the same line: stripComments and stripCommentsAstOracle disagree (agree: false) on this shape, exactly as disclosed.

The residual is real, but it is (a) honestly quantified in the code comment (0 regex literals of any shape exist today in the three enforced lanes, checked against the differential test's own file list), and (b) actively self-guarded: kernel-purity-check.test.ts's new differential test runs stripComments against stripCommentsAstOracle (a genuinely independent full-parse code path) over every production file in the three enforced lanes on every test run -- and my reproduction confirms a future regex-in-character-class in any of those lanes would flip that differential test red, not pass silently. This is a disclosed, measured, continuously-verified residual, not a silent hole -- worth naming as sound design, not a finding to gate on.

### 4. [CLEAN] AC-7c fix (findAllRenderHookOutputCalls plus "exactly one call site")

Verified the fix closes the exact decoy-call shape red-team round 2 demonstrated (finding R3): the new function walks the whole AST rather than returning on the first match, and the test requires calls.length === 1. Confirmed by the PR's own regression test (passing) and by re-reading the implementation -- no first-match early return remains.

### 5. [CLEAN] Template-literal brace disambiguation in the new scanner-based stripComments

The templateBraceStack bookkeeping (kernel-purity-check.ts) correctly tells a closing brace that closes a template substitution from an ordinary block/object closing brace, re-scanning the former via reScanTemplateToken(). Read through the logic; on a stack-empty pop() (malformed/unbalanced input) the code degrades to treating the brace as ordinary rather than throwing -- fail-soft, not fail-open on any forbidden-globals/import-scan guarantee this file makes (an unbalanced brace is not a plausible real TS/JS source shape in the enforced lanes, and the differential-oracle test would still flag any resulting disagreement).

## Findings NOT filed as new issues (already tracked)

None of the above are the same gap as #360/#361/#362/#363 as filed (checked via gh issue view on all four): #360 tracked the property-name-only match and long-reason skip (this PR's AC-7b/AC-7c fixes that, correctly, per finding 4 above); #361 tracked the missing build-time typecheck coverage (this PR's hook-typecheck-coverage-check.ts addresses the measurement gap, but finding 2 above is a new gap in that new instrument itself, not a restatement of #361). Findings 1 and 2 are new gaps introduced by this PR's own fix-now code, not carried-forward residuals -- filed as new Issues.

## Verdict

REWORK. Two HIGH findings, both demonstrated against the exact code this PR ships, both in code whose entire purpose is closing exactly this class of bypass (the sanitize-binding guard and the new CI typecheck-coverage ratchet). Both have minimal, targeted fixes (exact-path comparison instead of suffix; diagnostic-identity pinning or a ban-ts-comment rule instead of raw count) -- this is not a request to redesign the approach, which is otherwise sound (the ts.createScanner-based stripComments rewrite and the AC-7c decoy-call fix are both clean, well-tested closes of their respective round-2 findings).

## Checks run

- node --test src/qa/kernel-purity-check.test.ts src/qa/hook-typecheck-coverage-check.test.ts src/policy/config/sanitize.test.ts src/policy/gate/gate-structure.test.ts: 81 pass / 0 fail / 0 skipped.
- Two standalone PoC reproductions (finding 1: sanitize-binding suffix bypass; finding 2: @ts-ignore ratchet suppression), both run against this repo's own typescript package, raw output quoted above.
- One standalone reproduction of the disclosed stripComments regex-in-character-class residual, confirming both the exploit shape and that the differential oracle test catches it.

RECEIPT: verdict=REWORK
findings (ranked by exploitability x impact):
1. [ISSUE][HIGH][demonstrated] src/policy/config/sanitize.test.ts:151-155,242-245 (isSanitizeModuleImportCall suffix-only match + raw-text regex decoupled from AST resolution) -- attacker-controlled import path ending in /config/sanitize.ts plus a dead-code decoy satisfying the literal-text regex both pass; fix: exact-path comparison, not endsWith.
2. [ISSUE][HIGH][demonstrated] src/qa/hook-typecheck-coverage-check.ts:106-120 (pinned-baseline ratchet compares raw diagnostic COUNT) -- a @ts-ignore on a new real bug in either excepted hook yields a zero count delta, not merely within-budget; fix: pin diagnostic identity (code+line) or ban @ts-ignore/@ts-expect-error under hooks/.
3. [CLEAN][demonstrated] src/qa/kernel-purity-check.ts stripComments regex-in-character-class residual -- disclosed, quantified (0 occurrences today), and self-guarded by the differential oracle test which flips red on the exact shape (reproduced).
4. [CLEAN][code-traced] src/policy/config/sanitize.test.ts findAllRenderHookOutputCalls / exactly-one-call-site fix -- closes the #360 R3 decoy-call gap as claimed.
5. [CLEAN][code-traced] src/qa/kernel-purity-check.ts templateBraceStack template-literal brace disambiguation -- correct, fails soft not open, backstopped by the same differential oracle.
counts (checksum): issues=2 suspicions=0 clean=3
evidence (checksum): demonstrated=3 code-traced=2 derived=0
checks="81/0/0|n/a"
adr=HIT(37)
report=docs/reviews/s312-fixnow-360-363-app-security-2026-09-28.md
