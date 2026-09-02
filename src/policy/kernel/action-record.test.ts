import { test } from "node:test";
import assert from "node:assert/strict";
import { isActionRecord } from "./action-record.ts";

const validRecord = {
  source: "parsed",
  verbs: ["write"],
  targets: ["/etc/passwd"],
  environment: "prod",
  identity: "agent:build",
  deferred: false,
  unresolved: [],
};

test("action-record: a fully-shaped record passes", () => {
  assert.equal(isActionRecord(validRecord), true);
});

test("action-record: POL-04 floor — an extra, non-branching field is tolerated (floor, not ceiling)", () => {
  assert.equal(isActionRecord({ ...validRecord, auditTag: "trace-123" }), true);
});

function omit(obj: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
}

for (const field of Object.keys(validRecord)) {
  test(`action-record: missing required field "${field}" fails`, () => {
    assert.equal(isActionRecord(omit(validRecord, field)), false);
  });
}

test("action-record: source must be one of the literal union parsed|structured|opaque, not any string", () => {
  assert.equal(isActionRecord({ ...validRecord, source: 42 }), false);
  // Issue #61 regression: a tool-family string is a real string but not a conforming value —
  // the guard must reject it, not merely check typeof.
  assert.equal(isActionRecord({ ...validRecord, source: "shell" }), false);
  assert.equal(isActionRecord({ ...validRecord, source: "fs" }), false);
});

test("action-record: source accepts each of the three literal union values", () => {
  for (const source of ["parsed", "structured", "opaque"] as const) {
    assert.equal(isActionRecord({ ...validRecord, source }), true, `source "${source}" should be valid`);
  }
});

test("action-record: verbs must be a string array", () => {
  assert.equal(isActionRecord({ ...validRecord, verbs: [1, 2] }), false);
  assert.equal(isActionRecord({ ...validRecord, verbs: "write" }), false);
});

test("action-record: targets must be a string array", () => {
  assert.equal(isActionRecord({ ...validRecord, targets: [null] }), false);
});

test("action-record: environment must be a string", () => {
  assert.equal(isActionRecord({ ...validRecord, environment: 1 }), false);
});

test("action-record: identity must be a string", () => {
  assert.equal(isActionRecord({ ...validRecord, identity: null }), false);
});

test("action-record: deferred must be a boolean", () => {
  assert.equal(isActionRecord({ ...validRecord, deferred: "false" }), false);
});

test("action-record: unresolved must be a string array", () => {
  assert.equal(isActionRecord({ ...validRecord, unresolved: [1] }), false);
});

test("action-record: non-object input fails", () => {
  assert.equal(isActionRecord(null), false);
  assert.equal(isActionRecord("record"), false);
  assert.equal(isActionRecord(42), false);
});
