// #463 / #467 (S7, k-blocker, story a1): the certified set (active VS Code extension, local CLI, Desktop bundles, PATH, override) against
// the retained entries (versions/ entries, VS Code-obsolete extension dirs), the per-binary remedy (re-judge / update / prune), the census
// of `.claude` shapes outside the extractor window, and the options-object signature. Written FAILING FIRST.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkExtraction, discoverClaudeBinaries, extractWriteDeny, type CheckOptions, type Judged } from "./claude-code-write-deny-extract.ts";
import { runCli } from "./cc-extraction-covers-judged.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const JUDGMENT_FILE = `${ROOT}docs/qa/claude-code-write-deny-judgment.json`;
const judged = (): Judged => JSON.parse(readFileSync(JUDGMENT_FILE, "utf8")) as Judged;

/** #477: a census name must be judged in the anywhere section or in BOTH window lists. The fake binaries carry every window entry, so the judgment
 * the tests run against is the real one plus residual anywhere scaffolding for the names judged at one level only. The real file is untouched. */
const scaffoldedJudgment = (): string => {
  const j = judged();
  const user = new Set(j.user.map((e) => e.name));
  const have = new Set((j.anywhere ?? []).map((e) => e.name));
  const extra = j.project.filter((e) => !user.has(e.name) && !have.has(e.name)).map((e) => ({ name: e.name, judgment: "residual" as const, reason: "test scaffold" }));
  const p = join(mkdtempSync(join(tmpdir(), "cc-judgment-")), "judgment.json");
  writeFileSync(p, JSON.stringify({ ...j, anywhere: [...(j.anywhere ?? []), ...extra] }), "utf8");
  return p;
};
const SCAFFOLD = scaffoldedJudgment();
const check = (env: NodeJS.ProcessEnv, vp?: (b: string) => string, jp: string = SCAFFOLD, o?: CheckOptions): ReturnType<typeof checkExtraction> => checkExtraction(env, vp, jp, o);
const cli = (env: NodeJS.ProcessEnv, vp?: (b: string) => string, jp: string = SCAFFOLD): ReturnType<typeof runCli> => runCli(env, vp, jp);
const names = (es: { name: string }[]): string[] => es.map((e) => e.name);
const OPT_IN = { THOTH_EXEC_UNPROTECTED: "1" };

/** A fake binary the real extractor reads. `after` is text placed AFTER the end mark (outside the anchored window). */
function fakeBinary(user: string[], project: string[], after = "", getter = "Se"): string {
  const arr = ["shell-snapshots", "session-env", "plugins", ...user].map((n) => JSON.stringify(n)).join(",");
  const proj = project.map((n) => `G(Ml(Ie,".claude","${n}"),!0);`).join("");
  return `xx;let a=1;for(let S of[${arr}]){q}G(Ml(${getter}(),"loop.md"),!1);${proj}U.push(Ml(Ie,".mcp.json"));bareGitRepoScrubPaths.length=0;${after}`;
}
const home = (): string => mkdtempSync(join(tmpdir(), "cc463-home-"));
function place(h: string, rel: string, user: string[], project: string[], after = "", getter = "Se"): string {
  const dest = join(h, ...rel.split("/"));
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, fakeBinary(user, project, after, getter), "latin1");
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
  const r = check(envOf(h), versions({ [local]: judged().claudeCodeVersion }));
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
  const r = check(envOf(h), versions({ [v]: judged().claudeCodeVersion }));
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
  const r = check(envOf(h), versions({ [v]: judged().claudeCodeVersion }));
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
  const r = check(envOf(h), versions({ [local]: judged().claudeCodeVersion, [old]: "2.1.240" }));
  assert.equal(find(r.binaries, local).status, "PASS");
  const b = find(r.binaries, old);
  assert.deepEqual([b.status, b.remedy, b.certified], ["FAIL", "prune", false]);
  assert.ok(!b.reasons.join("\n").includes("re-judge"));
});

test("CC-cert/certified-version-mismatch: the local CLI at another version is FAIL with remedy update, not prune", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project);
  const r = check(envOf(h), versions({ [local]: "9.9.9" }));
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
  const r = check(envOf(h), versions({ [obsolete]: "2.1.100", [active]: "2.1.250" }));
  const o = find(r.binaries, obsolete);
  const a = find(r.binaries, active);
  assert.deepEqual([o.certified, o.status, o.remedy], [false, "FAIL", "prune"]);
  assert.deepEqual([a.certified, a.status, a.remedy], [true, "FAIL", "update"]);
  // an obsolete dir that is clean at the judged version is PASS, still uncertified
  const r2 = check(envOf(h), versions({ [obsolete]: judged().claudeCodeVersion, [active]: judged().claudeCodeVersion }));
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
  const r = check(envOf(h), versions({ [e1]: judged().claudeCodeVersion, [e2]: judged().claudeCodeVersion }));
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
  const r = cli(envOf(h), versions({ [local]: judged().claudeCodeVersion, [old]: "2.1.240" }));
  assert.equal(r.code, 1);
  assert.match(r.line, /^CC-extraction-covers-judged: FAIL /);
  const checked = r.line.split("checked: ")[1]!.split(" | ")[0]!;
  const seg = (p: string): string => checked.split("; ").find((s) => s.startsWith(p))!;
  assert.ok(/\bcertified\b/.test(seg(local)) && !/uncertified/.test(seg(local)), seg(local));
  assert.ok(/uncertified/.test(seg(old)) && seg(old).includes("prune"), seg(old));
});

test("CC-cert/flag-union: BinaryResult.flag admits a second literal; an uncertified FAIL carries it, an unexecuted unprotected binary keeps the #466 flag", () => {
  const h = home();
  const { user, project } = full();
  const old = place(h, ".local/share/claude/versions/2.1.240", user, project);
  const r = check(envOf(h), versions({ [old]: "2.1.240" }));
  assert.equal(find(r.binaries, old).flag, "UNCERTIFIED-STALE");
  const h2 = home();
  const outside = place(h2, "pathbin/claude.exe", user, project);
  const r2 = check({ ...envOf(h2), PATH: join(h2, "pathbin"), THOTH_EXEC_UNPROTECTED: "" }, versions({}));
  assert.equal(find(r2.binaries, outside).flag, "UNVERIFIED-UNPROTECTED");
});

test("CC-cert/options-object: the protected list is passed as an options object (4th parameter), not positionally", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project);
  const asked: string[] = [];
  const spy = (b: string): string => { asked.push(b); return `${judged().claudeCodeVersion} (Claude Code)`; };
  check({ ...envOf(h), THOTH_EXEC_UNPROTECTED: "" }, spy, undefined, { protectedList: ["~/.local/bin/"] });
  assert.deepEqual(asked, [local], "listed as protected: executed");
  asked.length = 0;
  check({ ...envOf(h), THOTH_EXEC_UNPROTECTED: "" }, spy, undefined, { protectedList: [] });
  assert.deepEqual(asked, [], "not on the list: not executed");
});

// ---- census: `.claude` names anywhere in the binary, one namespace per name (#477, #478) -----------------------------------------
const OUTSIDE = 'G(Ml(Ie,".claude","zz-probe"),!0);G(Ml(Se(),"outside-user"),!1);';
/** Byte snippets copied (read-only) from the 2.1.289 VS Code extension binary on 2026-10-06. */
const REAL_289 = [
  'function JJn(e,n){let r=Ca(e);switch(n){case"project":return je(oe(),".claude","agent-memory",r)+Ye;case"local":return ym(r);case"user":return je(VV(),"agent-memory",r)+Ye}}',
  'P(CI(dr())??dr()),"agent-memory-local",e)+Ye;return je(oe(),".claude","agent-memory-local",e)+Ye}',
  'function Vo(e){let n=MR(e),r=_e(Tt(),".claude","state");return[r,_e(r,"settings-review.json")].some((s)=>Ao(s).some((g)=>MR(g)===n))}',
  'function qyn(){let e=we(),r=[_m(e,"ide")];if(a.CLAUDE_CONFIG_DIR||e.trim()==="")r.push(_m(TO.homedir(),".claude","ide").normalize("NFC"));if(O()==="wsl"){let n=a.USERPROFILE?q1t(a.USERPROFILE):null;if(n)r.push(_m(n,".claude","ide"));try{let h=se().readdirSync("/mnt/c/Users");for(let g of h)r.push(_m("/mnt/c/Users",g.name,".claude","ide"))}catch(s){}}return r}',
  'async function ue(){let e=se(),n=[],i=p(P(),".claude","local");if(await JCe())n.push({type:"npm-local"})}',
].join("");

test("CC-census/extractor: the whole-binary scan reports out-of-window names once, whichever shape found them; the window lists do not change", () => {
  const { user, project } = full();
  const bin = Buffer.from(fakeBinary(user, project, OUTSIDE), "latin1");
  const ex = extractWriteDeny(bin);
  assert.ok(ex.census?.includes("zz-probe"));
  assert.ok(ex.census?.includes("outside-user"));
  assert.ok(!ex.project.includes("zz-probe") && !ex.user.includes("outside-user"));
  assert.equal(new Set(ex.census).size, ex.census?.length, "each name once");
  const plain = extractWriteDeny(Buffer.from(fakeBinary(user, project), "latin1"));
  assert.deepEqual(plain.user, ex.user);
  assert.ok(!plain.census?.includes("zz-probe"));
});

test("CC-census/chunked: a shape straddling a scan-chunk boundary is still found", () => {
  const { user, project } = full();
  const head = fakeBinary(user, project);
  const pad = "z".repeat(16 * 1024 * 1024 - head.length - 20);
  const bin = Buffer.from(`${head}${pad}${OUTSIDE}`, "latin1");
  assert.ok(bin.length > 16 * 1024 * 1024);
  assert.ok(extractWriteDeny(bin).census?.includes("zz-probe"));
});

test("CC-census/call-and-variable-base: a call base, a variable-held config dir and a home-rooted base are all found (2.1.289 byte snippets)", () => {
  const { user, project } = full();
  const bin = Buffer.from(fakeBinary(user, project, REAL_289, "we"), "latin1");
  const census = extractWriteDeny(bin).census ?? [];
  for (const name of ["agent-memory", "agent-memory-local", "state", "ide", "local"]) assert.ok(census.includes(name), `${name} is in the census`);
});

test("CC-census/home-rooted-project-shape: a home-rooted .claude site is one census name; judging it at the project level only does not clear it", () => {
  const h = home();
  const { user, project } = full();
  const homeRooted = 'r.push(_m(TO.homedir(),".claude","zz-probe").normalize("NFC"));if(n)r.push(_m(n,".claude","zz-probe"));';
  const local = place(h, ".local/bin/claude.exe", user, project, homeRooted);
  const vp = versions({ [local]: judged().claudeCodeVersion });
  const bare = check(envOf(h), vp);
  assert.ok(bare.reasons.join("\n").includes("census:zz-probe"), bare.reasons.join("\n"));
  assert.ok(!bare.reasons.join("\n").includes("census:project:") && !bare.reasons.join("\n").includes("census:user:"), "no per-level label");
  const p = join(h, "judgment.json");
  writeFileSync(p, JSON.stringify({ ...(JSON.parse(readFileSync(SCAFFOLD, "utf8")) as Judged), project: [...judged().project, { name: "zz-probe", judgment: "protected", path: ".claude/zz-probe/", reason: "test" }] }), "utf8");
  const projectOnly = check(envOf(h), vp, p);
  assert.ok(projectOnly.reasons.join("\n").includes("census:zz-probe"), "a project-level judgment alone leaves the user level open");
  writeFileSync(p, JSON.stringify({ ...(JSON.parse(readFileSync(SCAFFOLD, "utf8")) as Judged), anywhere: [...((JSON.parse(readFileSync(SCAFFOLD, "utf8")) as Judged).anywhere ?? []), { name: "zz-probe", judgment: "residual", reason: "test" }] }), "utf8");
  const both = check(envOf(h), vp, p);
  assert.equal(both.status, "PASS", both.reasons.join("; "));
});

test("CC-census/covered-when-judged-at-both-levels: a name judged in both window lists needs no anywhere entry", () => {
  const h = home();
  const { user, project } = full();
  const both = judged().user.map((e) => e.name).find((n) => judged().project.some((e) => e.name === n))!;
  const local = place(h, ".local/bin/claude.exe", user, project, `G(Ml(Ie,".claude","${both}"),!0);`);
  const r = check(envOf(h), versions({ [local]: judged().claudeCodeVersion }));
  assert.equal(r.status, "PASS", r.reasons.join("; "));
});

test("CC-census/unjudged-fails-then-judged-passes: an out-of-window name fails as census-unjudged until it is judged once in the anywhere section", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project, OUTSIDE);
  const vp = versions({ [local]: judged().claudeCodeVersion });
  const bad = check(envOf(h), vp);
  assert.equal(bad.status, "FAIL");
  assert.ok(bad.reasons.join("\n").includes("census:zz-probe"), bad.reasons.join("\n"));
  assert.ok(bad.reasons.join("\n").includes("census:outside-user"));
  const withAnywhere = { ...(JSON.parse(readFileSync(SCAFFOLD, "utf8")) as Judged), anywhere: [...((JSON.parse(readFileSync(SCAFFOLD, "utf8")) as Judged).anywhere ?? []), { name: "zz-probe", judgment: "residual", reason: "test" }, { name: "outside-user", judgment: "residual", reason: "test" }] };
  const p = join(h, "judgment.json");
  writeFileSync(p, JSON.stringify(withAnywhere), "utf8");
  const ok = check(envOf(h), vp, p);
  assert.equal(ok.status, "PASS", ok.reasons.join("; "));
});

test("CC-census/anywhere-entries-not-required-in-extraction: a judged anywhere entry the binary lacks is not 'judged but not extracted'", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project);
  const p = join(h, "judgment.json");
  writeFileSync(p, JSON.stringify({ ...(JSON.parse(readFileSync(SCAFFOLD, "utf8")) as Judged), anywhere: [...((JSON.parse(readFileSync(SCAFFOLD, "utf8")) as Judged).anywhere ?? []), { name: "worktrees", judgment: "residual", reason: "test" }] }), "utf8");
  const r = check(envOf(h), versions({ [local]: judged().claudeCodeVersion }), p);
  assert.equal(r.status, "PASS", r.reasons.join("; "));
});

test("CC-census/literal-forms: a .claude/<name> literal is a census name, and only its first path segment is (round 2: a sentence that mentions a path now adds its name too, which is extra and safe)", () => {
  const { user, project } = full();
  const text = 'a=".claude/literal-one";b="~/.claude/literal-two";c="set it in .claude/prose-name for the project";d=".claude/not-a-name/deeper";';
  const census = extractWriteDeny(Buffer.from(fakeBinary(user, project, text), "latin1")).census ?? [];
  assert.ok(census.includes("literal-one") && census.includes("literal-two"));
  assert.ok(census.includes("not-a-name") && !census.includes("deeper"));
});

// ---- #475: the applier and its delta dir are on the protected list ----------------------------------------------------------
import { protectedPaths } from "./protected-path-list.ts";

test("CC-protected-entries/applier-and-delta-dir-on-list: the applier, its test and the delta directory are named protected paths", () => {
  const named = new Set(protectedPaths(ROOT).named);
  for (const p of ["src/qa/judgment-apply.ts", "src/qa/judgment-apply.test.ts", "docs/qa/judgment-deltas/"]) assert.ok(named.has(p), `${p} is a named protected path`);
});

// ---- #476: the runbook states the 2026-10-06 ruling --------------------------------------------------------------------------
test("CC-runbook/certified-set-and-remedies: the K runbook names the pin, the certified set and the update / re-judge / prune remedies, and no longer says #467 is open", () => {
  const text = readFileSync(`${ROOT}docs/runbooks/k-kill-switch-and-verification.md`, "utf8");
  for (const word of ["2.1.289", "certified", "update", "re-judge", "prune"]) assert.ok(text.includes(word), `runbook mentions ${word}`);
  assert.ok(!/decides #467/.test(text));
  assert.ok(/#467/.test(text) && /decided/i.test(text));
});

// ---- cheap LOWs --------------------------------------------------------------------------------------------------------------
test("CC-cert/versions-entry-is-local-bin-target: a versions/ entry whose realpath is the local CLI's realpath is certified", () => {
  const h = home();
  const { user, project } = full();
  const local = place(h, ".local/bin/claude.exe", user, project);
  const entry = place(h, ".local/share/claude/versions/2.1.267", user, project);
  const alias = (p: string): string => (p === entry ? local : p);
  const found = discoverClaudeBinaries(envOf(h), alias);
  assert.equal(found.find((b) => b.path === entry)?.certified, true);
  const other = place(h, ".local/share/claude/versions/2.1.240", user, project);
  assert.equal(discoverClaudeBinaries(envOf(h), alias).find((b) => b.path === other)?.certified, false);
});

test("CC-cert/path-launchable-wins-over-obsolete: a binary found by several sources is certified if any source certifies it", () => {
  const h = home();
  const { user, project } = full();
  const ext = place(h, EXT("2.1.267"), user, project);
  writeFileSync(join(h, ".vscode", "extensions", ".obsolete"), JSON.stringify({ "anthropic.claude-code-2.1.267-win32-x64": true }), "utf8");
  const dir = join(ext, "..");
  const found = discoverClaudeBinaries({ ...envOf(h), PATH: dir });
  const b = found.find((x) => x.path === ext)!;
  assert.equal(found.filter((x) => x.path === ext).length, 1);
  assert.equal(b.certified, true);
  assert.equal(b.uncertifiedWhy, undefined);
});

test("CC-cert/uncertified-why-names-the-editor: the reason says which editor's obsolete list it came from", () => {
  const h = home();
  const { user, project } = full();
  const obs = (root: string): void => writeFileSync(join(h, root, "extensions", ".obsolete"), JSON.stringify({ "anthropic.claude-code-1.0.0-win32-x64": true }), "utf8");
  const sub = "extensions/anthropic.claude-code-1.0.0-win32-x64/resources/native-binary/claude.exe";
  place(h, `.vscode/${sub}`, user, project);
  place(h, `.vscode-insiders/${sub}`, user, project);
  place(h, `.cursor/${sub}`, user, project);
  for (const r of [".vscode", ".vscode-insiders", ".cursor"]) obs(r);
  const why = Object.fromEntries(discoverClaudeBinaries(envOf(h)).map((b) => [b.source, b.uncertifiedWhy ?? ""]));
  assert.ok(/VS Code/.test(why["vscode"]!) && !/Insiders|Cursor/.test(why["vscode"]!), why["vscode"]);
  assert.ok(/Insiders/.test(why["vscode-insiders"]!), why["vscode-insiders"]);
  assert.ok(/Cursor/.test(why["cursor"]!), why["cursor"]);
});

test("CC-cert/final-line-readable: per-binary status, certified flag and remedy come first; census names appear once with a count", () => {
  const h = home();
  const { user, project } = full();
  const a = place(h, ".local/bin/claude.exe", user, project, OUTSIDE);
  const b = place(h, ".local/share/claude/versions/2.1.240", user, project, OUTSIDE);
  const r = cli(envOf(h), versions({ [a]: judged().claudeCodeVersion, [b]: "2.1.240" }));
  assert.equal(r.code, 1);
  assert.match(r.line, /^CC-extraction-covers-judged: FAIL checked: /);
  assert.equal(r.line.split("outside-user").length - 1, 1, "a census name is printed once, not once per binary");
  assert.match(r.line, /census-unjudged \(2\): /);
  assert.ok(r.line.indexOf("checked:") < r.line.indexOf("census-unjudged"));
  assert.ok(r.details.filter((d) => d.includes("outside-user")).length <= 1, "the printed detail lines collapse it too");
});

// ---- #477 round 2: structural census (red-team round 2) -------------------------------------------------------------------
/** Byte snippets copied (read-only) from the 2.1.289 VS Code extension binary on 2026-10-06. */
const REAL_289_ROUND2 = [
  'var Le=["**/.claude/scheduled_tasks.lock","**/.claude/scheduled_tasks.json","**/.claude/routines/.state/","**/.claude/worktrees/","**/.claude/checkpoints/","**/.claude/mailbox/","**/.claude/agent-registry.json","**/.claude/agent-memory-local","**/.claude/first-run","**/.claude/assistant-daemon-state.json"],pe="# claude-code-runtime";',
  '"Read(~/.claude/settings.json)","Read(~/.claude/settings.local.json)","Read(~/.claude/projects/**)","Read(~/.claude/shell-snapshots/**)","Read(~/.claude/history*)","Read(~/.claude/todos/**)","Read(~/.claude/statsig/**)","Read(~/.claude/ide/**)","Read(~/.netrc)",',
  'function DS(){let e=process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;if(e!==void 0)return(e||u(o(),".claude")).normalize("NFC");return we()}function dee(e=""){return e}',
  'r;try{r=(await Ek(Lf(DS(),".credentials.json"))).mtimeMs}catch{return If(e,n)}',
].join("");

test("CC-census/glob-prefix-rule-string-and-second-getter: glob-prefixed literals, rule strings and a second config-dir getter are census names (2.1.289 byte snippets)", () => {
  const { user, project } = full();
  const census = extractWriteDeny(Buffer.from(fakeBinary(user, project, REAL_289_ROUND2, "we"), "latin1")).census ?? [];
  for (const name of ["mailbox", "checkpoints", "agent-registry.json", "first-run", "assistant-daemon-state.json", "history", "todos", "statsig", ".credentials.json"]) assert.ok(census.includes(name), `${name} is in the census`);
  assert.ok(!census.some((n) => n.includes("*") || n.endsWith("/")), "glob characters and trailing slashes are stripped");
});

test("CC-census/getter-by-definition: a getter is any function or arrow binding whose body names .claude or a CONFIG_DIR variable, not only the window's ids", () => {
  const { user, project } = full();
  const text = 'function QQ(){return process.env.CLAUDE_CONFIG_DIR??"x"}const RR=cs(()=>(s()??i(R(),".claude")).normalize("NFC"),s);a(QQ(),"viaFunction");b(RR(),"viaArrow");c(NotAGetter(),"notThis");';
  const census = extractWriteDeny(Buffer.from(fakeBinary(user, project, text, "we"), "latin1")).census ?? [];
  assert.ok(census.includes("viaFunction") && census.includes("viaArrow"));
  assert.ok(!census.includes("notThis"), "an id with no config-dir definition is not a getter");
});

test("CC-census/prose-and-quotes: a name in a quoted sentence or template is found with trailing punctuation trimmed; no name comes from an unquoted run", () => {
  const { user, project } = full();
  const text = 'a="see the .claude/hooks. directory";b=`.claude/skills/x`;c=\'.claude/sq-name\';';
  const census = extractWriteDeny(Buffer.from(fakeBinary(user, project, text), "latin1")).census ?? [];
  for (const n of ["hooks", "skills", "sq-name"]) assert.ok(census.includes(n), n);
  assert.ok(!census.includes("hooks."));
});

// ---- #486: mcp-skill-archives serves SKILL.md as a skill, so it is protected at both levels ---------------------------------
test("CC-judgment/mcp-skill-archives-protected: judged protected in the user window and in the anywhere section, with both named paths", () => {
  const j = judged();
  const user = j.user.find((e) => e.name === "mcp-skill-archives");
  const anywhere = (j.anywhere ?? []).find((e) => e.name === "mcp-skill-archives");
  assert.equal(user?.judgment, "protected");
  assert.equal(user?.path, "~/.claude/mcp-skill-archives/");
  assert.equal(anywhere?.judgment, "protected");
  assert.equal(anywhere?.userPath, "~/.claude/mcp-skill-archives/");
  assert.equal(anywhere?.projectPath, ".claude/mcp-skill-archives/");
  const named = new Set(protectedPaths(ROOT).named.map((p) => p.toLowerCase()));
  assert.ok(named.has("~/.claude/mcp-skill-archives/") && named.has(".claude/mcp-skill-archives/"));
});

// ---- #479 round 3: the Claude Code config-dir children sets and const-held names are judged -------------------------------------
test("CC-judgment/config-dir-children-and-const-names-judged: every name in the 2.1.289 children sets, and daemon.lock, is judged (checked against the real judgment)", () => {
  const j = judged();
  const all = new Set([...j.user, ...j.project, ...(j.anywhere ?? [])].map((e) => e.name));
  const wanted = ["daemon.lock", "agent-memory-project", "api-dumps", "downloads", "file-transfers", "image-cache", "local-settings", "logs", "paste-cache", "project-settings", "scratch", "storage-v2", "systemd"];
  for (const n of wanted) assert.ok(all.has(n), `${n} is judged`);
  const sv2 = (j.anywhere ?? []).find((e) => e.name === "storage-v2");
  assert.equal(sv2?.judgment, "protected", "storage-v2 may hold the live copy of mailbox, agent memory and state, so it fails closed");
});
