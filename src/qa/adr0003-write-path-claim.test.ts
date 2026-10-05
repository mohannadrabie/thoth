// #308 story J, architecture review conditions F1 and F4 (docs/reviews/s308-J-adr0003-amendment-architecture-2026-10-05.md):
// THOTH-ADR-0003 must not claim that its protections close every session write path while the K proposal still lists
// arbitrary-exec built-ins as a pending human decision, and the ADR must point at that list rather than retype its tools
// (single source, CLAUDE.md completeness rule). written FAILING FIRST against the over-claiming text. The ADR was accepted by the human on 2026-10-05.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const adr = readFileSync(`${ROOT}docs/adr/thoth-0003-central-classification-fixture-as-gate-input.md`, "utf8");
const proposal = JSON.parse(readFileSync(`${ROOT}docs/plans/s308-K-proposed-entry-2026-10-05.json`, "utf8")) as { pendingHumanDecision: { tool: string }[] };

test("adr0003-write-path-claim-matches-pending-list: while pendingHumanDecision is non-empty the ADR does not claim to close every session write path, and its residual table names the un-routed built-ins", () => {
  assert.ok(proposal.pendingHumanDecision.length > 0, "the K proposal has pending tools (if this fails, the ADR text and this test change in the same commit)");
  assert.doesNotMatch(adr, /close the session write paths/i, "closing-every-path claim");
  assert.doesNotMatch(adr, /are the only controls/i, "only-controls claim");
  assert.match(adr, /Un-routed arbitrary-execution built-ins/, "residual row for the un-routed built-ins");
  assert.match(adr, /pendingHumanDecision/, "points at the K proposal's list");
  // Accepted by the human on 2026-10-05 ("accept ADR-0003 but keep the 2026-09-19 exemption"); the Status line must carry the human's name, never an agent's.
  assert.match(adr, /^status: accepted$/m, "accepted by the human 2026-10-05");
  assert.match(adr, /\*\*Status:\*\* Accepted \(2026-10-05\) by `mohannadrabie`/, "acceptance is attributed to the human");
});

test("adr0003-no-retyped-tool-list: no pending tool name is retyped in the ADR (the K proposal's pendingHumanDecision list is the single source)", () => {
  for (const { tool } of proposal.pendingHumanDecision) {
    assert.doesNotMatch(adr, new RegExp(String.raw`\b${tool}\b`), `${tool} retyped in the ADR`);
  }
});
