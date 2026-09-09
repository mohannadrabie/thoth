import { test } from "node:test";
import assert from "node:assert/strict";
import { computePin } from "./pin.ts";

test("AC2: identical shipped+central+project bytes -> identical pin digest", () => {
  const a = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: '{"version":"1.0.0","rules":[]}', shippedRaw: "shipped-bytes", projectRaw: "project-bytes" });
  const b = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: '{"version":"1.0.0","rules":[]}', shippedRaw: "shipped-bytes", projectRaw: "project-bytes" });
  assert.equal(a.digest, b.digest);
});

test("AC2: changed central bytes -> a different pin digest", () => {
  const a = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: '{"version":"1.0.0","rules":[]}', shippedRaw: "s", projectRaw: "p" });
  const b = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: '{"version":"1.0.1","rules":[]}', shippedRaw: "s", projectRaw: "p" });
  assert.notEqual(a.digest, b.digest);
});

// --- Stage-3 fix-now (2026-09-08), Issue #110: pin now also covers shipped-defaults+project -------

test("Issue #110: changed shipped-defaults bytes -> a different pin digest (previously invisible to the pin -- central-only build)", () => {
  const a = computePin({ centralStatus: "absent", shippedRaw: "shipped-v1", projectRaw: "p" });
  const b = computePin({ centralStatus: "absent", shippedRaw: "shipped-v2", projectRaw: "p" });
  assert.notEqual(a.digest, b.digest);
});

test("Issue #110: changed project bytes -> a different pin digest (previously invisible to the pin -- the exact repro REQUIREMENTS.md's own POL-09 text warns about)", () => {
  const a = computePin({ centralStatus: "absent", shippedRaw: "s", projectRaw: "project-v1" });
  const b = computePin({ centralStatus: "absent", shippedRaw: "s", projectRaw: "project-v2" });
  assert.notEqual(a.digest, b.digest);
});

test("Issue #110: no concatenation-boundary collision between two different (shipped, project) splits of the same total bytes ('ab'+'' vs 'a'+'b', both naive-concatenate to 'ab')", () => {
  const a = computePin({ centralStatus: "absent", shippedRaw: "ab", projectRaw: "" });
  const b = computePin({ centralStatus: "absent", shippedRaw: "a", projectRaw: "b" });
  assert.notEqual(a.digest, b.digest, "labeled, length-prefixed frames must rule out this exact class of boundary collision");
});

// Issue #122 (red-team round-5 re-confirm): the (shipped, project) split above is NON-ADJACENT --
// the central frame always sits between them in the fixed hash order (shipped-defaults, central,
// project), so that split cannot collide even with the framing entirely deleted (proved by
// mutation: see the fix-now build receipt). The two boundaries that actually matter are the
// ADJACENT ones -- shipped|central and central|project -- which this test targets directly.
test("Issue #122: neither ADJACENT frame boundary (shipped|central, central|project) admits a collision", () => {
  // shipped|central boundary: ("ab","c","") vs ("a","bc","") -- project held constant/empty so
  // only the shipped/central split varies. Naive concatenation of both: "ab"+"c"+"" === "a"+"bc"+"".
  const shippedCentralA = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: "c", shippedRaw: "ab", projectRaw: "" });
  const shippedCentralB = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: "bc", shippedRaw: "a", projectRaw: "" });
  assert.notEqual(shippedCentralA.digest, shippedCentralB.digest, "labeled, length-prefixed frames must not let a (shipped='ab', central='c') pin collide with a (shipped='a', central='bc') pin");

  // central|project boundary: ("","c","ab") vs ("","cab","") -- shipped held constant/empty so
  // only the central/project split varies. Naive concatenation of both: ""+"c"+"ab" === ""+"cab"+"".
  const centralProjectA = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: "c", shippedRaw: "", projectRaw: "ab" });
  const centralProjectB = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: "cab", shippedRaw: "", projectRaw: "" });
  assert.notEqual(centralProjectA.digest, centralProjectB.digest, "labeled, length-prefixed frames must not let a (central='c', project='ab') pin collide with a (central='cab', project='') pin");
});

test("AC2: an absent central channel produces a distinguishable pin state -- never the digest of an empty string", () => {
  const absent = computePin({ centralStatus: "absent", shippedRaw: "s", projectRaw: "p" });
  const emptyStringDigest = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: "", shippedRaw: "s", projectRaw: "p" });
  assert.notEqual(absent.digest, emptyStringDigest.digest, "an absent channel must never hash identically to a present-but-empty one");
});

test("AC2: absent and unsupported produce DIFFERENT pin digests from each other too", () => {
  const absent = computePin({ centralStatus: "absent", shippedRaw: "s", projectRaw: "p" });
  const unsupported = computePin({ centralStatus: "unsupported", shippedRaw: "s", projectRaw: "p" });
  assert.notEqual(absent.digest, unsupported.digest);
});

test("AC2: channel field is populated for every status -- present carries the real channel, others carry a parenthesized status word", () => {
  assert.equal(computePin({ centralStatus: "present", centralChannel: "win32-registry:X", centralRaw: "{}", shippedRaw: "s", projectRaw: "p" }).channel, "win32-registry:X");
  assert.equal(computePin({ centralStatus: "absent", shippedRaw: "s", projectRaw: "p" }).channel, "(absent)");
  assert.equal(computePin({ centralStatus: "unsupported", shippedRaw: "s", projectRaw: "p" }).channel, "(unsupported)");
});

test("computePin is deterministic given the same `now` -- computedAt is the injected clock's own ISO string, not a live read", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");
  const pin = computePin({ centralStatus: "absent", shippedRaw: "s", projectRaw: "p" }, now);
  assert.equal(pin.computedAt, "2026-09-08T12:00:00.000Z");
});

test("the timestamp is not folded into the digest -- two computations of identical content at two different times still produce the same digest", () => {
  const t1 = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: "{}", shippedRaw: "s", projectRaw: "p" }, new Date("2026-01-01T00:00:00.000Z"));
  const t2 = computePin({ centralStatus: "present", centralChannel: "chan", centralRaw: "{}", shippedRaw: "s", projectRaw: "p" }, new Date("2026-12-31T23:59:59.000Z"));
  assert.equal(t1.digest, t2.digest);
});
