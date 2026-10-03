// Prints the observation-relevant events of a raw run: tool_use, hook events, tool_result, final text.
import { readFileSync } from "node:fs";
const id = process.argv[2];
const ev = readFileSync(new URL(`../raw/${id}.stream.jsonl`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));
for (const j of ev) {
  if (j.type === "system" && j.subtype === "init") console.log("INIT tools:", JSON.stringify(j.tools.filter((t) => t.startsWith("mcp__") && !t.startsWith("mcp__claude_ai_"))), "mcp_servers:", JSON.stringify((j.mcp_servers ?? []).filter((s) => !s.name.startsWith("claude.ai"))));
  else if (j.type === "system" && j.subtype?.startsWith("hook_")) console.log("HOOK", j.subtype, j.hook_name, j.exit_code ?? "", j.outcome ?? "", JSON.stringify(j.stdout ?? "").slice(0, 160), JSON.stringify(j.stderr ?? "").slice(0, 120), Object.keys(j).filter((k) => /time|ms|dur/i.test(k)).map((k) => `${k}=${j[k]}`).join(","));
  else if (j.type === "assistant") for (const c of j.message.content) { if (c.type === "tool_use") console.log("TOOL_USE", c.name, JSON.stringify(c.input).slice(0, 120)); else if (c.type === "text") console.log("TEXT", c.text.slice(0, 100)); }
  else if (j.type === "user") for (const c of j.message.content ?? []) if (c.type === "tool_result") console.log("TOOL_RESULT len=" + String(typeof c.content === "string" ? c.content : JSON.stringify(c.content)).length, "is_error=" + c.is_error, JSON.stringify(c.content).slice(0, 700));
  else if (j.type === "result") console.log("RESULT", j.subtype, "cost", j.total_cost_usd, "turns", j.num_turns);
}
