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
// Issue #63 AST hardening (S2, story-implementer build, Manager Q1 ruling 2026-09-17): the regex
// layer above is necessarily literal-text matching and stays exactly as-is (cheap, and it still
// catches the common case) — this is an ADDITIVE second layer, not a replacement. Alongside it,
// `scanForbiddenGlobalsAst` runs a real syntax-aware pass (`ts.createSourceFile`, syntax-only, no
// type-checker/Program) that resolves identifier ALIASES and reassignments back to nine tracked
// forbidden roots — globalThis, global, Reflect, eval, Function, plus (per the Manager's Q1
// ruling, extending ADR-0021 POL-11's own named forbidden categories: network, timer,
// process-spawning) fetch, setTimeout, setInterval, require — and flags:
//   (a) a destructure bound directly off a forbidden root (`const { get } = Reflect`) — the
//       destructure itself is the violation, independent of how the bound name is later used;
//   (b) a property or computed/bracket element access on a forbidden root OR any local alias of
//       one, transitively (`const g = globalThis; g["eval"]`) — a bracket key is constant-folded
//       (a string literal, or a `+`-chain of string literals only) purely to describe it in the
//       violation detail; a non-literal/dynamic key is still flagged, because it's the base object
//       reached that's forbidden, not the key;
//   (c) a DIRECT CALL through a forbidden root or a tracked alias of one, with no property/element
//       access on the callee itself (`fetch(url)`, or `const f = fetch; f(url)`) — Issue #211
//       fix-now. This is the dominant real invocation shape for `fetch`/`setTimeout`/
//       `setInterval`/`require` specifically (property/element access on them, e.g. `.bind`/
//       `.name`, is the unrealistic case) — without this branch, the alias-tracking the Q1 ruling
//       added for exactly those four roots was nullified against their own primary attack surface;
//   (d) the `<expr>.constructor.constructor(...)` prototype-pivot call — Issue #210 fix-now,
//       re-confirm fix-now (2026-09-17, closes the bracket-notation bypass below). A
//       root-INDEPENDENT check: any adjacent two-hop `.constructor`-then-`.constructor` access
//       chain immediately called is itself the violation, regardless of what `<expr>` is AND
//       regardless of whether each hop is written with dot notation, bracket notation
//       (`["constructor"]`, constant-folded), or a mix of the two — this is the textbook
//       `Function`-constructor-via-prototype-pivot sandbox escape
//       (`({}).constructor.constructor("return this")()`, or the identical
//       `({})["constructor"]["constructor"]("return this")()`), which reaches `globalThis`/
//       arbitrary code execution without ever writing any of the 9 tracked root identifiers as
//       literal text, anywhere, even in a string — so alias/root tracking structurally cannot
//       catch it, and this is a distinct detection rule, not an extension of (a)-(c). Deliberately
//       narrow to the exact adjacent-token shape (verified against this repo's own
//       `src/policy/kernel/**` production code and every `clean/` self-test fixture: zero matches,
//       so zero false-positive risk from adding it) — a single-level `.constructor` access/call
//       (`x.constructor(...)`, `x["constructor"]()`, or `x.constructor.name`) is NOT flagged, only
//       the double chain immediately called.
// Both layers feed the same `"forbidden-global"` violation kind. Disclosed residual of the AST
// layer (documented, not guessed past — same convention `stripComments` below already uses): a
// fully dynamic/runtime-computed identifier or property name (built at runtime from a value with
// no static string form) is inherently unresolvable by static analysis and stays undetected here,
// same as in the regex layer.
//
// (d)'s prototype-pivot check, re-confirm fix-now (Issue #210, app-security-reviewer,
// 2026-09-17): the original dot-only chain resolution (`.constructor.constructor(...)`) left an
// undisclosed, easier bypass — the identical escape written with bracket notation instead
// (`({})["constructor"]["constructor"]("return this")()`), or any mixed dot/bracket chain,
// required no variable-splitting or aliasing at all. Both hops of the two-deep chain are now
// resolved generically (`asConstructorAccess`): a property name OR a constant-folded bracket key
// equal to `"constructor"`, in any combination, dot/dot, bracket/bracket, or mixed — so
// `obj.constructor.constructor(...)`, `obj["constructor"]["constructor"](...)`, and
// `obj.constructor["constructor"](...)` all funnel through the same check now. Remaining
// disclosed residual, honestly narrower than before but not fully closed: the check is still
// syntactic/adjacent-token-only and does not track aliases of `.constructor` itself — splitting
// the chain across two variables (`const step1 = ({}).constructor; const step2 =
// step1.constructor; step2("return this")();`) is still NOT caught, in either notation, because it
// never writes the literal two-hop chain in one expression. Neither this residual nor the
// resolved-globals gap above is a defect in what shipped; both are inherent-limit/scope
// disclosures, same footing as the regex layer's own literal-text limits.
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
import * as ts from "typescript";
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
 * Lexer-derived comment stripping. Removes `/* ... *\/` block comments and `//` line comments
 * before the forbidden-globals and import-specifier scans, so a header comment that quotes
 * ADR-0021 prose ("no filesystem, network, or process access") does not false-positive on the
 * word "process" appearing in English text rather than in real code.
 *
 * Issue #359/#312 fix-now (red-team F1/F2, 2026-09-28): the ORIGINAL implementation was two
 * sequential regex passes — strip every `/* *\/` block first, THEN strip every `//` line — which
 * let a `//` line comment whose text happened to contain a `/*`-shaped substring (e.g. a glob
 * written in prose, `src/policy/kernel/**`) be read as a REAL block-comment opener, silently
 * swallowing real code up to the next unrelated `*\/`. The immediate fix-now (a single
 * left-to-right hand-rolled scan) closed that specific interaction but was still character-level,
 * not lexical: it had no notion of a string, template, or regex literal, so a STRING literal
 * containing a `/*`-shaped substring (a path glob assigned to a constant, not written in a
 * comment) reopened the identical blind spot one token kind later — Issue #362/#363 (red-team
 * round 2 finding R1, 2026-09-28).
 *
 * FIX: derive stripComments from `ts.createScanner`'s own tokenization instead of any hand-rolled
 * character scan. The scanner already knows how to find the end of a string, template, or
 * no-substitution-template literal without being fooled by `/*` or `//`-shaped bytes inside it
 * (that is what tokenizing a language means); comment trivia is returned as its own token kind
 * (`SingleLineCommentTrivia` / `MultiLineCommentTrivia`, since the scanner is constructed with
 * `skipTrivia: false`) and every other token's raw text is copied through unchanged. This removes
 * the entire class of bugs above at once: neither a `//` inside a real string/template, nor a
 * `/*`-shaped substring inside one, can ever be misread as a comment opener, because the scanner
 * never treats string/template content as anything but the literal it is.
 *
 * DISCLOSED RESIDUAL (documented, not guessed past — same convention this file's forbidden-globals
 * AST layer already uses; widened Issue #362/#363 fix-now round 2, red-team round-3 finding R5,
 * after the original wording named only the first of three demonstrated shapes): the raw scanner,
 * used standalone without a parser driving it, resolves a bare `/` as division (`SlashToken`),
 * never as the start of a regex literal, unless the caller explicitly calls `reScanSlashToken()` at
 * a grammar position where a regex is valid — this function does not, so it does not attempt
 * regex-literal recognition. Three demonstrated exploitable shapes, all requiring a regex literal
 * (not a comment) whose text is misread once the leading `/` is taken as division:
 *   1. A character class containing an UNESCAPED, adjacent `//` (`/[//]/` — legal JS: `/` need not
 *      be escaped inside `[...]`), misread as a line-comment start.
 *   2. A regex containing an escaped block-comment opener (`/a\/\*b/`) — the `\/` is misread as
 *      division-then-a-real-`/`, and the following `*` is then read as opening a REAL block
 *      comment that swallows everything up to the next unrelated `*` `/` pair, across lines.
 *   3. A regex ENDING in an escaped slash immediately before its closing delimiter
 *      (`/(^|\/)config\//`, byte sequence `\//`) — the final `\/` is misread the same way, and the
 *      two characters immediately after it are read as a `//` line comment, blinding the REST OF
 *      THAT LINE (this is the shape red-team round-3's drill N7b planted in a new kernel file,
 *      hiding a live `process.env` read from the regex-dependent forbidden-globals layer — closed
 *      independently by adding `process` to the AST layer's `FORBIDDEN_ROOTS` below, which parses
 *      `source` directly and is not vulnerable to this residual at all).
 * Measured, not assumed: zero regex literals of any shape exist today in the three lanes this
 * function's production consumers enforce (`src/policy/kernel/**`, `src/policy/normalizer/registry.ts`,
 * `src/policy/gate/**` production sources) — see the differential tests in kernel-purity-check.test.ts,
 * which oracle this function against an independent full-parse comment extraction (immune to this
 * residual, since the real parser resolves regex-vs-divide with grammar context) on every file in
 * those lanes, AND (red-team round-3 finding R5, a second, wider correction: an earlier version of
 * this disclosure claimed "a future 4th consumer only needs to be added" as though this covered
 * every consumer — it does not) a SEPARATE, wider differential in the same test file checks the
 * DANGEROUS direction only (real code lost) against every `.ts`/`.mjs`/`.js` source under `src/`
 * and `hooks/`, not only the three enforced lanes. `stripComments` has at least 8 importers today;
 * `src/policy/tools/classification-builtin-override.test.ts`'s Issue #332 single-merge-site scanner
 * alone runs it over 104 production files with no per-lane differential of its own — the wider,
 * all-source differential is what actually backstops that consumer, not the three-lane one.
 */
export function stripComments(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ false, ts.LanguageVariant.Standard, source);
  const parts: string[] = [];
  // A plain `.scan()` loop does not know when a `}` closes a template-literal substitution
  // (`${...}`) rather than an ordinary block/object brace — that disambiguation normally comes
  // from the PARSER driving the scanner via `reScanTemplateToken()`, which this function has no
  // parser for. Without it, the `}` closing e.g. `` `text ${expr}` `` is mis-read as a plain
  // CloseBraceToken, and the scanner then hunts for the NEXT bare backtick to start what it thinks
  // is a fresh template literal — swallowing everything in between (including real code and real
  // comments) as one bogus string-like token, verbatim. This stack tracks which currently-open `{`
  // was opened by a template substitution (push `true`) vs. an ordinary brace (push `false`), so a
  // matching `}` can be correctly re-scanned as a `TemplateMiddle`/`TemplateTail` continuation —
  // the same bookkeeping the real parser does, just scoped to this one disambiguation.
  const templateBraceStack: boolean[] = [];
  let kind = scanner.scan();
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    if (kind === ts.SyntaxKind.CloseBraceToken && templateBraceStack.pop() === true) {
      kind = scanner.reScanTemplateToken(/* isTaggedTemplate */ false);
    }
    if (kind === ts.SyntaxKind.TemplateHead || kind === ts.SyntaxKind.TemplateMiddle) {
      templateBraceStack.push(true);
    } else if (kind === ts.SyntaxKind.OpenBraceToken) {
      templateBraceStack.push(false);
    }
    if (kind !== ts.SyntaxKind.SingleLineCommentTrivia && kind !== ts.SyntaxKind.MultiLineCommentTrivia) {
      parts.push(scanner.getTokenText());
    }
    kind = scanner.scan();
  }
  return parts.join("");
}

/**
 * Independent oracle for `stripComments`, used ONLY by the differential tests below (never by
 * production code) — deliberately a DIFFERENT code path, not a call into `stripComments` itself,
 * so a bug shared by both would not silently cancel out. Rather than a token-loop, this walks a
 * full parse tree (`ts.createSourceFile`, which resolves regex-vs-divide correctly because the
 * real parser drives the scanner with grammar context — the one residual `stripComments` above
 * discloses) and extracts every comment range via `ts.getLeadingCommentRanges` /
 * `ts.getTrailingCommentRanges` at each token's own boundaries, walking EVERY token (not just
 * semantic AST nodes) via `getChildren()` so a comment sitting before a bare punctuation token
 * (e.g. a closing paren with no comment-bearing sibling node) is still found.
 */
export function stripCommentsAstOracle(source: string): string {
  const sourceFile = ts.createSourceFile("stripComments-oracle.ts", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const ranges: { pos: number; end: number }[] = [];
  const seen = new Set<string>();

  function collect(found: readonly ts.CommentRange[] | undefined): void {
    for (const r of found ?? []) {
      const key = `${r.pos}:${r.end}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranges.push({ pos: r.pos, end: r.end });
      }
    }
  }

  // Issue #366/#367 fix-now round (red-team round-3 finding R2, 2026-09-28): this function's OWN
  // doc comment above always claimed both leading AND trailing ranges were collected, but only
  // `getLeadingCommentRanges` was ever called. `ts.getLeadingCommentRanges(text, pos)` only reports
  // a comment when it is preceded by a line break (or sits at position 0) — a comment sharing a
  // line with the code before it (`const n = a + /* c */ b;`) is invisible to a leading-only scan
  // and is instead reachable ONLY via `ts.getTrailingCommentRanges(text, priorNode.getEnd())`.
  // Calling both, at every node's own boundaries, closes that gap: `collectAt` below fires at each
  // node's full-start (leading) AND its own end (trailing) during the same walk.
  function visit(node: ts.Node): void {
    collect(ts.getLeadingCommentRanges(source, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(source, node.getEnd()));
    for (const child of node.getChildren(sourceFile)) visit(child);
  }
  visit(sourceFile);

  ranges.sort((a, b) => a.pos - b.pos);
  let cursor = 0;
  const out: string[] = [];
  for (const r of ranges) {
    if (r.pos > cursor) out.push(source.slice(cursor, r.pos));
    cursor = Math.max(cursor, r.end);
  }
  out.push(source.slice(cursor));
  return out.join("");
}

export function scanForbiddenGlobals(source: string): { name: string }[] {
  const stripped = stripComments(source);
  const found: { name: string }[] = [];
  for (const { name, re } of FORBIDDEN_GLOBAL_PATTERNS) {
    if (re.test(stripped)) found.push({ name });
  }
  return found;
}

// --- AST-based forbidden-globals layer (Issue #63 AST hardening) ---------------------------
// See the header comment above for what this layer catches and its disclosed residual.

// "process" added (Issue #362/#363 fix-now round, red-team round-3 finding R1/drill N7b): the
// regex layer's own `process` pattern is entirely dependent on `stripComments` seeing the real
// code — a regex-vs-divide misread (the disclosed residual above) blinds it completely, exactly
// what drill N7b demonstrated with a live `process.env` read hidden on a blinded line. This AST
// layer parses `source` directly (never through `stripComments`), so it is not vulnerable to that
// same residual and gives `process` a real, independent backstop — the one forbidden global that
// previously had none at this layer.
const FORBIDDEN_ROOTS = new Set([
  "globalThis",
  "global",
  "process",
  "Reflect",
  "eval",
  "Function",
  "fetch",
  "setTimeout",
  "setInterval",
  "require",
]);

/** One AST-detected forbidden-global finding: the resolved root name and a human-readable detail. */
interface AstFinding {
  name: string;
  detail: string;
}

function resolveRootName(name: string, aliasMap: ReadonlyMap<string, string>): string | undefined {
  return aliasMap.get(name) ?? (FORBIDDEN_ROOTS.has(name) ? name : undefined);
}

/**
 * Strips parens, `as`/`satisfies` casts, non-null assertions (`!`), and legacy `<Type>expr`
 * assertions down to the underlying expression. Required for real code, not just cosmetic: this
 * codebase's own established idiom for indexing `globalThis`/`global` under strict TS is exactly
 * `(globalThis as unknown as Record<string, unknown>)["key"]` (see obfuscated-globals.ts) — without
 * seeing through the cast chain, that idiom's base identifier would never resolve and the AST
 * layer would miss the very obfuscation shape it exists to catch.
 */
function unwrapCasts(expr: ts.Expression): ts.Expression {
  let current = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
    } else if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/** Resolves `expr` to a forbidden root name when it's a bare identifier (or a tracked alias of one). */
function resolveExpressionRoot(expr: ts.Expression, aliasMap: ReadonlyMap<string, string>): string | undefined {
  const unwrapped = unwrapCasts(expr);
  return ts.isIdentifier(unwrapped) ? resolveRootName(unwrapped.text, aliasMap) : undefined;
}

/** Constant-folds a string literal, or a `+`-chain of string literals only; anything else is undefined. */
function foldStringConcat(expr: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(expr)) return expr.text;
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = foldStringConcat(expr.left);
    const right = foldStringConcat(expr.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  return undefined;
}

/** A destructure bound directly off a forbidden root is itself the violation (AC: destructured-reflect). */
function recordDestructureViolations(
  pattern: ts.ObjectBindingPattern,
  rootName: string,
  aliasMap: Map<string, string>,
  findings: AstFinding[],
): void {
  for (const element of pattern.elements) {
    if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
    const propName =
      element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
    findings.push({
      name: rootName,
      detail: `destructured "${propName}" directly off forbidden global "${rootName}"`,
    });
    aliasMap.set(element.name.text, rootName);
  }
}

function collectAliasFromDeclaration(
  node: ts.VariableDeclaration,
  aliasMap: Map<string, string>,
  findings: AstFinding[],
): void {
  if (!node.initializer) return;
  const root = resolveExpressionRoot(node.initializer, aliasMap);
  if (!root) return;
  if (ts.isIdentifier(node.name)) {
    aliasMap.set(node.name.text, root);
  } else if (ts.isObjectBindingPattern(node.name)) {
    recordDestructureViolations(node.name, root, aliasMap, findings);
  }
}

function collectAliasFromAssignment(node: ts.BinaryExpression, aliasMap: Map<string, string>): void {
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(node.left)) return;
  const root = resolveExpressionRoot(node.right, aliasMap);
  if (root) aliasMap.set(node.left.text, root);
}

/** Pass 1: walks the whole tree once, resolving alias/reassignment chains and flagging destructures. */
function collectAliases(node: ts.Node, aliasMap: Map<string, string>, findings: AstFinding[]): void {
  if (ts.isVariableDeclaration(node)) {
    collectAliasFromDeclaration(node, aliasMap, findings);
  } else if (ts.isBinaryExpression(node)) {
    collectAliasFromAssignment(node, aliasMap);
  }
  ts.forEachChild(node, (child) => collectAliases(child, aliasMap, findings));
}

function detectPropertyAccessViolation(
  node: ts.PropertyAccessExpression,
  aliasMap: ReadonlyMap<string, string>,
): AstFinding | null {
  const root = resolveExpressionRoot(node.expression, aliasMap);
  if (!root) return null;
  return {
    name: root,
    detail: `property access ".${node.name.text}" on forbidden global "${root}" (possibly via alias)`,
  };
}

function detectElementAccessViolation(
  node: ts.ElementAccessExpression,
  aliasMap: ReadonlyMap<string, string>,
): AstFinding | null {
  const root = resolveExpressionRoot(node.expression, aliasMap);
  if (!root) return null;
  const key = foldStringConcat(node.argumentExpression);
  const keyDesc = key !== undefined ? `["${key}"]` : "[...]";
  return {
    name: root,
    detail: `computed element access ${keyDesc} on forbidden global "${root}" (possibly via alias)`,
  };
}

/**
 * A direct call through a forbidden root or a tracked alias of one, with no property/element
 * access on the callee itself (`fetch(url)`, or `const f = fetch; f(url)`) — Issue #211. This is
 * the dominant real invocation shape for `fetch`/`setTimeout`/`setInterval`/`require`, which the
 * property/element-access branches above never see (there is no `.prop`/`[key]` on the callee).
 */
function detectDirectCallViolation(
  node: ts.CallExpression,
  aliasMap: ReadonlyMap<string, string>,
): AstFinding | null {
  const root = resolveExpressionRoot(node.expression, aliasMap);
  if (!root) return null;
  return {
    name: root,
    detail: `direct call through forbidden global "${root}" (possibly via alias)`,
  };
}

/**
 * `expr`, cast-unwrapped, when it is a `.constructor` access via EITHER notation — dot
 * (`x.constructor`) or bracket with a constant-folded `"constructor"` key (`x["constructor"]`,
 * or a `+`-chain of string literals folding to that key) — else undefined. Resolving both
 * notations through one generic check (rather than a second, parallel bracket-only branch) is
 * what makes `obj.constructor.constructor(...)`, `obj["constructor"]["constructor"](...)`, and
 * any mixed dot/bracket chain (`obj.constructor["constructor"](...)`) all funnel through the same
 * two-deep resolution below (Issue #210 re-confirm, app-security-reviewer, 2026-09-17: bracket
 * notation was an undisclosed full bypass of the dot-only original check).
 */
function asConstructorAccess(expr: ts.Expression): ts.Expression | undefined {
  const unwrapped = unwrapCasts(expr);
  if (ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "constructor") {
    return unwrapped.expression;
  }
  if (ts.isElementAccessExpression(unwrapped) && foldStringConcat(unwrapped.argumentExpression) === "constructor") {
    return unwrapped.expression;
  }
  return undefined;
}

/**
 * The `<expr>.constructor.constructor(...)` prototype-pivot call (Issue #210) — the classic
 * sandbox-escape idiom (`({}).constructor.constructor("return this")()`) that reaches
 * `Function`-constructor-equivalent power without ever writing any of the 9 tracked root
 * identifiers as literal text, anywhere. Root-independent by design: flags the exact adjacent
 * `.constructor.constructor` chain immediately called, regardless of what the base `<expr>` is or
 * which notation (dot, bracket, or mixed) links each hop — this shape does not occur in legitimate
 * code (verified against this repo's own `src/policy/kernel/**` production code and every
 * `clean/` self-test fixture: zero matches). Narrow on purpose — see the header comment for the
 * disclosed residual this narrowness still leaves.
 */
function detectConstructorPivotViolation(node: ts.CallExpression): AstFinding | null {
  const outer = asConstructorAccess(node.expression);
  if (!outer) return null;
  if (!asConstructorAccess(outer)) return null;
  return {
    name: "constructor-pivot",
    detail:
      '".constructor.constructor(...)" prototype-pivot call (dot, bracket, or mixed notation) — reaches ' +
      "Function-constructor-equivalent power regardless of the base expression, independent of any tracked root identifier",
  };
}

/** Pass 2: walks the whole tree once more, flagging property/element/call access reaching a forbidden root. */
function detectUsages(node: ts.Node, aliasMap: ReadonlyMap<string, string>, findings: AstFinding[]): void {
  if (ts.isPropertyAccessExpression(node)) {
    const finding = detectPropertyAccessViolation(node, aliasMap);
    if (finding) findings.push(finding);
  } else if (ts.isElementAccessExpression(node)) {
    const finding = detectElementAccessViolation(node, aliasMap);
    if (finding) findings.push(finding);
  } else if (ts.isCallExpression(node)) {
    const callFinding = detectDirectCallViolation(node, aliasMap);
    if (callFinding) findings.push(callFinding);
    const pivotFinding = detectConstructorPivotViolation(node);
    if (pivotFinding) findings.push(pivotFinding);
  }
  ts.forEachChild(node, (child) => detectUsages(child, aliasMap, findings));
}

/**
 * Syntax-only AST scan for forbidden-global access hidden behind an alias, a reassignment, a
 * destructure, or a computed/bracket property access — see the header comment for exactly what
 * this catches and its disclosed residual. Runs independently of, and additively to,
 * `scanForbiddenGlobals` — both feed the same `"forbidden-global"` violation kind.
 */
export function scanForbiddenGlobalsAst(source: string): AstFinding[] {
  const sourceFile = ts.createSourceFile("kernel-purity-scan.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const aliasMap = new Map<string, string>();
  const findings: AstFinding[] = [];
  collectAliases(sourceFile, aliasMap, findings);
  detectUsages(sourceFile, aliasMap, findings);
  return findings;
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

  for (const g of scanForbiddenGlobalsAst(source)) {
    violations.push({
      file: fileRepoRelPath,
      kind: "forbidden-global",
      detail: `forbidden global/pattern "${g.name}" found (AST: ${g.detail})`,
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
