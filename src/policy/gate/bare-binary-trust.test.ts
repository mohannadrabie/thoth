// Issue #428 (S7, blocks #308 K): a bare allowed binary must not resolve to a planted file. Unit tests for the pure trust
// check, written failing first by story-implementer. Plan: docs/plans/s428-path-planted-binary-plan-2026-10-05.md. Design
// challenge: docs/reviews/s428-path-trust-design-challenge-2026-10-05.md (verdict go; adds TRUST-2c, TRUST-13b, TRUST-15, TRUST-16).
//
// Every test runs against a FAKE file system world (no real planting): the module takes its I/O as a port.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_WRAPPER_NAMES, checkBareBinaries, isTrustedDirectory, matchesName, scannedDirectories, type Platform, type TrustPorts } from "./bare-binary-trust.ts";
import { RESOLVABLE_BINARIES, invokedBareBinaries } from "../normalizer/shell.ts";
import { READONLY_COMMAND_NAMES } from "../normalizer/readonly-catalog.ts";
import { WRAPPER_BINARY_NAMES } from "../normalizer/wrapper-catalog.ts";
import { ACCEPT_ROWS } from "../fixtures/readonly-corpus.ts";
import {
  ALL_BINARIES,
  DOCKER_BIN,
  GIT_BIN,
  POSIX_PATH,
  PATH_BINARIES,
  USER_BIN,
  USER_LOCAL,
  WIN_PATH,
  fsError,
  posixWorld,
  winWorld,
  world,
} from "../../../hooks/test-support/trust-world.ts";

function denied(result: ReturnType<typeof checkBareBinaries>): { kind: string; reason: string } {
  assert.equal(result.ok, false, "expected a deny");
  if (result.ok) throw new Error("unreachable");
  return result;
}

// --- TRUST-1 ----------------------------------------------------------------------------------------------------------

test("TRUST-1-trusted-system-hit-no-shadow-allows: every PATH binary resolves to a trusted copy and no untrusted directory holds it (Windows and POSIX worlds)", () => {
  assert.deepEqual(checkBareBinaries(["kubectl"], winWorld()), { ok: true });
  assert.deepEqual(checkBareBinaries(["sh", "kubectl"], winWorld()), { ok: true });
  assert.deepEqual(checkBareBinaries(["ls"], posixWorld()), { ok: true });
  assert.deepEqual(checkBareBinaries([], winWorld()), { ok: true });
});

test("TRUST-1b-builtin-wrappers-need-no-path-hit: eval, exec, source and . are shell builtins, so no PATH lookup is required or scanned", () => {
  assert.ok(BUILTIN_WRAPPER_NAMES.length > 0);
  for (const name of BUILTIN_WRAPPER_NAMES) assert.ok(WRAPPER_BINARY_NAMES.includes(name), `${name} must be a wrapper-catalog name`);
  const w = winWorld({ gitBin: ["sh"], dockerBin: [] });
  assert.deepEqual(checkBareBinaries(["eval", "exec", "source", "."], w), { ok: true });
  assert.equal(w.calls.length, 0, "builtins cause no I/O");
});

// --- TRUST-2 ----------------------------------------------------------------------------------------------------------

test("TRUST-2-shadow-in-untrusted-dir-denies-even-if-trusted-copy-earlier: an earlier trusted copy does not excuse a planted one", () => {
  const w = winWorld({ userLocal: ["kubectl.exe"] });
  const d = denied(checkBareBinaries(["kubectl"], w));
  assert.equal(d.kind, "shadow");
  assert.ok(d.reason.includes("kubectl") && d.reason.includes(USER_LOCAL), d.reason);
  const p = posixWorld({ dirs: { "/home/u/bin": ["ls"] } });
  const dp = denied(checkBareBinaries(["ls"], p));
  assert.equal(dp.kind, "shadow");
  assert.ok(dp.reason.includes("/home/u/bin"), dp.reason);
});

test("TRUST-2b-windows-case-and-extension-variants: the Windows match is case-insensitive and tolerates any extension; POSIX is exact", () => {
  for (const planted of ["KUBECTL.EXE", "kubectl.cmd", "Kubectl.Bat", "kubectl.com", "kubectl.ps1", "kubectl", "KuBeCtL.exe", "kubectl.", "kubectl.exe.exe"]) {
    const d = denied(checkBareBinaries(["kubectl"], winWorld({ userLocal: [planted] })));
    assert.equal(d.kind, "shadow", planted);
  }
  for (const innocent of ["kubectl2.exe", "mykubectl.exe", "kube.exe", "kubectlx"]) {
    assert.deepEqual(checkBareBinaries(["kubectl"], winWorld({ userLocal: [innocent] })), { ok: true }, innocent);
  }
  assert.equal(matchesName("KUBECTL.EXE", "kubectl", "win32"), true);
  assert.equal(matchesName("KUBECTL.EXE", "kubectl", "posix"), false, "POSIX file names are case-sensitive");
  assert.equal(matchesName("kubectl.exe", "kubectl", "posix"), false, "POSIX does not add extensions");
  assert.equal(matchesName("kubectl", "kubectl", "posix"), true);
  assert.deepEqual(checkBareBinaries(["ls"], posixWorld({ dirs: { "/home/u/bin": ["LS", "ls.exe", "ls2"] } })), { ok: true });
});

test("TRUST-2c-lnk-shadow-in-untrusted-dir-denies: Git Bash resolves a bare name to name.lnk, so a shortcut plant is a shadow", () => {
  const d = denied(checkBareBinaries(["kubectl"], winWorld({ userLocal: ["kubectl.lnk"] })));
  assert.equal(d.kind, "shadow");
  assert.equal(matchesName("kubectl.lnk", "kubectl", "win32"), true);
  assert.equal(matchesName("KUBECTL.LNK", "kubectl", "win32"), true);
});

// --- TRUST-3 ----------------------------------------------------------------------------------------------------------

test("TRUST-3-first-hit-untrusted-denies: the only copy is in an untrusted directory", () => {
  const w = winWorld({ dockerBin: [], userLocal: ["kubectl.exe"] });
  assert.equal(denied(checkBareBinaries(["kubectl"], w)).kind, "shadow");
});

test("TRUST-3b-no-trusted-hit-denies: nothing on PATH holds the name, so the reason names the install unlock", () => {
  const d = denied(checkBareBinaries(["kubectl"], winWorld({ dockerBin: [] })));
  assert.equal(d.kind, "no-trusted-hit");
  assert.ok(d.reason.includes("kubectl") && /system|trusted/i.test(d.reason), d.reason);
  const p = denied(checkBareBinaries(["kubectl"], posixWorld({ dirs: { "/usr/bin": ["ls"], "/bin": ["ls"] } })));
  assert.equal(p.kind, "no-trusted-hit");
});

test("TRUST-3c-per-user-install-denied-with-reason: a copy under the user profile is not trusted and the reason says so", () => {
  const d = denied(checkBareBinaries(["kubectl"], winWorld({ dockerBin: [], userLocal: [] })));
  assert.match(d.reason, /Homebrew|per-user|user-installed|install/i);
});

// --- TRUST-4 ----------------------------------------------------------------------------------------------------------

test("TRUST-4-every-binary-in-closed-sets-covered: iterates RESOLVABLE_BINARIES, E0's READONLY_COMMAND_NAMES and the wrapper catalog's names (instrument, not prose)", () => {
  // The instrument: the three exported sets are non-empty, E0's six are NOT in RESOLVABLE_BINARIES (the seam the cross-domain
  // review named), and the union is what the loop below walks.
  assert.ok(RESOLVABLE_BINARIES.size >= 1 && READONLY_COMMAND_NAMES.length >= 6 && WRAPPER_BINARY_NAMES.length >= 1);
  assert.ok(READONLY_COMMAND_NAMES.every((n) => !RESOLVABLE_BINARIES.has(n)), "E0's names are a separate export, so both must be imported");
  assert.equal(ALL_BINARIES.length, new Set([...RESOLVABLE_BINARIES, ...READONLY_COMMAND_NAMES, ...WRAPPER_BINARY_NAMES]).size);
  assert.ok(PATH_BINARIES.length > 0 && PATH_BINARIES.length < ALL_BINARIES.length, "the builtin subset is carved out of B, not all of it");
  let covered = 0;
  for (const name of PATH_BINARIES) {
    // criterion 2: a plant, any case or extension, in the untrusted dir
    for (const planted of [`${name}.exe`, `${name.toUpperCase()}.EXE`, `${name}.lnk`, `${name}.cmd`]) {
      const w = winWorld({ gitBin: PATH_BINARIES, userLocal: [planted] });
      assert.equal(denied(checkBareBinaries([name], w)).kind, "shadow", `${name} planted as ${planted}`);
    }
    // criterion 3: no trusted hit at all
    const none = winWorld({ gitBin: [], dockerBin: [] });
    assert.equal(denied(checkBareBinaries([name], none)).kind, "no-trusted-hit", name);
    // criterion 1: clean world allows
    assert.deepEqual(checkBareBinaries([name], winWorld({ gitBin: PATH_BINARIES })), { ok: true }, name);
    // POSIX
    assert.equal(denied(checkBareBinaries([name], posixWorld({ dirs: { "/home/u/bin": [name] } }))).kind, "shadow", `posix ${name}`);
    covered += 1;
  }
  assert.equal(covered, PATH_BINARIES.length);
  console.log(`TRUST-4: ${String(covered)} PATH binaries covered from sets of ${String(RESOLVABLE_BINARIES.size)} + ${String(READONLY_COMMAND_NAMES.length)} + ${String(WRAPPER_BINARY_NAMES.length)}`);
});

test("TRUST-4b-every-resolved-invoked-name-is-in-the-closed-sets: the names the normalizer consumes for every accepted corpus command and the kubectl shapes are all inside B", () => {
  const commands = [
    ...ACCEPT_ROWS.map((r) => r.command),
    "kubectl get pods/x --context=c",
    "env kubectl get pods/x --context=c",
    "sh -c 'kubectl get pods/x --context=c'",
    "bash -c 'env kubectl get pods/x --context=c'",
    "nohup kubectl get pods/x --context=c &",
    "eval kubectl get pods/x --context=c",
    "exec kubectl get pods/x --context=c",
  ];
  const outside: string[] = [];
  let withNames = 0;
  for (const command of commands) {
    const names = invokedBareBinaries(command);
    assert.ok(names !== undefined && names.length > 0, `no names for ${command}`);
    withNames += 1;
    for (const n of names) if (!ALL_BINARIES.includes(n)) outside.push(`${command} -> ${n}`);
  }
  console.log(`TRUST-4b: ${String(withNames)} commands, ${String(outside.length)} names outside B`);
  assert.deepEqual(outside, []);
});

// --- TRUST-6 ----------------------------------------------------------------------------------------------------------

test("TRUST-6a-unreadable-dir: an existing untrusted directory that cannot be listed denies; a missing one does not", () => {
  const d = denied(checkBareBinaries(["kubectl"], winWorld({ userLocal: undefined, dirs: { [USER_LOCAL]: { throws: "EACCES" } } })));
  assert.equal(d.kind, "unreadable-dir");
  assert.ok(d.reason.includes(USER_LOCAL), d.reason);
  assert.deepEqual(checkBareBinaries(["kubectl"], winWorld()), { ok: true }, "C:\\Users\\u\\bin is missing in this world and must not block");
});

test("TRUST-6b-path-unset: PATH unset, empty or blank denies", () => {
  for (const path of [undefined, "", "   "]) {
    assert.equal(denied(checkBareBinaries(["ls"], posixWorld({ path }))).kind, "path-unset", String(path));
  }
});

test("TRUST-6c-empty-entry: an empty PATH entry means the current directory and is scanned as untrusted", () => {
  const w = posixWorld({ path: "/usr/bin::/bin", dirs: { "/work/proj": ["ls"] }, cwd: "/work/proj" });
  const d = denied(checkBareBinaries(["ls"], w));
  assert.equal(d.kind, "shadow");
  assert.ok(d.reason.includes("/work/proj"), d.reason);
});

test("TRUST-6d-dot-and-relative-entry: . and a relative entry are scanned against cwd as untrusted", () => {
  for (const entry of [".", "./bin", "bin", "../x"]) {
    const dir = entry === "." ? "/work/proj" : entry === "./bin" ? "/work/proj/bin" : entry === "bin" ? "/work/proj/bin" : "/work/x";
    const w = posixWorld({ path: `/usr/bin:${entry}`, dirs: { [dir]: ["ls"] }, cwd: "/work/proj" });
    assert.equal(denied(checkBareBinaries(["ls"], w)).kind, "shadow", entry);
  }
});

test("TRUST-6e-readdir-throws: an untrusted directory whose listing throws something other than not-found denies", () => {
  for (const code of ["EACCES", "EIO", "EMFILE", "EPERM"]) {
    // a session-owned directory (the realistic /home/u/bin): the access errors still deny (Issue #445 skips only root-owned ones)
    const w = posixWorld({ dirs: { "/home/u/bin": { throws: code } }, stats: { "/home/u/bin": { uid: 1001, mode: 0o40755 } } });
    assert.equal(denied(checkBareBinaries(["ls"], w)).kind, "unreadable-dir", code);
  }
  const noCode = posixWorld();
  noCode.readdir = () => {
    throw new Error("boom");
  };
  assert.equal(checkBareBinaries(["ls"], noCode).ok, false, "a throw with no code is not a missing directory");
});

test("TRUST-6f-network-path-entry-is-never-listed: a UNC PATH entry denies without a readdir (listing it would authenticate to the host)", () => {
  const w = winWorld({ path: `${WIN_PATH};\\\\evil\\share\\bin`, dirs: { "\\\\evil\\share\\bin": ["kubectl.exe"] } });
  const d = denied(checkBareBinaries(["kubectl"], w));
  assert.equal(d.kind, "network-path");
  assert.ok(!w.calls.some((c) => c.includes("evil")), `no I/O against the UNC entry: ${w.calls.join(" | ")}`);
  const slash = winWorld({ path: `${WIN_PATH};//evil/share/bin` });
  assert.equal(denied(checkBareBinaries(["kubectl"], slash)).kind, "network-path");
});

test("TRUST-6g-not-a-bare-name: a name with a path separator, a quote or whitespace denies (it would not be a PATH lookup)", () => {
  for (const bad of ["./kubectl", "/usr/bin/ls", "..\\x", "a b", "", "ls;rm", "-ls"]) {
    assert.equal(denied(checkBareBinaries([bad], posixWorld())).kind, "not-bare-name", JSON.stringify(bad));
  }
});

test("TRUST-6h-no-trust-root: Windows without SYSTEMROOT and windir has no trusted directory, so everything denies", () => {
  const w = winWorld({ env: { PATH: WIN_PATH } });
  assert.equal(denied(checkBareBinaries(["kubectl"], w)).kind, "no-trust-root");
});

// --- TRUST-7 ----------------------------------------------------------------------------------------------------------

test("TRUST-7-symlink-hit-realpath-outside-trusted-denies: a link in a trusted directory that leaves the trusted set, or dangles, is judged by its target", () => {
  const outAlso = posixWorld({ dirs: { "/usr/bin": ["ls"], "/bin": [] }, links: { "/usr/bin/ls": "/home/u/bin/ls" } });
  assert.equal(denied(checkBareBinaries(["ls"], outAlso)).kind, "hit-escapes-trust");
  const dangling = posixWorld({ dirs: { "/usr/bin": ["ls"], "/bin": [] } });
  const real = dangling.realpath.bind(dangling);
  dangling.realpath = (p: string) => {
    if (p === "/usr/bin/ls") throw fsError("ENOENT");
    return real(p);
  };
  assert.equal(denied(checkBareBinaries(["ls"], dangling)).kind, "hit-escapes-trust");
  // a link to ANOTHER trusted file is fine (sh -> dash)
  const ok = posixWorld({ dirs: { "/usr/bin": ["sh", "dash"], "/bin": [] }, links: { "/usr/bin/sh": "/usr/bin/dash" } });
  assert.deepEqual(checkBareBinaries(["sh"], ok), { ok: true });
  // Windows: a hit that resolves under the user profile
  const win = winWorld({ links: { [`${GIT_BIN}\\ls.exe`]: "C:\\Users\\u\\evil\\ls.exe" } });
  assert.equal(denied(checkBareBinaries(["ls"], win)).kind, "hit-escapes-trust");
});

// --- TRUST-8 ----------------------------------------------------------------------------------------------------------

test("TRUST-8-posix-group-writable-system-dir-demoted: a system directory (or an ancestor) that is not root-owned and non-writable is untrusted", () => {
  const groupWritable = posixWorld({ stats: { "/usr/local/bin": { uid: 0, mode: 0o40775 } }, dirs: { "/usr/local/bin": ["kubectl"] } });
  const d = denied(checkBareBinaries(["kubectl"], groupWritable));
  assert.equal(d.kind, "shadow", "a demoted directory is scanned like any untrusted one");
  assert.ok(d.reason.includes("/usr/local/bin"), d.reason);
  const userOwned = posixWorld({ stats: { "/usr/local": { uid: 501, mode: 0o40755 } }, dirs: { "/usr/local/bin": ["kubectl"] } });
  assert.equal(denied(checkBareBinaries(["kubectl"], userOwned)).kind, "shadow", "an untrusted ANCESTOR demotes the directory");
  const worldWritableRoot = posixWorld({ stats: { "/usr/bin": { uid: 0, mode: 0o40757 } } });
  assert.equal(denied(checkBareBinaries(["ls"], worldWritableRoot)).kind,"shadow", "the demoted /usr/bin holds ls, and an untrusted copy is a shadow");
  assert.equal(isTrustedDirectory(posixWorld(), "/usr/bin"), true);
  assert.equal(isTrustedDirectory(groupWritable, "/usr/local/bin"), false);
  assert.equal(isTrustedDirectory(posixWorld(), "/home/u/bin"), false);
});

// --- TRUST-10 / 11 / 12 -----------------------------------------------------------------------------------------------

test("TRUST-10-only-read-ports-used: the check touches readdir, realpath, lstat, cwd, homedir and the env only", () => {
  const base = winWorld();
  const touched = new Set<string>();
  const spy = new Proxy(base, {
    get(target, prop, receiver) {
      touched.add(String(prop));
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
  assert.deepEqual(checkBareBinaries(["sh", "kubectl"], spy), { ok: true });
  const allowed = new Set(["platform", "env", "cwd", "homedir", "readdir", "realpath", "lstat", "calls"]);
  assert.deepEqual([...touched].filter((p) => !allowed.has(p)), []);
  const write = /^(write|mkdir|unlink|rename|chmod|spawn|exec|fetch|connect|open|append|symlink)/i;
  assert.deepEqual(Object.keys(base).filter((k) => write.test(k)), [], "the port type has no write, spawn or network member");
});

test("TRUST-11-port-throws-denies: a fault inside the check is a deny, never an allow", () => {
  for (const member of ["readdir", "realpath", "lstat", "homedir", "cwd"] as const) {
    const w = posixWorld({ path: `${POSIX_PATH}:.` });
    (w as unknown as Record<string, unknown>)[member] = () => {
      throw new Error(`${member} exploded`);
    };
    const r = checkBareBinaries(["ls"], w);
    assert.equal(r.ok, false, member);
    if (!r.ok) assert.ok(!r.reason.includes("exploded"), `the raw fault text must not reach the reason: ${r.reason}`);
  }
  const bad = winWorld();
  Object.defineProperty(bad, "env", {
    get() {
      throw new Error("env exploded");
    },
  });
  assert.equal(checkBareBinaries(["ls"], bad).ok, false);
});

test("TRUST-12-trusted-set-derived-from-systemroot-only: with only PATH, SYSTEMROOT and windir in the environment (the D launcher's scrub) the trusted set still holds", () => {
  const read = new Set<string>();
  const base = winWorld({ env: { PATH: WIN_PATH, SYSTEMROOT: "C:\\WINDOWS", windir: "C:\\WINDOWS" } });
  const guarded = { ...base, env: new Proxy(base.env, { get: (t, p, r) => (read.add(String(p)), Reflect.get(t, p, r) as unknown) }) } as TrustPorts;
  assert.deepEqual(checkBareBinaries(["sh", "kubectl"], guarded), { ok: true });
  assert.deepEqual([...read].filter((k) => !["PATH", "SYSTEMROOT", "windir"].includes(k)), []);
  // windir alone is enough too
  const windirOnly = winWorld({ env: { PATH: WIN_PATH, windir: "C:\\WINDOWS" } });
  assert.deepEqual(checkBareBinaries(["kubectl"], windirOnly), { ok: true });
  // a different system drive moves the Program Files root with it
  const dDrive = world({
    platform: "win32",
    path: "D:\\Program Files\\Docker\\bin;C:\\Users\\u\\x",
    env: { PATH: "D:\\Program Files\\Docker\\bin;C:\\Users\\u\\x", SYSTEMROOT: "D:\\Windows" },
    dirs: { "D:\\Program Files\\Docker\\bin": ["kubectl.exe"], "D:\\Windows": [], "C:\\Users\\u\\x": [] },
  });
  assert.deepEqual(checkBareBinaries(["kubectl"], dDrive), { ok: true });
});

// --- TRUST-15 (pure part) ---------------------------------------------------------------------------------------------

test("TRUST-15a-login-profile-additions-are-scanned: $HOME/bin (added by /etc/profile.d/env.sh) is scanned even when the gate's PATH lacks it", () => {
  const gateSeesNoUserDirs = winWorld({ path: [GIT_BIN, "C:\\WINDOWS\\system32", DOCKER_BIN].join(";"), dirs: { [USER_BIN]: ["kubectl.exe"] } });
  const d = denied(checkBareBinaries(["kubectl"], gateSeesNoUserDirs));
  assert.equal(d.kind, "shadow");
  assert.ok(d.reason.includes(USER_BIN), d.reason);
  const posix = posixWorld({ path: "/usr/bin:/bin", dirs: { "/home/u/.local/bin": ["ls"] } });
  assert.equal(denied(checkBareBinaries(["ls"], posix)).kind, "shadow", "$HOME/.local/bin is a default ~/.profile addition");
  const noHome = posixWorld({ home: undefined });
  assert.equal(denied(checkBareBinaries(["ls"], noHome)).kind, "fault", "an unknowable home directory cannot be scanned, so it denies");
});

test("TRUST-15b-scanned-directories-reports-trust: scannedDirectories lists every PATH entry plus the profile additions with its trust bit", () => {
  const listed = scannedDirectories(winWorld());
  const byDir = new Map(listed.map((e) => [e.dir.toLowerCase(), e.trusted]));
  assert.equal(byDir.get(GIT_BIN.toLowerCase()), true);
  assert.equal(byDir.get(DOCKER_BIN.toLowerCase()), true);
  assert.equal(byDir.get(USER_LOCAL.toLowerCase()), false);
  assert.equal(byDir.get(USER_BIN.toLowerCase()), false);
});

// --- the real shell, probed (derives the name set; instrument, not a typed list) -------------------------------------------

test("TRUST-2d-real-shell-resolution-covered-by-matchesName: every file name the real bash resolves to a bare command is matched by the scan predicate", (t) => {
  const bash = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" });
  if (bash.error !== undefined || bash.status !== 0) {
    t.skip("no bash on this machine");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "thoth-428-probe-"));
  try {
    const exts = ["", ".exe", ".com", ".bat", ".cmd", ".lnk", ".ps1", ".vbs", ".js", ".sh", ".py", ".dll", ".txt", ".EXE", ".Cmd", "."];
    const platform: Platform = process.platform === "win32" ? "win32" : "posix";
    const resolved: string[] = [];
    let probed = 0;
    for (const ext of exts) {
      const base = `probebin${String(probed)}`;
      const file = join(dir, `${base}${ext}`);
      try {
        writeFileSync(file, "#!/bin/sh\necho hi\n", { mode: 0o755 });
      } catch {
        continue; // a name this file system refuses (for example a trailing dot) cannot be planted either
      }
      probed += 1;
      const r = spawnSync("bash", ["-c", `command -v ${base}`], { encoding: "utf8", env: { ...process.env, PATH: `${dir}${platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}` } });
      if (r.status === 0 && r.stdout.trim() !== "") resolved.push(`${base}${ext}`);
    }
    console.log(`TRUST-2d: probed ${String(probed)} extensions, bash resolved ${String(resolved.length)}: ${resolved.map((f) => f.replace(/^probebin\d+/, "")).join(" ")}`);
    const missed = resolved.filter((file) => {
      const base = /^probebin\d+/.exec(file)?.[0] ?? "";
      return !matchesName(file, base, platform);
    });
    assert.deepEqual(missed, [], "the shell resolved a file the scan would not flag");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Makes lstat of anything UNDER `dir` throw `code` (default ENOENT), except names in `present`. */
function absentUnder<T extends TrustPorts>(w: T, dir: string, code = "ENOENT", present: readonly string[] = []): T {
  const base = w.lstat.bind(w);
  w.lstat = (p: string) => {
    if (p.startsWith(`${dir}/`) && !present.includes(p.slice(dir.length + 1))) throw fsError(code);
    return base(p);
  };
  return w;
}

// --- TRUST-19 (Issue #445) --------------------------------------------------------------------------------------------

test("TRUST-19-unlistable-root-owned-dir-skipped-posix: a POSIX directory the gate cannot list but only root can write is skipped; any other unlistable directory still denies", () => {
  const withDir = (stat: { uid: number; mode: number }, code = "EACCES", platformPath = `${POSIX_PATH}:/opt/pipx_bin`) =>
    absentUnder(posixWorld({ path: platformPath, dirs: { "/opt": [], "/opt/pipx_bin": { throws: code } }, stats: { "/opt/pipx_bin": stat } }), "/opt/pipx_bin");
  // root-owned 0700 (the runner image's /opt/pipx_bin): the session cannot plant there, so skip
  assert.deepEqual(checkBareBinaries(["ls"], withDir({ uid: 0, mode: 0o40700 })), { ok: true });
  assert.deepEqual(checkBareBinaries(["ls"], withDir({ uid: 0, mode: 0o40700 }, "EPERM")), { ok: true });
  // session-owned 0700: the session can plant, so deny
  assert.equal(denied(checkBareBinaries(["ls"], withDir({ uid: 1001, mode: 0o40700 }))).kind, "unreadable-dir");
  // root-owned but group-writable: deny
  assert.equal(denied(checkBareBinaries(["ls"], withDir({ uid: 0, mode: 0o40770 }))).kind, "unreadable-dir");
  // an unlistable directory under a session-owned ancestor: deny
  const badAncestor = posixWorld({ path: `${POSIX_PATH}:/opt/x/pipx_bin`, dirs: { "/opt": [], "/opt/x": [], "/opt/x/pipx_bin": { throws: "EACCES" } }, stats: { "/opt/x": { uid: 1001, mode: 0o40755 }, "/opt/x/pipx_bin": { uid: 0, mode: 0o40700 } } });
  assert.equal(denied(checkBareBinaries(["ls"], badAncestor)).kind, "unreadable-dir");
  // only access errors qualify: EIO on a root-owned directory still denies
  assert.equal(denied(checkBareBinaries(["ls"], withDir({ uid: 0, mode: 0o40700 }, "EIO"))).kind, "unreadable-dir");
  // a failing lstat or realpath denies
  const noLstat = withDir({ uid: 0, mode: 0o40700 });
  const base = noLstat.lstat.bind(noLstat);
  noLstat.lstat = (p: string) => {
    if (p === "/opt/pipx_bin") throw fsError("EACCES");
    return base(p);
  };
  assert.equal(denied(checkBareBinaries(["ls"], noLstat)).kind, "unreadable-dir");
  // Windows keeps the deny on any readdir error
  for (const code of ["EACCES", "EPERM"]) {
    assert.equal(denied(checkBareBinaries(["kubectl"], winWorld({ userLocal: undefined, dirs: { [USER_LOCAL]: { throws: code } } }))).kind, "unreadable-dir", code);
  }
});

test("TRUST-19b-searchable-unlistable-root-dir-probes-names: an unlistable root-owned directory is skipped only when the shell cannot reach the name there either", () => {
  const mk = (mode: number, code: string, present: readonly string[]) =>
    absentUnder(
      posixWorld({ path: `${POSIX_PATH}:/opt/pipx_bin`, dirs: { "/opt": [], "/opt/pipx_bin": { throws: "EACCES" } }, stats: { "/opt/pipx_bin": { uid: 0, mode } } }),
      "/opt/pipx_bin",
      code,
      present,
    );
  // 0711: unlistable but searchable, the name is there: bash would run it, so deny
  assert.equal(denied(checkBareBinaries(["ls"], mk(0o40711, "ENOENT", ["ls"]))).kind, "shadow");
  // 0711 with the name absent: skip
  assert.deepEqual(checkBareBinaries(["ls"], mk(0o40711, "ENOENT", [])), { ok: true });
  // 0700, lstat of dir/name is EACCES (the shell cannot reach it either): skip
  assert.deepEqual(checkBareBinaries(["ls"], mk(0o40700, "EACCES", [])), { ok: true });
  assert.deepEqual(checkBareBinaries(["ls"], mk(0o40700, "EPERM", [])), { ok: true });
  // any other probe error denies
  for (const code of ["EIO", "ELOOP", "EMFILE", "UNKNOWN"]) assert.equal(denied(checkBareBinaries(["ls"], mk(0o40711, code, []))).kind, "unreadable-dir", code);
  // every wanted name is probed, not just the first
  assert.equal(denied(checkBareBinaries(["ls", "sh"], mk(0o40711, "ENOENT", ["sh"]))).kind, "shadow");
});

test("TRUST-19c-only-access-errors-skip: every readdir error other than EACCES and EPERM denies, even on a root-owned directory", () => {
  for (const code of ["EIO", "EMFILE", "ENOMEM", "ELOOP", "ENAMETOOLONG", "UNKNOWN"]) {
    const w = absentUnder(
      posixWorld({ path: `${POSIX_PATH}:/opt/pipx_bin`, dirs: { "/opt": [], "/opt/pipx_bin": { throws: code } }, stats: { "/opt/pipx_bin": { uid: 0, mode: 0o40700 } } }),
      "/opt/pipx_bin",
    );
    assert.equal(denied(checkBareBinaries(["ls"], w)).kind, "unreadable-dir", code);
  }
});

test("TRUST-20-dotdot-path-entry-denies: a PATH entry with a .. segment is folded lexically, so after a symlink the gate could list a different directory than the shell searches; it denies", () => {
  for (const entry of ["/home/u/link/../bin", "/usr/bin/..", "../x", "bin/../bin"]) {
    const d = denied(checkBareBinaries(["ls"], posixWorld({ path: `${POSIX_PATH}:${entry}` })));
    assert.equal(d.kind, "unreadable-dir", entry);
    assert.match(d.reason, /\.\./, entry);
  }
  for (const entry of ["C:\\Users\\u\\link\\..\\bin", "C:/Users/u/../bin"]) {
    assert.equal(denied(checkBareBinaries(["kubectl"], winWorld({ path: `${WIN_PATH};${entry}` }))).kind, "unreadable-dir", entry);
  }
  // a name that merely contains dots is not a .. segment
  assert.deepEqual(checkBareBinaries(["ls"], posixWorld({ path: `${POSIX_PATH}:/home/u/..bin:/home/u/a..b` })), { ok: true });
});
