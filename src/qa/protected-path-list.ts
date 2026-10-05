// #308 story F (AP-10): the protected-path list and the deny-rule / Edit-deny data derived from it.
// THOTH-ADR-0003 hold: F ships only after the human accepts it.
//
// The list is GENERATED, not typed:
//   generated  = the PreToolUse hook file plus every module in its relative-import graph (static import,
//                export-from, and import() with a literal specifier), found by a TypeScript AST walk. This is a
//                parallel implementation of the scan in src/policy/config/hook-import-pins.test.ts (its helpers
//                are private to that test); a non-relative, non-node: specifier or a computed import() throws.
//   named      = paths the graph cannot produce: files read by path (the classification fixture, the shipped
//                defaults), the launcher and its pin file, the project policy file, the settings files that can
//                carry an `env` block, and the halt-state directory. The fixture path comes from the single-source
//                funnel, never typed here.
// Every path is stored in canonical form (src/policy/normalizer/path-canonical.ts): project-relative, lowercase,
// forward slash; a trailing "/" marks a directory prefix. The user settings file is the literal `~/...` form.
//
// Usage: `node src/qa/protected-path-list.ts` checks the committed shipped-defaults.json and the proposed
// settings text against this output (exit 1 on drift); `--write` regenerates both.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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

function specifierOf(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const a = node.arguments[0];
    return a !== undefined && ts.isStringLiteralLike(a) ? a.text : "(computed)";
  }
  return undefined;
}

/** Repo-relative posix paths of the hook and its relative-import closure, sorted. `read` and `fallback` are
 * injectable so a mutant can add an import (F3-mutant-add-import); `fallback` supplies a file `read` lacks. */
export function importGraphFiles(root: string, read: Reader = readReal, fallback: Reader = () => undefined): string[] {
  const seen = new Set<string>();
  const queue = [resolve(root, HOOK_REL)];
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
        if (spec === "(computed)") throw new Error(`${toRel(root, abs)}: import() with a non-literal specifier`);
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
  ].map(canonicalizePathTarget);
}

/** Named paths that must exist on disk (the others may legitimately be absent). */
const MUST_EXIST = [SHIPPED_REL, "hooks/launch-gate.sh", "src/qa/gate-launcher-pin-check.ts"];

export interface ProtectedPaths {
  generated: string[];
  named: string[];
  all: string[];
}

export function protectedPaths(root: string): ProtectedPaths {
  const generated = importGraphFiles(root);
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
      targets: [p],
      rationale: "AP-10 (#308 story F): a session may not write this path; it decides or wires the gate.",
      mandatory: true, // INERT outside the central layer; disclosed in activation-preconditions.test.ts
    } satisfies Rule;
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
  return `${JSON.stringify({ version: SHIPPED_VERSION, rules: [...kept, ...buildDenyRules(paths)] }, null, 2)}\n`;
}

export function main(argv: readonly string[]): number {
  const write = argv.includes("--write");
  const { all } = protectedPaths(REPO_ROOT);
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
