import { test } from "node:test";
import assert from "node:assert/strict";
import { SECRET_PATTERNS } from "./patterns.ts";

function findPattern(id: string) {
  const p = SECRET_PATTERNS.find((x) => x.id === id);
  if (!p) throw new Error(`no pattern ${id}`);
  p.regex.lastIndex = 0;
  return p;
}

test("email-address: matches a real email", () => {
  const p = findPattern("email-address");
  assert.ok(p.regex.test("contact security@example.com for reports"));
});

test("email-address: does NOT match an npm package version specifier (regression — false " +
  "positive found scanning this repo's own REQUIREMENTS.md: `@microsoft/agent-governance-sdk@5.0.0`)", () => {
  const p = findPattern("email-address");
  assert.equal(p.regex.test("@microsoft/agent-governance-sdk@5.0.0"), false);
  p.regex.lastIndex = 0;
  assert.equal(p.regex.test("agent-governance-claude-code@5.0.0"), false);
});

test("aws-access-key-id: matches an AKIA-shaped key", () => {
  const p = findPattern("aws-access-key-id");
  assert.ok(p.regex.test("AKIAABCDEFGHIJKLMNOP"));
});

test("ipv4-private: matches a private-range address, not a public one", () => {
  const priv = findPattern("ipv4-private");
  assert.ok(priv.regex.test("server at 10.0.1.5 is internal"));
  priv.regex.lastIndex = 0;
  assert.equal(priv.regex.test("public DNS 8.8.8.8"), false);
});
