// Generates profiles/*.json, mcp/*.json and scratch support files for the J live runs (story J, #308).
// Repo root: THOTH_REPO. Scratch root: this file's parent's parent. Fixture names are READ from the fixture, never typed.
import { writeFileSync, mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const REPO = process.env.THOTH_REPO.replaceAll("\\", "/");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..").replaceAll("\\", "/");
const LAUNCHER = `${REPO}/hooks/launch-gate.sh`;
const GATE = `${REPO}/hooks/pretooluse-kernel-gate.mjs`;
const SHELL_FORM = `sh "${LAUNCHER}" "${GATE}"`;
const LOG = (label) => `node "${ROOT}/harness/log-hook.mjs" ${label}`;
const h = (command, timeout, args) => ({ type: "command", command, ...(args ? { args } : {}), ...(timeout ? { timeout } : {}) });
const entry = (gateHook, label) => [
  { matcher: "Bash", hooks: [gateHook, h(LOG(label))] },
  { matcher: "mcp__.*", hooks: [gateHook, h(LOG(label))] },
];
const gated = (label, extra = {}) => ({ ...extra, hooks: { PreToolUse: entry(h(SHELL_FORM, 60), label) } });
const logOnly = (label, extra = {}) => ({ ...extra, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [h(LOG(label))] }] } });

const fixture = JSON.parse(readFileSync(`${REPO}/docs/qa/s5-central-classification.json`, "utf8"));
const CLASSIFIED = fixture.centralLayer.tools.map((t) => t.name).find((n) => /^[A-Za-z0-9-]+$/.test(n));

// J8 keys: [id, env]
const envKeys = {
  shellprefix: { CLAUDE_CODE_SHELL_PREFIX: "true" },
  shelloptsnoexec: { SHELLOPTS: "noexec" },
  bashfunc: { "BASH_FUNC_echo%%": "() { printf HIJACKED; }" },
  bashenv: { BASH_ENV: `${ROOT}/support/bashenv.sh` },
  msys: { MSYS: "noglob" },
  gitbash: { CLAUDE_CODE_GIT_BASH_PATH: `${ROOT}/support/nonexistent/bash.exe` },
  nodeopts: { NODE_OPTIONS: "--spike-unknown-flag" },
  gitdiff: { GIT_EXTERNAL_DIFF: `${ROOT}/support/diffprobe.sh` },
  rg: { RIPGREP_CONFIG_PATH: `${ROOT}/support/rgconfig` },
};
const profiles = {
  j3: gated("j3"),
  j9shell: gated("j9shell"),
  j9args: { hooks: { PreToolUse: entry(h("sh", 60, [LAUNCHER, GATE]), "j9args") } },
  "j9args-shellprefix": { env: envKeys.shellprefix, hooks: { PreToolUse: entry(h("sh", 60, [LAUNCHER, GATE]), "j9args-shellprefix") } },
  "j9args-shelloptsnoexec": { env: envKeys.shelloptsnoexec, hooks: { PreToolUse: entry(h("sh", 60, [LAUNCHER, GATE]), "j9args-shelloptsnoexec") } },
  // J5: permissions.deny Edit(...) on the scratch fixture copy (project-root-relative form), and a wrong-case rule.
  j5control: { permissions: { allow: [] } },
  j5deny: { permissions: { deny: ["Edit(/docs/qa/s5-central-classification.json)"] } },
  j5case: { permissions: { deny: ["Edit(/Docs/QA/S5-Central-Classification.JSON)"] } },
};
for (const [k, env] of Object.entries(envKeys)) {
  profiles[`j8-${k}`] = gated(`j8-${k}`, { env });
  profiles[`j8c-${k}`] = logOnly(`j8c-${k}`, { env });
}
mkdirSync(join(ROOT, "profiles"), { recursive: true });
for (const [k, v] of Object.entries(profiles)) writeFileSync(join(ROOT, "profiles", `${k}.json`), JSON.stringify(v, null, 2));

const srv = (name) => ({ command: "node", args: [`${ROOT}/harness/odd-mcp.mjs`, name], env: { SPIKE_TOOLS: JSON.stringify(["plain_tool"]) } });
mkdirSync(join(ROOT, "mcp"), { recursive: true });
writeFileSync(join(ROOT, "mcp", "none.json"), JSON.stringify({ mcpServers: {} }));
writeFileSync(join(ROOT, "mcp", "classified.json"), JSON.stringify({ mcpServers: { [CLASSIFIED]: srv(CLASSIFIED) } }, null, 2));
writeFileSync(join(ROOT, "mcp", "unlisted.json"), JSON.stringify({ mcpServers: { "plain-srv": srv("plain-srv") } }, null, 2));

mkdirSync(join(ROOT, "support"), { recursive: true });
writeFileSync(join(ROOT, "support", "bashenv.sh"), "echo BASHENV-RAN\n");
writeFileSync(join(ROOT, "support", "diffprobe.sh"), "#!/bin/sh\necho DIFFPROBE-RAN >> \"$(dirname \"$0\")/diffprobe.log\"\n");
writeFileSync(join(ROOT, "support", "rgconfig"), "--max-count=1\n");
mkdirSync(join(ROOT, "docs", "qa"), { recursive: true });
copyFileSync(`${REPO}/docs/qa/s5-central-classification.json`, join(ROOT, "docs", "qa", "s5-central-classification.json.orig"));
console.log(JSON.stringify({ classified: CLASSIFIED, profiles: Object.keys(profiles).length }));
