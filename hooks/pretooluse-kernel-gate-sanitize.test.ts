// End-to-end proof for Issue #312 (AC-8): a hostile, policy-authored rule `rationale`/`id` reaches
// the REAL gate path (kernel -> decide-tool-call -> render-hook-output -> this hook's own stdout)
// and comes out stripped, not just a unit test on sanitizeForTerminal in isolation. Same registry-
// pinned copy-tree sandbox and strict outcome helpers as
// hooks/pretooluse-kernel-gate-classification.test.ts (see that file's header and
// hooks/test-support/gate-sandbox.ts for what the sandbox guarantees); this is a sibling file, not
// an addition to that story's own locked test list (gate-structure.test.ts's G19 STORY_TEST_FILES),
// since it belongs to a different story (#312).
//
// story-implementer's own test, written per the approved Phase 1 plan.
//
// NAMES: no committed fixture entry name is typed anywhere in this file (PC-11) — the server name
// comes from firstCommittedEntryName(), same as AC-H7 in the sibling classification test file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGateSandbox, denyReason, describeRun, firstCommittedEntryName, wasPolicyDenied, type GateRun } from "./test-support/gate-sandbox.ts";

const MARKER_REMOTE_MUTATING = "tool-class:remote-mutating";

function assertPolicyDenied(run: GateRun, what: string): void {
  assert.ok(wasPolicyDenied(run), `${what}: expected a strict policy DENY (exit 0 plus an explicit deny JSON with a reason; exit 2 or a crash does not count); got ${describeRun(run)}`);
}

// Same oracle shape as echo-sanitize.test.ts's HOSTILE/HOSTILE_VISIBLE and
// src/policy/gate/render-hook-output.test.ts's own copy (each test file owns its own fixture
// constants rather than importing another file's .test.ts, per this repo's convention).
const FORGED = "REJECTED-LOOKALIKE";
const HOSTILE = `\u001b[31m\n${FORGED}: forged line\u2028second\u0085third\rfourth\u0000\u007f\u009b[2J`;
const HOSTILE_VISIBLE = `[31m${FORGED}: forged linesecondthirdfourth[2J`;

interface TestRule {
  id: string;
  effect: "allow" | "deny";
  verbs?: string[];
  targets?: string[];
  rationale?: string;
}
function policyOf(rules: TestRule[]): Record<string, unknown> {
  return { version: "0.0.0-s312-sanitize-test", rules };
}

test("AC-8: a hostile project-rule rationale reaches the real hook's stdout terminal-sanitized, not raw", () => {
  const sb = createGateSandbox();
  const name = firstCommittedEntryName();
  sb.writeProjectPolicy(
    policyOf([{ id: "s312-deny-hostile-rationale", effect: "deny", verbs: [MARKER_REMOTE_MUTATING], targets: [`mcp/${name}/`], rationale: HOSTILE }]),
  );
  const denied = sb.mcp(name, "x");
  assertPolicyDenied(denied, `mcp__${name}__x with a hostile rule rationale`);
  const reason = denyReason(denied);
  assert.equal(reason, HOSTILE_VISIBLE, "the hook's actual stdout permissionDecisionReason must be the sanitized text, not the raw hostile rationale");
  assert.ok(!reason.includes("\u001b"), "no raw ESC byte may reach the hook's real stdout");
  assert.ok(!reason.includes("\u0000"), "no raw NUL byte may reach the hook's real stdout");
});

test("AC-8: a hostile project-rule id (no rationale, the kernel's id-fallback reason) reaches the real hook's stdout terminal-sanitized, not raw", () => {
  const sb = createGateSandbox();
  const name = firstCommittedEntryName();
  sb.writeProjectPolicy(
    policyOf([{ id: HOSTILE, effect: "deny", verbs: [MARKER_REMOTE_MUTATING], targets: [`mcp/${name}/`] }]),
  );
  const denied = sb.mcp(name, "x");
  assertPolicyDenied(denied, `mcp__${name}__x with a hostile rule id and no rationale`);
  const reason = denyReason(denied);
  // kernel.ts::decide() falls back to `denied by rule ${denyMatch.id}` when rationale is absent.
  assert.equal(reason, `denied by rule ${HOSTILE_VISIBLE}`, "the id-fallback reason must carry the sanitized id, not the raw hostile id");
  assert.ok(!reason.includes("\u001b"), "no raw ESC byte may reach the hook's real stdout");
});

// Issue #360 fix-now (red-team F3, 2026-09-28): the LOAD-BEARING guard against a conditional
// bypass (AC-7 in sanitize.test.ts is a cheap source-text smoke check only, per that test's own
// header). This is behavioral, against the REAL shipped hook (spawned, not mutated), across a set
// of arbitrary environment variables including the exact name red-team's drill used
// (THOTH_RAW_REASON) plus unrelated ones, to prove sanitization does not depend on ambient
// environment state today.
//
// Issue #360 fix-now round 3 (red-team round-3 finding R3, drill N9, 2026-09-28): `THOTH_PLAIN_REASON`
// added — the exact env-var name drill N9 used to gate a scope-shadowed identity sanitizer. This is
// a cheap, targeted addition, not a claim that a finite list now proves the unconditional property
// over the open set of possible env-var names (it does not, and AC-7b/sanitize.test.ts's own
// structural fix is what actually closes the shadow shape at the source level) — a defense-in-depth
// behavioral pin against the ONE name a real, demonstrated drill used, the same way THOTH_RAW_REASON
// itself was added for the ORIGINAL round-1 drill.
test("AC-9: the hook sanitizes a hostile rationale unconditionally, regardless of environment variables (behavioral drift guard, not a source-text pattern)", () => {
  const envCases: NodeJS.ProcessEnv[] = [
    {},
    { THOTH_RAW_REASON: "1" },
    { THOTH_RAW_REASON: "true" },
    { NODE_ENV: "production" },
    { THOTH_DEBUG: "1" },
    { THOTH_PLAIN_REASON: "1" },
  ];
  for (const env of envCases) {
    const sb = createGateSandbox();
    const name = firstCommittedEntryName();
    sb.writeProjectPolicy(
      policyOf([{ id: "s312-ac9-hostile-rationale", effect: "deny", verbs: [MARKER_REMOTE_MUTATING], targets: [`mcp/${name}/`], rationale: HOSTILE }]),
    );
    const denied = sb.mcp(name, "x", env);
    assertPolicyDenied(denied, `mcp__${name}__x with env=${JSON.stringify(env)}`);
    const reason = denyReason(denied);
    assert.equal(reason, HOSTILE_VISIBLE, `env=${JSON.stringify(env)}: the hook's stdout must be sanitized regardless of environment`);
    assert.ok(!reason.includes("\u001b"), `env=${JSON.stringify(env)}: no raw ESC byte may reach the hook's real stdout`);
    assert.ok(!reason.includes("\u0000"), `env=${JSON.stringify(env)}: no raw NUL byte may reach the hook's real stdout`);
  }
});

// Issue #360 fix-now (red-team F4, 2026-09-28): no PR test pinned a LONG hostile reason; a
// length-gated skip (`reason.length > 1000 ? reason : sanitize(reason)`) passed every existing test
// and leaked raw ESC/NUL end-to-end at 1632 characters. This fixture exceeds that measured length.
test("AC-10: a very long hostile rationale (over 1632 characters) is sanitized end-to-end through the real hook, not skipped by a length-gated bypass", () => {
  const sb = createGateSandbox();
  const name = firstCommittedEntryName();
  const longHostile = HOSTILE.repeat(Math.ceil(2000 / HOSTILE.length));
  assert.ok(longHostile.length > 1632, `fixture must exceed red-team's drill length; got ${longHostile.length}`);
  sb.writeProjectPolicy(
    policyOf([{ id: "s312-ac10-long-hostile-rationale", effect: "deny", verbs: [MARKER_REMOTE_MUTATING], targets: [`mcp/${name}/`], rationale: longHostile }]),
  );
  const denied = sb.mcp(name, "x");
  assertPolicyDenied(denied, `mcp__${name}__x with a ${longHostile.length}-char hostile rationale`);
  const reason = denyReason(denied);
  assert.ok(!reason.includes("\u001b"), `${longHostile.length}-char reason: no raw ESC byte may reach the hook's real stdout`);
  assert.ok(!reason.includes("\u0000"), `${longHostile.length}-char reason: no raw NUL byte may reach the hook's real stdout`);
});
