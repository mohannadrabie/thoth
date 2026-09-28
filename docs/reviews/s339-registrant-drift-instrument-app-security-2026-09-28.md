# App Security Review — s339-registrant-drift-instrument (PR #350)

**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-28
**Scope:** GitHub PR #350, branch `feat/s339-registrant-drift-instrument`, tip `5710c88`, against `master` (origin tip `c2750a2`). Issue #339.
**Tier:** STANDARD, ratified (test-only, zero production edit, gate hook unwired -- zero live exposure). Sensitive area: "Policy delivery / config surface" (`src/policy/config/`) per CLAUDE.md, hence this report regardless of tier.

## ADR compliance

`node docs/adr-cache.mjs --ensure` produced: `ADR cache BUILT: cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2] [CACHE=HIT]`. The org submodule (`adr/devops`, `adr/software-engineering`) is not populated in this environment (0 entries each); the two locally cataloged ADRs are `docs/adr/thoth-0001-...` (central-classification fixture exception) and `docs/adr/thoth-0002-...` (value-scoped secret-scan allowlist). Read both in full: neither's `applicableTo`/`constraints.security` rules govern the normalizer registry, `rule-reachability.test.ts`, or the registrant-scan mechanism this diff adds -- they are scoped to a different fixture and a different gate. No applicable ADR was violated. (SE ADR-0021/POL-12, cited in the diff's own comments, lives in the unpopulated submodule and could not be read directly here; nothing in this diff edits `registry.ts` or the registration mechanism POL-12 governs, so there is nothing to check it against.)

## Constraint verification

Confirmed via `git diff origin/master...origin/feat/s339-registrant-drift-instrument --stat`: only `CHANGELOG.md`, `docs/STATE.md`, `docs/run-log.jsonl`, `src/policy/config/rule-reachability.test.ts` changed. No file under `src/policy/normalizer/**` or `src/policy/kernel/**` is touched. `checkRuleReachability`'s behavior is unchanged -- confirmed by running the diff's test file against the unmodified production tree (below) and by reading `rule-reachability.ts` unchanged in the diff stat.

## What I ran

Overlaid the PR's test file onto a clean worktree of the same base tree (production code identical since the diff touches no production file) and ran it directly (worktree isolation prevented a checkout against the shared repo, so I used `git show <ref>:<path> > <path>`, ran, then `git checkout -- <path>` to restore):

```
node --test src/policy/config/rule-reachability.test.ts
...
tests 18
pass 18
fail 0
skipped 0
```
18/18 pass, matching the CHANGELOG's claim (16 pre-existing + 2 new, R2-21 parts 1 and 2). R2-21 part 1 log line: `95 production src/ files scanned ... registrant call sites found in ["src/policy/normalizer/shell.ts","src/policy/normalizer/structured-cluster.ts","src/policy/normalizer/tool-class.ts"]`.

**Adversarial check (demonstrated, not hypothetical).** The task asked whether a differently-formatted future `registerNormalizer` call could dodge the regex. I added a scratch file (never committed, removed before finishing, so this path does not exist in the tree) under src/policy/normalizer/, named scratch-http-bypass.ts:

```ts
import { registerNormalizer } from "./registry.ts";

function makeEntry() {
  return { toolType: "http", normalize: (raw) => raw };
}

registerNormalizer(makeEntry());
```

This is a real `registerNormalizer` call site in production `src/`, registering a fourth tool type -- exactly the shape R2-21 exists to catch. Reran the test:

```
R2-21 part 1: 96 production src/ files scanned (registry.ts and *.test.* excluded);
  registrant call sites found in ["src/policy/normalizer/shell.ts",
  "src/policy/normalizer/structured-cluster.ts","src/policy/normalizer/tool-class.ts"]
R2-21 part 1 ... PASS
tests 18
pass 18
fail 0
```

**R2-21 part 1 kept passing.** The scanned-file count went from 95 to 96 (the scratch file was reached), but the "registrant call sites found" set stayed exactly the three originals -- the fourth real registrant was invisible to the scan and the test reported false coverage. Removed the scratch file and restored the original test file (`git checkout -- src/policy/config/rule-reachability.test.ts`); working tree confirmed clean afterward.

## Findings

### 1. [MED] Regex requires an inline object-literal argument; any indirection (builder function, factory, variable, or aliased import) is a silent false negative -- demonstrated

`src/policy/config/rule-reachability.test.ts:611` (`REGISTRANT_CALL = /registerNormalizer\s*\(\s*\{/`). The detector matches only the literal token `registerNormalizer` immediately followed by `(` and then `{` -- i.e., only a call whose argument is written as an inline object literal, the shape all three current registrants happen to share. Demonstrated above: `registerNormalizer(makeEntry())` -- a call passing the same `NormalizerEntry` shape via a one-line factory function, an entirely ordinary refactor once a codebase accumulates several near-identical registration blocks -- is never flagged. The same class of miss applies to `registerNormalizer(SOME_CONST)` (entry built as a module-level object) and to an aliased import (`import { registerNormalizer as reg } from "./registry.ts"; reg({...})`), since the scan is a syntactic token match, not a call-graph or semantic analysis.

**Why this matters here specifically:** the PR's own commit message and CHANGELOG state R2-21 "proves ... R2-19's drift-detection coverage ... genuinely spans every registrant, not just the three someone remembered to wire up" (commit `5710c88`; `CHANGELOG.md`'s new "Added -- Issue #339" entry). That claim is broader than what's true: R2-21 spans every registrant using one specific call shape. A future 4th normalizer written with a shared builder (plausible exactly because POL-12/ADR-0021 encourages more per-tool-type files as the registry grows, and DRY pressure naturally produces a shared `makeEntry`-style helper once there are 4-5 of them) would silently reproduce the exact blind spot Issue #339 exists to close, while R2-21 stays green and gives false assurance that coverage is complete.

**Attack sketch (one line):** a future engineer adds a 4th normalizer via `registerNormalizer(buildHttpEntry())`; R2-21 part 1 still asserts the set equals the original three and passes; the normalizer's emitted verb is never fed through R2-19's drift check; if that verb falls outside the catalog, `checkRuleReachability` can falsely reject (or, per the sibling red-team finding on #339, falsely accept) a matchable/unmatchable rule with no test noticing -- the identical failure mode #339 was opened to close.

**Minimal fix:** broaden the detector past the single literal shape, OR -- cheaper and consistent with "labelled heuristic" framing already used for the disclosed file-identity residual -- add a second disclosed-residual bullet to the test's header comment naming this gap explicitly (non-literal-argument call shapes are not caught), and soften the commit/CHANGELOG language from "genuinely spans every registrant" to "spans every registrant using today's inline-object-literal call convention." Either resolves it; the second is a one-paragraph, same-PR edit.

**Evidence:** demonstrated (ran the real test against a real added file on disk, in place, no mocking).
**Exposure:** 0% of live requests today -- the gate hook is unwired (confirmed: no `PreToolUse` entry references this path per `docs/STATE.md`/prior reports) and no production normalizer uses this shape yet, so nothing is exploitable right now. The exposure is to the instrument's own completeness claim: should a builder-shaped registrant land before Issue #308's gate-wiring work ships, this specific proof would not catch it, and the CHANGELOG/commit record would already say the gap is closed. Basis: measured (the scratch-file run above is the measurement, not an assumption).

### 2. [LOW, verified accurate] Disclosed residual (file-identity keying) -- CLEAN, not a new finding

The test's own header comment discloses: a second `registerNormalizer` call added inside one of the three existing files would not be caught, because the scan keys on file identity (`registrantFiles` only tests `.test()`, not counting occurrences). Verified by reading `registrantFiles()` (`rule-reachability.test.ts:617-619`): correct as stated. No action needed -- noting it as verified-sound because I checked it, not because it's new.

### 3. [LOW] Extension coverage gap -- .mts/.cts not scanned

`walkProduction` (`src/policy/config/rule-reachability.test.ts:589`) matches `/\.(ts|mjs|js)$/` and excludes `/\.test\.(ts|mjs|js)$/`. A future registrant file using `.mts`/`.cts` (not used anywhere in this codebase today) would be invisible to the scan, and separately would also be invisible to the `.test.` exclusion if a test file used those extensions (excluding a real test file's own registrant-shaped code accidentally -- a fail-open-the-other-way, not a security miss, and moot since no such file exists). Cosmetic; codebase-wide convention is `.ts` only. No fix required now.

**Evidence:** code-traced.
**Exposure:** basis: assumption (no `.mts`/`.cts` file exists in this tree today -- counted in code, `find src -iname '*.mts' -o -iname '*.cts'` returns nothing). Capped at LOW per PRINCIPLES rule 21.

### 4. [CLEAN] Path exclusion of registry.ts is exact-path, not basename -- no accidental exclusion of a same-named file elsewhere

`REGISTRY_MODULE_REL = "src/policy/normalizer/registry.ts"`; the filter is `rel !== REGISTRY_MODULE_REL`, an exact relative-path match. Verified: `src/qa/selftest-fixture/normalizer-registry-purity/{clean,violating}/registry.ts` -- two other files also named `registry.ts` -- are NOT excluded by this filter and are correctly included in the scan (confirmed both files hold no `registerNormalizer({` call-shape match, so no false positive results, but the point stands structurally: a real registrant file could never be silently excluded just by sharing a basename with the real registry).

### 5. [CLEAN] Part 2 self-test is not vacuous, and the control cases are real

`registrantFiles()` is exercised directly against a hand-built array holding the three real call shapes plus a fourth (`http.ts`), and the assertion is `deepEqual(found, expectedWithFourth)` -- a synthetic file that is not named would fail this assertion, so the test is not tautological. The two control files (comment-only mention, bare-parens template-string mention) mirror the two real prose mentions verified present in `src/qa/normalizer-registry-purity-check.ts:17,49` (part 1 explicitly asserts `purityCheck.text.includes("registerNormalizer()")`), so the "control matches a real in-tree shape" claim is accurate, not asserted in the abstract.

### 6. [CLEAN] No injection/secrets/dependency/access-control exposure

This diff adds a Node built-in (fs, path, url) file-system read of the repo's own `src/` tree at test-run time. No network input, no user-controlled path, no new dependency, no credential, no endpoint, no session/token handling. Axes 1, 3, 4, 5 of the standard review are not applicable to this diff -- confirmed by reading the full diff, not assumed.

## Editorial (non-blocking)

- CHANGELOG's "Demonstrated against the real tree, not just synthetically" bullet says a scratch fourth normalizer was added and removed pre-commit, confirming R2-21 part 1 fails and names it -- that claim is corroborated by my own independent repeat of the same experiment (finding 1's demonstration), so it is accurate as stated for the shape the PR author tried (an inline-literal 4th file). It just doesn't generalize to every future shape, which is finding 1.

## Verdict

**APPROVE-WITH-CONDITIONS.**

Zero production code touched (verified), 18/18 tests pass (demonstrated), no ADR violated, no secrets/injection/access-control/dependency exposure. The one MED finding does not make anything worse than before this PR -- R2-21 is strictly additive coverage over R2-19's prior state (zero registrant-drift proof at all) -- so it does not warrant blocking merge of a zero-live-exposure, test-only instrument. It does mean the PR's own claim of what it proves is overstated, which a MED-tier finding on a security-adjacent proof instrument's own accuracy should not silently ship.

**Condition (same-turn, per CLAUDE.md's conditional-clean handling):** before or immediately after merge, either (a) narrow the commit-message/CHANGELOG claim from "genuinely spans every registrant" to "spans every registrant using today's inline-object-literal registration shape," and add the non-literal-call-shape gap as a second disclosed residual in the test's own header comment (mirroring how the file-identity residual is already disclosed) -- or (b) broaden `REGISTRANT_CALL` to also catch a bare-identifier/call-expression argument. (a) is the minimal fix and keeps the instrument's own honesty bar consistent with the rest of this codebase's disclosed-residual convention.

## Single next action

File the GitHub Issue for finding 1 (below) and post a comment on Issue #339 noting R2-21 narrows but does not fully close the "no test notices" gap it names, so the Manager can decide whether #339 closes on this PR's merge or stays open pending the condition above.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [ISSUE][MED][demonstrated] src/policy/config/rule-reachability.test.ts:611 -- REGISTRANT_CALL regex only matches an inline-object-literal argument; registerNormalizer(makeEntry()) (demonstrated via scratch file, real test run) is a silent false negative, overstating the PR's "spans every registrant" claim -- fix: broaden the regex or add the gap as a second disclosed residual + soften the commit/CHANGELOG claim.
2. [CLEAN][code-traced] src/policy/config/rule-reachability.test.ts:617-619 -- disclosed file-identity-keying residual (second call inside an existing file invisible) verified accurate as stated.
3. [ISSUE][LOW][code-traced] src/policy/config/rule-reachability.test.ts:589 -- walkProduction only matches .ts/.mjs/.js; a future .mts/.cts registrant or test file would be invisible to the scan/exclusion; no such file exists today (assumption-capped).
4. [CLEAN][code-traced] src/policy/config/rule-reachability.test.ts:600-604 -- registry.ts exclusion is exact-relative-path, not basename; two other files named registry.ts (qa fixtures) are correctly still scanned, no accidental exclusion possible.
5. [CLEAN][demonstrated] src/policy/config/rule-reachability.test.ts:660-679 -- part 2 self-test is not vacuous; asserts the named fourth file specifically, controls mirror real in-tree prose-mention shapes.
6. [CLEAN][code-traced] whole diff -- no injection/secrets/dependency/access-control exposure; test-only fs read of the repo's own tree, no new dependency, no untrusted input.
counts: issues=2 suspicions=0 clean=4
evidence: demonstrated=2 code-traced=4 derived=0
checks="18/0/0|n/a"
adr=HIT(2)
report=docs/reviews/s339-registrant-drift-instrument-app-security-2026-09-28.md
