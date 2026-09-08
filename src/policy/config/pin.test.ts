import { test } from "node:test";
import assert from "node:assert/strict";
import { computePin } from "./pin.ts";

test("AC2: identical central bytes -> identical pin digest", () => {
  const a = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: '{"version":"1.0.0","rules":[]}' });
  const b = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: '{"version":"1.0.0","rules":[]}' });
  assert.equal(a.digest, b.digest);
});

test("AC2: changed central bytes -> a different pin digest", () => {
  const a = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: '{"version":"1.0.0","rules":[]}' });
  const b = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: '{"version":"1.0.1","rules":[]}' });
  assert.notEqual(a.digest, b.digest);
});

test("AC2: an absent central channel produces a distinguishable pin state -- never the digest of an empty string", () => {
  const absent = computePin({ centralStatus: "absent" });
  const emptyStringDigest = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: "" });
  assert.notEqual(absent.digest, emptyStringDigest.digest, "an absent channel must never hash identically to a present-but-empty one");
});

test("AC2: absent and unsupported produce DIFFERENT pin digests from each other too", () => {
  const absent = computePin({ centralStatus: "absent" });
  const unsupported = computePin({ centralStatus: "unsupported" });
  assert.notEqual(absent.digest, unsupported.digest);
});

test("AC2: channel field is populated for every status -- present carries the real channel, others carry a parenthesized status word", () => {
  assert.equal(computePin({ centralStatus: "present", centralChannel: "win32-registry:X", centralRaw: "{}" }).channel, "win32-registry:X");
  assert.equal(computePin({ centralStatus: "absent" }).channel, "(absent)");
  assert.equal(computePin({ centralStatus: "unsupported" }).channel, "(unsupported)");
});

test("computePin is deterministic given the same `now` -- computedAt is the injected clock's own ISO string, not a live read", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");
  const pin = computePin({ centralStatus: "absent" }, now);
  assert.equal(pin.computedAt, "2026-09-08T12:00:00.000Z");
});

test("the timestamp is not folded into the digest -- two computations of identical content at two different times still produce the same digest", () => {
  const t1 = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: "{}" }, new Date("2026-01-01T00:00:00.000Z"));
  const t2 = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: "{}" }, new Date("2026-12-31T23:59:59.000Z"));
  assert.equal(t1.digest, t2.digest);
});
