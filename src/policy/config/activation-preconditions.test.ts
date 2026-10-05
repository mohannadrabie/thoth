// #308 story F (AP-10): `activation-preconditions` -- every path that decides or wires the gate is matched by a
// deny rule in the shipped activation policy. story-implementer's own tests, written FAILING FIRST
// (plan docs/plans/s308-activation-EFJ-plan-2026-10-04.md section 7). THOTH-ADR-0003 hold: F ships only after
// the human accepts it.
//
// WHAT THE RULES CAN AND CANNOT DO (disclosed, read before relying on this file):
//  - The protected list is GENERATED (hook import graph, scanned by the same algorithm as
//    hook-import-pins.test.ts, a parallel implementation) plus a NAMED list; the committed rule data is compared
//    with the generator's output, so a stale list fails. Nothing is hand-counted.
//  - Since F8 (Issue #411) a shell redirect never makes a command resolve, so POL-05 denies every redirect write
//    before any rule is consulted. These deny rules therefore fire today only on a record a future producer set
//    (story E0, #408) makes resolvable, plus defense in depth. Tests below feed such a record directly (unresolved
//    cleared), which is exactly what E0 would emit.
//  - `mandatory: true` is INERT outside the central layer (loader `inertMandatoryDeclarations`). The only
//    override path for these shipped-defaults rules is a same-id rule in .thoth/policy.json, which is itself on
//    the protected list (and, at K, covered by a permissions.deny Edit(...) entry). F-override-documented pins that
//    dependency.
//  - Gate deny rules do not protect the built-in file tools (Edit, Write, ...): that is the permissions.deny
//    Edit(...) list, proposed in docs/plans/s308-K-proposed-settings-2026-10-04.json and shipped by K (F5 checks
//    the proposal). The fixture is NOT made unwritable by the gate's rules alone (THOTH-ADR-0003).
//  - Paths are matched in canonical form (project-relative, lowercase, forward slash). Absolute-path and
//    $VAR / ~user forms are not matched (no project root in the normalizer); `~/` is matched literally.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEffectivePolicy } from "./loader.ts";
import type { CentralPolicySource } from "./central-source.ts";
import { decide } from "../kernel/kernel.ts";
import type { Rule } from "../kernel/rule-types.ts";
import type { ActionRecord } from "../kernel/action-record.ts";
import { normalize } from "../normalizer/registry.ts";
import "../normalizer/shell.ts";
import { moduleRelativeFixtureLocation } from "../tools/classification-catalog.ts";
import {
  PROTECTED_VERBS,
  buildDenyRules,
  buildParentRules,
  buildSettingsProposal,
  importGraphFiles,
  missingEditDenies,
  parentDirs,
  readByPathCandidates,
  unmatchedParentDirs,
  wiredHookScripts,
  protectedPaths,
  ruleIdFor,
  unmatchedPaths,
} from "../../qa/protected-path-list.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SHIPPED_PATH = join(REPO_ROOT, "src", "policy", "config", "shipped-defaults.json");
const PROPOSAL_PATH = join(REPO_ROOT, "docs", "plans", "s308-K-proposed-settings-2026-10-04.json");
const FIXTURE_REL = fixtureRel();

function fixtureRel(): string {
  const abs = moduleRelativeFixtureLocation().fixturePath.replaceAll("\\", "/");
  return abs.slice(REPO_ROOT.replaceAll("\\", "/").length).toLowerCase();
}

function shipped(): Rule[] {
  return (JSON.parse(readFileSync(SHIPPED_PATH, "utf8")) as { rules: Rule[] }).rules;
}
const PATHS = protectedPaths(REPO_ROOT);

/** A record a future producer command set (E0) could emit: a resolved write to one target. */
function writeRecord(target: string): ActionRecord {
  return { source: "parsed", verbs: ["write"], targets: [target], environment: "e", identity: "i", deferred: false, unresolved: [] };
}
const probeTarget = (p: string): string => (p.endsWith("/") ? `${p}child.json` : p);
const WORLD = (rules: Rule[]) => ({ rules: { version: "0.0.0-test", rules }, defaultOutcome: "allow" as const });

test("F1/F1a/F1b: the protected list names the fixture, launcher, pin file, policy files and settings files explicitly, and every path is matched by a deny rule (rule id derived from the path)", () => {
  const named = [FIXTURE_REL, "hooks/launch-gate.sh", "src/qa/gate-launcher-pin-check.ts", "src/policy/config/shipped-defaults.json", ".thoth/policy.json", ".claude/settings.json", ".claude/settings.local.json", "~/.claude/settings.json", ".thoth/halt-state/", "hooks/pretooluse-kernel-gate.mjs"];
  for (const n of named) assert.ok(PATHS.all.includes(n), `named path missing from the protected list: ${n}`);
  const problems: string[] = [];
  for (const p of PATHS.all) {
    const v = decide(WORLD(shipped()), writeRecord(probeTarget(p)));
    if (v.outcome !== "deny" || v.ruleId !== ruleIdFor(p)) problems.push(`${p}: ${JSON.stringify(v)}`);
  }
  console.log(`F1: ${String(PATHS.all.length)} protected paths (${String(PATHS.generated.length)} generated from the import graph, ${String(PATHS.named.length)} named)`);
  assert.deepEqual(problems, []);
});

test("F2: the generated half is the hook's relative-import graph (hook file plus every module it import()s, transitively), derived here from the hook source", () => {
  const hookText = readFileSync(join(REPO_ROOT, "hooks", "pretooluse-kernel-gate.mjs"), "utf8");
  const direct = [...hookText.matchAll(/import\("(\.\.\/[^"]+)"\)/g)].map((m) => m[1]!.replace(/^\.\.\//, ""));
  assert.ok(direct.length >= 6, "the hook import()s its project modules");
  for (const d of direct) assert.ok(PATHS.generated.includes(d), `direct import missing: ${d}`);
  assert.ok(PATHS.generated.includes("hooks/pretooluse-kernel-gate.mjs"));
  for (const g of importGraphFiles(REPO_ROOT)) assert.ok(PATHS.generated.includes(g), `graph file missing from generated: ${g}`);
});

test("F-committed: the committed deny rules equal the generator's output for the current list (a stale list fails)", () => {
  const committed = shipped().filter((r) => r.id.startsWith("protect-"));
  assert.deepEqual(committed, [...buildDenyRules(PATHS.all), ...buildParentRules(parentDirs(PATHS.all))]);
  assert.ok(committed.every((r) => r.effect === "deny"));
  assert.ok(committed.filter((r) => !r.id.startsWith("protect-parent-")).every((r) => JSON.stringify(r.verbs) === JSON.stringify([...PROTECTED_VERBS])));
});

test("F3 mutants: dropping any one deny rule is detected and names the path; adding an import to the graph is detected", () => {
  const rules = shipped();
  assert.deepEqual(unmatchedPaths(rules, PATHS.all), [], "control: nothing unmatched");
  for (const p of PATHS.all) {
    const mutant = rules.filter((r) => r.id !== ruleIdFor(p));
    assert.deepEqual(unmatchedPaths(mutant, PATHS.all), [p], `F3-mutant-drop-rule: ${p}`);
  }
  // Issue #418: every dependency form is a mutant that must be found (static import, require, createRequire(...)(...)),
  // and a non-literal or aliased form must make the generator fail closed (throw), never silently skip the module.
  const withLine = (line: string) => (abs: string) => {
    if (!existsSync(abs)) return undefined;
    const text = readFileSync(abs, "utf8");
    return abs.replaceAll("\\", "/").endsWith("src/policy/config/sanitize.ts") ? `${text}
${line}
` : text;
  };
  const synthetic = (abs: string) => (abs.replaceAll("\\", "/").endsWith("synthetic-extra-module.ts") ? "export {};" : undefined);
  const forms = [
    'import "./synthetic-extra-module.ts";',
    'const dep = require("./synthetic-extra-module.ts");',
    'const dep = createRequire(import.meta.url)("./synthetic-extra-module.ts");',
  ];
  for (const line of forms) {
    const extra = importGraphFiles(REPO_ROOT, withLine(line), synthetic);
    assert.ok(extra.includes("src/policy/config/synthetic-extra-module.ts"), `walk misses: ${line}`);
    assert.deepEqual(unmatchedPaths(rules, extra), ["src/policy/config/synthetic-extra-module.ts"], `F3-mutant-add-import: ${line}`);
  }
  for (const line of ['const dep = require(name);', 'const r = createRequire(import.meta.url); const dep = r("./synthetic-extra-module.ts");', 'const dep = await import(name);']) {
    assert.throws(() => importGraphFiles(REPO_ROOT, withLine(line), synthetic), /non-literal|createRequire|computed/, `fails closed: ${line}`);
  }
});

test("F3a F3-mutant-drop-fixture-deny: removing the classification fixture's deny rule fails the check (THOTH-ADR-0003 compliance row)", () => {
  const mutant = shipped().filter((r) => r.id !== ruleIdFor(FIXTURE_REL));
  assert.deepEqual(unmatchedPaths(mutant, PATHS.all), [FIXTURE_REL]);
});

test("F-policy-protected: .thoth/policy.json is on the list, and a mutant that drops its rule fails (it is the only override path of the shipped rules)", () => {
  assert.ok(PATHS.all.includes(".thoth/policy.json"));
  const mutant = shipped().filter((r) => r.id !== ruleIdFor(".thoth/policy.json"));
  assert.deepEqual(unmatchedPaths(mutant, PATHS.all), [".thoth/policy.json"]);
});

test("F-override-documented: DOCUMENTING -- `mandatory` is inert outside central; a same-id project rule DOES replace a shipped protect- rule", () => {
  const id = ruleIdFor(".thoth/policy.json");
  const root = mkdtempSync(join(tmpdir(), "thoth-f-override-"));
  try {
    const projectPath = join(root, "project.json");
    writeFileSync(projectPath, JSON.stringify({ version: "1.0.0", rules: [{ id, effect: "allow", targets: ["nothing/"] }] }), "utf8");
    const centralSource: CentralPolicySource = { read: () => ({ status: "absent" }) };
    const r = loadEffectivePolicy({ shippedDefaultsPath: SHIPPED_PATH, projectPolicyPath: projectPath, centralSource });
    assert.ok(r.ok, r.ok ? "" : r.message);
    const merged = (r.merged.rules as Rule[]).find((x) => x.id === id);
    assert.equal(merged?.effect, "allow", "the project rule won: this is why the project policy file is itself protected");
    assert.ok(r.inertMandatoryDeclarations.length > 0 || shipped().every((x) => x.mandatory !== true), "any shipped mandatory declaration is disclosed as inert");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-read-free: reads of protected paths follow the same outcome as an unprotected path; running (execute) is not denied by these rules", () => {
  for (const p of PATHS.all) {
    for (const verb of ["read", "list", "get", "execute"]) {
      const rec: ActionRecord = { ...writeRecord(probeTarget(p)), verbs: [verb] };
      assert.equal(decide(WORLD(shipped()), rec).outcome, "allow", `${verb} ${p}`);
    }
  }
});

test("F4: every protected path, written in each Windows/POSIX path form, reaches the shell record in canonical form and is denied by its rule once the command resolves", () => {
  const problems: string[] = [];
  for (const p of PATHS.all) {
    const base = probeTarget(p);
    const forms = [base, `./${base}`, base.toUpperCase(), `x/../${base}`, `.//${base.replace("/", "//")}`];
    for (const form of forms) {
      const r = normalize("shell", { command: `echo x > "${form}"`, environment: "e", identity: "i", deferred: false });
      if (JSON.stringify(r.targets) !== JSON.stringify([base])) {
        problems.push(`${form}: target ${JSON.stringify(r.targets)}`);
        continue;
      }
      const resolved: ActionRecord = { ...r, unresolved: [] };
      const v = decide(WORLD(shipped()), resolved);
      if (v.outcome !== "deny" || v.ruleId !== ruleIdFor(p)) problems.push(`${form}: ${JSON.stringify(v)}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("F5 F5-ap10-paths-edit-deny: every protected path has an Edit(...) deny entry in the PROPOSED settings text (not the real settings file); the proposal equals the generator output; a dropped entry fails", () => {
  const text = readFileSync(PROPOSAL_PATH, "utf8").split(String.fromCharCode(13)).join("");
  assert.deepEqual(missingEditDenies(text, PATHS.all), []);
  assert.equal(text, buildSettingsProposal(PATHS.all));
  const parsed = JSON.parse(text) as { permissions: { deny: string[] } };
  for (let i = 0; i < parsed.permissions.deny.length; i++) {
    const mutant = JSON.stringify({ permissions: { deny: parsed.permissions.deny.filter((_, j) => j !== i) } });
    assert.equal(missingEditDenies(mutant, PATHS.all).length, 1, `F5 mutant ${String(i)}`);
  }
  assert.ok(!JSON.stringify(parsed).includes("PreToolUse"), "the proposal is not the wiring entry (K)");
});

// ---- review round 1 fix-now (Issues #415, #417, #419) ----

test("#419 wired-hooks: every hook script wired in .claude/settings.json (read-only parse), and its import graph, is on the protected list; an unparseable wired command fails closed", () => {
  const settings = JSON.parse(readFileSync(join(REPO_ROOT, ".claude", "settings.json"), "utf8")) as { hooks?: Record<string, { hooks: { command: string }[] }[]> };
  const wired = Object.values(settings.hooks ?? {}).flatMap((entries) => entries.flatMap((e) => e.hooks.map((h) => h.command)));
  assert.ok(wired.length >= 2, "the repo wires at least the SessionStart and UserPromptSubmit hooks");
  const scripts = wired.flatMap((c) => [...c.matchAll(/\$\{?CLAUDE_PROJECT_DIR\}?\/([^\s"'`;|&]+)/g)].map((m) => m[1]!));
  assert.ok(scripts.length >= wired.length, "every wired command names a project script");
  for (const sc of scripts) assert.ok(PATHS.all.includes(sc.toLowerCase()), `wired script missing from the protected list: ${sc}`);
  assert.ok(PATHS.all.includes("src/policy/tools/mcp-enumeration.ts"), "a module only the wired SessionStart hook imports");
  assert.throws(() => wiredHookScripts(REPO_ROOT, () => JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "echo done" }] }] } })), /wired hook command/);
});

test("#417 read-by-path: the scan finds the data files the hook closure reads (fixture, tool inventory); a new read site is detected and must be protected", () => {
  const found = readByPathCandidates(REPO_ROOT, importGraphFiles(REPO_ROOT));
  assert.ok(found.includes(FIXTURE_REL), "the scan finds the fixture the closure reads");
  assert.ok(found.includes("docs/qa/tool-inventory.json"), "the scan finds the tool inventory the closure reads");
  for (const f of found) assert.ok(PATHS.all.includes(f), `read-by-path file not protected: ${f}`);
  const probe = readByPathCandidates(REPO_ROOT, ["src/policy/config/sanitize.ts"], (abs) =>
    `${readFileSync(abs, "utf8")}\nimport { readFileSync } from "node:fs";\nexport const X = readFileSync(join(THIS_DIR, "..", "..", "..", "docs", "qa", "synthetic-new-data.json"), "utf8");\n`);
  assert.deepEqual(probe, ["docs/qa/synthetic-new-data.json"], "F3-mutant-new-read: a new read site is found");
  assert.deepEqual(unmatchedPaths(shipped(), probe), probe, "and it is unprotected until a rule is generated for it");
});

test("#415 parent-dirs: move, delete and rename of every parent directory of a protected path (up to, excluding, the repo root) are denied; file writes beside a protected file are not over-blocked; the root is not protected", () => {
  const dirs = parentDirs(PATHS.all);
  assert.ok(dirs.includes("hooks") && dirs.includes(".thoth") && dirs.includes("src/policy"), `parent dirs: ${dirs.join(",")}`);
  assert.ok(!dirs.includes("") && !dirs.includes(".") && !dirs.includes("~"), "the repo root and the home root are excluded");
  const problems: string[] = [];
  for (const d of dirs) {
    for (const verb of ["move", "delete", "rename"]) {
      const v = decide(WORLD(shipped()), { ...writeRecord(d), verbs: [verb] });
      if (v.outcome !== "deny") problems.push(`${verb} ${d}: ${v.outcome}`);
    }
    const sibling = decide(WORLD(shipped()), writeRecord(`${d}/zz-unprotected-sibling.txt`));
    if (sibling.outcome !== "allow") problems.push(`write beside protected file in ${d}: ${sibling.outcome}`);
  }
  assert.deepEqual(problems, []);
  assert.ok(unmatchedParentDirs(shipped().filter((r) => !r.id.startsWith("protect-parent-")), dirs).length === dirs.length, "mutant: dropping the parent rules is detected");
});
