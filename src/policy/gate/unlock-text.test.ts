// Story H (#308 X-11): the gate-side unlock wording. story-implementer's own tests, written failing first
// (docs/plans/s308-H-unlock-wording-phase1-2026-10-02.md, section 5). The tables under test are closed
// data plus total functions: no free text, path or stack can reach them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FailedLayerName, LoadFailureReasonKind } from "../config/loader.ts";
import { sanitizeForTerminal } from "../config/sanitize.ts";
import { CATALOG_ERROR_NAME, ClassificationCatalogError } from "../tools/classification-catalog.ts";
import { CATALOG_FAILURE_ERROR_NAME, GENERIC_UNLOCK, boundedLayerName, boundedReasonKind, hookFailureUnlock, policyLoadUnlock } from "./unlock-text.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(HERE, "..", "..", "..", "hooks", "pretooluse-kernel-gate.mjs");

// Compile-time exhaustiveness: adding a layer or kind to the loader's enum makes these fail to typecheck,
// so the run-time lists below are never typed by hand against the loader.
const LAYERS: Record<FailedLayerName, true> = { central: true, "shipped-defaults": true, project: true };
const KINDS: Record<LoadFailureReasonKind, true> = { "json-parse-error": true, "schema-invalid": true, "read-error": true };
const layerNames = Object.keys(LAYERS) as FailedLayerName[];
const kindNames = Object.keys(KINDS) as LoadFailureReasonKind[];

test("H2c-central-unlock-is-out-of-session: the central layer names the central policy owner and an out-of-session fix, not a reviewed change", () => {
  const text = policyLoadUnlock("central");
  assert.match(text, /central policy owner/);
  assert.match(text, /outside this session/);
  assert.doesNotMatch(text, /reviewed change/);
});

test("H2-layer-texts: project and shipped-defaults name their own file and a reviewed change", () => {
  assert.match(policyLoadUnlock("project"), /^Unlock: a human must correct the project policy file through a reviewed change; retrying will not help\.$/);
  assert.match(policyLoadUnlock("shipped-defaults"), /^Unlock: a human must correct the shipped-defaults policy file through a reviewed change; retrying will not help\.$/);
});

test("H4-unknown-layer-falls-back-to-generic-and-is-bounded: any value outside the closed layer or kind set maps to the generic line and prints as unknown", () => {
  for (const odd of ["x\u001b[2J", "", "Project", 42, undefined, null, {}, ["project"]]) {
    assert.equal(policyLoadUnlock(odd), GENERIC_UNLOCK, `layer ${JSON.stringify(odd)}`);
    assert.equal(boundedLayerName(odd), "unknown", `layer ${JSON.stringify(odd)}`);
    assert.equal(boundedReasonKind(odd), "unknown", `kind ${JSON.stringify(odd)}`);
  }
});

test("H4b-unknown-error-name-falls-back-to-generic: only the catalog error name selects the catalog line", () => {
  const hostile = { get name(): string { throw new Error("getter must not be called by the table"); } };
  for (const odd of ["Error", "TypeError", "SyntaxError", "", "classificationcatalogerror", `${CATALOG_FAILURE_ERROR_NAME}x`, 5, undefined, null, hostile]) {
    assert.equal(hookFailureUnlock(odd), GENERIC_UNLOCK, `name of type ${typeof odd}`);
  }
  assert.notEqual(hookFailureUnlock(CATALOG_FAILURE_ERROR_NAME), GENERIC_UNLOCK);
  assert.match(hookFailureUnlock(CATALOG_FAILURE_ERROR_NAME), /^Unlock: a human must fix the tool classification file through a reviewed pull request; retrying will not help\.$/);
  assert.match(CATALOG_FAILURE_ERROR_NAME, /^[A-Za-z]{1,40}$/, "the hook's stderr accepts only letters-only error names up to 40");
});

test("H7-tables-are-closed-total-and-single-line: every layer and kind of the loader's enums is covered, with a distinct non-generic text per layer", () => {
  console.log(`H7 instrument: ${String(layerNames.length)} layers x ${String(kindNames.length)} kinds derived from the loader's exported types`);
  assert.ok(layerNames.length > 0 && kindNames.length > 0);
  const seen = new Set<string>();
  for (const layer of layerNames) {
    const text = policyLoadUnlock(layer);
    assert.notEqual(text, GENERIC_UNLOCK, `layer ${layer} has its own text`);
    seen.add(text);
    assert.equal(boundedLayerName(layer), layer);
  }
  assert.equal(seen.size, layerNames.length, "no two layers share a text");
  for (const kind of kindNames) assert.equal(boundedReasonKind(kind), kind);
  const all = [GENERIC_UNLOCK, hookFailureUnlock(CATALOG_FAILURE_ERROR_NAME), ...layerNames.map((l) => policyLoadUnlock(l))];
  for (const text of all) {
    assert.ok(text.length > 0);
    assert.match(text, /^Unlock: [\x20-\x7e]+$/, `printable ASCII on one line: ${text}`);
    assert.doesNotMatch(text, /read-only|workspace-mutating|remote-mutating/, "no classification class name");
    assert.doesNotMatch(text, /[\\/]|\bat \w/, "no path or stack frame");
  }
});

test("H8-hook-generic-unlock-in-sync: the hook's own literal UNLOCK equals GENERIC_UNLOCK", () => {
  const source = readFileSync(HOOK_PATH, "utf8");
  const m = /^const UNLOCK = "([^"\n]*)";$/m.exec(source);
  assert.ok(m !== null, "the hook defines exactly one `const UNLOCK = \"...\";` literal");
  assert.equal(m[1], GENERIC_UNLOCK);
});

test("H9-unlock-strings-survive-sanitizer-unchanged: every table string is unchanged by sanitizeForTerminal and non-empty", () => {
  const all = [GENERIC_UNLOCK, hookFailureUnlock(CATALOG_FAILURE_ERROR_NAME), ...layerNames.map((l) => policyLoadUnlock(l))];
  for (const text of all) {
    const cleaned = sanitizeForTerminal(text);
    assert.ok(cleaned.length > 0);
    assert.equal(cleaned, text);
  }
});

test("H11-catalog-error-name-in-sync: the typed error the catalog throws carries the name the unlock table keys on", () => {
  assert.equal(CATALOG_ERROR_NAME, CATALOG_FAILURE_ERROR_NAME);
  assert.equal(new ClassificationCatalogError("x").name, CATALOG_FAILURE_ERROR_NAME);
  assert.notEqual(hookFailureUnlock(new ClassificationCatalogError("x").name), GENERIC_UNLOCK);
});
