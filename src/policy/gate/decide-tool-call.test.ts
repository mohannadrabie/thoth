// Unit tests for the gate module (S7 plan section 7 "G": G1-G8, G10, G16, G17), story-implementer's
// own tests, written FAILING FIRST. The gate takes its loader and catalog as PORTS, so every
// verdict path is exercised in memory; G7 and G10 additionally run the REAL loader with injected
// file paths and an injected central source.
//
// NAMES: no committed classification-fixture entry name is typed here (G19); every server name is a
// stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideToolCall } from "./decide-tool-call.ts";
import type { GatePolicyResult, GatePorts, GateResult } from "./decide-tool-call.ts";
import type { Rule } from "../kernel/rule-types.ts";
import type { VerdictOutcome } from "../kernel/verdict.ts";
import type { MergedToolClassificationSet, ToolClass } from "../tools/classification.ts";
import { loadEffectivePolicy } from "../config/loader.ts";
import type { LoadFailureReasonKind, FailedLayerName } from "../config/loader.ts";
import type { CentralPolicySource } from "../config/central-source.ts";

const RO = "tool-class:read-only";
const RM = "tool-class:remote-mutating";
const WS = "tool-class:workspace-mutating";

function catalogOf(entries: [string, ToolClass][], layer: "central" | "shipped-defaults" = "central"): MergedToolClassificationSet {
  return { version: "0.0.0-test", tools: entries.map(([name, cls]) => ({ name, class: cls, sourceLayer: layer })) };
}

interface PortSpy extends GatePorts {
  policyCalls: number;
  catalogCalls: number;
}
function ports(opts: { rules?: Rule[]; defaultOutcome?: VerdictOutcome; catalog?: MergedToolClassificationSet; failure?: GatePolicyResult; catalogThrows?: boolean }): PortSpy {
  const spy: PortSpy = {
    policyCalls: 0,
    catalogCalls: 0,
    loadPolicy() {
      spy.policyCalls++;
      return opts.failure ?? { ok: true, ruleSet: { version: "0.0.0-test", rules: opts.rules ?? [] }, defaultOutcome: opts.defaultOutcome ?? "allow" };
    },
    loadCatalog() {
      spy.catalogCalls++;
      if (opts.catalogThrows === true) throw new Error("catalog exploded");
      return opts.catalog ?? catalogOf([]);
    },
  };
  return spy;
}
function call(toolName: unknown, toolInput: unknown, p: GatePorts): GateResult {
  return decideToolCall({ tool_name: toolName, tool_input: toolInput, session_id: "g-test" }, p);
}
function outcomeOf(r: GateResult): string {
  return r.kind === "verdict" ? r.verdict.outcome : `refusal:${r.category}`;
}
const GET = { command: "kubectl get pod/x --context=c" };
const DELETE = { command: "kubectl delete pods/x --context=c" };

// --- G1 ----------------------------------------------------------------------------------------

test("G1: loadPolicy failure table: each of the 3 reason kinds at each of the 3 layers denies (Bash and MCP); the reason names layer and kind and does not contain the raw message", () => {
  const kinds: Record<LoadFailureReasonKind, true> = { "json-parse-error": true, "schema-invalid": true, "read-error": true };
  const layers: Record<FailedLayerName, true> = { central: true, "shipped-defaults": true, project: true };
  for (const kind of Object.keys(kinds) as LoadFailureReasonKind[]) {
    for (const layer of Object.keys(layers) as FailedLayerName[]) {
      const failure = { ok: false, failedLayer: layer, reasonKind: kind, message: "RAW-LOADER-MESSAGE-CANARY /some/path" } as unknown as GatePolicyResult;
      for (const [tool, input] of [["Bash", GET], ["mcp__standin__x", {}]] as const) {
        const r = call(tool, input, ports({ failure, catalog: catalogOf([["standin", "read-only"]]) }));
        assert.equal(r.kind, "refusal", `${kind}/${layer}/${tool}`);
        if (r.kind !== "refusal") continue;
        assert.equal(r.category, "policy-load-failure");
        assert.ok(r.reason.includes(layer) && r.reason.includes(kind), `reason names layer and kind: ${r.reason}`);
        assert.ok(!r.reason.includes("CANARY") && !r.reason.includes("/some/path"), `reason must not carry the raw message: ${r.reason}`);
      }
    }
  }
});

// --- G2 ----------------------------------------------------------------------------------------

test("G2: loadCatalog throws for a tool-class call: the error propagates (the hook exits 2); a Bash call never loads the catalog", () => {
  assert.throws(() => call("mcp__standin__x", {}, ports({ catalogThrows: true })), /catalog exploded/);
  const p = ports({ catalogThrows: true });
  const r = call("Bash", GET, p);
  assert.equal(r.kind, "verdict");
  assert.equal(p.catalogCalls, 0, "the row for Bash says needsCatalog=false, so the catalog port is never called");
});

// --- G3 ----------------------------------------------------------------------------------------

test("G3: R3 at module level: same Bash action, injected posture deny denies, allow allows; the outcome comes from the port, not a constant", () => {
  assert.equal(outcomeOf(call("Bash", GET, ports({ defaultOutcome: "deny" }))), "deny");
  assert.equal(outcomeOf(call("Bash", GET, ports({ defaultOutcome: "allow" }))), "allow");
});

// --- G4 / G5 / G6 ------------------------------------------------------------------------------

test("G4: R1 flip, both directions, in memory: a test rule set authors class-keyed rules; per-class allow and deny rows for all 3 classes, and flipping one server's class flips its verdict", () => {
  const allowRoUnderDeny: Rule[] = [{ id: "allow-ro", effect: "allow", verbs: [RO] }];
  const denyRmUnderAllow: Rule[] = [{ id: "deny-rm-standin", effect: "deny", verbs: [RM], targets: ["mcp/standin/"] }];
  const classes: ToolClass[] = ["read-only", "workspace-mutating", "remote-mutating"];
  const underDeny: Record<ToolClass, string> = { "read-only": "allow", "workspace-mutating": "deny", "remote-mutating": "deny" };
  const underAllow: Record<ToolClass, string> = { "read-only": "allow", "workspace-mutating": "allow", "remote-mutating": "deny" };
  for (const cls of classes) {
    const catalog = catalogOf([["standin", cls]]);
    assert.equal(outcomeOf(call("mcp__standin__x", {}, ports({ rules: allowRoUnderDeny, defaultOutcome: "deny", catalog }))), underDeny[cls], `posture deny + allow read-only class: ${cls}`);
    assert.equal(outcomeOf(call("mcp__standin__x", {}, ports({ rules: denyRmUnderAllow, defaultOutcome: "allow", catalog }))), underAllow[cls], `posture allow + deny remote-mutating on the server: ${cls}`);
  }
  // the flip: the same tool, the same rules, only the class changes
  const rules: Rule[] = [{ id: "deny-rm-class", effect: "deny", verbs: [RM] }];
  assert.equal(outcomeOf(call("mcp__standin__x", {}, ports({ rules, catalog: catalogOf([["standin", "remote-mutating"]]) }))), "deny");
  assert.equal(outcomeOf(call("mcp__standin__x", {}, ports({ rules, catalog: catalogOf([["standin", "read-only"]]) }))), "allow");
});

test("G5: per-tool allow (marker verb plus exact target) allows one workspace-mutating tool while its sibling stays denied under posture deny", () => {
  const catalog = catalogOf([["standin", "workspace-mutating"]]);
  const rules: Rule[] = [{ id: "allow-one", effect: "allow", verbs: [WS], targets: ["mcp/standin/write_file"] }];
  assert.equal(outcomeOf(call("mcp__standin__write_file", {}, ports({ rules, defaultOutcome: "deny", catalog }))), "allow");
  assert.equal(outcomeOf(call("mcp__standin__delete_file", {}, ports({ rules, defaultOutcome: "deny", catalog }))), "deny");
});

test("G6: an explicit deny rule beats a class allow for a read-only tool (kernel deny-wins)", () => {
  const rules: Rule[] = [
    { id: "allow-ro-class", effect: "allow", verbs: [RO] },
    { id: "deny-that-server", effect: "deny", targets: ["mcp/standin/"], rationale: "G6-DENY" },
  ];
  const r = call("mcp__standin__x", {}, ports({ rules, defaultOutcome: "deny", catalog: catalogOf([["standin", "read-only"]]) }));
  assert.equal(outcomeOf(r), "deny");
  if (r.kind === "verdict") assert.equal(r.verdict.reason, "G6-DENY");
});

// --- G7 / G10 (real loader, injected paths) ----------------------------------------------------

function withDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "thoth-s7-gate-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function centralPresent(body: unknown): CentralPolicySource {
  return { read: () => ({ status: "present", raw: JSON.stringify(body), channel: "test-channel" }) };
}
function realPorts(shipped: string, project: string, central: CentralPolicySource, catalog: MergedToolClassificationSet): GatePorts {
  return {
    loadPolicy(): GatePolicyResult {
      const loaded = loadEffectivePolicy({ shippedDefaultsPath: shipped, projectPolicyPath: project, centralSource: central });
      if (!loaded.ok) return { ok: false, failedLayer: loaded.failedLayer, reasonKind: loaded.reasonKind };
      return { ok: true, ruleSet: { version: loaded.merged.version, rules: loaded.merged.rules }, defaultOutcome: loaded.defaultOutcome.outcome };
    },
    loadCatalog: () => catalog,
  };
}

test("G7: documenting (R-E): central posture deny plus a project allow RULE resolves posture deny/central and verdict allow through the real loader; a project redefinition of a shipped rule id with broader targets wins", () => {
  withDir((dir) => {
    const empty = join(dir, "empty.json");
    const project = join(dir, "project.json");
    writeFileSync(empty, JSON.stringify({ version: "1", rules: [] }));
    writeFileSync(project, JSON.stringify({ version: "1", rules: [{ id: "p-allow-get", effect: "allow", verbs: ["get"] }] }));
    const central = centralPresent({ version: "1", defaultOutcome: "deny", rules: [] });
    const p = realPorts(empty, project, central, catalogOf([]));
    assert.equal(outcomeOf(call("Bash", GET, p)), "allow", "the project allow RULE allows what the central posture denies");
    assert.equal(outcomeOf(call("Bash", DELETE, p)), "deny", "control: a call no rule matches falls to the central deny posture");

    // a project redefinition of a shipped rule id (shipped mandatory is inert) wins
    const shipped = join(dir, "shipped.json");
    const project2 = join(dir, "project2.json");
    writeFileSync(shipped, JSON.stringify({ version: "1", rules: [{ id: "shared-id", effect: "allow", verbs: ["get"], targets: ["never-matches/"], mandatory: true }] }));
    writeFileSync(project2, JSON.stringify({ version: "1", rules: [{ id: "shared-id", effect: "allow" }] }));
    const p2 = realPorts(shipped, project2, centralPresent({ version: "1", defaultOutcome: "deny", rules: [] }), catalogOf([]));
    assert.equal(outcomeOf(call("Bash", DELETE, p2)), "allow", "the redefined broader rule (project layer) wins over the shipped one");
  });
});

test("G10: a central mandatory deny keyed on a server identity (target only) is still denied after the fixture flips that server to read-only (real merge, real loader)", () => {
  withDir((dir) => {
    const empty = join(dir, "empty.json");
    const project = join(dir, "project.json");
    writeFileSync(empty, JSON.stringify({ version: "1", rules: [] }));
    writeFileSync(project, JSON.stringify({ version: "1", rules: [{ id: "project-allow-ro", effect: "allow", verbs: [RO] }] }));
    const central = centralPresent({ version: "1", rules: [{ id: "central-deny-standin", effect: "deny", mandatory: true, targets: ["mcp/standin/"] }] });
    for (const cls of ["remote-mutating", "read-only"] as ToolClass[]) {
      const p = realPorts(empty, project, central, catalogOf([["standin", cls]]));
      assert.equal(outcomeOf(call("mcp__standin__x", {}, p)), "deny", `class ${cls}: the identity-keyed central deny survives the flip`);
    }
    const other = realPorts(empty, project, central, catalogOf([["otherserver", "read-only"]]));
    assert.equal(outcomeOf(call("mcp__otherserver__x", {}, other)), "allow", "control: another read-only server is allowed by the project class rule");
  });
});

// --- G8 / G16 / G17 ----------------------------------------------------------------------------

test("G8: a Bash command that is missing or a non-string, a non-string tool_name, and a non-object input are refused", () => {
  const p = ports({});
  for (const input of [{}, { command: 5 }, { command: null }, undefined, null, "str"]) {
    const r = call("Bash", input, p);
    assert.equal(r.kind, "refusal", JSON.stringify(input));
    if (r.kind === "refusal") assert.equal(r.category, "malformed-input");
  }
  for (const name of [undefined, null, 5, {}, [], ""]) {
    const r = call(name, GET, p);
    assert.equal(r.kind, "refusal", JSON.stringify(name));
    if (r.kind === "refusal") assert.equal(r.category, "malformed-input");
  }
  for (const whole of [null, undefined, 3, "x", []]) {
    const r = decideToolCall(whole, p);
    assert.equal(r.kind, "refusal");
  }
});

test("G16: Bash is routed to the shell normalizer (PT-14c, kills M6): with Bash set to each of the 3 classes in the catalog, the record for kubectl delete is parsed and resolved (unresolved empty, verbs [delete]), identical across classes, and holds no marker", () => {
  const records: string[] = [];
  for (const cls of ["read-only", "workspace-mutating", "remote-mutating"] as ToolClass[]) {
    const catalog: MergedToolClassificationSet = { version: "v", tools: [{ name: "Bash", class: cls, sourceLayer: "central" }, { name: "Bash", class: cls, sourceLayer: "shipped-defaults" }] };
    const rules: Rule[] = [{ id: "deny-any-marker", effect: "deny", verbs: [RO, WS, RM] }];
    const r = call("Bash", DELETE, ports({ catalog, rules }));
    assert.equal(r.kind, "verdict");
    if (r.kind !== "verdict") continue;
    assert.equal(r.record.source, "parsed");
    assert.deepEqual(r.record.unresolved, []);
    assert.deepEqual(r.record.verbs, ["delete"]);
    assert.ok(!r.record.verbs.some((v) => v.startsWith("tool-class:")));
    assert.equal(r.verdict.outcome, "allow", "no marker rule can match a shell record");
    records.push(JSON.stringify(r.record));
  }
  assert.equal(new Set(records).size, 1, "the record is identical across the three classes");
});

test("G17: unroutable names are refused whatever the catalog holds, before any port is called: Write, Edit, Task, ToolSearch, Skill, PowerShell", () => {
  const names = ["Write", "Edit", "Task", "ToolSearch", "Skill", "PowerShell", "mcp_single_underscore"];
  const p = ports({ catalog: catalogOf(names.map((n): [string, ToolClass] => [n, "read-only"])) });
  for (const n of names) {
    const r = call(n, {}, p);
    assert.equal(r.kind, "refusal", n);
    if (r.kind === "refusal") assert.equal(r.category, "unroutable-tool");
  }
  assert.equal(p.policyCalls, 0);
  assert.equal(p.catalogCalls, 0);
});

// --- G21 (fix-now, red-team attack 2): an untrusted tool_name is never reflected unbounded ------

test("G21: the unroutable-tool and malformed-input deny reasons cap the interpolated tool_name at 512 characters with a visible truncation marker (a 400 KB name gave a 400 KB deny)", () => {
  const huge = "Z".repeat(400_000);
  const p = ports({});
  const cases: [string, unknown][] = [
    ["unroutable string", huge],
    ["object tool_name", { k: huge }],
    ["array tool_name", [huge]],
  ];
  for (const [label, name] of cases) {
    const r = call(name, {}, p);
    assert.equal(r.kind, "refusal", label);
    if (r.kind !== "refusal") continue;
    assert.ok(r.reason.length <= 900, `${label}: the reason must be bounded (got ${r.reason.length} chars)`);
    assert.match(r.reason, /\[truncated/, `${label}: the cap is visible in the reason`);
    assert.ok(!r.reason.includes("Z".repeat(600)), `${label}: no long run of the untrusted name survives`);
  }
  // controls: a short name is reflected whole, with no marker
  const short = call("Write", {}, p);
  assert.equal(short.kind, "refusal");
  if (short.kind === "refusal") {
    assert.ok(short.reason.includes('"Write"'));
    assert.ok(!short.reason.includes("[truncated"));
  }
});
