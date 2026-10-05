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
  scope?: "session-writable" | "ambient";
}

/** RED-commit stub. */
export const exitCodeFor = (findings: readonly Finding[]): number => (findings.length === 0 ? 0 : 1);

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

/** Findings that count: everything except acknowledged project config. */
export const unacknowledged = (findings: readonly Finding[]): Finding[] => findings.filter((f) => f.acknowledged !== true);

const DEFAULT_SYSTEM_CONFIGS = ["/etc/gitconfig", "C:/Program Files/Git/etc/gitconfig", "C:/Program Files/Git/mingw64/etc/gitconfig"];
const MAX_INCLUDE_DEPTH = 5;

type Read = { ok: true; text: string } | { ok: false; error: string } | undefined;

function tryRead(path: string): Read {
  if (!existsSync(path)) return undefined;
  try {
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const unreadable = (where: string, error: string): Finding => ({ where, key: "unreadable", detail: `exists but cannot be read, so it cannot be shown clean: ${error.slice(0, 120)}` });

// ---- git config -------------------------------------------------------------------------------------------------------

/** Is this git config key one that runs a program, or pulls in another file? */
function executingKey(section: string, sub: string | undefined, key: string, value: string): boolean {
  const v = value.replace(/^"/, "").trim();
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

  const dirs = gitDirs(repoRoot);
  if (dirs !== undefined) {
    scanGitConfig(join(dirs.commonDir, "config"), home, findings, seen, 0, KNOWN_PROJECT_CONFIG);
    scanGitConfig(join(dirs.gitDir, "config.worktree"), home, findings, seen, 0);
    scanHooks(join(dirs.commonDir, "hooks"), findings);
    scanAttributes(join(dirs.commonDir, "info", "attributes"), findings);
  }
  scanAttributes(join(repoRoot, ".gitattributes"), findings);

  const xdg = env["XDG_CONFIG_HOME"];
  for (const f of [join(home, ".gitconfig"), join(home, ".config", "git", "config"), ...(xdg === undefined || xdg === "" ? [] : [join(xdg, "git", "config")])]) scanGitConfig(f, home, findings, seen, 0);
  scanAttributes(join(home, ".config", "git", "attributes"), findings);
  for (const f of input.systemConfigPaths ?? DEFAULT_SYSTEM_CONFIGS) scanGitConfig(f, home, findings, seen, 0);
  if (input.programData !== undefined) scanGitConfig(join(input.programData, "Git", "config"), home, findings, seen, 0);

  for (const key of Object.keys(env).sort()) {
    if (env[key] === undefined || !isLeverKey(key) || isAmbientCommon(key)) continue;
    findings.push({ where: "process env", key, detail: "an exec-lever key is set in the process environment; value not shown" });
  }
  const rg = env["RIPGREP_CONFIG_PATH"];
  if (rg !== undefined && rg !== "") scanRgConfig(rg, findings);

  const kube = (env["KUBECONFIG"] ?? "").split(delimiter).filter((p) => p !== "");
  for (const f of new Set([join(home, ".kube", "config"), ...kube])) scanKubeconfig(f, findings);

  scanSettingsFile("project", join(repoRoot, ".claude", "settings.json"), findings);
  scanSettingsFile("local", join(repoRoot, ".claude", "settings.local.json"), findings);
  scanSettingsFile("user", join(home, ".claude", "settings.json"), findings);
  scanSettingsFile("managed", input.managedSettingsPath ?? defaultManagedSettings(env), findings);
  return findings;
}

export function main(): number {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const findings = runPreflight({ repoRoot, home: homedir(), env: process.env, programData: process.env["ProgramData"] ?? process.env["PROGRAMDATA"] });
  for (const f of findings) console.log(`${f.acknowledged === true ? "NOTE   " : "FINDING"} ${f.key} | ${f.where} | ${f.detail}`);
  const counted = unacknowledged(findings);
  console.log(`git-rg-lever-preflight: ${counted.length === 0 ? "PASS, no findings" : `${String(counted.length)} finding(s); clear them before activation and before git or rg is re-added`}`);
  console.log("Not closed by the seal (disclosed):");
  for (const [k, v] of Object.entries(RESIDUALS)) console.log(`  ${k}: ${v}`);
  return counted.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
