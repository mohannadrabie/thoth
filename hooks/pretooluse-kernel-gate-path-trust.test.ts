// Issue #428 (S7, blocks #308 K): the binary-trust check wired into the gate. Gate-level tests (in process, fake file
// system) and real-hook tests (a copy-tree sandbox with the REAL check, a real planted file in a temp directory).
// Written failing first by story-implementer. Plan: docs/plans/s428-path-planted-binary-plan-2026-10-05.md; design challenge:
// docs/reviews/s428-path-trust-design-challenge-2026-10-05.md (adds TRUST-13b, TRUST-15, TRUST-16).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideToolCall, type GatePorts, type GateResult } from "../src/policy/gate/decide-tool-call.ts";
import { renderHookOutput } from "../src/policy/gate/render-hook-output.ts";
import { routeToolName, ROUTES } from "../src/policy/gate/tool-routing.ts";
import { checkBareBinaries, isTrustedDirectory, scannedDirectories, type TrustPorts } from "../src/policy/gate/bare-binary-trust.ts";
import { createRealTrustPorts } from "../src/policy/config/path-trust-check.ts";
import { invokedBareBinaries } from "../src/policy/normalizer/shell.ts";
import { normalize } from "../src/policy/normalizer/registry.ts";
import { createGateSandbox, describeRun, isSilentAllow, denyReason } from "./test-support/gate-sandbox.ts";
import { PATH_BINARIES, USER_LOCAL, winWorld, posixWorld } from "./test-support/trust-world.ts";

const sanitize = (t: string): string => t;

function gatePorts(check: GatePorts["checkBareBinaries"], defaultOutcome: "allow" | "deny" = "allow"): GatePorts {
  return {
    loadPolicy: () => ({ ok: true, ruleSet: { version: "0.0.0-test", rules: [] }, defaultOutcome }),
    loadCatalog: () => ({ version: "0.0.0-test", tools: [] }),
    ...(check === undefined ? {} : { checkBareBinaries: check }),
  } as GatePorts;
}
const bash = (command: string, ports: GatePorts): GateResult => decideToolCall({ tool_name: "Bash", tool_input: { command }, session_id: "t428" }, ports);
const realCheck = (ports: TrustPorts) => (names: readonly string[]) => checkBareBinaries(names, ports);

// --- TRUST-5 ----------------------------------------------------------------------------------------------------------

test("TRUST-5-wrapper-layers-each-checked: a plant for only kubectl, only sh, or only env denies a wrapped command; no plant allows", () => {
  const cases: { command: string; plant: string }[] = [
    { command: "sh -c 'kubectl get pods/x --context=c'", plant: "kubectl" },
    { command: "sh -c 'kubectl get pods/x --context=c'", plant: "sh" },
    { command: "env kubectl get pods/x --context=c", plant: "env" },
    { command: "env kubectl get pods/x --context=c", plant: "kubectl" },
    { command: "bash -c 'env kubectl get pods/x --context=c'", plant: "bash" },
    { command: "bash -c 'env kubectl get pods/x --context=c'", plant: "env" },
    { command: "bash -c 'env kubectl get pods/x --context=c'", plant: "kubectl" },
    { command: "nohup kubectl get pods/x --context=c &", plant: "nohup" },
  ];
  for (const { command, plant } of cases) {
    const clean = bash(command, gatePorts(realCheck(winWorld({ gitBin: PATH_BINARIES }))));
    assert.equal(clean.kind === "verdict" ? clean.verdict.outcome : clean.kind, "allow", `clean world: ${command}`);
    const planted = bash(command, gatePorts(realCheck(winWorld({ gitBin: PATH_BINARIES, userLocal: [`${plant}.exe`] }))));
    assert.equal(planted.kind, "refusal", `${command} with ${plant} planted`);
    if (planted.kind === "refusal") assert.ok(planted.reason.includes(plant) && planted.reason.includes(USER_LOCAL), planted.reason);
  }
});

test("TRUST-5b-names-passed-to-the-port-are-the-invoked-names: the gate hands the check exactly what the normalizer consumed", () => {
  const seen: string[][] = [];
  bash("sh -c 'env kubectl get pods/x --context=c'", gatePorts((names) => (seen.push([...names]), { ok: true })));
  assert.deepEqual(seen, [["sh", "env", "kubectl"]]);
  seen.length = 0;
  bash("ls -la", gatePorts((names) => (seen.push([...names]), { ok: true })));
  assert.deepEqual(seen, [["ls"]]);
  assert.deepEqual(invokedBareBinaries("kubectl get pods/x --context=c"), ["kubectl"]);
});

// --- TRUST-9 ----------------------------------------------------------------------------------------------------------

test("TRUST-9-existing-deny-reason-kept: an already-denied call keeps its kernel reason and never reaches the check", () => {
  let called = 0;
  const ports = gatePorts(() => (called++, { ok: false, reason: "the trust reason" }), "deny");
  const r = bash("kubectl get pods/x --context=c", ports);
  assert.equal(r.kind, "verdict");
  if (r.kind === "verdict") {
    assert.equal(r.verdict.outcome, "deny");
    assert.ok(!r.verdict.reason.includes("the trust reason"));
  }
  assert.equal(called, 0, "the check runs only for a call the kernel would allow");
  const mcp = decideToolCall({ tool_name: "mcp__s__t", tool_input: {}, session_id: "x" }, { ...gatePorts(undefined), loadCatalog: () => ({ version: "v", tools: [{ name: "s", class: "read-only", sourceLayer: "central" }] }) });
  assert.equal(mcp.kind === "verdict" ? mcp.verdict.outcome : mcp.kind, "allow", "an mcp call has no bare binary and needs no check port");
});

test("TRUST-9b-deny-json-shape-unchanged: the trust refusal renders through the existing deny JSON, exit 0", () => {
  const r = bash("kubectl get pods/x --context=c", gatePorts(() => ({ ok: false, reason: "bare binary kubectl shadowed" })));
  const out = renderHookOutput(r, sanitize);
  assert.equal(out.exitCode, 0);
  assert.equal(out.stderr, "");
  const json = JSON.parse(out.stdout) as { hookSpecificOutput: Record<string, unknown> };
  assert.deepEqual(Object.keys(json), ["hookSpecificOutput"]);
  assert.deepEqual(Object.keys(json.hookSpecificOutput).sort(), ["hookEventName", "permissionDecision", "permissionDecisionReason"]);
  assert.equal(json.hookSpecificOutput.permissionDecision, "deny");
  assert.match(String(json.hookSpecificOutput.permissionDecisionReason), /shadowed/);
});

// --- TRUST-11 (gate side) ---------------------------------------------------------------------------------------------

test("TRUST-11b-gate-fails-closed: a port that throws, a port that is absent, and a malformed answer each deny a call the kernel allowed", () => {
  const thrown = bash("kubectl get pods/x --context=c", gatePorts(() => {
    throw new Error("port exploded");
  }));
  assert.equal(thrown.kind, "refusal");
  if (thrown.kind === "refusal") assert.ok(!thrown.reason.includes("port exploded"), "the raw fault text stays out of the reason");
  const absent = bash("kubectl get pods/x --context=c", gatePorts(undefined));
  assert.equal(absent.kind, "refusal", "an absent port is a deny (fail closed)");
  const malformed = bash("kubectl get pods/x --context=c", gatePorts((() => undefined) as unknown as GatePorts["checkBareBinaries"]));
  assert.equal(malformed.kind, "refusal");
  const noReason = bash("kubectl get pods/x --context=c", gatePorts((() => ({ ok: false })) as unknown as GatePorts["checkBareBinaries"]));
  assert.equal(noReason.kind, "refusal");
});

// --- TRUST-14 ---------------------------------------------------------------------------------------------------------

test("TRUST-14-leading-PATH-assignment-not-resolved: a command that starts with a PATH= assignment (or any VAR=) does not resolve (the lever is #409's; pinned here)", () => {
  for (const command of ["PATH=/tmp/x:$PATH kubectl get pods/x --context=c", "PATH=/tmp/x kubectl get pods/x --context=c", "FOO=1 kubectl get pods/x --context=c", "PATH=/tmp/x ls"]) {
    const record = normalize("shell", { command, environment: "e", identity: "i", deferred: false });
    assert.ok(record.unresolved.length > 0, `${command} resolved: ${JSON.stringify(record)}`);
  }
});

// --- TRUST-15 ---------------------------------------------------------------------------------------------------------

function loginShellPath(): string[] | undefined {
  const r = spawnSync("bash", ["-lc", 'printf %s "$PATH"'], { encoding: "utf8", windowsHide: true });
  if (r.error !== undefined || r.status !== 0 || r.stdout === "") return undefined;
  return r.stdout.split(":").filter((e) => e !== "");
}

test("TRUST-15-gate-path-covers-shell-untrusted-dirs: every directory the REAL login shell puts on PATH is scanned by the gate or is trusted, derived from the real profile scripts", (t) => {
  const shellEntries = loginShellPath();
  if (shellEntries === undefined) {
    t.skip("no bash on this machine: the login-shell PATH cannot be derived");
    return;
  }
  const ports = createRealTrustPorts();
  const win = process.platform === "win32";
  const toNative = (entry: string): string => {
    if (!win) return entry;
    const r = spawnSync("cygpath", ["-w", entry], { encoding: "utf8", windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : entry;
  };
  const norm = (p: string): string => (win ? p.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase() : p.replace(/\/+$/, ""));
  const scanned = new Set(scannedDirectories(ports).map((e) => norm(e.dir)));
  const uncovered: string[] = [];
  for (const entry of shellEntries) {
    const native = toNative(entry);
    if (scanned.has(norm(native)) || isTrustedDirectory(ports, native)) continue;
    // a directory that does not exist and lies under a trusted root cannot be created by the session either
    uncovered.push(`${entry} -> ${native}`);
  }
  console.log(`TRUST-15: login shell PATH has ${String(shellEntries.length)} entries, ${String(uncovered.length)} not covered by the gate`);
  assert.deepEqual(uncovered, [], "a directory the shell searches that the gate neither scans nor trusts");
});

test("TRUST-15c-profile-script-additions-classified: every PATH assignment in the real /etc/profile.d scripts is a $HOME form the gate scans or a system path (derived by reading the scripts)", (t) => {
  const r = spawnSync("bash", ["-c", 'cat /etc/profile.d/*.sh 2>/dev/null; cat /etc/profile 2>/dev/null'], { encoding: "utf8", windowsHide: true });
  if (r.error !== undefined || r.stdout === "") {
    t.skip("no readable /etc/profile scripts on this machine");
    return;
  }
  const additions = [...r.stdout.matchAll(/^\s*(?:export\s+)?PATH=["']?([^"'\n]+)/gm)].map((m) => m[1] ?? "");
  const homeForms = additions.filter((a) => /\$HOME|\$\{HOME\}|~/.test(a));
  const ports = createRealTrustPorts();
  const scanned = scannedDirectories(ports).map((e) => e.dir.replaceAll("\\", "/").toLowerCase());
  const home = (ports.homedir() ?? "").replaceAll("\\", "/").toLowerCase();
  const uncovered: string[] = [];
  for (const form of homeForms) {
    for (const piece of form.split(":")) {
      if (!/\$HOME|\$\{HOME\}|~/.test(piece)) continue;
      const resolved = piece.replace(/\$\{HOME\}|\$HOME|^~/g, home).toLowerCase();
      if (!scanned.includes(resolved)) uncovered.push(piece);
    }
  }
  console.log(`TRUST-15c: ${String(additions.length)} PATH assignments read, ${String(homeForms.length)} use $HOME, ${String(uncovered.length)} not scanned`);
  assert.deepEqual(uncovered, []);
});

// --- TRUST-16 ---------------------------------------------------------------------------------------------------------

test("TRUST-16-powershell-unroutable-until-covered: PowerShell (any spelling) stays refused by tool routing; a routable PowerShell needs its own cwd-first resolution check", () => {
  for (const name of ["PowerShell", "powershell", "pwsh", "Powershell", "PowerShell.exe", "mcp_PowerShell", "Bash2", "bash"]) {
    assert.equal(routeToolName(name), undefined, name);
    const r = decideToolCall({ tool_name: name, tool_input: { command: "kubectl get pods/x --context=c" }, session_id: "x" }, gatePorts(undefined));
    assert.equal(r.kind, "refusal", name);
    if (r.kind === "refusal") assert.equal(r.category, "unroutable-tool", name);
  }
  assert.equal(ROUTES.length, 2, "adding a route (a PowerShell one) must come with its own resolution check; this pin fails until then");
});

// --- real hook, real file system --------------------------------------------------------------------------------------

const PATH_SEP = process.platform === "win32" ? ";" : ":";

function withPlantDir<T>(files: string[], body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "thoth-428-plant-"));
  try {
    for (const f of files) writeFileSync(join(dir, f), "#!/bin/sh\necho planted\n", { mode: 0o755 });
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("TRUST-13-real-plant-end-to-end: a temp directory prepended to the hook's PATH that holds ls (or kubectl) denies; without the plant ls is a silent allow", () => {
  const sb = createGateSandbox({ realPathTrust: true });
  const clean = sb.bash("ls -la");
  assert.ok(isSilentAllow(clean), `clean: ${describeRun(clean)}`);
  const name = process.platform === "win32" ? "ls.exe" : "ls";
  withPlantDir([name], (dir) => {
    const run = sb.bash("ls -la", { PATH: `${dir}${PATH_SEP}${process.env.PATH ?? ""}` });
    assert.equal(run.code, 0, describeRun(run));
    assert.ok(!isSilentAllow(run), `planted ls must not be a silent allow: ${describeRun(run)}`);
    assert.ok(denyReason(run).includes("ls") && denyReason(run).includes(dir), denyReason(run));
  });
  withPlantDir([process.platform === "win32" ? "kubectl.exe" : "kubectl"], (dir) => {
    const run = sb.bash("kubectl get pods/x --context=c", { PATH: `${process.env.PATH ?? ""}${PATH_SEP}${dir}` });
    assert.ok(!isSilentAllow(run), `planted kubectl (LATER in PATH) must not be a silent allow: ${describeRun(run)}`);
    assert.ok(denyReason(run).includes("kubectl"), denyReason(run));
  });
  const after = sb.bash("ls -la");
  assert.ok(isSilentAllow(after), `after removal: ${describeRun(after)}`);
});

test("TRUST-13b-real-lnk-plant-end-to-end: a name.lnk shortcut in an untrusted PATH directory denies through the real hook (Windows)", (t) => {
  if (process.platform !== "win32") {
    t.skip("a .lnk file is a Windows resolution form; POSIX matching is exact by design");
    return;
  }
  const sb = createGateSandbox({ realPathTrust: true });
  withPlantDir(["ls.lnk"], (dir) => {
    const run = sb.bash("ls -la", { PATH: `${process.env.PATH ?? ""};${dir}` });
    assert.ok(!isSilentAllow(run), `planted ls.lnk must not be a silent allow: ${describeRun(run)}`);
    assert.ok(denyReason(run).includes("ls"), denyReason(run));
  });
});

test("TRUST-13c-real-hook-fails-closed-without-path: no PATH at all denies (it does not allow, it does not crash)", () => {
  const sb = createGateSandbox({ realPathTrust: true });
  const env: NodeJS.ProcessEnv = { PATH: "" };
  if (process.platform === "win32") env.Path = "";
  const run = sb.bash("ls -la", env);
  assert.ok(!isSilentAllow(run), describeRun(run));
});

test("TRUST-7b-real-symlink-realpath: the real port resolves a link to its target (skipped where symlinks cannot be created)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "thoth-428-link-"));
  try {
    mkdirSync(join(dir, "real"));
    writeFileSync(join(dir, "real", "f"), "x");
    try {
      symlinkSync(join(dir, "real", "f"), join(dir, "link"));
    } catch {
      t.skip("this account cannot create symlinks");
      return;
    }
    const ports = createRealTrustPorts();
    const target = ports.realpath(join(dir, "link"));
    assert.ok(target.toLowerCase().endsWith(join("real", "f").toLowerCase()), target);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TRUST-17-existing-posix-world-helper-sanity: the fake worlds the tests share behave as documented", () => {
  assert.deepEqual(checkBareBinaries(["ls"], posixWorld()), { ok: true });
  assert.deepEqual(checkBareBinaries(["ls"], winWorld()), { ok: true });
});
