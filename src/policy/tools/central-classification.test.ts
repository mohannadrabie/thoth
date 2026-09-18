// Regression tests for src/policy/tools/central-classification.ts (S5 Stage-3 CRITICAL review
// round 1 fix-now, `story-implementer`'s own unit tests -- no test-writer dispatch this pass, per
// this project's own "no new UI/API surface" test-first carve-out). `story-implementer`'s own tests
// (this module is a pure internal data-loading contract, not an externally-observable surface).
//
// AC1 (revised): "Both allowlists live in one committed JSON fixture ... pinned by a regression
// test per allowlist." Named test cases below:
//   - "AC1-a: the committed centralLayer.tools fixture is pinned exactly" (red-team's F1/F10 named
//     proof-test, centralLayer half)
//   - "AC1-b: the committed knownConnectors fixture is pinned exactly" (red-team's F1/F10 named
//     proof-test, KNOWN_CONNECTORS half)
//   - "AC1-c: the committed fixture's expiresOn is still in the future" (fails the build once due,
//     per red-team's own required test text)
//   - isFixtureExpired()'s own boundary behavior, independent of the real committed fixture's date
//   - parseCentralClassificationFixture()'s own malformed-input rejection (mirrors
//     builtin-tool-inventory.ts's own established "throw loudly, never silently drop" convention)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCentralClassificationFixture,
  loadCentralClassificationFixture,
  isFixtureExpired,
} from "./central-classification.ts";

// --- AC1-a/b/c: the real committed fixture, pinned exactly ---------------------------------------

test("AC1-a: the committed centralLayer.tools fixture is pinned exactly -- any edit to this list must be a diff to docs/qa/s5-central-classification.json, never a hook-file edit", () => {
  const fixture = loadCentralClassificationFixture();
  assert.deepEqual(
    fixture.centralLayer.tools,
    [
      { name: "github", class: "remote-mutating" },
      { name: "aws-mcp-server", class: "remote-mutating" },
      { name: "aws-knowledge-mcp-server", class: "remote-mutating" },
      { name: "aws-api-mcp-server", class: "remote-mutating" },
      { name: "terraform", class: "remote-mutating" },
      { name: "playwright", class: "remote-mutating" },
    ],
    "centralLayer.tools drifted from the pinned, reviewed fixture contents -- update this test deliberately if the fixture was intentionally revised (with its own review), never silently",
  );
});

test("AC1-b: the committed knownConnectors fixture is pinned exactly -- any edit to this list must be a diff to docs/qa/s5-central-classification.json, never a hook-file edit", () => {
  const fixture = loadCentralClassificationFixture();
  assert.deepEqual(
    fixture.knownConnectors,
    [
      "claude.ai Gmail",
      "claude.ai Excalidraw",
      "claude.ai Google Drive",
      "claude.ai Google Calendar",
      "claude.ai Adobe for creativity",
      "claude.ai Canva",
      "claude.ai Spotify",
      "claude.ai Claude Docs",
    ],
    "knownConnectors drifted from the pinned, reviewed fixture contents -- a NEW entry here requires a fresh, dated, human-ratified docs/decisions.md row, never a silent addition",
  );
});

test("AC1-c: the committed fixture's expiresOn is still in the future -- this test fails the build once the exemption's ratified window has passed, forcing a human re-ratify-or-remove decision", () => {
  const fixture = loadCentralClassificationFixture();
  assert.equal(
    isFixtureExpired(fixture, new Date()),
    false,
    `docs/qa/s5-central-classification.json's expiresOn (${fixture.expiresOn}) has passed -- re-ratify with a fresh docs/decisions.md row and a new expiresOn, or remove the exemption; do not silently roll it forward`,
  );
});

// S5 Stage-3 CRITICAL review round 2 fix-now, mandatory boundary-crossing proof-test (`red-team`
// N2 / `design-challenger`'s Stop Brief / GitHub Issue #100): AC1-c above only pins the SHAPE of
// expiresOn ("some future date"), not its VALUE -- red-team demonstrated that rolling
// expiresOn from "2026-10-07" to "2099-01-01" left the full 543-test suite and all 4 qa gates
// green, silently defeating the "never silently rolled forward" forced-renewal property the
// human's 2026-09-07 ratification explicitly rests on. This test pins the EXACT ratified value,
// deepEqual-style, at the same bar as AC1-a/AC1-b's exact allowlist pins -- extending the
// exemption by even one day requires a deliberate edit to THIS assertion, together with a fresh,
// dated docs/decisions.md re-ratification row, never a silent fixture-only edit.
test("S5-R2-N2: the committed fixture's expiresOn is pinned to the EXACT ratified date, not merely 'some future date' -- rolling it forward (by one day or one century) must fail this test, forcing the same re-ratify-or-remove decision AC1-c's shape-only check cannot catch", () => {
  const fixture = loadCentralClassificationFixture();
  assert.equal(
    fixture.expiresOn,
    "2026-10-07",
    `docs/qa/s5-central-classification.json's expiresOn (${fixture.expiresOn}) drifted from the exact date ratified in docs/decisions.md's 2026-09-07 row -- a NEW expiresOn requires a fresh, dated, human-ratified decisions.md row AND a deliberate edit to this assertion together, never a silent fixture-only extension`,
  );
});

test("AC1: the committed fixture names its own ratifying decision (never a bare, unattributed exemption)", () => {
  const fixture = loadCentralClassificationFixture();
  assert.match(fixture.ratifiedBy, /decisions\.md/, "the fixture must cite the docs/decisions.md row that ratified this exemption");
});

// --- isFixtureExpired: boundary behavior, independent of the real fixture's own date -------------

test("isFixtureExpired: false the instant before the expiry date (UTC midnight boundary)", () => {
  const fixture = { expiresOn: "2026-10-07" };
  assert.equal(isFixtureExpired(fixture, new Date("2026-10-06T23:59:59.999Z")), false);
});

test("isFixtureExpired: true exactly at the expiry date's UTC midnight, and true after it -- 'expiresOn' is a hard boundary, not a grace window", () => {
  const fixture = { expiresOn: "2026-10-07" };
  assert.equal(isFixtureExpired(fixture, new Date("2026-10-07T00:00:00.000Z")), true);
  assert.equal(isFixtureExpired(fixture, new Date("2026-10-08T00:00:00.000Z")), true);
});

test("isFixtureExpired: a local-timezone 'now' just before UTC midnight on the expiry date is NOT yet expired -- comparison is UTC-anchored, not local-timezone-anchored (see this file's own header comment on the earlier UTC/local date mix-up this diff's draft made)", () => {
  const fixture = { expiresOn: "2026-10-07" };
  // 2026-10-06T20:00:00-04:00 == 2026-10-07T00:00:00.000Z exactly -- still not >= expiry.
  assert.equal(isFixtureExpired(fixture, new Date("2026-10-06T19:59:59-04:00")), false);
});

// --- parseCentralClassificationFixture: malformed-input rejection (throws loudly, never silently
// drops a bad field -- same convention as builtin-tool-inventory.ts's parseBuiltinToolInventory) --

test("parseCentralClassificationFixture: rejects a fixture missing 'expiresOn'", () => {
  const json = JSON.stringify({ version: "1.0.0", ratifiedBy: "x", centralLayer: { tools: [] }, knownConnectors: [] });
  assert.throws(() => parseCentralClassificationFixture(json), /expiresOn/);
});

test("parseCentralClassificationFixture: rejects a fixture whose 'expiresOn' isn't YYYY-MM-DD shaped", () => {
  const json = JSON.stringify({
    version: "1.0.0",
    expiresOn: "not-a-date",
    ratifiedBy: "x",
    centralLayer: { tools: [] },
    knownConnectors: [],
  });
  assert.throws(() => parseCentralClassificationFixture(json), /expiresOn/);
});

test("parseCentralClassificationFixture: rejects a fixture missing 'ratifiedBy' (an exemption fixture must always cite its own ratification)", () => {
  const json = JSON.stringify({ version: "1.0.0", expiresOn: "2099-01-01", centralLayer: { tools: [] }, knownConnectors: [] });
  assert.throws(() => parseCentralClassificationFixture(json), /ratifiedBy/);
});

test("parseCentralClassificationFixture: rejects a centralLayer.tools entry with an invalid class value", () => {
  const json = JSON.stringify({
    version: "1.0.0",
    expiresOn: "2099-01-01",
    ratifiedBy: "x",
    centralLayer: { tools: [{ name: "evil", class: "totally-safe-trust-me" }] },
    knownConnectors: [],
  });
  assert.throws(() => parseCentralClassificationFixture(json), /class/);
});

test("parseCentralClassificationFixture: rejects a non-string knownConnectors entry", () => {
  const json = JSON.stringify({
    version: "1.0.0",
    expiresOn: "2099-01-01",
    ratifiedBy: "x",
    centralLayer: { tools: [] },
    knownConnectors: [{ name: "sneaky-object-not-a-string" }],
  });
  assert.throws(() => parseCentralClassificationFixture(json), /knownConnectors/);
});
