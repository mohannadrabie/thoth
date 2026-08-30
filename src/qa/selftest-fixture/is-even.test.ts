import { test } from "node:test";
import assert from "node:assert/strict";
import { isEven } from "./is-even.ts";

test("isEven: 0 classifies as even", () => {
  assert.equal(isEven(0), true);
});

test("isEven: 3 classifies as odd", () => {
  assert.equal(isEven(3), false);
});

test("isEven: 4 classifies as even", () => {
  assert.equal(isEven(4), true);
});
