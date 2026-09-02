import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyAllowlistInForce } from "./allowlist.ts";
import {
  compliantSettingsViaExclusiveFlags,
  compliantSettingsViaManagedConfig,
  nonCompliantSettingsAdditiveOnly,
  nonCompliantSettingsEmpty,
  nonCompliantSettingsFlagWithEmptyList,
} from "../fixtures/allowlist-settings.ts";

test("verifyAllowlistInForce: allowManagedMcpServersOnly + non-empty allowedMcpServers -> compliant", () => {
  const result = verifyAllowlistInForce(compliantSettingsViaExclusiveFlags);
  assert.equal(result.compliant, true);
  assert.match(result.reason, /allowManagedMcpServersOnly/);
});

test("verifyAllowlistInForce: a deployed managed-mcp.json -> compliant", () => {
  const result = verifyAllowlistInForce(compliantSettingsViaManagedConfig);
  assert.equal(result.compliant, true);
  assert.match(result.reason, /managed-mcp\.json/);
});

test("verifyAllowlistInForce: an additive allowlist with no exclusive flag -> NOT compliant", () => {
  const result = verifyAllowlistInForce(nonCompliantSettingsAdditiveOnly);
  assert.equal(result.compliant, false);
});

test("verifyAllowlistInForce: the exclusive flag set but an empty allowlist -> NOT compliant", () => {
  const result = verifyAllowlistInForce(nonCompliantSettingsFlagWithEmptyList);
  assert.equal(result.compliant, false);
  assert.match(result.reason, /not actually in force/);
});

test("verifyAllowlistInForce: no relevant keys at all -> NOT compliant", () => {
  const result = verifyAllowlistInForce(nonCompliantSettingsEmpty);
  assert.equal(result.compliant, false);
});

test("verifyAllowlistInForce: non-object input (null, string, array) is treated as non-compliant, never thrown or defaulted to compliant", () => {
  for (const bad of [null, undefined, "not-an-object", 42, ["array"]]) {
    const result = verifyAllowlistInForce(bad);
    assert.equal(result.compliant, false, `expected ${JSON.stringify(bad)} to be non-compliant`);
  }
});

test("verifyAllowlistInForce: allowedMcpServers containing a non-string entry does not count as a populated allowlist", () => {
  const result = verifyAllowlistInForce({ allowManagedMcpServersOnly: true, allowedMcpServers: ["github", 42] });
  assert.equal(result.compliant, false);
});
