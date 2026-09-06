// QA-06: real, named mutant classes for S4's shell-command semantic detector (Milestone #22,
// CRITICAL tier). The mutation-harness ENGINE is src/qa/mutation-harness.ts (S1-shipped) — this
// file's own job is registering real mutants against S4's own regression suite, per
// docs/decisions.md's 2026-09-02 S4-intake ruling: "every meaningfully distinct decision branch
// S4's own detector introduces gets a named mutant class proving the regression suite kills it if
// reintroduced, sized by what actually gets built, not guessed in advance."
//
// One mutant per meaningfully distinct decision branch this file's own author identified while
// reading the shipped diff below — a manually-curated, not an AST-derived, enumeration. red-team,
// S4 Stage-3 review, Finding 7 (Issue #76) demonstrated the earlier header comment's "not
// hand-counted" claim overclaimed: the anchor-throw mechanism proves each LISTED mutant still
// points at live code, which is a strictly weaker property than "one mutant per branch" — nothing
// here mechanically enumerates the branch set itself, so completeness is asserted by the person
// writing this list, not measured by an instrument (this project's own no-hand-derived-
// completeness-claims hard rule, applied honestly to this file rather than around it). A durable
// fix — an instrument that derives the branch set from the shipped AST and asserts a mutant exists
// for each one — is tracked in docs/backlog.md, not built here. What IS still mechanically true,
// and load-bearing: every listed mutant's `apply()` throws loudly if its anchor text ever stops
// existing (a moved/renamed branch fails LOUD, not silently drops out of coverage), and every
// listed mutant is independently proven KILLED by a real subprocess run, not merely asserted.
//
// Runs against a SCOPED shadow copy (src/policy/** + a minimal package.json), not the whole repo
// — shadow-copying is per-mutant (mutation-harness.ts's own design), and src/policy/** is
// self-contained (no imports outside itself), so scoping keeps each shadow copy fast without
// touching node_modules/.git.
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Mutant } from "./mutation-harness.ts";
import { runMutationHarness, summarizeMutationRun } from "./mutation-harness.ts";
import { printInstrumentResult, exitCodeFor } from "../lib/instrument.ts";

const here = dirname(fileURLToPath(import.meta.url));
const policySourceDir = join(here, "..", "policy");

const TEST_FILES = [
  "policy/normalizer/shell.test.ts",
  "policy/normalizer/shell-scanner.test.ts",
  "policy/normalizer/flag-catalog.test.ts",
  "policy/normalizer/wrapper-catalog.test.ts",
  "policy/normalizer/registry.test.ts",
];

function buildStagingRoot(): string {
  const stagingParent = mkdtempSync(join(tmpdir(), "shell-detector-mutants-staging-"));
  cpSync(policySourceDir, join(stagingParent, "policy"), { recursive: true });
  writeFileSync(join(stagingParent, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  return stagingParent;
}

// red-team, S4 Stage-3 review, Finding 6 (Issue #75) / architecture-reviewer Finding 5 (Issue
// #78) — duplicate finding, one fix: this repo has no .gitattributes line-ending policy (now
// added, see .gitattributes at the repo root, the other half of this fix), and a Windows checkout
// with core.autocrlf=true converts previously-TRACKED files (e.g. shell.ts) to CRLF while
// brand-new UNTRACKED files stay LF — a byte-literal anchor match against a CRLF source silently
// never matches a multi-line LF anchor. Both halves are applied (either is independently
// sufficient per both reports; both cost nothing to combine): a .gitattributes policy prevents the
// drift at its source, and this normalization makes the matching itself immune to whichever
// line-ending state the working tree happens to be in, on any platform, regardless of git config.
function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

/** A textual mutant: replaces the FIRST occurrence of `anchor` with `mutated` in `targetFile`.
 * Both the source and the anchor/replacement are CRLF-normalized before comparing — CRLF/LF is
 * never a meaningful distinction for the .ts source this targets (Node's parser treats both
 * identically), so normalizing first makes the match immune to the working tree's line-ending
 * state (Issues #75/#78). Throws loudly (rather than silently no-op-ing into a MUTATION-NOOP) when
 * the anchor text is STILL not found after normalization — a moved/renamed branch must fail the
 * gate visibly, not quietly stop being covered. */
function textMutant(id: string, description: string, targetFile: string, anchor: string, mutated: string): Mutant {
  return {
    id,
    description,
    targetFile,
    apply: (originalSource: string) => {
      const normalizedSource = normalizeLineEndings(originalSource);
      const normalizedAnchor = normalizeLineEndings(anchor);
      if (!normalizedSource.includes(normalizedAnchor)) {
        throw new Error(
          `shell-detector-mutants: mutant "${id}"'s anchor text was not found in ${targetFile} ` +
            "(checked with CRLF/LF normalized) — the source moved or was refactored; update this " +
            "mutant's anchor rather than let it silently stop covering anything.",
        );
      }
      return normalizedSource.replace(normalizedAnchor, normalizeLineEndings(mutated));
    },
  };
}

const SHELL = "policy/normalizer/shell.ts";
const SCANNER = "policy/normalizer/shell-scanner.ts";
const FLAGS = "policy/normalizer/flag-catalog.ts";
const WRAPPERS = "policy/normalizer/wrapper-catalog.ts";

const MUTANTS: Mutant[] = [
  // --- SUR-06a/06b: chaining + quote preservation (shell-scanner.ts) -----------------------
  textMutant(
    "chain-operator-table-emptied",
    "SUR-06a: emptying the chain-operator table disables ALL chain-operator detection",
    SCANNER,
    'const CHAIN_OPERATORS = ["&&", "||", ";", "|"] as const;',
    "const CHAIN_OPERATORS = [] as const;",
  ),
  textMutant(
    "chain-operator-quote-liveness-broken",
    "SUR-06b: a chain operator inside quotes would be treated as live if this quote-liveness check is disabled",
    SCANNER,
    "if (states[i + k] !== \"none\") {\n          allLive = false;\n          break;\n        }",
    "allLive = true;",
  ),
  // --- design-challenger Finding #1: command/process substitution (shell-scanner.ts) -------
  textMutant(
    "substitution-markers-table-emptied",
    "Finding #1: emptying the substitution-marker table disables ALL command/process-substitution detection",
    SCANNER,
    'const SUBSTITUTION_MARKERS = ["$(", "`", "<(", ">("] as const;',
    "const SUBSTITUTION_MARKERS = [] as const;",
  ),
  textMutant(
    "substitution-single-quote-inertness-broken",
    "Finding #1: disabling the single-quote-inertness check would make '$(...)' live even inside single quotes",
    SCANNER,
    "if (states[i + k] === \"single\") {\n          allLive = false;\n          break;\n        }",
    "allLive = true;",
  ),
  // --- SUR-08: heredoc-safe target extraction (shell-scanner.ts) ---------------------------
  textMutant(
    "heredoc-marker-line-dropped",
    "SUR-08: dropping the heredoc marker's own line would swallow a trailing redirect on that line",
    SCANNER,
    "outputLines.push(line);\n    i += 1;\n    const bodyLines: string[] = [];",
    "i += 1;\n    const bodyLines: string[] = [];",
  ),
  textMutant(
    "redirect-target-regex-disabled",
    "SUR-08: a redirect regex that never matches disables extractRedirectTarget entirely",
    SCANNER,
    "const re = />{1,2}/g;",
    "const re = /(?!)/g;",
  ),
  // --- SUR-07: quoting + path-qualification (shell-scanner.ts) -----------------------------
  textMutant(
    "tokenize-quote-stripping-disabled",
    "SUR-07: disabling quote-delimiter stripping would leave literal quote characters in every quoted token",
    SCANNER,
    `if ((ch === "'" && states[i] === "single") || (ch === '"' && states[i] === "double")) {`,
    "if (false) {",
  ),
  textMutant(
    "tool-token-path-stripping-disabled",
    "SUR-07: disabling path-prefix stripping would break path-qualified wrapper-binary recognition",
    SCANNER,
    'const withoutPath = token.includes("/") ? token.slice(token.lastIndexOf("/") + 1) : token;',
    "const withoutPath = token;",
  ),
  // --- design-challenger Finding #2: directory flags (flag-catalog.ts) ---------------------
  textMutant(
    "directory-flag-long-form-disabled",
    "Finding #2: emptying the long-form directory-flag set makes '--directory=' silently invisible again",
    FLAGS,
    'const DIRECTORY_FLAG_LONG_EQUALS: ReadonlySet<string> = new Set(["directory"]);',
    "const DIRECTORY_FLAG_LONG_EQUALS: ReadonlySet<string> = new Set([]);",
  ),
  textMutant(
    "directory-flag-short-form-disabled",
    "Finding #2: emptying the short-form directory-flag set makes '-C'/'-d' silently invisible again",
    FLAGS,
    'const DIRECTORY_FLAG_SHORT_NEXT_TOKEN: ReadonlySet<string> = new Set(["C", "d"]);',
    "const DIRECTORY_FLAG_SHORT_NEXT_TOKEN: ReadonlySet<string> = new Set([]);",
  ),
  // --- SUR-07: flag-abbreviation alias (flag-catalog.ts) ------------------------------------
  textMutant(
    "flag-alias-resolution-disabled",
    "SUR-07: emptying the alias table breaks '-c=' resolving to canonical 'context'",
    FLAGS,
    'const KNOWN_FLAG_ALIASES: ReadonlyMap<string, string> = new Map([["c", "context"]]);',
    "const KNOWN_FLAG_ALIASES: ReadonlyMap<string, string> = new Map([]);",
  ),
  // --- SUR-07: flag reordering / classification (shell.ts) ---------------------------------
  textMutant(
    "scanFlags-long-form-regex-broken",
    "SUR-07: a long-form flag regex that never matches breaks --context= recognition regardless of position",
    SHELL,
    "const longForm = /^--([a-zA-Z][\\w-]*)=(.+)$/.exec(token);",
    'const longForm = /^--NEVER-MATCH$/.exec(token);',
  ),
  textMutant(
    "scanFlags-short-form-regex-broken",
    "SUR-07: a short-form flag regex that never matches breaks the abbreviated -c= form",
    SHELL,
    "const shortForm = /^-([a-zA-Z])=(.+)$/.exec(token);",
    'const shortForm = /^-NEVER-MATCH$/.exec(token);',
  ),
  // --- SUR-09: the 9 named wrappers (wrapper-catalog.ts) ------------------------------------
  textMutant(
    "wrapper-bash-sh-c-disabled",
    "SUR-09: forcing bash/sh -c to always shape-mismatch stops it being recognized as a wrapper",
    WRAPPERS,
    'binaryNames: ["bash", "sh"],\n    classify: (tokens) => (tokens[1] === "-c" && tokens.length > 2 ? "match" : "shape-mismatch"),',
    'binaryNames: ["bash", "sh"],\n    classify: () => "shape-mismatch" as const,',
  ),
  textMutant(
    "wrapper-eval-disabled",
    "SUR-09: forcing eval to always shape-mismatch stops it being recognized as a wrapper",
    WRAPPERS,
    'binaryNames: ["eval"],\n    classify: (tokens) => (tokens.length > 1 ? "match" : "shape-mismatch"),',
    'binaryNames: ["eval"],\n    classify: () => "shape-mismatch" as const,',
  ),
  textMutant(
    "wrapper-exec-disabled",
    "SUR-09: forcing exec to always shape-mismatch stops it being recognized as a wrapper",
    WRAPPERS,
    'binaryNames: ["exec"],\n    classify: (tokens) => (tokens.length > 1 ? "match" : "shape-mismatch"),',
    'binaryNames: ["exec"],\n    classify: () => "shape-mismatch" as const,',
  ),
  textMutant(
    "wrapper-nohup-background-disabled",
    "SUR-09: breaking the trailing-'&' check stops nohup being recognized as a wrapper",
    WRAPPERS,
    'return last === "&" || last.endsWith("&") ? "match" : "shape-mismatch";',
    'return "shape-mismatch";',
  ),
  textMutant(
    "wrapper-source-dot-disabled",
    "SUR-09: forcing source/. to always shape-mismatch stops it being recognized as a wrapper",
    WRAPPERS,
    'binaryNames: ["source", "."],\n    classify: (tokens) => (tokens.length > 1 ? "match" : "shape-mismatch"),',
    'binaryNames: ["source", "."],\n    classify: () => "shape-mismatch" as const,',
  ),
  textMutant(
    "wrapper-env-shape-guard-disabled",
    "SUR-09: disabling env's own-flag/VAR=value guard would wrongly 'match' out-of-scope env invocations",
    WRAPPERS,
    'if (next.startsWith("-") || next.includes("=")) return "shape-mismatch";',
    "",
  ),
  textMutant(
    "wrapper-xargs-shape-guard-disabled",
    "SUR-09: disabling xargs's own-flag guard would wrongly 'match' out-of-scope xargs invocations",
    WRAPPERS,
    'if (next.startsWith("-")) return "shape-mismatch";',
    "",
  ),
  textMutant(
    "wrapper-at-disabled",
    "SUR-09: forcing at to always shape-mismatch stops it being recognized as a wrapper",
    WRAPPERS,
    'binaryNames: ["at"],\n    classify: (tokens) => (tokens.length > 1 ? "match" : "shape-mismatch"),',
    'binaryNames: ["at"],\n    classify: () => "shape-mismatch" as const,',
  ),
  textMutant(
    "wrapper-crontab-disabled",
    "SUR-09: forcing crontab to always shape-mismatch stops it being recognized as a wrapper",
    WRAPPERS,
    'binaryNames: ["crontab"],\n    classify: (tokens) => (tokens.length > 1 ? "match" : "shape-mismatch"),',
    'binaryNames: ["crontab"],\n    classify: () => "shape-mismatch" as const,',
  ),
  // --- criterion 10: unresolved-shaped fallthrough (wrapper-catalog.ts) --------------------
  textMutant(
    "wrapper-shape-mismatch-fallthrough-disabled",
    "criterion 10: skipping the shape-mismatch->unresolved-shaped return would silently pass through an indirect-execution-shaped-but-unrecognized construct",
    WRAPPERS,
    'if (classification === "shape-mismatch") return "unresolved-shaped";',
    'if (false) return "unresolved-shaped";',
  ),
  // --- SUR-09: depth cap + inner-record propagation (shell.ts) -----------------------------
  textMutant(
    "depth-cap-check-disabled",
    "SUR-09: disabling the depth-cap comparison would let recursion continue past the cap instead of denying",
    SHELL,
    "if (depth + 1 > DEPTH_CAP) {",
    "if (false) {",
  ),
  textMutant(
    "inner-unresolved-propagation-broken",
    "ADR-0021 'exactly one Action record': dropping the inner record's own unresolved array on the way back out would hide a genuinely unresolved inner command behind a clean-looking outer one",
    SHELL,
    "const inner = normalizeAtDepth({ ...raw, command: wrapper.inner }, depth + 1);\n  return { ...inner, deferred: true };",
    "const inner = normalizeAtDepth({ ...raw, command: wrapper.inner }, depth + 1);\n  return { ...inner, deferred: true, unresolved: [] };",
  ),
  // --- regression guards: real bugs found and fixed during this story's own build (both S4
  // Stage-3 fix-now round self-discoveries, not reviewer findings) ---------------------------
  textMutant(
    "kubectl-attempted-uses-parsed-resources-only-regression",
    "regression guard: checking only the PARSED resources.length (not the raw resourceTokens.length) would silently drop a malformed, non-redirect resource-shaped token that coexists with a live redirect into a false-clean write record, instead of reporting it via 'command resource'",
    SHELL,
    "const kubectlAttempted = resolvedVerb !== undefined || resourceTokens.length > 0 || cluster !== undefined;",
    "const kubectlAttempted = resolvedVerb !== undefined || resources.length > 0 || cluster !== undefined;",
  ),
  textMutant(
    "redirect-operator-exclusion-from-positional-disabled",
    "regression guard, updated round 3 (Issue #80's position-based rework): disabling the isRedirectOperatorToken branch entirely lets a live redirect operator and its target fall back into `positional`, e.g. a deep multi-segment redirect target ('/etc/app/config') gets wrongly collected as a malformed resource-shaped candidate, poisoning an otherwise-valid resource elsewhere in the SAME command via the shared resourceMalformed flag",
    SHELL,
    "if (isRedirectOperatorToken[i]) {",
    "if (false) {",
  ),
  textMutant(
    "redirect-bare-operator-token-span-disabled",
    "Issue #80: forcing isBareOperator to always false makes a SEPARATE (space-delimited) redirect operator token only skip itself, leaving its own target token behind in `positional` to be wrongly collected as a malformed resource-shaped candidate",
    SHELL,
    'const isBareOperator = token === ">" || token === ">>" || token === "&>" || token === "&>>";',
    "const isBareOperator = false;",
  ),
  // --- SUR-08 additive case: redirect targets alongside a resolved kubectl call (shell.ts) --
  textMutant(
    "redirect-target-additive-extraction-disabled",
    "SUR-08: disabling the additive redirect-target branch would drop the redirect target(s) when a kubectl-shaped call ALSO carries a live redirect",
    SHELL,
    "const verbs = resolvedVerb ? [resolvedVerb] : [];\n  const targets = [...resourceTargets];\n  if (redirectTargets.length > 0) {\n    verbs.push(\"write\");\n    targets.push(...redirectTargets);\n  }",
    "const verbs = resolvedVerb ? [resolvedVerb] : [];\n  const targets = [...resourceTargets];",
  ),
  // --- resource-token exact-2-segment validation, as composed by S4's own resolveKubectlShape
  textMutant(
    "resource-token-segment-count-check-broken",
    "app-security-reviewer Issue #65's own fix, re-verified under S4's reorder-tolerant, multi-resource composition: accepting any segment count would let an over-long, smuggled-segment resource token resolve to a truncated target again",
    SHELL,
    "if (segments.length === 2 && segments[0] && segments[1]) {",
    "if (segments.length >= 2 && segments[0] && segments[1]) {",
  ),
  // --- S4 Stage-3 review fix-now round: mutants for the new/changed branches -----------------
  // red-team Finding 1 (Issue #70): newline / non-doubled '&' as live command separators.
  textMutant(
    "trailing-sensitive-separator-newline-disabled",
    "Issue #70: disabling newline detection lets a newline-separated read-then-mutate command clean-resolve to only its first line",
    SCANNER,
    'const isNewline = ch === "\\n";',
    'const isNewline = false;',
  ),
  textMutant(
    "trailing-sensitive-separator-ampersand-disabled",
    "Issue #70: disabling non-doubled-'&' detection lets an '&'-separated read-then-mutate command clean-resolve to only its first command (anchor updated round 3 re-confirm for Issue #83's escape-aware fd-dup rewrite, which replaced the raw-character fd-dup comparisons with isLiveGreaterThan calls across multiple lines)",
    SCANNER,
    'const isSingleAmpersand =\n      ch === "&" &&\n      text[i + 1] !== "&" &&\n      text[i - 1] !== "&" &&\n      !isLiveGreaterThan(text, states, escaped, i + 1) &&\n      !isLiveGreaterThan(text, states, escaped, i - 1);',
    "const isSingleAmpersand = false;",
  ),
  textMutant(
    "trailing-separator-fd-dup-exclusion-disabled",
    "Issue #81/#83: removing only the fd-dup (live-'>'-adjacency) half of the isSingleAmpersand condition, while leaving the doubled-'&' exclusion intact, lets the fd-dup ampersand idiom ('2>&1'/'&>') be mis-read as a command separator again",
    SCANNER,
    "!isLiveGreaterThan(text, states, escaped, i + 1) &&\n      !isLiveGreaterThan(text, states, escaped, i - 1);",
    "true;",
  ),
  textMutant(
    "trailing-separator-escape-awareness-disabled",
    "Issue #83: reusing isLiveGreaterThan but with its own escape check disabled would reopen the exact #83 bypass — a backslash-escaped '\\>' would once again count as fd-dup-adjacent, wrongly excluding a REAL command separator ('&') right after it",
    SCANNER,
    'return pos >= 0 && pos < text.length && text[pos] === ">" && states[pos] === "none" && !escaped[pos];',
    'return pos >= 0 && pos < text.length && text[pos] === ">" && states[pos] === "none";',
  ),
  textMutant(
    "trailing-sensitive-separator-trailing-guard-disabled",
    "Issue #70: removing the 'is there live content after it' guard would wrongly flag a legitimate trailing nohup-style '&' or an ordinary trailing newline as chaining",
    SCANNER,
    "if (j < text.length) return isNewline ? \"\\\\n\" : \"&\";",
    'return isNewline ? "\\\\n" : "&";',
  ),
  // red-team Finding 2 (Issue #71): '<<<' herestring must not be mis-detected as a heredoc marker.
  textMutant(
    "heredoc-marker-herestring-exclusion-disabled",
    "Issue #71: removing the lookbehind/lookahead guards lets a '<<<' herestring be mis-detected as a heredoc marker again, swallowing every following line as inert body",
    SCANNER,
    "const re = /(?<!<)<<(?!<)(-)?\\s*(['\"]?)([A-Za-z_]\\w*)\\2/g;",
    "const re = /<<(-)?\\s*(['\"]?)([A-Za-z_]\\w*)\\2/g;",
  ),
  // app-security Finding 1 (Issue #68): unterminated quote must deny.
  textMutant(
    "unterminated-quote-check-disabled",
    "Issue #68: skipping the unterminated-quote check lets an unmatched quote silently defeat chain-operator AND command-substitution detection at once",
    SHELL,
    'if (hasUnterminatedQuote(liveText)) {\n    return ["unterminated quote — cannot confidently classify the rest of the command"];\n  }',
    "",
  ),
  textMutant(
    "walk-quote-state-final-state-broken",
    "Issue #68: reporting the walk's final state as always \"none\" would make hasUnterminatedQuote never fire, regardless of caller (anchor updated round 3 re-confirm for Issue #83's added `escaped` return field)",
    SCANNER,
    "return { perChar, final: state, escaped };",
    'return { perChar, final: "none", escaped };',
  ),
  // red-team Finding 3 (Issue #72) / app-security Finding 2 (Issue #69): widened directory-flag
  // coverage — the 2 NEW shapes beyond the original long-equals/short-bare pair.
  textMutant(
    "directory-flag-long-space-form-disabled",
    "Issue #72/#69: disabling the long space-separated form ('--directory <path>') lets it silently fall through to ordinary positional handling again",
    FLAGS,
    'if (token.startsWith("--") && !token.includes("=") && DIRECTORY_FLAG_LONG_EQUALS.has(token.slice(2).toLowerCase())) {\n    return { tokenSpan: 2 };\n  }',
    "",
  ),
  textMutant(
    "directory-flag-short-equals-form-disabled",
    "Issue #72/#69 (the sharpest half): disabling the short equals-form ('-C='/'-d=') reopens the alias-collision — '-C=<v>' would fall through to resolveFlagAlias's lowercasing and silently supply --context again",
    FLAGS,
    "const shortEquals = /^-([a-zA-Z])=(.+)$/.exec(token);\n  if (shortEquals && DIRECTORY_FLAG_SHORT_NEXT_TOKEN.has(shortEquals[1] ?? \"\")) {\n    return { tokenSpan: 1 };\n  }",
    "",
  ),
  // red-team Finding 4 (Issue #73): every resource-shaped token is collected, and xargs's inner
  // command is never claimed statically resolvable.
  textMutant(
    "multi-resource-collection-disabled",
    "Issue #73: filtering to only the FIRST resource-shaped token again would silently under-report a multi-resource kubectl invocation",
    SHELL,
    "const resourceTokens = positional.filter((t) => t.includes(\"/\"));",
    'const resourceTokens = positional.filter((t) => t.includes("/")).slice(0, 1);',
  ),
  textMutant(
    "xargs-inner-extraction-reenabled",
    "Issue #73: resolving xargs's visible prefix as if it were the complete command again would silently ignore its stdin-appended, invisible remainder",
    WRAPPERS,
    "    extractInner: () => undefined,\n  },\n  {\n    id: \"at\",",
    '    extractInner: (tokens) => joinFrom(tokens, 1),\n  },\n  {\n    id: "at",',
  ),
  // red-team Finding 5 (Issue #74): every live redirect target is collected, not just the first.
  textMutant(
    "multi-redirect-collection-disabled",
    "Issue #74: stopping at the first live redirect again would under-report a command with more than one live '>'/'>>'",
    SCANNER,
    "    const [target] = tokenize(rest);\n    if (target) targets.push(target);\n  }\n  return targets;",
    "    const [target] = tokenize(rest);\n    if (target) return [target];\n  }\n  return targets;",
  ),
  // --- Round 3, council-approved path (docs/reviews/s4-shell-semantic-detector-council-path-
  // forward-2026-09-03.md): mutants for the new/changed branches Issues #80/#81/#82 introduced,
  // beyond the anchor updates above to mutants that already existed pre-round-3.
  // Issue #81 (shell-scanner.ts side): fd-dup exclusion in the shared redirect-match scan that
  // both extractRedirectTargets and findLiveRedirectOperatorPositions build on. Anchor updated
  // Issue #84 (red-team round-4): the unconditional "any '&' after '>'" check was replaced with a
  // conditional (digit/'-' after the '&') — this mutant now removes the WHOLE trailing-ampersand
  // branch (both the genuine fd-dup exclusion AND the Issue #84 word-form handling), which still
  // fabricates a bogus target out of a fd-dup destination like '2>&1' or '>&2'.
  textMutant(
    "redirect-match-fd-dup-exclusion-disabled",
    "Issue #81: removing the whole trailing-ampersand branch in findLiveRedirectMatches (shared by extractRedirectTargets and findLiveRedirectOperatorPositions) fabricates a bogus target/operator-position out of a fd-dup destination like '2>&1' or '>&2', which creates no file at all",
    SCANNER,
    'if (liveText[idx + length] === "&") {',
    'if (false) {',
  ),
  // Issue #84 (red-team round-4, second stall; anchor re-pointed round-5 for the whole-word fix):
  // this is the exact regression the human's Option A ruling named: reverting `if (isFdDup)
  // continue;` to an unconditional `continue;` silently drops a '>&WORD' target again, treating a
  // real bash file redirect (the '&>WORD' synonym) as if it were fd-dup, exactly the demonstrated
  // bypass ('kubectl get pods/api --context=prod >& out' clean-resolving as a read while bash
  // writes 'out').
  textMutant(
    "trailing-ampersand-word-form-treated-as-fd-dup",
    "Issue #84: making the fd-dup skip unconditional again (ignoring isFdDup) silently drops a real '>&WORD' file-redirect target, reopening the exact deny-bypass the human ruled on (docs/decisions.md 2026-09-06 row)",
    SCANNER,
    "if (isFdDup) continue; // fd-dup destination ('>&DIGITS' / '>&-...'), not a file path",
    "continue; // fd-dup destination ('>&DIGITS' / '>&-...'), not a file path",
  ),
  // Issue #84, sibling branch: the digit/'-' check ITSELF — inverting it would treat a genuine
  // fd-dup ('>&2', '>&-') as if it were a real file redirect, fabricating a bogus target ("2"/"-")
  // for a construct that creates no file at all (the opposite-direction regression from the one
  // above). Anchor re-pointed round-5 for the whole-word fix (`fdWord`/`tokenize`), same branch.
  textMutant(
    "trailing-ampersand-digit-dash-check-inverted",
    "Issue #84: inverting the digit/'-' check would treat a genuine fd-dup ('>&2', '>&-') as a real file redirect, fabricating a bogus target out of a construct that creates no file",
    SCANNER,
    String.raw`const isFdDup = fdWord !== undefined && (fdWord.startsWith("-") || /^\d+$/.test(fdWord));`,
    String.raw`const isFdDup = fdWord !== undefined && !(fdWord.startsWith("-") || /^\d+$/.test(fdWord));`,
  ),
  // Issue #84 residual, round-5 (red-team re-confirm): the all-digits-vs-digit-PREFIX distinction
  // itself — round 4's fix tested only the ONE character after '&'; a digit-leading but not
  // all-digit word (e.g. '2026-09-06.log', '2out') still misclassified as fd-dup and silently
  // vanished as a write target. Weakening the digit test from "the WHOLE word is digits"
  // (`/^\d+$/`) to "the word merely STARTS WITH a digit" (`/^\d/`) reopens exactly that residual —
  // a genuinely new decision branch this round's fix introduces, distinct from the digit/dash
  // check inverted above (that mutant flips the polarity; this one narrows what counts as "all
  // digits").
  textMutant(
    "trailing-ampersand-all-digits-vs-digit-prefix-broken",
    "Issue #84 residual (round 5): weakening the all-digits check to a mere digit-PREFIX check reopens the exact round-5 bypass — a digit-leading, non-all-digit word (e.g. '2026-09-06.log') would misclassify as fd-dup again, silently dropping its write target",
    SCANNER,
    String.raw`/^\d+$/.test(fdWord)`,
    String.raw`/^\d/.test(fdWord)`,
  ),
  // Issue #84, third branch: the '+1' length extension that skips past the '&' itself for the
  // word-form case — without it, target extraction would slice starting AT the '&' instead of
  // just after it, extracting "&out" instead of "out".
  textMutant(
    "trailing-ampersand-word-form-length-not-extended",
    "Issue #84: not extending `length` by 1 for the '>&WORD' word-form case would make target extraction slice starting at the '&' itself, extracting a bogus '&out'-shaped target instead of the real 'out'",
    SCANNER,
    "matches.push({ idx, length: length + 1, tokenStart: precededByLiveAmpersand ? idx - 1 : idx });\n      continue;\n    }",
    "matches.push({ idx, length, tokenStart: precededByLiveAmpersand ? idx - 1 : idx });\n      continue;\n    }",
  ),
  textMutant(
    "redirect-match-ampersand-prefixed-token-start-broken",
    "Issue #80: reporting tokenStart as always the '>' character's own position (never idx - 1) makes the '&>'/'&>>' both-streams form's token-start disagree with tokenizeWithOffsets, which reports it starting at the '&' — the position-based exclusion in shell.ts's scanFlags would then fail to recognize '&>' as a redirect operator token at all",
    SCANNER,
    "matches.push({ idx, length, tokenStart: precededByLiveAmpersand ? idx - 1 : idx });",
    "matches.push({ idx, length, tokenStart: idx });",
  ),
  // Round 3 re-confirm (red-team, Issue #83): findLiveRedirectMatches's own escape-awareness, the
  // structural sibling of the fd-dup exclusion's escape-awareness above.
  textMutant(
    "redirect-match-escape-check-disabled",
    "Issue #83: removing the escaped-leading-'>' skip lets a backslash-escaped literal '>' (e.g. 'echo a \\> b') be wrongly reported as a live redirect operator/target — 'b' would be extracted as a write target for a command that, in real bash, never redirects anything",
    SCANNER,
    'if (escaped[idx]) {\n      re.lastIndex = idx + 1;\n      continue;\n    }',
    "",
  ),
  textMutant(
    "redirect-match-preceded-by-ampersand-escape-check-disabled",
    "Issue #83, sibling location: dropping '!escaped[idx - 1]' from precededByLiveAmpersand lets a backslash-escaped '&' immediately before a live '>' (e.g. 'cmd \\&> /tmp/out', where the '&' is literal text, not a live fd-dup prefix) be wrongly treated as the '&>' both-streams form — reporting the escaped '&' position, not the '>' itself, as the operator's token start",
    SCANNER,
    'idx > 0 && liveText[idx - 1] === "&" && states[idx - 1] === "none" && !escaped[idx - 1];',
    'idx > 0 && liveText[idx - 1] === "&" && states[idx - 1] === "none";',
  ),
  // Issue #82 (shell.ts side): the assembled-target-count guard, council round 3 — both branches
  // that apply it (the resolved-kubectl-plus-redirect path, and the plain-redirect-only path).
  textMutant(
    "assembled-target-count-guard-disabled",
    "Issue #82: removing the assembled resource-plus-redirect target-count guard lets a resolved kubectl call carrying 2+ combined targets resolve cleanly with all of them, instead of denying wholesale — the exact bypass impact-analyst's compound PoC demonstrated (one resource token plus one unquoted redirect)",
    SHELL,
    "if (assembledTargetCount >= 2) {\n    return unresolvedRecord(raw, [multiTargetMessage(assembledTargetCount)], raw.deferred ?? false);\n  }",
    "",
  ),
  textMutant(
    "redirect-only-multi-target-guard-disabled",
    "Issue #82: removing the plain-redirect-only path's own 2+ guard lets a command with no kubectl resource but 2+ live redirect targets (e.g. two chained '>' redirects) resolve cleanly with both targets, instead of denying wholesale the same way the resource-bearing path does",
    SHELL,
    "if (redirectTargets.length >= 2) return unresolvedRecord(raw, [multiTargetMessage(redirectTargets.length)], raw.deferred ?? false);",
    "",
  ),
];

async function main(): Promise<void> {
  const stagingRoot = buildStagingRoot();
  try {
    const run = await runMutationHarness({
      projectRoot: stagingRoot,
      testCommand: { cmd: "node", args: ["--test", ...TEST_FILES] },
      mutants: MUTANTS,
    });
    const result = summarizeMutationRun(run, MUTANTS.length);
    printInstrumentResult("QA-06 shell-detector-mutants", result);
    process.exit(exitCodeFor(result));
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export { MUTANTS };
