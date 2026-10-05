// #429 / #424 (S7): the per-tool exec judgment (docs/qa/tool-exec-judgment.json), its validator, and the values derived
// from it (the K matcher, the residual list). Pure helpers: tests run mutants on in-memory copies.
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Judgment = "exec-routed" | "exec-residual" | "not-exec";
export type ResidualCondition = "inner-calls-gated" | "none" | "authorable-content-protected";

export interface JudgmentEntry {
  tool: string;
  judgment: Judgment;
  reason: string;
  residualCondition?: ResidualCondition;
  /** A call-time name of another judged tool; the entry need not be vendored. */
  aliasOf?: string;
  evidence?: string;
}
export interface JudgmentFile {
  version: string;
  note?: string;
  judgments: JudgmentEntry[];
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const JUDGMENT_PATH = `${ROOT}docs/qa/tool-exec-judgment.json`;
const JUDGMENTS: readonly string[] = ["exec-routed", "exec-residual", "not-exec"];
const CONDITIONS: readonly string[] = ["inner-calls-gated", "none", "authorable-content-protected"];

/** Names one tool answers to: [name in the init list / inventory, name at call time]. Both must be judged (live probe P1:
 * the subagent tool is Task in the init list and Agent in the PreToolUse payload). */
export const ALIAS_PAIRS: ReadonlyArray<readonly [string, string]> = [["Task", "Agent"]];

/** Protected named-list entries each residual condition depends on (the instrument for that condition). */
export const REQUIRED_PROTECTED_ENTRIES: Readonly<Record<"authorable-content-protected", readonly string[]>> = {
  "authorable-content-protected": [".claude/commands/", ".claude/skills/", ".claude/agents/", "~/.claude/commands/", "~/.claude/skills/", "~/.claude/agents/", "~/.claude/plugins/"],
};

export function loadJudgments(): JudgmentFile {
  return JSON.parse(readFileSync(JUDGMENT_PATH, "utf8")) as JudgmentFile;
}

/** One line per problem; empty when every vendored tool has exactly one valid judgment and nothing else is judged. */
export function checkJudgments(file: JudgmentFile, vendored: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const vendoredSet = new Set(vendored);
  for (const j of file.judgments) {
    if (seen.has(j.tool)) out.push(`duplicate judgment for ${j.tool}`);
    seen.add(j.tool);
    if (!JUDGMENTS.includes(j.judgment)) out.push(`${j.tool}: unknown judgment ${JSON.stringify(j.judgment)}`);
    if (typeof j.reason !== "string" || j.reason.trim() === "") out.push(`${j.tool}: empty reason`);
    if (j.judgment === "exec-residual" && !CONDITIONS.includes(j.residualCondition ?? "")) out.push(`${j.tool}: exec-residual needs a known residualCondition`);
    if (j.judgment !== "exec-residual" && j.residualCondition !== undefined) out.push(`${j.tool}: residualCondition is only for exec-residual`);
    if (j.aliasOf !== undefined) {
      const target = file.judgments.find((t) => t.tool === j.aliasOf);
      if (target === undefined || !vendoredSet.has(target.tool)) out.push(`${j.tool}: aliasOf ${j.aliasOf} is not a judged vendored tool`);
      else if (target.judgment !== j.judgment || target.residualCondition !== j.residualCondition) out.push(`${j.tool}: alias judgment differs from ${j.aliasOf}`);
      if (j.evidence === undefined || j.evidence.trim() === "") out.push(`${j.tool}: an alias needs evidence`);
    } else if (!vendoredSet.has(j.tool)) out.push(`${j.tool}: judged but not in the vendored inventory (dead entry)`);
  }
  for (const t of vendored) if (!seen.has(t)) out.push(`${t}: vendored but has no judgment`);
  for (const [vendoredName, callTimeName] of ALIAS_PAIRS) {
    const alias = file.judgments.find((j) => j.tool === callTimeName);
    if (!seen.has(vendoredName)) out.push(`alias pair: ${vendoredName} has no judgment`);
    if (alias === undefined) out.push(`alias pair: ${callTimeName} (call-time name of ${vendoredName}) has no judgment`);
    else if (alias.aliasOf !== vendoredName) out.push(`alias pair: ${callTimeName} must be aliasOf ${vendoredName}`);
  }
  return out;
}

export const routedTools = (file: JudgmentFile): string[] => file.judgments.filter((j) => j.judgment === "exec-routed").map((j) => j.tool);
export const residualEntries = (file: JudgmentFile): JudgmentEntry[] => file.judgments.filter((j) => j.judgment === "exec-residual");

/** The K matcher: the exec-routed tools, sorted, then the MCP pattern token. */
export function deriveMatcher(file: JudgmentFile): string {
  return [...routedTools(file).sort(), "mcp__.*"].join("|");
}

const NESTED_NAMES: ReadonlySet<string> = new Set(["skills", "commands", "agents"]);

/** Read-only enumerator (#449): existing nested .claude/{skills,commands,agents} directories below the root (root-level
 * ones are protected by name; node_modules and .git are skipped). A kernel target is exact or a trailing-/ prefix, so a
 * nested directory cannot be one rule; K activation reviews this list. Sorted, project-relative, forward slashes. */
export function findNestedSkillDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name === ".git") continue;
      const child = rel === "" ? e.name : `${rel}/${e.name}`;
      if (rel.endsWith(".claude") && NESTED_NAMES.has(e.name) && rel !== ".claude") out.push(child);
      walk(child);
    }
  };
  walk("");
  return out.sort();
}
