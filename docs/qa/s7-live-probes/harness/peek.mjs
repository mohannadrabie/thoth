// Quick local summary of one run's stream (not evidence; evidence is built by scrub-s7.mjs).
import { readFileSync } from "node:fs";
for (const l of readFileSync(`raw/${process.argv[2]}.stream.jsonl`, "utf8").trim().split("\n")) {
  const j = JSON.parse(l);
  const p = j.parent_tool_use_id ? ` [in subagent of ${j.parent_tool_use_id.slice(-6)}]` : "";
  if (j.type === "system" && /hook/.test(j.subtype)) console.log(j.subtype, j.hook_name, j.exit_code ?? "", (j.stdout || "").slice(0, 160), (j.stderr || "").slice(0, 160));
  else if (j.type === "assistant") for (const c of j.message.content) { if (c.type === "tool_use") console.log("tool_use", c.id.slice(-6), c.name, JSON.stringify(c.input).slice(0, 160) + p); if (c.type === "text") console.log("text", JSON.stringify(c.text.slice(0, 300)) + p); }
  else if (j.type === "user") for (const c of j.message.content ?? []) { if (c.type === "tool_result") console.log("tool_result", c.tool_use_id.slice(-6), c.is_error ?? "", JSON.stringify(c.content).slice(0, 220) + p); }
  else if (j.type === "result") console.log("RESULT", j.subtype, j.total_cost_usd);
  else if (j.type === "system" && j.subtype !== "init") console.log("system", j.subtype);
}
