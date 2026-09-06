import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, registerNormalizer, resolveNormalizer } from "./registry.ts";
// Side-effect imports: each normalizer registers itself on load. This file never reaches into
// either module beyond that — registry.ts itself imports neither.
import "./shell.ts";
import "./structured-cluster.ts";
import { decide } from "../kernel/kernel.ts";
import type { WorldFacts } from "../kernel/kernel.ts";
import { mergeLayers } from "../rule/precedence.ts";
import { centralLayer, projectLayer, shippedDefaultsLayer } from "../fixtures/rules.ts";
import {
  shellChainedReadThenMutateCall,
  shellCommandSubstitutionCall,
  shellDirectoryFlagAliasCollisionCall,
  shellDirectoryFlagLongCall,
  shellEquivalentDeleteCall,
  shellMultiResourceCall,
  shellMultiTargetResourcePlusRedirectCall,
  shellNewlineChainedCall,
  shellOverLongResourceTokenCall,
  shellUnrecognizedVerbCall,
  shellUnterminatedSingleQuoteCall,
  structuredClusterDelimiterInjectionCall,
  structuredClusterDeleteCall,
  structuredClusterUnrecognizedVerbCall,
} from "../fixtures/normalizer-calls.ts";

// --- registerNormalizer / resolveNormalizer -------------------------------

test("resolveNormalizer: 'cluster' and 'shell' are both registered by their own modules' import side effects", () => {
  assert.equal(resolveNormalizer("cluster")?.toolType, "cluster");
  assert.equal(resolveNormalizer("shell")?.toolType, "shell");
});

test(
  "registerNormalizer (POL-12): a THIRD normalizer registers with zero import of anything beyond " +
    "the public registerNormalizer/resolveNormalizer functions — no edit to registry.ts or either " +
    "prior normalizer file was needed to add it",
  () => {
    registerNormalizer({
      toolType: "fixture-third-normalizer",
      normalize: () => ({
        source: "structured",
        verbs: ["read"],
        targets: ["fixture/target"],
        environment: "dev",
        identity: "agent:test",
        deferred: false,
        unresolved: [],
      }),
    });
    const entry = resolveNormalizer("fixture-third-normalizer");
    assert.ok(entry);
    assert.equal(entry?.normalize(undefined).verbs[0], "read");
  },
);

// --- normalize(): unrecognized toolType (registry's own fail-closed default) ----------

test("normalize: an unrecognized toolType produces an opaque record, never silently dropped or allowed", () => {
  const record = normalize("no-such-tool", { environment: "prod", identity: "agent:x" });
  assert.equal(record.source, "opaque");
  assert.match(record.unresolved[0] ?? "", /no-such-tool/);
  assert.equal(record.environment, "prod");
  assert.equal(record.identity, "agent:x");
});

test("normalize: an unrecognized toolType with non-record raw input still returns a safe opaque record", () => {
  const record = normalize("no-such-tool", "not-an-object");
  assert.equal(record.source, "opaque");
  assert.equal(record.environment, "unknown");
  assert.equal(record.identity, "unknown");
});

// --- POL-04 / SUR-01: parity + real kernel integration ---------------------

function worldFacts(): WorldFacts {
  const merged = mergeLayers(shippedDefaultsLayer, centralLayer, projectLayer);
  return { rules: merged, defaultOutcome: "allow" };
}

test("POL-04: structured cluster-mutation call and its shell-equivalent normalize to the SAME target string and verbs", () => {
  const structured = normalize("cluster", structuredClusterDeleteCall);
  const shell = normalize("shell", shellEquivalentDeleteCall);
  assert.deepEqual(structured.targets, shell.targets);
  assert.deepEqual(structured.verbs, shell.verbs);
  assert.equal(structured.environment, shell.environment);
});

test("POL-04 + SUR-01: structured cluster-mutation call and its shell-equivalent, run through registry -> kernel, yield the SAME verdict", () => {
  const structuredRecord = normalize("cluster", structuredClusterDeleteCall);
  const shellRecord = normalize("shell", shellEquivalentDeleteCall);

  const structuredVerdict = decide(worldFacts(), structuredRecord);
  const shellVerdict = decide(worldFacts(), shellRecord);

  assert.equal(structuredVerdict.outcome, shellVerdict.outcome);
  assert.equal(structuredVerdict.ruleId, shellVerdict.ruleId);
  // Pinned: this fixture pair matches S2's own CONFLICTING_RULE_ID case (rules.ts) — project
  // layer's deny wins the three-layer conflict.
  assert.equal(structuredVerdict.outcome, "deny");
  assert.equal(structuredVerdict.ruleId, "protect-prod-delete");
});

test("SUR-01: a structured cloud/cluster call reaches the kernel and receives a real verdict (not skipped)", () => {
  const record = normalize("cluster", structuredClusterDeleteCall);
  const verdict = decide(worldFacts(), record);
  assert.ok(verdict, "kernel must return a Verdict, not undefined/skip");
  assert.ok(verdict.outcome === "allow" || verdict.outcome === "deny");
});

// --- Criterion 6 (ADR-0021 §3.2 / SUR-02): unrecognized verb -> unresolved, never silently allowed

test("shell normalizer, via the registry: a verb outside the action catalog produces unresolved, not a silently-passed verb string", () => {
  const record = normalize("shell", shellUnrecognizedVerbCall);
  assert.deepEqual(record.verbs, []);
  assert.ok(record.unresolved.length > 0);
});

test("structured normalizer, via the registry: a verb outside the action catalog produces unresolved, not a silently-passed verb string", () => {
  const record = normalize("cluster", structuredClusterUnrecognizedVerbCall);
  assert.deepEqual(record.verbs, []);
  assert.ok(record.unresolved.length > 0);
});

test("criterion 6, end to end: an unrecognized-verb call is DENIED by the kernel via POL-05's unresolved path, never silently allowed", () => {
  const record = normalize("cluster", structuredClusterUnrecognizedVerbCall);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

test("criterion 6, shell side, end to end: same unrecognized-verb outcome through the shell normalizer", () => {
  const record = normalize("shell", shellUnrecognizedVerbCall);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

// --- Issue #65/#66 fix-now regression, end to end through the real registry -> kernel chain ----

test("Issue #65 regression, end to end: an over-long, smuggled-segment resource token is DENIED via POL-05's unresolved path, never silently allowed with a truncated target", () => {
  const record = normalize("shell", shellOverLongResourceTokenCall);
  assert.deepEqual(record.targets, []);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

test("Issue #66 regression, end to end: a delimiter-injected resourceName is DENIED via POL-05's unresolved path, never silently allowed with a spoofed target", () => {
  const record = normalize("cluster", structuredClusterDelimiterInjectionCall);
  assert.deepEqual(record.targets, []);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

// --- S4 (Milestone #22): SUR-06/09 end to end through the real registry -> kernel chain --------

test("SUR-06a, end to end: a chained read-then-mutate shell call is DENIED by the kernel via POL-05's unresolved path, not silently allowed", () => {
  const record = normalize("shell", shellChainedReadThenMutateCall);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

test("design-challenger Finding #1, end to end: command substitution is DENIED by the kernel via POL-05, not silently allowed as a clean pod-delete", () => {
  const record = normalize("shell", shellCommandSubstitutionCall);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

test("design-challenger Finding #2, end to end: a directory flag's presence is DENIED by the kernel via POL-05, not silently allowed while invisible in the record", () => {
  const record = normalize("shell", shellDirectoryFlagLongCall);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

// --- S4 Stage-3 review fix-now round, end to end through the real registry -> kernel chain -----

test("app-security Finding 1 (Issue #68), end to end: an unterminated quote is DENIED by the kernel via POL-05, not silently allowed as a clean pod-get", () => {
  const record = normalize("shell", shellUnterminatedSingleQuoteCall);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

test("red-team Finding 1 (Issue #70), end to end: a newline-separated read-then-mutate call is DENIED by the kernel via POL-05, not silently allowed as a clean get-only", () => {
  const record = normalize("shell", shellNewlineChainedCall);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

test("red-team Finding 3 (Issue #72), end to end: '-C=<v>' is DENIED by the kernel via POL-05, not silently allowed as if it supplied --context", () => {
  const record = normalize("shell", shellDirectoryFlagAliasCollisionCall);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

test("Issue #82 (round 3, council-approved path), end to end: a multi-resource delete is DENIED by the kernel via POL-05, never reaching a multi-target ActionRecord kernel.ts's matchesTarget was never audited against", () => {
  const record = normalize("shell", shellMultiResourceCall);
  assert.deepEqual(record.targets, []);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});

test("Issue #82, impact-analyst's compound PoC, end to end: a rule scoped only to 'pods/' must NOT authorize an unrelated redirect target bundled into the same call — the kernel never receives the multi-target record that would let it", () => {
  const record = normalize("shell", shellMultiTargetResourcePlusRedirectCall);
  assert.deepEqual(record.targets, []);
  const verdict = decide(worldFacts(), record);
  assert.equal(verdict.outcome, "deny");
  assert.equal(verdict.ruleId, "POL-05");
});
