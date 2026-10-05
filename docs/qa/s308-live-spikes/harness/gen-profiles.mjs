// Generates profiles/*.json and mcp/*.json for the spikes (absolute paths derived from this file's location).
import { execFileSync } from "node:child_process";
// Repo root: THOTH_REPO if set, else the git top-level of the current directory (run from inside the repo).
function repoRoot() {
  if (process.env.THOTH_REPO) return process.env.THOTH_REPO.replaceAll("\\", "/");
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("set THOTH_REPO to the repository root (the current directory is not inside it)");
  }
}
const REPO = repoRoot();
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..").replaceAll("\\", "/");
const REAL = `node "${REPO}/hooks/pretooluse-kernel-gate.mjs"`;
const LOG = (label) => `node "${ROOT}/harness/log-hook.mjs" ${label}`;
const TEE = (mode, label) => `node "${ROOT}/harness/tee-hook.mjs" --mode=${mode} --label=${label} -- node ${REPO}/hooks/pretooluse-kernel-gate.mjs`;
const h = (command, timeout) => ({ type: "command", command, ...(timeout ? { timeout } : {}) });
const pre = (matcher, ...hooks) => ({ hooks: { PreToolUse: [{ matcher, hooks }] } });
const withPost = (p, label) => ({ hooks: { ...p.hooks, PostToolUse: [{ matcher: ".*", hooks: [h(LOG(label))] }] } });
const profiles = {
  smoke: pre("Bash", h(LOG("smoke"))),
  "b1-direct": withPost(pre("Bash", h(REAL, 60), h(LOG("b1-direct"))), "b1-post"),
  "b1-tee": pre("Bash", h(TEE("pass", "b1-tee"), 60)),
  "b2-baseline": pre("Bash", h(REAL, 60), h(LOG("b2-baseline"))),
  "b2-close": pre("Bash", h(TEE("close-stdout", "b2-close"), 60)),
  "b2-control": pre("Bash", h(TEE("swallow", "b2-control"), 60)),
  b3: pre("mcp__.*", h(REAL, 60), h(LOG("b3"))),
  b4: { env: { SPIKE_ENV_PROBE: "from-settings-env" }, ...pre("Bash", h(LOG("b4")), h(REAL, 60)) },
  b4b: { env: { NODE_OPTIONS: "--spike-unknown-flag" }, ...pre("Bash", h(LOG("b4b")), h(REAL, 60)) },
  b5: pre("Bash", h(REAL, 60), h(LOG("b5"))),
  b6: pre("mcp__.*", h(REAL, 60), h(LOG("b6"))),
};
mkdirSync(join(ROOT, "profiles"), { recursive: true });
for (const [k, v] of Object.entries(profiles)) writeFileSync(join(ROOT, "profiles", `${k}.json`), JSON.stringify(v, null, 2));
// MCP configs: key = configured server name, tools = configured tool names.
const cases = {
  control: ["plain-srv", ["plain_tool"]],
  "srv-underscore": ["under_score", ["plain_tool"]],
  "srv-dot": ["odd.srv", ["plain_tool"]],
  "srv-space": ["sp ace", ["plain_tool"]],
  "srv-colon": ["co:lon", ["plain_tool"]],
  "srv-plus": ["plus+x", ["plain_tool"]],
  "srv-slash": ["slash/x", ["plain_tool"]],
  "srv-unicode": ["caf\u00e9", ["plain_tool"]],
  "srv-dunder": ["a__b", ["plain_tool"]],
  "tool-dot": ["plain-srv", ["do.it"]],
  "tool-space": ["plain-srv", ["sp ace"]],
  "tool-colon": ["plain-srv", ["co:lon"]],
  "tool-slash": ["plain-srv", ["slash/x"]],
  "tool-unicode": ["plain-srv", ["caf\u00e9"]],
  "tool-long": ["plain-srv", ["t".repeat(65)]],
};
const entry = (key, tools) => ({ command: "node", args: [`${ROOT}/harness/odd-mcp.mjs`, key], env: { SPIKE_TOOLS: JSON.stringify(tools) } });
mkdirSync(join(ROOT, "mcp"), { recursive: true });
for (const [k, [key, tools]] of Object.entries(cases)) writeFileSync(join(ROOT, "mcp", `${k}.json`), JSON.stringify({ mcpServers: { [key]: entry(key, tools) } }, null, 2));
// Combined session: each case under a distinct config key; tools per case (server cases use plain_tool).
const combined = {};
for (const [k, [key, tools]] of Object.entries(cases)) {
  if (k.startsWith("srv-") || k === "control") combined[key] = entry(key, tools);
}
combined["tool-cases"] = entry("tool-cases", ["do.it", "sp ace", "co:lon", "slash/x", "caf\u00e9", "t".repeat(65)]);
writeFileSync(join(ROOT, "mcp", "combined.json"), JSON.stringify({ mcpServers: combined }, null, 2));
console.log("generated", Object.keys(profiles).length, "profiles,", Object.keys(cases).length + 1, "mcp configs");
