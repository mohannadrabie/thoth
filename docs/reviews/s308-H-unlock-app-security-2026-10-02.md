# #308 story H (X-11 unlock wording) — app-security review (Horus)

- Date: 2026-10-02. Tier CRITICAL (ratified). Reviewed commit: a3d9d68 (range b2b7de1^..a3d9d68).
- ADR: 📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] (fp 13c1476) [CACHE=HIT]. No applicable security ADR violated.
- Method: read the diff via `git show`; ran in a detached worktree at a3d9d68 (removed after). Red-team's fail-open lane not duplicated.

## Verdict: APPROVE

## Evidence run
- `npm run typecheck` (tsconfig + tsconfig.hooks): clean, no output errors.
- `npm run qa:hook-typecheck-coverage`: PASS; hooks/pretooluse-kernel-gate.mjs 0 diagnostics, fully covered. `unlockFor` is JSDoc-typed (hook :90-92); no suppression comment.
- `node --test` on hooks/pretooluse-kernel-gate*.test.ts, hook-import-pins.test.ts, sanitize.test.ts, src/policy/gate/*, kernel-purity, catalog-single-source: 311 tests, 310 pass, 0 skipped, 1 "fail" = the bare directory argument `src/policy/gate` that I passed to node --test (runner artifact, not a test; every file inside passed).

## Axes
1. Output injection (deny reason, stderr): clean. Every string in `unlock-text.ts` is a fixed ASCII constant. Layer and kind print only via `boundedLayerName` / `boundedReasonKind` (own-key / list membership, so `__proto__`, `toString`, non-strings all print `unknown`, generic line). Reason still passes the single `sanitize` site in render-hook-output. Stderr name is still gated by `/^[A-Za-z]{1,40}$/` before it selects text (hook :120-127).
2. Closed table: `hookFailureUnlock` is total (anything but the exact name returns GENERIC_UNLOCK); `policyLoadUnlock` uses `hasOwnProperty` on a frozen map. Truly closed.
3. Typed error / cause: `ClassificationCatalogError` keeps the original message (path, entry name) and `cause`, unchanged for print-cli/sessionstart. The hook prints only the name; nothing in src/hooks reads `.cause` (git grep on a3d9d68). Message never reaches the gate stderr or the reason.
4. Env-read graph AC-3j-1/3/4: green (hook-import-pins, sanitize tests). `unlock-text.ts` has no imports, no env access. New pair `gate.hookFailureUnlock` is a real export, not an env reader; pin set stays exact. Note the plan's `render.*` pairs were replaced by one `gate.*` pair via a re-export in decide-tool-call.ts; fewer pairs than planned, no new import.
5. Runbook strings: the Symptom/catalog-row strings match `unlock-text.ts` and the hook line character for character (catalog line, generic line, per-layer wording, `unknown` fallback).

## Findings
- No blocking findings. Hardening only (both LOW, below).

## Hardening / residuals (not blocking)
- LOW: error-name coupling is by string in two constants (`CATALOG_ERROR_NAME`, `CATALOG_FAILURE_ERROR_NAME`); a test asserts equality. Any thrown value of that exact name selects the catalog line; only repo code can set it (plan residual R1, accepted by Manager).
- LOW: `assembleCatalog` wraps every built-in/fixture failure, so a missing built-in layer also says "fix the classification file" (plan residual, wording remains a reviewed repo change).

## Editorial
- None.

## Next action
Ship H on app-security; proceed with red-team and cross-domain reports.

RECEIPT: verdict=APPROVE
findings:
1. [LOW][SUSPICION][code-traced] src/policy/gate/unlock-text.ts:17 / classification-catalog.ts:76 — error-name selects text; duplicated constant (test-pinned); any thrown error with that name picks the catalog line, repo-only, accepted residual
2. [LOW][SUSPICION][code-traced] classification-catalog.ts:139-141 — every built-in/fixture load failure maps to the classification-file unlock; wording stays a reviewed-change remedy
3. [CLEAN][demonstrated] deny reason and stderr: fixed ASCII only; layer/kind bounded to `unknown`; no path/stack/cause reaches either (grep for .cause, tests green)
4. [CLEAN][demonstrated] env-read graph AC-3j-4 and new pin gate.hookFailureUnlock green; hook typecheck 0 diagnostics, JSDoc, no suppression
5. [CLEAN][code-traced] runbook strings match code exactly
counts: issues=0 suspicions=2 clean=3
evidence: demonstrated=2 code-traced=3 derived=0
checks="310/0/0"
adr=HIT(37)
report=docs/reviews/s308-H-unlock-app-security-2026-10-02.md
