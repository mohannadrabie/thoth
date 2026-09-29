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
// exactly the Issue #361 gap this instrument exists to close), each is held to a PINNED set of
// diagnostic IDENTITIES instead of a raw count.
//
// Issue #367 (app-security HIGH) + red-team round-3 finding R4 (2026-09-28), same defect, two
// routes: the ORIGINAL implementation compared a raw COUNT (`count > baseline`). A `// @ts-ignore`
// directly above a real new bug REMOVES that diagnostic from `ts.getPreEmitDiagnostics`'s output
// entirely — it does not trade one diagnostic for another, so the count stays exactly at baseline
// (app-security's route). Separately, paying down one unrelated pre-existing diagnostic (e.g. a
// JSDoc annotation killing one TS7006) while introducing one real new bug (e.g. a dropped required
// argument) also nets a zero count change (red-team's drill C2) — a raw count cannot tell "30
// old, unchanged" from "29 old plus 1 new" apart, and a STRICT-EQUALITY count check would not
// catch this offsetting case either (30 before, 30 after, exactly equal). FIX: pin each excepted
// hook's diagnostics as a MULTISET of stable identities (`${code}:${line}`, since this file's own
// pre-existing debt genuinely contains more than one diagnostic sharing a (code, line) pair — e.g.
// several same-line implicit-any parameters — a plain Set would silently collapse those and hide a
// new occurrence landing at an already-pinned identity), and require every CURRENT identity's
// occurrence count to be NO GREATER than its PINNED occurrence count. A truly new diagnostic (any
// identity, or an identity occurring MORE often than pinned) is individually detectable even when
// another one disappears in the same run — closing both the @ts-ignore route and the offset route,
// neither of which changes the pinned identity multiset in the direction this check requires.
// Paying down debt (an identity's current count drops below its pinned count, or disappears
// entirely) still passes silently, same as before — lowering the pin itself remains a deliberate,
// visible-in-review edit to PINNED_BASELINES, not something this instrument does automatically.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import * as ts from "typescript";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export const COVERAGE_TSCONFIG = "tsconfig.hooks-coverage.json";

/** A stable-enough diagnostic identity for ratchet purposes: the TS error code plus its 1-based
 * source line. Not a full fingerprint (two distinct diagnostics can share a (code, line) pair —
 * e.g. two separate implicit-any parameters on the same line — which is exactly why this file
 * pins a MULTISET of these, not a deduplicated Set: see PINNED_BASELINES below). A line-based
 * identity shifts when unrelated lines are inserted/removed above it — an accepted, disclosed
 * characteristic of a line-based pin (the same trade any line-anchored ratchet makes), not a
 * defect: it forces a visible, reviewable pin update whenever the surrounding code moves enough to
 * change diagnostic positions, rather than silently drifting.
 */
function diagnosticIdentity(diagnostic: ts.Diagnostic): string | undefined {
  if (!diagnostic.file || diagnostic.start === undefined) return undefined;
  const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
  return `${diagnostic.code}:${line}`;
}

/** Dated, named exception list (Issue #361): hooks held to a pinned MULTISET of diagnostic
 * identities instead of zero. Any hook NOT listed here must have zero diagnostics. Measured
 * directly against `tsconfig.hooks-coverage.json` on 2026-09-28 — every entry here is a real,
 * current diagnostic, not a guessed count; duplicates are intentional (see diagnosticIdentity's own
 * doc comment) and must be preserved when this list is ever regenerated after paying down debt. */
export const PINNED_BASELINES: Readonly<Record<string, readonly string[]>> = {
  "hooks/sessionstart-tool-enum.mjs": [
    "2322:526",
    "2339:281",
    "2339:282",
    "2339:529",
    "2339:610",
    "2339:615",
    "2339:618",
    "7006:135",
    "7006:205",
    "7006:233",
    "7006:234",
    "7006:241",
    "7006:269",
    "7006:269",
    "7006:269",
    "7006:269",
    "7006:269",
    "7006:291",
    "7006:291",
    "7006:327",
    "7006:327",
    "7006:327",
    "7006:327",
    "7006:327",
    "7006:327",
    "7006:327",
    "7006:347",
    "7006:389",
    "7006:389",
    "7006:410",
  ],
  "hooks/userpromptsubmit-halt-relay.mjs": [
    "7006:168",
    "7006:198",
    "7006:198",
    "7006:243",
    "7006:243",
    "7006:258",
    "7006:258",
    "7006:318",
    "7006:327",
    "7006:345",
    "7006:386",
    "7006:386",
    "7006:386",
    "7006:420",
    "7006:421",
    "7006:431",
    "7006:432",
    "7031:421",
    "7031:432",
    "7031:432",
    "7053:244",
    "7053:260",
  ],
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

function countByIdentity(identities: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of identities) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** Resolves the QA-only coverage project the same way `tsc` itself would (real config-file read
 * plus `ts.parseJsonConfigFileContent`, not a hand-rolled glob match), builds a real `ts.Program`
 * against it, and buckets `ts.getPreEmitDiagnostics`' findings by repo-relative file path, keeping
 * each diagnostic's own identity (not just a count) so the caller can compare multisets.
 * `configPathOverride` (absolute) lets tests point this at a temporary, self-contained project
 * instead of the real `tsconfig.hooks-coverage.json` — see the AC-13 regression test below. */
function resolveProjectAndDiagnostics(
  repoRoot: string,
  configPathOverride?: string,
): { fileNames: string[]; identitiesByFile: Map<string, string[]> } {
  const configPath = configPathOverride ?? join(repoRoot, COVERAGE_TSCONFIG);
  const readResult = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  if (readResult.error) {
    throw new Error(`failed to read ${COVERAGE_TSCONFIG}: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, "\n")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, dirname(configPath));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const identitiesByFile = new Map<string, string[]>();
  for (const d of diagnostics) {
    if (!d.file) continue;
    const identity = diagnosticIdentity(d);
    if (identity === undefined) continue;
    const rel = toRepoRelative(repoRoot, d.file.fileName);
    const list = identitiesByFile.get(rel);
    if (list) list.push(identity);
    else identitiesByFile.set(rel, [identity]);
  }
  return { fileNames: parsed.fileNames.map((f) => toRepoRelative(repoRoot, f)), identitiesByFile };
}

/**
 * `repoRelativeConfigOverride` lets tests point this at a fixture project instead of the real
 * `tsconfig.hooks-coverage.json` — same testability pattern `checkKernelPurity`'s `kernelRoot`
 * parameter and `checkNormalizerRegistryPurity`'s `registryRepoRelPath` parameter already use.
 */
export function checkHookTypecheckCoverage(
  repoRoot: string,
  hooks: string[] = listProductionHooks(repoRoot),
  pinnedBaselines: Readonly<Record<string, readonly string[]>> = PINNED_BASELINES,
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
    const currentIdentities = project.identitiesByFile.get(hook) ?? [];
    const pinned = pinnedBaselines[hook];
    if (pinned === undefined) {
      if (currentIdentities.length !== 0) {
        failures++;
        details.push(`${hook}: ${currentIdentities.length} diagnostic(s) found, expected 0 (not on the Issue #361 exception list — must be fully clean)`);
      } else {
        details.push(`${hook}: 0 diagnostic(s), fully covered`);
      }
      continue;
    }
    const currentCounts = countByIdentity(currentIdentities);
    const pinnedCounts = countByIdentity(pinned);
    const newOrExcess: string[] = [];
    for (const [identity, count] of currentCounts) {
      const allowed = pinnedCounts.get(identity) ?? 0;
      if (count > allowed) {
        const extra = count - allowed;
        newOrExcess.push(allowed === 0 ? `${identity} (new, x${extra})` : `${identity} (x${count}, pinned x${allowed}, +${extra} new)`);
      }
    }
    if (newOrExcess.length > 0) {
      failures++;
      details.push(
        `${hook}: ${currentIdentities.length} diagnostic(s) found, ${newOrExcess.length} identity(ies) exceed the pinned Issue #361 baseline — a NEW regression, not the known pre-existing debt: ${newOrExcess.join(", ")}`,
      );
    } else {
      details.push(`${hook}: ${currentIdentities.length} diagnostic(s) (pinned Issue #361 baseline: ${pinned.length}, pre-existing debt, not yet fixed)`);
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
