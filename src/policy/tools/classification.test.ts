import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateToolInventory } from "./classification.ts";
import { mergeToolClassificationLayers } from "../rule/precedence.ts";
import {
  centralToolClassificationLayer,
  sessionToolsAllClassified,
  sessionToolsWithOneUnclassified,
  shippedToolClassificationLayer,
} from "../fixtures/tool-classification.ts";

function mergedCatalog() {
  return mergeToolClassificationLayers(shippedToolClassificationLayer, centralToolClassificationLayer);
}

// --- SUR-03 acceptance: "Session start enumerates tools and halts on any unclassified one." ------

test("evaluateToolInventory: a session tool list with ONE deliberately unclassified tool -> haltRequired is true", () => {
  const result = evaluateToolInventory(mergedCatalog(), sessionToolsWithOneUnclassified);
  assert.equal(result.haltRequired, true);
  assert.deepEqual(result.unclassified, ["UnknownMcpTool"]);
});

test("evaluateToolInventory: every classified tool resolves to its (central-overridden, where applicable) class", () => {
  const result = evaluateToolInventory(mergedCatalog(), sessionToolsWithOneUnclassified);
  assert.deepEqual(
    result.classified.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "Bash", class: "remote-mutating" }, // central's reclassification, not shipped's
      { name: "Read", class: "read-only" },
    ],
  );
});

test("evaluateToolInventory: a session tool list where every tool IS classified -> haltRequired is false", () => {
  const result = evaluateToolInventory(mergedCatalog(), sessionToolsAllClassified);
  assert.equal(result.haltRequired, false);
  assert.deepEqual(result.unclassified, []);
  assert.equal(result.classified.length, 3);
});

test("evaluateToolInventory: an empty session tool list never halts (nothing to be ambiguous about)", () => {
  const result = evaluateToolInventory(mergedCatalog(), []);
  assert.equal(result.haltRequired, false);
  assert.deepEqual(result.classified, []);
  assert.deepEqual(result.unclassified, []);
});

test("evaluateToolInventory: an empty catalog halts on every session tool (fail-closed, never defaults to a class)", () => {
  const result = evaluateToolInventory({ version: "0.0.0", tools: [] }, ["Read", "Bash"]);
  assert.equal(result.haltRequired, true);
  assert.deepEqual(result.unclassified, ["Read", "Bash"]);
  assert.deepEqual(result.classified, []);
});

test("evaluateToolInventory: multiple unclassified tools are ALL reported, not just the first", () => {
  const result = evaluateToolInventory(mergedCatalog(), ["Read", "ToolA", "ToolB"]);
  assert.equal(result.haltRequired, true);
  assert.deepEqual(result.unclassified, ["ToolA", "ToolB"]);
});
