import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { exitCodeFor } from "../lib/instrument.ts";
import {
  computeDrift,
  EXCEPTED_PRIMITIVE_ROWS,
  parseDocumentedKeys,
} from "./runtime-settings-drift-check.ts";

const THIS_FILE_SOURCE_PATH = fileURLToPath(new URL("./runtime-settings-drift-check.ts", import.meta.url));

// A synthetic §1.4-shaped table, standing in for the real REQUIREMENTS.md table so these tests
// don't depend on the live document's exact prose — only its heading-bounded table shape.
function syntheticSection14(rows: string): string {
  return [
    "### 1.3 Something before",
    "",
    "irrelevant prose with a `fakeKey` that must never be counted — outside §1.4's bounds",
    "",
    "### 1.4 What to configure on the runtime",
    "",
    "| Primitive | Setting keys | Covers |",
    "|---|---|---|",
    rows,
    "",
    "### 1.5 Something after",
    "",
    "prose with `anotherFakeKey` — also outside §1.4's bounds",
  ].join("\n");
}

test("QA-17 (AC1): this instrument imports no fetch/http(s) module anywhere — it is offline by construction", async () => {
  const source = await readFile(THIS_FILE_SOURCE_PATH, "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /from\s+["']node:https?["']/);
  assert.doesNotMatch(source, /require\(\s*["']https?["']\s*\)/);
});

test("QA-17 (AC4, self-check): no soft/warn/continue-on-error style escape hatch exists anywhere in this file", async () => {
  const source = await readFile(THIS_FILE_SOURCE_PATH, "utf8");
  assert.doesNotMatch(source, /--soft\b/);
  assert.doesNotMatch(source, /--warn\b/);
  assert.doesNotMatch(source, /continue-on-error/i);
});

test("QA-17 (AC2): parseDocumentedKeys is heading-bounded — only §1.4's own table rows are read, nothing before/after", () => {
  const md = syntheticSection14("| Some primitive | `realKey`, `another.realKey` | SOME-REQ |");
  const keys = parseDocumentedKeys(md);
  assert.deepEqual([...keys].sort(), ["another.realKey", "realKey"]);
  assert.equal(keys.has("fakeKey"), false, "prose before §1.4 must never be scanned");
  assert.equal(keys.has("anotherFakeKey"), false, "prose after §1.4 must never be scanned");
});

test("QA-17 (AC2): exact-string-match, case-sensitive, no substring matching", () => {
  const md = syntheticSection14("| Some primitive | `sandbox.enabled` | SOME-REQ |");
  const documented = parseDocumentedKeys(md);

  // Substring / case variants of a real documented key must NOT be treated as present.
  const vendored = new Set(["Sandbox.Enabled", "sandbox.enable", "sandbox.enabled.extra", "sandbox"]);
  const drift = computeDrift(vendored, documented, new Set());

  // Every vendored (wrong-case/substring) entry is reported REMOVED (not silently matched), and
  // the real documented key is reported ADDED (not silently matched to any of the near-miss
  // vendored strings) — proving no fuzzy/substring/case-insensitive matching anywhere.
  assert.equal(drift.some((d) => d.includes('REMOVED: "Sandbox.Enabled"')), true);
  assert.equal(drift.some((d) => d.includes('REMOVED: "sandbox.enable"')), true);
  assert.equal(drift.some((d) => d.includes('REMOVED: "sandbox.enabled.extra"')), true);
  assert.equal(drift.some((d) => d.includes('REMOVED: "sandbox"')), true);
  assert.equal(drift.some((d) => d.includes('ADDED: "sandbox.enabled"')), true);
});

test("QA-17 (AC2): identical vendored/documented key sets produce zero drift", () => {
  const md = syntheticSection14("| Some primitive | `requiredMinimumVersion`, `minimumVersion` | SOME-REQ |");
  const documented = parseDocumentedKeys(md);
  const vendored = new Set(["requiredMinimumVersion", "minimumVersion"]);
  assert.deepEqual(computeDrift(vendored, documented, new Set()), []);
});

test("QA-17 (AC3): the hooks row (empty Setting keys cell) never produces false-positive drift", () => {
  const hooksRow = "| `PreToolUse`, `UserPromptSubmit`, `SessionStart`, `SubagentStop` hooks |  | SUR-01, SUR-13 |";
  assert.equal(EXCEPTED_PRIMITIVE_ROWS.has("`PreToolUse`, `UserPromptSubmit`, `SessionStart`, `SubagentStop` hooks"), true);
  const md = syntheticSection14(hooksRow);
  const documented = parseDocumentedKeys(md);
  assert.deepEqual([...documented], [], "an excepted row with an empty cell contributes no keys");
  assert.deepEqual(computeDrift(new Set(), documented, new Set()), []);
});

test("QA-17 (AC3): the managed-policy-delivery row (channels/paths, not literal keys) never produces false-positive drift", () => {
  const deliveryRow =
    "| Managed policy delivery | Server-managed settings from the admin console; macOS plist `com.anthropic.claudecode`; Windows `HKLM\\SOFTWARE\\Policies\\ClaudeCode`; or `managed-settings.json` | POL-08 |";
  assert.equal(EXCEPTED_PRIMITIVE_ROWS.has("Managed policy delivery"), true);
  const md = syntheticSection14(deliveryRow);
  const documented = parseDocumentedKeys(md);
  // Even though `com.anthropic.claudecode` is dotted/key-shaped, the whole row is excepted by its
  // Primitive-column identity, so nothing from its cell is ever extracted.
  assert.deepEqual([...documented], [], "an excepted row contributes no keys even when its cell content is key-shaped");
  assert.deepEqual(computeDrift(new Set(), documented, new Set()), []);
});

test("QA-17 (AC4): one real, non-excepted drift case (an unaccounted key) produces non-zero exit", () => {
  const md = syntheticSection14("| Some primitive | `realKey`, `brandNewUnvendoredKey` | SOME-REQ |");
  const documented = parseDocumentedKeys(md);
  const vendored = new Set(["realKey"]); // does not know about brandNewUnvendoredKey
  const drift = computeDrift(vendored, documented, new Set());
  assert.equal(drift.length, 1);
  assert.match(drift[0] ?? "", /ADDED: "brandNewUnvendoredKey"/);
  assert.equal(exitCodeFor({ ok: false, vacuous: false, summary: "x", details: drift }), 1);
});

test("QA-17: non-key-shaped backtick spans (file names, hyphenated) are never counted as keys even in a non-excepted row", () => {
  const md = syntheticSection14("| Exclusive tool-server allowlist | `allowManagedMcpServersOnly`, or a deployed `managed-mcp.json` | SUR-04 |");
  const documented = parseDocumentedKeys(md);
  assert.deepEqual([...documented], ["allowManagedMcpServersOnly"]);
  assert.equal(documented.has("managed-mcp.json"), false);
});

test("QA-17: the real vendored fixture matches the real REQUIREMENTS.md §1.4 table today (no drift)", async () => {
  const inventory = JSON.parse(await readFile("docs/qa/runtime-settings-inventory.json", "utf8")) as {
    settingsKeys: string[];
  };
  const requirementsMdText = await readFile("REQUIREMENTS.md", "utf8");
  const documented = parseDocumentedKeys(requirementsMdText);
  const drift = computeDrift(new Set(inventory.settingsKeys), documented, new Set());
  assert.deepEqual(drift, [], drift.join("\n"));
});
