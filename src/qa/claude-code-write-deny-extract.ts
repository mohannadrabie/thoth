// #451 / #429 round 2 (S7): READ-ONLY extractor for the write-deny list the installed Claude Code binary builds for its own
// sandbox (the `~/.claude` and project `.claude` entries it treats as write-protected). It reads the binary's bundled JS
// text and never executes it. The binary is minified, so the extraction is anchored on string shapes, not identifier names:
//   - the array literal that contains "shell-snapshots","session-env","plugins" (the user-level loop),
//   - every other string-only array literal in the same function,
//   - `(<id>(),"<name>")` user-level entries and `(<id>,".claude","<name>")` project-level entries,
//   - the literal ".mcp.json".
// Reliability: this is an extraction from minified code, valid for the version recorded in the judgment file; a layout change
// makes it return fewer entries or throw "anchor not found", and the test fails loudly rather than passing vacuously.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { protectedPaths } from "./protected-path-list.ts";
import { classifyBinary, sha256File, type Location } from "./unprotected-location.ts";

const ANCHOR = '"shell-snapshots","session-env","plugins"';
const END_MARK = "bareGitRepoScrubPaths.length=0";

export interface Extracted {
  /** Names under the user config dir (~/.claude/<name>), sorted. */
  user: string[];
  /** Names under a project's .claude directory (.claude/<name>), sorted. */
  project: string[];
  /** True when the literal .mcp.json appears in the same function (a project-root file). */
  mcpJson: boolean;
  /** #463/#477 census: every `.claude` name found ANYWHERE in the binary, by any shape, one namespace (a name found by either shape is judged once and applies at both levels). Sorted. Absent for a hand-built Extracted. */
  census?: string[];
}

/** Where the installed binary is, or undefined. THOTH_CLAUDE_BIN overrides (used by tests). */
export function locateClaudeBinary(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = env["USERPROFILE"] ?? env["HOME"] ?? homedir();
  const candidates = [env["THOTH_CLAUDE_BIN"], join(home, ".local", "bin", "claude.exe"), join(home, ".local", "bin", "claude")];
  return candidates.find((c): c is string => c !== undefined && c !== "" && existsSync(c));
}

export interface FoundBinary {
  path: string;
  /** Where it was found: override, local-bin, versions, vscode, vscode-insiders, cursor, desktop, PATH. */
  source: string;
  /** True only for THOTH_CLAUDE_BIN, which is checked in addition to the discovered ones, never instead. */
  override: boolean;
  /** #463/#467: in the certified set (the binaries a governed session can run). A retained versions/ entry or a VS Code-obsolete extension dir is not. */
  certified: boolean;
  /** Why it is not certified (uncertified only). */
  uncertifiedWhy?: string;
  /** Notes discovery attached (e.g. an unreadable .obsolete file); each becomes a reason on the binary. */
  notes?: string[];
}

/** #463/#467: the ONE definition of the certified set. Certified = every discovered binary except a retained versions/ entry and an extension dir the editor marks obsolete. */
const EDITOR_LABEL: Readonly<Record<string, string>> = { vscode: "VS Code", "vscode-insiders": "VS Code Insiders", cursor: "Cursor" };
function certifyBinary(source: string, obsolete: boolean, isLocalCliTarget = false): { certified: boolean; uncertifiedWhy?: string } {
  if (source === "versions") return isLocalCliTarget ? { certified: true } : { certified: false, uncertifiedWhy: "retained versions/ entry" };
  if (obsolete) return { certified: false, uncertifiedWhy: `${EDITOR_LABEL[source] ?? source}-obsolete extension dir` };
  return { certified: true };
}

/** The editor's extensions/.obsolete file: a JSON object keyed by extension dir name. Absent = nothing obsolete. Unreadable or not an object = fail closed (nothing treated as obsolete, so every dir stays certified) and a note. */
function readObsolete(extDir: string): { names: Set<string>; note?: string } {
  const p = join(extDir, ".obsolete");
  if (!existsSync(p)) return { names: new Set() };
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not a JSON object");
    return { names: new Set(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k)) };
  } catch (e) {
    return { names: new Set(), note: `${p} is unreadable or not a JSON object (${e instanceof Error ? e.message : String(e)}); every extension dir is treated as certified, fix or delete the file` };
  }
}

const cmpVersion = (a: string, b: string): number => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};
const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const realPathOrSelf = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const firstFile = (dir: string): string | undefined => [join(dir, "claude.exe"), join(dir, "claude")].find(isFile);

/** #462: EVERY installed Claude Code binary, not the first one found. Order: override, local bin, every versions/ entry, every extension per editor, Claude Desktop bundles, absolute PATH entries (resolved without a shell). */
export function discoverClaudeBinaries(env: NodeJS.ProcessEnv = process.env, realpath: (p: string) => string = realPathOrSelf): FoundBinary[] {
  const home = env["USERPROFILE"] || env["HOME"] || homedir();
  const out: FoundBinary[] = [];
  const seen = new Map<string, FoundBinary>();
  const add = (path: string | undefined, source: string, override = false, obsolete = false, notes: string[] = [], isLocalCliTarget = false): void => {
    if (path === undefined || path === "" || !isFile(path)) return;
    const key = resolve(path).toLowerCase();
    const cert = certifyBinary(source, obsolete, isLocalCliTarget);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      // one binary found by several sources: certified wins (a binary launchable by name or run as the CLI is certified whatever else lists it)
      if (!earlier.certified && cert.certified) {
        earlier.certified = true;
        delete earlier.uncertifiedWhy;
      }
      return;
    }
    const found: FoundBinary = { path, source, override, ...cert, ...(notes.length === 0 ? {} : { notes }) };
    seen.set(key, found);
    out.push(found);
  };
  add(env["THOTH_CLAUDE_BIN"], "override", true);
  const localCli = firstFile(join(home, ".local", "bin"));
  add(localCli, "local-bin");
  const localReal = localCli === undefined ? undefined : realpath(localCli).toLowerCase();
  const list = (dir: string): string[] => {
    try {
      return readdirSync(dir);
    } catch {
      return []; // directory absent
    }
  };
  // every versions/ entry, not the newest only (a downgraded active binary must not hide behind an obsolete newer one)
  const versions = join(home, ".local", "share", "claude", "versions");
  for (const n of list(versions).filter((x) => /^\d+\.\d+\.\d+$/.test(x)).sort(cmpVersion)) add(join(versions, n), "versions", false, false, [], localReal !== undefined && realpath(join(versions, n)).toLowerCase() === localReal);
  for (const [root, source] of [[".vscode", "vscode"], [".vscode-insiders", "vscode-insiders"], [".cursor", "cursor"]] as const) {
    const dir = join(home, root, "extensions");
    const obsolete = readObsolete(dir);
    for (const n of list(dir).filter((x) => x.startsWith("anthropic.claude-code-")).sort()) add(firstFile(join(dir, n, "resources", "native-binary")), source, false, obsolete.names.has(n), obsolete.note === undefined ? [] : [obsolete.note]);
  }
  // Claude Desktop bundles: <root>/<version>/<hash>/claude(.exe), classic install and the MSIX package's redirected AppData
  const roaming = env["APPDATA"] || join(home, "AppData", "Roaming");
  const local = env["LOCALAPPDATA"] || join(home, "AppData", "Local");
  const desktopRoots = [join(roaming, "Claude", "claude-code")];
  const packages = join(local, "Packages");
  for (const p of list(packages).filter((x) => x.startsWith("Claude_"))) desktopRoots.push(join(packages, p, "LocalCache", "Roaming", "Claude", "claude-code"));
  for (const root of desktopRoots) for (const v of list(root)) for (const h of list(join(root, v))) add(firstFile(join(root, v, h)), "desktop");
  // PATH: absolute entries only (a relative entry would resolve against whatever the current directory is)
  for (const d of (env["PATH"] ?? env["Path"] ?? "").split(delimiter)) if (d !== "" && isAbsolute(d)) add(firstFile(d), "PATH");
  return out;
}

/** Pure: extract from the binary's bytes. Throws when the anchor is absent (layout changed). */
export function extractWriteDeny(bin: Buffer): Extracted {
  const at = bin.indexOf(ANCHOR);
  if (at < 0) throw new Error("write-deny anchor not found: the binary layout changed, re-spike the extraction");
  const end = bin.indexOf(END_MARK, at);
  if (end < 0) throw new Error("write-deny end mark not found: the binary layout changed, re-spike the extraction");
  const text = bin.subarray(Math.max(0, at - 6000), end).toString("latin1");
  const user = new Set<string>();
  const project = new Set<string>();
  // the main user-level loop: its array also holds identifiers (spread), so it is taken by position, not by shape
  const open = bin.lastIndexOf("[", at);
  const close = bin.indexOf("]", at);
  for (const s of bin.subarray(open, close).toString("latin1").matchAll(/"([A-Za-z][A-Za-z0-9_.-]*)"/g)) user.add(s[1]!);
  for (const m of text.matchAll(/\[("[^"\\[\]]+"(?:,"[^"\\[\]]+")*)\]/g)) {
    if (!m[1]!.includes(',"') && !/\.|-|_/.test(m[1]!)) continue; // a one-word array is not one of the lists
    for (const s of m[1]!.matchAll(/"([^"]+)"/g)) if (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(s[1]!) && s[1] !== "HEAD" && s[1] !== "objects" && s[1] !== "refs") user.add(s[1]!);
  }
  const getters = new Set<string>();
  for (const m of text.matchAll(/\(([\w$]+)\(\),"([^"/\\]+)"\)/g)) {
    getters.add(m[1]!);
    user.add(m[2]!);
  }
  for (const m of text.matchAll(/\(\w+,"\.claude","([^"/\\]+)"\)/g)) project.add(m[1]!);
  return { user: [...user].sort(), project: [...project].sort(), mcpJson: text.includes('".mcp.json"'), census: scanWholeBinary(bin, [...getters]) };
}

const SCAN_CHUNK = 16 * 1024 * 1024;
const SCAN_OVERLAP = 1024;
/** How far after `<id>=<getter>()` a use of the variable `<id>` is still read as a use of the config dir. */
const BIND_WINDOW = 600;
/** How far after a function or arrow head a mention of `".claude"` or CONFIG_DIR makes it a config-dir getter. */
const DEF_WINDOW = 260;
/** How far back from a `.claude/<name>` a quote character must be for the match to count as inside a string literal. */
const QUOTE_LOOKBACK = 120;
const NAME = "[A-Za-z0-9_.-]+";
const escapeId = (id: string): string => id.replaceAll("$", "\\$");
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\w$]/.test(c);

function* binaryChunks(bin: Buffer): Generator<string> {
  for (let start = 0; start < bin.length; start += SCAN_CHUNK) yield bin.subarray(start, Math.min(bin.length, start + SCAN_CHUNK + SCAN_OVERLAP)).toString("latin1");
}

/** The text of a function body or an arrow expression starting at `from`, cut at its own end (bounded by DEF_WINDOW): a function body ends at its matching `}`, an arrow expression at the first closing bracket, `;` or `,` at depth 0. Strings are not parsed (brackets inside one only shorten or lengthen the body slightly, which only adds or drops a candidate getter at the margin). */
function definitionBody(text: string, from: number, kind: "function" | "arrow"): string {
  let depth = kind === "function" ? 1 : 0;
  const limit = Math.min(text.length, from + DEF_WINDOW);
  for (let i = from; i < limit; i++) {
    const c = text[i]!;
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth < (kind === "function" ? 1 : 0) && (kind === "arrow" || c === "}")) return text.slice(from, i);
    } else if (kind === "arrow" && depth === 0 && (c === ";" || c === ",")) return text.slice(from, i);
  }
  return text.slice(from, limit);
}

/** Config-dir getters found by their DEFINITION, not by the window's ids: a `function ID(){...}` or `ID=<wrapper>(()=>...` / `ID=()=>...` whose body, within DEF_WINDOW characters, mentions `".claude"` or a CONFIG_DIR variable. The window's own ids are included. Extra ids only add names. */
function configDirGetters(bin: Buffer, windowGetters: readonly string[]): Set<string> {
  const ids = new Set(windowGetters);
  const mark = /"\.claude"|CONFIG_DIR/;
  for (const text of binaryChunks(bin)) {
    for (const m of text.matchAll(/function ([\w$]+)\(\)\{/g)) {
      const from = m.index + m[0].length;
      if (mark.test(definitionBody(text, from, "function"))) ids.add(m[1]!);
    }
    for (const m of text.matchAll(/\(\)=>/g)) {
      let p = m.index;
      if (text[p - 1] === "(") {
        p--;
        while (p > 0 && isWordChar(text[p - 1])) p--; // optional wrapper call: cs(() => ...)
      }
      if (text[p - 1] !== "=") continue;
      const end = p - 1;
      let q = end;
      while (q > 0 && end - q < 64 && isWordChar(text[q - 1])) q--; // the id is read backwards (a forward identifier regex is quadratic on a long run of word characters)
      const id = text.slice(q, end);
      if (id === "" || /^[0-9]/.test(id)) continue;
      if (mark.test(definitionBody(text, m.index + 4, "arrow"))) ids.add(id);
    }
  }
  return ids;
}

/** #463/#477 census, fail closed (extra names are fine, a missed name is not). Whole binary, in chunks (a 200 MB latin1 string is never built). Names come from:
 *   1. every `.claude/<name>` inside a quoted literal (single, double or backtick), with ANY prefix, glob or rule wrapper (`**` + `/.claude/mailbox/`, `Read(~/.claude/history*)`): the first path segment, glob characters and trailing dots dropped;
 *   2. `".claude","<name>"` with any base before it (identifier, call, member, home directory);
 *   3. `<getter>(),"<name>"` where the getter is ANY config-dir getter by definition (see configDirGetters), not only the window's;
 *   4. `<var>=<getter>()` followed, within BIND_WINDOW characters, by `(<var>,"<name>"` or `,<var>,"<name>"` (the config dir held in a variable).
 * Names are one namespace: a name from any shape is judged once for both `~/.claude/<name>` and `<project>/.claude/<name>`. Disclosed limits: a variable bound further than BIND_WINDOW, or reached through an alias of an alias, is not seen; a name assembled at run time is not a literal and is not seen; prose that mentions a path adds names (extra, safe). */
function scanWholeBinary(bin: Buffer, windowGetters: string[]): string[] {
  const names = new Set<string>();
  const add = (raw: string): void => {
    const n = raw.replace(/\.+$/, "");
    if (n !== "") names.add(n);
  };
  const getters = configDirGetters(bin, windowGetters);
  const pairRe = new RegExp(`"\\.claude","(${NAME})"`, "g");
  const pathRe = new RegExp(`\\.claude/(${NAME})`, "g");
  const g = [...getters].map(escapeId).join("|");
  const callRe = getters.size === 0 ? undefined : new RegExp(`(?:${g})\\(\\),"(${NAME})"[,)]`, "g");
  const useRes = new Map<string, RegExp>();
  const bindRe = getters.size === 0 ? undefined : new RegExp(`=(?:${g})\\(\\)`, "g");
  for (const text of binaryChunks(bin)) {
    for (const m of text.matchAll(pairRe)) add(m[1]!);
    for (const m of text.matchAll(pathRe)) {
      const before = text.slice(Math.max(0, m.index - QUOTE_LOOKBACK), m.index);
      const nl = before.lastIndexOf("\n");
      if (/["'`]/.test(nl < 0 ? before : before.slice(nl + 1))) add(m[1]!);
    }
    if (callRe !== undefined) for (const m of text.matchAll(callRe)) add(m[1]!);
    if (bindRe !== undefined) {
      for (const b of text.matchAll(bindRe)) {
        let from = b.index;
        while (from > 0 && b.index - from < 64 && isWordChar(text[from - 1])) from--;
        const id = text.slice(from, b.index);
        if (id === "" || /^[0-9]/.test(id)) continue;
        const after = text.slice(b.index, b.index + BIND_WINDOW);
        let re = useRes.get(id);
        if (re === undefined) useRes.set(id, (re = new RegExp(`[(,]${escapeId(id)},"(${NAME})"[,)]`, "g")));
        for (const u of after.matchAll(re)) add(u[1]!);
      }
    }
  }
  return [...names].sort();
}

export function extractFromInstalled(env: NodeJS.ProcessEnv = process.env): (Extracted & { binary: string }) | undefined {
  const binary = locateClaudeBinary(env);
  if (binary === undefined) return undefined;
  return { binary, ...extractWriteDeny(readFileSync(binary)) };
}

export interface JudgedEntry {
  name: string;
  judgment: "protected" | "residual";
  reason: string;
  /** The named protected path (protected entries only), in the project-relative or ~/ form of namedPaths. */
  path?: string;
}
export interface JudgedAnywhere {
  name: string;
  judgment: "protected" | "residual";
  reason: string;
  /** protected only: the user-level named path (~/.claude/<name>) and the project-level one (.claude/<name>); both must be named protected paths. */
  userPath?: string;
  projectPath?: string;
}
export interface Judged {
  claudeCodeVersion: string;
  user: JudgedEntry[];
  project: JudgedEntry[];
  projectRoot?: JudgedEntry[];
  /** #477/#478: census names, judged ONCE for both levels (~/.claude/<name> and <project>/.claude/<name>). Not subject to judged-but-not-extracted. */
  anywhere?: JudgedAnywhere[];
}

/** One line per extracted entry that has no judgment; empty when every entry is judged. */
export function unjudged(ex: Extracted, j: Judged): string[] {
  const out: string[] = [];
  const user = new Set(j.user.map((e) => e.name));
  const project = new Set(j.project.map((e) => e.name));
  for (const n of ex.user) if (!user.has(n)) out.push(`user:${n}`);
  for (const n of ex.project) if (!project.has(n)) out.push(`project:${n}`);
  if (ex.mcpJson && !(j.projectRoot ?? []).some((e) => e.name === ".mcp.json")) out.push("projectRoot:.mcp.json");
  // #477/#478: a census name is covered when it is judged in the anywhere section, or judged in BOTH window lists; one level alone leaves the other open
  const anywhere = new Set((j.anywhere ?? []).map((e) => e.name));
  for (const n of ex.census ?? []) if (!anywhere.has(n) && !(user.has(n) && project.has(n))) out.push(`census:${n}`);
  return out;
}

/** #452: both directions. unjudged = extracted but not judged; judgedNotExtracted = judged but not extracted (a partial extraction). */
export function coverage(ex: Extracted, j: Judged): { unjudged: string[]; judgedNotExtracted: string[] } {
  const missing: string[] = [];
  const user = new Set(ex.user);
  const project = new Set(ex.project);
  for (const e of j.user) if (!user.has(e.name)) missing.push(`user:${e.name}`);
  for (const e of j.project) if (!project.has(e.name)) missing.push(`project:${e.name}`);
  for (const e of j.projectRoot ?? []) if (e.name === ".mcp.json" && !ex.mcpJson) missing.push("projectRoot:.mcp.json");
  return { unjudged: unjudged(ex, j), judgedNotExtracted: missing };
}

/** "2.1.267 (Claude Code)" -> "2.1.267"; anything else -> undefined. */
export function parseClaudeVersion(text: string): string | undefined {
  return /^(\d+\.\d+\.\d+)(?=\s|$)/.exec(text.trim().split(/\r?\n/)[0] ?? "")?.[1];
}

/** Asks the SAME binary the extractor reads (no shell, bounded). Throws on failure or timeout. */
export function installedClaudeVersion(binary: string): string {
  return execFileSync(binary, ["--version"], { timeout: 10000, encoding: "utf8", windowsHide: true });
}

export interface CheckResult {
  status: "PASS" | "FAIL" | "SKIPPED";
  reasons: string[];
  /** One entry per binary found and checked (empty when none was found). */
  binaries: BinaryResult[];
}

/** The remedy a failing binary needs: re-judge (certified, extraction gap), update (certified, other version), prune (uncertified, delete it). */
export type Remedy = "re-judge" | "update" | "prune";
export type BinaryFlag = typeof UNVERIFIED | typeof UNCERTIFIED_STALE;

export interface BinaryResult {
  path: string;
  source: string;
  override: boolean;
  version?: string;
  status: "PASS" | "FAIL";
  reasons: string[];
  /** #466: where the binary sits relative to the protected-path list. Only a protected one is executed by default. */
  location: Location;
  /** #466: sha256 of the bytes, read without executing (always present when the file could be read). */
  sha256?: string;
  /** #466: true only when the version provider was called for this binary. */
  executed: boolean;
  /** #466: set when an unprotected binary was NOT executed (no opt-in). Fail-closed: the binary is FAIL. */
  flag?: BinaryFlag;
  /** #463/#467: in the certified set. */
  certified: boolean;
  /** #463/#467: what to do about a failing binary (absent when it passes or the failure has no remedy of these three kinds). */
  remedy?: Remedy;
  counts?: { extractedUser: number; judgedUser: number; extractedProject: number; judgedProject: number };
}

/** #466: the per-run opt-in. Read from the env passed in, on every call; never stored, never defaulted on. Disclosed limit: under the opt-in a binary is hashed in one step and executed in a later one, and nothing compares the two, so the executed bytes can differ from the hashed ones. */
export const EXEC_UNPROTECTED_ENV = "THOTH_EXEC_UNPROTECTED";
const UNVERIFIED = "UNVERIFIED-UNPROTECTED" as const;
const UNCERTIFIED_STALE = "UNCERTIFIED-STALE" as const;
export interface CheckOptions {
  /** The protected-path list (tests pass one; the default is the generated list). */
  protectedList?: readonly string[];
}
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
let cachedProtected: readonly string[] | undefined;
const realProtectedList = (): readonly string[] => (cachedProtected ??= protectedPaths(REPO_ROOT).all);

const JUDGMENT = fileURLToPath(new URL("../../docs/qa/claude-code-write-deny-judgment.json", import.meta.url));

/** Tri-state check of EVERY installed Claude Code against the judgment file. Each binary found must pass on its own. None found is SKIPPED, or FAIL under THOTH_REQUIRE_CLAUDE=1. Never PASS unless every check ran and held. */
export function checkExtraction(env: NodeJS.ProcessEnv = process.env, versionProvider: (binary: string) => string = installedClaudeVersion, judgmentPath: string = JUDGMENT, options: CheckOptions = {}): CheckResult {
  const found = discoverClaudeBinaries(env);
  if (found.length === 0) {
    const reason = "no installed Claude Code binary";
    return env["THOTH_REQUIRE_CLAUDE"] === "1" ? { status: "FAIL", reasons: [`${reason} (THOTH_REQUIRE_CLAUDE=1: absence is a failure)`], binaries: [] } : { status: "SKIPPED", reasons: [reason], binaries: [] };
  }
  let j: Judged;
  try {
    j = JSON.parse(readFileSync(judgmentPath, "utf8")) as Judged;
  } catch (e) {
    return { status: "FAIL", reasons: [`judgment file unreadable or invalid (${judgmentPath}): ${e instanceof Error ? e.message : String(e)}`], binaries: [] };
  }
  const ctx: Ctx = { home: env["USERPROFILE"] || env["HOME"] || homedir(), protectedAll: options.protectedList ?? realProtectedList(), optIn: env[EXEC_UNPROTECTED_ENV] === "1" };
  const binaries = found.map((b) => checkOne(b, j, versionProvider, ctx));
  const reasons = binaries.flatMap((b) => b.reasons.map((r) => `${b.path}: ${r}`));
  return { status: binaries.every((b) => b.status === "PASS") ? "PASS" : "FAIL", reasons, binaries };
}

interface Ctx {
  home: string;
  protectedAll: readonly string[];
  optIn: boolean;
}

function checkOne(b: FoundBinary, j: Judged, versionProvider: (binary: string) => string, ctx: Ctx): BinaryResult {
  const binary = b.path;
  const reasons: string[] = [];
  let version: string | undefined;
  // #466: only a binary at a protected location is executed by default; an unprotected one is hashed and flagged (fail-closed).
  const location = classifyBinary(binary, ctx.home, ctx.protectedAll);
  const mayExecute = location === "protected" || ctx.optIn;
  let sha256: string | undefined;
  let versionMismatch = false;
  let gap = false;
  reasons.push(...(b.notes ?? []));
  try {
    sha256 = sha256File(binary);
  } catch (e) {
    reasons.push(`binary could not be hashed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!mayExecute) {
    reasons.push(`${UNVERIFIED}: not executed, sha256=${sha256 ?? "unreadable"}; its location is not on the protected-path list, so a session could have planted it. Set ${EXEC_UNPROTECTED_ENV}=1 for this run to execute it, or remove it`);
  } else {
    try {
      version = parseClaudeVersion(versionProvider(binary));
      if (version === undefined) reasons.push("installed Claude Code version is unparseable");
      else if (version !== j.claudeCodeVersion) {
        versionMismatch = true;
        reasons.push(b.certified ? `installed Claude Code ${version} is not the judged version ${j.claudeCodeVersion}: remedy update to ${j.claudeCodeVersion}, or remove it (Desktop: bundle ${j.claudeCodeVersion} or uninstall)` : `installed Claude Code ${version} is not the judged version ${j.claudeCodeVersion}`);
      }
    } catch (e) {
      reasons.push(`installed Claude Code version could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let counts: BinaryResult["counts"];
  try {
    const ex = extractWriteDeny(readFileSync(binary));
    const c = coverage(ex, j);
    for (const u of c.unjudged) reasons.push(`extracted but not judged: ${u}`);
    for (const m of c.judgedNotExtracted) reasons.push(`judged but not extracted: ${m}`);
    gap = c.unjudged.length > 0 || c.judgedNotExtracted.length > 0;
    counts = { extractedUser: ex.user.length, judgedUser: j.user.length, extractedProject: ex.project.length, judgedProject: j.project.length };
  } catch (e) {
    reasons.push(e instanceof Error ? e.message : String(e));
  }
  // #463/#467: the remedy. A certified binary is updated (other version) or re-judged (extraction gap); a failing uncertified one is pruned, never re-judged.
  let remedy: Remedy | undefined;
  if (reasons.length > 0) {
    if (!b.certified) {
      remedy = "prune";
      reasons.push(`uncertified (${b.uncertifiedWhy ?? "not in the certified set"}): remedy prune: delete ${b.path}`);
    } else if (versionMismatch) remedy = "update";
    else if (gap) {
      remedy = "re-judge";
      reasons.push("remedy re-judge: re-run extraction, re-judge every new entry, then bump claudeCodeVersion");
    }
  }
  const flag: BinaryFlag | undefined = !mayExecute ? UNVERIFIED : remedy === "prune" ? UNCERTIFIED_STALE : undefined;
  return { path: b.path, source: b.source, override: b.override, certified: b.certified, ...(version === undefined ? {} : { version }), status: reasons.length === 0 ? "PASS" : "FAIL", reasons, location, executed: mayExecute, ...(sha256 === undefined ? {} : { sha256 }), ...(flag === undefined ? {} : { flag }), ...(remedy === undefined ? {} : { remedy }), ...(counts === undefined ? {} : { counts }) };
}

if (import.meta.url ===`file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("claude-code-write-deny-extract.ts") === true) {
  const r = extractFromInstalled();
  if (r === undefined) console.log("claude-code-write-deny-extract: no installed Claude Code binary found");
  else console.log(JSON.stringify({ user: r.user, project: r.project, mcpJson: r.mcpJson, census: r.census }, null, 2));
}
