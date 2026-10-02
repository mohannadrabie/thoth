# #308 story H (X-11 unlock wording) - cross-domain review (Ra)

Reviewed commit: a3d9d68 (range b2b7de1^..a3d9d68). Tier CRITICAL (ratified, not re-litigated). Lanes alongside: red-team, app-security-reviewer (parallel). Not re-covered: their gate/redaction/injection ground.

📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog [CACHE=HIT]. Whole catalog read, unfiltered.

## ADR verdicts (whole catalog)
- SE ADR-0005 (testing, recorded acts): `git diff b2b7de1^ a3d9d68 -- '*test*'` shows additions only (no removed lines). Edited locked files: hook-import-pins.test.ts (+1 pair `gate.hookFailureUnlock`), gate-structure.test.ts (+2 STORY_TEST_FILES), render-hook-output.test.ts (2 cases appended). Two new test files. Nothing else locked touched. Pass; see Editorial 1 on the recording row.
- ADR-0021 / ADR-0016 / THOTH-ADR-0001: no new hook import beyond the existing `gate` namespace; unlock-text.ts has no imports (G15 green). Fixture/classification entries untouched. Pass.
- SE ADR-0010 (JSDoc type in hook): the new `@type` is a typed function, no `any`. Pass.
- Remaining devops ADRs (IaC/CDK/IAM/cost): no applicable files. SE ADR-0004/0009/0011-0015: not touched. No collision.

## Seams checked
1. [CLEAN][code-traced] Other consumers of classification-catalog.ts: only the gate hook and hooks/sessionstart-tool-enum.mjs call assembleCatalog (git grep). SessionStart's halt reason is built from `err.message` (hook:666); the wrapper preserves the message verbatim, and lowering still throws the same text. Only the stderr stack prefix changes (`Error:` -> `ClassificationCatalogError:`); no test or code matches it. policy:print does not use the catalog. R1-6c funnel and the story C shared-inventory agreement test: no reason key changed.
2. [CLEAN][demonstrated] Ran in own detached worktree at a3d9d68: `node --test src/policy/gate/*.test.ts hooks/pretooluse-kernel-gate*.test.ts src/policy/config/hook-import-pins.test.ts src/policy/tools/*.test.ts src/qa/catalog-single-source.test.ts hooks/sessionstart-tool-enum.test.ts` -> tests 236, pass 236, fail 0, cancelled 0, skipped 0. `qa:reference-resolver` PASS (0 failed).
3. [CLEAN][code-traced] Runbook vs code: catalog stderr line equals CATALOG_UNLOCK + `Error type: ClassificationCatalogError` byte for byte; generic line equals GENERIC_UNLOCK; the central clause quoted is a verbatim substring of LAYER_UNLOCK.central. The project/shipped-defaults clauses are paraphrased (not quoted), which is accurate.
4. [SUSPICION][LOW][derived] Rule 2 across all failure kinds: after H, the policy-load refusal and the catalog failure name an unlock. Other gate refusals (`malformed-input` x3, `unroutable-tool`, decide-tool-call.ts:71/76/80/85) and a kernel deny carry no `Unlock:` clause. The plan scopes H to X-11's two cases, so this is a named coverage gap, not a defect in H; no test or Issue tracks the rest. Suggest: note it in the residual register (messages state the cause; the "unlock" for a malformed host payload is not a human action).

## Coverage gaps
- The hook's non-`mcp__` internal failures keep the generic Node/checkout line by design (plan sec. 8). Intentional.
- Central layer text only unit-tested (plan sec. 8 residual; story J live check). Disclosed.

## Editorial (verdict-neutral)
1. CHANGELOG cites decisions row "AP-3 form, Phase 1 answers" item 3 for the pin edit, but that item names `render.CATALOG_FAILURE_ERROR_NAME` and `render.hookFailureUnlock`; the pair actually added is `gate.hookFailureUnlock` (design B, row "stories C and H" item 2 licenses "the new pair(s) the hook uses"). Add one sentence to decisions naming the actual pair so the recorded act matches the edit.
2. Runbook: nothing else.

Verdict: APPROVE. Open findings 0 blocking; failing tests 0 (the one SUSPICION has no executable form: it is a scope observation).

RECEIPT: verdict=APPROVE
findings:
1. [SUSPICION][LOW][derived] decide-tool-call.ts:71-85 - malformed-input/unroutable-tool refusals and kernel deny name no Unlock (out of H's X-11 scope); record as residual
2. [CLEAN][code-traced] classification-catalog.ts typed error: sessionstart halt reason uses err.message, unchanged; no consumer matches the name/stack prefix
3. [CLEAN][demonstrated] 236 tests pass across gate, hook, pins, tools, catalog-single-source, sessionstart; QA-14 pass
4. [CLEAN][code-traced] runbook strings match unlock-text.ts byte for byte
5. [CLEAN][demonstrated] SE ADR-0005: test diff additive only; only gate.hookFailureUnlock and STORY_TEST_FILES (+ appended cases) edited
counts (a CHECKSUM): issues=0 suspicions=1 clean=4
evidence (a CHECKSUM): demonstrated=2 code-traced=2 derived=1
checks=node --test (236 tests): pass 236 / fail 0 / skip 0; qa:reference-resolver: 0 failed
adr=HIT(37, whole catalog)
reviewed_commit=a3d9d68
report=docs/reviews/s308-H-unlock-cross-domain-2026-10-02.md
