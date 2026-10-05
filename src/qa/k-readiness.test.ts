// #308 story K stage 0: tests for `qa:k-readiness` with INJECTED runners (no network, no real gh, no real repo state).
// The real-repo run is not here (it is red by design until K is wired): see k-readiness.real-run.ts and `npm run qa:k-readiness`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReadOnly, blockerRow, exitCodeForRows, formatRows, k1Row, k4Row, parseDecisionRows, runReadiness, SCRIPT_ROWS, FIX_BRANCHES, type Deps, type Exec, type RunResult } from "./k-readiness.ts";

const ok = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" });
const LABELS = JSON.stringify([{ name: "bug" }, { name: "k-blocker" }]);
const ALL_OPEN = JSON.stringify([
  { number: 1, labels: [{ name: "bug" }] },
  { number: 2, labels: [] },
  { number: 3, labels: [{ name: "chore" }] },
]);

interface Overrides {
  labels?: RunResult;
  byLabel?: RunResult;
  all?: RunResult;
  node?: Record<string, RunResult>;
  git?: Record<string, RunResult>;
}
function fakeExec(o: Overrides = {}, calls: string[][] = []): Exec {
  return (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "gh" && args[0] === "label") return o.labels ?? ok(LABELS);
    if (cmd === "gh" && args[0] === "issue" && args.includes("--label")) return o.byLabel ?? ok("[]");
    if (cmd === "gh" && args[0] === "issue") return o.all ?? ok(ALL_OPEN);
    if (cmd === "git") return o.git?.[args[0]!] ?? ok();
    if (cmd === "node") return o.node?.[args[0]!] ?? ok(`PASS ${args[0]!}`);
    throw new Error(`unexpected command ${cmd}`);
  };
}

const allScripts = Object.fromEntries(SCRIPT_ROWS.map((s) => [s.script, `node src/qa/${s.script.replace("qa:", "")}.ts`]));
const DECISIONS = [
  "| Date | Decision | By | Dissent | Human ratified | Review-back |",
  "|---|---|---|---|---|---|",
  "| 2026-10-05 | **K1 wiring approved (#308 story K).** evidence | human | none | Y | 2026-11-01 |",
  "| 2026-10-05 | **THOTH-ADR-0003 accepted by the human, keeping the exemption.** | Manager | none | Y | 2026-10-12 |",
].join("\n");

function deps(o: Overrides = {}, files: Record<string, string | undefined> = {}, calls: string[][] = []): Deps {
  const base: Record<string, string | undefined> = { "package.json": JSON.stringify({ scripts: allScripts }), "docs/decisions.md": DECISIONS };
  return { run: fakeExec(o, calls), readFile: (rel) => ({ ...base, ...files })[rel] };
}

test("k-readiness: read-only (a spied runner sees only allowed commands, and others are refused)", () => {
  const calls: string[][] = [];
  runReadiness(deps({}, {}, calls));
  assert.ok(calls.length > 5);
  for (const [cmd, ...args] of calls) assert.doesNotThrow(() => assertReadOnly(cmd!, args), `${cmd!} ${args.join(" ")}`);
  for (const [cmd, ...args] of [
    ["git", "push"],
    ["git", "config", "x", "y"],
    ["gh", "issue", "close", "1"],
    ["gh", "issue", "edit", "1"],
    ["gh", "label", "create", "x"],
    ["gh", "api", "x"],
    ["node", "-e", "1"],
    ["node", "../evil.ts"],
    ["node", "src/qa/x.ts/../../evil.ts"],
    ["npm", "test"],
    ["sh", "-c", "x"],
  ] as [string, ...string[]][]) assert.throws(() => assertReadOnly(cmd, args), /read-only/, `${cmd} ${args.join(" ")}`);
  // The wrapped runner refuses before the underlying exec is called.
  let called = false;
  const wrapped = runReadiness({ run: () => ((called = true), ok()), readFile: () => undefined });
  assert.ok(wrapped.length > 0);
  assert.equal(called, true, "allowed commands do reach the exec");
});

test("k-readiness: exit 1 if any row not PASS (and 0 only when every row passes)", () => {
  const green = runReadiness(deps());
  assert.ok(green.every((r) => r.status === "PASS"), JSON.stringify(green.filter((r) => r.status !== "PASS")));
  assert.equal(exitCodeForRows(green), 0);
  assert.equal(exitCodeForRows([]), 1, "no rows is not a pass");
  // Each single row turned red flips the exit code.
  for (let i = 0; i < green.length; i++) {
    const red = green.map((r, j) => (j === i ? { ...r, status: "FAIL" as const } : r));
    assert.equal(exitCodeForRows(red), 1);
  }
  const lines = formatRows(runReadiness(deps({ node: { "src/qa/gate-manifest.ts": { status: 1, stdout: "FAIL: x", stderr: "" } } })));
  assert.ok(lines.some((l) => l.startsWith("FAIL") && l.includes("gate-manifest")));
  assert.match(lines[lines.length - 1]!, /NOT READY/);
});

test("k-readiness: unbuilt rows report MISSING and fail", () => {
  const scripts = { ...allScripts } as Record<string, string>;
  delete scripts["qa:cc-extraction-covers-judged"];
  delete scripts["qa:f1-settings-named-scripts-judged"];
  delete scripts["qa:gate-latency-allow-path"];
  const rows = runReadiness(deps({}, { "package.json": JSON.stringify({ scripts }) }));
  const missing = rows.filter((r) => r.status === "MISSING").map((r) => r.id);
  assert.deepEqual(missing, ["CC-extraction-covers-judged (#452)", "F1-settings-named-scripts-judged", "gate-latency-allow-path"]);
  assert.equal(exitCodeForRows(rows), 1);
  // A fix branch that does not exist is MISSING, never a silent pass.
  const noRef = runReadiness(deps({ git: { "rev-parse": { status: 1, stdout: "", stderr: "" } } }));
  assert.ok(noRef.some((r) => r.id.startsWith("fix-branch-merged") && r.status === "MISSING"));
  assert.equal(FIX_BRANCHES.length > 0, true);
});

test("k-readiness: not an ancestor fails", () => {
  const rows = runReadiness(deps({ git: { "merge-base": { status: 1, stdout: "", stderr: "" } } }));
  assert.ok(rows.some((r) => r.id.startsWith("fix-branch-merged") && r.status === "FAIL"));
});

test("k-readiness: lists blockers from gh", () => {
  const r = blockerRow(fakeExec({ byLabel: ok(JSON.stringify([{ number: 455, title: "plugin hook" }, { number: 397, title: "reg.exe" }])), all: ok(JSON.stringify([{ number: 397, labels: [{ name: "k-blocker" }] }, { number: 455, labels: [{ name: "k-blocker" }] }, { number: 9, labels: [] }])) }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /#455 plugin hook/);
  assert.match(r.detail, /#397 reg\.exe/);
  const empty = blockerRow(fakeExec());
  assert.equal(empty.status, "PASS");
  assert.equal(empty.detail, "0 open k-blocker issues (label exists, 3 open issues total)");
});

test("k-readiness: gh missing fails closed", () => {
  for (const bad of [{ status: null, stdout: "", stderr: "" }, { status: 1, stdout: "", stderr: "boom" }, ok("not json"), ok('{"a":1}')]) {
    for (const key of ["labels", "byLabel", "all"] as const) {
      const r = blockerRow(fakeExec({ [key]: bad }));
      assert.equal(r.status, "FAIL", `${key} ${JSON.stringify(bad)}`);
    }
  }
});

test("k-readiness: label missing fails closed", () => {
  const r = blockerRow(fakeExec({ labels: ok(JSON.stringify([{ name: "bug" }])) }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /k-blocker does not exist/);
});

test("k-readiness: two-query disagreement fails with list lag or label drift", () => {
  // The label query says empty, the cross-check sees an open issue carrying the label.
  const r = blockerRow(fakeExec({ all: ok(JSON.stringify([{ number: 7, labels: [{ name: "k-blocker" }] }])) }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /list lag or label drift/);
  // And the reverse.
  const r2 = blockerRow(fakeExec({ byLabel: ok(JSON.stringify([{ number: 7, title: "t" }])) }));
  assert.equal(r2.status, "FAIL");
  assert.match(r2.detail, /list lag or label drift/);
});

test("k-readiness: K1 absent fails", () => {
  const none = k1Row(deps({}, { "docs/decisions.md": "| 2026-10-05 | something else | M | n | Y | d |" }));
  assert.equal(none.status, "FAIL");
  const pending = k1Row(deps({}, { "docs/decisions.md": "| 2026-10-05 | **K1 approval** | M | n | pending | d |" }));
  assert.equal(pending.status, "FAIL");
  const preApproved = k1Row(deps({}, { "docs/decisions.md": "| 2026-10-05 | **K1 approval** | M | n | Y (pre-approved) | d |" }));
  assert.equal(preApproved.status, "FAIL", "K1 needs the human's explicit Y, not a pre-approval note");
  assert.equal(k1Row(deps({}, { "docs/decisions.md": undefined })).status, "FAIL");
  assert.equal(k1Row(deps()).status, "PASS");
});

test("k-readiness: K4 row found", () => {
  assert.equal(k4Row(deps()).status, "PASS");
  assert.equal(k4Row(deps({}, { "docs/decisions.md": "| 2026-10-05 | other | M | n | Y | d |" })).status, "FAIL");
  assert.equal(k4Row(deps({}, { "docs/decisions.md": "| 2026-10-05 | **THOTH-ADR-0003 accepted** | M | n | pending | d |" })).status, "FAIL");
  assert.equal(parseDecisionRows(DECISIONS).length, 2);
});
