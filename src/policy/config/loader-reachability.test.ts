// S7-B (Issue #306, ruling R2), loader level: the PT-12 entry test (S7 round-2 design-challenger attack 1)
// through the REAL loadEffectivePolicy for all three layers, the rejection through the real printer, and
// the migration exposure of the check (docs/plans/s7b-policy-authoring-safety-phase1-2026-09-26.md, R2-5,
// R2-9, R2-10). story-implementer's own tests, written failing first.
//
// The inert deny shapes (a: misspelled marker, b: server target without the trailing slash, d: declared
// server name instead of the sanitized one) must be `schema-invalid` load failures naming the layer that
// actually holds the rule (never misattributed, Issue #108), the rule id and the field path. Shapes b and d
// are rejected ONLY for a rule whose verbs are all class markers (S7-B fix-now H1, Issue #328: the target
// namespace under mcp/ is shared with shell redirect targets, so a rule that can match a shell record is
// reachable and loads; R2-13 proves it against the real shell normalizer and kernel). PT-12 is therefore
// satisfied for the marker-verb shapes a, b and d only. Shape c (legacy mutating verbs plus an MCP target)
// still loads and never matches a class record: a disclosed residual routed to the activation story
// (Issue #329, plan AP-1). Valid deny rules load.
//
// The case counts are computed from the tables below at run time and printed; none is typed as a claim.
// NAMES. Stand-in server names only (G19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadEffectivePolicy, type FailedLayerName, type LoadResult } from "./loader.ts";
import { printEffectivePolicy } from "./printer.ts";
import type { CentralPolicySource } from "./central-source.ts";
import type { Rule } from "../kernel/rule-types.ts";
import { ADMISSIBLE_SERVER_NAME, CLASS_MARKER_VERBS, MCP_TARGET_PREFIX } from "../normalizer/tool-class-format.ts";
import { normalize } from "../normalizer/registry.ts";
import { REDIRECT_DECORATES_UNRESOLVED } from "../normalizer/shell.ts";
import { decide } from "../kernel/kernel.ts";
import { mcpRedirectCalls } from "../fixtures/mcp-redirect-commands.ts";

const LAYERS: readonly FailedLayerName[] = ["central", "shipped-defaults", "project"];
const EMPTY = JSON.stringify({ version: "0.0.0-empty", rules: [] });
const MARKERS = Object.values(CLASS_MARKER_VERBS);
const SERVER = "standin-x";
const RM = CLASS_MARKER_VERBS["remote-mutating"];

interface Shape {
  label: string;
  rule: Rule;
  field: string;
}
const REJECTED: Shape[] = [
  { label: "a: misspelled marker verb", rule: { id: "rej-typo", effect: "deny", verbs: [RM.slice(0, -1)] }, field: "rules[0].verbs[0]" },
  { label: "b: marker verb plus a server target without the trailing slash", rule: { id: "rej-noslash", effect: "deny", verbs: [RM], targets: [`${MCP_TARGET_PREFIX}${SERVER}`] }, field: "rules[0].targets[0]" },
  { label: "d: marker verb plus the declared server name instead of the sanitized runtime name", rule: { id: "rej-declared", effect: "deny", verbs: [RM], targets: [`${MCP_TARGET_PREFIX}standin x/`] }, field: "rules[0].targets[0]" },
];
const LOADED: Shape[] = [
  { label: "c: legacy mutating verbs plus an MCP server prefix (documented, never matches a class record)", rule: { id: "ok-legacy", effect: "deny", verbs: ["write", "execute"], targets: [`${MCP_TARGET_PREFIX}${SERVER}/`] }, field: "" },
  { label: "b without a marker verb (target-only: can match a shell redirect record, Issue #328)", rule: { id: "ok-b-target-only", effect: "deny", targets: [`${MCP_TARGET_PREFIX}${SERVER}`] }, field: "" },
  { label: "d without a marker verb (target-only: can match a shell redirect record, Issue #328)", rule: { id: "ok-d-target-only", effect: "deny", targets: [`${MCP_TARGET_PREFIX}standin x/`] }, field: "" },
  { label: "b with a legacy verb", rule: { id: "ok-b-legacy", effect: "deny", verbs: ["write"], targets: [`${MCP_TARGET_PREFIX}${SERVER}`] }, field: "" },
  { label: "marker only", rule: { id: "ok-marker", effect: "deny", verbs: [RM] }, field: "" },
  { label: "marker plus server prefix", rule: { id: "ok-marker-server", effect: "deny", verbs: [RM], targets: [`${MCP_TARGET_PREFIX}${SERVER}/`] }, field: "" },
  { label: "server prefix only", rule: { id: "ok-server", effect: "deny", targets: [`${MCP_TARGET_PREFIX}${SERVER}/`] }, field: "" },
  { label: "an exact server-and-tool target", rule: { id: "ok-exact", effect: "deny", targets: [`${MCP_TARGET_PREFIX}${SERVER}/run`] }, field: "" },
];

// F8 (Issue #411) recorded act (SE ADR-0005): a real redirect record is now unresolved; these checks model the resolvable
// record a producer command set (story E0) will emit by dropping only the F8 cause.
function withoutF8(r: ReturnType<typeof normalize>): ReturnType<typeof normalize> {
  return { ...r, unresolved: r.unresolved.filter((u) => u !== REDIRECT_DECORATES_UNRESOLVED) };
}

function load(layer: FailedLayerName, rules: Rule[]): LoadResult {
  return loadText(layer, JSON.stringify({ version: "1.0.0", rules }));
}

/** The same, with the layer's raw text supplied by the caller (so a schema-invalid shape can be planted). */
function loadText(layer: FailedLayerName, text: string): LoadResult {
  return loadTextWithPaths(layer, text).result;
}

/** Also returns the two policy file paths the load used (the message for a file-backed layer names its own). */
function loadTextWithPaths(layer: FailedLayerName, text: string): { result: LoadResult; shippedPath: string; projectPath: string } {
  const root = mkdtempSync(join(tmpdir(), "thoth-s7b-r2-"));
  try {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeFileSync(shippedPath, layer === "shipped-defaults" ? text : EMPTY, "utf8");
    writeFileSync(projectPath, layer === "project" ? text : EMPTY, "utf8");
    const centralSource: CentralPolicySource = { read: () => (layer === "central" ? { status: "present", channel: "test-channel-descriptor", raw: text } : { status: "absent" }) };
    return { result: loadEffectivePolicy({ shippedDefaultsPath: shippedPath, projectPolicyPath: projectPath, centralSource }), shippedPath, projectPath };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("R2-5 PT-12 entry test: shapes a, b and d are schema-invalid load failures on every layer, attributed to that layer, naming the rule id and field path; shape c and the valid deny rules load", () => {
  const problems: string[] = [];
  let cases = 0;
  for (const layer of LAYERS) {
    for (const s of REJECTED) {
      cases += 1;
      const r = load(layer, [s.rule]);
      const where = `${layer} / ${s.label}`;
      if (r.ok) {
        problems.push(`${where}: loaded ok, expected a rejection`);
        continue;
      }
      if (r.reasonKind !== "schema-invalid") problems.push(`${where}: reasonKind ${r.reasonKind}`);
      if (r.failedLayer !== layer) problems.push(`${where}: failedLayer ${r.failedLayer}`);
      if (!r.message.includes(JSON.stringify(s.rule.id))) problems.push(`${where}: message does not name the rule id: ${r.message}`);
      if (!r.message.includes(s.field)) problems.push(`${where}: message does not name the field path ${s.field}: ${r.message}`);
    }
    for (const s of LOADED) {
      cases += 1;
      const r = load(layer, [s.rule]);
      if (!r.ok) problems.push(`${layer} / ${s.label}: rejected: ${r.message}`);
    }
  }
  console.log(`R2-5: ${String(cases)} cases computed (${String(LAYERS.length)} layers x (${String(REJECTED.length)} rejected + ${String(LOADED.length)} loaded shapes))`);
  assert.equal(problems.length, 0, problems.join("\n"));
});

test("R2-5b the message for a marker typo lists every valid marker so the fix is in the failure text; a rejected central rule is not attributed to the project layer", () => {
  const r = load("project", [REJECTED[0]!.rule]);
  assert.ok(!r.ok);
  for (const m of MARKERS) assert.ok(r.message.includes(m), `lists ${m}`);
  const central = load("central", [REJECTED[1]!.rule]);
  assert.ok(!central.ok && central.failedLayer === "central" && central.centralStatus === "present");
});

test("R2-5c one bad element is enough: a rule with a valid marker and a mistyped marker is rejected on a real load", () => {
  const r = load("project", [{ id: "mixed", effect: "deny", verbs: [RM, RM.slice(0, -2)] }]);
  assert.ok(!r.ok && r.reasonKind === "schema-invalid");
  assert.ok(r.message.includes("rules[0].verbs[1]"));
});

test("R2-11 schema-first: malformed rule sets come back as schema-invalid from the schema alone on every layer, never a throw from the reachability check; a rule with a schema error AND an unreachable verb reports the schema error only", () => {
  const typo = RM.slice(0, -1);
  const malformed: { label: string; text: string }[] = [
    { label: "rules is not an array", text: JSON.stringify({ version: "1.0.0", rules: "nope" }) },
    { label: "a rule is null", text: JSON.stringify({ version: "1.0.0", rules: [null] }) },
    { label: "verbs is a string, not an array", text: JSON.stringify({ version: "1.0.0", rules: [{ id: "m1", effect: "deny", verbs: typo }] }) },
    { label: "a target is a number", text: JSON.stringify({ version: "1.0.0", rules: [{ id: "m2", effect: "deny", targets: [5] }] }) },
    { label: "an unknown effect beside an unreachable verb", text: JSON.stringify({ version: "1.0.0", rules: [{ id: "m3", effect: "bogus", verbs: [typo] }] }) },
  ];
  const problems: string[] = [];
  for (const layer of LAYERS) {
    for (const c of malformed) {
      let r: LoadResult | undefined;
      try {
        r = loadText(layer, c.text);
      } catch (err) {
        problems.push(`${layer} / ${c.label}: threw ${(err as Error).message}`);
        continue;
      }
      if (r.ok) problems.push(`${layer} / ${c.label}: loaded ok`);
      else if (r.reasonKind !== "schema-invalid" || r.failedLayer !== layer) problems.push(`${layer} / ${c.label}: ${r.reasonKind} on ${r.failedLayer}`);
      else if (c.label.startsWith("an unknown effect") && r.message.includes("can never match")) problems.push(`${layer} / ${c.label}: the reachability text leaked into a schema failure: ${r.message}`);
    }
  }
  console.log(`R2-11: ${String(LAYERS.length * malformed.length)} malformed cases computed from ${String(malformed.length)} shapes`);
  assert.equal(problems.length, 0, problems.join("\n"));
});

test("R2-9 rejection-through-printer: the real printer prints the layer, the schema-invalid kind and the message in the same two-line shape; control characters and a very long id are bounded", () => {
  const root = mkdtempSync(join(tmpdir(), "thoth-s7b-r2-printer-"));
  try {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeFileSync(shippedPath, EMPTY, "utf8");
    const centralSource: CentralPolicySource = { read: () => ({ status: "absent" }) };
    const print = (rules: Rule[]): { stdout: string; exitCode: number } => {
      writeFileSync(projectPath, JSON.stringify({ version: "1.0.0", rules }), "utf8");
      return printEffectivePolicy({ shippedDefaultsPath: shippedPath, projectPolicyPath: projectPath, centralSource });
    };

    const plain = print([REJECTED[0]!.rule]);
    assert.equal(plain.exitCode, 1);
    const lines = plain.stdout.split("\n");
    assert.equal(lines.length, 2, `no new stdout shape: the central-status line plus one REJECTED line; got ${JSON.stringify(plain.stdout)}`);
    assert.ok(lines[1]!.startsWith("REJECTED: project policy load failed (schema-invalid): "), lines[1]);
    assert.ok(lines[1]!.includes("rej-typo") && lines[1]!.includes("rules[0].verbs[0]"));

    const hostile = print([{ id: "x".repeat(2000), effect: "deny", verbs: [RM], targets: [`${MCP_TARGET_PREFIX}bad\u001b[31m\u2028name`] }]);
    assert.equal(hostile.exitCode, 1);
    assert.equal(hostile.stdout.split("\n").length, 2, "a control or line-separator character in a rejected target cannot forge a line");
    assert.ok(!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(hostile.stdout.replaceAll("\n", "")), "no control character reaches the terminal");
    assert.ok(hostile.stdout.length < 1500, `the rejected id and target are length-bounded; stdout is ${String(hostile.stdout.length)} chars`);
    assert.ok(!hostile.stdout.includes("x".repeat(2000)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("R2-13 reachability-accepts-every-shell-emitted-target (Issue #328): for redirect commands whose targets land under mcp/ (dot, underscore, no slash, trailing slash, nested), a deny rule authored from the record the REAL shell normalizer emits loads on every layer and the REAL kernel denies on it; a marker-verb-only rule with the same target is the only shape the check may reject, and it never matches that record", () => {
  const calls = mcpRedirectCalls();
  const RM_VERB = CLASS_MARKER_VERBS["remote-mutating"];
  interface Emitted {
    command: string;
    verbs: string[];
    target: string;
  }
  const emitted: Emitted[] = [];
  for (const call of calls) {
    const normalized = normalize("shell", call);
    const record = { ...normalized, unresolved: normalized.unresolved.filter((u) => u !== REDIRECT_DECORATES_UNRESOLVED) }; // F8 (#411) recorded act: the real record is now unresolved; model the resolvable record a producer set (E0) would emit
    assert.equal(record.targets.length, 1, `${call.command}: the shell normalizer emits exactly one target`);
    const target = record.targets[0] as string;
    assert.ok(target.startsWith(MCP_TARGET_PREFIX), `${call.command}: the emitted target ${JSON.stringify(target)} sits under the MCP prefix (the instrument must be able to fail)`);
    assert.ok(record.verbs.length > 0, `${call.command}: the record carries a verb`);
    emitted.push({ command: call.command, verbs: [...record.verbs], target });
  }
  // the rules authored from each emitted record: verb+target, target-only, a legacy verb list, a marker plus the emitted verb
  const authored: { rule: Rule; from: Emitted; reachable: boolean }[] = [];
  emitted.forEach((e, i) => {
    authored.push({ rule: { id: `emit-vt-${String(i)}`, effect: "deny", verbs: e.verbs, targets: [e.target] }, from: e, reachable: true });
    authored.push({ rule: { id: `emit-t-${String(i)}`, effect: "deny", targets: [e.target] }, from: e, reachable: true });
    authored.push({ rule: { id: `emit-mixed-${String(i)}`, effect: "deny", verbs: [RM_VERB, ...e.verbs], targets: [e.target] }, from: e, reachable: true });
  });
  const problems: string[] = [];
  for (const layer of LAYERS) {
    const r = load(layer, authored.map((a) => a.rule));
    if (!r.ok) problems.push(`${layer}: the layer failed to load over rules the kernel matches: ${r.message}`);
  }
  for (const a of authored) {
    const shellRecord = withoutF8(normalize("shell", { command: a.from.command, environment: "unknown", identity: "s7b-issue-328" }));
    const verdict = decide({ rules: { version: "1.0.0", rules: [a.rule] }, defaultOutcome: "allow" }, shellRecord);
    if (verdict.outcome !== "deny") problems.push(`${a.rule.id} (${a.from.command}): the real kernel says ${verdict.outcome}, expected deny`);
  }
  // a marker-only rule with the same target: rejected exactly when V2 or V3 applies to it, and never matching the shell record
  let markerOnlyRejected = 0;
  let markerOnlyLoaded = 0;
  for (const e of emitted) {
    const rest = e.target.slice(MCP_TARGET_PREFIX.length);
    const server = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest;
    const unreachableForClass = !rest.includes("/") || !ADMISSIBLE_SERVER_NAME.test(server);
    const markerRule: Rule = { id: "marker-only", effect: "deny", verbs: [RM_VERB], targets: [e.target] };
    const r = load("project", [markerRule]);
    if (unreachableForClass) {
      markerOnlyRejected += 1;
      if (r.ok) problems.push(`marker-only + ${JSON.stringify(e.target)}: loaded, expected a rejection (no class record can match it)`);
    } else {
      markerOnlyLoaded += 1;
      if (!r.ok) problems.push(`marker-only + ${JSON.stringify(e.target)}: rejected, but a class record can match it: ${r.message}`);
    }
    const shellRecord = withoutF8(normalize("shell", { command: e.command, environment: "unknown", identity: "s7b-issue-328" }));
    const verdict = decide({ rules: { version: "1.0.0", rules: [markerRule] }, defaultOutcome: "allow" }, shellRecord);
    if (verdict.outcome !== "allow") problems.push(`marker-only + ${JSON.stringify(e.target)}: matched the shell record, so the rejection would be unsound`);
  }
  console.log(`R2-13: ${String(calls.length)} redirect commands normalized; ${String(authored.length)} deny rules authored from the emitted records, each loaded on ${String(LAYERS.length)} layers and denied by the kernel; marker-only variants: ${String(markerOnlyRejected)} rejected, ${String(markerOnlyLoaded)} loaded`);
  assert.ok(markerOnlyRejected > 0 && markerOnlyLoaded > 0, "the corpus holds both rejected and accepted marker-only shapes");
  assert.deepEqual(problems, []);
});

test("R2-15 layer-aware-unlock (Issue #333): every rejection kind names the unlock the person who is blocked can perform: the central layer says the central policy owner must correct the out-of-session source and that a session cannot repair it; shipped-defaults and project name their own file edit; the fix itself stays in the text", () => {
  interface Kind {
    label: string;
    rule: Rule;
    fix: string[];
  }
  const kinds: Kind[] = [
    { label: "V1 misspelled marker", rule: REJECTED[0]!.rule, fix: MARKERS },
    { label: "V2 no trailing slash", rule: REJECTED[1]!.rule, fix: [`${MCP_TARGET_PREFIX}${SERVER}/`] },
    { label: "V3 declared name", rule: REJECTED[2]!.rule, fix: ["sanitized runtime name"] },
  ];
  const problems: string[] = [];
  let cases = 0;
  for (const kind of kinds) {
    for (const layer of LAYERS) {
      cases += 1;
      const { result, shippedPath, projectPath } = loadTextWithPaths(layer, JSON.stringify({ version: "1.0.0", rules: [kind.rule] }));
      const where = `${layer} / ${kind.label}`;
      if (result.ok) {
        problems.push(`${where}: loaded ok`);
        continue;
      }
      const m = result.message;
      const unlock = m.slice(m.indexOf("Unlock:"));
      if (!m.includes("Unlock:")) problems.push(`${where}: no Unlock clause: ${m}`);
      for (const f of kind.fix) if (!m.includes(f)) problems.push(`${where}: the fix text ${JSON.stringify(f)} is missing: ${m}`);
      if (layer === "central") {
        if (!/central policy owner/.test(unlock)) problems.push(`${where}: the unlock does not name the central policy owner: ${unlock}`);
        if (!/out-of-session/.test(unlock)) problems.push(`${where}: the unlock does not say the source is out of session: ${unlock}`);
        if (!/cannot repair/.test(unlock)) problems.push(`${where}: the unlock does not say a session cannot repair it: ${unlock}`);
        if (/\bedit\b/i.test(unlock)) problems.push(`${where}: the central unlock tells the operator to edit something this session cannot edit: ${unlock}`);
      } else {
        const file = layer === "shipped-defaults" ? shippedPath : projectPath;
        if (!unlock.includes(`edit ${file}`)) problems.push(`${where}: the unlock does not name the file edit (${file}): ${unlock}`);
        if (/central policy owner/.test(unlock)) problems.push(`${where}: a file-backed layer must not point at the central owner: ${unlock}`);
      }
    }
  }
  console.log(`R2-15: ${String(cases)} (rejection kind x layer) messages checked`);
  assert.deepEqual(problems, []);
});

test("R2-10 no-rules-today: the real shipped-defaults and project policy files load through the real loader with the check active; the rule counts they hold are read and printed (migration exposure)", () => {
  const shippedPath = fileURLToPath(new URL("./shipped-defaults.json", import.meta.url));
  const projectPath = fileURLToPath(new URL("../../../.thoth/policy.json", import.meta.url));
  const count = (p: string): number => (JSON.parse(readFileSync(p, "utf8")) as { rules: unknown[] }).rules.length;
  const shipped = count(shippedPath);
  const project = count(projectPath);
  console.log(`R2-10: shipped-defaults holds ${String(shipped)} rules, project policy holds ${String(project)} rules (rules the check could reject)`);
  const r = loadEffectivePolicy({ shippedDefaultsPath: shippedPath, projectPolicyPath: projectPath, centralSource: { read: () => ({ status: "absent" }) } });
  assert.ok(r.ok, `the real files must keep loading: ${r.ok ? "" : r.message}`);
});
