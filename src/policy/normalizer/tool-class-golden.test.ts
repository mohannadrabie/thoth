// G13 (golden) and G13b (rule-shape facts) for the tool-class grammar (S7 plan section 7, PC-10,
// Issue #306). story-implementer's own tests, written failing first.
//
// G13 pins the EXACT ActionRecords the tool-class normalizer produces for a fixed call list, so a
// grammar change (marker spelling, target shape, unresolved wording, class position) is a visible
// test diff. The committed fixture's first entry is READ at run time for its NAME; its CLASS is
// pinned here on purpose (an answer key: reclassifying the entry must surface as a failing test,
// mutant M2). No committed entry name is typed in this file (G19).
//
// G13b documents, with the REAL rule schema validator and the REAL kernel, the rule-author facts
// that schema.ts cannot check (it is a forbidden file for this story): class records carry no
// legacy verb; an identity-keyed deny survives a reclassification while a marker-paired deny
// follows it; four natural deny shapes load clean and never match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalize } from "./registry.ts";
import "./tool-class.ts";
import { GRAMMAR_VERSION, sanitizeMcpName } from "./tool-class-format.ts";
import { decide } from "../kernel/kernel.ts";
import type { WorldFacts } from "../kernel/kernel.ts";
import type { ActionRecord } from "../kernel/action-record.ts";
import type { Rule } from "../kernel/rule-types.ts";
import { validateRuleSet } from "../rule/schema.ts";
import type { MergedToolClassificationSet, ToolClass } from "../tools/classification.ts";
import { parseCentralClassificationFixture } from "../tools/central-classification.ts";

const FIXTURE_PATH = new URL("../../../docs/qa/s5-central-classification.json", import.meta.url);

function catalogOf(entries: [string, ToolClass][]): MergedToolClassificationSet {
  return { version: "0.0.0-test", tools: entries.map(([name, cls]) => ({ name, class: cls, sourceLayer: "central" as const })) };
}
function callTool(toolName: unknown, catalog: unknown): ActionRecord {
  return normalize("tool-class", { toolName, catalog, environment: "unknown", identity: "g13", deferred: false });
}
function record(verb: string, target: string): ActionRecord {
  return { source: "structured", verbs: [verb], targets: [target], environment: "unknown", identity: "g13", deferred: false, unresolved: [] };
}
function opaque(cause: string): ActionRecord {
  return { source: "opaque", verbs: [], targets: [], environment: "unknown", identity: "g13", deferred: false, unresolved: [cause] };
}

test("G13: golden: exact ActionRecords of the tool-class normalizer for a fixed call list (3 classes, each unresolved cause, the first committed fixture entry with its class pinned) and GRAMMAR_VERSION", () => {
  assert.equal(GRAMMAR_VERSION, "1");
  const fixture = parseCentralClassificationFixture(readFileSync(FIXTURE_PATH, "utf8"));
  const first = fixture.centralLayer.tools[0];
  assert.ok(first !== undefined, "the committed fixture has at least one entry");
  // PINNED answer key (M2): the first committed entry is classified remote-mutating today.
  assert.equal(first.class, "remote-mutating", "the first committed entry's class is pinned; reclassifying it must be a deliberate, reviewed change to this golden");
  const cat = catalogOf([["standin-ro", "read-only"], ["standin-ws", "workspace-mutating"], ["standin-rm", "remote-mutating"], [first.name, first.class]]);

  assert.deepEqual(callTool("mcp__standin-ro__list_things", cat), record("tool-class:read-only", "mcp/standin-ro/list_things"));
  assert.deepEqual(callTool("mcp__standin-ws__write_thing", cat), record("tool-class:workspace-mutating", "mcp/standin-ws/write_thing"));
  assert.deepEqual(callTool("mcp__standin-rm__delete-thing", cat), record("tool-class:remote-mutating", "mcp/standin-rm/delete-thing"));
  assert.deepEqual(callTool(`mcp__${sanitizeMcpName(first.name)}__x`, cat), record("tool-class:remote-mutating", `mcp/${first.name}/x`));

  // each unresolved cause, exact wording (grammar version 1)
  assert.deepEqual(callTool(42, cat), opaque("tool name is not a non-empty string"));
  assert.deepEqual(callTool("", cat), opaque("tool name is not a non-empty string"));
  assert.deepEqual(callTool("Read", cat), opaque('tool name "Read" is not an mcp__ tool name'));
  assert.deepEqual(callTool("mcp__standin-ro", cat), opaque('tool name "mcp__standin-ro" does not split into one server segment and one tool segment'));
  assert.deepEqual(callTool("mcp__standin-ro__a__b", cat), opaque('tool name "mcp__standin-ro__a__b" does not split into one server segment and one tool segment'));
  assert.deepEqual(callTool("mcp__nosuch__x", cat), opaque('server "nosuch" is not classified'));
  assert.deepEqual(callTool("mcp__standin-ro__x", undefined), opaque("classification catalog is missing or malformed"));
  // a runtime-shaped name with a triple underscore in the tool segment (S-6), built from the committed entry
  assert.deepEqual(callTool(`mcp__${first.name}__aws___list`, cat), opaque(`tool name "mcp__${first.name}__aws___list" does not split into one server segment and one tool segment`));
});

// --- G13b --------------------------------------------------------------------------------------

function world(rules: Rule[], defaultOutcome: "allow" | "deny"): WorldFacts {
  return { rules: { version: "0.0.0-test", rules }, defaultOutcome };
}
function validates(rules: Rule[]): number {
  return validateRuleSet({ version: "1", rules }, JSON.stringify({ version: "1", rules })).length;
}

test("G13b: rule-shape facts pinned (PC-10, #306; documenting, real schema validator plus kernel): legacy-verb deny does not match a class record; identity-keyed deny survives a flip and a marker-paired deny does not; four natural-but-inert deny shapes load with 0 schema errors and never match", () => {
  const remote = callTool("mcp__standin-x__run", catalogOf([["standin-x", "remote-mutating"]]));
  const flipped = callTool("mcp__standin-x__run", catalogOf([["standin-x", "read-only"]]));

  // fact 1: no legacy verb
  const legacy: Rule[] = [{ id: "deny-legacy", effect: "deny", verbs: ["write", "create", "modify", "delete", "move", "rename", "execute"] }];
  assert.equal(decide(world(legacy, "allow"), remote).outcome, "allow", "a deny keyed on the legacy mutating verbs never sees a class record");

  // fact 2: identity-keyed deny survives; marker-paired deny follows the fixture
  const identity: Rule[] = [{ id: "deny-identity", effect: "deny", targets: ["mcp/standin-x/"] }];
  const paired: Rule[] = [{ id: "deny-paired", effect: "deny", verbs: ["tool-class:remote-mutating"], targets: ["mcp/standin-x/"] }];
  assert.equal(decide(world(identity, "allow"), remote).outcome, "deny");
  assert.equal(decide(world(identity, "allow"), flipped).outcome, "deny", "an identity-keyed deny survives a reclassification");
  assert.equal(decide(world(paired, "allow"), remote).outcome, "deny");
  assert.equal(decide(world(paired, "allow"), flipped).outcome, "allow", "a marker-paired deny follows the fixture");

  // fact 3 and the four inert shapes: 0 schema errors, never match
  const inert: { label: string; rule: Rule }[] = [
    { label: "misspelled marker verb", rule: { id: "i-typo", effect: "deny", verbs: ["tool-class:remote-mutatin"] } },
    { label: "server target without the trailing slash", rule: { id: "i-noslash", effect: "deny", targets: ["mcp/standin-x"] } },
    { label: "legacy mutating verbs plus the mcp target prefix", rule: { id: "i-legacy", effect: "deny", verbs: ["write", "execute"], targets: ["mcp/standin-x/"] } },
    { label: "declared server name instead of the sanitized runtime name", rule: { id: "i-declared", effect: "deny", targets: ["mcp/standin x/"] } },
  ];
  for (const { label, rule } of inert) {
    assert.equal(validates([rule]), 0, `${label}: loads clean (schema.ts validates verbs and targets as string arrays only)`);
    assert.equal(decide(world([rule], "allow"), remote).outcome, "allow", `${label}: never matches, so the call is allowed silently`);
  }
  // controls: the correct shapes DO match
  assert.equal(decide(world([{ id: "c1", effect: "deny", verbs: ["tool-class:remote-mutating"] }], "allow"), remote).outcome, "deny");
  assert.equal(decide(world([{ id: "c2", effect: "deny", targets: ["mcp/standin-x/"] }], "allow"), remote).outcome, "deny");

  // GRAMMAR_VERSION is exported and asserted (a bump needs a decisions row plus a central-rule migration note)
  assert.equal(GRAMMAR_VERSION, "1");
});
