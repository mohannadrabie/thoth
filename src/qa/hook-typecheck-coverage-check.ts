// Issue #361 fix-now round (red-team round 2 finding R5): a generated, not hand-derived,
// enumeration of every production hook under hooks/, cross-checked against a REAL, resolved
// tsconfig project file list (ts.parseJsonConfigFileContent) — CLAUDE.md's "no hand-derived
// completeness claims" hard rule applied to "which hooks does typechecking actually cover".
//
// The 3 production hooks (hooks/*.mjs, non-recursive — hooks/*.test.ts and hooks/test-support/**
// are a different, non-production concern, same lane-scoping tsconfig.hooks.json's own header
// already establishes) are checked against tsconfig.hooks-coverage.json — a QA-ONLY project
// (never wired into `npm run build`/`npm run typecheck`) that includes all 3, unlike the real
// build gate's tsconfig.hooks.json, which includes only the one hook (pretooluse-kernel-gate.mjs)
// that's fully clean today.
//
// EXCEPTION LIST (dated, named — Issue #361, not a phantom docs/backlog.md line, red-team round 2
// finding R5): hooks/sessionstart-tool-enum.mjs and hooks/userpromptsubmit-halt-relay.mjs each
// carry pre-existing, unrelated implicit-any/type-mismatch diagnostics (measured 2026-09-28: 30
// and 22 respectively) that this fix-now round does not scope in fixing. Rather than exempting
// them from coverage entirely (which would make a NEW regression on either file invisible again —
// exactly the Issue #361 gap this instrument exists to close), each is held to a PINNED BASELINE
// instead of zero: its diagnostic count must never exceed the measured baseline below. A baseline
// DECREASE (someone paying down the debt) simply lowers the pin at that time; an INCREASE (a new
// bug, e.g. a dropped required argument — AC-13) fails loud, even though the file is not yet fully
// clean.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import * as ts from "typescript";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export const COVERAGE_TSCONFIG = "tsconfig.hooks-coverage.json";

/** Dated, named exception list (Issue #361): hooks held to a pinned diagnostic-count ceiling
 * instead of zero. Any hook NOT listed here must have exactly zero diagnostics. */
export const PINNED_BASELINES: Readonly<Record<string, number>> = {
  "hooks/sessionstart-tool-enum.mjs": 30,
  "hooks/userpromptsubmit-halt-relay.mjs": 22,
};

/** Every production hook under hooks/, generated from disk — never hand-typed (CLAUDE.md's "no
 * hand-derived completeness claims"). Non-recursive: hooks/*.test.ts and hooks/test-support/** are
 * a different, non-production concern (same lane-scoping tsconfig.hooks.json's own header already
 * establishes for `checkJs`/`allowJs`). */
export function listProductionHooks(repoRoot: string): string[] {
  return readdirSync(join(repoRoot, "hooks"))
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => `hooks/${f}`)
    .sort();
}

function toRepoRelative(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).split("\\").join("/");
}

/** Resolves the QA-only coverage project the same way `tsc` itself would (real config-file read
 * plus `ts.parseJsonConfigFileContent`, not a hand-rolled glob match), builds a real `ts.Program`
 * against it, and buckets `ts.getPreEmitDiagnostics`' findings by repo-relative file path.
 * `configPathOverride` (absolute) lets tests point this at a temporary, self-contained project
 * instead of the real `tsconfig.hooks-coverage.json` — see the AC-13 regression test below. */
function resolveProjectAndDiagnostics(
  repoRoot: string,
  configPathOverride?: string,
): { fileNames: string[]; diagnosticCountByFile: Map<string, number> } {
  const configPath = configPathOverride ?? join(repoRoot, COVERAGE_TSCONFIG);
  const readResult = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  if (readResult.error) {
    throw new Error(`failed to read ${COVERAGE_TSCONFIG}: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, "\n")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, dirname(configPath));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const diagnosticCountByFile = new Map<string, number>();
  for (const d of diagnostics) {
    if (!d.file) continue;
    const rel = toRepoRelative(repoRoot, d.file.fileName);
    diagnosticCountByFile.set(rel, (diagnosticCountByFile.get(rel) ?? 0) + 1);
  }
  return { fileNames: parsed.fileNames.map((f) => toRepoRelative(repoRoot, f)), diagnosticCountByFile };
}

/**
 * `repoRelativeConfigOverride` lets tests point this at a fixture project instead of the real
 * `tsconfig.hooks-coverage.json` — same testability pattern `checkKernelPurity`'s `kernelRoot`
 * parameter and `checkNormalizerRegistryPurity`'s `registryRepoRelPath` parameter already use.
 */
export function checkHookTypecheckCoverage(
  repoRoot: string,
  hooks: string[] = listProductionHooks(repoRoot),
  pinnedBaselines: Readonly<Record<string, number>> = PINNED_BASELINES,
  configPathOverride?: string,
): InstrumentResult {
  if (hooks.length === 0) {
    return { ok: true, vacuous: true, summary: "0 production hook(s) found under hooks/ — vacuous pass.", details: [] };
  }

  const project = resolveProjectAndDiagnostics(repoRoot, configPathOverride);
  const details: string[] = [];
  let failures = 0;

  for (const hook of hooks) {
    if (!project.fileNames.includes(hook)) {
      failures++;
      details.push(`${hook}: does not resolve inside ${COVERAGE_TSCONFIG}'s file list — no tsconfig project covers it at all`);
      continue;
    }
    const count = project.diagnosticCountByFile.get(hook) ?? 0;
    const baseline = pinnedBaselines[hook];
    if (baseline === undefined) {
      if (count !== 0) {
        failures++;
        details.push(`${hook}: ${count} diagnostic(s) found, expected 0 (not on the Issue #361 exception list — must be fully clean)`);
      } else {
        details.push(`${hook}: 0 diagnostic(s), fully covered`);
      }
    } else if (count > baseline) {
      failures++;
      details.push(`${hook}: ${count} diagnostic(s) found, exceeds its pinned Issue #361 baseline of ${baseline} — a NEW regression, not the known pre-existing debt`);
    } else {
      details.push(`${hook}: ${count} diagnostic(s) (pinned Issue #361 baseline: ${baseline}, pre-existing debt, not yet fixed)`);
    }
  }

  return {
    ok: failures === 0,
    vacuous: false,
    summary:
      failures === 0
        ? `${hooks.length} production hook(s) under hooks/, each resolves inside a tsconfig project and stays within its coverage bar.`
        : `${failures} of ${hooks.length} production hook(s) under hooks/ failed typecheck-coverage.`,
    details,
  };
}

function main(): void {
  const repoRoot = process.cwd();
  const result = checkHookTypecheckCoverage(repoRoot);
  printInstrumentResult("QA hook-typecheck-coverage-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
