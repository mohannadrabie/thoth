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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ANCHOR = '"shell-snapshots","session-env","plugins"';
const END_MARK = "bareGitRepoScrubPaths.length=0";

export interface Extracted {
  /** Names under the user config dir (~/.claude/<name>), sorted. */
  user: string[];
  /** Names under a project's .claude directory (.claude/<name>), sorted. */
  project: string[];
  /** True when the literal .mcp.json appears in the same function (a project-root file). */
  mcpJson: boolean;
}

/** Where the installed binary is, or undefined. THOTH_CLAUDE_BIN overrides (used by tests). */
export function locateClaudeBinary(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = env["USERPROFILE"] ?? env["HOME"] ?? homedir();
  const candidates = [env["THOTH_CLAUDE_BIN"], join(home, ".local", "bin", "claude.exe"), join(home, ".local", "bin", "claude")];
  return candidates.find((c): c is string => c !== undefined && c !== "" && existsSync(c));
}

export interface FoundBinary {
  path: string;
  /** Where it was found: override, local-bin, versions, vscode, vscode-insiders, cursor, PATH. */
  source: string;
  /** True only for THOTH_CLAUDE_BIN, which is checked in addition to the discovered ones, never instead. */
  override: boolean;
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
const firstFile = (dir: string): string | undefined => [join(dir, "claude.exe"), join(dir, "claude")].find(isFile);

/** #462: EVERY installed Claude Code binary, not the first one found. Order: override, local bin, newest versions/ entry, newest extension per editor, PATH (resolved without a shell). */
export function discoverClaudeBinaries(env: NodeJS.ProcessEnv = process.env): FoundBinary[] {
  const home = env["USERPROFILE"] || env["HOME"] || homedir();
  const out: FoundBinary[] = [];
  const seen = new Set<string>();
  const add = (path: string | undefined, source: string, override = false): void => {
    if (path === undefined || path === "" || !isFile(path)) return;
    const key = resolve(path).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path, source, override });
  };
  add(env["THOTH_CLAUDE_BIN"], "override", true);
  add(firstFile(join(home, ".local", "bin")), "local-bin");
  try {
    const dir = join(home, ".local", "share", "claude", "versions");
    const newest = readdirSync(dir).filter((n) => /^\d+\.\d+\.\d+$/.test(n)).sort(cmpVersion).at(-1);
    if (newest !== undefined) add(join(dir, newest), "versions");
  } catch {
    // no versions directory
  }
  for (const [root, source] of [[".vscode", "vscode"], [".vscode-insiders", "vscode-insiders"], [".cursor", "cursor"]] as const) {
    try {
      const dir = join(home, root, "extensions");
      const cands = readdirSync(dir)
        .map((n) => ({ n, v: /^anthropic\.claude-code-(\d+\.\d+\.\d+)/.exec(n)?.[1] }))
        .filter((c): c is { n: string; v: string } => c.v !== undefined && firstFile(join(dir, c.n, "resources", "native-binary")) !== undefined)
        .sort((a, b) => cmpVersion(a.v, b.v));
      const best = cands.at(-1);
      if (best !== undefined) add(firstFile(join(dir, best.n, "resources", "native-binary")), source);
    } catch {
      // no extensions directory
    }
  }
  for (const d of (env["PATH"] ?? env["Path"] ?? "").split(delimiter)) if (d !== "") add(firstFile(d), "PATH");
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
  for (const m of text.matchAll(/\(\w+\(\),"([^"/\\]+)"\)/g)) user.add(m[1]!);
  for (const m of text.matchAll(/\(\w+,"\.claude","([^"/\\]+)"\)/g)) project.add(m[1]!);
  return { user: [...user].sort(), project: [...project].sort(), mcpJson: text.includes('".mcp.json"') };
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
export interface Judged {
  claudeCodeVersion: string;
  user: JudgedEntry[];
  project: JudgedEntry[];
  projectRoot?: JudgedEntry[];
}

/** One line per extracted entry that has no judgment; empty when every entry is judged. */
export function unjudged(ex: Extracted, j: Judged): string[] {
  const out: string[] = [];
  const user = new Set(j.user.map((e) => e.name));
  const project = new Set(j.project.map((e) => e.name));
  for (const n of ex.user) if (!user.has(n)) out.push(`user:${n}`);
  for (const n of ex.project) if (!project.has(n)) out.push(`project:${n}`);
  if (ex.mcpJson && !(j.projectRoot ?? []).some((e) => e.name === ".mcp.json")) out.push("projectRoot:.mcp.json");
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

export interface BinaryResult {
  path: string;
  source: string;
  override: boolean;
  version?: string;
  status: "PASS" | "FAIL";
  reasons: string[];
  counts?: { extractedUser: number; judgedUser: number; extractedProject: number; judgedProject: number };
}

const JUDGMENT = fileURLToPath(new URL("../../docs/qa/claude-code-write-deny-judgment.json", import.meta.url));

/** Tri-state check of EVERY installed Claude Code against the judgment file. Each binary found must pass on its own. None found is SKIPPED, or FAIL under THOTH_REQUIRE_CLAUDE=1. Never PASS unless every check ran and held. */
export function checkExtraction(env: NodeJS.ProcessEnv = process.env, versionProvider: (binary: string) => string = installedClaudeVersion, judgmentPath: string = JUDGMENT): CheckResult {
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
  const binaries = found.map((b) => checkOne(b, j, versionProvider));
  const reasons = binaries.flatMap((b) => b.reasons.map((r) => `${b.path}: ${r}`));
  return { status: binaries.every((b) => b.status === "PASS") ? "PASS" : "FAIL", reasons, binaries };
}

function checkOne(b: FoundBinary, j: Judged, versionProvider: (binary: string) => string): BinaryResult {
  const binary = b.path;
  const reasons: string[] = [];
  let version: string | undefined;
  try {
    version = parseClaudeVersion(versionProvider(binary));
    if (version === undefined) reasons.push("installed Claude Code version is unparseable");
    else if (version !== j.claudeCodeVersion) reasons.push(`installed Claude Code ${version} is not the judged version ${j.claudeCodeVersion}: re-run extraction, re-judge every new entry, then bump claudeCodeVersion`);
  } catch (e) {
    reasons.push(`installed Claude Code version could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  let counts: BinaryResult["counts"];
  try {
    const ex = extractWriteDeny(readFileSync(binary));
    const c = coverage(ex, j);
    for (const u of c.unjudged) reasons.push(`extracted but not judged: ${u}`);
    for (const m of c.judgedNotExtracted) reasons.push(`judged but not extracted: ${m}`);
    counts = { extractedUser: ex.user.length, judgedUser: j.user.length, extractedProject: ex.project.length, judgedProject: j.project.length };
  } catch (e) {
    reasons.push(e instanceof Error ? e.message : String(e));
  }
  return { path: b.path, source: b.source, override: b.override, ...(version === undefined ? {} : { version }), status: reasons.length === 0 ? "PASS" : "FAIL", reasons, ...(counts === undefined ? {} : { counts }) };
}

if (import.meta.url ===`file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("claude-code-write-deny-extract.ts") === true) {
  const r = extractFromInstalled();
  if (r === undefined) console.log("claude-code-write-deny-extract: no installed Claude Code binary found");
  else console.log(JSON.stringify({ user: r.user, project: r.project, mcpJson: r.mcpJson }, null, 2));
}
