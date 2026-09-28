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
