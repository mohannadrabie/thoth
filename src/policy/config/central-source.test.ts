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

// =============================================================================================
// S7 ADDITIONS (story-implementer, 2026-09-26; docs/plans/s7-kernel-gate-classification-phase1-
// 2026-09-26.md section 7 "C" and 8c). STRICTLY ADDITIVE: no test above this line is edited or
// removed (the 16 existing tests, lines 131-167 the answer key for the English text path, stay
// exactly as they were; plan check C10 proves it with `git diff`).
//
// The #107 additive fallback: when call 1 exits with status 1 and its stderr is NOT classified by
// the English patterns, a second call lists the PARENT key; that listing may only DOWNGRADE the
// failure to "absent", and only when it exits 0, is RECOGNISED (positive parse evidence, no
// dependence on any localized text) and lists no Thoth subkey. Every other outcome rethrows the
// ORIGINAL error of call 1. A call-indexed scripted runner is used because each call answers
// differently.
import { classifyParentListing, REGISTRY_PARENT_KEY_PATH } from "./central-source.ts";

type Step = { stdout: string } | { fail: { status: number | null | undefined; stderr: string; message?: string } };
interface Call {
  cmd: string;
  args: readonly string[];
  opts: Parameters<SyncRegQueryRunner>[2];
}
function scripted(steps: Step[]): { runner: SyncRegQueryRunner; calls: Call[]; errors: Error[] } {
  const calls: Call[] = [];
  const errors: Error[] = [];
  const runner: SyncRegQueryRunner = (cmd, args, opts) => {
    const step = steps[calls.length];
    calls.push({ cmd, args, opts });
    if (step === undefined) throw new Error(`scripted runner: unexpected call number ${calls.length}`);
    if ("stdout" in step) return step.stdout;
    const err = new Error(step.fail.message ?? `Command failed (call ${calls.length})`) as Error & { stderr: string; status?: number | null };
    err.stderr = step.fail.stderr;
    if (step.fail.status !== undefined) err.status = step.fail.status;
    errors.push(err);
    throw err;
  };
  return { runner, calls, errors };
}
function readWith(steps: Step[]): { result: () => ReturnType<ReturnType<typeof createWindowsRegistryCentralPolicySource>["read"]>; calls: Call[]; errors: Error[] } {
  const s = scripted(steps);
  const source = createWindowsRegistryCentralPolicySource(s.runner, "win32");
  return { result: () => source.read(), calls: s.calls, errors: s.errors };
}

// A real captured shape (2026-09-26, this host): `reg query HKLM\SOFTWARE\Policies` for a parent
// that has subkeys and NO values prints NO header line. CRLF, one leading blank line.
const REAL_PARENT_LISTING =
  "\r\n" +
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Hewlett-Packard\r\n" +
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\HP\r\n" +
  "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\r\n";
const PARENT_WITH_VALUES_HEADER =
  "\r\n" + "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\r\n" + "    SomeValue    REG_SZ    x\r\n" + "\r\n" + "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\r\n";
const NON_ENGLISH_STDERR = [
  "FEHLER: Der angegebene Registrierungsschluessel oder Wert wurde nicht gefunden.\r\n", // de-DE style
  "エラー: 指定されたレジストリキーまたは値が見つかりません。\r\n", // ja-JP style
  "���� zzz 0x00 \u0007\r\n", // gibberish (mis-decoded OEM bytes)
];
const FIRST_NON_ENGLISH = NON_ENGLISH_STDERR[0] ?? "";
const CALL1_ARGS = ["query", REGISTRY_KEY_PATH, "/v", REGISTRY_VALUE_NAME];
const CALL2_ARGS = ["query", REGISTRY_PARENT_KEY_PATH];

test("C1: trigger: exit 1 with stderr the English patterns do not classify (de-DE, ja-JP, gibberish), then a recognised parent listing that lacks the Thoth subkey: absent; exactly 2 runner calls with the exact args", () => {
  for (const stderr of NON_ENGLISH_STDERR) {
    const r = readWith([{ fail: { status: 1, stderr } }, { stdout: REAL_PARENT_LISTING }]);
    assert.deepEqual(r.result(), { status: "absent" });
    assert.equal(r.calls.length, 2);
    assert.deepEqual(r.calls[0]?.args, CALL1_ARGS);
    assert.deepEqual(r.calls[1]?.args, CALL2_ARGS);
  }
  assert.equal(REGISTRY_PARENT_KEY_PATH, "HKLM\\SOFTWARE\\Policies");
});

test("C2r: English not-found text with exit 1 still resolves absent in exactly ONE runner call (the existing test's behavior, now with the call count pinned)", () => {
  const r = readWith([{ fail: { status: 1, stderr: REAL_CAPTURED_ABSENT_STDERR } }]);
  assert.deepEqual(r.result(), { status: "absent" });
  assert.equal(r.calls.length, 1);
});

function assertRethrowsOriginal(steps: Step[], label: string): void {
  const r = readWith(steps);
  let caught: unknown;
  try {
    r.result();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught !== undefined, `${label}: must throw (fail-closed), never resolve`);
  assert.equal(caught, r.errors[0], `${label}: must rethrow the ORIGINAL error object of call 1`);
}

test("C3: absent requires positive parse evidence; each of these rethrows the ORIGINAL error object: empty listing; blank-only output; lines under a different-script path; a short-form hive spelling; a garbled non-anchored line; indented lines only", () => {
  const fail1: Step = { fail: { status: 1, stderr: FIRST_NON_ENGLISH } };
  assertRethrowsOriginal([fail1, { stdout: "" }], "empty stdout");
  assertRethrowsOriginal([fail1, { stdout: "\r\n\r\n   \r\n" }], "blank-only stdout");
  assertRethrowsOriginal([fail1, { stdout: "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Richtlinien\\Microsoft\r\n" }], "different-script path");
  assertRethrowsOriginal([fail1, { stdout: "\r\nHKLM\\SOFTWARE\\Policies\\Microsoft\r\n" }], "short-form hive spelling");
  assertRethrowsOriginal([fail1, { stdout: REAL_PARENT_LISTING + "Schl�ssel nicht gefunden\r\n" }], "garbled non-anchored line");
  assertRethrowsOriginal([fail1, { stdout: "    only an indented line    REG_SZ    x\r\n" }], "indented lines only, no anchored line");
});

test("C4: the listing shows the Thoth subkey (exact, case-insensitive, THOTH): rethrows the original error (key exists, value unreadable)", () => {
  const fail1: Step = { fail: { status: 1, stderr: FIRST_NON_ENGLISH } };
  assertRethrowsOriginal([fail1, { stdout: REAL_PARENT_LISTING + "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Thoth\r\n" }], "Thoth listed");
  assertRethrowsOriginal([fail1, { stdout: REAL_PARENT_LISTING + "HKEY_LOCAL_MACHINE\\SOFTWARE\\POLICIES\\THOTH\r\n" }], "THOTH upper case");
  assertRethrowsOriginal([fail1, { stdout: REAL_PARENT_LISTING + "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Thoth\n" }], "Thoth listed with LF");
});

test("C5: lookalike subkeys ThothX, Thoth2 and a child of a lookalike only: absent (exact match, not substring)", () => {
  const listing = REAL_PARENT_LISTING + "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\ThothX\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Thoth2\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Thoth2\\Sub\r\n";
  const r = readWith([{ fail: { status: 1, stderr: FIRST_NON_ENGLISH } }, { stdout: listing }]);
  assert.deepEqual(r.result(), { status: "absent" });
});

test("C6: trigger limits: status 2, a null status (timeout), a missing status (spawn error) and status 127: NO second call, the original error is rethrown", () => {
  for (const status of [2, null, undefined, 127]) {
    const r = readWith([{ fail: { status, stderr: FIRST_NON_ENGLISH } }]);
    let caught: unknown;
    try {
      r.result();
    } catch (e) {
      caught = e;
    }
    assert.equal(caught, r.errors[0], `status ${String(status)}`);
    assert.equal(r.calls.length, 1, `status ${String(status)}: no second call`);
  }
});

test("C7: call 2 failure (status not 0, timeout, spawn error): the ORIGINAL error from call 1 is rethrown, not call 2's", () => {
  const fail1: Step = { fail: { status: 1, stderr: FIRST_NON_ENGLISH, message: "the original failure" } };
  const seconds: Step[] = [
    { fail: { status: 1, stderr: "x", message: "second failed (exit 1)" } },
    { fail: { status: null, stderr: "", message: "second failed (timeout)" } },
    { fail: { status: undefined, stderr: "", message: "second failed (spawn)" } },
  ];
  for (const second of seconds) {
    const r = readWith([fail1, second]);
    let caught: unknown;
    try {
      r.result();
    } catch (e) {
      caught = e;
    }
    assert.equal(caught, r.errors[0]);
    assert.match((caught as Error).message, /the original failure/);
  }
});

test("C8: call shape for BOTH calls: absolute %SystemRoot%\\System32\\reg.exe path, exact args, stdio [ignore,pipe,pipe], timeout 5000, maxBuffer 1 MiB, windowsHide, utf8", () => {
  const r = readWith([{ fail: { status: 1, stderr: FIRST_NON_ENGLISH } }, { stdout: REAL_PARENT_LISTING }]);
  r.result();
  assert.equal(r.calls.length, 2);
  for (const call of r.calls) {
    assert.equal(call.cmd, resolveSystemRegExePath(), "absolute, system-rooted path on both calls");
    assert.notEqual(call.cmd, "reg.exe");
    assert.deepEqual(call.opts, { timeout: 5_000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
});

test("C9: listing classifier golden over the real captured parent-listing bytes (CRLF, no header line) and a with-values header shape", () => {
  assert.equal(classifyParentListing(REAL_PARENT_LISTING), "key-absent");
  assert.equal(classifyParentListing(PARENT_WITH_VALUES_HEADER), "key-absent");
  assert.equal(classifyParentListing(REAL_PARENT_LISTING + "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Thoth\r\n"), "key-listed");
  assert.equal(classifyParentListing(""), "unrecognised");
  assert.equal(classifyParentListing("\r\n"), "unrecognised");
});

test("C12: DOCUMENTING (Issue #309, plan AP-9): key present, value missing. The English fast path resolves absent; on a non-English host the same state rethrows the ORIGINAL error (fail-closed). At activation a half-provisioned central key therefore denies every gated call on a non-English host until the value is written or the key is removed", () => {
  // English host: value-not-found text, exit 1: absent in ONE call (ratified 2026-09-08 behaviour)
  const english = readWith([{ fail: { status: 1, stderr: REAL_CAPTURED_ABSENT_STDERR } }]);
  assert.deepEqual(english.result(), { status: "absent" });
  assert.equal(english.calls.length, 1);
  // non-English host, same state: the parent listing SHOWS the Thoth key, so the downgrade is refused
  const localized = readWith([{ fail: { status: 1, stderr: FIRST_NON_ENGLISH, message: "value not found (localized)" } }, { stdout: REAL_PARENT_LISTING + "HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Thoth\r\n" }]);
  let caught: unknown;
  try {
    localized.result();
  } catch (e) {
    caught = e;
  }
  assert.equal(caught, localized.errors[0], "the ORIGINAL error is rethrown (a loader read-error, then a deny for every gated call)");
  assert.equal(localized.calls.length, 2);
});
