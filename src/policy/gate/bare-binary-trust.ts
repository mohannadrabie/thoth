// Issue #428 (S7, blocks #308 K): a bare allowed binary must not resolve to a planted file.
// Plan: docs/plans/s428-path-planted-binary-plan-2026-10-05.md. Design challenge (verdict go):
// docs/reviews/s428-path-trust-design-challenge-2026-10-05.md.
//
// THE GAP. After F9/F9b the normalizer resolves a command only when its leading binary (and any wrapper) is a bare
// lowercase name from a closed set. A bare name does not say WHICH file the shell runs: PATH does, and a session can
// write `kubectl`, `sh` or `env` into a user-writable PATH directory with a tool the gate does not route. So for every
// bare name the gate lets resolve, this check proves the name resolves to a system-installed file, or the call is denied.
//
// THE CHECK (order-independent shadow scan; fail closed everywhere):
//   1. Take the gate's own PATH plus the directories a login shell adds on top of it (`$HOME/bin` from
//      /etc/profile.d/env.sh in Git Bash, `$HOME/bin` and `$HOME/.local/bin` from a default ~/.profile). Relative, empty
//      and `.` entries mean the current directory.
//   2. A directory is TRUSTED only when its real path is in a hard-coded allowlist (Windows: the Windows folder,
//      System32 and three of its subfolders, and the Program Files trees on the system drive; POSIX: nine root-owned system
//      directories, each also required to be root-owned and not group/world-writable along its whole real path). Every
//      other directory, including a missing one, is untrusted. There is no user-extensible list (that would be policy
//      delivery, a sensitive area, and needs its own story).
//   3. Any file in an UNTRUSTED directory that the shell could resolve the name to is a deny, even when a trusted copy
//      exists and even when it sits earlier on PATH. The gate cannot observe the shell's real PATH order, so the scan does
//      not depend on it. The match is exact on POSIX; on Windows it is case-insensitive and takes `name` plus any `.ext`
//      (so `.exe`, `.cmd`, `.bat`, `.com`, `.ps1` and `.lnk` are all covered without a typed list).
//   4. At least one trusted directory must hold the name, and every such file's real path must stay trusted (a link or a
//      dangling target that leaves the trusted set is a deny).
// A missing untrusted directory has nothing to find and does not deny; an existing one that cannot be listed does. A UNC
// PATH entry is never listed (listing it would authenticate to the host) and denies.
//
// SHELL BUILTINS (eval, exec, source, `.`) are not looked up on PATH, so they need no hit and are not scanned.
//
// RESIDUALS, stated plainly (also recorded in docs/decisions.md):
//   (a) time of check to time of use: a file planted between this scan and the shell's exec, or by a concurrent process,
//       is not caught. The Write-tool plant followed by the bare call IS caught, because the scan runs on the second call.
//   (b) the gate sees its own PATH plus the login-profile additions above. A PATH changed by the call itself
//       (`PATH=~/x kubectl ...`, tracked with #409) never resolves (TRUST-14 pins that); PATH edits a session makes to the
//       user's own rc files (~/.bashrc, ~/.bash_profile) are outside this check.
//   (c) an elevated session can write Program Files; the allowlist states the intended trust root, not proven ACLs.
//   (d) a directory the session can re-point (a junction) between the scan and the exec is residual (a).
//
// PURE: no node:* import (G15). The real file system arrives as a port (src/policy/config/path-trust-check.ts); the check
// only reads: readdir, realpath, lstat, cwd, homedir and the three environment values it names.

export type Platform = "win32" | "posix";

export interface TrustEnv {
  PATH?: string | undefined;
  SYSTEMROOT?: string | undefined;
  windir?: string | undefined;
}
export interface DirStat {
  uid: number;
  mode: number;
}
/** Every member only reads. */
export interface TrustPorts {
  platform: Platform;
  env: TrustEnv;
  cwd(): string;
  homedir(): string | undefined;
  /** Entry names of a directory; throws (with a `code`) when it cannot list. */
  readdir(dir: string): readonly string[];
  realpath(path: string): string;
  /** Owner and mode of a path, not following a final link (POSIX only). */
  lstat(path: string): DirStat;
}

export type TrustDenyKind =
  | "not-bare-name"
  | "path-unset"
  | "no-trust-root"
  | "network-path"
  | "unreadable-dir"
  | "shadow"
  | "no-trusted-hit"
  | "hit-escapes-trust"
  | "fault";
export type TrustResult = { ok: true } | { ok: false; kind: TrustDenyKind; reason: string };

/** Wrapper names that are shell builtins in bash and sh: no PATH lookup happens, so no file can shadow them. */
export const BUILTIN_WRAPPER_NAMES: readonly string[] = ["eval", "exec", "source", "."];

const BARE_NAME = /^[A-Za-z0-9_+][A-Za-z0-9_.+-]*$/;
const MAX_TEXT = 200;
const POSIX_TRUSTED_ROOTS: readonly string[] = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin", "/usr/local/sbin", "/usr/games", "/usr/local/games", "/snap/bin"];

// --- tiny platform-aware path helpers (no node:path in this directory) ----------------------------------------------

const isWin = (p: Platform): boolean => p === "win32";
const sepOf = (p: Platform): string => (isWin(p) ? "\\" : "/");

function bounded(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}[truncated]`;
}

function codeOf(error: unknown): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{1,20}$/.test(code) ? code : "UNKNOWN";
}

/** Folds separators, `.` and `..` and trailing separators. Does not touch the file system. */
function normalizePath(platform: Platform, raw: string): string {
  const win = isWin(platform);
  const s = win ? raw.replaceAll("/", "\\") : raw;
  const sep = sepOf(platform);
  let prefix = "";
  let body = s;
  let rooted = false;
  if (win && /^[A-Za-z]:/.test(s)) {
    prefix = s.slice(0, 2);
    body = s.slice(2);
    rooted = body.startsWith("\\");
  } else if (win && s.startsWith("\\\\")) {
    prefix = "\\\\";
    body = s.slice(2);
    rooted = true;
  } else if (s.startsWith(sep)) {
    rooted = true;
  }
  const parts: string[] = [];
  for (const seg of body.split(sep)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!rooted) parts.push("..");
      continue;
    }
    parts.push(seg);
  }
  const joined = parts.join(sep);
  if (win && prefix.length === 2) return `${prefix}${rooted ? sep : ""}${joined}`;
  if (win && prefix === "\\\\") return `\\\\${joined}`;
  return rooted ? `${sep}${joined}` : joined === "" ? "." : joined;
}

const keyOf = (platform: Platform, p: string): string => (isWin(platform) ? normalizePath(platform, p).toLowerCase() : normalizePath(platform, p));

function joinPath(platform: Platform, dir: string, name: string): string {
  return normalizePath(platform, `${dir}${sepOf(platform)}${name}`);
}

function dirnameOf(platform: Platform, p: string): string {
  const n = normalizePath(platform, p);
  const cut = n.lastIndexOf(sepOf(platform));
  if (cut < 0) return ".";
  if (cut === 0) return sepOf(platform);
  if (isWin(platform) && /^[A-Za-z]:$/.test(n.slice(0, cut))) return `${n.slice(0, cut)}\\`;
  return n.slice(0, cut);
}

function isWithin(platform: Platform, candidateKey: string, rootKey: string): boolean {
  const sep = sepOf(platform);
  const root = rootKey.endsWith(sep) ? rootKey : `${rootKey}${sep}`;
  return candidateKey === rootKey || candidateKey.startsWith(root);
}

/** Whether a directory entry name could be what the shell runs for the bare `name`. */
export function matchesName(entry: string, name: string, platform: Platform): boolean {
  if (!isWin(platform)) return entry === name;
  // Windows drops trailing dots and spaces from a name, ignores case, and the shell adds an extension (.exe .cmd .bat .com
  // .lnk ...). `name` plus any `.ext` covers every extension without a list that could go stale.
  const e = entry.replace(/[. ]+$/, "").toLowerCase();
  const n = name.toLowerCase();
  return e === n || e.startsWith(`${n}.`);
}

// --- trust roots -------------------------------------------------------------------------------------------------------

interface TrustContext {
  platform: Platform;
  /** Windows: directories trusted exactly. POSIX: the system directories (real paths). Keys. */
  exactKeys: ReadonlySet<string>;
  /** Windows: trees trusted with everything under them. Keys. */
  treeKeys: readonly string[];
  ports: TrustPorts;
}

function tryRealpath(ports: TrustPorts, p: string): string | undefined {
  try {
    return ports.realpath(p);
  } catch {
    return undefined;
  }
}

function buildContext(ports: TrustPorts): TrustContext | undefined {
  const platform = ports.platform;
  const exact = new Set<string>();
  const trees: string[] = [];
  const addExact = (p: string): void => {
    exact.add(keyOf(platform, p));
    const real = tryRealpath(ports, p);
    if (real !== undefined) exact.add(keyOf(platform, real));
  };
  if (isWin(platform)) {
    const root = [ports.env.SYSTEMROOT, ports.env.windir].find((v) => typeof v === "string" && /^[A-Za-z]:[\\/]/.test(v));
    if (root === undefined) return undefined;
    const sysRoot = normalizePath(platform, root);
    const drive = sysRoot.slice(0, 2);
    for (const rel of ["", "System32", "System32\\Wbem", "System32\\WindowsPowerShell\\v1.0", "System32\\OpenSSH"]) addExact(rel === "" ? sysRoot : joinPath(platform, sysRoot, rel));
    for (const tree of [`${drive}\\Program Files`, `${drive}\\Program Files (x86)`]) {
      trees.push(keyOf(platform, tree));
      const real = tryRealpath(ports, tree);
      if (real !== undefined) trees.push(keyOf(platform, real));
    }
  } else {
    for (const d of POSIX_TRUSTED_ROOTS) addExact(d);
  }
  return { platform, exactKeys: exact, treeKeys: trees, ports };
}

/** POSIX: root-owned and not group/world-writable on the path and every ancestor up to `/`. */
function posixChainTrusted(ports: TrustPorts, realDir: string): boolean {
  let current = normalizePath("posix", realDir);
  for (;;) {
    const st = ports.lstat(current);
    if (st.uid !== 0 || (st.mode & 0o022) !== 0) return false;
    if (current === "/") return true;
    current = dirnameOf("posix", current);
  }
}

function isTrustedRealDir(ctx: TrustContext, realDir: string): boolean {
  const key = keyOf(ctx.platform, realDir);
  if (isWin(ctx.platform)) return ctx.exactKeys.has(key) || ctx.treeKeys.some((t) => isWithin(ctx.platform, key, t));
  return ctx.exactKeys.has(key) && posixChainTrusted(ctx.ports, realDir);
}

function dirTrusted(ctx: TrustContext, dir: string): boolean {
  const real = tryRealpath(ctx.ports, dir);
  return real !== undefined && isTrustedRealDir(ctx, real);
}

/** POSIX: true only when the directory's real path and every ancestor are root-owned and not group/world-writable. Any
 * failure to establish that is false (the caller then denies). */
function onlyRootCanWrite(ports: TrustPorts, dir: string): boolean {
  try {
    return posixChainTrusted(ports, ports.realpath(dir));
  } catch {
    return false;
  }
}

/** POSIX: lstat dir/name for each name. undefined = every name is absent or unreachable; otherwise the first name that is present
 * (`present`) or whose probe failed some other way (`code`). */
function probeNames(ports: TrustPorts, dir: string, names: readonly string[]): { name: string; present: boolean; code: string } | undefined {
  for (const name of names) {
    try {
      ports.lstat(joinPath("posix", dir, name));
      return { name, present: true, code: "" };
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES" || code === "EPERM") continue;
      return { name, present: false, code };
    }
  }
  return undefined;
}

/** Whether `dir` is a trusted system directory (its real path is allowlisted and, on POSIX, owner and mode check out). */
export function isTrustedDirectory(ports: TrustPorts, dir: string): boolean {
  try {
    const ctx = buildContext(ports);
    return ctx !== undefined && dirTrusted(ctx, dir);
  } catch {
    return false;
  }
}

// --- the directories the shell may search -----------------------------------------------------------------------------

interface EntryProblem {
  kind: "network-path" | "unreadable-dir";
  reason: string;
}
interface ScanDir {
  dir: string;
  source: "PATH" | "login profile";
}

function resolveEntries(ports: TrustPorts, pathValue: string): { dirs: ScanDir[]; problem?: EntryProblem } {
  const platform = ports.platform;
  const win = isWin(platform);
  const seen = new Set<string>();
  const dirs: ScanDir[] = [];
  const add = (dir: string, source: ScanDir["source"]): EntryProblem | undefined => {
    if (win && /^[\\/]{2}/.test(dir)) {
      return { kind: "network-path", reason: `PATH entry ${bounded(dir)} is a network path; the gate never lists one (listing would contact the host); fail-closed.` };
    }
    if (win && !/^[A-Za-z]:[\\/]/.test(dir)) {
      return { kind: "unreadable-dir", reason: `PATH entry ${bounded(dir)} is not an absolute Windows path, so the gate cannot tell where it points; fail-closed.` };
    }
    const k = keyOf(platform, dir);
    if (!seen.has(k)) {
      seen.add(k);
      dirs.push({ dir: normalizePath(platform, dir), source });
    }
    return undefined;
  };
  for (const rawEntry of pathValue.split(win ? ";" : ":")) {
    let entry = rawEntry;
    if (win && entry.length >= 2 && entry.startsWith('"') && entry.endsWith('"')) entry = entry.slice(1, -1);
    // A ".." segment is folded lexically here, but the shell resolves it through the file system, so after a symlink the gate
    // could list a different directory than the shell searches. Fail closed (Issue #445 re-confirm, R2).
    if (entry.split(win ? /[\\/]/ : "/").includes("..")) {
      return { dirs, problem: { kind: "unreadable-dir", reason: `PATH entry ${bounded(entry)} contains a ".." segment, so the directory the shell searches cannot be told from the one the gate lists; fail-closed.` } };
    }
    // An empty entry, `.` and a relative entry all mean the current directory (the shell's reading).
    const absolute = win ? /^([A-Za-z]:[\\/]|[\\/]{2})/.test(entry) : entry.startsWith("/");
    const target = absolute ? entry : joinPath(platform, ports.cwd(), entry);
    const problem = add(target, "PATH");
    if (problem !== undefined) return { dirs, problem };
  }
  // The login-profile additions: Git Bash's /etc/profile.d/env.sh prepends $HOME/bin; a default ~/.profile adds $HOME/bin and
  // $HOME/.local/bin. A missing directory costs one failed readdir and a created one is scanned at the next call.
  const home = ports.homedir();
  if (home === undefined || home === "") throw new Error("home directory unknown");
  for (const rel of ["bin", ".local/bin"]) {
    const problem = add(joinPath(platform, home, rel), "login profile");
    if (problem !== undefined) return { dirs, problem };
  }
  return { dirs };
}

/** Every directory the check looks at, with its trust bit (no listing is read). For tests and for the TRUST-15 derivation. */
export function scannedDirectories(ports: TrustPorts): readonly { dir: string; trusted: boolean }[] {
  const ctx = buildContext(ports);
  const pathValue = ports.env.PATH;
  const out: { dir: string; trusted: boolean }[] = [];
  try {
    const { dirs } = resolveEntries(ports, typeof pathValue === "string" ? pathValue : "");
    for (const d of dirs) out.push({ dir: d.dir, trusted: ctx !== undefined && dirTrusted(ctx, d.dir) });
  } catch {
    // an unknowable home leaves the list short; the check itself denies in that case
  }
  return out;
}

// --- the check ---------------------------------------------------------------------------------------------------------

function deny(kind: TrustDenyKind, reason: string): TrustResult {
  return { ok: false, kind, reason };
}

function check(names: readonly string[], ports: TrustPorts): TrustResult {
  const platform = ports.platform;
  const wanted: string[] = [];
  for (const name of new Set(names)) {
    if (BUILTIN_WRAPPER_NAMES.includes(name)) continue;
    if (!BARE_NAME.test(name)) return deny("not-bare-name", `command name ${bounded(JSON.stringify(name))} is not a bare name, so PATH does not decide what runs; fail-closed.`);
    wanted.push(name);
  }
  if (wanted.length === 0) return { ok: true };

  const pathValue = ports.env.PATH;
  if (typeof pathValue !== "string" || pathValue.trim() === "") return deny("path-unset", "PATH is unset or empty, so the gate cannot tell which file a bare command name runs; fail-closed.");
  const ctx = buildContext(ports);
  if (ctx === undefined) return deny("no-trust-root", "the Windows system root is unknown (SYSTEMROOT and windir are unset), so no directory can be trusted; fail-closed.");

  const resolved = resolveEntries(ports, pathValue);
  if (resolved.problem !== undefined) return deny(resolved.problem.kind, resolved.problem.reason);

  const trusted: ScanDir[] = [];
  const untrusted: ScanDir[] = [];
  for (const d of resolved.dirs) (dirTrusted(ctx, d.dir) ? trusted : untrusted).push(d);

  // Phase 1: the shadow scan over every untrusted directory (order-independent on purpose).
  for (const d of untrusted) {
    let listing: readonly string[];
    try {
      listing = ports.readdir(d.dir);
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOENT" || code === "ENOTDIR") continue; // nothing there to find
      // Issue #445: on POSIX, a directory the gate cannot list (EACCES/EPERM) but whose whole real path is root-owned with no
      // group/world write cannot be planted into by the session, so there is nothing to find. Skip it. Anything else denies.
      if (!isWin(platform) && (code === "EACCES" || code === "EPERM") && onlyRootCanWrite(ports, d.dir)) {
        // ...but an unlistable directory can still be SEARCHABLE (mode 0711), and bash then runs dir/name. Probe each wanted name:
        // not there, or unreachable for the shell too (ENOENT, ENOTDIR, EACCES, EPERM), is nothing to find; present or any other error denies.
        const probed = probeNames(ports, d.dir, wanted);
        if (probed === undefined) continue;
        if (probed.present) return deny("shadow", `bare binary "${probed.name}" exists in an untrusted PATH directory (${bounded(d.dir)}) that cannot be listed but can be searched, where a session could have planted it; fail-closed.`);
        return deny("unreadable-dir", `PATH directory ${bounded(d.dir)} (${d.source}) cannot be listed (${code}) and the gate cannot tell whether "${probed.name}" is there (${probed.code}); fail-closed.`);
      }
      return deny("unreadable-dir", `PATH directory ${bounded(d.dir)} (${d.source}) cannot be listed (${code}), so the gate cannot rule out a planted "${wanted[0] ?? ""}"; fail-closed.`);
    }
    for (const name of wanted) {
      if (listing.some((e) => matchesName(e, name, platform))) {
        return deny(
          "shadow",
          `bare binary "${name}" also exists in an untrusted PATH directory (${bounded(d.dir)}), where a session could have planted it; the gate cannot tell which copy the shell runs. Remove it from that directory or take the directory off PATH.`,
        );
      }
    }
  }

  // Phase 2: every name needs a trusted hit, and every trusted hit's real path must stay trusted.
  const listings = new Map<string, readonly string[] | undefined>();
  const listTrusted = (dir: string): readonly string[] | undefined => {
    if (!listings.has(dir)) {
      try {
        listings.set(dir, ports.readdir(dir));
      } catch {
        listings.set(dir, undefined);
      }
    }
    return listings.get(dir);
  };
  for (const name of wanted) {
    let hits = 0;
    for (const d of trusted) {
      const listing = listTrusted(d.dir);
      if (listing === undefined) continue;
      for (const entry of listing) {
        if (!matchesName(entry, name, platform)) continue;
        hits += 1;
        const full = joinPath(platform, d.dir, entry);
        const real = tryRealpath(ports, full);
        if (real === undefined || !isTrustedRealDir(ctx, dirnameOf(platform, real))) {
          return deny("hit-escapes-trust", `bare binary "${name}" at ${bounded(full)} resolves outside the trusted system directories (a link, or a target that no longer exists); fail-closed.`);
        }
      }
    }
    if (hits === 0) {
      return deny(
        "no-trusted-hit",
        `bare binary "${name}" was not found in any trusted system directory on PATH (Windows: the Windows folder and Program Files; POSIX: root-owned system directories). A per-user or Homebrew install is not trusted: install it in a system directory.`,
      );
    }
  }
  return { ok: true };
}

/** The gate's binary-trust check: `{ok:true}` or a deny with a reason naming the name and the directory. A fault inside the
 * check is a deny and never an allow; the raw fault text stays out of the reason. */
export function checkBareBinaries(names: readonly string[], ports: TrustPorts): TrustResult {
  try {
    return check(names, ports);
  } catch {
    return deny("fault", "the binary-trust check could not complete (an internal fault); fail-closed. Retry; if it fails again a human must repair the gate.");
  }
}
