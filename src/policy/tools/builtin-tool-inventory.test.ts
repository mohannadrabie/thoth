import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBuiltinToolClassificationLayer,
  loadBuiltinToolClassificationLayer,
  loadBuiltinToolInventory,
  parseBuiltinToolInventory,
} from "./builtin-tool-inventory.ts";

test("parseBuiltinToolInventory: a well-formed JSON string parses into a typed inventory", () => {
  const json = JSON.stringify({ sourceUrl: "https://x", capturedAt: "2026-09-06", evidenceTier: "derived", tools: ["Read", "Bash"] });
  const inv = parseBuiltinToolInventory(json);
  assert.deepEqual(inv.tools, ["Read", "Bash"]);
  assert.equal(inv.evidenceTier, "derived");
});

test("parseBuiltinToolInventory: a non-array \"tools\" field throws rather than silently coercing", () => {
  assert.throws(() => parseBuiltinToolInventory(JSON.stringify({ tools: "not-an-array" })));
});

test("parseBuiltinToolInventory: a \"tools\" array containing a non-string element throws", () => {
  assert.throws(() => parseBuiltinToolInventory(JSON.stringify({ tools: ["Read", 5] })));
});

test("loadBuiltinToolInventory: the real, committed docs/qa/tool-inventory.json loads and parses", () => {
  const inv = loadBuiltinToolInventory();
  assert.ok(inv.tools.length > 0);
  assert.ok(inv.tools.includes("Bash"));
  assert.ok(inv.tools.includes("Read"));
});

test("buildBuiltinToolClassificationLayer: every vendored tool name is classified — self-test guarding against a future tool-inventory.json addition with no matching CLASSIFICATION entry", () => {
  const inv = loadBuiltinToolInventory();
  const layer = buildBuiltinToolClassificationLayer(inv);
  assert.equal(layer.tools.length, inv.tools.length);
  for (const t of layer.tools) {
    assert.ok(["read-only", "workspace-mutating", "remote-mutating"].includes(t.class));
  }
});

test("buildBuiltinToolClassificationLayer: a vendored name with no CLASSIFICATION entry throws loudly, never silently unclassified", () => {
  assert.throws(
    () => buildBuiltinToolClassificationLayer({ sourceUrl: "x", capturedAt: "x", evidenceTier: "x", tools: ["TotallyUnknownFutureTool"] }),
    /has no CLASSIFICATION entry/,
  );
});

test("loadBuiltinToolClassificationLayer: end-to-end, loads the real file and classifies every real built-in tool", () => {
  const layer = loadBuiltinToolClassificationLayer();
  const names = layer.tools.map((t) => t.name);
  assert.ok(names.includes("Bash"));
  assert.ok(names.includes("Edit"));
});
