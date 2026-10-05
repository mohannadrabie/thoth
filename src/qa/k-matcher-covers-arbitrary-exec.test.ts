// #308 story J review condition (Issue #426, HIGH): `K-matcher-covers-arbitrary-exec`. J3 showed the PowerShell tool
// running un-gated after a Bash denial, so the proposed PreToolUse matcher must route every arbitrary-execution tool
// or the proposal must list the tool, with what routing would break, in an explicit pendingHumanDecision list.
// Nothing is hand-derived: the tool set is READ from the AP-12 instrument (src/qa/arbitrary-exec-classification.test.ts,
// its AP12_NAMED and ADDED_BUILTINS arrays, by AST), the measured inventory is docs/qa/tool-inventory.json, and the
// matcher and the pending list are read from the K proposal file. written FAILING FIRST against a missing proposal file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PROPOSAL_JSON = `${ROOT}docs/plans/s308-K-proposed-entry-2026-10-05.json`;
const PROPOSAL_MD = `${ROOT}docs/plans/s308-K-proposed-entry-2026-10-05.md`;

interface Pending {
  tool: string;
  routingBreaks: string;
}
interface Proposal {
  proposedMatcher: string;
  proposedCommand: string;
  timeout: number;
  pendingHumanDecision: Pending[];
}

/** The arbitrary-execution tool names, read from the instrument's source by AST (never retyped here). */
function arbitraryExecNames(): string[] {
  const path = `${ROOT}src/qa/arbitrary-exec-classification.test.ts`;
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const want = new Set(["AP12_NAMED", "ADDED_BUILTINS"]);
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && want.has(n.name.text) && n.initializer !== undefined && ts.isArrayLiteralExpression(n.initializer)) {
      for (const e of n.initializer.elements) if (ts.isStringLiteralLike(e)) out.push(e.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Tools neither matched by the matcher (regex alternatives, anchored) nor listed as pending. Empty means covered. */
function uncovered(matcher: string, pendingTools: readonly string[], tools: readonly string[]): string[] {
  const re = new RegExp(`^(?:${matcher})$`);
  const pending = new Set(pendingTools);
  return tools.filter((t) => !re.test(t) && !pending.has(t));
}

const proposal = (): Proposal => JSON.parse(readFileSync(PROPOSAL_JSON, "utf8")) as Proposal;

test("K-matcher-covers-arbitrary-exec: every arbitrary-execution tool is matched by the proposed matcher or listed pending, and each pending entry says what routing would break", () => {
  const p = proposal();
  const tools = arbitraryExecNames();
  assert.ok(tools.length >= 10, `the instrument yields its tool set (${tools.join(",")})`);
  const inventory = (JSON.parse(readFileSync(`${ROOT}docs/qa/tool-inventory.json`, "utf8")) as { tools: string[] }).tools;
  const measured = tools.filter((t) => inventory.includes(t));
  console.log(`K-matcher: ${String(tools.length)} instrument tools, ${String(measured.length)} in the measured inventory; matcher ${p.proposedMatcher}`);
  const pendingTools = p.pendingHumanDecision.map((x) => x.tool);
  assert.deepEqual(uncovered(p.proposedMatcher, pendingTools, measured), [], "every measured arbitrary-exec tool is routed or pending");
  assert.deepEqual(uncovered(p.proposedMatcher, pendingTools, tools), [], "every instrument tool is routed or pending");
  for (const x of p.pendingHumanDecision) {
    assert.ok(tools.includes(x.tool), `${x.tool} is an arbitrary-exec tool`);
    assert.ok(!new RegExp(`^(?:${p.proposedMatcher})$`).test(x.tool), `${x.tool} is pending but also matched (stale entry)`);
    assert.ok(x.routingBreaks.trim().length > 0, `${x.tool} states what routing it would break`);
  }
  assert.equal(new Set(pendingTools).size, pendingTools.length, "no duplicate pending entry");
});

test("K-matcher-covers-arbitrary-exec mutants: dropping PowerShell from the matcher fails; an empty pending list fails; a stale pending entry is detected", () => {
  const p = proposal();
  const tools = arbitraryExecNames();
  const noPs = p.proposedMatcher.split("|").filter((t) => t !== "PowerShell").join("|");
  assert.notEqual(noPs, p.proposedMatcher, "the proposed matcher routes PowerShell");
  assert.deepEqual(uncovered(noPs, p.pendingHumanDecision.map((x) => x.tool), tools), ["PowerShell"], "mutant: PowerShell missing from the matcher");
  assert.ok(uncovered(p.proposedMatcher, [], tools).length > 0, "mutant: empty pending list");
  assert.ok(uncovered(p.proposedMatcher, p.pendingHumanDecision.map((x) => x.tool), tools).length === 0, "control");
});

test("the K proposal text and the machine-readable entry agree: shell form, timeout 60, the same matcher", () => {
  const p = proposal();
  const md = readFileSync(PROPOSAL_MD, "utf8");
  assert.ok(md.includes(p.proposedMatcher), "the markdown proposal carries the same matcher");
  assert.match(p.proposedCommand, /^sh "\$\{CLAUDE_PROJECT_DIR\}\/hooks\/launch-gate\.sh" "\$\{CLAUDE_PROJECT_DIR\}\/hooks\/pretooluse-kernel-gate\.mjs"$/);
  assert.equal(p.timeout, 60);
});
