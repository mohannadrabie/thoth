// #452 (S7, k-blocker): K readiness row `CC-extraction-covers-judged`. Fails when the installed Claude Code's write-deny extraction and
// docs/qa/claude-code-write-deny-judgment.json disagree in EITHER direction, or when the installed version is not the judged one.
// Exit 0 PASS, 1 FAIL, 3 SKIPPED (no binary, THOTH_REQUIRE_CLAUDE unset). Under THOTH_REQUIRE_CLAUDE=1 absence is FAIL, never 3.
// The last stdout line is always `CC-extraction-covers-judged: <PASS|FAIL|SKIPPED> <detail>`.
import { checkExtraction, installedClaudeVersion } from "./claude-code-write-deny-extract.ts";

export function runCli(env: NodeJS.ProcessEnv = process.env, versionProvider: (binary: string) => string = installedClaudeVersion, judgmentPath?: string): { code: number; line: string; details: string[] } {
  const r = checkExtraction(env, versionProvider, judgmentPath);
  const one = (b: (typeof r.binaries)[number]): string => {
    const c = b.counts;
    const counts = c === undefined ? "" : `, user ${String(c.extractedUser)}/${String(c.judgedUser)}, project ${String(c.extractedProject)}/${String(c.judgedProject)}`;
    return `${b.path} (version ${b.version ?? "unknown"}${counts}) ${b.status}${b.override ? " [override]" : ""}`;
  };
  const checked = r.binaries.map(one).join("; ");
  const suffix = checked === "" ? "" : ` | checked: ${checked}`;
  const detail = r.status === "PASS" ? `every installed binary's extraction equals the judgment${suffix}` : `${r.reasons.join("; ")}${suffix}`;
  return { code: r.status === "PASS" ? 0 : r.status === "FAIL" ? 1 : 3, line: `CC-extraction-covers-judged: ${r.status} ${detail}`, details: r.reasons };
}

if (process.argv[1]?.endsWith("cc-extraction-covers-judged.ts") === true) {
  const r = runCli();
  for (const d of r.details) console.log(`  ${d}`);
  console.log(r.line);
  process.exitCode = r.code;
}
