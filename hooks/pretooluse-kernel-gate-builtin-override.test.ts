// Black-box acceptance test PT-7, hook level, for S7-B (Issue #305, ruling R1): a central
// classification fixture entry whose name equals a built-in layer entry name and whose class is
// LOWER than that built-in's must make the classification catalog fail to assemble, so an MCP tool
// call through the real gate hook fails closed. Written FIRST by test-writer, before any production
// code exists (docs/plans/s7b-policy-authoring-safety-phase1-2026-09-26.md, sections 5.1 (R1-8) and 7).
//
// EXPECTED OUTCOMES (the answer key)
//   - lowering entry:            exit 2, EMPTY stdout, the hook's ONE fixed stderr line, and no leak of
//                                the entry name, any class string, or the sandbox fixture path.
//   - raising / same-class entry, and the unmodified fixture: the hook decides normally, which for an
//                                MCP call of a classified server with the empty sandbox policy is a
//                                silent allow (exit 0, empty stdout, empty stderr; the H1 shape).
//
// RUN-TIME ENUMERATION (no hand-typed completeness claim). The built-in names and their classes are
// read from the real built-in layer at run time (loadBuiltinToolClassificationLayer). The lowering,
// raising and same-class case lists are DERIVED from that layer and the class order below; the
// tests print the counts they computed. The class order is the ruling's own oracle (read-only <
// workspace-mutating < remote-mutating); a test asserts every class found in the built-in layer is in
// that order, so a fourth class cannot slip past unnoticed.
//
// NAMES. No committed fixture entry name is typed here (THOTH-ADR-0001 rule 1, G19): the MCP server
// name used for the call is read from the committed fixture at run time.
//
// NOT IN SCOPE for this file: Write, Edit, Task and Bash calls (they never load the catalog; the
// locked H8 covers them and is not edited). The SessionStart side of R1 and the catalog-level unit
// checks are story-implementer-owned (R1-1 to R1-7).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadBuiltinToolClassificationLayer } from "../src/policy/tools/builtin-tool-inventory.ts";
import { createGateSandbox, describeRun, firstCommittedEntryName, isSilentAllow, readCommittedFixture, type GateRun, type GateSandbox } from "./test-support/gate-sandbox.ts";

// The ruling's class order, lowest first. This is the oracle, not an enumeration of anything.
const CLASS_ORDER: readonly string[] = ["read-only", "workspace-mutating", "remote-mutating"];

function rank(toolClass: string): number {
  const r = CLASS_ORDER.indexOf(toolClass);
  if (r < 0) throw new Error(`class ${JSON.stringify(toolClass)} is not in the ruled class order`);
  return r;
}

interface Pair {
  builtinName: string;
  builtinClass: string;
  entryClass: string;
}

/** Every (built-in, class) pair, derived at run time from the real built-in layer and the class order. */
function derivePairs(): { lowering: Pair[]; raising: Pair[]; sameClass: Pair[]; builtinCount: number } {
  const layer = loadBuiltinToolClassificationLayer();
  const lowering: Pair[] = [];
  const raising: Pair[] = [];
  const sameClass: Pair[] = [];
  for (const b of layer.tools) {
    for (const c of CLASS_ORDER) {
      const pair: Pair = { builtinName: b.name, builtinClass: b.class, entryClass: c };
      if (rank(c) < rank(b.class)) lowering.push(pair);
      else if (rank(c) > rank(b.class)) raising.push(pair);
      else sameClass.push(pair);
    }
  }
  return { lowering, raising, sameClass, builtinCount: layer.tools.length };
}

/** The sandbox fixture becomes: every committed entry, plus one entry that shares a built-in's name. */
function plantEntry(sb: GateSandbox, pair: Pair): void {
  const committed = readCommittedFixture().centralLayer.tools;
  sb.setEntries([...committed, { name: pair.builtinName, class: pair.entryClass }]);
}

// The gate's fixed fail-closed line: what happened, the unlock clause, the error TYPE (letters only).
const FIXED_LINE = /^pretooluse-kernel-gate\.mjs: [^\n]+, fail-closed \(exit 2\)\. Unlock: [^\n]*Error type: [A-Za-z]{1,40}\n$/;

/** Returns a list of what is wrong with a run that should be the fail-closed exit 2 (empty means correct). */
function failClosedProblems(run: GateRun, sb: GateSandbox, pair: Pair): string[] {
  const problems: string[] = [];
  if (run.code !== 2) problems.push(`exit code ${String(run.code)} (expected 2)`);
  if (run.stdout !== "") problems.push("stdout is not empty");
  if (!FIXED_LINE.test(run.stderr)) problems.push("stderr is not the single fixed fail-closed line");
  const leakTerms: [string, string][] = [
    ["entry name", pair.builtinName],
    ["fixture path", sb.fixturePath],
    ["sandbox root", sb.root],
    ...CLASS_ORDER.map((c): [string, string] => [`class string ${JSON.stringify(c)}`, c]),
  ];
  for (const [label, term] of leakTerms) {
    if (run.stdout.includes(term) || run.stderr.includes(term)) problems.push(`leaks the ${label}`);
  }
  return problems;
}

function describePair(p: Pair): string {
  return `built-in ${JSON.stringify(p.builtinName)} (${p.builtinClass}) planted as ${p.entryClass}`;
}

// --- instrument sanity: the enumeration is real ------------------------------------------------

test("AC-R1-8 instrument: the run-time enumeration is non-empty, covers only ruled classes, and the fixed stderr template holds none of the names or classes it is checked against", () => {
  const { lowering, raising, sameClass, builtinCount } = derivePairs();
  console.log(`AC-R1-8 instrument: ${String(builtinCount)} built-ins read at run time; ${String(lowering.length)} lowering, ${String(raising.length)} raising, ${String(sameClass.length)} same-class pairs derived`);
  assert.ok(builtinCount > 0, "the built-in layer yields names");
  assert.ok(lowering.length > 0, "at least one lowering pair exists (a built-in above read-only)");
  assert.ok(raising.length > 0, "at least one raising pair exists (a built-in below remote-mutating)");
  assert.equal(sameClass.length, builtinCount, "exactly one same-class pair per built-in");
  assert.equal(lowering.length + raising.length + sameClass.length, builtinCount * CLASS_ORDER.length, "every built-in crosses every class once");

  // The fixed-line template as the hook prints it for a syntactically broken fixture (an existing
  // fail-closed path). A built-in name or a class string inside that template would make the no-leak
  // check unfalsifiable, so refuse that here.
  const layer = loadBuiltinToolClassificationLayer();
  const broken = createGateSandbox();
  fs.writeFileSync(broken.fixturePath, "{ \"version\": \"v\", BROKEN-FIXTURE", "utf8");
  const brokenRun = broken.mcp(firstCommittedEntryName(), "x");
  assert.equal(brokenRun.code, 2, `template probe must hit the fail-closed path; got ${describeRun(brokenRun)}`);
  assert.match(brokenRun.stderr, FIXED_LINE, "the template probe matches the fixed-line shape");
  for (const b of layer.tools) assert.ok(!brokenRun.stderr.includes(b.name), `the fixed stderr template must not contain the built-in name ${JSON.stringify(b.name)}`);
  for (const c of CLASS_ORDER) assert.ok(!brokenRun.stderr.includes(c), `the fixed stderr template must not contain the class string ${JSON.stringify(c)}`);

  // Every class found in the built-in layer is in the ruled order (rank() throws otherwise).
  for (const b of layer.tools) rank(b.class);
});

// --- control: the sandbox is otherwise healthy ---------------------------------------------------

test("AC-R1-8 control: the unmodified fixture leaves an MCP call of a classified server a silent allow (exit 0, empty stdout, empty stderr)", () => {
  const sb = createGateSandbox();
  const run = sb.mcp(firstCommittedEntryName(), "x");
  assert.ok(isSilentAllow(run), `baseline: expected a silent allow; got ${describeRun(run)}`);
});

// --- PT-7 case 1 and case 2: lowering entries fail closed ------------------------------------------

test("AC-R1-8 case 1: one lowering entry (first derived pair, name and classes read at run time) makes an MCP call exit 2, silent stdout, the fixed stderr line, and leaks no name, class string or fixture path", () => {
  const { lowering } = derivePairs();
  const pair = lowering[0];
  assert.ok(pair !== undefined, "a lowering pair exists");
  const sb = createGateSandbox();
  plantEntry(sb, pair);
  const run = sb.mcp(firstCommittedEntryName(), "x");
  const problems = failClosedProblems(run, sb, pair);
  assert.deepEqual(problems, [], `${describePair(pair)}: expected the fail-closed exit 2; got ${describeRun(run)}`);
});

test("AC-R1-8 case 2: EVERY lowering pair (each built-in above read-only crossed with each lower class, derived at run time) makes an MCP call exit 2 with the fixed line and no leak", () => {
  const { lowering } = derivePairs();
  console.log(`AC-R1-8 case 2: ${String(lowering.length)} lowering pairs computed at run time`);
  assert.ok(lowering.length > 0, "the enumeration is non-empty");
  const sb = createGateSandbox();
  const server = firstCommittedEntryName();
  const failures: string[] = [];
  for (const pair of lowering) {
    plantEntry(sb, pair);
    const run = sb.mcp(server, "x");
    const problems = failClosedProblems(run, sb, pair);
    if (problems.length > 0) failures.push(`${describePair(pair)}: ${problems.join("; ")} [${describeRun(run)}]`);
  }
  assert.equal(failures.length, 0, `${String(failures.length)} of ${String(lowering.length)} lowering pairs did not fail closed:\n${failures.join("\n")}`);
});

// --- controls: an entry that does not lower leaves the hook deciding normally --------------------

function controlFailures(pairs: Pair[]): string[] {
  const sb = createGateSandbox();
  const server = firstCommittedEntryName();
  const failures: string[] = [];
  for (const pair of pairs) {
    plantEntry(sb, pair);
    const run = sb.mcp(server, "x");
    if (!isSilentAllow(run)) failures.push(`${describePair(pair)}: expected a silent allow; got ${describeRun(run)}`);
  }
  return failures;
}

test("AC-R1-8 control: EVERY raising pair (entry class above the built-in's) leaves an MCP call a silent allow (central still wins for a raise)", () => {
  const { raising } = derivePairs();
  console.log(`AC-R1-8 raising control: ${String(raising.length)} raising pairs computed at run time`);
  assert.ok(raising.length > 0, "the enumeration is non-empty");
  const failures = controlFailures(raising);
  assert.equal(failures.length, 0, `${String(failures.length)} of ${String(raising.length)} raising pairs were not a silent allow:\n${failures.join("\n")}`);
});

test("AC-R1-8 control: EVERY same-class pair (entry class equal to the built-in's) leaves an MCP call a silent allow", () => {
  const { sameClass } = derivePairs();
  console.log(`AC-R1-8 same-class control: ${String(sameClass.length)} same-class pairs computed at run time`);
  assert.ok(sameClass.length > 0, "the enumeration is non-empty");
  const failures = controlFailures(sameClass);
  assert.equal(failures.length, 0, `${String(failures.length)} of ${String(sameClass.length)} same-class pairs were not a silent allow:\n${failures.join("\n")}`);
});
