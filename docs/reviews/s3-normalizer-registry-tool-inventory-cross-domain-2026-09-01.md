# S3: Normalizer registry + tool inventory — Cross-Domain Review (Ra)

**Scope:** GitHub Milestone #21 (POL-04, POL-12, SUR-01, SUR-03, SUR-04), built on shipped S2 (commit `5d60a38`). Uncommitted working-tree diff on `master`.
**Date:** 2026-09-01
**Reviewer:** cross-domain-reviewer (Ra)
**Tier:** STANDARD (ratified, `docs/run-log.jsonl` 2026-09-02T02:55:36.883Z)

## Lane coverage

- `app-security-reviewer` is running in parallel (authz/injection/deps lane) — no S3 report persisted yet at review time; this pass does not assume or duplicate its findings.
- This pass: whole ADR catalog (not a domain slice), cross-lane ADR collisions, seam-hunting at domain intersections, coverage gaps, redundancy check.

## ADR cache

```
📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ≈17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]
```
Full catalog read (both devops and software-engineering roots), not filtered to any domain's applicableTo.

## Whole-catalog ADR verdict

- **ADR-0021 (accepted)** — governing ADR for this story. All cited "Rules for agents" checked directly against code, not against prior reviewers' findings:
  - POL-11 (kernel purity): `qa:kernel-purity` run live — `PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.` File count unchanged from S2 — `git status --short` confirms zero diff to any file under `src/policy/kernel/**` in this story. Non-vacuous, confirmed.
  - POL-12 (declaration-based registry): `qa:normalizer-registry-purity` run live — `PASS: src/policy/normalizer/registry.ts: zero dispatch-chain/sibling-normalizer-import violations.` The checker (`src/qa/normalizer-registry-purity-check.ts`) is itself non-vacuous: its own `violating/` selftest fixture (`src/qa/selftest-fixture/normalizer-registry-purity/violating/registry.ts`) demonstrates both forbidden shapes (sibling import + switch) are actually caught, not just asserted clean by convention. `registry.ts` (`src/policy/normalizer/registry.ts:19,30,38`) imports no concrete normalizer; each of `shell.ts`/`structured-cluster.ts` calls `registerNormalizer()` on itself at import time — declaration, not dispatch chain, confirmed structurally.
  - Normalizers never return a verdict — confirmed: `normalizeShellCall`/`normalizeStructuredClusterCall` return only `ActionRecord`, no `Verdict`-shaped value anywhere in `src/policy/normalizer/*.ts`.
  - Kernel never inspects tool identity — confirmed: zero diff to `kernel.ts`; nothing in the new normalizer/tools/verification code is imported by the kernel (one-directional dependency, verified by absence of any reverse import).
  - Unresolved/opaque as the only acceptable ambiguity fallback, never silent allow — traced two independent decision points, both new in S3, both structurally the same shape as S2's Issue #62 near-miss:
    - `evaluateToolInventory()` (`src/policy/tools/classification.ts:63-81`): `haltRequired` is `unclassified.length > 0` — any single unrecognized session tool halts, no implicit default class. Tested for empty catalog, empty session list, multiple unclassified tools (`src/policy/tools/classification.test.ts`).
    - `verifyAllowlistInForce()` (`src/policy/verification/allowlist.ts:39-73`): every branch not explicitly matching a compliant shape returns `compliant: false`; non-object/non-record input, null/undefined/array/string inputs, and non-string-array `allowedMcpServers` entries all tested (`src/policy/verification/allowlist.test.ts:40-50`).
    - `normalize()`'s unknown-toolType fallback (`src/policy/normalizer/registry.ts:61-75`): always emits `source: "opaque"` with a non-empty `unresolved`. Traced against `kernel.ts`'s `isMutating()`/`pol05Rule()` (unchanged, S2-shipped): `isMutating` is `verbs.some(mutating) || unresolved.length > 0` (`kernel.ts:72-74`, the Issue #62 fix), and `pol05Rule` denies unconditionally when `source === "opaque"` (`kernel.ts:96-99`) — so the opaque fallback is denied regardless of the "unknown" placeholder strings `bestEffortString()` fills into `environment`/`identity`. No path exists where an unrecognized tool type resolves to allow. Confirmed end-to-end by `registry.test.ts`'s "criterion 6" tests (lines 117-129), which run real fixture calls through `normalize()` then `decide()` and assert `outcome: "deny"`, `ruleId: "POL-05"` — a genuine, running proof, not a hand-derived completeness claim.
  - Result: no ADR-0021 collision found.
- **SE ADR-0002 (dependency inversion) / SE ADR-0003 (SOLID)** — checked directly against code:
  - Registry is a genuine port: it exports only `registerNormalizer`/`resolveNormalizer`/`normalize`, holds a Map, and is reached BY normalizers, never reaches FOR one. Dependency direction: `shell.ts`/`structured-cluster.ts` (adapters) depend on `registry.ts` (port) and on `kernel/action-record.ts`'s public type — never the reverse.
  - No dispatch-chain ladder: lookup is `Map.get`, not switch/if-else keyed on tool identity (confirmed by both manual read and the structural checker).
  - No over-abstraction: `NormalizerEntry` is a single, minimally-shaped interface; no speculative multi-strategy hierarchy for a two-implementation set.
  - Result: no collision.
- **SE ADR-0005 (testing strategy)** — happy path, error/boundary paths, and determinism covered per new file. `node --test --experimental-test-coverage` run live: 236/236 pass, 0 fail, 0 skipped; every new S3 production file at 100% line/100% branch except `shell.ts` (100% line, 90% branch, no uncovered lines flagged) — well above the 80% floor. Idempotency-test requirement (ADR-0004) does not apply — these are pure, side-effect-free functions; determinism is instead asserted directly (`precedence.test.ts`: merging the same two layers twice yields identical results).
  - Result: no collision.
- **SE ADR-0010 (code-quality gates)** — `npx eslint .` and `npx tsc --noEmit -p tsconfig.json` both run live, zero output, zero findings. No new third-party dependency added (`package.json` diff is one new npm script line only). No suppression/ignore-list changes.
  - Result: no collision.
- **Sensitive area: `.github/workflows/ci.yml`** (CLAUDE.md's named sensitive area) — this diff touches it: a 3-line addition wiring `qa:normalizer-registry-purity` into the main ci job, in the shape of the pre-existing kernel-purity-check step immediately above it. No gate removed, weakened, or made non-blocking; the new gate itself was run live above and is non-vacuous. This falls outside app-security-reviewer's typical authz/injection/deps focus — traced directly here to close that gap.
  - Result: reviewed, clean.
- No devops-domain ADR (adr/devops/*) applies — this diff contains no IaC/CDK/pipeline/tagging/cost changes.

## Seam findings

1. **precedence.ts refactor (POL-08 <-> SUR-03/T5 seam) — verified non-regressive.** `mergeLayers`'s existing S2 tests are untouched in the diff (`git diff src/policy/rule/precedence.test.ts` shows only new tests appended, none of the original six modified). The refactor factors the three-layer merge into a generic `mergeLayersById<T>(layers, keyOf)` core (`precedence.ts:45-59`), which both `mergeLayers` (three-tier, keyed by Rule.id) and the new `mergeToolClassificationLayers` (two-tier, keyed by ToolClassificationEntry.name) call. Signature of `mergeLayers` is byte-identical to S2; behavior (first-appearance order, later-layer-wins, version-resolution rule) is preserved by inspection and by the full test suite passing (236/236, including all six original mergeLayers tests). Clean — no regression to already-shipped S2 functionality.
2. **Registry <-> kernel integration (POL-04/POL-12 <-> POL-05/POL-11 seam) — verified genuinely wired, not just declared.** `registry.test.ts:81-94` runs a real structured call and its shell-equivalent fixture through `normalize()` then the real, unchanged `decide()` kernel function, and asserts both produce the same verdict (deny, ruleId: protect-prod-delete), reusing S2's already-reviewed CONFLICTING_RULE_ID rule fixture rather than a fresh one invented for this story. This is the load-bearing cross-domain proof for POL-04's "yield the same verdict" bar, and it is a real running test, not an assumption. Clean.
3. **SUR-03 tool-inventory gate vs. per-action kernel verdict — two independent classification mechanisms, correctly not conflated.** `evaluateToolInventory()` classifies tool availability (session-start, coarse allowlist); the kernel's decide()/normalizer pipeline classifies individual calls (fine-grained, per-action). Traced both to confirm neither silently substitutes for the other and neither claims to — S3 does not wire them together (correctly deferred: SUR-03's hook wiring is S5, per docs/decisions.md's 2026-09-01 S3-intake row). No contradiction found; naming this so a future story doesn't have to re-derive that these are deliberately separate layers, not a gap.

## Coverage gaps

- `docs/backlog.md`, `CHANGELOG.md`, `docs/decisions.md`, `docs/run-log.jsonl` diffs are prose/process-log updates only — no material review lane needed; confirmed by reading, not assumed. The backlog closure claim (S2's Issue #62-adjacent residual note, "closed in S3") was independently checked against registry.test.ts's criterion-6 tests and found accurate, not hand-waved.
- No file type or concern in this diff was found unclaimed by every reviewer's lane. `.github/workflows/ci.yml` (the one sensitive-area touch outside app-security's typical focus) is covered directly above, not left as a gap.

## Story-boundary discipline

- Grepped all new files (src/policy/normalizer/**, src/policy/tools/**, src/policy/verification/**) for readFile, fetch, http, fs., child_process, process.env, spawn — zero matches. No premature live I/O; the S4/S5/S6/S9/S14 boundaries named in docs/decisions.md's 2026-09-01 S3-intake row are genuinely respected in code, not just in comments.
- No gold-plating found reaching into deferred story territory.

## Redundancy check

- Did not re-list: S2's Issue #62/#63 history (already closed/tracked, referenced only as context per the dispatch brief). No finding here duplicates a prior reviewer's already-surfaced item.

## Verdict

APPROVE.

No ADR-0021, SE ADR-0002, SE ADR-0003, SE ADR-0005, or SE ADR-0010 collision found across the whole catalog. mergeLayers' S2 behavior is verified non-regressive. evaluateToolInventory() and verifyAllowlistInForce() independently traced and confirmed fail-closed, not repeating S2's Issue #62 shape. All 236 tests pass live; lint and typecheck clean; both new structural QA gates (kernel-purity, normalizer-registry-purity) run live and non-vacuous.

## Next action

None required — story is shippable from this lane. Await app-security-reviewer's parallel pass before Stage 4 (verify).

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [CLEAN][code-traced] src/policy/kernel/** - POL-11 kernel purity intact, zero diff, qa:kernel-purity live PASS (4 files, 0 violations)
2. [CLEAN][code-traced] src/policy/normalizer/registry.ts:19,30,38 - POL-12 declaration-based registry, no dispatch chain, qa:normalizer-registry-purity live PASS, non-vacuous selftest fixture proof
3. [CLEAN][demonstrated] src/policy/normalizer/registry.ts:61-75 + kernel.ts:72-99 - unrecognized toolType leads to opaque + non-empty unresolved leads to unconditional POL-05 deny, proven end-to-end by registry.test.ts:117-129 (criterion 6 tests), not S2 Issue #62's silent-allow shape
4. [CLEAN][demonstrated] src/policy/tools/classification.ts:63-81 - evaluateToolInventory fail-closed (haltRequired on any unclassified tool), independently traced + tested for empty catalog/list/multi-unclassified
5. [CLEAN][demonstrated] src/policy/verification/allowlist.ts:39-73 - verifyAllowlistInForce fail-closed on every non-compliant/malformed shape, independently traced + tested incl. non-object/non-string-array inputs
6. [CLEAN][code-traced] src/policy/rule/precedence.ts:45-121 - mergeLayers refactor (shared mergeLayersById core) verified byte-identical signature/behavior; original S2 tests untouched, all pass; new mergeToolClassificationLayers correctly two-tier per T5 ruling
7. [CLEAN][demonstrated] src/policy/normalizer/registry.test.ts:81-94 - structured/shell parity proven through registry -> real unchanged kernel decide(), same verdict, reusing S2's reviewed fixture
8. [CLEAN][code-traced] .github/workflows/ci.yml - sensitive-area touch (3-line gate addition, matches existing pattern, no gate weakened), reviewed directly to close the lane gap
9. [CLEAN][code-traced] SE ADR-0002/0003 - registry is a genuine port (one-directional dependency), no over-abstraction, Map-based not dispatch-chain
10. [CLEAN][demonstrated] SE ADR-0005/0010 - 236/236 tests pass, 100% line/branch coverage on new files (shell.ts 90% branch, no uncovered lines), lint + typecheck zero findings, no new dependency
11. [CLEAN][code-traced] story-boundary discipline - grep confirms zero premature fs/network/process I/O in new files; S4/S5/S6/S9/S14 deferred scope genuinely respected
counts (a CHECKSUM): issues=0 suspicions=0 clean=11
evidence (a CHECKSUM): demonstrated=6 code-traced=5 derived=0
checks=node --test: 236 pass/0 fail/0 skipped; qa:kernel-purity PASS (4 files, 0 violations); qa:normalizer-registry-purity PASS; eslint . clean; tsc --noEmit clean
adr=HIT(35, whole catalog)
report=docs/reviews/s3-normalizer-registry-tool-inventory-cross-domain-2026-09-01.md
