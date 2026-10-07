// #451 / #429 round 2 (S7, red-team suspicion 3): the list of ~/.claude and .claude entries the installed Claude Code treats as
// write-protected is EXTRACTED by an instrument (src/qa/claude-code-write-deny-extract.ts, read-only over the binary) and every
// entry has a recorded judgment in docs/qa/claude-code-write-deny-judgment.json: protected (a named path) or residual (a
// reason). A new entry in a later Claude Code version with no judgment fails here. Written FAILING FIRST.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractFromInstalled, extractWriteDeny, unjudged, type Judged } from "./claude-code-write-deny-extract.ts";
import { editDenyEntries, protectedPaths } from "./protected-path-list.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const judged = (): Judged => JSON.parse(readFileSync(`${ROOT}docs/qa/claude-code-write-deny-judgment.json`, "utf8")) as Judged;
const PATHS = protectedPaths(ROOT);
const PROPOSAL = readFileSync(`${ROOT}docs/plans/s308-K-proposed-settings-2026-10-04.json`, "utf8");

test("CC-judgment-structure: every entry has a judgment of protected or residual and a reason; every protected entry names its path", () => {
  const j = judged();
  assert.ok(j.claudeCodeVersion.length > 0);
  for (const e of [...j.user, ...j.project]) {
    assert.ok(e.judgment === "protected" || e.judgment === "residual", e.name);
    assert.ok(e.reason.trim().length > 0, `${e.name} has a reason`);
    if (e.judgment === "protected") assert.ok((e.path ?? "").length > 0, `${e.name} names its protected path`);
  }
  assert.equal(new Set(j.user.map((e) => e.name)).size, j.user.length, "no duplicate user entry");
  assert.equal(new Set(j.project.map((e) => e.name)).size, j.project.length, "no duplicate project entry");
});

test("CC-protected-entries-on-the-list: every protected judgment is a named protected path with its K Edit entry and a deny rule", () => {
  const j = judged();
  const named = new Set(PATHS.named);
  const rules = new Set((JSON.parse(readFileSync(`${ROOT}src/policy/config/shipped-defaults.json`, "utf8")) as { rules: Array<{ targets: string[] }> }).rules.flatMap((r) => r.targets));
  for (const e of [...j.user, ...j.project, ...(j.projectRoot ?? [])]) {
    if (e.judgment !== "protected") continue;
    const p = e.path!.toLowerCase();
    assert.ok(named.has(p), `${e.name}: ${p} is not a named protected path`);
    for (const entry of editDenyEntries(p)) assert.ok(PROPOSAL.includes(JSON.stringify(entry).slice(1, -1)), `${e.name}: K Edit entry missing ${entry}`);
    assert.ok(rules.has(p.replace(/\/$/, "")), `${e.name}: no shipped deny rule targets ${p}`);
  }
});

test("CC-extractor-pure: the extractor finds the user array, spread-containing arrays, user and project entries; a missing anchor throws", () => {
  const body = 'xx;let a=1;for(let S of["shell-snapshots","session-env","plugins",...De,"backups"]){q}G(Ml(Se(),"loop.md"),!1);G(Ml(Ie,".claude","skills"),!0);U.push(Ml(Ie,".mcp.json"));bareGitRepoScrubPaths.length=0;';
  const r = extractWriteDeny(Buffer.from(body, "latin1"));
  assert.deepEqual(r.user, ["backups", "loop.md", "plugins", "session-env", "shell-snapshots"]);
  assert.deepEqual(r.project, ["skills"]);
  assert.equal(r.mcpJson, true);
  assert.throws(() => extractWriteDeny(Buffer.from("nothing here", "latin1")), /anchor not found/);
});

test("CC-new-entry-needs-judgment: an extracted entry with no judgment is reported; judged entries are not", () => {
  const j = judged();
  assert.deepEqual(unjudged({ user: [j.user[0]!.name], project: [j.project[0]!.name], mcpJson: true }, j), []);
  assert.deepEqual(unjudged({ user: ["brand-new-dir"], project: ["new-project-dir"], mcpJson: true }, j), ["user:brand-new-dir", "project:new-project-dir"]);
  const without = { ...j, user: j.user.slice(1) };
  assert.deepEqual(unjudged({ user: [j.user[0]!.name], project: [], mcpJson: true }, without), [`user:${j.user[0]!.name}`]);
});

test("CC-installed-extraction-fully-judged: the list extracted from the installed Claude Code has no entry without a judgment", (t) => {
  const got = extractFromInstalled();
  if (got === undefined) {
    t.skip("no installed Claude Code binary on this machine; the pure tests above still ran");
    return;
  }
  console.log(`CC-extraction: ${String(got.user.length)} user entries, ${String(got.project.length)} project entries from ${got.binary}`);
  assert.ok(got.user.includes("shell-snapshots") && got.user.includes("session-env") && got.project.includes("skills"), "sanity: the known entries are extracted (an empty or partial extraction is a failure, not a pass)");
  assert.deepEqual(unjudged(got, judged()), []);
});

// ---- #452: both directions plus the installed version ------------------------------------------------------------------
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { checkExtraction, coverage, discoverClaudeBinaries, parseClaudeVersion } from "./claude-code-write-deny-extract.ts";
import { runCli } from "./cc-extraction-covers-judged.ts";

const names = (es: { name: string }[]): string[] => es.map((e) => e.name);
const fullExtraction = (): { user: string[]; project: string[]; mcpJson: boolean } => ({ user: names(judged().user), project: names(judged().project), mcpJson: true });

/** A fake "binary" the real extractor can read: the anchor array, project entries, the mcp literal and the end mark. */
function fakeBinary(user: string[], project: string[], mcp: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "cc452-"));
  const p = join(dir, "claude-fake");
  const arr = ["shell-snapshots", "session-env", "plugins", ...user].map((n) => JSON.stringify(n)).join(",");
  const proj = project.map((n) => `G(Ml(Ie,".claude","${n}"),!0);`).join("");
  const mcpText = mcp ? `U.push(Ml(Ie,".mcp.json"));` : "";
  writeFileSync(p, `xx;let a=1;for(let S of[${arr}]){q}${proj}${mcpText}bareGitRepoScrubPaths.length=0;`, "latin1");
  return p;
}
const isolatedHome = (): string => mkdtempSync(join(tmpdir(), "cc452-home-"));
const envFor = (bin: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const home = isolatedHome();
  // #466: the override sits in a temp dir outside the fake home (unprotected), so these provider-semantics tests opt in; the gate tests below do not.
  return { THOTH_CLAUDE_BIN: bin, HOME: home, USERPROFILE: home, PATH: "", THOTH_EXEC_UNPROTECTED: "1", ...extra };
};

test("CC-extraction-covers-judged/mutant-drops-4-of-31: an extraction missing 4 of the 31 judged user entries is reported, exactly those 4", () => {
  const j = judged();
  const all = names(j.user);
  assert.ok(all.length >= 4, "the judgment has enough user entries to drop four");
  const dropped = [0, 1, 2, 3].map((k) => all[Math.floor((k * (all.length - 1)) / 3)]!);
  assert.equal(new Set(dropped).size, 4, "four distinct entries dropped");
  const partial = { user: all.filter((n) => !dropped.includes(n)), project: names(j.project), mcpJson: true };
  const c = coverage(partial, j);
  assert.deepEqual([...c.judgedNotExtracted].sort(), dropped.map((n) => `user:${n}`).sort());
  assert.deepEqual(c.unjudged, []);
});

test("CC-extraction-covers-judged/project-and-mcp-direction: a dropped project entry and a missing .mcp.json are reported", () => {
  const j = judged();
  const p0 = j.project[0]!.name;
  const c = coverage({ user: names(j.user), project: names(j.project).slice(1), mcpJson: false }, j);
  assert.deepEqual([...c.judgedNotExtracted].sort(), [`project:${p0}`, "projectRoot:.mcp.json"].sort());
  assert.deepEqual(c.unjudged, []);
});

test("CC-extraction-covers-judged/unjudged-direction: an extra extracted entry shows through the aggregate", () => {
  const ex = { ...fullExtraction(), user: [...fullExtraction().user, "brand-new-dir"] };
  assert.deepEqual(coverage(ex, judged()), { unjudged: ["user:brand-new-dir"], judgedNotExtracted: [] });
});

test("CC-extraction-covers-judged/equal-sets-pass: the full judged set yields both lists empty", () => {
  assert.deepEqual(coverage(fullExtraction(), judged()), { unjudged: [], judgedNotExtracted: [] });
});

test("CC-extraction-covers-judged/version-parse", () => {
  assert.equal(parseClaudeVersion("2.1.267 (Claude Code)"), "2.1.267");
  assert.equal(parseClaudeVersion("2.1.267 (Claude Code)\nextra"), "2.1.267");
  for (const bad of ["", "garbage", "v2", "2.1", "2.1.267-beta", "2.1.267abc", "2.1.2670x"]) assert.equal(parseClaudeVersion(bad), undefined, bad);
});

test("CC-extraction-covers-judged/version-mismatch-fails: a different installed version is FAIL even when the sets are equal", () => {
  const j = judged();
  const bin = fakeBinary(names(j.user), names(j.project), true);
  const ok = checkExtraction(envFor(bin), () => `${j.claudeCodeVersion} (Claude Code)`);
  assert.equal(ok.status, "PASS", ok.reasons.join("; "));
  const bad = checkExtraction(envFor(bin), () => "9.9.9 (Claude Code)");
  assert.equal(bad.status, "FAIL");
  assert.match(bad.reasons.join("\n"), /9\.9\.9/);
  assert.ok(bad.reasons.join("\n").includes(j.claudeCodeVersion));
});

test("CC-extraction-covers-judged/fail-closed-unparseable: a throwing or unparseable version command, or a throwing extraction, is FAIL", () => {
  const j = judged();
  const bin = fakeBinary(names(j.user), names(j.project), true);
  assert.equal(checkExtraction(envFor(bin), () => { throw new Error("timed out"); }).status, "FAIL");
  assert.equal(checkExtraction(envFor(bin), () => "garbage").status, "FAIL");
  const noAnchor = join(mkdtempSync(join(tmpdir(), "cc452-")), "claude-fake");
  writeFileSync(noAnchor, "nothing here", "latin1");
  const r = checkExtraction(envFor(noAnchor), () => `${j.claudeCodeVersion} (Claude Code)`);
  assert.equal(r.status, "FAIL");
  assert.match(r.reasons.join("\n"), /anchor not found/);
});

test("CC-extraction-covers-judged/absent-binary-skipped-or-required: absent is SKIPPED by default, FAIL under THOTH_REQUIRE_CLAUDE=1, never PASS", () => {
  const missing = join(isolatedHome(), "nope");
  const never = (): string => { throw new Error("version must not be asked when there is no binary"); };
  const d = checkExtraction(envFor(missing), never);
  assert.equal(d.status, "SKIPPED");
  assert.ok(d.reasons.length > 0);
  const r = checkExtraction(envFor(missing, { THOTH_REQUIRE_CLAUDE: "1" }), never);
  assert.equal(r.status, "FAIL");
  assert.equal(checkExtraction(envFor(missing, { THOTH_REQUIRE_CLAUDE: "0" }), never).status, "SKIPPED");
});

test("CC-extraction-covers-judged/installed-live: the installed binary's extraction equals the judgment and its version equals the recorded one", (t) => {
  const r = checkExtraction(process.env);
  if (r.status === "SKIPPED") {
    t.skip(`SKIPPED: ${r.reasons.join("; ")}; the pure tests above still ran`);
    return;
  }
  assert.equal(r.status, "PASS", r.reasons.join("; "));
});

test("CC-extraction-covers-judged/cli-exit-codes: exit 0 PASS / 1 FAIL / 3 SKIPPED with one final parseable line", () => {
  const j = judged();
  const bin = fakeBinary(names(j.user), names(j.project), true);
  const ver = (v: string) => (): string => v;
  const pass = runCli(envFor(bin), ver(`${j.claudeCodeVersion} (Claude Code)`));
  assert.equal(pass.code, 0);
  assert.match(pass.line, /^CC-extraction-covers-judged: PASS /);
  assert.match(pass.line, /user \d+\/\d+/);
  const fail = runCli(envFor(bin), ver("9.9.9 (Claude Code)"));
  assert.equal(fail.code, 1);
  assert.match(fail.line, /^CC-extraction-covers-judged: FAIL /);
  const missing = join(isolatedHome(), "nope");
  const skip = runCli(envFor(missing), ver("x"));
  assert.equal(skip.code, 3);
  assert.match(skip.line, /^CC-extraction-covers-judged: SKIPPED /);
  const req = runCli(envFor(missing, { THOTH_REQUIRE_CLAUDE: "1" }), ver("x"));
  assert.equal(req.code, 1, "never exit 3 when required");
  // the real script, spawned: no binary -> 3, required -> 1
  const run = (extra: NodeJS.ProcessEnv): { status: number | null; out: string } => {
    const home = isolatedHome();
    const r = spawnSync(process.execPath, [`${ROOT}src/qa/cc-extraction-covers-judged.ts`], { env: { ...process.env, THOTH_CLAUDE_BIN: join(home, "nope"), HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"), PATH: "", THOTH_REQUIRE_CLAUDE: "", ...extra }, encoding: "utf8", timeout: 60000 });
    return { status: r.status, out: r.stdout.trim().split(/\r?\n/).at(-1) ?? "" };
  };
  const s = run({});
  assert.equal(s.status, 3);
  assert.match(s.out, /^CC-extraction-covers-judged: SKIPPED /);
  const q = run({ THOTH_REQUIRE_CLAUDE: "1" });
  assert.equal(q.status, 1);
  assert.match(q.out, /^CC-extraction-covers-judged: FAIL /);
});

// ---- #462: every installed binary is checked, not the first one found -----------------------------------------------------
/** Put a fake binary at <home>/<rel>, readable by the real extractor. */
function place(home: string, rel: string, user: string[], project: string[]): string {
  const src = fakeBinary(user, project, true);
  const dest = join(home, ...rel.split("/"));
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, readFileSync(src));
  return dest;
}
const versionByPath = (map: Record<string, string>) => (bin: string): string => {
  const v = map[bin];
  if (v === undefined) throw new Error("unexpected binary " + bin);
  return v + " (Claude Code)";
};

test("CC-extraction-covers-judged/every-installed-binary-checked: a stale ~/.local/bin binary at the judged version does not hide a different extension binary", () => {
  const j = judged();
  const home = isolatedHome();
  const local = place(home, ".local/bin/claude.exe", names(j.user), names(j.project));
  const ext = place(home, ".vscode/extensions/anthropic.claude-code-9.9.9-win32-x64/resources/native-binary/claude.exe", [...names(j.user), "extra-new-dir"], names(j.project));
  const env = { HOME: home, USERPROFILE: home, PATH: "" };
  const r = checkExtraction(env, versionByPath({ [local]: j.claudeCodeVersion, [ext]: "9.9.9" }));
  assert.equal(r.status, "FAIL");
  const text = r.reasons.join("\n");
  assert.ok(text.includes(ext), "names the failing extension binary");
  assert.ok(text.includes("9.9.9") && text.includes("extra-new-dir"));
  assert.deepEqual(r.binaries.map((b) => b.path).sort(), [local, ext].sort());
  assert.deepEqual(r.binaries.map((b) => b.status).sort(), ["FAIL", "PASS"]);
});

test("CC-extraction-covers-judged/discovery-locations: local bin, EVERY versions entry, EVERY extension per editor, Desktop bundles, PATH, and the override in addition", () => {
  const j = judged();
  const home = isolatedHome();
  const mk = (rel: string): string => place(home, rel, names(j.user), names(j.project));
  const local = mk(".local/bin/claude.exe");
  const v9 = mk(".local/share/claude/versions/2.1.9");
  const v100 = mk(".local/share/claude/versions/2.1.100");
  const vs9 = mk(".vscode/extensions/anthropic.claude-code-2.1.9-win32-x64/resources/native-binary/claude.exe");
  const vs100 = mk(".vscode/extensions/anthropic.claude-code-2.1.100-win32-x64/resources/native-binary/claude.exe");
  const ins = mk(".vscode-insiders/extensions/anthropic.claude-code-1.0.0-win32-x64/resources/native-binary/claude.exe");
  const cur = mk(".cursor/extensions/anthropic.claude-code-1.0.0-win32-x64/resources/native-binary/claude.exe");
  const d1 = mk("AppData/Roaming/Claude/claude-code/2.1.284/3f4bed3e44ad/claude.exe");
  const d2 = mk("AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude-code/2.1.286/635c1867224a/claude.exe");
  const pathDir = join(home, "pathbin");
  const onPath = place(home, "pathbin/claude.exe", names(j.user), names(j.project));
  const override = place(home, "elsewhere/claude-copy", names(j.user), names(j.project));
  const base = { HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local") };
  const found = discoverClaudeBinaries({ ...base, PATH: pathDir, THOTH_CLAUDE_BIN: override });
  assert.deepEqual(found.map((b) => b.path).sort(), [local, v9, v100, vs9, vs100, ins, cur, d1, d2, onPath, override].sort());
  assert.deepEqual(found.filter((b) => b.override).map((b) => b.path), [override]);
  assert.equal(discoverClaudeBinaries({ ...base, PATH: "" }).length, 9, "override and PATH absent: nine found");
  assert.deepEqual(discoverClaudeBinaries({ HOME: isolatedHome(), USERPROFILE: "", PATH: "" }), []);
});

test("CC-extraction-covers-judged/desktop-bundled-binary-checked: a Claude Desktop bundled binary that differs fails the check, named", () => {
  const j = judged();
  const home = isolatedHome();
  const env = { HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"), PATH: "" };
  const ok = place(home, ".local/bin/claude.exe", names(j.user), names(j.project));
  const roaming = place(home, "AppData/Roaming/Claude/claude-code/2.1.284/3f4bed3e44ad/claude.exe", names(j.user), names(j.project));
  const msix = place(home, "AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude-code/2.1.286/635c1867224a/claude.exe", names(j.user), names(j.project));
  const r = checkExtraction(env, versionByPath({ [ok]: j.claudeCodeVersion, [roaming]: j.claudeCodeVersion, [msix]: "2.1.286" }));
  assert.equal(r.status, "FAIL");
  assert.ok(r.reasons.join("; ").includes(msix));
  assert.deepEqual(r.binaries.map((b) => b.path).sort(), [ok, roaming, msix].sort());
});

test("CC-extraction-covers-judged/every-entry-not-newest-only: a downgraded active extension next to an obsolete newer judged one still FAILs", () => {
  const j = judged();
  const home = isolatedHome();
  const env = { HOME: home, USERPROFILE: home, PATH: "" };
  const obsoleteNewer = place(home, ".vscode/extensions/anthropic.claude-code-2.1.300-win32-x64/resources/native-binary/claude.exe", names(j.user), names(j.project));
  const active = place(home, ".vscode/extensions/anthropic.claude-code-2.1.250-win32-x64/resources/native-binary/claude.exe", names(j.user), names(j.project));
  const oldVersionsEntry = place(home, ".local/share/claude/versions/2.1.240", names(j.user), names(j.project));
  const newVersionsEntry = place(home, ".local/share/claude/versions/2.1.267", names(j.user), names(j.project));
  const r = checkExtraction(env, versionByPath({ [obsoleteNewer]: j.claudeCodeVersion, [active]: "2.1.250", [oldVersionsEntry]: "2.1.240", [newVersionsEntry]: j.claudeCodeVersion }));
  assert.equal(r.status, "FAIL");
  const failing = r.binaries.filter((b) => b.status === "FAIL").map((b) => b.path).sort();
  assert.deepEqual(failing, [active, oldVersionsEntry].sort());
});

test("CC-extraction-covers-judged/discovery skips relative PATH entries", () => {
  const j = judged();
  const home = isolatedHome();
  const dir = join(home, "relbin");
  place(home, "relbin/claude.exe", names(j.user), names(j.project));
  const rel = relative(process.cwd(), dir);
  assert.ok(!isAbsolute(rel), "fixture is a relative path");
  assert.deepEqual(discoverClaudeBinaries({ HOME: isolatedHome(), USERPROFILE: "", PATH: rel }), []);
  assert.equal(discoverClaudeBinaries({ HOME: isolatedHome(), USERPROFILE: "", PATH: dir }).length, 1, "the same directory as an absolute entry is found");
});

test("CC-extraction-covers-judged/final-line-names-binary: the final line names every binary path checked with its version, and marks the override", () => {
  const j = judged();
  const home = isolatedHome();
  const local = place(home, ".local/bin/claude.exe", names(j.user), names(j.project));
  const override = place(home, "elsewhere/claude-copy", names(j.user), names(j.project));
  const env = { HOME: home, USERPROFILE: home, PATH: "", THOTH_CLAUDE_BIN: override, THOTH_EXEC_UNPROTECTED: "1" };
  const r = runCli(env, versionByPath({ [local]: j.claudeCodeVersion, [override]: j.claudeCodeVersion }));
  assert.equal(r.code, 0);
  assert.ok(r.line.includes(local) && r.line.includes(override), r.line);
  assert.ok(r.line.includes(j.claudeCodeVersion));
  assert.match(r.line, /\[override\]/);
  assert.equal((r.line.match(/\[override\]/g) ?? []).length, 1, "only the override is marked");
  const bad = runCli(env, versionByPath({ [local]: j.claudeCodeVersion, [override]: "9.9.9" }));
  assert.equal(bad.code, 1);
  assert.ok(bad.line.includes(local) && bad.line.includes(override) && bad.line.includes("9.9.9"), bad.line);
});

test("CC-extraction-covers-judged/judgment-unreadable-fails-closed: a missing or invalid judgment file is FAIL with a final line, not a crash", () => {
  const j = judged();
  const home = isolatedHome();
  const local = place(home, ".local/bin/claude.exe", names(j.user), names(j.project));
  const env = { HOME: home, USERPROFILE: home, PATH: "" };
  const bad = join(home, "judgment.json");
  writeFileSync(bad, "{ not json", "utf8");
  for (const path of [bad, join(home, "missing.json")]) {
    const r = runCli(env, versionByPath({ [local]: j.claudeCodeVersion }), path);
    assert.equal(r.code, 1);
    assert.match(r.line, /^CC-extraction-covers-judged: FAIL .*judgment/);
  }
});

// ---- #466: never execute a binary from an unprotected location; hash and flag it; execution needs a per-run opt-in ---------
const FLAG = "UNVERIFIED-UNPROTECTED";
const JUDGED_OK = (): string => `${judged().claudeCodeVersion} (Claude Code)`;
/** A fixture home with a protected-location binary and an unprotected one (an absolute PATH dir outside every protected dir). */
function twoBinaries(): { home: string; prot: string; unprot: string; env: NodeJS.ProcessEnv } {
  const j = judged();
  const home = isolatedHome();
  const prot = place(home, ".local/bin/claude.exe", names(j.user), names(j.project));
  const unprot = place(home, "pathbin/claude.exe", names(j.user), names(j.project));
  return { home, prot, unprot, env: { HOME: home, USERPROFILE: home, PATH: join(home, "pathbin") } };
}
const sha = (f: string): string => createHash("sha256").update(readFileSync(f)).digest("hex");

test("CC-no-exec-unprotected/provider-spy: the version provider is never called for an unprotected binary, and still called for a protected one", () => {
  const { prot, unprot, env } = twoBinaries();
  const asked: string[] = [];
  const r = checkExtraction(env, (b) => { asked.push(b); return JUDGED_OK(); });
  assert.deepEqual(asked, [prot], "only the protected binary was asked for its version");
  assert.equal(r.status, "FAIL");
  const u = r.binaries.find((b) => b.path === unprot)!;
  assert.equal(u.status, "FAIL");
  assert.equal(u.executed, false);
  assert.equal(r.binaries.find((b) => b.path === prot)!.executed, true);
});

test("CC-no-exec-unprotected/real-default-provider: with the real default provider a copy of the node binary on an unprotected PATH dir is not run", () => {
  const home = isolatedHome();
  const dir = join(home, "pathbin");
  mkdirSync(dir, { recursive: true });
  const planted = join(dir, process.platform === "win32" ? "claude.exe" : "claude");
  copyFileSync(process.execPath, planted);
  // the default provider (installedClaudeVersion) would run `--version` and get node's version string back
  const r = checkExtraction({ HOME: home, USERPROFILE: home, PATH: dir });
  assert.equal(r.status, "FAIL");
  const text = r.reasons.join("\n");
  assert.ok(text.includes(FLAG), text);
  assert.ok(!text.includes(process.version.replace(/^v/, "")), "node's version string never came back, so --version never ran");
  assert.ok(!/unparseable|could not be read/.test(text), text);
});

test("CC-exec-single-site: execFileSync is used in exactly one place, and checkOne reaches the version provider only behind the location gate", () => {
  const src = readFileSync(`${ROOT}src/qa/claude-code-write-deny-extract.ts`, "utf8");
  assert.equal((src.match(/execFileSync\(/g) ?? []).length, 1, "one call site");
  const fn = src.slice(src.indexOf("export function installedClaudeVersion"));
  assert.ok(fn.slice(0, fn.indexOf("\n}")).includes("execFileSync("), "and it is inside installedClaudeVersion");
  const one = src.slice(src.indexOf("function checkOne"));
  const gate = one.indexOf("mayExecute");
  const call = one.indexOf("versionProvider(");
  assert.ok(gate >= 0 && call > gate, "checkOne tests the gate before it calls the provider");
});

test("CC-flagged-hash-and-flag: a flagged binary carries its sha256 and the flag, and its extraction still ran read-only", () => {
  const { unprot, env } = twoBinaries();
  const r = checkExtraction(env, JUDGED_OK);
  const u = r.binaries.find((b) => b.path === unprot)!;
  assert.equal(u.sha256, sha(unprot));
  assert.match(u.sha256 ?? "", /^[0-9a-f]{64}$/);
  assert.equal(u.flag, FLAG);
  assert.ok(u.reasons.some((x) => x.includes(FLAG) && x.includes(sha(unprot))), "the reason names the flag and the hash");
  assert.ok(u.counts !== undefined && u.counts.extractedUser > 0, "extraction counts reported");
});

test("CC-flagged-fails-closed: a flagged binary is FAIL even when everything else holds and even when it is the only binary found", () => {
  const { env } = twoBinaries();
  assert.equal(checkExtraction(env, JUDGED_OK).status, "FAIL");
  const j = judged();
  const home = isolatedHome();
  const only = place(home, "pathbin/claude.exe", names(j.user), names(j.project));
  const alone = checkExtraction({ HOME: home, USERPROFILE: home, PATH: join(home, "pathbin") }, JUDGED_OK);
  assert.equal(alone.status, "FAIL", "never PASS and never SKIPPED");
  assert.deepEqual(alone.binaries.map((b) => b.path), [only]);
});

test("CC-flagged-cli-exit-and-final-line: exit 1 and a final FAIL line naming the path, the sha256 and the opt-in hint", () => {
  const { unprot, env } = twoBinaries();
  const r = runCli(env, JUDGED_OK);
  assert.equal(r.code, 1);
  assert.match(r.line, /^CC-extraction-covers-judged: FAIL /);
  assert.ok(r.line.includes(unprot) && r.line.includes(sha(unprot)) && r.line.includes(FLAG) && r.line.includes("THOTH_EXEC_UNPROTECTED=1"), r.line);
});

test("CC-optin-executes-only-with-1: only the exact string 1 lets the provider run for an unprotected binary", () => {
  const { unprot, env } = twoBinaries();
  for (const v of [undefined, "", "0", "true", "yes", " 1", "11"]) {
    const asked: string[] = [];
    checkExtraction({ ...env, ...(v === undefined ? {} : { THOTH_EXEC_UNPROTECTED: v }) }, (b) => { asked.push(b); return JUDGED_OK(); });
    assert.ok(!asked.includes(unprot), `value ${JSON.stringify(v)} must not execute`);
  }
  const asked: string[] = [];
  const r = checkExtraction({ ...env, THOTH_EXEC_UNPROTECTED: "1" }, (b) => { asked.push(b); return JUDGED_OK(); });
  assert.ok(asked.includes(unprot), "the opt-in executes it");
  assert.equal(r.status, "PASS", r.reasons.join("; "));
  const u = r.binaries.find((b) => b.path === unprot)!;
  assert.equal(u.executed, true);
  assert.equal(u.sha256, sha(unprot), "still hashed when opted in");
});

test("CC-optin-marked-in-final-line: an opted-in unprotected execution is marked, and a version mismatch still FAILs", () => {
  const { unprot, prot, env } = twoBinaries();
  const withOpt = { ...env, THOTH_EXEC_UNPROTECTED: "1" };
  const v = judged().claudeCodeVersion;
  const ok = runCli(withOpt, versionByPath({ [prot]: v, [unprot]: v }));
  assert.equal(ok.code, 0, ok.line);
  assert.equal((ok.line.match(/\[exec-opt-in\]/g) ?? []).length, 1, "only the unprotected binary is marked");
  assert.ok(ok.line.includes(sha(unprot)));
  const bad = runCli(withOpt, versionByPath({ [prot]: v, [unprot]: "9.9.9" }));
  assert.equal(bad.code, 1);
  assert.ok(bad.line.includes("9.9.9"));
});

test("CC-override-gated-like-any-location: THOTH_CLAUDE_BIN outside the protected dirs is flagged, and the override inside one is not", () => {
  const j = judged();
  const home = isolatedHome();
  const outside = place(home, "elsewhere/claude-copy", names(j.user), names(j.project));
  const inside = place(home, ".local/bin/claude-copy", names(j.user), names(j.project));
  const asked: string[] = [];
  const spy = (b: string): string => { asked.push(b); return JUDGED_OK(); };
  const a = checkExtraction({ HOME: home, USERPROFILE: home, PATH: "", THOTH_CLAUDE_BIN: outside }, spy);
  assert.equal(a.status, "FAIL");
  assert.deepEqual(asked, []);
  const b = checkExtraction({ HOME: home, USERPROFILE: home, PATH: "", THOTH_CLAUDE_BIN: inside }, spy);
  assert.equal(b.status, "PASS", b.reasons.join("; "));
  assert.deepEqual(asked, [inside]);
});

test("CC-redirected-appdata-and-unpinned-package-flagged: a Desktop binary under a redirected APPDATA or an unpinned Claude_* package is not executed", () => {
  const j = judged();
  const home = isolatedHome();
  const redirected = join(isolatedHome(), "Roaming");
  const d1 = place(redirected, "Claude/claude-code/2.1.284/h1/claude.exe", names(j.user), names(j.project));
  const d2 = place(home, "AppData/Local/Packages/Claude_abc123/LocalCache/Roaming/Claude/claude-code/2.1.286/h2/claude.exe", names(j.user), names(j.project));
  const asked: string[] = [];
  const r = checkExtraction({ HOME: home, USERPROFILE: home, PATH: "", APPDATA: redirected, LOCALAPPDATA: join(home, "AppData", "Local") }, (b) => { asked.push(b); return JUDGED_OK(); });
  assert.deepEqual(asked, []);
  assert.deepEqual(r.binaries.map((b) => b.path).sort(), [d1, d2].sort());
  assert.ok(r.binaries.every((b) => b.flag === FLAG));
});
