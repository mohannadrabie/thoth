# App Security Review -- s332-r1-6d-module-loader-leg (PR #354, Issue #332)

Reviewer: app-security-reviewer (Horus)
Date: 2026-09-28
Branch: feat/s332-r1-6d-module-loader-leg (origin tip a5e1b7c) vs master (c2750a2)
Tier: STANDARD (Manager-ratified, run-log tier-ratified event s332-r1-6d-module-loader-leg)
Scope reviewed: src/policy/tools/classification-builtin-override.test.ts (test-only), src/policy/tools/classification-catalog.ts (comment-only), CHANGELOG.md, docs/STATE.md, docs/decisions.md, docs/run-log.jsonl

## ADR compliance

node docs/adr-cache.mjs --ensure printed: ADR cache BUILT: cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2], catalog now current (fp 9b0b204) [CACHE=HIT].

Catalog (docs/.maat-state.json -> adrCatalog.adrs) lists two applicable-to-security ADRs: THOTH-ADR-0001 (central-classification fixture standing exception) and THOTH-ADR-0002 (secret-scan allowlist, proposed -- not applicable here, no allowlist touched). THOTH-ADR-0001 is the relevant one: this diff touches the fixture-funnel self-test instrument adjacent to docs/qa/s5-central-classification.json. Checked every rule:

- Rule 1 (exception scope) -- not applicable, no allowlist entries touched.
- Rule 2 (fixture entries need a PR diff, no separate expiry) -- not applicable, no fixture entries changed.
- Rule 3 (knownConnectors not a security control) -- not applicable.
- Rule 4 (no hardcoded entries in hooks/ or src/) -- not applicable, no entries added.
- Rule 5 (loader fails closed, path resolution restricted) -- classification-catalog.ts's diff is comment-only; loader logic untouched, verified by reading the diff (single hunk, header comment lines only).
- Rule 6 (exception sunset condition) -- not applicable.
- Rule 7 (one-time test-deletion exception) -- no test was deleted in this diff; new assertions were added inside existing test() bodies and two new fixture/control entries were appended to existing arrays.

No ADR violation found. No blocker from this axis.

## What I verified myself

All commands run from the worktree, on the PR's actual file content (checked out via 'git checkout FETCH_HEAD -- <2 files>', restored to HEAD after each check; worktree left clean, git status --short empty at the end).

1. Full self-test file, green, as claimed. Ran: node --experimental-strip-types --test src/policy/tools/classification-builtin-override.test.ts. Result: tests 14, pass 14, fail 0, cancelled 0, skipped 0, todo 0. Matches the PR's claimed npm test evidence for this file. Real-tree leg printed: module-loader-helper uses [] over 99 production files.

2. The regex the story exists to build, read at classification-builtin-override.test.ts:410,444, applied to stripCommentsKeepingStrings(text) (comments stripped, strings kept):
   const MODULE_LOADING_HELPER = /\bimport\s*\{[^}]*\bcreateRequire\b[^}]*\}\s*from|\bcreateRequire\s*\(|\.createRequire\b/;

3. Claimed-covered shapes genuinely caught (mutation test). Planted a real file src/policy/tools/.review-mutation-probe-2.ts containing an aliased named import of createRequire from node:module, called through the alias, reading the fixture path. Reran the suite: the R1-6b/R1-6d no-other-production-fixture-reader test FAILED with an AssertionError naming the probe file under moduleLoaderUses (actual: one entry, expected: empty). The leg kills this mutant exactly as the CHANGELOG/decisions.md claim. Removed the file, suite green again (14/14).

4. Two bypass shapes that dodge the new leg entirely (mutation test, live). Planted a real file src/policy/tools/.review-mutation-probe.ts containing a namespace import of node:module, then a bracket/computed-property call nodeModuleNs["createRequire"](import.meta.url), then a call reading the fixture path through the result. Reran the suite: ALL 14 TESTS STILL PASSED, module-loader-helper uses [] (100 files scanned, up from 99, the new file counted and cleared). This is a real, unguarded production-shaped read of the central-classification fixture through createRequire, sitting in src/, that the leg built specifically to catch createRequire does not catch. Removed the file, suite green again.

   Isolated regex confirmation (no stripCommentsKeepingStrings interaction, same result on raw text), run via node -e against the exact MODULE_LOADING_HELPER pattern copied verbatim from the file:
   - a dynamic import() destructured with a rename (const createRequire mk = await import node:module; const rq = mk(1); rq(x);) -- regex test result: false
   - require(node:module) followed by bracket-string property access (nm[createRequire](1)) -- regex test result: false
   - a namespace import (import star as nm from node:module) followed by bracket-string property access -- regex test result: false

   Two independent, syntactically valid, semantically-identical-to-round-2 ways to obtain and call createRequire evade the leg:
   - (a) namespace/bracket or computed property access -- nm[createRequire], or nm[someVar] where someVar holds the string createRequire assembled or assigned elsewhere. Neither the dot-access alternative (no literal dot before the word) nor the direct-call alternative (the token createRequire sits inside quotes, followed by a closing bracket, not an opening paren) fires.
   - (b) dynamic import() destructured with a rename -- const createRequire renamed mk = await import of node:module. This is valid top-level-await ESM (the file family already uses import.meta.url elsewhere, confirming ESM). It does not match the import-brace alternative (that alternative requires the literal import token immediately followed by open-brace and later the literal word from; a dynamic import() expression has neither shape), does not match the direct-call alternative (no literal createRequire-open-paren -- the call is on the renamed local mk), and does not match the dot-access alternative (no dot).

5. Re-export-then-consume is still caught (checked, not a gap). A file that imports createRequire, aliased, from a local re-export helper module (not node:module directly) and calls it through the alias still matches the import-brace alternative, because that alternative only requires the literal word createRequire inside an import-brace-from binding -- it never checks that the specifier is node:module. Any file with an import-brace binding naming createRequire is caught regardless of where it is re-exported from.

6. The CommonJS module global does not expose createRequire (checked against real Node, not asserted from memory). Ran a node -e probe checking typeof module.createRequire and typeof module.constructor.createRequire -- result: undefined, function. So the per-file CJS module object has no createRequire property; only Module.createRequire (module.constructor.createRequire, or requiring the module package and reading createRequire off it) is real, and both spellings contain the literal substring dot-createRequire, so both are still caught by the dot-access alternative. This specific probe the task suggested is NOT an additional gap beyond the bracket/computed-property-access class already demonstrated in point 4.

7. False-positive control still holds. The one new control fixture (a comment plus a non-call string mentioning createRequire) is not flagged -- verified by the passing R1-6b self-test sub-assertion (part of the 14/14 green run in point 1). The strict-match design choice (import binding or call, never bare substring) is sound as far as it goes.

8. Zero production behavior change claim verified. git diff --stat between master and the PR branch touches exactly the 6 files the story claims (CHANGELOG.md, docs/STATE.md, docs/decisions.md, docs/run-log.jsonl, the test file, and classification-catalog.ts). classification-catalog.ts's diff is a single hunk, comment lines only, no code token changed. Holds.

## The finding

The completeness claim in this PR is false, and the PR closes the issue that claim justifies closing.

The new leg's own header comment (classification-builtin-override.test.ts:398-406) says the funnel needs none of this, so ANY production use of the helper is flagged, regardless of aliasing or specifier shape. The CHANGELOG and docs/decisions.md entries repeat the same claim in slightly different words. Point 4 above demonstrates that is false for two syntactically ordinary, semantically-identical-to-round-2 access shapes: namespace/bracket (computed) property access, and a dynamic-import() destructure with a rename. Both are the exact same primitive (createRequire) round-2 red-team used -- this is not a different bypass class the story never attempted to cover (that is shapes 3/4, which the PR does honestly disclose as open); it is the same class the new leg was built to close, with a syntax shape the leg's own strict two-alternative grammar does not enumerate.

That matters here specifically because commit f6b48ff carries a Closes #332 trailer, and Issue #332 is titled: the single-funnel instrument is name-based, so a production module reading the fixture path directly bypasses the lowering guard with every gate green -- i.e., #332 is the umbrella issue for exactly this defect class. Merging this PR as-is closes #332 on a claim (ANY production use, regardless of shape) that a five-minute mutation test disproves. The project's own established precedent for this exact situation (shapes 3/4, and R1-6 to R1-6b before that) is to disclose the residual honestly and defer it with a named test, not to claim closure. This PR does that for shapes 3/4 but not for the residual inside leg E itself.

Exposure: 0% of production files today -- measured (module-loader-helper uses [] over 99 real src/+hooks/ files, confirmed by the PR's own real-tree assertion and reproduced by me). No live code uses createRequire in any form yet, and the detection instrument this leg belongs to is not wired to any CI gate (Issue #308 activation precondition, per the task brief). Basis: measured, not assumed.

Impact if left uncorrected: a future reviewer or the Manager, trusting the ANY production use, regardless of shape claim and the closed #332, could wave through a real bypass module written with the bracket-access or renamed-dynamic-import shape, believing the single-funnel instrument would have caught it. That is the exact confidence-inflation problem the whole Issue #332 thread exists to fix.

Minimal fix (either is sufficient, no redesign needed):
- (a) Broaden MODULE_LOADING_HELPER to also match bracket/computed-property access (an alternative for a bracket-quoted createRequire literal) and a dynamic-import destructure pattern; or, more honestly given a token-spelling heuristic can never be complete --
- (b) Narrow the claim: reword the leg's header comment, the CHANGELOG entry and the docs/decisions.md row to disclose this residual the same way shapes (3)/(4) are disclosed (named, scoped, with a deferred proof test), and do NOT let this PR close Issue #332 -- either leave #332 open, or open a named sibling issue (matching the existing R1-6c sibling-suspicion precedent) before closing #332, so the tracking issue for the instrument is name-based does not close while a fresh instance of exactly that is sitting undisclosed in the same file.

I have no opinion on which of (a)/(b) the Manager prefers -- either resolves the finding. (b) is cheaper and matches this project's own established convention for labelled-heuristic residuals.

## Other axes (brief -- this diff has almost no surface on them)

- Access control: N/A, no endpoint/handler touched.
- Injection and input validation: N/A. The synthetic fixtures the self-test builds via template-string interpolation are built from fixed, run-time-enumerated constants (fixture export names, the fixture file name read from the real module), never from external/untrusted input -- no injection surface in a test harness that only ever runs against its own repo tree.
- Secrets: none introduced; nothing hardcoded.
- Dependencies: none added/changed.
- Sensitive-data exposure and sessions: N/A; the test only logs file-relative paths and counts to console, no secrets/PII.

## Verdict (round 1)

APPROVE-WITH-CONDITIONS.

The leg itself is a genuine, well-targeted improvement -- it correctly closes the two exact shapes round-2 red-team demonstrated (verified in point 3), correctly avoids false-positiving on prose mentions (point 7), and touches zero production code (point 8). It should ship. The condition is about the claim and the issue-closure bundled with it, not about reverting the leg:

1. Correct the completeness claim (regardless of aliasing or specifier shape) in the leg header comment, the CHANGELOG entry and the docs/decisions.md row, to disclose the bracket/computed-property-access and dynamic-import-destructure-rename residual, the same way shapes (3)/(4) are already disclosed -- fix-now, comment/record-only, no test change required.
2. Do not close Issue #332 as worded on this PR's Closes #332 line, or open a named sibling issue for this residual first (R1-6c precedent) -- this is a Manager call under Issue Discipline; I have posted the demonstrated finding as a comment on #332 rather than filing a duplicate, since #332 is the exact matching open issue for this defect class.

Both conditions are fix-now-sized (prose plus an issue-thread decision), not a rework of the code.

## Findings to tests (round 1)

1. moduleLoaderUses leg misses bracket/computed property access on the node:module namespace (a call reading the createRequire property with a bracket-string key), and misses the dynamic-import destructure-rename shape (a const with createRequire renamed inside the destructure, from an awaited dynamic import of node:module). Proposed named failing tests: R1-6d-1 module-loader-helper-property-access-leg (a synthetic bypass fixture using the namespace-import-plus-bracket-access shape, asserted to land on moduleLoaderUses), and R1-6d-2 module-loader-helper-dynamic-import-destructure-leg (a synthetic bypass fixture using the dynamic-import destructure-rename shape, asserted to land on moduleLoaderUses).

Open findings: 1 (both sub-shapes are the same finding, same root cause, same fix). Failing tests proposed: 2 (one per concrete shape, matching this file's own convention of one fixture per demonstrated shape). The difference (1 finding, 2 tests) mirrors how the PR itself treats round-2's shapes 1 and 2 as one finding with two fixtures.

RECEIPT (round 1): verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [ISSUE][MED][demonstrated] classification-builtin-override.test.ts:410 -- MODULE_LOADING_HELPER regex misses bracket/computed property access on node:module's createRequire and misses the dynamic-import destructure-rename shape; both proven live via mutation test (real file planted in src/, suite stayed 14/14 green, moduleLoaderUses empty); undermines the PR's own regardless-of-aliasing-or-specifier-shape claim and the Closes #332 on commit f6b48ff; fix: broaden the regex or honestly narrow the claim plus do not close #332 without a sibling residual issue.
2. [CLEAN][demonstrated] classification-builtin-override.test.ts:398-421 -- the two shapes the leg claims to close (aliased named-import binding; call via re-export) are genuinely caught, confirmed by planting a real mutant and watching the real-tree assertion fail as expected, then pass clean after removal.
3. [CLEAN][demonstrated] classification-builtin-override.test.ts -- strict-match design correctly avoids flagging a comment-only/non-call mention of createRequire (existing control, part of the 14/14 green run).
4. [CLEAN][code-traced] classification-catalog.ts -- diff is comment-only (single hunk, header prose), no loader/guard logic changed; THOTH-ADR-0001 rules 4-5 (no hardcoded fixture entries, loader fails closed / path resolution) unaffected.
5. [CLEAN][demonstrated] git diff --stat master to origin feat/s332-r1-6d-module-loader-leg -- zero-production-behavior-change claim holds: exactly the 6 claimed files touched, no other file in the diff.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=4
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=4 code-traced=1 derived=0
checks="14/0/0|n/a"
adr=HIT(2)
report=docs/reviews/s332-r1-6d-module-loader-leg-app-security-2026-09-28.md

---

## Addendum: re-confirm pass (fix-now delta f6b48ff..fe0d18d), 2026-09-28

Scope: lightweight re-confirm, not a fresh full review. Purpose: confirm the fix-now delta closes round-1 finding 1 without introducing anything new, per the Manager's dispatch. Delta reviewed with a diff between f6b48ff and fe0d18d -- 5 files, comment/prose-only (CHANGELOG.md, docs/STATE.md, docs/decisions.md, docs/run-log.jsonl, src/policy/tools/classification-builtin-override.test.ts). ADR cache re-run: ADR cache BUILT, cataloged 2 ADRs, adr/devops 0, adr/software-engineering 0, docs/adr 2, catalog now current, fingerprint 9b0b204, CACHE=HIT -- same fingerprint as round 1, no ADR-catalog drift; same two applicable ADRs (THOTH-ADR-0001 relevant, unaffected -- this delta touches no loader/guard logic). No new applicable-ADR violation.

### What I verified myself, this pass

1. Disclosed-residual wording matches the demonstrated shapes exactly. Diffed the test file myself. New shapes (5)/(6), added at the file's residual-note comment block, name: shape 5, bracket/computed-property access on the node:module namespace object (a bracket-string createRequire lookup), no dot before the property name so the dot-createRequire alternative never fires, and no createRequire-open-paren substring either since the literal is quoted; shape 6, a dynamic import() destructured with a rename (a const destructure renaming createRequire to a short local, from an awaited dynamic import of node:module), which is neither a static import-brace-from clause (leg E's first alternative) nor a createRequire-open-paren or dot-createRequire call site (its other two). This is a precise restatement of round-1 finding 1's shapes (a) and (b) -- not broadened, not narrowed, both concrete evasions named with the same mechanism explanation I gave (why each of leg E's three alternatives fails to fire). The leg's own top-of-file claim (was: ANY production use, regardless of aliasing or specifier shape) is now scoped to a static import-clause binding or a direct/property call, with an explicit pointer to the RESIDUAL note -- matches condition 1 exactly.

2. MODULE_LOADING_HELPER regex, and all other scan logic, byte-identical to round 1. Diffed the test file and filtered for added lines that are not comment lines -- zero output. Every added line in the delta is a comment line; no code line (regex, function body, assertion, fixture) changed. Read the regex itself at its unchanged context line -- identical string to what I quoted in round 1's point 2. Confirms the fix is disclosure-only (option b from my round-1 minimal-fix menu), as the PR states.

3. Real test suite passes at the new tip. Ran the self-test file at HEAD fe0d18d: tests 14, pass 14, fail 0, cancelled 0, skipped 0, todo 0 -- same 14/14 as round 1 (comment-only delta, no new test added, none expected). Real-tree leg still prints module-loader-helper uses empty over 99 production files -- 0% live exposure, unchanged.

4. Closes #332 confirmed gone from the PR description. Queried the PR's closing-issue references, body and head SHA via gh: closingIssuesReferences is an empty array, headRefOid matches fe0d18d (the stated tip). PR body now reads: this PR narrows Issue #332's scope, it does not close it, Issue #332 stays OPEN -- and names Issue #355 for the shapes-3/4 residual. Matches condition 2. (Per the Manager's ruling, the first commit f6b48ff's own commit-message trailer still literally contains a Closes #332 line -- an accepted, disclosed residual risk under this project's regular-merge-commit workflow, not mine to re-litigate; noted here only for completeness, not as an open item.)

5. No new surface introduced. The file-level diff stat between f6b48ff and fe0d18d touches exactly the 5 files listed above, all comment/prose/log; no src/ code file, no new dependency, no new endpoint, no secret-shaped string. The one editorial fix (QA-14 diff-mode citation counts corrected) is prose-only and out of this axis's scope.

### Verdict (updated)

APPROVE. Both round-1 conditions are met: the completeness claim is now accurately scoped to what leg E covers, the two demonstrated evasions are named precisely (not over- or understated), the regex/scan logic is provably untouched, the real suite is still 14/14 green, and Closes #332 is confirmed absent from the PR's own closing-issue mechanism. No new finding from this delta. The one residual (round-1's commit-trailer auto-close risk) is a Manager-accepted, disclosed risk outside this reviewer's remit to gate on.

RECEIPT (addendum): verdict=APPROVE
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][demonstrated] classification-builtin-override.test.ts residual-note comment, delta f6b48ff to fe0d18d -- shapes (5)/(6) accurately restate round-1's demonstrated bracket/computed-property and dynamic-import-destructure-rename evasions; claim narrowed from regardless-of-aliasing-or-specifier-shape to the three concrete forms leg E actually matches. Round-1 finding 1 closed by disclosure (option b).
2. [CLEAN][code-traced] classification-builtin-override.test.ts:410,444 -- MODULE_LOADING_HELPER regex and all other scan logic byte-identical to round 1 (confirmed: every added/removed line in the delta is a comment line, zero code-line changes).
3. [CLEAN][demonstrated] self-test run at HEAD fe0d18d -- 14/14 pass, 0 fail, 0 skipped; real-tree leg still empty (0% live exposure).
4. [CLEAN][demonstrated] PR 354 metadata query -- closingIssuesReferences empty, headRefOid matches fe0d18d, PR body states #332 stays open and names Issue #355 for the remainder. Round-1 condition 2 met.
5. [CLEAN][demonstrated] file-level diff stat f6b48ff to fe0d18d -- exactly 5 files touched, all comment/prose/log; no code, dependency, or secret surface added.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=0 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=4 code-traced=1 derived=0
checks="14/0/0|n/a"
adr=HIT(2)
report=docs/reviews/s332-r1-6d-module-loader-leg-app-security-2026-09-28.md
