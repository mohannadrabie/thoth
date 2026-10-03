// SUR-10 (REQUIREMENTS.md, "every fail-open path shall be enumerated and each shall be a recorded
// decision"), S7 plan section 7 G9 and section 9. This instrument ENUMERATES the gate hook's
// fail-open paths by running the REAL hook under injected faults, instead of trusting the nine
// paths SUR-10 happens to name (design-challenger round 1, attack 2: a process that dies before the
// hook's own try/catch is not among the nine, and G9 as set equality over the nine names could not
// see it).
//
// Each fault is classified by Claude Code's PreToolUse contract, measured on 2.1.267 (plan S-2 and
// the round-1 spikes):
//   BLOCKS   = exit code 2, or exit 0 with an explicit `permissionDecision: "deny"` JSON on stdout;
//   PROCEEDS = anything else (exit 1, a signal, a timeout, exit 0 with empty stdout): the tool call
//              runs through the normal permission flow, i.e. the gate failed OPEN.
// A PROCEEDS outcome is legitimate only as a RECORDED decision that names the activation
// precondition that closes it (RECORDED_DECISIONS below). The test (gate-fail-open-probe.test.ts)
// requires observed == recorded in both directions.
//
// S7-A (docs/plans/s7a-gate-hook-robustness-phase1-2026-09-26.md): the module-load paths, the discarded
// stdout write and the input-size timeout are now fixed in the hook and the scanner and are probed here as
// BLOCKS. The input-size class is recorded PER SHAPE, because each shape is its own code path: a redirect-dense
// command (Issue #304) and a benign command that ends in a long trailing-whitespace run, newline-dense (Issue #321,
// found by the red-team review after the first probe recorded the whole class closed from one shape).
//
// The five launch faults below were PROCEEDS rows owned by the launcher (Issue #308, AP-13). #308 story D ships the
// launcher (hooks/launch-gate.sh, run as `sh "<launcher>" "<gate>"`) and they are now recorded BLOCKS, a recorded act
// under SE ADR-0005 (see docs/decisions.md). Scope, per the Manager's ruling on #398: ambient and accidental launch
// faults. NODE_OPTIONS means a value inherited from the parent environment; a settings env block is a settings write,
// closed by settings protection (stories F and K), not by the launcher. Each row runs the fault THROUGH the launcher and
// also runs it directly (no launcher) as a control, so the BLOCKS is attributable to the launcher:
//   - an interpreter that is not on PATH, an ambient NODE_OPTIONS with an unknown flag, SYSTEMROOT pointing nowhere
//     (Windows): the process would die before line one of the hook; the launcher scrubs env, validates SYSTEMROOT and
//     maps the status to 2;
//   - a hook script that does not parse (unparseable: corruption, a bad merge, tampering): Node prints a SyntaxError and
//     exits 1 before any hook code runs; the launcher maps the 1 to 2;
//   - memory exhaustion: an allocation failure inside the hook (a heap cap or a memory-limited runner combined with a
//     very large command) aborts the process, exit 134 on Windows. The launcher scrubs env, so the heap cap is injected by
//     a small wrapper script that spawns the hook with --max-old-space-size=40 (argv, not env); the evidence is that
//     wrapper variant plus the stub exit-134 test in gate-launcher.test.ts, not direct env injection.
// What the launcher does not close is disclosed in the header of src/qa/gate-launcher.test.ts: a tampered in-graph module
// that exits 0 (X-8), an empty launcher file (caught by a pinned hash), shell-level levers outside the shim, a hang.
// The destroyed-stdout fault needs an ASYNC spawn (the parent destroys the child's stdout
// pipe before the child starts), so it has its own entry, runAsyncProbe.
//
// Still not probed, recorded with their AP: the hook timeout itself (a runtime property, AP-5) and the lock
// timeout (no lock exists in this hook).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRedirectShape } from "./redirect-shapes.ts";
import { TRAILING_WHITESPACE_SHAPE_NAMES, buildTrailingWhitespaceShape } from "./trailing-whitespace-shapes.ts";

export type FaultOutcome = "BLOCKS" | "PROCEEDS";

export interface FaultResult {
  id: string;
  outcome: FaultOutcome;
  detail: string;
}

export interface RecordedDecision {
  id: string;
  /** What the probe must observe. */
  expect: FaultOutcome;
  /** Extra outcomes accepted for a fault whose result depends on the runtime version; `expect` stays the primary decision. */
  alsoAccepts?: readonly FaultOutcome[];
  /** False when the path is recorded but not probed here. */
  probed: boolean;
  /** Set when the fault only exists on one platform (the probe skips it elsewhere). */
  platform?: NodeJS.Platform;
  /** The activation precondition that closes a PROCEEDS path (required for PROCEEDS rows). */
  ap?: string;
  note: string;
}

/** True when the observed outcome is the row's recorded decision or one of its extra accepted outcomes. */
export function outcomeAccepted(row: { expect: FaultOutcome; alsoAccepts?: readonly FaultOutcome[] }, observed: FaultOutcome): boolean {
  return observed === row.expect || (row.alsoAccepts ?? []).includes(observed);
}

export const RECORDED_DECISIONS: readonly RecordedDecision[] = [
  { id: "node-without-ts-type-stripping", expect: "BLOCKS", probed: true, note: "old or unflagged Node: the project modules fail to load inside the hook's try/catch, exit 2 (Issue #303, fixed in the hook)" },
  { id: "import-target-missing", expect: "BLOCKS", probed: true, note: "a project module is missing or renamed: the load fails inside the hook's try/catch, exit 2 (Issue #303, fixed in the hook)" },
  { id: "interpreter-not-on-path", expect: "BLOCKS", probed: true, note: "closed by the launcher (hooks/launch-gate.sh, #308 story D, AP-13): node cannot be found, the launcher's env -i child exits 127 and the launcher maps it to 2 (the shell that runs the launcher is started by absolute path in this probe; disclosed: if the runtime's own shell cannot find sh the call still proceeds, Git Bash is a Windows precondition checked by the pre-flight)" },
  { id: "node-options-bad-flag", expect: "BLOCKS", probed: true, note: "closed by the launcher (hooks/launch-gate.sh, #308 story D, AP-13) for an AMBIENT NODE_OPTIONS (inherited from the parent environment) with an unknown flag, which kills a bare Node with exit 9 before any hook code runs: the launcher scrubs the child env to an allow-list, so the gate runs and denies. A settings env block is a settings write, closed by settings protection (stories F and K), not by the launcher" },
  { id: "systemroot-nonexistent", expect: "BLOCKS", probed: true, platform: "win32", note: "closed by the launcher (hooks/launch-gate.sh, #308 story D, AP-13): SYSTEMROOT pointing at a nonexistent directory aborts a bare Node 24 at start-up on Windows (exit 134, Issue #320) while Node 22.18 starts and the hook denies; the launcher refuses (exit 2) any SYSTEMROOT, SystemRoot, WINDIR or windir whose System32 directory does not exist, so the outcome is BLOCKS on every Node version. Disclosed: it checks that the directory exists, not which directory it is (a populated decoy is unmeasured, Issue #397)" },
  { id: "memory-exhaustion", expect: "BLOCKS", probed: true, note: "closed by the launcher (hooks/launch-gate.sh, #308 story D, AP-13) as far as the exit status goes: an allocation failure inside the hook aborts the process (V8 heap limit, observed exit 134 on Windows with --max-old-space-size=40 and a 2 MB redirect-dense command; the same cap decides a small command normally) and the launcher maps the 134 to 2. Evidence is a wrapper variant that applies the cap by argv (the launcher scrubs env) plus the stub exit-134 test, not direct env injection" },
  { id: "hook-script-unparseable", expect: "BLOCKS", probed: true, note: "closed by the launcher (hooks/launch-gate.sh, #308 story D, AP-13): a hook script that does not parse (corruption, a bad merge, tampering) makes Node print a SyntaxError and exit 1 before any hook code runs; the launcher maps the 1 to 2. Disclosed: a launcher that is itself empty exits 0 (caught by the pinned hash, not at runtime), and a tampered module in the gate's import graph that exits 0 is not closed (X-8)" },
  { id: "stdout-closed-before-write", expect: "BLOCKS", probed: true, platform: "win32", note: "a destroyed or closed stdout: the write callback error or the stdout error event exits 2 instead of dropping a decided deny (red-team attack 3). Asserted in-process only: the parent destroys the child's stdout pipe before the child starts (reproduced on Windows, 5 of 5 runs exited 0 before the fix; Linux unmeasured, so the row is probed on Windows only, and the injected-write-failure tests in hooks/pretooluse-kernel-gate-launch.test.ts cover the code path on every platform). Reach in a real Claude Code session stays UNPROVEN (LOW)" },
  { id: "empty-stdin", expect: "BLOCKS", probed: true, note: "exit 2 with stderr" },
  { id: "invalid-json-stdin", expect: "BLOCKS", probed: true, note: "exit 2 with stderr" },
  { id: "numeric-tool-name", expect: "BLOCKS", probed: true, note: "malformed input: deny JSON" },
  { id: "unroutable-tool-name", expect: "BLOCKS", probed: true, note: "pre-kernel refusal: deny JSON" },
  { id: "unclassified-mcp-tool", expect: "BLOCKS", probed: true, note: "POL-05 deny" },
  { id: "corrupt-project-policy", expect: "BLOCKS", probed: true, note: "load failure: deny JSON (layer and kind only)" },
  { id: "input-size-timeout", expect: "BLOCKS", probed: true, note: "shape: a padded 128 KB redirect-dense command. S4's redirect scan is linear (Issue #304, fixed), so the hook decides in milliseconds and denies (many write targets) instead of outrunning the timeout. Other input shapes have their own rows" },
  { id: "input-size-timeout-trailing-whitespace", expect: "BLOCKS", probed: true, note: "shape: a benign command followed by 128 KB of trailing whitespace (newline-dense, CRLF, mixed). The separator scan was quadratic in a newline-dense run (Issue #321: 16 KB took 2294 ms and 64 KB never returned inside 30 s through the real hook, found by the red-team review); it is linear now, so the hook decides in milliseconds instead of outrunning the timeout. The probe runs all three shapes and the row is BLOCKS only if every one is" },
  { id: "hook-timeout-runtime-property", expect: "PROCEEDS", probed: false, ap: "AP-5", note: "a timed-out PreToolUse hook does not block: runtime property, declared timeout set at activation" },
  { id: "lock-timeout", expect: "BLOCKS", probed: false, note: "not applicable: no lock exists in this hook or the loader (the audit-log lock is S8)" },
];

/** Claude Code's contract: exit 2 blocks; exit 0 with a deny JSON blocks; everything else proceeds. */
export function classifyOutcome(status: number | null, stdout: string): FaultOutcome {
  if (status === 2) return "BLOCKS";
  if (status === 0) {
    try {
      const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecision?: unknown } };
      if (parsed.hookSpecificOutput?.permissionDecision === "deny") return "BLOCKS";
    } catch {
      return "PROCEEDS";
    }
  }
  return "PROCEEDS";
}

function copyTree(repoRoot: string, dest: string): void {
  mkdirSync(join(dest, "hooks"), { recursive: true });
  copyFileSync(join(repoRoot, "hooks", "pretooluse-kernel-gate.mjs"), join(dest, "hooks", "pretooluse-kernel-gate.mjs"));
  cpSync(join(repoRoot, "src"), join(dest, "src"), { recursive: true, filter: (s) => !s.endsWith(".test.ts") });
  copyFileSync(join(repoRoot, "package.json"), join(dest, "package.json"));
  mkdirSync(join(dest, "docs", "qa"), { recursive: true });
  copyFileSync(join(repoRoot, "docs", "qa", "tool-inventory.json"), join(dest, "docs", "qa", "tool-inventory.json"));
  copyFileSync(join(repoRoot, "docs", "qa", "s5-central-classification.json"), join(dest, "docs", "qa", "s5-central-classification.json"));
  mkdirSync(join(dest, ".thoth"), { recursive: true });
  copyFileSync(join(repoRoot, ".thoth", "policy.json"), join(dest, ".thoth", "policy.json"));
}

const BASH_PAYLOAD = JSON.stringify({ session_id: "probe", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "kubectl get pod/x --context=c" } });
function payload(toolName: unknown, toolInput: unknown = {}): string {
  return JSON.stringify({ session_id: "probe", hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput });
}

interface Spawned {
  status: number | null;
  stdout: string;
  stderr: string;
}
function run(command: string, args: string[], input: string, cwd: string, shell: boolean, env?: NodeJS.ProcessEnv): Spawned {
  const r = spawnSync(command, args, { input, encoding: "utf8", cwd, shell, timeout: 30_000, windowsHide: true, ...(env === undefined ? {} : { env }) });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A copy of the current environment with `overrides` applied; keys matching `removeCase` (case-insensitively, Windows
 * environment names are case-insensitive) are dropped first so an override is not duplicated under another casing. */
function envWith(overrides: Record<string, string>, removeCase: string[] = []): NodeJS.ProcessEnv {
  const drop = new Set(removeCase.map((k) => k.toLowerCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!drop.has(k.toLowerCase())) env[k] = v;
  return { ...env, ...overrides };
}

/** Runs every probed fault against the real hook (copied into throwaway trees). */
export function runProbe(repoRoot: string): FaultResult[] {
  const root = mkdtempSync(join(tmpdir(), "thoth-s7-probe-"));
  try {
    const good = join(root, "good");
    copyTree(repoRoot, good);
    const hook = join(good, "hooks", "pretooluse-kernel-gate.mjs");
    const results: FaultResult[] = [];
    const record = (id: string, r: Spawned): void => {
      results.push({ id, outcome: classifyOutcome(r.status, r.stdout), detail: `exit=${String(r.status)} stdout=${JSON.stringify(r.stdout.slice(0, 120))} stderr=${JSON.stringify(r.stderr.slice(0, 120))}` });
    };

    record("node-without-ts-type-stripping", run(process.execPath, ["--no-experimental-strip-types", hook], BASH_PAYLOAD, good, false));

    const bare = join(root, "bare", "hooks");
    mkdirSync(bare, { recursive: true });
    copyFileSync(join(repoRoot, "hooks", "pretooluse-kernel-gate.mjs"), join(bare, "pretooluse-kernel-gate.mjs"));
    record("import-target-missing", run(process.execPath, [join(bare, "pretooluse-kernel-gate.mjs")], BASH_PAYLOAD, join(root, "bare"), false));

    // The five launcher-owned faults (AP-13, #308 story D): each runs through hooks/launch-gate.sh and, as a control, directly.
    const sh = ["C:/Program Files/Git/usr/bin/sh.exe", "/bin/sh", "/usr/bin/sh"].find((p) => existsSync(p)) ?? "sh";
    const launcher = join(repoRoot, "hooks", "launch-gate.sh");
    const viaLauncher = (target: string, input: string, env?: NodeJS.ProcessEnv): Spawned => run(sh, [launcher, target], input, good, false, env);
    const launched = (id: string, l: Spawned, d: Spawned, extra = ""): void => {
      results.push({
        id,
        outcome: classifyOutcome(l.status, l.stdout),
        detail: `exit=${String(l.status)} stdout=${JSON.stringify(l.stdout.slice(0, 80))} stderr=${JSON.stringify(l.stderr.slice(0, 80))} direct=${classifyOutcome(d.status, d.stdout)} (exit=${String(d.status)})${extra}`,
      });
    };
    const denied = payload("mcp__nosuchserver__x");
    const noNodeDir = join(root, "no-node-on-path");
    mkdirSync(noNodeDir, { recursive: true });
    const noNode = envWith({ PATH: noNodeDir });
    launched("interpreter-not-on-path", viaLauncher(hook, denied, noNode), run("node", [hook], denied, good, false, noNode));
    const badFlag = envWith({ NODE_OPTIONS: "--no-such-flag-s7" });
    launched("node-options-bad-flag", viaLauncher(hook, denied, badFlag), run(process.execPath, [hook], denied, good, false, badFlag));
    if (process.platform === "win32") {
      const badRoot = envWith({ SYSTEMROOT: join(root, "no-such-systemroot") }, ["SYSTEMROOT"]);
      launched("systemroot-nonexistent", viaLauncher(hook, denied, badRoot), run(process.execPath, [hook], denied, good, false, badRoot));
    }
    record("empty-stdin", run(process.execPath, [hook], "", good, false));
    record("invalid-json-stdin", run(process.execPath, [hook], "{ not json at all", good, false));
    record("numeric-tool-name", run(process.execPath, [hook], payload(12345), good, false));
    record("unroutable-tool-name", run(process.execPath, [hook], payload("Write", { file_path: "a", content: "b" }), good, false));
    record("unclassified-mcp-tool", run(process.execPath, [hook], payload("mcp__nosuchserver__x"), good, false));

    // Input size (Issue #304): a padded 128 KB redirect-dense command. The gate denies it (it assembles thousands
    // of write targets), so a decided deny is BLOCKS and a timeout or crash is PROCEEDS.
    record("input-size-timeout", run(process.execPath, [hook], payload("Bash", { command: buildRedirectShape("glued", 128 * 1024) }), good, false));

    // Input size, trailing whitespace (Issue #321): a benign command then 128 KB of newline-dense, CRLF and mixed
    // whitespace. One row, BLOCKS only when every shape ends in a decided deny or exit 2.
    const trailing = TRAILING_WHITESPACE_SHAPE_NAMES.map((shape) => ({ shape, r: run(process.execPath, [hook], payload("Bash", { command: buildTrailingWhitespaceShape(shape, 128 * 1024) }), good, false) }));
    results.push({
      id: "input-size-timeout-trailing-whitespace",
      outcome: trailing.every(({ r }) => classifyOutcome(r.status, r.stdout) === "BLOCKS") ? "BLOCKS" : "PROCEEDS",
      detail: trailing.map(({ shape, r }) => `${shape}: exit=${String(r.status)} stdout=${r.stdout.length} bytes`).join("; "),
    });

    // Memory exhaustion (AP-13): the launcher scrubs env, so the 40 MB old-space cap is applied by a wrapper script (argv, not
    // env) that spawns the hook. Control: a payload the gate denies, same cap, through the launcher, must still decide normally,
    // else the abort is the cap alone and not the input. The big run is a 2 MB glued redirect command (exit 134 directly).
    const wrapper = join(good, "hooks", "memory-capped-wrapper.mjs");
    writeFileSync(wrapper, `import { spawnSync } from "node:child_process";\nconst r = spawnSync(process.execPath, ["--max-old-space-size=40", ${JSON.stringify(hook)}], { stdio: "inherit" });\nprocess.exit(r.status ?? 1);\n`, "utf8");
    const bigPayload = payload("Bash", { command: buildRedirectShape("glued", 2 * 1024 * 1024) });
    const capped = ["--max-old-space-size=40", hook];
    const control = viaLauncher(wrapper, denied);
    const controlOk = classifyOutcome(control.status, control.stdout) === "BLOCKS";
    launched("memory-exhaustion", viaLauncher(wrapper, bigPayload), run(process.execPath, capped, bigPayload, good, false), ` control=${controlOk ? "ok" : "FAILED"} (small denied payload, same heap cap, through the launcher: exit=${String(control.status)})`);

    // A hook script that does not parse: one stray closing brace appended to a copy of the hook, in the same tree.
    const brokenHook = join(good, "hooks", "pretooluse-kernel-gate-unparseable.mjs");
    writeFileSync(brokenHook, `${readFileSync(hook, "utf8")}\n}\n`, "utf8");
    launched("hook-script-unparseable", viaLauncher(brokenHook, denied), run(process.execPath, [brokenHook], denied, good, false));

    const corrupt = join(root, "corrupt");
    copyTree(repoRoot, corrupt);
    writeFileSync(join(corrupt, ".thoth", "policy.json"), "{ \"version\": \"v\", \"rules\": [ BROKEN ] }", "utf8");
    record("corrupt-project-policy", run(process.execPath, [join(corrupt, "hooks", "pretooluse-kernel-gate.mjs")], BASH_PAYLOAD, corrupt, false));
    return results;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Spawns the hook with its stdout pipe destroyed by the parent BEFORE the child runs, so the child's write to
 * stdout has no reader. Resolves with the exit status and the child's stderr (stdout is unreadable by design). */
function runWithDestroyedStdout(command: string, args: string[], input: string, cwd: string): Promise<Spawned> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.stdout.destroy();
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.on("error", () => undefined);
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("gate-fail-open-probe: the destroyed-stdout child did not exit within 30 s"));
    }, 30_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolvePromise({ status, stdout: "", stderr });
    });
    child.stdin.end(input);
  });
}

/** The faults that need an async spawn. Only the destroyed-stdout fault today (row stdout-closed-before-write);
 * it is skipped on a platform other than the row's (the fault is reproduced on Windows only, so far). */
export async function runAsyncProbe(repoRoot: string): Promise<FaultResult[]> {
  const row = RECORDED_DECISIONS.find((r) => r.id === "stdout-closed-before-write");
  if (row === undefined) throw new Error("gate-fail-open-probe: the stdout-closed-before-write row is missing");
  if (row.platform !== undefined && row.platform !== process.platform) return [];
  const root = mkdtempSync(join(tmpdir(), "thoth-s7a-probe-"));
  try {
    const good = join(root, "good");
    copyTree(repoRoot, good);
    const hook = join(good, "hooks", "pretooluse-kernel-gate.mjs");
    // A payload the gate DENIES normally, so an exit 0 with nothing readable is unambiguously a dropped deny.
    const r = await runWithDestroyedStdout(process.execPath, [hook], payload("mcp__nosuchserver__x"), good);
    return [{ id: row.id, outcome: classifyOutcome(r.status, r.stdout), detail: `exit=${String(r.status)} stdout="" stderr=${JSON.stringify(r.stderr.slice(0, 120))}` }];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
