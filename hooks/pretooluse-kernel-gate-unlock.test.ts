// Story H (#308 X-11), hook level: a gate failure names its real unlock, by failure kind, from a closed table
// (docs/plans/s308-H-unlock-wording-phase1-2026-10-02.md, section 5). story-implementer's own tests, written
// failing first. Exit codes and stdout polarity are unchanged (H10): a refusal is exit 0 with a deny JSON; a
// catalog failure is exit 2 with empty stdout.
//
// NAMES. No committed fixture entry name is typed here (THOTH-ADR-0001 rule 1, G19): the lowering entry is
// derived at run time from the real built-in layer, the server name is read from the committed fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadBuiltinToolClassificationLayer } from "../src/policy/tools/builtin-tool-inventory.ts";
import { createGateSandbox, denyReason, describeRun, firstCommittedEntryName, readCommittedFixture, type GateRun, type GateSandbox } from "./test-support/gate-sandbox.ts";

const CATALOG_LINE = "Unlock: a human must fix the tool classification file through a reviewed pull request; retrying will not help.";
const PROJECT_LINE = "Unlock: a human must correct the project policy file through a reviewed change; retrying will not help.";
const BASH_GET = "kubectl get pod/x --context=c";

/** Plants one entry that shares a built-in's name and is LOWER than it (read-only), read from the layer at run time. */
function plantLoweringEntry(sb: GateSandbox): string {
  const lowered = loadBuiltinToolClassificationLayer().tools.find((t) => t.class !== "read-only");
  assert.ok(lowered !== undefined, "a built-in above read-only exists");
  sb.setEntries([...readCommittedFixture().centralLayer.tools, { name: lowered.name, class: "read-only" }]);
  return lowered.name;
}

function assertCatalogUnlock(run: GateRun, what: string): void {
  assert.equal(run.code, 2, `${what}: exit 2; got ${describeRun(run)}`);
  assert.equal(run.stdout, "", `${what}: stdout empty`);
  assert.equal(
    run.stderr,
    `pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2). ${CATALOG_LINE} Error type: ClassificationCatalogError\n`,
    `${what}: the catalog line, unmodified`,
  );
}

test("H1-lowering-entry-prints-classification-file-unlock: a lowering fixture entry on an MCP call prints the catalog unlock on stderr, exit 2, stdout empty", () => {
  const sb = createGateSandbox();
  plantLoweringEntry(sb);
  assertCatalogUnlock(sb.mcp(firstCommittedEntryName(), "x"), "lowering entry");
});

test("H1b-malformed-fixture-prints-classification-file-unlock: a malformed fixture prints the same line", () => {
  const sb = createGateSandbox();
  fs.writeFileSync(sb.fixturePath, "{ \"version\": \"v\", BROKEN-FIXTURE", "utf8");
  assertCatalogUnlock(sb.mcp(firstCommittedEntryName(), "x"), "malformed fixture");
});

test("H1c-catalog-unlock-does-not-misdirect: the catalog line never says retry the call or Node", () => {
  const sb = createGateSandbox();
  plantLoweringEntry(sb);
  const run = sb.mcp(firstCommittedEntryName(), "x");
  assert.equal(run.code, 2);
  assert.doesNotMatch(run.stderr, /retry the call|Node/i);
});

test("H1d-bash-unaffected-by-catalog-failure: a Bash call with the same lowering fixture never loads the catalog and is a silent allow", () => {
  const sb = createGateSandbox();
  plantLoweringEntry(sb);
  const run = sb.bash(BASH_GET);
  assert.equal(run.code, 0, describeRun(run));
  assert.equal(run.stdout, "", describeRun(run));
  assert.equal(run.stderr, "", describeRun(run));
});

test("H2-project-schema-invalid-deny-names-project-unlock: a schema-invalid project policy denies with the project unlock in the reason (exit 0, deny JSON)", () => {
  const sb = createGateSandbox();
  sb.writeProjectPolicy({ version: "v", rules: "not-an-array" });
  for (const run of [sb.bash(BASH_GET), sb.mcp(firstCommittedEntryName(), "x")]) {
    assert.equal(run.code, 0, describeRun(run));
    assert.equal(run.stderr, "", describeRun(run));
    assert.equal(denyReason(run), `policy load failed: layer project, kind schema-invalid; fail-closed. ${PROJECT_LINE}`);
  }
});

test("H3-no-path-stack-or-parser-text-in-unlock-paths: neither channel carries a path, a stack frame, the raw loader or parser text, or a class name", () => {
  const canary = "CANARY-ZQX-9917-DO-NOT-ECHO";
  const sb = createGateSandbox();
  sb.writeProjectPolicy(`{ "version": "v", "rules": [ ${canary} ] }`);
  const policyRun = sb.bash(BASH_GET);
  const sb2 = createGateSandbox();
  fs.writeFileSync(sb2.fixturePath, `{ "version": "v", ${canary}`, "utf8");
  const catalogRun = sb2.mcp(firstCommittedEntryName(), "x");
  for (const [run, box] of [[policyRun, sb], [catalogRun, sb2]] as const) {
    const text = `${run.stdout}\n${run.stderr}`;
    for (const term of [canary, box.root, box.fixturePath, box.projectPolicyPath, "\n    at ", "SyntaxError", "Unexpected token", "read-only", "workspace-mutating", "remote-mutating"]) {
      assert.ok(!text.includes(term), `leaks ${JSON.stringify(term)}: ${describeRun(run)}`);
    }
  }
});

test("H4b-unknown-error-name-falls-back-to-generic (hook level): an unparseable payload keeps the generic stderr line", () => {
  const sb = createGateSandbox();
  const run = sb.run("this is not json");
  assert.equal(run.code, 2, describeRun(run));
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /Unlock: retry the call; if it fails again a human must repair the gate hook/);
  assert.doesNotMatch(run.stderr, /classification file/);
});

test("H1e-builtin-inventory-failure-prints-classification-file-unlock: a corrupt and a missing built-in inventory (temp copy) print the catalog unlock, exit 2, stdout empty", () => {
  const corrupt = createGateSandbox();
  fs.writeFileSync(path.join(corrupt.root, "docs", "qa", "tool-inventory.json"), "{ not json", "utf8");
  assertCatalogUnlock(corrupt.mcp(firstCommittedEntryName(), "x"), "corrupt built-in inventory");
  const missing = createGateSandbox();
  fs.rmSync(path.join(missing.root, "docs", "qa", "tool-inventory.json"));
  assertCatalogUnlock(missing.mcp(firstCommittedEntryName(), "x"), "missing built-in inventory");
});
