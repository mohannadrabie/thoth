// Unit tests for the tool-class normalizer and its grammar module (S7, story-implementer's own
// tests, written FAILING FIRST; plan docs/plans/s7-kernel-gate-classification-phase1-2026-09-26.md
// section 7 "N"). Internal pure functions, not an externally observable surface, so no
// test-writer dispatch (the hook and printer surfaces are test-writer's).
//
// NAMES: no committed classification-fixture entry name is typed here (PC-11, G19,
// THOTH-ADR-0001 rule 1). Committed names are read from the fixture at run time; every other name
// is a stand-in ("docs", "my server", ...).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalize, resolveNormalizer } from "./registry.ts";
import "./shell.ts";
import "./structured-cluster.ts";
import "./tool-class.ts";
import { KNOWN_VERBS } from "./action-catalog.ts";
import {
  CLASS_MARKER_VERBS,
  GRAMMAR_VERSION,
  buildServerIndex,
  parseMcpToolName,
  sanitizeMcpName,
} from "./tool-class-format.ts";
import { decide } from "../kernel/kernel.ts";
import type { WorldFacts } from "../kernel/kernel.ts";
import { isActionRecord } from "../kernel/action-record.ts";
import type { ActionRecord } from "../kernel/action-record.ts";
import type { Rule } from "../kernel/rule-types.ts";
import type { MergedToolClassificationSet, ToolClass } from "../tools/classification.ts";
import { parseCentralClassificationFixture } from "../tools/central-classification.ts";
import { mergeToolClassificationLayers } from "../rule/precedence.ts";
import { loadBuiltinToolClassificationLayer } from "../tools/builtin-tool-inventory.ts";
import * as corpus from "../fixtures/normalizer-calls.ts";

const FIXTURE_PATH = new URL("../../../docs/qa/s5-central-classification.json", import.meta.url);

function catalogOf(entries: [string, ToolClass][]): MergedToolClassificationSet {
  return { version: "0.0.0-test", tools: entries.map(([name, cls]) => ({ name, class: cls, sourceLayer: "central" as const })) };
}

function callTool(toolName: unknown, catalog: unknown): ActionRecord {
  return normalize("tool-class", { toolName, catalog, environment: "unknown", identity: "n-test", deferred: false });
}

function worldOf(rules: Rule[], defaultOutcome: "allow" | "deny"): WorldFacts {
  return { rules: { version: "0.0.0-test", rules }, defaultOutcome };
}

const MARKER_RO = "tool-class:read-only";

// --- N1 ----------------------------------------------------------------------------------------

test("N1: the marker table is a Record<ToolClass, string> (compile-time exhaustive; `npm run typecheck` is the instrument) and holds exactly the three planned markers", () => {
  const table: Record<ToolClass, string> = CLASS_MARKER_VERBS;
  assert.deepEqual(table, {
    "read-only": "tool-class:read-only",
    "workspace-mutating": "tool-class:workspace-mutating",
    "remote-mutating": "tool-class:remote-mutating",
  });
  assert.equal(resolveNormalizer("tool-class") !== undefined, true, "the tool-class normalizer registers itself by declaration");
});

// --- N2 ----------------------------------------------------------------------------------------

test("N2: unclassified, non-mcp or absent-from-index: source opaque, unresolved non-empty; composed with decide() and an allow-everything rule set: deny by POL-05", () => {
  const allowAll: Rule[] = [{ id: "allow-everything", effect: "allow" }];
  const cat = catalogOf([["docs", "read-only"]]);
  for (const name of ["mcp__nosuch__x", "Read", "", "mcp__docs"]) {
    const rec = callTool(name, cat);
    assert.equal(rec.source, "opaque", `${JSON.stringify(name)}: source`);
    assert.ok(rec.unresolved.length > 0, `${JSON.stringify(name)}: unresolved non-empty`);
    assert.deepEqual(rec.verbs, []);
    assert.deepEqual(rec.targets, []);
    const verdict = decide(worldOf(allowAll, "allow"), rec);
    assert.equal(verdict.outcome, "deny", `${JSON.stringify(name)}: an opaque record is denied even with an allow-everything rule`);
    assert.equal(verdict.ruleId, "POL-05");
  }
});

// --- N3 / N3b ----------------------------------------------------------------------------------

test("N3: exact match only: index holds docs; mcp__docs__x resolves; mcp__docs___x and mcp__docs__evil__x are unresolved", () => {
  const cat = catalogOf([["docs", "read-only"]]);
  const ok = callTool("mcp__docs__x", cat);
  assert.equal(ok.source, "structured");
  assert.deepEqual(ok.verbs, [MARKER_RO]);
  assert.deepEqual(ok.targets, ["mcp/docs/x"]);
  for (const name of ["mcp__docs___x", "mcp__docs__evil__x"]) {
    const rec = callTool(name, cat);
    assert.equal(rec.source, "opaque", name);
    assert.ok(rec.unresolved.length > 0, name);
  }
});

test("N3b: lookup exactness (PT-14b, kills M7): servers docs-evil, docsevil, docs2 and a proper prefix of a hyphenated entry are unresolved; a lookup by prefix or longest match would resolve them", () => {
  const cat = catalogOf([
    ["docs", "read-only"],
    ["alpha-beta-gamma", "remote-mutating"],
  ]);
  for (const name of ["mcp__docs-evil__x", "mcp__docsevil__x", "mcp__docs2__x", "mcp__doc__x", "mcp__alpha-beta__x", "mcp__alpha__x", "mcp__alpha-beta-gamma-delta__x"]) {
    const rec = callTool(name, cat);
    assert.equal(rec.source, "opaque", `${name} must not be classified by a neighbouring entry`);
  }
  assert.equal(callTool("mcp__alpha-beta-gamma__x", cat).source, "structured", "control: the exact server resolves");
});

// --- N4 / N4b ----------------------------------------------------------------------------------

test("N4: charset admission (PT-13 ruling): only names solely [A-Za-z0-9-] are admitted; the rest are rejected with a reason and their tools are unresolved; the real committed fixture has an empty rejected list", () => {
  const bad = ["my server", "my_server", "my.server", "a:b", "docs_", "docs__evil", "_a", "a_", "", "Some_Name", "a b"];
  const entries: [string, ToolClass][] = bad.map((n) => [n, "read-only"]);
  entries.push(["docs", "read-only"], ["a-b", "workspace-mutating"]);
  const index = buildServerIndex(catalogOf(entries));
  assert.deepEqual([...index.byName.keys()].sort(), ["a-b", "docs"]);
  assert.deepEqual(index.rejected.map((r) => r.name).sort(), [...bad].sort());
  for (const r of index.rejected) assert.ok(r.reason.length > 0, `rejected ${JSON.stringify(r.name)} carries a reason`);

  // tools of a rejected entry are unresolved
  const cat = catalogOf([["my server", "read-only"], ["my_server", "read-only"]]);
  assert.equal(callTool("mcp__my_server__x", cat).source, "opaque", "'my server' plus my_server collide (and both are rejected): unresolved");

  // built-in layer entries are never admitted, only sourceLayer central
  const mixed: MergedToolClassificationSet = {
    version: "v",
    tools: [
      { name: "builtin-like", class: "read-only", sourceLayer: "shipped-defaults" },
      { name: "central-one", class: "read-only", sourceLayer: "central" },
    ],
  };
  assert.deepEqual([...buildServerIndex(mixed).byName.keys()], ["central-one"]);

  // the REAL committed fixture: every entry admitted, nothing rejected (derived from the file, not typed)
  const fixture = parseCentralClassificationFixture(readFileSync(FIXTURE_PATH, "utf8"));
  const merged = mergeToolClassificationLayers(loadBuiltinToolClassificationLayer(), fixture.centralLayer);
  const real = buildServerIndex(merged);
  assert.deepEqual(real.rejected, [], "the committed fixture must contain only admissible names");
  assert.equal(real.byName.size, fixture.centralLayer.tools.length);
});

test("N4b: an unlisted server cannot inherit an entry (PT-13): runtime names generated by the sanitizer from space, dot and colon variants of a declared name are unresolved; a name mixing capitals and underscores is rejected and reported", () => {
  const cat = catalogOf([["my_server", "read-only"], ["Some_Name", "read-only"], ["docs-x", "read-only"]]);
  const index = buildServerIndex(cat);
  assert.deepEqual([...index.byName.keys()], ["docs-x"], "underscore entries are rejected");
  assert.deepEqual(index.rejected.map((r) => r.name).sort(), ["Some_Name", "my_server"]);
  for (const declared of ["my server", "my.server", "my:server", "my_server"]) {
    const runtime = `mcp__${sanitizeMcpName(declared)}__send`;
    assert.equal(callTool(runtime, cat).source, "opaque", `${runtime} (from declared ${JSON.stringify(declared)}) must not inherit an entry`);
  }
  assert.equal(sanitizeMcpName("a b.c:d-e_f"), "a_b_c_d-e_f");
});

// --- N5 / N6 / N7 ------------------------------------------------------------------------------

test("N5: ambiguous split: entry foo; mcp__foo__bar__x is unresolved (the tool segment contains __), and an entry named foo-bar cannot be reached through it", () => {
  const cat = catalogOf([["foo", "read-only"]]);
  assert.equal(callTool("mcp__foo__bar__x", cat).source, "opaque");
  assert.equal(parseMcpToolName("mcp__foo__bar__x"), undefined);
  assert.deepEqual(parseMcpToolName("mcp__foo__bar"), { server: "foo", tool: "bar" });
});

test("N6: a slash in the server or tool segment is unresolved", () => {
  const cat = catalogOf([["docs", "read-only"]]);
  assert.equal(callTool("mcp__docs__a/b", cat).source, "opaque");
  assert.equal(callTool("mcp__do/cs__x", cat).source, "opaque");
  assert.equal(parseMcpToolName("mcp__docs__a/b"), undefined);
});

test("N7: malformed raw (non-string toolName, missing catalog, unknown class string, non-object raw) returns opaque and never throws", () => {
  const cat = catalogOf([["docs", "read-only"]]);
  for (const bad of [undefined, null, 5, {}, []]) {
    const rec = callTool(bad, cat);
    assert.equal(rec.source, "opaque");
    assert.ok(isActionRecord(rec));
  }
  assert.equal(callTool("mcp__docs__x", undefined).source, "opaque");
  assert.equal(callTool("mcp__docs__x", { tools: "nope" }).source, "opaque");
  const weird = { version: "v", tools: [{ name: "docs", class: "not-a-class", sourceLayer: "central" }] };
  assert.equal(callTool("mcp__docs__x", weird).source, "opaque", "an unknown class string is unresolved, never a guessed marker");
  const proto = { version: "v", tools: [{ name: "docs", class: "constructor", sourceLayer: "central" }] };
  assert.equal(callTool("mcp__docs__x", proto).source, "opaque", "a prototype property name is not a class");
  for (const raw of [undefined, null, 5, "s"]) {
    const rec = normalize("tool-class", raw);
    assert.equal(rec.source, "opaque");
  }
});

// --- N8 ----------------------------------------------------------------------------------------

test("N8: the marker set is disjoint from every verb any other registered normalizer can emit (derived from KNOWN_VERBS plus the verbs the shell and cluster normalizers emit over the whole normalizer-calls corpus), and no marker is in KNOWN_VERBS", () => {
  const markers = Object.values(CLASS_MARKER_VERBS);
  const emitted = new Set<string>(KNOWN_VERBS);
  let shellCalls = 0;
  let clusterCalls = 0;
  for (const value of Object.values(corpus)) {
    if (typeof value !== "object" || value === null) continue;
    const v = value as unknown as Record<string, unknown>;
    let rec: ActionRecord | undefined;
    if (typeof v.command === "string") {
      rec = normalize("shell", v);
      shellCalls++;
    } else if (typeof v.verb === "string" && typeof v.resourceType === "string") {
      rec = normalize("cluster", v);
      clusterCalls++;
    }
    if (rec !== undefined) for (const verb of rec.verbs) emitted.add(verb);
  }
  assert.ok(shellCalls > 20 && clusterCalls >= 2, `the corpus walk must actually cover shell and cluster calls (shell=${shellCalls}, cluster=${clusterCalls})`);
  for (const m of markers) {
    assert.ok(!KNOWN_VERBS.has(m), `marker ${m} must not be in KNOWN_VERBS`);
    assert.ok(!emitted.has(m), `marker ${m} must not be emitted by any other normalizer`);
  }
});

// --- N9 / N9b ----------------------------------------------------------------------------------

const FORGERIES = [
  "python evil.py > mcp/docs/x",
  "echo x > mcp/docs/../../.thoth/policy.json",
  `kubectl ${MARKER_RO} pods/x --context=c`,
  `python evil.py > ${MARKER_RO}`,
];

function shellRecord(command: string): ActionRecord {
  return normalize("shell", { command, environment: "unknown", identity: "n-test", deferred: false });
}

test("N9: forgery on the shipped normalizer and kernel, path-scoped rule: under posture deny and allow verbs [marker] targets [mcp/docs/] every forged Bash call is denied; documenting: a TARGET-ONLY allow rule IS matched by a redirect (the rule-author constraint)", () => {
  const scoped: Rule[] = [{ id: "allow-docs-ro", effect: "allow", verbs: [MARKER_RO], targets: ["mcp/docs/"] }];
  for (const cmd of FORGERIES) {
    assert.equal(decide(worldOf(scoped, "deny"), shellRecord(cmd)).outcome, "deny", cmd);
  }
  const genuine = callTool("mcp__docs__x", catalogOf([["docs", "read-only"]]));
  assert.equal(decide(worldOf(scoped, "deny"), genuine).outcome, "allow", "control: the genuine record is reachable by the rule");
  const targetOnly: Rule[] = [{ id: "allow-docs-target-only", effect: "allow", targets: ["mcp/docs/"] }];
  assert.equal(decide(worldOf(targetOnly, "deny"), shellRecord("echo x > mcp/docs/x")).outcome, "allow", "DOCUMENTING: an allow rule keyed on an identity target alone is forgeable by a shell redirect; authors MUST pair it with the marker verb");
  const denyTargetOnly: Rule[] = [{ id: "deny-docs-target-only", effect: "deny", targets: ["mcp/docs/"] }];
  assert.equal(decide(worldOf(denyTargetOnly, "allow"), shellRecord("echo x > mcp/docs/x")).outcome, "deny", "a forged match on a deny rule only denies");
});

test("N9b: forgery, CLASS-ONLY rule (PT-14a, kills M5): posture deny, allow verbs [marker] with NO targets: Bash calls carrying the marker as a verb token are denied; a genuine read-only record is allowed", () => {
  const classOnly: Rule[] = [{ id: "allow-ro-class", effect: "allow", verbs: [MARKER_RO] }];
  for (const cmd of [`rm ${MARKER_RO} a/b --context=c`, `kubectl ${MARKER_RO} pods/x --context=c`, ...FORGERIES]) {
    assert.equal(decide(worldOf(classOnly, "deny"), shellRecord(cmd)).outcome, "deny", cmd);
  }
  const genuine = callTool("mcp__docs__x", catalogOf([["docs", "read-only"]]));
  assert.equal(decide(worldOf(classOnly, "deny"), genuine).outcome, "allow");
});

// --- N10 / N11 ---------------------------------------------------------------------------------

test("N10: built-in names never yield a class record: Write, Edit, Bash, Task, Read, ToolSearch are unresolved even when the catalog lists them", () => {
  const names = ["Write", "Edit", "Bash", "Task", "Read", "ToolSearch"];
  const cat = catalogOf(names.map((n): [string, ToolClass] => [n, "read-only"]));
  for (const n of names) assert.equal(callTool(n, cat).source, "opaque", n);
});

test("N11: determinism: the same call and catalog twice give an identical record and verdict", () => {
  const cat = catalogOf([["docs", "workspace-mutating"]]);
  const a = callTool("mcp__docs__x", cat);
  const b = callTool("mcp__docs__x", cat);
  assert.deepEqual(a, b);
  const w = worldOf([{ id: "d", effect: "deny", verbs: ["tool-class:workspace-mutating"] }], "allow");
  assert.deepEqual(decide(w, a), decide(w, b));
  assert.ok(isActionRecord(a));
  assert.equal(GRAMMAR_VERSION, "1");
});
