// #308 story E0 (Issue #408), criteria 13 and 15: the closed read-only set through the REAL copied hook (registry-pinned
// copy-tree sandbox, hooks/test-support/gate-sandbox.ts; empty rules and default allow, so every outcome below comes from
// the normalizer and POL-05, not from a shipped rule), plus the shipped deny rules in-process for the protected-path
// interaction. Written failing first by story-implementer. Plan: docs/plans/s308-E0-readonly-shell-plan-2026-10-05.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGateSandbox, describeRun, isSilentAllow, wasPolicyDenied, type GateSandbox } from "./test-support/gate-sandbox.ts";
import { decide } from "../src/policy/kernel/kernel.ts";
import type { Rule } from "../src/policy/kernel/rule-types.ts";
import { normalize } from "../src/policy/normalizer/registry.ts";
import "../src/policy/normalizer/shell.ts";
import { ACCEPT_ROWS, DENY_ROWS } from "../src/policy/fixtures/readonly-corpus.ts";

let sandbox: GateSandbox | undefined;
const sb = (): GateSandbox => (sandbox ??= createGateSandbox());

const HEADLINE = ["ls -la", "cat README.md", "grep -rn foo src", "head -n 20 README.md", "tail -n 5 CHANGELOG.md", "wc -l README.md"];

for (const command of HEADLINE) {
  test(`RO-e2e-allow-headline: ${command}`, () => {
    const run = sb().bash(command);
    assert.ok(isSilentAllow(run), describeRun(run));
  });
}

for (const row of ACCEPT_ROWS) {
  test(`RO-e2e-allow: ${row.command}`, () => {
    const run = sb().bash(row.command);
    assert.ok(isSilentAllow(run), describeRun(run));
  });
}

test("RO-e2e-git-status-still-deny: git status stays denied by POL-05 until #409 seals the config and env levers", () => {
  const run = sb().bash("git status");
  assert.ok(wasPolicyDenied(run), describeRun(run));
  assert.match(run.stdout, /POL-05/);
});

test("RO-e2e-corpus-deny: every corpus deny row is a strict policy deny through the real hook", () => {
  const failures: string[] = [];
  for (const row of DENY_ROWS) {
    const run = sb().bash(row.command);
    if (!wasPolicyDenied(run)) failures.push(`[${row.group}] ${JSON.stringify(row.command)} -> ${describeRun(run)}`);
  }
  console.log(`RO-e2e-corpus-deny: ${String(DENY_ROWS.length)} rows, ${String(failures.length)} not denied`);
  assert.deepEqual(failures, []);
});

// --- Criterion 15: reads of protected paths are allowed, every write form is not ---------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const shipped = (): Rule[] => (JSON.parse(readFileSync(`${REPO_ROOT}src/policy/config/shipped-defaults.json`, "utf8")) as { rules: Rule[] }).rules;
const world = () => ({ rules: { version: "0.0.0-test", rules: shipped() }, defaultOutcome: "allow" as const });
const decideCommand = (command: string) => decide(world(), normalize("shell", { command, environment: "e", identity: "i", deferred: false }));

const PROTECTED = [".thoth/policy.json", "src/policy/config/shipped-defaults.json", "docs/qa/s5-central-classification.json", "hooks/pretooluse-kernel-gate.mjs"];

test("RO-protected-read-allowed: cat and grep of each protected path resolve to a read of that path and the shipped deny rules allow it", () => {
  for (const p of PROTECTED) {
    for (const command of [`cat ${p}`, `grep -n x ${p}`, `head -n 5 ${p}`, `wc -l ${p}`]) {
      const record = normalize("shell", { command, environment: "e", identity: "i", deferred: false });
      assert.deepEqual(record.targets, [p.toLowerCase()], command);
      assert.equal(decide(world(), record).outcome, "allow", command);
    }
  }
});

test("RO-protected-write-denied: every write form to a protected path stays denied (E0 turned none into an allow)", () => {
  for (const p of PROTECTED) {
    for (const command of [`echo x > ${p}`, `cat a >> ${p}`, `ls > ${p}`, `cat a b > ${p}`, `cat README.md > ${p}`, `grep x f > ${p}`]) {
      assert.equal(decideCommand(command).outcome, "deny", command);
    }
  }
});

test("RO-unc-operand-unresolved (Issue #436): UNC operands are a strict policy deny through the real hook", () => {
  for (const command of ["cat //h/s/x", "ls //h/s", "grep -r p //h/s", "head -n 1 //h/s/x", "tail -n 1 //h/s/x", "wc -l //h/s/x", String.raw`cat \\h\s\x`]) {
    const run = sb().bash(command);
    assert.ok(wasPolicyDenied(run), `${command}: ${describeRun(run)}`);
  }
});
