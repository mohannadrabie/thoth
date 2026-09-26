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
// Not probed here, recorded with their AP: an input-size timeout (Issue #304) needs a 100 KB
// command and a 60 s ceiling; it belongs to that issue's own story.
import { spawnSync } from "node:child_process";
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  /** False when the path is recorded but not probed here. */
  probed: boolean;
  /** The activation precondition that closes a PROCEEDS path (required for PROCEEDS rows). */
  ap?: string;
  note: string;
}

export const RECORDED_DECISIONS: readonly RecordedDecision[] = [
  { id: "node-without-ts-type-stripping", expect: "PROCEEDS", probed: true, ap: "AP-13", note: "old or unflagged Node: the module graph fails to load, exit 1, non-blocking (Issue #303)" },
  { id: "import-target-missing", expect: "PROCEEDS", probed: true, ap: "AP-13", note: "a static import target is missing or renamed: exit 1, non-blocking (Issue #303)" },
  { id: "interpreter-not-on-path", expect: "PROCEEDS", probed: true, ap: "AP-13", note: "the command cannot start: shell exit 127 or 1, non-blocking (Issue #303)" },
  { id: "empty-stdin", expect: "BLOCKS", probed: true, note: "exit 2 with stderr" },
  { id: "invalid-json-stdin", expect: "BLOCKS", probed: true, note: "exit 2 with stderr" },
  { id: "numeric-tool-name", expect: "BLOCKS", probed: true, note: "malformed input: deny JSON" },
  { id: "unroutable-tool-name", expect: "BLOCKS", probed: true, note: "pre-kernel refusal: deny JSON" },
  { id: "unclassified-mcp-tool", expect: "BLOCKS", probed: true, note: "POL-05 deny" },
  { id: "corrupt-project-policy", expect: "BLOCKS", probed: true, note: "load failure: deny JSON (layer and kind only)" },
  { id: "input-size-timeout", expect: "PROCEEDS", probed: false, ap: "AP-14", note: "quadratic redirect scan; a timed-out hook proceeds (Issue #304); not probed here" },
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
function run(command: string, args: string[], input: string, cwd: string, shell: boolean): Spawned {
  const r = spawnSync(command, args, { input, encoding: "utf8", cwd, shell, timeout: 30_000, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
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

    record("interpreter-not-on-path", run(`thoth-no-such-interpreter "${hook}"`, [], BASH_PAYLOAD, good, true));
    record("empty-stdin", run(process.execPath, [hook], "", good, false));
    record("invalid-json-stdin", run(process.execPath, [hook], "{ not json at all", good, false));
    record("numeric-tool-name", run(process.execPath, [hook], payload(12345), good, false));
    record("unroutable-tool-name", run(process.execPath, [hook], payload("Write", { file_path: "a", content: "b" }), good, false));
    record("unclassified-mcp-tool", run(process.execPath, [hook], payload("mcp__nosuchserver__x"), good, false));

    const corrupt = join(root, "corrupt");
    copyTree(repoRoot, corrupt);
    writeFileSync(join(corrupt, ".thoth", "policy.json"), "{ \"version\": \"v\", \"rules\": [ BROKEN ] }", "utf8");
    record("corrupt-project-policy", run(process.execPath, [join(corrupt, "hooks", "pretooluse-kernel-gate.mjs")], BASH_PAYLOAD, corrupt, false));
    return results;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
