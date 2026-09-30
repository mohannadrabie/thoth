// Issue #361 fix-now round (red-team round 2 finding R5): a generated, not hand-derived,
// enumeration of every production hook under hooks/, cross-checked against a REAL, resolved
// tsconfig project file list (ts.parseJsonConfigFileContent) — CLAUDE.md's "no hand-derived
// completeness claims" hard rule applied to "which hooks does typechecking actually cover".
//
// The 3 production hooks (hooks/*.mjs, non-recursive — hooks/*.test.ts and hooks/test-support/**
// are a different, non-production concern, same lane-scoping tsconfig.hooks.json's own header
// already establishes) are checked against tsconfig.hooks-coverage.json, a QA-only project
// resolved by this instrument. Since Issue #361 closed, all 3 hooks are ALSO in the real build
// gate's tsconfig.hooks.json and typecheck clean; the pinned baseline is empty. This instrument
// stays as a complementary guard: it fails CI if a NEW hook under hooks/ is not covered, and it
// scans for suppressions no compiler can see.
//
// HISTORY (kept because the ratchet mechanics below still apply to any future pinned entry): until
// Issue #361 closed (2026-09-30), hooks/sessionstart-tool-enum.mjs and
// hooks/userpromptsubmit-halt-relay.mjs carried pre-existing implicit-any/type-mismatch
// diagnostics (measured 2026-09-28: 30 and 22) and were held to a PINNED set of diagnostic
// IDENTITIES instead of a raw count, so a NEW regression stayed visible while the debt was paid down.
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
// hook's diagnostics as a MULTISET of stable identities (several diagnostics can share one identity,
// e.g. same-line implicit-any parameters, so a plain Set would collapse them and hide a new
// occurrence landing at an already-pinned identity), and require every CURRENT identity's occurrence
// count to be NO GREATER than its PINNED occurrence count. A truly new diagnostic (any identity, or
// an identity occurring MORE often than pinned) is individually detectable even when another one
// disappears in the same run. Paying down debt (an identity's count drops or disappears) passes.
//
// Issue #368 (red-team N3, 2026-09-29): the identity was `${code}:${line}`, so ANY line-count-
// changing edit above a pinned diagnostic read as N "NEW regressions" (measured: one blank line = 16;
// 89.4% of the two hooks' lines were affected), and the prescribed remediation was regenerating a
// 52-string hand-typed array that no reviewer can diff — which launders any concurrent REAL new
// diagnostic into the baseline. Now: (1) the identity is POSITION-INDEPENDENT — the error code plus
// the diagnostic's own source line, whitespace-normalised — so a cosmetic edit that only shifts
// lines changes nothing; (2) the baseline is a committed JSON snapshot
// (src/qa/hook-typecheck-baseline.json), WRITTEN BY `--regenerate-baseline`, never typed by hand
// (CLAUDE.md "no hand-derived completeness claims"); (3) that flag ratchets DOWN ONLY: it refuses
// (exit 1, snapshot untouched) if ANY identity in the current diagnostics is not already in the
// committed snapshot at that count — not merely when the total rises, since a paid-down identity plus
// a brand-new one nets zero. It prints every added/removed identity. Accepting a new identity is a
// visible, hand-made edit of the snapshot JSON, reviewed like any other change. Disclosed residual:
// editing the text of a pinned diagnostic's own line changes its identity, which reads as
// "new" — that is deliberately the same visible hand-edit path, not an automatic re-pin.
//
// Suppressions (Issue #367 / N2 / N4): none of the above can see a diagnostic that a suppression
// removes from the compiler's output. So this instrument also fails any hook containing a `@ts-*`
// pragma, an `eslint-disable` directive, or a JSDoc type the TypeScript CHECKER resolves to `any` (or an
// `Object` reference), outside 8 pinned SITES — see `scanHookSuppressions`, which also records what it
// does not catch (a double cast through `unknown`) — independent of lint config.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import * as ts from "typescript";
import type { InstrumentResult } from "../lib/instrument.ts";
import { exitCodeFor, printInstrumentResult } from "../lib/instrument.ts";

export const COVERAGE_TSCONFIG = "tsconfig.hooks-coverage.json";

/** The committed baseline snapshot: generated by `--regenerate-baseline`, hand-edited only to accept
 * a new identity in a reviewed change. */
export const BASELINE_SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), "hook-typecheck-baseline.json");

/** One pinned identity: the TS error code, the whitespace-normalised source line the diagnostic
 * starts on, and how many diagnostics share that identity. */
export interface BaselineEntry {
  code: number;
  excerpt: string;
  count: number;
}
export interface BaselineSnapshot {
  version: 1;
  /** Keyed `pinned`, not `hooks`: qa:gate-manifest (SUR-13) treats any JSON with a top-level "hooks" key as a gate manifest. */
  pinned: Record<string, BaselineEntry[]>;
}

/** A diagnostic identity, position-independent (Issue #368): `${code}|${normalised line text}`. */
function identityKey(code: number, excerpt: string): string {
  return `${code}|${excerpt}`;
}

const EXCERPT_CAP = 200;

interface DiagnosticInfo {
  key: string;
  code: number;
  line: number;
  excerpt: string;
}

function describeDiagnostic(diagnostic: ts.Diagnostic): DiagnosticInfo | undefined {
  if (!diagnostic.file || diagnostic.start === undefined) return undefined;
  const file = diagnostic.file;
  const lineIndex = file.getLineAndCharacterOfPosition(diagnostic.start).line;
  const lineStarts = file.getLineStarts();
  const from = lineStarts[lineIndex] ?? 0;
  const to = lineStarts[lineIndex + 1] ?? file.text.length;
  const excerpt = file.text.slice(from, to).replace(/\s+/g, " ").trim().slice(0, EXCERPT_CAP);
  return { key: identityKey(diagnostic.code, excerpt), code: diagnostic.code, line: lineIndex + 1, excerpt };
}

function parseSnapshot(text: string, where: string): BaselineSnapshot {
  const parsed = JSON.parse(text) as Partial<BaselineSnapshot>;
  if (parsed.version !== 1 || typeof parsed.pinned !== "object" || parsed.pinned === null) {
    throw new Error(`${where}: not a version-1 hook-typecheck baseline snapshot`);
  }
  return parsed as BaselineSnapshot;
}

function expandSnapshot(snapshot: BaselineSnapshot): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const [hook, entries] of Object.entries(snapshot.pinned)) {
    out[hook] = entries.flatMap((e) => Array.from({ length: e.count }, () => identityKey(e.code, e.excerpt)));
  }
  return out;
}

/** Hooks held to a pinned MULTISET of diagnostic identities instead of zero (empty since Issue #361 closed), loaded from the committed, generated snapshot
 * (src/qa/hook-typecheck-baseline.json). Any hook NOT listed must have zero diagnostics. Each
 * identity appears once per occurrence (duplicates are intentional: see the header). */
export const PINNED_BASELINES: Readonly<Record<string, readonly string[]>> = existsSync(BASELINE_SNAPSHOT_PATH)
  ? expandSnapshot(parseSnapshot(readFileSync(BASELINE_SNAPSHOT_PATH, "utf8"), BASELINE_SNAPSHOT_PATH))
  : {}; // a missing snapshot pins nothing: every hook must then be fully clean (fails safe), and `--regenerate-baseline <hook...>` can bootstrap it

/** Every production hook under hooks/, generated from disk — never hand-typed (CLAUDE.md's "no
 * hand-derived completeness claims"). Non-recursive: hooks/*.test.ts and hooks/test-support/** are
 * a different, non-production concern (same lane-scoping tsconfig.hooks.json's own header already
 * establishes for `checkJs`/`allowJs`). `.mjs` AND `.js` (red-team N5, 2026-09-29): package.json is
 * "type": "module", so a hooks/*.js file is ESM and runs as a hook unchanged — the extension must
 * not be the way out of coverage, linting or the suppression scan. */
export function listProductionHooks(repoRoot: string): string[] {
  return readdirSync(join(repoRoot, "hooks"))
    .filter((f) => f.endsWith(".mjs") || f.endsWith(".js"))
    .map((f) => `hooks/${f}`)
    .sort();
}

/** One reviewed exception to the JSDoc `any` ban (Issue #374), keyed by SITE, not annotation text: a
 * hook annotation that stays `any` because it types an untrusted JSON-input shape whose narrowing
 * would need a runtime code-token change in a hook whose inline sanitize copy must stay token-identical
 * (Issue #361 AC-7: JSDoc-only). `site` is `<enclosing function>: @<tag> <target>` (target = the
 * parameter/variable/property the tag types, empty for `@returns`), so moving an allowed `any` to a
 * different function or parameter is a NEW site and fails, even when the annotation text and the
 * count are unchanged. `count` is the exact number of any-typed type nodes at that site. Extending
 * this list is a visible edit, mirrored by the exact-contents pin in
 * hook-typecheck-coverage-check.round3.test.ts. */
export interface JsdocAnyAllowance {
  hook: string;
  site: string;
  count: number;
  reason: string;
}
export const JSDOC_ANY_ALLOWLIST: readonly JsdocAnyAllowance[] = [
  { hook: "hooks/pretooluse-kernel-gate.mjs", site: "failClosed: @param err", count: 1, reason: "a thrown value can be any shape; the handler deliberately probes it defensively" },
  { hook: "hooks/sessionstart-tool-enum.mjs", site: "wasReasonActive: @param initialHaltState", count: 1, reason: "untrusted halt-state JSON read from disk; every property access is guarded at runtime" },
  { hook: "hooks/sessionstart-tool-enum.mjs", site: "reconcileReason: @param initialHaltState", count: 1, reason: "same untrusted halt-state JSON, passed on to the reconciler" },
  { hook: "hooks/sessionstart-tool-enum.mjs", site: "isProjectMcpServerEnabled: @param projectSettings", count: 1, reason: "untrusted .claude/settings.json content; shape-checked at runtime" },
  { hook: "hooks/userpromptsubmit-halt-relay.mjs", site: "inspectHaltState: @param haltState", count: 1, reason: "untrusted halt-state JSON; inspectHaltState is the runtime shape validator, and narrowing needs a code-token change in the relay" },
  { hook: "hooks/userpromptsubmit-halt-relay.mjs", site: "inspectHaltState: @type activeReasons", count: 1, reason: "activeReasons entries are validated JSON entries, produced by inspectHaltState" },
  { hook: "hooks/userpromptsubmit-halt-relay.mjs", site: "composeTrustedSummary: @param activeReasons", count: 1, reason: "same validated entries, passed on to the trusted-summary renderer" },
  { hook: "hooks/userpromptsubmit-halt-relay.mjs", site: "composeDiagnosticLines: @param activeReasons", count: 1, reason: "same validated entries, passed on to the diagnostic-lines renderer" },
];

/** A program plus the absolute path of the hook source file being scanned inside it. */
export interface ScanContext {
  program: ts.Program;
  fileName: string;
}

interface JsdocAnyHit {
  site: string;
  /** `@param {any} x`-style text for the finding message. */
  text: string;
  kind: "any" | "Object";
}

function isFunctionLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n);
}

function functionName(fn: ts.FunctionLikeDeclaration): string {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return "<anonymous>";
}

/** The function a JSDoc block belongs to: the annotated function itself, else the nearest enclosing one. */
function enclosingFunctionName(owner: ts.Node): string {
  for (let n: ts.Node | undefined = owner; n; n = n.parent) if (isFunctionLike(n)) return functionName(n);
  return "<module>";
}

function tagTarget(tag: ts.JSDocTag, owner: ts.Node, sf: ts.SourceFile): string {
  const name = (tag as { name?: ts.Node }).name;
  if (name) return name.getText(sf);
  if (ts.isVariableStatement(owner)) {
    const decl = owner.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return "";
}

/** Every JSDoc type node (any tag, any position, either `@param` order, nested in generics, unions,
 * `@typedef` properties and `@callback` signatures) whose type the CHECKER resolves to `any`, plus any
 * explicit `Object` reference. Spelling-independent by construction: `{?}`, `{*}`, `{any}`, `{"}" | any}`,
 * a type on the next line, an alias, `ReturnType<typeof JSON.parse>` are all just types that resolve to
 * `any`. A flagged `any` node is not descended into, so `{"}" | any}` (a union that absorbs to `any`)
 * is one hit. */
function collectJsdocAnySites(program: ts.Program, sf: ts.SourceFile): JsdocAnyHit[] {
  const checker = program.getTypeChecker();
  const hits: JsdocAnyHit[] = [];
  const seenTags = new Set<number>();
  const visitType = (n: ts.Node, tag: ts.JSDocTag, owner: ts.Node): void => {
    const isTypeLike = ts.isTypeNode(n) || n.kind === ts.SyntaxKind.JSDocAllType || n.kind === ts.SyntaxKind.JSDocUnknownType;
    if (isTypeLike) {
      const kind: "any" | "Object" | undefined =
        checker.getTypeFromTypeNode(n as ts.TypeNode).flags & ts.TypeFlags.Any
          ? "any"
          : ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && n.typeName.text === "Object"
            ? "Object"
            : undefined;
      if (kind !== undefined) {
        const target = tagTarget(tag, owner, sf);
        const site = `${enclosingFunctionName(owner)}: @${tag.tagName.text}${target ? ` ${target}` : ""}`;
        const typeText = n.getText(sf).replace(/\s+/g, " ");
        hits.push({ site, kind, text: `@${tag.tagName.text} {${typeText}}${target ? ` ${target}` : ""}` });
        if (kind === "any") return;
      }
    }
    ts.forEachChild(n, (c) => visitType(c, tag, owner));
  };
  const visit = (node: ts.Node): void => {
    for (const doc of (node as { jsDoc?: ts.JSDoc[] }).jsDoc ?? []) {
      for (const tag of doc.tags ?? []) {
        if (seenTags.has(tag.pos)) continue;
        seenTags.add(tag.pos);
        const expr = (tag as { typeExpression?: ts.Node }).typeExpression;
        if (expr) visitType(expr, tag, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

// One in-memory program per scan of a bare source string (tests, ad-hoc use). The virtual file lives
// at <cwd>/hooks/ so relative `import("../src/...")` types resolve like a real hook's; every other
// file (lib.d.ts, imported modules) is read from disk once and cached.
let virtualScanOptions: ts.CompilerOptions | undefined;
const diskSourceCache = new Map<string, ts.SourceFile | undefined>();
const slashed = (p: string): string => p.split("\\").join("/");
function scanContextForSource(source: string): ScanContext {
  if (virtualScanOptions === undefined) {
    const cfgPath = join(process.cwd(), COVERAGE_TSCONFIG);
    const read = ts.readConfigFile(cfgPath, (p) => ts.sys.readFile(p));
    virtualScanOptions = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(cfgPath)).options;
  }
  const fileName = slashed(join(process.cwd(), "hooks", "__jsdoc-scan__.mjs"));
  const host = ts.createCompilerHost(virtualScanOptions);
  const realGetSourceFile = host.getSourceFile.bind(host);
  const realFileExists = host.fileExists.bind(host);
  const realReadFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersionOrOptions, ...rest) => {
    if (slashed(name) === fileName) return ts.createSourceFile(name, source, languageVersionOrOptions, true, ts.ScriptKind.JS);
    if (!diskSourceCache.has(name)) diskSourceCache.set(name, realGetSourceFile(name, languageVersionOrOptions, ...rest));
    return diskSourceCache.get(name);
  };
  host.fileExists = (name) => slashed(name) === fileName || realFileExists(name);
  host.readFile = (name) => (slashed(name) === fileName ? source : realReadFile(name));
  return { program: ts.createProgram({ rootNames: [fileName], options: virtualScanOptions, host }), fileName };
}

/** Type-suppression CLASS scan (Issue #367 + red-team N2/N4, app-security finding 1, 2026-09-29;
 * JSDoc-any half rebuilt on the TypeScript checker by Issue #374 round 3, 2026-09-30).
 *
 * WHAT IT CATCHES: (1) every `@ts-*` pragma and any `eslint-disable` directive (a text scan: a
 * suppression removes a diagnostic from the compiler's output, so nothing downstream can see it);
 * (2) every JSDoc type node, in any tag and any position, that the checker resolves to `any` (`{any}`,
 * `{?}`, `{*}`, unions and aliases that absorb to any, lib-derived any such as
 * `ReturnType<typeof JSON.parse>`), excused only by an exact-count SITE in JSDOC_ANY_ALLOWLIST for the
 * named `hook`; (3) an explicit `Object` reference in a JSDoc type: not `any` under strict, so the
 * checker does not subsume it, and it stays a separate type-node-level ban that is never allow-listed.
 *
 * WHAT IT DOES NOT CATCH (recorded residuals): a double cast through `unknown` in runtime-visible code,
 * for example `/** @type {Foo} *\/ (/** @type {unknown} *\/ (x))`, is a legitimate `unknown` plus a
 * legitimate narrowing and sits outside the JSDoc-`any` class; and a JSDoc block the TypeScript parser
 * does not attach to any node is not compiled either, so it is not seen. Returns one finding per
 * distinct hit, empty when the source is clean. */
export function scanHookSuppressions(
  source: string,
  hook?: string,
  allowlist: readonly JsdocAnyAllowance[] = JSDOC_ANY_ALLOWLIST,
  context?: ScanContext,
): string[] {
  const findings: string[] = [];
  const pragma = /@ts-(?:ignore|expect-error|nocheck|check)\b/.exec(source);
  if (pragma) findings.push(pragma[0]);
  if (/eslint-disable/.test(source)) findings.push("eslint-disable");

  const ctx = context ?? scanContextForSource(source);
  const sf = ctx.program.getSourceFile(ctx.fileName);
  if (!sf) return [...findings, `${ctx.fileName}: not in the scan program (its JSDoc types cannot be checked)`];
  const allowed = new Map<string, number>();
  for (const a of allowlist) if (a.hook === hook) allowed.set(a.site, (allowed.get(a.site) ?? 0) + a.count);
  const seen = new Map<string, number>();
  const reported = new Set<string>();
  for (const hit of collectJsdocAnySites(ctx.program, sf)) {
    const key = `${hit.kind}|${hit.site}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (hit.kind === "any" && n <= (allowed.get(hit.site) ?? 0)) continue;
    if (reported.has(key)) continue;
    reported.add(key);
    findings.push(`${hit.text} [site ${hit.site}]`);
  }
  return findings;
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
 * instead of the real `tsconfig.hooks-coverage.json` — see the AC-13 regression test. */
function resolveProjectAndDiagnostics(
  repoRoot: string,
  configPathOverride?: string,
): { fileNames: string[]; diagnosticsByFile: Map<string, DiagnosticInfo[]>; program: ts.Program } {
  const configPath = configPathOverride ?? join(repoRoot, COVERAGE_TSCONFIG);
  const readResult = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  if (readResult.error) {
    throw new Error(`failed to read ${COVERAGE_TSCONFIG}: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, "\n")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, dirname(configPath));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const diagnosticsByFile = new Map<string, DiagnosticInfo[]>();
  for (const d of diagnostics) {
    const info = describeDiagnostic(d);
    if (info === undefined || !d.file) continue;
    const rel = toRepoRelative(repoRoot, d.file.fileName);
    const list = diagnosticsByFile.get(rel);
    if (list) list.push(info);
    else diagnosticsByFile.set(rel, [info]);
  }
  return { fileNames: parsed.fileNames.map((f) => toRepoRelative(repoRoot, f)), diagnosticsByFile, program };
}

/**
 * `jsdocAnyAllowlist` (tests only) re-keys the reviewed allow-list for a mutated COPY of a real
 * hook living at a temporary path. `configPathOverride` lets tests point this at a fixture project instead of the real
 * `tsconfig.hooks-coverage.json` — same testability pattern `checkKernelPurity`'s `kernelRoot`
 * parameter and `checkNormalizerRegistryPurity`'s `registryRepoRelPath` parameter already use.
 */
export function checkHookTypecheckCoverage(
  repoRoot: string,
  hooks: string[] = listProductionHooks(repoRoot),
  pinnedBaselines: Readonly<Record<string, readonly string[]>> = PINNED_BASELINES,
  configPathOverride?: string,
  jsdocAnyAllowlist: readonly JsdocAnyAllowance[] = JSDOC_ANY_ALLOWLIST,
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
    const abs = resolve(repoRoot, hook);
    const suppressions = scanHookSuppressions(readFileSync(abs, "utf8"), hook, jsdocAnyAllowlist, { program: project.program, fileName: abs });
    if (suppressions.length > 0) {
      failures++;
      details.push(
        `${hook}: type-suppression found (${suppressions.join(", ")}) — a suppression removes a real diagnostic from the compiler's output, which no baseline can see. Unlock: delete the suppression and fix the diagnostic (or pin it by a reviewed hand edit of the baseline snapshot).`,
      );
      continue;
    }
    const current = project.diagnosticsByFile.get(hook) ?? [];
    const pinned = pinnedBaselines[hook];
    if (pinned === undefined) {
      if (current.length !== 0) {
        failures++;
        details.push(`${hook}: ${current.length} diagnostic(s) found, expected 0 (no pinned baseline for this hook, so it must be fully clean)`);
      } else {
        details.push(`${hook}: 0 diagnostic(s), fully covered`);
      }
      continue;
    }
    const pinnedCounts = countByIdentity(pinned);
    const currentCounts = countByIdentity(current.map((d) => d.key));
    const newOrExcess: string[] = [];
    for (const [key, count] of currentCounts) {
      const allowed = pinnedCounts.get(key) ?? 0;
      if (count > allowed) {
        const extra = count - allowed;
        const example = current.find((d) => d.key === key);
        const where = example ? `${example.code}:${example.line}` : key;
        const text = example ? ` [${example.excerpt}]` : "";
        newOrExcess.push(allowed === 0 ? `${where} (new, x${extra})${text}` : `${where} (x${count}, pinned x${allowed}, +${extra} new)${text}`);
      }
    }
    if (newOrExcess.length > 0) {
      failures++;
      details.push(
        `${hook}: ${current.length} diagnostic(s) found, ${newOrExcess.length} identity(ies) exceed the pinned baseline — a NEW diagnostic, not one already accepted in src/qa/hook-typecheck-baseline.json: ${newOrExcess.join(", ")}`,
      );
    } else {
      details.push(
        pinned.length === 0
          ? `${hook}: 0 diagnostic(s), fully covered (empty pinned baseline)`
          : `${hook}: ${current.length} diagnostic(s) (pinned baseline: ${pinned.length}, none new)`,
      );
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

export interface RegenerateOptions {
  repoRoot: string;
  /** Defaults to the committed snapshot. */
  snapshotPath?: string;
  /** Hooks to (re)measure. Defaults to the hooks already in the snapshot; REQUIRED when there is no snapshot file yet. */
  hooks?: string[];
  /** Fixture project instead of tsconfig.hooks-coverage.json (tests). */
  configPathOverride?: string;
  /** Default true; false measures and reports without writing. */
  write?: boolean;
}
export interface RegenerateResult {
  ok: boolean;
  /** Identities present now but not in the committed snapshot at that count, `code|line text (+n)`. */
  added: string[];
  /** Identities in the committed snapshot no longer present (paid down), `code|line text (-n)`. */
  removed: string[];
  refusal?: string;
}

function entriesFromDiagnostics(diagnostics: DiagnosticInfo[]): BaselineEntry[] {
  const byKey = new Map<string, BaselineEntry>();
  for (const d of diagnostics) {
    const e = byKey.get(d.key);
    if (e) e.count++;
    else byKey.set(d.key, { code: d.code, excerpt: d.excerpt, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => a.code - b.code || (a.excerpt < b.excerpt ? -1 : a.excerpt > b.excerpt ? 1 : 0));
}

/** Rewrites the baseline snapshot from the MEASURED diagnostics — and only ever ratchets DOWN. It
 * REFUSES (snapshot untouched) if any current identity is not already in the committed snapshot at
 * that count, even when the total does not rise (a paid-down identity plus a brand-new one nets zero
 * and would otherwise launder the new one in). Accepting a new identity is a visible hand edit of the
 * snapshot JSON, reviewed like any change. It also refuses a hook that carries a suppression, since
 * pinning around a hidden diagnostic is the same laundering. With NO snapshot file at all, an
 * explicit `hooks` list bootstraps one. */
export function regenerateBaseline(options: RegenerateOptions): RegenerateResult {
  const snapshotPath = options.snapshotPath ?? BASELINE_SNAPSHOT_PATH;
  const committed = existsSync(snapshotPath) ? parseSnapshot(readFileSync(snapshotPath, "utf8"), snapshotPath) : undefined;
  const hooks = options.hooks ?? (committed ? Object.keys(committed.pinned) : []);
  if (hooks.length === 0) {
    return {
      ok: false,
      added: [],
      removed: [],
      refusal: `no baseline snapshot at ${snapshotPath} and no hooks named: pass the excepted hook paths to bootstrap one (\`--regenerate-baseline hooks/<name>.mjs ...\`).`,
    };
  }

  const project = resolveProjectAndDiagnostics(options.repoRoot, options.configPathOverride);
  const added: string[] = [];
  const removed: string[] = [];
  const nextHooks: Record<string, BaselineEntry[]> = { ...(committed?.pinned ?? {}) };
  for (const hook of hooks) {
    if (!project.fileNames.includes(hook)) {
      return { ok: false, added, removed, refusal: `${hook}: does not resolve inside ${COVERAGE_TSCONFIG}'s file list — nothing to measure.` };
    }
    const abs = resolve(options.repoRoot, hook);
    const suppressions = scanHookSuppressions(readFileSync(abs, "utf8"), hook, JSDOC_ANY_ALLOWLIST, { program: project.program, fileName: abs });
    if (suppressions.length > 0) {
      return { ok: false, added, removed, refusal: `${hook}: contains a type-suppression (${suppressions.join(", ")}); remove it before re-pinning — a baseline generated around a hidden diagnostic launders it.` };
    }
    const current = entriesFromDiagnostics(project.diagnosticsByFile.get(hook) ?? []);
    const pinnedCounts = new Map((committed?.pinned[hook] ?? []).map((e) => [identityKey(e.code, e.excerpt), e.count]));
    const currentCounts = new Map(current.map((e) => [identityKey(e.code, e.excerpt), e.count]));
    for (const [key, count] of currentCounts) {
      const allowed = pinnedCounts.get(key) ?? 0;
      if (count > allowed) added.push(`${hook}: ${key} (+${count - allowed})`);
    }
    for (const [key, count] of pinnedCounts) {
      const now = currentCounts.get(key) ?? 0;
      if (now < count) removed.push(`${hook}: ${key} (-${count - now})`);
    }
    nextHooks[hook] = current;
  }

  if (committed && added.length > 0) {
    return {
      ok: false,
      added,
      removed,
      refusal: `refusing to regenerate: ${added.length} identity(ies) are not in the committed snapshot. This flag only ratchets DOWN. If the new diagnostic is intended, add it by a visible hand edit of ${relative(options.repoRoot, snapshotPath).split("\\").join("/")} in a reviewed change; otherwise fix the diagnostic.`,
    };
  }

  const sortedHooks: Record<string, BaselineEntry[]> = {};
  for (const hook of Object.keys(nextHooks).sort()) sortedHooks[hook] = nextHooks[hook] ?? [];
  if (options.write !== false) {
    const snapshot: BaselineSnapshot = { version: 1, pinned: sortedHooks };
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }
  return { ok: true, added, removed };
}

function main(): void {
  const repoRoot = process.cwd();
  const flag = process.argv.indexOf("--regenerate-baseline");
  if (flag !== -1) {
    const named = process.argv.slice(flag + 1);
    const result = regenerateBaseline({ repoRoot, ...(named.length > 0 ? { hooks: named } : {}) });
    for (const line of result.added) console.log(`ADDED   ${line}`);
    for (const line of result.removed) console.log(`REMOVED ${line}`);
    if (!result.ok) {
      console.log(`[QA hook-typecheck-coverage-check] REFUSED: ${result.refusal ?? "see above"}`);
      process.exit(1);
    }
    console.log(`[QA hook-typecheck-coverage-check] baseline snapshot written (${result.removed.length} identity(ies) paid down, ${result.added.length} added).`);
    process.exit(0);
  }
  const result = checkHookTypecheckCoverage(repoRoot);
  printInstrumentResult("QA hook-typecheck-coverage-check", result);
  process.exit(exitCodeFor(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
