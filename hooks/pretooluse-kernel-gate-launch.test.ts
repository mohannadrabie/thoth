// S7-A (Issues #303 and #304 half): the gate hook must fail CLOSED for every failure that can be fixed
// inside the script. story-implementer's own tests, written failing first (the hook's project modules
// were static imports that ran before the hook's own try/catch, and a stdout write error was dropped).
// It uses the test-writer's sandbox helper WITHOUT editing it.
//
// Criteria named in docs/plans/s7a-gate-hook-robustness-phase1-2026-09-26.md section 6:
//   A1 hook-blocks-under-no-ts-type-stripping        A2 hook-static-imports-are-node-builtins-only
//   A3 hook-blocks-when-src-tree-missing             A6 fail-closed-stderr-names-error-type-only-and-an-unlock
//   A7 fail-closed-error-name-is-sanitized           A8 (in-hook half) stdout write failures exit 2
//   A10 deny-json-still-reaches-a-healthy-stdout
// The real destroyed-pipe probe row (A8, A9) lives in src/qa/gate-fail-open-probe.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { classifyOutcome } from "../src/qa/gate-fail-open-probe.ts";
import { extractImportSpecifiers, stripComments } from "../src/qa/kernel-purity-check.ts";
import { createGateSandbox, describeRun, makeTempDir, preToolUsePayload, type GateRun } from "./test-support/gate-sandbox.ts";
import { REPO_ROOT } from "./test-support/spawn-hook.ts";

const BASH_COMMAND = "kubectl get pod/x --context=c";
const HOOK_SOURCE_PATH = path.join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs");

function spawnHook(hookPath: string, cwd: string, input: string, nodeArgs: string[] = []): GateRun {
  const result = spawnSync(process.execPath, [...nodeArgs, hookPath], { input, encoding: "utf8", cwd, timeout: 30_000, windowsHide: true });
  const spawnError = result.error === undefined ? "" : `spawn error: ${String(result.error)}\n`;
  return { code: result.status, stdout: result.stdout ?? "", stderr: `${spawnError}${result.stderr ?? ""}` };
}

/** A tree that holds ONLY the hook script: no src directory, so every project import fails. */
function makeBareTree(label: string): { root: string; hookPath: string } {
  const root = makeTempDir(label);
  fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
  const hookPath = path.join(root, "hooks", "pretooluse-kernel-gate.mjs");
  fs.copyFileSync(HOOK_SOURCE_PATH, hookPath);
  return { root, hookPath };
}

/** The fail-closed stderr contract (S7 G22 plus PRINCIPLES rule 2): exit 2, nothing on stdout, ONE line
 * that names a fixed unlock and the error type only. Nothing a model could learn a path or parser text from. */
function assertFailClosedWithUnlock(run: GateRun, root: string, what: string): void {
  assert.equal(run.code, 2, `${what}: expected exit 2; got ${describeRun(run)}`);
  assert.equal(run.stdout, "", `${what}: no stdout on exit 2`);
  assert.match(run.stderr, /internal exception, fail-closed \(exit 2\)/, `${what}: fixed message; got ${JSON.stringify(run.stderr)}`);
  assert.match(run.stderr, /Unlock: \S/, `${what}: the message must name how to proceed (PRINCIPLES rule 2); got ${JSON.stringify(run.stderr)}`);
  assert.ok(!/[\\/]/.test(run.stderr), `${what}: stderr must contain no path separator; got ${JSON.stringify(run.stderr)}`);
  assert.ok(!run.stderr.includes(root), `${what}: stderr must not carry the tree root`);
  assert.ok(!/\n\s+at /.test(run.stderr), `${what}: no stack frames`);
  assert.ok(!/Unexpected|Expected|position|JSON|token/i.test(run.stderr), `${what}: no parser text; got ${JSON.stringify(run.stderr)}`);
  assert.match(run.stderr, /Error type: [A-Za-z]+\n$/, `${what}: ends with the error type only; got ${JSON.stringify(run.stderr)}`);
  assert.equal(run.stderr.trimEnd().split("\n").length, 1, `${what}: exactly one line; got ${JSON.stringify(run.stderr)}`);
}

// --- A1 ------------------------------------------------------------------------------------------

test("A1 hook-blocks-under-no-ts-type-stripping: a Node that cannot strip TypeScript types no longer exits 1 before the catch; the call is BLOCKED (exit 2)", () => {
  const sb = createGateSandbox();
  const run = spawnHook(sb.hookPath, sb.root, JSON.stringify(preToolUsePayload(sb.root, "Bash", { command: BASH_COMMAND })), ["--no-experimental-strip-types"]);
  assert.equal(classifyOutcome(run.code, run.stdout), "BLOCKS", describeRun(run));
  assert.equal(run.code, 2, describeRun(run));
});

// --- A2 ------------------------------------------------------------------------------------------

test("A2 hook-static-imports-are-node-builtins-only: every static import specifier of the hook starts with node:, and the project modules are reached only by import() inside the try block that has the catch", () => {
  const source = fs.readFileSync(HOOK_SOURCE_PATH, "utf8");
  const stripped = stripComments(source);
  const staticSpecifiers = extractImportSpecifiers(source);
  assert.ok(staticSpecifiers.length > 0, "the extractor must see the hook's own static imports (a zero here means the extractor is blind)");
  for (const spec of staticSpecifiers) {
    assert.ok(spec.startsWith("node:"), `static import "${spec}" runs before the hook's catch: only node: built-ins may be static`);
  }
  const dynamicSpecifiers = [...stripped.matchAll(/\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1] ?? "");
  assert.ok(dynamicSpecifiers.length > 0, "the project modules must be loaded with import()");
  for (const spec of dynamicSpecifiers) assert.ok(spec.startsWith("../src/"), `dynamic import "${spec}" should be a project module under src`);
  const tryIndex = stripped.indexOf("try {");
  const catchIndex = stripped.indexOf("catch (");
  assert.ok(tryIndex >= 0 && catchIndex > tryIndex, "the hook must hold a try block with a catch handler");
  for (const m of stripped.matchAll(/\bimport\(/g)) {
    const at = m.index ?? -1;
    assert.ok(at > tryIndex && at < catchIndex, `an import() at offset ${at} sits outside the try block (${tryIndex}..${catchIndex}): its failure would exit 1, which proceeds`);
  }
});

// --- A3 ------------------------------------------------------------------------------------------

test("A3 hook-blocks-when-src-tree-missing: a hook whose project modules cannot be found is BLOCKED (exit 2), not a non-blocking exit 1", () => {
  const bare = makeBareTree("launch-bare");
  const run = spawnHook(bare.hookPath, bare.root, JSON.stringify(preToolUsePayload(bare.root, "Bash", { command: BASH_COMMAND })));
  assert.equal(classifyOutcome(run.code, run.stdout), "BLOCKS", describeRun(run));
  assert.equal(run.code, 2, describeRun(run));
});

// --- A6 ------------------------------------------------------------------------------------------

test("A6 fail-closed-stderr-names-error-type-only-and-an-unlock: a payload failure, a module-load failure under no type stripping and a missing src tree each print one fixed line with an Unlock clause and the error type only", () => {
  const sb = createGateSandbox();
  assertFailClosedWithUnlock(sb.run(""), sb.root, "payload failure (empty stdin)");
  const noStrip = spawnHook(sb.hookPath, sb.root, JSON.stringify(preToolUsePayload(sb.root, "Bash", { command: BASH_COMMAND })), ["--no-experimental-strip-types"]);
  assertFailClosedWithUnlock(noStrip, sb.root, "module-load failure (no type stripping)");
  const bare = makeBareTree("launch-bare-unlock");
  const missing = spawnHook(bare.hookPath, bare.root, JSON.stringify(preToolUsePayload(bare.root, "Bash", { command: BASH_COMMAND })));
  assertFailClosedWithUnlock(missing, bare.root, "module-load failure (src tree missing)");
});

// --- A7 ------------------------------------------------------------------------------------------

test("A7 fail-closed-error-name-is-sanitized: an error whose name holds a path-like string prints the bare type Error and never the planted text", () => {
  const sb = createGateSandbox();
  const planted = path.join(sb.root, "src", "policy", "gate", "render-hook-output.ts");
  fs.writeFileSync(
    planted,
    ['const planted = new Error("PLANTED-MESSAGE-SECRET");', 'planted.name = "C:\\\\PLANTED\\\\dir/Name-9";', "throw planted;", "export {};", ""].join("\n"),
    "utf8",
  );
  const run = sb.bash(BASH_COMMAND);
  assertFailClosedWithUnlock(run, sb.root, "a project module that throws an error with a path-like name");
  assert.ok(!/PLANTED/i.test(run.stderr), `the planted name or message must never reach stderr; got ${JSON.stringify(run.stderr)}`);
  assert.match(run.stderr, /Error type: Error\n$/, "an unsafe error name falls back to the bare type Error");
});

// --- A8 (in-hook half): stdout write failures ----------------------------------------------------

function preloadUrl(dir: string, name: string, source: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, "utf8");
  return pathToFileURL(file).href;
}

/** A DENY payload: a project rule denies every action, so the hook must WRITE a deny JSON to stdout. */
function denyingSandbox(rationale: string): ReturnType<typeof createGateSandbox> {
  const sb = createGateSandbox();
  sb.writeProjectPolicy({ version: "0.0.0-s7a-launch-test", rules: [{ id: "s7a-deny-everything", effect: "deny", rationale }] });
  return sb;
}

test("A8 stdout-write-failure-exits-2 (callback error): a write that reports an error for a decided deny exits 2 with a fixed stderr line, never the silent exit 0", () => {
  const sb = denyingSandbox("S7A-DENY");
  const dir = makeTempDir("launch-preload-cb");
  const preload = preloadUrl(
    dir,
    "fail-write-callback.mjs",
    [
      "process.stdout.write = function (chunk, encoding, cb) {",
      '  const callback = typeof encoding === "function" ? encoding : cb;',
      '  const err = Object.assign(new Error("simulated EPIPE"), { code: "EPIPE" });',
      '  if (typeof callback === "function") queueMicrotask(() => callback(err));',
      "  return true;",
      "};",
      "",
    ].join("\n"),
  );
  const run = spawnHook(sb.hookPath, sb.root, JSON.stringify(preToolUsePayload(sb.root, "Bash", { command: BASH_COMMAND })), ["--import", preload]);
  assert.equal(run.code, 2, `a failed stdout write must exit 2; got ${describeRun(run)}`);
  assert.equal(classifyOutcome(run.code, run.stdout), "BLOCKS");
  assert.match(run.stderr, /fail-closed \(exit 2\)/, `fixed message expected; got ${JSON.stringify(run.stderr)}`);
  assert.ok(!/[\\/]/.test(run.stderr) && !/simulated|EPIPE/.test(run.stderr), `no path and no raw error text; got ${JSON.stringify(run.stderr)}`);
});

test("A8 stdout-write-failure-exits-2 (error event): a stdout error event with no write callback also exits 2", () => {
  const sb = denyingSandbox("S7A-DENY");
  const dir = makeTempDir("launch-preload-ev");
  const preload = preloadUrl(
    dir,
    "fail-write-event.mjs",
    [
      "process.stdout.write = function () {",
      '  const err = Object.assign(new Error("simulated EPIPE"), { code: "EPIPE" });',
      '  queueMicrotask(() => process.stdout.emit("error", err));',
      "  return true;",
      "};",
      "",
    ].join("\n"),
  );
  const run = spawnHook(sb.hookPath, sb.root, JSON.stringify(preToolUsePayload(sb.root, "Bash", { command: BASH_COMMAND })), ["--import", preload]);
  assert.equal(run.code, 2, `a stdout error event must exit 2; got ${describeRun(run)}`);
  assert.match(run.stderr, /fail-closed \(exit 2\)/, `fixed message expected; got ${JSON.stringify(run.stderr)}`);
});

// --- A10 -----------------------------------------------------------------------------------------

test("A10 deny-json-still-reaches-a-healthy-stdout: a 300000-character deny reason is flushed whole, exit 0, empty stderr", () => {
  const rationale = `S7A-LONG-${"R".repeat(300_000)}-END`;
  const sb = denyingSandbox(rationale);
  const run = sb.bash(BASH_COMMAND);
  assert.equal(run.code, 0, `a deny is exit 0; got code=${String(run.code)} stderr=${JSON.stringify(run.stderr.slice(0, 200))}`);
  assert.equal(run.stderr, "", "a deny writes nothing to stderr");
  const parsed = JSON.parse(run.stdout) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
  assert.equal(parsed.hookSpecificOutput?.permissionDecision, "deny");
  assert.equal(parsed.hookSpecificOutput?.permissionDecisionReason, rationale, "the whole reason must arrive: a truncated flush would be an unparseable or shortened deny");
});
