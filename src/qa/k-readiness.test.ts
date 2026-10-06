// #308 story K stage 0: tests for `qa:k-readiness` with INJECTED runners (no network, no real gh, no real repo state).
// The real-repo run is not here (it is red by design until K is wired): see k-readiness.real-run.ts and `npm run qa:k-readiness`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGithubRepo, assertReadOnly, blockerRow, exitCodeForRows, formatRows, k1Row, k4Row, parseDecisionRows, runReadiness, SCRIPT_ROWS, FIX_BRANCHES, type Deps, type Exec, type RunResult } from "./k-readiness.ts";

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
    if (cmd === "git" && args[0] === "remote") return o.git?.remote ?? ok("https://github.com/acme/thoth.git");
    if (cmd === "git") return o.git?.[args[0]!] ?? ok();
    if (cmd === "node") return o.node?.[args[0]!] ?? ok(`PASS ${args[0]!}`);
    throw new Error(`unexpected command ${cmd}`);
  };
}

const allScripts = Object.fromEntries(SCRIPT_ROWS.map((s) => [s.script, `node ${s.file}`]));
const DECISIONS = [
  "| Date | Decision | By | Dissent | Human ratified | Review-back |",
  "|---|---|---|---|---|---|",
  "| 2026-10-05 | **K1 approved (#308 story K wiring).** evidence | human | none | Y | 2026-11-01 |",
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
    ["git", "remote", "add", "x", "y"],
    ["git", "remote", "set-url", "origin", "y"],
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
  const lines = formatRows(runReadiness(deps({ node: { "src/qa/gate-manifest-check.ts": { status: 1, stdout: "FAIL: x", stderr: "" } } })));
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
  assert.equal(empty.detail, "0 open k-blocker issues (repo acme/thoth, label exists, 3 open issues total)");
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

const withDecisions = (rows: string, archive?: string): Deps => deps({}, { "docs/decisions.md": rows, "docs/decisions-archive.md": archive });

test("k-readiness: K1 absent fails", () => {
  const none = k1Row(withDecisions("| 2026-10-05 | something else | M | n | Y | d |"));
  assert.equal(none.status, "FAIL");
  assert.equal(k1Row(withDecisions("| 2026-10-05 | **K1 approved** | M | n | pending | d |")).status, "FAIL");
  assert.equal(k1Row(deps({}, { "docs/decisions.md": undefined })).status, "FAIL");
  assert.equal(k1Row(deps()).status, "PASS");
});

test("k-readiness: a K1 row that does not record approval does not pass", () => {
  for (const decision of ["**K1 declined:** the human did not approve wiring K this week.", "K1 deferred until next sprint", "**K1** pending the human", "K1 not approved"]) {
    assert.equal(k1Row(withDecisions(`| 2026-10-06 | ${decision} | Manager | none | Y | 2026-10-20 |`)).status, "FAIL", decision);
  }
});

test("k-readiness: K1 passes with the house Y (human, ...) cell and fails with N or a bare note", () => {
  const row = (cell: string): string => `| 2026-10-06 | **K1 approved** (#308 story K) | Manager | none | ${cell} | 2026-11-06 |`;
  assert.equal(k1Row(withDecisions(row('Y (human, 2026-10-06: "approved")'))).status, "PASS");
  assert.equal(k1Row(withDecisions(row("Y"))).status, "PASS");
  assert.equal(k1Row(withDecisions(row("K1 approved"))).status, "FAIL");
  assert.equal(k1Row(withDecisions(row("N"))).status, "FAIL");
  assert.equal(k1Row(withDecisions(row("pending"))).status, "FAIL");
  assert.equal(k1Row(withDecisions("| 2026-10-06 | K1 approved (bold optional) | M | n | Y | d |")).status, "PASS");
});

test("k-readiness: K4 row found", () => {
  assert.equal(k4Row(deps()).status, "PASS");
  assert.equal(k4Row(withDecisions("| 2026-10-05 | other | M | n | Y | d |")).status, "FAIL");
  assert.equal(k4Row(withDecisions("| 2026-10-05 | **THOTH-ADR-0003 accepted** | M | n | pending | d |")).status, "FAIL");
  assert.equal(parseDecisionRows(DECISIONS).length, 2);
});

test("k-readiness: K4 row spoofs fail (substring, not-yet, wait)", () => {
  for (const decision of ["K4 precondition: wiring waits until THOTH-ADR-0003 accepted by the human (not yet).", "Reminder: THOTH-ADR-0003 accepted? no.", "**Not** THOTH-ADR-0003 accepted"]) {
    assert.equal(k4Row(withDecisions(`| 2026-10-06 | ${decision} | Manager | none | Y | 2026-10-20 |`)).status, "FAIL", decision);
  }
  assert.equal(k4Row(withDecisions('| 2026-10-05 | **THOTH-ADR-0003 accepted** by the human | M | n | Y (human, 2026-10-05: "accept") | d |')).status, "PASS");
});

test("k-readiness: K4 row found when only in decisions-archive.md", () => {
  const archived = "| 2026-10-05 | **THOTH-ADR-0003 accepted** by the human | M | n | Y | d |";
  assert.equal(k4Row(withDecisions("| 2026-10-06 | unrelated | M | n | Y | d |", archived)).status, "PASS");
  assert.equal(k1Row(withDecisions("| 2026-10-06 | unrelated | M | n | Y | d |", "| 2026-10-06 | **K1 approved** | M | n | Y | d |")).status, "PASS");
  assert.equal(k4Row(withDecisions("| 2026-10-06 | unrelated | M | n | Y | d |", undefined)).status, "FAIL");
});

test("k-readiness: gh calls pin --repo", () => {
  const calls: string[][] = [];
  const r = blockerRow(fakeExec({}, calls));
  assert.equal(r.status, "PASS");
  assert.ok(r.detail.includes("repo acme/thoth"));
  const gh = calls.filter((c) => c[0] === "gh");
  assert.equal(gh.length, 3);
  for (const c of gh) {
    const i = c.indexOf("--repo");
    assert.ok(i > 0, `gh call without --repo: ${c.join(" ")}`);
    assert.equal(c[i + 1], "acme/thoth");
  }
  // Unresolvable origin fails closed, and no gh call is made.
  for (const bad of [{ status: 1, stdout: "", stderr: "" }, ok("https://example.com/acme/thoth.git"), ok("not a url"), ok("https://github.com/acme/thoth/extra"), ok("https://github.com/ac me/thoth")]) {
    const c2: string[][] = [];
    const rr = blockerRow(fakeExec({ git: { remote: bad } }, c2));
    assert.equal(rr.status, "FAIL");
    assert.equal(c2.filter((c) => c[0] === "gh").length, 0);
  }
  assert.equal(parseGithubRepo(`${["git", "github.com"].join("@")}:acme/thoth.git`), "acme/thoth");
  assert.equal(parseGithubRepo("https://github.com/acme/thoth"), "acme/thoth");
  assert.equal(parseGithubRepo("https://github.com/../thoth"), undefined);
});

test("k-readiness: script rows bind to fixed file paths, not npm script names", () => {
  const k5 = SCRIPT_ROWS.find((r) => r.script === "qa:k5")!;
  // Repointed to another green instrument: FAIL, and the repointed file is never run.
  const calls: string[][] = [];
  const repointed = { ...allScripts, "qa:k5": "node src/qa/gate-manifest-check.ts" };
  const rows = runReadiness(deps({}, { "package.json": JSON.stringify({ scripts: repointed }) }, calls));
  const row = rows.find((r) => r.id === k5.id)!;
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /repointed/);
  assert.ok(calls.every((c) => !(c[0] === "node" && c[1] === k5.file)), "the K5 file did not run on a repointed script");
  // Extra arguments or a different command also fail.
  for (const cmd of [`node ${k5.file} --extra`, `sh ${k5.file}`, "true", `node ../${k5.file}`]) {
    const r2 = runReadiness(deps({}, { "package.json": JSON.stringify({ scripts: { ...allScripts, "qa:k5": cmd } }) })).find((r) => r.id === k5.id)!;
    assert.equal(r2.status, "FAIL", cmd);
  }
  // The row runs the fixed file path.
  const calls2: string[][] = [];
  runReadiness(deps({}, {}, calls2));
  assert.ok(calls2.some((c) => c[0] === "node" && c[1] === k5.file));
  // Every row's file is unique and under src/qa.
  assert.equal(new Set(SCRIPT_ROWS.map((r) => r.file)).size, SCRIPT_ROWS.length);
  assert.ok(SCRIPT_ROWS.every((r) => r.file.startsWith("src/qa/") && r.file.endsWith(".ts")));
});
