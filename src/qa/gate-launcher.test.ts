// #308 story D (AP-13): proof tests for hooks/launch-gate.sh, the launcher that sits in front of the PreToolUse gate.
// story-implementer's own tests, written failing first (the shim did not exist when they were first run).
//
// WHAT THE LAUNCHER CLOSES (scope, per the Manager's ruling on #398): AMBIENT or accidental launch faults, the five
// launcher-owned probe rows. "NODE_OPTIONS" in this file always means an ambient value inherited from the parent
// environment, never a "settings env block". A settings env block is a settings write and can remove the hook entry
// outright; that class is closed by settings protection (story F deny rules, story K permissions.deny), not here.
//
// DISCLOSED LIMITS, by name (D5; pinned by D5-header-names-launcher and D2-env-shell-levers-disclosure below):
//   - X-8: a tampered module in the gate's import graph that exits 0 with no deny output is not closed. The launcher
//     sees only an exit status.
//   - An empty (0-byte) launcher exits 0 (caught by the pin); any non-empty truncation exits 2: the whole body is one
//     compound command opened on line 1 (D2-shim-truncation-sweep), and the 0-byte file is caught only by the pinned
//     content hash (D4b-shim-hash-pinned, run in CI by this repo's test suite).
//   - Shell-level levers that act before or outside the shim, which it cannot close: SHELLOPTS=noexec (the shell reads
//     the file and runs nothing), BASH_ENV (read by the runtime's outer bash), MSYS (for example noglob breaks the outer
//     command line), BASH_FUNC_sh%% (a function named sh in the outer bash), CLAUDE_CODE_SHELL_PREFIX (wraps the hook
//     command), CLAUDE_CODE_GIT_BASH_PATH (swaps the outer shell). Whether any of them reaches the runtime's hook spawn
//     is unmeasured (design challenge unrun verification U1, story J).
//   - A PATH that puts a fake node first passes through by design (same class as the interpreter; story F).
//   - If the runtime falls back to PowerShell and sh is not on PATH, the call proceeds. Git Bash is a hard Windows
//     precondition checked by the read-only pre-flight (story G rerun).
//   - A hang is not closed (the runtime timeout, AP-5, story J).
//   - Exit-status truncation: the shell reports a Windows exit code modulo 256, so a child exit of 256 or 512 is seen
//     as 0 (D2-disclosed-limit-256). The gate exits only 0 or 2 (code-traced), so no trigger is known.
//   - The runtime's shell-level behavior is unmeasured live (S9, story J).
// D6 (claim boundary): the only env-block behavior measured is B4 (docs/qa/s308-live-spikes/B4.txt): on Claude Code
// 2.1.267, with project settings loaded, an ordinary env-block variable and a NODE_OPTIONS value both reached a node hook
// process, and the hook saw CLAUDE_PROJECT_DIR, SYSTEMROOT and windir. B4 measured project settings and local settings
// (b4-local); user scope was not run. Nothing else is claimed: not user-level settings, not whether an env block can
// override SYSTEMROOT or PATH, not later versions, not non-Windows. SystemRoot steering (Issue #397): the launcher does not
// forward SYSTEMROOT, SystemRoot, WINDIR or windir to the child; on Windows the Git Bash (MSYS) runtime supplies the
// real value to the native child (D2-systemroot-from-runtime). That relies on MSYS runtime behavior, which the Git Bash
// precondition already accepts; the System32 existence check on the parent value stays as a backstop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SHIM = join(REPO_ROOT, "hooks", "launch-gate.sh");
const SELF = readFileSync(fileURLToPath(import.meta.url), "utf8");
const SH = ["C:/Program Files/Git/usr/bin/sh.exe", "/bin/sh", "/usr/bin/sh"].find((p) => existsSync(p)) ?? "sh";
const BASH_OUTER = "C:/Program Files/Git/bin/bash.exe";

const work = mkdtempSync(join(tmpdir(), "thoth-launcher-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

function stub(name: string, body: string): string {
  const p = join(work, name);
  writeFileSync(p, body, "utf8");
  return p;
}
function launch(target: string | undefined, input = "", env: NodeJS.ProcessEnv = process.env, shimPath = SHIM) {
  const args = target === undefined ? [shimPath] : [shimPath, target];
  const r = spawnSync(SH, args, { input, encoding: "utf8", env, timeout: 30_000, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function envWith(extra: Record<string, string>, drop: string[] = []): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  const dropLower = new Set(drop.map((d) => d.toLowerCase()));
  for (const [k, v] of Object.entries(process.env)) if (!dropLower.has(k.toLowerCase())) out[k] = v;
  return { ...out, ...extra };
}

test("D2-exit-map: every child status other than 0 and 2 maps to 2 with a stderr line; 0 and 2 pass through", () => {
  for (const [code, want] of [[0, 0], [2, 2], [1, 2], [3, 2], [9, 2], [127, 2], [134, 2], [255, 2]] as const) {
    const r = launch(stub(`exit${code}.mjs`, `process.exit(${code});\n`));
    assert.equal(r.status, want, `child exit ${code}: shim status ${String(r.status)}; stderr=${r.stderr}`);
    if (want === 2 && code !== 2) assert.match(r.stderr, new RegExp(`child exit ${code} mapped to 2`), `child exit ${code}: a stderr line names the mapping`);
  }
  const killed = launch(stub("selfkill.mjs", "process.kill(process.pid, 'SIGKILL');\n"));
  assert.equal(killed.status, 2, `a self-killed child maps to 2; stderr=${killed.stderr}`);
  const aborted = launch(stub("abort.mjs", "process.abort();\n"));
  assert.equal(aborted.status, 2, "an aborted child maps to 2");
  const threw = launch(stub("throw.mjs", "throw new Error('boom');\n"));
  assert.equal(threw.status, 2, "an uncaught throw maps to 2");
});

test("D2-exit-2-keeps-stderr-and-stdout: a child exit 2 keeps its stderr reason and stdout untouched", () => {
  const r = launch(stub("two.mjs", "process.stdout.write('out'); process.stderr.write('reason'); process.exit(2);\n"));
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "out");
  assert.match(r.stderr, /reason/);
});

test("D2-stdin-passthrough: stdin bytes reach the child unchanged and the child's stdout and exit 0 come back unchanged", () => {
  const echo = stub("echo.mjs", "process.stdin.pipe(process.stdout);\n");
  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo \u00e9\u4e2d" }, pad: "x".repeat(200_000) });
  const r = launch(echo, payload);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, payload);
});

test("D2-missing-target: no argument, a missing file and a directory each give status 2", () => {
  assert.equal(launch(undefined).status, 2);
  assert.equal(launch(join(work, "no-such-file.mjs")).status, 2);
  const dir = join(work, "adir");
  mkdirSync(dir, { recursive: true });
  assert.equal(launch(dir).status, 2);
});

test("D2-no-node: node absent from PATH gives status 2 (the shell is started by absolute path, only node is missing)", () => {
  const empty = join(work, "empty-path");
  mkdirSync(empty, { recursive: true });
  const r = launch(stub("ok.mjs", "process.exit(0);\n"), "", envWith({ PATH: empty }));
  assert.equal(r.status, 2, `stderr=${r.stderr}`);
});

test("D2-env-scrub: the child sees only the allow-list (PATH, SYSTEMROOT, WINDIR, CLAUDE_PROJECT_DIR) plus the Windows shell's own MSYSTEM; NODE_OPTIONS, NODE_PATH and unrelated variables are gone", () => {
  const keys = stub("keys.mjs", "process.stdout.write(JSON.stringify(Object.keys(process.env)));\n");
  const r = launch(keys, "", envWith({ NODE_OPTIONS: "--max-old-space-size=100", NODE_PATH: join(work, "np"), THOTH_FOO: "1", CLAUDE_PROJECT_DIR: "/p" }));
  assert.equal(r.status, 0, r.stderr);
  const seen = (JSON.parse(r.stdout) as string[]).map((k) => k.toUpperCase());
  const allowed = new Set(["PATH", "SYSTEMROOT", "WINDIR", "CLAUDE_PROJECT_DIR", "MSYSTEM"]);
  const extra = seen.filter((k) => !allowed.has(k));
  assert.deepEqual(extra, [], `unexpected variables reached the child: ${extra.join(", ")}`);
  assert.ok(seen.includes("PATH"));
  assert.ok(seen.includes("CLAUDE_PROJECT_DIR"));
});

test("D2-env-preserved: CLAUDE_PROJECT_DIR and PATH reach the child with the same values", () => {
  const dump = stub("dump.mjs", "const e = process.env; process.stdout.write(JSON.stringify({ p: e.CLAUDE_PROJECT_DIR, path: e.PATH }));\n");
  const projectDir = join(work, "project");
  const r = launch(dump, "", envWith({ CLAUDE_PROJECT_DIR: projectDir }));
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout) as { p: string; path: string };
  assert.equal(got.p, projectDir);
  assert.ok(got.path.length > 0);
});

const norm = (p: string | undefined): string => (p ?? "").toLowerCase().replace(/\\/g, "/");

test("D2-systemroot-from-runtime: on win32 a decoy parent SYSTEMROOT (an existing directory with an empty System32) does not reach the child; the child sees the real Windows directory, and SystemRoot or windir is present for central-source (AC-3j-4). Relies on the Git Bash (MSYS) runtime supplying it", { skip: process.platform !== "win32" }, () => {
  const decoy = join(work, "decoy-root");
  mkdirSync(join(decoy, "System32"), { recursive: true });
  const dump = stub("sr.mjs", "const e = process.env; process.stdout.write(JSON.stringify({ sr: e.SystemRoot ?? e.SYSTEMROOT, wd: e.windir ?? e.WINDIR }));\n");
  const real = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  assert.ok(real !== undefined && norm(real) !== norm(decoy), "the test process has a real SystemRoot");
  const r = launch(dump, "", envWith({ SYSTEMROOT: decoy, SystemRoot: decoy, WINDIR: decoy, windir: decoy }, ["SystemRoot", "SYSTEMROOT", "windir", "WINDIR"]));
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout) as { sr?: string; wd?: string };
  assert.equal(norm(got.sr), norm(real), "the child's SystemRoot is the real value, not the decoy");
  assert.equal(norm(got.wd), norm(real), "the child's windir is the real value, not the decoy");
});

test("D2-systemroot-bad: a SYSTEMROOT that names no Windows directory gives status 2 with the launcher's own stderr line and the child does not run; the same stub runs and writes its marker on the good path (so the marker proves something)", () => {
  const marker = join(work, "systemroot-marker");
  const child = stub("mark.mjs", `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\n`);
  const good = launch(child);
  assert.equal(good.status, 0, `control: the stub runs on the good path; stderr=${good.stderr}`);
  assert.equal(existsSync(marker), true, "control: the marker is written when the child runs");
  rmSync(marker);
  for (const name of ["SYSTEMROOT", "SystemRoot", "WINDIR", "windir"]) {
    const r = launch(child, "", envWith({ [name]: join(work, "no-such-systemroot") }, [name]));
    assert.equal(r.status, 2, `${name}: ${r.stderr}`);
    assert.equal(existsSync(marker), false, `${name}: the child must not have run`);
    // On Windows the sh environment folds the four names to one, so any of the four fixed launcher lines counts there.
    const line = process.platform === "win32" ? /^launcher: (SYSTEMROOT|SystemRoot|WINDIR|windir) does not name a Windows directory$/m : new RegExp(`^launcher: ${name} does not name a Windows directory$`, "m");
    assert.match(r.stderr, line, `${name}: the launcher's own stderr line, got: ${r.stderr}`);
  }
});

test("D2-dash-target: a target whose name begins with a dash is a file, not a node option (node -- \"$target\")", () => {
  stub("-dash-target.mjs", "process.exit(0);\n");
  const r = spawnSync(SH, [SHIM, "-dash-target.mjs"], { cwd: work, encoding: "utf8", env: process.env, windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
});

test("D2-env-absolute-path: the shim calls env by absolute path, with -i, and ends node's options with --, so a PATH-planted env or an option-shaped target cannot change the launch (static pin; mutant M15)", () => {
  const src = readFileSync(SHIM, "utf8");
  assert.ok(src.includes("/usr/bin/env -i "), "must call /usr/bin/env -i by absolute path");
  assert.equal(/(^|[\s;{(])env -i/m.test(src.replace("/usr/bin/env -i", "")), false, "no other bare env -i");
  assert.ok(src.includes('node -- "$target"'), "node options end before the target");
});

test("D2-lf-only: the launcher has no carriage return byte (a CRLF shim breaks sh on Linux; behavior tests on Windows would not notice)", () => {
  assert.ok(existsSync(SHIM), "hooks/launch-gate.sh must exist");
  assert.equal(readFileSync(SHIM).includes(13), false);
});

test("D2-shape: the whole body is one compound command opened on line 1 and closed on the last line (the property the truncation sweep depends on)", () => {
  const lines = readFileSync(SHIM, "utf8").split("\n").filter((l, i, a) => !(i === a.length - 1 && l === ""));
  assert.equal(lines[0], "{", "line 1 must open the compound command, with nothing before it");
  assert.equal(lines[lines.length - 1], "}", "the last line must close it, with nothing after it");
});

function runCut(content: string, stubPath: string, name: string): Promise<number | null> {
  const f = join(work, name);
  writeFileSync(f, content, "utf8");
  return new Promise((res) => {
    const c = spawn(SH, [f, stubPath], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
    const t = setTimeout(() => c.kill(), 20_000);
    c.on("close", (code) => {
      clearTimeout(t);
      res(code);
    });
  });
}

test("D2-shim-truncation-sweep: for every byte-length cut of the launcher (every cut except the 0-byte file) running it against a child that exits 1 gives status 2; the 0-byte file is caught by D4b, not here", async () => {
  const full = readFileSync(SHIM);
  const failing = stub("one.mjs", "process.exit(1);\n");
  const bad: string[] = [];
  const pool = 12;
  let next = 1;
  const worker = async (): Promise<void> => {
    for (;;) {
      const n = next++;
      if (n > full.length) return;
      const code = await runCut(full.subarray(0, n).toString("latin1"), failing, `cut-${n}.sh`);
      if (code !== 2) bad.push(`${n}:${String(code)}`);
    }
  };
  await Promise.all(Array.from({ length: pool }, worker));
  assert.equal(full.length > 300, true, "the sweep is non-vacuous");
  assert.deepEqual(bad.sort(), [], `cut lengths whose status was not 2 (length:status), of ${full.length} cuts`);
});

test("D2-env-shell-levers-block: (a) the levers the shim itself closes still give status 2 for a child that exits 1", () => {
  const failing = stub("lever-fail.mjs", "process.exit(1);\n");
  const exit0 = join(work, "exit0.env");
  writeFileSync(exit0, "exit 0\n", "utf8");
  const levers: Record<string, string>[] = [
    { SHELLOPTS: "errexit" },
    { SHELLOPTS: "nounset" },
    { SHELLOPTS: "xtrace" },
    { BASHOPTS: "no_such_option_xyz" },
    { BASH_ENV: exit0 },
    { ENV: exit0 },
    { POSIXLY_CORRECT: "1" },
    { "BASH_FUNC_env%%": "() { exit 0; }" },
    { "BASH_FUNC_printf%%": "() { exit 0; }" },
    { "BASH_FUNC_test%%": "() { return 0; }" },
    { "BASH_FUNC_[%%": "() { return 0; }" },
    { "BASH_FUNC_command%%": "() { exit 0; }" },
    { "BASH_FUNC_echo%%": "() { exit 0; }" },
  ];
  const notTwo: string[] = [];
  for (const lever of levers) {
    const r = launch(failing, "", envWith(lever));
    if (r.status !== 2) notTwo.push(`${JSON.stringify(lever)} -> ${String(r.status)}`);
  }
  assert.deepEqual(notTwo, [], "levers that turned a failing child into a non-2 status");
});

test("D2-env-shell-levers-block: ambient NODE_OPTIONS (a bad flag) is scrubbed by the shim: the child runs and exits 0, while the same value kills a bare node with 9", () => {
  const ok = stub("ok0.mjs", "process.exit(0);\n");
  const bad = envWith({ NODE_OPTIONS: "--no-such-flag-d" });
  assert.equal(spawnSync(process.execPath, [ok], { env: bad, windowsHide: true }).status, 9, "control: a bare node dies with 9");
  assert.equal(launch(ok, "", bad).status, 0);
});

test("D2-env-shell-levers-block: through the runtime-shaped outer shell (win32, Git Bash -c 'sh shim stub') an ambient bad NODE_OPTIONS is closed", { skip: process.platform !== "win32" || !existsSync(BASH_OUTER) }, () => {
  const ok = stub("outer-ok.mjs", "process.exit(0);\n");
  const failing = stub("outer-fail.mjs", "process.exit(1);\n");
  const env = envWith({ NODE_OPTIONS: "--no-such-flag-d" });
  const toPosix = (p: string): string => p.replace(/\\/g, "/");
  const run = (target: string) => spawnSync(BASH_OUTER, ["-c", `sh "${toPosix(SHIM)}" "${toPosix(target)}"`], { env, encoding: "utf8", windowsHide: true });
  assert.equal(run(ok).status, 0, "the scrubbed child runs");
  assert.equal(run(failing).status, 2);
});

test("D2-env-shell-levers-disclosure: (b) the levers the shim cannot close are named in this file's header", () => {
  const header = SELF.slice(0, SELF.indexOf("import { test }"));
  for (const name of ["SHELLOPTS=noexec", "BASH_ENV", "MSYS", "BASH_FUNC_sh%%", "CLAUDE_CODE_SHELL_PREFIX", "CLAUDE_CODE_GIT_BASH_PATH", "PATH that puts a fake node first"]) {
    assert.ok(header.includes(name), `header must name ${name}`);
  }
});

test("D2-disclosed-limit-256: a child exit of 256 or 512 is reported by the shell as 0, so the shim returns 0 (a disclosed limit, recorded not hidden; the gate exits only 0 or 2)", { skip: process.platform !== "win32" }, () => {
  assert.equal(launch(stub("e256.mjs", "process.exit(256);\n")).status, 0);
  assert.equal(launch(stub("e512.mjs", "process.exit(512);\n")).status, 0);
});

test("D5-header-names-launcher: the header discloses X-8 and that an empty or truncated launcher exits 0, and names the launcher file", () => {
  const header = SELF.slice(0, SELF.indexOf("import { test }"));
  assert.match(header, /X-8/);
  assert.match(header, /tampered module in the gate's import graph that exits 0/);
  assert.match(header, /empty \(0-byte\) launcher exits 0 \(caught by the pin\); any non-empty truncation exits 2/);
  assert.match(header, /hooks\/launch-gate\.sh/);
});

test("D6-claim-boundary: the header limits env-block claims to B4 (project settings, Claude Code 2.1.267, the two measured keys) and names Issue #397", () => {
  const header = SELF.slice(0, SELF.indexOf("import { test }"));
  assert.match(header, /B4/);
  assert.match(header, /2\.1\.267/);
  assert.match(header, /project settings/);
  assert.match(header, /local settings/);
  assert.match(header, /#397/);
  assert.match(header, /Nothing else is claimed/);
  assert.doesNotMatch(header, /settings env block (closes|blocks|is closed)/i);
});

test("D2-shim-diagnostic-output-is-fixed: the shim contains no printf of the child's output and never uses echo (functions can replace it)", () => {
  const src = readFileSync(SHIM, "utf8");
  assert.doesNotMatch(src, /(^|[\s;{(])echo\s/, "no echo: a BASH_FUNC_echo%% function would replace it");
  assert.match(src, /unset -f /, "the shim unsets imported functions it relies on");
});
