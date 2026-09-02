import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_VERBS, resolveVerb } from "./action-catalog.ts";

test("resolveVerb: every catalog verb resolves to itself", () => {
  for (const verb of KNOWN_VERBS) {
    assert.equal(resolveVerb(verb), verb);
  }
});

test("resolveVerb: case-insensitive and trims whitespace", () => {
  assert.equal(resolveVerb("  Delete  "), "delete");
  assert.equal(resolveVerb("WRITE"), "write");
});

test("resolveVerb: a verb outside the catalog resolves to undefined, never guessed", () => {
  assert.equal(resolveVerb("patch"), undefined);
  assert.equal(resolveVerb(""), undefined);
  assert.equal(resolveVerb("apply"), undefined);
});
