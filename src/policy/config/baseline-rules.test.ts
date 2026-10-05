// #308 story E (AP-1), THOTH-ADR-0003 hold: the shipped baseline rules ("read freely, protect the gate").
// story-implementer's own tests, written FAILING FIRST against the placeholder shipped-defaults.json
// (`rules: []`). Plan: docs/plans/s308-activation-EFJ-plan-2026-10-04.md section 6.
//
// Entry tests of AP-1, all against the REAL shipped-defaults.json loaded through the real loader:
//   PT-1   a shipped class allow cannot be forged by a shell target or a shell verb token.
//   PT-2   a read verb does not authorize a different binary (the shell normalizer's verb resolution is
//          tool-blind, R-8): no shipped rule may allow a shell record on a verb alone.
//   PT-12  a shipped rule that cannot match any emitted record is not silent: every shipped rule matches a
//          witness record, and the inert deny shapes are still load failures on top of the shipped layer.
//   E3     the resolved default outcome and its source with the shipped rules loaded.
//
// DEVIATION FROM THE RATIFIED E4 LIST (reported to the Manager): `baseline-allow-read-verbs` (allow, verbs
// read/list/describe/get) is NOT shipped. PT-2 fails for it (measured: `rm get pods/x --context=c` normalizes
// to verbs [get], so a verb-only allow authorizes any binary). PT2-mutant below proves the check has teeth.
// It returns when story E0 (#408) makes shell verb resolution binary-aware.
//
// NAMES: stand-in server names only (ADR-0003 rule 4, G19); no committed fixture entry name is typed here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEffectivePolicy, type LoadSuccess } from "./loader.ts";
import type { CentralPolicySource } from "./central-source.ts";
import { decide } from "../kernel/kernel.ts";
import type { WorldFacts } from "../kernel/kernel.ts";
import type { Rule } from "../kernel/rule-types.ts";
import type { ActionRecord } from "../kernel/action-record.ts";
import { normalize } from "../normalizer/registry.ts";
import "../normalizer/shell.ts";
import "../normalizer/tool-class.ts";
import { KNOWN_VERBS } from "../normalizer/action-catalog.ts";
import { CLASS_MARKER_VERBS } from "../normalizer/tool-class-format.ts";
import type { MergedToolClassificationSet, ToolClass } from "../tools/classification.ts";

const SHIPPED_PATH = fileURLToPath(new URL("./shipped-defaults.json", import.meta.url));
const EMPTY = JSON.stringify({ version: "0.0.0-empty", rules: [] });
const RO = CLASS_MARKER_VERBS["read-only"];
const WM = CLASS_MARKER_VERBS["workspace-mutating"];
const RM = CLASS_MARKER_VERBS["remote-mutating"];
const SERVER = "standin-docs";

/** Load the real shipped-defaults.json; project layer empty (or supplied), central absent. */
function loadShipped(projectText: string = EMPTY): ReturnType<typeof loadEffectivePolicy> {
  const root = mkdtempSync(join(tmpdir(), "thoth-e-baseline-"));
  try {
    const projectPath = join(root, "project.json");
    writeFileSync(projectPath, projectText, "utf8");
    const centralSource: CentralPolicySource = { read: () => ({ status: "absent" }) };
    return loadEffectivePolicy({ shippedDefaultsPath: SHIPPED_PATH, projectPolicyPath: projectPath, centralSource });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function loadedOk(): LoadSuccess {
  const r = loadShipped();
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r;
}

function shippedRules(): Rule[] {
  return loadedOk().merged.rules;
}

function world(rules: Rule[], defaultOutcome: "allow" | "deny"): WorldFacts {
  return { rules: { version: "0.0.0-test", rules }, defaultOutcome };
}

function shellRecord(command: string): ActionRecord {
  return normalize("shell", { command, environment: "unknown", identity: "e-test", deferred: false });
}

function toolRecord(toolName: string, cls: ToolClass): ActionRecord {
  const catalog: MergedToolClassificationSet = {
    version: "0.0.0-test",
    tools: [{ name: SERVER, class: cls, sourceLayer: "central" as const }],
  };
  return normalize("tool-class", { toolName, catalog, environment: "unknown", identity: "e-test", deferred: false });
}

const FORGERIES = [
  "python evil.py > mcp/standin-docs/x",
  "echo x > mcp/standin-docs/../../.thoth/policy.json",
  `kubectl ${RO} pods/x --context=c`,
  `rm ${RO} a/b --context=c`,
  `python evil.py > ${RO}`,
];

/** Binaries other than the kubectl-shaped tool, placed in the tool position (Issue #414: witnesses per derived verb).
 * Stand-in names; none is a fixture entry. */
const OTHER_BINARIES = ["rm", "curl", "python", "deltool"];

/** PT-2 as a function so the real rules and a seeded mutant are judged by the same check. */
function pt2Violations(rules: Rule[]): string[] {
  const bad: string[] = [];
  for (const verb of nonMutatingVerbs()) {
    for (const binary of OTHER_BINARIES) {
      const cmd = `${binary} ${verb} pods/x --context=c`;
      if (decide(world(rules, "deny"), shellRecord(cmd)).outcome === "allow") bad.push(cmd);
    }
  }
  return bad;
}

test("E-shape: the shipped baseline is exactly the ratified allow rule(s): class-only read-only allow, no target, no deny, no declared defaultOutcome", () => {
  const r = loadedOk();
  // Story F adds protect-* deny rules to the same file (activation-preconditions.test.ts owns them); E's baseline is the rest.
  const rules = (r.merged.rules as Rule[]).filter((x) => !x.id.startsWith("protect-"));
  assert.deepEqual(
    rules.map((x) => x.id),
    ["baseline-allow-class-read-only"],
  );
  const rule = rules[0]!;
  assert.equal(rule.effect, "allow");
  assert.deepEqual(rule.verbs, [RO]);
  assert.ok(rule.targets === undefined || rule.targets.length === 0, "marker-only allow carries no target (V4)");
  assert.ok(rules.every((x) => x.effect === "allow"), "no deny rule ships in story E");
  const raw = JSON.parse(readFileSync(SHIPPED_PATH, "utf8")) as Record<string, unknown>;
  assert.equal("defaultOutcome" in raw, false, "defaultOutcome stays undeclared (Manager ruling 2026-10-04)");
});

test("PT-1: with the shipped rules under posture deny, no Bash forgery of the read-only class is allowed; the genuine class record is; the other two classes are not authorized", () => {
  const rules = shippedRules();
  for (const cmd of FORGERIES) {
    assert.equal(decide(world(rules, "deny"), shellRecord(cmd)).outcome, "deny", cmd);
  }
  assert.equal(decide(world(rules, "deny"), toolRecord(`mcp__${SERVER}__x`, "read-only")).outcome, "allow", "control: genuine read-only record");
  for (const [cls, marker] of [["workspace-mutating", WM], ["remote-mutating", RM]] as const) {
    const rec = toolRecord(`mcp__${SERVER}__x`, cls);
    assert.deepEqual(rec.verbs, [marker]);
    assert.equal(decide(world(rules, "deny"), rec).outcome, "deny", `${cls} is not explicitly authorized`);
  }
});

test("PT-2: with the shipped rules under posture deny, a read verb in another binary's command is not allowed (verb resolution is tool-blind)", () => {
  assert.deepEqual(pt2Violations(shippedRules()), []);
});

/** Non-mutating verbs, derived (Issue #414): the verbs of KNOWN_VERBS the kernel itself does not treat as mutating
 * (an opaque record is denied by POL-05 only when a verb is mutating). Nothing is typed here. */
function nonMutatingVerbs(): string[] {
  return [...KNOWN_VERBS].filter((v) => {
    const rec: ActionRecord = { source: "opaque", verbs: [v], targets: [], environment: "e", identity: "i", deferred: false, unresolved: [] };
    return decide(world([], "allow"), rec).outcome === "allow";
  });
}

test("PT2-mutant: for EACH non-mutating verb, a verb-only allow on that verb alone is flagged by the PT-2 check (the check has teeth per verb; Issue #414)", () => {
  const verbs = nonMutatingVerbs();
  assert.ok(verbs.includes("read") && verbs.length >= 2, `derived non-mutating verbs: ${verbs.join(",")}`);
  const missed: string[] = [];
  for (const v of verbs) {
    const mutant: Rule[] = [{ id: `mutant-allow-only-${v}`, effect: "allow", verbs: [v] }];
    if (pt2Violations(mutant).length === 0) missed.push(v);
  }
  assert.deepEqual(missed, [], "a verb-only allow on one verb authorizes another binary's command and PT-2 must see it");
  const all: Rule[] = [{ id: "mutant-allow-read-verbs", effect: "allow", verbs: verbs }];
  assert.ok(pt2Violations(all).length > 0);
});

test("PT-12: every shipped rule matches a witness record (none is silently inert); a shipped rule set that matches nothing fails", () => {
  const rules = shippedRules().filter((x) => x.effect === "allow");
  assert.ok(rules.length > 0, "the shipped baseline is not empty");
  const witness = toolRecord(`mcp__${SERVER}__x`, "read-only");
  for (const rule of rules) {
    const alone: Rule[] = [rule];
    const allowedOnlyByRule = decide(world(alone, "deny"), witness).outcome === "allow";
    assert.ok(allowedOnlyByRule, `${rule.id} matches no witness record`);
  }
});

test("PT-12b: on top of the shipped layer, the inert deny shapes (misspelled marker; marker plus server target without slash) are still schema-invalid project-layer load failures", () => {
  const shapes: Rule[] = [
    { id: "inert-typo", effect: "deny", verbs: [RM.slice(0, -1)] },
    { id: "inert-noslash", effect: "deny", verbs: [RM], targets: [`mcp/${SERVER}`] },
  ];
  for (const s of shapes) {
    const r = loadShipped(JSON.stringify({ version: "1.0.0", rules: [s] }));
    assert.ok(!r.ok, s.id);
    assert.equal(r.reasonKind, "schema-invalid");
    assert.equal(r.failedLayer, "project");
  }
});

test("E3: with the shipped rules loaded the resolved defaultOutcome is allow, sourced from bootstrap", () => {
  assert.deepEqual(loadedOk().defaultOutcome, { outcome: "allow", source: "bootstrap" });
});
