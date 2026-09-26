// S7-B (Issue #306, ruling R2): a policy rule that provably cannot match any record the normalizers emit
// is a load error, not a silent no-op (docs/plans/s7b-policy-authoring-safety-phase1-2026-09-26.md,
// R2-1 to R2-4 and R2-6 to R2-8). story-implementer's own tests, written failing first. The loader-level
// half (R2-5, R2-9, R2-10) is loader-reachability.test.ts.
//
// Three checks, applied per element of `verbs` and `targets`:
//   V1 a verb starting with the class-marker prefix that is not one of the three markers;
//   V2 a target that is the MCP prefix plus a server name with no trailing "/" (no record's target is a
//      server alone, and a pattern without a trailing "/" matches exactly);
//   V3 a target under the MCP prefix whose server segment is not an admitted server name.
// NOT rejected (documented): legacy mutating verbs plus an MCP target (shape c: matches only
// shell-forged records).
//
// NAMES. Stand-in server names only; committed fixture names are read at run time (G19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkRuleReachability } from "./rule-reachability.ts";
import { ADMISSIBLE_SERVER_NAME, CLASS_MARKER_PREFIX, CLASS_MARKER_VERBS, MCP_TARGET_PREFIX, buildMcpTarget, sanitizeMcpName } from "../normalizer/tool-class-format.ts";
import { KNOWN_VERBS } from "../normalizer/action-catalog.ts";
import { normalize } from "../normalizer/registry.ts";
import "../normalizer/shell.ts";
import "../normalizer/structured-cluster.ts";
import "../normalizer/tool-class.ts";
import * as calls from "../fixtures/normalizer-calls.ts";
import { decide } from "../kernel/kernel.ts";
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
function deny(id: string, verbs?: string[], targets?: string[]): Rule {
  const rule: Rule = { id, effect: "deny" };
  if (verbs !== undefined) rule.verbs = verbs;
  if (targets !== undefined) rule.targets = targets;
  return rule;
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

test("R2-2 v2-no-trailing-slash: a server target without a slash rejects; with a slash, with a tool segment, and the bare prefix load", () => {
  for (const server of STANDIN_SERVERS) {
    const errors = checkRuleReachability(ruleSet(deny("noslash", undefined, [`${MCP_TARGET_PREFIX}${server}`])));
    assert.equal(errors.length, 1, `${server} without a slash rejects exactly once`);
    assert.equal(errors[0]?.field, "rules[0].targets[0]");
    assert.ok(errors[0]?.message.includes(JSON.stringify("noslash")));
    assert.ok(errors[0]?.message.includes(`${MCP_TARGET_PREFIX}${server}/`), "the message shows the corrected shape");
    for (const ok of [`${MCP_TARGET_PREFIX}${server}/`, `${MCP_TARGET_PREFIX}${server}/some-tool`, MCP_TARGET_PREFIX]) {
      assert.deepEqual(checkRuleReachability(ruleSet(deny("fine", undefined, [ok]))), [], `${ok} loads`);
    }
  }
});

test("R2-3 v3-declared-name: server segments with a space, colon, dot, underscore or empty reject; letters, digits and hyphen load; the tool segment is not checked here", () => {
  const badServers = ["standin x", "standin:x", "standin.x", "standin_x", ""];
  for (const server of badServers) {
    const target = `${MCP_TARGET_PREFIX}${server}/tool`;
    const errors = checkRuleReachability(ruleSet(deny("declared", undefined, [target])));
    assert.equal(errors.length, 1, `${JSON.stringify(target)} rejects exactly once (the slash is present, so only V3 speaks)`);
    assert.equal(errors[0]?.field, "rules[0].targets[0]");
    assert.ok(errors[0]?.message.includes(ADMISSIBLE_SERVER_NAME.source), "the message states the admitted pattern");
  }
  assert.equal(checkRuleReachability(ruleSet(deny("emptyprefix", undefined, [`${MCP_TARGET_PREFIX}/`]))).length, 1, "an empty server segment with a trailing slash rejects");
  for (const server of ["standin-x", "Abc-123", "9", "a-b-c"]) {
    assert.deepEqual(checkRuleReachability(ruleSet(deny("named", undefined, [`${MCP_TARGET_PREFIX}${server}/`]))), [], `${server} loads`);
  }
  assert.deepEqual(checkRuleReachability(ruleSet(deny("toolseg", undefined, [`${MCP_TARGET_PREFIX}standin-x/some tool with spaces.and.dots`]))), [], "the tool segment is not checked");
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

// --- drift instruments -------------------------------------------------------------------------

function emittedCorpus(): { verbs: Set<string>; targets: Set<string>; shellClusterTargets: string[]; records: number } {
  const verbs = new Set<string>();
  const targets = new Set<string>();
  const shellClusterTargets: string[] = [];
  let records = 0;
  const take = (r: ActionRecord, fromShellOrCluster: boolean): void => {
    records += 1;
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

test("R2-6 drift-emitted-vocabulary-accepted: every verb and every target a normalizer emits over the golden corpus, used as a one-element rule, passes the check; the corpus is non-empty and holds no shell-emitted target under the MCP prefix", () => {
  const { verbs, targets, shellClusterTargets, records } = emittedCorpus();
  console.log(`R2-6: ${String(records)} records normalized; ${String(verbs.size)} distinct verbs and ${String(targets.size)} distinct targets used as one-element rules`);
  assert.ok(records > 0 && verbs.size > 0 && targets.size > 0, "the corpus is non-empty");
  assert.ok(shellClusterTargets.length > 0, "the shell and cluster corpus emits targets");
  assert.deepEqual(shellClusterTargets.filter((t) => t.startsWith(MCP_TARGET_PREFIX)), [], "no shell or cluster record in the corpus carries a target under the MCP prefix (a forged one would be rejected by V2 by ruling; this makes that a decision, not an accident)");
  const rejected: string[] = [];
  for (const v of verbs) {
    for (const e of checkRuleReachability(ruleSet(deny("drift-verb", [v])))) rejected.push(`verb ${JSON.stringify(v)}: ${e.message}`);
  }
  for (const t of targets) {
    for (const e of checkRuleReachability(ruleSet(deny("drift-target", undefined, [t])))) rejected.push(`target ${JSON.stringify(t)}: ${e.message}`);
  }
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

test("R2-8 no-retyped-vocabulary: the new module holds no literal of the marker prefix, the MCP target prefix or the server-name pattern; the marker table values start with the exported prefix; the target builder produces the exported prefix", () => {
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
});
