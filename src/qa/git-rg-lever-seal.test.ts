// #409 (S7, #308 K blocker): seal the git/rg exec levers by write-protection, a default-deny lever-key rule and a
// read-only preflight. git and rg STAY unresolved (POL-05 denies); re-adding them is a later data story that must run
// the preflight green. Written failing first by story-implementer. Plan: docs/plans/s409-git-rg-lever-seal-plan-2026-10-05.md
//
// The A1 key test ("a settings env block cannot set GIT_EXTERNAL_DIFF ...") is FALSE as a runtime property (J8 measured
// that a project settings env block reaches the hook and the shell). The provable form is upstream: the SESSION cannot
// author the settings env block, because the three settings files are protected (S409-settings-env-unwritable), and a
// lever key placed there anyway is detected (S409-settings-env-scan-detects-levers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { buildDenyRules, buildSettingsProposal, missingEditDenies, protectedPaths, ruleIdFor, unmatchedPaths } from "./protected-path-list.ts";
import { AMBIENT_COMMON, isAmbientCommon, isLeverKey, LEVER_NAMED, scanSettingsEnv } from "./exec-lever-env.ts";
import { RESIDUALS, runPreflight, type Finding } from "./git-rg-lever-preflight.ts";
import { decide } from "../policy/kernel/kernel.ts";
import type { Rule } from "../policy/kernel/rule-types.ts";
import type { ActionRecord } from "../policy/kernel/action-record.ts";
import { normalize } from "../policy/normalizer/registry.ts";
import { RESOLVABLE_BINARIES } from "../policy/normalizer/shell.ts";
import { READONLY_COMMAND_NAMES } from "../policy/normalizer/readonly-catalog.ts";
import { createGateSandbox, describeRun, wasPolicyDenied, type GateSandbox } from "../../hooks/test-support/gate-sandbox.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHIPPED_PATH = join(REPO_ROOT, "src", "policy", "config", "shipped-defaults.json");
const PROPOSAL_PATH = join(REPO_ROOT, "docs", "plans", "s308-K-proposed-settings-2026-10-04.json");
const SNAPSHOT_PATH = join(REPO_ROOT, "docs", "qa", "git-env-vars-snapshot.txt");
const PLAN_PATH = join(REPO_ROOT, "docs", "plans", "s409-git-rg-lever-seal-plan-2026-10-05.md");
const PREFLIGHT_SRC = join(REPO_ROOT, "src", "qa", "git-rg-lever-preflight.ts");

const shipped = (): Rule[] => (JSON.parse(readFileSync(SHIPPED_PATH, "utf8")) as { rules: Rule[] }).rules;
const WORLD = (rules: Rule[]) => ({ rules: { version: "0.0.0-test", rules }, defaultOutcome: "allow" as const });
const PATHS = protectedPaths(REPO_ROOT);

/** Criterion 1: every git config / attribute / hook path a lever reads. A trailing "/" is a directory entry. */
const GIT_CONFIG_PATHS = [".git/config", ".git/hooks/", ".gitattributes", ".git/info/attributes", "~/.gitconfig", "~/.config/git/config", "~/.config/git/attributes"];
const SETTINGS_PATHS = [".claude/settings.json", ".claude/settings.local.json", "~/.claude/settings.json"];
const probe = (p: string): string => (p.endsWith("/") ? `${p}pre-commit` : p);

// --- Criterion 1 and 2: the protected list, generated deny rules and Edit(...) entries -----------------------------------

test("S409-protected-list-covers-git-config-paths: every git config, attribute and hook path a lever reads is on the protected list", () => {
  const missing = GIT_CONFIG_PATHS.filter((p) => !PATHS.all.includes(p));
  assert.deepEqual(missing, []);
});

test("S409-new-paths-have-deny-and-edit-deny: each path has a generated deny rule and an Edit(...) entry in the proposal; a dropped entry or rule is detected", () => {
  const rules = shipped();
  const noRule = GIT_CONFIG_PATHS.filter((p) => !rules.some((r) => r.id === ruleIdFor(p)));
  assert.deepEqual(noRule, [], "committed shipped rule missing");
  const text = readFileSync(PROPOSAL_PATH, "utf8").split(String.fromCharCode(13)).join("");
  assert.deepEqual(missingEditDenies(text, GIT_CONFIG_PATHS), []);
  assert.equal(text, buildSettingsProposal(PATHS.all));
  // Mutants: drop one Edit entry / one rule, the check must name it.
  for (const p of GIT_CONFIG_PATHS) {
    const parsed = JSON.parse(text) as { permissions: { deny: string[] } };
    const dropped = JSON.stringify({ permissions: { deny: parsed.permissions.deny.filter((e) => !e.includes(p.replace(/\/$/, "/**"))) } });
    assert.deepEqual(missingEditDenies(dropped, [p]), [p], `edit mutant ${p}`);
    assert.deepEqual(unmatchedPaths(rules.filter((r) => r.id !== ruleIdFor(p)), [p]), [p], `rule mutant ${p}`);
  }
});

test("S409-mutant-drop-settings-local-from-list: a list without a settings file leaves it unmatched (the settings-env seal depends on it)", () => {
  const rules = buildDenyRules(PATHS.all.filter((p) => p !== ".claude/settings.local.json"));
  assert.deepEqual(unmatchedPaths(rules, SETTINGS_PATHS), [".claude/settings.local.json"]);
  assert.deepEqual(unmatchedPaths(buildDenyRules(PATHS.all), SETTINGS_PATHS), []);
});

// --- Criterion 3 and 4: write forms are denied --------------------------------------------------------------------------

const REDIRECT_FORMS = (p: string): string[] => [`echo x > ${p}`, `echo x >> ${p}`, `cat a > ${p}`];
const OTHER_FORMS = (p: string): string[] => [`tee ${p}`, `cp a ${p}`, `mv a ${p}`, `sed -i s/a/b/ ${p}`, `printf x | tee ${p}`];

function writeFormProblems(paths: readonly string[]): string[] {
  const problems: string[] = [];
  const world = WORLD(shipped());
  for (const p of paths) {
    const target = probe(p);
    for (const command of REDIRECT_FORMS(target)) {
      const r = normalize("shell", { command, environment: "e", identity: "i", deferred: false });
      const resolved: ActionRecord = { ...r, unresolved: [] };
      const v = decide(world, resolved);
      if (v.outcome !== "deny" || v.ruleId !== ruleIdFor(p)) problems.push(`${command}: ${JSON.stringify(v)}`);
    }
    for (const command of OTHER_FORMS(target)) {
      const v = decide(world, normalize("shell", { command, environment: "e", identity: "i", deferred: false }));
      if (v.outcome !== "deny") problems.push(`${command}: ${JSON.stringify(v)}`);
    }
  }
  return problems;
}

test("S409-hook-denies-writes-to-git-config: every write form to each git config/attribute/hook path is denied, by that path's own rule once resolved", () => {
  assert.deepEqual(writeFormProblems(GIT_CONFIG_PATHS), []);
});

test("S409-hook-denies-git-config-commands-for-the-right-reason: git config / git -c forms are denied because git is unresolved, never because a path rule is absent", () => {
  const world = WORLD(shipped());
  for (const command of ["git config --local core.fsmonitor x", "git config --global core.pager x", "git -c core.fsmonitor=x status", "git config --system core.editor x"]) {
    const r = normalize("shell", { command, environment: "e", identity: "i", deferred: false });
    assert.ok(r.unresolved.length > 0, `${command}: expected unresolved, got ${JSON.stringify(r)}`);
    assert.equal(decide(world, r).outcome, "deny", command);
  }
});

let sandbox: GateSandbox | undefined;
const sb = (): GateSandbox => (sandbox ??= createGateSandbox());

test("S409-hook-e2e-denies-git-config-writes: through the real copied hook, a write to each git config path and each settings path is a strict policy deny", () => {
  const failures: string[] = [];
  for (const p of [...GIT_CONFIG_PATHS, ...SETTINGS_PATHS]) {
    for (const command of [`echo x > ${probe(p)}`, `tee ${probe(p)}`, `cp a ${probe(p)}`]) {
      const run = sb().bash(command);
      if (!wasPolicyDenied(run)) failures.push(`${command} -> ${describeRun(run)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("S409-settings-env-unwritable: the session cannot author a settings env block at project, local or user scope (every write form denied); this is the provable form of the A1 key test", () => {
  const missing = SETTINGS_PATHS.filter((p) => !PATHS.all.includes(p));
  assert.deepEqual(missing, []);
  assert.deepEqual(writeFormProblems(SETTINGS_PATHS), []);
});

// --- Criterion 5: the lever-key rule -----------------------------------------------------------------------------------

const REQUIRED_KEYS = [
  "GIT_EXTERNAL_DIFF", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_KEY_12", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_PARAMETERS",
  "GIT_PAGER", "PAGER", "GIT_DIR", "GIT_WORK_TREE", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "GIT_EDITOR", "GIT_SEQUENCE_EDITOR", "GIT_EXEC_PATH", "GIT_TEMPLATE_DIR",
  "GIT_PROXY_COMMAND", "GIT_TRACE", "GIT_TRACE2", "GIT_TRACE2_EVENT", "GIT_TRACE_PACKET", "GIT_ATTR_SOURCE", "GIT_CEILING_DIRECTORIES", "RIPGREP_CONFIG_PATH",
  "HOME", "USERPROFILE", "XDG_CONFIG_HOME", "LESSOPEN", "LESS", "LESSSECURE", "EDITOR", "VISUAL", "SSH_ASKPASS", "SSH_AUTH_SOCK", "PROGRAMDATA", "KUBECONFIG",
];

for (const key of REQUIRED_KEYS) {
  test(`S409-lever-keys-named-members: ${key}`, () => {
    assert.equal(isLeverKey(key), true);
    assert.equal(isLeverKey(key.toLowerCase()), true, "Windows env keys are case-insensitive");
  });
}

test("S409-lever-keys-negative-controls: ordinary keys are not levers", () => {
  for (const key of ["FOO", "NODE_ENV", "CI", "MY_GIT_THING", "PATHEXT_X", "TERM"]) assert.equal(isLeverKey(key), false, key);
});

test("S409-lever-keys-cover-git-env-snapshot: every GIT_* token in the vendored git env snapshot matches the rule (the snapshot is the instrument)", () => {
  assert.ok(existsSync(SNAPSHOT_PATH), "docs/qa/git-env-vars-snapshot.txt is generated by npm run qa:git-env-snapshot");
  const tokens = readFileSync(SNAPSHOT_PATH, "utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  assert.ok(tokens.length >= 40, `snapshot looks empty: ${String(tokens.length)} tokens`);
  assert.deepEqual(tokens.filter((t) => !isLeverKey(t)), []);
});

test("S409-lever-rule-shape: the named list and the ambient-common list are non-empty and every ambient key is still a lever key", () => {
  assert.ok(LEVER_NAMED.length > 0 && AMBIENT_COMMON.length > 0);
  for (const k of AMBIENT_COMMON) assert.equal(isLeverKey(k), true, k);
  assert.equal(isAmbientCommon("HOME"), true);
  assert.equal(isAmbientCommon("GIT_EXTERNAL_DIFF"), false);
});

// --- Criterion 6: settings env block scan -----------------------------------------------------------------------------

test("S409-settings-env-scan-detects-levers: a lever key in an env block at any scope file is detected and the scope named; an env block of ordinary keys is clean", () => {
  for (const scope of ["project", "local", "user"]) {
    for (const key of ["GIT_EXTERNAL_DIFF", "RIPGREP_CONFIG_PATH", "GIT_CONFIG_COUNT", "HOME", "GIT_PAGER", "KUBECONFIG"]) {
      const hits = scanSettingsEnv(scope, JSON.stringify({ env: { [key]: "x", FOO: "y" } }));
      assert.deepEqual(hits, [{ scope, key }], `${scope}/${key}`);
    }
  }
  assert.deepEqual(scanSettingsEnv("project", JSON.stringify({ env: { FOO: "1" }, permissions: {} })), []);
  assert.deepEqual(scanSettingsEnv("project", JSON.stringify({ hooks: {} })), []);
  assert.throws(() => scanSettingsEnv("project", "{not json"), "an unparseable settings file fails closed");
});

// --- Criterion 7: git and rg stay unresolved ---------------------------------------------------------------------------

const resolvedSetViolations = (resolvable: ReadonlySet<string>, readonlyNames: readonly string[]): string[] =>
  ["git", "rg"].filter((b) => resolvable.has(b) || readonlyNames.includes(b));

test("S409-git-rg-not-in-resolved-set: neither git nor rg is in the shell normalizer's resolved set or the read-only catalog; the seal is not an allowance", () => {
  assert.deepEqual(resolvedSetViolations(RESOLVABLE_BINARIES, READONLY_COMMAND_NAMES), []);
  for (const command of ["git status", "git log", "rg p"]) {
    assert.ok(normalize("shell", { command, environment: "e", identity: "i", deferred: false }).unresolved.length > 0, command);
  }
});

test("S409-mutant-add-git-to-table: a table that gains git or rg is detected", () => {
  assert.deepEqual(resolvedSetViolations(new Set([...RESOLVABLE_BINARIES, "git"]), READONLY_COMMAND_NAMES), ["git"]);
  assert.deepEqual(resolvedSetViolations(RESOLVABLE_BINARIES, [...READONLY_COMMAND_NAMES, "rg"]), ["rg"]);
});

// --- Criterion 8 and 9: the preflight ----------------------------------------------------------------------------------

interface Fx {
  repo: string;
  home: string;
  programData: string;
  cleanup: () => void;
}
function fixture(): Fx {
  const root = mkdtempSync(join(tmpdir(), "s409-"));
  const repo = join(root, "repo");
  const home = join(root, "home");
  const programData = join(root, "programdata");
  for (const d of [join(repo, ".git", "hooks"), join(repo, ".git", "info"), join(repo, ".claude"), join(home, ".config", "git"), join(home, ".claude"), join(home, ".kube"), join(programData, "Git")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(repo, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n[remote \"origin\"]\n\turl = https://example.invalid/x.git\n");
  writeFileSync(join(repo, ".git", "hooks", "pre-commit.sample"), "#!/bin/sh\n");
  return { repo, home, programData, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const pf = (fx: Fx, env: Record<string, string> = {}): Finding[] => runPreflight({ repoRoot: fx.repo, home: fx.home, env, programData: fx.programData, managedSettingsPath: join(fx.home, "managed-none.json") });
const hasKey = (fs: Finding[], key: string, whereIncludes?: string): boolean => fs.some((f) => f.key === key && (whereIncludes === undefined || f.where.replaceAll("\\", "/").includes(whereIncludes)));

test("S409-preflight-clean-fixture: a clean repo and home report nothing, and ambient HOME-class env is not a finding", () => {
  const fx = fixture();
  try {
    assert.deepEqual(pf(fx, { HOME: fx.home, USERPROFILE: fx.home, PATH: "x", PAGER: "less", EDITOR: "vi", SSH_AUTH_SOCK: "/s" }), []);
  } finally {
    fx.cleanup();
  }
});

const CONFIG_ROWS: [string, string, string][] = [
  ["core.fsmonitor", "[core]\n\tfsmonitor = ./evil.sh\n", "core.fsmonitor"],
  ["core.hooksPath", "[core]\n\thooksPath = /tmp/h\n", "core.hookspath"],
  ["core.pager", "[core]\n\tpager = evil\n", "core.pager"],
  ["core.sshCommand", "[core]\n\tsshCommand = evil\n", "core.sshcommand"],
  ["core.editor", "[core]\n\teditor = evil\n", "core.editor"],
  ["diff.external", "[diff]\n\texternal = evil\n", "diff.external"],
  ["diff.x.textconv", "[diff \"x\"]\n\ttextconv = evil\n", "diff.x.textconv"],
  ["filter.x.clean", "[filter \"x\"]\n\tclean = evil\n", "filter.x.clean"],
  ["filter.x.smudge", "[filter \"x\"]\n\tsmudge = evil\n", "filter.x.smudge"],
  ["filter.x.process", "[filter \"x\"]\n\tprocess = evil\n", "filter.x.process"],
  ["credential.helper", "[credential]\n\thelper = !evil\n", "credential.helper"],
  ["alias shell", "[alias]\n\tst = !evil\n", "alias.st"],
  ["gpg.program", "[gpg]\n\tprogram = evil\n", "gpg.program"],
  ["include.path", "[include]\n\tpath = other.cfg\n", "include.path"],
  ["includeIf.path", "[includeIf \"gitdir:/x/\"]\n\tpath = other.cfg\n", "includeif.gitdir:/x/.path"],
];

for (const [label, body, key] of CONFIG_ROWS) {
  for (const place of ["repo", "home-gitconfig", "home-xdg", "programdata"] as const) {
    test(`S409-preflight-detects-planted-config: ${label} in ${place}`, () => {
      const fx = fixture();
      try {
        const file = place === "repo" ? join(fx.repo, ".git", "config") : place === "home-gitconfig" ? join(fx.home, ".gitconfig") : place === "home-xdg" ? join(fx.home, ".config", "git", "config") : join(fx.programData, "Git", "config");
        writeFileSync(file, body);
        const found = pf(fx);
        assert.ok(hasKey(found, key), `${key} not found in ${JSON.stringify(found)}`);
        assert.ok(found.every((f) => f.where !== "" && f.detail !== ""), "each finding names the file and a detail");
      } finally {
        fx.cleanup();
      }
    });
  }
}

test("S409-preflight-detects-planted-config: an include target is followed (the included file's executing key is reported)", () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.repo, ".git", "config"), "[include]\n\tpath = other.cfg\n");
    writeFileSync(join(fx.repo, ".git", "other.cfg"), "[core]\n\tfsmonitor = evil\n");
    const found = pf(fx);
    assert.ok(hasKey(found, "include.path") && hasKey(found, "core.fsmonitor", "other.cfg"), JSON.stringify(found));
  } finally {
    fx.cleanup();
  }
});

test("S409-preflight-detects-planted-config: a non-sample hook file, root and info attributes with diff=/filter= selectors", () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\n");
    writeFileSync(join(fx.repo, ".gitattributes"), "*.md diff=evil\n*.bin filter=evil\n*.txt text\n");
    writeFileSync(join(fx.repo, ".git", "info", "attributes"), "*.x diff=evil\n");
    const found = pf(fx);
    assert.ok(hasKey(found, "hook", ".git/hooks/pre-commit"), JSON.stringify(found));
    assert.ok(!found.some((f) => f.where.includes("pre-commit.sample")), "sample hooks are inert");
    assert.ok(hasKey(found, "attribute diff", ".gitattributes") && hasKey(found, "attribute filter", ".gitattributes"), JSON.stringify(found));
    assert.ok(hasKey(found, "attribute diff", "info/attributes"), JSON.stringify(found));
    assert.ok(!found.some((f) => f.detail.includes("text")), "an attribute line without diff=/filter= is not a finding");
  } finally {
    fx.cleanup();
  }
});

test("S409-preflight-detects-planted-config: set lever keys in the process env are reported by name only (never the value)", () => {
  const fx = fixture();
  try {
    const found = pf(fx, { GIT_EXTERNAL_DIFF: "secret-value-1", GIT_CONFIG_COUNT: "1", KUBECONFIG: "secret-value-2", LESSOPEN: "|x" });
    for (const k of ["GIT_EXTERNAL_DIFF", "GIT_CONFIG_COUNT", "KUBECONFIG", "LESSOPEN"]) assert.ok(hasKey(found, k, "process env"), k);
    assert.ok(!JSON.stringify(found).includes("secret-value"), "values must not be echoed");
  } finally {
    fx.cleanup();
  }
});

test("S409-preflight-detects-planted-config: RIPGREP_CONFIG_PATH is reported, and so are --pre, --search-zip and -z in the file it names", () => {
  const fx = fixture();
  try {
    const cfg = join(fx.home, "rg.cfg");
    writeFileSync(cfg, "# comment\n--smart-case\n--pre=cat\n--search-zip\n-z\n");
    const found = pf(fx, { RIPGREP_CONFIG_PATH: cfg });
    assert.ok(hasKey(found, "RIPGREP_CONFIG_PATH"));
    for (const flag of ["--pre", "--search-zip", "-z"]) assert.ok(hasKey(found, `rg ${flag}`, "rg.cfg"), `${flag}: ${JSON.stringify(found)}`);
    assert.ok(!hasKey(found, "rg --smart-case"), "an ordinary flag is not a finding");
  } finally {
    fx.cleanup();
  }
});

test("S409-preflight-detects-planted-config: lever keys in a project, local, user and managed settings env block are reported with the scope", () => {
  const fx = fixture();
  try {
    const managed = join(fx.home, "managed.json");
    writeFileSync(join(fx.repo, ".claude", "settings.json"), JSON.stringify({ env: { GIT_EXTERNAL_DIFF: "x" } }));
    writeFileSync(join(fx.repo, ".claude", "settings.local.json"), JSON.stringify({ env: { RIPGREP_CONFIG_PATH: "x" } }));
    writeFileSync(join(fx.home, ".claude", "settings.json"), JSON.stringify({ env: { GIT_CONFIG_COUNT: "1" } }));
    writeFileSync(managed, JSON.stringify({ env: { GIT_PAGER: "x" } }));
    const found = runPreflight({ repoRoot: fx.repo, home: fx.home, env: {}, programData: fx.programData, managedSettingsPath: managed });
    for (const [key, scope] of [["GIT_EXTERNAL_DIFF", "project"], ["RIPGREP_CONFIG_PATH", "local"], ["GIT_CONFIG_COUNT", "user"], ["GIT_PAGER", "managed"]] as const) {
      assert.ok(found.some((f) => f.key === key && f.where.includes(scope)), `${scope}/${key}: ${JSON.stringify(found)}`);
    }
  } finally {
    fx.cleanup();
  }
});

test("S409-preflight-detects-planted-config: kubeconfig (read-side): KUBECONFIG set, and a kubeconfig carrying an exec credential plugin, are reported", () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.home, ".kube", "config"), "users:\n- name: u\n  user:\n    exec:\n      command: evil\n");
    const found = pf(fx, { KUBECONFIG: join(fx.home, "other-kubeconfig") });
    assert.ok(hasKey(found, "KUBECONFIG"), JSON.stringify(found));
    assert.ok(hasKey(found, "kubeconfig exec", ".kube/config"), JSON.stringify(found));
    fx2(fx);
  } finally {
    fx.cleanup();
  }
});
function fx2(fx: Fx): void {
  writeFileSync(join(fx.home, ".kube", "config"), "users:\n- name: u\n  user:\n    token: x\n");
  assert.ok(!hasKey(pf(fx), "kubeconfig exec"), "a kubeconfig without exec is not a finding");
}

function treeHash(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
}

/** Violations of the read-only-by-construction rule in a preflight source text: a node:fs import that is not a read
 * function, any child_process / worker / vm import, any call that spawns, writes or deletes. Also used on a mutant. */
function readOnlyViolations(source: string): string[] {
  const READ = new Set(["readFileSync", "readdirSync", "existsSync", "statSync", "lstatSync"]);
  const WRITE_CALL = /^(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|writeFileSync|writeFile|appendFileSync|appendFile|rmSync|rm|unlinkSync|unlink|mkdirSync|mkdir|renameSync|rename|copyFileSync|copyFile|openSync|createWriteStream|symlinkSync|chmodSync|truncateSync|utimesSync)$/;
  const out: string[] = [];
  const sf = ts.createSourceFile("preflight.ts", source, ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text.replace(/^node:/, "");
      if (["child_process", "worker_threads", "vm", "cluster"].includes(spec)) out.push(`import ${spec}`);
      if (spec === "fs" || spec === "fs/promises") {
        const nb = n.importClause?.namedBindings;
        if (nb === undefined || !ts.isNamedImports(nb) || n.importClause?.name !== undefined || spec === "fs/promises") out.push(`non-named import of ${spec}`);
        else for (const e of nb.elements) if (!READ.has((e.propertyName ?? e.name).text)) out.push(`fs import ${(e.propertyName ?? e.name).text}`);
      }
    }
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : undefined;
      if (name !== undefined && WRITE_CALL.test(name)) out.push(`call ${name}`);
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push("dynamic import");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

test("S409-preflight-is-read-only: the fixture tree is byte-identical after a run, and the source imports only fs read functions and never spawns", () => {
  const fx = fixture();
  try {
    writeFileSync(join(fx.repo, ".git", "config"), "[core]\n\tfsmonitor = evil\n");
    writeFileSync(join(fx.repo, ".gitattributes"), "*.md diff=evil\n");
    const before = treeHash(join(fx.repo, ".."));
    const found = pf(fx);
    assert.ok(found.length > 0, "control: the run found something");
    assert.equal(treeHash(join(fx.repo, "..")), before);
  } finally {
    fx.cleanup();
  }
  const src = readFileSync(PREFLIGHT_SRC, "utf8");
  assert.ok(src.length > 200, "preflight source is present and non-trivial");
  assert.deepEqual(readOnlyViolations(src), []);
  assert.ok(!/spawn|execFile|child_process/.test(src.replace(/\/\/.*$/gm, "")), "no mention of process spawning in code");
});

test("S409-mutant-preflight-spawns-git: a preflight that imports child_process, calls spawnSync or writes a file is detected", () => {
  assert.deepEqual(readOnlyViolations('import { spawnSync } from "node:child_process";\nspawnSync("git", ["config", "-l"]);'), ["import child_process", "call spawnSync"]);
  assert.deepEqual(readOnlyViolations('import { writeFileSync } from "node:fs";\nwriteFileSync("x", "y");'), ["fs import writeFileSync", "call writeFileSync"]);
  assert.deepEqual(readOnlyViolations('import fs from "node:fs";\n'), ["non-named import of fs"]);
  assert.deepEqual(readOnlyViolations('import { readFileSync } from "node:fs";\nreadFileSync("x");'), []);
});

// --- Criterion 10: the re-add precondition -----------------------------------------------------------------------------

test("S409-precondition-preflight-clean: the preflight reports nothing in this repo's scope (repo git config, hooks, attributes, project and local settings); the git/rg re-add story must run it green", () => {
  const empty = mkdtempSync(join(tmpdir(), "s409-home-"));
  try {
    const found = runPreflight({ repoRoot: REPO_ROOT, home: empty, env: {}, programData: join(empty, "none"), managedSettingsPath: join(empty, "none.json") });
    assert.deepEqual(found, []);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

// --- Criterion 11: residuals are disclosed, not claimed closed ---------------------------------------------------------

test("S409-residuals-listed: R1-R4 are carried by the preflight, the plan and the CHANGELOG, so closure is never claimed past the seal", () => {
  assert.deepEqual(Object.keys(RESIDUALS).sort(), ["R1", "R2", "R3", "R4"]);
  const plan = readFileSync(PLAN_PATH, "utf8");
  const changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
  for (const k of ["R1", "R2", "R3", "R4"]) assert.ok(new RegExp(`^- ${k}:`, "m").test(plan), `plan lacks ${k}`);
  assert.ok(/#409[\s\S]{0,2000}R1-R4/.test(changelog), "CHANGELOG #409 entry names R1-R4");
});
