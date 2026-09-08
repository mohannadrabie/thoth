// AC7: (i) outbound call-shape — the exact args passed to `reg query` (no shell interpolation of
// either the key path or the value name); (ii) inbound parse — the stdout-extraction routine
// against REAL, captured `reg.exe query` output (not a guessed approximation; see
// central-source.ts's own header for the full provenance and the raw capture transcripts this
// file's fixtures below were copied from verbatim).
//
// Fixtures are TypeScript string constants with explicit `\r\n`, matching test-writer's own
// established convention for this exact problem (printer.test.ts's header, INTERPRETATION CHOICE
// 3): `.gitattributes`'s `* text=auto eol=lf` would silently rewrite a committed raw-CRLF file to
// LF at checkout, destroying the very bytes under test — a `\r\n` escape sequence inside a .ts
// source file is immune to that, since git's EOL normalization operates on the FILE's own line
// endings, never on the contents of a string literal.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWindowsRegistryCentralPolicySource,
  extractRegSzValue,
  isNotFoundError,
  resolveSystemRegExePath,
  REGISTRY_CHANNEL_DESCRIPTOR,
  REGISTRY_KEY_PATH,
  REGISTRY_VALUE_NAME,
  type SyncRegQueryRunner,
} from "./central-source.ts";

// Captured verbatim, 2026-09-08, this build session:
//   $ reg.exe query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v ProductName
// exit=0. `cat -A` showed CRLF line endings and a leading + trailing blank line, 4 literal spaces
// between each field.
const REAL_CAPTURED_PRESENT_STDOUT =
  "\r\n" +
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\r\n" +
  "    ProductName    REG_SZ    Windows 10 Home\r\n" +
  "\r\n";

// Captured verbatim, 2026-09-08, this build session, against the REAL literal target (which
// genuinely does not exist on this machine):
//   $ reg.exe query "HKLM\SOFTWARE\Policies\Thoth" /v CentralPolicyJson
// exit=1, stdout empty.
const REAL_CAPTURED_ABSENT_STDERR = "ERROR: The system was unable to find the specified registry key or value.\r\n";

// A synthetic sample matching the SAME real, captured shape above, but for the actual Thoth key
// this reader targets, since the real key does not exist yet on any machine (provisioning it is
// out of this story's scope — see docs/backlog.md). Field spacing/CRLF pattern is copied verbatim
// from the real capture, only the key path / value name / data are substituted.
const SYNTHETIC_PRESENT_STDOUT_FOR_THOTH_KEY =
  "\r\n" +
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Thoth\r\n" +
  '    CentralPolicyJson    REG_SZ    {"version":"1.0.0","rules":[]}\r\n' +
  "\r\n";

// --- AC7(ii): inbound parse, against REAL captured bytes ------------------------------------------

test("AC7(ii): extractRegSzValue parses REAL, captured reg.exe query stdout (not a guessed approximation)", () => {
  const value = extractRegSzValue(REAL_CAPTURED_PRESENT_STDOUT, "ProductName");
  assert.equal(value, "Windows 10 Home");
});

test("AC7(ii): extractRegSzValue parses the Thoth-key-shaped sample (same real captured field spacing/CRLF pattern)", () => {
  const value = extractRegSzValue(SYNTHETIC_PRESENT_STDOUT_FOR_THOTH_KEY, REGISTRY_VALUE_NAME);
  assert.equal(value, '{"version":"1.0.0","rules":[]}');
});

test("AC7(ii): extractRegSzValue returns null when the value's line cannot be found (unexpected shape)", () => {
  assert.equal(extractRegSzValue("some unexpected output\r\n", "CentralPolicyJson"), null);
});

test("AC7(ii): isNotFoundError matches the REAL, captured \"not found\" error text verbatim", () => {
  assert.equal(isNotFoundError(REAL_CAPTURED_ABSENT_STDERR), true);
});

test("AC7(ii): isNotFoundError does NOT match an unrelated error (never silently folds a different failure into \"absent\")", () => {
  assert.equal(isNotFoundError("ERROR: Access is denied.\r\n"), false);
  assert.equal(isNotFoundError("some other subprocess failure"), false);
});

// --- AC7(i): outbound call shape (injected runner, no real subprocess) ----------------------------

// --- Issue #106 [HIGH]: absolute, system-rooted reg.exe path, never a bare/PATH-resolvable name ---

test("resolveSystemRegExePath: resolves an ABSOLUTE path under %SystemRoot%\\System32, never a bare \"reg.exe\"", () => {
  const p = resolveSystemRegExePath({ SystemRoot: "C:\\Windows" });
  assert.equal(p, "C:\\Windows\\System32\\reg.exe");
});

test("resolveSystemRegExePath: falls back to %windir% when %SystemRoot% is absent, and to C:\\Windows when neither is set — never resolves through PATH", () => {
  assert.equal(resolveSystemRegExePath({ windir: "D:\\WINNT" }), "D:\\WINNT\\System32\\reg.exe");
  assert.equal(resolveSystemRegExePath({}), "C:\\Windows\\System32\\reg.exe");
});

test("Issue #106 [HIGH]: createWindowsRegistryCentralPolicySource calls reg query with an ABSOLUTE, system-rooted executable path (never a bare \"reg.exe\" resolvable through PATH), and the exact key path/value name, no shell interpolation of either", () => {
  let capturedCmd: string | undefined;
  let capturedArgs: readonly string[] | undefined;
  const runner: SyncRegQueryRunner = (cmd, args) => {
    capturedCmd = cmd;
    capturedArgs = args;
    return SYNTHETIC_PRESENT_STDOUT_FOR_THOTH_KEY;
  };
  const source = createWindowsRegistryCentralPolicySource(runner, "win32");
  source.read();
  assert.notEqual(capturedCmd, "reg.exe", "must never invoke the bare, PATH-resolvable name");
  assert.ok(capturedCmd && /^[A-Za-z]:\\/.test(capturedCmd), `expected an absolute, drive-rooted path; got: ${capturedCmd}`);
  assert.equal(capturedCmd, resolveSystemRegExePath(), "must match the real resolver's own output for this process's actual environment");
  assert.deepEqual(capturedArgs, ["query", REGISTRY_KEY_PATH, "/v", REGISTRY_VALUE_NAME]);
});

// --- Issue #112 [LOW]: stderr is piped, never inherited by the parent -----------------------------

test("Issue #112 [LOW]: the runner is invoked with stdio explicitly [\"ignore\",\"pipe\",\"pipe\"] — stderr captured, never forwarded to the parent process", () => {
  let capturedStdio: unknown;
  const runner: SyncRegQueryRunner = (_cmd, _args, opts) => {
    capturedStdio = opts.stdio;
    return SYNTHETIC_PRESENT_STDOUT_FOR_THOTH_KEY;
  };
  const source = createWindowsRegistryCentralPolicySource(runner, "win32");
  source.read();
  assert.deepEqual(capturedStdio, ["ignore", "pipe", "pipe"]);
});

test("createWindowsRegistryCentralPolicySource: a successful reg query resolves to status=present with the channel descriptor", () => {
  const runner: SyncRegQueryRunner = () => SYNTHETIC_PRESENT_STDOUT_FOR_THOTH_KEY;
  const source = createWindowsRegistryCentralPolicySource(runner, "win32");
  const result = source.read();
  assert.deepEqual(result, {
    status: "present",
    raw: '{"version":"1.0.0","rules":[]}',
    channel: REGISTRY_CHANNEL_DESCRIPTOR,
  });
});

test("createWindowsRegistryCentralPolicySource: a \"not found\" failure (real captured error text, exit code 1) resolves to status=absent", () => {
  const runner: SyncRegQueryRunner = () => {
    const err = new Error("Command failed") as Error & { stderr: string; status: number };
    err.stderr = REAL_CAPTURED_ABSENT_STDERR;
    err.status = 1;
    throw err;
  };
  const source = createWindowsRegistryCentralPolicySource(runner, "win32");
  assert.deepEqual(source.read(), { status: "absent" });
});

// --- Issue #107 [MED]: exit code required as a NECESSARY (never sufficient alone) precondition ----
// (see central-source.ts's own header note: reg.exe's exit code was MEASURED to be uniformly 1 for
// every failure reason, so it cannot safely be the PRIMARY absent-vs-error signal as originally
// suggested — kept only as defense-in-depth alongside the text match.)

test("Issue #107 [MED]: not-found-shaped stderr text on a NON-1 exit code is NOT classified absent -- an unrecognized shape this file has never seen, re-thrown fail-closed", () => {
  const runner: SyncRegQueryRunner = () => {
    const err = new Error("Command failed") as Error & { stderr: string; status: number };
    err.stderr = REAL_CAPTURED_ABSENT_STDERR;
    err.status = 2; // never actually observed from reg.exe, but must not be trusted blindly
    throw err;
  };
  const source = createWindowsRegistryCentralPolicySource(runner, "win32");
  assert.throws(() => source.read(), /Command failed/);
});

test("Issue #107 [MED]: access-denied (real reg.exe shape -- ALSO exits 1, measured this session) is NEVER classified absent, because its stderr text does not match any known not-found pattern", () => {
  const runner: SyncRegQueryRunner = () => {
    const err = new Error("Command failed") as Error & { stderr: string; status: number };
    err.stderr = "ERROR: Access is denied.\r\n";
    err.status = 1; // reg.exe returns 1 here too -- exit code alone cannot and does not decide this
    throw err;
  };
  const source = createWindowsRegistryCentralPolicySource(runner, "win32");
  assert.throws(() => source.read(), /Command failed/);
});

test("AC5c precursor: any OTHER runner failure (not the \"not found\" shape) is RE-THROWN, never silently treated as absent", () => {
  const runner: SyncRegQueryRunner = () => {
    const err = new Error("simulated timeout") as Error & { stderr: string };
    err.stderr = "";
    throw err;
  };
  const source = createWindowsRegistryCentralPolicySource(runner, "win32");
  assert.throws(() => source.read(), /simulated timeout/);
});

test("createWindowsRegistryCentralPolicySource: an unrecognized stdout shape (value line missing) throws rather than silently returning absent/empty", () => {
  const runner: SyncRegQueryRunner = () => "some totally unexpected output\r\n";
  const source = createWindowsRegistryCentralPolicySource(runner, "win32");
  assert.throws(() => source.read(), /unexpected output shape/);
});

// --- architecture-reviewer findings 2/4: unsupported vs. absent must never collapse ----------------

test('architecture-reviewer finding 2/4: on a non-win32 platform, read() returns status="unsupported" WITHOUT attempting any subprocess call, distinct from "absent"', () => {
  let called = false;
  const runner: SyncRegQueryRunner = () => {
    called = true;
    return "";
  };
  const source = createWindowsRegistryCentralPolicySource(runner, "darwin");
  const result = source.read();
  assert.deepEqual(result, { status: "unsupported" });
  assert.equal(called, false, "no subprocess call should be attempted on an unsupported platform");
});
