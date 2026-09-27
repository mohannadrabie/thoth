// S7-B (Issue #306, ruling R2): a policy rule that provably cannot match any record the normalizers emit
// is a load error, not a silent no-op (docs/plans/s7b-policy-authoring-safety-phase1-2026-09-26.md,
// R2-1 to R2-4 and R2-6 to R2-8). story-implementer's own tests, written failing first. The loader-level
// half (R2-5, R2-9, R2-10) is loader-reachability.test.ts. S7-C (Issues #334 and #335,
// docs/plans/s7c-reachability-residuals-phase1-2026-09-27.md) adds R2-16, R2-17, R2-19 and R2-20, extends
// R2-8 and REPLACES one R2-12 row (see that test).
//
// Three checks, applied per element of `verbs` and `targets`:
//   V1 a verb starting with the class-marker prefix that is not one of the three markers;
//   V2 a target that is the MCP prefix plus a server name with no trailing "/" (no CLASS record's target is
//      a server alone, and a pattern without a trailing "/" matches exactly);
//   V3 a target under the MCP prefix whose server segment is not an admitted server name.
// V2 and V3 apply to a rule in exactly two cases (S7-B Issue #328 narrowed them; S7-C Issues #334 and #335
// closed the two residuals): (i) its verbs hold at least one class marker and no verb a normalizer emits (a
// class-marker-only list, or a marker plus a stray verb: the kernel needs a shared verb, so only a class
// record can match, and no class record carries such a target); (ii) it is an ALLOW rule with no verbs
// (absent or empty), which matches every verb and can then match only a shell redirect record (a silent
// widening, rejected as a safety rule, not a reachability proof). The target namespace under "mcp/" is
// shared with the shell normalizer, which emits a redirect target verbatim, so a rule that can match such a
// record through a verb a normalizer emits is reachable and is never rejected by V2 or V3 (R2-13 in
// loader-reachability.test.ts proves that against the real shell normalizer and the real kernel). A verb
// list with no class marker is out of scope (docs/backlog.md).
// NOT rejected (documented): legacy mutating verbs plus an MCP target (shape c: matches shell-emitted
// records only, never a class record; a disclosed residual routed to the activation story, Issue #329).
//
// NAMES. Stand-in server names only; committed fixture names are read at run time (G19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRuleReachability, type ReachabilitySource } from "./rule-reachability.ts";
import { loadEffectivePolicy, type FailedLayerName, type LoadResult } from "./loader.ts";
import type { CentralPolicySource } from "./central-source.ts";
import { ADMISSIBLE_SERVER_NAME, CLASS_MARKER_PREFIX, CLASS_MARKER_VERBS, MCP_TARGET_PREFIX, buildMcpTarget, sanitizeMcpName } from "../normalizer/tool-class-format.ts";
import { KNOWN_VERBS } from "../normalizer/action-catalog.ts";
import { normalize } from "../normalizer/registry.ts";
import "../normalizer/shell.ts";
import "../normalizer/structured-cluster.ts";
import "../normalizer/tool-class.ts";
import * as calls from "../fixtures/normalizer-calls.ts";
import { mcpRedirectCalls } from "../fixtures/mcp-redirect-commands.ts";
import { decide, matchRules } from "../kernel/kernel.ts";
import type { ActionRecord } from "../kernel/action-record.ts";
import type { Rule, RuleSet } from "../kernel/rule-types.ts";
import type { MergedToolClassificationSet, ToolClass } from "../tools/classification.ts";
import { parseCentralClassificationFixture } from "../tools/central-classification.ts";
import { stripComments } from "../../qa/kernel-purity-check.ts";

const MARKERS = Object.values(CLASS_MARKER_VERBS);
const FIXTURE_PATH = new URL("../../../docs/qa/s5-central-classification.json", import.meta.url);
const STANDIN_SERVERS = ["standin-ro", "standin-ws", "standin-rm"];

function ruleSet(...rules: Rule[]): RuleSet {
  return { version: "1.0.0", rules };
}
function makeRule(effect: "allow" | "deny", id: string, verbs?: string[], targets?: string[]): Rule {
  const rule: Rule = { id, effect };
  if (verbs !== undefined) rule.verbs = verbs;
  if (targets !== undefined) rule.targets = targets;
  return rule;
}
function deny(id: string, verbs?: string[], targets?: string[]): Rule {
  return makeRule("deny", id, verbs, targets);
}
function allow(id: string, verbs?: string[], targets?: string[]): Rule {
  return makeRule("allow", id, verbs, targets);
}

// S7-C shared inputs. Every target below is one the check's V2 or V3 rejects for a rule it applies to.
const CATALOG_VERBS: readonly string[] = [...KNOWN_VERBS];
/** V2: the MCP prefix plus a server name and no "/" after it. */
const V2_TARGETS: readonly string[] = [`${MCP_TARGET_PREFIX}standin-x`];
/** V3: a server segment the runtime never presents (space, colon, dot, underscore, empty). */
const V3_TARGETS: readonly string[] = ["standin x", "standin:x", "standin.x", "standin_x", ""].map((server) => `${MCP_TARGET_PREFIX}${server}/tool`);
const BAD_TARGETS: readonly string[] = [...V2_TARGETS, ...V3_TARGETS];
/** Verbs no normalizer emits: an empty string, a case-variant and a near-miss of a catalog verb, a marker-free stray. */
const STRAY_VERBS: readonly string[] = ["", "WRITE", "writ", "some-other-verb"];
const LAYERS: readonly FailedLayerName[] = ["central", "shipped-defaults", "project"];
const EMPTY_POLICY = JSON.stringify({ version: "0.0.0-empty", rules: [] });

/** A real load of `rules` on `layer` (the other two layers hold no rules); also returns the two file paths
 * the load used, because a file-backed layer's Unlock clause names its own file. */
function loadOnLayer(layer: FailedLayerName, rules: Rule[]): { result: LoadResult; shippedPath: string; projectPath: string } {
  const text = JSON.stringify({ version: "1.0.0", rules });
  const root = mkdtempSync(join(tmpdir(), "thoth-s7c-"));
  try {
    const shippedPath = join(root, "shipped-defaults.json");
    const projectPath = join(root, "project.json");
    writeFileSync(shippedPath, layer === "shipped-defaults" ? text : EMPTY_POLICY, "utf8");
    writeFileSync(projectPath, layer === "project" ? text : EMPTY_POLICY, "utf8");
    const centralSource: CentralPolicySource = { read: () => (layer === "central" ? { status: "present", channel: "test-channel-descriptor", raw: text } : { status: "absent" }) };
    return { result: loadEffectivePolicy({ shippedDefaultsPath: shippedPath, projectPolicyPath: projectPath, centralSource }), shippedPath, projectPath };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The layer-aware Unlock checks R2-15 makes, for a failed load of one rule at rules[0].targets[0]:
 * schema-invalid, attributed to `layer`, naming the rule id and the field path, and an Unlock clause that
 * names the central owner (central) or the file edit (file layers). Returns the problems found. */
function loaderRejectionProblems(layer: FailedLayerName, where: string, rule: Rule): string[] {
  const problems: string[] = [];
  const { result, shippedPath, projectPath } = loadOnLayer(layer, [rule]);
  if (result.ok) return [`${where}: loaded ok, expected a rejection`];
  if (result.reasonKind !== "schema-invalid") problems.push(`${where}: reasonKind ${result.reasonKind}`);
  if (result.failedLayer !== layer) problems.push(`${where}: failedLayer ${result.failedLayer}`);
  const m = result.message;
  if (!m.includes(JSON.stringify(rule.id))) problems.push(`${where}: message does not name the rule id: ${m}`);
  if (!m.includes("rules[0].targets[0]")) problems.push(`${where}: message does not name rules[0].targets[0]: ${m}`);
  const unlock = m.slice(m.indexOf("Unlock:"));
  if (!m.includes("Unlock:")) problems.push(`${where}: no Unlock clause: ${m}`);
  if (layer === "central") {
    if (!/central policy owner/.test(unlock) || !/cannot repair/.test(unlock)) problems.push(`${where}: the central unlock does not name the owner and that a session cannot repair it: ${unlock}`);
    if (/\bedit\b/i.test(unlock)) problems.push(`${where}: the central unlock tells the operator to edit something this session cannot edit: ${unlock}`);
  } else if (!unlock.includes(`edit ${layer === "shipped-defaults" ? shippedPath : projectPath}`)) {
    problems.push(`${where}: the unlock does not name the file edit: ${unlock}`);
  }
  return problems;
}

/** True when V2 or V3 would reject this target for a rule they apply to (recomputed from the exported vocabulary). */
function failsV2OrV3(target: string): boolean {
  if (!target.startsWith(MCP_TARGET_PREFIX)) return false;
  const rest = target.slice(MCP_TARGET_PREFIX.length);
  if (rest.length === 0) return false;
  const slash = rest.indexOf("/");
  const server = slash < 0 ? rest : rest.slice(0, slash);
  return slash < 0 || !ADMISSIBLE_SERVER_NAME.test(server);
}
function committedServers(): string[] {
  return parseCentralClassificationFixture(readFileSync(FIXTURE_PATH, "utf8")).centralLayer.tools.map((t) => t.name);
}

test("R2-1 v1-marker-typo: a misspelled marker, the marker prefix alone and a marker with a trailing character each reject; the three valid markers load; the message carries the field path, rule id and every valid marker", () => {
  const bad = [(MARKERS[2] as string).slice(0, -1), CLASS_MARKER_PREFIX, `${MARKERS[0] as string}x`, `${CLASS_MARKER_PREFIX}Read-Only`];
  for (const verb of bad) {
    const errors = checkRuleReachability(ruleSet(deny("r-one", ["read", verb])));
    assert.equal(errors.length, 1, `${JSON.stringify(verb)} rejects exactly once`);
    const [e] = errors;
    assert.ok(e !== undefined);
    assert.equal(e.field, "rules[0].verbs[1]", "the path names the element, not the rule");
    assert.ok(e.message.includes(JSON.stringify("r-one")), "names the rule id");
    assert.ok(e.message.includes(JSON.stringify(verb)), "names the rejected value");
    for (const m of MARKERS) assert.ok(e.message.includes(m), `lists the valid marker ${m}`);
  }
  for (const m of MARKERS) assert.deepEqual(checkRuleReachability(ruleSet(deny("ok", [m]))), [], `${m} loads`);
  // a verb that does not start with the prefix is out of scope and is not rejected (plan section 10)
  const outside = CLASS_MARKER_PREFIX.slice(0, -1) + "y";
  assert.deepEqual(checkRuleReachability(ruleSet(deny("free", [outside, "write", "anything-else"]))), [], "verbs outside the marker namespace are not this check's business");
  console.log(`R2-1: ${String(bad.length)} rejected verbs and ${String(MARKERS.length)} valid markers checked`);
});

test("R2-1b per-element: one valid and one mistyped marker in the same rule is rejected, at the mistyped element's own index; a rule in the second position reports rules[1]", () => {
  const errors = checkRuleReachability(ruleSet(deny("a", [MARKERS[0] as string]), deny("b", [MARKERS[0] as string, `${CLASS_MARKER_PREFIX}oops`])));
  assert.deepEqual(errors.map((e) => e.field), ["rules[1].verbs[1]"]);
});

test("R2-2 v2-no-trailing-slash: for a marker-verb rule a server target without a slash rejects; with a slash, with a tool segment, and the bare prefix load", () => {
  for (const server of STANDIN_SERVERS) {
    const errors = checkRuleReachability(ruleSet(deny("noslash", [MARKERS[0] as string], [`${MCP_TARGET_PREFIX}${server}`])));
    assert.equal(errors.length, 1, `${server} without a slash rejects exactly once`);
    assert.equal(errors[0]?.field, "rules[0].targets[0]");
    assert.ok(errors[0]?.message.includes(JSON.stringify("noslash")));
    assert.ok(errors[0]?.message.includes(`${MCP_TARGET_PREFIX}${server}/`), "the message shows the corrected shape");
    for (const ok of [`${MCP_TARGET_PREFIX}${server}/`, `${MCP_TARGET_PREFIX}${server}/some-tool`, MCP_TARGET_PREFIX]) {
      assert.deepEqual(checkRuleReachability(ruleSet(deny("fine", [MARKERS[0] as string], [ok]))), [], `${ok} loads`);
    }
  }
});

test("R2-3 v3-declared-name: for a marker-verb rule, server segments with a space, colon, dot, underscore or empty reject; letters, digits and hyphen load; the tool segment is not checked here", () => {
  const badServers = ["standin x", "standin:x", "standin.x", "standin_x", ""];
  const markerVerb = [MARKERS[1] as string];
  for (const server of badServers) {
    const target = `${MCP_TARGET_PREFIX}${server}/tool`;
    const errors = checkRuleReachability(ruleSet(deny("declared", markerVerb, [target])));
    assert.equal(errors.length, 1, `${JSON.stringify(target)} rejects exactly once (the slash is present, so only V3 speaks)`);
    assert.equal(errors[0]?.field, "rules[0].targets[0]");
    assert.ok(errors[0]?.message.includes(ADMISSIBLE_SERVER_NAME.source), "the message states the admitted pattern");
  }
  assert.equal(checkRuleReachability(ruleSet(deny("emptyprefix", markerVerb, [`${MCP_TARGET_PREFIX}/`]))).length, 1, "an empty server segment with a trailing slash rejects");
  for (const server of ["standin-x", "Abc-123", "9", "a-b-c"]) {
    assert.deepEqual(checkRuleReachability(ruleSet(deny("named", markerVerb, [`${MCP_TARGET_PREFIX}${server}/`]))), [], `${server} loads`);
  }
  assert.deepEqual(checkRuleReachability(ruleSet(deny("toolseg", markerVerb, [`${MCP_TARGET_PREFIX}standin-x/some tool with spaces.and.dots`]))), [], "the tool segment is not checked");
  console.log(`R2-3: ${String(badServers.length + 1)} rejected server segments checked`);
});

test("R2-4 shape-c-loads: legacy mutating verbs plus an MCP server prefix load with 0 errors and, through the real kernel, never match a class record", () => {
  const legacy = ["write", "create", "modify", "delete", "move", "rename", "execute"];
  const rule = deny("legacy-plus-mcp", legacy, [`${MCP_TARGET_PREFIX}standin-x/`]);
  assert.deepEqual(checkRuleReachability(ruleSet(rule)), []);
  const catalog: MergedToolClassificationSet = { version: "t", tools: [{ name: "standin-x", class: "remote-mutating", sourceLayer: "central" }] };
  const record = normalize("tool-class", { toolName: "mcp__standin-x__run", catalog, environment: "unknown", identity: "r2-4", deferred: false });
  assert.deepEqual(record.verbs, [CLASS_MARKER_VERBS["remote-mutating"]], "the class record carries the marker verb only");
  assert.equal(decide({ rules: ruleSet(rule), defaultOutcome: "allow" }, record).outcome, "allow", "the documented fact stays true: shape c never matches a class record");
});

// REPLACEMENT (S7-C, Issues #334 and #335; SE ADR-0005, recorded as a decisions row pending human
// ratification): this test used to say a marker plus a verb outside the marker namespace LOADS on a target
// V2 or V3 rejects (one row, `rejects: false`). That row is FLIPPED to `rejects: true`: a list holding a
// class marker and no verb any normalizer emits can match only a class record, and no class record carries
// such a target. The rule is stricter, nothing is deleted, and every other row keeps its expectation. The
// matrix gains an effect dimension (an ALLOW rule with no verbs is now rejected on these targets, Issue
// #335) and rows for the stray-verb shapes (Issue #334).
test("R2-12 v2-v3-scope (Issues #328, #334, #335, Manager rulings): a target V2 or V3 would reject loads unless the rule has (i) a class marker and no verb a normalizer emits, or (ii) an allow effect with no verbs; V1 is unchanged", () => {
  const [m0, m1] = [MARKERS[0] as string, MARKERS[1] as string];
  const stray = "some-other-verb";
  // `deny` / `allow`: true means the check must reject the rule for a bad target under that effect
  const verbSets: { label: string; verbs: string[] | undefined; deny: boolean; allow: boolean }[] = [
    { label: "no verbs field (matches every verb, so every shell record)", verbs: undefined, deny: false, allow: true },
    { label: "an empty verbs array (matches every verb)", verbs: [], deny: false, allow: true },
    { label: "one legacy verb", verbs: ["write"], deny: false, allow: false },
    { label: "the legacy mutating verbs", verbs: ["write", "create", "modify", "delete", "move", "rename", "execute"], deny: false, allow: false },
    { label: "a marker plus a legacy verb", verbs: [m0, "write"], deny: false, allow: false },
    { label: "a legacy verb plus a marker", verbs: ["write", m0], deny: false, allow: false },
    { label: "REPLACED ROW: a marker plus a verb outside the marker namespace (was rejects false)", verbs: [m0, stray], deny: true, allow: true },
    { label: "a marker plus an empty string", verbs: [m0, ""], deny: true, allow: true },
    { label: "a marker plus a case-variant of a catalog verb", verbs: [m0, "WRITE"], deny: true, allow: true },
    { label: "a case-variant of a catalog verb plus a marker", verbs: ["WRITE", m0], deny: true, allow: true },
    { label: "a marker plus a near-miss of a catalog verb", verbs: [m0, "writ"], deny: true, allow: true },
    { label: "a stray verb plus a marker", verbs: [stray, m0], deny: true, allow: true },
    { label: "two markers plus a stray verb", verbs: [m0, m1, stray], deny: true, allow: true },
    { label: "a marker, a stray verb and a catalog verb (a normalizer emits one of them)", verbs: [m0, stray, "read"], deny: false, allow: false },
    { label: "only stray verbs, no marker (backlog scope, ruling Q2)", verbs: [stray, "WRITE"], deny: false, allow: false },
    { label: "an empty string alone, no marker (backlog scope)", verbs: [""], deny: false, allow: false },
    { label: "one marker", verbs: [m0], deny: true, allow: true },
    { label: "two markers", verbs: [m0, m1], deny: true, allow: true },
    { label: "every marker", verbs: [...MARKERS], deny: true, allow: true },
    ...CATALOG_VERBS.flatMap((v) => [
      { label: `a marker plus the catalog verb ${v}`, verbs: [m0, v], deny: false, allow: false },
      { label: `the catalog verb ${v} plus a marker`, verbs: [v, m0], deny: false, allow: false },
    ]),
  ];
  let cases = 0;
  const problems: string[] = [];
  for (const target of BAD_TARGETS) {
    for (const v of verbSets) {
      for (const effect of ["deny", "allow"] as const) {
        cases += 1;
        const rejects = v[effect];
        const errors = checkRuleReachability(ruleSet(makeRule(effect, "matrix", v.verbs, [target])));
        const where = `${effect} / ${v.label} + ${JSON.stringify(target)}`;
        if (rejects && errors.length === 0) problems.push(`${where}: expected a rejection`);
        if (rejects && errors.some((e) => e.field !== "rules[0].targets[0]")) problems.push(`${where}: a rejection must sit at the target's own field path, got ${errors.map((e) => e.field).join(", ")}`);
        if (!rejects && errors.length > 0) problems.push(`${where}: rejected, but a record a normalizer emits can match it: ${errors[0]?.message ?? ""}`);
      }
    }
  }
  console.log(`R2-12: ${String(cases)} (verb set x bad target x effect) cases computed`);
  assert.deepEqual(problems, []);
  // V1 stays element-level and independent of the target: a mistyped marker is rejected wherever it sits
  const typo = `${CLASS_MARKER_PREFIX}oops`;
  assert.deepEqual(
    checkRuleReachability(ruleSet(deny("typo-plus-legacy", [typo, "write"], [`${MCP_TARGET_PREFIX}standin-x`]))).map((e) => e.field),
    ["rules[0].verbs[0]"],
    "V1 fires for the typo and V2 does not fire (the rule can match a shell record)",
  );
  assert.deepEqual(checkRuleReachability(ruleSet(deny("typo-alone", [typo], [`${MCP_TARGET_PREFIX}standin-x`]))).map((e) => e.field), ["rules[0].verbs[0]"], "a typo is not a marker, so only V1 speaks");
});

// --- drift instruments -------------------------------------------------------------------------

function emittedCorpus(): { verbs: Set<string>; targets: Set<string>; shellClusterTargets: string[]; records: ActionRecord[] } {
  const verbs = new Set<string>();
  const targets = new Set<string>();
  const shellClusterTargets: string[] = [];
  const records: ActionRecord[] = [];
  const take = (r: ActionRecord, fromShellOrCluster: boolean): void => {
    records.push(r);
    for (const v of r.verbs) verbs.add(v);
    for (const t of r.targets) {
      targets.add(t);
      if (fromShellOrCluster) shellClusterTargets.push(t);
    }
  };
  for (const value of Object.values(calls)) {
    if (typeof value !== "object" || value === null) continue;
    if ("command" in value) take(normalize("shell", value), true);
    else if ("resourceType" in value) take(normalize("cluster", value), true);
  }
  // S7-B fix-now H1: shell redirects whose targets land under the MCP prefix are real emitted records
  for (const call of mcpRedirectCalls()) take(normalize("shell", call), true);
  for (const v of KNOWN_VERBS) verbs.add(v);
  const servers = [...STANDIN_SERVERS, ...committedServers()];
  for (const server of servers) {
    for (const cls of Object.keys(CLASS_MARKER_VERBS) as ToolClass[]) {
      const catalog: MergedToolClassificationSet = { version: "t", tools: [{ name: server, class: cls, sourceLayer: "central" }] };
      for (const tool of ["x", "list-things", "a_b-c"]) {
        take(normalize("tool-class", { toolName: `mcp__${sanitizeMcpName(server)}__${tool}`, catalog, environment: "unknown", identity: "r2-6", deferred: false }), false);
      }
    }
  }
  return { verbs, targets, shellClusterTargets, records };
}

test("R2-6 drift-emitted-vocabulary-accepted: every verb, every target and every whole record (its verbs and targets as one rule) a normalizer emits over the golden corpus, including shell redirects under the MCP prefix, passes the check", () => {
  const { verbs, targets, shellClusterTargets, records } = emittedCorpus();
  const shellUnderMcp = shellClusterTargets.filter((t) => t.startsWith(MCP_TARGET_PREFIX));
  console.log(`R2-6: ${String(records.length)} records normalized; ${String(verbs.size)} distinct verbs and ${String(targets.size)} distinct targets used as one-element rules; ${String(shellUnderMcp.length)} shell-emitted targets sit under the MCP prefix`);
  assert.ok(records.length > 0 && verbs.size > 0 && targets.size > 0, "the corpus is non-empty");
  assert.ok(shellClusterTargets.length > 0, "the shell and cluster corpus emits targets");
  assert.ok(shellUnderMcp.length > 0, "the corpus DOES hold shell-emitted targets under the MCP prefix (Issue #328: the namespace is shared), so this instrument can fail on them");
  const rejected: string[] = [];
  for (const v of verbs) {
    for (const e of checkRuleReachability(ruleSet(deny("drift-verb", [v])))) rejected.push(`verb ${JSON.stringify(v)}: ${e.message}`);
  }
  for (const t of targets) {
    for (const e of checkRuleReachability(ruleSet(deny("drift-target", undefined, [t])))) rejected.push(`target ${JSON.stringify(t)}: ${e.message}`);
  }
  for (const r of records) {
    const verbsField = r.verbs.length > 0 ? [...r.verbs] : undefined;
    const targetsField = r.targets.length > 0 ? [...r.targets] : undefined;
    for (const e of checkRuleReachability(ruleSet(deny("drift-record", verbsField, targetsField)))) {
      rejected.push(`record verbs ${JSON.stringify(r.verbs)} targets ${JSON.stringify(r.targets)}: ${e.message}`);
    }
  }
  // S7-C (Issue #335): an ALLOW rule authored from an emitted record with its own verbs still loads (only an
  // allow rule with NO verbs on a target the runtime never presents is rejected, and a record with verbs
  // never yields one)
  let allowRules = 0;
  for (const r of records) {
    if (r.verbs.length === 0) continue;
    allowRules += 1;
    for (const e of checkRuleReachability(ruleSet(allow("drift-allow-record", [...r.verbs], r.targets.length > 0 ? [...r.targets] : undefined)))) {
      rejected.push(`allow record verbs ${JSON.stringify(r.verbs)} targets ${JSON.stringify(r.targets)}: ${e.message}`);
    }
  }
  console.log(`R2-6: ${String(allowRules)} whole-record allow rules (records with verbs) also checked`);
  assert.deepEqual(rejected, [], "the check rejects nothing a normalizer emits");
});

test("R2-7 drift-authored-shapes-validate: every marker verb rule, and every prefix, exact and bare-prefix target for each stand-in and each committed server, passes the check", () => {
  const servers = [...STANDIN_SERVERS, ...committedServers()];
  const authored: Rule[] = [];
  for (const m of MARKERS) authored.push(deny("marker-only", [m]));
  for (const server of servers) {
    // committed names are only used as shapes when the runtime would admit them
    if (!ADMISSIBLE_SERVER_NAME.test(server)) continue;
    const exact = buildMcpTarget({ server, tool: "x" });
    assert.ok(exact !== undefined);
    authored.push(deny("server-prefix", undefined, [`${MCP_TARGET_PREFIX}${server}/`]));
    authored.push(deny("exact-tool", undefined, [exact]));
    for (const m of MARKERS) authored.push(deny("marker-and-server", [m], [`${MCP_TARGET_PREFIX}${server}/`]));
  }
  authored.push(deny("bare-prefix", undefined, [MCP_TARGET_PREFIX]));
  console.log(`R2-7: ${String(authored.length)} authored rules checked from ${String(servers.length)} servers and ${String(MARKERS.length)} markers`);
  assert.deepEqual(checkRuleReachability(ruleSet(...authored)), []);
});

const MODULE_PATH = fileURLToPath(new URL("./rule-reachability.ts", import.meta.url));

test("R2-8 no-retyped-vocabulary: the new module holds no literal of the marker prefix, the MCP target prefix, the server-name pattern or any catalog verb, and imports KNOWN_VERBS from the action catalog; the marker table values start with the exported prefix; the target builder produces the exported prefix", () => {
  const code = stripComments(readFileSync(MODULE_PATH, "utf8"));
  assert.ok(!code.includes(CLASS_MARKER_PREFIX), "no literal of the marker prefix");
  assert.ok(!code.includes(MCP_TARGET_PREFIX), "no literal of the MCP target prefix");
  assert.ok(!code.includes("A-Za-z0-9"), "no literal server-name pattern");
  assert.ok(/from\s+"\.\.\/normalizer\/tool-class-format\.ts"/.test(code), "the vocabulary is imported from the grammar file");
  for (const m of MARKERS) assert.ok(m.startsWith(CLASS_MARKER_PREFIX), `${m} starts with the exported prefix`);
  assert.equal(buildMcpTarget({ server: "s", tool: "t" }), `${MCP_TARGET_PREFIX}s/t`);
  assert.ok(ADMISSIBLE_SERVER_NAME instanceof RegExp);
  assert.equal(CLASS_MARKER_PREFIX, "tool-class:", "the prefix is pinned: a change is a grammar change (G13)");
  assert.equal(MCP_TARGET_PREFIX, "mcp/", "the target prefix is pinned: a change is a grammar change (G13)");
  // S7-C (Issue #334, ruling Q3): the emitted-verb set is the imported catalog, never a retyped set
  assert.ok(/import\s*\{[^}]*\bKNOWN_VERBS\b[^}]*\}\s*from\s*"\.\.\/normalizer\/action-catalog\.ts"/.test(code), "KNOWN_VERBS is imported from the action catalog");
  for (const verb of KNOWN_VERBS) assert.ok(!new RegExp(`["'\`]${verb}["'\`]`).test(code), `no quoted literal of the catalog verb ${verb}`);
});

// --- S7-C (Issues #334 and #335): the two reachability residuals --------------------------------------------

const V2V3_SOURCES: { source: ReachabilitySource; label: string }[] = [
  { source: { layer: "central" }, label: "central" },
  { source: { layer: "shipped-defaults", file: "a/shipped.json" }, label: "shipped-defaults" },
  { source: { layer: "project", file: "a/project.json" }, label: "project" },
];

/** Shell-emitted records (the redirect corpus) whose target fails V2 or V3. */
function badTargetShellRecords(): { command: string; record: ActionRecord; target: string }[] {
  const out: { command: string; record: ActionRecord; target: string }[] = [];
  for (const call of mcpRedirectCalls()) {
    const record = normalize("shell", call);
    const target = record.targets[0];
    if (target !== undefined && failsV2OrV3(target)) out.push({ command: call.command, record, target });
  }
  return out;
}

test("R2-16 part 1 marker-plus-stray-rejected-through-loader (Issue #334, AC-334-3): a marker plus a verb no normalizer emits, with each V2 and V3 target, is a schema-invalid load failure on every layer for both effects, attributed to the layer that holds the rule, naming the rule id and rules[0].targets[0], with the layer-aware Unlock", () => {
  const problems: string[] = [];
  let cases = 0;
  for (const layer of LAYERS) {
    for (const effect of ["deny", "allow"] as const) {
      for (const stray of STRAY_VERBS) {
        for (const target of BAD_TARGETS) {
          cases += 1;
          const rule = makeRule(effect, "mixed-list", [MARKERS[0] as string, stray], [target]);
          problems.push(...loaderRejectionProblems(layer, `${layer} / ${effect} / stray ${JSON.stringify(stray)} / ${JSON.stringify(target)}`, rule));
        }
      }
    }
  }
  console.log(`R2-16 part 1: ${String(cases)} (layer x effect x stray verb x bad target) loads computed`);
  assert.deepEqual(problems, []);
});

test("R2-16 part 2 marker-plus-stray-soundness (Issue #334, AC-334-4): for every shell-emitted target under the MCP prefix that fails V2 or V3, a rule holding a marker and a stray verb is rejected AND the real kernel matcher matches it against zero records of the emitted corpus (shell, cluster, redirect-under-mcp and class records)", () => {
  const { records } = emittedCorpus();
  const badTargets = [...new Set(badTargetShellRecords().map((b) => b.target))];
  assert.ok(badTargets.length > 0, "the redirect corpus holds targets V2 or V3 rejects (the instrument must be able to fail)");
  let rules = 0;
  let matchedRecords = 0;
  const problems: string[] = [];
  for (const target of badTargets) {
    for (const marker of MARKERS) {
      for (const stray of STRAY_VERBS) {
        for (const effect of ["deny", "allow"] as const) {
          rules += 1;
          const rule = makeRule(effect, "mixed-sound", [marker, stray], [target]);
          if (checkRuleReachability(ruleSet(rule)).length === 0) problems.push(`${effect} [${marker}, ${JSON.stringify(stray)}] + ${JSON.stringify(target)}: loads, expected a rejection`);
          const matches = records.filter((r) => matchRules([rule], r).length > 0);
          matchedRecords += matches.length;
          if (matches.length > 0) problems.push(`${effect} [${marker}, ${JSON.stringify(stray)}] + ${JSON.stringify(target)}: the kernel matches ${String(matches.length)} emitted record(s), so rejecting it would be unsound`);
        }
      }
    }
  }
  console.log(`R2-16 part 2: ${String(rules)} marker-plus-stray rules over ${String(badTargets.length)} emitted bad targets, each checked against ${String(records.length)} emitted records; ${String(matchedRecords)} matches`);
  assert.deepEqual(problems, []);
});

test("R2-17 part 1 allow-widening-is-real (Issue #335, AC-335-3): through the REAL shell normalizer and the REAL kernel with a deny baseline, an allow rule with no verbs returns allow for a shell redirect record on a target the runtime never presents, and over the catalog verbs the verbs whose single-verb allow rule returns allow are exactly the write verb; the instrument can fail", () => {
  const bad = badTargetShellRecords();
  const targets = [...new Set(bad.map((b) => b.target))];
  assert.ok(targets.length > 0, "the corpus holds redirect targets V2 or V3 rejects");
  // for each such target: the plain redirect record plus verb-first shapes built from every catalog verb
  const probes: { target: string; record: ActionRecord }[] = [];
  for (const target of targets) {
    const commands = [`echo x > ${target}`];
    for (const v of CATALOG_VERBS) commands.push(`tool ${v} > ${target}`, `tool ${v} pods/x --context c > ${target}`, `tool ${v} x --context c > ${target}`);
    for (const command of commands) {
      const record = normalize("shell", { command, environment: "unknown", identity: "s7c-issue-335" });
      if (record.targets.includes(target)) probes.push({ target, record });
    }
  }
  const outcome = (rule: Rule, record: ActionRecord): string => decide({ rules: ruleSet(rule), defaultOutcome: "deny" }, record).outcome;
  let noVerbsAllowed = 0;
  const wideningVerbs = new Set<string>();
  for (const { target, record } of probes) {
    if (outcome(allow("no-verbs", undefined, [target]), record) === "allow") noVerbsAllowed += 1;
    for (const v of CATALOG_VERBS) if (outcome(allow(`only-${v}`, [v], [target]), record) === "allow") wideningVerbs.add(v);
  }
  console.log(`R2-17 part 1: ${String(targets.length)} bad targets, ${String(probes.length)} probe records; a no-verbs allow rule returned allow for ${String(noVerbsAllowed)}; verbs whose single-verb allow rule returned allow: ${JSON.stringify([...wideningVerbs].sort())}`);
  assert.ok(noVerbsAllowed > 0, "a no-verbs allow rule widens: the kernel allows a real shell redirect record under a deny baseline");
  assert.deepEqual([...wideningVerbs], ["write"], "only the write verb widens (a redirect record carries no other verb without also carrying an unresolved field, which the kernel denies before any rule)");
  // the instrument can fail: an allow rule aimed at a different target does not match, and the same verdict function says deny
  const first = probes[0];
  assert.ok(first !== undefined);
  assert.equal(outcome(allow("elsewhere", undefined, [`${MCP_TARGET_PREFIX}some-other-place/`]), first.record), "deny", "a rule that does not match yields the deny baseline, so an allow above is a real match");
});

test("R2-17 part 2 allow-without-verbs-rejected (Issue #335, AC-335-1, AC-335-2): an allow rule with no verbs field or an empty verbs array on each V2 and V3 target is a schema-invalid load failure on every layer; the message names the rule id and rules[0].targets[0], says the rule has no verbs and can match only a shell redirect, and the Unlock names the fix (a class marker verb and the sanitized name with a trailing slash); every emitted bad target is rejected too", () => {
  const problems: string[] = [];
  let cases = 0;
  for (const layer of LAYERS) {
    for (const [shape, verbs] of [["absent", undefined], ["empty", []]] as const) {
      for (const target of BAD_TARGETS) {
        cases += 1;
        const where = `${layer} / verbs ${shape} / ${JSON.stringify(target)}`;
        const rule = allow("no-verbs-allow", verbs === undefined ? undefined : [...verbs], [target]);
        problems.push(...loaderRejectionProblems(layer, where, rule));
        const r = loadOnLayer(layer, [rule]).result;
        if (r.ok) continue;
        if (!r.message.includes("has no verbs")) problems.push(`${where}: the message does not say the rule has no verbs: ${r.message}`);
        if (!/matches every verb/.test(r.message)) problems.push(`${where}: the message does not say the rule matches every verb: ${r.message}`);
        if (!/shell redirect/.test(r.message)) problems.push(`${where}: the message does not say it can match only a shell redirect: ${r.message}`);
        const unlock = r.message.slice(r.message.indexOf("Unlock:"));
        if (!/class marker verb/.test(unlock)) problems.push(`${where}: the unlock does not name the class marker fix: ${unlock}`);
        for (const m of MARKERS) if (!unlock.includes(m)) problems.push(`${where}: the unlock does not list the marker ${m}: ${unlock}`);
        if (!unlock.includes('/"')) problems.push(`${where}: the unlock does not show the trailing slash: ${unlock}`);
      }
    }
  }
  const emitted = [...new Set(badTargetShellRecords().map((b) => b.target))];
  for (const target of emitted) {
    for (const verbs of [undefined, []] as (string[] | undefined)[]) {
      if (checkRuleReachability(ruleSet(allow("emitted-target", verbs, [target]))).length === 0) problems.push(`emitted target ${JSON.stringify(target)} with verbs ${JSON.stringify(verbs)}: an allow rule loaded, expected a rejection`);
    }
  }
  console.log(`R2-17 part 2: ${String(cases)} (layer x verbs shape x bad target) loads computed; ${String(emitted.length * 2)} emitted-target rules rejected by the check`);
  assert.deepEqual(problems, []);
});

test("R2-17 part 3 ruled-edges-hold (Issue #335, AC-335-4): an allow rule keeps loading with write or any single catalog verb on a bad target, with no verbs on a well-formed or non-MCP target and on the bare MCP prefix; an allow with a marker alone on a bad target is still rejected; a deny rule with no verbs or empty verbs on the same targets loads", () => {
  const problems: string[] = [];
  const expectLoads = (label: string, rule: Rule): void => {
    const errors = checkRuleReachability(ruleSet(rule));
    if (errors.length > 0) problems.push(`${label}: rejected: ${errors[0]?.message ?? ""}`);
  };
  for (const target of BAD_TARGETS) {
    for (const v of CATALOG_VERBS) expectLoads(`allow [${v}] + ${JSON.stringify(target)}`, allow("edge-verb", [v], [target]));
    expectLoads(`deny with no verbs + ${JSON.stringify(target)}`, deny("edge-deny-none", undefined, [target]));
    expectLoads(`deny with empty verbs + ${JSON.stringify(target)}`, deny("edge-deny-empty", [], [target]));
    if (checkRuleReachability(ruleSet(allow("edge-marker", [MARKERS[0] as string], [target]))).length === 0) problems.push(`allow [marker] + ${JSON.stringify(target)}: loaded, expected the all-markers rejection`);
  }
  for (const ok of [`${MCP_TARGET_PREFIX}standin-x/`, `${MCP_TARGET_PREFIX}standin-x/some-tool`, MCP_TARGET_PREFIX, "src/policy/", "docs/notes.md"]) {
    expectLoads(`allow with no verbs + ${JSON.stringify(ok)}`, allow("edge-ok", undefined, [ok]));
    expectLoads(`allow with empty verbs + ${JSON.stringify(ok)}`, allow("edge-ok-empty", [], [ok]));
  }
  expectLoads("allow with no verbs and no targets", allow("edge-bare"));
  console.log(`R2-17 part 3: ${String(BAD_TARGETS.length)} bad targets x ${String(CATALOG_VERBS.length)} catalog verbs, plus the ruled edges, checked`);
  assert.deepEqual(problems, []);
});

/** Verbs found in `emitted` that are neither a catalog verb nor a class marker. */
function outsideCatalogAndMarkers(emitted: Iterable<string>): string[] {
  return [...new Set(emitted)].filter((v) => !KNOWN_VERBS.has(v) && !MARKERS.includes(v));
}

test("R2-19 emitted-verbs-subset-of-known-verbs (Issue #334, AC-334-7): every verb the real shell, cluster and tool-class normalizers emit, over the golden corpus, the redirect corpus, each catalog verb through verb-first shell and cluster shapes, and every class, is a catalog verb or a class marker; the comparator can fail", () => {
  const emitted = new Set<string>();
  const { records } = emittedCorpus();
  for (const r of records) for (const v of r.verbs) emitted.add(v);
  let probes = 0;
  const cluster = (verb: string): ActionRecord => normalize("cluster", { verb, resourceType: "pods", resourceName: "x", cluster: "c", environment: "unknown", identity: "r2-19" });
  for (const v of CATALOG_VERBS) {
    for (const raw of [v, v.toUpperCase(), ` ${v} `]) {
      for (const command of [`tool ${raw} pods/x --context c`, `tool ${raw} x --context c > out.txt`, `tool ${raw} pods/x --context c > out.txt`]) {
        probes += 1;
        for (const verb of normalize("shell", { command, environment: "unknown", identity: "r2-19" }).verbs) emitted.add(verb);
      }
      probes += 1;
      for (const verb of cluster(raw).verbs) emitted.add(verb);
    }
  }
  for (const verb of ["not-a-catalog-verb", "", MARKERS[0] as string]) for (const v of cluster(verb).verbs) emitted.add(v);
  console.log(`R2-19: ${String(emitted.size)} distinct emitted verbs over ${String(records.length)} corpus records and ${String(probes)} extra probes; ${String(KNOWN_VERBS.size)} catalog verbs, ${String(MARKERS.length)} markers`);
  assert.ok(emitted.size > 0);
  assert.deepEqual(outsideCatalogAndMarkers(emitted), [], "a normalizer emits a verb outside the action catalog: the reachability check would wrongly reject a rule that can match it, so extend the catalog import or the check");
  // the instrument can fail: a synthetic extra emitted verb is reported, a catalog verb and a marker are not
  assert.deepEqual(outsideCatalogAndMarkers([...emitted, "synthetic-extra-verb"]), ["synthetic-extra-verb"]);
  assert.deepEqual(outsideCatalogAndMarkers([...CATALOG_VERBS, ...MARKERS]), []);
});

test("R2-20 mixed-list-message-wording (Issue #334, AC-334-8): for a marker plus a stray verb the V2 and V3 text says the verbs hold a class marker and no verb any normalizer emits, not that they are class markers only; the all-markers text keeps its meaning; every text ends in a layer-aware Unlock", () => {
  const problems: string[] = [];
  let messages = 0;
  for (const { source, label } of V2V3_SOURCES) {
    for (const target of BAD_TARGETS) {
      for (const [kind, verbs] of [["mixed", [MARKERS[0] as string, "some-other-verb"]], ["all-markers", [MARKERS[0] as string]]] as const) {
        const errors = checkRuleReachability(ruleSet(deny("wording", [...verbs], [target])), source);
        if (errors.length === 0) {
          problems.push(`${label} / ${kind} / ${JSON.stringify(target)}: no error`);
          continue;
        }
        for (const e of errors) {
          messages += 1;
          const where = `${label} / ${kind} / ${JSON.stringify(target)}`;
          if (kind === "mixed") {
            if (/class markers only/.test(e.message)) problems.push(`${where}: still says the verbs are class markers only: ${e.message}`);
            if (!/hold a class marker and no verb any normalizer emits/.test(e.message)) problems.push(`${where}: does not say the list holds a class marker and no verb any normalizer emits: ${e.message}`);
          } else if (!/class markers only/.test(e.message)) {
            problems.push(`${where}: the all-markers text lost its meaning: ${e.message}`);
          }
          if (!/Unlock: (the central policy owner must correct|edit a\/)/.test(e.message)) problems.push(`${where}: no layer-aware Unlock: ${e.message}`);
        }
      }
    }
  }
  console.log(`R2-20: ${String(messages)} messages checked`);
  assert.deepEqual(problems, []);
});
