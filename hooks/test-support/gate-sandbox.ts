// Shared black-box test helper (test-writer scope, not application source) for the S7 gate
// classification tests (hooks/pretooluse-kernel-gate-classification.test.ts).
//
// WHAT IT BUILDS. A registry-pinned COPY-TREE SANDBOX (docs/plans/s7-kernel-gate-classification-
// phase1-2026-09-26.md, section 3 S-8 and section 7's H-group preamble):
//   - At TEST time (never committed, so it cannot drift from the real tree) the hook, `src/`
//     (minus every *.test.ts, which the hook never imports), `package.json`, the tool inventory
//     and the classification fixture are copied into a fresh temp directory.
//   - The copy's `.thoth/policy.json` and shipped-defaults are written as EMPTY rule sets, so an H
//     verdict depends only on what the test itself plants (a later story that ships baseline
//     policy content must not silently change these expectations).
//   - The copy's central-source module is overwritten so the registry reader can only ever say
//     "absent" (residual R-6: a Windows host with a central policy deployed must not flip an H
//     verdict). Both the default export and the factory function are pinned, so the pin holds
//     whichever of the two the hook uses. If the expected lines are not found the helper THROWS
//     (a pin that silently did not apply would be a false sense of host independence).
//   - The hook is spawned exactly as Claude Code spawns a command hook: `node <script>`, the JSON
//     payload on stdin, the decision read from stdout and the exit code. Module-relative policy
//     and fixture paths therefore resolve INSIDE the copy.
//
// STRICT OUTCOME HELPERS (PT-8, design-challenger round 1 and 2). A DENY is exit 0, empty stderr,
// stdout a single JSON object carrying `hookSpecificOutput.permissionDecision: "deny"` and a
// non-empty reason. Exit 2 or a crash is NOT a deny here (a crash is a different property, and
// a suite that counts it would stay green while the gate is broken; mutant "hook always throws"
// must turn every H check red). An ALLOW is exit 0 with EMPTY stdout and EMPTY stderr (Q-B: a
// kernel allow emits nothing, the gate is not an auto-approver). Any other shape is `other`.
//
// NEVER TYPE A COMMITTED FIXTURE ENTRY NAME (PC-11 / G19 / THOTH-ADR-0001 rule 1): committed
// entry names are read from the committed fixture at run time (`firstCommittedEntryName`).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeSessionId, REPO_ROOT } from "./spawn-hook.ts";

export interface GateRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type GateOutcome =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "other"; detail: string };

export function describeRun(run: GateRun): string {
  return `code=${String(run.code)} stdout=${JSON.stringify(run.stdout.slice(0, 600))} stderr=${JSON.stringify(run.stderr.slice(0, 600))}`;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Classifies one hook invocation under the strict Q-B rules described in this file's header. */
export function classify(run: GateRun): GateOutcome {
  if (run.code === 0 && run.stdout === "" && run.stderr === "") return { kind: "allow" };
  if (run.code === 0 && run.stderr === "") {
    const json = parseJsonObject(run.stdout);
    const hso = json?.hookSpecificOutput;
    if (typeof hso === "object" && hso !== null) {
      const o = hso as Record<string, unknown>;
      if (o.hookEventName === "PreToolUse" && o.permissionDecision === "deny" && typeof o.permissionDecisionReason === "string" && o.permissionDecisionReason.length > 0) {
        return { kind: "deny", reason: o.permissionDecisionReason };
      }
    }
  }
  return { kind: "other", detail: describeRun(run) };
}

export function isSilentAllow(run: GateRun): boolean {
  return classify(run).kind === "allow";
}

/** Strict policy deny (exit 0 plus an explicit deny JSON). A crash or exit 2 returns false. */
export function wasPolicyDenied(run: GateRun): boolean {
  return classify(run).kind === "deny";
}

/** The deny reason, or throws (with the full run) when the run is not a strict deny. */
export function denyReason(run: GateRun): string {
  const outcome = classify(run);
  if (outcome.kind !== "deny") throw new Error(`expected a strict policy deny; got ${describeRun(run)}`);
  return outcome.reason;
}

/** For the typed-output check only (H13): the call is blocked either by exit 2 with a stderr
 * message, or by exit 0 plus an explicit deny JSON. Silence and every other shape are not blocking. */
export function isBlocking(run: GateRun): boolean {
  if (run.code === 2 && run.stderr.trim() !== "") return true;
  if (run.code === 0) {
    const hso = parseJsonObject(run.stdout)?.hookSpecificOutput;
    if (typeof hso === "object" && hso !== null && (hso as Record<string, unknown>).permissionDecision === "deny") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Committed fixture access (read at RUN time, never typed).

interface FixtureEntry {
  name: string;
  class: string;
  note?: string;
}
interface FixtureShape {
  version: string;
  notes?: unknown;
  centralLayer: { tools: FixtureEntry[] };
  knownConnectors: string[];
}

const COMMITTED_FIXTURE_PATH = path.join(REPO_ROOT, "docs", "qa", "s5-central-classification.json");

export function readCommittedFixture(): FixtureShape {
  return JSON.parse(fs.readFileSync(COMMITTED_FIXTURE_PATH, "utf8")) as FixtureShape;
}

/** The first entry of the committed fixture's `centralLayer.tools`, read from the file. */
export function firstCommittedEntry(): FixtureEntry {
  const first = readCommittedFixture().centralLayer.tools[0];
  if (first === undefined) throw new Error("gate-sandbox: the committed classification fixture has no centralLayer.tools entry to derive a name from");
  return first;
}

export function firstCommittedEntryName(): string {
  return firstCommittedEntry().name;
}

// ---------------------------------------------------------------------------------------------
// Temp-dir bookkeeping: everything created here is removed when the test process exits.

const createdDirs: string[] = [];
let exitHookInstalled = false;

function trackForCleanup(dir: string): void {
  createdDirs.push(dir);
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const d of createdDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // best effort: a temp dir that cannot be removed must not fail the test run
      }
    }
  });
}

/** A fresh temp directory, removed at process exit. */
export function makeTempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `thoth-s7-${label}-`));
  trackForCleanup(dir);
  return dir;
}

// ---------------------------------------------------------------------------------------------
// The copy-tree template (built once per test process) and per-test sandboxes cloned from it.

const HOOK_REL = path.join("hooks", "pretooluse-kernel-gate.mjs");
const CENTRAL_SOURCE_REL = path.join("src", "policy", "config", "central-source.ts");
const SHIPPED_DEFAULTS_REL = path.join("src", "policy", "config", "shipped-defaults.json");
const FIXTURE_REL = path.join("docs", "qa", "s5-central-classification.json");
const PROJECT_POLICY_REL = path.join(".thoth", "policy.json");
const EMPTY_RULE_SET = `${JSON.stringify({ version: "0.0.0-s7-test-empty", rules: [] }, null, 2)}\n`;

let templateDir: string | undefined;

function pinRegistryToAbsent(centralSourceFile: string): void {
  const original = fs.readFileSync(centralSourceFile, "utf8");
  const defaultExport = /^export const defaultCentralPolicySource\b[^\n]*$/m;
  const factory = "export function createWindowsRegistryCentralPolicySource(";
  if (!defaultExport.test(original)) {
    throw new Error(`gate-sandbox: cannot pin the registry source: no "export const defaultCentralPolicySource" line in ${CENTRAL_SOURCE_REL}`);
  }
  if (!original.includes(factory)) {
    throw new Error(`gate-sandbox: cannot pin the registry source: no "${factory}" in ${CENTRAL_SOURCE_REL}`);
  }
  const pinned = original
    .replace(factory, "function __unpinnedCreateWindowsRegistryCentralPolicySource(")
    .replace(defaultExport, "export const defaultCentralPolicySource: CentralPolicySource = { read: () => ({ status: \"absent\" }) };") +
    "\nexport function createWindowsRegistryCentralPolicySource(..._args: unknown[]): CentralPolicySource {\n  return { read: () => ({ status: \"absent\" }) };\n}\n";
  fs.writeFileSync(centralSourceFile, pinned, "utf8");
}

function buildTemplate(): string {
  const dir = makeTempDir("gate-template");
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, HOOK_REL), path.join(dir, HOOK_REL));
  fs.cpSync(path.join(REPO_ROOT, "src"), path.join(dir, "src"), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.ts"),
  });
  fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(dir, "package.json"));
  fs.mkdirSync(path.join(dir, "docs", "qa"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "docs", "qa", "tool-inventory.json"), path.join(dir, "docs", "qa", "tool-inventory.json"));
  fs.copyFileSync(COMMITTED_FIXTURE_PATH, path.join(dir, FIXTURE_REL));
  fs.mkdirSync(path.join(dir, ".thoth"), { recursive: true });
  fs.writeFileSync(path.join(dir, PROJECT_POLICY_REL), EMPTY_RULE_SET, "utf8");
  fs.writeFileSync(path.join(dir, SHIPPED_DEFAULTS_REL), EMPTY_RULE_SET, "utf8");
  pinRegistryToAbsent(path.join(dir, CENTRAL_SOURCE_REL));
  return dir;
}

export interface GateSandbox {
  /** The sandbox root (the copy's repo root). */
  root: string;
  /** The copied hook script (module-relative imports resolve inside the copy). */
  hookPath: string;
  fixturePath: string;
  projectPolicyPath: string;
  /** Replaces the sandbox fixture's `centralLayer.tools` (keeps version, notes, knownConnectors). */
  setEntries(entries: FixtureEntry[]): void;
  /** Applies `mutate` to the parsed sandbox fixture and writes it back. */
  editFixture(mutate: (fixture: FixtureShape) => void): void;
  /** Writes the sandbox project policy: an object (JSON-serialised) or a raw string. */
  writeProjectPolicy(policy: unknown): void;
  /** Spawns the copied hook with a raw stdin payload (an object is JSON-stringified). */
  run(payload: unknown, env?: NodeJS.ProcessEnv): GateRun;
  /** Spawns the copied hook for a PreToolUse payload with the given `tool_name` (any JSON value) and `tool_input`. */
  call(toolName: unknown, toolInput?: unknown, env?: NodeJS.ProcessEnv): GateRun;
  bash(command: string, env?: NodeJS.ProcessEnv): GateRun;
  /** `mcp__<server>__<tool>` with an empty tool_input. */
  mcp(server: string, tool: string, env?: NodeJS.ProcessEnv): GateRun;
}

export function preToolUsePayload(root: string, toolName: unknown, toolInput: unknown, omitToolName = false): Record<string, unknown> {
  const sessionId = fakeSessionId("s7-gate");
  const payload: Record<string, unknown> = {
    session_id: sessionId,
    transcript_path: path.join(root, ".thoth", "test-fixtures", `${sessionId}-transcript.json`),
    cwd: root,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: `${sessionId}-tool-use`,
  };
  if (omitToolName) delete payload.tool_name;
  return payload;
}

export function createGateSandbox(): GateSandbox {
  templateDir ??= buildTemplate();
  const root = makeTempDir("gate-sandbox");
  fs.cpSync(templateDir, root, { recursive: true });
  const hookPath = path.join(root, HOOK_REL);
  const fixturePath = path.join(root, FIXTURE_REL);
  const projectPolicyPath = path.join(root, PROJECT_POLICY_REL);

  function run(payload: unknown, env: NodeJS.ProcessEnv = {}): GateRun {
    const input = typeof payload === "string" ? payload : JSON.stringify(payload);
    const result = spawnSync(process.execPath, [hookPath], {
      input,
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, ...env },
      timeout: 30_000,
      windowsHide: true,
    });
    const spawnError = result.error === undefined ? "" : `spawn error: ${String(result.error)}\n`;
    return { code: result.status, stdout: result.stdout ?? "", stderr: `${spawnError}${result.stderr ?? ""}` };
  }

  return {
    root,
    hookPath,
    fixturePath,
    projectPolicyPath,
    setEntries(entries) {
      this.editFixture((fixture) => {
        fixture.centralLayer.tools = entries;
      });
    },
    editFixture(mutate) {
      const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FixtureShape;
      mutate(fixture);
      fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    },
    writeProjectPolicy(policy) {
      fs.writeFileSync(projectPolicyPath, typeof policy === "string" ? policy : `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    },
    run,
    call(toolName, toolInput = {}, env = {}) {
      return run(preToolUsePayload(root, toolName, toolInput), env);
    },
    bash(command, env = {}) {
      return run(preToolUsePayload(root, "Bash", { command }), env);
    },
    mcp(server, tool, env = {}) {
      return run(preToolUsePayload(root, `mcp__${server}__${tool}`, {}), env);
    },
  };
}

/** A minimal second project tree (a fixture and an empty project policy) for the env-immunity
 * check (H12): it is what CLAUDE_PROJECT_DIR points at, and the gate must NOT read it. */
export function makeDecoyProjectTree(entries: FixtureEntry[]): string {
  const dir = makeTempDir("gate-decoy");
  fs.mkdirSync(path.join(dir, "docs", "qa"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".thoth"), { recursive: true });
  const fixture: FixtureShape = { version: "0.0.0-decoy", centralLayer: { tools: entries }, knownConnectors: [] };
  fs.writeFileSync(path.join(dir, FIXTURE_REL), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(dir, PROJECT_POLICY_REL), EMPTY_RULE_SET, "utf8");
  return dir;
}
