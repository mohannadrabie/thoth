// #308 story E review condition (Issue #413): the fixture notes and the gate hook header must not claim that no shipped
// rule matches a class, now that the read-only class allow ships (story E). The "matches none today" claim is DERIVED
// here from the fixture entries and the shipped rules, not typed: if an entry ever gets the read-only class, the
// "matches none" wording must go. written FAILING FIRST against the stale wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLASS_MARKER_VERBS } from "../normalizer/tool-class-format.ts";
import { moduleRelativeFixtureLocation } from "./classification-catalog.ts";
import type { ToolClass } from "./classification.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("fixture-notes-do-not-claim-no-shipped-class-rule: the fixture notes and the gate hook header describe the shipped class rule truthfully, and 'matches none' is derived", () => {
  const fixture = JSON.parse(readFileSync(moduleRelativeFixtureLocation().fixturePath, "utf8")) as { notes: string[]; centralLayer: { tools: { class: ToolClass }[] } };
  const notes = fixture.notes.join("\n");
  const header = readFileSync(`${ROOT}hooks/pretooluse-kernel-gate.mjs`, "utf8").split("\n").slice(0, 25).join("\n");
  const shipped = JSON.parse(readFileSync(`${ROOT}src/policy/config/shipped-defaults.json`, "utf8")) as { rules: { id: string; effect: string; verbs?: string[] }[] };
  const classAllows = shipped.rules.filter((r) => r.effect === "allow" && (r.verbs ?? []).some((v) => v.startsWith("tool-class:")));
  assert.ok(classAllows.length > 0, "a shipped class allow rule exists (story E), so 'no shipped rule matches a class' is false");

  for (const [label, text] of [["fixture notes", notes], ["gate hook header", header]] as const) {
    assert.doesNotMatch(text, /no shipped (policy )?rule matches a class/i, `${label} still says no shipped rule matches a class`);
    assert.doesNotMatch(text, /baseline allow content \(nothing denies/i, `${label} still lists baseline allow content as unmet`);
    for (const r of classAllows) assert.match(text, new RegExp(r.id), `${label} names the shipped class rule ${r.id}`);
  }

  const matched = fixture.centralLayer.tools.filter((t) => classAllows.some((r) => (r.verbs ?? []).includes(CLASS_MARKER_VERBS[t.class]))).length;
  const claimsNone = /matches none of the committed entries/i;
  if (matched === 0) assert.match(notes, claimsNone, "no committed entry has a class a shipped allow matches, and the notes say so");
  else assert.doesNotMatch(notes, claimsNone, `${String(matched)} committed entr(ies) match a shipped class rule, so 'matches none' is false`);
});

test("header-names-withheld-bash-allow (Issue #422): the gate hook header names the Bash baseline allow as still unmet and points at E0 (#408)", () => {
  const header = readFileSync(`${ROOT}hooks/pretooluse-kernel-gate.mjs`, "utf8").split(String.fromCharCode(10)).slice(0, 25).join(String.fromCharCode(10));
  assert.match(header, /Bash baseline allow[^.]*unmet[^.]*E0[^.]*#408/is, "header says the Bash baseline allow is unmet (E0, #408)");
});
