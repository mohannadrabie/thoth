// Regression tests for src/policy/tools/central-classification.ts (S5 Stage-3 CRITICAL review
// round 1 fix-now, `story-implementer`'s own unit tests -- no test-writer dispatch this pass, per
// this project's own "no new UI/API surface" test-first carve-out: this module is a pure internal
// data-loading contract, not an externally-observable surface).
//
// `fixture-single-source-of-truth` (GitHub Issue #217, human directive 2026-09-18: "remove the timer,
// remove the pinned list, the json is the single source of truth"): docs/qa/s5-central-classification.json
// is the ONLY place either allowlist lives, and editing it needs no test edit. The earlier exact-content
// pins (AC1-a/AC1-b), the expiresOn tests (AC1-c, S5-R2-N2, the isFixtureExpired boundary tests) and the
// `ratifiedBy` tests are removed on purpose -- see docs/decisions.md's 2026-09-19 row and the project-tier
// ADR under docs/adr/.
//
// What stays here is the integrity of the loader itself:
//   - "committed fixture: loads through the real loader (content is not asserted)"
//   - parseCentralClassificationFixture() accepts a fixture with no expiresOn/ratifiedBy, and ignores
//     legacy copies of those fields (they do nothing)
//   - parseCentralClassificationFixture()'s own malformed-input rejection (mirrors
//     builtin-tool-inventory.ts's own established "throw loudly, never silently drop" convention)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCentralClassificationFixture, loadCentralClassificationFixture } from "./central-classification.ts";

// --- the real committed fixture: loader integrity only, content deliberately NOT asserted --------

test("committed fixture: loads through the real loader (shape-valid); its content is deliberately not asserted -- the JSON is the single source of truth", () => {
  const fixture = loadCentralClassificationFixture();
  assert.equal(typeof fixture.version, "string");
  assert.ok(Array.isArray(fixture.centralLayer.tools));
  assert.ok(Array.isArray(fixture.knownConnectors));
});

// --- no timer, no ratification field --------------------------------------------------------------

test("parseCentralClassificationFixture: accepts a fixture with no expiresOn or ratifiedBy, and ignores legacy copies of both -- neither field is enforced anywhere", () => {
  const minimal = JSON.stringify({ version: "1.0.0", centralLayer: { tools: [] }, knownConnectors: [] });
  const parsedMinimal = parseCentralClassificationFixture(minimal);
  assert.equal(parsedMinimal.version, "1.0.0");
  assert.deepEqual(parsedMinimal.knownConnectors, []);

  const legacy = JSON.stringify({
    version: "1.0.0",
    expiresOn: "2020-01-01",
    ratifiedBy: "docs/decisions.md, legacy",
    centralLayer: { tools: [] },
    knownConnectors: [],
  });
  const parsedLegacy = parseCentralClassificationFixture(legacy);
  assert.equal("expiresOn" in parsedLegacy, false, "a legacy expiresOn must not survive into the parsed fixture -- nothing may consume it");
  assert.equal("ratifiedBy" in parsedLegacy, false, "a legacy ratifiedBy must not survive into the parsed fixture");
});

// --- parseCentralClassificationFixture: malformed-input rejection (throws loudly, never silently
// drops a bad field -- same convention as builtin-tool-inventory.ts's parseBuiltinToolInventory) --

test("parseCentralClassificationFixture: rejects a centralLayer.tools entry with an invalid class value", () => {
  const json = JSON.stringify({
    version: "1.0.0",
    centralLayer: { tools: [{ name: "evil", class: "totally-safe-trust-me" }] },
    knownConnectors: [],
  });
  // The pattern names the offending field, not just "class": every error message here already
  // contains the file name "s5-central-classification.json", which would satisfy a bare /class/.
  assert.throws(() => parseCentralClassificationFixture(json), /centralLayer\.tools\[0\] needs a string "name" and a valid "class"/);
});

test("parseCentralClassificationFixture: rejects a non-string knownConnectors entry", () => {
  const json = JSON.stringify({
    version: "1.0.0",
    centralLayer: { tools: [] },
    knownConnectors: [{ name: "sneaky-object-not-a-string" }],
  });
  assert.throws(() => parseCentralClassificationFixture(json), /knownConnectors/);
});
