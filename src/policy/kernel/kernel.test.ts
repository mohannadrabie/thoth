import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, isMutating, matchRules, pol05Rule } from "./kernel.ts";
import type { WorldFacts } from "./kernel.ts";
import type { ActionRecord } from "./action-record.ts";
import type { Rule, RuleSet } from "./rule-types.ts";
import {
  deferredMutatingCleanAction,
  deferredMutatingOpaqueAction,
  mutatingCleanAction,
  mutatingOpaqueAction,
  mutatingUnresolvedAction,
  nonMutatingOpaqueAction,
} from "../fixtures/action-records.ts";
import { mergeLayers } from "../rule/precedence.ts";
import { centralLayer, CONFLICTING_RULE_ID, projectLayer, shippedDefaultsLayer } from "../fixtures/rules.ts";

const emptyRules: RuleSet = { version: "0.0.0", rules: [] };

function factsWithDefault(outcome: "allow" | "deny", rules: RuleSet = emptyRules): WorldFacts {
  return { rules, defaultOutcome: outcome };
}

// --- isMutating ---------------------------------------------------------

test("isMutating: a mutating verb is detected", () => {
  assert.equal(isMutating(mutatingCleanAction), true);
});

test("isMutating: a non-mutating verb (read) is not mutating", () => {
  assert.equal(isMutating(nonMutatingOpaqueAction), false);
});

test("isMutating: every verb in MUTATING_VERBS is recognized individually", () => {
  for (const verb of ["write", "create", "modify", "delete", "move", "rename", "execute"]) {
    const action: ActionRecord = { ...mutatingCleanAction, verbs: [verb] };
    assert.equal(isMutating(action), true, `verb "${verb}" should be mutating`);
  }
});

test("isMutating: SUR-09 — deferred does not change mutating classification either way", () => {
  const immediate: ActionRecord = { ...mutatingCleanAction, deferred: false };
  const deferred: ActionRecord = { ...mutatingCleanAction, deferred: true };
  assert.equal(isMutating(immediate), isMutating(deferred));
  assert.equal(isMutating(deferred), true);
});

// --- pol05Rule -----------------------------------------------------------

test("pol05Rule: mutating + opaque source -> DENY", () => {
  const v = pol05Rule(mutatingOpaqueAction);
  assert.equal(v?.outcome, "deny");
  assert.equal(v?.ruleId, "POL-05");
  assert.match(v?.reason ?? "", /opaque/);
});

test("pol05Rule: mutating + unresolved fields -> DENY", () => {
  const v = pol05Rule(mutatingUnresolvedAction);
  assert.equal(v?.outcome, "deny");
  assert.equal(v?.ruleId, "POL-05");
  assert.match(v?.reason ?? "", /unresolved/);
});

test("pol05Rule: mutating + clean (resolved source, no unresolved fields) -> does not fire", () => {
  assert.equal(pol05Rule(mutatingCleanAction), null);
});

test("pol05Rule: non-mutating + opaque source -> does not fire (POL-05 scopes to mutating actions only)", () => {
  assert.equal(pol05Rule(nonMutatingOpaqueAction), null);
});

test("pol05Rule (SUR-09): a DEFERRED mutating+opaque action is denied identically to an immediate one", () => {
  const immediate = pol05Rule(mutatingOpaqueAction);
  const deferred = pol05Rule(deferredMutatingOpaqueAction);
  assert.equal(deferred?.outcome, "deny");
  assert.equal(deferred?.outcome, immediate?.outcome);
  assert.equal(deferred?.ruleId, immediate?.ruleId);
  assert.equal(deferred?.reason, immediate?.reason);
});

test("pol05Rule (SUR-09): a deferred, otherwise-clean mutating action is NOT auto-denied merely for being deferred", () => {
  assert.equal(pol05Rule(deferredMutatingCleanAction), null);
});

// --- Issue #62 regression: `unresolved` is the safety net for an unclassifiable verb ----------
//
// The first fix-now pass added a test here that kept "write" (an already-recognized mutating
// verb) alongside the unclassifiable one, which meant `isMutating`'s hardcoded verb-list check
// ALONE was sufficient to reach `pol05Rule`'s ambiguity check — the test passed for the wrong
// reason and never actually exercised the gap. app-security-reviewer re-ran the true PoC (a verb
// set with NO recognized mutating verb at all) directly against the kernel and confirmed it still
// resolved to `allow`. The real regression test below removes every recognized verb so the ONLY
// thing that can make `isMutating` return `true` is `unresolved` itself — see isMutating's Issue
// #62 HISTORY note in kernel.ts for the actual code fix this test pins.

test(
  "isMutating (Issue #62 regression, real fix): a record with verbs entirely OUTSIDE " +
    "MUTATING_VERBS is still mutating when `unresolved` is non-empty — ambiguity alone forces it",
  () => {
    // "patch" is not in MUTATING_VERBS (write/create/modify/delete/move/rename/execute), and it
    // is the ONLY verb present — no recognized mutating verb rides along to mask the gap the way
    // the original (misleading) Issue #62 test did.
    const action: ActionRecord = {
      ...mutatingCleanAction,
      verbs: ["patch"],
      unresolved: ["verbs[0]"],
    };
    assert.equal(isMutating(action), true);
  },
);

test(
  "isMutating: a record with verbs entirely OUTSIDE MUTATING_VERBS and an EMPTY `unresolved` " +
    "is NOT mutating — the closed-list behavior for a genuinely unflagged, unrecognized verb is " +
    "unchanged (that gap is deliberately deferred to ADR-0021 shape 3, see docs/backlog.md)",
  () => {
    const action: ActionRecord = {
      ...mutatingCleanAction,
      verbs: ["patch"],
      unresolved: [],
    };
    assert.equal(isMutating(action), false);
  },
);

test(
  "pol05Rule (Issue #62 regression, real fix): an action carrying ONLY a verb outside " +
    "MUTATING_VERBS, with a non-empty `unresolved`, is denied — proving the kernel-level PoC the " +
    "reviewer demonstrated (verbs: ['patch'], unresolved non-empty -> allow) no longer resolves " +
    "to allow",
  () => {
    const action: ActionRecord = {
      ...mutatingCleanAction,
      verbs: ["patch"],
      unresolved: ["verbs[0]"],
    };

    const v = pol05Rule(action);
    assert.equal(v?.outcome, "deny");
    assert.equal(v?.ruleId, "POL-05");
    assert.match(v?.reason ?? "", /unresolved/);
  },
);

test(
  "decide (Issue #62 regression, real fix, end-to-end): the exact PoC the reviewer ran directly " +
    "against decide() — verbs outside MUTATING_VERBS, non-empty unresolved, permissive default " +
    "outcome and empty rule set — now denies instead of falling through to `allow`",
  () => {
    const action: ActionRecord = {
      ...mutatingCleanAction,
      verbs: ["patch"],
      unresolved: ["verbs[0]"],
    };
    const facts = factsWithDefault("allow");
    const v = decide(facts, action);
    assert.equal(v.outcome, "deny");
    assert.equal(v.ruleId, "POL-05");
  },
);

// --- matchRules ------------------------------------------------------------

test("matchRules: a rule with no verbs/targets/environments matches any action", () => {
  const rule: Rule = { id: "catch-all", effect: "allow" };
  assert.deepEqual(matchRules([rule], mutatingCleanAction), [rule]);
});

test("matchRules: verb, target-prefix, and environment must all match", () => {
  const rule: Rule = {
    id: "prod-delete",
    effect: "deny",
    verbs: ["delete"],
    targets: ["prod/"],
    environments: ["prod"],
  };
  const matchingAction: ActionRecord = {
    ...mutatingCleanAction,
    verbs: ["delete"],
    targets: ["prod/db"],
    environment: "prod",
  };
  assert.deepEqual(matchRules([rule], matchingAction), [rule]);

  const wrongEnv: ActionRecord = { ...matchingAction, environment: "dev" };
  assert.deepEqual(matchRules([rule], wrongEnv), []);

  const wrongTarget: ActionRecord = { ...matchingAction, targets: ["staging/db"] };
  assert.deepEqual(matchRules([rule], wrongTarget), []);

  const wrongVerb: ActionRecord = { ...matchingAction, verbs: ["read"] };
  assert.deepEqual(matchRules([rule], wrongVerb), []);
});

test("matchRules: an exact (non-prefix) target pattern requires an exact match", () => {
  const rule: Rule = { id: "exact", effect: "deny", targets: ["/exact/path"] };
  const exact: ActionRecord = { ...mutatingCleanAction, targets: ["/exact/path"] };
  const notExact: ActionRecord = { ...mutatingCleanAction, targets: ["/exact/path/extra"] };
  assert.deepEqual(matchRules([rule], exact), [rule]);
  assert.deepEqual(matchRules([rule], notExact), []);
});

// --- decide (POL-01 data-driven decisions, wired end to end) ---------------

test("decide: POL-05 takes precedence over any configured rule", () => {
  const allowEverything: Rule = { id: "allow-all", effect: "allow" };
  const facts = factsWithDefault("deny", { version: "1.0.0", rules: [allowEverything] });
  const v = decide(facts, mutatingOpaqueAction);
  assert.equal(v.outcome, "deny");
  assert.equal(v.ruleId, "POL-05");
});

test("decide: a matching DENY rule denies, naming the rule id", () => {
  const rule: Rule = { id: "no-prod-delete", effect: "deny", verbs: ["delete"], targets: ["prod/"], environments: ["prod"] };
  const facts = factsWithDefault("allow", { version: "1.0.0", rules: [rule] });
  const action: ActionRecord = { ...mutatingCleanAction, verbs: ["delete"], targets: ["prod/db"], environment: "prod" };
  const v = decide(facts, action);
  assert.equal(v.outcome, "deny");
  assert.equal(v.ruleId, "no-prod-delete");
});

test("decide: a matching ALLOW rule allows, naming the rule id", () => {
  const rule: Rule = { id: "allow-dev-writes", effect: "allow", verbs: ["write"], environments: ["dev"] };
  const facts = factsWithDefault("deny", { version: "1.0.0", rules: [rule] });
  const v = decide(facts, mutatingCleanAction);
  assert.equal(v.outcome, "allow");
  assert.equal(v.ruleId, "allow-dev-writes");
});

test("decide: DENY wins over ALLOW when both match the same action", () => {
  const allow: Rule = { id: "allow-it", effect: "allow", verbs: ["write"] };
  const deny: Rule = { id: "deny-it", effect: "deny", verbs: ["write"] };
  const facts = factsWithDefault("allow", { version: "1.0.0", rules: [allow, deny] });
  const v = decide(facts, mutatingCleanAction);
  assert.equal(v.outcome, "deny");
  assert.equal(v.ruleId, "deny-it");
});

test("decide: no matching rule and no POL-05 -> falls back to worldFacts.defaultOutcome", () => {
  const denyFacts = factsWithDefault("deny");
  const allowFacts = factsWithDefault("allow");
  assert.equal(decide(denyFacts, mutatingCleanAction).outcome, "deny");
  assert.equal(decide(allowFacts, mutatingCleanAction).outcome, "allow");
});

test("decide (POL-01 proof): changing the configured rule set — not code — changes the verdict", () => {
  const facts1 = factsWithDefault("allow", { version: "1.0.0", rules: [] });
  const facts2 = factsWithDefault(
    "allow",
    { version: "1.0.0", rules: [{ id: "block-writes", effect: "deny", verbs: ["write"] }] },
  );
  assert.equal(decide(facts1, mutatingCleanAction).outcome, "allow");
  assert.equal(decide(facts2, mutatingCleanAction).outcome, "deny");
});

test("decide (POL-08 end-to-end, three-layer-conflict fixture): the merged project-layer verdict wins", () => {
  const merged = mergeLayers(shippedDefaultsLayer, centralLayer, projectLayer);
  const facts: WorldFacts = { rules: merged, defaultOutcome: "allow" };
  const action: ActionRecord = {
    ...mutatingCleanAction,
    verbs: ["delete"],
    targets: ["prod/database"],
    environment: "prod",
  };
  const v = decide(facts, action);
  assert.equal(v.outcome, "deny", "project layer's deny must win the three-layer conflict");
  assert.equal(v.ruleId, CONFLICTING_RULE_ID);
});
