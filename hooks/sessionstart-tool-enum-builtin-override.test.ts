// S7-B (Issue #305, ruling R1), SessionStart side: a project-relative central fixture holding an
// entry that LOWERS a built-in tool's class makes hooks/sessionstart-tool-enum.mjs record
// SUR-03-enumeration-failed (its existing catch) with a detail naming the entry and the built-in's
// class, and the halt-state still records the resolved fixture path and source (THOTH-ADR-0001 rule 5,
// "never silent"). Raising and same-class entries leave that reason unset. Plan R1-7. story-implementer's
// own test, written failing first; the locked SessionStart test files are not edited.
//
// S7-B fix-now H3 (Issue #330): the REAL halt relay (hooks/userpromptsubmit-halt-relay.mjs) is driven from
// the halt-state the SessionStart hook wrote, in the same isolated tree, and the assertions also run on what
// the relay PRINTS after its 200-character cut of every diagnostic line, not only on the pre-cut halt-state
// value (R1-7 alone could not see the cut).
//
// The built-in names and classes are read from the real built-in layer at run time; the class order
// below is the ruling's own oracle. No committed fixture entry name is typed (G19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBuiltinToolClassificationLayer } from "../src/policy/tools/builtin-tool-inventory.ts";
import { fakeSessionId, runHook, sessionStartStdin, userPromptSubmitStdin } from "./test-support/spawn-hook.ts";
import { fixtureEnv, makeFixtureTree, readHaltState, writeCentralClassificationFixture } from "./test-support/fixture-tree.ts";

const SCRIPT = "hooks/sessionstart-tool-enum.mjs";
const RELAY_SCRIPT = "hooks/userpromptsubmit-halt-relay.mjs";
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

interface RelayRun {
  code: number | null;
  /** The relay's rendered diagnostic line for the enumeration-failed reason, after its own cut. */
  detailLine: string;
  /** The same line as it appears in the systemMessage JSON on stdout. */
  systemMessage: string;
}

function relayDetailLine(text: string): string {
  return text.split("\n").find((l) => l.startsWith("DETAILS[1] ")) ?? "";
}

function runWithEntry(name: string, entryClass: string): { code: number | null; state: HaltState | undefined; fixturePath: string; stderr: string; relay: RelayRun } {
  const tree = makeFixtureTree("s7b-builtin-override");
  try {
    const fixturePath = writeCentralClassificationFixture(tree, {
      version: "0.0.0-r1-hook-test",
      centralLayer: { tools: [{ name, class: entryClass }] },
      knownConnectors: [],
    });
    const sessionId = fakeSessionId("s7b-r1");
    const result = runHook(SCRIPT, sessionStartStdin({ sessionId }), fixtureEnv(tree));
    const relayResult = runHook(RELAY_SCRIPT, userPromptSubmitStdin({ sessionId }), fixtureEnv(tree));
    const payload = relayResult.json as { hookSpecificOutput?: { systemMessage?: string } } | undefined;
    const relay: RelayRun = {
      code: relayResult.code,
      detailLine: relayDetailLine(relayResult.stderr),
      systemMessage: relayDetailLine(payload?.hookSpecificOutput?.systemMessage ?? ""),
    };
    return { code: result.code, state: readHaltState(tree, sessionId) as HaltState | undefined, fixturePath, stderr: result.stderr, relay };
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
  // what the operator actually reads: the relay's line after its own cut (Issue #330)
  assertRelayLineNamesEverything(run.relay, target.name, target.class, lower);
});

/** The relay blocks (exit 2) and its rendered detail line, on stderr and in the systemMessage JSON, still
 * carries the entry, both classes and the Unlock clause after the relay's own length cut. */
function assertRelayLineNamesEverything(relay: RelayRun, name: string, builtinClass: string, entryClass: string): void {
  assert.equal(relay.code, 2, "the relay blocks the prompt");
  for (const [where, line] of [
    ["stderr", relay.detailLine],
    ["systemMessage", relay.systemMessage],
  ] as const) {
    assert.ok(line.startsWith("DETAILS[1] SUR-03-enumeration-failed: "), `${where}: the relay renders the enumeration-failed detail line; got ${JSON.stringify(line)}`);
    for (const [label, needle] of [
      ["the quoted entry", JSON.stringify(name)],
      ["the built-in class", builtinClass],
      ["the entry class", entryClass],
      ["Unlock:", "Unlock:"],
    ] as const) {
      assert.ok(line.includes(needle), `${where}: the relay line lacks ${label} after its cut: ${line}`);
    }
  }
}

test("R1-11c relay-detail-names-the-entry-and-the-unlock (Issue #330): for one built-in of each lowering class pair and for the longest lowering name, the REAL relay run over the REAL SessionStart halt-state prints the entry, both classes and Unlock:", () => {
  const builtins = loadBuiltinToolClassificationLayer().tools;
  const seen = new Set<string>();
  const picks: { name: string; builtinClass: string; entryClass: string }[] = [];
  for (const b of builtins) {
    for (const c of CLASS_ORDER) {
      if (rank(c) >= rank(b.class)) continue;
      const key = `${b.class}>${c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push({ name: b.name, builtinClass: b.class, entryClass: c });
    }
  }
  const lowerable = builtins.filter((b) => rank(b.class) > 0);
  const longest = lowerable.reduce((a, b) => (b.name.length > a.name.length ? b : a));
  picks.push({ name: longest.name, builtinClass: longest.class, entryClass: CLASS_ORDER[0] as string });
  for (const pick of picks) {
    const run = runWithEntry(pick.name, pick.entryClass);
    assert.equal(run.code, 0);
    assertRelayLineNamesEverything(run.relay, pick.name, pick.builtinClass, pick.entryClass);
  }
  console.log(`R1-11c: ${String(picks.length)} lowering picks (${String(seen.size)} distinct class pairs plus the longest name) driven through the real SessionStart hook and the real relay`);
  assert.ok(seen.size > 1);
});

test("R1-7 controls: every non-lowering pair of one built-in per class (raising and same-class, derived at run time) leaves SUR-03-enumeration-failed unset", () => {
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
