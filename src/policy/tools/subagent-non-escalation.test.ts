// SUR-14: "Tool grants shall be non-escalating: a delegated session shall never hold a capability
// its parent lacks." Notes column: "Fixture proves it." Fixture-only per docs/decisions.md's
// 2026-09-06 S5-intake ruling, point 5: "SUR-14 stays fixture-proven ... not actually ambiguous,
// just confirmed" — no real Task-tool delegation wiring is built this story (that would require
// live introspection of a subagent session's actual tool grants, which this runtime does not
// expose to a hook any more than it exposes a live top-level tool list at all — see this story's
// plan Named Finding 1). Filed at src/policy/tools/, not src/policy/kernel/ (architecture-
// reviewer's council-seat condition, criterion 22) — this is a fixture/set-membership property
// test, not kernel decision logic, and has no production module of its own to import: there is no
// real delegation-wiring consumer for this property yet (constraints: "no real Task-tool
// delegation wiring (SUR-14 stays fixture)"), so the property itself is expressed directly here
// rather than exported from a module nothing else calls.
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * A fixture "tool grant" is just the set of tool names a session (parent or delegated child) is
 * permitted to use. Non-escalation (SUR-14's own text): every tool the child holds must also be
 * held by its parent — the child's grant is a subset (not necessarily proper) of the parent's.
 */
function isNonEscalating(parentGrant: ReadonlySet<string>, childGrant: ReadonlySet<string>): boolean {
  for (const tool of childGrant) {
    if (!parentGrant.has(tool)) return false;
  }
  return true;
}

test("SUR-14 fixture: a child grant identical to its parent's is non-escalating", () => {
  const parent = new Set(["Read", "Bash", "Edit"]);
  const child = new Set(["Read", "Bash", "Edit"]);
  assert.equal(isNonEscalating(parent, child), true);
});

test("SUR-14 fixture: a child grant that is a strict subset of its parent's is non-escalating", () => {
  const parent = new Set(["Read", "Bash", "Edit", "WebFetch"]);
  const child = new Set(["Read", "Bash"]);
  assert.equal(isNonEscalating(parent, child), true);
});

test("SUR-14 fixture: an empty child grant is trivially non-escalating against any parent", () => {
  const parent = new Set(["Read"]);
  const child = new Set<string>([]);
  assert.equal(isNonEscalating(parent, child), true);
});

test("SUR-14 fixture: a child grant that adds even ONE tool the parent lacks IS escalating -- detected, never silently allowed", () => {
  const parent = new Set(["Read", "Bash"]);
  const child = new Set(["Read", "Bash", "WebFetch"]);
  assert.equal(isNonEscalating(parent, child), false);
});

test("SUR-14 fixture: an empty parent grant makes ANY non-empty child grant escalating", () => {
  const parent = new Set<string>([]);
  const child = new Set(["Read"]);
  assert.equal(isNonEscalating(parent, child), false);
});

test("SUR-14 fixture: two disjoint, non-empty grants are escalating (the child holds something the parent never had)", () => {
  const parent = new Set(["Bash"]);
  const child = new Set(["WebFetch"]);
  assert.equal(isNonEscalating(parent, child), false);
});
