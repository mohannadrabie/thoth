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
// #455 (S7): plugin-registered hooks are not settings fields, yet they run repo scripts at session start (the maat plugin's SessionStart
// hook runs docs/session-brief.mjs, which spawns docs/adr-cache.mjs and docs/decisions-archive.mjs). Those scripts are DERIVED from the
// enabled plugins' hook commands via a committed snapshot (docs/qa/plugin-hook-snapshot.json, produced only by --write from the live
// ~/.claude data; CI has no ~/.claude, so the default run reads the snapshot). A command's script tokens that resolve inside the repo
// (and exist) are protected, with their spawn-followed children and relative imports; tokens that resolve outside the repo are
// REPORTED, not protected (plugin-root paths sit under the protected ~/.claude/plugins/). A command naming no script is listed as
// unenumerable (not thrown); the F1 instrument fails until the human judges it. Drift of the snapshot from the live plugin is detected
// locally only (the default run and the F1 row); CI proves only that the list matches the committed snapshot.
//
// Disclosed limits: hooks wired in USER or MANAGED settings (outside the repo) are not walked; only the project
// settings file (committed) and the gitignored local settings file are read, and a local-file command that names no
// project script is skipped and listed. A ".." inside a CLAUDE_PROJECT_DIR capture is canonicalized lexically and is a
// developer-time input only (the settings file is itself a protected path).
//
// `--print-worktree-targets --form=relative|absolute` prints the Edit(...) lines a linked worktree needs (worktreeExtraPaths; --form is required, #442).
// Usage: `node src/qa/protected-path-list.ts` checks the committed shipped-defaults.json and the proposed
// settings text against this output (exit 1 on drift); `--write` regenerates both.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
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
export const SNAPSHOT_REL = "docs/qa/plugin-hook-snapshot.json";
export const JUDGMENTS_REL = "docs/qa/f1-hook-judgments.json";

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

// ---- #455: plugin-registered hooks ----

export interface SnapshotFile {
  /** Hooks file path relative to the plugin install (never an absolute path: the snapshot is committed). */
  path: string;
  /** sha256 of the file's raw bytes (or of the inline hooks JSON): compared against the live plugin locally. */
  sha256: string;
  /** sha256 of JSON.stringify(commands): the internal consistency check (a hand-edited command list fails it). */
  commandsSha256: string;
  commands: string[];
}
export interface SnapshotPlugin {
  id: string;
  version: string;
  gitCommitSha: string;
  /** Enabled but no install record: no hook files could be read (F1 fails on it). */
  unresolved?: true;
  files: SnapshotFile[];
}
export interface PluginHookSnapshot {
  version: 1;
  plugins: SnapshotPlugin[];
}
export interface PluginHookScan {
  /** Repo-relative scripts to protect: in-repo, existing, spawn-followed. Sorted. */
  scripts: string[];
  /** "<plugin>: <token>" for each script token resolving outside the repo (reported, not protected). */
  outside: string[];
  /** "<plugin>: <token>" for each in-repo script token that does not exist on disk (reported, not protected). */
  absent: string[];
  /** Commands outside the allowlist, and anything a followed script spawns or imports that cannot be resolved or is refused: listed, not thrown; F1 requires a human judgment. */
  unenumerable: string[];
  unenumerableBy: Array<{ plugin: string; command: string }>;
  /** Enabled plugins with no install record. */
  unresolved: string[];
}

const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

/** "unresolved": the token is partly assembled at run time (a variable or template piece), so what it names cannot be known. Fails closed. */
type TokenClass = { kind: "inside"; rel: string; read: string } | { kind: "outside" } | { kind: "unresolved" };

function classifyToken(token: string): TokenClass {
  const proj = /^\$\{?CLAUDE_PROJECT_DIR\}?[\\/](.+)$/.exec(token);
  const pluginRoot = /^\$\{?CLAUDE_PLUGIN_ROOT\}?[\\/](.+)$/.exec(token);
  if (pluginRoot !== null) return pluginRoot[1]!.includes("$") ? { kind: "unresolved" } : { kind: "outside" };
  if ((proj !== null ? proj[1]! : token).includes("$")) return { kind: "unresolved" };
  if (proj === null && (token.startsWith("~") || token.startsWith("/") || token.startsWith("\\") || /^[A-Za-z]:/.test(token))) return { kind: "outside" };
  const n = posix.normalize((proj === null ? token : proj[1]!).split("\\").join("/"));
  if (n === ".." || n.startsWith("../") || n.startsWith("/")) return { kind: "outside" };
  return { kind: "inside", rel: canonicalizePathTarget(n), read: n };
}

// ---- the hook-command allowlist (#455 round 2) ----
// A hook command is enumerable ONLY if, trimmed, it is exactly one of: `node <script>`, `node -e <body>`, `bash|sh <script>.sh`, each with
// optional literal trailing arguments and no shell operator, substitution, redirection or env prefix. Everything else is unenumerable, and
// the F1 instrument fails until the human judges it. There is no heuristic to patch one shape at a time.

interface HookWord {
  text: string;
  /** A $ or backtick outside single quotes: the shell would expand it, so the text is not what runs. */
  expands: boolean;
}

/** Shell words of a command with quotes removed; undefined for an unterminated quote or any unquoted operator, grouping, substitution or backslash. */
function hookWords(cmd: string): HookWord[] | undefined {
  const words: HookWord[] = [];
  let w = "";
  let has = false;
  let expands = false;
  let q = "";
  const end = (): void => {
    if (has) words.push({ text: w, expands });
    w = "";
    has = false;
    expands = false;
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd.charAt(i);
    if (q === "'") {
      if (c === "'") q = "";
      else w += c;
    } else if (q === '"') {
      if (c === '"') q = "";
      else {
        if (c === "$" || c === "`") expands = true;
        w += c;
      }
    } else if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === " " || c === "\t") end();
    else if (";&|<>()\n\r\\`".includes(c) || (c === "$" && cmd.charAt(i + 1) === "(")) return undefined;
    else {
      if (c === "$") expands = true;
      w += c;
      has = true;
    }
  }
  if (q !== "") return undefined;
  end();
  return words;
}

export type HookCommand = { kind: "script"; token: string } | { kind: "inline"; body: string };

/** The one allowed shape a hook command is, or undefined (unenumerable). */
export function classifyHookCommand(command: string): HookCommand | undefined {
  const ws = hookWords(command.trim());
  const [prog, a1, a2] = ws ?? [];
  if (ws === undefined || prog === undefined || a1 === undefined) return undefined;
  const literalFrom = (i: number): boolean => ws.slice(i).every((x) => !x.expands);
  // A script word may name CLAUDE_PROJECT_DIR / CLAUDE_PLUGIN_ROOT (braced or not); nothing else may expand.
  const scriptWord = (x: HookWord, ext: RegExp): boolean => !x.text.startsWith("-") && ext.test(x.text) && !x.text.replace(/^\$\{?CLAUDE_(PROJECT_DIR|PLUGIN_ROOT)\}?(?=[\\/])/, "").includes("$");
  if (prog.text === "node") {
    if (a1.text === "-e") return a2 !== undefined && !a2.expands && literalFrom(3) ? { kind: "inline", body: a2.text } : undefined;
    return scriptWord(a1, JS_ROOT) && literalFrom(2) ? { kind: "script", token: a1.text } : undefined;
  }
  if ((prog.text === "bash" || prog.text === "sh") && scriptWord(a1, /\.sh$/) && literalFrom(2)) return { kind: "script", token: a1.text };
  return undefined;
}

// ---- the source scanner: one AST walk over a script, a node -e body or an imported module ----

const CP_MODULES = new Set(["child_process", "node:child_process"]);
const CP_FNS = new Set(["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork"]);
const NODE_COMMANDS = new Set(["node", "node.exe"]);
// #484: ways to run code the scanner cannot read. Any use throws, in every scanned file and body.
const DYNAMIC_NAMES = new Set(["eval", "Function"]);
const LOADER_MODULES = new Set(["vm", "node:vm", "worker_threads", "node:worker_threads"]);
const PROCESS_ESCAPES = new Set(["binding", "_linkedBinding", "dlopen"]);

export interface SourceScan {
  /** Repo scripts spawned with node, as written (relative to the hook's working directory, the repo root). */
  spawned: string[];
  /** Relative import / require specifiers, as written (relative to the file). */
  imports: string[];
}

/** Scan one source text. Throws (fails closed) on anything that cannot be followed statically: a computed or non-relative import, any
 * child_process use other than a call of execFile / execFileSync / spawn / spawnSync / fork whose program is process.execPath or "node" (all
 * args literal, or a const bound to a plain string literal) or another string literal such as "git" (allowed, not followed), exec and
 * execSync always, and any alias, member or module reference outside those call shapes. The followed script is the first arg not starting
 * with "-". */
export function scanSource(text: string, fileName: string): SourceScan {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, /\.(mjs|js|cjs)$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const refuse = (what: string): never => {
    throw new Error(`${fileName}: ${what} cannot be followed statically (computed, non-literal or outside the allowed child_process call shapes)`);
  };
  const spawned = new Set<string>();
  const imports = new Set<string>();
  const cpNs = new Set<string>(); // identifiers bound to the child_process module
  const cpLocal = new Map<string, string>(); // local name -> imported function name
  const okSpecifier = new Set<ts.Node>(); // the one place each child_process specifier may appear
  const consts = new Map<string, string>();
  const tainted = new Set<string>();
  const taint = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) tainted.add(n.text);
    else ts.forEachChild(n, taint);
  };
  const requireOf = (e: ts.Expression | undefined): ts.StringLiteralLike | undefined => {
    const a = e !== undefined && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "require" ? e.arguments[0] : undefined;
    return a !== undefined && ts.isStringLiteralLike(a) && CP_MODULES.has(a.text) ? a : undefined;
  };
  const bindModule = (n: ts.BindingName, spec: ts.Node): void => {
    okSpecifier.add(spec);
    if (ts.isIdentifier(n)) cpNs.add(n.text);
    else
      for (const el of n.elements) {
        if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name) || el.dotDotDotToken !== undefined) refuse("a child_process destructuring");
        else cpLocal.set(el.name.text, (el.propertyName ?? el.name).getText(sf));
      }
  };

  // Pass 1: imports, bindings, and which identifiers are a const bound once to a plain string literal.
  const collect = (node: ts.Node): void => {
    const spec = specifierOf(node);
    if (spec === "(computed)") refuse("a load form");
    else if (spec !== undefined) {
      if (spec.startsWith(".")) imports.add(spec);
      else if (!spec.startsWith("node:")) refuse(`non-relative, non-node: import "${spec}"`);
    }
    if (ts.isPropertyAccessExpression(node)) {
      const direct = requireOf(node.expression); // require("node:child_process").fn(...): the module is used on the spot
      if (direct !== undefined) okSpecifier.add(direct);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && CP_MODULES.has(node.moduleSpecifier.text)) {
      okSpecifier.add(node.moduleSpecifier);
      const c = node.importClause;
      if (c?.name !== undefined) cpNs.add(c.name.text);
      const nb = c?.namedBindings;
      if (nb !== undefined && ts.isNamespaceImport(nb)) cpNs.add(nb.name.text);
      else if (nb !== undefined) for (const el of nb.elements) cpLocal.set(el.name.text, (el.propertyName ?? el.name).text);
    } else if (ts.isVariableDeclaration(node)) {
      const req = requireOf(node.initializer);
      if (req !== undefined) bindModule(node.name, req);
      else if (ts.isIdentifier(node.name) && node.initializer !== undefined && ts.isStringLiteralLike(node.initializer) && (node.parent.flags & ts.NodeFlags.Const) !== 0 && !consts.has(node.name.text)) consts.set(node.name.text, node.initializer.text);
      else taint(node.name);
    } else if (ts.isParameter(node) || ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)) taint(node.name ?? node);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined) taint(node.name);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) taint(node.left);
    else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) taint(node.operand);
    else if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) taint(node.initializer);
    if (ts.isStringLiteralLike(node) && CP_MODULES.has(node.text) && !okSpecifier.has(node)) refuse(`a child_process specifier (${node.text})`);
    if (ts.isStringLiteralLike(node) && LOADER_MODULES.has(node.text)) refuse(`the ${node.text} module`);
    ts.forEachChild(node, collect);
  };
  collect(sf);
  // A const name declared twice, or also bound, assigned or passed as a parameter anywhere, is not a resolvable constant.
  const literalOf = (e: ts.Expression): string => {
    const v = ts.isStringLiteralLike(e) ? e.text : ts.isIdentifier(e) && !tainted.has(e.text) ? consts.get(e.text) : undefined;
    return v ?? refuse(`an argument (${e.getText(sf).slice(0, 40)})`);
  };

  const call = (node: ts.CallExpression, fn: string): void => {
    if (fn === "exec" || fn === "execSync") refuse(`${fn}() shell command string`);
    const [p, args] = node.arguments;
    if (fn === "fork") {
      spawned.add(p === undefined ? refuse("fork() argument") : literalOf(p));
      return;
    }
    if (p === undefined) refuse(`${fn}() program`);
    else if (!ts.isStringLiteralLike(p) && p.getText(sf) !== "process.execPath" && p.getText(sf) !== "process.argv0") refuse(`${fn}() program`);
    else if (ts.isStringLiteralLike(p) && !NODE_COMMANDS.has(p.text)) return; // another literal program (git): allowed, not followed
    if (args === undefined || !ts.isArrayLiteralExpression(args)) refuse(`${fn}() argument list`);
    else {
      const lits = args.elements.map(literalOf);
      const script = lits.find((l) => !l.startsWith("-"));
      if (script !== undefined) spawned.add(script);
    }
  };
  const cpish = (e: ts.Expression): boolean => requireOf(e) !== undefined || (ts.isIdentifier(e) && (cpNs.has(e.text) || /^(child_?process|cp)$/i.test(e.text)));
  const isDeclName = (id: ts.Identifier): boolean => {
    const p = id.parent;
    return (
      ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) && p.name === id) ||
      ((ts.isBindingElement(p) || ts.isImportSpecifier(p)) && (p.name === id || p.propertyName === id)) ||
      (ts.isPropertyAssignment(p) && p.name === id)
    );
  };

  // Pass 2: every call and every reference to the module or one of its functions.
  const check = (node: ts.Node): void => {
    // Dynamic code: eval and Function by any route, a .constructor call, and the process loader escapes.
    if (ts.isIdentifier(node) && DYNAMIC_NAMES.has(node.text)) refuse(`a reference to ${node.text}`);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && (DYNAMIC_NAMES.has(node.argumentExpression.text) || PROCESS_ESCAPES.has(node.argumentExpression.text) || node.argumentExpression.text === "constructor")) refuse(`a computed access to ${node.argumentExpression.text}`);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "constructor") refuse("a .constructor call");
    if (ts.isPropertyAccessExpression(node) && PROCESS_ESCAPES.has(node.name.text) && node.expression.getText(sf) === "process") refuse(`process.${node.name.text}`);
    if (ts.isCallExpression(node)) {
      const c = node.expression;
      if (ts.isIdentifier(c)) {
        const fn = cpLocal.get(c.text) ?? (CP_FNS.has(c.text) ? c.text : undefined);
        if (fn !== undefined) call(node, fn);
      } else if (ts.isPropertyAccessExpression(c) && CP_FNS.has(c.name.text) && (c.name.text !== "exec" || cpish(c.expression))) call(node, c.name.text);
    } else if (ts.isIdentifier(node) && !isDeclName(node)) {
      const p = node.parent;
      const callee = ts.isCallExpression(p) && p.expression === node;
      if (ts.isPropertyAccessExpression(p) && p.name === node) {
        const called = ts.isCallExpression(p.parent) && p.parent.expression === p;
        if (CP_FNS.has(node.text) && !called && (node.text !== "exec" || cpish(p.expression))) refuse(`a reference to ${node.text}`);
      } else if (cpNs.has(node.text)) {
        if (!(ts.isPropertyAccessExpression(p) && p.expression === node && CP_FNS.has(p.name.text) && ts.isCallExpression(p.parent) && p.parent.expression === p)) refuse(`a use of the child_process module (${node.text})`);
      } else if ((cpLocal.has(node.text) || CP_FNS.has(node.text)) && !callee) refuse(`a reference to ${node.text}`);
    }
    ts.forEachChild(node, check);
  };
  check(sf);
  return { spawned: [...spawned].sort(), imports: [...imports].sort() };
}

export const spawnedScripts = (text: string, fileName: string): string[] => scanSource(text, fileName).spawned;

/** Derive the repo scripts the snapshot's hook commands execute (the one derivation instrument for #455). `read` is injectable. */
export function pluginHookScan(root: string, snapshot: PluginHookSnapshot, read: Reader = readReal): PluginHookScan {
  const scripts = new Set<string>();
  const outside = new Set<string>();
  const absent = new Set<string>();
  const unenumerable: string[] = [];
  const unenumerableBy: Array<{ plugin: string; command: string }> = [];
  const queue: Array<{ rel: string; plugin: string }> = [];
  /** Returns false when the token cannot be resolved cleanly (unresolved, or an in-repo path naming no file): the caller then fails closed. */
  const take = (plugin: string, token: string): boolean => {
    const c = classifyToken(token);
    if (c.kind === "unresolved") return false;
    if (c.kind === "outside") {
      outside.add(`${plugin}: ${token}`);
      return true;
    }
    if (read(resolve(root, c.read)) === undefined) {
      absent.add(`${plugin}: ${token}`);
      return false;
    }
    if (!scripts.has(c.rel)) {
      scripts.add(c.rel);
      queue.push({ rel: c.read, plugin });
    }
    return true;
  };
  const markUnenumerable = (plugin: string, command: string): void => {
    unenumerable.push(command);
    unenumerableBy.push({ plugin, command });
  };
  /** Scan one source text and take what it spawns and imports. A refusal or an unresolvable target is reported through `mark`. */
  const follow = (plugin: string, text: string, fileName: string, baseDir: string, mark: (detail: string) => void): void => {
    try {
      const s = scanSource(text, fileName);
      for (const t of s.spawned) if (!take(plugin, t)) mark(`spawns ${t}`);
      for (const i of s.imports) {
        const rel = toRel(root, resolve(baseDir, i));
        if (!take(plugin, rel)) mark(`imports ${rel}`);
      }
    } catch (e) {
      mark((e as Error).message);
    }
  };
  for (const p of snapshot.plugins) {
    for (const f of p.files) {
      for (const cmd of f.commands) {
        // Fail closed: only the allowlisted shapes are enumerable; anything else is unenumerable and F1 fails until the human judges it.
        const cls = classifyHookCommand(cmd);
        const whole = (): void => markUnenumerable(p.id, cmd);
        if (cls === undefined) whole();
        else if (cls.kind === "script") {
          if (!take(p.id, cls.token)) whole();
        } else follow(p.id, cls.body, "inline-e-body.js", root, whole);
      }
    }
  }
  // Follow to a fixpoint: every script, node -e body and imported module is scanned by the same scanner.
  while (queue.length > 0) {
    const { rel, plugin } = queue.shift()!;
    if (!JS_ROOT.test(rel)) continue;
    const abs = resolve(root, rel);
    const text = read(abs);
    if (text !== undefined) follow(plugin, text, abs, dirname(abs), (d) => markUnenumerable(plugin, `${rel}: ${d}`));
  }
  return {
    scripts: [...scripts].sort(),
    outside: [...outside].sort(),
    absent: [...absent].sort(),
    unenumerable,
    unenumerableBy,
    unresolved: snapshot.plugins.filter((p) => p.unresolved === true).map((p) => p.id),
  };
}

export const pluginHookScripts = (root: string, snapshot: PluginHookSnapshot, read: Reader = readReal): string[] => pluginHookScan(root, snapshot, read).scripts;

/** Internal consistency: each file's stored commands still hash to the stored commandsSha256. */
export function snapshotInternalProblems(snapshot: PluginHookSnapshot): string[] {
  const out: string[] = [];
  if (snapshot.version !== 1 || !Array.isArray(snapshot.plugins)) return ["unsupported snapshot shape"];
  for (const p of snapshot.plugins) {
    for (const f of p.files) {
      if (sha256Hex(JSON.stringify(f.commands)) !== f.commandsSha256) out.push(`${p.id} ${f.path}: commands do not match commandsSha256`);
    }
  }
  return out;
}

export interface LiveDrift {
  status: "ok" | "drift" | "unverified";
  detail: string;
}

/** Committed snapshot against one freshly built from the live plugin data (`undefined` = no live data: unverified, never a pass). */
export function snapshotLiveDrift(committed: PluginHookSnapshot, live: PluginHookSnapshot | undefined): LiveDrift {
  if (live === undefined) return { status: "unverified", detail: "no live plugin data on this machine; drift of the snapshot from the real plugin is not checked here" };
  const a = new Map(committed.plugins.map((p) => [p.id, JSON.stringify(p)]));
  const b = new Map(live.plugins.map((p) => [p.id, JSON.stringify(p)]));
  const bad = [
    ...[...b.keys()].filter((id) => !a.has(id)).map((id) => `${id} is enabled live but missing from the snapshot`),
    ...[...a.keys()].filter((id) => !b.has(id)).map((id) => `${id} is in the snapshot but not enabled live`),
    ...[...a.keys()].filter((id) => b.has(id) && a.get(id) !== b.get(id)).map((id) => `${id} hooks changed since the snapshot`),
  ];
  return bad.length === 0 ? { status: "ok", detail: "snapshot matches the live plugin data" } : { status: "drift", detail: `${bad.join("; ")}; run: node src/qa/protected-path-list.ts --write` };
}

const asObj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Every command-type hook command in a hooks.json body ({hooks: {Event: [{hooks: [{type, command}]}]}}). */
function hookCommands(body: unknown): string[] {
  const out: string[] = [];
  for (const entries of Object.values(asObj(asObj(body).hooks))) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const inner = asObj(e).hooks;
      if (!Array.isArray(inner)) continue;
      for (const h of inner) {
        const o = asObj(h);
        if (typeof o.command === "string" && (o.type === undefined || o.type === "command")) out.push(o.command);
      }
    }
  }
  return out;
}

/** Build the snapshot from the LIVE data: enabled plugins (user, project and local settings; enabled in any scope is enough, the safe
 * superset), their install records, and their hooks files (hooks/hooks.json, hooks.json and whatever plugin.json's hooks field names).
 * Returns undefined when there is no live plugin data at all (installed_plugins.json absent). Never stores an absolute path. */
export function buildPluginSnapshot(env: { home: string; root: string; read?: Reader }): PluginHookSnapshot | undefined {
  const read = env.read ?? readReal;
  const installedText = read(join(env.home, ".claude", "plugins", "installed_plugins.json"));
  if (installedText === undefined) return undefined;
  const enabled = new Set<string>();
  for (const f of [join(env.home, ".claude", "settings.json"), join(env.root, ".claude", "settings.json"), join(env.root, ".claude", "settings.local.json")]) {
    const text = read(f);
    if (text === undefined) continue;
    for (const [id, on] of Object.entries(asObj(asObj(JSON.parse(text)).enabledPlugins))) if (on === true) enabled.add(id);
  }
  const installed = asObj(asObj(JSON.parse(installedText)).plugins);
  const plugins: SnapshotPlugin[] = [];
  for (const id of [...enabled].sort()) {
    const entries = Array.isArray(installed[id]) ? (installed[id] as unknown[]).map(asObj) : [];
    const rec = entries.find((e) => e.scope === "user") ?? entries[0];
    if (rec === undefined || typeof rec.installPath !== "string") {
      plugins.push({ id, version: "", gitCommitSha: "", unresolved: true, files: [] });
      continue;
    }
    const base = rec.installPath;
    const candidates = new Set<string>(["hooks/hooks.json", "hooks.json"]);
    const inline: Array<{ path: string; body: unknown }> = [];
    for (const m of ["plugin.json", ".claude-plugin/plugin.json"]) {
      const mt = read(join(base, m));
      if (mt === undefined) continue;
      const h = asObj(JSON.parse(mt)).hooks;
      for (const x of (Array.isArray(h) ? h : [h]) as unknown[]) {
        if (typeof x === "string") candidates.add(posix.normalize(x.split("\\").join("/")).replace(/^\.\//, ""));
        else if (typeof x === "object" && x !== null) inline.push({ path: `${m}#hooks`, body: { hooks: x } });
      }
    }
    const files: SnapshotFile[] = [];
    for (const rel of candidates) {
      const raw = read(join(base, rel));
      if (raw === undefined) continue;
      const commands = hookCommands(JSON.parse(raw));
      files.push({ path: rel, sha256: sha256Hex(raw), commandsSha256: sha256Hex(JSON.stringify(commands)), commands });
    }
    for (const i of inline) {
      const commands = hookCommands(i.body);
      files.push({ path: i.path, sha256: sha256Hex(JSON.stringify(i.body)), commandsSha256: sha256Hex(JSON.stringify(commands)), commands });
    }
    files.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
    plugins.push({ id, version: typeof rec.version === "string" ? rec.version : "", gitCommitSha: typeof rec.gitCommitSha === "string" ? rec.gitCommitSha : "", files });
  }
  return { version: 1, plugins };
}

export const renderSnapshot = (s: PluginHookSnapshot): string => `${JSON.stringify(s, null, 2)}\n`;

export function readSnapshot(root: string, read: Reader = readReal): PluginHookSnapshot {
  const text = read(resolve(root, SNAPSHOT_REL));
  if (text === undefined) throw new Error(`plugin hook snapshot missing: ${SNAPSHOT_REL}; run: node src/qa/protected-path-list.ts --write`);
  const parsed = JSON.parse(text) as PluginHookSnapshot;
  if (parsed.version !== 1 || !Array.isArray(parsed.plugins)) throw new Error(`plugin hook snapshot has an unsupported shape: ${SNAPSHOT_REL}`);
  return parsed;
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
export function importGraphFiles(root: string, read: Reader = readReal, fallback: Reader = () => undefined, extraRoots: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const roots = [HOOK_REL, ...wiredHookScripts(root).filter((r) => JS_ROOT.test(r)), ...extraRoots.filter((r) => JS_ROOT.test(r))];
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
    // What this seals: the WHOLE project-relative git dir of a MAIN checkout as one directory entry (.git/ covers config,
    // config.worktree, hooks, info/attributes, modules/, worktrees/ and any file a later git version reads, including
    // commondir, which redirects every one of those lookups), plus .git itself (the pointer file in a linked worktree), the
    // root .gitattributes, .githooks/ and the user-level files. It does NOT seal the common dir of a LINKED worktree
    // (outside the project root): see worktreeExtraPaths, which derives those targets per checkout.
    ".git/",
    ".githooks/", // this repo's own core.hooksPath target (src/lib/git-hooks-install.ts): the hooks git actually runs here
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
    // #452 round 2 (app-security finding 1, refs #456): the install directories the version-pin certifier executes binaries from.
    // #466: the two Claude Desktop bundle roots are protected too, and discovery executes only from a location on this list
    // (src/qa/unprotected-location.ts reads this list, no second one): the classic root, and the MSIX package's redirected AppData.
    // The MSIX publisher ID is machine-independent (Claude_<publisher>), so both are plain ~/ directory entries with no per-machine
    // segment; <version>/<hash> sit inside each root. A redirected %APPDATA% or an unpinned Claude_* package is NOT under these
    // entries, so a binary there is flagged and not executed. "~/.claude/dev-mods/": where Claude writes a session's mods (human ruling 2026-10-06).
    "~/AppData/Roaming/Claude/claude-code/",
    "~/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude-code/",
    "~/.claude/dev-mods/",
    "src/qa/unprotected-location.ts", // #466: decides which binary the certifier may execute
    "~/.local/bin/",
    "~/.local/share/claude/",
    "~/.vscode/extensions/",
    "~/.vscode-insiders/extensions/",
    "~/.cursor/extensions/",
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
    "~/.zlogin",
    "~/.zlogout",
    "~/.bash_logout",
    "~/.bash_aliases",
    "~/Documents/PowerShell/", // PowerShell profile directories (the PowerShell tool is routed, but pwsh can be launched by a gated command)
    "~/Documents/WindowsPowerShell/",
    // #448 (S7, red-team HIGH): the Bash tool sources snapshot-bash-*.sh from here into every gated command's shell.
    "~/.claude/shell-snapshots/",
    // #429 LOWs: the judgments and the two instruments that derive the protected list and the K matcher.
    "docs/qa/tool-exec-judgment.json",
    "src/qa/tool-exec-judgment.ts",
    "src/qa/protected-path-list.ts",
    // #451 and #429 round 2 (S7): every entry the installed Claude Code lists as write-protected for its own sandbox that is sourced,
    // executed or loaded as instructions or config (judged in docs/qa/claude-code-write-deny-judgment.json, extracted by
    // src/qa/claude-code-write-deny-extract.ts), plus ~/.claude.json (user MCP declarations) and the two instruments.
    "~/.claude/session-env/",
    "~/.claude/hooks/",
    "~/.claude/workflows/",
    "~/.claude/routines/",
    "~/.claude/rules/",
    "~/.claude/output-styles/",
    "~/.claude/scheduled_tasks.json",
    "~/.claude/launch.json",
    "~/.claude/CLAUDE.md",
    "~/.claude/projects/",
    "~/.claude/daemon.json",
    "~/.claude/policy-limits.json",
    "~/.claude/loop.md",
    "~/.claude/cowork_plugins/",
    "~/.claude/local/",
    "~/.claude/jobs/",
    "~/.claude/seed-admin/",
    "~/.claude/daemon/",
    "~/.claude/remote-settings.json",
    "~/.claude/remote-settings-consent.json",
    "~/.claude/remote-settings-helper-consent/",
    ".claude/hooks/",
    ".claude/workflows/",
    ".claude/routines/",
    ".claude/output-styles/",
    ".claude/launch.json",
    ".claude/loop.md",
    ".claude/scheduled_tasks.json",
    ".mcp.json",
    "~/.claude.json",
    "docs/qa/claude-code-write-deny-judgment.json",
    "src/qa/claude-code-write-deny-extract.ts",
    // #308 story K stage 0 (app-security round 1, refs #456): what generates and certifies the K gate text, and the proposal it compares against.
    "src/qa/k-settings-merge.ts",
    "src/qa/k3-edit-deny-covers-fixture.ts",
    "src/qa/k5-pretooluse-entry-uses-launcher.ts",
    "src/qa/k-readiness.ts",
    "src/qa/cc-extraction-covers-judged.ts", // #452 certifier (refs #456)
    "docs/plans/s308-K-proposed-entry-2026-10-05.json",
    // #455 (S7): the plugin-hook snapshot the derivation reads, the F1 instrument that certifies it, and the judgments file a session must not self-write.
    SNAPSHOT_REL,
    "src/qa/f1-settings-named-scripts-judged.ts",
    JUDGMENTS_REL,
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
  if (isAbsolute(base)) return [];
  // The whole common dir as one directory entry (it contains this worktree's own git dir), and the pointer file itself.
  const targets = [`${base}/`, toRel(root, dot)];
  return [...new Set(targets.map((p) => canonicalizePathTarget(p) + (p.endsWith("/") ? "/" : "")))].sort();
}

export type WorktreeForm = "relative" | "absolute";

/** The body after `Edit(//` for an absolute path. Vendor permissions doc: on Windows, paths are normalized to POSIX form before matching
 * (`C:\Users\alice` becomes `/c/Users/alice`, so the rule is `//c/Users/alice`): lower-case drive letter, no colon (#460).
 * Elsewhere it is the absolute path without its leading slash. */
export function absoluteEditBody(abs: string, platform: string = process.platform): string {
  const posix = abs.split("\\").join("/");
  if (platform === "win32" && posix.length >= 2 && posix.charAt(1) === ":") return `${posix.charAt(0).toLowerCase()}${posix.slice(2)}`;
  return posix.startsWith("/") ? posix.slice(1) : posix;
}

/** Ready-to-paste permissions.deny Edit(...) lines for the worktree targets (#442), one per line, sorted.
 * relative: `/x` is project-root relative (so `/../main/.git/**`); absolute: the `//`-prefixed absolute form. Which form
 * Claude Code honors for a path outside the project root is live probe P-K4 (stage 1), so both are emitted on request. */
export function worktreeEditLines(root: string, form: WorktreeForm, read: Reader = readReal): string[] {
  const targets = worktreeExtraPaths(root, read);
  const lines = new Set<string>();
  for (const t of targets) {
    if (form === "relative") {
      for (const e of editDenyEntries(t)) lines.add(e);
      continue;
    }
    const body = absoluteEditBody(resolve(root, t));
    lines.add(`Edit(//${body})`);
    if (t.endsWith("/")) lines.add(`Edit(//${body}/**)`);
  }
  return [...lines].sort();
}

/** CLI body of --print-worktree-targets (#442). Fails closed: --form=relative|absolute is required (exit 1, nothing on
 * stdout). A main checkout emits nothing, exits 0 and says so on stderr. */
export function runWorktreeTargets(argv: readonly string[], root: string, out: (l: string) => void, err: (l: string) => void, read: Reader = readReal): number {
  const forms = argv.filter((a) => a.startsWith("--form="));
  const form = forms.length === 1 ? forms[0]!.slice("--form=".length) : undefined;
  if (form !== "relative" && form !== "absolute") {
    err("protected-path-list: --print-worktree-targets requires exactly one --form=relative or --form=absolute");
    return 1;
  }
  const lines = worktreeEditLines(root, form, read);
  if (lines.length === 0) {
    err("protected-path-list: main checkout (or no linked-worktree pointer): no worktree targets");
    return 0;
  }
  for (const l of lines) out(l);
  return 0;
}

/** Named paths that must exist on disk (the others may legitimately be absent). */
const MUST_EXIST = [SHIPPED_REL, "hooks/launch-gate.sh", "src/qa/gate-launcher-pin-check.ts"];

export interface ProtectedPaths {
  generated: string[];
  named: string[];
  all: string[];
  /** What the plugin-hook derivation found (#455): scripts protected, commands reported or unenumerable. */
  pluginHooks: PluginHookScan;
}

export function protectedPaths(root: string, opts: { snapshot?: PluginHookSnapshot } = {}): ProtectedPaths {
  const snapshot = opts.snapshot ?? readSnapshot(root);
  const problems = snapshotInternalProblems(snapshot);
  if (problems.length > 0) throw new Error(`plugin hook snapshot is inconsistent: ${problems.join("; ")}; run: node src/qa/protected-path-list.ts --write`);
  const pluginHooks = pluginHookScan(root, snapshot);
  const graph = importGraphFiles(root, readReal, () => undefined, pluginHooks.scripts);
  // Data files are derived from the GATE's closure only: a plugin script (session-brief and its children) reads docs/decisions.md and writes
  // docs/.maat-state.json as ordinary inputs and outputs, and protecting those would block the normal workflow. Protect the plugin scripts' code, not their data.
  const gateGraph = importGraphFiles(root);
  const wiredNonJs = wiredHookScripts(root).filter((r) => !JS_ROOT.test(r));
  const pluginNonJs = pluginHooks.scripts.filter((r) => !JS_ROOT.test(r));
  const generated = [...new Set([...graph, ...wiredNonJs, ...pluginNonJs, ...readByPathCandidates(root, gateGraph)])].sort();
  const named = namedPaths(root);
  for (const m of [...MUST_EXIST, named[0]!]) if (!existsSync(join(root, m))) throw new Error(`named protected path does not exist: ${m}`);
  return { generated, named, all: [...new Set([...generated, ...named])].sort(), pluginHooks };
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

/** Every Edit(...) entry a path needs: a directory entry also needs one for the directory path itself, since `d/**` does not name `d`
 * (a linked worktree's .git is a FILE at that path). */
export function editDenyEntries(p: string): string[] {
  return p.endsWith("/") ? [editDenyEntry(p), editDenyEntry(p.slice(0, -1))] : [editDenyEntry(p)];
}

/** The PROPOSED settings text (shipped by story K under the human's approval; never the real settings file). */
/** Nested authorable directories (#449): kernel targets are exact or trailing-slash prefix (no globs), but Claude Code Edit rules
 * accept ** globs. Whether these globs match is a K live-spike item. */
export const NESTED_EDIT_GLOBS: readonly string[] = ["skills", "commands", "agents", "hooks", "workflows", "routines", "output-styles"].map((d) => `Edit(/**/.claude/${d}/**)`);

export function buildSettingsProposal(paths: readonly string[]): string {
  return `${JSON.stringify({ permissions: { deny: [...paths.flatMap(editDenyEntries), ...NESTED_EDIT_GLOBS] } }, null, 2)}\n`;
}

export function missingEditDenies(settingsText: string, paths: readonly string[]): string[] {
  const parsed = JSON.parse(settingsText) as { permissions?: { deny?: unknown } };
  const deny = Array.isArray(parsed.permissions?.deny) ? (parsed.permissions.deny as unknown[]) : [];
  return paths.filter((p) => !editDenyEntries(p).every((e) => deny.includes(e)));
}

export function renderShippedDefaults(existingText: string, paths: readonly string[]): string {
  const existing = JSON.parse(existingText) as { rules: Rule[] };
  const kept = existing.rules.filter((r) => !r.id.startsWith(RULE_PREFIX));
  const rules = [...kept, ...buildDenyRules(paths), ...buildParentRules(parentDirs(paths))];
  return `${JSON.stringify({ version: SHIPPED_VERSION, rules }, null, 2)}\n`;
}

export function main(argv: readonly string[]): number {
  if (argv.includes("--print-worktree-targets")) {
    return runWorktreeTargets(argv, REPO_ROOT, (l) => console.log(l), (l) => console.error(l));
  }
  const write = argv.includes("--write");
  const committed = existsSync(join(REPO_ROOT, SNAPSHOT_REL)) ? readFileSync(join(REPO_ROOT, SNAPSHOT_REL), "utf8") : undefined;
  const live = buildPluginSnapshot({ home: homedir(), root: REPO_ROOT });
  if (write && live === undefined) {
    console.error("protected-path-list: --write needs the live plugin data (~/.claude/plugins/installed_plugins.json), which is absent; the snapshot is produced only from it");
    return 1;
  }
  const snapshot = write ? live! : readSnapshot(REPO_ROOT);
  const { all, pluginHooks } = protectedPaths(REPO_ROOT, { snapshot });
  for (const o of pluginHooks.outside) console.log(`protected-path-list: plugin hook script outside the repo (reported, not protected): ${o}`);
  for (const o of pluginHooks.absent) console.log(`protected-path-list: plugin hook script not in the repo (reported, not protected): ${o}`);
  for (const o of pluginHooks.unenumerable) console.log(`protected-path-list: plugin hook command names no script (unenumerable; needs a human judgment): ${o.slice(0, 80)}`);
  const skipped = wiredHookScan(REPO_ROOT).skipped;
  if (skipped.length > 0) console.log(`protected-path-list: skipped ${String(skipped.length)} non-project hook command(s) in the local settings file: ${skipped.join(" | ")}`);
  const shippedPath = join(REPO_ROOT, SHIPPED_REL);
  const proposalPath = join(REPO_ROOT, PROPOSAL_REL);
  const wantShipped = renderShippedDefaults(readFileSync(shippedPath, "utf8"), all);
  const wantProposal = buildSettingsProposal(all);
  if (write) {
    writeFileSync(join(REPO_ROOT, SNAPSHOT_REL), renderSnapshot(snapshot), "utf8");
    writeFileSync(shippedPath, wantShipped, "utf8");
    writeFileSync(proposalPath, wantProposal, "utf8");
    console.log(`protected-path-list: wrote ${SHIPPED_REL} and ${PROPOSAL_REL} (${String(all.length)} paths)`);
    return 0;
  }
  const norm = (s: string): string => s.replaceAll("\r\n", "\n");
  const drift: string[] = [];
  const liveDrift = snapshotLiveDrift(snapshot, live);
  if (liveDrift.status === "drift") {
    console.error(`protected-path-list: DRIFT, ${liveDrift.detail}`);
    return 1;
  }
  if (liveDrift.status === "unverified") console.log(`protected-path-list: plugin snapshot UNVERIFIED, ${liveDrift.detail}`);
  if (committed !== undefined && norm(committed) !== renderSnapshot(snapshot)) drift.push(SNAPSHOT_REL);
  if (norm(readFileSync(shippedPath, "utf8")) !== wantShipped) drift.push(SHIPPED_REL);
  if (!existsSync(proposalPath) || norm(readFileSync(proposalPath, "utf8")) !== wantProposal) drift.push(PROPOSAL_REL);
  if (drift.length > 0) {
    console.error(`protected-path-list: DRIFT in ${drift.join(", ")}; run: node src/qa/protected-path-list.ts --write`);
    return 1;
  }
  console.log(`protected-path-list: PASS, ${String(all.length)} protected paths (${String(pluginHooks.scripts.length)} from plugin hooks), committed rules and proposal match the generator`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
