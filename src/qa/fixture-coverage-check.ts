// QA-01: "Every policy rule shall have at least one positive and one negative fixture."
// Acceptance: "Coverage check fails the build when a rule has none." A real gate — this is meant
// to run in CI (see .github/workflows/ci.yml), not left to review discipline.
import { fileURLToPath } from "node:url";
import type { PolicyFixture, PolicyRule } from "./policy-fixtures.ts";
import { discoverFixtures, discoverRules } from "./policy-fixtures.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export function checkCoverage(rules: PolicyRule[], fixtures: PolicyFixture[]): InstrumentResult {
  if (rules.length === 0) {
    return {
      ok: true,
      vacuous: true,
      summary: "0 policy rules found under policy/ — vacuous pass (no rules exist yet).",
      details: [],
    };
  }

  const positiveByRule = new Set(
    fixtures.filter((f) => f.kind === "positive").map((f) => f.ruleId),
  );
  const negativeByRule = new Set(
    fixtures.filter((f) => f.kind === "negative").map((f) => f.ruleId),
  );

  const missing: string[] = [];
  for (const rule of rules) {
    const hasPositive = positiveByRule.has(rule.id);
    const hasNegative = negativeByRule.has(rule.id);
    if (!hasPositive || !hasNegative) {
      const missingKinds = [
        !hasPositive ? "positive" : null,
        !hasNegative ? "negative" : null,
      ].filter((k): k is string => k !== null);
      missing.push(`${rule.id} (${rule.file}) — missing ${missingKinds.join(" and ")} fixture`);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${missing.length} of ${rules.length} policy rule(s) missing required fixture coverage.`,
      details: missing,
    };
  }

  return {
    ok: true,
    vacuous: false,
    summary: `${rules.length} policy rule(s), all with at least one positive and one negative fixture.`,
    details: [],
  };
}

async function main(): Promise<void> {
  const policyRoot = process.argv[2] ?? "policy";
  const rules = await discoverRules(policyRoot);
  const fixtures = await discoverFixtures(policyRoot);
  const result = checkCoverage(rules, fixtures);
  printInstrumentResult("QA-01 fixture-coverage-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
