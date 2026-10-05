// Tiny stdio MCP server (newline-delimited JSON-RPC). Server name = argv[2]; tools = JSON array in SPIKE_TOOLS.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2] ?? "odd";
const tools = JSON.parse(process.env.SPIKE_TOOLS ?? "[]");
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.id === undefined) return;
  if (m.method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id: m.id,
      result: {
        protocolVersion: m.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name, version: "0.0.0" },
      },
    });
  }
  if (m.method === "ping") return send({ jsonrpc: "2.0", id: m.id, result: {} });
  if (m.method === "tools/list") {
    return send({
      jsonrpc: "2.0",
      id: m.id,
      result: {
        tools: tools.map((t) => ({ name: t, description: `spike tool ${t}`, inputSchema: { type: "object", properties: {} } })),
      },
    });
  }
  if (m.method === "tools/call") {
    mkdirSync(join(ROOT, "logs"), { recursive: true });
    appendFileSync(join(ROOT, "logs", "mcp-calls.jsonl"), JSON.stringify({ server: name, tool: m.params?.name }) + "\n");
    return send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `spike-ok ${m.params?.name}` }] } });
  }
  send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "method not found" } });
});
