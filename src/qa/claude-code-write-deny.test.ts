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
