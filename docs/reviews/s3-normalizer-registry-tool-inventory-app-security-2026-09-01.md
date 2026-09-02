# S3 -- Normalizer registry + tool inventory -- Application Security Review

**Scope:** Milestone #21 (POL-04, POL-12, SUR-01, SUR-03, SUR-04), built on shipped S2 (5d60a38).
**Reviewer:** app-security-reviewer (Horus)
**Date:** 2026-09-01
**Tier:** STANDARD (per CLAUDE.md Risk Tier Definitions; ratified in docs/decisions.md)

Diff reviewed (uncommitted working tree, git status --short re-derived, not trusted from the dispatch prompt):
- New: src/policy/normalizer/{action-catalog,registry,target-format,shell,structured-cluster}.ts (+ .test.ts each)
- New: src/policy/tools/classification.ts (+ .test.ts)
- New: src/policy/verification/allowlist.ts (+ .test.ts)
- New: src/policy/fixtures/{normalizer-calls,tool-classification,allowlist-settings}.ts
- New: src/qa/normalizer-registry-purity-check.ts (+ .test.ts, src/qa/selftest-fixture/normalizer-registry-purity/{clean,violating}/*.ts)
- Modified: src/policy/rule/precedence.ts (+.test.ts), package.json, .github/workflows/ci.yml, CHANGELOG.md, docs/backlog.md, docs/decisions.md, docs/run-log.jsonl

## ADR compliance

node docs/adr-cache.mjs --ensure -> "ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]"

Applicable ADR for this domain (authn/authz, input handling, secrets, dependencies, data exposure), read from the catalog: **ADR-0021** (applicableTo: architecture, security, code, data -- status accepted). ADRs 0016/0018/0019/0020 (the AGT/wrap lineage) are scoped as inapplicable to this build per docs/decisions.md's 2026-08-29 row, so their Rules for agents are not binding here. ADR-0021's Rules for agents relevant to this diff:
- MUST deny a mutating action whose Action record has source: opaque or a non-empty unresolved field (POL-05) -- kernel-side, re-verified this pass.
- MUST register each per-tool-type normalizer on the registry by declaration; MUST NOT add a tool type by editing a shared dispatch chain or the kernel (POL-12).
- MUST NOT let a normalizer return a verdict, or let the kernel inspect a tool's identity directly.
- MUST NOT introduce agent-governance-sdk / agent-governance-claude-code / equivalent without a new recorded decision.

**No ADR-0021 Rules-for-agents MUST line is violated by this diff.** The findings below are real code defects against the file's own stated promises and the SUR-02 "terminal fall-through is deny" spirit, not against a literal ADR MUST -- same distinction this reviewer's S2 report drew for Issue #62, and calibrated the same way here (see below).

## What this story deliberately does not build (confirmed respected, not re-litigated)

Verified directly, not taken on the header comments' word:
- No live session-tool introspection or hook wiring -- evaluateToolInventory() takes sessionTools: readonly string[] as a plain argument; no fs/process/network import anywhere in src/policy/tools/classification.ts.
- No real deployed-settings-file read -- verifyAllowlistInForce(settings: unknown) takes settings content as an argument; no fs import in src/policy/verification/allowlist.ts.
- No real central-policy-config loading -- mergeToolClassificationLayers() takes in-memory ToolClassificationSet-shaped layers as arguments; no I/O.
- grep -rn "agent-governance" across every new file in this diff: zero matches.
- package.json diff is a one-line new npm script entry only (qa:normalizer-registry-purity) -- no new dependency, dev or prod.

## Findings

### 1. [ISSUE][MED][demonstrated] src/policy/normalizer/shell.ts:44-55 -- resource token with >2 "/"-segments silently truncates instead of reporting unresolved

The file's own header comment promises: "Anything it cannot confidently parse against that shape is reported via unresolved, never guessed at or silently dropped." The documented shape is exactly two segments: <resourceType>/<resourceName>.

```
const resourceToken = tokens[2];
let resourceType: string | undefined;
let resourceName: string | undefined;
if (resourceToken?.includes("/")) {
  const [rt, rn] = resourceToken.split("/");   // extra segments silently discarded
  if (rt && rn) {
    resourceType = rt;
    resourceName = rn;
  }
}
if (!resourceType || !resourceName) unresolved.push(`command resource "${resourceToken ?? ""}"`);
```

const [rt, rn] = arr in JS silently ignores any array elements beyond the first two -- no length check. Demonstrated against the shipped module (not a reconstruction):

```
$ node --experimental-strip-types -e "
import('./src/policy/normalizer/action-catalog.ts').then(async () => {
  const { normalizeShellCall } = await import('./src/policy/normalizer/shell.ts');
  const r = normalizeShellCall({
    command: 'kubectl delete secrets/db-password/extra-smuggled-segment --context=prod',
    environment: 'prod', identity: 'agent-session-1',
  });
  console.log(JSON.stringify(r, null, 2));
});"
{
  "source": "parsed",
  "verbs": ["delete"],
  "targets": ["prod/cluster/prod/secrets/db-password"],
  "environment": "prod", "identity": "agent-session-1", "deferred": false,
  "unresolved": []
}
```

secrets/db-password/extra-smuggled-segment -- a token that does not match the documented two-segment shape -- silently resolves to resourceName: "db-password", and the record is reported fully resolved (unresolved: [], source: "parsed"). POL-05's fail-closed gate never fires on this record: source is not "opaque", unresolved is empty. The normalizer's own ambiguity-detection promise is violated for exactly the malformed-input class its header comment claims to cover -- this is not a request to build SUR-06/07/08's semantic depth (flag reordering, quoting, abbreviations, which are correctly out of scope), it is the documented fixed shape this story does claim to implement failing to detect its own malformation.

Not caught by the existing test suite: shellMalformedCall (the one "malformed" fixture, src/policy/fixtures/normalizer-calls.ts:49-53) only tests a missing resource token ("kubectl delete"), never an over-long one. Re-derived directly from source per the review brief's instruction, not taken on the test suite's own "reports EVERY unresolvable facet" claim (shell.test.ts:30) -- that claim is true for the cases the suite actually exercises, and false for this one.

**Why MED, not HIGH:** grep -rn "normalizeShellCall|resolveNormalizer|normalize(" src confirms zero production call sites outside tests and the QA purity-check -- current exposure is 0%, measured. This does not violate an ADR-0021 Rules-for-agents MUST line as literally written (POL-05 is scoped to what the Action record actually reports; the defect is upstream of that record being produced correctly). Same calibration this reviewer applied to S2's Issue #62 (docs/reviews/s2-canonical-action-record-kernel-app-security-2026-09-01.md): a real, demonstrated fail-closed-promise violation with zero live exposure today lands at MED, not HIGH, and should close before S4 (CRITICAL tier, "historically highest-incident component") starts feeding real untrusted shell text through this exact function.

**Minimal fix:** after resourceToken.split("/"), require the split to produce exactly 2 non-empty parts; if it produces more (or fewer), treat it the same as today's "no resource token" case -- push to unresolved and leave resourceType/resourceName undefined -- rather than accepting the first two and discarding the rest.

Exposure: ~0% of runs, basis: measured (grep confirms no production caller of normalizeShellCall/normalize() outside tests/QA today; this diff has no live wiring).

### 2. [ISSUE][MED][demonstrated] src/policy/normalizer/target-format.ts:19-21 -- buildClusterTarget performs zero delimiter validation on typed field values, enabling exact-match deny-rule bypass by padding a field with the target format's own "/" separator

Shared by both normalizers (shell.ts:63, structured-cluster.ts:24-31):

```
export function buildClusterTarget(parts: ClusterTargetParts): string {
  return `${parts.environment}/cluster/${parts.cluster}/${parts.resourceType}/${parts.resourceName}`;
}
```

Even though ClusterTargetParts' fields are typed (string), nothing validates that an individual field's value is free of the same "/" delimiter the format uses to join fields -- so a caller-supplied resourceName (or any other part) containing "/" silently produces a target string with an extra path segment, indistinguishable in shape from a different, more deeply-nested resource. matchesTarget() (src/policy/kernel/kernel.ts:121-127) supports exact-match rules (t === pattern, when the configured pattern has no trailing /) precisely for this kind of specific-resource deny. Demonstrated against the shipped module:

```
$ node --experimental-strip-types -e "
const { buildClusterTarget } = await import('./src/policy/normalizer/target-format.ts');
const { normalizeStructuredClusterCall } = await import('./src/policy/normalizer/structured-cluster.ts');
const intendedDenyTarget = buildClusterTarget({ environment: 'prod', cluster: 'prod-cluster', resourceType: 'secrets', resourceName: 'root-password' });
console.log('intended deny target:', intendedDenyTarget);
const record = normalizeStructuredClusterCall({
  verb: 'delete', resourceType: 'secrets', resourceName: 'root-password/x',
  cluster: 'prod-cluster', environment: 'prod', identity: 'agent-session-1',
});
console.log('actual record.targets:', record.targets);
console.log('matches intended deny target exactly?', record.targets[0] === intendedDenyTarget);
"
intended deny target: prod/cluster/prod-cluster/secrets/root-password
actual record.targets: [ 'prod/cluster/prod-cluster/secrets/root-password/x' ]
matches intended deny target exactly? false
```

A call whose resourceName is padded with an embedded "/" produces a fully resolved record (source: "structured", unresolved: []) whose target string no longer exact-matches an exact-match deny rule keyed on the canonical resource name -- the record does not go through POL-05's fail-closed path at all (it is not ambiguous by the normalizer's own accounting), yet it silently diverges from the string a policy author would have written a deny rule against. Prefix-style deny rules (pattern ending in /) are unaffected (startsWith still holds against a longer string), but an exact-match deny rule is bypassable this way. This is the same root cause as Finding #1 in a different code path: a typed field is trusted to be "clean" (delimiter-free) with no check, and the check that would catch it (unresolved) is never consulted because the field parses "successfully" as a string.

**Why MED, not HIGH:** same 0% measured exposure as Finding #1 (no live wiring; structured-cluster.ts/target-format.ts have no production callers outside tests today) and no literal ADR-0021 MUST line is violated (POL-04 requires a canonical Action record shape, which this technically produces -- the defect is in the content of one field, not the record's shape). Flagging now, before S4/S5 feed real (tool-call-argument-sourced) resourceName values through structured-cluster.ts, per the review brief's explicit ask.

**Minimal fix:** in buildClusterTarget (or immediately before calling it, in both normalizers), reject/flag any part containing the target format's own delimiter character ("/") -- either by having buildClusterTarget return undefined/throw and have both call sites push to unresolved when it does, or by validating the four parts up front in each normalizer the same way the shell normalizer already validates its parsed tokens.

Exposure: ~0% of runs, basis: measured (no production caller of buildClusterTarget/normalizeStructuredClusterCall outside tests today).

### 3. [SUSPICION][LOW][code-traced] src/qa/normalizer-registry-purity-check.ts:35-52 -- sibling-import detection only catches same-directory imports, not a nested-subdirectory dispatch import

```
const resolvedDir = posix.dirname(resolved);
if (resolvedDir === dir) {           // exact-directory match only
  violations.push({ kind: "sibling-normalizer-import", ... });
}
```

The check flags a relative import that resolves to a file directly inside registry.ts's own directory. If a future normalizer were placed one level deeper (e.g. src/policy/normalizer/adapters/shell.ts) and registry.ts imported it via ./adapters/shell.ts, resolvedDir would be src/policy/normalizer/adapters, not src/policy/normalizer -- the exact same POL-12 violation (registry reaching for a concrete normalizer) would go undetected. Confirmed non-vacuous and correct against the current file layout (all normalizers live flat in src/policy/normalizer/, proven via the clean/violating self-test fixtures and against the real registry.ts -- all 4 tests pass), so this is not a false pass today; it is a real narrowing of the guarantee the file's own header comment claims ("A registry satisfying both, by construction, can never require editing when a new normalizer is added").

**Non-blocking:** current registry.ts has zero sibling imports of any kind (verified by direct read), and nothing in this diff introduces a nested-directory normalizer layout. Worth widening (check "resolved path is anywhere under dir", not "resolved directory equals dir") the next time this file is touched, so the instrument's guarantee doesn't quietly narrow if the normalizer directory ever grows subdirectories.

## Clean, verified (not taken on the test suite's own word)

- **[CLEAN][demonstrated] src/policy/tools/classification.ts evaluateToolInventory()** -- fail-closed by construction: haltRequired = unclassified.length > 0, no code path defaults an unrecognized tool name to any implicit class. Re-derived directly from source (classification.ts:63-81); 6/6 tests pass, including the empty-catalog-halts-on-everything and multiple-unclassified-tools-all-reported cases.
- **[CLEAN][demonstrated] src/policy/verification/allowlist.ts verifyAllowlistInForce()** -- fails closed on non-object input (null, undefined, string, number, array all return compliant: false), correctly distinguishes both SUR-04-named compliant routes (exclusive-flag-with-populated-list vs. deployed-managed-config) from every non-compliant shape including the exclusive flag set with an empty/malformed list. Re-derived from source (allowlist.ts:39-73); 7/7 tests pass.
- **[CLEAN][demonstrated] Registry -> kernel opaque/unresolved fail-closed chain (SUR-02/POL-05, the Issue #62-shaped check this review was specifically asked to re-derive)** -- normalize() (registry.ts:61-75) produces an opaque record for any unrecognized toolType, unconditionally, by construction (no normalizer opts in or out of this default). resolveVerb() (action-catalog.ts:42-45) returns undefined for any verb outside KNOWN_VERBS; both shell.ts and structured-cluster.ts push to unresolved when it does, never emitting an unrecognized verb string into verbs. Independently reproduced end to end (not taken on registry.test.ts's own assertions): an unrecognized toolType and an unrecognized verb both resolve to decide() returning deny/POL-05 through the real kernel, for both normalizers. 13/13 relevant tests pass (registry.test.ts, shell.test.ts, structured-cluster.test.ts, classification.test.ts combined for the fail-closed-shaped subset).
- **[CLEAN][code-traced] No forbidden dependency** -- git diff package.json is a single new npm-script line (qa:normalizer-registry-purity), no dependencies/devDependencies change; grep -rn "agent-governance" across every new/changed file in this diff returns zero matches. ADR-0021's binding prohibition respected.
- **[CLEAN][code-traced] No secrets in fixtures** -- src/policy/fixtures/{normalizer-calls,tool-classification,allowlist-settings}.ts read in full; all values are synthetic ("prod-cluster", "agent:story-implementer", ["github", "filesystem"], no real hostnames/tokens/credentials).
- **[CLEAN][demonstrated] normalizer-registry-purity-check.ts is non-vacuous** -- proven against both the clean/violating self-test fixtures (correctly passes the clean one, correctly names both violation classes in the violating one) and, non-vacuously, against the real src/policy/normalizer/registry.ts (zero violations, correctly -- confirmed by direct read that registry.ts imports no sibling file and contains no switch). Wired into .github/workflows/ci.yml's main ci job (diff confirmed) and package.json's qa:normalizer-registry-purity script.

## Checks run (raw)

```
$ npm test
...
tests 236
suites 0
pass 236
fail 0
cancelled 0
skipped 0
todo 0

$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(clean, no output)

$ npm run lint
> eslint .
(clean, no output)

$ grep -rn "agent-governance" <every new/changed file in this diff>
(no matches, exit 1)
```

Plus the two standalone repro scripts quoted in Findings #1 and #2 above, run directly against the shipped .ts modules via node --experimental-strip-types.

## Verdict

**APPROVE-WITH-CONDITIONS.** No ADR-0021 Rules-for-agents MUST line is violated; the registry-level and kernel-level fail-closed guarantees (SUR-02, POL-05) are correctly implemented and independently re-verified, not just trusted from the test suite. Two MED, demonstrated findings -- both real violations of the normalizer's own stated promise to report ambiguity rather than silently resolve it, both currently at 0% measured exposure (no live wiring exists yet in this story's ratified scope), both in the exact code shape S4 (CRITICAL tier) will next build directly on top of. Conditions:

1. Fix Finding #1 (shell.ts resource-token segment-count check) before or as part of S4's first PR that extends shell.ts's parsing depth.
2. Fix Finding #2 (target-format.ts delimiter validation) before or as part of S4/S5's first PR that feeds a non-fixture resourceName/cluster/resourceType value through structured-cluster.ts or buildClusterTarget.
3. Finding #3 (purity-check subdirectory gap) is hardening, not a condition -- track on docs/backlog.md next time normalizer-registry-purity-check.ts is touched.

Both conditions are cheap (a length/delimiter check each), well-contained, and do not require a design change -- they tighten the existing "report ambiguity, never guess" contract to actually hold for the two demonstrated cases above.

## Single next action

Before S4 (Milestone #22, shell-command semantic depth, CRITICAL tier) begins: file and fix-now Findings #1 and #2 (both are a few lines each), then re-run npm test to confirm the two new boundary cases are pinned as named regression tests, not just fixed silently.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by exploitability x impact):
1. [ISSUE][MED][demonstrated] src/policy/normalizer/shell.ts:44-55 -- resourceToken with >2 "/" segments silently truncates to the first two instead of reporting unresolved, contradicting the file's own "never guessed at or silently dropped" promise; fix: require exactly 2 non-empty split parts, else unresolved. Exposure: ~0% of runs, basis: measured (grep confirms zero production callers today).
2. [ISSUE][MED][demonstrated] src/policy/normalizer/target-format.ts:19-21 (shared by shell.ts:63, structured-cluster.ts:24-31) -- buildClusterTarget joins typed field values with "/" with no delimiter validation, letting a field value containing "/" silently bypass an exact-match deny rule while the record reports itself fully resolved; fix: validate no part contains "/" before building, else caller marks unresolved. Exposure: ~0% of runs, basis: measured (grep confirms zero production callers today).
3. [SUSPICION][LOW][code-traced] src/qa/normalizer-registry-purity-check.ts:35-52 -- sibling-import detection only catches same-directory imports (resolvedDir === dir), missing a nested-subdirectory dispatch import that would be the same POL-12 violation; correct and non-vacuous against today's flat file layout, worth widening before the normalizer directory grows subdirectories.
4. [CLEAN][demonstrated] src/policy/tools/classification.ts:63-81 evaluateToolInventory -- fail-closed halt on any unclassified tool, re-derived from source, 6/6 tests pass.
5. [CLEAN][demonstrated] src/policy/verification/allowlist.ts:39-73 verifyAllowlistInForce -- fails closed on non-object/null/array/malformed input, correctly distinguishes both SUR-04 compliant routes, 7/7 tests pass.
6. [CLEAN][demonstrated] src/policy/normalizer/registry.ts:61-75 normalize() + src/policy/kernel/kernel.ts pol05Rule/isMutating -- end-to-end opaque/unresolved fail-closed chain independently reproduced (not taken on test suite's word), 13/13 relevant tests pass.
7. [CLEAN][code-traced] package.json diff is script-entry only, zero "agent-governance" matches across the whole diff -- ADR-0021's dependency prohibition respected.
8. [CLEAN][code-traced] src/policy/fixtures/{normalizer-calls,tool-classification,allowlist-settings}.ts -- no secrets/credentials/real hostnames, all synthetic.
9. [CLEAN][demonstrated] src/qa/normalizer-registry-purity-check.ts -- non-vacuous against clean/violating self-test fixtures AND the real registry.ts, wired into CI.
counts (checksum): issues=2 suspicions=1 clean=6
evidence (checksum): demonstrated=6 code-traced=3 derived=0
checks="236/0/0 (npm test) | typecheck clean | lint clean"
adr=HIT(35)
report=docs/reviews/s3-normalizer-registry-tool-inventory-app-security-2026-09-01.md

---

## Re-confirm pass -- 2026-09-01 (post fix-now for Issue #65, Issue #66)

story-implementer reported both MED findings fixed and claimed to have independently re-run this reviewer's exact PoCs. Per this project's own precedent (S2's Issue #62 re-confirm caught a comment-only "fix" by re-running the PoC directly rather than trusting the claim), I re-ran both PoCs myself against the live code, read the actual diff (not just the claim), and spot-checked for regression.

### Finding #1 (Issue #65) -- independently reproduced, genuinely CLOSED

src/policy/normalizer/shell.ts:52-62 now requires the "/" split to produce exactly 2 non-empty segments; anything else (0, 1, or 3+) is pushed to unresolved, identical treatment to the pre-existing "no resource token" case. Re-ran my exact original PoC against the live module:

```
$ node --experimental-strip-types -e "
import('./src/policy/normalizer/action-catalog.ts').then(async () => {
  const { normalizeShellCall } = await import('./src/policy/normalizer/shell.ts');
  const r = normalizeShellCall({
    command: 'kubectl delete secrets/db-password/extra-smuggled-segment --context=prod',
    environment: 'prod', identity: 'agent-session-1',
  });
  console.log(JSON.stringify(r, null, 2));
});"
{
  "source": "parsed",
  "verbs": ["delete"],
  "targets": [],
  "environment": "prod", "identity": "agent-session-1", "deferred": false,
  "unresolved": ["command resource \"secrets/db-password/extra-smuggled-segment\""]
}
```

targets is now empty and unresolved names the exact malformed token -- the previously-silent truncation is gone. Since verbs still contains the mutating verb "delete" AND unresolved is now non-empty, this record is denied by POL-05 end to end (re-verified the POL-05 gate logic itself is unchanged in kernel.ts -- the fix is entirely upstream, in the normalizer). Two new named regression tests exist (shell.test.ts:52, :63 -- "Issue #65 regression": a 3-segment token, and a boundary check that a 1-segment token is still unresolved unchanged) -- read directly, they are real executing assertions against normalizeShellCall, not comment-only. Genuinely closed.

### Finding #2 (Issue #66) -- independently reproduced, genuinely CLOSED

src/policy/normalizer/target-format.ts:31-35 now validates all four parts for the delimiter character and returns undefined on contamination; both call sites (shell.ts:72-80, and structured-cluster.ts, confirmed by read) treat undefined as an unresolved facet rather than falling back to an empty-but-unmarked targets array. Re-ran my exact original PoC against the live module:

```
$ node --experimental-strip-types -e "
const { buildClusterTarget } = await import('./src/policy/normalizer/target-format.ts');
const { normalizeStructuredClusterCall } = await import('./src/policy/normalizer/structured-cluster.ts');
const intendedDenyTarget = buildClusterTarget({ environment: 'prod', cluster: 'prod-cluster', resourceType: 'secrets', resourceName: 'root-password' });
console.log('intended deny target:', intendedDenyTarget);
const record = normalizeStructuredClusterCall({
  verb: 'delete', resourceType: 'secrets', resourceName: 'root-password/x',
  cluster: 'prod-cluster', environment: 'prod', identity: 'agent-session-1',
});
console.log('actual record:', JSON.stringify(record, null, 2));
console.log('matches intended deny target exactly?', record.targets[0] === intendedDenyTarget);
"
intended deny target: prod/cluster/prod-cluster/secrets/root-password
actual record: {
  "source": "structured",
  "verbs": ["delete"],
  "targets": [],
  "environment": "prod", "identity": "agent-session-1", "deferred": false,
  "unresolved": ["target field(s) contain the delimiter character \"/\""]
}
matches intended deny target exactly? false
```

targets is now empty and unresolved names the contamination -- no spoofed target string reaches the kernel. Mutating verb + non-empty unresolved denies via POL-05, same chain as Finding #1. target-format.test.ts (new, 33 lines) and structured-cluster.test.ts:50-68 ("Issue #66 regression") exist as real, executing assertions, read directly. Note the differential regression test at structured-cluster.test.ts:62 specifically pins that the CANONICAL (non-injected) resourceName still resolves cleanly to the exact target an exact-match deny rule would be written against -- the fix does not overcorrect into denying legitimate calls. Genuinely closed.

### Regression check

- npm test: 246/246 pass, 0 fail, 0 skipped (was 236 pre-fix; +10 net new tests, consistent with the regression tests named above plus target-format.test.ts).
- npm run typecheck: clean. npm run lint: clean.
- npm run qa:kernel-purity: PASS, 4 production files, non-vacuous (kernel.ts itself untouched by this fix-now pass -- confirmed, the fix is entirely in the normalizer layer).
- npm run qa:normalizer-registry-purity: PASS, non-vacuous (Finding #3's own subject file, normalizer-registry-purity-check.ts, was not touched by this fix-now pass -- Finding #3 stands unchanged, correctly left as non-blocking hardening, not part of this fix-now scope).
- Independently re-ran the happy-path parity PoC (well-formed shell + structured calls, single-segment fields) to confirm no false-positive regression: both still resolve cleanly (unresolved: []) with byte-identical target strings (prod/cluster/prod-cluster/pod/payment-worker), POL-04 parity intact.
- git diff package.json: unchanged from the original review (no new dependency introduced by the fix). grep -rn "agent-governance" across the three touched files: zero matches -- ADR-0021's dependency prohibition still respected.
- Spot-checked the 6 original CLEAN findings' subject files (classification.ts, allowlist.ts, registry.ts, kernel.ts, fixtures, CI/package.json wiring): none were touched by this fix-now pass except normalizer-calls.ts (two new fixture exports added for the regression tests, read directly -- synthetic data only, no secrets) -- no regression.

### Verdict: genuinely resolved. Issues #65 and #66 closed.

Both fixes are real behavior changes independently re-verified against the exact PoCs that found them, not documentation-only or narrower-than-the-actual-gap substitutes (the failure mode this project's own precedent, S2's Issue #62, specifically warned against). Closing both issues myself, same terms as story-implementer's own claim -- I independently agree, having re-run the PoCs directly rather than taking the claim on faith.

---

RECEIPT (re-confirm pass, 2026-09-01): verdict=APPROVE
findings (ranked by exploitability x impact):
1. [CLEAN][demonstrated] src/policy/normalizer/shell.ts:52-62 (Issue #65, CLOSED) -- independently reproduced the exact original PoC against the live fixed code: 3-segment resource token now reports unresolved, targets empty, denied end-to-end by POL-05; 2 new named regression tests confirmed real, no regression to the happy-path parity case.
2. [CLEAN][demonstrated] src/policy/normalizer/target-format.ts:31-35 (Issue #66, CLOSED) -- independently reproduced the exact original PoC against the live fixed code: delimiter-contaminated field now returns undefined, both call sites report unresolved, no spoofed target reaches the kernel; differential regression test confirms canonical calls still resolve cleanly.
3. [SUSPICION][LOW][code-traced] src/qa/normalizer-registry-purity-check.ts:35-52 -- unchanged from original pass, not in scope of this fix-now, still non-blocking hardening.
counts (checksum): issues=0 suspicions=1 clean=2
evidence (checksum): demonstrated=2 code-traced=1 derived=0
checks="246/0/0 (npm test, was 236 pre-fix) | typecheck clean | lint clean | qa:kernel-purity PASS non-vacuous | qa:normalizer-registry-purity PASS non-vacuous"
adr=HIT(35)
report=docs/reviews/s3-normalizer-registry-tool-inventory-app-security-2026-09-01.md
