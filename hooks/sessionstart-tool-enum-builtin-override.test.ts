// S7-B (Issue #305, ruling R1), SessionStart side: a project-relative central fixture holding an
// entry that LOWERS a built-in tool's class makes hooks/sessionstart-tool-enum.mjs record
// SUR-03-enumeration-failed (its existing catch) with a detail naming the entry and the built-in's
// class, and the halt-state still records the resolved fixture path and source (THOTH-ADR-0001 rule 5,
// "never silent"). Raising and same-class entries leave that reason unset. Plan R1-7. story-implementer's
// own test, written failing first; the locked SessionStart test files are not edited.
//
// The built-in names and classes are read from the real built-in layer at run time; the class order
// below is the ruling's own oracle. No committed fixture entry name is typed (G19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBuiltinToolClassificationLayer } from "../src/policy/tools/builtin-tool-inventory.ts";
import { fakeSessionId, runHook, sessionStartStdin } from "./test-support/spawn-hook.ts";
import { fixtureEnv, makeFixtureTree, readHaltState, writeCentralClassificationFixture } from "./test-support/fixture-tree.ts";

const SCRIPT = "hooks/sessionstart-tool-enum.mjs";
const REASON = "SUR-03-enumeration-failed";
const CLASS_ORDER: readonly string[] = ["read-only", "workspace-mutating", "remote-mutating"];

function rank(toolClass: string): number {
  const r = CLASS_ORDER.indexOf(toolClass);
  if (r < 0) throw new Error(`class ${JSON.stringify(toolClass)} is not in the ruled class order`);
  return r;
}

interface Reason {
  set?: boolean;
  detail?: string;
}
interface HaltState {
  reasons?: Record<string, Reason>;
  fixturePath?: string;
  fixtureSource?: string;
}

function runWithEntry(name: string, entryClass: string): { code: number | null; state: HaltState | undefined; fixturePath: string; stderr: string } {
  const tree = makeFixtureTree("s7b-builtin-override");
  try {
    const fixturePath = writeCentralClassificationFixture(tree, {
      version: "0.0.0-r1-hook-test",
      centralLayer: { tools: [{ name, class: entryClass }] },
      knownConnectors: [],
    });
    const sessionId = fakeSessionId("s7b-r1");
    const result = runHook(SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    return { code: result.code, state: readHaltState(tree, sessionId) as HaltState | undefined, fixturePath, stderr: result.stderr };
  } finally {
    tree.cleanup();
  }
}

test("R1-7: a lowering entry makes SessionStart exit 0 and set SUR-03-enumeration-failed, naming the entry and the built-in class, with the resolved fixture path and source recorded", () => {
  const builtins = loadBuiltinToolClassificationLayer().tools;
  const target = builtins.find((b) => rank(b.class) > 0);
  assert.ok(target !== undefined, "a built-in above read-only exists");
  const lower = CLASS_ORDER.find((c) => rank(c) < rank(target.class)) as string;
  const run = runWithEntry(target.name, lower);
  assert.equal(run.code, 0, `SessionStart never exits 2 by design; stderr=${run.stderr}`);
  const reason = run.state?.reasons?.[REASON];
  assert.equal(reason?.set, true, `expected ${REASON} to be set; got ${JSON.stringify(run.state)}`);
  const detail = reason?.detail ?? "";
  assert.ok(detail.includes(JSON.stringify(target.name)), `detail names the entry; got ${detail}`);
  assert.ok(detail.includes(target.class), `detail names the built-in class ${target.class}; got ${detail}`);
  assert.ok(detail.includes("Unlock:"), `detail carries the unlock; got ${detail}`);
  assert.equal(run.state?.fixtureSource, "project-relative");
  assert.equal(run.state?.fixturePath, run.fixturePath, "the catch path records the resolved fixture path");
});

test("R1-7 controls: EVERY non-lowering pair (raising and same-class, derived at run time) leaves SUR-03-enumeration-failed unset", () => {
  const builtins = loadBuiltinToolClassificationLayer().tools;
  // one built-in per distinct class keeps the spawn count small while covering raise and keep
  const seenClasses = new Set<string>();
  const sample = builtins.filter((b) => {
    if (seenClasses.has(b.class)) return false;
    seenClasses.add(b.class);
    return true;
  });
  const failures: string[] = [];
  let checked = 0;
  for (const b of sample) {
    for (const c of CLASS_ORDER) {
      if (rank(c) < rank(b.class)) continue;
      checked += 1;
      const run = runWithEntry(b.name, c);
      if (run.code !== 0) failures.push(`${b.name} as ${c}: exit ${String(run.code)}`);
      if (run.state?.reasons?.[REASON]?.set === true) failures.push(`${b.name} (${b.class}) as ${c}: ${REASON} was set: ${JSON.stringify(run.state)}`);
    }
  }
  console.log(`R1-7 controls: ${String(checked)} non-lowering (built-in, class) pairs spawned, from ${String(sample.length)} built-ins (one per class)`);
  assert.ok(checked > 0);
  assert.equal(failures.length, 0, failures.join("\n"));
});
