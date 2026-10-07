// #463 / #467 (S7, k-blocker, story a1): the certified set (active VS Code extension, local CLI, Desktop bundles, PATH, override) against
// the retained entries (versions/ entries, VS Code-obsolete extension dirs), the per-binary remedy (re-judge / update / prune), the census
// of `.claude` shapes outside the extractor window, and the options-object signature. Written FAILING FIRST.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkExtraction, discoverClaudeBinaries, extractWriteDeny, type Judged } from "./claude-code-write-deny-extract.ts";
import { runCli } from "./cc-extraction-covers-judged.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const JUDGMENT_FILE = `${ROOT}docs/qa/claude-code-write-deny-judgment.json`;
const judged = (): Judged => JSON.parse(readFileSync(JUDGMENT_FILE, "utf8")) as Judged;
const names = (es: { name: string }[]): string[] => es.map((e) => e.name);
const OPT_IN = { THOTH_EXEC_UNPROTECTED: "1" };

/** A fake binary the real extractor reads. `after` is text placed AFTER the end mark (outside the anchored window). */
function fakeBinary(user: string[], project: string[], after = ""): string {
  const arr = ["shell-snapshots", "session-env", "plugins", ...user].map((n) => JSON.stringify(n)).join(",");
  const proj = project.map((n) => `G(Ml(Ie,".claude","${n}"),!0);`).join("");
  return `xx;let a=1;for(let S of[${arr}]){q}G(Ml(Se(),"loop.md"),!1);${proj}U.push(Ml(Ie,".mcp.json"));bareGitRepoScrubPaths.length=0;${after}`;
}
const home = (): string => mkdtempSync(join(tmpdir(), "cc463-home-"));
function place(h: string, rel: string, user: string[], project: string[], after = ""): string {
  const dest = join(h, ...rel.split("/"));
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, fakeBinary(user, project, after), "latin1");
  return dest;
}
const envOf = (h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ HOME: h, USERPROFILE: h, PATH: "", APPDATA: join(h, "AppData", "Roaming"), LOCALAPPDATA: join(h, "AppData", "Local"), ...OPT_IN, ...extra });
const versions = (map: Record<string, string>) => (bin: string): string => {
  const v = map[bin];
  if (v === undefined) throw new Error(`unexpected binary ${bin}`);
  return `${v} (Claude Code)`;
};
const full = (): { user: string[]; project: string[] } => ({ user: names(judged().user), project: names(judged().project) });
const find = <T extends { path: string }>(xs: T[], p: string): T => xs.find((x) => x.path === p)!;
const EXT = (v: string): string => `.vscode/extensions/anthropic.claude-code-${v}-win32-x64/resources/native-binary/claude.exe`;

test("CC-cert/certified-with-gap: a certified binary (local CLI) with an unjudged entry is FAIL with remedy re-judge, never prune", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", [...user, "brand-new-dir"], project);
  const r = checkExtraction(envOf(h), versions({ [local]: judged().claudeCodeVersion }));
  const b = find(r.binaries, local);
  assert.equal(b.certified, true);
  assert.equal(b.status, "FAIL");
  assert.equal(b.remedy, "re-judge");
  assert.ok(b.reasons.some((x) => x.includes("brand-new-dir")));
  assert.ok(!b.reasons.join("\n").includes("prune"));
});

test("CC-cert/uncertified-with-gap: a retained versions/ entry with a gap is FAIL with remedy prune, and never mentions re-judge", () => {
  const h = home();
  const { user, project } = full();
  const v = place(h, ".local/share/claude/versions/2.1.240", [...user, "brand-new-dir"], project);
  const r = checkExtraction(envOf(h), versions({ [v]: judged().claudeCodeVersion }));
  const b = find(r.binaries, v);
  assert.equal(b.certified, false);
  assert.equal(b.status, "FAIL");
  assert.equal(b.remedy, "prune");
  assert.ok(!b.reasons.join("\n").includes("re-judge"), b.reasons.join("\n"));
  assert.ok(b.reasons.join("\n").includes(v), "the reason names the path to delete");
});

test("CC-cert/uncertified-clean: a retained versions/ entry at the judged version with a clean extraction is PASS (nothing to prune)", () => {
  const h = home();
  const { user, project } = full();
  const v = place(h, ".local/share/claude/versions/2.1.267", user, project);
  const r = checkExtraction(envOf(h), versions({ [v]: judged().claudeCodeVersion }));
  const b = find(r.binaries, v);
  assert.equal(b.certified, false);
  assert.equal(b.status, "PASS");
  assert.equal(b.remedy, undefined);
  assert.equal(r.status, "PASS");
});

test("CC-cert/versions-entry: a versions/ entry at another version is FAIL prune; the local CLI at the judged version stays PASS", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project);
  const old = place(h, ".local/share/claude/versions/2.1.240", user, project);
  const r = checkExtraction(envOf(h), versions({ [local]: judged().claudeCodeVersion, [old]: "2.1.240" }));
  assert.equal(find(r.binaries, local).status, "PASS");
  const b = find(r.binaries, old);
  assert.deepEqual([b.status, b.remedy, b.certified], ["FAIL", "prune", false]);
  assert.ok(!b.reasons.join("\n").includes("re-judge"));
});

test("CC-cert/certified-version-mismatch: the local CLI at another version is FAIL with remedy update, not prune", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project);
  const r = checkExtraction(envOf(h), versions({ [local]: "9.9.9" }));
  const b = find(r.binaries, local);
  assert.deepEqual([b.status, b.remedy, b.certified], ["FAIL", "update", true]);
  const text = b.reasons.join("\n");
  assert.ok(text.includes("9.9.9") && text.includes(judged().claudeCodeVersion) && text.includes("update"));
  assert.ok(!text.includes("prune"));
});

test("CC-cert/obsolete-vscode-dir: an extension dir listed in the editor's .obsolete file is uncertified (prune); an active one is certified (update)", () => {
  const h = home();
  const { user, project } = full();
  const obsolete = place(h, EXT("2.1.267"), user, project);
  const active = place(h, EXT("2.1.250"), user, project);
  writeFileSync(join(h, ".vscode", "extensions", ".obsolete"), JSON.stringify({ "anthropic.claude-code-2.1.267-win32-x64": true }), "utf8");
  const r = checkExtraction(envOf(h), versions({ [obsolete]: "2.1.100", [active]: "2.1.250" }));
  const o = find(r.binaries, obsolete);
  const a = find(r.binaries, active);
  assert.deepEqual([o.certified, o.status, o.remedy], [false, "FAIL", "prune"]);
  assert.deepEqual([a.certified, a.status, a.remedy], [true, "FAIL", "update"]);
  // an obsolete dir that is clean at the judged version is PASS, still uncertified
  const r2 = checkExtraction(envOf(h), versions({ [obsolete]: judged().claudeCodeVersion, [active]: judged().claudeCodeVersion }));
  assert.deepEqual([find(r2.binaries, obsolete).certified, find(r2.binaries, obsolete).status], [false, "PASS"]);
  assert.equal(r2.status, "PASS");
});

test("CC-cert/obsolete-file-absent: with no .obsolete file every extension dir is certified", () => {
  const h = home();
  const { user, project } = full();
  place(h, EXT("2.1.1"), user, project);
  place(h, ".cursor/extensions/anthropic.claude-code-1.0.0-win32-x64/resources/native-binary/claude.exe", user, project);
  const found = discoverClaudeBinaries(envOf(h));
  assert.equal(found.length, 2);
  assert.ok(found.every((b) => b.certified));
});

test("CC-cert/obsolete-file-invalid: a malformed .obsolete file fails closed: every extension dir certified, a reason names the file", () => {
  const h = home();
  const { user, project } = full();
  const e1 = place(h, EXT("2.1.267"), user, project);
  const e2 = place(h, EXT("2.1.250"), user, project);
  writeFileSync(join(h, ".vscode", "extensions", ".obsolete"), "{ not json", "utf8");
  const found = discoverClaudeBinaries(envOf(h));
  assert.ok(found.every((b) => b.certified));
  const r = checkExtraction(envOf(h), versions({ [e1]: judged().claudeCodeVersion, [e2]: judged().claudeCodeVersion }));
  assert.equal(r.status, "FAIL");
  assert.ok(r.reasons.join("\n").includes(".obsolete"));
});

test("CC-cert/discovery-certified-by-source: local CLI, PATH, override, Desktop certified; versions/ entries uncertified", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project);
  const v = place(h, ".local/share/claude/versions/2.1.9", user, project);
  const d = place(h, "AppData/Roaming/Claude/claude-code/2.1.284/3f4bed3e44ad/claude.exe", user, project);
  const onPath = place(h, "pathbin/claude.exe", user, project);
  const ov = place(h, "elsewhere/claude-copy", user, project);
  const found = discoverClaudeBinaries({ ...envOf(h), PATH: join(h, "pathbin"), THOTH_CLAUDE_BIN: ov });
  const cert = Object.fromEntries(found.map((b) => [b.path, b.certified]));
  assert.deepEqual(cert, { [local]: true, [v]: false, [d]: true, [onPath]: true, [ov]: true });
});

test("CC-cert/single-definition: the certified rule lives only in claude-code-write-deny-extract.ts (one .obsolete reader, no copy elsewhere)", () => {
  const dir = `${ROOT}src/qa`;
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const holders = sources.filter((f) => readFileSync(join(dir, f), "utf8").includes(".obsolete"));
  assert.deepEqual(holders, ["claude-code-write-deny-extract.ts"]);
  const own = readFileSync(`${dir}/claude-code-write-deny-extract.ts`, "utf8");
  assert.equal(own.split("certifyBinary(").length - 1 >= 2, true, "defined once and called from discovery");
  assert.equal(own.split("function certifyBinary").length - 1, 1, "one definition");
});

test("CC-cert/final-line: the final line marks each binary certified or uncertified and carries its remedy", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project);
  const old = place(h, ".local/share/claude/versions/2.1.240", user, project);
  const r = runCli(envOf(h), versions({ [local]: judged().claudeCodeVersion, [old]: "2.1.240" }));
  assert.equal(r.code, 1);
  assert.match(r.line, /^CC-extraction-covers-judged: FAIL /);
  const checked = r.line.split(" | checked: ")[1]!;
  const seg = (p: string): string => checked.split("; ").find((s) => s.startsWith(p))!;
  assert.ok(/\bcertified\b/.test(seg(local)) && !/uncertified/.test(seg(local)), seg(local));
  assert.ok(/uncertified/.test(seg(old)) && seg(old).includes("prune"), seg(old));
});

test("CC-cert/flag-union: BinaryResult.flag admits a second literal; an uncertified FAIL carries it, an unexecuted unprotected binary keeps the #466 flag", () => {
  const h = home();
  const { user, project } = full();
  const old = place(h, ".local/share/claude/versions/2.1.240", user, project);
  const r = checkExtraction(envOf(h), versions({ [old]: "2.1.240" }));
  assert.equal(find(r.binaries, old).flag, "UNCERTIFIED-STALE");
  const h2 = home();
  const outside = place(h2, "pathbin/claude.exe", user, project);
  const r2 = checkExtraction({ ...envOf(h2), PATH: join(h2, "pathbin"), THOTH_EXEC_UNPROTECTED: "" }, versions({}));
  assert.equal(find(r2.binaries, outside).flag, "UNVERIFIED-UNPROTECTED");
});

test("CC-cert/options-object: the protected list is passed as an options object (4th parameter), not positionally", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project);
  const asked: string[] = [];
  const spy = (b: string): string => { asked.push(b); return `${judged().claudeCodeVersion} (Claude Code)`; };
  checkExtraction({ ...envOf(h), THOTH_EXEC_UNPROTECTED: "" }, spy, undefined, { protectedList: ["~/.local/bin/"] });
  assert.deepEqual(asked, [local], "listed as protected: executed");
  asked.length = 0;
  checkExtraction({ ...envOf(h), THOTH_EXEC_UNPROTECTED: "" }, spy, undefined, { protectedList: [] });
  assert.deepEqual(asked, [], "not on the list: not executed");
});

// ---- census: `.claude` shapes outside the anchored window ----------------------------------------------------------------
const OUTSIDE = 'G(Ml(Ie,".claude","ide"),!0);G(Ml(Se(),"outside-user"),!1);';

test("CC-census/extractor: the whole-binary scan reports out-of-window project and user shapes; the window lists do not change", () => {
  const { user, project } = full();
  const bin = Buffer.from(fakeBinary(user, project, OUTSIDE), "latin1");
  const ex = extractWriteDeny(bin);
  assert.ok(ex.projectAnywhere?.includes("ide"));
  assert.ok(ex.userAnywhere?.includes("outside-user"));
  assert.ok(!ex.project.includes("ide") && !ex.user.includes("outside-user"));
  const plain = extractWriteDeny(Buffer.from(fakeBinary(user, project), "latin1"));
  assert.deepEqual(plain.user, ex.user);
  assert.ok(!plain.projectAnywhere?.includes("ide"));
});

test("CC-census/chunked: a shape straddling a scan-chunk boundary is still found", () => {
  const { user, project } = full();
  const head = fakeBinary(user, project);
  const pad = "z".repeat(16 * 1024 * 1024 - head.length - 20);
  const bin = Buffer.from(`${head}${pad}${OUTSIDE}`, "latin1");
  assert.ok(bin.length > 16 * 1024 * 1024);
  assert.ok(extractWriteDeny(bin).projectAnywhere?.includes("ide"));
});

test("CC-census/unjudged-fails-then-judged-passes: an out-of-window name fails as census-unjudged until it is judged in an OutsideWindow section", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project, OUTSIDE);
  const vp = versions({ [local]: judged().claudeCodeVersion });
  const bad = checkExtraction(envOf(h), vp);
  assert.equal(bad.status, "FAIL");
  assert.ok(bad.reasons.join("\n").includes("census:project:ide"), bad.reasons.join("\n"));
  assert.ok(bad.reasons.join("\n").includes("census:user:outside-user"));
  const j = judged();
  const withSections = { ...j, projectOutsideWindow: [{ name: "ide", judgment: "residual", reason: "test" }], userOutsideWindow: [{ name: "outside-user", judgment: "residual", reason: "test" }] };
  const p = join(h, "judgment.json");
  writeFileSync(p, JSON.stringify(withSections), "utf8");
  const ok = checkExtraction(envOf(h), vp, p);
  assert.equal(ok.status, "PASS", ok.reasons.join("; "));
});

test("CC-census/outside-window-entries-not-required-in-extraction: a judged OutsideWindow entry the binary lacks is not 'judged but not extracted'", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project);
  const p = join(h, "judgment.json");
  writeFileSync(p, JSON.stringify({ ...judged(), projectOutsideWindow: [{ name: "worktrees", judgment: "residual", reason: "test" }] }), "utf8");
  const r = checkExtraction(envOf(h), versions({ [local]: judged().claudeCodeVersion }), p);
  assert.equal(r.status, "PASS", r.reasons.join("; "));
});
