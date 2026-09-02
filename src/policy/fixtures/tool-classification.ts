// In-memory ToolClassificationSet fixtures (S3 scope: pure fixtures only, per the 2026-09-01
// S3-intake ruling — no config-file I/O; real central-config loading stays S6's job). Used by
// src/policy/rule/precedence.test.ts and src/policy/tools/classification.test.ts.
import type { ToolClassificationSet } from "../tools/classification.ts";

export const shippedToolClassificationLayer: ToolClassificationSet = {
  version: "1.0.0",
  tools: [
    { name: "Read", class: "read-only" },
    { name: "Bash", class: "workspace-mutating" },
    { name: "cluster", class: "remote-mutating" },
  ],
};

/** T5 conflict case: "Bash" is reclassified by the central layer — central wins. */
export const centralToolClassificationLayer: ToolClassificationSet = {
  version: "1.1.0",
  tools: [{ name: "Bash", class: "remote-mutating" }],
};

export const emptyToolClassificationSet: ToolClassificationSet = { version: "0.0.0", tools: [] };

/** SUR-03 acceptance fixture: a session tool list with ONE deliberately unclassified tool
 * ("UnknownMcpTool") alongside two tools the merged catalog above does classify. */
export const sessionToolsWithOneUnclassified: readonly string[] = ["Read", "Bash", "UnknownMcpTool"];

export const sessionToolsAllClassified: readonly string[] = ["Read", "Bash", "cluster"];
