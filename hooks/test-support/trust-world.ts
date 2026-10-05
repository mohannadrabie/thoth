// Shared FAKE file system worlds for the #428 binary-trust tests (test-support, not application source). The check takes its
// I/O as a port, so no test plants a real file to exercise a branch.
import type { DirStat, Platform, TrustEnv, TrustPorts } from "../../src/policy/gate/bare-binary-trust.ts";
import { BUILTIN_WRAPPER_NAMES } from "../../src/policy/gate/bare-binary-trust.ts";
import { RESOLVABLE_BINARIES } from "../../src/policy/normalizer/shell.ts";
import { READONLY_COMMAND_NAMES } from "../../src/policy/normalizer/readonly-catalog.ts";
import { WRAPPER_BINARY_NAMES } from "../../src/policy/normalizer/wrapper-catalog.ts";

// --- the closed sets (the instrument behind criterion 4) -------------------------------------------------------------

export const BUILTINS = new Set(BUILTIN_WRAPPER_NAMES);
/** The allowed binary set B: derived from the three exported sets, never typed here. */
export const ALL_BINARIES: readonly string[] = [...new Set([...RESOLVABLE_BINARIES, ...READONLY_COMMAND_NAMES, ...WRAPPER_BINARY_NAMES])];
/** B minus the shell builtins (a builtin is not looked up on PATH). */
export const PATH_BINARIES: readonly string[] = ALL_BINARIES.filter((n) => !BUILTINS.has(n));

// --- a fake world -----------------------------------------------------------------------------------------------------

export interface WorldOptions {
  platform?: Platform;
  path: string | undefined;
  env?: TrustEnv;
  /** dir -> entries, or an error code to throw from readdir. A dir with no key does not exist. */
  dirs: Record<string, readonly string[] | { throws: string }>;
  /** path -> realpath (default: itself when it exists). */
  links?: Record<string, string>;
  /** posix lstat answers by path; default root-owned 0o755. */
  stats?: Record<string, DirStat>;
  home?: string | undefined;
  cwd?: string;
}

export const key = (platform: Platform, p: string): string => (platform === "win32" ? p.replaceAll("/", "\\").toLowerCase() : p);

export function fsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export function world(o: WorldOptions): TrustPorts & { calls: string[] } {
  const platform = o.platform ?? "posix";
  const k = (p: string): string => key(platform, p);
  const dirs = new Map(Object.entries(o.dirs).map(([d, v]) => [k(d), v]));
  const links = new Map(Object.entries(o.links ?? {}).map(([a, b]) => [k(a), b]));
  const stats = new Map(Object.entries(o.stats ?? {}).map(([a, b]) => [k(a), b]));
  const calls: string[] = [];
  const sep = platform === "win32" ? "\\" : "/";
  const exists = (p: string): boolean => {
    if (dirs.has(k(p))) return true;
    const cut = p.lastIndexOf(sep);
    if (cut <= 0) return false;
    const listing = dirs.get(k(p.slice(0, cut)));
    return Array.isArray(listing) && (listing as readonly string[]).some((e) => k(e) === k(p.slice(cut + 1)));
  };
  return {
    calls,
    platform,
    env: o.env ?? { PATH: o.path, SYSTEMROOT: platform === "win32" ? "C:\\WINDOWS" : undefined },
    cwd: () => o.cwd ?? (platform === "win32" ? "C:\\work\\proj" : "/work/proj"),
    homedir: () => ("home" in o ? o.home : platform === "win32" ? "C:\\Users\\u" : "/home/u"),
    readdir(dir) {
      calls.push(`readdir ${dir}`);
      const v = dirs.get(k(dir));
      if (v === undefined) throw fsError("ENOENT");
      if (!Array.isArray(v)) throw fsError((v as { throws: string }).throws);
      return v as readonly string[];
    },
    realpath(p) {
      calls.push(`realpath ${p}`);
      const link = links.get(k(p));
      if (link !== undefined) return link;
      if (!exists(p)) throw fsError("ENOENT");
      return p;
    },
    lstat(p) {
      calls.push(`lstat ${p}`);
      const known = stats.get(k(p));
      if (known !== undefined) return known;
      // a path that is neither a known directory nor a listed entry does not exist (the real lstat says ENOENT)
      if (!exists(p)) throw fsError("ENOENT");
      return { uid: 0, mode: 0o40755 };
    },
  };
}

// A realistic Windows world: this machine's shape (Git usr/bin and Docker resources/bin are the trusted homes; the user
// directories are writable; C:\Users\u\bin does not exist but is creatable).
export const GIT_BIN = "C:\\Program Files\\Git\\usr\\bin";
export const DOCKER_BIN = "C:\\Program Files\\Docker\\Docker\\resources\\bin";
export const USER_BIN = "C:\\Users\\u\\bin";
export const USER_LOCAL = "C:\\Users\\u\\.local\\bin";
export const WIN_PATH = [USER_BIN, GIT_BIN, "C:\\WINDOWS\\system32", DOCKER_BIN, USER_LOCAL].join(";");

export function winWorld(over: Partial<WorldOptions> & { gitBin?: readonly string[]; dockerBin?: readonly string[]; userLocal?: readonly string[] | undefined } = {}) {
  const { gitBin, dockerBin, userLocal, ...rest } = over;
  const gitNames = (gitBin ?? PATH_BINARIES.filter((n) => n !== "kubectl")).map((n) => `${n}.exe`);
  return world({
    platform: "win32",
    path: WIN_PATH,
    ...rest,
    dirs: {
      [GIT_BIN]: gitNames,
      "C:\\WINDOWS\\system32": ["cmd.exe", "notepad.exe"],
      [DOCKER_BIN]: dockerBin ?? ["kubectl.exe", "docker.exe"],
      [USER_LOCAL]: userLocal ?? [],
      "C:\\WINDOWS": [],
      ...(rest.dirs ?? {}),
    },
  });
}

export const POSIX_PATH = "/home/u/bin:/usr/local/bin:/usr/bin:/bin";
export function posixWorld(over: Partial<WorldOptions> = {}) {
  return world({
    path: POSIX_PATH,
    ...over,
    dirs: {
      "/": [],
      "/usr": [],
      "/usr/bin": PATH_BINARIES,
      "/usr/local": [],
      "/usr/local/bin": [],
      "/bin": PATH_BINARIES,
      "/home/u/bin": [],
      ...(over.dirs ?? {}),
    },
    links: { "/bin": "/usr/bin", ...(over.links ?? {}) },
  });
}

