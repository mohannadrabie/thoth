// QA-02: "No policy rule may be added or changed without an accompanying fixture."
// Acceptance: "Enforced in the pipeline, not by review discipline." Diff-aware: looks at what
// actually changed between two refs, not the whole tree (that's QA-01's job).
import { fileURLToPath } from "node:url";
import type { PolicyFixture, PolicyRule } from "./policy-fixtures.ts";
import { discoverFixtures, discoverRules } from "./policy-fixtures.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";
import { makeGitOps, resolveChangedFiles } from "../lib/git.ts";
import { realRunner } from "../lib/exec.ts";

export function checkDiffFixtures(
  changedFiles: string[],
  policyRoot: string,
  rules: PolicyRule[],
  fixtures: PolicyFixture[],
): InstrumentResult {
  const prefix = policyRoot.endsWith("/") ? policyRoot : `${policyRoot}/`;
  const changedInPolicy = changedFiles.filter((f) => f === policyRoot || f.startsWith(prefix));

  const changedRuleFiles = changedInPolicy.filter((f) => f.endsWith(".rule.json"));
  const changedFixtureFiles = new Set(changedInPolicy.filter((f) => f.endsWith(".fixture.json")));

  if (changedRuleFiles.length === 0) {
    return {
      ok: true,
      vacuous: true,
      summary: "0 policy rule files changed in this diff — vacuous pass.",
      details: [],
    };
  }

  const ruleByFile = new Map(rules.map((r) => [r.file, r] as const));
  const fixturesByRuleId = new Map<string, PolicyFixture[]>();
  for (const f of fixtures) {
    const list = fixturesByRuleId.get(f.ruleId) ?? [];
    list.push(f);
    fixturesByRuleId.set(f.ruleId, list);
  }

  const missing: string[] = [];
  let checkedCount = 0;
  for (const relFile of changedRuleFiles) {
    // relFile is repo-relative (e.g. "policy/foo.rule.json"); rules are keyed by policyRoot-relative
    const ruleRelative = relFile.startsWith(prefix) ? relFile.slice(prefix.length) : relFile;
    const rule = ruleByFile.get(ruleRelative);
    if (!rule) continue; // deleted in this diff (no longer on disk) — no fixture requirement
    checkedCount++;
    const ruleFixtures = fixturesByRuleId.get(rule.id) ?? [];
    const fixtureChangedToo = ruleFixtures.some((f) => changedFixtureFiles.has(`${prefix}${f.file}`));
    if (!fixtureChangedToo) {
      missing.push(`${rule.id} (${relFile}) changed with no fixture change in the same diff`);
    }
  }

  if (checkedCount === 0) {
    return {
      ok: true,
      vacuous: true,
      summary: "Policy rule file(s) changed in this diff were all deletions — vacuous pass.",
      details: [],
    };
  }

  if (missing.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${missing.length} of ${checkedCount} changed policy rule(s) have no accompanying fixture change.`,
      details: missing,
    };
  }

  return {
    ok: true,
    vacuous: false,
    summary: `${checkedCount} changed policy rule(s), each with an accompanying fixture change.`,
    details: [],
  };
}

async function main(): Promise<void> {
  const policyRoot = process.env.QA02_POLICY_ROOT ?? "policy";
  const base = process.argv[2] ?? process.env.QA02_BASE_REF ?? "HEAD~1";
  const head = process.argv[3] ?? process.env.QA02_HEAD_REF ?? "HEAD";

  const git = makeGitOps(realRunner, process.cwd());
  const resolved = await resolveChangedFiles(git, base, head);
  if (resolved === null) {
    printInstrumentResult("QA-02 diff-fixture-check", {
      ok: true,
      vacuous: true,
      summary: `No diff available between ${base} and ${head} — vacuous pass.`,
      details: [],
    });
    process.exit(0);
  }
  if (resolved.fullTreeFallback) {
    console.log(
      `[QA-02 diff-fixture-check] NOTE: base "${base}" / head "${head}" included the zero-SHA sentinel ` +
        `(GitHub's github.event.before on a branch's first push or a history-discontinuous push) — ` +
        `falling back to a full-tree scan instead of a diff, not silently passing.`,
    );
  }
  const changedFiles = resolved.changedFiles;

  const rules = await discoverRules(policyRoot);
  const fixtures = await discoverFixtures(policyRoot);
  const result = checkDiffFixtures(changedFiles, policyRoot, rules, fixtures);
  printInstrumentResult("QA-02 diff-fixture-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
