// #455 (S7, k-blocker): the repo scripts that an enabled plugin's hooks execute are derived from the hook commands (a committed,
// generator-produced snapshot) and join the one protected list. Written FAILING FIRST.
// The namespace import makes a missing export fail the one test that uses it, not the whole file.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ppl from "./protected-path-list.ts";
import { buildDenyRules, buildParentRules, parentDirs, unmatchedPaths } from "./protected-path-list.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SNAPSHOT_REL = "docs/qa/plugin-hook-snapshot.json";

// The ppl module is imported as a namespace, so a not-yet-built export is reached through this loose view.
const api = ppl as unknown as Record<string, (...a: never[]) => unknown>;
function fn<T>(name: string): (...a: unknown[]) => T {
  const f = api[name];
  if (typeof f !== "function") throw new Error(`export ${name} does not exist yet`);
  return f as unknown as (...a: unknown[]) => T;
}

interface Snap {
  version: number;
  plugins: Array<{ id: string; version: string; gitCommitSha: string; files: Array<{ path: string; sha256: string; commandsSha256: string; commands: string[] }> }>;
}
interface Scan {
  scripts: string[];
  outside: string[];
  unenumerable: string[];
}

const syntheticSnapshot = (commands: string[]): Snap => ({
  version: 1,
  plugins: [{ id: "t@t", version: "1", gitCommitSha: "abc", files: [{ path: "hooks/hooks.json", sha256: "x", commandsSha256: createHash("sha256").update(JSON.stringify(commands)).digest("hex"), commands }] }],
});

const loadSnapshot = (): Snap => JSON.parse(readFileSync(`${REPO}${SNAPSHOT_REL}`, "utf8")) as Snap;

test("plugin-hooks: derive in-repo scripts, report outside-repo", () => {
  const snap = syntheticSnapshot([
    'node "${CLAUDE_PROJECT_DIR}/docs/decisions-archive.mjs"',
    'bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/track.sh"',
    "node /opt/other/y.js",
    "node ../z.mjs",
    "node ~/bin/w.mjs",
  ]);
  const scan = fn<Scan>("pluginHookScan")(REPO, snap);
  assert.deepEqual(scan.scripts, ["docs/decisions-archive.mjs"]);
  assert.equal(scan.outside.length, 4, `outside-repo commands are reported: ${JSON.stringify(scan.outside)}`);
  assert.deepEqual(scan.unenumerable, []);
});

test("plugin-hooks: a command naming no script is listed as unenumerable, not thrown", () => {
  const scan = fn<Scan>("pluginHookScan")(REPO, syntheticSnapshot(["echo hello"]));
  assert.deepEqual(scan.unenumerable, ["echo hello"]);
  assert.deepEqual(scan.scripts, []);
});

test("plugin-hooks: maat snapshot yields session-brief and its two spawned children", () => {
  const scripts = fn<string[]>("pluginHookScripts")(REPO, loadSnapshot());
  for (const want of ["docs/session-brief.mjs", "docs/adr-cache.mjs", "docs/decisions-archive.mjs"]) assert.ok(scripts.includes(want), `${want} is derived`);
});

test("plugin-hooks: adding/removing a hook command changes the list", () => {
  const base = syntheticSnapshot(["node -e \"x='docs/adr-cache.mjs'\""]);
  const added = syntheticSnapshot(["node -e \"x='docs/adr-cache.mjs'\"", 'node "${CLAUDE_PROJECT_DIR}/docs/decisions-archive.mjs"']);
  const paths = (s: Snap): string[] => ppl.protectedPaths(REPO, { snapshot: s } as never).all;
  const a = paths(base);
  const b = paths(added);
  assert.ok(!a.includes("docs/decisions-archive.mjs"), "absent before the command is added");
  assert.ok(b.includes("docs/decisions-archive.mjs"), "present after the command is added");
  assert.deepEqual(b.filter((p) => !a.includes(p)), ["docs/decisions-archive.mjs"], "adding changes the list by exactly that script");
  assert.deepEqual(paths(base), a, "removing it again restores the list");
  assert.ok(a.includes("docs/adr-cache.mjs"));
});

test("plugin-hooks: generated rules and proposal include derived paths", () => {
  const rules = (JSON.parse(readFileSync(`${REPO}src/policy/config/shipped-defaults.json`, "utf8")) as { rules: Array<{ targets?: string[] }> }).rules;
  const proposal = readFileSync(`${REPO}docs/plans/s308-K-proposed-settings-2026-10-04.json`, "utf8");
  for (const p of ["docs/session-brief.mjs", "docs/adr-cache.mjs", "docs/decisions-archive.mjs"]) {
    assert.ok(rules.some((r) => r.targets?.includes(p)), `${p}: a shipped deny rule`);
    assert.ok(proposal.includes(`Edit(/${p})`), `${p}: an Edit-deny entry`);
  }
});

test("plugin-hooks: every derived path is denied by the generated rules", () => {
  const all = ppl.protectedPaths(REPO).all;
  const rules = [...buildDenyRules(all), ...buildParentRules(parentDirs(all))];
  assert.deepEqual(unmatchedPaths(rules, ["docs/session-brief.mjs", "docs/adr-cache.mjs", "docs/decisions-archive.mjs"]), []);
});

test("protected-path-list: repo settings hooks stay covered", () => {
  const all = ppl.protectedPaths(REPO).all;
  for (const want of ["hooks/sessionstart-tool-enum.mjs", "hooks/userpromptsubmit-halt-relay.mjs"]) assert.ok(all.includes(want), `${want} stays on the list`);
});

test("plugin-hooks: the snapshot and the F1 files are protected", () => {
  const named = ppl.protectedPaths(REPO).named;
  for (const want of [SNAPSHOT_REL, "src/qa/f1-settings-named-scripts-judged.ts", "docs/qa/f1-hook-judgments.json"]) assert.ok(named.includes(want), want + " is named");
});

// ---- spawn-follow ----

type Reader = (abs: string) => string | undefined;
const norm = (abs: string): string => abs.split("\\").join("/").replace(/^[A-Za-z]:/, "");
const fakeRead =
  (files: Record<string, string>): Reader =>
  (abs) =>
    files[norm(abs)];

test("spawn-follow: computed script throws", () => {
  const spawned = fn<string[]>("spawnedScripts");
  assert.throws(() => spawned("import {execFileSync} from 'node:child_process'; execFileSync(process.execPath, [x]);", "/r/a.mjs"), /cannot be followed|computed|non-literal/i);
  assert.throws(() => spawned("fork(y);", "/r/a.mjs"), /cannot be followed|computed|non-literal/i);
  assert.throws(() => spawned("spawnSync('node', args);", "/r/a.mjs"), /cannot be followed|computed|non-literal/i);
});

test("spawn-follow: a non-node command and a flag-only call are ignored", () => {
  const spawned = fn<string[]>("spawnedScripts");
  assert.deepEqual(spawned("execFileSync('git', ['rev-parse', 'HEAD']); execFileSync('git', args);", "/r/a.mjs"), []);
  assert.deepEqual(spawned("execFileSync(process.execPath, ['--version']);", "/r/a.mjs"), []);
});

test("spawn-follow: literal spawns are collected", () => {
  const spawned = fn<string[]>("spawnedScripts");
  assert.deepEqual(spawned("execFileSync(process.execPath, ['docs/b.mjs', '--x']); fork('docs/c.mjs');", "/r/a.mjs").sort(), ["docs/b.mjs", "docs/c.mjs"]);
});

test("spawn-follow: transitive fixpoint", () => {
  const read = fakeRead({
    "/r/docs/a.mjs": "execFileSync(process.execPath, ['docs/b.mjs']);",
    "/r/docs/b.mjs": "execFileSync(process.execPath, ['docs/c.mjs']);",
    "/r/docs/c.mjs": "execFileSync(process.execPath, ['docs/a.mjs']);",
  });
  const scan = fn<Scan>("pluginHookScan")("/r", syntheticSnapshot(["node docs/a.mjs"]), read);
  assert.deepEqual(scan.scripts, ["docs/a.mjs", "docs/b.mjs", "docs/c.mjs"]);
});

// ---- snapshot: internal consistency, live drift, building from live data ----

test("snapshot: internal hash mismatch fails", () => {
  const snap = loadSnapshot();
  const check = fn<string[]>("snapshotInternalProblems");
  assert.deepEqual(check(snap), []);
  const tampered = JSON.parse(JSON.stringify(snap)) as Snap;
  tampered.plugins[0]!.files[0]!.commands.push("node docs/evil.mjs");
  const problems = check(tampered);
  assert.ok(problems.length > 0 && problems.some((p) => p.includes(tampered.plugins[0]!.id)), `names the plugin: ${JSON.stringify(problems)}`);
});

test("snapshot: live drift fails", () => {
  const committed = syntheticSnapshot(["node docs/a.mjs"]);
  const live = syntheticSnapshot(["node docs/a.mjs", "node docs/b.mjs"]);
  const r = fn<{ status: string; detail: string }>("snapshotLiveDrift")(committed, live);
  assert.equal(r.status, "drift");
  assert.match(r.detail, /t@t/);
  assert.equal(fn<{ status: string }>("snapshotLiveDrift")(committed, committed).status, "ok");
});

test("snapshot: missing enabled plugin fails", () => {
  const committed = syntheticSnapshot(["node docs/a.mjs"]);
  const live: Snap = { version: 1, plugins: [...committed.plugins, { id: "new@m", version: "1", gitCommitSha: "d", files: [] }] };
  const r = fn<{ status: string; detail: string }>("snapshotLiveDrift")(committed, live);
  assert.equal(r.status, "drift");
  assert.match(r.detail, /new@m/);
});

test("snapshot: absent live dir is unverified", () => {
  const r = fn<{ status: string }>("snapshotLiveDrift")(syntheticSnapshot(["node docs/a.mjs"]), undefined);
  assert.equal(r.status, "unverified");
});

test("snapshot: built from live data, enabled plugins only, no machine paths stored", () => {
  const files: Record<string, string> = {
    "/h/.claude/settings.json": JSON.stringify({ enabledPlugins: { "p@m": true, "q@m": false } }),
    "/r/.claude/settings.json": JSON.stringify({ hooks: {} }),
    "/h/.claude/plugins/installed_plugins.json": JSON.stringify({
      version: 2,
      plugins: {
        "p@m": [{ scope: "user", installPath: "/h/.claude/plugins/cache/p", version: "1.0", gitCommitSha: "abc" }],
        "q@m": [{ scope: "user", installPath: "/h/.claude/plugins/cache/q", version: "2.0", gitCommitSha: "def" }],
      },
    }),
    "/h/.claude/plugins/cache/p/plugin.json": JSON.stringify({ hooks: "extra.json" }),
    "/h/.claude/plugins/cache/p/hooks/hooks.json": JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node docs/a.mjs" }] }] } }),
    "/h/.claude/plugins/cache/p/extra.json": JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node docs/b.mjs" }, { type: "http", url: "x" }] }] } }),
    "/h/.claude/plugins/cache/q/hooks/hooks.json": JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node docs/q.mjs" }] }] } }),
  };
  const snap = fn<Snap>("buildPluginSnapshot")({ home: "/h", root: "/r", read: fakeRead(files) });
  assert.deepEqual(snap.plugins.map((p) => p.id), ["p@m"], "q@m is disabled");
  const cmds = snap.plugins[0]!.files.flatMap((f) => f.commands).sort();
  assert.deepEqual(cmds, ["node docs/a.mjs", "node docs/b.mjs"]);
  assert.ok(!JSON.stringify(snap).includes("/h/.claude"), "no machine path in the snapshot");
  assert.deepEqual(fn<string[]>("snapshotInternalProblems")(snap), []);
});

test("snapshot: no live plugin data builds undefined (unverified), not an empty snapshot", () => {
  assert.equal(fn<unknown>("buildPluginSnapshot")({ home: "/h", root: "/r", read: fakeRead({}) }), undefined);
});

// ---- #473, #474 and app-security LOW 1: the derivation fails closed (round 1 fix-now). Written FAILING FIRST. ----
import * as f1 from "./f1-settings-named-scripts-judged.ts";

const f1Check = (commands: string[]): { ok: boolean; failures: string[] } =>
  (f1 as unknown as { checkF1: (o: unknown) => { ok: boolean; failures: string[] } }).checkF1({
    root: REPO,
    snapshot: syntheticSnapshot(commands),
    protectedAll: ["docs/decisions-archive.mjs"],
    judgments: [],
    live: { status: "ok", detail: "" },
  });

test("plugin-hooks: extensionless sibling script makes the command unenumerable", () => {
  for (const cmd of ["node docs/decisions-archive.mjs && sh docs/run", "node docs/decisions-archive.mjs; docs/run", "node docs/decisions-archive.mjs | docs/run --x"]) {
    const scan = fn<Scan>("pluginHookScan")(REPO, syntheticSnapshot([cmd]));
    assert.deepEqual(scan.unenumerable, [cmd], `unenumerable: ${cmd}`);
    const r = f1Check([cmd]);
    assert.equal(r.ok, false, `F1 fails: ${cmd}`);
  }
  // A fully accounted compound command stays enumerable.
  const ok = fn<Scan>("pluginHookScan")(REPO, syntheticSnapshot(["node docs/decisions-archive.mjs && node docs/adr-cache.mjs --ensure"]));
  assert.deepEqual(ok.unenumerable, []);
  assert.deepEqual(ok.scripts, ["docs/adr-cache.mjs", "docs/decisions-archive.mjs"]);
  // A command substitution is never accounted for.
  assert.equal(fn<Scan>("pluginHookScan")(REPO, syntheticSnapshot(["node docs/decisions-archive.mjs $(docs/run)"])).unenumerable.length, 1);
});

test("plugin-hooks: partially assembled path fails F1", () => {
  const concat = `node -e "require('node:child_process').execFileSync(process.execPath,['docs/'+'tools.mjs'])"`;
  const template = "node -e \"require('node:child_process').execFileSync(process.execPath,[`docs/${name}.mjs`])\"";
  for (const cmd of [concat, template]) {
    const scan = fn<Scan>("pluginHookScan")(REPO, syntheticSnapshot([cmd]));
    assert.deepEqual(scan.unenumerable, [cmd], `unenumerable: ${cmd}`);
    assert.equal(f1Check([cmd]).ok, false, `F1 fails: ${cmd}`);
  }
  // A plain in-repo script that does not exist is no longer a note: the command is unenumerable.
  assert.equal(f1Check(["node docs/does-not-exist.mjs"]).ok, false);
});

test("spawn-follow: aliased node command throws", () => {
  const spawned = fn<string[]>("spawnedScripts");
  assert.throws(() => spawned("const n = process.execPath; execFileSync(n, ['docs/b.mjs']);", "/r/a.mjs"), /cannot be followed|computed|non-literal/i);
  assert.throws(() => spawned("spawnSync(cmd, ['docs/b.mjs']);", "/r/a.mjs"), /cannot be followed|computed|non-literal/i);
  // A literal non-node program stays ignored; the literal node forms stay followed.
  assert.deepEqual(spawned("execFileSync('git', ['x']); execFileSync(process.execPath, ['docs/b.mjs']);", "/r/a.mjs"), ["docs/b.mjs"]);
});

test("plugin-hooks: the live snapshot still derives the same three scripts and F1 passes on it", () => {
  const snap = loadSnapshot();
  const scan = fn<Scan>("pluginHookScan")(REPO, snap);
  assert.deepEqual(scan.scripts, ["docs/adr-cache.mjs", "docs/decisions-archive.mjs", "docs/session-brief.mjs"]);
  assert.deepEqual(scan.unenumerable, []);
  const r = (f1 as unknown as { checkF1: (o: unknown) => { ok: boolean; failures: string[] } }).checkF1({
    root: REPO,
    snapshot: snap,
    protectedAll: ppl.protectedPaths(REPO).all,
    judgments: [],
    live: { status: "ok", detail: "" },
  });
  assert.equal(r.ok, true, JSON.stringify(r.failures));
});

test("spawn-follow: execSync in a followed script throws", () => {
  const spawned = fn<string[]>("spawnedScripts");
  for (const src of ["execSync('git status');", "exec('ls', cb);", "child_process.execSync(cmd);", "cp.exec('x');", "x.execSync('x');"]) {
    assert.throws(() => spawned(src, "/r/a.mjs"), /cannot be followed|computed|non-literal|shell/i, src);
  }
  // Not a process call: RegExp.exec, and a literal non-node program through execFile.
  assert.deepEqual(spawned("const m = /a(b)/.exec(s); const r = re.exec(t); execFileSync('git', ['x']);", "/r/a.mjs"), []);
});
