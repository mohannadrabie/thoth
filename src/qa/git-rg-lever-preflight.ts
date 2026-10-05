// #409 (S7): READ-ONLY preflight for git/rg exec-lever state that was already on disk before activation.
//
// Write protection (the protected list) cannot touch a file that exists before the gate is wired. This command finds
// what is already there, and says so, so the human clears it before K (the activation story) and before the later
// story that re-adds git or rg to the resolved set. Exit 0: no finding. Exit 1: one or more findings.
//
// Read-only by construction: it imports only fs READ functions and never starts a process (running git or rg is
// itself the lever), and it reads config files directly. src/qa/git-rg-lever-seal.test.ts checks both by AST scan
// and checks the fixture tree is byte-identical after a run. Environment VALUES are never printed, only key names.
//
// Scans: repo git config (and files it includes), non-sample hooks, root .gitattributes and .git/info/attributes;
// the user's ~/.gitconfig, ~/.config/git/{config,attributes}; system gitconfig files; %PROGRAMDATA%\Git\config
// (typically user-writable on Windows); lever keys in the process env; the file RIPGREP_CONFIG_PATH names (--pre,
// --search-zip, -z); lever keys in the project, local, user and managed settings `env` blocks; kubeconfig files with an
// exec credential plugin (read-side only, Issue #409 kubectl comment).
// The managed-settings default paths follow Claude Code's documentation and have not been checked on this machine.
//
// Usage: node src/qa/git-rg-lever-preflight.ts
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAmbientCommon, isLeverKey, scanSettingsEnv } from "./exec-lever-env.ts";

export interface Finding {
  /** The file (or "process env" / a settings scope) the finding is in. */
  where: string;
  /** The config key, lever key or finding kind. */
  key: string;
  detail: string;
  /** True for a finding that matches KNOWN_PROJECT_CONFIG: reported, not counted. */
  acknowledged?: true;
  /** Who can write the source: a session (repo files, user-home files, settings files, ProgramData) or only the ambient
   * machine (system gitconfig, process env, managed settings). Ambient findings are printed, never counted (#443). */
  scope?: "session-writable" | "ambient";
}

/** The process exit code: 1 when any counted finding exists, else 0. */
export const exitCodeFor = (findings: readonly Finding[]): number => (unacknowledged(findings).length === 0 ? 0 : 1);

export interface PreflightInput {
  repoRoot: string;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  /** %PROGRAMDATA% (Windows). Absent: not scanned. */
  programData?: string | undefined;
  /** System gitconfig files to read. Default: the usual POSIX and Git for Windows locations. */
  systemConfigPaths?: readonly string[] | undefined;
  managedSettingsPath?: string | undefined;
}

/** Residuals the seal does NOT close. Keys are pinned by S409-residuals-listed; the plan and CHANGELOG carry the same four. */
export const RESIDUALS: Readonly<Record<string, string>> = {
  R1: "shell profile files (~/.bashrc, ~/.profile, ~/.zshrc) are session-writable and feed the next session's shell env; routed to the #428 story",
  R2: "managed settings and OS-level or ambient environment are not session-writable and are not sealed; this command reads them",
  R3: "config that existed before activation (git config, hooks, attributes, rg config) is outside the write seal; this command detects it",
  R4: "user-scope settings env reach was not run live (J8 ran project scope only) and is treated as reachable; the user settings file is protected either way",
};

/** Repo-config entries this project sets on purpose, matched on key AND exact value, in the repo's own git config only.
 * core.hooksPath=.githooks is installed by src/lib/git-hooks-install.ts (npm prepare); .githooks/ is on the protected list. */
export const KNOWN_PROJECT_CONFIG: readonly { key: string; value: string; reason: string }[] = [
  { key: "core.hookspath", value: ".githooks", reason: "installed by src/lib/git-hooks-install.ts; .githooks/ is protected" },
];

/** Findings that count: session-writable scope, and not acknowledged project config. */
export const unacknowledged = (findings: readonly Finding[]): Finding[] => findings.filter((f) => f.acknowledged !== true && f.scope !== "ambient");

const DEFAULT_SYSTEM_CONFIGS = ["/etc/gitconfig", "C:/Program Files/Git/etc/gitconfig", "C:/Program Files/Git/mingw64/etc/gitconfig"];
const MAX_INCLUDE_DEPTH = 5;

type Read = { ok: true; text: string } | { ok: false; error: string } | undefined;

/** Reads a regular file only. A UNC path (an SMB authentication attempt on open) and a non-regular file (a FIFO could hang)
 * are skipped: some paths here are steered by data this command checks (env vars, include.path). */
function tryRead(path: string): Read {
  if (path.startsWith("//") || path.startsWith("\\\\")) return undefined;
  if (!existsSync(path)) return undefined;
  try {
    if (!statSync(path).isFile()) return undefined;
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const unreadable = (where: string, error: string): Finding => ({ where, key: "unreadable", detail: `exists but cannot be read, so it cannot be shown clean: ${error.slice(0, 120)}` });

// ---- git config -------------------------------------------------------------------------------------------------------

/** Is this git config key one that runs a program, or pulls in another file? */
// Default-deny by key shape (#441): any key ending in one of these runs, or names, a program. Explicit cases follow.
const EXEC_KEY_SUFFIX = /(cmd|command|program|helper|editor|pager|askpass|browser)$/;

function executingKey(section: string, sub: string | undefined, key: string, value: string): boolean {
  const v = value.replace(/^"/, "").trim();
  if (EXEC_KEY_SUFFIX.test(key)) return true;
  if (section === "submodule" && key === "update" && v.startsWith("!")) return true;
  switch (section) {
    case "core":
      return ["fsmonitor", "hookspath", "pager", "sshcommand", "editor", "askpass", "gitproxy"].includes(key);
    case "diff":
      return sub === undefined ? key === "external" : ["textconv", "command"].includes(key);
    case "filter":
      return ["clean", "smudge", "process"].includes(key);
    case "credential":
      return key === "helper";
    case "alias":
      return v.startsWith("!");
    case "gpg":
      return key === "program";
    case "sequence":
      return key === "editor";
    case "merge":
      return key === "driver";
    case "mergetool":
    case "difftool":
      return key === "cmd";
    case "pager":
      return true;
    case "trailer":
      return key === "cmd";
    case "uploadpack":
      return key === "packobjectshook";
    case "remote":
      return ["vcs", "uploadpack", "receivepack"].includes(key);
    case "include":
    case "includeif":
      return key === "path";
    default:
      return false;
  }
}

interface ConfigEntry {
  name: string;
  value: string;
  executing: boolean;
  isInclude: boolean;
}

export function parseGitConfig(text: string): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  let section = "";
  let sub: string | undefined;
  const header = /^\s*\[([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\]\s*(.*)$/;
  const keyLine = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*?))?\s*$/;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw;
    const h = header.exec(line);
    if (h !== null) {
      const name = h[1]!;
      if (h[2] !== undefined) {
        section = name.toLowerCase();
        sub = h[2];
      } else if (name.includes(".")) {
        const dot = name.indexOf(".");
        section = name.slice(0, dot).toLowerCase();
        sub = name.slice(dot + 1).toLowerCase();
      } else {
        section = name.toLowerCase();
        sub = undefined;
      }
      line = h[3] ?? "";
    }
    if (line.trim() === "" || /^\s*[#;]/.test(line)) continue;
    const k = keyLine.exec(line);
    if (k === null || section === "") continue;
    const key = k[1]!.toLowerCase();
    const value = k[2] ?? "";
    out.push({ name: [section, ...(sub === undefined ? [] : [sub]), key].join("."), value, executing: executingKey(section, sub, key, value), isInclude: (section === "include" || section === "includeif") && key === "path" });
  }
  return out;
}

function scanGitConfig(file: string, home: string, findings: Finding[], seen: Set<string>, depth: number, known: typeof KNOWN_PROJECT_CONFIG = []): void {
  const abs = resolve(file);
  if (seen.has(abs)) return;
  seen.add(abs);
  const r = tryRead(abs);
  if (r === undefined) return;
  if (!r.ok) {
    findings.push(unreadable(abs, r.error));
    return;
  }
  for (const e of parseGitConfig(r.text)) {
    if (!e.executing) continue;
    const ack = known.find((k) => k.key === e.name && k.value === e.value.replace(/^"|"$/g, ""));
    findings.push({
      where: abs,
      key: e.name,
      detail: ack !== undefined ? `known project config: ${ack.reason}` : e.isInclude ? "includes another config file (followed below); value not shown" : "runs a program or changes where git looks for one; value not shown",
      ...(ack !== undefined ? { acknowledged: true as const } : {}),
    });
    if (e.isInclude && depth < MAX_INCLUDE_DEPTH) {
      const target = e.value.replace(/^"|"$/g, "");
      const next = target.startsWith("~/") ? join(home, target.slice(2)) : isAbsolute(target) ? target : join(dirname(abs), target);
      scanGitConfig(next, home, findings, seen, depth + 1);
    }
  }
}

// ---- attributes, hooks ------------------------------------------------------------------------------------------------

function scanAttributes(file: string, findings: Finding[]): void {
  const r = tryRead(file);
  if (r === undefined) return;
  if (!r.ok) {
    findings.push(unreadable(file, r.error));
    return;
  }
  for (const raw of r.text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    for (const attr of ["diff", "filter"]) {
      if (new RegExp(`(^|\\s)${attr}=\\S+`).test(line)) findings.push({ where: file, key: `attribute ${attr}`, detail: `selects a ${attr} driver: ${line.slice(0, 100)}` });
    }
  }
}

function scanHooks(dir: string, findings: Finding[]): void {
  if (!existsSync(dir)) return;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    findings.push(unreadable(dir, e instanceof Error ? e.message : String(e)));
    return;
  }
  for (const n of names.sort()) {
    if (n.endsWith(".sample")) continue;
    const p = join(dir, n);
    if (statSync(p).isFile()) findings.push({ where: p, key: "hook", detail: "a non-sample hook file runs when git triggers it" });
  }
}

/** One git dir's own config, per-worktree config, hooks and attributes, then the submodule git dirs under modules/ (nested) and
 * the per-worktree config of each linked worktree under worktrees/ (#440). */
function scanGitDir(dir: string, home: string, findings: Finding[], seen: Set<string>, known: typeof KNOWN_PROJECT_CONFIG, depth: number): void {
  scanGitConfig(join(dir, "config"), home, findings, seen, 0, known);
  scanGitConfig(join(dir, "config.worktree"), home, findings, seen, 0, known);
  scanHooks(join(dir, "hooks"), findings);
  scanAttributes(join(dir, "info", "attributes"), findings);
  if (depth >= MAX_INCLUDE_DEPTH) return;
  for (const sub of listDirs(join(dir, "modules"))) scanGitDir(sub, home, findings, seen, [], depth + 1);
  for (const wt of listDirs(join(dir, "worktrees"))) scanGitConfig(join(wt, "config.worktree"), home, findings, seen, 0);
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir).sort().map((n) => join(dir, n)).filter((p) => statSync(p).isDirectory());
  } catch {
    return [];
  }
}

/** Each file in the project's own hooks dir (core.hooksPath target) is listed by name as a NOTE, never counted: its content is the
 * secret-scan hook, protected from session writes, but pre-existing content is outside the seal (R3) and is not inspected. */
function scanGithooksDir(dir: string, findings: Finding[]): void {
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    const p = join(dir, name);
    if (statSync(p).isFile()) findings.push({ where: p, key: "githooks file", detail: "project hook file listed for the human to review; content not inspected", acknowledged: true });
  }
}

/** The .git directory and the common directory (they differ in a linked worktree, where .git is a file). */
function gitDirs(repoRoot: string): { gitDir: string; commonDir: string } | undefined {
  const dot = join(repoRoot, ".git");
  if (!existsSync(dot)) return undefined;
  if (lstatSync(dot).isDirectory()) return { gitDir: dot, commonDir: dot };
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dot, "utf8"));
  if (pointer === null) return undefined;
  const gitDir = resolve(repoRoot, pointer[1]!);
  const common = tryRead(join(gitDir, "commondir"));
  return { gitDir, commonDir: common?.ok === true ? resolve(gitDir, common.text.trim()) : gitDir };
}

// ---- rg, kube, settings, env ------------------------------------------------------------------------------------------

function scanRgConfig(file: string, findings: Finding[]): void {
  const r = tryRead(file);
  if (r === undefined) return;
  if (!r.ok) {
    findings.push(unreadable(file, r.error));
    return;
  }
  for (const raw of r.text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const flag = /^--pre(-glob)?(=|$)/.test(line) ? "--pre" : /^--search-zip$/.test(line) ? "--search-zip" : /^-[A-Za-z]*z[A-Za-z]*$/.test(line) ? "-z" : undefined;
    if (flag !== undefined) findings.push({ where: file, key: `rg ${flag}`, detail: "ripgrep runs a decompressor or preprocessor program per file" });
  }
}

function scanKubeconfig(file: string, findings: Finding[]): void {
  const r = tryRead(file);
  if (r === undefined) return;
  if (!r.ok) {
    findings.push(unreadable(file, r.error));
    return;
  }
  if (/^\s*(-\s+)?(exec|auth-provider):/m.test(r.text)) findings.push({ where: file, key: "kubeconfig exec", detail: "a kubeconfig exec or auth-provider block runs a program when kubectl authenticates" });
}

function scanSettingsFile(scope: string, file: string, findings: Finding[]): void {
  const r = tryRead(file);
  if (r === undefined) return;
  if (!r.ok) {
    findings.push(unreadable(file, r.error));
    return;
  }
  try {
    for (const hit of scanSettingsEnv(scope, r.text)) findings.push({ where: `settings (${scope}): ${file}`, key: hit.key, detail: "a lever key in a settings env block reaches the hook and the shell (J8)" });
  } catch {
    findings.push(unreadable(file, "not valid JSON"));
  }
}

function defaultManagedSettings(env: Readonly<Record<string, string | undefined>>): string {
  if (process.platform === "win32") return join(env["ProgramData"] ?? env["PROGRAMDATA"] ?? "C:/ProgramData", "ClaudeCode", "managed-settings.json");
  if (process.platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  return "/etc/claude-code/managed-settings.json";
}

export function runPreflight(input: PreflightInput): Finding[] {
  const { repoRoot, home, env } = input;
  const findings: Finding[] = [];
  const seen = new Set<string>();
  /** Runs a scan group and tags what it finds with the scope of its source. */
  const group = (scope: "session-writable" | "ambient", run: (out: Finding[]) => void): void => {
    const out: Finding[] = [];
    run(out);
    for (const f of out) findings.push({ ...f, scope });
  };

  // Session-writable: repo files (a session writes the working tree), user-home files, the settings files, and
  // %PROGRAMDATA%Git (measured on this machine: BUILTINUsers may create subdirectories under C:ProgramData, so a
  // standard-user session can create C:ProgramDataGitconfig).
  group("session-writable", (out) => {
    const dirs = gitDirs(repoRoot);
    if (dirs !== undefined) {
      scanGitDir(dirs.commonDir, home, out, seen, KNOWN_PROJECT_CONFIG, 0);
      if (dirs.gitDir !== dirs.commonDir) scanGitConfig(join(dirs.gitDir, "config.worktree"), home, out, seen, 0);
    }
    scanAttributes(join(repoRoot, ".gitattributes"), out);
    scanGithooksDir(join(repoRoot, ".githooks"), out);
    const xdg = env["XDG_CONFIG_HOME"];
    for (const f of [join(home, ".gitconfig"), join(home, ".config", "git", "config"), ...(xdg === undefined || xdg === "" ? [] : [join(xdg, "git", "config")])]) scanGitConfig(f, home, out, seen, 0);
    scanAttributes(join(home, ".config", "git", "attributes"), out);
    if (input.programData !== undefined) scanGitConfig(join(input.programData, "Git", "config"), home, out, seen, 0);
    const rg = env["RIPGREP_CONFIG_PATH"];
    if (rg !== undefined && rg !== "") scanRgConfig(rg, out);
    const kube = (env["KUBECONFIG"] ?? "").split(delimiter).filter((p) => p !== "");
    for (const f of new Set([join(home, ".kube", "config"), ...kube])) scanKubeconfig(f, out);
    scanSettingsFile("project", join(repoRoot, ".claude", "settings.json"), out);
    scanSettingsFile("local", join(repoRoot, ".claude", "settings.local.json"), out);
    scanSettingsFile("user", join(home, ".claude", "settings.json"), out);
  });

  // Ambient: only the machine's administrator or the launching environment can set these; printed, never counted.
  group("ambient", (out) => {
    for (const f of input.systemConfigPaths ?? DEFAULT_SYSTEM_CONFIGS) scanGitConfig(f, home, out, seen, 0);
    for (const key of Object.keys(env).sort()) {
      if (env[key] === undefined || !isLeverKey(key) || isAmbientCommon(key)) continue;
      out.push({ where: "process env", key, detail: "an exec-lever key is set in the process environment; value not shown" });
    }
    scanSettingsFile("managed", input.managedSettingsPath ?? defaultManagedSettings(env), out);
  });
  return findings;
}

export function main(): number {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const findings = runPreflight({ repoRoot, home: homedir(), env: process.env, programData: process.env["ProgramData"] ?? process.env["PROGRAMDATA"] });
  for (const f of findings) {
    const label = f.acknowledged === true ? "NOTE   " : f.scope === "ambient" ? "AMBIENT" : "FINDING";
    console.log(`${label} ${f.key} | ${f.where} | ${f.detail}`);
  }
  const counted = unacknowledged(findings);
  const ambient = findings.filter((f) => f.scope === "ambient").length;
  console.log(`git-rg-lever-preflight: ${counted.length === 0 ? "PASS, no session-writable findings" : `${String(counted.length)} session-writable finding(s); clear them before activation and before git or rg is re-added`}; ${String(ambient)} ambient line(s) printed, not counted`);
  console.log("Not closed by the seal (disclosed):");
  for (const [k, v] of Object.entries(RESIDUALS)) console.log(`  ${k}: ${v}`);
  return exitCodeFor(findings);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
