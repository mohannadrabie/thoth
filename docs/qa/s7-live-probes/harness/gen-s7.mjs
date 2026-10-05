// Generates profiles/*.json, mcp/none.json, the P2 scratch home dummy settings file, and the P3 fixture copy.
// GATE_WT: a detached worktree of origin/master hosting the gate (never the repo's working dir).
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const WT = process.env.GATE_WT.replaceAll("\\", "/");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..").replaceAll("\\", "/");
const LAUNCHER = `${WT}/hooks/launch-gate.sh`;
const GATE = `${WT}/hooks/pretooluse-kernel-gate.mjs`;
const SHELL_FORM = `sh "${LAUNCHER}" "${GATE}"`; // K shell form
const LOG = (label) => `node "${ROOT}/harness/log-hook.mjs" ${label}`;
const h = (command, timeout) => ({ type: "command", command, ...(timeout ? { timeout } : {}) });
// P1: the K matcher with the gate plus the logger; Task/Agent get the logger ONLY (the gate refuses any tool
// name other than Bash and mcp__, so gating Task would stop the subagent from starting).
const p1 = (label) => ({
  hooks: {
    PreToolUse: [
      { matcher: "Bash|PowerShell|mcp__.*", hooks: [h(SHELL_FORM, 60), h(LOG(label))] },
      { matcher: "Task|Agent", hooks: [h(LOG(label))] },
    ],
  },
});
const profiles = {
  "p1-sub-r1": p1("p1-sub-r1"),
  "p1-sub-r2": p1("p1-sub-r2"),
  "p1-sub-r3": p1("p1-sub-r3"),
  "p1-main-ctl": p1("p1-main-ctl"),
  // P2: user-scope settings file deny (tilde form), and a control without the rule.
  p2control: { permissions: { allow: [] } },
  p2deny: { permissions: { deny: ["Edit(~/.claude/settings.json)"] } },
  // P3: deny for an UNRELATED file in the same directory (negative control), and J5's wrong-case rule again.
  p3unrelated: { permissions: { deny: ["Edit(/docs/qa/unrelated-file.json)"] } },
  p3case: { permissions: { deny: ["Edit(/Docs/QA/S5-Central-Classification.JSON)"] } },
};
mkdirSync(join(ROOT, "profiles"), { recursive: true });
for (const [k, v] of Object.entries(profiles)) writeFileSync(join(ROOT, "profiles", `${k}.json`), JSON.stringify(v, null, 2));
mkdirSync(join(ROOT, "mcp"), { recursive: true });
writeFileSync(join(ROOT, "mcp", "none.json"), JSON.stringify({ mcpServers: {} }));
// P2 dummy (fresh content, never a copy of a real settings file).
const HOME = join(ROOT, "..", "home").replaceAll("\\", "/");
mkdirSync(join(HOME, ".claude"), { recursive: true });
const dummy = JSON.stringify({ $comment: "s7 P2 dummy user settings (scratch)", env: { S7_DUMMY: "original" } }, null, 2) + "\n";
writeFileSync(join(HOME, ".claude", "settings.json.orig"), dummy);
writeFileSync(join(HOME, ".claude", "settings.json"), dummy);
// P3 fixture copy from the worktree (origin/master).
mkdirSync(join(ROOT, "docs", "qa"), { recursive: true });
copyFileSync(`${WT}/docs/qa/s5-central-classification.json`, join(ROOT, "docs", "qa", "s5-central-classification.json.orig"));
copyFileSync(`${WT}/docs/qa/s5-central-classification.json`, join(ROOT, "docs", "qa", "s5-central-classification.json"));
console.log(JSON.stringify({ profiles: Object.keys(profiles) }));
