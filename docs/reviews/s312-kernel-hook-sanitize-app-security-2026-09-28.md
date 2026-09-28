# App Security Review - PR #358 (Issue #312: kernel verdict reason / hook deny output terminal sanitize)

Reviewer: app-security-reviewer (Horus)
Date: 2026-09-28
Scope: PR #358, story/312-kernel-hook-sanitize -> master (head 0afe0ab)
Tier: CRITICAL (sensitive area: policy delivery/config surface; the PreToolUse enforcement gate's own output channel)

## ADR compliance (mandatory first step)

node docs/adr-cache.mjs --ensure -> "ADR cache BUILT: cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2], catalog now current (fp 9b0b204) [CACHE=HIT]".

- adr/devops and adr/software-engineering (the org-shared submodule) are not checked out in this review worktree (submodule status shows an uninitialized pointer). docs/adr/ (project-local) has 2 ADRs: THOTH-ADR-0001 (central-classification fixture standing exception) and THOTH-ADR-0002 (secret-scan allowlist). Neither's subject matter touches this diff's files (src/policy/gate/**, src/policy/config/sanitize.ts, hooks/pretooluse-kernel-gate.mjs) - read both, confirmed no applicable rule.
- SE ADR-0021 (kernel/gate/normalizer architecture) is the ADR whose rules this PR is explicitly built around (the gate/kernel config-import boundary), but its prose text was unreadable in this environment (submodule empty). Compliance was instead verified against ADR-0021's own codified enforcement, which predates this PR: gate-structure.test.ts's G15 test (scans src/policy/gate/** for any config/ import, asserts zero) and src/qa/kernel-purity-check.ts (scans src/policy/kernel/** likewise). Both ran green against the PR head (see Checks). This substitutes a code-traced compliance check for a document read where the document itself was inaccessible; flagged so a future reviewer with submodule access can re-confirm against ADR-0021's literal text.
- No applicable-ADR BLOCKER found.

## What the diff does (verified, not taken from the PR description)

- src/policy/config/sanitize.ts (pre-existing, from Issue #294) exports sanitizeForTerminal, which strips the C0/DEL/C1 control-character class plus U+2028/U+2029. Unchanged by this PR; this PR wires a second consumer.
- src/policy/gate/render-hook-output.ts: renderHookOutput(result, sanitize) - sanitize is a required parameter, no default. A deny verdict reason and a refusal reason both route through sanitizedDenyJson(reason, sanitize), which fails closed (exit 2) if the sanitized text is empty. The allow path returns before sanitize is ever called.
- hooks/pretooluse-kernel-gate.mjs: the one file exempted from the gate/kernel config/ import ban (by design, since it already imports config/ for the loader) now also imports src/policy/config/sanitize.ts and calls renderHookOutput(decideToolCall(input, ports), sanitizeForTerminal).
- src/policy/kernel/kernel.ts::decide() (untouched by this PR) builds the verdict reason from a rule's rationale, falling back to a rule id - both policy-authored, schema-validated but not terminal-sanitized at that layer - confirming the PR's stated threat model (src/policy/kernel/kernel.ts:99,107,177,186,193).
- src/policy/gate/decide-tool-call.ts's pre-kernel refusal reasons reflect the untrusted tool_name, bounded to 512 chars (REASON_NAME_CAP) before being placed in the reason string - this refusal path is also routed through the same sanitizedDenyJson call.

## Findings

### 1. [CLEAN][code-traced] Sanitizer closes the actual terminal-injection threat model, not a narrow subset
src/policy/config/sanitize.ts:24. The Unicode Cc control-character class covers ESC (0x1B) and CSI (0x9B, C1 range) - the two bytes every ANSI/VT terminal escape sequence (cursor movement, screen clear, color/attribute spoofing, alternate-screen tricks) requires to start. Stripping the whole class removes that capability class entirely, not just a curated blocklist of known sequences. U+2028/U+2029 close a line-injection vector some terminals treat specially. Verified via the BMP-exhaustive unit test (sanitize.test.ts, all 65,536 BMP code units classified against an independently-derived oracle) and, more importantly, via a real end-to-end test that spawns the actual hook binary with a hostile policy-authored rationale containing raw ESC sequences and asserts the real process's actual stdout contains no raw ESC byte (hooks/pretooluse-kernel-gate-sanitize.test.ts, AC-8, demonstrated below).

### 2. [CLEAN][code-traced] Documented residual (format characters) is an accepted carry-over, not a new gap
Unicode Cf format characters (bidi override U+202E, zero-width characters) survive - documented in sanitize.ts's header. These can visually reorder or hide text but cannot forge a line or emit an escape sequence, and this is the same residual already accepted for the S5 #278 userpromptsubmit-halt-relay.mjs sanitizer this module mirrors. Not introduced by this PR; correctly disclosed, not overclaimed.

### 3. [CLEAN][code-traced] Fail-loud correctness confirmed for the one real call site
renderHookOutput's sanitize parameter (src/policy/gate/render-hook-output.ts:65) has no default and no optional marker, so a caller that omits it fails tsc --noEmit (confirmed: npm run typecheck is clean on the PR head, meaning the one real caller compiles with an argument present). Grepped the whole tree for renderHookOutput( outside test files: the only real call site is hooks/pretooluse-kernel-gate.mjs:191, which supplies sanitizeForTerminal directly - a working sanitizer is actually supplied, not a stub. Because hooks/pretooluse-kernel-gate.mjs's .mjs extension means it is not itself typechecked, I traced the failure mode by hand: if the sanitize module import were ever broken, sanitize(reason) inside sanitizedDenyJson would throw a TypeError, which propagates out of renderHookOutput into main()'s enclosing try and is caught, producing failClosed("internal exception", err) -> exit 2, not a silent pass-through of unsanitized text. This is fail-closed by construction (a thrown exception can never reach denyJson()), not merely fail-loud in the type system. The allow path is proven (by a call-counting spy in render-hook-output.test.ts, test AC-3) to never invoke sanitize at all, so a throwing/missing sanitizer cannot break the silent-allow contract either.

### 4. [CLEAN][code-traced] Empty-after-sanitize is fail-closed, matching Verdict.reason's "never blank" invariant
sanitizedDenyJson (render-hook-output.ts) exits 2 rather than emitting a blank permissionDecisionReason when a reason built entirely of control characters strips to empty. Demonstrated by test AC-4 (render-hook-output.test.ts).

### 5. [CLEAN][code-traced] Boundary completeness: no other unsanitized policy-derived output path found in this chain
- decide() (kernel.ts) has exactly one caller in production code (decide-tool-call.ts), whose only caller is the hook via renderHookOutput - confirmed by grep for kernel/kernel.ts imports and decideToolCall/GateResult usage project-wide (10 hits, all test files, docs, or the two files this PR wires).
- The pre-kernel refusal reasons (decide-tool-call.ts) that reflect the untrusted tool_name are bounded (REASON_NAME_CAP = 512) and go through the same sanitizedDenyJson call as verdict-deny reasons - one call site for both, as the PR claims, confirmed by reading renderHookOutput's two branches (verdict/deny and refusal), both calling sanitizedDenyJson.
- printer.ts (the original #294 site, policy:print's own render boundary) already calls sanitizeForTerminal at every string interpolation into its output lines (src/policy/config/printer.ts:100,107,126,141,155,164) - untouched by this PR, still correctly sanitized, no regression.
- hooks/userpromptsubmit-halt-relay.mjs (S5 #278, a different enforcement point, SessionStart not PreToolUse) keeps its own inline copy of the strip-class regex, verified byte-identical to sanitize.ts's literal by a drift-guard test that ran green (sanitize.test.ts, "sanitize class literal matches userpromptsubmit-halt-relay.mjs").
- Out-of-scope observation, not a finding against this diff: hooks/sessionstart-tool-enum.mjs lines 614-618 write raw err.stack to stderr on an internal exception. This is a different hook (SessionStart), a different data flow (Node's own exception stack traces, not policy-authored rule text), and untouched by this PR - raised only because the review brief asked to search broadly. Not filed as an issue: it predates this PR, carries no policy-derived text, and is out of this diff's scope.

### 6. [CLEAN][code-traced] Kernel-purity / import-boundary scoping is correctly enforced, not merely asserted in a comment
gate-structure.test.ts's G15 test scans every file under src/policy/gate/** for a node:* import or any import matching config/ and asserts zero matches - ran green against the PR head. src/qa/kernel-purity-check.ts performs the equivalent scan for src/policy/kernel/** - ran green (PASS: 4 production .ts files, zero violations). hooks/pretooluse-kernel-gate.mjs is outside both scanned directories (it lives under hooks/), so it is correctly the one place permitted to import src/policy/config/sanitize.ts - this is a structural fact enforced by two independent, currently-passing mechanical tests, not a design intention that could silently drift.

### 7. [CLEAN][demonstrated] No new dependency / supply-chain surface
git diff origin/master...HEAD for package.json and package-lock.json is empty. No new third-party package introduced.

## Checks actually run (raw)

    npm run typecheck        -> clean (tsc --noEmit -p tsconfig.json, exit 0)
    npm run lint              -> clean (eslint ., exit 0)
    node src/qa/kernel-purity-check.ts
      PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
    node src/qa/gate-manifest-check.ts
      PASS: Exactly 1 gate manifest found: .claude/settings.json.
    node src/qa/gate-matcher-drift-check.ts
      PASS: 19 referenced tool name(s) ... all present in the vendored snapshot.
    node src/qa/normalizer-registry-purity-check.ts
      PASS: zero dispatch-chain/sibling-normalizer-import violations.
    node --test src/policy/config/sanitize.test.ts src/policy/gate/render-hook-output.test.ts hooks/pretooluse-kernel-gate-sanitize.test.ts
      tests 17 / pass 17 / fail 0 / skipped 0   (includes AC-8 real end-to-end hook-subprocess sanitization proof)
    node --test src/policy/gate/gate-structure.test.ts
      tests 5 / pass 5 / fail 0 / skipped 0     (includes G15)
    npm test   (full suite, on the PR head commit, detached)
      tests 1504 / pass 1502 / fail 2 / skipped 0

The 2 full-suite failures are environmental, not caused by this diff:
1. src/qa/reference-resolver.test.ts - QA-14 dogfood self-check reports ADR-0021 unresolved. Root cause: this review worktree's adr/ submodule is uninitialized (adr/software-engineering has 0 files), so the resolver correctly cannot find an ADR that genuinely isn't checked out here. Confirmed environmental, not a defect this PR introduced (this PR touches no ADR citations).
2. src/secret-scan/pre-commit-scan.test.ts:201 - EBUSY resource busy/locked on rmdir of a temp fresh-clone directory, a Windows temp-directory cleanup race in an unrelated fresh-clone integration test. Unrelated to any file this PR touches.

Neither failure is in a file this PR added or modified; the PR's own claimed evidence (typecheck/lint clean, 1504/1504, all QA scripts PASS) was reproduced exactly except for these two pre-existing, environment-specific flakes.

## Boundary completeness - summary

Searched the full kernel -> gate -> hook chain (src/policy/kernel/**, src/policy/gate/**, hooks/pretooluse-kernel-gate.mjs, and adjacent printer.ts/userpromptsubmit-halt-relay.mjs for comparison) for any other point where policy-authored text (rule id, rationale, or anything schema-validated but not terminal-sanitized) reaches stdout, stderr, or a session-visible string. Found none unrouted. The one adjacent hook with a stack-trace-to-stderr pattern (sessionstart-tool-enum.mjs) carries a different, non-policy data flow and is untouched by this PR.

## Verdict

APPROVE. No blockers. The sanitizer closes the real terminal-injection threat model (not a narrow subset), the injected-port design is fail-closed under an exception (not merely fail-loud in types), the one real call site is correctly wired and verified end-to-end against the actual hook process's stdout, the kernel-purity import boundary is mechanically enforced (not just asserted), and no new dependency was introduced. Live exposure is 0% (hook not wired into .claude/settings.json, per Issue #308) - this closes an activation precondition, not a live exploit, exactly as the PR describes.

## Findings -> tests mapping

All findings in this report are [CLEAN]; there are 0 open findings and 0 required new failing tests. open findings = 0, failing tests = 0 (matches).

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][code-traced] src/policy/config/sanitize.ts:24 - strip-class covers Cc (incl. ESC 0x1B, CSI 0x9B) + U+2028/U+2029, closing the actual ANSI/terminal-escape threat model, not a narrow subset; proven end-to-end on the real hook's stdout (hooks/pretooluse-kernel-gate-sanitize.test.ts AC-8).
2. [CLEAN][code-traced] sanitize.ts header - Cf (bidi/zero-width) residual is disclosed and inherited unchanged from the accepted S5 #278 precedent; cannot forge lines or escape sequences.
3. [CLEAN][code-traced] src/policy/gate/render-hook-output.ts:65 + hooks/pretooluse-kernel-gate.mjs:191 - sanitize is a required (no-default) param, one real call site, correctly wired; a missing/throwing sanitizer would throw inside main()'s try/catch -> exit 2 fail-closed, never a silent pass-through; allow path proven to never call sanitize (AC-3 spy test).
4. [CLEAN][code-traced] render-hook-output.ts sanitizedDenyJson - empty-after-sanitize fails closed (exit 2), never a blank permissionDecisionReason (AC-4 test, demonstrated).
5. [CLEAN][code-traced] Full-chain search (kernel.ts, decide-tool-call.ts, printer.ts, userpromptsubmit-halt-relay.mjs) finds no other unsanitized policy-derived output path; printer.ts's #294 site independently intact and untouched. Noted out-of-scope: sessionstart-tool-enum.mjs lines 614-618 write raw err.stack (different hook, different non-policy data flow, pre-existing, untouched by this PR - not filed).
6. [CLEAN][code-traced] gate-structure.test.ts G15 + kernel-purity-check.ts mechanically enforce zero config/ imports under src/policy/gate/** and src/policy/kernel/**; hooks/pretooluse-kernel-gate.mjs is correctly the sole exempted call site (both checks pass).
7. [CLEAN][demonstrated] package.json/package-lock.json diff against origin/master is empty - no new dependency.
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=0 suspicions=0 clean=7
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=1 code-traced=6 derived=0
checks="1502/2/0|n/a" (full suite on PR head; both failures environmental/pre-existing - see report body; targeted PR-file tests 17/17 pass, gate-structure.test.ts 5/5 pass, typecheck/lint/4 QA scripts all clean)
adr=HIT(2)
report=docs/reviews/s312-kernel-hook-sanitize-app-security-2026-09-28.md
