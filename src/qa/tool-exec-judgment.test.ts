// Issues #429 and #424 (S7): every vendored tool is JUDGED exec / not-exec, recorded in docs/qa/tool-exec-judgment.json
// (a hand-judged file beside the generated tool-inventory.json, which a re-vendor overwrites). The K matcher and the
// residual (pendingHumanDecision) list are DERIVED from the judgments; nothing is retyped here.
// Plan: docs/plans/s429-tool-exec-judgment-plan-2026-10-05.md. Written FAILING FIRST (the data file and helper do not exist).
// Live-probe fact (docs/qa/s7-live-probes/README.md, P1): the subagent tool is `Task` in the init list and `Agent` at call
// time, so the judgment table carries an alias pair; a test fails if only one name is present.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { REQUIRED_PROTECTED_ENTRIES, checkJudgments, deriveMatcher, loadJudgments, residualEntries, routedTools, type JudgmentFile } from "./tool-exec-judgment.ts";
import { protectedPaths } from "./protected-path-list.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PROPOSAL_JSON = `${ROOT}docs/plans/s308-K-proposed-entry-2026-10-05.json`;
const PROPOSAL_MD = `${ROOT}docs/plans/s308-K-proposed-entry-2026-10-05.md`;
const inventory = (): string[] => (JSON.parse(readFileSync(`${ROOT}docs/qa/tool-inventory.json`, "utf8")) as { tools: string[] }).tools;
const clone = (f: JudgmentFile): JudgmentFile => JSON.parse(JSON.stringify(f)) as JudgmentFile;
interface Proposal {
  proposedMatcher: string;
  pendingHumanDecision: Array<{ tool: string; routingBreaks: string; residualCondition?: string }>;
}
const proposal = (): Proposal => JSON.parse(readFileSync(PROPOSAL_JSON, "utf8")) as Proposal;

/** The AP-12 arrays, read by AST from the instrument source (never retyped). */
function ap12Names(): { named: string[]; added: string[] } {
  const path = `${ROOT}src/qa/arbitrary-exec-classification.test.ts`;
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const out = { named: [] as string[], added: [] as string[] };
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined && ts.isArrayLiteralExpression(n.initializer)) {
      const target = n.name.text === "AP12_NAMED" ? out.named : n.name.text === "ADDED_BUILTINS" ? out.added : undefined;
      if (target !== undefined) for (const e of n.initializer.elements) if (ts.isStringLiteralLike(e)) target.push(e.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

test("K-every-vendored-tool-judged-exec: every vendored tool has exactly one judgment with a reason, and no judgment names an unvendored tool (except a documented alias)", () => {
  const file = loadJudgments();
  const inv = inventory();
  assert.ok(inv.length >= 40, "the inventory is read");
  assert.deepEqual(checkJudgments(file, inv), []);
  const judged = new Set(file.judgments.map((j) => j.tool));
  for (const t of inv) assert.ok(judged.has(t), `unjudged vendored tool: ${t}`);
  console.log(`K-judgments: ${String(inv.length)} vendored tools, ${String(file.judgments.length)} judgments (${String(file.judgments.length - inv.length)} alias)`);
});

test("K-every-vendored-tool-judged-exec mutant: unjudged new tool", () => {
  const found = checkJudgments(loadJudgments(), [...inventory(), "BrandNewExecTool"]);
  assert.ok(found.some((l) => l.includes("BrandNewExecTool")), found.join("\n"));
});
test("K-every-vendored-tool-judged-exec mutant: empty reason", () => {
  const f = clone(loadJudgments());
  f.judgments[0]!.reason = "  ";
  assert.ok(checkJudgments(f, inventory()).some((l) => l.includes(f.judgments[0]!.tool)));
});
test("K-every-vendored-tool-judged-exec mutant: duplicate", () => {
  const f = clone(loadJudgments());
  f.judgments.push({ ...f.judgments[0]! });
  assert.ok(checkJudgments(f, inventory()).some((l) => l.includes("duplicate")));
});
test("K-every-vendored-tool-judged-exec mutant: dead entry", () => {
  const f = clone(loadJudgments());
  f.judgments.push({ tool: "NotAVendoredTool", judgment: "not-exec", reason: "dead" });
  assert.ok(checkJudgments(f, inventory()).some((l) => l.includes("NotAVendoredTool")));
});
test("K-every-vendored-tool-judged-exec mutant: an unknown judgment value, a residual without a condition, a routed tool with a condition", () => {
  const base = loadJudgments();
  const a = clone(base);
  a.judgments[0]!.judgment = "maybe" as never;
  assert.ok(checkJudgments(a, inventory()).length > 0);
  const b = clone(base);
  delete b.judgments.find((j) => j.judgment === "exec-residual")!.residualCondition;
  assert.ok(checkJudgments(b, inventory()).some((l) => l.includes("residualCondition")));
  const c = clone(base);
  c.judgments.find((j) => j.judgment === "exec-routed")!.residualCondition = "none";
  assert.ok(checkJudgments(c, inventory()).some((l) => l.includes("residualCondition")));
});

test("K-subagent-alias-pair: Task and Agent are both judged exec-residual with the same condition, both in AP-12, both pending, both in the K md; dropping either fails", () => {
  const file = loadJudgments();
  const task = file.judgments.find((j) => j.tool === "Task");
  const agent = file.judgments.find((j) => j.tool === "Agent");
  assert.ok(task !== undefined && agent !== undefined, "both names are judged");
  assert.equal(agent.aliasOf, "Task");
  assert.equal(agent.judgment, task.judgment);
  assert.equal(agent.residualCondition, task.residualCondition);
  assert.ok(existsSync(`${ROOT}${agent.evidence ?? "missing"}`), "the alias names its evidence file");
  const ap = ap12Names();
  const exec = new Set([...ap.named, ...ap.added]);
  assert.ok(exec.has("Task") && exec.has("Agent"), "AP-12 carries both names");
  const pending = new Set(proposal().pendingHumanDecision.map((x) => x.tool));
  assert.ok(pending.has("Task") && pending.has("Agent"), "the K pending list carries both names");
  const md = readFileSync(PROPOSAL_MD, "utf8");
  assert.ok(/\|\s*Task\s*\|/.test(md) && /\|\s*Agent\s*\|/.test(md), "the K md table carries both names");
  // mutants: only one of the pair present in the judgments
  for (const drop of ["Task", "Agent"]) {
    const f = clone(file);
    f.judgments = f.judgments.filter((j) => j.tool !== drop);
    assert.ok(checkJudgments(f, inventory()).length > 0, `mutant: ${drop} dropped from the judgments is detected`);
  }
});

test("K-matcher-derived-from-judgments: the proposed matcher equals the derived one; every routed tool is matched, no residual or not-exec tool is", () => {
  const file = loadJudgments();
  const derived = deriveMatcher(file);
  assert.equal(derived, "Bash|Monitor|PowerShell|RemoteTrigger|mcp__.*");
  assert.equal(proposal().proposedMatcher, derived);
  assert.ok(readFileSync(PROPOSAL_MD, "utf8").includes(derived), "the md carries the derived matcher");
  const re = new RegExp(`^(?:${proposal().proposedMatcher})$`);
  for (const j of file.judgments) assert.equal(re.test(j.tool), j.judgment === "exec-routed", `${j.tool} (${j.judgment})`);
});
test("K-matcher-derived-from-judgments mutants: flipping Monitor, RemoteTrigger or PowerShell off routed moves the derived matcher off the proposal; a residual tool flipped to routed does too", () => {
  const file = loadJudgments();
  for (const drop of ["Monitor", "RemoteTrigger", "PowerShell"]) {
    const f = clone(file);
    const e = f.judgments.find((j) => j.tool === drop)!;
    e.judgment = "exec-residual";
    e.residualCondition = "none";
    assert.notEqual(deriveMatcher(f), proposal().proposedMatcher, `mutant ${drop}`);
  }
  const f = clone(file);
  const s = f.judgments.find((j) => j.tool === "Skill")!;
  s.judgment = "exec-routed";
  delete s.residualCondition;
  assert.ok(deriveMatcher(f).includes("Skill") && deriveMatcher(f) !== proposal().proposedMatcher);
  assert.ok(routedTools(file).length >= 4);
});

test("K-pending-equals-residual-judgments: pendingHumanDecision tools equal the exec-residual set, each with the judged condition and non-empty routingBreaks; no routed tool remains", () => {
  const file = loadJudgments();
  const want = residualEntries(file).map((e) => e.tool).sort();
  const p = proposal().pendingHumanDecision;
  assert.deepEqual(p.map((x) => x.tool).sort(), want);
  const routed = new Set(routedTools(file));
  for (const x of p) {
    assert.ok(!routed.has(x.tool), `${x.tool} is routed, so not pending`);
    assert.ok(x.routingBreaks.trim().length > 0, x.tool);
    assert.equal(x.residualCondition, file.judgments.find((j) => j.tool === x.tool)!.residualCondition, `${x.tool} condition`);
  }
});

test("K-md-matches-judgments: the md pending table names every residual tool and no routed tool", () => {
  const file = loadJudgments();
  const md = readFileSync(PROPOSAL_MD, "utf8");
  const section = md.split(/^## /m).find((s) => s.startsWith("Pending human decision"));
  assert.ok(section !== undefined, "pending section exists");
  const cells = [...section.matchAll(/^\|\s*([A-Za-z]+)\s*\|/gm)].map((m) => m[1]!).filter((c) => c !== "Tool");
  assert.deepEqual([...cells].sort(), residualEntries(file).map((e) => e.tool).sort());
  for (const r of routedTools(file)) assert.ok(!cells.includes(r), `${r} is routed, not pending`);
});

test("K-inner-calls-condition-recorded: while tools carry inner-calls-gated, the md has a K release gate line naming the probe, and each such judgment cites it", () => {
  const file = loadJudgments();
  const inner = file.judgments.filter((j) => j.residualCondition === "inner-calls-gated");
  assert.ok(inner.length >= 4, "Task, Agent, SendMessage, Workflow");
  const md = readFileSync(PROPOSAL_MD, "utf8");
  const line = md.split("\n").find((l) => l.includes("K release gate"));
  assert.ok(line !== undefined && line.includes("docs/qa/s7-live-probes/README.md"), "release-gate line names the probe evidence");
  for (const j of inner) assert.ok(`${j.evidence ?? ""} ${j.reason}`.includes("s7-live-probes"), `${j.tool} cites the probe`);
});

test("AP12-set-equals-exec-judgments: the AP-12 arrays (by AST) equal exec-routed union exec-residual, in both directions", () => {
  const file = loadJudgments();
  const ap = ap12Names();
  const got = [...new Set([...ap.named, ...ap.added])].sort();
  const want = file.judgments.filter((j) => j.judgment !== "not-exec").map((j) => j.tool).sort();
  assert.deepEqual(got, want);
  assert.ok(got.includes("SendMessage") && got.includes("Agent"));
  const f = clone(file);
  const m = f.judgments.find((j) => j.tool === "SendMessage")!;
  m.judgment = "not-exec";
  delete m.residualCondition;
  assert.notDeepEqual(f.judgments.filter((j) => j.judgment !== "not-exec").map((j) => j.tool).sort(), got, "mutant: a judgment flip diverges from AP-12");
});

test("K-residual-condition-has-instrument: a tool judged authorable-content-protected needs every required entry in the protected named list", () => {
  const file = loadJudgments();
  const named = new Set(protectedPaths(ROOT).named);
  const carriers = file.judgments.filter((j) => j.residualCondition === "authorable-content-protected").map((j) => j.tool).sort();
  assert.deepEqual(carriers, ["Skill", "SlashCommand"]);
  const required = REQUIRED_PROTECTED_ENTRIES["authorable-content-protected"];
  assert.equal(required.length, 7);
  for (const e of required) assert.ok(named.has(e), `protected entry missing: ${e}`);
  // mutant: the list without one required entry is detected
  const without = new Set([...named].filter((n) => n !== "~/.claude/plugins/"));
  assert.deepEqual(required.filter((e) => !without.has(e)), ["~/.claude/plugins/"]);
});
