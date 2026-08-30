// Shared discovery for QA-01 (fixture-coverage-check) and QA-02 (diff-fixture-check).
//
// Convention (provisional — S1 builds the checking mechanism only; S2+ owns the real policy
// authoring format per ADR-0021 and may supersede this file-shape. Documented here, not guessed
// past, per PRINCIPLES.md rule 18):
//   - A policy rule declaration is any `*.rule.json` file under `policy/`, shape
//     `{ "id": string, "description"?: string }`.
//   - A fixture is any `*.fixture.json` file under `policy/`, shape
//     `{ "ruleId": string, "kind": "positive" | "negative", "description"?: string }`.
// Neither directory exists in this repo yet (kernel/policy land in S2+), so both checks below
// operate in "0 found" mode today — disclosed loudly via `vacuous: true`, never silently green.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listFilesRecursive } from "../lib/fs-walk.ts";

export interface PolicyRule {
  id: string;
  file: string;
}

export interface PolicyFixture {
  ruleId: string;
  kind: "positive" | "negative";
  file: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export async function discoverRules(policyRoot: string): Promise<PolicyRule[]> {
  const files = await listFilesRecursive(policyRoot, (p) => p.endsWith(".rule.json"));
  const rules: PolicyRule[] = [];
  for (const file of files) {
    const raw = await readFile(join(policyRoot, file), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.id === "string" && parsed.id.length > 0) {
      rules.push({ id: parsed.id, file });
    }
  }
  return rules;
}

export async function discoverFixtures(policyRoot: string): Promise<PolicyFixture[]> {
  const files = await listFilesRecursive(policyRoot, (p) => p.endsWith(".fixture.json"));
  const fixtures: PolicyFixture[] = [];
  for (const file of files) {
    const raw = await readFile(join(policyRoot, file), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      isRecord(parsed) &&
      typeof parsed.ruleId === "string" &&
      (parsed.kind === "positive" || parsed.kind === "negative")
    ) {
      fixtures.push({ ruleId: parsed.ruleId, kind: parsed.kind, file });
    }
  }
  return fixtures;
}
