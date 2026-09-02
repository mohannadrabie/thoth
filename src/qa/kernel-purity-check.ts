// ADR-0021 Rules for agents: "No filesystem, network, process-spawning, timer, or vendor-SDK
// import MAY appear anywhere under the kernel's own module boundary; the layer boundary is
// enforced by a lint rule or structural test, not by convention alone (POL-11, SE ADR-0002)." This
// is that structural test — a standing CI gate, not a replacement for `npm run lint`/
// `npm run typecheck`. It fails loud if the import graph or a forbidden global creeps into
// `src/policy/kernel/**`.
//
// Two checks, per production `.ts` file under the scanned root:
//   1. Import resolution — every `import ... from "specifier"` (and bare `import "specifier"`) is
//      classified: a NON-RELATIVE specifier (a bare package or a `node:` builtin) is forbidden
//      outright; a RELATIVE specifier that resolves OUTSIDE the scanned root is forbidden
//      (out-of-directory) — the kernel boundary is self-contained, it does not reach into
//      src/lib/ or src/policy/rule/.
//   2. Forbidden globals — a regex scan (on COMMENT-STRIPPED source; see stripComments below) for
//      `process`, `fetch(`, `setTimeout(`, `setInterval(`, `require(`, dynamic `import(`,
//      `__dirname`, `__filename`, and (Issue #63 fix-now, interim half — see docs/backlog.md for
//      the deferred AST-based durable fix) the bare identifiers `globalThis`, `global`, `Reflect`,
//      `eval`, and `Function` used as a constructor call (`new Function(`/bare `Function(`). This
//      widened set is still a literal-text regex — it raises the bar against trivial
//      string-concatenation obfuscation (e.g. `Reflect.get(globalThis, "proc" + "ess")`, or
//      Node's bare `global["proc" + "ess"]`, whose reassembled "process" string never appears as a
//      literal token but whose `Reflect`/`globalThis`/`global` identifiers do); it does not close
//      every obfuscation class an adversarial contributor could construct. `global` (Node's
//      CommonJS-era global object, distinct from the standard `globalThis`) is added as an Issue
//      #63 addendum (S2 re-confirm, app-security-reviewer): the original widened set covered
//      `globalThis` but missed the bare `global` identifier, which reaches the exact same object
//      and was demonstrably undetected (`global["proc"+"ess"]` — zero detections before this
//      addendum). Word-bounded (`\bglobal\b`) so it does not false-positive on `globalThis` itself
//      (no word boundary between "global" and "This") or any other identifier/word merely
//      containing "global" as a substring.
//
// Scope note (documented, not guessed past — PRINCIPLES.md rule 18): this checker scans every
// PRODUCTION `.ts` file under the root — it excludes `*.test.ts` siblings, the same narrow,
// file-type-scoped carve-out `eslint.config.mjs` already grants test files project-wide
// (`files: ["src/**/*.test.ts"]`). `node:test`/`node:assert` are dev-time test harness, never
// shipped kernel behavior, and kernel test files legitimately import shared fixtures from
// `../fixtures/*`, one directory outside the boundary — scanning them would make the checker
// unable to coexist with its own required test suite. What "pure" governs is the kernel's own
// PRODUCTION artifact: what a gate surface actually imports at runtime.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, posix } from "node:path";
import { listFilesRecursive } from "../lib/fs-walk.ts";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export interface Violation {
  file: string;
  kind: "non-relative-import" | "out-of-directory-import" | "forbidden-global";
  detail: string;
}

const FORBIDDEN_GLOBAL_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "process", re: /\bprocess\b/ },
  { name: "fetch(", re: /\bfetch\s*\(/ },
  { name: "setTimeout(", re: /\bsetTimeout\s*\(/ },
  { name: "setInterval(", re: /\bsetInterval\s*\(/ },
  { name: "require(", re: /\brequire\s*\(/ },
  { name: "dynamic import(", re: /\bimport\s*\(/ },
  { name: "__dirname", re: /\b__dirname\b/ },
  { name: "__filename", re: /\b__filename\b/ },
  // Issue #63 fix-now (interim regex-widening — durable AST-based check deferred, docs/backlog.md):
  // bare identifiers, flagged wherever they appear, since a string-concatenation trick can hide
  // "process" as a reassembled string argument but cannot hide the identifier reaching for it.
  { name: "globalThis", re: /\bglobalThis\b/ },
  // Issue #63 addendum (S2 re-confirm, app-security-reviewer): Node's bare `global` identifier —
  // distinct from `globalThis` — was missing, so `global["proc"+"ess"]` bypassed the check with
  // zero detections. Word-bounded, so it does not match inside `globalThis` (no boundary between
  // "global" and "This").
  { name: "global", re: /\bglobal\b/ },
  { name: "Reflect", re: /\bReflect\b/ },
  { name: "eval", re: /\beval\b/ },
  // "Function" as a constructor call only (`new Function(...)` or bare `Function(...)`) — not
  // every appearance of the word "Function" (e.g. a type annotation), which would over-flag.
  { name: "Function(", re: /\bFunction\s*\(/ },
];

/**
 * Heuristic-only comment stripping (documented as such, not claimed exhaustive — this repo's own
 * completeness-claim-checker.ts sets this precedent). Removes `/* ... *\/` block comments and
 * `//` line comments before the forbidden-globals scan, so a header comment that quotes ADR-0021
 * prose ("no filesystem, network, or process access") does not false-positive on the word
 * "process" appearing in English text rather than in real code.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

export function scanForbiddenGlobals(source: string): { name: string }[] {
  const stripped = stripComments(source);
  const found: { name: string }[] = [];
  for (const { name, re } of FORBIDDEN_GLOBAL_PATTERNS) {
    if (re.test(stripped)) found.push({ name });
  }
  return found;
}

const FROM_IMPORT_RE = /\bfrom\s+["']([^"']+)["']/g;
const BARE_IMPORT_RE = /(?:^|;)\s*import\s+["']([^"']+)["']/gm;

export function extractImportSpecifiers(source: string): string[] {
  const stripped = stripComments(source);
  const specifiers: string[] = [];
  for (const m of stripped.matchAll(FROM_IMPORT_RE)) {
    const spec = m[1];
    if (spec) specifiers.push(spec);
  }
  for (const m of stripped.matchAll(BARE_IMPORT_RE)) {
    const spec = m[1];
    if (spec) specifiers.push(spec);
  }
  return specifiers;
}

function isWithinRoot(resolvedRepoRelPath: string, root: string): boolean {
  const rel = posix.relative(root, resolvedRepoRelPath);
  return !rel.startsWith("..") && !posix.isAbsolute(rel);
}

/**
 * Classifies one import specifier found in `fileRepoRelPath` (a production file already known to
 * be under `kernelRoot`). Returns null when the import is a relative specifier that resolves
 * inside `kernelRoot`; otherwise returns the violation.
 */
export function classifyImport(specifier: string, fileRepoRelPath: string, kernelRoot: string): Violation | null {
  if (!specifier.startsWith(".")) {
    return {
      file: fileRepoRelPath,
      kind: "non-relative-import",
      detail: `import "${specifier}" is non-relative (bare package or node: builtin) — forbidden inside the kernel purity boundary`,
    };
  }

  const fileDir = posix.dirname(fileRepoRelPath);
  const resolved = posix.normalize(posix.join(fileDir, specifier));
  if (!isWithinRoot(resolved, kernelRoot)) {
    return {
      file: fileRepoRelPath,
      kind: "out-of-directory-import",
      detail: `import "${specifier}" resolves to "${resolved}", outside ${kernelRoot}/`,
    };
  }

  return null;
}

/** Combines the import-resolution and forbidden-global scans for one file's content. */
export function scanFileContent(fileRepoRelPath: string, source: string, kernelRoot: string): Violation[] {
  const violations: Violation[] = [];

  for (const specifier of extractImportSpecifiers(source)) {
    const v = classifyImport(specifier, fileRepoRelPath, kernelRoot);
    if (v) violations.push(v);
  }

  for (const g of scanForbiddenGlobals(source)) {
    violations.push({
      file: fileRepoRelPath,
      kind: "forbidden-global",
      detail: `forbidden global/pattern "${g.name}" found`,
    });
  }

  return violations;
}

/**
 * Walks every production `.ts` file under `kernelRoot` (repo-relative, e.g.
 * "src/policy/kernel") and reports every purity violation found. `repoRoot` is the absolute path
 * to scan from (so this is testable against a fixture root, not just the real kernel).
 */
export async function checkKernelPurity(repoRoot: string, kernelRoot: string): Promise<InstrumentResult> {
  const prefix = `${kernelRoot}/`;
  const files = (
    await listFilesRecursive(repoRoot, (p) => p.startsWith(prefix) && p.endsWith(".ts") && !p.endsWith(".test.ts"))
  ).sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    return {
      ok: true,
      vacuous: true,
      summary: `0 production .ts file(s) found under ${kernelRoot}/ — vacuous pass.`,
      details: [],
    };
  }

  const allViolations: Violation[] = [];
  for (const file of files) {
    const content = await readFile(join(repoRoot, file), "utf8");
    allViolations.push(...scanFileContent(file, content, kernelRoot));
  }

  if (allViolations.length > 0) {
    return {
      ok: false,
      vacuous: false,
      summary: `${allViolations.length} kernel-purity violation(s) found across ${files.length} file(s) under ${kernelRoot}/.`,
      details: allViolations.map((v) => `${v.file}: [${v.kind}] ${v.detail}`),
    };
  }

  return {
    ok: true,
    vacuous: false,
    summary: `${files.length} production .ts file(s) under ${kernelRoot}/, zero import or forbidden-global violations.`,
    details: [],
  };
}

const KERNEL_ROOT = "src/policy/kernel";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const result = await checkKernelPurity(repoRoot, KERNEL_ROOT);
  printInstrumentResult("QA kernel-purity-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
