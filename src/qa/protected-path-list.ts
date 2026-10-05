// #308 story F (AP-10): the protected-path list and the deny-rule / Edit-deny data derived from it.
// THOTH-ADR-0003 hold: F ships only after the human accepts it.
//
// The list is GENERATED, not typed:
//   generated  = (1) the PreToolUse hook file and EVERY hook script wired in .claude/settings.json (read-only parse,
//                Issue #419), plus every module in their relative-import graph (static import, export-from,
//                import(), require() and createRequire(...)() with a literal specifier), found by a TypeScript AST
//                walk; a computed import(), a non-literal require() or a stored createRequire throws (Issue #418).
//                A parallel implementation of the scan in src/policy/config/hook-import-pins.test.ts (its helpers
//                are private to that test). (2) the data files the closure reads by path (readByPathCandidates:
//                a module that calls a fs read function and builds a data-file path from join()/resolve()/new URL()
//                literals, Issue #417).
//   named      = paths the graph cannot produce: files read by path (the classification fixture, the shipped
//                defaults), the launcher and its pin file, the project policy file, the settings files that can
//                carry an `env` block, and the halt-state directory. The fixture path comes from the single-source
//                funnel, never typed here.
// Every path is stored in canonical form (src/policy/normalizer/path-canonical.ts): project-relative, lowercase,
// forward slash. In this module's lists a trailing "/" marks a DIRECTORY entry (the canonicalizer itself drops it);
// a directory entry gets a rule for the directory and for its children. The user settings file is the literal `~/...` form.
//
// Disclosed limits: hooks wired in USER or MANAGED settings (outside the repo) are not walked; only the project
// settings file (committed) and the gitignored local settings file are read, and a local-file command that names no
// project script is skipped and listed. A ".." inside a CLAUDE_PROJECT_DIR capture is canonicalized lexically and is a
// developer-time input only (the settings file is itself a protected path).
//
// `--print-worktree-targets` lists the extra targets a linked worktree needs (worktreeExtraPaths).
// Usage: `node src/qa/protected-path-list.ts` checks the committed shipped-defaults.json and the proposed
// settings text against this output (exit 1 on drift); `--write` regenerates both.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { canonicalizePathTarget } from "../policy/normalizer/path-canonical.ts";
import { moduleRelativeFixtureLocation } from "../policy/tools/classification-catalog.ts";
import { decide } from "../policy/kernel/kernel.ts";
import type { Rule } from "../policy/kernel/rule-types.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HOOK_REL = "hooks/pretooluse-kernel-gate.mjs";
const SHIPPED_REL = "src/policy/config/shipped-defaults.json";
const PROPOSAL_REL = "docs/plans/s308-K-proposed-settings-2026-10-04.json";

/** Mutating verbs only: reading and running a protected file stays free ("read freely, protect the gate"). */
export const PROTECTED_VERBS = ["write", "create", "modify", "delete", "move", "rename"] as const;

/** Version of the shipped rule file this generator produces. A change is a reviewed change. */
export const SHIPPED_VERSION = "0.2.0-s308-baseline-and-protect";

const RULE_PREFIX = "protect-";

export function ruleIdFor(path: string): string {
  return `${RULE_PREFIX}${path.replace(/^~\//, "home/").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const toRel = (root: string, abs: string): string => relative(root, abs).split(sep).join("/");

type Reader = (abs: string) => string | undefined;
const readReal: Reader = (abs) => (existsSync(abs) ? readFileSync(abs, "utf8") : undefined);

// The name of node:module require factory, matched by name in an AST to follow dependencies; this file never calls it. Spelled plainly: the locked R1-6d scan (classification-builtin-override.test.ts) does not flag a bare name, only an import, call or member access.
const MODULE_REQUIRE_FACTORY = "createRequire";

/** The module specifier a node pulls in, if any. Recognized: import, export-from, import("lit"), require("lit") and
 * createRequire(...)("lit"). "(computed)" marks a dependency whose target cannot be read statically (a non-literal
 * import() or require(), or a createRequire(...) that is not invoked on the spot); the caller throws on it (Issue #418). */
function specifierOf(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  // Load forms whose target cannot be followed statically: new Worker(path), import.meta.resolve(...), x.require(...)
  // (module.require, process.mainModule.require). Fail closed, as for a computed import().
  if (ts.isNewExpression(node) && (calleeName(node.expression) === "Worker" || calleeName(node.expression) === "SharedWorker")) return "(computed)";
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    if (node.expression.name.text === "require") return "(computed)";
    if (node.expression.name.text === "resolve" && node.expression.expression.getText() === "import.meta") return "(computed)";
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const arg = node.arguments[0];
    const literal = arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : "(computed)";
    if (callee.kind === ts.SyntaxKind.ImportKeyword) return literal;
    if (ts.isIdentifier(callee) && callee.text === "require") return literal;
    // createRequire(import.meta.url)("lit"): the outer call's callee is itself a call to createRequire.
    if (ts.isCallExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === MODULE_REQUIRE_FACTORY) return literal;
    // createRequire(...) anywhere else (aliased, stored, passed): the later call cannot be followed statically.
    if (ts.isIdentifier(callee) && callee.text === MODULE_REQUIRE_FACTORY && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) return "(computed)";
  }
  return undefined;
}

const JS_ROOT = /\.(mjs|js|cjs|ts|mts)$/;

/** Project scripts named by the command hooks wired in .claude/settings.json and .claude/settings.local.json (read-only
 * parse, Issue #419). A command is expected to reference its script as ${CLAUDE_PROJECT_DIR}/<path>; a wired command
 * that names no project script cannot be enumerated and throws (fail closed). `readSettings` is injectable. */
export interface WiredHookScan {
  scripts: string[];
  /** Commands in the gitignored local settings file that name no project script: skipped, not enumerable (listed, not thrown). */
  skipped: string[];
}

export function wiredHookScripts(root: string, readSettings: Reader = readReal): string[] {
  return wiredHookScan(root, readSettings).scripts;
}

export function wiredHookScan(root: string, readSettings: Reader = readReal): WiredHookScan {
  const out = new Set<string>();
  const skipped: string[] = [];
  for (const f of [".claude/settings.json", ".claude/settings.local.json"]) {
    const text = readSettings(resolve(root, f));
    if (text === undefined) continue;
    const hooks = (JSON.parse(text) as { hooks?: Record<string, { hooks?: { command?: unknown }[] }[]> }).hooks ?? {};
    for (const entries of Object.values(hooks)) {
      for (const entry of entries) {
        for (const h of entry.hooks ?? []) {
          if (typeof h.command !== "string") continue;
          // The class below spells double quote, single quote and backtick as hex escapes: a literal quote in a regex makes the R1-6b comment stripper mis-parse this file.
          const found = [...h.command.matchAll(/\$\{?CLAUDE_PROJECT_DIR\}?\/([^\s\x22\x27\x60;|&]+)/g)].map((m) => canonicalizePathTarget(m[1]!));
          if (found.length === 0) {
            // The project settings file is committed and must be enumerable (throw). The local file is a developer's
            // gitignored override (user-level hooks are legitimate there): skip and list.
            if (f.endsWith("settings.local.json")) {
              skipped.push(h.command.slice(0, 80));
              continue;
            }
            throw new Error(`wired hook command names no CLAUDE_PROJECT_DIR script, cannot enumerate it: ${h.command.slice(0, 80)}`);
          }
          for (const x of found) out.add(x);
        }
      }
    }
  }
  return { scripts: [...out].sort(), skipped };
}

const READ_FNS = new Set(["readFileSync", "readFile", "readdirSync", "readdir", "createReadStream", "openSync", "readSync"]);
const DATA_EXT = /\.(json|txt|md|ya?ml|toml|csv|ini)$/i;

const calleeName = (e: ts.Expression): string | undefined => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : undefined);

/** Data files the given modules read by path (Issue #417). Only modules that call a fs read function are scanned.
 * Recognized path expressions: join()/resolve() whose later arguments are string literals and whose first argument is a
 * module-directory name or dirname(...) call (resolved against the module) or a string literal (against the repo
 * root); new URL("lit", import.meta.url); a bare path-like string literal with a data extension. A caller-supplied
 * path (a function parameter) is not visible here: its literal appears where the caller builds it, which is scanned
 * if that caller is in the closure. Returns repo-relative canonical paths inside the repo, sorted. `read` is injectable. */
export function readByPathCandidates(root: string, files: readonly string[], read: Reader = readReal): string[] {
  const found = new Set<string>();
  for (const rel of files) {
    const abs = resolve(root, rel);
    const text = read(abs);
    if (text === undefined) continue;
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, abs.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
    let reads = false;
    const hits: string[] = [];
    const lit = (e: ts.Expression): string | undefined => (ts.isStringLiteralLike(e) ? e.text : undefined);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        if (name !== undefined && READ_FNS.has(name)) reads = true;
        if ((name === "join" || name === "resolve") && node.arguments.length >= 2) {
          const [first, ...rest] = node.arguments;
          const parts = rest.map(lit);
          const tail = parts[parts.length - 1];
          if (parts.every((x): x is string => x !== undefined) && tail !== undefined && DATA_EXT.test(tail)) {
            const f = lit(first!);
            const moduleDir = ts.isIdentifier(first!) ? /dir$/i.test(first.text) : ts.isCallExpression(first!) && calleeName(first.expression) === "dirname";
            const rootFn = ts.isCallExpression(first!) ? calleeName(first.expression) : undefined;
            if (f !== undefined) hits.push(toRel(root, resolve(root, f, ...parts)));
            else if (moduleDir) hits.push(toRel(root, resolve(dirname(abs), ...parts)));
            else if (rootFn === "projectDir") hits.push(toRel(root, resolve(root, ...parts)));
            else if (rootFn === "homeDir") hits.push(`~/${parts.join("/")}`);
          }
        }
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" && node.arguments !== undefined) {
        const a = node.arguments[0];
        const l = a === undefined ? undefined : lit(a);
        if (l !== undefined && DATA_EXT.test(l) && node.arguments[1]?.getText(sf).includes("import.meta.url")) hits.push(toRel(root, resolve(dirname(abs), l)));
      } else if (ts.isStringLiteralLike(node) && node.text.includes("/") && DATA_EXT.test(node.text) && !node.text.startsWith(".") && !/^[a-z]+:/i.test(node.text)) {
        hits.push(toRel(root, resolve(root, node.text)));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (reads) for (const h of hits) found.add(h);
  }
  return [...found]
    .filter((r) => !r.startsWith(".."))
    .map(canonicalizePathTarget)
    .sort();
}

/** Repo-relative posix paths of the hook and its relative-import closure, sorted. `read` and `fallback` are
 * injectable so a mutant can add an import (F3-mutant-add-import); `fallback` supplies a file `read` lacks. */
export function importGraphFiles(root: string, read: Reader = readReal, fallback: Reader = () => undefined): string[] {
  const seen = new Set<string>();
  const roots = [HOOK_REL, ...wiredHookScripts(root).filter((r) => JS_ROOT.test(r))];
  const queue = [...new Set(roots)].map((r) => resolve(root, r));
  while (queue.length > 0) {
    const abs = queue.shift()!;
    if (seen.has(abs)) continue;
    const text = read(abs) ?? fallback(abs);
    if (text === undefined) throw new Error(`unresolvable relative import: ${toRel(root, abs)}`);
    seen.add(abs);
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, abs.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      const spec = specifierOf(node);
      if (spec !== undefined) {
        if (spec === "(computed)") throw new Error(`${toRel(root, abs)}: a load form that cannot be followed statically (computed import(), non-literal or member-access require(), new Worker, import.meta.resolve, or a stored createRequire)`);
        if (spec.startsWith(".")) queue.push(resolve(dirname(abs), spec));
        else if (!spec.startsWith("node:")) throw new Error(`${toRel(root, abs)}: non-relative, non-node: import "${spec}"`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...seen].map((a) => canonicalizePathTarget(toRel(root, a))).sort();
}

/** Named paths. The fixture is derived from the funnel; the rest are explicit and each reason is the comment. */
function namedPaths(root: string): string[] {
  const fixtureAbs = moduleRelativeFixtureLocation().fixturePath;
  return [
    toRel(root, fixtureAbs), // read with readFileSync, not imported: the import graph cannot produce it (ADR-0003)
    SHIPPED_REL, // the shipped rules themselves (read by path)
    ".thoth/policy.json", // the project rules: the only override path of the shipped rules
    "hooks/launch-gate.sh", // the launcher shim (story D)
    "src/qa/gate-launcher-pin-check.ts", // where the launcher's pinned hash lives (F1b)
    ".claude/settings.json", // project settings (env block reach, measured in B4)
    ".claude/settings.local.json", // project local settings
    "~/.claude/settings.json", // user settings (env reach unproven, treated as reachable)
    ".thoth/halt-state/", // named sensitive area: session-readable, secrets-adjacent derivation
    // #409 (S7): the config, attribute and hook files git reads, each able to name a program git then runs (core.fsmonitor,
    // diff/filter drivers, hooks). Deny-rule targets are exact or directory-prefix (no globs, rule-types.ts), so nested
    // .gitattributes files are not listed: an attribute can only select a driver that config defines.
    // What this seals: the project-relative git dir of a MAIN checkout (.git/config, .git/config.worktree, .git/hooks/,
    // .git/info/attributes, .git/modules/ for submodule git dirs, .git/worktrees/), the root .gitattributes, .githooks/ and
    // the user-level files. It does NOT seal the common dir of a LINKED worktree (outside the project root): see
    // worktreeExtraPaths, which derives those targets per checkout.
    ".git/config",
    ".git/config.worktree",
    ".git/modules/",
    ".git/worktrees/",
    ".git/hooks/",
    ".githooks/", // this repo's own core.hooksPath target (src/lib/git-hooks-install.ts): the hooks git actually runs here
    ".git/info/attributes",
    ".gitattributes",
    "~/.gitconfig",
    "~/.config/git/config",
    "~/.config/git/attributes",
    // #429 (S7): content the Skill and SlashCommand tools run (it can carry shell preprocessing). Residual-with-condition in
    // docs/qa/tool-exec-judgment.json: the session must not author it. .claude/worktrees/ is deliberately NOT listed.
    ".claude/commands/",
    ".claude/skills/",
    ".claude/agents/",
    "~/.claude/commands/",
    "~/.claude/skills/",
    "~/.claude/agents/",
    "~/.claude/plugins/", // plugin skills and commands load from here
    // #446 (S7, Manager ruling on the #428 cross-domain finding): login-shell profile files. A session that can write one can
    // prepend a planted PATH directory for its next shell. Residual R1 of #409 is now owned by #429/#446 (this list).
    "~/.bashrc",
    "~/.bash_profile",
    "~/.bash_login",
    "~/.profile",
    "~/.zshrc",
    "~/.zprofile",
    "~/.zshenv",
    "~/.config/fish/",
  ].map((p) => canonicalizePathTarget(p) + (p.endsWith("/") ? "/" : ""));
}

/** Extra protected targets for a LINKED worktree (#442). There .git is a file (gitdir: <common>/worktrees/<name>) and git
 * reads config, hooks and attributes from the COMMON dir, outside the project root, plus <gitdir>/config.worktree.
 * Returns targets relative to the project root (e.g. ../main/.git/config), empty in a main checkout. NOT part of the
 * committed rules (they would differ per checkout layout and fail the F-committed drift check): the activation story (K)
 * and the preflight use this per checkout. A common dir on another drive has no relative form and is skipped. */
export function worktreeExtraPaths(root: string, read: Reader = readReal): string[] {
  const dot = resolve(root, ".git");
  if (!existsSync(dot) || statSync(dot).isDirectory()) return [];
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(read(dot) ?? "");
  if (pointer === null) return [];
  const gitDir = resolve(root, pointer[1]!);
  const commonText = read(join(gitDir, "commondir"));
  const common = commonText === undefined ? gitDir : resolve(gitDir, commonText.trim());
  const base = toRel(root, common);
  const own = toRel(root, gitDir);
  if (isAbsolute(base) || isAbsolute(own)) return [];
  const targets = [`${base}/config`, `${base}/config.worktree`, `${base}/hooks/`, `${base}/info/attributes`, `${base}/modules/`, `${base}/worktrees/`, `${own}/config.worktree`];
  return [...new Set(targets.map((p) => canonicalizePathTarget(p) + (p.endsWith("/") ? "/" : "")))].sort();
}

/** Named paths that must exist on disk (the others may legitimately be absent). */
const MUST_EXIST = [SHIPPED_REL, "hooks/launch-gate.sh", "src/qa/gate-launcher-pin-check.ts"];

export interface ProtectedPaths {
  generated: string[];
  named: string[];
  all: string[];
}

export function protectedPaths(root: string): ProtectedPaths {
  const graph = importGraphFiles(root);
  const wiredNonJs = wiredHookScripts(root).filter((r) => !JS_ROOT.test(r));
  const generated = [...new Set([...graph, ...wiredNonJs, ...readByPathCandidates(root, graph)])].sort();
  const named = namedPaths(root);
  for (const m of [...MUST_EXIST, named[0]!]) if (!existsSync(join(root, m))) throw new Error(`named protected path does not exist: ${m}`);
  return { generated, named, all: [...new Set([...generated, ...named])].sort() };
}

export function buildDenyRules(paths: readonly string[]): Rule[] {
  const ids = new Map<string, string>();
  return paths.map((p) => {
    const id = ruleIdFor(p);
    const clash = ids.get(id);
    if (clash !== undefined) throw new Error(`rule id collision: ${clash} and ${p}`);
    ids.set(id, p);
    return {
      id,
      effect: "deny",
      verbs: [...PROTECTED_VERBS],
      targets: p.endsWith("/") ? [p.slice(0, -1), p] : [p],
      rationale: "AP-10 (#308 story F): a session may not write this path; it decides or wires the gate.",
      mandatory: true, // INERT outside the central layer; disclosed in activation-preconditions.test.ts
    } satisfies Rule;
  });
}

/** Verbs denied on the parent directories of protected paths (Issue #415): taking the directory away takes the
 * protected files with it. File writes inside a parent directory are NOT denied (no over-blocking of a source tree). */
export const PARENT_VERBS = ["move", "delete", "rename"] as const;
const PARENT_PREFIX = `${RULE_PREFIX}parent-`;

/** Every parent directory of a protected path, up to but excluding the repo root (and the home root `~`), sorted. */
export function parentDirs(paths: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    const parts = p.replace(/\/$/, "").split("/");
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join("/");
      if (d !== "" && d !== "." && d !== "~") dirs.add(d);
    }
  }
  return [...dirs].sort();
}

export function buildParentRules(dirs: readonly string[]): Rule[] {
  return dirs.map(
    (d) =>
      ({
        id: `${PARENT_PREFIX}${d.replace(/^~\//, "home/").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        effect: "deny",
        verbs: [...PARENT_VERBS],
        targets: [d],
        rationale: "AP-10 (#308 story F, Issue #415): moving, deleting or renaming this directory takes protected files with it.",
        mandatory: true,
      }) satisfies Rule,
  );
}

/** Parent directories for which no rule denies a resolved move of the directory. */
export function unmatchedParentDirs(rules: readonly Rule[], dirs: readonly string[]): string[] {
  return dirs.filter((d) => {
    const v = decide(
      { rules: { version: "0.0.0-check", rules: [...rules] }, defaultOutcome: "allow" },
      { source: "parsed", verbs: ["move"], targets: [d], environment: "e", identity: "i", deferred: false, unresolved: [] },
    );
    return v.outcome !== "deny";
  });
}

const probeTarget = (p: string): string => (p.endsWith("/") ? `${p}child` : p);

/** Paths for which no deny rule matches a resolved write to that path. Empty means every path is covered. */
export function unmatchedPaths(rules: readonly Rule[], paths: readonly string[]): string[] {
  return paths.filter((p) => {
    const v = decide(
      { rules: { version: "0.0.0-check", rules: [...rules] }, defaultOutcome: "allow" },
      { source: "parsed", verbs: ["write"], targets: [probeTarget(p)], environment: "e", identity: "i", deferred: false, unresolved: [] },
    );
    return v.outcome !== "deny";
  });
}

/** The permissions.deny Edit(...) entry for a path (Claude Code applies Edit rules to all built-in file tools).
 * `/x` is relative to the project root, `~/x` to the home directory; a directory prefix ends in `/**`. */
export function editDenyEntry(p: string): string {
  const body = p.endsWith("/") ? `${p}**` : p;
  return body.startsWith("~/") ? `Edit(${body})` : `Edit(/${body})`;
}

/** The PROPOSED settings text (shipped by story K under the human's approval; never the real settings file). */
export function buildSettingsProposal(paths: readonly string[]): string {
  return `${JSON.stringify({ permissions: { deny: paths.map(editDenyEntry) } }, null, 2)}\n`;
}

export function missingEditDenies(settingsText: string, paths: readonly string[]): string[] {
  const parsed = JSON.parse(settingsText) as { permissions?: { deny?: unknown } };
  const deny = Array.isArray(parsed.permissions?.deny) ? (parsed.permissions.deny as unknown[]) : [];
  return paths.filter((p) => !deny.includes(editDenyEntry(p)));
}

export function renderShippedDefaults(existingText: string, paths: readonly string[]): string {
  const existing = JSON.parse(existingText) as { rules: Rule[] };
  const kept = existing.rules.filter((r) => !r.id.startsWith(RULE_PREFIX));
  const rules = [...kept, ...buildDenyRules(paths), ...buildParentRules(parentDirs(paths))];
  return `${JSON.stringify({ version: SHIPPED_VERSION, rules }, null, 2)}\n`;
}

export function main(argv: readonly string[]): number {
  if (argv.includes("--print-worktree-targets")) {
    for (const p of worktreeExtraPaths(REPO_ROOT)) console.log(p);
    return 0;
  }
  const write = argv.includes("--write");
  const { all } = protectedPaths(REPO_ROOT);
  const skipped = wiredHookScan(REPO_ROOT).skipped;
  if (skipped.length > 0) console.log(`protected-path-list: skipped ${String(skipped.length)} non-project hook command(s) in the local settings file: ${skipped.join(" | ")}`);
  const shippedPath = join(REPO_ROOT, SHIPPED_REL);
  const proposalPath = join(REPO_ROOT, PROPOSAL_REL);
  const wantShipped = renderShippedDefaults(readFileSync(shippedPath, "utf8"), all);
  const wantProposal = buildSettingsProposal(all);
  if (write) {
    writeFileSync(shippedPath, wantShipped, "utf8");
    writeFileSync(proposalPath, wantProposal, "utf8");
    console.log(`protected-path-list: wrote ${SHIPPED_REL} and ${PROPOSAL_REL} (${String(all.length)} paths)`);
    return 0;
  }
  const norm = (s: string): string => s.replaceAll("\r\n", "\n");
  const drift: string[] = [];
  if (norm(readFileSync(shippedPath, "utf8")) !== wantShipped) drift.push(SHIPPED_REL);
  if (!existsSync(proposalPath) || norm(readFileSync(proposalPath, "utf8")) !== wantProposal) drift.push(PROPOSAL_REL);
  if (drift.length > 0) {
    console.error(`protected-path-list: DRIFT in ${drift.join(", ")}; run: node src/qa/protected-path-list.ts --write`);
    return 1;
  }
  console.log(`protected-path-list: PASS, ${String(all.length)} protected paths, committed rules and proposal match the generator`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
