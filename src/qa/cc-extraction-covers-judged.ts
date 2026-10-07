// #452 (S7, k-blocker): K readiness row `CC-extraction-covers-judged`. Fails when the installed Claude Code's write-deny extraction and
// docs/qa/claude-code-write-deny-judgment.json disagree in EITHER direction, or when the installed version is not the judged one.
// Exit 0 PASS, 1 FAIL, 3 SKIPPED (no binary, THOTH_REQUIRE_CLAUDE unset). Under THOTH_REQUIRE_CLAUDE=1 absence is FAIL, never 3.
// The last stdout line is always `CC-extraction-covers-judged: <PASS|FAIL|SKIPPED> <detail>`. On FAIL the per-binary summary comes first
// (status, certified flag, remedy), then the census names that are not judged ONCE (not once per binary), then the other reasons.
import { checkExtraction, installedClaudeVersion, type CheckOptions } from "./claude-code-write-deny-extract.ts";

const CENSUS_REASON = /: extracted but not judged: census:(.+)$/;

export function runCli(env: NodeJS.ProcessEnv = process.env, versionProvider: (binary: string) => string = installedClaudeVersion, judgmentPath?: string, options?: CheckOptions): { code: number; line: string; details: string[] } {
  const r = checkExtraction(env, versionProvider, judgmentPath, options);
  const one = (b: (typeof r.binaries)[number]): string => {
    const c = b.counts;
    const counts = c === undefined ? "" : `, user ${String(c.extractedUser)}/${String(c.judgedUser)}, project ${String(c.extractedProject)}/${String(c.judgedProject)}`;
    const unprot = b.location === "unprotected" ? ` sha256=${b.sha256 ?? "unreadable"}${b.executed ? " [exec-opt-in]" : ` ${b.flag ?? ""}`}` : "";
    return `${b.path} (version ${b.version ?? "unknown"}${counts}) ${b.status} ${b.certified ? "certified" : "uncertified"}${b.remedy === undefined ? "" : ` -> ${b.remedy}`}${b.override ? " [override]" : ""}${unprot}`;
  };
  const checked = r.binaries.map(one).join("; ");
  const census = new Set<string>();
  const other: string[] = [];
  for (const reason of r.reasons) {
    const m = CENSUS_REASON.exec(reason);
    if (m === null) other.push(reason);
    else census.add(m[1]!);
  }
  const censusText = census.size === 0 ? "" : `census-unjudged (${String(census.size)}): ${[...census].sort().join(", ")}`;
  const details = [...other, ...(censusText === "" ? [] : [censusText])];
  let detail: string;
  if (r.status === "PASS") detail = `every installed binary's extraction equals the judgment${checked === "" ? "" : ` | checked: ${checked}`}`;
  else if (checked === "") detail = `reasons: ${r.reasons.join("; ")}`;
  else detail = ["checked: " + checked, ...(censusText === "" ? [] : [censusText]), ...(other.length === 0 ? [] : [`reasons: ${other.join("; ")}`])].join(" | ");
  return { code: r.status === "PASS" ? 0 : r.status === "FAIL" ? 1 : 3, line: `CC-extraction-covers-judged: ${r.status} ${detail}`, details };
}

if (process.argv[1]?.endsWith("cc-extraction-covers-judged.ts") === true) {
  const r = runCli();
  for (const d of r.details) console.log(`  ${d}`);
  console.log(r.line);
  process.exitCode = r.code;
}
