// Story C of #308 (AP-2): the instrument that re-vendors docs/qa/tool-inventory.json from the runtime's own
// `system`/`init` event instead of a hand-typed list. Pure functions are tested here against in-memory events and
// against the committed, scrubbed capture src/qa/fixtures/claude-init-2.1.267.json (what the instrument was run
// on). No tool name below is a hand-typed expectation about the real inventory: expectations are derived from the
// capture at run time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractBuiltinNames, extractInitEvent, mergeInventory, renderDiff, scrubInitEvent } from "./vendor-tool-inventory.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE_PATH = join(HERE, "fixtures", "claude-init-2.1.267.json");
const INVENTORY_PATH = join(HERE, "..", "..", "docs", "qa", "tool-inventory.json");

const syntheticEvent = {
  type: "system",
  subtype: "init",
  claude_code_version: "9.9.9",
  permissionMode: "default",
  tools: ["Zeta", "Alpha", "mcp__srv__thing", "Alpha", "mcp__other__x", "Mid"],
};

test("extractBuiltinNames drops every mcp__ name, de-duplicates, and keeps the rest sorted", () => {
  assert.deepEqual(extractBuiltinNames(syntheticEvent), ["Alpha", "Mid", "Zeta"]);
});

test("extractBuiltinNames refuses an event with no tools array rather than returning an empty inventory", () => {
  assert.throws(() => extractBuiltinNames({ type: "system", subtype: "init" }), /tools/);
  assert.throws(() => extractBuiltinNames({ type: "system", subtype: "init", tools: [1] }), /tools/);
  assert.throws(() => extractBuiltinNames({ type: "system", subtype: "init", tools: ["mcp__a__b"] }), /no built-in/);
});

test("extractInitEvent finds the system/init line among stream-json lines and also accepts a single scrubbed object", () => {
  const lines = [JSON.stringify({ type: "assistant" }), JSON.stringify(syntheticEvent), JSON.stringify({ type: "result" })].join("\n");
  assert.equal(extractInitEvent(lines).claude_code_version, "9.9.9");
  assert.equal(extractInitEvent(JSON.stringify(syntheticEvent, null, 2)).claude_code_version, "9.9.9");
  assert.throws(() => extractInitEvent(JSON.stringify({ type: "assistant" })), /system\/init/);
});

test("mergeInventory: tools is the union, measuredTools is exactly the event's built-ins, carriedForward is the previous-only remainder", () => {
  const previous = { tools: ["Alpha", "Old1", "Old2"] };
  const merged = mergeInventory(previous, { event: syntheticEvent, capturedAt: "2026-10-02", platform: "win32" });
  assert.deepEqual(merged.measuredTools, ["Alpha", "Mid", "Zeta"]);
  assert.deepEqual(merged.carriedForward, ["Old1", "Old2"]);
  assert.deepEqual(merged.tools, ["Alpha", "Mid", "Old1", "Old2", "Zeta"]);
  assert.equal(merged.evidenceTier, "measured");
  assert.equal(merged.claude_code_version, "9.9.9");
  assert.equal(merged.platform, "win32");
  assert.equal(merged.permissionMode, "default");
  assert.equal(merged.capturedAt, "2026-10-02");
});

test("mergeInventory never writes a name that was in neither the event nor the previous file", () => {
  const merged = mergeInventory({ tools: ["Old"] }, { event: syntheticEvent, capturedAt: "2026-10-02", platform: "win32" });
  const allowed = new Set([...extractBuiltinNames(syntheticEvent), "Old"]);
  for (const t of merged.tools) assert.ok(allowed.has(t), t);
  assert.ok(!merged.tools.some((t) => t.startsWith("mcp__")));
});

test("renderDiff lists exactly the set difference, computed not typed", () => {
  const merged = mergeInventory({ tools: ["Alpha", "Old1"] }, { event: syntheticEvent, capturedAt: "2026-10-02", platform: "win32" });
  const text = renderDiff(["Alpha", "Old1"], merged);
  assert.match(text, /NEW \(2\): Mid, Zeta/);
  assert.match(text, /CARRIED FORWARD, absent from the live list \(1\): Old1/);
  assert.match(text, /PRESENT IN BOTH \(1\): Alpha/);
});

test("scrubInitEvent keeps only the fields the instrument needs and no mcp__ name; nothing account-identifying survives", () => {
  const dirty = {
    ...syntheticEvent,
    cwd: "C:\\Users\\someone\\proj",
    session_id: "abc-123",
    uuid: "u-1",
    apiKeySource: "none",
    mcp_servers: [{ name: "claude.ai Gmail", status: "connected" }],
    memory_paths: { auto: "C:\\Users\\someone\\.claude" },
    messaging_socket_path: "\\\\.\\pipe\\x",
    powershell_path: "C:\\Windows\\pwsh.exe",
  };
  const scrubbed = scrubInitEvent(dirty, { capturedAt: "2026-10-02", platform: "win32" });
  assert.deepEqual(Object.keys(scrubbed).sort(), ["capturedAt", "claude_code_version", "permissionMode", "platform", "subtype", "tools", "type"]);
  assert.ok(!JSON.stringify(scrubbed).includes("someone"));
  assert.ok(!scrubbed.tools.some((t) => t.startsWith("mcp__")));
});

test("C1b: the committed capture re-derives the committed inventory's measured list, version, mode and tier", () => {
  const event = extractInitEvent(readFileSync(CAPTURE_PATH, "utf8"));
  const inv = JSON.parse(readFileSync(INVENTORY_PATH, "utf8")) as Record<string, unknown>;
  assert.deepEqual(inv.measuredTools, extractBuiltinNames(event));
  assert.equal(inv.claude_code_version, event.claude_code_version);
  assert.equal(inv.permissionMode, event.permissionMode);
  assert.equal(inv.evidenceTier, "measured");
  const tools = inv.tools as string[];
  const measured = new Set(inv.measuredTools as string[]);
  assert.deepEqual(inv.carriedForward, tools.filter((t) => !measured.has(t)));
  for (const m of measured) assert.ok(tools.includes(m), m);
  assert.deepEqual([...tools].sort(), tools, "tools is written sorted so a re-run is a clean diff");
});
